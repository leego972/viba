import { db, tasksTable, messagesTable, agentsTable } from "@workspace/db";
import type { Task, Agent, Message } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { AgentTaskResult } from "./adapters/interface";
import { logger } from "./logger";

/**
 * Called when a text-only agent hits a tool requirement it cannot fulfill.
 *
 * This function:
 *  1. Saves a "handoff" message documenting what was completed and what remains.
 *  2. Marks the original task as "blocked_needs_tools".
 *  3. ONLY if a tool-capable agent exists in the session: creates a sibling
 *     task so the router can pick it up and assign it to that agent.
 *     If no tool-capable agent exists, the task stays blocked with no sibling —
 *     this prevents unbounded task churn in text-only sessions.
 *
 * Returns the handoff message and, when a tool-capable agent was found,
 * the newly created sibling task.
 */
export async function handleToolHandoff(
  sessionId: number,
  originalTask: Task,
  partialResult: AgentTaskResult,
  fromAgent: Agent,
): Promise<{ handoffMessage: Message; siblingTask: Task | null; noToolAgent: boolean }> {
  const blockedReason = partialResult.blockedReason ?? "Tool capabilities required";
  const partialWork = partialResult.partialWork ?? partialResult.messageText;
  const toolRequirements = partialResult.toolRequirements ?? [];

  logger.info(
    { sessionId, taskId: originalTask.id, agentId: fromAgent.id, toolRequirements },
    "Tool handoff initiated",
  );

  // 1. Find a tool-capable agent in this session (exclude the blocking agent itself)
  const allAgents = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.sessionId, sessionId));

  const toolAgent = allAgents.find((a) => a.canUseTools && a.id !== fromAgent.id);
  const noToolAgent = !toolAgent;

  if (noToolAgent) {
    logger.warn(
      { sessionId, taskId: originalTask.id, agentId: fromAgent.id },
      "No tool-capable agent in session — task will stay blocked, no sibling created",
    );
  }

  // 2. Save the handoff message
  const handoffContent = [
    noToolAgent
      ? `## ⛔ Blocked — No Tool-Capable Agent Available`
      : `## 🔄 Partial Work — Handing off to tool-capable agent`,
    ``,
    `**Reason blocked:** ${blockedReason}`,
    ``,
    `**What was completed:**`,
    partialWork,
    ``,
    noToolAgent
      ? `**Action needed:** Add a tool-capable agent (e.g. Replit) to this session to continue.`
      : `**What remains (requires tools):** ${toolRequirements.length > 0 ? toolRequirements.join(", ") : "See sibling task"}`,
  ].join("\n");

  const [handoffMessage] = await db
    .insert(messagesTable)
    .values({
      sessionId,
      agentId: fromAgent.id,
      role: "assistant",
      provider: fromAgent.provider,
      content: handoffContent,
      taskId: originalTask.id,
      agentName: fromAgent.name,
      agentRole: fromAgent.role,
      messageType: "handoff",
      toAgentId: toolAgent?.id ?? null,
      metadata: {
        blockedReason,
        partialWork,
        toolRequirements,
        originalTaskId: originalTask.id,
        noToolAgent,
      },
    })
    .returning();

  if (!handoffMessage) {
    throw new Error("Failed to insert handoff message");
  }

  // 3. Mark the original task blocked
  await db
    .update(tasksTable)
    .set({
      status: "blocked_needs_tools",
      blockedReason,
      partialWork,
      toolRequirements: toolRequirements.length > 0 ? toolRequirements : null,
    })
    .where(eq(tasksTable.id, originalTask.id));

  // 4. If no tool-capable agent exists, stop here — do NOT create a sibling task.
  //    Returning null prevents the router from picking up a task that can never
  //    be assigned, which would cause unbounded planned-task accumulation.
  if (noToolAgent) {
    return { handoffMessage, siblingTask: null, noToolAgent: true };
  }

  // 5. Build sibling task description with full context
  const siblingDescription = [
    `[Continued from: ${originalTask.title}]`,
    ``,
    `A previous agent (${fromAgent.name}) completed the text-based portion of this task`,
    `but could not proceed without tool access.`,
    ``,
    `**Reason:** ${blockedReason}`,
    ``,
    `**Tools required:** ${toolRequirements.length > 0 ? toolRequirements.join(", ") : "code execution / deployment"}`,
    ``,
    `**Prior work to build on:**`,
    partialWork,
    ``,
    `**Original task description:**`,
    originalTask.description,
  ].join("\n");

  // 6. Insert sibling task — marked planned so the router picks it up
  const [siblingTask] = await db
    .insert(tasksTable)
    .values({
      sessionId,
      title: `[Tool] ${originalTask.title}`,
      description: siblingDescription,
      type: originalTask.type,
      status: "planned",
      toolRequirements: toolRequirements.length > 0 ? toolRequirements : null,
      dependencyTaskId: originalTask.id,
    })
    .returning();

  if (!siblingTask) {
    throw new Error("Failed to insert sibling task");
  }

  logger.info(
    { sessionId, siblingTaskId: siblingTask.id, originalTaskId: originalTask.id },
    "Tool handoff sibling task created",
  );

  return { handoffMessage, siblingTask, noToolAgent: false };
}
