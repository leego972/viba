import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logVibaEvent, resolveVibaCredential } from "../lib/vibaVault";

const router: IRouter = Router();

type ReqWithSession = { session?: { userId?: number } };
type Severity = "critical" | "high" | "medium" | "low" | "info";
type AuditIssue = { severity: Severity; area: string; message: string; path?: string; recommendation?: string };
type FileChange = { path: string; content: string; message?: string };
type GitHubTreeItem = { path?: string; type?: string; size?: number; sha?: string };
type GitHubRef = { object: { sha: string } };
type SelfAuditResult = { repoFullName: string; branch: string; scannedAt: string; fileCount: number; issues: AuditIssue[]; summary: Record<Severity, number> };

const DEFAULT_SELF_REPO = process.env.VIBA_SELF_REPO || process.env.GITHUB_REPOSITORY || "leego972/bridge-ai";
const SAFE_CHANGE_PREFIXES = ["docs/", "artifacts/api-server/src/", "artifacts/bridge-ai/src/", "lib/api-zod/src/", "lib/api-client-react/src/", "lib/db/src/", ".github/workflows/"];
const FORBIDDEN_CHANGE_PATTERNS = [/\.env/i, /secret/i, /private/i, /node_modules\//, /pnpm-lock\.yaml$/, /package-lock\.json$/, /yarn\.lock$/];

function userId(req: ReqWithSession): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function repoFromBody(body: unknown): string {
  const repo = typeof (body as { repoFullName?: unknown })?.repoFullName === "string" ? String((body as { repoFullName: string }).repoFullName).trim() : DEFAULT_SELF_REPO;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("repoFullName must be owner/name");
  return repo;
}

function branchFromBody(body: unknown): string {
  const branch = typeof (body as { branch?: unknown })?.branch === "string" ? String((body as { branch: string }).branch).trim() : "main";
  if (!/^[A-Za-z0-9._\/-]+$/.test(branch)) throw new Error("invalid branch");
  return branch;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "VIBA-Self-Audit/1.0",
  };
}

async function githubToken(userIdValue: number | null): Promise<string> {
  const resolved = await resolveVibaCredential({ userId: userIdValue, provider: "github", kind: "token", envNames: ["GITHUB_TOKEN"] });
  if (!resolved.value) throw new Error("Missing GITHUB_TOKEN. Add it to env vars or VIBA credentials before self-repair can use GitHub.");
  return resolved.value;
}

async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, { ...init, headers: { ...githubHeaders(token), ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof (data as { message?: unknown }).message === "string" ? (data as { message: string }).message : `GitHub HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

async function ensureTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_self_audits (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      repo_full_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      result JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_self_fix_plans (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      audit_id INTEGER,
      repo_full_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      plan JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_self_checkpoints (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      repo_full_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_self_repair_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      audit_id INTEGER,
      fix_plan_id INTEGER,
      checkpoint_id INTEGER,
      repo_full_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      pr_number INTEGER,
      pr_url TEXT,
      status TEXT NOT NULL DEFAULT 'requested',
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function summarize(issues: AuditIssue[]): Record<Severity, number> {
  return {
    critical: issues.filter((i) => i.severity === "critical").length,
    high: issues.filter((i) => i.severity === "high").length,
    medium: issues.filter((i) => i.severity === "medium").length,
    low: issues.filter((i) => i.severity === "low").length,
    info: issues.filter((i) => i.severity === "info").length,
  };
}

async function currentHeadSha(token: string, repo: string, branch: string): Promise<string> {
  const ref = await gh<GitHubRef>(token, `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  return ref.object.sha;
}

async function createCheckpoint(input: { token: string; userId: number | null; repo: string; branch: string; reason: string; metadata?: Record<string, unknown> }) {
  await ensureTables();
  const sha = await currentHeadSha(input.token, input.repo, input.branch);
  const { rows } = await pool.query<{ id: number; head_sha: string }>(
    `INSERT INTO viba_self_checkpoints (user_id, repo_full_name, branch, head_sha, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, head_sha`,
    [input.userId, input.repo, input.branch, sha, input.reason, JSON.stringify(input.metadata ?? {})],
  );
  await logVibaEvent({ userId: input.userId, eventType: "checkpoint_created", provider: "github", subject: input.repo, status: "created", message: `Checkpoint created for ${input.repo}@${input.branch}.`, metadata: { checkpointId: rows[0]?.id, sha, reason: input.reason } });
  return { id: rows[0]?.id, headSha: sha };
}

async function fetchTextFile(token: string, repo: string, branch: string, path: string): Promise<string | null> {
  try {
    const data = await gh<{ content?: string; encoding?: string }>(token, `/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`);
    if (data.encoding === "base64" && data.content) return Buffer.from(data.content, "base64").toString("utf8");
    return null;
  } catch {
    return null;
  }
}

async function runAudit(input: { token: string; repo: string; branch: string }): Promise<SelfAuditResult> {
  const tree = await gh<{ tree?: GitHubTreeItem[] }>(input.token, `/repos/${input.repo}/git/trees/${encodeURIComponent(input.branch)}?recursive=1`);
  const files = (tree.tree ?? []).filter((item) => item.type === "blob" && item.path);
  const paths = new Set(files.map((item) => item.path!));
  const issues: AuditIssue[] = [];
  const requiredPaths = [
    "package.json",
    "pnpm-workspace.yaml",
    "artifacts/api-server/src/routes/index.ts",
    "artifacts/api-server/src/routes/sessions.ts",
    "artifacts/api-server/src/lib/agentLoop.ts",
    "artifacts/api-server/src/lib/taskRouter.ts",
    "artifacts/api-server/src/lib/fallbackPool.ts",
    "artifacts/api-server/src/routes/credentials.ts",
    "artifacts/api-server/src/routes/connections.ts",
    "artifacts/api-server/src/routes/attachments.ts",
    "artifacts/api-server/src/routes/sessionPrivacy.ts",
    "artifacts/api-server/src/routes/coreDefaults.ts",
    "artifacts/api-server/src/lib/instructionOrchestrator.ts",
    "docs/environment-variables.md",
  ];
  for (const path of requiredPaths) {
    if (!paths.has(path)) issues.push({ severity: "high", area: "missing_file", path, message: `Required backend file missing: ${path}`, recommendation: "Restore or implement this backend module before UI release." });
  }
  for (const file of files.filter((item) => item.path?.startsWith("_tmp_") || item.path?.includes("restore_marker"))) {
    issues.push({ severity: "medium", area: "repo_hygiene", path: file.path, message: "Temporary marker file found in repository.", recommendation: "Delete temporary files before production deploy." });
  }
  const routesIndex = await fetchTextFile(input.token, input.repo, input.branch, "artifacts/api-server/src/routes/index.ts");
  if (routesIndex) {
    for (const requiredImport of ["attachments", "sessionPrivacy", "coreDefaults", "credentials", "connections", "webResearch", "pricingResearch"]) {
      if (!routesIndex.includes(requiredImport)) issues.push({ severity: "high", area: "route_registration", path: "artifacts/api-server/src/routes/index.ts", message: `Route registration appears to be missing: ${requiredImport}`, recommendation: "Register the route in the API router before release." });
    }
  }
  const sessionPrivacy = await fetchTextFile(input.token, input.repo, input.branch, "artifacts/api-server/src/routes/sessionPrivacy.ts");
  if (sessionPrivacy && !sessionPrivacy.includes("Forbidden: this session belongs to another user")) {
    issues.push({ severity: "critical", area: "privacy", path: "artifacts/api-server/src/routes/sessionPrivacy.ts", message: "Session ownership guard does not clearly block cross-user access.", recommendation: "Harden session ownership checks before production." });
  }
  const attachments = await fetchTextFile(input.token, input.repo, input.branch, "artifacts/api-server/src/routes/attachments.ts");
  if (attachments) {
    if (!attachments.includes("viba_attachments")) issues.push({ severity: "high", area: "uploads", path: "artifacts/api-server/src/routes/attachments.ts", message: "Attachment persistence table is not referenced.", recommendation: "Ensure uploaded files are stored with session and user metadata." });
    if (!attachments.includes("MAX_ATTACHMENT_BYTES")) issues.push({ severity: "medium", area: "uploads", path: "artifacts/api-server/src/routes/attachments.ts", message: "Upload size limit not visible.", recommendation: "Add explicit file size limits." });
  }
  issues.push({ severity: "info", area: "approval_gate", message: "Self-repair is PR-first. Merge/deploy must remain owner-approved and checkpointed.", recommendation: "Create checkpoint before any merge or deploy request." });
  return { repoFullName: input.repo, branch: input.branch, scannedAt: new Date().toISOString(), fileCount: files.length, issues, summary: summarize(issues) };
}

function makeFixPlan(audit: SelfAuditResult) {
  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const sorted = [...audit.issues].sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    repoFullName: audit.repoFullName,
    branch: audit.branch,
    createdAt: new Date().toISOString(),
    mode: "owner_approved_pr_only",
    checkpointRequiredBefore: ["merge", "deploy", "Railway mutation"],
    approvalRequiredFor: ["merge", "deploy", "billing changes", "auth/privacy changes", "database schema changes", "Railway mutations", "file deletion"],
    steps: sorted.map((issue, index) => ({ order: index + 1, severity: issue.severity, area: issue.area, path: issue.path ?? null, issue: issue.message, recommendation: issue.recommendation ?? "Review required.", action: issue.path ? "prepare_patch_or_review_file" : "manual_review" })),
  };
}

function validateChange(change: FileChange): void {
  if (!change.path || !change.content) throw new Error("Each change needs path and content.");
  if (FORBIDDEN_CHANGE_PATTERNS.some((pattern) => pattern.test(change.path))) throw new Error(`Refusing unsafe path: ${change.path}`);
  if (!SAFE_CHANGE_PREFIXES.some((prefix) => change.path.startsWith(prefix))) throw new Error(`Path outside safe repair prefixes: ${change.path}`);
}

async function ensureBranch(token: string, repo: string, branchName: string, fromSha: string): Promise<void> {
  try {
    await gh(token, `/repos/${repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }) });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.toLowerCase().includes("reference already exists")) throw error;
  }
}

async function upsertFile(token: string, repo: string, branch: string, change: FileChange): Promise<void> {
  validateChange(change);
  let existingSha: string | undefined;
  try {
    const existing = await gh<{ sha?: string }>(token, `/repos/${repo}/contents/${encodeURIComponent(change.path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`);
    existingSha = existing.sha;
  } catch {
    existingSha = undefined;
  }
  await gh(token, `/repos/${repo}/contents/${encodeURIComponent(change.path).replace(/%2F/g, "/")}`, {
    method: "PUT",
    body: JSON.stringify({ message: change.message ?? `VIBA self-repair: update ${change.path}`, content: Buffer.from(change.content, "utf8").toString("base64"), branch, sha: existingSha }),
  });
}

router.post("/self-audit/start", async (req, res): Promise<void> => {
  const uid = userId(req);
  try {
    await ensureTables();
    const repo = repoFromBody(req.body ?? {});
    const branch = branchFromBody(req.body ?? {});
    const token = await githubToken(uid);
    const result = await runAudit({ token, repo, branch });
    const { rows } = await pool.query<{ id: number }>(`INSERT INTO viba_self_audits (user_id, repo_full_name, branch, status, result) VALUES ($1, $2, $3, 'completed', $4) RETURNING id`, [uid, repo, branch, JSON.stringify(result)]);
    await logVibaEvent({ userId: uid, eventType: "self_audit_completed", provider: "github", subject: repo, status: "completed", message: `Self audit completed for ${repo}.`, metadata: { auditId: rows[0]?.id, summary: result.summary } });
    res.status(201).json({ ok: true, auditId: rows[0]?.id, result });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : "Self audit failed." });
  }
});

router.post("/self-audit/fix-plan", async (req, res): Promise<void> => {
  const uid = userId(req);
  try {
    await ensureTables();
    const auditId = Number((req.body as { auditId?: unknown }).auditId);
    if (!Number.isFinite(auditId) || auditId <= 0) throw new Error("auditId required");
    const { rows } = await pool.query<{ repo_full_name: string; branch: string; result: SelfAuditResult }>(`SELECT repo_full_name, branch, result FROM viba_self_audits WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) LIMIT 1`, [auditId, uid]);
    const row = rows[0];
    if (!row) throw new Error("Audit not found");
    const plan = makeFixPlan(row.result);
    const inserted = await pool.query<{ id: number }>(`INSERT INTO viba_self_fix_plans (user_id, audit_id, repo_full_name, branch, status, plan) VALUES ($1, $2, $3, $4, 'planned', $5) RETURNING id`, [uid, auditId, row.repo_full_name, row.branch, JSON.stringify(plan)]);
    await logVibaEvent({ userId: uid, eventType: "self_fix_plan_created", provider: "viba", subject: row.repo_full_name, status: "planned", message: "Self-fix plan created.", metadata: { auditId, fixPlanId: inserted.rows[0]?.id } });
    res.status(201).json({ ok: true, fixPlanId: inserted.rows[0]?.id, plan });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : "Fix-plan failed." });
  }
});

router.post("/self-audit/checkpoint", async (req, res): Promise<void> => {
  const uid = userId(req);
  try {
    const body = req.body ?? {};
    const repo = repoFromBody(body);
    const branch = branchFromBody(body);
    const reason = typeof (body as { reason?: unknown }).reason === "string" ? String((body as { reason: string }).reason) : "manual_checkpoint";
    const token = await githubToken(uid);
    const checkpoint = await createCheckpoint({ token, userId: uid, repo, branch, reason });
    res.status(201).json({ ok: true, checkpoint });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : "Checkpoint failed." });
  }
});

router.post("/self-audit/create-pr", async (req, res): Promise<void> => {
  const uid = userId(req);
  try {
    await ensureTables();
    const body = req.body as { auditId?: unknown; fixPlanId?: unknown; confirm?: unknown; changes?: FileChange[]; branchName?: unknown; title?: unknown; body?: unknown };
    if (body.confirm !== true) throw new Error("confirm=true required before creating a self-repair PR");
    const repo = repoFromBody(body);
    const baseBranch = branchFromBody(body);
    const changes = Array.isArray(body.changes) ? body.changes : [];
    if (!changes.length) throw new Error("changes array required");
    changes.forEach(validateChange);
    const token = await githubToken(uid);
    const checkpoint = await createCheckpoint({ token, userId: uid, repo, branch: baseBranch, reason: "before_self_repair_pr", metadata: { changeCount: changes.length } });
    const repairBranch = typeof body.branchName === "string" && body.branchName.trim() ? body.branchName.trim() : `viba/self-repair-${Date.now()}`;
    await ensureBranch(token, repo, repairBranch, checkpoint.headSha);
    for (const change of changes) await upsertFile(token, repo, repairBranch, change);
    const pr = await gh<{ number: number; html_url: string }>(token, `/repos/${repo}/pulls`, { method: "POST", body: JSON.stringify({ title: typeof body.title === "string" ? body.title : "VIBA self-repair proposal", head: repairBranch, base: baseBranch, body: typeof body.body === "string" ? body.body : "Owner approval required before merge/deploy. Checkpoint was created before this repair branch." }) });
    const inserted = await pool.query<{ id: number }>(`INSERT INTO viba_self_repair_requests (user_id, audit_id, fix_plan_id, checkpoint_id, repo_full_name, branch, pr_number, pr_url, status, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pr_created',$9) RETURNING id`, [uid, Number(body.auditId) || null, Number(body.fixPlanId) || null, checkpoint.id, repo, baseBranch, pr.number, pr.html_url, JSON.stringify({ repairBranch, changeCount: changes.length })]);
    await logVibaEvent({ userId: uid, eventType: "self_repair_pr_created", provider: "github", subject: repo, status: "pr_created", message: `Self-repair PR #${pr.number} created.`, metadata: { requestId: inserted.rows[0]?.id, checkpointId: checkpoint.id, prNumber: pr.number, prUrl: pr.html_url } });
    res.status(201).json({ ok: true, requestId: inserted.rows[0]?.id, checkpoint, pr });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : "Create PR failed." });
  }
});

router.post("/self-audit/request-merge", async (req, res): Promise<void> => {
  const uid = userId(req);
  try {
    await ensureTables();
    const body = req.body as { repoFullName?: unknown; branch?: unknown; prNumber?: unknown; confirm?: unknown };
    if (body.confirm !== true) throw new Error("confirm=true required");
    if (process.env.VIBA_ALLOW_SELF_MERGE !== "true") throw new Error("Self-merge is disabled. Set VIBA_ALLOW_SELF_MERGE=true only after owner approval.");
    const repo = repoFromBody(body);
    const branch = branchFromBody(body);
    const prNumber = Number(body.prNumber);
    if (!Number.isFinite(prNumber) || prNumber <= 0) throw new Error("prNumber required");
    const token = await githubToken(uid);
    const checkpoint = await createCheckpoint({ token, userId: uid, repo, branch, reason: "before_self_repair_merge", metadata: { prNumber } });
    const merge = await gh(token, `/repos/${repo}/pulls/${prNumber}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash", commit_title: `Merge VIBA self-repair PR #${prNumber}` }) });
    await logVibaEvent({ userId: uid, eventType: "self_repair_merged", provider: "github", subject: repo, status: "merged", message: `Self-repair PR #${prNumber} merged after checkpoint.`, metadata: { checkpointId: checkpoint.id, prNumber, merge } });
    res.json({ ok: true, checkpoint, merge });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : "Merge request failed." });
  }
});

router.post("/self-audit/restore-checkpoint", async (req, res): Promise<void> => {
  const uid = userId(req);
  try {
    await ensureTables();
    const checkpointId = Number((req.body as { checkpointId?: unknown }).checkpointId);
    if (!Number.isFinite(checkpointId) || checkpointId <= 0) throw new Error("checkpointId required");
    const { rows } = await pool.query<{ id: number; repo_full_name: string; branch: string; head_sha: string }>(`SELECT id, repo_full_name, branch, head_sha FROM viba_self_checkpoints WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) LIMIT 1`, [checkpointId, uid]);
    const checkpoint = rows[0];
    if (!checkpoint) throw new Error("Checkpoint not found");
    const token = await githubToken(uid);
    const restoreBranch = `viba/restore-${checkpoint.id}-${Date.now()}`;
    await ensureBranch(token, checkpoint.repo_full_name, restoreBranch, checkpoint.head_sha);
    const pr = await gh<{ number: number; html_url: string }>(token, `/repos/${checkpoint.repo_full_name}/pulls`, { method: "POST", body: JSON.stringify({ title: `Restore VIBA checkpoint ${checkpoint.id}`, head: restoreBranch, base: checkpoint.branch, body: `Restore branch created from checkpoint SHA ${checkpoint.head_sha}. Owner approval required before merge.` }) });
    await pool.query(`UPDATE viba_self_checkpoints SET status = 'restore_pr_created' WHERE id = $1`, [checkpoint.id]);
    await logVibaEvent({ userId: uid, eventType: "checkpoint_restore_requested", provider: "github", subject: checkpoint.repo_full_name, status: "restore_pr_created", message: `Restore PR #${pr.number} created from checkpoint ${checkpoint.id}.`, metadata: { checkpointId: checkpoint.id, restoreBranch, prNumber: pr.number, prUrl: pr.html_url } });
    res.status(201).json({ ok: true, checkpoint, restoreBranch, pr });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : "Restore failed." });
  }
});

router.get("/self-audit/checkpoints", async (req, res): Promise<void> => {
  const uid = userId(req);
  await ensureTables();
  const { rows } = await pool.query(`SELECT id, repo_full_name, branch, head_sha, reason, status, metadata, created_at FROM viba_self_checkpoints WHERE user_id = $1 OR user_id IS NULL ORDER BY created_at DESC LIMIT 100`, [uid]);
  res.json({ checkpoints: rows });
});

export default router;
