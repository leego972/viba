import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/agent-comms-console/messages", (_req, res): void => {
  res.json({ messages: [], rawValuesReturned: false });
});

router.post("/agent-comms-console/messages", (_req, res): void => {
  res.status(501).json({ error: "AGENT_COMMS_ROUTE_NOT_IMPLEMENTED_ON_MAIN", rawValuesReturned: false });
});

router.get("/agent-comms-console/policy", (_req, res): void => {
  res.json({ policy: { title: "VIBA Agent Communication Policy", rawValuesReturned: false } });
});

export default router;
