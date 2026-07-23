import { pool } from "@workspace/db";

const ADMIN_FULL_ACCESS_CREDITS = 999_999_999;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Administrator identities must be configured in Render, never committed to
 * the public repository. Set VIBA_ADMIN_EMAILS to a comma-separated allow-list.
 */
export function getAdminEmails(): string[] {
  const envEmails = (process.env.VIBA_ADMIN_EMAILS ?? process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
  return [...new Set(envEmails)];
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(normalizeEmail(email));
}

export async function getUserEmailById(userId: number): Promise<string | null> {
  if (!Number.isFinite(userId) || userId <= 0) return null;
  const { rows } = await pool.query<{ email: string }>(
    `SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  return rows[0]?.email ?? null;
}

async function ensureAdminFullAccess(userId: number): Promise<void> {
  await pool.query(
    `UPDATE users
       SET subscription_status = 'active',
           credits_remaining = GREATEST(credits_remaining, $1),
           updated_at = NOW()
     WHERE id = $2
       AND deleted_at IS NULL`,
    [ADMIN_FULL_ACCESS_CREDITS, userId],
  );
}

export async function isAdminUserId(userId: number | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const email = await getUserEmailById(userId);
  const allowed = isAdminEmail(email);
  if (allowed) await ensureAdminFullAccess(userId);
  return allowed;
}
