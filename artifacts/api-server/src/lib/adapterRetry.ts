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

function parsePositiveInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === "") return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

const CIRCUIT_OPEN_THRESHOLD = parsePositiveInt(process.env.CIRCUIT_OPEN_THRESHOLD, 5);
const CIRCUIT_TIMEOUT_MS = parsePositiveInt(process.env.CIRCUIT_TIMEOUT_MS, 5 * 60 * 1000);
const CACHE_TTL_MS = 30_000;

export function validateCircuitBreakerEnv(): void {
  const threshold = process.env.CIRCUIT_OPEN_THRESHOLD;
  if (threshold !== undefined && threshold !== "") {
    const parsed = parseInt(threshold, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid CIRCUIT_OPEN_THRESHOLD: "${threshold}" — must be a positive integer (e.g. 5)`);
    }
  }

  const timeoutMs = process.env.CIRCUIT_TIMEOUT_MS;
  if (timeoutMs !== undefined && timeoutMs !== "") {
    const parsed = parseInt(timeoutMs, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid CIRCUIT_TIMEOUT_MS: "${timeoutMs}" — must be a positive integer in milliseconds (e.g. 300000)`);
    }
  }
}

interface InternalCircuitState {
  consecutiveFailures: number;
  openedAt: number | null;
  cachedAt: number;
  persistedAt: number | null;
}

export interface CircuitState {
  consecutiveFailures: number;
  openedAt: number | null;
}

interface StartupLoadInfo {
  loadedAt: number;
  restoredCount: number;
}

const circuitMap = new Map<string, InternalCircuitState>();
let startupLoadInfo: StartupLoadInfo | null = null;

export function getStartupLoadInfo(): StartupLoadInfo | null {
  return startupLoadInfo;
}

function getOrCreateLocal(provider: string): InternalCircuitState {
  let state = circuitMap.get(provider);
  if (!state) {
    state = { consecutiveFailures: 0, openedAt: null, cachedAt: 0, persistedAt: null };
    circuitMap.set(provider, state);
  }
  return state;
}

async function refreshCircuitFromDb(provider: string, now = Date.now()): Promise<void> {
  const state = circuitMap.get(provider);
  if (state && now - state.cachedAt < CACHE_TTL_MS) return;

  try {
    const [{ db, circuitStateTable }, { eq }] = await Promise.all([
      import("@workspace/db"),
      import("drizzle-orm"),
    ]);
    const rows = await db.select().from(circuitStateTable).where(eq(circuitStateTable.provider, provider));

    if (rows.length > 0) {
      const row = rows[0]!;
      circuitMap.set(provider, {
        consecutiveFailures: row.consecutiveFailures,
        openedAt: row.openedAt !== null ? row.openedAt.getTime() : null,
        cachedAt: now,
        persistedAt: row.updatedAt.getTime(),
      });
    } else {
      circuitMap.delete(provider);
    }
  } catch (err) {
    logger.warn({ err, provider }, "Failed to refresh circuit state from DB");
    getOrCreateLocal(provider).cachedAt = now;
  }
}

async function persistCircuitState(provider: string, state: InternalCircuitState): Promise<void> {
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
    state.persistedAt = Date.now();
  } catch (err) {
    logger.warn({ err, provider }, "Failed to persist circuit state to DB");
  }
}

async function deleteCircuitStateFromDb(provider: string): Promise<void> {
  try {
    const [{ db, circuitStateTable }, { eq }] = await Promise.all([
      import("@workspace/db"),
      import("drizzle-orm"),
    ]);
    await db.delete(circuitStateTable).where(eq(circuitStateTable.provider, provider));
  } catch (err) {
    logger.warn({ err, provider }, "Failed to delete circuit state from DB");
  }
}

export async function loadCircuitStateFromDb(): Promise<number> {
  try {
    const { db, circuitStateTable } = await import("@workspace/db");
    const rows = await db.select().from(circuitStateTable);
    const now = Date.now();
    for (const row of rows) {
      circuitMap.set(row.provider, {
        consecutiveFailures: row.consecutiveFailures,
        openedAt: row.openedAt !== null ? row.openedAt.getTime() : null,
        cachedAt: now,
        persistedAt: row.updatedAt.getTime(),
      });
    }
    startupLoadInfo = { loadedAt: now, restoredCount: rows.length };
    logger.info({ count: rows.length }, "Loaded circuit breaker state from DB");
    return rows.length;
  } catch (err) {
    logger.warn({ err }, "Failed to load circuit state from DB — starting with empty state");
    startupLoadInfo = null;
    return 0;
  }
}

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
    const alreadyOpen = state.openedAt !== null && now - state.openedAt < CIRCUIT_TIMEOUT_MS;
    if (!alreadyOpen) state.openedAt = now;
  }
  state.cachedAt = now;
  await persistCircuitState(provider, state);
}

export function resetAllCircuits(): void {
  circuitMap.clear();
  startupLoadInfo = null;
}

export async function resetProviderCircuit(provider: string): Promise<void> {
  circuitMap.delete(provider);
  await deleteCircuitStateFromDb(provider);
  logger.info({ provider }, "Circuit breaker manually reset by operator");
}

export interface CircuitStatusEntry {
  provider: string;
  state: "open" | "half-open" | "closed";
  consecutiveFailures: number;
  openedAt: number | null;
  msUntilReset: number | null;
  persistedAt: number | null;
  openThreshold: number;
  timeoutMs: number;
}

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
      persistedAt: cs.persistedAt,
      openThreshold: CIRCUIT_OPEN_THRESHOLD,
      timeoutMs: CIRCUIT_TIMEOUT_MS,
    });
  }
  return entries;
}

function explainProviderError(error: unknown): { raw: string; cause: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  if (lower.includes("quota") || lower.includes("billing") || lower.includes("insufficient") || lower.includes("credit balance")) {
    return { raw, cause: "billing, quota, or API credits" };
  }
  if (lower.includes("401") || lower.includes("403") || lower.includes("api key") || lower.includes("unauthorized") || lower.includes("authentication")) {
    return { raw, cause: "API-key authentication or permission" };
  }
  if (lower.includes("model") || lower.includes("not found")) {
    return { raw, cause: "model availability or access" };
  }
  if (lower.includes("rate") || lower.includes("429")) {
    return { raw, cause: "provider rate limit" };
  }
  return { raw, cause: "live provider request" };
}

async function continueWithFallback(
  buildFallbackAdapter: () => AgentAdapter,
  taskInput: AgentTaskInput,
  context: RetryContext,
  primaryMessage: string,
  logAudit: LogAuditFn,
  circuitOpen = false,
): Promise<AdapterRetryResult> {
  try {
    const fallback = buildFallbackAdapter();
    const result = await fallback.runTask(taskInput);
    const notice = fallback.isMock
      ? `⚠️ ${primaryMessage} VIBA continued with its configured fallback adapter.`
      : `⚠️ ${primaryMessage} VIBA continued with ${fallback.name}.`;

    await recordSuccess(fallback.provider.toLowerCase());
    await logAudit("adapter_fallback", notice, {
      taskId: context.taskId,
      agentId: context.agentId,
      provider: context.provider,
      fallbackProvider: fallback.provider,
      fallbackModel: fallback.model,
      simulated: fallback.isMock,
      circuitOpen,
    });

    return {
      result: { ...result, messageText: `${notice}\n\n${result.messageText}` },
      usedFallback: true,
      usedModel: fallback.model,
      successAttempt: null,
      circuitOpen: circuitOpen || undefined,
    };
  } catch (fallbackError) {
    const fallbackExplanation = explainProviderError(fallbackError);
    const message =
      `${primaryMessage} VIBA also failed to continue with its configured fallback ` +
      `because of ${fallbackExplanation.cause}. Fallback error: ${fallbackExplanation.raw}`;

    await logAudit("adapter_error", message, {
      taskId: context.taskId,
      agentId: context.agentId,
      provider: context.provider,
      fallbackFailed: true,
      fallbackError: fallbackExplanation.raw,
    });
    throw new Error(message);
  }
}

export async function runAdapterWithRetry(params: {
  buildLiveAdapter: () => Promise<AgentAdapter>;
  buildFallbackAdapter: () => AgentAdapter;
  taskInput: AgentTaskInput;
  retryDelayMs: number;
  logAudit: LogAuditFn;
  context: RetryContext;
}): Promise<AdapterRetryResult> {
  const { buildLiveAdapter, buildFallbackAdapter, taskInput, retryDelayMs, logAudit, context } = params;
  const provider = context.provider.toLowerCase();

  await refreshCircuitFromDb(provider);

  if (isCircuitOpen(provider)) {
    const primaryMessage =
      `${context.provider} API issue: its circuit is temporarily open after repeated failures. ` +
      "Check its API key, billing/credits, model access, or provider status.";

    await logAudit("adapter_error", primaryMessage, {
      taskId: context.taskId,
      agentId: context.agentId,
      provider: context.provider,
      circuitOpen: true,
    });

    return continueWithFallback(buildFallbackAdapter, taskInput, context, primaryMessage, logAudit, true);
  }

  let result: AgentTaskResult | null = null;
  let lastLiveError: unknown = null;
  let successAttempt: number | null = null;
  let usedModel = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const adapter = await buildLiveAdapter();
      usedModel = adapter.model;
      result = await adapter.runTask(taskInput);
      lastLiveError = null;
      successAttempt = attempt;
      await recordSuccess(provider);
      break;
    } catch (err) {
      lastLiveError = err;
      if (isPermanentError(err)) break;
      if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  if (successAttempt !== null && result !== null) {
    await logAudit("adapter_success", `Live ${context.provider} call succeeded on attempt ${successAttempt} for task "${context.taskTitle}"`, {
      taskId: context.taskId,
      agentId: context.agentId,
      provider: context.provider,
      attempt: successAttempt,
    });
    return { result, usedFallback: false, usedModel, successAttempt };
  }

  await recordFailure(provider);
  const permanent = isPermanentError(lastLiveError);
  const explanation = explainProviderError(lastLiveError);
  const primaryMessage =
    `${context.provider} API issue: ${explanation.cause}. Provider error: ${explanation.raw}`;

  logger.error(
    { err: lastLiveError, agentId: context.agentId, provider: context.provider, taskId: context.taskId, permanent },
    "Primary live adapter failed — continuing with configured fallback"
  );
  await logAudit("adapter_error", primaryMessage, {
    taskId: context.taskId,
    agentId: context.agentId,
    provider: context.provider,
    permanent,
    error: explanation.raw,
  });

  return continueWithFallback(buildFallbackAdapter, taskInput, context, primaryMessage, logAudit);
}
