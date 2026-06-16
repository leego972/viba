import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { createRateLimiter } from "./middlewares/rateLimiter";
import { accessTokenMiddleware } from "./middlewares/accessToken";
import { webhookHandler } from "./routes/stripeWebhook";

const app: Express = express();

// General API rate limiter — 300 req per minute per IP
const apiLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 300,
  message: "Too many requests. Please slow down.",
});

// Strict limiter for expensive AI agent execution endpoints
const agentLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  message: "Agent execution rate limit reached. Wait before running more steps.",
});

// ─── Stripe webhook — MUST be registered BEFORE express.json() ───────────────
// Stripe's signature verification requires the raw request body as a Buffer.
// Any body-parsing middleware running before this will break signature checks.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  webhookHandler,
);

// These paths bypass the ACCESS_TOKEN gate so the frontend can bootstrap
// before it has a token. Stripe paths are always public — they are part of
// the subscription flow that grants access.
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

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
// Limit request body size to guard against memory-exhaustion via large payloads
app.use(express.json({ limit: "512kb" }));
app.use(express.urlencoded({ limit: "512kb", extended: true }));

// Apply strict rate limit to AI session execution paths before the main router
app.use("/api/sessions", agentLimiter);

// General rate limit + optional ACCESS_TOKEN gate + main router
app.use(
  "/api",
  apiLimiter,
  (req, res, next) => {
    // Auth bootstrap and Stripe subscription-flow endpoints are always reachable
    if (AUTH_EXEMPT_PATHS.has(req.path)) { next(); return; }
    accessTokenMiddleware(req, res, next);
  },
  router,
);

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

// Global error handler — catches unhandled async errors from route handlers.
// Express identifies error handlers by the 4-argument signature; it must be
// registered after all routes and middleware.
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
