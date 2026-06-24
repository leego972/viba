import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Types ──────────────────────────────────────────────────────────────────────

export type JobStatus =
  | "created"
  | "running"
  | "paused"
  | "waiting_for_user_authorization"
  | "completed"
  | "failed";

export type CreditState =
  | "idle"
  | "consuming"
  | "paused_waiting_for_user"
  | "completed";

export type WaitingForType = "oauth" | "2fa" | "passkey" | "email_link" | "manual" | null;

export interface BrowserOperatorJob {
  id: string;
  user_id: number | null;
  template_id: string | null;
  provider: string;
  target_url: string;
  status: JobStatus;
  credit_state: CreditState;
  current_step: string | null;
  waiting_for_type: WaitingForType;
  waiting_for_reason: string | null;
  outputs_json: Record<string, unknown>;
  audit_json: Array<{ ts: string; event: string; detail?: string }>;
  created_at: string;
  updated_at: string;
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

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
      waiting_for_type TEXT,
      waiting_for_reason TEXT,
      outputs_json JSONB NOT NULL DEFAULT '{}',
      audit_json JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_browser_operator_jobs_user ON browser_operator_jobs (user_id, status, created_at DESC)`);
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
    waiting_for_type: (row.waiting_for_type as WaitingForType) ?? null,
    waiting_for_reason: row.waiting_for_reason != null ? String(row.waiting_for_reason) : null,
    outputs_json: (row.outputs_json as Record<string, unknown>) ?? {},
    audit_json: (row.audit_json as Array<{ ts: string; event: string; detail?: string }>) ?? [],
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

async function appendAudit(
  id: string,
  event: string,
  detail?: string,
): Promise<void> {
  const entry = JSON.stringify({ ts: new Date().toISOString(), event, ...(detail ? { detail } : {}) });
  await pool.query(
    `UPDATE browser_operator_jobs
        SET audit_json = audit_json || $1::jsonb,
            updated_at = NOW()
      WHERE id = $2`,
    [`[${entry}]`, id],
  );
}

// ── Templates ──────────────────────────────────────────────────────────────────

const TEMPLATES = [
  {
    id: "railway-env-vars",
    label: "Railway — Set Environment Variables",
    provider: "railway",
    target_url: "https://railway.app",
    description: "Assisted login and variable management on Railway dashboard.",
    steps: ["Open Railway", "Log in (OAuth / 2FA if required)", "Navigate to project variables", "Apply changes"],
  },
  {
    id: "stripe-webhook",
    label: "Stripe — Configure Webhook",
    provider: "stripe",
    target_url: "https://dashboard.stripe.com",
    description: "Assisted login and webhook endpoint setup on Stripe.",
    steps: ["Open Stripe dashboard", "Log in (2FA if required)", "Navigate to Developers → Webhooks", "Add endpoint"],
  },
  {
    id: "godaddy-dns",
    label: "GoDaddy — Update DNS Records",
    provider: "godaddy",
    target_url: "https://dcc.godaddy.com",
    description: "Assisted login and DNS record management for viba.guru.",
    steps: ["Open GoDaddy Domain Control Center", "Log in", "Select domain", "Edit DNS records"],
  },
  {
    id: "github-secrets",
    label: "GitHub — Add Repository Secrets",
    provider: "github",
    target_url: "https://github.com",
    description: "Assisted login and GitHub Actions secrets management.",
    steps: ["Open GitHub", "Log in (2FA if required)", "Navigate to repo Settings → Secrets", "Add secrets"],
  },
  {
    id: "smtp-verify",
    label: "SMTP — Verify Email Provider",
    provider: "smtp",
    target_url: "https://app.mailgun.com",
    description: "Assisted login and SMTP credential verification.",
    steps: ["Open email provider dashboard", "Log in", "Locate SMTP credentials", "Copy to VIBA settings"],
  },
];

// ── Helper ─────────────────────────────────────────────────────────────────────

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET /api/browser-operator/templates
router.get("/browser-operator/templates", (_req, res): void => {
  res.json({ templates: TEMPLATES });
});

// POST /api/browser-operator/jobs
router.post("/browser-operator/jobs", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const body = req.body as Record<string, unknown>;
    const templateId = typeof body.template_id === "string" ? body.template_id : null;
    const template = templateId ? TEMPLATES.find((t) => t.id === templateId) : null;
    const provider = typeof body.provider === "string" ? body.provider : (template?.provider ?? "custom");
    const targetUrl = typeof body.target_url === "string" ? body.target_url : (template?.target_url ?? "");

    if (!targetUrl) {
      res.status(400).json({ error: "target_url is required" });
      return;
    }

    const { rows } = await pool.query(
      `INSERT INTO browser_operator_jobs (user_id, template_id, provider, target_url, status, credit_state, audit_json)
       VALUES ($1, $2, $3, $4, 'created', 'idle', $5::jsonb)
       RETURNING *`,
      [uid, templateId, provider, targetUrl, JSON.stringify([{ ts: new Date().toISOString(), event: "job_created" }])],
    );
    const job = safeRow(rows[0] as Record<string, unknown>);
    logger.info({ jobId: job.id, provider, templateId }, "Browser operator job created");
    res.status(201).json({ job });
  } catch (err) {
    logger.error({ err }, "Failed to create browser operator job");
    res.status(500).json({ error: "Failed to create job" });
  }
});

// GET /api/browser-operator/jobs/:id
router.get("/browser-operator/jobs/:id", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const jobId = String(req.params["id"] ?? "");
    const { rows } = await pool.query(
      `SELECT * FROM browser_operator_jobs WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) LIMIT 1`,
      [jobId, uid],
    );
    if (!rows.length) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json({ job: safeRow(rows[0] as Record<string, unknown>) });
  } catch (err) {
    logger.error({ err }, "Failed to get browser operator job");
    res.status(500).json({ error: "Failed to get job" });
  }
});

// POST /api/browser-operator/jobs/:id/start
router.post("/browser-operator/jobs/:id/start", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const jobId = String(req.params["id"] ?? "");
    const { rows } = await pool.query(
      `UPDATE browser_operator_jobs
          SET status = 'running', credit_state = 'consuming', current_step = COALESCE(current_step, 'Opening browser'), updated_at = NOW()
        WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) AND status IN ('created', 'paused')
        RETURNING *`,
      [jobId, uid],
    );
    if (!rows.length) {
      res.status(404).json({ error: "Job not found or not startable" });
      return;
    }
    await appendAudit(jobId, "job_started");
    logger.info({ jobId }, "Browser operator job started");
    res.json({ job: safeRow(rows[0] as Record<string, unknown>) });
  } catch (err) {
    logger.error({ err }, "Failed to start browser operator job");
    res.status(500).json({ error: "Failed to start job" });
  }
});

// POST /api/browser-operator/jobs/:id/waiting-for-user
router.post("/browser-operator/jobs/:id/waiting-for-user", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const jobId = String(req.params["id"] ?? "");
    const body = req.body as Record<string, unknown>;
    const waitType = (body.waiting_for_type as WaitingForType) ?? "manual";
    const reason = typeof body.reason === "string" ? body.reason : "User authorization required";

    const { rows } = await pool.query(
      `UPDATE browser_operator_jobs
          SET status = 'waiting_for_user_authorization',
              credit_state = 'paused_waiting_for_user',
              waiting_for_type = $3,
              waiting_for_reason = $4,
              updated_at = NOW()
        WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) AND status = 'running'
        RETURNING *`,
      [jobId, uid, waitType, reason],
    );
    if (!rows.length) {
      res.status(404).json({ error: "Job not found or not in running state" });
      return;
    }
    await appendAudit(jobId, "waiting_for_user", `type=${waitType} reason=${reason}`);
    logger.info({ jobId, waitType }, "Browser operator job waiting for user");
    res.json({ job: safeRow(rows[0] as Record<string, unknown>) });
  } catch (err) {
    logger.error({ err }, "Failed to set waiting-for-user on job");
    res.status(500).json({ error: "Failed to update job" });
  }
});

// POST /api/browser-operator/jobs/:id/authorize
router.post("/browser-operator/jobs/:id/authorize", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const jobId = String(req.params["id"] ?? "");
    const body = req.body as Record<string, unknown>;
    const nextStep = typeof body.next_step === "string" ? body.next_step : null;

    const { rows } = await pool.query(
      `UPDATE browser_operator_jobs
          SET status = 'running',
              credit_state = 'consuming',
              waiting_for_type = NULL,
              waiting_for_reason = NULL,
              current_step = COALESCE($3, current_step),
              updated_at = NOW()
        WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) AND status = 'waiting_for_user_authorization'
        RETURNING *`,
      [jobId, uid, nextStep],
    );
    if (!rows.length) {
      res.status(404).json({ error: "Job not found or not awaiting authorization" });
      return;
    }
    await appendAudit(jobId, "user_authorized");
    logger.info({ jobId }, "Browser operator job authorized by user");
    res.json({ job: safeRow(rows[0] as Record<string, unknown>) });
  } catch (err) {
    logger.error({ err }, "Failed to authorize browser operator job");
    res.status(500).json({ error: "Failed to authorize job" });
  }
});

// POST /api/browser-operator/jobs/:id/pause
router.post("/browser-operator/jobs/:id/pause", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const jobId = String(req.params["id"] ?? "");

    const { rows } = await pool.query(
      `UPDATE browser_operator_jobs
          SET status = 'paused', credit_state = 'idle', updated_at = NOW()
        WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) AND status IN ('running', 'waiting_for_user_authorization')
        RETURNING *`,
      [jobId, uid],
    );
    if (!rows.length) {
      res.status(404).json({ error: "Job not found or not pausable" });
      return;
    }
    await appendAudit(jobId, "job_paused");
    logger.info({ jobId }, "Browser operator job paused");
    res.json({ job: safeRow(rows[0] as Record<string, unknown>) });
  } catch (err) {
    logger.error({ err }, "Failed to pause browser operator job");
    res.status(500).json({ error: "Failed to pause job" });
  }
});

// POST /api/browser-operator/jobs/:id/complete
router.post("/browser-operator/jobs/:id/complete", async (req, res): Promise<void> => {
  try {
    await ensureTable();
    const uid = userId(req);
    const jobId = String(req.params["id"] ?? "");
    const body = req.body as Record<string, unknown>;
    const outputs = typeof body.outputs === "object" && body.outputs !== null ? body.outputs : {};

    const { rows } = await pool.query(
      `UPDATE browser_operator_jobs
          SET status = 'completed',
              credit_state = 'completed',
              outputs_json = $3::jsonb,
              waiting_for_type = NULL,
              waiting_for_reason = NULL,
              updated_at = NOW()
        WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) AND status IN ('running', 'paused', 'waiting_for_user_authorization')
        RETURNING *`,
      [jobId, uid, JSON.stringify(outputs)],
    );
    if (!rows.length) {
      res.status(404).json({ error: "Job not found or already completed" });
      return;
    }
    await appendAudit(jobId, "job_completed");
    logger.info({ jobId }, "Browser operator job completed");
    res.json({ job: safeRow(rows[0] as Record<string, unknown>) });
  } catch (err) {
    logger.error({ err }, "Failed to complete browser operator job");
    res.status(500).json({ error: "Failed to complete job" });
  }
});

export default router;
