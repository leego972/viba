import { Router, type IRouter } from "express";
import { runEvaluation, getEvalRun, listEvalRuns } from "../lib/agentEvaluation";
import { requireAdmin } from "../middlewares/adminAuth";

const router: IRouter = Router();

// POST /api/agent-eval/run — trigger a full agent evaluation
router.post("/agent-eval/run", requireAdmin, (_req, res): void => {
  try {
    const run = runEvaluation();
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: "Evaluation failed", details: String(err) });
  }
});

// GET /api/agent-eval/runs — list all evaluation runs
router.get("/agent-eval/runs", requireAdmin, (_req, res): void => {
  res.json(listEvalRuns());
});

// GET /api/agent-eval/runs/:id — get a specific run
router.get("/agent-eval/runs/:id", requireAdmin, (req, res): void => {
  const run = getEvalRun(String(req.params.id ?? ""));
  if (!run) {
    res.status(404).json({ error: "Eval run not found" });
    return;
  }
  res.json(run);
});

export default router;
