import { Router, type NextFunction, type Request, type Response } from "express";
import { evaluateQualityGate } from "../lib/qualityApprovalGate";

const router = Router();

async function enforceQualityGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      next();
      return;
    }

    const gate = await evaluateQualityGate(sessionId);
    if (gate.allowed) {
      next();
      return;
    }

    res.status(409).json({
      ok: false,
      blocked: true,
      blockedReason: "quality_override_approval_required",
      approvalRequired: true,
      approval: gate.approval,
      selectedProvider: gate.selectedProvider,
      selectedQuality: gate.selectedQuality,
      qualityFloor: gate.qualityFloor,
      message: gate.reason,
    });
  } catch (error) {
    next(error);
  }
}

router.post("/sessions/:id/run-next", enforceQualityGate);
router.post("/sessions/:id/run-full", enforceQualityGate);

export default router;
