import { describe, expect, it } from "vitest";
import type { ArchitectureTwinSnapshot } from "./architectureDigitalTwin";
import { evaluateArchitectureImpact, mergeImpactWithProposalAssessment } from "./architectureImpactGate";

const snapshot: ArchitectureTwinSnapshot = {
  version: 3,
  generatedAt: new Date(0).toISOString(),
  nodes: [
    { id: "module:api", type: "module", label: "API", paths: ["artifacts/api-server"] },
    {
      id: "task:1",
      type: "task",
      label: "Active API task",
      paths: ["artifacts/api-server"],
      metadata: {
        taskId: 1,
        reservedPaths: ["artifacts/api-server"],
        reservedInterfaces: ["PublicApi"],
      },
    },
    { id: "interface:PublicApi", type: "interface", label: "PublicApi", paths: [] },
  ],
  edges: [
    { from: "task:1", to: "module:api", type: "affects" },
    { from: "task:1", to: "interface:PublicApi", type: "implements" },
  ],
};

describe("architecture impact gate", () => {
  it("defers work that collides with an active reservation", () => {
    const decision = evaluateArchitectureImpact(snapshot, {
      taskId: 2,
      changedPaths: ["artifacts/api-server/src/routes/new.ts"],
      changedInterfaces: [],
    });
    expect(decision.action).toBe("defer");
    expect(decision.allowed).toBe(false);
    expect(decision.report.conflictingTaskIds).toEqual([1]);
  });

  it("adds specialist review conditions for public contract changes", () => {
    const freeSnapshot: ArchitectureTwinSnapshot = {
      ...snapshot,
      nodes: snapshot.nodes.filter((node) => node.id !== "task:1"),
      edges: [],
    };
    const decision = evaluateArchitectureImpact(freeSnapshot, {
      taskId: 2,
      changedPaths: ["artifacts/api-server/src/routes/new.ts"],
      changedInterfaces: ["PublicApi"],
      publicContractChange: true,
    });
    expect(decision.action).toBe("approve_with_conditions");
    expect(decision.conditions.some((condition) => condition.includes("api-compatibility"))).toBe(true);
  });

  it("upgrades a normal proposal assessment when the twin requires review", () => {
    const freeSnapshot: ArchitectureTwinSnapshot = {
      ...snapshot,
      nodes: snapshot.nodes.filter((node) => node.id !== "task:1"),
      edges: [],
    };
    const impact = evaluateArchitectureImpact(freeSnapshot, {
      taskId: 2,
      changedPaths: ["artifacts/api-server"],
      changedInterfaces: ["PublicApi"],
      publicContractChange: true,
    });
    const combined = mergeImpactWithProposalAssessment({
      decision: "approved",
      reasons: ["No reservation conflict."],
      conflictingTaskIds: [],
      conditions: [],
      updatedAllowedPaths: ["artifacts/api-server"],
      updatedOwnedInterfaces: ["PublicApi"],
    }, impact);
    expect(combined.decision).toBe("approved_with_conditions");
    expect(combined.conditions.length).toBeGreaterThan(0);
  });
});
