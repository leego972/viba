export type AgentStatus =
  | "idle"
  | "queued"
  | "working"
  | "waiting"
  | "reviewing"
  | "complete"
  | "failed"
  | "paused";

export type CoordinatorPhase =
  | "idle"
  | "planning"
  | "delegating"
  | "reviewing"
  | "waiting_approval"
  | "synthesising"
  | "complete"
  | "error";

export interface OrchestrationAgent {
  id: string;
  name: string;
  provider: string;
  role: string;
  status: AgentStatus;
  taskSummary?: string;
  cost?: number;
  latencyMs?: number;
  confidence?: number;
  color: string;
  accentColor: string;
}

export interface OrchestrationEvent {
  id: string;
  timestamp: Date;
  agentName: string;
  agentColor: string;
  action: string;
  detail?: string;
  type: "info" | "success" | "warning" | "error" | "approval";
  costDelta?: number;
}

export interface OrchestrationViewModel {
  sessionId?: number;
  sessionName?: string;
  phase: CoordinatorPhase;
  agents: OrchestrationAgent[];
  events: OrchestrationEvent[];
  totalCost: number;
  estimatedPremiumCost: number;
  elapsedMs: number;
  progress: number;
  isDemo: boolean;
}

export const AGENT_ROLE_COLORS: Record<string, { color: string; accent: string }> = {
  planner:    { color: "#6366f1", accent: "rgba(99,102,241,0.15)" },
  researcher: { color: "#06b6d4", accent: "rgba(6,182,212,0.15)" },
  coder:      { color: "#10b981", accent: "rgba(16,185,129,0.15)" },
  reviewer:   { color: "#f59e0b", accent: "rgba(245,158,11,0.15)" },
  tester:     { color: "#8b5cf6", accent: "rgba(139,92,246,0.15)" },
  security:   { color: "#ef4444", accent: "rgba(239,68,68,0.15)" },
  optimizer:  { color: "#22d3ee", accent: "rgba(34,211,238,0.15)" },
  synthesiser:{ color: "#a78bfa", accent: "rgba(167,139,250,0.15)" },
  default:    { color: "#60a5fa", accent: "rgba(96,165,250,0.15)" },
};

export const STATUS_COLORS: Record<AgentStatus, string> = {
  idle:      "rgba(255,255,255,0.15)",
  queued:    "#60a5fa",
  working:   "#10b981",
  waiting:   "#f59e0b",
  reviewing: "#8b5cf6",
  complete:  "#22c55e",
  failed:    "#ef4444",
  paused:    "#6b7280",
};

export const PHASE_LABELS: Record<CoordinatorPhase, string> = {
  idle:             "Idle",
  planning:         "Planning",
  delegating:       "Delegating",
  reviewing:        "Reviewing",
  waiting_approval: "Awaiting Approval",
  synthesising:     "Synthesising",
  complete:         "Complete",
  error:            "Error",
};

/**
 * Empty state used before a real session has agents. It intentionally contains
 * no invented providers, tasks, cost, latency, confidence, or performance data.
 */
export function buildDemoViewModel(): OrchestrationViewModel {
  return {
    sessionName: "No orchestration data yet",
    phase: "idle",
    agents: [],
    events: [],
    totalCost: 0,
    estimatedPremiumCost: 0,
    elapsedMs: 0,
    progress: 0,
    isDemo: false,
  };
}
