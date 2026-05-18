import { AppLayout } from "@/components/layout/AppLayout";
  import {
    useGetStats,
    useGetCircuitStatus,
    type CircuitBreakerEntry,
  } from "@workspace/api-client-react";
  import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
  import { Badge } from "@/components/ui/badge";
  import { Skeleton } from "@/components/ui/skeleton";
  import {
    Brain, Code2, Zap, Search, Globe, Bot,
    CheckCircle2, XCircle, AlertTriangle, Activity,
  } from "lucide-react";

  const PROVIDERS = [
    { key: "openai",     name: "ChatGPT",      provider: "OpenAI",        role: "Strategic Planning", icon: Brain,  color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
    { key: "anthropic",  name: "Claude",       provider: "Anthropic",     role: "Code Review",        icon: Code2,  color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/20"  },
    { key: "replit",     name: "Replit Agent", provider: "Replit",        role: "Build & Execute",    icon: Zap,    color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20"      },
    { key: "perplexity", name: "Perplexity",   provider: "Perplexity AI", role: "Research",           icon: Search, color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20"    },
    { key: "gemini",     name: "Gemini",       provider: "Google",        role: "UX & Design",        icon: Globe,  color: "text-sky-400",     bg: "bg-sky-500/10 border-sky-500/20"        },
    { key: "manus",      name: "Manus",        provider: "Manus AI",      role: "Autonomous Agent",   icon: Bot,    color: "text-pink-400",    bg: "bg-pink-500/10 border-pink-500/20"      },
  ] as const;

  type ProviderKey = (typeof PROVIDERS)[number]["key"];

  function circuitState(circuits: CircuitBreakerEntry[] | undefined, key: ProviderKey) {
    if (!circuits) return null;
    return circuits.find((c) => c.provider === key)?.state ?? "closed";
  }

  function StatusIcon({ state }: { state: string | null }) {
    if (state === null) return <Activity className="h-4 w-4 text-muted-foreground animate-pulse" />;
    if (state === "closed") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    if (state === "open") return <XCircle className="h-4 w-4 text-red-400" />;
    return <AlertTriangle className="h-4 w-4 text-amber-400" />;
  }

  function StatusBadge({ state }: { state: string | null }) {
    if (state === null) return <Badge variant="secondary">Checking</Badge>;
    if (state === "closed") return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 border">Live</Badge>;
    if (state === "open") return <Badge className="bg-red-500/15 text-red-400 border-red-500/30 border">Circuit Open</Badge>;
    return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 border">Half-Open</Badge>;
  }

  export default function Bridge() {
    const statsQuery = useGetStats();
    const circuitQuery = useGetCircuitStatus();

    const stats = statsQuery.data;
    const circuits = circuitQuery.data?.circuits;

    return (
      <AppLayout>
        <div className="p-6 max-w-5xl mx-auto space-y-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Bridge Connections</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Live status of all AI provider connections and circuit breakers.
            </p>
          </div>

          {/* Stats summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total Sessions", value: stats?.totalSessions ?? null },
              { label: "Total Steps", value: stats?.totalSteps ?? null },
              { label: "Provider Fallbacks", value: stats?.providerFallbackCounts?.reduce((a, b) => a + b.count, 0) ?? null },
              { label: "Models Used", value: stats?.modelUsageBreakdown?.length ?? null },
            ].map(({ label, value }) => (
              <Card key={label}>
                <CardContent className="pt-5 pb-5 px-5">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  {value === null ? (
                    <Skeleton className="h-7 w-12 mt-1" />
                  ) : (
                    <p className="text-2xl font-bold mt-0.5">{value}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Provider connection cards */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
              Provider Status
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {PROVIDERS.map(({ key, name, provider, role, icon: Icon, color, bg }) => {
                const state = circuitState(circuits, key as ProviderKey);
                return (
                  <Card key={key} className={`border ${bg} bg-card/50`}>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${bg}`}>
                            <Icon className={`h-4 w-4 ${color}`} />
                          </div>
                          <div>
                            <CardTitle className="text-sm font-semibold leading-none">{name}</CardTitle>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{provider}</p>
                          </div>
                        </div>
                        <StatusIcon state={state} />
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{role}</span>
                      <StatusBadge state={state} />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }
  