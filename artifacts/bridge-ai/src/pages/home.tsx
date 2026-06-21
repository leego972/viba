import { Link } from "wouter";
import { ArrowRight, CheckCircle2, FileText, MessageSquare, Paperclip, ShieldCheck, Sparkles } from "lucide-react";
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
                <Sparkles className="h-3.5 w-3.5" /> Multi-agent control room
              </div>
              <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
                A clean AI workspace for serious builds.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
                Give VIBA a task, upload the context, and watch your AI agents coordinate, question each other, write what they are doing, and deliver controlled work without clutter.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/dashboard">
                  <Button className="h-12 rounded-xl bg-slate-950 px-7 text-base text-white hover:bg-slate-800">
                    Start Orchestrating <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/user-instructions">
                  <Button variant="outline" className="h-12 rounded-xl border-slate-200 bg-white px-7 text-base text-slate-800 hover:bg-slate-50">
                    <FileText className="mr-2 h-4 w-4" /> User Instructions
                  </Button>
                </Link>
              </div>
              <div className="mt-8 flex flex-wrap gap-2 text-xs text-slate-500">
                {['Groq default AI', 'ChatGPT-style workflow', 'Upload support', 'Admin-gated source controls'].map((item) => (
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
                    <p className="text-xs text-slate-500">Agents working · clean execution thread</p>
                  </div>
                  <span className="ml-auto rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">Live</span>
                </div>
                <div className="space-y-3">
                  <Bubble name="Strategist" text="I’m breaking the request into build, safety, and UI tasks before assigning work." />
                  <Bubble name="Builder" text="I’m checking the repo structure and identifying which files need to change." />
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
              <p className="mt-3 text-slate-600">The app is organized around the session: conversation in the center, command box at the bottom, secondary panels around it only when useful.</p>
            </div>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
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
