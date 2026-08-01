import type { Agent, Task } from "@workspace/db";

interface TaskTypeConfig {
  capabilities: string[];
  requiresTools?: boolean;
  minimumQuality?: number;
}

const TASK_TYPE_CONFIG: Record<string, TaskTypeConfig> = {
  planning:            { capabilities: ["planning", "strategy", "reasoning"], minimumQuality: 0.68 },
  research:            { capabilities: ["research", "research_summary", "data_gathering", "fact_checking"], minimumQuality: 0.62 },
  creative_direction:  { capabilities: ["creative_direction", "creative", "summarization"], minimumQuality: 0.68 },
  copywriting:         { capabilities: ["writing", "creative", "creative_direction"], minimumQuality: 0.65 },
  build:               { capabilities: ["build", "code", "implementation", "deployment"], requiresTools: true, minimumQuality: 0.78 },
  code_review:         { capabilities: ["code_review", "logic_critique", "writing"], minimumQuality: 0.80 },
  ux_review:           { capabilities: ["ux_review", "multimodal", "contextual_analysis"], minimumQuality: 0.72 },
  final_qa:            { capabilities: ["final_qa", "planning", "reasoning", "code_review"], minimumQuality: 0.85 },
  deployment_approval: { capabilities: ["deployment", "planning", "build"], requiresTools: true, minimumQuality: 0.82 },
};

const ROLE_TASK_AFFINITY: Record<string, string[]> = {
  strategist:          ["planning", "creative_direction", "final_qa"],
  "creative director": ["creative_direction", "copywriting"],
  researcher:          ["research", "ux_review"],
  builder:             ["build", "deployment_approval"],
  reviewer:            ["code_review", "ux_review", "final_qa"],
  "code reviewer":     ["code_review", "ux_review"],
  "ux reviewer":       ["ux_review"],
  "final qa":          ["final_qa", "deployment_approval"],
  qa:                  ["final_qa", "code_review"],
};

/**
 * Blended provider value profiles used by the synchronous task router.
 * costIndex is relative, not a billed amount: 1 is cheapest. These defaults
 * are deliberately conservative and are overridden operationally by the
 * model registry / provider pricing administration layer.
 */
const PROVIDER_VALUE_PROFILE: Record<string, { quality: number; costIndex: number; reliability: number }> = {
  ollama:     { quality: 0.62, costIndex: 0.05, reliability: 0.82 },
  groq:       { quality: 0.74, costIndex: 0.35, reliability: 0.90 },
  google:     { quality: 0.82, costIndex: 0.75, reliability: 0.91 },
  gemini:     { quality: 0.82, costIndex: 0.75, reliability: 0.91 },
  deepseek:   { quality: 0.79, costIndex: 0.60, reliability: 0.86 },
  mistral:    { quality: 0.78, costIndex: 0.70, reliability: 0.88 },
  perplexity: { quality: 0.80, costIndex: 1.00, reliability: 0.90 },
  openai:     { quality: 0.90, costIndex: 2.20, reliability: 0.94 },
  anthropic:  { quality: 0.93, costIndex: 2.80, reliability: 0.94 },
  venice:     { quality: 0.72, costIndex: 0.90, reliability: 0.82 },
  railway:    { quality: 0.86, costIndex: 1.10, reliability: 0.90 },
  custom:     { quality: 0.70, costIndex: 1.00, reliability: 0.75 },
};

export interface RoutingDecision {
  agent: Agent | null;
  score: number;
  qualityFloor: number;
  estimatedRelativeCost: number | null;
  reason: string;
}

function profileFor(agent: Agent) {
  return PROVIDER_VALUE_PROFILE[agent.provider.toLowerCase()] ?? PROVIDER_VALUE_PROFILE.custom!;
}

function scoreAgents(task: Task, agents: Agent[]): Array<{
  agent: Agent;
  score: number;
  quality: number;
  costIndex: number;
  reason: string;
}> {
  const config = TASK_TYPE_CONFIG[task.type] ?? { capabilities: [], minimumQuality: 0.65 };
  const requiredCapabilities = config.capabilities;
  const minimumQuality = config.minimumQuality ?? 0.65;

  return agents.map((agent) => {
    let capabilityScore = 0;
    const agentCaps = agent.capabilities ?? [];
    const role = (agent.role ?? "").toLowerCase();
    const profile = profileFor(agent);

    for (const capability of requiredCapabilities) {
      if (agentCaps.includes(capability)) capabilityScore += 2;
    }

    const roleAffinity = ROLE_TASK_AFFINITY[role] ?? [];
    const roleScore = roleAffinity.includes(task.type) ? 3 : 0;
    const toolsNeeded = config.requiresTools === true || (task.toolRequirements ?? []).length > 0;
    const toolScore = toolsNeeded && agent.canUseTools ? 6 : toolsNeeded ? -30 : 0;
    const qualityPenalty = profile.quality < minimumQuality
      ? -Math.round((minimumQuality - profile.quality) * 100)
      : 0;

    // Quality and reliability dominate. Cost breaks ties among candidates that
    // clear the quality floor, preventing cheap-but-inadequate routing.
    const qualityScore = Math.round(profile.quality * 20);
    const reliabilityScore = Math.round(profile.reliability * 10);
    const costPenalty = Math.log2(1 + Math.max(0, profile.costIndex)) * 4;
    const score = capabilityScore + roleScore + toolScore + qualityScore + reliabilityScore + qualityPenalty - costPenalty;

    return {
      agent,
      score,
      quality: profile.quality,
      costIndex: profile.costIndex,
      reason: `capability=${capabilityScore}, role=${roleScore}, tools=${toolScore}, quality=${profile.quality.toFixed(2)}, reliability=${profile.reliability.toFixed(2)}, relativeCost=${profile.costIndex.toFixed(2)}, qualityPenalty=${qualityPenalty}`,
    };
  });
}

export function routeTaskWithDecision(task: Task, agents: Agent[]): RoutingDecision {
  if (!agents.length) {
    return { agent: null, score: 0, qualityFloor: 0, estimatedRelativeCost: null, reason: "No active agents are available." };
  }

  const config = TASK_TYPE_CONFIG[task.type] ?? { capabilities: [], minimumQuality: 0.65 };
  const needsTools = config.requiresTools === true || (task.toolRequirements ?? []).length > 0;
  const eligible = needsTools && agents.some((a) => a.canUseTools)
    ? agents.filter((a) => a.canUseTools)
    : agents;

  const scored = scoreAgents(task, eligible).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.costIndex !== b.costIndex) return a.costIndex - b.costIndex;
    return a.agent.id - b.agent.id;
  });

  const selected = scored[0];
  if (!selected) {
    return { agent: null, score: 0, qualityFloor: config.minimumQuality ?? 0.65, estimatedRelativeCost: null, reason: "No eligible agent cleared routing." };
  }

  return {
    agent: selected.agent,
    score: selected.score,
    qualityFloor: config.minimumQuality ?? 0.65,
    estimatedRelativeCost: selected.costIndex,
    reason: `Selected ${selected.agent.name} (${selected.agent.provider}) using quality-adjusted cost routing: ${selected.reason}`,
  };
}

export function routeTask(task: Task, agents: Agent[]): Agent | null {
  return routeTaskWithDecision(task, agents).agent;
}

function isRepositoryProductionAudit(projectGoal: string): boolean {
  const goal = projectGoal.toLowerCase();
  return goal.includes("repository") && (
    goal.includes("production blocker") ||
    goal.includes("release-readiness") ||
    goal.includes("render deployment readiness") ||
    goal.includes("exact file references")
  );
}

export function determineTaskSequence(projectGoal: string): Array<{ title: string; type: string; description: string }> {
  if (isRepositoryProductionAudit(projectGoal)) {
    return [
      { title: "Repository Discovery & Execution Plan", type: "planning", description: `Inspect the connected repository and branch. Identify the framework, package manager, build commands, test commands, deployment configuration, and high-risk areas. Produce an evidence-based audit plan for: ${projectGoal}` },
      { title: "Build, Typecheck & Dependency Validation", type: "build", description: `Use repository tools where available. Inspect package scripts and dependency manifests, then run or verify install, build, typecheck, lint, and tests. Record exact commands, outputs, affected files, and blockers for: ${projectGoal}` },
      { title: "Application Integration & Security Review", type: "code_review", description: `Review real repository files for broken imports, routes, frontend/API mismatches, authentication defects, unsafe environment handling, exposed secrets, authorization gaps, and other production risks. Every finding must include severity and exact file references. Objective: ${projectGoal}` },
      { title: "Mobile UI & Runtime Readiness", type: "ux_review", description: `Inspect responsive layouts, mobile navigation, form behaviour, loading/error states, accessibility-critical failures, and browser/runtime risks. Cite exact components or files and distinguish verified evidence from recommendations. Objective: ${projectGoal}` },
      { title: "Render Deployment Readiness", type: "deployment_approval", description: `Inspect Render-related deployment configuration, start/build commands, ports, health checks, environment requirements, database migrations, domains, and rollback risks. Do not deploy or modify production without explicit approval. Objective: ${projectGoal}` },
      { title: "Consolidated Release Decision", type: "final_qa", description: `Consolidate all verified evidence into one report: executive verdict, critical blockers, high-risk findings, functional defects, validation evidence, repairs completed, remaining actions, and final release recommendation. Do not present simulated or unverified claims as live evidence. Objective: ${projectGoal}` },
    ];
  }

  return [
    { title: "Project Planning", type: "planning", description: `Create a structured plan for: ${projectGoal}` },
    { title: "Research & Analysis", type: "research", description: `Research the domain and gather relevant context for: ${projectGoal}` },
    { title: "Creative Direction", type: "creative_direction", description: `Establish the creative and strategic direction for: ${projectGoal}` },
    { title: "Build & Implement", type: "build", description: `Implement the core deliverable for: ${projectGoal}` },
    { title: "Code & Quality Review", type: "code_review", description: `Review and validate the output for: ${projectGoal}` },
    { title: "Final QA", type: "final_qa", description: `Final quality assurance and sign-off for: ${projectGoal}` },
  ];
}

export function autoAssignRoles(agentProviders: string[]): Record<string, string> {
  const roleQueue = ["strategist", "researcher", "builder", "reviewer", "qa"];
  const providerRoleHints: Record<string, string> = {
    openai: "strategist",
    anthropic: "reviewer",
    deepseek: "researcher",
    mistral: "builder",
    google: "reviewer",
    perplexity: "researcher",
    groq: "builder",
    ollama: "researcher",
    railway: "builder",
  };

  const assignments: Record<string, string> = {};
  const usedRoles = new Set<string>();
  for (const provider of agentProviders) {
    const hint = providerRoleHints[provider.toLowerCase()] ?? roleQueue[0]!;
    if (!usedRoles.has(hint)) {
      assignments[provider] = hint;
      usedRoles.add(hint);
    } else {
      const next = roleQueue.find((role) => !usedRoles.has(role));
      assignments[provider] = next ?? "qa";
      if (next) usedRoles.add(next);
    }
  }
  return assignments;
}
