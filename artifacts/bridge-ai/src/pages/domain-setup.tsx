import { useState, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Globe,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Copy,
  RefreshCw,
  ChevronRight,
  Plus,
  ClipboardCheck,
  Wifi,
  WifiOff,
  Clock,
  Activity,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

type DeploymentProvider = "railway" | "render" | "digitalocean" | "vercel" | "sevall" | "custom";
type RootStrategy = "a_record" | "alias_target" | "redirect_to_www" | "manual";
type WwwStrategy = "cname" | "manual";
type DomainStatus = "pending" | "connected" | "parked" | "failed" | "unknown";

interface ProviderInfo {
  id: string;
  name: string;
  wizardCopy: string;
  exampleTarget: string;
  supportsARecord: boolean;
  apexNote: string;
}

interface DnsRecord {
  type: string;
  name: string;
  value: string;
  ttl: string;
  notes: string;
}

interface DnsRecordToRemove {
  type: string;
  name: string;
  value: string;
  reason: string;
}

interface DnsPlan {
  domain: string;
  deploymentProvider: string;
  currentProblem: string;
  recordsToRemove: DnsRecordToRemove[];
  recordsToAdd: DnsRecord[];
  manualSteps: string[];
  warnings: string[];
  qaGateBlockers: string[];
  rawValuesReturned: false;
}

interface DomainCheckResult {
  domain: string;
  status: DomainStatus;
  message: string;
  httpsWorking: boolean;
  tlsValid: boolean;
  healthzOk: boolean | null;
  resolvedUrl: string;
  checkedAt: string;
}

// ─── Static provider list (pre-seeded so the page works even before API loads) ──

const DEFAULT_PROVIDERS: ProviderInfo[] = [
  {
    id: "railway",
    name: "Railway",
    wizardCopy:
      "Add viba.guru and www.viba.guru inside Railway custom domains first. Railway will show the DNS target you must copy into GoDaddy. Paste that target here.",
    exampleTarget: "*.up.railway.app or cname.railway.app",
    supportsARecord: false,
    apexNote:
      "Railway provides a CNAME target. Use 'Redirect root to www' since GoDaddy doesn't support CNAME at the apex.",
  },
  {
    id: "render",
    name: "Render",
    wizardCopy:
      "Add the custom domain in Render first. Render will show the required DNS record. Paste that target here.",
    exampleTarget: "*.onrender.com",
    supportsARecord: false,
    apexNote: "Render provides a CNAME target. Use 'Redirect root to www'.",
  },
  {
    id: "digitalocean",
    name: "DigitalOcean",
    wizardCopy:
      "Add the domain to DigitalOcean App Platform first. Copy the required DNS record into this wizard.",
    exampleTarget: "*.ondigitalocean.app",
    supportsARecord: true,
    apexNote: "DigitalOcean may provide an A record for the root domain.",
  },
  {
    id: "vercel",
    name: "Vercel",
    wizardCopy:
      "Add viba.guru in Vercel Project Settings → Domains first. Vercel will show the required DNS records. Paste the values here.",
    exampleTarget: "cname.vercel-dns.com",
    supportsARecord: true,
    apexNote: "Vercel: add an A record pointing @ to 76.76.21.21 for the root domain.",
  },
  {
    id: "sevall",
    name: "Sevall",
    wizardCopy:
      "Sevall support is manual-guided. Paste the DNS target Sevall provides.",
    exampleTarget: "Provider-specific target",
    supportsARecord: false,
    apexNote: "Follow Sevall's documentation for apex domain configuration.",
  },
  {
    id: "custom",
    name: "Custom / Other",
    wizardCopy: "Paste the DNS target or IP your provider gave you.",
    exampleTarget: "your-app.provider.com or IP address",
    supportsARecord: true,
    apexNote: "Consult your provider's documentation.",
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBanner({ status, message }: { status: DomainStatus | "idle"; message?: string }) {
  if (status === "idle") {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
        <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-300">CURRENT STATUS</p>
          <p className="text-sm text-amber-200/80 mt-1">
            viba.guru appears to be showing a GoDaddy parked page. This usually means DNS is not
            pointed to your deployed VIBA app yet. Use this wizard to generate the exact DNS records
            to fix it.
          </p>
        </div>
      </div>
    );
  }

  const map: Record<DomainStatus, { icon: typeof CheckCircle2; color: string; label: string }> = {
    connected: { icon: CheckCircle2, color: "emerald", label: "CONNECTED" },
    parked:    { icon: AlertTriangle, color: "amber",   label: "PARKED"    },
    pending:   { icon: Clock,         color: "blue",    label: "PENDING"   },
    failed:    { icon: XCircle,       color: "red",     label: "FAILED"    },
    unknown:   { icon: Activity,      color: "white",   label: "UNKNOWN"   },
  };

  const { icon: Icon, color, label } = map[status];

  return (
    <div className={`flex items-start gap-3 rounded-xl border border-${color}-500/30 bg-${color}-500/10 p-4`}>
      <Icon className={`h-5 w-5 text-${color}-400 shrink-0 mt-0.5`} />
      <div>
        <p className={`text-sm font-medium text-${color}-300`}>{label}</p>
        {message && <p className={`text-sm text-${color}-200/80 mt-1`}>{message}</p>}
      </div>
    </div>
  );
}

function RecordRow({ record }: { record: DnsRecord }) {
  const { toast } = useToast();
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className="flex flex-wrap gap-3 items-center min-w-0">
        <span className="shrink-0 px-2 py-0.5 rounded text-xs font-mono font-bold bg-primary/15 text-primary border border-primary/20">
          {record.type}
        </span>
        <span className="text-sm font-mono text-white/70 shrink-0">
          {record.name === "@" ? "@ (root)" : record.name}
        </span>
        <ChevronRight className="h-3 w-3 text-white/30 shrink-0" />
        <span className="text-sm font-mono text-emerald-300 break-all">{record.value}</span>
        <span className="text-xs text-white/40">TTL {record.ttl}s</span>
      </div>
      <button
        className="shrink-0 p-1.5 rounded hover:bg-white/[0.05] text-white/40 hover:text-white/80 transition-colors"
        onClick={() => {
          void navigator.clipboard.writeText(`${record.type} ${record.name} ${record.value}`);
          toast({ title: "Copied", description: `${record.type} record copied to clipboard` });
        }}
        title="Copy record"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DomainSetupPage() {
  const { toast } = useToast();

  // Form state
  const [provider, setProvider] = useState<DeploymentProvider>("railway");
  const [providerTarget, setProviderTarget] = useState("");
  const [rootStrategy, setRootStrategy] = useState<RootStrategy>("redirect_to_www");
  const [wwwStrategy, setWwwStrategy] = useState<WwwStrategy>("cname");

  // Result state
  const [plan, setPlan] = useState<DnsPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  const [checkResult, setCheckResult] = useState<DomainCheckResult | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);

  const [dnsMarkedUpdated, setDnsMarkedUpdated] = useState(false);
  const [addedToOps, setAddedToOps] = useState(false);
  const [opsLoading, setOpsLoading] = useState(false);

  const selectedProviderInfo = DEFAULT_PROVIDERS.find((p) => p.id === provider) ?? DEFAULT_PROVIDERS[0]!;

  // ── Generate plan ──────────────────────────────────────────────────────────

  const generatePlan = useCallback(async () => {
    setPlanLoading(true);
    setPlanError(null);
    setPlan(null);
    try {
      const res = await fetch(`${BASE}/api/domain-setup/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          domain: "viba.guru",
          dnsProvider: "godaddy",
          deploymentProvider: provider,
          providerTarget: providerTarget.trim(),
          rootStrategy,
          wwwStrategy,
        }),
      });
      const data = (await res.json()) as DnsPlan & { error?: string; message?: string };
      if (!res.ok) {
        setPlanError(data.message ?? data.error ?? "Failed to generate DNS plan");
      } else {
        setPlan(data);
      }
    } catch {
      setPlanError("Network error — could not reach the API.");
    } finally {
      setPlanLoading(false);
    }
  }, [provider, providerTarget, rootStrategy, wwwStrategy]);

  // ── Domain check ───────────────────────────────────────────────────────────

  const runDomainCheck = useCallback(async () => {
    setCheckLoading(true);
    setCheckResult(null);
    try {
      const res = await fetch(`${BASE}/api/domain-setup/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          domain: "viba.guru",
          expectedPublicOrigin: "https://viba.guru",
        }),
      });
      const data = (await res.json()) as DomainCheckResult;
      setCheckResult(data);
    } catch {
      toast({ title: "Check failed", description: "Network error during domain check.", variant: "destructive" });
    } finally {
      setCheckLoading(false);
    }
  }, [toast]);

  // ── Copy helpers ───────────────────────────────────────────────────────────

  const copySteps = useCallback(() => {
    if (!plan) return;
    const text = plan.manualSteps.map((s, i) => `${i + 1}. ${s}`).join("\n");
    void navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: "GoDaddy setup steps copied to clipboard." });
  }, [plan, toast]);

  const copyRecords = useCallback(() => {
    if (!plan) return;
    const text = plan.recordsToAdd
      .map((r) => `Type: ${r.type}  Name: ${r.name}  Value: ${r.value}  TTL: ${r.ttl}`)
      .join("\n");
    void navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: "DNS records copied to clipboard." });
  }, [plan, toast]);

  // ── Add to Production Ops ──────────────────────────────────────────────────

  const addToProductionOps = useCallback(async () => {
    setOpsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/production-ops/targets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          appName: "VIBA",
          publicUrl: "https://viba.guru",
          apiHealthUrl: "https://viba.guru/api/healthz",
          providerId: provider,
          strictMode: false,
        }),
      });
      if (res.ok) {
        setAddedToOps(true);
        toast({ title: "Added to Production Ops", description: "viba.guru is now monitored." });
      } else {
        const data = (await res.json()) as { message?: string };
        toast({
          title: "Could not add to ops",
          description: data.message ?? "The target may already exist.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Network error", description: "Could not reach Production Ops.", variant: "destructive" });
    } finally {
      setOpsLoading(false);
    }
  }, [provider, toast]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
            <Globe className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Domain Setup Wizard</h1>
            <p className="text-sm text-muted-foreground">
              Connect viba.guru to your deployment provider via GoDaddy DNS
            </p>
          </div>
        </div>

        {/* Current status */}
        <StatusBanner
          status={checkResult?.status ?? "idle"}
          message={checkResult?.message}
        />

        {/* ── Configuration Form ─────────────────────────────────────────── */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-5 space-y-5">
          <h2 className="text-sm font-semibold text-foreground">Connect Domain</h2>

          {/* Fixed fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-white/50 mb-1 block">Domain</label>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm font-mono text-white/70">
                viba.guru
              </div>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">DNS Provider</label>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm font-mono text-white/70">
                GoDaddy
              </div>
            </div>
          </div>

          {/* Deployment provider */}
          <div>
            <label className="text-xs text-white/50 mb-1.5 block">Deployment Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as DeploymentProvider)}
              className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {DEFAULT_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Wizard copy */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-xs text-primary/80">{selectedProviderInfo.wizardCopy}</p>
          </div>

          {/* Provider DNS target */}
          <div>
            <label className="text-xs text-white/50 mb-1.5 block">
              Provider DNS Target
              <span className="ml-1 text-white/30">
                (e.g. {selectedProviderInfo.exampleTarget})
              </span>
            </label>
            <input
              type="text"
              value={providerTarget}
              onChange={(e) => setProviderTarget(e.target.value)}
              placeholder={selectedProviderInfo.exampleTarget}
              className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm font-mono text-foreground placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Strategies */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Root (@) Strategy</label>
              <select
                value={rootStrategy}
                onChange={(e) => setRootStrategy(e.target.value as RootStrategy)}
                className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="a_record">Provider-supplied A record</option>
                <option value="alias_target">Provider-supplied ALIAS/ANAME target</option>
                <option value="redirect_to_www">Redirect root → www (recommended for Railway)</option>
                <option value="manual">Manual / unsure</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">www Strategy</label>
              <select
                value={wwwStrategy}
                onChange={(e) => setWwwStrategy(e.target.value as WwwStrategy)}
                className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="cname">CNAME to provider target</option>
                <option value="manual">Manual / unsure</option>
              </select>
            </div>
          </div>

          {/* Apex note */}
          {selectedProviderInfo.apexNote && (
            <p className="text-xs text-white/40 italic">{selectedProviderInfo.apexNote}</p>
          )}

          <Button
            onClick={() => { void generatePlan(); }}
            disabled={planLoading}
            className="w-full sm:w-auto"
          >
            {planLoading ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
            ) : (
              <><ClipboardCheck className="h-4 w-4 mr-2" /> Generate GoDaddy DNS Instructions</>
            )}
          </Button>

          {planError && (
            <p className="text-sm text-red-400">{planError}</p>
          )}
        </div>

        {/* ── DNS Plan Results ────────────────────────────────────────────── */}
        {plan && (
          <div className="space-y-4">

            {/* Warnings */}
            {plan.warnings.length > 0 && (
              <div className="space-y-2">
                {plan.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/8 px-4 py-3">
                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-200/80">{w}</p>
                  </div>
                ))}
              </div>
            )}

            {/* QA gate blockers */}
            {plan.qaGateBlockers.length > 0 && (
              <div className="flex items-start gap-2.5 rounded-lg border border-red-500/25 bg-red-500/8 px-4 py-3">
                <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-red-300">QA Gate Blockers</p>
                  <ul className="mt-1 space-y-0.5">
                    {plan.qaGateBlockers.map((b) => (
                      <li key={b} className="text-xs text-red-200/70">• {b.replace(/_/g, " ")}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Records to remove */}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-5">
              <h3 className="text-sm font-semibold text-foreground mb-3">
                Records to Remove (GoDaddy parking)
              </h3>
              <div className="space-y-2">
                {plan.recordsToRemove.map((r, i) => (
                  <div key={i} className="rounded-lg border border-red-500/15 bg-red-500/5 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded">
                        {r.type}
                      </span>
                      <span className="text-xs font-mono text-white/60">{r.name}</span>
                    </div>
                    <p className="text-xs text-white/40 mt-1">{r.reason}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Records to add */}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-5">
              <h3 className="text-sm font-semibold text-foreground mb-3">
                Records to Add
              </h3>
              {plan.recordsToAdd.length === 0 ? (
                <p className="text-xs text-white/40">
                  No DNS records to add — root redirect will be handled via GoDaddy Forwarding.
                </p>
              ) : (
                <div className="space-y-2">
                  {plan.recordsToAdd.map((r, i) => (
                    <RecordRow key={i} record={r} />
                  ))}
                </div>
              )}
            </div>

            {/* Manual steps */}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-5">
              <h3 className="text-sm font-semibold text-foreground mb-3">
                GoDaddy Setup Steps
              </h3>
              <ol className="space-y-2.5">
                {plan.manualSteps.map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 border border-primary/25 text-primary text-xs font-bold">
                      {i + 1}
                    </span>
                    <span className="text-white/70 leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={copySteps}>
                <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy GoDaddy Steps
              </Button>
              {plan.recordsToAdd.length > 0 && (
                <Button variant="outline" size="sm" onClick={copyRecords}>
                  <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy DNS Records
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => { void runDomainCheck(); }} disabled={checkLoading}>
                {checkLoading ? (
                  <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Checking…</>
                ) : (
                  <><Wifi className="h-3.5 w-3.5 mr-1.5" /> Run Domain Check</>
                )}
              </Button>
              {!dnsMarkedUpdated && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDnsMarkedUpdated(true)}
                  className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Mark DNS Updated
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── Domain Check Result ─────────────────────────────────────────── */}
        {checkResult && (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-5 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Domain Check Result</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] px-3 py-2.5">
                <p className="text-xs text-white/40">Status</p>
                <p className={`text-sm font-medium mt-0.5 ${
                  checkResult.status === "connected" ? "text-emerald-400" :
                  checkResult.status === "parked"    ? "text-amber-400" :
                  checkResult.status === "pending"   ? "text-blue-400" :
                  checkResult.status === "failed"    ? "text-red-400" : "text-white/60"
                }`}>
                  {checkResult.status.toUpperCase()}
                </p>
              </div>
              <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] px-3 py-2.5">
                <p className="text-xs text-white/40">HTTPS</p>
                <p className={`text-sm font-medium mt-0.5 ${checkResult.httpsWorking ? "text-emerald-400" : "text-white/40"}`}>
                  {checkResult.httpsWorking ? "Working" : "Not reachable"}
                </p>
              </div>
              <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] px-3 py-2.5">
                <p className="text-xs text-white/40">/api/healthz</p>
                <p className={`text-sm font-medium mt-0.5 ${
                  checkResult.healthzOk === true  ? "text-emerald-400" :
                  checkResult.healthzOk === false ? "text-white/40" : "text-white/30"
                }`}>
                  {checkResult.healthzOk === true ? "OK" : checkResult.healthzOk === false ? "No response" : "—"}
                </p>
              </div>
            </div>
            {checkResult.message && (
              <p className="text-xs text-white/50 leading-relaxed">{checkResult.message}</p>
            )}
            {checkResult.resolvedUrl && checkResult.resolvedUrl !== `https://${checkResult.domain}` && (
              <p className="text-xs text-white/30">
                Resolved to: <span className="font-mono">{checkResult.resolvedUrl}</span>
              </p>
            )}
            <div className="flex items-center gap-2">
              {checkResult.status === "connected" ? (
                <Wifi className="h-4 w-4 text-emerald-400" />
              ) : (
                <WifiOff className="h-4 w-4 text-white/30" />
              )}
              <span className="text-xs text-white/30">
                Checked at {new Date(checkResult.checkedAt).toLocaleTimeString()}
              </span>
            </div>
          </div>
        )}

        {/* ── Production Ops Integration ──────────────────────────────────── */}
        {dnsMarkedUpdated && !addedToOps && (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-5">
            <h3 className="text-sm font-semibold text-foreground mb-1">
              Add to Production Ops monitoring?
            </h3>
            <p className="text-xs text-white/50 mb-3">
              VIBA (viba.guru) will be continuously monitored with health checks and incident detection.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => { void addToProductionOps(); }} disabled={opsLoading}>
                {opsLoading ? (
                  <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Adding…</>
                ) : (
                  <><Plus className="h-3.5 w-3.5 mr-1.5" /> Add to Production Ops</>
                )}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAddedToOps(true)}>
                Skip
              </Button>
            </div>
          </div>
        )}

        {addedToOps && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-200/80">
              viba.guru is now in Production Ops. You can view health checks and incidents from the{" "}
              <a href="/production-ops" className="underline hover:text-emerald-300">Production Ops</a> page.
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
