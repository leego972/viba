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

export function buildDemoViewModel(): OrchestrationViewModel {
  const agents: OrchestrationAgent[] = [
    { id: "a1", name: "Claude", provider: "anthropic", role: "Planner",    status: "complete", color: "#6366f1", accentColor: "rgba(99,102,241,0.15)", cost: 0.04, latencyMs: 1820, confidence: 0.94, taskSummary: "Decomposed goal into 5 sub-tasks" },
    { id: "a2", name: "GPT-4o", provider: "openai",    role: "Coder",      status: "working",  color: "#10b981", accentColor: "rgba(16,185,129,0.15)", cost: 0.12, latencyMs: 2200, confidence: 0.88, taskSummary: "Writing implementation…" },
    { id: "a3", name: "Groq",   provider: "groq",      role: "Reviewer",   status: "waiting",  color: "#f59e0b", accentColor: "rgba(245,158,11,0.15)",  cost: 0.01, latencyMs:  490, confidence: 0.91, taskSummary: "Awaiting code from Coder" },
    { id: "a4", name: "Gemini", provider: "gemini",    role: "Researcher",  status: "complete", color: "#06b6d4", accentColor: "rgba(6,182,212,0.15)",   cost: 0.03, latencyMs: 1100, confidence: 0.89, taskSummary: "Found 3 relevant references" },
    { id: "a5", name: "Groq",   provider: "groq",      role: "Tester",      status: "queued",   color: "#8b5cf6", accentColor: "rgba(139,92,246,0.15)",  cost: 0,    latencyMs: 0,    confidence: undefined, taskSummary: "In queue" },
  ];

  const now = new Date();
  const events: OrchestrationEvent[] = [
    { id: "e1", timestamp: new Date(now.getTime() - 82000), agentName: "VIBA",   agentColor: "#a78bfa", action: "Task analysed and decomposed",        type: "info" },
    { id: "e2", timestamp: new Date(now.getTime() - 79000), agentName: "Claude", agentColor: "#6366f1", action: "Planning phase started",              type: "info" },
    { id: "e3", timestamp: new Date(now.getTime() - 71000), agentName: "Gemini", agentColor: "#06b6d4", action: "Research phase started",              type: "info" },
    { id: "e4", timestamp: new Date(now.getTime() - 60000), agentName: "Claude", agentColor: "#6366f1", action: "Plan produced — 5 tasks",             type: "success" },
    { id: "e5", timestamp: new Date(now.getTime() - 58000), agentName: "Gemini", agentColor: "#06b6d4", action: "Research complete — 3 refs found",    type: "success" },
    { id: "e6", timestamp: new Date(now.getTime() - 51000), agentName: "GPT-4o", agentColor: "#10b981", action: "Code generation started",             type: "info" },
    { id: "e7", timestamp: new Date(now.getTime() - 20000), agentName: "VIBA",   agentColor: "#a78bfa", action: "Groq selected as reviewer (2× cheaper)", type: "success", costDelta: -0.14 },
  ];

  return {
    sessionName: "Demo — API Integration Project",
    phase: "delegating",
    agents,
    events,
    totalCost: 0.20,
    estimatedPremiumCost: 1.43,
    elapsedMs: 82000,
    progress: 42,
    isDemo: true,
  };
}
