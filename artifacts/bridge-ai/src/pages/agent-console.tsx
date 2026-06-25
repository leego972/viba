import { useState, useEffect, useRef, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, CheckCircle2, XCircle, Clock, ShieldCheck, Users, AlertTriangle,
  ChevronDown, ChevronUp, RefreshCw, Play, StopCircle, Plus, Pause, SkipForward,
  Lock, BarChart3, FileText, ShieldAlert,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ─────────────────────────────────────────────────────────────────

interface PlanStep {
  stepNumber: number;
  title: string;
  description: string;
  assignedAgent: string;
  requiresApproval: boolean;
  safeBuildCheckpoint: boolean;
}

interface TaskPlan {
  summary: string;
  taskType: string;
  requiredAgents: string[];
  requiredCredentials: Array<{ provider: string; kind: string; scope: string }>;
  recommendedBYOK: boolean;
  byokSuggestion: string | null;
  approvalRequired: boolean;
  approvalReasons: string[];
  riskLevel: "low" | "medium" | "high";
  steps: PlanStep[];
  blockers: string[];
  safeBuildRequired: boolean;
  planSource: string;
}

interface TaskData {
  task_id: number;
  status: string;
  risk_level: string;
  needs_user_approval: boolean;
  safe_build_required: boolean;
  safe_build_passed: boolean | null;
  plan: TaskPlan | null;
  approved_at: string | null;
}

interface AgentMessage {
  id: number;
  task_id: number;
  from_agent: string;
  to_agent: string | null;
  message_type: string;
  message: string;
  metadata_redacted: Record<string, unknown>;
  created_at: string;
}

interface CustomAi { provider: string; name: string; status: string; }

interface RuntimeStep {
  id: number;
  step_index: number;
  agent_name: string;
  title: string;
  description: string;
  status: string;
  risk_level: string;
  tool_id: string | null;
  requires_approval: boolean;
  approval_status: string;
  requires_credential: boolean;
  credential_provider: string | null;
  credential_kind: string | null;
  requires_safe_build: boolean;
  started_at: string | null;
  completed_at: string | null;
  blocked_reason: string | null;
  rawValuesReturned: false;
}

interface RuntimeStatus {
  run: {
    id: number; status: string; riskLevel: string; safeBuildRequired: boolean;
    safeBuildStatus: string; startedAt: string | null; failureReason: string | null;
    rawValuesReturned: false;
  } | null;
  steps: RuntimeStep[];
  blockers: string[];
  pendingApprovals: RuntimeStep[];
  pendingCredentials: RuntimeStep[];
  rawValuesReturned: false;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function RiskBadge({ level }: { level: string }) {
  if (level === "high" || level === "destructive") return <Badge variant="destructive" className="text-xs gap-1"><AlertTriangle className="h-3 w-3" />High risk</Badge>;
  if (level === "medium") return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs">Medium risk</Badge>;
  return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs">Low risk</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; icon: React.ElementType }> = {
    created: { color: "text-zinc-400", icon: Clock },
    planning: { color: "text-blue-400", icon: RefreshCw },
    ready: { color: "text-blue-400", icon: Play },
    awaiting_user_approval: { color: "text-amber-400", icon: AlertTriangle },
    running: { color: "text-primary", icon: Zap },
    waiting_for_user_approval: { color: "text-amber-400", icon: ShieldAlert },
    waiting_for_credential: { color: "text-orange-400", icon: Lock },
    waiting_for_safe_build: { color: "text-purple-400", icon: ShieldCheck },
    waiting_for_browser_authorization: { color: "text-orange-400", icon: AlertTriangle },
    blocked: { color: "text-red-400", icon: XCircle },
    ready_for_owner_review: { color: "text-emerald-400", icon: CheckCircle2 },
    completed: { color: "text-emerald-400", icon: CheckCircle2 },
    cancelled: { color: "text-zinc-500", icon: StopCircle },
    failed: { color: "text-red-400", icon: XCircle },
  };
  const { color, icon: Icon } = map[status] ?? { color: "text-zinc-400", icon: Clock };
  return <span className={`flex items-center gap-1 text-xs font-medium ${color}`}><Icon className="h-3.5 w-3.5" />{status.replace(/_/g, " ")}</span>;
}

function AgentChip({ agent }: { agent: string }) {
  const colors: Record<string, string> = {
    coordinator: "bg-primary/15 text-primary border-primary/30",
    builder: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    security: "bg-red-500/15 text-red-400 border-red-500/30",
    payments: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    deployment: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    tester: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    research: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    reviewer: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
    browser_operator: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    build: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${colors[agent] ?? "bg-zinc-800 text-zinc-400 border-zinc-700"}`}>
      {agent.replace(/_/g, " ")}
    </span>
  );
}

function StepStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed": return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
    case "running":   return <RefreshCw className="h-4 w-4 text-primary animate-spin shrink-0" />;
    case "waiting":   return <Clock className="h-4 w-4 text-amber-400 shrink-0" />;
    case "blocked":
    case "failed":    return <XCircle className="h-4 w-4 text-red-400 shrink-0" />;
    case "skipped":   return <SkipForward className="h-4 w-4 text-zinc-500 shrink-0" />;
    default:          return <Clock className="h-4 w-4 text-zinc-600 shrink-0" />;
  }
}

function MessageBubble({ msg }: { msg: AgentMessage }) {
  const typeColors: Record<string, string> = {
    plan: "text-blue-400", question: "text-amber-400", warning: "text-red-400",
    approval_required: "text-red-400", tool_result: "text-cyan-400",
    build_result: "text-purple-400", security_result: "text-red-400",
    deployment_result: "text-emerald-400", final_report: "text-primary",
    runtime_status: "text-zinc-400", step_started: "text-blue-300",
    step_completed: "text-emerald-300", step_blocked: "text-red-300",
    credential_required: "text-orange-400", safe_build_result: "text-purple-400",
    answer: "text-zinc-300",
  };
  return (
    <div className="flex gap-3 py-2.5 border-b border-zinc-800/50 last:border-b-0">
      <div className="shrink-0 mt-0.5"><AgentChip agent={msg.from_agent} /></div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          {msg.to_agent && <span>→ <span className="text-zinc-400">{msg.to_agent.replace(/_/g, " ")}</span></span>}
          <span className={typeColors[msg.message_type] ?? "text-zinc-500"}>{msg.message_type.replace(/_/g, " ")}</span>
          <span className="ml-auto">{fmtTime(msg.created_at)}</span>
        </div>
        <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">{msg.message}</p>
      </div>
    </div>
  );
}

// ─── Plan Panel ─────────────────────────────────────────────────────────────

function PlanPanel({ plan, taskId, status, onApprove, onCancel, approving }: {
  plan: TaskPlan; taskId: number; status: string;
  onApprove: () => void; onCancel: () => void; approving: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <Card className="border-zinc-800">
      <CardHeader className="py-3 px-4 cursor-pointer select-none flex flex-row items-center justify-between gap-2" onClick={() => setExpanded((v) => !v)}>
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" /> Task Plan
          <RiskBadge level={plan.riskLevel} />
          {plan.safeBuildRequired && <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/30 text-xs"><ShieldCheck className="h-3 w-3 mr-1" />Safe build</Badge>}
        </CardTitle>
        {expanded ? <ChevronUp className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
      </CardHeader>
      {expanded && (
        <CardContent className="px-4 pb-4 space-y-4">
          <p className="text-sm text-zinc-300">{plan.summary}</p>
          <div className="flex flex-wrap gap-1.5">{plan.requiredAgents.map((a) => <AgentChip key={a} agent={a} />)}</div>
          {plan.steps.length > 0 && (
            <ol className="space-y-2">
              {plan.steps.map((step) => (
                <li key={step.stepNumber} className="flex gap-3 text-sm">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[11px] text-zinc-400 font-mono mt-0.5">{step.stepNumber}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-zinc-200">{step.title}</span>
                      <AgentChip agent={step.assignedAgent} />
                      {step.requiresApproval && <Badge variant="destructive" className="text-[10px] py-0">approval</Badge>}
                      {step.safeBuildCheckpoint && <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/30 text-[10px] py-0">safe build</Badge>}
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {plan.blockers.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <p className="text-xs font-semibold text-red-400 mb-1">Blockers</p>
              {plan.blockers.map((b, i) => <p key={i} className="text-xs text-red-300">{b}</p>)}
            </div>
          )}
          {status === "awaiting_user_approval" && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
              <p className="text-sm font-semibold text-amber-400 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />Approval required</p>
              <ul className="space-y-0.5">{plan.approvalReasons.map((r, i) => <li key={i} className="text-xs text-amber-300">· {r}</li>)}</ul>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" className="border-zinc-700 text-zinc-300" onClick={onCancel} disabled={approving}>Cancel task</Button>
                <Button size="sm" onClick={onApprove} disabled={approving}>
                  {approving ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                  Approve & run
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Runtime Panel ──────────────────────────────────────────────────────────

function RuntimePanel({ taskId, task }: { taskId: number; task: TaskData }) {
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const { toast } = useToast();

  const loadRuntime = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/runtime/${taskId}/status`, { credentials: "include" });
      if (!r.ok) return;
      const d = await r.json() as RuntimeStatus;
      setRuntime(d);
    } catch { }
  }, [taskId]);

  useEffect(() => { void loadRuntime(); }, [loadRuntime]);

  // Poll runtime status every 4s while task is active
  useEffect(() => {
    if (["completed", "cancelled", "failed", "ready_for_owner_review"].includes(task.status)) return;
    const iv = setInterval(() => void loadRuntime(), 4000);
    return () => clearInterval(iv);
  }, [loadRuntime, task.status]);

  async function callRuntime(endpoint: string, method = "POST", body?: Record<string, unknown>) {
    setActing(true);
    try {
      const r = await fetch(`${BASE}/api/runtime/${taskId}/${endpoint}`, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await r.json() as Record<string, unknown>;
      if (!r.ok) throw new Error(String(d["error"] ?? "Action failed"));
      await loadRuntime();
    } catch (err) {
      toast({ title: "Runtime error", description: String(err), variant: "destructive" });
    } finally {
      setActing(false);
    }
  }

  async function handleApproveStep(stepId: number, decision: "approved" | "denied") {
    await callRuntime(`approve/${stepId}`, "POST", { decision });
    if (decision === "approved") {
      toast({ title: "Step approved", description: "Runtime will continue to next step." });
    } else {
      toast({ title: "Step denied", description: "Step blocked. Task execution halted.", variant: "destructive" });
    }
  }

  const run = runtime?.run;
  const steps = runtime?.steps ?? [];
  const blockers = runtime?.blockers ?? [];
  const pendingApprovals = runtime?.pendingApprovals ?? [];
  const pendingCredentials = runtime?.pendingCredentials ?? [];

  const canStart = !run || ["cancelled", "failed"].includes(run.status);
  const canNext = run && ["running"].includes(run.status);
  const canPause = run && ["running", "waiting_for_user_approval"].includes(run.status);
  const canResume = run && ["blocked", "waiting_for_user_approval", "waiting_for_credential", "waiting_for_safe_build"].includes(run.status);
  const isTerminal = run && ["completed", "cancelled", "failed", "ready_for_owner_review"].includes(run.status);

  return (
    <Card className="border-zinc-800">
      <CardHeader className="py-3 px-4 border-b border-zinc-800/60">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          Agent Runtime Engine
        </CardTitle>
        <p className="text-xs text-zinc-500 mt-0.5">
          VIBA is executing this task through a controlled runtime. Sensitive actions pause for approval. Credentials stay encrypted in the vault. Deployment is blocked until safe-build passes.
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-5 pt-4">

        {/* 1. Task Status */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {run ? <StatusBadge status={run.status} /> : <StatusBadge status={task.status} />}
            {run?.riskLevel && <RiskBadge level={run.riskLevel} />}
            {run?.safeBuildRequired && (
              <Badge className={`text-[10px] ${run.safeBuildStatus === "passed" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-purple-500/15 text-purple-400 border-purple-500/30"}`}>
                <ShieldCheck className="h-3 w-3 mr-1" />
                Safe build: {run.safeBuildStatus ?? "not run"}
              </Badge>
            )}
          </div>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={loadRuntime} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* 2. Runtime Control Buttons */}
        <div className="flex flex-wrap gap-2">
          {canStart && (
            <Button size="sm" onClick={() => callRuntime("start")} disabled={acting}>
              <Play className="h-3.5 w-3.5 mr-1.5" />Start runtime
            </Button>
          )}
          {canNext && (
            <Button size="sm" variant="outline" className="border-zinc-700" onClick={() => callRuntime("next")} disabled={acting}>
              <SkipForward className="h-3.5 w-3.5 mr-1.5" />Run next step
            </Button>
          )}
          {canPause && (
            <Button size="sm" variant="outline" className="border-amber-700/50 text-amber-400" onClick={() => callRuntime("pause", "POST", { reason: "Paused by user" })} disabled={acting}>
              <Pause className="h-3.5 w-3.5 mr-1.5" />Pause
            </Button>
          )}
          {canResume && (
            <Button size="sm" variant="outline" className="border-emerald-700/50 text-emerald-400" onClick={() => callRuntime("resume")} disabled={acting}>
              <Play className="h-3.5 w-3.5 mr-1.5" />Resume
            </Button>
          )}
          {!isTerminal && run && (
            <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => callRuntime("cancel")} disabled={acting}>
              <StopCircle className="h-3.5 w-3.5 mr-1.5" />Cancel
            </Button>
          )}
          {isTerminal && run?.status === "ready_for_owner_review" && (
            <a href={`${BASE}/api/runtime/${taskId}/evidence-report`} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" className="border-emerald-700/50 text-emerald-400">
                <FileText className="h-3.5 w-3.5 mr-1.5" />View evidence report
              </Button>
            </a>
          )}
        </div>

        {/* 3. Blockers */}
        {blockers.length > 0 && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-1">
            <p className="text-xs font-semibold text-red-400 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />Blockers</p>
            {blockers.map((b, i) => <p key={i} className="text-xs text-red-300">{b}</p>)}
          </div>
        )}

        {/* 4. Approval Requests */}
        {pendingApprovals.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5" />Approval Required</p>
            {pendingApprovals.map((step) => (
              <div key={step.id} className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-amber-300">{step.title}</p>
                    <p className="text-xs text-zinc-500"><AgentChip agent={step.agent_name} /> · risk: {step.risk_level} {step.tool_id ? `· tool: ${step.tool_id}` : ""}</p>
                  </div>
                  <RiskBadge level={step.risk_level} />
                </div>
                <p className="text-xs text-zinc-400 italic">No raw credentials shown. Credentials stay encrypted in vault.</p>
                <div className="flex gap-2">
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white border-0" onClick={() => handleApproveStep(step.id, "approved")} disabled={acting}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Approve
                  </Button>
                  <Button size="sm" variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={() => handleApproveStep(step.id, "denied")} disabled={acting}>
                    <XCircle className="h-3.5 w-3.5 mr-1.5" />Deny
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 5. Missing Credentials */}
        {pendingCredentials.length > 0 && (
          <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3 space-y-2">
            <p className="text-xs font-semibold text-orange-400 flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" />Missing Credentials</p>
            {pendingCredentials.map((step) => (
              <div key={step.id} className="text-xs space-y-0.5">
                <p className="text-orange-300 font-medium">{step.title}</p>
                <p className="text-zinc-500">Provider: <span className="text-zinc-300">{step.credential_provider ?? "unknown"}</span> · Kind: <span className="text-zinc-300">{step.credential_kind ?? "unknown"}</span></p>
                <p className="text-zinc-600 italic">Add credential to secure vault. Raw key will never be shown after save.</p>
              </div>
            ))}
            <a href={`${BASE}/credentials`} className="text-xs text-orange-400 underline underline-offset-2 hover:text-orange-300">→ Open Vault to add credential</a>
          </div>
        )}

        {/* 6. Safe Build Status */}
        {run?.safeBuildRequired && (
          <div className={`rounded-lg border p-3 ${run.safeBuildStatus === "passed" ? "border-emerald-500/25 bg-emerald-500/5" : run.safeBuildStatus === "failed" ? "border-red-500/25 bg-red-500/5" : "border-purple-500/20 bg-purple-500/5"}`}>
            <p className={`text-xs font-semibold flex items-center gap-1.5 ${run.safeBuildStatus === "passed" ? "text-emerald-400" : run.safeBuildStatus === "failed" ? "text-red-400" : "text-purple-400"}`}>
              <ShieldCheck className="h-3.5 w-3.5" />
              Safe Build Gate — {run.safeBuildStatus === "passed" ? "Passed" : run.safeBuildStatus === "failed" ? "Failed — deployment blocked" : "Not yet run"}
            </p>
            {run.safeBuildStatus !== "passed" && (
              <p className="text-xs text-zinc-400 mt-1.5 font-mono">$ pnpm run safe-build</p>
            )}
          </div>
        )}

        {/* 7. Step Timeline */}
        {steps.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5" />Step Timeline</p>
            <div className="space-y-1">
              {steps.map((step) => (
                <div key={step.id} className={`flex items-start gap-3 px-3 py-2 rounded-lg border transition-colors ${step.status === "running" ? "border-primary/30 bg-primary/5" : step.status === "completed" ? "border-emerald-500/15 bg-emerald-500/5" : step.status === "waiting" || step.status === "blocked" ? "border-amber-500/20 bg-amber-500/5" : "border-zinc-800 bg-transparent"}`}>
                  <StepStatusIcon status={step.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-medium text-zinc-200">{step.title}</span>
                      <AgentChip agent={step.agent_name} />
                      {step.risk_level !== "low" && step.risk_level !== "read_only" && <RiskBadge level={step.risk_level} />}
                      {step.requires_approval && step.approval_status !== "approved" && (
                        <Badge variant="destructive" className="text-[10px] py-0">approval</Badge>
                      )}
                      {step.requires_safe_build && (
                        <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/30 text-[10px] py-0">safe build</Badge>
                      )}
                    </div>
                    {step.blocked_reason && (
                      <p className="text-xs text-amber-400 mt-0.5">{step.blocked_reason}</p>
                    )}
                    {step.started_at && !step.completed_at && (
                      <p className="text-[11px] text-zinc-600 mt-0.5">Started {fmtTime(step.started_at)}</p>
                    )}
                    {step.completed_at && (
                      <p className="text-[11px] text-zinc-600 mt-0.5">Completed {fmtTime(step.completed_at)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 8. Final Review Report */}
        {run?.status === "ready_for_owner_review" && (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-2">
            <p className="text-sm font-semibold text-emerald-400 flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" />Ready for Owner Review</p>
            <p className="text-xs text-zinc-400">All steps completed. Evidence report is ready. No secrets are included in the report.</p>
            <a href={`${BASE}/api/runtime/${taskId}/evidence-report`} target="_blank" rel="noopener noreferrer">
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white border-0 mt-1">
                <FileText className="h-3.5 w-3.5 mr-1.5" />Download Evidence Report
              </Button>
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── BYOK Panel ─────────────────────────────────────────────────────────────

function ByokPanel({ suggestion, customAis, onSave }: { suggestion: string | null; customAis: CustomAi[]; onSave: () => void }) {
  const [aiName, setAiName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { toast } = useToast();
  if (!suggestion && customAis.length === 0) return null;

  async function handleSave() {
    if (!aiName.trim() || !apiKey.trim()) { toast({ title: "AI name and API key are required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/custom-ai/save`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: aiName.trim(), value: apiKey.trim() }),
      });
      if (!r.ok) throw new Error("Save failed");
      setAiName(""); setApiKey(""); setSaved(true);
      toast({ title: "AI connection saved", description: "Your key is encrypted in the vault. The raw value will never be shown again." });
      onSave();
    } catch { toast({ title: "Failed to save", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Card className="border-blue-800/40 bg-blue-950/20">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm font-semibold text-blue-400 flex items-center gap-2"><Plus className="h-4 w-4" />Optional: AI connections (BYOK)</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <p className="text-xs text-blue-200/70">Groq is included as VIBA's default model. For enhanced performance, you can connect your own AI accounts. This is optional BYOK. Your provider billing remains with you.</p>
        {customAis.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-zinc-400">Saved AI connections ({customAis.length})</p>
            <div className="flex flex-wrap gap-1.5">{customAis.map((ai) => <Badge key={ai.provider} variant="secondary" className="capitalize">{ai.name}</Badge>)}</div>
          </div>
        )}
        {!saved && (
          <div className="space-y-2 pt-1">
            <input type="text" value={aiName} onChange={(e) => setAiName(e.target.value)} placeholder="AI name (e.g. Mistral, Together AI)" className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-primary/50" />
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key" className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-primary/50" />
            <Button size="sm" variant="outline" className="border-blue-700/60 text-blue-300" onClick={handleSave} disabled={saving || !aiName.trim() || !apiKey.trim()}>
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}Add AI connection
            </Button>
          </div>
        )}
        {saved && <p className="text-xs text-emerald-400">✓ AI connection saved securely.</p>}
      </CardContent>
    </Card>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function AgentConsolePage() {
  const [inputValue, setInputValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [task, setTask] = useState<TaskData | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [customAis, setCustomAis] = useState<CustomAi[]>([]);
  const [approving, setApproving] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  const loadMessages = useCallback(async (taskId: number) => {
    const r = await fetch(`${BASE}/api/agent-comms-console/messages?task_id=${taskId}&limit=200`, { credentials: "include" });
    if (!r.ok) return;
    const d = await r.json() as { messages?: AgentMessage[] };
    setMessages((d.messages ?? []).slice().reverse());
  }, []);

  const loadCustomAis = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/custom-ai/list`, { credentials: "include" });
      if (!r.ok) return;
      const d = await r.json() as { customAiProviders?: CustomAi[] };
      setCustomAis(d.customAiProviders ?? []);
    } catch { }
  }, []);

  useEffect(() => { void loadCustomAis(); }, [loadCustomAis]);

  const startPolling = useCallback((taskId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => { void loadMessages(taskId); }, 3000);
  }, [loadMessages]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function handleSubmit() {
    if (!inputValue.trim()) return;
    setSubmitting(true);
    try {
      const r = await fetch(`${BASE}/api/task-intake/create`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: inputValue.trim() }),
      });
      const d = await r.json() as { ok?: boolean; task_id?: number; status?: string; plan?: TaskPlan; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Failed to create task");
      setTask({ task_id: d.task_id!, status: d.status!, risk_level: d.plan?.riskLevel ?? "low", needs_user_approval: d.plan?.approvalRequired ?? false, safe_build_required: d.plan?.safeBuildRequired ?? false, safe_build_passed: null, plan: d.plan ?? null, approved_at: null });
      setMessages([]);
      startPolling(d.task_id!);
      await fetch(`${BASE}/api/agent-comms-console/messages`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: d.task_id, from_agent: "coordinator", to_agent: null, message_type: "plan", message: `Task received: "${inputValue.trim().slice(0, 200)}"\n\nPlan source: ${d.plan?.planSource ?? "rules"}. Risk level: ${d.plan?.riskLevel ?? "low"}. ${d.plan?.approvalRequired ? "⚠️ User approval required before proceeding." : "Ready to proceed."}${d.plan?.safeBuildRequired ? " Safe build gate will run before deployment." : ""}` }),
      }).catch(() => {});
      void loadMessages(d.task_id!);
    } catch (err) {
      toast({ title: "Failed to create task", description: String(err), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove() {
    if (!task) return;
    setApproving(true);
    try {
      const r = await fetch(`${BASE}/api/task-intake/${task.task_id}/approve`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } });
      if (!r.ok) throw new Error("Approve failed");
      setTask((t) => t ? { ...t, status: "running" } : t);
      await fetch(`${BASE}/api/agent-comms-console/messages`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task_id: task.task_id, from_agent: "coordinator", message_type: "answer", message: "User approved the task. Agents are now running." }) }).catch(() => {});
      void loadMessages(task.task_id);
    } catch (err) {
      toast({ title: "Approve failed", description: String(err), variant: "destructive" });
    } finally { setApproving(false); }
  }

  async function handleCancel() {
    if (!task) return;
    try {
      const r = await fetch(`${BASE}/api/task-intake/${task.task_id}/cancel`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } });
      if (!r.ok) throw new Error("Cancel failed");
      setTask((t) => t ? { ...t, status: "cancelled" } : t);
      if (pollRef.current) clearInterval(pollRef.current);
    } catch (err) {
      toast({ title: "Cancel failed", description: String(err), variant: "destructive" });
    }
  }

  function handleNewTask() {
    if (pollRef.current) clearInterval(pollRef.current);
    setTask(null); setMessages([]); setInputValue("");
  }

  const showByok = task?.plan?.recommendedBYOK || customAis.length > 0;
  const taskIsActive = task && !["cancelled", "completed", "failed"].includes(task.status);

  return (
    <AppLayout>
      <div className="container max-w-4xl py-8 space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2.5"><Zap className="h-6 w-6 text-primary" />VIBA Agent Console</h1>
          <p className="text-muted-foreground text-sm mt-1">Type what you need. VIBA plans the task, assigns agents, and coordinates the workflow using Groq.</p>
        </div>

        {/* Input */}
        {!task && (
          <Card className="border-zinc-800">
            <CardContent className="pt-4 pb-4 space-y-3">
              <Textarea value={inputValue} onChange={(e) => setInputValue(e.target.value)} placeholder='What do you need VIBA to do? E.g. "Finish my app, secure the server, connect payments, test it, and deploy it."' className="min-h-[100px] resize-none bg-zinc-900/50 border-zinc-700 text-sm" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { void handleSubmit(); } }} />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500">Groq is the default coordinator. Add optional AI connections below for specialist collaboration.</p>
                <Button onClick={handleSubmit} disabled={submitting || !inputValue.trim()} className="shrink-0">
                  {submitting ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}Start VIBA Task
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Active task header */}
        {task && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <StatusBadge status={task.status} />
              <span className="text-xs text-zinc-500 font-mono">#{task.task_id}</span>
              <span className="text-xs text-zinc-500 truncate">{inputValue.slice(0, 80)}{inputValue.length > 80 ? "…" : ""}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {taskIsActive && (
                <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 h-7 px-2" onClick={handleCancel}>
                  <StopCircle className="h-3.5 w-3.5 mr-1" />Cancel
                </Button>
              )}
              <Button size="sm" variant="outline" className="border-zinc-700 h-7 px-2 text-xs" onClick={handleNewTask}>
                <Plus className="h-3.5 w-3.5 mr-1" />New task
              </Button>
            </div>
          </div>
        )}

        {/* Plan panel */}
        {task?.plan && (
          <PlanPanel plan={task.plan} taskId={task.task_id} status={task.status} onApprove={handleApprove} onCancel={handleCancel} approving={approving} />
        )}

        {/* Runtime panel — shown once task is created */}
        {task && <RuntimePanel taskId={task.task_id} task={task} />}

        {/* Agent conversation */}
        {task && (
          <Card className="border-zinc-800">
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between border-b border-zinc-800/60">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                Agent Communication
                {messages.length > 0 && <Badge variant="secondary" className="text-[11px]">{messages.length}</Badge>}
              </CardTitle>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => void loadMessages(task.task_id)} title="Refresh">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </CardHeader>
            <CardContent className="px-4 py-0 max-h-[420px] overflow-y-auto">
              {messages.length === 0 ? (
                <p className="text-xs text-zinc-500 text-center py-8">
                  {["created", "planning", "awaiting_user_approval"].includes(task.status) ? "Waiting for task to start…" : "No agent messages yet. Messages appear here as agents work through the task."}
                </p>
              ) : (
                messages.map((m) => <MessageBubble key={m.id} msg={m} />)
              )}
            </CardContent>
          </Card>
        )}

        {/* BYOK panel */}
        {showByok && task && (
          <ByokPanel suggestion={task.plan?.byokSuggestion ?? null} customAis={customAis} onSave={loadCustomAis} />
        )}
      </div>
    </AppLayout>
  );
}
