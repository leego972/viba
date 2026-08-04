import { describe, expect, it } from "vitest";
import {
  assessImprovementProposal,
  findReservationConflicts,
  issueContractRevision,
  validateTaskScope,
  type TaskContract,
} from "./orchestrationGovernance";

const contract: TaskContract = {
  id: "contract-1",
  version: 1,
  sessionId: 1,
  taskId: 10,
  objective: "Integrate the rate limiter",
  assignedAgentId: 7,
  allowedPaths: ["artifacts/api-server/src/rate-limit"],
  forbiddenPaths: ["artifacts/bridge-ai", "deployment"],
  ownedInterfaces: ["RateLimitService"],
  dependencies: [],
  requiredChecks: ["backend-ci"],
  maxEstimatedCost: 100,
};

describe("task-contract scope enforcement", () => {
  it("accepts changes contained by allowed paths", () => {
    expect(validateTaskScope(contract, ["artifacts/api-server/src/rate-limit/index.ts"])).toEqual({
      allowed: true,
      violations: [],
    });
  });

  it("rejects unrelated and forbidden changes", () => {
    const result = validateTaskScope(contract, [
      "artifacts/bridge-ai/src/App.tsx",
      "artifacts/api-server/src/auth/index.ts",
    ]);
    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(2);
  });
});

describe("operator proposal approval", () => {
  it("defers a proposal that conflicts with another active operator", () => {
    const conflicts = findReservationConflicts(
      ["artifacts/api-server/src/rate-limit"],
      ["RateLimitService"],
      [{ contractId: "other", taskId: 22, agentId: 8, paths: ["artifacts/api-server/src/rate-limit/store"], interfaces: [] }],
      10,
    );
    expect(conflicts).toEqual([22]);
  });

  it("approves a non-conflicting cost-saving proposal and revises the contract", () => {
    const assessment = assessImprovementProposal({
      contract,
      reservations: [],
      approvedDependencies: new Set(["redis"]),
      proposal: {
        id: "proposal-1",
        contractId: contract.id,
        taskId: contract.taskId,
        proposedByAgentId: contract.assignedAgentId,
        type: "cost",
        summary: "Use a shared Redis-backed limiter",
        rationale: "Avoid inconsistent per-instance limits",
        requestedPaths: ["artifacts/api-server/src/config/redis.ts"],
        affectedInterfaces: ["RateLimitStore"],
        requestedDependencies: ["redis"],
        estimatedImplementationCost: 20,
        estimatedMonthlyCostDelta: -15,
        estimatedSavingsPercent: 18,
        risk: "medium",
      },
    });

    expect(assessment.decision).toBe("approved");
    const revised = issueContractRevision(contract, assessment);
    expect(revised.version).toBe(2);
    expect(revised.allowedPaths).toContain("artifacts/api-server/src/config/redis.ts");
    expect(revised.ownedInterfaces).toContain("RateLimitStore");
  });
});
