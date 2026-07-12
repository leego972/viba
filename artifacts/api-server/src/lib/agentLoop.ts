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
import { reserveCreditsForAction, chargeVibaToolCall, chargeCollaboration } from "./actionCreditBilling";
import { executeToolAction } from "./toolActionBroker";

const APPROVAL_TASK_TYPES = new Set(["final_qa"]);

/**
 * Maps an adapter's completionStatus to the DB task status string.
 *
 * "in_progress" must map to "planned" (not "review") so the task is re-picked
 * on the next runNextAgentStep call. Replit/Manus adapters return "in_progress"
 * when their workspace task times out mid-execution with partial progress —
 * those tasks must remain retryable, not get stranded in review.
 *
 * Exported for unit-testing the mapping in isolation.
 */
export function resolveTaskDbStatus(
  completionStatus: "in_progress" | "complete" | "needs_review" | "approval_required",
): string {
  switch (completionStatus) {
    case "complete":         return "complete";
    case "needs_review":     return "review";
    case "in_progress":      return "planned"; // still running — reset for retry
    case "approval_required":
    default:                 return "review";
  }
}
const MAX_TURNS = 12;

/**
 * Providers that handle tool execution natively inside their own adapter loop
 * (Replit agent URL polling, Manus workspace API, Railway MCP).
 * These are excluded from the VIBA broker tool loop in agentLoop — they must
 * NOT be routed through the broker for their own tools.
 * They ARE still charged per VIBA broker tool call if they explicitly request one.
 */
const NATIVE_EXECUTION_PROVIDERS = new Set(["replit", "manus", "railway"]);

/** Max VIBA broker tool calls per task step for a single text agent. */
const MAX_BROKER_LOOPS = 3;
const RETRY_DELAY_MS = 1_500;
const LIVE_STEP_TIMEOUT_MS = 120_000; // 2 min for live API calls
const SIM_STEP_TIMEOUT_MS  = 30_000;  // 30 s for simulation steps

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

export async function runNextAgentStep(sessionId: number, userId = 0): Promise<{
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

  // Exclude agents that sat out after the safety vote.
  const activeAgents = agents.filter((a) => !a.satOutReason);

  // Find the next "planned" task — skip blocked_needs_tools tasks that already have siblings
  const allTasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.sessionId, sessionId))
    .orderBy(asc(tasksTable.id));

  // Prioritise tool-handoff siblings: if a blocked_needs_tools task exists, its
  // sibling (dependencyTaskId → blocked task) must run before any other planned
  // task so partial-completion continues seamlessly with a tool-capable agent.
  const blockedTaskIds = new Set(
    allTasks.filter((t) => t.status === "blocked_needs_tools").map((t) => t.id),
  );
  const nextTask =
    allTasks.find((t) => t.status === "planned" && t.dependencyTaskId !== null && blockedTaskIds.has(t.dependencyTaskId!)) ??
    allTasks.find((t) => t.status === "planned");

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
  if (APPROVAL_TASK_TYPES.has(nextTask.type) && session.autonomyMode.toLowerCase() === "supervised") {
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

  // Route to the best-fit agent (tool-aware), excluding sat-out agents.
  const assignedAgent = routeTask(nextTask, activeAgents);
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

  // Fetch pending questions directed at this agent for the current task.
  // persistOutboundQuestions stores questions under the recipient's active task ID,
  // so strict task-scoped filtering here still delivers cross-agent questions.
  const pendingQuestions = await processPendingQuestions(sessionId, assignedAgent.id, nextTask.id);

  // ── Complexity-based credit billing ─────────────────────────────────────────
  // Deducts credits proportional to task type, description length, and whether
  // the assigned agent supports tool calls. No-op when Stripe is not configured.
  if (userId > 0) {
    const creditResult = await reserveCreditsForAction({
      userId,
      sessionId,
      task: nextTask,
      agent: assignedAgent,
      pendingQuestionCount: pendingQuestions.length,
    });
    if (!creditResult.ok) {
      // Session is already paused + a system message inserted by reserveCreditsForAction
      return { newMessages: [], updatedTasks: [], approvalRequired: false, approval: null };
    }
  }

  // Emit a "running" audit event on every poll cycle so the session feed shows live progress
  const onPollCycle = (info: { attempt: number; maxAttempts: number; status: string; elapsedMs: number }) => {
    void logAudit(
      sessionId,
      "agent_running",
      `${assignedAgent.name} is executing (poll ${info.attempt + 1}/${info.maxAttempts}, status: ${info.status}, elapsed: ${Math.round(info.elapsedMs / 1000)}s)`,
      {
        taskId: nextTask.id,
        agentId: assignedAgent.id,
        attempt: info.attempt,
        maxAttempts: info.maxAttempts,
        status: info.status,
        elapsedMs: info.elapsedMs,
      },
    );
  };

  // Build adapter — mock adapters inherit canUseTools from their class
  const stepTimeoutMs = assignedAgent.isMock ? SIM_STEP_TIMEOUT_MS : LIVE_STEP_TIMEOUT_MS;
  let stepTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const stepTimeoutRace = new Promise<never>((_, reject) => {
    stepTimeoutHandle = setTimeout(
      () => reject(new Error("STEP_TIMEOUT")),
      stepTimeoutMs,
    );
  });

  let retryOutcome: Awaited<ReturnType<typeof runAdapterWithRetry>>;
  try {
    retryOutcome = await Promise.race([
      runAdapterWithRetry({
        buildLiveAdapter: () => buildAdapter(assignedAgent, userId),
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
          peerAgents: activeAgents
            .filter((a) => a.id !== assignedAgent.id)
            .map((a) => ({ name: a.name, role: a.role })),
          taskType: nextTask.type,
          canUseTools: assignedAgent.canUseTools,
          repoUrl: session.repoUrl ?? undefined,
          repoBranch: session.repoBranch ?? undefined,
          workspaceEnv: session.workspaceEnv ?? undefined,
          pendingQuestions,
          onPollCycle,
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
      }),
      stepTimeoutRace,
    ]);
  } catch (err) {
    if (err instanceof Error && err.message === "STEP_TIMEOUT") {
      // Reset the task so it can be retried on the next run-next call
      await db
        .update(tasksTable)
        .set({ status: "planned", assignedAgentId: null })
        .where(eq(tasksTable.id, nextTask.id));
      const [timeoutMsg] = await db
        .insert(messagesTable)
        .values({
          sessionId,
          role: "assistant",
          agentId: assignedAgent.id,
          agentName: assignedAgent.name,
          provider: assignedAgent.provider,
          content: `⏱ Step timed out after ${stepTimeoutMs / 1000}s — task reset and queued for retry.`,
          messageType: "context",
          taskId: nextTask.id,
        })
        .returning();
      await logAudit(
        sessionId,
        "step_timeout",
        `Step timed out for ${assignedAgent.name} on "${nextTask.title}"`,
        { taskId: nextTask.id, agentId: assignedAgent.id, timeoutMs: stepTimeoutMs },
      );
      return {
        newMessages: timeoutMsg ? [timeoutMsg] : [],
        updatedTasks: [],
        approvalRequired: false,
        approval: null,
      };
    }
    throw err;
  } finally {
    clearTimeout(stepTimeoutHandle);
  }

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

  // ── VIBA broker tool loop (text agents with broker tools enabled) ──────────
  // Runs only for non-native providers that have canUseTools=true.
  // Native executors (Replit, Manus, Railway) handle their own tool loops inside
  // their adapters and must NOT be routed here — they use their own tools for free.
  // Each broker tool call costs credits (risk-level based) separate from the task fee.
  const isBrokerEligible =
    assignedAgent.canUseTools &&
    !NATIVE_EXECUTION_PROVIDERS.has(assignedAgent.provider.toLowerCase()) &&
    !assignedAgent.isMock;

  if (isBrokerEligible && result.toolCall) {
    const brokerMessages: Message[] = [];
    let currentResult = result;

    for (let loop = 0; loop < MAX_BROKER_LOOPS && currentResult.toolCall; loop++) {
      const { toolId, action, payload } = currentResult.toolCall;

      await logAudit(sessionId, "broker_tool_requested", `${assignedAgent.name} requested VIBA broker tool: ${toolId}`, {
        taskId: nextTask.id, agentId: assignedAgent.id, toolId, action, loop,
      });

      let brokerOutcome: Awaited<ReturnType<typeof executeToolAction>>;
      try {
        brokerOutcome = await executeToolAction({
          userId,
          taskId: nextTask.id,
          toolId,
          action,
          payload,
          requestedByAgent: assignedAgent.name,
        });
      } catch (brokerErr) {
        logger.warn({ brokerErr, toolId, agentId: assignedAgent.id }, "Broker tool execution threw — aborting tool loop");
        break;
      }

      // Charge credits for this VIBA broker tool call
      if (userId > 0) {
        const chargeResult = await chargeVibaToolCall({
          userId,
          sessionId,
          taskId: nextTask.id,
          toolId,
          riskLevel: brokerOutcome.riskLevel,
          agentName: assignedAgent.name,
          agentId: assignedAgent.id,
        });
        if (!chargeResult.ok) {
          // Insufficient credits — stop the broker loop gracefully
          await logAudit(sessionId, "broker_tool_loop_stopped", `Broker tool loop stopped — insufficient credits for ${toolId}`, {
            taskId: nextTask.id, agentId: assignedAgent.id,
          });
          break;
        }
      }

      // Persist tool result as a context message so the agent sees it next turn
      const toolResultContent = brokerOutcome.status === "executed"
        ? `🔧 **Tool result: ${toolId}**\nStatus: ${brokerOutcome.status}\n${brokerOutcome.message}${brokerOutcome.dryRunResult ? `\n\nResult: ${JSON.stringify(brokerOutcome.dryRunResult, null, 2)}` : ""}`
        : `🔧 **Tool: ${toolId}**\nStatus: ${brokerOutcome.status} — ${brokerOutcome.message}${brokerOutcome.warnings.length > 0 ? `\nWarnings: ${brokerOutcome.warnings.join(", ")}` : ""}`;

      const [toolResultMsg] = await db.insert(messagesTable).values({
        sessionId,
        agentId: null,
        role: "assistant",
        provider: "system",
        agentName: "VIBA System",
        agentRole: "Tool Broker",
        content: toolResultContent,
        messageType: "context",
        taskId: nextTask.id,
        metadata: {
          type: "broker_tool_result",
          toolId,
          action,
          status: brokerOutcome.status,
          riskLevel: brokerOutcome.riskLevel,
          requestedByAgent: assignedAgent.name,
          invocationId: brokerOutcome.invocationId,
        },
      }).returning();

      if (toolResultMsg) brokerMessages.push(toolResultMsg);

      // If the tool needs approval or is blocked, stop the loop
      if (brokerOutcome.status === "needs_user_approval" || brokerOutcome.status === "blocked" || brokerOutcome.status === "scope_denied") {
        await logAudit(sessionId, "broker_tool_loop_stopped", `Broker tool loop stopped — status: ${brokerOutcome.status}`, {
          taskId: nextTask.id, agentId: assignedAgent.id, toolId,
        });
        break;
      }

      // Re-run the adapter with the tool result injected into the conversation
      const updatedMessages = [
        ...recentMessages.map(m => ({ role: m.role, content: m.content, agentName: m.agentName ?? undefined })),
        ...brokerMessages.map(m => ({ role: m.role, content: m.content, agentName: m.agentName ?? undefined })),
      ].slice(-15);

      let nextOutcome: Awaited<ReturnType<typeof runAdapterWithRetry>>;
      try {
        nextOutcome = await runAdapterWithRetry({
          buildLiveAdapter: () => buildAdapter(assignedAgent, userId),
          buildFallbackAdapter: () => buildMockAdapter(assignedAgent),
          taskInput: {
            systemRole: assignedAgent.role,
            projectGoal: session.goal,
            memorySummary: memory?.summary ?? "",
            taskInstruction: nextTask.description || nextTask.title,
            previousMessages: updatedMessages,
            peerAgents: activeAgents.filter(a => a.id !== assignedAgent.id).map(a => ({ name: a.name, role: a.role })),
            taskType: nextTask.type,
            canUseTools: assignedAgent.canUseTools,
            repoUrl: session.repoUrl ?? undefined,
            repoBranch: session.repoBranch ?? undefined,
            workspaceEnv: session.workspaceEnv ?? undefined,
          },
          retryDelayMs: RETRY_DELAY_MS,
          logAudit: (eventType, description, metadata) => logAudit(sessionId, eventType, description, metadata),
          context: { sessionId, agentId: assignedAgent.id, provider: assignedAgent.provider, taskId: nextTask.id, taskTitle: nextTask.title },
        });
      } catch {
        break; // Adapter error after tool result — use current result as final
      }

      currentResult = nextOutcome.result;
    }

    // Merge broker messages into result and continue to normal completion
    result = currentResult;
    if (brokerMessages.length > 0) {
      await logAudit(sessionId, "broker_tool_loop_complete", `Broker tool loop finished after ${brokerMessages.length} tool call(s) for ${assignedAgent.name}`, {
        taskId: nextTask.id, agentId: assignedAgent.id,
      });
    }
  }

  // ── Tool handoff: text-only agent hit a tool blocker ──────────────────────
  if (result.blockedReason && !assignedAgent.canUseTools) {
    logger.info(
      { sessionId, taskId: nextTask.id, agentId: assignedAgent.id, blockedReason: result.blockedReason },
      "Agent blocked — initiating tool handoff",
    );

    const { handoffMessage, siblingTask, noToolAgent } = await handleToolHandoff(
      sessionId,
      nextTask,
      result,
      assignedAgent,
    );

    await logAudit(
      sessionId,
      "tool_handoff",
      noToolAgent
        ? `${assignedAgent.name} blocked — no tool-capable agent in session, task stays blocked`
        : `${assignedAgent.name} blocked — tool handoff to capable agent`,
      {
        originalTaskId: nextTask.id,
        siblingTaskId: siblingTask?.id ?? null,
        blockedReason: result.blockedReason,
        noToolAgent,
      },
    );

    // Update session cost
    const updatedCost = (session.estimatedCost ?? 0) + result.estimatedCost;
    await db.update(sessionsTable).set({ estimatedCost: updatedCost }).where(eq(sessionsTable.id, sessionId));

    const updatedTasks: Task[] = [{ ...nextTask, status: "blocked_needs_tools" } as Task];
    if (siblingTask) updatedTasks.push(siblingTask);

    return {
      newMessages: [handoffMessage],
      updatedTasks,
      approvalRequired: false,
      approval: null,
    };
  }

  // ── Normal completion path ─────────────────────────────────────────────────

  // Build message metadata — include tool outputs when present
  const messageMetadata: Record<string, unknown> = {};
  if (result.toolOutputs && result.toolOutputs.length > 0) {
    messageMetadata.toolOutputs = result.toolOutputs;
    await logAudit(sessionId, "tool_outputs_persisted", `${assignedAgent.name} produced ${result.toolOutputs.length} tool output(s)`, {
      taskId: nextTask.id,
      agentId: assignedAgent.id,
      outputTypes: result.toolOutputs.map((o) => o.type),
    });
  }

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
      metadata: Object.keys(messageMetadata).length > 0 ? messageMetadata : undefined,
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

  // Charge collaboration credits for answers given (fire-and-forget, no session pause)
  if (answerMessages.length > 0 && userId > 0) {
    void chargeCollaboration({
      userId,
      sessionId,
      taskId: nextTask.id,
      agentId: assignedAgent.id,
      agentName: assignedAgent.name,
      type: "answer",
      count: answerMessages.length,
    });
  }

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

    // Charge collaboration credits for questions sent (fire-and-forget, no session pause)
    if (userId > 0) {
      void chargeCollaboration({
        userId,
        sessionId,
        taskId: nextTask.id,
        agentId: assignedAgent.id,
        agentName: assignedAgent.name,
        type: "question",
        count: questionMessages.length,
      });
    }
  }

  // ── Update task status ─────────────────────────────────────────────────────
  const newTaskStatus = resolveTaskDbStatus(result.completionStatus);

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

export async function runFullWorkflow(sessionId: number, userId = 0): Promise<{
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
    const result = await runNextAgentStep(sessionId, userId);
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

  return { newMessages: allMessages, updatedTasks: allTasks, approvalRequired, approval, stepsRun };
}
