/**
 * VIBA Agent Runtime Engine — Task Execution State Machine
 *
 * Turns a task plan into controlled, step-by-step agent execution.
 * Rules:
 * - One step runs at a time (unless parallelSafe)
 * - High-risk steps pause for user approval
 * - Tool steps go through Tool Action Broker only
 * - Credential access via vault resolver only
 * - Safe-build required before deploy/merge
 * - All actions logged to agent comms + audit
 * - No raw secrets ever in messages or status
 */
import { pool } from "@workspace/db";
import { planToolAction } from "./toolActionBroker";
import { getToolById } from "./toolRegistry";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RuntimeStatus =
  | "created"
  | "planning"
  | "ready"
  | "running"
  | "waiting_for_user_approval"
  | "waiting_for_credential"
  | "waiting_for_browser_authorization"
  | "waiting_for_safe_build"
  | "blocked"
  | "failed"
  | "cancelled"
  | "completed"
  | "ready_for_owner_review";

export type StepStatus =
  | "pending"
  | "running"
  | "waiting"
  | "blocked"
  | "failed"
  | "skipped"
  | "completed";

export interface TaskRun {
  id: number;
  taskId: number;
  userId: number;
  status: RuntimeStatus;
  currentStepId: number | null;
  riskLevel: string;
  safeBuildRequired: boolean;
  safeBuildStatus: "not_run" | "running" | "passed" | "failed";
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  rawValuesReturned: false;
}

export interface TaskStep {
  id: number;
  taskId: number;
  userId: number;
  stepIndex: number;
  stepId: string;
  agentName: string;
  title: string;
  description: string;
  status: StepStatus;
  riskLevel: string;
  toolId: string | null;
  requiresApproval: boolean;
  approvalStatus: "pending" | "approved" | "denied" | "expired" | "not_required";
  requiresCredential: boolean;
  credentialProvider: string | null;
  credentialKind: string | null;
  credentialLabel: string | null;
  requiresSafeBuild: boolean;
  startedAt: string | null;
  completedAt: string | null;
  blockedReason: string | null;
  error: string | null;
  metadataJson: Record<string, unknown> | null;
  createdAt: string;
  rawValuesReturned: false;
}

// ─── DB setup ────────────────────────────────────────────────────────────────

async function ensureRunsTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_task_runs (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      current_step_id INTEGER,
      risk_level TEXT NOT NULL DEFAULT 'low',
      safe_build_required BOOLEAN NOT NULL DEFAULT FALSE,
      safe_build_status TEXT NOT NULL DEFAULT 'not_run',
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      failure_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_task_runs_task ON viba_task_runs (task_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_task_runs_user ON viba_task_runs (user_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_task_runs_status ON viba_task_runs (status, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_task_steps (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      step_id TEXT NOT NULL,
      agent_name TEXT NOT NULL DEFAULT 'coordinator',
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      risk_level TEXT NOT NULL DEFAULT 'low',
      tool_id TEXT,
      requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
      approval_status TEXT NOT NULL DEFAULT 'not_required',
      requires_credential BOOLEAN NOT NULL DEFAULT FALSE,
      credential_provider TEXT,
      credential_kind TEXT,
      credential_label TEXT,
      requires_safe_build BOOLEAN NOT NULL DEFAULT FALSE,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      blocked_reason TEXT,
      error TEXT,
      metadata_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_task_steps_task ON viba_task_steps (task_id, step_index)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_task_steps_user ON viba_task_steps (user_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_task_steps_status ON viba_task_steps (status, created_at DESC)`);
}

// ─── Agent comms writer ───────────────────────────────────────────────────────

const REDACT_META_KEYS = new Set(["password", "token", "api_key", "secret", "key", "webhook_secret"]);

function redactMeta(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_META_KEYS.has(k.toLowerCase())) { out[k] = "[REDACTED]"; }
    else if (typeof v === "object" && v !== null && !Array.isArray(v)) { out[k] = redactMeta(v as Record<string, unknown>); }
    else { out[k] = typeof v === "string" ? v.slice(0, 1000) : v; }
  }
  return out;
}

async function writeCommsMessage(params: {
  userId: number;
  taskId: number;
  fromAgent: string;
  toAgent?: string;
  messageType: string;
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const meta = params.metadata ? redactMeta(params.metadata) : null;
    await pool.query(
      `INSERT INTO viba_agent_comms (user_id, task_id, from_agent, to_agent, message_type, message, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [params.userId, params.taskId, params.fromAgent, params.toAgent ?? "coordinator", params.messageType, params.message.slice(0, 2000), meta ? JSON.stringify(meta) : null],
    );
  } catch { /* non-fatal */ }
}

// ─── Row helpers ──────────────────────────────────────────────────────────────

function rowToRun(row: Record<string, unknown>): TaskRun {
  return {
    id: Number(row["id"]),
    taskId: Number(row["task_id"]),
    userId: Number(row["user_id"]),
    status: String(row["status"] ?? "created") as RuntimeStatus,
    currentStepId: row["current_step_id"] != null ? Number(row["current_step_id"]) : null,
    riskLevel: String(row["risk_level"] ?? "low"),
    safeBuildRequired: Boolean(row["safe_build_required"]),
    safeBuildStatus: String(row["safe_build_status"] ?? "not_run") as TaskRun["safeBuildStatus"],
    startedAt: row["started_at"] ? String(row["started_at"]) : null,
    completedAt: row["completed_at"] ? String(row["completed_at"]) : null,
    cancelledAt: row["cancelled_at"] ? String(row["cancelled_at"]) : null,
    failedAt: row["failed_at"] ? String(row["failed_at"]) : null,
    failureReason: row["failure_reason"] ? String(row["failure_reason"]) : null,
    createdAt: String(row["created_at"]),
    rawValuesReturned: false,
  };
}

function rowToStep(row: Record<string, unknown>): TaskStep {
  return {
    id: Number(row["id"]),
    taskId: Number(row["task_id"]),
    userId: Number(row["user_id"]),
    stepIndex: Number(row["step_index"]),
    stepId: String(row["step_id"] ?? ""),
    agentName: String(row["agent_name"] ?? "coordinator"),
    title: String(row["title"] ?? ""),
    description: String(row["description"] ?? ""),
    status: String(row["status"] ?? "pending") as StepStatus,
    riskLevel: String(row["risk_level"] ?? "low"),
    toolId: row["tool_id"] ? String(row["tool_id"]) : null,
    requiresApproval: Boolean(row["requires_approval"]),
    approvalStatus: String(row["approval_status"] ?? "not_required") as TaskStep["approvalStatus"],
    requiresCredential: Boolean(row["requires_credential"]),
    credentialProvider: row["credential_provider"] ? String(row["credential_provider"]) : null,
    credentialKind: row["credential_kind"] ? String(row["credential_kind"]) : null,
    credentialLabel: row["credential_label"] ? String(row["credential_label"]) : null,
    requiresSafeBuild: Boolean(row["requires_safe_build"]),
    startedAt: row["started_at"] ? String(row["started_at"]) : null,
    completedAt: row["completed_at"] ? String(row["completed_at"]) : null,
    blockedReason: row["blocked_reason"] ? String(row["blocked_reason"]) : null,
    error: row["error"] ? String(row["error"]) : null,
    metadataJson: row["metadata_json"] ? (row["metadata_json"] as Record<string, unknown>) : null,
    createdAt: String(row["created_at"]),
    rawValuesReturned: false,
  };
}

// ─── Plan step → DB step mapping ──────────────────────────────────────────────

interface PlanStep {
  stepNumber: number;
  title: string;
  description: string;
  assignedAgent: string;
  requiresApproval: boolean;
  safeBuildCheckpoint: boolean;
}

interface RequiredTool {
  toolId: string;
  riskLevel: string;
  requiresApproval: boolean;
}

const APPROVAL_REQUIRED_AGENTS = new Set(["payments", "deployment", "browser_operator"]);
const SAFE_BUILD_AGENTS = new Set(["builder", "deployment", "security"]);

function planStepToDbRow(step: PlanStep, taskId: number, userId: number, requiredTools: RequiredTool[]) {
  const agentName = String(step.assignedAgent ?? "coordinator");
  // Find matching tool for this agent
  const matchingTool = requiredTools.find((t) => {
    const tool = getToolById(t.toolId);
    if (!tool) return false;
    if (agentName === "deployment" && tool.category === "deployment") return true;
    if (agentName === "payments" && tool.category === "payments") return true;
    if (agentName === "builder" && tool.category === "build") return true;
    if (agentName === "security" && tool.category === "security") return true;
    if (agentName === "browser_operator" && tool.category === "browser") return true;
    return false;
  });

  const requiresApproval = step.requiresApproval || APPROVAL_REQUIRED_AGENTS.has(agentName);
  const requiresSafeBuild = step.safeBuildCheckpoint || SAFE_BUILD_AGENTS.has(agentName);
  const riskLevel = matchingTool?.riskLevel ?? (requiresApproval ? "high" : requiresSafeBuild ? "medium" : "low");

  return {
    taskId,
    userId,
    stepIndex: step.stepNumber,
    stepId: `step-${step.stepNumber}-${agentName}`,
    agentName,
    title: step.title,
    description: step.description ?? "",
    riskLevel,
    toolId: matchingTool?.toolId ?? null,
    requiresApproval,
    approvalStatus: requiresApproval ? "pending" : "not_required",
    requiresCredential: !!matchingTool && !!getToolById(matchingTool.toolId)?.credentialProvider,
    credentialProvider: matchingTool ? (getToolById(matchingTool.toolId)?.credentialProvider ?? null) : null,
    credentialKind: matchingTool ? (getToolById(matchingTool.toolId)?.credentialKind ?? null) : null,
    credentialLabel: matchingTool ? `${getToolById(matchingTool.toolId)?.credentialProvider ?? ""}/${getToolById(matchingTool.toolId)?.credentialKind ?? ""}` : null,
    requiresSafeBuild,
  };
}

// ─── startTaskRuntime ─────────────────────────────────────────────────────────

export async function startTaskRuntime(taskId: number, userId: number): Promise<{ run: TaskRun; steps: TaskStep[]; blockers: string[] }> {
  await ensureRunsTables();

  // Load task
  const { rows: taskRows } = await pool.query<Record<string, unknown>>(
    `SELECT id, user_id, status, plan_json, risk_level, safe_build_required FROM viba_tasks WHERE id = $1 AND user_id = $2`,
    [taskId, userId],
  );
  const task = taskRows[0];
  if (!task) throw new Error("Task not found or access denied");

  const taskStatus = String(task["status"] ?? "");
  if (["cancelled", "completed"].includes(taskStatus)) {
    throw new Error(`Task cannot be started from status: ${taskStatus}`);
  }

  // Check for existing run
  const { rows: existingRuns } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_task_runs WHERE task_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [taskId, userId],
  );

  let runId: number;
  if (existingRuns[0] && !["cancelled", "completed", "failed"].includes(String(existingRuns[0]["status"] ?? ""))) {
    runId = Number(existingRuns[0]["id"]);
    await pool.query(`UPDATE viba_task_runs SET status = 'running', started_at = COALESCE(started_at, NOW()), updated_at = NOW() WHERE id = $1`, [runId]);
  } else {
    const plan = task["plan_json"] as Record<string, unknown> | null;
    const safeBuildRequired = Boolean(task["safe_build_required"] ?? plan?.["safeBuildRequired"] ?? false);
    const riskLevel = String(task["risk_level"] ?? plan?.["riskLevel"] ?? "low");

    const { rows: runRows } = await pool.query<{ id: number }>(
      `INSERT INTO viba_task_runs (task_id, user_id, status, risk_level, safe_build_required, started_at)
       VALUES ($1, $2, 'running', $3, $4, NOW()) RETURNING id`,
      [taskId, userId, riskLevel, safeBuildRequired],
    );
    runId = runRows[0].id;
  }

  // Update task status
  await pool.query(`UPDATE viba_tasks SET status = 'running', updated_at = NOW() WHERE id = $1 AND user_id = $2`, [taskId, userId]);

  // Create steps from plan (if not already created)
  const { rows: existingSteps } = await pool.query<Record<string, unknown>>(
    `SELECT id FROM viba_task_steps WHERE task_id = $1 AND user_id = $2 LIMIT 1`,
    [taskId, userId],
  );

  if (existingSteps.length === 0) {
    const plan = task["plan_json"] as Record<string, unknown> | null;
    const planSteps = (plan?.["steps"] as PlanStep[] | undefined) ?? [];
    const requiredTools = (plan?.["requiredTools"] as RequiredTool[] | undefined) ?? [];

    for (const step of planSteps) {
      const dbRow = planStepToDbRow(step, taskId, userId, requiredTools);
      await pool.query(
        `INSERT INTO viba_task_steps (task_id, user_id, step_index, step_id, agent_name, title, description, risk_level, tool_id, requires_approval, approval_status, requires_credential, credential_provider, credential_kind, credential_label, requires_safe_build)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [dbRow.taskId, dbRow.userId, dbRow.stepIndex, dbRow.stepId, dbRow.agentName, dbRow.title, dbRow.description, dbRow.riskLevel, dbRow.toolId, dbRow.requiresApproval, dbRow.approvalStatus, dbRow.requiresCredential, dbRow.credentialProvider, dbRow.credentialKind, dbRow.credentialLabel, dbRow.requiresSafeBuild],
      );
    }
  }

  // Write coordinator message
  const plan = task["plan_json"] as Record<string, unknown> | null;
  const stepCount = ((plan?.["steps"] as unknown[]) ?? []).length;
  await writeCommsMessage({ userId, taskId, fromAgent: "coordinator", messageType: "runtime_status", message: `Task runtime started. ${stepCount} steps planned. Executing in sequence — sensitive steps will pause for approval.` });

  // Fetch final run and steps
  const { rows: runRow } = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_runs WHERE id = $1`, [runId]);
  const { rows: stepRows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_task_steps WHERE task_id = $1 AND user_id = $2 ORDER BY step_index`,
    [taskId, userId],
  );

  const blockers: string[] = [];
  if (Boolean(plan?.["approvalRequired"])) blockers.push("Task-level approval required before high-risk steps execute.");
  if (Boolean(plan?.["safeBuildRequired"])) blockers.push("Safe build gate required before deployment: run pnpm run safe-build.");

  return { run: rowToRun(runRow[0]!), steps: stepRows.map(rowToStep), blockers };
}

// ─── runNextStep ──────────────────────────────────────────────────────────────

export async function runNextStep(taskId: number, userId: number): Promise<{ run: TaskRun; step: TaskStep | null; action: string; blockers: string[] }> {
  await ensureRunsTables();

  // Get run
  const { rows: runRows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_task_runs WHERE task_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [taskId, userId],
  );
  if (!runRows[0]) throw new Error("No runtime found for this task. Call /start first.");

  const runId = Number(runRows[0]["id"]);
  const runStatus = String(runRows[0]["status"] ?? "");
  if (["cancelled", "completed", "failed"].includes(runStatus)) {
    throw new Error(`Runtime is in terminal state: ${runStatus}`);
  }

  // Get next pending step
  const { rows: stepRows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_task_steps WHERE task_id = $1 AND user_id = $2 AND status = 'pending' ORDER BY step_index LIMIT 1`,
    [taskId, userId],
  );

  if (!stepRows[0]) {
    // All steps done or no steps
    const { rows: pendingBlocked } = await pool.query<Record<string, unknown>>(
      `SELECT COUNT(*) as cnt FROM viba_task_steps WHERE task_id = $1 AND user_id = $2 AND status IN ('waiting','blocked')`,
      [taskId, userId],
    );
    const blockedCount = Number((pendingBlocked[0] as Record<string, unknown>)?.["cnt"] ?? 0);
    if (blockedCount > 0) {
      await pool.query(`UPDATE viba_task_runs SET status = 'waiting_for_user_approval', updated_at = NOW() WHERE id = $1`, [runId]);
      const finalRun = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_runs WHERE id = $1`, [runId]);
      return { run: rowToRun(finalRun.rows[0]!), step: null, action: "waiting", blockers: [`${blockedCount} step(s) waiting for approval or credential.`] };
    }

    // Complete!
    await pool.query(`UPDATE viba_task_runs SET status = 'ready_for_owner_review', completed_at = NOW(), updated_at = NOW() WHERE id = $1`, [runId]);
    await pool.query(`UPDATE viba_tasks SET status = 'completed', updated_at = NOW() WHERE id = $1 AND user_id = $2`, [taskId, userId]);
    await writeCommsMessage({ userId, taskId, fromAgent: "reviewer", messageType: "final_report", message: "All steps completed. Evidence report ready for owner review. No secrets included." });
    const finalRun = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_runs WHERE id = $1`, [runId]);
    return { run: rowToRun(finalRun.rows[0]!), step: null, action: "completed", blockers: [] };
  }

  const step = stepRows[0];
  const stepId = Number(step["id"]);
  const stepRiskLevel = String(step["risk_level"] ?? "low");
  const toolId = step["tool_id"] ? String(step["tool_id"]) : null;
  const requiresApproval = Boolean(step["requires_approval"]);
  const requiresCredential = Boolean(step["requires_credential"]);
  const requiresSafeBuild = Boolean(step["requires_safe_build"]);
  const agentName = String(step["agent_name"] ?? "coordinator");
  const stepTitle = String(step["title"] ?? "");
  const blockers: string[] = [];

  // Mark step as running
  await pool.query(`UPDATE viba_task_steps SET status = 'running', started_at = NOW(), updated_at = NOW() WHERE id = $1`, [stepId]);
  await writeCommsMessage({ userId, taskId, fromAgent: agentName, messageType: "step_started", message: `Starting step: ${stepTitle}` });

  // Safe build gate
  if (requiresSafeBuild && String(runRows[0]["safe_build_status"] ?? "") !== "passed") {
    await pool.query(`UPDATE viba_task_steps SET status = 'waiting', blocked_reason = 'Safe build gate required', updated_at = NOW() WHERE id = $1`, [stepId]);
    await pool.query(`UPDATE viba_task_runs SET status = 'waiting_for_safe_build', updated_at = NOW() WHERE id = $1`, [runId]);
    blockers.push("Safe build required before this step. Run: pnpm run safe-build");
    await writeCommsMessage({ userId, taskId, fromAgent: "build", messageType: "safe_build_result", message: `Safe build gate: NOT passed. Run \`pnpm run safe-build\` before proceeding with: ${stepTitle}` });
    const finalRun = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_runs WHERE id = $1`, [runId]);
    const finalStep = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_steps WHERE id = $1`, [stepId]);
    return { run: rowToRun(finalRun.rows[0]!), step: rowToStep(finalStep.rows[0]!), action: "waiting_for_safe_build", blockers };
  }

  // Credential gate
  if (requiresCredential) {
    const credProvider = step["credential_provider"] ? String(step["credential_provider"]) : "unknown";
    const credKind = step["credential_kind"] ? String(step["credential_kind"]) : "unknown";
    const hasEnvCred = credProvider === "railway" && !!process.env["RAILWAY_TOKEN"] ||
                       credProvider === "stripe" && !!process.env["STRIPE_SECRET_KEY"] ||
                       credProvider === "smtp" && !!process.env["SMTP_PASS"];
    if (!hasEnvCred) {
      await pool.query(`UPDATE viba_task_steps SET status = 'waiting', blocked_reason = $1, updated_at = NOW() WHERE id = $2`, [`Vault credential required: ${credProvider}/${credKind}`, stepId]);
      await pool.query(`UPDATE viba_task_runs SET status = 'waiting_for_credential', updated_at = NOW() WHERE id = $1`, [runId]);
      blockers.push(`Vault credential required: ${credProvider}/${credKind}. Add via POST /api/credentials/save.`);
      await writeCommsMessage({ userId, taskId, fromAgent: agentName, messageType: "credential_required", message: `Vault credential required for this step: provider=${credProvider}, kind=${credKind}. Add to secure vault — raw key will not be requested here.` });
      const finalRun = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_runs WHERE id = $1`, [runId]);
      const finalStep = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_steps WHERE id = $1`, [stepId]);
      return { run: rowToRun(finalRun.rows[0]!), step: rowToStep(finalStep.rows[0]!), action: "waiting_for_credential", blockers };
    }
  }

  // Approval gate
  if (requiresApproval) {
    await pool.query(`UPDATE viba_task_steps SET status = 'waiting', approval_status = 'pending', updated_at = NOW() WHERE id = $1`, [stepId]);
    await pool.query(`UPDATE viba_task_runs SET status = 'waiting_for_user_approval', updated_at = NOW() WHERE id = $1`, [runId]);
    blockers.push(`User approval required for: ${stepTitle} (risk: ${stepRiskLevel})`);
    await writeCommsMessage({ userId, taskId, fromAgent: agentName, messageType: "approval_required", message: `User approval required before executing: ${stepTitle}. Risk level: ${stepRiskLevel}. No action will run until you approve.`, metadata: { stepId, riskLevel: stepRiskLevel, toolId } });
    const finalRun = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_runs WHERE id = $1`, [runId]);
    const finalStep = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_steps WHERE id = $1`, [stepId]);
    return { run: rowToRun(finalRun.rows[0]!), step: rowToStep(finalStep.rows[0]!), action: "waiting_for_approval", blockers };
  }

  // Tool broker gate
  if (toolId) {
    const brokerResult = await planToolAction({ userId, taskId, toolId, action: String(step["step_id"] ?? "execute"), requestedByAgent: agentName });
    if (brokerResult.status !== "ready") {
      const blockedReason = brokerResult.message;
      await pool.query(`UPDATE viba_task_steps SET status = 'waiting', blocked_reason = $1, updated_at = NOW() WHERE id = $2`, [blockedReason, stepId]);
      await pool.query(`UPDATE viba_task_runs SET status = 'waiting_for_user_approval', updated_at = NOW() WHERE id = $1`, [runId]);
      blockers.push(blockedReason);
      await writeCommsMessage({ userId, taskId, fromAgent: agentName, messageType: "tool_request", message: `Tool broker blocked: ${brokerResult.label} — ${brokerResult.message}`, metadata: { toolId, status: brokerResult.status, riskLevel: brokerResult.riskLevel } });
      const finalRun = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_runs WHERE id = $1`, [runId]);
      const finalStep = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_steps WHERE id = $1`, [stepId]);
      return { run: rowToRun(finalRun.rows[0]!), step: rowToStep(finalStep.rows[0]!), action: "tool_broker_blocked", blockers };
    }
    await writeCommsMessage({ userId, taskId, fromAgent: agentName, messageType: "tool_result", message: `Tool broker: ${brokerResult.label} is ready.`, metadata: { toolId, status: "ready" } });
  }

  // Mark step complete
  await pool.query(`UPDATE viba_task_steps SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`, [stepId]);
  await pool.query(`UPDATE viba_task_runs SET current_step_id = $1, updated_at = NOW() WHERE id = $2`, [stepId, runId]);
  await writeCommsMessage({ userId, taskId, fromAgent: agentName, messageType: "step_completed", message: `Step completed: ${stepTitle}` });

  const finalRun = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_runs WHERE id = $1`, [runId]);
  const finalStep = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_steps WHERE id = $1`, [stepId]);
  return { run: rowToRun(finalRun.rows[0]!), step: rowToStep(finalStep.rows[0]!), action: "step_completed", blockers: [] };
}

// ─── pauseTask ────────────────────────────────────────────────────────────────

export async function pauseTask(taskId: number, userId: number, reason: string): Promise<TaskRun> {
  await ensureRunsTables();
  await pool.query(
    `UPDATE viba_task_runs SET status = 'blocked', failure_reason = $1, updated_at = NOW()
     WHERE task_id = $2 AND user_id = $3 AND status NOT IN ('cancelled','completed','failed')`,
    [reason.slice(0, 500), taskId, userId],
  );
  await writeCommsMessage({ userId, taskId, fromAgent: "coordinator", messageType: "runtime_status", message: `Task paused: ${reason}` });
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_task_runs WHERE task_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [taskId, userId],
  );
  return rowToRun(rows[0]!);
}

// ─── resumeTask ───────────────────────────────────────────────────────────────

export async function resumeTask(taskId: number, userId: number): Promise<TaskRun> {
  await ensureRunsTables();
  await pool.query(
    `UPDATE viba_task_runs SET status = 'running', failure_reason = NULL, updated_at = NOW()
     WHERE task_id = $1 AND user_id = $2 AND status IN ('blocked','waiting_for_user_approval','waiting_for_credential','waiting_for_safe_build')`,
    [taskId, userId],
  );
  await pool.query(`UPDATE viba_tasks SET status = 'running', updated_at = NOW() WHERE id = $1 AND user_id = $2`, [taskId, userId]);
  await writeCommsMessage({ userId, taskId, fromAgent: "coordinator", messageType: "runtime_status", message: "Task resumed. Continuing from next eligible step." });
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_task_runs WHERE task_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [taskId, userId],
  );
  return rowToRun(rows[0]!);
}

// ─── approveStep ─────────────────────────────────────────────────────────────

export async function approveStep(taskId: number, userId: number, stepId: number, decision: "approved" | "denied"): Promise<{ run: TaskRun; step: TaskStep }> {
  await ensureRunsTables();
  if (decision === "denied") {
    await pool.query(`UPDATE viba_task_steps SET status = 'blocked', approval_status = 'denied', blocked_reason = 'User denied approval', updated_at = NOW() WHERE id = $1 AND task_id = $2 AND user_id = $3`, [stepId, taskId, userId]);
    await pool.query(`UPDATE viba_task_runs SET status = 'blocked', failure_reason = 'User denied step approval', updated_at = NOW() WHERE task_id = $1 AND user_id = $2`, [taskId, userId]);
    await pool.query(`UPDATE viba_tasks SET status = 'blocked', updated_at = NOW() WHERE id = $1 AND user_id = $2`, [taskId, userId]);
    await writeCommsMessage({ userId, taskId, fromAgent: "coordinator", messageType: "step_blocked", message: "User denied approval. Step blocked. Task execution halted." });
  } else {
    await pool.query(`UPDATE viba_task_steps SET status = 'pending', approval_status = 'approved', requires_approval = FALSE, updated_at = NOW() WHERE id = $1 AND task_id = $2 AND user_id = $3`, [stepId, taskId, userId]);
    await pool.query(`UPDATE viba_task_runs SET status = 'running', updated_at = NOW() WHERE task_id = $1 AND user_id = $2`, [taskId, userId]);
    await pool.query(`UPDATE viba_tasks SET status = 'running', updated_at = NOW() WHERE id = $1 AND user_id = $2`, [taskId, userId]);
    await writeCommsMessage({ userId, taskId, fromAgent: "coordinator", messageType: "runtime_status", message: "User approved step. Resuming execution." });
  }
  const { rows: runRows } = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_runs WHERE task_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`, [taskId, userId]);
  const { rows: stepRows } = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_steps WHERE id = $1`, [stepId]);
  return { run: rowToRun(runRows[0]!), step: rowToStep(stepRows[0]!) };
}

// ─── cancelTask ───────────────────────────────────────────────────────────────

export async function cancelTask(taskId: number, userId: number): Promise<TaskRun> {
  await ensureRunsTables();
  await pool.query(
    `UPDATE viba_task_runs SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
     WHERE task_id = $1 AND user_id = $2 AND status NOT IN ('completed','failed')`,
    [taskId, userId],
  );
  await pool.query(`UPDATE viba_tasks SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1 AND user_id = $2`, [taskId, userId]);
  await writeCommsMessage({ userId, taskId, fromAgent: "coordinator", messageType: "runtime_status", message: "Task cancelled by user." });
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_task_runs WHERE task_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [taskId, userId],
  );
  return rowToRun(rows[0]!);
}

// ─── completeTask / failTask ──────────────────────────────────────────────────

export async function completeTask(taskId: number, userId: number): Promise<TaskRun> {
  await ensureRunsTables();
  await pool.query(`UPDATE viba_task_runs SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE task_id = $1 AND user_id = $2`, [taskId, userId]);
  await pool.query(`UPDATE viba_tasks SET status = 'completed', updated_at = NOW() WHERE id = $1 AND user_id = $2`, [taskId, userId]);
  await writeCommsMessage({ userId, taskId, fromAgent: "reviewer", messageType: "final_report", message: "Task marked complete. Evidence report available." });
  const { rows } = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_runs WHERE task_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`, [taskId, userId]);
  return rowToRun(rows[0]!);
}

export async function failTask(taskId: number, userId: number, error: string): Promise<TaskRun> {
  await ensureRunsTables();
  await pool.query(`UPDATE viba_task_runs SET status = 'failed', failed_at = NOW(), failure_reason = $1, updated_at = NOW() WHERE task_id = $2 AND user_id = $3`, [error.slice(0, 500), taskId, userId]);
  await pool.query(`UPDATE viba_tasks SET status = 'failed', updated_at = NOW() WHERE id = $1 AND user_id = $2`, [taskId, userId]);
  await writeCommsMessage({ userId, taskId, fromAgent: "coordinator", messageType: "step_blocked", message: `Task failed: ${error.slice(0, 200)}` });
  const { rows } = await pool.query<Record<string, unknown>>(`SELECT * FROM viba_task_runs WHERE task_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`, [taskId, userId]);
  return rowToRun(rows[0]!);
}

// ─── getTaskRunStatus ─────────────────────────────────────────────────────────

export async function getTaskRunStatus(taskId: number, userId: number): Promise<{
  run: TaskRun | null;
  steps: TaskStep[];
  blockers: string[];
  pendingApprovals: TaskStep[];
  pendingCredentials: TaskStep[];
  rawValuesReturned: false;
}> {
  await ensureRunsTables();
  const { rows: runRows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_task_runs WHERE task_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [taskId, userId],
  );
  const { rows: stepRows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_task_steps WHERE task_id = $1 AND user_id = $2 ORDER BY step_index`,
    [taskId, userId],
  );
  const steps = stepRows.map(rowToStep);
  const blockers: string[] = [];
  const pendingApprovals = steps.filter((s) => s.requiresApproval && s.approvalStatus === "pending" && s.status === "waiting");
  const pendingCredentials = steps.filter((s) => s.requiresCredential && s.status === "waiting" && s.blockedReason?.includes("credential"));

  if (pendingApprovals.length > 0) blockers.push(`${pendingApprovals.length} step(s) waiting for user approval.`);
  if (pendingCredentials.length > 0) blockers.push(`${pendingCredentials.length} step(s) waiting for vault credential.`);
  const safeBuildStep = steps.find((s) => s.requiresSafeBuild && s.status === "waiting");
  if (safeBuildStep) blockers.push("Safe build gate required. Run: pnpm run safe-build");

  return {
    run: runRows[0] ? rowToRun(runRows[0]) : null,
    steps,
    blockers,
    pendingApprovals,
    pendingCredentials,
    rawValuesReturned: false,
  };
}
