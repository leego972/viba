/**
 * VIBA App Store Deployment Engine
 *
 * Automates iOS App Store shipping without 2FA friction:
 * - App Store Connect API auth via JWT signed with a .p8 private key (ES256)
 *   — API-key auth never triggers Apple 2FA, so it is fully automatable.
 * - Reads app + version state from the App Store Connect API
 * - Updates listing metadata (description, keywords, promo text, release notes)
 * - Creates new app versions and submits them for review
 * - Triggers Expo EAS builds via the EAS API using an EXPO_TOKEN (no interactive login)
 *
 * Security:
 * - The .p8 key, Key ID, Issuer ID, and Expo token are stored in the VIBA vault
 *   (viba_credentials, AES-256-GCM encrypted) and never returned to clients.
 * - JWTs are short-lived (max 20 minutes per Apple's rules; we use 15).
 */
import crypto from "node:crypto";
import { logger } from "../lib/logger";

// ─── Constants ────────────────────────────────────────────────────────────────

const ASC_API_BASE = "https://api.appstoreconnect.apple.com/v1";
const EAS_API_BASE = "https://api.expo.dev/graphql";
const JWT_TTL_SECONDS = 15 * 60; // Apple max is 20 minutes

export const APPSTORE_CREDENTIAL_PROVIDER = "apple_appstore";
export const APPSTORE_CREDENTIAL_KINDS = {
  p8Key: "asc_p8_private_key",
  keyId: "asc_key_id",
  issuerId: "asc_issuer_id",
  expoToken: "expo_access_token",
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AscCredentials {
  keyId: string;
  issuerId: string;
  p8Key: string; // PEM contents of the .p8 file
}

export interface AscApp {
  id: string;
  bundleId: string;
  name: string;
  sku: string | null;
  primaryLocale: string | null;
}

export interface AscVersion {
  id: string;
  versionString: string;
  appStoreState: string;
  platform: string;
  createdDate: string | null;
}

export interface ListingMetadata {
  description?: string;
  keywords?: string;
  promotionalText?: string;
  whatsNew?: string;
  marketingUrl?: string;
  supportUrl?: string;
}

export interface PipelineStep {
  step: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  detail: string;
  at: string;
}

// ─── JWT (ES256) — no external deps, node:crypto only ─────────────────────────

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Generate a short-lived App Store Connect API JWT.
 * Apple requires: ES256, kid header, iss = issuerId, aud = appstoreconnect-v1.
 */
export function generateAscJwt(creds: AscCredentials): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: creds.keyId, typ: "JWT" };
  const payload = {
    iss: creds.issuerId,
    iat: now,
    exp: now + JWT_TTL_SECONDS,
    aud: "appstoreconnect-v1",
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: creds.p8Key,
    dsaEncoding: "ieee-p1363", // JOSE-style raw (r||s) signature required for ES256 JWTs
  });
  return `${signingInput}.${b64url(signature)}`;
}

/** Validate that a string looks like a usable .p8 EC private key. */
export function validateP8Key(p8: string): { valid: boolean; error: string | null } {
  const trimmed = p8.trim();
  if (!trimmed.includes("-----BEGIN PRIVATE KEY-----") || !trimmed.includes("-----END PRIVATE KEY-----")) {
    return { valid: false, error: "Key must be a PEM .p8 file containing BEGIN/END PRIVATE KEY markers." };
  }
  try {
    const keyObj = crypto.createPrivateKey(trimmed);
    if (keyObj.asymmetricKeyType !== "ec") {
      return { valid: false, error: `Expected an EC (P-256) key, got '${keyObj.asymmetricKeyType}'.` };
    }
    return { valid: true, error: null };
  } catch (err) {
    return { valid: false, error: `Key could not be parsed: ${err instanceof Error ? err.message : "unknown error"}` };
  }
}

// ─── ASC API client ───────────────────────────────────────────────────────────

async function ascRequest<T>(
  creds: AscCredentials,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  const token = generateAscJwt(creds);
  try {
    const res = await fetch(`${ASC_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      const errObj = data as { errors?: Array<{ title?: string; detail?: string }> } | null;
      const firstErr = errObj?.errors?.[0];
      const errorMsg = firstErr ? `${firstErr.title ?? "Error"}: ${firstErr.detail ?? ""}`.trim() : `HTTP ${res.status}`;
      return { ok: false, status: res.status, data: null, error: errorMsg };
    }
    return { ok: true, status: res.status, data: data as T, error: null };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : "Network error" };
  }
}

/** Verify credentials by listing apps — the cheapest authenticated ASC call. */
export async function verifyAscCredentials(creds: AscCredentials): Promise<{ ok: boolean; appsCount: number; error: string | null }> {
  const result = await ascRequest<{ data: Array<Record<string, unknown>> }>(creds, "GET", "/apps?limit=5");
  if (!result.ok) return { ok: false, appsCount: 0, error: result.error };
  return { ok: true, appsCount: result.data?.data?.length ?? 0, error: null };
}

interface AscAppResource {
  id: string;
  attributes: { bundleId?: string; name?: string; sku?: string; primaryLocale?: string };
}

/** List apps in the App Store Connect account. */
export async function listAscApps(creds: AscCredentials): Promise<{ ok: boolean; apps: AscApp[]; error: string | null }> {
  const result = await ascRequest<{ data: AscAppResource[] }>(creds, "GET", "/apps?limit=50");
  if (!result.ok || !result.data) return { ok: false, apps: [], error: result.error };
  const apps = result.data.data.map((a) => ({
    id: a.id,
    bundleId: a.attributes.bundleId ?? "",
    name: a.attributes.name ?? "",
    sku: a.attributes.sku ?? null,
    primaryLocale: a.attributes.primaryLocale ?? null,
  }));
  return { ok: true, apps, error: null };
}

interface AscVersionResource {
  id: string;
  attributes: { versionString?: string; appStoreState?: string; platform?: string; createdDate?: string };
}

/** List versions for an app (most recent first). */
export async function listAppVersions(creds: AscCredentials, appId: string): Promise<{ ok: boolean; versions: AscVersion[]; error: string | null }> {
  const result = await ascRequest<{ data: AscVersionResource[] }>(
    creds, "GET", `/apps/${encodeURIComponent(appId)}/appStoreVersions?limit=10`,
  );
  if (!result.ok || !result.data) return { ok: false, versions: [], error: result.error };
  const versions = result.data.data.map((v) => ({
    id: v.id,
    versionString: v.attributes.versionString ?? "",
    appStoreState: v.attributes.appStoreState ?? "UNKNOWN",
    platform: v.attributes.platform ?? "IOS",
    createdDate: v.attributes.createdDate ?? null,
  }));
  return { ok: true, versions, error: null };
}

/** Create a new App Store version for an app. */
export async function createAppVersion(
  creds: AscCredentials, appId: string, versionString: string,
): Promise<{ ok: boolean; versionId: string | null; error: string | null }> {
  const body = {
    data: {
      type: "appStoreVersions",
      attributes: { platform: "IOS", versionString },
      relationships: { app: { data: { type: "apps", id: appId } } },
    },
  };
  const result = await ascRequest<{ data: { id: string } }>(creds, "POST", "/appStoreVersions", body);
  if (!result.ok || !result.data) return { ok: false, versionId: null, error: result.error };
  return { ok: true, versionId: result.data.data.id, error: null };
}

/** Update localized listing metadata for a version. */
export async function updateVersionMetadata(
  creds: AscCredentials, versionId: string, locale: string, metadata: ListingMetadata,
): Promise<{ ok: boolean; error: string | null }> {
  // Find the localization record for the requested locale
  const locResult = await ascRequest<{ data: Array<{ id: string; attributes: { locale?: string } }> }>(
    creds, "GET", `/appStoreVersions/${encodeURIComponent(versionId)}/appStoreVersionLocalizations?limit=20`,
  );
  if (!locResult.ok || !locResult.data) return { ok: false, error: locResult.error };

  const loc = locResult.data.data.find((l) => l.attributes.locale === locale) ?? locResult.data.data[0];
  if (!loc) return { ok: false, error: `No localization found for locale '${locale}'.` };

  const attributes: Record<string, string> = {};
  if (metadata.description) attributes["description"] = metadata.description;
  if (metadata.keywords) attributes["keywords"] = metadata.keywords;
  if (metadata.promotionalText) attributes["promotionalText"] = metadata.promotionalText;
  if (metadata.whatsNew) attributes["whatsNew"] = metadata.whatsNew;
  if (metadata.marketingUrl) attributes["marketingUrl"] = metadata.marketingUrl;
  if (metadata.supportUrl) attributes["supportUrl"] = metadata.supportUrl;
  if (Object.keys(attributes).length === 0) return { ok: true, error: null };

  const body = { data: { type: "appStoreVersionLocalizations", id: loc.id, attributes } };
  const result = await ascRequest(creds, "PATCH", `/appStoreVersionLocalizations/${encodeURIComponent(loc.id)}`, body);
  return { ok: result.ok, error: result.error };
}

/** Select the latest valid build for a version (required before submission). */
export async function attachLatestBuild(
  creds: AscCredentials, appId: string, versionId: string,
): Promise<{ ok: boolean; buildId: string | null; error: string | null }> {
  const buildsResult = await ascRequest<{ data: Array<{ id: string; attributes: { processingState?: string; version?: string } }> }>(
    creds, "GET", `/builds?filter[app]=${encodeURIComponent(appId)}&sort=-uploadedDate&limit=5`,
  );
  if (!buildsResult.ok || !buildsResult.data) return { ok: false, buildId: null, error: buildsResult.error };

  const validBuild = buildsResult.data.data.find((b) => b.attributes.processingState === "VALID");
  if (!validBuild) {
    return { ok: false, buildId: null, error: "No processed (VALID) build found. Run an EAS build first and wait for Apple to finish processing it." };
  }

  const body = { data: { type: "builds", id: validBuild.id } };
  const result = await ascRequest(
    creds, "PATCH", `/appStoreVersions/${encodeURIComponent(versionId)}/relationships/build`, body,
  );
  if (!result.ok) return { ok: false, buildId: null, error: result.error };
  return { ok: true, buildId: validBuild.id, error: null };
}

/** Submit a version for App Review. */
export async function submitForReview(
  creds: AscCredentials, versionId: string,
): Promise<{ ok: boolean; submissionId: string | null; error: string | null }> {
  const body = {
    data: {
      type: "appStoreVersionSubmissions",
      relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } },
    },
  };
  const result = await ascRequest<{ data: { id: string } }>(creds, "POST", "/appStoreVersionSubmissions", body);
  if (!result.ok || !result.data) return { ok: false, submissionId: null, error: result.error };
  return { ok: true, submissionId: result.data.data.id, error: null };
}

// ─── Expo EAS build trigger ───────────────────────────────────────────────────

/**
 * Verify an Expo access token by querying the viewer account.
 * Expo tokens are created at https://expo.dev/settings/access-tokens and
 * never require interactive login or 2FA.
 */
export async function verifyExpoToken(expoToken: string): Promise<{ ok: boolean; username: string | null; error: string | null }> {
  try {
    const res = await fetch(EAS_API_BASE, {
      method: "POST",
      headers: { Authorization: `Bearer ${expoToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query { meActor { __typename ... on UserActor { username } } }" }),
    });
    const data = (await res.json()) as { data?: { meActor?: { username?: string } | null }; errors?: Array<{ message?: string }> };
    if (data.errors?.length) return { ok: false, username: null, error: data.errors[0]?.message ?? "Expo API error" };
    if (!data.data?.meActor) return { ok: false, username: null, error: "Token is invalid or expired." };
    return { ok: true, username: data.data.meActor.username ?? null, error: null };
  } catch (err) {
    return { ok: false, username: null, error: err instanceof Error ? err.message : "Network error" };
  }
}

/**
 * Generate the exact non-interactive EAS build command for a repo.
 * VIBA does not run arbitrary builds on this server (no macOS/Xcode here);
 * instead it produces a ready-to-run command + CI workflow that uses the
 * stored credentials as environment variables — zero interactive prompts.
 */
export function generateEasBuildPlan(input: {
  repoUrl: string;
  appDir: string;
  keyId: string;
  issuerId: string;
  ascAppId: string | null;
  autoSubmit: boolean;
}): { command: string; envVars: string[]; githubWorkflowYaml: string } {
  const submitFlag = input.autoSubmit ? " --auto-submit" : "";
  const command = [
    `cd ${input.appDir || "."}`,
    `npx eas-cli build --platform ios --profile production --non-interactive${submitFlag}`,
  ].join(" && ");

  const envVars = [
    "EXPO_TOKEN (Expo access token — replaces interactive login)",
    "EXPO_APPLE_API_KEY_PATH (path to the .p8 file)",
    `EXPO_APPLE_API_KEY_ID=${input.keyId}`,
    `EXPO_APPLE_API_ISSUER_ID=${input.issuerId}`,
  ];

  const githubWorkflowYaml = `name: Ship iOS to App Store
on:
  workflow_dispatch: {}
jobs:
  build-and-submit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Write Apple API key
        run: echo "\${{ secrets.APPLE_P8_KEY }}" > /tmp/apple_api_key.p8
      - name: Install deps
        working-directory: ${input.appDir || "."}
        run: npm install
      - name: EAS build & submit
        working-directory: ${input.appDir || "."}
        env:
          EXPO_TOKEN: \${{ secrets.EXPO_TOKEN }}
          EXPO_APPLE_API_KEY_PATH: /tmp/apple_api_key.p8
          EXPO_APPLE_API_KEY_ID: ${input.keyId}
          EXPO_APPLE_API_ISSUER_ID: ${input.issuerId}
        run: npx eas-cli build --platform ios --profile production --non-interactive${submitFlag}
`;

  return { command, envVars, githubWorkflowYaml };
}

// ─── Pipeline orchestration ───────────────────────────────────────────────────

export interface ShipPipelineInput {
  creds: AscCredentials;
  appId: string;
  versionString: string | null; // null → reuse editable version if present
  locale: string;
  metadata: ListingMetadata;
  attachBuild: boolean;
  submit: boolean;
}

const EDITABLE_STATES = new Set([
  "PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY",
]);

/**
 * Run the full ship pipeline: verify auth → resolve/create version →
 * update metadata → attach latest build → submit for review.
 * Each step records evidence; the pipeline stops on the first hard failure.
 */
export async function runShipPipeline(input: ShipPipelineInput): Promise<{ ok: boolean; steps: PipelineStep[]; versionId: string | null }> {
  const steps: PipelineStep[] = [];
  const stamp = () => new Date().toISOString();
  const push = (step: string, status: PipelineStep["status"], detail: string) => {
    steps.push({ step, status, detail, at: stamp() });
  };

  // Step 1 — verify credentials
  const verify = await verifyAscCredentials(input.creds);
  if (!verify.ok) {
    push("verify_credentials", "failed", verify.error ?? "Credential check failed");
    return { ok: false, steps, versionId: null };
  }
  push("verify_credentials", "passed", `Authenticated with App Store Connect (${verify.appsCount} apps visible).`);

  // Step 2 — resolve version
  let versionId: string | null = null;
  const versionsResult = await listAppVersions(input.creds, input.appId);
  if (!versionsResult.ok) {
    push("resolve_version", "failed", versionsResult.error ?? "Could not list versions");
    return { ok: false, steps, versionId: null };
  }
  const editable = versionsResult.versions.find((v) => EDITABLE_STATES.has(v.appStoreState));
  if (editable) {
    versionId = editable.id;
    push("resolve_version", "passed", `Using editable version ${editable.versionString} (${editable.appStoreState}).`);
  } else if (input.versionString) {
    const created = await createAppVersion(input.creds, input.appId, input.versionString);
    if (!created.ok || !created.versionId) {
      push("resolve_version", "failed", created.error ?? "Could not create version");
      return { ok: false, steps, versionId: null };
    }
    versionId = created.versionId;
    push("resolve_version", "passed", `Created new version ${input.versionString}.`);
  } else {
    push("resolve_version", "failed", "No editable version exists and no versionString was provided to create one.");
    return { ok: false, steps, versionId: null };
  }

  // Step 3 — update metadata
  const hasMetadata = Object.values(input.metadata).some((v) => typeof v === "string" && v.length > 0);
  if (hasMetadata) {
    const meta = await updateVersionMetadata(input.creds, versionId, input.locale, input.metadata);
    if (!meta.ok) {
      push("update_metadata", "failed", meta.error ?? "Metadata update failed");
      return { ok: false, steps, versionId };
    }
    push("update_metadata", "passed", `Listing metadata updated (locale ${input.locale}).`);
  } else {
    push("update_metadata", "skipped", "No metadata fields provided.");
  }

  // Step 4 — attach latest processed build
  if (input.attachBuild) {
    const attach = await attachLatestBuild(input.creds, input.appId, versionId);
    if (!attach.ok) {
      push("attach_build", "failed", attach.error ?? "Build attach failed");
      return { ok: false, steps, versionId };
    }
    push("attach_build", "passed", `Attached build ${attach.buildId}.`);
  } else {
    push("attach_build", "skipped", "Build attach not requested.");
  }

  // Step 5 — submit for review
  if (input.submit) {
    const submit = await submitForReview(input.creds, versionId);
    if (!submit.ok) {
      push("submit_for_review", "failed", submit.error ?? "Submission failed");
      return { ok: false, steps, versionId };
    }
    push("submit_for_review", "passed", `Submitted for App Review (submission ${submit.submissionId}). Apple typically reviews within 24-72 hours.`);
  } else {
    push("submit_for_review", "skipped", "Submission not requested.");
  }

  logger.info({ appId: input.appId, versionId, stepCount: steps.length }, "App Store ship pipeline completed");
  return { ok: true, steps, versionId };
}
