import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  fileURLToPath(new URL("./deploymentProviders.ts", import.meta.url)),
  "utf8",
);

describe("deployment provider executable-route contract", () => {
  it("advertises only the Railway actions backed by real connector functions", () => {
    expect(routeSource).toContain(
      'if (providerId === "railway") return ["env_write", "status"]',
    );
    expect(routeSource).not.toContain(
      'if (providerId === "railway") return ["deploy"',
    );
  });

  it("blocks Railway deploy instead of returning a fake accepted response", () => {
    expect(routeSource).toContain('blockedReason: "runtime_action_not_mapped"');
    expect(routeSource).not.toContain('status: "accepted"');
    expect(routeSource).not.toContain('actionEndpoint: actionRoutes');
  });

  it("executes Railway environment writes through the real connector", () => {
    expect(routeSource).toContain('if (providerId === "railway")');
    expect(routeSource).toContain('if (action === "env_write")');
    expect(routeSource).toContain("await applyRailwayVariablesViaApi(variables");
    expect(routeSource).toContain("modeUsed: result.modeUsed");
    expect(routeSource).toContain("appliedKeys: result.appliedKeys");
  });

  it("executes Railway status through the real connector", () => {
    expect(routeSource).toContain("const status = await getRailwayConnectorStatus()");
    expect(routeSource).toContain("executed: true, providerId, action, status");
  });

  it("advertises all Render actions backed by real connector functions", () => {
    expect(routeSource).toContain(
      'if (providerId === "render") return ["deploy", "env_write", "env_read", "status", "logs"]',
    );
  });

  it("executes Render deploy rather than returning routing metadata", () => {
    expect(routeSource).toContain('if (providerId === "render")');
    expect(routeSource).toContain('if (action === "deploy")');
    expect(routeSource).toContain("await triggerRenderDeploy(");
    expect(routeSource).toContain("deployId: result.deployId");
    expect(routeSource).toContain("status: result.status");
  });

  it("executes Render environment writes and returns keys only", () => {
    expect(routeSource).toContain("await applyRenderEnvVars(variables)");
    expect(routeSource).toContain("appliedKeys: result.appliedKeys");
    expect(routeSource).toContain("skippedKeys: result.skippedKeys");
    expect(routeSource).toContain("rawValuesReturned: false");
  });

  it("executes Render environment reads without returning secret values", () => {
    expect(routeSource).toContain("await getRenderEnvVarKeys()");
    expect(routeSource).toContain("keys: result.keys");
    expect(routeSource).not.toContain("values: result.values");
  });

  it("executes Render logs and status through real connector functions", () => {
    expect(routeSource).toContain("await getRenderLogs(");
    expect(routeSource).toContain("lines: result.lines");
    expect(routeSource).toContain(
      "Promise.all([getRenderConnectorStatus(), getRenderDeploys(5)])",
    );
  });

  it("enforces approval and safe-build gates before destructive execution", () => {
    const approvalGate = routeSource.indexOf(
      '["deploy", "env_write"].includes(action) && req.body?.approved !== true',
    );
    const safeBuildGate = routeSource.indexOf(
      'action === "deploy" && req.body?.safeBuildPassed !== true',
    );
    // Search for the execute-route dispatch block specifically (note the
    // trailing "{"), not the earlier executableActions() classification
    // line ('if (providerId === "render") return [...]') which shares the
    // same prefix but appears before the gates by design.
    const renderDispatch = routeSource.indexOf('if (providerId === "render") {');

    expect(approvalGate).toBeGreaterThan(-1);
    expect(safeBuildGate).toBeGreaterThan(-1);
    expect(renderDispatch).toBeGreaterThan(approvalGate);
    expect(renderDispatch).toBeGreaterThan(safeBuildGate);
  });
});
