import type { Request, Response, NextFunction } from "express";
import { pool } from "@workspace/db";

/**
 * The Archibald embed token is intentionally restricted to the two read-only
 * Bridge status endpoints. It must never act as a general login bypass.
 */
const EMBED_BYPASS_PATHS = new Set([
  "/stats",
  "/circuit-status",
]);

/**
 * Require a valid, verified user session.
 *
 * Security properties:
 * - deleted users are rejected;
 * - password users must verify their email before authenticated API access;
 * - the Archibald embed bypass is limited to an explicit read-only allow-list;
 * - integration-test bypass remains test-only.
 */
export async function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (process.env.NODE_ENV === "test" && process.env.TEST_BYPASS_SESSION === "1") {
    next();
    return;
  }

  if (req.session.bypass) {
    if (req.method === "GET" && EMBED_BYPASS_PATHS.has(req.path)) {
      next();
      return;
    }
    res.status(403).json({
      error: "embed_scope_denied",
      message: "The embed session is not authorised for this operation.",
    });
    return;
  }

  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { rows } = await pool.query<{ email_verified: boolean }>(
      `SELECT email_verified
         FROM users
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1`,
      [userId],
    );

    const user = rows[0];
    if (!user) {
      req.session.destroy(() => {});
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!user.email_verified) {
      res.status(403).json({
        error: "email_not_verified",
        code: "EMAIL_NOT_VERIFIED",
        message: "Verify your email address before using VIBA.",
      });
      return;
    }

    next();
  } catch (err) {
    req.log?.error?.({ err }, "session verification failed");
    res.status(503).json({
      error: "authentication_unavailable",
      message: "Authentication could not be verified. Please try again.",
    });
  }
}
