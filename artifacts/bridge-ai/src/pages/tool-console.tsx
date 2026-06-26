import { useState, useEffect, useCallback } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wrench, AlertTriangle, CheckCircle2, XCircle, Clock, ShieldAlert, Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface Invocation {
  id: number;
  tool_id: string;
  toolLabel: string;
  agent_name: string | null;
  risk_level: string;
  status: string;
  dry_run: boolean;
  approval_required: boolean;
  approved_at: string | null;
  result_redacted: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  rawValuesReturned: false;
}

interface PendingApproval {
  toolId: string;
  toolLabel: string;
  requestedByAgent: string;
  action: string;
  riskLevel: string;
  dryRunResult?: Record<string, unknown>;
  invocationId?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_ORDER = ["repository", "deployment", "payments", "dns", "email", "browser", "build", "security", "vault", "ai", "storage", "reports"];

function riskColor(level: string) {
  switch (level) {
    case "read_only": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "low":       return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "medium":    return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "high":      return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "destructive": return "bg-red-500/15 text-red-400 border-red-500/30";
    default: return "bg-muted text-muted-foreground";
  }
}

function credIcon(status: string) {
  switch (status) {
    case "configured": return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
    case "missing":    return <XCircle className="h-3.5 w-3.5 text-red-400" />;
    default:           return <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground/40" />;
  }
}

function statusIcon(status: string) {
  switch (status) {
    case "executed":           return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    case "needs_user_approval": return <ShieldAlert className="h-4 w-4 text-amber-400" />;
    case "dry_run_required":   return <Clock className="h-4 w-4 text-blue-400" />;
    case "missing_credential": return <XCircle className="h-4 w-4 text-red-400" />;
    case "blocked":
    case "scope_denied":       return <AlertTriangle className="h-4 w-4 text-red-400" />;
    case "failed":             return <XCircle className="h-4 w-4 text-red-400" />;
    default:                   return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function rel(ts: string) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToolCard({ tool }: { tool: ToolEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{tool.label}</p>
          <p className="text-xs text-muted-foreground font-mono">{tool.toolId}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {credIcon(tool.credentialStatus)}
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${riskColor(tool.riskLevel)}`}>
            {tool.riskLevel.replace("_", " ")}
          </Badge>
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-white/[0.04] pt-3 space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {tool.requiresApproval && <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30 bg-amber-500/10">approval required</Badge>}
            {tool.supportsDryRun && <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/30 bg-blue-500/10">dry-run supported</Badge>}
            {tool.requiresSafeBuild && <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-500/30 bg-purple-500/10">safe build required</Badge>}
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              cred: {tool.credentialStatus.replace("_", " ")}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground italic">rawValuesReturned: false — no secrets ever exposed.</p>
        </div>
      )}
    </div>
  );
}

function InvocationRow({ inv }: { inv: Invocation }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-white/[0.04] bg-white/[0.015] hover:bg-white/[0.03] transition-colors">
      <div className="shrink-0">{statusIcon(inv.status)}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{inv.toolLabel}</p>
        <p className="text-xs text-muted-foreground">
          {inv.agent_name ? `${inv.agent_name} agent` : "user"} · {inv.dry_run ? "dry-run · " : ""}{inv.status.replace(/_/g, " ")}
          {inv.approval_required && inv.approved_at ? " · approved" : inv.approval_required ? " · pending approval" : ""}
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${riskColor(inv.risk_level)}`}>
          {inv.risk_level.replace("_", " ")}
        </Badge>
        <span className="text-xs text-muted-foreground">{rel(inv.created_at)}</span>
      </div>
    </div>
  );
}

function ApprovalPanel({ pending, onApprove, onDeny }: { pending: PendingApproval; onApprove: () => void; onDeny: () => void }) {
  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-300">Approval Required</p>
          <p className="text-xs text-muted-foreground mt-0.5">Review the tool request before allowing execution.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><span className="text-muted-foreground text-xs">Tool</span><p className="font-medium text-foreground">{pending.toolLabel}</p></div>
        <div><span className="text-muted-foreground text-xs">Requested by</span><p className="font-medium text-foreground capitalize">{pending.requestedByAgent} agent</p></div>
        <div><span className="text-muted-foreground text-xs">Action</span><p className="font-mono text-xs text-foreground">{pending.action}</p></div>
        <div><span className="text-muted-foreground text-xs">Risk</span><Badge variant="outline" className={`text-[10px] ${riskColor(pending.riskLevel)}`}>{pending.riskLevel.replace("_", " ")}</Badge></div>
      </div>
      {pending.dryRunResult && (
        <div className="rounded-lg bg-black/30 border border-white/[0.06] p-3">
          <p className="text-xs text-muted-foreground mb-1 font-medium">Dry-run result</p>
          <p className="text-xs text-foreground/80 font-mono whitespace-pre-wrap">{JSON.stringify(pending.dryRunResult, null, 2)}</p>
        </div>
      )}
      <p className="text-xs text-muted-foreground italic">No raw credentials are shown. All secrets stay encrypted in the vault.</p>
      <div className="flex gap-3">
        <Button onClick={onApprove} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white border-0">
          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Approve & run
        </Button>
        <Button onClick={onDeny} size="sm" variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10">
          <XCircle className="h-3.5 w-3.5 mr-1.5" /> Deny
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ToolConsolePage() {
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [invocations, setInvocations] = useState<Invocation[]>([]);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const [toolsRes, invRes] = await Promise.all([
        fetch("/api/tools", { credentials: "include" }),
        fetch("/api/tools/invocations?limit=30", { credentials: "include" }),
      ]);
      if (toolsRes.ok) {
        const d = await toolsRes.json() as { tools: ToolEntry[] };
        setTools(d.tools ?? []);
      }
      if (invRes.ok) {
        const d = await invRes.json() as { invocations: Invocation[] };
        setInvocations(d.invocations ?? []);
      }
    } catch {
      setError("Failed to load tool data. Ensure the API server is running.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Poll invocations every 5s
  useEffect(() => {
    const iv = setInterval(() => fetchAll(true), 5000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  const categories = ["all", ...CATEGORY_ORDER.filter((c) => tools.some((t) => t.category === c))];
  const visibleTools = activeCategory === "all" ? tools : tools.filter((t) => t.category === activeCategory);

  const categoryStats = (cat: string) => {
    const subset = cat === "all" ? tools : tools.filter((t) => t.category === cat);
    return {
      total: subset.length,
      missing: subset.filter((t) => t.credentialStatus === "missing").length,
    };
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container max-w-screen-xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
              <Wrench className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Tool Console</h1>
              <p className="text-sm text-muted-foreground">VIBA agents use tools through a controlled broker. Sensitive actions require approval, credentials stay encrypted in the vault, and every tool use is logged.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchAll()} disabled={refreshing} className="shrink-0">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* Approval panel */}
        {pending && (
          <ApprovalPanel
            pending={pending}
            onApprove={() => { setPending(null); fetchAll(true); }}
            onDeny={() => setPending(null)}
          />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Left: Tool registry */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Tool Registry</h2>
              <span className="text-xs text-muted-foreground">{tools.length} tools</span>
            </div>

            {/* Category tabs */}
            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => {
                const { total, missing } = categoryStats(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${
                      activeCategory === cat
                        ? "bg-primary/15 border-primary/30 text-primary"
                        : "bg-white/[0.02] border-white/[0.06] text-muted-foreground hover:text-foreground hover:bg-white/[0.05]"
                    }`}
                  >
                    {cat.replace("_", " ")}
                    {missing > 0 && <span className="ml-1.5 text-red-400">({missing} missing)</span>}
                    {missing === 0 && <span className="ml-1.5 opacity-50">{total}</span>}
                  </button>
                );
              })}
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading tools…
              </div>
            ) : (
              <div className="space-y-1.5">
                {visibleTools.map((tool) => <ToolCard key={tool.toolId} tool={tool} />)}
                {visibleTools.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No tools in this category.</p>}
              </div>
            )}
          </div>

          {/* Right: Invocation log */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Invocation Log</h2>
              <span className="text-xs text-muted-foreground">{invocations.length} recent</span>
            </div>

            {/* Tool status legend */}
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</p>
              {[
                { icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />, label: "Available" },
                { icon: <XCircle className="h-3.5 w-3.5 text-red-400" />, label: "Missing credential" },
                { icon: <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />, label: "Requires approval" },
                { icon: <Clock className="h-3.5 w-3.5 text-blue-400" />, label: "Dry-run required" },
                { icon: <AlertTriangle className="h-3.5 w-3.5 text-purple-400" />, label: "Safe build required" },
              ].map(({ icon, label }) => (
                <div key={label} className="flex items-center gap-2 text-xs text-foreground/70">
                  {icon} {label}
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : invocations.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No tool invocations yet. Agent activity will appear here.</p>
              ) : (
                invocations.map((inv) => <InvocationRow key={inv.id} inv={inv} />)
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
