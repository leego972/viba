import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
  messagesTable: {},
  agentsTable: {},
}));

const mockAgent = (id: number, name: string, provider = "openai") => ({
  id,
  sessionId: 1,
  name,
  provider,
  role: "Strategist",
  canUseTools: false,
  isMock: true,
  capabilities: [],
  lastUsedModel: null,
  createdAt: new Date().toISOString(),
});

function makeQuestionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    sessionId: 1,
    taskId: 10,
    agentName: "Claude",
    content: "Which module handles auth?",
    messageType: "question",
    toAgentId: 2,
    metadata: { taskId: 10 },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("processPendingQuestions", () => {
  it("returns empty array when no pending questions", async () => {
    const { processPendingQuestions } = await import("./agentComms");
    const result = await processPendingQuestions(1, 2, 10);
    expect(result).toEqual([]);
  });

  it("returns question objects with the correct shape", async () => {
    const { db } = await import("@workspace/db");
    const questionRow = makeQuestionRow();

    (db.select as ReturnType<typeof vi.fn>)
      // First call: fetch questions (includes taskId filter) — uses orderBy
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([questionRow]),
          }),
        }),
      })
      // Second call: fetch answers — no orderBy, resolves from where()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

    const { processPendingQuestions } = await import("./agentComms");
    const result = await processPendingQuestions(1, 2, 10);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      fromAgent: "Claude",
      question: "Which module handles auth?",
      messageId: 5,
    });
  });

  it("delivers a question to the recipient even when they are executing a later task (cross-task delivery)", async () => {
    // Scenario: Agent A (task 10) asks Agent B a question.
    // Agent B later runs task 11. The question must still arrive — filtering by
    // recipient's current taskId would permanently lose it.
    const { db } = await import("@workspace/db");
    const questionFromTask10 = makeQuestionRow({ id: 5, taskId: 10, toAgentId: 2 });

    (db.select as ReturnType<typeof vi.fn>)
      // First call: fetch questions — no taskId filter, so DB returns the question
      // even though Agent B is now executing task 11.
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([questionFromTask10]),
          }),
        }),
      })
      // Second call: fetch answers — none yet
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

    const { processPendingQuestions } = await import("./agentComms");
    // Agent 2 is currently on task 11 — but must still receive the question from task 10
    const result = await processPendingQuestions(1, 2, 11);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ fromAgent: "Claude", question: "Which module handles auth?", messageId: 5 });
  });

  it("filters out questions that are already answered", async () => {
    const { db } = await import("@workspace/db");
    const questionRow = makeQuestionRow();
    const answerRow = {
      id: 20,
      sessionId: 1,
      messageType: "answer",
      metadata: { questionMessageId: 5 },
      createdAt: new Date().toISOString(),
    };

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([questionRow]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([answerRow]),
        }),
      });

    const { processPendingQuestions } = await import("./agentComms");
    const result = await processPendingQuestions(1, 2, 10);
    expect(result).toHaveLength(0);
  });
});

describe("persistOutboundQuestions", () => {
  it("skips question when recipient cannot be resolved", async () => {
    const { db } = await import("@workspace/db");
    const insertMock = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });
    (db.insert as ReturnType<typeof vi.fn>).mockImplementation(insertMock);

    const { persistOutboundQuestions } = await import("./agentComms");
    const from = mockAgent(1, "ChatGPT");
    const agents = [from, mockAgent(2, "Claude")];
    const questions = [{ toAgentName: "NonExistentAgent", question: "Where is X?" }];

    const result = await persistOutboundQuestions(1, from as never, questions, 10, agents as never);
    expect(result).toHaveLength(0);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("caps questions at 3 per step", async () => {
    const { db } = await import("@workspace/db");
    const savedMsg = { id: 20, content: "q", sessionId: 1, messageType: "question", createdAt: new Date().toISOString() };
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([savedMsg]) }),
    });

    const { persistOutboundQuestions } = await import("./agentComms");
    const from = mockAgent(1, "ChatGPT");
    const agents = [from, mockAgent(2, "Claude"), mockAgent(3, "Gemini"), mockAgent(4, "Perplexity"), mockAgent(5, "Replit")];
    const questions = [
      { toAgentName: "Claude",      question: "Q1?" },
      { toAgentName: "Gemini",      question: "Q2?" },
      { toAgentName: "Perplexity",  question: "Q3?" },
      { toAgentName: "Replit",      question: "Q4?" }, // should be dropped
    ];

    const result = await persistOutboundQuestions(1, from as never, questions, 10, agents as never);
    expect(result).toHaveLength(3);
  });

  it("stores the sender's taskId on each question message", async () => {
    const { db } = await import("@workspace/db");
    let capturedValues: Record<string, unknown> | null = null;
    const savedMsg = { id: 20, content: "q", sessionId: 1, messageType: "question", createdAt: new Date().toISOString() };
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockImplementation((vals) => {
        capturedValues = vals;
        return { returning: vi.fn().mockResolvedValue([savedMsg]) };
      }),
    });

    const { persistOutboundQuestions } = await import("./agentComms");
    const from = mockAgent(1, "ChatGPT");
    const agents = [from, mockAgent(2, "Claude")];

    await persistOutboundQuestions(1, from as never, [{ toAgentName: "Claude", question: "Q?" }], 42, agents as never);
    expect(capturedValues).toMatchObject({ taskId: 42, metadata: { taskId: 42 } });
  });
});

describe("persistAnswers", () => {
  it("saves answer messages with correct metadata", async () => {
    const { db } = await import("@workspace/db");
    const savedMsg = { id: 30, content: "answer text", sessionId: 1, messageType: "answer", createdAt: new Date().toISOString() };

    // First call: fetch question rows (constrained to referenced IDs)
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: 5, taskId: 10 }]),
        }),
      });
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([savedMsg]) }),
    });

    const { persistAnswers } = await import("./agentComms");
    const from = mockAgent(1, "Replit", "replit");
    const answers = [{ messageId: 5, answer: "The auth module is in src/auth.ts" }];

    const result = await persistAnswers(1, from as never, answers, 10);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ messageType: "answer" });
  });

  it("returns empty array for no answers", async () => {
    const { persistAnswers } = await import("./agentComms");
    const from = mockAgent(1, "Replit", "replit");
    const result = await persistAnswers(1, from as never, [], 10);
    expect(result).toHaveLength(0);
  });

  it("uses question's original taskId for the answer (not responder's task)", async () => {
    const { db } = await import("@workspace/db");
    let capturedValues: Record<string, unknown> | null = null;
    const savedMsg = { id: 30, content: "a", sessionId: 1, messageType: "answer", createdAt: new Date().toISOString() };

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: 5, taskId: 10 }]),
        }),
      });
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockImplementation((vals) => {
        capturedValues = vals;
        return { returning: vi.fn().mockResolvedValue([savedMsg]) };
      }),
    });

    const { persistAnswers } = await import("./agentComms");
    const from = mockAgent(2, "Claude");
    // Responder is on task 99, but the question belongs to task 10
    await persistAnswers(1, from as never, [{ messageId: 5, answer: "Yes" }], 99);
    expect(capturedValues).toMatchObject({
      taskId: 10,
      metadata: { questionMessageId: 5, originTaskId: 10 },
    });
  });
});
