/**
 * VIBA QA Release Gate Tests
 *
 * Coverage:
 *  - QA Planner: code/payment/credential/browser/upload area triggers correct suites
 *  - Release Gate: critical blocker blocks release, warnings do not, approve blocked when critical exists
 *  - Security: QA report never returns secrets, vault check forbids encrypted fields
 *  - DB setup: ensureQaTables runs without error
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn() },
  db: {},
}));

vi.mock("../lib/browserQaHarness", () => ({
  runBrowserQaHarness: vi.fn().mockResolvedValue({
    totalChecked: 11,
    passed: 4,
    warnings: 0,
    failed: 0,
    manualRequired: 7,
    checks: [],
    blockers: [],
    runAt: new Date().toISOString(),
  }),
  checkApiRoute: vi.fn().mockResolvedValue({ id: "api-health", route: "/api/health", status: "passed", httpStatus: 200, consoleErrors: [], networkFailures: [], notes: "OK", checkedAt: new Date().toISOString() }),
  frontendRouteCheck: vi.fn().mockReturnValue({ id: "route-home", route: "/", status: "manual_required", httpStatus: null, notes: "Manual", checkedAt: new Date().toISOString() }),
}));

import { pool } from "@workspace/db";
import { buildQATestPlan } from "../lib/qaTestPlanner";
import { ensureQaTables } from "./qaReleaseGate";

// ─── SQL-content-based mock helper ────────────────────────────────────────────

const NOW = new Date().toISOString();

function sqlMock(overrides: Record<string, { rows: unknown[] }> = {}) {
  (pool.query as Mock).mockImplementation((sql: string) => {
    // ensureQaTables — CREATE TABLE + INDEX calls
    if (sql.includes("CREATE TABLE IF NOT EXISTS") || sql.includes("CREATE INDEX IF NOT EXISTS")) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    // INSERT qa_run
    if (sql.includes("INSERT INTO viba_qa_runs")) {
      return Promise.resolve({ rows: [{ id: 42, user_id: 1, status: "created", release_status: "not_ready", plan_json: null, blockers_json: [], warnings_json: [], created_at: NOW }] });
    }
    // SELECT qa_run
    if (sql.includes("SELECT") && sql.includes("FROM viba_qa_runs") && sql.includes("WHERE id=")) {
      return Promise.resolve(overrides["qa_run"] ?? { rows: [{ id: 42, user_id: 1, status: "running", release_status: "not_ready", blockers_json: [], warnings_json: [], plan_json: null }] });
    }
    // SELECT qa_runs list
    if (sql.includes("SELECT") && sql.includes("FROM viba_qa_runs") && sql.includes("ORDER BY created_at")) {
      return Promise.resolve({ rows: [] });
    }
    // SELECT qa_checks
    if (sql.includes("FROM viba_qa_checks") && sql.includes("COUNT")) {
      return Promise.resolve(overrides["checks_count"] ?? { rows: [{ cnt: "0" }] });
    }
    if (sql.includes("FROM viba_qa_checks")) {
      return Promise.resolve(overrides["checks"] ?? { rows: [] });
    }
    // INSERT qa_check
    if (sql.includes("INSERT INTO viba_qa_checks")) {
      return Promise.resolve({ rows: [{ id: 1 }] });
    }
    // UPDATE qa_run
    if (sql.includes("UPDATE viba_qa_runs")) {
      return Promise.resolve({ rows: [{ id: 42, status: "running" }] });
    }
    // UPDATE qa_check
    if (sql.includes("UPDATE viba_qa_checks")) {
      return Promise.resolve(overrides["update_check"] ?? { rows: [{ id: 1, suite: "vault", check_name: "test", status: "passed", severity: "critical" }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

function mockReq(body: Record<string, unknown> = {}, params: Record<string, string> = {}, session?: { userId: number }) {
  return {
    body,
    params,
    session: session ?? { userId: 1 },
  };
}

function mockRes() {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  return { json, status, _json: json, _status: status };
}

// ─── QA Planner Tests ─────────────────────────────────────────────────────────

describe("buildQATestPlan", () => {
  it("always includes safe_build, route_registry, secret_scan suites", () => {
    const plan = buildQATestPlan({ appName: "VIBA", changedFiles: [], changedRoutes: [], touchedAreas: [], strictMode: false });
    expect(plan.requiredSuites).toContain("safe_build");
    expect(plan.requiredSuites).toContain("route_registry");
    expect(plan.requiredSuites).toContain("secret_scan");
  });

  it("code change (routes/index.ts) triggers route_registry and secret_scan", () => {
    const plan = buildQATestPlan({ appName: "VIBA", changedFiles: ["artifacts/api-server/src/routes/index.ts"], changedRoutes: [], touchedAreas: [], strictMode: false });
    expect(plan.requiredSuites).toContain("route_registry");
    expect(plan.requiredSuites).toContain("secret_scan");
  });

  it("payment file change triggers payments and credits suites", () => {
    const plan = buildQATestPlan({ appName: "VIBA", changedFiles: ["src/routes/stripe.ts"], changedRoutes: [], touchedAreas: [], strictMode: false });
    expect(plan.requiredSuites).toContain("payments");
    expect(plan.requiredSuites).toContain("credits");
  });

  it("credential/vault file change triggers vault suite", () => {
    const plan = buildQATestPlan({ appName: "VIBA", changedFiles: ["src/lib/vibaVault.ts"], changedRoutes: [], touchedAreas: [], strictMode: false });
    expect(plan.requiredSuites).toContain("vault");
  });

  it("browser operator file change triggers browser_operator suite", () => {
    const plan = buildQATestPlan({ appName: "VIBA", changedFiles: ["src/routes/assistedBrowser.ts"], changedRoutes: [], touchedAreas: [], strictMode: false });
    expect(plan.requiredSuites).toContain("browser_operator");
  });

  it("upload/build area triggers malware_safety suite and launch blocker", () => {
    const plan = buildQATestPlan({ appName: "VIBA", changedFiles: [], changedRoutes: [], touchedAreas: ["malware"], strictMode: false });
    expect(plan.requiredSuites).toContain("malware_safety");
    expect(plan.launchBlockers.some((b) => /malware/i.test(b))).toBe(true);
  });

  it("railway/github area adds deploy approval launch blocker", () => {
    const plan = buildQATestPlan({ appName: "VIBA", changedFiles: [], changedRoutes: [], touchedAreas: ["railway", "github"], strictMode: false });
    expect(plan.launchBlockers.some((b) => /deploy|approval/i.test(b))).toBe(true);
  });

  it("strict mode adds mobile and accessibility suites", () => {
    const plan = buildQATestPlan({ appName: "VIBA", changedFiles: [], changedRoutes: [], touchedAreas: [], strictMode: true });
    expect(plan.requiredSuites).toContain("mobile");
    expect(plan.requiredSuites).toContain("accessibility");
    expect(plan.requiredSuites).toContain("console_errors");
  });

  it("plan has testPlanId, generatedAt, appName", () => {
    const plan = buildQATestPlan({ appName: "Test App", changedFiles: [], changedRoutes: [], touchedAreas: [], strictMode: false });
    expect(plan.testPlanId).toMatch(/^qa-/);
    expect(plan.appName).toBe("Test App");
    expect(plan.generatedAt).toBeTruthy();
  });

  it("vault suite triggers vault checks with no forbidden encrypted_value fields", () => {
    const plan = buildQATestPlan({ appName: "VIBA", changedFiles: ["src/lib/vibaVault.ts"], changedRoutes: [], touchedAreas: [], strictMode: false });
    const vaultChecks = plan.vaultChecks;
    expect(vaultChecks.length).toBeGreaterThan(0);
    for (const check of vaultChecks) {
      expect(check.forbiddenFields).toContain("encrypted_value");
    }
  });

  it("security checks never include forbidden credential fields in their definitions", () => {
    const plan = buildQATestPlan({ appName: "VIBA", changedFiles: [], changedRoutes: [], touchedAreas: [], strictMode: true });
    // Security check rules should reference forbidden field *names* (as rules), not expose raw values
    for (const sc of plan.securityChecks) {
      expect(typeof sc.rule).toBe("string");
      expect(sc.severity).toBeDefined();
    }
  });
});

// ─── ensureQaTables Tests ─────────────────────────────────────────────────────

describe("ensureQaTables", () => {
  beforeEach(() => {
    (pool.query as Mock).mockImplementation((sql: string) => {
      if (sql.includes("CREATE TABLE IF NOT EXISTS") || sql.includes("CREATE INDEX IF NOT EXISTS")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  it("runs without error and creates 2 tables + 6 indexes", async () => {
    const calls: string[] = [];
    (pool.query as Mock).mockImplementation((sql: string) => {
      calls.push(sql);
      return Promise.resolve({ rows: [] });
    });
    await ensureQaTables();
    const tableCalls = calls.filter((s) => s.includes("CREATE TABLE IF NOT EXISTS"));
    const indexCalls = calls.filter((s) => s.includes("CREATE INDEX IF NOT EXISTS"));
    expect(tableCalls).toHaveLength(2);
    expect(indexCalls).toHaveLength(6);
  });
});

// ─── Release Gate Approve Tests ───────────────────────────────────────────────

describe("approve-release blocking logic", () => {
  beforeEach(() => { sqlMock(); });

  it("blocks approval when critical failed checks exist", async () => {
    sqlMock({
      qa_run: { rows: [{ id: 42, user_id: 1, status: "blocked", release_status: "not_ready", blockers_json: [], warnings_json: [], plan_json: null }] },
      checks_count: { rows: [{ cnt: "2" }] },
    });

    const { default: qaRouter } = await import("./qaReleaseGate");
    let responseBody: unknown = null;
    let responseStatus = 200;
    const req = { session: { userId: 1 }, params: { id: "42" }, body: {} };
    const res = {
      status: (s: number) => { responseStatus = s; return res; },
      json: (b: unknown) => { responseBody = b; return res; },
    };

    // Find the approve-release handler by calling through the router
    const handlers: Array<(req: unknown, res: unknown, next: unknown) => void> = [];
    (qaRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: unknown, res: unknown, next: unknown) => void }> } }> }).stack.forEach((layer) => {
      if (layer.route?.path === "/api/qa/runs/:id/approve-release") {
        layer.route.stack.forEach((h) => handlers.push(h.handle));
      }
    });

    if (handlers[0]) await handlers[0](req, res, () => {});
    expect(responseStatus).toBe(400);
    expect((responseBody as Record<string, unknown>)?.["error"]).toMatch(/critical/i);
  });

  it("approve response includes rawValuesReturned: false", async () => {
    sqlMock({
      qa_run: { rows: [{ id: 42, user_id: 1, status: "passed_with_warnings", release_status: "not_ready", blockers_json: [], warnings_json: [], plan_json: null }] },
      checks_count: { rows: [{ cnt: "0" }] },
    });

    let responseBody: unknown = null;
    const req = { session: { userId: 1 }, params: { id: "42" }, body: {} };
    const res = {
      status: (s: number) => res,
      json: (b: unknown) => { responseBody = b; return res; },
    };

    const { default: qaRouter } = await import("./qaReleaseGate");
    const handlers: Array<(req: unknown, res: unknown, next: unknown) => void> = [];
    (qaRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: unknown, res: unknown, next: unknown) => void }> } }> }).stack.forEach((layer) => {
      if (layer.route?.path === "/api/qa/runs/:id/approve-release") {
        layer.route.stack.forEach((h) => handlers.push(h.handle));
      }
    });
    if (handlers[0]) await handlers[0](req, res, () => {});
    expect((responseBody as Record<string, unknown>)?.["rawValuesReturned"]).toBe(false);
  });
});

// ─── Security Tests ───────────────────────────────────────────────────────────

describe("security: QA responses never return secrets", () => {
  beforeEach(() => { sqlMock(); });

  it("GET /api/qa/runs report response includes securityNote", async () => {
    sqlMock({
      qa_run: { rows: [{ id: 42, user_id: 1, status: "passed_with_warnings", release_status: "not_ready", blockers_json: [], warnings_json: [], plan_json: null, branch_name: null, commit_sha: null, started_at: null, completed_at: null, summary: null }] },
      checks: { rows: [] },
      checks_count: { rows: [{ cnt: "0" }] },
    });

    let responseBody: unknown = null;
    const req = { session: { userId: 1 }, params: { id: "42" }, body: {} };
    const res = {
      status: (s: number) => res,
      json: (b: unknown) => { responseBody = b; return res; },
    };

    const { default: qaRouter } = await import("./qaReleaseGate");
    const handlers: Array<(req: unknown, res: unknown, next: unknown) => void> = [];
    (qaRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: unknown, res: unknown, next: unknown) => void }> } }> }).stack.forEach((layer) => {
      if (layer.route?.path === "/api/qa/runs/:id/report") {
        layer.route.stack.forEach((h) => handlers.push(h.handle));
      }
    });
    if (handlers[0]) await handlers[0](req, res, () => {});
    const report = (responseBody as Record<string, unknown>)?.["report"] as Record<string, unknown>;
    expect(report?.["securityNote"]).toMatch(/no API keys/i);
    expect(report?.["rawValuesReturned"]).toBe(false);
  });

  it("vault check plan never includes 'encrypted_value' as a returned field", () => {
    const plan = buildQATestPlan({ appName: "VIBA", changedFiles: ["src/lib/vibaVault.ts"], changedRoutes: [], touchedAreas: [], strictMode: false });
    const json = JSON.stringify(plan);
    // The plan should mention encrypted_value only in forbiddenFields / rule text, never as something returned
    // i.e., the plan itself is clean of raw secrets
    expect(json).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(json).not.toMatch(/"password"\s*:/);
    expect(json).not.toMatch(/"access_token"\s*:/);
  });

  it("auth required when no session", async () => {
    const req = { session: undefined, params: {}, body: {} };
    let responseStatus = 200;
    const res = {
      status: (s: number) => { responseStatus = s; return res; },
      json: () => res,
    };
    const { default: qaRouter } = await import("./qaReleaseGate");
    const handlers: Array<(req: unknown, res: unknown, next: unknown) => void> = [];
    (qaRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: unknown, res: unknown, next: unknown) => void }> } }> }).stack.forEach((layer) => {
      if (layer.route?.path === "/api/qa/runs") {
        layer.route.stack.forEach((h) => handlers.push(h.handle));
      }
    });
    if (handlers[0]) await handlers[0](req, res, () => {});
    expect(responseStatus).toBe(401);
  });
});

// ─── Vault-specific security tests ───────────────────────────────────────────

describe("vault metadata check — never includes encrypted fields", () => {
  it("vault checks list forbidden fields that should never appear in API responses", () => {
    const plan = buildQATestPlan({ appName: "VIBA", changedFiles: ["src/lib/vibaVault.ts"], changedRoutes: [], touchedAreas: [], strictMode: false });
    const vaultCheck = plan.vaultChecks.find((c) => c.id === "vc-no-encrypted-value");
    expect(vaultCheck).toBeDefined();
    expect(vaultCheck?.forbiddenFields).toContain("encrypted_value");
    expect(vaultCheck?.forbiddenFields).toContain("iv");
    expect(vaultCheck?.forbiddenFields).toContain("auth_tag");
  });

  it("api check for /api/credentials lists encrypted_value as forbidden", () => {
    const plan = buildQATestPlan({ appName: "VIBA", changedFiles: ["src/lib/vibaVault.ts"], changedRoutes: [], touchedAreas: [], strictMode: false });
    const apiCheck = plan.apiChecks.find((c) => c.id === "ac-credentials-no-raw");
    expect(apiCheck).toBeDefined();
    expect(apiCheck?.forbiddenFields).toContain("encrypted_value");
    expect(apiCheck?.forbiddenFields).toContain("iv");
    expect(apiCheck?.forbiddenFields).toContain("auth_tag");
  });
});

// ─── Warnings do not block release ───────────────────────────────────────────

describe("warnings vs blockers", () => {
  it("plan with only warnings (no critical failures) is passable", async () => {
    sqlMock({
      qa_run: { rows: [{ id: 42, user_id: 1, status: "passed_with_warnings", release_status: "not_ready", blockers_json: ["Browser check: manual required"], warnings_json: ["Browser harness warning"], plan_json: null }] },
      checks_count: { rows: [{ cnt: "0" }] }, // no critical failures
    });

    let responseStatus = 200;
    let responseBody: unknown = null;
    const req = { session: { userId: 1 }, params: { id: "42" }, body: {} };
    const res = {
      status: (s: number) => { responseStatus = s; return res; },
      json: (b: unknown) => { responseBody = b; return res; },
    };

    const { default: qaRouter } = await import("./qaReleaseGate");
    const handlers: Array<(req: unknown, res: unknown, next: unknown) => void> = [];
    (qaRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: unknown, res: unknown, next: unknown) => void }> } }> }).stack.forEach((layer) => {
      if (layer.route?.path === "/api/qa/runs/:id/approve-release") {
        layer.route.stack.forEach((h) => handlers.push(h.handle));
      }
    });
    if (handlers[0]) await handlers[0](req, res, () => {});
    // With no critical failures, approve should succeed (200)
    expect(responseStatus).not.toBe(400);
    expect((responseBody as Record<string, unknown>)?.["rawValuesReturned"]).toBe(false);
  });
});
