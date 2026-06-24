import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { redactCredentialMetadata } from "../lib/vibaVault";

const router: IRouter = Router();

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

async function ensureAgentCommsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_agent_comms (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT,
      message_type TEXT NOT NULL DEFAULT 'message',
      message TEXT NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_agent_comms_task ON viba_agent_comms (user_id, task_id, created_at DESC)`);
}

function sanitizeMessage(msg: string): string {
  return msg
    .replace(/\b(sk-[A-Za-z0-9]{20,})\b/g, "[REDACTED_KEY]")
    .replace(/\b(ghp_[A-Za-z0-9]{36,})\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\b([A-Za-z0-9]{32,64})\b/g, (match) => {
      // Redact very long token-like strings (likely keys/tokens)
      if (/^[A-Za-z0-9_\-=]{40,}$/.test(match)) return "[REDACTED_TOKEN]";
      return match;
    });
}

function sanitizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row["id"],
    user_id: row["user_id"],
    task_id: row["task_id"],
    from_agent: row["from_agent"],
    to_agent: row["to_agent"],
    message_type: row["message_type"],
    message: typeof row["message"] === "string" ? sanitizeMessage(row["message"]) : row["message"],
    metadata_redacted: redactCredentialMetadata(row["metadata"] as Record<string, unknown>),
    created_at: row["created_at"],
  };
}

/**
 * GET /api/agent-comms-console/messages
 *
 * List agent communication messages for the current user, optionally filtered by task.
 * Task-scoped: only messages for the requesting user are returned.
 * Metadata is redacted to remove any sensitive values.
 */
router.get("/agent-comms-console/messages", async (req, res): Promise<void> => {
  const uid = userId(req);
  if (!uid) { res.status(401).json({ error: "Authentication required" }); return; }

  await ensureAgentCommsTable();

  const taskId = req.query["task_id"] ? Number(req.query["task_id"]) : null;
  const limit = Math.min(Number(req.query["limit"] ?? 100), 500);

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT id, user_id, task_id, from_agent, to_agent, message_type, message, metadata, created_at
       FROM viba_agent_comms
      WHERE user_id = $1
        AND ($2::integer IS NULL OR task_id = $2)
      ORDER BY created_at DESC
      LIMIT $3`,
    [uid, taskId, limit],
  );

  res.json({
    messages: rows.map(sanitizeRow),
    taskScoped: taskId !== null,
    note: "Messages are task-scoped. Sensitive metadata is redacted. Agents cannot request user passwords — only vault access by provider/kind/scope.",
  });
});

/**
 * POST /api/agent-comms-console/messages
 *
 * Record an agent communication message.
 * - task_id is required: messages are strictly task-scoped
 * - agents cannot request raw credential values — they request vault access by provider/kind/scope
 * - message content is sanitized to remove any accidentally included secrets
 */
router.post("/agent-comms-console/messages", async (req, res): Promise<void> => {
  const uid = userId(req);
  if (!uid) { res.status(401).json({ error: "Authentication required" }); return; }

  await ensureAgentCommsTable();

  const body = req.body as {
    task_id?: unknown;
    from_agent?: unknown;
    to_agent?: unknown;
    message_type?: unknown;
    message?: unknown;
    metadata?: unknown;
  };

  const taskId = typeof body.task_id === "number" ? body.task_id : parseInt(String(body.task_id ?? ""), 10);
  if (!taskId || isNaN(taskId)) { res.status(400).json({ error: "task_id (integer) is required" }); return; }

  const fromAgent = typeof body.from_agent === "string" ? body.from_agent.trim().slice(0, 128) : "";
  if (!fromAgent) { res.status(400).json({ error: "from_agent is required" }); return; }

  const toAgent = typeof body.to_agent === "string" ? body.to_agent.trim().slice(0, 128) : null;
  const messageType = typeof body.message_type === "string" ? body.message_type.trim().slice(0, 64) : "message";
  const rawMessage = typeof body.message === "string" ? body.message.trim() : "";
  if (!rawMessage) { res.status(400).json({ error: "message is required" }); return; }

  const message = sanitizeMessage(rawMessage);

  const rawMetadata = body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : {};

  if (rawMetadata["password"] || rawMetadata["raw_key"] || rawMetadata["secret_value"]) {
    res.status(400).json({
      error: "Agents must not pass raw credential values in metadata. Request vault access by provider/kind/scope instead.",
    });
    return;
  }

  const metadata = redactCredentialMetadata(rawMetadata);

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO viba_agent_comms (user_id, task_id, from_agent, to_agent, message_type, message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [uid, taskId, fromAgent, toAgent, messageType, message, JSON.stringify(metadata)],
  );

  res.status(201).json({
    ok: true,
    id: rows[0]?.id,
    task_id: taskId,
    from_agent: fromAgent,
    to_agent: toAgent,
    message_type: messageType,
    note: "Message recorded. Task-scoped: visible only to the owning user within this task.",
  });
});

/**
 * GET /api/agent-comms-console/policy
 *
 * Returns the agent communication policy for VIBA.
 */
router.get("/agent-comms-console/policy", (_req, res): void => {
  res.json({
    policy: {
      title: "VIBA Agent Communication Policy",
      overview: "Agents can collaborate through VIBA. All communication is task-scoped, user-owned, and audited.",
      rules: [
        "Groq is the default coordinator model (fast, low-cost).",
        "BYOK providers (OpenAI, Claude, Gemini, Perplexity, Replit, Manus, custom) may join if the user has connected them.",
        "All credential access is server-side and audited in viba_credential_access_logs.",
        "Agents must request vault access by provider/kind/scope — they never receive raw credential values.",
        "Agents cannot request user passwords.",
        "Messages are strictly task-scoped — no cross-task message leakage.",
        "Users can view all agent messages via GET /api/agent-comms-console/messages.",
        "Users can pause or cancel any task. Paused tasks block further agent activity.",
        "All message content is sanitized to remove accidentally included secrets.",
        "Metadata is redacted before storage and display.",
      ],
      credentialAccessModel: {
        allowed: "Agents may request: { provider: 'openai', kind: 'api_key', scope: 'inference', purpose: 'task_N_analysis' }",
        blocked: "Agents may not request: raw API keys, passwords, tokens, or any credential value directly",
        auditTrail: "Every credential access is logged in viba_credential_access_logs with user_id, provider, kind, purpose, job_id, source, status",
      },
      userControls: [
        "View all agent messages: GET /api/agent-comms-console/messages?task_id=N",
        "Pause task: PATCH /api/sessions/:id (pause support in session router)",
        "Cancel task: DELETE /api/sessions/:id",
        "View credential access audit: GET /api/credentials/access-logs",
      ],
    },
  });
});

export default router;
