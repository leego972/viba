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
import { buildMockAdapter } from "./lib/agentFactory";
import { isAdminUserId } from "./lib/adminAccess";
import type { Agent } from "@workspace/db";
import { generateLlmsTxt, generateLlmsFullTxt, getPublicPages, generateStructuredData } from "./engines/seoEngine";

const PgStore = connectPgSimple(session);
const app: Express = express();
app.set("trust proxy", 1);
app.use(securityHeaders());

const PRODUCTION_ALLOWED_ORIGINS = new Set([
  "https://viba.guru",
  "https://www.viba.guru",
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
  store: new PgStore({ pool, tableName: "user_sessions", createTableIfMissing: false }),
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
app.post("/api/auth/resend-verification", authLimiter);

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
app.use("/api/admin", apiLimiter, requireAdmin, adminRouter);

app.use(["/api/sessions/:id/run-next", "/api/sessions/:id/run-full"], async (req, res, next): Promise<void> => {
  if (req.session?.bypass) { next(); return; }
  const userId = req.session?.userId;
  if (!userId) { next(); return; }
  if (await isAdminUserId(userId)) { next(); return; }
  if (!isStripeConfigured()) { next(); return; }

  try {
    const { subscriptionStatus } = await getBillingStatus(userId);
    if (subscriptionStatus === "canceled" || subscriptionStatus === "none") {
      res.status(402).json({ error: "subscription_required", message: "An active VIBA membership is required. Visit /pricing to subscribe.", subscriptionUrl: "/pricing" });
      return;
    }
    sendLowCreditsWarningIfNeeded(userId).catch(() => {});
    next();
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      logger.error({ err }, "Credit gate error in production — failing closed (503)");
      res.status(503).json({ error: "billing_unavailable", message: "Billing service is temporarily unavailable. Please try again in a moment." });
      return;
    }
    logger.warn({ err }, "Credit gate error in dev/test — failing open");
    next();
  }
});

app.post("/api/sessions/:id/reject-approval", apiLimiter, requireSession, async (req, res): Promise<void> => {
  const sessionId = parseInt(String(req.params.id ?? ""), 10);
  const userId = req.session?.userId;
  const body = req.body as { approvalId?: unknown; rejectedReason?: unknown };
  const approvalId = typeof body.approvalId === "number" ? body.approvalId : null;
  const reason = typeof body.rejectedReason === "string" ? body.rejectedReason.trim().slice(0, 1000) : "";
  if (!sessionId || !approvalId) { res.status(400).json({ error: "sessionId and approvalId required" }); return; }
  try {
    const { rows: owned } = await pool.query<{ id: number }>(`SELECT id FROM sessions WHERE id = $1 AND user_id = $2`, [sessionId, userId]);
    if (!owned[0]) { res.status(403).json({ error: "forbidden", message: "You do not own this session." }); return; }
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
  const userId = req.session?.userId;
  if (!sessionId) { res.status(400).json({ error: "invalid session id" }); return; }
  try {
    const { rowCount } = await pool.query(`UPDATE sessions SET status = 'active', updated_at = NOW() WHERE id = $1 AND user_id = $2 AND status IN ('completed', 'paused', 'stopped')`, [sessionId, userId]);
    if (!rowCount) { res.status(403).json({ error: "forbidden", message: "Session not found or you do not own it." }); return; }
    req.log?.info?.({ sessionId }, "Session reopened");
    res.json({ ok: true });
  } catch (err) {
    req.log?.error?.({ err }, "reopen session error");
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/sessions/:id/safety-vote", apiLimiter, requireSession, async (req, res): Promise<void> => {
  const sessionId = parseInt(String(req.params.id ?? ""), 10);
  const userId = req.session?.userId;
  if (!sessionId) { res.status(400).json({ error: "invalid session id" }); return; }
  try {
    const { rows: sessionRows } = await pool.query<{ goal: string }>("SELECT goal FROM sessions WHERE id = $1 AND user_id = $2", [sessionId, userId]);
    const sessionRow = sessionRows[0];
    if (!sessionRow) { res.status(403).json({ error: "forbidden", message: "Session not found or you do not own it." }); return; }
    const safetyAgent = { id: -1, provider: "openai", name: "VIBA Safety", role: "Safety Reviewer", canUseTools: false } as unknown as Agent;
    const adapter = buildMockAdapter(safetyAgent);
    const vote = await adapter.evaluateTask(sessionRow.goal, []);
    res.json({ passed: vote.accepted, vote });
  } catch (err) {
    req.log?.error?.({ err }, "safety-vote error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Public SEO / crawler routes (no auth required) ───────────────────────────

const SITE_URL = process.env["PUBLIC_SITE_URL"] ?? "https://viba.guru";

app.get("/robots.txt", (_req, res) => {
  res.setHeader("Content-Type", "text/plain");
  res.send([
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /admin",
    "",
    `Sitemap: ${SITE_URL}/sitemap.xml`,
  ].join("\n"));
});

app.get("/sitemap.xml", (_req, res) => {
  const pages = getPublicPages();
  const now = new Date().toISOString().split("T")[0];
  const urls = [
    { loc: SITE_URL, priority: "1.0", changefreq: "weekly" },
    { loc: `${SITE_URL}/pricing`, priority: "0.9", changefreq: "monthly" },
    { loc: `${SITE_URL}/signup`, priority: "0.8", changefreq: "monthly" },
    { loc: `${SITE_URL}/login`, priority: "0.6", changefreq: "yearly" },
    ...pages
      .filter(p => !["/", "/pricing"].includes(p.path))
      .map(p => ({ loc: `${SITE_URL}${p.path}`, priority: "0.7", changefreq: "weekly" })),
  ];
  const urlEntries = urls.map(u =>
    `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
  ).join("\n");
  res.setHeader("Content-Type", "application/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>`);
});

app.get("/llms.txt", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(generateLlmsTxt());
});

app.get("/llms-full.txt", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(generateLlmsFullTxt());
});

app.get("/structured-data.json", (_req, res) => {
  res.json(generateStructuredData());
});

// ── Auth-gated API routes ─────────────────────────────────────────────────────

app.use("/api", apiLimiter, accessTokenMiddleware, requireSession, router);

const distDir = path.resolve(process.cwd(), "artifacts", "bridge-ai", "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => { res.sendFile(path.join(distDir, "index.html")); });
}

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  req.log?.error?.({ err }, "Unhandled request error");
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

export default app;
