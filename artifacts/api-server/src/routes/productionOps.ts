import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/production-ops/summary", (_req, res): void => {
  res.json({ targets: 0, incidents: 0, rawValuesReturned: false });
});

router.post("/production-ops/targets", (_req, res): void => {
  res.status(501).json({ error: "PRODUCTION_OPS_ROUTE_NOT_IMPLEMENTED_ON_MAIN", rawValuesReturned: false });
});

export default router;
