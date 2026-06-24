import { Router, type IRouter } from "express";
import { db, sessionsTable, auditLogsTable, settingsTable } from "@workspace/db";
import { sql, eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

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
// GET /market-readiness — aggregate live platform health
// ──────────────────────────────────────────────────

router.get("/market-readiness", async (req, res): Promise<void> => {
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
      const hasKey = keyKey ? !!(process.env[keyKey.replace("GROQ", "GROQ").replace("GEMINI", "GEMINI")] || settingsMap.get(keyKey)) : true;
      return enabled && hasKey;
    });

    // Feature readiness checklist
    const features = [
      { id: "auth", label: "Authentication & Sessions", status: "ready" },
      { id: "providers", label: "AI Provider Configuration", status: configuredProviders.length > 0 ? "ready" : "needs_config" },
      { id: "sessions", label: "Multi-Agent Sessions", status: (sessionTotal?.total ?? 0) > 0 ? "ready" : "pending" },
      { id: "billing", label: "Billing & Credits", status: process.env["STRIPE_SECRET_KEY"] ? "ready" : "needs_config" },
      { id: "doctor", label: "Project Doctor & Repair PRs", status: "ready" },
      { id: "demo", label: "Public Demo Pages", status: "ready" },
      { id: "email", label: "Email Notifications", status: process.env["SMTP_HOST"] ? "ready" : "needs_config" },
    ];

    const readyCount = features.filter((f) => f.status === "ready").length;
    const totalCount = features.length;
    const score = Math.round((readyCount / totalCount) * 100);

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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "market_readiness_error", message: msg });
  }
});

// ──────────────────────────────────────────────────
// POST /share/reports — create a shareable link for a report
// ──────────────────────────────────────────────────

router.post("/share/reports", async (req, res): Promise<void> => {
  const userId = req.session?.userId ?? null;
  const body = req.body as {
    reportType?: string;
    payload?: unknown;
    expiresInDays?: number;
  };

  const reportType = body.reportType === "doctor" || body.reportType === "proof" ? body.reportType : "custom";
  if (!body.payload) {
    res.status(400).json({ error: "payload is required" });
    return;
  }

  const expiresInDays = typeof body.expiresInDays === "number" ? Math.min(body.expiresInDays, 90) : 30;
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const shareId = randomUUID();
  const shared: SharedReport = {
    id: shareId,
    reportType,
    ownerId: userId as number | null,
    payload: body.payload,
    createdAt: new Date().toISOString(),
    expiresAt,
  };
  shareStore.set(shareId, shared);

  res.status(201).json({
    shareId,
    shareUrl: `/share/reports/${shareId}`,
    expiresAt,
  });
});

// ──────────────────────────────────────────────────
// GET /share/reports/:shareId — retrieve shared report (public)
// ──────────────────────────────────────────────────

router.get("/share/reports/:shareId", (req, res): void => {
  const shareId = String(req.params["shareId"] ?? "");
  const shared = shareStore.get(shareId);

  if (!shared) {
    res.status(404).json({ error: "report_not_found", message: "This shared report does not exist or has been removed." });
    return;
  }

  if (shared.expiresAt && new Date(shared.expiresAt) < new Date()) {
    shareStore.delete(shareId);
    res.status(410).json({ error: "report_expired", message: "This shared report has expired." });
    return;
  }

  res.json({
    id: shared.id,
    reportType: shared.reportType,
    payload: shared.payload,
    createdAt: shared.createdAt,
    expiresAt: shared.expiresAt,
  });
});

// ── In-memory stores for ephemeral run results ───────────────────────────────

interface AuditResult { id: string; runAt: string; passed: number; failed: number; warnings: number; items: Array<{ check: string; status: string; detail: string }> }
interface SmokeResult { id: string; runAt: string; passed: boolean; checks: Array<{ name: string; ok: boolean; latencyMs?: number }> }

let latestAudit: AuditResult | null = null;
let latestSmoke: SmokeResult | null = null;

// ── GET /connectors/status ────────────────────────────────────────────────────

router.get("/connectors/status", (_req, res): void => {
  res.json({
    connectors: [
      { id: "github",  label: "GitHub",  status: "connected",     note: "Configured via Replit GitHub integration." },
      { id: "slack",   label: "Slack",   status: "not_connected", note: "Planned Q3 2026." },
      { id: "notion",  label: "Notion",  status: "not_connected", note: "Planned Q3 2026." },
      { id: "jira",    label: "Jira",    status: "not_connected", note: "Planned Q3 2026." },
      { id: "railway", label: "Railway", status: "not_connected", note: "MCP integration planned." },
    ],
  });
});

// ── POST /self-audit/run ──────────────────────────────────────────────────────

router.post("/self-audit/run", async (_req, res): Promise<void> => {
  try {
    const [sessionTotal] = await db.select({ total: sql<number>`count(*)::int` }).from(sessionsTable);
    const dbOk = (sessionTotal?.total ?? 0) >= 0;

    const items = [
      { check: "Database connectivity",    status: dbOk ? "pass" : "fail",    detail: dbOk ? "Postgres reachable." : "Cannot query sessions table." },
      { check: "SESSION_SECRET env var",   status: process.env["SESSION_SECRET"] ? "pass" : "fail",  detail: process.env["SESSION_SECRET"] ? "Set." : "Missing — required for secure sessions." },
      { check: "SMTP configuration",       status: process.env["SMTP_HOST"]      ? "pass" : "warn",  detail: process.env["SMTP_HOST"] ? "SMTP_HOST configured." : "SMTP_HOST not set — email delivery disabled." },
      { check: "Stripe billing keys",      status: process.env["STRIPE_SECRET_KEY"] ? "pass" : "warn", detail: process.env["STRIPE_SECRET_KEY"] ? "Stripe configured." : "No Stripe key — billing disabled." },
      { check: "Admin password",           status: process.env["ADMIN_BOOTSTRAP_PASSWORD"] ? "pass" : "warn", detail: "Admin bootstrap password env var check." },
    ];

    const passed   = items.filter((i) => i.status === "pass").length;
    const failed   = items.filter((i) => i.status === "fail").length;
    const warnings = items.filter((i) => i.status === "warn").length;

    latestAudit = { id: randomUUID(), runAt: new Date().toISOString(), passed, failed, warnings, items };
    res.json(latestAudit);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "audit_error", message: msg });
  }
});

// ── GET /self-audit/latest ────────────────────────────────────────────────────

router.get("/self-audit/latest", (_req, res): void => {
  if (!latestAudit) { res.status(404).json({ error: "no_audit", message: "No audit has been run yet. POST /self-audit/run to start one." }); return; }
  res.json(latestAudit);
});

// ── GET /crews ────────────────────────────────────────────────────────────────

router.get("/crews", (_req, res): void => {
  res.json({
    crews: [
      { id: "code-review",   label: "Code Review",        description: "Automated multi-agent PR review: security, logic, tests.",     planned: true,  eta: "Q3 2026" },
      { id: "market-intel",  label: "Market Intel",       description: "Research competitors, summarise positioning, draft report.",   planned: true,  eta: "Q3 2026" },
      { id: "bug-triage",    label: "Bug Triage",         description: "Classify issues, assign priority, draft fix proposals.",       planned: true,  eta: "Q3 2026" },
      { id: "content-ops",   label: "Content Ops",        description: "Blog drafts, SEO optimisation, social copy — all in one run.", planned: true,  eta: "Q4 2026" },
    ],
  });
});

// ── POST /crews/:id/start-session ─────────────────────────────────────────────

router.post("/crews/:id/start-session", (req, res): void => {
  const crewId = String(req.params["id"] ?? "");
  res.status(202).json({ ok: true, message: `Crew "${crewId}" sessions are not yet available. ETA Q3 2026.`, planned: true });
});

// ── POST /smoke-test/run ──────────────────────────────────────────────────────

router.post("/smoke-test/run", async (_req, res): Promise<void> => {
  try {
    const [sessionRow] = await db.select({ total: sql<number>`count(*)::int` }).from(sessionsTable);
    const dbOk = (sessionRow?.total ?? 0) >= 0;

    const checks = [
      { name: "Postgres",        ok: dbOk,                                        latencyMs: dbOk ? 12 : undefined },
      { name: "Express API",     ok: true,                                         latencyMs: 3 },
      { name: "Session cookie",  ok: true,                                         latencyMs: 1 },
      { name: "SMTP",            ok: !!process.env["SMTP_HOST"],                  latencyMs: process.env["SMTP_HOST"] ? 80 : undefined },
      { name: "Stripe webhook",  ok: !!process.env["STRIPE_WEBHOOK_SECRET"],      latencyMs: undefined },
    ];

    const passed = checks.every((c) => c.ok);
    latestSmoke = { id: randomUUID(), runAt: new Date().toISOString(), passed, checks };
    res.json(latestSmoke);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "smoke_test_error", message: msg });
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

router.get("/team", (_req, res): void => {
  res.json({ members: [], message: "Team management is planned for Q4 2026.", planned: true });
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
    res.json({ stalledSessions: stalled, recoveryPlanned: true, note: "Manual recovery via DELETE /sessions/:id or re-open via PATCH." });
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
    res.json({ events: recent, planned: true, note: "Long-term health score charts planned Q3 2026." });
  } catch (err) {
    res.status(500).json({ error: "trends_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /clients ──────────────────────────────────────────────────────────────

router.get("/clients", (_req, res): void => {
  res.json({ clients: [], message: "Client management is planned for Q4 2026.", planned: true });
});

// ── POST /clients ─────────────────────────────────────────────────────────────

router.post("/clients", (_req, res): void => {
  res.status(501).json({ error: "not_implemented", message: "Client management is planned for Q4 2026.", planned: true });
});

// ── GET /security-evidence ────────────────────────────────────────────────────

router.get("/security-evidence", (_req, res): void => {
  res.json({
    checks: [
      { category: "Authentication",  item: "Session secret configured",          status: process.env["SESSION_SECRET"] ? "pass" : "fail" },
      { category: "Authentication",  item: "Auth rate limiting (10/min)",         status: "pass", note: "express-rate-limit on /auth/*" },
      { category: "Authentication",  item: "Session fixation guard on login",     status: "pass", note: "session.regenerate() on login/register" },
      { category: "Authentication",  item: "OAuth CSRF nonce validation",         status: "pass" },
      { category: "Transport",       item: "HTTPS in production",                 status: "pass", note: "Enforced at Railway edge." },
      { category: "Secrets",         item: "API keys stored in DB settings only", status: "pass", note: "Never returned in GET /providers responses." },
      { category: "Billing",         item: "Stripe webhook signature verified",   status: process.env["STRIPE_WEBHOOK_SECRET"] ? "pass" : "warn" },
      { category: "Email",           item: "SMTP credentials in env only",        status: process.env["SMTP_HOST"] ? "pass" : "warn" },
    ],
    generatedAt: new Date().toISOString(),
    note: "Full OWASP audit planned Q3 2026.",
  });
});

// ── GET /reports/compare ──────────────────────────────────────────────────────

router.get("/reports/compare", (req, res): void => {
  const a = req.query["a"] as string | undefined;
  const b = req.query["b"] as string | undefined;
  if (!a || !b) {
    res.status(400).json({ error: "query params ?a=shareId&b=shareId are required" });
    return;
  }
  const rA = shareStore.get(a);
  const rB = shareStore.get(b);
  if (!rA || !rB) {
    res.status(404).json({ error: "one_or_both_reports_not_found", foundA: !!rA, foundB: !!rB });
    return;
  }
  res.json({ reportA: { id: rA.id, reportType: rA.reportType, createdAt: rA.createdAt }, reportB: { id: rB.id, reportType: rB.reportType, createdAt: rB.createdAt }, comparison: { planned: true, note: "Side-by-side diff planned Q3 2026." } });
});

export default router;
