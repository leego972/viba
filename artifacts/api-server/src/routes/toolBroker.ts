/**
 * VIBA Tool Broker API Routes
 *
 * Mounted by app.ts under /api.
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
import { getToolById, type ToolDefinition } from "../lib/toolRegistry";
import { getBuilderToolById } from "../lib/builderToolbox";
import { getSecurityHardeningToolById } from "../lib/securityToolPack";

const router = Router();

const ARTIFACT_DELIVERY_TOOL: ToolDefinition = {
  toolId: "artifact.deliver",
  label: "Artifacts: Deliver Document/File/ZIP to User",
  category: "storage",
  description: "Create a system-generated document, file, or ZIP bundle and attach it to an assistant chat message for the user to download. This is assistant-to-user delivery, not user upload.",
  riskLevel: "low",
  permissionsRequired: ["login_required"],
  credentialProvider: null,
  credentialKind: null,
  supportsDryRun: true,
  requiresApproval: false,
  requiresSafeBuild: false,
  outputsSecretValues: false,
};

function brokerToolById(toolId: string): ToolDefinition | undefined {
  return toolId === ARTIFACT_DELIVERY_TOOL.toolId
    ? ARTIFACT_DELIVERY_TOOL
    : getBuilderToolById(toolId) ?? getSecurityHardeningToolById(toolId) ?? getToolById(toolId);
}

function userId(req: { session?: { userId?: number } }): number {
  return typeof req.session?.userId === "number" ? req.session.userId : 0;
}

const ToolActionSchema = z.object({
  toolId: z.string().min(1),
  action: z.string().min(1),
  taskId: z.union([z.string(), z.number()]).optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional(),
  requestedByAgent: z.string().optional(),
  approvalToken: z.string().optional().nullable(),
});

router.get("/tools", async (req, res): Promise<void> => {
  const uid = userId(req);
  const tools = await getAvailableTools(uid);
  res.json({ tools, rawValuesReturned: false });
});

router.get("/tools/invocations", async (req, res): Promise<void> => {
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
      toolLabel: brokerToolById(String(row["tool_id"] ?? ""))?.label ?? row["tool_id"],
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
    res.json({ invocation: { ...row, toolLabel: brokerToolById(String(row["tool_id"] ?? ""))?.label ?? row["tool_id"], rawValuesReturned: false } });
  } catch {
    res.status(500).json({ error: "Failed to fetch invocation" });
  }
});

router.get("/tools/:toolId", (req, res): void => {
  const toolId = req.params["toolId"] as string;
  const tool = brokerToolById(toolId);
  if (!tool) {
    res.status(404).json({ error: `Tool '${toolId}' not found in registry` });
    return;
  }
  res.json({ tool, rawValuesReturned: false });
});

router.post("/tools/plan", async (req, res): Promise<void> => {
  const uid = userId(req);
  const parsed = ToolActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  const result = await planToolAction({ userId: uid, ...parsed.data });
  res.json(result);
});

router.post("/tools/dry-run", async (req, res): Promise<void> => {
  const uid = userId(req);
  const parsed = ToolActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  const result = await dryRunToolAction({ userId: uid, dryRun: true, ...parsed.data });
  res.json(result);
});

router.post("/tools/execute", async (req, res): Promise<void> => {
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
