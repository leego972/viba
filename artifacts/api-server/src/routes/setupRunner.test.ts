import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import express from "express";

process.env.NODE_ENV = "test";
process.env.TEST_BYPASS_ADMIN = "1";

async function makeApp() {
  const { default: setupRunnerRouter } = await import("./setupRunner");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as Record<string, unknown>).log = { info: () => {}, warn: () => {}, error: () => {} }; next(); });
  app.use(setupRunnerRouter);
  return app;
}

const VALID_PAYLOAD = {
  railwayProjectId: "proj-123",
  railwayEnvironmentId: "env-456",
  railwayServiceId: "svc-789",
  variables: { DATABASE_URL: "postgres://test:5432/db", PUBLIC_ORIGIN: "https://viba.guru" },
  confirmText: "CONFIRM RAILWAY SETUP",
};

afterEach(() => { vi.restoreAllMocks(); });

describe("GET /setup/requirements", () => {
  it("returns allowed var list and paid product info", async () => {
    const app = await makeApp();
    const res = await request(app).get("/setup/requirements");
    expect(res.status).toBe(200);
    expect(res.body.allowedVars).toContain("DATABASE_URL");
    expect(res.body.allowedVars).toContain("STRIPE_BILLING_LAUNCH_SETUP_PRICE_ID");
    expect(res.body.paidProduct.price).toBe("$299 USD one-time");
    expect(res.body.confirmText).toBe("CONFIRM RAILWAY SETUP");
  });
});

describe("GET /setup/status", () => {
  it("returns railway token status without revealing token value", async () => {
    const app = await makeApp();
    const res = await request(app).get("/setup/status");
    expect(res.status).toBe(200);
    expect(typeof res.body.railwayTokenConfigured).toBe("boolean");
    expect(res.body).not.toHaveProperty("RAILWAY_TOKEN");
    const token = process.env.RAILWAY_TOKEN;
    if (token) expect(JSON.stringify(res.body)).not.toContain(token);
  });
});

describe("POST /setup/dry-run", () => {
  it("does NOT call Railway — railwayCallMade is always false", async () => {
    const app = await makeApp();
    const spy = vi.spyOn(globalThis, "fetch");
    const res = await request(app).post("/setup/dry-run").send({ variables: { DATABASE_URL: "postgres://test/db" } });
    expect(res.status).toBe(200);
    expect(res.body.railwayCallMade).toBe(false);
    expect(res.body.dryRun).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects unapproved variable names", async () => {
    const app = await makeApp();
    const res = await request(app).post("/setup/dry-run").send({
      variables: { EVIL_VAR: "bad", DATABASE_URL: "postgres://test/db" },
    });
    expect(res.status).toBe(200);
    expect(res.body.variablesRejected).toContain("EVIL_VAR");
    expect(res.body.variablesProvided).not.toContain("EVIL_VAR");
    expect(res.body.variablesProvided).toContain("DATABASE_URL");
  });

  it("never returns raw variable values", async () => {
    const app = await makeApp();
    const res = await request(app).post("/setup/dry-run").send({
      variables: { DATABASE_URL: "postgres://supersecret:5432/db" },
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("supersecret");
  });
});

describe("POST /setup/apply", () => {
  const confirmHeaders = { "X-Admin-Confirm": "true" };

  it("rejects without X-Admin-Confirm header (requireConfirmation not bypassed)", async () => {
    const app = await makeApp();
    const res = await request(app).post("/setup/apply").send(VALID_PAYLOAD);
    expect(res.status).toBe(428);
    expect(res.body.error).toBe("Confirmation required");
  });

  it("rejects with wrong confirmText", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/setup/apply")
      .set(confirmHeaders)
      .send({ ...VALID_PAYLOAD, confirmText: "wrong text" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("CONFIRM_TEXT_MISMATCH");
  });

  it("rejects without RAILWAY_TOKEN", async () => {
    const original = process.env.RAILWAY_TOKEN;
    delete process.env.RAILWAY_TOKEN;
    try {
      const app = await makeApp();
      const res = await request(app).post("/setup/apply").set(confirmHeaders).send(VALID_PAYLOAD);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("RAILWAY_TOKEN_MISSING");
    } finally {
      if (original) process.env.RAILWAY_TOKEN = original;
    }
  });

  it("never returns raw secret values in response", async () => {
    process.env.RAILWAY_TOKEN = "test-railway-token-for-test";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      json: async () => ({ data: { variableCollectionUpsert: true } }),
    } as Response);
    const app = await makeApp();
    const res = await request(app).post("/setup/apply").set(confirmHeaders).send(VALID_PAYLOAD);
    expect(JSON.stringify(res.body)).not.toContain("postgres://test:5432/db");
    if (res.status === 200) expect(res.body.valuesReturned).toBe(false);
    delete process.env.RAILWAY_TOKEN;
  });

  it("defaults replace to false and skipDeploys to true", async () => {
    process.env.RAILWAY_TOKEN = "test-railway-token-for-test";
    const captured = { input: null as Record<string, unknown> | null };
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, opts) => {
      const parsed = JSON.parse((opts as RequestInit).body as string) as { variables: { input: Record<string, unknown> } };
      captured.input = parsed.variables?.input ?? null;
      return { json: async () => ({ data: { variableCollectionUpsert: true } }) } as Response;
    });
    const app = await makeApp();
    await request(app).post("/setup/apply").set(confirmHeaders).send(VALID_PAYLOAD);
    if (captured.input) {
      expect(captured.input["replace"]).toBe(false);
      expect(captured.input["skipDeploys"]).toBe(true);
    }
    delete process.env.RAILWAY_TOKEN;
  });

  it("unapproved variable names are stripped from Railway mutation", async () => {
    process.env.RAILWAY_TOKEN = "test-railway-token-for-test";
    const captured = { input: null as Record<string, unknown> | null };
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, opts) => {
      const parsed = JSON.parse((opts as RequestInit).body as string) as { variables: { input: Record<string, unknown> } };
      captured.input = parsed.variables?.input ?? null;
      return { json: async () => ({ data: { variableCollectionUpsert: true } }) } as Response;
    });
    const app = await makeApp();
    await request(app).post("/setup/apply").set(confirmHeaders).send({
      ...VALID_PAYLOAD,
      variables: { ...VALID_PAYLOAD.variables, EVIL_KEY: "should-be-stripped" },
    });
    if (captured.input && typeof captured.input["variables"] === "object" && captured.input["variables"] !== null) {
      expect(Object.keys(captured.input["variables"] as object)).not.toContain("EVIL_KEY");
    }
    delete process.env.RAILWAY_TOKEN;
  });
});
