import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { pool } from "@workspace/db";

const router: IRouter = Router();

function requireBootstrapToken(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const expected = process.env["ADMIN_BOOTSTRAP_TOKEN"]?.trim();
  if (!expected) return false;

  const header = req.headers["x-admin-bootstrap-token"];
  const received = Array.isArray(header) ? header[0] : header;
  return typeof received === "string" && received.trim() === expected;
}

/**
 * POST /auth/bootstrap-admin
 *
 * Emergency owner/admin bootstrap for the UI account.
 * Uses environment variables only. Never hardcode real credentials in source code.
 *
 * Required env vars:
 * - ADMIN_BOOTSTRAP_EMAIL
 * - ADMIN_BOOTSTRAP_PASSWORD
 * - ADMIN_BOOTSTRAP_TOKEN
 *
 * Request must include:
 * - X-Admin-Bootstrap-Token: <ADMIN_BOOTSTRAP_TOKEN>
 */
router.post("/auth/bootstrap-admin", async (req, res): Promise<void> => {
  if (!requireBootstrapToken(req)) {
    res.status(401).json({ error: "Unauthorized admin bootstrap request." });
    return;
  }

  const email = process.env["ADMIN_BOOTSTRAP_EMAIL"]?.trim().toLowerCase();
  const password = process.env["ADMIN_BOOTSTRAP_PASSWORD"];

  if (!email || !password) {
    res.status(503).json({
      error: "Admin bootstrap is not configured.",
      requiredSecrets: ["ADMIN_BOOTSTRAP_EMAIL", "ADMIN_BOOTSTRAP_PASSWORD", "ADMIN_BOOTSTRAP_TOKEN"],
    });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "ADMIN_BOOTSTRAP_PASSWORD must be at least 8 characters." });
    return;
  }

  try {
    const hash = await bcrypt.hash(password, 12);

    const { rows } = await pool.query<{ id: number; email: string }>(
      `INSERT INTO users (
         email,
         password_hash,
         name,
         subscription_status,
         credits_remaining,
         email_verified,
         deleted_at,
         updated_at
       )
       VALUES ($1, $2, 'Admin', 'active', 999999999, true, NULL, NOW())
       ON CONFLICT (email) DO UPDATE SET
         password_hash       = EXCLUDED.password_hash,
         name                = COALESCE(users.name, 'Admin'),
         subscription_status = 'active',
         credits_remaining   = 999999999,
         email_verified      = true,
         deleted_at          = NULL,
         updated_at          = NOW()
       RETURNING id, email`,
      [email, hash],
    );

    const user = rows[0];
    if (!user) {
      res.status(500).json({ error: "Admin user could not be created or updated." });
      return;
    }

    await pool.query(
      `INSERT INTO viba_team_members (user_id, email, role, status, updated_at)
       VALUES ($1, $2, 'owner', 'active', NOW())
       ON CONFLICT DO NOTHING`,
      [user.id, email],
    ).catch(async () => {
      await pool.query(
        `UPDATE viba_team_members
         SET user_id = $1, role = 'owner', status = 'active', updated_at = NOW()
         WHERE lower(email) = lower($2)`,
        [user.id, email],
      );
    });

    res.json({
      ok: true,
      user: { id: user.id, email: user.email },
      login: "/login",
      notes: [
        "Password was set from ADMIN_BOOTSTRAP_PASSWORD.",
        "User was marked email_verified=true, subscription_status=active, credits_remaining=999999999.",
        "VIBA team member role was set to owner where supported by the current schema.",
      ],
    });
  } catch (err) {
    req.log?.error?.({ err }, "admin bootstrap failed");
    res.status(500).json({ error: "Admin bootstrap failed." });
  }
});

export default router;
