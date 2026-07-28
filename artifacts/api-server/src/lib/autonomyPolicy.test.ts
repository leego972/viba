import { describe, expect, it } from "vitest";
import {
  buildExecutionWaves,
  createSemanticCacheKey,
  requiresExplicitApproval,
  verifyTaskCompletion,
} from "./autonomyPolicy";

describe("buildExecutionWaves", () => {
  it("runs independent work in parallel and waits for dependencies", () => {
    const waves = buildExecutionWaves([
      { id: "discover", title: "Discover", type: "research", phase: "discover" },
      { id: "build", title: "Build", type: "build", phase: "create", dependsOn: ["discover"] },
      { id: "review", title: "Review", type: "code_review", phase: "verify", dependsOn: ["build"] },
      { id: "copy", title: "Copy", type: "creative_direction", phase: "create", dependsOn: ["discover"] },
      { id: "deliver", title: "Deliver", type: "final_qa", phase: "deliver", dependsOn: ["review", "copy"] },
    ]);

    expect(waves.map((wave) => wave.map((task) => task.id))).toEqual([
      ["discover"],
      ["build", "copy"],
      ["review"],
      ["deliver"],
    ]);
  });

  it("rejects cyclic plans", () => {
    expect(() => buildExecutionWaves([
      { id: "a", title: "A", type: "build", phase: "create", dependsOn: ["b"] },
      { id: "b", title: "B", type: "build", phase: "create", dependsOn: ["a"] },
    ])).toThrow(/cycle/i);
  });
});

describe("verifyTaskCompletion", () => {
  it("does not accept a build without mutation evidence", () => {
    expect(verifyTaskCompletion(
      { type: "build", toolRequirements: ["github"] },
      { toolCalls: 1, checks: 1 },
    )).toMatchObject({ complete: false, status: "blocked" });
  });

  it("does not present dry runs as completed live work", () => {
    expect(verifyTaskCompletion(
      { type: "deployment_approval", toolRequirements: ["deployment"] },
      { toolCalls: 1, checks: 1, dryRun: true },
    )).toMatchObject({ complete: false, status: "dry_run" });
  });

  it("accepts a verified repository mutation", () => {
    expect(verifyTaskCompletion(
      { type: "build", toolRequirements: ["github"] },
      { toolCalls: 2, mutations: 1, checks: 1, fileChanges: ["src/a.ts"] },
    )).toEqual({ complete: true, status: "completed", reasons: [] });
  });
});

describe("cache and approval policy", () => {
  it("creates stable cache keys", () => {
    const input = { projectId: 7, commit: "abc", taskType: "research", toolInputs: { q: "x" } };
    expect(createSemanticCacheKey(input)).toBe(createSemanticCacheKey(input));
  });

  it("requires approval for external or destructive writes", () => {
    expect(requiresExplicitApproval("dns_write")).toBe(true);
    expect(requiresExplicitApproval("send email")).toBe(true);
    expect(requiresExplicitApproval("read deployment status")).toBe(false);
  });
});
