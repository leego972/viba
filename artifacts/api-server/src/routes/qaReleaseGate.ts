import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/qa-release-gate/status", (_req, res): void => {
  res.json({ status: "not_run", blockers: [], rawValuesReturned: false });
});

router.post("/qa-release-gate/run", (_req, res): void => {
  res.json({ status: "not_implemented_on_main", blockers: ["QA_RELEASE_GATE_ROUTE_PLACEHOLDER"], rawValuesReturned: false });
});

export default router;
