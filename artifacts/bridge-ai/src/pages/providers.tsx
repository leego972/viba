import { useCallback, useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Pencil, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";

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

const CANONICAL_PROVIDER: Record<string, string> = {
  gemini: "google",
};

function canonicalId(id: string): string {
  return CANONICAL_PROVIDER[id] ?? id;
}

function mergeProviders(input: Omit<ProviderInfo, "sourceIds">[]): ProviderInfo[] {
  const merged = new Map<string, ProviderInfo>();

  for (const provider of input) {
    const id = canonicalId(provider.id);
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, {
        ...provider,
        id,
        label: id === "google" ? "Google Gemini" : provider.label,
        sourceIds: [provider.id],
      });
      continue;
    }

    existing.sourceIds = Array.from(new Set([...existing.sourceIds, provider.id]));
    existing.hasKey = existing.hasKey || provider.hasKey;
    existing.enabled = existing.enabled || provider.enabled;
    existing.status = existing.hasKey
      ? existing.enabled
        ? "configured"
        : "disabled"
      : "not_configured";
  }

  return [...merged.values()].sort((a, b) => {
    if (a.hasKey !== b.hasKey) return a.hasKey ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

function StatusBadge({ provider, test }: { provider: ProviderInfo; test?: TestState }) {
  if (test?.reachable) {
    return (
      <Badge className="border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
        <CheckCircle2 className="mr-1 h-3 w-3" /> Verified
      </Badge>
    );
  }
  if (provider.hasKey && provider.enabled) {
    return (
      <Badge className="border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300">
        <KeyRound className="mr-1 h-3 w-3" /> Key saved
      </Badge>
    );
  }
  if (provider.hasKey) {
    return <Badge variant="secondary">Saved · disabled</Badge>;
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <XCircle className="mr-1 h-3 w-3" /> Not saved
    </Badge>
  );
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
      setProviders(mergeProviders(payload.providers));
    } catch {
      toast({ title: "Could not load API providers", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchProviders();
  }, [fetchProviders]);

  const openProvider = useMemo(() => providers.find((provider) => provider.id === openId), [providers, openId]);

  async function loadKeys(provider: ProviderInfo) {
    const results = await Promise.all(
      provider.sourceIds.map(async (sourceId) => {
        const response = await fetch(`/api/providers/${sourceId}/keys`, { credentials: "include" });
        if (!response.ok) return [] as SavedKey[];
        const payload = (await response.json()) as { keys: Array<Omit<SavedKey, "providerId">> };
        return payload.keys
          .filter((key) => key.status !== "deleted")
          .map((key) => ({ ...key, providerId: sourceId }));
      }),
    );
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
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: name, key: value }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await fetch(`/api/providers/${provider.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
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
    const response = await fetch(
      `/api/providers/${key.providerId}/keys/${encodeURIComponent(key.label)}`,
      { method: "DELETE", credentials: "include" },
    );
    if (!response.ok) {
      toast({ title: "Could not delete API key", variant: "destructive" });
      return;
    }
    await Promise.all([loadKeys(provider), fetchProviders()]);
  }

  async function setEnabled(provider: ProviderInfo, enabled: boolean) {
    const response = await fetch(`/api/providers/${provider.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) {
      toast({ title: "Provider state was not updated", variant: "destructive" });
      return;
    }
    await fetchProviders();
  }

  async function testProvider(provider: ProviderInfo) {
    setTests((previous) => ({
      ...previous,
      [provider.id]: { testing: true, ok: null, reachable: false, message: "Testing…" },
    }));
    try {
      const response = await fetch(`/api/providers/${provider.id}/test`, {
        method: "POST",
        credentials: "include",
      });
      const payload = (await response.json()) as {
        configured?: boolean;
        reachable?: boolean;
        requiresManualValidation?: boolean;
        message?: string;
      };
      setTests((previous) => ({
        ...previous,
        [provider.id]: {
          testing: false,
          ok: Boolean(payload.configured),
          reachable: Boolean(payload.reachable),
          message: payload.message ?? "No result returned.",
        },
      }));
    } catch {
      setTests((previous) => ({
        ...previous,
        [provider.id]: { testing: false, ok: false, reachable: false, message: "Connection test failed." },
      }));
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API Connections</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Store each API using a name and value. A saved key is not labelled “Verified” until the provider confirms it.
          </p>
        </div>

        {loading ? (
          <div className="flex min-h-48 items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {providers.map((provider) => {
              const test = tests[provider.id];
              const keys = savedKeys[provider.id] ?? [];
              const isOpen = openId === provider.id;
              return (
                <Card key={provider.id} className="overflow-hidden">
                  <CardHeader className="p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <CardTitle className="text-base">{provider.label}</CardTitle>
                          <StatusBadge provider={provider} test={test} />
                        </div>
                        <CardDescription className="mt-1 break-words">{provider.description}</CardDescription>
                      </div>
                      <div className="flex items-center gap-2 self-start">
                        <Switch
                          checked={provider.enabled}
                          disabled={!provider.hasKey}
                          onCheckedChange={(enabled) => void setEnabled(provider, enabled)}
                          aria-label={`${provider.enabled ? "Disable" : "Enable"} ${provider.label}`}
                        />
                        <Button variant="outline" size="sm" onClick={() => void beginEdit(provider)}>
                          {provider.hasKey ? <Pencil className="mr-1.5 h-3.5 w-3.5" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
                          {provider.hasKey ? "Edit APIs" : "Add API"}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  {isOpen && openProvider && (
                    <CardContent className="space-y-5 border-t bg-muted/20 p-4 sm:p-5">
                      {keys.length > 0 && (
                        <div className="space-y-2">
                          <Label>Saved APIs</Label>
                          {keys.map((key) => (
                            <div key={`${key.providerId}:${key.label}`} className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{key.label}</div>
                                <div className="text-xs text-muted-foreground">Value stored securely</div>
                              </div>
                              <Button variant="ghost" size="icon" onClick={() => void deleteKey(provider, key)} aria-label={`Delete ${key.label}`}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor={`api-name-${provider.id}`}>Name</Label>
                          <Input
                            id={`api-name-${provider.id}`}
                            value={keyName}
                            onChange={(event) => setKeyName(event.target.value)}
                            placeholder="e.g. Main account"
                            autoComplete="off"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`api-value-${provider.id}`}>Value</Label>
                          <div className="relative">
                            <Input
                              id={`api-value-${provider.id}`}
                              type={showValue ? "text" : "password"}
                              value={keyValue}
                              onChange={(event) => setKeyValue(event.target.value)}
                              placeholder="Paste API key"
                              className="pr-10 font-mono"
                              autoComplete="new-password"
                            />
                            <button
                              type="button"
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                              onClick={() => setShowValue((visible) => !visible)}
                              aria-label={showValue ? "Hide API value" : "Show API value"}
                            >
                              {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button onClick={() => void saveKey(provider)} disabled={saving || !keyName.trim() || !keyValue.trim()}>
                          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Save API
                        </Button>
                        {provider.hasKey && (
                          <Button variant="outline" onClick={() => void testProvider(provider)} disabled={test?.testing}>
                            {test?.testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Verify connection
                          </Button>
                        )}
                      </div>

                      {test?.message && (
                        <div className={`rounded-lg border px-3 py-2 text-sm ${test.ok ? "border-emerald-500/30 bg-emerald-500/8" : "border-destructive/30 bg-destructive/8"}`}>
                          {test.message}
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
