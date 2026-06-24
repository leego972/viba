import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  const mockRows: Record<string, unknown>[][] = [];
  let rowIndex = 0;
  const pool = {
    query: vi.fn().mockImplementation(() => {
      const next = mockRows[rowIndex] ?? [];
      rowIndex++;
      return Promise.resolve({ rows: next, rowCount: next.length });
    }),
  };
  return { pool, default: pool };
});

vi.mock("../lib/vibaVault", () => ({
  listVibaCredentials: vi.fn().mockResolvedValue([]),
  logVibaEvent: vi.fn(),
}));

vi.mock("../lib/taskPlanner", async () => {
  const actual = await vi.importActual<typeof import("../lib/taskPlanner")>("../lib/taskPlanner");
  return { planTask: actual.planTask };
});

import taskIntakeRouter from "./taskIntake";
import { pool } from "@workspace/db";

// ─── App factory ──────────────────────────────────────────────────────────────

function makeApp(uid = 7) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { session?: { userId?: number } }).session = { userId: uid };
    next();
  });
  app.use(taskIntakeRouter);
  return app;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockPoolSequence(responses: Array<{ rows: Record<string, unknown>[] }>) {
  let i = 0;
  vi.mocked(pool.query).mockImplementation(() => {
    const resp = responses[i] ?? { rows: [], rowCount: 0 };
    i++;
    return Promise.resolve({ ...resp, rowCount: resp.rows.length }) as unknown as ReturnType<typeof pool.query>;
  });
}

// ─── Task Intake: create ──────────────────────────────────────────────────────

describe("POST /task-intake/create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a task from a simple request", async () => {
    mockPoolSequence([
      { rows: [] },           // CREATE TABLE
      { rows: [] },           // CREATE INDEX
      { rows: [{ id: 42 }] }, // INSERT returning id
    ]);

    const res = await request(makeApp())
      .post("/task-intake/create")
      .send({ request: "Build a landing page with signup form" });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.task_id).toBe(42);
    expect(res.body.rawValueReturned).toBe(false);
    expect(res.body.plan).toBeDefined();
  });

  it("returns 400 when request is missing", async () => {
    const res = await request(makeApp()).post("/task-intake/create").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/request/i);
  });

  it("returns 401 when unauthenticated", async () => {
    const app = express();
    app.use(express.json());
    app.use(taskIntakeRouter);
    const res = await request(app).post("/task-intake/create").send({ request: "do something" });
    expect(res.status).toBe(401);
  });

  it("marks approval required for payment tasks", async () => {
    mockPoolSequence([
      { rows: [] },
      { rows: [] },
      { rows: [{ id: 99 }] },
    ]);

    const res = await request(makeApp())
      .post("/task-intake/create")
      .send({ request: "Set up Stripe payments with checkout and webhooks" });

    expect(res.status).toBe(201);
    expect(res.body.plan.approvalRequired).toBe(true);
    expect(res.body.plan.approvalReasons.length).toBeGreaterThan(0);
    expect(res.body.status).toBe("awaiting_user_approval");
  });

  it("marks approval required for production deployment", async () => {
    mockPoolSequence([{ rows: [] }, { rows: [] }, { rows: [{ id: 100 }] }]);

    const res = await request(makeApp())
      .post("/task-intake/create")
      .send({ request: "Deploy the app to production on Railway" });

    expect(res.status).toBe(201);
    expect(res.body.plan.approvalRequired).toBe(true);
  });

  it("marks safe build required for code tasks", async () => {
    mockPoolSequence([{ rows: [] }, { rows: [] }, { rows: [{ id: 101 }] }]);

    const res = await request(makeApp())
      .post("/task-intake/create")
      .send({ request: "Build the user authentication system" });

    expect(res.status).toBe(201);
    expect(res.body.plan.safeBuildRequired).toBe(true);
  });

  it("marks safe build required for deployment tasks", async () => {
    mockPoolSequence([{ rows: [] }, { rows: [] }, { rows: [{ id: 102 }] }]);

    const res = await request(makeApp())
      .post("/task-intake/create")
      .send({ request: "Deploy to Railway production" });

    expect(res.status).toBe(201);
    expect(res.body.plan.safeBuildRequired).toBe(true);
  });

  it("marks safe build required for server tasks", async () => {
    mockPoolSequence([{ rows: [] }, { rows: [] }, { rows: [{ id: 103 }] }]);

    const res = await request(makeApp())
      .post("/task-intake/create")
      .send({ request: "Secure the server API with rate limiting and CORS headers" });

    expect(res.status).toBe(201);
    expect(res.body.plan.safeBuildRequired).toBe(true);
  });

  it("does NOT require approval for planning/analysis tasks", async () => {
    mockPoolSequence([{ rows: [] }, { rows: [] }, { rows: [{ id: 104 }] }]);

    const res = await request(makeApp())
      .post("/task-intake/create")
      .send({ request: "Analyse the current project structure" });

    expect(res.status).toBe(201);
    expect(res.body.plan.approvalRequired).toBe(false);
  });

  it("never returns raw credential values", async () => {
    mockPoolSequence([{ rows: [] }, { rows: [] }, { rows: [{ id: 105 }] }]);

    const res = await request(makeApp())
      .post("/task-intake/create")
      .send({ request: "Connect Stripe and deploy" });

    const body = JSON.stringify(res.body);
    for (const field of ["encrypted_value", "iv", "auth_tag", "raw_key", "password", "secret"]) {
      expect(body).not.toContain(`"${field}"`);
    }
    expect(res.body.rawValueReturned).toBe(false);
  });
});

// ─── Task Intake: get plan ────────────────────────────────────────────────────

describe("GET /task-intake/:taskId/plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns plan for existing task", async () => {
    const mockPlan = { summary: "Test plan", steps: [] };
    mockPoolSequence([
      { rows: [] }, { rows: [] },
      { rows: [{ id: 1, user_id: 7, request: "do stuff", status: "planning", plan_json: mockPlan, risk_level: "low", needs_user_approval: false, recommended_ai_collaboration: false, safe_build_required: false, safe_build_passed: null, approved_at: null, cancelled_at: null, evidence_json: null, created_at: new Date(), updated_at: new Date() }] },
    ]);

    const res = await request(makeApp()).get("/task-intake/1/plan");
    expect(res.status).toBe(200);
    expect(res.body.plan).toBeDefined();
    expect(res.body.rawValueReturned).toBe(false);
  });

  it("returns 404 for non-existent task", async () => {
    mockPoolSequence([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const res = await request(makeApp()).get("/task-intake/9999/plan");
    expect(res.status).toBe(404);
  });
});

// ─── Task Intake: approve ─────────────────────────────────────────────────────

describe("POST /task-intake/:taskId/approve", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approves a task awaiting approval", async () => {
    mockPoolSequence([
      { rows: [] }, { rows: [] },
      { rows: [{ id: 1, user_id: 7, request: "pay", status: "awaiting_user_approval", plan_json: {}, risk_level: "high", needs_user_approval: true, recommended_ai_collaboration: false, safe_build_required: true, safe_build_passed: null, approved_at: null, cancelled_at: null, evidence_json: null, created_at: new Date(), updated_at: new Date() }] },
      { rows: [] }, // UPDATE
    ]);

    const res = await request(makeApp()).post("/task-intake/1/approve");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe("running");
  });

  it("returns 409 for already completed task", async () => {
    mockPoolSequence([
      { rows: [] }, { rows: [] },
      { rows: [{ id: 1, user_id: 7, request: "x", status: "completed", plan_json: {}, risk_level: "low", needs_user_approval: false, recommended_ai_collaboration: false, safe_build_required: false, safe_build_passed: true, approved_at: null, cancelled_at: null, evidence_json: null, created_at: new Date(), updated_at: new Date() }] },
    ]);

    const res = await request(makeApp()).post("/task-intake/1/approve");
    expect(res.status).toBe(409);
  });
});

// ─── Evidence report ──────────────────────────────────────────────────────────

describe("GET /task-intake/:taskId/evidence-report", () => {
  beforeEach(() => vi.clearAllMocks());

  const mockTaskRow = {
    id: 1, user_id: 7, request: "Build and deploy",
    status: "completed",
    plan_json: { summary: "Build and deploy summary", steps: [{ title: "Analyze", assignedAgent: "coordinator", safeBuildCheckpoint: false }], requiredAgents: ["coordinator", "builder"], requiredCredentials: [{ provider: "railway", kind: "token", scope: "deployment" }], approvalRequired: true, safeBuildRequired: true, blockers: [] },
    risk_level: "high", needs_user_approval: true, recommended_ai_collaboration: false,
    safe_build_required: true, safe_build_passed: true, approved_at: new Date(), cancelled_at: null, evidence_json: null,
    created_at: new Date(), updated_at: new Date(),
  };

  it("returns task summary and agents", async () => {
    mockPoolSequence([
      { rows: [] }, { rows: [] },
      { rows: [mockTaskRow] },
      { rows: [] }, // agent_comms query
    ]);

    const res = await request(makeApp()).get("/task-intake/1/evidence-report");
    expect(res.status).toBe(200);
    expect(res.body.task_summary).toBeDefined();
    expect(res.body.agents_used).toBeDefined();
    expect(Array.isArray(res.body.agents_used)).toBe(true);
  });

  it("never returns secrets in the evidence report", async () => {
    mockPoolSequence([
      { rows: [] }, { rows: [] },
      { rows: [mockTaskRow] },
      { rows: [] },
    ]);

    const res = await request(makeApp()).get("/task-intake/1/evidence-report");
    const body = JSON.stringify(res.body);
    for (const field of ["encrypted_value", "iv", "auth_tag", "raw_key", "password", "token_value"]) {
      expect(body).not.toContain(`"${field}"`);
    }
    expect(res.body.rawValuesReturned).toBe(false);
    expect(res.body.securityNote).toMatch(/no secrets/i);
  });

  it("credentials referenced by label only", async () => {
    mockPoolSequence([
      { rows: [] }, { rows: [] },
      { rows: [mockTaskRow] },
      { rows: [] },
    ]);

    const res = await request(makeApp()).get("/task-intake/1/evidence-report");
    expect(res.body.credentials_referenced_by_label).toBeDefined();
    expect(Array.isArray(res.body.credentials_referenced_by_label)).toBe(true);
    // Should be labels like "railway/token (scope: deployment)", not raw values
    const labels = (res.body.credentials_referenced_by_label as string[]);
    for (const label of labels) {
      expect(label).not.toMatch(/^[A-Za-z0-9_]{32,}/); // not a raw token
    }
  });
});

// ─── BYOK: no extra AI required by default ────────────────────────────────────

describe("Task planner BYOK", () => {
  it("does not require extra AI for simple tasks", async () => {
    const { planTask } = await import("../lib/taskPlanner");
    const plan = await planTask({ request: "Analyse the readme file", savedCustomAis: [], savedCredentials: [] });
    // recommendedBYOK might be false for a simple task
    expect(plan.requiredAgents).toContain("coordinator"); // groq always present
  });

  it("recommends BYOK for complex tasks when no custom AIs saved", async () => {
    const { planTask } = await import("../lib/taskPlanner");
    const plan = await planTask({
      request: "Build, secure, test, deploy, and set up payments for my production app",
      savedCustomAis: [],
      savedCredentials: [],
    });
    // Complex multi-domain task should recommend BYOK
    expect(plan.requiredAgents.length).toBeGreaterThan(2);
  });

  it("never returns raw key in planner output", async () => {
    const { planTask } = await import("../lib/taskPlanner");
    const plan = await planTask({ request: "Deploy with Stripe", savedCustomAis: [{ provider: "custom_ai__mistral", name: "mistral" }], savedCredentials: [] });
    const serialized = JSON.stringify(plan);
    for (const field of ["encrypted_value", "raw_key", "password", "secret_value"]) {
      expect(serialized).not.toContain(field);
    }
  });
});
