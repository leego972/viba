import { describe, expect, it } from "vitest";
import { executeBuilderToolAction, getAllBuilderTools, getBuilderToolById } from "./builderToolbox";

describe("builderToolbox", () => {
  it("registers builder tools for build, design, repair, upgrade, test and release workflows", () => {
    const ids = getAllBuilderTools().map((tool) => tool.toolId);
    expect(ids).toContain("builder.project.blueprint");
    expect(ids).toContain("builder.feature.plan");
    expect(ids).toContain("builder.design.review");
    expect(ids).toContain("builder.repair.diagnose");
    expect(ids).toContain("builder.repair.plan");
    expect(ids).toContain("builder.upgrade.plan");
    expect(ids).toContain("builder.test.plan");
    expect(ids).toContain("builder.release.gate");
    expect(ids).toContain("builder.coding_agent.prompt");
  });

  it("does not mark builder planning tools as returning raw values", () => {
    for (const tool of getAllBuilderTools()) {
      expect(tool.outputsSecretValues).toBe(false);
      expect(tool.permissionsRequired).toContain("login_required");
    }
  });

  it("returns a structured repair diagnosis", () => {
    const result = executeBuilderToolAction("builder.repair.diagnose", "diagnose", {
      projectName: "VIBA",
      goal: "Fix Render build",
      knownErrors: ["Cannot find module", "health check failed"],
    });

    expect(result?.handled).toBe(true);
    expect(result?.result.rawValuesReturned).toBe(false);
    expect(result?.result.mutationPerformed).toBe(false);
    expect(result?.result.output).toBeTruthy();
  });

  it("generates a coding-agent prompt with branch and proof rules", () => {
    const result = executeBuilderToolAction("builder.coding_agent.prompt", "generate", {
      goal: "Add deployment logs page",
    });
    const output = result?.result.output as { prompt?: string };
    expect(output.prompt).toContain("new branch");
    expect(output.prompt).toContain("Do not commit directly to main");
    expect(output.prompt).toContain("evidence report");
  });

  it("returns undefined for unknown builder tool ids", () => {
    expect(getBuilderToolById("builder.unknown")).toBeUndefined();
    expect(executeBuilderToolAction("builder.unknown", "run", {})).toBeNull();
  });
});
