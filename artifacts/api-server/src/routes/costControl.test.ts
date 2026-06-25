import { describe, it, expect, beforeEach } from "vitest";
import {
  getPolicy,
  updatePolicy,
  registerTask,
  recordStep,
  recordToolInvocation,
  recordBrowserTime,
  pauseTaskForUserInput,
  resumeTask,
  completeTask,
  getCostControlStatus,
  canStartTask,
} from "../lib/costControl";

function uid() {
  return Math.floor(Math.random() * 1_000_000);
}

function tid() {
  return `task-${Math.random().toString(36).slice(2)}`;
}

describe("costControl", () => {
  it("returns a valid policy", () => {
    const policy = getPolicy();
    expect(policy.maxConcurrentTasksPerUser).toBeGreaterThan(0);
    expect(policy.maxAgentStepsPerTask).toBeGreaterThan(0);
  });

  it("updates policy", () => {
    updatePolicy({ maxConcurrentTasksPerUser: 5 });
    expect(getPolicy().maxConcurrentTasksPerUser).toBe(5);
    updatePolicy({ maxConcurrentTasksPerUser: 3 });
  });

  it("registers a task", () => {
    const state = registerTask(tid(), uid());
    expect(state.status).toBe("running");
    expect(state.agentSteps).toBe(0);
  });

  it("records steps and returns allowed until limit", () => {
    const taskId = tid();
    const userId = uid();
    updatePolicy({ maxAgentStepsPerTask: 5 });
    registerTask(taskId, userId);

    for (let i = 0; i < 4; i++) {
      const result = recordStep(taskId);
      expect(result.allowed).toBe(true);
    }
    const overLimit = recordStep(taskId);
    expect(overLimit.allowed).toBe(false);
    updatePolicy({ maxAgentStepsPerTask: 200 });
  });

  it("blocks tool invocations when limit reached", () => {
    const taskId = tid();
    updatePolicy({ maxToolInvocationsPerTask: 2 });
    registerTask(taskId, uid());
    recordToolInvocation(taskId);
    recordToolInvocation(taskId);
    const r = recordToolInvocation(taskId);
    expect(r.allowed).toBe(false);
    updatePolicy({ maxToolInvocationsPerTask: 100 });
  });

  it("pauses and resumes a task", () => {
    const taskId = tid();
    registerTask(taskId, uid());
    pauseTaskForUserInput(taskId, "awaiting user auth");
    expect(recordStep(taskId).allowed).toBe(false);
    resumeTask(taskId);
    expect(recordStep(taskId).allowed).toBe(true);
  });

  it("canStartTask blocks when max concurrent reached", () => {
    const userId = uid();
    updatePolicy({ maxConcurrentTasksPerUser: 2 });
    registerTask(tid(), userId);
    registerTask(tid(), userId);
    const r = canStartTask(userId);
    expect(r.allowed).toBe(false);
    updatePolicy({ maxConcurrentTasksPerUser: 3 });
  });

  it("getCostControlStatus has rawValuesReturned false", () => {
    const status = getCostControlStatus();
    expect(status.rawValuesReturned).toBe(false);
  });

  it("browser time recording respects limit", () => {
    const taskId = tid();
    updatePolicy({ maxBrowserMinutesPerTask: 5 });
    registerTask(taskId, uid());
    recordBrowserTime(taskId, 4);
    const r = recordBrowserTime(taskId, 2);
    expect(r.allowed).toBe(false);
    updatePolicy({ maxBrowserMinutesPerTask: 30 });
  });
});
