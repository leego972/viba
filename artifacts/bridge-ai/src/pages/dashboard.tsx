import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { OnboardingModal, useOnboarding } from "@/components/OnboardingModal";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListSessions,
  useGetStats,
  useGetCircuitStatus,
  useDeleteCircuitStatus,
  useDeleteSession,
  useListGithubRepos,
  getListSessionsQueryKey,
  getGetCircuitStatusQueryKey,
  type AgentModeSummary,
  type CircuitBreakerEntry,
  type CircuitStatusResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Plus, Activity, Clock, DollarSign, Layers, Zap, RotateCcw,
  WifiOff, AlertTriangle, TrendingDown, Search, Trash2,
  ShieldCheck, ShieldAlert, ShieldOff, RefreshCw, DatabaseZap,
  Bell, Mail, Webhook, Settings2, HelpCircle, User, ExternalLink,
  Brain, ChevronRight, GitBranch, Github, Lock, CheckCircle2, FileText,
  LayoutDashboard, Plug, CreditCard, Settings, Terminal, Wrench,
  Rocket, Server, Globe, FolderInput, BarChart3, BrainCircuit,
  History, Wallet, BookOpen, FolderOpen,
} from "lucide-react";
import { format, subDays } from "date-fns";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { OrchestrationCanvas } from "@/components/orchestration/OrchestrationCanvas";
import { ProviderNetwork } from "@/components/viba-command/ProviderNetwork";
import { SavingsMeter } from "@/components/viba-command/SavingsMeter";
import { MissionCard } from "@/components/viba-command/MissionCard";
import { buildDemoViewModel } from "@/lib/orchestrationViewModel";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ───────────────────────────────────────────────────────────────────

const STATUS_FILTERS = ["all", "active", "completed", "stopped", "paused", "pending"] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

interface OpsSummaryData {
  ok?: boolean;
  targets?: { healthy: number; failing: number; paused: number; unknown: number };
  openIncidents?: { critical: number; high: number; medium: number; low: number; total: number };
  lastCheckAt?: string | null;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ProductionOpsMini() {
  const [data, setData] = useState<OpsSummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(`${BASE}/api/production-ops/summary`)
      .then((r) => r.json())
      .then((d: OpsSummaryData) => { if (active) setData(d); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) return <p className="text-[11px] text-white/30">Loading…</p>;
  if (!data?.ok) return <p className="text-[11px] text-white/30">No targets yet</p>;

  const criticalCount = data.openIncidents?.critical ?? 0;
  const failing = data.targets?.failing ?? 0;
  const healthy = data.targets?.healthy ?? 0;

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-white/40">Healthy</span>
        <span className="font-medium text-emerald-400">{healthy}</span>
      </div>
      <div className="flex justify-between text-[10px]">
        <span className="text-white/40">Failing</span>
        <span className={`font-medium ${failing > 0 ? "text-red-400" : "text-white/30"}`}>{failing}</span>
      </div>
      <div className="flex justify-between text-[10px]">
        <span className="text-white/40">Incidents</span>
        <span className={`font-medium ${(data.openIncidents?.total ?? 0) > 0 ? "text-orange-400" : "text-white/30"}`}>{data.openIncidents?.total ?? 0}</span>
      </div>
      {criticalCount > 0 && (
        <div className="rounded bg-red-500/10 border border-red-500/20 px-2 py-1 text-[9px] text-red-400 font-medium">
          {criticalCount} critical — release blocked
        </div>
      )}
    </div>
  );
}

function shortRepoName(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "").replace(/\.git$/, "");
  } catch {
    return url;
  }
}

const ENV_BADGE_STYLES: Record<string, string> = {
  production: "bg-red-500/10 text-red-400 border-red-500/30",
  staging: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  development: "bg-blue-500/10 text-blue-400 border-blue-500/30",
};

function formatMsRemaining(ms: number | null): string {
  if (ms === null || ms <= 0) return "now";
  const secs = Math.ceil(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return remainSecs > 0 ? `${mins}m ${remainSecs}s` : `${mins}m`;
}

function formatTimeAgo(ms: number | null): string {
  if (ms === null) return "never";
  const age = Date.now() - ms;
  if (age < 2000) return "just now";
  const secs = Math.floor(age / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function CircuitStateBadge({ state }: { state: CircuitBreakerEntry["state"] }) {
  if (state === "open") {
    return (
      <Badge variant="outline" className="gap-1 text-xs border-red-500/40 text-red-400 bg-red-500/10">
        <ShieldOff className="h-3 w-3" /> Open
      </Badge>
    );
  }
  if (state === "half-open") {
    return (
      <Badge variant="outline" className="gap-1 text-xs border-amber-500/40 text-amber-400 bg-amber-500/10">
        <ShieldAlert className="h-3 w-3" /> Half-open
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-xs border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
      <ShieldCheck className="h-3 w-3" /> Closed
    </Badge>
  );
}

function getSessionMode(agentModes: AgentModeSummary[]): "live" | "simulation" | "mixed" | "unknown" {
  if (!agentModes.length) return "unknown";
  const hasMock = agentModes.some(a => a.isMock);
  const hasLive = agentModes.some(a => !a.isMock);
  if (hasMock && hasLive) return "mixed";
  if (hasMock) return "simulation";
  if (hasLive) return "live";
  return "unknown";
}

function SessionModeBadge({ agentModes }: { agentModes: AgentModeSummary[] }) {
  const mode = getSessionMode(agentModes);
  if (mode === "live") {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
      </Badge>
    );
  }
  if (mode === "mixed") {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] border-amber-500/40 text-amber-400 bg-amber-500/10">
        Mixed
      </Badge>
    );
  }
  if (mode === "simulation") {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] border-blue-500/40 text-blue-400 bg-blue-500/10">
        Simulation
      </Badge>
    );
  }
  return null;
}

function buildTrendData(trend: { day: string; count: number }[]) {
  return trend.map((d) => ({
    day: format(new Date(d.day), "MMM d"),
    count: d.count,
  }));
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: sessions, isLoading, isError } = useListSessions();
  const { data: stats } = useGetStats();
  const { data: circuitData, dataUpdatedAt: circuitUpdatedAt } = useGetCircuitStatus({
    query: { queryKey: getGetCircuitStatusQueryKey(), refetchInterval: 10_000 },
  });
  const { data: githubRepos } = useListGithubRepos({ query: { retry: false } as never });
  const circuitEntries: CircuitBreakerEntry[] = circuitData?.entries ?? [];
  const circuitLastLoadedAt: CircuitStatusResponse["lastLoadedAt"] = circuitData?.lastLoadedAt ?? null;
  const circuitRestoredCount: number = circuitData?.restoredCount ?? 0;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { show: showOnboarding, dismiss: dismissOnboarding } = useOnboarding();
  const [providerStatus, setProviderStatus] = useState<{
    groqReady: boolean;
    hasOtherProviders: boolean;
  } | null>(null);

  const checkProviders = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/providers`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json() as { providers: { id: string; status: string }[] };
      const configured = data.providers.filter(p => p.status === "configured");
      setProviderStatus({
        groqReady: configured.some(p => p.id === "groq"),
        hasOtherProviders: configured.some(p => p.id !== "groq"),
      });
    } catch {
      setProviderStatus({ groqReady: false, hasOtherProviders: false });
    }
  }, []);

  useEffect(() => { void checkProviders(); }, [checkProviders]);

  const [search, setSearch] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [resettingProvider, setResettingProvider] = useState<string | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<{ id: number; goal?: string | null } | null>(null);
  const [showAllSessions, setShowAllSessions] = useState(false);

  const deleteCircuit = useDeleteCircuitStatus({
    mutation: {
      onSuccess: (_data, { provider }) => {
        queryClient.invalidateQueries({ queryKey: getGetCircuitStatusQueryKey() });
        toast({ title: "Circuit reset", description: `${provider} circuit breaker cleared.` });
        setResettingProvider(null);
      },
      onError: (_err, { provider }) => {
        toast({ title: "Reset failed", description: `Could not reset ${provider}.`, variant: "destructive" });
        setResettingProvider(null);
      },
    },
  });

  const handleResetCircuit = (provider: string) => {
    setResettingProvider(provider);
    deleteCircuit.mutate({ provider });
  };

  const deleteSession = useDeleteSession({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        toast({ title: "Session deleted" });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to delete session.", variant: "destructive" });
      },
    },
  });

  const filteredSessions = (sessions ?? []).filter(s => {
    const q = search.toLowerCase().trim();
    const matchesSearch = q === "" ||
      (s.goal?.toLowerCase().includes(q) ?? false) ||
      (s.repoUrl ? shortRepoName(s.repoUrl).toLowerCase().includes(q) : false);
    const matchesStatus = statusFilter === "all" || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Derived stats
  const hasFallbacks = (stats?.fallbackEvents ?? 0) > 0;
  const fallbacksByProvider = stats?.fallbacksByProvider ?? [];
  const spikeProviders = stats?.spikeProviders ?? [];
  const recentSpikeProviders = stats?.recentSpikeProviders ?? [];
  const recentSpikeThreshold = stats?.recentSpikeThreshold ?? 5;
  const alertEnabled = stats?.alertEnabled ?? true;
  const trendData = buildTrendData(stats?.fallbackTrend ?? []);
  const hasTrendData = (stats?.fallbackTrend ?? []).length > 0;
  const modelUsage = stats?.modelUsage ?? [];
  const modelUsageBreakdown = stats?.modelUsageBreakdown ?? [];
  const lastSpikeNotification = stats?.lastSpikeNotification ?? null;
  const breakdownByProvider = modelUsageBreakdown.reduce<
    Record<string, { live: Array<{ model: string; count: number }>; simulated: Array<{ model: string; count: number }> }>
  >((acc, row) => {
    if (!acc[row.provider]) acc[row.provider] = { live: [], simulated: [] };
    acc[row.provider][row.mode].push({ model: row.model, count: row.count });
    return acc;
  }, {});

  const hasOpenCircuits = circuitEntries.some(e => e.state === "open");
  const hasHalfOpenCircuits = circuitEntries.some(e => e.state === "half-open");
  const hasAnyAlert = alertEnabled && (recentSpikeProviders.length > 0 || spikeProviders.length > 0);

  const totalCost = (sessions ?? []).reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0);
  const totalSessions = stats?.totalSessions ?? 0;
  const avgCostPerSession = totalSessions > 0 ? totalCost / totalSessions : 0;
  const activeSessions = (sessions ?? []).filter(s => s.status === "active");
  const pendingApprovals = (sessions ?? []).filter(s => s.status === "paused").length;
  const openCircuits = circuitEntries.filter(e => e.state === "open").length;

  const systemStatus = hasOpenCircuits || hasAnyAlert
    ? "error"
    : hasHalfOpenCircuits
    ? "warning"
    : "healthy";

  // Demo orchestration model (replaces with live session data when one is active)
  const demoVm = buildDemoViewModel();
  const recentSessions = (sessions ?? []).slice(0, 8);

  // ─── Sidebar nav items ─────────────────────────────────────────────────────
  const sidebarNav = [
    { href: "/sessions/new",   icon: Plus,           label: "New Session",       accent: true },
    { href: "/sessions",       icon: FolderOpen,     label: "All Sessions" },
    { href: "/connections",    icon: Plug,            label: "API Connections" },
    { href: "/doctor",         icon: Wrench,          label: "Project Doctor" },
    { href: "/production-ops", icon: Activity,        label: "Production Ops" },
    { href: "/workbench",      icon: Terminal,        label: "Workbench" },
    { href: "/settings",       icon: Settings2,       label: "Settings" },
  ];

  return (
    <AppLayout variant="command">
      {showOnboarding && <OnboardingModal onClose={dismissOnboarding} />}

      {/* ── Three-zone command layout ── */}
      <div className="flex overflow-hidden" style={{ height: "calc(100vh - 60px)" }}>

        {/* ══════════ LEFT SIDEBAR ══════════ */}
        <aside className="hidden lg:flex w-52 xl:w-60 shrink-0 flex-col border-r border-white/[0.05] bg-[#0a0b0f] overflow-y-auto">
          <div className="flex flex-col gap-6 p-4 flex-1">

            {/* System status pill */}
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[10px] font-semibold border ${
              systemStatus === "error"
                ? "border-red-500/30 bg-red-500/10 text-red-400"
                : systemStatus === "warning"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-emerald-500/20 bg-emerald-500/8 text-emerald-400"
            }`}>
              {systemStatus === "error" ? <ShieldOff className="h-3 w-3 shrink-0" /> :
               systemStatus === "warning" ? <ShieldAlert className="h-3 w-3 shrink-0" /> :
               <ShieldCheck className="h-3 w-3 shrink-0" />}
              <span className="uppercase tracking-widest">
                {systemStatus === "error" ? "Issues" : systemStatus === "warning" ? "Warning" : "All Clear"}
              </span>
              {(activeSessions.length > 0) && (
                <span className="ml-auto flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {activeSessions.length}
                </span>
              )}
            </div>

            {/* Navigation */}
            <nav className="space-y-0.5">
              {sidebarNav.map(({ href, icon: Icon, label, accent }) => (
                <Link key={href} href={href}>
                  <div className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[11px] font-medium cursor-pointer transition-all ${
                    accent
                      ? "bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15"
                      : "text-white/50 hover:text-white/90 hover:bg-white/[0.04]"
                  }`}>
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    {label}
                  </div>
                </Link>
              ))}
            </nav>

            {/* Provider health */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[9px] font-bold uppercase tracking-widest text-white/30">Provider Network</span>
                <span className="ml-auto text-[9px] text-white/20">10s</span>
              </div>
              <ProviderNetwork
                entries={circuitEntries}
                onReset={handleResetCircuit}
                resetting={resettingProvider}
              />
              {circuitEntries.length === 0 && (
                <div className="text-[10px] text-white/30 text-center py-2">
                  No circuit events yet
                </div>
              )}
            </div>

            {/* Production Ops mini */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-bold uppercase tracking-widest text-white/30">Production Ops</span>
                <Link href="/production-ops">
                  <ChevronRight className="h-3 w-3 text-white/20 hover:text-white/50 transition-colors" />
                </Link>
              </div>
              <ProductionOpsMini />
            </div>

            {/* Cost summary */}
            <div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-white/30 block mb-2">Usage</span>
              <div className="space-y-1.5 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-white/40">Total spend</span>
                  <span className="font-mono font-medium text-white/70">${totalCost.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Sessions</span>
                  <span className="font-medium text-white/70">{totalSessions}</span>
                </div>
                {totalSessions > 0 && (
                  <div className="flex justify-between">
                    <span className="text-white/40">Avg cost</span>
                    <span className="font-mono font-medium text-white/70">${avgCostPerSession.toFixed(4)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* GitHub repos compact */}
            {githubRepos && githubRepos.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Github className="h-3 w-3 text-white/30" />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-white/30">Repos</span>
                  <span className="ml-auto text-[9px] text-white/20">{githubRepos.length}</span>
                </div>
                <div className="space-y-1">
                  {githubRepos.slice(0, 4).map(r => {
                    const params = new URLSearchParams();
                    if (r.htmlUrl) params.set("repo", r.htmlUrl);
                    if (r.defaultBranch) params.set("branch", r.defaultBranch);
                    return (
                      <Link key={r.htmlUrl} href={`/sessions/new?${params.toString()}`}>
                        <div className="flex items-center gap-1.5 rounded px-2 py-1.5 text-[10px] text-white/40 hover:text-white/70 hover:bg-white/[0.03] cursor-pointer transition-colors">
                          <GitBranch className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{shortRepoName(r.htmlUrl ?? "")}</span>
                          {r.private && <Lock className="h-2 w-2 shrink-0 opacity-40" />}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Account links */}
            <div className="mt-auto space-y-1">
              <Link href="/settings">
                <div className="flex items-center gap-2 rounded px-2 py-1.5 text-[10px] text-white/30 hover:text-white/60 cursor-pointer transition-colors">
                  <Settings2 className="h-3 w-3" /> API Key Settings
                </div>
              </Link>
              <Link href="/workbench">
                <div className="flex items-center gap-2 rounded px-2 py-1.5 text-[10px] text-white/30 hover:text-white/60 cursor-pointer transition-colors">
                  <Brain className="h-3 w-3" /> Workbench
                </div>
              </Link>
              <a href="https://viba.guru" target="_blank" rel="noopener noreferrer">
                <div className="flex items-center gap-2 rounded px-2 py-1.5 text-[10px] text-white/30 hover:text-white/60 cursor-pointer transition-colors">
                  <ExternalLink className="h-3 w-3" /> Help & Docs
                </div>
              </a>
            </div>
          </div>
        </aside>

        {/* ══════════ CENTER: MAIN CANVAS + SESSIONS ══════════ */}
        <main className="flex-1 flex flex-col overflow-y-auto min-w-0">

          {/* ── Top stats strip ── */}
          <div className="shrink-0 border-b border-white/[0.05] bg-[#0d0e14] px-4 py-3">
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <div className="text-[9px] text-white/30 uppercase tracking-widest">System</div>
                <div className={`text-sm font-bold ${systemStatus === "error" ? "text-red-400" : systemStatus === "warning" ? "text-amber-400" : "text-emerald-400"}`}>
                  {systemStatus === "error" ? "Issues" : systemStatus === "warning" ? "Warning" : "Ready"}
                </div>
              </div>
              <div className="h-8 w-px bg-white/[0.06]" />
              <div>
                <div className="text-[9px] text-white/30 uppercase tracking-widest">Active</div>
                <div className={`text-sm font-bold ${activeSessions.length > 0 ? "text-blue-400" : "text-white/40"}`}>
                  {activeSessions.length}
                </div>
              </div>
              <div className="h-8 w-px bg-white/[0.06]" />
              <div>
                <div className="text-[9px] text-white/30 uppercase tracking-widest">Sessions</div>
                <div className="text-sm font-bold text-white/70">{totalSessions}</div>
              </div>
              <div className="h-8 w-px bg-white/[0.06]" />
              <div>
                <div className="text-[9px] text-white/30 uppercase tracking-widest">Circuits</div>
                <div className={`text-sm font-bold ${openCircuits > 0 ? "text-red-400" : "text-emerald-400"}`}>
                  {openCircuits > 0 ? `${openCircuits} open` : "Clear"}
                </div>
              </div>
              {pendingApprovals > 0 && (
                <>
                  <div className="h-8 w-px bg-white/[0.06]" />
                  <div>
                    <div className="text-[9px] text-white/30 uppercase tracking-widest">Approvals</div>
                    <div className="text-sm font-bold text-amber-400">{pendingApprovals}</div>
                  </div>
                </>
              )}
              <div className="ml-auto">
                <Link href="/sessions/new">
                  <Button size="sm" className="gap-1.5 h-7 text-xs">
                    <Plus className="h-3 w-3" />
                    New Session
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* ── Alerts ── */}
          {alertEnabled && recentSpikeProviders.length > 0 && (
            <div className="mx-4 mt-3 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
              <span>
                <strong>Spike alert:</strong>{" "}
                {recentSpikeProviders.join(", ")} hit {recentSpikeThreshold}+ fallbacks in the last hour.{" "}
                <Link href="/settings" className="underline">Check API keys.</Link>
              </span>
            </div>
          )}

          {/* ── Orchestration Canvas ── */}
          <div className="mx-4 mt-4 rounded-2xl border border-white/[0.06] bg-[#0a0b11] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.05]">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-violet-500 animate-pulse" />
                <span className="text-[10px] font-semibold text-white/60 uppercase tracking-widest">
                  {activeSessions.length > 0 ? "Live Orchestration" : "Orchestration Preview"}
                </span>
              </div>
              {activeSessions.length > 0 ? (
                <Link href={`/sessions/${activeSessions[0].id}`}>
                  <span className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-1 transition-colors">
                    Open workspace <ChevronRight className="h-3 w-3" />
                  </span>
                </Link>
              ) : (
                <Link href="/sessions/new">
                  <span className="text-[10px] text-white/30 hover:text-white/60 flex items-center gap-1 transition-colors">
                    Start a session <ChevronRight className="h-3 w-3" />
                  </span>
                </Link>
              )}
            </div>
            <OrchestrationCanvas vm={demoVm} height={280} />
          </div>

          {/* ── Sessions list ── */}
          <div className="mx-4 mt-4 mb-4 flex-1">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-white/80">Missions</h2>
              <span className="text-[10px] text-white/30">{(sessions ?? []).length} total</span>
              {(sessions ?? []).length > 0 && (
                <div className="ml-auto flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-white/30 pointer-events-none" />
                    <Input
                      placeholder="Search…"
                      className="pl-7 h-6 text-[11px] w-36 bg-white/[0.03] border-white/[0.08] text-white/70"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-1">
                    {(["all", "active", "completed"] as StatusFilter[]).map(f => (
                      <button
                        key={f}
                        type="button"
                        className={`h-6 px-2 rounded text-[9px] font-semibold capitalize transition-all ${
                          statusFilter === f
                            ? "bg-primary/15 border border-primary/30 text-primary"
                            : "text-white/30 hover:text-white/60"
                        }`}
                        onClick={() => setStatusFilter(f)}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-xl bg-white/[0.03]" />
                ))}
              </div>
            ) : isError ? (
              <div className="text-center py-8 text-red-400 text-xs border border-red-500/20 rounded-xl bg-red-500/5">
                Failed to load sessions. Is the API server running?
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="text-center py-12 rounded-2xl border border-dashed border-white/[0.08]">
                {search || statusFilter !== "all" ? (
                  <p className="text-xs text-white/30">No sessions match your filter.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="h-12 w-12 mx-auto rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                      <Activity className="h-6 w-6 text-primary/60" />
                    </div>
                    <p className="text-sm font-medium text-white/60">No sessions yet</p>
                    <p className="text-xs text-white/30">Start your first AI orchestration session</p>
                    <Link href="/sessions/new">
                      <Button size="sm" className="gap-1.5 mt-2">
                        <Plus className="h-3.5 w-3.5" /> Run First Session
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredSessions
                  .slice(0, showAllSessions ? undefined : 8)
                  .map((session, i) => (
                    <div key={session.id} className="group relative">
                      <MissionCard
                        id={session.id}
                        goal={session.goal}
                        status={session.status}
                        estimatedCost={session.estimatedCost}
                        agentModes={session.agentModes ?? []}
                        createdAt={session.createdAt}
                        index={i}
                      />
                      <button
                        type="button"
                        className="absolute right-8 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded text-white/20 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                        title="Delete session"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSessionToDelete({ id: session.id, goal: session.goal });
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                {filteredSessions.length > 8 && !showAllSessions && (
                  <button
                    type="button"
                    className="w-full py-2 text-[11px] text-white/30 hover:text-white/60 transition-colors"
                    onClick={() => setShowAllSessions(true)}
                  >
                    Show {filteredSessions.length - 8} more sessions…
                  </button>
                )}
              </div>
            )}
          </div>
        </main>

        {/* ══════════ RIGHT PANEL ══════════ */}
        <aside className="hidden xl:flex w-72 shrink-0 flex-col border-l border-white/[0.05] bg-[#0a0b0f] overflow-y-auto">
          <div className="flex flex-col gap-5 p-4">

            {/* Command summary */}
            <div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-white/30 block mb-3">Command Summary</span>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Active", value: activeSessions.length, color: activeSessions.length > 0 ? "#3b82f6" : undefined, sub: "running now" },
                  { label: "Approvals", value: pendingApprovals, color: pendingApprovals > 0 ? "#f59e0b" : undefined, sub: "waiting" },
                  { label: "Circuits", value: openCircuits, color: openCircuits > 0 ? "#ef4444" : "#22c55e", sub: openCircuits > 0 ? "open" : "all clear" },
                  { label: "Sessions", value: totalSessions, color: undefined, sub: "total" },
                ].map(({ label, value, color, sub }) => (
                  <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="text-[9px] text-white/30 uppercase tracking-widest">{label}</div>
                    <div className="text-xl font-bold mt-0.5" style={{ color: color ?? "rgba(255,255,255,0.7)" }}>{value}</div>
                    <div className="text-[9px] text-white/30 mt-0.5">{sub}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Savings meter */}
            <div>
              <SavingsMeter
                vibaActual={totalCost}
                premiumEstimate={totalCost * 5.2}
                isEstimate={true}
              />
            </div>

            {/* Active session quick-link */}
            {activeSessions.length > 0 && (
              <div>
                <span className="text-[9px] font-bold uppercase tracking-widest text-white/30 block mb-2">Active Mission</span>
                {activeSessions.slice(0, 3).map(s => (
                  <Link key={s.id} href={`/sessions/${s.id}`}>
                    <motion.div
                      className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 mb-2 cursor-pointer hover:bg-blue-500/10 transition-colors"
                      animate={{ borderColor: ["rgba(59,130,246,0.3)", "rgba(59,130,246,0.5)", "rgba(59,130,246,0.3)"] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                        <span className="text-[10px] font-semibold text-blue-400">Running</span>
                      </div>
                      <p className="text-[11px] text-white/70 line-clamp-2">{s.goal ?? `Session #${s.id}`}</p>
                      <div className="mt-1.5 flex items-center gap-1 text-[9px] text-blue-400/60">
                        <span>Open workspace</span>
                        <ChevronRight className="h-3 w-3" />
                      </div>
                    </motion.div>
                  </Link>
                ))}
              </div>
            )}

            {/* Provider health detail */}
            {circuitEntries.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-white/30">Provider Health</span>
                  {circuitLastLoadedAt && (
                    <span className="text-[9px] text-white/20 flex items-center gap-1">
                      <DatabaseZap className="h-2.5 w-2.5" />
                      DB
                    </span>
                  )}
                </div>
                <div className="space-y-1.5">
                  {circuitEntries.map(entry => (
                    <div key={entry.provider} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[10px] ${
                      entry.state === "open" ? "border-red-500/30 bg-red-500/5" :
                      entry.state === "half-open" ? "border-amber-500/30 bg-amber-500/5" :
                      "border-white/[0.05] bg-white/[0.02]"
                    }`}>
                      <CircuitStateBadge state={entry.state} />
                      <span className="flex-1 capitalize text-white/60 font-medium truncate">{entry.provider}</span>
                      {entry.state === "open" && (
                        <button
                          type="button"
                          className="shrink-0"
                          onClick={() => handleResetCircuit(entry.provider)}
                          disabled={resettingProvider === entry.provider}
                        >
                          <RefreshCw className={`h-3 w-3 text-white/30 hover:text-white/70 ${resettingProvider === entry.provider ? "animate-spin" : ""}`} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Fallback alerts */}
            {hasFallbacks && fallbacksByProvider.length > 0 && (
              <div>
                <span className="text-[9px] font-bold uppercase tracking-widest text-white/30 block mb-2">Fallbacks by Provider</span>
                <div className="space-y-1">
                  {fallbacksByProvider.map(({ provider, count }) => (
                    <div key={provider} className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-[10px]">
                      <WifiOff className="h-3 w-3 text-amber-400 shrink-0" />
                      <span className="capitalize text-white/60 flex-1">{provider}</span>
                      <span className="text-amber-400 font-medium">{count}×</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            <div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-white/30 block mb-2">Recommendations</span>
              <div className="space-y-1.5">
                {[
                  ...(providerStatus?.groqReady && !providerStatus.hasOtherProviders ? [
                    { icon: Zap, text: "Add a second provider to enable multi-agent collaboration", color: "#6366f1", href: "/connections" },
                  ] : []),
                  ...(hasOpenCircuits ? [
                    { icon: RefreshCw, text: "Reset open circuit breakers to restore live API calls", color: "#ef4444", href: "#" },
                  ] : []),
                  ...(activeSessions.length > 0 ? [
                    { icon: Activity, text: "Active session running — check workspace for progress", color: "#22c55e", href: `/sessions/${activeSessions[0].id}` },
                  ] : []),
                  { icon: TrendingDown, text: "Use Groq for classification tasks — 5× cheaper than GPT-4", color: "#10b981", href: "/connections" },
                  { icon: Brain, text: "Enable economy mode to reduce costs by up to 80%", color: "#8b5cf6", href: "/sessions/new" },
                ].slice(0, 4).map(({ icon: Icon, text, color, href }, i) => (
                  <Link key={i} href={href}>
                    <div className="flex items-start gap-2 rounded-lg border border-white/[0.04] bg-white/[0.02] px-2.5 py-2 cursor-pointer hover:border-white/[0.08] transition-colors group">
                      <Icon className="h-3 w-3 mt-0.5 shrink-0" style={{ color }} />
                      <p className="text-[10px] text-white/50 group-hover:text-white/70 transition-colors leading-snug">{text}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Last spike notification */}
            {lastSpikeNotification && (
              <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Bell className="h-3 w-3 text-sky-400" />
                  <span className="text-[10px] font-semibold text-sky-400">Last Alert</span>
                  <span className="ml-auto text-[9px] text-sky-400/50">
                    {formatTimeAgo(lastSpikeNotification.sentAt ?? null)}
                  </span>
                </div>
                <p className="text-[10px] text-sky-400/70">
                  Providers: <span className="font-medium text-sky-300">{lastSpikeNotification.providers?.join(", ")}</span>
                </p>
              </div>
            )}

            {/* Model usage compact */}
            {modelUsageBreakdown.length > 0 && (
              <div>
                <span className="text-[9px] font-bold uppercase tracking-widest text-white/30 block mb-2">Model Usage</span>
                <div className="space-y-1">
                  {Object.entries(breakdownByProvider).map(([provider, { live, simulated }]) => (
                    <div key={provider}>
                      <div className="text-[9px] text-white/30 uppercase mb-1">{provider}</div>
                      <div className="flex flex-wrap gap-1">
                        {live.map(({ model, count }) => (
                          <span key={model} className="text-[8px] rounded px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">{model}: {count} live</span>
                        ))}
                        {simulated.map(({ model, count }) => (
                          <span key={model} className="text-[8px] rounded px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-400">{model}: {count} sim</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </aside>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!sessionToDelete} onOpenChange={(open) => { if (!open) setSessionToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session?</AlertDialogTitle>
            <AlertDialogDescription>
              {sessionToDelete?.goal
                ? <><span className="font-medium text-foreground">"{sessionToDelete.goal}"</span> will be permanently deleted. This cannot be undone.</>
                : "This session will be permanently deleted. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSessionToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (sessionToDelete) {
                  deleteSession.mutate({ id: sessionToDelete.id });
                  setSessionToDelete(null);
                }
              }}
            >
              Delete session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
