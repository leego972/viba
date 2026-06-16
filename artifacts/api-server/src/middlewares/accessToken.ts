import type { Request, Response, NextFunction } from "express";

const TOKEN = process.env["ACCESS_TOKEN"]?.trim() || null;

/**
 * Returns true if ACCESS_TOKEN protection is configured.
 * Used by /api/auth/config to tell the frontend whether to show the access gate.
 */
export function isAccessTokenConfigured(): boolean {
  return TOKEN !== null && TOKEN.length > 0;
}

/**
 * Validates a candidate token string against ACCESS_TOKEN.
 * When no token is configured, every candidate is accepted (open mode).
 */
export function validateToken(candidate: string): boolean {
  if (!TOKEN) return true;
  return candidate === TOKEN;
}

/**
 * Express middleware: when ACCESS_TOKEN is set, every request to /api must
 * supply a matching token via one of:
 *   Authorization: Bearer <token>
 *   X-Access-Token: <token>
 *
 * Requests without a matching token receive 401 { error: "Unauthorized" }.
 * When ACCESS_TOKEN is not set the middleware is a no-op (open mode).
 *
 * The /api/auth/config and /api/auth/verify paths are excluded from this
 * check in app.ts so the frontend can bootstrap before it has a token.
 */
export function accessTokenMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!TOKEN) {
    next();
    return;
  }

  const authHeader = req.headers["authorization"];
  const xToken = req.headers["x-access-token"];

  let provided: string | null = null;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    provided = authHeader.slice(7).trim();
  } else if (typeof xToken === "string") {
    provided = xToken.trim();
  }

  if (!provided || provided !== TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
