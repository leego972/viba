import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
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
import { webhookHandler } from "./routes/stripeWebhook";
import adminRouter from "./routes/admin";
import { pool } from "@workspace/db";
import { getBillingStatus, deductCredits, isStripeConfigured } from "./lib/billing";
import { sendCreditsExhaustedReminder } from "./lib/billingEmail";

const PgStore = connectPgSimple(session);

const app: Express = express();

// ─── Trust proxy — required on Railway (traffic arrives via load-balancer) ────
// Without this req.ip returns the proxy IP and rate-limiting is ineffective.
app.set("trust proxy", 1);

// ─── Security headers (helmet) ────────────────────────────────────────────────
// contentSecurityPolicy: false — API returns JSON; static-file CSP handled separately.
// crossOriginEmbedderPolicy: false — VIBA is embedded via iframe in Archibald Titan AI.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Production: only allow viba.guru and any extras listed in CORS_ALLOWED_ORIGINS.
// Development: allow all origins for convenience.
// To add Archibald's domain: set CORS_ALLOWED_ORIGINS=https://archibald.example.com in Railway.
const PRODUCTION_ALLOWED_ORIGINS = new Set([
  "https://viba.guru",
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
app.use(
  session({
    store: new PgStore({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
    }),
    name: "viba.sid",
    secret: process.env.SESSION_SECRET ?? "dev-secret-change-me-in-production",
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

// Admin panel: ADMIN_TOKEN required — completely separate from session auth
app.use("/api/admin", apiLimiter, requireAdmin, adminRouter);

// ─── Credit gate — AI execution endpoints ─────────────────────────────────────
// Checks subscription status and deducts 1 credit per run.
// Bypass users (Archibald embed) and unconfigured Stripe skip this gate.
// Service is SUSPENDED (402) when:
//   - No active subscription (canceled / none)
//   - Credits have run out (past the top of a billing period with no top-up)
// User data is NEVER deleted due to payment issues — only access is suspended.
app.use(
  ["/api/sessions/:id/run-next", "/api/sessions/:id/run-full"],
  async (req, res, next): Promise<void> => {
    // Archibald Titan AI embedded bypass — unlimited access
    if (req.session?.bypass) { next(); return; }

    const userId = req.session?.userId;
    if (!userId) { next(); return; } // requireSession handles the auth 401

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

      // Atomically deduct 1 credit — returns false when balance is already 0
      const deducted = await deductCredits(userId, 1);
      if (!deducted) {
        // Fire-and-forget email reminder (throttled to once per 24 h)
        sendCreditsExhaustedReminder(userId).catch(() => {});
        res.status(402).json({
          error: "out_of_credits",
          message: "You've used all your credits for this period. Top up to continue.",
          topUpUrl: "/billing",
        });
        return;
      }

      next();
    } catch (err) {
      logger.error({ err }, "Credit gate error — failing open to avoid blocking users");
      next(); // Fail open — billing errors must not block legitimate users
    }
  },
);

// ─── Auth-exempt paths — no session required ──────────────────────────────────
// These paths must be reachable before the user has authenticated:
// login / register / oauth flows, stripe checkout, bypass, healthcheck.
const AUTH_EXEMPT_PATHS = new Set([
  "/auth/config",
  "/auth/verify-bypass",
  "/auth/login",
  "/auth/register",
  "/auth/logout",
  "/auth/me",
  "/auth/google",
  "/auth/google/callback",
  "/auth/github",
  "/auth/github/callback",
  "/stripe/config",
  "/stripe/checkout",
  "/stripe/subscription",
  "/stripe/portal",
  "/billing/plans", // Public — pricing page reads this without auth
  "/healthz",
]);

// All other /api routes: general rate limit + session gate
app.use(
  "/api",
  apiLimiter,
  (req, res, next) => {
    if (AUTH_EXEMPT_PATHS.has(req.path)) { next(); return; }
    requireSession(req, res, next);
  },
  router,
);

// ─── Static frontend (production only) ───────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  const frontendDist = path.resolve(
    process.cwd(),
    "artifacts/bridge-ai/dist/public",
  );
  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  }
}

// ─── Global error handler ─────────────────────────────────────────────────────
// Express 5 forwards async errors here automatically.
// Never expose stack traces or internal details in production.
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  req.log?.error?.({ err }, "Unhandled route error");
  const isDev = process.env.NODE_ENV !== "production";
  res.status(500).json({
    error: "Internal server error",
    ...(isDev && err instanceof Error ? { detail: err.message } : {}),
  });
};

app.use(errorHandler);

export default app;
