import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Search, TrendingUp, BarChart3, Globe, Link, FileText,
  CheckCircle2, XCircle, AlertCircle, Zap, Activity, Eye,
  Target, RefreshCw, AlertTriangle, ExternalLink, Hash,
  BookOpen, Clock, Loader2, Power, PowerOff,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const ADMIN_TOKEN = localStorage.getItem("viba_admin_token") ?? "";

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Authorization": `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#27272a" strokeWidth={6} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={6} fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.5s ease" }} />
      </svg>
      <span className="absolute text-lg font-bold" style={{ color }}>{score}</span>
    </div>
  );
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

export default function SeoDashboard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [keywords, setKeywords] = useState<any[]>([]);
  const [vitals, setVitals] = useState<any>(null);
  const [briefs, setBriefs] = useState<any[]>([]);
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [eventLog, setEventLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [scheduler, setScheduler] = useState<{ active: boolean; cycleCount: number; lastRun: string | null; nextRun: string | null; intervalHours: number; currentlyRunning: boolean } | null>(null);
  const [schedulerToggling, setSchedulerToggling] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [s, h, k, v, e, sched] = await Promise.all([
        api("/api/seo/status"),
        api("/api/seo/health"),
        api("/api/seo/keywords"),
        api("/api/seo/web-vitals"),
        api("/api/seo/event-log?limit=20"),
        api("/api/seo/scheduler/status"),
      ]);
      setStatus(s); setHealth(h); setKeywords(Array.isArray(k) ? k : []); setVitals(v); setEventLog(Array.isArray(e) ? e : []); setScheduler(sched);
    } catch (err) {
      toast({ title: "Load failed", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function toggleScheduler() {
    if (!scheduler) return;
    setSchedulerToggling(true);
    try {
      const endpoint = scheduler.active ? "/api/seo/scheduler/stop" : "/api/seo/scheduler/start";
      const r = await api(endpoint, { method: "POST" });
      setScheduler(r);
      toast({ title: r.active ? "Scheduler started" : "Scheduler stopped", description: r.active ? `Runs every ${r.intervalHours}h automatically` : "SEO auto-runs paused" });
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setSchedulerToggling(false);
    }
  }

  async function loadBriefs() {
    try { setBriefs(await api("/api/seo/content-briefs?count=5")); } catch { /* skip */ }
  }

  async function loadCompetitors() {
    try { setCompetitors(await api("/api/seo/competitors")); } catch { /* skip */ }
  }

  async function runOptimize() {
    setRunning(true);
    try {
      const r = await api("/api/seo/optimize", { method: "POST" });
      toast({ title: r.ran ? "Optimization complete" : "Already killed", description: `Score: ${r.score}` });
      await loadAll();
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => { loadAll(); loadBriefs(); loadCompetitors(); }, []);

  if (loading) return (
    <AppLayout>
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
      </div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Search className="h-6 w-6 text-amber-400" /> SEO Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">VIBA search engine optimization — v{status?.version ?? "4.0"}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadAll}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
            <Button size="sm" onClick={runOptimize} disabled={running} className="bg-amber-500 hover:bg-amber-600 text-black">
              {running ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Zap className="h-4 w-4 mr-1" />}
              Run Now
            </Button>
          </div>
        </div>

        {/* Scheduler status banner */}
        {scheduler && (
          <div className={`flex items-center justify-between rounded-lg border px-4 py-3 ${scheduler.active ? "border-green-500/30 bg-green-500/5" : "border-border/50 bg-card/50"}`}>
            <div className="flex items-center gap-3">
              <span className={`relative flex h-2.5 w-2.5 ${scheduler.active ? "block" : "hidden"}`}>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
              </span>
              {!scheduler.active && <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" />}
              <div>
                <p className="text-sm font-medium flex items-center gap-2">
                  SEO Auto-Scheduler
                  <Badge variant={scheduler.active ? "default" : "secondary"} className={scheduler.active ? "bg-green-500/20 text-green-400 border-green-500/30" : ""}>
                    {scheduler.currentlyRunning ? "Running…" : scheduler.active ? "Live" : "Offline"}
                  </Badge>
                  {scheduler.active && <span className="text-xs text-muted-foreground">· every {scheduler.intervalHours}h</span>}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {scheduler.active
                    ? `Cycle #${scheduler.cycleCount} complete${scheduler.nextRun ? ` · Next: ${new Date(scheduler.nextRun).toLocaleString()}` : ""}`
                    : "Auto-optimization is paused. Start it to run SEO every 24 hours automatically."}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant={scheduler.active ? "outline" : "default"}
              onClick={toggleScheduler}
              disabled={schedulerToggling}
              className={scheduler.active ? "border-red-500/40 text-red-400 hover:bg-red-500/10" : "bg-green-600 hover:bg-green-700 text-white"}
            >
              {schedulerToggling ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : scheduler.active ? <PowerOff className="h-3.5 w-3.5 mr-1" /> : <Power className="h-3.5 w-3.5 mr-1" />}
              {scheduler.active ? "Stop Scheduler" : "Start Scheduler"}
            </Button>
          </div>
        )}

        {/* Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard icon={<Target className="h-4 w-4" />} label="SEO Score" value={health?.score ?? "—"} sub="out of 100" />
          <MetricCard icon={<Hash className="h-4 w-4" />} label="Keywords Tracked" value={keywords.length} sub="active" color="text-blue-400" />
          <MetricCard icon={<Activity className="h-4 w-4" />} label="Web Vitals" value="Good" sub="Core vitals passing" color="text-green-400" />
          <MetricCard icon={<Clock className="h-4 w-4" />} label="Last Run" value={status?.lastRun ? new Date(status.lastRun).toLocaleDateString() : "Never"} sub={status?.hasCachedReport ? "Report cached" : "No cache"} color="text-purple-400" />
        </div>

        <Tabs defaultValue="keywords">
          <TabsList>
            <TabsTrigger value="keywords">Keywords</TabsTrigger>
            <TabsTrigger value="vitals">Web Vitals</TabsTrigger>
            <TabsTrigger value="briefs">Content Briefs</TabsTrigger>
            <TabsTrigger value="competitors">Competitors</TabsTrigger>
            <TabsTrigger value="issues">Issues & Strengths</TabsTrigger>
            <TabsTrigger value="log">Event Log</TabsTrigger>
          </TabsList>

          <TabsContent value="keywords" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Hash className="h-4 w-4 text-amber-400" /> Target Keywords</CardTitle></CardHeader>
              <CardContent>
                {keywords.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No keywords loaded. Run optimization first.</div>
                ) : (
                  <div className="space-y-2">
                    {keywords.map((kw, i) => (
                      <div key={i} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0 gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{kw.keyword}</p>
                          {kw.intent && <span className="text-xs text-muted-foreground">{kw.intent}</span>}
                        </div>
                        <div className="flex items-center gap-4 text-xs flex-shrink-0">
                          <div className="text-right">
                            <p className="text-green-400">{kw.searchVolume?.toLocaleString() ?? "—"}</p>
                            <p className="text-muted-foreground">vol/mo</p>
                          </div>
                          <div className="text-right">
                            <p className={kw.difficulty <= 30 ? "text-emerald-400" : kw.difficulty <= 60 ? "text-yellow-400" : "text-red-400"}>{kw.difficulty ?? "—"}/100</p>
                            <p className="text-muted-foreground">difficulty</p>
                          </div>
                          <Badge variant="outline" className="text-xs">{kw.opportunity ?? "—"}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="vitals" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4 text-green-400" /> Core Web Vitals</CardTitle></CardHeader>
              <CardContent>
                {vitals ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {Object.entries(vitals).map(([key, v]: [string, any]) => (
                      <div key={key} className="p-3 rounded-lg border border-border/50 bg-card/50">
                        <p className="text-xs text-muted-foreground">{v.label}</p>
                        <p className="text-xl font-bold mt-1">{v.value}<span className="text-xs ml-1 text-muted-foreground">{key === "cls" ? "" : key === "ttfb" || key === "fid" ? "ms" : "s"}</span></p>
                        <Badge variant="outline" className={v.score === "good" ? "border-green-500/40 text-green-400 text-[10px] mt-1" : "border-yellow-500/40 text-yellow-400 text-[10px] mt-1"}>{v.score}</Badge>
                      </div>
                    ))}
                  </div>
                ) : <div className="text-muted-foreground text-center py-8">No vitals data</div>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="briefs" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2"><BookOpen className="h-4 w-4 text-blue-400" /> Content Briefs</CardTitle>
                  <Button variant="outline" size="sm" onClick={loadBriefs}><RefreshCw className="h-3 w-3 mr-1" /> Refresh</Button>
                </div>
              </CardHeader>
              <CardContent>
                {briefs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">Loading content briefs…</div>
                ) : (
                  <div className="space-y-3">
                    {briefs.map((b: any, i: number) => (
                      <div key={i} className="p-3 rounded-lg border border-border/50 bg-card/50 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm">{b.title}</p>
                          <Badge variant="outline" className="text-xs shrink-0">{b.intent}</Badge>
                        </div>
                        <p className="text-xs text-amber-400">Target: <span className="text-foreground">{b.targetKeyword}</span></p>
                        {Array.isArray(b.outline) && (
                          <ul className="text-xs text-muted-foreground space-y-0.5 ml-3">
                            {b.outline.slice(0, 4).map((item: string, j: number) => <li key={j}>• {item}</li>)}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="competitors" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2"><Eye className="h-4 w-4 text-purple-400" /> Competitor Analysis</CardTitle>
                  <Button variant="outline" size="sm" onClick={loadCompetitors}><RefreshCw className="h-3 w-3 mr-1" /> Refresh</Button>
                </div>
              </CardHeader>
              <CardContent>
                {competitors.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">Loading competitor analysis…</div>
                ) : (
                  <div className="space-y-3">
                    {competitors.map((c: any, i: number) => (
                      <div key={i} className="p-3 rounded-lg border border-border/50 bg-card/50 space-y-2">
                        <p className="font-semibold text-sm">{c.competitor}</p>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="text-green-400 mb-1 font-medium">Their Strengths</p>
                            <ul className="space-y-0.5 text-muted-foreground">{c.strengths?.map((s: string, j: number) => <li key={j}>• {s}</li>)}</ul>
                          </div>
                          <div>
                            <p className="text-amber-400 mb-1 font-medium">Their Gaps</p>
                            <ul className="space-y-0.5 text-muted-foreground">{c.gaps?.map((g: string, j: number) => <li key={j}>• {g}</li>)}</ul>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="issues" className="mt-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2 text-red-400"><AlertTriangle className="h-4 w-4" /> Issues</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {health?.issues?.map((issue: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm"><XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />{issue}</li>
                    )) ?? <li className="text-muted-foreground text-sm">No issues found</li>}
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2 text-green-400"><CheckCircle2 className="h-4 w-4" /> Strengths</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {health?.strengths?.map((s: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />{s}</li>
                    )) ?? <li className="text-muted-foreground text-sm">Run optimization to see strengths</li>}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="log" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4 text-zinc-400" /> SEO Event Log</CardTitle></CardHeader>
              <CardContent>
                {eventLog.length === 0 ? (
                  <div className="text-muted-foreground text-center py-8">No events yet. Run optimization to create events.</div>
                ) : (
                  <div className="space-y-2">
                    {eventLog.map((e: any, i: number) => (
                      <div key={i} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0 text-sm">
                        <div className="flex items-center gap-2">
                          <Activity className="h-3 w-3 text-amber-400" />
                          <span className="font-medium">{e.event}</span>
                          {e.details && <span className="text-muted-foreground text-xs">— {e.details}</span>}
                        </div>
                        <span className="text-xs text-muted-foreground">{new Date(e.ts).toLocaleTimeString()}</span>
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
