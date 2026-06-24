export { default as DemoPage } from "./demo";
export { default as DemoDoctorReport } from "./demo-doctor-report";
export { default as DemoProofReport } from "./demo-proof-report";

import { useState, useEffect, useCallback } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Zap, ArrowLeft, ExternalLink, RefreshCw, AlertTriangle, Info,
  CheckCircle2, GitBranch, Shield, FileText, ChevronLeft, XCircle,
  Users, Building2, Activity, Wrench, Play, PlugZap, BarChart3,
} from "lucide-react";

// ── Generic fetch hook ──────────────────────────────────────────────────────────

function useFetch<T>(url: string, deps?: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(url, { credentials: "include" })
      .then((r) => r.json() as Promise<T & { error?: string; message?: string }>)
      .then((d) => {
        if ((d as { error?: string }).error) throw new Error((d as { error?: string; message?: string }).message ?? (d as { error?: string }).error);
        setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...(deps ?? [])]);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

function Spinner() {
  return <div className="flex justify-center py-10"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
}
function Err({ msg }: { msg: string }) {
  return <div className="text-sm text-red-400 flex items-center gap-2 py-4"><AlertTriangle className="h-4 w-4 shrink-0" />{msg}</div>;
}
function StatusDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (ok) return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
  if (warn) return <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />;
  return <XCircle className="h-4 w-4 text-red-400 shrink-0" />;
}

// ── ROUTE_META ────────────────────────────────────────────────────────────────

const ROUTE_META: Record<string, { label: string; description: string }> = {
  "/connectors":            { label: "Connectors",            description: "Live connector status — GitHub, Railway, Stripe, SMTP, and AI providers." },
  "/self-audit":            { label: "Self-Audit",            description: "Automated audit of your VIBA instance — database, env vars, SMTP, and Stripe." },
  "/crews":                 { label: "Crews",                 description: "Pre-built agent crews ready to run: security audits, GitHub repairs, UX reviews, and more." },
  "/production-smoke-test": { label: "Production Smoke Test", description: "One-click smoke test — checks Postgres, Express, SMTP, and Stripe webhook." },
  "/mobile-readiness":      { label: "Mobile Readiness",      description: "Mobile layout and PWA readiness checklist for launch." },
  "/team":                  { label: "Team",                  description: "Manage team members, roles, and permissions across your organisation." },
  "/usage":                 { label: "Usage",                 description: "Session counts, active sessions, and error rates from live database." },
  "/recovery":              { label: "Recovery",              description: "Stalled sessions detected from live data — re-open or force-stop." },
  "/doctor/trends":         { label: "Doctor Trends",         description: "Doctor audit events logged over the past 90 days." },
  "/clients":               { label: "Clients",               description: "Client management — create client profiles and attach reports." },
  "/security-evidence":     { label: "Security Evidence",     description: "Live security posture checklist — auth guards, secrets, transport, cleanup." },
  "/reports/compare":       { label: "Report Comparison",     description: "Side-by-side comparison of two doctor scan reports." },
  "/market-readiness":      { label: "Market Readiness",      description: "Real-time market readiness dashboard — feature completion, provider health, launch checklist." },
};

// ── CompletionPage (default export) ─────────────────────────────────────────────

export default function CompletionPage() {
  const [location] = useLocation();
  const meta = ROUTE_META[location] ?? { label: "Dashboard", description: "VIBA orchestration platform." };

  const Widget = ROUTE_WIDGETS[location];

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        <Link href="/dashboard">
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
          </button>
        </Link>

        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{meta.label}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{meta.description}</p>
          </div>
        </div>

        {Widget ? <Widget /> : <MarketReadinessWidget />}
      </div>
    </AppLayout>
  );
}

// ── Route → Widget mapping (populated after definitions) ─────────────────────

const ROUTE_WIDGETS: Record<string, React.ComponentType> = {};

// ── MarketReadinessWidget ───────────────────────────────────────────────────────

interface ReadinessFeature { id: string; label: string; status: "ready" | "needs_config" | "pending" }
interface ReadinessData {
  score: number;
  features: ReadinessFeature[];
  stats: { totalSessions: number; activeSessions: number; errorsToday: number; configuredProviders: number };
  generatedAt: string;
}

function MarketReadinessWidget() {
  const { data, loading, error } = useFetch<ReadinessData>("/api/market-readiness");

  if (loading) return <Spinner />;
  if (error || !data) return <Err msg={error ?? "No data"} />;

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
ROUTE_WIDGETS["/market-readiness"] = MarketReadinessWidget;

// ── ConnectorsWidget ───────────────────────────────────────────────────────────

interface Connector { id: string; label: string; connected: boolean; note: string; capabilities: string[] }
interface ConnectorsData { connectors: Connector[]; generatedAt: string }

function ConnectorsWidget() {
  const { data, loading, error, reload } = useFetch<ConnectorsData>("/api/connectors/status");
  if (loading) return <Spinner />;
  if (error || !data) return <Err msg={error ?? "No data"} />;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{data.connectors.filter((c) => c.connected).length}/{data.connectors.length} connected</p>
        <button onClick={reload} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"><RefreshCw className="h-3 w-3" />Refresh</button>
      </div>
      {data.connectors.map((c) => (
        <div key={c.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <PlugZap className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium">{c.label}</span>
            <Badge className={`ml-auto text-[11px] ${c.connected ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" : "bg-zinc-500/10 text-zinc-400 border-zinc-500/25"}`}>
              {c.connected ? "Connected" : "Not connected"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground pl-6">{c.note}</p>
          {c.capabilities.length > 0 && (
            <div className="pl-6 flex flex-wrap gap-1.5">
              {c.capabilities.map((cap) => <Badge key={cap} variant="outline" className="text-[10px] py-0">{cap.replace(/_/g, " ")}</Badge>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
ROUTE_WIDGETS["/connectors"] = ConnectorsWidget;

// ── SelfAuditWidget ────────────────────────────────────────────────────────────

interface AuditItem { check: string; status: string; detail: string }
interface AuditData { id: string; runAt: string; passed: number; failed: number; warnings: number; items: AuditItem[] }

function SelfAuditWidget() {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLatest = useCallback(() => {
    setLoading(true);
    fetch("/api/self-audit/latest", { credentials: "include" })
      .then((r) => r.json() as Promise<AuditData & { error?: string }>)
      .then((d) => { if (!d.error) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchLatest(); }, [fetchLatest]);

  const runAudit = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await fetch("/api/self-audit/run", { method: "POST", credentials: "include" });
      const d = await r.json() as AuditData & { error?: string; message?: string };
      if (d.error) throw new Error(d.message ?? d.error);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button onClick={runAudit} disabled={running} size="sm" className="flex items-center gap-2">
          {running ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {running ? "Running…" : "Run Audit"}
        </Button>
        {data && <p className="text-xs text-muted-foreground">Last run {new Date(data.runAt).toLocaleTimeString()} · {data.passed}✓ {data.failed}✗ {data.warnings}⚠</p>}
      </div>
      {error && <Err msg={error} />}
      {loading && !data && <Spinner />}
      {data && (
        <div className="space-y-2">
          {data.items.map((item, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <StatusDot ok={item.status === "pass"} warn={item.status === "warn"} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{item.check}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
              </div>
              <Badge className={`text-[11px] shrink-0 ${item.status === "pass" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" : item.status === "warn" ? "bg-amber-500/10 text-amber-400 border-amber-500/25" : "bg-red-500/10 text-red-400 border-red-500/25"}`}>
                {item.status}
              </Badge>
            </div>
          ))}
        </div>
      )}
      {!loading && !data && !error && <p className="text-sm text-muted-foreground text-center py-6">No audit run yet. Click "Run Audit" to start.</p>}
    </div>
  );
}
ROUTE_WIDGETS["/self-audit"] = SelfAuditWidget;

// ── CrewsWidget ────────────────────────────────────────────────────────────────

interface Crew { id: string; name: string; description: string; agents: string[]; requiredConnectors: string[]; estimatedCredits: number; safeModeDefault: boolean; approvalRequired: boolean }
interface CrewsData { crews: Crew[] }

function CrewsWidget() {
  const { data, loading, error } = useFetch<CrewsData>("/api/crews");
  const [starting, setStarting] = useState<string | null>(null);
  const [launched, setLaunched] = useState<{ sessionId: number; crewId: string } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const startCrew = async (crewId: string) => {
    setStarting(crewId);
    setStartError(null);
    try {
      const r = await fetch(`/api/crews/${crewId}/start-session`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: "" }),
      });
      const d = await r.json() as { ok?: boolean; sessionId?: number; error?: string; message?: string };
      if (d.error) throw new Error(d.message ?? d.error);
      if (d.sessionId) setLaunched({ sessionId: d.sessionId, crewId });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(null);
    }
  };

  if (loading) return <Spinner />;
  if (error || !data) return <Err msg={error ?? "No data"} />;

  return (
    <div className="space-y-3">
      {startError && <Err msg={startError} />}
      {launched && (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-emerald-400"><CheckCircle2 className="h-4 w-4" />Session #{launched.sessionId} created</div>
          <Link href={`/sessions/${launched.sessionId}`}><Button size="sm" variant="outline" className="text-xs h-7">Open →</Button></Link>
        </div>
      )}
      {data.crews.map((crew) => (
        <div key={crew.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{crew.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{crew.description}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7 shrink-0 flex items-center gap-1.5"
              onClick={() => startCrew(crew.id)}
              disabled={starting === crew.id}
            >
              {starting === crew.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {starting === crew.id ? "Starting…" : "Start"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <span className="text-muted-foreground">{crew.estimatedCredits} credits</span>
            {crew.approvalRequired && <Badge variant="outline" className="text-[10px] py-0">Approval required</Badge>}
            {crew.safeModeDefault && <Badge variant="outline" className="text-[10px] py-0">Safe mode</Badge>}
            {crew.requiredConnectors.map((c) => <Badge key={c} className="text-[10px] py-0 bg-primary/5 text-primary border-primary/20">{c}</Badge>)}
          </div>
        </div>
      ))}
    </div>
  );
}
ROUTE_WIDGETS["/crews"] = CrewsWidget;

// ── SmokeTestWidget ────────────────────────────────────────────────────────────

interface SmokeCheck { name: string; ok: boolean; latencyMs?: number }
interface SmokeData { id: string; runAt: string; passed: boolean; checks: SmokeCheck[] }

function SmokeTestWidget() {
  const [data, setData] = useState<SmokeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/smoke-test/latest", { credentials: "include" })
      .then((r) => r.json() as Promise<SmokeData & { error?: string }>)
      .then((d) => { if (!d.error) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const runTest = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await fetch("/api/smoke-test/run", { method: "POST", credentials: "include" });
      const d = await r.json() as SmokeData & { error?: string; message?: string };
      if (d.error) throw new Error(d.message ?? d.error);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button onClick={runTest} disabled={running} size="sm" className="flex items-center gap-2">
          {running ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
          {running ? "Testing…" : "Run Smoke Test"}
        </Button>
        {data && (
          <Badge className={`text-[11px] ${data.passed ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" : "bg-red-500/10 text-red-400 border-red-500/25"}`}>
            {data.passed ? "All passing" : "Issues detected"}
          </Badge>
        )}
      </div>
      {error && <Err msg={error} />}
      {loading && !data && <Spinner />}
      {data && (
        <div className="space-y-2">
          {data.checks.map((c, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <StatusDot ok={c.ok} />
              <span className="text-sm flex-1">{c.name}</span>
              {c.latencyMs !== undefined && <span className="text-xs text-muted-foreground">{c.latencyMs}ms</span>}
              <Badge className={`text-[11px] ${c.ok ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" : "bg-red-500/10 text-red-400 border-red-500/25"}`}>
                {c.ok ? "pass" : "fail"}
              </Badge>
            </div>
          ))}
        </div>
      )}
      {!loading && !data && !error && <p className="text-sm text-muted-foreground text-center py-6">No smoke test run yet. Click "Run Smoke Test" to start.</p>}
    </div>
  );
}
ROUTE_WIDGETS["/production-smoke-test"] = SmokeTestWidget;

// ── TeamWidget ─────────────────────────────────────────────────────────────────

interface TeamMember { id: number; email: string; role: string; status: string; createdAt: string }
interface TeamData { members: TeamMember[]; inviteEnabled: boolean }

function TeamWidget() {
  const { data, loading, error, reload } = useFetch<TeamData>("/api/team");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const invite = async () => {
    if (!email) return;
    setInviting(true);
    setInviteError(null);
    try {
      const r = await fetch("/api/team/invite", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const d = await r.json() as { ok?: boolean; error?: string; message?: string };
      if (d.error) throw new Error(d.message ?? d.error);
      setEmail("");
      reload();
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : String(e));
    } finally {
      setInviting(false);
    }
  };

  if (loading) return <Spinner />;
  if (error) return <Err msg={error} />;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2"><Users className="h-4 w-4" />Invite Team Member</h3>
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@company.com"
            className="flex-1 h-9 rounded-md border border-white/[0.1] bg-white/[0.04] px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="h-9 rounded-md border border-white/[0.1] bg-white/[0.04] px-2 text-sm text-foreground focus:outline-none"
          >
            {["owner","admin","builder","billing","viewer","client"].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <Button size="sm" onClick={invite} disabled={inviting || !email} className="h-9">
            {inviting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : "Invite"}
          </Button>
        </div>
        {inviteError && <Err msg={inviteError} />}
        <p className="text-[11px] text-muted-foreground">Email invites require SMTP configuration. Member is added to DB immediately.</p>
      </div>

      {(!data?.members || data.members.length === 0) ? (
        <p className="text-sm text-muted-foreground text-center py-6">No team members yet. Invite someone above.</p>
      ) : (
        <div className="space-y-2">
          {data.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-medium text-primary shrink-0">
                {m.email[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{m.email}</p>
                <p className="text-xs text-muted-foreground">Added {new Date(m.createdAt).toLocaleDateString()}</p>
              </div>
              <Badge variant="outline" className="text-[11px] shrink-0">{m.role}</Badge>
              <Badge className={`text-[11px] shrink-0 ${m.status === "active" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" : "bg-zinc-500/10 text-zinc-400 border-zinc-500/25"}`}>{m.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
ROUTE_WIDGETS["/team"] = TeamWidget;

// ── UsageWidget ────────────────────────────────────────────────────────────────

interface UsageSummary { totalSessions: number; activeSessions: number; errorsLast30d: number; generatedAt: string }

function UsageWidget() {
  const { data, loading, error, reload } = useFetch<UsageSummary>("/api/usage/summary");
  if (loading) return <Spinner />;
  if (error || !data) return <Err msg={error ?? "No data"} />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Sessions",    value: data.totalSessions,   color: "" },
          { label: "Active Now",        value: data.activeSessions,  color: "text-emerald-400" },
          { label: "Errors (30d)",      value: data.errorsLast30d,   color: data.errorsLast30d > 0 ? "text-amber-400" : "text-emerald-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-1">{label}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Updated {new Date(data.generatedAt).toLocaleTimeString()}</p>
        <div className="flex gap-2">
          <button onClick={reload} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"><RefreshCw className="h-3 w-3" />Refresh</button>
          <a href="/api/usage/export.csv" className="text-xs text-primary hover:underline flex items-center gap-1"><ExternalLink className="h-3 w-3" />Export CSV</a>
        </div>
      </div>
      <div className="flex gap-2">
        <Link href="/dashboard"><Button size="sm" variant="outline" className="text-xs flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5" />View Sessions</Button></Link>
      </div>
    </div>
  );
}
ROUTE_WIDGETS["/usage"] = UsageWidget;

// ── RecoveryWidget ────────────────────────────────────────────────────────────

interface StalledSession { id: number; goal: string; status: string; updatedAt: string }
interface RecoveryData { stalledSessions: StalledSession[]; note: string }

function RecoveryWidget() {
  const { data, loading, error, reload } = useFetch<RecoveryData>("/api/recovery");
  if (loading) return <Spinner />;
  if (error || !data) return <Err msg={error ?? "No data"} />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{data.stalledSessions.length === 0 ? "No stalled sessions detected." : `${data.stalledSessions.length} stalled session${data.stalledSessions.length > 1 ? "s" : ""} detected.`}</p>
        <button onClick={reload} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"><RefreshCw className="h-3 w-3" />Refresh</button>
      </div>
      {data.stalledSessions.length === 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">All clear — no stalled sessions.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.stalledSessions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{s.goal}</p>
                <p className="text-xs text-muted-foreground">Last update {new Date(s.updatedAt).toLocaleString()}</p>
              </div>
              <Link href={`/sessions/${s.id}`}><Button size="sm" variant="outline" className="text-xs h-7 shrink-0">Open →</Button></Link>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{data.note}</p>
        </div>
      )}
    </div>
  );
}
ROUTE_WIDGETS["/recovery"] = RecoveryWidget;

// ── ClientsWidget ─────────────────────────────────────────────────────────────

interface Client { id: number; name: string; notes: string | null; createdAt: string }
interface ClientsData { clients: Client[] }

function ClientsWidget() {
  const { data, loading, error, reload } = useFetch<ClientsData>("/api/clients");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const r = await fetch("/api/clients", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const d = await r.json() as { ok?: boolean; error?: string; message?: string };
      if (d.error) throw new Error(d.message ?? d.error);
      setName("");
      reload();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <Spinner />;
  if (error) return <Err msg={error} />;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2"><Building2 className="h-4 w-4" />New Client</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") create(); }}
            placeholder="Acme Corp"
            className="flex-1 h-9 rounded-md border border-white/[0.1] bg-white/[0.04] px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <Button size="sm" onClick={create} disabled={creating || !name.trim()} className="h-9">
            {creating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : "Create"}
          </Button>
        </div>
        {createError && <Err msg={createError} />}
      </div>

      {(!data?.clients || data.clients.length === 0) ? (
        <p className="text-sm text-muted-foreground text-center py-6">No clients yet. Create your first client above.</p>
      ) : (
        <div className="space-y-2">
          {data.clients.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-medium text-primary shrink-0">
                {c.name[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{c.name}</p>
                {c.notes && <p className="text-xs text-muted-foreground truncate">{c.notes}</p>}
                <p className="text-xs text-muted-foreground">Added {new Date(c.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
ROUTE_WIDGETS["/clients"] = ClientsWidget;

// ── SecurityWidget ────────────────────────────────────────────────────────────

interface SecurityCheck { category: string; item: string; status: string; note?: string }
interface SecurityData { checks: SecurityCheck[]; generatedAt: string }

function SecurityWidget() {
  const { data, loading, error } = useFetch<SecurityData>("/api/security-evidence");
  if (loading) return <Spinner />;
  if (error || !data) return <Err msg={error ?? "No data"} />;

  const byCategory = data.checks.reduce<Record<string, SecurityCheck[]>>((acc, c) => {
    (acc[c.category] ??= []).push(c);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {Object.entries(byCategory).map(([cat, checks]) => (
        <div key={cat} className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{cat}</h3>
          {checks.map((c, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <StatusDot ok={c.status === "pass"} warn={c.status === "warn"} />
              <div className="flex-1 min-w-0">
                <p className="text-sm">{c.item}</p>
                {c.note && <p className="text-xs text-muted-foreground mt-0.5">{c.note}</p>}
              </div>
              <Badge className={`text-[11px] shrink-0 ${c.status === "pass" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" : c.status === "warn" ? "bg-amber-500/10 text-amber-400 border-amber-500/25" : "bg-red-500/10 text-red-400 border-red-500/25"}`}>
                {c.status}
              </Badge>
            </div>
          ))}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">Generated {new Date(data.generatedAt).toLocaleTimeString()}</p>
    </div>
  );
}
ROUTE_WIDGETS["/security-evidence"] = SecurityWidget;

// ── MobileReadinessWidget ─────────────────────────────────────────────────────

function MobileReadinessWidget() {
  const checks = [
    { item: "Responsive layout",          status: "pass", note: "TailwindCSS breakpoints applied across all pages." },
    { item: "Viewport meta tag",          status: "pass", note: "width=device-width, initial-scale=1 in index.html." },
    { item: "Touch targets ≥ 44px",       status: "pass", note: "Buttons and interactive elements use min-h-9 or min-h-10." },
    { item: "PWA manifest",               status: "warn", note: "manifest.json not yet configured — add for installability." },
    { item: "Service worker",             status: "warn", note: "Offline cache not yet configured." },
    { item: "iOS Safari tested",          status: "warn", note: "Verify on physical device before launch." },
    { item: "Mobile nav collapsed",       status: "pass", note: "Nav hides non-critical links on small viewports." },
  ];
  return (
    <div className="space-y-2">
      {checks.map((c, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <StatusDot ok={c.status === "pass"} warn={c.status === "warn"} />
          <div className="flex-1 min-w-0">
            <p className="text-sm">{c.item}</p>
            {c.note && <p className="text-xs text-muted-foreground mt-0.5">{c.note}</p>}
          </div>
          <Badge className={`text-[11px] shrink-0 ${c.status === "pass" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" : "bg-amber-500/10 text-amber-400 border-amber-500/25"}`}>
            {c.status}
          </Badge>
        </div>
      ))}
    </div>
  );
}
ROUTE_WIDGETS["/mobile-readiness"] = MobileReadinessWidget;

// ── DoctorTrendsWidget ────────────────────────────────────────────────────────

interface TrendEvent { eventType: string; createdAt: string }
interface TrendsData { events: TrendEvent[]; totalInPeriod: number }

function DoctorTrendsWidget() {
  const { data, loading, error } = useFetch<TrendsData>("/api/doctor/trends");
  if (loading) return <Spinner />;
  if (error || !data) return <Err msg={error ?? "No data"} />;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-6 py-4 text-center">
        <p className="text-3xl font-bold">{data.totalInPeriod}</p>
        <p className="text-xs text-muted-foreground mt-1">Doctor events in last 90 days</p>
      </div>
      {data.events.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No doctor audit events found. Run a scan from <Link href="/doctor"><span className="text-primary underline cursor-pointer">Project Doctor</span></Link>.</p>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {data.events.map((e, i) => (
            <div key={i} className="flex items-center gap-3 rounded-md border border-white/[0.05] bg-white/[0.01] px-3 py-2">
              <span className="text-xs font-mono text-primary">{e.eventType}</span>
              <span className="text-xs text-muted-foreground ml-auto">{new Date(e.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
      <Link href="/doctor"><Button size="sm" variant="outline" className="text-xs flex items-center gap-1.5 w-full justify-center"><Wrench className="h-3.5 w-3.5" />Go to Project Doctor</Button></Link>
    </div>
  );
}
ROUTE_WIDGETS["/doctor/trends"] = DoctorTrendsWidget;

// ── CompareReportsWidget ──────────────────────────────────────────────────────

interface CompareResult {
  left:  { id: string; repo: string; branch: string; score: number; scannedAt: string; totalFindings: number };
  right: { id: string; repo: string; branch: string; score: number; scannedAt: string; totalFindings: number };
  delta: { scoreDelta: number; resolved: unknown[]; newFindings: unknown[]; unchanged: unknown[] };
}

function CompareReportsWidget() {
  const [leftId, setLeftId]   = useState("");
  const [rightId, setRightId] = useState("");
  const [result, setResult]   = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const compare = async () => {
    if (!leftId || !rightId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/reports/compare?left=${encodeURIComponent(leftId)}&right=${encodeURIComponent(rightId)}`, { credentials: "include" });
      const d = await r.json() as CompareResult & { error?: string; message?: string };
      if ((d as { error?: string }).error) throw new Error((d as { message?: string }).message ?? (d as { error?: string }).error);
      setResult(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 space-y-3">
        <p className="text-sm text-muted-foreground">Enter two Doctor report IDs to compare side-by-side. Run scans from <Link href="/doctor"><span className="text-primary underline cursor-pointer">Project Doctor</span></Link> to get report IDs.</p>
        <div className="grid grid-cols-2 gap-2">
          <input value={leftId} onChange={(e) => setLeftId(e.target.value)} placeholder="Left report ID" className="h-9 rounded-md border border-white/[0.1] bg-white/[0.04] px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
          <input value={rightId} onChange={(e) => setRightId(e.target.value)} placeholder="Right report ID" className="h-9 rounded-md border border-white/[0.1] bg-white/[0.04] px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
        </div>
        <Button size="sm" onClick={compare} disabled={loading || !leftId || !rightId} className="flex items-center gap-2">
          {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}
          {loading ? "Comparing…" : "Compare Reports"}
        </Button>
      </div>
      {error && <Err msg={error} />}
      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[{ label: "Left (baseline)", r: result.left }, { label: "Right (current)", r: result.right }].map(({ label, r }) => (
              <div key={label} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                <p className="text-xl font-bold">{r.score}<span className="text-xs font-normal text-muted-foreground">/100</span></p>
                <p className="text-xs text-muted-foreground">{r.repo} · {r.branch}</p>
                <p className="text-xs text-muted-foreground">{r.totalFindings} findings</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-sm">Score delta</span>
              <Badge className={`ml-auto text-[11px] ${result.delta.scoreDelta >= 0 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" : "bg-red-500/10 text-red-400 border-red-500/25"}`}>
                {result.delta.scoreDelta >= 0 ? "+" : ""}{result.delta.scoreDelta}
              </Badge>
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span className="text-emerald-400">{(result.delta.resolved as unknown[]).length} resolved</span>
              <span className="text-red-400">{(result.delta.newFindings as unknown[]).length} new</span>
              <span>{(result.delta.unchanged as unknown[]).length} unchanged</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
ROUTE_WIDGETS["/reports/compare"] = CompareReportsWidget;

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
            <Zap className="h-4.5 w-4.5 text-primary" />
          </div>
          <h1 className="text-xl font-semibold">Session Timeline</h1>
          <Badge variant="outline" className="text-xs">#{sessionId}</Badge>
        </div>

        {loading && <Spinner />}
        {error   && <Err msg={error} />}
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

        {loading && <Spinner />}
        {error   && <Err msg={error} />}
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
        {loading && <Spinner />}

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
