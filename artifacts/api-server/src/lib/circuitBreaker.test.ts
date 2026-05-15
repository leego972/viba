import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isCircuitOpen,
  resetAllCircuits,
  resetProviderCircuit,
  getCircuitStatus,
  runAdapterWithRetry,
} from "./adapterRetry";
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

// ── getCircuitStatus tests (task #77) ──────────────────────────────────────

describe("getCircuitStatus", () => {
  it("returns an empty array when no provider has ever failed", () => {
    expect(getCircuitStatus()).toEqual([]);
  });

  it("returns an entry with state=open after 5 consecutive failures", async () => {
    await openCircuit("openai");
    const entries = getCircuitStatus();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.provider).toBe("openai");
    expect(entries[0]!.state).toBe("open");
    expect(entries[0]!.consecutiveFailures).toBe(5);
    expect(entries[0]!.openedAt).toBeTypeOf("number");
    expect(entries[0]!.msUntilReset).toBeGreaterThan(0);
  });

  it("returns state=half-open after the timeout window elapses", async () => {
    await openCircuit("openai");
    const futureNow = Date.now() + 6 * 60 * 1000;
    const entries = getCircuitStatus(futureNow);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.state).toBe("half-open");
    expect(entries[0]!.msUntilReset).toBe(0);
  });

  it("omits providers that have 0 failures and no openedAt", () => {
    const status = getCircuitStatus();
    expect(status.find(e => e.provider === "unused-provider")).toBeUndefined();
  });

  it("tracks multiple providers independently", async () => {
    await openCircuit("openai");
    await openCircuit("anthropic");
    const entries = getCircuitStatus();
    const providers = entries.map(e => e.provider).sort();
    expect(providers).toContain("openai");
    expect(providers).toContain("anthropic");
    entries.forEach(e => expect(e.state).toBe("open"));
  });
});

// ── resetProviderCircuit tests (task #78 / #80) ───────────────────────────

describe("resetProviderCircuit", () => {
  it("clears an open circuit so isCircuitOpen returns false", async () => {
    await openCircuit("openai");
    expect(isCircuitOpen("openai")).toBe(true);

    await resetProviderCircuit("openai");

    expect(isCircuitOpen("openai")).toBe(false);
  });

  it("removes the provider from getCircuitStatus after reset", async () => {
    await openCircuit("openai");
    expect(getCircuitStatus().find(e => e.provider === "openai")).toBeDefined();

    await resetProviderCircuit("openai");

    const entries = getCircuitStatus();
    expect(entries.find(e => e.provider === "openai")).toBeUndefined();
  });

  it("reset does not affect other providers", async () => {
    await openCircuit("openai");
    await openCircuit("anthropic");

    await resetProviderCircuit("openai");

    expect(isCircuitOpen("openai")).toBe(false);
    expect(isCircuitOpen("anthropic")).toBe(true);
  });

  it("reset on an already-closed provider is a no-op (does not throw)", async () => {
    await expect(resetProviderCircuit("never-seen-provider")).resolves.toBeUndefined();
    expect(isCircuitOpen("never-seen-provider")).toBe(false);
  });

  it("live calls resume after a manual reset", async () => {
    await openCircuit("openai");
    await resetProviderCircuit("openai");

    let liveCalled = false;
    const out = await runAdapterWithRetry({
      buildLiveAdapter: async () => ({
        id: "live", name: "Live", provider: "openai", model: "gpt-4",
        capabilities: [], role: "tester", isMock: false,
        runTask: async () => { liveCalled = true; return MOCK_RESULT; },
      }),
      buildFallbackAdapter: () => makeMockAdapter(),
      taskInput: TASK_INPUT,
      retryDelayMs: 0,
      logAudit: noop as any,
      context: makeCtx("openai"),
    });

    expect(liveCalled).toBe(true);
    expect(out.usedFallback).toBe(false);
    expect(out.circuitOpen).toBeUndefined();
  });
});

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
