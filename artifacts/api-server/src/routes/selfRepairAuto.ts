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
  if (!resolved.value) throw new Error("Missing GITHUB_TOKEN. Add it before self-repair can use GitHub.");
  return resolved.value;
}

async function groqToken(userIdValue: number | null): Promise<string> {
  const resolved = await resolveVibaCredential({ userId: userIdValue, provider: "groq", kind: "token", envNames: ["GROQ_API_KEY"] });
  if (!resolved.value) throw new Error("Missing GROQ_API_KEY. VIBA needs Groq to generate self-repair patches.");
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
  return { id: rows[0]?.id, headSha: sha };
}

function validateChange(change: FileChange): void {
  if (!change.path || typeof change.path !== "string") throw new Error("change.path required");
  if (typeof change.content !== "string") throw new Error(`change.content required for ${change.path}`);
  if (FORBIDDEN_CHANGE_PATTERNS.some((pattern) => pattern.test(change.path))) throw new Error(`Refusing unsafe path: ${change.path}`);
  if (!SAFE_CHANGE_PREFIXES.some((prefix) => change.path.startsWith(prefix))) throw new Error(`Path outside safe repair prefixes: ${change.path}`);
}

async function fetchFile(token: string, repo: string, branch: string, path: string): Promise<{ content: string | null; sha?: string }> {
  try {
    const existing = await gh<{ sha?: string; content?: string; encoding?: string }>(token, `/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`);
    const content = existing.encoding === "base64" && existing.content ? Buffer.from(existing.content, "base64").toString("utf8") : null;
    return { content, sha: existing.sha };
  } catch {
    return { content: null };
  }
}

async function upsertFile(token: string, repo: string, branch: string, change: FileChange): Promise<void> {
  validateChange(change);
  const existing = await fetchFile(token, repo, branch, change.path);
  await gh(token, `/repos/${repo}/contents/${encodeURIComponent(change.path).replace(/%2F/g, "/")}`, {
    method: "PUT",
    body: JSON.stringify({
      message: change.message ?? `VIBA self-repair: update ${change.path}`,
      content: Buffer.from(change.content, "utf8").toString("base64"),
      branch,
      sha: existing.sha,
    }),
  });
}

function failureLog(result: SandboxVerificationResult): string {
  return result.steps.map((step) => `COMMAND: ${step.command}\nEXIT: ${step.exitCode}\nTIMEOUT: ${step.timedOut}\n${step.output}`).join("\n\n---\n\n").slice(-30_000);
}

function candidatePathsFromFailure(result: SandboxVerificationResult): string[] {
  const text = failureLog(result);
  const paths = new Set<string>();
  const regex = /((?:artifacts|lib|docs|\.github)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) && paths.size < 12) paths.add(match[1]);
  for (const fallback of [
    "artifacts/api-server/src/routes/index.ts",
    "artifacts/api-server/src/routes/selfAuditMergeSafety.ts",
    "artifacts/api-server/src/routes/selfAudit.ts",
    "artifacts/api-server/src/lib/selfRepairSandbox.ts",
    "artifacts/bridge-ai/src/pages/session-workspace.tsx",
    "package.json",
  ]) {
    if (paths.size < 16) paths.add(fallback);
  }
  return [...paths];
}

async function generateRepairProposal(input: { groqKey: string; failure: SandboxVerificationResult; files: CandidateFile[]; goal: string }): Promise<RepairProposal> {
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const prompt = `You are VIBA's self-repair backend. Fix the build/typecheck failure. Return ONLY JSON with this exact shape: {"summary":"...","changes":[{"path":"...","content":"full replacement file content","message":"..."}],"notes":["..."]}. Rules: only modify files provided below or safe project source/docs files; do not include secrets; do not delete files; keep changes minimal.\n\nGoal:\n${input.goal}\n\nFailure log:\n${failureLog(input.failure)}\n\nCandidate files:\n${input.files.map((f) => `FILE: ${f.path}\n${f.content ?? "[missing or unreadable]"}`).join("\n\n---\n\n")}`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.groqKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return strict JSON only. No markdown." },
        { role: "user", content: prompt },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Groq repair generation failed: HTTP ${response.status}`);
  const content = (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned no repair proposal.");
  const parsed = JSON.parse(content) as RepairProposal;
  if (!Array.isArray(parsed.changes) || parsed.changes.length === 0) throw new Error("Repair proposal contained no file changes.");
  parsed.changes.forEach(validateChange);
  return parsed;
}

router.post("/self-repair/auto-fix", async (req, res): Promise<void> => {
  const uid = userId(req);
  try {
    await ensureTables();
    const body = req.body as { repoFullName?: unknown; branch?: unknown; maxIterations?: unknown; goal?: unknown; confirm?: unknown; createPr?: unknown };
    if (body.confirm !== true) throw new Error("confirm=true required to start an automatic self-repair loop.");
    const repo = repoFromBody(body);
    const baseBranch = branchFromBody(body);
    const maxIterations = Math.min(Math.max(Number(body.maxIterations ?? DEFAULT_MAX_ITERATIONS), 1), 8);
    const goal = typeof body.goal === "string" && body.goal.trim() ? body.goal.trim() : "Repair VIBA until pnpm install, typecheck, and build pass in sandbox.";
    const createPr = body.createPr !== false;
    const token = await githubToken(uid);
    const groqKey = await groqToken(uid);
    const baseSha = await currentHeadSha(token, repo, baseBranch);
    const repairBranch = `viba/auto-repair-${Date.now()}`;
    await ensureBranch(token, repo, repairBranch, baseSha);
    const run = await pool.query<{ id: number }>(
      `INSERT INTO viba_self_repair_runs (user_id, repo_full_name, base_branch, repair_branch, status, max_iterations)
       VALUES ($1, $2, $3, $4, 'running', $5) RETURNING id`,
      [uid, repo, baseBranch, repairBranch, maxIterations],
    );
    const runId = run.rows[0]!.id;
    await repairEvent({ runId, userId: uid, eventType: "self_repair_started", status: "running", message: `Self-repair started on ${repo}:${repairBranch}.`, metadata: { repo, baseBranch, repairBranch, maxIterations } });

    let lastSandbox: SandboxVerificationResult | null = null;
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      await pool.query(`UPDATE viba_self_repair_runs SET current_iteration = $1, updated_at = NOW() WHERE id = $2`, [iteration, runId]);
      await repairEvent({ runId, userId: uid, eventType: "sandbox_verification_started", status: "running", message: `Sandbox verification attempt ${iteration}/${maxIterations} started.`, metadata: { iteration, repairBranch } });

      const sandbox = await verifyRepoInSandbox({ repoFullName: repo, branch: repairBranch, githubToken: token });
      lastSandbox = sandbox;
      await repairEvent({ runId, userId: uid, eventType: sandbox.ok ? "sandbox_build_passed" : "sandbox_build_failed", severity: sandbox.ok ? "info" : "high", status: sandbox.ok ? "passed" : "failed", message: sandbox.ok ? `Sandbox build passed on attempt ${iteration}.` : `Sandbox build failed on attempt ${iteration}; generating repair patch.`, metadata: { iteration, steps: sandbox.steps.map((s) => ({ command: s.command, exitCode: s.exitCode, timedOut: s.timedOut, output: s.output.slice(-3000) })), error: sandbox.error } });

      if (sandbox.ok) {
        const checkpoint = await createCheckpoint({ token, userId: uid, repo, branch: baseBranch, reason: "before_auto_self_repair_pr_or_merge", metadata: { runId, repairBranch, iteration } });
        let pr: { number: number; html_url: string } | null = null;
        if (createPr) {
          pr = await gh<{ number: number; html_url: string }>(token, `/repos/${repo}/pulls`, {
            method: "POST",
            body: JSON.stringify({
              title: "VIBA automatic self-repair proposal",
              head: repairBranch,
              base: baseBranch,
              body: `Sandbox install/typecheck/build passed on attempt ${iteration}. Checkpoint ${checkpoint.id} saved before PR. Owner approval required before merge/deploy.`,
            }),
          });
        }
        await pool.query(`UPDATE viba_self_repair_runs SET status = 'passed', checkpoint_id = $1, final_pr_number = $2, final_pr_url = $3, updated_at = NOW() WHERE id = $4`, [checkpoint.id ?? null, pr?.number ?? null, pr?.html_url ?? null, runId]);
        await repairEvent({ runId, userId: uid, eventType: "self_repair_passed", status: "passed", message: pr ? `Self-repair passed and PR #${pr.number} was created.` : "Self-repair passed; PR creation skipped by request.", metadata: { checkpoint, pr } });
        res.status(201).json({ ok: true, runId, status: "passed", checkpoint, pr, sandbox });
        return;
      }

      const files = await Promise.all(candidatePathsFromFailure(sandbox).map(async (path) => ({ path, content: (await fetchFile(token, repo, repairBranch, path)).content })));
      await repairEvent({ runId, userId: uid, eventType: "repair_generation_started", status: "running", message: `Generating repair patch for attempt ${iteration}.`, metadata: { files: files.map((f) => f.path) } });
      const proposal = await generateRepairProposal({ groqKey, failure: sandbox, files, goal });
      await repairEvent({ runId, userId: uid, eventType: "repair_patch_generated", status: "generated", message: proposal.summary ?? `Generated ${proposal.changes?.length ?? 0} repair change(s).`, metadata: { iteration, changedPaths: proposal.changes?.map((c) => c.path), notes: proposal.notes ?? [] } });
      for (const change of proposal.changes ?? []) {
        await upsertFile(token, repo, repairBranch, change);
        await repairEvent({ runId, userId: uid, eventType: "repair_patch_applied", status: "applied", message: `Applied repair patch to ${change.path}.`, metadata: { path: change.path, iteration } });
      }
    }

    await pool.query(`UPDATE viba_self_repair_runs SET status = 'failed', updated_at = NOW() WHERE id = $1`, [runId]);
    await repairEvent({ runId, userId: uid, eventType: "self_repair_failed", severity: "high", status: "failed", message: `Self-repair stopped after ${maxIterations} attempts. Sandbox still failing.`, metadata: { lastSandbox } });
    res.status(400).json({ ok: false, runId, status: "failed", message: "Self-repair exhausted max attempts.", lastSandbox });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : "Automatic self-repair failed." });
  }
});

router.get("/self-repair/runs", async (req, res): Promise<void> => {
  const uid = userId(req);
  await ensureTables();
  const { rows } = await pool.query(
    `SELECT id, repo_full_name, base_branch, repair_branch, status, current_iteration, max_iterations, final_pr_number, final_pr_url, checkpoint_id, created_at, updated_at
       FROM viba_self_repair_runs
      WHERE user_id = $1 OR user_id IS NULL
      ORDER BY created_at DESC
      LIMIT 100`,
    [uid],
  );
  res.json({ runs: rows });
});

router.get("/self-repair/runs/:id/events", async (req, res): Promise<void> => {
  const uid = userId(req);
  const runId = Number(req.params.id);
  if (!Number.isFinite(runId) || runId <= 0) { res.status(400).json({ error: "valid run id required" }); return; }
  await ensureTables();
  const { rows } = await pool.query(
    `SELECT id, run_id, event_type, severity, status, message, metadata, created_at
       FROM viba_self_repair_events
      WHERE run_id = $1 AND (user_id = $2 OR user_id IS NULL)
      ORDER BY created_at ASC`,
    [runId, uid],
  );
  res.json({ events: rows });
});

export default router;
