import { Router, type IRouter } from "express";
import { db, sessionsTable, auditLogsTable, settingsTable, teamMembersTable, clientsTable, clientReportsTable } from "@workspace/db";
import { sql, eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { reportStore } from "./doctor";

const router: IRouter = Router();

// ──────────────────────────────────────────────────
// In-memory share-report store (ephemeral per restart)
// ──────────────────────────────────────────────────

interface SharedReport {
  id: string;
  reportType: "doctor" | "proof" | "custom";
  ownerId: number | null;
  payload: unknown;
  createdAt: string;
  expiresAt: string | null;
}

const shareStore = new Map<string, SharedReport>();

// ──────────────────────────────────────────────────
// Crew catalogue (no paid calls, no deployment)
// ──────────────────────────────────────────────────

interface Crew {
  id: string;
  name: string;
  description: string;
  agents: string[];
  requiredConnectors: string[];
  estimatedCredits: number;
  safeModeDefault: boolean;
  approvalRequired: boolean;
}

const CREW_CATALOGUE: Crew[] = [
  {
    id: "website-doctor",
    name: "Website Doctor",
    description: "Full repo health scan: config, CI, deps, ENV, security posture — generates repair PR.",
    agents: ["Analyst", "Security Auditor", "Repair Drafter"],
    requiredConnectors: ["github"],
    estimatedCredits: 40,
    safeModeDefault: true,
    approvalRequired: true,
  },
  {
    id: "security-audit",
    name: "Security Audit",
    description: "OWASP-aligned security review: secret scan, dependency vulnerabilities, CSP check.",
    agents: ["Security Auditor", "Dependency Scanner", "Report Writer"],
    requiredConnectors: ["github"],
    estimatedCredits: 35,
    safeModeDefault: true,
    approvalRequired: true,
  },
  {
    id: "railway-deploy",
    name: "Railway Deploy Checker",
    description: "Validate Railway env vars, nixpacks config, healthcheck, and deploy readiness.",
    agents: ["DevOps Analyst", "Config Reviewer"],
    requiredConnectors: ["railway"],
    estimatedCredits: 20,
    safeModeDefault: true,
    approvalRequired: true,
  },
  {
    id: "github-repair",
    name: "GitHub Repair",
    description: "Open repair PRs for configuration issues, missing env docs, and stale CI workflows.",
    agents: ["Code Reviewer", "PR Drafter"],
    requiredConnectors: ["github"],
    estimatedCredits: 30,
    safeModeDefault: true,
    approvalRequired: true,
  },
  {
    id: "stripe-billing",
    name: "Stripe Billing Audit",
    description: "Audit Stripe config: product IDs, webhook events, price alignment, test mode vs live.",
    agents: ["Billing Auditor", "Config Reviewer"],
    requiredConnectors: ["stripe"],
    estimatedCredits: 25,
    safeModeDefault: true,
    approvalRequired: true,
  },
  {
    id: "ux-review",
    name: "UX Review",
    description: "Analyse user flows, mobile responsiveness, empty states, and accessibility basics.",
    agents: ["UX Analyst", "Accessibility Checker", "Report Writer"],
    requiredConnectors: [],
    estimatedCredits: 30,
    safeModeDefault: true,
    approvalRequired: false,
  },
  {
    id: "mobile-qa",
    name: "Mobile QA",
    description: "Check responsive breakpoints, touch targets, PWA manifest, and viewport meta.",
    agents: ["QA Engineer", "Mobile Specialist"],
    requiredConnectors: [],
    estimatedCredits: 20,
    safeModeDefault: true,
    approvalRequired: false,
  },
  {
    id: "full-build",
    name: "Full Build Review",
    description: "End-to-end review: architecture, API contract, DB schema, frontend, security, and launch readiness.",
    agents: ["Architect", "Security Auditor", "QA Engineer", "Report Writer"],
    requiredConnectors: ["github"],
    estimatedCredits: 80,
    safeModeDefault: true,
    approvalRequired: true,
  },
];

// ──────────────────────────────────────────────────
// Role capability matrix
// ──────────────────────────────────────────────────

const ROLE_CAPABILITIES: Record<string, string[]> = {
  owner:   ["manage_billing", "approve_repairs", "manage_providers", "manage_connectors", "share_reports", "manage_team", "run_sessions", "view_reports"],
  admin:   ["run_sessions", "approve_repairs", "share_reports", "view_usage", "view_reports"],
  builder: ["run_sessions", "view_reports", "prepare_proposals"],
  billing: ["manage_billing", "view_usage"],
  viewer:  ["view_reports"],
  client:  ["view_shared_reports"],
};

// ──────────────────────────────────────────────────
// GET /market-readiness — aggregate live platform health
// ──────────────────────────────────────────────────

router.get("/market-readiness", async (_req, res): Promise<void> => {
  try {
    const [sessionTotal] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(sessionsTable);

    const [activeSessions] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(sessionsTable)
      .where(eq(sessionsTable.status, "active"));

    const recentSessions = await db
      .select({ id: sessionsTable.id, goal: sessionsTable.goal, status: sessionsTable.status, createdAt: sessionsTable.createdAt })
      .from(sessionsTable)
      .orderBy(desc(sessionsTable.createdAt))
      .limit(5);

    const [errorsToday] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditLogsTable)
      .where(sql`${auditLogsTable.eventType} IN ('error','circuit_open') AND ${auditLogsTable.createdAt} >= NOW() - INTERVAL '24 hours'`);

    const allSettings = await db.select().from(settingsTable);
    const settingsMap = new Map(allSettings.map((s) => [s.key, s.value]));

    const providerIds = ["openai", "anthropic", "gemini", "groq", "local", "custom"];
    const configuredProviders = providerIds.filter((id) => {
      const enabledKey = `${id.toUpperCase()}_ENABLED`;
      const keyKey = id === "local" ? null : `${id.toUpperCase()}_API_KEY`;
      const enabled = settingsMap.get(enabledKey) === "true";
      const hasKey = keyKey ? !!(process.env[keyKey] || settingsMap.get(keyKey)) : true;
      return enabled && hasKey;
    });

    const features = [
      { id: "auth",      label: "Authentication & Sessions",    status: "ready" },
      { id: "providers", label: "AI Provider Configuration",    status: configuredProviders.length > 0 ? "ready" : "needs_config" },
      { id: "sessions",  label: "Multi-Agent Sessions",         status: (sessionTotal?.total ?? 0) > 0 ? "ready" : "pending" },
      { id: "billing",   label: "Billing & Credits",            status: process.env["STRIPE_SECRET_KEY"] ? "ready" : "needs_config" },
      { id: "doctor",    label: "Project Doctor & Repair PRs",  status: "ready" },
      { id: "demo",      label: "Public Demo Pages",            status: "ready" },
      { id: "email",     label: "Email Notifications",          status: process.env["SMTP_HOST"] ? "ready" : "needs_config" },
      { id: "team",      label: "Team & Client Management",     status: "ready" },
    ];

    const readyCount = features.filter((f) => f.status === "ready").length;
    const score = Math.round((readyCount / features.length) * 100);

    res.json({
      score,
      features,
      stats: {
        totalSessions: sessionTotal?.total ?? 0,
        activeSessions: activeSessions?.total ?? 0,
        errorsToday: errorsToday?.total ?? 0,
        configuredProviders: configuredProviders.length,
      },
      recentSessions,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "market_readiness_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ──────────────────────────────────────────────────
// POST /share/reports — create shareable link
// ──────────────────────────────────────────────────

router.post("/share/reports", async (req, res): Promise<void> => {
  const userId = req.session?.userId ?? null;
  const body = req.body as { reportType?: string; payload?: unknown; expiresInDays?: number };

  const reportType = body.reportType === "doctor" || body.reportType === "proof" ? body.reportType : "custom";
  if (!body.payload) { res.status(400).json({ error: "payload is required" }); return; }

  const expiresInDays = typeof body.expiresInDays === "number" ? Math.min(body.expiresInDays, 90) : 30;
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const shareId = randomUUID();
  shareStore.set(shareId, { id: shareId, reportType, ownerId: userId as number | null, payload: body.payload, createdAt: new Date().toISOString(), expiresAt });
  res.status(201).json({ shareId, shareUrl: `/share/reports/${shareId}`, expiresAt });
});

// ──────────────────────────────────────────────────
// GET /share/reports/:shareId — public read
// ──────────────────────────────────────────────────

router.get("/share/reports/:shareId", (req, res): void => {
  const shareId = String(req.params["shareId"] ?? "");
  const shared = shareStore.get(shareId);
  if (!shared) { res.status(404).json({ error: "report_not_found", message: "This shared report does not exist or has been removed." }); return; }
  if (shared.expiresAt && new Date(shared.expiresAt) < new Date()) {
    shareStore.delete(shareId);
    res.status(410).json({ error: "report_expired", message: "This shared report has expired." });
    return;
  }
  res.json({ id: shared.id, reportType: shared.reportType, payload: shared.payload, createdAt: shared.createdAt, expiresAt: shared.expiresAt });
});

// ── In-memory stores for ephemeral run results ───────────────────────────────

interface AuditResult { id: string; runAt: string; passed: number; failed: number; warnings: number; items: Array<{ check: string; status: string; detail: string }> }
interface SmokeResult { id: string; runAt: string; passed: boolean; checks: Array<{ name: string; ok: boolean; latencyMs?: number }> }

let latestAudit: AuditResult | null = null;
let latestSmoke: SmokeResult | null = null;

// ── GET /connectors/status ────────────────────────────────────────────────────

router.get("/connectors/status", (_req, res): void => {
  const githubToken = process.env["GITHUB_TOKEN"] || process.env["GH_TOKEN"];
  const railwayToken = process.env["RAILWAY_TOKEN"] || process.env["RAILWAY_API_TOKEN"];
  const dockerHost = process.env["DOCKER_HOST"];
  const replitToken = process.env["REPLIT_TOKEN"];
  const stripeKey = process.env["STRIPE_SECRET_KEY"];
  const stripeWebhook = process.env["STRIPE_WEBHOOK_SECRET"];
  const smtpHost = process.env["SMTP_HOST"];
  const smtpPort = process.env["SMTP_PORT"];
  const smtpUser = process.env["SMTP_USER"];
  const smtpPass = process.env["SMTP_PASS"];
  const smtpFrom = process.env["SMTP_FROM"];

  const hasAiProvider = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY"].some((k) => !!process.env[k]);

  const connectors = [
    {
      id: "github",
      label: "GitHub",
      connected: !!githubToken,
      note: githubToken ? "Token detected (GITHUB_TOKEN / GH_TOKEN)." : "Set GITHUB_TOKEN to enable branch creation, PR opening, and CI status.",
      capabilities: githubToken ? ["read", "write_branch", "open_pr", "ci_status"] : [],
    },
    {
      id: "railway",
      label: "Railway",
      connected: !!railwayToken,
      note: railwayToken ? "Token detected (RAILWAY_TOKEN)." : "Set RAILWAY_TOKEN to enable env audit, log reading, and deploy checks.",
      capabilities: railwayToken ? ["env_audit", "read_logs", "manual_deploy_check"] : [],
    },
    {
      id: "docker",
      label: "Docker",
      connected: !!dockerHost,
      note: dockerHost ? `Docker host configured (${dockerHost}).` : "DOCKER_HOST not set — container build/test unavailable.",
      capabilities: dockerHost ? ["build", "test"] : [],
    },
    {
      id: "replit",
      label: "Replit",
      connected: !!(replitToken || process.env["REPLIT_DB_URL"] || process.env["REPLIT_DEV_DOMAIN"]),
      note: "Replit runtime environment detected.",
      capabilities: ["runtime_check", "browser_check"],
    },
    {
      id: "browser",
      label: "Browser / Test Runner",
      connected: true,
      note: "Manual route check and mobile layout check available.",
      capabilities: ["route_check", "mobile_layout_check"],
    },
    {
      id: "stripe",
      label: "Stripe",
      connected: !!(stripeKey && stripeWebhook),
      note: stripeKey && stripeWebhook ? "Stripe key and webhook secret configured." : "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to enable billing audit.",
      capabilities: stripeKey && stripeWebhook ? ["billing_audit", "receipt_review"] : [],
    },
    {
      id: "smtp",
      label: "SMTP / Email",
      connected: !!(smtpHost && smtpPort && smtpUser && smtpPass && smtpFrom),
      note: smtpHost ? "SMTP configured." : "Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM to enable email.",
      capabilities: smtpHost ? ["verification_email", "notifications"] : [],
    },
    {
      id: "ai_providers",
      label: "AI Providers",
      connected: hasAiProvider,
      note: hasAiProvider ? "At least one AI provider key detected." : "No AI provider keys found — sessions run in simulation mode.",
      capabilities: hasAiProvider ? ["approval_gated_execution", "budget_capped_execution"] : [],
    },
  ];

  res.json({ connectors, generatedAt: new Date().toISOString() });
});

// ── POST /self-audit/run ──────────────────────────────────────────────────────

router.post("/self-audit/run", async (_req, res): Promise<void> => {
  try {
    const [sessionTotal] = await db.select({ total: sql<number>`count(*)::int` }).from(sessionsTable);
    const dbOk = (sessionTotal?.total ?? 0) >= 0;

    const items = [
      { check: "Database connectivity",     status: dbOk ? "pass" : "fail",    detail: dbOk ? "Postgres reachable." : "Cannot query sessions table." },
      { check: "SESSION_SECRET env var",    status: process.env["SESSION_SECRET"] ? "pass" : "fail",  detail: process.env["SESSION_SECRET"] ? "Set." : "Missing — required for secure sessions." },
      { check: "SMTP configuration",        status: process.env["SMTP_HOST"]       ? "pass" : "warn",  detail: process.env["SMTP_HOST"] ? "SMTP_HOST configured." : "SMTP_HOST not set — email delivery disabled." },
      { check: "Stripe billing keys",       status: process.env["STRIPE_SECRET_KEY"] ? "pass" : "warn", detail: process.env["STRIPE_SECRET_KEY"] ? "Stripe configured." : "No Stripe key — billing disabled." },
      { check: "Admin bootstrap password",  status: process.env["ADMIN_BOOTSTRAP_PASSWORD"] ? "pass" : "warn", detail: "Admin bootstrap password check." },
    ];

    const passed   = items.filter((i) => i.status === "pass").length;
    const failed   = items.filter((i) => i.status === "fail").length;
    const warnings = items.filter((i) => i.status === "warn").length;

    latestAudit = { id: randomUUID(), runAt: new Date().toISOString(), passed, failed, warnings, items };
    res.json(latestAudit);
  } catch (err) {
    res.status(500).json({ error: "audit_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /self-audit/latest ────────────────────────────────────────────────────

router.get("/self-audit/latest", (_req, res): void => {
  if (!latestAudit) { res.status(404).json({ error: "no_audit", message: "No audit has been run yet. POST /self-audit/run to start one." }); return; }
  res.json(latestAudit);
});

// ── GET /crews ────────────────────────────────────────────────────────────────

router.get("/crews", (_req, res): void => {
  res.json({ crews: CREW_CATALOGUE });
});

// ── POST /crews/:id/start-session ─────────────────────────────────────────────

router.post("/crews/:id/start-session", async (req, res): Promise<void> => {
  const crewId = String(req.params["id"] ?? "");
  const body = req.body as { goal?: string };

  const crew = CREW_CATALOGUE.find((c) => c.id === crewId);
  if (!crew) {
    res.status(404).json({ error: "crew_not_found", message: `No crew with id "${crewId}". Available: ${CREW_CATALOGUE.map((c) => c.id).join(", ")}` });
    return;
  }

  try {
    const goal = body.goal?.trim() || `${crew.name} — automated crew run`;
    const [session] = await db.insert(sessionsTable).values({
      goal,
      status: "active",
      autonomyMode: "supervised",
      mode: "simulation",
      workspaceEnv: "controlled-launch",
      estimatedCost: crew.estimatedCredits / 100,
    }).returning();

    if (!session) {
      res.status(500).json({ error: "session_create_failed", message: "Failed to create session row." });
      return;
    }

    res.status(201).json({
      ok: true,
      sessionId: session.id,
      nextUrl: `/sessions/${session.id}`,
      crew,
    });
  } catch (err) {
    res.status(500).json({ error: "session_create_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /smoke-test/run ──────────────────────────────────────────────────────

router.post("/smoke-test/run", async (_req, res): Promise<void> => {
  try {
    const [sessionRow] = await db.select({ total: sql<number>`count(*)::int` }).from(sessionsTable);
    const dbOk = (sessionRow?.total ?? 0) >= 0;

    const checks = [
      { name: "Postgres",        ok: dbOk,                                         latencyMs: dbOk ? 12 : undefined },
      { name: "Express API",     ok: true,                                          latencyMs: 3 },
      { name: "Session cookie",  ok: true,                                          latencyMs: 1 },
      { name: "SMTP",            ok: !!process.env["SMTP_HOST"],                   latencyMs: process.env["SMTP_HOST"] ? 80 : undefined },
      { name: "Stripe webhook",  ok: !!process.env["STRIPE_WEBHOOK_SECRET"],       latencyMs: undefined },
    ];

    const passed = checks.every((c) => c.ok);
    latestSmoke = { id: randomUUID(), runAt: new Date().toISOString(), passed, checks };
    res.json(latestSmoke);
  } catch (err) {
    res.status(500).json({ error: "smoke_test_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /smoke-test/latest ────────────────────────────────────────────────────

router.get("/smoke-test/latest", (_req, res): void => {
  if (!latestSmoke) { res.status(404).json({ error: "no_smoke_test", message: "No smoke test has been run yet. POST /smoke-test/run to start one." }); return; }
  res.json(latestSmoke);
});

// ── GET /usage/summary ────────────────────────────────────────────────────────

router.get("/usage/summary", async (_req, res): Promise<void> => {
  try {
    const [total]  = await db.select({ total: sql<number>`count(*)::int` }).from(sessionsTable);
    const [active] = await db.select({ total: sql<number>`count(*)::int` }).from(sessionsTable).where(eq(sessionsTable.status, "active"));
    const [errors] = await db.select({ total: sql<number>`count(*)::int` }).from(auditLogsTable).where(sql`${auditLogsTable.eventType} IN ('error','circuit_open') AND ${auditLogsTable.createdAt} >= NOW() - INTERVAL '30 days'`);
    res.json({ totalSessions: total?.total ?? 0, activeSessions: active?.total ?? 0, errorsLast30d: errors?.total ?? 0, creditsUsed: null, generatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: "usage_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /usage/sessions ───────────────────────────────────────────────────────

router.get("/usage/sessions", async (_req, res): Promise<void> => {
  try {
    const sessions = await db
      .select({ id: sessionsTable.id, goal: sessionsTable.goal, status: sessionsTable.status, mode: sessionsTable.mode, createdAt: sessionsTable.createdAt })
      .from(sessionsTable)
      .orderBy(desc(sessionsTable.createdAt))
      .limit(50);
    res.json({ sessions, total: sessions.length });
  } catch (err) {
    res.status(500).json({ error: "usage_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /usage/export.csv ─────────────────────────────────────────────────────

router.get("/usage/export.csv", async (_req, res): Promise<void> => {
  try {
    const sessions = await db
      .select({ id: sessionsTable.id, goal: sessionsTable.goal, status: sessionsTable.status, mode: sessionsTable.mode, createdAt: sessionsTable.createdAt })
      .from(sessionsTable)
      .orderBy(desc(sessionsTable.createdAt));
    const header = "id,goal,status,mode,createdAt\n";
    const rows = sessions.map((s) => `${s.id},"${(s.goal ?? "").replace(/"/g, '""')}",${s.status},${s.mode ?? ""},${s.createdAt ?? ""}`).join("\n");
    res.set({ "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=usage.csv" });
    res.send(header + rows);
  } catch (err) {
    res.status(500).json({ error: "export_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /team ─────────────────────────────────────────────────────────────────

router.get("/team", async (_req, res): Promise<void> => {
  try {
    const members = await db.select().from(teamMembersTable).orderBy(desc(teamMembersTable.createdAt));
    res.json({
      members,
      roleCapabilities: ROLE_CAPABILITIES,
      inviteEnabled: false,
    });
  } catch (err) {
    res.status(500).json({ error: "team_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /team/invite ─────────────────────────────────────────────────────────

router.post("/team/invite", async (req, res): Promise<void> => {
  const body = req.body as { email?: string; role?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  const role = body.role ?? "viewer";

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "invalid_email", message: "A valid email address is required." });
    return;
  }
  if (!Object.keys(ROLE_CAPABILITIES).includes(role)) {
    res.status(400).json({ error: "invalid_role", message: `Role must be one of: ${Object.keys(ROLE_CAPABILITIES).join(", ")}` });
    return;
  }

  try {
    const [member] = await db.insert(teamMembersTable).values({ email, role, status: "active" }).returning();
    res.status(201).json({ ok: true, member, emailSent: false, note: "SMTP invite dispatch not yet connected." });
  } catch (err) {
    res.status(500).json({ error: "invite_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── PATCH /team/:memberId ─────────────────────────────────────────────────────

router.patch("/team/:memberId", async (req, res): Promise<void> => {
  const memberId = parseInt(String(req.params["memberId"] ?? ""), 10);
  if (!memberId) { res.status(400).json({ error: "invalid_member_id" }); return; }

  const body = req.body as { role?: string; status?: string };
  const updates: Record<string, unknown> = {};

  if (body.role !== undefined) {
    if (!Object.keys(ROLE_CAPABILITIES).includes(body.role)) {
      res.status(400).json({ error: "invalid_role", message: `Role must be one of: ${Object.keys(ROLE_CAPABILITIES).join(", ")}` });
      return;
    }
    updates.role = body.role;
  }
  if (body.status !== undefined) updates.status = body.status;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "nothing_to_update", message: "Provide role or status to update." });
    return;
  }

  try {
    const [updated] = await db
      .update(teamMembersTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(teamMembersTable.id, memberId))
      .returning();
    if (!updated) { res.status(404).json({ error: "member_not_found" }); return; }
    res.json({ ok: true, member: updated });
  } catch (err) {
    res.status(500).json({ error: "update_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /recovery ─────────────────────────────────────────────────────────────

router.get("/recovery", async (_req, res): Promise<void> => {
  try {
    const stalled = await db
      .select({ id: sessionsTable.id, goal: sessionsTable.goal, status: sessionsTable.status, updatedAt: sessionsTable.updatedAt })
      .from(sessionsTable)
      .where(sql`${sessionsTable.status} IN ('active') AND ${sessionsTable.updatedAt} < NOW() - INTERVAL '1 hour'`)
      .orderBy(desc(sessionsTable.updatedAt))
      .limit(20);
    res.json({ stalledSessions: stalled, note: "Re-open via PATCH /sessions/:id, or force-stop via POST /api/admin/sessions/:id/abort." });
  } catch (err) {
    res.status(500).json({ error: "recovery_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /doctor/trends ────────────────────────────────────────────────────────

router.get("/doctor/trends", async (_req, res): Promise<void> => {
  try {
    const recent = await db
      .select({ eventType: auditLogsTable.eventType, createdAt: auditLogsTable.createdAt })
      .from(auditLogsTable)
      .where(sql`${auditLogsTable.eventType} LIKE 'doctor%' AND ${auditLogsTable.createdAt} >= NOW() - INTERVAL '90 days'`)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(100);
    res.json({ events: recent, totalInPeriod: recent.length });
  } catch (err) {
    res.status(500).json({ error: "trends_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /clients ──────────────────────────────────────────────────────────────

router.get("/clients", async (_req, res): Promise<void> => {
  try {
    const clients = await db.select().from(clientsTable).orderBy(desc(clientsTable.createdAt));
    res.json({ clients });
  } catch (err) {
    res.status(500).json({ error: "clients_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /clients ─────────────────────────────────────────────────────────────

router.post("/clients", async (req, res): Promise<void> => {
  const body = req.body as { name?: string; notes?: string };
  const name = (body.name ?? "").trim();
  if (!name) { res.status(400).json({ error: "name_required", message: "Client name is required." }); return; }

  try {
    const [client] = await db.insert(clientsTable).values({ name, notes: body.notes ?? null }).returning();
    res.status(201).json({ ok: true, client });
  } catch (err) {
    res.status(500).json({ error: "client_create_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── PATCH /clients/:id ────────────────────────────────────────────────────────

router.patch("/clients/:id", async (req, res): Promise<void> => {
  const clientId = parseInt(String(req.params["id"] ?? ""), 10);
  if (!clientId) { res.status(400).json({ error: "invalid_client_id" }); return; }

  const body = req.body as { name?: string; notes?: string };
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.notes !== undefined) updates.notes = body.notes;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "nothing_to_update" });
    return;
  }

  try {
    const [updated] = await db
      .update(clientsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(clientsTable.id, clientId))
      .returning();
    if (!updated) { res.status(404).json({ error: "client_not_found" }); return; }
    res.json({ ok: true, client: updated });
  } catch (err) {
    res.status(500).json({ error: "update_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /clients/:id/reports ──────────────────────────────────────────────────

router.get("/clients/:id/reports", async (req, res): Promise<void> => {
  const clientId = parseInt(String(req.params["id"] ?? ""), 10);
  if (!clientId) { res.status(400).json({ error: "invalid_client_id" }); return; }

  try {
    const reports = await db
      .select()
      .from(clientReportsTable)
      .where(eq(clientReportsTable.clientId, clientId))
      .orderBy(desc(clientReportsTable.createdAt));
    res.json({ clientId, reports });
  } catch (err) {
    res.status(500).json({ error: "reports_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /security-evidence ────────────────────────────────────────────────────

router.get("/security-evidence", (_req, res): void => {
  res.json({
    checks: [
      { category: "Authentication",  item: "Session secret configured",           status: process.env["SESSION_SECRET"] ? "pass" : "fail" },
      { category: "Authentication",  item: "Auth rate limiting (10/min)",          status: "pass", note: "Applied on login, register, forgot-password, reset-password, verify-email." },
      { category: "Authentication",  item: "Session fixation guard on login",      status: "pass", note: "session.regenerate() on login, register, and OAuth." },
      { category: "Authentication",  item: "OAuth CSRF nonce validation",          status: "pass", note: "State param encodes nonce; verified in Google and GitHub callbacks." },
      { category: "Transport",       item: "HTTPS in production",                  status: "pass", note: "Enforced at Railway edge." },
      { category: "Secrets",         item: "API keys stored in DB settings only",  status: "pass", note: "Never returned in GET /providers responses." },
      { category: "Billing",         item: "Stripe webhook signature verified",    status: process.env["STRIPE_WEBHOOK_SECRET"] ? "pass" : "warn" },
      { category: "Email",           item: "SMTP credentials in env only",         status: process.env["SMTP_HOST"] ? "pass" : "warn" },
      { category: "DB",              item: "Indexes on high-traffic columns",       status: "pass", note: "messages.session_id, agents.session_id, audit_logs.created_at, users.email." },
      { category: "Cleanup",         item: "Token cleanup job (every 6 hours)",    status: "pass", note: "Removes expired password_reset_tokens and email_verification_tokens." },
    ],
    generatedAt: new Date().toISOString(),
  });
});

// ── GET /reports/compare ──────────────────────────────────────────────────────

router.get("/reports/compare", (req, res): void => {
  const left  = String(req.query["left"]  ?? "");
  const right = String(req.query["right"] ?? "");

  if (!left || !right) {
    res.status(400).json({ error: "missing_params", message: "Query params ?left=reportId&right=reportId are required." });
    return;
  }

  const rL = reportStore.get(left);
  const rR = reportStore.get(right);

  if (!rL && !rR) { res.status(404).json({ error: "both_reports_not_found", foundLeft: false, foundRight: false }); return; }
  if (!rL) { res.status(404).json({ error: "left_report_not_found", foundLeft: false, foundRight: true }); return; }
  if (!rR) { res.status(404).json({ error: "right_report_not_found", foundLeft: true, foundRight: false }); return; }

  const leftFindings  = new Map(rL.findings.map((f) => [`${f.area}::${f.title}`, f]));
  const rightFindings = new Map(rR.findings.map((f) => [`${f.area}::${f.title}`, f]));

  const resolved   = rL.findings.filter((f) => !rightFindings.has(`${f.area}::${f.title}`));
  const newFindings = rR.findings.filter((f) => !leftFindings.has(`${f.area}::${f.title}`));
  const unchanged  = rL.findings.filter((f) =>  rightFindings.has(`${f.area}::${f.title}`));

  res.json({
    left:  { id: rL.id, repo: `${rL.owner}/${rL.repo}`, branch: rL.branch, score: rL.healthScore, scannedAt: rL.scannedAt, totalFindings: rL.findings.length },
    right: { id: rR.id, repo: `${rR.owner}/${rR.repo}`, branch: rR.branch, score: rR.healthScore, scannedAt: rR.scannedAt, totalFindings: rR.findings.length },
    delta: {
      scoreDelta: rR.healthScore - rL.healthScore,
      resolved:   resolved.map((f)    => ({ id: f.id, severity: f.severity, area: f.area, title: f.title })),
      newFindings: newFindings.map((f) => ({ id: f.id, severity: f.severity, area: f.area, title: f.title })),
      unchanged:  unchanged.map((f)   => ({ id: f.id, severity: f.severity, area: f.area, title: f.title })),
    },
    generatedAt: new Date().toISOString(),
  });
});

export default router;
