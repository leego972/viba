import { Router, type IRouter } from "express";
import { createRateLimiter } from "../middlewares/rateLimiter";
import { db, auditLogsTable, sessionsTable, messagesTable, settingsTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { detectSpikeProviders, type ProviderCount } from "../lib/spikeDetect";
import { sendSpikeNotifications, sendTestWebhookNotification, getLastNotification } from "../lib/spikeNotify";
import { sendTestEmail } from "../lib/emailNotify";
import doctorRouter from "./projectDoctor";
import sessionBudgetRouter from "./sessionBudget";
import sessionProofReportRouter from "./sessionProofReport";
import doctorRepairProposalRouter from "./doctorRepairProposal";
import marketCompletionRouter from "./marketCompletion";

// 5 req/min — this route fires outbound HTTP and SMTP; keep tight
  const testNotificationLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 5,
    message: "Notification test rate limit reached. Please wait before retrying.",
  });

  const router: IRouter = Router();
router.use(doctorRouter);
router.use(sessionBudgetRouter);
router.use(sessionProofReportRouter);
router.use(doctorRepairProposalRouter);
router.use(marketCompletionRouter);

const DEFAULT_ALERT_THRESHOLD = 5;
const ALERT_WINDOW_HOURS = 1;
const LEGACY_SPIKE_THRESHOLD = 3;

const SIMULATED_PREFIX = "⚠️ [Simulated";

export function resolveAlertSettings(settingsMap: Map<string, string>): {
  alertEnabled: boolean;
  alertThreshold: number;
} {
  const rawThreshold = settingsMap.get("FALLBACK_ALERT_THRESHOLD");
  const parsed = rawThreshold !== undefined ? parseInt(rawThreshold, 10) : NaN;
  const alertThreshold =
    rawThreshold !== undefined && !isNaN(parsed)
      ? Math.max(1, parsed)
      : DEFAULT_ALERT_THRESHOLD;
  const alertEnabled = settingsMap.get("FALLBACK_ALERT_ENABLED") !== "false";
  return { alertEnabled, alertThreshold };
}

export function resolveNotificationChannels(settingsMap: Map<string, string>): {
  webhookUrl: string | null;
  notificationEmail: string | null;
} {
  return {
    webhookUrl: settingsMap.get("NOTIFICATION_WEBHOOK_URL") ?? null,
    notificationEmail: settingsMap.get("NOTIFICATION_EMAIL") ?? null,
  };
}

export function computeRecentSpike(
  recentByProvider: ProviderCount[],
  alertEnabled: boolean,
  alertThreshold: number
): string[] {
  return alertEnabled ? detectSpikeProviders(recentByProvider, alertThreshold) : [];
}

export function classifyModelRows(
  rows: Array<{ model: string | null; provider: string | null; simulated: boolean; count: number }>
): Array<{ model: string; provider: string; mode: "live" | "simulated"; count: number }> {
  return rows
    .filter((r) => r.model && r.provider)
    .map((r) => ({
      model: r.model!,
      provider: r.provider!,
      mode: r.simulated ? "simulated" : "live",
      count: r.count,
    }));
}

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
      simulatedCount: sql<number>`sum(case when ${messagesTable.content} like '⚠️ [Simulated%' then 1 else 0 end)::int`,
      liveCount: sql<number>`sum(case when ${messagesTable.content} not like '⚠️ [Simulated%' then 1 else 0 end)::int`,
    })
    .from(messagesTable)
    .where(sql`${messagesTable.model} IS NOT NULL AND ${messagesTable.model} <> ''`)
    .groupBy(messagesTable.model)
    .orderBy(desc(sql`count(*)`));

  const modelUsageRaw = await db
    .select({
      model: messagesTable.model,
      provider: messagesTable.provider,
      simulated: sql<boolean>`(${messagesTable.content} LIKE '⚠️ [Simulated%')`,
      count: sql<number>`count(*)::int`,
    })
    .from(messagesTable)
    .where(sql`${messagesTable.model} IS NOT NULL AND ${messagesTable.model} <> ''`)
    .groupBy(
      messagesTable.model,
      messagesTable.provider,
      sql`(${messagesTable.content} LIKE '⚠️ [Simulated%')`
    )
    .orderBy(desc(sql`count(*)`));

  const alertSettings = await db
    .select({ key: settingsTable.key, value: settingsTable.value })
    .from(settingsTable)
    .where(
      sql`${settingsTable.key} IN ('FALLBACK_ALERT_THRESHOLD', 'FALLBACK_ALERT_ENABLED', 'NOTIFICATION_WEBHOOK_URL', 'NOTIFICATION_EMAIL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM')`
    );

  const alertSettingsMap = new Map(alertSettings.map((s) => [s.key, s.value]));
  const { alertEnabled, alertThreshold } = resolveAlertSettings(alertSettingsMap);

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

  const recentSpikeProviders = computeRecentSpike(recentByProvider, alertEnabled, alertThreshold);

  if (recentSpikeProviders.length > 0) {
    const { webhookUrl, notificationEmail } = resolveNotificationChannels(alertSettingsMap);
    const spikeDetails = recentByProvider.filter((p) =>
      recentSpikeProviders.includes(p.provider)
    );
    const settingsUrl = `${req.protocol}://${req.get("host")}/settings`;
    void sendSpikeNotifications({
      providers: spikeDetails,
      threshold: alertThreshold,
      webhookUrl,
      notificationEmail,
      settingsUrl,
      smtpSettings: alertSettingsMap,
    });
  }

  const spikeProviders = detectSpikeProviders(byProvider, LEGACY_SPIKE_THRESHOLD);

  res.json({
    totalSessions: totals?.total ?? 0,
    activeSessions: active?.total ?? 0,
    completedSessions: completed?.total ?? 0,
    fallbackEvents: fallbacks?.total ?? 0,
    fallbacksByProvider: byProvider,
    fallbackTrend: trend,
    modelUsage: modelUsage.map((m) => ({
      model: m.model ?? "unknown",
      count: m.count,
      liveCount: m.liveCount ?? 0,
      simulatedCount: m.simulatedCount ?? 0,
    })),
    modelUsageBreakdown: classifyModelRows(modelUsageRaw),
    spikeProviders,
    recentSpikeProviders,
    recentSpikeThreshold: alertThreshold,
    alertEnabled,
    lastSpikeNotification: getLastNotification(),
  });
});

export function buildTestNotificationMessage(
  webhookSent: boolean,
  email: string | null,
  emailSent: boolean,
  emailReason?: string
): string {
  const parts: string[] = [];
  if (webhookSent) parts.push("Webhook delivered");
  if (email) {
    if (emailSent) {
      parts.push(`test email sent to ${email}`);
    } else {
      const detail = emailReason ? ` (${emailReason})` : "";
      parts.push(`email not sent to ${email}${detail}`);
    }
  }
  return parts.length > 0 ? parts.join("; ") + "." : "Test notification sent.";
}

router.post("/stats/test-notification", testNotificationLimiter, async (req, res): Promise<void> => {
  const notificationSettings = await db
    .select({ key: settingsTable.key, value: settingsTable.value })
    .from(settingsTable)
    .where(
      sql`${settingsTable.key} IN ('NOTIFICATION_WEBHOOK_URL', 'NOTIFICATION_EMAIL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM')`
    );

  const settingsMap = new Map(notificationSettings.map((s) => [s.key, s.value]));
  const webhookUrl = settingsMap.get("NOTIFICATION_WEBHOOK_URL") ?? null;
  const email = settingsMap.get("NOTIFICATION_EMAIL") ?? null;

  if (!webhookUrl && !email) {
    res.status(400).json({ error: "No notification channel configured. Set a webhook URL or email address in Settings." });
    return;
  }

  const settingsUrl = `${req.protocol}://${req.get("host")}/settings`;

  let webhookError: string | null = null;
  let webhookSent = false;
  let emailSent = false;
  let emailReason: string | undefined;

  if (webhookUrl) {
    try {
      await sendTestWebhookNotification(webhookUrl, settingsUrl);
      webhookSent = true;
    } catch (err) {
      webhookError = err instanceof Error ? err.message : "Unknown error";
      req.log.warn({ url: webhookUrl, err }, "Test webhook notification failed");
    }
  }

  if (email) {
    const result = await sendTestEmail(email, settingsUrl, settingsMap);
    emailSent = result.sent;
    emailReason = result.reason;
  }

  if (webhookError) {
    res.status(400).json({ error: `Webhook delivery failed: ${webhookError}` });
    return;
  }

  res.json({
    ok: true,
    message: buildTestNotificationMessage(webhookSent, email, emailSent, emailReason),
    emailSent,
  });
});

export default router;
