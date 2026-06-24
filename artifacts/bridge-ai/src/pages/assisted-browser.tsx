import { useState, useEffect, useCallback } from "react";
import { Bot, Play, Pause, CheckCircle, Clock, AlertCircle, RefreshCw, Plus, ChevronDown, ChevronRight, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/layout/Navbar";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────

type JobStatus = "created" | "running" | "paused" | "waiting_for_user_authorization" | "completed" | "failed";
type CreditState = "idle" | "consuming" | "paused_waiting_for_user" | "completed";

interface BrowserJob {
  id: string;
  template_id: string | null;
  provider: string;
  target_url: string;
  status: JobStatus;
  credit_state: CreditState;
  current_step: string | null;
  waiting_for_type: string | null;
  waiting_for_reason: string | null;
  outputs_json: Record<string, unknown>;
  audit_json: Array<{ ts: string; event: string; detail?: string }>;
  created_at: string;
  updated_at: string;
}

interface Template {
  id: string;
  label: string;
  provider: string;
  target_url: string;
  description: string;
  steps: string[];
}

interface ConnectorStatus {
  apiAvailable: boolean;
  cliAvailable: boolean;
  cliVersion: string | null;
  mcpAvailable: boolean;
  browserFallbackAvailable: boolean;
  modeOrder: string[];
  railwayTokenConfigured: boolean;
}

interface FallbackPlan {
  modeOrder: string[];
  recommendation: string;
  browserSteps: string[];
  manualInstructions: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const BASE = "/api";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function statusColor(status: JobStatus): string {
  switch (status) {
    case "running": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/25";
    case "waiting_for_user_authorization": return "bg-amber-500/15 text-amber-400 border-amber-500/25";
    case "paused": return "bg-slate-500/15 text-slate-400 border-slate-500/25";
    case "completed": return "bg-blue-500/15 text-blue-400 border-blue-500/25";
    case "failed": return "bg-red-500/15 text-red-400 border-red-500/25";
    default: return "bg-slate-500/15 text-slate-400 border-slate-500/25";
  }
}

function creditStateLabel(state: CreditState): string {
  switch (state) {
    case "consuming": return "Credits running";
    case "paused_waiting_for_user": return "Credits paused (waiting for you)";
    case "completed": return "Billing stopped";
    default: return "Idle";
  }
}

function providerLabel(p: string): string {
  const map: Record<string, string> = { railway: "Railway", stripe: "Stripe", godaddy: "GoDaddy", github: "GitHub", smtp: "SMTP" };
  return map[p] ?? p;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function AssistedBrowserPage() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [jobs, setJobs] = useState<BrowserJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<BrowserJob | null>(null);
  const [connectorStatus, setConnectorStatus] = useState<ConnectorStatus | null>(null);
  const [fallbackPlan, setFallbackPlan] = useState<FallbackPlan | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createTemplateId, setCreateTemplateId] = useState("");
  const [createProvider, setCreateProvider] = useState("custom");
  const [createTargetUrl, setCreateTargetUrl] = useState("");
  const [creating, setCreating] = useState(false);

  const [showOutputs, setShowOutputs] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  const [authorizing, setAuthorizing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [pausing, setPausing] = useState(false);

  // Load templates and connector status on mount
  useEffect(() => {
    void loadTemplates();
    void loadConnectorStatus();
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const data = await apiFetch<{ templates: Template[] }>("/browser-operator/templates");
      setTemplates(data.templates);
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadConnectorStatus = useCallback(async () => {
    try {
      const data = await apiFetch<{ status: ConnectorStatus }>("/railway-connector/status");
      setConnectorStatus(data.status);
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadFallbackPlan = useCallback(async () => {
    try {
      const data = await apiFetch<{ plan: FallbackPlan }>("/railway-connector/fallback-plan");
      setFallbackPlan(data.plan);
    } catch {
      /* non-fatal */
    }
  }, []);

  const refreshJob = useCallback(async (id: string) => {
    try {
      const data = await apiFetch<{ job: BrowserJob }>(`/browser-operator/jobs/${id}`);
      setSelectedJob(data.job);
      setJobs((prev) => prev.map((j) => (j.id === id ? data.job : j)));
    } catch {
      /* non-fatal */
    }
  }, []);

  const handleCreateJob = async () => {
    setCreating(true);
    try {
      const template = templates.find((t) => t.id === createTemplateId);
      const body: Record<string, string> = {};
      if (createTemplateId) body["template_id"] = createTemplateId;
      body["provider"] = template?.provider ?? createProvider;
      body["target_url"] = createTargetUrl || template?.target_url || "";

      if (!body["target_url"]) {
        toast({ title: "Target URL required", variant: "destructive" });
        return;
      }

      const data = await apiFetch<{ job: BrowserJob }>("/browser-operator/jobs", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setJobs((prev) => [data.job, ...prev]);
      setSelectedJob(data.job);
      setShowCreateForm(false);
      setCreateTemplateId("");
      setCreateProvider("custom");
      setCreateTargetUrl("");
      toast({ title: "Job created", description: `#${data.job.id.slice(0, 8)} ready to start` });
    } catch (err) {
      toast({ title: "Failed to create job", description: String(err), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleAction = async (action: string, extra?: Record<string, unknown>) => {
    if (!selectedJob) return;
    const actionMap: Record<string, () => void> = {
      start: () => {},
      pause: () => setPausing(true),
      authorize: () => setAuthorizing(true),
      complete: () => setCompleting(true),
    };
    actionMap[action]?.();
    try {
      const data = await apiFetch<{ job: BrowserJob }>(`/browser-operator/jobs/${selectedJob.id}/${action}`, {
        method: "POST",
        body: JSON.stringify(extra ?? {}),
      });
      setSelectedJob(data.job);
      setJobs((prev) => prev.map((j) => (j.id === data.job.id ? data.job : j)));
      toast({ title: `Job ${action === "waiting-for-user" ? "waiting for authorization" : action}ed` });
    } catch (err) {
      toast({ title: `Action failed`, description: String(err), variant: "destructive" });
    } finally {
      setPausing(false);
      setAuthorizing(false);
      setCompleting(false);
    }
  };

  const handleTemplateSelect = (id: string) => {
    setCreateTemplateId(id);
    const t = templates.find((t) => t.id === id);
    if (t) {
      setCreateProvider(t.provider);
      setCreateTargetUrl(t.target_url);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="container max-w-screen-xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Assisted Browser</h1>
              <p className="text-sm text-muted-foreground">Browser-guided automation with human-in-the-loop authorization</p>
            </div>
          </div>
          <Button onClick={() => setShowCreateForm(!showCreateForm)} className="gap-2">
            <Plus className="h-4 w-4" />
            New Job
          </Button>
        </div>

        {/* Overview */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-2">
          <h2 className="text-sm font-medium text-foreground/80 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            How it works
          </h2>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>No passwords are stored — you log in through a live browser session on your machine</li>
            <li>If OAuth, 2FA, passkey, or an email link is required, the job pauses and waits for you</li>
            <li>Credits are paused while the job waits for your authorization</li>
            <li>Credits resume when you authorize and the job continues</li>
            <li>All destructive actions require your explicit approval</li>
          </ul>
        </div>

        {/* Create Job Form */}
        {showCreateForm && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Create Browser Job</h2>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Template (optional)</label>
              <select
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/40"
                value={createTemplateId}
                onChange={(e) => handleTemplateSelect(e.target.value)}
              >
                <option value="">— Custom job —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>

            {!createTemplateId && (
              <>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium">Provider</label>
                  <input
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/40"
                    placeholder="e.g. railway, stripe, godaddy"
                    value={createProvider}
                    onChange={(e) => setCreateProvider(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium">Target URL</label>
                  <input
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/40"
                    placeholder="https://railway.app"
                    value={createTargetUrl}
                    onChange={(e) => setCreateTargetUrl(e.target.value)}
                  />
                </div>
              </>
            )}

            {createTemplateId && (
              <p className="text-xs text-muted-foreground">
                Target: <span className="text-foreground/70">{createTargetUrl}</span>
              </p>
            )}

            <div className="flex gap-2">
              <Button onClick={handleCreateJob} disabled={creating} size="sm">
                {creating ? "Creating…" : "Create Job"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowCreateForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Job List */}
          <div className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Jobs</h2>
            {jobs.length === 0 && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center text-sm text-muted-foreground">
                No jobs yet. Create one to get started.
              </div>
            )}
            {jobs.map((job) => (
              <button
                key={job.id}
                onClick={() => setSelectedJob(job)}
                className={`w-full text-left rounded-xl border p-3 space-y-1 transition-all ${
                  selectedJob?.id === job.id
                    ? "border-primary/30 bg-primary/5"
                    : "border-white/[0.06] bg-white/[0.02] hover:border-white/10"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono text-muted-foreground">#{job.id.slice(0, 8)}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${statusColor(job.status)}`}>
                    {job.status.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-sm font-medium text-foreground truncate">{providerLabel(job.provider)}</p>
                <p className="text-xs text-muted-foreground truncate">{job.target_url}</p>
              </button>
            ))}
          </div>

          {/* Live Job State */}
          <div className="lg:col-span-2 space-y-4">
            {!selectedJob ? (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center text-muted-foreground text-sm">
                Select a job to view details and controls
              </div>
            ) : (
              <>
                {/* Job Header */}
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{providerLabel(selectedJob.provider)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColor(selectedJob.status)}`}>
                          {selectedJob.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">{selectedJob.target_url}</p>
                      <p className="text-xs text-muted-foreground">{creditStateLabel(selectedJob.credit_state)}</p>
                      {selectedJob.current_step && (
                        <p className="text-xs text-primary/80">Step: {selectedJob.current_step}</p>
                      )}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => refreshJob(selectedJob.id)}>
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* User Authorization Required */}
                {selectedJob.status === "waiting_for_user_authorization" && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-amber-400">
                      <AlertCircle className="h-4 w-4" />
                      <span className="text-sm font-semibold">Authorization Required</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {selectedJob.waiting_for_reason ?? "The job is waiting for you to complete an action in your browser."}
                    </p>
                    {selectedJob.waiting_for_type && (
                      <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400">
                        {selectedJob.waiting_for_type.replace(/_/g, " ")}
                      </Badge>
                    )}
                    <p className="text-xs text-muted-foreground">
                      ⏸ Credits paused. They will resume when you authorize below.
                    </p>
                    <Button
                      onClick={() => handleAction("authorize")}
                      disabled={authorizing}
                      className="gap-2 bg-amber-500 hover:bg-amber-600 text-white"
                      size="sm"
                    >
                      <CheckCircle className="h-4 w-4" />
                      {authorizing ? "Resuming…" : "I've authorized — Resume Job"}
                    </Button>
                  </div>
                )}

                {/* Controls */}
                <div className="flex flex-wrap gap-2">
                  {(selectedJob.status === "created" || selectedJob.status === "paused") && (
                    <Button onClick={() => handleAction("start")} size="sm" className="gap-2">
                      <Play className="h-3.5 w-3.5" />
                      {selectedJob.status === "paused" ? "Resume" : "Start"}
                    </Button>
                  )}
                  {selectedJob.status === "running" && (
                    <>
                      <Button
                        onClick={() => handleAction("waiting-for-user", { waiting_for_type: "manual", reason: "Manually paused for user action" })}
                        variant="outline"
                        size="sm"
                        className="gap-2"
                      >
                        <Clock className="h-3.5 w-3.5" />
                        Waiting for Me
                      </Button>
                      <Button
                        onClick={() => handleAction("pause")}
                        disabled={pausing}
                        variant="outline"
                        size="sm"
                        className="gap-2"
                      >
                        <Pause className="h-3.5 w-3.5" />
                        {pausing ? "Pausing…" : "Pause"}
                      </Button>
                    </>
                  )}
                  {(selectedJob.status === "running" || selectedJob.status === "paused" || selectedJob.status === "waiting_for_user_authorization") && (
                    <Button
                      onClick={() => handleAction("complete")}
                      disabled={completing}
                      variant="outline"
                      size="sm"
                      className="gap-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                      {completing ? "Completing…" : "Mark Complete"}
                    </Button>
                  )}
                </div>

                {/* Outputs */}
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground/80"
                    onClick={() => setShowOutputs(!showOutputs)}
                  >
                    <span className="flex items-center gap-2">
                      {showOutputs ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      Outputs
                    </span>
                    {showOutputs ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  {showOutputs && (
                    <div className="px-4 pb-4">
                      {Object.keys(selectedJob.outputs_json).length === 0 ? (
                        <p className="text-xs text-muted-foreground">No outputs recorded yet. Raw values are never shown.</p>
                      ) : (
                        <pre className="text-xs text-foreground/70 font-mono whitespace-pre-wrap">
                          {JSON.stringify(
                            Object.fromEntries(Object.keys(selectedJob.outputs_json).map((k) => [k, "[REDACTED]"])),
                            null,
                            2,
                          )}
                        </pre>
                      )}
                    </div>
                  )}
                </div>

                {/* Audit Trail */}
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground/80"
                    onClick={() => setShowAudit(!showAudit)}
                  >
                    <span>Audit Trail ({selectedJob.audit_json.length})</span>
                    {showAudit ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  {showAudit && (
                    <div className="px-4 pb-4 space-y-1 max-h-48 overflow-y-auto">
                      {selectedJob.audit_json.map((entry, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <span className="shrink-0 font-mono text-foreground/30">
                            {new Date(entry.ts).toLocaleTimeString()}
                          </span>
                          <span className="text-foreground/60">{entry.event.replace(/_/g, " ")}</span>
                          {entry.detail && <span className="text-foreground/40">{entry.detail}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Templates */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Available Templates</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map((t) => (
              <div key={t.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">{t.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{t.description}</p>
                <ol className="text-xs text-muted-foreground space-y-0.5 list-none">
                  {t.steps.map((step, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-primary/60 shrink-0">{i + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-1 text-xs"
                  onClick={() => {
                    handleTemplateSelect(t.id);
                    setShowCreateForm(true);
                  }}
                >
                  Use Template
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Railway Connector Status */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Railway Connector Status</h2>
            <Button variant="ghost" size="sm" onClick={loadConnectorStatus}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
          {!connectorStatus ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "API", ok: connectorStatus.apiAvailable },
                { label: "CLI", ok: connectorStatus.cliAvailable },
                { label: "MCP", ok: connectorStatus.mcpAvailable },
                { label: "Browser Fallback", ok: connectorStatus.browserFallbackAvailable },
              ].map(({ label, ok }) => (
                <div key={label} className={`rounded-lg border p-3 text-center ${ok ? "border-emerald-500/25 bg-emerald-500/5" : "border-white/[0.06] bg-white/[0.02]"}`}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={`text-sm font-semibold mt-0.5 ${ok ? "text-emerald-400" : "text-red-400"}`}>{ok ? "✓ Available" : "✗ Unavailable"}</p>
                </div>
              ))}
            </div>
          )}
          {connectorStatus && (
            <p className="text-xs text-muted-foreground">
              Mode order: {connectorStatus.modeOrder.join(" → ")}
            </p>
          )}
        </div>

        {/* Fallback Plan */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Fallback Plan</h2>
            <Button variant="ghost" size="sm" onClick={loadFallbackPlan}>
              {fallbackPlan ? <RefreshCw className="h-3.5 w-3.5" /> : <span className="text-xs">Load</span>}
            </Button>
          </div>
          {fallbackPlan ? (
            <div className="space-y-3">
              <p className="text-sm text-foreground/80">{fallbackPlan.recommendation}</p>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Browser-guided steps:</p>
                {fallbackPlan.browserSteps.map((s, i) => (
                  <p key={i} className="text-xs text-foreground/60">{s}</p>
                ))}
              </div>
              {fallbackPlan.manualInstructions.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">CLI commands (if preferred):</p>
                  <pre className="text-xs font-mono text-foreground/50 bg-black/20 rounded-lg p-3 overflow-x-auto">
                    {fallbackPlan.manualInstructions.join("\n")}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Click Load to see the current fallback plan for applying Railway variables.</p>
          )}
        </div>

      </div>
    </div>
  );
}
