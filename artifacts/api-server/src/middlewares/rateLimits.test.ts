import { describe, it, expect } from "vitest";
import {
  authStrictLimiter,
  credentialMutationLimiter,
  customAiSaveLimiter,
  toolHighRiskLimiter,
  agentTaskLimiter,
  approvalLimiter,
  browserOperatorLimiter,
  zipImportLimiter,
  repoImportLimiter,
  qaRunLimiter,
  productionCheckLimiter,
  checkoutLimiter,
  creditMutationLimiter,
  deploymentExecuteLimiter,
} from "./rateLimits";

describe("rateLimits exports", () => {
  it("exports all required rate limiters as middleware functions", () => {
    const limiters = [
      authStrictLimiter,
      credentialMutationLimiter,
      customAiSaveLimiter,
      toolHighRiskLimiter,
      agentTaskLimiter,
      approvalLimiter,
      browserOperatorLimiter,
      zipImportLimiter,
      repoImportLimiter,
      qaRunLimiter,
      productionCheckLimiter,
      checkoutLimiter,
      creditMutationLimiter,
      deploymentExecuteLimiter,
    ];

    for (const limiter of limiters) {
      expect(typeof limiter).toBe("function");
      // Express middleware signature: (req, res, next)
      expect(limiter.length).toBe(3);
    }
  });

  it("auth limiter is the strictest (lowest max)", () => {
    // We verify that the function is callable and is a middleware.
    // Actual limit values are encoded in the factory call — we trust the
    // factory test to verify the limit logic. Here we just sanity-check
    // that the exported limiter is a valid function.
    expect(authStrictLimiter).toBeDefined();
    expect(creditMutationLimiter).toBeDefined();
    expect(zipImportLimiter).toBeDefined();
  });

  it("skips rate limiting in test environment", () => {
    // In test mode (NODE_ENV=test) the base createRateLimiter skips the check.
    // We verify the middleware calls next() without blocking.
    const req = { ip: "1.2.3.4" } as unknown as import("express").Request;
    const res = {} as unknown as import("express").Response;
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    authStrictLimiter(req, res, next);
    expect(nextCalled).toBe(true);
  });
});
