import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Navbar } from "@/components/layout/Navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Activity, AlertTriangle, Bot, Brain, CheckCircle2, CircleDot, Clock, Code2, Eye, FileText, GitBranch, Layers, MessageSquare, Play, RefreshCw, Route, Send, ShieldCheck, Sparkles, Square, TestTube2, Wrench, Zap } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type CapabilityStatus = "executable" | "planning_only" | "credential_required" | "external_setup_required" | "adapter_required" | "failed" | "blocked";

interface ToolEntry {
  toolId: string;
  label: string;
  category: string;
  riskLevel: string;
  requiresApproval: boolean;
  supportsDryRun: boolean;
  requiresSafeBuild: boolean;
  credentialStatus: "configured" | "missing" | "not_required";
  rawValuesReturned: false;
}

interface CapabilityRecord {
  toolId: string;
  label: string;
  category: string;
  status: CapabilityStatus;
  canRunNow: boolean;
  truthfulClaim: string;
  missingForFullExecution: string[];
  rawValuesReturned: false;
}

interface Invocation { id?: number; tool_id?: string; toolLabel?: string; status?: string; risk_level?: string; created_at?: string; agent_name?: string | null }
interface RouteResponse { jobType?: string; sequence?: string[]; toolSequence?: string[]; rawValuesReturned?: false }
interface ProviderResponse { providers?: Array<{ id: string; status: string; label?: string }> }

const STATUS_STYLE: Record<string, string> = {
  executable: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  planning_only: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  credential_required: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  external_setup_required: "border-purple-500/30 bg-purple-500/10 text-purple-300",
  adapter_required: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  failed: "border-red-500/30 bg-red-500/10 text-red-300",
  blocked: "border-red-500/30 bg-red-500/10 text-red-300",
};

const WORKFLOWS = [
  { type: "repair", label: "Repair", icon: Wrench, prompt: "Diagnose, plan, verify, and produce evidence before declaring success." },
  { type: "design", label: "Design", icon: Eye, prompt: "Improve clarity, visual hierarchy, trust, mobile layout, and conversion." },
  { type: "upgrade", label: "Upgrade", icon: Sparkles, prompt: "Improve architecture, reliability, safety gates, user experience, and monitoring." },
  { type: "deploy", label: "Deploy", icon: Zap, prompt: "Check readiness, provider setup, verification, rollback notes, and evidence." },
];

function countByStatus(items: CapabilityRecord[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
}

function stageForTool(toolId: string) {
  if (toolId.includes("diagnose") || toolId.includes("blueprint")) return { label: "Understand", icon: Brain };
  if (toolId.includes("plan") || toolId.includes("criteria") || toolId.includes("spec")) return { label: "Design", icon: Layers };
  if (toolId.includes("github") || toolId.includes("patch")) return { label: "Change", icon: GitBranch };
  if (toolId.includes("test") || toolId.includes("build") || toolId.includes("gate")) return { label: "Verify", icon: TestTube2 };
  if (toolId.includes("report")) return { label: "Prove", icon: FileText };
  return { label: "Act", icon: CircleDot };
}

function BrainOrb({ active, warnings }: { active: number; warnings: number }) {
  return (
    <div className="relative mx-auto flex h-64 w-64 items-center justify-center">
      <div className="absolute inset-0 rounded-full bg-primary/10 blur-2xl" />
      <div className="absolute h-64 w-64 rounded-full border border-primary/20 animate-pulse" />
      <div className="absolute h-48 w-48 rounded-full border border-blue-400/20" />
      <div className="absolute h-32 w-32 rounded-full border border-purple-400/20" />
      <div className="absolute -top-1 left-1/2 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_20px_rgba(52,211,153,.9)]" />
      <div className="absolute right-8 top-20 h-2.5 w-2.5 rounded-full bg-blue-400 shadow-[0_0_20px_rgba(96,165,250,.9)]" />
      <div className="absolute bottom-8 left-14 h-2.5 w-2.5 rounded-full bg-purple-400 shadow-[0_0_20px_rgba(192,132,252,.9)]" />
      <div className="relative z-10 flex h-28 w-28 flex-col items-center justify-center rounded-full border border-white/10 bg-black/40 shadow-2xl backdrop-blur-xl">
        <Brain className={warnings > 0 ? "h-9 w-9 text-amber-300" : active > 0 ? "h-9 w-9 text-blue-300" : "h-9 w-9 text-emerald-300"} />
        <div className="mt-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Brain</div>
      </div>
    </div>
  );
}

function WorkflowRail({ route }: { route: RouteResponse | null }) {
  const sequence = route?.toolSequence ?? route?.sequence ?? ["builder.project.blueprint", "builder.feature.plan", "builder.patch.plan", "builder.test.plan", "builder.release.gate"];
  return (
    <div className="space-y-3">
      {sequence.map((toolId, index) => {
        const stage = stageForTool(toolId);
        const Icon = stage.icon;
        return (
          <div key={`${toolId}-${index}`} className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{index + 1}. {stage.label}</div>
              <div className="mt-1 truncate font-mono text-xs text-foreground/80">{toolId}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CapabilityCard({ item }: { item: CapabilityRecord }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><div className="truncate text-sm font-medium">{item.label}</div><div className="truncate font-mono text-[11px] text-muted-foreground">{item.toolId}</div></div>
        <Badge variant="outline" className={`shrink-0 text-[10px] ${STATUS_STYLE[item.status] ?? STATUS_STYLE.blocked}`}>{item.status.replace(/_/g, " ")}</Badge>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{item.truthfulClaim}</p>
    </div>
  );
}

export default function ToolConsolePage() {
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityRecord[]>([]);
  const [invocations, setInvocations] = useState<Invocation[]>([]);
  const [providers, setProviders] = useState<ProviderResponse["providers"]>([]);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [jobType, setJobType] = useState("repair");
  const [intervention, setIntervention] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [toolsRes, capRes, invRes, routeRes, providerRes] = await Promise.all([
        fetch(`${BASE}/api/tools`, { credentials: "include" }),
        fetch(`${BASE}/api/tools/capabilities`, { credentials: "include" }),
        fetch(`${BASE}/api/tools/invocations?limit=20`, { credentials: "include" }),
        fetch(`${BASE}/api/tools/route-job?type=${encodeURIComponent(jobType)}`, { credentials: "include" }),
        fetch(`${BASE}/api/providers`, { credentials: "include" }),
      ]);
      setTools(toolsRes.ok ? ((await toolsRes.json()) as { tools?: ToolEntry[] }).tools ?? [] : []);
      setCapabilities(capRes.ok ? ((await capRes.json()) as { capabilities?: CapabilityRecord[] }).capabilities ?? [] : []);
      setInvocations(invRes.ok ? ((await invRes.json()) as { invocations?: Invocation[] }).invocations ?? [] : []);
      setRoute(routeRes.ok ? ((await routeRes.json()) as RouteResponse) : null);
      setProviders(providerRes.ok ? ((await providerRes.json()) as ProviderResponse).providers ?? [] : []);
      if (!capRes.ok) setError("Capability route is not mounted yet. The screen works as a visual shell, but Replit must wire /api/tools/capabilities for full live status.");
    } catch {
      setError("Could not load live brain data. Check API server and session auth.");
    } finally {
      setLoading(false);
    }
  }, [jobType]);

  useEffect(() => { void fetchBrain(); }, [fetchBrain]);
  useEffect(() => { const timer = setInterval(() => void fetchBrain(true), 5000); return () => clearInterval(timer); }, [fetchBrain]);

  const counts = useMemo(() => countByStatus(capabilities), [capabilities]);
  const selected = WORKFLOWS.find((w) => w.type === jobType) ?? WORKFLOWS[0];
  const SelectedIcon = selected.icon;
  const liveProviders = (providers ?? []).filter((p) => p.status === "configured").length;
  const warnings = (counts.adapter_required ?? 0) + (counts.blocked ?? 0) + (counts.failed ?? 0);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.16),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(14,165,233,0.12),transparent_30%),radial-gradient(circle_at_50%_100%,rgba(168,85,247,0.12),transparent_30%)]" />
        <div className="relative mx-auto max-w-screen-2xl px-4 py-6 space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-primary"><Sparkles className="h-4 w-4" /> Live AI command surface</div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-5xl">The VIBA Brain</h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground md:text-base">A captivating operator screen where users can watch agent work, follow the tool route, see proof status, and interrupt at any time.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void fetchBrain()} disabled={loading} className="gap-2"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
              <Link href="/sessions/new"><Button className="gap-2"><Play className="h-4 w-4" /> Start job</Button></Link>
              <Link href="/agent-console"><Button variant="secondary" className="gap-2"><Code2 className="h-4 w-4" /> Agent console</Button></Link>
            </div>
          </div>

          {error && <div className="flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"><AlertTriangle className="h-4 w-4" /> {error}</div>}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[["Executable", counts.executable ?? 0, CheckCircle2], ["Planning", counts.planning_only ?? 0, Brain], ["Credentials", counts.credential_required ?? 0, ShieldCheck], ["Need work", warnings, Wrench], ["Providers", liveProviders, Bot]].map(([label, value, Icon]) => (
              <Card key={String(label)} className="border-white/[0.06] bg-white/[0.025]"><CardContent className="flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]"><Icon className="h-5 w-5 text-primary" /></div><div><div className="text-2xl font-bold">{String(value)}</div><div className="text-[11px] uppercase tracking-wider text-muted-foreground">{String(label)}</div></div></CardContent></Card>
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-[360px_1fr_360px]">
            <Card className="border-white/[0.06] bg-black/20 backdrop-blur-xl"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Brain className="h-4 w-4 text-primary" /> Brain state</CardTitle></CardHeader><CardContent><BrainOrb active={(counts.executable ?? 0) + (counts.planning_only ?? 0)} warnings={warnings} /><div className="mt-4 text-center text-xs text-muted-foreground">{tools.length} registered tools · {capabilities.length} classified capabilities</div></CardContent></Card>
            <Card className="border-white/[0.06] bg-black/20 backdrop-blur-xl"><CardHeader><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><CardTitle className="flex items-center gap-2 text-base"><Route className="h-4 w-4 text-primary" /> Workflow rail</CardTitle><div className="flex flex-wrap gap-2">{WORKFLOWS.map((flow) => { const Icon = flow.icon; return <button key={flow.type} onClick={() => setJobType(flow.type)} className={`rounded-lg border px-3 py-2 text-xs font-medium ${jobType === flow.type ? "border-primary/40 bg-primary/15 text-primary" : "border-white/[0.07] bg-white/[0.025] text-muted-foreground hover:text-foreground"}`}><Icon className="mr-1.5 inline h-3.5 w-3.5" />{flow.label}</button>; })}</div></div></CardHeader><CardContent className="grid gap-4 lg:grid-cols-[1fr_240px]"><WorkflowRail route={route} /><div className="rounded-xl border border-primary/20 bg-primary/5 p-4"><div className="flex items-center gap-2 text-sm font-semibold"><SelectedIcon className="h-4 w-4 text-primary" /> {selected.label}</div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{selected.prompt}</p></div></CardContent></Card>
            <Card className="border-white/[0.06] bg-black/20 backdrop-blur-xl"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="h-4 w-4 text-primary" /> User intervention</CardTitle></CardHeader><CardContent className="space-y-3"><Textarea value={intervention} onChange={(e) => setIntervention(e.target.value)} placeholder="Tell VIBA what to change, pause, avoid, or prioritise…" className="min-h-28 bg-black/20" /><div className="grid grid-cols-2 gap-2"><Button variant="outline" className="gap-2"><Square className="h-4 w-4" /> Pause</Button><Button className="gap-2" disabled={!intervention.trim()}><Send className="h-4 w-4" /> Add note</Button></div><p className="text-xs text-muted-foreground">Replit should wire these controls into the active session message and stop APIs.</p></CardContent></Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-white/[0.06] bg-black/20 backdrop-blur-xl"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-primary" /> Recent activity</CardTitle></CardHeader><CardContent className="space-y-2">{invocations.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No recent tool activity yet.</p> : invocations.slice(0, 8).map((item, i) => <div key={item.id ?? i} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3"><Clock className="h-4 w-4 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{item.toolLabel ?? item.tool_id ?? "Tool"}</div><div className="text-xs text-muted-foreground">{item.agent_name ?? "agent"} · {item.status ?? "tracked"}</div></div><Badge variant="outline" className="text-[10px]">{item.risk_level ?? "logged"}</Badge></div>)}</CardContent></Card>
            <Card className="border-white/[0.06] bg-black/20 backdrop-blur-xl"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Wrench className="h-4 w-4 text-primary" /> Capability truth board</CardTitle></CardHeader><CardContent className="grid gap-2 md:grid-cols-2">{capabilities.length === 0 ? <p className="col-span-full py-6 text-center text-sm text-muted-foreground">No capability data yet.</p> : capabilities.slice(0, 10).map((item) => <CapabilityCard key={item.toolId} item={item} />)}</CardContent></Card>
          </div>
        </div>
      </div>
    </div>
  );
}
