import { db, messagesTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logVibaEvent } from "./vibaVault";

const MAX_SYSTEM_ARTIFACT_BYTES = Number(process.env["VIBA_MAX_SYSTEM_ARTIFACT_BYTES"] ?? 25 * 1024 * 1024);

type ArtifactFileInput = {
  fileName: string;
  content: string;
  mimeType?: string;
  encoding?: "utf8" | "base64";
};

export type DeliverArtifactInput = {
  sessionId: number;
  userId?: number | null;
  taskId?: number | string | null;
  agentName?: string | null;
  agentRole?: string | null;
  artifactType: "document" | "file" | "zip";
  fileName: string;
  mimeType?: string;
  content?: string;
  encoding?: "utf8" | "base64";
  files?: ArtifactFileInput[];
  messageText?: string;
  metadata?: Record<string, unknown>;
};

type AttachmentRow = {
  id: number;
  session_id: number;
  user_id: number | null;
  message_id: number | null;
  file_name: string;
  mime_type: string;
  category: string;
  size_bytes: number;
  created_at: string;
};

function safeFileName(input: string | null | undefined): string {
  const cleaned = (input ?? "viba-artifact.txt").replace(/[\\/\0]/g, "_").slice(0, 180).trim();
  return cleaned || "viba-artifact.txt";
}

function normaliseTextContent(value: string | undefined): Buffer {
  return Buffer.from(value ?? "", "utf8");
}

function bufferFromInput(content: string | undefined, encoding: "utf8" | "base64" = "utf8"): Buffer {
  if (!content) return Buffer.alloc(0);
  return encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf8");
}

function mimeForArtifact(input: DeliverArtifactInput): string {
  if (input.mimeType) return input.mimeType;
  if (input.artifactType === "zip") return "application/zip";
  if (input.artifactType === "document") return "text/markdown; charset=utf-8";
  return "application/octet-stream";
}

function categoryForArtifact(type: DeliverArtifactInput["artifactType"]): "document" | "archive" | "file" {
  if (type === "zip") return "archive";
  if (type === "document") return "document";
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

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function u16(value: number) { const b = Buffer.alloc(2); b.writeUInt16LE(value & 0xffff, 0); return b; }
function u32(value: number) { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0, 0); return b; }

function createZip(files: ArtifactFileInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const now = dosDateTime();

  for (const input of files) {
    const name = Buffer.from(safeFileName(input.fileName), "utf8");
    const data = bufferFromInput(input.content, input.encoding ?? "utf8");
    const crc = crc32(data);
    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(now.dosTime), u16(now.dosDate),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name,
    ]);
    localParts.push(localHeader, data);
    const centralHeader = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(now.dosTime), u16(now.dosDate),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralDirectory.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function buildArtifactBuffer(input: DeliverArtifactInput): Buffer {
  if (input.artifactType === "zip") {
    const files = input.files?.length ? input.files : [{ fileName: "README.md", content: input.content ?? "VIBA generated artifact bundle." }];
    return createZip(files.map((file) => ({ ...file, fileName: safeFileName(file.fileName) })));
  }
  return input.artifactType === "document" ? normaliseTextContent(input.content) : bufferFromInput(input.content, input.encoding ?? "utf8");
}

export async function deliverSystemArtifactToUser(input: DeliverArtifactInput) {
  if (!Number.isFinite(input.sessionId) || input.sessionId <= 0) throw new Error("valid sessionId required");

  const fileName = safeFileName(input.fileName);
  const mimeType = mimeForArtifact(input);
  const category = categoryForArtifact(input.artifactType);
  const data = buildArtifactBuffer(input);
  if (!data.length) throw new Error("artifact content required");
  if (data.length > MAX_SYSTEM_ARTIFACT_BYTES) throw new Error(`artifact too large; max ${MAX_SYSTEM_ARTIFACT_BYTES} bytes`);

  await ensureAttachmentTable();

  const messageText = input.messageText || `Generated ${category}: ${fileName}`;
  const [message] = await db.insert(messagesTable).values({
    sessionId: input.sessionId,
    role: "assistant",
    provider: "viba",
    content: `${messageText}\n\nDownload: ${fileName}`,
    taskId: input.taskId ? Number(input.taskId) || null : null,
    agentName: input.agentName ?? "VIBA Artifact Generator",
    agentRole: input.agentRole ?? "System Artifact Delivery",
    messageType: "output",
    metadata: {
      generatedArtifact: true,
      artifactType: input.artifactType,
      fileName,
      mimeType,
      category,
      sizeBytes: data.length,
      delivery: "assistant_to_user_chatbox",
      ...(input.metadata ?? {}),
    },
  } as never).returning();

  const { rows } = await pool.query<AttachmentRow>(
    `INSERT INTO viba_attachments
      (session_id, user_id, message_id, file_name, mime_type, category, size_bytes, data, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, session_id, user_id, message_id, file_name, mime_type, category, size_bytes, created_at`,
    [input.sessionId, input.userId ?? null, message?.id ?? null, fileName, mimeType, category, data.length, data, JSON.stringify({ generatedBySystem: true, artifactType: input.artifactType, ...(input.metadata ?? {}) })],
  );

  const attachment = rows[0];
  const downloadUrl = `/api/sessions/${input.sessionId}/attachments/${attachment?.id}/download`;

  if (message?.id && attachment?.id) {
    await db.update(messagesTable).set({
      metadata: {
        generatedArtifact: true,
        artifactType: input.artifactType,
        fileName,
        mimeType,
        category,
        sizeBytes: data.length,
        delivery: "assistant_to_user_chatbox",
        attachments: [{ id: attachment.id, fileName, mimeType, category, sizeBytes: data.length, downloadUrl }],
        ...(input.metadata ?? {}),
      },
    } as never).where(eq(messagesTable.id, message.id));
  }

  await logVibaEvent({
    userId: input.userId ?? null,
    sessionId: input.sessionId,
    eventType: "system_artifact_delivered",
    provider: "viba",
    status: "delivered",
    message: `VIBA delivered ${category}: ${fileName}`,
    metadata: { attachmentId: attachment?.id, messageId: message?.id, fileName, mimeType, category, sizeBytes: data.length, downloadUrl },
  });

  return {
    ok: true,
    messageId: message?.id ?? null,
    attachment: attachment ? { ...attachment, downloadUrl } : null,
    rawValuesReturned: false,
  };
}
