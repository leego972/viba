import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Zap, Shield, Blocks, ArrowRight, LineChart } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* ─── Minimal top bar ─── */}
      <header className="px-6 h-14 flex items-center border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-50">
        <Link href="/" className="flex items-center justify-center">
          <img src="/viba-logo.png" alt="VIBA" className="h-9 w-auto object-contain" />
        </Link>
        <nav className="ml-auto flex gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="sm" className="text-foreground/60 hover:text-foreground">Settings</Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="outline" size="sm">Dashboard</Button>
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        {/* ─── Hero ─── */}
        <section className="w-full py-24 md:py-36 lg:py-48 relative overflow-hidden">
          {/* Indigo atmosphere blobs */}
          <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.07] via-transparent to-transparent pointer-events-none" />
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full bg-primary/[0.09] blur-[100px] pointer-events-none" />
          <div className="absolute top-1/4 -left-32 w-64 h-64 rounded-full bg-violet-500/[0.08] blur-3xl pointer-events-none" />
          <div className="absolute top-1/3 -right-24 w-48 h-48 rounded-full bg-indigo-500/[0.07] blur-3xl pointer-events-none" />
          {/* Subtle dot grid */}
          <div
            className="absolute inset-0 opacity-[0.022] pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(circle, hsl(var(--foreground)) 1px, transparent 1px)`,
              backgroundSize: "36px 36px",
            }}
          />
          {/* Thin indigo line across top of section */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

          <div className="container px-4 md:px-6 relative z-10">
            <div className="flex flex-col items-center space-y-9 text-center animate-fade-in-up">
              {/* Live badge */}
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/[0.12] px-4 py-1.5 text-xs font-semibold text-primary shadow-[0_0_16px_rgba(99,102,241,0.20)]">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                v1.0 — Multi-AI Orchestration Platform
              </div>

              <div className="space-y-6 max-w-4xl">
                <h1 className="font-extrabold text-foreground" style={{ fontSize: "clamp(2.5rem,7vw,4.5rem)", lineHeight: 1.1, letterSpacing: "-0.03em" }}>
                  Plug in your AIs.{" "}
                  <br className="hidden sm:block" />
                  <span style={{
                    background: "linear-gradient(135deg, hsl(239,84%,78%) 0%, hsl(262,72%,72%) 50%, hsl(239,84%,75%) 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}>
                    Let them work together.
                  </span>
                </h1>
                <p className="mx-auto max-w-[680px] text-muted-foreground text-lg md:text-xl leading-relaxed font-light tracking-[-0.01em]">
                  Connect ChatGPT, Claude, Gemini, Perplexity, Manus, and Replit in one session. Give each model a role — Strategist, Builder, Researcher — and watch them collaborate autonomously.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5">
                <Link href="/dashboard">
                  <button
                    className="relative flex items-center gap-2 h-12 px-8 rounded-xl text-base font-semibold text-white overflow-hidden transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] border border-primary/40 shadow-[0_0_28px_rgba(99,102,241,0.30)] hover:shadow-[0_0_40px_rgba(99,102,241,0.45)]"
                    style={{ background: "linear-gradient(135deg, hsl(239,84%,60%) 0%, hsl(262,72%,56%) 100%)" }}
                  >
                    Start Orchestrating <ArrowRight className="h-4 w-4" />
                  </button>
                </Link>
                <Link href="/settings">
                  <button className="flex items-center gap-2 h-12 px-8 rounded-xl text-base font-medium border border-border/60 bg-white/[0.04] hover:bg-white/[0.07] hover:border-border transition-all duration-200 text-foreground/80 hover:text-foreground">
                    Configure Keys
                  </button>
                </Link>
              </div>

              {/* Provider logos row */}
              <div className="flex items-center gap-2 pt-4 flex-wrap justify-center">
                <span className="text-xs text-muted-foreground/50 mr-2">Works with</span>
                {["ChatGPT", "Claude", "Gemini", "Perplexity", "Manus", "Replit"].map(name => (
                  <span key={name} className="text-xs font-medium text-foreground/40 border border-border/30 rounded-full px-3 py-1 bg-white/[0.02]">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ─── How it works ─── */}
        <section className="w-full py-16 md:py-24 border-t border-border/50 bg-muted/20">
          <div className="container px-4 md:px-6">
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center mb-12">
              <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl">How it works</h2>
              <p className="text-muted-foreground md:text-lg">
                Orchestrate multiple agents with specific roles to solve complex problems faster and cheaper.
              </p>
            </div>

            <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-3">
              {[
                {
                  icon: Blocks,
                  step: "1",
                  title: "Plug In",
                  desc: "Bring your own API keys. We support OpenAI, Anthropic, Google, Perplexity, Manus, and Replit.",
                },
                {
                  icon: LineChart,
                  step: "2",
                  title: "Assign Roles",
                  desc: "Give each model a role: Strategist, Builder, Reviewer, QA. Let them play to their strengths.",
                },
                {
                  icon: Zap,
                  step: "3",
                  title: "Execute",
                  desc: "Watch them collaborate in real-time, generate tasks, review each other's work, and deliver the output.",
                },
              ].map(({ icon: Icon, step, title, desc }) => (
                <div
                  key={step}
                  className="group flex flex-col items-center gap-4 rounded-xl border border-border/60 bg-card/80 p-7 text-center hover:border-primary/30 hover:bg-card hover:shadow-lg hover:shadow-primary/5 transition-all duration-200"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20 group-hover:bg-primary/15 group-hover:ring-primary/30 transition-all">
                    <Icon className="h-7 w-7 text-primary" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">Step {step}</p>
                    <h3 className="text-lg font-bold">{title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Live demo preview ─── */}
        <section className="w-full py-16 md:py-20 border-t border-border/50">
          <div className="container px-4 md:px-6">
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center mb-10">
              <div className="inline-block rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-xs font-semibold text-primary">
                See it in action
              </div>
              <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl">Agents collaborate in real-time</h2>
              <p className="text-muted-foreground md:text-lg">
                Watch Claude, ChatGPT, and Gemini divide work, review each other, and surface decisions — all in one session.
              </p>
            </div>
            <div className="mx-auto max-w-3xl rounded-2xl border border-border/60 bg-card/60 overflow-hidden shadow-2xl shadow-primary/5">
              {/* Mock workspace header */}
              <div className="flex items-center gap-3 border-b border-border/60 bg-muted/20 px-4 py-3">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-red-500/60" />
                  <div className="h-3 w-3 rounded-full bg-amber-500/60" />
                  <div className="h-3 w-3 rounded-full bg-emerald-500/60" />
                </div>
                <span className="text-xs text-muted-foreground font-medium">VIBA — Build a secure REST API</span>
                <span className="ml-auto text-[10px] text-emerald-400 font-medium flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
                </span>
              </div>
              {/* Mock messages */}
              <div className="p-5 space-y-4 text-sm">
                {[
                  { agent: "ChatGPT", role: "Strategist", model: "gpt-4.1", color: "bg-emerald-500/10 border-emerald-500/25 text-emerald-200", time: "09:01:12",
                    text: "I'll break this into three phases: schema design, auth middleware, and endpoint implementation. Assigning schema to Claude, auth to Gemini, endpoints to myself." },
                  { agent: "Claude", role: "Architect", model: "claude-3-5-sonnet", color: "bg-violet-500/10 border-violet-500/25 text-violet-200", time: "09:01:34",
                    text: "Schema draft: users(id, email, password_hash, created_at), sessions(id, user_id, token, expires_at). I recommend bcrypt cost factor 12 for password hashing." },
                  { agent: "Gemini", role: "Security Reviewer", model: "gemini-2.0-flash", color: "bg-blue-500/10 border-blue-500/25 text-blue-200", time: "09:02:05",
                    text: "Auth middleware spec: JWT RS256, 15-min access token, 7-day refresh. Rate-limit login to 10 req/min per IP. Flag any endpoint touching credentials for my review." },
                  { agent: "ChatGPT", role: "Strategist", model: "gpt-4.1", color: "bg-emerald-500/10 border-emerald-500/25 text-emerald-200", time: "09:02:41",
                    text: "All three specs align. Moving to implementation phase. Claude, please implement the schema migrations. Gemini, build the auth middleware. I'll wire the endpoints." },
                ].map(({ agent, role, model, color, time, text }) => (
                  <div key={time} className={`rounded-xl border p-4 ${color}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-xs">{agent}</span>
                      <span className="text-[10px] opacity-60">·</span>
                      <span className="text-[10px] opacity-70">{role}</span>
                      <span className="text-[10px] opacity-60">·</span>
                      <span className="text-[10px] font-mono opacity-60">{model}</span>
                      <span className="ml-auto text-[10px] font-mono opacity-50">{time}</span>
                    </div>
                    <p className="text-sm leading-relaxed opacity-90">{text}</p>
                  </div>
                ))}
                <div className="flex items-center gap-2 px-2">
                  <div className="flex gap-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <span className="text-xs text-muted-foreground">Claude is implementing schema migrations…</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Feature highlight ─── */}
        <section className="w-full py-16 md:py-24">
          <div className="container px-4 md:px-6">
            <div className="grid gap-10 sm:px-10 md:gap-16 lg:grid-cols-2 items-center">
              <div className="space-y-5">
                <div className="inline-block rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-xs font-semibold text-primary">
                  Security First
                </div>
                <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl lg:text-5xl">
                  Supervised execution.
                </h2>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Shield className="h-5 w-5 text-primary shrink-0" />
                  <p className="font-medium">You control the autonomy level.</p>
                </div>
                <p className="text-muted-foreground md:text-lg leading-relaxed">
                  Run sessions in Manual, Supervised, or Autonomous mode. Critical actions always require your explicit approval before agents can proceed — preventing runaway costs and unintended side effects.
                </p>
              </div>

              <div className="flex flex-col gap-4">
                {[
                  {
                    title: "Cost Efficiency",
                    body: "Why use a reasoning model for everything? Use Claude Sonnet for strategy and GPT-4o-mini for repetitive tasks. Smart orchestration saves money.",
                    accent: false,
                  },
                  {
                    title: "Server-Side Security",
                    body: "API keys are stored securely in the database and never exposed to the browser. All provider calls go through VIBA's API layer — full cost visibility, zero client-side leaks.",
                    accent: true,
                  },
                ].map(({ title, body, accent }) => (
                  <div
                    key={title}
                    className={`rounded-xl border p-6 transition-colors ${
                      accent
                        ? "border-primary/25 bg-primary/5 hover:bg-primary/8"
                        : "border-border/60 bg-card hover:bg-card/80"
                    }`}
                  >
                    <h3 className="font-semibold text-base mb-2">{title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ─── Footer ─── */}
      <footer className="w-full border-t border-border/40 bg-muted/10">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-3 py-6 md:h-16">
          <div className="flex items-center gap-2">
            <img src="/viba-logo.png" alt="VIBA" className="h-6 w-auto opacity-70" />
            <p className="text-sm text-muted-foreground">
              VIBA · Collaborative Multi-Agent Orchestration
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground/60">
            <Link href="/pricing" className="hover:text-muted-foreground transition-colors">Pricing</Link>
            <Link href="/settings" className="hover:text-muted-foreground transition-colors">Settings</Link>
            <Link href="/dashboard" className="hover:text-muted-foreground transition-colors">Dashboard</Link>
            <span className="text-border/60">|</span>
            <a
              href="https://leego.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 opacity-50 hover:opacity-80 transition-opacity"
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
