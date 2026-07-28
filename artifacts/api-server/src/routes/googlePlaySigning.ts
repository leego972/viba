import { Router, type Request, type Response } from "express";
import { createCipheriv, createHash, randomBytes } from "crypto";
import { pool } from "@workspace/db";

const router = Router();
const uid = (req: Request) => { if (!req.session?.userId) throw new Error("Unauthenticated"); return req.session.userId; };
const send = (res: Response, status: number, body: unknown) => res.status(status).json(body);

function encrypt(value: Buffer | string): string {
  const raw = process.env.PLAY_PUBLISHER_MASTER_KEY;
  if (!raw) throw new Error("PLAY_PUBLISHER_MASTER_KEY is required");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(raw).digest(), iv);
  const body = Buffer.concat([cipher.update(value), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

async function schema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS play_publisher_signing (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    app_id INTEGER NOT NULL REFERENCES play_publisher_apps(id) ON DELETE CASCADE,
    encrypted_keystore TEXT NOT NULL,
    encrypted_store_password TEXT NOT NULL,
    key_alias TEXT NOT NULL,
    encrypted_key_password TEXT NOT NULL,
    certificate_sha256 TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, app_id)
  )`);
}

router.post("/play-publisher/apps/:id/signing", async (req, res) => {
  try {
    await schema();
    const userId = uid(req); const appId = Number(req.params.id);
    const { keystoreBase64, storePassword, keyAlias, keyPassword } = req.body as Record<string, string>;
    if (!keystoreBase64 || !storePassword || !keyAlias || !keyPassword) return send(res, 400, { error: "Keystore file, store password, alias and key password are required" });
    const app = await pool.query("SELECT id FROM play_publisher_apps WHERE id=$1 AND user_id=$2", [appId, userId]);
    if (!app.rows[0]) return send(res, 404, { error: "App not found" });
    const bytes = Buffer.from(keystoreBase64.replace(/^data:.*;base64,/, ""), "base64");
    if (bytes.length < 100 || bytes.length > 5 * 1024 * 1024) return send(res, 400, { error: "Invalid keystore size" });
    const fingerprint = createHash("sha256").update(bytes).digest("hex");
    await pool.query(`INSERT INTO play_publisher_signing(user_id,app_id,encrypted_keystore,encrypted_store_password,key_alias,encrypted_key_password,certificate_sha256)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(user_id,app_id) DO UPDATE SET encrypted_keystore=EXCLUDED.encrypted_keystore,encrypted_store_password=EXCLUDED.encrypted_store_password,key_alias=EXCLUDED.key_alias,encrypted_key_password=EXCLUDED.encrypted_key_password,certificate_sha256=EXCLUDED.certificate_sha256,updated_at=NOW()`,
      [userId, appId, encrypt(bytes), encrypt(storePassword), keyAlias.slice(0, 120), encrypt(keyPassword), fingerprint]);
    res.json({ configured: true, fingerprint });
  } catch (error) { send(res, 400, { error: error instanceof Error ? error.message : "Signing setup failed" }); }
});

router.get("/play-publisher/apps/:id/signing", async (req, res) => {
  try {
    await schema();
    const result = await pool.query("SELECT key_alias,certificate_sha256,updated_at FROM play_publisher_signing WHERE app_id=$1 AND user_id=$2", [Number(req.params.id), uid(req)]);
    res.json(result.rows[0] ? { configured: true, ...result.rows[0] } : { configured: false });
  } catch (error) { send(res, 500, { error: error instanceof Error ? error.message : "Signing lookup failed" }); }
});

export default router;
