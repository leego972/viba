/**
 * VIBA Task Intake Router
 *
 * Handles one-input task creation, planning, approval, and evidence reporting.
 * All responses are free of raw credential values.
 */
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { planTask } from "../lib/taskPlanner";
import { listVibaCredentials } from "../lib/vibaVault";

const router: IRouter = Router();

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function requireUser(req: { session?: { userId?: number } }, res: { status: (n: number) => { json: (d: unknown) => void } }): number | null {
  const uid = userId(req);
  if (!uid) { res.status(401).json({ error: "Authentication required" }); return null; }
  return uid;
}

// ─── DB setup ─────────────────────────────────────────────────────────────────

async function ensureTasksTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_tasks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      request TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      plan_json JSONB,
      risk_level TEXT NOT NULL DEFAULT 'low',
      needs_user_approval BOOLEAN NOT NULL DEFAULT FALSE,
      recommended_ai_collaboration BOOLEAN NOT NULL DEFAULT FALSE,
      safe_build_required BOOLEAN NOT NULL DEFAULT FALSE,
      safe_build_passed BOOLEAN,
      approved_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      evidence_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_tasks_user ON viba_tasks (user_id, created_at DESC)`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeTask(row: Record<string, unknown>): Record<string, unknown> {
  return {
    task_id: row["id"],
    user_id: row["user_id"],
    request: row["request"],
    status: row["status"],
    risk_level: row["risk_level"],
    needs_user_approval: row["needs_user_approval"],
    recommended_ai_collaboration: row["recommended_ai_collaboration"],
    safe_build_required: row["safe_build_required"],
    safe_build_passed: row["safe_build_passed"],
    approved_at: row["approved_at"],
    cancelled_at: row["cancelled_at"],
    created_at: row["created_at"],
    updated_at: row["updated_at"],
    rawValueReturned: false,
  };
}

async function getTask(taskId: number, uid: number): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT id, user_id, request, status, plan_json, risk_level, needs_user_approval,
            recommended_ai_collaboration, safe_build_required, safe_build_passed,
            approved_at, cancelled_at, evidence_json, created_at, updated_at
       FROM viba_tasks
      WHERE id = $1 AND user_id = $2`,
    [taskId, uid],
  );
  return rows[0] ?? null;
}

async function getSavedCustomAis(uid: number): Promise<Array<{ provider: string; name: string }>> {
  try {
    const all = await listVibaCredentials(uid);
    return all
      .filter((c) => String(c["provider"] ?? "").startsWith("custom_ai__") && c["kind"] === "api_key")
      .map((c) => ({
        provider: String(c["provider"]),
        name: String(c["provider"]).replace(/^custom_ai__/, "").replace(/_/g, " "),
      }));
  } catch {
    return [];
  }
}

async function getSavedCredentials(uid: number): Promise<Array<{ provider: string; kind: string }>> {
  try {
    const all = await listVibaCredentials(uid);
    return all.map((c) => ({ provider: String(c["provider"]), kind: String(c["kind"]) }));
  } catch {
    return [];
  }
}

// ─── POST /api/task-intake/create ─────────────────────────────────────────────

router.post("/task-intake/create", async (req, res): Promise<void> => {
  const uid = requireUser(req, res);
  if (!uid) return;

  await ensureTasksTable();

  const body = req.body as { request?: unknown; context?: unknown };
  const request = typeof body.request === "string" ? body.request.trim() : "";
  if (!request || request.length < 3) {
    res.status(400).json({ error: "request is required (describe what you need VIBA to do)" });
    return;
  }
  if (request.length > 4000) {
    res.status(400).json({ error: "request is too long (max 4000 characters)" });
    return;
  }

  // Gather metadata (no raw values)
  const [savedCustomAis, savedCredentials] = await Promise.all([
    getSavedCustomAis(uid),
    getSavedCredentials(uid),
  ]);

  // Plan the task
  const plan = await planTask({ request, savedCustomAis, savedCredentials });

  // Insert task
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO viba_tasks (user_id, request, status, plan_json, risk_level, needs_user_approval, recommended_ai_collaboration, safe_build_required)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      uid,
      request,
      plan.approvalRequired ? "awaiting_user_approval" : "planning",
      JSON.stringify(plan),
      plan.riskLevel,
      plan.approvalRequired,
      plan.recommendedBYOK,
      plan.safeBuildRequired,
    ],
  );

  const taskId = rows[0]?.id;
  res.status(201).json({
    ok: true,
    task_id: taskId,
    status: plan.approvalRequired ? "awaiting_user_approval" : "planning",
    plan,
    rawValueReturned: false,
  });
});

// ─── GET /api/task-intake/:taskId ─────────────────────────────────────────────

router.get("/task-intake/:taskId", async (req, res): Promise<void> => {
  const uid = requireUser(req, res);
  if (!uid) return;

  await ensureTasksTable();
  const taskId = parseInt(String(req.params["taskId"] ?? ""), 10);
  if (!taskId) { res.status(400).json({ error: "Invalid taskId" }); return; }

  const row = await getTask(taskId, uid);
  if (!row) { res.status(404).json({ error: "Task not found" }); return; }

  res.json({ ...safeTask(row), plan: row["plan_json"] ?? null, rawValueReturned: false });
});

// ─── GET /api/task-intake/:taskId/plan ────────────────────────────────────────

router.get("/task-intake/:taskId/plan", async (req, res): Promise<void> => {
  const uid = requireUser(req, res);
  if (!uid) return;

  await ensureTasksTable();
  const taskId = parseInt(String(req.params["taskId"] ?? ""), 10);
  if (!taskId) { res.status(400).json({ error: "Invalid taskId" }); return; }

  const row = await getTask(taskId, uid);
  if (!row) { res.status(404).json({ error: "Task not found" }); return; }

  res.json({ task_id: taskId, plan: row["plan_json"] ?? null, rawValueReturned: false });
});

// ─── POST /api/task-intake/:taskId/approve ────────────────────────────────────

router.post("/task-intake/:taskId/approve", async (req, res): Promise<void> => {
  const uid = requireUser(req, res);
  if (!uid) return;

  await ensureTasksTable();
  const taskId = parseInt(String(req.params["taskId"] ?? ""), 10);
  if (!taskId) { res.status(400).json({ error: "Invalid taskId" }); return; }

  const row = await getTask(taskId, uid);
  if (!row) { res.status(404).json({ error: "Task not found" }); return; }

  const status = String(row["status"] ?? "");
  if (!["awaiting_user_approval", "planning", "created"].includes(status)) {
    res.status(409).json({ error: `Task cannot be approved from status: ${status}` });
    return;
  }

  await pool.query(
    `UPDATE viba_tasks SET status = 'running', approved_at = NOW(), updated_at = NOW() WHERE id = $1 AND user_id = $2`,
    [taskId, uid],
  );

  res.json({ ok: true, task_id: taskId, status: "running", approved_at: new Date().toISOString() });
});

// ─── POST /api/task-intake/:taskId/cancel ─────────────────────────────────────

router.post("/task-intake/:taskId/cancel", async (req, res): Promise<void> => {
  const uid = requireUser(req, res);
  if (!uid) return;

  await ensureTasksTable();
  const taskId = parseInt(String(req.params["taskId"] ?? ""), 10);
  if (!taskId) { res.status(400).json({ error: "Invalid taskId" }); return; }

  const row = await getTask(taskId, uid);
  if (!row) { res.status(404).json({ error: "Task not found" }); return; }

  const status = String(row["status"] ?? "");
  if (["completed", "cancelled"].includes(status)) {
    res.status(409).json({ error: `Task is already ${status}` });
    return;
  }

  await pool.query(
    `UPDATE viba_tasks SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1 AND user_id = $2`,
    [taskId, uid],
  );

  res.json({ ok: true, task_id: taskId, status: "cancelled" });
});

// ─── GET /api/task-intake/:taskId/evidence-report ─────────────────────────────

router.get("/task-intake/:taskId/evidence-report", async (req, res): Promise<void> => {
  const uid = requireUser(req, res);
  if (!uid) return;

  await ensureTasksTable();
  const taskId = parseInt(String(req.params["taskId"] ?? ""), 10);
  if (!taskId) { res.status(400).json({ error: "Invalid taskId" }); return; }

  const row = await getTask(taskId, uid);
  if (!row) { res.status(404).json({ error: "Task not found" }); return; }

  const plan = row["plan_json"] as {
    summary?: string;
    steps?: Array<{ title: string; assignedAgent: string; safeBuildCheckpoint?: boolean }>;
    requiredAgents?: string[];
    requiredCredentials?: Array<{ provider: string; kind: string; scope: string }>;
    approvalRequired?: boolean;
    safeBuildRequired?: boolean;
    riskLevel?: string;
    blockers?: string[];
  } | null ?? {};

  // Gather comms messages summary (no raw values, metadata redacted)
  const { rows: msgs } = await pool.query<{ from_agent: string; message_type: string; created_at: string }>(
    `SELECT from_agent, message_type, created_at FROM viba_agent_comms
      WHERE user_id = $1 AND task_id = $2
      ORDER BY created_at ASC LIMIT 500`,
    [uid, taskId],
  ).catch(() => ({ rows: [] }));

  const agentsUsed = [...new Set([...(plan.requiredAgents ?? []), ...msgs.map((m) => m.from_agent)])];

  // Credentials referenced — labels only, never raw values
  const credLabels = (plan.requiredCredentials ?? []).map(
    (c: { provider: string; kind: string; scope: string }) => `${c.provider}/${c.kind} (scope: ${c.scope})`,
  );

  const report = {
    task_id: taskId,
    task_summary: plan.summary ?? row["request"],
    request: row["request"],
    status: row["status"],
    risk_level: row["risk_level"],
    steps_planned: (plan.steps ?? []).map((s) => ({ title: s.title, agent: s.assignedAgent, safeBuildCheckpoint: s.safeBuildCheckpoint ?? false })),
    agents_used: agentsUsed,
    credentials_referenced_by_label: credLabels,
    approval_required: plan.approvalRequired ?? row["needs_user_approval"],
    approved_at: row["approved_at"],
    cancelled_at: row["cancelled_at"],
    safe_build_required: row["safe_build_required"],
    safe_build_passed: row["safe_build_passed"],
    agent_messages_count: msgs.length,
    blockers: plan.blockers ?? [],
    deployment_ready: row["safe_build_passed"] === true && row["status"] !== "cancelled" && row["status"] !== "failed",
    rawValuesReturned: false,
    securityNote: "No secrets, raw API keys, tokens, or passwords are included in this report.",
  };

  res.json(report);
});

export default router;
