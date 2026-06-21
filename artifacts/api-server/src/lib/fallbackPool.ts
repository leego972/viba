import { pool, type Agent, type Task } from "@workspace/db";
import { logVibaEvent } from "./vibaVault";

export type FallbackReason =
  | "quota_exhausted"
  | "rate_limited"
  | "timeout"
  | "provider_unavailable"
  | "model_unavailable"
  | "context_limit"
  | "tool_error"
  | "unknown_error";

const PROVIDER_COOLDOWN_MINUTES = Number(process.env.VIBA_PROVIDER_COOLDOWN_MINUTES ?? "15");
const MAX_ATTEMPTS_PER_TASK = Number(process.env.VIBA_MAX_FALLBACK_ATTEMPTS ?? "3");

export async function ensureFallbackPoolTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_provider_health (
      id SERIAL PRIMARY KEY,
      session_id INTEGER,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'healthy',
      reason TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      cooldown_until TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (session_id, provider)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_task_fallbacks (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      from_agent_id INTEGER,
      from_provider TEXT,
      to_agent_id INTEGER,
      to_provider TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'returned_to_pool',
      partial_work TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export function classifyFallbackReason(error: unknown): FallbackReason {
  const text = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : String(error ?? "").toLowerCase();
  if (text.includes("quota") || text.includes("credit") || text.includes("insufficient") || text.includes("billing")) return "quota_exhausted";
  if (text.includes("rate") || text.includes("429")) return "rate_limited";
  if (text.includes("timeout") || text.includes("timed out") || text.includes("step_timeout")) return "timeout";
  if (text.includes("model") && (text.includes("not found") || text.includes("unavailable"))) return "model_unavailable";
  if (text.includes("context") || text.includes("token limit") || text.includes("maximum context")) return "context_limit";
  if (text.includes("tool")) return "tool_error";
  if (text.includes("unavailable") || text.includes("503") || text.includes("502") || text.includes("500")) return "provider_unavailable";
  return "unknown_error";
}

export async function markProviderDegraded(input: {
  sessionId: number;
  provider: string;
  reason: FallbackReason | string;
  error?: string;
}): Promise<void> {
  await ensureFallbackPoolTables();
  await pool.query(
    `INSERT INTO viba_provider_health
      (session_id, provider, status, reason, failure_count, cooldown_until, last_error, updated_at)
     VALUES ($1, $2, 'degraded', $3, 1, NOW() + ($4 || ' minutes')::interval, $5, NOW())
     ON CONFLICT (session_id, provider)
     DO UPDATE SET status = 'degraded',
                   reason = EXCLUDED.reason,
                   failure_count = viba_provider_health.failure_count + 1,
                   cooldown_until = EXCLUDED.cooldown_until,
                   last_error = EXCLUDED.last_error,
                   updated_at = NOW()`,
    [input.sessionId, input.provider, input.reason, PROVIDER_COOLDOWN_MINUTES, input.error ?? null],
  );
}

export async function markProviderHealthy(input: { sessionId: number; provider: string }): Promise<void> {
  await ensureFallbackPoolTables();
  await pool.query(
    `INSERT INTO viba_provider_health
      (session_id, provider, status, reason, failure_count, cooldown_until, last_error, updated_at)
     VALUES ($1, $2, 'healthy', NULL, 0, NULL, NULL, NOW())
     ON CONFLICT (session_id, provider)
     DO UPDATE SET status = 'healthy', reason = NULL, cooldown_until = NULL, last_error = NULL, updated_at = NOW()`,
    [input.sessionId, input.provider],
  );
}

export async function fallbackEligibleAgents(input: {
  sessionId: number;
  taskId: number;
  agents: Agent[];
}): Promise<Agent[]> {
  await ensureFallbackPoolTables();
  if (!input.agents.length) return [];

  const { rows: degradedRows } = await pool.query<{ provider: string }>(
    `SELECT provider FROM viba_provider_health
      WHERE session_id = $1
        AND status = 'degraded'
        AND cooldown_until IS NOT NULL
        AND cooldown_until > NOW()`,
    [input.sessionId],
  );
  const degraded = new Set(degradedRows.map((r) => r.provider.toLowerCase()));

  const { rows: failedRows } = await pool.query<{ from_agent_id: number | null }>(
    `SELECT from_agent_id FROM viba_task_fallbacks
      WHERE session_id = $1
        AND task_id = $2
        AND from_agent_id IS NOT NULL
      GROUP BY from_agent_id
      HAVING COUNT(*) >= $3`,
    [input.sessionId, input.taskId, MAX_ATTEMPTS_PER_TASK],
  );
  const exhaustedAgents = new Set(failedRows.map((r) => r.from_agent_id).filter((id): id is number => typeof id === "number"));

  return input.agents.filter((agent) => {
    if (degraded.has(agent.provider.toLowerCase())) return false;
    if (exhaustedAgents.has(agent.id)) return false;
    return true;
  });
}

export async function returnTaskToPool(input: {
  sessionId: number;
  task: Task;
  agent: Agent;
  reason: FallbackReason | string;
  partialWork?: string | null;
  error?: string | null;
}): Promise<{ taskReturned: Task | null; alternativeAvailable: boolean }> {
  await ensureFallbackPoolTables();
  await markProviderDegraded({ sessionId: input.sessionId, provider: input.agent.provider, reason: input.reason, error: input.error ?? undefined });

  const { rows: attemptRows } = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM viba_task_fallbacks WHERE session_id = $1 AND task_id = $2`,
    [input.sessionId, input.task.id],
  );
  const attemptCount = attemptRows[0]?.count ?? 0;

  const finalFailure = attemptCount + 1 >= MAX_ATTEMPTS_PER_TASK;
  const newStatus = finalFailure ? "review" : "planned";
  const blockedReason = finalFailure
    ? `All fallback attempts exhausted. Last reason: ${input.reason}`
    : `Returned to fallback pool. Reason: ${input.reason}`;

  const { rows: taskRows } = await pool.query<Task>(
    `UPDATE tasks
        SET status = $1,
            assigned_agent_id = NULL,
            blocked_reason = $2,
            partial_work = COALESCE(partial_work || E'\n\n', '') || COALESCE($3, ''),
            updated_at = NOW()
      WHERE id = $4
      RETURNING *`,
    [newStatus, blockedReason, input.partialWork ?? "", input.task.id],
  );

  await pool.query(
    `INSERT INTO viba_task_fallbacks
      (session_id, task_id, from_agent_id, from_provider, reason, status, partial_work)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.sessionId, input.task.id, input.agent.id, input.agent.provider, input.reason, finalFailure ? "failed_final" : "returned_to_pool", input.partialWork ?? null],
  );

  await logVibaEvent({
    sessionId: input.sessionId,
    eventType: finalFailure ? "all_providers_failed" : "task_returned_to_pool",
    severity: finalFailure ? "high" : "medium",
    provider: input.agent.provider,
    subject: input.task.title,
    status: finalFailure ? "failed_final" : "returned_to_pool",
    message: finalFailure
      ? `Fallback attempts exhausted for ${input.task.title}.`
      : `${input.agent.name} could not continue. Task returned to fallback pool.`,
    metadata: { taskId: input.task.id, agentId: input.agent.id, reason: input.reason, attemptCount: attemptCount + 1 },
  });

  return { taskReturned: taskRows[0] ?? null, alternativeAvailable: !finalFailure };
}

export async function fallbackStatus(sessionId: number): Promise<Record<string, unknown>> {
  await ensureFallbackPoolTables();
  const { rows: providers } = await pool.query(
    `SELECT provider, status, reason, failure_count, cooldown_until, last_error, updated_at
       FROM viba_provider_health
      WHERE session_id = $1
      ORDER BY updated_at DESC`,
    [sessionId],
  );
  const { rows: events } = await pool.query(
    `SELECT task_id, from_agent_id, from_provider, reason, status, created_at
       FROM viba_task_fallbacks
      WHERE session_id = $1
      ORDER BY created_at DESC
      LIMIT 100`,
    [sessionId],
  );
  return { providers, events };
}
