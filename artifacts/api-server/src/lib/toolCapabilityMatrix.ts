import { getAllTools } from "./toolRegistry";
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

const KNOWN_ADAPTER_REQUIRED = new Set([
  "build.safe_build",
  "railway.deploy.trigger",
  "railway.env.write",
  "render.env.write",
  "render.deploy.trigger",
  "digitalocean.env.write",
  "digitalocean.deploy.trigger",
  "vercel.env.write",
  "vercel.deploy.trigger",
  "sevall.env.write",
  "sevall.deploy.trigger",
]);

function isPlanningTool(toolId: string): boolean {
  return PLANNING_PREFIXES.some((prefix) => toolId.startsWith(prefix));
}

function statusFor(toolId: string, credentialProvider: string | null): CapabilityStatus {
  if (isPlanningTool(toolId)) return "planning_only";
  if (KNOWN_ADAPTER_REQUIRED.has(toolId)) return "adapter_required";
  if (credentialProvider) return "credential_required";
  return "executable";
}

function missingFor(status: CapabilityStatus, credentialProvider: string | null): string[] {
  if (status === "planning_only") return ["Live mutation tool if the plan must change code or infrastructure."];
  if (status === "credential_required") return [`${credentialProvider} credential configured server-side or in VIBA vault.`];
  if (status === "adapter_required") return ["Live adapter implementation", "tests", "safe-build proof", "staging smoke test"];
  if (status === "external_setup_required") return ["External provider setup and verification"];
  return [];
}

function claimFor(status: CapabilityStatus): string {
  switch (status) {
    case "planning_only": return "Can generate a structured plan/spec/checklist now. Does not mutate production or code by itself.";
    case "credential_required": return "Can run only after the required credential exists and policy gates pass.";
    case "adapter_required": return "Registered or planned, but must not be advertised as live until the adapter and checks pass.";
    case "external_setup_required": return "Requires external provider setup before execution.";
    case "executable": return "Can execute through the current broker path, subject to policy checks.";
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
      const status = statusFor(tool.toolId, tool.credentialProvider);
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
        missingForFullExecution: missingFor(status, tool.credentialProvider),
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
    truthfulAdvertisingRule: "Only tools with status executable, planning_only, or credential_required may be shown as available. Tools marked adapter_required must be shown as not live yet.",
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
