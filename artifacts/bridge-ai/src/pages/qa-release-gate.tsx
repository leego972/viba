import { useState, useCallback, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldCheck, ShieldAlert, RefreshCw, Play, CheckCircle2, XCircle,
  AlertTriangle, Clock, FileText, Globe, Smartphone, Lock,
  ChevronDown, ChevronUp, Clipboard, Ban,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

type RunStatus = "created" | "running" | "passed" | "passed_with_warnings" | "blocked" | "failed" | "cancelled";
type ReleaseStatus = "not_ready" | "blocked" | "ready_for_owner_review" | "approved_for_merge" | "approved_for_deploy";
type CheckStatus = "pending" | "running" | "passed" | "warning" | "failed" | "blocked" | "skipped";
type Severity = "info" | "low" | "medium" | "high" | "critical";

interface QACheck {
  id: number;
  qa_run_id: number;
  suite: string;
  check_name: string;
  check_id: string;
  status: CheckStatus;
  severity: Severity;
  manual: boolean;
  error: string | null;
}

interface QARun {
  id: number;
  task_id: number | null;
  branch_name: string | null;
  commit_sha: string | null;
  status: RunStatus;
  release_status: ReleaseStatus;
  started_at: string | null;
  completed_at: string | null;
  summary: string | null;
  blockers_json: string[];
  warnings_json: string[];
  created_at: string;
}

interface ReportSummary {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  pending: number;
  skipped: number;
  manualChecksRemaining: number;
  criticalBlockers: string[];
}

interface QAReport {
  qaRunId: number;
  status: RunStatus;
  releaseStatus: ReleaseStatus;
  branchName: string | null;
  commitSha: string | null;
  summary: ReportSummary;
  blockers: string[];
  warnings: string[];
  suitesSummary: Record<string, { passed: number; failed: number; pending: number }>;
  browserEvidence: Array<{ route: string; status: string; evidence: unknown }>;
  securityNote: string;
  generatedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(s: RunStatus | ReleaseStatus | CheckStatus): string {
  switch (s) {
    case "passed": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "passed_with_warnings": return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "ready_for_owner_review": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "approved_for_merge":
    case "approved_for_deploy": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "blocked":
    case "failed": return "bg-red-500/15 text-red-400 border-red-500/30";
    case "running": return "bg-indigo-500/15 text-indigo-400 border-indigo-500/30";
    case "warning": return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "pending": return "bg-white/10 text-white/50 border-white/20";
    case "skipped": return "bg-white/5 text-white/30 border-white/10";
    default: return "bg-white/10 text-white/50 border-white/20";
  }
}

function severityColor(s: Severity): string {
  switch (s) {
    case "critical": return "text-red-400";
    case "high": return "text-orange-400";
    case "medium": return "text-yellow-400";
    case "low": return "text-blue-400";
    default: return "text-white/40";
  }
}

function StatusIcon({ status }: { status: CheckStatus | RunStatus }) {
  switch (status) {
    case "passed": return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
    case "failed":
    case "blocked": return <XCircle className="h-4 w-4 text-red-400 shrink-0" />;
    case "warning":
    case "passed_with_warnings": return <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />;
    case "running": return <RefreshCw className="h-4 w-4 text-indigo-400 animate-spin shrink-0" />;
    case "skipped": return <Ban className="h-4 w-4 text-white/30 shrink-0" />;
    default: return <Clock className="h-4 w-4 text-white/40 shrink-0" />;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function QAReleaseGatePage() {
  const { toast } = useToast();

  // Form state
  const [changedFiles, setChangedFiles] = useState("");
  const [changedRoutes, setChangedRoutes] = useState("");
  const [touchedAreas, setTouchedAreas] = useState("");
  const [branchName, setBranchName] = useState("");
  const [strictMode, setStrictMode] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);

  // Run state
  const [currentRun, setCurrentRun] = useState<QARun | null>(null);
  const [currentChecks, setCurrentChecks] = useState<QACheck[]>([]);
  const [currentReport, setCurrentReport] = useState<QAReport | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [runs, setRuns] = useState<QARun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  // UI state
  const [blockReason, setBlockReason] = useState("");
  const [expandedSuites, setExpandedSuites] = useState<Set<string>>(new Set());

  // ── Fetch runs list ──────────────────────────────────────────────────────────
  const fetchRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/qa/runs`);
      if (res.ok) {
        const data = await res.json() as { runs: QARun[] };
        setRuns(data.runs ?? []);
        if (data.runs?.[0] && !currentRun) setCurrentRun(data.runs[0] ?? null);
      }
    } catch { /* network error handled gracefully */ }
    setRunsLoading(false);
  }, [currentRun]);

  useEffect(() => { void fetchRuns(); }, []);

  // ── Fetch current run + checks ───────────────────────────────────────────────
  const fetchRunDetail = useCallback(async (id: number) => {
    try {
      const res = await fetch(`${BASE}/api/qa/runs/${id}`);
      if (res.ok) {
        const data = await res.json() as { run: QARun; checks: QACheck[] };
        setCurrentRun(data.run);
        setCurrentChecks(data.checks ?? []);
      }
    } catch { /* ignored */ }
  }, []);

  const fetchReport = useCallback(async (id: number) => {
    setReportLoading(true);
    try {
      const res = await fetch(`${BASE}/api/qa/runs/${id}/report`);
      if (res.ok) {
        const data = await res.json() as { report: QAReport };
        setCurrentReport(data.report ?? null);
      }
    } catch { /* ignored */ }
    setReportLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    await fetchRuns();
    if (currentRun) {
      await fetchRunDetail(currentRun.id);
      await fetchReport(currentRun.id);
    }
  }, [currentRun, fetchRuns, fetchRunDetail, fetchReport]);

  // ── Start QA plan + run ──────────────────────────────────────────────────────
  const handleStartQA = useCallback(async () => {
    setPlanLoading(true);
    try {
      const planRes = await fetch(`${BASE}/api/qa/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appName: "VIBA",
          changedFiles: changedFiles.split("\n").map((s) => s.trim()).filter(Boolean),
          changedRoutes: changedRoutes.split("\n").map((s) => s.trim()).filter(Boolean),
          touchedAreas: touchedAreas.split(",").map((s) => s.trim()).filter(Boolean),
          branchName: branchName.trim() || null,
          strictMode,
        }),
      });
      if (!planRes.ok) throw new Error(await planRes.text());
      const planData = await planRes.json() as { qaRunId: number };
      const qaRunId = planData.qaRunId;

      const runRes = await fetch(`${BASE}/api/qa/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qaRunId }),
      });
      if (!runRes.ok) throw new Error(await runRes.text());

      toast({ title: "QA Run started", description: "Automated checks running…" });
      setTimeout(() => { void fetchRuns(); void fetchRunDetail(qaRunId); void fetchReport(qaRunId); }, 2000);
    } catch (err) {
      toast({ title: "Failed to start QA", description: String(err), variant: "destructive" });
    }
    setPlanLoading(false);
  }, [changedFiles, changedRoutes, touchedAreas, branchName, strictMode, fetchRuns, fetchRunDetail, fetchReport, toast]);

  // ── Mark manual check ────────────────────────────────────────────────────────
  const handleMarkCheck = useCallback(async (checkId: number, status: "passed" | "failed") => {
    if (!currentRun) return;
    try {
      const res = await fetch(`${BASE}/api/qa/runs/${currentRun.id}/mark-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkId, status }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: `Check marked ${status}` });
      await fetchRunDetail(currentRun.id);
      await fetchReport(currentRun.id);
    } catch (err) {
      toast({ title: "Error marking check", description: String(err), variant: "destructive" });
    }
  }, [currentRun, fetchRunDetail, fetchReport, toast]);

  // ── Block release ────────────────────────────────────────────────────────────
  const handleBlockRelease = useCallback(async () => {
    if (!currentRun) return;
    try {
      const res = await fetch(`${BASE}/api/qa/runs/${currentRun.id}/block-release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: blockReason.trim() || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Release blocked", variant: "destructive" });
      setBlockReason("");
      await fetchRunDetail(currentRun.id);
    } catch (err) {
      toast({ title: "Error blocking release", description: String(err), variant: "destructive" });
    }
  }, [currentRun, blockReason, fetchRunDetail, toast]);

  // ── Approve release ──────────────────────────────────────────────────────────
  const handleApproveRelease = useCallback(async () => {
    if (!currentRun) return;
    setRunLoading(true);
    try {
      const res = await fetch(`${BASE}/api/qa/runs/${currentRun.id}/approve-release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json() as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to approve");
      toast({ title: "Approved for owner review", description: data.message ?? "" });
      await fetchRunDetail(currentRun.id);
    } catch (err) {
      toast({ title: "Cannot approve", description: String(err), variant: "destructive" });
    }
    setRunLoading(false);
  }, [currentRun, fetchRunDetail, toast]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const manualChecks = currentChecks.filter((c) => c.manual);
  const autoChecks = currentChecks.filter((c) => !c.manual);
  const criticalBlockers = currentReport?.summary.criticalBlockers ?? [];
  const canApprove = currentRun && currentRun.release_status !== "blocked" && criticalBlockers.length === 0 && currentRun.status !== "running";
  const hasCriticalFailures = criticalBlockers.length > 0;

  const groupedManual: Record<string, QACheck[]> = {};
  for (const c of manualChecks) {
    if (!groupedManual[c.suite]) groupedManual[c.suite] = [];
    groupedManual[c.suite]!.push(c);
  }

  function toggleSuite(suite: string) {
    setExpandedSuites((prev) => {
      const next = new Set(prev);
      if (next.has(suite)) next.delete(suite); else next.add(suite);
      return next;
    });
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="container max-w-5xl py-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              QA Release Gate
            </h1>
            <p className="text-sm text-foreground/55 mt-1 max-w-xl">
              VIBA does not mark a build ready until QA, security, vault, browser, and build checks have passed or blockers are clearly listed.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={refresh} disabled={runsLoading || planLoading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${runsLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Section 1 — Start QA Run */}
        <Card className="border-white/[0.07] bg-white/[0.03]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-foreground/80 flex items-center gap-2">
              <Play className="h-4 w-4 text-primary" />
              Start QA Run
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-foreground/50">Changed Files (one per line)</label>
                <textarea
                  className="w-full h-20 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 resize-none focus:outline-none focus:border-primary/40"
                  placeholder={"src/routes/stripe.ts\nsrc/lib/vibaVault.ts"}
                  value={changedFiles}
                  onChange={(e) => setChangedFiles(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-foreground/50">Changed Routes (one per line)</label>
                <textarea
                  className="w-full h-20 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 resize-none focus:outline-none focus:border-primary/40"
                  placeholder={"/api/credentials\n/api/billing"}
                  value={changedRoutes}
                  onChange={(e) => setChangedRoutes(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-foreground/50">Touched Areas (comma-separated)</label>
                <input
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/40"
                  placeholder="vault, payments, mobile"
                  value={touchedAreas}
                  onChange={(e) => setTouchedAreas(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-foreground/50">Branch Name</label>
                <input
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/40"
                  placeholder="viba-feature-branch"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                />
              </div>
              <div className="flex items-end pb-0.5">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={strictMode} onChange={(e) => setStrictMode(e.target.checked)} className="h-4 w-4 rounded border border-white/20 bg-white/5" />
                  <span className="text-sm text-foreground/60">Strict Mode (all suites)</span>
                </label>
              </div>
            </div>
            <Button onClick={handleStartQA} disabled={planLoading} className="w-full md:w-auto">
              <Play className="h-4 w-4 mr-1" />
              {planLoading ? "Starting QA…" : "Start QA"}
            </Button>
          </CardContent>
        </Card>

        {/* Section 2 — Current Release Status */}
        {currentRun && (
          <Card className="border-white/[0.07] bg-white/[0.03]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground/80 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Current Release Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3 items-center">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-foreground/40">Run #{currentRun.id}</span>
                  <Badge className={`text-xs border ${statusColor(currentRun.status)}`}>{currentRun.status}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-foreground/40">Release:</span>
                  <Badge className={`text-xs border ${statusColor(currentRun.release_status)}`}>{currentRun.release_status}</Badge>
                </div>
                {currentRun.branch_name && (
                  <span className="text-xs text-foreground/40 font-mono">{currentRun.branch_name}</span>
                )}
              </div>
              {currentReport && (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2">
                  {[
                    { label: "Passed", value: currentReport.summary.passed, color: "text-emerald-400" },
                    { label: "Failed", value: currentReport.summary.failed, color: "text-red-400" },
                    { label: "Warnings", value: currentReport.summary.warnings, color: "text-yellow-400" },
                    { label: "Pending", value: currentReport.summary.pending, color: "text-white/40" },
                    { label: "Manual Left", value: currentReport.summary.manualChecksRemaining, color: "text-blue-400" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-center">
                      <div className={`text-lg font-bold ${color}`}>{value}</div>
                      <div className="text-[10px] text-foreground/40">{label}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Section 3 — Required (Automated) Checks */}
        {autoChecks.length > 0 && (
          <Card className="border-white/[0.07] bg-white/[0.03]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground/80">Required Checks</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {autoChecks.map((check) => (
                  <div key={check.id} className="flex items-center gap-2 py-1 border-b border-white/[0.04] last:border-0">
                    <StatusIcon status={check.status} />
                    <span className="text-xs text-foreground/70 flex-1">{check.check_name}</span>
                    <span className={`text-[10px] font-medium uppercase ${severityColor(check.severity)}`}>{check.severity}</span>
                    <Badge className={`text-[10px] border ${statusColor(check.status)}`}>{check.status}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Section 4 — Manual Checks */}
        {Object.keys(groupedManual).length > 0 && (
          <Card className="border-white/[0.07] bg-white/[0.03]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground/80 flex items-center gap-2">
                <Clipboard className="h-4 w-4 text-primary" />
                Manual Checks
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(groupedManual).map(([suite, checks]) => (
                <div key={suite} className="rounded-lg border border-white/[0.06] overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors text-left"
                    onClick={() => toggleSuite(suite)}
                  >
                    <span className="text-xs font-medium text-foreground/70 uppercase tracking-wide">{suite.replace(/_/g, " ")}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-foreground/40">{checks.filter((c) => c.status === "passed").length}/{checks.length} passed</span>
                      {expandedSuites.has(suite) ? <ChevronUp className="h-3.5 w-3.5 text-foreground/40" /> : <ChevronDown className="h-3.5 w-3.5 text-foreground/40" />}
                    </div>
                  </button>
                  {expandedSuites.has(suite) && (
                    <div className="divide-y divide-white/[0.04]">
                      {checks.map((check) => (
                        <div key={check.id} className="flex items-center gap-3 px-4 py-3">
                          <StatusIcon status={check.status} />
                          <span className="text-xs text-foreground/65 flex-1">{check.check_name}</span>
                          <span className={`text-[10px] uppercase ${severityColor(check.severity)}`}>{check.severity}</span>
                          {["pending", "running"].includes(check.status) && (
                            <div className="flex gap-1.5">
                              <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                                onClick={() => handleMarkCheck(check.id, "passed")}>
                                ✓ Pass
                              </Button>
                              <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 border-red-500/30 text-red-400 hover:bg-red-500/10"
                                onClick={() => handleMarkCheck(check.id, "failed")}>
                                ✗ Fail
                              </Button>
                            </div>
                          )}
                          {check.status !== "pending" && check.status !== "running" && (
                            <Badge className={`text-[10px] border ${statusColor(check.status)}`}>{check.status}</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Section 5 — Browser Evidence */}
        {(currentReport?.browserEvidence?.length ?? 0) > 0 && (
          <Card className="border-white/[0.07] bg-white/[0.03]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground/80 flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" />
                Browser Evidence
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {currentReport?.browserEvidence.map((ev, i) => (
                  <div key={i} className="flex items-center gap-2 py-1 border-b border-white/[0.04] last:border-0">
                    <StatusIcon status={ev.status as CheckStatus} />
                    <span className="text-xs font-mono text-foreground/60 flex-1">{ev.route}</span>
                    <Badge className={`text-[10px] border ${statusColor(ev.status as CheckStatus)}`}>{ev.status}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Section 6 — Security Blockers */}
        {hasCriticalFailures && (
          <Card className="border-red-500/20 bg-red-500/[0.04]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-red-400 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4" />
                Security Blockers — Release Blocked
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {criticalBlockers.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-red-300">
                    <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-400" />
                    {b}
                  </li>
                ))}
              </ul>
              {(currentReport?.blockers ?? []).length > 0 && (
                <ul className="mt-3 space-y-1">
                  {(currentReport?.blockers ?? []).map((b, i) => (
                    <li key={i} className="text-xs text-foreground/50 pl-5">• {b}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {/* Section 7 — Build Results (suite summary) */}
        {currentReport && Object.keys(currentReport.suitesSummary).length > 0 && (
          <Card className="border-white/[0.07] bg-white/[0.03]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground/80 flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Build Results by Suite
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(currentReport.suitesSummary).map(([suite, counts]) => (
                  <div key={suite} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                    <div className="text-[10px] text-foreground/40 uppercase mb-1">{suite.replace(/_/g, " ")}</div>
                    <div className="flex gap-2 text-xs">
                      <span className="text-emerald-400">{counts.passed}✓</span>
                      <span className="text-red-400">{counts.failed}✗</span>
                      <span className="text-white/30">{counts.pending}…</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Section 8 — Warnings */}
        {(currentReport?.warnings?.length ?? 0) > 0 && (
          <Card className="border-yellow-500/20 bg-yellow-500/[0.03]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-yellow-400 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Warnings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {currentReport?.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-yellow-300/70">• {w}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Section 9 — Owner Approval */}
        {currentRun && (
          <Card className="border-white/[0.07] bg-white/[0.03]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground/80 flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary" />
                Owner Approval
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-foreground/50">
                Approving marks this build as <strong>ready for owner review</strong>. It does not trigger an automatic deployment.
                All critical QA blockers must be resolved before approval is allowed.
              </p>
              {currentReport?.securityNote && (
                <p className="text-[10px] text-foreground/30 border border-white/[0.05] rounded px-3 py-2">{currentReport.securityNote}</p>
              )}
              <div className="flex flex-wrap gap-3 items-end">
                <Button
                  onClick={handleApproveRelease}
                  disabled={!canApprove || runLoading}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
                >
                  <ShieldCheck className="h-4 w-4 mr-1" />
                  {runLoading ? "Approving…" : "Approve for Owner Review"}
                </Button>
                <div className="flex gap-2 items-center">
                  <input
                    className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-red-500/40 w-56"
                    placeholder="Block reason (optional)"
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                  />
                  <Button variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={handleBlockRelease}>
                    <Ban className="h-4 w-4 mr-1" />
                    Block Release
                  </Button>
                </div>
              </div>
              {hasCriticalFailures && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <XCircle className="h-3.5 w-3.5" />
                  Approval blocked: {criticalBlockers.length} critical check(s) failing
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Mobile check reminder */}
        <Card className="border-white/[0.05] bg-white/[0.02]">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-2 text-xs text-foreground/40">
              <Smartphone className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Mobile layout check: resize browser to 375px width and verify Navbar renders without overflow before approving.</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
