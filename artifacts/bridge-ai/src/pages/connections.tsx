import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Cpu, CheckCircle2, XCircle, MinusCircle, Zap, Save, RefreshCw,
  AlertTriangle, Key, Globe, Eye, EyeOff, Shield, ArrowRight, Plug,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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
  dirty: boolean;
}

function StatusBadge({ status }: { status: ProviderInfo["status"] }) {
  if (status === "configured") {
    return (
      <Badge className="gap-1 bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">
        <CheckCircle2 className="h-3 w-3" /> Connected
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
      <XCircle className="h-3 w-3" /> Not connected
    </Badge>
  );
}

function ProviderSection() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [localState, setLocalState] = useState<Record<string, ProviderLocalState>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/providers`, { credentials: "include" });
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
      const body: Record<string, unknown> = { enabled: ls.enabled, model: ls.model };
      if (provider.hasEndpoint) body["endpoint"] = ls.endpoint;
      if (ls.keyInput.trim()) body["key"] = ls.keyInput.trim();
      const res = await fetch(`${BASE}/api/providers/${provider.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: `${provider.label} saved` });
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

  const configured = providers.filter(p => p.status === "configured");
  const unconfigured = providers.filter(p => p.status !== "configured");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-24">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  function renderProvider(provider: ProviderInfo) {
    const ls = localState[provider.id];
    if (!ls) return null;
    const isExpanded = expanded[provider.id] ?? false;

    return (
      <div key={provider.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
              provider.status === "configured" ? "bg-emerald-500/15 border border-emerald-500/25" : "bg-muted/30 border border-border/50"
            }`}>
              <Cpu className={`h-4 w-4 ${provider.status === "configured" ? "text-emerald-400" : "text-muted-foreground"}`} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{provider.label}</span>
                <StatusBadge status={provider.status} />
              </div>
              <p className="text-xs text-muted-foreground truncate">{provider.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground hidden sm:inline">{ls.enabled ? "On" : "Off"}</span>
              <Switch
                checked={ls.enabled}
                onCheckedChange={(v) => updateLocal(provider.id, { enabled: v })}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded(prev => ({ ...prev, [provider.id]: !prev[provider.id] }))}
            >
              {isExpanded ? "Collapse" : (provider.status === "not_configured" ? "Connect" : "Edit")}
            </Button>
          </div>
        </div>

        {isExpanded && (
          <div className="border-t border-white/[0.06] px-4 py-4 space-y-4">
            {provider.id !== "local" && provider.hasKey !== undefined && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <Key className="h-3 w-3" />
                  API Key
                  {provider.hasKey && (
                    <span className="text-emerald-400 text-[11px] font-normal">● Saved</span>
                  )}
                </Label>
                <div className="relative">
                  <Input
                    type={ls.showKey ? "text" : "password"}
                    placeholder={provider.hasKey ? "Enter new key to replace" : "Paste your API key…"}
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
                  placeholder={provider.defaultModel || "e.g. llama3"}
                  value={ls.model}
                  onChange={(e) => updateLocal(provider.id, { model: e.target.value })}
                  className="h-9 text-xs bg-background/50"
                />
              )}
            </div>
            {provider.hasEndpoint && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <Globe className="h-3 w-3" />Endpoint URL
                </Label>
                <Input
                  placeholder={provider.id === "local" ? "http://localhost:11434" : "https://your-provider.example.com/v1"}
                  value={ls.endpoint}
                  onChange={(e) => updateLocal(provider.id, { endpoint: e.target.value })}
                  className="h-9 text-xs font-mono bg-background/50"
                />
              </div>
            )}
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => save(provider)}
                disabled={ls.saving || !ls.dirty}
                className="h-8 text-xs gap-1.5"
              >
                {ls.saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {configured.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Connected</p>
          {configured.map(renderProvider)}
        </div>
      )}
      {unconfigured.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {configured.length > 0 ? "Not connected" : "All providers"}
          </p>
          {unconfigured.map(renderProvider)}
        </div>
      )}
    </div>
  );
}

export default function ConnectionsPage() {
  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Plug className="h-4 w-4 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
          </div>
          <p className="text-sm text-muted-foreground pl-12">
            Manage AI providers, API keys, and vault credentials in one place.
          </p>
        </div>

        {/* Warning */}
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-200/80">
            <span className="font-medium text-amber-300">Live execution is off by default.</span>{" "}
            Connecting a provider makes it available for sessions — each session still requires explicit budget approval before any paid call is made.
          </p>
        </div>

        {/* AI Providers */}
        <Card className="border-white/[0.07] bg-white/[0.01]">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="h-4.5 w-4.5 text-primary" />
              AI Providers
            </CardTitle>
            <CardDescription className="text-xs">
              API keys are stored encrypted in your vault. Toggle providers on/off per session.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProviderSection />
          </CardContent>
        </Card>

        {/* Groq free callout */}
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="flex items-center gap-4 py-4">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
              <Zap className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-emerald-300">Groq is always included free</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                No API key needed. Agents default to Groq for fast inference. Add other providers to unlock GPT-4o, Claude, or Gemini.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Vault */}
        <Card className="border-white/[0.07] bg-white/[0.01]">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4.5 w-4.5 text-primary" />
              Secure Vault
            </CardTitle>
            <CardDescription className="text-xs">
              Encrypted storage for API keys, tokens, and SSH credentials. Raw values are never shown after saving.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { label: "API Keys & Tokens", desc: "Saved provider keys, custom tokens", href: "/credentials" },
                { label: "Custom AI Keys", desc: "Additional AI provider credentials", href: "/credentials" },
                { label: "Deployment Credentials", desc: "Railway, Render, GitHub tokens", href: "/credentials" },
              ].map(({ label, desc, href }) => (
                <Link key={label} href={href}>
                  <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 hover:border-white/[0.14] hover:bg-white/[0.04] transition-all cursor-pointer group">
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </Link>
              ))}
              <div className="pt-1">
                <Link href="/credentials">
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                    <Key className="h-3.5 w-3.5" />
                    Open full vault
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Security note */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            Security note
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground/70">
            <li>• All credentials encrypted at rest with AES-256-GCM</li>
            <li>• API keys are never returned to the frontend after saving</li>
            <li>• Every credential access is logged — view audit trail in the vault</li>
            <li>• Destructive actions require explicit human approval before execution</li>
          </ul>
        </div>

      </div>
    </AppLayout>
  );
}
