import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/security/status", (_req, res): void => {
  res.json({ status: "available", blockers: [], rawValuesReturned: false });
});

router.get("/security/policy", (_req, res): void => {
  res.json({ policy: "VIBA blocks unsafe actions by default and never returns raw credential values.", rawValuesReturned: false });
});

export default router;
