import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, Code2, Zap, Search, Globe, Bot, CheckCircle2, XCircle, AlertTriangle, Activity } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PROVIDERS = [
  { key: "openai", name: "ChatGPT", provider: "OpenAI", role: "Strategic Planning", icon: Brain, color: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/20" },
  { key: "anthropic", name: "Claude", provider: "Anthropic", role: "Code Review", icon: Code2, color: "text-violet-500", bg: "bg-violet-500/10 border-violet-500/20" },
  { key: "replit", name: "Replit Agent", provider: "Replit", role: "Build & Execute", icon: Zap, color: "text-blue-500", bg: "bg-blue-500/10 border-blue-500/20" },
  { key: "perplexity", name: "Perplexity", provider: "Perplexity AI", role: "Research", icon: Search, color: "text-amber-500", bg: "bg-amber-500/10 border-amber-500/20" },
  { key: "gemini", name: "Gemini", provider: "Google", role: "UX & Design", icon: Globe, color: "text-sky-500", bg: "bg-sky-500/10 border-sky-500/20" },
  { key: "manus", name: "Manus", provider: "Manus AI", role: "Autonomous Agent", icon: Bot, color: "text-pink-500", bg: "bg-pink-500/10 border-pink-500/20" },
] as const;

type ProviderStatus = "checking" | "configured" | "not_configured" | "disabled";
type ProviderInfo = { id: string; status: "not_configured" | "configured" | "disabled"; hasKey?: boolean; endpoint?: string; enabled?: boolean };

function normalizeStatus(info?: ProviderInfo): ProviderStatus {
  if (!info) return "not_configured";
  if (info.status === "disabled") return "disabled";
  if (info.status === "not_configured") return "not_configured";
  if ((info.id === "local" || info.id === "custom") && !info.endpoint) return "not_configured";
  return "configured";
}

function StatusIcon({ state }: { state: ProviderStatus }) {
  if (state === "checking") return <Activity className="h-4 w-4 animate-pulse text-muted-foreground" />;
  if (state === "configured") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (state === "disabled") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <XCircle className="h-4 w-4 text-muted-foreground" />;
}

function StatusBadge({ state }: { state: ProviderStatus }) {
  if (state === "checking") return <Badge variant="secondary">Checking</Badge>;
  if (state === "configured") return <Badge className="border border-emerald-500/30 bg-emerald-500/15 text-emerald-600">Configured</Badge>;
  if (state === "disabled") return <Badge className="border border-amber-500/30 bg-amber-500/15 text-amber-700">Disabled</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Not connected</Badge>;
}

export default function Bridge() {
  const statsQuery = useGetStats();
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({});
  const [loadingProviders, setLoadingProviders] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/providers`, { credentials: "include" })
      .then((res) => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
      .then((data: { providers?: ProviderInfo[] }) => {
        if (cancelled) return;
        setProviders(Object.fromEntries((data.providers ?? []).map((p) => [p.id, p])));
      })
      .catch(() => {
        if (!cancelled) setProviders({});
      })
      .finally(() => {
        if (!cancelled) setLoadingProviders(false);
      });
    return () => { cancelled = true; };
  }, []);

  const stats = statsQuery.data;

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-8 p-0 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Provider Connections</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real provider configuration status. Providers are only marked configured when VIBA can actually use their stored credential or endpoint.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:gap-4">
          {[
            { label: "Total Sessions", value: stats?.totalSessions ?? null },
            { label: "Fallback Events", value: stats?.fallbackEvents ?? null },
            { label: "Provider Fallbacks", value: stats?.fallbacksByProvider?.reduce((acc: number, b) => acc + b.count, 0) ?? null },
            { label: "Models Used", value: stats?.modelUsageBreakdown?.length ?? null },
          ].map(({ label, value }) => (
            <Card key={label}>
              <CardContent className="px-4 py-5">
                <p className="text-xs text-muted-foreground">{label}</p>
                {value === null ? <Skeleton className="mt-1 h-7 w-12" /> : <p className="mt-0.5 text-2xl font-bold">{value}</p>}
              </CardContent>
            </Card>
          ))}
        </div>

        <div>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Provider Status</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PROVIDERS.map(({ key, name, provider, role, icon: Icon, color, bg }) => {
              const state = loadingProviders ? "checking" : normalizeStatus(providers[key]);
              return (
                <Card key={key} className={`border ${bg} bg-card`}>
                  <CardHeader className="px-4 pb-2 pt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${bg}`}>
                          <Icon className={`h-4 w-4 ${color}`} />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="truncate text-sm font-semibold leading-none">{name}</CardTitle>
                          <p className="mt-1 truncate text-[11px] text-muted-foreground">{provider}</p>
                        </div>
                      </div>
                      <StatusIcon state={state} />
                    </div>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-3 px-4 pb-4">
                    <span className="min-w-0 text-xs text-muted-foreground">{role}</span>
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
