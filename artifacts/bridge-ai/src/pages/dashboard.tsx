import { useState } from "react";
import { Link } from "wouter";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Plus, Activity, Clock, DollarSign, Layers, Zap, RotateCcw,
  Wifi, WifiOff, AlertTriangle, TrendingDown, Search, Trash2,
  ShieldCheck, ShieldAlert, ShieldOff, RefreshCw, DatabaseZap,
  Bell, Mail, Webhook, Settings2, HelpCircle, User, ExternalLink,
  Brain, ChevronRight, GitBranch, Github, Lock,
} from "lucide-react";
import { format, subDays } from "date-fns";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { useToast } from "@/hooks/use-toast";

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
        <ShieldOff className="h-3 w-3" />
        Open
      </Badge>
    );
  }
  if (state === "half-open") {
    return (
      <Badge variant="outline" className="gap-1 text-xs border-amber-500/40 text-amber-400 bg-amber-500/10">
        <ShieldAlert className="h-3 w-3" />
        Half-open
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-xs border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
      <ShieldCheck className="h-3 w-3" />
      Closed
    </Badge>
  );
}

function ProviderHealthPanel({
  entries,
  onReset,
  resetting,
}: {
  entries: CircuitBreakerEntry[];
  onReset: (provider: string) => void;
  resetting: string | null;
}) {
  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No providers have triggered the circuit breaker yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry) => (
        <div
          key={entry.provider}
          className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 ${
            entry.state === "open"
              ? "border-red-500/30 bg-red-500/5"
              : entry.state === "half-open"
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-emerald-500/20 bg-emerald-500/5"
          }`}
        >
          <span className="text-sm font-medium capitalize flex-1 min-w-[80px]">
            {entry.provider}
          </span>
          <CircuitStateBadge state={entry.state} />
          <span className="text-xs text-muted-foreground">
            {entry.consecutiveFailures} failure{entry.consecutiveFailures !== 1 ? "s" : ""}
          </span>
          <span className="text-xs text-muted-foreground/70" title="Circuit breaker thresholds">
            Opens after {entry.openThreshold} failure{entry.openThreshold !== 1 ? "s" : ""} · {formatMsRemaining(entry.timeoutMs)} cooldown
          </span>
          {entry.state === "open" && entry.msUntilReset !== null && (
            <span className="text-xs text-red-400/80">
              resets in {formatMsRemaining(entry.msUntilReset)}
            </span>
          )}
          {entry.state === "half-open" && (
            <span className="text-xs text-amber-400/80">
              probe next call
            </span>
          )}
          {entry.persistedAt !== null && entry.persistedAt !== undefined && (
            <span className="text-xs text-muted-foreground/60" title="Last synced to database">
              synced {formatTimeAgo(entry.persistedAt)}
            </span>
          )}
          {(entry.state === "open" || entry.state === "half-open") && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs gap-1 border-muted-foreground/30 hover:border-emerald-500/50 hover:text-emerald-400 hover:bg-emerald-500/10"
              disabled={resetting === entry.provider}
              onClick={() => onReset(entry.provider)}
            >
              {resetting === entry.provider ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3" />
              )}
              Reset
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function getSessionMode(agentModes: AgentModeSummary[]): "live" | "simulation" | "mixed" | "unknown" {
  if (agentModes.length === 0) return "unknown";
  const liveCount = agentModes.filter((a) => !a.isMock).length;
  if (liveCount === agentModes.length) return "live";
  if (liveCount === 0) return "simulation";
  return "mixed";
}

function SessionModeBadge({ agentModes }: { agentModes: AgentModeSummary[] }) {
  const mode = getSessionMode(agentModes);
  if (mode === "unknown") return null;
  if (mode === "live") {
    return (
      <Badge variant="outline" className="gap-1 text-xs border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
        <Wifi className="h-3 w-3" />
        Live
      </Badge>
    );
  }
  if (mode === "simulation") {
    return (
      <Badge variant="outline" className="gap-1 text-xs border-slate-500/40 text-slate-400 bg-slate-500/10">
        <WifiOff className="h-3 w-3" />
        Simulation
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-xs border-amber-500/40 text-amber-400 bg-amber-500/10">
      <Wifi className="h-3 w-3" />
      Mixed
    </Badge>
  );
}

function buildTrendData(trend: { day: string; count: number }[]) {
  const today = new Date();
  return Array.from({ length: 14 }, (_, i) => {
    const d = subDays(today, 13 - i);
    const dayStr = d.toISOString().slice(0, 10);
    const found = trend.find(t => t.day.startsWith(dayStr));
    return { day: format(d, "MMM d"), count: found?.count ?? 0 };
  });
}

const STATUS_FILTERS = ["all", "active", "completed", "stopped", "paused"] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

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

  const [search, setSearch] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [resettingProvider, setResettingProvider] = useState<string | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<{ id: number; goal?: string | null } | null>(null);

  const deleteCircuit = useDeleteCircuitStatus({
    mutation: {
      onSuccess: (_data, { provider }) => {
        queryClient.invalidateQueries({ queryKey: getGetCircuitStatusQueryKey() });
        toast({ title: "Circuit reset", description: `${provider} circuit breaker cleared — live calls will resume.` });
        setResettingProvider(null);
      },
      onError: (_err, { provider }) => {
        toast({ title: "Reset failed", description: `Could not reset ${provider}. Try again.`, variant: "destructive" });
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

  const getStatusColor = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "active": return "default";
      case "completed": return "secondary";
      case "stopped": return "destructive";
      case "paused": return "outline";
      case "pending": return "outline";
      default: return "outline";
    }
  };

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

  // System health derived values
  const hasOpenCircuits = circuitEntries.some(e => e.state === "open");
  const hasHalfOpenCircuits = circuitEntries.some(e => e.state === "half-open");
  const hasAnyAlert = alertEnabled && (recentSpikeProviders.length > 0 || spikeProviders.length > 0);

  // Cost summary
  const totalCost = (sessions ?? []).reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0);
  const totalSessions = stats?.totalSessions ?? 0;
  const avgCostPerSession = totalSessions > 0 ? totalCost / totalSessions : 0;

  // Recent activity: latest 5 sessions
  const recentSessions = (sessions ?? []).slice(0, 5);

  const systemStatus = hasOpenCircuits || hasAnyAlert
    ? "error"
    : hasHalfOpenCircuits
    ? "warning"
    : "healthy";

  return (
    <AppLayout>
      <div className="flex flex-col space-y-6">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">Your operational control center</p>
          </div>
          <Link href="/sessions/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Session
            </Button>
          </Link>
        </div>

        {/* ── System status bar ── */}
        <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-5 py-3 ${
          systemStatus === "error"
            ? "border-red-500/30 bg-red-500/5"
            : systemStatus === "warning"
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-emerald-500/20 bg-emerald-500/5"
        }`}>
          <div className="flex items-center gap-2 shrink-0">
            {systemStatus === "error" ? (
              <ShieldOff className="h-4 w-4 text-red-400 shrink-0" />
            ) : systemStatus === "warning" ? (
              <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
            ) : (
              <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
            )}
            <span className={`text-sm font-semibold ${
              systemStatus === "error" ? "text-red-300" :
              systemStatus === "warning" ? "text-amber-300" :
              "text-emerald-300"
            }`}>
              {systemStatus === "error" ? "Issues detected" :
               systemStatus === "warning" ? "Monitoring providers" :
               "All systems operational"}
            </span>
          </div>
          <div className="hidden sm:block h-4 w-px bg-border" />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Layers className="h-3.5 w-3.5" />
            <span>{totalSessions} session{totalSessions !== 1 ? "s" : ""}</span>
          </div>
          {(stats?.activeSessions ?? 0) > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
              <Zap className="h-3.5 w-3.5" />
              <span>{stats?.activeSessions} active now</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5" />
            <span>${totalCost.toFixed(4)} total spend</span>
          </div>
          <Link href="/settings" className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Settings2 className="h-3.5 w-3.5" />
            Configure APIs
          </Link>
        </div>

        {/* ── Quick links ── */}
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/sessions/new">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
              <Plus className="h-3 w-3" /> New Session
            </Button>
          </Link>
          <Link href="/workbench">
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground">
              <Brain className="h-3 w-3" /> Workbench
            </Button>
          </Link>
          <Link href="/settings">
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground">
              <Settings2 className="h-3 w-3" /> Settings
            </Button>
          </Link>
          <a href="https://viba.guru" target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground">
              <HelpCircle className="h-3 w-3" /> Help
            </Button>
          </a>
        </div>

        {/* ── GitHub Repos ── */}
        {githubRepos && githubRepos.length > 0 && (() => {
          const visibleRepos = githubRepos.filter(r =>
            !repoSearch.trim() || r.fullName?.toLowerCase().includes(repoSearch.toLowerCase())
          );
          return (
            <div>
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Github className="h-4 w-4 text-muted-foreground" />
                  Your Repositories
                </h2>
                <span className="text-[11px] text-muted-foreground">{githubRepos.length} connected</span>
                <div className="relative ml-auto w-48">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Filter repos…"
                    className="pl-8 h-7 text-xs"
                    value={repoSearch}
                    onChange={e => setRepoSearch(e.target.value)}
                  />
                </div>
              </div>
              {visibleRepos.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No repos match your search.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleRepos.map((repo) => {
                    const params = new URLSearchParams();
                    if (repo.htmlUrl) params.set("repo", repo.htmlUrl);
                    if (repo.defaultBranch) params.set("branch", repo.defaultBranch);
                    const href = `/sessions/new?${params.toString()}`;
                    return (
                      <div
                        key={repo.htmlUrl}
                        className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3 hover:border-primary/40 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2 min-w-0">
                          <a
                            href={repo.htmlUrl ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="flex items-center gap-1.5 min-w-0 hover:text-primary transition-colors"
                          >
                            <Github className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium truncate">{repo.fullName}</span>
                          </a>
                          {repo.private && (
                            <Lock className="h-3 w-3 text-muted-foreground/60 shrink-0 mt-0.5" />
                          )}
                        </div>
                        {repo.defaultBranch && (
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
                            <GitBranch className="h-3 w-3 shrink-0" />
                            <span className="font-mono truncate">{repo.defaultBranch}</span>
                          </div>
                        )}
                        <Link href={href}>
                          <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1.5 mt-1">
                            <Plus className="h-3 w-3" />
                            Start session
                          </Button>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Spike alerts ── */}
        {alertEnabled && recentSpikeProviders.length > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <TrendingDown className="h-5 w-5 shrink-0 mt-0.5 text-red-400" />
            <div className="flex-1">
              <p className="font-semibold text-red-300 mb-1">Fallback spike alert</p>
              <p className="text-red-300/80">
                {recentSpikeProviders.length === 1
                  ? `The ${recentSpikeProviders[0]} provider`
                  : `Providers ${recentSpikeProviders.join(", ")}`}{" "}
                {recentSpikeProviders.length === 1 ? "has" : "have"} hit {recentSpikeThreshold}+ fallbacks in the last hour.
                Live API calls are failing — check your API keys in{" "}
                <Link href="/settings" className="underline underline-offset-2 hover:text-red-200">
                  Settings
                </Link>
                .
              </p>
            </div>
          </div>
        )}
        {alertEnabled && recentSpikeProviders.length === 0 && spikeProviders.length > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            <TrendingDown className="h-5 w-5 shrink-0 mt-0.5 text-amber-400" />
            <div className="flex-1">
              <p className="font-semibold text-amber-300 mb-1">High fallback rate detected</p>
              <p className="text-amber-300/80">
                {spikeProviders.length === 1
                  ? `The ${spikeProviders[0]} provider`
                  : `Providers ${spikeProviders.join(", ")}`}{" "}
                {spikeProviders.length === 1 ? "has" : "have"} triggered 3 or more simulation fallbacks.
                Live API calls are failing — check your API keys in{" "}
                <Link href="/settings" className="underline underline-offset-2 hover:text-amber-200">
                  Settings
                </Link>
                .
              </p>
            </div>
          </div>
        )}

        {/* ── Stats row ── */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          {[
            {
              label: "Total Sessions",
              value: stats?.totalSessions ?? "—",
              icon: Layers,
              desc: "All sessions created",
            },
            {
              label: "Active Now",
              value: stats?.activeSessions ?? "—",
              icon: Zap,
              desc: "Currently running",
              highlight: (stats?.activeSessions ?? 0) > 0,
            },
            {
              label: "API Fallbacks",
              value: stats?.fallbackEvents ?? "—",
              icon: RotateCcw,
              desc: "Live calls fell back to simulation",
              warn: (stats?.fallbackEvents ?? 0) > 0,
            },
          ].map(({ label, value, icon: Icon, desc, highlight, warn }) => (
            <Card
              key={label}
              className={
                highlight
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : warn && value !== "—" && Number(value) > 0
                    ? "border-amber-500/30 bg-amber-500/5"
                    : ""
              }
            >
              <CardContent className="pt-5 pb-4 flex items-center gap-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                  highlight ? "bg-emerald-500/10 border-emerald-500/20" :
                  warn && Number(value) > 0 ? "bg-amber-500/10 border-amber-500/20" :
                  "bg-muted border-border"
                }`}>
                  <Icon className={`h-5 w-5 ${
                    highlight ? "text-emerald-400" :
                    warn && Number(value) > 0 ? "text-amber-400" :
                    "text-muted-foreground"
                  }`} />
                </div>
                <div>
                  <div className="text-2xl font-bold leading-none">{value}</div>
                  <div className="text-xs font-medium mt-1">{label}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{desc}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Two-column layout: main content + sidebar ── */}
        <div className="grid gap-6 lg:grid-cols-3">

          {/* Main column */}
          <div className="lg:col-span-2 space-y-6">

            {/* Recent activity */}
            {recentSessions.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="h-4 w-4 text-primary" />
                    Recent Activity
                    <span className="ml-auto text-[11px] font-normal text-muted-foreground">Latest {recentSessions.length} sessions</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-col divide-y divide-border">
                    {recentSessions.map(session => (
                      <Link href={`/sessions/${session.id}`} key={session.id}>
                        <div className="flex items-center gap-3 py-2.5 hover:bg-muted/30 -mx-2 px-2 rounded transition-colors group">
                          <Badge variant={getStatusColor(session.status)} className="capitalize shrink-0 text-[10px] h-5 px-1.5">
                            {session.status}
                          </Badge>
                          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                            <span className="text-sm font-medium truncate">{session.goal || "Untitled Session"}</span>
                            {(session.repoUrl || session.workspaceEnv) && (
                              <div className="flex items-center gap-1.5">
                                {session.repoUrl && (
                                  <span className="text-[10px] text-muted-foreground/70 font-mono flex items-center gap-0.5 truncate max-w-[160px]">
                                    <GitBranch className="h-2.5 w-2.5 shrink-0" />
                                    {shortRepoName(session.repoUrl)}
                                  </span>
                                )}
                                {session.workspaceEnv && (
                                  <Badge variant="outline" className={`text-[9px] h-3.5 px-1 shrink-0 ${ENV_BADGE_STYLES[session.workspaceEnv] ?? "bg-muted/30 text-muted-foreground border-border/50"}`}>
                                    {session.workspaceEnv}
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0 font-mono tabular-nums">
                            ${session.estimatedCost?.toFixed(4) || "0.0000"}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                            {format(new Date(session.createdAt), "MMM d, h:mm a")}
                          </span>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </Link>
                    ))}
                  </div>
                  {sessions && sessions.length > 5 && (
                    <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t">
                      Showing 5 of {sessions.length} sessions — scroll down to browse all.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Empty state — shown when loaded but no sessions exist */}
            {!isLoading && !isError && (sessions ?? []).length === 0 && (
              <Card>
                <CardContent className="pt-10 pb-10 flex flex-col items-center gap-3 text-center">
                  <div className="h-10 w-10 rounded-xl border bg-muted flex items-center justify-center">
                    <Activity className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">No sessions yet</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Start your first session to orchestrate AI agents</p>
                  </div>
                  <Link href="/sessions/new">
                    <Button size="sm" className="mt-1 gap-1.5">
                      <Plus className="h-3.5 w-3.5" /> Start First Session
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )}

            {/* Provider Health */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  Provider Health
                  {circuitLastLoadedAt !== null && (
                    <Badge
                      variant="outline"
                      className="gap-1 text-[10px] font-normal border-sky-500/40 text-sky-400 bg-sky-500/10"
                      title={`Circuit state loaded from database at ${format(new Date(circuitLastLoadedAt), "HH:mm:ss")} — ${circuitRestoredCount} circuit${circuitRestoredCount !== 1 ? "s" : ""} restored`}
                    >
                      <DatabaseZap className="h-3 w-3" />
                      {circuitRestoredCount > 0
                        ? `Restored ${circuitRestoredCount} from DB`
                        : "Loaded from DB"}
                    </Badge>
                  )}
                  <span className="ml-auto text-[11px] font-normal text-muted-foreground flex items-center gap-1">
                    <RefreshCw className="h-3 w-3" />
                    {circuitUpdatedAt
                      ? `Updated ${format(new Date(circuitUpdatedAt), "HH:mm:ss")}`
                      : "Auto-refreshes every 10s"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ProviderHealthPanel
                  entries={circuitEntries}
                  onReset={handleResetCircuit}
                  resetting={resettingProvider}
                />
                {circuitLastLoadedAt !== null && (
                  <p className="text-[11px] text-sky-400/70 mt-2">
                    State loaded from database at startup ·{" "}
                    {circuitRestoredCount > 0
                      ? `${circuitRestoredCount} circuit${circuitRestoredCount !== 1 ? "s" : ""} restored`
                      : "no circuits were persisted"}{" "}
                    · {format(new Date(circuitLastLoadedAt), "HH:mm:ss")}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground mt-3">
                  <span className="font-medium text-red-400">Open</span> — provider is blocked (cooldown active).{" "}
                  <span className="font-medium text-amber-400">Half-open</span> — cooldown elapsed, next call is a probe.{" "}
                  <span className="font-medium text-emerald-400">Closed</span> — provider is healthy.
                </p>
              </CardContent>
            </Card>

            {/* Per-provider fallback breakdown */}
            {hasFallbacks && fallbacksByProvider.length > 0 && (
              <Card className="border-amber-500/30 bg-amber-500/5">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-amber-400">
                    <AlertTriangle className="h-4 w-4" />
                    Fallbacks by Provider
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-3">
                    {fallbacksByProvider.map(({ provider, count }) => (
                      <div
                        key={provider}
                        className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2"
                      >
                        <WifiOff className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <span className="text-sm font-medium capitalize">{provider}</span>
                        <Badge variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/10 text-xs px-1.5 py-0 h-5">
                          {count} {count === 1 ? "fallback" : "fallbacks"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-3">
                    These providers had live API calls fail and fall back to simulation. Check your API keys in{" "}
                    <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
                      Settings
                    </Link>
                    .
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Fallback trend chart */}
            {hasTrendData && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <RotateCcw className="h-4 w-4 text-amber-400" />
                    Fallback Trend — Last 14 Days
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={trendData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="fallbackGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                        axisLine={false}
                        interval={3}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "6px",
                          fontSize: "12px",
                        }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                        itemStyle={{ color: "#f59e0b" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        name="Fallbacks"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        fill="url(#fallbackGrad)"
                        dot={false}
                        activeDot={{ r: 4, fill: "#f59e0b" }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Model usage */}
            {modelUsageBreakdown.length > 0 ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Zap className="h-4 w-4 text-emerald-400" />
                    Model Usage
                    <span className="ml-auto text-[11px] font-normal text-muted-foreground flex items-center gap-3">
                      <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />Live</span>
                      <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-400" />Simulated</span>
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-4">
                  {Object.entries(breakdownByProvider).map(([provider, { live, simulated }]) => (
                    <div key={provider}>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{provider}</p>
                      <div className="flex flex-wrap gap-2">
                        {live.map(({ model, count }) => (
                          <div key={`${model}-live`} className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5">
                            <span className="text-xs font-mono">{model}</span>
                            <Badge variant="secondary" className="text-[10px] px-1.5 h-4 bg-emerald-500/20 text-emerald-300 border-0">{count} live</Badge>
                          </div>
                        ))}
                        {simulated.map(({ model, count }) => (
                          <div key={`${model}-sim`} className="flex items-center gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-1.5">
                            <span className="text-xs font-mono">{model}</span>
                            <Badge variant="secondary" className="text-[10px] px-1.5 h-4 bg-amber-400/20 text-amber-300 border-0">{count} sim</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : modelUsage.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Zap className="h-4 w-4 text-emerald-400" />
                    Model Usage
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-2">
                    {modelUsage.map(({ model, count, liveCount, simulatedCount }) => (
                      <div key={model} className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5">
                        <span className="text-xs font-mono">{model}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 h-4">{count} msg{count !== 1 ? "s" : ""}</Badge>
                        {liveCount > 0 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 h-4 border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
                            {liveCount} live
                          </Badge>
                        )}
                        {simulatedCount > 0 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 h-4 border-amber-500/40 text-amber-400 bg-amber-500/10">
                            {simulatedCount} sim
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

          </div>

          {/* Sidebar */}
          <div className="space-y-6">

            {/* Account / Plan card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <User className="h-4 w-4" />
                  Account
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Plan</p>
                  <p className="text-sm font-semibold mt-0.5">BYOK — Self-hosted</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                    No subscription required. Connect your own API keys to run live sessions.
                  </p>
                </div>
                <Link href="/settings">
                  <Button variant="outline" size="sm" className="w-full gap-2 mt-1">
                    <Settings2 className="h-3.5 w-3.5" />
                    API Key Settings
                  </Button>
                </Link>
                <Link href="/workbench">
                  <Button variant="ghost" size="sm" className="w-full gap-2 justify-start text-muted-foreground hover:text-foreground">
                    <Brain className="h-3.5 w-3.5" />
                    Open Workbench
                  </Button>
                </Link>
                <a href="https://viba.guru" target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost" size="sm" className="w-full gap-2 justify-start text-muted-foreground hover:text-foreground">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Help &amp; Documentation
                  </Button>
                </a>
              </CardContent>
            </Card>

            {/* Cost summary */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <DollarSign className="h-4 w-4" />
                  Usage &amp; Cost
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div>
                  <p className="text-2xl font-bold tabular-nums">${totalCost.toFixed(4)}</p>
                  <p className="text-[11px] text-muted-foreground">Total estimated spend across all sessions</p>
                </div>
                {totalSessions > 0 && (
                  <div className="rounded-lg border bg-muted/20 px-3 py-2 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Avg per session</span>
                    <span className="text-xs font-mono font-medium tabular-nums">${avgCostPerSession.toFixed(4)}</span>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Based on token counts from live API calls. Simulated calls cost $0.
                </p>
              </CardContent>
            </Card>

            {/* Last alert notification */}
            {lastSpikeNotification && (
              <Card className="border-sky-500/20 bg-sky-500/5">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm text-sky-300">
                    <Bell className="h-4 w-4" />
                    Last Alert
                    <span className="ml-auto text-[11px] font-normal text-sky-400/70">
                      {formatTimeAgo(lastSpikeNotification.sentAt ?? null)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {lastSpikeNotification.channels?.includes("webhook") && (
                      <Badge variant="outline" className="gap-1 text-xs border-sky-500/40 text-sky-300 bg-sky-500/10">
                        <Webhook className="h-3 w-3" />
                        Webhook
                      </Badge>
                    )}
                    {lastSpikeNotification.channels?.includes("email") && (
                      <Badge variant="outline" className="gap-1 text-xs border-sky-500/40 text-sky-300 bg-sky-500/10">
                        <Mail className="h-3 w-3" />
                        Email
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-sky-400/70">
                    Providers:{" "}
                    <span className="font-medium text-sky-300">
                      {lastSpikeNotification.providers?.join(", ")}
                    </span>
                    {(lastSpikeNotification.emailAddresses?.length ?? 0) > 0 && (
                      <> · {lastSpikeNotification.emailAddresses?.join(", ")}</>
                    )}
                  </p>
                  <p className="text-[11px] text-sky-400/50">
                    {lastSpikeNotification.sentAt ? format(new Date(lastSpikeNotification.sentAt), "MMM d, HH:mm:ss") : "—"} · Resets on server restart
                  </p>
                </CardContent>
              </Card>
            )}

          </div>
        </div>

        {/* ── Full sessions list ── */}
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <Card key={i}>
                <CardHeader className="gap-2">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-4 w-full" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-10 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : isError ? (
          <div className="text-center py-12 rounded-lg border border-destructive bg-destructive/10">
            <p className="text-destructive font-medium">Failed to load sessions. Is the server running?</p>
          </div>
        ) : !sessions || sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center animate-in fade-in-50">
            <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
                <Activity className="h-10 w-10 text-muted-foreground" />
              </div>
              <h2 className="mt-6 text-xl font-semibold">No sessions yet</h2>
              <p className="mb-8 mt-2 text-center text-sm font-normal leading-6 text-muted-foreground">
                Start by creating a new session and assigning agents to collaborate on your goal.
              </p>
              <Link href="/sessions/new">
                <Button>Start a Session</Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">All Sessions</h2>
              <p className="text-sm text-muted-foreground">Browse, search, and manage all your collaboration sessions.</p>
            </div>
            {/* Search + filter bar */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search by goal or repo…"
                  className="pl-9"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {STATUS_FILTERS.map(f => (
                  <Button
                    key={f}
                    size="sm"
                    variant={statusFilter === f ? "default" : "outline"}
                    className="capitalize h-9"
                    onClick={() => setStatusFilter(f)}
                  >
                    {f}
                    {f !== "all" && (
                      <span className="ml-1.5 text-[10px] opacity-70">
                        {(sessions ?? []).filter(s => s.status === f).length}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            </div>

            {filteredSessions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No sessions match your search.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredSessions.map((session) => {
                  const isActive = session.status === "active";
                  const isCompleted = session.status === "completed";
                  return (
                  <Link key={session.id} href={`/sessions/${session.id}`}>
                    <div className={`group relative flex flex-col h-full rounded-2xl border bg-card transition-all duration-200 cursor-pointer overflow-hidden
                      hover:shadow-xl hover:shadow-primary/[0.07]
                      ${isActive
                        ? "border-primary/30 hover:border-primary/50 shadow-[0_0_18px_rgba(99,102,241,0.10)]"
                        : "border-border/60 hover:border-border"
                      }`}
                    >
                      {/* Active indicator — indigo left bar */}
                      {isActive && (
                        <div className="absolute left-0 top-4 bottom-4 w-[3px] rounded-full bg-gradient-to-b from-primary/80 via-primary/60 to-primary/30" />
                      )}
                      {/* Subtle top highlight */}
                      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

                      <div className="pl-5 pr-4 pt-4 pb-3">
                        {/* Status row */}
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border capitalize
                              ${isActive ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" :
                                isCompleted ? "bg-blue-500/10 border-blue-500/30 text-blue-400" :
                                session.status === "stopped" ? "bg-red-500/10 border-red-500/30 text-red-400" :
                                "bg-muted/30 border-border/50 text-muted-foreground"}`}
                            >
                              {isActive && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                              {session.status}
                            </span>
                            <SessionModeBadge agentModes={session.agentModes} />
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[10px] font-medium border border-border/40 bg-muted/20 rounded-full px-2 py-0.5 text-muted-foreground">
                              {session.autonomyMode}
                            </span>
                            <button
                              className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title="Delete session"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSessionToDelete({ id: session.id, goal: session.goal }); }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>

                        {/* Goal */}
                        <p className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-foreground/90 mb-3">
                          {session.goal || "Untitled Session"}
                        </p>

                        {/* Repo badge */}
                        {session.repoUrl && (
                          <div className="flex items-center gap-1.5 flex-wrap mb-3">
                            <a
                              href={session.repoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center gap-1 rounded-lg border border-border/50 bg-muted/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground max-w-full hover:border-primary/30 hover:text-foreground transition-colors"
                            >
                              <Github className="h-3 w-3 shrink-0" />
                              <span className="truncate max-w-[160px]">{shortRepoName(session.repoUrl)}</span>
                              {session.repoBranch && <span className="opacity-50">:{session.repoBranch}</span>}
                            </a>
                            {session.workspaceEnv && (
                              <span className={`text-[10px] border rounded-lg px-2 py-0.5 ${ENV_BADGE_STYLES[session.workspaceEnv] ?? "bg-muted/30 text-muted-foreground border-border/50"}`}>
                                {session.workspaceEnv}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Meta row */}
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {format(new Date(session.createdAt), "MMM d, h:mm a")}
                          </span>
                          <span className="flex items-center gap-1">
                            <DollarSign className="h-3 w-3" />
                            ${session.estimatedCost?.toFixed(4) || "0.0000"}
                          </span>
                        </div>
                      </div>

                      {/* Footer CTA */}
                      <div className="mt-auto px-5 pb-4 pt-2 border-t border-border/30">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-primary/70 group-hover:text-primary transition-colors">
                          Open Workspace
                          <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </div>
                    </div>
                  </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

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
