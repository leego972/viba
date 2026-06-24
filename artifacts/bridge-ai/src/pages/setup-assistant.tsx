import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clipboard,
  Database,
  Globe2,
  KeyRound,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

type SetupMode = "railway" | "generic";
type BillingMode = "none" | "stripe-test" | "stripe-live";

type Step = {
  id: string;
  group: string;
  title: string;
  detail: string;
  required: boolean;
};

const railwayCoreVars = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "PUBLIC_ORIGIN",
  "ACCESS_TOKEN",
  "CREDENTIAL_ENCRYPTION_KEY",
];

const smtpVars = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"];

const stripeVars = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID",
  "STRIPE_BILLING_SUBSCRIPTION_PRICE_ID",
  "STRIPE_BILLING_PRO_SUBSCRIPTION_PRICE_ID",
  "STRIPE_BILLING_CREDITS_1000_PRICE_ID",
  "STRIPE_BILLING_CREDITS_2000_PRICE_ID",
  "STRIPE_BILLING_CREDITS_3000_PRICE_ID",
  "STRIPE_BILLING_CREDITS_4000_PRICE_ID",
  "STRIPE_BILLING_CREDITS_5000_PRICE_ID",
  "STRIPE_BILLING_CREDITS_6000_PRICE_ID",
];

const priceMap = [
  ["VIBA Member Monthly", "$50 USD/month", "STRIPE_BILLING_SUBSCRIPTION_PRICE_ID and STRIPE_PRICE_ID"],
  ["VIBA Pro Monthly", "$150 USD/month", "STRIPE_BILLING_PRO_SUBSCRIPTION_PRICE_ID"],
  ["VIBA 1,000 Credit Pack", "$50 USD one-time", "STRIPE_BILLING_CREDITS_1000_PRICE_ID"],
  ["VIBA 2,000 Credit Pack", "$100 USD one-time", "STRIPE_BILLING_CREDITS_2000_PRICE_ID"],
  ["VIBA 3,000 Credit Pack", "$150 USD one-time", "STRIPE_BILLING_CREDITS_3000_PRICE_ID"],
  ["VIBA 4,000 Credit Pack", "$200 USD one-time", "STRIPE_BILLING_CREDITS_4000_PRICE_ID"],
  ["VIBA 5,000 Credit Pack", "$250 USD one-time", "STRIPE_BILLING_CREDITS_5000_PRICE_ID"],
  ["VIBA 6,000 Credit Pack", "$300 USD one-time", "STRIPE_BILLING_CREDITS_6000_PRICE_ID"],
] as const;

function buildSteps(mode: SetupMode, billing: BillingMode, domain: string): Step[] {
  const steps: Step[] = [
    { id: "db", group: "Core", title: "Attach production database", detail: mode === "railway" ? "Create or attach a Railway Postgres service, then use its DATABASE_URL variable in the VIBA service." : "Provision a Postgres database and set DATABASE_URL in your hosting platform.", required: true },
    { id: "secrets", group: "Core", title: "Generate internal app secrets", detail: "Generate SESSION_SECRET, ACCESS_TOKEN, and CREDENTIAL_ENCRYPTION_KEY with 48+ random bytes. Do not reuse keys between environments.", required: true },
    { id: "origin", group: "Core", title: "Set PUBLIC_ORIGIN", detail: `Set PUBLIC_ORIGIN to https://${domain || "your-domain.com"}. Use the Railway temporary domain first if custom DNS is not active yet.`, required: true },
    { id: "smtp", group: "Email", title: "Configure SMTP", detail: "Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM if email verification/password reset should work at launch.", required: false },
    { id: "health", group: "Launch", title: "Deploy and healthcheck", detail: "Deploy from main, then verify /api/healthz returns HTTP 200 before testing billing or domain changes.", required: true },
    { id: "smoke", group: "Launch", title: "Run production smoke test", detail: "Test public pages, auth, dashboard, sessions, providers, Doctor, reports, share links, owner actions, and setup assistant.", required: true },
  ];

  if (billing !== "none") {
    steps.splice(4, 0,
      { id: "stripe-products", group: "Billing", title: "Create Stripe products and prices", detail: "Create the Member, Pro, and credit-pack prices in Stripe. Copy only the resulting price IDs into hosting variables.", required: true },
      { id: "stripe-keys", group: "Billing", title: "Add Stripe API keys", detail: billing === "stripe-live" ? "Use live Stripe keys only after owner approval. Prefer test mode first." : "Use Stripe test mode keys first. Secret key starts with sk_test; publishable key starts with pk_test.", required: true },
      { id: "stripe-webhook", group: "Billing", title: "Create Stripe webhook", detail: `Create endpoint https://${domain || "your-domain.com"}/api/stripe/webhook and copy the signing secret into STRIPE_WEBHOOK_SECRET.`, required: true },
    );
  }
  return steps;
}

function Section({ title, icon: Icon, children, note }: { title: string; icon: React.ElementType; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-semibold">{title}</h2>
          {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function CodeBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="space-y-2">
      <pre className="overflow-x-auto rounded-xl border border-white/[0.08] bg-black/30 p-4 text-xs text-zinc-100"><code>{text}</code></pre>
      <Button type="button" size="sm" variant="outline" onClick={copy} className="gap-2">
        {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Clipboard className="h-4 w-4" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export default function SetupAssistant() {
  const [mode, setMode] = useState<SetupMode>("railway");
  const [billing, setBilling] = useState<BillingMode>("stripe-test");
  const [domain, setDomain] = useState("viba.guru");
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const steps = useMemo(() => buildSteps(mode, billing, domain.trim()), [mode, billing, domain]);
  const done = steps.filter((step) => checked[step.id]).length;

  const secretCommands = `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"\nnode -e "console.log(require('crypto').randomBytes(48).toString('base64'))"\nnode -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`;

  const railwayTemplate = [
    ...railwayCoreVars.map((key) => `${key}=<set-in-hosting-dashboard>`),
    "",
    "# Optional email",
    ...smtpVars.map((key) => `${key}=<set-if-email-is-enabled>`),
    "",
    billing === "none" ? "# Stripe disabled for this setup" : "# Stripe billing",
    ...(billing === "none" ? [] : stripeVars.map((key) => `${key}=<copy-from-stripe-or-price-catalog>`)),
  ].join("\n");

  const webhookUrl = `https://${domain.trim() || "your-domain.com"}/api/stripe/webhook`;

  const groups = Array.from(new Set(steps.map((step) => step.group)));

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/owner-actions" className="text-sm text-muted-foreground hover:text-foreground">← Owner actions</Link>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                <ShieldCheck className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Setup Assistant</h1>
                <p className="text-sm text-muted-foreground">A reusable launch wizard for Railway, Stripe, email, domain, secrets, and smoke testing.</p>
              </div>
            </div>
          </div>
          <Badge variant="outline">{done}/{steps.length} complete</Badge>
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">This assistant never asks users to paste secret values into VIBA.</p>
              <p className="mt-1 text-xs text-amber-100/80">It generates safe instructions and variable names only. Secrets belong in Railway, Stripe, or the user's hosting dashboard.</p>
            </div>
          </div>
        </div>

        <Section title="1. Configure setup plan" icon={ShieldCheck} note="Choose the user's hosting style, billing mode, and domain. These settings only change the checklist and templates.">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Hosting</span>
              <select value={mode} onChange={(event) => setMode(event.target.value as SetupMode)} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm outline-none">
                <option value="railway">Railway</option>
                <option value="generic">Generic hosting</option>
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Billing</span>
              <select value={billing} onChange={(event) => setBilling(event.target.value as BillingMode)} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm outline-none">
                <option value="none">No billing yet</option>
                <option value="stripe-test">Stripe test mode</option>
                <option value="stripe-live">Stripe live mode</option>
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Domain</span>
              <input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="viba.guru" className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm outline-none" />
            </label>
          </div>
        </Section>

        <Section title="2. Checklist" icon={CheckCircle2} note="Each user can follow this list for their own deployment. Progress is local to the browser session.">
          <div className="space-y-5">
            {groups.map((group) => (
              <div key={group} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
                {steps.filter((step) => step.group === group).map((step) => {
                  const isDone = Boolean(checked[step.id]);
                  return (
                    <button key={step.id} onClick={() => setChecked((current) => ({ ...current, [step.id]: !isDone }))} className="flex w-full items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-left transition hover:bg-white/[0.05]">
                      {isDone ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />}
                      <span className="flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium">{step.title}{step.required && <Badge variant="outline" className="text-[10px]">required</Badge>}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{step.detail}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </Section>

        <Section title="3. Generate app secrets outside the app" icon={KeyRound} note="Run these in a trusted shell. Use one output for SESSION_SECRET, one for ACCESS_TOKEN, and one for CREDENTIAL_ENCRYPTION_KEY.">
          <CodeBox text={secretCommands} />
        </Section>

        <Section title="4. Railway / hosting variable template" icon={Database} note="Copy the names and replace placeholders in Railway or the user's hosting dashboard. The template intentionally contains no real secrets.">
          <CodeBox text={railwayTemplate} />
        </Section>

        <Section title="5. Stripe price map" icon={WalletCards} note="Create these Stripe prices, then copy the resulting price_ IDs into the matching variables.">
          <div className="grid gap-2">
            {priceMap.map(([product, price, env]) => (
              <div key={env} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-sm">
                <p className="font-medium">{product}</p>
                <p className="text-xs text-muted-foreground">{price}</p>
                <p className="mt-1 font-mono text-xs text-primary">{env}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="6. Webhook and domain" icon={Globe2} note="Do domain first, then webhook once HTTPS works.">
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <p className="font-medium text-foreground">Webhook endpoint</p>
              <p className="mt-1 font-mono text-xs text-foreground">{webhookUrl}</p>
              <p className="mt-2 text-xs">Stripe events: checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, invoice.payment_succeeded, invoice.payment_failed.</p>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <p className="font-medium text-foreground">Domain setup</p>
              <p className="mt-1 text-xs">In Railway: Service → Settings → Networking → Custom Domain → add {domain || "your domain"}. Railway shows the exact DNS target. Add that DNS record in the domain provider. Use ALIAS/ANAME/CNAME flattening for the root domain where supported; use CNAME for www.</p>
            </div>
          </div>
        </Section>
      </div>
    </AppLayout>
  );
}
