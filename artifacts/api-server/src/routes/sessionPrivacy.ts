import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

let migrationReady: Promise<void> | null = null;

function ensureSessionUserColumn(): Promise<void> {
  if (!migrationReady) {
    migrationReady = pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id INTEGER`).then(() => undefined);
  }
  return migrationReady;
}

function parseSessionId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

router.use(async (_req, _res, next): Promise<void> => {
  try {
    await ensureSessionUserColumn();
    next();
  } catch (error) {
    next(error);
  }
});

router.use("/sessions/:id", async (req, res, next): Promise<void> => {
  if (req.session?.bypass) {
    next();
    return;
  }

  const sessionId = parseSessionId(req.params.id);
  if (!sessionId) {
    res.status(400).json({ error: "valid session id required" });
    return;
  }

  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { rows } = await pool.query<{ user_id: number | null }>(
    `SELECT user_id FROM sessions WHERE id = $1 LIMIT 1`,
    [sessionId],
  );

  const owner = rows[0];
  if (!owner) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (owner.user_id === null) {
    if (process.env.VIBA_ALLOW_LEGACY_UNOWNED_SESSIONS === "true") {
      await pool.query(`UPDATE sessions SET user_id = $1 WHERE id = $2 AND user_id IS NULL`, [userId, sessionId]);
      next();
      return;
    }
    res.status(403).json({ error: "Session is not assigned to this user." });
    return;
  }

  if (owner.user_id !== userId) {
    res.status(403).json({ error: "Forbidden: this session belongs to another user." });
    return;
  }

  next();
});

export default router;
