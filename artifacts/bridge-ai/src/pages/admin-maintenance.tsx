import { useCallback, useEffect, useState } from "react";
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
    if (!window.confirm("Merge the current VIBA maintenance update into main? This will re-run sandbox verification first.")) return;
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

  const statusColor = update?.status === "merge_ready" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : update?.status === "failed" || update?.status === "merge_blocked" ? "bg-red-500/15 text-red-400 border-red-500/30" : "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="border-b border-zinc-800 bg-zinc-900/80 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">VIBA Maintenance</h1>
            <p className="text-xs text-zinc-500">Weekly self-audit, repair loop, checkpoint, and admin-approved merge.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || busy}>Refresh</Button>
            <Button variant="outline" size="sm" onClick={runNow} disabled={busy}>Run now</Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={mergeCurrentUpdate} disabled={!mergeReady || busy}>
              Merge current update
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              Current update
              {update && <Badge className={statusColor}>{update.status}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {loading ? (
              <p className="text-zinc-500">Loading…</p>
            ) : !update ? (
              <p className="text-zinc-500">No maintenance run yet. Use “Run now” or wait for Sunday 10:00 PM Melbourne time.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <Info label="Repository" value={update.repo_full_name} />
                <Info label="Base branch" value={update.base_branch} />
                <Info label="Repair run" value={String(update.self_repair_run_id ?? "—")} />
                <Info label="Checkpoint" value={String(update.checkpoint_id ?? "—")} />
                <Info label="PR" value={update.pr_number ? `#${update.pr_number}` : "—"} />
                <Info label="Notification" value={update.notification_status ?? "—"} />
                {update.pr_url && (
                  <a className="text-blue-400 hover:text-blue-300 underline" href={update.pr_url} target="_blank" rel="noreferrer">Open GitHub PR</a>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader><CardTitle className="text-sm">Repair event timeline</CardTitle></CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-xs text-zinc-500">No events yet.</p>
            ) : (
              <div className="space-y-2">
                {events.map((event) => (
                  <div key={event.id} className="rounded border border-zinc-800 bg-zinc-950/50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-mono text-zinc-300">{event.event_type}</span>
                      <span className="text-[10px] text-zinc-500">{new Date(event.created_at).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">{event.message}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 font-mono text-zinc-200 break-all">{value}</p>
    </div>
  );
}
