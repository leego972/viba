import type { Request, Response, NextFunction } from "express";

  interface RateLimitRecord {
    count: number;
    resetAt: number;
  }

  const windows = new Map<string, RateLimitRecord>();

  // Purge expired entries every 5 minutes to prevent unbounded memory growth
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of windows.entries()) {
      if (now > record.resetAt) windows.delete(key);
    }
  }, 5 * 60 * 1_000).unref();

  export interface RateLimiterOptions {
    /** Time window in milliseconds */
    windowMs: number;
    /** Maximum number of requests allowed within the window */
    max: number;
    /** Message sent in the 429 response body */
    message?: string;
  }

  /**
   * Simple in-process rate limiter. Counts requests per IP address
   * within a sliding window. For multi-instance deployments, replace
   * the in-memory store with a shared Redis or DB counter.
   */
  export function createRateLimiter(opts: RateLimiterOptions) {
    const {
      windowMs,
      max,
      message = "Too many requests — please slow down.",
    } = opts;

    return (req: Request, res: Response, next: NextFunction): void => {
      const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
      const now = Date.now();
      const record = windows.get(ip);

      if (!record || now > record.resetAt) {
        windows.set(ip, { count: 1, resetAt: now + windowMs });
        next();
        return;
      }

      record.count += 1;
      if (record.count > max) {
        res.status(429).json({ error: message });
        return;
      }

      next();
    };
  }
  