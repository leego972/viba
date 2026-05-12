import type { Agent, Task } from "@workspace/db";

const TASK_TYPE_CAPABILITY_MAP: Record<string, string[]> = {
  planning: ["planning", "strategy", "reasoning"],
  research: ["research", "research_summary", "data_gathering", "fact_checking"],
  creative_direction: ["creative_direction", "creative", "summarization"],
  copywriting: ["writing", "creative", "creative_direction"],
  build: ["build", "code", "implementation", "deployment"],
  code_review: ["code_review", "logic_critique", "writing"],
  ux_review: ["ux_review", "multimodal", "contextual_analysis"],
  final_qa: ["final_qa", "planning", "reasoning", "code_review"],
  deployment_approval: ["deployment", "planning", "build"],
};

/** role affinity — normalised to lowercase to match DB values */
const ROLE_TASK_AFFINITY: Record<string, string[]> = {
  strategist: ["planning", "creative_direction", "final_qa"],
  "creative director": ["creative_direction", "copywriting"],
  researcher: ["research", "ux_review"],
  builder: ["build", "deployment_approval"],
  reviewer: ["code_review", "ux_review", "final_qa"],
  "code reviewer": ["code_review", "ux_review"],
  "ux reviewer": ["ux_review"],
  "final qa": ["final_qa", "deployment_approval"],
  qa: ["final_qa", "code_review"],
};

export function routeTask(task: Task, agents: Agent[]): Agent | null {
  if (!agents.length) return null;

  const taskType = task.type;
  const requiredCapabilities = TASK_TYPE_CAPABILITY_MAP[taskType] ?? [];

  const scored = agents.map((agent) => {
    let score = 0;
    const agentCaps = agent.capabilities ?? [];
    const agentRole = (agent.role ?? "").toLowerCase();

    // Capability match (+2 per hit)
    for (const cap of requiredCapabilities) {
      if (agentCaps.includes(cap)) score += 2;
    }

    // Role affinity (+3 if this role owns this task type) — normalised lowercase
    const roleAffinity = ROLE_TASK_AFFINITY[agentRole] ?? [];
    if (roleAffinity.includes(taskType)) score += 3;

    return { agent, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // If no one has a capability match, assign by round-robin on task id
  // so different task indices go to different agents
  const topScore = scored[0]?.score ?? 0;
  if (topScore === 0) {
    const idx = (task.id ?? 0) % agents.length;
    return agents[idx] ?? agents[0];
  }

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
      description: `Final quality assurance and sign-off for: ${projectGoal}`,
    },
  ];
}

export function autoAssignRoles(agentProviders: string[]): Record<string, string> {
  const roleQueue = [
    "strategist",
    "researcher",
    "builder",
    "reviewer",
    "qa",
  ];

  const providerRoleHints: Record<string, string> = {
    openai: "strategist",
    anthropic: "reviewer",
    manus: "researcher",
    replit: "builder",
    google: "reviewer",
    perplexity: "researcher",
  };

  const assignments: Record<string, string> = {};
  const usedRoles = new Set<string>();

  for (const provider of agentProviders) {
    const hint = providerRoleHints[provider.toLowerCase()] ?? roleQueue[0];
    if (!usedRoles.has(hint)) {
      assignments[provider] = hint;
      usedRoles.add(hint);
    } else {
      const next = roleQueue.find((r) => !usedRoles.has(r));
      if (next) {
        assignments[provider] = next;
        usedRoles.add(next);
      } else {
        assignments[provider] = "qa";
      }
    }
  }

  return assignments;
}
