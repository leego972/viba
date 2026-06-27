import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// vi.hoisted ensures mockQuery is available when vi.mock factory runs (ESM hoisting)
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockQuery, on: vi.fn(), end: vi.fn() },
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import assistedBrowserRouter from "./assistedBrowser";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: express.Request, _res, next) => {
    (req as unknown as Record<string, unknown>).session = { userId: 1 };
    next();
  });
  app.use(assistedBrowserRouter);
  return app;
}

const BASE_JOB = {
  id: "test-job-id-001",
  user_id: 1,
  template_id: "railway-env-vars",
  provider: "railway",
  target_url: "https://railway.app",
  status: "created",
  credit_state: "idle",
  current_step: null,
  waiting_for_type: null,
  waiting_for_reason: null,
  outputs_json: {},
  audit_json: [{ ts: "2026-01-01T00:00:00Z", event: "job_created" }],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  mockQuery.mockReset();
  // Default: table creation + main query both succeed
  mockQuery.mockResolvedValue({ rows: [] });
});

describe("GET /browser-operator/templates", () => {
  it("returns Railway, Stripe, GoDaddy, GitHub, SMTP templates", async () => {
    const app = makeApp();
    const res = await supertest(app).get("/browser-operator/templates");
    expect(res.status).toBe(200);
    const providers = res.body.templates.map((t: { provider: string }) => t.provider);
    expect(providers).toContain("railway");
    expect(providers).toContain("stripe");
    expect(providers).toContain("godaddy");
    expect(providers).toContain("github");
    expect(providers).toContain("smtp");
    expect(res.body.templates.length).toBeGreaterThanOrEqual(5);
  });
});

describe("POST /browser-operator/jobs", () => {
  it("returns a redacted job (no raw credential values)", async () => {
    // ensureTable = CREATE TABLE + CREATE INDEX, then INSERT
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] })  // CREATE INDEX
      .mockResolvedValueOnce({ rows: [{ ...BASE_JOB }] }); // INSERT

    const app = makeApp();
    const res = await supertest(app)
      .post("/browser-operator/jobs")
      .send({ template_id: "railway-env-vars", provider: "railway", target_url: "https://railway.app" });
    expect(res.status).toBe(201);
    const job = res.body.job;
    expect(job.id).toBe("test-job-id-001");
    expect(job.status).toBe("created");
    expect(job.credit_state).toBe("idle");
    // Must not leak any raw secrets
    expect(JSON.stringify(job)).not.toMatch(/password/i);
  });

  it("requires target_url", async () => {
    const app = makeApp();
    const res = await supertest(app)
      .post("/browser-operator/jobs")
      .send({ provider: "railway" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/target_url/i);
  });
});

describe("POST /browser-operator/jobs/:id/start", () => {
  it("sets status running and creditState consuming", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] }) // CREATE INDEX
      .mockResolvedValueOnce({ rows: [{ ...BASE_JOB, status: "running", credit_state: "consuming", current_step: "Opening browser" }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // appendAudit

    const app = makeApp();
    const res = await supertest(app)
      .post("/browser-operator/jobs/test-job-id-001/start")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe("running");
    expect(res.body.job.credit_state).toBe("consuming");
  });
});

describe("POST /browser-operator/jobs/:id/waiting-for-user", () => {
  it("sets status waiting_for_user_authorization and creditState paused_waiting_for_user", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] }) // CREATE INDEX
      .mockResolvedValueOnce({ rows: [{ ...BASE_JOB, status: "waiting_for_user_authorization", credit_state: "paused_waiting_for_user", waiting_for_type: "oauth", waiting_for_reason: "OAuth login required" }] })
      .mockResolvedValueOnce({ rows: [] }); // appendAudit

    const app = makeApp();
    const res = await supertest(app)
      .post("/browser-operator/jobs/test-job-id-001/waiting-for-user")
      .send({ waiting_for_type: "oauth", reason: "OAuth login required" });
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe("waiting_for_user_authorization");
    expect(res.body.job.credit_state).toBe("paused_waiting_for_user");
  });
});

describe("POST /browser-operator/jobs/:id/authorize", () => {
  it("resumes to running and consuming", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] }) // CREATE INDEX
      .mockResolvedValueOnce({ rows: [{ ...BASE_JOB, status: "running", credit_state: "consuming", waiting_for_type: null, waiting_for_reason: null }] })
      .mockResolvedValueOnce({ rows: [] }); // appendAudit

    const app = makeApp();
    const res = await supertest(app)
      .post("/browser-operator/jobs/test-job-id-001/authorize")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe("running");
    expect(res.body.job.credit_state).toBe("consuming");
    expect(res.body.job.waiting_for_type).toBeNull();
  });
});

describe("POST /browser-operator/jobs/:id/complete", () => {
  it("stops credits on complete", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] }) // CREATE INDEX
      .mockResolvedValueOnce({ rows: [{ ...BASE_JOB, status: "completed", credit_state: "completed", waiting_for_type: null }] })
      .mockResolvedValueOnce({ rows: [] }); // appendAudit

    const app = makeApp();
    const res = await supertest(app)
      .post("/browser-operator/jobs/test-job-id-001/complete")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe("completed");
    expect(res.body.job.credit_state).toBe("completed");
  });

  it("does not return raw credential values in outputs", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] }) // CREATE INDEX
      .mockResolvedValueOnce({ rows: [{ ...BASE_JOB, status: "completed", credit_state: "completed", outputs_json: {} }] })
      .mockResolvedValueOnce({ rows: [] }); // appendAudit

    const app = makeApp();
    const res = await supertest(app)
      .post("/browser-operator/jobs/test-job-id-001/complete")
      .send({ outputs: { RAILWAY_TOKEN: "should-not-appear" } });
    // outputs_json from the mock row is {} — raw values from body are never echoed
    expect(JSON.stringify(res.body)).not.toContain("should-not-appear");
  });
});
