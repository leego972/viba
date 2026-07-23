import { getAllTools, type ToolDefinition } from "./toolRegistry";
import { getAllBuilderTools } from "./builderToolbox";

export type CapabilityStatus =
  | "executable"
  | "planning_only"
  | "credential_required"
  | "external_setup_required"
  | "adapter_required";

export type CapabilityRecord = {
  toolId: string;
  label: string;
  category: string;
  status: CapabilityStatus;
  canRunNow: boolean;
  requiresCredential: boolean;
  requiresApproval: boolean;
  requiresSafeBuild: boolean;
  truthfulClaim: string;
  missingForFullExecution: string[];
  rawValuesReturned: false;
};

const PLANNING_PREFIXES = [
  "builder.",
  "deployment.manual_guide.",
  "custom.deploy.guide",
  "report.evidence.generate",
];

function isPlanningTool(toolId: string): boolean {
  return PLANNING_PREFIXES.some((prefix) => toolId.startsWith(prefix));
}

function hasExecutionAdapter(tool: unknown): tool is ToolDefinition & { executionName: string } {
  return typeof tool === "object" && tool !== null &&
    "executionName" in tool && typeof (tool as { executionName?: unknown }).executionName === "string" &&
    Boolean((tool as { executionName?: string }).executionName);
}

function statusFor(tool: {
  toolId: string;
  credentialProvider: string | null;
  requiresApproval: boolean;
}, adapterPresent: boolean): CapabilityStatus {
  if (isPlanningTool(tool.toolId)) return "planning_only";
  if (!adapterPresent) return "adapter_required";
  if (tool.requiresApproval) return "external_setup_required";
  if (tool.credentialProvider) return "credential_required";
  return "executable";
}

function missingFor(
  status: CapabilityStatus,
  credentialProvider: string | null,
  requiresApproval: boolean,
): string[] {
  switch (status) {
    case "planning_only":
      return ["A verified live mutation adapter is required before the generated plan can change code or infrastructure."];
    case "credential_required":
      return [`A ${credentialProvider ?? "provider"} credential configured server-side or in the VIBA vault.`];
    case "adapter_required":
      return ["Concrete execution adapter", "automated tests", "safe-build proof", "staging smoke test"];
    case "external_setup_required":
      return requiresApproval
        ? ["Server-validated one-time approval workflow", "replay protection", "audit proof"]
        : ["External provider setup and verification"];
    case "executable":
      return [];
  }
}

function claimFor(status: CapabilityStatus): string {
  switch (status) {
    case "planning_only":
      return "Generates a structured plan, specification, checklist, or prompt. It does not mutate code or production.";
    case "credential_required":
      return "Has a concrete execution adapter and can run after the required credential is configured and policy checks pass.";
    case "adapter_required":
      return "Registered in the catalogue but not live. It has no verified execution adapter and must not be advertised as executable.";
    case "external_setup_required":
      return "The execution adapter exists, but live use remains blocked until the required secure approval or external setup is completed.";
    case "executable":
      return "Executes through a concrete broker adapter and is still subject to authentication, policy, and error checks.";
  }
}

export function getToolCapabilityMatrix(): CapabilityRecord[] {
  const all = [...getAllTools(), ...getAllBuilderTools()];
  const seen = new Set<string>();

  return all
    .filter((tool) => {
      if (seen.has(tool.toolId)) return false;
      seen.add(tool.toolId);
      return true;
    })
    .map((tool) => {
      const status = statusFor(tool, hasExecutionAdapter(tool));
      return {
        toolId: tool.toolId,
        label: tool.label,
        category: tool.category,
        status,
        canRunNow: status === "executable" || status === "planning_only",
        requiresCredential: Boolean(tool.credentialProvider),
        requiresApproval: tool.requiresApproval,
        requiresSafeBuild: tool.requiresSafeBuild,
        truthfulClaim: claimFor(status),
        missingForFullExecution: missingFor(status, tool.credentialProvider, tool.requiresApproval),
        rawValuesReturned: false,
      };
    });
}

export function getCapabilitySummary(): Record<string, unknown> {
  const matrix = getToolCapabilityMatrix();
  const counts = matrix.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    counts,
    totalTools: matrix.length,
    truthfulAdvertisingRule: "Only executable tools may be described as live actions. planning_only tools must be labelled as plans. credential_required, adapter_required, and external_setup_required tools must display their blocking condition.",
    rawValuesReturned: false,
  };
}

export function routeJobToToolSequence(jobType: string): Record<string, unknown> {
  const normalized = jobType.toLowerCase();
  if (normalized.includes("design") || normalized.includes("ui") || normalized.includes("ux")) {
    return { jobType, sequence: ["builder.design.review", "builder.ui.spec.generate", "builder.acceptance.criteria", "builder.coding_agent.prompt"], rawValuesReturned: false };
  }
  if (normalized.includes("repair") || normalized.includes("fix") || normalized.includes("bug")) {
    return { jobType, sequence: ["builder.repair.diagnose", "builder.repair.plan", "builder.patch.plan", "builder.test.plan", "builder.release.gate"], rawValuesReturned: false };
  }
  if (normalized.includes("upgrade") || normalized.includes("professional") || normalized.includes("improve")) {
    return { jobType, sequence: ["builder.upgrade.plan", "builder.feature.plan", "builder.test.plan", "builder.release.gate", "builder.acceptance.criteria"], rawValuesReturned: false };
  }
  if (normalized.includes("deploy") || normalized.includes("render") || normalized.includes("railway")) {
    return { jobType, sequence: ["deployment.provider.readiness", "deployment.plan", "deployment.env.read", "builder.release.gate", "deployment.manual_guide.generate"], rawValuesReturned: false };
  }
  return { jobType, sequence: ["builder.project.blueprint", "builder.feature.plan", "builder.patch.plan", "builder.test.plan", "builder.release.gate"], rawValuesReturned: false };
}
