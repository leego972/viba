import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isCircuitOpen,
  resetAllCircuits,
  resetProviderCircuit,
  getCircuitStatus,
  runAdapterWithRetry,
  loadCircuitStateFromDb,
} from "./adapterRetry";
import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from "./adapters/interface";

// Shared mutable state — created during hoisting so the mock factory can
// reference it even though vi.mock() is hoisted above the imports.
const { mockDb } = vi.hoisted(() => {
  type PersistedRow = {
    provider: string;
    consecutiveFailures: number;
    openedAt: Date | null;
    updatedAt: Date;
  };
  const rows: PersistedRow[] = [];

  const mockDb = {
    rows,
    reset() {
      rows.splice(0, rows.length);
    },
  };

  return { mockDb };
});

vi.mock("@workspace/db", () => {
  type PersistedRow = {
    provider: string;
    consecutiveFailures: number;
    openedAt: Date | null;
    updatedAt: Date;
  };

  const makeFrom = () =>
    vi.fn().mockImplementation(() => {
      // Returns a promise (for loadCircuitStateFromDb) that also exposes
      // .where() (for refreshCircuitFromDb).  Both paths share this object.
      const promise = Promise.resolve([...mockDb.rows]) as Promise<PersistedRow[]> & {
        where: ReturnType<typeof vi.fn>;
      };
      promise.where = vi.fn().mockResolvedValue([]);
      return promise;
    });

  const makeInsert = () =>
    vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((vals: PersistedRow) => ({
        onConflictDoUpdate: vi.fn().mockImplementation(() => {
          const idx = mockDb.rows.findIndex((r) => r.provider === vals.provider);
          const row: PersistedRow = {
            provider: vals.provider,
            consecutiveFailures: vals.consecutiveFailures,
            openedAt: vals.openedAt,
            updatedAt: new Date(),
          };
          if (idx >= 0) {
            mockDb.rows[idx] = row;
          } else {
            mockDb.rows.push(row);
          }
          return Promise.resolve(undefined);
        }),
      })),
    }));

  const makeDelete = () =>
    vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation((condition: unknown) => {
        // The eq mock always returns undefined for the condition, but we need
        // to identify the provider. We capture it from the last insert call's
        // argument by hooking into the where() call with an injected provider.
        // Since we can't easily extract the provider from the opaque condition,
        // we expose a helper on mockDb to do it externally when needed.
        // For now, the delete mock just signals success; resetProviderCircuit
        // deletes from circuitMap directly so in-memory state is correct.
        return Promise.resolve(undefined);
      }),
    }));

  return {
    db: {
      select: vi.fn().mockReturnValue({ from: makeFrom() }),
      insert: makeInsert(),
      delete: makeDelete(),
    },
    circuitStateTable: {},
  };
});

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
    canUseTools: false,
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

beforeEach(() => {
  resetAllCircuits();
  mockDb.reset();
});

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
        capabilities: [], role: "tester", isMock: false, canUseTools: false,
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
        capabilities: [], role: "coder", isMock: false, canUseTools: false,
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

// ── loadCircuitStateFromDb persistence tests (task #79) ───────────────────

describe("loadCircuitStateFromDb", () => {
  it("restores an open circuit after an in-memory wipe (simulated restart)", async () => {
    // 1. Drive the provider to open its circuit — this also persists state
    //    into mockDb.rows via the insert mock.
    await openCircuit("openai");

    const beforeWipe = getCircuitStatus();
    expect(beforeWipe).toHaveLength(1);
    const original = beforeWipe[0]!;
    expect(original.state).toBe("open");
    expect(original.consecutiveFailures).toBe(5);
    const originalOpenedAt = original.openedAt!;
    expect(originalOpenedAt).toBeTypeOf("number");

    // 2. Wipe in-memory state — simulates the server process restarting.
    resetAllCircuits();
    expect(getCircuitStatus()).toHaveLength(0);
    expect(isCircuitOpen("openai")).toBe(false);

    // 3. Restore from the "DB" (mockDb.rows populated by the insert mock).
    //    The mock's select().from() returns a promise that resolves to
    //    mockDb.rows, matching what loadCircuitStateFromDb expects.
    await loadCircuitStateFromDb();

    // 4. Assert the circuit is open again with the correct values.
    expect(isCircuitOpen("openai")).toBe(true);

    const afterLoad = getCircuitStatus();
    expect(afterLoad).toHaveLength(1);
    const restored = afterLoad[0]!;
    expect(restored.provider).toBe("openai");
    expect(restored.state).toBe("open");
    expect(restored.consecutiveFailures).toBe(5);
    expect(restored.openedAt).toBe(originalOpenedAt);
    expect(restored.msUntilReset).toBeGreaterThan(0);
  });

  it("restores multiple open circuits independently", async () => {
    await openCircuit("openai");
    await openCircuit("anthropic");

    const beforeWipe = getCircuitStatus();
    expect(beforeWipe).toHaveLength(2);

    const openaiEntry = beforeWipe.find(e => e.provider === "openai")!;
    const anthropicEntry = beforeWipe.find(e => e.provider === "anthropic")!;

    resetAllCircuits();
    expect(getCircuitStatus()).toHaveLength(0);

    await loadCircuitStateFromDb();

    expect(isCircuitOpen("openai")).toBe(true);
    expect(isCircuitOpen("anthropic")).toBe(true);

    const afterLoad = getCircuitStatus();
    const restoredOpenai = afterLoad.find(e => e.provider === "openai")!;
    const restoredAnthropic = afterLoad.find(e => e.provider === "anthropic")!;

    expect(restoredOpenai.consecutiveFailures).toBe(openaiEntry.consecutiveFailures);
    expect(restoredOpenai.openedAt).toBe(openaiEntry.openedAt);
    expect(restoredAnthropic.consecutiveFailures).toBe(anthropicEntry.consecutiveFailures);
    expect(restoredAnthropic.openedAt).toBe(anthropicEntry.openedAt);
  });

  it("leaves circuits closed when the DB has no rows", async () => {
    // mockDb.rows is already empty (reset in beforeEach)
    resetAllCircuits();

    await loadCircuitStateFromDb();

    expect(getCircuitStatus()).toHaveLength(0);
    expect(isCircuitOpen("openai")).toBe(false);
  });

  it("circuit remains open and blocks live calls after load", async () => {
    await openCircuit("openai");
    resetAllCircuits();
    await loadCircuitStateFromDb();

    let liveCalls = 0;
    const out = await runAdapterWithRetry({
      buildLiveAdapter: async () => {
        liveCalls++;
        throw new Error("should not be reached");
      },
      buildFallbackAdapter: () => makeMockAdapter("post-restart-mock"),
      taskInput: TASK_INPUT,
      retryDelayMs: 0,
      logAudit: noop as any,
      context: makeCtx("openai"),
    });

    expect(liveCalls).toBe(0);
    expect(out.usedFallback).toBe(true);
    expect(out.circuitOpen).toBe(true);
    expect(out.usedModel).toBe("post-restart-mock");
  });
});
