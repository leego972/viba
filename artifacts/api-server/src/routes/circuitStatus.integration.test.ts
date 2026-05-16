import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import app from "../app";
import { resetAllCircuits, runAdapterWithRetry } from "../lib/adapterRetry";
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
  it("returns 200 with an empty array when no provider has ever failed", async () => {
    const res = await request(app).get("/api/circuit-status").expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toEqual([]);
  });

  it("returns open state with correct fields after enough consecutive failures", async () => {
    await openCircuit("openai");

    const res = await request(app).get("/api/circuit-status").expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);

    const entry = res.body[0];
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

      expect(res.body).toHaveLength(1);
      const entry = res.body[0];
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

    expect(res.body).toHaveLength(1);
    const entry = res.body[0];
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

    expect(res.body).toHaveLength(2);
    const providers = res.body.map((e: { provider: string }) => e.provider).sort();
    expect(providers).toContain("openai");
    expect(providers).toContain("anthropic");
    res.body.forEach((entry: { state: string }) => {
      expect(entry.state).toBe("open");
    });
  });
});
