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

export default router;
