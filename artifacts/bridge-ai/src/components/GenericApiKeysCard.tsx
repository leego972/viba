import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, CheckCircle2, Key, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

type ProviderStatus = "configured" | "not_configured" | "disabled";

type Provider = {
  id: string;
  label: string;
  description?: string;
  hasKey?: boolean;
  enabled?: boolean;
  model?: string;
  endpoint?: string;
  status?: ProviderStatus;
};

function providerIdFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function displayNameFromId(id: string): string {
  return id
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || id;
}

export function GenericApiKeysCard() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showOptionalDetails, setShowOptionalDetails] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [model, setModel] = useState("");
  const [endpoint, setEndpoint] = useState("");

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/providers", { credentials: "include" });
      if (!response.ok) throw new Error(`Provider list failed with HTTP ${response.status}`);
      const payload = (await response.json()) as { providers?: Provider[] };
      setProviders(payload.providers ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load API providers.";
      toast({ title: "API list failed", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const registeredProviders = useMemo(
    () => providers.filter((provider) => provider.hasKey || provider.status === "configured" || Boolean(provider.endpoint)),
    [providers],
  );

  const handleAdd = async () => {
    const id = providerIdFromName(name);
    const key = value.trim();
    if (!id) {
      toast({ title: "Name required", description: "Enter a provider name such as Venice, OpenRouter, Groq, or Custom Client.", variant: "destructive" });
      return;
    }
    if (!key) {
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
          model: model.trim() || undefined,
          endpoint: endpoint.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Save failed with HTTP ${response.status}`);
      }
      toast({ title: "API saved", description: `${displayNameFromId(id)} was saved to the VIBA vault.` });
      setName("");
      setValue("");
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
      const response = await fetch(`/api/providers/${encodeURIComponent(provider.id)}/keys/default`, {
        method: "DELETE",
        credentials: "include",
      });
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
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" /> API Keys
            </CardTitle>
            <CardDescription>
              Add any provider once. Required: name and API key. Optional details can be added only when needed.
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
                <Label htmlFor="api-provider-name">Name</Label>
                <Input
                  id="api-provider-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Venice"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="api-provider-value">Value</Label>
                <Input
                  id="api-provider-value"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="Paste API key"
                  type="password"
                  autoComplete="off"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowOptionalDetails((current) => !current)}
              className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showOptionalDetails ? "rotate-180" : ""}`} />
              Optional details
            </button>

            {showOptionalDetails && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-md border bg-background/50 p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="api-provider-model">Model</Label>
                  <Input
                    id="api-provider-model"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="Leave blank to auto-detect"
                    autoComplete="off"
                  />
                  <p className="text-[11px] text-muted-foreground">VIBA will try to detect a model if this is empty.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="api-provider-endpoint">API Base URL / Endpoint</Label>
                  <Input
                    id="api-provider-endpoint"
                    value={endpoint}
                    onChange={(event) => setEndpoint(event.target.value)}
                    placeholder="Usually ends in /v1"
                    autoComplete="off"
                  />
                  <p className="text-[11px] text-muted-foreground">Only needed if VIBA does not already know this provider endpoint.</p>
                </div>
              </div>
            )}

            <Button type="button" onClick={handleAdd} disabled={saving} className="w-full sm:w-auto">
              {saving ? "Saving..." : "Save API"}
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Registered APIs</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => void loadProviders()} disabled={loading} className="gap-2">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>

          {loading ? (
            <div className="h-16 rounded-lg bg-muted animate-pulse" />
          ) : registeredProviders.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No APIs registered yet. Click <span className="font-medium text-foreground">Add API</span> and enter the provider name and value.
            </div>
          ) : (
            registeredProviders.map((provider) => (
              <div key={provider.id} className="rounded-lg border p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium truncate">{provider.label || displayNameFromId(provider.id)}</p>
                    <Badge variant="outline" className="text-emerald-500 border-emerald-500/40 bg-emerald-500/10 gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Registered
                    </Badge>
                    {provider.enabled === false && <Badge variant="outline">Disabled</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 font-mono">{provider.id}</p>
                  {provider.model && <p className="text-xs text-muted-foreground mt-1">Model: {provider.model}</p>}
                  {provider.endpoint && <p className="text-xs text-muted-foreground mt-1 truncate">Base URL: {provider.endpoint}</p>}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDelete(provider)}
                  disabled={saving}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Remove</span>
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
      <CardFooter>
        <p className="text-xs text-muted-foreground">
          Keys are never returned to the browser. This list only shows provider names and status.
        </p>
      </CardFooter>
    </Card>
  );
}
