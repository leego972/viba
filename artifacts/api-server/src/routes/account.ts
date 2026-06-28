/**
 * Account self-service routes
 *
 * POST /api/account/request-deletion  — archive + soft-delete, 6-month countdown
 * GET  /api/account/deletion-status   — check if a pending deletion exists
 * POST /api/account/cancel-deletion   — undo deletion before the 6-month window closes
 */
import { Router } from "express";
import { requireSession } from "../middlewares/requireSession";
import { archiveUserToGitHub } from "../lib/archiveService";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { sendSubscriptionCanceledEmail } from "../lib/billingEmail";

const router = Router();

// ─── POST /api/account/request-deletion ──────────────────────────────────────
router.post("/account/request-deletion", requireSession, async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  try {
    // Idempotency — reject if deletion already in progress
    const { rows: existing } = await pool.query(
      `SELECT id FROM account_deletion_requests WHERE user_id = $1 AND deleted_at IS NULL AND status != 'canceled'`,
      [userId],
    );
    if (existing.length > 0) {
      res.status(409).json({
        error: "deletion_already_requested",
        message: "A deletion request is already pending for this account.",
      });
      return;
    }

    const { rows: userRows } = await pool.query(
      `SELECT email FROM users WHERE id = $1`,
      [userId],
    );
    const email = (userRows[0] as { email: string } | undefined)?.email;

    // Archive user data to GitHub — fire-and-forget safe, continue even if it fails
    const archive = await archiveUserToGitHub(userId).catch((err) => {
      logger.error({ err, userId }, "Account deletion: archive failed — proceeding without GitHub archive");
      return null;
    });

    const deleteAfter = new Date();
    deleteAfter.setMonth(deleteAfter.getMonth() + 6);

    await pool.query(
      `INSERT INTO account_deletion_requests
         (user_id, archive_repo, archive_path, archive_commit_sha, delete_after, status)
       VALUES ($1, $2, $3, $4, $5, 'archived')`,
      [
        userId,
        archive?.archiveRepo ?? null,
        archive?.archivePath ?? null,
        archive?.archiveCommitSha ?? null,
        deleteAfter,
      ],
    );

    // Soft-delete — blocks login, preserves all data until 6 months pass
    await pool.query(
      `UPDATE users SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [userId],
    );

    // Pause all running sessions so no credits are consumed during the deletion window
    await pool.query(
      `UPDATE sessions SET status = 'paused', updated_at = NOW()
       WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );

    // Invalidate the active session cookie
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));

    // Notify user — data is safe for 6 months
    if (email) {
      sendSubscriptionCanceledEmail(email).catch((err) =>
        logger.error({ err, email }, "account/request-deletion: failed to send cancellation email"),
      );
    }

    logger.info({ userId, deleteAfter, archived: !!archive }, "Account deletion requested");
    res.json({ ok: true, deleteAfter: deleteAfter.toISOString(), archived: !!archive });
  } catch (err) {
    logger.error({ err, userId }, "account/request-deletion error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/account/deletion-status ────────────────────────────────────────
router.get("/account/deletion-status", requireSession, async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  try {
    const { rows } = await pool.query(
      `SELECT id, requested_at, delete_after, status, archive_repo, archive_path
       FROM account_deletion_requests
       WHERE user_id = $1 AND deleted_at IS NULL AND status != 'canceled'
       ORDER BY requested_at DESC LIMIT 1`,
      [userId],
    );
    if (!rows[0]) {
      res.json({ pending: false });
      return;
    }
    const r = rows[0] as {
      id: number;
      requested_at: Date;
      delete_after: Date;
      status: string;
      archive_repo: string | null;
    };
    res.json({
      pending: true,
      requestedAt: r.requested_at.toISOString(),
      deleteAfter: r.delete_after.toISOString(),
      status: r.status,
      archived: !!r.archive_repo,
    });
  } catch (err) {
    logger.error({ err, userId }, "account/deletion-status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/account/cancel-deletion ───────────────────────────────────────
router.post("/account/cancel-deletion", requireSession, async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  try {
    const { rowCount } = await pool.query(
      `UPDATE account_deletion_requests
       SET status = 'canceled', updated_at = NOW()
       WHERE user_id = $1 AND deleted_at IS NULL AND status NOT IN ('deleted', 'canceled')`,
      [userId],
    );
    if (!rowCount) {
      res.status(404).json({ error: "No active deletion request found." });
      return;
    }

    // Restore the user account — re-enable login
    await pool.query(
      `UPDATE users SET deleted_at = NULL, updated_at = NOW() WHERE id = $1`,
      [userId],
    );

    logger.info({ userId }, "Account deletion canceled — account restored");
    res.json({ ok: true, message: "Account deletion canceled. Your account has been restored." });
  } catch (err) {
    logger.error({ err, userId }, "account/cancel-deletion error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
