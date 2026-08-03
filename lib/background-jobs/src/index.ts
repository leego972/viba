export type RetryDecision = "retry" | "fail";

export type RetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  classify(error: unknown): RetryDecision;
};

export type Sleep = (milliseconds: number) => Promise<void>;

export function calculateBackoff(policy: RetryPolicy, attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("attempt must be a positive integer");
  const delay = policy.baseDelayMs * policy.multiplier ** (attempt - 1);
  return Math.min(policy.maxDelayMs, Math.max(0, Math.floor(delay)));
}

export async function executeWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  sleep: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<T> {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive integer");
  }

  let finalError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      finalError = error;
      if (attempt === policy.maxAttempts || policy.classify(error) === "fail") throw error;
      await sleep(calculateBackoff(policy, attempt));
    }
  }
  throw finalError;
}

export type CircuitState = "closed" | "open" | "half-open";

export type CircuitSnapshot = {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
};

export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly failureThreshold: number,
    private readonly resetTimeoutMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
      throw new Error("failureThreshold must be a positive integer");
    }
    if (!Number.isFinite(resetTimeoutMs) || resetTimeoutMs <= 0) {
      throw new Error("resetTimeoutMs must be positive");
    }
  }

  state(): CircuitState {
    if (this.openedAt === null) return "closed";
    return this.now() - this.openedAt >= this.resetTimeoutMs ? "half-open" : "open";
  }

  assertCanExecute(): void {
    if (this.state() === "open") throw new Error("circuit is open");
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold && this.openedAt === null) {
      this.openedAt = this.now();
    }
  }

  snapshot(): CircuitSnapshot {
    return {
      state: this.state(),
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
    };
  }
}
