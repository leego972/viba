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

/** role affinity — normalised to lowercase to match DB values */
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

const LOW_COST_PROVIDER_BONUS: Record<string, number> = {
  groq: 4,
  ollama: 3,
  perplexity: 1,
};

const EXPENSIVE_PROVIDER_PENALTY: Record<string, number> = {
  openai: 0,
  anthropic: 0,
};

interface RoutableTask {
  id?: number;
  type: string;
  toolRequirements?: string[] | null;
}

function scoreAgents(
  task: RoutableTask,
  agents: Agent[],
): Array<{ agent: Agent; score: number }> {
  const config = TASK_TYPE_CONFIG[task.type] ?? { capabilities: [] };
  const requiredCapabilities = config.capabilities;

  return agents.map((agent) => {
    let score = 0;
    const agentCaps = agent.capabilities ?? [];
    const agentRole = (agent.role ?? "").toLowerCase();
    const provider = agent.provider.toLowerCase();

    for (const cap of requiredCapabilities) {
      if (agentCaps.includes(cap)) score += 2;
    }

    const roleAffinity = ROLE_TASK_AFFINITY[agentRole] ?? [];
    if (roleAffinity.includes(task.type)) score += 3;

    if (config.requiresTools && agent.canUseTools) score += 5;

    const taskToolReqs = task.toolRequirements ?? [];
    if (taskToolReqs.length > 0 && agent.canUseTools) score += 4;

    if (!config.requiresTools && taskToolReqs.length === 0) {
      score += LOW_COST_PROVIDER_BONUS[provider] ?? 0;
      score -= EXPENSIVE_PROVIDER_PENALTY[provider] ?? 0;
    }

    if (provider === "groq" && ["planning", "research", "code_review", "build"].includes(task.type)) {
      score += 2;
    }

    return { agent, score };
  });
}

export function routeTask(task: RoutableTask, agents: Agent[]): Agent | null {
  if (!agents.length) return null;

  const config = TASK_TYPE_CONFIG[task.type] ?? { capabilities: [] };
  const taskToolReqs = task.toolRequirements ?? [];
  const needsTools = config.requiresTools === true || taskToolReqs.length > 0;

  if (needsTools) {
    const toolCapableAgents = agents.filter((a) => a.canUseTools);
    if (toolCapableAgents.length > 0) {
      const scored = scoreAgents(task, toolCapableAgents);
      scored.sort((a, b) => b.score - a.score);
      return scored[0]?.agent ?? toolCapableAgents[0] ?? null;
    }
  }

  const scored = scoreAgents(task, agents);
  scored.sort((a, b) => b.score - a.score);

  const topScore = scored[0]?.score ?? 0;
  if (topScore === 0) {
    const groqAgent = agents.find((a) => a.provider.toLowerCase() === "groq");
    if (groqAgent) return groqAgent;
    const idx = (task.id ?? 0) % agents.length;
    return agents[idx] ?? agents[0] ?? null;
  }

  return scored[0]?.agent ?? agents[0] ?? null;
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
    groq:       "builder",
    openai:     "strategist",
    anthropic:  "reviewer",
    manus:      "researcher",
    replit:     "builder",
    google:     "reviewer",
    perplexity: "researcher",
    ollama:     "builder",
  };

  const assignments: Record<string, string> = {};
  const usedRoles = new Set<string>();

  for (const provider of agentProviders) {
    const hint = providerRoleHints[provider.toLowerCase()] ?? roleQueue[0];
    if (hint && !usedRoles.has(hint)) {
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
