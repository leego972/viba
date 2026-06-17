import { db, messagesTable, agentsTable } from "@workspace/db";
import type { Agent, Message } from "@workspace/db";
import { eq, and, isNull, asc } from "drizzle-orm";
import type { AgentTaskResult } from "./adapters/interface";
import { logger } from "./logger";

const MAX_OUTBOUND_QUESTIONS_PER_STEP = 3;

/**
 * Fetch unanswered question messages directed at the given agent for this session.
 * Returns them as the pendingQuestions array to inject into the adapter's taskInput.
 *
 * Scoped by sessionId + toAgentId only — NOT by the recipient's current taskId.
 * Questions are stored with the *sender's* taskId; the recipient runs their own
 * task, so filtering by recipient's taskId would permanently hide all questions.
 * Display-side scoping (which task a question belongs to) is done via the
 * question's own taskId field, not here in the delivery query.
 */
export async function processPendingQuestions(
  sessionId: number,
  agentId: number,
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

  // Filter out already-answered questions
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
      .filter((id): id is number => id !== null),
  );

  const pending = questions
    .filter((q) => !answeredQuestionIds.has(q.id))
    .slice(0, 5); // cap at 5 pending questions per step

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
 * All questions are strictly task-scoped — the cap and name-resolution
 * together prevent off-topic or broadcast messaging.
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
    // Resolve recipient by name (case-insensitive) — skip unresolvable
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
 * for display purposes even though the recipient ran on a different task.
 *
 * Each answer links back to its question via metadata.questionMessageId.
 */
export async function persistAnswers(
  sessionId: number,
  fromAgent: Agent,
  answers: NonNullable<AgentTaskResult["answersToQuestions"]>,
  _responderTaskId: number,
): Promise<Message[]> {
  if (answers.length === 0) return [];

  // Look up all referenced question messages in one query so we can resolve
  // each question's original taskId.
  const questionIds = answers.map((a) => a.messageId);
  const questionRows = await db
    .select({ id: messagesTable.id, taskId: messagesTable.taskId })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.sessionId, sessionId),
        eq(messagesTable.messageType, "question"),
      ),
    );

  const questionTaskMap = new Map<number, number | null>(
    questionRows.map((r) => [r.id, r.taskId]),
  );

  const saved: Message[] = [];

  for (const a of answers) {
    // Use the originating question's taskId so the answer stays in the same
    // task thread. Fall back to responder's task only if lookup fails.
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

  // Warn if any referenced question message IDs were not found
  for (const id of questionIds) {
    if (!questionTaskMap.has(id)) {
      logger.warn({ questionMessageId: id, sessionId }, "persistAnswers: question message not found — using responder taskId as fallback");
    }
  }

  return saved;
}
