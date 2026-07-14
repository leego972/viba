import { Router, type IRouter } from "express";
import growthRouter from "./adminGrowth";
import { db, pool } from "@workspace/db";
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
// Queries the `users` table (email/password + OAuth + billing accounts).
// Supports optional ?email= partial-match filter.
router.get("/users", async (req, res): Promise<void> => {
  const emailSearch = String(req.query.email ?? "").trim().toLowerCase();
  const emailClause = emailSearch ? sql` AND LOWER(u.email) LIKE ${"%" + emailSearch + "%"}` : sql``;
  const rows = await db.execute(
    sql`SELECT u.id, u.email, u.name,
               u.subscription_status, u.credits_remaining, u.credits_period_end,
               u.stripe_customer_id, u.stripe_subscription_id,
               u.email_verified,
               u.google_id IS NOT NULL AS has_google,
               u.github_id IS NOT NULL AS has_github,
               u.created_at, u.updated_at
        FROM users u
        WHERE 1=1 ${emailClause}
        ORDER BY u.created_at DESC
        LIMIT 500`
  );
  res.json({ users: rows.rows });
});

// ─── GET /api/admin/users/:id/credits ────────────────────────────────────────
router.get("/users/:id/credits", async (req, res): Promise<void> => {
  const id = safeInt(req.params.id, 0);
  if (!id) { res.status(400).json({ error: "invalid id" }); return; }

  const userRows = await db.execute(
    sql`SELECT id, email, credits_remaining, credits_period_end FROM users WHERE id = ${id}`
  );
  if (!userRows.rows.length) { res.status(404).json({ error: "user not found" }); return; }

  const txnRows = await db.execute(
    sql`SELECT id, amount, balance_after, reason, session_id, created_at
        FROM credit_transactions WHERE user_id = ${id}
        ORDER BY created_at DESC LIMIT 200`
  );

  res.json({
    user: userRows.rows[0],
    transactions: txnRows.rows,
  });
});

// ─── POST /api/admin/users/:id/credits ───────────────────────────────────────
router.post("/users/:id/credits", requireConfirmation, async (req, res): Promise<void> => {
  const id = safeInt(req.params.id, 0);
  if (!id) { res.status(400).json({ error: "invalid id" }); return; }

  const body = req.body as { amount?: unknown; reason?: unknown };
  const amount = typeof body.amount === "number" ? Math.round(body.amount) : null;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";

  if (amount === null || !Number.isFinite(amount)) {
    res.status(400).json({ error: "amount (integer) required" });
    return;
  }
  if (!reason) {
    res.status(400).json({ error: "reason required" });
    return;
  }

  // Update credits and record transaction atomically
  const updated = await db.execute(
    sql`UPDATE users
        SET credits_remaining = GREATEST(0, credits_remaining + ${amount}),
            updated_at = NOW()
        WHERE id = ${id}
        RETURNING credits_remaining`
  );
  if (!updated.rows.length) { res.status(404).json({ error: "user not found" }); return; }

  const balanceAfter = (updated.rows[0] as { credits_remaining: number }).credits_remaining;
  await db.execute(
    sql`INSERT INTO credit_transactions (user_id, amount, balance_after, reason)
        VALUES (${id}, ${amount}, ${balanceAfter}, ${reason})`
  );

  req.log.warn(
    { adminAction: "adjust_credits", targetId: id, amount, reason, balanceAfter },
    "Admin adjusted user credits",
  );
  res.json({ ok: true, balanceAfter });
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

// ─── POST /api/admin/users/grant-pro ─────────────────────────────────────────
// Create or upsert a user with active subscription + credits (beta tester / gifted access).
// Body: { email, name?, credits?, note? }
router.post("/users/grant-pro", async (req, res): Promise<void> => {
  const body = req.body as { email?: unknown; name?: unknown; credits?: unknown; note?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "valid email required" });
    return;
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : null;
  const credits = typeof body.credits === "number" && body.credits > 0
    ? Math.round(body.credits)
    : 1000;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "admin grant-pro";

  const { rows } = await pool.query<{ id: number; email: string; subscription_status: string; credits_remaining: number }>(
    `INSERT INTO users (email, name, subscription_status, credits_remaining, email_verified, created_at, updated_at)
     VALUES ($1, $2, 'active', $3, true, NOW(), NOW())
     ON CONFLICT (email) DO UPDATE
       SET subscription_status = 'active',
           credits_remaining   = GREATEST(users.credits_remaining, $3),
           name                = COALESCE(EXCLUDED.name, users.name),
           email_verified      = true,
           updated_at          = NOW()
     RETURNING id, email, subscription_status, credits_remaining`,
    [email, name, credits],
  );
  const user = rows[0];
  if (!user) { res.status(500).json({ error: "upsert failed" }); return; }

  // Record a credit transaction for audit trail
  await pool.query(
    `INSERT INTO credit_transactions (user_id, amount, balance_after, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [user.id, credits, user.credits_remaining, note],
  ).catch(() => {});

  req.log.warn(
    { adminAction: "grant_pro", targetEmail: email, userId: user.id, credits, note },
    "Admin granted pro access",
  );
  res.json({ ok: true, user: { id: user.id, email: user.email, subscriptionStatus: user.subscription_status, creditsRemaining: user.credits_remaining }, note });
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

// ─── POST /api/admin/sessions/:id/abort (force-stop) ─────────────────────────
router.post("/sessions/:id/abort", requireConfirmation, async (req, res): Promise<void> => {
  const id = safeInt(req.params.id, 0);
  if (!id) { res.status(400).json({ error: "invalid id" }); return; }

  await db.execute(
    sql`UPDATE sessions SET status = 'stopped', updated_at = NOW() WHERE id = ${id}`
  );
  req.log.warn({ adminAction: "abort_session", targetId: id }, "Admin force-stopped session");
  res.json({ ok: true, message: `Session ${id} force-stopped` });
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
  const sessionIdFilter = safeInt(req.query.session, 0);

  // Build WHERE clause supporting both filters
  let whereClause;
  if (eventType && sessionIdFilter) {
    whereClause = sql`WHERE event_type = ${eventType} AND session_id = ${sessionIdFilter}`;
  } else if (eventType) {
    whereClause = sql`WHERE event_type = ${eventType}`;
  } else if (sessionIdFilter) {
    whereClause = sql`WHERE session_id = ${sessionIdFilter}`;
  } else {
    whereClause = sql``;
  }

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

// ─── GET /api/admin/credentials ──────────────────────────────────────────────
// Aggregate credential status for all users — metadata only, never raw values.
router.get("/credentials", async (_req, res): Promise<void> => {
  const { pool } = await import("@workspace/db");
  const { rows } = await pool.query<{
    user_id: number; provider: string; kind: string; label: string;
    status: string; last_used_at: string | null; updated_at: string | null; expired: boolean;
  }>(
    `SELECT user_id, provider, kind, label, status,
            last_used_at, updated_at,
            (expires_at IS NOT NULL AND expires_at < NOW()) AS expired
       FROM viba_credentials
      ORDER BY user_id ASC, provider ASC, kind ASC
      LIMIT 1000`,
  );
  res.json({
    credentials: rows,
    count: rows.length,
    rawValueReturned: false,
    note: "encrypted_value, iv, auth_tag are never included in admin responses.",
  });
});

// ─── Growth / advertising sub-router ─────────────────────────────────────────
router.use("/growth", growthRouter);

export default router;
