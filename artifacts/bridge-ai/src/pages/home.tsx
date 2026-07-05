import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Zap, Shield, Blocks, ArrowRight, FileText, KeyRound, Wrench, CheckCircle2 } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen" style={{ background: "#faf8f2", color: "#111" }}>
      {/* ─── Minimal top bar ─── */}
      <header className="px-6 h-14 flex items-center sticky top-0 z-50"
        style={{ background: "rgba(250,248,242,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid #dbd8cc" }}>
        <Link href="/" className="flex items-center justify-center">
          <img
            src="/viba-logo.png"
            alt="VIBA"
            className="h-12 w-auto object-contain"
          />
        </Link>
        <nav className="ml-auto flex gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="sm" style={{ color: "#6b7280" }}>Settings</Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="outline" size="sm" style={{ borderColor: "#d1d5db", color: "#111" }}>Dashboard</Button>
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        {/* ─── Hero ─── */}
        <section className="w-full py-24 md:py-36 lg:py-48 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: "linear-gradient(180deg, rgba(99,102,241,0.04) 0%, transparent 60%)" }} />
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(ellipse, rgba(99,102,241,0.07) 0%, transparent 70%)" }} />

          <div className="container px-4 md:px-6 relative z-10">
            <div className="flex flex-col items-center space-y-9 text-center">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold"
                style={{ border: "1px solid rgba(99,102,241,0.35)", background: "rgba(99,102,241,0.08)", color: "#4f46e5" }}>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                    style={{ background: "#6366f1" }} />
                  <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "#6366f1" }} />
                </span>
                VIBA — Very Important Business Asset
              </div>

              {/* Headline */}
              <div className="space-y-6 max-w-4xl">
                <h1 className="font-extrabold" style={{ fontSize: "clamp(2.5rem,7vw,4.5rem)", lineHeight: 1.1, letterSpacing: "-0.03em", color: "#111" }}>
                  AI collaboration that{" "}
                  <br className="hidden sm:block" />
                  <span style={{
                    background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #4f46e5 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}>
                    tests, fixes, and ships software faster.
                  </span>
                </h1>
                <p className="mx-auto max-w-[680px] text-lg md:text-xl leading-relaxed font-light tracking-[-0.01em]"
                  style={{ color: "#6b7280" }}>
                  Connect ChatGPT, Claude, Gemini, Perplexity, Manus, Replit, Render, and more in one session. Assign specialist roles, run a structured workflow, and get evidence-backed reports a human owner can trust.
                </p>
              </div>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5">
                <Link href="/dashboard">
                  <button
                    className="relative flex items-center gap-2 h-12 px-8 rounded-xl text-base font-semibold text-white overflow-hidden transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                    style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)", boxShadow: "0 0 24px rgba(99,102,241,0.3), 0 2px 8px rgba(0,0,0,0.12)" }}
                  >
                    Start a VIBA session <ArrowRight className="h-4 w-4" />
                  </button>
                </Link>
                <Link href="/launch-readiness">
                  <button
                    className="flex items-center gap-2 h-12 px-8 rounded-xl text-base font-medium transition-all duration-200"
                    style={{ border: "1px solid #dbd8cc", background: "#f2f0e8", color: "#374151" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#ebe8de"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "#f2f0e8"; }}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    View launch readiness
                  </button>
                </Link>
              </div>

              {/* Provider logos row */}
              <div className="flex items-center gap-2 pt-4 flex-wrap justify-center">
                <span className="text-xs mr-2" style={{ color: "#9ca3af" }}>Works with</span>
                {["ChatGPT", "Claude", "Gemini", "Perplexity", "Manus", "Replit", "Render"].map(name => (
                  <span key={name} className="text-xs font-medium rounded-full px-3 py-1"
                    style={{ color: "#6b7280", border: "1px solid #dbd8cc", background: "#f2f0e8" }}>
                    {name}
                  </span>
                ))}
                <span className="text-xs font-medium rounded-full px-3 py-1"
                  style={{ color: "#6b7280", border: "1px solid #dbd8cc", background: "#f2f0e8" }}>
                  and more
                </span>
                <span className="text-xs font-semibold rounded-full px-3 py-1 flex items-center gap-1.5"
                  style={{ color: "#dc2626", border: "1px solid rgba(220,38,38,0.35)", background: "rgba(220,38,38,0.07)" }}>
                  <span className="inline-block h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: "#ef4444" }} />
                  Groq — Free
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Built for technical problem solving ─── */}
        <section className="w-full py-16 md:py-24" style={{ borderTop: "1px solid #dbd8cc", background: "#f2f0e8" }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center mb-12">
              <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl" style={{ color: "#111" }}>
                Built for technical problem solving
              </h2>
              <p className="md:text-lg" style={{ color: "#6b7280" }}>
                Every capability is designed to resolve real engineering failures — not to generate content or brainstorm ideas.
              </p>
            </div>

            <div className="mx-auto grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: Blocks,
                  title: "Multi-agent orchestration",
                  desc: "Route each task to the best available model or tool, then let agents compare results before final action.",
                  accent: "#4f46e5",
                },
                {
                  icon: Wrench,
                  title: "Build and deployment repair",
                  desc: "Inspect logs, isolate the failing file, apply the smallest safe patch, rebuild, and verify the result.",
                  accent: "#d97706",
                },
                {
                  icon: FileText,
                  title: "Self-audit and proof reports",
                  desc: "Generate evidence-backed reports that separate code checks, build checks, runtime checks, deployment checks, and manual browser checks.",
                  accent: "#2563eb",
                },
                {
                  icon: Shield,
                  title: "Owner-controlled automation",
                  desc: "High-risk actions such as repository changes, deployment changes, credential use, and security-sensitive work require explicit approval.",
                  accent: "#7c3aed",
                },
                {
                  icon: Zap,
                  title: "Provider-aware routing",
                  desc: "Use low-cost models for simple reasoning and reserve premium providers or GitHub tools for tasks that need them.",
                  accent: "#dc2626",
                },
                {
                  icon: CheckCircle2,
                  title: "Production readiness",
                  desc: "Check environment variables, health endpoints, public routes, frontend output, backend output, and unresolved launch risks.",
                  accent: "#059669",
                },
              ].map(({ icon: Icon, title, desc, accent }) => (
                <div
                  key={title}
                  className="group relative flex flex-col gap-4 rounded-2xl p-7 transition-all duration-250"
                  style={{ border: "1px solid #e5e7eb", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}
                >
                  <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl"
                    style={{ background: `linear-gradient(90deg, transparent, ${accent}55, transparent)` }} />
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl"
                    style={{ background: `${accent}14`, border: `1px solid ${accent}30` }}>
                    <Icon className="h-5 w-5" style={{ color: accent }} />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-base font-bold tracking-tight" style={{ color: "#111" }}>{title}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: "#6b7280" }}>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── No fake green lights (trust section) ─── */}
        <section className="w-full py-14 md:py-20" style={{ borderTop: "1px solid #e5e7eb", background: "#fff" }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-3xl rounded-2xl p-10 text-center"
              style={{ border: "1px solid rgba(99,102,241,0.2)", background: "linear-gradient(135deg, rgba(99,102,241,0.03) 0%, rgba(124,58,237,0.03) 100%)" }}>
              <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold mb-5"
                style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", color: "#4f46e5" }}>
                Honesty by design
              </div>
              <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl mb-4" style={{ color: "#111" }}>
                No fake green lights
              </h2>
              <p className="text-lg leading-relaxed mb-6" style={{ color: "#6b7280" }}>
                VIBA must not claim READY unless build, startup, health, public route, and deployment evidence are present. Missing browser verification or missing optional provider keys must be reported as warnings, not hidden.
              </p>
              <p className="text-sm font-medium" style={{ color: "#9ca3af" }}>
                VIBA is designed for owners who need technical issues resolved with evidence, not guesswork.
              </p>
            </div>
          </div>
        </section>

        {/* ─── How it works ─── */}
        <section className="w-full py-16 md:py-20" style={{ borderTop: "1px solid #e5e7eb", background: "#f9fafb" }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center mb-10">
              <div className="inline-block rounded-full px-3 py-1 text-xs font-semibold"
                style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", color: "#4f46e5" }}>
                How it works
              </div>
              <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl" style={{ color: "#111" }}>
                From goal to proof report in one session
              </h2>
              <p className="md:text-lg" style={{ color: "#6b7280" }}>
                Set a goal, assign agents with specialist roles, run a controlled workflow, and receive a full audit trail with findings, approvals, and next actions.
              </p>
            </div>
            <div className="mx-auto max-w-3xl rounded-2xl overflow-hidden"
              style={{ border: "1px solid #e5e7eb", boxShadow: "0 4px 24px rgba(0,0,0,0.07)" }}>
              <div className="flex items-center gap-3 px-4 py-3"
                style={{ borderBottom: "1px solid #e5e7eb", background: "#f9fafb" }}>
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full" style={{ background: "#ef4444" }} />
                  <div className="h-3 w-3 rounded-full" style={{ background: "#f59e0b" }} />
                  <div className="h-3 w-3 rounded-full" style={{ background: "#22c55e" }} />
                </div>
                <span className="text-xs font-medium" style={{ color: "#6b7280" }}>VIBA — Build a secure REST API</span>
                <span className="ml-auto text-[10px] font-medium flex items-center gap-1" style={{ color: "#22c55e" }}>
                  <span className="inline-block h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: "#22c55e" }} /> Live
                </span>
              </div>
              <div className="p-5 space-y-4 text-sm" style={{ background: "#fff" }}>
                {[
                  { agent: "ChatGPT", role: "Strategist", model: "gpt-4.1", borderColor: "#d1fae5", bg: "#f0fdf4", textColor: "#065f46", time: "09:01:12",
                    text: "I'll break this into three phases: schema design, auth middleware, and endpoint implementation. Assigning schema to Claude, auth to Gemini, endpoints to myself." },
                  { agent: "Claude", role: "Architect", model: "claude-3-5-sonnet", borderColor: "#e9d5ff", bg: "#faf5ff", textColor: "#581c87", time: "09:01:34",
                    text: "Schema draft: users(id, email, password_hash, created_at), sessions(id, user_id, token, expires_at). I recommend bcrypt cost factor 12 for password hashing." },
                  { agent: "Gemini", role: "Security Reviewer", model: "gemini-2.0-flash", borderColor: "#bfdbfe", bg: "#eff6ff", textColor: "#1e3a8a", time: "09:02:05",
                    text: "Auth middleware spec: JWT RS256, 15-min access token, 7-day refresh. Rate-limit login to 10 req/min per IP. Flag any endpoint touching credentials for my review." },
                  { agent: "ChatGPT", role: "Strategist", model: "gpt-4.1", borderColor: "#d1fae5", bg: "#f0fdf4", textColor: "#065f46", time: "09:02:41",
                    text: "All three specs align. Moving to implementation phase. Awaiting owner approval before write operations." },
                ].map(({ agent, role, model, borderColor, bg, textColor, time, text }) => (
                  <div key={time} className="rounded-xl p-4" style={{ border: `1px solid ${borderColor}`, background: bg }}>
                    <div className="flex items-center gap-2 mb-2">
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
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{ border: "1px solid #fcd34d", background: "#fffbeb" }}>
                  <Shield className="h-4 w-4 shrink-0" style={{ color: "#d97706" }} />
                  <span className="text-xs font-medium" style={{ color: "#92400e" }}>
                    Approval gate — owner action required before implementation proceeds
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Groq free tier ─── */}
        <section className="w-full py-16 md:py-20" style={{ borderTop: "1px solid #e5e7eb", background: "#fef2f2" }}>
          <div className="container px-4 md:px-6">
            <div className="mx-auto max-w-4xl">
              <div className="flex flex-col items-center gap-3 text-center mb-10">
                <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold"
                  style={{ border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.08)", color: "#b91c1c" }}>
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: "#ef4444" }} />
                    <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "#ef4444" }} />
                  </span>
                  Groq — Pre-configured &amp; Free for All Users
                </div>
                <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl" style={{ color: "#111" }}>
                  Start immediately. No API key needed.
                </h2>
                <p className="md:text-lg max-w-2xl" style={{ color: "#6b7280" }}>
                  VIBA comes with <span style={{ color: "#111", fontWeight: 500 }}>Groq pre-configured</span> — powered by Llama&nbsp;3.3&nbsp;70B. Use it to diagnose, plan, and review right away, with full approval and audit trail support.
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-5">
                <div className="rounded-2xl p-7 flex flex-col gap-4"
                  style={{ border: "1px solid rgba(220,38,38,0.25)", background: "#fff" }}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl"
                      style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)" }}>
                      <Zap className="h-5 w-5" style={{ color: "#dc2626" }} />
                    </div>
                    <div>
                      <p className="font-semibold text-sm" style={{ color: "#111" }}>Groq — Free &amp; Ready</p>
                      <p className="text-xs" style={{ color: "#9ca3af" }}>No setup required</p>
                    </div>
                  </div>
                  <ul className="space-y-2.5 text-sm" style={{ color: "#6b7280" }}>
                    {[
                      "Llama 3.3 70B — full function calling",
                      "Project Doctor — diagnose any GitHub repo",
                      "Approval gates & audit trails included",
                      "Zero cost — free Groq tier, no credit card",
                    ].map(item => (
                      <li key={item} className="flex items-start gap-2">
                        <span className="mt-0.5 h-4 w-4 rounded-full flex items-center justify-center text-[10px] shrink-0"
                          style={{ background: "rgba(220,38,38,0.12)", color: "#dc2626" }}>✓</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-2 text-xs font-medium" style={{ color: "#dc262688" }}>
                    Powered by Groq · Llama 3.3 70B · Included for all VIBA users
                  </div>
                </div>

                <div className="rounded-2xl p-7 flex flex-col gap-4"
                  style={{ border: "1px solid #e5e7eb", background: "#fff" }}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl"
                      style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
                      <KeyRound className="h-5 w-5" style={{ color: "#6366f1" }} />
                    </div>
                    <div>
                      <p className="font-semibold text-sm" style={{ color: "#111" }}>Multi-Provider Collaboration</p>
                      <p className="text-xs" style={{ color: "#9ca3af" }}>Bring your own keys</p>
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: "#6b7280" }}>
                    To run <span style={{ color: "#111", fontWeight: 500 }}>multiple specialist agents collaborating together</span> — Claude as Architect, ChatGPT as Strategist, Gemini as Reviewer — each provider needs its own API key in settings.
                  </p>
                  <ul className="space-y-2 text-sm" style={{ color: "#6b7280" }}>
                    {[
                      { name: "OpenAI", key: "OPENAI_API_KEY" },
                      { name: "Anthropic", key: "ANTHROPIC_API_KEY" },
                      { name: "Gemini", key: "GEMINI_API_KEY" },
                      { name: "Perplexity", key: "PERPLEXITY_API_KEY" },
                    ].map(({ name, key }) => (
                      <li key={key} className="flex items-center justify-between gap-2">
                        <span>{name}</span>
                        <code className="text-[10px] font-mono rounded px-2 py-0.5"
                          style={{ background: "#f3f4f6", color: "#9ca3af" }}>{key}</code>
                      </li>
                    ))}
                  </ul>
                  <Link href="/settings" className="mt-auto">
                    <button
                      className="w-full flex items-center justify-center gap-2 h-9 rounded-lg text-sm font-medium transition-all"
                      style={{ border: "1px solid #d1d5db", background: "#f9fafb", color: "#374151" }}
                    >
                      Add API Keys <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ─── Footer ─── */}
      <footer className="w-full" style={{ borderTop: "1px solid #e5e7eb", background: "#f9fafb" }}>
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-3 py-6 md:h-16">
          <div className="flex items-center gap-2">
            <img src="/viba-logo.png" alt="VIBA" className="h-10 w-auto object-contain" />
            <p className="text-sm" style={{ color: "#9ca3af" }}>
              VIBA is designed for owners who need technical issues resolved with evidence, not guesswork.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs" style={{ color: "#9ca3af" }}>
            <Link href="/pricing" className="hover:text-gray-600 transition-colors">Pricing</Link>
            <Link href="/launch-readiness" className="hover:text-gray-600 transition-colors">Launch Readiness</Link>
            <Link href="/settings" className="hover:text-gray-600 transition-colors">Settings</Link>
            <Link href="/dashboard" className="hover:text-gray-600 transition-colors">Dashboard</Link>
            <span style={{ color: "#d1d5db" }}>|</span>
            <a
              href="https://leego.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
              style={{ opacity: 0.5 }}
              title="Made by Leego"
            >
              <span>by</span>
              <img src="/leego-logo-transparent.png" alt="Leego" className="h-4 w-auto object-contain" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
