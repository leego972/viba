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

describe("processPendingQuestions", () => {
  it("should return empty array when no pending questions", async () => {
    const { processPendingQuestions } = await import("./agentComms");
    const result = await processPendingQuestions(1, 2);
    expect(result).toEqual([]);
  });

  it("should return question objects with correct shape", async () => {
    const { db } = await import("@workspace/db");
    const questionRow = {
      id: 5,
      sessionId: 1,
      agentName: "Claude",
      content: "Which module handles auth?",
      messageType: "question",
      toAgentId: 2,
      metadata: null,
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
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

    const { processPendingQuestions } = await import("./agentComms");
    const result = await processPendingQuestions(1, 2);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      fromAgent: "Claude",
      question: "Which module handles auth?",
      messageId: 5,
    });
  });
});

describe("persistOutboundQuestions", () => {
  it("should skip question when recipient cannot be resolved", async () => {
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

  it("should cap questions at 3 per step", async () => {
    const { db } = await import("@workspace/db");
    const savedMsg = { id: 20, content: "q", sessionId: 1, messageType: "question", createdAt: new Date().toISOString() };
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([savedMsg]) }),
    });

    const { persistOutboundQuestions } = await import("./agentComms");
    const from = mockAgent(1, "ChatGPT");
    const agents = [from, mockAgent(2, "Claude"), mockAgent(3, "Gemini"), mockAgent(4, "Perplexity"), mockAgent(5, "Replit")];
    const questions = [
      { toAgentName: "Claude", question: "Q1?" },
      { toAgentName: "Gemini", question: "Q2?" },
      { toAgentName: "Perplexity", question: "Q3?" },
      { toAgentName: "Replit", question: "Q4?" }, // should be dropped
    ];

    const result = await persistOutboundQuestions(1, from as never, questions, 10, agents as never);
    expect(result).toHaveLength(3); // capped at MAX_OUTBOUND_QUESTIONS_PER_STEP
  });
});

describe("persistAnswers", () => {
  it("should save answer messages with correct metadata", async () => {
    const { db } = await import("@workspace/db");
    const savedMsg = { id: 30, content: "answer text", sessionId: 1, messageType: "answer", createdAt: new Date().toISOString() };
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

  it("should return empty array for no answers", async () => {
    const { persistAnswers } = await import("./agentComms");
    const from = mockAgent(1, "Replit", "replit");
    const result = await persistAnswers(1, from as never, [], 10);
    expect(result).toHaveLength(0);
  });
});
