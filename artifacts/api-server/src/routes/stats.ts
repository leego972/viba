import { Router, type IRouter } from "express";
import { db, auditLogsTable, sessionsTable, messagesTable, settingsTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { detectSpikeProviders } from "../lib/spikeDetect";

const router: IRouter = Router();

const DEFAULT_ALERT_THRESHOLD = 5;
const ALERT_WINDOW_HOURS = 1;
const LEGACY_SPIKE_THRESHOLD = 3;

router.get("/stats", async (req, res): Promise<void> => {
  const [totals] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(sessionsTable);

  const [active] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(sessionsTable)
    .where(eq(sessionsTable.status, "active"));

  const [completed] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(sessionsTable)
    .where(eq(sessionsTable.status, "completed"));

  const [fallbacks] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLogsTable)
    .where(eq(auditLogsTable.eventType, "adapter_fallback"));

  const byProvider = await db
    .select({
      provider: sql<string>`metadata->>'provider'`,
      count: sql<number>`count(*)::int`,
    })
    .from(auditLogsTable)
    .where(
      sql`${auditLogsTable.eventType} = 'adapter_fallback'
        AND metadata->>'provider' IS NOT NULL
        AND metadata->>'provider' <> ''`
    )
    .groupBy(sql`metadata->>'provider'`)
    .orderBy(desc(sql`count(*)`));

  const trend = await db
    .select({
      day: sql<string>`date_trunc('day', ${auditLogsTable.createdAt})::date::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(auditLogsTable)
    .where(
      sql`${auditLogsTable.eventType} = 'adapter_fallback'
        AND ${auditLogsTable.createdAt} >= NOW() - INTERVAL '14 days'`
    )
    .groupBy(sql`date_trunc('day', ${auditLogsTable.createdAt})`)
    .orderBy(sql`date_trunc('day', ${auditLogsTable.createdAt}) ASC`);

  const modelUsage = await db
    .select({
      model: messagesTable.model,
      count: sql<number>`count(*)::int`,
    })
    .from(messagesTable)
    .where(sql`${messagesTable.model} IS NOT NULL AND ${messagesTable.model} <> ''`)
    .groupBy(messagesTable.model)
    .orderBy(desc(sql`count(*)`));

  const alertSettings = await db
    .select({ key: settingsTable.key, value: settingsTable.value })
    .from(settingsTable)
    .where(
      sql`${settingsTable.key} IN ('FALLBACK_ALERT_THRESHOLD', 'FALLBACK_ALERT_ENABLED')`
    );

  const alertSettingsMap = new Map(alertSettings.map((s) => [s.key, s.value]));
  const rawThreshold = alertSettingsMap.get("FALLBACK_ALERT_THRESHOLD");
  const alertThreshold = rawThreshold ? Math.max(1, parseInt(rawThreshold, 10) || DEFAULT_ALERT_THRESHOLD) : DEFAULT_ALERT_THRESHOLD;
  const alertEnabled = alertSettingsMap.get("FALLBACK_ALERT_ENABLED") !== "false";

  const recentByProvider = await db
    .select({
      provider: sql<string>`metadata->>'provider'`,
      count: sql<number>`count(*)::int`,
    })
    .from(auditLogsTable)
    .where(
      sql`${auditLogsTable.eventType} = 'adapter_fallback'
        AND metadata->>'provider' IS NOT NULL
        AND metadata->>'provider' <> ''
        AND ${auditLogsTable.createdAt} >= NOW() - (${ALERT_WINDOW_HOURS} * INTERVAL '1 hour')`
    )
    .groupBy(sql`metadata->>'provider'`)
    .orderBy(desc(sql`count(*)`));

  const recentSpikeProviders = alertEnabled
    ? detectSpikeProviders(recentByProvider, alertThreshold)
    : [];

  const spikeProviders = detectSpikeProviders(byProvider, LEGACY_SPIKE_THRESHOLD);

  res.json({
    totalSessions: totals?.total ?? 0,
    activeSessions: active?.total ?? 0,
    completedSessions: completed?.total ?? 0,
    fallbackEvents: fallbacks?.total ?? 0,
    fallbacksByProvider: byProvider,
    fallbackTrend: trend,
    modelUsage: modelUsage.map((m) => ({ model: m.model ?? "unknown", count: m.count })),
    spikeProviders,
    recentSpikeProviders,
    recentSpikeThreshold: alertThreshold,
    alertEnabled,
  });
});

export default router;
