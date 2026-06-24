import { Router, type IRouter } from "express";
  import crypto from "node:crypto";
  import { requireAdmin, requireConfirmation } from "../middlewares/adminAuth";

  const router: IRouter = Router();

  const ALLOWED_VARS = new Set([
    "DATABASE_URL", "SESSION_SECRET", "PUBLIC_ORIGIN", "ACCESS_TOKEN", "CREDENTIAL_ENCRYPTION_KEY",
    "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM",
    "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID",
    "STRIPE_BILLING_SUBSCRIPTION_PRICE_ID", "STRIPE_BILLING_PRO_SUBSCRIPTION_PRICE_ID",
    "STRIPE_BILLING_CREDITS_1000_PRICE_ID", "STRIPE_BILLING_CREDITS_2000_PRICE_ID",
    "STRIPE_BILLING_CREDITS_3000_PRICE_ID", "STRIPE_BILLING_CREDITS_4000_PRICE_ID",
    "STRIPE_BILLING_CREDITS_5000_PRICE_ID", "STRIPE_BILLING_CREDITS_6000_PRICE_ID",
    "STRIPE_BILLING_LAUNCH_SETUP_PRICE_ID",
    "CORS_ALLOWED_ORIGINS",
  ]);

  const CORE_SECRET_KEYS = ["SESSION_SECRET", "ACCESS_TOKEN", "CREDENTIAL_ENCRYPTION_KEY"] as const;
  const REQUIRED_VARS = ["DATABASE_URL", "SESSION_SECRET", "PUBLIC_ORIGIN", "ACCESS_TOKEN", "CREDENTIAL_ENCRYPTION_KEY"];
  const CONFIRM_TEXT = "CONFIRM RAILWAY SETUP";

  function redact(vars: Record<string, string>, generated: string[]): Array<{ key: string; status: string; redacted: string }> {
    return Object.keys(vars).map((key) => ({
      key,
      status: generated.includes(key) ? "generated" : "provided",
      redacted: "SET",
    }));
  }

  // GET /api/setup/requirements
  router.get("/setup/requirements", (_req, res): void => {
    res.json({
      requiredVars: REQUIRED_VARS,
      allowedVars: Array.from(ALLOWED_VARS),
      coreSecrets: CORE_SECRET_KEYS,
      railwayTokenRequired: true,
      confirmText: CONFIRM_TEXT,
      paidProduct: {
        name: "VIBA Launch Setup",
        price: "$299 USD one-time",
        stripeEnvVar: "STRIPE_BILLING_LAUNCH_SETUP_PRICE_ID",
      },
    });
  });

  // GET /api/setup/status
  router.get("/setup/status", (_req, res): void => {
    res.json({
      railwayTokenConfigured: Boolean(process.env.RAILWAY_TOKEN),
      coreVars: REQUIRED_VARS.map((key) => ({ key, configured: Boolean(process.env[key]) })),
      allCoreConfigured: REQUIRED_VARS.every((k) => Boolean(process.env[k])),
    });
  });

  // POST /api/setup/dry-run
  router.post("/setup/dry-run", (req, res): void => {
    const body = req.body as {
      railwayProjectId?: unknown; railwayEnvironmentId?: unknown; railwayServiceId?: unknown;
      variables?: unknown; generateMissingCoreSecrets?: unknown;
    };
    const rawVars = (typeof body.variables === "object" && body.variables !== null && !Array.isArray(body.variables))
      ? (body.variables as Record<string, unknown>) : {};
    const provided = Object.keys(rawVars).filter((k) => ALLOWED_VARS.has(k));
    const rejected = Object.keys(rawVars).filter((k) => !ALLOWED_VARS.has(k));
    const missingRequired = REQUIRED_VARS.filter((k) => !provided.includes(k) && !process.env[k]);
    const willGenerate = body.generateMissingCoreSecrets === true
      ? (CORE_SECRET_KEYS as readonly string[]).filter((k) => !provided.includes(k) && !process.env[k])
      : [];
    res.json({
      dryRun: true,
      railwayTokenConfigured: Boolean(process.env.RAILWAY_TOKEN),
      projectId: typeof body.railwayProjectId === "string" ? body.railwayProjectId : null,
      environmentId: typeof body.railwayEnvironmentId === "string" ? body.railwayEnvironmentId : null,
      serviceId: typeof body.railwayServiceId === "string" ? body.railwayServiceId : null,
      variablesProvided: provided,
      variablesRejected: rejected,
      missingRequired,
      willGenerate,
      railwayCallMade: false,
      valuesReturned: false,
      readyToApply: Boolean(process.env.RAILWAY_TOKEN) && missingRequired.length === 0 && provided.length > 0,
    });
  });

  // POST /api/setup/apply — admin + confirmation + confirmText + RAILWAY_TOKEN
  router.post("/setup/apply", requireAdmin, requireConfirmation, async (req, res): Promise<void> => {
    const body = req.body as {
      railwayProjectId?: unknown; railwayEnvironmentId?: unknown; railwayServiceId?: unknown;
      publicOrigin?: unknown; domain?: unknown; variables?: unknown;
      generateMissingCoreSecrets?: unknown; skipDeploys?: unknown;
      replace?: unknown; confirmText?: unknown;
    };

    if (body.confirmText !== CONFIRM_TEXT) {
      res.status(400).json({ error: "CONFIRM_TEXT_MISMATCH", message: `confirmText must be exactly: ${CONFIRM_TEXT}` });
      return;
    }

    const railwayToken = process.env.RAILWAY_TOKEN;
    if (!railwayToken) {
      res.status(400).json({ error: "RAILWAY_TOKEN_MISSING", message: "Add RAILWAY_TOKEN to server environment first." });
      return;
    }

    const projectId = typeof body.railwayProjectId === "string" ? body.railwayProjectId.trim() : "";
    const environmentId = typeof body.railwayEnvironmentId === "string" ? body.railwayEnvironmentId.trim() : "";
    const serviceId = typeof body.railwayServiceId === "string" ? body.railwayServiceId.trim() : "";
    if (!projectId || !environmentId || !serviceId) {
      res.status(400).json({ error: "RAILWAY_IDS_REQUIRED", message: "railwayProjectId, railwayEnvironmentId, and railwayServiceId are all required." });
      return;
    }

    const rawVars = (typeof body.variables === "object" && body.variables !== null && !Array.isArray(body.variables))
      ? (body.variables as Record<string, unknown>) : {};
    const filteredVars: Record<string, string> = {};
    for (const [key, val] of Object.entries(rawVars)) {
      if (ALLOWED_VARS.has(key) && typeof val === "string" && val.trim()) filteredVars[key] = val.trim();
    }

    const generated: string[] = [];
    if (body.generateMissingCoreSecrets === true) {
      for (const key of CORE_SECRET_KEYS) {
        if (!filteredVars[key] && !process.env[key]) {
          filteredVars[key] = crypto.randomBytes(48).toString("base64");
          generated.push(key);
        }
      }
    }

    const skipDeploys = body.skipDeploys !== false;
    const replace = body.replace === true;

    req.log.info({ projectId, environmentId, serviceId, keyCount: Object.keys(filteredVars).length, skipDeploys, replace, generated }, "setup/apply: Railway variableCollectionUpsert");

    const mutation = `mutation SetupApply($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`;

    let railwayOk = false;
    let railwayErrors: unknown[] = [];
    try {
      const gqlRes = await fetch("https://backboard.railway.app/graphql/v2", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${railwayToken}`,
          "Content-Type": "application/json",
          "User-Agent": "VIBA-Setup-Runner/1.0",
        },
        body: JSON.stringify({ query: mutation, variables: { input: { projectId, environmentId, serviceId, variables: filteredVars, skipDeploys, replace } } }),
      });
      const gqlData = await gqlRes.json() as { data?: unknown; errors?: unknown[] };
      if (gqlData.errors?.length) {
        req.log.warn({ errors: gqlData.errors }, "setup/apply: Railway returned errors");
        railwayErrors = gqlData.errors;
      } else {
        railwayOk = true;
      }
    } catch (err) {
      req.log.error({ err }, "setup/apply: Railway API call failed");
      res.status(502).json({ error: "RAILWAY_API_ERROR", message: err instanceof Error ? err.message : "Railway API unreachable" });
      return;
    }

    if (!railwayOk) {
      res.status(502).json({ error: "RAILWAY_MUTATION_FAILED", message: "Railway returned errors.", railwayErrors });
      return;
    }

    const domain = typeof body.domain === "string" && body.domain.trim()
      ? body.domain.trim()
      : typeof body.publicOrigin === "string" ? body.publicOrigin.replace(/^https?:\/\//, "").split("/")[0] : "";

    res.json({
      applied: true,
      appliedCount: Object.keys(filteredVars).length,
      variables: redact(filteredVars, generated),
      generated,
      valuesReturned: false,
      skipDeploys,
      replace,
      domainAction: "manual_dns_required",
      domainGuidance: domain
        ? [`1. Add custom domain in Railway dashboard: ${domain}`, "2. Copy the Railway DNS target shown after adding.", `3. At your domain provider: set root @ as ALIAS/ANAME to Railway target; or www as CNAME.`, `4. Set PUBLIC_ORIGIN=https://${domain} in Railway env vars.`]
        : ["No domain provided — set PUBLIC_ORIGIN manually in Railway."],
      nextSteps: ["Verify /api/healthz returns HTTP 200.", "Test auth, dashboard, sessions, providers, Doctor, reports, share links, owner actions, and setup assistant.", domain ? `Verify https://${domain} resolves after DNS propagation.` : "Set PUBLIC_ORIGIN and verify your domain."],
    });
  });

  export default router;
  