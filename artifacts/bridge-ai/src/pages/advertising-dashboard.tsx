import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Megaphone, Play, RefreshCw, Zap, Target, DollarSign, Eye,
  MousePointer, Activity, TrendingUp, BarChart3, CheckCircle2,
  XCircle, Clock, Loader2, Briefcase, Share2, Camera, Video,
  ThumbsUp, PlayCircle, X, Sparkles, AlertCircle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function getAdminToken() {
  return localStorage.getItem("viba_admin_token") ?? "";
}

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Authorization": `Bearer ${getAdminToken()}`, "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

const PLATFORM_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  instagram: { label: "Instagram", color: "text-purple-400", icon: <Camera className="w-4 h-4" /> },
  tiktok: { label: "TikTok", color: "text-pink-400", icon: <Video className="w-4 h-4" /> },
  facebook: { label: "Facebook", color: "text-blue-400", icon: <ThumbsUp className="w-4 h-4" /> },
  x_twitter: { label: "X (Twitter)", color: "text-sky-400", icon: <X className="w-4 h-4" /> },
  linkedin: { label: "LinkedIn", color: "text-blue-500", icon: <Briefcase className="w-4 h-4" /> },
  youtube_shorts: { label: "YouTube Shorts", color: "text-red-400", icon: <PlayCircle className="w-4 h-4" /> },
  pinterest: { label: "Pinterest", color: "text-rose-400", icon: <Share2 className="w-4 h-4" /> },
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft: { label: "Draft", className: "border-amber-500/20 text-zinc-400" },
    approved: { label: "Approved", className: "border-green-500/50 text-green-400" },
    published: { label: "Published", className: "border-emerald-500/50 text-emerald-400" },
    rejected: { label: "Rejected", className: "border-red-500/50 text-red-400" },
    active: { label: "Active", className: "border-amber-500/50 text-amber-400" },
  };
  const meta = map[status] ?? { label: status, className: "border-zinc-500/30 text-zinc-400" };
  return <Badge variant="outline" className={meta.className}>{meta.label}</Badge>;
}

function MetricCard({ icon, label, value, sub, color = "text-amber-400" }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <Card className="border-border/50 bg-card/80">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1"><span className={color}>{icon}</span><span className="text-xs text-muted-foreground">{label}</span></div>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function AdvertisingDashboard() {
  const { toast } = useToast();
  const [dashboard, setDashboard] = useState<any>(null);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [content, setContent] = useState<any[]>([]);
  const [contentTotal, setContentTotal] = useState(0);
  const [channels, setChannels] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [blasting, setBlasting] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [dash, strats, ch] = await Promise.all([
        api("/api/advertising/dashboard"),
        api("/api/advertising/strategies"),
        api("/api/advertising/channels"),
      ]);
      setDashboard(dash); setStrategies(Array.isArray(strats) ? strats : []); setChannels(ch);
    } catch (err) {
      toast({ title: "Load failed", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function loadContent(status = "all") {
    try {
      const r = await api(`/api/advertising/content?status=${status}&limit=30`);
      setContent(r.items ?? []); setContentTotal(r.total ?? 0);
    } catch { /* skip */ }
  }

  async function runCycle() {
    setRunning(true);
    try {
      const r = await api("/api/advertising/cycle", { method: "POST" });
      toast({ title: "Cycle complete", description: `Generated ${r.postsGenerated ?? 0} content pieces` });
      await loadAll(); await loadContent();
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  async function blast() {
    setBlasting(true);
    try {
      const r = await api("/api/advertising/blast", { method: "POST", body: JSON.stringify({}) });
      toast({ title: "Blast complete!", description: `${r.succeeded}/${r.total} channels generated` });
      await loadContent();
    } catch (err) {
      toast({ title: "Blast failed", description: String(err), variant: "destructive" });
    } finally {
      setBlasting(false);
    }
  }

  async function updateStatus(id: number, status: string) {
    try {
      await api(`/api/advertising/content/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      toast({ title: `Marked as ${status}` });
      await loadContent();
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    }
  }

  useEffect(() => { loadAll(); loadContent(); }, []);

  if (loading) return (
    <AppLayout>
      <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-amber-400" /></div>
    </AppLayout>
  );

  const perf = dashboard?.performance;
  const queue = dashboard?.contentQueue ?? {};

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Megaphone className="h-6 w-6 text-amber-400" /> Advertising Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">Autonomous advertising orchestrator — VIBA growth engine</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadAll}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
            <Button variant="outline" size="sm" onClick={blast} disabled={blasting}>
              {blasting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
              One-Click Blast
            </Button>
            <Button size="sm" onClick={runCycle} disabled={running} className="bg-amber-500 hover:bg-amber-600 text-black">
              {running ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
              Run Cycle
            </Button>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard icon={<Eye className="h-4 w-4" />} label="Impressions (30d)" value={(perf?.impressions ?? 0).toLocaleString()} sub="Total reach" />
          <MetricCard icon={<MousePointer className="h-4 w-4" />} label="Clicks (30d)" value={(perf?.clicks ?? 0).toLocaleString()} sub={`CTR: ${((perf?.ctr ?? 0) * 100).toFixed(2)}%`} color="text-blue-400" />
          <MetricCard icon={<Target className="h-4 w-4" />} label="Conversions" value={perf?.conversions ?? 0} sub="Last 30 days" color="text-green-400" />
          <MetricCard icon={<DollarSign className="h-4 w-4" />} label="Spend (30d)" value={`$${(perf?.spend ?? 0).toFixed(2)}`} sub="Budget utilization" color="text-purple-400" />
        </div>

        {/* Queue overview */}
        <div className="grid grid-cols-4 gap-3">
          {Object.entries(queue).map(([status, cnt]) => (
            <Card key={status} className="border-border/50 bg-card/50 cursor-pointer hover:bg-card/80 transition" onClick={() => loadContent(status)}>
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold">{cnt as number}</p>
                <p className="text-xs text-muted-foreground capitalize">{status}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="content">
          <TabsList>
            <TabsTrigger value="content">Content Queue ({contentTotal})</TabsTrigger>
            <TabsTrigger value="strategies">Growth Strategies</TabsTrigger>
            <TabsTrigger value="channels">Channels</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="content" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Content Queue</CardTitle>
                  <div className="flex gap-2">
                    {["all", "draft", "approved", "published"].map(s => (
                      <Button key={s} variant="ghost" size="sm" className="text-xs h-7" onClick={() => loadContent(s)}>{s}</Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {content.length === 0 ? (
                  <div className="text-center py-10 space-y-3">
                    <Megaphone className="h-10 w-10 text-muted-foreground mx-auto opacity-30" />
                    <p className="text-muted-foreground">No content yet. Run a cycle to generate.</p>
                    <Button onClick={runCycle} disabled={running} size="sm" variant="outline">
                      {running ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />} Run Cycle
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {content.map((item: any) => {
                      const pm = PLATFORM_META[item.platform] ?? { label: item.platform, color: "text-zinc-400", icon: <Activity className="w-4 h-4" /> };
                      return (
                        <div key={item.id} className="p-3 rounded-lg border border-border/50 bg-card/50 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={pm.color}>{pm.icon}</span>
                              <span className="text-xs font-medium text-muted-foreground">{pm.label}</span>
                              <StatusBadge status={item.status} />
                            </div>
                            <div className="flex gap-1 shrink-0">
                              {item.status === "draft" && (
                                <>
                                  <Button size="sm" variant="ghost" className="h-7 text-xs text-green-400" onClick={() => updateStatus(item.id, "approved")}>
                                    <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400" onClick={() => updateStatus(item.id, "rejected")}>
                                    <XCircle className="h-3 w-3 mr-1" /> Reject
                                  </Button>
                                </>
                              )}
                              {item.status === "approved" && (
                                <Button size="sm" variant="ghost" className="h-7 text-xs text-blue-400" onClick={() => updateStatus(item.id, "published")}>
                                  <Play className="h-3 w-3 mr-1" /> Publish
                                </Button>
                              )}
                            </div>
                          </div>
                          {item.headline && <p className="font-semibold text-sm">{item.headline}</p>}
                          {item.body && <p className="text-xs text-muted-foreground line-clamp-3">{item.body}</p>}
                          {Array.isArray(item.hashtags) && item.hashtags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {item.hashtags.slice(0, 5).map((tag: string, i: number) => (
                                <span key={i} className="text-[10px] text-amber-400/70">{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="strategies" className="mt-4">
            <div className="grid md:grid-cols-2 gap-3">
              {strategies.map((s: any, i: number) => (
                <Card key={i} className="border-border/50 bg-card/50">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm capitalize">{s.channel.replace(/_/g, " ")}</p>
                      <div className="flex gap-2">
                        <Badge variant="outline" className={s.costPerMonth === 0 ? "text-green-400 border-green-500/30" : "text-amber-400 border-amber-500/30"}>
                          {s.costPerMonth === 0 ? "Free" : `$${s.costPerMonth}/mo`}
                        </Badge>
                        <Badge variant="outline" className={s.expectedImpact === "high" ? "text-emerald-400 border-emerald-500/30" : "text-yellow-400 border-yellow-500/30"}>
                          {s.expectedImpact} impact
                        </Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{s.frequency}</span>
                      {s.automatable && <span className="flex items-center gap-1 text-amber-400"><Zap className="h-3 w-3" /> automatable</span>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="channels" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Channel Status</CardTitle></CardHeader>
              <CardContent>
                {channels?.core ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground mb-3">{channels.summary?.coreConnected ?? 0} of {channels.summary?.coreTotal ?? 0} channels connected</p>
                    {channels.core.map((ch: any) => (
                      <div key={ch.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                        <div className="flex items-center gap-2">
                          <div className={`h-2 w-2 rounded-full ${ch.connected ? "bg-green-400" : "bg-zinc-600"}`} />
                          <span className="text-sm">{ch.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {ch.connected ? (
                            <Badge variant="outline" className="text-green-400 border-green-500/30 text-xs">Connected</Badge>
                          ) : (
                            <Badge variant="outline" className="text-zinc-400 border-zinc-500/30 text-xs">Not configured</Badge>
                          )}
                          <span className="text-xs text-muted-foreground">{ch.envKey}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="text-muted-foreground text-center py-8">Loading channels…</div>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader>
              <CardContent>
                {dashboard?.recentActivity?.length === 0 ? (
                  <div className="text-muted-foreground text-center py-8">No activity yet. Run a cycle to see activity.</div>
                ) : (
                  <div className="space-y-2">
                    {(dashboard?.recentActivity ?? []).map((a: any, i: number) => (
                      <div key={i} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0 text-sm">
                        <div className="flex items-center gap-2">
                          <Activity className="h-3 w-3 text-amber-400" />
                          <span className="font-medium">{a.action}</span>
                          {a.description && <span className="text-muted-foreground text-xs">— {a.description}</span>}
                        </div>
                        <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
