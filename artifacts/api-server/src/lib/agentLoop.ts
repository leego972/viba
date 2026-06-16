import { db, sessionsTable, agentsTable, tasksTable, messagesTable, memoryTable, approvalsTable, auditLogsTable } from "@workspace/db";
import type { Session, Agent, Task, Message } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { buildAdapter, buildMockAdapter } from "./agentFactory";
import { routeTask } from "./taskRouter";
import { logger } from "./logger";
import type { AgentTaskResult } from "./adapters/interface";
import { runAdapterWithRetry } from "./adapterRetry";
import { handleToolHandoff } from "./toolHandoff";
import { processPendingQuestions, persistOutboundQuestions, persistAnswers } from "./agentComms";

const APPROVAL_TASK_TYPES = new Set(["final_qa"]);
const MAX_TURNS = 12;
const RETRY_DELAY_MS = 1_500;

async function logAudit(sessionId: number, eventType: string, description: string, metadata?: Record<string, unknown>) {
  await db.insert(auditLogsTable).values({
    sessionId,
    eventType,
    description,
    metadata: metadata ?? {},
  });
}

async function updateMemory(sessionId: number, newMessages: Message[], agentName: string, taskTitle: string) {
  const [mem] = await db.select().from(memoryTable).where(eq(memoryTable.sessionId, sessionId));

  const newEntry = `• [${agentName}] completed "${taskTitle}"`;
  const existingLines = (mem?.summary ?? "")
    .split("\n")
    .filter((l) => l.trim().startsWith("•"))
    .slice(0, 9);
  const summary = [newEntry, ...existingLines].join("\n");

  const existingDecisions = mem?.decisions ?? [];
  const lastContent = newMessages[0]?.content?.substring(0, 120) ?? "";
  const newDecisions = existingDecisions.length < 12
    ? [...existingDecisions, `${agentName}: ${lastContent}...`]
    : existingDecisions;

  if (mem) {
    await db.update(memoryTable).set({ summary, decisions: newDecisions }).where(eq(memoryTable.id, mem.id));
  } else {
    await db.insert(memoryTable).values({ sessionId, summary, decisions: newDecisions });
  }
}

export async function runNextAgentStep(sessionId: number): Promise<{
  newMessages: Message[];
  updatedTasks: Task[];
  approvalRequired: boolean;
  approval: typeof approvalsTable.$inferSelect | null;
}> {
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session || session.status !== "active") {
    return { newMessages: [], updatedTasks: [], approvalRequired: false, approval: null };
  }

  const agents = await db.select().from(agentsTable).where(eq(agentsTable.sessionId, sessionId));
  if (!agents.length) {
    return { newMessages: [], updatedTasks: [], approvalRequired: false, approval: null };
  }

  // Find the next "planned" task — skip blocked_needs_tools tasks that already have siblings
  const allTasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.sessionId, sessionId))
    .orderBy(asc(tasksTable.id));

  const nextTask = allTasks.find((t) => t.status === "planned");

  if (!nextTask) {
    const hasActiveTasks = allTasks.some((t) => t.status === "in_progress");
    if (!hasActiveTasks) {
      // Only complete if there are no blocked tasks without a tool-capable agent available
      const hasBlocked = allTasks.some((t) => t.status === "blocked_needs_tools");
      if (!hasBlocked) {
        await db.update(sessionsTable).set({ status: "completed" }).where(eq(sessionsTable.id, sessionId));
        await logAudit(sessionId, "session_completed", "All tasks completed, session marked complete");
      }
    }
    return { newMessages: [], updatedTasks: [], approvalRequired: false, approval: null };
  }

  // Check if approval required before this task (Supervised mode only)
  if (APPROVAL_TASK_TYPES.has(nextTask.type) && session.autonomyMode === "Supervised") {
    const [existingApproval] = await db
      .select()
      .from(approvalsTable)
      .where(and(eq(approvalsTable.sessionId, sessionId), eq(approvalsTable.status, "pending")));

    if (!existingApproval) {
      const [approval] = await db
        .insert(approvalsTable)
        .values({
          sessionId,
          type: nextTask.type,
          description: `Approve final QA sign-off before completing the project: ${nextTask.title}`,
          status: "pending",
        })
        .returning();
      await logAudit(sessionId, "approval_requested", `Approval requested for task: ${nextTask.title}`, {
        taskId: nextTask.id,
        taskType: nextTask.type,
      });
      return { newMessages: [], updatedTasks: [], approvalRequired: true, approval: approval ?? null };
    } else if (existingApproval.status === "pending") {
      return { newMessages: [], updatedTasks: [], approvalRequired: true, approval: existingApproval };
    }
  }

  // Route to the best-fit agent (tool-aware)
  const assignedAgent = routeTask(nextTask, agents);
  if (!assignedAgent) {
    return { newMessages: [], updatedTasks: [], approvalRequired: false, approval: null };
  }

  // Mark task in_progress
  await db.update(tasksTable).set({ status: "in_progress", assignedAgentId: assignedAgent.id }).where(eq(tasksTable.id, nextTask.id));
  await logAudit(sessionId, "task_assigned", `Task "${nextTask.title}" assigned to ${assignedAgent.name}`, {
    taskId: nextTask.id,
    agentId: assignedAgent.id,
    canUseTools: assignedAgent.canUseTools,
  });

  // Get conversation context
  const previousMessages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, sessionId))
    .orderBy(asc(messagesTable.id));
  const recentMessages = previousMessages.slice(-12);

  const [memory] = await db.select().from(memoryTable).where(eq(memoryTable.sessionId, sessionId));

  // Fetch pending questions directed at this agent (task-scoped)
  const pendingQuestions = await processPendingQuestions(sessionId, assignedAgent.id);

  // Build adapter — mock adapters inherit canUseTools from their class
  const retryOutcome = await runAdapterWithRetry({
    buildLiveAdapter: () => buildAdapter(assignedAgent),
    buildFallbackAdapter: () => buildMockAdapter(assignedAgent),
    taskInput: {
      systemRole: assignedAgent.role,
      projectGoal: session.goal,
      memorySummary: memory?.summary ?? "",
      taskInstruction: nextTask.description || nextTask.title,
      previousMessages: recentMessages.map((m) => ({
        role: m.role,
        content: m.content,
        agentName: m.agentName ?? undefined,
      })),
      taskType: nextTask.type,
      canUseTools: assignedAgent.canUseTools,
      repoUrl: session.repoUrl ?? undefined,
      repoBranch: session.repoBranch ?? undefined,
      workspaceEnv: session.workspaceEnv ?? undefined,
      pendingQuestions,
    },
    retryDelayMs: RETRY_DELAY_MS,
    logAudit: (eventType, description, metadata) =>
      logAudit(sessionId, eventType, description, metadata),
    context: {
      sessionId,
      agentId: assignedAgent.id,
      provider: assignedAgent.provider,
      taskId: nextTask.id,
      taskTitle: nextTask.title,
    },
  });

  let result: AgentTaskResult = retryOutcome.result;
  const usedFallback = retryOutcome.usedFallback;
  const usedModel: string | null = retryOutcome.usedModel || null;

  if (usedFallback) {
    result = {
      ...result,
      messageText: `⚠️ [Simulated — live ${assignedAgent.provider} API unavailable] ${result.messageText}`,
    };
  }

  if (usedModel) {
    await db.update(agentsTable).set({ lastUsedModel: usedModel }).where(eq(agentsTable.id, assignedAgent.id));
  }

  // ── Tool handoff: text-only agent hit a tool blocker ──────────────────────
  if (result.blockedReason && !assignedAgent.canUseTools) {
    logger.info(
      { sessionId, taskId: nextTask.id, agentId: assignedAgent.id, blockedReason: result.blockedReason },
      "Agent blocked — initiating tool handoff",
    );

    const { handoffMessage, siblingTask } = await handleToolHandoff(
      sessionId,
      nextTask,
      result,
      assignedAgent,
    );

    await logAudit(sessionId, "tool_handoff", `${assignedAgent.name} blocked — tool handoff to capable agent`, {
      originalTaskId: nextTask.id,
      siblingTaskId: siblingTask.id,
      blockedReason: result.blockedReason,
    });

    // Update session cost
    const updatedCost = (session.estimatedCost ?? 0) + result.estimatedCost;
    await db.update(sessionsTable).set({ estimatedCost: updatedCost }).where(eq(sessionsTable.id, sessionId));

    return {
      newMessages: [handoffMessage],
      updatedTasks: [{ ...nextTask, status: "blocked_needs_tools" } as Task, siblingTask],
      approvalRequired: false,
      approval: null,
    };
  }

  // ── Normal completion path ─────────────────────────────────────────────────

  // Save the main output message
  const [newMsg] = await db
    .insert(messagesTable)
    .values({
      sessionId,
      agentId: assignedAgent.id,
      role: "assistant",
      provider: assignedAgent.provider,
      model: usedModel ?? undefined,
      content: result.messageText,
      taskId: nextTask.id,
      agentName: assignedAgent.name,
      agentRole: assignedAgent.role,
      messageType: "output",
    })
    .returning();

  if (!newMsg) {
    return { newMessages: [], updatedTasks: [], approvalRequired: false, approval: null };
  }

  await logAudit(sessionId, "agent_message_generated", `${assignedAgent.name} completed task: ${nextTask.title}`, {
    taskId: nextTask.id,
    agentId: assignedAgent.id,
  });

  // ── Inter-agent communications ─────────────────────────────────────────────
  // Persist answers to pending questions
  const answerMessages = await persistAnswers(
    sessionId,
    assignedAgent,
    result.answersToQuestions ?? [],
    nextTask.id,
  );

  // Persist outbound questions (cap enforced inside persistOutboundQuestions)
  const questionMessages = await persistOutboundQuestions(
    sessionId,
    assignedAgent,
    result.outboundQuestions ?? [],
    nextTask.id,
    agents,
  );

  if (questionMessages.length > 0) {
    await logAudit(sessionId, "agent_questions_sent", `${assignedAgent.name} sent ${questionMessages.length} question(s)`, {
      taskId: nextTask.id,
      questionCount: questionMessages.length,
    });
  }

  // ── Update task status ─────────────────────────────────────────────────────
  let newTaskStatus: string;
  if (result.completionStatus === "complete") {
    newTaskStatus = "complete";
  } else if (result.completionStatus === "needs_review") {
    newTaskStatus = "review";
  } else {
    newTaskStatus = "review";
  }

  const [updatedTask] = await db
    .update(tasksTable)
    .set({ status: newTaskStatus, costEstimate: result.estimatedCost })
    .where(eq(tasksTable.id, nextTask.id))
    .returning();

  const updatedCost = (session.estimatedCost ?? 0) + result.estimatedCost;
  await db.update(sessionsTable).set({ estimatedCost: updatedCost }).where(eq(sessionsTable.id, sessionId));

  await updateMemory(sessionId, [newMsg], assignedAgent.name, nextTask.title);
  await logAudit(sessionId, "memory_updated", "Shared memory updated");

  const allNewMessages: Message[] = [newMsg, ...answerMessages, ...questionMessages];

  return {
    newMessages: allNewMessages,
    updatedTasks: updatedTask ? [updatedTask] : [],
    approvalRequired: false,
    approval: null,
  };
}

export async function runFullWorkflow(sessionId: number): Promise<{
  newMessages: Message[];
  updatedTasks: Task[];
  approvalRequired: boolean;
  approval: typeof approvalsTable.$inferSelect | null;
  stepsRun: number;
}> {
  const allNewMessages: Message[] = [];
  const allUpdatedTasks: Task[] = [];
  let stepsRun = 0;
  let approvalRequired = false;
  let approval: typeof approvalsTable.$inferSelect | null = null;

  for (let i = 0; i < MAX_TURNS; i++) {
    const result = await runNextAgentStep(sessionId);
    allNewMessages.push(...result.newMessages);
    allUpdatedTasks.push(...result.updatedTasks);
    stepsRun++;

    if (result.approvalRequired) {
      approvalRequired = true;
      approval = result.approval;
      break;
    }

    if (result.newMessages.length === 0 && result.updatedTasks.length === 0) {
      break;
    }

    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    if (session?.status !== "active") break;
  }

  return { newMessages: allNewMessages, updatedTasks: allUpdatedTasks, approvalRequired, approval, stepsRun };
}
