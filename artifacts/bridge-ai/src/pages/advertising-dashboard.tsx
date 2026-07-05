import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Clock, Loader2, Megaphone, Power, PowerOff } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function getAdminToken() {
  return sessionStorage.getItem("viba_admin_token") ?? localStorage.getItem("viba_admin_token") ?? "";
}

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${getAdminToken()}`,
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
    credentials: "include",
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="outline" className="border-green-500/40 text-green-400">Running</Badge>
  ) : (
    <Badge variant="outline" className="border-zinc-500/40 text-zinc-400">Stopped</Badge>
  );
}

export default function AdvertisingDashboard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const schedulerStatus = await api("/api/advertising/scheduler/status");
      setStatus(schedulerStatus);
    } catch (err) {
      toast({ title: "Load failed", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function startSystem() {
    setBusy(true);
    try {
      const result = await api("/api/advertising/scheduler/start", { method: "POST" });
      setStatus(result.status ?? result);
      toast({ title: "VIBA Growth Autopilot started" });
      await load();
    } catch (err) {
      toast({ title: "Start failed", description: String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function stopSystem() {
    setBusy(true);
    try {
      const result = await api("/api/advertising/scheduler/stop", { method: "POST" });
      setStatus(result.status ?? result);
      toast({ title: "VIBA Growth Autopilot stopped" });
      await load();
    } catch (err) {
      toast({ title: "Stop failed", description: String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
        </div>
      </AppLayout>
    );
  }

  const isActive = Boolean(status?.active ?? status?.schedulerActive);

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Megaphone className="h-6 w-6 text-amber-400" />
              VIBA Growth Autopilot
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              One admin control: start or stop VIBA's autonomous VIBA-only organic growth system.
            </p>
          </div>
          <StatusBadge active={isActive} />
        </div>

        <Card className="border-border/50 bg-card/80">
          <CardHeader>
            <CardTitle className="text-base">System Control</CardTitle>
            <CardDescription>
              When running, the system generates professional VIBA-specific content about UI testing, beta testing, repo testing, reports, applied repairs, multi-AI collaboration, complex system building, live task delegation, performance visibility and user-facing outputs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Button onClick={startSystem} disabled={busy || isActive} className="h-12 bg-green-500 text-black hover:bg-green-600">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Power className="mr-2 h-4 w-4" />}
                Start System
              </Button>
              <Button variant="destructive" onClick={stopSystem} disabled={busy || !isActive} className="h-12">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PowerOff className="mr-2 h-4 w-4" />}
                Stop System
              </Button>
            </div>

            <div className="grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-3">
              <div className="rounded-lg border border-border/50 p-4">
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="mt-1 font-semibold">{isActive ? "Running" : "Stopped"}</p>
              </div>
              <div className="rounded-lg border border-border/50 p-4">
                <p className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />Last Run</p>
                <p className="mt-1 text-sm font-medium">{status?.lastRun ? new Date(status.lastRun).toLocaleString() : "Not yet"}</p>
              </div>
              <div className="rounded-lg border border-border/50 p-4">
                <p className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />Next Run</p>
                <p className="mt-1 text-sm font-medium">{status?.nextRun ? new Date(status.nextRun).toLocaleString() : "Not scheduled"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
