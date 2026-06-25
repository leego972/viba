import { useState, useCallback, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, Clock,
  RefreshCw, Plus, Pause, Play, Zap, Terminal, ClipboardCheck,
  ShieldAlert, ShieldCheck, Globe, Server, Lock, Eye, ChevronRight,
  Wifi, WifiOff, TrendingDown,
} from "lucide-react";
import { useLocation } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProductionTarget {
  id: number;
  appName: string;
  publicUrl: string;
  apiHealthUrl: string;
  status: "active" | "paused" | "failing" | "incident_open" | "healthy" | "unknown";
  strictMode: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CheckResult {
  checkType: string;
  status: "passed" | "warning" | "failed" | "blocked" | "skipped";
  severity: "low" | "medium" | "high" | "critical";
  httpStatus: number | null;
  responseTimeMs: number | null;
  error: string | null;
  evidenceJson: Record<string, unknown>;
  rawValuesReturned: false;
}

interface Incident {
  id: number;
  targetId: number;
  status: "open" | "repair_task_created" | "resolved" | "ignored";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  summary: string;
  detectedAt: string;
  resolvedAt: string | null;
  repairTaskId: number | null;
  rawValuesReturned: false;
}

interface HealthSummary {
  targetId: number;
  appName: string;
  overallStatus: "healthy" | "warning" | "failing" | "unknown";
  criticalCount: number;
  highCount: number;
  passedCount: number;
  skippedCount: number;
  releaseBlocked: boolean;
  lastCheckedAt: string;
}

interface OpsSummary {
  targets: { healthy: number; failing: number; paused: number; unknown: number };
  openIncidents: { critical: number; high: number; medium: number; low: number; total: number };
  lastCheckAt: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(s: string) {
  switch (s) {
    case "healthy": return "text-emerald-400";
    case "failing": case "incident_open": return "text-red-400";
    case "warning": return "text-yellow-400";
    case "paused": return "text-white/40";
    default: return "text-white/50";
  }
}

function statusIcon(s: string) {
  switch (s) {
    case "healthy": return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    case "failing": case "incident_open": return <XCircle className="h-4 w-4 text-red-400" />;
    case "warning": return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
    case "paused": return <Pause className="h-4 w-4 text-white/40" />;
    default: return <Clock className="h-4 w-4 text-white/40" />;
  }
}

function sevBadge(s: string) {
  switch (s) {
    case "critical": return "bg-red-500/15 text-red-400 border-red-500/30";
    case "high": return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "medium": return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "passed": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "skipped": return "bg-white/10 text-white/40 border-white/20";
    default: return "bg-white/10 text-white/40 border-white/20";
  }
}

function checkIcon(status: string) {
  switch (status) {
    case "passed": return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
    case "failed": return <XCircle className="h-3.5 w-3.5 text-red-400" />;
    case "warning": return <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />;
    default: return <Clock className="h-3.5 w-3.5 text-white/30" />;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProductionOpsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Add target form
  const [appName, setAppName] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [apiHealthUrl, setApiHealthUrl] = useState("");
  const [railwayProjectId, setRailwayProjectId] = useState("");
  const [strictMode, setStrictMode] = useState(false);
  const [addingTarget, setAddingTarget] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // Data
  const [targets, setTargets] = useState<ProductionTarget[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<number | null>(null);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [opsSummary, setOpsSummary] = useState<OpsSummary | null>(null);

  // Loading
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [checkingNow, setCheckingNow] = useState(false);
  const [repairLoading, setRepairLoading] = useState<number | null>(null);
  const [resolveLoading, setResolveLoading] = useState<number | null>(null);

  // ── Fetch targets ────────────────────────────────────────────────────────────
  const fetchTargets = useCallback(async () => {
    setLoadingTargets(true);
    try {
      const res = await fetch(`${BASE}/api/production-ops/targets`);
      const data = await res.json() as { targets?: ProductionTarget[] };
      setTargets(data.targets ?? []);
    } catch { /* silent */ }
    setLoadingTargets(false);
  }, []);

  // ── Fetch ops summary ────────────────────────────────────────────────────────
  const fetchOpsSummary = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/production-ops/summary`);
      const data = await res.json() as OpsSummary & { ok?: boolean };
      if (data.ok) setOpsSummary(data);
    } catch { /* silent */ }
  }, []);

  // ── Fetch checks + incidents for selected target ──────────────────────────
  const fetchTargetDetails = useCallback(async (id: number) => {
    try {
      const [cRes, iRes] = await Promise.all([
        fetch(`${BASE}/api/production-ops/targets/${id}/checks`),
        fetch(`${BASE}/api/production-ops/targets/${id}/incidents`),
      ]);
      const cData = await cRes.json() as { checks?: CheckResult[] };
      const iData = await iRes.json() as { incidents?: Incident[] };
      setChecks(cData.checks ?? []);
      setIncidents(iData.incidents ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchTargets();
    fetchOpsSummary();
  }, [fetchTargets, fetchOpsSummary]);

  useEffect(() => {
    if (selectedTargetId) fetchTargetDetails(selectedTargetId);
  }, [selectedTargetId, fetchTargetDetails]);

  // ── Add target ───────────────────────────────────────────────────────────────
  const handleAddTarget = useCallback(async () => {
    if (!appName || !publicUrl) { toast({ title: "appName and publicUrl are required", variant: "destructive" }); return; }
    setAddingTarget(true);
    try {
      const res = await fetch(`${BASE}/api/production-ops/targets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appName, publicUrl, apiHealthUrl, railwayProjectId: railwayProjectId || undefined, strictMode }),
      });
      const data = await res.json() as { ok?: boolean; target?: ProductionTarget; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to add target");
      toast({ title: `Target "${appName}" added` });
      setShowAddForm(false);
      setAppName(""); setPublicUrl(""); setApiHealthUrl(""); setRailwayProjectId("");
      await fetchTargets();
      await fetchOpsSummary();
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    }
    setAddingTarget(false);
  }, [appName, publicUrl, apiHealthUrl, railwayProjectId, strictMode, toast, fetchTargets, fetchOpsSummary]);

  // ── Check now ────────────────────────────────────────────────────────────────
  const handleCheckNow = useCallback(async (id: number) => {
    setCheckingNow(true);
    setSelectedTargetId(id);
    try {
      const res = await fetch(`${BASE}/api/production-ops/targets/${id}/check-now`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json() as { ok?: boolean; summary?: HealthSummary; checks?: CheckResult[]; newIncidents?: Incident[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Check failed");
      setSummary(data.summary ?? null);
      setChecks(data.checks ?? []);
      if ((data.newIncidents?.length ?? 0) > 0) {
        setIncidents((prev) => [...(data.newIncidents ?? []), ...prev]);
        toast({ title: `${data.newIncidents!.length} new incident(s) detected`, variant: "destructive" });
      } else {
        toast({ title: "Health check complete", description: data.summary?.overallStatus ?? "done" });
      }
      await fetchTargets();
      await fetchOpsSummary();
    } catch (err) {
      toast({ title: "Check failed", description: String(err), variant: "destructive" });
    }
    setCheckingNow(false);
  }, [toast, fetchTargets, fetchOpsSummary]);

  // ── Create repair task ───────────────────────────────────────────────────────
  const handleCreateRepairTask = useCallback(async (incidentId: number) => {
    setRepairLoading(incidentId);
    try {
      const res = await fetch(`${BASE}/api/production-ops/incidents/${incidentId}/create-repair-task`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json() as { ok?: boolean; taskId?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to create repair task");
      toast({ title: `Repair task #${data.taskId} created`, description: "Open Agent Console to monitor execution" });
      if (selectedTargetId) await fetchTargetDetails(selectedTargetId);
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    }
    setRepairLoading(null);
  }, [selectedTargetId, toast, fetchTargetDetails]);

  // ── Mark resolved ────────────────────────────────────────────────────────────
  const handleMarkResolved = useCallback(async (incidentId: number) => {
    setResolveLoading(incidentId);
    try {
      const res = await fetch(`${BASE}/api/production-ops/incidents/${incidentId}/mark-resolved`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast({ title: "Incident marked resolved" });
      if (selectedTargetId) await fetchTargetDetails(selectedTargetId);
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    }
    setResolveLoading(null);
  }, [selectedTargetId, toast, fetchTargetDetails]);

  const openIncidents = incidents.filter((i) => i.status === "open");

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="container max-w-5xl py-8 space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            Production Operations
          </h1>
          <p className="text-sm text-foreground/55 mt-1 max-w-2xl">
            VIBA monitors production apps in read-only mode first. Repairs, deployments, DNS changes, payment changes, and credential changes require approval and safe-build verification.
          </p>
        </div>

        {/* Section 2 — Health Summary (ops-wide) */}
        {opsSummary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3 text-center">
              <div className="text-2xl font-bold text-emerald-400">{opsSummary.targets.healthy}</div>
              <div className="text-[10px] text-foreground/40 mt-0.5">Healthy Targets</div>
            </div>
            <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] px-4 py-3 text-center">
              <div className="text-2xl font-bold text-red-400">{opsSummary.targets.failing}</div>
              <div className="text-[10px] text-foreground/40 mt-0.5">Failing Targets</div>
            </div>
            <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] px-4 py-3 text-center">
              <div className="text-2xl font-bold text-red-400">{opsSummary.openIncidents.total}</div>
              <div className="text-[10px] text-foreground/40 mt-0.5">Open Incidents</div>
            </div>
            <div className="rounded-lg border border-orange-500/20 bg-orange-500/[0.04] px-4 py-3 text-center">
              <div className="text-2xl font-bold text-orange-400">{opsSummary.openIncidents.critical}</div>
              <div className="text-[10px] text-foreground/40 mt-0.5">Critical Incidents</div>
            </div>
          </div>
        )}

        {/* Section 1 — Add target */}
        <Card className="border-white/[0.07] bg-white/[0.03]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-foreground/80 flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              Production Targets
              <Button size="sm" variant="outline" onClick={() => setShowAddForm(!showAddForm)} className="ml-auto text-xs">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Target
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {showAddForm && (
              <div className="border border-white/[0.08] rounded-lg p-4 space-y-3 bg-white/[0.02]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-foreground/40 uppercase tracking-wide">App Name</label>
                    <input className="mt-1 w-full bg-white/[0.04] border border-white/[0.08] rounded px-3 py-1.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/40" placeholder="viba.guru" value={appName} onChange={(e) => setAppName(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Public URL</label>
                    <input className="mt-1 w-full bg-white/[0.04] border border-white/[0.08] rounded px-3 py-1.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/40" placeholder="https://viba.guru" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[10px] text-foreground/40 uppercase tracking-wide">API Health URL (optional)</label>
                    <input className="mt-1 w-full bg-white/[0.04] border border-white/[0.08] rounded px-3 py-1.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/40" placeholder="https://viba.guru/api/healthz" value={apiHealthUrl} onChange={(e) => setApiHealthUrl(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[10px] text-foreground/40 uppercase tracking-wide">Railway Project ID (optional)</label>
                    <input className="mt-1 w-full bg-white/[0.04] border border-white/[0.08] rounded px-3 py-1.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/40" placeholder="proj-xxxx" value={railwayProjectId} onChange={(e) => setRailwayProjectId(e.target.value)} />
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={strictMode} onChange={(e) => setStrictMode(e.target.checked)} className="h-4 w-4 rounded" />
                    <span className="text-xs text-foreground/60">Strict Mode (all checks required)</span>
                  </label>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>Cancel</Button>
                    <Button size="sm" onClick={handleAddTarget} disabled={addingTarget}>
                      {addingTarget ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                      {addingTarget ? "Adding…" : "Add Target"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Section 3 — Target list */}
            {loadingTargets ? (
              <p className="text-xs text-foreground/40 py-2">Loading targets…</p>
            ) : targets.length === 0 ? (
              <p className="text-xs text-foreground/30 py-4 text-center">No production targets yet. Add one above.</p>
            ) : (
              <div className="space-y-1.5">
                {targets.map((t) => (
                  <div
                    key={t.id}
                    className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-all ${selectedTargetId === t.id ? "border-primary/30 bg-primary/[0.04]" : "border-white/[0.06] bg-white/[0.02] hover:border-white/20"}`}
                    onClick={() => { setSelectedTargetId(t.id); fetchTargetDetails(t.id); }}
                  >
                    {statusIcon(t.status)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{t.appName}</p>
                      <p className="text-[10px] text-foreground/40 truncate">{t.publicUrl}</p>
                    </div>
                    <span className={`text-[10px] font-medium ${statusColor(t.status)}`}>{t.status}</span>
                    <Button
                      size="sm" variant="outline"
                      onClick={(e) => { e.stopPropagation(); handleCheckNow(t.id); }}
                      disabled={checkingNow && selectedTargetId === t.id}
                    >
                      {checkingNow && selectedTargetId === t.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <RefreshCw className="h-3.5 w-3.5" />}
                      <span className="ml-1 text-xs">Check Now</span>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 4 — Latest checks */}
        {checks.length > 0 && (
          <Card className="border-white/[0.07] bg-white/[0.03]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-foreground/80 flex items-center gap-2">
                <Server className="h-4 w-4 text-primary" />
                Latest Checks
                {summary && (
                  <Badge className={`text-[10px] border ml-auto ${summary.releaseBlocked ? "bg-red-500/15 text-red-400 border-red-500/30" : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"}`}>
                    {summary.releaseBlocked ? "Release Blocked" : "Release Ready"}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {checks.slice(0, 15).map((c, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5 border-b border-white/[0.04] last:border-0">
                    {checkIcon(c.status)}
                    <span className="text-xs font-medium text-foreground/70 w-36 shrink-0">{c.checkType.replace(/_/g, " ")}</span>
                    <Badge className={`text-[10px] border ${sevBadge(c.severity)}`}>{c.severity}</Badge>
                    {c.httpStatus && <span className="text-[10px] text-foreground/40">{c.httpStatus}</span>}
                    {c.responseTimeMs && <span className="text-[10px] text-foreground/30">{c.responseTimeMs}ms</span>}
                    {c.error && <span className="text-[10px] text-red-400/70 truncate max-w-xs">{c.error}</span>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Section 5 — Open incidents */}
        {openIncidents.length > 0 && (
          <Card className="border-red-500/20 bg-red-500/[0.03]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-red-400 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4" />
                Open Incidents ({openIncidents.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {openIncidents.map((incident) => (
                <div key={incident.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
                  <div className="flex items-start gap-2 flex-wrap">
                    <Badge className={`text-[10px] border ${sevBadge(incident.severity)}`}>{incident.severity}</Badge>
                    <span className="text-sm font-medium text-foreground flex-1">{incident.title}</span>
                  </div>
                  <p className="text-xs text-foreground/50">{incident.summary}</p>
                  <div className="flex gap-2 flex-wrap">
                    {incident.repairTaskId ? (
                      <Button size="sm" variant="outline" onClick={() => navigate("/agent-console")}>
                        <Terminal className="h-3.5 w-3.5 mr-1" /> Task #{incident.repairTaskId} — View in Agent Console
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleCreateRepairTask(incident.id)}
                        disabled={repairLoading === incident.id}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs"
                      >
                        {repairLoading === incident.id
                          ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
                          : <Zap className="h-3.5 w-3.5 mr-1" />}
                        Create Repair Task
                      </Button>
                    )}
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => handleMarkResolved(incident.id)}
                      disabled={resolveLoading === incident.id}
                    >
                      {resolveLoading === incident.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      <span className="ml-1">Mark Resolved</span>
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Section 6 — Repair recommendations / resolved incidents */}
        {incidents.filter((i) => i.status !== "open").length > 0 && (
          <Card className="border-white/[0.07] bg-white/[0.03]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-foreground/80 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Resolved / In-Repair
              </CardTitle>
            </CardHeader>
            <CardContent>
              {incidents.filter((i) => i.status !== "open").map((incident) => (
                <div key={incident.id} className="flex items-center gap-3 py-2 border-b border-white/[0.04] last:border-0">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span className="text-xs text-foreground/60 flex-1">{incident.title}</span>
                  <Badge className="text-[10px] border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">{incident.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Section 7 — Actions */}
        <Card className="border-white/[0.07] bg-white/[0.03]">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap gap-3 items-center">
              <Button variant="outline" onClick={() => navigate("/agent-console")}>
                <Terminal className="h-4 w-4 mr-1" /> Agent Console
              </Button>
              <Button variant="outline" onClick={() => navigate("/qa-release-gate")}>
                <ClipboardCheck className="h-4 w-4 mr-1" /> QA Gate
              </Button>
              <Button variant="outline" onClick={() => { fetchTargets(); fetchOpsSummary(); }}>
                <RefreshCw className="h-4 w-4 mr-1" /> Refresh
              </Button>
            </div>
            <div className="mt-3 flex items-start gap-2 text-[10px] text-foreground/30">
              <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>All health checks are read-only. Repair tasks, deployments, DNS changes, and credential modifications require owner approval and safe-build verification before execution.</span>
            </div>
          </CardContent>
        </Card>

      </div>
    </AppLayout>
  );
}
