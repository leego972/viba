import type { RequestHandler } from "express";
import crypto from "node:crypto";

const ADMIN_TOKEN = process.env["ADMIN_TOKEN"]?.trim() || null;

/**
 * Timing-safe string comparison — prevents timing attacks on token values.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Middleware: requires a valid ADMIN_TOKEN bearer token.
 * Returns 503 if ADMIN_TOKEN env var is not set (misconfigured server).
 * Returns 401 if token is missing or wrong.
 */
export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!ADMIN_TOKEN) {
    res.status(503).json({
      error: "Admin not configured — set ADMIN_TOKEN environment variable on the server",
    });
    return;
  }
  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !timingSafeEqual(token, ADMIN_TOKEN)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

/**
 * Middleware: guards destructive actions. Caller must include
 * the header  X-Admin-Confirm: true  to proceed.
 * Without it the request is rejected with 428 Precondition Required.
 */
export const requireConfirmation: RequestHandler = (req, res, next) => {
  if (req.headers["x-admin-confirm"] !== "true") {
    res.status(428).json({
      error: "Confirmation required",
      hint: "Include header  X-Admin-Confirm: true  to confirm this destructive action",
    });
    return;
  }
  next();
};
