import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

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

function mockEnsureTable() {
  for (let i = 0; i < 7; i += 1) {
    mockQuery.mockResolvedValueOnce({ rows: [] });
  }
}

const BASE_JOB = {
  id: "test-job-id-001",
  user_id: 1,
  template_id: "railway-env-vars",
  provider: "railway",
  target_url: "https://railway.app",
  status: "created",
  credit_state: "idle",
  current_step: "Created. Ready to start.",
  last_url: "https://railway.app",
  checkpoint_json: {},
  waiting_for_type: null,
  waiting_for_reason: null,
  authorization_expires_at: null,
  outputs_json: {},
  audit_json: [{ ts: "2026-01-01T00:00:00Z", event: "job_created" }],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  mockQuery.mockReset();
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
    expect(res.body.valuesReturned).toBe(false);
  });
});

describe("POST /browser-operator/jobs", () => {
  it("creates a redacted job", async () => {
    mockEnsureTable();
    mockQuery.mockResolvedValueOnce({ rows: [{ ...BASE_JOB }] });

    const app = makeApp();
    const res = await supertest(app)
      .post("/browser-operator/jobs")
      .send({ template_id: "railway-env-vars", provider: "railway", target_url: "https://railway.app" });

    expect(res.status).toBe(201);
    expect(res.body.job.id).toBe("test-job-id-001");
    expect(res.body.job.status).toBe("created");
    expect(res.body.job.credit_state).toBe("idle");
    expect(JSON.stringify(res.body)).not.toContain("should-not-appear");
  });

  it("requires target_url when no template supplies one", async () => {
    mockEnsureTable();
    const app = makeApp();
    const res = await supertest(app).post("/browser-operator/jobs").send({ provider: "custom" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/target_url/i);
  });
});

describe("browser operator lifecycle", () => {
  it("start sets running and consuming", async () => {
    mockEnsureTable();
    mockQuery.mockResolvedValueOnce({ rows: [{ ...BASE_JOB, status: "running", credit_state: "consuming", current_step: "Opening browser" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = makeApp();
    const res = await supertest(app).post("/browser-operator/jobs/test-job-id-001/start").send({});
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe("running");
    expect(res.body.job.credit_state).toBe("consuming");
  });

  it("authorization-required sets provider-specific waiting status and pauses credits", async () => {
    mockEnsureTable();
    mockQuery.mockResolvedValueOnce({ rows: [{
      ...BASE_JOB,
      status: "waiting_for_oauth",
      credit_state: "paused_waiting_for_user",
      waiting_for_type: "oauth",
      waiting_for_reason: "OAuth approval required",
      authorization_expires_at: "2026-01-01T00:15:00Z",
    }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = makeApp();
    const res = await supertest(app)
      .post("/browser-operator/jobs/test-job-id-001/authorization-required")
      .send({ authorization_type: "oauth", reason: "OAuth approval required", approved_action: "continue dashboard login" });

    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe("waiting_for_oauth");
    expect(res.body.job.credit_state).toBe("paused_waiting_for_user");
    expect(res.body.job.waiting_for_type).toBe("oauth");
  });

  it("does not pause for retryable browser errors", async () => {
    mockEnsureTable();
    const app = makeApp();
    const res = await supertest(app)
      .post("/browser-operator/jobs/test-job-id-001/authorization-required")
      .send({ authorization_type: "manual_approval", reason: "missing selector on slow network" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("retry_instead_of_pause");
  });

  it("authorize moves job to resuming and consuming", async () => {
    mockEnsureTable();
    mockQuery.mockResolvedValueOnce({ rows: [{ ...BASE_JOB, status: "resuming", credit_state: "consuming", waiting_for_type: null, waiting_for_reason: null }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = makeApp();
    const res = await supertest(app).post("/browser-operator/jobs/test-job-id-001/authorize").send({});
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe("resuming");
    expect(res.body.job.credit_state).toBe("consuming");
  });

  it("resume moves resuming job back to running", async () => {
    mockEnsureTable();
    mockQuery.mockResolvedValueOnce({ rows: [{ ...BASE_JOB, status: "running", credit_state: "consuming", current_step: "Browser work resumed." }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = makeApp();
    const res = await supertest(app).post("/browser-operator/jobs/test-job-id-001/resume").send({});
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe("running");
    expect(res.body.job.credit_state).toBe("consuming");
  });

  it("deny pauses the job without consuming credits", async () => {
    mockEnsureTable();
    mockQuery.mockResolvedValueOnce({ rows: [{ ...BASE_JOB, status: "paused", credit_state: "idle", current_step: "Authorization denied. Job paused." }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = makeApp();
    const res = await supertest(app).post("/browser-operator/jobs/test-job-id-001/deny").send({});
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe("paused");
    expect(res.body.job.credit_state).toBe("idle");
  });

  it("complete stops credits and redacts outputs", async () => {
    mockEnsureTable();
    mockQuery.mockResolvedValueOnce({ rows: [{ ...BASE_JOB, status: "completed", credit_state: "stopped", outputs_json: { RAILWAY_TOKEN: "REDACTED", PUBLIC_ORIGIN: "https://viba.guru" } }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = makeApp();
    const res = await supertest(app)
      .post("/browser-operator/jobs/test-job-id-001/complete")
      .send({ outputs: { RAILWAY_TOKEN: "should-not-appear", PUBLIC_ORIGIN: "https://viba.guru" } });

    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe("completed");
    expect(res.body.job.credit_state).toBe("stopped");
    expect(JSON.stringify(res.body)).not.toContain("should-not-appear");
  });
});

describe("read-only job data routes", () => {
  it("returns audit trail", async () => {
    mockEnsureTable();
    mockQuery.mockResolvedValueOnce({ rows: [{ audit_json: [{ ts: "2026-01-01T00:00:00Z", event: "job_created" }] }] });
    const app = makeApp();
    const res = await supertest(app).get("/browser-operator/jobs/test-job-id-001/audit");
    expect(res.status).toBe(200);
    expect(res.body.audit[0].event).toBe("job_created");
  });

  it("returns redacted outputs only", async () => {
    mockEnsureTable();
    mockQuery.mockResolvedValueOnce({ rows: [{ outputs_json: { STRIPE_SECRET_KEY: "sk_test_should_not_appear", PUBLIC_ORIGIN: "https://viba.guru" } }] });
    const app = makeApp();
    const res = await supertest(app).get("/browser-operator/jobs/test-job-id-001/outputs");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("sk_test_should_not_appear");
    expect(res.body.outputs.STRIPE_SECRET_KEY).toBe("REDACTED");
    expect(res.body.valuesReturned).toBe(false);
  });
});

describe("pause policy", () => {
  it("documents valid and invalid pause reasons", async () => {
    const app = makeApp();
    const res = await supertest(app).get("/browser-operator/pause-policy");
    expect(res.status).toBe(200);
    expect(res.body.validPauseReasons).toContain("oauth");
    expect(res.body.invalidPauseReasons).toContain("missing selector");
    expect(res.body.valuesReturned).toBe(false);
  });
});
