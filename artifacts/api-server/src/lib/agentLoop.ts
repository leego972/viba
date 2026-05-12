import { db, sessionsTable, agentsTable, tasksTable, messagesTable, memoryTable, approvalsTable, auditLogsTable } from "@workspace/db";
import type { Session, Agent, Task, Message } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { buildAdapter } from "./agentFactory";
import { routeTask } from "./taskRouter";
import { logger } from "./logger";

const APPROVAL_TASK_TYPES = new Set(["final_qa"]);
const MAX_TURNS = 8;

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

  // Build a clean bullet-list summary — one line per completed task, max 10 entries
  const newEntry = `• [${agentName}] completed "${taskTitle}"`;

  const existingLines = (mem?.summary ?? "")
    .split("\n")
    .filter((l) => l.trim().startsWith("•"))
    .slice(0, 9); // keep last 9, we'll prepend the new one

  const summary = [newEntry, ...existingLines].join("\n");

  // Update decisions array with key agent outputs
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

  // Only pick tasks that are still in "planned" state — prevents re-running the same task
  const allTasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.sessionId, sessionId))
    .orderBy(asc(tasksTable.id));

  const nextTask = allTasks.find((t) => t.status === "planned");

  if (!nextTask) {
    // All tasks done — mark session complete
    const hasActiveTasks = allTasks.some((t) => t.status === "in_progress");
    if (!hasActiveTasks) {
      await db.update(sessionsTable).set({ status: "completed" }).where(eq(sessionsTable.id, sessionId));
      await logAudit(sessionId, "session_completed", "All tasks completed, session marked complete");
    }
    return { newMessages: [], updatedTasks: [], approvalRequired: false, approval: null };
  }

  // Check if approval required before this task (only for supervised sessions)
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
      return {
        newMessages: [],
        updatedTasks: [],
        approvalRequired: true,
        approval: approval ?? null,
      };
    } else if (existingApproval.status === "pending") {
      return { newMessages: [], updatedTasks: [], approvalRequired: true, approval: existingApproval };
    }
  }

  // Route to the best-fit agent
  const assignedAgent = routeTask(nextTask, agents);
  if (!assignedAgent) {
    return { newMessages: [], updatedTasks: [], approvalRequired: false, approval: null };
  }

  // Mark task in_progress
  await db.update(tasksTable).set({ status: "in_progress", assignedAgentId: assignedAgent.id }).where(eq(tasksTable.id, nextTask.id));
  await logAudit(sessionId, "task_assigned", `Task "${nextTask.title}" assigned to ${assignedAgent.name}`, {
    taskId: nextTask.id,
    agentId: assignedAgent.id,
  });

  // Get last 6 messages as conversation context (keep prompt lean)
  const previousMessages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, sessionId))
    .orderBy(asc(messagesTable.id));

  const recentMessages = previousMessages.slice(-6);
  const [memory] = await db.select().from(memoryTable).where(eq(memoryTable.sessionId, sessionId));

  // Build adapter and run task
  const adapter = await buildAdapter(assignedAgent);
  const result = await adapter.runTask({
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
  });

  // Save message
  const [newMsg] = await db
    .insert(messagesTable)
    .values({
      sessionId,
      agentId: assignedAgent.id,
      role: "assistant",
      provider: assignedAgent.provider,
      content: result.messageText,
      taskId: nextTask.id,
      agentName: assignedAgent.name,
      agentRole: assignedAgent.role,
    })
    .returning();

  if (!newMsg) {
    return { newMessages: [], updatedTasks: [], approvalRequired: false, approval: null };
  }

  await logAudit(sessionId, "agent_message_generated", `${assignedAgent.name} completed task: ${nextTask.title}`, {
    taskId: nextTask.id,
    agentId: assignedAgent.id,
  });

  // Each agent completes a task in one step — map completionStatus to final task state
  let newTaskStatus: string;
  if (result.completionStatus === "complete") {
    newTaskStatus = "complete";
  } else if (result.completionStatus === "needs_review") {
    newTaskStatus = "review";
  } else {
    // "in_progress" or anything else → mark review so it doesn't get re-run
    newTaskStatus = "review";
  }

  const [updatedTask] = await db
    .update(tasksTable)
    .set({ status: newTaskStatus, costEstimate: result.estimatedCost })
    .where(eq(tasksTable.id, nextTask.id))
    .returning();

  // Update session cost
  const updatedCost = (session.estimatedCost ?? 0) + result.estimatedCost;
  await db.update(sessionsTable).set({ estimatedCost: updatedCost }).where(eq(sessionsTable.id, sessionId));

  // Update memory cleanly
  await updateMemory(sessionId, [newMsg], assignedAgent.name, nextTask.title);
  await logAudit(sessionId, "memory_updated", "Shared memory updated");

  return {
    newMessages: [newMsg],
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

    // No progress — no more planned tasks
    if (result.newMessages.length === 0 && result.updatedTasks.length === 0) {
      break;
    }

    // Check if session completed
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    if (session?.status !== "active") break;
  }

  return { newMessages: allNewMessages, updatedTasks: allUpdatedTasks, approvalRequired, approval, stepsRun };
}
