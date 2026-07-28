import { Router, type Request, type Response } from "express";
import { createCipheriv, createDecipheriv, createHash, createSign, randomBytes } from "crypto";
import { pool } from "@workspace/db";

const router = Router();
const json = (res: Response, status: number, value: unknown) => res.status(status).json(value);

function userId(req: Request): number {
  const id = req.session?.userId;
  if (!id) throw new Error("Unauthenticated");
  return id;
}

function key(): Buffer {
  const raw = process.env.PLAY_PUBLISHER_MASTER_KEY;
  if (!raw) throw new Error("PLAY_PUBLISHER_MASTER_KEY is required");
  return createHash("sha256").update(raw).digest();
}

function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

function decrypt(value: string): string {
  const [iv, tag, body] = value.split(".");
  if (!iv || !tag || !body) throw new Error("Invalid encrypted credential");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS play_publisher_connections (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      service_account_email TEXT NOT NULL,
      encrypted_service_account TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'connected',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_play_connections_user ON play_publisher_connections(user_id);

    CREATE TABLE IF NOT EXISTS play_publisher_apps (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      connection_id INTEGER REFERENCES play_publisher_connections(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      package_name TEXT NOT NULL,
      repository_url TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      project_path TEXT NOT NULL DEFAULT '.',
      framework TEXT NOT NULL DEFAULT 'capacitor',
      version_code INTEGER NOT NULL DEFAULT 1,
      version_name TEXT NOT NULL DEFAULT '1.0.0',
      target_sdk INTEGER,
      privacy_policy_url TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, package_name)
    );

    CREATE TABLE IF NOT EXISTS play_publisher_jobs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      app_id INTEGER NOT NULL REFERENCES play_publisher_apps(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      requested_track TEXT,
      rollout_percent INTEGER,
      artifact_url TEXT,
      artifact_sha256 TEXT,
      google_edit_id TEXT,
      google_version_code INTEGER,
      input JSONB NOT NULL DEFAULT '{}'::jsonb,
      output JSONB NOT NULL DEFAULT '{}'::jsonb,
      error TEXT,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_play_jobs_app ON play_publisher_jobs(app_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS play_publisher_audit_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      app_id INTEGER,
      action TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

async function accessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson) as { client_email?: string; private_key?: string; token_uri?: string };
  if (!sa.client_email || !sa.private_key) throw new Error("Service account JSON is missing client_email or private_key");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(sa.private_key, "base64url")}`;
  const response = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description ?? "Google authentication failed");
  return data.access_token;
}

async function googleFetch(token: string, url: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data?.error?.message ?? `Google Play API error ${response.status}`);
  return data;
}

router.get("/play-publisher/overview", async (req, res) => {
  try {
    await ensureSchema();
    const uid = userId(req);
    const [connections, apps, jobs] = await Promise.all([
      pool.query("SELECT id,name,service_account_email,status,created_at FROM play_publisher_connections WHERE user_id=$1 ORDER BY created_at DESC", [uid]),
      pool.query("SELECT * FROM play_publisher_apps WHERE user_id=$1 ORDER BY created_at DESC", [uid]),
      pool.query("SELECT * FROM play_publisher_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [uid]),
    ]);
    res.json({ connections: connections.rows, apps: apps.rows, jobs: jobs.rows });
  } catch (error) { json(res, 500, { error: error instanceof Error ? error.message : "Unknown error" }); }
});

router.post("/play-publisher/connections", async (req, res) => {
  try {
    await ensureSchema();
    const uid = userId(req);
    const { name, serviceAccountJson } = req.body as { name?: string; serviceAccountJson?: string };
    if (!serviceAccountJson) return json(res, 400, { error: "serviceAccountJson is required" });
    const parsed = JSON.parse(serviceAccountJson) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) return json(res, 400, { error: "Invalid service account JSON" });
    await accessToken(serviceAccountJson);
    const result = await pool.query(
      "INSERT INTO play_publisher_connections(user_id,name,service_account_email,encrypted_service_account) VALUES($1,$2,$3,$4) RETURNING id,name,service_account_email,status,created_at",
      [uid, (name ?? "Google Play").slice(0, 120), parsed.client_email, encrypt(serviceAccountJson)],
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : "Connection failed" }); }
});

router.post("/play-publisher/apps", async (req, res) => {
  try {
    await ensureSchema();
    const uid = userId(req);
    const b = req.body as Record<string, unknown>;
    if (!b.name || !b.packageName || !b.repositoryUrl) return json(res, 400, { error: "name, packageName and repositoryUrl are required" });
    const result = await pool.query(`INSERT INTO play_publisher_apps
      (user_id,connection_id,name,package_name,repository_url,branch,project_path,framework,version_code,version_name,target_sdk,privacy_policy_url)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [uid, b.connectionId ?? null, b.name, b.packageName, b.repositoryUrl, b.branch ?? "main", b.projectPath ?? ".", b.framework ?? "capacitor", b.versionCode ?? 1, b.versionName ?? "1.0.0", b.targetSdk ?? null, b.privacyPolicyUrl ?? null]);
    res.status(201).json(result.rows[0]);
  } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : "Create failed" }); }
});

router.post("/play-publisher/apps/:id/audit", async (req, res) => {
  try {
    await ensureSchema();
    const uid = userId(req); const appId = Number(req.params.id);
    const app = (await pool.query("SELECT * FROM play_publisher_apps WHERE id=$1 AND user_id=$2", [appId, uid])).rows[0];
    if (!app) return json(res, 404, { error: "App not found" });
    const checks = [
      { key: "package", status: /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(app.package_name) ? "passed" : "failed", message: app.package_name },
      { key: "repository", status: /^https:\/\//.test(app.repository_url) ? "passed" : "failed", message: app.repository_url },
      { key: "targetSdk", status: Number(app.target_sdk) >= 35 ? "passed" : "warning", message: app.target_sdk ? `Target SDK ${app.target_sdk}` : "Target SDK not recorded" },
      { key: "privacy", status: /^https:\/\//.test(app.privacy_policy_url ?? "") ? "passed" : "failed", message: app.privacy_policy_url ?? "Privacy policy required" },
      { key: "connection", status: app.connection_id ? "passed" : "failed", message: app.connection_id ? "Google Play connected" : "Connect Google Play" },
    ];
    const status = checks.some(c => c.status === "failed") ? "failed" : checks.some(c => c.status === "warning") ? "warning" : "passed";
    const job = await pool.query("INSERT INTO play_publisher_jobs(user_id,app_id,kind,status,input,output,completed_at) VALUES($1,$2,'audit',$3,$4,$5,NOW()) RETURNING *", [uid, appId, status, { repositoryUrl: app.repository_url, branch: app.branch, projectPath: app.project_path }, { checks }]);
    await pool.query("UPDATE play_publisher_apps SET status=$1,updated_at=NOW() WHERE id=$2", [status === "passed" ? "ready" : "needs_attention", appId]);
    res.status(201).json(job.rows[0]);
  } catch (error) { json(res, 500, { error: error instanceof Error ? error.message : "Audit failed" }); }
});

router.post("/play-publisher/apps/:id/builds", async (req, res) => {
  try {
    await ensureSchema();
    const uid = userId(req); const appId = Number(req.params.id);
    const owned = await pool.query("SELECT id FROM play_publisher_apps WHERE id=$1 AND user_id=$2", [appId, uid]);
    if (!owned.rows[0]) return json(res, 404, { error: "App not found" });
    const result = await pool.query("INSERT INTO play_publisher_jobs(user_id,app_id,kind,status,input) VALUES($1,$2,'build','queued',$3) RETURNING *", [uid, appId, req.body ?? {}]);
    res.status(202).json(result.rows[0]);
  } catch (error) { json(res, 500, { error: error instanceof Error ? error.message : "Build queue failed" }); }
});

router.post("/play-publisher/jobs/:id/complete", async (req, res) => {
  try {
    await ensureSchema();
    const uid = userId(req); const jobId = Number(req.params.id);
    const { status, artifactUrl, sha256, output, error } = req.body as any;
    const result = await pool.query(`UPDATE play_publisher_jobs SET status=$1,artifact_url=$2,artifact_sha256=$3,output=$4,error=$5,completed_at=NOW()
      WHERE id=$6 AND user_id=$7 AND kind='build' RETURNING *`, [status, artifactUrl ?? null, sha256 ?? null, output ?? {}, error ?? null, jobId, uid]);
    if (!result.rows[0]) return json(res, 404, { error: "Build job not found" });
    res.json(result.rows[0]);
  } catch (error) { json(res, 500, { error: error instanceof Error ? error.message : "Update failed" }); }
});

router.post("/play-publisher/apps/:id/releases", async (req, res) => {
  try {
    await ensureSchema();
    const uid = userId(req); const appId = Number(req.params.id);
    const { buildJobId, track = "internal", rolloutPercent = 100, approveProduction = false } = req.body as any;
    if (track === "production" && approveProduction !== true) return json(res, 409, { error: "Production release requires explicit approveProduction=true" });
    const app = (await pool.query(`SELECT a.*,c.encrypted_service_account FROM play_publisher_apps a JOIN play_publisher_connections c ON c.id=a.connection_id
      WHERE a.id=$1 AND a.user_id=$2 AND c.user_id=$2`, [appId, uid])).rows[0];
    if (!app) return json(res, 404, { error: "App or Google connection not found" });
    const build = (await pool.query("SELECT * FROM play_publisher_jobs WHERE id=$1 AND app_id=$2 AND user_id=$3 AND kind='build' AND status='completed'", [buildJobId, appId, uid])).rows[0];
    if (!build?.artifact_url) return json(res, 400, { error: "A completed build with artifactUrl is required" });

    const release = (await pool.query("INSERT INTO play_publisher_jobs(user_id,app_id,kind,status,requested_track,rollout_percent,input,approved_at) VALUES($1,$2,'release','running',$3,$4,$5,NOW()) RETURNING *", [uid, appId, track, rolloutPercent, { buildJobId }])).rows[0];
    try {
      const token = await accessToken(decrypt(app.encrypted_service_account));
      const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(app.package_name)}`;
      const edit = await googleFetch(token, `${base}/edits`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const artifact = await fetch(build.artifact_url);
      if (!artifact.ok) throw new Error(`Unable to download build artifact (${artifact.status})`);
      const bytes = Buffer.from(await artifact.arrayBuffer());
      if (build.artifact_sha256 && createHash("sha256").update(bytes).digest("hex") !== build.artifact_sha256) throw new Error("Artifact SHA-256 mismatch");
      const bundle = await googleFetch(token, `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${encodeURIComponent(app.package_name)}/edits/${edit.id}/bundles?uploadType=media`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes });
      const trackBody = { releases: [{ name: app.version_name, versionCodes: [String(bundle.versionCode)], status: track === "production" && rolloutPercent < 100 ? "inProgress" : "completed", ...(track === "production" && rolloutPercent < 100 ? { userFraction: rolloutPercent / 100 } : {}) }] };
      await googleFetch(token, `${base}/edits/${edit.id}/tracks/${encodeURIComponent(track)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(trackBody) });
      await googleFetch(token, `${base}/edits/${edit.id}:commit`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const done = await pool.query("UPDATE play_publisher_jobs SET status='completed',google_edit_id=$1,google_version_code=$2,output=$3,completed_at=NOW() WHERE id=$4 RETURNING *", [edit.id, bundle.versionCode, { track, rolloutPercent }, release.id]);
      await pool.query("INSERT INTO play_publisher_audit_logs(user_id,app_id,action,details) VALUES($1,$2,'release_committed',$3)", [uid, appId, { track, rolloutPercent, versionCode: bundle.versionCode }]);
      res.status(201).json(done.rows[0]);
    } catch (error) {
      await pool.query("UPDATE play_publisher_jobs SET status='failed',error=$1,completed_at=NOW() WHERE id=$2", [error instanceof Error ? error.message : "Release failed", release.id]);
      throw error;
    }
  } catch (error) { json(res, 500, { error: error instanceof Error ? error.message : "Release failed" }); }
});

export default router;
