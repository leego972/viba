import { Router, type IRouter } from "express";

const router: IRouter = Router();

function disabledMessage(): string {
  return "VIBA repository automation is disabled during Render bootstrap. Re-enable this route only after install, typecheck, build, database startup, and admin auth are verified in production.";
}

router.post("/self-repair/auto-fix", (_req, res): void => {
  res.status(503).json({ ok: false, disabled: true, message: disabledMessage() });
});

router.get("/self-repair/runs", (_req, res): void => {
  res.json({ runs: [], disabled: true, message: disabledMessage() });
});

router.get("/self-repair/runs/:id/events", (_req, res): void => {
  res.json({ events: [], disabled: true, message: disabledMessage() });
});

export default router;
