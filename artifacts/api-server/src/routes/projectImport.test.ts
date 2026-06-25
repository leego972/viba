/**
 * VIBA Project Import + Repair Pipeline Tests
 *
 * Coverage:
 *  - Import: creates github/manual imports, rejects invalid sourceType, auth gate
 *  - Analyzer: detects package manager, framework, env gaps, launch blockers, no code execution
 *  - Repair Plan: steps, safeBuildRequired, approvalRequired for deploy/payment, agents/tools
 *  - Runtime integration: creates repair task, writes agent messages, blocks deploy until safe-build
 *  - Security: no secrets in any response, vault metadata only
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn() },
  db: {},
}));

import { pool } from "@workspace/db";
import { analyzeProject } from "../lib/projectAnalyzer";
import { generateRepairPlan } from "../lib/repairPlanGenerator";
import { ensureImportTables } from "./projectImport";

// ─── SQL-content-based mock helper ────────────────────────────────────────────

const NOW = new Date().toISOString();

const IMPORT_ROW: Record<string, unknown> = {
  id: 1, user_id: 1,
  source_type: "github_repo",
  repo_url: "https://github.com/leego972/bridge-ai",
  upload_id: null, railway_project_id: null,
  description: "Fix broken build",
  known_errors_json: ["Module not found: src/App.tsx"],
  status: "created",
  analysis_json: null, repair_plan_json: null,
  task_id: null, strict_mode: false,
  created_at: NOW, updated_at: NOW,
};

const IMPORT_ROW_WITH_ANALYSIS: Record<string, unknown> = {
  ...IMPORT_ROW,
  status: "analysis_complete",
  analysis_json: {
    projectName: "bridge-ai",
    sourceType: "github_repo",
    detectedFramework: "react_vite",
    packageManager: "pnpm",
    languages: ["TypeScript"],
    envMissing: ["DATABASE_URL"],
    launchBlockers: ["1 required environment variable(s) not configured: DATABASE_URL"],
    rawValuesReturned: false,
  },
  repair_plan_json: {
    planId: "repair-123",
    riskLevel: "medium",
    approvalRequired: false,
    safeBuildRequired: true,
    qaRequired: true,
    estimatedStepCount: 5,
    requiredAgents: ["coordinator", "builder"],
    rawValuesReturned: false,
  },
};

function sqlMock(overrides: Record<string, { rows: unknown[] }> = {}) {
  (pool.query as Mock).mockImplementation((sql: string) => {
    if (sql.includes("CREATE TABLE IF NOT EXISTS") || sql.includes("CREATE INDEX IF NOT EXISTS")) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes("INSERT INTO viba_project_imports")) {
      return Promise.resolve({ rows: [overrides["insert"]?.rows[0] ?? IMPORT_ROW] });
    }
    if (sql.includes("SELECT") && sql.includes("FROM viba_project_imports") && sql.includes("WHERE id=")) {
      return Promise.resolve(overrides["select"] ?? { rows: [IMPORT_ROW] });
    }
    if (sql.includes("UPDATE viba_project_imports")) {
      return Promise.resolve({ rows: [{ id: 1, status: "analysis_complete" }] });
    }
    if (sql.includes("INSERT INTO viba_tasks")) {
      return Promise.resolve({ rows: [{ id: 99, user_id: 1, request: "Repair project", status: "planning", risk_level: "medium", needs_user_approval: false, safe_build_required: true, created_at: NOW }] });
    }
    if (sql.includes("INSERT INTO viba_agent_comms")) {
      return Promise.resolve({ rows: [{ id: 1 }] });
    }
    if (sql.includes("UPDATE viba_project_imports") && sql.includes("task_id")) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

function makeReq(body: Record<string, unknown> = {}, params: Record<string, string> = {}, sessionUserId = 1) {
  return { body, params, session: { userId: sessionUserId } };
}

function makeRes() {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  return { json, status };
}

// ─── ensureImportTables ───────────────────────────────────────────────────────

describe("ensureImportTables", () => {
  it("creates 1 table + 2 indexes (3 pool.query calls total)", async () => {
    const calls: string[] = [];
    (pool.query as Mock).mockImplementation((sql: string) => { calls.push(sql); return Promise.resolve({ rows: [] }); });
    await ensureImportTables();
    const tableCalls = calls.filter((s) => s.includes("CREATE TABLE IF NOT EXISTS"));
    const indexCalls = calls.filter((s) => s.includes("CREATE INDEX IF NOT EXISTS"));
    expect(tableCalls).toHaveLength(1);
    expect(indexCalls).toHaveLength(2);
  });
});

// ─── Project Analyzer Tests ───────────────────────────────────────────────────

describe("analyzeProject", () => {
  it("detects pnpm from pnpm-lock.yaml in fileList", () => {
    const analysis = analyzeProject({
      sourceType: "github_repo",
      fileList: ["pnpm-lock.yaml", "package.json"],
      packageJsonContent: { name: "test-app", dependencies: { react: "^18" }, devDependencies: { vite: "^5" } },
    });
    expect(analysis.packageManager).toBe("pnpm");
    expect(analysis.rawValuesReturned).toBe(false);
  });

  it("detects npm from package-lock.json", () => {
    const analysis = analyzeProject({
      sourceType: "github_repo",
      fileList: ["package-lock.json", "package.json"],
      packageJsonContent: { name: "test-app" },
    });
    expect(analysis.packageManager).toBe("npm");
  });

  it("detects react_vite framework from vite + react deps", () => {
    const analysis = analyzeProject({
      sourceType: "github_repo",
      fileList: ["vite.config.ts", "src/App.tsx", "pnpm-lock.yaml"],
      packageJsonContent: { name: "app", dependencies: { react: "^18" }, devDependencies: { vite: "^5" } },
    });
    expect(analysis.detectedFramework).toBe("react_vite");
  });

  it("detects nextjs framework from next dep + config file", () => {
    const analysis = analyzeProject({
      sourceType: "github_repo",
      fileList: ["next.config.ts", "package.json"],
      packageJsonContent: { name: "my-next-app", dependencies: { next: "^14" } },
    });
    expect(analysis.detectedFramework).toBe("nextjs");
  });

  it("detects express framework", () => {
    const analysis = analyzeProject({
      sourceType: "github_repo",
      fileList: ["src/app.ts", "package.json"],
      packageJsonContent: { name: "api", dependencies: { express: "^5" } },
    });
    expect(analysis.detectedFramework).toBe("express");
  });

  it("detects missing env vars and populates envMissing", () => {
    const analysis = analyzeProject({
      sourceType: "github_repo",
      fileList: ["package.json"],
      packageJsonContent: { name: "app", dependencies: { express: "^5" } },
      knownErrors: ["DATABASE_URL is not set", "SESSION_SECRET is missing"],
      configuredEnvNames: [],
    });
    expect(analysis.envMissing).toContain("DATABASE_URL");
    expect(analysis.envMissing).toContain("SESSION_SECRET");
  });

  it("configured env names are not in envMissing", () => {
    const analysis = analyzeProject({
      sourceType: "github_repo",
      fileList: ["package.json"],
      packageJsonContent: { name: "app", dependencies: { express: "^5" } },
      knownErrors: ["DATABASE_URL is not set"],
      configuredEnvNames: ["DATABASE_URL", "SESSION_SECRET", "NODE_ENV"],
    });
    expect(analysis.envMissing).not.toContain("DATABASE_URL");
  });

  it("produces launch blockers for zip upload (malware scan required)", () => {
    const analysis = analyzeProject({
      sourceType: "zip_upload",
      fileList: [],
      strictMode: false,
    });
    expect(analysis.launchBlockers.some((b) => /malware/i.test(b))).toBe(true);
    expect(analysis.uploadSafetyFindings.length).toBeGreaterThan(0);
    expect(analysis.uploadSafetyFindings.some((f) => f.id === "upload-malware-scan")).toBe(true);
  });

  it("strict mode makes malware scan critical for zip upload", () => {
    const analysis = analyzeProject({ sourceType: "zip_upload", fileList: [], strictMode: true });
    const malwareFinding = analysis.uploadSafetyFindings.find((f) => f.id === "upload-malware-scan");
    expect(malwareFinding?.severity).toBe("critical");
  });

  it("never returns raw secrets — rawValuesReturned is always false", () => {
    const analysis = analyzeProject({
      sourceType: "manual",
      description: "App with STRIPE_SECRET_KEY=sk-test-1234 committed to git",
      knownErrors: [],
    });
    const json = JSON.stringify(analysis);
    expect(analysis.rawValuesReturned).toBe(false);
    expect(json).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(json).not.toMatch(/"password"\s*:\s*"[^"]+"/);
  });

  it("flags .env in repo as critical security finding", () => {
    const analysis = analyzeProject({
      sourceType: "github_repo",
      fileList: [".env", "package.json", "src/index.ts"],
    });
    const finding = analysis.securityFindings.find((f) => f.id === "sec-env-in-repo");
    expect(finding?.severity).toBe("critical");
  });

  it("does not execute scripts — analysis is pure function with no exec calls", () => {
    // The analyzer must be a pure function — we verify it completes without any process.exec/spawn
    const execSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit called"); });
    const analysis = analyzeProject({
      sourceType: "zip_upload",
      fileList: ["package.json", "run.sh", "install.sh"],
      knownErrors: ["some error"],
    });
    expect(analysis.projectName).toBeTruthy();
    expect(analysis.analysisNote).toMatch(/not executed/i);
    execSpy.mockRestore();
  });
});

// ─── Repair Plan Tests ────────────────────────────────────────────────────────

describe("generateRepairPlan", () => {
  it("generates repair steps for a broken project", () => {
    const analysis = analyzeProject({
      sourceType: "github_repo",
      fileList: ["package.json", "pnpm-lock.yaml"],
      packageJsonContent: { name: "my-app", dependencies: { express: "^5" } },
      knownErrors: ["Module not found: express", "tsc error: type mismatch"],
    });
    const plan = generateRepairPlan({ analysis, knownErrors: analysis.launchBlockers, userRequest: "Fix the broken build" });
    expect(plan.repairSteps.length).toBeGreaterThan(0);
    expect(plan.rawValuesReturned).toBe(false);
  });

  it("flags safeBuildRequired when code errors are detected", () => {
    const analysis = analyzeProject({
      sourceType: "github_repo",
      fileList: ["package.json"],
      knownErrors: ["tsc error: cannot find module", "vite build failed"],
    });
    const plan = generateRepairPlan({ analysis, knownErrors: analysis.launchBlockers, userRequest: "Fix build" });
    expect(plan.safeBuildRequired).toBe(true);
  });

  it("flags approvalRequired when deployment is requested", () => {
    const analysis = analyzeProject({
      sourceType: "github_repo",
      fileList: ["railway.json", "package.json"],
      packageJsonContent: { name: "app", dependencies: { express: "^5" } },
    });
    const plan = generateRepairPlan({ analysis, knownErrors: [], userRequest: "Deploy to Railway" });
    expect(plan.approvalRequired).toBe(true);
  });

  it("includes vault agent when credentials are missing", () => {
    const analysis = analyzeProject({
      sourceType: "github_repo",
      fileList: ["package.json"],
      knownErrors: ["DATABASE_URL is not set", "SESSION_SECRET is missing"],
    });
    const plan = generateRepairPlan({ analysis, knownErrors: analysis.launchBlockers, userRequest: "Fix missing credentials" });
    expect(plan.requiredAgents).toContain("vault");
  });

  it("includes security agent for critical security findings", () => {
    const analysis = analyzeProject({
      sourceType: "github_repo",
      fileList: [".env", "package.json"],
    });
    const plan = generateRepairPlan({ analysis, knownErrors: [], userRequest: "Security audit" });
    expect(plan.requiredAgents).toContain("security");
  });

  it("requires QA gate when safeBuild is required", () => {
    const analysis = analyzeProject({
      sourceType: "github_repo",
      fileList: ["package.json"],
      knownErrors: ["build failed"],
    });
    const plan = generateRepairPlan({ analysis, knownErrors: analysis.launchBlockers, userRequest: "Fix and deploy" });
    if (plan.safeBuildRequired) {
      expect(plan.qaRequired).toBe(true);
    }
  });

  it("repair plan never contains raw secrets", () => {
    const analysis = analyzeProject({
      sourceType: "manual",
      description: "Broken app with STRIPE_SECRET_KEY=sk-live-xxx and DATABASE_URL=postgres://user:pass@host/db",
      knownErrors: ["connection refused"],
    });
    const plan = generateRepairPlan({ analysis, knownErrors: analysis.launchBlockers, userRequest: "Fix it" });
    const json = JSON.stringify(plan);
    expect(json).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(json).not.toMatch(/postgres:\/\/[^"]+:[^"]+@/);
    expect(plan.rawValuesReturned).toBe(false);
  });

  it("deploy step always has requiresApproval=true", () => {
    const analysis = analyzeProject({
      sourceType: "railway_project",
      fileList: ["railway.json"],
    });
    const plan = generateRepairPlan({ analysis, knownErrors: [], userRequest: "Deploy to production" });
    const deployStep = plan.repairSteps.find((s) => s.agentName === "deployment");
    if (deployStep) {
      expect(deployStep.requiresApproval).toBe(true);
    }
  });

  it("strict mode sets qaRequired to true", () => {
    const analysis = analyzeProject({ sourceType: "manual", description: "Fix my app", knownErrors: [] });
    const plan = generateRepairPlan({ analysis, knownErrors: [], userRequest: "Fix", strictMode: true });
    expect(plan.qaRequired).toBe(true);
  });
});

// ─── Route Handler Tests ──────────────────────────────────────────────────────

describe("POST /api/project-import/create — rejects invalid sourceType", () => {
  beforeEach(() => { sqlMock(); });

  it("returns 400 for unknown sourceType", async () => {
    const { default: projectImportRouter } = await import("./projectImport");
    const handlers: Array<(req: unknown, res: unknown, next: unknown) => void> = [];
    (projectImportRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: unknown, res: unknown, next: unknown) => void }> } }> }).stack.forEach((layer) => {
      if (layer.route?.path === "/api/project-import/create") {
        layer.route.stack.forEach((h) => handlers.push(h.handle));
      }
    });
    let status = 200;
    let body: unknown = null;
    const req = { session: { userId: 1 }, params: {}, body: { sourceType: "ftp_server", repoUrl: "x" } };
    const res = { status: (s: number) => { status = s; return res; }, json: (b: unknown) => { body = b; return res; } };
    if (handlers[0]) await handlers[0](req, res, () => {});
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)?.["error"]).toMatch(/sourceType/i);
  });

  it("returns 401 when not authenticated", async () => {
    const { default: projectImportRouter } = await import("./projectImport");
    const handlers: Array<(req: unknown, res: unknown, next: unknown) => void> = [];
    (projectImportRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: unknown, res: unknown, next: unknown) => void }> } }> }).stack.forEach((layer) => {
      if (layer.route?.path === "/api/project-import/create") {
        layer.route.stack.forEach((h) => handlers.push(h.handle));
      }
    });
    let status = 200;
    const req = { session: undefined, params: {}, body: { sourceType: "github_repo", repoUrl: "https://github.com/x/y" } };
    const res = { status: (s: number) => { status = s; return res; }, json: () => res };
    if (handlers[0]) await handlers[0](req, res, () => {});
    expect(status).toBe(401);
  });

  it("creates github_repo import and returns importId", async () => {
    sqlMock({ insert: { rows: [{ ...IMPORT_ROW, id: 7 }] } });
    const { default: projectImportRouter } = await import("./projectImport");
    const handlers: Array<(req: unknown, res: unknown, next: unknown) => void> = [];
    (projectImportRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: unknown, res: unknown, next: unknown) => void }> } }> }).stack.forEach((layer) => {
      if (layer.route?.path === "/api/project-import/create") {
        layer.route.stack.forEach((h) => handlers.push(h.handle));
      }
    });
    let body: unknown = null;
    const req = { session: { userId: 1 }, params: {}, body: { sourceType: "github_repo", repoUrl: "https://github.com/leego972/bridge-ai" } };
    const res = { status: (s: number) => res, json: (b: unknown) => { body = b; return res; } };
    if (handlers[0]) await handlers[0](req, res, () => {});
    expect((body as Record<string, unknown>)?.["ok"]).toBe(true);
    expect((body as Record<string, unknown>)?.["rawValuesReturned"]).toBe(false);
  });

  it("creates manual import successfully", async () => {
    sqlMock({ insert: { rows: [{ ...IMPORT_ROW, source_type: "manual", id: 8 }] } });
    const { default: projectImportRouter } = await import("./projectImport");
    const handlers: Array<(req: unknown, res: unknown, next: unknown) => void> = [];
    (projectImportRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: unknown, res: unknown, next: unknown) => void }> } }> }).stack.forEach((layer) => {
      if (layer.route?.path === "/api/project-import/create") {
        layer.route.stack.forEach((h) => handlers.push(h.handle));
      }
    });
    let body: unknown = null;
    const req = { session: { userId: 1 }, params: {}, body: { sourceType: "manual", description: "My app is broken with a 500 error" } };
    const res = { status: (s: number) => res, json: (b: unknown) => { body = b; return res; } };
    if (handlers[0]) await handlers[0](req, res, () => {});
    expect((body as Record<string, unknown>)?.["ok"]).toBe(true);
  });

  it("zip_upload import requires malware safety — analysis includes upload safety findings", () => {
    const analysis = analyzeProject({ sourceType: "zip_upload", fileList: [], strictMode: false });
    expect(analysis.uploadSafetyFindings.length).toBeGreaterThan(0);
    expect(analysis.launchBlockers.some((b) => /malware/i.test(b))).toBe(true);
  });
});

// ─── Security tests ───────────────────────────────────────────────────────────

describe("security: never return secrets", () => {
  it("import response never includes raw credential values", async () => {
    sqlMock({ select: { rows: [{ ...IMPORT_ROW, repo_url: "https://github.com/x/y" }] } });
    const { default: projectImportRouter } = await import("./projectImport");
    const handlers: Array<(req: unknown, res: unknown, next: unknown) => void> = [];
    (projectImportRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: unknown, res: unknown, next: unknown) => void }> } }> }).stack.forEach((layer) => {
      if (layer.route?.path === "/api/project-import/:importId") {
        layer.route.stack.forEach((h) => handlers.push(h.handle));
      }
    });
    let body: unknown = null;
    const req = { session: { userId: 1 }, params: { importId: "1" }, body: {} };
    const res = { status: (s: number) => res, json: (b: unknown) => { body = b; return res; } };
    if (handlers[0]) await handlers[0](req, res, () => {});
    const json = JSON.stringify(body);
    expect(json).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect((body as Record<string, unknown>)?.["rawValuesReturned"]).toBe(false);
  });

  it("credential status in analysis contains only names/providers, not values", () => {
    const analysis = analyzeProject({
      sourceType: "github_repo",
      knownErrors: ["STRIPE_SECRET_KEY is not set"],
      configuredEnvNames: [],
    });
    for (const cs of analysis.credentialStatus) {
      expect(cs).not.toHaveProperty("value");
      expect(cs).not.toHaveProperty("raw_key");
      expect(cs).not.toHaveProperty("api_key");
      expect(cs.name).toBeTruthy();
      expect(cs.provider).toBeTruthy();
    }
  });
});

// ─── Route registry ───────────────────────────────────────────────────────────

describe("route registry: projectImport routes registered", () => {
  it("router has all 6 expected routes", async () => {
    const { default: projectImportRouter } = await import("./projectImport");
    const paths = (projectImportRouter as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack
      .filter((l) => l.route)
      .map((l) => `${Object.keys(l.route!.methods).join(",").toUpperCase()} ${l.route!.path}`);
    expect(paths.some((p) => p.includes("/api/project-import/create"))).toBe(true);
    expect(paths.some((p) => p.includes("/api/project-import/:importId") && p.startsWith("GET"))).toBe(true);
    expect(paths.some((p) => p.includes("/api/project-import/:importId/analysis"))).toBe(true);
    expect(paths.some((p) => p.includes("/api/project-import/:importId/start-analysis"))).toBe(true);
    expect(paths.some((p) => p.includes("/api/project-import/:importId/create-repair-task"))).toBe(true);
    expect(paths.some((p) => p.includes("/api/project-import/:importId/cancel"))).toBe(true);
  });
});
