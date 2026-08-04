import { describe, expect, it } from "vitest";
import type { Agent, Task } from "@workspace/db";
import { buildCoordinationPlan } from "./autonomousCoordinator";

function task(overrides: Partial<Task>): Task {
  return {
    id: 1,
    sessionId: 1,
    title: "Task",
    description: "",
    type: "planning",
    status: "planned",
    assignedAgentId: null,
    costEstimate: null,
    dependencyTaskId: null,
    blockedReason: null,
    partialWork: null,
    toolRequirements: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: 1,
    sessionId: 1,
    name: "Operator",
    provider: "openai",
    role: "strategist",
    capabilities: ["planning"],
    isMock: false,
    canUseTools: false,
    lastUsedModel: null,
    satOutReason: null,
    credentialLabel: "default",
    createdAt: new Date(0),
    ...overrides,
  };
}

describe("live coordination integration policy", () => {
  it("holds dependent work until its prerequisite completes", () => {
    const plan = buildCoordinationPlan({
      tasks: [
        task({ id: 1, status: "review" }),
        task({ id: 2, dependencyTaskId: 1 }),
        task({ id: 3 }),
      ],
      agents: [agent({ id: 7 })],
    });

    expect(plan.runnableTaskIds).toEqual([3]);
    expect(plan.blockedTaskIds).toEqual([2]);
    expect(plan.decisions).toContainEqual(expect.objectContaining({
      taskId: 2,
      type: "wait_for_dependencies",
    }));
  });

  it("recovers stalled work and assigns a capable operator", () => {
    const now = new Date("2026-08-04T12:00:00.000Z");
    const plan = buildCoordinationPlan({
      tasks: [task({
        id: 4,
        status: "in_progress",
        assignedAgentId: 2,
        updatedAt: new Date("2026-08-04T11:00:00.000Z"),
        toolRequirements: ["run_tests"],
      })],
      agents: [
        agent({ id: 2, canUseTools: false }),
        agent({ id: 9, role: "builder", capabilities: ["build"], canUseTools: true }),
      ],
      now,
      stalledAfterMs: 15 * 60_000,
    });

    expect(plan.decisions).toContainEqual(expect.objectContaining({
      taskId: 4,
      type: "recover",
      agentId: 9,
    }));
  });

  it("creates parallel batches without assigning one operator twice", () => {
    const plan = buildCoordinationPlan({
      tasks: [task({ id: 10 }), task({ id: 11 }), task({ id: 12 })],
      agents: [agent({ id: 1 }), agent({ id: 2, role: "researcher", capabilities: ["research"] })],
    });

    for (const batch of plan.parallelBatches) {
      const decisions = plan.decisions.filter((decision) => batch.includes(decision.taskId));
      const assigned = decisions.map((decision) => decision.agentId).filter((id): id is number => id !== null);
      expect(new Set(assigned).size).toBe(assigned.length);
    }
  });
});
