import type { RequestHandler } from "express";
import { isAdminUserId } from "../lib/adminAccess";
import { requireAdmin } from "./adminAuth";

/**
 * Accept either:
 * - a verified signed-in user whose email is listed in VIBA_ADMIN_EMAILS; or
 * - the existing ADMIN_TOKEN bearer flow used by the dedicated admin console.
 */
export const requireOwnerAdmin: RequestHandler = async (req, res, next) => {
  const userId = req.session?.userId;
  if (typeof userId === "number" && userId > 0) {
    try {
      if (await isAdminUserId(userId)) {
        next();
        return;
      }
    } catch (err) {
      req.log?.error?.({ err, userId }, "administrator session check failed");
      res.status(503).json({ error: "Administrator access could not be verified" });
      return;
    }
  }

  requireAdmin(req, res, next);
};
