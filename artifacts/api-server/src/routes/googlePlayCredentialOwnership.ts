import { Router } from "express";

const router = Router();

/**
 * Hard boundary: every Google Play connection must be supplied by the
 * authenticated customer. VIBA has no platform credential fallback and must
 * never use an owner/admin Google account for a customer's publication.
 */
router.post("/play-publisher/connections", (req, res, next) => {
  const body = req.body as { serviceAccountJson?: unknown; confirmedOwnAccount?: unknown };

  if (body.confirmedOwnAccount !== true) {
    res.status(400).json({
      error: "You must confirm that these credentials belong to your own Google Cloud and Google Play Console account.",
      code: "customer_credentials_required",
    });
    return;
  }

  if (typeof body.serviceAccountJson !== "string" || body.serviceAccountJson.trim().length === 0) {
    res.status(400).json({
      error: "Your Google service-account JSON is required. VIBA does not provide or substitute Google credentials.",
      code: "customer_credentials_required",
    });
    return;
  }

  next();
});

export default router;
