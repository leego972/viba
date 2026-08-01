import { Router } from "express";
import { pool } from "@workspace/db";
import {
  getAllProviders,
  getProviderById,
  generateManualGuide,
  isPlaceholderProvider,
} from "../lib/deploymentProviderRegistry";
import {
  getRenderConnectorStatus,
  triggerRenderDeploy,
  getRenderEnvVarKeys,
  applyRenderEnvVars,
  getRenderLogs,
  getRenderDeploys,
} from "../lib/renderConnector";
import {
  getRailwayConnectorStatus,
  applyRailwayVariablesViaApi,
} from "../lib/railwayConnector";
import { logger } from "../lib/logger";

const router = Router();

type Action = "deploy" | "env_write" | "env_read" | "status" | "logs" | "domain_check";

function uid(req: { session?: { userId?: number } }): number {
  return typeof req.session?.userId === "number" ? req.session.userId : 0;
}

async function hasCredential(userId: number, provider: string): Promise<boolean> {
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM viba_credentials WHERE user_id=$1 AND provider=$2 LIMIT 1`,
      [userId, provider],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

function executableActions(providerId: string): Action[] {
  if (providerId === "render") return ["deploy", "env_write", "env_read", "status", "logs"];
  if (providerId === "railway") return ["env_write", "status"];
  return [];
}

function verifiedProvider(providerId: string) {
  const provider = getProviderById(providerId);
  if (!provider) return null;
  const actions = executableActions(providerId);
  return {
    ...provider,
    supportsEnvRead: actions.includes("env_read"),
    supportsEnvWrite: actions.includes("env_write"),
    supportsDeployStatus: actions.includes("status"),
    supportsDeployTrigger: actions.includes("deploy"),
    supportsDomainCheck: actions.includes("domain_check"),
    supportsLogs: actions.includes("logs"),
    canExecute: actions.length > 0,
    isPlaceholder: isPlaceholderProvider(providerId),
    executableActions: actions,
    verification: "runtime_function_mapped",
    rawValuesReturned: false,
  };
}

router.get("/api/deployment-providers", (_req, res): void => {
  const providers = getAllProviders().map((p) => verifiedProvider(p.providerId)).filter(Boolean);
  res.json({ ok: true, providers, count: providers.length, verifiedRegistry: true, rawValuesReturned: false });
});

router.get("/api/deployment-providers/:providerId", (req, res): void => {
  const provider = verifiedProvider(String(req.params.providerId));
  if (!provider) { res.status(404).json({ error: "Provider not found" }); return; }
  res.json({ ok: true, ...provider, rawValuesReturned: false });
});

router.post("/api/deployment-providers/:providerId/readiness", async (req, res): Promise<void> => {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const provider = verifiedProvider(String(req.params.providerId));
  if (!provider) { res.status(404).json({ error: "Provider not found" }); return; }
  const credentialReady = provider.credentialProvider
    ? await hasCredential(userId, provider.credentialProvider)
    : true;
  const blocks: string[] = [];
  if (!provider.canExecute) blocks.push("No verified runtime function is mapped for this provider");
  if (!credentialReady) blocks.push(`Missing vault credential for ${provider.credentialProvider}`);
  res.json({
    ok: true,
    providerId: provider.providerId,
    isReady: provider.canExecute && credentialReady,
    credentialReady,
    credentialStatus: { ready: credentialReady, rawValuesReturned: false },
    executableActions: provider.executableActions,
    blocks,
    verification: "runtime_function_mapped",
    rawValuesReturned: false,
  });
});

router.post("/api/deployment-providers/:providerId/plan", (req, res): void => {
  const provider = verifiedProvider(String(req.params.providerId));
  if (!provider) { res.status(404).json({ error: "Provider not found" }); return; }
  const appName = typeof req.body?.appName === "string" ? req.body.appName : "app";
  res.json({
    ok: true,
    providerId: provider.providerId,
    appName,
    executableActions: provider.executableActions,
    steps: [
      "Run the real safe-build command and retain its output",
      "Confirm provider credentials are available",
      "Obtain owner approval",
      provider.executableActions.length ? "Execute a mapped provider function" : "Follow the manual provider guide",
      "Verify the provider response and public health after execution",
    ],
    manualGuide: provider.executableActions.length ? null : generateManualGuide(provider.providerId, appName),
    rawValuesReturned: false,
  });
});

router.post("/api/deployment-providers/:providerId/dry-run", (req, res): void => {
  const provider = verifiedProvider(String(req.params.providerId));
  if (!provider) { res.status(404).json({ error: "Provider not found" }); return; }
  const action = String(req.body?.action ?? "deploy") as Action;
  const runtimeMapped = provider.executableActions.includes(action);
  const safeBuildPassed = req.body?.safeBuildPassed === true;
  const approved = req.body?.approved === true;
  res.json({
    ok: true,
    dryRun: true,
    mutated: false,
    providerId: provider.providerId,
    action,
    wouldProceed: runtimeMapped && (action !== "deploy" || safeBuildPassed) && (!["deploy", "env_write"].includes(action) || approved),
    checks: { runtimeMapped, safeBuildPassed, approved },
    rawValuesReturned: false,
  });
});

router.post("/api/deployment-providers/:providerId/execute", async (req, res): Promise<void> => {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

  const providerId = String(req.params.providerId);
  const provider = verifiedProvider(providerId);
  if (!provider) { res.status(404).json({ error: "Provider not found" }); return; }

  const action = String(req.body?.action ?? "deploy") as Action;
  if (!provider.executableActions.includes(action)) {
    res.status(400).json({
      ok: false,
      blocked: true,
      blockedReason: "runtime_action_not_mapped",
      message: `${provider.label} ${action} is not implemented by a verified runtime function.`,
      manualGuide: generateManualGuide(providerId, String(req.body?.appName ?? "app")),
      rawValuesReturned: false,
    });
    return;
  }

  if (provider.credentialProvider) {
    const credOk = await hasCredential(userId, provider.credentialProvider);
    if (!credOk) {
      res.status(400).json({
        ok: false,
        blocked: true,
        blockedReason: "credential_missing",
        message: `No vault credential found for ${provider.credentialProvider}.`,
        rawValuesReturned: false,
      });
      return;
    }
  }

  if (["deploy", "env_write"].includes(action) && req.body?.approved !== true) {
    res.status(400).json({ ok: false, blocked: true, blockedReason: "approval_missing" });
    return;
  }
  if (action === "deploy" && req.body?.safeBuildPassed !== true) {
    res.status(400).json({ ok: false, blocked: true, blockedReason: "safe_build_missing" });
    return;
  }

  try {
    if (providerId === "render") {
      if (action === "deploy") {
        const result = await triggerRenderDeploy({ clearCache: req.body?.clearCache === true });
        if (!result.ok) { res.status(502).json({ ok: false, error: result.error }); return; }
        res.status(201).json({ ok: true, executed: true, providerId, action, deployId: result.deployId, status: result.status, rawValuesReturned: false });
        return;
      }
      if (action === "env_write") {
        const variables = req.body?.variables && typeof req.body.variables === "object" ? req.body.variables : {};
        const result = await applyRenderEnvVars(variables);
        if (!result.ok) { res.status(502).json({ ok: false, error: result.error, skippedKeys: result.skippedKeys }); return; }
        res.json({ ok: true, executed: true, providerId, action, appliedKeys: result.appliedKeys, skippedKeys: result.skippedKeys, rawValuesReturned: false });
        return;
      }
      if (action === "env_read") {
        const result = await getRenderEnvVarKeys();
        if (!result.ok) { res.status(502).json({ ok: false, error: result.error }); return; }
        res.json({ ok: true, executed: true, providerId, action, keys: result.keys, rawValuesReturned: false });
        return;
      }
      if (action === "logs") {
        const result = await getRenderLogs(Math.min(Number(req.body?.limit ?? 100), 500));
        if (!result.ok) { res.status(502).json({ ok: false, error: result.error }); return; }
        res.json({ ok: true, executed: true, providerId, action, lines: result.lines, rawValuesReturned: false });
        return;
      }
      const [status, deploys] = await Promise.all([getRenderConnectorStatus(), getRenderDeploys(5)]);
      res.json({ ok: status.apiAvailable && deploys.ok, executed: true, providerId, action, status, deploys: deploys.deploys, error: deploys.error, rawValuesReturned: false });
      return;
    }

    if (providerId === "railway") {
      if (action === "env_write") {
        const variables = req.body?.variables && typeof req.body.variables === "object" ? req.body.variables : {};
        const result = await applyRailwayVariablesViaApi(variables, { replace: false, skipDeploys: req.body?.skipDeploys !== false });
        if (!result.ok) { res.status(502).json({ ok: false, executed: false, error: result.error, fallbackNeeded: result.fallbackNeeded }); return; }
        res.json({ ok: true, executed: true, providerId, action, modeUsed: result.modeUsed, appliedKeys: result.appliedKeys, rawValuesReturned: false });
        return;
      }
      const status = await getRailwayConnectorStatus();
      res.json({ ok: status.apiAvailable || status.cliAvailable || status.mcpAvailable, executed: true, providerId, action, status, rawValuesReturned: false });
      return;
    }

    res.status(400).json({ ok: false, blocked: true, blockedReason: "runtime_action_not_mapped" });
  } catch (err) {
    logger.error({ err, providerId, action }, "Verified provider execution failed");
    res.status(500).json({ ok: false, executed: false, error: "Provider execution failed" });
  }
});

export default router;
