/**
 * VIBA Tool Broker API Routes
 *
 * GET  /api/tools                 — list all tools with credential status
 * GET  /api/tools/:toolId         — single tool definition
 * POST /api/tools/plan            — plan a tool action (no mutation)
 * POST /api/tools/dry-run         — simulate a tool action (no mutation)
 * POST /api/tools/execute         — execute a tool action (all guards applied)
 * GET  /api/tools/invocations     — recent invocation log (user-scoped)
 * GET  /api/tools/invocations/:id — single invocation
 */
import { Router } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import {
  getAvailableTools,
  planToolAction,
  dryRunToolAction,
  executeToolAction,
} from "../lib/toolActionBroker";
import { getToolById } from "../lib/toolRegistry";

const router = Router();

function userId(req: { session?: { userId?: number } }): number {
  return typeof req.session?.userId === "number" ? req.session.userId : 0;
}

// ─── Validation schemas ───────────────────────────────────────────────────────

const ToolActionSchema = z.object({
  toolId: z.string().min(1),
  action: z.string().min(1),
  taskId: z.union([z.string(), z.number()]).optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional(),
  requestedByAgent: z.string().optional(),
  approvalToken: z.string().optional().nullable(),
});

// ─── GET /api/tools ───────────────────────────────────────────────────────────

router.get("/api/tools", async (req, res): Promise<void> => {
  const uid = userId(req);
  const tools = await getAvailableTools(uid);
  res.json({ tools, rawValuesReturned: false });
});

// ─── GET /api/tools/invocations ───────────────────────────────────────────────
// (must be before /api/tools/:toolId to avoid "invocations" being parsed as toolId)

router.get("/api/tools/invocations", async (req, res): Promise<void> => {
  const uid = userId(req);
  const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
  const taskId = req.query["task_id"] as string | undefined;

  try {
    let queryText: string;
    let params: unknown[];

    if (taskId) {
      queryText = `SELECT id, tool_id, agent_name, risk_level, status, dry_run, approval_required, approved_at, result_redacted, error, created_at
                   FROM viba_tool_invocations
                   WHERE user_id = $1 AND task_id = $2
                   ORDER BY created_at DESC LIMIT $3`;
      params = [uid, taskId, limit];
    } else {
      queryText = `SELECT id, tool_id, agent_name, risk_level, status, dry_run, approval_required, approved_at, result_redacted, error, created_at
                   FROM viba_tool_invocations
                   WHERE user_id = $1
                   ORDER BY created_at DESC LIMIT $2`;
      params = [uid, limit];
    }

    const { rows } = await pool.query<Record<string, unknown>>(queryText, params);
    const invocations = rows.map((row) => ({
      ...row,
      toolLabel: getToolById(String(row["tool_id"] ?? ""))?.label ?? row["tool_id"],
      rawValuesReturned: false,
    }));
    res.json({ invocations, rawValuesReturned: false });
  } catch {
    res.json({ invocations: [], rawValuesReturned: false });
  }
});

// ─── GET /api/tools/invocations/:id ──────────────────────────────────────────

router.get("/api/tools/invocations/:id", async (req, res): Promise<void> => {
  const uid = userId(req);
  const id = Number(req.params["id"]);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid invocation id" });
    return;
  }

  try {
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT id, tool_id, agent_name, risk_level, status, dry_run, approval_required, approved_at, result_redacted, error, created_at
       FROM viba_tool_invocations WHERE id = $1 AND user_id = $2`,
      [id, uid],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Invocation not found" });
      return;
    }
    const row = rows[0];
    res.json({
      invocation: {
        ...row,
        toolLabel: getToolById(String(row["tool_id"] ?? ""))?.label ?? row["tool_id"],
        rawValuesReturned: false,
      },
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch invocation" });
  }
});

// ─── GET /api/tools/:toolId ───────────────────────────────────────────────────

router.get("/api/tools/:toolId", (req, res): void => {
  const toolId = req.params["toolId"] as string;
  const tool = getToolById(toolId);
  if (!tool) {
    res.status(404).json({ error: `Tool '${toolId}' not found in registry` });
    return;
  }
  res.json({ tool, rawValuesReturned: false });
});

// ─── POST /api/tools/plan ─────────────────────────────────────────────────────

router.post("/api/tools/plan", async (req, res): Promise<void> => {
  const uid = userId(req);
  const parsed = ToolActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  const result = await planToolAction({ userId: uid, ...parsed.data });
  res.json(result);
});

// ─── POST /api/tools/dry-run ──────────────────────────────────────────────────

router.post("/api/tools/dry-run", async (req, res): Promise<void> => {
  const uid = userId(req);
  const parsed = ToolActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  const result = await dryRunToolAction({ userId: uid, dryRun: true, ...parsed.data });
  res.json(result);
});

// ─── POST /api/tools/execute ──────────────────────────────────────────────────

router.post("/api/tools/execute", async (req, res): Promise<void> => {
  const uid = userId(req);
  const parsed = ToolActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  const result = await executeToolAction({ userId: uid, ...parsed.data });
  res.json(result);
});

export default router;
