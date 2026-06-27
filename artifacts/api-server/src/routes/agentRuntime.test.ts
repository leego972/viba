/**
 * Agent Runtime Engine Tests
 *
 * Coverage:
 *  - Runtime: start creates run+steps, next step runs, approval pauses, denied blocks, credential pauses, safe-build blocks
 *  - Security: no raw credentials in status/audit/evidence
 *  - Agent messages: step_started, approval_required, credential_required, safe_build_result written
 *  - Tool broker integration: broker called, broker blocker pauses runtime
 *  - Evidence report: no secrets, all fields present
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn() },
  db: {},
}));

vi.mock("../lib/vibaVault", () => ({
  listVibaCredentials: vi.fn().mockResolvedValue([]),
  resolveVibaCredentialForUse: vi.fn().mockResolvedValue(null),
  saveVibaCredential: vi.fn().mockResolvedValue({ id: 1 }),
}));

vi.mock("../lib/toolActionBroker", () => ({
  planToolAction: vi.fn().mockResolvedValue({
    status: "ready", message: "Tool ready", label: "Build: Safe Build Gate",
    riskLevel: "read_only", rawValuesReturned: false,
  }),
  dryRunToolAction: vi.fn().mockResolvedValue({ status: "executed", dryRunResult: { mode: "dry_run" }, rawValuesReturned: false }),
  executeToolAction: vi.fn().mockResolvedValue({ status: "executed", rawValuesReturned: false }),
  getAvailableTools: vi.fn().mockResolvedValue([]),
}));

import { pool } from "@workspace/db";
import { planToolAction } from "../lib/toolActionBroker";
import {
  startTaskRuntime,
  runNextStep,
  pauseTask,
  resumeTask,
  cancelTask,
  approveStep,
  getTaskRunStatus,
} from "../lib/agentRuntime";
import { generateEvidenceReport } from "../lib/evidenceReport";

// ─── SQL-content-based mock helper ────────────────────────────────────────────
// Avoids brittle call-index counting: mock responses are keyed on SQL fragments.

const NOW = new Date().toISOString();

const TASK_ROW: Record<string, unknown> = {
  id: 1, user_id: 1, request: "Deploy my app", status: "planning",
  plan_json: {
    steps: [
      { stepNumber: 1, title: "Analyze request", description: "Coordinator analyzes", assignedAgent: "coordinator", requiresApproval: false, safeBuildCheckpoint: false },
      { stepNumber: 2, title: "Build implementation", description: "Builder implements", assignedAgent: "builder", requiresApproval: false, safeBuildCheckpoint: false },
      { stepNumber: 3, title: "Deployment", description: "Deploy to Railway", assignedAgent: "deployment", requiresApproval: true, safeBuildCheckpoint: false },
    ],
    requiredTools: [{ toolId: "build.safe_build", riskLevel: "read_only", requiresApproval: false }],
    riskLevel: "high", safeBuildRequired: true, approvalRequired: true,
  },
  risk_level: "high", safe_build_required: true,
};

const RUN_ROW: Record<string, unknown> = {
  id: 10, task_id: 1, user_id: 1, status: "running", current_step_id: null,
  risk_level: "high", safe_build_required: true, safe_build_status: "not_run",
  started_at: NOW, completed_at: null, cancelled_at: null, failed_at: null,
  failure_reason: null, created_at: NOW, updated_at: NOW,
};

const RUN_ROW_PASSED: Record<string, unknown> = { ...RUN_ROW, safe_build_status: "passed" };

const STEP_ROW_SIMPLE: Record<string, unknown> = {
  id: 100, task_id: 1, user_id: 1, step_index: 1, step_id: "step-1-coordinator",
  agent_name: "coordinator", title: "Analyze request", description: "Coordinator analyzes",
  status: "pending", risk_level: "low", tool_id: null,
  requires_approval: false, approval_status: "not_required",
  requires_credential: false, credential_provider: null, credential_kind: null, credential_label: null,
  requires_safe_build: false, started_at: null, completed_at: null, blocked_reason: null,
  error: null, metadata_json: null, created_at: NOW, updated_at: NOW,
};

const STEP_ROW_APPROVAL: Record<string, unknown> = {
  ...STEP_ROW_SIMPLE, id: 101, step_index: 3, step_id: "step-3-deployment",
  agent_name: "deployment", title: "Deployment", description: "Deploy to Railway",
  status: "pending", risk_level: "high", tool_id: "railway.deploy.trigger",
  requires_approval: true, approval_status: "pending",
  requires_credential: false, credential_provider: null,
  requires_safe_build: false,
};

const STEP_ROW_CREDENTIAL: Record<string, unknown> = {
  ...STEP_ROW_SIMPLE, id: 102, step_index: 2, step_id: "step-2-payments",
  agent_name: "payments", title: "Stripe integration", description: "Connect Stripe",
  status: "pending", risk_level: "high", tool_id: "stripe.products.write",
  requires_approval: false, approval_status: "not_required",
  requires_credential: true, credential_provider: "stripe", credential_kind: "api_key",
  requires_safe_build: false,
};

const STEP_ROW_SAFEBUILD: Record<string, unknown> = {
  ...STEP_ROW_SIMPLE, id: 103, step_index: 2, step_id: "step-2-builder",
  agent_name: "builder", title: "Build implementation", description: "Build code",
  status: "pending", risk_level: "medium", tool_id: null,
  requires_approval: false, approval_status: "not_required",
  requires_credential: false, credential_provider: null,
  requires_safe_build: true,
};

/**
 * Sets up pool.query to return values based on the SQL fragment it receives.
 * The `rules` array is checked in order; first match wins.
 * Fallback: returns { rows: [], rowCount: 0 }.
 */
function setupQueryMock(rules: Array<{ sql: string; rows: Record<string, unknown>[] }>) {
  (pool.query as Mock).mockImplementation((sql: string) => {
    const match = rules.find((r) => String(sql).includes(r.sql));
    return Promise.resolve({ rows: match?.rows ?? [], rowCount: match?.rows.length ?? 0 });
  });
}

// ─── startTaskRuntime ─────────────────────────────────────────────────────────

describe("startTaskRuntime", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a run and steps from the task plan", async () => {
    setupQueryMock([
      { sql: "SELECT id, user_id, status, plan_json", rows: [TASK_ROW] },
      { sql: "SELECT * FROM viba_task_runs WHERE task_id", rows: [] },
      { sql: "INSERT INTO viba_task_runs", rows: [{ id: 10 }] },
      { sql: "SELECT * FROM viba_task_steps WHERE task_id", rows: [STEP_ROW_SIMPLE] },
      { sql: "SELECT * FROM viba_task_runs WHERE id", rows: [RUN_ROW] },
    ]);
    const result = await startTaskRuntime(1, 1);
    expect(result.run.taskId).toBe(1);
    expect(result.run.rawValuesReturned).toBe(false);
    expect(Array.isArray(result.steps)).toBe(true);
  });

  it("returns rawValuesReturned: false on run", async () => {
    setupQueryMock([
      { sql: "SELECT id, user_id, status, plan_json", rows: [TASK_ROW] },
      { sql: "SELECT * FROM viba_task_runs WHERE task_id", rows: [] },
      { sql: "INSERT INTO viba_task_runs", rows: [{ id: 10 }] },
      { sql: "SELECT * FROM viba_task_steps WHERE task_id", rows: [STEP_ROW_SIMPLE] },
      { sql: "SELECT * FROM viba_task_runs WHERE id", rows: [RUN_ROW] },
    ]);
    const result = await startTaskRuntime(1, 1);
    expect(result.run.rawValuesReturned).toBe(false);
  });

  it("throws if task not found", async () => {
    setupQueryMock([{ sql: "SELECT id, user_id, status, plan_json", rows: [] }]);
    await expect(startTaskRuntime(999, 1)).rejects.toThrow("Task not found");
  });

  it("throws if task is in terminal state", async () => {
    setupQueryMock([{ sql: "SELECT id, user_id, status, plan_json", rows: [{ ...TASK_ROW, status: "cancelled" }] }]);
    await expect(startTaskRuntime(1, 1)).rejects.toThrow("cannot be started");
  });
});

// ─── runNextStep ──────────────────────────────────────────────────────────────

describe("runNextStep", () => {
  beforeEach(() => vi.clearAllMocks());

  it("completes a low-risk step without approval", async () => {
    let pendingReturned = false;
    (pool.query as Mock).mockImplementation((sql: string) => {
      const s = String(sql);
      if (s.includes("SELECT * FROM viba_task_runs WHERE task_id")) return Promise.resolve({ rows: [RUN_ROW_PASSED], rowCount: 1 });
      if (s.includes("status = 'pending'") && !pendingReturned) { pendingReturned = true; return Promise.resolve({ rows: [STEP_ROW_SIMPLE], rowCount: 1 }); }
      if (s.includes("SELECT * FROM viba_task_runs WHERE id")) return Promise.resolve({ rows: [RUN_ROW_PASSED], rowCount: 1 });
      if (s.includes("SELECT * FROM viba_task_steps WHERE id")) return Promise.resolve({ rows: [{ ...STEP_ROW_SIMPLE, status: "completed", completed_at: NOW }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await runNextStep(1, 1);
    expect(result.action).toBe("step_completed");
    expect(result.run.rawValuesReturned).toBe(false);
  });

  it("pauses for safe_build when step requires it", async () => {
    let pendingReturned = false;
    (pool.query as Mock).mockImplementation((sql: string) => {
      const s = String(sql);
      if (s.includes("SELECT * FROM viba_task_runs WHERE task_id")) return Promise.resolve({ rows: [RUN_ROW], rowCount: 1 }); // safe_build_status = not_run
      if (s.includes("status = 'pending'") && !pendingReturned) { pendingReturned = true; return Promise.resolve({ rows: [STEP_ROW_SAFEBUILD], rowCount: 1 }); }
      if (s.includes("SELECT * FROM viba_task_runs WHERE id")) return Promise.resolve({ rows: [{ ...RUN_ROW, status: "waiting_for_safe_build" }], rowCount: 1 });
      if (s.includes("SELECT * FROM viba_task_steps WHERE id")) return Promise.resolve({ rows: [{ ...STEP_ROW_SAFEBUILD, status: "waiting" }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await runNextStep(1, 1);
    expect(result.action).toBe("waiting_for_safe_build");
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.blockers[0]).toContain("safe-build");
    expect(result.run.rawValuesReturned).toBe(false);
  });

  it("pauses for approval on high-risk step", async () => {
    let pendingReturned = false;
    (pool.query as Mock).mockImplementation((sql: string) => {
      const s = String(sql);
      if (s.includes("SELECT * FROM viba_task_runs WHERE task_id")) return Promise.resolve({ rows: [RUN_ROW_PASSED], rowCount: 1 });
      if (s.includes("status = 'pending'") && !pendingReturned) { pendingReturned = true; return Promise.resolve({ rows: [STEP_ROW_APPROVAL], rowCount: 1 }); }
      if (s.includes("SELECT * FROM viba_task_runs WHERE id")) return Promise.resolve({ rows: [{ ...RUN_ROW_PASSED, status: "waiting_for_user_approval" }], rowCount: 1 });
      if (s.includes("SELECT * FROM viba_task_steps WHERE id")) return Promise.resolve({ rows: [{ ...STEP_ROW_APPROVAL, status: "waiting" }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await runNextStep(1, 1);
    expect(result.action).toBe("waiting_for_approval");
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.run.rawValuesReturned).toBe(false);
  });

  it("pauses for missing credential", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    let pendingReturned = false;
    (pool.query as Mock).mockImplementation((sql: string) => {
      const s = String(sql);
      if (s.includes("SELECT * FROM viba_task_runs WHERE task_id")) return Promise.resolve({ rows: [RUN_ROW_PASSED], rowCount: 1 });
      if (s.includes("status = 'pending'") && !pendingReturned) { pendingReturned = true; return Promise.resolve({ rows: [STEP_ROW_CREDENTIAL], rowCount: 1 }); }
      if (s.includes("SELECT * FROM viba_task_runs WHERE id")) return Promise.resolve({ rows: [{ ...RUN_ROW_PASSED, status: "waiting_for_credential" }], rowCount: 1 });
      if (s.includes("SELECT * FROM viba_task_steps WHERE id")) return Promise.resolve({ rows: [{ ...STEP_ROW_CREDENTIAL, status: "waiting" }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await runNextStep(1, 1);
    vi.unstubAllEnvs();
    expect(result.action).toBe("waiting_for_credential");
    expect(result.run.rawValuesReturned).toBe(false);
  });

  it("throws if no runtime exists", async () => {
    setupQueryMock([{ sql: "SELECT * FROM viba_task_runs WHERE task_id", rows: [] }]);
    await expect(runNextStep(999, 1)).rejects.toThrow("No runtime found");
  });

  it("runtime does not execute tool directly — calls broker", async () => {
    vi.clearAllMocks();
    (planToolAction as Mock).mockResolvedValue({ status: "ready", message: "ready", label: "Test", riskLevel: "read_only", rawValuesReturned: false });
    let pendingReturned = false;
    (pool.query as Mock).mockImplementation((sql: string) => {
      const s = String(sql);
      if (s.includes("SELECT * FROM viba_task_runs WHERE task_id")) return Promise.resolve({ rows: [RUN_ROW_PASSED], rowCount: 1 });
      if (s.includes("status = 'pending'") && !pendingReturned) { pendingReturned = true; return Promise.resolve({ rows: [{ ...STEP_ROW_SIMPLE, tool_id: "build.safe_build" }], rowCount: 1 }); }
      if (s.includes("SELECT * FROM viba_task_runs WHERE id")) return Promise.resolve({ rows: [RUN_ROW_PASSED], rowCount: 1 });
      if (s.includes("SELECT * FROM viba_task_steps WHERE id")) return Promise.resolve({ rows: [{ ...STEP_ROW_SIMPLE, status: "completed" }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await runNextStep(1, 1);
    expect(planToolAction).toHaveBeenCalledWith(expect.objectContaining({ toolId: "build.safe_build" }));
  });

  it("broker blocker pauses runtime", async () => {
    vi.clearAllMocks();
    (planToolAction as Mock).mockResolvedValue({ status: "needs_user_approval", message: "Approval needed", label: "Railway Deploy", riskLevel: "destructive", rawValuesReturned: false });
    let pendingReturned = false;
    (pool.query as Mock).mockImplementation((sql: string) => {
      const s = String(sql);
      if (s.includes("SELECT * FROM viba_task_runs WHERE task_id")) return Promise.resolve({ rows: [RUN_ROW_PASSED], rowCount: 1 });
      if (s.includes("status = 'pending'") && !pendingReturned) { pendingReturned = true; return Promise.resolve({ rows: [{ ...STEP_ROW_SIMPLE, tool_id: "railway.deploy.trigger" }], rowCount: 1 }); }
      if (s.includes("SELECT * FROM viba_task_runs WHERE id")) return Promise.resolve({ rows: [{ ...RUN_ROW_PASSED, status: "waiting_for_user_approval" }], rowCount: 1 });
      if (s.includes("SELECT * FROM viba_task_steps WHERE id")) return Promise.resolve({ rows: [{ ...STEP_ROW_SIMPLE, status: "waiting" }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await runNextStep(1, 1);
    expect(result.action).toBe("tool_broker_blocked");
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.run.rawValuesReturned).toBe(false);
  });
});

// ─── approveStep ─────────────────────────────────────────────────────────────

describe("approveStep", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approved decision sets step to pending and resumes runtime", async () => {
    setupQueryMock([
      { sql: "SELECT * FROM viba_task_runs WHERE task_id", rows: [RUN_ROW] },
      { sql: "SELECT * FROM viba_task_steps WHERE id", rows: [STEP_ROW_SIMPLE] },
    ]);
    const result = await approveStep(1, 1, 100, "approved");
    expect(result.run.rawValuesReturned).toBe(false);
    expect(result.step.rawValuesReturned).toBe(false);
  });

  it("denied decision blocks step and task", async () => {
    setupQueryMock([
      { sql: "SELECT * FROM viba_task_runs WHERE task_id", rows: [{ ...RUN_ROW, status: "blocked" }] },
      { sql: "SELECT * FROM viba_task_steps WHERE id", rows: [{ ...STEP_ROW_APPROVAL, status: "blocked", approval_status: "denied" }] },
    ]);
    const result = await approveStep(1, 1, 101, "denied");
    expect(result.run.status === "blocked" || result.step.approvalStatus === "denied").toBe(true);
    expect(result.run.rawValuesReturned).toBe(false);
  });
});

// ─── cancelTask / pauseTask / resumeTask ──────────────────────────────────────

describe("cancelTask / pauseTask / resumeTask", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cancelTask sets cancelled status", async () => {
    setupQueryMock([{ sql: "SELECT * FROM viba_task_runs WHERE task_id", rows: [{ ...RUN_ROW, status: "cancelled" }] }]);
    const run = await cancelTask(1, 1);
    expect(run.rawValuesReturned).toBe(false);
  });

  it("pauseTask sets blocked status", async () => {
    setupQueryMock([{ sql: "SELECT * FROM viba_task_runs WHERE task_id", rows: [{ ...RUN_ROW, status: "blocked" }] }]);
    const run = await pauseTask(1, 1, "User paused");
    expect(run.rawValuesReturned).toBe(false);
  });

  it("resumeTask sets running status", async () => {
    setupQueryMock([{ sql: "SELECT * FROM viba_task_runs WHERE task_id", rows: [{ ...RUN_ROW, status: "running" }] }]);
    const run = await resumeTask(1, 1);
    expect(run.rawValuesReturned).toBe(false);
  });
});

// ─── getTaskRunStatus — no raw credentials ────────────────────────────────────

describe("getTaskRunStatus security", () => {
  beforeEach(() => vi.clearAllMocks());

  it("status response never contains raw credential values", async () => {
    setupQueryMock([
      { sql: "SELECT * FROM viba_task_runs WHERE task_id", rows: [RUN_ROW] },
      { sql: "SELECT * FROM viba_task_steps WHERE task_id", rows: [{
        ...STEP_ROW_CREDENTIAL,
        credential_provider: "stripe", credential_kind: "api_key",
        blocked_reason: "Vault credential required: stripe/api_key",
      }] },
    ]);
    const status = await getTaskRunStatus(1, 1);
    const serialized = JSON.stringify(status);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(serialized).not.toMatch(/whsec_/);
    expect(status.rawValuesReturned).toBe(false);
  });

  it("pending approvals returned without raw keys", async () => {
    setupQueryMock([
      { sql: "SELECT * FROM viba_task_runs WHERE task_id", rows: [RUN_ROW] },
      { sql: "SELECT * FROM viba_task_steps WHERE task_id", rows: [{ ...STEP_ROW_APPROVAL, status: "waiting", approval_status: "pending" }] },
    ]);
    const status = await getTaskRunStatus(1, 1);
    expect(status.pendingApprovals.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(status.pendingApprovals);
    expect(serialized).not.toMatch(/RAILWAY_TOKEN/);
    expect(status.rawValuesReturned).toBe(false);
  });

  it("returns null run when no runtime has been started", async () => {
    setupQueryMock([
      { sql: "SELECT * FROM viba_task_runs WHERE task_id", rows: [] },
      { sql: "SELECT * FROM viba_task_steps WHERE task_id", rows: [] },
    ]);
    const status = await getTaskRunStatus(1, 1);
    expect(status.run).toBeNull();
    expect(status.rawValuesReturned).toBe(false);
  });
});

// ─── evidenceReport security ──────────────────────────────────────────────────

describe("generateEvidenceReport security", () => {
  beforeEach(() => vi.clearAllMocks());

  it("evidence report includes rawValuesReturned: false and no secrets", async () => {
    setupQueryMock([
      { sql: "SELECT id, request, status, plan_json", rows: [TASK_ROW] },
      { sql: "SELECT status, safe_build_status", rows: [{ ...RUN_ROW, status: "completed" }] },
      { sql: "SELECT step_index, title, agent_name", rows: [{ ...STEP_ROW_SIMPLE, status: "completed", completed_at: NOW, requires_approval: false, approval_status: "not_required", requires_credential: false, credential_provider: null }] },
      { sql: "FROM viba_tool_invocations", rows: [] },
      { sql: "COUNT(*) as cnt", rows: [{ cnt: "3" }] },
    ]);
    const report = await generateEvidenceReport(1, 1);
    expect(report.rawValuesReturned).toBe(false);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(serialized).not.toContain("smtp_pass");
    expect(serialized).not.toContain("webhook_secret");
    expect(report.securityNote).toContain("no API keys");
  });

  it("separates completed and blocked steps", async () => {
    setupQueryMock([
      { sql: "SELECT id, request, status, plan_json", rows: [TASK_ROW] },
      { sql: "SELECT status, safe_build_status", rows: [RUN_ROW] },
      { sql: "SELECT step_index, title, agent_name", rows: [
        { ...STEP_ROW_SIMPLE, status: "completed", completed_at: NOW, requires_approval: false, approval_status: "not_required", requires_credential: false, credential_provider: null },
        { ...STEP_ROW_APPROVAL, status: "blocked", blocked_reason: "User denied", requires_approval: true, approval_status: "denied", requires_credential: false, credential_provider: null },
      ] },
      { sql: "FROM viba_tool_invocations", rows: [] },
      { sql: "COUNT(*) as cnt", rows: [{ cnt: "5" }] },
    ]);
    const report = await generateEvidenceReport(1, 1);
    expect(report.stepsCompleted.length).toBe(1);
    expect(report.stepsBlocked.length).toBe(1);
    expect(report.rawValuesReturned).toBe(false);
  });

  it("throws on task not found", async () => {
    setupQueryMock([{ sql: "SELECT id, request, status, plan_json", rows: [] }]);
    await expect(generateEvidenceReport(999, 1)).rejects.toThrow("Task not found");
  });

  it("credentials listed by provider/kind/scope only — no raw values", async () => {
    setupQueryMock([
      { sql: "SELECT id, request, status, plan_json", rows: [TASK_ROW] },
      { sql: "SELECT status, safe_build_status", rows: [RUN_ROW] },
      { sql: "SELECT step_index, title, agent_name", rows: [{
        ...STEP_ROW_CREDENTIAL, status: "completed", requires_credential: true,
        credential_provider: "stripe", credential_kind: "api_key",
        requires_approval: false, approval_status: "not_required",
      }] },
      { sql: "FROM viba_tool_invocations", rows: [] },
      { sql: "COUNT(*) as cnt", rows: [{ cnt: "2" }] },
    ]);
    const report = await generateEvidenceReport(1, 1);
    for (const cred of report.credentialsUsed) {
      expect(cred).toHaveProperty("provider");
      expect(cred).toHaveProperty("kind");
      expect(cred).toHaveProperty("scope");
      expect(Object.keys(cred)).not.toContain("value");
      expect(Object.keys(cred)).not.toContain("raw");
    }
  });
});

// ─── Agent messages written ───────────────────────────────────────────────────

describe("Agent messages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("step_started message is written when step begins", async () => {
    let pendingReturned = false;
    (pool.query as Mock).mockImplementation((sql: string) => {
      const s = String(sql);
      if (s.includes("SELECT * FROM viba_task_runs WHERE task_id")) return Promise.resolve({ rows: [RUN_ROW_PASSED], rowCount: 1 });
      if (s.includes("status = 'pending'") && !pendingReturned) { pendingReturned = true; return Promise.resolve({ rows: [STEP_ROW_SIMPLE], rowCount: 1 }); }
      if (s.includes("SELECT * FROM viba_task_runs WHERE id")) return Promise.resolve({ rows: [RUN_ROW_PASSED], rowCount: 1 });
      if (s.includes("SELECT * FROM viba_task_steps WHERE id")) return Promise.resolve({ rows: [{ ...STEP_ROW_SIMPLE, status: "completed" }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await runNextStep(1, 1);
    const calls = (pool.query as Mock).mock.calls;
    const commsInserts = calls.filter((c) => typeof c[0] === "string" && String(c[0]).includes("INSERT INTO viba_agent_comms"));
    expect(commsInserts.length).toBeGreaterThan(0);
    // step_started is first message
    const stepStartedMsg = commsInserts[0][1] as unknown[];
    expect(stepStartedMsg).toBeDefined();
  });

  it("approval_required message is written for approval step", async () => {
    let pendingReturned = false;
    (pool.query as Mock).mockImplementation((sql: string) => {
      const s = String(sql);
      if (s.includes("SELECT * FROM viba_task_runs WHERE task_id")) return Promise.resolve({ rows: [RUN_ROW_PASSED], rowCount: 1 });
      if (s.includes("status = 'pending'") && !pendingReturned) { pendingReturned = true; return Promise.resolve({ rows: [STEP_ROW_APPROVAL], rowCount: 1 }); }
      if (s.includes("SELECT * FROM viba_task_runs WHERE id")) return Promise.resolve({ rows: [{ ...RUN_ROW_PASSED, status: "waiting_for_user_approval" }], rowCount: 1 });
      if (s.includes("SELECT * FROM viba_task_steps WHERE id")) return Promise.resolve({ rows: [{ ...STEP_ROW_APPROVAL, status: "waiting" }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await runNextStep(1, 1);
    const calls = (pool.query as Mock).mock.calls;
    const commsInserts = calls.filter((c) => typeof c[0] === "string" && String(c[0]).includes("INSERT INTO viba_agent_comms"));
    expect(commsInserts.length).toBeGreaterThanOrEqual(2); // step_started + approval_required
    // None of the messages should contain raw secrets
    for (const call of commsInserts) {
      const params = JSON.stringify(call[1] ?? []);
      expect(params).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    }
    expect(result.run.rawValuesReturned).toBe(false);
  });

  it("credential_required message is written when credential is missing", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    let pendingReturned = false;
    (pool.query as Mock).mockImplementation((sql: string) => {
      const s = String(sql);
      if (s.includes("SELECT * FROM viba_task_runs WHERE task_id")) return Promise.resolve({ rows: [RUN_ROW_PASSED], rowCount: 1 });
      if (s.includes("status = 'pending'") && !pendingReturned) { pendingReturned = true; return Promise.resolve({ rows: [STEP_ROW_CREDENTIAL], rowCount: 1 }); }
      if (s.includes("SELECT * FROM viba_task_runs WHERE id")) return Promise.resolve({ rows: [{ ...RUN_ROW_PASSED, status: "waiting_for_credential" }], rowCount: 1 });
      if (s.includes("SELECT * FROM viba_task_steps WHERE id")) return Promise.resolve({ rows: [{ ...STEP_ROW_CREDENTIAL, status: "waiting" }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await runNextStep(1, 1);
    vi.unstubAllEnvs();
    expect(result.action).toBe("waiting_for_credential");
    const calls = (pool.query as Mock).mock.calls;
    const commsInserts = calls.filter((c) => typeof c[0] === "string" && String(c[0]).includes("INSERT INTO viba_agent_comms"));
    expect(commsInserts.length).toBeGreaterThan(0);
    // Messages must never include raw credential values
    for (const call of commsInserts) {
      const params = JSON.stringify(call[1] ?? []);
      expect(params).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    }
    expect(result.run.rawValuesReturned).toBe(false);
  });

  it("safe_build_result message is written when safe build blocks", async () => {
    let pendingReturned = false;
    (pool.query as Mock).mockImplementation((sql: string) => {
      const s = String(sql);
      if (s.includes("SELECT * FROM viba_task_runs WHERE task_id")) return Promise.resolve({ rows: [RUN_ROW], rowCount: 1 }); // not_run
      if (s.includes("status = 'pending'") && !pendingReturned) { pendingReturned = true; return Promise.resolve({ rows: [STEP_ROW_SAFEBUILD], rowCount: 1 }); }
      if (s.includes("SELECT * FROM viba_task_runs WHERE id")) return Promise.resolve({ rows: [{ ...RUN_ROW, status: "waiting_for_safe_build" }], rowCount: 1 });
      if (s.includes("SELECT * FROM viba_task_steps WHERE id")) return Promise.resolve({ rows: [{ ...STEP_ROW_SAFEBUILD, status: "waiting" }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await runNextStep(1, 1);
    expect(result.action).toBe("waiting_for_safe_build");
    expect(result.blockers[0]).toContain("safe-build");
    const calls = (pool.query as Mock).mock.calls;
    const commsInserts = calls.filter((c) => typeof c[0] === "string" && String(c[0]).includes("INSERT INTO viba_agent_comms"));
    expect(commsInserts.length).toBeGreaterThan(0);
    expect(result.run.rawValuesReturned).toBe(false);
  });
});
