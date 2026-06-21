import crypto from "crypto";
import { pool } from "@workspace/db";

export type VibaProvider = "github" | "railway" | "railway_mcp" | "openai" | "anthropic" | "gemini" | "perplexity" | "groq" | "replit" | "manus";

function vaultKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.MASTER_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!raw || raw.length < 16) throw new Error("CREDENTIAL_ENCRYPTION_KEY or MASTER_ENCRYPTION_KEY is required.");
  return crypto.createHash("sha256").update(raw).digest();
}

function seal(value: string): { encrypted: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", vaultKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { encrypted: encrypted.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function open(row: { encrypted_value: string; iv: string; auth_tag: string }): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", vaultKey(), Buffer.from(row.iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(row.encrypted_value, "base64")), decipher.final()]).toString("utf8");
}

export async function ensureVibaVault(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_credentials (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      provider TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'default',
      encrypted_value TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'saved',
      last_validated_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, provider, kind, label)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_activity_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      session_id INTEGER,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      provider TEXT,
      subject TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      message TEXT NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function saveVibaCredential(input: { userId?: number | null; provider: string; kind: string; value: string; label?: string }): Promise<void> {
  await ensureVibaVault();
  const packed = seal(input.value);
  await pool.query(
    `INSERT INTO viba_credentials (user_id, provider, kind, label, encrypted_value, iv, auth_tag, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'saved', NOW())
     ON CONFLICT (user_id, provider, kind, label)
     DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value,
                   iv = EXCLUDED.iv,
                   auth_tag = EXCLUDED.auth_tag,
                   status = 'saved',
                   last_error = NULL,
                   updated_at = NOW()`,
    [input.userId ?? null, input.provider, input.kind, input.label ?? "default", packed.encrypted, packed.iv, packed.tag],
  );
}

export async function getVibaCredential(input: { userId?: number | null; provider: string; kind: string; label?: string }): Promise<string | null> {
  await ensureVibaVault();
  const { rows } = await pool.query<{ encrypted_value: string; iv: string; auth_tag: string }>(
    `SELECT encrypted_value, iv, auth_tag FROM viba_credentials
      WHERE (user_id = $1 OR user_id IS NULL) AND provider = $2 AND kind = $3 AND label = $4
      ORDER BY user_id NULLS LAST, updated_at DESC LIMIT 1`,
    [input.userId ?? null, input.provider, input.kind, input.label ?? "default"],
  );
  return rows[0] ? open(rows[0]) : null;
}

export async function resolveVibaCredential(input: { userId?: number | null; provider: string; kind: string; envNames: string[]; label?: string }): Promise<{ value: string | null; source: "env" | "vault" | "missing"; missing: string[] }> {
  for (const envName of input.envNames) {
    const val = process.env[envName];
    if (val && val.trim()) return { value: val.trim(), source: "env", missing: [] };
  }
  const saved = await getVibaCredential(input);
  if (saved) return { value: saved, source: "vault", missing: [] };
  return { value: null, source: "missing", missing: input.envNames };
}

export async function listVibaCredentials(userId?: number | null): Promise<Array<Record<string, unknown>>> {
  await ensureVibaVault();
  const { rows } = await pool.query(
    `SELECT provider, kind, label, status, last_validated_at, last_error, updated_at
       FROM viba_credentials
      WHERE user_id = $1 OR user_id IS NULL
      ORDER BY provider ASC, kind ASC`,
    [userId ?? null],
  );
  return rows;
}

export async function markVibaCredential(input: { userId?: number | null; provider: string; kind: string; label?: string; status: "valid" | "invalid" | "saved"; error?: string | null }): Promise<void> {
  await ensureVibaVault();
  await pool.query(
    `UPDATE viba_credentials SET status = $1, last_validated_at = NOW(), last_error = $2, updated_at = NOW()
      WHERE (user_id = $3 OR user_id IS NULL) AND provider = $4 AND kind = $5 AND label = $6`,
    [input.status, input.error ?? null, input.userId ?? null, input.provider, input.kind, input.label ?? "default"],
  );
}

export async function logVibaEvent(input: { userId?: number | null; sessionId?: number | null; eventType: string; severity?: string; provider?: string | null; subject?: string | null; status?: string; message: string; metadata?: Record<string, unknown> | null }): Promise<void> {
  await ensureVibaVault();
  await pool.query(
    `INSERT INTO viba_activity_logs (user_id, session_id, event_type, severity, provider, subject, status, message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [input.userId ?? null, input.sessionId ?? null, input.eventType, input.severity ?? "info", input.provider ?? null, input.subject ?? null, input.status ?? "created", input.message, input.metadata ? JSON.stringify(input.metadata) : null],
  );
}
