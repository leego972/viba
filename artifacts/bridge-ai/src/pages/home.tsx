import { Link } from "wouter";
import { ArrowRight, CheckCircle2, FileText, LockKeyhole, ShieldCheck, Sparkles, Target, TrendingUp, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  {
    title: "Research",
    text: "Clarify the market, customer need, risk, evidence, and best path before expensive work starts.",
    icon: Target,
  },
  {
    title: "Design & build",
    text: "Turn requirements into usable systems, workflows, pages, reports, campaigns, and implementation plans.",
    icon: Workflow,
  },
  {
    title: "Verify & score",
    text: "Use proof gates, review packets, readiness scoring, and risk checks before calling work complete.",
    icon: ShieldCheck,
  },
  {
    title: "Improve & monetise",
    text: "Convert finished work into offers, repair sprints, retainers, campaigns, and reusable business assets.",
    icon: TrendingUp,
  },
];

const growthSteps = [
  {
    title: "Business Asset Passport",
    text: "Each important system gets a professional record: purpose, status, proof, score, revenue path, and next action.",
    icon: Target,
  },
  {
    title: "Proof-led execution",
    text: "VIBA separates drafted, validated, ready, and scale-ready work so output is never confused with verified progress.",
    icon: LockKeyhole,
  },
  {
    title: "Agent tribunal",
    text: "Strategist, Builder, Tester, Critic, Risk Officer, Monetiser, and Verifier roles force higher execution quality.",
    icon: Workflow,
  },
];

const passportStages = ["Research", "Design", "Build", "Verify", "Score", "Improve", "Monetise"];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-950">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <img src="/viba-logo.png" alt="VIBA" className="h-9 w-auto object-contain" />
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/user-instructions">
              <Button variant="ghost" className="hidden text-slate-600 hover:bg-slate-100 hover:text-slate-950 sm:inline-flex">User Instructions</Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="outline" className="border-slate-200 bg-white text-slate-800 hover:bg-slate-50">Dashboard</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden px-4 py-16 sm:px-6 sm:py-24">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(20,184,166,0.13),_transparent_38%)]" />
          <div className="pointer-events-none absolute -right-24 top-24 h-72 w-72 rounded-full bg-teal-200/25 blur-3xl" />
          <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[1fr_0.9fr]">
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">
                <Sparkles className="h-3.5 w-3.5" /> Very Interesting Business Assets
              </div>
              <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
                The AI Business Asset Passport for serious operators.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
                VIBA researches, designs, builds, verifies, scores, improves, and monetises the systems your business depends on. It does not just chat — it turns work into proof-led business assets.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/dashboard">
                  <Button className="h-12 rounded-xl bg-slate-950 px-7 text-base text-white hover:bg-slate-800">
                    Start Orchestrating <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/bridge">
                  <Button variant="outline" className="h-12 rounded-xl border-slate-200 bg-white px-7 text-base text-slate-800 hover:bg-slate-50">
                    <TrendingUp className="mr-2 h-4 w-4" /> Growth Engine
                  </Button>
                </Link>
                <Link href="/user-instructions">
                  <Button variant="outline" className="h-12 rounded-xl border-slate-200 bg-white px-7 text-base text-slate-800 hover:bg-slate-50">
                    <FileText className="mr-2 h-4 w-4" /> User Instructions
                  </Button>
                </Link>
              </div>
              <div className="mt-8 flex flex-wrap gap-2 text-xs text-slate-500">
                {passportStages.map((item) => (
                  <span key={item} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm">{item}</span>
                ))}
              </div>
            </div>

            <div className="relative z-10 rounded-[2rem] border border-slate-200 bg-white p-4 shadow-[0_30px_100px_rgba(15,23,42,0.12)]">
              <div className="rounded-[1.5rem] border border-slate-200 bg-[#f8fafc] p-4">
                <div className="mb-4 flex items-center gap-3 border-b border-slate-200 pb-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 text-white">V</div>
                  <div>
                    <p className="text-sm font-semibold text-slate-950">Business Asset Passport</p>
                    <p className="text-xs text-slate-500">Research · Design · Build · Verify</p>
                  </div>
                  <span className="ml-auto rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">Score 82</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <PassportTile label="Status" value="Ready to validate" />
                  <PassportTile label="Proof" value="Gates active" />
                  <PassportTile label="Revenue path" value="Report → Sprint" />
                  <PassportTile label="Next action" value="Verify offer" />
                </div>
                <div className="mt-4 space-y-3">
                  <Bubble name="Strategist" text="I’m defining the asset, buyer, outcome, proof gate, and first success metric." />
                  <Bubble name="Builder" text="I’m creating the system plan and separating real actions from assumptions." />
                  <Bubble name="Verifier" text="I will not mark this ready until the proof gates are satisfied." />
                </div>
                <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-400">
                  Clean workflow: context → agents → proof → score → next action.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-white px-4 py-14 sm:px-6">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight text-slate-950">Professional workflow. No clutter.</h2>
              <p className="mt-3 text-slate-600">VIBA stays organised around the asset being created: session, workbench, Growth Engine, settings. Every visible action either starts work, copies an asset, or opens a real route.</p>
            </div>
            <div className="mt-8 grid gap-4 md:grid-cols-4">
              {features.map(({ title, text, icon: Icon }) => (
                <article key={title} className="rounded-3xl border border-slate-200 bg-[#f8fafc] p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-900 shadow-sm">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-slate-950">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-[#f6f8fb] px-4 py-16 sm:px-6">
          <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                <LockKeyhole className="h-3.5 w-3.5" /> Feature runs after login
              </div>
              <h2 className="mt-5 text-4xl font-semibold tracking-tight text-slate-950">Private Growth Engine for verified revenue workflows.</h2>
              <p className="mt-4 text-base leading-7 text-slate-600">
                The Growth Engine keeps the powerful part private. It captures buyer demand, scores the opportunity, creates the asset passport, checks proof gates, runs the agent tribunal, and turns useful work into a clear revenue path.
              </p>
              <Link href="/bridge">
                <Button className="mt-7 h-12 rounded-xl bg-slate-950 px-7 text-base text-white hover:bg-slate-800">
                  Open Growth Engine <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {growthSteps.map(({ title, text, icon: Icon }) => (
                <article key={title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-slate-950">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function PassportTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function Bubble({ name, text }: { name: string; text: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500">
        <CheckCircle2 className="h-3.5 w-3.5 text-teal-600" /> {name}
      </div>
      <p className="text-sm leading-6 text-slate-700">{text}</p>
    </div>
  );
}
