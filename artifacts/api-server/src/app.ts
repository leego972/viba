import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { createRateLimiter } from "./middlewares/rateLimiter";
import { accessTokenMiddleware } from "./middlewares/accessToken";
import { requireAdmin } from "./middlewares/adminAuth";
import { webhookHandler } from "./routes/stripeWebhook";
import adminRouter from "./routes/admin";

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

// ─── Exempt paths — bypass ACCESS_TOKEN gate ─────────────────────────────────
// These paths must be reachable before the user has a token (bootstrap + subscription flow).
const AUTH_EXEMPT_PATHS = new Set([
  "/auth/config",
  "/auth/verify",
  "/auth/verify-bypass",
  "/stripe/config",
  "/stripe/checkout",
  "/stripe/subscription",
  "/stripe/portal",
  "/healthz",
]);

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

// AI session execution: 30 req/min
app.use("/api/sessions", agentLimiter);

// Admin panel: ADMIN_TOKEN required — completely separate from ACCESS_TOKEN
app.use("/api/admin", apiLimiter, requireAdmin, adminRouter);

// All other /api routes: general rate limit + optional ACCESS_TOKEN gate
app.use(
  "/api",
  apiLimiter,
  (req, res, next) => {
    if (AUTH_EXEMPT_PATHS.has(req.path)) { next(); return; }
    accessTokenMiddleware(req, res, next);
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
