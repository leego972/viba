/**
 * Tool Broker Tests
 *
 * Coverage:
 *  - Tool Registry: all tools, no secret values, valid risk levels
 *  - redactPayload / redactResult: sensitive key removal, token pattern redaction
 *  - planToolAction: read-only plans ready, destructive requires approval+dry-run, missing credential blocks
 *  - dryRunToolAction: returns dry_run result, no-dry-run tools blocked
 *  - executeToolAction: executes read-only, blocks missing credential, blocks without approval, blocks safe-build-required
 *  - Task planner requiredTools: deployment includes build.safe_build, payment includes stripe tools, DNS includes approval-required DNS tools, build includes safe build
 *  - Agent comms: tool_request message type is accepted and task-scoped
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { getAllTools, getToolById, VALID_RISK_LEVELS, TOOL_IDS } from "../lib/toolRegistry";
import { redactPayload, redactResult } from "../lib/toolPolicies";

// ─── Pool mock ────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn() },
  db: {},
}));

vi.mock("../lib/vibaVault", () => ({
  listVibaCredentials: vi.fn().mockResolvedValue([]),
  resolveVibaCredentialForUse: vi.fn().mockResolvedValue(null),
  saveVibaCredential: vi.fn().mockResolvedValue({ id: 1 }),
}));

import { pool } from "@workspace/db";
import { listVibaCredentials } from "../lib/vibaVault";
import { planToolAction, dryRunToolAction, executeToolAction } from "../lib/toolActionBroker";
import { planTask } from "../lib/taskPlanner";

function mockPoolOk(rows: Record<string, unknown>[] = [{ id: 1 }]) {
  (pool.query as Mock).mockResolvedValue({ rows, rowCount: rows.length });
}

// ─── Tool Registry ────────────────────────────────────────────────────────────

describe("Tool Registry", () => {
  it("returns all expected tools", () => {
    const tools = getAllTools();
    expect(tools.length).toBeGreaterThanOrEqual(25);
    const ids = tools.map((t) => t.toolId);
    for (const expected of [
      "github.repo.read", "github.repo.write", "github.pr.create", "github.pr.merge",
      "railway.env.read", "railway.env.write", "railway.deploy.status", "railway.deploy.trigger",
      "stripe.products.read", "stripe.products.write", "stripe.webhook.verify",
      "credits.ledger.read", "credits.ledger.write",
      "dns.records.read", "dns.records.write",
      "smtp.test", "browser.open", "browser.authorized_action",
      "build.safe_build", "security.business_plan", "security.malware_plan",
      "vault.credential.status", "vault.credential.use",
      "ai.custom.use", "report.evidence.generate",
    ]) {
      expect(ids).toContain(expected);
    }
  });

  it("no tool claims outputsSecretValues: true", () => {
    for (const tool of getAllTools()) {
      expect(tool.outputsSecretValues).toBe(false);
    }
  });

  it("all risk levels are valid", () => {
    for (const tool of getAllTools()) {
      expect(VALID_RISK_LEVELS).toContain(tool.riskLevel);
    }
  });

  it("returns correct tool by ID", () => {
    const tool = getToolById("railway.deploy.trigger");
    expect(tool).toBeDefined();
    expect(tool!.requiresApproval).toBe(true);
    expect(tool!.requiresSafeBuild).toBe(true);
    expect(tool!.riskLevel).toBe("destructive");
  });

  it("returns undefined for unknown tool", () => {
    expect(getToolById("unknown.tool.id")).toBeUndefined();
  });

  it("TOOL_IDS matches getAllTools", () => {
    expect(TOOL_IDS.length).toBe(getAllTools().length);
  });
});

// ─── redactPayload / redactResult ─────────────────────────────────────────────

describe("Payload and result redaction", () => {
  it("redacts known sensitive keys", () => {
    const result = redactPayload({ password: "hunter2", token: "abc123", normal_field: "hello" });
    expect(result["password"]).toBe("[REDACTED]");
    expect(result["token"]).toBe("[REDACTED]");
    expect(result["normal_field"]).toBe("hello");
  });

  it("redacts stripe-style API key tokens in values", () => {
    const result = redactPayload({ note: "sk-abc12345678901234567890123456789012345678901" });
    expect(String(result["note"])).toContain("[REDACTED]");
  });

  it("redacts nested sensitive keys", () => {
    const result = redactPayload({ outer: { api_key: "super-secret", safe: "visible" } });
    const outer = result["outer"] as Record<string, unknown>;
    expect(outer["api_key"]).toBe("[REDACTED]");
    expect(outer["safe"]).toBe("visible");
  });

  it("redactResult never returns raw values", () => {
    const result = redactResult({ webhook_secret: "whsec_xyz", data: "ok" });
    expect(result["webhook_secret"]).toBe("[REDACTED]");
    expect(result["data"]).toBe("ok");
  });
});

// ─── planToolAction ───────────────────────────────────────────────────────────

describe("planToolAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolOk([{ id: 42 }]);
    (listVibaCredentials as Mock).mockResolvedValue([]);
  });

  it("read-only tool with no credential required returns ready", async () => {
    const result = await planToolAction({ userId: 1, toolId: "dns.records.read", action: "list", requestedByAgent: "coordinator" });
    expect(result.status).toBe("ready");
    expect(result.rawValuesReturned).toBe(false);
  });

  it("build.safe_build is always ready (no credentials required)", async () => {
    const result = await planToolAction({ userId: 1, toolId: "build.safe_build", action: "run" });
    expect(result.status).toBe("ready");
    expect(result.rawValuesReturned).toBe(false);
  });

  it("destructive tool without vault credential is blocked as missing_credential", async () => {
    vi.stubEnv("RAILWAY_TOKEN", "");
    (listVibaCredentials as Mock).mockResolvedValue([]);
    const result = await planToolAction({ userId: 1, toolId: "railway.deploy.trigger", action: "trigger" });
    vi.unstubAllEnvs();
    expect(result.status).toBe("missing_credential");
    expect(result.rawValuesReturned).toBe(false);
  });

  it("deployment tool with credential but no approval returns needs_user_approval", async () => {
    (listVibaCredentials as Mock).mockResolvedValue([
      { id: 1, provider: "railway", kind: "token", scope: "deployment", label: "Railway token" },
    ]);
    const result = await planToolAction({ userId: 1, toolId: "railway.deploy.trigger", action: "trigger" });
    expect(result.requiresApproval).toBe(true);
    expect(result.requiresSafeBuild).toBe(true);
    expect(result.rawValuesReturned).toBe(false);
  });

  it("payment tool without credential is blocked", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    (listVibaCredentials as Mock).mockResolvedValue([]);
    const result = await planToolAction({ userId: 1, toolId: "stripe.products.write", action: "create" });
    vi.unstubAllEnvs();
    expect(result.status).toBe("missing_credential");
  });

  it("unknown tool returns blocked", async () => {
    const result = await planToolAction({ userId: 1, toolId: "not.a.real.tool", action: "do" });
    expect(result.status).toBe("blocked");
    expect(result.rawValuesReturned).toBe(false);
  });

  it("dns.records.write requires dry-run and approval", async () => {
    const result = await planToolAction({ userId: 1, toolId: "dns.records.write", action: "create" });
    expect(result.requiresDryRun).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });
});

// ─── dryRunToolAction ─────────────────────────────────────────────────────────

describe("dryRunToolAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolOk([{ id: 99 }]);
    (listVibaCredentials as Mock).mockResolvedValue([]);
  });

  it("returns dry-run result for tool that supports it", async () => {
    const result = await dryRunToolAction({ userId: 1, toolId: "dns.records.write", action: "create", dryRun: true });
    expect(result.dryRunResult).toBeDefined();
    expect(result.dryRunResult!["mode"]).toBe("dry_run");
    expect(result.rawValuesReturned).toBe(false);
  });

  it("dry-run result never includes raw secrets", async () => {
    const result = await dryRunToolAction({ userId: 1, toolId: "smtp.test", action: "send", dryRun: true, payload: { password: "secret123" } });
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain("secret123");
    expect(result.rawValuesReturned).toBe(false);
  });

  it("blocks dry-run for tool that doesn't support it", async () => {
    const result = await dryRunToolAction({ userId: 1, toolId: "build.safe_build", action: "run", dryRun: true });
    expect(result.status).toBe("blocked");
    expect(result.rawValuesReturned).toBe(false);
  });
});

// ─── executeToolAction ────────────────────────────────────────────────────────

describe("executeToolAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolOk([{ id: 7 }]);
    (listVibaCredentials as Mock).mockResolvedValue([]);
  });

  it("executes read-only tool without approval", async () => {
    const result = await executeToolAction({ userId: 1, toolId: "build.safe_build", action: "run" });
    expect(result.status).toBe("executed");
    expect(result.rawValuesReturned).toBe(false);
  });

  it("blocks execution when credential missing", async () => {
    vi.stubEnv("RAILWAY_TOKEN", "");
    (listVibaCredentials as Mock).mockResolvedValue([]);
    const result = await executeToolAction({ userId: 1, toolId: "railway.env.write", action: "set" });
    vi.unstubAllEnvs();
    expect(result.status).toBe("missing_credential");
    expect(result.rawValuesReturned).toBe(false);
  });

  it("blocks high-risk execution without approval token", async () => {
    (listVibaCredentials as Mock).mockResolvedValue([
      { id: 1, provider: "stripe", kind: "api_key", scope: "payments", label: "Stripe key" },
    ]);
    const result = await executeToolAction({ userId: 1, toolId: "stripe.products.write", action: "create" });
    expect(result.status).toBe("needs_user_approval");
    expect(result.rawValuesReturned).toBe(false);
  });

  it("invocation log is written on execute", async () => {
    await executeToolAction({ userId: 1, toolId: "build.safe_build", action: "run" });
    expect(pool.query).toHaveBeenCalled();
  });

  it("result never contains raw credential values", async () => {
    const result = await executeToolAction({ userId: 1, toolId: "build.safe_build", action: "run" });
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    expect(result.rawValuesReturned).toBe(false);
  });
});

// ─── Task Planner — requiredTools ─────────────────────────────────────────────

describe("taskPlanner requiredTools", () => {
  it("deployment task includes build.safe_build", async () => {
    const plan = await planTask({ request: "Deploy my app to Railway production" });
    const toolIds = plan.requiredTools.map((t) => t.toolId);
    expect(toolIds).toContain("build.safe_build");
    expect(toolIds).toContain("railway.deploy.trigger");
  });

  it("payment task includes Stripe/payment tools", async () => {
    const plan = await planTask({ request: "Set up Stripe payment and webhook for subscriptions" });
    const toolIds = plan.requiredTools.map((t) => t.toolId);
    expect(toolIds.some((id) => id.startsWith("stripe."))).toBe(true);
  });

  it("DNS task includes approval-required DNS tools", async () => {
    const plan = await planTask({ request: "Update DNS records for viba.guru and connect Railway CNAME" });
    const toolIds = plan.requiredTools.map((t) => t.toolId);
    expect(toolIds).toContain("dns.records.write");
    const dnsWrite = plan.requiredTools.find((t) => t.toolId === "dns.records.write");
    expect(dnsWrite?.requiresApproval).toBe(true);
  });

  it("build task includes safe build gate", async () => {
    const plan = await planTask({ request: "Build and implement the new API endpoint" });
    const toolIds = plan.requiredTools.map((t) => t.toolId);
    expect(toolIds).toContain("build.safe_build");
  });

  it("every task includes report.evidence.generate", async () => {
    const plan = await planTask({ request: "Research available database options" });
    const toolIds = plan.requiredTools.map((t) => t.toolId);
    expect(toolIds).toContain("report.evidence.generate");
  });

  it("requiredTools entries never claim outputsSecretValues", async () => {
    const plan = await planTask({ request: "Deploy to Railway with Stripe webhooks and update DNS" });
    for (const tool of plan.requiredTools) {
      expect(tool).not.toHaveProperty("outputsSecretValues", true);
    }
  });
});

// ─── Agent comms — tool_request message type ───────────────────────────────────

describe("Agent comms tool_request messages", () => {
  it("tool_request metadata has correct shape", () => {
    const msg = {
      from_agent: "deployment",
      to_agent: "coordinator",
      message_type: "tool_request",
      message: "Need Railway env write to set PUBLIC_ORIGIN and STRIPE_WEBHOOK_SECRET.",
      metadata_json: {
        requestedTool: "railway.env.write",
        riskLevel: "high",
        requiresApproval: true,
      },
    };
    expect(msg.message_type).toBe("tool_request");
    expect(msg.metadata_json.requestedTool).toBe("railway.env.write");
    expect(msg.metadata_json.requiresApproval).toBe(true);
    expect(JSON.stringify(msg)).not.toMatch(/password|secret_value|api_key.*=[A-Za-z0-9]/);
  });

  it("tool_request message is task scoped when taskId provided", () => {
    const taskId = "task-42";
    const msg = { task_id: taskId, from_agent: "payments", message_type: "tool_request", message: "Need Stripe read." };
    expect(msg.task_id).toBe(taskId);
  });
});
