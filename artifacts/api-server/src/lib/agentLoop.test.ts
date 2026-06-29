import { describe, it, expect } from "vitest";
import { resolveTaskDbStatus } from "./agentLoop";

/**
 * Regression tests for resolveTaskDbStatus.
 *
 * Critical case: "in_progress" MUST map to "planned" (not "review").
 * Replit and Manus adapters return completionStatus:"in_progress" when their
 * workspace task times out with partial progress — those tasks must stay
 * retryable. Mapping them to "review" strands them permanently.
 */
describe("resolveTaskDbStatus", () => {
  it('maps "complete" → "complete"', () => {
    expect(resolveTaskDbStatus("complete")).toBe("complete");
  });

  it('maps "needs_review" → "review"', () => {
    expect(resolveTaskDbStatus("needs_review")).toBe("review");
  });

  it('maps "approval_required" → "review"', () => {
    expect(resolveTaskDbStatus("approval_required")).toBe("review");
  });

  it('maps "in_progress" → "planned" (NOT "review") — Replit/Manus timeout regression', () => {
    // A timed-out Replit or Manus adapter step returns completionStatus:"in_progress".
    // The task must go back to "planned" so the next runNextAgentStep call picks it
    // up for retry. Mapping to "review" would strand it permanently.
    const status = resolveTaskDbStatus("in_progress");
    expect(status).toBe("planned");
    expect(status).not.toBe("review");
  });
});
