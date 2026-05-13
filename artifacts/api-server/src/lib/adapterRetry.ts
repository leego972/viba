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
}

/**
 * Attempts to run the task using the live adapter up to 2 times.
 * Permanent errors (401/403/invalid API key) skip the retry immediately.
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
