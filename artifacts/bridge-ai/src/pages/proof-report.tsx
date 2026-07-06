import { useState, useEffect, useCallback } from "react";
import { useSearch, Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useListSessions } from "@workspace/api-client-react";
import {
  FileText, CheckCircle2, Clock, XCircle, AlertTriangle,
  RefreshCw, ChevronLeft, Users, Shield, ArrowRight,
  BarChart2, Layers, Lock,
} from "lucide-react";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types (mirrors API ProofReport shape) ────────────────────────────────────

interface ProofReportAgent { name: string; provider: string; model: string; role: string }
interface ProofReportTask {
  index: number; title: string; type: string; status: string;
  completedAt: string | null; blockedReason: string | null; agentName: string;
}
interface ProofReportApproval { requestedAt: string; action: string; outcome: string; note: string | null }
interface ProofReportOutput { label: string; type: string; description: string }
interface ProofReport {
  sessionId: string | number;
  generatedAt: string;
  userGoal: string;
  startedAt: string | null;
  completedAt: string | null;
  sessionStatus: string;
  sessionMode: string;
  agents: ProofReportAgent[];
  tasksCompleted: ProofReportTask[];
  tasksPending: ProofReportTask[];
  tasksBlocked: ProofReportTask[];
  approvalsRequested: number;
  approvalsGranted: number;
  approvalsRejected: number;
  approvalLog: ProofReportApproval[];
  blockersFound: string[];
  outputsGenerated: ProofReportOutput[];
  creditsUsed?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "completed") return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 border">Completed</Badge>;
  if (s === "running" || s === "in_progress") return <Badge className="bg-sky-500/15 text-sky-400 border-sky-500/30 border">Running</Badge>;
  if (s === "failed") return <Badge className="bg-red-500/15 text-red-400 border-red-500/30 border">Failed</Badge>;
  if (s === "blocked" || s === "blocked_needs_tools") return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 border">Blocked</Badge>;
  return <Badge variant="outline" className="capitalize">{status}</Badge>;
}

function OutcomeDot({ outcome }: { outcome: string }) {
  if (outcome === "granted") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
  if (outcome === "rejected") return <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />;
  return <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ProofReportPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const sessionIdFromUrl = params.get("session") ?? null;

  const { data: sessions } = useListSessions();

  const [selectedId, setSelectedId] = useState<string | null>(sessionIdFromUrl);
  const [report, setReport] = useState<ProofReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-select most recent completed session if no URL param
  useEffect(() => {
    if (!selectedId && sessions && sessions.length > 0) {
      const first = sessions.find(s => s.status === "completed") ?? sessions[0];
      if (first) setSelectedId(String(first.id));
    }
  }, [sessions, selectedId]);

  const fetchReport = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const r = await fetch(`${BASE}/api/proof-report/session/${id}`, { credentials: "include" });
      const d = await r.json() as ProofReport & { error?: string; message?: string };
      if (!r.ok) throw new Error(d.message ?? d.error ?? `HTTP ${r.status}`);
      setReport(d);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load proof report.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void fetchReport(selectedId);
  }, [selectedId, fetchReport]);

  const completedCount = report ? report.tasksCompleted.length : 0;
  const totalTasks = report
    ? report.tasksCompleted.length + report.tasksPending.length + report.tasksBlocked.length
    : 0;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                <ChevronLeft className="h-4 w-4" /> Dashboard
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Proof Report
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Evidence-backed session audit — safe to share with clients
              </p>
            </div>
          </div>
          {report && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={() => void fetchReport(selectedId!)}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          )}
        </div>

        {/* Session selector */}
        {sessions && sessions.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                Select Session
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-2">
                {sessions.slice(0, 10).map(s => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedId(String(s.id))}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs text-left transition-all ${
                      String(s.id) === selectedId
                        ? "border-primary/50 bg-primary/[0.08] text-primary"
                        : "border-border/50 bg-card hover:border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className="font-medium truncate max-w-[180px]">
                      {s.goal || `Session ${s.id}`}
                    </span>
                    <StatusBadge status={s.status} />
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Empty — no sessions */}
        {!sessions?.length && !loading && (
          <Card>
            <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium">No sessions yet</p>
              <p className="text-xs text-muted-foreground">Run a VIBA session to generate your first proof report.</p>
              <Link href="/sessions/new">
                <Button size="sm" className="mt-2 gap-1.5">
                  Start a session <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Loading */}
        {loading && (
          <Card>
            <CardContent className="py-12 flex flex-col items-center gap-3">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Generating proof report…</p>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {error && !loading && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="py-6 flex items-center gap-3 text-sm text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </CardContent>
          </Card>
        )}

        {/* Report */}
        {report && !loading && (
          <div className="space-y-5">

            {/* Summary bar */}
            <Card>
              <CardContent className="py-4 flex flex-wrap gap-6 items-center">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground mb-0.5">Goal</p>
                  <p className="text-sm font-medium truncate">{report.userGoal || "No goal set"}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusBadge status={report.sessionStatus} />
                  <Badge variant="outline" className="text-[10px] capitalize">{report.sessionMode}</Badge>
                </div>
                {report.completedAt && (
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-muted-foreground">Completed</p>
                    <p className="text-xs font-mono">{format(new Date(report.completedAt), "MMM d, HH:mm")}</p>
                  </div>
                )}
                {report.generatedAt && (
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-muted-foreground">Report generated</p>
                    <p className="text-xs font-mono">{format(new Date(report.generatedAt), "MMM d, HH:mm:ss")}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Tasks done", value: completedCount, of: totalTasks, icon: CheckCircle2, color: "text-emerald-400" },
                { label: "Approvals", value: report.approvalsGranted, of: report.approvalsRequested, icon: Shield, color: "text-sky-400" },
                { label: "Agents", value: report.agents.length, icon: Users, color: "text-violet-400" },
                { label: "Blockers", value: report.blockersFound.length, icon: Lock, color: report.blockersFound.length > 0 ? "text-red-400" : "text-muted-foreground" },
              ].map(({ label, value, of: outOf, icon: Icon, color }) => (
                <Card key={label}>
                  <CardContent className="pt-4 pb-3 flex items-center gap-3">
                    <Icon className={`h-5 w-5 shrink-0 ${color}`} />
                    <div>
                      <div className="text-xl font-bold leading-none">
                        {value}
                        {outOf !== undefined && <span className="text-xs text-muted-foreground font-normal ml-1">/ {outOf}</span>}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Agents */}
            {report.agents.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    Agents in session
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-2">
                    {report.agents.map(a => (
                      <div key={`${a.name}-${a.role}`} className="flex items-center gap-2 rounded-lg border border-border/50 bg-card px-3 py-2">
                        <span className="text-sm font-semibold">{a.name}</span>
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5">{a.role}</Badge>
                        <span className="text-[10px] text-muted-foreground font-mono">{a.model}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Tasks completed */}
            {report.tasksCompleted.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    Completed tasks
                    <Badge className="ml-auto text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border">
                      {report.tasksCompleted.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 flex flex-col divide-y divide-border">
                  {report.tasksCompleted.map(t => (
                    <div key={t.index} className="flex items-start gap-3 py-2.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{t.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{t.agentName} · {t.type}</p>
                      </div>
                      {t.completedAt && (
                        <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                          {format(new Date(t.completedAt), "HH:mm:ss")}
                        </span>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Blocked tasks */}
            {report.tasksBlocked.length > 0 && (
              <Card className="border-amber-500/30">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                    Blocked tasks
                    <Badge className="ml-auto text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20 border">
                      {report.tasksBlocked.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 flex flex-col divide-y divide-border">
                  {report.tasksBlocked.map(t => (
                    <div key={t.index} className="flex items-start gap-3 py-2.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{t.title}</p>
                        {t.blockedReason && (
                          <p className="text-[11px] text-amber-400/80 mt-0.5">{t.blockedReason}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Approval log */}
            {report.approvalLog.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    Approval log
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 flex flex-col divide-y divide-border">
                  {report.approvalLog.map((a, i) => (
                    <div key={i} className="flex items-start gap-3 py-2.5">
                      <OutcomeDot outcome={a.outcome} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{a.action}</p>
                        {a.note && <p className="text-[11px] text-muted-foreground mt-0.5">{a.note}</p>}
                      </div>
                      <span className="text-[10px] text-muted-foreground capitalize font-medium shrink-0">{a.outcome}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Blockers */}
            {report.blockersFound.length > 0 && (
              <Card className="border-red-500/30">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2 text-red-400">
                    <Lock className="h-4 w-4" />
                    Blockers found
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-1.5">
                  {report.blockersFound.map((b, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-red-400/90">
                      <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      {b}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Outputs generated */}
            {report.outputsGenerated.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart2 className="h-4 w-4 text-muted-foreground" />
                    Outputs generated
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  {report.outputsGenerated.map((o, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{o.label}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{o.description}</p>
                      </div>
                      <Badge variant="outline" className="ml-auto text-[9px] capitalize shrink-0">{o.type}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Footer note */}
            <p className="text-[11px] text-muted-foreground text-center pb-2">
              Report generated {format(new Date(report.generatedAt), "PPP 'at' HH:mm:ss")} · Session #{String(report.sessionId)}
            </p>

          </div>
        )}
      </div>
    </AppLayout>
  );
}
