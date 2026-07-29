import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProviderBrandIcon } from "@/components/ProviderBrandIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Eye, EyeOff, Loader2, Pencil, Plus, RefreshCw, ServerCog, Trash2, XCircle } from "lucide-react";

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

type SavedKey = { providerId: string; label: string; status: string; updatedAt?: string | null };
type TestState = { testing: boolean; ok: boolean | null; reachable: boolean; message: string };

const CANONICAL_PROVIDER: Record<string, string> = { gemini: "google" };
const INFRA_IDS = new Set(["github", "railway", "render", "vercel", "vastai", "cloudflare", "stripe", "resend", "supabase", "neon"]);
const INFRASTRUCTURE = [
  { id: "github", label: "GitHub", detail: "Repositories, branches, pull requests and source access." },
  { id: "railway", label: "Railway", detail: "Deployment, environment variables and service operations." },
  { id: "render", label: "Render", detail: "VIBA production deployment, logs and service management." },
  { id: "vercel", label: "Vercel", detail: "Frontend deployment and project delivery." },
  { id: "vastai", label: "Vast.ai", detail: "GPU compute and AI workload infrastructure." },
];

function canonicalId(id: string) { return CANONICAL_PROVIDER[id] ?? id; }

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
    existing.hasKey ||= provider.hasKey;
    existing.enabled ||= provider.enabled;
    existing.status = existing.hasKey ? (existing.enabled ? "configured" : "disabled") : "not_configured";
  }
  return [...merged.values()].sort((a, b) => Number(b.hasKey) - Number(a.hasKey) || a.label.localeCompare(b.label));
}

function ProviderMark({ id, size = "large" }: { id: string; size?: "small" | "large" }) {
  const classes = size === "large" ? "h-14 w-14 rounded-2xl" : "h-11 w-11 rounded-xl";
  const iconClass = size === "large" ? "h-8 w-8" : "h-6 w-6";
  return (
    <div className={`${classes} flex shrink-0 items-center justify-center border border-white/10 bg-white/[0.055] text-white shadow-[0_0_30px_rgba(90,120,255,0.12)]`}>
      <ProviderBrandIcon id={id} className={iconClass} title={id} />
    </div>
  );
}

function StatusBadge({ provider, test }: { provider?: ProviderInfo; test?: TestState }) {
  if (test?.reachable) return <Badge className="border-emerald-400/35 bg-emerald-400/10 text-emerald-200"><CheckCircle2 className="mr-1 h-3 w-3" />Verified</Badge>;
  if (provider?.hasKey && provider.enabled) return <Badge className="border-emerald-400/35 bg-emerald-400/10 text-emerald-200"><CheckCircle2 className="mr-1 h-3 w-3" />Connected</Badge>;
  if (provider?.hasKey) return <Badge className="border-white/10 bg-white/5 text-zinc-300">Disabled</Badge>;
  return <Badge variant="outline" className="border-white/10 text-zinc-400"><XCircle className="mr-1 h-3 w-3" />Not connected</Badge>;
}

export default function ProvidersPage() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [infrastructureProviders, setInfrastructureProviders] = useState<ProviderInfo[]>([]);
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
      const merged = mergeProviders(payload.providers);
      setProviders(merged.filter((provider) => !INFRA_IDS.has(provider.id)));
      setInfrastructureProviders(merged.filter((provider) => INFRA_IDS.has(provider.id)));
    } catch {
      toast({ title: "Could not load providers", variant: "destructive" });
    } finally { setLoading(false); }
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
    setOpenId(next); setKeyName("default"); setKeyValue(""); setShowValue(false);
    if (next) await loadKeys(provider);
  }

  async function saveKey(provider: ProviderInfo) {
    const name = keyName.trim(); const value = keyValue.trim();
    if (!name || !value) return toast({ title: "Name and value are required", variant: "destructive" });
    setSaving(true);
    try {
      const response = await fetch(`/api/providers/${provider.id}/keys`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: name, key: value }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await fetch(`/api/providers/${provider.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
      setKeyValue(""); toast({ title: `${provider.label} API saved`, description: `Saved securely as “${name}”.` });
      await Promise.all([loadKeys(provider), fetchProviders()]);
    } catch { toast({ title: "API key was not saved", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function deleteKey(provider: ProviderInfo, key: SavedKey) {
    const response = await fetch(`/api/providers/${key.providerId}/keys/${encodeURIComponent(key.label)}`, { method: "DELETE", credentials: "include" });
    if (!response.ok) return toast({ title: "Could not delete API key", variant: "destructive" });
    await Promise.all([loadKeys(provider), fetchProviders()]);
  }

  async function setEnabled(provider: ProviderInfo, enabled: boolean) {
    const response = await fetch(`/api/providers/${provider.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
    if (!response.ok) return toast({ title: "Provider state was not updated", variant: "destructive" });
    await fetchProviders();
  }

  async function testProvider(provider: ProviderInfo) {
    setTests((previous) => ({ ...previous, [provider.id]: { testing: true, ok: null, reachable: false, message: "Testing…" } }));
    try {
      const response = await fetch(`/api/providers/${provider.id}/test`, { method: "POST", credentials: "include" });
      const payload = (await response.json()) as { configured?: boolean; reachable?: boolean; message?: string };
      setTests((previous) => ({ ...previous, [provider.id]: { testing: false, ok: Boolean(payload.configured), reachable: Boolean(payload.reachable), message: payload.message ?? "No result returned." } }));
    } catch { setTests((previous) => ({ ...previous, [provider.id]: { testing: false, ok: false, reachable: false, message: "Connection test failed." } })); }
  }

  return <AppLayout><div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:py-8">
    <section className="relative overflow-hidden rounded-3xl border border-cyan-300/15 bg-[linear-gradient(135deg,#0b1020,#060812)] p-6 shadow-2xl sm:p-8"><div className="absolute right-5 top-1/2 hidden h-36 w-36 -translate-y-1/2 items-center justify-center rounded-full border border-cyan-300/15 bg-cyan-300/5 sm:flex"><img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="VIBA brain" className="h-24 w-24" /></div><div className="relative max-w-3xl sm:pr-44"><div className="mb-3 text-xs font-black uppercase tracking-[0.28em] text-cyan-200">VIBA Neural Connections</div><h1 className="text-3xl font-black text-white sm:text-4xl">AI Brains</h1><p className="mt-3 text-sm leading-6 text-zinc-200 sm:text-base">Add and manage the language-model APIs VIBA can use. Each provider shows its real brand and current connection state.</p></div></section>
    {loading ? <div className="flex min-h-48 items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin" /></div> : <section className="grid gap-4 lg:grid-cols-2">{providers.map((provider) => { const test = tests[provider.id]; const keys = savedKeys[provider.id] ?? []; const isOpen = openId === provider.id; return <Card key={provider.id} className="overflow-hidden border-white/10 bg-white/[0.03]"><CardHeader className="p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:justify-between"><div className="flex gap-3"><ProviderMark id={provider.id} /><div><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-base sm:text-lg">{provider.label}</CardTitle><StatusBadge provider={provider} test={test} /></div><CardDescription className="mt-1.5">{provider.description}</CardDescription></div></div><div className="flex items-center gap-2"><Switch checked={provider.enabled} disabled={!provider.hasKey} onCheckedChange={(enabled) => void setEnabled(provider, enabled)} /><Button variant="outline" size="sm" onClick={() => void beginEdit(provider)}>{provider.hasKey ? <Pencil className="mr-1.5 h-3.5 w-3.5" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}{provider.hasKey ? "Edit APIs" : "Add API"}</Button></div></div></CardHeader>{isOpen && openProvider && <CardContent className="space-y-5 border-t border-white/10 p-4 sm:p-5">{keys.map((key) => <div key={`${key.providerId}:${key.label}`} className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2.5"><div><div className="text-sm font-semibold">{key.label}</div><div className="text-xs text-muted-foreground">Value encrypted and stored</div></div><Button variant="ghost" size="icon" onClick={() => void deleteKey(provider, key)}><Trash2 className="h-4 w-4" /></Button></div>)}<div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label>Name</Label><Input value={keyName} onChange={(event) => setKeyName(event.target.value)} /></div><div className="space-y-1.5"><Label>Value</Label><div className="relative"><Input type={showValue ? "text" : "password"} value={keyValue} onChange={(event) => setKeyValue(event.target.value)} className="pr-10 font-mono" /><button type="button" className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setShowValue((value) => !value)}>{showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></div></div><div className="flex gap-2"><Button onClick={() => void saveKey(provider)} disabled={saving || !keyName.trim() || !keyValue.trim()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save API</Button>{provider.hasKey && <Button variant="outline" onClick={() => void testProvider(provider)} disabled={test?.testing}>Verify connection</Button>}</div>{test?.message && <div className="rounded-lg border px-3 py-2 text-sm">{test.message}</div>}</CardContent>}</Card>; })}</section>}
    <section className="space-y-4 rounded-3xl border border-violet-300/15 bg-black/20 p-5 sm:p-7"><div className="flex items-start gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-300/20"><ServerCog className="h-6 w-6" /></div><div><h2 className="text-xl font-black">Deployment & Infrastructure</h2><p className="mt-1 text-sm text-muted-foreground">Connection badges reflect credentials configured inside VIBA.</p></div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{INFRASTRUCTURE.map((service) => { const provider = infrastructureProviders.find((item) => item.id === service.id); return <div key={service.id} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex items-start justify-between gap-2"><ProviderMark id={service.id} size="small" /><StatusBadge provider={provider} /></div><div className="mt-3 font-bold">{service.label}</div><div className="mt-1 text-xs leading-5 text-muted-foreground">{service.detail}</div></div>; })}</div><Button asChild variant="outline"><Link href="/credentials">Manage infrastructure credentials in Vault</Link></Button></section>
  </div></AppLayout>;
}
