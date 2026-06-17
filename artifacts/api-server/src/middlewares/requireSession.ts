import type { Request, Response, NextFunction } from "express";

/**
 * Require a valid user session or Archibald bypass flag.
 * Returns 401 if neither is present.
 */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (req.session.bypass) { next(); return; }
  if (req.session.userId) { next(); return; }
  res.status(401).json({ error: "Unauthorized" });
}
