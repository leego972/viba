/**
 * VIBA Production Operations Center — Tests
 *
 * Coverage:
 *  - ensureProductionTables: 3 tables × 3 queries = 9 pool.query calls
 *  - Target: create, list user-scoped, auth gate
 *  - Health engine: URL pass/fail, API health fail creates incident
 *  - Incident: create repair task, mark resolved
 *  - Security: no raw secrets in responses, evidence sanitised
 *  - Route registry: all 9 routes registered
 *  - Tool Broker: production.check.run is read_only
 *  - QA: critical incident blocks production readiness
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn() },
  db: {},
}));

import { pool } from "@workspace/db";
import {
  checkPublicUrl, checkApiHealth, checkTls,
  checkConsoleErrors, checkFrontendRender,
  checkCredentialExpiry, summariseChecks, shouldCreateIncident,
  sanitiseEvidence, type CheckTarget,
} from "../lib/productionHealthEngine";
import { ensureProductionTables } from "./productionOps";

// ─── Constants ────────────────────────────────────────────────────────────────

const NOW = new Date().toISOString();

const TARGET_ROW: Record<string, unknown> = {
  id: 1, user_id: 1, app_name: "viba.guru", public_url: "https://viba.guru",
  api_health_url: "https://viba.guru/api/healthz",
  railway_project_id: null, railway_service_id: null,
  status: "unknown", strict_mode: false,
  created_at: NOW, updated_at: NOW,
};

const INCIDENT_ROW: Record<string, unknown> = {
  id: 1, target_id: 1, user_id: 1, status: "open", severity: "critical",
  title: "[CRITICAL] viba.guru: public url failed",
  summary: "HTTP 503 — service unavailable",
  detected_at: NOW, resolved_at: null, repair_task_id: null,
  evidence_json: { httpStatus: 503, rawValuesReturned: false },
  created_at: NOW, updated_at: NOW,
  app_name: "viba.guru", public_url: "https://viba.guru",
  api_health_url: "https://viba.guru/api/healthz", strict_mode: false,
};

function sqlMock(overrides: Record<string, { rows: unknown[] }> = {}) {
  (pool.query as Mock).mockImplementation((sql: string) => {
    if (sql.includes("CREATE TABLE IF NOT EXISTS") || sql.includes("CREATE INDEX IF NOT EXISTS")) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes("INSERT INTO viba_production_targets")) {
      return Promise.resolve({ rows: [overrides["insert_target"]?.rows[0] ?? TARGET_ROW] });
    }
    if (sql.includes("SELECT") && sql.includes("FROM viba_production_targets") && sql.includes("WHERE user_id=")) {
      return Promise.resolve(overrides["list_targets"] ?? { rows: [TARGET_ROW] });
    }
    if (sql.includes("SELECT") && sql.includes("FROM viba_production_targets") && sql.includes("WHERE id=")) {
      return Promise.resolve(overrides["get_target"] ?? { rows: [TARGET_ROW] });
    }
    if (sql.includes("UPDATE viba_production_targets") && sql.includes("status=")) {
      return Promise.resolve({ rows: [{ id: 1, status: "healthy" }] });
    }
    if (sql.includes("INSERT INTO viba_production_checks")) {
      return Promise.resolve({ rows: [{ id: 10 }] });
    }
    if (sql.includes("SELECT") && sql.includes("FROM viba_production_checks")) {
      return Promise.resolve(overrides["get_checks"] ?? { rows: [] });
    }
    if (sql.includes("INSERT INTO viba_incidents")) {
      return Promise.resolve({ rows: [{ ...INCIDENT_ROW, id: 5 }] });
    }
    if (sql.includes("SELECT") && sql.includes("FROM viba_incidents") && sql.includes("JOIN")) {
      return Promise.resolve(overrides["get_incident"] ?? { rows: [INCIDENT_ROW] });
    }
    if (sql.includes("SELECT") && sql.includes("FROM viba_incidents")) {
      return Promise.resolve(overrides["list_incidents"] ?? { rows: [INCIDENT_ROW] });
    }
    if (sql.includes("UPDATE viba_incidents") && sql.includes("repair_task_id")) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes("UPDATE viba_incidents") && sql.includes("resolved")) {
      return Promise.resolve({ rows: [{ id: 1, status: "resolved", resolved_at: NOW }] });
    }
    if (sql.includes("INSERT INTO viba_tasks")) {
      return Promise.resolve({ rows: [{ id: 99, status: "planning", risk_level: "medium" }] });
    }
    if (sql.includes("INSERT INTO viba_agent_comms")) {
      return Promise.resolve({ rows: [{ id: 1 }] });
    }
    if (sql.includes("SELECT status, COUNT") || sql.includes("SELECT severity, COUNT") || sql.includes("SELECT MAX")) {
      return Promise.resolve(overrides["summary"] ?? { rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

// ─── ensureProductionTables ───────────────────────────────────────────────────

describe("ensureProductionTables", () => {
  it("creates 3 tables + 6 indexes = 9 pool.query calls total", async () => {
    const calls: string[] = [];
    (pool.query as Mock).mockImplementation((sql: string) => { calls.push(sql); return Promise.resolve({ rows: [] }); });
    await ensureProductionTables();
    const tableCalls = calls.filter((s) => s.includes("CREATE TABLE IF NOT EXISTS"));
    const indexCalls = calls.filter((s) => s.includes("CREATE INDEX IF NOT EXISTS"));
    expect(tableCalls).toHaveLength(3);
    expect(indexCalls).toHaveLength(6);
    expect(tableCalls.some((s) => s.includes("viba_production_targets"))).toBe(true);
    expect(tableCalls.some((s) => s.includes("viba_production_checks"))).toBe(true);
    expect(tableCalls.some((s) => s.includes("viba_incidents"))).toBe(true);
  });
});

// ─── Health Engine: checkPublicUrl ────────────────────────────────────────────

describe("productionHealthEngine: checkPublicUrl", () => {
  const target: CheckTarget = {
    id: 1, userId: 1, appName: "test", strictMode: false,
    publicUrl: "https://example.com", apiHealthUrl: "https://example.com/api/healthz",
  };

  it("returns passed with valid URL that responds 200", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as typeof fetch;
    const result = await checkPublicUrl(target);
    expect(result.status).toBe("passed");
    expect(result.rawValuesReturned).toBe(false);
  });

  it("returns failed with critical severity when URL is down", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as typeof fetch;
    const result = await checkPublicUrl({ ...target, publicUrl: "https://down.example.com" });
    expect(result.status).toBe("failed");
    expect(result.severity).toBe("critical");
    expect(result.rawValuesReturned).toBe(false);
  });

  it("returns failed for invalid URL without fetching", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const result = await checkPublicUrl({ ...target, publicUrl: "not-a-url" });
    expect(result.status).toBe("failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("evidence never contains raw secrets", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as typeof fetch;
    const result = await checkPublicUrl(target);
    const json = JSON.stringify(result.evidenceJson);
    expect(json).not.toMatch(/"(password|token|api_key|secret)"\s*:\s*"[^"]+"/);
    expect(result.rawValuesReturned).toBe(false);
  });
});

// ─── Health Engine: checkApiHealth ───────────────────────────────────────────

describe("productionHealthEngine: checkApiHealth", () => {
  const target: CheckTarget = {
    id: 1, userId: 1, appName: "test", strictMode: false,
    publicUrl: "https://example.com", apiHealthUrl: "https://example.com/api/healthz",
  };

  it("returns skipped when no API health URL configured", async () => {
    const result = await checkApiHealth({ ...target, apiHealthUrl: "" });
    expect(result.status).toBe("skipped");
  });

  it("returns failed with critical severity on API health failure", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as typeof fetch;
    const result = await checkApiHealth(target);
    expect(result.status).toBe("failed");
    expect(result.severity).toBe("critical");
  });
});

// ─── Health Engine: checkTls ─────────────────────────────────────────────────

describe("productionHealthEngine: checkTls", () => {
  const target: CheckTarget = {
    id: 1, userId: 1, appName: "test", strictMode: false,
    publicUrl: "https://example.com", apiHealthUrl: "",
  };

  it("returns failed critical when URL is not HTTPS", async () => {
    const result = await checkTls({ ...target, publicUrl: "http://example.com" });
    expect(result.status).toBe("failed");
    expect(result.severity).toBe("critical");
    expect(result.evidenceJson["reason"]).toBe("not_https");
  });

  it("returns failed critical when TLS certificate error in response", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("certificate has expired SSL TLS")) as typeof fetch;
    const result = await checkTls(target);
    expect(result.status).toBe("failed");
    expect(result.severity).toBe("critical");
  });

  it("TLS failure blocks production readiness via summariseChecks", async () => {
    const tlsFailed = {
      checkType: "tls" as const, status: "failed" as const, severity: "critical" as const,
      httpStatus: null, responseTimeMs: null, error: "TLS error",
      evidenceJson: {}, rawValuesReturned: false as const,
    };
    const summary = summariseChecks(1, "test", [tlsFailed]);
    expect(summary.releaseBlocked).toBe(true);
    expect(summary.criticalCount).toBe(1);
  });
});

// ─── Health Engine: browser checks degrade gracefully ────────────────────────

describe("productionHealthEngine: browser checks", () => {
  const target: CheckTarget = {
    id: 1, userId: 1, appName: "test", strictMode: false,
    publicUrl: "https://example.com", apiHealthUrl: "",
  };

  it("checkFrontendRender returns skipped (not hard fail)", async () => {
    const result = await checkFrontendRender(target);
    expect(result.status).toBe("skipped");
    expect(result.severity).toBe("low");
    expect(result.evidenceJson["reason"]).toBe("browser_check_unavailable");
    expect(result.rawValuesReturned).toBe(false);
  });

  it("checkConsoleErrors returns skipped (not hard fail)", async () => {
    const result = await checkConsoleErrors(target);
    expect(result.status).toBe("skipped");
    expect(result.severity).toBe("low");
    expect(result.rawValuesReturned).toBe(false);
  });

  it("skipped browser checks do not contribute to critical/high count in summary", async () => {
    const skipped = { checkType: "console_errors" as const, status: "skipped" as const, severity: "low" as const, httpStatus: null, responseTimeMs: null, error: null, evidenceJson: {}, rawValuesReturned: false as const };
    const summary = summariseChecks(1, "test", [skipped]);
    expect(summary.criticalCount).toBe(0);
    expect(summary.highCount).toBe(0);
    expect(summary.skippedCount).toBe(1);
    expect(summary.releaseBlocked).toBe(false);
  });
});

// ─── Health Engine: credential expiry ────────────────────────────────────────

describe("productionHealthEngine: checkCredentialExpiry", () => {
  it("returns metadata only — no raw credential values", async () => {
    (pool.query as Mock).mockResolvedValue({ rows: [{ total: 5, expiring_soon: 0 }] });
    const result = await checkCredentialExpiry(1);
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/"(value|raw_key|api_key|secret)"\s*:/);
    expect(result.rawValuesReturned).toBe(false);
  });

  it("returns skipped gracefully when vault table unavailable", async () => {
    (pool.query as Mock).mockRejectedValue(new Error("relation viba_credentials does not exist"));
    const result = await checkCredentialExpiry(1);
    expect(result.status).toBe("skipped");
    expect(result.rawValuesReturned).toBe(false);
  });
});

// ─── shouldCreateIncident ─────────────────────────────────────────────────────

describe("shouldCreateIncident", () => {
  it("creates incident for critical failed check", () => {
    const check = { status: "failed" as const, severity: "critical" as const, checkType: "public_url" as const, httpStatus: null, responseTimeMs: null, error: null, evidenceJson: {}, rawValuesReturned: false as const };
    expect(shouldCreateIncident(check)).toBe(true);
  });

  it("creates incident for high failed check", () => {
    const check = { status: "failed" as const, severity: "high" as const, checkType: "dns" as const, httpStatus: null, responseTimeMs: null, error: null, evidenceJson: {}, rawValuesReturned: false as const };
    expect(shouldCreateIncident(check)).toBe(true);
  });

  it("does not create incident for passed check", () => {
    const check = { status: "passed" as const, severity: "low" as const, checkType: "api_health" as const, httpStatus: 200, responseTimeMs: 100, error: null, evidenceJson: {}, rawValuesReturned: false as const };
    expect(shouldCreateIncident(check)).toBe(false);
  });

  it("does not create incident for medium warning", () => {
    const check = { status: "warning" as const, severity: "medium" as const, checkType: "public_url" as const, httpStatus: 200, responseTimeMs: 5000, error: null, evidenceJson: {}, rawValuesReturned: false as const };
    expect(shouldCreateIncident(check)).toBe(false);
  });
});

// ─── sanitiseEvidence ─────────────────────────────────────────────────────────

describe("sanitiseEvidence", () => {
  it("redacts known secret fields", () => {
    const raw = { token: "super-secret", httpStatus: 200, url: "https://example.com" };
    const out = sanitiseEvidence(raw);
    expect(out["token"]).toBe("[REDACTED]");
    expect(out["httpStatus"]).toBe(200);
    expect(out["url"]).toBe("https://example.com");
  });

  it("redacts nested secret fields", () => {
    const raw = { headers: { authorization: "Bearer xyz", "content-type": "application/json" }, status: 200 };
    const out = sanitiseEvidence(raw);
    expect((out["headers"] as Record<string, unknown>)?.["authorization"]).toBe("[REDACTED]");
    expect((out["headers"] as Record<string, unknown>)?.["content-type"]).toBe("application/json");
  });

  it("preserves non-secret fields", () => {
    const raw = { httpStatus: 503, responseTimeMs: 120, error: "connection refused" };
    const out = sanitiseEvidence(raw);
    expect(out).toEqual(raw);
  });
});

// ─── Route handler tests ──────────────────────────────────────────────────────

async function getRouteHandlers(path: string, method: "post" | "get") {
  const { default: router } = await import("./productionOps");
  const handlers: Array<(req: unknown, res: unknown, next: unknown) => void> = [];
  (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (r: unknown, s: unknown, n: unknown) => void }> } }> }).stack.forEach((layer) => {
    if (layer.route?.path === path && layer.route.methods[method]) {
      layer.route.stack.forEach((h) => handlers.push(h.handle));
    }
  });
  return handlers;
}

function makeRes() {
  let status = 200; let body: unknown = null;
  const res = { status: (s: number) => { status = s; return res; }, json: (b: unknown) => { body = b; return res; } };
  return { res, getStatus: () => status, getBody: () => body };
}

describe("POST /api/production-ops/targets", () => {
  beforeEach(() => { sqlMock(); });

  it("returns 401 when not authenticated", async () => {
    const handlers = await getRouteHandlers("/api/production-ops/targets", "post");
    const { res, getStatus } = makeRes();
    const req = { session: undefined, params: {}, body: { appName: "test", publicUrl: "https://example.com" } };
    if (handlers[0]) await handlers[0](req, res, () => {});
    expect(getStatus()).toBe(401);
  });

  it("creates target and returns rawValuesReturned: false", async () => {
    sqlMock({ insert_target: { rows: [TARGET_ROW] } });
    const handlers = await getRouteHandlers("/api/production-ops/targets", "post");
    const { res, getBody } = makeRes();
    const req = { session: { userId: 1 }, params: {}, body: { appName: "viba.guru", publicUrl: "https://viba.guru" } };
    if (handlers[0]) await handlers[0](req, res, () => {});
    const body = getBody() as Record<string, unknown>;
    expect(body?.["ok"]).toBe(true);
    expect(body?.["rawValuesReturned"]).toBe(false);
  });

  it("rejects missing appName", async () => {
    const handlers = await getRouteHandlers("/api/production-ops/targets", "post");
    const { res, getStatus } = makeRes();
    const req = { session: { userId: 1 }, params: {}, body: { publicUrl: "https://example.com" } };
    if (handlers[0]) await handlers[0](req, res, () => {});
    expect(getStatus()).toBe(400);
  });

  it("rejects invalid publicUrl", async () => {
    const handlers = await getRouteHandlers("/api/production-ops/targets", "post");
    const { res, getStatus } = makeRes();
    const req = { session: { userId: 1 }, params: {}, body: { appName: "test", publicUrl: "not-a-url" } };
    if (handlers[0]) await handlers[0](req, res, () => {});
    expect(getStatus()).toBe(400);
  });
});

describe("GET /api/production-ops/targets", () => {
  it("targets list is user-scoped", async () => {
    sqlMock({ list_targets: { rows: [TARGET_ROW] } });
    const handlers = await getRouteHandlers("/api/production-ops/targets", "get");
    const { res, getBody } = makeRes();
    const req = { session: { userId: 1 }, params: {}, body: {} };
    if (handlers[0]) await handlers[0](req, res, () => {});
    const body = getBody() as Record<string, unknown>;
    expect(body?.["ok"]).toBe(true);
    expect(Array.isArray(body?.["targets"])).toBe(true);
    expect(body?.["rawValuesReturned"]).toBe(false);
    // Verify user-scoped SQL was used
    const calls = (pool.query as Mock).mock.calls.map((c) => String(c[0]));
    expect(calls.some((s) => s.includes("WHERE user_id="))).toBe(true);
  });
});

describe("POST /api/production-ops/incidents/:incidentId/create-repair-task", () => {
  it("creates repair task from incident with agent messages", async () => {
    sqlMock({ get_incident: { rows: [INCIDENT_ROW] } });
    const handlers = await getRouteHandlers("/api/production-ops/incidents/:incidentId/create-repair-task", "post");
    const { res, getBody } = makeRes();
    const req = { session: { userId: 1 }, params: { incidentId: "1" }, body: {} };
    if (handlers[0]) await handlers[0](req, res, () => {});
    const body = getBody() as Record<string, unknown>;
    expect(body?.["ok"]).toBe(true);
    expect(body?.["taskId"]).toBeDefined();
    expect(body?.["rawValuesReturned"]).toBe(false);
  });

  it("repair task creation does not mutate production directly", async () => {
    sqlMock({ get_incident: { rows: [INCIDENT_ROW] } });
    const handlers = await getRouteHandlers("/api/production-ops/incidents/:incidentId/create-repair-task", "post");
    const { res } = makeRes();
    const req = { session: { userId: 1 }, params: { incidentId: "1" }, body: {} };
    if (handlers[0]) await handlers[0](req, res, () => {});
    const calls = (pool.query as Mock).mock.calls.map((c) => String(c[0]));
    // Should insert into viba_tasks (safe planning) but NOT trigger a deployment
    expect(calls.some((s) => s.includes("INSERT INTO viba_tasks"))).toBe(true);
    expect(calls.every((s) => !s.toLowerCase().includes("railway.deploy"))).toBe(true);
  });
});

describe("POST /api/production-ops/incidents/:incidentId/mark-resolved", () => {
  it("marks incident as resolved", async () => {
    sqlMock();
    const handlers = await getRouteHandlers("/api/production-ops/incidents/:incidentId/mark-resolved", "post");
    const { res, getBody } = makeRes();
    const req = { session: { userId: 1 }, params: { incidentId: "1" }, body: {} };
    if (handlers[0]) await handlers[0](req, res, () => {});
    const body = getBody() as Record<string, unknown>;
    expect(body?.["ok"]).toBe(true);
    expect(body?.["status"]).toBe("resolved");
    expect(body?.["rawValuesReturned"]).toBe(false);
  });
});

// ─── QA integration: critical incident blocks production readiness ─────────────

describe("QA integration: critical incident blocks production readiness", () => {
  it("summary shows releaseBlocked=true when any critical check exists", () => {
    const criticalCheck = { checkType: "public_url" as const, status: "failed" as const, severity: "critical" as const, httpStatus: null, responseTimeMs: null, error: "down", evidenceJson: {}, rawValuesReturned: false as const };
    const summary = summariseChecks(1, "test", [criticalCheck]);
    expect(summary.releaseBlocked).toBe(true);
    expect(summary.overallStatus).toBe("failing");
  });

  it("summary shows releaseBlocked=false when all checks pass", () => {
    const passed = { checkType: "public_url" as const, status: "passed" as const, severity: "low" as const, httpStatus: 200, responseTimeMs: 100, error: null, evidenceJson: {}, rawValuesReturned: false as const };
    const summary = summariseChecks(1, "test", [passed]);
    expect(summary.releaseBlocked).toBe(false);
    expect(summary.overallStatus).toBe("healthy");
  });
});

// ─── Tool Broker: production.check.run is read_only ──────────────────────────

describe("Tool Broker: production tools risk levels", () => {
  it("production.check.run is registered as read_only", async () => {
    const { getToolById } = await import("../lib/toolRegistry");
    const tool = getToolById("production.check.run");
    expect(tool).toBeDefined();
    expect(tool?.riskLevel).toBe("read_only");
  });

  it("production.repair_task.create is registered as medium risk", async () => {
    const { getToolById } = await import("../lib/toolRegistry");
    const tool = getToolById("production.repair_task.create");
    expect(tool).toBeDefined();
    expect(tool?.riskLevel).toBe("medium");
  });

  it("production.incident.resolve is registered as medium risk", async () => {
    const { getToolById } = await import("../lib/toolRegistry");
    const tool = getToolById("production.incident.resolve");
    expect(tool).toBeDefined();
    expect(tool?.riskLevel).toBe("medium");
  });
});

// ─── Route registry ───────────────────────────────────────────────────────────

describe("route registry: all 9 productionOps routes registered", () => {
  it("all routes are present", async () => {
    const { default: router } = await import("./productionOps");
    const routes = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack
      .filter((l) => l.route)
      .map((l) => `${Object.keys(l.route!.methods).join(",").toUpperCase()} ${l.route!.path}`);
    expect(routes.some((r) => r.includes("POST /api/production-ops/targets") && !r.includes(":"))).toBe(true);
    expect(routes.some((r) => r.includes("GET /api/production-ops/targets") && !r.includes(":"))).toBe(true);
    expect(routes.some((r) => r.includes("GET /api/production-ops/targets/:targetId") && !r.includes("check") && !r.includes("incident"))).toBe(true);
    expect(routes.some((r) => r.includes("check-now"))).toBe(true);
    expect(routes.some((r) => r.includes("checks"))).toBe(true);
    expect(routes.some((r) => r.includes("incidents") && r.includes("targetId"))).toBe(true);
    expect(routes.some((r) => r.includes("create-repair-task"))).toBe(true);
    expect(routes.some((r) => r.includes("mark-resolved"))).toBe(true);
    expect(routes.some((r) => r.includes("GET /api/production-ops/summary"))).toBe(true);
  });
});
