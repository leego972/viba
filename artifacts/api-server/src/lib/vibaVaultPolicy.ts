export const VIBA_PUBLIC_PROVIDERS = [
  "github",
  "railway",
  "railway_mcp",
  "openai",
  "anthropic",
  "gemini",
  "perplexity",
  "groq",
  "replit",
  "manus",
  "stripe",
  "paypal",
  "square",
  "godaddy",
  "cloudflare",
  "smtp",
  "sendgrid",
  "mailgun",
  "postmark",
  "aws",
  "s3",
  "google",
  "microsoft",
  "custom",
] as const;

export type VibaPublicProvider = typeof VIBA_PUBLIC_PROVIDERS[number];

export const VIBA_CREDENTIAL_KINDS = [
  "api_key",
  "access_token",
  "refresh_token",
  "oauth_token",
  "secret_key",
  "publishable_key",
  "webhook_secret",
  "smtp_password",
  "database_url",
  "mcp_url",
  "username",
  "password",
  "app_password",
  "service_account_json",
  "dns_token",
  "custom_secret",
] as const;

export type VibaCredentialKind = typeof VIBA_CREDENTIAL_KINDS[number];

export const VIBA_CREDENTIAL_SCOPES = [
  "all",
  "setup",
  "browser_operator",
  "railway_setup",
  "stripe_setup",
  "dns_setup",
  "github_setup",
  "smtp_setup",
  "billing",
  "credits",
  "read_only",
  "write_limited",
  "current_browser_session_only",
] as const;

export type VibaCredentialScope = typeof VIBA_CREDENTIAL_SCOPES[number];

export function isSupportedProvider(provider: unknown): provider is VibaPublicProvider {
  return typeof provider === "string" && (VIBA_PUBLIC_PROVIDERS as readonly string[]).includes(provider);
}

export function isSupportedCredentialKind(kind: unknown): kind is VibaCredentialKind {
  return typeof kind === "string" && (VIBA_CREDENTIAL_KINDS as readonly string[]).includes(kind);
}

export function isSupportedCredentialScope(scope: unknown): scope is VibaCredentialScope {
  return typeof scope === "string" && (VIBA_CREDENTIAL_SCOPES as readonly string[]).includes(scope);
}

export function isSensitiveCredentialName(name: string): boolean {
  return /token|secret|password|passwd|pwd|key|credential|cookie|session|webhook|database_url|smtp_pass|private/i.test(name);
}

export function redactCredentialMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!metadata) return null;
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    redacted[key] = isSensitiveCredentialName(key) ? "REDACTED" : value;
  }
  return redacted;
}

export function scopeAllows(savedScope: string | null | undefined, requiredScope?: string | null): boolean {
  if (!requiredScope) return true;
  if (!savedScope || savedScope === "all") return true;
  return savedScope.split(",").map((item) => item.trim()).includes(requiredScope);
}

export const VIBA_AI_CREDENTIAL_ACCESS_RULES = [
  "The AI may use saved credentials only server-side.",
  "The frontend may receive only configured/missing/expired/scope_denied status, never raw values.",
  "Every credential use must be audit-logged with provider, kind, label, purpose, job id, scope, source, and status.",
  "Credential scope must match the job purpose unless scope is all.",
  "Expired credentials must not be returned to AI workers.",
  "Browser operator jobs must request user authorization before destructive changes.",
  "Passwords should not be stored when OAuth/API tokens are available.",
  "Provider values used for setup should be injected server-side only and redacted from screenshots, logs, and outputs.",
] as const;
