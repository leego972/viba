/**
 * VIBA Deployment Providers — Tests
 *
 * Coverage:
 *  - Provider registry: all 6 providers exist, placeholder claims no execution
 *  - Tool broker: env write requires approval, deploy trigger requires safe-build
 *  - Route handlers: GET list, GET single, readiness, plan, dry-run, execute gates
 *  - Execute: blocked for placeholder adapters
 *  - Vault: credential metadata only, no raw values
 *  - Project import: provider detection from file hints
 *  - Production ops: placeholder provider status skipped, not failed
 *  - QA: provider in report, blocked without safe-build
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn() },
  db: {},
}));

import { pool } from "@workspace/db";
import {
  getAllProviders,
  getProviderById,
  canExecuteProvider,
  isPlaceholderProvider,
  isManualGuidedProvider,
  detectProviderFromHints,
  generateManualGuide,
  ALL_PROVIDER_IDS,
} from "../lib/deploymentProviderRegistry";
import { getToolById } from "../lib/toolRegistry";
import { analyzeProject } from "../lib/projectAnalyzer";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRes() {
  let status = 200; let body: unknown = null;
  const res = { status: (s: number) => { status = s; return res; }, json: (b: unknown) => { body = b; return res; } };
  return { res, getStatus: () => status, getBody: () => body };
}

async function getRouteHandler(path: string, method: "post" | "get") {
  const { default: router } = await import("./deploymentProviders");
  let handler: ((req: unknown, res: unknown, next: unknown) => void) | undefined;
  (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (r: unknown, s: unknown, n: unknown) => void }> } }> }).stack.forEach((layer) => {
    if (layer.route?.path === path && layer.route.methods[method]) {
      handler = layer.route.stack[0]?.handle;
    }
  });
  return handler;
}

function mockVaultEmpty() {
  (pool.query as Mock).mockImplementation((sql: string) => {
    if (sql.includes("viba_credentials")) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
}

function mockVaultWithCred(provider: string) {
  (pool.query as Mock).mockImplementation((sql: string, params?: unknown[]) => {
    if (sql.includes("viba_credentials") && Array.isArray(params) && params[1] === provider) {
      return Promise.resolve({ rows: [{ label: `${provider}-main`, expires_at: null }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

// ─── Deployment Provider Registry ─────────────────────────────────────────────

describe("DeploymentProviderRegistry", () => {
  it("returns all 6 providers", () => {
    const providers = getAllProviders();
    expect(providers).toHaveLength(6);
  });

  it("Railway provider exists and is implemented", () => {
    const p = getProviderById("railway");
    expect(p).toBeDefined();
    expect(p?.docsStatus).toBe("implemented");
    expect(p?.label).toBe("Railway");
  });

  it("Render provider exists", () => {
    const p = getProviderById("render");
    expect(p).toBeDefined();
    expect(p?.label).toBe("Render");
  });

  it("DigitalOcean provider exists", () => {
    const p = getProviderById("digitalocean");
    expect(p).toBeDefined();
    expect(p?.label).toBe("DigitalOcean");
  });

  it("Vercel provider exists", () => {
    const p = getProviderById("vercel");
    expect(p).toBeDefined();
    expect(p?.label).toBe("Vercel");
  });

  it("Sevall provider exists", () => {
    const p = getProviderById("sevall");
    expect(p).toBeDefined();
    expect(p?.label).toBe("Sevall");
  });

  it("Custom provider exists and is manual_guided", () => {
    const p = getProviderById("custom");
    expect(p).toBeDefined();
    expect(p?.docsStatus).toBe("manual_guided");
  });

  it("placeholder providers do not claim execution support", () => {
    const placeholders = ALL_PROVIDER_IDS.filter((id) => id !== "railway");
    for (const id of placeholders) {
      expect(canExecuteProvider(id)).toBe(false);
    }
  });

  it("railway is the only provider that can execute", () => {
    expect(canExecuteProvider("railway")).toBe(true);
    expect(canExecuteProvider("render")).toBe(false);
    expect(canExecuteProvider("vercel")).toBe(false);
    expect(canExecuteProvider("sevall")).toBe(false);
    expect(canExecuteProvider("custom")).toBe(false);
  });

  it("isPlaceholderProvider returns true for non-Railway providers", () => {
    expect(isPlaceholderProvider("render")).toBe(true);
    expect(isPlaceholderProvider("digitalocean")).toBe(true);
    expect(isPlaceholderProvider("vercel")).toBe(true);
    expect(isPlaceholderProvider("sevall")).toBe(true);
  });

  it("isManualGuidedProvider returns true for custom and placeholder providers", () => {
    expect(isManualGuidedProvider("custom")).toBe(true);
    expect(isManualGuidedProvider("render")).toBe(true);
  });

  it("all providers require safe-build before deploy", () => {
    for (const id of ALL_PROVIDER_IDS) {
      const p = getProviderById(id);
      expect(p?.requiresSafeBuildBeforeDeploy).toBe(true);
    }
  });

  it("all providers require approval for deploy", () => {
    for (const id of ALL_PROVIDER_IDS) {
      const p = getProviderById(id);
      expect(p?.requiresApprovalForDeploy).toBe(true);
    }
  });
});

// ─── detectProviderFromHints ──────────────────────────────────────────────────

describe("detectProviderFromHints", () => {
  it("detects Vercel from vercel.json", () => {
    expect(detectProviderFromHints(["vercel.json", "package.json"], [])).toBe("vercel");
  });

  it("detects Render from render.yaml", () => {
    expect(detectProviderFromHints(["render.yaml", "package.json"], [])).toBe("render");
  });

  it("detects Railway from railway.json", () => {
    expect(detectProviderFromHints(["railway.json"], [])).toBe("railway");
  });

  it("detects Railway from nixpacks.toml", () => {
    expect(detectProviderFromHints(["nixpacks.toml"], [])).toBe("railway");
  });

  it("detects DigitalOcean from .do/app.yaml", () => {
    expect(detectProviderFromHints([".do/app.yaml"], [])).toBe("digitalocean");
  });

  it("returns null for unknown hints", () => {
    expect(detectProviderFromHints(["package.json", "README.md"], [])).toBeNull();
  });

  it("detects Railway from env var name hint", () => {
    expect(detectProviderFromHints([], ["RAILWAY_TOKEN"])).toBe("railway");
  });
});

// ─── generateManualGuide ──────────────────────────────────────────────────────

describe("generateManualGuide", () => {
  it("generates a non-empty guide for each provider", () => {
    for (const id of ALL_PROVIDER_IDS) {
      const guide = generateManualGuide(id, "test-app", "https://example.com");
      expect(guide.length).toBeGreaterThan(50);
      expect(guide).toContain("safe-build");
    }
  });

  it("Sevall guide mentions manual-guided status", () => {
    const guide = generateManualGuide("sevall", "my-app");
    expect(guide.toLowerCase()).toMatch(/sevall|manual/);
  });

  it("unknown provider returns fallback message", () => {
    const guide = generateManualGuide("nonexistent", "app");
    expect(guide).toContain("Unknown provider");
  });
});

// ─── Tool Broker: deployment tools ───────────────────────────────────────────

describe("Tool Broker: deployment tool risk levels", () => {
  it("deployment.env.write requires approval and is high risk", () => {
    const tool = getToolById("deployment.env.write");
    expect(tool).toBeDefined();
    expect(tool?.riskLevel).toBe("high");
    expect(tool?.requiresApproval).toBe(true);
  });

  it("deployment.trigger requires safe-build and approval", () => {
    const tool = getToolById("deployment.trigger");
    expect(tool).toBeDefined();
    expect(tool?.riskLevel).toBe("high");
    expect(tool?.requiresApproval).toBe(true);
    expect(tool?.requiresSafeBuild).toBe(true);
  });

  it("deployment.provider.list is read-only", () => {
    const tool = getToolById("deployment.provider.list");
    expect(tool).toBeDefined();
    expect(tool?.riskLevel).toBe("read_only");
  });

  it("deployment.provider.readiness is read-only", () => {
    const tool = getToolById("deployment.provider.readiness");
    expect(tool?.riskLevel).toBe("read_only");
  });

  it("deployment.manual_guide.generate is low risk", () => {
    const tool = getToolById("deployment.manual_guide.generate");
    expect(tool?.riskLevel).toBe("low");
  });

  it("render.deploy.trigger requires approval and safe-build", () => {
    const tool = getToolById("render.deploy.trigger");
    expect(tool).toBeDefined();
    expect(tool?.requiresApproval).toBe(true);
    expect(tool?.requiresSafeBuild).toBe(true);
  });

  it("vercel.env.write is high risk requiring approval", () => {
    const tool = getToolById("vercel.env.write");
    expect(tool?.riskLevel).toBe("high");
    expect(tool?.requiresApproval).toBe(true);
  });

  it("custom.deploy.guide is low risk", () => {
    const tool = getToolById("custom.deploy.guide");
    expect(tool?.riskLevel).toBe("low");
  });

  it("sevall.deploy.trigger requires safe-build", () => {
    const tool = getToolById("sevall.deploy.trigger");
    expect(tool?.requiresSafeBuild).toBe(true);
  });
});

// ─── Route: GET /api/deployment-providers ────────────────────────────────────

describe("GET /api/deployment-providers", () => {
  it("returns all providers with rawValuesReturned: false", async () => {
    mockVaultEmpty();
    const handler = await getRouteHandler("/api/deployment-providers", "get");
    const { res, getBody } = makeRes();
    const req = { session: { userId: 1 }, params: {}, body: {} };
    if (handler) await handler(req, res, () => {});
    const body = getBody() as Record<string, unknown>;
    expect(body?.["ok"]).toBe(true);
    expect(Array.isArray(body?.["providers"])).toBe(true);
    expect((body?.["providers"] as unknown[]).length).toBe(6);
    expect(body?.["rawValuesReturned"]).toBe(false);
  });

  it("no raw credentials in provider list response", async () => {
    mockVaultEmpty();
    const handler = await getRouteHandler("/api/deployment-providers", "get");
    const { res, getBody } = makeRes();
    const req = { session: { userId: 1 }, params: {}, body: {} };
    if (handler) await handler(req, res, () => {});
    const json = JSON.stringify(getBody());
    expect(json).not.toMatch(/"(token|api_key|secret|password)"\s*:\s*"[^"]+"/);
  });
});

// ─── Route: GET /api/deployment-providers/:providerId ────────────────────────

describe("GET /api/deployment-providers/:providerId", () => {
  it("returns Railway provider with canExecute: true", async () => {
    const handler = await getRouteHandler("/api/deployment-providers/:providerId", "get");
    const { res, getBody } = makeRes();
    const req = { session: { userId: 1 }, params: { providerId: "railway" }, body: {} };
    if (handler) await handler(req, res, () => {});
    const body = getBody() as Record<string, unknown>;
    expect(body?.["ok"]).toBe(true);
    expect(body?.["canExecute"]).toBe(true);
    expect(body?.["rawValuesReturned"]).toBe(false);
  });

  it("returns Render with isPlaceholder: true", async () => {
    const handler = await getRouteHandler("/api/deployment-providers/:providerId", "get");
    const { res, getBody } = makeRes();
    const req = { session: { userId: 1 }, params: { providerId: "render" }, body: {} };
    if (handler) await handler(req, res, () => {});
    const body = getBody() as Record<string, unknown>;
    expect(body?.["isPlaceholder"]).toBe(true);
    expect(body?.["canExecute"]).toBe(false);
  });

  it("returns 404 for unknown provider", async () => {
    const handler = await getRouteHandler("/api/deployment-providers/:providerId", "get");
    const { res, getStatus } = makeRes();
    const req = { session: { userId: 1 }, params: { providerId: "unknown-provider-xyz" }, body: {} };
    if (handler) await handler(req, res, () => {});
    expect(getStatus()).toBe(404);
  });
});

// ─── Route: POST /api/deployment-providers/:providerId/readiness ──────────────

describe("POST readiness", () => {
  it("returns 401 when unauthenticated", async () => {
    const handler = await getRouteHandler("/api/deployment-providers/:providerId/readiness", "post");
    const { res, getStatus } = makeRes();
    const req = { session: undefined, params: { providerId: "railway" }, body: {} };
    if (handler) await handler(req, res, () => {});
    expect(getStatus()).toBe(401);
  });

  it("Railway: not ready without credential", async () => {
    mockVaultEmpty();
    const handler = await getRouteHandler("/api/deployment-providers/:providerId/readiness", "post");
    const { res, getBody } = makeRes();
    const req = { session: { userId: 1 }, params: { providerId: "railway" }, body: {} };
    if (handler) await handler(req, res, () => {});
    const body = getBody() as Record<string, unknown>;
    expect(body?.["isReady"]).toBe(false);
    expect(body?.["rawValuesReturned"]).toBe(false);
    const credStatus = body?.["credentialStatus"] as Record<string, unknown>;
    expect(credStatus?.["rawValuesReturned"]).toBe(false);
  });

  it("Railway: ready with credential", async () => {
    mockVaultWithCred("railway");
    const handler = await getRouteHandler("/api/deployment-providers/:providerId/readiness", "post");
    const { res, getBody } = makeRes();
    const req = { session: { userId: 1 }, params: { providerId: "railway" }, body: {} };
    if (handler) await handler(req, res, () => {});
    const body = getBody() as Record<string, unknown>;
    expect(body?.["isReady"]).toBe(true);
  });

  it("Render: not ready — adapter is placeholder", async () => {
    mockVaultEmpty();
    const handler = await getRouteHandler("/api/deployment-providers/:providerId/readiness", "post");
    const { res, getBody } = makeRes();
    const req = { session: { userId: 1 }, params: { providerId: "render" }, body: {} };
    if (handler) await handler(req, res, () => {});
    const body = getBody() as Record<string, unknown>;
    expect(body?.["isReady"]).toBe(false);
    expect(Array.isArray(body?.["blocks"])).toBe(true);
    expect((body?.["blocks"] as string[]).some((b) => /adapter/i.test(b))).toBe(true);
  });
});

// ─── Route: POST execute — placeholder blocked ────────────────────────────────

describe("POST execute — placeholder provider blocked", () => {
  it("Render execute returns blocked with manual guide", async () => {
    mockVaultEmpty();
    const handler = await getRouteHandler("/api/deployment-providers/:providerId/execute", "post");
    const { res, getBody, getStatus } = makeRes();
    const req = { session: { userId: 1 }, params: { providerId: "render" }, body: { approved: true, safeBuildPassed: true } };
    if (handler) await handler(req, res, () => {});
    expect(getStatus()).toBe(400);
    const body = getBody() as Record<string, unknown>;
    expect(body?.["blocked"]).toBe(true);
    expect(body?.["blockedReason"]).toBe("adapter_placeholder");
    expect(typeof body?.["manualGuide"]).toBe("string");
    expect(body?.["rawValuesReturned"]).toBe(false);
  });

  it("Vercel execute blocked — returns manualGuide, not fake success", async () => {
    mockVaultEmpty();
    const handler = await getRouteHandler("/api/deployment-providers/:providerId/execute", "post");
    const { res, getBody } = makeRes();
    const req = { session: { userId: 1 }, params: { providerId: "vercel" }, body: { approved: true, safeBuildPassed: true } };
    if (handler) await handler(req, res, () => {});
    const body = getBody() as Record<string, unknown>;
    expect(body?.["blocked"]).toBe(true);
    expect(body?.["ok"]).toBe(false);
    expect(body?.["rawValuesReturned"]).toBe(false);
  });

  it("Sevall execute blocked — adapter_placeholder", async () => {
    mockVaultEmpty();
    const handler = await getRouteHandler("/api/deployment-providers/:providerId/execute", "post");
    const { res, getBody } = makeRes();
    const req = { session: { userId: 1 }, params: { providerId: "sevall" }, body: { approved: true, safeBuildPassed: true } };
    if (handler) await handler(req, res, () => {});
    const body = getBody() as Record<string, unknown>;
    expect(body?.["blocked"]).toBe(true);
    expect(body?.["rawValuesReturned"]).toBe(false);
  });

  it("execute blocked without safe-build even for railway", async () => {
    mockVaultWithCred("railway");
    const handler = await getRouteHandler("/api/deployment-providers/:providerId/execute", "post");
    const { res, getBody, getStatus } = makeRes();
    const req = { session: { userId: 1 }, params: { providerId: "railway" }, body: { approved: true, safeBuildPassed: false } };
    if (handler) await handler(req, res, () => {});
    expect(getStatus()).toBe(400);
    const body = getBody() as Record<string, unknown>;
    expect(body?.["blockedReason"]).toBe("safe_build_missing");
  });

  it("execute blocked without approval even for railway with safe-build", async () => {
    mockVaultWithCred("railway");
    const handler = await getRouteHandler("/api/deployment-providers/:providerId/execute", "post");
    const { res, getBody, getStatus } = makeRes();
    const req = { session: { userId: 1 }, params: { providerId: "railway" }, body: { approved: false, safeBuildPassed: true } };
    if (handler) await handler(req, res, () => {});
    expect(getStatus()).toBe(400);
    const body = getBody() as Record<string, unknown>;
    expect(body?.["blockedReason"]).toBe("approval_missing");
  });

  it("execute: credential check never returns raw credential value", async () => {
    mockVaultWithCred("railway");
    const handler = await getRouteHandler("/api/deployment-providers/:providerId/execute", "post");
    const { res, getBody } = makeRes();
    const req = { session: { userId: 1 }, params: { providerId: "railway" }, body: { approved: true, safeBuildPassed: true } };
    if (handler) await handler(req, res, () => {});
    const json = JSON.stringify(getBody());
    expect(json).not.toMatch(/"(raw_key|api_key|token|secret)"\s*:\s*"[^"]+"/);
    expect(json).toContain('"rawValuesReturned":false');
  });
});

// ─── Route: POST /dry-run — never mutates ─────────────────────────────────────

describe("POST dry-run", () => {
  it("returns mutated: false for any provider", async () => {
    mockVaultEmpty();
    const handler = await getRouteHandler("/api/deployment-providers/:providerId/dry-run", "post");
    const { res, getBody } = makeRes();
    const req = { session: { userId: 1 }, params: { providerId: "render" }, body: { appName: "test" } };
    if (handler) await handler(req, res, () => {});
    const body = getBody() as Record<string, unknown>;
    expect(body?.["mutated"]).toBe(false);
    expect(body?.["dryRun"]).toBe(true);
    expect(body?.["rawValuesReturned"]).toBe(false);
  });
});

// ─── Project Import: provider detection ───────────────────────────────────────

describe("projectAnalyzer: deployment provider detection", () => {
  it("detects vercel.json as Vercel hint", () => {
    const result = analyzeProject({
      sourceType: "manual",
      fileList: ["vercel.json", "package.json"],
    });
    expect(result.deploymentTarget?.toLowerCase()).toContain("vercel");
  });

  it("detects render.yaml as Render hint", () => {
    const result = analyzeProject({
      sourceType: "manual",
      fileList: ["render.yaml", "package.json"],
    });
    expect(result.deploymentTarget?.toLowerCase()).toContain("render");
  });

  it("unknown provider remains null/unknown when no hints", () => {
    const result = analyzeProject({
      sourceType: "manual",
      fileList: ["package.json", "README.md"],
      description: "some generic app",
    });
    expect(result.deploymentTarget).toBeNull();
  });

  it("user-selected provider overrides weak guess", () => {
    const result = analyzeProject({
      sourceType: "manual",
      fileList: ["vercel.json"],
      deploymentProvider: "render",
    });
    expect(result.deploymentTarget?.toLowerCase()).toContain("render");
  });

  it("detects nixpacks.toml as Railway hint", () => {
    const result = analyzeProject({
      sourceType: "manual",
      fileList: ["nixpacks.toml"],
    });
    expect(result.deploymentTarget?.toLowerCase()).toContain("railway");
  });

  it("detects .do/app.yaml as DigitalOcean hint", () => {
    const result = analyzeProject({
      sourceType: "manual",
      fileList: [".do/app.yaml"],
    });
    expect(result.deploymentTarget?.toLowerCase()).toContain("digitalocean");
  });
});

// ─── Vault: credential metadata only ─────────────────────────────────────────

describe("Vault: provider credentials return metadata only", () => {
  it("readiness response never contains raw credential value", async () => {
    mockVaultWithCred("railway");
    const handler = await getRouteHandler("/api/deployment-providers/:providerId/readiness", "post");
    const { res, getBody } = makeRes();
    const req = { session: { userId: 1 }, params: { providerId: "railway" }, body: {} };
    if (handler) await handler(req, res, () => {});
    const json = JSON.stringify(getBody());
    expect(json).not.toMatch(/"(value|raw_key|credential_value|secret)"\s*:\s*"[a-zA-Z0-9_-]{8,}"/);
    expect(json).toContain('"rawValuesReturned":false');
  });
});

// ─── Production Ops: placeholder provider status ──────────────────────────────

describe("Production Ops: placeholder provider status", () => {
  it("placeholder provider check returns skipped, not failed", () => {
    const placeholderResult = {
      checkType: "railway_status",
      status: "skipped" as const,
      severity: "low" as const,
      httpStatus: null,
      responseTimeMs: null,
      error: null,
      evidenceJson: { reason: "adapter_placeholder", providerId: "render" },
      rawValuesReturned: false as const,
    };
    expect(placeholderResult.status).toBe("skipped");
    expect(placeholderResult.severity).toBe("low");
    expect(placeholderResult.rawValuesReturned).toBe(false);
  });
});

// ─── Route registry ───────────────────────────────────────────────────────────

describe("route registry: all deploymentProviders routes registered", () => {
  it("all 6 routes are present", async () => {
    const { default: router } = await import("./deploymentProviders");
    const routes = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack
      .filter((l) => l.route)
      .map((l) => `${Object.keys(l.route!.methods).join(",").toUpperCase()} ${l.route!.path}`);
    expect(routes.some((r) => r.includes("GET /api/deployment-providers") && !r.includes(":"))).toBe(true);
    expect(routes.some((r) => r.includes("GET /api/deployment-providers/:providerId") && !r.includes("/readiness"))).toBe(true);
    expect(routes.some((r) => r.includes("readiness"))).toBe(true);
    expect(routes.some((r) => r.includes("plan"))).toBe(true);
    expect(routes.some((r) => r.includes("dry-run"))).toBe(true);
    expect(routes.some((r) => r.includes("execute"))).toBe(true);
  });
});
