import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  sessionsTable,
  messagesTable,
  auditLogsTable,
  settingsTable,
  circuitStateTable,
} from "@workspace/db";
import { sql, desc, eq } from "drizzle-orm";
import crypto from "crypto";
import { requireConfirmation } from "../middlewares/adminAuth";
import { getStripeClient } from "../lib/stripe/client";

const router: IRouter = Router();

function safeInt(raw: unknown, fallback: number, max?: number): number {
  const n = parseInt(String(raw ?? fallback), 10);
  const safe = Number.isNaN(n) ? fallback : n;
  return max !== undefined ? Math.min(safe, max) : safe;
}

function newAccessToken() {
  return "viba_" + crypto.randomBytes(24).toString("hex");
}

// ─── GET /api/admin/overview ──────────────────────────────────────────────────
router.get("/overview", async (req, res): Promise<void> => {
  const [sessions] = await db.select({ total: sql<number>`count(*)::int` }).from(sessionsTable);
  const [activeSessions] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(sessionsTable)
    .where(eq(sessionsTable.status, "active"));

  const [messages] = await db.select({ total: sql<number>`count(*)::int` }).from(messagesTable);

  const [errorsToday] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLogsTable)
    .where(
      sql`${auditLogsTable.eventType} IN ('adapter_fallback','circuit_open','error')
          AND ${auditLogsTable.createdAt} >= NOW() - INTERVAL '24 hours'`
    );

  const [errors7d] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLogsTable)
    .where(
      sql`${auditLogsTable.eventType} IN ('adapter_fallback','circuit_open','error')
          AND ${auditLogsTable.createdAt} >= NOW() - INTERVAL '7 days'`
    );

  const subsRows = await db.execute(
    sql`SELECT status, COUNT(*)::int AS count FROM subscribers GROUP BY status`
  );
  const subsByStatus: Record<string, number> = {};
  let totalSubs = 0;
  for (const row of subsRows.rows as { status: string; count: number }[]) {
    subsByStatus[row.status] = row.count;
    totalSubs += row.count;
  }

  const circuitRows = await db.select().from(circuitStateTable);
  const openCircuits = circuitRows.filter((r) => r.openedAt !== null);

  res.json({
    sessions: { total: sessions?.total ?? 0, active: activeSessions?.total ?? 0 },
    messages: messages?.total ?? 0,
    errors: { today: errorsToday?.total ?? 0, last7d: errors7d?.total ?? 0 },
    subscribers: { total: totalSubs, byStatus: subsByStatus },
    circuits: { total: circuitRows.length, open: openCircuits.length },
    uptime: process.uptime(),
    nodeVersion: process.version,
    env: process.env.NODE_ENV ?? "unknown",
  });
});

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
router.get("/users", async (req, res): Promise<void> => {
  const rows = await db.execute(
    sql`SELECT id, email, status, stripe_customer_id, stripe_subscription_id,
               right(access_token, 8) AS token_suffix,
               trial_end, current_period_end, created_at, updated_at
        FROM subscribers ORDER BY created_at DESC LIMIT 500`
  );
  res.json({ users: rows.rows });
});

// ─── POST /api/admin/users/:id/revoke (destructive) ──────────────────────────
router.post("/users/:id/revoke", requireConfirmation, async (req, res): Promise<void> => {
  const id = safeInt(req.params.id, 0);
  if (!id) { res.status(400).json({ error: "invalid id" }); return; }
  const token = newAccessToken();
  await db.execute(
    sql`UPDATE subscribers SET access_token = ${token}, updated_at = NOW() WHERE id = ${id}`
  );
  req.log.warn({ adminAction: "revoke_token", targetId: id }, "Admin revoked subscriber access token");
  res.json({ ok: true, message: "Access token revoked — subscriber must re-subscribe or use new token" });
});

// ─── POST /api/admin/users/:id/cancel-subscription (destructive) ─────────────
router.post("/users/:id/cancel-subscription", requireConfirmation, async (req, res): Promise<void> => {
  const id = safeInt(req.params.id, 0);
  if (!id) { res.status(400).json({ error: "invalid id" }); return; }

  const rows = await db.execute(
    sql`SELECT stripe_subscription_id FROM subscribers WHERE id = ${id}`
  );
  const sub = rows.rows[0] as { stripe_subscription_id: string | null } | undefined;
  if (!sub) { res.status(404).json({ error: "subscriber not found" }); return; }

  if (sub.stripe_subscription_id) {
    try {
      const stripe = getStripeClient();
      await stripe.subscriptions.cancel(sub.stripe_subscription_id);
    } catch (err) {
      req.log.error({ err }, "Stripe subscription cancel failed");
      res.status(502).json({ error: "Stripe API error", detail: (err as Error).message });
      return;
    }
  }

  await db.execute(
    sql`UPDATE subscribers SET status = 'canceled', updated_at = NOW() WHERE id = ${id}`
  );
  req.log.warn({ adminAction: "cancel_subscription", targetId: id }, "Admin canceled subscription");
  res.json({ ok: true, message: "Subscription canceled" });
});

// ─── GET /api/admin/sessions ──────────────────────────────────────────────────
router.get("/sessions", async (req, res): Promise<void> => {
  const limit = safeInt(req.query.limit, 50, 200);
  const offset = safeInt(req.query.offset, 0);

  const rows = await db.execute(
    sql`SELECT s.id, s.goal, s.status, s.mode, s.autonomy_mode,
               s.estimated_cost, s.created_at, s.updated_at,
               COUNT(DISTINCT a.id)::int  AS agent_count,
               COUNT(DISTINCT m.id)::int  AS message_count,
               COUNT(DISTINCT t.id)::int  AS task_count
        FROM sessions s
        LEFT JOIN agents  a ON a.session_id = s.id
        LEFT JOIN messages m ON m.session_id = s.id
        LEFT JOIN tasks   t ON t.session_id = s.id
        GROUP BY s.id
        ORDER BY s.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`
  );

  const [total] = await db.select({ total: sql<number>`count(*)::int` }).from(sessionsTable);
  res.json({ sessions: rows.rows, total: total?.total ?? 0, limit, offset });
});

// ─── DELETE /api/admin/sessions/:id (destructive) ────────────────────────────
router.delete("/sessions/:id", requireConfirmation, async (req, res): Promise<void> => {
  const id = safeInt(req.params.id, 0);
  if (!id) { res.status(400).json({ error: "invalid id" }); return; }
  await db.execute(sql`DELETE FROM sessions WHERE id = ${id}`);
  req.log.warn({ adminAction: "delete_session", targetId: id }, "Admin deleted session");
  res.json({ ok: true, message: `Session ${id} deleted` });
});

// ─── GET /api/admin/requests ──────────────────────────────────────────────────
router.get("/requests", async (req, res): Promise<void> => {
  const limit = safeInt(req.query.limit, 100, 500);
  const offset = safeInt(req.query.offset, 0);
  const provider = String(req.query.provider ?? "").trim();
  const sessionId = safeInt(req.query.session, 0);

  const providerClause = provider ? sql` AND m.provider = ${provider}` : sql``;
  const sessionClause = sessionId ? sql` AND m.session_id = ${sessionId}` : sql``;

  const rows = await db.execute(
    sql`SELECT m.id, m.session_id, m.agent_id, m.role, m.provider, m.model,
               LEFT(m.content, 300) AS content_preview,
               m.agent_name, m.agent_role, m.created_at,
               s.goal AS session_goal
        FROM messages m
        LEFT JOIN sessions s ON s.id = m.session_id
        WHERE 1=1 ${providerClause} ${sessionClause}
        ORDER BY m.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`
  );

  const [total] = await db.select({ total: sql<number>`count(*)::int` }).from(messagesTable);
  const providers = await db.execute(
    sql`SELECT DISTINCT provider FROM messages WHERE provider IS NOT NULL ORDER BY provider`
  );

  res.json({
    requests: rows.rows,
    total: total?.total ?? 0,
    limit,
    offset,
    providers: (providers.rows as { provider: string }[]).map((r) => r.provider),
  });
});

// ─── GET /api/admin/errors ────────────────────────────────────────────────────
router.get("/errors", async (req, res): Promise<void> => {
  const limit = safeInt(req.query.limit, 100, 500);
  const offset = safeInt(req.query.offset, 0);

  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(
      sql`${auditLogsTable.eventType} IN ('adapter_fallback','circuit_open','circuit_half_open','error','payment_failed')`
    )
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [total] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLogsTable)
    .where(
      sql`${auditLogsTable.eventType} IN ('adapter_fallback','circuit_open','circuit_half_open','error','payment_failed')`
    );

  res.json({ errors: rows, total: total?.total ?? 0, limit, offset });
});

// ─── GET /api/admin/health ────────────────────────────────────────────────────
router.get("/health", async (req, res): Promise<void> => {
  const circuits = await db.select().from(circuitStateTable).orderBy(circuitStateTable.provider);

  const dbStart = Date.now();
  await db.execute(sql`SELECT 1`);
  const dbLatencyMs = Date.now() - dbStart;

  const envChecks: Record<string, boolean> = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    SESSION_SECRET: !!process.env.SESSION_SECRET,
    STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
    STRIPE_PUBLISHABLE_KEY: !!process.env.STRIPE_PUBLISHABLE_KEY,
    STRIPE_PRICE_ID: !!process.env.STRIPE_PRICE_ID,
    STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET,
    ADMIN_TOKEN: !!process.env.ADMIN_TOKEN,
    ARCHIBALD_BYPASS_TOKEN: !!process.env.ARCHIBALD_BYPASS_TOKEN,
    SMTP_HOST: !!process.env.SMTP_HOST,
    ACCESS_TOKEN: !!process.env.ACCESS_TOKEN,
  };

  res.json({
    uptime: process.uptime(),
    nodeVersion: process.version,
    env: process.env.NODE_ENV ?? "unknown",
    dbLatencyMs,
    circuits,
    envChecks,
    memory: process.memoryUsage(),
  });
});

// ─── POST /api/admin/circuit/:provider/reset (destructive) ───────────────────
router.post("/circuit/:provider/reset", requireConfirmation, async (req, res): Promise<void> => {
  const provider = String(req.params.provider ?? "").trim().toLowerCase();
  if (!provider) { res.status(400).json({ error: "provider required" }); return; }
  await db.execute(
    sql`UPDATE circuit_state SET consecutive_failures = 0, opened_at = NULL, updated_at = NOW()
        WHERE provider = ${provider}`
  );
  req.log.warn({ adminAction: "reset_circuit", provider }, "Admin reset circuit breaker");
  res.json({ ok: true, message: `Circuit breaker for ${provider} reset` });
});

// ─── GET /api/admin/abuse ─────────────────────────────────────────────────────
router.get("/abuse", async (req, res): Promise<void> => {
  const sessionRate = await db.execute(
    sql`SELECT date_trunc('hour', created_at) AS hour,
               COUNT(*)::int AS count
        FROM sessions
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY 1 ORDER BY 1 DESC LIMIT 168`
  );

  const spikeProviders = await db
    .select({
      provider: sql<string>`metadata->>'provider'`,
      count: sql<number>`count(*)::int`,
    })
    .from(auditLogsTable)
    .where(
      sql`event_type = 'adapter_fallback'
          AND metadata->>'provider' IS NOT NULL
          AND created_at >= NOW() - INTERVAL '1 hour'`
    )
    .groupBy(sql`metadata->>'provider'`)
    .orderBy(desc(sql`count(*)`));

  const heavySessions = await db.execute(
    sql`SELECT session_id, COUNT(*)::int AS msg_count
        FROM messages
        GROUP BY session_id
        ORDER BY msg_count DESC
        LIMIT 20`
  );

  const [failedPayments] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLogsTable)
    .where(
      sql`event_type = 'payment_failed'
          AND created_at >= NOW() - INTERVAL '30 days'`
    );

  const delinquentSubs = await db.execute(
    sql`SELECT id, email, status, created_at
        FROM subscribers
        WHERE status IN ('past_due','unpaid','payment_failed')
        ORDER BY created_at DESC LIMIT 50`
  );

  res.json({
    sessionCreationRate: sessionRate.rows,
    spikeProviders,
    heavySessions: heavySessions.rows,
    failedPayments: failedPayments?.total ?? 0,
    delinquentSubscribers: delinquentSubs.rows,
  });
});

// ─── GET /api/admin/logs ──────────────────────────────────────────────────────
router.get("/logs", async (req, res): Promise<void> => {
  const limit = safeInt(req.query.limit, 100, 500);
  const offset = safeInt(req.query.offset, 0);
  const eventType = String(req.query.type ?? "").trim();

  const whereClause = eventType ? sql`WHERE event_type = ${eventType}` : sql``;

  const rows = await db.execute(
    sql`SELECT id, session_id, event_type, description, metadata, created_at
        FROM audit_logs
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}`
  );

  const countRows = await db.execute(
    sql`SELECT COUNT(*)::int AS total FROM audit_logs ${whereClause}`
  );

  const types = await db.execute(
    sql`SELECT DISTINCT event_type FROM audit_logs ORDER BY event_type`
  );

  res.json({
    logs: rows.rows,
    total: (countRows.rows[0] as { total: number })?.total ?? 0,
    limit,
    offset,
    eventTypes: (types.rows as { event_type: string }[]).map((r) => r.event_type),
  });
});

// ─── GET /api/admin/config ────────────────────────────────────────────────────
router.get("/config", async (req, res): Promise<void> => {
  const rows = await db.select().from(settingsTable).orderBy(settingsTable.key);
  const masked = rows.map((r) => ({
    key: r.key,
    value: /pass|secret|password/i.test(r.key) ? "••••••••" : r.value,
    masked: /pass|secret|password/i.test(r.key),
  }));
  res.json({ config: masked });
});

// ─── PUT /api/admin/config (destructive: overwrites settings) ────────────────
router.put("/config", requireConfirmation, async (req, res): Promise<void> => {
  const updates = req.body as Record<string, string>;
  if (!updates || typeof updates !== "object") {
    res.status(400).json({ error: "body must be a key-value object" });
    return;
  }
  const entries = Object.entries(updates);
  if (entries.length === 0) {
    res.status(400).json({ error: "no updates provided" });
    return;
  }
  for (const [key, value] of entries) {
    await db.execute(
      sql`INSERT INTO settings (key, value, updated_at)
          VALUES (${key}, ${value}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`
    );
  }
  req.log.warn({ adminAction: "update_config", keys: entries.map(([k]) => k) }, "Admin updated settings");
  res.json({ ok: true, updated: entries.length });
});

export default router;
