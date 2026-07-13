/**
 * VIBA Tool Action Broker
 *
 * The safe execution layer for all agent tool requests.
 * Agents never call sensitive tools directly — they go through the broker.
 * Every request is checked, logged, and redacted.
 */
import { pool } from "@workspace/db";
import { getToolById, getAllTools, type ToolDefinition } from "./toolRegistry";
import { evaluateToolPolicy, redactPayload, redactResult, type PolicyContext } from "./toolPolicies";
import { listVibaCredentials } from "./vibaVault";
import { getUserPlan, UPGRADE_MESSAGE } from "./planLimits";
import { executeTool } from "./tools/registry";

export type BrokerStatus =
  | "ready"
  | "dry_run_required"
  | "needs_user_approval"
  | "missing_credential"
  | "scope_denied"
  | "blocked"
  | "executed"
  | "failed";

export interface BrokerInput {
  userId: number;
  taskId?: string | number | null;
  toolId: string;
  action: string;
  payload?: Record<string, unknown>;
  requestedByAgent?: string;
  approvalToken?: string | null;
  dryRun?: boolean;
}

export interface BrokerResult {
  status: BrokerStatus;
  toolId: string;
  label: string;
  riskLevel: string;
  message: string;
  dryRunResult?: Record<string, unknown>;
  requiresDryRun: boolean;
  requiresApproval: boolean;
  requiresSafeBuild: boolean;
  warnings: string[];
  invocationId?: number;
  rawValuesReturned: false;
}

// ─── DB ───────────────────────────────────────────────────────────────────────

async function ensureInvocationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_tool_invocations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      task_id TEXT,
      tool_id TEXT NOT NULL,
      agent_name TEXT,
      risk_level TEXT NOT NULL,
      status TEXT NOT NULL,
      dry_run BOOLEAN NOT NULL DEFAULT FALSE,
      approval_required BOOLEAN NOT NULL DEFAULT FALSE,
      approved_at TIMESTAMPTZ,
      payload_redacted JSONB,
      result_redacted JSONB,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_tool_invoc_user ON viba_tool_invocations (user_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_tool_invoc_task ON viba_tool_invocations (task_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_tool_invoc_tool ON viba_tool_invocations (tool_id, created_at DESC)`);
}

async function logInvocation(input: {
  userId: number;
  taskId: string | null;
  toolId: string;
  agentName: string | null;
  riskLevel: string;
  status: BrokerStatus;
  dryRun: boolean;
  approvalRequired: boolean;
  approvedAt: Date | null;
  payloadRedacted: Record<string, unknown>;
  resultRedacted: Record<string, unknown>;
  error: string | null;
}): Promise<number | null> {
  try {
    await ensureInvocationsTable();
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO viba_tool_invocations
         (user_id, task_id, tool_id, agent_name, risk_level, status, dry_run, approval_required, approved_at, payload_redacted, result_redacted, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        input.userId,
        input.taskId,
        input.toolId,
        input.agentName,
        input.riskLevel,
        input.status,
        input.dryRun,
        input.approvalRequired,
        input.approvedAt,
        JSON.stringify(input.payloadRedacted),
        JSON.stringify(input.resultRedacted),
        input.error,
      ],
    );
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

// ─── Credential check ─────────────────────────────────────────────────────────

async function checkVaultCredential(userId: number, tool: ToolDefinition): Promise<boolean> {
  if (!tool.credentialProvider) return true;
  // Check env first
  const envKeys: Record<string, string[]> = {
    github: ["GITHUB_TOKEN"],
    railway: ["RAILWAY_TOKEN"],
    stripe: ["STRIPE_SECRET_KEY"],
    smtp: ["SMTP_PASS"],
  };
  const envNames = envKeys[tool.credentialProvider] ?? [];
  for (const name of envNames) {
    if (process.env[name]) return true;
  }
  // Check vault
  try {
    const creds = await listVibaCredentials(userId);
    return creds.some(
      (c) =>
        String(c["provider"] ?? "").startsWith(tool.credentialProvider ?? "__never__") &&
        (tool.credentialKind ? c["kind"] === tool.credentialKind : true),
    );
  } catch {
    return false;
  }
}

async function checkByokCredential(userId: number): Promise<boolean> {
  try {
    const creds = await listVibaCredentials(userId);
    return creds.some((c) => String(c["provider"] ?? "").startsWith("custom_ai__") && c["kind"] === "api_key");
  } catch {
    return false;
  }
}

// ─── Tool status for listing ──────────────────────────────────────────────────

export async function getAvailableTools(userId: number): Promise<Array<{
  toolId: string; label: string; category: string; riskLevel: string;
  requiresApproval: boolean; supportsDryRun: boolean; requiresSafeBuild: boolean;
  credentialStatus: "configured" | "missing" | "not_required";
  rawValuesReturned: false;
}>> {
  await ensureInvocationsTable();
  const tools = getAllTools();
  const results = await Promise.all(
    tools.map(async (tool) => {
      let credentialStatus: "configured" | "missing" | "not_required" = "not_required";
      if (tool.credentialProvider) {
        const has = await checkVaultCredential(userId, tool);
        credentialStatus = has ? "configured" : "missing";
      }
      return {
        toolId: tool.toolId,
        label: tool.label,
        category: tool.category,
        riskLevel: tool.riskLevel,
        requiresApproval: tool.requiresApproval,
        supportsDryRun: tool.supportsDryRun,
        requiresSafeBuild: tool.requiresSafeBuild,
        credentialStatus,
        rawValuesReturned: false as const,
      };
    }),
  );
  return results;
}

// ─── planToolAction ───────────────────────────────────────────────────────────

export async function planToolAction(input: BrokerInput): Promise<BrokerResult> {
  const tool = getToolById(input.toolId);
  if (!tool) {
    await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: input.toolId, agentName: input.requestedByAgent ?? null, riskLevel: "unknown", status: "blocked", dryRun: false, approvalRequired: false, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: {}, error: "Tool not found in registry" });
    return { status: "blocked", toolId: input.toolId, label: input.toolId, riskLevel: "unknown", message: `Tool '${input.toolId}' is not registered in the VIBA tool registry.`, requiresDryRun: false, requiresApproval: false, requiresSafeBuild: false, warnings: [], rawValuesReturned: false };
  }

  const [hasVaultCredential, hasByokCredential, planKey] = await Promise.all([
    checkVaultCredential(input.userId, tool),
    checkByokCredential(input.userId),
    getUserPlan(input.userId),
  ]);
  const context: PolicyContext = { hasSafeBuildPassed: false, hasByokCredential, hasVaultCredential, planKey };

  const policy = evaluateToolPolicy(tool, context);

  if (!policy.allowed) {
    const isUpgradeRequired = policy.blockedReason === UPGRADE_MESSAGE ||
      policy.blockedReason?.includes("Upgrade to VIBA Pro");
    const status: BrokerStatus = isUpgradeRequired
      ? "scope_denied"
      : policy.blockedReason?.includes("credential") ? "missing_credential" : "blocked";
    const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: tool.toolId, agentName: input.requestedByAgent ?? null, riskLevel: tool.riskLevel, status, dryRun: false, approvalRequired: policy.requiresApproval, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: {}, error: policy.blockedReason });
    return { status, toolId: tool.toolId, label: tool.label, riskLevel: tool.riskLevel, message: policy.blockedReason ?? "Tool action blocked by policy.", requiresDryRun: policy.requiresDryRun, requiresApproval: policy.requiresApproval, requiresSafeBuild: policy.requiresSafeBuild, warnings: policy.warnings, invocationId: id ?? undefined, rawValuesReturned: false };
  }

  let status: BrokerStatus;
  let message: string;

  if (policy.requiresSafeBuild) {
    status = "dry_run_required";
    message = `${tool.label} requires a passing safe build gate before execution.`;
  } else if (policy.requiresApproval && !input.approvalToken) {
    status = "needs_user_approval";
    message = `${tool.label} (risk: ${tool.riskLevel}) requires user approval before execution.`;
  } else if (policy.requiresDryRun && !input.dryRun && !input.approvalToken) {
    status = "dry_run_required";
    message = `${tool.label} requires a dry-run before execution. Use POST /api/tools/dry-run first.`;
  } else {
    status = "ready";
    message = `${tool.label} is ready to execute.`;
  }

  const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: tool.toolId, agentName: input.requestedByAgent ?? null, riskLevel: tool.riskLevel, status, dryRun: false, approvalRequired: policy.requiresApproval, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: {}, error: null });
  return { status, toolId: tool.toolId, label: tool.label, riskLevel: tool.riskLevel, message, requiresDryRun: policy.requiresDryRun, requiresApproval: policy.requiresApproval, requiresSafeBuild: policy.requiresSafeBuild, warnings: policy.warnings, invocationId: id ?? undefined, rawValuesReturned: false };
}

// ─── dryRunToolAction ─────────────────────────────────────────────────────────

export async function dryRunToolAction(input: BrokerInput): Promise<BrokerResult> {
  const tool = getToolById(input.toolId);
  if (!tool) {
    return planToolAction(input);
  }
  if (!tool.supportsDryRun) {
    const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: tool.toolId, agentName: input.requestedByAgent ?? null, riskLevel: tool.riskLevel, status: "blocked", dryRun: true, approvalRequired: false, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: {}, error: "Tool does not support dry-run" });
    return { status: "blocked", toolId: tool.toolId, label: tool.label, riskLevel: tool.riskLevel, message: `${tool.label} does not support dry-run mode.`, requiresDryRun: false, requiresApproval: tool.requiresApproval, requiresSafeBuild: tool.requiresSafeBuild, warnings: [], invocationId: id ?? undefined, rawValuesReturned: false };
  }

  // Dry-run: simulate without mutation, redact everything
  const simulatedResult = {
    mode: "dry_run",
    tool: tool.toolId,
    action: input.action,
    payloadKeys: Object.keys(input.payload ?? {}),
    simulatedOutcome: `${tool.label} would execute with action '${input.action}'. No mutations performed.`,
    note: "This is a simulation. No external systems were called. No secrets were used.",
  };

  const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: tool.toolId, agentName: input.requestedByAgent ?? null, riskLevel: tool.riskLevel, status: "executed", dryRun: true, approvalRequired: tool.requiresApproval, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: simulatedResult, error: null });

  return {
    status: "executed",
    toolId: tool.toolId,
    label: tool.label,
    riskLevel: tool.riskLevel,
    message: `Dry-run complete for ${tool.label}. Review the simulated outcome before approving execution.`,
    dryRunResult: simulatedResult,
    requiresDryRun: false,
    requiresApproval: tool.requiresApproval,
    requiresSafeBuild: tool.requiresSafeBuild,
    warnings: tool.requiresApproval ? [`${tool.label} still requires user approval before live execution.`] : [],
    invocationId: id ?? undefined,
    rawValuesReturned: false,
  };
}

// ─── executeToolAction ────────────────────────────────────────────────────────

export async function executeToolAction(input: BrokerInput): Promise<BrokerResult> {
  const plan = await planToolAction({ ...input, dryRun: false });

  // If blocked or missing credential, return immediately
  if (["blocked", "missing_credential", "scope_denied"].includes(plan.status)) {
    return plan;
  }

  // If approval required and no approval token, block
  if (plan.requiresApproval && !input.approvalToken) {
    const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: input.toolId, agentName: input.requestedByAgent ?? null, riskLevel: plan.riskLevel, status: "needs_user_approval", dryRun: false, approvalRequired: true, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: {}, error: "Approval required but no approval token provided" });
    return { ...plan, status: "needs_user_approval", invocationId: id ?? undefined };
  }

  // If safe build required, block
  if (plan.requiresSafeBuild) {
    const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: input.toolId, agentName: input.requestedByAgent ?? null, riskLevel: plan.riskLevel, status: "dry_run_required", dryRun: false, approvalRequired: plan.requiresApproval, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: {}, error: "Safe build gate required before execution" });
    return { ...plan, status: "dry_run_required", invocationId: id ?? undefined };
  }

  // Execute — call the real VIBA tool execution engine
  const tool = getToolById(input.toolId)!;

  let executionResult: Record<string, unknown>;
  let executionError: string | null = null;
  let executionStatus: BrokerStatus = "executed";

  if (tool.executionName) {
    // Tool has a concrete execution mapping — call tools/registry directly
    try {
      const toolCtx = { userId: input.userId };
      const res = await executeTool(tool.executionName, input.payload ?? {}, toolCtx);
      executionResult = {
        executed: true,
        toolId: tool.toolId,
        executionName: tool.executionName,
        action: input.action,
        result: res.result.slice(0, 8000),
        isError: res.isError,
      };
      if (res.isError) {
        executionError = res.result;
        executionStatus = "failed";
      }
    } catch (err) {
      executionError = err instanceof Error ? err.message : String(err);
      executionStatus = "failed";
      executionResult = {
        executed: false,
        toolId: tool.toolId,
        action: input.action,
        error: executionError,
      };
    }
  } else {
    // No execution mapping — this tool requires a native adapter (Railway MCP, Replit, etc.)
    // Return a clear informational result rather than a silent stub
    executionResult = {
      executed: false,
      toolId: tool.toolId,
      action: input.action,
      note: `${tool.label} requires a native agent integration (Groq + Railway MCP, Replit, or Manus). Assign a tool-capable agent to perform this operation directly.`,
      suggestion: "Use a Groq, Replit, or Manus agent with canUseTools=true for this task.",
    };
  }

  const id = await logInvocation({
    userId: input.userId, taskId: String(input.taskId ?? ""), toolId: tool.toolId,
    agentName: input.requestedByAgent ?? null, riskLevel: tool.riskLevel,
    status: executionStatus, dryRun: false, approvalRequired: tool.requiresApproval,
    approvedAt: input.approvalToken ? new Date() : null,
    payloadRedacted: redactPayload(input.payload),
    resultRedacted: redactResult(executionResult),
    error: executionError,
  });

  const message = executionStatus === "failed"
    ? `${tool.label} encountered an error: ${executionError}`
    : tool.executionName
      ? `${tool.label} executed successfully.`
      : `${tool.label} requires a native agent integration.`;

  return {
    status: executionStatus,
    toolId: tool.toolId,
    label: tool.label,
    riskLevel: tool.riskLevel,
    message,
    dryRunResult: executionResult,
    requiresDryRun: false,
    requiresApproval: false,
    requiresSafeBuild: false,
    warnings: plan.warnings,
    invocationId: id ?? undefined,
    rawValuesReturned: false,
  };
}
