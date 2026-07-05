/**
 * VIBA Security Hardening Tool Pack
 *
 * Supplementary security tools registered alongside the main toolRegistry.
 * These are returned by getSecurityHardeningToolById() which is checked
 * BEFORE getToolById() in the tool broker, allowing overrides.
 *
 * Tools here focus on proactive hardening: dependency audits, secrets
 * scanning, CSP enforcement, and vulnerability remediation planning.
 */
import type { ToolDefinition } from "./toolRegistry";

const SECURITY_HARDENING_TOOLS: Record<string, ToolDefinition> = {
  "security.hardening.dependency_audit": {
    toolId: "security.hardening.dependency_audit",
    label: "Security: Dependency Vulnerability Audit",
    category: "security",
    description: "Scan project dependencies for known CVEs and suggest remediation steps.",
    riskLevel: "read_only",
    permissionsRequired: ["login_required"],
    credentialProvider: null,
    credentialKind: null,
    supportsDryRun: false,
    requiresApproval: false,
    requiresSafeBuild: false,
    outputsSecretValues: false,
  },
  "security.hardening.secrets_scan": {
    toolId: "security.hardening.secrets_scan",
    label: "Security: Secrets & Credential Leak Scan",
    category: "security",
    description: "Scan codebase and git history for accidentally committed secrets, API keys, or credentials.",
    riskLevel: "read_only",
    permissionsRequired: ["login_required"],
    credentialProvider: null,
    credentialKind: null,
    supportsDryRun: false,
    requiresApproval: false,
    requiresSafeBuild: false,
    outputsSecretValues: false,
  },
  "security.hardening.headers_check": {
    toolId: "security.hardening.headers_check",
    label: "Security: HTTP Security Headers Audit",
    category: "security",
    description: "Verify that security headers (CSP, HSTS, X-Frame-Options, etc.) are correctly configured.",
    riskLevel: "read_only",
    permissionsRequired: ["none"],
    credentialProvider: null,
    credentialKind: null,
    supportsDryRun: false,
    requiresApproval: false,
    requiresSafeBuild: false,
    outputsSecretValues: false,
  },
  "security.hardening.csp_generate": {
    toolId: "security.hardening.csp_generate",
    label: "Security: Generate Content Security Policy",
    category: "security",
    description: "Generate a strict Content Security Policy header value for the project.",
    riskLevel: "read_only",
    permissionsRequired: ["none"],
    credentialProvider: null,
    credentialKind: null,
    supportsDryRun: false,
    requiresApproval: false,
    requiresSafeBuild: false,
    outputsSecretValues: false,
  },
  "security.hardening.ratelimit_audit": {
    toolId: "security.hardening.ratelimit_audit",
    label: "Security: Rate Limiting Audit",
    category: "security",
    description: "Review current rate limit configuration and suggest tighter limits for sensitive endpoints.",
    riskLevel: "read_only",
    permissionsRequired: ["login_required"],
    credentialProvider: null,
    credentialKind: null,
    supportsDryRun: false,
    requiresApproval: false,
    requiresSafeBuild: false,
    outputsSecretValues: false,
  },
  "security.hardening.sast_scan": {
    toolId: "security.hardening.sast_scan",
    label: "Security: Static Analysis (SAST)",
    category: "security",
    description: "Run static application security testing to identify injection, XSS, and logic vulnerabilities.",
    riskLevel: "read_only",
    permissionsRequired: ["login_required"],
    credentialProvider: null,
    credentialKind: null,
    supportsDryRun: false,
    requiresApproval: false,
    requiresSafeBuild: false,
    outputsSecretValues: false,
  },
  "security.hardening.threat_model": {
    toolId: "security.hardening.threat_model",
    label: "Security: Threat Modelling Report",
    category: "security",
    description: "Generate a structured STRIDE-based threat model for the current system architecture.",
    riskLevel: "read_only",
    permissionsRequired: ["login_required"],
    credentialProvider: null,
    credentialKind: null,
    supportsDryRun: false,
    requiresApproval: false,
    requiresSafeBuild: false,
    outputsSecretValues: false,
  },
  "security.hardening.patch_plan": {
    toolId: "security.hardening.patch_plan",
    label: "Security: Vulnerability Patch Plan",
    category: "security",
    description: "Generate a prioritised remediation plan for identified security vulnerabilities.",
    riskLevel: "read_only",
    permissionsRequired: ["login_required"],
    credentialProvider: null,
    credentialKind: null,
    supportsDryRun: false,
    requiresApproval: false,
    requiresSafeBuild: false,
    outputsSecretValues: false,
  },
};

/**
 * Returns a security hardening tool definition by ID, or undefined if the
 * tool ID is not in this pack. The broker checks this before getToolById()
 * so these definitions can shadow or supplement the main registry.
 */
export function getSecurityHardeningToolById(toolId: string): ToolDefinition | undefined {
  return SECURITY_HARDENING_TOOLS[toolId];
}

export function getAllSecurityHardeningTools(): ToolDefinition[] {
  return Object.values(SECURITY_HARDENING_TOOLS);
}
