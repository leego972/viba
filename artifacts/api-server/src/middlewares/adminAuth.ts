import type { RequestHandler } from "express";

const ADMIN_TOKEN = process.env["ADMIN_TOKEN"]?.trim() || null;

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
  if (!token || token !== ADMIN_TOKEN) {
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
