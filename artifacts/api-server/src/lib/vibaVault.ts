import crypto from "crypto";
import { pool } from "@workspace/db";

export type VibaProvider = "github" | "railway" | "railway_mcp" | "openai" | "anthropic" | "gemini" | "perplexity" | "groq" | "mistral" | "deepseek" | "custom_ai" | string;

function vaultKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.MASTER_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!raw || raw.length < 16) throw new Error("CREDENTIAL_ENCRYPTION_KEY or MASTER_ENCRYPTION_KEY is required.");
  return crypto.createHash("sha256").update(raw).digest();
}

function ownerId(userId?: number | null): number {
  return typeof userId === "number" && Number.isFinite(userId) ? userId : 0;
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

const SENSITIVE_PATTERNS = /token|secret|password|key|credential|cookie|session|private|webhook|database_url|smtp_pass|api_key|access_token|refresh_token|oauth/i;

export function isSensitiveCredentialName(name: string): boolean {
  return SENSITIVE_PATTERNS.test(name);
}

const REDACT_KEYS = new Set([
  "value", "key", "token", "secret", "password", "api_key", "access_token",
  "refresh_token", "oauth_token", "webhook_secret", "database_url", "smtp_pass",
  "private_key", "cookie", "session_secret", "credential",
]);

export function redactCredentialMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object") return {};
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (REDACT_KEYS.has(k.toLowerCase()) || isSensitiveCredentialName(k)) {
      result[k] = "[REDACTED]";
    } else if (typeof v === "string" && isSensitiveCredentialName(k)) {
      result[k] = "[REDACTED]";
    } else {
      result[k] = v;
    }
  }
  return result;
}

export async function ensureVibaVault(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_credentials (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL DEFAULT 0,
      provider TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'default',
      encrypted_value TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'saved',
      scope TEXT NOT NULL DEFAULT 'all',
      expires_at TIMESTAMPTZ,
      last_used_at TIMESTAMPTZ,
      allowed_use_json JSONB DEFAULT '{}',
      last_validated_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, provider, kind, label)
    )
  `);

  // Idempotent column additions for existing deployments
  const alterCmds = [
    `ALTER TABLE viba_credentials ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'all'`,
    `ALTER TABLE viba_credentials ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
    `ALTER TABLE viba_credentials ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ`,
    `ALTER TABLE viba_credentials ADD COLUMN IF NOT EXISTS allowed_use_json JSONB DEFAULT '{}'`,
  ];
  for (const cmd of alterCmds) {
    await pool.query(cmd);
  }

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_credential_access_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      provider TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'default',
      purpose TEXT,
      job_id TEXT,
      scope TEXT,
      source TEXT NOT NULL DEFAULT 'vault',
      status TEXT NOT NULL DEFAULT 'granted',
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_activity_logs_session ON viba_activity_logs (session_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_activity_logs_user ON viba_activity_logs (user_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_cred_access_logs_user ON viba_credential_access_logs (user_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_cred_access_logs_provider ON viba_credential_access_logs (provider, created_at DESC)`);
}

export async function saveVibaCredential(input: {
  userId?: number | null;
  provider: string;
  kind: string;
  value: string;
  label?: string;
  scope?: string;
  expiresAt?: Date | null;
  allowedUse?: Record<string, unknown>;
}): Promise<void> {
  await ensureVibaVault();
  const packed = seal(input.value);
  await pool.query(
    `INSERT INTO viba_credentials (user_id, provider, kind, label, encrypted_value, iv, auth_tag, status, scope, expires_at, allowed_use_json, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'saved', $8, $9, $10, NOW())
     ON CONFLICT (user_id, provider, kind, label)
     DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value,
                   iv = EXCLUDED.iv,
                   auth_tag = EXCLUDED.auth_tag,
                   status = 'saved',
                   scope = EXCLUDED.scope,
                   expires_at = EXCLUDED.expires_at,
                   allowed_use_json = EXCLUDED.allowed_use_json,
                   last_error = NULL,
                   updated_at = NOW()`,
    [
      ownerId(input.userId),
      input.provider,
      input.kind,
      input.label ?? "default",
      packed.encrypted,
      packed.iv,
      packed.tag,
      input.scope ?? "all",
      input.expiresAt ?? null,
      JSON.stringify(input.allowedUse ?? {}),
    ],
  );
}

export async function getVibaCredential(input: { userId?: number | null; provider: string; kind: string; label?: string }): Promise<string | null> {
  await ensureVibaVault();
  const currentOwnerId = ownerId(input.userId);
  const { rows } = await pool.query<{ encrypted_value: string; iv: string; auth_tag: string }>(
    `SELECT encrypted_value, iv, auth_tag FROM viba_credentials
      WHERE user_id IN ($1, 0) AND provider = $2 AND kind = $3 AND label = $4
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY CASE WHEN user_id = $1 THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`,
    [currentOwnerId, input.provider, input.kind, input.label ?? "default"],
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

export async function resolveVibaCredentialForUse(input: {
  userId?: number | null;
  provider: string;
  kind: string;
  envNames: string[];
  label?: string;
  scope?: string;
  purpose?: string;
  jobId?: string;
}): Promise<{ value: string | null; source: "env" | "vault" | "missing"; missing: string[] }> {
  for (const envName of input.envNames) {
    const val = process.env[envName];
    if (val && val.trim()) {
      await pool.query(
        `INSERT INTO viba_credential_access_logs (user_id, provider, kind, label, purpose, job_id, scope, source, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'env', 'granted')`,
        [ownerId(input.userId), input.provider, input.kind, input.label ?? "default", input.purpose ?? null, input.jobId ?? null, input.scope ?? "all"],
      ).catch(() => {});
      return { value: val.trim(), source: "env", missing: [] };
    }
  }

  const currentOwnerId = ownerId(input.userId);
  const { rows } = await pool.query<{ id: number; encrypted_value: string; iv: string; auth_tag: string; scope: string; expires_at: Date | null; allowed_use_json: unknown }>(
    `SELECT id, encrypted_value, iv, auth_tag, scope, expires_at, allowed_use_json
       FROM viba_credentials
      WHERE user_id IN ($1, 0) AND provider = $2 AND kind = $3 AND label = $4
      ORDER BY CASE WHEN user_id = $1 THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`,
    [currentOwnerId, input.provider, input.kind, input.label ?? "default"],
  );

  if (!rows[0]) {
    return { value: null, source: "missing", missing: input.envNames };
  }

  const row = rows[0];

  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    await pool.query(
      `INSERT INTO viba_credential_access_logs (user_id, provider, kind, label, purpose, job_id, scope, source, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'vault', 'blocked', $8)`,
      [currentOwnerId, input.provider, input.kind, input.label ?? "default", input.purpose ?? null, input.jobId ?? null, input.scope ?? "all", JSON.stringify({ reason: "expired" })],
    ).catch(() => {});
    return { value: null, source: "missing", missing: input.envNames };
  }

  if (input.scope && row.scope !== "all" && row.scope !== input.scope) {
    await pool.query(
      `INSERT INTO viba_credential_access_logs (user_id, provider, kind, label, purpose, job_id, scope, source, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'vault', 'blocked', $8)`,
      [currentOwnerId, input.provider, input.kind, input.label ?? "default", input.purpose ?? null, input.jobId ?? null, input.scope ?? "all", JSON.stringify({ reason: "scope_mismatch", credentialScope: row.scope, requestedScope: input.scope })],
    ).catch(() => {});
    return { value: null, source: "missing", missing: input.envNames };
  }

  await pool.query(
    `UPDATE viba_credentials SET last_used_at = NOW() WHERE id = $1`,
    [row.id],
  ).catch(() => {});

  await pool.query(
    `INSERT INTO viba_credential_access_logs (user_id, provider, kind, label, purpose, job_id, scope, source, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'vault', 'granted')`,
    [currentOwnerId, input.provider, input.kind, input.label ?? "default", input.purpose ?? null, input.jobId ?? null, input.scope ?? "all"],
  ).catch(() => {});

  return { value: open(row), source: "vault", missing: [] };
}

export async function deleteVibaCredential(input: { userId?: number | null; provider: string; kind: string; label?: string }): Promise<{ deleted: boolean }> {
  await ensureVibaVault();
  const { rowCount } = await pool.query(
    `DELETE FROM viba_credentials WHERE user_id = $1 AND provider = $2 AND kind = $3 AND label = $4`,
    [ownerId(input.userId), input.provider, input.kind, input.label ?? "default"],
  );
  return { deleted: (rowCount ?? 0) > 0 };
}

export async function listVibaCredentials(userId?: number | null): Promise<Array<Record<string, unknown>>> {
  await ensureVibaVault();
  const currentOwnerId = ownerId(userId);
  const { rows } = await pool.query(
    `SELECT provider, kind, label, status, scope, expires_at, last_used_at, last_validated_at, last_error, updated_at
       FROM viba_credentials
      WHERE user_id IN ($1, 0)
      ORDER BY provider ASC, kind ASC`,
    [currentOwnerId],
  );
  return rows;
}

export async function listCredentialAccessLogs(input: { userId?: number | null; provider?: string; limit?: number }): Promise<Array<Record<string, unknown>>> {
  await ensureVibaVault();
  const currentOwnerId = ownerId(input.userId);
  const limit = Math.min(input.limit ?? 100, 500);
  const { rows } = await pool.query(
    `SELECT id, user_id, provider, kind, label, purpose, job_id, scope, source, status, metadata, created_at
       FROM viba_credential_access_logs
      WHERE (user_id = $1 OR user_id = 0)
        AND ($2::text IS NULL OR provider = $2)
      ORDER BY created_at DESC
      LIMIT $3`,
    [currentOwnerId, input.provider ?? null, limit],
  );
  return rows;
}

export async function markVibaCredential(input: { userId?: number | null; provider: string; kind: string; label?: string; status: "valid" | "invalid" | "saved"; error?: string | null }): Promise<void> {
  await ensureVibaVault();
  await pool.query(
    `UPDATE viba_credentials SET status = $1, last_validated_at = NOW(), last_error = $2, updated_at = NOW()
      WHERE user_id = $3 AND provider = $4 AND kind = $5 AND label = $6`,
    [input.status, input.error ?? null, ownerId(input.userId), input.provider, input.kind, input.label ?? "default"],
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
