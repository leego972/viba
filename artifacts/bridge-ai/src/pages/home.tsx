import { Link } from "wouter";
import { ArrowRight, CheckCircle2, FileText, LockKeyhole, MessageSquare, Paperclip, ShieldCheck, Sparkles, Target, TrendingUp, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  {
    title: "Live AI collaboration",
    text: "Agents speak to you and to each other while work is happening.",
    icon: MessageSquare,
  },
  {
    title: "Upload project context",
    text: "Add screenshots, logs, zips, specs, and documents directly into the session.",
    icon: Paperclip,
  },
  {
    title: "Controlled execution",
    text: "Important actions stay permission-gated, with admin-only controls separated from user projects.",
    icon: ShieldCheck,
  },
  {
    title: "Business asset engine",
    text: "Turn buyer demand into private beta-testing, repair planning, launch-readiness, and follow-up workflows after login.",
    icon: TrendingUp,
  },
];

const growthSteps = [
  {
    title: "Customer demand first",
    text: "The public message focuses on what customers need fixed or improved, not on exposing a business publicly.",
    icon: Target,
  },
  {
    title: "Private qualification",
    text: "Inside the app, VIBA scores fit, urgency, budget signal, clarity, and delivery risk before work is packaged.",
    icon: LockKeyhole,
  },
  {
    title: "Agent repair workflow",
    text: "The authenticated Growth Engine routes the opportunity into beta-testing, risk, offer, and follow-up agents.",
    icon: Workflow,
  },
];

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
          <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[1fr_0.9fr]">
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">
                <Sparkles className="h-3.5 w-3.5" /> Very Interesting Business Assets
              </div>
              <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
                VIBA turns serious business work into controlled AI execution.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
                VIBA stands for Very Interesting Business Assets: a clean AI workspace where agents coordinate, question each other, process project context, and turn useful ideas into structured business assets.
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
                {['Very Interesting Business Assets', 'Groq default AI', 'Private Growth Engine', 'Admin-gated source controls'].map((item) => (
                  <span key={item} className="rounded-full border border-slate-200 bg-white px-3 py-1.5">{item}</span>
                ))}
              </div>
            </div>

            <div className="relative z-10 rounded-[2rem] border border-slate-200 bg-white p-4 shadow-[0_30px_100px_rgba(15,23,42,0.12)]">
              <div className="rounded-[1.5rem] border border-slate-200 bg-[#f8fafc] p-4">
                <div className="mb-4 flex items-center gap-3 border-b border-slate-200 pb-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 text-white">V</div>
                  <div>
                    <p className="text-sm font-semibold text-slate-950">VIBA live session</p>
                    <p className="text-xs text-slate-500">Business assets · clean execution thread</p>
                  </div>
                  <span className="ml-auto rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">Live</span>
                </div>
                <div className="space-y-3">
                  <Bubble name="Strategist" text="I’m turning the business request into build, safety, offer, and execution tasks." />
                  <Bubble name="Builder" text="I’m checking the project context and identifying what needs to be created, repaired, or packaged." />
                  <Bubble name="Reviewer" text="I’ll verify the result and flag anything risky before approval." />
                </div>
                <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-400">
                  Upload, type, send, or stop — all in one stable chatbox.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-white px-4 py-14 sm:px-6">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight text-slate-950">Simple navigation. No clutter.</h2>
              <p className="mt-3 text-slate-600">The app is organized around the business asset being created: conversation in the center, command box at the bottom, secondary panels around it only when useful.</p>
            </div>
            <div className="mt-8 grid gap-4 md:grid-cols-4">
              {features.map(({ title, text, icon: Icon }) => (
                <article key={title} className="rounded-3xl border border-slate-200 bg-[#f8fafc] p-6">
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
              <h2 className="mt-5 text-4xl font-semibold tracking-tight text-slate-950">Private Growth Engine for business-asset revenue workflows.</h2>
              <p className="mt-4 text-base leading-7 text-slate-600">
                VIBA explains the advertising system publicly but keeps the actual engine behind login. The system is not a shame board. It captures customer demand, qualifies the opportunity, and turns it into private beta-testing, repair, launch-protection, and sellable business assets.
              </p>
              <Link href="/bridge">
                <Button className="mt-7 h-12 rounded-xl bg-slate-950 px-7 text-base text-white hover:bg-slate-800">
                  Open Growth Engine <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {growthSteps.map(({ title, text, icon: Icon }) => (
                <article key={title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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
