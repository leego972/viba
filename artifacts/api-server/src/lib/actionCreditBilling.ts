import type { Agent, Task } from "@workspace/db";
import { db, auditLogsTable, messagesTable, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { deductCredits, getCredits, isStripeConfigured, triggerAutoTopupIfNeeded } from "./billing";

// ─── Credit model ─────────────────────────────────────────────────────────────
// VIBA credits are charged for TOOL-USE / WORK tasks only — the "work" layer
// that VIBA orchestrates (build, code, debug, deploy, audit, browser, etc.).
// Pure conversation tasks (planning, research) are free regardless of provider.
// Each provider's API cost (OpenAI, Claude, Gemini) is the user's own concern —
// VIBA only charges for the orchestration & tool-execution layer on top.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Free task types — no VIBA credits charged.
 * These are pure conversational exchanges with no work output:
 * questions, explanations, small talk, clarifications, comments.
 *
 * Everything that produces an output (research, planning a deliverable,
 * creative writing, image generation, code, builds, audits …) costs credits
 * regardless of which AI provider runs it.
 */
const CHAT_ONLY_TASK_TYPES = new Set([
  "chat",
  "question",
  "explanation",
  "clarification",
  "comment",
  "small_talk",
  "smalltalk",
]);

/** Credit cost per task type — all "work" tasks including AI-assisted creation. */
const TASK_BASE_CREDITS: Record<string, number> = {
  // ── Deep work ──────────────────────────────────────────────────────────────
  audit: 220,
  security_audit: 260,
  review: 120,
  debug: 90,
  repair: 90,
  fix: 90,
  build: 140,
  implementation: 140,
  coding: 120,
  tool_handoff: 80,
  final_qa: 70,
  // ── AI-assisted creation ───────────────────────────────────────────────────
  research: 45,
  creative_writing: 60,
  image_generation: 80,
  planning: 30,
};

function textComplexityCredits(task: Task): number {
  const text = `${task.title ?? ""} ${task.description ?? ""}`.trim();
  if (text.length > 2500) return 60;
  if (text.length > 1200) return 35;
  if (text.length > 500) return 15;
  return 0;
}

function providerComplexityCredits(agent: Agent): number {
  if (agent.canUseTools) return 25;
  if (agent.isMock) return 0;
  return 10;
}

function statusMultiplier(task: Task): number {
  if (task.status === "review") return 0.5;
  if (task.status === "blocked_needs_tools") return 0.75;
  return 1;
}

export function estimateActionCredits(input: {
  task: Task;
  agent: Agent;
  pendingQuestionCount?: number;
}): number {
  const type = String(input.task.type ?? "").toLowerCase();
  const base = TASK_BASE_CREDITS[type] ?? 60;
  const questions = Math.min(30, (input.pendingQuestionCount ?? 0) * 10);
  const total = Math.ceil((base + textComplexityCredits(input.task) + providerComplexityCredits(input.agent) + questions) * statusMultiplier(input.task));
  return Math.max(10, Math.min(300, total));
}

export async function pauseSessionForActionCredits(input: {
  sessionId: number;
  userId: number;
  taskId: number;
  requiredCredits: number;
}): Promise<void> {
  await db.update(sessionsTable).set({ status: "paused" }).where(eq(sessionsTable.id, input.sessionId));
  await db.insert(messagesTable).values({
    sessionId: input.sessionId,
    agentId: null,
    role: "assistant",
    provider: "system",
    agentName: "VIBA System",
    agentRole: "Billing",
    content: `Action paused because this task requires ${input.requiredCredits} credits. Add credits in Billing, then reopen the session to continue.`,
    messageType: "context",
    taskId: input.taskId,
    metadata: { reason: "insufficient_action_credits", requiredCredits: input.requiredCredits },
  });
  await db.insert(auditLogsTable).values({
    sessionId: input.sessionId,
    eventType: "insufficient_action_credits",
    description: "Task execution paused because the user did not have enough credits for the action complexity",
    metadata: { userId: input.userId, taskId: input.taskId, requiredCredits: input.requiredCredits },
  });
}

async function pauseSessionForBudgetCap(input: {
  sessionId: number;
  userId: number;
  taskId: number;
  requiredCredits: number;
  budgetCapCredits: number;
  creditsReserved: number;
}): Promise<void> {
  await db.update(sessionsTable).set({ status: "paused" }).where(eq(sessionsTable.id, input.sessionId));
  await db.insert(messagesTable).values({
    sessionId: input.sessionId,
    agentId: null,
    role: "assistant",
    provider: "system",
    agentName: "VIBA System",
    agentRole: "Budget Control",
    content: `Budget cap reached. This task needs ${input.requiredCredits} credits, but the session cap is ${input.budgetCapCredits} credits and ${input.creditsReserved} are already reserved. Increase the budget cap or stop the run.`,
    messageType: "context",
    taskId: input.taskId,
    metadata: {
      reason: "session_budget_cap_reached",
      requiredCredits: input.requiredCredits,
      budgetCapCredits: input.budgetCapCredits,
      creditsReserved: input.creditsReserved,
    },
  });
  await db.insert(auditLogsTable).values({
    sessionId: input.sessionId,
    eventType: "session_budget_cap_reached",
    description: "Task execution paused because the session budget cap would be exceeded",
    metadata: {
      userId: input.userId,
      taskId: input.taskId,
      requiredCredits: input.requiredCredits,
      budgetCapCredits: input.budgetCapCredits,
      creditsReserved: input.creditsReserved,
    },
  });
}

async function persistActionCreditReceipt(input: {
  userId: number;
  sessionId: number;
  task: Task;
  agent: Agent;
  credits: number;
  creditsReservedAfter: number;
  budgetCapCredits: number | null;
}): Promise<void> {
  if (input.credits <= 0) return;
  const capText = input.budgetCapCredits ? ` Session reserved total: ${input.creditsReservedAfter}/${input.budgetCapCredits}.` : "";
  const content = `Credit receipt: ${input.credits} credits reserved for "${input.task.title}" using ${input.agent.name}.${capText}`;
  await db.insert(messagesTable).values({
    sessionId: input.sessionId,
    agentId: null,
    role: "assistant",
    provider: "system",
    agentName: "VIBA System",
    agentRole: "Billing",
    content,
    messageType: "context",
    taskId: input.task.id,
    metadata: {
      type: "action_credit_receipt",
      userId: input.userId,
      taskId: input.task.id,
      agentId: input.agent.id,
      agentName: input.agent.name,
      provider: input.agent.provider,
      credits: input.credits,
      creditsReservedAfter: input.creditsReservedAfter,
      budgetCapCredits: input.budgetCapCredits,
    },
  });
}

export async function reserveCreditsForAction(input: {
  userId: number;
  sessionId: number;
  task: Task;
  agent: Agent;
  pendingQuestionCount?: number;
}): Promise<{ ok: true; credits: number } | { ok: false; credits: number }> {
  if (!isStripeConfigured()) return { ok: true, credits: 0 };

  // Pure back-and-forth chat is free — VIBA credits are for work only.
  // Everything else (research, creative writing, image generation, planning,
  // tool use, builds, audits …) costs credits regardless of which provider runs it.
  const taskType = String(input.task.type ?? "").toLowerCase();
  if (CHAT_ONLY_TASK_TYPES.has(taskType) && !input.agent.canUseTools) {
    return { ok: true, credits: 0 };
  }
  const credits = estimateActionCredits({ task: input.task, agent: input.agent, pendingQuestionCount: input.pendingQuestionCount });
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, input.sessionId));
  const currentReserved = session?.creditsReserved ?? 0;
  const budgetCap = session?.budgetCapCredits ?? null;
  if (budgetCap !== null && currentReserved + credits > budgetCap) {
    await pauseSessionForBudgetCap({
      sessionId: input.sessionId,
      userId: input.userId,
      taskId: input.task.id,
      requiredCredits: credits,
      budgetCapCredits: budgetCap,
      creditsReserved: currentReserved,
    });
    return { ok: false, credits };
  }

  const deducted = await deductCredits(input.userId, credits, input.sessionId);
  if (!deducted) {
    await pauseSessionForActionCredits({ sessionId: input.sessionId, userId: input.userId, taskId: input.task.id, requiredCredits: credits });
    return { ok: false, credits };
  }

  // After a successful deduction, fire auto top-up if balance dropped below threshold.
  // Fire-and-forget — errors are swallowed inside triggerAutoTopupIfNeeded.
  void (async () => {
    try {
      const balanceAfter = await getCredits(input.userId);
      await triggerAutoTopupIfNeeded(input.userId, balanceAfter);
    } catch { /* swallow — top-up failure must never break a session run */ }
  })();

  const creditsReservedAfter = currentReserved + credits;
  await db.update(sessionsTable).set({ creditsReserved: creditsReservedAfter }).where(eq(sessionsTable.id, input.sessionId));
  await db.insert(auditLogsTable).values({
    sessionId: input.sessionId,
    eventType: "action_credits_reserved",
    description: `Reserved ${credits} credits for task action complexity`,
    metadata: { userId: input.userId, taskId: input.task.id, agentId: input.agent.id, credits, creditsReservedAfter, budgetCapCredits: budgetCap },
  });
  await persistActionCreditReceipt({
    userId: input.userId,
    sessionId: input.sessionId,
    task: input.task,
    agent: input.agent,
    credits,
    creditsReservedAfter,
    budgetCapCredits: budgetCap,
  });
  return { ok: true, credits };
}
