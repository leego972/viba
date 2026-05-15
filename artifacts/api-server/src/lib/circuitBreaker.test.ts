import { describe, it, expect, beforeEach, vi } from "vitest";
import { isCircuitOpen, resetAllCircuits, runAdapterWithRetry } from "./adapterRetry";
import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from "./adapters/interface";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
  circuitStateTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn().mockReturnValue(undefined),
}));

const TASK_INPUT: AgentTaskInput = {
  systemRole: "tester",
  projectGoal: "test",
  memorySummary: "",
  taskInstruction: "do something",
  previousMessages: [],
  taskType: "code",
};

const MOCK_RESULT: AgentTaskResult = {
  messageText: "done",
  suggestedNextTasks: [],
  completionStatus: "complete",
  confidence: 1,
  estimatedCost: 0,
};

function noop() { return Promise.resolve(); }

function makeCtx(provider = "openai") {
  return { sessionId: 1, agentId: 1, provider, taskId: 1, taskTitle: "test task" };
}

function makeMockAdapter(model = "mock-v1"): AgentAdapter {
  return {
    id: "mock",
    name: "Mock",
    provider: "mock",
    model,
    capabilities: [],
    role: "tester",
    isMock: true,
    runTask: async () => MOCK_RESULT,
  };
}

async function openCircuit(provider = "openai") {
  const buildLive = async (): Promise<AgentAdapter> => {
    throw Object.assign(new Error("rate limit"), { status: 429 });
  };
  for (let i = 0; i < 5; i++) {
    await runAdapterWithRetry({
      buildLiveAdapter: buildLive,
      buildFallbackAdapter: () => makeMockAdapter(),
      taskInput: TASK_INPUT,
      retryDelayMs: 0,
      logAudit: noop as any,
      context: makeCtx(provider),
    });
  }
}

beforeEach(() => { resetAllCircuits(); });

describe("isCircuitOpen", () => {
  it("is closed by default", () => {
    expect(isCircuitOpen("openai")).toBe(false);
  });

  it("opens after 5 consecutive transient failures", async () => {
    await openCircuit("openai");
    expect(isCircuitOpen("openai")).toBe(true);
  });

  it("stays open during the timeout window", async () => {
    await openCircuit("openai");
    expect(isCircuitOpen("openai")).toBe(true);
    // Still open just before the 5-minute window expires
    expect(isCircuitOpen("openai", Date.now() + 4 * 60 * 1000)).toBe(true);
  });

  it("allows probes once the timeout window elapses (half-open)", async () => {
    await openCircuit("openai");
    expect(isCircuitOpen("openai")).toBe(true);
    // 6 minutes later — circuit window expired, probe is allowed
    expect(isCircuitOpen("openai", Date.now() + 6 * 60 * 1000)).toBe(false);
  });

  it("circuit open — skips live call entirely and returns circuitOpen:true", async () => {
    await openCircuit("openai");

    let liveCalls = 0;
    const out = await runAdapterWithRetry({
      buildLiveAdapter: async () => { liveCalls++; throw new Error("should not be called"); },
      buildFallbackAdapter: () => makeMockAdapter("cb-mock"),
      taskInput: TASK_INPUT,
      retryDelayMs: 0,
      logAudit: noop as any,
      context: makeCtx("openai"),
    });

    expect(liveCalls).toBe(0);
    expect(out.usedFallback).toBe(true);
    expect(out.circuitOpen).toBe(true);
    expect(out.usedModel).toBe("cb-mock");
  });

  it("circuits are independent per provider", async () => {
    await openCircuit("openai");
    expect(isCircuitOpen("openai")).toBe(true);
    expect(isCircuitOpen("anthropic")).toBe(false);
  });

  it("resets on success after the timeout window", async () => {
    await openCircuit("openai");
    expect(isCircuitOpen("openai")).toBe(true);

    // resetAllCircuits simulates timeout expiry for this test
    resetAllCircuits();

    const out = await runAdapterWithRetry({
      buildLiveAdapter: async () => ({
        id: "live", name: "Live", provider: "openai", model: "gpt-4",
        capabilities: [], role: "coder", isMock: false,
        runTask: async () => MOCK_RESULT,
      }),
      buildFallbackAdapter: () => makeMockAdapter(),
      taskInput: TASK_INPUT,
      retryDelayMs: 0,
      logAudit: noop as any,
      context: makeCtx("openai"),
    });

    expect(out.usedFallback).toBe(false);
    expect(isCircuitOpen("openai")).toBe(false);
  });
});
