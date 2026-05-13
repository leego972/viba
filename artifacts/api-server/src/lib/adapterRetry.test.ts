import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAdapterWithRetry } from "./adapterRetry";
import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from "./adapters/interface";
import type { LogAuditFn } from "./adapterRetry";

vi.mock("./logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
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

describe("runAdapterWithRetry", () => {
  let logAuditMock: ReturnType<typeof vi.fn>;
  let buildFallbackMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logAuditMock = vi.fn().mockResolvedValue(undefined);
    buildFallbackMock = vi.fn().mockImplementation(() => makeFallbackAdapter());
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
});
