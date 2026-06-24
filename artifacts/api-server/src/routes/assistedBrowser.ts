import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  creditStateForStatus,
  expiresAtFor,
  isValidAuthorizationType,
  isWaitingStatus,
  redactBrowserMetadata,
  shouldPauseForReason,
  shouldRetryInsteadOfPause,
  WAITING_STATUS_BY_TYPE,
  type BrowserAuthorizationStatus,
  type BrowserAuthorizationType,
  type BrowserCreditState,
} from "./browserAuthorizationBridgeRuntime";

const router: IRouter = Router();

export type JobStatus = BrowserAuthorizationStatus | "created" | "paused";
export type CreditState = BrowserCreditState | "idle";
export type WaitingForType = BrowserAuthorizationType | null;

export interface BrowserOperatorJob {
  id: string;
  user_id: number | null;
  template_id: string | null;
  provider: string;
  target_url: string;
  status: JobStatus;
  credit_state: CreditState;
  current_step: string | null;
  last_url: string | null;
  checkpoint_json: Record<string, unknown>;
  waiting_for_type: WaitingForType;
  waiting_for_reason: string | null;
  authorization_expires_at: string | null;
  outputs_json: Record<string, unknown>;
  audit_json: Array<{ ts: string; event: string; detail?: string; metadata?: Record<string, unknown> }>;
  created_at: string;
  updated_at: string;
}

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS browser_operator_jobs (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id INTEGER,
      template_id TEXT,
      provider TEXT NOT NULL,
      target_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      credit_state TEXT NOT NULL DEFAULT 'idle',
      current_step TEXT,
      last_url TEXT,
      checkpoint_json JSONB NOT NULL DEFAULT '{}',
      waiting_for_type TEXT,
      waiting_for_reason TEXT,
      authorization_expires_at TIMESTAMPTZ,
      outputs_json JSONB NOT NULL DEFAULT '{}',
      audit_json JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE browser_operator_jobs ADD COLUMN IF NOT EXISTS last_url TEXT`);
  await pool.query(`ALTER TABLE browser_operator_jobs ADD COLUMN IF NOT EXISTS checkpoint_json JSONB NOT NULL DEFAULT '{}'`);
  await pool.query(`ALTER TABLE browser_operator_jobs ADD COLUMN IF NOT EXISTS authorization_expires_at TIMESTAMPTZ`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_browser_operator_jobs_user ON browser_operator_jobs (user_id, status, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS browser_operator_authorizations (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      job_id TEXT NOT NULL,
      user_id INTEGER,
      provider TEXT NOT NULL,
      authorization_type TEXT NOT NULL,
      approved_action TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'current_browser_session_only',
      status TEXT NOT NULL DEFAULT 'requested',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_at TIMESTAMPTZ,
      denied_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_browser_operator_authorizations_job ON browser_operator_authorizations (job_id, created_at DESC)`);
}

function safeRow(row: Record<string, unknown>): BrowserOperatorJob {
  return {
    id: String(row.id ?? ""),
    user_id: typeof row.user_id === "number" ? row.user_id : null,
    template_id: row.template_id != null ? String(row.template_id) : null,
    provider: String(row.provider ?? ""),
    target_url: String(row.target_url ?? ""),
    status: (row.status as JobStatus) ?? "created",
    credit_state: (row.credit_state as CreditState) ?? "idle",
    current_step: row.current_step != null ? String(row.current_step) : null,
    last_url: row.last_url != null ? String(row.last_url) : null,
    checkpoint_json: (row.checkpoint_json as Record<string, unknown>) ?? {},
    waiting_for_type: (row.waiting_for_type as WaitingForType) ?? null,
    waiting_for_reason: row.waiting_for_reason != null ? String(row.waiting_for_reason) : null,
    authorization_expires_at: row.authorization_expires_at != null ? String(row.authorization_expires_at) : null,
    outputs_json: redactBrowserMetadata((row.outputs_json as Record<string, unknown>) ?? {}),
    audit_json: (row.audit_json as Array<{ ts: string; event: string; detail?: string; metadata?: Record<string, unknown> }>) ?? [],
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

async function appendAudit(
  id: string,
  event: string,
  detail?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...(detail ? { detail } : {}),
    ...(metadata ? { metadata: redactBrowserMetadata(metadata) } : {}),
  });
  await pool.query(
    `UPDATE browser_operator_jobs
        SET audit_json = audit_json || $1::jsonb,
            updated_at = NOW()
      WHERE id = $2`,
    [`[${entry}]`, id],
  );
}

const TEMPLATES = [
  {
    id: "railway-env-vars",
    label: "Railway — Environment setup",
    provider: "railway",
    target_url: "https://railway.app",
    description: "Navigate Railway project, service, environment variables, custom domains, and deployment settings.",
    likely_waits: ["oauth", "2fa", "manual_approval"],
    destructive_actions: ["replace variables", "trigger deployment", "change custom domain"],
    steps: ["Open Railway", "User authorizes if required", "Navigate project/service/environment", "Collect IDs", "Prepare changes", "Request approval", "Apply through connector or browser"],
  },
  {
    id: "stripe-webhook",
    label: "Stripe — Billing and webhooks",
    provider: "stripe",
    target_url: "https://dashboard.stripe.com",
    description: "Navigate Stripe to products, price IDs, webhook endpoints, and signing status.",
    likely_waits: ["2fa", "passkey", "manual_approval", "payment_approval"],
    destructive_actions: ["create live webhook", "rotate key", "switch test to live"],
    steps: ["Open Stripe dashboard", "User authorizes if required", "Navigate Developers and Products", "Find or create required objects", "Request approval before live changes"],
  },
  {
    id: "godaddy-dns",
    label: "GoDaddy — DNS records",
    provider: "godaddy",
    target_url: "https://dcc.godaddy.com",
    description: "Navigate GoDaddy Domain Control Center and prepare DNS changes for Railway custom domains.",
    likely_waits: ["2fa", "email_link", "passkey", "manual_approval"],
    destructive_actions: ["delete DNS record", "change root record", "change nameservers"],
    steps: ["Open GoDaddy", "User authorizes if required", "Select domain", "Read current DNS", "Detect conflicts", "Request approval before changing"],
  },
  {
    id: "github-secrets",
    label: "GitHub — Repository setup",
    provider: "github",
    target_url: "https://github.com",
    description: "Navigate repository settings, actions variables, app installation, and repo permissions.",
    likely_waits: ["oauth", "2fa", "manual_approval"],
    destructive_actions: ["change repository settings", "add deployment keys", "install app"],
    steps: ["Open GitHub", "User authorizes if required", "Navigate repo settings", "Inspect connection state", "Request approval before changes"],
  },
  {
    id: "smtp-verify",
    label: "SMTP — Provider setup",
    provider: "smtp",
    target_url: "https://app.mailgun.com",
    description: "Navigate provider dashboard to locate SMTP settings and sender verification status.",
    likely_waits: ["2fa", "email_link", "manual_approval"],
    destructive_actions: ["change sender domain", "rotate app password"],
    steps: ["Open provider", "User authorizes if required", "Locate SMTP settings", "Verify sender/domain", "Prepare redacted output names"],
  },
];

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function normalizeStatusForCredit(status: JobStatus): CreditState {
  if (status === "created" || status === "paused") return "idle";
  return creditStateForStatus(status as BrowserAuthorizationStatus);
}

router.get("/browser-operator/templates", (_req, res): void => {
  res.json({ templates: TEMPLATES, valuesReturned: false });
});

router.get("/browser-operator/jobs", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const { rows } = await pool.query(
      `SELECT * FROM browser_operator_jobs WHERE (user_id = $1 OR user_id IS NULL) ORDER BY created_at DESC LIMIT 50`,
      [uid],
    );
    res.json({ jobs: rows.map((row) => safeRow(row as Record<string, unknown>)) });
  } catch (err) {
    logger.error({ err }, "Failed to list browser operator jobs");
    res.status(500).json({ error: "Failed to list jobs" });
  }
});

router.post("/browser-operator/jobs", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const body = req.body as Record<string, unknown>;
    const templateId = typeof body.template_id === "string" ? body.template_id : null;
    const template = templateId ? TEMPLATES.find((t) => t.id === templateId) : null;
    const provider = typeof body.provider === "string" ? body.provider : (template?.provider ?? "custom");
    const targetUrl = typeof body.target_url === "string" ? body.target_url : (template?.target_url ?? "");
    if (!targetUrl) { res.status(400).json({ error: "target_url is required" }); return; }

    const checkpoint = redactBrowserMetadata({
      provider,
      templateId,
      currentUrl: targetUrl,
      currentStep: "created",
      nextAction: "start_browser_job",
      completedOutputs: [],
      pendingOutputs: template?.steps ?? [],
    });

    const { rows } = await pool.query(
      `INSERT INTO browser_operator_jobs (user_id, template_id, provider, target_url, status, credit_state, current_step, last_url, checkpoint_json, audit_json)
       VALUES ($1, $2, $3, $4, 'created', 'idle', 'Created. Ready to start.', $4, $5::jsonb, $6::jsonb)
       RETURNING *`,
      [uid, templateId, provider, targetUrl, JSON.stringify(checkpoint), JSON.stringify([{ ts: new Date().toISOString(), event: "job_created" }])],
    );
    const job = safeRow(rows[0] as Record<string, unknown>);
    logger.info({ jobId: job.id, provider, templateId }, "Browser operator job created");
    res.status(201).json({ job, valuesReturned: false });
  } catch (err) {
    logger.error({ err }, "Failed to create browser operator job");
    res.status(500).json({ error: "Failed to create job" });
  }
});

router.get("/browser-operator/jobs/:id", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const jobId = String(req.params["id"] ?? "");
    const { rows } = await pool.query(
      `SELECT * FROM browser_operator_jobs WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) LIMIT 1`,
      [jobId, uid],
    );
    if (!rows.length) { res.status(404).json({ error: "Job not found" }); return; }
    res.json({ job: safeRow(rows[0] as Record<string, unknown>), valuesReturned: false });
  } catch (err) {
    logger.error({ err }, "Failed to get browser operator job");
    res.status(500).json({ error: "Failed to get job" });
  }
});

router.post("/browser-operator/jobs/:id/start", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const jobId = String(req.params["id"] ?? "");
    const { rows } = await pool.query(
      `UPDATE browser_operator_jobs
          SET status = 'running', credit_state = 'consuming', current_step = COALESCE(current_step, 'Opening browser'), updated_at = NOW()
        WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) AND status IN ('created', 'paused', 'authorization_expired')
        RETURNING *`,
      [jobId, uid],
    );
    if (!rows.length) { res.status(404).json({ error: "Job not found or not startable" }); return; }
    await appendAudit(jobId, "job_started");
    res.json({ job: safeRow(rows[0] as Record<string, unknown>) });
  } catch (err) {
    logger.error({ err }, "Failed to start browser operator job");
    res.status(500).json({ error: "Failed to start job" });
  }
});

async function setAuthorizationRequired(req: Parameters<Parameters<IRouter["post"]>[1]>[0], res: Parameters<Parameters<IRouter["post"]>[1]>[1]): Promise<void> {
  await ensureTable();
  const uid = userId(req);
  const jobId = String(req.params["id"] ?? "");
  const body = req.body as Record<string, unknown>;
  const rawType = body.authorization_type ?? body.waiting_for_type;
  if (!isValidAuthorizationType(rawType)) { res.status(400).json({ error: "invalid_authorization_type" }); return; }
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : "User authorization required";
  if (shouldRetryInsteadOfPause(reason)) {
    res.status(409).json({ error: "retry_instead_of_pause", message: "This reason is retryable and should not pause the job." });
    return;
  }
  if (!shouldPauseForReason(`${rawType} ${reason}`)) {
    res.status(400).json({ error: "invalid_pause_reason", message: "Only user authorization reasons may pause the job." });
    return;
  }
  const waitStatus = WAITING_STATUS_BY_TYPE[rawType];
  const expiresAt = expiresAtFor(rawType);
  const approvedAction = typeof body.approved_action === "string" ? body.approved_action.slice(0, 200) : "continue_current_browser_session";

  const { rows } = await pool.query(
    `UPDATE browser_operator_jobs
        SET status = $3,
            credit_state = 'paused_waiting_for_user',
            waiting_for_type = $4,
            waiting_for_reason = $5,
            authorization_expires_at = $6,
            updated_at = NOW()
      WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) AND status IN ('running', 'resuming')
      RETURNING *`,
    [jobId, uid, waitStatus, rawType, reason, expiresAt],
  );
  if (!rows.length) { res.status(404).json({ error: "Job not found or not running" }); return; }
  await pool.query(
    `INSERT INTO browser_operator_authorizations (job_id, user_id, provider, authorization_type, approved_action, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'requested', $6)`,
    [jobId, uid, String(rows[0].provider ?? "unknown"), rawType, approvedAction, expiresAt],
  );
  await appendAudit(jobId, "authorization_required", `${rawType}: ${reason}`, { authorization_type: rawType, approved_action: approvedAction });
  res.json({ job: safeRow(rows[0] as Record<string, unknown>), valuesReturned: false });
}

router.post("/browser-operator/jobs/:id/waiting-for-user", async (req, res): Promise<void> => {
  try { await setAuthorizationRequired(req, res); } catch (err) { logger.error({ err }, "Failed to set waiting-for-user"); res.status(500).json({ error: "Failed to update job" }); }
});

router.post("/browser-operator/jobs/:id/authorization-required", async (req, res): Promise<void> => {
  try { await setAuthorizationRequired(req, res); } catch (err) { logger.error({ err }, "Failed to set authorization-required"); res.status(500).json({ error: "Failed to update job" }); }
});

router.post("/browser-operator/jobs/:id/authorize", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const jobId = String(req.params["id"] ?? "");
    const body = req.body as Record<string, unknown>;
    const nextStep = typeof body.next_step === "string" ? body.next_step.slice(0, 500) : "User authorized. Resuming browser work.";
    const { rows } = await pool.query(
      `UPDATE browser_operator_jobs
          SET status = 'resuming',
              credit_state = 'consuming',
              waiting_for_type = NULL,
              waiting_for_reason = NULL,
              current_step = $3,
              updated_at = NOW()
        WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) AND status LIKE 'waiting_for_%'
        RETURNING *`,
      [jobId, uid, nextStep],
    );
    if (!rows.length) { res.status(404).json({ error: "Job not found or not awaiting authorization" }); return; }
    await pool.query(
      `UPDATE browser_operator_authorizations SET status = 'approved', approved_at = NOW() WHERE job_id = $1 AND status = 'requested'`,
      [jobId],
    );
    await appendAudit(jobId, "user_authorized", "User authorized current browser session");
    res.json({ job: safeRow(rows[0] as Record<string, unknown>) });
  } catch (err) {
    logger.error({ err }, "Failed to authorize browser operator job");
    res.status(500).json({ error: "Failed to authorize job" });
  }
});

router.post("/browser-operator/jobs/:id/resume", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const jobId = String(req.params["id"] ?? "");
    const { rows } = await pool.query(
      `UPDATE browser_operator_jobs
          SET status = 'running', credit_state = 'consuming', current_step = 'Browser work resumed.', updated_at = NOW()
        WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) AND status IN ('resuming', 'paused')
        RETURNING *`,
      [jobId, uid],
    );
    if (!rows.length) { res.status(404).json({ error: "Job not found or not resumable" }); return; }
    await appendAudit(jobId, "job_resumed");
    res.json({ job: safeRow(rows[0] as Record<string, unknown>) });
  } catch (err) {
    logger.error({ err }, "Failed to resume browser operator job");
    res.status(500).json({ error: "Failed to resume job" });
  }
});

router.post("/browser-operator/jobs/:id/deny", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const jobId = String(req.params["id"] ?? "");
    const { rows } = await pool.query(
      `UPDATE browser_operator_jobs
          SET status = 'paused', credit_state = 'idle', current_step = 'Authorization denied. Job paused.', updated_at = NOW()
        WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) AND status LIKE 'waiting_for_%'
        RETURNING *`,
      [jobId, uid],
    );
    if (!rows.length) { res.status(404).json({ error: "Job not found or not awaiting authorization" }); return; }
    await pool.query(`UPDATE browser_operator_authorizations SET status = 'denied', denied_at = NOW() WHERE job_id = $1 AND status = 'requested'`, [jobId]);
    await appendAudit(jobId, "user_denied_authorization");
    res.json({ job: safeRow(rows[0] as Record<string, unknown>) });
  } catch (err) {
    logger.error({ err }, "Failed to deny browser operator authorization");
    res.status(500).json({ error: "Failed to deny authorization" });
  }
});

router.post("/browser-operator/jobs/:id/pause", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const jobId = String(req.params["id"] ?? "");
    const { rows } = await pool.query(
      `UPDATE browser_operator_jobs
          SET status = 'paused', credit_state = 'idle', current_step = 'Paused.', updated_at = NOW()
        WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) AND status IN ('running', 'resuming')
        RETURNING *`,
      [jobId, uid],
    );
    if (!rows.length) { res.status(404).json({ error: "Job not found or not pausable" }); return; }
    await appendAudit(jobId, "job_paused");
    res.json({ job: safeRow(rows[0] as Record<string, unknown>) });
  } catch (err) {
    logger.error({ err }, "Failed to pause browser operator job");
    res.status(500).json({ error: "Failed to pause job" });
  }
});

router.post("/browser-operator/jobs/:id/cancel", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const jobId = String(req.params["id"] ?? "");
    const { rows } = await pool.query(
      `UPDATE browser_operator_jobs
          SET status = 'cancelled', credit_state = 'stopped', current_step = 'Cancelled by user.', updated_at = NOW()
        WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) AND status NOT IN ('completed', 'failed', 'cancelled')
        RETURNING *`,
      [jobId, uid],
    );
    if (!rows.length) { res.status(404).json({ error: "Job not found or already closed" }); return; }
    await appendAudit(jobId, "job_cancelled");
    res.json({ job: safeRow(rows[0] as Record<string, unknown>) });
  } catch (err) {
    logger.error({ err }, "Failed to cancel browser operator job");
    res.status(500).json({ error: "Failed to cancel job" });
  }
});

router.post("/browser-operator/jobs/:id/complete", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const jobId = String(req.params["id"] ?? "");
    const body = req.body as Record<string, unknown>;
    const outputs = redactBrowserMetadata(typeof body.outputs === "object" && body.outputs !== null ? body.outputs as Record<string, unknown> : {});
    const { rows } = await pool.query(
      `UPDATE browser_operator_jobs
          SET status = 'completed', credit_state = 'stopped', outputs_json = $3::jsonb, waiting_for_type = NULL, waiting_for_reason = NULL, authorization_expires_at = NULL, updated_at = NOW()
        WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) AND status NOT IN ('completed', 'failed', 'cancelled')
        RETURNING *`,
      [jobId, uid, JSON.stringify(outputs)],
    );
    if (!rows.length) { res.status(404).json({ error: "Job not found or already completed" }); return; }
    await appendAudit(jobId, "job_completed");
    res.json({ job: safeRow(rows[0] as Record<string, unknown>), valuesReturned: false });
  } catch (err) {
    logger.error({ err }, "Failed to complete browser operator job");
    res.status(500).json({ error: "Failed to complete job" });
  }
});

router.get("/browser-operator/jobs/:id/audit", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const jobId = String(req.params["id"] ?? "");
    const { rows } = await pool.query(`SELECT audit_json FROM browser_operator_jobs WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) LIMIT 1`, [jobId, uid]);
    if (!rows.length) { res.status(404).json({ error: "Job not found" }); return; }
    res.json({ audit: rows[0].audit_json ?? [] });
  } catch (err) {
    logger.error({ err }, "Failed to get browser operator audit");
    res.status(500).json({ error: "Failed to get audit" });
  }
});

router.get("/browser-operator/jobs/:id/outputs", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const jobId = String(req.params["id"] ?? "");
    const { rows } = await pool.query(`SELECT outputs_json FROM browser_operator_jobs WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) LIMIT 1`, [jobId, uid]);
    if (!rows.length) { res.status(404).json({ error: "Job not found" }); return; }
    res.json({ outputs: redactBrowserMetadata((rows[0].outputs_json as Record<string, unknown>) ?? {}), valuesReturned: false });
  } catch (err) {
    logger.error({ err }, "Failed to get browser operator outputs");
    res.status(500).json({ error: "Failed to get outputs" });
  }
});

router.post("/browser-operator/jobs/expire-authorizations", async (_req, res): Promise<void> => {
  try {
    await ensureTable();
    const { rowCount } = await pool.query(
      `UPDATE browser_operator_jobs
          SET status = 'authorization_expired', credit_state = 'stopped', current_step = 'Authorization expired. User must restart authorization.', updated_at = NOW()
        WHERE status LIKE 'waiting_for_%' AND authorization_expires_at IS NOT NULL AND authorization_expires_at < NOW()`,
    );
    res.json({ expired: rowCount ?? 0 });
  } catch (err) {
    logger.error({ err }, "Failed to expire browser operator authorizations");
    res.status(500).json({ error: "Failed to expire authorizations" });
  }
});

router.get("/browser-operator/pause-policy", (_req, res): void => {
  res.json({
    validPauseReasons: ["oauth", "2fa", "passkey", "email_link", "captcha", "manual_approval", "payment_approval"],
    invalidPauseReasons: ["normal page load", "slow network", "missing selector", "retryable browser error", "ordinary dashboard search"],
    creditRule: "Credits pause only while waiting for user authorization. Browser work and retries keep consuming credits.",
    valuesReturned: false,
  });
});

export default router;
