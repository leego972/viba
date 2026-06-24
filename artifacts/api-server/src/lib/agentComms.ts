import { db, messagesTable, agentsTable } from "@workspace/db";
import type { Agent, Message } from "@workspace/db";
import { eq, and, asc, inArray } from "drizzle-orm";
import type { AgentTaskResult } from "./adapters/interface";
import { logger } from "./logger";

const MAX_OUTBOUND_QUESTIONS_PER_STEP = 3;

/**
 * Fetch unanswered question messages directed at the given agent.
 *
 * Delivery is scoped to: session + recipient agent + unanswered questions.
 * It is NOT filtered by the recipient's current task — agents must be able to
 * receive questions that were asked during an earlier task and are still
 * pending when the recipient reaches a later task.  This preserves VIBA's
 * core collaboration model where agents communicate across task boundaries.
 *
 * Storage vs. delivery distinction:
 *  - Questions are stored with the sender's taskId for UI threading
 *    (see persistOutboundQuestions).
 *  - Answers are stored under the question's original taskId so the Q/A pair
 *    stays in the same thread (see persistAnswers).
 *  - Delivery must not lose cross-task questions by filtering on taskId here.
 */
export async function processPendingQuestions(
  sessionId: number,
  agentId: number,
  _currentTaskId: number,
): Promise<Array<{ fromAgent: string; question: string; messageId: number }>> {
  const questions = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.sessionId, sessionId),
        eq(messagesTable.messageType, "question"),
        eq(messagesTable.toAgentId, agentId),
      ),
    )
    .orderBy(asc(messagesTable.id));

  if (questions.length === 0) return [];

  // Filter out already-answered questions: fetch only answers that reference
  // one of the question IDs we just loaded — not the whole session.
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
  }));
}

/**
 * Save question messages for outbound questions emitted by an agent.
 * Resolves toAgentName → toAgentId using the session's agent list.
 * Capped at MAX_OUTBOUND_QUESTIONS_PER_STEP to prevent runaway chatter.
 * All questions are strictly task-scoped — stored with the sender's taskId.
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

    const [msg] = await db
      .insert(messagesTable)
      .values({
        sessionId,
        agentId: fromAgent.id,
        role: "assistant",
        provider: fromAgent.provider,
        content: q.question,
        taskId,
        agentName: fromAgent.name,
        agentRole: fromAgent.role,
        messageType: "question",
        toAgentId: recipient.id,
        metadata: { taskId },
      })
      .returning();

    if (msg) {
      saved.push(msg);
      logger.info(
        { sessionId, fromAgentId: fromAgent.id, toAgentId: recipient.id, taskId },
        "Inter-agent question saved",
      );
    }
  }

  return saved;
}

/**
 * Persist an agent's answers to pending questions.
 *
 * Each answer is stored under the *question's original taskId*, not the
 * responder's current taskId. This keeps the Q/A pair in the same task thread
 * for display purposes.
 *
 * Answer lookup is constrained to the specific referenced question IDs
 * (not the full session) to enforce same-task linkage and avoid stale matches.
 */
export async function persistAnswers(
  sessionId: number,
  fromAgent: Agent,
  answers: NonNullable<AgentTaskResult["answersToQuestions"]>,
  _responderTaskId: number,
): Promise<Message[]> {
  if (answers.length === 0) return [];

  const questionIds = answers.map((a) => a.messageId);

  // Fetch only the specific referenced question messages — not all session questions.
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
        "persistAnswers: question message not found — skipping (may be from a different session or already deleted)",
      );
    }
  }

  return saved;
}
