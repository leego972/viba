/**
 * VIBA Value Router Routes
 *
 * POST /value-router/classify — classify a task description and return a routing decision
 * POST /value-router/rank     — rank candidate providers by value score
 *
 * Both endpoints are pure-function wrappers over lib/valueRouter.ts.
 * No DB calls, no side effects. Safe to call repeatedly.
 */
import { Router } from "express";
import { routeTaskValue, rankCandidates } from "../lib/valueRouter";
import type { RouteTaskValueInput, ValueRouterInput } from "../lib/valueRouter";

const router = Router();

// POST /value-router/classify
// Body: { task: string; context?: string; requestedAction?: string; userConfirmed?: boolean }
router.post("/value-router/classify", (req, res): void => {
  const body = req.body as Partial<RouteTaskValueInput>;
  if (!body.task || typeof body.task !== "string") {
    res.status(400).json({ error: "invalid_input", message: "task (string) is required." });
    return;
  }
  const input: RouteTaskValueInput = {
    task: body.task,
    context: typeof body.context === "string" ? body.context : undefined,
    requestedAction: typeof body.requestedAction === "string" ? body.requestedAction : undefined,
    userConfirmed: typeof body.userConfirmed === "boolean" ? body.userConfirmed : undefined,
  };
  const result = routeTaskValue(input);
  res.json(result);
});

// POST /value-router/rank
// Body: ValueRouterInput (full candidate list + task metadata)
router.post("/value-router/rank", (req, res): void => {
  const body = req.body as Partial<ValueRouterInput>;
  if (!Array.isArray(body.candidates)) {
    res.status(400).json({ error: "invalid_input", message: "candidates (array) is required." });
    return;
  }
  const input = body as ValueRouterInput;
  const result = rankCandidates(input);
  res.json(result);
});

export default router;
