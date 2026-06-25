import { Router, type IRouter } from "express";
import { runLaunchReadinessCheck, getLatestReport, getReport } from "../lib/launchReadiness";
import { requireAdmin } from "../middlewares/adminAuth";

const router: IRouter = Router();

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
