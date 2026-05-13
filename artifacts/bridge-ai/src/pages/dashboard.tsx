import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListSessions, useGetStats, type AgentModeSummary } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Activity, Clock, DollarSign, Layers, Zap, RotateCcw, Wifi, WifiOff, AlertTriangle, TrendingDown } from "lucide-react";
import { format, subDays } from "date-fns";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

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

export default function Dashboard() {
  const { data: sessions, isLoading, isError } = useListSessions();
  const { data: stats } = useGetStats();

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
  const trendData = buildTrendData(stats?.fallbackTrend ?? []);
  const hasTrendData = (stats?.fallbackTrend ?? []).length > 0;
  const modelUsage = stats?.modelUsage ?? [];

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

        {/* Spike Alert — shown when a provider has 3+ fallbacks */}
        {spikeProviders.length > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <TrendingDown className="h-5 w-5 shrink-0 mt-0.5 text-red-400" />
            <div className="flex-1">
              <p className="font-semibold text-red-300 mb-1">High fallback rate detected</p>
              <p className="text-red-300/80">
                {spikeProviders.length === 1
                  ? `The ${spikeProviders[0]} provider`
                  : `Providers ${spikeProviders.join(", ")}`}{" "}
                {spikeProviders.length === 1 ? "has" : "have"} triggered 3 or more simulation fallbacks.
                Live API calls are failing — check your API keys in{" "}
                <Link href="/settings" className="underline underline-offset-2 hover:text-red-200">
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

        {/* Model usage breakdown */}
        {modelUsage.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-4 w-4 text-emerald-400" />
                Model Usage
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-2">
                {modelUsage.map(({ model, count }) => (
                  <div key={model} className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5">
                    <span className="text-xs font-mono">{model}</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 h-4">{count} msg{count !== 1 ? "s" : ""}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

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
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {sessions.map((session) => (
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
                      <Badge variant="outline" className="text-xs font-normal">
                        {session.autonomyMode}
                      </Badge>
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
    </AppLayout>
  );
}
