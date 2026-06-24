import { Link } from "wouter";
import {
  Cpu, Stethoscope, FileText, Users, ArrowRight, Zap, Shield, BarChart2,
  CheckCircle2, Play, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

function PublicHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.06] bg-background/90 backdrop-blur-xl">
      <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
      <div className="container flex h-[60px] max-w-screen-2xl items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 group">
          <img src="/viba-logo.png" alt="VIBA" className="h-8 w-auto object-contain" />
        </Link>
        <nav className="flex items-center gap-3">
          <Link href="/demo/doctor-report">
            <button className="text-sm text-foreground/60 hover:text-foreground/90 transition-colors px-3 py-1.5">
              Doctor Demo
            </button>
          </Link>
          <Link href="/demo/proof-report">
            <button className="text-sm text-foreground/60 hover:text-foreground/90 transition-colors px-3 py-1.5">
              Proof Report
            </button>
          </Link>
          <Link href="/login">
            <Button variant="outline" size="sm" className="h-8 text-xs">Sign in</Button>
          </Link>
          <Link href="/signup">
            <Button size="sm" className="h-8 text-xs gap-1.5"
              style={{ background: "linear-gradient(135deg, hsl(239,84%,62%) 0%, hsl(262,72%,58%) 100%)" }}>
              Get started <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}

const DEMO_FEATURES = [
  {
    icon: Cpu,
    title: "Multi-Agent Orchestration",
    description: "Assign ChatGPT, Claude, Gemini, and Groq different roles — Architect, Developer, Reviewer — and watch them collaborate on your task.",
  },
  {
    icon: Stethoscope,
    title: "Project Doctor",
    description: "Scan any GitHub repository for health issues: missing docs, broken config, unset env vars, and deployment blockers — all without paid AI calls.",
  },
  {
    icon: Shield,
    title: "Human-in-the-Loop Approval",
    description: "VIBA pauses for your approval before any high-stakes action. You stay in control at every step.",
  },
  {
    icon: BarChart2,
    title: "Full Audit Trail",
    description: "Every agent decision, tool call, and approval is logged. Export a proof report that shows exactly what happened and why.",
  },
];

const AGENT_STEPS = [
  { agent: "ChatGPT", role: "Architect", action: "Analysed codebase structure and identified 3 deployment blockers.", time: "0:04" },
  { agent: "Claude", role: "Developer", action: "Traced DATABASE_URL missing from Railway env — proposed fix with exact variable name.", time: "0:12" },
  { agent: "Gemini", role: "Reviewer", action: "Cross-checked nixpacks.toml — confirmed nodejs_22 mismatch with Node 24 runtime.", time: "0:19" },
  { agent: "VIBA", role: "Orchestrator", action: "Requested human approval before creating repair branch.", time: "0:24" },
  { agent: "ChatGPT", role: "Developer", action: "Created VIBA-DOCTOR-AUDIT.md and opened repair PR #12.", time: "0:31" },
];

export default function Demo() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />

      {/* Hero */}
      <section className="relative py-20 px-4 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="relative max-w-3xl mx-auto space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/8 px-4 py-1.5 text-xs text-primary/90">
            <Play className="h-3 w-3" /> Sample demo — all data is simulated
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight">
            What VIBA does —<br />
            <span className="bg-gradient-to-r from-primary to-violet-400 bg-clip-text text-transparent">
              in one live session
            </span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            VIBA connects your AI providers in one session, assigns them roles, and runs them through
            a structured collaboration. You get a full audit trail and repair proposals — no manual prompt juggling.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link href="/signup">
              <Button size="lg" className="gap-2 px-6"
                style={{ background: "linear-gradient(135deg, hsl(239,84%,62%) 0%, hsl(262,72%,58%) 100%)" }}>
                Start your own project <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/demo/doctor-report">
              <Button size="lg" variant="outline" className="gap-2 px-6">
                <Stethoscope className="h-4 w-4" /> See sample Doctor report
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-semibold text-center mb-10">Everything in one platform</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {DEMO_FEATURES.map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-6 space-y-3">
                <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Icon className="h-4.5 w-4.5 text-primary" />
                </div>
                <h3 className="text-base font-medium">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sample session timeline */}
      <section className="py-16 px-4 bg-white/[0.015]">
        <div className="max-w-3xl mx-auto space-y-8">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-semibold">Sample agent collaboration</h2>
            <p className="text-sm text-muted-foreground">
              Task: <em>"Diagnose deployment failures in demo-company/landing-site"</em>
            </p>
            <p className="text-xs text-muted-foreground/60">⚠️ Sample data — for illustration only</p>
          </div>
          <div className="relative space-y-0">
            <div className="absolute left-[19px] top-0 bottom-0 w-px bg-white/[0.06]" />
            {AGENT_STEPS.map((step, i) => (
              <div key={i} className="relative flex gap-4 pb-6 last:pb-0">
                <div className="relative z-10 h-10 w-10 rounded-full border border-primary/25 bg-primary/10 flex items-center justify-center shrink-0">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="flex-1 rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{step.agent}</span>
                    <span className="text-xs text-muted-foreground bg-white/[0.05] rounded px-1.5 py-0.5">{step.role}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{step.time}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{step.action}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo CTAs */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-xl font-semibold text-center mb-8">Explore the sample reports</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Link href="/demo/doctor-report">
              <div className="group rounded-xl border border-white/[0.08] bg-white/[0.03] hover:border-primary/30 hover:bg-primary/5 p-6 transition-all cursor-pointer">
                <Stethoscope className="h-6 w-6 text-primary mb-3" />
                <h3 className="font-medium mb-1">Sample Doctor Report</h3>
                <p className="text-sm text-muted-foreground">See how VIBA diagnoses a repo with broken deployment, missing env vars, and documentation gaps.</p>
                <div className="flex items-center gap-1 text-primary text-xs mt-4 group-hover:gap-2 transition-all">
                  View report <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </div>
            </Link>
            <Link href="/demo/proof-report">
              <div className="group rounded-xl border border-white/[0.08] bg-white/[0.03] hover:border-primary/30 hover:bg-primary/5 p-6 transition-all cursor-pointer">
                <FileText className="h-6 w-6 text-primary mb-3" />
                <h3 className="font-medium mb-1">Sample Proof Report</h3>
                <p className="text-sm text-muted-foreground">See the full audit trail from a multi-agent session: every decision, tool call, and approval recorded.</p>
                <div className="flex items-center gap-1 text-primary text-xs mt-4 group-hover:gap-2 transition-all">
                  View report <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 px-4 text-center bg-gradient-to-t from-primary/5 to-transparent">
        <div className="max-w-xl mx-auto space-y-6">
          <h2 className="text-3xl font-bold">Ready to run your own session?</h2>
          <p className="text-muted-foreground">Create a free account and connect your first AI provider in minutes.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup">
              <Button size="lg" className="gap-2 px-8"
                style={{ background: "linear-gradient(135deg, hsl(239,84%,62%) 0%, hsl(262,72%,58%) 100%)" }}>
                Create account <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button size="lg" variant="outline" className="gap-2 px-8">
                <Users className="h-4 w-4" /> Open Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] py-8 px-4 text-center text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} VIBA — Collaborative Multi-Agent Orchestration System</p>
        <p className="mt-1 text-muted-foreground/50">All data on this page is sample/demo data for illustration only.</p>
      </footer>
    </div>
  );
}
