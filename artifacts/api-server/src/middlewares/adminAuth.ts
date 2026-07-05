import type { RequestHandler } from "express";
import crypto from "node:crypto";
import { isAdminUserId } from "../lib/adminAccess";

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

function tokenIsValid(rawAuthHeader: unknown): boolean {
  if (!ADMIN_TOKEN) return false;
  const auth = typeof rawAuthHeader === "string" ? rawAuthHeader : "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return !!token && timingSafeEqual(token, ADMIN_TOKEN);
}

/**
 * Middleware: allows either:
 * - a valid ADMIN_TOKEN bearer token, or
 * - a logged-in user whose email is in the VIBA admin email allowlist.
 *
 * TEST_BYPASS_ADMIN=1 lets integration tests call admin routes without a real
 * token. Only active when NODE_ENV=test.
 */
export const requireAdmin: RequestHandler = async (req, res, next): Promise<void> => {
  if (process.env.NODE_ENV === "test" && process.env.TEST_BYPASS_ADMIN === "1") { next(); return; }

  if (tokenIsValid(req.headers["authorization"])) { next(); return; }

  const sessionUserId = typeof req.session?.userId === "number" ? req.session.userId : null;
  if (sessionUserId && await isAdminUserId(sessionUserId)) { next(); return; }

  if (!ADMIN_TOKEN) {
    res.status(503).json({
      error: "Admin not configured — set ADMIN_TOKEN or log in with an allowed admin email",
    });
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
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
