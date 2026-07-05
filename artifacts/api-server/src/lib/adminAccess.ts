import { pool } from "@workspace/db";

const BUILT_IN_ADMIN_EMAILS = ["brobroplzcheck@gmail.com"];

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getAdminEmails(): string[] {
  const envEmails = (process.env.VIBA_ADMIN_EMAILS ?? process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
  return [...new Set([...BUILT_IN_ADMIN_EMAILS.map(normalizeEmail), ...envEmails])];
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(normalizeEmail(email));
}

export async function getUserEmailById(userId: number): Promise<string | null> {
  if (!Number.isFinite(userId) || userId <= 0) return null;
  const { rows } = await pool.query<{ email: string }>(
    `SELECT email FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.email ?? null;
}

export async function isAdminUserId(userId: number | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const email = await getUserEmailById(userId);
  return isAdminEmail(email);
}
