/**
 * VIBA Project Import + Repair Pipeline — API Routes
 *
 * POST /api/project-import/create                      — create import record
 * GET  /api/project-import/:importId                   — get import status (no secrets)
 * GET  /api/project-import/:importId/analysis          — get analysis (no secrets)
 * POST /api/project-import/:importId/start-analysis    — trigger project analysis
 * POST /api/project-import/:importId/create-repair-task — create viba_task from repair plan
 * POST /api/project-import/:importId/cancel            — cancel import
 *
 * Security:
 * - Never returns raw secrets, API keys, tokens, or env values
 * - Zip uploads flagged for malware safety before any execution
 * - GitHub imports are read-only inspection only
 * - Deploy steps require Tool Broker approval
 * - rawValuesReturned: false on every response
 */
import { Router } from "express";
import { pool } from "@workspace/db";
import { analyzeProject, type SourceType, type AnalyzerInput } from "../lib/projectAnalyzer";
import { generateRepairPlan } from "../lib/repairPlanGenerator";

const router = Router();

// ─── Auth helper ──────────────────────────────────────────────────────────────

function uid(req: { session?: { userId?: number } }): number {
  return typeof req.session?.userId === "number" ? req.session.userId : 0;
}

function importId(req: { params: { importId?: string } }): number {
  return parseInt(String(req.params["importId"] ?? ""), 10);
}

// ─── DB bootstrap ─────────────────────────────────────────────────────────────

export async function ensureImportTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_project_imports (
      id                  SERIAL PRIMARY KEY,
      user_id             INTEGER NOT NULL,
      source_type         TEXT NOT NULL,
      repo_url            TEXT,
      upload_id           TEXT,
      railway_project_id  TEXT,
      description         TEXT,
      known_errors_json   JSONB NOT NULL DEFAULT '[]',
      status              TEXT NOT NULL DEFAULT 'created',
      analysis_json       JSONB,
      repair_plan_json    JSONB,
      task_id             INTEGER,
      strict_mode         BOOLEAN NOT NULL DEFAULT FALSE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_imports_user ON viba_project_imports(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_imports_status ON viba_project_imports(status)`);
}

// ─── Valid source types ───────────────────────────────────────────────────────

const VALID_SOURCE_TYPES: SourceType[] = ["github_repo", "zip_upload", "railway_project", "manual"];

// ─── Safe response helper ─────────────────────────────────────────────────────

const FORBIDDEN_FIELDS = new Set([
  "password", "token", "api_key", "secret", "key", "webhook_secret",
  "database_url", "smtp_pass", "auth_tag", "iv", "encrypted_value",
  "private_key", "access_token", "refresh_token", "raw_key", "secret_value",
]);

function safeImport(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (FORBIDDEN_FIELDS.has(k.toLowerCase())) out[k] = "[REDACTED]";
    else out[k] = v;
  }
  return out;
}

// ─── Write agent comms helper ─────────────────────────────────────────────────

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
      [userId, taskId, fromAgent, null, messageType, message, JSON.stringify(metadata)],
    );
  } catch {
    // Agent comms are best-effort
  }
}

// ─── POST /api/project-import/create ─────────────────────────────────────────

router.post("/api/project-import/create", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }

  await ensureImportTables();

  const {
    sourceType,
    repoUrl,
    uploadId,
    railwayProjectId,
    description,
    knownErrors = [],
    strictMode = false,
  } = req.body as {
    sourceType?: string;
    repoUrl?: string;
    uploadId?: string;
    railwayProjectId?: string;
    description?: string;
    knownErrors?: string[];
    strictMode?: boolean;
  };

  if (!sourceType || !VALID_SOURCE_TYPES.includes(sourceType as SourceType)) {
    res.status(400).json({
      error: `sourceType must be one of: ${VALID_SOURCE_TYPES.join(", ")}`,
      rawValuesReturned: false,
    });
    return;
  }

  // Source-specific validation
  if (sourceType === "github_repo" && !repoUrl) {
    res.status(400).json({ error: "repoUrl required for github_repo source", rawValuesReturned: false });
    return;
  }
  if (sourceType === "zip_upload" && !uploadId) {
    res.status(400).json({ error: "uploadId required for zip_upload source", rawValuesReturned: false });
    return;
  }
  if (sourceType === "railway_project" && !railwayProjectId) {
    res.status(400).json({ error: "railwayProjectId required for railway_project source", rawValuesReturned: false });
    return;
  }
  if (sourceType === "manual" && !description) {
    res.status(400).json({ error: "description required for manual import", rawValuesReturned: false });
    return;
  }

  const { rows } = await pool.query<Record<string, unknown>>(
    `INSERT INTO viba_project_imports
       (user_id, source_type, repo_url, upload_id, railway_project_id, description, known_errors_json, status, strict_mode, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'created', $8, NOW(), NOW())
     RETURNING id, user_id, source_type, repo_url, upload_id, railway_project_id, description, known_errors_json, status, strict_mode, created_at, updated_at`,
    [u, sourceType, repoUrl ?? null, uploadId ?? null, railwayProjectId ?? null, description ?? null, JSON.stringify(knownErrors), Boolean(strictMode)],
  );

  const record = rows[0];
  res.status(201).json({
    ok: true,
    importId: record?.["id"],
    import: safeImport(record ?? {}),
    message: "VIBA imports projects in a safe inspection mode first. Unknown code is not executed until safety checks pass. Destructive actions require approval.",
    rawValuesReturned: false,
  });
});

// ─── GET /api/project-import/:importId ───────────────────────────────────────

router.get("/api/project-import/:importId", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }

  await ensureImportTables();

  const id = importId(req);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid importId" }); return; }

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT id, user_id, source_type, repo_url, upload_id, railway_project_id, description,
            known_errors_json, status, task_id, strict_mode, created_at, updated_at
       FROM viba_project_imports WHERE id=$1 AND user_id=$2`,
    [id, u],
  );

  if (!rows[0]) { res.status(404).json({ error: "Import not found" }); return; }
  res.json({ ok: true, import: safeImport(rows[0]), rawValuesReturned: false });
});

// ─── GET /api/project-import/:importId/analysis ──────────────────────────────

router.get("/api/project-import/:importId/analysis", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }

  await ensureImportTables();

  const id = importId(req);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid importId" }); return; }

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT id, status, analysis_json, repair_plan_json FROM viba_project_imports WHERE id=$1 AND user_id=$2`,
    [id, u],
  );

  if (!rows[0]) { res.status(404).json({ error: "Import not found" }); return; }

  const row = rows[0];
  if (!row["analysis_json"]) {
    res.status(404).json({ error: "Analysis not yet available. Call POST /start-analysis first.", status: row["status"], rawValuesReturned: false });
    return;
  }

  res.json({
    ok: true,
    status: row["status"],
    analysis: row["analysis_json"],
    repairPlan: row["repair_plan_json"] ?? null,
    rawValuesReturned: false,
  });
});

// ─── POST /api/project-import/:importId/start-analysis ───────────────────────

router.post("/api/project-import/:importId/start-analysis", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }

  await ensureImportTables();

  const id = importId(req);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid importId" }); return; }

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_project_imports WHERE id=$1 AND user_id=$2`,
    [id, u],
  );

  if (!rows[0]) { res.status(404).json({ error: "Import not found" }); return; }
  const record = rows[0];

  if (String(record["status"]) === "cancelled") {
    res.status(400).json({ error: "Cannot analyze a cancelled import" }); return;
  }

  // Additional metadata from request body
  const { fileList = [], packageJsonContent = {}, configuredEnvNames = [], vaultCredentialNames = [] } = req.body as {
    fileList?: string[];
    packageJsonContent?: Record<string, unknown>;
    configuredEnvNames?: string[];
    vaultCredentialNames?: string[];
  };

  await pool.query(
    `UPDATE viba_project_imports SET status='analyzing', updated_at=NOW() WHERE id=$1`,
    [id],
  );

  // Run analysis — pure metadata only, never executes uploaded code
  const analyzerInput: AnalyzerInput = {
    sourceType: String(record["source_type"]) as SourceType,
    repoUrl: record["repo_url"] ? String(record["repo_url"]) : undefined,
    fileList,
    packageJsonContent,
    description: record["description"] ? String(record["description"]) : "",
    knownErrors: (record["known_errors_json"] as string[] | null) ?? [],
    configuredEnvNames,
    vaultCredentialNames,
    strictMode: Boolean(record["strict_mode"]),
  };

  let analysis;
  try {
    analysis = analyzeProject(analyzerInput);
  } catch (err) {
    await pool.query(
      `UPDATE viba_project_imports SET status='failed', updated_at=NOW() WHERE id=$1`,
      [id],
    );
    res.status(500).json({ error: `Analysis failed: ${String(err)}`, rawValuesReturned: false });
    return;
  }

  // Generate repair plan
  const repairPlan = generateRepairPlan({
    analysis,
    knownErrors: (record["known_errors_json"] as string[] | null) ?? [],
    userRequest: record["description"] ? String(record["description"]) : "Repair and analyze project",
    strictMode: Boolean(record["strict_mode"]),
  });

  await pool.query(
    `UPDATE viba_project_imports SET status='analysis_complete', analysis_json=$1, repair_plan_json=$2, updated_at=NOW() WHERE id=$3`,
    [JSON.stringify(analysis), JSON.stringify(repairPlan), id],
  );

  res.json({
    ok: true,
    importId: id,
    status: "analysis_complete",
    analysis,
    repairPlan,
    rawValuesReturned: false,
  });
});

// ─── POST /api/project-import/:importId/create-repair-task ───────────────────

router.post("/api/project-import/:importId/create-repair-task", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }

  await ensureImportTables();

  const id = importId(req);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid importId" }); return; }

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_project_imports WHERE id=$1 AND user_id=$2`,
    [id, u],
  );

  if (!rows[0]) { res.status(404).json({ error: "Import not found" }); return; }
  const record = rows[0];

  if (!record["analysis_json"]) {
    res.status(400).json({ error: "Run start-analysis first before creating a repair task", rawValuesReturned: false });
    return;
  }

  const analysis = record["analysis_json"] as Record<string, unknown>;
  const repairPlan = record["repair_plan_json"] as Record<string, unknown>;

  // Create viba_task (ensure tasks table exists first)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_tasks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      request TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      plan_json JSONB,
      risk_level TEXT NOT NULL DEFAULT 'low',
      needs_user_approval BOOLEAN NOT NULL DEFAULT FALSE,
      recommended_ai_collaboration BOOLEAN NOT NULL DEFAULT FALSE,
      safe_build_required BOOLEAN NOT NULL DEFAULT FALSE,
      safe_build_passed BOOLEAN,
      approved_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      evidence_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const projectName = String(analysis["projectName"] ?? "imported project");
  const taskRequest = `Repair and analyze ${projectName} — imported via ${String(record["source_type"])}`;
  const riskLevel = String(repairPlan?.["riskLevel"] ?? "medium");
  const needsApproval = Boolean(repairPlan?.["approvalRequired"] ?? false);
  const safeBuildRequired = Boolean(repairPlan?.["safeBuildRequired"] ?? false);

  const { rows: taskRows } = await pool.query<Record<string, unknown>>(
    `INSERT INTO viba_tasks (user_id, request, status, plan_json, risk_level, needs_user_approval, recommended_ai_collaboration, safe_build_required, created_at, updated_at)
     VALUES ($1, $2, 'planning', $3, $4, $5, TRUE, $6, NOW(), NOW())
     RETURNING id, user_id, request, status, risk_level, needs_user_approval, safe_build_required, created_at`,
    [u, taskRequest, JSON.stringify(repairPlan), riskLevel, needsApproval, safeBuildRequired],
  );

  const task = taskRows[0];
  if (!task) {
    res.status(500).json({ error: "Failed to create repair task", rawValuesReturned: false });
    return;
  }

  const taskId = Number(task["id"]);

  // Update import record with task_id
  await pool.query(
    `UPDATE viba_project_imports SET task_id=$1, status='repair_task_created', updated_at=NOW() WHERE id=$2`,
    [taskId, id],
  );

  // Write initial agent messages — never include raw secrets
  await writeAgentMessage(u, taskId, "coordinator", "project_imported",
    `Project imported: ${projectName} (${String(analysis["sourceType"])}). Framework: ${String(analysis["detectedFramework"])}. Package manager: ${String(analysis["packageManager"])}.`,
    { importId: id, projectName, sourceType: analysis["sourceType"], framework: analysis["detectedFramework"] });

  await writeAgentMessage(u, taskId, "repo_analyzer", "framework_detected",
    `Framework detected: ${String(analysis["detectedFramework"])}. Package manager: ${String(analysis["packageManager"])}. Languages: ${(analysis["languages"] as string[]).join(", ")}.`,
    { detectedFramework: analysis["detectedFramework"], packageManager: analysis["packageManager"], languages: analysis["languages"] });

  const blockers = analysis["launchBlockers"] as string[];
  if (blockers && blockers.length > 0) {
    await writeAgentMessage(u, taskId, "coordinator", "blockers_found",
      `${blockers.length} launch blocker(s) found: ${blockers.slice(0, 3).join("; ")}${blockers.length > 3 ? "…" : ""}`,
      { blockerCount: blockers.length, blockers: blockers.slice(0, 5) });
  }

  await writeAgentMessage(u, taskId, "coordinator", "repair_plan_created",
    `Repair plan created: ${String(repairPlan?.["estimatedStepCount"] ?? 0)} steps. Risk level: ${riskLevel}. Approval required: ${needsApproval ? "yes" : "no"}.`,
    { planId: repairPlan?.["planId"], stepCount: repairPlan?.["estimatedStepCount"], riskLevel });

  await writeAgentMessage(u, taskId, "builder", "safe_build_status",
    safeBuildRequired
      ? "Safe build is required before any deployment. Run: pnpm run safe-build"
      : "Safe build not required for this repair plan.",
    { safeBuildRequired });

  await writeAgentMessage(u, taskId, "qa", "qa_status",
    Boolean(repairPlan?.["qaRequired"])
      ? "QA Release Gate is required before owner review. Run QA Gate after safe build passes."
      : "QA gate not required for this repair plan.",
    { qaRequired: repairPlan?.["qaRequired"] });

  const envMissing = analysis["envMissing"] as string[] | undefined;
  if (envMissing && envMissing.length > 0) {
    await writeAgentMessage(u, taskId, "vault", "credential_required",
      `Vault credential required: ${envMissing.length} env var(s) not configured. Names: ${envMissing.slice(0, 3).join(", ")}. No raw values stored in this message.`,
      { credentialCount: envMissing.length, names: envMissing.slice(0, 5), rawValuesReturned: false });
  }

  res.status(201).json({
    ok: true,
    taskId,
    importId: id,
    task: {
      id: taskId,
      request: taskRequest,
      status: "planning",
      riskLevel,
      needsUserApproval: needsApproval,
      safeBuildRequired,
    },
    message: "Repair task created. Use Agent Console to monitor execution.",
    rawValuesReturned: false,
  });
});

// ─── POST /api/project-import/:importId/cancel ───────────────────────────────

router.post("/api/project-import/:importId/cancel", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required" }); return; }

  await ensureImportTables();

  const id = importId(req);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid importId" }); return; }

  const { rows } = await pool.query<Record<string, unknown>>(
    `UPDATE viba_project_imports SET status='cancelled', updated_at=NOW()
     WHERE id=$1 AND user_id=$2 AND status NOT IN ('cancelled', 'repair_task_created')
     RETURNING id, status`,
    [id, u],
  );

  if (!rows[0]) {
    res.status(404).json({ error: "Import not found or already in a terminal state", rawValuesReturned: false });
    return;
  }

  res.json({ ok: true, importId: id, status: "cancelled", rawValuesReturned: false });
});

export default router;
