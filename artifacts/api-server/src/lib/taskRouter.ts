import type { Agent, Task } from "@workspace/db";

interface TaskTypeConfig {
  capabilities: string[];
  /** If true, the router will hard-prefer tool-capable agents for this task type. */
  requiresTools?: boolean;
}

const TASK_TYPE_CONFIG: Record<string, TaskTypeConfig> = {
  planning:            { capabilities: ["planning", "strategy", "reasoning"] },
  research:            { capabilities: ["research", "research_summary", "data_gathering", "fact_checking"] },
  creative_direction:  { capabilities: ["creative_direction", "creative", "summarization"] },
  copywriting:         { capabilities: ["writing", "creative", "creative_direction"] },
  build:               { capabilities: ["build", "code", "implementation", "deployment"], requiresTools: true },
  code_review:         { capabilities: ["code_review", "logic_critique", "writing"] },
  ux_review:           { capabilities: ["ux_review", "multimodal", "contextual_analysis"] },
  final_qa:            { capabilities: ["final_qa", "planning", "reasoning", "code_review"] },
  deployment_approval: { capabilities: ["deployment", "planning", "build"], requiresTools: true },
};

const ROLE_TASK_AFFINITY: Record<string, string[]> = {
  strategist:           ["planning", "creative_direction", "final_qa"],
  "creative director":  ["creative_direction", "copywriting"],
  researcher:           ["research", "ux_review"],
  builder:              ["build", "deployment_approval"],
  reviewer:             ["code_review", "ux_review", "final_qa"],
  "code reviewer":      ["code_review", "ux_review"],
  "ux reviewer":        ["ux_review"],
  "final qa":           ["final_qa", "deployment_approval"],
  qa:                   ["final_qa", "code_review"],
};

function scoreAgents(task: Task, agents: Agent[]): Array<{ agent: Agent; score: number }> {
  const config = TASK_TYPE_CONFIG[task.type] ?? { capabilities: [] };
  const requiredCapabilities = config.capabilities;

  return agents.map((agent) => {
    let score = 0;
    const agentCaps = agent.capabilities ?? [];
    const agentRole = (agent.role ?? "").toLowerCase();

    for (const cap of requiredCapabilities) {
      if (agentCaps.includes(cap)) score += 2;
    }

    const roleAffinity = ROLE_TASK_AFFINITY[agentRole] ?? [];
    if (roleAffinity.includes(task.type)) score += 3;
    if (config.requiresTools && agent.canUseTools) score += 5;

    const taskToolReqs = task.toolRequirements ?? [];
    if (taskToolReqs.length > 0 && agent.canUseTools) score += 4;

    return { agent, score };
  });
}

export function routeTask(task: Task, agents: Agent[]): Agent | null {
  if (!agents.length) return null;

  const config = TASK_TYPE_CONFIG[task.type] ?? { capabilities: [] };
  const taskToolReqs = task.toolRequirements ?? [];
  const needsTools = config.requiresTools === true || taskToolReqs.length > 0;

  if (needsTools) {
    const toolCapableAgents = agents.filter((agent) => agent.canUseTools);
    if (toolCapableAgents.length > 0) {
      const scored = scoreAgents(task, toolCapableAgents);
      scored.sort((a, b) => b.score - a.score);
      return scored[0]?.agent ?? toolCapableAgents[0] ?? null;
    }
  }

  const scored = scoreAgents(task, agents);
  scored.sort((a, b) => b.score - a.score);

  if ((scored[0]?.score ?? 0) === 0) {
    const index = (task.id ?? 0) % agents.length;
    return agents[index] ?? agents[0] ?? null;
  }

  return scored[0]?.agent ?? agents[0] ?? null;
}

function isRepositoryProductionAudit(projectGoal: string): boolean {
  const goal = projectGoal.toLowerCase();
  return (
    goal.includes("repository") &&
    (goal.includes("production blocker") ||
      goal.includes("release-readiness") ||
      goal.includes("render deployment readiness") ||
      goal.includes("exact file references"))
  );
}

export function determineTaskSequence(projectGoal: string): Array<{ title: string; type: string; description: string }> {
  if (isRepositoryProductionAudit(projectGoal)) {
    return [
      {
        title: "Repository Discovery & Execution Plan",
        type: "planning",
        description: `Inspect the connected repository and branch. Identify the framework, package manager, build commands, test commands, deployment configuration, and high-risk areas. Produce an evidence-based audit plan for: ${projectGoal}`,
      },
      {
        title: "Build, Typecheck & Dependency Validation",
        type: "build",
        description: `Use repository tools where available. Inspect package scripts and dependency manifests, then run or verify install, build, typecheck, lint, and tests. Record exact commands, outputs, affected files, and blockers for: ${projectGoal}`,
      },
      {
        title: "Application Integration & Security Review",
        type: "code_review",
        description: `Review real repository files for broken imports, routes, frontend/API mismatches, authentication defects, unsafe environment handling, exposed secrets, authorization gaps, and other production risks. Every finding must include severity and exact file references. Objective: ${projectGoal}`,
      },
      {
        title: "Mobile UI & Runtime Readiness",
        type: "ux_review",
        description: `Inspect responsive layouts, mobile navigation, form behaviour, loading/error states, accessibility-critical failures, and browser/runtime risks. Cite exact components or files and distinguish verified evidence from recommendations. Objective: ${projectGoal}`,
      },
      {
        title: "Render Deployment Readiness",
        type: "deployment_approval",
        description: `Inspect Render-related deployment configuration, start/build commands, ports, health checks, environment requirements, database migrations, domains, and rollback risks. Do not deploy or modify production without explicit approval. Objective: ${projectGoal}`,
      },
      {
        title: "Consolidated Release Decision",
        type: "final_qa",
        description: `Consolidate all verified evidence into one report: executive verdict (ready, ready with warnings, or blocked), critical blockers, high-risk findings, functional defects, validation evidence, repairs completed, remaining actions, and final release recommendation. Do not present simulated or unverified claims as live evidence. Objective: ${projectGoal}`,
      },
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
  };

  const assignments: Record<string, string> = {};
  const usedRoles = new Set<string>();

  for (const provider of agentProviders) {
    const hint = providerRoleHints[provider.toLowerCase()] ?? roleQueue[0];
    if (hint && !usedRoles.has(hint)) {
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
