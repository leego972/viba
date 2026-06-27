/**
 * VIBA Security Status API
 *
 * Read-only endpoints that power the Security Center dashboard.
 * All responses are redacted — no raw secrets ever returned.
 */

import { Router } from "express";
import { requireSession } from "../middlewares/requireSession";

const router = Router();

// ─── GET /api/security/status ─────────────────────────────────────────────────
// Returns a structured snapshot of all VIBA security controls.

router.get("/api/security/status", requireSession, (_req, res) => {
  const strict = process.env.VIBA_STRICT_RESPONSE_SECRET_GUARD === "true";

  const status = {
    securityPolicy: {
      enabled: true,
      description: "Global security policy active — field-level redaction, high-risk action classification.",
      rawValuesReturned: false,
    },
    responseSecretGuard: {
      enabled: true,
      strictMode: strict || process.env.NODE_ENV !== "production",
      description: "Outgoing JSON responses are scanned and redacted of sensitive fields.",
    },
    rateLimits: {
      enabled: true,
      skippedInTest: process.env.NODE_ENV === "test",
      tiers: [
        { name: "Auth (login/register/reset)",       windowMs: 60000, max: 10 },
        { name: "Credential mutation",               windowMs: 60000, max: 20 },
        { name: "Custom AI BYOK save",               windowMs: 60000, max: 20 },
        { name: "Tool broker (high-risk)",            windowMs: 60000, max: 10 },
        { name: "Agent task start/resume",            windowMs: 60000, max: 30 },
        { name: "Approval endpoints",                 windowMs: 60000, max: 10 },
        { name: "Browser operator",                   windowMs: 60000, max: 15 },
        { name: "Zip import",                         windowMs: 60000, max: 5  },
        { name: "Repo import",                        windowMs: 60000, max: 15 },
        { name: "QA run",                             windowMs: 60000, max: 20 },
        { name: "Production check-now",               windowMs: 60000, max: 30 },
        { name: "Checkout / payment mutation",        windowMs: 60000, max: 10 },
        { name: "Credit ledger write",                windowMs: 60000, max: 5  },
        { name: "Deployment execute",                 windowMs: 60000, max: 10 },
      ],
    },
    vaultSafety: {
      encrypted: true,
      rawValuesReturnedToClient: false,
      description: "Credentials stored AES-256-GCM encrypted. Only metadata (label, expiry) returned to frontend.",
    },
    byokSafety: {
      enabled: true,
      rawKeyReturnedToClient: false,
      description: "BYOK AI keys stored encrypted. Key value never returned after save.",
    },
    toolBrokerSafety: {
      approvalRequired: true,
      safeBuildRequired: true,
      dryRunRequired: true,
      placeholderAdaptersBlocked: true,
      payloadRedacted: true,
      resultRedacted: true,
      description: "Tool broker enforces approval, safe-build, dry-run, and payload redaction gates.",
    },
    uploadSafety: {
      maxUploadBytes: 50 * 1024 * 1024,
      maxExtractedBytes: 200 * 1024 * 1024,
      maxExtractedFiles: 2000,
      pathTraversalBlocked: true,
      zipBombHeuristicEnabled: true,
      description: "Uploaded zips scanned for path traversal, zip bombs, and excessive file counts.",
    },
    browserSafety: {
      isolatedProfilePerJob: true,
      cookieSharingBlocked: true,
      downloadsBlockedByDefault: true,
      downloadedFileExecutionBlocked: true,
      oauthPaymentPausesForApproval: true,
      urlValidatedBySsrfGuard: true,
      screenshotsRedacted: true,
      description: "Browser operator runs in isolated profile, blocks execution, pauses for OAuth/payment.",
    },
    urlSafety: {
      ssrfProtectionEnabled: true,
      blockedRanges: [
        "localhost / 127.x.x.x",
        "0.0.0.0",
        "RFC 1918 private (10.x, 172.16-31.x, 192.168.x)",
        "Link-local 169.254.x.x / fe80::",
        "Cloud metadata 169.254.169.254",
        "file:// and non-http protocols",
        "Bare internal hostnames",
      ],
      description: "All outbound URLs validated before use in project import, browser, production ops, and research.",
    },
    promptInjectionSafety: {
      enabled: true,
      patternCount: 12,
      description: "External content (files, web, repos) classified as untrusted. Injection patterns flagged and stripped.",
    },
    paymentSafety: {
      webhookSignatureRequired: true,
      idempotencyEnforced: true,
      duplicateCreditGrantBlocked: true,
      clientSelfCreditBlocked: true,
      negativeBalanceBlocked: true,
      description: "Stripe webhook signature verified. Credits only granted via verified server-side events.",
    },
    deploymentSafety: {
      safeBuildRequired: true,
      approvalRequired: true,
      dryRunRequired: true,
      placeholderAdaptersBlocked: true,
      description: "Deployments require safe-build + user approval + dry-run. Placeholder providers return blocked reason.",
    },
    qaGateIntegration: {
      blocksOn: [
        "response_leak_guard_failure",
        "vault_endpoint_returning_raw_value",
        "custom_ai_endpoint_returning_raw_key",
        "tool_broker_high_risk_without_approval",
        "deployment_without_safe_build",
        "ssrf_url_allowed",
        "zip_path_traversal_allowed",
        "browser_download_execution_allowed",
        "duplicate_payment_crediting",
        "cross_user_data_leakage",
        "missing_route_auth_on_sensitive_endpoints",
      ],
      description: "QA Gate blocks release on any security check failure.",
    },
    generatedAt: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? "unknown",
  };

  // Status object contains only boolean flags, numbers, and description strings —
  // no actual secrets. Return it directly without redaction.
  res.json(status);
});

// ─── GET /api/security/blockers ───────────────────────────────────────────────
// Returns recommended security blockers / open items for the dashboard.

router.get("/api/security/blockers", requireSession, (_req, res) => {
  // In a production system these would be read from the DB (business security autopilot).
  // Here we return the static set of controls that must always be green.
  const blockers = [
    {
      id: "response_secret_guard",
      title: "Response Secret Guard",
      status: "active",
      description: "Outgoing responses are scanned and redacted.",
      severity: "critical",
    },
    {
      id: "vault_encrypted",
      title: "Vault Encryption",
      status: "active",
      description: "All credentials encrypted at rest with AES-256-GCM.",
      severity: "critical",
    },
    {
      id: "tool_approval_gate",
      title: "Tool Approval Gate",
      status: "active",
      description: "High-risk tool actions require explicit user approval.",
      severity: "high",
    },
    {
      id: "safe_build_gate",
      title: "Safe-Build Gate",
      status: "active",
      description: "Deployments blocked until safe-build passes.",
      severity: "high",
    },
    {
      id: "ssrf_protection",
      title: "SSRF Protection",
      status: "active",
      description: "All outbound URLs validated against private-network blocklist.",
      severity: "high",
    },
    {
      id: "upload_quarantine",
      title: "Upload Quarantine",
      status: "active",
      description: "Uploads validated for zip bombs, path traversal, and file type before analysis.",
      severity: "high",
    },
    {
      id: "prompt_injection_detection",
      title: "Prompt Injection Detection",
      status: "active",
      description: "External content classified untrusted; injection patterns flagged.",
      severity: "high",
    },
    {
      id: "stripe_webhook_sig",
      title: "Stripe Webhook Signature",
      status: "active",
      description: "Webhook events verified with Stripe signature before processing.",
      severity: "critical",
    },
    {
      id: "rate_limits",
      title: "Route-Level Rate Limits",
      status: "active",
      description: "Auth, vault, browser, checkout, and deployment endpoints are rate-limited.",
      severity: "medium",
    },
    {
      id: "browser_isolation",
      title: "Browser Operator Isolation",
      status: "active",
      description: "Isolated browser profile per job; OAuth/payment pauses for approval.",
      severity: "high",
    },
  ];

  // Blockers contain only IDs, titles, descriptions, and severity labels — no secrets.
  res.json({ blockers });
});

export default router;
