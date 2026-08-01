import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "@workspace/db";

const KEY_PREFIX = "viba_live_";
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export type VibaAuthMethod = "session" | "api_key";

export interface VibaAuthContext {
  userId: number;
  method: VibaAuthMethod;
  apiKeyId?: number;
  scopes: string[];
}

export async function ensureApiKeysTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_api_keys (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      label TEXT NOT NULL,
      scopes JSONB NOT NULL DEFAULT '["task-intake"]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_api_keys_user ON viba_api_keys (user_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_api_keys_prefix ON viba_api_keys (key_prefix)`);
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

export function generateApiKey(): string {
  let token = "";
  while (token.length < 48) {
    for (const byte of randomBytes(64)) {
      if (byte >= 248) continue;
      token += BASE62[byte % 62];
      if (token.length === 48) break;
    }
  }
  return `${KEY_PREFIX}${token}`;
}

function bearerToken(req: Request): string | null {
  const header = req.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}

export function requireSessionUser(req: Request, res: Response): number | null {
  const userId = req.session?.userId;
  if (typeof userId !== "number" || userId <= 0) {
    res.status(401).json({ error: "session_auth_required", message: "Log in to manage API keys." });
    return null;
  }
  return userId;
}

export function requireSessionOrApiKey(requiredScope: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const sessionUserId = req.session?.userId;
    if (typeof sessionUserId === "number" && sessionUserId > 0) {
      res.locals.vibaAuth = { userId: sessionUserId, method: "session", scopes: ["*"] } satisfies VibaAuthContext;
      next();
      return;
    }

    const rawKey = bearerToken(req);
    if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) {
      res.status(401).json({ error: "authentication_required", message: "Use a VIBA session or Authorization: Bearer <api-key>." });
      return;
    }

    await ensureApiKeysTable();
    const keyHash = hashApiKey(rawKey);
    const { rows } = await pool.query<{
      id: number;
      user_id: number;
      scopes: unknown;
      revoked_at: Date | null;
    }>(
      `SELECT id, user_id, scopes, revoked_at FROM viba_api_keys WHERE key_hash = $1 LIMIT 1`,
      [keyHash],
    );
    const row = rows[0];
    if (!row || row.revoked_at) {
      res.status(401).json({ error: "invalid_api_key", message: "The API key is invalid or revoked." });
      return;
    }

    const scopes = Array.isArray(row.scopes) ? row.scopes.filter((scope): scope is string => typeof scope === "string") : [];
    if (!scopes.includes(requiredScope) && !scopes.includes("*")) {
      res.status(403).json({ error: "insufficient_scope", required_scope: requiredScope });
      return;
    }

    res.locals.vibaAuth = { userId: row.user_id, method: "api_key", apiKeyId: row.id, scopes } satisfies VibaAuthContext;
    if (req.session) req.session.userId = row.user_id;
    await pool.query(`UPDATE viba_api_keys SET last_used_at = NOW() WHERE id = $1`, [row.id]);
    next();
  };
}

export function authenticatedUserId(res: Response): number | null {
  const auth = res.locals.vibaAuth as VibaAuthContext | undefined;
  return auth?.userId ?? null;
}
