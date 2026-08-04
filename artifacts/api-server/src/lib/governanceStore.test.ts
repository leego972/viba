import { describe, expect, it } from "vitest";
import { evaluateExecutionAuthorization } from "./governanceStore";
import type { TaskContract } from "./orchestrationGovernance";

function contract(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    id: "12",
    version: 1,
    sessionId: 7,
    taskId: 22,
    objective: "Implement governed work",
    assignedAgentId: 3,
    allowedPaths: ["artifacts/api-server/src/lib"],
    forbiddenPaths: ["deployment"],
    ownedInterfaces: ["GovernanceService"],
    dependencies: [],
    requiredChecks: ["Backend CI"],
    ...overrides,
  };
}

describe("governance execution authorization", () => {
  it("allows legacy execution without a contract in audit mode", () => {
    expect(evaluateExecutionAuthorization({
      taskId: 22,
      sessionId: 7,
      agentId: 3,
      mode: "audit",
      contract: null,
    }).allowed).toBe(true);
  });

  it("blocks execution without a contract in enforce mode", () => {
    const result = evaluateExecutionAuthorization({
      taskId: 22,
      sessionId: 7,
      agentId: 3,
      mode: "enforce",
      contract: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("no active task contract");
  });

  it("blocks an operator that is not assigned by the contract", () => {
    const result = evaluateExecutionAuthorization({
      taskId: 22,
      sessionId: 7,
      agentId: 8,
      mode: "enforce",
      contract: contract(),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("another operator");
  });

  it("blocks cross-session and cross-task contract reuse", () => {
    expect(evaluateExecutionAuthorization({
      taskId: 22,
      sessionId: 9,
      agentId: 3,
      mode: "enforce",
      contract: contract(),
    }).allowed).toBe(false);

    expect(evaluateExecutionAuthorization({
      taskId: 99,
      sessionId: 7,
      agentId: 3,
      mode: "enforce",
      contract: contract(),
    }).allowed).toBe(false);
  });

  it("allows the assigned operator with an active matching contract", () => {
    const result = evaluateExecutionAuthorization({
      taskId: 22,
      sessionId: 7,
      agentId: 3,
      mode: "enforce",
      contract: contract(),
    });
    expect(result.allowed).toBe(true);
    expect(result.contract?.requiredChecks).toEqual(["Backend CI"]);
  });
});
