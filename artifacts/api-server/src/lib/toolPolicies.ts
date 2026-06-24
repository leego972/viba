/**
 * VIBA Tool Policies
 *
 * Category-level and tool-level policy rules that the broker enforces
 * before any tool action is planned, dry-run, or executed.
 */
import type { ToolDefinition, RiskLevel } from "./toolRegistry";

export interface PolicyDecision {
  allowed: boolean;
  requiresDryRun: boolean;
  requiresApproval: boolean;
  requiresSafeBuild: boolean;
  blockedReason: string | null;
  warnings: string[];
}

// ─── Payload/result redaction ─────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  "password", "secret", "token", "api_key", "key", "webhook_secret",
  "database_url", "smtp_pass", "auth_tag", "iv", "encrypted_value",
  "private_key", "access_token", "refresh_token", "oauth_token",
  "credential", "raw_key", "secret_value",
]);

const TOKEN_PATTERN = /\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36,}|[A-Za-z0-9_\-]{40,})\b/g;

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(TOKEN_PATTERN, "[REDACTED]").slice(0, 500);
  }
  return value;
}

export function redactPayload(obj: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!obj || typeof obj !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      out[k] = redactPayload(v as Record<string, unknown>);
    } else {
      out[k] = redactValue(v);
    }
  }
  return out;
}

export function redactResult(obj: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return redactPayload(obj);
}

// ─── Policy evaluators ────────────────────────────────────────────────────────

export function evaluateDeploymentPolicy(tool: ToolDefinition, hasSafeBuildPassed: boolean): PolicyDecision {
  const warnings: string[] = [];
  if (tool.requiresSafeBuild && !hasSafeBuildPassed) {
    return {
      allowed: false,
      requiresDryRun: tool.supportsDryRun,
      requiresApproval: tool.requiresApproval,
      requiresSafeBuild: true,
      blockedReason: `${tool.label} requires a passing safe build (pnpm run safe-build) before execution.`,
      warnings,
    };
  }
  if (tool.riskLevel === "destructive" || tool.riskLevel === "high") {
    warnings.push("Deployment actions can affect production. User approval required.");
  }
  return {
    allowed: true,
    requiresDryRun: tool.supportsDryRun && (tool.riskLevel === "destructive" || tool.riskLevel === "high"),
    requiresApproval: tool.requiresApproval,
    requiresSafeBuild: tool.requiresSafeBuild,
    blockedReason: null,
    warnings,
  };
}

export function evaluatePaymentPolicy(tool: ToolDefinition): PolicyDecision {
  const warnings: string[] = [];
  if (["stripe.products.write", "credits.ledger.write"].includes(tool.toolId)) {
    warnings.push("Payment mutations require an audit log entry and user approval.");
    warnings.push("Payment state must not be trusted from client — all amounts come from server-side Stripe data.");
    return {
      allowed: true,
      requiresDryRun: true,
      requiresApproval: true,
      requiresSafeBuild: false,
      blockedReason: null,
      warnings,
    };
  }
  return {
    allowed: true,
    requiresDryRun: tool.supportsDryRun,
    requiresApproval: tool.requiresApproval,
    requiresSafeBuild: false,
    blockedReason: null,
    warnings,
  };
}

export function evaluateDnsPolicy(tool: ToolDefinition): PolicyDecision {
  if (tool.toolId === "dns.records.write") {
    return {
      allowed: true,
      requiresDryRun: true,
      requiresApproval: true,
      requiresSafeBuild: false,
      blockedReason: null,
      warnings: ["DNS write will show exact record changes before execution.", "DNS propagation may take up to 48 hours."],
    };
  }
  return { allowed: true, requiresDryRun: false, requiresApproval: false, requiresSafeBuild: false, blockedReason: null, warnings: [] };
}

export function evaluateVaultPolicy(tool: ToolDefinition): PolicyDecision {
  return {
    allowed: true,
    requiresDryRun: false,
    requiresApproval: false,
    requiresSafeBuild: false,
    blockedReason: null,
    warnings: [
      "Raw credential values are never returned to agents or frontend.",
      "Vault access is audited in viba_credential_access_logs.",
      "Agents reference credentials by provider/kind/scope only.",
    ],
  };
}

export function evaluateBrowserPolicy(tool: ToolDefinition): PolicyDecision {
  if (tool.toolId === "browser.authorized_action") {
    return {
      allowed: true,
      requiresDryRun: true,
      requiresApproval: true,
      requiresSafeBuild: false,
      blockedReason: null,
      warnings: [
        "OAuth, 2FA, passkey, captcha, and payment approvals require user authorization — VIBA will not automate these.",
        "Any downloaded files are quarantined. No downloaded file will be executed automatically.",
        "Browser actions are supervised and logged.",
      ],
    };
  }
  return { allowed: true, requiresDryRun: false, requiresApproval: false, requiresSafeBuild: false, blockedReason: null, warnings: [] };
}

export function evaluateBuildPolicy(_tool: ToolDefinition, hasSafeBuildPassed: boolean): PolicyDecision {
  return {
    allowed: true,
    requiresDryRun: false,
    requiresApproval: false,
    requiresSafeBuild: false,
    blockedReason: hasSafeBuildPassed ? null : null,
    warnings: hasSafeBuildPassed ? ["Safe build has passed."] : ["Safe build not yet run. Run pnpm run safe-build before deployment."],
  };
}

export function evaluateAiPolicy(tool: ToolDefinition, hasByokCredential: boolean): PolicyDecision {
  if (tool.toolId === "ai.custom.use" && !hasByokCredential) {
    return {
      allowed: false,
      requiresDryRun: false,
      requiresApproval: false,
      requiresSafeBuild: false,
      blockedReason: "No custom AI credential saved. Add one via POST /api/custom-ai/save.",
      warnings: ["Groq is the default coordinator and can handle this task without BYOK."],
    };
  }
  return { allowed: true, requiresDryRun: false, requiresApproval: false, requiresSafeBuild: false, blockedReason: null, warnings: [] };
}

// ─── Master policy evaluator ──────────────────────────────────────────────────

export interface PolicyContext {
  hasSafeBuildPassed?: boolean;
  hasByokCredential?: boolean;
  hasVaultCredential?: boolean;
}

export function evaluateToolPolicy(tool: ToolDefinition, context: PolicyContext = {}): PolicyDecision {
  const { hasSafeBuildPassed = false, hasByokCredential = false, hasVaultCredential = false } = context;

  // Vault credential gate
  if (tool.permissionsRequired.includes("vault_required") && !hasVaultCredential) {
    return {
      allowed: false,
      requiresDryRun: false,
      requiresApproval: false,
      requiresSafeBuild: false,
      blockedReason: `${tool.label} requires a vault credential for ${tool.credentialProvider ?? "unknown"} (kind: ${tool.credentialKind ?? "unknown"}). Save one via POST /api/credentials/save.`,
      warnings: [],
    };
  }

  switch (tool.category) {
    case "deployment": return evaluateDeploymentPolicy(tool, hasSafeBuildPassed);
    case "payments": return evaluatePaymentPolicy(tool);
    case "dns": return evaluateDnsPolicy(tool);
    case "vault": return evaluateVaultPolicy(tool);
    case "browser": return evaluateBrowserPolicy(tool);
    case "build": return evaluateBuildPolicy(tool, hasSafeBuildPassed);
    case "ai": return evaluateAiPolicy(tool, hasByokCredential);
    default: return {
      allowed: true,
      requiresDryRun: tool.supportsDryRun && (tool.riskLevel === "high" || tool.riskLevel === "destructive"),
      requiresApproval: tool.requiresApproval,
      requiresSafeBuild: tool.requiresSafeBuild,
      blockedReason: null,
      warnings: [],
    };
  }
}

// ─── Risk level helpers ───────────────────────────────────────────────────────

export function isDestructiveOrHigh(riskLevel: RiskLevel): boolean {
  return riskLevel === "destructive" || riskLevel === "high";
}

export function requiresUserGate(tool: ToolDefinition): boolean {
  return tool.requiresApproval || isDestructiveOrHigh(tool.riskLevel);
}
