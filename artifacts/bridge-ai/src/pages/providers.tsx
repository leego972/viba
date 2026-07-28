import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Pencil, Plus, RefreshCw, ServerCog, Trash2, XCircle } from "lucide-react";

type ProviderStatus = "not_configured" | "configured" | "disabled";

type ProviderInfo = {
  id: string;
  label: string;
  description: string;
  hasKey: boolean;
  enabled: boolean;
  status: ProviderStatus;
  sourceIds: string[];
};

type SavedKey = {
  providerId: string;
  label: string;
  status: string;
  updatedAt?: string | null;
};

type TestState = {
  testing: boolean;
  ok: boolean | null;
  reachable: boolean;
  message: string;
};

const CANONICAL_PROVIDER: Record<string, string> = { gemini: "google" };
const INFRA_IDS = new Set(["github", "railway", "render", "vercel", "vastai"]);

const PROVIDER_MARKS: Record<string, { icon?: string; fallback: string; glow: string }> = {
  openai: { icon: "https://cdn.simpleicons.org/openai/FFFFFF", fallback: "OA", glow: "from-emerald-400/25 to-cyan-400/10" },
  anthropic: { icon: "https://cdn.simpleicons.org/anthropic/FFFFFF", fallback: "CL", glow: "from-orange-400/25 to-amber-300/10" },
  google: { icon: "https://cdn.simpleicons.org/googlegemini/FFFFFF", fallback: "G", glow: "from-blue-400/25 to-fuchsia-400/10" },
  groq: { icon: "https://cdn.simpleicons.org/groq/FFFFFF", fallback: "GQ", glow: "from-rose-400/25 to-orange-400/10" },
  venice: { fallback: "V", glow: "from-violet-400/30 to-fuchsia-400/10" },
  mistral: { icon: "https://cdn.simpleicons.org/mistralai/FFFFFF", fallback: "M", glow: "from-orange-400/25 to-red-400/10" },
  deepseek: { fallback: "DS", glow: "from-blue-500/30 to-cyan-400/10" },
  perplexity: { icon: "https://cdn.simpleicons.org/perplexity/FFFFFF", fallback: "P", glow: "from-cyan-400/25 to-teal-400/10" },
  ollama: { icon: "https://cdn.simpleicons.org/ollama/FFFFFF", fallback: "O", glow: "from-zinc-300/20 to-zinc-500/10" },
  custom: { fallback: "AI", glow: "from-indigo-400/25 to-purple-400/10" },
  github: { icon: "https://cdn.simpleicons.org/github/FFFFFF", fallback: "GH", glow: "from-zinc-300/20 to-zinc-500/10" },
  railway: { icon: "https://cdn.simpleicons.org/railway/FFFFFF", fallback: "RW", glow: "from-violet-400/25 to-indigo-500/10" },
  render: { icon: "https://cdn.simpleicons.org/render/FFFFFF", fallback: "R", glow: "from-cyan-400/25 to-emerald-400/10" },
  vercel: { icon: "https://cdn.simpleicons.org/vercel/FFFFFF", fallback: "▲", glow: "from-zinc-200/20 to-zinc-500/10" },
  vastai: { fallback: "VAST", glow: "from-red-400/25 to-orange-400/10" },
};

const INFRASTRUCTURE = [
  { id: "github", label: "GitHub", detail: "Repositories, branches, pull requests and source access." },
  { id: "railway", label: "Railway", detail: "Deployment, environment variables and service operations." },
  { id: "render", label: "Render", detail: "VIBA production deployment, logs and service management." },
  { id: "vercel", label: "Vercel", detail: "Frontend deployment and project delivery." },
  { id: "vastai", label: "Vast.ai", detail: "GPU compute and AI workload infrastructure." },
];

function canonicalId(id: string): string {
  return CANONICAL_PROVIDER[id] ?? id;
}

function mergeProviders(input: Omit<ProviderInfo, "sourceIds">[]): ProviderInfo[] {
  const merged = new Map<string, ProviderInfo>();
  for (const provider of input) {
    const id = canonicalId(provider.id);
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, { ...provider, id, label: id === "google" ? "Google Gemini" : provider.label, sourceIds: [provider.id] });
      continue;
    }
    existing.sourceIds = Array.from(new Set([...existing.sourceIds, provider.id]));
    existing.hasKey = existing.hasKey || provider.hasKey;
    existing.enabled = existing.enabled || provider.enabled;
    existing.status = existing.hasKey ? (existing.enabled ? "configured" : "disabled") : "not_configured";
  }
  return [...merged.values()].sort((a, b) => {
    if (a.hasKey !== b.hasKey) return a.hasKey ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

function ProviderMark({ id, size = "large" }: { id: string; size?: "small" | "large" }) {
  const mark = PROVIDER_MARKS[id] ?? { fallback: id.slice(0, 2).toUpperCase(), glow: "from-indigo-400/25 to-cyan-400/10" };
  const classes = size === "large" ? "h-14 w-14 rounded-2xl" : "h-11 w-11 rounded-xl";
  return (
    <div className={`${classes} relative shrink-0 overflow-hidden border border-white/10 bg-gradient-to-br ${mark.glow} shadow-[0_0_30px_rgba(90,120,255,0.12)]`}>
      <div className="absolute inset-0 bg-[#080b14]/78" />
      <div className="relative flex h-full w-full items-center justify-center p-3">
        {mark.icon ? (
          <img src={mark.icon} alt="" className="h-full w-full object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} />
        ) : (
          <span className="text-xs font-black tracking-tight text-white">{mark.fallback}</span>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ provider, test }: { provider: ProviderInfo; test?: TestState }) {
  if (test?.reachable) {
    return <Badge className="border-emerald-400/35 bg-emerald-400/10 text-emerald-200"><CheckCircle2 className="mr-1 h-3 w-3" /> Verified</Badge>;
  }
  if (provider.hasKey && provider.enabled) {
    return <Badge className="border-cyan-400/35 bg-cyan-400/10 text-cyan-100"><KeyRound className="mr-1 h-3 w-3" /> Key saved</Badge>;
  }
  if (provider.hasKey) return <Badge className="border-white/10 bg-white/5 text-zinc-300">Saved · disabled</Badge>;
  return <Badge variant="outline" className="border-white/10 text-zinc-400"><XCircle className="mr-1 h-3 w-3" /> Not saved</Badge>;
}

export default function ProvidersPage() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("default");
  const [keyValue, setKeyValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Record<string, SavedKey[]>>({});
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/providers", { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { providers: Omit<ProviderInfo, "sourceIds">[] };
      setProviders(mergeProviders(payload.providers).filter((provider) => !INFRA_IDS.has(provider.id)));
    } catch {
      toast({ title: "Could not load AI providers", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void fetchProviders(); }, [fetchProviders]);

  const openProvider = useMemo(() => providers.find((provider) => provider.id === openId), [providers, openId]);

  async function loadKeys(provider: ProviderInfo) {
    const results = await Promise.all(provider.sourceIds.map(async (sourceId) => {
      const response = await fetch(`/api/providers/${sourceId}/keys`, { credentials: "include" });
      if (!response.ok) return [] as SavedKey[];
      const payload = (await response.json()) as { keys: Array<Omit<SavedKey, "providerId">> };
      return payload.keys.filter((key) => key.status !== "deleted").map((key) => ({ ...key, providerId: sourceId }));
    }));
    setSavedKeys((previous) => ({ ...previous, [provider.id]: results.flat() }));
  }

  async function beginEdit(provider: ProviderInfo) {
    const next = openId === provider.id ? null : provider.id;
    setOpenId(next);
    setKeyName("default");
    setKeyValue("");
    setShowValue(false);
    if (next) await loadKeys(provider);
  }

  async function saveKey(provider: ProviderInfo) {
    const name = keyName.trim();
    const value = keyValue.trim();
    if (!name || !value) {
      toast({ title: "Name and value are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/providers/${provider.id}/keys`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: name, key: value }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await fetch(`/api/providers/${provider.id}`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }),
      });
      setKeyValue("");
      toast({ title: `${provider.label} API saved`, description: `Saved securely as “${name}”.` });
      await Promise.all([loadKeys(provider), fetchProviders()]);
    } catch {
      toast({ title: "API key was not saved", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteKey(provider: ProviderInfo, key: SavedKey) {
    const response = await fetch(`/api/providers/${key.providerId}/keys/${encodeURIComponent(key.label)}`, { method: "DELETE", credentials: "include" });
    if (!response.ok) {
      toast({ title: "Could not delete API key", variant: "destructive" });
      return;
    }
    await Promise.all([loadKeys(provider), fetchProviders()]);
  }

  async function setEnabled(provider: ProviderInfo, enabled: boolean) {
    const response = await fetch(`/api/providers/${provider.id}`, {
      method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }),
    });
    if (!response.ok) {
      toast({ title: "Provider state was not updated", variant: "destructive" });
      return;
    }
    await fetchProviders();
  }

  async function testProvider(provider: ProviderInfo) {
    setTests((previous) => ({ ...previous, [provider.id]: { testing: true, ok: null, reachable: false, message: "Testing…" } }));
    try {
      const response = await fetch(`/api/providers/${provider.id}/test`, { method: "POST", credentials: "include" });
      const payload = (await response.json()) as { configured?: boolean; reachable?: boolean; message?: string };
      setTests((previous) => ({ ...previous, [provider.id]: { testing: false, ok: Boolean(payload.configured), reachable: Boolean(payload.reachable), message: payload.message ?? "No result returned." } }));
    } catch {
      setTests((previous) => ({ ...previous, [provider.id]: { testing: false, ok: false, reachable: false, message: "Connection test failed." } }));
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:py-8">
        <section className="relative overflow-hidden rounded-3xl border border-cyan-300/15 bg-[radial-gradient(circle_at_12%_15%,rgba(66,225,255,0.16),transparent_32%),radial-gradient(circle_at_90%_5%,rgba(143,91,255,0.18),transparent_30%),linear-gradient(135deg,#0b1020,#060812)] p-6 shadow-2xl sm:p-8">
          <div className="absolute right-5 top-1/2 hidden h-36 w-36 -translate-y-1/2 items-center justify-center rounded-full border border-cyan-300/15 bg-cyan-300/5 shadow-[0_0_70px_rgba(67,215,255,0.18)] sm:flex">
            <img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="VIBA brain" className="h-24 w-24 drop-shadow-[0_0_25px_rgba(99,229,255,0.65)]" />
          </div>
          <div className="relative max-w-3xl sm:pr-44">
            <div className="mb-3 text-xs font-black uppercase tracking-[0.28em] text-cyan-200">VIBA Neural Connections</div>
            <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">AI Brains</h1>
            <p className="mt-3 text-sm leading-6 text-zinc-200 sm:text-base">Add and manage the language-model APIs that VIBA can use for strategy, research, building, review and orchestration. Each credential is stored by name and value.</p>
          </div>
        </section>

        {loading ? (
          <div className="flex min-h-48 items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <section className="grid gap-4 lg:grid-cols-2">
            {providers.map((provider) => {
              const test = tests[provider.id];
              const keys = savedKeys[provider.id] ?? [];
              const isOpen = openId === provider.id;
              return (
                <Card key={provider.id} className="overflow-hidden border-white/10 bg-gradient-to-br from-white/[0.055] to-white/[0.02] shadow-xl backdrop-blur-xl">
                  <CardHeader className="p-4 sm:p-5">
                    <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <ProviderMark id={provider.id} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle className="break-normal text-base leading-tight text-foreground sm:text-lg">{provider.label}</CardTitle>
                            <StatusBadge provider={provider} test={test} />
                          </div>
                          <CardDescription className="mt-1.5 break-words leading-5">{provider.description}</CardDescription>
                        </div>
                      </div>
                      <div className="flex w-full items-center justify-between gap-2 border-t border-white/5 pt-3 sm:w-auto sm:justify-end sm:border-0 sm:pt-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{provider.enabled ? "Enabled" : "Disabled"}</span>
                          <Switch checked={provider.enabled} disabled={!provider.hasKey} onCheckedChange={(enabled) => void setEnabled(provider, enabled)} aria-label={`${provider.enabled ? "Disable" : "Enable"} ${provider.label}`} />
                        </div>
                        <Button variant="outline" size="sm" onClick={() => void beginEdit(provider)} className="border-white/10 bg-white/5">
                          {provider.hasKey ? <Pencil className="mr-1.5 h-3.5 w-3.5" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
                          {provider.hasKey ? "Edit APIs" : "Add API"}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  {isOpen && openProvider && (
                    <CardContent className="space-y-5 border-t border-white/10 bg-black/15 p-4 sm:p-5">
                      {keys.length > 0 && (
                        <div className="space-y-2">
                          <Label>Saved APIs</Label>
                          {keys.map((key) => (
                            <div key={`${key.providerId}:${key.label}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                              <div className="min-w-0"><div className="truncate text-sm font-semibold">{key.label}</div><div className="text-xs text-muted-foreground">Value encrypted and stored</div></div>
                              <Button variant="ghost" size="icon" onClick={() => void deleteKey(provider, key)} aria-label={`Delete ${key.label}`}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5"><Label htmlFor={`api-name-${provider.id}`}>Name</Label><Input id={`api-name-${provider.id}`} value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="e.g. Main account" autoComplete="off" /></div>
                        <div className="space-y-1.5"><Label htmlFor={`api-value-${provider.id}`}>Value</Label><div className="relative"><Input id={`api-value-${provider.id}`} type={showValue ? "text" : "password"} value={keyValue} onChange={(event) => setKeyValue(event.target.value)} placeholder="Paste API key" className="pr-10 font-mono" autoComplete="new-password" /><button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowValue((visible) => !visible)} aria-label={showValue ? "Hide API value" : "Show API value"}>{showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></div>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button onClick={() => void saveKey(provider)} disabled={saving || !keyName.trim() || !keyValue.trim()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save API</Button>
                        {provider.hasKey && <Button variant="outline" onClick={() => void testProvider(provider)} disabled={test?.testing}>{test?.testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Verify connection</Button>}
                      </div>
                      {test?.message && <div className={`rounded-lg border px-3 py-2 text-sm ${test.ok ? "border-emerald-500/30 bg-emerald-500/8" : "border-destructive/30 bg-destructive/8"}`}>{test.message}</div>}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </section>
        )}

        <section className="space-y-4 rounded-3xl border border-violet-300/15 bg-[linear-gradient(135deg,rgba(72,52,120,0.16),rgba(7,9,16,0.65))] p-5 sm:p-7">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-violet-300/20 bg-violet-300/10"><ServerCog className="h-6 w-6 text-violet-200" /></div>
            <div><h2 className="text-xl font-black">Deployment & Infrastructure</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">These services are tools and infrastructure. They are not AI brains and cannot be assigned reasoning roles.</p></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {INFRASTRUCTURE.map((service) => (
              <div key={service.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <ProviderMark id={service.id} size="small" />
                <div className="mt-3 font-bold">{service.label}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{service.detail}</div>
              </div>
            ))}
          </div>
          <Button asChild variant="outline" className="border-violet-300/20 bg-violet-300/5"><Link href="/credentials">Manage infrastructure credentials in Vault</Link></Button>
        </section>
      </div>
    </AppLayout>
  );
}
