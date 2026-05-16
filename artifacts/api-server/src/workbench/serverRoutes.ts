import { Router } from "express";
import { z } from "zod/v4";
import { analyzeTask, WorkbenchRefusalError } from "./analyzeTask";
import { refuseCheck } from "./safety";

const workbenchRouter = Router();

const PlatformSchema = z.enum([
  "alignerr",
  "outlier",
  "dataannotation",
  "toloka",
  "remotasks",
  "mindrift",
  "other",
]);

const TaskTypeSchema = z.enum([
  "grammar_cleanup",
  "classification",
  "sentiment_labeling",
  "response_comparison",
  "factuality_check",
  "math_reasoning",
  "coding",
  "expert_domain",
  "subjective_judgment",
  "unknown",
]);

const AnalyzeRequestSchema = z.object({
  platform: PlatformSchema,
  taskType: TaskTypeSchema.optional(),
  instructions: z.string().min(1).max(8000),
  rubric: z.string().max(4000).optional(),
  taskContent: z.string().min(1).max(16000),
  answerOptions: z.array(z.string().max(500)).max(20).optional(),
  userNotes: z.string().max(2000).optional(),
  budgetLimitUsd: z.number().min(0).max(10).optional(),
  routingMode: z.enum(["fast", "balanced", "quality"]).optional(),
});

const RefuseCheckSchema = z.object({
  requestText: z.string().min(1).max(4000),
});

// GET /workbench/health
workbenchRouter.get("/workbench/health", (_req, res) => {
  res.json({
    status: "ok",
    module: "ai-trainer-workbench",
    version: "1.0.0",
  });
});

// POST /workbench/analyze
workbenchRouter.post("/workbench/analyze", async (req, res) => {
  const parseResult = AnalyzeRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: "Invalid request",
      details: parseResult.error.issues,
    });
    return;
  }

  try {
    const result = await analyzeTask(parseResult.data);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof WorkbenchRefusalError) {
      res.status(422).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "workbench analyze error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /workbench/refuse-check
workbenchRouter.post("/workbench/refuse-check", (req, res) => {
  const parseResult = RefuseCheckSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: "Invalid request",
      details: parseResult.error.issues,
    });
    return;
  }

  const { allowed, reason } = refuseCheck(parseResult.data.requestText);
  res.status(200).json({ allowed, reason: reason ?? null });
});

export default workbenchRouter;
