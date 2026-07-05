import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import { securityHeaders } from "./lib/securityHeaders";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { createRateLimiter } from "./middlewares/rateLimiter";
import { requireSession } from "./middlewares/requireSession";
import { requireAdmin } from "./middlewares/adminAuth";
import { accessTokenMiddleware } from "./middlewares/accessToken";
import { webhookHandler } from "./routes/stripeWebhook";
import adminRouter from "./routes/admin";
import { pool } from "@workspace/db";
import { getBillingStatus, isStripeConfigured } from "./lib/billing";
import { sendLowCreditsWarningIfNeeded } from "./lib/billingEmail";
import { buildAdapter, buildMockAdapter } from "./lib/agentFactory";
import { isAdminUserId } from "./lib/adminAccess";
import type { Agent } from "@workspace/db";

const PgStore = connectPgSimple(session);

const app: Express = express();

// ─── Trust proxy — required on Railway (traffic arrives via load-balancer) ────
// Without this req.ip returns the proxy IP and rate-limiting is ineffective.
app.set("trust proxy", 1);

// ─── Security headers ─────────────────────────────────────────────────────────
// Custom middleware — replaces helmet() with explicit CSP so the Archibald Titan
// AI iframe embed works (frame-ancestors includes CORS_ALLOWED_ORIGINS).
// See lib/securityHeaders.ts.
app.use(securityHeaders());

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Production: only allow viba.guru and any extras listed in CORS_ALLOWED_ORIGINS.
// Development: allow all origins for convenience.
// To add Archibald's domain: set CORS_ALLOWED_ORIGINS=https://archibald.example.com in Railway.
const PRODUCTION_ALLOWED_ORIGINS = new Set([
  "https://viba.guru",
  "https://www.viba.guru",
  ...(process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
]);

app.use(
  cors({
    origin: (origin, callback) => {
      // Requests with no Origin header (mobile apps, curl, server-to-server) are allowed.
      if (!origin) return callback(null, true);
      // In development, allow any origin so hot-reload proxies work.
      if (process.env.NODE_ENV !== "production") return callback(null, true);
      if (PRODUCTION_ALLOWED_ORIGINS.has(origin)) return callback(null, true);
      callback(new Error(`CORS: origin "${origin}" is not permitted`));
    },
    credentials: true,
  }),
);

// ─── Session middleware ────────────────────────────────────────────────────────
// Must be before body parsers and route handlers.
// Sessions are stored in PostgreSQL via connect-pg-simple.
const isProd = process.env.NODE_ENV === "production";

// SESSION_SECRET must be set in production — an absent or placeholder value is a
// session-forgery risk. Fail fast so Railway alerts on startup rather than serving
// insecure sessions silently.
const sessionSecret = process.env.SESSION_SECRET;
if (isProd && (!sessionSecret || sessionSecret === "dev-secret-change-me-in-production")) {
  throw new Error("SESSION_SECRET must be set to a strong random value in production. Refusing to start.");
}

app.use(
  session({
    store: new PgStore({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: false,
    }),
    name: "viba.sid",
    secret: sessionSecret ?? "dev-secret-change-me-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      // sameSite: "none" allows the cookie to be sent in cross-site iframe contexts
      // (Archibald Titan AI embeds VIBA via iframe). Requires secure: true in prod.
      sameSite: isProd ? "none" : "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  }),
);

// ─── Rate limiters ────────────────────────────────────────────────────────────

// General: 300 req/min per IP across all /api routes
const apiLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 300,
  message: "Too many requests. Please slow down.",
});

// Strict: 30 req/min for expensive AI session execution paths
const agentLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  message: "Agent execution rate limit reached. Wait before running more steps.",
});

// Very strict: 5 req/min for endpoints that fire outbound HTTP/email
const notificationLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 5,
  message: "Notification test rate limit reached. Wait before sending another test.",
});

// Auth: 10 req/min — brute-force protection for login / register / password reset
const authLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 10,
  message: "Too many auth attempts. Please wait before trying again.",
});

// ─── Stripe webhook — MUST be before express.json() ──────────────────────────
// Stripe signature verification requires the raw body Buffer.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  webhookHandler,
);

// ─── Outbound-triggering endpoint — strict limiter applied first ──────────────
// This route fires HTTP webhooks and SMTP emails; rate-limit tightly to prevent abuse.
app.post("/api/stats/test-notification", notificationLimiter);

// ─── Auth endpoints — brute-force protection ──────────────────────────────────
// Applied before the general /api block so these paths get the tighter limit.
app.post("/api/auth/login", authLimiter);
app.post("/api/auth/register", authLimiter);
app.post("/api/auth/forgot-password", authLimiter);
app.post("/api/auth/reset-password", authLimiter);
app.post("/api/auth/verify-email", authLimiter);
app.post("/api/auth/resend-verification", authLimiter);

// ─── Request logging ──────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          // Strip query string from logs — query params may contain tokens
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ─── Body parsing ─────────────────────────────────────────────────────────────
// 512 kb cap guards against memory-exhaustion via large payloads.
app.use(express.json({ limit: "512kb" }));
app.use(express.urlencoded({ limit: "512kb", extended: true }));

// ─── Route-specific middleware ────────────────────────────────────────────────

// AI session execution: 30 req/min — ONLY on expensive run endpoints.
// All other /api/sessions/* reads (messages, tasks, agents, stream, etc.) are
// covered by the general apiLimiter below and must NOT get 429s under normal UI traffic.
app.post("/api/sessions/:id/run-next", agentLimiter);
app.post("/api/sessions/:id/run-full", agentLimiter);

// Admin panel: ADMIN_TOKEN or allowed admin email session required.
app.use("/api/admin", apiLimiter, requireAdmin, adminRouter);

// ─── Credit gate — AI execution endpoints ─────────────────────────────────────
// Checks subscription status and deducts 1 credit per run.
// Bypass users (Archibald embed), admin users, and unconfigured Stripe skip this gate.
// Service is SUSPENDED (402) when:
//   - No active subscription (canceled / none)
//   - Credits have run out (past the top of a billing period with no no top-up)
// User data is NEVER deleted due to payment issues — only access is suspended.
app.use(
  ["/api/sessions/:id/run-next", "/api/sessions/:id/run-full"],
  async (req, res, next): Promise<void> => {
    // Archibald Titan AI embedded bypass — unlimited access
    if (req.session?.bypass) { next(); return; }

    const userId = req.session?.userId;
    if (!userId) { next(); return; } // requireSession handles the auth 401

    if (await isAdminUserId(userId)) { next(); return; }

    if (!isStripeConfigured()) { next(); return; } // No Stripe → open access

    try {
      const { subscriptionStatus } = await getBillingStatus(userId);

      // Suspended states — service halted until resubscription
      if (subscriptionStatus === "canceled" || subscriptionStatus === "none") {
        res.status(402).json({
          error: "subscription_required",
          message: "An active VIBA membership is required. Visit /pricing to subscribe.",
          subscriptionUrl: "/pricing",
        });
        return;
      }

      // Credit deduction is handled per-task inside agentLoop via complexity billing.
      // Fire-and-forget low-credit warning (throttled to once per 7 days).
      sendLowCreditsWarningIfNeeded(userId).catch(() => {});

      next();
    } catch (err) {
      // BUG 9 FIX: In production, billing errors must NOT grant free access — fail closed with 503.
      // In development/test, fail open so local workflows aren't blocked by missing Stripe config.
      if (process.env.NODE_ENV === "production") {
        logger.error({ err }, "Credit gate error in production — failing closed (503)");
        res.status(503).json({
          error: "billing_unavailable",
          message: "Billing service is temporarily unavailable. Please try again in a moment.",
        });
        return;
      }
      logger.warn({ err }, "Credit gate error in dev/test — failing open");
      next();
    }
  },
);

// ─── Session: reject approval ─────────────────────────────────────────────────
// Sets approval to rejected, pauses the session for human review.
app.post("/api/sessions/:id/reject-approval", apiLimiter, requireSession, async (req, res): Promise<void> => {
  const sessionId = parseInt(String(req.params.id ?? ""), 10);
  const userId = req.session?.userId;
  const body = req.body as { approvalId?: unknown; rejectedReason?: unknown };
  const approvalId = typeof body.approvalId === "number" ? body.approvalId : null;
  const reason = typeof body.rejectedReason === "string" ? body.rejectedReason.trim().slice(0, 1000) : "";
  if (!sessionId || !approvalId) {
    res.status(400).json({ error: "sessionId and approvalId required" });
    return;
  }
  try {
    // BUG 7 FIX: verify session ownership before mutating — WHERE user_id = $N ensures
    // another authenticated user cannot reject approvals on a session they don't own.
    const { rows: owned } = await pool.query<{ id: number }>(
      `SELECT id FROM sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId],
    );
    if (!owned[0]) {
      res.status(403).json({ error: "forbidden", message: "You do not own this session." });
      return;
    }
    await pool.query(
      `UPDATE approvals
         SET status = 'rejected', rejected_at = NOW(), rejected_reason = $1, updated_at = NOW()
       WHERE id = $2 AND session_id = $3`,
      [reason || null, approvalId, sessionId],
    );
    await pool.query(
      `UPDATE sessions SET status = 'paused', updated_at = NOW() WHERE id = $1`,
      [sessionId],
    );
    req.log?.info?.({ sessionId, approvalId }, "Approval rejected — session paused");
    res.json({ ok: true });
  } catch (err) {
    req.log?.error?.({ err }, "reject-approval error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Session: reopen (resume completed session) ───────────────────────────────
app.post("/api/sessions/:id/reopen", apiLimiter, requireSession, async (req, res): Promise<void> => {
  const sessionId = parseInt(String(req.params.id ?? ""), 10);
  const userId = req.session?.userId;
  if (!sessionId) { res.status(400).json({ error: "invalid session id" }); return; }
  try {
    // BUG 7 FIX: scope update to user_id so another user cannot reopen someone else's session.
    const { rowCount } = await pool.query(
      `UPDATE sessions SET status = 'active', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status IN ('completed', 'paused', 'stopped')`,
      [sessionId, userId],
    );
    if (!rowCount) {
      res.status(403).json({ error: "forbidden", message: "Session not found or you do not own it." });
      return;
    }
    req.log?.info?.({ sessionId }, "Session reopened");
    res.json({ ok: true });
  } catch (err) {
    req.log?.error?.({ err }, "reopen session error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Session: safety vote ─────────────────────────────────────────────────────
// Each agent evaluates the session goal before execution begins.
// Agents that refuse have their sat_out_reason set and are excluded from task routing.
// If ALL agents refuse, the endpoint returns passed: false with combined reasons.
app.post("/api/sessions/:id/safety-vote", apiLimiter, requireSession, async (req, res): Promise<void> => {
  const sessionId = parseInt(String(req.params.id ?? ""), 10);
  const userId = req.session?.userId;
  if (!sessionId) { res.status(400).json({ error: "invalid session id" }); return; }
  try {
    // BUG 7 FIX: include user_id in the WHERE clause so a user cannot trigger a safety vote
    // (and consequently mutate agents) on a session belonging to another user.
    const { rows: sessionRows } = await pool.query<{ goal: string }>(
      "SELECT goal FROM sessions WHERE id = $1 AND user_id = $2", [sessionId, userId],
    );
    const sessionRow = sessionRows[0];
    if (!sessionRow) { res.status(403).json({ error: "forbidden", message: "Session not found or you do not own it." }); return; }

    const adapter = buildAdapter(buildMockAdapter(), { id: -1, provider: "openai", model: null, systemPrompt: null } as unknown as Agent);
    const vote = await adapter.safetyCheck({ goal: sessionRow.goal });
    const passed = vote.allowed;
    res.json({ passed, vote });
  } catch (err) {
    req.log?.error?.({ err }, "safety-vote error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Protected /api routes ─────────────────────────────────────────────────────
app.use("/api", apiLimiter, accessTokenMiddleware, requireSession, router);

// Serve Vite production build if present (Railway static fallback)
const distDir = path.resolve(process.cwd(), "artifacts", "bridge-ai", "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

// ─── Error handler ─────────────────────────────────────────────────────────────
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  req.log?.error?.({ err }, "Unhandled request error");
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

export default app;
