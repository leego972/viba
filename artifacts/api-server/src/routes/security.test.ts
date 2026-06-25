import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import securityRouter from "./security";
import { requireSession } from "../middlewares/requireSession";

// Build a minimal express app with session bypass so tests aren't blocked by auth
function buildApp() {
  const app = express();
  app.use(express.json());

  // Inject a fake session so requireSession passes
  app.use((_req, _res, next) => {
    (_req as unknown as { session: { userId: string } }).session = { userId: "test-user-1" };
    next();
  });

  app.use(securityRouter);
  return app;
}

let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  app = buildApp();
});

describe("GET /api/security/status", () => {
  it("returns 200 with security status object", async () => {
    const res = await request(app).get("/api/security/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      securityPolicy: { enabled: true },
      responseSecretGuard: { enabled: true },
      rateLimits: { enabled: true },
      vaultSafety: { encrypted: true, rawValuesReturnedToClient: false },
      byokSafety: { rawKeyReturnedToClient: false },
      urlSafety: { ssrfProtectionEnabled: true },
      promptInjectionSafety: { enabled: true },
      paymentSafety: { webhookSignatureRequired: true },
      deploymentSafety: { safeBuildRequired: true },
    });
  });

  it("never returns rawValuesReturned: true", async () => {
    const res = await request(app).get("/api/security/status");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('"rawValuesReturned":true');
    expect(body).not.toContain('"rawKeyReturnedToClient":true');
    expect(body).not.toContain('"rawValuesReturnedToClient":true');
  });

  it("includes generatedAt timestamp", async () => {
    const res = await request(app).get("/api/security/status");
    expect(res.body.generatedAt).toBeTruthy();
    expect(new Date(res.body.generatedAt).toString()).not.toBe("Invalid Date");
  });

  it("does not expose any secret-looking fields", async () => {
    const res = await request(app).get("/api/security/status");
    const body = JSON.stringify(res.body);
    const secretPatterns = ["sk-", "ghp_", "password", "webhook_secret"];
    for (const pat of secretPatterns) {
      expect(body.toLowerCase()).not.toContain(pat.toLowerCase());
    }
  });

  it("includes QA gate integration block-list", async () => {
    const res = await request(app).get("/api/security/status");
    expect(res.body.qaGateIntegration?.blocksOn).toContain("response_leak_guard_failure");
    expect(res.body.qaGateIntegration?.blocksOn).toContain("deployment_without_safe_build");
    expect(res.body.qaGateIntegration?.blocksOn).toContain("cross_user_data_leakage");
  });
});

describe("GET /api/security/blockers", () => {
  it("returns 200 with blockers array", async () => {
    const res = await request(app).get("/api/security/blockers");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.blockers)).toBe(true);
    expect(res.body.blockers.length).toBeGreaterThan(0);
  });

  it("each blocker has required fields", async () => {
    const res = await request(app).get("/api/security/blockers");
    for (const b of res.body.blockers) {
      expect(b.id).toBeTruthy();
      expect(b.title).toBeTruthy();
      expect(b.status).toBeTruthy();
      expect(b.severity).toBeTruthy();
    }
  });

  it("includes critical blockers: response guard, vault, stripe", async () => {
    const res = await request(app).get("/api/security/blockers");
    const ids = res.body.blockers.map((b: { id: string }) => b.id);
    expect(ids).toContain("response_secret_guard");
    expect(ids).toContain("vault_encrypted");
    expect(ids).toContain("stripe_webhook_sig");
  });

  it("does not expose secrets in blocker descriptions", async () => {
    const res = await request(app).get("/api/security/blockers");
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    expect(body).not.toMatch(/ghp_[A-Za-z0-9]{36,}/);
  });
});

describe("Route registry — security route mounted", () => {
  it("security route is accessible", async () => {
    const res = await request(app).get("/api/security/status");
    expect(res.status).not.toBe(404);
  });
});
