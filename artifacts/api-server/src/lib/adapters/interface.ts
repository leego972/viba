export interface AgentTaskInput {
  systemRole: string;
  projectGoal: string;
  memorySummary: string;
  taskInstruction: string;
  previousMessages: Array<{ role: string; content: string; agentName?: string }>;
  taskType?: string;
  /** Whether this adapter can use tools (execute code, run git, call APIs, etc.). Defaults to false. */
  canUseTools?: boolean;
  /** Git repo URL the tool-capable agent should act on. */
  repoUrl?: string;
  /** Target branch (default: main). */
  repoBranch?: string;
  /** Environment label: development | staging | production */
  workspaceEnv?: string;
  /**
   * Task-scoped questions from other agents that this agent must answer
   * before running its own task. Strictly about the current task only.
   */
  pendingQuestions?: Array<{ fromAgent: string; question: string; messageId: number }>;
}

export interface AgentTaskResult {
  messageText: string;
  suggestedNextTasks: string[];
  completionStatus: "in_progress" | "complete" | "needs_review" | "approval_required";
  confidence: number;
  estimatedCost: number;
  /**
   * If set, the agent could not complete the task due to a tool requirement.
   * The engine will create a sibling task and re-route to a tool-capable agent.
   * Only valid when the adapter's canUseTools is false.
   */
  blockedReason?: string;
  /** Work the agent completed before hitting the tool blocker. */
  partialWork?: string;
  /** Tool names needed to unblock this task (e.g. "git_clone", "run_tests"). */
  toolRequirements?: string[];
  /**
   * Questions this agent wants to ask other agents — strictly task-scoped.
   * Each will be saved as a "question" message and routed to the named agent.
   * Capped at 3 per step to prevent runaway chatter.
   */
  outboundQuestions?: Array<{ toAgentName: string; question: string }>;
  /**
   * Answers to pendingQuestions injected at the start of this step.
   * Each answer is saved as an "answer" message linking back to the question.
   */
  answersToQuestions?: Array<{ messageId: number; answer: string }>;
}

export interface AgentAdapter {
  id: string;
  name: string;
  provider: string;
  model: string;
  capabilities: string[];
  role: string;
  isMock: boolean;
  /** True for Replit and Manus — can execute tools, clone repos, run code, etc. */
  canUseTools: boolean;
  runTask(input: AgentTaskInput): Promise<AgentTaskResult>;
}
