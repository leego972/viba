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
        <section className="w-full py-24 md:py-32 lg:py-48 relative overflow-hidden">
          {/* layered background */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.08] via-background to-background" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/[0.06] rounded-full blur-3xl pointer-events-none" />
          {/* dot grid */}
          <div
            className="absolute inset-0 opacity-[0.025] pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(circle, hsl(var(--foreground)) 1px, transparent 1px)`,
              backgroundSize: "32px 32px",
            }}
          />

          <div className="container px-4 md:px-6 relative z-10">
            <div className="flex flex-col items-center space-y-8 text-center animate-fade-in-up">
              {/* badge */}
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary shadow-sm shadow-primary/20">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-50" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                v1.0 — Multi-AI Orchestration Platform
              </div>

              <div className="space-y-5 max-w-3xl">
                <h1 className="text-4xl font-extrabold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl/none text-foreground">
                  Plug in your AIs.{" "}
                  <br className="hidden sm:block" />
                  <span className="text-primary">Let them work together.</span>
                </h1>
                <p className="mx-auto max-w-[680px] text-muted-foreground md:text-xl lg:text-2xl leading-relaxed">
                  Connect ChatGPT, Claude, Gemini, Perplexity, Manus, and Replit in one session. Give each model a role — Strategist, Builder, Researcher — and watch them collaborate autonomously.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link href="/dashboard">
                  <Button
                    size="lg"
                    className="w-full sm:w-auto h-12 px-8 text-base font-semibold gap-2 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-shadow"
                  >
                    Start a Session <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/settings">
                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full sm:w-auto h-12 px-8 text-base font-medium border-border/60 hover:border-border hover:bg-muted/50"
                  >
                    Configure API Keys
                  </Button>
                </Link>
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
