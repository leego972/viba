import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, Copy, Cpu, Eye, EyeOff, Globe, Key, Monitor, Plug, RefreshCw, Save, Shield, Trash2, Wifi, WifiOff, XCircle, Zap } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ProviderInfo {
  id: string;
  label: string;
  description: string;
  hasKey: boolean;
  acceptsKey?: boolean;
  keyRequired?: boolean;
  enabled: boolean;
  model: string;
  endpoint?: string;
  placeholderEndpoint?: string;
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

interface SavedKeyEntry { label: string; status: string; updatedAt: string; }
interface AddKeyForm { label: string; value: string; saving: boolean; open: boolean; showVal: boolean; }

function effectiveStatus(provider: ProviderInfo): ProviderInfo["status"] {
  if (provider.status === "disabled") return "disabled";
  if ((provider.id === "local" || provider.id === "custom") && !provider.endpoint?.trim()) return "not_configured";
  if (provider.keyRequired && !provider.hasKey) return "not_configured";
  return provider.status;
}

function StatusBadge({ status }: { status: ProviderInfo["status"] }) {
  if (status === "configured") {
    return <Badge className="gap-1 border border-emerald-500/30 bg-emerald-500/15 text-emerald-600"><CheckCircle2 className="h-3 w-3" />Connected</Badge>;
  }
  if (status === "disabled") {
    return <Badge variant="outline" className="gap-1 text-muted-foreground"><XCircle className="h-3 w-3" />Disabled</Badge>;
  }
  return <Badge className="gap-1 border border-amber-500/30 bg-amber-500/15 text-amber-700"><XCircle className="h-3 w-3" />Not connected</Badge>;
}

function ProviderSection() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [localState, setLocalState] = useState<Record<string, ProviderLocalState>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [keysByProvider, setKeysByProvider] = useState<Record<string, SavedKeyEntry[]>>({});
  const [addKeyForms, setAddKeyForms] = useState<Record<string, AddKeyForm>>({});

  const fetchProviderKeys = useCallback(async (providerId: string) => {
    try {
      const res = await fetch(`${BASE}/api/providers/${providerId}/keys`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json() as { keys: SavedKeyEntry[] };
      setKeysByProvider(prev => ({ ...prev, [providerId]: data.keys }));
    } catch {
      // non-fatal
    }
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/providers`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { providers: ProviderInfo[] };
      setProviders(data.providers ?? []);
      setLocalState((prev) => {
        const next: Record<string, ProviderLocalState> = {};
        for (const p of data.providers ?? []) {
          next[p.id] = prev[p.id] ?? {
            enabled: p.enabled,
            model: p.model || p.defaultModel || "",
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
    setLocalState((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch, dirty: true } }));
  }

  async function save(provider: ProviderInfo) {
    const ls = localState[provider.id];
    if (!ls) return;
    setLocalState((prev) => ({ ...prev, [provider.id]: { ...prev[provider.id]!, saving: true } }));
    try {
      const body: Record<string, unknown> = { enabled: ls.enabled, model: ls.model };
      if (provider.hasEndpoint) body.endpoint = ls.endpoint;
      if ((provider.acceptsKey ?? provider.id !== "local") && ls.keyInput.trim()) body.key = ls.keyInput.trim();
      const res = await fetch(`${BASE}/api/providers/${provider.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: `${provider.label} saved` });
      setLocalState((prev) => ({ ...prev, [provider.id]: { ...prev[provider.id]!, keyInput: "", dirty: false, saving: false } }));
      await fetchProviders();
      void fetchProviderKeys(provider.id);
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
      setLocalState((prev) => ({ ...prev, [provider.id]: { ...prev[provider.id]!, saving: false } }));
    }
  }

  async function saveNamedKey(provider: ProviderInfo) {
    const form = addKeyForms[provider.id];
    if (!form?.label.trim() || !form.value.trim()) return;
    setAddKeyForms(prev => ({ ...prev, [provider.id]: { ...prev[provider.id]!, saving: true } }));
    try {
      const res = await fetch(`${BASE}/api/providers/${provider.id}/keys`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: form.label.trim(), key: form.value.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: `Key "${form.label}" saved` });
      setAddKeyForms(prev => ({ ...prev, [provider.id]: { label: "", value: "", saving: false, open: false, showVal: false } }));
      void fetchProviderKeys(provider.id);
      void fetchProviders();
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
      setAddKeyForms(prev => ({ ...prev, [provider.id]: { ...prev[provider.id]!, saving: false } }));
    }
  }

  const displayProviders = providers.map((p) => ({ ...p, status: effectiveStatus(p) }));
  const configured = displayProviders.filter(p => p.status === "configured");
  const unconfigured = displayProviders.filter(p => p.status !== "configured");
  const groqReady = displayProviders.some(p => p.id === "groq" && p.status === "configured");

  if (loading) {
    return <div className="flex h-24 items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  function renderProvider(provider: ProviderInfo) {
    const ls = localState[provider.id];
    if (!ls) return null;
    const isExpanded = expanded[provider.id] ?? false;
    const canStoreKey = provider.acceptsKey ?? provider.id !== "local";

    return (
      <div key={provider.id} className="overflow-hidden rounded-xl border border-border/70 bg-card">
        <div className="grid gap-3 px-4 py-4 sm:flex sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${provider.status === "configured" ? "border-emerald-500/25 bg-emerald-500/12" : "border-border bg-muted/50"}`}>
              <Cpu className={`h-4 w-4 ${provider.status === "configured" ? "text-emerald-600" : "text-muted-foreground"}`} />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-words text-sm font-semibold">{provider.label}</span>
                <StatusBadge status={provider.status} />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{provider.description}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <div className="flex items-center gap-2 rounded-full border border-border bg-background px-2.5 py-1">
              <span className="text-xs text-muted-foreground">{ls.enabled ? "On" : "Off"}</span>
              <Switch checked={ls.enabled} onCheckedChange={(v) => updateLocal(provider.id, { enabled: v })} />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                const opening = !(expanded[provider.id] ?? false);
                setExpanded(prev => ({ ...prev, [provider.id]: opening }));
                if (opening) void fetchProviderKeys(provider.id);
              }}
            >
              {isExpanded ? "Collapse" : provider.status === "not_configured" ? "Connect" : "Edit"}
            </Button>
          </div>
        </div>

        {isExpanded && (
          <div className="space-y-4 border-t border-border/70 px-4 py-4">
            {provider.id === "custom" && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Add custom AI:</span> enter the provider endpoint, model name, and optional bearer key below. This is for any AI API not already listed.
              </div>
            )}

            {canStoreKey && (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs font-medium"><Key className="h-3 w-3" />Provider secret</Label>
                <div className="relative">
                  <Input
                    type={ls.showKey ? "text" : "password"}
                    placeholder={provider.hasKey ? "Enter new value to replace stored secret" : "Paste provider secret"}
                    value={ls.keyInput}
                    onChange={(e) => updateLocal(provider.id, { keyInput: e.target.value })}
                    className="pr-9 font-mono text-xs"
                  />
                  <button type="button" onClick={() => updateLocal(provider.id, { showKey: !ls.showKey })} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {ls.showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Model</Label>
                {provider.modelOptions.length > 0 ? (
                  <Select value={ls.model} onValueChange={(v) => updateLocal(provider.id, { model: v })}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{provider.modelOptions.map((m) => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input placeholder={provider.defaultModel || "e.g. llama-3.1-8b"} value={ls.model} onChange={(e) => updateLocal(provider.id, { model: e.target.value })} className="h-9 text-xs" />
                )}
              </div>

              {provider.hasEndpoint && (
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs font-medium"><Globe className="h-3 w-3" />Endpoint URL</Label>
                  <Input placeholder={provider.placeholderEndpoint || "https://provider.example.com/v1"} value={ls.endpoint} onChange={(e) => updateLocal(provider.id, { endpoint: e.target.value })} className="h-9 font-mono text-xs" />
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button size="sm" onClick={() => save(provider)} disabled={ls.saving || !ls.dirty} className="h-8 gap-1.5 text-xs">
                {ls.saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Save provider
              </Button>
            </div>

            {(keysByProvider[provider.id]?.length ?? 0) > 0 && (
              <div className="space-y-2 border-t border-border/70 pt-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Key className="h-3 w-3" />Saved accounts</p>
                {keysByProvider[provider.id]!.map((entry) => (
                  <div key={entry.label} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                    <span className="truncate text-xs font-medium">{entry.label}</span>
                    <button
                      type="button"
                      title={`Remove ${entry.label}`}
                      onClick={async () => {
                        try {
                          const res = await fetch(`${BASE}/api/providers/${provider.id}/keys/${encodeURIComponent(entry.label)}`, { method: "DELETE", credentials: "include" });
                          if (!res.ok) throw new Error(`HTTP ${res.status}`);
                          toast({ title: `Key "${entry.label}" removed` });
                          void fetchProviderKeys(provider.id);
                          void fetchProviders();
                        } catch { toast({ title: "Delete failed", variant: "destructive" }); }
                      }}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {canStoreKey && (
              <div className="border-t border-border/70 pt-3">
                {!(addKeyForms[provider.id]?.open) ? (
                  <button type="button" onClick={() => setAddKeyForms(prev => ({ ...prev, [provider.id]: { label: "", value: "", saving: false, open: true, showVal: false } }))} className="text-xs font-medium text-primary hover:underline">
                    + Add another account
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Add another stored secret</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input placeholder="Account label" value={addKeyForms[provider.id]?.label ?? ""} onChange={(e) => setAddKeyForms(prev => ({ ...prev, [provider.id]: { ...prev[provider.id]!, label: e.target.value } }))} className="h-8 text-xs" />
                      <div className="relative">
                        <Input type={addKeyForms[provider.id]?.showVal ? "text" : "password"} placeholder="Secret value" value={addKeyForms[provider.id]?.value ?? ""} onChange={(e) => setAddKeyForms(prev => ({ ...prev, [provider.id]: { ...prev[provider.id]!, value: e.target.value } }))} className="h-8 pr-8 font-mono text-xs" />
                        <button type="button" onClick={() => setAddKeyForms(prev => ({ ...prev, [provider.id]: { ...prev[provider.id]!, showVal: !prev[provider.id]!.showVal } }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {addKeyForms[provider.id]?.showVal ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAddKeyForms(prev => ({ ...prev, [provider.id]: { ...prev[provider.id]!, open: false } }))}>Cancel</Button>
                      <Button size="sm" className="h-7 gap-1 text-xs" disabled={!addKeyForms[provider.id]?.label.trim() || !addKeyForms[provider.id]?.value.trim() || addKeyForms[provider.id]?.saving} onClick={() => void saveNamedKey(provider)}>
                        {addKeyForms[provider.id]?.saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Save
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3.5">
        <p className="text-sm font-medium text-foreground">For AI collaborative work, please add your API keys.</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {groqReady ? "Groq is available for live execution. Add OpenAI, Claude, Gemini, or a custom AI provider when you want a stronger collaborative panel." : "Add a Groq key or another provider key to make live agents available."}
        </p>
      </div>
      {configured.length > 0 && <div className="space-y-2"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Connected</p>{configured.map(renderProvider)}</div>}
      {unconfigured.length > 0 && <div className="space-y-2"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Not connected</p>{unconfigured.map(renderProvider)}</div>}
    </div>
  );
}

interface BrowserStatus { configured: boolean; connected: boolean; tabs?: Array<{ index: number; url: string; title: string }>; error?: string; }

function MyBrowserSection() {
  const { toast } = useToast();
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [cdpInput, setCdpInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/user-browser/status`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus(await res.json() as BrowserStatus);
    } catch {
      setStatus({ configured: false, connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);

  async function save() {
    const url = cdpInput.trim();
    if (!url) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/user-browser/config`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cdpUrl: url }) });
      const data = await res.json().catch(() => ({})) as { error?: string; tabs?: BrowserStatus["tabs"] };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast({ title: "My Browser connected", description: `Found ${data.tabs?.length ?? 0} open tab(s).` });
      setCdpInput("");
      await fetchStatus();
    } catch (err) {
      toast({ title: "Connection failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    await fetch(`${BASE}/api/user-browser/config`, { method: "DELETE", credentials: "include" }).catch(() => undefined);
    toast({ title: "My Browser disconnected" });
    await fetchStatus();
  }

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text).then(() => toast({ title: "Copied" }));
  }

  if (loading) return <div className="flex h-16 items-center justify-center"><RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" /></div>;

  const isConnected = status?.configured && status?.connected;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:flex sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${isConnected ? "border-emerald-500/25 bg-emerald-500/12" : "border-border bg-muted/50"}`}>
            <Monitor className={`h-4 w-4 ${isConnected ? "text-emerald-600" : "text-muted-foreground"}`} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">My Browser</span>{isConnected ? <Badge className="gap-1 border border-emerald-500/30 bg-emerald-500/15 text-emerald-600"><Wifi className="h-3 w-3" />Live</Badge> : <Badge variant="outline" className="gap-1 text-muted-foreground"><WifiOff className="h-3 w-3" />Not connected</Badge>}</div>
            <p className="mt-1 text-xs text-muted-foreground">Agents can use a real browser session when connected.</p>
          </div>
        </div>
        {status?.configured && <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void disconnect()}>Disconnect</Button>}
      </div>

      {!status?.configured && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input placeholder="https://your-cloudflare-tunnel.trycloudflare.com" value={cdpInput} onChange={(e) => setCdpInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} className="h-9 font-mono text-sm" />
          <Button size="sm" onClick={save} disabled={saving || !cdpInput.trim()} className="h-9 gap-1.5">{saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Connect</Button>
        </div>
      )}

      {isConnected && status?.tabs && status.tabs.length > 0 && <div className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">{status.tabs.length} browser tab(s) available to agents.</div>}
      {status?.configured && !status.connected && status.error && <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">{status.error}</div>}

      <button type="button" onClick={() => setShowInstructions(!showInstructions)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        {showInstructions ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}{showInstructions ? "Hide" : "Show"} setup instructions
      </button>

      {showInstructions && (
        <div className="space-y-3 rounded-xl border border-border bg-background p-4 text-xs">
          {[{ label: "Chrome", cmd: "google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/viba-chrome" }, { label: "Tunnel", cmd: "cloudflared tunnel --url http://localhost:9222" }].map(({ label, cmd }) => (
            <div key={label} className="rounded-lg border border-border bg-card p-2.5">
              <div className="mb-1 flex items-center justify-between"><span className="text-[11px] text-muted-foreground">{label}</span><button type="button" onClick={() => copyToClipboard(cmd)}><Copy className="h-3 w-3" /></button></div>
              <code className="break-all text-[11px] text-emerald-700">{cmd}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ConnectionsPage() {
  const vaultLinks = [
    { label: "Get VIBA API", desc: "Create/use the VIBA platform API key for connecting VIBA to other platforms.", href: "/settings" },
    { label: "User API Vault", desc: "Open your stored provider keys, custom AI credentials, and tokens.", href: "/credentials" },
    { label: "Deployment Credentials", desc: "Store Railway, Render, GitHub, and deployment tokens in the vault.", href: "/credentials?action=add" },
  ];

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-8 px-0 py-2 md:px-4 md:py-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10"><Plug className="h-5 w-5 text-primary" /></div>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Connections</h1>
          </div>
          <p className="pl-14 text-sm leading-relaxed text-muted-foreground">Manage AI providers, browser access, VIBA API access, and encrypted vault credentials.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Monitor className="h-4.5 w-4.5 text-primary" />My Browser</CardTitle>
            <CardDescription className="text-xs">Optional real-browser access for UI testing and authenticated workflows.</CardDescription>
          </CardHeader>
          <CardContent><MyBrowserSection /></CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Cpu className="h-4.5 w-4.5 text-primary" />AI Providers</CardTitle>
            <CardDescription className="text-xs">Groq can run live when configured. Add other keys for collaborative AI work.</CardDescription>
          </CardHeader>
          <CardContent><ProviderSection /></CardContent>
        </Card>

        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="flex items-start gap-4 py-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/15"><Zap className="h-5 w-5 text-emerald-600" /></div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-emerald-700">Groq is included when the VIBA Groq key is configured</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">No user key is needed for basic Groq-backed execution when the server has GROQ_API_KEY set. Add other providers for higher-end collaboration.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Shield className="h-4.5 w-4.5 text-primary" />Secure Vault</CardTitle>
            <CardDescription className="text-xs">Separate platform API access from the user credential vault so users do not get sent to the wrong place.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {vaultLinks.map(({ label, desc, href }) => (
                <Link key={label} href={href}>
                  <div className="group flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3 transition-all hover:border-primary/35 hover:bg-primary/5">
                    <div className="min-w-0"><p className="text-sm font-medium">{label}</p><p className="text-xs leading-relaxed text-muted-foreground">{desc}</p></div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                  </div>
                </Link>
              ))}
              <Link href="/credentials"><Button variant="outline" size="sm" className="gap-1.5 text-xs"><Key className="h-3.5 w-3.5" />Open user API vault<ArrowRight className="h-3.5 w-3.5" /></Button></Link>
            </div>
          </CardContent>
        </Card>

        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Shield className="h-3.5 w-3.5" />Security note</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>• Provider secrets are stored in the encrypted vault.</li>
            <li>• Raw secret values are not returned after saving.</li>
            <li>• Tool-capable agents still require explicit user action for destructive workflows.</li>
          </ul>
        </div>
      </div>
    </AppLayout>
  );
}
