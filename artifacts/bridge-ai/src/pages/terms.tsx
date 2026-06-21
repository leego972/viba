import { Link } from "wouter";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import VibaFooter from "@/components/VibaFooter";

const companyEmail = (import.meta.env.VITE_COMPANY_EMAIL as string | undefined)?.trim() || "Company email coming soon";
const emailReady = companyEmail.includes("@");

const sections = [
  {
    title: "1. Acceptance of terms",
    body: "By accessing or using VIBA, you agree to these Terms and Conditions and any policies referenced here. If you do not agree, you must not use the platform.",
  },
  {
    title: "2. Platform purpose",
    body: "VIBA is an AI orchestration platform that helps users coordinate multiple AI agents, manage project sessions, upload context files, use connected project sandboxes, and receive generated plans, analysis, code assistance, reports, and workflow outputs.",
  },
  {
    title: "3. User accounts and access",
    body: "You are responsible for maintaining the security of your account, login credentials, API keys, connected services, project repositories, uploaded files, and any activity performed through your account. You must provide accurate information and must not access another user’s workspace without permission.",
  },
  {
    title: "4. User content and project materials",
    body: "You retain ownership of content you upload, submit, or connect to VIBA. You grant VIBA the limited rights needed to process, store, display, analyze, transform, and transmit that content for the purpose of providing the service. You are responsible for ensuring you have the rights to upload and use all project files, code, documents, media, prompts, and repository materials.",
  },
  {
    title: "5. AI-generated outputs",
    body: "VIBA uses artificial intelligence systems that may produce incorrect, incomplete, or unsuitable outputs. You are responsible for reviewing, testing, validating, and approving outputs before relying on them, publishing them, deploying them, merging code, or using them commercially.",
  },
  {
    title: "6. Project sandbox and repository use",
    body: "Users may connect and control only their own project sandboxes, repositories, branches, files, and deployment environments. You must not use VIBA to access, modify, test, scan, or deploy against systems that you do not own or have explicit authority to use.",
  },
  {
    title: "7. VIBA source controls and admin-only functions",
    body: "Controls that affect VIBA’s own source code, self-repair system, self-upgrade system, checkpoints, maintenance runs, pull requests, and merge actions are restricted to authorised administrators. Normal users are not permitted to trigger or control VIBA source-repository operations.",
  },
  {
    title: "8. Prohibited uses",
    body: "You must not use VIBA for illegal activity, abusive conduct, credential theft, unauthorised access, privacy invasion, malware deployment, harassment, impersonation, rights infringement, non-consensual intimate content, exploitation of minors, or any activity that violates applicable law or third-party rights.",
  },
  {
    title: "9. Billing and subscriptions",
    body: "Paid features, subscriptions, usage credits, and billing terms are presented at purchase or within the billing area of the platform. Fees are payable as stated. Access to paid features may be suspended if payment fails, credits are exhausted, or the account breaches these Terms.",
  },
  {
    title: "10. Third-party services",
    body: "VIBA may connect to third-party AI providers, code repositories, deployment platforms, payment processors, email providers, and infrastructure services. Your use of those services may also be governed by their separate terms, policies, rate limits, and fees.",
  },
  {
    title: "11. Availability and changes",
    body: "VIBA may change, suspend, improve, restrict, or discontinue features at any time. We may perform maintenance, patch security issues, and modify the platform to improve reliability, safety, or compliance.",
  },
  {
    title: "12. Disclaimers",
    body: "The platform is provided on an as-is and as-available basis. To the maximum extent permitted by law, VIBA disclaims warranties of merchantability, fitness for a particular purpose, non-infringement, uninterrupted availability, and error-free operation.",
  },
  {
    title: "13. Limitation of liability",
    body: "To the maximum extent permitted by law, VIBA and its operators will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, including loss of profits, data, goodwill, business opportunity, deployment stability, or project outcomes arising from use of the platform.",
  },
  {
    title: "14. Indemnity",
    body: "You agree to defend, indemnify, and hold harmless VIBA and its operators from claims, losses, liabilities, damages, costs, and expenses arising from your use of the platform, your content, your connected projects, your breach of these Terms, or your violation of law or third-party rights.",
  },
  {
    title: "15. Updates to these terms",
    body: "We may update these Terms from time to time. Continued use of VIBA after updates take effect means you accept the revised Terms.",
  },
];

export default function Terms() {
  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-950">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <img src="/viba-logo.png" alt="VIBA" className="h-9 w-auto object-contain" />
          </Link>
          <Link href="/">
            <Button variant="outline" className="border-slate-200 bg-white"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_24px_90px_rgba(15,23,42,0.08)] sm:p-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Legal terms
          </div>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">VIBA Terms and Conditions</h1>
          <p className="mt-4 text-sm text-slate-500">Last updated: June 22, 2026</p>
          <p className="mt-5 max-w-3xl text-base leading-7 text-slate-600">
            These Terms govern access to and use of VIBA, including its AI orchestration, project sandboxing, file upload, automation, and admin-controlled maintenance features.
          </p>
        </section>

        <section className="mt-8 space-y-4">
          {sections.map((section) => (
            <article key={section.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">{section.title}</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">{section.body}</p>
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Contact</h2>
          {emailReady ? (
            <p className="mt-3 text-sm text-slate-600">For legal or support questions, contact <a className="text-teal-700 hover:underline" href={`mailto:${companyEmail}`}>{companyEmail}</a>.</p>
          ) : (
            <p className="mt-3 text-sm text-slate-600">Company email will be added once created.</p>
          )}
        </section>
      </main>
      <VibaFooter />
    </div>
  );
}
