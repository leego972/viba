import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListSessions, useGetStats, type AgentModeSummary } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Activity, Clock, DollarSign, Layers, Zap, RotateCcw, Wifi, WifiOff, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

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
