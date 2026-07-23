import { isIP } from "node:net";
import { Router, type IRouter } from "express";
import { createUserRateLimiter } from "../middlewares/rateLimiter";

const router: IRouter = Router();

function safeGithubSegment(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  return /^[A-Za-z0-9_.-]+$/.test(candidate) ? candidate : fallback;
}

const OWNER = safeGithubSegment(process.env.VIBA_MOBILE_GITHUB_OWNER, "leego972");
const REPO = safeGithubSegment(process.env.VIBA_MOBILE_GITHUB_REPO, "viba");
const WORKFLOW = safeGithubSegment(process.env.VIBA_MOBILE_WORKFLOW, "mobile-store-build.yml");
const REF = process.env.VIBA_MOBILE_GITHUB_REF?.trim() || "main";

const publishLimiter = createUserRateLimiter({
  windowMs: 10 * 60_000,
  max: 4,
  message: "Too many store builds were requested. Wait before starting another build.",
});

export type PublisherPlatform = "android" | "apple";
export type PublisherIssue = {
  field: string;
  message: string;
  severity: "error" | "warning";
};

export type PublisherInput = {
  platforms: PublisherPlatform[];
  websiteUrl: string;
  appName: string;
  bundleId: string;
  version: string;
  buildNumber: number;
};

export type PublisherValidation = {
  ok: boolean;
  score: number;
  issues: PublisherIssue[];
  input: PublisherInput;
  infrastructureVerified: boolean;
};

const ANDROID_SECRET_NAMES = [
  "VIBA_ANDROID_KEYSTORE_BASE64",
  "VIBA_ANDROID_KEYSTORE_PASSWORD",
  "VIBA_ANDROID_KEY_ALIAS",
  "VIBA_ANDROID_KEY_PASSWORD",
] as const;

const APPLE_SECRET_NAMES = [
  "VIBA_APPLE_TEAM_ID",
  "VIBA_APP_STORE_CONNECT_KEY_ID",
  "VIBA_APP_STORE_CONNECT_ISSUER_ID",
  "VIBA_APP_STORE_CONNECT_PRIVATE_KEY",
] as const;

function privateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function publicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase();
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) return false;
    const ipVersion = isIP(hostname);
    if (ipVersion === 4) return !privateIpv4(hostname);
    if (ipVersion === 6) {
      const compact = hostname.replace(/^\[|\]$/g, "").toLowerCase();
      return compact !== "::1" && !compact.startsWith("fc") && !compact.startsWith("fd") && !compact.startsWith("fe8") && !compact.startsWith("fe9") && !compact.startsWith("fea") && !compact.startsWith("feb");
    }
    return hostname.includes(".");
  } catch {
    return false;
  }
}

function validBundleId(value: string): boolean {
  return value.length <= 200 && /^[a-z][a-z0-9]*(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?){1,5}$/.test(value);
}

function validVersion(value: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(value)) return false;
  return value.split(".").every((part) => Number(part) <= 9999);
}

export function validatePublisherInput(body: Record<string, unknown>): {
  input: PublisherInput;
  issues: PublisherIssue[];
} {
  const rawPlatforms = Array.isArray(body.platforms) ? body.platforms : [];
  const invalidPlatforms = rawPlatforms.filter((platform) => platform !== "android" && platform !== "apple");
  const platforms = [...new Set(rawPlatforms.filter((platform): platform is PublisherPlatform => platform === "android" || platform === "apple"))];
  const websiteUrl = typeof body.websiteUrl === "string" ? body.websiteUrl.trim() : "";
  const appName = typeof body.appName === "string" ? body.appName.trim() : "";
  const bundleId = typeof body.bundleId === "string" ? body.bundleId.trim().toLowerCase() : "";
  const version = typeof body.version === "string" ? body.version.trim() : "";
  const parsedBuildNumber = typeof body.buildNumber === "number"
    ? body.buildNumber
    : typeof body.buildNumber === "string" && /^\d+$/.test(body.buildNumber.trim())
      ? Number(body.buildNumber)
      : Number.NaN;
  const buildNumber = Number.isSafeInteger(parsedBuildNumber) ? parsedBuildNumber : 0;
  const issues: PublisherIssue[] = [];

  if (!publicHttpsUrl(websiteUrl)) {
    issues.push({ field: "websiteUrl", message: "Enter a public HTTPS website URL.", severity: "error" });
  }
  if (appName.length < 2 || appName.length > 50) {
    issues.push({ field: "appName", message: "App name must contain 2 to 50 characters.", severity: "error" });
  }
  if (!validBundleId(bundleId)) {
    issues.push({ field: "bundleId", message: "Use a lowercase bundle ID such as com.company.app.", severity: "error" });
  }
  if (platforms.length === 0) {
    issues.push({ field: "platforms", message: "Select Google Play, Apple App Store, or both.", severity: "error" });
  }
  if (invalidPlatforms.length > 0) {
    issues.push({ field: "platforms", message: "An unsupported app store was supplied.", severity: "error" });
  }
  if (!validVersion(version)) {
    issues.push({ field: "version", message: "Version must use three numbers, for example 1.0.0.", severity: "error" });
  }
  if (buildNumber < 1 || buildNumber > 2_100_000_000) {
    issues.push({ field: "buildNumber", message: "Build number must be a positive whole number.", severity: "error" });
  }

  return {
    input: { platforms, websiteUrl, appName, bundleId, version, buildNumber },
    issues,
  };
}

export function buildWorkflowInputs(input: PublisherInput): Record<string, string> {
  const stores = input.platforms.length === 2 ? "both" : input.platforms[0];
  if (!stores) throw new Error("At least one publisher platform is required");
  return {
    stores,
    version: input.version,
    build_number: String(input.buildNumber),
    website_url: input.websiteUrl,
    app_name: input.appName,
    bundle_id: input.bundleId,
  };
}

async function githubRequest(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectInfrastructure(platforms: PublisherPlatform[]): Promise<{
  issues: PublisherIssue[];
  verified: boolean;
}> {
  const token = process.env.VIBA_MOBILE_GITHUB_TOKEN?.trim();
  if (!token) {
    return {
      verified: false,
      issues: [{ field: "automation", message: "GitHub build automation is not connected on the VIBA server.", severity: "error" }],
    };
  }

  try {
    const workflowPath = `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPO)}/actions/workflows/${encodeURIComponent(WORKFLOW)}`;
    const secretsPath = `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPO)}/actions/secrets?per_page=100`;
    const [workflowResponse, secretsResponse] = await Promise.all([
      githubRequest(workflowPath, token),
      githubRequest(secretsPath, token),
    ]);
    const issues: PublisherIssue[] = [];

    if (!workflowResponse.ok) {
      issues.push({
        field: "automation",
        message: workflowResponse.status === 404
          ? "The mobile store build workflow was not found."
          : "The GitHub connection cannot access the mobile build workflow.",
        severity: "error",
      });
    }

    if (!secretsResponse.ok) {
      issues.push({
        field: "signing",
        message: "VIBA could not verify the store-signing secrets. The build can only succeed when those GitHub secrets are configured.",
        severity: "warning",
      });
      return { issues, verified: false };
    }

    const payload = await secretsResponse.json() as { secrets?: Array<{ name?: string }> };
    const configured = new Set((payload.secrets ?? []).map((secret) => String(secret.name ?? "")));
    const required = new Set<string>();
    if (platforms.includes("android")) ANDROID_SECRET_NAMES.forEach((name) => required.add(name));
    if (platforms.includes("apple")) APPLE_SECRET_NAMES.forEach((name) => required.add(name));
    const missing = [...required].filter((name) => !configured.has(name));

    if (missing.length > 0) {
      issues.push({
        field: "signing",
        message: `Store signing is incomplete. Missing GitHub secret${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
        severity: "error",
      });
    }

    return { issues, verified: workflowResponse.ok };
  } catch {
    return {
      verified: false,
      issues: [{
        field: "automation",
        message: "VIBA could not verify GitHub build automation. Try the readiness check again.",
        severity: "warning",
      }],
    };
  }
}

async function validateRequest(body: Record<string, unknown>): Promise<PublisherValidation> {
  const local = validatePublisherInput(body);
  const infrastructure = local.issues.some((issue) => issue.severity === "error")
    ? { issues: [] as PublisherIssue[], verified: false }
    : await inspectInfrastructure(local.input.platforms);
  const issues = [...local.issues, ...infrastructure.issues];
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return {
    ok: errors === 0,
    score: Math.max(0, 100 - errors * 25 - warnings * 8),
    issues,
    input: local.input,
    infrastructureVerified: infrastructure.verified,
  };
}

router.post("/app-publisher/validate", async (req, res): Promise<void> => {
  const validation = await validateRequest(req.body as Record<string, unknown>);
  res.status(validation.ok ? 200 : 400).json(validation);
});

router.post("/app-publisher/publish", publishLimiter, async (req, res): Promise<void> => {
  const validation = await validateRequest(req.body as Record<string, unknown>);
  if (!validation.ok) {
    res.status(400).json({
      error: "publisher_validation_failed",
      message: "The app cannot be queued until the readiness errors are resolved.",
      ...validation,
    });
    return;
  }

  const token = process.env.VIBA_MOBILE_GITHUB_TOKEN?.trim();
  if (!token) {
    res.status(503).json({ error: "publisher_not_connected", message: "Publishing automation is not configured on the VIBA server." });
    return;
  }

  try {
    const response = await githubRequest(
      `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPO)}/actions/workflows/${encodeURIComponent(WORKFLOW)}/dispatches`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: REF, inputs: buildWorkflowInputs(validation.input) }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      req.log?.error?.({ githubStatus: response.status, detail: detail.slice(0, 500), owner: OWNER, repo: REPO, workflow: WORKFLOW }, "App publisher workflow dispatch failed");
      res.status(502).json({ error: "dispatch_failed", message: "VIBA could not start the store build. The GitHub automation rejected the request." });
      return;
    }

    const inputs = buildWorkflowInputs(validation.input);
    res.status(202).json({
      ok: true,
      status: "queued",
      stores: inputs.stores,
      version: validation.input.version,
      buildNumber: validation.input.buildNumber,
      appName: validation.input.appName,
      bundleId: validation.input.bundleId,
      websiteUrl: validation.input.websiteUrl,
      message: "The verified store build has been queued.",
    });
  } catch (error) {
    req.log?.error?.({ err: error, owner: OWNER, repo: REPO, workflow: WORKFLOW }, "App publisher workflow dispatch request failed");
    res.status(503).json({ error: "dispatch_unavailable", message: "GitHub build automation is temporarily unavailable." });
  }
});

export default router;
