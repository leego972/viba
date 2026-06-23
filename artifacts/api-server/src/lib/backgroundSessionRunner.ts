import { db, sessionsTable, messagesTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runNextAgentStep } from "./agentLoop";
import { getBillingStatus, isStripeConfigured } from "./billing";
import { logger } from "./logger";

const MAX_BACKGROUND_TURNS = Number(process.env["VIBA_BACKGROUND_MAX_TURNS"] ?? "100");

type BackgroundRun = {
  sessionId: number;
  userId: number;
  startedAt: number;
  stepsRun: number;
};

const activeRuns = new Map<number, BackgroundRun>();

async function logAudit(sessionId: number, eventType: string, description: string, metadata?: Record<string, unknown>) {
  await db.insert(auditLogsTable).values({ sessionId, eventType, description, metadata: metadata ?? {} });
}

async function addSystemMessage(sessionId: number, content: string, metadata?: Record<string, unknown>) {
  await db.insert(messagesTable).values({
    sessionId,
    agentId: null,
    role: "assistant",
    provider: "system",
    agentName: "VIBA System",
    agentRole: "Runtime",
    content,
    messageType: "context",
    metadata: metadata ?? {},
  });
}

async function pauseForCredits(sessionId: number, userId: number) {
  await db.update(sessionsTable).set({ status: "paused" }).where(eq(sessionsTable.id, sessionId));
  await addSystemMessage(
    sessionId,
    "Session paused because credits are finished. Add credits in Billing, then reopen the session to continue.",
    { reason: "credits_exhausted", userId },
  );
  await logAudit(sessionId, "credits_exhausted", "Background workflow paused because credits are finished", { userId });
}

async function canRunNextAction(input: BackgroundRun): Promise<boolean> {
  if (!isStripeConfigured()) return true;
  const status = await getBillingStatus(input.userId);
  if (status.subscriptionStatus === "canceled" || status.subscriptionStatus === "none" || status.creditsRemaining <= 0) {
    await pauseForCredits(input.sessionId, input.userId);
    return false;
  }
  return true;
}

export function isBackgroundRunActive(sessionId: number): boolean {
  return activeRuns.has(sessionId);
}

export function getBackgroundRun(sessionId: number) {
  const run = activeRuns.get(sessionId);
  if (!run) return null;
  return {
    sessionId: run.sessionId,
    userId: run.userId,
    startedAt: new Date(run.startedAt).toISOString(),
    stepsRun: run.stepsRun,
  };
}

export function startBackgroundFullRun(input: {
  sessionId: number;
  userId: number;
  firstCreditAlreadyReserved?: boolean;
}): { started: boolean; alreadyRunning: boolean } {
  if (activeRuns.has(input.sessionId)) {
    return { started: false, alreadyRunning: true };
  }

  const run: BackgroundRun = {
    sessionId: input.sessionId,
    userId: input.userId,
    startedAt: Date.now(),
    stepsRun: 0,
  };
  activeRuns.set(input.sessionId, run);

  setTimeout(() => {
    void runLoop(run).catch((err) => {
      logger.error({ err, sessionId: run.sessionId }, "Background workflow crashed");
    });
  }, 0);

  return { started: true, alreadyRunning: false };
}

async function runLoop(run: BackgroundRun): Promise<void> {
  try {
    await logAudit(run.sessionId, "background_run_started", "Full workflow started in background; it will continue after the user exits the session", { userId: run.userId });
    await addSystemMessage(run.sessionId, "Background run started. You can exit this session; VIBA will continue until the task completes, pauses for approval, is manually stopped, or credits are finished.", { reason: "background_run_started" });

    for (let i = 0; i < MAX_BACKGROUND_TURNS; i++) {
      const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, run.sessionId));
      if (!session || session.status !== "active") break;

      const canRun = await canRunNextAction(run);
      if (!canRun) break;

      const result = await runNextAgentStep(run.sessionId);
      run.stepsRun += 1;

      if (result.approvalRequired) {
        await logAudit(run.sessionId, "background_run_paused_for_approval", "Background workflow paused because approval is required", { stepsRun: run.stepsRun });
        break;
      }

      if (result.newMessages.length === 0 && result.updatedTasks.length === 0) break;

      const [updated] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, run.sessionId));
      if (!updated || updated.status !== "active") break;
    }

    const [finalSession] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, run.sessionId));
    await logAudit(run.sessionId, "background_run_finished", "Background workflow runner stopped", {
      status: finalSession?.status ?? "missing",
      stepsRun: run.stepsRun,
    });
  } finally {
    const current = activeRuns.get(run.sessionId);
    if (current === run) activeRuns.delete(run.sessionId);
  }
}
