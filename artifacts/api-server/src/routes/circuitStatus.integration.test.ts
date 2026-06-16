import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import app from "../app";
import { resetAllCircuits, runAdapterWithRetry, loadCircuitStateFromDb } from "../lib/adapterRetry";
import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from "../lib/adapters/interface";

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

const CIRCUIT_OPEN_THRESHOLD = 5;
const CIRCUIT_TIMEOUT_MS = 5 * 60 * 1_000;

const DUMMY_INPUT: AgentTaskInput = {
  systemRole: "test",
  projectGoal: "test goal",
  memorySummary: "",
  taskInstruction: "do something",
  previousMessages: [],
};

const DUMMY_RESULT: AgentTaskResult = {
  messageText: "done",
  suggestedNextTasks: [],
  completionStatus: "complete",
  confidence: 1,
  estimatedCost: 0,
};

function makeFallbackAdapter(): AgentAdapter {
  return {
    id: "sim",
    name: "Sim",
    provider: "sim",
    model: "sim-model",
    capabilities: [],
    role: "assistant",
    isMock: true,
    canUseTools: false,
    runTask: async () => DUMMY_RESULT,
  };
}

async function openCircuit(provider: string): Promise<void> {
  const buildLive = async (): Promise<AgentAdapter> => {
    throw new Error("transient failure");
  };
  for (let i = 0; i < CIRCUIT_OPEN_THRESHOLD; i++) {
    await runAdapterWithRetry({
      buildLiveAdapter: buildLive,
      buildFallbackAdapter: makeFallbackAdapter,
      taskInput: DUMMY_INPUT,
      retryDelayMs: 0,
      logAudit: async () => {},
      context: { sessionId: 1, agentId: 1, provider, taskId: 1, taskTitle: "test task" },
    });
  }
}

beforeEach(() => {
  resetAllCircuits();
});

describe("GET /api/circuit-status", () => {
  it("returns 200 with the correct response shape and an empty entries array when no provider has ever failed", async () => {
    const res = await request(app).get("/api/circuit-status").expect(200);
    expect(res.body).toHaveProperty("entries");
    expect(res.body).toHaveProperty("restoredCount");
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries).toEqual([]);
    expect(typeof res.body.restoredCount).toBe("number");
  });

  it("returns open state with correct fields after enough consecutive failures", async () => {
    await openCircuit("openai");

    const res = await request(app).get("/api/circuit-status").expect(200);

    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries).toHaveLength(1);

    const entry = res.body.entries[0];
    expect(entry.provider).toBe("openai");
    expect(entry.state).toBe("open");
    expect(entry.consecutiveFailures).toBe(CIRCUIT_OPEN_THRESHOLD);
    expect(typeof entry.openedAt).toBe("number");
    expect(entry.msUntilReset).toBeGreaterThan(0);
    expect(entry.msUntilReset).toBeLessThanOrEqual(CIRCUIT_TIMEOUT_MS);
  });

  it("returns half-open state once the cooldown window elapses", async () => {
    await openCircuit("anthropic");

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + CIRCUIT_TIMEOUT_MS + 1_000);

      const res = await request(app).get("/api/circuit-status").expect(200);

      expect(res.body.entries).toHaveLength(1);
      const entry = res.body.entries[0];
      expect(entry.provider).toBe("anthropic");
      expect(entry.state).toBe("half-open");
      expect(entry.msUntilReset).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns closed state with partial failures below the open threshold", async () => {
    const buildLive = async (): Promise<AgentAdapter> => {
      throw new Error("transient failure");
    };
    const failuresBelowThreshold = CIRCUIT_OPEN_THRESHOLD - 1;
    for (let i = 0; i < failuresBelowThreshold; i++) {
      await runAdapterWithRetry({
        buildLiveAdapter: buildLive,
        buildFallbackAdapter: makeFallbackAdapter,
        taskInput: DUMMY_INPUT,
        retryDelayMs: 0,
        logAudit: async () => {},
        context: { sessionId: 1, agentId: 1, provider: "google", taskId: 1, taskTitle: "test" },
      });
    }

    const res = await request(app).get("/api/circuit-status").expect(200);

    expect(res.body.entries).toHaveLength(1);
    const entry = res.body.entries[0];
    expect(entry.provider).toBe("google");
    expect(entry.state).toBe("closed");
    expect(entry.consecutiveFailures).toBe(failuresBelowThreshold);
    expect(entry.openedAt).toBeNull();
    expect(entry.msUntilReset).toBeNull();
  });

  it("reflects multiple providers independently", async () => {
    await openCircuit("openai");
    await openCircuit("anthropic");

    const res = await request(app).get("/api/circuit-status").expect(200);

    expect(res.body.entries).toHaveLength(2);
    const providers = res.body.entries.map((e: { provider: string }) => e.provider).sort();
    expect(providers).toContain("openai");
    expect(providers).toContain("anthropic");
    res.body.entries.forEach((entry: { state: string }) => {
      expect(entry.state).toBe("open");
    });
  });

  it("returns null lastLoadedAt before loadCircuitStateFromDb has run (clean state)", async () => {
    // resetAllCircuits (called in beforeEach) now also clears startupLoadInfo
    const res = await request(app).get("/api/circuit-status").expect(200);
    expect(res.body.lastLoadedAt).toBeNull();
    expect(res.body.restoredCount).toBe(0);
  });

  it("returns non-null lastLoadedAt and correct restoredCount after a successful loadCircuitStateFromDb call", async () => {
    const { db: mockDb } = await import("@workspace/db");
    // Override from() to resolve with an empty rows array (simulates successful but empty DB load)
    vi.mocked(mockDb.select).mockReturnValueOnce({
      from: vi.fn().mockResolvedValue([]),
    } as any);

    await loadCircuitStateFromDb();

    const res = await request(app).get("/api/circuit-status").expect(200);
    expect(typeof res.body.lastLoadedAt).toBe("number");
    expect(res.body.lastLoadedAt).toBeGreaterThan(0);
    expect(res.body.restoredCount).toBe(0);
  });
});

describe("POST /api/circuit-status/:provider/reset", () => {
  it("returns { ok: true } after resetting an open circuit", async () => {
    await openCircuit("openai");

    const res = await request(app)
      .post("/api/circuit-status/openai/reset")
      .expect(200);

    expect(res.body).toMatchObject({ ok: true, provider: "openai" });
  });

  it("circuit is gone from GET /api/circuit-status after reset", async () => {
    await openCircuit("openai");

    await request(app).post("/api/circuit-status/openai/reset").expect(200);

    const statusRes = await request(app).get("/api/circuit-status").expect(200);
    expect(statusRes.body.entries.find((e: { provider: string }) => e.provider === "openai")).toBeUndefined();
  });

  it("only removes the targeted provider, leaving others intact", async () => {
    await openCircuit("openai");
    await openCircuit("anthropic");

    await request(app).post("/api/circuit-status/openai/reset").expect(200);

    const statusRes = await request(app).get("/api/circuit-status").expect(200);
    expect(statusRes.body.entries.find((e: { provider: string }) => e.provider === "openai")).toBeUndefined();
    const remaining = statusRes.body.entries.find((e: { provider: string }) => e.provider === "anthropic");
    expect(remaining).toBeDefined();
    expect(remaining.state).toBe("open");
  });

  it("is a no-op and returns { ok: true } when the provider was never open", async () => {
    const res = await request(app)
      .post("/api/circuit-status/never-seen/reset")
      .expect(200);

    expect(res.body).toMatchObject({ ok: true, provider: "never-seen" });
  });
});
