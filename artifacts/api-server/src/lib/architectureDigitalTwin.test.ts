import { describe, expect, it } from "vitest";
import { ArchitectureDigitalTwin } from "./architectureDigitalTwin";

function buildTwin(): ArchitectureDigitalTwin {
  const twin = new ArchitectureDigitalTwin();
  twin.upsertNode({ id: "module:api", type: "module", label: "API", paths: ["artifacts/api-server/src"] });
  twin.upsertNode({ id: "module:db", type: "module", label: "Database", paths: ["lib/db/src"] });
  twin.upsertNode({ id: "interface:task-contract", type: "interface", label: "TaskContract", paths: ["artifacts/api-server/src/lib/orchestrationGovernance.ts"] });
  twin.upsertNode({ id: "service:governance", type: "service", label: "Governance", paths: ["artifacts/api-server/src/lib/governanceStore.ts"] });
  twin.upsertNode({
    id: "task:44",
    type: "task",
    label: "Active integration task",
    paths: [],
    metadata: { taskId: 44, reservedPaths: ["lib/db/src/schema"], reservedInterfaces: ["TaskContract"] },
  });
  twin.upsertEdge({ from: "service:governance", to: "interface:task-contract", type: "implements" });
  twin.upsertEdge({ from: "service:governance", to: "module:db", type: "depends_on" });
  twin.upsertEdge({ from: "module:api", to: "service:governance", type: "depends_on" });
  return twin;
}

describe("ArchitectureDigitalTwin", () => {
  it("propagates impact through architecture relations", () => {
    const report = buildTwin().analyzeChange({
      taskId: 7,
      changedPaths: ["artifacts/api-server/src/lib/governanceStore.ts"],
      changedInterfaces: [],
    });

    expect(report.affectedModules).toEqual(["module:api", "module:db"]);
    expect(report.impactedNodes.some((node) => node.nodeId === "interface:task-contract")).toBe(true);
    expect(report.riskScore).toBeGreaterThan(0);
  });

  it("blocks an active path reservation conflict", () => {
    const report = buildTwin().analyzeChange({
      taskId: 8,
      changedPaths: ["lib/db/src/schema/governance.ts"],
      changedInterfaces: [],
    });

    expect(report.conflictingTaskIds).toEqual([44]);
    expect(report.allowed).toBe(false);
    expect(report.riskLevel).not.toBe("low");
  });

  it("detects an interface reservation conflict", () => {
    const report = buildTwin().analyzeChange({
      taskId: 8,
      changedPaths: [],
      changedInterfaces: ["TaskContract"],
    });

    expect(report.conflictingTaskIds).toEqual([44]);
    expect(report.requiredReviews).toContain("integration");
  });

  it("requires specialist reviews for destructive public changes", () => {
    const report = buildTwin().analyzeChange({
      taskId: 44,
      changedPaths: ["lib/db/src/schema/governance.ts"],
      changedInterfaces: ["TaskContract"],
      destructiveMigration: true,
      publicContractChange: true,
      dependencyChanges: [{ from: "module:api", to: "module:db", operation: "add" }],
      estimatedMonthlyCostDelta: 100,
    });

    expect(report.requiredReviews).toEqual(expect.arrayContaining([
      "api-compatibility",
      "architecture",
      "cost",
      "database",
      "independent-qa",
      "integration",
      "security",
    ]));
    expect(report.riskLevel).toBe("critical");
    expect(report.allowed).toBe(false);
  });

  it("round-trips a snapshot without duplicating edges", () => {
    const original = buildTwin();
    const restored = new ArchitectureDigitalTwin(original.snapshot());

    expect(restored.snapshot().nodes).toHaveLength(original.snapshot().nodes.length);
    expect(restored.snapshot().edges).toHaveLength(original.snapshot().edges.length);
  });
});
