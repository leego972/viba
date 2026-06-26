import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.post("/task-intake/create", (_req, res): void => {
  res.status(501).json({ error: "TASK_INTAKE_ROUTE_NOT_IMPLEMENTED_ON_MAIN", rawValuesReturned: false });
});

router.get("/task-intake/:taskId", (req, res): void => {
  res.json({ task_id: Number(req.params.taskId), status: "unavailable", rawValuesReturned: false });
});

router.get("/task-intake/:taskId/plan", (req, res): void => {
  res.json({ task_id: Number(req.params.taskId), plan: null, rawValuesReturned: false });
});

export default router;
