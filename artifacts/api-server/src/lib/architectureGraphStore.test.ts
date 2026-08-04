import { describe, expect, it } from "vitest";
import { ArchitectureDigitalTwin } from "./architectureDigitalTwin";
import { buildArchitectureTwin, type SessionArchitectureInput } from "./architectureGraphStore";

function fixture(): SessionArchitectureInput {
  return {
    sessionId: 7,
    sourceRevision: "abc123",
    manifests: [
      {
        name: "@workspace/api-server",
        path: "artifacts/api-server",
        private: true,
        dependencies: { "@workspace/db": "workspace:*", express: "^5" },
      },
      {
        name: "@workspace/db",
        path: "lib/db",
        private: true,
      },
    ],
    agents: [
      { id: 4, name: "Builder", provider: "openai", role: "Implementation" },
    ],
    tasks: [
      { id: 10, title: "Update API", type: "build", status: "in_progress", assignedAgentId: 4 },
      { id: 11, title: "Review API", type: "code_review", status: "planned", assignedAgentId: null },
    ],
    contracts: [
      {
        id: 100,
        taskId: 10,
        version: 2,
        allowedPaths: ["artifacts/api-server"],
        ownedInterfaces: ["PublicApi"],
        dependencyTaskIds: [],
      },
      {
        id: 101,
        taskId: 11,
        version: 1,
        allowedPaths: ["artifacts/api-server"],
        ownedInterfaces: [],
        dependencyTaskIds: [10],
      },
    ],
    reservations: [
      { taskId: 10, resourceType: "path", resourceKey: "artifacts/api-server", status: "active" },
      { taskId: 10, resourceType: "interface", resourceKey: "PublicApi", status: "active" },
    ],
  };
}

describe("buildArchitectureTwin", () => {
  it("models workspace and external package dependencies", () => {
    const snapshot = buildArchitectureTwin(fixture());
    expect(snapshot.nodes.some((node) => node.id === "module:@workspace/api-server")).toBe(true);
    expect(snapshot.nodes.some((node) => node.id === "module:@workspace/db")).toBe(true);
    expect(snapshot.nodes.some((node) => node.id === "service:external:express")).toBe(true);
    expect(snapshot.edges).toContainEqual(expect.objectContaining({
      from: "module:@workspace/api-server",
      to: "module:@workspace/db",
      type: "depends_on",
    }));
  });

  it("models operators, contracts, reservations and task dependencies", () => {
    const snapshot = buildArchitectureTwin(fixture());
    const task = snapshot.nodes.find((node) => node.id === "task:10");
    expect(task?.metadata?.["reservedPaths"]).toEqual(["artifacts/api-server"]);
    expect(task?.metadata?.["reservedInterfaces"]).toEqual(["PublicApi"]);
    expect(snapshot.edges).toContainEqual(expect.objectContaining({
      from: "operator:4",
      to: "task:10",
      type: "owns",
    }));
    expect(snapshot.edges).toContainEqual(expect.objectContaining({
      from: "task:11",
      to: "task:10",
      type: "depends_on",
    }));
  });

  it("produces a snapshot usable by impact analysis", () => {
    const snapshot = buildArchitectureTwin(fixture());
    const report = new ArchitectureDigitalTwin(snapshot).analyzeChange({
      taskId: 11,
      changedPaths: ["artifacts/api-server/src/routes/example.ts"],
      changedInterfaces: ["PublicApi"],
      publicContractChange: true,
    });
    expect(report.conflictingTaskIds).toEqual([10]);
    expect(report.requiredReviews).toContain("api-compatibility");
    expect(report.allowed).toBe(false);
  });
});
