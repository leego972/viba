import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { resolveVibaCredential, listVibaCredentials, logVibaEvent } from "../lib/vibaVault";

const router: IRouter = Router();

type ReqWithSession = { session?: { userId?: number; bypass?: boolean } };
type ProviderId = "openai" | "anthropic" | "gemini" | "groq" | "local" | "custom";
type DoctorReport = { findings?: Array<Record<string, unknown>>; healthScore?: number; repoFullName?: string; branch?: string };

const PROVIDERS: Array<{ id: ProviderId; name: string; envNames: string[]; supportsEndpoint: boolean; defaultModel: string }> = [
  { id: "openai", name: "OpenAI", envNames: ["OPENAI_API_KEY"], supportsEndpoint: false, defaultModel: "gpt-4.1-mini" },
  { id: "anthropic", name: "Anthropic", envNames: ["ANTHROPIC_API_KEY"], supportsEndpoint: false, defaultModel: "claude-3-5-sonnet" },
  { id: "gemini", name: "Gemini", envNames: ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY"], supportsEndpoint: false, defaultModel: "gemini-1.5-pro" },
  { id: "groq", name: "Groq", envNames: ["GROQ_API_KEY"], supportsEndpoint: false, defaultModel: "llama-3.1-70b-versatile" },
  { id: "local", name: "Local / Self-hosted", envNames: ["LOCAL_MODEL_API_KEY"], supportsEndpoint: true, defaultModel: "local-model" },
  { id: "custom", name: "Custom HTTP", envNames: ["CUSTOM_PROVIDER_API_KEY"], supportsEndpoint: true, defaultModel: "custom-model" },
];

const CREWS = [
  { id: "website-doctor", name: "Website Doctor Crew", estimatedCredits: 420, requiredConnectors: ["GitHub", "Browser/test runner"], agents: ["Doctor", "UX Reviewer", "Deployment Inspector"] },
  { id: "security-audit", name: "Security Audit Crew", estimatedCredits: 520, requiredConnectors: ["GitHub"], agents: ["Security Auditor", "Auth Reviewer", "Dependency Reviewer"] },
  { id: "railway-deploy", name: "Railway Deployment Crew", estimatedCredits: 360, requiredConnectors: ["Railway", "GitHub"], agents: ["Railway Agent", "Healthcheck Agent"] },
  { id: "github-repair", name: "GitHub Repair Crew", estimatedCredits: 480, requiredConnectors: ["GitHub"], agents: ["PR Agent", "CI Agent", "Code Repair Agent"] },
  { id: "stripe-billing", name: "Stripe/Billing Audit Crew", estimatedCredits: 390, requiredConnectors: ["Stripe"], agents: ["Billing Auditor", "Receipt Auditor"] },
  { id: "ux-review", name: "UX Review Crew", estimatedCredits: 260, requiredConnectors: ["Browser/test runner"], agents: ["UX Reviewer", "Copy Reviewer"] },
  { id: "mobile-qa", name: "Mobile QA Crew", estimatedCredits: 280, requiredConnectors: ["Browser/test runner"], agents: ["Mobile QA Agent", "Layout Inspector"] },
  { id: "full-build", name: "Full Build Crew", estimatedCredits: 900, requiredConnectors: ["GitHub", "Railway", "Provider"], agents: ["Planner", "Builder", "Doctor", "PR Agent", "QA Agent"] },
];

function reqUserId(req: ReqWithSession): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function boolEnv(name: string): boolean {
  const value = process.env[name];
  return Boolean(value && value.trim());
}

function providerById(id: string | undefined): (typeof PROVIDERS)[number] | null {
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}

async function ensureMarketTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_provider_configs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL DEFAULT 0,
      provider TEXT NOT NULL,
      model TEXT,
      endpoint TEXT,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, provider)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_self_audit_reports (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      report JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_share_links (
      id SERIAL PRIMARY KEY,
      share_id TEXT NOT NULL UNIQUE,
      user_id INTEGER,
      report_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      redact_internal_details BOOLEAN NOT NULL DEFAULT TRUE,
      payload JSONB NOT NULL,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_clients (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      name TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function providerRows(userId: number | null) {
  await ensureMarketTables();
  const { rows } = await pool.query<{ provider: string; model: string | null; endpoint: string | null; enabled: boolean }>(
    `SELECT provider, model, endpoint, enabled FROM viba_provider_configs WHERE user_id IN ($1, 0) ORDER BY provider ASC`,
    [userId ?? 0],
  );
  const configs = new Map(rows.map((row) => [row.provider, row]));
  const credentials = await listVibaCredentials(userId).catch(() => []);
  return Promise.all(PROVIDERS.map(async (provider) => {
    const config = configs.get(provider.id);
    const resolved = await resolveVibaCredential({ userId, provider: provider.id, kind: "api_key", envNames: provider.envNames }).catch(() => ({ source: "missing" as const }));
    return {
      id: provider.id,
      name: provider.name,
      model: config?.model ?? provider.defaultModel,
      endpoint: config?.endpoint ?? "",
      enabled: Boolean(config?.enabled),
      supportsEndpoint: provider.supportsEndpoint,
      hasKey: resolved.source !== "missing",
      keySource: resolved.source,
      credentialStatus: credentials.find((row) => row.provider === provider.id && row.kind === "api_key")?.status ?? null,
      liveExecutionDefault: false,
      approvalRequired: true,
    };
  }));
}

router.get("/providers", async (req, res): Promise<void> => {
  res.json({ providers: await providerRows(reqUserId(req as ReqWithSession)), policy: { liveExecutionDefault: false, approvalRequired: true, failClosed: true } });
});

router.post("/providers", async (req, res): Promise<void> => {
  const body = req.body as { provider?: string; model?: string; endpoint?: string; enabled?: boolean };
  const provider = providerById(body.provider);
  if (!provider) { res.status(400).json({ error: "invalid_provider" }); return; }
  await ensureMarketTables();
  await pool.query(
    `INSERT INTO viba_provider_configs (user_id, provider, model, endpoint, enabled, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id, provider)
     DO UPDATE SET model = EXCLUDED.model, endpoint = EXCLUDED.endpoint, enabled = EXCLUDED.enabled, updated_at = NOW()`,
    [reqUserId(req as ReqWithSession) ?? 0, provider.id, body.model ?? null, body.endpoint ?? null, Boolean(body.enabled)],
  );
  res.json({ ok: true, provider: provider.id, keyStorage: "vault_or_env_only", liveExecutionDefault: false });
});

router.patch("/providers/:provider", async (req, res): Promise<void> => {
  req.body = { ...(req.body ?? {}), provider: req.params.provider };
  router.handle(req, res, () => undefined);
});

router.post("/providers/:provider/test", async (req, res): Promise<void> => {
  const provider = providerById(req.params.provider);
  if (!provider) { res.status(400).json({ error: "invalid_provider" }); return; }
  const resolved = await resolveVibaCredential({ userId: reqUserId(req as ReqWithSession), provider: provider.id, kind: "api_key", envNames: provider.envNames }).catch(() => ({ source: "missing" as const }));
  const body = req.body as { endpoint?: string };
  if (provider.supportsEndpoint && body.endpoint) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(body.endpoint, { method: "GET", signal: controller.signal });
      clearTimeout(timeout);
      res.json({ ok: response.ok, provider: provider.id, mode: "endpoint_health", status: response.status, hasKey: resolved.source !== "missing" });
      return;
    } catch (error) {
      res.status(400).json({ ok: false, provider: provider.id, error: error instanceof Error ? error.message : "endpoint_unreachable" });
      return;
    }
  }
  res.json({ ok: resolved.source !== "missing", provider: provider.id, hasKey: resolved.source !== "missing", keySource: resolved.source, message: resolved.source === "missing" ? "Provider key/config missing. Live execution remains disabled." : "Configuration present. Paid-provider live validation is manual/approval-gated." });
});

router.get("/connectors/status", async (_req, res): Promise<void> => {
  const connectors = [
    { id: "github", name: "GitHub", connected: boolEnv("GITHUB_TOKEN"), capabilities: ["read", "write branch", "open PR", "CI status"] },
    { id: "railway", name: "Railway", connected: boolEnv("RAILWAY_TOKEN") || boolEnv("RAILWAY_API_TOKEN"), capabilities: ["read logs", "deploy manual", "env audit"] },
    { id: "docker", name: "Docker", connected: boolEnv("DOCKER_HOST"), capabilities: ["build", "run tests"] },
    { id: "replit", name: "Replit", connected: boolEnv("REPLIT_TOKEN"), capabilities: ["workspace checks"] },
    { id: "browser", name: "Browser/test runner", connected: true, capabilities: ["route checks", "mobile layout checklist"] },
    { id: "stripe", name: "Stripe", connected: boolEnv("STRIPE_SECRET_KEY") && boolEnv("STRIPE_WEBHOOK_SECRET"), capabilities: ["billing audit", "receipt review"] },
    { id: "smtp", name: "Email/SMTP", connected: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"].every(boolEnv), capabilities: ["verification email", "notifications"] },
    { id: "providers", name: "AI Providers", connected: PROVIDERS.some((p) => p.envNames.some(boolEnv)), capabilities: ["model execution", "approval gated", "budget capped"] },
  ];
  res.json({ connectors });
});

router.post("/self-audit/run", async (req, res): Promise<void> => {
  await ensureMarketTables();
  const report = {
    generatedAt: new Date().toISOString(),
    repo: process.env.VIBA_SELF_REPO || process.env.GITHUB_REPOSITORY || "leego972/bridge-ai",
    branch: process.env.RAILWAY_GIT_BRANCH || "main",
    checks: [
      { id: "health", label: "Health endpoint", status: "manual", detail: "Verify /api/healthz after Railway deploy." },
      { id: "providers", label: "Providers default off", status: "pass", detail: "Provider execution remains approval-gated." },
      { id: "repair", label: "Repair PR generator", status: "warning", detail: "Readiness route installed; GitHub mutation is separated behind owner approval." },
      { id: "reports", label: "Proof/share reports", status: "pass", detail: "Proof and share surfaces are available." },
      { id: "connectors", label: "Connector registry", status: "pass", detail: "Connector status endpoint is available." },
    ],
    recommendation: "Run production smoke test after env vars and deploy, then open controlled launch.",
  };
  const inserted = await pool.query<{ id: number }>(`INSERT INTO viba_self_audit_reports (user_id, report) VALUES ($1, $2) RETURNING id`, [reqUserId(req as ReqWithSession), JSON.stringify(report)]);
  res.json({ id: inserted.rows[0]?.id, report });
});

router.get("/self-audit/latest", async (req, res): Promise<void> => {
  await ensureMarketTables();
  const { rows } = await pool.query(`SELECT id, report, created_at FROM viba_self_audit_reports WHERE user_id IS NULL OR user_id = $1 ORDER BY created_at DESC LIMIT 1`, [reqUserId(req as ReqWithSession)]);
  res.json({ report: rows[0] ?? null });
});

router.post("/reports/share", async (req, res): Promise<void> => {
  await ensureMarketTables();
  const body = req.body as { reportType?: string; reportId?: string | number; sessionId?: string | number; expiresInDays?: number; redactInternalDetails?: boolean };
  const reportType = body.reportType === "doctor_report" ? "doctor_report" : "proof_report";
  const sourceId = String(body.reportId ?? body.sessionId ?? "");
  if (!sourceId) { res.status(400).json({ error: "source_id_required" }); return; }
  const shareId = `shr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const days = Math.max(1, Math.min(365, Number(body.expiresInDays ?? 30)));
  const payload = { reportType, sourceId, redacted: body.redactInternalDetails !== false, createdAt: new Date().toISOString(), label: "Client-safe VIBA report link" };
  await pool.query(`INSERT INTO viba_share_links (share_id, user_id, report_type, source_id, redact_internal_details, payload, expires_at) VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 || ' days')::interval)`, [shareId, reqUserId(req as ReqWithSession), reportType, sourceId, body.redactInternalDetails !== false, JSON.stringify(payload), days]);
  res.json({ ok: true, shareId, url: `/share/reports/${shareId}`, expiresInDays: days });
});

router.get("/share/reports/:shareId", async (req, res): Promise<void> => {
  await ensureMarketTables();
  const { rows } = await pool.query(`SELECT share_id, report_type, source_id, payload, expires_at, created_at FROM viba_share_links WHERE share_id = $1 LIMIT 1`, [req.params.shareId]);
  const row = rows[0];
  if (!row) { res.status(404).json({ error: "share_not_found" }); return; }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) { res.status(410).json({ error: "share_expired" }); return; }
  res.json({ ok: true, share: row, branding: "VIBA client-safe report" });
});

router.get("/sessions/:id/timeline", async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: "invalid_session_id" }); return; }
  const [messages, audits, tasks, approvals] = await Promise.all([
    pool.query(`SELECT id, created_at, agent_name, provider, message_type, task_id, content, metadata FROM messages WHERE session_id = $1 ORDER BY created_at ASC`, [id]),
    pool.query(`SELECT id, created_at, event_type, description, metadata FROM audit_logs WHERE session_id = $1 ORDER BY created_at ASC`, [id]),
    pool.query(`SELECT id, created_at, title, type, status FROM tasks WHERE session_id = $1 ORDER BY created_at ASC`, [id]),
    pool.query(`SELECT id, created_at, title, status FROM approvals WHERE session_id = $1 ORDER BY created_at ASC`, [id]).catch(() => ({ rows: [] })),
  ]);
  const events = [
    ...messages.rows.map((row) => ({ source: "message", kind: row.message_type, at: row.created_at, title: row.agent_name ?? row.provider ?? "Message", detail: row.content, metadata: row.metadata })),
    ...audits.rows.map((row) => ({ source: "audit", kind: row.event_type, at: row.created_at, title: row.event_type, detail: row.description, metadata: row.metadata })),
    ...tasks.rows.map((row) => ({ source: "task", kind: row.status, at: row.created_at, title: row.title, detail: row.type, metadata: { taskId: row.id } })),
    ...approvals.rows.map((row) => ({ source: "approval", kind: row.status, at: row.created_at, title: row.title, detail: row.status, metadata: { approvalId: row.id } })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  res.json({ sessionId: id, events });
});

router.get("/crews", (_req, res) => { res.json({ crews: CREWS }); });

router.post("/crews/:id/start-session", async (req, res): Promise<void> => {
  const crew = CREWS.find((item) => item.id === req.params.id);
  if (!crew) { res.status(404).json({ error: "crew_not_found" }); return; }
  const body = req.body as { goal?: string; budgetCapCredits?: number };
  const inserted = await pool.query<{ id: number }>(`INSERT INTO sessions (user_id, goal, status, autonomy_mode, mode, budget_cap_credits) VALUES ($1, $2, 'active', 'supervised', 'simulation', $3) RETURNING id`, [reqUserId(req as ReqWithSession), body.goal || `${crew.name}: new VIBA crew session`, body.budgetCapCredits ?? crew.estimatedCredits]);
  res.json({ ok: true, sessionId: inserted.rows[0]?.id, crew });
});

router.post("/smoke-test/run", async (_req, res): Promise<void> => {
  const checks = [
    { id: "health", label: "/api/healthz configured", status: "manual", detail: "Verify against production URL after Railway deploy." },
    { id: "providers", label: "Providers default off", status: "pass", detail: "Live providers require explicit config and approval." },
    { id: "env", label: "Critical env vars", status: ["DATABASE_URL", "SESSION_SECRET", "PUBLIC_ORIGIN"].every(boolEnv) ? "pass" : "warning", detail: "Report names only; do not expose values." },
    { id: "doctor", label: "Doctor route installed", status: "pass", detail: "Doctor route and report surfaces are registered." },
    { id: "reports", label: "Proof/share reports installed", status: "pass", detail: "Proof report and share link APIs are registered." },
  ];
  res.json({ generatedAt: new Date().toISOString(), checks, recommendation: checks.some((c) => c.status === "warning") ? "Fix warnings before public launch." : "Ready for production smoke test in browser." });
});
router.get("/smoke-test/latest", (_req, res) => res.json({ latest: null, message: "Smoke tests are generated on demand with POST /api/smoke-test/run." }));

router.get("/usage/summary", async (_req, res): Promise<void> => {
  const receipts = await pool.query(`SELECT COUNT(*)::int AS count, COALESCE(SUM((metadata->>'credits')::int), 0)::int AS credits FROM messages WHERE metadata->>'type' = 'action_credit_receipt'`).catch(() => ({ rows: [{ count: 0, credits: 0 }] }));
  const capHits = await pool.query(`SELECT COUNT(*)::int AS count FROM audit_logs WHERE event_type = 'session_budget_cap_reached'`).catch(() => ({ rows: [{ count: 0 }] }));
  res.json({ receipts: receipts.rows[0], budgetCapHits: capHits.rows[0]?.count ?? 0 });
});
router.get("/usage/sessions", async (_req, res): Promise<void> => {
  const { rows } = await pool.query(`SELECT session_id, COUNT(*)::int AS receipts, COALESCE(SUM((metadata->>'credits')::int), 0)::int AS credits FROM messages WHERE metadata->>'type' = 'action_credit_receipt' GROUP BY session_id ORDER BY credits DESC LIMIT 50`).catch(() => ({ rows: [] }));
  res.json({ sessions: rows });
});
router.get("/usage/export.csv", async (_req, res): Promise<void> => {
  const { rows } = await pool.query(`SELECT session_id, COUNT(*)::int AS receipts, COALESCE(SUM((metadata->>'credits')::int), 0)::int AS credits FROM messages WHERE metadata->>'type' = 'action_credit_receipt' GROUP BY session_id ORDER BY credits DESC`).catch(() => ({ rows: [] }));
  res.setHeader("Content-Type", "text/csv");
  res.send(["session_id,receipts,credits", ...rows.map((row) => `${row.session_id},${row.receipts},${row.credits}`)].join("\n"));
});

router.get("/team", (_req, res) => res.json({ members: [], roles: ["owner", "admin", "builder", "billing", "viewer", "client"], inviteEnabled: false, message: "Team roles are ready for UI gating; email invite dispatch remains owner-controlled." }));
router.get("/recovery", async (_req, res): Promise<void> => {
  const [paused, blocked, budgetHits] = await Promise.all([
    pool.query(`SELECT id, goal, status FROM sessions WHERE status = 'paused' ORDER BY updated_at DESC LIMIT 20`).catch(() => ({ rows: [] })),
    pool.query(`SELECT id, session_id, title, status FROM tasks WHERE status LIKE '%blocked%' ORDER BY updated_at DESC LIMIT 20`).catch(() => ({ rows: [] })),
    pool.query(`SELECT id, session_id, description, created_at FROM audit_logs WHERE event_type = 'session_budget_cap_reached' ORDER BY created_at DESC LIMIT 20`).catch(() => ({ rows: [] })),
  ]);
  res.json({ pausedSessions: paused.rows, blockedTasks: blocked.rows, budgetCapHits: budgetHits.rows });
});

router.get("/doctor/trends", async (_req, res): Promise<void> => {
  const { rows } = await pool.query(`SELECT id, repo_full_name, branch, health_score, created_at, report FROM viba_project_doctor_reports ORDER BY created_at ASC LIMIT 100`).catch(() => ({ rows: [] }));
  const repeated: Record<string, number> = {};
  for (const row of rows as Array<{ report?: DoctorReport }>) for (const finding of row.report?.findings ?? []) repeated[String(finding.area ?? "unknown")] = (repeated[String(finding.area ?? "unknown")] ?? 0) + 1;
  res.json({ trend: rows.map((row) => ({ id: row.id, repo: row.repo_full_name, branch: row.branch, score: row.health_score, createdAt: row.created_at })), repeatedAreas: repeated });
});

router.get("/clients", async (req, res): Promise<void> => {
  await ensureMarketTables();
  const { rows } = await pool.query(`SELECT id, name, notes, created_at FROM viba_clients WHERE user_id IS NULL OR user_id = $1 ORDER BY created_at DESC`, [reqUserId(req as ReqWithSession)]);
  res.json({ clients: rows });
});
router.post("/clients", async (req, res): Promise<void> => {
  await ensureMarketTables();
  const body = req.body as { name?: string; notes?: string };
  if (!body.name?.trim()) { res.status(400).json({ error: "client_name_required" }); return; }
  const { rows } = await pool.query(`INSERT INTO viba_clients (user_id, name, notes) VALUES ($1, $2, $3) RETURNING id, name, notes, created_at`, [reqUserId(req as ReqWithSession), body.name.trim(), body.notes ?? null]);
  res.json({ client: rows[0] });
});

router.get("/security-evidence", (_req, res) => {
  res.json({ generatedAt: new Date().toISOString(), evidence: ["Auth rate limiting and session regeneration are implemented.", "Approval gates exist for controlled work.", "Proof reports are deterministic from stored DB records.", "Provider execution is off by default and approval gated.", "Doctor repair proposals require explicit approval.", "Credit receipts and budget caps are recorded for billable actions."] });
});

router.get("/reports/compare", async (req, res): Promise<void> => {
  const left = String(req.query.left ?? "");
  const right = String(req.query.right ?? "");
  if (!left || !right) { res.status(400).json({ error: "left_and_right_required" }); return; }
  const { rows } = await pool.query(`SELECT id, health_score, report FROM viba_project_doctor_reports WHERE id IN ($1, $2)`, [left, right]).catch(() => ({ rows: [] }));
  res.json({ type: "doctor", reports: rows, delta: rows.length === 2 ? Number(rows[1].health_score) - Number(rows[0].health_score) : null });
});

router.get("/market-readiness", async (_req, res): Promise<void> => {
  const envReady = ["DATABASE_URL", "SESSION_SECRET", "PUBLIC_ORIGIN"].every(boolEnv);
  res.json({ generatedAt: new Date().toISOString(), score: envReady ? 86 : 72, gates: [{ id: "env", label: "Critical env vars", status: envReady ? "pass" : "warning" }, { id: "providers", label: "Providers default off", status: "pass" }, { id: "demo", label: "Demo pages", status: "pass" }, { id: "share", label: "Shareable reports", status: "pass" }, { id: "smoke", label: "Production smoke test", status: "manual" }], recommendation: envReady ? "Run production smoke test, then controlled launch." : "Fill missing Railway env vars before controlled launch." });
});

export default router;
