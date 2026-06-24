import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { approvalsTable, auditLogsTable, db, messagesTable, sessionsTable, tasksTable } from "@workspace/db";

const router: IRouter = Router();

type ReqWithSession = { session?: { userId?: number; bypass?: boolean } };

type EvidenceStatus = "green" | "yellow" | "red";

type ProofReportSection = {
  status: EvidenceStatus;
  title: string;
  detail: string;
};

type ReceiptMetadata = {
  type?: string;
  credits?: number;
  creditsReservedAfter?: number;
  budgetCapCredits?: number | null;
  agentName?: string;
  provider?: string | null;
  taskId?: number;
};

function sessionIdFromParams(value: string | undefined): number | null {
  const id = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function canAccessSession(req: ReqWithSession, session: typeof sessionsTable.$inferSelect): boolean {
  if (req.session?.bypass) return true;
  const userId = req.session?.userId;
  return typeof userId === "number" && session.userId === userId;
}

function metadataOf(value: unknown): ReceiptMetadata {
  if (!value || typeof value !== "object") return {};
  return value as ReceiptMetadata;
}

function evidence(status: EvidenceStatus, title: string, detail: string): ProofReportSection {
  return { status, title, detail };
}

function taskStatusSummary(tasks: Array<typeof tasksTable.$inferSelect>): Record<string, number> {
  return tasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.status] = (acc[task.status] ?? 0) + 1;
    return acc;
  }, {});
}

router.get("/sessions/:id/proof-report", async (req, res): Promise<void> => {
  const sessionId = sessionIdFromParams(req.params.id);
  if (!sessionId) { res.status(400).json({ error: "invalid_session_id" }); return; }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session) { res.status(404).json({ error: "session_not_found" }); return; }
  if (!canAccessSession(req, session)) { res.status(403).json({ error: "forbidden" }); return; }

  const [tasks, approvals, messages, auditLogs] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.sessionId, sessionId)).orderBy(tasksTable.createdAt),
    db.select().from(approvalsTable).where(eq(approvalsTable.sessionId, sessionId)).orderBy(approvalsTable.createdAt),
    db.select().from(messagesTable).where(eq(messagesTable.sessionId, sessionId)).orderBy(messagesTable.createdAt),
    db.select().from(auditLogsTable).where(eq(auditLogsTable.sessionId, sessionId)).orderBy(desc(auditLogsTable.createdAt)),
  ]);

  const receipts = messages
    .map((message) => ({ message, metadata: metadataOf(message.metadata) }))
    .filter((item) => item.metadata.type === "action_credit_receipt");

  const completedTasks = tasks.filter((task) => task.status === "complete").length;
  const blockedTasks = tasks.filter((task) => task.status.includes("blocked")).length;
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending").length;
  const rejectedApprovals = approvals.filter((approval) => approval.status === "rejected").length;
  const totalCreditsReserved = receipts.reduce((sum, item) => sum + (typeof item.metadata.credits === "number" ? item.metadata.credits : 0), 0);
  const taskSummary = taskStatusSummary(tasks);

  const evidenceSections: ProofReportSection[] = [];
  evidenceSections.push(
    tasks.length > 0
      ? evidence("green", "Tasks recorded", `${tasks.length} task records found for this session.`)
      : evidence("yellow", "No task records", "No task records were found. This may be a chat-only session or an early session."),
  );
  evidenceSections.push(
    receipts.length > 0
      ? evidence("green", "Credit receipts recorded", `${receipts.length} credit receipt messages found; ${totalCreditsReserved} credits reserved in total.`)
      : evidence("yellow", "No credit receipts", "No billable action receipts were found. Normal chat may still be free."),
  );
  evidenceSections.push(
    pendingApprovals === 0
      ? evidence("green", "No pending approvals", "No pending approval gates remain in this session.")
      : evidence("yellow", "Pending approvals", `${pendingApprovals} approval item(s) are still pending.`),
  );
  evidenceSections.push(
    rejectedApprovals === 0
      ? evidence("green", "No rejected approvals", "No rejected approval gates were found.")
      : evidence("red", "Rejected approvals", `${rejectedApprovals} approval item(s) were rejected and may require review.`),
  );
  evidenceSections.push(
    blockedTasks === 0
      ? evidence("green", "No blocked tasks", "No blocked tasks were found in this session.")
      : evidence("yellow", "Blocked tasks present", `${blockedTasks} task(s) are blocked or need tool handoff.`),
  );

  const risks: string[] = [];
  if (tasks.length === 0) risks.push("No task records found; proof is limited to messages and audit events.");
  if (pendingApprovals > 0) risks.push("Pending approvals remain before the session can be considered complete.");
  if (blockedTasks > 0) risks.push("Blocked tasks remain and may need additional work or tool handoff.");
  if (session.status !== "completed") risks.push(`Session status is ${session.status}; final completion is not yet verified.`);
  if (receipts.length === 0) risks.push("No billable action receipts were found for this session.");

  res.json({
    reportType: "deterministic_session_proof_report",
    generatedAt: new Date().toISOString(),
    session: {
      id: session.id,
      goal: session.goal,
      status: session.status,
      mode: session.mode,
      autonomyMode: session.autonomyMode,
      budgetCapCredits: session.budgetCapCredits ?? null,
      creditsReserved: session.creditsReserved ?? 0,
      finalOutputPresent: Boolean(session.finalOutput),
      repoUrl: session.repoUrl ?? null,
      repoBranch: session.repoBranch ?? null,
      workspaceEnv: session.workspaceEnv ?? null,
    },
    summary: {
      totalTasks: tasks.length,
      completedTasks,
      blockedTasks,
      taskStatusSummary: taskSummary,
      approvals: {
        total: approvals.length,
        pending: pendingApprovals,
        rejected: rejectedApprovals,
      },
      messages: messages.length,
      auditEvents: auditLogs.length,
      creditReceipts: receipts.length,
      totalCreditsReserved,
    },
    evidence: evidenceSections,
    receipts: receipts.map((item) => ({
      messageId: item.message.id,
      taskId: item.metadata.taskId ?? item.message.taskId,
      credits: item.metadata.credits ?? 0,
      agentName: item.metadata.agentName ?? item.message.agentName,
      provider: item.metadata.provider ?? item.message.provider,
      createdAt: item.message.createdAt,
    })),
    recentAuditEvents: auditLogs.slice(0, 12).map((event) => ({
      id: event.id,
      type: event.eventType,
      description: event.description,
      createdAt: event.createdAt,
    })),
    risks,
    nextAction: risks.length === 0
      ? "Session has a clean deterministic proof report. Review final output and decide whether to close or export."
      : "Review risks, resolve blockers or approvals, then regenerate the proof report.",
    guarantee: "This report is generated from stored VIBA database records only. It does not call paid AI providers or external model APIs.",
  });
});

export default router;
