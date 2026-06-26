import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/tool-broker/tools", (_req, res): void => {
  res.json({ tools: [], rawValuesReturned: false });
});

router.post("/tool-broker/execute", (_req, res): void => {
  res.status(501).json({ error: "TOOL_BROKER_ROUTE_NOT_IMPLEMENTED_ON_MAIN", rawValuesReturned: false });
});

export default router;
