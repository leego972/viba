import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { requireConfirmation } from "../middlewares/adminAuth";
import { runWeeklyMaintenanceNow } from "../lib/maintenanceScheduler";
import { resolveVibaCredential } from "../lib/vibaVault";
import { verifyRepoInSandbox } from "../lib/selfRepairSandbox";

const router: IRouter = Router();

type GitHubRef = { object: { sha: string } };
type PullRequestInfo = {
  number: number;
  html_url: string;
  state: string;
  merged: boolean;
  head: { ref: string; repo: { full_name: string } };
  base: { ref: string; repo: { full_name: string } };
};

type MaintenanceRow = {
  id: number;
  run_key: string;
  status: string;
  repo_full_name: string;
  base_branch: string;
  self_repair_run_id: number | null;
  pr_number: number | null;
  pr_url: string | null;
  checkpoint_id: number | null;
  notification_status: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "VIBA-Admin-Maintenance/1.0",
  };
}

async function githubToken(): Promise<string> {
  const resolved = await resolveVibaCredential({ userId: null, provider: "github", kind: "token", envNames: ["GITHUB_TOKEN"] });
  if (!resolved.value) throw new Error("Missing GITHUB_TOKEN. Admin maintenance cannot merge without GitHub access.");
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
    CREATE TABLE IF NOT EXISTS viba_maintenance_runs (
      id SERIAL PRIMARY KEY,
      run_key TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      repo_full_name TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      self_repair_run_id INTEGER,
      pr_number INTEGER,
      pr_url TEXT,
      checkpoint_id INTEGER,
      admin_email TEXT NOT NULL,
      notification_status TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
}

async function currentHeadSha(token: string, repo: string, branch: string): Promise<string> {
  const ref = await gh<GitHubRef>(token, `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  return ref.object.sha;
}

async function createCheckpoint(input: { token: string; repo: string; branch: string; reason: string; metadata?: Record<string, unknown> }) {
  const sha = await currentHeadSha(input.token, input.repo, input.branch);
  const { rows } = await pool.query<{ id: number; head_sha: string }>(
    `INSERT INTO viba_self_checkpoints (user_id, repo_full_name, branch, head_sha, reason, metadata)
     VALUES (NULL, $1, $2, $3, $4, $5)
     RETURNING id, head_sha`,
    [input.repo, input.branch, sha, input.reason, JSON.stringify(input.metadata ?? {})],
  );
  return { id: rows[0]?.id, headSha: sha };
}

async function latestMaintenanceRun(): Promise<MaintenanceRow | null> {
  await ensureTables();
  const { rows } = await pool.query<MaintenanceRow>(
    `SELECT id, run_key, status, repo_full_name, base_branch, self_repair_run_id,
            pr_number, pr_url, checkpoint_id, notification_status, metadata,
            created_at, updated_at
       FROM viba_maintenance_runs
      ORDER BY created_at DESC
      LIMIT 1`,
  );
  return rows[0] ?? null;
}

router.get("/current-update", async (_req, res): Promise<void> => {
  const current = await latestMaintenanceRun();
  res.json({ update: current, mergeReady: current?.status === "merge_ready" && Boolean(current.pr_number) });
});

router.post("/run-now", requireConfirmation, async (_req, res): Promise<void> => {
  const result = await runWeeklyMaintenanceNow("admin_manual");
  res.status(result.ok ? 202 : 400).json(result);
});

router.get("/runs", async (_req, res): Promise<void> => {
  await ensureTables();
  const { rows } = await pool.query(
    `SELECT id, run_key, status, repo_full_name, base_branch, self_repair_run_id,
            pr_number, pr_url, checkpoint_id, notification_status, metadata,
            created_at, updated_at
       FROM viba_maintenance_runs
      ORDER BY created_at DESC
      LIMIT 50`,
  );
  res.json({ runs: rows });
});

router.get("/runs/:id/events", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: "valid run id required" }); return; }
  await ensureTables();
  const { rows: runRows } = await pool.query<MaintenanceRow>(`SELECT self_repair_run_id FROM viba_maintenance_runs WHERE id = $1 LIMIT 1`, [id]);
  const repairRunId = runRows[0]?.self_repair_run_id;
  if (!repairRunId) { res.json({ events: [] }); return; }
  const { rows } = await pool.query(
    `SELECT id, run_id, event_type, severity, status, message, metadata, created_at
       FROM viba_self_repair_events
      WHERE run_id = $1
      ORDER BY created_at ASC`,
    [repairRunId],
  );
  res.json({ events: rows });
});

router.post("/merge-current-update", requireConfirmation, async (_req, res): Promise<void> => {
  await ensureTables();
  const current = await latestMaintenanceRun();
  if (!current) { res.status(404).json({ error: "No maintenance update found." }); return; }
  if (current.status !== "merge_ready" || !current.pr_number) {
    res.status(409).json({ error: "Current update is not merge-ready.", current });
    return;
  }

  const token = await githubToken();
  const pr = await gh<PullRequestInfo>(token, `/repos/${current.repo_full_name}/pulls/${current.pr_number}`);
  if (pr.merged || pr.state !== "open") {
    res.status(409).json({ error: "PR is not open and mergeable from this dashboard.", pr });
    return;
  }
  if (pr.base.repo.full_name !== current.repo_full_name || pr.base.ref !== current.base_branch) {
    res.status(409).json({ error: "PR base does not match the maintenance run.", pr });
    return;
  }

  const sandbox = await verifyRepoInSandbox({ repoFullName: pr.head.repo.full_name, branch: pr.head.ref, githubToken: token });
  if (!sandbox.ok) {
    await pool.query(`UPDATE viba_maintenance_runs SET status = 'merge_blocked', metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2`, [JSON.stringify({ mergeBlockedReason: "sandbox_failed", sandbox }), current.id]);
    res.status(400).json({ ok: false, blocked: true, reason: "sandbox_failed", sandbox });
    return;
  }

  const checkpoint = await createCheckpoint({ token, repo: current.repo_full_name, branch: current.base_branch, reason: "before_admin_merge_current_update", metadata: { maintenanceRunId: current.id, prNumber: current.pr_number } });
  const merge = await gh(token, `/repos/${current.repo_full_name}/pulls/${current.pr_number}/merge`, {
    method: "PUT",
    body: JSON.stringify({ merge_method: "squash", commit_title: `Merge VIBA weekly maintenance update #${current.pr_number}` }),
  });

  await pool.query(
    `UPDATE viba_maintenance_runs
        SET status = 'merged', checkpoint_id = $1, metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
      WHERE id = $3`,
    [checkpoint.id ?? null, JSON.stringify({ adminMergedAt: new Date().toISOString(), merge, sandbox }), current.id],
  );

  res.json({ ok: true, updateId: current.id, checkpoint, merge });
});

export default router;
