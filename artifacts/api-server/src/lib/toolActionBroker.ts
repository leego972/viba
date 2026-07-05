/**
 * VIBA Tool Action Broker
 *
 * The safe execution layer for all agent tool requests.
 * Agents never call sensitive tools directly — they go through the broker.
 * Every request is checked, logged, and redacted.
 */
import { pool } from "@workspace/db";
import { getToolById, getAllTools, type ToolDefinition } from "./toolRegistry";
import { SECURITY_HARDENING_TOOLS, getSecurityHardeningToolById } from "./securityToolPack";
import { evaluateToolPolicy, redactPayload, redactResult, type PolicyContext } from "./toolPolicies";
import { listVibaCredentials } from "./vibaVault";
import { deliverSystemArtifactToUser, type DeliverArtifactInput } from "./systemArtifactDelivery";
import { canExecuteWebsiteSecurityTool, executeWebsiteSecurityTool, validateWebsiteSecurityToolInput } from "./websiteSecurityToolHandlers";
import { deductCredits, grantCredits } from "./billing";

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
  result?: Record<string, unknown>;
  requiresDryRun: boolean;
  requiresApproval: boolean;
  requiresSafeBuild: boolean;
  warnings: string[];
  invocationId?: number;
  rawValuesReturned: false;
}

const SYSTEM_ARTIFACT_TOOL: ToolDefinition = {
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

const TOOL_CREDIT_COSTS: Record<string, number> = {
  "website.crawl.map": 2,
  "website.link_check": 2,
  "website.ui_smoke_test": 4,
  "website.form_flow_test": 4,
  "website.responsive_visual_check": 4,
  "website.console_network_audit": 4,
  "website.download_safety.review": 2,
  "quality.lighthouse.audit": 8,
  "quality.core_web_vitals.audit": 4,
  "quality.accessibility.axe_audit": 6,
  "quality.keyboard_navigation.audit": 4,
  "quality.seo_technical.audit": 3,
  "security.passive_baseline.audit": 4,
  "security.tls_certificate.audit": 2,
  "security.http_headers.audit": 2,
  "security.cookie_flags.audit": 2,
  "security.csp.audit": 2,
  "security.cors.audit": 2,
  "security.redirect_mixed_content.audit": 2,
  "security.sensitive_data_exposure.audit": 3,
  "security.sitemap_robots.review": 2,
  "api.contract.audit": 3,
  "api.authz_matrix.audit": 3,
  "api.rate_limit.audit": 2,
  "supply.sbom.generate": 2,
  "supply.dependency_vuln.audit": 3,
  "supply.license.review": 2,
  "deployment.config_security.review": 2,
  "report.owasp_asvs.generate": 1,
  "report.owasp_wstg.generate": 1,
  "report.website_qa.generate": 1,
};

function getBrokerToolById(toolId: string): ToolDefinition | undefined {
  if (toolId === SYSTEM_ARTIFACT_TOOL.toolId) return SYSTEM_ARTIFACT_TOOL;
  return getSecurityHardeningToolById(toolId) ?? getToolById(toolId);
}

function allBrokerTools(): ToolDefinition[] {
  return [...getAllTools(), ...SECURITY_HARDENING_TOOLS, SYSTEM_ARTIFACT_TOOL];
}

function creditCostForTool(toolId: string): number {
  return TOOL_CREDIT_COSTS[toolId] ?? (canExecuteWebsiteSecurityTool(toolId) ? 2 : 0);
}

function sessionIdFromPayload(payload: Record<string, unknown> | undefined): number | undefined {
  const raw = payload?.["sessionId"] ?? payload?.["session_id"];
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : undefined;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

async function refundToolCredits(userId: number, amount: number, toolId: string): Promise<void> {
  if (amount <= 0 || userId <= 0) return;
  try {
    await grantCredits(userId, amount, `tool_refund:${toolId}`);
  } catch {
    // Refund failure must not expose internals to the user. It is logged by billing/logger where available.
  }
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

async function checkVaultCredential(userId: number, tool: ToolDefinition): Promise<boolean> {
  if (!tool.credentialProvider) return true;
  const envKeys: Record<string, string[]> = {
    github: ["GITHUB_TOKEN"],
    railway: ["RAILWAY_TOKEN"],
    stripe: ["STRIPE_SECRET_KEY"],
    smtp: ["SMTP_PASS"],
  };
  const envNames = envKeys[tool.credentialProvider] ?? [];
  for (const name of envNames) if (process.env[name]) return true;
  try {
    const creds = await listVibaCredentials(userId);
    return creds.some((c) => String(c["provider"] ?? "").startsWith(tool.credentialProvider ?? "__never__") && (tool.credentialKind ? c["kind"] === tool.credentialKind : true));
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

export async function getAvailableTools(userId: number): Promise<Array<{
  toolId: string; label: string; category: string; riskLevel: string;
  requiresApproval: boolean; supportsDryRun: boolean; requiresSafeBuild: boolean;
  credentialStatus: "configured" | "missing" | "not_required";
  creditCost: number;
  rawValuesReturned: false;
}>> {
  await ensureInvocationsTable();
  const tools = allBrokerTools();
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
        creditCost: creditCostForTool(tool.toolId),
        rawValuesReturned: false as const,
      };
    }),
  );
  return results;
}

export async function planToolAction(input: BrokerInput): Promise<BrokerResult> {
  const tool = getBrokerToolById(input.toolId);
  if (!tool) {
    await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: input.toolId, agentName: input.requestedByAgent ?? null, riskLevel: "unknown", status: "blocked", dryRun: false, approvalRequired: false, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: {}, error: "Tool not found in registry" });
    return { status: "blocked", toolId: input.toolId, label: input.toolId, riskLevel: "unknown", message: `Tool '${input.toolId}' is not registered in the VIBA tool registry.`, requiresDryRun: false, requiresApproval: false, requiresSafeBuild: false, warnings: [], rawValuesReturned: false };
  }

  const hasVaultCredential = await checkVaultCredential(input.userId, tool);
  const hasByokCredential = await checkByokCredential(input.userId);
  const context: PolicyContext = { hasSafeBuildPassed: false, hasByokCredential, hasVaultCredential };
  const policy = evaluateToolPolicy(tool, context);

  if (!policy.allowed) {
    const status: BrokerStatus = policy.blockedReason?.includes("credential") ? "missing_credential" : "blocked";
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

  const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: tool.toolId, agentName: input.requestedByAgent ?? null, riskLevel: tool.riskLevel, status, dryRun: false, approvalRequired: policy.requiresApproval, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: { creditCost: creditCostForTool(tool.toolId) }, error: null });
  return { status, toolId: tool.toolId, label: tool.label, riskLevel: tool.riskLevel, message, requiresDryRun: policy.requiresDryRun, requiresApproval: policy.requiresApproval, requiresSafeBuild: policy.requiresSafeBuild, warnings: policy.warnings, invocationId: id ?? undefined, rawValuesReturned: false };
}

export async function dryRunToolAction(input: BrokerInput): Promise<BrokerResult> {
  const tool = getBrokerToolById(input.toolId);
  if (!tool) return planToolAction(input);
  if (!tool.supportsDryRun) {
    const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: tool.toolId, agentName: input.requestedByAgent ?? null, riskLevel: tool.riskLevel, status: "blocked", dryRun: true, approvalRequired: false, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: {}, error: "Tool does not support dry-run" });
    return { status: "blocked", toolId: tool.toolId, label: tool.label, riskLevel: tool.riskLevel, message: `${tool.label} does not support dry-run mode.`, requiresDryRun: false, requiresApproval: tool.requiresApproval, requiresSafeBuild: tool.requiresSafeBuild, warnings: [], invocationId: id ?? undefined, rawValuesReturned: false };
  }

  const simulatedResult = {
    mode: "dry_run",
    tool: tool.toolId,
    action: input.action,
    payloadKeys: Object.keys(input.payload ?? {}),
    creditCost: creditCostForTool(tool.toolId),
    simulatedOutcome: tool.toolId === "artifact.deliver"
      ? "VIBA would create an assistant chat message and attach a downloadable document/file/ZIP for the user. No file was stored in dry-run mode."
      : `${tool.label} would execute with action '${input.action}'. No mutations performed and no credits deducted in dry-run mode.`,
    note: "This is a simulation. No external systems were called. No secrets were used.",
  };
  const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: tool.toolId, agentName: input.requestedByAgent ?? null, riskLevel: tool.riskLevel, status: "executed", dryRun: true, approvalRequired: tool.requiresApproval, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: simulatedResult, error: null });

  return { status: "executed", toolId: tool.toolId, label: tool.label, riskLevel: tool.riskLevel, message: `Dry-run complete for ${tool.label}.`, dryRunResult: simulatedResult, requiresDryRun: false, requiresApproval: tool.requiresApproval, requiresSafeBuild: tool.requiresSafeBuild, warnings: tool.requiresApproval ? [`${tool.label} still requires user approval before live execution.`] : [], invocationId: id ?? undefined, rawValuesReturned: false };
}

function artifactPayload(input: BrokerInput): DeliverArtifactInput {
  const payload = input.payload ?? {};
  return {
    sessionId: Number(payload["sessionId"] ?? payload["session_id"]),
    userId: input.userId,
    taskId: input.taskId ?? (payload["taskId"] as string | number | null | undefined) ?? null,
    agentName: input.requestedByAgent ?? String(payload["agentName"] ?? "VIBA Agent"),
    agentRole: String(payload["agentRole"] ?? "Artifact-capable agent"),
    artifactType: String(payload["artifactType"] ?? "document") as "document" | "file" | "zip",
    fileName: String(payload["fileName"] ?? "viba-artifact.md"),
    mimeType: payload["mimeType"] ? String(payload["mimeType"]) : undefined,
    content: payload["content"] ? String(payload["content"]) : undefined,
    encoding: payload["encoding"] === "base64" ? "base64" : "utf8",
    files: Array.isArray(payload["files"]) ? payload["files"] as DeliverArtifactInput["files"] : undefined,
    messageText: payload["messageText"] ? String(payload["messageText"]) : undefined,
    metadata: { requestedByToolBroker: true },
  };
}

export async function executeToolAction(input: BrokerInput): Promise<BrokerResult> {
  const plan = await planToolAction({ ...input, dryRun: false });
  if (["blocked", "missing_credential", "scope_denied"].includes(plan.status)) return plan;
  if (plan.requiresApproval && !input.approvalToken) {
    const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: input.toolId, agentName: input.requestedByAgent ?? null, riskLevel: plan.riskLevel, status: "needs_user_approval", dryRun: false, approvalRequired: true, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: {}, error: "Approval required but no approval token provided" });
    return { ...plan, status: "needs_user_approval", invocationId: id ?? undefined };
  }
  if (plan.requiresSafeBuild) {
    const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: input.toolId, agentName: input.requestedByAgent ?? null, riskLevel: plan.riskLevel, status: "dry_run_required", dryRun: false, approvalRequired: plan.requiresApproval, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: {}, error: "Safe build gate required before execution" });
    return { ...plan, status: "dry_run_required", invocationId: id ?? undefined };
  }

  const tool = getBrokerToolById(input.toolId)!;
  const creditCost = creditCostForTool(tool.toolId);

  if (canExecuteWebsiteSecurityTool(tool.toolId)) {
    const validation = validateWebsiteSecurityToolInput(tool.toolId, input.payload);
    if (!validation.ok) {
      const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: tool.toolId, agentName: input.requestedByAgent ?? null, riskLevel: tool.riskLevel, status: "blocked", dryRun: false, approvalRequired: tool.requiresApproval, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: { creditCost }, error: validation.error });
      return { status: "blocked", toolId: tool.toolId, label: tool.label, riskLevel: tool.riskLevel, message: validation.error, requiresDryRun: false, requiresApproval: false, requiresSafeBuild: false, warnings: plan.warnings, invocationId: id ?? undefined, rawValuesReturned: false };
    }
  }

  if (creditCost > 0) {
    if (!Number.isFinite(input.userId) || input.userId <= 0) {
      const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: tool.toolId, agentName: input.requestedByAgent ?? null, riskLevel: tool.riskLevel, status: "blocked", dryRun: false, approvalRequired: tool.requiresApproval, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: { creditCost }, error: "Authenticated user required for credit deduction" });
      return { status: "blocked", toolId: tool.toolId, label: tool.label, riskLevel: tool.riskLevel, message: "Authenticated user required before metered tool execution.", requiresDryRun: false, requiresApproval: false, requiresSafeBuild: false, warnings: plan.warnings, invocationId: id ?? undefined, rawValuesReturned: false };
    }
    const deducted = await deductCredits(input.userId, creditCost, sessionIdFromPayload(input.payload));
    if (!deducted) {
      const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: tool.toolId, agentName: input.requestedByAgent ?? null, riskLevel: tool.riskLevel, status: "blocked", dryRun: false, approvalRequired: tool.requiresApproval, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: { creditCost }, error: "Insufficient credits" });
      return { status: "blocked", toolId: tool.toolId, label: tool.label, riskLevel: tool.riskLevel, message: `Insufficient credits. ${tool.label} costs ${creditCost} credit${creditCost === 1 ? "" : "s"}.`, requiresDryRun: false, requiresApproval: false, requiresSafeBuild: false, warnings: plan.warnings, invocationId: id ?? undefined, rawValuesReturned: false };
    }
  }

  try {
    if (tool.toolId === "artifact.deliver") {
      const result = await deliverSystemArtifactToUser(artifactPayload(input));
      const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: tool.toolId, agentName: input.requestedByAgent ?? null, riskLevel: tool.riskLevel, status: "executed", dryRun: false, approvalRequired: false, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: redactResult(result as unknown as Record<string, unknown>), error: null });
      return { status: "executed", toolId: tool.toolId, label: tool.label, riskLevel: tool.riskLevel, message: "Artifact delivered to the user chat as a downloadable attachment.", result: result as unknown as Record<string, unknown>, requiresDryRun: false, requiresApproval: false, requiresSafeBuild: false, warnings: [], invocationId: id ?? undefined, rawValuesReturned: false };
    }

    const executionResult = canExecuteWebsiteSecurityTool(tool.toolId)
      ? await executeWebsiteSecurityTool(tool, input)
      : { executed: true, toolId: tool.toolId, action: input.action, note: `${tool.label} execution stub. Wire tool adapter for live integration.`, rawValuesReturned: false };

    if (executionResult["executed"] === false) {
      await refundToolCredits(input.userId, creditCost, tool.toolId);
      const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: tool.toolId, agentName: input.requestedByAgent ?? null, riskLevel: tool.riskLevel, status: "failed", dryRun: false, approvalRequired: tool.requiresApproval, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: redactResult(executionResult), error: String(executionResult["error"] ?? "Tool execution failed") });
      return { status: "failed", toolId: tool.toolId, label: tool.label, riskLevel: tool.riskLevel, message: String(executionResult["error"] ?? "Tool execution failed"), result: executionResult, requiresDryRun: false, requiresApproval: false, requiresSafeBuild: false, warnings: plan.warnings, invocationId: id ?? undefined, rawValuesReturned: false };
    }

    const meteredResult = creditCost > 0 ? { ...executionResult, creditCostDeducted: creditCost } : executionResult;
    const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: tool.toolId, agentName: input.requestedByAgent ?? null, riskLevel: tool.riskLevel, status: "executed", dryRun: false, approvalRequired: tool.requiresApproval, approvedAt: input.approvalToken ? new Date() : null, payloadRedacted: redactPayload(input.payload), resultRedacted: redactResult(meteredResult), error: null });
    return { status: "executed", toolId: tool.toolId, label: tool.label, riskLevel: tool.riskLevel, message: `${tool.label} executed successfully.`, result: meteredResult, requiresDryRun: false, requiresApproval: false, requiresSafeBuild: false, warnings: plan.warnings, invocationId: id ?? undefined, rawValuesReturned: false };
  } catch (err) {
    await refundToolCredits(input.userId, creditCost, tool.toolId);
    const id = await logInvocation({ userId: input.userId, taskId: String(input.taskId ?? ""), toolId: tool.toolId, agentName: input.requestedByAgent ?? null, riskLevel: tool.riskLevel, status: "failed", dryRun: false, approvalRequired: tool.requiresApproval, approvedAt: null, payloadRedacted: redactPayload(input.payload), resultRedacted: creditCost > 0 ? { creditCostRefunded: creditCost } : {}, error: String(err) });
    return { status: "failed", toolId: tool.toolId, label: tool.label, riskLevel: tool.riskLevel, message: String(err), requiresDryRun: false, requiresApproval: false, requiresSafeBuild: false, warnings: plan.warnings, invocationId: id ?? undefined, rawValuesReturned: false };
  }
}
