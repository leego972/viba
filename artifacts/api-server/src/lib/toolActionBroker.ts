/**
 * VIBA Tool Action Broker
 *
 * Safe execution layer for agent tool requests. A tool is never reported as
 * executed unless a concrete execution mapping ran successfully.
 */
import { pool } from "@workspace/db";
import { getToolById, getAllTools, type ToolDefinition } from "./toolRegistry";
import { evaluateToolPolicy, redactPayload, redactResult, type PolicyContext } from "./toolPolicies";
import { listVibaCredentials } from "./vibaVault";
import { getUserPlan, UPGRADE_MESSAGE } from "./planLimits";
import { executeTool } from "./tools/registry";

export type BrokerStatus =
  | "ready"
  | "dry_run_complete"
  | "dry_run_required"
  | "needs_user_approval"
  | "adapter_required"
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
  /** Retained for API compatibility. Unverified client tokens are never trusted. */
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

const ENV_CREDENTIALS: Record<string, string[]> = {
  github: ["GITHUB_TOKEN", "GH_TOKEN"],
  render: ["RENDER_API_KEY"],
  digitalocean: ["DIGITALOCEAN_ACCESS_TOKEN", "DIGITALOCEAN_TOKEN"],
  vercel: ["VERCEL_TOKEN"],
  sevall: ["SEVALL_API_KEY"],
  railway: ["RAILWAY_TOKEN"],
  stripe: ["STRIPE_SECRET_KEY"],
  smtp: ["SMTP_PASS"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY"],
  groq: ["GROQ_API_KEY"],
};

async function checkVaultCredential(userId: number, tool: ToolDefinition): Promise<boolean> {
  if (!tool.credentialProvider) return true;

  for (const name of ENV_CREDENTIALS[tool.credentialProvider] ?? []) {
    if (process.env[name]) return true;
  }

  try {
    const creds = await listVibaCredentials(userId);
    return creds.some(
      (credential) =>
        String(credential["provider"] ?? "").startsWith(tool.credentialProvider ?? "__never__") &&
        (tool.credentialKind ? credential["kind"] === tool.credentialKind : true),
    );
  } catch {
    return false;
  }
}

async function checkByokCredential(userId: number): Promise<boolean> {
  try {
    const creds = await listVibaCredentials(userId);
    return creds.some((credential) =>
      String(credential["provider"] ?? "").startsWith("custom_ai__") &&
      credential["kind"] === "api_key",
    );
  } catch {
    return false;
  }
}

export async function getAvailableTools(userId: number): Promise<Array<{
  toolId: string;
  label: string;
  category: string;
  riskLevel: string;
  requiresApproval: boolean;
  supportsDryRun: boolean;
  requiresSafeBuild: boolean;
  executionStatus: "live" | "adapter_required" | "approval_workflow_required";
  credentialStatus: "configured" | "missing" | "not_required";
  rawValuesReturned: false;
}>> {
  await ensureInvocationsTable();
  const tools = getAllTools();
  return Promise.all(tools.map(async (tool) => {
    let credentialStatus: "configured" | "missing" | "not_required" = "not_required";
    if (tool.credentialProvider) {
      credentialStatus = await checkVaultCredential(userId, tool) ? "configured" : "missing";
    }

    const executionStatus = !tool.executionName
      ? "adapter_required"
      : tool.requiresApproval
        ? "approval_workflow_required"
        : "live";

    return {
      toolId: tool.toolId,
      label: tool.label,
      category: tool.category,
      riskLevel: tool.riskLevel,
      requiresApproval: tool.requiresApproval,
      supportsDryRun: tool.supportsDryRun,
      requiresSafeBuild: tool.requiresSafeBuild,
      executionStatus,
      credentialStatus,
      rawValuesReturned: false as const,
    };
  }));
}

function taskId(input: BrokerInput): string {
  return String(input.taskId ?? "");
}

function baseResult(tool: ToolDefinition, status: BrokerStatus, message: string): BrokerResult {
  return {
    status,
    toolId: tool.toolId,
    label: tool.label,
    riskLevel: tool.riskLevel,
    message,
    requiresDryRun: false,
    requiresApproval: tool.requiresApproval,
    requiresSafeBuild: tool.requiresSafeBuild,
    warnings: [],
    rawValuesReturned: false,
  };
}

export async function planToolAction(input: BrokerInput): Promise<BrokerResult> {
  const tool = getToolById(input.toolId);
  if (!tool) {
    await logInvocation({
      userId: input.userId,
      taskId: taskId(input),
      toolId: input.toolId,
      agentName: input.requestedByAgent ?? null,
      riskLevel: "unknown",
      status: "blocked",
      dryRun: false,
      approvalRequired: false,
      approvedAt: null,
      payloadRedacted: redactPayload(input.payload),
      resultRedacted: {},
      error: "Tool not found in registry",
    });
    return {
      status: "blocked",
      toolId: input.toolId,
      label: input.toolId,
      riskLevel: "unknown",
      message: `Tool '${input.toolId}' is not registered in the VIBA tool registry.`,
      requiresDryRun: false,
      requiresApproval: false,
      requiresSafeBuild: false,
      warnings: [],
      rawValuesReturned: false,
    };
  }

  if (!tool.executionName) {
    const result = baseResult(
      tool,
      "adapter_required",
      `${tool.label} is registered but has no verified execution adapter. It cannot run yet.`,
    );
    const id = await logInvocation({
      userId: input.userId,
      taskId: taskId(input),
      toolId: tool.toolId,
      agentName: input.requestedByAgent ?? null,
      riskLevel: tool.riskLevel,
      status: result.status,
      dryRun: false,
      approvalRequired: tool.requiresApproval,
      approvedAt: null,
      payloadRedacted: redactPayload(input.payload),
      resultRedacted: {},
      error: "No verified execution adapter",
    });
    return { ...result, invocationId: id ?? undefined };
  }

  const [hasVaultCredential, hasByokCredential, planKey] = await Promise.all([
    checkVaultCredential(input.userId, tool),
    checkByokCredential(input.userId),
    getUserPlan(input.userId),
  ]);
  const context: PolicyContext = {
    hasSafeBuildPassed: false,
    hasByokCredential,
    hasVaultCredential,
    planKey,
  };
  const policy = evaluateToolPolicy(tool, context);

  if (!policy.allowed) {
    const isUpgradeRequired = policy.blockedReason === UPGRADE_MESSAGE ||
      policy.blockedReason?.includes("Upgrade to VIBA Pro");
    const status: BrokerStatus = isUpgradeRequired
      ? "scope_denied"
      : policy.blockedReason?.includes("credential")
        ? "missing_credential"
        : policy.requiresSafeBuild
          ? "dry_run_required"
          : "blocked";
    const id = await logInvocation({
      userId: input.userId,
      taskId: taskId(input),
      toolId: tool.toolId,
      agentName: input.requestedByAgent ?? null,
      riskLevel: tool.riskLevel,
      status,
      dryRun: false,
      approvalRequired: policy.requiresApproval,
      approvedAt: null,
      payloadRedacted: redactPayload(input.payload),
      resultRedacted: {},
      error: policy.blockedReason,
    });
    return {
      ...baseResult(tool, status, policy.blockedReason ?? "Tool action blocked by policy."),
      requiresDryRun: policy.requiresDryRun,
      requiresApproval: policy.requiresApproval,
      requiresSafeBuild: policy.requiresSafeBuild,
      warnings: policy.warnings,
      invocationId: id ?? undefined,
    };
  }

  let status: BrokerStatus = "ready";
  let message = `${tool.label} is ready to execute.`;

  if (policy.requiresApproval) {
    status = "needs_user_approval";
    message = `${tool.label} is blocked until VIBA has a server-validated, one-time approval workflow. Client-supplied approval tokens are not accepted.`;
  } else if (policy.requiresDryRun && !input.dryRun) {
    status = "dry_run_required";
    message = `${tool.label} requires a dry-run before execution.`;
  }

  const id = await logInvocation({
    userId: input.userId,
    taskId: taskId(input),
    toolId: tool.toolId,
    agentName: input.requestedByAgent ?? null,
    riskLevel: tool.riskLevel,
    status,
    dryRun: false,
    approvalRequired: policy.requiresApproval,
    approvedAt: null,
    payloadRedacted: redactPayload(input.payload),
    resultRedacted: {},
    error: status === "ready" ? null : message,
  });

  return {
    ...baseResult(tool, status, message),
    requiresDryRun: policy.requiresDryRun,
    requiresApproval: policy.requiresApproval,
    requiresSafeBuild: policy.requiresSafeBuild,
    warnings: policy.warnings,
    invocationId: id ?? undefined,
  };
}

export async function dryRunToolAction(input: BrokerInput): Promise<BrokerResult> {
  const tool = getToolById(input.toolId);
  if (!tool) return planToolAction(input);

  if (!tool.executionName) {
    return planToolAction(input);
  }
  if (!tool.supportsDryRun) {
    const result = baseResult(tool, "blocked", `${tool.label} does not support dry-run mode.`);
    const id = await logInvocation({
      userId: input.userId,
      taskId: taskId(input),
      toolId: tool.toolId,
      agentName: input.requestedByAgent ?? null,
      riskLevel: tool.riskLevel,
      status: result.status,
      dryRun: true,
      approvalRequired: tool.requiresApproval,
      approvedAt: null,
      payloadRedacted: redactPayload(input.payload),
      resultRedacted: {},
      error: "Tool does not support dry-run",
    });
    return { ...result, invocationId: id ?? undefined };
  }

  const simulatedResult = {
    mode: "dry_run",
    executed: false,
    tool: tool.toolId,
    action: input.action,
    payloadKeys: Object.keys(input.payload ?? {}),
    note: "No external system was called and no mutation occurred.",
  };
  const id = await logInvocation({
    userId: input.userId,
    taskId: taskId(input),
    toolId: tool.toolId,
    agentName: input.requestedByAgent ?? null,
    riskLevel: tool.riskLevel,
    status: "dry_run_complete",
    dryRun: true,
    approvalRequired: tool.requiresApproval,
    approvedAt: null,
    payloadRedacted: redactPayload(input.payload),
    resultRedacted: simulatedResult,
    error: null,
  });

  return {
    ...baseResult(tool, "dry_run_complete", `Dry-run completed for ${tool.label}. No mutation occurred.`),
    dryRunResult: simulatedResult,
    requiresApproval: tool.requiresApproval,
    warnings: tool.requiresApproval
      ? ["Live execution remains blocked until a server-validated approval workflow exists."]
      : [],
    invocationId: id ?? undefined,
  };
}

export async function executeToolAction(input: BrokerInput): Promise<BrokerResult> {
  const plan = await planToolAction({ ...input, dryRun: false });
  if (plan.status !== "ready") return plan;

  const tool = getToolById(input.toolId);
  if (!tool?.executionName) {
    return planToolAction(input);
  }

  let executionResult: Record<string, unknown>;
  let executionError: string | null = null;
  let executionStatus: BrokerStatus = "executed";

  try {
    const response = await executeTool(tool.executionName, input.payload ?? {}, { userId: input.userId });
    executionResult = {
      executed: !response.isError,
      toolId: tool.toolId,
      executionName: tool.executionName,
      action: input.action,
      result: response.result.slice(0, 8000),
      isError: response.isError,
    };
    if (response.isError) {
      executionError = response.result;
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

  const id = await logInvocation({
    userId: input.userId,
    taskId: taskId(input),
    toolId: tool.toolId,
    agentName: input.requestedByAgent ?? null,
    riskLevel: tool.riskLevel,
    status: executionStatus,
    dryRun: false,
    approvalRequired: false,
    approvedAt: null,
    payloadRedacted: redactPayload(input.payload),
    resultRedacted: redactResult(executionResult),
    error: executionError,
  });

  return {
    ...baseResult(
      tool,
      executionStatus,
      executionStatus === "executed"
        ? `${tool.label} executed successfully.`
        : `${tool.label} failed: ${executionError ?? "unknown error"}`,
    ),
    dryRunResult: executionResult,
    invocationId: id ?? undefined,
  };
}
