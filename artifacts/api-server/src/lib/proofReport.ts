/**
 * VIBA Proof Report Generator — Session-Level
 *
 * Generates a readable proof report for a VIBA session.
 * Safe to hand to a non-technical client — no secrets, no API keys exposed.
 * rawValuesReturned is hardcoded false.
 *
 * Works with real DB sessions or demo sessions (for /demo/proof-report).
 */
import { pool } from "@workspace/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProofReportAgent {
  name: string;
  provider: string;
  model: string;
  role: string;
}

export interface ProofReportTask {
  index: number;
  title: string;
  type: string;
  status: string;
  completedAt: string | null;
  blockedReason: string | null;
  agentName: string;
}

export interface ProofReportApproval {
  requestedAt: string;
  action: string;
  outcome: "granted" | "rejected" | "pending";
  note: string | null;
}

export interface ProofReportOutput {
  label: string;
  type: "file" | "report" | "analysis" | "plan" | "message";
  description: string;
}

export interface ProofReport {
  sessionId: string | number;
  generatedAt: string;
  userGoal: string;
  startedAt: string | null;
  completedAt: string | null;
  sessionStatus: string;
  sessionMode: "live" | "simulation" | "mixed" | string;
  agents: ProofReportAgent[];
  tasksCompleted: ProofReportTask[];
  tasksPending: ProofReportTask[];
  tasksBlocked: ProofReportTask[];
  approvalsRequested: number;
  approvalsGranted: number;
  approvalsRejected: number;
  approvalLog: ProofReportApproval[];
  blockersFound: string[];
  outputsGenerated: ProofReportOutput[];
  estimatedCostCredits: number | null;
  finalStatus: string;
  recommendedNextAction: string;
  rawValuesReturned: false;
  securityNote: string;
}

// ─── Secret scrubber ─────────────────────────────────────────────────────────

const REDACT_KEYS = new Set([
  "password", "token", "api_key", "secret", "key", "webhook_secret",
  "database_url", "smtp_pass", "auth_tag", "iv", "encrypted_value",
  "private_key", "access_token", "refresh_token", "raw_key", "secret_value",
  "connection_string", "credentials",
]);

function redact(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : redact(v);
  }
  return out;
}

// ─── Demo / static report ────────────────────────────────────────────────────

export function buildDemoProofReport(): ProofReport {
  return {
    sessionId: "demo-proof-001",
    generatedAt: new Date().toISOString(),
    userGoal: "Diagnose deployment failures in demo-company/landing-site and prepare a repair proposal.",
    startedAt: "2026-06-24T03:00:00Z",
    completedAt: "2026-06-24T03:00:31Z",
    sessionStatus: "completed",
    sessionMode: "simulation",
    agents: [
      { name: "ChatGPT", provider: "openai", model: "gpt-4.1-mini", role: "Architect" },
      { name: "Claude", provider: "anthropic", model: "claude-3-5-sonnet-20241022", role: "Developer" },
      { name: "Gemini", provider: "google", model: "gemini-2.0-flash", role: "Reviewer" },
    ],
    tasksCompleted: [
      { index: 1, title: "Scan Repository Structure", type: "doctor", status: "complete", completedAt: "2026-06-24T03:00:04Z", blockedReason: null, agentName: "ChatGPT" },
      { index: 2, title: "Identify Blockers", type: "doctor", status: "complete", completedAt: "2026-06-24T03:00:12Z", blockedReason: null, agentName: "Claude" },
      { index: 3, title: "Generate Health Score", type: "doctor", status: "complete", completedAt: "2026-06-24T03:00:19Z", blockedReason: null, agentName: "Gemini" },
      { index: 4, title: "Produce Repair Proposals", type: "doctor", status: "complete", completedAt: "2026-06-24T03:00:27Z", blockedReason: null, agentName: "ChatGPT" },
    ],
    tasksPending: [],
    tasksBlocked: [],
    approvalsRequested: 1,
    approvalsGranted: 1,
    approvalsRejected: 0,
    approvalLog: [
      { requestedAt: "2026-06-24T03:00:25Z", action: "github.createPR", outcome: "granted", note: "Owner approved repair PR creation" },
    ],
    blockersFound: [
      "Missing DATABASE_URL environment variable",
      "Health endpoint /health returning 404",
      "Node.js version not pinned in nixpacks.toml",
    ],
    outputsGenerated: [
      { label: "VIBA-DOCTOR-AUDIT.md", type: "file", description: "Full audit record with all findings and severity ratings" },
      { label: "Repair Proposals", type: "report", description: "3 PR-ready fixes identified; 1 manual-only item" },
      { label: "Health Score", type: "analysis", description: "Repository health: 61/100 — 3 blockers, 1 warning" },
    ],
    estimatedCostCredits: 5,
    finalStatus: "completed",
    recommendedNextAction: "Merge the VIBA Doctor repair PR, add DATABASE_URL to Railway env vars, and re-run Project Doctor to confirm health score improves above 80.",
    rawValuesReturned: false,
    securityNote: "This report contains no API keys, tokens, passwords, or credentials. All sensitive values are redacted.",
  };
}

// ─── Live session report ──────────────────────────────────────────────────────

export async function generateSessionProofReport(
  sessionId: number,
  userId: number,
): Promise<ProofReport> {
  // Load session
  const { rows: sessionRows } = await pool.query<Record<string, unknown>>(
    `SELECT id, goal, status, mode, created_at, updated_at FROM sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  if (!sessionRows[0]) throw new Error("Session not found or access denied.");
  const session = sessionRows[0];

  // Load agents
  const { rows: agentRows } = await pool.query<Record<string, unknown>>(
    `SELECT name, provider, model, role FROM agents WHERE session_id = $1`,
    [sessionId],
  );

  // Load tasks
  // BUG 4 FIX: tasks schema has no completed_at column — use updated_at when status='complete'.
  const { rows: taskRows } = await pool.query<Record<string, unknown>>(
    `SELECT t.id, t.title, t.type, t.status, t.blocked_reason,
            CASE WHEN t.status = 'complete' THEN t.updated_at ELSE NULL END AS completed_at,
            a.name AS agent_name,
            ROW_NUMBER() OVER (ORDER BY t.id) AS idx
     FROM tasks t
     LEFT JOIN agents a ON a.id = t.assigned_agent_id
     WHERE t.session_id = $1
     ORDER BY t.id`,
    [sessionId],
  );

  // Load approval events from audit_logs
  const { rows: approvalRows } = await pool.query<Record<string, unknown>>(
    `SELECT created_at, event_data FROM audit_logs
     WHERE session_id = $1 AND event_type IN ('approval_requested','approval_granted','approval_rejected')
     ORDER BY created_at`,
    [sessionId],
  );

  // Load messages for output hints
  const { rows: msgRows } = await pool.query<Record<string, unknown>>(
    `SELECT content FROM messages WHERE session_id = $1 AND role = 'assistant' ORDER BY created_at DESC LIMIT 20`,
    [sessionId],
  );

  // Load credit usage
  const { rows: creditRows } = await pool.query<Record<string, unknown>>(
    `SELECT COALESCE(SUM(credits_used), 0) AS total FROM session_credit_usage WHERE session_id = $1`,
    [sessionId],
  );

  // Parse tasks
  const allTasks: ProofReportTask[] = taskRows.map((r) => ({
    index: Number(r["idx"]),
    title: String(r["title"] ?? ""),
    type: String(r["type"] ?? ""),
    status: String(r["status"] ?? ""),
    completedAt: r["completed_at"] ? String(r["completed_at"]) : null,
    blockedReason: r["blocked_reason"] ? String(r["blocked_reason"]) : null,
    agentName: r["agent_name"] ? String(r["agent_name"]) : "Unknown",
  }));

  // BUG 3 FIX: use actual schema statuses (complete/planned/in_progress/review/blocked_needs_tools)
  // — not invented names like "completed", "pending", "blocked", "failed".
  const tasksCompleted = allTasks.filter((t) => t.status === "complete");
  const tasksPending   = allTasks.filter((t) => t.status === "planned" || t.status === "in_progress" || t.status === "review");
  const tasksBlocked   = allTasks.filter((t) => t.status === "blocked_needs_tools");

  // Parse approvals
  let approvalsGranted = 0, approvalsRejected = 0;
  const approvalLog: ProofReportApproval[] = [];

  for (const row of approvalRows) {
    const data = (row["event_data"] as Record<string, unknown>) ?? {};
    const safeData = redact(data) as Record<string, unknown>;
    const eventType = String(row["event_type"] ?? "");
    const outcome: "granted" | "rejected" | "pending" =
      eventType === "approval_granted" ? "granted" :
      eventType === "approval_rejected" ? "rejected" : "pending";
    if (outcome === "granted") approvalsGranted++;
    if (outcome === "rejected") approvalsRejected++;
    approvalLog.push({
      requestedAt: String(row["created_at"] ?? ""),
      action: String(safeData["action"] ?? "unknown"),
      outcome,
      note: safeData["note"] ? String(safeData["note"]) : null,
    });
  }

  const approvalsRequested = approvalRows.filter((r) =>
    String(r["event_type"]).includes("requested")).length;

  // Blockers
  const blockersFound = tasksBlocked
    .filter((t) => t.blockedReason)
    .map((t) => t.blockedReason as string);

  // Outputs — infer from message content (heuristic, no secrets)
  const outputsGenerated: ProofReportOutput[] = [];
  for (const msg of msgRows) {
    const content = String(msg["content"] ?? "");
    if (/health score/i.test(content)) {
      outputsGenerated.push({ label: "Health Score", type: "analysis", description: "Doctor health score produced" });
      break;
    }
  }
  if (tasksCompleted.length > 0) {
    outputsGenerated.push({
      label: "Session Completion Record",
      type: "report",
      description: `${tasksCompleted.length} tasks completed successfully`,
    });
  }

  // Cost
  const totalCredits = Number(creditRows[0]?.["total"] ?? 0);

  // Status & recommendation
  const sessionStatus = String(session["status"] ?? "unknown");
  const finalStatus = sessionStatus === "completed"
    ? "Session completed successfully"
    : sessionStatus === "stopped"
    ? "Session stopped by user"
    : sessionStatus === "paused"
    ? "Session paused — awaiting approval or user action"
    : `Session ${sessionStatus}`;

  const recommendedNextAction = tasksBlocked.length > 0
    ? `Resolve ${tasksBlocked.length} blocked task(s): ${blockersFound.slice(0, 2).join("; ")}.`
    : tasksPending.length > 0
    ? "Resume the session to complete remaining tasks."
    : "Session is complete. Review outputs and consider running Project Doctor for a full audit trail.";

  return {
    sessionId,
    generatedAt: new Date().toISOString(),
    userGoal: String(session["goal"] ?? ""),
    startedAt: session["created_at"] ? String(session["created_at"]) : null,
    completedAt: session["updated_at"] ? String(session["updated_at"]) : null,
    sessionStatus,
    sessionMode: String(session["mode"] ?? "unknown"),
    agents: agentRows.map((r) => ({
      name: String(r["name"] ?? ""),
      provider: String(r["provider"] ?? ""),
      model: String(r["model"] ?? ""),
      role: String(r["role"] ?? ""),
    })),
    tasksCompleted,
    tasksPending,
    tasksBlocked,
    approvalsRequested,
    approvalsGranted,
    approvalsRejected,
    approvalLog,
    blockersFound,
    outputsGenerated,
    estimatedCostCredits: totalCredits || null,
    finalStatus,
    recommendedNextAction,
    rawValuesReturned: false,
    securityNote: "This report contains no API keys, tokens, passwords, or credentials. All sensitive values are redacted.",
  };
}

// ─── Spec-compliant build/deploy proof report ─────────────────────────────────

export type BuildCheckStatus = "passed" | "failed" | "warning" | "skipped";
export type BuildReportStatus = "passed" | "failed" | "warning" | "incomplete";

export interface BuildEvidence {
  label: string;
  source: string;
  value: string;
  timestamp?: string;
}

export interface BuildCheck {
  name: string;
  status: BuildCheckStatus;
  details: string;
}

export interface BuildProofReport {
  reportId: string;
  title: string;
  status: BuildReportStatus;
  summary: string;
  evidence: BuildEvidence[];
  checks: BuildCheck[];
  unresolvedRisks: string[];
  nextActions: string[];
  generatedAt: string;
}

export interface BuildProofReportInput {
  title?: string;
  deployLog?: string;
  commitSha?: string;
  deployUrl?: string;
  buildPassed?: boolean;
  startupPassed?: boolean;
  healthEndpointPassed?: boolean;
  publicRoutePassed?: boolean;
  browserRenderingVerified?: boolean;
  missingEnvVars?: string[];
  customChecks?: BuildCheck[];
  customEvidence?: BuildEvidence[];
}

/**
 * Generate a spec-compliant proof report for a build, deploy, or audit run.
 * Does NOT claim success without actual evidence fields being set.
 */
// ─── Spec-required export (T10) ──────────────────────────────────────────────

export interface CreateProofReportInput {
  title?: string;
  buildPassed?: boolean;
  serverStarted?: boolean;
  healthEndpointOk?: boolean;
  publicRouteOk?: boolean;
  browserVerified?: boolean;
  deployChecked?: boolean;
  fileChecks?: Array<{ name: string; passed: boolean; details: string }>;
  unresolvedRisks?: string[];
  nextActions?: string[];
}

export interface SpecProofReport {
  reportId: string;
  title: string;
  status: "passed" | "failed" | "warning" | "incomplete";
  summary: string;
  evidence: Array<{ label: string; source: string; value: string; timestamp?: string }>;
  checks: Array<{ name: string; status: "passed" | "failed" | "warning" | "skipped"; details: string }>;
  unresolvedRisks: string[];
  nextActions: string[];
  generatedAt: string;
}

/**
 * Spec entry point: generate an evidence-backed proof report.
 * Distinguishes file-content, build, runtime, browser, and deploy check types.
 * Never marks READY unless all required evidence is present.
 */
export function createProofReport(input: CreateProofReportInput): SpecProofReport {
  const now = new Date().toISOString();
  const reportId = `pr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const checks: SpecProofReport["checks"] = [
    { name: "build_check", status: input.buildPassed ? "passed" : input.buildPassed === false ? "failed" : "skipped", details: input.buildPassed ? "Build completed successfully" : "Build not verified or failed" },
    { name: "server_startup", status: input.serverStarted ? "passed" : input.serverStarted === false ? "failed" : "skipped", details: input.serverStarted ? "Server started and accepting connections" : "Server startup not verified" },
    { name: "health_endpoint", status: input.healthEndpointOk ? "passed" : input.healthEndpointOk === false ? "failed" : "skipped", details: input.healthEndpointOk ? "Health endpoint returned 200" : "Health endpoint not verified" },
    { name: "public_route", status: input.publicRouteOk ? "passed" : input.publicRouteOk === false ? "failed" : "skipped", details: input.publicRouteOk ? "Public route returned 200" : "Public route not verified" },
    { name: "browser_render", status: input.browserVerified ? "passed" : "skipped", details: input.browserVerified ? "Browser rendering confirmed" : "Browser/manual render not yet verified — status cannot be fully passed" },
    { name: "deploy_check", status: input.deployChecked ? "passed" : "skipped", details: input.deployChecked ? "Deployment check passed" : "Deployment not verified" },
    ...(input.fileChecks ?? []).map(fc => ({ name: `file_check:${fc.name}`, status: fc.passed ? ("passed" as const) : ("failed" as const), details: fc.details })),
  ];

  const evidence: SpecProofReport["evidence"] = checks
    .filter(c => c.status === "passed")
    .map(c => ({ label: c.name, source: "viba-self-audit", value: c.details, timestamp: now }));

  const hasCriticalFailure = checks.some(c => ["build_check", "server_startup", "health_endpoint", "public_route"].includes(c.name) && c.status === "failed");
  const hasSkippedRequired = checks.some(c => ["build_check", "server_startup"].includes(c.name) && c.status === "skipped");
  const browserMissing = !input.browserVerified;

  const status: SpecProofReport["status"] = hasCriticalFailure ? "failed" : hasSkippedRequired ? "incomplete" : browserMissing ? "warning" : "passed";

  const summary = status === "passed"
    ? "All required checks passed and browser rendering confirmed. Release evidence is complete."
    : status === "failed"
    ? "One or more critical checks failed. Do not release until resolved."
    : status === "incomplete"
    ? "Required checks were not run. Complete build and startup verification before releasing."
    : "Automated checks passed but browser rendering is not yet verified. Report status: warning.";

  return {
    reportId,
    title: input.title ?? "VIBA Proof Report",
    status,
    summary,
    evidence,
    checks,
    unresolvedRisks: input.unresolvedRisks ?? [],
    nextActions: input.nextActions ?? (status !== "passed" ? ["Complete missing verification steps before marking release ready"] : []),
    generatedAt: now,
  };
}

export function generateBuildProofReport(input: BuildProofReportInput): BuildProofReport {
  const reportId = `br-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  const checks: BuildCheck[] = [
    {
      name: "build_check",
      status: input.buildPassed === true ? "passed" : input.buildPassed === false ? "failed" : "skipped",
      details: input.buildPassed === true ? "Build completed without errors" : input.buildPassed === false ? "Build failed — see deploy log" : "Build result not provided",
    },
    {
      name: "startup_check",
      status: input.startupPassed === true ? "passed" : input.startupPassed === false ? "failed" : "skipped",
      details: input.startupPassed === true ? "Server started successfully" : input.startupPassed === false ? "Server failed to start" : "Startup result not provided",
    },
    {
      name: "health_endpoint_check",
      status: input.healthEndpointPassed === true ? "passed" : input.healthEndpointPassed === false ? "failed" : "skipped",
      details: input.healthEndpointPassed === true ? "/api/healthz returned OK" : input.healthEndpointPassed === false ? "/api/healthz did not return OK" : "Health endpoint not verified",
    },
    {
      name: "public_route_check",
      status: input.publicRoutePassed === true ? "passed" : input.publicRoutePassed === false ? "failed" : "skipped",
      details: input.publicRoutePassed === true ? "Public route responded correctly" : input.publicRoutePassed === false ? "Public route failed" : "Public route not verified",
    },
    {
      name: "browser_rendering_check",
      status: input.browserRenderingVerified === true ? "passed" : input.browserRenderingVerified === false ? "failed" : "warning",
      details: input.browserRenderingVerified === true ? "Browser rendering manually verified" : "Browser rendering not verified — manual check required",
    },
    ...(input.customChecks ?? []),
  ];

  const evidence: BuildEvidence[] = [
    ...(input.commitSha ? [{ label: "Commit SHA", source: "git", value: input.commitSha, timestamp: now }] : []),
    ...(input.deployUrl ? [{ label: "Deploy URL", source: "render", value: input.deployUrl, timestamp: now }] : []),
    ...(input.deployLog ? [{ label: "Deploy log excerpt", source: "render.logs", value: input.deployLog.slice(0, 500), timestamp: now }] : []),
    ...(input.customEvidence ?? []),
  ];

  const unresolvedRisks: string[] = [
    ...(input.missingEnvVars ?? []).map((v) => `Missing env var: ${v}`),
    ...(!input.browserRenderingVerified ? ["Browser rendering not verified — page may appear blank in production"] : []),
    ...(!input.healthEndpointPassed ? ["Health endpoint not confirmed — service may be unreachable"] : []),
  ];

  const criticalFailed = checks.filter((c) => ["build_check", "startup_check", "health_endpoint_check"].includes(c.name) && c.status === "failed");
  const anyFailed = checks.some((c) => c.status === "failed");
  const anyWarning = checks.some((c) => c.status === "warning") || unresolvedRisks.length > 0;
  const allVerified = input.buildPassed && input.startupPassed && input.healthEndpointPassed && input.publicRoutePassed;

  let status: BuildReportStatus;
  if (criticalFailed.length > 0 || (input.buildPassed === false)) {
    status = "failed";
  } else if (!allVerified || anyFailed) {
    status = "incomplete";
  } else if (anyWarning || !input.browserRenderingVerified) {
    status = "warning";
  } else {
    status = "passed";
  }

  const nextActions: string[] = [];
  if (status === "failed") nextActions.push("Fix failing checks before next deploy attempt");
  if (!input.browserRenderingVerified) nextActions.push("Manually verify browser rendering at deploy URL");
  if ((input.missingEnvVars ?? []).length > 0) nextActions.push("Add missing env vars in Render dashboard");
  if (status === "passed") nextActions.push("Mark release as ready — all automated checks passed and browser verified");

  const summary = status === "passed"
    ? "All checks passed and browser rendering confirmed. Release is ready."
    : status === "failed"
    ? `${criticalFailed.length} critical check(s) failed. Do not release until resolved.`
    : status === "incomplete"
    ? "Some checks were not run or are pending. Complete all checks before releasing."
    : `All automated checks passed but ${unresolvedRisks.length} risk(s) remain unresolved.`;

  return {
    reportId,
    title: input.title ?? "Build & Deploy Proof Report",
    status,
    summary,
    evidence,
    checks,
    unresolvedRisks,
    nextActions,
    generatedAt: now,
  };
}
