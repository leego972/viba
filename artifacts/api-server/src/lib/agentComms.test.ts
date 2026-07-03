import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => {
  // Default select chain supports BOTH `await ...where(...)` (thenable) and
  // `...where(...).orderBy(...)` — mirrors drizzle's fluent/awaitable builder.
  const makeWhereResult = () => {
    const whereResult: Record<string, unknown> = {
      orderBy: vi.fn().mockResolvedValue([]),
      then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
    };
    return whereResult;
  };
  return {
    db: {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => makeWhereResult()),
        }),
      })),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    },
    messagesTable: { id: {}, sessionId: {}, messageType: {}, toAgentId: {}, taskId: {} },
    agentsTable: {},
    tasksTable: { id: {}, sessionId: {}, assignedAgentId: {}, status: {} },
  };
});

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
      // First call: fetch questions (session + recipient + task) — uses orderBy
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([questionRow]),
          }),
        }),
      })
      // Second call: fetch answers — resolves from where()
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
      sourceTaskId: 10,  // preserved from the question's stored taskId
    });
  });

  it("does NOT deliver a question from a different task (strict task-scoped delivery)", async () => {
    // Strict task scoping: Agent A asks Agent B on task 10.
    // Agent B is executing task 11. The DB filters by taskId=11, so the question
    // stored on task 10 is NOT returned.
    const { db } = await import("@workspace/db");

    (db.select as ReturnType<typeof vi.fn>)
      // DB filters by taskId=11; task-10 question is excluded — returns empty
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

    const { processPendingQuestions } = await import("./agentComms");
    const result = await processPendingQuestions(1, 2, 11);
    expect(result).toHaveLength(0);
  });

  it("full lifecycle: question asked on task N is delivered and resolved after answer on same task", async () => {
    // E2E lifecycle: Agent A (task 10) asks Agent B on the same task 10 →
    // Agent B (also task 10) receives it → Agent B answers → question is resolved.
    const { db } = await import("@workspace/db");
    const questionRow = makeQuestionRow(); // taskId: 10, toAgentId: 2, id: 5
    const answerRow = {
      id: 20,
      sessionId: 1,
      messageType: "answer",
      metadata: { questionMessageId: 5 },
      createdAt: new Date().toISOString(),
    };

    // Step 1: Before answer — question is pending for Agent B on task 10
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([questionRow]),
          }),
        }),
      })
      // No answers yet
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

    const { processPendingQuestions } = await import("./agentComms");
    const pendingBefore = await processPendingQuestions(1, 2, 10);
    expect(pendingBefore).toHaveLength(1);
    expect(pendingBefore[0]).toMatchObject({ fromAgent: "Claude", messageId: 5 });

    // Step 2: After answer — question is resolved, pending list is empty
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([questionRow]),
          }),
        }),
      })
      // Answer now present with questionMessageId: 5
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([answerRow]),
        }),
      });

    const pendingAfter = await processPendingQuestions(1, 2, 10);
    expect(pendingAfter).toHaveLength(0); // resolved — not pending any more
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

  it("cross-task questions are NOT delivered (strict task scoping)", async () => {
    // Strict task scoping: Agent A stores a question on task 10. Agent B is executing task 20.
    // DB filters by taskId=20 so the task-10 question is excluded.
    // For cross-task comms, questions must be stored under the recipient's active task ID.
    const { db } = await import("@workspace/db");

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]), // DB filters to taskId=20, returns nothing
          }),
        }),
      });

    const { processPendingQuestions } = await import("./agentComms");
    const result = await processPendingQuestions(1, 2, 20);
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

  it("falls back to sender's taskId when recipient has no active task", async () => {
    const { db } = await import("@workspace/db");
    let capturedValues: Record<string, unknown> | null = null;
    const savedMsg = { id: 20, content: "q", sessionId: 1, messageType: "question", createdAt: new Date().toISOString() };
    // Default db.select mock returns [] — no active task found for recipient
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
    expect(capturedValues).toMatchObject({ taskId: 42, metadata: { senderTaskId: 42, questionTaskId: 42 } });
  });

  it("stores question under recipient's active task ID for cross-task delivery", async () => {
    // When Agent B has task 55 in-progress, a question from Agent A (task 42) is stored
    // under taskId=55. processPendingQuestions(sessionId, B, 55) then finds it via strict filter.
    const { db } = await import("@workspace/db");
    let capturedValues: Record<string, unknown> | null = null;
    const savedMsg = { id: 20, content: "q", sessionId: 1, messageType: "question", createdAt: new Date().toISOString() };

    // First db.select call: tasksTable lookup — recipient has task 55
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([{ id: 55 }]),
          }),
        }),
      });

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
    // Question tagged under recipient's task (55), not sender's (42)
    expect(capturedValues).toMatchObject({ taskId: 55, metadata: { senderTaskId: 42, questionTaskId: 55 } });
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
