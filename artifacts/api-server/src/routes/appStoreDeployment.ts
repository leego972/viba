/**
 * VIBA "Ship to App Store" API
 *
 * GET    /api/appstore/status                — credential readiness (metadata only)
 * POST   /api/appstore/credentials           — save .p8 key + Key ID + Issuer ID (+ optional Expo token)
 * DELETE /api/appstore/credentials           — remove stored Apple credentials
 * POST   /api/appstore/verify                — live verify against ASC + Expo APIs
 * GET    /api/appstore/apps                  — list apps in the connected ASC account
 * GET    /api/appstore/apps/:appId/versions  — list App Store versions for an app
 * POST   /api/appstore/build-plan            — generate non-interactive EAS build command + CI workflow
 * POST   /api/appstore/ship                  — run the full ship pipeline (metadata → build attach → submit)
 *
 * Security rules (same as deploymentProviders):
 * - Raw credential values are never returned — rawValuesReturned: false on every response
 * - The ship pipeline requires explicit `confirm: true` in the request body
 * - All credential access is logged via the vault's activity log
 */
import { Router, type IRouter } from "express";
import {
  saveVibaCredential,
  getVibaCredential,
  deleteVibaCredential,
  logVibaEvent,
} from "../lib/vibaVault";
import {
  APPSTORE_CREDENTIAL_PROVIDER,
  APPSTORE_CREDENTIAL_KINDS,
  validateP8Key,
  verifyAscCredentials,
  verifyExpoToken,
  listAscApps,
  listAppVersions,
  generateEasBuildPlan,
  runShipPipeline,
  type AscCredentials,
  type ListingMetadata,
} from "../engines/appStoreDeploymentEngine";

const router: IRouter = Router();

// ─── Auth helper (matches deploymentProviders pattern) ────────────────────────
function uid(req: { session?: { userId?: number } }): number {
  return typeof req.session?.userId === "number" ? req.session.userId : 0;
}

// ─── Credential resolution ────────────────────────────────────────────────────
async function loadAscCredentials(userId: number): Promise<{ creds: AscCredentials | null; missing: string[] }> {
  const [p8Key, keyId, issuerId] = await Promise.all([
    getVibaCredential({ userId, provider: APPSTORE_CREDENTIAL_PROVIDER, kind: APPSTORE_CREDENTIAL_KINDS.p8Key }),
    getVibaCredential({ userId, provider: APPSTORE_CREDENTIAL_PROVIDER, kind: APPSTORE_CREDENTIAL_KINDS.keyId }),
    getVibaCredential({ userId, provider: APPSTORE_CREDENTIAL_PROVIDER, kind: APPSTORE_CREDENTIAL_KINDS.issuerId }),
  ]);
  const missing: string[] = [];
  if (!p8Key) missing.push("p8 private key");
  if (!keyId) missing.push("Key ID");
  if (!issuerId) missing.push("Issuer ID");
  if (missing.length > 0) return { creds: null, missing };
  return { creds: { p8Key: p8Key as string, keyId: keyId as string, issuerId: issuerId as string }, missing: [] };
}

// ─── GET /api/appstore/status ─────────────────────────────────────────────────
router.get("/api/appstore/status", async (req, res): Promise<void> => {
  const userId = uid(req);
  const { creds, missing } = await loadAscCredentials(userId);
  const expoToken = await getVibaCredential({
    userId, provider: APPSTORE_CREDENTIAL_PROVIDER, kind: APPSTORE_CREDENTIAL_KINDS.expoToken,
  });
  res.json({
    ok: true,
    appleConfigured: creds !== null,
    expoConfigured: Boolean(expoToken),
    missing,
    rawValuesReturned: false,
  });
});

// ─── POST /api/appstore/credentials ──────────────────────────────────────────
router.post("/api/appstore/credentials", async (req, res): Promise<void> => {
  const userId = uid(req);
  const body = req.body as { p8Key?: unknown; keyId?: unknown; issuerId?: unknown; expoToken?: unknown };

  const p8Key = typeof body.p8Key === "string" ? body.p8Key.trim() : "";
  const keyId = typeof body.keyId === "string" ? body.keyId.trim() : "";
  const issuerId = typeof body.issuerId === "string" ? body.issuerId.trim() : "";
  const expoToken = typeof body.expoToken === "string" ? body.expoToken.trim() : "";

  const saved: string[] = [];

  if (p8Key) {
    const check = validateP8Key(p8Key);
    if (!check.valid) {
      res.status(400).json({ error: check.error, rawValuesReturned: false });
      return;
    }
    await saveVibaCredential({
      userId, provider: APPSTORE_CREDENTIAL_PROVIDER, kind: APPSTORE_CREDENTIAL_KINDS.p8Key,
      value: p8Key, scope: "appstore_deploy",
    });
    saved.push("p8Key");
  }
  if (keyId) {
    if (!/^[A-Z0-9]{8,12}$/i.test(keyId)) {
      res.status(400).json({ error: "Key ID should be an 8-12 character alphanumeric string (e.g. 2WG5YUFL55).", rawValuesReturned: false });
      return;
    }
    await saveVibaCredential({
      userId, provider: APPSTORE_CREDENTIAL_PROVIDER, kind: APPSTORE_CREDENTIAL_KINDS.keyId,
      value: keyId, scope: "appstore_deploy",
    });
    saved.push("keyId");
  }
  if (issuerId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(issuerId)) {
      res.status(400).json({ error: "Issuer ID should be a UUID (find it in App Store Connect → Users and Access → Integrations).", rawValuesReturned: false });
      return;
    }
    await saveVibaCredential({
      userId, provider: APPSTORE_CREDENTIAL_PROVIDER, kind: APPSTORE_CREDENTIAL_KINDS.issuerId,
      value: issuerId, scope: "appstore_deploy",
    });
    saved.push("issuerId");
  }
  if (expoToken) {
    await saveVibaCredential({
      userId, provider: APPSTORE_CREDENTIAL_PROVIDER, kind: APPSTORE_CREDENTIAL_KINDS.expoToken,
      value: expoToken, scope: "appstore_deploy",
    });
    saved.push("expoToken");
  }

  if (saved.length === 0) {
    res.status(400).json({ error: "No credential fields provided. Send p8Key, keyId, issuerId, and/or expoToken.", rawValuesReturned: false });
    return;
  }

  await logVibaEvent({
    userId, eventType: "appstore_credentials_saved", severity: "info",
    provider: APPSTORE_CREDENTIAL_PROVIDER, status: "saved",
    message: `App Store credentials saved: ${saved.join(", ")}`,
  });

  res.json({ ok: true, saved, rawValuesReturned: false });
});

// ─── DELETE /api/appstore/credentials ────────────────────────────────────────
router.delete("/api/appstore/credentials", async (req, res): Promise<void> => {
  const userId = uid(req);
  await Promise.all(
    Object.values(APPSTORE_CREDENTIAL_KINDS).map((kind) =>
      deleteVibaCredential({ userId, provider: APPSTORE_CREDENTIAL_PROVIDER, kind }),
    ),
  );
  await logVibaEvent({
    userId, eventType: "appstore_credentials_deleted", severity: "info",
    provider: APPSTORE_CREDENTIAL_PROVIDER, status: "deleted",
    message: "All App Store credentials removed from vault",
  });
  res.json({ ok: true, rawValuesReturned: false });
});

// ─── POST /api/appstore/verify ────────────────────────────────────────────────
router.post("/api/appstore/verify", async (req, res): Promise<void> => {
  const userId = uid(req);
  const { creds, missing } = await loadAscCredentials(userId);

  const result: {
    ok: boolean;
    apple: { ok: boolean; appsCount: number; error: string | null } | null;
    expo: { ok: boolean; username: string | null; error: string | null } | null;
    missing: string[];
    rawValuesReturned: false;
  } = { ok: false, apple: null, expo: null, missing, rawValuesReturned: false };

  if (creds) {
    result.apple = await verifyAscCredentials(creds);
  }

  const expoToken = await getVibaCredential({
    userId, provider: APPSTORE_CREDENTIAL_PROVIDER, kind: APPSTORE_CREDENTIAL_KINDS.expoToken,
  });
  if (expoToken) {
    result.expo = await verifyExpoToken(expoToken);
  }

  result.ok = Boolean(result.apple?.ok);
  await logVibaEvent({
    userId, eventType: "appstore_verify", severity: result.ok ? "info" : "warning",
    provider: APPSTORE_CREDENTIAL_PROVIDER, status: result.ok ? "valid" : "invalid",
    message: result.ok
      ? `App Store Connect verified (${result.apple?.appsCount ?? 0} apps).`
      : `Verification failed: ${result.apple?.error ?? missing.join(", ") ?? "unknown"}`,
  });

  res.json(result);
});

// ─── GET /api/appstore/apps ───────────────────────────────────────────────────
router.get("/api/appstore/apps", async (req, res): Promise<void> => {
  const userId = uid(req);
  const { creds, missing } = await loadAscCredentials(userId);
  if (!creds) {
    res.status(400).json({ error: `Missing credentials: ${missing.join(", ")}. Save them first.`, rawValuesReturned: false });
    return;
  }
  const result = await listAscApps(creds);
  if (!result.ok) {
    res.status(502).json({ error: result.error, rawValuesReturned: false });
    return;
  }
  res.json({ ok: true, apps: result.apps, count: result.apps.length, rawValuesReturned: false });
});

// ─── GET /api/appstore/apps/:appId/versions ──────────────────────────────────
router.get("/api/appstore/apps/:appId/versions", async (req, res): Promise<void> => {
  const userId = uid(req);
  const appId = req.params["appId"] as string;
  const { creds, missing } = await loadAscCredentials(userId);
  if (!creds) {
    res.status(400).json({ error: `Missing credentials: ${missing.join(", ")}.`, rawValuesReturned: false });
    return;
  }
  const result = await listAppVersions(creds, appId);
  if (!result.ok) {
    res.status(502).json({ error: result.error, rawValuesReturned: false });
    return;
  }
  res.json({ ok: true, versions: result.versions, rawValuesReturned: false });
});

// ─── POST /api/appstore/build-plan ────────────────────────────────────────────
router.post("/api/appstore/build-plan", async (req, res): Promise<void> => {
  const userId = uid(req);
  const body = req.body as { repoUrl?: unknown; appDir?: unknown; ascAppId?: unknown; autoSubmit?: unknown };
  const repoUrl = typeof body.repoUrl === "string" ? body.repoUrl.trim() : "";
  const appDir = typeof body.appDir === "string" ? body.appDir.trim() : ".";
  const ascAppId = typeof body.ascAppId === "string" ? body.ascAppId.trim() : null;
  const autoSubmit = body.autoSubmit === true;

  if (!repoUrl) {
    res.status(400).json({ error: "repoUrl is required.", rawValuesReturned: false });
    return;
  }

  const [keyId, issuerId] = await Promise.all([
    getVibaCredential({ userId, provider: APPSTORE_CREDENTIAL_PROVIDER, kind: APPSTORE_CREDENTIAL_KINDS.keyId }),
    getVibaCredential({ userId, provider: APPSTORE_CREDENTIAL_PROVIDER, kind: APPSTORE_CREDENTIAL_KINDS.issuerId }),
  ]);
  if (!keyId || !issuerId) {
    res.status(400).json({ error: "Save your Apple Key ID and Issuer ID first.", rawValuesReturned: false });
    return;
  }

  const plan = generateEasBuildPlan({ repoUrl, appDir, keyId, issuerId, ascAppId, autoSubmit });
  res.json({ ok: true, plan, note: "Add APPLE_P8_KEY and EXPO_TOKEN as GitHub secrets, commit the workflow, and trigger it — no Mac or 2FA needed.", rawValuesReturned: false });
});

// ─── POST /api/appstore/ship ──────────────────────────────────────────────────
router.post("/api/appstore/ship", async (req, res): Promise<void> => {
  const userId = uid(req);
  const body = req.body as {
    appId?: unknown; versionString?: unknown; locale?: unknown;
    metadata?: unknown; attachBuild?: unknown; submit?: unknown; confirm?: unknown;
  };

  const appId = typeof body.appId === "string" ? body.appId.trim() : "";
  if (!appId) {
    res.status(400).json({ error: "appId is required (get it from /api/appstore/apps).", rawValuesReturned: false });
    return;
  }
  if (body.confirm !== true) {
    res.status(400).json({ error: "This action modifies your live App Store listing. Pass confirm: true to proceed.", rawValuesReturned: false });
    return;
  }

  const { creds, missing } = await loadAscCredentials(userId);
  if (!creds) {
    res.status(400).json({ error: `Missing credentials: ${missing.join(", ")}.`, rawValuesReturned: false });
    return;
  }

  const rawMeta = (typeof body.metadata === "object" && body.metadata !== null ? body.metadata : {}) as Record<string, unknown>;
  const metadata: ListingMetadata = {};
  for (const key of ["description", "keywords", "promotionalText", "whatsNew", "marketingUrl", "supportUrl"] as const) {
    const v = rawMeta[key];
    if (typeof v === "string" && v.trim()) metadata[key] = v.trim();
  }

  const result = await runShipPipeline({
    creds,
    appId,
    versionString: typeof body.versionString === "string" && body.versionString.trim() ? body.versionString.trim() : null,
    locale: typeof body.locale === "string" && body.locale.trim() ? body.locale.trim() : "en-US",
    metadata,
    attachBuild: body.attachBuild === true,
    submit: body.submit === true,
  });

  await logVibaEvent({
    userId, eventType: "appstore_ship_pipeline", severity: result.ok ? "info" : "warning",
    provider: APPSTORE_CREDENTIAL_PROVIDER, status: result.ok ? "completed" : "failed",
    message: result.ok
      ? `Ship pipeline completed for app ${appId} (${result.steps.length} steps).`
      : `Ship pipeline failed for app ${appId}: ${result.steps[result.steps.length - 1]?.detail ?? "unknown"}`,
    metadata: { steps: result.steps.map((s) => ({ step: s.step, status: s.status })) },
  });

  res.json({ ok: result.ok, steps: result.steps, versionId: result.versionId, rawValuesReturned: false });
});

export default router;
