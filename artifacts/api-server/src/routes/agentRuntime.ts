import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/agent-runtime/status", (_req, res): void => {
  res.json({ status: "unavailable", rawValuesReturned: false });
});

router.post("/agent-runtime/start", (_req, res): void => {
  res.status(501).json({ error: "AGENT_RUNTIME_ROUTE_NOT_IMPLEMENTED_ON_MAIN", rawValuesReturned: false });
});

export default router;
