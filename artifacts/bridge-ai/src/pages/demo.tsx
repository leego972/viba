import { Link } from "wouter";
import {
  Cpu, Stethoscope, FileText, ArrowRight, Zap, Shield, BarChart2, ChevronRight,
} from "lucide-react";


function PublicHeader() {
  return (
    <header
      className="sticky top-0 z-50 w-full"
      style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(12px)", borderBottom: "1px solid #e2e8f0" }}
    >
      <div className="container flex h-14 max-w-screen-xl items-center justify-between gap-4 px-6">
        <Link href="/" className="flex items-center">
          <img src="/viba-logo.png" alt="VIBA" className="h-12 w-auto object-contain" />
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/demo/doctor-report">
            <button className="text-sm px-3 py-1.5 rounded transition-colors" style={{ color: "#475569" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#0f172a")}
              onMouseLeave={e => (e.currentTarget.style.color = "#475569")}>
              Doctor Demo
            </button>
          </Link>
          <Link href="/demo/proof-report">
            <button className="text-sm px-3 py-1.5 rounded transition-colors" style={{ color: "#475569" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#0f172a")}
              onMouseLeave={e => (e.currentTarget.style.color = "#475569")}>
              Proof Report
            </button>
          </Link>
          <Link href="/login">
            <button className="text-sm px-4 py-1.5 rounded font-medium transition-colors ml-2"
              style={{ border: "1px solid #d1d9e0", color: "#0f172a", background: "#fff" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
              onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
              Sign in
            </button>
          </Link>
          <Link href="/signup">
            <button className="text-sm px-4 py-1.5 rounded font-semibold text-white ml-1 flex items-center gap-1.5 transition-opacity hover:opacity-90"
              style={{ background: "#0d9488" }}>
              Get started <ArrowRight className="h-3.5 w-3.5" />
            </button>
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
    accent: "#0d9488",
  },
  {
    icon: Stethoscope,
    title: "Project Doctor",
    description: "Scan any GitHub repository for health issues: missing docs, broken config, unset env vars, and deployment blockers — all without paid AI calls.",
    accent: "#0d9488",
  },
  {
    icon: Shield,
    title: "Human-in-the-Loop Approval",
    description: "VIBA pauses for your approval before any high-stakes action. You stay in control at every step.",
    accent: "#0d9488",
  },
  {
    icon: BarChart2,
    title: "Full Audit Trail",
    description: "Every agent decision, tool call, and approval is logged. Export a proof report that shows exactly what happened and why.",
    accent: "#0d9488",
  },
];

const AGENT_STEPS = [
  { agent: "ChatGPT", role: "Architect", action: "Analysed codebase structure and identified 3 deployment blockers.", time: "0:04", color: "#065f46", bg: "#f0fdf4", border: "#bbf7d0" },
  { agent: "Claude", role: "Developer", action: "Traced DATABASE_URL missing from Railway env — proposed fix with exact variable name.", time: "0:12", color: "#581c87", bg: "#faf5ff", border: "#e9d5ff" },
  { agent: "Gemini", role: "Reviewer", action: "Cross-checked nixpacks.toml — confirmed nodejs_22 mismatch with Node 24 runtime.", time: "0:19", color: "#1e3a8a", bg: "#eff6ff", border: "#bfdbfe" },
  { agent: "VIBA", role: "Orchestrator", action: "Requested human approval before creating repair branch.", time: "0:24", color: "#92400e", bg: "#fffbeb", border: "#fcd34d" },
  { agent: "ChatGPT", role: "Developer", action: "Created VIBA-DOCTOR-AUDIT.md and opened repair PR #12.", time: "0:31", color: "#065f46", bg: "#f0fdf4", border: "#bbf7d0" },
];

export default function Demo() {
  return (
    <div className="min-h-screen" style={{ background: "#f0f4f8", color: "#0f172a" }}>
      <PublicHeader />

      {/* Hero */}
      <section className="py-20 px-4 text-center" style={{ background: "#fff", borderBottom: "1px solid #e2e8f0" }}>
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold"
            style={{ border: "1px solid rgba(13,148,136,0.3)", background: "rgba(13,148,136,0.07)", color: "#0f766e" }}>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: "#0d9488" }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "#0d9488" }} />
            </span>
            Sample demo — all data is simulated
          </div>

          <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight" style={{ color: "#0f172a" }}>
            What VIBA does —<br />
            <span style={{ color: "#0d9488" }}>in one live session</span>
          </h1>

          <p className="text-lg max-w-2xl mx-auto leading-relaxed" style={{ color: "#475569" }}>
            VIBA connects your AI providers in one session, assigns them roles, and runs them through
            a structured collaboration. You get a full audit trail and repair proposals — no manual prompt juggling.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link href="/signup">
              <button className="flex items-center gap-2 h-11 px-8 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "#0d9488", borderRadius: "4px" }}>
                Start your own project <ArrowRight className="h-4 w-4" />
              </button>
            </Link>
            <Link href="/demo/doctor-report">
              <button className="flex items-center gap-2 h-11 px-8 text-sm font-medium transition-colors"
                style={{ border: "1px solid #d1d9e0", background: "#fff", color: "#374151", borderRadius: "4px" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                <Stethoscope className="h-4 w-4" /> See sample Doctor report
              </button>
            </Link>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-semibold text-center mb-3" style={{ color: "#0f172a" }}>Everything in one platform</h2>
          <p className="text-center text-sm mb-10" style={{ color: "#64748b" }}>Precision-built for serious AI-assisted project work</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {DEMO_FEATURES.map(({ icon: Icon, title, description, accent }) => (
              <div key={title} className="bg-white p-6 space-y-3"
                style={{ border: "1px solid #e2e8f0", borderRadius: "4px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div className="h-9 w-9 rounded flex items-center justify-center"
                  style={{ background: "rgba(13,148,136,0.1)", border: "1px solid rgba(13,148,136,0.2)" }}>
                  <Icon className="h-4 w-4" style={{ color: accent }} />
                </div>
                <h3 className="text-base font-semibold" style={{ color: "#0f172a" }}>{title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "#475569" }}>{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sample session timeline */}
      <section className="py-16 px-4" style={{ background: "#fff", borderTop: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>
        <div className="max-w-3xl mx-auto space-y-8">
          <div className="text-center space-y-2">
            <div className="inline-block rounded-full px-3 py-1 text-xs font-semibold mb-2"
              style={{ background: "rgba(13,148,136,0.08)", border: "1px solid rgba(13,148,136,0.2)", color: "#0f766e" }}>
              Sample session
            </div>
            <h2 className="text-2xl font-semibold" style={{ color: "#0f172a" }}>Agent collaboration in action</h2>
            <p className="text-sm" style={{ color: "#64748b" }}>
              Task: <em>"Diagnose deployment failures in demo-company/landing-site"</em>
            </p>
            <p className="text-xs" style={{ color: "#94a3b8" }}>⚠️ Sample data — for illustration only</p>
          </div>
          <div className="space-y-3">
            {AGENT_STEPS.map((step, i) => (
              <div key={i} className="rounded p-4 space-y-1.5"
                style={{ border: `1px solid ${step.border}`, background: step.bg, borderRadius: "4px" }}>
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 shrink-0" style={{ color: step.color }} />
                  <span className="text-sm font-semibold" style={{ color: step.color }}>{step.agent}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                    style={{ background: "rgba(0,0,0,0.06)", color: step.color }}>{step.role}</span>
                  <span className="text-xs font-mono ml-auto" style={{ color: step.color, opacity: 0.6 }}>{step.time}</span>
                </div>
                <p className="text-sm leading-relaxed pl-5" style={{ color: step.color, opacity: 0.85 }}>{step.action}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo CTAs */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-xl font-semibold text-center mb-2" style={{ color: "#0f172a" }}>Explore the sample reports</h2>
          <p className="text-center text-sm mb-8" style={{ color: "#64748b" }}>See what a real VIBA session output looks like</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link href="/demo/doctor-report">
              <div className="group bg-white p-6 cursor-pointer transition-all"
                style={{ border: "1px solid #e2e8f0", borderRadius: "4px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "#0d9488"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "#e2e8f0"; }}>
                <div className="h-9 w-9 rounded flex items-center justify-center mb-4"
                  style={{ background: "rgba(13,148,136,0.1)", border: "1px solid rgba(13,148,136,0.2)" }}>
                  <Stethoscope className="h-4 w-4" style={{ color: "#0d9488" }} />
                </div>
                <h3 className="font-semibold mb-1" style={{ color: "#0f172a" }}>Sample Doctor Report</h3>
                <p className="text-sm leading-relaxed" style={{ color: "#475569" }}>See how VIBA diagnoses a repo with broken deployment, missing env vars, and documentation gaps.</p>
                <div className="flex items-center gap-1 text-xs mt-4 font-medium" style={{ color: "#0d9488" }}>
                  View report <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </div>
            </Link>
            <Link href="/demo/proof-report">
              <div className="group bg-white p-6 cursor-pointer transition-all"
                style={{ border: "1px solid #e2e8f0", borderRadius: "4px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "#0d9488"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "#e2e8f0"; }}>
                <div className="h-9 w-9 rounded flex items-center justify-center mb-4"
                  style={{ background: "rgba(13,148,136,0.1)", border: "1px solid rgba(13,148,136,0.2)" }}>
                  <FileText className="h-4 w-4" style={{ color: "#0d9488" }} />
                </div>
                <h3 className="font-semibold mb-1" style={{ color: "#0f172a" }}>Sample Proof Report</h3>
                <p className="text-sm leading-relaxed" style={{ color: "#475569" }}>See the full audit trail from a multi-agent session: every decision, tool call, and approval recorded.</p>
                <div className="flex items-center gap-1 text-xs mt-4 font-medium" style={{ color: "#0d9488" }}>
                  View report <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 px-4 text-center" style={{ background: "#fff", borderTop: "1px solid #e2e8f0" }}>
        <div className="max-w-xl mx-auto space-y-5">
          <h2 className="text-3xl font-bold tracking-tight" style={{ color: "#0f172a" }}>Ready to run your own session?</h2>
          <p style={{ color: "#475569" }}>Create a free account and connect your first AI provider in minutes.</p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link href="/signup">
              <button className="flex items-center gap-2 h-11 px-8 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "#0d9488", borderRadius: "4px" }}>
                Create account <ArrowRight className="h-4 w-4" />
              </button>
            </Link>
            <Link href="/dashboard">
              <button className="flex items-center gap-2 h-11 px-8 text-sm font-medium transition-colors"
                style={{ border: "1px solid #d1d9e0", background: "#fff", color: "#374151", borderRadius: "4px" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                Open Dashboard
              </button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="py-8 px-4 text-center text-xs" style={{ borderTop: "1px solid #e2e8f0", color: "#94a3b8" }}>
        <p>© {new Date().getFullYear()} VIBA — Collaborative Multi-Agent Orchestration System</p>
        <p className="mt-1" style={{ color: "#cbd5e1" }}>All data on this page is sample/demo data for illustration only.</p>
      </footer>
    </div>
  );
}
