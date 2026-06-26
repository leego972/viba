import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logVibaEvent, resolveVibaCredential } from "../lib/vibaVault";
import { verifyRepoInSandbox, type SandboxVerificationResult } from "../lib/selfRepairSandbox";

const router: IRouter = Router();

type ReqWithSession = { session?: { userId?: number } };
type GitHubRef = { object: { sha: string } };
type FileChange = { path: string; content: string; message?: string };
type CandidateFile = { path: string; content: string | null };
type RepairProposal = { summary?: string; changes?: FileChange[]; notes?: string[] };

const DEFAULT_SELF_REPO = process.env.VIBA_SELF_REPO || process.env.GITHUB_REPOSITORY || "leego972/viba";
const SAFE_CHANGE_PREFIXES = ["docs/", "artifacts/api-server/src/", "artifacts/bridge-ai/src/", "lib/api-zod/src/", "lib/api-client-react/src/", "lib/db/src/", ".github/workflows/"];
const FORBIDDEN_CHANGE_PATTERNS = [/\.env/i, /secret/i, /private/i, /node_modules\//, /pnpm-lock\.yaml$/, /package-lock\.json$/, /yarn\.lock$/];
const DEFAULT_MAX_ITERATIONS = Math.min(Math.max(Number(process.env.VIBA_SELF_REPAIR_MAX_ITERATIONS ?? 3), 1), 8);

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
    "User-Agent": "VIBA-Self-Repair-Auto/1.0",
  };
}

async function githubToken(userIdValue: number | null): Promise<string> {
  const resolved = await resolveVibaCredential({ userId: userIdValue, provider: "github", kind: "token", envNames: ["GITHUB_TOKEN"] });
  if (!resolved.value) throw new Error("Missing GITHUB_TOKEN. Add it before repository automation can use GitHub.");
  return resolved.value;
}

async function groqToken(userIdValue: number | null): Promise<string> {
  const resolved = await resolveVibaCredential({ userId: userIdValue, provider: "groq", kind: "token", envNames: ["GROQ_API_KEY"] });
  if (!resolved.value) throw new Error("Missing GROQ_API_KEY. VIBA needs Groq to generate repository patches.");
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
    CREATE TABLE IF NOT EXISTS viba_self_repair_runs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      repo_full_name TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      repair_branch TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      current_iteration INTEGER NOT NULL DEFAULT 0,
      max_iterations INTEGER NOT NULL DEFAULT 3,
      final_pr_number INTEGER,
      final_pr_url TEXT,
      checkpoint_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_self_repair_events (
      id SERIAL PRIMARY KEY,
      run_id INTEGER NOT NULL,
      user_id INTEGER,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      status TEXT NOT NULL DEFAULT 'created',
      message TEXT NOT NULL,
      metadata JSONB,
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_self_repair_events_run ON viba_self_repair_events (run_id, created_at ASC)`);
}

async function repairEvent(input: { runId: number; userId: number | null; eventType: string; severity?: string; status?: string; message: string; metadata?: Record<string, unknown> | null }): Promise<void> {
  await ensureTables();
  await pool.query(
    `INSERT INTO viba_self_repair_events (run_id, user_id, event_type, severity, status, message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.runId, input.userId, input.eventType, input.severity ?? "info", input.status ?? "created", input.message, input.metadata ? JSON.stringify(input.metadata) : null],
  );
  await logVibaEvent({ userId: input.userId, eventType: input.eventType, severity: input.severity ?? "info", provider: "self_repair", status: input.status ?? "created", message: input.message, metadata: { runId: input.runId, ...(input.metadata ?? {}) } });
}

async function currentHeadSha(token: string, repo: string, branch: string): Promise<string> {
  const ref = await gh<GitHubRef>(token, `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  return ref.object.sha;
}

async function ensureBranch(token: string, repo: string, branchName: string, fromSha: string): Promise<void> {
  try {
    await gh(token, `/repos/${repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }) });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.toLowerCase().includes("reference already exists")) throw error;
  }
}

async function createCheckpoint(input: { token: string; userId: number | null; repo: string; branch: string; reason: string; metadata?: Record<string, unknown> }) {
  const sha = await currentHeadSha(input.token, input.repo, input.branch);
  const { rows } = await pool.query<{ id: number; head_sha: string }>(
    `INSERT INTO viba_self_checkpoints (user_id, repo_full_name, branch, head_sha, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, head_sha`,
    [input.userId, input.repo, input.branch, sha, input.reason, JSON.stringify(input.metadata ?? {})],
  );
  return rows[0];
}
