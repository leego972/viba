import { Router, type IRouter } from "express";
import { getCircuitStatus } from "../lib/adapterRetry";

const router: IRouter = Router();

router.get("/circuit-status", (req, res): void => {
  res.json(getCircuitStatus());
});

export default router;
