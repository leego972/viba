import { db, sessionsTable, agentsTable, tasksTable, messagesTable, memoryTable, approvalsTable, auditLogsTable } from "@workspace/db";
import type { Agent, Task, Message } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { buildAdapter, buildMockAdapter } from "./agentFactory";
import { routeTask } from "./taskRouter";
import { logger } from "./logger";
import type { AgentTaskResult } from "./adapters/interface";
import { runAdapterWithRetry } from "./adapterRetry";
import { handleToolHandoff } from "./toolHandoff";
import { processPendingQuestions, persistOutboundQuestions, persistAnswers } from "./agentComms";
import { classifyFallbackReason, fallbackEligibleAgents, markProviderHealthy, returnTaskToPool } from "./fallbackPool";
import { reserveCreditsForAction } from "./actionCreditBilling";

const APPROVAL_TASK_TYPES = new Set(["final_qa"]);
const MAX_TURNS = 12;
const RETRY_DELAY_MS = 1_500;
const LIVE_STEP_TIMEOUT_MS = 120_000;
const SIM_STEP_TIMEOUT_MS  = 30_000;

async function logAudit(sessionId: number, eventType: string, description: string, metadata?: Record<string, unknown>) {
  await db.insert(auditLogsTable).values({ sessionId, eventType, description, metadata: metadata ?? {} });
}

async function updateMemory(sessionId: number, newMessages: Message[], agentName: string, taskTitle: string) {
  const [mem] = await db.select().from(memoryTable).where(eq(memoryTable.sessionId, sessionId));
  const newEntry = `• [${agentName}] completed "${taskTitle}"`;
  const existingLines = (mem?.summary ?? "").split("\n").filter((l) => l.trim().startsWith("•")).slice(0, 9);
  const summary = [newEntry, ...existingLines].join("\n");
  const existingDecisions = mem?.decisions ?? [];
  const lastContent = newMessages[0]?.content?.substring(0, 120) ?? "";
  const newDecisions = existingDecisions.length < 12 ? [...existingDecisions, `${agentName}: ${lastContent}...`] : existingDecisions;

  if (mem) await db.update(memoryTable).set({ summary, decisions: newDecisions }).where(eq(memoryTable.id, mem.id));
  else await db.insert(memoryTable).values({ sessionId, summary, decisions: newDecisions });
}

async function returnToPoolMessage(input: {
  sessionId: number;
  task: Task;
  agent: Agent;
  reason: string;
  partialWork?: string | null;
  error?: unknown;
}): Promise<{ messages: Message[]; tasks: Task[] }> {
  const pooled = await returnTaskToPool({
    sessionId: input.sessionId,
    task: input.task,
    agent: input.agent,
    reason: input.reason,
    partialWork: input.partialWork ?? null,
    error: input.error instanceof Error ? input.error.message : input.error ? String(input.error) : null,
  });

  const content = pooled.alternativeAvailable
    ? `${input.agent.name} could not continue (${input.reason}). VIBA saved partial work and returned the task to the provider pool so another capable AI can continue.`
    : `${input.agent.name} could not continue (${input.reason}). Fallback attempts are exhausted and the task needs review.`;

  const [message] = await db.insert(messagesTable).values({
    sessionId: input.sessionId,
    role: "assistant",
    agentId: input.agent.id,
    agentName: input.agent.name,
    provider: input.agent.provider,
    content,
    messageType: "context",
    taskId: input.task.id,
    metadata: { fallbackReason: input.reason, alternativeAvailable: pooled.alternativeAvailable },
  }).returning();

  await logAudit(input.sessionId, pooled.alternativeAvailable ? "task_returned_to_provider_pool" : "provider_pool_exhausted", content, {
    taskId: input.task.id,
    agentId: input.agent.id,
    provider: input.agent.provider,
    reason: input.reason,
  });

  return {
    messages: message ? [message] : [],
    tasks: pooled.taskReturned ? [pooled.taskReturned] : [],
  };
}

export async function runNextAgentStep(sessionId: number): Promise<{
  newMessages: Message[];
  updatedTasks: Task[];
  approvalRequired: boolean;
  approval: typeof approvalsTable.$inferSelect | null;
}> {
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session || session.status !== "active") return { newMessages: [], updatedTasks: [], approvalRequired: false, approval: null };

  const agents = await db.select().from(agentsTable).where(eq(agentsTable.sessionId, sessionId));
  if (!agents.length) return { newMessages: [], updatedTasks: [], approvalRequired: false, approval: null };

  const activeAgents = agents.filter((a) => !a.satOutReason);
  const allTasks = await db.select().from(tasksTable).where(eq(tasksTable.sessionId, sessionId)).orderBy(asc(tasksTable.id));
  const nextTask = allTasks.find((t) => t.status === "planned");

  if (!nextTask) {
    const hasActiveTasks = allTasks.some((t) => t.status === "in_progress");
    if (!hasActiveTasks) {
      const hasBlocked = allTasks.some((t) => t.status === "blocked_needs_tools");
      if (!hasBlocked) {
        await db.update(sessionsTable).set({ status: "completed" }).where(eq(sessionsTable.id, sessionId));
        await logAudit(sessionId, "session_completed", "All tasks completed, session marked complete");
      }
    }
    return { newMessages: [], updatedTasks: [], approvalRequired: false, approval: null };
  }

  if (APPROVAL_TASK_TYPES.has(nextTask.type) && session.autonomyMode.toLowerCase() === "supervised") {
    const [existingApproval] = await db.select().from(approvalsTable).where(and(eq(approvalsTable.sessionId, sessionId), eq(approvalsTable.status, "pending")));
    if (!existingApproval) {
      const [approval] = await db.insert(approvalsTable).values({
        sessionId,
        type: nextTask.type,
        description: `Approve final QA sign-off before completing the project: ${nextTask.title}`,
        status: "pending",
      }).returning();
      await logAudit(sessionId, "approval_requested", `Approval requested for task: ${nextTask.title}`, { taskId: nextTask.id, taskType: nextTask.type });
      return { newMessages: [], updatedTasks: [], approvalRequired: true, approval: approval ?? null };
    }
    if (existingApproval.status === "pending") return { newMessages: [], updatedTasks: [], approvalRequired: true, approval: existingApproval };
  }

  const eligibleAgents = await fallbackEligibleAgents({ sessionId, taskId: nextTask.id, agents: activeAgents });
  const assignedAgent = routeTask(nextTask, eligibleAgents);
  if (!assignedAgent) {
    const [blockedTask] = await db.update(tasksTable).set({ status: "review", assignedAgentId: null, blockedReason: "No available provider after fallback filtering" }).where(eq(tasksTable.id, nextTask.id)).returning();
    await logAudit(sessionId, "no_available_provider", `No available provider for task: ${nextTask.title}`, { taskId: nextTask.id });
    return { newMessages: [], updatedTasks: blockedTask ? [blockedTask] : [], approvalRequired: false, approval: null };
  }

  await db.update(tasksTable).set({ status: "in_progress", assignedAgentId: assignedAgent.id }).where(eq(tasksTable.id, nextTask.id));
  await logAudit(sessionId, "task_assigned", `Task "${nextTask.title}" assigned to ${assignedAgent.name}`, { taskId: nextTask.id, agentId: assignedAgent.id, canUseTools: assignedAgent.canUseTools, fallbackEligiblePoolSize: eligibleAgents.length });

  const previousMessages = await db.select().from(messagesTable).where(eq(messagesTable.sessionId, sessionId)).orderBy(asc(messagesTable.id));
  const recentMessages = previousMessages.slice(-12);
  const [memory] = await db.select().from(memoryTable).where(eq(memoryTable.sessionId, sessionId));
  const pendingQuestions = await processPendingQuestions(sessionId, assignedAgent.id, nextTask.id);

  const reservation = await reserveCreditsForAction({
    userId: session.userId ?? 0,
    sessionId,
    task: nextTask,
    agent: assignedAgent,
    pendingQuestionCount: pendingQuestions.length,
  });
  if (!reservation.ok) return { newMessages: [], updatedTasks: [], approvalRequired: false, approval: null };

  const onPollCycle = (info: { attempt: number; maxAttempts: number; status: string; elapsedMs: number }) => {
    void logAudit(sessionId, "agent_running", `${assignedAgent.name} is executing (poll ${info.attempt + 1}/${info.maxAttempts}, status: ${info.status}, elapsed: ${Math.round(info.elapsedMs / 1000)}s)`, { taskId: nextTask.id, agentId: assignedAgent.id, attempt: info.attempt, maxAttempts: info.maxAttempts, status: info.status, elapsedMs: info.elapsedMs, reservedCredits: reservation.credits });
  };

  const stepTimeoutMs = assignedAgent.isMock ? SIM_STEP_TIMEOUT_MS : LIVE_STEP_TIMEOUT_MS;
  let stepTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const stepTimeoutRace = new Promise<never>((_, reject) => {
    stepTimeoutHandle = setTimeout(() => reject(new Error("STEP_TIMEOUT")), stepTimeoutMs);
  });

  let retryOutcome: Awaited<ReturnType<typeof runAdapterWithRetry>>;
  try {
    retryOutcome = await Promise.race([
      runAdapterWithRetry({
        buildLiveAdapter: () => buildAdapter(assignedAgent),
        buildFallbackAdapter: () => buildMockAdapter(assignedAgent),
        taskInput: {
          systemRole: assignedAgent.role,
          projectGoal: session.goal,
          memorySummary: memory?.summary ?? "",
          taskInstruction: nextTask.description || nextTask.title,
          previousMessages: recentMessages.map((m) => ({ role: m.role, content: m.content, agentName: m.agentName ?? undefined })),
          peerAgents: activeAgents.filter((a) => a.id !== assignedAgent.id).map((a) => ({ name: a.name, role: a.role })),
          taskType: nextTask.type,
          canUseTools: assignedAgent.canUseTools,
          repoUrl: session.repoUrl ?? undefined,
          repoBranch: session.repoBranch ?? undefined,
          workspaceEnv: session.workspaceEnv ?? undefined,
          pendingQuestions,
          onPollCycle,
        },
        retryDelayMs: RETRY_DELAY_MS,
        logAudit: (eventType, description, metadata) => logAudit(sessionId, eventType, description, metadata),
        context: { sessionId, agentId: assignedAgent.id, provider: assignedAgent.provider, taskId: nextTask.id, taskTitle: nextTask.title },
      }),
      stepTimeoutRace,
    ]);
  } catch (err) {
    clearTimeout(stepTimeoutHandle);
    const pooled = await returnToPoolMessage({ sessionId, task: nextTask, agent: assignedAgent, reason: classifyFallbackReason(err), error: err });
    return { newMessages: pooled.messages, updatedTasks: pooled.tasks, approvalRequired: false, approval: null };
  } finally {
    clearTimeout(stepTimeoutHandle);
  }

  const result: AgentTaskResult = retryOutcome.result;
  const usedFallback = retryOutcome.usedFallback;
  const usedModel: string | null = retryOutcome.usedModel || null;

  if (usedFallback) {
    const pooled = await returnToPoolMessage({
      sessionId,
      task: nextTask,
      agent: assignedAgent,
      reason: "provider_unavailable",
      partialWork: result.messageText,
      error: `Live ${assignedAgent.provider} API unavailable; fallback output preserved as partial work.`,
    });
    return { newMessages: pooled.messages, updatedTasks: pooled.tasks, approvalRequired: false, approval: null };
  }

  await markProviderHealthy({ sessionId, provider: assignedAgent.provider });

  if (usedModel) await db.update(agentsTable).set({ lastUsedModel: usedModel }).where(eq(agentsTable.id, assignedAgent.id));

  if (result.blockedReason && !assignedAgent.canUseTools) {
    logger.info({ sessionId, taskId: nextTask.id, agentId: assignedAgent.id, blockedReason: result.blockedReason }, "Agent blocked — initiating tool handoff");
    const { handoffMessage, siblingTask } = await handleToolHandoff(sessionId, nextTask, result, assignedAgent);
    await logAudit(sessionId, "tool_handoff", `${assignedAgent.name} blocked — tool handoff to capable agent`, { originalTaskId: nextTask.id, siblingTaskId: siblingTask.id, blockedReason: result.blockedReason, reservedCredits: reservation.credits });
    const updatedCost = (session.estimatedCost ?? 0) + result.estimatedCost;
    await db.update(sessionsTable).set({ estimatedCost: updatedCost }).where(eq(sessionsTable.id, sessionId));
    return { newMessages: [handoffMessage], updatedTasks: [{ ...nextTask, status: "blocked_needs_tools" } as Task, siblingTask], approvalRequired: false, approval: null };
  }

  const messageMetadata: Record<string, unknown> = { reservedCredits: reservation.credits };
  if (result.toolOutputs && result.toolOutputs.length > 0) {
    messageMetadata.toolOutputs = result.toolOutputs;
    await logAudit(sessionId, "tool_outputs_persisted", `${assignedAgent.name} produced ${result.toolOutputs.length} tool output(s)`, { taskId: nextTask.id, agentId: assignedAgent.id, outputTypes: result.toolOutputs.map((o) => o.type), reservedCredits: reservation.credits });
  }

  const [newMsg] = await db.insert(messagesTable).values({
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
    metadata: Object.keys(messageMetadata).length > 0 ? messageMetadata : undefined,
  }).returning();

  if (!newMsg) return { newMessages: [], updatedTasks: [], approvalRequired: false, approval: null };

  await logAudit(sessionId, "agent_message_generated", `${assignedAgent.name} completed task: ${nextTask.title}`, { taskId: nextTask.id, agentId: assignedAgent.id, reservedCredits: reservation.credits });

  const answerMessages = await persistAnswers(sessionId, assignedAgent, result.answersToQuestions ?? [], nextTask.id);
  const questionMessages = await persistOutboundQuestions(sessionId, assignedAgent, result.outboundQuestions ?? [], nextTask.id, agents);

  if (questionMessages.length > 0) {
    await logAudit(sessionId, "agent_questions_sent", `${assignedAgent.name} sent ${questionMessages.length} question(s)`, { taskId: nextTask.id, questionCount: questionMessages.length, reservedCredits: reservation.credits });
  }

  const newTaskStatus = result.completionStatus === "complete" ? "complete" : "review";
  const [updatedTask] = await db.update(tasksTable).set({ status: newTaskStatus, costEstimate: result.estimatedCost }).where(eq(tasksTable.id, nextTask.id)).returning();

  const updatedCost = (session.estimatedCost ?? 0) + result.estimatedCost;
  await db.update(sessionsTable).set({ estimatedCost: updatedCost }).where(eq(sessionsTable.id, sessionId));

  await updateMemory(sessionId, [newMsg], assignedAgent.name, nextTask.title);
  await logAudit(sessionId, "memory_updated", "Shared memory updated");

  const allNewMessages: Message[] = [newMsg, ...answerMessages, ...questionMessages];
  return { newMessages: allNewMessages, updatedTasks: updatedTask ? [updatedTask] : [], approvalRequired: false, approval: null };
}

export async function runFullWorkflow(sessionId: number): Promise<{
  newMessages: Message[];
  updatedTasks: Task[];
  approvalRequired: boolean;
  approval: typeof approvalsTable.$inferSelect | null;
  stepsRun: number;
}> {
  const allMessages: Message[] = [];
  const allTasks: Task[] = [];
  let approvalRequired = false;
  let approval: typeof approvalsTable.$inferSelect | null = null;
  let stepsRun = 0;

  for (let i = 0; i < MAX_TURNS; i++) {
    const result = await runNextAgentStep(sessionId);
    stepsRun += 1;
    allMessages.push(...result.newMessages);
    allTasks.push(...result.updatedTasks);
    if (result.approvalRequired) {
      approvalRequired = true;
      approval = result.approval;
      break;
    }
    if (result.newMessages.length === 0 && result.updatedTasks.length === 0) break;
  }

  return { newMessages: allMessages, updatedTasks: allTasks, approvalRequired, approval, stepsRun };
}
