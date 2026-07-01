import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { pool } from "@workspace/db";

const router: IRouter = Router();

const OWNER_EMAIL = "leego972@gmail.com";

interface OwnerRow {
  id: number;
  email: string;
  name: string | null;
}

function getOwnerPassword(): string | null {
  const value = process.env["ADMIN_BOOTSTRAP_PASSWORD"];
  return value && value.length >= 8 ? value : null;
}

async function upsertOwner(password: string): Promise<OwnerRow> {
  const hash = await bcrypt.hash(password, 12);
  const result = await pool.query<OwnerRow>(
    `INSERT INTO users (
       email, password_hash, name, subscription_status, credits_remaining,
       email_verified, deleted_at, updated_at
     )
     VALUES ($1, $2, 'Admin', 'active', 999999999, true, NULL, NOW())
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       subscription_status = 'active',
       credits_remaining = 999999999,
       email_verified = true,
       deleted_at = NULL,
       updated_at = NOW()
     RETURNING id, email, name`,
    [OWNER_EMAIL, hash],
  );

  const owner = result.rows[0];
  if (!owner) throw new Error("owner_login_upsert_failed");

  await pool.query(
    `UPDATE viba_team_members
     SET user_id = $1, role = 'owner', status = 'active', updated_at = NOW()
     WHERE lower(email) = lower($2)`,
    [owner.id, OWNER_EMAIL],
  );

  await pool.query(
    `INSERT INTO viba_team_members (user_id, email, role, status, updated_at)
     SELECT $1, $2, 'owner', 'active', NOW()
     WHERE NOT EXISTS (SELECT 1 FROM viba_team_members WHERE lower(email) = lower($2))`,
    [owner.id, OWNER_EMAIL],
  );

  return owner;
}

router.post("/auth/login", async (req, res, next): Promise<void> => {
  const body = req.body as { email?: unknown; password?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const ownerPassword = getOwnerPassword();

  if (email !== OWNER_EMAIL || !ownerPassword || password !== ownerPassword) {
    next();
    return;
  }

  try {
    const owner = await upsertOwner(ownerPassword);
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        req.log?.error?.({ err: regenErr }, "owner session regenerate failed");
        res.status(500).json({ error: "Internal server error" });
        return;
      }
      req.session.userId = owner.id;
      req.session.save((saveErr) => {
        if (saveErr) {
          req.log?.error?.({ err: saveErr }, "owner session save failed");
          res.status(500).json({ error: "Internal server error" });
          return;
        }
        res.json({ user: { id: owner.id, email: owner.email, name: owner.name } });
      });
    });
  } catch (err) {
    req.log?.error?.({ err }, "owner login failed");
    res.status(500).json({ error: "Owner login failed." });
  }
});

export default router;
