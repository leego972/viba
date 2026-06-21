import { Link } from "wouter";
import { ArrowRight, CheckCircle2, GitBranch, MessageSquare, Paperclip, Play, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const steps = [
  {
    title: "Start with one clear goal",
    body: "Tell VIBA exactly what you want built, checked, repaired, researched, or planned. Use plain language. Better input gives better delegation.",
    icon: MessageSquare,
  },
  {
    title: "Add files when context matters",
    body: "Upload screenshots, documents, zip files, logs, PDFs, specs, or code notes. VIBA uses them as working context for the agents.",
    icon: Paperclip,
  },
  {
    title: "Connect your project sandbox",
    body: "Set the project repo, branch, and environment for the work you own. Users control their own sandbox only; VIBA source controls stay admin-only.",
    icon: GitBranch,
  },
  {
    title: "Let the agents show their work",
    body: "Watch the live thread. Agents should state what they are doing, ask each other questions, hand off tasks, and surface decisions as they go.",
    icon: Sparkles,
  },
  {
    title: "Approve sensitive actions",
    body: "If an agent needs permission for a risky or important step, approve or reject it. Approval gates keep the workflow controlled.",
    icon: ShieldCheck,
  },
  {
    title: "Export or continue the session",
    body: "When the result is useful, export the transcript or fork the session into a follow-up task. This keeps work organized.",
    icon: CheckCircle2,
  },
];

const examples = [
  "Audit this website build and tell me what will break on Railway.",
  "Use the uploaded zip, find missing backend pieces, and create a repair plan.",
  "Review this repo structure and tell each agent what to improve.",
  "Compare these screenshots and design a cleaner app interface.",
];

export default function UserInstructions() {
  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <img src="/viba-logo.png" alt="VIBA" className="h-9 w-auto object-contain" />
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/dashboard"><Button variant="outline" className="border-slate-200 bg-white">Dashboard</Button></Link>
            <Link href="/sessions/new"><Button className="bg-slate-950 text-white hover:bg-slate-800">Start</Button></Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_24px_90px_rgba(15,23,42,0.08)] sm:p-10">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">
              <Play className="h-3.5 w-3.5" /> User instructions
            </div>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">How to get the full benefit from VIBA</h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
              VIBA works best when you treat it like a professional AI project room: give a clear goal, attach useful context, watch the agents coordinate, and approve important actions only when you are satisfied.
            </p>
          </div>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {steps.map(({ title, body, icon: Icon }, index) => (
            <article key={title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-800">
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-xs font-semibold text-slate-400">STEP {index + 1}</span>
              </div>
              <h2 className="mt-5 text-lg font-semibold text-slate-950">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
            </article>
          ))}
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-950">Good prompts to start with</h2>
            <div className="mt-4 space-y-3">
              {examples.map((example) => (
                <div key={example} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  “{example}”
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-950">Use it properly</h2>
            <div className="mt-4 space-y-4 text-sm leading-6 text-slate-600">
              <p><strong className="text-slate-950">Be specific.</strong> Say what the final output should be: report, patch plan, code, checklist, launch audit, UI design, or deployment diagnosis.</p>
              <p><strong className="text-slate-950">Upload evidence.</strong> Logs, screenshots, repos, and specs reduce guessing.</p>
              <p><strong className="text-slate-950">Read the live thread.</strong> The point of VIBA is watching agents work, challenge each other, and show progress.</p>
              <p><strong className="text-slate-950">Keep control.</strong> Approve only actions you understand. Admin-only VIBA source controls are separate from normal user project work.</p>
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href="/sessions/new">
                <Button className="h-11 bg-slate-950 text-white hover:bg-slate-800">
                  Start a session <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/dashboard">
                <Button variant="outline" className="h-11 border-slate-200 bg-white">Open dashboard</Button>
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
