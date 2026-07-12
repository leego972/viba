import { describe, expect, it } from "vitest";
import { getCapabilitySummary, getToolCapabilityMatrix, routeJobToToolSequence } from "./toolCapabilityMatrix";

describe("toolCapabilityMatrix", () => {
  it("marks builder tools as planning-only instead of falsely executable", () => {
    const matrix = getToolCapabilityMatrix();
    const repairPlan = matrix.find((item) => item.toolId === "builder.repair.plan");
    expect(repairPlan?.status).toBe("planning_only");
    expect(repairPlan?.canRunNow).toBe(true);
    expect(repairPlan?.truthfulClaim).toContain("structured plan");
  });

  it("marks live deploy/build tools that still need adapters as adapter-required", () => {
    const matrix = getToolCapabilityMatrix();
    const safeBuild = matrix.find((item) => item.toolId === "build.safe_build");
    const renderDeploy = matrix.find((item) => item.toolId === "render.deploy.trigger");
    expect(safeBuild?.status).toBe("adapter_required");
    expect(renderDeploy?.status).toBe("adapter_required");
    expect(renderDeploy?.missingForFullExecution.length).toBeGreaterThan(0);
  });

  it("returns truthful summary counts", () => {
    const summary = getCapabilitySummary();
    expect(summary.rawValuesReturned).toBe(false);
    expect(summary.totalTools).toBeGreaterThan(0);
    expect(summary.truthfulAdvertisingRule).toContain("not live yet");
  });

  it("routes repair jobs to diagnosis, repair plan, patch plan, tests and release gate", () => {
    const route = routeJobToToolSequence("repair broken Render build") as { sequence: string[] };
    expect(route.sequence).toEqual([
      "builder.repair.diagnose",
      "builder.repair.plan",
      "builder.patch.plan",
      "builder.test.plan",
      "builder.release.gate",
    ]);
  });
});
