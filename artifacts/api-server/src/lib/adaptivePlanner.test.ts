/**
 * Unit tests for the VIBA Adaptive Planner (pure module).
 */
import { describe, it, expect } from "vitest";
import { buildAdaptivePlan, classifyRequest } from "./adaptivePlanner";

describe("classifyRequest", () => {
  it("classifies project doctor requests", () => {
    expect(classifyRequest("diagnose my GitHub repo for issues")).toBe("project_doctor");
    expect(classifyRequest("Run VIBA Doctor on leego972/viba")).toBe("project_doctor");
    expect(classifyRequest("audit the codebase health")).toBe("project_doctor");
  });

  it("classifies code repair requests", () => {
    expect(classifyRequest("fix the broken login endpoint")).toBe("code_repair");
    expect(classifyRequest("debug the crash in sessions.ts")).toBe("code_repair");
    expect(classifyRequest("patch the failing auth middleware")).toBe("code_repair");
  });

  it("classifies new build planning requests", () => {
    expect(classifyRequest("build a new dashboard component")).toBe("new_build_planning");
    expect(classifyRequest("create a REST API for user profiles")).toBe("new_build_planning");
    expect(classifyRequest("implement the proof report feature")).toBe("new_build_planning");
  });

  it("classifies research and report requests", () => {
    expect(classifyRequest("research the best JWT strategy for our app")).toBe("research_report");
    expect(classifyRequest("analyse competitor pricing models")).toBe("research_report");
    expect(classifyRequest("summarize the security vulnerabilities found")).toBe("research_report");
  });

  it("classifies business planning requests", () => {
    expect(classifyRequest("write a business plan for VIBA go-to-market")).toBe("business_planning");
    expect(classifyRequest("draft a pricing strategy and revenue model")).toBe("business_planning");
  });

  it("classifies deployment review requests", () => {
    expect(classifyRequest("review the Railway deployment config")).toBe("deployment_review");
    expect(classifyRequest("check our production deploy pipeline")).toBe("deployment_review");
  });

  it("classifies UI/UX review requests", () => {
    expect(classifyRequest("review the landing page UX and layout")).toBe("ui_ux_review");
    expect(classifyRequest("audit the mobile UI for accessibility issues")).toBe("ui_ux_review");
  });

  it("classifies launch readiness requests", () => {
    expect(classifyRequest("run a launch readiness check before we go live")).toBe("launch_readiness");
    expect(classifyRequest("pre-launch review — are we production ready?")).toBe("launch_readiness");
  });

  it("returns unknown for unrecognised requests", () => {
    expect(classifyRequest("zzzzzz nonsense xyzzy")).toBe("unknown");
  });
});

describe("buildAdaptivePlan", () => {
  it("produces a plan for every supported workflow family", () => {
    const goals = [
      "diagnose the repo health",
      "fix the broken auth bug",
      "build a new reporting feature",
      "research JWT best practices",
      "draft a business plan for VIBA",
      "review the Railway deployment",
      "review the landing page UX",
      "run launch readiness check",
    ];
    for (const goal of goals) {
      const plan = buildAdaptivePlan(goal);
      expect(plan.tasks.length).toBeGreaterThan(0);
      expect(plan.workflowFamily).not.toBe("unknown");
      expect(plan.summary).toBeTruthy();
    }
  });

  it("simple jobs produce short plans (≤ 4 tasks)", () => {
    const plan = buildAdaptivePlan("research the best JWT library");
    expect(plan.tasks.length).toBeLessThanOrEqual(4);
    expect(plan.complexity).toBe("simple");
  });

  it("complex jobs produce longer staged plans", () => {
    const plan = buildAdaptivePlan("build a new reporting feature with full QA");
    expect(plan.tasks.length).toBeGreaterThanOrEqual(5);
    expect(plan.complexity).toBeOneOf(["moderate", "complex"]);
  });

  it("sensitive/expensive steps are marked for approval", () => {
    const plan = buildAdaptivePlan("deploy to Railway production");
    const approvalSteps = plan.tasks.filter((t) => t.needsApproval);
    expect(approvalSteps.length).toBeGreaterThan(0);
    expect(plan.approvalCheckpoints.length).toBeGreaterThan(0);
  });

  it("blocking approval checkpoints exist for deployment workflows", () => {
    const plan = buildAdaptivePlan("review the production deployment pipeline");
    const blocking = plan.approvalCheckpoints.filter((c) => c.blocking);
    expect(blocking.length).toBeGreaterThan(0);
  });

  it("project doctor plan lists read-only tools only", () => {
    const plan = buildAdaptivePlan("diagnose the repo for issues");
    expect(plan.requiredTools).toContain("github.getFile");
    expect(plan.requiredTools).not.toContain("github.pushFile");
    expect(plan.requiredTools).not.toContain("github.createBranch");
  });

  it("code repair plan includes write tools but gates them behind approval", () => {
    const plan = buildAdaptivePlan("fix the broken login bug");
    expect(plan.requiredTools).toContain("github.pushFile");
    const approvalBeforeWrite = plan.approvalCheckpoints.find((c) => c.blocking);
    expect(approvalBeforeWrite).toBeDefined();
    const writeTask = plan.tasks.find((t) => t.requiredTools.includes("github.pushFile"));
    expect(writeTask).toBeDefined();
    expect(writeTask!.needsApproval).toBe(true);
  });

  it("unknown requests get a minimal clarification plan with an approval gate", () => {
    const plan = buildAdaptivePlan("zzzz xyzzy nonsense");
    expect(plan.workflowFamily).toBe("unknown");
    expect(plan.tasks.length).toBeGreaterThanOrEqual(1);
    expect(plan.approvalCheckpoints.length).toBeGreaterThan(0);
  });

  it("all tasks have sequential index starting at 1", () => {
    const plan = buildAdaptivePlan("build a new auth system");
    plan.tasks.forEach((t, i) => {
      expect(t.index).toBe(i + 1);
    });
  });

  it("plan summary contains workflow family and cost level", () => {
    const plan = buildAdaptivePlan("audit the repo health");
    expect(plan.summary).toContain("project doctor");
    expect(plan.summary).toMatch(/low|medium|high/);
  });

  it("launch readiness produces at least two blocking checkpoints", () => {
    const plan = buildAdaptivePlan("run launch readiness check before go-live");
    const blocking = plan.approvalCheckpoints.filter((c) => c.blocking);
    expect(blocking.length).toBeGreaterThanOrEqual(2);
  });

  it("research plan has no required tools", () => {
    const plan = buildAdaptivePlan("research JWT best practices");
    expect(plan.requiredTools).toHaveLength(0);
  });
});
