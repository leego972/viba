import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runAdapterWithRetry, isCircuitOpen, resetAllCircuits } from "./adapterRetry";
import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from "./adapters/interface";
import type { LogAuditFn } from "./adapterRetry";

vi.mock("./logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

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
  systemRole: "engineer",
  projectGoal: "build a widget",
  memorySummary: "",
  taskInstruction: "do the thing",
  previousMessages: [],
};

const SUCCESS_RESULT: AgentTaskResult = {
  messageText: "done",
  suggestedNextTasks: [],
  completionStatus: "complete",
  confidence: 0.9,
  estimatedCost: 0.001,
};

const CONTEXT = {
  sessionId: 1,
  agentId: 42,
  provider: "openai",
  taskId: 7,
  taskTitle: "Test Task",
};

function makeLiveAdapter(runTask: () => Promise<AgentTaskResult>): AgentAdapter {
  return {
    id: "live-1",
    name: "LiveAgent",
    provider: "openai",
    model: "gpt-4o",
    capabilities: [],
    role: "engineer",
    isMock: false,
    runTask,
  };
}

function makeFallbackAdapter(): AgentAdapter {
  return {
    id: "mock-1",
    name: "MockAgent",
    provider: "openai",
    model: "mock-gpt",
    capabilities: [],
    role: "engineer",
    isMock: true,
    runTask: vi.fn().mockResolvedValue({
      ...SUCCESS_RESULT,
      messageText: "simulated",
    }),
  };
}

// ── Circuit breaker constants (must match adapterRetry.ts) ─────────────────────
const CIRCUIT_OPEN_THRESHOLD = 5;
const CIRCUIT_TIMEOUT_MS = 5 * 60 * 1000;

describe("runAdapterWithRetry", () => {
  let logAuditMock: ReturnType<typeof vi.fn>;
  let buildFallbackMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetAllCircuits();
    logAuditMock = vi.fn().mockResolvedValue(undefined);
    buildFallbackMock = vi.fn().mockImplementation(() => makeFallbackAdapter());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetAllCircuits();
  });

  it("retries after a transient error and logs adapter_success with attempt: 2", async () => {
    let callCount = 0;
    const runTaskFn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw Object.assign(new Error("rate limit"), { status: 429 });
      }
      return SUCCESS_RESULT;
    });

    const buildLiveAdapter = vi.fn().mockResolvedValue(makeLiveAdapter(runTaskFn));

    const outcome = await runAdapterWithRetry({
      buildLiveAdapter: buildLiveAdapter as unknown as () => Promise<AgentAdapter>,
      buildFallbackAdapter: buildFallbackMock as unknown as () => AgentAdapter,
      taskInput: TASK_INPUT,
      retryDelayMs: 0,
      logAudit: logAuditMock as unknown as LogAuditFn,
      context: CONTEXT,
    });

    expect(buildLiveAdapter).toHaveBeenCalledTimes(2);
    expect(runTaskFn).toHaveBeenCalledTimes(2);
    expect(outcome.usedFallback).toBe(false);
    expect(outcome.successAttempt).toBe(2);
    expect(outcome.result.messageText).toBe("done");

    const successCall = logAuditMock.mock.calls.find(
      ([eventType]: [string]) => eventType === "adapter_success"
    );
    expect(successCall).toBeDefined();
    expect(successCall![2]).toMatchObject({ attempt: 2 });
  });

  it("skips retry on a 401 error and logs adapter_fallback with permanent: true", async () => {
    const authError = Object.assign(new Error("Unauthorized"), { status: 401 });
    const runTaskFn = vi.fn().mockRejectedValue(authError);
    const buildLiveAdapter = vi.fn().mockResolvedValue(makeLiveAdapter(runTaskFn));

    const outcome = await runAdapterWithRetry({
      buildLiveAdapter: buildLiveAdapter as unknown as () => Promise<AgentAdapter>,
      buildFallbackAdapter: buildFallbackMock as unknown as () => AgentAdapter,
      taskInput: TASK_INPUT,
      retryDelayMs: 0,
      logAudit: logAuditMock as unknown as LogAuditFn,
      context: CONTEXT,
    });

    expect(buildLiveAdapter).toHaveBeenCalledTimes(1);
    expect(runTaskFn).toHaveBeenCalledTimes(1);
    expect(outcome.usedFallback).toBe(true);
    expect(buildFallbackMock).toHaveBeenCalledTimes(1);

    const fallbackCall = logAuditMock.mock.calls.find(
      ([eventType]: [string]) => eventType === "adapter_fallback"
    );
    expect(fallbackCall).toBeDefined();
    expect(fallbackCall![2]).toMatchObject({ permanent: true });
  });

  // ── Circuit breaker transition tests ────────────────────────────────────────

  async function driveToFailures(count: number): Promise<void> {
    const transientError = Object.assign(new Error("server error"), { status: 500 });
    for (let i = 0; i < count; i++) {
      const runTaskFn = vi.fn().mockRejectedValue(transientError);
      const buildLiveAdapter = vi.fn().mockResolvedValue(makeLiveAdapter(runTaskFn));
      await runAdapterWithRetry({
        buildLiveAdapter: buildLiveAdapter as unknown as () => Promise<AgentAdapter>,
        buildFallbackAdapter: buildFallbackMock as unknown as () => AgentAdapter,
        taskInput: TASK_INPUT,
        retryDelayMs: 0,
        logAudit: logAuditMock as unknown as LogAuditFn,
        context: CONTEXT,
      });
    }
  }

  it("circuit opens after CIRCUIT_OPEN_THRESHOLD consecutive failures (closed → open)", async () => {
    expect(isCircuitOpen(CONTEXT.provider)).toBe(false);

    // One fewer than threshold — circuit should still be closed
    await driveToFailures(CIRCUIT_OPEN_THRESHOLD - 1);
    expect(isCircuitOpen(CONTEXT.provider)).toBe(false);

    // The threshold failure opens the circuit
    await driveToFailures(1);
    expect(isCircuitOpen(CONTEXT.provider)).toBe(true);
  });

  it("open circuit skips live adapter and falls back immediately with circuitOpen flag", async () => {
    // Force the circuit open
    await driveToFailures(CIRCUIT_OPEN_THRESHOLD);
    expect(isCircuitOpen(CONTEXT.provider)).toBe(true);

    logAuditMock.mockClear();
    const buildLiveAdapter = vi.fn().mockResolvedValue(
      makeLiveAdapter(vi.fn().mockResolvedValue(SUCCESS_RESULT))
    );

    const outcome = await runAdapterWithRetry({
      buildLiveAdapter: buildLiveAdapter as unknown as () => Promise<AgentAdapter>,
      buildFallbackAdapter: buildFallbackMock as unknown as () => AgentAdapter,
      taskInput: TASK_INPUT,
      retryDelayMs: 0,
      logAudit: logAuditMock as unknown as LogAuditFn,
      context: CONTEXT,
    });

    // Live adapter must not be called at all
    expect(buildLiveAdapter).not.toHaveBeenCalled();
    expect(outcome.usedFallback).toBe(true);
    expect(outcome.circuitOpen).toBe(true);

    // Audit log must record the circuit-open skip
    const fallbackCall = logAuditMock.mock.calls.find(
      ([eventType]: [string]) => eventType === "adapter_fallback"
    );
    expect(fallbackCall).toBeDefined();
    expect(fallbackCall![2]).toMatchObject({ circuitOpen: true });
  });

  it("successful probe after cooldown transitions circuit from half-open to closed", async () => {
    // Open the circuit
    await driveToFailures(CIRCUIT_OPEN_THRESHOLD);
    expect(isCircuitOpen(CONTEXT.provider)).toBe(true);

    // Advance time past cooldown — circuit becomes half-open
    const nowStub = vi.spyOn(Date, "now").mockReturnValue(Date.now() + CIRCUIT_TIMEOUT_MS + 1);

    expect(isCircuitOpen(CONTEXT.provider)).toBe(false); // half-open: probe allowed

    // Successful probe
    const buildLiveAdapter = vi.fn().mockResolvedValue(
      makeLiveAdapter(vi.fn().mockResolvedValue(SUCCESS_RESULT))
    );
    const outcome = await runAdapterWithRetry({
      buildLiveAdapter: buildLiveAdapter as unknown as () => Promise<AgentAdapter>,
      buildFallbackAdapter: buildFallbackMock as unknown as () => AgentAdapter,
      taskInput: TASK_INPUT,
      retryDelayMs: 0,
      logAudit: logAuditMock as unknown as LogAuditFn,
      context: CONTEXT,
    });

    expect(outcome.usedFallback).toBe(false);
    expect(outcome.circuitOpen).toBeUndefined();

    // Circuit should now be fully closed
    nowStub.mockRestore();
    expect(isCircuitOpen(CONTEXT.provider)).toBe(false);
  });

  it("failed probe after cooldown re-opens the circuit (half-open → open)", async () => {
    // Open the circuit
    await driveToFailures(CIRCUIT_OPEN_THRESHOLD);
    expect(isCircuitOpen(CONTEXT.provider)).toBe(true);

    // Advance time just past cooldown so isCircuitOpen returns false
    const futureNow = Date.now() + CIRCUIT_TIMEOUT_MS + 1;
    const nowStub = vi.spyOn(Date, "now").mockReturnValue(futureNow);

    expect(isCircuitOpen(CONTEXT.provider)).toBe(false); // half-open

    // Failing probe — should re-open the circuit with a fresh timer
    const transientError = Object.assign(new Error("still down"), { status: 503 });
    const buildLiveAdapter = vi.fn().mockResolvedValue(
      makeLiveAdapter(vi.fn().mockRejectedValue(transientError))
    );
    await runAdapterWithRetry({
      buildLiveAdapter: buildLiveAdapter as unknown as () => Promise<AgentAdapter>,
      buildFallbackAdapter: buildFallbackMock as unknown as () => AgentAdapter,
      taskInput: TASK_INPUT,
      retryDelayMs: 0,
      logAudit: logAuditMock as unknown as LogAuditFn,
      context: CONTEXT,
    });

    // Circuit must be open again (timer reset to futureNow)
    expect(isCircuitOpen(CONTEXT.provider)).toBe(true);

    // And after another full cooldown it should be half-open again
    nowStub.mockReturnValue(futureNow + CIRCUIT_TIMEOUT_MS + 1);
    expect(isCircuitOpen(CONTEXT.provider)).toBe(false);

    nowStub.mockRestore();
  });

  it("a success resets the failure counter and closes an open circuit", async () => {
    // Accumulate failures but stay one below threshold
    await driveToFailures(CIRCUIT_OPEN_THRESHOLD - 1);
    expect(isCircuitOpen(CONTEXT.provider)).toBe(false);

    // One success should zero out the failure counter
    const buildLiveAdapter = vi.fn().mockResolvedValue(
      makeLiveAdapter(vi.fn().mockResolvedValue(SUCCESS_RESULT))
    );
    await runAdapterWithRetry({
      buildLiveAdapter: buildLiveAdapter as unknown as () => Promise<AgentAdapter>,
      buildFallbackAdapter: buildFallbackMock as unknown as () => AgentAdapter,
      taskInput: TASK_INPUT,
      retryDelayMs: 0,
      logAudit: logAuditMock as unknown as LogAuditFn,
      context: CONTEXT,
    });

    // Even CIRCUIT_OPEN_THRESHOLD - 1 more failures shouldn't open the circuit
    // because the counter was reset to 0
    await driveToFailures(CIRCUIT_OPEN_THRESHOLD - 1);
    expect(isCircuitOpen(CONTEXT.provider)).toBe(false);
  });
});
