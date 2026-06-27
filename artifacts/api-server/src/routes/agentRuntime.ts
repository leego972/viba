/**
 * VIBA Agent Runtime Engine — API Routes
 *
 * POST /api/runtime/:taskId/start         — create run + steps, begin execution
 * POST /api/runtime/:taskId/next          — run next eligible step
 * POST /api/runtime/:taskId/pause         — pause/block the run
 * POST /api/runtime/:taskId/resume        — resume from blocked/waiting
 * POST /api/runtime/:taskId/cancel        — cancel the run
 * POST /api/runtime/:taskId/approve/:stepId — approve or deny a waiting step
 * GET  /api/runtime/:taskId/status        — run status + blockers
 * GET  /api/runtime/:taskId/steps         — safe step metadata
 * GET  /api/runtime/:taskId/audit         — agent messages + tool summaries (no secrets)
 * GET  /api/runtime/:taskId/evidence-report — final evidence report
 */
import { Router } from "express";
import { pool } from "@workspace/db";
import {
  startTaskRuntime,
  runNextStep,
  pauseTask,
  resumeTask,
  cancelTask,
  completeTask,
  failTask,
  approveStep,
  getTaskRunStatus,
} from "../lib/agentRuntime";
import { generateEvidenceReport } from "../lib/evidenceReport";

const router = Router();

function uid(req: { session?: { userId?: number } }): number {
  return typeof req.session?.userId === "number" ? req.session.userId : 0;
}

function taskId(req: { params: { taskId?: string } }): number {
  return parseInt(String(req.params["taskId"] ?? ""), 10);
}

// ─── POST /api/runtime/:taskId/start ─────────────────────────────────────────

router.post("/api/runtime/:taskId/start", async (req, res): Promise<void> => {
  const u = uid(req);
  const t = taskId(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  if (isNaN(t)) { res.status(400).json({ error: "Invalid taskId" }); return; }
  try {
    const result = await startTaskRuntime(t, u);
    res.status(201).json({ ok: true, ...result, rawValuesReturned: false });
  } catch (err) {
    const msg = String((err as Error).message ?? "Failed to start runtime");
    res.status(400).json({ error: msg });
  }
});

// ─── POST /api/runtime/:taskId/next ──────────────────────────────────────────

router.post("/api/runtime/:taskId/next", async (req, res): Promise<void> => {
  const u = uid(req);
  const t = taskId(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  if (isNaN(t)) { res.status(400).json({ error: "Invalid taskId" }); return; }
  try {
    const result = await runNextStep(t, u);
    res.json({ ok: true, ...result, rawValuesReturned: false });
  } catch (err) {
    res.status(400).json({ error: String((err as Error).message) });
  }
});

// ─── POST /api/runtime/:taskId/pause ─────────────────────────────────────────

router.post("/api/runtime/:taskId/pause", async (req, res): Promise<void> => {
  const u = uid(req);
  const t = taskId(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : "Paused by user";
  try {
    const run = await pauseTask(t, u, reason);
    res.json({ ok: true, run, rawValuesReturned: false });
  } catch (err) {
    res.status(400).json({ error: String((err as Error).message) });
  }
});

// ─── POST /api/runtime/:taskId/resume ────────────────────────────────────────

router.post("/api/runtime/:taskId/resume", async (req, res): Promise<void> => {
  const u = uid(req);
  const t = taskId(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const run = await resumeTask(t, u);
    res.json({ ok: true, run, rawValuesReturned: false });
  } catch (err) {
    res.status(400).json({ error: String((err as Error).message) });
  }
});

// ─── POST /api/runtime/:taskId/cancel ────────────────────────────────────────

router.post("/api/runtime/:taskId/cancel", async (req, res): Promise<void> => {
  const u = uid(req);
  const t = taskId(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const run = await cancelTask(t, u);
    res.json({ ok: true, run, rawValuesReturned: false });
  } catch (err) {
    res.status(400).json({ error: String((err as Error).message) });
  }
});

// ─── POST /api/runtime/:taskId/approve/:stepId ───────────────────────────────

router.post("/api/runtime/:taskId/approve/:stepId", async (req, res): Promise<void> => {
  const u = uid(req);
  const t = taskId(req);
  const sId = parseInt(String(req.params["stepId"] ?? ""), 10);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  if (isNaN(t) || isNaN(sId)) { res.status(400).json({ error: "Invalid taskId or stepId" }); return; }

  const decision = req.body?.decision === "denied" ? "denied" : "approved";
  try {
    const result = await approveStep(t, u, sId, decision);
    res.json({ ok: true, decision, ...result, rawValuesReturned: false });
  } catch (err) {
    res.status(400).json({ error: String((err as Error).message) });
  }
});

// ─── GET /api/runtime/:taskId/status ─────────────────────────────────────────

router.get("/api/runtime/:taskId/status", async (req, res): Promise<void> => {
  const u = uid(req);
  const t = taskId(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const status = await getTaskRunStatus(t, u);
    res.json(status);
  } catch (err) {
    res.status(400).json({ error: String((err as Error).message) });
  }
});

// ─── GET /api/runtime/:taskId/steps ──────────────────────────────────────────

router.get("/api/runtime/:taskId/steps", async (req, res): Promise<void> => {
  const u = uid(req);
  const t = taskId(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT id, step_index, step_id, agent_name, title, description, status, risk_level, tool_id,
              requires_approval, approval_status, requires_credential, credential_provider, credential_kind,
              requires_safe_build, started_at, completed_at, blocked_reason, created_at
       FROM viba_task_steps WHERE task_id = $1 AND user_id = $2 ORDER BY step_index`,
      [t, u],
    );
    // Never return raw credentials — credential_label redacted, only provider/kind
    const steps = rows.map((r) => ({
      ...r,
      credential_label: r["credential_provider"] ? `${r["credential_provider"]}/${r["credential_kind"]}` : null,
      rawValuesReturned: false,
    }));
    res.json({ steps, rawValuesReturned: false });
  } catch {
    res.json({ steps: [], rawValuesReturned: false });
  }
});

// ─── GET /api/runtime/:taskId/audit ──────────────────────────────────────────

router.get("/api/runtime/:taskId/audit", async (req, res): Promise<void> => {
  const u = uid(req);
  const t = taskId(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const [msgResult, toolResult] = await Promise.all([
      pool.query<Record<string, unknown>>(
        `SELECT id, from_agent, to_agent, message_type, message, created_at
         FROM viba_agent_comms WHERE task_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 100`,
        [t, u],
      ),
      pool.query<Record<string, unknown>>(
        `SELECT id, tool_id, agent_name, status, dry_run, risk_level, created_at
         FROM viba_tool_invocations WHERE task_id = $1::TEXT AND user_id = $2 ORDER BY created_at DESC LIMIT 50`,
        [String(t), u],
      ),
    ]);
    res.json({
      messages: msgResult.rows,
      toolInvocationSummaries: toolResult.rows.map((r) => ({
        id: r["id"], toolId: r["tool_id"], agentName: r["agent_name"],
        status: r["status"], dryRun: r["dry_run"], riskLevel: r["risk_level"], createdAt: r["created_at"],
      })),
      note: "All sensitive metadata is redacted. No raw credential values are included.",
      rawValuesReturned: false,
    });
  } catch {
    res.json({ messages: [], toolInvocationSummaries: [], rawValuesReturned: false });
  }
});

// ─── GET /api/runtime/:taskId/evidence-report ────────────────────────────────

router.get("/api/runtime/:taskId/evidence-report", async (req, res): Promise<void> => {
  const u = uid(req);
  const t = taskId(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const report = await generateEvidenceReport(t, u);
    res.json({ report, rawValuesReturned: false });
  } catch (err) {
    res.status(400).json({ error: String((err as Error).message) });
  }
});

export default router;
