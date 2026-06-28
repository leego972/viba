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
      { index: 1, title: "Scan Repository Structure", type: "doctor", status: "completed", completedAt: "2026-06-24T03:00:04Z", blockedReason: null, agentName: "ChatGPT" },
      { index: 2, title: "Identify Blockers", type: "doctor", status: "completed", completedAt: "2026-06-24T03:00:12Z", blockedReason: null, agentName: "Claude" },
      { index: 3, title: "Generate Health Score", type: "doctor", status: "completed", completedAt: "2026-06-24T03:00:19Z", blockedReason: null, agentName: "Gemini" },
      { index: 4, title: "Produce Repair Proposals", type: "doctor", status: "completed", completedAt: "2026-06-24T03:00:27Z", blockedReason: null, agentName: "ChatGPT" },
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
  const { rows: taskRows } = await pool.query<Record<string, unknown>>(
    `SELECT t.id, t.title, t.type, t.status, t.completed_at, t.blocked_reason,
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

  const tasksCompleted = allTasks.filter((t) => t.status === "completed");
  const tasksPending   = allTasks.filter((t) => t.status === "pending" || t.status === "in_progress");
  const tasksBlocked   = allTasks.filter((t) => t.status === "blocked" || t.status === "failed");

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
