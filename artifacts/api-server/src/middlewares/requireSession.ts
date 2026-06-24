import type { Request, Response, NextFunction } from "express";

/**
 * Require a valid user session or Archibald bypass flag.
 * Returns 401 if neither is present.
 *
 * TEST_BYPASS_SESSION=1 allows integration tests to exercise route logic
 * without a real authenticated session. Only active when NODE_ENV=test.
 */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV === "test" && process.env.TEST_BYPASS_SESSION === "1") { next(); return; }
  if (req.session.bypass) { next(); return; }
  if (req.session.userId) { next(); return; }
  res.status(401).json({ error: "Unauthorized" });
}
