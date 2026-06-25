import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { runChaosTest, getChaosRun, listChaosRuns, type ChaosCategory } from "../lib/betaChaos";
import { requireAdmin } from "../middlewares/adminAuth";

const router: IRouter = Router();

const VALID_CATEGORIES: ChaosCategory[] = [
  "broken_repo",
  "missing_package_json",
  "bad_lockfile",
  "missing_env_vars",
  "failing_frontend_build",
  "failing_api_build",
  "invalid_stripe_config",
  "duplicate_webhook",
  "unsafe_uploaded_zip",
  "prompt_injection_readme",
  "browser_login_required",
  "deployment_provider_missing_credential",
  "deployment_provider_placeholder",
  "dns_invalid",
  "tls_invalid",
  "bypass_approval_attempt",
  "reveal_secrets_attempt",
  "mobile_layout_overflow",
  "console_errors",
  "production_url_down",
];

const RunBody = z.object({
  categories: z.array(z.enum(VALID_CATEGORIES as [ChaosCategory, ...ChaosCategory[]])).optional(),
});

// POST /api/beta-chaos/run
router.post("/beta-chaos/run", requireAdmin, (req, res): void => {
  const parsed = RunBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }

  try {
    const run = runChaosTest(parsed.data.categories);
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: "Chaos test failed", details: String(err) });
  }
});

// GET /api/beta-chaos/runs — list all runs
router.get("/beta-chaos/runs", requireAdmin, (_req, res): void => {
  res.json(listChaosRuns());
});

// GET /api/beta-chaos/runs/:id/report
router.get("/beta-chaos/runs/:id/report", requireAdmin, (req, res): void => {
  const run = getChaosRun(String(req.params.id ?? ""));
  if (!run) {
    res.status(404).json({ error: "Chaos run not found" });
    return;
  }
  res.json(run);
});

export default router;
