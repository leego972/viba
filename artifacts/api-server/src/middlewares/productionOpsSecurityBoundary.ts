import { Router } from "express";
import { pool } from "@workspace/db";
import { validatePublicHttpUrl } from "../lib/safeOutboundHttp";

const router = Router();

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" && req.session.userId > 0 ? req.session.userId : null;
}

function validateTargetUrls(publicUrl: unknown, apiHealthUrl: unknown): string | null {
  if (typeof publicUrl !== "string") return "publicUrl is required";
  const publicValidation = validatePublicHttpUrl(publicUrl);
  if (!publicValidation.ok) return `publicUrl: ${publicValidation.error}`;
  if (typeof apiHealthUrl === "string" && apiHealthUrl.trim()) {
    const apiValidation = validatePublicHttpUrl(apiHealthUrl);
    if (!apiValidation.ok) return `apiHealthUrl: ${apiValidation.error}`;
  }
  return null;
}

router.post("/api/production-ops/targets", (req, res, next): void => {
  const error = validateTargetUrls(req.body?.publicUrl, req.body?.apiHealthUrl);
  if (error) {
    res.status(400).json({ error, code: "UNSAFE_HEALTH_TARGET", rawValuesReturned: false });
    return;
  }
  next();
});

router.post("/api/production-ops/targets/:targetId/check-now", async (req, res, next): Promise<void> => {
  const uid = userId(req);
  const targetId = Number.parseInt(String(req.params.targetId ?? ""), 10);
  if (!uid || !Number.isInteger(targetId) || targetId <= 0) {
    res.status(400).json({ error: "Invalid target", rawValuesReturned: false });
    return;
  }

  try {
    const { rows } = await pool.query<{ public_url: string; api_health_url: string | null }>(
      `SELECT public_url, api_health_url FROM viba_production_targets WHERE id=$1 AND user_id=$2 LIMIT 1`,
      [targetId, uid],
    );
    const target = rows[0];
    if (!target) {
      res.status(404).json({ error: "Target not found", rawValuesReturned: false });
      return;
    }
    const error = validateTargetUrls(target.public_url, target.api_health_url ?? "");
    if (error) {
      res.status(422).json({
        error: `Stored target is unsafe and cannot be probed: ${error}`,
        code: "UNSAFE_STORED_HEALTH_TARGET",
        rawValuesReturned: false,
      });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
});

export default router;
