import { describe, expect, it } from "vitest";
import { decomposeInstruction, planInstruction } from "./instructionOrchestrator";

describe("planInstruction", () => {
  it("uses one agent call for a simple instruction", () => {
    const plan = planInstruction("Write a concise welcome message");
    expect(plan.executionMode).toBe("single_agent");
    expect(plan.estimatedAgentCalls).toBe(1);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks.some((task) => task.type === "final_qa")).toBe(false);
  });

  it("adds final synthesis only when specialist outputs must be merged", () => {
    const plan = planInstruction("Research current competitors, design the landing page, build it, and test it");
    expect(plan.executionMode).toBe("multi_agent");
    expect(plan.tasks.at(-1)?.type).toBe("final_qa");
    expect(plan.tasks.filter((task) => task.type === "final_qa")).toHaveLength(1);
  });

  it("deduplicates task types despite repeated matching keywords", () => {
    const tasks = decomposeInstruction("Build, code, implement and fix the backend API");
    expect(tasks.filter((task) => task.type === "build")).toHaveLength(1);
  });

  it("infers GitHub and deployment tool requirements", () => {
    const plan = planInstruction("Fix the GitHub repository and deploy the service to Render");
    const requirements = new Set(plan.tasks.flatMap((task) => task.toolRequirements));
    expect(requirements.has("github")).toBe(true);
    expect(requirements.has("deployment")).toBe(true);
  });

  it("uses current web research only when the instruction requires it", () => {
    const current = planInstruction("Find the latest market pricing online");
    const local = planInstruction("Write a project summary from the supplied context");
    expect(current.tasks.some((task) => task.toolRequirements.includes("web_search"))).toBe(true);
    expect(local.tasks.some((task) => task.toolRequirements.includes("web_search"))).toBe(false);
  });

  it("marks explicit multi-step work as complex", () => {
    const plan = planInstruction("First audit the repository, then fix the backend, and then deploy it to Render");
    expect(plan.complexity).toBe("complex");
  });
});
