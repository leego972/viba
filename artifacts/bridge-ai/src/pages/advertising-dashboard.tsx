import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Activity, CheckCircle2, Clock, Loader2, Megaphone, Power, PowerOff, RefreshCw, XCircle } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function getAdminToken() {
  return localStorage.getItem("viba_admin_token") ?? "";
}

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${getAdminToken()}`,
      "Content-Type": "application/json",
      ...opts?.headers,
    },
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
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [schedulerStatus, dash] = await Promise.all([
        api("/api/advertising/scheduler/status"),
        api("/api/advertising/dashboard"),
      ]);
      setStatus(schedulerStatus);
      setDashboard(dash);
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
      toast({ title: "VIBA growth system started", description: "The system will generate VIBA-only SEO and organic content automatically." });
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
      toast({ title: "VIBA growth system stopped" });
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

  const isActive = Boolean(status?.active ?? status?.schedulerActive ?? dashboard?.growth?.schedulerActive);
  const queue = dashboard?.contentQueue ?? {};

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Megaphone className="h-6 w-6 text-amber-400" />
              VIBA Growth System
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Autonomous VIBA-only SEO, content creation and organic growth pipeline.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={busy}>
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
            <Button size="sm" onClick={startSystem} disabled={busy || isActive} className="bg-green-500 text-black hover:bg-green-600">
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Power className="mr-1 h-4 w-4" />}
              Start System
            </Button>
            <Button size="sm" variant="destructive" onClick={stopSystem} disabled={busy || !isActive}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PowerOff className="mr-1 h-4 w-4" />}
              Stop System
            </Button>
          </div>
        </div>

        <Card className="border-border/50 bg-card/80">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">System Status</CardTitle>
                <CardDescription>Only Start and Stop controls are exposed here. The system handles the rest automatically.</CardDescription>
              </div>
              <StatusBadge active={isActive} />
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <div className="rounded-lg border border-border/50 p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Activity className="h-3 w-3" />Cycles</div>
              <p className="text-2xl font-bold">{status?.cycleCount ?? dashboard?.growth?.cycleCount ?? 0}</p>
            </div>
            <div className="rounded-lg border border-border/50 p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Clock className="h-3 w-3" />Last Run</div>
              <p className="text-sm font-medium">{status?.lastRun ? new Date(status.lastRun).toLocaleString() : "Not yet"}</p>
            </div>
            <div className="rounded-lg border border-border/50 p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Clock className="h-3 w-3" />Next Run</div>
              <p className="text-sm font-medium">{status?.nextRun ? new Date(status.nextRun).toLocaleString() : "Not scheduled"}</p>
            </div>
            <div className="rounded-lg border border-border/50 p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-3 w-3" />Spend Mode</div>
              <p className="text-sm font-medium text-green-400">Free organic only</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/80">
          <CardHeader>
            <CardTitle className="text-base">Content Queue</CardTitle>
            <CardDescription>Read-only overview. The autonomous system decides what to generate and process.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Object.entries({ draft: 0, approved: 0, published: 0, rejected: 0, ...queue }).map(([key, value]) => (
              <div key={key} className="rounded-lg border border-border/50 p-4 text-center">
                <p className="text-2xl font-bold">{Number(value ?? 0)}</p>
                <p className="text-xs capitalize text-muted-foreground">{key}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/80">
          <CardHeader>
            <CardTitle className="text-base">VIBA-Only Content Guard</CardTitle>
            <CardDescription>The growth system must create content only about VIBA.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-400" />Allowed: VIBA, multi-agent AI orchestration, website UI checks, code/repo review, AI collaboration, reports, cost control and developer workflows.</p>
            <p className="flex items-center gap-2"><XCircle className="h-4 w-4 text-red-400" />Blocked: unrelated projects, film studio content, fashion, tattoo, unrelated apps, Snapchat, TikTok and paid ads without owner approval.</p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
