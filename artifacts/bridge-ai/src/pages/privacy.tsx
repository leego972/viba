import { Link } from "wouter";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import VibaFooter from "@/components/VibaFooter";

const companyEmail = (import.meta.env.VITE_COMPANY_EMAIL as string | undefined)?.trim() || "Company email coming soon";
const emailReady = companyEmail.includes("@");

const sections = [
  {
    title: "1. Scope",
    body: "This policy explains what data VIBA collects, why, and who it is shared with, across our website and our Android and iOS apps. It does not apply to third-party websites or services you connect to VIBA — their own privacy policies govern that data.",
  },
  {
    title: "2. Data we collect",
    body: "Account data (name, email, authentication credentials); project and session data you create or upload (files, prompts, code, repository contents, task instructions); usage and diagnostic data (feature usage, error logs, performance metrics); and billing data, handled by our payment processor — VIBA does not store full card numbers.",
  },
  {
    title: "3. API keys and credentials you provide",
    body: "If you connect your own API keys or access tokens (for AI providers, GitHub, deployment platforms, or GPU compute providers), those credentials are encrypted at rest and used solely to make requests on your behalf. Your credentials are never shared with other users, never used for anyone else's requests, and never bundled into VIBA as default or shared secrets.",
  },
  {
    title: "4. Third-party AI integrations",
    body: "VIBA is an AI orchestration platform. When you use an AI-powered feature, the relevant portion of your project content, prompts, or files is sent to whichever AI provider you have configured — which may include OpenAI, Anthropic, Google, Perplexity, Mistral, DeepSeek, Groq, Venice AI, GitHub (for repository actions), Vast.ai (for GPU compute), or a custom OpenAI-compatible endpoint you specify. Each provider processes that data under its own privacy policy and terms; we recommend reviewing theirs alongside ours. We do not sell this data, and we limit what we send to what a feature needs to function.",
  },
  {
    title: "5. What VIBA does not do",
    body: "VIBA does not connect you to other users for chat or messaging, does not access your device's SMS messages or call log, and does not collect precise or approximate device location. If this changes for a future feature, this policy will be updated before that feature ships.",
  },
  {
    title: "6. How we use data",
    body: "To provide and operate the platform; to route your requests to the AI and infrastructure providers you've configured; to maintain security, prevent abuse, and debug issues; to process billing; and to communicate service-related notices. We do not use your project content to train models we operate.",
  },
  {
    title: "7. Data retention and deletion",
    body: "We retain account and project data for as long as your account is active, or as needed to provide the service, comply with legal obligations, and resolve disputes. You can request deletion of your account and associated data by contacting us below.",
  },
  {
    title: "8. Security",
    body: "Credentials and sensitive settings are encrypted at rest. Access to production systems is restricted to authorised administrators. No method of storage or transmission is completely secure, and we cannot guarantee absolute security.",
  },
  {
    title: "9. Children's privacy",
    body: "VIBA is not directed at children and is not designed for use by anyone under the age required by applicable law to consent to data processing in their jurisdiction. We do not knowingly collect data from children.",
  },
  {
    title: "10. Your choices",
    body: "You can review, update, or delete your project content and connected credentials at any time from within the app. You can disconnect any AI provider or third-party integration from the Connections page, which stops VIBA from using that credential going forward.",
  },
  {
    title: "11. Changes to this policy",
    body: "We may update this policy as VIBA's features change. Material changes will be reflected here with an updated date, and continued use of VIBA after changes take effect means you accept the revised policy.",
  },
];

export default function Privacy() {
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
            <Lock className="h-3.5 w-3.5" /> Privacy policy
          </div>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">VIBA Privacy Policy</h1>
          <p className="mt-4 text-sm text-slate-500">Last updated: July 16, 2026</p>
          <p className="mt-5 max-w-3xl text-base leading-7 text-slate-600">
            This policy explains what data VIBA collects, how it's used, and how it's shared with the third-party AI and infrastructure providers you choose to connect.
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
            <p className="mt-3 text-sm text-slate-600">For privacy questions or data deletion requests, contact <a className="text-teal-700 hover:underline" href={`mailto:${companyEmail}`}>{companyEmail}</a>.</p>
          ) : (
            <p className="mt-3 text-sm text-slate-600">Company email will be added once created.</p>
          )}
        </section>
      </main>
      <VibaFooter />
    </div>
  );
}
