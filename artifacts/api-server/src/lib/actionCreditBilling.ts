import type { Agent, Task } from "@workspace/db";
import { db, auditLogsTable, messagesTable, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { deductCredits, getCredits, isStripeConfigured, triggerAutoTopupIfNeeded } from "./billing";

// ─── Credit model ─────────────────────────────────────────────────────────────
//
// VIBA charges for three distinct layers:
//
// 1. TASK EXECUTION  — base credits per task type + text complexity
//    Charged for every work task (research, build, audit, etc.). Free for pure
//    chat (questions, explanations, small talk).
//
// 2. PLATFORM ORCHESTRATION FEE  — added on top of task credits
//    • Native tool providers (Replit, Manus, Railway, Groq, Ollama): +20 credits
//      These agents use their OWN tools (git, code execution, Railway MCP).
//      The user pays for those tools directly via their Replit/Railway/Manus
//      subscriptions. VIBA charges only for session management, task routing,
//      context sharing, and orchestration — NOT for tool execution.
//    • Text agents with VIBA broker tools enabled (OpenAI/Anthropic/Gemini/
//      Perplexity with canUseTools=true): +5 credits flat; per-call broker
//      charges cover the actual tool cost.
//    • Text agents without tools: +0 extra.
//    • Mock / simulation agents: +0.
//
// 3. VIBA BROKER TOOL CALLS  — charged per actual tool invocation
//    Applies when a text agent (or any agent) calls a VIBA broker tool.
//    Native tool providers are NOT charged for their own tools; only for
//    VIBA broker tools they explicitly invoke in a session.
//    Costs by risk level:
//      read_only → 5 cr   low → 10 cr   medium → 20 cr   high → 35 cr
//
// 4. AI COLLABORATION  — per inter-agent communication event
//    VIBA routes, stores, and tracks questions and answers between agents.
//    This is a platform feature (not a free conversation) and costs credits.
//      Outbound question sent: 8 credits
//      Answer given:           5 credits
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Providers whose agents use their OWN tool execution stack.
 * Only the platform orchestration fee applies — NOT per-VIBA-tool charges.
 */
const NATIVE_TOOL_PROVIDERS = new Set(["replit", "manus", "railway", "groq", "ollama"]);

/**
 * Free task types — no VIBA credits charged.
 * These are pure conversational exchanges with no work output.
 * Everything that produces an output costs credits regardless of provider.
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
  research: 45,
  creative_writing: 60,
  image_generation: 80,
  planning: 30,
};

/** Credits charged per VIBA broker tool call, keyed by tool risk level. */
const BROKER_TOOL_CREDITS: Record<string, number> = {
  read_only: 5,
  low: 10,
  medium: 20,
  high: 35,
};

/** Credits charged for AI collaboration events (inter-agent comms). */
export const COLLAB_QUESTION_CREDITS = 8;
export const COLLAB_ANSWER_CREDITS = 5;

function textComplexityCredits(task: Task): number {
  const text = `${task.title ?? ""} ${task.description ?? ""}`.trim();
  if (text.length > 2500) return 60;
  if (text.length > 1200) return 35;
  if (text.length > 500) return 15;
  return 0;
}

/**
 * Platform orchestration fee — NOT a charge for the agent's own tool use.
 * Native tool providers are charged for VIBA managing the session/task routing;
 * their tool execution costs are borne by the user's existing subscriptions.
 */
function platformOrchestrationFee(agent: Agent): number {
  if (agent.isMock) return 0;
  if (!agent.canUseTools) return 0;
  if (NATIVE_TOOL_PROVIDERS.has(agent.provider.toLowerCase())) {
    return 20; // orchestration only — user already pays for Replit/Manus/Railway tools
  }
  return 5; // text agent with broker tools: small base; per-call charges cover the rest
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
  const total = Math.ceil(
    (base + textComplexityCredits(input.task) + platformOrchestrationFee(input.agent) + questions) *
    statusMultiplier(input.task),
  );
  return Math.max(10, Math.min(300, total));
}

// ─── Session pause helpers ────────────────────────────────────────────────────

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
    description: "Task execution paused — user did not have enough credits for the action complexity",
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
    description: "Task execution paused — session budget cap would be exceeded",
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
  label?: string;
}): Promise<void> {
  if (input.credits <= 0) return;
  const capText = input.budgetCapCredits ? ` Session reserved total: ${input.creditsReservedAfter}/${input.budgetCapCredits}.` : "";
  const label = input.label ?? `"${input.task.title}" using ${input.agent.name}`;
  const content = `Credit receipt: ${input.credits} credits reserved for ${label}.${capText}`;
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

// ─── Task execution credits (main gate) ──────────────────────────────────────

export async function reserveCreditsForAction(input: {
  userId: number;
  sessionId: number;
  task: Task;
  agent: Agent;
  pendingQuestionCount?: number;
}): Promise<{ ok: true; credits: number } | { ok: false; credits: number }> {
  if (!isStripeConfigured()) return { ok: true, credits: 0 };

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
    description: `Reserved ${credits} credits for task execution (platform orchestration)`,
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

// ─── VIBA broker tool call credits ───────────────────────────────────────────

/**
 * Charge credits when ANY agent (text or native) invokes a VIBA broker tool.
 * Native tool providers are NOT charged for their own tools — only for VIBA
 * broker tools they explicitly request in a session that they don't own.
 *
 * Does not pause the session on failure — returns ok: false so the caller can
 * decide to skip the tool call rather than blocking the whole session.
 */
export async function chargeVibaToolCall(input: {
  userId: number;
  sessionId: number;
  taskId: number;
  toolId: string;
  riskLevel: string;
  agentName: string;
  agentId?: number;
}): Promise<{ ok: boolean; credits: number }> {
  if (!isStripeConfigured()) return { ok: true, credits: 0 };
  if (input.userId <= 0) return { ok: true, credits: 0 };

  const credits = BROKER_TOOL_CREDITS[input.riskLevel] ?? 10;
  const deducted = await deductCredits(input.userId, credits, input.sessionId);
  if (!deducted) {
    await db.insert(auditLogsTable).values({
      sessionId: input.sessionId,
      eventType: "broker_tool_credit_insufficient",
      description: `Insufficient credits for VIBA broker tool: ${input.toolId} (requires ${credits} credits)`,
      metadata: { userId: input.userId, taskId: input.taskId, toolId: input.toolId, credits },
    });
    return { ok: false, credits };
  }

  await db.insert(auditLogsTable).values({
    sessionId: input.sessionId,
    eventType: "broker_tool_credits_charged",
    description: `Charged ${credits} credits for VIBA broker tool: ${input.toolId} (risk: ${input.riskLevel})`,
    metadata: { userId: input.userId, taskId: input.taskId, agentId: input.agentId, agentName: input.agentName, toolId: input.toolId, riskLevel: input.riskLevel, credits },
  });

  // Receipt message in the session feed
  await db.insert(messagesTable).values({
    sessionId: input.sessionId,
    agentId: null,
    role: "assistant",
    provider: "system",
    agentName: "VIBA System",
    agentRole: "Billing",
    content: `Credit receipt: ${credits} credits charged for VIBA tool "${input.toolId}" invoked by ${input.agentName}.`,
    messageType: "context",
    taskId: input.taskId,
    metadata: {
      type: "broker_tool_credit_receipt",
      userId: input.userId,
      taskId: input.taskId,
      agentId: input.agentId,
      agentName: input.agentName,
      toolId: input.toolId,
      riskLevel: input.riskLevel,
      credits,
    },
  });

  return { ok: true, credits };
}

// ─── AI collaboration credits ─────────────────────────────────────────────────

/**
 * Charge credits for inter-agent collaboration (questions sent / answers given).
 * VIBA routes, stores, and tracks these — it is a platform feature, not free chat.
 * Uses fire-and-forget deduction: does NOT pause the session if insufficient,
 * since blocking on a small collaboration charge would be poor UX.
 */
export async function chargeCollaboration(input: {
  userId: number;
  sessionId: number;
  taskId: number;
  agentId: number;
  agentName: string;
  type: "question" | "answer";
  count: number;
}): Promise<void> {
  if (!isStripeConfigured()) return;
  if (input.userId <= 0 || input.count <= 0) return;

  const perUnit = input.type === "question" ? COLLAB_QUESTION_CREDITS : COLLAB_ANSWER_CREDITS;
  const credits = perUnit * input.count;

  const deducted = await deductCredits(input.userId, credits, input.sessionId);
  if (!deducted) {
    // Log but do not block — collaboration charges are small increments
    await db.insert(auditLogsTable).values({
      sessionId: input.sessionId,
      eventType: "collab_credit_skipped",
      description: `Skipped ${credits} collaboration credits (insufficient balance) — ${input.count} ${input.type}(s) by ${input.agentName}`,
      metadata: { userId: input.userId, taskId: input.taskId, agentId: input.agentId, type: input.type, count: input.count, credits },
    });
    return;
  }

  const label = input.type === "question"
    ? `${input.count} inter-agent question${input.count > 1 ? "s" : ""} sent by ${input.agentName}`
    : `${input.count} inter-agent answer${input.count > 1 ? "s" : ""} given by ${input.agentName}`;

  await db.insert(auditLogsTable).values({
    sessionId: input.sessionId,
    eventType: "collab_credits_charged",
    description: `Charged ${credits} credits for AI collaboration: ${label}`,
    metadata: { userId: input.userId, taskId: input.taskId, agentId: input.agentId, agentName: input.agentName, type: input.type, count: input.count, credits },
  });

  await db.insert(messagesTable).values({
    sessionId: input.sessionId,
    agentId: null,
    role: "assistant",
    provider: "system",
    agentName: "VIBA System",
    agentRole: "Billing",
    content: `Credit receipt: ${credits} credits charged for AI collaboration (${label}).`,
    messageType: "context",
    taskId: input.taskId,
    metadata: {
      type: "collab_credit_receipt",
      userId: input.userId,
      taskId: input.taskId,
      agentId: input.agentId,
      agentName: input.agentName,
      collabType: input.type,
      count: input.count,
      credits,
    },
  });
}
