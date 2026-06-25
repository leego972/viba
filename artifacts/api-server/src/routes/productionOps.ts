/**
 * VIBA Production Operations Center — API Routes
 *
 * POST /api/production-ops/targets
 * GET  /api/production-ops/targets
 * GET  /api/production-ops/targets/:targetId
 * POST /api/production-ops/targets/:targetId/check-now
 * GET  /api/production-ops/targets/:targetId/checks
 * GET  /api/production-ops/targets/:targetId/incidents
 * POST /api/production-ops/incidents/:incidentId/create-repair-task
 * POST /api/production-ops/incidents/:incidentId/mark-resolved
 * GET  /api/production-ops/summary
 *
 * Security:
 * - All health checks are read-only
 * - No production mutations without Tool Broker approval
 * - rawValuesReturned: false on every response
 * - evidence_json sanitised before storage/return
 */
import { Router } from "express";
import { pool } from "@workspace/db";
import {
  runAllChecks,
  summariseChecks,
  shouldCreateIncident,
  incidentSeverityFor,
  sanitiseEvidence,
  type CheckTarget,
} from "../lib/productionHealthEngine";
import { generateRepairPlan } from "../lib/repairPlanGenerator";
import { analyzeProject } from "../lib/projectAnalyzer";

const router = Router();

// ─── Auth helper ──────────────────────────────────────────────────────────────

function uid(req: { session?: { userId?: number } }): number {
  return typeof req.session?.userId === "number" ? req.session.userId : 0;
}

function tid(req: { params: { targetId?: string } }): number {
  return parseInt(String(req.params["targetId"] ?? ""), 10);
}

function iid(req: { params: { incidentId?: string } }): number {
  return parseInt(String(req.params["incidentId"] ?? ""), 10);
}

// ─── DB bootstrap ─────────────────────────────────────────────────────────────

export async function ensureProductionTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_production_targets (
      id                  SERIAL PRIMARY KEY,
      user_id             INTEGER NOT NULL,
      app_name            TEXT NOT NULL,
      public_url          TEXT NOT NULL,
      api_health_url      TEXT NOT NULL DEFAULT '',
      railway_project_id  TEXT,
      railway_service_id  TEXT,
      status              TEXT NOT NULL DEFAULT 'unknown',
      strict_mode         BOOLEAN NOT NULL DEFAULT FALSE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_prod_targets_user ON viba_production_targets(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_prod_targets_status ON viba_production_targets(status)`);
  await pool.query(`ALTER TABLE viba_production_targets ADD COLUMN IF NOT EXISTS provider_id TEXT DEFAULT 'railway'`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_production_checks (
      id              SERIAL PRIMARY KEY,
      target_id       INTEGER NOT NULL,
      user_id         INTEGER NOT NULL,
      check_type      TEXT NOT NULL,
      status          TEXT NOT NULL,
      severity        TEXT NOT NULL DEFAULT 'low',
      http_status     INTEGER,
      response_time_ms INTEGER,
      error           TEXT,
      evidence_json   JSONB NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_prod_checks_target ON viba_production_checks(target_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_prod_checks_status ON viba_production_checks(status, severity)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_incidents (
      id              SERIAL PRIMARY KEY,
      target_id       INTEGER NOT NULL,
      user_id         INTEGER NOT NULL,
      status          TEXT NOT NULL DEFAULT 'open',
      severity        TEXT NOT NULL DEFAULT 'medium',
      title           TEXT NOT NULL,
      summary         TEXT NOT NULL DEFAULT '',
      detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at     TIMESTAMPTZ,
      repair_task_id  INTEGER,
      evidence_json   JSONB NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_incidents_target ON viba_incidents(target_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_incidents_status ON viba_incidents(status, severity)`);
}

// ─── Agent comms helper ───────────────────────────────────────────────────────

async function writeAgentMessage(
  userId: number,
  taskId: number,
  fromAgent: string,
  messageType: string,
  message: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO viba_agent_comms (user_id, task_id, from_agent, to_agent, message_type, message, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, taskId, fromAgent, null, messageType, message, JSON.stringify({ ...metadata, rawValuesReturned: false })],
    );
  } catch {
    // best-effort
  }
}

// ─── Safe response helpers ────────────────────────────────────────────────────

function safeTarget(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row["id"], userId: row["user_id"], appName: row["app_name"],
    publicUrl: row["public_url"], apiHealthUrl: row["api_health_url"],
    railwayProjectId: row["railway_project_id"], railwayServiceId: row["railway_service_id"],
    providerId: row["provider_id"] ?? "railway",
    status: row["status"], strictMode: row["strict_mode"],
    createdAt: row["created_at"], updatedAt: row["updated_at"],
    rawValuesReturned: false,
  };
}

function safeCheck(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row["id"], targetId: row["target_id"], checkType: row["check_type"],
    status: row["status"], severity: row["severity"],
    httpStatus: row["http_status"], responseTimeMs: row["response_time_ms"],
    error: row["error"],
    evidenceJson: sanitiseEvidence((row["evidence_json"] as Record<string, unknown> | null) ?? {}),
    createdAt: row["created_at"],
    rawValuesReturned: false,
  };
}

function safeIncident(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row["id"], targetId: row["target_id"], status: row["status"],
    severity: row["severity"], title: row["title"], summary: row["summary"],
    detectedAt: row["detected_at"], resolvedAt: row["resolved_at"],
    repairTaskId: row["repair_task_id"],
    evidenceJson: sanitiseEvidence((row["evidence_json"] as Record<string, unknown> | null) ?? {}),
    createdAt: row["created_at"], updatedAt: row["updated_at"],
    rawValuesReturned: false,
  };
}

// ─── POST /api/production-ops/targets ────────────────────────────────────────

router.post("/api/production-ops/targets", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  await ensureProductionTables();

  const { appName, publicUrl, apiHealthUrl = "", railwayProjectId, railwayServiceId, providerId = "railway", strictMode = false } =
    req.body as { appName?: string; publicUrl?: string; apiHealthUrl?: string; railwayProjectId?: string; railwayServiceId?: string; providerId?: string; strictMode?: boolean };

  if (!appName || !publicUrl) {
    res.status(400).json({ error: "appName and publicUrl are required", rawValuesReturned: false }); return;
  }

  try { new URL(publicUrl); } catch {
    res.status(400).json({ error: "publicUrl must be a valid URL", rawValuesReturned: false }); return;
  }

  const VALID_PROVIDER_IDS = ["railway", "render", "digitalocean", "vercel", "sevall", "custom"];
  const resolvedProviderId = VALID_PROVIDER_IDS.includes(providerId) ? providerId : "railway";

  const { rows } = await pool.query<Record<string, unknown>>(
    `INSERT INTO viba_production_targets (user_id, app_name, public_url, api_health_url, railway_project_id, railway_service_id, provider_id, strict_mode, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'unknown') RETURNING *`,
    [u, appName, publicUrl, apiHealthUrl, railwayProjectId ?? null, railwayServiceId ?? null, resolvedProviderId, Boolean(strictMode)],
  );

  res.status(201).json({ ok: true, target: safeTarget(rows[0] ?? {}), rawValuesReturned: false });
});

// ─── GET /api/production-ops/targets ─────────────────────────────────────────

router.get("/api/production-ops/targets", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  await ensureProductionTables();

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_production_targets WHERE user_id=$1 ORDER BY created_at DESC`,
    [u],
  );

  res.json({ ok: true, targets: rows.map(safeTarget), count: rows.length, rawValuesReturned: false });
});

// ─── GET /api/production-ops/targets/:targetId ───────────────────────────────

router.get("/api/production-ops/targets/:targetId", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  await ensureProductionTables();

  const id = tid(req);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid targetId" }); return; }

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_production_targets WHERE id=$1 AND user_id=$2`,
    [id, u],
  );

  if (!rows[0]) { res.status(404).json({ error: "Target not found" }); return; }
  res.json({ ok: true, target: safeTarget(rows[0]), rawValuesReturned: false });
});

// ─── POST /api/production-ops/targets/:targetId/check-now ────────────────────

router.post("/api/production-ops/targets/:targetId/check-now", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  await ensureProductionTables();

  const id = tid(req);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid targetId" }); return; }

  const { rows: tRows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_production_targets WHERE id=$1 AND user_id=$2`,
    [id, u],
  );
  if (!tRows[0]) { res.status(404).json({ error: "Target not found" }); return; }

  const tRow = tRows[0];
  const target: CheckTarget = {
    id,
    userId: u,
    appName: String(tRow["app_name"]),
    publicUrl: String(tRow["public_url"]),
    apiHealthUrl: String(tRow["api_health_url"] ?? ""),
    railwayProjectId: tRow["railway_project_id"] ? String(tRow["railway_project_id"]) : null,
    railwayServiceId: tRow["railway_service_id"] ? String(tRow["railway_service_id"]) : null,
    providerId: tRow["provider_id"] ? String(tRow["provider_id"]) : "railway",
    strictMode: Boolean(tRow["strict_mode"]),
  };

  // Run all checks (read-only)
  const checks = await runAllChecks(target);
  const summary = summariseChecks(id, target.appName, checks);

  // Store check results
  const checkIds: number[] = [];
  for (const check of checks) {
    const { rows: cRows } = await pool.query<Record<string, unknown>>(
      `INSERT INTO viba_production_checks (target_id, user_id, check_type, status, severity, http_status, response_time_ms, error, evidence_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [id, u, check.checkType, check.status, check.severity, check.httpStatus ?? null,
       check.responseTimeMs ?? null, check.error ?? null, JSON.stringify(sanitiseEvidence(check.evidenceJson))],
    );
    checkIds.push(Number(cRows[0]?.["id"] ?? 0));
  }

  // Update target status
  const newTargetStatus = summary.overallStatus === "failing" ? "failing"
    : summary.overallStatus === "warning" ? "active"
    : summary.overallStatus === "healthy" ? "healthy" : "unknown";
  await pool.query(
    `UPDATE viba_production_targets SET status=$1, updated_at=NOW() WHERE id=$2`,
    [newTargetStatus, id],
  );

  // Auto-create incidents for critical/high failures
  const newIncidents: Record<string, unknown>[] = [];
  for (const check of checks) {
    if (!shouldCreateIncident(check)) continue;

    const title = `[${check.severity.toUpperCase()}] ${target.appName}: ${check.checkType.replace(/_/g, " ")} failed`;
    const { rows: iRows } = await pool.query<Record<string, unknown>>(
      `INSERT INTO viba_incidents (target_id, user_id, severity, title, summary, evidence_json, status)
       VALUES ($1,$2,$3,$4,$5,$6,'open')
       RETURNING *`,
      [id, u, check.severity, title,
       check.error ?? `${check.checkType} check failed`,
       JSON.stringify(sanitiseEvidence({ ...check.evidenceJson, checkType: check.checkType, httpStatus: check.httpStatus, error: check.error, rawValuesReturned: false }))],
    );
    if (iRows[0]) newIncidents.push(safeIncident(iRows[0]));

    // Update target status to incident_open
    if (summary.criticalCount > 0) {
      await pool.query(`UPDATE viba_production_targets SET status='incident_open', updated_at=NOW() WHERE id=$1`, [id]);
    }
  }

  res.json({
    ok: true,
    targetId: id,
    summary,
    checks: checks.map((c, i) => ({ ...c, checkId: checkIds[i] })),
    newIncidents,
    rawValuesReturned: false,
  });
});

// ─── GET /api/production-ops/targets/:targetId/checks ────────────────────────

router.get("/api/production-ops/targets/:targetId/checks", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  await ensureProductionTables();

  const id = tid(req);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid targetId" }); return; }

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_production_checks WHERE target_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100`,
    [id, u],
  );

  res.json({ ok: true, checks: rows.map(safeCheck), count: rows.length, rawValuesReturned: false });
});

// ─── GET /api/production-ops/targets/:targetId/incidents ─────────────────────

router.get("/api/production-ops/targets/:targetId/incidents", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  await ensureProductionTables();

  const id = tid(req);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid targetId" }); return; }

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_incidents WHERE target_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 50`,
    [id, u],
  );

  res.json({ ok: true, incidents: rows.map(safeIncident), count: rows.length, rawValuesReturned: false });
});

// ─── POST /api/production-ops/incidents/:incidentId/create-repair-task ───────

router.post("/api/production-ops/incidents/:incidentId/create-repair-task", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  await ensureProductionTables();

  const id = iid(req);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid incidentId" }); return; }

  const { rows: iRows } = await pool.query<Record<string, unknown>>(
    `SELECT i.*, t.app_name, t.public_url, t.api_health_url, t.strict_mode
       FROM viba_incidents i
       JOIN viba_production_targets t ON t.id = i.target_id
      WHERE i.id=$1 AND i.user_id=$2`,
    [id, u],
  );
  if (!iRows[0]) { res.status(404).json({ error: "Incident not found" }); return; }

  const incident = iRows[0];
  if (String(incident["status"]) === "resolved") {
    res.status(400).json({ error: "Incident is already resolved", rawValuesReturned: false }); return;
  }

  // Generate analysis + repair plan for the incident
  const analysis = analyzeProject({
    sourceType: "manual",
    description: `Production incident: ${String(incident["title"])}. ${String(incident["summary"])}`,
    knownErrors: [String(incident["summary"])],
  });

  const repairPlan = generateRepairPlan({
    analysis,
    knownErrors: [String(incident["summary"])],
    userRequest: `Fix production incident: ${String(incident["title"])}`,
  });

  // Create viba_task (ensure table exists)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_tasks (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, request TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created', plan_json JSONB,
      risk_level TEXT NOT NULL DEFAULT 'low', needs_user_approval BOOLEAN NOT NULL DEFAULT FALSE,
      recommended_ai_collaboration BOOLEAN NOT NULL DEFAULT FALSE,
      safe_build_required BOOLEAN NOT NULL DEFAULT FALSE, safe_build_passed BOOLEAN,
      approved_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ, evidence_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const taskRequest = `Repair: ${String(incident["title"])}`;
  const riskLevel = String(repairPlan.riskLevel);
  const needsApproval = repairPlan.approvalRequired;
  const safeBuildRequired = repairPlan.safeBuildRequired;

  const { rows: taskRows } = await pool.query<Record<string, unknown>>(
    `INSERT INTO viba_tasks (user_id, request, status, plan_json, risk_level, needs_user_approval, recommended_ai_collaboration, safe_build_required)
     VALUES ($1,$2,'planning',$3,$4,$5,TRUE,$6) RETURNING id, status, risk_level`,
    [u, taskRequest, JSON.stringify(repairPlan), riskLevel, needsApproval, safeBuildRequired],
  );

  const task = taskRows[0];
  if (!task) { res.status(500).json({ error: "Failed to create repair task", rawValuesReturned: false }); return; }

  const taskId = Number(task["id"]);

  // Update incident
  await pool.query(
    `UPDATE viba_incidents SET repair_task_id=$1, status='repair_task_created', updated_at=NOW() WHERE id=$2`,
    [taskId, id],
  );

  // Agent messages
  await writeAgentMessage(u, taskId, "coordinator", "production_incident_detected",
    `Production incident detected: ${String(incident["title"])}. Severity: ${String(incident["severity"])}.`,
    { incidentId: id, severity: incident["severity"], targetId: incident["target_id"] });

  await writeAgentMessage(u, taskId, "security", "security_check",
    `TLS, auth, and vault checks required before any repair action. No secrets in evidence.`,
    { rawValuesReturned: false });

  await writeAgentMessage(u, taskId, "builder", "safe_build_status",
    safeBuildRequired
      ? "Repair requires safe-build before any deployment. Run: pnpm run safe-build."
      : "Safe build not required for this repair plan.",
    { safeBuildRequired });

  await writeAgentMessage(u, taskId, "deployment", "approval_required",
    "Deployment action requires explicit owner approval. No automatic production mutation.",
    { approvalRequired: needsApproval });

  await writeAgentMessage(u, taskId, "reviewer", "evidence_report",
    "Repair evidence report will be generated after all steps complete. rawValuesReturned: false.",
    { rawValuesReturned: false });

  res.status(201).json({
    ok: true,
    taskId,
    incidentId: id,
    repairPlan: { ...repairPlan, rawValuesReturned: false },
    message: "Repair task created. Use Agent Console to monitor execution. Deployment requires approval.",
    rawValuesReturned: false,
  });
});

// ─── POST /api/production-ops/incidents/:incidentId/mark-resolved ─────────────

router.post("/api/production-ops/incidents/:incidentId/mark-resolved", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  await ensureProductionTables();

  const id = iid(req);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid incidentId" }); return; }

  const { rows } = await pool.query<Record<string, unknown>>(
    `UPDATE viba_incidents SET status='resolved', resolved_at=NOW(), updated_at=NOW()
     WHERE id=$1 AND user_id=$2 AND status != 'resolved' RETURNING id, status, resolved_at`,
    [id, u],
  );

  if (!rows[0]) { res.status(404).json({ error: "Incident not found or already resolved", rawValuesReturned: false }); return; }

  res.json({ ok: true, incidentId: id, status: "resolved", resolvedAt: rows[0]["resolved_at"], rawValuesReturned: false });
});

// ─── GET /api/production-ops/summary ─────────────────────────────────────────

router.get("/api/production-ops/summary", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }
  await ensureProductionTables();

  const [targetsRes, incidentsRes, checksRes] = await Promise.all([
    pool.query<Record<string, unknown>>(
      `SELECT status, COUNT(*) as cnt FROM viba_production_targets WHERE user_id=$1 GROUP BY status`,
      [u],
    ),
    pool.query<Record<string, unknown>>(
      `SELECT severity, COUNT(*) as cnt FROM viba_incidents WHERE user_id=$1 AND status='open' GROUP BY severity`,
      [u],
    ),
    pool.query<Record<string, unknown>>(
      `SELECT MAX(created_at) as last_check FROM viba_production_checks WHERE user_id=$1`,
      [u],
    ),
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of targetsRes.rows) byStatus[String(r["status"])] = Number(r["cnt"]);

  const bySeverity: Record<string, number> = {};
  for (const r of incidentsRes.rows) bySeverity[String(r["severity"])] = Number(r["cnt"]);

  res.json({
    ok: true,
    targets: {
      healthy: byStatus["healthy"] ?? 0,
      failing: (byStatus["failing"] ?? 0) + (byStatus["incident_open"] ?? 0),
      paused: byStatus["paused"] ?? 0,
      unknown: byStatus["unknown"] ?? 0,
    },
    openIncidents: {
      critical: bySeverity["critical"] ?? 0,
      high: bySeverity["high"] ?? 0,
      medium: bySeverity["medium"] ?? 0,
      low: bySeverity["low"] ?? 0,
      total: Object.values(bySeverity).reduce((a, b) => a + b, 0),
    },
    lastCheckAt: checksRes.rows[0]?.["last_check"] ?? null,
    rawValuesReturned: false,
  });
});

export default router;
