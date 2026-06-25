export type RiskLevel = "read_only" | "low" | "medium" | "high" | "destructive";

const SENSITIVE_FIELD_PATTERNS = [
  "token",
  "secret",
  "password",
  "passcode",
  "api_key",
  "apikey",
  "key",
  "credential",
  "cookie",
  "session",
  "private",
  "webhook",
  "database",
  "db_url",
  "database_url",
  "smtp_pass",
  "authorization",
  "bearer",
  "refresh",
  "access",
  "encrypted_value",
  "auth_tag",
  "iv",
];

const HIGH_RISK_ACTIONS = [
  "deploy",
  "deployment",
  "merge",
  "env_write",
  "dns_write",
  "payment_write",
  "stripe_write",
  "credit_write",
  "vault_write",
  "credential_use",
  "browser_authorized_action",
  "file_delete",
  "run_uploaded_code",
  "public_launch",
];

const DESTRUCTIVE_ACTIONS = [
  "delete",
  "remove",
  "destroy",
  "purge",
  "revoke",
  "rotate",
  "overwrite",
  "merge",
  "deploy",
  "dns_write",
  "env_write",
  "payment_write",
];

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export function isSensitiveFieldName(name: string): boolean {
  const normalized = normalize(name);
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function redactSensitiveValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length === 0 ? "" : "[REDACTED]";
  if (typeof value === "number" || typeof value === "boolean") return "[REDACTED]";
  return "[REDACTED]";
}

export function redactDeep<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map((item) => redactDeep(item)) as T;
  if (typeof input !== "object") return input;

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isSensitiveFieldName(key)) {
      output[key] = redactSensitiveValue(value);
    } else {
      output[key] = redactDeep(value);
    }
  }
  return output as T;
}

export function findSensitiveResponsePaths(input: unknown, path = "$", paths: string[] = []): string[] {
  if (input === null || input === undefined) return paths;
  if (Array.isArray(input)) {
    input.forEach((item, index) => findSensitiveResponsePaths(item, `${path}[${index}]`, paths));
    return paths;
  }
  if (typeof input !== "object") return paths;

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const nextPath = `${path}.${key}`;
    if (isSensitiveFieldName(key)) paths.push(nextPath);
    findSensitiveResponsePaths(value, nextPath, paths);
  }
  return paths;
}

export function assertNoRawSecretsInResponse(input: unknown): void {
  const paths = findSensitiveResponsePaths(input);
  if (paths.length > 0) {
    throw new Error(`Unsafe response contains sensitive fields: ${paths.slice(0, 10).join(", ")}`);
  }
}

export function isHighRiskAction(action: string): boolean {
  const normalized = normalize(action);
  return HIGH_RISK_ACTIONS.some((pattern) => normalized.includes(pattern));
}

export function isDestructiveAction(action: string): boolean {
  const normalized = normalize(action);
  return DESTRUCTIVE_ACTIONS.some((pattern) => normalized.includes(pattern));
}

export function requiresUserApproval(action: string, riskLevel?: RiskLevel): boolean {
  return riskLevel === "high" || riskLevel === "destructive" || isHighRiskAction(action) || isDestructiveAction(action);
}

export function requiresSafeBuild(action: string, riskLevel?: RiskLevel): boolean {
  const normalized = normalize(action);
  return riskLevel === "destructive" || ["deploy", "merge", "release", "public_launch", "server_config", "payment_write", "env_write"].some((pattern) => normalized.includes(pattern));
}

export function requiresDryRun(action: string, riskLevel?: RiskLevel): boolean {
  return riskLevel === "high" || riskLevel === "destructive" || isDestructiveAction(action);
}

export function publicSafeMetadata<T>(metadata: T): T {
  return redactDeep(metadata);
}
