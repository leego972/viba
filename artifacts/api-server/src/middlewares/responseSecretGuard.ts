import type { NextFunction, Request, Response } from "express";
import { findSensitiveResponsePaths, redactDeep } from "../lib/securityPolicy";

export interface ResponseSecretGuardOptions {
  strict?: boolean;
  enabled?: boolean;
}

function shouldInspectJsonBody(body: unknown): boolean {
  if (body === null || body === undefined) return false;
  if (Buffer.isBuffer(body)) return false;
  if (typeof body === "string") return false;
  return typeof body === "object";
}

export function responseSecretGuard(options: ResponseSecretGuardOptions = {}) {
  const enabled = options.enabled ?? process.env["VIBA_RESPONSE_SECRET_GUARD"] !== "false";
  const strict = options.strict ?? process.env["VIBA_STRICT_RESPONSE_SECRET_GUARD"] === "true" || process.env["NODE_ENV"] === "test";

  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!enabled) {
      next();
      return;
    }

    const originalJson = res.json.bind(res);

    res.json = ((body: unknown): Response => {
      if (!shouldInspectJsonBody(body)) return originalJson(body);

      const sensitivePaths = findSensitiveResponsePaths(body);
      if (sensitivePaths.length === 0) return originalJson(body);

      const redacted = redactDeep(body);
      res.setHeader("X-VIBA-Secret-Guard", "redacted");

      if (strict && !res.headersSent) {
        res.status(500);
        return originalJson({
          error: "UNSAFE_RESPONSE_BLOCKED",
          message: "Response contained sensitive fields and was blocked by VIBA response safety policy.",
          sensitivePathCount: sensitivePaths.length,
          rawValuesReturned: false,
        });
      }

      return originalJson(redacted);
    }) as Response["json"];

    next();
  };
}
