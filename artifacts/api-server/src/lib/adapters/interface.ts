export interface AgentTaskInput {
  systemRole: string;
  projectGoal: string;
  memorySummary: string;
  taskInstruction: string;
  previousMessages: Array<{ role: string; content: string; agentName?: string }>;
  taskType?: string;
}

export interface AgentTaskResult {
  messageText: string;
  suggestedNextTasks: string[];
  completionStatus: "in_progress" | "complete" | "needs_review" | "approval_required";
  confidence: number;
  estimatedCost: number;
}

export interface AgentAdapter {
  id: string;
  name: string;
  provider: string;
  capabilities: string[];
  role: string;
  isMock: boolean;
  runTask(input: AgentTaskInput): Promise<AgentTaskResult>;
}
