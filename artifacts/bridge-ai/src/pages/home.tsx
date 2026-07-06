import { useState } from "react";
import { Link } from "wouter";
import {
  Zap, Shield, ArrowRight, FileText, KeyRound, Wrench, CheckCircle2,
  AlertTriangle, Terminal, Lock, Activity, ShieldCheck, Users,
  Eye, Fingerprint, Bug, Monitor, ChevronRight, BarChart3, X,
} from "lucide-react";

const CREAM = "#faf8f2";
const CREAM_CARD = "#fefcf7";
const CREAM_ALT = "#f2f0e8";
const BORDER = "#dbd8cc";
const TEXT = "#111827";
const TEXT_MUT = "#6b7280";
const TEXT_FAINT = "#9ca3af";
const INDIGO = "#4f46e5";
const VIOLET = "#7c3aed";

export default function Home() {
  const [leegoBig, setLeegoBig] = useState(false);

  return (
    <div className="flex flex-col min-h-screen" style={{ background: CREAM, color: TEXT }}>

      {/* ── Leego logo lightbox ── */}
      {leegoBig && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
          onClick={() => setLeegoBig(false)}
        >
          <div className="relative rounded-2xl p-8 shadow-2xl" style={{ background: CREAM_CARD, border: `1px solid ${BORDER}` }}>
            <button
              onClick={() => setLeegoBig(false)}
              className="absolute top-3 right-3 flex items-center justify-center h-8 w-8 rounded-full transition-colors hover:bg-black/[0.06]"
              style={{ color: TEXT_MUT }}
            >
              <X className="h-4 w-4" />
            </button>
            <img src="/leego-logo-transparent.png" alt="Leego" className="h-24 w-auto object-contain mx-auto" />
            <p className="text-center text-sm mt-4 font-medium" style={{ color: TEXT_MUT }}>Built by Leego</p>
          </div>
        </div>
      )}

      {/* ── Top bar ── */}
      <header className="px-4 sm:px-6 h-14 flex items-center sticky top-0 z-50"
        style={{ background: "rgba(250,248,242,0.92)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${BORDER}` }}>
        <Link href="/" className="flex items-center shrink-0">
          <img src="/viba-logo.png" alt="VIBA" className="h-12 w-auto object-contain" />
        </Link>
        <nav className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {/* Hidden on mobile — only show on sm+ */}
          <Link href="/pricing" className="hidden sm:block">
            <button className="text-sm px-3.5 h-9 rounded-lg font-medium transition-colors hover:bg-black/[0.05]"
              style={{ color: TEXT_MUT }}>
              Pricing
            </button>
          </Link>
          <Link href="/demo/proof-report" className="hidden sm:block">
            <button className="text-sm px-3.5 h-9 rounded-lg font-medium transition-colors hover:bg-black/[0.05]"
              style={{ color: TEXT_MUT }}>
              Sample Report
            </button>
          </Link>

          {/* Sign in — always visible, pill style */}
          <Link href="/login">
            <button
              className="text-sm px-4 h-9 rounded-full font-medium border transition-all hover:bg-black/[0.04] active:scale-[0.97]"
              style={{ borderColor: BORDER, color: TEXT, background: "transparent" }}>
              Sign in
            </button>
          </Link>

          {/* Open Dashboard CTA — always visible */}
          <Link href="/dashboard">
            <button
              className="text-sm h-9 rounded-full font-semibold text-white transition-all hover:scale-[1.03] active:scale-[0.97] flex items-center gap-1.5 px-4 sm:px-5"
              style={{
                background: `linear-gradient(135deg, ${INDIGO} 0%, ${VIOLET} 100%)`,
                boxShadow: "0 2px 16px rgba(99,102,241,0.30)",
              }}>
              <span className="sm:hidden">Dashboard</span>
              <span className="hidden sm:inline">Open Dashboard</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0" />
            </button>
          </Link>
        </nav>
      </header>

      <main className="flex-1">

        {/* ── HERO ── */}
        <section className="w-full pt-20 pb-16 md:pt-28 md:pb-20 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: "linear-gradient(180deg, rgba(79,70,229,0.04) 0%, transparent 60%)" }} />
          <div className="container px-4 md:px-6 relative z-10">
            <div className="flex flex-col items-center space-y-8 text-center max-w-4xl mx-auto">

              <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold"
                style={{ border: `1px solid rgba(79,70,229,0.3)`, background: "rgba(79,70,229,0.07)", color: INDIGO }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: INDIGO }} />
                Technical AI Command Centre — Evidence-Backed
              </div>

              <h1 className="font-extrabold tracking-tight" style={{ fontSize: "clamp(2.2rem,6vw,3.8rem)", lineHeight: 1.1, color: TEXT }}>
                AI command centre for{" "}
                <span style={{ background: `linear-gradient(135deg, ${INDIGO} 0%, ${VIOLET} 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                  technical diagnosis, repair, and proof.
                </span>
              </h1>

              <p className="max-w-[680px] text-lg leading-relaxed" style={{ color: TEXT_MUT }}>
                VIBA coordinates specialist AI agents, browser checks, code review, security audits, and release-readiness reports so owners can see what is broken, what was fixed, and what evidence proves it.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link href="/sessions/new">
                  <button className="viba-primary-button">
                    Run a Diagnostic Session <ArrowRight className="h-4 w-4" />
                  </button>
                </Link>
                <Link href="/demo/proof-report">
                  <button className="viba-secondary-button">
                    <FileText className="h-4 w-4" /> View Proof Report
                  </button>
                </Link>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-5 pt-1">
                {[
                  { icon: Shield, text: "Evidence-backed findings" },
                  { icon: ShieldCheck, text: "Owner-approved changes" },
                  { icon: CheckCircle2, text: "No false READY status" },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-center gap-1.5 text-sm font-medium" style={{ color: TEXT_MUT }}>
                    <Icon className="h-4 w-4" style={{ color: INDIGO }} /> {text}
                  </div>
                ))}
              </div>

              <div className="flex items-center flex-wrap justify-center gap-2 pt-1">
                <span className="text-xs" style={{ color: TEXT_FAINT }}>Coordinates:</span>
                {["ChatGPT", "Claude", "Gemini", "Perplexity", "Manus", "Replit", "Render", "Groq"].map(name => (
                  <span key={name} className="text-xs font-medium rounded-full px-3 py-1"
                    style={{ color: TEXT_MUT, border: `1px solid ${BORDER}`, background: CREAM_ALT }}>
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── COMMAND REPORT MOCKUP ── */}
        <section className="w-full pb-16 md:pb-20">
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-3xl rounded-2xl overflow-hidden shadow-2xl"
              style={{ border: "1px solid rgba(79,70,229,0.3)", background: "#111827" }}>
              {/* Title bar */}
              <div className="flex items-center gap-2 px-4 py-3"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "#0f172a" }}>
                <div className="flex gap-1.5 shrink-0">
                  <div className="h-3 w-3 rounded-full" style={{ background: "#ef4444" }} />
                  <div className="h-3 w-3 rounded-full" style={{ background: "#f59e0b" }} />
                  <div className="h-3 w-3 rounded-full" style={{ background: "#22c55e" }} />
                </div>
                <span className="text-xs font-mono font-medium truncate" style={{ color: "#94a3b8" }}>
                  <span className="hidden sm:inline">VIBA — Diagnostic Report · </span>virelle.life · production
                </span>
                <span className="ml-auto shrink-0 text-[10px] font-semibold rounded-full px-2 py-0.5 flex items-center gap-1 whitespace-nowrap"
                  style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.25)" }}>
                  <span className="h-1.5 w-1.5 rounded-full animate-pulse shrink-0" style={{ background: "#fbbf24" }} />
                  <span className="hidden xs:inline">READY WITH </span>WARNINGS
                </span>
              </div>

              {/* Report body */}
              <div className="p-5 space-y-4 font-mono text-sm">
                {/* Summary row */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "CRITICAL", value: "0", color: "#22c55e", bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.2)" },
                    { label: "HIGH", value: "2", color: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.2)" },
                    { label: "WARNINGS", value: "5", color: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.15)" },
                    { label: "PASSED", value: "18", color: "#60a5fa", bg: "rgba(96,165,250,0.08)", border: "rgba(96,165,250,0.15)" },
                  ].map(({ label, value, color, bg, border }) => (
                    <div key={label} className="rounded-lg p-3 text-center"
                      style={{ background: bg, border: `1px solid ${border}` }}>
                      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
                      <div className="text-[10px] tracking-widest mt-0.5" style={{ color: "#64748b" }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Evidence rows */}
                <div className="space-y-1.5">
                  <div className="text-[10px] tracking-widest mb-2" style={{ color: "#475569" }}>EVIDENCE COLLECTED</div>
                  {[
                    { check: "Build check", status: "PASS", color: "#22c55e" },
                    { check: "Browser check", status: "PASS", color: "#22c55e" },
                    { check: "Route check", status: "PASS", color: "#22c55e" },
                    { check: "Security header check", status: "WARN", color: "#f59e0b" },
                    { check: "OAuth callback check", status: "FAIL", color: "#ef4444" },
                    { check: "TLS audit", status: "PASS", color: "#22c55e" },
                    { check: "Tool audit", status: "WARN", color: "#f59e0b" },
                  ].map(({ check, status, color }) => (
                    <div key={check} className="flex items-center justify-between px-3 py-2 rounded-lg"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <span style={{ color: "#94a3b8" }}>{check}</span>
                      <span className="text-[11px] font-bold tracking-wider" style={{ color }}>{status}</span>
                    </div>
                  ))}
                </div>

                {/* Recommended action */}
                <div className="rounded-lg px-4 py-3 flex items-start gap-3"
                  style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
                  <div>
                    <div className="text-xs font-semibold mb-0.5" style={{ color: "#fbbf24" }}>NEXT RECOMMENDED ACTION</div>
                    <div className="text-xs" style={{ color: "#94a3b8" }}>Fix OAuth callback mismatch before launch — owner approval required.</div>
                  </div>
                </div>
              </div>
            </div>
            <p className="text-center text-xs mt-4" style={{ color: TEXT_FAINT }}>
              Real diagnostic output — generated by VIBA agents, not fabricated.
            </p>
          </div>
        </section>

        {/* ── PROOF OVER GUESSWORK ── */}
        <section className="w-full py-16 md:py-20" style={{ borderTop: `1px solid ${BORDER}`, background: CREAM_ALT }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-5xl">
              <div className="text-center mb-12">
                <div className="viba-eyebrow mb-4">Accuracy by design</div>
                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-3" style={{ color: TEXT }}>
                  Proof over guesswork.
                </h2>
                <p className="text-lg" style={{ color: TEXT_MUT }}>
                  Every finding is backed by a traceable evidence chain, not a confident-sounding guess.
                </p>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
                {[
                  { icon: FileText, title: "Code evidence", desc: "Exact files, checks, and findings — no vague summaries.", color: INDIGO },
                  { icon: Monitor, title: "Runtime evidence", desc: "Health routes, browser output, and console status from real checks.", color: "#0891b2" },
                  { icon: Lock, title: "Security evidence", desc: "Headers, cookies, TLS, CSP, CORS, and exposure signals — all checked.", color: VIOLET },
                  { icon: Eye, title: "Decision evidence", desc: "What was changed, why, and what still needs manual confirmation.", color: "#c9a227" },
                ].map(({ icon: Icon, title, desc, color }) => (
                  <div key={title} className="viba-card relative">
                    <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl" style={{ background: `linear-gradient(90deg, transparent, ${color}60, transparent)` }} />
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl mb-4"
                      style={{ background: `${color}14`, border: `1px solid ${color}30` }}>
                      <Icon className="h-5 w-5" style={{ color }} />
                    </div>
                    <h3 className="text-sm font-bold mb-1.5" style={{ color: TEXT }}>{title}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: TEXT_MUT }}>{desc}</p>
                  </div>
                ))}
              </div>

              {/* Comparison table */}
              <div className="mx-auto max-w-2xl rounded-2xl overflow-hidden"
                style={{ border: `1px solid ${BORDER}` }}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead>
                      <tr style={{ background: CREAM_ALT, borderBottom: `1px solid ${BORDER}` }}>
                        <th className="px-4 py-3 text-left text-xs font-semibold w-[40%]" style={{ color: TEXT_MUT }}>Capability</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold w-[30%]" style={{ color: "#ef4444", borderLeft: `1px solid ${BORDER}` }}>Generic AI chat</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold w-[30%]" style={{ color: INDIGO, borderLeft: `1px solid ${BORDER}` }}>VIBA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["Status honesty", "Says it's done", "Shows evidence or BLOCKED"],
                        ["Missing checks", "Hides them", "Reports as WARNINGS"],
                        ["Audit trail", "None", "Owner-readable report"],
                        ["High-risk actions", "Executes silently", "Requires approval"],
                        ["False READY status", "Common", "Architecturally prevented"],
                      ].map(([cap, bad, good]) => (
                        <tr key={cap} style={{ borderTop: `1px solid ${BORDER}`, background: CREAM_CARD }}>
                          <td className="px-4 py-3 font-medium" style={{ color: TEXT }}>{cap}</td>
                          <td className="px-4 py-3 text-center" style={{ color: "#9ca3af", borderLeft: `1px solid ${BORDER}` }}>{bad}</td>
                          <td className="px-4 py-3 text-center font-medium" style={{ color: "#059669", borderLeft: `1px solid ${BORDER}` }}>{good}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── WHAT VIBA SOLVES ── */}
        <section className="w-full py-16 md:py-20" style={{ borderTop: `1px solid ${BORDER}`, background: CREAM }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-5xl">
              <div className="text-center mb-12">
                <div className="viba-eyebrow mb-4">Solution paths</div>
                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl" style={{ color: TEXT }}>
                  What VIBA solves
                </h2>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  {
                    icon: Bug, title: "My site looks fine but something is broken",
                    action: "UI audit, broken links, forms, console/network report",
                    output: "Ranked issue list with evidence", color: "#dc2626",
                  },
                  {
                    icon: Wrench, title: "My build or deploy keeps failing",
                    action: "Error isolation, patch plan, build verification",
                    output: "Patch proposal + build proof", color: "#d97706",
                  },
                  {
                    icon: CheckCircle2, title: "Is this ready to launch?",
                    action: "Launch-readiness checks with critical/high/optional ranking",
                    output: "READY / READY WITH WARNINGS / BLOCKED report", color: "#059669",
                  },
                  {
                    icon: Lock, title: "I need a safe security review",
                    action: "Headers, cookies, TLS, CSP, CORS, exposure signals",
                    output: "Defensive security report", color: VIOLET,
                  },
                  {
                    icon: Users, title: "I need multiple AIs to work as a team",
                    action: "Agent roles, task routing, review, final proof trail",
                    output: "Structured session + evidence trail", color: INDIGO,
                  },
                  {
                    icon: Activity, title: "I need production monitoring evidence",
                    action: "Health checks, uptime audit, ops status",
                    output: "Production ops status report", color: "#0891b2",
                  },
                ].map(({ icon: Icon, title, action, output, color }) => (
                  <div key={title} className="viba-card group cursor-default hover:shadow-md transition-shadow">
                    <div className="flex items-start gap-3 mb-4">
                      <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: `${color}12`, border: `1px solid ${color}25` }}>
                        <Icon className="h-4.5 w-4.5" style={{ color }} />
                      </div>
                      <p className="text-sm font-semibold leading-snug" style={{ color: TEXT }}>{title}</p>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="font-semibold uppercase tracking-wide" style={{ color: TEXT_FAINT }}>VIBA action · </span>
                        <span style={{ color: TEXT_MUT }}>{action}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-2">
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                        <span className="font-medium" style={{ color }}>{output}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section className="w-full py-16 md:py-20" style={{ borderTop: `1px solid ${BORDER}`, background: CREAM_ALT }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-5xl">
              <div className="text-center mb-12">
                <div className="viba-eyebrow mb-4">Workflow</div>
                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-3" style={{ color: TEXT }}>
                  From goal to proof report in one session
                </h2>
                <p className="text-lg" style={{ color: TEXT_MUT }}>
                  Set a goal, assign agents with specialist roles, run a controlled workflow, and receive a full audit trail.
                </p>
              </div>

              <div className="mx-auto max-w-3xl rounded-2xl overflow-hidden"
                style={{ border: "1px solid #e2e8f0", boxShadow: "0 4px 24px rgba(0,0,0,0.07)" }}>
                <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${BORDER}`, background: CREAM_ALT }}>
                  <div className="flex gap-1.5">
                    <div className="h-3 w-3 rounded-full" style={{ background: "#ef4444" }} />
                    <div className="h-3 w-3 rounded-full" style={{ background: "#f59e0b" }} />
                    <div className="h-3 w-3 rounded-full" style={{ background: "#22c55e" }} />
                  </div>
                  <span className="text-xs font-medium" style={{ color: TEXT_MUT }}>VIBA — Secure API diagnostic session</span>
                  <span className="ml-auto text-[10px] font-semibold flex items-center gap-1" style={{ color: "#22c55e" }}>
                    <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: "#22c55e" }} /> Live
                  </span>
                </div>
                <div className="p-5 space-y-3" style={{ background: CREAM_CARD }}>
                  {[
                    { agent: "ChatGPT", role: "Strategist", model: "gpt-4.1", borderColor: "#d1fae5", bg: "#f0fdf4", textColor: "#065f46", time: "09:01:12",
                      text: "Breaking into three phases: schema design, auth middleware, endpoint implementation. Assigning schema to Claude, auth to Gemini." },
                    { agent: "Claude", role: "Architect", model: "claude-3-5-sonnet", borderColor: "#e9d5ff", bg: "#faf5ff", textColor: "#581c87", time: "09:01:34",
                      text: "Schema: users(id, email, password_hash), sessions(id, user_id, token, expires_at). Recommend bcrypt cost 12." },
                    { agent: "Gemini", role: "Security Reviewer", model: "gemini-2.0-flash", borderColor: "#bfdbfe", bg: "#eff6ff", textColor: "#1e3a8a", time: "09:02:05",
                      text: "Auth spec: JWT RS256, 15-min access token, 7-day refresh. Rate-limit login to 10 req/min. Flagging credential endpoints for review." },
                  ].map(({ agent, role, model, borderColor, bg, textColor, time, text }) => (
                    <div key={time} className="rounded-xl p-4" style={{ border: `1px solid ${borderColor}`, background: bg }}>
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="font-semibold text-xs" style={{ color: textColor }}>{agent}</span>
                        <span className="text-[10px] opacity-50">·</span>
                        <span className="text-[10px]" style={{ color: textColor, opacity: 0.7 }}>{role}</span>
                        <span className="text-[10px] opacity-50">·</span>
                        <span className="text-[10px] font-mono" style={{ color: textColor, opacity: 0.6 }}>{model}</span>
                        <span className="ml-auto text-[10px] font-mono" style={{ color: textColor, opacity: 0.5 }}>{time}</span>
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color: textColor, opacity: 0.9 }}>{text}</p>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg"
                    style={{ border: "1px solid #fcd34d", background: "#fffbeb" }}>
                    <Shield className="h-4 w-4 shrink-0" style={{ color: "#d97706" }} />
                    <span className="text-xs font-medium" style={{ color: "#92400e" }}>
                      Approval gate — owner action required before implementation proceeds
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── WHO THIS IS FOR ── */}
        <section className="w-full py-16 md:py-20" style={{ borderTop: `1px solid ${BORDER}`, background: CREAM }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-5xl">
              <div className="text-center mb-12">
                <div className="viba-eyebrow mb-4">Audience</div>
                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl" style={{ color: TEXT }}>
                  Built for technical owners who need answers.
                </h2>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { icon: Users, title: "Solo founders", desc: "Ship faster with AI agents doing the diagnostic work you don't have engineers for." },
                  { icon: Bug, title: "Businesses with unstable sites", desc: "Find what is actually broken, not just what looks broken from the outside." },
                  { icon: BarChart3, title: "Agencies managing client launches", desc: "Produce evidence-backed readiness reports before every go-live." },
                  { icon: Fingerprint, title: "Developers needing a second opinion", desc: "Cross-check your work with specialist agents before committing." },
                  { icon: Terminal, title: "AI builders on Replit, Railway, Manus", desc: "Connects directly to your stack. No manual log digging." },
                  { icon: Lock, title: "Security-conscious operators", desc: "Defensive checks only. Nothing destructive without explicit approval." },
                ].map(({ icon: Icon, title, desc }) => (
                  <div key={title} className="viba-card">
                    <Icon className="h-5 w-5 mb-3" style={{ color: INDIGO }} />
                    <h3 className="text-sm font-bold mb-1.5" style={{ color: TEXT }}>{title}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: TEXT_MUT }}>{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── EVERY SESSION PRODUCES ── */}
        <section className="w-full py-16 md:py-20" style={{ borderTop: `1px solid ${BORDER}`, background: CREAM_ALT }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-3xl text-center">
              <div className="viba-eyebrow mb-4 mx-auto w-fit">Deliverables</div>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4" style={{ color: TEXT }}>
                Every serious session produces usable output.
              </h2>
              <p className="text-lg mb-10" style={{ color: TEXT_MUT }}>
                VIBA is a deliverable-producing system, not a chat interface.
              </p>
              <div className="grid sm:grid-cols-2 gap-3 text-left">
                {[
                  { label: "Ranked findings", desc: "Critical → High → Warning → Informational" },
                  { label: "Evidence table", desc: "Every check with its source and result" },
                  { label: "Suggested fixes", desc: "Specific, actionable, owner-readable" },
                  { label: "Owner approval log", desc: "Full decision audit trail" },
                  { label: "Retest checklist", desc: "Know exactly what to verify after changes" },
                  { label: "Final proof report", desc: "Export or share with stakeholders" },
                ].map(({ label, desc }) => (
                  <div key={label} className="flex items-start gap-3 rounded-xl px-4 py-3.5"
                    style={{ background: CREAM_CARD, border: `1px solid ${BORDER}` }}>
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "#059669" }} />
                    <div>
                      <div className="text-sm font-semibold" style={{ color: TEXT }}>{label}</div>
                      <div className="text-xs mt-0.5" style={{ color: TEXT_MUT }}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-8">
                <Link href="/demo/proof-report">
                  <button className="viba-secondary-button mx-auto">
                    <FileText className="h-4 w-4" /> View Sample Report
                  </button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── GROQ (repositioned — lower, reframed) ── */}
        <section className="w-full py-14 md:py-16" style={{ borderTop: `1px solid ${BORDER}`, background: CREAM }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-4xl">
              <div className="rounded-2xl p-8 md:p-10 flex flex-col md:flex-row items-start gap-8"
                style={{ border: `1px solid ${BORDER}`, background: CREAM_CARD }}>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="h-5 w-5" style={{ color: INDIGO }} />
                    <span className="text-sm font-semibold" style={{ color: INDIGO }}>Included Diagnostic Engine</span>
                  </div>
                  <h3 className="text-xl font-bold mb-2" style={{ color: TEXT }}>
                    Start diagnosis immediately. No API key needed.
                  </h3>
                  <p className="text-sm leading-relaxed mb-4" style={{ color: TEXT_MUT }}>
                    VIBA includes Groq (Llama&nbsp;3.3&nbsp;70B) as the baseline diagnostic engine — pre-configured, fast, and ready to run checks right away with full approval and audit trail support.
                  </p>
                  <p className="text-xs" style={{ color: TEXT_FAINT }}>
                    Add OpenAI, Claude, or Gemini keys when you need multiple specialist agents collaborating together.
                  </p>
                </div>
                <div className="shrink-0 md:w-56">
                  <div className="rounded-xl p-5" style={{ background: CREAM_ALT, border: `1px solid ${BORDER}` }}>
                    <p className="text-xs font-semibold mb-3" style={{ color: TEXT_MUT }}>Baseline diagnostic mode included</p>
                    {[
                      "Llama 3.3 70B — full function calling",
                      "Project Doctor — diagnose any repo",
                      "Approval gates & audit trails",
                      "No credit card required to start",
                    ].map(item => (
                      <div key={item} className="flex items-center gap-2 text-xs mb-2" style={{ color: TEXT_MUT }}>
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: "#059669" }} />
                        {item}
                      </div>
                    ))}
                    <Link href="/sessions/new">
                      <button className="w-full mt-4 text-sm font-semibold h-9 rounded-lg text-white transition-all"
                        style={{ background: `linear-gradient(135deg, ${INDIGO}, ${VIOLET})` }}>
                        Run a Diagnostic Session
                      </button>
                    </Link>
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-2xl p-6 flex flex-col sm:flex-row items-start gap-5"
                style={{ border: `1px solid rgba(79,70,229,0.2)`, background: "rgba(79,70,229,0.04)" }}>
                <KeyRound className="h-5 w-5 mt-0.5 shrink-0" style={{ color: INDIGO }} />
                <div className="flex-1">
                  <p className="text-sm font-semibold mb-1" style={{ color: TEXT }}>Add premium providers for collaborative AI work</p>
                  <p className="text-sm mb-3" style={{ color: TEXT_MUT }}>
                    To coordinate Claude as Architect, ChatGPT as Strategist, and Gemini as Reviewer — each provider needs its own key.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY"].map(k => (
                      <code key={k} className="text-[11px] font-mono rounded px-2 py-1"
                        style={{ background: CREAM_ALT, border: `1px solid ${BORDER}`, color: TEXT_MUT }}>{k}</code>
                    ))}
                  </div>
                </div>
                <Link href="/connections">
                  <button className="text-sm font-medium shrink-0 flex items-center gap-1.5 px-4 h-9 rounded-lg border transition-colors"
                    style={{ borderColor: BORDER, color: TEXT }}>
                    Add API Keys <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── FINAL CTA ── */}
        <section className="w-full py-16 md:py-20" style={{ borderTop: `1px solid ${BORDER}`, background: CREAM_ALT }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-2xl rounded-2xl p-10 text-center"
              style={{ border: "1px solid rgba(79,70,229,0.2)", background: "rgba(79,70,229,0.04)" }}>
              <div className="viba-eyebrow mb-5 mx-auto w-fit">Ready to start</div>
              <h2 className="text-3xl font-bold tracking-tight mb-4" style={{ color: TEXT }}>
                Diagnose. Repair. Verify.
              </h2>
              <p className="text-lg mb-2" style={{ color: TEXT_MUT }}>
                Built for operators, founders, and technical owners who need evidence, not guesswork.
              </p>
              <p className="text-sm mb-8" style={{ color: TEXT_FAINT }}>From failure to proof — in one session.</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link href="/sessions/new">
                  <button className="viba-primary-button">
                    Run a Diagnostic Session <ArrowRight className="h-4 w-4" />
                  </button>
                </Link>
                <Link href="/demo/proof-report">
                  <button className="viba-secondary-button">
                    <FileText className="h-4 w-4" /> View Proof Report
                  </button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="w-full" style={{ borderTop: `1px solid ${BORDER}`, background: CREAM_ALT }}>
        <div className="container flex flex-col items-center gap-4 py-6 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-3">
            <img src="/viba-logo.png" alt="VIBA" className="h-9 w-auto object-contain shrink-0" />
            <p className="text-sm" style={{ color: TEXT_FAINT }}>Evidence-backed AI diagnostic platform.</p>
          </div>
          <div className="flex flex-wrap justify-center sm:justify-end items-center gap-x-4 gap-y-2 text-xs" style={{ color: TEXT_FAINT }}>
            <Link href="/pricing" className="hover:text-gray-600 transition-colors">Pricing</Link>
            <Link href="/demo/proof-report" className="hover:text-gray-600 transition-colors">Sample Report</Link>
            <Link href="/launch-readiness" className="hover:text-gray-600 transition-colors">Launch Readiness</Link>
            <Link href="/dashboard" className="hover:text-gray-600 transition-colors">Dashboard</Link>
            <span className="hidden sm:inline" style={{ color: "#d1d5db" }}>|</span>
            <button
              onClick={() => setLeegoBig(true)}
              className="flex items-center gap-1.5 transition-all hover:opacity-100 active:scale-95"
              style={{ opacity: 0.6 }}
            >
              <span>by</span>
              <img src="/leego-logo-transparent.png" alt="Leego" className="h-6 w-auto object-contain" />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
