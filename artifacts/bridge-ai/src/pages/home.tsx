import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  ArrowRight, FileText, CheckCircle2, X, TrendingDown, DollarSign,
  Brain, Zap, Users, Shield, Lock, BarChart3,
} from "lucide-react";

const CREAM      = "#faf8f2";
const CREAM_CARD = "#fefcf7";
const CREAM_ALT  = "#f2f0e8";
const BORDER     = "#dbd8cc";
const TEXT       = "#111827";
const TEXT_MUT   = "#6b7280";
const TEXT_FAINT = "#9ca3af";
const INDIGO     = "#4f46e5";
const VIOLET     = "#7c3aed";
const EMERALD    = "#059669";

export default function Home() {
  const [leegoBig, setLeegoBig] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openLeego = () => {
    setLeegoBig(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setLeegoBig(false), 5000);
  };
  const closeLeego = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLeegoBig(false);
  };
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div className="flex flex-col min-h-screen" style={{ background: CREAM, color: TEXT }}>

      {/* Leego lightbox */}
      {leegoBig && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(8px)" }}
          onClick={closeLeego}
        >
          <div
            className="relative rounded-2xl p-8 shadow-2xl"
            style={{ background: "#000", border: "1px solid rgba(255,255,255,0.12)" }}
            onClick={e => e.stopPropagation()}
          >
            <button onClick={closeLeego}
              className="absolute top-3 right-3 flex items-center justify-center h-8 w-8 rounded-full transition-colors hover:bg-white/10"
              style={{ color: "rgba(255,255,255,0.5)" }}>
              <X className="h-4 w-4" />
            </button>
            <img src="/leego-logo-transparent.png" alt="Leego" className="h-24 w-auto object-contain mx-auto" />
            <p className="text-center text-sm mt-4 font-medium" style={{ color: "rgba(255,255,255,0.6)" }}>Built by Leego</p>
            <p className="text-center text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.25)" }}>Closes automatically…</p>
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
          <Link href="/pricing" className="hidden sm:block">
            <button className="text-sm px-3.5 h-9 rounded-lg font-medium transition-colors hover:bg-black/[0.05]" style={{ color: TEXT_MUT }}>
              Pricing
            </button>
          </Link>
          <Link href="/ai-optimizer" className="hidden sm:block">
            <button className="text-sm px-3.5 h-9 rounded-lg font-medium transition-colors hover:bg-black/[0.05]" style={{ color: TEXT_MUT }}>
              AI Savings
            </button>
          </Link>
          <Link href="/login">
            <button className="text-sm px-4 h-9 rounded-full font-medium border transition-all hover:bg-black/[0.04] active:scale-[0.97]"
              style={{ borderColor: BORDER, color: TEXT, background: "transparent" }}>
              Sign in
            </button>
          </Link>
          <Link href="/dashboard">
            <button className="text-sm h-9 rounded-full font-semibold text-white transition-all hover:scale-[1.03] active:scale-[0.97] flex items-center gap-1.5 px-4 sm:px-5"
              style={{ background: `linear-gradient(135deg, ${INDIGO} 0%, ${VIOLET} 100%)`, boxShadow: "0 2px 16px rgba(99,102,241,0.30)" }}>
              <span className="sm:hidden">Dashboard</span>
              <span className="hidden sm:inline">Get Started</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0" />
            </button>
          </Link>
        </nav>
      </header>

      <main className="flex-1">

        {/* ── HERO ── */}
        <section className="w-full pt-20 pb-16 md:pt-28 md:pb-24 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: "linear-gradient(180deg, rgba(79,70,229,0.05) 0%, transparent 60%)" }} />
          <div className="container px-4 md:px-6 relative z-10">
            <div className="flex flex-col items-center space-y-7 text-center max-w-3xl mx-auto">

              <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold"
                style={{ border: `1px solid rgba(79,70,229,0.3)`, background: "rgba(79,70,229,0.07)", color: INDIGO }}>
                <TrendingDown className="h-3.5 w-3.5" />
                Stop overpaying for AI
              </div>

              <h1 className="font-extrabold tracking-tight"
                style={{ fontSize: "clamp(2.2rem,6vw,3.6rem)", lineHeight: 1.1, color: TEXT }}>
                Build smarter with AI.{" "}
                <span style={{
                  background: `linear-gradient(135deg, ${INDIGO} 0%, ${VIOLET} 100%)`,
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
                }}>
                  Pay less for every task.
                </span>
              </h1>

              <p className="max-w-[620px] text-base sm:text-lg leading-relaxed" style={{ color: TEXT_MUT }}>
                VIBA routes each task to the <strong style={{ color: TEXT }}>cheapest AI that can handle it</strong> — using cache, local tools, or economy models before touching a premium API. Stop wasting money on tasks that don't need GPT-4.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
                <Link href="/sessions/new">
                  <button className="viba-primary-button">
                    Start Saving on AI Costs <ArrowRight className="h-4 w-4" />
                  </button>
                </Link>
                <Link href="/ai-savings">
                  <button className="viba-secondary-button">
                    <BarChart3 className="h-4 w-4" /> See Your Savings
                  </button>
                </Link>
              </div>

              {/* Trust signals */}
              <div className="flex flex-wrap items-center justify-center gap-5 pt-2">
                {[
                  { icon: TrendingDown, text: "Up to 80% cost reduction" },
                  { icon: Zap,         text: "Right AI for every task" },
                  { icon: Shield,      text: "Evidence-backed outputs" },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-center gap-1.5 text-sm font-medium" style={{ color: TEXT_MUT }}>
                    <Icon className="h-4 w-4" style={{ color: INDIGO }} /> {text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── THE CORE PROBLEM ── */}
        <section className="w-full py-14 md:py-16" style={{ borderTop: `1px solid ${BORDER}`, background: CREAM_ALT }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-4xl">
              <div className="text-center mb-10">
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: TEXT }}>
                  Most teams overpay for AI — without realising it.
                </h2>
                <p className="mt-3 text-base max-w-xl mx-auto" style={{ color: TEXT_MUT }}>
                  When you use a premium model for every task, you're paying top rates for work a faster, cheaper model handles just as well.
                </p>
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  {
                    icon: DollarSign,
                    title: "Premium models for simple tasks",
                    desc: "Sending grammar corrections and one-line summaries to GPT-4o costs 10–50× more than they need to.",
                    bad: true,
                  },
                  {
                    icon: Brain,
                    title: "No memory between sessions",
                    desc: "Re-sending the same project context on every call wastes tokens — and money — every single time.",
                    bad: true,
                  },
                  {
                    icon: Users,
                    title: "No coordination between AIs",
                    desc: "Using one AI for everything ignores that Claude, Gemini, and Groq each have different strengths and price points.",
                    bad: true,
                  },
                ].map(({ icon: Icon, title, desc }) => (
                  <div key={title} className="rounded-2xl p-5"
                    style={{ background: CREAM_CARD, border: `1px solid #fecaca` }}>
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl mb-3"
                      style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
                      <Icon className="h-4.5 w-4.5" style={{ color: "#dc2626" }} />
                    </div>
                    <h3 className="text-sm font-bold mb-1.5" style={{ color: TEXT }}>{title}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: TEXT_MUT }}>{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── HOW VIBA FIXES THIS ── */}
        <section className="w-full py-14 md:py-18" style={{ borderTop: `1px solid ${BORDER}`, background: CREAM }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-4xl">
              <div className="text-center mb-10">
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1 mb-4"
                  style={{ background: "rgba(5,150,105,0.08)", border: "1px solid rgba(5,150,105,0.2)", color: EMERALD }}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> How VIBA fixes it
                </div>
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: TEXT }}>
                  Every task goes to the right AI — automatically.
                </h2>
                <p className="mt-3 text-base max-w-xl mx-auto" style={{ color: TEXT_MUT }}>
                  VIBA checks 7 smarter options before sending a task to a premium model. Most tasks never need one.
                </p>
              </div>

              {/* Priority ladder */}
              <div className="mx-auto max-w-2xl space-y-2 mb-10">
                {[
                  { n: "1", label: "Task cache",     desc: "Identical task run before? Return the cached result instantly — zero AI cost.",    color: EMERALD },
                  { n: "2", label: "Project memory", desc: "Stored context reused instead of re-sending full history on every call.",          color: "#0891b2" },
                  { n: "3", label: "Local tool",     desc: "Browser automation or code analysis — no AI model needed at all.",                 color: "#3b82f6" },
                  { n: "4", label: "Rule engine",    desc: "Deterministic checks for repeatable findings — instant, free, consistent.",        color: "#6366f1" },
                  { n: "5", label: "Economy model",  desc: "Fast, cheap model (Groq / Llama) for tasks that don't need premium reasoning.",    color: "#8b5cf6" },
                  { n: "6", label: "Premium model",  desc: "GPT-4o, Claude 3.5, or Gemini — only when the task genuinely needs it.",          color: VIOLET },
                  { n: "7", label: "Multi-model",    desc: "Two independent models to verify high-stakes outputs — never the default.",        color: "#a21caf" },
                ].map(({ n, label, desc, color }) => (
                  <div key={n} className="flex items-start gap-3 rounded-xl px-4 py-3"
                    style={{ background: CREAM_CARD, border: `1px solid ${BORDER}` }}>
                    <span className="h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 text-white"
                      style={{ background: color }}>
                      {n}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-snug" style={{ color: TEXT }}>{label}</p>
                      <p className="text-xs mt-0.5 leading-relaxed" style={{ color: TEXT_MUT }}>{desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Outcome pills */}
              <div className="rounded-2xl p-6 text-center"
                style={{ background: "rgba(5,150,105,0.05)", border: "1px solid rgba(5,150,105,0.2)" }}>
                <p className="text-base font-semibold mb-1" style={{ color: TEXT }}>
                  The result: you pay for AI only when you actually need it.
                </p>
                <p className="text-sm" style={{ color: TEXT_MUT }}>
                  Every task that hits cache, memory, a local tool, or an economy model is money saved — automatically, in the background, on every session.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── SAVINGS PROOF ── */}
        <section className="w-full py-14 md:py-16" style={{ borderTop: `1px solid ${BORDER}`, background: CREAM_ALT }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-4xl">
              <div className="text-center mb-10">
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: TEXT }}>
                  Real savings. Measured per task.
                </h2>
                <p className="mt-3 text-base" style={{ color: TEXT_MUT }}>
                  VIBA tracks the cost of every task — and what it would have cost without optimisation.
                </p>
              </div>

              <div className="grid sm:grid-cols-3 gap-4 mb-8">
                {[
                  {
                    value: "Up to 80%",
                    label: "Cost reduction",
                    desc: "Cache hits and economy models handle most tasks — premium API spend drops dramatically.",
                    color: EMERALD,
                  },
                  {
                    value: "0 tokens",
                    label: "Wasted on repeated context",
                    desc: "Project Memory stores your stack once and reuses it — instead of re-sending it every session.",
                    color: INDIGO,
                  },
                  {
                    value: "7 checks",
                    label: "Before a premium model fires",
                    desc: "VIBA exhausts every cheaper option before routing to GPT-4, Claude, or Gemini.",
                    color: VIOLET,
                  },
                ].map(({ value, label, desc, color }) => (
                  <div key={label} className="rounded-2xl p-5 text-center"
                    style={{ background: CREAM_CARD, border: `1px solid ${BORDER}` }}>
                    <p className="text-3xl sm:text-4xl font-extrabold mb-1" style={{ color }}>{value}</p>
                    <p className="text-sm font-semibold mb-2" style={{ color: TEXT }}>{label}</p>
                    <p className="text-xs leading-relaxed" style={{ color: TEXT_MUT }}>{desc}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
                <div className="px-4 py-3 flex items-center gap-2" style={{ background: CREAM_ALT, borderBottom: `1px solid ${BORDER}` }}>
                  <div className="flex gap-1.5 shrink-0">
                    <div className="h-3 w-3 rounded-full bg-red-400" />
                    <div className="h-3 w-3 rounded-full bg-amber-400" />
                    <div className="h-3 w-3 rounded-full bg-green-400" />
                  </div>
                  <span className="text-xs font-mono truncate" style={{ color: TEXT_MUT }}>VIBA Savings Dashboard</span>
                </div>
                <div className="p-4 grid grid-cols-2 gap-3" style={{ background: "#111827" }}>
                  {[
                    { label: "Tasks run",    value: "247",    sub: "this month" },
                    { label: "No premium",   value: "189",    sub: "76% of tasks" },
                    { label: "Spent",        value: "$4.12",  sub: "with VIBA" },
                    { label: "Saved",        value: "$31.80", sub: "vs unoptimised", green: true },
                  ].map(({ label, value, sub, green }) => (
                    <div key={label} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <p className="text-[10px] tracking-widest uppercase mb-1 truncate" style={{ color: "#64748b" }}>{label}</p>
                      <p className="text-xl font-bold" style={{ color: green ? "#34d399" : "#f8fafc" }}>{value}</p>
                      <p className="text-[10px] mt-0.5 truncate" style={{ color: "#475569" }}>{sub}</p>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-center text-xs mt-3" style={{ color: TEXT_FAINT }}>
                Illustrative example based on VIBA's optimisation engine. Your savings will vary by task mix and providers used.
              </p>
            </div>
          </div>
        </section>

        {/* ── MULTI-AGENT + EVIDENCE ── */}
        <section className="w-full py-14 md:py-18" style={{ borderTop: `1px solid ${BORDER}`, background: CREAM }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-4xl">
              <div className="text-center mb-10">
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: TEXT }}>
                  Not just cheaper — smarter.
                </h2>
                <p className="mt-3 text-base max-w-xl mx-auto" style={{ color: TEXT_MUT }}>
                  VIBA doesn't just cut costs. It coordinates specialist AI agents, produces evidence-backed results, and keeps you in control of every high-stakes decision.
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  {
                    icon: Users,
                    title: "Collaborative multi-agent sessions",
                    desc: "Assign ChatGPT as Strategist, Claude as Architect, and Gemini as Security Reviewer — each working to their strengths, routing tasks only to the model best suited for them.",
                    color: INDIGO,
                  },
                  {
                    icon: Brain,
                    title: "Project Memory — stop re-paying for context",
                    desc: "Store your tech stack, past decisions, and deployment environment once. VIBA reuses that context across every session — instead of sending it (and paying for it) again each time.",
                    color: "#0891b2",
                  },
                  {
                    icon: Shield,
                    title: "Evidence-backed outputs",
                    desc: "Every diagnosis, fix, and audit is backed by real checks — not confident-sounding guesses. You receive ranked findings with a traceable evidence chain, not a chat transcript.",
                    color: EMERALD,
                  },
                  {
                    icon: Lock,
                    title: "Owner approval on every high-cost action",
                    desc: "VIBA flags tasks that exceed your cost threshold and requires confirmation before sending them to a premium model. Nothing expensive runs silently.",
                    color: VIOLET,
                  },
                ].map(({ icon: Icon, title, desc, color }) => (
                  <div key={title} className="viba-card relative">
                    <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl"
                      style={{ background: `linear-gradient(90deg, transparent, ${color}60, transparent)` }} />
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl mb-4"
                      style={{ background: `${color}12`, border: `1px solid ${color}28` }}>
                      <Icon className="h-5 w-5" style={{ color }} />
                    </div>
                    <h3 className="text-sm font-bold mb-1.5" style={{ color: "#ffffff" }}>{title}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.72)" }}>{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── WHO THIS IS FOR ── */}
        <section className="w-full py-14 md:py-16" style={{ borderTop: `1px solid ${BORDER}`, background: CREAM_ALT }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-4xl">
              <div className="text-center mb-10">
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: TEXT }}>
                  Built for teams that build with AI.
                </h2>
                <p className="mt-3 text-base" style={{ color: TEXT_MUT }}>
                  If you run AI tasks every day, VIBA pays for itself in the first week.
                </p>
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  {
                    title: "Solo founders & indie builders",
                    desc: "You're already using Claude, GPT, and Gemini. VIBA routes between them automatically — so you stop guessing which one to open and start saving on every task.",
                    saving: "Typical saving: $30–80/mo",
                  },
                  {
                    title: "Agencies running client builds",
                    desc: "Multiple projects, multiple AI calls a day. VIBA tracks spend per project, enforces budgets, and produces evidence reports you can show clients.",
                    saving: "Typical saving: $100–400/mo",
                  },
                  {
                    title: "Technical teams on Replit, Railway, Render & Manus",
                    desc: "VIBA connects to your deployment stack and runs diagnostic sessions — browser checks, code review, security audits — all routed to the cheapest capable model.",
                    saving: "Typical saving: $50–200/mo",
                  },
                ].map(({ title, desc, saving }) => (
                  <div key={title} className="viba-card flex flex-col">
                    <h3 className="text-sm font-bold mb-2" style={{ color: "#ffffff" }}>{title}</h3>
                    <p className="text-sm leading-relaxed flex-1" style={{ color: "rgba(255,255,255,0.72)" }}>{desc}</p>
                    <div className="mt-4 pt-4 flex items-center gap-2" style={{ borderTop: `1px solid ${BORDER}` }}>
                      <TrendingDown className="h-4 w-4 shrink-0" style={{ color: EMERALD }} />
                      <p className="text-xs font-semibold" style={{ color: EMERALD }}>{saving}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── INCLUDED ── */}
        <section className="w-full py-14 md:py-16" style={{ borderTop: `1px solid ${BORDER}`, background: CREAM }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-3xl rounded-2xl overflow-hidden"
              style={{ border: `1px solid ${BORDER}` }}>
              <div className="px-6 py-5 flex items-start gap-4 flex-col sm:flex-row sm:items-center justify-between"
                style={{ background: CREAM_CARD, borderBottom: `1px solid ${BORDER}` }}>
                <div>
                  <p className="text-base font-bold mb-0.5" style={{ color: TEXT }}>
                    Start immediately. No API key required.
                  </p>
                  <p className="text-sm" style={{ color: TEXT_MUT }}>
                    Groq (Llama 3.3 70B) is pre-configured — fast, capable, and included. Add premium providers when you need them.
                  </p>
                </div>
                <Link href="/sessions/new">
                  <button className="shrink-0 text-sm font-semibold h-9 px-5 rounded-full text-white whitespace-nowrap"
                    style={{ background: `linear-gradient(135deg, ${INDIGO}, ${VIOLET})` }}>
                    Get Started Free
                  </button>
                </Link>
              </div>
              <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x" style={{ borderColor: BORDER }}>
                <div className="px-6 py-5">
                  <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: TEXT_MUT }}>Included with every plan</p>
                  {[
                    "AI task optimisation engine",
                    "7-step cost routing priority",
                    "Project Memory (reusable context)",
                    "Budget controls & spend limits",
                    "Monthly savings dashboard",
                    "Groq / Llama 3.3 baseline engine",
                    "Approval gates for expensive tasks",
                  ].map(item => (
                    <div key={item} className="flex items-center gap-2 text-sm mb-2" style={{ color: TEXT_MUT }}>
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: EMERALD }} />
                      {item}
                    </div>
                  ))}
                </div>
                <div className="px-6 py-5">
                  <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: TEXT_MUT }}>Add your own providers</p>
                  {[
                    { name: "OpenAI (ChatGPT)", var: "OPENAI_API_KEY" },
                    { name: "Anthropic (Claude)", var: "ANTHROPIC_API_KEY" },
                    { name: "Google (Gemini)", var: "GEMINI_API_KEY" },
                    { name: "Perplexity", var: "PERPLEXITY_API_KEY" },
                  ].map(({ name, var: envVar }) => (
                    <div key={envVar} className="flex items-center justify-between mb-3">
                      <span className="text-sm" style={{ color: TEXT_MUT }}>{name}</span>
                      <code className="text-[10px] font-mono rounded px-2 py-0.5" style={{ background: CREAM_ALT, border: `1px solid ${BORDER}`, color: TEXT_FAINT }}>
                        {envVar}
                      </code>
                    </div>
                  ))}
                  <Link href="/connections">
                    <button className="mt-2 text-sm font-medium flex items-center gap-1 transition-colors hover:opacity-80" style={{ color: INDIGO }}>
                      Add API keys <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── FINAL CTA ── */}
        <section className="w-full py-16 md:py-20" style={{ borderTop: `1px solid ${BORDER}`, background: CREAM_ALT }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold mb-3" style={{ color: INDIGO }}>Join teams already saving on every build</p>
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4" style={{ color: TEXT }}>
                Pay for AI intelligence.<br />Not for AI waste.
              </h2>
              <p className="text-lg mb-8" style={{ color: TEXT_MUT }}>
                VIBA routes the right task to the right AI — automatically. Set it up once, save on every task from day one.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link href="/sessions/new">
                  <button className="viba-primary-button">
                    Start Optimising Now <ArrowRight className="h-4 w-4" />
                  </button>
                </Link>
                <Link href="/pricing">
                  <button className="viba-secondary-button">
                    <FileText className="h-4 w-4" /> View Pricing
                  </button>
                </Link>
              </div>
              <p className="text-xs mt-6" style={{ color: TEXT_FAINT }}>
                Groq included. No credit card required to start.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="w-full" style={{ borderTop: `1px solid ${BORDER}`, background: CREAM_ALT }}>
        <div className="container flex flex-col items-center gap-4 py-6 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-3">
            <img src="/viba-logo.png" alt="VIBA" className="h-9 w-auto object-contain shrink-0" />
            <p className="text-sm" style={{ color: TEXT_FAINT }}>Route the right task to the right AI.</p>
          </div>
          <div className="flex flex-wrap justify-center sm:justify-end items-center gap-x-4 gap-y-2 text-xs" style={{ color: TEXT_FAINT }}>
            <Link href="/pricing" className="hover:text-gray-600 transition-colors">Pricing</Link>
            <Link href="/ai-savings" className="hover:text-gray-600 transition-colors">AI Savings</Link>
            <Link href="/ai-optimizer" className="hover:text-gray-600 transition-colors">Optimiser</Link>
            <Link href="/dashboard" className="hover:text-gray-600 transition-colors">Dashboard</Link>
            <span className="hidden sm:inline" style={{ color: "#d1d5db" }}>|</span>
            <button
              onClick={openLeego}
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
