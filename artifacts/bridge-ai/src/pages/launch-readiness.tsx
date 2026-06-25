import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Rocket,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertCircle,
  HelpCircle,
  Loader2,
  RefreshCw,
  ExternalLink,
  ClipboardCheck,
  DollarSign,
  Bot,
  Gauge,
  Zap,
  Activity,
  Globe,
  Building2,
} from "lucide-react";
import { Link } from "wouter";

type GateStatus = "pass" | "fail" | "warning" | "unknown";
type LaunchStatus = "not_ready" | "blocked" | "ready_for_private_beta" | "ready_for_public_launch";

interface GateResult {
  gate: string;
  pass: boolean | null;
  status: GateStatus;
  details: string;
  blockers?: string[];
}

interface LaunchReport {
  id: string;
  generatedAt: string;
  branch: string;
  commit: string;
  launchStatus: LaunchStatus;
  gates: GateResult[];
  ownerChecklist: Record<string, boolean>;
  remainingBlockers: string[];
  paymentAuditFindings: string[];
  agentEvalRun?: { score: number; pass: boolean; criticalFail: boolean };
  betaChaosRun?: { summary: { total: number; passed: number; failed: number }; releaseBlocked: boolean };
}

const GATE_META: Record<string, { label: string; icon: React.ElementType; link?: string }> = {
  safe_build: { label: "Safe Build", icon: ClipboardCheck },
  qa_release_gate: { label: "QA Gate", icon: ClipboardCheck, link: "/qa-release-gate" },
  security: { label: "Security", icon: ShieldCheck, link: "/security-center" },
  payments_credits: { label: "Payments & Credits", icon: DollarSign, link: "/billing" },
  vault_byok: { label: "Vault / BYOK", icon: ShieldCheck, link: "/credentials" },
  agent_evaluation: { label: "Agent Evaluation", icon: Bot },
  cost_control: { label: "Cost Control", icon: Gauge },
  production_ops: { label: "Production Ops", icon: Activity, link: "/production-ops" },
  beta_chaos: { label: "Beta Chaos Tests", icon: Zap },
};

const LAUNCH_STATUS_CONFIG: Record<LaunchStatus, { label: string; color: string; icon: React.ElementType }> = {
  not_ready: { label: "Not Ready", color: "text-muted-foreground", icon: HelpCircle },
  blocked: { label: "Blocked", color: "text-red-400", icon: XCircle },
  ready_for_private_beta: { label: "Ready for Private Beta", color: "text-amber-400", icon: AlertCircle },
  ready_for_public_launch: { label: "Ready for Public Launch", color: "text-emerald-400", icon: CheckCircle2 },
};

function StatusIcon({ status }: { status: GateStatus }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
  if (status === "fail") return <XCircle className="h-4 w-4 text-red-400 shrink-0" />;
  if (status === "warning") return <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />;
  return <HelpCircle className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function GateCard({ gate }: { gate: GateResult }) {
  const meta = GATE_META[gate.gate] ?? { label: gate.gate, icon: ClipboardCheck };
  const Icon = meta.icon;

  return (
    <div className={`rounded-xl border p-4 space-y-2 ${
      gate.status === "fail" ? "border-red-500/30 bg-red-500/5" :
      gate.status === "pass" ? "border-emerald-500/20 bg-emerald-500/5" :
      gate.status === "warning" ? "border-amber-500/20 bg-amber-500/5" :
      "border-border/50 bg-card"
    }`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`h-4 w-4 shrink-0 ${
            gate.status === "fail" ? "text-red-400" :
            gate.status === "pass" ? "text-emerald-400" :
            gate.status === "warning" ? "text-amber-400" :
            "text-muted-foreground"
          }`} />
          <span className="font-medium text-sm truncate">{meta.label}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusIcon status={gate.status} />
          {meta.link && (
            <Link href={meta.link}>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors" />
            </Link>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{gate.details}</p>
      {gate.blockers && gate.blockers.length > 0 && (
        <ul className="space-y-1">
          {gate.blockers.map((b) => (
            <li key={b} className="text-xs text-red-400 flex items-start gap-1.5">
              <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {b}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LaunchReadinessPage() {
  const [report, setReport] = useState<LaunchReport | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function runCheck() {
    setLoading(true);
    try {
      const res = await fetch("/api/launch-readiness/run", { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast({ title: "Check failed", description: d.error ?? "Server error", variant: "destructive" });
        return;
      }
      const data = await res.json();
      setReport(data);
      toast({ title: "Launch readiness check complete" });
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const statusConfig = report ? LAUNCH_STATUS_CONFIG[report.launchStatus] : null;
  const StatusIconComp = statusConfig?.icon ?? HelpCircle;

  return (
    <AppLayout>
      <div className="flex flex-col space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Launch Readiness</h1>
            <p className="text-muted-foreground">Aggregate gate status and evidence pack for owner review</p>
          </div>
          <Button onClick={runCheck} disabled={loading} className="gap-2 shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Run Launch Readiness Check
          </Button>
        </div>

        {/* Status banner */}
        {report && statusConfig && (
          <div className={`flex items-center gap-3 rounded-xl border p-4 ${
            report.launchStatus === "ready_for_public_launch" ? "border-emerald-500/30 bg-emerald-500/5" :
            report.launchStatus === "ready_for_private_beta" ? "border-amber-500/30 bg-amber-500/5" :
            report.launchStatus === "blocked" ? "border-red-500/30 bg-red-500/5" :
            "border-border/50 bg-card"
          }`}>
            <StatusIconComp className={`h-6 w-6 shrink-0 ${statusConfig.color}`} />
            <div className="min-w-0">
              <p className={`font-semibold ${statusConfig.color}`}>{statusConfig.label}</p>
              <p className="text-xs text-muted-foreground">
                Branch: <span className="font-mono">{report.branch}</span> — Commit: <span className="font-mono">{report.commit}</span>
              </p>
            </div>
            <Badge
              variant="outline"
              className={`ml-auto shrink-0 ${
                report.launchStatus === "ready_for_public_launch" ? "border-emerald-500/40 text-emerald-400" :
                report.launchStatus === "ready_for_private_beta" ? "border-amber-500/40 text-amber-400" :
                report.launchStatus === "blocked" ? "border-red-500/40 text-red-400" :
                "border-border text-muted-foreground"
              }`}
            >
              {report.remainingBlockers.length} blocker{report.remainingBlockers.length !== 1 ? "s" : ""}
            </Badge>
          </div>
        )}

        {/* No report yet */}
        {!report && !loading && (
          <div className="text-center py-16 text-muted-foreground">
            <Rocket className="h-10 w-10 mx-auto mb-4 opacity-30" />
            <p className="text-sm">Click <strong>Run Launch Readiness Check</strong> to evaluate all gates.</p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-16 text-muted-foreground">
            <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin opacity-50" />
            <p className="text-sm">Running checks — evaluating all gates…</p>
          </div>
        )}

        {report && (
          <>
            {/* Gate grid */}
            <div>
              <h2 className="text-base font-semibold mb-3">Gate Status</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {report.gates.map((gate) => (
                  <GateCard key={gate.gate} gate={gate} />
                ))}
              </div>
            </div>

            {/* Scores */}
            {(report.agentEvalRun || report.betaChaosRun) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {report.agentEvalRun && (
                  <div className="rounded-xl border border-border/50 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-primary" />
                      <span className="font-medium text-sm">Agent Evaluation Score</span>
                    </div>
                    <p className={`text-3xl font-bold ${report.agentEvalRun.score >= 85 ? "text-emerald-400" : "text-red-400"}`}>
                      {report.agentEvalRun.score}<span className="text-base text-muted-foreground">/100</span>
                    </p>
                    <p className="text-xs text-muted-foreground">Pass threshold: 85 · Critical fail: {report.agentEvalRun.criticalFail ? "Yes" : "No"}</p>
                  </div>
                )}
                {report.betaChaosRun && (
                  <div className="rounded-xl border border-border/50 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-amber-400" />
                      <span className="font-medium text-sm">Beta Chaos Tests</span>
                    </div>
                    <p className={`text-3xl font-bold ${report.betaChaosRun.releaseBlocked ? "text-red-400" : "text-emerald-400"}`}>
                      {report.betaChaosRun.summary.passed}<span className="text-base text-muted-foreground">/{report.betaChaosRun.summary.total}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">Passed · Release blocked: {report.betaChaosRun.releaseBlocked ? "Yes" : "No"}</p>
                  </div>
                )}
              </div>
            )}

            {/* Blockers */}
            {report.remainingBlockers.length > 0 && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-2">
                <h3 className="text-sm font-semibold text-red-400 flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  Open Blockers ({report.remainingBlockers.length})
                </h3>
                <ul className="space-y-1">
                  {report.remainingBlockers.map((b) => (
                    <li key={b} className="text-xs text-red-300 flex items-start gap-1.5">
                      <span className="mt-0.5">•</span>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Owner checklist */}
            <div>
              <h2 className="text-base font-semibold mb-3">Owner Approval Checklist</h2>
              <div className="rounded-xl border border-border/50 divide-y divide-border/30">
                {Object.entries(report.ownerChecklist).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-3 px-4 py-3">
                    {val ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                    )}
                    <span className="text-sm capitalize">
                      {key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                    </span>
                    {key === "ownerApproved" && !val && (
                      <Badge variant="outline" className="ml-auto text-[10px] border-amber-500/40 text-amber-400">
                        Pending
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Payment audit */}
            <div>
              <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                Payment & Credits Audit
              </h2>
              <div className="rounded-xl border border-border/50 p-4 space-y-1.5">
                {report.paymentAuditFindings.map((f) => (
                  <p key={f} className="text-xs text-muted-foreground">{f}</p>
                ))}
              </div>
            </div>

            {/* Evidence pack link */}
            <div className="flex items-center gap-3 rounded-xl border border-border/50 p-4">
              <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Evidence Pack</p>
                <p className="text-xs text-muted-foreground">Full JSON report — no secrets included (rawValuesReturned: false)</p>
              </div>
              <a
                href="/api/launch-readiness/evidence-pack"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto shrink-0"
              >
                <Button variant="outline" size="sm" className="gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" />
                  View
                </Button>
              </a>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
