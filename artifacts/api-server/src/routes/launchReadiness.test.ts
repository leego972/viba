import { describe, it, expect } from "vitest";
import { runLaunchReadinessCheck, getLatestReport } from "../lib/launchReadiness";

describe("launchReadiness", () => {
  it("runs a full check and returns a report", async () => {
    const report = await runLaunchReadinessCheck();
    expect(report.id).toMatch(/^lr-/);
    expect(report.gates).toBeDefined();
    expect(report.gates.length).toBeGreaterThan(0);
    expect(report.rawValuesReturned).toBe(false);
  });

  it("report has a valid launchStatus", async () => {
    const report = await runLaunchReadinessCheck();
    expect(["not_ready", "blocked", "ready_for_private_beta", "ready_for_public_launch"]).toContain(
      report.launchStatus,
    );
  });

  it("ownerChecklist has ownerApproved field", async () => {
    const report = await runLaunchReadinessCheck();
    expect(report.ownerChecklist).toHaveProperty("ownerApproved");
    expect(report.ownerChecklist.ownerApproved).toBe(false);
  });

  it("includes payment audit findings", async () => {
    const report = await runLaunchReadinessCheck();
    expect(report.paymentAuditFindings).toBeDefined();
    expect(report.paymentAuditFindings.length).toBeGreaterThan(0);
    const text = report.paymentAuditFindings.join(" ");
    expect(text).toContain("deductCredits");
    expect(text).toContain("negative balance");
  });

  it("evidence pack never includes raw secrets", async () => {
    const report = await runLaunchReadinessCheck();
    const json = JSON.stringify(report);
    expect(json).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    expect(json).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
    expect(json).not.toMatch(/AIza[A-Za-z0-9]{30,}/);
    expect(report.rawValuesReturned).toBe(false);
  });

  it("includes agent evaluation and beta chaos in gates", async () => {
    const report = await runLaunchReadinessCheck();
    const gateIds = report.gates.map((g) => g.gate);
    expect(gateIds).toContain("agent_evaluation");
    expect(gateIds).toContain("beta_chaos");
    expect(gateIds).toContain("security");
    expect(gateIds).toContain("payments_credits");
    expect(gateIds).toContain("vault_byok");
  });

  it("getLatestReport returns the most recent report", async () => {
    const report = await runLaunchReadinessCheck();
    const latest = getLatestReport();
    expect(latest?.id).toBe(report.id);
  });
});
