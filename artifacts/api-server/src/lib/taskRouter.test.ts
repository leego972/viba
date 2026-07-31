import { describe, expect, it } from "vitest";
import type { Agent, Task } from "@workspace/db";
import { autoAssignRoles, determineTaskSequence, routeTask, routeTaskWithDecision } from "./taskRouter";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 1,
    sessionId: 1,
    name: "Agent",
    provider: "openai",
    role: "Strategist",
    capabilities: ["planning", "strategy", "reasoning"],
    isMock: false,
    canUseTools: false,
    lastUsedModel: null,
    satOutReason: null,
    credentialLabel: "default",
    createdAt: new Date(),
    ...overrides,
  } as Agent;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    sessionId: 1,
    title: "Test task",
    description: "Execute a real task",
    type: "planning",
    status: "planned",
    assignedAgentId: null,
    costEstimate: null,
    dependencyTaskId: null,
    blockedReason: null,
    partialWork: null,
    toolRequirements: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Task;
}

describe("quality-adjusted cost routing", () => {
  it("returns null when no agents are available", () => {
    expect(routeTask(makeTask(), [])).toBeNull();
  });

  it("selects the cheaper provider when both clear the quality floor", () => {
    const decision = routeTaskWithDecision(makeTask({ type: "planning" }), [
      makeAgent({ id: 1, name: "OpenAI", provider: "openai" }),
      makeAgent({ id: 2, name: "Groq", provider: "groq" }),
    ]);

    expect(decision.agent?.provider).toBe("groq");
    expect(decision.estimatedRelativeCost).toBeLessThan(1);
    expect(decision.reason).toContain("quality-adjusted cost routing");
  });

  it("rejects a cheap low-quality provider for final QA", () => {
    const finalQaCapabilities = ["final_qa", "planning", "reasoning", "code_review"];
    const decision = routeTaskWithDecision(makeTask({ type: "final_qa" }), [
      makeAgent({ id: 1, name: "Ollama", provider: "ollama", role: "Final QA", capabilities: finalQaCapabilities }),
      makeAgent({ id: 2, name: "Claude", provider: "anthropic", role: "Final QA", capabilities: finalQaCapabilities }),
    ]);

    expect(decision.agent?.provider).toBe("anthropic");
    expect(decision.qualityFloor).toBeGreaterThanOrEqual(0.85);
  });

  it("uses a tool-capable provider for build tasks", () => {
    const buildCapabilities = ["build", "code", "implementation"];
    const decision = routeTaskWithDecision(makeTask({ type: "build" }), [
      makeAgent({ id: 1, name: "Claude", provider: "anthropic", role: "Builder", capabilities: buildCapabilities, canUseTools: false }),
      makeAgent({ id: 2, name: "Mistral", provider: "mistral", role: "Builder", capabilities: buildCapabilities, canUseTools: true }),
    ]);

    expect(decision.agent?.provider).toBe("mistral");
    expect(decision.agent?.canUseTools).toBe(true);
  });

  it("selects the single available agent", () => {
    const only = makeAgent({ id: 9, provider: "groq" });
    expect(routeTask(makeTask(), [only])?.id).toBe(9);
  });
});

describe("task planning", () => {
  it("creates six ordered tasks for a normal goal", () => {
    expect(determineTaskSequence("Build an app").map((task) => task.type)).toEqual([
      "planning",
      "research",
      "creative_direction",
      "build",
      "code_review",
      "final_qa",
    ]);
  });

  it("assigns expected default roles", () => {
    const roles = autoAssignRoles(["openai", "anthropic", "mistral"]);
    expect(roles.openai).toBe("strategist");
    expect(roles.anthropic).toBe("reviewer");
    expect(roles.mistral).toBe("builder");
  });
});
