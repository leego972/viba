import crypto from "crypto";
import { logger } from "../../lib/logger";
import type {
  GithubInstallation,
  GithubRepository,
  GitHubPushWebhookPayload,
} from "./deploy.types";

export interface GitHubAppConfig {
  appId: string;
  clientId: string;
  clientSecret: string;
  privateKeyBase64: string;
  webhookSecret: string;
  callbackUrl: string;
}

function getConfig(): GitHubAppConfig {
  return {
    appId: process.env.GITHUB_APP_ID ?? "",
    clientId: process.env.GITHUB_APP_CLIENT_ID ?? "",
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET ?? "",
    privateKeyBase64: process.env.GITHUB_APP_PRIVATE_KEY_BASE64 ?? "",
    webhookSecret: process.env.GITHUB_APP_WEBHOOK_SECRET ?? "",
    callbackUrl: process.env.GITHUB_APP_CALLBACK_URL ?? "",
  };
}

export function isGitHubAppConfigured(): boolean {
  const cfg = getConfig();
  return !!(cfg.appId && cfg.clientId && cfg.privateKeyBase64);
}

function decodePrivateKey(): string {
  const cfg = getConfig();
  if (!cfg.privateKeyBase64) throw new Error("GITHUB_APP_PRIVATE_KEY_BASE64 is not set");
  return Buffer.from(cfg.privateKeyBase64, "base64").toString("utf8");
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function createJWT(): string {
  const cfg = getConfig();
  const privateKey = decodePrivateKey();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64url(
    Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: cfg.appId })),
  );
  const data = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(data);
  const sig = base64url(sign.sign(privateKey));
  return `${data}.${sig}`;
}

export async function getInstallationToken(installationId: number): Promise<string> {
  const jwt = createJWT();
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to get installation token: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

export async function exchangeCodeForToken(
  code: string,
): Promise<{ accessToken: string; installationId?: number }> {
  const cfg = getConfig();
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
    }),
  });
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (data.error || !data.access_token) {
    throw new Error(`OAuth exchange failed: ${data.error}`);
  }
  return { accessToken: data.access_token };
}

export async function listInstallations(
  userAccessToken: string,
): Promise<GithubInstallation[]> {
  const res = await fetch("https://api.github.com/user/installations", {
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`Failed to list installations: ${res.status}`);
  const data = (await res.json()) as {
    installations: Array<{
      id: number;
      account: { login: string; type: string };
      target_type: string;
    }>;
  };
  return data.installations.map((inst) => ({
    id: String(inst.id),
    installationId: inst.id,
    accountLogin: inst.account.login,
    accountType: inst.account.type,
    targetType: inst.target_type,
  }));
}

export async function listInstallationRepos(
  installationId: number,
): Promise<GithubRepository[]> {
  const token = await getInstallationToken(installationId);
  const res = await fetch("https://api.github.com/installation/repositories?per_page=100", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`Failed to list repos: ${res.status}`);
  const data = (await res.json()) as {
    repositories: Array<{
      id: number;
      owner: { login: string };
      name: string;
      full_name: string;
      default_branch: string;
      private: boolean;
      html_url: string;
    }>;
  };
  return data.repositories.map((r) => ({
    id: String(r.id),
    installationId: String(installationId),
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    defaultBranch: r.default_branch,
    private: r.private,
    htmlUrl: r.html_url,
  }));
}

export function buildInstallUrl(): string {
  const cfg = getConfig();
  const base = `https://github.com/apps/${cfg.clientId}/installations/new`;
  return `${base}?redirect_uri=${encodeURIComponent(cfg.callbackUrl)}`;
}

export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string,
): boolean {
  const cfg = getConfig();
  if (!cfg.webhookSecret) return false;
  const expected = `sha256=${crypto
    .createHmac("sha256", cfg.webhookSecret)
    .update(rawBody)
    .digest("hex")}`;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signatureHeader, "utf8"),
    );
  } catch {
    return false;
  }
}

export function parsePushWebhook(body: unknown): GitHubPushWebhookPayload | null {
  const p = body as GitHubPushWebhookPayload;
  if (!p?.ref || !p?.repository?.full_name) {
    logger.warn({ body }, "Invalid push webhook payload");
    return null;
  }
  return p;
}

export function extractBranchFromRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

export function buildCloneUrl(
  installationToken: string,
  fullName: string,
): string {
  return `https://x-access-token:${installationToken}@github.com/${fullName}.git`;
}
