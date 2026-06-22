import { Router, raw, type IRouter, type Request, type Response } from "express";
import { pool, db, messagesTable } from "@workspace/db";
import { logVibaEvent } from "../lib/vibaVault";

const router: IRouter = Router();

const MAX_ATTACHMENT_BYTES = Number(process.env.VIBA_MAX_ATTACHMENT_BYTES ?? 25 * 1024 * 1024);

function idParam(value: string | string[] | undefined): number | null {
  const normalized = Array.isArray(value) ? value[0] : value;
  const id = Number(normalized);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function headerValue(req: Request, name: string): string | null {
  const value = req.header(name);
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" && first.trim() ? first.trim() : null;
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeFileName(input: string | null): string {
  const cleaned = (input ?? "upload.bin").replace(/[\\/\0]/g, "_").slice(0, 180).trim();
  return cleaned || "upload.bin";
}

function categoryForMime(mimeType: string): "image" | "video" | "file" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

async function ensureAttachmentTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_attachments (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL,
      user_id INTEGER,
      message_id INTEGER,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      category TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      data BYTEA NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_attachments_session ON viba_attachments (session_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_attachments_message ON viba_attachments (message_id)`);
}

router.post(
  "/sessions/:id/attachments",
  raw({ type: "*/*", limit: MAX_ATTACHMENT_BYTES }),
  async (req: Request, res: Response): Promise<void> => {
    const sessionId = idParam(req.params.id);
    if (!sessionId) { res.status(400).json({ error: "valid session id required" }); return; }

    const fileBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!fileBuffer.length) { res.status(400).json({ error: "file body required" }); return; }
    if (fileBuffer.length > MAX_ATTACHMENT_BYTES) { res.status(413).json({ error: "file too large", maxBytes: MAX_ATTACHMENT_BYTES }); return; }

    const mimeType = headerValue(req, "content-type") ?? "application/octet-stream";
    const fileName = safeFileName(headerValue(req, "x-file-name"));
    const caption = headerValue(req, "x-viba-caption") ?? headerValue(req, "x-message") ?? "";
    const category = categoryForMime(mimeType);
    const uid = userId(req);

    await ensureAttachmentTable();

    const [message] = await db.insert(messagesTable).values({
      sessionId,
      role: "user",
      provider: null,
      content: caption || `Uploaded ${category}: ${fileName}`,
      agentName: "User",
      agentRole: "Human",
      messageType: "input",
      metadata: {
        upload: true,
        fileName,
        mimeType,
        category,
        sizeBytes: fileBuffer.length,
      },
    }).returning();

    const { rows } = await pool.query(
      `INSERT INTO viba_attachments
        (session_id, user_id, message_id, file_name, mime_type, category, size_bytes, data, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, session_id, user_id, message_id, file_name, mime_type, category, size_bytes, created_at`,
      [sessionId, uid, message?.id ?? null, fileName, mimeType, category, fileBuffer.length, fileBuffer, JSON.stringify({ caption })],
    );

    await logVibaEvent({
      userId: uid,
      sessionId,
      eventType: "attachment_uploaded",
      provider: "viba",
      status: "uploaded",
      message: `User uploaded ${category}: ${fileName}`,
      metadata: { attachmentId: rows[0]?.id, messageId: message?.id, fileName, mimeType, category, sizeBytes: fileBuffer.length },
    });

    res.status(201).json({ ok: true, attachment: rows[0], message });
  },
);

router.get("/sessions/:id/attachments", async (req: Request, res: Response): Promise<void> => {
  const sessionId = idParam(req.params.id);
  if (!sessionId) { res.status(400).json({ error: "valid session id required" }); return; }
  await ensureAttachmentTable();
  const { rows } = await pool.query(
    `SELECT id, session_id, user_id, message_id, file_name, mime_type, category, size_bytes, created_at
       FROM viba_attachments
      WHERE session_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 200`,
    [sessionId],
  );
  res.json({ attachments: rows });
});

router.get("/sessions/:id/attachments/:attachmentId/download", async (req: Request, res: Response): Promise<void> => {
  const sessionId = idParam(req.params.id);
  const attachmentId = idParam(req.params.attachmentId);
  if (!sessionId || !attachmentId) { res.status(400).json({ error: "valid ids required" }); return; }
  await ensureAttachmentTable();
  const { rows } = await pool.query<{ file_name: string; mime_type: string; data: Buffer }>(
    `SELECT file_name, mime_type, data
       FROM viba_attachments
      WHERE id = $1 AND session_id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [attachmentId, sessionId],
  );
  const row = rows[0];
  if (!row) { res.status(404).json({ error: "attachment not found" }); return; }
  res.setHeader("Content-Type", row.mime_type);
  res.setHeader("Content-Disposition", `attachment; filename="${safeFileName(row.file_name)}"`);
  res.send(row.data);
});

router.delete("/sessions/:id/attachments/:attachmentId", async (req: Request, res: Response): Promise<void> => {
  const sessionId = idParam(req.params.id);
  const attachmentId = idParam(req.params.attachmentId);
  if (!sessionId || !attachmentId) { res.status(400).json({ error: "valid ids required" }); return; }
  await ensureAttachmentTable();
  await pool.query(
    `UPDATE viba_attachments SET deleted_at = NOW() WHERE id = $1 AND session_id = $2`,
    [attachmentId, sessionId],
  );
  await logVibaEvent({ userId: userId(req), sessionId, eventType: "attachment_deleted", provider: "viba", status: "deleted", message: `Attachment ${attachmentId} deleted.` });
  res.json({ ok: true });
});

export default router;
