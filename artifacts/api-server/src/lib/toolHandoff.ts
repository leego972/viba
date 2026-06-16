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
 *  3. Creates a sibling task with the remaining work + full context, so the
 *     task router will pick it up and assign it to a tool-capable agent.
 *
 * Returns the newly created sibling task.
 */
export async function handleToolHandoff(
  sessionId: number,
  originalTask: Task,
  partialResult: AgentTaskResult,
  fromAgent: Agent,
): Promise<{ handoffMessage: Message; siblingTask: Task }> {
  const blockedReason = partialResult.blockedReason ?? "Tool capabilities required";
  const partialWork = partialResult.partialWork ?? partialResult.messageText;
  const toolRequirements = partialResult.toolRequirements ?? [];

  logger.info(
    { sessionId, taskId: originalTask.id, agentId: fromAgent.id, toolRequirements },
    "Tool handoff initiated",
  );

  // 1. Find a tool-capable agent to address the handoff message to
  const allAgents = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.sessionId, sessionId));

  const toolAgent = allAgents.find((a) => a.canUseTools && a.id !== fromAgent.id);

  // 2. Save the handoff message
  const handoffContent = [
    `## 🔄 Partial Work — Handing off to tool-capable agent`,
    ``,
    `**Reason blocked:** ${blockedReason}`,
    ``,
    `**What was completed:**`,
    partialWork,
    ``,
    `**What remains (requires tools):** ${toolRequirements.length > 0 ? toolRequirements.join(", ") : "See sibling task"}`,
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

  // 4. Build sibling task description with full context
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

  // 5. Insert sibling task — marked planned so the router picks it up
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

  return { handoffMessage, siblingTask };
}
