/**
 * VIBA Global Security Policy
 *
 * Central source of truth for:
 * - Sensitive field/key detection
 * - Deep redaction of secrets from any object
 * - Response safety assertions
 * - High-risk / destructive action classification
 */

// ─── Sensitive field name detection ──────────────────────────────────────────

const SENSITIVE_SUBSTRINGS = [
  "token",
  "secret",
  "password",
  "passphrase",
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
  "access_token",
] as const;

/**
 * Returns true when `name` contains any known sensitive substring (case-insensitive).
 */
export function isSensitiveFieldName(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_SUBSTRINGS.some((sub) => lower.includes(sub));
}

// ─── Value redaction ──────────────────────────────────────────────────────────

/** Patterns that look like raw secret values. */
const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9\-_]{20,}\b/,   // OpenAI sk- keys
  /\bghp_[A-Za-z0-9]{36,}\b/,     // GitHub PATs
  /\bxoxb-[A-Za-z0-9\-]+\b/,      // Slack bot tokens
  /\bAIza[A-Za-z0-9\-_]{35}\b/,   // Google API keys
  /\brk_live_[A-Za-z0-9]{24,}\b/, // Stripe restricted keys
  /\bsk_live_[A-Za-z0-9]{24,}\b/, // Stripe secret keys
  /\bsk_test_[A-Za-z0-9]{24,}\b/, // Stripe test keys
];

/**
 * Redact a single scalar value that appears to be a raw secret.
 */
export function redactSensitiveValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  let out = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

/**
 * Deep-redact any object/array recursively.
 * - Keys matching isSensitiveFieldName → "[REDACTED]"
 * - String values matching SECRET_VALUE_PATTERNS → "[REDACTED]"
 */
export function redactDeep(input: unknown): unknown {
  if (input === null || input === undefined) return input;

  if (Array.isArray(input)) {
    return input.map((item) => redactDeep(item));
  }

  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (isSensitiveFieldName(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactDeep(v);
      }
    }
    return out;
  }

  if (typeof input === "string") {
    return redactSensitiveValue(input);
  }

  return input;
}

/**
 * Assert that an outgoing response object contains no raw secrets.
 *
 * In strict mode (VIBA_STRICT_RESPONSE_SECRET_GUARD=true or NODE_ENV=test):
 *   - throws an Error to surface the leak immediately.
 * In production:
 *   - silently redacts and returns the sanitised object.
 *
 * Always returns the redacted copy so callers can use the return value.
 */
export function assertNoRawSecretsInResponse(input: unknown): unknown {
  const strict =
    process.env.VIBA_STRICT_RESPONSE_SECRET_GUARD === "true" ||
    process.env.NODE_ENV === "test";

  const redacted = redactDeep(input);

  if (strict) {
    const original = JSON.stringify(input);
    const clean = JSON.stringify(redacted);
    if (original !== clean) {
      throw new Error(
        "SECURITY: Outgoing response contains raw secret-looking fields. " +
          "All secrets must be redacted before being returned to clients."
      );
    }
  }

  return redacted;
}

// ─── Action classification ────────────────────────────────────────────────────

const HIGH_RISK_ACTIONS = new Set([
  // Deployment
  "deploy", "rollback", "promote", "scale", "restart_service",
  "delete_service", "destroy_environment",
  // Database
  "drop_table", "truncate_table", "migrate_production", "delete_db",
  // Billing / payments
  "create_subscription", "cancel_subscription", "refund", "charge",
  "update_payment_method", "create_coupon", "grant_credits",
  // Credentials
  "delete_credential", "rotate_key", "revoke_token",
  // DNS / domains
  "add_dns_record", "delete_dns_record", "update_nameserver",
  // Files / repos
  "delete_repo", "delete_branch", "force_push",
  // Browser operator
  "browser_oauth", "browser_payment", "browser_2fa", "browser_passkey",
  // Admin
  "delete_user", "impersonate_user", "change_plan",
]);

/**
 * Returns true when `action` is classified as high-risk and requires
 * extra safeguards.
 */
export function isHighRiskAction(action: string): boolean {
  return HIGH_RISK_ACTIONS.has(action.toLowerCase().replace(/[\s-]/g, "_"));
}

const APPROVAL_REQUIRED_ACTIONS = new Set([
  "deploy", "rollback", "promote", "delete_service", "destroy_environment",
  "drop_table", "truncate_table", "migrate_production", "delete_db",
  "create_subscription", "cancel_subscription", "refund", "charge",
  "grant_credits", "delete_credential", "rotate_key", "revoke_token",
  "add_dns_record", "delete_dns_record", "update_nameserver",
  "delete_repo", "delete_branch", "force_push",
  "browser_oauth", "browser_payment", "browser_2fa", "browser_passkey",
  "delete_user", "impersonate_user", "change_plan",
]);

/**
 * Returns true when the action must be explicitly approved by the user before
 * the agent can execute it.
 */
export function requiresUserApproval(action: string): boolean {
  return APPROVAL_REQUIRED_ACTIONS.has(action.toLowerCase().replace(/[\s-]/g, "_"));
}

const SAFE_BUILD_REQUIRED_ACTIONS = new Set([
  "deploy", "rollback", "promote", "migrate_production",
]);

/**
 * Returns true when the action requires a passing safe-build check first.
 */
export function requiresSafeBuild(action: string): boolean {
  return SAFE_BUILD_REQUIRED_ACTIONS.has(action.toLowerCase().replace(/[\s-]/g, "_"));
}

const DRY_RUN_REQUIRED_ACTIONS = new Set([
  "deploy", "rollback", "promote", "migrate_production",
  "drop_table", "truncate_table", "delete_db",
  "add_dns_record", "delete_dns_record", "update_nameserver",
  "delete_repo", "delete_branch", "force_push",
]);

/**
 * Returns true when the action must be dry-run before live execution.
 */
export function requiresDryRun(action: string): boolean {
  return DRY_RUN_REQUIRED_ACTIONS.has(action.toLowerCase().replace(/[\s-]/g, "_"));
}
