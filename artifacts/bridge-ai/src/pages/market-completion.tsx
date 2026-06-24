import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, GitBranch, Network, PlayCircle, RefreshCcw, Rocket, ShieldCheck, Wrench, XCircle } from "lucide-react";

type ApiState<T> = { loading: boolean; data: T | null; error: string | null };

type ProviderRow = {
  id: string;
  name: string;
  model: string;
  endpoint: string;
  enabled: boolean;
  hasKey: boolean;
  keySource: string;
  supportsEndpoint: boolean;
};

const pageMeta: Record<string, { title: string; subtitle: string; badges?: string[] }> = {
  "/providers": { title: "Provider / model centre", subtitle: "Configure models without enabling live paid execution by default.", badges: ["approval gated", "fail closed", "no key values shown"] },
  "/connectors": { title: "Tool connector registry", subtitle: "See which external tools are connected and what each one is allowed to do.", badges: ["capability map", "no secrets"] },
  "/self-audit": { title: "VIBA self-audit", subtitle: "Run VIBA's own pre-market self-check and produce a launch recommendation.", badges: ["dogfood", "no deploy"] },
  "/production-smoke-test": { title: "Production smoke test", subtitle: "Run the final deployment readiness checks after env vars and Railway deploy.", badges: ["safe", "read-only"] },
  "/mobile-readiness": { title: "Mobile readiness", subtitle: "Browser-local checklist for iPhone, Android, and touch layout parity.", badges: ["local only"] },
  "/team": { title: "Team and permissions", subtitle: "Role model for owner, admin, builder, billing, viewer, and client access.", badges: ["roles", "invite gated"] },
  "/usage": { title: "Usage analytics", subtitle: "Credits, receipts, budget hits, and session usage summary.", badges: ["cost control"] },
  "/recovery": { title: "Failure recovery centre", subtitle: "Find paused sessions, blocked tasks, and budget-cap interruptions.", badges: ["next action"] },
  "/doctor/trends": { title: "Doctor trends", subtitle: "Track health scores and repeated finding areas across scans.", badges: ["history"] },
  "/clients": { title: "Client / agency mode", subtitle: "Create clients and prepare client-safe report workspaces.", badges: ["agency"] },
  "/security-evidence": { title: "Security evidence pack", subtitle: "Generate buyer-facing evidence from VIBA's safety controls.", badges: ["trust"] },
  "/reports/compare": { title: "Report comparison", subtitle: "Compare Doctor reports and show score movement.", badges: ["before/after"] },
  "/market-readiness": { title: "Market readiness", subtitle: "Owner command centre for launch readiness across env, demo, reports, smoke test, and self-audit.", badges: ["launch"] },
  "/crews": { title: "Specialist crew builder", subtitle: "Choose a prebuilt AI crew and start a supervised session.", badges: ["crew templates"] },
};

const demoTimeline = [
  "Planner splits the website repair into deployment, UX, and proof-report tasks.",
  "Doctor checks repo structure, env gaps, health endpoint, and CI gates.",
  "Railway Agent flags a missing runtime variable and healthcheck risk.",
  "Repair Agent creates a proposal instead of silently mutating production.",
  "Owner approves safe branch/PR work, then CI verifies the fix.",
  "Proof report is exported for the client as evidence of the work done.",
];

const mobileChecks = ["iPhone Safari layout", "Android layout", "Dashboard", "Sessions", "Doctor", "Reports", "Providers", "Connectors", "Demo", "Touch targets", "Sticky footer/header", "No horizontal overflow"];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
  return data as T;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return <Badge variant="outline" className="gap-1">{ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}{label}</Badge>;
}

function PageFrame({ children, publicPage = false }: { children: React.ReactNode; publicPage?: boolean }) {
  if (publicPage) return <div className="min-h-screen bg-background px-4 py-8 text-foreground"><div className="mx-auto max-w-6xl">{children}</div></div>;
  return <AppLayout><div className="mx-auto flex w-full max-w-6xl flex-col gap-6">{children}</div></AppLayout>;
}

function Header({ title, subtitle, badges = [] }: { title: string; subtitle: string; badges?: string[] }) {
  return <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{subtitle}</p></div><div className="flex flex-wrap gap-2">{badges.map((badge) => <Badge key={badge} variant="outline">{badge}</Badge>)}</div></div>;
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

function InfoCard({ title, detail, icon }: { title: string; detail: string; icon?: React.ReactNode }) {
  return <Card className="border-border/70 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base">{icon}{title}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{detail}</p></CardContent></Card>;
}

export function DemoPage() {
  return <PageFrame publicPage><Header title="VIBA demo" subtitle="Sample data showing how VIBA diagnoses, coordinates, repairs, and proves work before you connect a real project." badges={["sample data", "no paid providers", "no signup required"]} /><div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]"><Card><CardHeader><CardTitle>What VIBA does</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-muted-foreground"><p>VIBA acts as an AI project controller: it decomposes work, assigns specialist agents, tracks approvals, controls credit spend, diagnoses repo/deployment health, and produces proof reports.</p><div className="flex flex-wrap gap-2"><Link href="/demo/doctor-report"><Button>Sample Doctor report</Button></Link><Link href="/demo/proof-report"><Button variant="outline">Sample proof report</Button></Link><Link href="/signup"><Button variant="ghost">Create account</Button></Link></div></CardContent></Card><Card><CardHeader><CardTitle>Sample collaboration timeline</CardTitle></CardHeader><CardContent className="space-y-3">{demoTimeline.map((item, index) => <div key={item} className="rounded-lg border p-3 text-sm"><span className="mr-2 text-muted-foreground">{index + 1}.</span>{item}</div>)}</CardContent></Card></div></PageFrame>;
}

export function DemoDoctorReport() {
  const findings = ["Missing PUBLIC_ORIGIN in production", "Health endpoint returned warning", "Proof trail incomplete before VIBA", "Safe repair PR available for docs/config notes"];
  return <PageFrame publicPage><Header title="Sample Doctor report" subtitle="Static report for demo-company/landing-site. This is demo data, not a real security guarantee." badges={["sample", "doctor"]} /><Grid>{findings.map((finding) => <InfoCard key={finding} title={finding} detail="VIBA classifies severity, source, owner action, repairability, and whether manual config is required." icon={<ShieldCheck className="h-4 w-4" />} />)}</Grid><div className="mt-6"><Link href="/demo"><Button variant="outline">Back to demo</Button></Link></div></PageFrame>;
}

export function DemoProofReport() {
  return <PageFrame publicPage><Header title="Sample proof report" subtitle="Client-safe evidence view showing completed tasks, approvals, receipts, and final risks." badges={["sample", "client-safe"]} /><Grid><InfoCard title="Tasks recorded" detail="8 task records, 7 complete, 1 manual follow-up." /><InfoCard title="Approvals" detail="Owner approved repair proposal before any branch work." /><InfoCard title="Receipts" detail="Credit reservations are shown without exposing provider secrets." /><InfoCard title="Export options" detail="JSON, Markdown, print, and share links are available in authenticated reports." /></Grid><div className="mt-6"><Link href="/demo"><Button variant="outline">Back to demo</Button></Link></div></PageFrame>;
}

export default function CompletionPage() {
  const [location] = useLocation();
  const meta = pageMeta[location] ?? { title: "VIBA completion", subtitle: "Market-ready command surface.", badges: [] };
  if (location === "/providers") return <ProvidersPage />;
  if (location === "/self-audit") return <SelfAuditPage />;
  if (location === "/connectors") return <ConnectorsPage />;
  if (location === "/crews") return <CrewsPage />;
  if (location === "/usage") return <UsagePage />;
  if (location === "/mobile-readiness") return <MobileReadinessPage />;
  return <GenericApiPage meta={meta} location={location} />;
}

function useApi<T>(path: string | null): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ loading: Boolean(path), data: null, error: null });
  useEffect(() => { if (!path) return; setState({ loading: true, data: null, error: null }); api<T>(path).then((data) => setState({ loading: false, data, error: null })).catch((error) => setState({ loading: false, data: null, error: error.message })); }, [path]);
  return state;
}

function ProvidersPage() {
  const state = useApi<{ providers: ProviderRow[] }>("/providers");
  return <PageFrame><Header title="Provider / model centre" subtitle="Configure models while keeping live provider execution off by default." badges={["approval required", "fail closed"]} />{state.error && <p className="text-sm text-destructive">{state.error}</p>}<Grid>{(state.data?.providers ?? []).map((provider) => <Card key={provider.id}><CardHeader><CardTitle className="flex items-center justify-between text-base"><span>{provider.name}</span><StatusBadge ok={provider.hasKey || provider.id === "local"} label={provider.hasKey ? "configured" : "not configured"} /></CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><p className="text-muted-foreground">Model: {provider.model}</p>{provider.supportsEndpoint && <p className="text-muted-foreground">Endpoint: {provider.endpoint || "not set"}</p>}<p className="text-muted-foreground">Live execution: off by default. Session approval and budget cap required.</p><Button size="sm" variant="outline" onClick={() => api(`/providers/${provider.id}/test`, { method: "POST", body: JSON.stringify({ endpoint: provider.endpoint }) }).then(() => alert("Provider check completed")).catch((error) => alert(error.message))}>Test configuration</Button></CardContent></Card>)}</Grid></PageFrame>;
}

function ConnectorsPage() {
  const state = useApi<{ connectors: Array<{ id: string; name: string; connected: boolean; capabilities: string[] }> }>("/connectors/status");
  return <PageFrame><Header title="Tool connector registry" subtitle="Connected tools and their allowed capabilities." badges={["no secret values"]} /><Grid>{(state.data?.connectors ?? []).map((connector) => <Card key={connector.id}><CardHeader><CardTitle className="flex items-center justify-between text-base"><span>{connector.name}</span><StatusBadge ok={connector.connected} label={connector.connected ? "connected" : "missing"} /></CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-2">{connector.capabilities.map((cap) => <Badge key={cap} variant="outline">{cap}</Badge>)}</div></CardContent></Card>)}</Grid></PageFrame>;
}

function SelfAuditPage() {
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  return <PageFrame><Header title="VIBA self-audit" subtitle="Run a local-safe self-audit without deployment or paid providers." badges={["dogfood", "safe"]} /><Card><CardContent className="space-y-4 py-5"><Button disabled={busy} onClick={() => { setBusy(true); api("/self-audit/run", { method: "POST", body: JSON.stringify({}) }).then(setResult).finally(() => setBusy(false)); }}><RefreshCcw className="mr-2 h-4 w-4" />Run VIBA Self-Audit</Button>{result && <pre className="max-h-[420px] overflow-auto rounded-lg bg-muted p-4 text-xs">{JSON.stringify(result, null, 2)}</pre>}</CardContent></Card></PageFrame>;
}

function CrewsPage() {
  const state = useApi<{ crews: Array<{ id: string; name: string; estimatedCredits: number; agents: string[]; requiredConnectors: string[] }> }>("/crews");
  return <PageFrame><Header title="Specialist crew builder" subtitle="Prebuilt specialist crews for common VIBA jobs." badges={["templates"]} /><Grid>{(state.data?.crews ?? []).map((crew) => <Card key={crew.id}><CardHeader><CardTitle className="text-base">{crew.name}</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Estimated credits: {crew.estimatedCredits}</p><div className="flex flex-wrap gap-2">{crew.agents.map((agent) => <Badge key={agent} variant="outline">{agent}</Badge>)}</div><Button size="sm" onClick={() => api(`/crews/${crew.id}/start-session`, { method: "POST", body: JSON.stringify({}) }).then((data: any) => alert(`Session created: ${data.sessionId}`)).catch((error) => alert(error.message))}>Create session</Button></CardContent></Card>)}</Grid></PageFrame>;
}

function UsagePage() {
  const state = useApi<any>("/usage/summary");
  return <PageFrame><Header title="Usage analytics" subtitle="Credit receipts, budget hits, and export controls." badges={["cost control"]} /><Grid><InfoCard title="Credit receipts" detail={`${state.data?.receipts?.count ?? 0} receipts recorded.`} /><InfoCard title="Credits reserved" detail={`${state.data?.receipts?.credits ?? 0} credits reserved.`} /><InfoCard title="Budget cap hits" detail={`${state.data?.budgetCapHits ?? 0} budget cap events.`} /></Grid><a href="/api/usage/export.csv"><Button className="mt-4" variant="outline">Export CSV</Button></a></PageFrame>;
}

function MobileReadinessPage() {
  const [checks, setChecks] = useState<Record<string, boolean>>(() => JSON.parse(localStorage.getItem("viba_mobile_readiness") || "{}"));
  useEffect(() => localStorage.setItem("viba_mobile_readiness", JSON.stringify(checks)), [checks]);
  return <PageFrame><Header title="Mobile readiness" subtitle="Local mobile parity checklist." badges={["browser local"]} /><Grid>{mobileChecks.map((item) => <button key={item} className="rounded-xl border p-4 text-left" onClick={() => setChecks((current) => ({ ...current, [item]: !current[item] }))}>{checks[item] ? <CheckCircle2 className="mb-2 h-5 w-5 text-emerald-400" /> : <XCircle className="mb-2 h-5 w-5 text-muted-foreground" />}<span className="text-sm font-medium">{item}</span></button>)}</Grid></PageFrame>;
}

function GenericApiPage({ meta, location }: { meta: { title: string; subtitle: string; badges?: string[] }; location: string }) {
  const apiPath = useMemo(() => {
    if (location === "/production-smoke-test") return "/smoke-test/latest";
    if (location === "/team") return "/team";
    if (location === "/recovery") return "/recovery";
    if (location === "/doctor/trends") return "/doctor/trends";
    if (location === "/clients") return "/clients";
    if (location === "/security-evidence") return "/security-evidence";
    if (location === "/market-readiness") return "/market-readiness";
    return null;
  }, [location]);
  const state = useApi<any>(apiPath);
  return <PageFrame><Header title={meta.title} subtitle={meta.subtitle} badges={meta.badges} /><Card><CardContent className="space-y-4 py-5">{location === "/production-smoke-test" && <Button onClick={() => api("/smoke-test/run", { method: "POST", body: JSON.stringify({}) }).then((data) => alert(JSON.stringify(data, null, 2))).catch((error) => alert(error.message))}><PlayCircle className="mr-2 h-4 w-4" />Run smoke test</Button>}{location === "/reports/compare" && <p className="text-sm text-muted-foreground">Use /api/reports/compare?left=REPORT_ID&right=REPORT_ID&type=doctor to compare reports.</p>}{state.loading && <p className="text-sm text-muted-foreground">Loading…</p>}{state.error && <p className="text-sm text-destructive">{state.error}</p>}{state.data && <pre className="max-h-[520px] overflow-auto rounded-lg bg-muted p-4 text-xs">{JSON.stringify(state.data, null, 2)}</pre>}</CardContent></Card></PageFrame>;
}

export function SessionTimelinePage() {
  const { id } = useParams<{ id: string }>();
  const state = useApi<{ events: Array<{ source: string; kind: string; title: string; detail: string; at: string }> }>(id ? `/sessions/${id}/timeline` : null);
  return <PageFrame><Header title="Session replay / audit timeline" subtitle="Chronological view of messages, tasks, approvals, credit receipts, handoffs, and audit events." badges={["replay"]} /><div className="space-y-3">{(state.data?.events ?? []).map((event, index) => <Card key={`${event.at}-${index}`}><CardContent className="py-4"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{event.source}</Badge><Badge variant="outline">{event.kind}</Badge><span className="text-xs text-muted-foreground">{new Date(event.at).toLocaleString()}</span></div><h3 className="mt-2 text-sm font-medium">{event.title}</h3><p className="mt-1 text-sm text-muted-foreground">{event.detail}</p></CardContent></Card>)}</div></PageFrame>;
}

export function CollaborationMapPage() {
  const { id } = useParams<{ id: string }>();
  return <PageFrame><Header title="AI collaboration visual map" subtitle="Agent/task map built on the session timeline endpoint." badges={["map", `session ${id}`]} /><Grid><InfoCard title="Agents" detail="Shows participating specialist agents from the timeline." icon={<Network className="h-4 w-4" />} /><InfoCard title="Tasks" detail="Shows task nodes, states, blockers, and approvals." icon={<GitBranch className="h-4 w-4" />} /><InfoCard title="Repair path" detail="Shows proposed branch/PR flow when Doctor repair is approved." icon={<Wrench className="h-4 w-4" />} /></Grid><Link href={`/sessions/${id}/timeline`}><Button className="mt-4" variant="outline">Open full timeline</Button></Link></PageFrame>;
}

export function ShareReportPage() {
  const { shareId } = useParams<{ shareId: string }>();
  const state = useApi<any>(shareId ? `/share/reports/${shareId}` : null);
  return <PageFrame publicPage><Header title="Client-safe VIBA report" subtitle="Read-only shared report view. Internal details are redacted when requested." badges={["read-only", "client-safe"]} />{state.error && <p className="text-sm text-destructive">{state.error}</p>}{state.data && <pre className="max-h-[520px] overflow-auto rounded-lg bg-muted p-4 text-xs">{JSON.stringify(state.data, null, 2)}</pre>}</PageFrame>;
}
