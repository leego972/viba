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
// Per-provider in-process state. Opens after CIRCUIT_OPEN_THRESHOLD consecutive
// failures and stays open for CIRCUIT_TIMEOUT_MS before allowing one probe attempt.

const CIRCUIT_OPEN_THRESHOLD = 5;
const CIRCUIT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface CircuitState {
  consecutiveFailures: number;
  openedAt: number | null;
}

const circuitMap = new Map<string, CircuitState>();

function getCircuit(provider: string): CircuitState {
  let state = circuitMap.get(provider);
  if (!state) {
    state = { consecutiveFailures: 0, openedAt: null };
    circuitMap.set(provider, state);
  }
  return state;
}

export function isCircuitOpen(provider: string, now = Date.now()): boolean {
  const state = getCircuit(provider);
  if (state.openedAt === null) return false;
  return now - state.openedAt < CIRCUIT_TIMEOUT_MS;
}

function recordSuccess(provider: string): void {
  const state = getCircuit(provider);
  state.consecutiveFailures = 0;
  state.openedAt = null;
}

function recordFailure(provider: string, now = Date.now()): void {
  const state = getCircuit(provider);
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
}

/** Exposed for tests only — resets all circuit state. */
export function resetAllCircuits(): void {
  circuitMap.clear();
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
      recordSuccess(context.provider);
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
    recordFailure(context.provider);
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
