import { isIP } from "node:net";
import { Router, type IRouter } from "express";
import { createUserRateLimiter } from "../middlewares/rateLimiter";
import { resolveVibaCredential, saveVibaCredential } from "../lib/vibaVault";

const router: IRouter = Router();

function safeGithubSegment(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  return /^[A-Za-z0-9_.-]+$/.test(candidate) ? candidate : fallback;
}

const DEFAULT_REPOSITORY = `${safeGithubSegment(process.env.VIBA_MOBILE_GITHUB_OWNER, "leego972")}/${safeGithubSegment(process.env.VIBA_MOBILE_GITHUB_REPO, "viba")}`;
const DEFAULT_WORKFLOW = safeGithubSegment(process.env.VIBA_MOBILE_WORKFLOW, "mobile-store-build.yml");
const DEFAULT_REF = process.env.VIBA_MOBILE_GITHUB_REF?.trim() || "main";

const publishLimiter = createUserRateLimiter({
  windowMs: 10 * 60_000,
  max: 4,
  message: "Too many store builds were requested. Wait before starting another build.",
});

export type PublisherPlatform = "android" | "apple";
export type PublisherIssue = { field: string; message: string; severity: "error" | "warning" };
export type PublisherInput = {
  platforms: PublisherPlatform[];
  websiteUrl: string;
  appName: string;
  bundleId: string;
  version: string;
  buildNumber: number;
  githubRepository: string;
  githubRef: string;
  githubWorkflow: string;
};
export type PublisherValidation = {
  ok: boolean;
  score: number;
  issues: PublisherIssue[];
  input: PublisherInput;
  infrastructureVerified: boolean;
};

type TokenSource = "request" | "vault" | "environment" | "none";
type ResolvedToken = { token: string | null; source: TokenSource };

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

function requestUserId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function normalizeGithubToken(value: unknown): string {
  if (typeof value !== "string") return "";
  let token = value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim();
  token = token.replace(/^(?:bearer|token)\s+/i, "").trim();
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    token = token.slice(1, -1).trim();
  }
  return token.replace(/\s+/g, "");
}

async function resolveGithubToken(userId: number | null, suppliedToken = ""): Promise<ResolvedToken> {
  const requestToken = normalizeGithubToken(suppliedToken);
  if (requestToken) return { token: requestToken, source: "request" };

  const saved = await resolveVibaCredential({
    userId,
    provider: "github",
    kind: "token",
    envNames: [],
    label: "default",
  });
  const vaultToken = normalizeGithubToken(saved.value);
  if (vaultToken) return { token: vaultToken, source: "vault" };

  const environmentToken = normalizeGithubToken(
    process.env.VIBA_MOBILE_GITHUB_TOKEN || process.env.GITHUB_TOKEN,
  );
  if (environmentToken) return { token: environmentToken, source: "environment" };

  return { token: null, source: "none" };
}

async function persistGithubToken(userId: number | null, token: string): Promise<void> {
  await saveVibaCredential({
    userId,
    provider: "github",
    kind: "token",
    value: normalizeGithubToken(token),
    label: "default",
  });
}

function privateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
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
      return compact !== "::1" && !compact.startsWith("fc") && !compact.startsWith("fd") &&
        !compact.startsWith("fe8") && !compact.startsWith("fe9") && !compact.startsWith("fea") && !compact.startsWith("feb");
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
  return /^\d+\.\d+\.\d+$/.test(value) && value.split(".").every((part) => Number(part) <= 9999);
}
function validRepository(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}
function validGithubRef(value: string): boolean {
  return value.length > 0 && value.length <= 255 && /^[A-Za-z0-9._/-]+$/.test(value) &&
    !value.includes("..") && !value.startsWith("/") && !value.endsWith("/");
}
function validWorkflow(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\.(?:yml|yaml)$/.test(value);
}

export function validatePublisherInput(body: Record<string, unknown>): {
  input: PublisherInput;
  githubToken: string;
  issues: PublisherIssue[];
} {
  const rawPlatforms = Array.isArray(body.platforms) ? body.platforms : [];
  const invalidPlatforms = rawPlatforms.filter((platform) => platform !== "android" && platform !== "apple");
  const platforms = [...new Set(rawPlatforms.filter((platform): platform is PublisherPlatform => platform === "android" || platform === "apple"))];
  const websiteUrl = typeof body.websiteUrl === "string" ? body.websiteUrl.trim() : "";
  const appName = typeof body.appName === "string" ? body.appName.trim() : "";
  const bundleId = typeof body.bundleId === "string" ? body.bundleId.trim().toLowerCase() : "";
  const version = typeof body.version === "string" ? body.version.trim() : "";
  const githubToken = normalizeGithubToken(body.githubToken);
  const githubRepository = typeof body.githubRepository === "string" && body.githubRepository.trim() ? body.githubRepository.trim() : DEFAULT_REPOSITORY;
  const githubRef = typeof body.githubRef === "string" && body.githubRef.trim() ? body.githubRef.trim() : DEFAULT_REF;
  const githubWorkflow = typeof body.githubWorkflow === "string" && body.githubWorkflow.trim() ? body.githubWorkflow.trim() : DEFAULT_WORKFLOW;
  const parsedBuildNumber = typeof body.buildNumber === "number" ? body.buildNumber :
    typeof body.buildNumber === "string" && /^\d+$/.test(body.buildNumber.trim()) ? Number(body.buildNumber) : Number.NaN;
  const buildNumber = Number.isSafeInteger(parsedBuildNumber) ? parsedBuildNumber : 0;
  const issues: PublisherIssue[] = [];

  if (!publicHttpsUrl(websiteUrl)) issues.push({ field: "websiteUrl", message: "Enter a public HTTPS website URL.", severity: "error" });
  if (appName.length < 2 || appName.length > 50) issues.push({ field: "appName", message: "App name must contain 2 to 50 characters.", severity: "error" });
  if (!validBundleId(bundleId)) issues.push({ field: "bundleId", message: "Use a lowercase bundle ID such as com.company.app.", severity: "error" });
  if (platforms.length === 0) issues.push({ field: "platforms", message: "Select Google Play, Apple App Store, or both.", severity: "error" });
  if (invalidPlatforms.length > 0) issues.push({ field: "platforms", message: "An unsupported app store was supplied.", severity: "error" });
  if (!validVersion(version)) issues.push({ field: "version", message: "Version must use three numbers, for example 1.0.0.", severity: "error" });
  if (buildNumber < 1 || buildNumber > 2_100_000_000) issues.push({ field: "buildNumber", message: "Build number must be a positive whole number.", severity: "error" });
  if (!validRepository(githubRepository)) issues.push({ field: "githubRepository", message: "Enter the GitHub repository as owner/repo.", severity: "error" });
  if (!validGithubRef(githubRef)) issues.push({ field: "githubRef", message: "Enter a valid GitHub branch or tag, such as main.", severity: "error" });
  if (!validWorkflow(githubWorkflow)) issues.push({ field: "githubWorkflow", message: "Enter a workflow filename ending in .yml or .yaml.", severity: "error" });
  if (githubToken && githubToken.length < 20) issues.push({ field: "githubToken", message: "The GitHub PAT appears incomplete after removing spaces or prefixes.", severity: "error" });

  return {
    input: { platforms, websiteUrl, appName, bundleId, version, buildNumber, githubRepository, githubRef, githubWorkflow },
    githubToken,
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
        Authorization: `token ${normalizeGithubToken(token)}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "VIBA-App-Publisher/1.0",
        ...init.headers,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function githubErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.clone().json() as { message?: unknown };
    return typeof payload.message === "string" ? payload.message : "";
  } catch {
    return "";
  }
}

async function inspectInfrastructure(
  input: PublisherInput,
  userId: number | null,
  suppliedToken: string,
): Promise<{ issues: PublisherIssue[]; verified: boolean }> {
  const resolved = await resolveGithubToken(userId, suppliedToken);
  const token = resolved.token;
  if (!token) {
    return { verified: false, issues: [{ field: "githubToken", message: "Enter your GitHub personal access token, then run this readiness check again.", severity: "error" }] };
  }

  const [owner, repo] = input.githubRepository.split("/");
  try {
    const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const repoResponse = await githubRequest(repoPath, token);
    if (!repoResponse.ok) {
      const githubMessage = await githubErrorMessage(repoResponse);
      const sourceLabel = resolved.source === "request" ? "the PAT entered in this form" :
        resolved.source === "vault" ? "the PAT saved in VIBA" : "the server fallback PAT";
      const message = repoResponse.status === 401
        ? `GitHub returned 401 for ${sourceLabel}${githubMessage ? `: ${githubMessage}` : ""}. Re-enter the PAT; VIBA removed spaces, quotes and token prefixes before testing it.`
        : repoResponse.status === 403
          ? `The PAT is valid but lacks access to ${input.githubRepository}. Grant this repository to the token.`
          : repoResponse.status === 404
            ? `The PAT cannot access ${input.githubRepository}. Check the owner/repo value and token repository selection.`
            : `GitHub could not verify access to ${input.githubRepository} (HTTP ${repoResponse.status}${githubMessage ? `: ${githubMessage}` : ""}).`;
      return { verified: false, issues: [{ field: "githubToken", message, severity: "error" }] };
    }

    if (resolved.source === "request") await persistGithubToken(userId, token);

    const workflowPath = `${repoPath}/actions/workflows/${encodeURIComponent(input.githubWorkflow)}`;
    const secretsPath = `${repoPath}/actions/secrets?per_page=100`;
    const [workflowResponse, secretsResponse] = await Promise.all([
      githubRequest(workflowPath, token),
      githubRequest(secretsPath, token),
    ]);
    const issues: PublisherIssue[] = [];

    if (!workflowResponse.ok) {
      issues.push({
        field: "automation",
        message: workflowResponse.status === 404
          ? `The workflow ${input.githubWorkflow} was not found in ${input.githubRepository}, or the PAT lacks Actions read access.`
          : `The GitHub PAT cannot access the selected mobile build workflow (HTTP ${workflowResponse.status}).`,
        severity: "error",
      });
    }

    if (!secretsResponse.ok) {
      issues.push({
        field: "signing",
        message: `VIBA could not verify repository Actions secrets (HTTP ${secretsResponse.status}). Grant the PAT Actions read access.`,
        severity: "warning",
      });
      return { issues, verified: false };
    }

    const payload = await secretsResponse.json() as { secrets?: Array<{ name?: string }> };
    const configured = new Set((payload.secrets ?? []).map((secret) => String(secret.name ?? "")));
    const required = new Set<string>();
    if (input.platforms.includes("android")) ANDROID_SECRET_NAMES.forEach((name) => required.add(name));
    if (input.platforms.includes("apple")) APPLE_SECRET_NAMES.forEach((name) => required.add(name));
    const missing = [...required].filter((name) => !configured.has(name));
    if (missing.length > 0) {
      issues.push({
        field: "signing",
        message: `Store signing is incomplete. Missing GitHub secret${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
        severity: "error",
      });
    }

    return { issues, verified: workflowResponse.ok && missing.length === 0 };
  } catch {
    return { verified: false, issues: [{ field: "automation", message: "VIBA could not verify GitHub build automation. Try the readiness check again.", severity: "warning" }] };
  }
}

async function validateRequest(body: Record<string, unknown>, userId: number | null): Promise<PublisherValidation> {
  const local = validatePublisherInput(body);
  const infrastructure = local.issues.some((issue) => issue.severity === "error")
    ? { issues: [] as PublisherIssue[], verified: false }
    : await inspectInfrastructure(local.input, userId, local.githubToken);
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
  const validation = await validateRequest(req.body as Record<string, unknown>, requestUserId(req));
  res.status(validation.ok ? 200 : 400).json(validation);
});

router.post("/app-publisher/publish", publishLimiter, async (req, res): Promise<void> => {
  const userId = requestUserId(req);
  const validation = await validateRequest(req.body as Record<string, unknown>, userId);
  if (!validation.ok) {
    res.status(400).json({ error: "publisher_validation_failed", message: "The app cannot be queued until the readiness errors are resolved.", ...validation });
    return;
  }

  const resolved = await resolveGithubToken(userId);
  const token = resolved.token;
  if (!token) {
    res.status(503).json({ error: "publisher_not_connected", message: "Enter and validate a GitHub PAT before publishing." });
    return;
  }

  const input = validation.input;
  const [owner, repo] = input.githubRepository.split("/");
  try {
    const response = await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(input.githubWorkflow)}/dispatches`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: input.githubRef, inputs: buildWorkflowInputs(input) }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      req.log?.error?.({ githubStatus: response.status, detail: detail.slice(0, 500), credentialSource: resolved.source, repository: input.githubRepository, workflow: input.githubWorkflow }, "App publisher workflow dispatch failed");
      res.status(502).json({ error: "dispatch_failed", message: "VIBA could not start the store build. Check the PAT Actions permission, repository, branch and workflow." });
      return;
    }

    const inputs = buildWorkflowInputs(input);
    res.status(202).json({
      ok: true,
      status: "queued",
      stores: inputs.stores,
      version: input.version,
      buildNumber: input.buildNumber,
      appName: input.appName,
      bundleId: input.bundleId,
      websiteUrl: input.websiteUrl,
      githubRepository: input.githubRepository,
      githubRef: input.githubRef,
      githubWorkflow: input.githubWorkflow,
      message: "The verified store build has been queued.",
    });
  } catch (error) {
    req.log?.error?.({ err: error, credentialSource: resolved.source, repository: input.githubRepository, workflow: input.githubWorkflow }, "App publisher workflow dispatch request failed");
    res.status(503).json({ error: "dispatch_unavailable", message: "GitHub build automation is temporarily unavailable." });
  }
});

export default router;
