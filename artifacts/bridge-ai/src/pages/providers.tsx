import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Cpu, CheckCircle2, XCircle, MinusCircle, Zap, Save, RefreshCw, AlertTriangle, Key, Globe, Eye, EyeOff, Info,
} from "lucide-react";

interface ProviderInfo {
  id: string;
  label: string;
  description: string;
  hasKey: boolean;
  enabled: boolean;
  model: string;
  endpoint?: string;
  hasEndpoint: boolean;
  defaultModel: string;
  modelOptions: string[];
  status: "not_configured" | "configured" | "disabled";
}

interface ProviderLocalState {
  enabled: boolean;
  model: string;
  endpoint: string;
  keyInput: string;
  showKey: boolean;
  saving: boolean;
  testing: boolean;
  testResult: string | null;
  testOk: boolean | null;
  dirty: boolean;
}

function statusBadge(status: ProviderInfo["status"]) {
  if (status === "configured") {
    return (
      <Badge className="gap-1 bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">
        <CheckCircle2 className="h-3 w-3" /> Configured
      </Badge>
    );
  }
  if (status === "disabled") {
    return (
      <Badge className="gap-1 bg-zinc-500/15 text-zinc-400 border-zinc-500/30 hover:bg-zinc-500/15">
        <MinusCircle className="h-3 w-3" /> Disabled
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/15">
      <XCircle className="h-3 w-3" /> Not configured
    </Badge>
  );
}

export default function ProvidersPage() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [localState, setLocalState] = useState<Record<string, ProviderLocalState>>({});

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/providers", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { providers: ProviderInfo[] };
      setProviders(data.providers);
      setLocalState((prev) => {
        const next: Record<string, ProviderLocalState> = {};
        for (const p of data.providers) {
          next[p.id] = prev[p.id] ?? {
            enabled: p.enabled,
            model: p.model,
            endpoint: p.endpoint ?? "",
            keyInput: "",
            showKey: false,
            saving: false,
            testing: false,
            testResult: null,
            testOk: null,
            dirty: false,
          };
        }
        return next;
      });
    } catch {
      toast({ title: "Failed to load providers", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void fetchProviders(); }, [fetchProviders]);

  function updateLocal(id: string, patch: Partial<ProviderLocalState>) {
    setLocalState((prev) => ({
      ...prev,
      [id]: { ...prev[id]!, ...patch, dirty: true },
    }));
  }

  async function save(provider: ProviderInfo) {
    const ls = localState[provider.id];
    if (!ls) return;
    setLocalState((prev) => ({ ...prev, [provider.id]: { ...prev[provider.id]!, saving: true } }));
    try {
      const body: Record<string, unknown> = {
        enabled: ls.enabled,
        model: ls.model,
      };
      if (provider.hasEndpoint) body["endpoint"] = ls.endpoint;
      if (ls.keyInput.trim()) body["key"] = ls.keyInput.trim();

      const res = await fetch(`/api/providers/${provider.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: `${provider.label} saved`, description: "Provider settings updated." });
      setLocalState((prev) => ({
        ...prev,
        [provider.id]: { ...prev[provider.id]!, keyInput: "", dirty: false, saving: false },
      }));
      await fetchProviders();
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
      setLocalState((prev) => ({ ...prev, [provider.id]: { ...prev[provider.id]!, saving: false } }));
    }
  }

  async function testConnection(provider: ProviderInfo) {
    setLocalState((prev) => ({ ...prev, [provider.id]: { ...prev[provider.id]!, testing: true, testResult: null, testOk: null } }));
    try {
      const res = await fetch(`/api/providers/${provider.id}/test`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json() as { configured?: boolean; reachable?: boolean; message?: string };
      const ok = !!(data.configured);
      setLocalState((prev) => ({
        ...prev,
        [provider.id]: { ...prev[provider.id]!, testing: false, testResult: data.message ?? "Unknown result", testOk: ok },
      }));
    } catch {
      setLocalState((prev) => ({
        ...prev,
        [provider.id]: { ...prev[provider.id]!, testing: false, testResult: "Connection test failed", testOk: false },
      }));
    }
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Cpu className="h-4.5 w-4.5 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">AI Providers</h1>
          </div>
          <p className="text-sm text-muted-foreground pl-12">
            Configure API keys, models, and connection settings for each provider.
          </p>
        </div>

        {/* Warning banner */}
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-200/80">
            <span className="font-medium text-amber-300">Live provider execution is off by default.</span>{" "}
            Enabling a provider here makes it available for sessions to select — it does not automatically execute paid calls.
            Each session still requires explicit budget approval before any live provider is invoked.
          </p>
        </div>

        {/* Provider cards */}
        <div className="grid grid-cols-1 gap-5">
          {providers.map((provider) => {
            const ls = localState[provider.id];
            if (!ls) return null;
            return (
              <Card key={provider.id} className="border-white/[0.08] bg-white/[0.03] backdrop-blur-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <CardTitle className="text-base font-medium flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span>{provider.label}</span>
                        {statusBadge(provider.status)}
                      </CardTitle>
                      <CardDescription className="text-xs">{provider.description}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{ls.enabled ? "Enabled" : "Disabled"}</span>
                      <Switch
                        checked={ls.enabled}
                        onCheckedChange={(v) => updateLocal(provider.id, { enabled: v })}
                      />
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* API Key field */}
                  {provider.hasKey !== undefined && provider.id !== "local" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium flex items-center gap-1.5">
                        <Key className="h-3 w-3" />
                        API Key
                        {provider.hasKey && (
                          <span className="text-emerald-400 text-[11px] font-normal">● Configured</span>
                        )}
                      </Label>
                      <div className="relative">
                        <Input
                          type={ls.showKey ? "text" : "password"}
                          placeholder={provider.hasKey ? "Enter new key to replace (leave blank to keep current)" : "Paste your API key…"}
                          value={ls.keyInput}
                          onChange={(e) => updateLocal(provider.id, { keyInput: e.target.value })}
                          className="pr-9 font-mono text-xs bg-background/50"
                        />
                        <button
                          type="button"
                          onClick={() => updateLocal(provider.id, { showKey: !ls.showKey })}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {ls.showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Model selection */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Model</Label>
                    {provider.modelOptions.length > 0 ? (
                      <Select value={ls.model} onValueChange={(v) => updateLocal(provider.id, { model: v })}>
                        <SelectTrigger className="h-9 text-xs bg-background/50">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {provider.modelOptions.map((m) => (
                            <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        placeholder={provider.defaultModel || "e.g. llama3, mistral"}
                        value={ls.model}
                        onChange={(e) => updateLocal(provider.id, { model: e.target.value })}
                        className="h-9 text-xs bg-background/50"
                      />
                    )}
                  </div>

                  {/* Endpoint (local/custom providers) */}
                  {provider.hasEndpoint && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium flex items-center gap-1.5">
                        <Globe className="h-3 w-3" />
                        Endpoint URL
                      </Label>
                      <Input
                        placeholder={provider.id === "local" ? "http://localhost:11434" : "https://your-provider.example.com/v1"}
                        value={ls.endpoint}
                        onChange={(e) => updateLocal(provider.id, { endpoint: e.target.value })}
                        className="h-9 text-xs font-mono bg-background/50"
                      />
                      {provider.id === "local" && (
                        <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/6 px-2.5 py-2">
                          <Info className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />
                          <p className="text-[11px] text-blue-300/80 leading-relaxed">
                            This URL is tested from the <strong className="text-blue-300/95">VIBA server</strong>, not your browser. To use Ollama on your own machine, expose it with a tunnel (e.g.{" "}
                            <code className="bg-blue-500/15 px-1 rounded">cloudflared tunnel</code>) and paste the public URL here.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Test result */}
                  {ls.testResult && (
                    <div className={`rounded-lg px-3 py-2 text-xs border ${
                      ls.testOk
                        ? "bg-emerald-500/8 border-emerald-500/25 text-emerald-300"
                        : "bg-red-500/8 border-red-500/25 text-red-300"
                    }`}>
                      {ls.testResult}
                    </div>
                  )}
                </CardContent>

                <CardFooter className="pt-0 flex items-center justify-between gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testConnection(provider)}
                    disabled={ls.testing}
                    className="h-8 text-xs gap-1.5"
                  >
                    {ls.testing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                    Test connection
                  </Button>

                  <Button
                    size="sm"
                    onClick={() => save(provider)}
                    disabled={ls.saving || !ls.dirty}
                    className="h-8 text-xs gap-1.5"
                  >
                    {ls.saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    Save settings
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
