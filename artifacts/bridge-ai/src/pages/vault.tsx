import { useState, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Shield, RefreshCw, Trash2, RotateCcw, CheckCircle2, XCircle, Clock,
  AlertTriangle, Eye, EyeOff, ChevronDown, ChevronUp, Key, Activity,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Credential {
  provider: string;
  kind: string;
  label: string;
  scope: string;
  status: string;
  configured: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  last_validated_at: string | null;
  last_error: string | null;
  updated_at: string | null;
  rawValueReturned: false;
}

interface AccessLog {
  provider: string;
  kind: string;
  label: string;
  purpose: string | null;
  job_id: string | null;
  scope: string | null;
  source: string;
  status: string;
  created_at: string;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function isExpired(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return new Date(iso) < new Date();
}

function StatusBadge({ status, expired }: { status: string; expired?: boolean }) {
  if (expired) return <Badge variant="destructive" className="text-xs gap-1"><AlertTriangle className="h-3 w-3" />Expired</Badge>;
  if (status === "valid") return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs gap-1"><CheckCircle2 className="h-3 w-3" />Valid</Badge>;
  if (status === "invalid") return <Badge variant="destructive" className="text-xs gap-1"><XCircle className="h-3 w-3" />Invalid</Badge>;
  return <Badge variant="secondary" className="text-xs gap-1"><Clock className="h-3 w-3" />Saved</Badge>;
}

function ProviderLabel({ provider, kind }: { provider: string; kind: string }) {
  const name = provider.startsWith("custom_ai__")
    ? provider.replace(/^custom_ai__/, "").replace(/_/g, " ")
    : provider;
  return (
    <div>
      <p className="font-medium text-sm capitalize">{name}</p>
      <p className="text-xs text-muted-foreground">{kind}</p>
    </div>
  );
}

function RotateDialog({
  cred,
  onClose,
  onDone,
}: {
  cred: Credential;
  onClose: () => void;
  onDone: () => void;
}) {
  const [newValue, setNewValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function handleSave() {
    if (!newValue.trim()) { toast({ title: "Value required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/credentials/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider: cred.provider, kind: cred.kind, label: cred.label, value: newValue.trim() }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Save failed");
      setNewValue("");
      toast({ title: "Credential replaced", description: "The encrypted vault value was overwritten. The old value cannot be recovered." });
      onDone();
    } catch (err) {
      toast({ title: "Failed to save", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl space-y-4">
        <div>
          <p className="text-sm font-semibold text-amber-400 flex items-center gap-1.5"><RotateCcw className="h-4 w-4" />Replace credential</p>
          <p className="text-xs text-zinc-400 mt-1">Replacing this credential overwrites the encrypted vault value. The old value cannot be recovered.</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-300">New value</Label>
          <div className="relative">
            <Input
              type={showValue ? "text" : "password"}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Paste new secret value…"
              className="pr-10 bg-zinc-800 border-zinc-700 text-sm font-mono"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowValue((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <p className="text-xs text-zinc-500">•••••••• saved — raw value never shown after saving.</p>
        <div className="flex gap-3 pt-1">
          <Button variant="outline" className="flex-1 border-zinc-700 text-zinc-300" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="flex-1" onClick={handleSave} disabled={saving || !newValue.trim()}>
            {saving ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
            Save securely
          </Button>
        </div>
      </div>
    </div>
  );
}

function DeleteDialog({ cred, onClose, onDone }: { cred: Credential; onClose: () => void; onDone: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  async function handleDelete() {
    setDeleting(true);
    try {
      const r = await fetch(`${BASE}/api/credentials`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider: cred.provider, kind: cred.kind, label: cred.label }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Delete failed");
      toast({ title: "Credential deleted", description: "Deleting this credential stops VIBA from using it for future tasks. Existing provider accounts are not deleted." });
      onDone();
    } catch (err) {
      toast({ title: "Failed to delete", description: String(err), variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl space-y-4">
        <p className="text-sm font-semibold text-red-400 flex items-center gap-1.5"><Trash2 className="h-4 w-4" />Delete credential</p>
        <p className="text-sm text-zinc-300">Deleting this credential will stop VIBA from using it for future tasks. Existing provider accounts are not deleted.</p>
        <p className="text-xs text-zinc-500"><span className="font-mono text-zinc-400">{cred.provider}</span> · {cred.kind} · {cred.label}</p>
        <div className="flex gap-3 pt-1">
          <Button variant="outline" className="flex-1 border-zinc-700 text-zinc-300" onClick={onClose} disabled={deleting}>Cancel</Button>
          <Button variant="destructive" className="flex-1" onClick={handleDelete} disabled={deleting}>
            {deleting ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

function LogsDrawer({ cred, onClose }: { cred: Credential; onClose: () => void }) {
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(true);

  useState(() => {
    fetch(`${BASE}/api/credentials/access-logs?provider=${encodeURIComponent(cred.provider)}&limit=50`, { credentials: "include" })
      .then((r) => r.json())
      .then((d: { logs?: AccessLog[] }) => setLogs(d.logs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[80vh] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <p className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-primary" />
            Usage log — <span className="font-mono text-zinc-400 ml-1">{cred.provider}</span>
          </p>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {loading && <p className="text-sm text-zinc-500 text-center py-8">Loading…</p>}
          {!loading && logs.length === 0 && (
            <p className="text-sm text-zinc-500 text-center py-8">No access log entries yet.</p>
          )}
          {logs.map((l, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-800/40 p-3 text-xs">
              <span className={`mt-0.5 shrink-0 h-2 w-2 rounded-full ${l.status === "granted" ? "bg-emerald-500" : "bg-red-500"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-zinc-300">
                  <span className="font-medium">{l.status}</span>
                  <span className="text-zinc-500">·</span>
                  <span>source: <span className="text-zinc-300">{l.source}</span></span>
                  {l.scope && <span>scope: <span className="text-zinc-300">{l.scope}</span></span>}
                  {l.purpose && <span>purpose: <span className="text-zinc-300">{l.purpose}</span></span>}
                </div>
                <p className="text-zinc-500 mt-0.5">{fmtDate(l.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CredentialRow({
  cred,
  onRefresh,
}: {
  cred: Credential;
  onRefresh: () => void;
}) {
  const [validating, setValidating] = useState(false);
  const [showRotate, setShowRotate] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();

  const expired = isExpired(cred.expires_at);

  async function handleValidate() {
    setValidating(true);
    try {
      const r = await fetch(`${BASE}/api/credentials/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider: cred.provider, kind: cred.kind, label: cred.label }),
      });
      const d = await r.json() as { ok?: boolean; message?: string };
      if (d.ok) {
        toast({ title: "Valid", description: d.message ?? "Credential is valid." });
      } else {
        toast({ title: "Invalid", description: d.message ?? "Credential failed validation.", variant: "destructive" });
      }
      onRefresh();
    } catch {
      toast({ title: "Validate failed", variant: "destructive" });
    } finally {
      setValidating(false);
    }
  }

  return (
    <>
      {showRotate && <RotateDialog cred={cred} onClose={() => setShowRotate(false)} onDone={() => { setShowRotate(false); onRefresh(); }} />}
      {showDelete && <DeleteDialog cred={cred} onClose={() => setShowDelete(false)} onDone={() => { setShowDelete(false); onRefresh(); }} />}
      {showLogs && <LogsDrawer cred={cred} onClose={() => setShowLogs(false)} />}

      <div className={`border-b border-zinc-800/60 last:border-b-0 ${expanded ? "bg-zinc-800/20" : ""}`}>
        <div className="grid grid-cols-[1fr_auto] gap-2 items-center px-4 py-3">
          <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1.5fr_1fr_1fr_1fr] gap-3 items-center min-w-0">
            <ProviderLabel provider={cred.provider} kind={cred.kind} />
            <div className="hidden sm:block">
              <p className="text-xs text-zinc-400">{cred.scope ?? "all"}</p>
              <p className="text-xs text-zinc-600">{cred.label}</p>
            </div>
            <StatusBadge status={cred.status} expired={expired} />
            <div className="hidden md:block text-xs text-zinc-500">{fmtDate(cred.last_used_at)}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-200" onClick={handleValidate} disabled={validating} title="Validate">
              {validating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-zinc-400 hover:text-amber-400" onClick={() => setShowRotate(true)} title="Rotate / Replace">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-zinc-400 hover:text-red-400" onClick={() => setShowDelete(true)} title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-zinc-400 hover:text-primary" onClick={() => setShowLogs(true)} title="View usage log">
              <Activity className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 px-0 text-zinc-500 hover:text-zinc-300" onClick={() => setExpanded((v) => !v)}>
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs border-t border-zinc-800/40 pt-3">
            <div><span className="text-zinc-500">Provider</span> <span className="text-zinc-300 font-mono ml-1">{cred.provider}</span></div>
            <div><span className="text-zinc-500">Kind</span> <span className="text-zinc-300 ml-1">{cred.kind}</span></div>
            <div><span className="text-zinc-500">Label</span> <span className="text-zinc-300 ml-1">{cred.label}</span></div>
            <div><span className="text-zinc-500">Scope</span> <span className="text-zinc-300 ml-1">{cred.scope ?? "all"}</span></div>
            <div><span className="text-zinc-500">Updated</span> <span className="text-zinc-300 ml-1">{fmtDate(cred.updated_at)}</span></div>
            <div><span className="text-zinc-500">Expires</span> <span className={`ml-1 ${expired ? "text-red-400" : "text-zinc-300"}`}>{fmtDate(cred.expires_at)}</span></div>
            <div><span className="text-zinc-500">Last validated</span> <span className="text-zinc-300 ml-1">{fmtDate(cred.last_validated_at)}</span></div>
            <div><span className="text-zinc-500">Last used</span> <span className="text-zinc-300 ml-1">{fmtDate(cred.last_used_at)}</span></div>
            {cred.last_error && (
              <div className="col-span-2 sm:col-span-3">
                <span className="text-zinc-500">Last error</span>
                <span className="text-red-400 ml-1">{cred.last_error}</span>
              </div>
            )}
            <div className="col-span-2 sm:col-span-3 mt-0.5 text-zinc-600 italic">
              •••••••• saved — credentials are encrypted in your secure vault and never shown after saving.
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function VaultPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${BASE}/api/credentials/vault-list`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json() as { credentials?: Credential[]; rawValueReturned?: false };
      if (d.rawValueReturned !== false) {
        toast({ title: "Security warning", description: "Server returned unexpected raw values — refresh aborted.", variant: "destructive" });
        return;
      }
      setCredentials(d.credentials ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useState(() => { void load(); });

  const groups = credentials.reduce<Record<string, Credential[]>>((acc, c) => {
    const g = c.provider.startsWith("custom_ai__") ? "Custom AI" : c.provider;
    (acc[g] ??= []).push(c);
    return acc;
  }, {});

  return (
    <AppLayout>
      <div className="container max-w-4xl py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2.5">
              <Shield className="h-6 w-6 text-primary" />
              Secure Vault
            </h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-xl">
              Credentials are encrypted in your secure vault. VIBA can use them server-side only for your authorized tasks. Raw values are never shown after saving.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            Failed to load vault: {error}
          </div>
        )}

        {!loading && !error && credentials.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <Key className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">No credentials saved yet</p>
              <p className="text-xs text-muted-foreground/60 max-w-xs">
                Add your AI provider keys on the <a href="/providers" className="underline underline-offset-2 text-primary/70 hover:text-primary">AI Providers</a> page. They'll appear here as a secure encrypted inventory.
              </p>
            </CardContent>
          </Card>
        )}

        {Object.entries(groups).map(([group, items]) => (
          <Card key={group} className="overflow-hidden">
            <CardHeader className="py-3 px-4 bg-zinc-900/50 border-b border-zinc-800/60">
              <CardTitle className="text-sm font-medium capitalize flex items-center gap-2">
                <Key className="h-3.5 w-3.5 text-primary" />
                {group.replace(/_/g, " ")}
                <span className="ml-auto text-xs font-normal text-muted-foreground">{items.length} credential{items.length !== 1 ? "s" : ""}</span>
              </CardTitle>
            </CardHeader>

            <div className="hidden sm:grid grid-cols-[1.5fr_1fr_1fr_1fr_auto] gap-3 px-4 py-2 border-b border-zinc-800/30 bg-zinc-900/20">
              {["Provider / Type", "Scope", "Status", "Last used", "Actions"].map((h) => (
                <span key={h} className="text-[11px] font-medium text-zinc-500 uppercase tracking-wide">{h}</span>
              ))}
            </div>

            {items.map((cred) => (
              <CredentialRow
                key={`${cred.provider}::${cred.kind}::${cred.label}`}
                cred={cred}
                onRefresh={load}
              />
            ))}
          </Card>
        ))}

        <Card className="border-zinc-800/40 bg-zinc-950/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-400 font-medium flex items-center gap-1.5"><Shield className="h-4 w-4" />Security note</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-zinc-400 space-y-1.5">
            <p>Your saved credentials are encrypted at rest using AES-256-GCM. VIBA can use them server-side for authorized tasks only.</p>
            <p>Raw API keys, tokens, passwords, secrets, and webhook secrets are never returned to the frontend after saving.</p>
            <p>Access is logged per use. You can view the usage log for any credential using the activity icon.</p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
