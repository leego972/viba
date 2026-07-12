import type { ToolDefinition } from "./toolRegistry";

export type BuilderToolResult = {
  handled: true;
  result: Record<string, unknown>;
};

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split("\n").map((v) => v.trim()).filter(Boolean);
  return [];
}

function context(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    projectName: asText(payload["projectName"], "VIBA project"),
    goal: asText(payload["goal"] ?? payload["request"], "Complete the requested software task."),
    repoUrl: asText(payload["repoUrl"], ""),
    stack: asList(payload["stack"]),
    files: asList(payload["files"] ?? payload["fileList"] ?? payload["changedFiles"]),
    constraints: asList(payload["constraints"]),
    targetPlatform: asText(payload["targetPlatform"], "Render"),
  };
}

function tool(toolId: string, label: string, description: string, category: ToolDefinition["category"] = "build"): ToolDefinition {
  return {
    toolId,
    label,
    category,
    description,
    riskLevel: "read_only",
    permissionsRequired: ["login_required"],
    credentialProvider: null,
    credentialKind: null,
    supportsDryRun: false,
    requiresApproval: false,
    requiresSafeBuild: false,
    outputsSecretValues: false,
  };
}

export const BUILDER_TOOLBOX: Record<string, ToolDefinition> = {
  "builder.project.blueprint": tool("builder.project.blueprint", "Builder: Project Blueprint", "Create a structured software blueprint with modules, workflow, tests, and release notes."),
  "builder.feature.plan": tool("builder.feature.plan", "Builder: Feature Plan", "Create an implementation plan for a feature, including files, APIs, UI, tests, and acceptance criteria."),
  "builder.patch.plan": tool("builder.patch.plan", "Builder: Patch Plan", "Plan a safe file-by-file code patch before any repository write.", "repository"),
  "builder.design.review": tool("builder.design.review", "Builder: Design Review", "Review a UI or design brief for layout, mobile, clarity, trust, and conversion issues.", "browser"),
  "builder.ui.spec.generate": tool("builder.ui.spec.generate", "Builder: UI Spec", "Generate a UI implementation specification with components, states, copy, and responsive rules."),
  "builder.repair.diagnose": tool("builder.repair.diagnose", "Builder: Repair Diagnosis", "Diagnose build, runtime, API, UI, and deployment failures from symptoms and logs."),
  "builder.repair.plan": tool("builder.repair.plan", "Builder: Repair Plan", "Create a ranked repair plan with verification and rollback notes."),
  "builder.upgrade.plan": tool("builder.upgrade.plan", "Builder: Upgrade Plan", "Create a professional upgrade plan for architecture, reliability, UX, testing, deployment, and monitoring."),
  "builder.test.plan": tool("builder.test.plan", "Builder: Test Plan", "Generate a practical test plan for unit, API, browser, mobile, deployment, and regression checks."),
  "builder.release.gate": tool("builder.release.gate", "Builder: Release Gate", "Generate a release checklist before merge or deploy."),
  "builder.coding_agent.prompt": tool("builder.coding_agent.prompt", "Builder: Coding-Agent Prompt", "Generate a precise implementation prompt for Replit or another coding agent.", "ai"),
  "builder.acceptance.criteria": tool("builder.acceptance.criteria", "Builder: Acceptance Criteria", "Generate acceptance criteria and proof requirements for a build, repair, design, or upgrade task.", "reports"),
};

export function getBuilderToolById(toolId: string): ToolDefinition | undefined {
  return BUILDER_TOOLBOX[toolId];
}

export function getAllBuilderTools(): ToolDefinition[] {
  return Object.values(BUILDER_TOOLBOX);
}

export function executeBuilderToolAction(toolId: string, action: string, payload: Record<string, unknown> = {}): BuilderToolResult | null {
  const definition = getBuilderToolById(toolId);
  if (!definition) return null;

  const ctx = context(payload);
  const goal = asText(payload["goal"] ?? payload["request"], "Complete the requested task with proof.");
  const files = asList(payload["files"] ?? payload["fileList"] ?? payload["changedFiles"]);
  const symptoms = asList(payload["knownErrors"] ?? payload["errors"] ?? payload["logs"]);

  const base = {
    toolId,
    action,
    label: definition.label,
    project: ctx,
    mutationPerformed: false,
    rawValuesReturned: false,
  };

  const outputs: Record<string, Record<string, unknown>> = {
    "builder.project.blueprint": {
      modules: ["frontend", "api", "data", "toolbox", "tests", "deployment", "monitoring"],
      workflow: ["inspect", "plan", "implement on branch", "test", "build", "report", "review"],
      evidenceRequired: ["changed files", "typecheck result", "test result", "build result", "manual proof where relevant"],
    },
    "builder.feature.plan": {
      objective: goal,
      implementationOrder: ["types", "service logic", "API route", "UI integration", "tests", "docs", "evidence report"],
      likelyFiles: files.length ? files : ["service/lib module", "API route", "frontend component", "test file"],
      acceptanceCriteria: ["workflow completes", "errors handled", "mobile works", "checks pass"],
    },
    "builder.patch.plan": {
      branch: asText(payload["branch"], "feature/viba-safe-change"),
      filesToInspect: files,
      fileChangePlan: files.map((file) => ({ file, action: "inspect_then_patch" })),
      commitMessage: asText(payload["commitMessage"], "feat: implement VIBA improvement"),
      checks: ["pnpm run typecheck", "pnpm test", "bash render-build.sh"],
    },
    "builder.design.review": {
      checks: ["clarity", "primary action", "mobile layout", "contrast", "trust proof", "empty/error/loading states", "visual hierarchy"],
      findingFormat: ["issue", "severity", "impact", "recommendation", "proof after fix"],
    },
    "builder.ui.spec.generate": {
      pageGoal: goal,
      sections: ["status", "primary action", "configuration", "evidence/logs", "history", "settings"],
      states: ["loading", "empty", "ready", "submitting", "success", "warning", "error", "disabled"],
      responsiveRules: ["single column on mobile", "no clipped buttons", "large tap targets", "tables become cards"],
    },
    "builder.repair.diagnose": {
      symptoms,
      likelyCauses: ["dependency mismatch", "missing environment setting", "route/import mismatch", "database mismatch", "build output mismatch", "port/healthcheck mismatch", "UI state bug"],
      nextChecks: ["read exact error", "find changed file", "confirm build/start command", "reproduce smallest case", "patch on branch"],
    },
    "builder.repair.plan": {
      critical: ["crashes", "build failures", "auth/payment/deploy blockers"],
      high: ["broken primary flows", "failed API routes", "mobile blockers"],
      medium: ["validation", "error states", "missing tests"],
      verification: ["typecheck", "targeted tests", "safe build", "manual proof"],
    },
    "builder.upgrade.plan": {
      phases: ["stabilise", "professionalise", "automate", "scale"],
      focus: ["architecture", "reliability", "UX", "tests", "deployment", "monitoring", "cost control"],
    },
    "builder.test.plan": {
      commands: ["pnpm run typecheck", "pnpm test", "bash render-build.sh"],
      suites: ["unit", "API", "auth", "billing", "tool broker", "project import", "deployment", "browser/mobile", "regression"],
      proof: ["screenshots", "API sample", "build log", "rollback note"],
    },
    "builder.release.gate": {
      mustPass: ["branch only", "typecheck", "tests", "render build", "health check", "evidence report"],
      blockMergeIf: ["merge conflict", "failed build", "untested migration", "missing rollback plan"],
    },
    "builder.coding_agent.prompt": {
      prompt: [
        "Work on a new branch only. Do not commit directly to main.",
        `Goal: ${goal}`,
        "Inspect the repo before changing files. Cite exact files and routes found.",
        "Implement the smallest complete change. Do not use placeholders.",
        "Do not change Render build/start config unless the Render build passes afterwards.",
        "Run typecheck, tests, and Render build. Document exact failures if any.",
        "Write an evidence report and open a PR. Do not merge unless checks pass.",
      ].join("\n"),
    },
    "builder.acceptance.criteria": {
      criteria: ["workflow complete", "approval boundaries respected", "checks pass or blockers documented", "Render build unchanged or proven", "evidence report produced"],
    },
  };

  return {
    handled: true,
    result: {
      ...base,
      output: outputs[toolId] ?? { note: "Builder tool executed." },
    },
  };
}
