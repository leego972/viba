import { db, messagesTable, agentsTable } from "@workspace/db";
import type { Agent, Message } from "@workspace/db";
import { eq, and, isNull, asc } from "drizzle-orm";
import type { AgentTaskResult } from "./adapters/interface";
import { logger } from "./logger";

const MAX_OUTBOUND_QUESTIONS_PER_STEP = 3;

/**
 * Fetch unanswered question messages directed at the given agent for this session.
 * Returns them as the pendingQuestions array to inject into the adapter's taskInput.
 */
export async function processPendingQuestions(
  sessionId: number,
  agentId: number,
): Promise<Array<{ fromAgent: string; question: string; messageId: number }>> {
  // Find question messages directed at this agent that have no answer yet.
  // An answer is a message with messageType="answer" whose metadata.questionMessageId
  // matches the question's id.
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
 * Each answer is saved as an "answer" message linking back to its question
 * via metadata.questionMessageId.
 */
export async function persistAnswers(
  sessionId: number,
  fromAgent: Agent,
  answers: NonNullable<AgentTaskResult["answersToQuestions"]>,
  taskId: number,
): Promise<Message[]> {
  if (answers.length === 0) return [];

  const saved: Message[] = [];

  for (const a of answers) {
    const [msg] = await db
      .insert(messagesTable)
      .values({
        sessionId,
        agentId: fromAgent.id,
        role: "assistant",
        provider: fromAgent.provider,
        content: a.answer,
        taskId,
        agentName: fromAgent.name,
        agentRole: fromAgent.role,
        messageType: "answer",
        metadata: { questionMessageId: a.messageId, taskId },
      })
      .returning();

    if (msg) {
      saved.push(msg);
    }
  }

  return saved;
}
