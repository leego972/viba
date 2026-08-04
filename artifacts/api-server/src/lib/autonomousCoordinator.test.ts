import { describe, expect, it } from "vitest";
import type { Agent, Task } from "@workspace/db";
import { buildCoordinationPlan, selectBestAgent } from "./autonomousCoordinator";

function task(id: number, overrides: Partial<Task> = {}): Task {
  const now = new Date("2026-08-04T10:00:00.000Z");
  return {
    id,
    sessionId: 1,
    title: `Task ${id}`,
    description: "Implement API integration",
    type: "build",
    status: "planned",
    assignedAgentId: null,
    costEstimate: null,
    dependencyTaskId: null,
    blockedReason: null,
    partialWork: null,
    toolRequirements: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function agent(id: number, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    sessionId: 1,
    name: `Agent ${id}`,
    provider: "openai",
    role: "API implementation engineer",
    capabilities: ["api", "typescript", "testing"],
    isMock: false,
    canUseTools: false,
    lastUsedModel: null,
    satOutReason: null,
    credentialLabel: "default",
    createdAt: new Date("2026-08-04T10:00:00.000Z"),
    ...overrides,
  };
}

describe("autonomous coordinator", () => {
  it("waits for incomplete dependencies", () => {
    const plan = buildCoordinationPlan({
      tasks: [task(1, { status: "in_progress" }), task(2, { dependencyTaskId: 1 })],
      agents: [agent(1)],
    });
    expect(plan.runnableTaskIds).toEqual([]);
    expect(plan.blockedTaskIds).toContain(2);
    expect(plan.decisions.find((decision) => decision.taskId === 2)?.type).toBe("wait_for_dependencies");
  });

  it("routes tool work only to a tool-capable operator", () => {
    const work = task(1, { toolRequirements: ["git_clone", "run_tests"] });
    const selection = selectBestAgent(work, [agent(1), agent(2, { canUseTools: true, role: "Repository execution engineer" })]);
    expect(selection.agent?.id).toBe(2);
  });

  it("uses measured reliability to choose between equally capable workers", () => {
    const selection = selectBestAgent(
      task(1),
      [agent(1), agent(2)],
      new Map([[1, 35], [2, 92]]),
    );
    expect(selection.agent?.id).toBe(2);
    expect(selection.reasons.join(" ")).toContain("92.0%");
  });

  it("does not allow reliability to override required tool capability", () => {
    const selection = selectBestAgent(
      task(1, { toolRequirements: ["run_tests"] }),
      [agent(1, { canUseTools: false }), agent(2, { canUseTools: true })],
      new Map([[1, 100], [2, 20]]),
    );
    expect(selection.agent?.id).toBe(2);
  });

  it("creates parallel-safe batches across different operators", () => {
    const plan = buildCoordinationPlan({
      tasks: [task(1, { assignedAgentId: 1 }), task(2, { assignedAgentId: 2 }), task(3, { dependencyTaskId: 1 })],
      agents: [agent(1), agent(2)],
    });
    expect(plan.parallelBatches[0]).toEqual(expect.arrayContaining([1, 2]));
    expect(plan.blockedTaskIds).toContain(3);
  });

  it("proposes recovery for a stalled task", () => {
    const plan = buildCoordinationPlan({
      tasks: [task(1, { status: "in_progress", assignedAgentId: 1, updatedAt: new Date("2026-08-04T09:00:00.000Z") })],
      agents: [agent(1), agent(2)],
      now: new Date("2026-08-04T10:00:00.000Z"),
      stalledAfterMs: 10 * 60_000,
    });
    expect(plan.decisions[0]?.type).toBe("recover");
    expect(plan.decisions[0]?.taskId).toBe(1);
  });

  it("does not select an operator that sat out", () => {
    const selection = selectBestAgent(task(1), [agent(1, { satOutReason: "Safety concern" }), agent(2)]);
    expect(selection.agent?.id).toBe(2);
  });
});
