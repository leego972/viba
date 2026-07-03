/**
 * VIBA Route-Specific Rate Limiters
 *
 * Builds on the base createRateLimiter() from rateLimiter.ts.
 * Each limiter is tuned to the risk level of its endpoint group.
 *
 * All limiters return a structured JSON error body on 429:
 *   { error: "RATE_LIMITED", message: "Too many requests. Try again later." }
 */

import { createRateLimiter, createUserRateLimiter } from "./rateLimiter";

const RATE_LIMITED_BODY = JSON.stringify({
  error: "RATE_LIMITED",
  message: "Too many requests. Try again later.",
});

function rl(windowMs: number, max: number) {
  return createRateLimiter({ windowMs, max, message: RATE_LIMITED_BODY });
}

const MINUTE = 60_000;

// ─── Auth ─────────────────────────────────────────────────────────────────────
/** Login / register / password-reset: strict to prevent brute-force */
export const authStrictLimiter = rl(MINUTE, 10);

// ─── Credentials / Vault ──────────────────────────────────────────────────────
/** Credential save / update / delete */
export const credentialMutationLimiter = rl(MINUTE, 20);

// ─── Custom AI BYOK ───────────────────────────────────────────────────────────
/** POST /api/custom-ai-credentials — saving a BYOK key */
export const customAiSaveLimiter = rl(MINUTE, 20);

// ─── Tool Broker ──────────────────────────────────────────────────────────────
/** High-risk tool execution */
export const toolHighRiskLimiter = rl(MINUTE, 10);

// ─── Agent Runtime ────────────────────────────────────────────────────────────
/** Task start / next / resume */
export const agentTaskLimiter = rl(MINUTE, 30);
/** Approval endpoints */
export const approvalLimiter = rl(MINUTE, 10);

// ─── Browser Operator ─────────────────────────────────────────────────────────
/** start / resume / authorize */
export const browserOperatorLimiter = rl(MINUTE, 15);

// ─── Project Import ───────────────────────────────────────────────────────────
/** Zip upload import: very strict */
export const zipImportLimiter = rl(MINUTE, 5);
/** Repo URL import */
export const repoImportLimiter = rl(MINUTE, 15);

// ─── QA Gate ──────────────────────────────────────────────────────────────────
/** QA run trigger */
export const qaRunLimiter = rl(MINUTE, 20);

// ─── Production Ops ───────────────────────────────────────────────────────────
/** Manual check-now trigger */
export const productionCheckLimiter = rl(MINUTE, 30);

// ─── Payments / Credits ───────────────────────────────────────────────────────
/** Checkout session creation / payment mutation */
export const checkoutLimiter = rl(MINUTE, 10);
/** Credit ledger write operations */
export const creditMutationLimiter = rl(MINUTE, 5);

// ─── Deployment Providers ─────────────────────────────────────────────────────
/** Deployment execute endpoint */
export const deploymentExecuteLimiter = rl(MINUTE, 10);

// ─── Per-user limits (keyed on session userId, not IP) ────────────────────────
/** Session creation: max 20 sessions per hour per authenticated user */
export const sessionCreationUserLimiter = createUserRateLimiter({ windowMs: 60 * MINUTE, max: 20, message: "Too many sessions created. Please wait before starting another." });
/** Agent run step: max 60 run-next/run-full calls per 10 minutes per user */
export const agentRunUserLimiter = createUserRateLimiter({ windowMs: 10 * MINUTE, max: 60, message: "Agent execution rate limit reached. Please wait a moment before continuing." });
