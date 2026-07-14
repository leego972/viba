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
  Monitor, Wifi, WifiOff, Trash2, ChevronDown, ChevronUp, Copy, Server, Train,
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

interface SavedKeyEntry { label: string; status: string; updatedAt: string; }
interface AddKeyForm { label: string; value: string; saving: boolean; open: boolean; showVal: boolean; }

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
    } catch {}
  }, []);

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
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Icon */}
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
            provider.status === "configured" ? "bg-emerald-500/15 border border-emerald-500/25" : "bg-muted/30 border border-border/50"
          }`}>
            <Cpu className={`h-4 w-4 ${provider.status === "configured" ? "text-emerald-400" : "text-muted-foreground"}`} />
          </div>

          {/* Name + badge stacked — badge on its own line so name never gets squeezed */}
          <div className="flex-1 min-w-0 space-y-0.5">
            <p className="text-sm font-medium leading-tight">{provider.label}</p>
            <StatusBadge status={provider.status} />
          </div>

          {/* Controls — right-pinned, never overlaps the name column */}
          <div className="flex items-center gap-2 shrink-0">
            <Switch
              checked={ls.enabled}
              onCheckedChange={(v) => updateLocal(provider.id, { enabled: v })}
            />
            <button
              className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap px-1"
              onClick={() => {
                const opening = !(expanded[provider.id] ?? false);
                setExpanded(prev => ({ ...prev, [provider.id]: opening }));
                if (opening) void fetchProviderKeys(provider.id);
              }}
            >
              {isExpanded ? "Close" : (provider.status === "not_configured" ? "Connect" : "Edit")}
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="border-t border-white/[0.06] px-4 py-4 space-y-4">
            {provider.id === "custom" && (
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/8 px-3 py-2.5 text-xs text-violet-300 space-y-1">
                <p className="font-medium">Works with any OpenAI-compatible API</p>
                <p className="text-violet-300/70">Venice · Together · OpenRouter · Mistral · Fireworks · Anyscale · your own endpoint</p>
                <p className="text-violet-300/50 mt-1">Enter the base URL and your API key below, then pick your model name.</p>
              </div>
            )}
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
                  placeholder={provider.id === "local" ? "http://localhost:11434" : provider.id === "custom" ? "https://api.venice.ai/api/v1" : "https://your-provider.example.com/v1"}
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

            {/* ── Multi-account keys ─────────────────────────────────── */}
            {(keysByProvider[provider.id]?.length ?? 0) > 0 && (
              <div className="space-y-2 pt-1 border-t border-white/[0.06]">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Key className="h-3 w-3" /> Saved accounts
                </p>
                {keysByProvider[provider.id]!.map((entry) => (
                  <div key={entry.label} className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="text-xs font-medium truncate">{entry.label}</span>
                      <span className="text-[10px] text-muted-foreground/60">
                        {entry.label === "default" ? "Default slot" : "Named slot"}
                      </span>
                    </div>
                    <button
                      type="button"
                      title={`Remove "${entry.label}" key`}
                      onClick={async () => {
                        try {
                          const res = await fetch(`${BASE}/api/providers/${provider.id}/keys/${encodeURIComponent(entry.label)}`, {
                            method: "DELETE", credentials: "include",
                          });
                          if (!res.ok) throw new Error(`HTTP ${res.status}`);
                          toast({ title: `Key "${entry.label}" removed` });
                          void fetchProviderKeys(provider.id);
                          void fetchProviders();
                        } catch {
                          toast({ title: "Delete failed", variant: "destructive" });
                        }
                      }}
                      className="text-muted-foreground/50 hover:text-destructive transition-colors p-0.5"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add another account */}
            {provider.id !== "local" && provider.hasKey !== undefined && (
              <div className="pt-1 border-t border-white/[0.06]">
                {!(addKeyForms[provider.id]?.open) ? (
                  <button
                    type="button"
                    onClick={() => setAddKeyForms(prev => ({
                      ...prev,
                      [provider.id]: { label: "", value: "", saving: false, open: true, showVal: false },
                    }))}
                    className="text-xs text-primary/70 hover:text-primary flex items-center gap-1 transition-colors"
                  >
                    + Add another account
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Add another API key</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Account label</Label>
                        <Input
                          placeholder="e.g. Account 2"
                          value={addKeyForms[provider.id]?.label ?? ""}
                          onChange={(e) => setAddKeyForms(prev => ({
                            ...prev,
                            [provider.id]: { ...prev[provider.id]!, label: e.target.value },
                          }))}
                          className="h-8 text-xs bg-background/50"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">API key</Label>
                        <div className="relative">
                          <Input
                            type={addKeyForms[provider.id]?.showVal ? "text" : "password"}
                            placeholder="Paste key…"
                            value={addKeyForms[provider.id]?.value ?? ""}
                            onChange={(e) => setAddKeyForms(prev => ({
                              ...prev,
                              [provider.id]: { ...prev[provider.id]!, value: e.target.value },
                            }))}
                            className="h-8 pr-8 text-xs font-mono bg-background/50"
                          />
                          <button
                            type="button"
                            onClick={() => setAddKeyForms(prev => ({
                              ...prev,
                              [provider.id]: { ...prev[provider.id]!, showVal: !prev[provider.id]!.showVal },
                            }))}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {addKeyForms[provider.id]?.showVal ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost" size="sm" className="h-7 text-xs"
                        onClick={() => setAddKeyForms(prev => ({ ...prev, [provider.id]: { ...prev[provider.id]!, open: false } }))}
                      >Cancel</Button>
                      <Button
                        size="sm" className="h-7 text-xs gap-1"
                        disabled={!addKeyForms[provider.id]?.label.trim() || !addKeyForms[provider.id]?.value.trim() || addKeyForms[provider.id]?.saving}
                        onClick={async () => {
                          const form = addKeyForms[provider.id]!;
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
                        }}
                      >
                        {addKeyForms[provider.id]?.saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        Save key
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

  const hasRealKey = configured.some(p => p.id !== "groq");

  return (
    <div className="space-y-3">
      {!hasRealKey && providers.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3.5">
          <Key className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-amber-300">Add your first API key to unlock live sessions</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Groq is included free and ready to go. Connect OpenAI, Claude, or Gemini below to run sessions with more powerful models.
            </p>
          </div>
        </div>
      )}
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

// ── My Browser Section ────────────────────────────────────────────────────────

interface BrowserStatus {
  configured: boolean;
  connected: boolean;
  tabs?: Array<{ index: number; url: string; title: string }>;
  error?: string;
}

function MyBrowserSection() {
  const { toast } = useToast();
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [cdpInput, setCdpInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showInstructions, setShowInstructions] = useState(true);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/user-browser/status`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as BrowserStatus;
      setStatus(data);
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
      const res = await fetch(`${BASE}/api/user-browser/config`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cdpUrl: url }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; tabs?: BrowserStatus["tabs"] };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast({ title: "My Browser connected!", description: `Found ${data.tabs?.length ?? 0} open tab(s).` });
      setCdpInput("");
      await fetchStatus();
    } catch (err) {
      toast({ title: "Connection failed", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const res = await fetch(`${BASE}/api/user-browser/test`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json() as { ok?: boolean; tabs?: BrowserStatus["tabs"]; error?: string };
      if (data.ok) {
        toast({ title: "Browser connected", description: `${data.tabs?.length ?? 0} tab(s) visible to agents.` });
      } else {
        toast({ title: "Connection failed", description: data.error ?? "Could not reach browser.", variant: "destructive" });
      }
      await fetchStatus();
    } catch (err) {
      toast({ title: "Test failed", description: String(err), variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  async function remove() {
    setRemoving(true);
    try {
      await fetch(`${BASE}/api/user-browser/config`, { method: "DELETE", credentials: "include" });
      toast({ title: "My Browser disconnected" });
      await fetchStatus();
    } catch {
      toast({ title: "Remove failed", variant: "destructive" });
    } finally {
      setRemoving(false);
    }
  }

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text).then(() =>
      toast({ title: "Copied to clipboard" })
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-16">
        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isConnected = status?.configured && status?.connected;

  return (
    <div className="space-y-4">
      {/* Status row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
            isConnected
              ? "bg-emerald-500/15 border border-emerald-500/25"
              : status?.configured
                ? "bg-amber-500/15 border border-amber-500/25"
                : "bg-muted/30 border border-border/50"
          }`}>
            <Monitor className={`h-4 w-4 ${
              isConnected ? "text-emerald-400" : status?.configured ? "text-amber-400" : "text-muted-foreground"
            }`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">My Browser</span>
              {isConnected ? (
                <Badge className="gap-1 bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">
                  <Wifi className="h-3 w-3" /> Live
                </Badge>
              ) : status?.configured ? (
                <Badge className="gap-1 bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/15">
                  <WifiOff className="h-3 w-3" /> Disconnected
                </Badge>
              ) : (
                <Badge className="gap-1 bg-zinc-500/15 text-zinc-400 border-zinc-500/30 hover:bg-zinc-500/15">
                  <XCircle className="h-3 w-3" /> Not set up
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {isConnected
                ? `${status?.tabs?.length ?? 0} tab(s) accessible to agents`
                : "Agents will use your real Chrome with your sessions & cookies"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status?.configured && (
            <>
              <Button size="sm" variant="outline" onClick={testConnection} disabled={testing} className="gap-1.5 text-xs h-8">
                {testing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />}
                {testing ? "Testing…" : "Test"}
              </Button>
              <Button size="sm" variant="ghost" onClick={remove} disabled={removing} className="gap-1.5 text-xs h-8 text-destructive hover:text-destructive">
                {removing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Open tabs preview */}
      {isConnected && status?.tabs && status.tabs.length > 0 && (
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] divide-y divide-white/[0.05]">
          {status.tabs.slice(0, 6).map((tab) => (
            <div key={tab.index} className="flex items-center gap-3 px-3 py-2">
              <span className="text-xs text-muted-foreground w-4 shrink-0">{tab.index}</span>
              <Globe className="h-3 w-3 text-muted-foreground/60 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{tab.title || "(Untitled)"}</p>
                <p className="text-[11px] text-muted-foreground truncate">{tab.url}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {status?.configured && !status?.connected && status?.error && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2.5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-200/80">{status.error}</p>
        </div>
      )}

      {/* Desktop-required notice */}
      {!status?.configured && (
        <div className="flex items-start gap-2.5 rounded-lg border border-blue-500/25 bg-blue-500/8 px-3 py-3">
          <Server className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-semibold text-blue-300">Requires a desktop computer</p>
            <p className="text-xs text-blue-300/70 leading-relaxed">
              My Browser connects to Chrome running on your <strong className="text-blue-300/90">Mac, Windows, or Linux</strong> machine — it cannot be set up from a phone or tablet. Follow the steps below on your computer.
            </p>
          </div>
        </div>
      )}

      {/* Connect form */}
      {!status?.configured && (
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Chrome DevTools URL</Label>
            <div className="flex gap-2">
              <Input
                className="h-9 text-sm font-mono"
                placeholder="https://xyz.trycloudflare.com"
                value={cdpInput}
                onChange={(e) => setCdpInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
              />
              <Button size="sm" onClick={save} disabled={saving || !cdpInput.trim()} className="gap-1.5 h-9 px-4">
                {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {saving ? "Connecting…" : "Connect"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Paste the public tunnel URL for your Chrome DevTools port.</p>
          </div>
        </div>
      )}

      {/* Setup instructions accordion */}
      <button
        type="button"
        onClick={() => setShowInstructions(!showInstructions)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {showInstructions ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {showInstructions ? "Hide" : "Show"} setup instructions
      </button>

      {showInstructions && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-4 text-xs">
          <p className="text-sm font-medium">How to connect your Chrome browser</p>

          <div className="space-y-2">
            <p className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Step 1 — Launch Chrome with remote debugging</p>
            <div className="space-y-1.5">
              {[
                { label: "macOS", cmd: "/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/viba-chrome" },
                { label: "Windows", cmd: "chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\\tmp\\viba-chrome" },
                { label: "Linux", cmd: "google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/viba-chrome" },
              ].map(({ label, cmd }) => (
                <div key={label} className="rounded-lg border border-white/[0.07] bg-black/30 p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-muted-foreground">{label}</span>
                    <button type="button" onClick={() => copyToClipboard(cmd)} className="text-muted-foreground hover:text-foreground transition-colors">
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                  <code className="text-[11px] text-emerald-300 break-all">{cmd}</code>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Step 2 — Create a public tunnel to port 9222</p>
            <div className="rounded-lg border border-white/[0.07] bg-black/30 p-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-muted-foreground">Cloudflare tunnel (free, no account needed)</span>
                <button type="button" onClick={() => copyToClipboard("cloudflared tunnel --url http://localhost:9222")} className="text-muted-foreground hover:text-foreground transition-colors">
                  <Copy className="h-3 w-3" />
                </button>
              </div>
              <code className="text-[11px] text-emerald-300">cloudflared tunnel --url http://localhost:9222</code>
            </div>
            <p className="text-muted-foreground/70">cloudflared will print a URL like <code className="text-foreground/80">https://abc-def.trycloudflare.com</code> — paste that above.</p>
          </div>

          <div className="space-y-1">
            <p className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Step 3 — Paste the tunnel URL above and click Connect</p>
            <p className="text-muted-foreground/70">VIBA will verify the connection, then agents can use <code className="text-foreground/80">user_browser_*</code> tools that operate in your real Chrome — with all your sessions and cookies.</p>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
            <Shield className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-muted-foreground/80">The tunnel URL is stored encrypted in your vault. Only VIBA agents you explicitly run can access your browser. Close Chrome or kill the tunnel to instantly revoke access.</p>
          </div>
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
        <div className="flex items-start gap-3 rounded-xl border border-orange-400/50 bg-orange-400/12 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
          <p className="text-sm text-orange-700 dark:text-orange-300">
            <span className="font-semibold text-orange-600 dark:text-orange-400">Live execution is off by default.</span>{" "}
            Connecting a provider makes it available for sessions — each session still requires explicit budget approval before any paid call is made.
          </p>
        </div>

        {/* My Browser */}
        <Card className="border-white/[0.07] bg-white/[0.01]">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Monitor className="h-4.5 w-4.5 text-primary" />
              My Browser
            </CardTitle>
            <CardDescription className="text-xs">
              Give agents access to your real Chrome — with your sessions, cookies, and logged-in accounts. Agents use <code className="text-foreground/70">user_browser_*</code> tools to see and control your tabs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MyBrowserSection />
          </CardContent>
        </Card>

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

        {/* Deployment Connectors */}
        <Card className="border-white/[0.07] bg-white/[0.01]">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4.5 w-4.5 text-primary" />
              Deployment Connectors
            </CardTitle>
            <CardDescription className="text-xs">
              Live API integrations for triggering deploys, managing env vars, and streaming logs directly from VIBA.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Link href="/render-connector">
                <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
                      <Server className="h-4 w-4 text-indigo-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Render</p>
                      <p className="text-xs text-muted-foreground">Deploy, env vars, logs — full REST API</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium rounded-full px-2 py-0.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">Live</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </div>
              </Link>
              <Link href="/domain-setup">
                <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                      <Train className="h-4 w-4 text-violet-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Railway</p>
                      <p className="text-xs text-muted-foreground">GraphQL API + MCP + browser fallback</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium rounded-full px-2 py-0.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">Live</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </div>
              </Link>
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
