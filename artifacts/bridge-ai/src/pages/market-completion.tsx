export { default as DemoPage } from "./demo";
export { default as DemoDoctorReport } from "./demo-doctor-report";
export { default as DemoProofReport } from "./demo-proof-report";

import { useState, useEffect } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Zap, Clock, ArrowLeft, ExternalLink, RefreshCw, AlertTriangle, Info,
  CheckCircle2, GitBranch, Shield, FileText, ChevronLeft,
} from "lucide-react";

const ROUTE_META: Record<string, { label: string; description: string; eta: string }> = {
  "/connectors":            { label: "Connectors",             description: "Connect Slack, GitHub, Notion, Jira, and more directly into agent sessions.",                    eta: "Q3 2026" },
  "/self-audit":            { label: "Self-Audit",             description: "Full automated audit of your VIBA instance — schema, settings, API health, security posture.",   eta: "Q3 2026" },
  "/crews":                 { label: "Crews",                  description: "Pre-built agent crews: code review, market research, competitive analysis, and more.",            eta: "Q3 2026" },
  "/production-smoke-test": { label: "Production Smoke Test",  description: "One-click smoke test: checks all providers, DB, email, and webhooks against your live env.",     eta: "Q3 2026" },
  "/mobile-readiness":      { label: "Mobile Readiness",       description: "Analyse responsive breakpoints, PWA manifest, touch targets, and performance budgets.",          eta: "Q4 2026" },
  "/team":                  { label: "Team",                   description: "Invite team members, assign roles, manage shared API quotas across your organisation.",           eta: "Q4 2026" },
  "/usage":                 { label: "Usage",                  description: "Detailed provider analytics: token counts, costs per session, model distribution, trends.",       eta: "Q3 2026" },
  "/recovery":              { label: "Recovery",               description: "Restore sessions, roll back failed deployments, and recover from agent errors.",                  eta: "Q4 2026" },
  "/doctor/trends":         { label: "Doctor Trends",          description: "Long-term health score trends across all your scanned repositories.",                            eta: "Q3 2026" },
  "/clients":               { label: "Clients",                description: "Multi-tenant client management — separate quota and audit trails per client.",                    eta: "Q4 2026" },
  "/security-evidence":     { label: "Security Evidence",      description: "Generate a security posture report: OWASP coverage, secret scan, dependency audit, CSP.",        eta: "Q3 2026" },
  "/reports/compare":       { label: "Report Comparison",      description: "Side-by-side comparison of two scan reports to track health improvements over time.",             eta: "Q3 2026" },
  "/market-readiness":      { label: "Market Readiness",       description: "Real-time market readiness dashboard — feature completion, provider health, launch checklist.",  eta: "Live"    },
};

// ── CompletionPage (default export) ────────────────────────────────────────────

export default function CompletionPage() {
  const [location] = useLocation();
  const meta = ROUTE_META[location] ?? { label: "Coming Soon", description: "This feature is under active development.", eta: "TBD" };
  const isLive = meta.eta === "Live";

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 py-16 space-y-10">
        <Link href="/dashboard">
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
          </button>
        </Link>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              {isLive ? <Zap className="h-5 w-5 text-primary" /> : <Clock className="h-5 w-5 text-primary" />}
            </div>
            <div>
              <h1 className="text-2xl font-semibold">{meta.label}</h1>
              <Badge className={`text-xs mt-0.5 ${isLive ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" : "bg-primary/10 text-primary border-primary/25"}`}>
                {isLive ? "Live" : `ETA ${meta.eta}`}
              </Badge>
            </div>
          </div>
          <p className="text-muted-foreground leading-relaxed">{meta.description}</p>
        </div>

        {isLive ? (
          <MarketReadinessWidget />
        ) : (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-6 space-y-4">
            <h2 className="text-sm font-medium text-foreground/70">Available now</h2>
            {[
              { href: "/providers", label: "AI Providers",   desc: "Configure provider keys and models." },
              { href: "/doctor",    label: "Project Doctor", desc: "Scan repos, generate repair PRs." },
              { href: "/dashboard", label: "Sessions",       desc: "Multi-agent collaboration sessions." },
            ].map(({ href, label, desc }) => (
              <Link key={href} href={href}>
                <div className="group flex items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] hover:border-primary/25 hover:bg-primary/5 px-4 py-3 cursor-pointer transition-all">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

// ── MarketReadinessWidget ───────────────────────────────────────────────────────

interface ReadinessFeature { id: string; label: string; status: "ready" | "needs_config" | "pending" }
interface ReadinessData {
  score: number;
  features: ReadinessFeature[];
  stats: { totalSessions: number; activeSessions: number; errorsToday: number; configuredProviders: number };
  generatedAt: string;
}

function MarketReadinessWidget() {
  const [data, setData] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/market-readiness", { credentials: "include" })
      .then((r) => r.json() as Promise<ReadinessData & { error?: string }>)
      .then((d) => { if (d.error) throw new Error(d.error); setData(d); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-8"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <div className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error ?? "No data"}</div>;

  const scoreColor = data.score >= 80 ? "text-emerald-400" : data.score >= 50 ? "text-amber-400" : "text-red-400";

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-6 py-5 flex items-center gap-8">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Readiness Score</p>
          <p className={`text-4xl font-bold ${scoreColor}`}>{data.score}<span className="text-sm font-normal text-muted-foreground">/100</span></p>
        </div>
        <div className="grid grid-cols-2 gap-4 flex-1">
          <div><p className="text-xs text-muted-foreground">Sessions</p><p className="font-semibold">{data.stats.totalSessions}</p></div>
          <div><p className="text-xs text-muted-foreground">Active</p><p className="font-semibold">{data.stats.activeSessions}</p></div>
          <div><p className="text-xs text-muted-foreground">Providers</p><p className="font-semibold">{data.stats.configuredProviders}</p></div>
          <div><p className="text-xs text-muted-foreground">Errors today</p><p className={`font-semibold ${data.stats.errorsToday > 0 ? "text-amber-400" : "text-emerald-400"}`}>{data.stats.errorsToday}</p></div>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Launch Checklist</h3>
        {data.features.map((f) => (
          <div key={f.id} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
            {f.status === "ready"        ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
           : f.status === "needs_config" ? <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
           :                               <Info className="h-4 w-4 text-zinc-500 shrink-0" />}
            <span className="text-sm">{f.label}</span>
            <Badge className={`ml-auto text-[11px] ${
              f.status === "ready"        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
            : f.status === "needs_config" ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
            :                               "bg-zinc-500/10 text-zinc-400 border-zinc-500/25"}`}>
              {f.status === "ready" ? "Ready" : f.status === "needs_config" ? "Needs config" : "Pending"}
            </Badge>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Generated {new Date(data.generatedAt).toLocaleTimeString()}</p>
    </div>
  );
}

// ── SessionTimelinePage ─────────────────────────────────────────────────────────

interface Msg { id: number; role: string; content: string; provider: string | null; simulated: boolean; createdAt: string }

export function SessionTimelinePage() {
  const [, params] = useRoute<{ id: string }>("/sessions/:id/timeline");
  const sessionId = params?.id ?? "";
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/sessions/${sessionId}/messages`, { credentials: "include" })
      .then((r) => r.json() as Promise<{ messages?: Msg[]; error?: string }>)
      .then((d) => { if (d.error) throw new Error(d.error); setMessages(d.messages ?? []); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Link href={`/sessions/${sessionId}`}>
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="h-4 w-4" /> Back to Session
          </button>
        </Link>
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Clock className="h-4.5 w-4.5 text-primary" />
          </div>
          <h1 className="text-xl font-semibold">Session Timeline</h1>
          <Badge variant="outline" className="text-xs">#{sessionId}</Badge>
        </div>

        {loading && <div className="flex justify-center py-10"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {error   && <div className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</div>}
        {!loading && !error && messages.length === 0 && <p className="text-center py-10 text-sm text-muted-foreground">No messages yet.</p>}

        {!loading && !error && messages.length > 0 && (
          <div className="relative space-y-0">
            <div className="absolute left-[19px] top-0 bottom-0 w-px bg-white/[0.06]" />
            {messages.map((msg, i) => (
              <div key={msg.id} className="relative flex gap-4 pb-5 last:pb-0">
                <div className="relative z-10 h-10 w-10 rounded-full border border-white/[0.1] bg-background flex items-center justify-center shrink-0">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="flex-1 rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-3 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium capitalize">{msg.role}</span>
                    {msg.provider && <Badge variant="outline" className="text-[11px]">{msg.provider}</Badge>}
                    {msg.simulated && <Badge className="text-[11px] bg-amber-500/10 text-amber-400 border-amber-500/25">Simulated</Badge>}
                    <span className="text-xs text-muted-foreground ml-auto">#{i + 1}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap line-clamp-4">{msg.content}</p>
                  <p className="text-[10px] text-muted-foreground/50">{new Date(msg.createdAt).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

// ── CollaborationMapPage ────────────────────────────────────────────────────────

interface AgentRow { id: number; name: string; role: string | null; provider: string; status: string }

export function CollaborationMapPage() {
  const [, params] = useRoute<{ id: string }>("/sessions/:id/map");
  const sessionId = params?.id ?? "";
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/sessions/${sessionId}/agents`, { credentials: "include" })
      .then((r) => r.json() as Promise<{ agents?: AgentRow[]; error?: string }>)
      .then((d) => { if (d.error) throw new Error(d.error); setAgents(d.agents ?? []); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const positions = agents.map((_, i) => {
    const angle = (i / Math.max(agents.length, 1)) * 2 * Math.PI - Math.PI / 2;
    return { x: 200 + 120 * Math.cos(angle), y: 180 + 120 * Math.sin(angle) };
  });

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Link href={`/sessions/${sessionId}`}>
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="h-4 w-4" /> Back to Session
          </button>
        </Link>
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <GitBranch className="h-4.5 w-4.5 text-primary" />
          </div>
          <h1 className="text-xl font-semibold">Collaboration Map</h1>
          <Badge variant="outline" className="text-xs">#{sessionId}</Badge>
        </div>

        {loading && <div className="flex justify-center py-10"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {error   && <div className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</div>}
        {!loading && !error && agents.length === 0 && <p className="text-center py-10 text-sm text-muted-foreground">No agents in this session.</p>}

        {!loading && !error && agents.length > 0 && (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
            <svg viewBox="0 0 400 360" className="w-full max-h-80">
              <circle cx="200" cy="180" r="28" fill="hsl(239 84% 62% / 0.15)" stroke="hsl(239 84% 62% / 0.5)" strokeWidth="1.5" />
              <text x="200" y="178" textAnchor="middle" fill="hsl(239 84% 62%)" fontSize="9" fontWeight="600">VIBA</text>
              <text x="200" y="191" textAnchor="middle" fill="hsl(239 84% 62% / 0.7)" fontSize="7.5">Orchestrator</text>
              {positions.map((pos, i) => (
                <line key={i} x1="200" y1="180" x2={pos.x} y2={pos.y} stroke="hsl(239 84% 62% / 0.2)" strokeWidth="1" strokeDasharray="4 3" />
              ))}
              {agents.map((agent, i) => {
                const pos = positions[i]!;
                return (
                  <g key={agent.id}>
                    <circle cx={pos.x} cy={pos.y} r="22" fill="hsl(255 255 255 / 0.03)" stroke="hsl(255 255 255 / 0.12)" strokeWidth="1" />
                    <text x={pos.x} y={pos.y - 2} textAnchor="middle" fill="hsl(0 0% 90%)" fontSize="8.5" fontWeight="500">{agent.name.slice(0, 10)}</text>
                    <text x={pos.x} y={pos.y + 10} textAnchor="middle" fill="hsl(0 0% 55%)" fontSize="7">{agent.role ?? agent.provider}</text>
                  </g>
                );
              })}
            </svg>
            <div className="mt-3 flex flex-wrap gap-3">
              {agents.map((a) => (
                <span key={a.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-primary/50 inline-block" />
                  {a.name} <span className="text-muted-foreground/50">({a.provider})</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

// ── ShareReportPage (public) ────────────────────────────────────────────────────

interface SharedRpt { id: string; reportType: string; payload: unknown; createdAt: string; expiresAt: string | null }

export function ShareReportPage() {
  const [, params] = useRoute<{ shareId: string }>("/share/reports/:shareId");
  const shareId = params?.shareId ?? "";
  const [report, setReport] = useState<SharedRpt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    if (!shareId) return;
    fetch(`/api/share/reports/${shareId}`)
      .then((r) => r.json() as Promise<SharedRpt & { error?: string; message?: string }>)
      .then((d) => {
        if (d.error) { setError({ code: d.error, message: d.message ?? d.error }); return; }
        setReport(d);
      })
      .catch((e: Error) => setError({ code: "error", message: e.message }))
      .finally(() => setLoading(false));
  }, [shareId]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 w-full border-b border-white/[0.06] bg-background/90 backdrop-blur-xl">
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        <div className="container flex h-[60px] max-w-screen-2xl items-center justify-between">
          <Link href="/demo"><span className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />VIBA</span></Link>
          <Badge variant="outline" className="text-xs">Shared Report</Badge>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        {loading && <div className="flex justify-center py-16"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

        {error && (
          <div className="text-center py-16 space-y-3">
            <div className="h-12 w-12 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center mx-auto">
              <Shield className="h-5 w-5 text-red-400" />
            </div>
            <h1 className="text-lg font-semibold">{error.code === "report_expired" ? "Report Expired" : "Report Not Found"}</h1>
            <p className="text-sm text-muted-foreground">{error.message}</p>
            <Link href="/demo"><Button variant="outline" size="sm" className="mt-4">View Demo</Button></Link>
          </div>
        )}

        {report && !loading && !error && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <FileText className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-semibold capitalize">{report.reportType} Report</h1>
                <p className="text-xs text-muted-foreground">
                  Shared {new Date(report.createdAt).toLocaleDateString()}
                  {report.expiresAt && ` · Expires ${new Date(report.expiresAt).toLocaleDateString()}`}
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
              <pre className="text-xs text-muted-foreground overflow-auto whitespace-pre-wrap max-h-96">
                {JSON.stringify(report.payload, null, 2)}
              </pre>
            </div>
            <p className="text-xs text-center text-muted-foreground">
              Generated by <Link href="/demo"><span className="text-primary/80 hover:text-primary cursor-pointer">VIBA</span></Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
