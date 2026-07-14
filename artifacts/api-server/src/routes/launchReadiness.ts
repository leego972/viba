import { Router, type IRouter } from "express";
import { runLaunchReadinessCheck, getLatestReport, getReport } from "../lib/launchReadiness";
import { requireAdmin } from "../middlewares/adminAuth";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ─── Public env-var readiness check (no admin required) ──────────────────────
const REQUIRED_PROD_VARS = ["DATABASE_URL", "SESSION_SECRET", "NODE_ENV"] as const;
const OPTIONAL_BILLING_VARS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const;
const OPTIONAL_PROVIDER_VARS = ["GITHUB_TOKEN", "GROQ_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"] as const;
const OPTIONAL_DEPLOY_VARS = ["PUBLIC_ORIGIN", "VIBA_PUBLIC_URL", "CORS_ALLOWED_ORIGINS", "ADMIN_BOOTSTRAP_EMAIL", "ADMIN_BOOTSTRAP_PASSWORD"] as const;

const router: IRouter = Router();

// GET /api/launch-readiness — public env-var readiness snapshot (no secrets returned)
router.get("/launch-readiness", (_req, res): void => {
  type CheckEntry = { name: string; status: "passed" | "failed" | "warning"; details: string };
  const checks: CheckEntry[] = [];
  const unresolvedRisks: string[] = [];

  for (const v of REQUIRED_PROD_VARS) {
    const present = Boolean(process.env[v]);
    checks.push({ name: v, status: present ? "passed" : "failed", details: present ? "Set" : "MISSING — required for production" });
    if (!present) unresolvedRisks.push(`Required env var missing: ${v}`);
  }

  for (const v of OPTIONAL_DEPLOY_VARS) {
    const present = Boolean(process.env[v]);
    checks.push({ name: v, status: present ? "passed" : "warning", details: present ? "Set" : "Not set — recommended for production" });
    if (!present) unresolvedRisks.push(`Optional deploy var not set: ${v}`);
  }

  for (const v of OPTIONAL_BILLING_VARS) {
    const present = Boolean(process.env[v]);
    checks.push({ name: v, status: present ? "passed" : "warning", details: present ? "Set" : "Not set — billing features disabled" });
  }

  for (const v of OPTIONAL_PROVIDER_VARS) {
    const present = Boolean(process.env[v]);
    checks.push({ name: v, status: present ? "passed" : "warning", details: present ? "Set" : "Not set — this provider unavailable" });
  }

  const root = resolve(process.cwd(), "../..");
  const frontendBuilt = existsSync(resolve(root, "artifacts/bridge-ai/dist/public/index.html"));
  const apiBuilt = existsSync(resolve(process.cwd(), "dist/index.mjs"));
  checks.push({ name: "frontend_build", status: frontendBuilt ? "passed" : "warning", details: frontendBuilt ? "artifacts/bridge-ai/dist/public/index.html exists" : "Frontend not built — run pnpm --filter @workspace/bridge-ai run build" });
  checks.push({ name: "api_build", status: apiBuilt ? "passed" : "warning", details: apiBuilt ? "dist/index.mjs exists" : "API not built — run pnpm --filter @workspace/api-server run build" });

  const failed = checks.filter((c) => c.status === "failed").length;
  const warnings = checks.filter((c) => c.status === "warning").length;
  const overallStatus = failed > 0 ? "not_ready" : warnings > 0 ? "ready_with_warnings" : "ready";

  res.json({
    status: overallStatus,
    checks,
    unresolvedRisks,
    rawValuesReturned: false,
    generatedAt: new Date().toISOString(),
  });
});

// POST /api/launch-readiness/run — trigger a full launch readiness check
router.post("/launch-readiness/run", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const report = await runLaunchReadinessCheck();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: "Launch readiness check failed", details: String(err) });
  }
});

// GET /api/launch-readiness/latest — get the latest report without re-running
router.get("/launch-readiness/latest", requireAdmin, (_req, res): void => {
  const report = getLatestReport();
  if (!report) {
    res.status(404).json({ error: "No launch readiness report found — run POST /api/launch-readiness/run first" });
    return;
  }
  res.json(report);
});

// GET /api/launch-readiness/evidence-pack — same as latest; explicit evidence pack endpoint
router.get("/launch-readiness/evidence-pack", requireAdmin, (_req, res): void => {
  const report = getLatestReport();
  if (!report) {
    res.status(404).json({
      error: "No evidence pack available",
      hint: "Run POST /api/launch-readiness/run first to generate a report",
      rawValuesReturned: false,
    });
    return;
  }

  // Evidence pack never includes secrets
  const pack = {
    ...report,
    rawValuesReturned: false as const,
    _note: "This evidence pack does not contain any secret values, raw API keys, or credentials.",
  };

  res.json(pack);
});

// GET /api/launch-readiness/reports/:id
router.get("/launch-readiness/reports/:id", requireAdmin, (req, res): void => {
  const report = getReport(String(req.params.id ?? ""));
  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json(report);
});

export default router;
