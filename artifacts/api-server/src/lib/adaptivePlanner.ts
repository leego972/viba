/**
 * VIBA Adaptive Planner — Pure Module
 *
 * Classifies a user request into a workflow family and returns a structured,
 * ordered plan with agent roles, tools, cost estimate, and approval checkpoints.
 *
 * No DB calls, no side effects — pure function, fully testable.
 * Do NOT wire into live agentLoop until unit tests pass.
 */

// ─── Workflow families ────────────────────────────────────────────────────────

export type WorkflowFamily =
  | "project_doctor"
  | "code_repair"
  | "new_build_planning"
  | "research_report"
  | "business_planning"
  | "deployment_review"
  | "ui_ux_review"
  | "launch_readiness"
  | "unknown";

export type CostLevel = "low" | "medium" | "high";
export type ApprovalCheckpoint = { afterStep: number; reason: string; blocking: boolean };

export interface PlannedTask {
  index: number;
  title: string;
  type: string;
  description: string;
  suggestedRole: string;
  requiredTools: string[];
  isReviewStep: boolean;
  needsApproval: boolean;
  estimatedCredits: number;
}

export interface AdaptivePlan {
  workflowFamily: WorkflowFamily;
  tasks: PlannedTask[];
  suggestedAgentRoles: Record<string, string>;
  requiredTools: string[];
  estimatedCostLevel: CostLevel;
  approvalCheckpoints: ApprovalCheckpoint[];
  expectedReportOutput: string[];
  complexity: "simple" | "moderate" | "complex";
  summary: string;
}

// ─── Classification signals ───────────────────────────────────────────────────

interface FamilySignal {
  family: WorkflowFamily;
  keywords: RegExp[];
  weight: number;
}

const FAMILY_SIGNALS: FamilySignal[] = [
  {
    family: "project_doctor",
    keywords: [/diagnos/i, /doctor/i, /health\s*check/i, /audit/i, /inspect/i, /review\s+repo/i, /check\s+repo/i, /viba[\s-]doctor/i],
    weight: 10,
  },
  {
    family: "code_repair",
    keywords: [/fix\s+(the|a|this|my)?/i, /repair/i, /bug/i, /broken/i, /crash/i, /error.*in\s+(the|my)/i, /debug/i, /patch/i, /failing/i],
    weight: 8,
  },
  {
    family: "new_build_planning",
    keywords: [/build\s+(a|an|new|the)/i, /create\s+(a|an|new)/i, /implement/i, /develop/i, /scaffold/i, /set\s+up/i, /new\s+feature/i, /add\s+support\s+for/i],
    weight: 7,
  },
  {
    family: "research_report",
    keywords: [/research/i, /report\s+on/i, /summarize/i, /summarise/i, /analyse/i, /analyze/i, /compare/i, /evaluate/i, /find\s+out/i, /what\s+(is|are)/i],
    weight: 8,
  },
  {
    family: "business_planning",
    keywords: [/business\s+plan/i, /strategy/i, /market/i, /revenue/i, /pricing/i, /launch\s+plan/i, /go[\s-]to[\s-]market/i, /roadmap/i, /growth/i],
    weight: 7,
  },
  {
    family: "deployment_review",
    keywords: [/deploy/i, /release/i, /production/i, /railway/i, /render/i, /vercel/i, /infra/i, /devops/i, /ci\/cd/i, /pipeline/i],
    weight: 8,
  },
  {
    family: "ui_ux_review",
    keywords: [/ui/i, /ux/i, /design/i, /layout/i, /landing\s+page/i, /interface/i, /usability/i, /accessibility/i, /mobile/i, /responsive/i],
    weight: 6,
  },
  {
    family: "launch_readiness",
    keywords: [/launch\s+readiness/i, /ready\s+to\s+launch/i, /pre[\s-]launch/i, /go\s+live/i, /production\s+ready/i, /release\s+checklist/i],
    weight: 9,
  },
];

// ─── Per-family plan templates ────────────────────────────────────────────────

function projectDoctorPlan(goal: string): Omit<AdaptivePlan, "complexity" | "summary"> {
  return {
    workflowFamily: "project_doctor",
    tasks: [
      { index: 1, title: "Scan Repository Structure", type: "doctor", description: `Read-only scan of ${goal}`, suggestedRole: "strategist", requiredTools: ["github.getTree", "github.getFile"], isReviewStep: false, needsApproval: false, estimatedCredits: 2 },
      { index: 2, title: "Identify Blockers & Warnings", type: "doctor", description: "Classify findings by severity: critical, high, medium, low", suggestedRole: "reviewer", requiredTools: [], isReviewStep: true, needsApproval: false, estimatedCredits: 1 },
      { index: 3, title: "Generate Health Score", type: "doctor", description: "Score 0–100, weight by severity and count", suggestedRole: "strategist", requiredTools: [], isReviewStep: false, needsApproval: false, estimatedCredits: 1 },
      { index: 4, title: "Produce Repair Proposals", type: "doctor", description: "List PR-ready fixes and manual-only items. No writes without explicit approval.", suggestedRole: "builder", requiredTools: [], isReviewStep: true, needsApproval: true, estimatedCredits: 1 },
    ],
    suggestedAgentRoles: { primary: "strategist", secondary: "reviewer" },
    requiredTools: ["github.getTree", "github.getFile"],
    estimatedCostLevel: "low",
    approvalCheckpoints: [
      { afterStep: 4, reason: "Any repair PR write requires owner approval before GitHub is mutated", blocking: true },
    ],
    expectedReportOutput: ["health_score", "blockers_list", "warnings_list", "repair_proposals", "next_action"],
  };
}

function codeRepairPlan(goal: string): Omit<AdaptivePlan, "complexity" | "summary"> {
  return {
    workflowFamily: "code_repair",
    tasks: [
      { index: 1, title: "Reproduce & Isolate", type: "research", description: `Identify the failing path in: ${goal}`, suggestedRole: "researcher", requiredTools: ["github.getFile"], isReviewStep: false, needsApproval: false, estimatedCredits: 2 },
      { index: 2, title: "Root Cause Analysis", type: "code_review", description: "Trace the bug to its origin. Do not propose fixes yet.", suggestedRole: "reviewer", requiredTools: [], isReviewStep: true, needsApproval: false, estimatedCredits: 2 },
      { index: 3, title: "Draft Fix", type: "build", description: "Write the patch. Scope to minimum change.", suggestedRole: "builder", requiredTools: ["github.getFile"], isReviewStep: false, needsApproval: false, estimatedCredits: 3 },
      { index: 4, title: "Review Fix", type: "code_review", description: "Peer review the patch for regressions and test coverage.", suggestedRole: "reviewer", requiredTools: [], isReviewStep: true, needsApproval: false, estimatedCredits: 2 },
      { index: 5, title: "Apply & Verify", type: "build", description: "Push fix to branch and confirm build passes.", suggestedRole: "builder", requiredTools: ["github.createBranch", "github.pushFile"], isReviewStep: false, needsApproval: true, estimatedCredits: 3 },
    ],
    suggestedAgentRoles: { primary: "builder", secondary: "reviewer", support: "researcher" },
    requiredTools: ["github.getFile", "github.createBranch", "github.pushFile"],
    estimatedCostLevel: "medium",
    approvalCheckpoints: [
      { afterStep: 4, reason: "Owner confirms fix approach before code is pushed", blocking: true },
    ],
    expectedReportOutput: ["root_cause", "fix_description", "files_changed", "test_results", "build_status"],
  };
}

function newBuildPlan(goal: string): Omit<AdaptivePlan, "complexity" | "summary"> {
  return {
    workflowFamily: "new_build_planning",
    tasks: [
      { index: 1, title: "Requirements Analysis", type: "planning", description: `Clarify scope and constraints for: ${goal}`, suggestedRole: "strategist", requiredTools: [], isReviewStep: false, needsApproval: false, estimatedCredits: 2 },
      { index: 2, title: "Architecture Plan", type: "planning", description: "Draft technical approach, data model, and API surface", suggestedRole: "strategist", requiredTools: [], isReviewStep: false, needsApproval: false, estimatedCredits: 3 },
      { index: 3, title: "Owner Review of Plan", type: "code_review", description: "Present plan to owner before any implementation begins", suggestedRole: "reviewer", requiredTools: [], isReviewStep: true, needsApproval: true, estimatedCredits: 1 },
      { index: 4, title: "Implement Core", type: "build", description: "Build the primary feature set", suggestedRole: "builder", requiredTools: ["github.pushFile", "github.createBranch"], isReviewStep: false, needsApproval: false, estimatedCredits: 8 },
      { index: 5, title: "Code Review", type: "code_review", description: "Review implementation for correctness, security, and style", suggestedRole: "reviewer", requiredTools: [], isReviewStep: true, needsApproval: false, estimatedCredits: 3 },
      { index: 6, title: "Final QA", type: "final_qa", description: "Validate build, run checks, confirm all requirements met", suggestedRole: "qa", requiredTools: [], isReviewStep: true, needsApproval: true, estimatedCredits: 2 },
    ],
    suggestedAgentRoles: { primary: "builder", secondary: "strategist", review: "reviewer", qa: "qa" },
    requiredTools: ["github.pushFile", "github.createBranch"],
    estimatedCostLevel: "high",
    approvalCheckpoints: [
      { afterStep: 3, reason: "Plan sign-off before implementation spend begins", blocking: true },
      { afterStep: 6, reason: "Owner QA sign-off before merge", blocking: true },
    ],
    expectedReportOutput: ["architecture_doc", "files_created", "code_review_summary", "qa_results", "next_action"],
  };
}

function researchReportPlan(goal: string): Omit<AdaptivePlan, "complexity" | "summary"> {
  return {
    workflowFamily: "research_report",
    tasks: [
      { index: 1, title: "Define Research Scope", type: "planning", description: `Clarify key questions for: ${goal}`, suggestedRole: "strategist", requiredTools: [], isReviewStep: false, needsApproval: false, estimatedCredits: 1 },
      { index: 2, title: "Gather Information", type: "research", description: "Search, read, and collect relevant data", suggestedRole: "researcher", requiredTools: [], isReviewStep: false, needsApproval: false, estimatedCredits: 3 },
      { index: 3, title: "Synthesise Findings", type: "research", description: "Summarise and cross-reference sources", suggestedRole: "researcher", requiredTools: [], isReviewStep: false, needsApproval: false, estimatedCredits: 2 },
      { index: 4, title: "Produce Report", type: "final_qa", description: "Write structured report with findings and recommendations", suggestedRole: "strategist", requiredTools: [], isReviewStep: true, needsApproval: false, estimatedCredits: 2 },
    ],
    suggestedAgentRoles: { primary: "researcher", secondary: "strategist" },
    requiredTools: [],
    estimatedCostLevel: "low",
    approvalCheckpoints: [],
    expectedReportOutput: ["research_summary", "key_findings", "recommendations", "sources"],
  };
}

function businessPlanningPlan(goal: string): Omit<AdaptivePlan, "complexity" | "summary"> {
  return {
    workflowFamily: "business_planning",
    tasks: [
      { index: 1, title: "Opportunity Analysis", type: "research", description: `Market and competitive context for: ${goal}`, suggestedRole: "researcher", requiredTools: [], isReviewStep: false, needsApproval: false, estimatedCredits: 3 },
      { index: 2, title: "Strategy Draft", type: "planning", description: "Draft positioning, pricing, and growth approach", suggestedRole: "strategist", requiredTools: [], isReviewStep: false, needsApproval: false, estimatedCredits: 3 },
      { index: 3, title: "Review & Pressure Test", type: "code_review", description: "Critique strategy for assumptions and risks", suggestedRole: "reviewer", requiredTools: [], isReviewStep: true, needsApproval: false, estimatedCredits: 2 },
      { index: 4, title: "Final Business Plan", type: "final_qa", description: "Produce clean document with executive summary", suggestedRole: "strategist", requiredTools: [], isReviewStep: true, needsApproval: false, estimatedCredits: 2 },
    ],
    suggestedAgentRoles: { primary: "strategist", secondary: "researcher", review: "reviewer" },
    requiredTools: [],
    estimatedCostLevel: "medium",
    approvalCheckpoints: [
      { afterStep: 3, reason: "Owner validates strategy direction before final document", blocking: false },
    ],
    expectedReportOutput: ["executive_summary", "market_analysis", "strategy", "risk_factors", "action_plan"],
  };
}

function deploymentReviewPlan(goal: string): Omit<AdaptivePlan, "complexity" | "summary"> {
  return {
    workflowFamily: "deployment_review",
    tasks: [
      { index: 1, title: "Config Audit", type: "doctor", description: `Inspect deployment config for: ${goal}`, suggestedRole: "reviewer", requiredTools: ["github.getFile"], isReviewStep: false, needsApproval: false, estimatedCredits: 2 },
      { index: 2, title: "Env Var Check", type: "doctor", description: "Confirm all required env vars are documented and present", suggestedRole: "reviewer", requiredTools: [], isReviewStep: true, needsApproval: false, estimatedCredits: 1 },
      { index: 3, title: "Health Endpoint Verification", type: "final_qa", description: "Confirm /health or equivalent responds correctly", suggestedRole: "qa", requiredTools: [], isReviewStep: true, needsApproval: false, estimatedCredits: 1 },
      { index: 4, title: "Deployment Sign-off", type: "deployment_approval", description: "Owner approves deployment proceed", suggestedRole: "strategist", requiredTools: [], isReviewStep: true, needsApproval: true, estimatedCredits: 1 },
      { index: 5, title: "Deploy", type: "build", description: "Trigger deployment to production", suggestedRole: "builder", requiredTools: ["railway.deploy", "render.deploy"], isReviewStep: false, needsApproval: false, estimatedCredits: 2 },
    ],
    suggestedAgentRoles: { primary: "builder", secondary: "reviewer", qa: "qa" },
    requiredTools: ["github.getFile", "railway.deploy"],
    estimatedCostLevel: "medium",
    approvalCheckpoints: [
      { afterStep: 4, reason: "Production deployment requires explicit owner sign-off", blocking: true },
    ],
    expectedReportOutput: ["config_findings", "env_var_status", "health_check_result", "deployment_status"],
  };
}

function uiUxReviewPlan(goal: string): Omit<AdaptivePlan, "complexity" | "summary"> {
  return {
    workflowFamily: "ui_ux_review",
    tasks: [
      { index: 1, title: "UX Audit", type: "ux_review", description: `Review user flows and layout for: ${goal}`, suggestedRole: "reviewer", requiredTools: [], isReviewStep: false, needsApproval: false, estimatedCredits: 2 },
      { index: 2, title: "Accessibility Check", type: "ux_review", description: "Identify accessibility gaps and colour contrast issues", suggestedRole: "reviewer", requiredTools: [], isReviewStep: true, needsApproval: false, estimatedCredits: 2 },
      { index: 3, title: "Improvement Proposals", type: "creative_direction", description: "Draft concrete UI copy and layout suggestions", suggestedRole: "strategist", requiredTools: [], isReviewStep: false, needsApproval: false, estimatedCredits: 2 },
      { index: 4, title: "Owner Review", type: "final_qa", description: "Present proposals before any code change", suggestedRole: "reviewer", requiredTools: [], isReviewStep: true, needsApproval: true, estimatedCredits: 1 },
    ],
    suggestedAgentRoles: { primary: "reviewer", secondary: "strategist" },
    requiredTools: [],
    estimatedCostLevel: "low",
    approvalCheckpoints: [
      { afterStep: 4, reason: "Owner approves copy and layout changes before implementation", blocking: true },
    ],
    expectedReportOutput: ["ux_findings", "accessibility_issues", "improvement_proposals", "approved_changes"],
  };
}

function launchReadinessPlan(goal: string): Omit<AdaptivePlan, "complexity" | "summary"> {
  return {
    workflowFamily: "launch_readiness",
    tasks: [
      { index: 1, title: "Pre-launch Checklist", type: "doctor", description: `Run full readiness check for: ${goal}`, suggestedRole: "reviewer", requiredTools: ["github.getFile"], isReviewStep: false, needsApproval: false, estimatedCredits: 2 },
      { index: 2, title: "Security Review", type: "code_review", description: "Confirm no secrets exposed, no open vulnerabilities", suggestedRole: "reviewer", requiredTools: [], isReviewStep: true, needsApproval: false, estimatedCredits: 2 },
      { index: 3, title: "Performance & Load Check", type: "final_qa", description: "Verify the app handles expected traffic", suggestedRole: "qa", requiredTools: [], isReviewStep: true, needsApproval: false, estimatedCredits: 2 },
      { index: 4, title: "Staging Smoke Test", type: "final_qa", description: "Run key user journeys on staging environment", suggestedRole: "qa", requiredTools: [], isReviewStep: true, needsApproval: false, estimatedCredits: 2 },
      { index: 5, title: "Owner Launch Approval", type: "deployment_approval", description: "Final owner sign-off before production go-live", suggestedRole: "strategist", requiredTools: [], isReviewStep: true, needsApproval: true, estimatedCredits: 1 },
      { index: 6, title: "Go Live", type: "build", description: "Flip production traffic. Monitor health endpoint.", suggestedRole: "builder", requiredTools: ["railway.deploy"], isReviewStep: false, needsApproval: false, estimatedCredits: 2 },
    ],
    suggestedAgentRoles: { primary: "reviewer", secondary: "qa", deploy: "builder" },
    requiredTools: ["github.getFile", "railway.deploy"],
    estimatedCostLevel: "medium",
    approvalCheckpoints: [
      { afterStep: 2, reason: "Security gate — must pass before load test", blocking: true },
      { afterStep: 5, reason: "Owner final approval before production traffic is live", blocking: true },
    ],
    expectedReportOutput: ["readiness_score", "security_findings", "performance_results", "smoke_test_results", "launch_confirmation"],
  };
}

// ─── Classifier ───────────────────────────────────────────────────────────────

export function classifyRequest(goal: string): WorkflowFamily {
  const scores = new Map<WorkflowFamily, number>();

  for (const signal of FAMILY_SIGNALS) {
    const hits = signal.keywords.filter((kw) => kw.test(goal)).length;
    if (hits > 0) {
      scores.set(signal.family, (scores.get(signal.family) ?? 0) + hits * signal.weight);
    }
  }

  if (scores.size === 0) return "unknown";

  let best: WorkflowFamily = "unknown";
  let bestScore = 0;
  for (const [family, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      best = family;
    }
  }
  return best;
}

function deriveComplexity(tasks: PlannedTask[]): AdaptivePlan["complexity"] {
  if (tasks.length <= 4) return "simple";
  if (tasks.length <= 5) return "moderate";
  return "complex";
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Classify a user goal and return a structured, ordered workflow plan.
 */
export function buildAdaptivePlan(goal: string): AdaptivePlan {
  const family = classifyRequest(goal);

  let base: Omit<AdaptivePlan, "complexity" | "summary">;

  switch (family) {
    case "project_doctor":    base = projectDoctorPlan(goal); break;
    case "code_repair":       base = codeRepairPlan(goal); break;
    case "new_build_planning":base = newBuildPlan(goal); break;
    case "research_report":   base = researchReportPlan(goal); break;
    case "business_planning": base = businessPlanningPlan(goal); break;
    case "deployment_review": base = deploymentReviewPlan(goal); break;
    case "ui_ux_review":      base = uiUxReviewPlan(goal); break;
    case "launch_readiness":  base = launchReadinessPlan(goal); break;
    default:
      base = {
        workflowFamily: "unknown",
        tasks: [
          { index: 1, title: "Clarify Goal", type: "planning", description: `Understand and scope: ${goal}`, suggestedRole: "strategist", requiredTools: [], isReviewStep: false, needsApproval: false, estimatedCredits: 1 },
          { index: 2, title: "Produce Plan", type: "planning", description: "Draft ordered tasks based on clarified goal", suggestedRole: "strategist", requiredTools: [], isReviewStep: true, needsApproval: true, estimatedCredits: 1 },
        ],
        suggestedAgentRoles: { primary: "strategist" },
        requiredTools: [],
        estimatedCostLevel: "low",
        approvalCheckpoints: [{ afterStep: 2, reason: "Owner confirms plan before execution begins", blocking: true }],
        expectedReportOutput: ["goal_clarification", "proposed_plan"],
      };
  }

  const complexity = deriveComplexity(base.tasks);
  const approvalCount = base.approvalCheckpoints.length;
  const summary = `${family.replace(/_/g, " ")} — ${base.tasks.length} tasks, ${complexity} complexity, ${base.estimatedCostLevel} cost, ${approvalCount} approval checkpoint${approvalCount !== 1 ? "s" : ""}.`;

  return { ...base, complexity, summary };
}
