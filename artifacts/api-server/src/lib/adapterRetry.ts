import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from "./adapters/interface";
import { isPermanentError } from "./adapters/errors";
import { logger } from "./logger";

export interface RetryContext {
  sessionId: number;
  agentId: number | string;
  provider: string;
  taskId: number;
  taskTitle: string;
}

export type LogAuditFn = (
  eventType: string,
  description: string,
  metadata?: Record<string, unknown>
) => Promise<void>;

export interface AdapterRetryResult {
  result: AgentTaskResult;
  usedFallback: boolean;
  usedModel: string;
  successAttempt: number | null;
  circuitOpen?: boolean;
}

// ── Circuit breaker ────────────────────────────────────────────────────────────
// Per-provider state. The in-memory map is a short-lived cache (TTL = 30 s).
// The database is the source of truth. Before any circuit check the cache is
// revalidated from the DB if it is stale, which allows multiple API server
// instances to share circuit state correctly.

function parsePositiveInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === "") return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

const CIRCUIT_OPEN_THRESHOLD = parsePositiveInt(process.env.CIRCUIT_OPEN_THRESHOLD, 5);
const CIRCUIT_TIMEOUT_MS = parsePositiveInt(process.env.CIRCUIT_TIMEOUT_MS, 5 * 60 * 1000);
const CACHE_TTL_MS = 30_000; // 30 seconds — max staleness across instances

// Startup validation: warn if an env var was set but is not a valid positive integer
// (parsePositiveInt silently falls back to the default, so this makes it visible)
if (process.env.CIRCUIT_OPEN_THRESHOLD !== undefined && process.env.CIRCUIT_OPEN_THRESHOLD !== "") {
  const _raw = parseInt(process.env.CIRCUIT_OPEN_THRESHOLD, 10);
  if (!Number.isFinite(_raw) || _raw <= 0) {
    logger.warn(
      { value: process.env.CIRCUIT_OPEN_THRESHOLD, fallback: 5 },
      "CIRCUIT_OPEN_THRESHOLD env var is invalid; using default of 5"
    );
  }
}
if (process.env.CIRCUIT_TIMEOUT_MS !== undefined && process.env.CIRCUIT_TIMEOUT_MS !== "") {
  const _raw = parseInt(process.env.CIRCUIT_TIMEOUT_MS, 10);
  if (!Number.isFinite(_raw) || _raw <= 0) {
    logger.warn(
      { value: process.env.CIRCUIT_TIMEOUT_MS, fallback: 5 * 60 * 1000 },
      "CIRCUIT_TIMEOUT_MS env var is invalid; using default of 300000ms"
    );
  }
}

// Internal state kept in the map; cachedAt is not part of the public interface.
interface InternalCircuitState {
  consecutiveFailures: number;
  openedAt: number | null; // Unix ms timestamp, or null when closed
  cachedAt: number;        // when the entry was last read from / written to DB
}

export interface CircuitState {
  consecutiveFailures: number;
  openedAt: number | null;
}

const circuitMap = new Map<string, InternalCircuitState>();

function getOrCreateLocal(provider: string): InternalCircuitState {
  let state = circuitMap.get(provider);
  if (!state) {
    // cachedAt=0 forces a DB read-through on the next check
    state = { consecutiveFailures: 0, openedAt: null, cachedAt: 0 };
    circuitMap.set(provider, state);
  }
  return state;
}

/**
 * Revalidate a single provider's circuit state from the database when the
 * in-memory entry is older than CACHE_TTL_MS. Skips silently if the DB is
 * unavailable (e.g. in tests without DATABASE_URL) and updates cachedAt so
 * the next in-window call doesn't hammer the DB.
 */
async function refreshCircuitFromDb(provider: string, now = Date.now()): Promise<void> {
  const state = circuitMap.get(provider);
  if (state && now - state.cachedAt < CACHE_TTL_MS) return; // cache is fresh

  try {
    const [{ db, circuitStateTable }, { eq }] = await Promise.all([
      import("@workspace/db"),
      import("drizzle-orm"),
    ]);

    const rows = await db
      .select()
      .from(circuitStateTable)
      .where(eq(circuitStateTable.provider, provider));

    if (rows.length > 0) {
      const row = rows[0]!;
      circuitMap.set(provider, {
        consecutiveFailures: row.consecutiveFailures,
        openedAt: row.openedAt !== null ? row.openedAt.getTime() : null,
        cachedAt: now,
      });
    } else {
      // No DB row yet for this provider — mark the cache as fresh so we
      // don't hit the DB again until the next TTL window expires.
      // (We do not zero out existing local state here, because a missing row
      // can also mean the initial persist has not run yet rather than a
      // deliberate reset.)
      const existing = getOrCreateLocal(provider);
      existing.cachedAt = now;
    }
  } catch (err) {
    logger.warn({ err, provider }, "Failed to refresh circuit state from DB");
    // Update cachedAt even on failure to avoid hammering the DB
    const existing = getOrCreateLocal(provider);
    existing.cachedAt = now;
  }
}

/**
 * Upsert a single provider's circuit state into the database.
 * Uses a dynamic import so the module can be loaded in test environments
 * that do not have DATABASE_URL set — failures are logged and swallowed.
 */
async function persistCircuitState(
  provider: string,
  state: InternalCircuitState,
): Promise<void> {
  try {
    const { db, circuitStateTable } = await import("@workspace/db");
    await db
      .insert(circuitStateTable)
      .values({
        provider,
        consecutiveFailures: state.consecutiveFailures,
        openedAt: state.openedAt !== null ? new Date(state.openedAt) : null,
      })
      .onConflictDoUpdate({
        target: circuitStateTable.provider,
        set: {
          consecutiveFailures: state.consecutiveFailures,
          openedAt: state.openedAt !== null ? new Date(state.openedAt) : null,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    logger.warn({ err, provider }, "Failed to persist circuit state to DB");
  }
}

/**
 * Load all circuit breaker state from the database into the in-memory map.
 * Call once at server startup so the server resumes from the last known state
 * rather than starting with all circuits closed. If the DB is unavailable,
 * logs a warning and continues with a clean (all-closed) state.
 */
export async function loadCircuitStateFromDb(): Promise<void> {
  try {
    const { db, circuitStateTable } = await import("@workspace/db");
    const rows = await db.select().from(circuitStateTable);
    const now = Date.now();
    for (const row of rows) {
      circuitMap.set(row.provider, {
        consecutiveFailures: row.consecutiveFailures,
        openedAt: row.openedAt !== null ? row.openedAt.getTime() : null,
        cachedAt: now,
      });
    }
    logger.info({ count: rows.length }, "Loaded circuit breaker state from DB");
  } catch (err) {
    logger.warn({ err }, "Failed to load circuit state from DB — starting with empty state");
  }
}

/** Synchronous check using the current in-memory cache. Always call
 *  refreshCircuitFromDb() first when multi-instance correctness matters. */
export function isCircuitOpen(provider: string, now = Date.now()): boolean {
  const state = circuitMap.get(provider);
  if (!state || state.openedAt === null) return false;
  return now - state.openedAt < CIRCUIT_TIMEOUT_MS;
}

async function recordSuccess(provider: string, now = Date.now()): Promise<void> {
  const state = getOrCreateLocal(provider);
  state.consecutiveFailures = 0;
  state.openedAt = null;
  state.cachedAt = now;
  await persistCircuitState(provider, state);
}

async function recordFailure(provider: string, now = Date.now()): Promise<void> {
  const state = getOrCreateLocal(provider);
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD) {
    const alreadyOpen =
      state.openedAt !== null && now - state.openedAt < CIRCUIT_TIMEOUT_MS;
    if (!alreadyOpen) {
      const isReopen = state.openedAt !== null;
      state.openedAt = now;
      logger.warn(
        { provider, failures: state.consecutiveFailures },
        isReopen
          ? "Circuit breaker re-opened after failed half-open probe"
          : "Circuit breaker opened for provider"
      );
    }
  }
  state.cachedAt = now;
  await persistCircuitState(provider, state);
}

/** Exposed for tests only — resets all in-memory circuit state. */
export function resetAllCircuits(): void {
  circuitMap.clear();
}

/**
 * Manually reset a single provider's circuit breaker to closed state.
 * Clears both the in-memory cache and the persisted DB row so the reset
 * survives restarts and is visible to all running instances within one TTL.
 */
export async function resetProviderCircuit(provider: string): Promise<void> {
  const now = Date.now();
  const state = getOrCreateLocal(provider);
  state.consecutiveFailures = 0;
  state.openedAt = null;
  state.cachedAt = now;
  await persistCircuitState(provider, state);
  logger.info({ provider }, "Circuit breaker manually reset by operator");
}

export interface CircuitStatusEntry {
  provider: string;
  state: "open" | "half-open" | "closed";
  consecutiveFailures: number;
  openedAt: number | null;
  msUntilReset: number | null;
}

/**
 * Returns the current circuit breaker state for every provider that has ever
 * been seen. Providers with no recorded failures are omitted.
 */
export function getCircuitStatus(now = Date.now()): CircuitStatusEntry[] {
  const entries: CircuitStatusEntry[] = [];

  for (const [provider, cs] of circuitMap.entries()) {
    if (cs.consecutiveFailures === 0 && cs.openedAt === null) continue;

    let state: "open" | "half-open" | "closed";
    let msUntilReset: number | null = null;

    if (cs.openedAt === null) {
      state = "closed";
    } else if (now - cs.openedAt < CIRCUIT_TIMEOUT_MS) {
      state = "open";
      msUntilReset = CIRCUIT_TIMEOUT_MS - (now - cs.openedAt);
    } else {
      state = "half-open";
      msUntilReset = 0;
    }

    entries.push({
      provider,
      state,
      consecutiveFailures: cs.consecutiveFailures,
      openedAt: cs.openedAt,
      msUntilReset,
    });
  }

  return entries;
}

// ── Main retry function ────────────────────────────────────────────────────────

/**
 * Attempts to run the task using the live adapter up to 2 times.
 * Permanent errors (401/403/invalid API key) skip the retry immediately.
 * If the provider's circuit breaker is open (5+ consecutive failures in 5 min),
 * the live call is bypassed entirely and simulation is used straight away.
 * If all live attempts fail, falls back to the mock adapter.
 *
 * Before the circuit check, the per-provider cache is revalidated from the DB
 * if it is stale (>30 s), so multiple API instances share circuit state.
 *
 * Accepts injectable factory functions and an audit-log callback so the
 * function can be tested without touching the database.
 */
export async function runAdapterWithRetry(params: {
  buildLiveAdapter: () => Promise<AgentAdapter>;
  buildFallbackAdapter: () => AgentAdapter;
  taskInput: AgentTaskInput;
  retryDelayMs: number;
  logAudit: LogAuditFn;
  context: RetryContext;
}): Promise<AdapterRetryResult> {
  const { buildLiveAdapter, buildFallbackAdapter, taskInput, retryDelayMs, logAudit, context } =
    params;

  // Revalidate cache from DB so this instance sees state from other instances.
  await refreshCircuitFromDb(context.provider);

  // Circuit breaker short-circuit — skip live call entirely when open
  if (isCircuitOpen(context.provider)) {
    logger.warn(
      { provider: context.provider, agentId: context.agentId },
      "Circuit breaker open — skipping live adapter, falling back to simulation"
    );
    await logAudit(
      "adapter_fallback",
      `Circuit open for ${context.provider} — skipping live call, falling back to simulation for task "${context.taskTitle}"`,
      {
        taskId: context.taskId,
        agentId: context.agentId,
        provider: context.provider,
        permanent: false,
        circuitOpen: true,
      }
    );
    const fallback = buildFallbackAdapter();
    const result = await fallback.runTask(taskInput);
    return {
      result,
      usedFallback: true,
      usedModel: fallback.model,
      successAttempt: null,
      circuitOpen: true,
    };
  }

  let result: AgentTaskResult | null = null;
  let usedFallback = false;
  let lastLiveError: unknown = null;
  let successAttempt: number | null = null;
  let usedModel: string | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const adapter = await buildLiveAdapter();
      usedModel = adapter.model;
      result = await adapter.runTask(taskInput);
      lastLiveError = null;
      successAttempt = attempt;
      await recordSuccess(context.provider);
      break;
    } catch (err) {
      lastLiveError = err;
      if (isPermanentError(err)) {
        logger.warn(
          { err, agentId: context.agentId, provider: context.provider, attempt },
          "Live adapter failed with permanent error — skipping retry"
        );
        break;
      }
      if (attempt === 1) {
        logger.warn(
          { err, agentId: context.agentId, provider: context.provider, attempt },
          "Live adapter failed on attempt 1 — retrying after delay"
        );
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }

  if (successAttempt !== null && result !== null) {
    await logAudit(
      "adapter_success",
      `Live ${context.provider} call succeeded on attempt ${successAttempt} for task "${context.taskTitle}"`,
      {
        taskId: context.taskId,
        agentId: context.agentId,
        provider: context.provider,
        attempt: successAttempt,
      }
    );
  }

  if (lastLiveError !== null || result === null) {
    const permanent = isPermanentError(lastLiveError);
    await recordFailure(context.provider);
    logger.error(
      {
        err: lastLiveError,
        agentId: context.agentId,
        provider: context.provider,
        taskId: context.taskId,
        permanent,
      },
      permanent
        ? "Live adapter failed with permanent error — falling back to simulation without retry"
        : "Live adapter failed after retry — falling back to simulation"
    );
    await logAudit(
      "adapter_fallback",
      `Live ${context.provider} call failed${permanent ? " (permanent error, no retry)" : " after retry"}; falling back to simulation for task "${context.taskTitle}"`,
      {
        taskId: context.taskId,
        agentId: context.agentId,
        provider: context.provider,
        permanent,
        error:
          lastLiveError instanceof Error ? lastLiveError.message : String(lastLiveError),
      }
    );
    const fallback = buildFallbackAdapter();
    usedModel = fallback.model;
    result = await fallback.runTask(taskInput);
    usedFallback = true;
  }

  return {
    result: result!,
    usedFallback,
    usedModel: usedModel ?? "",
    successAttempt,
  };
}
