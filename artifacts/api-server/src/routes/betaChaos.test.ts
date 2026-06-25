import { describe, it, expect } from "vitest";
import { runChaosTest, getChaosRun, listChaosRuns } from "../lib/betaChaos";

describe("betaChaos", () => {
  it("runs all 20 chaos categories", () => {
    const run = runChaosTest();
    expect(run.results).toHaveLength(20);
    expect(run.status).toBe("completed");
    expect(run.rawValuesReturned).toBe(false);
  });

  it("returns summary with correct totals", () => {
    const run = runChaosTest();
    const { total, passed, failed } = run.summary;
    expect(total).toBe(20);
    expect(passed + failed).toBe(total);
  });

  it("unsafe zip check passes (mitigation in place)", () => {
    const run = runChaosTest(["unsafe_uploaded_zip"]);
    const result = run.results.find((r) => r.category === "unsafe_uploaded_zip");
    expect(result?.pass).toBe(true);
  });

  it("bypass_approval_attempt check passes", () => {
    const run = runChaosTest(["bypass_approval_attempt"]);
    const result = run.results.find((r) => r.category === "bypass_approval_attempt");
    expect(result?.pass).toBe(true);
  });

  it("deployment_placeholder does not execute", () => {
    const run = runChaosTest(["deployment_provider_placeholder"]);
    const result = run.results.find((r) => r.category === "deployment_provider_placeholder");
    expect(result?.pass).toBe(true);
  });

  it("duplicate_webhook is handled", () => {
    const run = runChaosTest(["duplicate_webhook"]);
    const result = run.results.find((r) => r.category === "duplicate_webhook");
    expect(result?.pass).toBe(true);
  });

  it("prompt injection is flagged", () => {
    const run = runChaosTest(["prompt_injection_readme"]);
    const result = run.results.find((r) => r.category === "prompt_injection_readme");
    expect(result?.pass).toBe(true);
  });

  it("persist and retrieve run by id", () => {
    const run = runChaosTest();
    const retrieved = getChaosRun(run.id);
    expect(retrieved?.id).toBe(run.id);
  });

  it("lists runs", () => {
    runChaosTest();
    const runs = listChaosRuns();
    expect(runs.length).toBeGreaterThan(0);
  });

  it("never returns raw secret values", () => {
    const run = runChaosTest();
    const json = JSON.stringify(run);
    expect(json).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    expect(json).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
  });
});
