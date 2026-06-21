import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, GitBranch, GitPullRequest, LockKeyhole, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

type MaintenanceUpdate = {
  id: number;
  run_key: string;
  status: string;
  repo_full_name: string;
  base_branch: string;
  self_repair_run_id: number | null;
  pr_number: number | null;
  pr_url: string | null;
  checkpoint_id: number | null;
  notification_status: string | null;
  created_at: string;
  updated_at: string;
};

type MaintenanceEvent = {
  id: number;
  event_type: string;
  severity: string;
  status: string;
  message: string;
  metadata: unknown;
  created_at: string;
};

async function adminFetch(path: string, options: RequestInit = {}) {
  return fetch(`/api/admin/maintenance${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function statusTone(status?: string): string {
  switch (status) {
    case "merge_ready":
    case "merged":
    case "passed":
      return "border-emerald-500/30 bg-emerald-500/15 text-emerald-300";
    case "failed":
    case "merge_blocked":
      return "border-red-500/30 bg-red-500/15 text-red-300";
    case "running":
      return "border-blue-500/30 bg-blue-500/15 text-blue-300";
    default:
      return "border-zinc-600/30 bg-zinc-700/25 text-zinc-300";
  }
}

function statusLabel(status?: string): string {
  if (!status) return "NO RUN";
  return status.replace(/_/g, " ").toUpperCase();
}

export default function AdminMaintenance() {
  const { toast } = useToast();
  const [update, setUpdate] = useState<MaintenanceUpdate | null>(null);
  const [mergeReady, setMergeReady] = useState(false);
  const [events, setEvents] = useState<MaintenanceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/current-update");
      if (!res.ok) throw new Error("Failed to load maintenance update");
      const data = await res.json() as { update: MaintenanceUpdate | null; mergeReady: boolean };
      setUpdate(data.update);
      setMergeReady(data.mergeReady);
      if (data.update?.id) {
        const eventsRes = await adminFetch(`/runs/${data.update.id}/events`);
        if (eventsRes.ok) {
          const eventsData = await eventsRes.json() as { events: MaintenanceEvent[] };
          setEvents(eventsData.events ?? []);
        }
      } else {
        setEvents([]);
      }
    } catch (error) {
      toast({ title: "Maintenance load failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const runNow = async () => {
    if (!window.confirm("Start a manual VIBA self-maintenance run now? It will create a branch/PR only; it will not merge without approval.")) return;
    setBusy(true);
    try {
      const res = await adminFetch("/run-now", { method: "POST", headers: { "X-Admin-Confirm": "true" } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { message?: string }).message ?? "Manual maintenance failed");
      toast({ title: "Maintenance started", description: "VIBA is auditing and repairing itself." });
      await load();
    } catch (error) {
      toast({ title: "Run failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const mergeCurrentUpdate = async () => {
    const confirmed = window.confirm("Final authority required: merge the current VIBA update into main? Sandbox verification will run again first. If verification fails, merge is blocked.");
    if (!confirmed) return;
    setBusy(true);
    try {
      const res = await adminFetch("/merge-current-update", { method: "POST", headers: { "X-Admin-Confirm": "true" } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string; reason?: string }).error ?? (data as { reason?: string }).reason ?? "Merge failed");
      toast({ title: "Merged", description: "Current maintenance update was merged after sandbox verification." });
      await load();
    } catch (error) {
      toast({ title: "Merge blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const latestStatus = update?.status ?? "no_run";
  const healthText = useMemo(() => {
    if (!update) return "No maintenance run has been recorded yet.";
    if (update.status === "merge_ready") return "Update is ready. Admin approval is required before merge.";
    if (update.status === "merged") return "Latest approved update has been merged.";
    if (update.status === "failed") return "Maintenance failed. Review event log before retry.";
    if (update.status === "merge_blocked") return "Merge was blocked by sandbox verification.";
    if (update.status === "running") return "Maintenance run is currently active.";
    return "Maintenance state recorded. Review details below.";
  }, [update]);

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(20,184,166,0.18),_transparent_32%),linear-gradient(135deg,_#030712_0%,_#09090b_45%,_#111827_100%)] text-zinc-100">
      <div className="border-b border-white/10 bg-black/35 backdrop-blur-xl sticky top-0 z-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-teal-300/80">
              <ShieldCheck className="h-4 w-4" /> Admin authority required
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">VIBA Maintenance Control</h1>
            <p className="max-w-3xl text-sm text-zinc-400">Self-audit, code repair, sandbox verification, checkpointing, PR creation, and owner-approved merge control.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || busy} className="border-white/15 bg-white/5 text-zinc-100 hover:bg-white/10">
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={runNow} disabled={busy} className="border-blue-400/30 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20">
              <Wrench className="mr-2 h-4 w-4" /> Run now
            </Button>
            <Button size="sm" className="col-span-2 bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-400 sm:col-span-1" onClick={mergeCurrentUpdate} disabled={!mergeReady || busy}>
              <GitPullRequest className="mr-2 h-4 w-4" /> Merge current update
            </Button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <section className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <Card className="border-white/10 bg-black/35 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <CardHeader className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-3 text-xl">
                    Current update
                    <Badge className={statusTone(latestStatus)}>{statusLabel(latestStatus)}</Badge>
                  </CardTitle>
                  <p className="mt-2 text-sm text-zinc-400">{healthText}</p>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-400">
                  Last refresh: {new Date().toLocaleTimeString()}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-zinc-400">Loading maintenance state…</div>
              ) : !update ? (
                <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-8">
                  <div className="mx-auto flex max-w-xl flex-col items-center text-center">
                    <Clock3 className="h-10 w-10 text-teal-300" />
                    <h2 className="mt-4 text-lg font-semibold">No maintenance run yet</h2>
                    <p className="mt-2 text-sm text-zinc-400">Use Run now to create the first self-maintenance branch and PR, or wait for Sunday 10:00 PM Melbourne time.</p>
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <Info icon={<GitBranch className="h-4 w-4" />} label="Repository" value={update.repo_full_name} />
                  <Info icon={<GitBranch className="h-4 w-4" />} label="Base branch" value={update.base_branch} />
                  <Info icon={<Wrench className="h-4 w-4" />} label="Repair run" value={String(update.self_repair_run_id ?? "—")} />
                  <Info icon={<ShieldCheck className="h-4 w-4" />} label="Checkpoint" value={String(update.checkpoint_id ?? "—")} />
                  <Info icon={<GitPullRequest className="h-4 w-4" />} label="PR" value={update.pr_number ? `#${update.pr_number}` : "—"} />
                  <Info icon={<Clock3 className="h-4 w-4" />} label="Updated" value={formatDate(update.updated_at)} />
                  <Info className="sm:col-span-2 xl:col-span-3" icon={<LockKeyhole className="h-4 w-4" />} label="Notification" value={update.notification_status ?? "—"} />
                </div>
              )}

              {update?.pr_url && (
                <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-blue-400/20 bg-blue-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-blue-100">GitHub PR is available for review</p>
                    <p className="text-xs text-blue-200/70">Review the diff before pressing Merge current update.</p>
                  </div>
                  <a className="inline-flex items-center justify-center rounded-md bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-400" href={update.pr_url} target="_blank" rel="noreferrer">
                    Open PR
                  </a>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-black/35 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-base">Safety gates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Gate ok label="Admin-only access" text="Only your approved admin login can open this panel." />
              <Gate ok label="No auto-merge" text="VIBA can prepare an update, but merge requires your approval." />
              <Gate ok label="Sandbox verification" text="Merge re-runs install, typecheck, and build first." />
              <Gate ok label="Checkpoint before merge" text="A restore point is created before main changes." />
              <Gate ok={mergeReady} label="Update ready" text={mergeReady ? "Current update can be approved." : "No merge-ready update yet."} />
            </CardContent>
          </Card>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <Card className="border-white/10 bg-black/35 backdrop-blur-xl">
            <CardHeader><CardTitle className="text-base">Operating boundary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-zinc-400">
              <Boundary title="VIBA source repo" value="Admin only. Internal token allowed only for scheduled maintenance." />
              <Boundary title="User project sandbox" value="Users may control only their own project workspace and connected repos." />
              <Boundary title="Production merge" value="Never automatic. Requires admin authority and clean sandbox verification." />
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-black/35 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Repair event timeline
                <Badge variant="outline" className="border-white/10 text-zinc-400">{events.length} events</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-zinc-500">No events yet.</p>
              ) : (
                <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
                  {events.map((event) => (
                    <div key={event.id} className="rounded-2xl border border-white/10 bg-zinc-950/65 p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                          {event.severity === "high" ? <AlertTriangle className="h-4 w-4 text-red-300" /> : <CheckCircle2 className="h-4 w-4 text-emerald-300" />}
                          <span className="font-mono text-xs text-zinc-200">{event.event_type}</span>
                          <Badge className={statusTone(event.status)}>{statusLabel(event.status)}</Badge>
                        </div>
                        <span className="text-[11px] text-zinc-500">{formatDate(event.created_at)}</span>
                      </div>
                      <p className="mt-2 text-sm text-zinc-400">{event.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}

function Info({ label, value, icon, className = "" }: { label: string; value: string; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${className}`}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        {icon}
        {label}
      </div>
      <p className="mt-2 break-all font-mono text-sm text-zinc-100">{value}</p>
    </div>
  );
}

function Gate({ ok, label, text }: { ok: boolean; label: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      {ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" /> : <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-zinc-500" />}
      <div>
        <p className="text-sm font-medium text-zinc-100">{label}</p>
        <p className="mt-1 text-xs text-zinc-500">{text}</p>
      </div>
    </div>
  );
}

function Boundary({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-teal-300/80">{title}</p>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{value}</p>
    </div>
  );
}
