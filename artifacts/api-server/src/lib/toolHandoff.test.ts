import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          id: 99,
          sessionId: 1,
          agentId: 1,
          role: "assistant",
          content: "handoff message",
          messageType: "handoff",
          createdAt: new Date().toISOString(),
        }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
  tasksTable: {},
  messagesTable: {},
  agentsTable: {},
}));

const mockFromAgent = {
  id: 1,
  sessionId: 1,
  name: "ChatGPT",
  provider: "openai",
  role: "Strategist",
  canUseTools: false,
  isMock: true,
  capabilities: [],
  lastUsedModel: null,
  createdAt: new Date().toISOString(),
};

const mockTask = {
  id: 10,
  sessionId: 1,
  title: "Build the API",
  description: "Implement the REST API endpoints.",
  type: "build",
  status: "in_progress",
  assignedAgentId: 1,
  costEstimate: null,
  dependencyTaskId: null,
  blockedReason: null,
  partialWork: null,
  toolRequirements: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockPartialResult = {
  messageText: "I completed the planning portion but cannot execute code.",
  suggestedNextTasks: [],
  completionStatus: "in_progress" as const,
  confidence: 0.5,
  estimatedCost: 0.001,
  blockedReason: "Code execution required",
  partialWork: "Designed the API structure and wrote pseudocode.",
  toolRequirements: ["code_execution", "git_clone"],
};

/** Build a minimal two-call insert mock: first returns a handoff message, second a sibling task. */
function makeTwoInsertMock(siblingStatus: "planned" | "blocked_needs_tools") {
  const { db } = vi.mocked(require("@workspace/db"));
  return vi.fn()
    .mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          id: 99,
          sessionId: 1,
          content: "handoff",
          messageType: "handoff",
          createdAt: new Date().toISOString(),
        }]),
      }),
    })
    .mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          id: 11,
          sessionId: 1,
          title: "[Tool] Build the API",
          type: "build",
          status: siblingStatus,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }]),
      }),
    });
}

describe("handleToolHandoff", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should save a handoff message and create a planned sibling task when a tool-capable agent exists", async () => {
    const { db } = await import("@workspace/db");

    // Session has a tool-capable agent
    (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { ...mockFromAgent, id: 2, name: "Replit", provider: "replit", canUseTools: true },
        ]),
      }),
    });

    const insertMock = vi.fn()
      .mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: 99, sessionId: 1, content: "handoff", messageType: "handoff",
            createdAt: new Date().toISOString(),
          }]),
        }),
      })
      .mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: 11, sessionId: 1, title: "[Tool] Build the API", type: "build",
            status: "planned", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          }]),
        }),
      });
    (db.insert as ReturnType<typeof vi.fn>).mockImplementation(insertMock);

    const { handleToolHandoff } = await import("./toolHandoff");
    const result = await handleToolHandoff(1, mockTask as never, mockPartialResult, mockFromAgent as never);

    expect(result.handoffMessage).toBeDefined();
    expect(result.siblingTask).toBeDefined();
    expect(result.noToolAgent).toBe(false);
    expect(result.siblingTask.status).toBe("planned");
  });

  it("should mark original task as blocked_needs_tools", async () => {
    const { db } = await import("@workspace/db");

    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          id: 99, sessionId: 1, content: "handoff", messageType: "handoff",
          createdAt: new Date().toISOString(), status: "blocked_needs_tools",
        }]),
      }),
    });

    const updateSetMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: updateSetMock });

    const { handleToolHandoff } = await import("./toolHandoff");
    await handleToolHandoff(1, mockTask as never, mockPartialResult, mockFromAgent as never);

    expect(db.update).toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "blocked_needs_tools" }),
    );
  });

  it("should always create a sibling task, even when no tool-capable agent exists — status=blocked_needs_tools", async () => {
    // Spec compliance: sibling task is always created so the handoff path is
    // visible in the UI and resumable when a capable agent joins later.
    // When no tool-capable agent is present, the sibling waits in
    // "blocked_needs_tools" instead of "planned" to avoid unassignable tasks.
    const { db } = await import("@workspace/db");

    // Session has only text-only agents
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { ...mockFromAgent, id: 1, canUseTools: false },
          { ...mockFromAgent, id: 2, name: "Claude", provider: "anthropic", canUseTools: false },
        ]),
      }),
    });

    const insertMock = vi.fn()
      .mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: 99, sessionId: 1, content: "handoff", messageType: "handoff",
            createdAt: new Date().toISOString(),
          }]),
        }),
      })
      .mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: 11, sessionId: 1, title: "[Tool] Build the API", type: "build",
            status: "blocked_needs_tools",
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          }]),
        }),
      });
    (db.insert as ReturnType<typeof vi.fn>).mockImplementation(insertMock);

    const updateSetMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: updateSetMock });

    const { handleToolHandoff } = await import("./toolHandoff");
    const result = await handleToolHandoff(1, mockTask as never, mockPartialResult, mockFromAgent as never);

    // Sibling task is always created (never null)
    expect(result.siblingTask).toBeDefined();
    expect(result.noToolAgent).toBe(true);
    // When no tool-capable agent: sibling starts as blocked_needs_tools, not planned
    expect(result.siblingTask.status).toBe("blocked_needs_tools");

    // Two inserts: handoff message + sibling task
    expect(insertMock).toHaveBeenCalledTimes(2);

    // Original task also marked blocked
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "blocked_needs_tools" }),
    );
  });
});
