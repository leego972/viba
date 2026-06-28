import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logVibaEvent, resolveVibaCredential } from "../lib/vibaVault";
import { verifyRepoInSandbox } from "../lib/selfRepairSandbox";

const router: IRouter = Router();

type ReqWithSession = { session?: { userId?: number } };
type GitHubRef = { object: { sha: string } };
type PullRequestInfo = {
  number: number;
  head: { ref: string; repo: { full_name: string } };
  base: { ref: string; repo: { full_name: string } };
};

function userId(req: ReqWithSession): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function repoFromBody(body: unknown): string {
  const repo = typeof (body as { repoFullName?: unknown })?.repoFullName === "string"
    ? String((body as { repoFullName: string }).repoFullName).trim()
    : process.env.VIBA_SELF_REPO || process.env.GITHUB_REPOSITORY || "leego972/viba";
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
    "User-Agent": "VIBA-Self-Audit-Safety/1.0",
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
    CREATE TABLE IF NOT EXISTS viba_self_sandbox_runs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      repo_full_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      status TEXT NOT NULL,
      result JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
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

router.post("/self-audit/sandbox-build", async (req, res): Promise<void> => {
  const uid = userId(req);
  try {
    await ensureTables();
    const repo = repoFromBody(req.body ?? {});
    const branch = branchFromBody(req.body ?? {});
    const token = await githubToken(uid);
    const result = await verifyRepoInSandbox({ repoFullName: repo, branch, githubToken: token });
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO viba_self_sandbox_runs (user_id, repo_full_name, branch, status, result) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [uid, repo, branch, result.ok ? "passed" : "failed", JSON.stringify(result)],
    );
    await logVibaEvent({ userId: uid, eventType: result.ok ? "sandbox_build_passed" : "sandbox_build_failed", provider: "sandbox", subject: repo, status: result.ok ? "passed" : "failed", severity: result.ok ? "info" : "high", message: result.ok ? `Sandbox build passed for ${repo}@${branch}.` : `Sandbox build failed for ${repo}@${branch}.`, metadata: { sandboxRunId: inserted.rows[0]?.id, branch, error: result.error } });
    res.status(result.ok ? 200 : 400).json({ ok: result.ok, sandboxRunId: inserted.rows[0]?.id, result });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : "Sandbox build failed." });
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
    const baseBranch = branchFromBody(body);
    const prNumber = Number(body.prNumber);
    if (!Number.isFinite(prNumber) || prNumber <= 0) throw new Error("prNumber required");

    const token = await githubToken(uid);
    const pr = await gh<PullRequestInfo>(token, `/repos/${repo}/pulls/${prNumber}`);
    if (pr.base.repo.full_name !== repo || pr.base.ref !== baseBranch) throw new Error("PR base does not match requested repo/branch.");

    const sandbox = await verifyRepoInSandbox({ repoFullName: pr.head.repo.full_name, branch: pr.head.ref, githubToken: token });
    const sandboxRun = await pool.query<{ id: number }>(
      `INSERT INTO viba_self_sandbox_runs (user_id, repo_full_name, branch, status, result) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [uid, pr.head.repo.full_name, pr.head.ref, sandbox.ok ? "passed" : "failed", JSON.stringify(sandbox)],
    );

    if (!sandbox.ok) {
      await logVibaEvent({ userId: uid, eventType: "self_merge_blocked_sandbox_failed", provider: "sandbox", subject: repo, status: "blocked", severity: "high", message: `Merge blocked. Sandbox build failed for PR #${prNumber}.`, metadata: { prNumber, sandboxRunId: sandboxRun.rows[0]?.id, error: sandbox.error } });
      res.status(400).json({ ok: false, blocked: true, reason: "sandbox_build_failed", sandboxRunId: sandboxRun.rows[0]?.id, sandbox });
      return;
    }

    const checkpoint = await createCheckpoint({ token, userId: uid, repo, branch: baseBranch, reason: "before_self_repair_merge", metadata: { prNumber, sandboxRunId: sandboxRun.rows[0]?.id, headRepo: pr.head.repo.full_name, headBranch: pr.head.ref } });
    const merge = await gh(token, `/repos/${repo}/pulls/${prNumber}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash", commit_title: `Merge VIBA self-repair PR #${prNumber}` }) });
    await logVibaEvent({ userId: uid, eventType: "self_repair_merged", provider: "github", subject: repo, status: "merged", message: `Self-repair PR #${prNumber} merged after sandbox verification and checkpoint.`, metadata: { checkpointId: checkpoint.id, sandboxRunId: sandboxRun.rows[0]?.id, prNumber, merge } });
    res.json({ ok: true, sandboxRunId: sandboxRun.rows[0]?.id, sandbox, checkpoint, merge });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : "Merge request failed." });
  }
});

export default router;
