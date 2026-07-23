import { Link } from "wouter";
import {
  FileText, Zap, CheckCircle2, Clock, ArrowRight, ChevronLeft, Info,
  Shield, BarChart2, Users, AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function PublicHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.06] bg-background/90 backdrop-blur-xl">
      <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
      <div className="container flex h-[60px] max-w-screen-2xl items-center justify-between gap-4">
        <Link href="/demo" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-4 w-4" /> Back to Demo
        </Link>
        <Link href="/signup">
          <Button size="sm" className="h-8 text-xs gap-1.5"
            style={{ background: "linear-gradient(135deg, hsl(239,84%,62%) 0%, hsl(262,72%,58%) 100%)" }}>
            Try with your project <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>
    </header>
  );
}

const SESSION = {
  id: "demo-session-001",
  goal: "Diagnose deployment failures in demo-company/landing-site and prepare a repair proposal.",
  repo: "demo-company/landing-site",
  startedAt: "2026-06-24T03:00:00Z",
  completedAt: "2026-06-24T03:00:31Z",
  mode: "simulation",
  agents: [
    { name: "ChatGPT", model: "gpt-4.1-mini", role: "Architect" },
    { name: "Claude", model: "claude-3-5-sonnet-20241022", role: "Developer" },
    { name: "Gemini", model: "gemini-2.0-flash", role: "Reviewer" },
  ],
};

const TIMELINE = [
  {
    time: "0:04",
    agent: "ChatGPT",
    role: "Architect",
    type: "analysis",
    content: "Analysed codebase structure. Identified 3 blockers: missing DATABASE_URL, health endpoint returning 404, nixpacks Node.js version not pinned.",
    toolCalls: ["github.getFile(README.md)", "github.getTree(/)", "github.getFile(nixpacks.toml)"],
  },
  {
    time: "0:12",
    agent: "Claude",
    role: "Developer",
    type: "fix_proposal",
    content: "Traced DATABASE_URL issue to Railway env config. Proposed exact variable name and format. Confirmed .env.example is missing.",
    toolCalls: ["github.getFile(.env.example)", "github.getFile(package.json)"],
  },
  {
    time: "0:19",
    agent: "Gemini",
    role: "Reviewer",
    type: "review",
    content: "Cross-checked nixpacks.toml against deployed Node.js runtime. Confirmed nodejs_22 directive absent — runtime defaults to latest, which caused a 6-hour outage in April 2026.",
    toolCalls: ["github.getFile(nixpacks.toml)", "github.getFile(railway.json)"],
  },
  {
    time: "0:24",
    agent: "VIBA",
    role: "Orchestrator",
    type: "approval_gate",
    content: "Human-in-the-loop approval required before creating repair branch. Awaiting owner confirmation.",
    toolCalls: [],
  },
  {
    time: "0:28",
    agent: "Owner",
    role: "Human",
    type: "approval",
    content: "Approved: \"I approve VIBA to create a repair branch and PR. Do not deploy.\"",
    toolCalls: [],
  },
  {
    time: "0:31",
    agent: "ChatGPT",
    role: "Developer",
    type: "output",
    content: "Created branch viba-repair/report-abc12345-1719194431000. Committed VIBA-DOCTOR-AUDIT.md. Opened PR #12: 'VIBA Doctor Repair — demo-company/landing-site (health: 48/100)'.",
    toolCalls: ["github.createBranch(viba-repair/report-abc12345-...)", "github.commitFile(VIBA-DOCTOR-AUDIT.md)", "github.openPR(#12)"],
  },
];

const OUTCOMES = [
  { icon: CheckCircle2, color: "text-emerald-400", label: "PR created", value: "#12 — 4 PR-ready items documented" },
  { icon: Shield, color: "text-blue-400", label: "Safety gates", value: "No secrets touched · No deployment triggered" },
  { icon: AlertCircle, color: "text-amber-400", label: "Escalated", value: "2 manual items need human action (env vars, health endpoint)" },
  { icon: BarChart2, color: "text-primary", label: "Health score", value: "48/100 → targeting 82/100 after manual fixes" },
];

function typeColor(type: string) {
  const map: Record<string, string> = {
    analysis: "bg-blue-500/10 text-blue-400 border-blue-500/25",
    fix_proposal: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
    review: "bg-violet-500/10 text-violet-400 border-violet-500/25",
    approval_gate: "bg-amber-500/10 text-amber-400 border-amber-500/25",
    approval: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
    output: "bg-primary/10 text-primary border-primary/25",
  };
  return map[type] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/25";
}

function typeLabel(type: string) {
  const map: Record<string, string> = {
    analysis: "Analysis",
    fix_proposal: "Fix proposal",
    review: "Code review",
    approval_gate: "Approval gate",
    approval: "Approved",
    output: "Output",
  };
  return map[type] ?? type;
}

export default function DemoProofReport() {
  const duration = Math.round(
    (new Date(SESSION.completedAt).getTime() - new Date(SESSION.startedAt).getTime()) / 1000,
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />

      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        {/* Demo banner */}
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
          <Info className="h-4 w-4 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-200/80">
            <span className="font-medium text-amber-300">Sample data.</span>{" "}
            This proof report is simulated for demo purposes. Your real sessions generate live audit trails.
          </p>
        </div>

        {/* Header */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold leading-tight">Session Proof Report</h1>
            <p className="text-sm text-muted-foreground break-words">
              {SESSION.id} · {new Date(SESSION.startedAt).toLocaleString()}
            </p>
          </div>
          <Badge className="ml-[52px] shrink-0 text-xs bg-zinc-500/10 text-zinc-400 border-zinc-500/25 sm:ml-auto">Simulation mode</Badge>
        </div>

        {/* Session meta */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 space-y-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Goal</p>
            <p className="text-sm">{SESSION.goal}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t border-white/[0.06]">
            <div>
              <p className="text-xs text-muted-foreground">Repository</p>
              <p className="text-xs font-medium mt-0.5">{SESSION.repo}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Duration</p>
              <p className="text-xs font-medium mt-0.5">{duration}s</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Agents</p>
              <p className="text-xs font-medium mt-0.5">{SESSION.agents.length}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Tool calls</p>
              <p className="text-xs font-medium mt-0.5">{TIMELINE.flatMap((t) => t.toolCalls).length}</p>
            </div>
          </div>
        </div>

        {/* Agents */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" /> Agents in session</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {SESSION.agents.map((a) => (
              <div key={a.name} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                <p className="text-sm font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground">{a.role}</p>
                <p className="text-xs text-muted-foreground/60 mt-0.5 font-mono">{a.model}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Outcomes */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Outcomes</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {OUTCOMES.map(({ icon: Icon, color, label, value }) => (
              <div key={label} className="flex items-start gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                <Icon className={`h-4 w-4 ${color} mt-0.5 shrink-0`} />
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xs font-medium mt-0.5">{value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /> Audit timeline</h2>
          <div className="relative space-y-0">
            <div className="absolute left-[19px] top-0 bottom-0 w-px bg-white/[0.06]" />
            {TIMELINE.map((step, i) => (
              <div key={i} className="relative flex gap-4 pb-5 last:pb-0">
                <div className="relative z-10 h-10 w-10 rounded-full border border-white/[0.1] bg-background flex items-center justify-center shrink-0">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="flex-1 rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{step.agent}</span>
                    <span className="text-xs text-muted-foreground bg-white/[0.05] rounded px-1.5 py-0.5">{step.role}</span>
                    <Badge className={`text-[11px] border ${typeColor(step.type)}`}>{typeLabel(step.type)}</Badge>
                    <span className="text-xs text-muted-foreground ml-auto">{step.time}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{step.content}</p>
                  {step.toolCalls.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {step.toolCalls.map((tc, j) => (
                        <code key={j} className="text-[10px] bg-white/[0.04] border border-white/[0.06] text-muted-foreground px-1.5 py-0.5 rounded">
                          {tc}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-6 text-center space-y-4">
          <h3 className="font-medium">Generate a proof report for your own project</h3>
          <p className="text-sm text-muted-foreground">Create a VIBA account, connect your AI providers, and run your first session. Every action is logged in a verifiable audit trail.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup">
              <Button className="gap-2" style={{ background: "linear-gradient(135deg, hsl(239,84%,62%) 0%, hsl(262,72%,58%) 100%)" }}>
                Create account <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/demo/doctor-report">
              <Button variant="outline" className="gap-2">
                See sample Doctor report
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <footer className="border-t border-white/[0.06] py-8 px-4 text-center text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} VIBA — All data on this page is sample/demo data.</p>
      </footer>
    </div>
  );
}
