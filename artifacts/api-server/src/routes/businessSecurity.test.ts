import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import businessSecurityRouter from "./businessSecurity";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(businessSecurityRouter);
  return app;
}

describe("GET /business-security/requirements", () => {
  it("returns required controls and launch blockers", async () => {
    const res = await request(makeApp()).get("/business-security/requirements");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.controls)).toBe(true);
    expect(Array.isArray(res.body.launchBlockers)).toBe(true);
    expect(res.body.app).toBe("VIBA");
  });

  it("never returns secret values", async () => {
    const res = await request(makeApp()).get("/business-security/requirements");
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/sk-/);
    expect(body).not.toMatch(/ghp_/);
    expect(body).not.toMatch(/whsec_/);
  });

  it("includes server, auth, payments, vault categories", async () => {
    const res = await request(makeApp()).get("/business-security/requirements");
    const ids = res.body.controls.map((c: { id: string }) => c.id);
    expect(ids).toContain("security_headers");
    expect(ids).toContain("session_secret");
    expect(ids).toContain("credential_encryption_key");
    expect(ids).toContain("rate_limit_auth");
  });
});

describe("POST /business-security/plan", () => {
  it("includes upload security requirements when acceptsUploads=true", async () => {
    const res = await request(makeApp()).post("/business-security/plan").send({ acceptsUploads: true });
    expect(res.status).toBe(200);
    expect(res.body.uploadSecurityRequirements.length).toBeGreaterThan(0);
    const text = res.body.uploadSecurityRequirements.join("\n");
    expect(text).toMatch(/malware/i);
    expect(text).toMatch(/file type/i);
  });

  it("includes browser security requirements when hasBrowserOperator=true", async () => {
    const res = await request(makeApp()).post("/business-security/plan").send({ hasBrowserOperator: true });
    expect(res.status).toBe(200);
    const text = res.body.browserSecurityRequirements.join("\n");
    expect(text).toMatch(/download/i);
  });

  it("includes payment controls when hasPayments=true", async () => {
    const res = await request(makeApp()).post("/business-security/plan").send({ hasPayments: true });
    expect(res.status).toBe(200);
    expect(res.body.requiredControls).toContain("Stripe Webhook Signature Verification");
  });

  it("returns launch blockers list", async () => {
    const res = await request(makeApp()).post("/business-security/plan").send({});
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.launchBlockers)).toBe(true);
  });
});

describe("POST /business-security/build-hardening", () => {
  it("returns checks array with pass/fail/warn statuses", async () => {
    const res = await request(makeApp()).post("/business-security/build-hardening");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.checks)).toBe(true);
    const statuses = res.body.checks.map((c: { status: string }) => c.status);
    expect(statuses.every((s: string) => ["pass", "fail", "warn"].includes(s))).toBe(true);
  });

  it("includes a summary and readyForLaunch boolean", async () => {
    const res = await request(makeApp()).post("/business-security/build-hardening");
    expect(typeof res.body.readyForLaunch).toBe("boolean");
    expect(typeof res.body.summary).toBe("string");
  });
});
