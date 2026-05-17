import { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListSessions,
  useGetStats,
  useGetCircuitStatus,
  useDeleteCircuitStatus,
  useDeleteSession,
  getListSessionsQueryKey,
  getGetCircuitStatusQueryKey,
  type AgentModeSummary,
  type CircuitBreakerEntry,
  type CircuitStatusResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Plus, Activity, Clock, DollarSign, Layers, Zap, RotateCcw,
  Wifi, WifiOff, AlertTriangle, TrendingDown, Search, Trash2,
  ShieldCheck, ShieldAlert, ShieldOff, RefreshCw, DatabaseZap,
} from "lucide-react";
import { format, subDays } from "date-fns";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { useToast } from "@/hooks/use-toast";

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
  const circuitEntries: CircuitBreakerEntry[] = circuitData?.entries ?? [];
  const circuitLastLoadedAt: CircuitStatusResponse["lastLoadedAt"] = circuitData?.lastLoadedAt ?? null;
  const circuitRestoredCount: number = circuitData?.restoredCount ?? 0;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [resettingProvider, setResettingProvider] = useState<string | null>(null);

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

  const getStatusColor = (status: string) => {
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
    const matchesSearch = search.trim() === "" || s.goal?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statCards = [
    {
      label: "Total Sessions",
      value: stats?.totalSessions ?? "—",
      icon: Layers,
      desc: "All-time bridge sessions",
    },
    {
      label: "Active Now",
      value: stats?.activeSessions ?? "—",
      icon: Zap,
      desc: "Sessions currently running",
      highlight: (stats?.activeSessions ?? 0) > 0,
    },
    {
      label: "API Fallbacks",
      value: stats?.fallbackEvents ?? "—",
      icon: RotateCcw,
      desc: "Times a live call fell back to simulation",
      warn: (stats?.fallbackEvents ?? 0) > 0,
    },
  ];

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

  const breakdownByProvider = modelUsageBreakdown.reduce<
    Record<string, { live: Array<{ model: string; count: number }>; simulated: Array<{ model: string; count: number }> }>
  >((acc, row) => {
    if (!acc[row.provider]) acc[row.provider] = { live: [], simulated: [] };
    acc[row.provider][row.mode].push({ model: row.model, count: row.count });
    return acc;
  }, {});

  return (
    <AppLayout>
      <div className="flex flex-col space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">Manage your AI bridge sessions</p>
          </div>
          <Link href="/sessions/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Session
            </Button>
          </Link>
        </div>

        {/* Rolling-window spike alert */}
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

        {/* Legacy all-time spike alert */}
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

        {/* Stats row */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          {statCards.map(({ label, value, icon: Icon, desc, highlight, warn }) => (
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

        {/* Provider Health — circuit breaker status */}
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

        {/* Model usage breakdown by provider */}
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

        {/* Sessions list with search + filter */}
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
              <h2 className="mt-6 text-xl font-semibold">No sessions created</h2>
              <p className="mb-8 mt-2 text-center text-sm font-normal leading-6 text-muted-foreground">
                You haven't created any bridge sessions yet. Start by creating a new session and assigning agents.
              </p>
              <Link href="/sessions/new">
                <Button>Start a Session</Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Search + filter bar */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search sessions by goal..."
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
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {filteredSessions.map((session) => (
                  <Link key={session.id} href={`/sessions/${session.id}`}>
                    <Card className="hover-elevate cursor-pointer transition-all hover:border-primary/50 h-full flex flex-col">
                      <CardHeader className="pb-3">
                        <div className="flex flex-wrap justify-between items-start gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={getStatusColor(session.status) as any} className="capitalize">
                              {session.status}
                            </Badge>
                            <SessionModeBadge agentModes={session.agentModes} />
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="text-xs font-normal">
                              {session.autonomyMode}
                            </Badge>
                            <button
                              className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title="Delete session"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (window.confirm(`Delete "${session.goal || "this session"}"? This cannot be undone.`)) {
                                  deleteSession.mutate({ id: session.id });
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="line-clamp-2 mt-2 text-lg font-semibold">
                          {session.goal || "Untitled Session"}
                        </div>
                      </CardHeader>
                      <CardContent className="pb-3 flex-1">
                        <div className="flex flex-col space-y-2 text-sm text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            <span>{format(new Date(session.createdAt), "MMM d, yyyy h:mm a")}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <DollarSign className="h-4 w-4" />
                            <span>Est. Cost: ${session.estimatedCost?.toFixed(4) || "0.0000"}</span>
                          </div>
                        </div>
                      </CardContent>
                      <div className="px-6 pb-4 pt-0">
                        <Button variant="ghost" className="w-full text-primary hover:text-primary">
                          Open Workspace
                        </Button>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
