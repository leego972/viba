import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Key, Plus, RefreshCw, Save, Shield, Trash2, XCircle } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PROVIDERS = [
  { id: "github", label: "GitHub", defaultKind: "token", help: "GitHub token for repo access." },
  { id: "railway", label: "Railway", defaultKind: "token", help: "Railway API token." },
  { id: "render", label: "Render", defaultKind: "token", help: "Render API key. Save service ID separately if needed." },
  { id: "openai", label: "OpenAI", defaultKind: "api_key", help: "OpenAI API key." },
  { id: "anthropic", label: "Anthropic", defaultKind: "api_key", help: "Claude/Anthropic API key." },
  { id: "gemini", label: "Gemini", defaultKind: "api_key", help: "Google Gemini API key." },
  { id: "groq", label: "Groq", defaultKind: "api_key", help: "Groq API key." },
  { id: "perplexity", label: "Perplexity", defaultKind: "api_key", help: "Perplexity API key." },
  { id: "replit", label: "Replit", defaultKind: "api_key", help: "Replit API key or agent token." },
  { id: "manus", label: "Manus", defaultKind: "api_key", help: "Manus workspace/API key." },
  { id: "railway_mcp", label: "Railway MCP", defaultKind: "url", help: "Railway MCP URL." },
];

type CredentialRow = {
  provider: string;
  kind: string;
  label: string;
  scope?: string | null;
  status?: string | null;
  configured?: boolean;
  expires_at?: string | null;
  last_used_at?: string | null;
  last_validated_at?: string | null;
  last_error?: string | null;
  updated_at?: string | null;
};

function providerLabel(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.label ?? id;
}

function statusBadge(status?: string | null) {
  if (status === "valid") {
    return <Badge className="gap-1 bg-emerald-500/15 text-emerald-400 border-emerald-500/30"><CheckCircle2 className="h-3 w-3" />Valid</Badge>;
  }
  if (status === "invalid") {
    return <Badge className="gap-1 bg-red-500/15 text-red-400 border-red-500/30"><XCircle className="h-3 w-3" />Invalid</Badge>;
  }
  return <Badge variant="outline" className="gap-1 text-muted-foreground"><Key className="h-3 w-3" />Saved</Badge>;
}

export default function VaultPage() {
  const { toast } = useToast();
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validatingKey, setValidatingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const [provider, setProvider] = useState("github");
  const [kind, setKind] = useState("token");
  const [label, setLabel] = useState("default");
  const [value, setValue] = useState("");

  const selectedProvider = useMemo(() => PROVIDERS.find((p) => p.id === provider), [provider]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("action") === "add") setShowForm(true);
  }, []);

  async function loadVault() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/credentials/vault-list`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { credentials?: CredentialRow[] };
      setCredentials(data.credentials ?? []);
    } catch {
      toast({ title: "Failed to load vault", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadVault(); }, []);

  function resetForm() {
    setProvider("github");
    setKind("token");
    setLabel("default");
    setValue("");
    setShowSecret(false);
  }

  async function saveCredential() {
    if (!provider || !kind.trim() || !label.trim() || !value.trim()) {
      toast({ title: "Missing credential details", description: "Provider, kind, label, and secret value are required.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/credentials/save`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, kind: kind.trim(), label: label.trim(), value: value.trim() }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast({ title: "Credential saved", description: data.message ?? "Encrypted credential saved. Raw value will not be shown again." });
      resetForm();
      setShowForm(false);
      await loadVault();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Credential could not be saved.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function validateCredential(row: CredentialRow) {
    const key = `${row.provider}:${row.kind}:${row.label}`;
    setValidatingKey(key);
    try {
      const res = await fetch(`${BASE}/api/credentials/validate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: row.provider, kind: row.kind, label: row.label }),
      });
      const data = await res.json().catch(() => ({})) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      toast({ title: "Credential valid", description: data.message ?? "Validation passed." });
      await loadVault();
    } catch (err) {
      toast({ title: "Validation failed", description: err instanceof Error ? err.message : "Credential validation failed.", variant: "destructive" });
      await loadVault();
    } finally {
      setValidatingKey(null);
    }
  }

  async function deleteCredential(row: CredentialRow) {
    const key = `${row.provider}:${row.kind}:${row.label}`;
    setDeletingKey(key);
    try {
      const res = await fetch(`${BASE}/api/credentials`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: row.provider, kind: row.kind, label: row.label }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast({ title: "Credential deleted" });
      await loadVault();
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : "Credential could not be deleted.", variant: "destructive" });
    } finally {
      setDeletingKey(null);
    }
  }

  function handleProviderChange(nextProvider: string) {
    setProvider(nextProvider);
    const p = PROVIDERS.find((item) => item.id === nextProvider);
    if (p) setKind(p.defaultKind);
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Shield className="h-4 w-4 text-primary" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">Secure Vault</h1>
            </div>
            <p className="text-sm text-muted-foreground pl-12">
              Add, validate, and delete encrypted API keys and deployment tokens. Secret values are never shown after saving.
            </p>
          </div>
          <Button className="gap-1.5" onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-4 w-4" />
            {showForm ? "Close form" : "Add credential"}
          </Button>
        </div>

        <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 flex gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-200/80">
            Save credentials only for accounts you own or are authorised to use. VIBA stores encrypted metadata and never returns raw secret values to the browser.
          </p>
        </div>

        {showForm && (
          <Card className="border-primary/25 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Key className="h-4 w-4" />Add Credential</CardTitle>
              <CardDescription>Choose the provider, label the credential, paste the secret, then save.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Provider</Label>
                  <Select value={provider} onValueChange={handleProviderChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Kind</Label>
                  <Input value={kind} onChange={(e) => setKind(e.target.value)} placeholder="token / api_key / url / service_id" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Label</Label>
                  <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="default / production / personal" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Secret value</Label>
                <div className="relative">
                  <Input
                    type={showSecret ? "text" : "password"}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Paste API key, token, URL, or credential value…"
                    className="font-mono pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{selectedProvider?.help}</p>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { resetForm(); setShowForm(false); }} disabled={saving}>Cancel</Button>
                <Button onClick={saveCredential} disabled={saving} className="gap-1.5">
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save encrypted credential
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border-white/[0.07] bg-white/[0.01]">
          <CardHeader>
            <CardTitle className="text-base">Saved Credentials</CardTitle>
            <CardDescription>Metadata only. Raw secret values are not displayed.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-24 flex items-center justify-center text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin" />
              </div>
            ) : credentials.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/[0.12] p-8 text-center space-y-3">
                <Key className="h-8 w-8 mx-auto text-muted-foreground" />
                <div>
                  <p className="font-medium">No credentials saved yet</p>
                  <p className="text-sm text-muted-foreground">Click Add credential to store your first API key or deployment token.</p>
                </div>
                <Button onClick={() => setShowForm(true)} className="gap-1.5"><Plus className="h-4 w-4" />Add credential</Button>
              </div>
            ) : (
              <div className="space-y-3">
                {credentials.map((row) => {
                  const key = `${row.provider}:${row.kind}:${row.label}`;
                  return (
                    <div key={key} className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{providerLabel(row.provider)}</p>
                          {statusBadge(row.status)}
                          <Badge variant="outline" className="text-[11px]">{row.kind}</Badge>
                          <Badge variant="secondary" className="text-[11px]">{row.label}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Updated: {row.updated_at ? new Date(row.updated_at).toLocaleString() : "unknown"}
                          {row.last_validated_at ? ` · Validated: ${new Date(row.last_validated_at).toLocaleString()}` : ""}
                        </p>
                        {row.last_error && <p className="text-xs text-red-300">{row.last_error}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button variant="outline" size="sm" onClick={() => validateCredential(row)} disabled={validatingKey === key} className="gap-1.5 text-xs">
                          {validatingKey === key ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          Validate
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => deleteCredential(row)} disabled={deletingKey === key} className="gap-1.5 text-xs">
                          {deletingKey === key ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          Delete
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
