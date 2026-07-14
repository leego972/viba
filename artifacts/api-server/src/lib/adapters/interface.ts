export interface AgentTaskInput {
  systemRole: string;
  projectGoal: string;
  memorySummary: string;
  taskInstruction: string;
  previousMessages: Array<{ role: string; content: string; agentName?: string }>;
  taskType?: string;
  /**
   * Other agents participating in this session — used by adapters to address
   * outbound questions to real peer names rather than generic placeholders.
   */
  peerAgents?: Array<{ name: string; role: string }>;
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
  /**
   * Called by tool-capable adapters (Replit, Manus) on each poll cycle during
   * long-running task execution, so the agent loop can emit live "running"
   * audit events and show progress in the session feed.
   */
  onPollCycle?: (info: {
    attempt: number;
    maxAttempts: number;
    status: string;
    elapsedMs: number;
  }) => void;
}

/**
 * A single structured output from a tool-capable agent execution.
 * Persisted in message metadata and surfaced in the session feed.
 */
export interface ToolOutput {
  /** Category of the output for UI rendering. */
  type: "file_diff" | "test_result" | "deployment_url" | "command_output" | "git_operation" | "build_log";
  /** Short human-readable title (e.g. "Ran tests", "Modified src/index.ts"). */
  title: string;
  /** Full content: diff text, log lines, URL, etc. */
  content: string;
  /** Extra provider-specific data (e.g. exit code, commit SHA, pass/fail counts). */
  metadata?: Record<string, unknown>;
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
  /**
   * Structured outputs from real tool execution (file diffs, test results,
   * deployment URLs, build logs). Populated by tool-capable adapters when
   * REPLIT_AGENT_URL / MANUS_WORKSPACE_API_KEY are configured and repoUrl is set.
   * Persisted in message metadata for display in the session feed.
   */
  toolOutputs?: ToolOutput[];
  /**
   * A single VIBA broker tool call declared by a text agent with canUseTools=true.
   * The agent loop executes this via the tool broker, injects the result into the
   * conversation, and re-runs the agent (up to MAX_BROKER_LOOPS per task step).
   * Only used by OpenAI / Anthropic / Gemini / Perplexity adapters in broker mode.
   * Native executors (Replit, Manus, Railway) handle their own tool loops.
   */
  toolCall?: {
    toolId: string;
    action: string;
    payload?: Record<string, unknown>;
  };
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
  /**
   * Safety vote — called before task execution begins.
   * Each adapter evaluates the project goal against its own guidelines.
   * Returns { accepted: true } to participate or { accepted: false, reason } to sit out.
   * Agents that sit out are excluded from task assignment for this session.
   */
  evaluateTask(goal: string, peers: Array<{ name: string; role: string }>): Promise<{ accepted: boolean; reason?: string }>;
}
