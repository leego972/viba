import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  getPolicy,
  updatePolicy,
  getCostControlStatus,
  canStartTask,
  registerTask,
  recordStep,
  recordToolInvocation,
  recordBrowserTime,
  pauseTaskForUserInput,
  resumeTask,
  completeTask,
} from "../lib/costControl";
import { requireAdmin } from "../middlewares/adminAuth";

const router: IRouter = Router();

// GET /api/cost-control/policy — current policy
router.get("/cost-control/policy", requireAdmin, (_req, res): void => {
  res.json(getPolicy());
});

// PATCH /api/cost-control/policy — update policy
const PolicyPatch = z.object({
  maxConcurrentTasksPerUser: z.number().int().min(1).max(20).optional(),
  maxAgentStepsPerTask: z.number().int().min(10).max(5000).optional(),
  maxToolInvocationsPerTask: z.number().int().min(10).max(2000).optional(),
  maxBrowserMinutesPerTask: z.number().min(1).max(180).optional(),
  maxRetriesPerTask: z.number().int().min(0).max(50).optional(),
  maxSafeBuildRunsPerTask: z.number().int().min(1).max(50).optional(),
  groqDefaultDailyMessages: z.number().int().min(1).max(10000).optional(),
  runawayLoopThresholdSteps: z.number().int().min(10).max(500).optional(),
  stuckTaskTimeoutMs: z.number().int().min(30000).max(3600000).optional(),
  queueMaxDepthPerUser: z.number().int().min(1).max(100).optional(),
});

router.patch("/cost-control/policy", requireAdmin, (req, res): void => {
  const parsed = PolicyPatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid policy patch", details: parsed.error.issues });
    return;
  }
  const updated = updatePolicy(parsed.data);
  res.json(updated);
});

// GET /api/cost-control/status — runtime status
router.get("/cost-control/status", requireAdmin, (_req, res): void => {
  res.json(getCostControlStatus());
});

// POST /api/cost-control/tasks/:taskId/can-start
router.post("/cost-control/can-start", (req, res): void => {
  const userId = Number(req.body?.userId);
  if (!userId || isNaN(userId)) {
    res.status(400).json({ error: "userId required" });
    return;
  }
  res.json(canStartTask(userId));
});

// POST /api/cost-control/tasks/:taskId/register
router.post("/cost-control/tasks/:taskId/register", (req, res): void => {
  const taskId = String(req.params.taskId ?? "");
  const userId = Number(req.body?.userId);
  const provider = typeof req.body?.provider === "string" ? req.body.provider : undefined;
  const isByok = req.body?.isByok === true;

  if (!taskId || !userId || isNaN(userId)) {
    res.status(400).json({ error: "taskId and userId required" });
    return;
  }

  const state = registerTask(taskId, userId, provider, isByok);
  res.json(state);
});

// POST /api/cost-control/tasks/:taskId/step
router.post("/cost-control/tasks/:taskId/step", (req, res): void => {
  const taskId = String(req.params.taskId ?? "");
  res.json(recordStep(taskId));
});

// POST /api/cost-control/tasks/:taskId/tool
router.post("/cost-control/tasks/:taskId/tool", (req, res): void => {
  const taskId = String(req.params.taskId ?? "");
  res.json(recordToolInvocation(taskId));
});

// POST /api/cost-control/tasks/:taskId/browser-time
router.post("/cost-control/tasks/:taskId/browser-time", (req, res): void => {
  const taskId = String(req.params.taskId ?? "");
  const minutes = Number(req.body?.minutes ?? 0);
  res.json(recordBrowserTime(taskId, minutes));
});

// POST /api/cost-control/tasks/:taskId/pause
router.post("/cost-control/tasks/:taskId/pause", (req, res): void => {
  const taskId = String(req.params.taskId ?? "");
  const reason = typeof req.body?.reason === "string" ? req.body.reason : "paused by system";
  pauseTaskForUserInput(taskId, reason);
  res.json({ ok: true });
});

// POST /api/cost-control/tasks/:taskId/resume
router.post("/cost-control/tasks/:taskId/resume", (req, res): void => {
  const taskId = String(req.params.taskId ?? "");
  const ok = resumeTask(taskId);
  res.json({ ok });
});

// POST /api/cost-control/tasks/:taskId/complete
router.post("/cost-control/tasks/:taskId/complete", (req, res): void => {
  const taskId = String(req.params.taskId ?? "");
  completeTask(taskId);
  res.json({ ok: true });
});

export default router;
