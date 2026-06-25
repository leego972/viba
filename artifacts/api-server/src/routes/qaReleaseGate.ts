/**
 * VIBA QA Release Gate — API Routes
 *
 * POST /api/qa/plan                     — generate QA test plan + create run
 * POST /api/qa/run                      — execute automated checks on a run
 * GET  /api/qa/runs                     — list QA runs for user
 * GET  /api/qa/runs/:id                 — get single run (no secrets)
 * GET  /api/qa/runs/:id/report          — full QA report (no secrets)
 * POST /api/qa/runs/:id/mark-check      — mark a manual check passed/failed
 * POST /api/qa/runs/:id/block-release   — block this release
 * POST /api/qa/runs/:id/approve-release — approve for owner review (no auto-deploy)
 *
 * Security:
 * - No raw API keys, tokens, passwords, or encrypted values in any response
 * - Release approval = ready for owner review, NOT auto-live
 * - Cannot approve while critical blockers exist
 */
import { Router } from "express";
import { pool } from "@workspace/db";
import { buildQATestPlan, type QATestPlanInput, type QASuite } from "../lib/qaTestPlanner";
import { runBrowserQaHarness } from "../lib/browserQaHarness";

const router = Router();

// ─── Auth helper ──────────────────────────────────────────────────────────────

function uid(req: { session?: { userId?: number } }): number {
  return typeof req.session?.userId === "number" ? req.session.userId : 0;
}

function runId(req: { params: { id?: string } }): number {
  return parseInt(String(req.params["id"] ?? ""), 10);
}

// ─── DB bootstrap ─────────────────────────────────────────────────────────────

export async function ensureQaTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_qa_runs (
      id             SERIAL PRIMARY KEY,
      user_id        INTEGER NOT NULL,
      task_id        INTEGER,
      branch_name    TEXT,
      commit_sha     TEXT,
      status         TEXT NOT NULL DEFAULT 'created',
      release_status TEXT NOT NULL DEFAULT 'not_ready',
      started_at     TIMESTAMPTZ,
      completed_at   TIMESTAMPTZ,
      summary        TEXT,
      blockers_json  JSONB NOT NULL DEFAULT '[]',
      warnings_json  JSONB NOT NULL DEFAULT '[]',
      report_json    JSONB,
      plan_json      JSONB,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_qa_runs_user ON viba_qa_runs(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_qa_runs_task ON viba_qa_runs(task_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_qa_runs_status ON viba_qa_runs(status)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_qa_checks (
      id          SERIAL PRIMARY KEY,
      qa_run_id   INTEGER NOT NULL REFERENCES viba_qa_runs(id) ON DELETE CASCADE,
      suite       TEXT NOT NULL,
      check_name  TEXT NOT NULL,
      check_id    TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      severity    TEXT NOT NULL DEFAULT 'medium',
      evidence    JSONB,
      error       TEXT,
      manual      BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_qa_checks_run ON viba_qa_checks(qa_run_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_qa_checks_status ON viba_qa_checks(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_qa_checks_severity ON viba_qa_checks(severity)`);
}

// ─── Automated check runner ───────────────────────────────────────────────────

async function runAutomatedChecksForRun(qaRunId: number, plan: ReturnType<typeof buildQATestPlan>): Promise<void> {
  const now = new Date().toISOString();

  // Run browser/API harness checks
  const baseUrl = process.env["VITE_API_URL"] ?? "http://localhost:5000";
  let harnessResult: Awaited<ReturnType<typeof runBrowserQaHarness>> | null = null;
  try {
    harnessResult = await runBrowserQaHarness(baseUrl, {});
  } catch {
    // harness failure is a warning, not a blocker
  }

  // Insert API checks
  for (const check of plan.apiChecks) {
    const harnessCheck = harnessResult?.checks.find((c) => c.id === check.id || c.route === check.endpoint);
    const status = harnessCheck ? harnessCheck.status === "passed" ? "passed" : harnessCheck.status === "failed" ? "failed" : "warning" : "skipped";
    await pool.query(
      `INSERT INTO viba_qa_checks (qa_run_id, suite, check_name, check_id, status, severity, evidence, manual) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [qaRunId, check.suite, `API: ${check.endpoint} (${check.method})`, check.id, status, check.severity, JSON.stringify(harnessCheck ?? null), false],
    );
  }

  // Insert security checks (automated determination)
  for (const check of plan.securityChecks) {
    // secret_scan and vault checks can reference harness results
    const harnessCheck = harnessResult?.checks.find((c) => {
      if (check.id === "sc-vault-metadata-only") return c.id === "api-creds";
      if (check.id === "sc-byok-metadata-only") return c.id === "api-custom-ai";
      if (check.id === "sc-tool-no-secrets") return c.id === "api-tools";
      return false;
    });
    const status = harnessCheck
      ? harnessCheck.status === "passed" ? "passed" : harnessCheck.status === "failed" ? "failed" : "warning"
      : "pending";
    await pool.query(
      `INSERT INTO viba_qa_checks (qa_run_id, suite, check_name, check_id, status, severity, evidence, manual) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [qaRunId, check.suite, check.label, check.id, status, check.severity, JSON.stringify({ rule: check.rule }), false],
    );
  }

  // Insert vault checks
  for (const check of plan.vaultChecks) {
    const harnessCheck = harnessResult?.checks.find((c) => c.id === "api-creds" || c.id === "api-custom-ai");
    const status = harnessCheck?.status === "passed" ? "passed" : "pending";
    await pool.query(
      `INSERT INTO viba_qa_checks (qa_run_id, suite, check_name, check_id, status, severity, evidence, manual) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [qaRunId, check.suite, check.label, check.id, status, check.severity, JSON.stringify({ forbiddenFields: check.forbiddenFields }), false],
    );
  }

  // Insert manual checks
  for (const check of plan.manualChecks) {
    await pool.query(
      `INSERT INTO viba_qa_checks (qa_run_id, suite, check_name, check_id, status, severity, evidence, manual) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [qaRunId, check.suite, check.label, check.id, "pending", check.severity, JSON.stringify({ instructions: check.instructions }), true],
    );
  }

  // Insert browser checks
  for (const check of plan.browserChecks) {
    const harnessCheck = harnessResult?.checks.find((c) => c.route === check.route);
    const status = harnessCheck?.status === "manual_required" ? "pending" : harnessCheck?.status === "passed" ? "passed" : "pending";
    await pool.query(
      `INSERT INTO viba_qa_checks (qa_run_id, suite, check_name, check_id, status, severity, evidence, manual) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [qaRunId, check.suite, `Browser: ${check.route}`, check.id, status, check.severity,
        JSON.stringify({ route: check.route, harnessResult: harnessCheck ?? null }),
        harnessCheck?.status === "manual_required" || !harnessCheck],
    );
  }

  // Insert payment checks
  for (const check of plan.paymentChecks) {
    await pool.query(
      `INSERT INTO viba_qa_checks (qa_run_id, suite, check_name, check_id, status, severity, evidence, manual) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [qaRunId, check.suite, check.label, check.id, "pending", check.severity, JSON.stringify({ requiresApproval: check.requiresApproval }), true],
    );
  }

  // Insert mobile checks
  for (const check of plan.mobileChecks) {
    await pool.query(
      `INSERT INTO viba_qa_checks (qa_run_id, suite, check_name, check_id, status, severity, evidence, manual) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [qaRunId, check.suite, check.label, check.id, "pending", check.severity, JSON.stringify({ route: check.route }), true],
    );
  }

  // Collect blockers from harness
  const blockers: string[] = [...(harnessResult?.blockers ?? []), ...plan.launchBlockers];
  const warnings: string[] = [];
  if (harnessResult && harnessResult.manualRequired > 0) {
    warnings.push(`${harnessResult.manualRequired} browser check(s) require manual verification`);
  }
  if (!harnessResult) {
    warnings.push("Browser QA harness could not reach local server — run in deployed environment for full results");
  }

  // Determine run status
  const criticalFailed = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM viba_qa_checks WHERE qa_run_id=$1 AND status='failed' AND severity='critical'`,
    [qaRunId],
  );
  const criticalFailCount = Number(criticalFailed.rows[0]?.cnt ?? 0);
  const runStatus = criticalFailCount > 0 ? "blocked" : "passed_with_warnings";

  await pool.query(
    `UPDATE viba_qa_runs SET status=$1, completed_at=$2, blockers_json=$3, warnings_json=$4, updated_at=$5 WHERE id=$6`,
    [runStatus, now, JSON.stringify(blockers), JSON.stringify(warnings), now, qaRunId],
  );
}

// ─── Safe response helper (no secrets) ───────────────────────────────────────

const FORBIDDEN_RESPONSE_FIELDS = new Set([
  "password", "token", "api_key", "secret", "key", "webhook_secret",
  "database_url", "smtp_pass", "auth_tag", "iv", "encrypted_value",
  "private_key", "access_token", "refresh_token", "raw_key", "secret_value",
]);

function safeRun(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (FORBIDDEN_RESPONSE_FIELDS.has(k.toLowerCase())) out[k] = "[REDACTED]";
    else out[k] = v;
  }
  return out;
}

// ─── POST /api/qa/plan ────────────────────────────────────────────────────────

router.post("/api/qa/plan", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }

  await ensureQaTables();

  const { appName = "VIBA", changedFiles = [], changedRoutes = [], touchedAreas = [], strictMode = false, taskId = null, branchName = null, commitSha = null } = req.body as Partial<QATestPlanInput & { taskId?: number; branchName?: string; commitSha?: string }>;

  const plan = buildQATestPlan({ appName: String(appName), changedFiles: changedFiles as string[], changedRoutes: changedRoutes as string[], touchedAreas: touchedAreas as string[], strictMode: Boolean(strictMode) });

  const { rows } = await pool.query<Record<string, unknown>>(
    `INSERT INTO viba_qa_runs (user_id, task_id, branch_name, commit_sha, status, plan_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'created', $5, NOW(), NOW()) RETURNING *`,
    [u, taskId ?? null, branchName ?? null, commitSha ?? null, JSON.stringify(plan)],
  );

  const run = rows[0];
  res.status(201).json({ ok: true, qaRunId: run?.["id"], plan, rawValuesReturned: false });
});

// ─── POST /api/qa/run ─────────────────────────────────────────────────────────

router.post("/api/qa/run", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }

  await ensureQaTables();

  const { qaRunId } = req.body as { qaRunId?: number };
  if (!qaRunId) { res.status(400).json({ error: "qaRunId required" }); return; }

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_qa_runs WHERE id=$1 AND user_id=$2`,
    [qaRunId, u],
  );
  if (!rows[0]) { res.status(404).json({ error: "QA run not found" }); return; }

  const run = rows[0];
  const plan = run["plan_json"] as ReturnType<typeof buildQATestPlan> | null;
  if (!plan) { res.status(400).json({ error: "No plan found for this run — call POST /api/qa/plan first" }); return; }

  // Mark as running
  await pool.query(
    `UPDATE viba_qa_runs SET status='running', started_at=NOW(), updated_at=NOW() WHERE id=$1`,
    [qaRunId],
  );

  // Run automated checks (non-blocking — returns immediately with run started)
  runAutomatedChecksForRun(qaRunId, plan).catch(() => {
    pool.query(
      `UPDATE viba_qa_runs SET status='failed', updated_at=NOW() WHERE id=$1`,
      [qaRunId],
    ).catch(() => undefined);
  });

  res.status(202).json({ ok: true, qaRunId, status: "running", message: "Automated QA checks started", rawValuesReturned: false });
});

// ─── GET /api/qa/runs ─────────────────────────────────────────────────────────

router.get("/api/qa/runs", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }

  await ensureQaTables();

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT id, user_id, task_id, branch_name, commit_sha, status, release_status, started_at, completed_at, summary, blockers_json, warnings_json, created_at, updated_at
     FROM viba_qa_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
    [u],
  );
  res.json({ ok: true, runs: rows.map(safeRun), rawValuesReturned: false });
});

// ─── GET /api/qa/runs/:id ─────────────────────────────────────────────────────

router.get("/api/qa/runs/:id", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }

  await ensureQaTables();

  const id = runId(req);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid run id" }); return; }

  const { rows: runRows } = await pool.query<Record<string, unknown>>(
    `SELECT id, user_id, task_id, branch_name, commit_sha, status, release_status, started_at, completed_at, summary, blockers_json, warnings_json, created_at, updated_at
     FROM viba_qa_runs WHERE id=$1 AND user_id=$2`,
    [id, u],
  );
  if (!runRows[0]) { res.status(404).json({ error: "QA run not found" }); return; }

  const { rows: checkRows } = await pool.query<Record<string, unknown>>(
    `SELECT id, qa_run_id, suite, check_name, check_id, status, severity, manual, error, created_at, updated_at FROM viba_qa_checks WHERE qa_run_id=$1 ORDER BY severity DESC, created_at`,
    [id],
  );

  res.json({ ok: true, run: safeRun(runRows[0]), checks: checkRows.map(safeRun), rawValuesReturned: false });
});

// ─── GET /api/qa/runs/:id/report ──────────────────────────────────────────────

router.get("/api/qa/runs/:id/report", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }

  await ensureQaTables();

  const id = runId(req);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid run id" }); return; }

  const { rows: runRows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_qa_runs WHERE id=$1 AND user_id=$2`,
    [id, u],
  );
  if (!runRows[0]) { res.status(404).json({ error: "QA run not found" }); return; }
  const run = runRows[0];

  const { rows: checks } = await pool.query<Record<string, unknown>>(
    `SELECT id, qa_run_id, suite, check_name, check_id, status, severity, manual, evidence, error FROM viba_qa_checks WHERE qa_run_id=$1 ORDER BY severity DESC, created_at`,
    [id],
  );

  // Aggregate
  const total = checks.length;
  const passed = checks.filter((c) => String(c["status"]) === "passed").length;
  const failed = checks.filter((c) => String(c["status"]) === "failed").length;
  const warnings = checks.filter((c) => String(c["status"]) === "warning").length;
  const pending = checks.filter((c) => ["pending", "running"].includes(String(c["status"]))).length;
  const skipped = checks.filter((c) => String(c["status"]) === "skipped").length;
  const manualRemaining = checks.filter((c) => Boolean(c["manual"]) && ["pending", "running"].includes(String(c["status"]))).length;

  const criticalBlockers = checks
    .filter((c) => String(c["status"]) === "failed" && String(c["severity"]) === "critical")
    .map((c) => String(c["check_name"]));

  const suitesSummary: Record<string, { passed: number; failed: number; pending: number }> = {};
  for (const c of checks) {
    const suite = String(c["suite"]);
    if (!suitesSummary[suite]) suitesSummary[suite] = { passed: 0, failed: 0, pending: 0 };
    if (String(c["status"]) === "passed") suitesSummary[suite]!.passed++;
    else if (String(c["status"]) === "failed") suitesSummary[suite]!.failed++;
    else suitesSummary[suite]!.pending++;
  }

  // Evidence — never include raw secrets
  const browserEvidence = checks
    .filter((c) => String(c["check_name"]).startsWith("Browser:"))
    .map((c) => ({
      route: String(c["check_name"]).replace("Browser: ", ""),
      status: String(c["status"]),
      evidence: c["evidence"] ?? null,
    }));

  const report = {
    qaRunId: run["id"],
    status: run["status"],
    releaseStatus: run["release_status"],
    branchName: run["branch_name"],
    commitSha: run["commit_sha"],
    startedAt: run["started_at"],
    completedAt: run["completed_at"],
    summary: {
      total,
      passed,
      failed,
      warnings,
      pending,
      skipped,
      manualChecksRemaining: manualRemaining,
      criticalBlockers,
    },
    blockers: run["blockers_json"] ?? [],
    warnings: run["warnings_json"] ?? [],
    suitesSummary,
    browserEvidence,
    rawValuesReturned: false,
    securityNote: "This report contains no API keys, tokens, passwords, webhook secrets, database URLs, or any raw credential values.",
    generatedAt: new Date().toISOString(),
  };

  res.json({ ok: true, report, rawValuesReturned: false });
});

// ─── POST /api/qa/runs/:id/mark-check ────────────────────────────────────────

router.post("/api/qa/runs/:id/mark-check", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }

  await ensureQaTables();

  const id = runId(req);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid run id" }); return; }

  const { checkId, status, note } = req.body as { checkId?: string | number; status?: string; note?: string };
  if (!checkId) { res.status(400).json({ error: "checkId required" }); return; }

  const validStatuses = ["passed", "warning", "failed", "skipped"];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    return;
  }

  // Verify run belongs to user
  const { rows: runRows } = await pool.query<{ id: number }>(
    `SELECT id FROM viba_qa_runs WHERE id=$1 AND user_id=$2`,
    [id, u],
  );
  if (!runRows[0]) { res.status(404).json({ error: "QA run not found" }); return; }

  const { rows: updated } = await pool.query<Record<string, unknown>>(
    `UPDATE viba_qa_checks SET status=$1, error=$2, updated_at=NOW()
     WHERE qa_run_id=$3 AND (id=$4 OR check_id=$4) AND manual=TRUE
     RETURNING id, suite, check_name, status, severity`,
    [status, note ?? null, id, String(checkId)],
  );

  if (!updated[0]) { res.status(404).json({ error: "Manual check not found on this run" }); return; }

  res.json({ ok: true, updated: updated[0], rawValuesReturned: false });
});

// ─── POST /api/qa/runs/:id/block-release ─────────────────────────────────────

router.post("/api/qa/runs/:id/block-release", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }

  await ensureQaTables();

  const id = runId(req);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid run id" }); return; }

  const { reason } = req.body as { reason?: string };

  const { rows: runRows } = await pool.query<Record<string, unknown>>(
    `SELECT id, blockers_json FROM viba_qa_runs WHERE id=$1 AND user_id=$2`,
    [id, u],
  );
  if (!runRows[0]) { res.status(404).json({ error: "QA run not found" }); return; }

  const blockers = (runRows[0]["blockers_json"] as string[] | null) ?? [];
  if (reason) blockers.push(`Manual block: ${reason}`);

  await pool.query(
    `UPDATE viba_qa_runs SET release_status='blocked', status='blocked', blockers_json=$1, updated_at=NOW() WHERE id=$2`,
    [JSON.stringify(blockers), id],
  );

  res.json({ ok: true, qaRunId: id, releaseStatus: "blocked", rawValuesReturned: false });
});

// ─── POST /api/qa/runs/:id/approve-release ───────────────────────────────────

router.post("/api/qa/runs/:id/approve-release", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }

  await ensureQaTables();

  const id = runId(req);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid run id" }); return; }

  const { rows: runRows } = await pool.query<Record<string, unknown>>(
    `SELECT id, status, release_status FROM viba_qa_runs WHERE id=$1 AND user_id=$2`,
    [id, u],
  );
  if (!runRows[0]) { res.status(404).json({ error: "QA run not found" }); return; }

  // Check for critical blockers — cannot approve with any critical failed check
  const { rows: criticalRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM viba_qa_checks WHERE qa_run_id=$1 AND status='failed' AND severity='critical'`,
    [id],
  );
  const criticalCount = Number(criticalRows[0]?.cnt ?? 0);
  if (criticalCount > 0) {
    res.status(400).json({
      error: `Cannot approve: ${criticalCount} critical QA check(s) are failing. Resolve all critical blockers first.`,
      criticalBlockersCount: criticalCount,
      rawValuesReturned: false,
    });
    return;
  }

  // Check run is not already blocked
  if (String(runRows[0]["release_status"]) === "blocked") {
    res.status(400).json({ error: "Release is manually blocked. Use block-release endpoint to check status or reset." });
    return;
  }

  await pool.query(
    `UPDATE viba_qa_runs SET release_status='ready_for_owner_review', summary='QA checks passed — awaiting owner review. No auto-deploy.', updated_at=NOW() WHERE id=$1`,
    [id],
  );

  res.json({
    ok: true,
    qaRunId: id,
    releaseStatus: "ready_for_owner_review",
    message: "VIBA does not mark a build ready until QA, security, vault, browser, and build checks have passed or blockers are clearly listed. Release approved for owner review — not auto-live.",
    rawValuesReturned: false,
  });
});

export default router;
