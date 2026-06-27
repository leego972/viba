/**
 * VIBA Repair Plan Generator
 *
 * Converts a ProjectAnalysis + user request into a structured repair plan
 * consumable by the Agent Runtime + Tool Broker.
 *
 * Rules:
 * - No raw secrets ever in plan output
 * - Deploy/DNS/payment steps always require approval
 * - Code change steps always require safe-build
 * - Plan is deterministic and pure — no DB, no side effects
 */
import type { ProjectAnalysis } from "./projectAnalyzer";

// ─── Risk helpers ─────────────────────────────────────────────────────────────

const RISK_ORDER: RepairRiskLevel[] = ["read_only", "low", "medium", "high", "critical"];

function raiseRisk(current: RepairRiskLevel, next: RepairRiskLevel): RepairRiskLevel {
  return RISK_ORDER.indexOf(next) > RISK_ORDER.indexOf(current) ? next : current;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type RepairAgentName =
  | "coordinator"
  | "repo_analyzer"
  | "builder"
  | "security"
  | "vault"
  | "qa"
  | "deployment"
  | "browser_operator"
  | "reviewer";

export type RepairRiskLevel = "read_only" | "low" | "medium" | "high" | "critical";

export interface RepairStep {
  stepId: string;
  stepNumber: number;
  title: string;
  description: string;
  agentName: RepairAgentName;
  toolId: string | null;
  riskLevel: RepairRiskLevel;
  requiresApproval: boolean;
  requiresCredential: boolean;
  credentialProvider: string | null;
  credentialKind: string | null;
  requiresSafeBuild: boolean;
  expectedEvidence: string;
}

export interface RequiredTool {
  toolId: string;
  label: string;
  riskLevel: RepairRiskLevel;
  requiresApproval: boolean;
}

export interface RequiredCredential {
  name: string;
  provider: string;
  kind: string;
  scope: string;
}

export interface RepairPlan {
  planId: string;
  summary: string;
  riskLevel: RepairRiskLevel;
  requiredAgents: RepairAgentName[];
  requiredTools: RequiredTool[];
  requiredCredentials: RequiredCredential[];
  approvalRequired: boolean;
  repairSteps: RepairStep[];
  safetyChecks: string[];
  launchBlockers: string[];
  safeBuildRequired: boolean;
  qaRequired: boolean;
  estimatedStepCount: number;
  rawValuesReturned: false;
}

export interface RepairPlanInput {
  analysis: ProjectAnalysis;
  knownErrors: string[];
  userRequest: string;
  safeBuildStatus?: string | null;
  qaStatus?: string | null;
  strictMode?: boolean;
}

// ─── Step catalogue builders ──────────────────────────────────────────────────

function makeStep(
  index: number,
  overrides: Partial<RepairStep> & { title: string; description: string; agentName: RepairAgentName },
): RepairStep {
  const stepId = `repair-step-${index}-${overrides.agentName}`;
  return {
    stepId,
    stepNumber: index,
    title: overrides.title,
    description: overrides.description,
    agentName: overrides.agentName,
    toolId: overrides.toolId ?? null,
    riskLevel: overrides.riskLevel ?? "low",
    requiresApproval: overrides.requiresApproval ?? false,
    requiresCredential: overrides.requiresCredential ?? false,
    credentialProvider: overrides.credentialProvider ?? null,
    credentialKind: overrides.credentialKind ?? null,
    requiresSafeBuild: overrides.requiresSafeBuild ?? false,
    expectedEvidence: overrides.expectedEvidence ?? "Step completed successfully",
  };
}

// ─── Plan generator ───────────────────────────────────────────────────────────

export function generateRepairPlan(input: RepairPlanInput): RepairPlan {
  const { analysis, knownErrors, userRequest, safeBuildStatus, qaStatus, strictMode = false } = input;
  const steps: RepairStep[] = [];
  const agentSet = new Set<RepairAgentName>();
  const toolSet: RequiredTool[] = [];
  const credSet: RequiredCredential[] = [];
  const safetyChecks: string[] = [];
  let stepIdx = 1;
  let overallRisk: RepairRiskLevel = "low";
  let approvalRequired = false;

  // ── Step 1: Coordinator analysis ────────────────────────────────────────────
  agentSet.add("coordinator");
  steps.push(makeStep(stepIdx++, {
    title: "Coordinator: review project analysis",
    description: `Review the imported project (${analysis.projectName}) — framework: ${analysis.detectedFramework}, package manager: ${analysis.packageManager}, ${analysis.launchBlockers.length} launch blocker(s).`,
    agentName: "coordinator",
    toolId: null,
    riskLevel: "read_only",
    expectedEvidence: "Project summary reviewed and repair scope confirmed by coordinator",
  }));

  // ── Step 2: Repo/structure analysis ─────────────────────────────────────────
  if (analysis.sourceType !== "manual") {
    agentSet.add("repo_analyzer");
    steps.push(makeStep(stepIdx++, {
      title: "Repo Analyzer: inspect file structure",
      description: "Inspect repository structure, route map, package.json scripts, and dependency tree without executing any unknown code.",
      agentName: "repo_analyzer",
      toolId: "build.safe_build",
      riskLevel: "read_only",
      expectedEvidence: "File structure report + route map + dependency list",
    }));
  }

  // ── Step 3: Malware safety (zip uploads only) ────────────────────────────────
  if (analysis.sourceType === "zip_upload") {
    agentSet.add("security");
    overallRisk = "high";
    approvalRequired = true;
    steps.push(makeStep(stepIdx++, {
      title: "Security: malware safety scan",
      description: "Run malware safety scan on zip upload before any code extraction or execution. Block if scanner unavailable and strictMode is enabled.",
      agentName: "security",
      toolId: null,
      riskLevel: "high",
      requiresApproval: true,
      expectedEvidence: "Malware scan report: passed or manual_required with documented reason",
    }));
    safetyChecks.push("Malware scan required for zip upload before any code execution");
    toolSet.push({ toolId: "security.malware_scan", label: "Malware Safety Scan", riskLevel: "read_only", requiresApproval: false });
  }

  // ── Step 4: Secret scan ──────────────────────────────────────────────────────
  agentSet.add("security");
  steps.push(makeStep(stepIdx++, {
    title: "Security: secret scan",
    description: "Scan repository for accidentally committed secrets (API keys, tokens, passwords). Block deployment if secrets found.",
    agentName: "security",
    toolId: null,
    riskLevel: "read_only",
    expectedEvidence: "Secret scan report: clean or issues documented",
  }));
  safetyChecks.push("Secret scan must pass before deployment");

  // ── Step 5: Missing env vars → vault ────────────────────────────────────────
  if (analysis.envMissing.length > 0) {
    agentSet.add("vault");
    overallRisk = raiseRisk(overallRisk, "medium");
    for (const envName of analysis.envMissing.slice(0, 5)) {
      const provider = envName.split("_")[0]?.toLowerCase() ?? "unknown";
      credSet.push({ name: envName, provider, kind: "api_key", scope: "required for project" });
    }
    steps.push(makeStep(stepIdx++, {
      title: "Vault: configure missing credentials",
      description: `${analysis.envMissing.length} required credential(s) not found: ${analysis.envMissing.slice(0, 3).join(", ")}${analysis.envMissing.length > 3 ? "…" : ""}. Coordinate with owner to add to vault.`,
      agentName: "vault",
      toolId: null,
      riskLevel: "medium",
      requiresApproval: true,
      requiresCredential: true,
      credentialProvider: analysis.envMissing[0]?.split("_")[0]?.toLowerCase() ?? "unknown",
      credentialKind: "api_key",
      expectedEvidence: "All required credentials confirmed in vault or env — no raw values in evidence",
    }));
    safetyChecks.push(`${analysis.envMissing.length} credential(s) required before build/deploy`);
    approvalRequired = true;
  }

  // ── Step 6: Dependency repair ────────────────────────────────────────────────
  const hasDependencyErrors = knownErrors.some((e) => /install|dependency|module not found|cannot find/i.test(e));
  const hasLockfileIssue = analysis.dependencyFindings.some((f) => f.id === "dep-no-lockfile");
  if (hasDependencyErrors || hasLockfileIssue) {
    agentSet.add("builder");
    steps.push(makeStep(stepIdx++, {
      title: "Builder: repair dependencies",
      description: `Run ${analysis.packageManager} install and audit. Resolve module-not-found errors and pin lockfile.`,
      agentName: "builder",
      toolId: null,
      riskLevel: "low",
      expectedEvidence: "Dependency install output: clean + lockfile updated",
    }));
  }

  // ── Step 7: Build repair ─────────────────────────────────────────────────────
  const hasBuildErrors = knownErrors.some((e) => /build|compile|tsc|typecheck|webpack|vite|esbuild/i.test(e));
  const hasBuildFindings = analysis.buildFindings.some((f) => f.severity === "high" || f.severity === "critical");
  if (hasBuildErrors || hasBuildFindings) {
    agentSet.add("builder");
    steps.push(makeStep(stepIdx++, {
      title: "Builder: fix build errors",
      description: "Run typecheck and build. Fix reported type errors, missing scripts, and compilation failures.",
      agentName: "builder",
      toolId: "build.safe_build",
      riskLevel: "low",
      requiresSafeBuild: true,
      expectedEvidence: "Build output: zero errors. Typecheck: clean.",
    }));
    toolSet.push({ toolId: "build.safe_build", label: "Safe Build Gate", riskLevel: "read_only", requiresApproval: false });
  }

  // ── Step 8: Security remediation ────────────────────────────────────────────
  const criticalSec = analysis.securityFindings.filter((f) => f.severity === "critical");
  if (criticalSec.length > 0) {
    agentSet.add("security");
    overallRisk = "critical";
    approvalRequired = true;
    steps.push(makeStep(stepIdx++, {
      title: "Security: resolve critical findings",
      description: `Resolve ${criticalSec.length} critical security finding(s): ${criticalSec.map((f) => f.description.slice(0, 60)).join("; ")}`,
      agentName: "security",
      toolId: null,
      riskLevel: "high",
      requiresApproval: true,
      expectedEvidence: "Security findings resolved and documented — no secrets in evidence",
    }));
  }

  // ── Step 9: Safe build ───────────────────────────────────────────────────────
  const codeChanged = hasBuildErrors || hasDependencyErrors || criticalSec.length > 0 || analysis.envMissing.length > 0;
  const safeBuildRequired = codeChanged || strictMode || analysis.launchBlockers.length > 0;
  if (safeBuildRequired) {
    agentSet.add("builder");
    steps.push(makeStep(stepIdx++, {
      title: "Builder: safe build gate",
      description: "Run pnpm run safe-build. All typecheck, build, test, and security gates must pass before deployment.",
      agentName: "builder",
      toolId: "build.safe_build",
      riskLevel: "read_only",
      requiresSafeBuild: true,
      expectedEvidence: "Safe build report: all gates passed",
    }));
    toolSet.push({ toolId: "build.safe_build", label: "Safe Build Gate", riskLevel: "read_only", requiresApproval: false });
    safetyChecks.push("Safe build must pass before any deployment step");
  }

  // ── Step 10: QA release gate ────────────────────────────────────────────────
  const qaRequired = safeBuildRequired || strictMode;
  if (qaRequired) {
    agentSet.add("qa");
    steps.push(makeStep(stepIdx++, {
      title: "QA: run release gate",
      description: "Run VIBA QA Release Gate. All required checks must pass or be documented as manual. Critical blockers must be resolved.",
      agentName: "qa",
      toolId: null,
      riskLevel: "read_only",
      expectedEvidence: "QA report: passed or passed_with_warnings. No critical blockers. rawValuesReturned: false.",
    }));
    safetyChecks.push("QA release gate must complete before owner review");
  }

  // ── Step 11: Deployment (approval always required) ──────────────────────────
  const deploymentRequested = /deploy|launch|ship|push to|railway|production|live/i.test(userRequest);
  if (deploymentRequested || analysis.railwayReadiness === "ready") {
    agentSet.add("deployment");
    overallRisk = raiseRisk(overallRisk, "high");
    approvalRequired = true;
    steps.push(makeStep(stepIdx++, {
      title: "Deployment: deploy to target (approval required)",
      description: `Deploy to ${analysis.deploymentTarget ?? "target environment"}. Requires owner approval. No auto-deploy.`,
      agentName: "deployment",
      toolId: "deployment.railway_deploy",
      riskLevel: "high",
      requiresApproval: true,
      requiresSafeBuild: true,
      expectedEvidence: "Deployment confirmation + health check URL. No secrets in evidence.",
    }));
    toolSet.push({ toolId: "deployment.railway_deploy", label: "Railway Deploy", riskLevel: "high", requiresApproval: true });
    safetyChecks.push("Deployment requires owner approval — no automatic deploy");
  }

  // ── Step 12: Reviewer sign-off ───────────────────────────────────────────────
  agentSet.add("reviewer");
  steps.push(makeStep(stepIdx++, {
    title: "Reviewer: produce evidence report",
    description: "Generate final evidence report. Confirm all repair steps completed, blockers resolved, QA passed. Flag remaining items for owner.",
    agentName: "reviewer",
    toolId: null,
    riskLevel: "read_only",
    expectedEvidence: "Evidence report attached. rawValuesReturned: false. No secrets.",
  }));

  // ── Deduplicate tools ─────────────────────────────────────────────────────────
  const uniqueTools = toolSet.filter((t, i, arr) => arr.findIndex((x) => x.toolId === t.toolId) === i);

  // ── Summary ───────────────────────────────────────────────────────────────────
  const summary =
    `Repair plan for ${analysis.projectName} (${analysis.detectedFramework}): ` +
    `${steps.length} step(s), risk level: ${overallRisk}. ` +
    `${analysis.launchBlockers.length} launch blocker(s). ` +
    `Safe build: ${safeBuildRequired ? "required" : "not required"}. ` +
    `QA gate: ${qaRequired ? "required" : "not required"}. ` +
    `Approval required: ${approvalRequired ? "yes" : "no"}.`;

  return {
    planId: `repair-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    summary,
    riskLevel: overallRisk,
    requiredAgents: [...agentSet],
    requiredTools: uniqueTools,
    requiredCredentials: credSet,
    approvalRequired,
    repairSteps: steps,
    safetyChecks,
    launchBlockers: analysis.launchBlockers,
    safeBuildRequired,
    qaRequired,
    estimatedStepCount: steps.length,
    rawValuesReturned: false,
  };
}
