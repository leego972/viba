import { describe, it, expect } from "vitest";
import { routeTask, determineTaskSequence, autoAssignRoles } from "./taskRouter";
import type { Agent, Task } from "@workspace/db";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 1,
    sessionId: 1,
    name: "TestAgent",
    provider: "openai",
    role: "Strategist",
    capabilities: ["planning", "strategy"],
    isMock: false,
    canUseTools: false,
    lastUsedModel: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    sessionId: 1,
    title: "Test Task",
    description: "Do something",
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
  };
}

describe("routeTask", () => {
  it("returns null for empty agents list", () => {
    expect(routeTask(makeTask(), [])).toBeNull();
  });

  it("assigns task to the only available agent", () => {
    const agent = makeAgent({ id: 1, name: "Solo" });
    expect(routeTask(makeTask(), [agent])).toBe(agent);
  });

  it("routes planning tasks to Strategist via role affinity", () => {
    const strategist = makeAgent({ id: 1, role: "Strategist", capabilities: [] });
    const builder = makeAgent({ id: 2, role: "Builder", capabilities: [] });
    const result = routeTask(makeTask({ type: "planning" }), [strategist, builder]);
    expect(result?.id).toBe(1);
  });

  it("routes research tasks to Researcher via role affinity", () => {
    const researcher = makeAgent({ id: 1, role: "Researcher", capabilities: [] });
    const strategist = makeAgent({ id: 2, role: "Strategist", capabilities: [] });
    const result = routeTask(makeTask({ type: "research" }), [researcher, strategist]);
    expect(result?.id).toBe(1);
  });

  it("routes build tasks to Builder via role affinity (no tool-capable agents present)", () => {
    const builder = makeAgent({ id: 1, role: "Builder", capabilities: [], canUseTools: false });
    const researcher = makeAgent({ id: 2, role: "Researcher", capabilities: [], canUseTools: false });
    const result = routeTask(makeTask({ type: "build" }), [builder, researcher]);
    expect(result?.id).toBe(1);
  });

  it("routes build tasks to tool-capable agent over non-tool Builder by score", () => {
    const toolBuilder = makeAgent({ id: 1, role: "Builder", capabilities: ["build", "code"], canUseTools: true });
    const textBuilder = makeAgent({ id: 2, role: "Builder", capabilities: ["build", "code"], canUseTools: false });
    const result = routeTask(makeTask({ type: "build" }), [textBuilder, toolBuilder]);
    // toolBuilder gets +5 bonus for canUseTools on a requiresTools task
    expect(result?.id).toBe(1);
  });

  it("only uses tool-capable pool when tool agents are available for requiresTools tasks", () => {
    const replit = makeAgent({ id: 1, name: "Replit", provider: "replit", role: "Builder", capabilities: ["build"], canUseTools: true });
    const gpt = makeAgent({ id: 2, name: "ChatGPT", provider: "openai", role: "Strategist", capabilities: [], canUseTools: false });
    const result = routeTask(makeTask({ type: "build" }), [gpt, replit]);
    expect(result?.id).toBe(1);
  });

  it("falls back to full pool when no tool-capable agents exist for requiresTools task", () => {
    const gpt = makeAgent({ id: 2, name: "ChatGPT", provider: "openai", role: "Builder", capabilities: ["build"], canUseTools: false });
    const result = routeTask(makeTask({ type: "build" }), [gpt]);
    expect(result?.id).toBe(2);
  });

  it("task with explicit toolRequirements prefers tool-capable agents", () => {
    const replit = makeAgent({ id: 1, provider: "replit", role: "Builder", capabilities: ["build"], canUseTools: true });
    const gpt = makeAgent({ id: 2, provider: "openai", role: "Builder", capabilities: ["build"], canUseTools: false });
    const task = makeTask({ type: "build", toolRequirements: ["git_clone", "run_tests"] });
    const result = routeTask(task, [gpt, replit]);
    expect(result?.id).toBe(1);
  });

  it("routes code_review tasks to Code Reviewer role", () => {
    const reviewer = makeAgent({ id: 1, role: "Code Reviewer", capabilities: [] });
    const builder = makeAgent({ id: 2, role: "Builder", capabilities: [] });
    const result = routeTask(makeTask({ type: "code_review" }), [reviewer, builder]);
    expect(result?.id).toBe(1);
  });

  it("routes by capability match when role affinity is absent", () => {
    const capable = makeAgent({ id: 1, role: "Unknown", capabilities: ["code_review", "logic_critique"] });
    const incapable = makeAgent({ id: 2, role: "Unknown2", capabilities: [] });
    const result = routeTask(makeTask({ type: "code_review" }), [capable, incapable]);
    expect(result?.id).toBe(1);
  });

  it("prefers agent with both capability match and role affinity (highest combined score)", () => {
    const wellMatched = makeAgent({ id: 1, role: "Researcher", capabilities: ["research", "research_summary"] });
    const partial = makeAgent({ id: 2, role: "Unknown", capabilities: ["research"] });
    const result = routeTask(makeTask({ type: "research" }), [wellMatched, partial]);
    expect(result?.id).toBe(1);
  });

  it("falls back to round-robin by task.id when no agent has capability or affinity", () => {
    const agents = [
      makeAgent({ id: 1, role: "Unknown", capabilities: [] }),
      makeAgent({ id: 2, role: "Unknown2", capabilities: [] }),
      makeAgent({ id: 3, role: "Unknown3", capabilities: [] }),
    ];
    const t = (id: number) => makeTask({ id, type: "nonexistent_type" });
    expect(routeTask(t(0), agents)?.id).toBe(1);
    expect(routeTask(t(1), agents)?.id).toBe(2);
    expect(routeTask(t(2), agents)?.id).toBe(3);
    expect(routeTask(t(3), agents)?.id).toBe(1);
  });

  it("final_qa routes to Final QA role", () => {
    const qa = makeAgent({ id: 1, role: "Final QA", capabilities: [] });
    const builder = makeAgent({ id: 2, role: "Builder", capabilities: [] });
    const result = routeTask(makeTask({ type: "final_qa" }), [qa, builder]);
    expect(result?.id).toBe(1);
  });

  it("ux_review routes to UX Reviewer role", () => {
    const ux = makeAgent({ id: 1, role: "UX Reviewer", capabilities: [] });
    const builder = makeAgent({ id: 2, role: "Builder", capabilities: [] });
    const result = routeTask(makeTask({ type: "ux_review" }), [ux, builder]);
    expect(result?.id).toBe(1);
  });
});

describe("determineTaskSequence", () => {
  it("returns exactly 6 tasks", () => {
    expect(determineTaskSequence("Build a todo app")).toHaveLength(6);
  });

  it("tasks are in the correct order", () => {
    const tasks = determineTaskSequence("test project");
    const types = tasks.map((t) => t.type);
    expect(types).toEqual([
      "planning",
      "research",
      "creative_direction",
      "build",
      "code_review",
      "final_qa",
    ]);
  });

  it("includes the project goal in every task description", () => {
    const goal = "Build an e-commerce platform";
    const tasks = determineTaskSequence(goal);
    for (const task of tasks) {
      expect(task.description).toContain(goal);
    }
  });

  it("all tasks have non-empty titles", () => {
    const tasks = determineTaskSequence("any goal");
    for (const task of tasks) {
      expect(task.title.trim().length).toBeGreaterThan(0);
    }
  });

  it("all tasks have a non-empty type", () => {
    const tasks = determineTaskSequence("any goal");
    for (const task of tasks) {
      expect(task.type.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("autoAssignRoles", () => {
  it("returns empty object for empty input", () => {
    expect(autoAssignRoles([])).toEqual({});
  });

  it("assigns strategist to openai", () => {
    expect(autoAssignRoles(["openai"])["openai"]).toBe("strategist");
  });

  it("assigns reviewer to anthropic", () => {
    expect(autoAssignRoles(["anthropic"])["anthropic"]).toBe("reviewer");
  });

  it("assigns builder to replit", () => {
    expect(autoAssignRoles(["replit"])["replit"]).toBe("builder");
  });

  it("assigns researcher to manus", () => {
    expect(autoAssignRoles(["manus"])["manus"]).toBe("researcher");
  });

  it("assigns researcher to perplexity", () => {
    expect(autoAssignRoles(["perplexity"])["perplexity"]).toBe("researcher");
  });

  it("handles role conflict — second provider gets a different role from queue", () => {
    const result = autoAssignRoles(["openai", "unknown-provider"]);
    expect(result["openai"]).toBe("strategist");
    expect(result["unknown-provider"]).not.toBe("strategist");
  });

  it("assigns a role to every provider in a full team", () => {
    const providers = ["openai", "anthropic", "manus", "replit", "google", "perplexity"];
    const result = autoAssignRoles(providers);
    for (const p of providers) {
      expect(result[p]).toBeDefined();
      expect(typeof result[p]).toBe("string");
    }
  });

  it("falls back to qa when role queue is exhausted", () => {
    const providers = ["openai", "anthropic", "manus", "replit", "google", "perplexity"];
    const result = autoAssignRoles(providers);
    expect(result["perplexity"]).toBe("qa");
  });

  it("is case-insensitive for provider lookup", () => {
    const result = autoAssignRoles(["OpenAI"]);
    expect(result["OpenAI"]).toBe("strategist");
  });
});
