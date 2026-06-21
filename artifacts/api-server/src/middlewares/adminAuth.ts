import type { RequestHandler } from "express";
import crypto from "node:crypto";
import { pool } from "@workspace/db";

const ADMIN_TOKEN = process.env["ADMIN_TOKEN"]?.trim() || null;
const ADMIN_EMAILS = new Set(
  (process.env["VIBA_ADMIN_EMAILS"]
    || process.env["VIBA_ADMIN_EMAIL"]
    || process.env["ADMIN_BOOTSTRAP_EMAIL"]
    || "leego972@gmail.com")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

async function loggedInAdminEmail(userId: number | undefined): Promise<string | null> {
  if (!userId) return null;
  const { rows } = await pool.query<{ email: string }>("SELECT email FROM users WHERE id = $1 LIMIT 1", [userId]);
  const email = rows[0]?.email?.toLowerCase() ?? null;
  return email && ADMIN_EMAILS.has(email) ? email : null;
}

/**
 * Admin middleware.
 * Preferred access: logged-in user whose email is listed in VIBA_ADMIN_EMAILS / VIBA_ADMIN_EMAIL.
 * Backward-compatible server/API access: ADMIN_TOKEN bearer token, when configured.
 */
export const requireAdmin: RequestHandler = async (req, res, next) => {
  try {
    const adminEmail = await loggedInAdminEmail(req.session?.userId);
    if (adminEmail) {
      res.locals.adminEmail = adminEmail;
      next();
      return;
    }

    const auth = req.headers["authorization"] ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (ADMIN_TOKEN && token && timingSafeEqual(token, ADMIN_TOKEN)) {
      next();
      return;
    }

    res.status(403).json({ error: "Admin access denied" });
  } catch (error) {
    req.log?.error?.({ error }, "admin auth failed");
    res.status(500).json({ error: "Internal server error" });
  }
};

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
