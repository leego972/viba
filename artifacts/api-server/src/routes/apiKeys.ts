import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { ensureApiKeysTable, generateApiKey, hashApiKey, requireSessionUser } from "../middlewares/apiKeyAuth";

const router: IRouter = Router();
const DEFAULT_SCOPES = ["task-intake"];

function safeKey(row: Record<string, unknown>) {
  return {
    id: row["id"],
    key_prefix: row["key_prefix"],
    label: row["label"],
    scopes: row["scopes"],
    created_at: row["created_at"],
    last_used_at: row["last_used_at"],
    revoked_at: row["revoked_at"],
  };
}

router.post("/api-keys", async (req, res): Promise<void> => {
  const userId = requireSessionUser(req, res);
  if (!userId) return;

  const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  if (!label || label.length > 80) {
    res.status(400).json({ error: "invalid_label", message: "label is required and must be 80 characters or fewer." });
    return;
  }

  const requestedScopes = Array.isArray(req.body?.scopes) ? req.body.scopes : DEFAULT_SCOPES;
  const scopes = requestedScopes.filter((scope: unknown): scope is string => scope === "task-intake");
  if (scopes.length === 0) {
    res.status(400).json({ error: "invalid_scopes", allowed_scopes: DEFAULT_SCOPES });
    return;
  }

  await ensureApiKeysTable();
  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 18);
  const { rows } = await pool.query<Record<string, unknown>>(
    `INSERT INTO viba_api_keys (user_id, key_hash, key_prefix, label, scopes)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id, key_prefix, label, scopes, created_at, last_used_at, revoked_at`,
    [userId, keyHash, keyPrefix, label, JSON.stringify(scopes)],
  );

  res.status(201).json({
    api_key: rawKey,
    ...safeKey(rows[0] ?? {}),
    warning: "Store this key securely. It will not be shown again.",
  });
});

router.get("/api-keys", async (req, res): Promise<void> => {
  const userId = requireSessionUser(req, res);
  if (!userId) return;

  await ensureApiKeysTable();
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT id, key_prefix, label, scopes, created_at, last_used_at, revoked_at
       FROM viba_api_keys
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  );
  res.json({ keys: rows.map(safeKey) });
});

router.post("/api-keys/:id/revoke", async (req, res): Promise<void> => {
  const userId = requireSessionUser(req, res);
  if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid_key_id" });
    return;
  }

  await ensureApiKeysTable();
  const { rows } = await pool.query<Record<string, unknown>>(
    `UPDATE viba_api_keys
        SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE id = $1 AND user_id = $2
      RETURNING id, key_prefix, label, scopes, created_at, last_used_at, revoked_at`,
    [id, userId],
  );
  if (!rows[0]) {
    res.status(404).json({ error: "api_key_not_found" });
    return;
  }
  res.json({ ok: true, key: safeKey(rows[0]) });
});

export default router;
