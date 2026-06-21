import express, { type Express, type ErrorRequestHandler, type Request } from "express";
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
import { webhookHandler } from "./routes/stripeWebhook";
import adminRouter from "./routes/admin";
import adminMaintenanceRouter from "./routes/adminMaintenance";
import { pool } from "@workspace/db";
import { getBillingStatus, deductCredits, isStripeConfigured } from "./lib/billing";
import { sendCreditsExhaustedReminder, sendLowCreditsWarningIfNeeded } from "./lib/billingEmail";
import { buildAdapter, buildMockAdapter } from "./lib/agentFactory";
import { startWeeklyMaintenanceScheduler } from "./lib/maintenanceScheduler";
import { assertSelfRepo, configuredSelfRepo } from "./lib/selfRepoGuard";
import type { Agent } from "@workspace/db";

const PgStore = connectPgSimple(session);
const app: Express = express();

app.set("trust proxy", 1);
app.use(securityHeaders());

const PRODUCTION_ALLOWED_ORIGINS = new Set([
  "https://viba.guru",
  ...(process.env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
]);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV !== "production") return callback(null, true);
    if (PRODUCTION_ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    callback(new Error(`CORS: origin "${origin}" is not permitted`));
  },
  credentials: true,
}));

const isProd = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;
if (isProd && (!sessionSecret || sessionSecret === "dev-secret-change-me-in-production")) {
  throw new Error("SESSION_SECRET must be set to a strong random value in production. Refusing to start.");
}

app.use(session({
  store: new PgStore({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  name: "viba.sid",
  secret: sessionSecret ?? "dev-secret-change-me-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: isProd, sameSite: isProd ? "none" : "lax", maxAge: 30 * 24 * 60 * 60 * 1000 },
}));

const apiLimiter = createRateLimiter({ windowMs: 60_000, max: 300, message: "Too many requests. Please slow down." });
const agentLimiter = createRateLimiter({ windowMs: 60_000, max: 30, message: "Agent execution rate limit reached. Wait before running more steps." });
const notificationLimiter = createRateLimiter({ windowMs: 60_000, max: 5, message: "Notification test rate limit reached. Wait before sending another test." });
const authLimiter = createRateLimiter({ windowMs: 60_000, max: 10, message: "Too many auth attempts. Please wait before trying again." });

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), webhookHandler);
app.post("/api/stats/test-notification", notificationLimiter);
app.post("/api/auth/login", authLimiter);
app.post("/api/auth/register", authLimiter);
app.post("/api/auth/forgot-password", authLimiter);
app.post("/api/auth/reset-password", authLimiter);
app.post("/api/auth/verify-email", authLimiter);

app.use(pinoHttp({
  logger,
  serializers: {
    req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
    res(res) { return { statusCode: res.statusCode }; },
  },
}));

app.use(express.json({ limit: "512kb" }));
app.use(express.urlencoded({ limit: "512kb", extended: true }));

app.post("/api/sessions/:id/run-next", agentLimiter);
app.post("/api/sessions/:id/run-full", agentLimiter);

function hasInternalMaintenanceToken(req: Request): boolean {
  const configured = process.env.VIBA_INTERNAL_MAINTENANCE_TOKEN;
  return Boolean(configured && req.headers["x-viba-internal-maintenance"] === configured);
}

function isInternalMaintenanceRequest(req: Request): boolean {
  return hasInternalMaintenanceToken(req) && req.path === "/self-repair/auto-fix";
}

function restrictToConfiguredSelfRepo(req: Request, res: express.Response, next: express.NextFunction): void {
  try {
    const body = (req.body ?? {}) as { repoFullName?: unknown };
    if (typeof body.repoFullName === "string" && body.repoFullName.trim()) {
      assertSelfRepo(body.repoFullName);
    } else if (req.method !== "GET") {
      body.repoFullName = configuredSelfRepo();
      req.body = body;
    }
    next();
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "Self-repo access denied" });
  }
}

app.use("/api/admin/maintenance", apiLimiter, requireAdmin, adminMaintenanceRouter);
app.use("/api/admin", apiLimiter, requireAdmin, adminRouter);
app.use("/api/self-repair", apiLimiter, restrictToConfiguredSelfRepo, (req, res, next) => {
  if (hasInternalMaintenanceToken(req)) { next(); return; }
  requireAdmin(req, res, next);
});
app.use("/api/self-audit", apiLimiter, restrictToConfiguredSelfRepo, requireAdmin);

app.use(["/api/sessions/:id/run-next", "/api/sessions/:id/run-full"], async (req, res, next): Promise<void> => {
  if (req.session?.bypass) { next(); return; }
  const userId = req.session?.userId;
  if (!userId) { next(); return; }
  if (!isStripeConfigured()) { next(); return; }
  try {
    const { subscriptionStatus } = await getBillingStatus(userId);
    if (subscriptionStatus === "canceled" || subscriptionStatus === "none") {
      res.status(402).json({ error: "subscription_required", message: "An active VIBA membership is required. Visit /pricing to subscribe.", subscriptionUrl: "/pricing" });
      return;
    }
    const sessionIdForBilling = parseInt(String(req.params.id ?? ""), 10) || undefined;
    const deducted = await deductCredits(userId, 1, sessionIdForBilling);
    if (!deducted) {
      sendCreditsExhaustedReminder(userId).catch(() => {});
      res.status(402).json({ error: "out_of_credits", message: "You've used all your credits for this period. Top up to continue.", topUpUrl: "/billing" });
      return;
    }
    sendLowCreditsWarningIfNeeded(userId).catch(() => {});
    next();
  } catch (err) {
    logger.error({ err }, "Credit gate error — failing open to avoid blocking users");
    next();
  }
});

app.post("/api/sessions/:id/reject-approval", apiLimiter, requireSession, async (req, res): Promise<void> => {
  const sessionId = parseInt(String(req.params.id ?? ""), 10);
  const body = req.body as { approvalId?: unknown; rejectedReason?: unknown };
  const approvalId = typeof body.approvalId === "number" ? body.approvalId : null;
  const reason = typeof body.rejectedReason === "string" ? body.rejectedReason.trim().slice(0, 1000) : "";
  if (!sessionId || !approvalId) { res.status(400).json({ error: "sessionId and approvalId required" }); return; }
  try {
    await pool.query(`UPDATE approvals SET status = 'rejected', rejected_at = NOW(), rejected_reason = $1, updated_at = NOW() WHERE id = $2 AND session_id = $3`, [reason || null, approvalId, sessionId]);
    await pool.query(`UPDATE sessions SET status = 'paused', updated_at = NOW() WHERE id = $1`, [sessionId]);
    req.log?.info?.({ sessionId, approvalId }, "Approval rejected — session paused");
    res.json({ ok: true });
  } catch (err) {
    req.log?.error?.({ err }, "reject-approval error");
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/sessions/:id/reopen", apiLimiter, requireSession, async (req, res): Promise<void> => {
  const sessionId = parseInt(String(req.params.id ?? ""), 10);
  if (!sessionId) { res.status(400).json({ error: "invalid session id" }); return; }
  try {
    await pool.query(`UPDATE sessions SET status = 'active', updated_at = NOW() WHERE id = $1 AND status IN ('completed', 'paused', 'stopped')`, [sessionId]);
    req.log?.info?.({ sessionId }, "Session reopened");
    res.json({ ok: true });
  } catch (err) {
    req.log?.error?.({ err }, "reopen session error");
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/sessions/:id/safety-vote", apiLimiter, requireSession, async (req, res): Promise<void> => {
  const sessionId = parseInt(String(req.params.id ?? ""), 10);
  if (!sessionId) { res.status(400).json({ error: "invalid session id" }); return; }
  try {
    const { rows: sessionRows } = await pool.query<{ goal: string }>("SELECT goal FROM sessions WHERE id = $1", [sessionId]);
    const sessionRow = sessionRows[0];
    if (!sessionRow) { res.status(404).json({ error: "session not found" }); return; }
    const { rows: agentRows } = await pool.query<{ id: number; name: string; role: string; provider: string; can_use_tools: boolean; is_mock: boolean }>("SELECT id, name, role, provider, can_use_tools, is_mock FROM agents WHERE session_id = $1", [sessionId]);
    if (!agentRows.length) { res.status(404).json({ error: "no agents found for this session" }); return; }
    const goal = sessionRow.goal;
    const allPeers = agentRows.map((a) => ({ name: a.name, role: a.role }));
    const voteResults = await Promise.all(agentRows.map(async (row) => {
      try {
        const agentRecord = { id: row.id, name: row.name, role: row.role, provider: row.provider, canUseTools: row.can_use_tools, isMock: row.is_mock, capabilities: [], sessionId, lastUsedModel: null, satOutReason: null, createdAt: new Date() } as unknown as Agent;
        const adapter = row.is_mock ? buildMockAdapter(agentRecord) : await buildAdapter(agentRecord);
        const peers = allPeers.filter((p) => p.name !== row.name);
        const vote = await adapter.evaluateTask(goal, peers);
        return { agentId: row.id, agentName: row.name, accepted: vote.accepted, reason: vote.reason };
      } catch (err) {
        req.log?.warn?.({ err, agentId: row.id }, "safety-vote evaluateTask failed — defaulting to accept");
        return { agentId: row.id, agentName: row.name, accepted: true };
      }
    }));
    await pool.query("UPDATE agents SET sat_out_reason = NULL WHERE session_id = $1", [sessionId]);
    const refusers = voteResults.filter((v) => !v.accepted);
    if (refusers.length > 0) await Promise.all(refusers.map((v) => pool.query("UPDATE agents SET sat_out_reason = $1 WHERE id = $2", [v.reason ?? "Declined to participate in this session", v.agentId])));
    const allRefused = refusers.length === agentRows.length;
    const declineReason = allRefused ? refusers.map((v) => `• ${v.agentName}: ${v.reason ?? "Declined to participate"}`).join("\n") : undefined;
    req.log?.info?.({ sessionId, accepted: voteResults.filter((v) => v.accepted).length, refused: refusers.length }, "safety-vote complete");
    res.json({ passed: !allRefused, votes: voteResults, declineReason });
  } catch (err) {
    req.log?.error?.({ err }, "safety-vote error");
    res.status(500).json({ error: "Internal server error" });
  }
});

const AUTH_EXEMPT_PATHS = new Set(["/auth/config", "/auth/verify-bypass", "/auth/login", "/auth/register", "/auth/logout", "/auth/me", "/auth/google", "/auth/google/callback", "/auth/github", "/auth/github/callback", "/auth/forgot-password", "/auth/reset-password", "/auth/verify-email", "/stripe/config", "/stripe/checkout", "/stripe/subscription", "/stripe/portal", "/billing/plans", "/stats", "/healthz"]);

app.use("/api", apiLimiter, (req, res, next) => {
  if (AUTH_EXEMPT_PATHS.has(req.path) || isInternalMaintenanceRequest(req)) { next(); return; }
  requireSession(req, res, next);
}, router);

if (process.env.NODE_ENV === "production") {
  const frontendDist = path.resolve(process.cwd(), "artifacts/bridge-ai/dist/public");
  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get("/{*splat}", (_req, res) => { res.sendFile(path.join(frontendDist, "index.html")); });
  }
}

import("./lib/sentry").then(({ Sentry }) => { Sentry.setupExpressErrorHandler(app); }).catch(() => {});

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  req.log?.error?.({ err }, "Unhandled route error");
  const isDev = process.env.NODE_ENV !== "production";
  res.status(500).json({ error: "Internal server error", ...(isDev && err instanceof Error ? { detail: err.message } : {}) });
};

app.use(errorHandler);
startWeeklyMaintenanceScheduler();

export default app;
