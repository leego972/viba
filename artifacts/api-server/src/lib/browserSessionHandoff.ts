import crypto from "crypto";
import { pool } from "@workspace/db";
import { logVibaEvent } from "./vibaVault";

export type BrowserSessionStatus = "created" | "waiting_for_login" | "authenticated" | "confirmed" | "expired" | "revoked" | "failed";

function key(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.MASTER_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!raw || raw.length < 16) throw new Error("CREDENTIAL_ENCRYPTION_KEY or MASTER_ENCRYPTION_KEY is required for browser session handoff.");
  return crypto.createHash("sha256").update(raw).digest();
}

function seal(value: string): { encrypted: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { encrypted: encrypted.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export async function ensureBrowserSessionTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_browser_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      provider TEXT NOT NULL,
      start_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      encrypted_profile_ref TEXT,
      iv TEXT,
      auth_tag TEXT,
      authenticated_at TIMESTAMPTZ,
      confirmed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '12 hours',
      revoked_at TIMESTAMPTZ,
      last_used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_browser_sessions_user ON viba_browser_sessions (user_id, provider, status)`);
}

export async function startBrowserSession(input: { userId?: number | null; provider: string; startUrl: string; ttlHours?: number }): Promise<Record<string, unknown>> {
  await ensureBrowserSessionTable();
  const ttl = Math.min(Math.max(input.ttlHours ?? 12, 1), 72);
  const { rows } = await pool.query(
    `INSERT INTO viba_browser_sessions (user_id, provider, start_url, status, expires_at)
     VALUES ($1, $2, $3, 'waiting_for_login', NOW() + ($4 || ' hours')::interval)
     RETURNING id, user_id, provider, start_url, status, authenticated_at, confirmed_at, expires_at, revoked_at, last_used_at, created_at, updated_at`,
    [input.userId ?? null, input.provider, input.startUrl, ttl],
  );
  await logVibaEvent({ userId: input.userId ?? null, eventType: "browser_session_started", provider: input.provider, status: "waiting_for_login", message: `Browser session started for ${input.provider}.`, metadata: { startUrl: input.startUrl } });
  return rows[0] ?? {};
}

export async function confirmBrowserSession(input: { id: number; userId?: number | null; profileRef: string }): Promise<Record<string, unknown>> {
  await ensureBrowserSessionTable();
  const sealed = seal(input.profileRef);
  const { rows } = await pool.query(
    `UPDATE viba_browser_sessions
        SET status = 'confirmed', encrypted_profile_ref = $1, iv = $2, auth_tag = $3, authenticated_at = COALESCE(authenticated_at, NOW()), confirmed_at = NOW(), updated_at = NOW()
      WHERE id = $4 AND (user_id = $5 OR user_id IS NULL) AND revoked_at IS NULL AND expires_at > NOW()
      RETURNING id, user_id, provider, start_url, status, authenticated_at, confirmed_at, expires_at, revoked_at, last_used_at, created_at, updated_at`,
    [sealed.encrypted, sealed.iv, sealed.tag, input.id, input.userId ?? null],
  );
  const row = rows[0] ?? null;
  if (row) await logVibaEvent({ userId: input.userId ?? null, eventType: "browser_session_confirmed", provider: String(row.provider), status: "confirmed", message: `Browser session confirmed for ${row.provider}.`, metadata: { sessionId: input.id } });
  return row ?? {};
}

export async function revokeBrowserSession(input: { id: number; userId?: number | null }): Promise<Record<string, unknown>> {
  await ensureBrowserSessionTable();
  const { rows } = await pool.query(
    `UPDATE viba_browser_sessions
        SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)
      RETURNING id, user_id, provider, start_url, status, authenticated_at, confirmed_at, expires_at, revoked_at, last_used_at, created_at, updated_at`,
    [input.id, input.userId ?? null],
  );
  const row = rows[0] ?? null;
  if (row) await logVibaEvent({ userId: input.userId ?? null, eventType: "browser_session_revoked", provider: String(row.provider), status: "revoked", message: `Browser session revoked for ${row.provider}.`, metadata: { sessionId: input.id } });
  return row ?? {};
}

export async function listBrowserSessions(userId?: number | null): Promise<Record<string, unknown>[]> {
  await ensureBrowserSessionTable();
  const { rows } = await pool.query(
    `SELECT id, user_id, provider, start_url, status, authenticated_at, confirmed_at, expires_at, revoked_at, last_used_at, created_at, updated_at
       FROM viba_browser_sessions
      WHERE user_id = $1 OR user_id IS NULL
      ORDER BY created_at DESC
      LIMIT 100`,
    [userId ?? null],
  );
  return rows;
}

export async function getBrowserSession(input: { id: number; userId?: number | null }): Promise<Record<string, unknown>> {
  await ensureBrowserSessionTable();
  const { rows } = await pool.query(
    `SELECT id, user_id, provider, start_url, status, authenticated_at, confirmed_at, expires_at, revoked_at, last_used_at, created_at, updated_at
       FROM viba_browser_sessions
      WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)
      LIMIT 1`,
    [input.id, input.userId ?? null],
  );
  return rows[0] ?? {};
}
