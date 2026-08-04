export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  increment(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }>;
}

export interface RateLimitPolicy {
  name: string;
  maxRequests: number;
  windowMs: number;
}

export class RateLimitConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitConfigurationError";
  }
}

export class MemoryFixedWindowStore implements RateLimitStore {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  async increment(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }> {
    const existing = this.entries.get(key);
    if (!existing || now >= existing.resetAt) {
      const next = { count: 1, resetAt: now + windowMs };
      this.entries.set(key, next);
      return next;
    }
    existing.count += 1;
    return { ...existing };
  }

  prune(now: number): number {
    let removed = 0;
    for (const [key, value] of this.entries) {
      if (now >= value.resetAt) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

export class FixedWindowRateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly now: () => number = Date.now,
  ) {}

  async consume(subject: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    validatePolicy(policy);
    const normalizedSubject = normalizeSubject(subject);
    const currentTime = this.now();
    const result = await this.store.increment(`${policy.name}:${normalizedSubject}`, policy.windowMs, currentTime);
    const remaining = Math.max(0, policy.maxRequests - result.count);
    const retryAfterSeconds = Math.max(0, Math.ceil((result.resetAt - currentTime) / 1000));
    return {
      allowed: result.count <= policy.maxRequests,
      limit: policy.maxRequests,
      remaining,
      resetAt: result.resetAt,
      retryAfterSeconds,
    };
  }
}

export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "RateLimit-Reset": String(Math.ceil(decision.resetAt / 1000)),
  };
  if (!decision.allowed) headers["Retry-After"] = String(decision.retryAfterSeconds);
  return headers;
}

function validatePolicy(policy: RateLimitPolicy): void {
  if (!/^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(policy.name)) {
    throw new RateLimitConfigurationError("invalid policy name");
  }
  if (!Number.isSafeInteger(policy.maxRequests) || policy.maxRequests <= 0) {
    throw new RateLimitConfigurationError("maxRequests must be a positive safe integer");
  }
  if (!Number.isSafeInteger(policy.windowMs) || policy.windowMs <= 0) {
    throw new RateLimitConfigurationError("windowMs must be a positive safe integer");
  }
}

function normalizeSubject(subject: string): string {
  const value = String(subject).trim();
  if (!value || value.length > 256 || /[\r\n\0]/.test(value)) {
    throw new RateLimitConfigurationError("invalid rate-limit subject");
  }
  return value;
}
