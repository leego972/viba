/**
 * VIBA Evidence Report Generator
 *
 * Produces a final audit-friendly report for a completed or blocked task.
 * Never includes: API keys, tokens, passwords, webhook secrets, database URLs,
 * encrypted values, IV/auth tags, or any raw credential value.
 * rawValuesReturned: false is hardcoded.
 */
import { pool } from "@workspace/db";
import { getToolById } from "./toolRegistry";

const NEVER_INCLUDE = new Set([
  "password", "token", "api_key", "secret", "key", "webhook_secret",
  "database_url", "smtp_pass", "auth_tag", "iv", "encrypted_value",
  "private_key", "access_token", "refresh_token", "raw_key", "secret_value",
]);

function sanitizeRecord(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (NEVER_INCLUDE.has(k.toLowerCase())) { out[k] = "[REDACTED]"; }
    else if (typeof v === "object" && v !== null && !Array.isArray(v)) { out[k] = sanitizeRecord(v as Record<string, unknown>); }
    else { out[k] = v; }
  }
  return out;
}

export interface QASection {
  qaRunId: number | null;
  qaStatus: string | null;
  releaseStatus: string | null;
  checksPassed: number;
  checksFailed: number;
  blockers: string[];
  warnings: string[];
  manualChecksRemaining: number;
  browserEvidence: Array<{ route: string; status: string }>;
  safeBuildReportPath: string | null;
}

export interface EvidenceReport {
  taskId: number;
  taskRequest: string;
  finalStatus: string;
  riskLevel: string;
  safeBuildRequired: boolean;
  safeBuildStatus: string;
  deploymentReady: boolean;
  stepsCompleted: Array<{ stepIndex: number; title: string; agentName: string; completedAt: string | null }>;
  stepsBlocked: Array<{ stepIndex: number; title: string; agentName: string; blockedReason: string | null }>;
  agentsInvolved: string[];
  toolsRequested: Array<{ toolId: string; label: string; riskLevel: string }>;
  toolsExecuted: Array<{ toolId: string; label: string; status: string }>;
  approvalsRequested: number;
  approvalsGranted: number;
  approvalsDenied: number;
  credentialsUsed: Array<{ provider: string; kind: string; scope: string }>;
  remainingBlockers: string[];
  agentMessageCount: number;
  qa: QASection;
  generatedAt: string;
  rawValuesReturned: false;
  securityNote: string;
}

export async function generateEvidenceReport(taskId: number, userId: number): Promise<EvidenceReport> {
  // Load task
  const { rows: taskRows } = await pool.query<Record<string, unknown>>(
    `SELECT id, request, status, plan_json, risk_level, safe_build_required FROM viba_tasks WHERE id = $1 AND user_id = $2`,
    [taskId, userId],
  );
  if (!taskRows[0]) throw new Error("Task not found");
  const task = taskRows[0];
  const plan = task["plan_json"] as Record<string, unknown> | null;

  // Load run
  const { rows: runRows } = await pool.query<Record<string, unknown>>(
    `SELECT status, safe_build_status, risk_level FROM viba_task_runs WHERE task_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [taskId, userId],
  );
  const run = runRows[0] ?? null;

  // Load steps
  const { rows: stepRows } = await pool.query<Record<string, unknown>>(
    `SELECT step_index, title, agent_name, status, blocked_reason, requires_approval, approval_status, requires_credential, credential_provider, credential_kind, completed_at FROM viba_task_steps WHERE task_id = $1 AND user_id = $2 ORDER BY step_index`,
    [taskId, userId],
  );

  // Load tool invocations (keys/labels only, no secrets)
  const { rows: toolRows } = await pool.query<Record<string, unknown>>(
    `SELECT tool_id, status, dry_run FROM viba_tool_invocations WHERE task_id = $1::TEXT AND user_id = $2 ORDER BY created_at`,
    [String(taskId), userId],
  );

  // Load agent message count
  const { rows: msgCountRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM viba_agent_comms WHERE task_id = $1 AND user_id = $2`,
    [taskId, userId],
  );

  // Build report
  const stepsCompleted = stepRows
    .filter((s) => String(s["status"]) === "completed")
    .map((s) => ({ stepIndex: Number(s["step_index"]), title: String(s["title"]), agentName: String(s["agent_name"]), completedAt: s["completed_at"] ? String(s["completed_at"]) : null }));

  const stepsBlocked = stepRows
    .filter((s) => ["blocked", "failed", "waiting"].includes(String(s["status"])))
    .map((s) => ({ stepIndex: Number(s["step_index"]), title: String(s["title"]), agentName: String(s["agent_name"]), blockedReason: s["blocked_reason"] ? String(s["blocked_reason"]) : null }));

  const agentsInvolved = [...new Set(stepRows.map((s) => String(s["agent_name"])))];

  const approvalsRequested = stepRows.filter((s) => Boolean(s["requires_approval"])).length;
  const approvalsGranted = stepRows.filter((s) => String(s["approval_status"]) === "approved").length;
  const approvalsDenied = stepRows.filter((s) => String(s["approval_status"]) === "denied").length;

  // Credentials: by label only, never raw values
  const credentialsUsed = stepRows
    .filter((s) => Boolean(s["requires_credential"]) && s["credential_provider"])
    .map((s) => ({
      provider: String(s["credential_provider"] ?? ""),
      kind: String(s["credential_kind"] ?? ""),
      scope: String(s["agent_name"] ?? ""),
    }))
    .filter((c, i, arr) => arr.findIndex((x) => x.provider === c.provider && x.kind === c.kind) === i);

  // Tool summary (labels only)
  const toolsRequested = (plan?.["requiredTools"] as Array<Record<string, unknown>> | undefined ?? []).map((t) => ({
    toolId: String(t["toolId"] ?? ""),
    label: getToolById(String(t["toolId"] ?? ""))?.label ?? String(t["toolId"] ?? ""),
    riskLevel: String(t["riskLevel"] ?? "read_only"),
  }));

  const toolsExecuted = toolRows.map((t) => ({
    toolId: String(t["tool_id"] ?? ""),
    label: getToolById(String(t["tool_id"] ?? ""))?.label ?? String(t["tool_id"] ?? ""),
    status: String(t["status"] ?? ""),
  }));

  const safeBuildRequired = Boolean(task["safe_build_required"] ?? plan?.["safeBuildRequired"] ?? false);
  const safeBuildStatus = String(run?.["safe_build_status"] ?? "not_run");
  const finalStatus = String(run?.["status"] ?? task["status"] ?? "unknown");
  const deploymentReady = finalStatus === "ready_for_owner_review" && (!safeBuildRequired || safeBuildStatus === "passed");

  const remainingBlockers: string[] = [];
  if (stepsBlocked.length > 0) remainingBlockers.push(`${stepsBlocked.length} step(s) blocked or failed.`);
  if (safeBuildRequired && safeBuildStatus !== "passed") remainingBlockers.push("Safe build not yet passed. Run: pnpm run safe-build");
  if (approvalsDenied > 0) remainingBlockers.push(`${approvalsDenied} approval(s) denied by user.`);

  // QA Release Gate — load latest QA run for this task (if any)
  let qa: QASection = {
    qaRunId: null,
    qaStatus: null,
    releaseStatus: null,
    checksPassed: 0,
    checksFailed: 0,
    blockers: [],
    warnings: [],
    manualChecksRemaining: 0,
    browserEvidence: [],
    safeBuildReportPath: null,
  };
  try {
    const { rows: qaRunRows } = await pool.query<Record<string, unknown>>(
      `SELECT id, status, release_status, blockers_json, warnings_json FROM viba_qa_runs WHERE task_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1`,
      [taskId, userId],
    );
    const qaRun = qaRunRows[0] ?? null;
    if (qaRun) {
      const { rows: qaCheckRows } = await pool.query<{ passed: string; failed: string; manual_pending: string }>(
        `SELECT
           SUM(CASE WHEN status='passed' THEN 1 ELSE 0 END)::text as passed,
           SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)::text as failed,
           SUM(CASE WHEN manual=TRUE AND status IN ('pending','running') THEN 1 ELSE 0 END)::text as manual_pending
         FROM viba_qa_checks WHERE qa_run_id=$1`,
        [qaRun["id"]],
      );
      const { rows: browserRows } = await pool.query<{ check_name: string; status: string }>(
        `SELECT check_name, status FROM viba_qa_checks WHERE qa_run_id=$1 AND check_name LIKE 'Browser:%'`,
        [qaRun["id"]],
      );
      qa = {
        qaRunId: Number(qaRun["id"]),
        qaStatus: String(qaRun["status"] ?? ""),
        releaseStatus: String(qaRun["release_status"] ?? ""),
        checksPassed: Number(qaCheckRows[0]?.passed ?? 0),
        checksFailed: Number(qaCheckRows[0]?.failed ?? 0),
        blockers: (qaRun["blockers_json"] as string[] | null) ?? [],
        warnings: (qaRun["warnings_json"] as string[] | null) ?? [],
        manualChecksRemaining: Number(qaCheckRows[0]?.manual_pending ?? 0),
        browserEvidence: browserRows.map((r) => ({ route: r.check_name.replace("Browser: ", ""), status: r.status })),
        safeBuildReportPath: safeBuildStatus === "passed" ? "pnpm run safe-build (passed)" : null,
      };
    }
  } catch {
    // QA tables may not exist yet — qa section remains empty
  }

  return {
    taskId,
    taskRequest: String(task["request"] ?? "").slice(0, 2000),
    finalStatus,
    riskLevel: String(run?.["risk_level"] ?? task["risk_level"] ?? "low"),
    safeBuildRequired,
    safeBuildStatus,
    deploymentReady,
    stepsCompleted,
    stepsBlocked,
    agentsInvolved,
    toolsRequested,
    toolsExecuted,
    approvalsRequested,
    approvalsGranted,
    approvalsDenied,
    credentialsUsed,
    remainingBlockers,
    agentMessageCount: Number(msgCountRows[0]?.cnt ?? 0),
    qa,
    generatedAt: new Date().toISOString(),
    rawValuesReturned: false,
    securityNote: "This report contains no API keys, tokens, passwords, webhook secrets, database URLs, or any raw credential values. Credentials referenced by provider/kind/scope only.",
  };
}
