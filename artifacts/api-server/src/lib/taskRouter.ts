import type { Agent, Task } from "@workspace/db";

const TASK_TYPE_CAPABILITY_MAP: Record<string, string[]> = {
  planning: ["planning", "strategy"],
  research: ["research", "research_summary", "data_gathering"],
  creative_direction: ["creative_direction", "creative"],
  copywriting: ["writing", "creative"],
  build: ["build", "code", "implementation"],
  code_review: ["code_review", "logic_critique"],
  ux_review: ["ux_review", "multimodal"],
  final_qa: ["final_qa", "planning"],
  deployment_approval: ["deployment", "planning"],
};

const ROLE_TASK_AFFINITY: Record<string, string[]> = {
  Strategist: ["planning"],
  "Creative Director": ["creative_direction", "copywriting"],
  Researcher: ["research"],
  Builder: ["build", "code_review"],
  "Code Reviewer": ["code_review", "ux_review"],
  "UX Reviewer": ["ux_review"],
  "Final QA": ["final_qa", "deployment_approval"],
};

export function routeTask(task: Task, agents: Agent[]): Agent | null {
  if (!agents.length) return null;

  const taskType = task.type;
  const requiredCapabilities = TASK_TYPE_CAPABILITY_MAP[taskType] ?? [];

  // Score each agent by affinity
  const scored = agents.map((agent) => {
    let score = 0;
    const agentCaps = agent.capabilities ?? [];

    // Capability match
    for (const cap of requiredCapabilities) {
      if (agentCaps.includes(cap)) score += 2;
    }

    // Role affinity
    const roleAffinity = ROLE_TASK_AFFINITY[agent.role] ?? [];
    if (roleAffinity.includes(taskType)) score += 3;

    // Prefer mock agents for non-critical tasks
    if (agent.isMock) score += 1;

    return { agent, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.agent ?? agents[0];
}

export function determineTaskSequence(projectGoal: string): Array<{ title: string; type: string; description: string }> {
  return [
    {
      title: "Project Planning",
      type: "planning",
      description: `Create a structured plan for: ${projectGoal}`,
    },
    {
      title: "Research & Analysis",
      type: "research",
      description: `Research the domain and gather relevant context for: ${projectGoal}`,
    },
    {
      title: "Creative Direction",
      type: "creative_direction",
      description: `Establish the creative and strategic direction for: ${projectGoal}`,
    },
    {
      title: "Build & Implement",
      type: "build",
      description: `Implement the core deliverable for: ${projectGoal}`,
    },
    {
      title: "Code & Quality Review",
      type: "code_review",
      description: `Review and validate the output for: ${projectGoal}`,
    },
    {
      title: "Final QA",
      type: "final_qa",
      description: `Final quality assurance and output validation for: ${projectGoal}`,
    },
  ];
}

export function autoAssignRoles(agentProviders: string[]): Record<string, string> {
  const roleQueue = [
    "Strategist",
    "Researcher",
    "Creative Director",
    "Builder",
    "Code Reviewer",
    "UX Reviewer",
    "Final QA",
  ];

  const providerRoleHints: Record<string, string> = {
    openai: "Strategist",
    anthropic: "Code Reviewer",
    manus: "Researcher",
    replit: "Builder",
    google: "UX Reviewer",
    perplexity: "Researcher",
  };

  const assignments: Record<string, string> = {};
  const usedRoles = new Set<string>();

  for (const provider of agentProviders) {
    const hint = providerRoleHints[provider.toLowerCase()] ?? roleQueue[0];
    if (!usedRoles.has(hint)) {
      assignments[provider] = hint;
      usedRoles.add(hint);
    } else {
      // find next unused role
      const next = roleQueue.find((r) => !usedRoles.has(r));
      if (next) {
        assignments[provider] = next;
        usedRoles.add(next);
      } else {
        assignments[provider] = "Final QA";
      }
    }
  }

  return assignments;
}
