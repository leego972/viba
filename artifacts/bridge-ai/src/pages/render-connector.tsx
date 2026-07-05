import { useState, useCallback, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, Clock,
  RefreshCw, Zap, Terminal, Eye, EyeOff, Server, Globe,
  CloudUpload, List, KeyRound, FileText, ChevronDown, ChevronUp,
  Play, Info,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectorStatus {
  apiAvailable: boolean;
  apiKeyConfigured: boolean;
  serviceIdConfigured: boolean;
  serviceId: string | null;
  serviceName: string | null;
  serviceStatus: string | null;
  serviceType: string | null;
  serviceUrl: string | null;
  lastDeployStatus: string | null;
  lastDeployCreatedAt: string | null;
  error?: string;
}

interface RenderService {
  id: string;
  name: string;
  type: string;
  status: string;
  serviceUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Deploy {
  id: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  commitMessage: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deployStatusColor(s: string) {
  switch (s) {
    case "live":
    case "succeeded": return "text-emerald-400";
    case "failed":
    case "canceled": return "text-red-400";
    case "in_progress":
    case "building":
    case "update_in_progress": return "text-blue-400";
    default: return "text-white/50";
  }
}

function deployStatusIcon(s: string) {
  switch (s) {
    case "live":
    case "succeeded": return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    case "failed":
    case "canceled": return <XCircle className="h-4 w-4 text-red-400" />;
    case "in_progress":
    case "building":
    case "update_in_progress": return <RefreshCw className="h-4 w-4 text-blue-400 animate-spin" />;
    default: return <Clock className="h-4 w-4 text-white/40" />;
  }
}

function serviceStatusBadge(s: string) {
  const lower = s.toLowerCase();
  if (lower === "not_suspended" || lower === "active" || lower === "live") {
    return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Active</Badge>;
  }
  if (lower === "suspended") {
    return <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30">Suspended</Badge>;
  }
  return <Badge className="bg-white/10 text-white/50 border-white/20">{s || "Unknown"}</Badge>;
}

function fmt(iso: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

// ─── Section: Status ──────────────────────────────────────────────────────────

function StatusSection() {
  const { toast } = useToast();
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/render-connector/status`);
      const data = await res.json() as { status: ConnectorStatus };
      setStatus(data.status);
    } catch (err) {
      toast({ title: "Status fetch failed", description: String(err), variant: "destructive" });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { void fetch_(); }, [fetch_]);

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Connector Status
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={fetch_} disabled={loading} className="h-8 gap-1.5 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!status ? (
          <p className="text-sm text-white/40">{loading ? "Checking…" : "No data"}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 space-y-0.5">
                <p className="text-[11px] text-white/40 uppercase tracking-wide">API Key</p>
                <div className="flex items-center gap-1.5">
                  {status.apiKeyConfigured
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    : <XCircle className="h-3.5 w-3.5 text-red-400" />}
                  <span className="text-sm font-medium">
                    {status.apiKeyConfigured ? "Configured" : "Missing"}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 space-y-0.5">
                <p className="text-[11px] text-white/40 uppercase tracking-wide">API Reachable</p>
                <div className="flex items-center gap-1.5">
                  {status.apiAvailable
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    : <XCircle className="h-3.5 w-3.5 text-red-400" />}
                  <span className="text-sm font-medium">
                    {status.apiAvailable ? "Online" : "Unreachable"}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 space-y-0.5">
                <p className="text-[11px] text-white/40 uppercase tracking-wide">Service ID</p>
                <div className="flex items-center gap-1.5">
                  {status.serviceIdConfigured
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    : <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />}
                  <span className="text-sm font-medium">
                    {status.serviceIdConfigured ? "Set" : "Not set"}
                  </span>
                </div>
              </div>
            </div>

            {status.serviceName && (
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-[11px] text-white/40 uppercase tracking-wide mb-0.5">Service</p>
                  <p className="font-medium truncate">{status.serviceName}</p>
                </div>
                <div>
                  <p className="text-[11px] text-white/40 uppercase tracking-wide mb-0.5">Type</p>
                  <p className="font-medium">{status.serviceType ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-white/40 uppercase tracking-wide mb-0.5">State</p>
                  <p className={`font-medium ${deployStatusColor(status.serviceStatus ?? "")}`}>
                    {status.serviceStatus ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-white/40 uppercase tracking-wide mb-0.5">Last Deploy</p>
                  <p className={`font-medium text-xs ${deployStatusColor(status.lastDeployStatus ?? "")}`}>
                    {status.lastDeployStatus ?? "—"}
                  </p>
                  {status.lastDeployCreatedAt && (
                    <p className="text-[10px] text-white/30">{fmt(status.lastDeployCreatedAt)}</p>
                  )}
                </div>
              </div>
            )}

            {status.serviceUrl && (
              <a
                href={status.serviceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <Globe className="h-3.5 w-3.5" />
                {status.serviceUrl}
              </a>
            )}

            {status.error && (
              <div className="flex items-start gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-sm text-yellow-300/80">{status.error}</p>
              </div>
            )}

            {!status.serviceIdConfigured && status.apiKeyConfigured && (
              <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                <div className="text-sm text-blue-300/80">
                  <p className="font-medium mb-0.5">Set RENDER_SERVICE_ID to enable full integration</p>
                  <p className="text-xs text-blue-300/60">
                    Find the service ID in your Render dashboard URL (e.g. <code>srv-xxxxxxx</code>) or via the Services list below,
                    then add it as the <code>RENDER_SERVICE_ID</code> environment variable.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: Services List ───────────────────────────────────────────────────

function ServicesSection() {
  const { toast } = useToast();
  const [services, setServices] = useState<RenderService[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/render-connector/services`);
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { services: RenderService[]; count: number };
      setServices(data.services);
      setOpen(true);
    } catch (err) {
      toast({ title: "Failed to load services", description: String(err), variant: "destructive" });
    }
    setLoading(false);
  }, [toast]);

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <List className="h-4 w-4 text-primary" />
            All Services
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={fetch_} disabled={loading} className="h-8 gap-1.5 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Loading…" : "Load Services"}
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent>
          {services.length === 0 ? (
            <p className="text-sm text-white/40">No services found on this account.</p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {services.map((svc) => (
                <div key={svc.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Server className="h-3.5 w-3.5 text-white/40 shrink-0" />
                      <p className="text-sm font-medium truncate">{svc.name}</p>
                      <span className="text-xs text-white/30 shrink-0">{svc.type}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 ml-5">
                      <p className="text-xs text-white/30 font-mono">{svc.id}</p>
                      {svc.serviceUrl && (
                        <a href={svc.serviceUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline truncate max-w-[200px]">
                          {svc.serviceUrl}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0">{serviceStatusBadge(svc.status)}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Section: Deploy History ──────────────────────────────────────────────────

function DeployHistorySection() {
  const { toast } = useToast();
  const [deploys, setDeploys] = useState<Deploy[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/render-connector/deploys?limit=10`);
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { deploys: Deploy[]; count: number };
      setDeploys(data.deploys);
    } catch (err) {
      toast({ title: "Failed to load deploy history", description: String(err), variant: "destructive" });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { void fetch_(); }, [fetch_]);

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Deploy History
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={fetch_} disabled={loading} className="h-8 gap-1.5 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && deploys.length === 0 ? (
          <p className="text-sm text-white/40">Loading…</p>
        ) : deploys.length === 0 ? (
          <p className="text-sm text-white/40">No deploys found. Set RENDER_SERVICE_ID to see deploy history.</p>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {deploys.map((d) => (
              <div key={d.id} className="py-3 flex items-start gap-3">
                <div className="mt-0.5 shrink-0">{deployStatusIcon(d.status)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${deployStatusColor(d.status)}`}>
                      {d.status.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-white/30 font-mono">{d.id}</span>
                  </div>
                  {d.commitMessage && (
                    <p className="text-xs text-white/50 mt-0.5 truncate">{d.commitMessage}</p>
                  )}
                  <div className="flex items-center gap-3 mt-0.5 text-[11px] text-white/30">
                    <span>Started: {fmt(d.createdAt)}</span>
                    {d.finishedAt && <span>Finished: {fmt(d.finishedAt)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: Trigger Deploy ──────────────────────────────────────────────────

function TriggerDeploySection() {
  const { toast } = useToast();
  const [adminToken, setAdminToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [clearCache, setClearCache] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ deployId: string; status: string } | null>(null);

  const handleDeploy = useCallback(async () => {
    if (!adminToken.trim()) {
      toast({ title: "Admin token required", description: "Enter your ADMIN_TOKEN to trigger a deploy.", variant: "destructive" });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${BASE}/api/render-connector/deploy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken.trim()}`,
          "X-Admin-Confirm": "true",
        },
        body: JSON.stringify({ clearCache }),
      });
      const data = await res.json() as { ok?: boolean; deployId?: string; status?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult({ deployId: data.deployId ?? "", status: data.status ?? "triggered" });
      toast({ title: "Deploy triggered", description: `Deploy ID: ${data.deployId ?? "—"}` });
    } catch (err) {
      toast({ title: "Deploy failed", description: String(err), variant: "destructive" });
    }
    setLoading(false);
  }, [adminToken, clearCache, toast]);

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <CloudUpload className="h-4 w-4 text-primary" />
          Trigger Deploy
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
          <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
          <p className="text-xs text-yellow-300/80">
            This will deploy the latest commit from the connected branch to your Render service.
            Requires your ADMIN_TOKEN and confirmation. The deploy runs immediately.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-white/60">Admin Token</Label>
          <div className="relative">
            <Input
              type={showToken ? "text" : "password"}
              placeholder="Enter ADMIN_TOKEN…"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              className="pr-10 bg-white/[0.03] border-white/[0.08] text-sm"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={clearCache}
              onChange={(e) => setClearCache(e.target.checked)}
              className="rounded border-white/20 bg-white/[0.04]"
            />
            <span className="text-sm text-white/70">Clear build cache</span>
          </label>
        </div>

        <Button
          onClick={handleDeploy}
          disabled={loading || !adminToken.trim()}
          className="gap-2"
        >
          <Play className={`h-4 w-4 ${loading ? "animate-pulse" : ""}`} />
          {loading ? "Triggering…" : "Deploy Now"}
        </Button>

        {result && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-medium text-emerald-400">Deploy triggered</span>
            </div>
            <p className="text-xs text-white/50">Deploy ID: <code className="text-white/70">{result.deployId}</code></p>
            <p className="text-xs text-white/50">Status: <span className={deployStatusColor(result.status)}>{result.status}</span></p>
            <p className="text-xs text-white/40">Monitor progress in the Deploy History section above.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: Env Vars ────────────────────────────────────────────────────────

function EnvVarsSection() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<string[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);

  const [varsInput, setVarsInput] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<{ acceptedKeys: string[]; rejectedKeys: string[]; wouldApply: boolean } | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyResult, setApplyResult] = useState<{ appliedKeys: string[]; skippedKeys: string[]; totalEnvVarCount: number } | null>(null);

  const fetchKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      const res = await fetch(`${BASE}/api/render-connector/env-vars`);
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { keys: string[]; count: number };
      setKeys(data.keys);
    } catch (err) {
      toast({ title: "Failed to load env var keys", description: String(err), variant: "destructive" });
    }
    setKeysLoading(false);
  }, [toast]);

  function parseVarsInput(): Record<string, string> {
    const vars: Record<string, string> = {};
    for (const line of varsInput.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim();
      if (k) vars[k] = v;
    }
    return vars;
  }

  const handleDryRun = useCallback(async () => {
    const variables = parseVarsInput();
    if (Object.keys(variables).length === 0) {
      toast({ title: "No variables parsed", description: "Enter KEY=VALUE pairs, one per line.", variant: "destructive" });
      return;
    }
    setDryRunLoading(true);
    setDryRunResult(null);
    setApplyResult(null);
    try {
      const res = await fetch(`${BASE}/api/render-connector/env-vars/dry-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variables }),
      });
      const data = await res.json() as { acceptedKeys: string[]; rejectedKeys: string[]; wouldApply: boolean };
      setDryRunResult(data);
    } catch (err) {
      toast({ title: "Dry run failed", description: String(err), variant: "destructive" });
    }
    setDryRunLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [varsInput, toast]);

  const handleApply = useCallback(async () => {
    if (!adminToken.trim()) {
      toast({ title: "Admin token required", variant: "destructive" });
      return;
    }
    const variables = parseVarsInput();
    if (Object.keys(variables).length === 0) {
      toast({ title: "No variables to apply", variant: "destructive" });
      return;
    }
    setApplyLoading(true);
    setApplyResult(null);
    try {
      const res = await fetch(`${BASE}/api/render-connector/env-vars/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken.trim()}`,
          "X-Admin-Confirm": "true",
        },
        body: JSON.stringify({ variables }),
      });
      const data = await res.json() as {
        ok?: boolean; appliedKeys?: string[]; skippedKeys?: string[];
        totalEnvVarCount?: number; error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setApplyResult({
        appliedKeys: data.appliedKeys ?? [],
        skippedKeys: data.skippedKeys ?? [],
        totalEnvVarCount: data.totalEnvVarCount ?? 0,
      });
      toast({ title: `Applied ${(data.appliedKeys ?? []).length} env var(s) to Render` });
    } catch (err) {
      toast({ title: "Apply failed", description: String(err), variant: "destructive" });
    }
    setApplyLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [varsInput, adminToken, toast]);

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            Environment Variables
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={fetchKeys} disabled={keysLoading} className="h-8 gap-1.5 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${keysLoading ? "animate-spin" : ""}`} />
            Load Keys
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current keys list */}
        {keys.length > 0 && (
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 space-y-1.5">
            <p className="text-xs text-white/40 uppercase tracking-wide mb-2">Current keys on Render ({keys.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {keys.map((k) => (
                <span key={k} className="text-xs font-mono rounded bg-white/[0.06] border border-white/[0.08] px-2 py-0.5 text-white/70">
                  {k}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="space-y-2">
          <Label className="text-xs text-white/60">Variables to apply (KEY=VALUE, one per line)</Label>
          <textarea
            value={varsInput}
            onChange={(e) => setVarsInput(e.target.value)}
            placeholder={"DATABASE_URL=postgres://...\nSESSION_SECRET=...\nCORS_ALLOWED_ORIGINS=https://example.com"}
            rows={6}
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-sm font-mono text-white/80 placeholder:text-white/20 resize-y focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
          />
          <p className="text-xs text-white/30">
            Only allowlisted keys are applied (DATABASE_URL, SESSION_SECRET, SMTP_*, STRIPE_*, etc.).
            Values are merge-updated — existing vars not in this list are preserved.
          </p>
        </div>

        {/* Dry run button */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button size="sm" variant="outline" onClick={handleDryRun} disabled={dryRunLoading} className="gap-2 text-xs h-8">
            <Zap className={`h-3.5 w-3.5 ${dryRunLoading ? "animate-pulse" : ""}`} />
            {dryRunLoading ? "Running…" : "Dry Run"}
          </Button>
          <span className="text-xs text-white/30">Preview which keys would be accepted before applying</span>
        </div>

        {/* Dry run result */}
        {dryRunResult && (
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              {dryRunResult.wouldApply
                ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                : <AlertTriangle className="h-4 w-4 text-yellow-400" />}
              <span className="font-medium">{dryRunResult.wouldApply ? "Would apply" : "Would not apply — check config"}</span>
            </div>
            {dryRunResult.acceptedKeys.length > 0 && (
              <div>
                <p className="text-xs text-white/40 mb-1">✓ Accepted ({dryRunResult.acceptedKeys.length})</p>
                <div className="flex flex-wrap gap-1">
                  {dryRunResult.acceptedKeys.map((k) => (
                    <span key={k} className="text-xs font-mono rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-emerald-400">{k}</span>
                  ))}
                </div>
              </div>
            )}
            {dryRunResult.rejectedKeys.length > 0 && (
              <div>
                <p className="text-xs text-white/40 mb-1">✗ Rejected / not on allowlist ({dryRunResult.rejectedKeys.length})</p>
                <div className="flex flex-wrap gap-1">
                  {dryRunResult.rejectedKeys.map((k) => (
                    <span key={k} className="text-xs font-mono rounded bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-red-400">{k}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Admin token for apply */}
        <div className="space-y-2 pt-2 border-t border-white/[0.06]">
          <Label className="text-xs text-white/60">Admin Token (required to apply)</Label>
          <div className="relative">
            <Input
              type={showToken ? "text" : "password"}
              placeholder="Enter ADMIN_TOKEN…"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              className="pr-10 bg-white/[0.03] border-white/[0.08] text-sm"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <Button
          onClick={handleApply}
          disabled={applyLoading || !adminToken.trim()}
          className="gap-2"
        >
          <Zap className={`h-4 w-4 ${applyLoading ? "animate-pulse" : ""}`} />
          {applyLoading ? "Applying…" : "Apply to Render"}
        </Button>

        {/* Apply result */}
        {applyResult && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-medium text-emerald-400">Applied successfully</span>
            </div>
            <p className="text-xs text-white/50">
              Applied: {applyResult.appliedKeys.join(", ") || "—"}
            </p>
            {applyResult.skippedKeys.length > 0 && (
              <p className="text-xs text-white/40">Skipped: {applyResult.skippedKeys.join(", ")}</p>
            )}
            <p className="text-xs text-white/40">Total env vars on service: {applyResult.totalEnvVarCount}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: Logs ────────────────────────────────────────────────────────────

function LogsSection() {
  const { toast } = useToast();
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(100);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/render-connector/logs?limit=${limit}`);
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { lines: string[]; count: number };
      setLines(data.lines);
      setOpen(true);
    } catch (err) {
      toast({ title: "Failed to load logs", description: String(err), variant: "destructive" });
    }
    setLoading(false);
  }, [limit, toast]);

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Terminal className="h-4 w-4 text-primary" />
            Service Logs
          </CardTitle>
          <div className="flex items-center gap-2">
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="h-8 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 text-xs text-white/70 focus:outline-none"
            >
              <option value={50}>Last 50</option>
              <option value={100}>Last 100</option>
              <option value={200}>Last 200</option>
              <option value={500}>Last 500</option>
            </select>
            <Button size="sm" variant="ghost" onClick={fetch_} disabled={loading} className="h-8 gap-1.5 text-xs">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Loading…" : "Load Logs"}
            </Button>
            {open && (
              <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} className="h-8 gap-1 text-xs">
                {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {open ? "Hide" : "Show"}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent>
          {lines.length === 0 ? (
            <p className="text-sm text-white/40">No log lines returned. RENDER_SERVICE_ID must be set.</p>
          ) : (
            <div className="rounded-lg border border-white/[0.08] bg-black/40 p-3 overflow-auto max-h-96">
              <pre className="text-xs font-mono text-white/70 whitespace-pre-wrap leading-5">
                {lines.join("\n")}
              </pre>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RenderConnectorPage() {
  return (
    <AppLayout>
      <div className="container max-w-4xl py-8 space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Server className="h-6 w-6 text-primary" />
            Render Connector
          </h1>
          <p className="text-sm text-foreground/55 mt-1 max-w-2xl">
            Manage your Render.com services directly from VIBA — check status, view deploy history,
            trigger deploys, manage environment variables, and stream service logs.
            Destructive actions require your Admin Token and confirmation.
          </p>
        </div>

        {/* Quick setup note if needed */}
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 flex items-start gap-3">
          <FileText className="h-4 w-4 text-white/40 shrink-0 mt-0.5" />
          <div className="text-sm text-white/50 space-y-1">
            <p className="font-medium text-white/70">Setup</p>
            <p><code className="text-xs bg-white/[0.06] px-1.5 py-0.5 rounded">RENDER_API_KEY</code> — already configured ✓</p>
            <p>
              <code className="text-xs bg-white/[0.06] px-1.5 py-0.5 rounded">RENDER_SERVICE_ID</code> — set this to your service ID (e.g. <code className="text-xs">srv-xxxxxxxxxxxxxxxx</code>).
              Find it in your Render dashboard URL or via the Services list below.
            </p>
          </div>
        </div>

        <StatusSection />
        <ServicesSection />
        <DeployHistorySection />
        <TriggerDeploySection />
        <EnvVarsSection />
        <LogsSection />

      </div>
    </AppLayout>
  );
}
