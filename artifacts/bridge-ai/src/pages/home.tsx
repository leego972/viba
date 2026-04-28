import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Cpu, Zap, Shield, Blocks, ArrowRight, LineChart } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="px-6 h-14 flex items-center border-b border-border">
        <Link href="/" className="flex items-center justify-center gap-2">
          <Cpu className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg tracking-tight">BridgeAI</span>
        </Link>
        <nav className="ml-auto flex gap-4 sm:gap-6">
          <Link href="/dashboard">
            <Button variant="outline" size="sm">Dashboard</Button>
          </Link>
        </nav>
      </header>
      
      <main className="flex-1">
        <section className="w-full py-24 md:py-32 lg:py-48 xl:py-56 bg-background relative overflow-hidden">
          <div className="absolute inset-0 bg-[url('https://transparenttextures.com/patterns/cubes.png')] opacity-5" />
          <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 via-background to-background" />
          
          <div className="container px-4 md:px-6 relative z-10">
            <div className="flex flex-col items-center space-y-8 text-center">
              <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-primary/10 text-primary hover:bg-primary/20">
                Beta version 0.1.0
              </div>
              <div className="space-y-4 max-w-3xl">
                <h1 className="text-4xl font-extrabold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl/none text-foreground">
                  Plug in your AIs.<br />
                  <span className="text-primary">Let them work together.</span>
                </h1>
                <p className="mx-auto max-w-[700px] text-muted-foreground md:text-xl lg:text-2xl leading-relaxed">
                  BridgeAI is a powerful orchestration platform. Connect ChatGPT, Claude, Manus, Replit, Gemini, and Perplexity. Give them a project goal, assign roles, and watch them collaborate autonomously.
                </p>
              </div>
              <div className="space-x-4">
                <Link href="/dashboard">
                  <Button size="lg" className="h-12 px-8 text-lg font-medium gap-2">
                    Start a Bridge Session <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
                <Link href="/settings">
                  <Button variant="outline" size="lg" className="h-12 px-8 text-lg font-medium">
                    Configure API Keys
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="w-full py-12 md:py-24 lg:py-32 border-t border-border bg-muted/40">
          <div className="container px-4 md:px-6">
            <div className="mx-auto flex max-w-[58rem] flex-col items-center justify-center gap-4 text-center">
              <h2 className="text-3xl font-bold tracking-tighter sm:text-5xl">How it works</h2>
              <p className="max-w-[85%] text-muted-foreground sm:text-xl">
                Orchestrate multiple agents with specific roles to solve complex problems faster and cheaper.
              </p>
            </div>
            
            <div className="mx-auto grid max-w-5xl items-center gap-6 py-12 lg:grid-cols-3">
              <div className="flex flex-col items-center space-y-4 rounded-lg border bg-background p-6 shadow-sm">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <Blocks className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-bold">1. Plug In</h3>
                <p className="text-center text-sm text-muted-foreground">
                  Bring your own API keys. We support the major providers: OpenAI, Anthropic, Google, and more.
                </p>
              </div>
              <div className="flex flex-col items-center space-y-4 rounded-lg border bg-background p-6 shadow-sm">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <LineChart className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-bold">2. Assign Roles</h3>
                <p className="text-center text-sm text-muted-foreground">
                  Give each model a specific role: Strategist, Builder, Reviewer, QA. Let them play to their strengths.
                </p>
              </div>
              <div className="flex flex-col items-center space-y-4 rounded-lg border bg-background p-6 shadow-sm">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <Zap className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-bold">3. Execute</h3>
                <p className="text-center text-sm text-muted-foreground">
                  Watch them collaborate in real-time, generate tasks, review each other's work, and deliver the final output.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="w-full py-12 md:py-24 lg:py-32">
          <div className="container px-4 md:px-6">
            <div className="grid gap-10 sm:px-10 md:gap-16 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="inline-block rounded-lg bg-muted px-3 py-1 text-sm">Safety First</div>
                <h2 className="lg:leading-tighter text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl xl:text-[3.4rem] 2xl:text-[3.75rem]">
                  Supervised execution.
                </h2>
                <div className="flex items-center space-x-2 mt-4 text-muted-foreground text-lg">
                  <Shield className="h-6 w-6 text-primary" />
                  <p>You control the autonomy level.</p>
                </div>
                <p className="max-w-[600px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed mt-4">
                  Run sessions in Manual, Supervised, or Autonomous mode. Critical actions always require your explicit approval before the agents can proceed, preventing runaway costs and unintended side effects.
                </p>
              </div>
              <div className="flex flex-col justify-center space-y-4">
                <div className="rounded-xl border bg-card text-card-foreground shadow">
                  <div className="p-6 space-y-4">
                    <h3 className="font-semibold text-lg">Cost Efficiency</h3>
                    <p className="text-sm text-muted-foreground">
                      Why use a reasoning model for everything? Use Claude 3.5 Sonnet for strategy, and GPT-4o-mini for repetitive coding tasks. Orchestration saves money.
                    </p>
                  </div>
                </div>
                <div className="rounded-xl border bg-card text-card-foreground shadow border-primary/20">
                  <div className="p-6 space-y-4">
                    <h3 className="font-semibold text-lg">MVP Disclaimer</h3>
                    <p className="text-sm text-muted-foreground">
                      API keys are stored entirely in your browser's local storage. This is a local-first MVP designed for developers who want to control their own inference costs.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      
      <footer className="w-full border-t py-6 md:py-0">
        <div className="container flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row">
          <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
            Built for developers. BridgeAI is an open architecture project.
          </p>
        </div>
      </footer>
    </div>
  );
}
