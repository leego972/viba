import { db, sessionsTable, agentsTable, tasksTable, messagesTable, memoryTable, approvalsTable, auditLogsTable } from "@workspace/db";
import type { Session, Agent, Task, Message } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { buildAdapter } from "./agentFactory";
import { routeTask } from "./taskRouter";
import { logger } from "./logger";

const APPROVAL_TASK_TYPES = new Set(["deployment_approval", "final_qa"]);
const MAX_TURNS = 8;

async function logAudit(sessionId: number, eventType: string, description: string, metadata?: Record<string, unknown>) {
  await db.insert(auditLogsTable).values({
    sessionId,
    eventType,
    description,
    metadata: metadata ?? {},
  });
}

async function updateMemory(sessionId: number, newMessages: Message[]) {
  const [mem] = await db.select().from(memoryTable).where(eq(memoryTable.sessionId, sessionId));
  const summary =
    newMessages
      .slice(-5)
      .map((m) => `[${m.agentName ?? "User"}] ${m.content.substring(0, 200)}`)
      .join("\n") + "\n\n" + (mem?.summary ?? "");

  if (mem) {
    await db.update(memoryTable).set({ summary: summary.substring(0, 2000) }).where(eq(memoryTable.id, mem.id));
  } else {
    await db.insert(memoryTable).values({
      sessionId,
      summary: summary.substring(0, 2000),
      decisions: [],
    });
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

  // Get next incomplete task
  const allTasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.sessionId, sessionId))
    .orderBy(asc(tasksTable.id));

  const nextTask = allTasks.find((t) => t.status === "planned" || t.status === "in_progress");
  if (!nextTask) {
    // All tasks done — mark session complete
    await db.update(sessionsTable).set({ status: "completed" }).where(eq(sessionsTable.id, sessionId));
    await logAudit(sessionId, "session_completed", "All tasks completed, session marked complete");
    return { newMessages: [], updatedTasks: [], approvalRequired: false, approval: null };
  }

  // Check if approval required before this task
  if (APPROVAL_TASK_TYPES.has(nextTask.type)) {
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
          description: `Approval required before running: ${nextTask.title}`,
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

  // Assign agent via task router
  const assignedAgent = nextTask.assignedAgentId
    ? agents.find((a) => a.id === nextTask.assignedAgentId) ?? routeTask(nextTask, agents)
    : routeTask(nextTask, agents);

  if (!assignedAgent) {
    return { newMessages: [], updatedTasks: [], approvalRequired: false, approval: null };
  }

  // Update task to in_progress
  await db.update(tasksTable).set({ status: "in_progress", assignedAgentId: assignedAgent.id }).where(eq(tasksTable.id, nextTask.id));
  await logAudit(sessionId, "task_assigned", `Task "${nextTask.title}" assigned to ${assignedAgent.name}`, {
    taskId: nextTask.id,
    agentId: assignedAgent.id,
  });

  // Get conversation history
  const previousMessages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, sessionId))
    .orderBy(asc(messagesTable.id));

  const [memory] = await db.select().from(memoryTable).where(eq(memoryTable.sessionId, sessionId));

  // Build adapter and run task
  const adapter = await buildAdapter(assignedAgent);

  const result = await adapter.runTask({
    systemRole: assignedAgent.role,
    projectGoal: session.goal,
    memorySummary: memory?.summary ?? "",
    taskInstruction: nextTask.description || nextTask.title,
    previousMessages: previousMessages.map((m) => ({
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

  await logAudit(sessionId, "agent_message_generated", `${assignedAgent.name} responded to task: ${nextTask.title}`, {
    taskId: nextTask.id,
    agentId: assignedAgent.id,
    completionStatus: result.completionStatus,
  });

  // Update task status
  let newTaskStatus = "in_progress";
  if (result.completionStatus === "complete") newTaskStatus = "complete";
  else if (result.completionStatus === "needs_review") newTaskStatus = "review";

  const [updatedTask] = await db
    .update(tasksTable)
    .set({ status: newTaskStatus, costEstimate: result.estimatedCost })
    .where(eq(tasksTable.id, nextTask.id))
    .returning();

  // Update session cost
  const updatedCost = (session.estimatedCost ?? 0) + result.estimatedCost;
  await db.update(sessionsTable).set({ estimatedCost: updatedCost }).where(eq(sessionsTable.id, sessionId));

  // Update memory
  await updateMemory(sessionId, [newMsg]);
  await logAudit(sessionId, "memory_updated", "Shared memory updated after agent response");

  // Add suggested next tasks
  for (const suggestion of result.suggestedNextTasks.slice(0, 2)) {
    await db.insert(tasksTable).values({
      sessionId,
      title: suggestion,
      description: suggestion,
      type: "planning",
      status: "planned",
    });
  }

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

    if (result.newMessages.length === 0 && result.updatedTasks.length === 0) {
      break;
    }

    // Check if session is complete
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    if (session?.status !== "active") break;
  }

  return { newMessages: allNewMessages, updatedTasks: allUpdatedTasks, approvalRequired, approval, stepsRun };
}
