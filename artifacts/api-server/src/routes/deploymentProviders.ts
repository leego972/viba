/**
 * VIBA Deployment Providers API
 *
 * GET  /api/deployment-providers
 * GET  /api/deployment-providers/:providerId
 * POST /api/deployment-providers/:providerId/readiness
 * POST /api/deployment-providers/:providerId/plan
 * POST /api/deployment-providers/:providerId/dry-run
 * POST /api/deployment-providers/:providerId/execute
 *
 * Security rules:
 * - GET endpoints return provider metadata only — no credentials
 * - readiness checks credential presence by metadata only — no raw values
 * - execute refuses if: adapter is placeholder, safe-build missing, approval
 *   missing, credential missing, or action is unsupported
 * - rawValuesReturned: false on every response
 */
import { Router } from "express";
import { pool } from "@workspace/db";
import {
  getAllProviders,
  getProviderById,
  canExecuteProvider,
  isPlaceholderProvider,
  generateManualGuide,
} from "../lib/deploymentProviderRegistry";

const router = Router();

// ─── Auth helper ──────────────────────────────────────────────────────────────

function uid(req: { session?: { userId?: number } }): number {
  return typeof req.session?.userId === "number" ? req.session.userId : 0;
}

// ─── Credential metadata check (never returns raw values) ─────────────────────

async function checkCredentialMetadata(
  userId: number,
  credentialProvider: string,
): Promise<{ hasCredential: boolean; credentialLabel: string | null; expiresAt: string | null }> {
  try {
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT label, (metadata->>'expiresAt') as expires_at
         FROM viba_credentials
        WHERE user_id=$1 AND provider=$2
        ORDER BY created_at DESC LIMIT 1`,
      [userId, credentialProvider],
    );
    if (!rows[0]) return { hasCredential: false, credentialLabel: null, expiresAt: null };
    return {
      hasCredential: true,
      credentialLabel: rows[0]["label"] ? String(rows[0]["label"]) : null,
      expiresAt: rows[0]["expires_at"] ? String(rows[0]["expires_at"]) : null,
    };
  } catch {
    return { hasCredential: false, credentialLabel: null, expiresAt: null };
  }
}

// ─── GET /api/deployment-providers ───────────────────────────────────────────

router.get("/api/deployment-providers", (_req, res): void => {
  const providers = getAllProviders().map((p) => ({
    providerId: p.providerId,
    label: p.label,
    description: p.description,
    docsStatus: p.docsStatus,
    manualGuideAvailable: p.manualGuideAvailable,
    supportsDeployTrigger: p.supportsDeployTrigger,
    requiresSafeBuildBeforeDeploy: p.requiresSafeBuildBeforeDeploy,
    requiresApprovalForDeploy: p.requiresApprovalForDeploy,
    requiredCredentialKinds: p.requiredCredentialKinds,
    detectionHints: p.detectionHints,
    canExecute: canExecuteProvider(p.providerId),
    rawValuesReturned: false,
  }));
  res.json({ ok: true, providers, count: providers.length, rawValuesReturned: false });
});

// ─── GET /api/deployment-providers/:providerId ────────────────────────────────

router.get("/api/deployment-providers/:providerId", (req, res): void => {
  const pid = req.params["providerId"] as string;
  const provider = getProviderById(pid);
  if (!provider) {
    res.status(404).json({ error: `Provider '${pid}' not found`, rawValuesReturned: false });
    return;
  }
  res.json({
    ok: true,
    provider: { ...provider, rawValuesReturned: false },
    canExecute: canExecuteProvider(pid),
    isPlaceholder: isPlaceholderProvider(pid),
    rawValuesReturned: false,
  });
});

// ─── POST /api/deployment-providers/:providerId/readiness ─────────────────────

router.post("/api/deployment-providers/:providerId/readiness", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required", rawValuesReturned: false }); return; }

  const pid = req.params["providerId"] as string;
  const provider = getProviderById(pid);
  if (!provider) { res.status(404).json({ error: `Provider '${pid}' not found`, rawValuesReturned: false }); return; }

  const credMeta = provider.credentialProvider
    ? await checkCredentialMetadata(u, provider.credentialProvider)
    : { hasCredential: true, credentialLabel: null, expiresAt: null };

  const ready =
    provider.docsStatus === "implemented" && credMeta.hasCredential;

  const blocks: string[] = [];
  if (provider.docsStatus !== "implemented") blocks.push(`Provider adapter is ${provider.docsStatus} — automated execution unavailable`);
  if (!credMeta.hasCredential && provider.credentialProvider) blocks.push(`Missing vault credential for ${provider.credentialProvider}`);

  res.json({
    ok: true,
    providerId: pid,
    providerLabel: provider.label,
    adapterStatus: provider.docsStatus,
    credentialStatus: {
      hasCredential: credMeta.hasCredential,
      credentialLabel: credMeta.credentialLabel,
      expiresAt: credMeta.expiresAt,
      rawValuesReturned: false,
    },
    isReady: ready,
    manualGuideAvailable: provider.manualGuideAvailable,
    blocks,
    rawValuesReturned: false,
  });
});

// ─── POST /api/deployment-providers/:providerId/plan ──────────────────────────

router.post("/api/deployment-providers/:providerId/plan", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required", rawValuesReturned: false }); return; }

  const pid = req.params["providerId"] as string;
  const provider = getProviderById(pid);
  if (!provider) { res.status(404).json({ error: `Provider '${pid}' not found`, rawValuesReturned: false }); return; }

  const { appName = "app", publicUrl, notes } = req.body as {
    appName?: string; publicUrl?: string; notes?: string;
  };

  const credMeta = provider.credentialProvider
    ? await checkCredentialMetadata(u, provider.credentialProvider)
    : { hasCredential: true, credentialLabel: null, expiresAt: null };

  const steps: Array<{ step: number; action: string; requiresApproval: boolean; requiresSafeBuild: boolean; automated: boolean }> = [
    { step: 1, action: "Run safe-build locally and confirm passing", requiresApproval: false, requiresSafeBuild: false, automated: false },
    { step: 2, action: "Verify required credentials are in vault", requiresApproval: false, requiresSafeBuild: false, automated: true },
    { step: 3, action: "Confirm environment variables are configured on provider dashboard", requiresApproval: true, requiresSafeBuild: false, automated: provider.supportsEnvRead },
    { step: 4, action: "Review QA release gate — all checks must pass", requiresApproval: true, requiresSafeBuild: true, automated: false },
    { step: 5, action: `Trigger deployment on ${provider.label}`, requiresApproval: true, requiresSafeBuild: true, automated: canExecuteProvider(pid) },
    { step: 6, action: "Verify public URL health post-deploy", requiresApproval: false, requiresSafeBuild: false, automated: true },
    { step: 7, action: "Run Production Ops → Check Now to confirm all checks pass", requiresApproval: false, requiresSafeBuild: false, automated: true },
  ];

  const manualGuide = !canExecuteProvider(pid)
    ? generateManualGuide(pid, appName, publicUrl)
    : null;

  res.json({
    ok: true,
    providerId: pid,
    providerLabel: provider.label,
    appName,
    adapterStatus: provider.docsStatus,
    credentialReady: credMeta.hasCredential,
    canAutomate: canExecuteProvider(pid),
    manualGuideAvailable: provider.manualGuideAvailable,
    manualGuide,
    steps,
    approvalRequired: provider.requiresApprovalForDeploy,
    safeBuildRequired: provider.requiresSafeBuildBeforeDeploy,
    notes: notes ?? null,
    rawValuesReturned: false,
  });
});

// ─── POST /api/deployment-providers/:providerId/dry-run ──────────────────────

router.post("/api/deployment-providers/:providerId/dry-run", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required", rawValuesReturned: false }); return; }

  const pid = req.params["providerId"] as string;
  const provider = getProviderById(pid);
  if (!provider) { res.status(404).json({ error: `Provider '${pid}' not found`, rawValuesReturned: false }); return; }

  // Dry-run never mutates the provider
  const { appName = "app", safeBuildPassed = false } = req.body as {
    appName?: string; safeBuildPassed?: boolean;
  };

  const credMeta = provider.credentialProvider
    ? await checkCredentialMetadata(u, provider.credentialProvider)
    : { hasCredential: true, credentialLabel: null, expiresAt: null };

  const checks = [
    { check: "adapter_status", status: provider.docsStatus === "implemented" ? "pass" : "warn", detail: `Adapter: ${provider.docsStatus}` },
    { check: "credential", status: credMeta.hasCredential ? "pass" : "fail", detail: credMeta.hasCredential ? `Credential found: ${credMeta.credentialLabel ?? "unnamed"}` : "No credential in vault" },
    { check: "safe_build", status: safeBuildPassed ? "pass" : "fail", detail: safeBuildPassed ? "Safe build passed" : "Safe build not confirmed" },
    { check: "approval_gate", status: "pending", detail: "Owner approval required before execute" },
  ];

  const allPass = checks.every((c) => c.status === "pass" || c.status === "pending");

  res.json({
    ok: true,
    dryRun: true,
    mutated: false,
    providerId: pid,
    providerLabel: provider.label,
    appName,
    checks,
    wouldProceed: allPass && provider.docsStatus === "implemented",
    blockers: checks.filter((c) => c.status === "fail").map((c) => c.detail),
    rawValuesReturned: false,
  });
});

// ─── POST /api/deployment-providers/:providerId/execute ───────────────────────

router.post("/api/deployment-providers/:providerId/execute", async (req, res): Promise<void> => {
  const u = uid(req);
  if (!u) { res.status(401).json({ error: "Authentication required", rawValuesReturned: false }); return; }

  const pid = req.params["providerId"] as string;
  const provider = getProviderById(pid);
  if (!provider) { res.status(404).json({ error: `Provider '${pid}' not found`, rawValuesReturned: false }); return; }

  const {
    action,
    approved = false,
    safeBuildPassed = false,
  } = req.body as {
    action?: string;
    approved?: boolean;
    safeBuildPassed?: boolean;
  };

  // ── Gate 1: Placeholder adapter ──────────────────────────────────────────────
  if (!canExecuteProvider(pid)) {
    const manualGuide = generateManualGuide(pid, "your app");
    res.status(400).json({
      ok: false,
      blocked: true,
      blockedReason: "adapter_placeholder",
      message: `Provider '${provider.label}' adapter is ${provider.docsStatus}. Automated execution is unavailable. Use the manual deployment guide instead.`,
      manualGuide,
      manualGuideAvailable: provider.manualGuideAvailable,
      rawValuesReturned: false,
    });
    return;
  }

  // ── Gate 2: Safe build ────────────────────────────────────────────────────────
  if (provider.requiresSafeBuildBeforeDeploy && !safeBuildPassed) {
    res.status(400).json({
      ok: false,
      blocked: true,
      blockedReason: "safe_build_missing",
      message: "Safe build must pass before deployment. Run: pnpm run safe-build",
      rawValuesReturned: false,
    });
    return;
  }

  // ── Gate 3: Approval ──────────────────────────────────────────────────────────
  if ((provider.requiresApprovalForDeploy || provider.requiresApprovalForEnvWrite) && !approved) {
    res.status(400).json({
      ok: false,
      blocked: true,
      blockedReason: "approval_missing",
      message: "Owner approval is required before executing this deployment action.",
      rawValuesReturned: false,
    });
    return;
  }

  // ── Gate 4: Credential ────────────────────────────────────────────────────────
  const credMeta = provider.credentialProvider
    ? await checkCredentialMetadata(u, provider.credentialProvider)
    : { hasCredential: true, credentialLabel: null, expiresAt: null };

  if (provider.credentialProvider && !credMeta.hasCredential) {
    res.status(400).json({
      ok: false,
      blocked: true,
      blockedReason: "credential_missing",
      message: `Required credential for ${provider.label} not found in vault. Add it via VIBA Vault.`,
      rawValuesReturned: false,
    });
    return;
  }

  // ── Gate 5: Unsupported action ───────────────────────────────────────────────
  const SUPPORTED_ACTIONS = ["deploy", "env_write", "env_read", "status", "logs", "domain_check"];
  if (action && !SUPPORTED_ACTIONS.includes(action)) {
    res.status(400).json({
      ok: false,
      blocked: true,
      blockedReason: "unsupported_action",
      message: `Action '${action}' is not supported for provider '${provider.label}'.`,
      rawValuesReturned: false,
    });
    return;
  }

  // Route implemented providers to their dedicated connector endpoints
  const connectorPaths: Record<string, { base: string; label: string }> = {
    railway: { base: "/api/railway-connector", label: "Railway Connector" },
    render:  { base: "/api/render-connector",  label: "Render Connector"  },
  };
  const connector = connectorPaths[pid];

  if (!connector) {
    // Should never reach here — Gate 1 blocks non-implemented providers
    res.status(400).json({
      ok: false,
      blocked: true,
      blockedReason: "adapter_placeholder",
      message: `Provider '${provider.label}' has no active connector. This is a bug — contact support.`,
      rawValuesReturned: false,
    });
    return;
  }

  const actionRoutes: Record<string, string> = {
    deploy:       `${connector.base}/deploy`,
    env_write:    `${connector.base}/env-vars/apply`,
    env_read:     `${connector.base}/env-vars`,
    status:       `${connector.base}/status`,
    logs:         `${connector.base}/logs`,
    domain_check: `${connector.base}/status`,
  };

  res.json({
    ok: true,
    providerId: pid,
    providerLabel: provider.label,
    action: action ?? "deploy",
    status: "accepted",
    connectorLabel: connector.label,
    connectorBase: connector.base,
    actionEndpoint: actionRoutes[action ?? "deploy"] ?? `${connector.base}/status`,
    message: `Action '${action ?? "deploy"}' accepted for ${provider.label}. Delegate to ${connector.label} at ${connector.base}.`,
    note: "Destructive actions (deploy, env_write) require ADMIN_TOKEN + X-Admin-Confirm: true header at the connector endpoint. No raw credentials are returned.",
    rawValuesReturned: false,
  });
});

export default router;
