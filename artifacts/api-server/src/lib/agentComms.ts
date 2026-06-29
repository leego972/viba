import { db, messagesTable, agentsTable, tasksTable } from "@workspace/db";
import type { Agent, Message } from "@workspace/db";
import { eq, and, asc, inArray, or, isNull, desc } from "drizzle-orm";
import type { AgentTaskResult } from "./adapters/interface";
import { logger } from "./logger";

const MAX_OUTBOUND_QUESTIONS_PER_STEP = 3;

/**
 * Fetch unanswered question messages directed at the given agent for the current task.
 *
 * Delivery uses task-scoped + floating-inbox semantics:
 *
 *   1. Questions stored under `currentTaskId` — strict task-scoped delivery.
 *      These were sent while the recipient had an active/planned task.
 *
 *   2. Questions stored with `taskId = null` — floating inbox.
 *      These were sent when the recipient had no assigned task at send-time.
 *      They are delivered the first time the recipient executes ANY task and
 *      effectively consumed once answered.
 *
 * Questions belonging to OTHER tasks are strictly excluded to preserve isolation.
 * Agents do not receive or answer questions from unrelated task threads.
 */
export async function processPendingQuestions(
  sessionId: number,
  agentId: number,
  currentTaskId: number,
): Promise<Array<{ fromAgent: string; question: string; messageId: number; sourceTaskId: number | null }>> {
  // task-scoped (exact taskId match) + floating (null taskId) — no other tasks
  const questions = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.sessionId, sessionId),
        eq(messagesTable.messageType, "question"),
        eq(messagesTable.toAgentId, agentId),
        or(
          eq(messagesTable.taskId, currentTaskId),
          isNull(messagesTable.taskId),
        ),
      ),
    )
    .orderBy(asc(messagesTable.id));

  if (questions.length === 0) return [];

  // Filter already-answered: look up answers that reference these exact question IDs.
  const questionIds = questions.map((q) => q.id);
  const answers = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.sessionId, sessionId),
        eq(messagesTable.messageType, "answer"),
      ),
    );

  const answeredQuestionIds = new Set<number>(
    answers
      .map((a) => {
        const meta = a.metadata as Record<string, unknown> | null;
        return typeof meta?.questionMessageId === "number" ? meta.questionMessageId : null;
      })
      .filter((id): id is number => id !== null && questionIds.includes(id)),
  );

  const pending = questions
    .filter((q) => !answeredQuestionIds.has(q.id))
    .slice(0, 5);

  return pending.map((q) => ({
    fromAgent: q.agentName ?? "Unknown agent",
    question: q.content,
    messageId: q.id,
    sourceTaskId: q.taskId ?? null, // preserved for UI thread grouping
  }));
}

/**
 * Save question messages for outbound questions emitted by an agent.
 * Resolves toAgentName → toAgentId using the session's agent list.
 * Capped at MAX_OUTBOUND_QUESTIONS_PER_STEP to prevent runaway chatter.
 *
 * Task-scoping strategy:
 * - Recipient has an active/planned task → store under that taskId.
 *   processPendingQuestions delivers it exactly when that task runs.
 * - Recipient has no task yet → store with taskId = null (floating inbox).
 *   processPendingQuestions delivers it the first time the recipient executes
 *   any task. No cross-task leakage; guaranteed eventual delivery.
 */
export async function persistOutboundQuestions(
  sessionId: number,
  fromAgent: Agent,
  questions: NonNullable<AgentTaskResult["outboundQuestions"]>,
  taskId: number,
  allAgents: Agent[],
): Promise<Message[]> {
  if (questions.length === 0) return [];

  const capped = questions.slice(0, MAX_OUTBOUND_QUESTIONS_PER_STEP);
  const saved: Message[] = [];

  for (const q of capped) {
    const recipient = allAgents.find(
      (a) => a.name.toLowerCase() === q.toAgentName.toLowerCase() && a.id !== fromAgent.id,
    );

    if (!recipient) {
      logger.warn(
        { sessionId, fromAgentId: fromAgent.id, toAgentName: q.toAgentName },
        "Could not resolve question recipient — skipping",
      );
      continue;
    }

    // Find the recipient's current active/planned task.
    // If none, store with taskId = null (floating inbox — delivered next task run).
    const recipientTasks = await db
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.sessionId, sessionId),
          eq(tasksTable.assignedAgentId, recipient.id),
          or(eq(tasksTable.status, "in_progress"), eq(tasksTable.status, "planned")),
        ),
      )
      .orderBy(desc(tasksTable.id));

    const questionTaskId: number | null = recipientTasks[0]?.id ?? null;

    const [msg] = await db
      .insert(messagesTable)
      .values({
        sessionId,
        agentId: fromAgent.id,
        role: "assistant",
        provider: fromAgent.provider,
        content: q.question,
        taskId: questionTaskId,
        agentName: fromAgent.name,
        agentRole: fromAgent.role,
        messageType: "question",
        toAgentId: recipient.id,
        metadata: { senderTaskId: taskId, questionTaskId },
      })
      .returning();

    if (msg) {
      saved.push(msg);
      logger.info(
        { sessionId, fromAgentId: fromAgent.id, toAgentId: recipient.id, questionTaskId },
        questionTaskId
          ? "Inter-agent question saved (task-scoped)"
          : "Inter-agent question saved (floating — no recipient task yet)",
      );
    }
  }

  return saved;
}

/**
 * Persist an agent's answers to pending questions.
 *
 * Each answer is stored under the *question's original taskId* (not the
 * responder's current taskId) to keep the Q/A pair in the same task thread
 * for display purposes.
 *
 * Answer lookup is constrained to the specific referenced question IDs
 * to enforce linkage and avoid stale matches across sessions.
 */
export async function persistAnswers(
  sessionId: number,
  fromAgent: Agent,
  answers: NonNullable<AgentTaskResult["answersToQuestions"]>,
  _responderTaskId: number,
): Promise<Message[]> {
  if (answers.length === 0) return [];

  const questionIds = answers.map((a) => a.messageId);

  const questionRows = await db
    .select({ id: messagesTable.id, taskId: messagesTable.taskId })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.sessionId, sessionId),
        eq(messagesTable.messageType, "question"),
        inArray(messagesTable.id, questionIds),
      ),
    );

  const questionTaskMap = new Map<number, number | null>(
    questionRows.map((r) => [r.id, r.taskId]),
  );

  const saved: Message[] = [];

  for (const a of answers) {
    const originTaskId = questionTaskMap.get(a.messageId) ?? _responderTaskId;

    const [msg] = await db
      .insert(messagesTable)
      .values({
        sessionId,
        agentId: fromAgent.id,
        role: "assistant",
        provider: fromAgent.provider,
        content: a.answer,
        taskId: originTaskId,
        agentName: fromAgent.name,
        agentRole: fromAgent.role,
        messageType: "answer",
        metadata: { questionMessageId: a.messageId, originTaskId },
      })
      .returning();

    if (msg) {
      saved.push(msg);
    }
  }

  for (const id of questionIds) {
    if (!questionTaskMap.has(id)) {
      logger.warn(
        { questionMessageId: id, sessionId },
        "persistAnswers: question message not found — skipping",
      );
    }
  }

  return saved;
}
