/**
 * VIBA Tool Broker API Routes
 *
 * Mounted under /api after verified-session authentication.
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
import {
  getToolCapabilityMatrix,
  getCapabilitySummary,
  routeJobToToolSequence,
} from "../lib/toolCapabilityMatrix";

const router = Router();

function userId(req: { session?: { userId?: number } }): number {
  return typeof req.session?.userId === "number" ? req.session.userId : 0;
}

const ToolActionSchema = z.object({
  toolId: z.string().min(1),
  action: z.string().min(1),
  taskId: z.union([z.string(), z.number()]).optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional(),
  requestedByAgent: z.string().optional(),
});

router.get("/tools", async (req, res): Promise<void> => {
  const tools = await getAvailableTools(userId(req));
  res.json({ tools, rawValuesReturned: false });
});

router.get("/tools/capabilities", (_req, res): void => {
  res.json({ capabilities: getToolCapabilityMatrix(), rawValuesReturned: false });
});

router.get("/tools/capabilities/summary", (_req, res): void => {
  res.json(getCapabilitySummary());
});

router.get("/tools/route-job", (req, res): void => {
  const jobType = String(req.query["type"] ?? "").trim();
  if (!jobType) {
    res.status(400).json({ error: "Query parameter 'type' is required" });
    return;
  }
  res.json(routeJobToToolSequence(jobType));
});

router.get("/tools/invocations", async (req, res): Promise<void> => {
  const uid = userId(req);
  const requestedLimit = Number(req.query["limit"] ?? 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.trunc(requestedLimit), 200))
    : 50;
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

router.get("/tools/invocations/:id", async (req, res): Promise<void> => {
  const uid = userId(req);
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) {
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

/** Dynamic tool lookup must remain below all fixed /tools/* routes. */
router.get("/tools/:toolId", (req, res): void => {
  const toolId = req.params["toolId"] as string;
  const tool = getToolById(toolId);
  if (!tool) {
    res.status(404).json({ error: `Tool '${toolId}' not found in registry` });
    return;
  }
  const capability = getToolCapabilityMatrix().find((item) => item.toolId === toolId) ?? null;
  res.json({ tool, capability, rawValuesReturned: false });
});

router.post("/tools/plan", async (req, res): Promise<void> => {
  const parsed = ToolActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  res.json(await planToolAction({ userId: userId(req), ...parsed.data }));
});

router.post("/tools/dry-run", async (req, res): Promise<void> => {
  const parsed = ToolActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  res.json(await dryRunToolAction({ userId: userId(req), dryRun: true, ...parsed.data }));
});

router.post("/tools/execute", async (req, res): Promise<void> => {
  const parsed = ToolActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  const result = await executeToolAction({ userId: userId(req), ...parsed.data });
  const httpStatus = result.status === "executed"
    ? 200
    : result.status === "failed"
      ? 502
      : result.status === "missing_credential"
        ? 409
        : result.status === "scope_denied"
          ? 403
          : 422;
  res.status(httpStatus).json(result);
});

export default router;
