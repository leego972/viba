import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, CheckCircle2, Key, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type ProviderStatus = "configured" | "not_configured" | "disabled";
type ProviderCategory = "ai" | "deployment" | "repository" | "dns" | "payments" | "email" | "messaging" | "generic";
type AdapterType =
  | "auto"
  | "openai"
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "groq"
  | "perplexity"
  | "ollama"
  | "replit"
  | "manus"
  | "railway"
  | "render"
  | "vercel"
  | "digitalocean"
  | "github"
  | "cloudflare"
  | "stripe"
  | "email-api"
  | "messaging-api"
  | "generic-rest"
  | "credential-only";

type AdapterTypeOption = {
  id: AdapterType;
  label: string;
  description: string;
  requiresEndpoint: boolean;
  requiresKey: boolean;
  category?: ProviderCategory | "all";
};

type ProviderPreset = {
  id: string;
  label: string;
  description?: string;
  category?: ProviderCategory;
  adapterType?: AdapterType;
  defaultEndpoint?: string;
  defaultModel?: string;
  acceptsKey?: boolean;
};

type Provider = ProviderPreset & {
  hasKey?: boolean;
  enabled?: boolean;
  model?: string;
  endpoint?: string;
  status?: ProviderStatus;
};

const FALLBACK_ADAPTER_TYPES: AdapterTypeOption[] = [
  { id: "auto", label: "Automatic", description: "VIBA chooses from the provider preset and saved details.", requiresEndpoint: false, requiresKey: true, category: "all" },
  { id: "openai-compatible", label: "OpenAI-compatible AI", description: "Venice, OpenRouter, Together, Fireworks, DeepSeek-compatible endpoints and similar /v1 APIs.", requiresEndpoint: false, requiresKey: true, category: "ai" },
  { id: "openai", label: "OpenAI", description: "Native OpenAI adapter.", requiresEndpoint: false, requiresKey: true, category: "ai" },
  { id: "anthropic", label: "Anthropic / Claude", description: "Native Claude adapter.", requiresEndpoint: false, requiresKey: true, category: "ai" },
  { id: "gemini", label: "Google Gemini", description: "Gemini adapter.", requiresEndpoint: false, requiresKey: true, category: "ai" },
  { id: "groq", label: "Groq", description: "Groq adapter.", requiresEndpoint: false, requiresKey: true, category: "ai" },
  { id: "perplexity", label: "Perplexity", description: "Perplexity adapter.", requiresEndpoint: false, requiresKey: true, category: "ai" },
  { id: "ollama", label: "Ollama / Local", description: "Local/self-hosted adapter.", requiresEndpoint: false, requiresKey: false, category: "ai" },
  { id: "railway", label: "Railway", description: "Railway deploy/platform API.", requiresEndpoint: false, requiresKey: true, category: "deployment" },
  { id: "render", label: "Render", description: "Render deploy/platform API.", requiresEndpoint: false, requiresKey: true, category: "deployment" },
  { id: "vercel", label: "Vercel", description: "Vercel deploy/platform API.", requiresEndpoint: false, requiresKey: true, category: "deployment" },
  { id: "digitalocean", label: "DigitalOcean", description: "DigitalOcean cloud API.", requiresEndpoint: false, requiresKey: true, category: "deployment" },
  { id: "github", label: "GitHub", description: "GitHub repository API.", requiresEndpoint: false, requiresKey: true, category: "repository" },
  { id: "cloudflare", label: "Cloudflare", description: "Cloudflare DNS/edge API.", requiresEndpoint: false, requiresKey: true, category: "dns" },
  { id: "stripe", label: "Stripe", description: "Stripe payments API.", requiresEndpoint: false, requiresKey: true, category: "payments" },
  { id: "email-api", label: "Email API", description: "Resend, SendGrid and similar email APIs.", requiresEndpoint: false, requiresKey: true, category: "email" },
  { id: "messaging-api", label: "Messaging API", description: "Slack, Discord and similar messaging APIs.", requiresEndpoint: false, requiresKey: true, category: "messaging" },
  { id: "generic-rest", label: "Generic REST API", description: "For non-AI REST APIs with a key and endpoint.", requiresEndpoint: true, requiresKey: true, category: "generic" },
  { id: "credential-only", label: "Credential only", description: "Stores a secret without pretending VIBA can call the API automatically.", requiresEndpoint: false, requiresKey: true, category: "generic" },
];

const FALLBACK_PROVIDER_PRESETS: ProviderPreset[] = [
  { id: "venice", label: "Venice", category: "ai", adapterType: "openai-compatible", defaultEndpoint: "https://api.venice.ai/api/v1" },
  { id: "render", label: "Render", category: "deployment", adapterType: "render", defaultEndpoint: "https://api.render.com/v1" },
  { id: "railway", label: "Railway", category: "deployment", adapterType: "railway" },
  { id: "github", label: "GitHub", category: "repository", adapterType: "github", defaultEndpoint: "https://api.github.com" },
  { id: "openai", label: "OpenAI", category: "ai", adapterType: "openai" },
  { id: "anthropic", label: "Anthropic / Claude", category: "ai", adapterType: "anthropic" },
  { id: "gemini", label: "Google Gemini", category: "ai", adapterType: "gemini" },
  { id: "groq", label: "Groq", category: "ai", adapterType: "groq" },
  { id: "custom", label: "Custom API", category: "generic", adapterType: "generic-rest" },
];

function providerIdFromName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function displayNameFromId(id: string): string {
  return id.split(/[-_.]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || id;
}

function adapterLabel(adapterTypes: AdapterTypeOption[], id?: AdapterType): string {
  return adapterTypes.find((item) => item.id === id)?.label ?? "Automatic";
}

export function GenericApiKeysCard() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerPresets, setProviderPresets] = useState<ProviderPreset[]>(FALLBACK_PROVIDER_PRESETS);
  const [adapterTypes, setAdapterTypes] = useState<AdapterTypeOption[]>(FALLBACK_ADAPTER_TYPES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showOptionalDetails, setShowOptionalDetails] = useState(false);
  const [presetId, setPresetId] = useState("custom");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [adapterType, setAdapterType] = useState<AdapterType>("generic-rest");
  const [model, setModel] = useState("");
  const [endpoint, setEndpoint] = useState("");

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/providers", { credentials: "include" });
      if (!response.ok) throw new Error(`Provider list failed with HTTP ${response.status}`);
      const payload = (await response.json()) as { providers?: Provider[]; adapterTypes?: AdapterTypeOption[]; providerPresets?: ProviderPreset[] };
      setProviders(payload.providers ?? []);
      if (payload.adapterTypes?.length) setAdapterTypes(payload.adapterTypes);
      if (payload.providerPresets?.length) setProviderPresets(payload.providerPresets);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load API providers.";
      toast({ title: "API list failed", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void loadProviders(); }, [loadProviders]);

  const registeredProviders = useMemo(
    () => providers.filter((provider) => provider.hasKey || provider.status === "configured" || Boolean(provider.endpoint)),
    [providers],
  );

  const selectedAdapter = adapterTypes.find((item) => item.id === adapterType);

  const applyPreset = (id: string) => {
    setPresetId(id);
    const preset = providerPresets.find((item) => item.id === id);
    if (!preset) return;
    setName(preset.label || displayNameFromId(preset.id));
    setAdapterType(preset.adapterType ?? "generic-rest");
    setEndpoint(preset.defaultEndpoint ?? "");
    setModel(preset.defaultModel ?? "");
  };

  const handleAdd = async () => {
    const id = presetId !== "custom" ? presetId : providerIdFromName(name);
    const key = value.trim();
    if (!id) {
      toast({ title: "Name required", description: "Choose a provider preset or enter a custom provider name.", variant: "destructive" });
      return;
    }
    if (!key && selectedAdapter?.requiresKey !== false) {
      toast({ title: "API value required", description: "Paste the API key or token value.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/providers/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          key,
          adapterType,
          model: model.trim() || undefined,
          endpoint: endpoint.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Save failed with HTTP ${response.status}`);
      }
      toast({ title: "API saved", description: `${displayNameFromId(id)} was saved using ${adapterLabel(adapterTypes, adapterType)}.` });
      setPresetId("custom");
      setName("");
      setValue("");
      setAdapterType("generic-rest");
      setModel("");
      setEndpoint("");
      setShowOptionalDetails(false);
      setShowAdd(false);
      await loadProviders();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save API key.";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (provider: Provider) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/providers/${encodeURIComponent(provider.id)}/keys/default`, { method: "DELETE", credentials: "include" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Delete failed with HTTP ${response.status}`);
      }
      toast({ title: "API removed", description: `${provider.label || displayNameFromId(provider.id)} was removed from the VIBA vault.` });
      await loadProviders();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not remove API key.";
      toast({ title: "Remove failed", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" /> API Connections</CardTitle>
            <CardDescription>
              Choose a provider like Venice or Render, paste the key, and VIBA stores it securely. Optional details expose the adapter/protocol.
            </CardDescription>
          </div>
          <Button type="button" onClick={() => setShowAdd((current) => !current)} className="gap-2 shrink-0">
            {showAdd ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showAdd ? "Cancel" : "Add API"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showAdd && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="api-provider-preset">Provider</Label>
                <Select value={presetId} onValueChange={applyPreset}>
                  <SelectTrigger id="api-provider-preset"><SelectValue placeholder="Choose provider" /></SelectTrigger>
                  <SelectContent>
                    {providerPresets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="api-provider-value">Value</Label>
                <Input id="api-provider-value" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Paste API key or token" type="password" autoComplete="off" />
              </div>
            </div>

            {presetId === "custom" && (
              <div className="space-y-1.5">
                <Label htmlFor="api-provider-name">Custom name</Label>
                <Input id="api-provider-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="My API provider" autoComplete="off" />
              </div>
            )}

            <button type="button" onClick={() => setShowOptionalDetails((current) => !current)} className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showOptionalDetails ? "rotate-180" : ""}`} /> Optional details
            </button>

            {showOptionalDetails && (
              <div className="grid grid-cols-1 gap-3 rounded-md border bg-background/50 p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="api-adapter-type">Adapter / protocol type</Label>
                  <Select value={adapterType} onValueChange={(value) => setAdapterType(value as AdapterType)}>
                    <SelectTrigger id="api-adapter-type"><SelectValue placeholder="Automatic" /></SelectTrigger>
                    <SelectContent>{adapterTypes.map((type) => <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">{selectedAdapter?.description ?? "Automatic is recommended unless the provider needs a specific protocol."}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="api-provider-model">Model</Label>
                    <Input id="api-provider-model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="Optional" autoComplete="off" />
                    <p className="text-[11px] text-muted-foreground">AI providers can auto-detect model where supported.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="api-provider-endpoint">API Base URL / Endpoint</Label>
                    <Input id="api-provider-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="Optional" autoComplete="off" />
                    <p className="text-[11px] text-muted-foreground">Preset providers usually fill this automatically.</p>
                  </div>
                </div>
              </div>
            )}

            <Button type="button" onClick={handleAdd} disabled={saving} className="w-full sm:w-auto">{saving ? "Saving..." : "Save API"}</Button>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Registered APIs</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => void loadProviders()} disabled={loading} className="gap-2"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
          </div>
          {loading ? <div className="h-16 rounded-lg bg-muted animate-pulse" /> : registeredProviders.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No APIs registered yet. Click <span className="font-medium text-foreground">Add API</span> and choose Venice, Render, Railway, GitHub or another provider.</div>
          ) : registeredProviders.map((provider) => (
            <div key={provider.id} className="rounded-lg border p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium truncate">{provider.label || displayNameFromId(provider.id)}</p>
                  <Badge variant="outline" className="text-emerald-500 border-emerald-500/40 bg-emerald-500/10 gap-1"><CheckCircle2 className="h-3 w-3" /> Registered</Badge>
                  {provider.category && <Badge variant="secondary">{provider.category}</Badge>}
                  {provider.enabled === false && <Badge variant="outline">Disabled</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-1 font-mono">{provider.id}</p>
                <p className="text-xs text-muted-foreground mt-1">Adapter: {adapterLabel(adapterTypes, provider.adapterType)}</p>
                {provider.model && <p className="text-xs text-muted-foreground mt-1">Model: {provider.model}</p>}
                {provider.endpoint && <p className="text-xs text-muted-foreground mt-1 truncate">Endpoint: {provider.endpoint}</p>}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => void handleDelete(provider)} disabled={saving} className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /><span className="sr-only">Remove</span></Button>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter><p className="text-xs text-muted-foreground">Keys are never returned to the browser. VIBA only shows provider, adapter type and registered status.</p></CardFooter>
    </Card>
  );
}
