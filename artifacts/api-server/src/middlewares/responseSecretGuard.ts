/**
 * VIBA Response Secret Guard
 *
 * Middleware that intercepts outgoing JSON responses and:
 * - Redacts any field whose name matches a sensitive-key pattern
 * - In strict mode (test / VIBA_STRICT_RESPONSE_SECRET_GUARD=true): returns 500
 *   if raw secrets are detected instead of silently redacting them.
 *
 * Skipped for:
 * - /api/stripe/webhook   (raw body, Stripe signature verification)
 * - Non-JSON responses    (binary, streams, already-sent responses)
 */

import type { Request, Response, NextFunction } from "express";
import { redactDeep, isSensitiveFieldName } from "../lib/securityPolicy";

function isStrictMode(): boolean {
  return (
    process.env.VIBA_STRICT_RESPONSE_SECRET_GUARD === "true" ||
    process.env.NODE_ENV === "test" ||
    process.env.NODE_ENV === "development"
  );
}

/** Paths exempt from this guard (raw-body Stripe verification, health checks). */
const EXEMPT_PATHS = new Set([
  "/api/stripe/webhook",
]);

/**
 * Deeply scan a parsed JSON value for any field that looks like a raw secret
 * and has a non-redacted value.
 */
function hasRawSecretField(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  if (Array.isArray(obj)) {
    return obj.some((item) => hasRawSecretField(item));
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveFieldName(k) && typeof v === "string" && v !== "[REDACTED]" && v.length > 0) {
      return true;
    }
    if (typeof v === "object" && v !== null) {
      if (hasRawSecretField(v)) return true;
    }
  }
  return false;
}

export function responseSecretGuard() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip exempt paths
    if (EXEMPT_PATHS.has(req.path)) {
      next();
      return;
    }

    // Wrap res.json to inspect/redact outgoing payloads
    const originalJson = res.json.bind(res);

    res.json = function (body: unknown): Response {
      if (body === null || body === undefined) {
        return originalJson(body);
      }

      const strict = isStrictMode();

      if (strict && hasRawSecretField(body)) {
        // In strict mode, fail loudly — the caller must fix the leak
        return originalJson({
          error: "INTERNAL_SECURITY_ERROR",
          message: "Response blocked: raw secret-looking fields detected in outgoing payload.",
        }).status(500);
      }

      // Always redact (no-op if already clean)
      const safe = redactDeep(body);
      return originalJson(safe);
    };

    next();
  };
}
