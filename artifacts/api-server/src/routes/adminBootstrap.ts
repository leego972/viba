import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { pool } from "@workspace/db";

const router: IRouter = Router();

let startupBootstrapScheduled = false;
let startupBootstrapComplete = false;

function getBootstrapConfig(): { email: string; password: string } | null {
  const email = process.env["ADMIN_BOOTSTRAP_EMAIL"]?.trim().toLowerCase();
  const password = process.env["ADMIN_BOOTSTRAP_PASSWORD"];

  if (!email || !password) return null;
  if (password.length < 8) return null;

  return { email, password };
}

function requireBootstrapToken(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const expected = process.env["ADMIN_BOOTSTRAP_TOKEN"]?.trim();
  if (!expected) return false;

  const header = req.headers["x-admin-bootstrap-token"];
  const received = Array.isArray(header) ? header[0] : header;
  return typeof received === "string" && received.trim() === expected;
}

async function upsertAdminUser(config: { email: string; password: string }): Promise<{ id: number; email: string }> {
  const hash = await bcrypt.hash(config.password, 12);

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
    [config.email, hash],
  );

  const user = rows[0];
  if (!user) {
    throw new Error("Admin user could not be created or updated.");
  }

  await pool.query(
    `UPDATE viba_team_members
     SET user_id = $1, role = 'owner', status = 'active', updated_at = NOW()
     WHERE lower(email) = lower($2)`,
    [user.id, config.email],
  );

  await pool.query(
    `INSERT INTO viba_team_members (user_id, email, role, status, updated_at)
     SELECT $1, $2, 'owner', 'active', NOW()
     WHERE NOT EXISTS (
       SELECT 1 FROM viba_team_members WHERE lower(email) = lower($2)
     )`,
    [user.id, config.email],
  );

  return user;
}

function scheduleStartupAdminBootstrap(): void {
  if (startupBootstrapScheduled) return;
  startupBootstrapScheduled = true;

  const config = getBootstrapConfig();
  if (!config) return;

  let attempt = 0;
  const maxAttempts = 12;

  const runAttempt = (): void => {
    if (startupBootstrapComplete) return;
    attempt += 1;

    upsertAdminUser(config)
      .then((user) => {
        startupBootstrapComplete = true;
        console.info(JSON.stringify({ event: "startup_admin_bootstrap_complete", userId: user.id, email: user.email }));
      })
      .catch((err: unknown) => {
        console.warn(JSON.stringify({
          event: "startup_admin_bootstrap_retry",
          attempt,
          maxAttempts,
          error: err instanceof Error ? err.message : String(err),
        }));

        if (attempt < maxAttempts) {
          setTimeout(runAttempt, 5000);
        }
      });
  };

  setTimeout(runAttempt, 5000);
}

scheduleStartupAdminBootstrap();

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

  const config = getBootstrapConfig();
  if (!config) {
    res.status(503).json({
      error: "Admin bootstrap is not configured or password is shorter than 8 characters.",
      requiredSecrets: ["ADMIN_BOOTSTRAP_EMAIL", "ADMIN_BOOTSTRAP_PASSWORD", "ADMIN_BOOTSTRAP_TOKEN"],
    });
    return;
  }

  try {
    const user = await upsertAdminUser(config);

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
