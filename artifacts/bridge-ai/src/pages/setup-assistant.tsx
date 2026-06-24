import { useState } from "react";
  import { Link } from "wouter";
  import { AppLayout } from "@/components/layout/AppLayout";
  import { Badge } from "@/components/ui/badge";
  import { Button } from "@/components/ui/button";
  import {
    AlertTriangle, CheckCircle2, Circle, Clipboard, Database, Globe2,
    KeyRound, ShieldCheck, WalletCards, Rocket, Mail, Server, FlaskConical,
    ChevronRight, Loader2,
  } from "lucide-react";

  type Tab = "guided" | "paid" | "runner" | "railway" | "stripe" | "smtp" | "domain" | "smoke";
  type SetupMode = "railway" | "generic";
  type BillingMode = "none" | "stripe-test" | "stripe-live";

  type Step = { id: string; group: string; title: string; detail: string; required: boolean };

  const railwayCoreVars = ["DATABASE_URL","SESSION_SECRET","PUBLIC_ORIGIN","ACCESS_TOKEN","CREDENTIAL_ENCRYPTION_KEY"];
  const smtpVars = ["SMTP_HOST","SMTP_PORT","SMTP_USER","SMTP_PASS","SMTP_FROM"];
  const stripeVars = ["STRIPE_SECRET_KEY","STRIPE_PUBLISHABLE_KEY","STRIPE_WEBHOOK_SECRET","STRIPE_PRICE_ID","STRIPE_BILLING_SUBSCRIPTION_PRICE_ID","STRIPE_BILLING_PRO_SUBSCRIPTION_PRICE_ID","STRIPE_BILLING_CREDITS_1000_PRICE_ID","STRIPE_BILLING_CREDITS_2000_PRICE_ID","STRIPE_BILLING_CREDITS_3000_PRICE_ID","STRIPE_BILLING_CREDITS_4000_PRICE_ID","STRIPE_BILLING_CREDITS_5000_PRICE_ID","STRIPE_BILLING_CREDITS_6000_PRICE_ID","STRIPE_BILLING_LAUNCH_SETUP_PRICE_ID"];
  const priceMap = [
    ["VIBA Member Monthly","$50 USD/month","STRIPE_BILLING_SUBSCRIPTION_PRICE_ID and STRIPE_PRICE_ID"],
    ["VIBA Pro Monthly","$150 USD/month","STRIPE_BILLING_PRO_SUBSCRIPTION_PRICE_ID"],
    ["VIBA Launch Setup","$299 USD one-time","STRIPE_BILLING_LAUNCH_SETUP_PRICE_ID"],
    ["VIBA 1,000 Credits","$50 one-time","STRIPE_BILLING_CREDITS_1000_PRICE_ID"],
    ["VIBA 2,000 Credits","$100 one-time","STRIPE_BILLING_CREDITS_2000_PRICE_ID"],
    ["VIBA 3,000 Credits","$150 one-time","STRIPE_BILLING_CREDITS_3000_PRICE_ID"],
  ] as const;

  function buildSteps(mode: SetupMode, billing: BillingMode, domain: string): Step[] {
    const steps: Step[] = [
      { id:"db",group:"Core",title:"Attach production database",detail:mode==="railway"?"Create or attach a Railway Postgres service, then use its DATABASE_URL variable.":"Provision a Postgres database and set DATABASE_URL.",required:true },
      { id:"secrets",group:"Core",title:"Generate internal app secrets",detail:"Generate SESSION_SECRET, ACCESS_TOKEN, and CREDENTIAL_ENCRYPTION_KEY with 48+ random bytes each.",required:true },
      { id:"origin",group:"Core",title:"Set PUBLIC_ORIGIN",detail:`Set PUBLIC_ORIGIN to https://${domain||"your-domain.com"}. Use Railway temporary domain first if custom DNS is not active.`,required:true },
      { id:"smtp",group:"Email",title:"Configure SMTP",detail:"Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM for email verification and password reset.",required:false },
      { id:"health",group:"Launch",title:"Deploy and healthcheck",detail:"Deploy from main, then verify /api/healthz returns HTTP 200 before testing billing or domain changes.",required:true },
      { id:"smoke",group:"Launch",title:"Run production smoke test",detail:"Test public pages, auth, dashboard, sessions, providers, Doctor, reports, share links, owner actions, and setup assistant.",required:true },
    ];
    if (billing!=="none") {
      steps.splice(4,0,
        { id:"stripe-products",group:"Billing",title:"Create Stripe products and prices",detail:"Create the Member, Pro, Launch Setup, and credit-pack prices in Stripe dashboard. Copy only the resulting price IDs into hosting variables.",required:true },
        { id:"stripe-keys",group:"Billing",title:"Add Stripe API keys",detail:billing==="stripe-live"?"Use live Stripe keys only after owner approval. Prefer test mode first.":"Use test mode keys first. Secret key starts with sk_test; publishable key starts with pk_test.",required:true },
        { id:"stripe-webhook",group:"Billing",title:"Create Stripe webhook",detail:`Create endpoint https://${domain||"your-domain.com"}/api/stripe/webhook and copy the signing secret into STRIPE_WEBHOOK_SECRET.`,required:true },
      );
    }
    return steps;
  }

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id:"guided", label:"Guided Setup", icon:CheckCircle2 },
    { id:"paid", label:"Paid Launch", icon:WalletCards },
    { id:"runner", label:"Setup Runner", icon:Rocket },
    { id:"railway", label:"Railway", icon:Server },
    { id:"stripe", label:"Stripe", icon:WalletCards },
    { id:"smtp", label:"SMTP", icon:Mail },
    { id:"domain", label:"Domain", icon:Globe2 },
    { id:"smoke", label:"Smoke Test", icon:FlaskConical },
  ];

  const CONFIRM_TEXT = "CONFIRM RAILWAY SETUP";

  type DryRunResult = { dryRun: boolean; railwayTokenConfigured: boolean; variablesProvided: string[]; variablesRejected: string[]; missingRequired: string[]; willGenerate: string[]; readyToApply: boolean };
  type ApplyResult = { applied: boolean; appliedCount: number; variables: { key: string; status: string; redacted: string }[]; generated: string[]; valuesReturned: boolean; domainAction: string; domainGuidance: string[]; nextSteps: string[] };

  function VarList({ vars }: { vars: string[] }) {
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {vars.map((v) => <code key={v} className="rounded bg-white/[0.06] px-2 py-0.5 text-xs text-sky-300">{v}</code>)}
      </div>
    );
  }

  function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {children}
      </div>
    );
  }

  function GuidedTab() {
    const [mode, setMode] = useState<SetupMode>("railway");
    const [billing, setBilling] = useState<BillingMode>("stripe-test");
    const [domain, setDomain] = useState("viba.guru");
    const [checked, setChecked] = useState<Record<string, boolean>>({});
    const steps = buildSteps(mode, billing, domain);
    const groups = [...new Set(steps.map((s) => s.group))];
    const done = steps.filter((s) => checked[s.id]).length;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap gap-3">
          <div className="flex rounded-lg border border-white/[0.08] overflow-hidden">
            {(["railway","generic"] as SetupMode[]).map((m) => (
              <button key={m} onClick={()=>setMode(m)} className={`px-4 py-2 text-xs font-medium transition ${mode===m?"bg-white/[0.12] text-white":"text-muted-foreground hover:bg-white/[0.06]"}`}>{m==="railway"?"Railway":"Generic"}</button>
            ))}
          </div>
          <div className="flex rounded-lg border border-white/[0.08] overflow-hidden">
            {([["none","No billing"],["stripe-test","Stripe test"],["stripe-live","Stripe live"]] as [BillingMode,string][]).map(([b,label]) => (
              <button key={b} onClick={()=>setBilling(b)} className={`px-4 py-2 text-xs font-medium transition ${billing===b?"bg-white/[0.12] text-white":"text-muted-foreground hover:bg-white/[0.06]"}`}>{label}</button>
            ))}
          </div>
          <input value={domain} onChange={(e)=>setDomain(e.target.value)} placeholder="your-domain.com" className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-white placeholder:text-muted-foreground outline-none focus:border-white/20" />
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline">{done}/{steps.length} complete</Badge>
          <span className="text-xs text-muted-foreground">Click a step to toggle</span>
        </div>
        {groups.map((group) => (
          <section key={group} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
            {steps.filter((s) => s.group===group).map((item) => {
              const isDone = Boolean(checked[item.id]);
              return (
                <button key={item.id} onClick={()=>setChecked((c)=>({...c,[item.id]:!isDone}))} className="flex w-full items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-left transition hover:bg-white/[0.05]">
                  {isDone ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400"/> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"/>}
                  <span className="flex-1">
                    <span className="block text-sm font-medium">{item.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span>
                    {!item.required && <Badge className="mt-2" variant="outline">Optional</Badge>}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    );
  }

  function PaidTab() {
    return (
      <div className="space-y-6">
        <SectionCard title="VIBA Launch Setup — $299 one-time">
          <p className="text-sm text-muted-foreground">A guided setup service where you hand off your Railway project IDs and domain, and VIBA wires up your production environment variables, generates your core secrets, and verifies your domain configuration.</p>
          <p className="text-xs text-muted-foreground">Owners use the Setup Runner tab to run this themselves for free. This product is offered to customers who want done-for-you onboarding.</p>
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-4">
            <p className="text-xs font-semibold text-white mb-2">Stripe env var to configure:</p>
            <code className="text-xs text-sky-300">STRIPE_BILLING_LAUNCH_SETUP_PRICE_ID</code>
          </div>
        </SectionCard>
        <SectionCard title="Stripe price reference">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="pb-2 pr-4 font-medium">Product</th><th className="pb-2 pr-4 font-medium">Price</th><th className="pb-2 font-medium">Env var</th></tr></thead>
            <tbody>
              {priceMap.map(([name,price,env]) => (
                <tr key={env} className="border-t border-white/[0.05]">
                  <td className="py-2 pr-4 text-white">{name}</td>
                  <td className="py-2 pr-4 text-emerald-400">{price}</td>
                  <td className="py-2"><code className="text-sky-300">{env}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      </div>
    );
  }

  function RunnerTab() {
    const [projectId, setProjectId] = useState("");
    const [environmentId, setEnvironmentId] = useState("");
    const [serviceId, setServiceId] = useState("");
    const [publicOrigin, setPublicOrigin] = useState("");
    const [domain, setDomain] = useState("viba.guru");
    const [adminToken, setAdminToken] = useState("");
    const [confirmText, setConfirmText] = useState("");
    const [generateSecrets, setGenerateSecrets] = useState(true);
    const [skipDeploys, setSkipDeploys] = useState(true);
    const [vars, setVars] = useState<Record<string, string>>({ DATABASE_URL:"", SMTP_HOST:"", SMTP_PORT:"465", SMTP_USER:"", SMTP_PASS:"", SMTP_FROM:"", STRIPE_SECRET_KEY:"", STRIPE_PUBLISHABLE_KEY:"", STRIPE_WEBHOOK_SECRET:"", STRIPE_BILLING_LAUNCH_SETUP_PRICE_ID:"" });

    const [dryResult, setDryResult] = useState<DryRunResult|null>(null);
    const [applyResult, setApplyResult] = useState<ApplyResult|null>(null);
    const [loading, setLoading] = useState<"dry"|"apply"|null>(null);
    const [error, setError] = useState<string|null>(null);

    const canApply = confirmText === CONFIRM_TEXT;
    const filteredVars = Object.fromEntries(Object.entries(vars).filter(([,v]) => v.trim()));

    async function runDry() {
      setLoading("dry"); setError(null); setDryResult(null); setApplyResult(null);
      try {
        const res = await fetch("/api/setup/dry-run", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ railwayProjectId:projectId, railwayEnvironmentId:environmentId, railwayServiceId:serviceId, variables:filteredVars, generateMissingCoreSecrets:generateSecrets }) });
        setDryResult(await res.json() as DryRunResult);
      } catch(e) { setError(e instanceof Error ? e.message : "Dry-run failed"); }
      setLoading(null);
    }

    async function runApply() {
      if (!canApply) return;
      setLoading("apply"); setError(null); setApplyResult(null);
      try {
        const res = await fetch("/api/setup/apply", {
          method:"POST",
          headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${adminToken}`, "X-Admin-Confirm":"true" },
          body:JSON.stringify({ railwayProjectId:projectId, railwayEnvironmentId:environmentId, railwayServiceId:serviceId, publicOrigin, domain, variables:filteredVars, generateMissingCoreSecrets:generateSecrets, skipDeploys, replace:false, confirmText }),
        });
        const data = await res.json() as ApplyResult & { error?: string; message?: string };
        if (!res.ok) { setError(data.message ?? data.error ?? "Apply failed"); }
        else { setApplyResult(data); }
      } catch(e) { setError(e instanceof Error ? e.message : "Apply failed"); }
      setLoading(null);
    }

    function Field({ label, value, onChange, placeholder, type="text" }: { label:string; value:string; onChange:(v:string)=>void; placeholder?:string; type?:string }) {
      return (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">{label}</label>
          <input type={type} value={value} onChange={(e)=>onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-white placeholder:text-muted-foreground outline-none focus:border-white/20" />
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-xs text-amber-300 flex items-start gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5"/>Owner-only tool. Values are not saved to localStorage or sent anywhere except the VIBA API on Apply. RAILWAY_TOKEN is read server-side only.</p>
        </div>

        <SectionCard title="Railway IDs">
          <Field label="Project ID" value={projectId} onChange={setProjectId} placeholder="proj-..." />
          <Field label="Environment ID" value={environmentId} onChange={setEnvironmentId} placeholder="env-..." />
          <Field label="Service ID" value={serviceId} onChange={setServiceId} placeholder="svc-..." />
        </SectionCard>

        <SectionCard title="Domain">
          <Field label="Domain" value={domain} onChange={setDomain} placeholder="viba.guru" />
          <Field label="PUBLIC_ORIGIN" value={publicOrigin} onChange={setPublicOrigin} placeholder="https://viba.guru" />
        </SectionCard>

        <SectionCard title="Variables to set">
          {Object.keys(vars).map((key) => (
            <Field key={key} label={key} value={vars[key]} onChange={(v)=>setVars((prev)=>({...prev,[key]:v}))} placeholder={key.includes("SECRET")||key.includes("KEY")||key.includes("PASS") ? "(leave blank to skip)" : ""} />
          ))}
          <div className="flex items-center gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={generateSecrets} onChange={(e)=>setGenerateSecrets(e.target.checked)} className="rounded" />
              Auto-generate missing core secrets (SESSION_SECRET, ACCESS_TOKEN, CREDENTIAL_ENCRYPTION_KEY)
            </label>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={skipDeploys} onChange={(e)=>setSkipDeploys(e.target.checked)} className="rounded" />
              Skip Railway deploys after variable update (recommended — deploy manually after verifying)
            </label>
          </div>
        </SectionCard>

        <div className="flex gap-3">
          <Button variant="outline" onClick={runDry} disabled={loading!==null}>
            {loading==="dry" ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/>Running…</> : "Dry Run"}
          </Button>
        </div>

        {dryResult && (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white">Dry-run result</h3>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">RAILWAY_TOKEN configured:</span>
              {dryResult.railwayTokenConfigured ? <CheckCircle2 className="h-4 w-4 text-emerald-400"/> : <AlertTriangle className="h-4 w-4 text-amber-400"/>}
              <span className={dryResult.railwayTokenConfigured?"text-emerald-400":"text-amber-400"}>{dryResult.railwayTokenConfigured?"Yes":"No — add RAILWAY_TOKEN to server env first"}</span>
            </div>
            {dryResult.variablesProvided.length > 0 && <div><p className="text-xs text-muted-foreground mb-1">Will set:</p><VarList vars={dryResult.variablesProvided}/></div>}
            {dryResult.willGenerate.length > 0 && <div><p className="text-xs text-muted-foreground mb-1">Will auto-generate:</p><VarList vars={dryResult.willGenerate}/></div>}
            {dryResult.variablesRejected.length > 0 && <div><p className="text-xs text-amber-400 mb-1">Rejected (not allowlisted):</p><VarList vars={dryResult.variablesRejected}/></div>}
            {dryResult.missingRequired.length > 0 && <div><p className="text-xs text-red-400 mb-1">Missing required vars:</p><VarList vars={dryResult.missingRequired}/></div>}
            <p className="text-xs text-muted-foreground">railwayCallMade: false | valuesReturned: false</p>
          </div>
        )}

        <SectionCard title="Apply Setup (owner only)">
          <Field label="Admin token (for this request only — not saved)" value={adminToken} onChange={setAdminToken} type="password" placeholder="Your ADMIN_TOKEN" />
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">Type exactly to enable Apply: <code className="text-amber-300">{CONFIRM_TEXT}</code></label>
            <input value={confirmText} onChange={(e)=>setConfirmText(e.target.value)} placeholder={CONFIRM_TEXT} className={`w-full rounded-lg border px-3 py-2 text-xs text-white outline-none ${canApply?"border-emerald-500/50 bg-emerald-500/5":"border-white/[0.08] bg-white/[0.03]"} placeholder:text-muted-foreground focus:border-white/20`} />
          </div>
          <Button onClick={runApply} disabled={!canApply||loading!==null} className={`${canApply?"bg-emerald-600 hover:bg-emerald-700":"opacity-50"}`}>
            {loading==="apply" ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/>Applying…</> : "Apply Setup"}
          </Button>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </SectionCard>

        {applyResult && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-emerald-400">Applied ✓ {applyResult.appliedCount} variables</h3>
            <p className="text-xs text-muted-foreground">valuesReturned: false — no secret values were returned</p>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Variable status:</p>
              <div className="space-y-1">
                {applyResult.variables.map((v) => (
                  <div key={v.key} className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400"/>
                    <code className="text-sky-300">{v.key}</code>
                    <span className="text-muted-foreground">— {v.status} ({v.redacted})</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-white mb-1">Domain:</p>
              {applyResult.domainGuidance.map((line,i) => <p key={i} className="text-xs text-muted-foreground">{line}</p>)}
            </div>
            <div>
              <p className="text-xs font-medium text-white mb-1">Next steps:</p>
              {applyResult.nextSteps.map((step,i) => <p key={i} className="text-xs text-muted-foreground flex gap-2"><ChevronRight className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-400"/>{step}</p>)}
            </div>
          </div>
        )}
      </div>
    );
  }

  function RailwayTab() {
    return (
      <div className="space-y-4">
        <SectionCard title="Required env vars"><VarList vars={["DATABASE_URL","SESSION_SECRET","PUBLIC_ORIGIN","ACCESS_TOKEN","CREDENTIAL_ENCRYPTION_KEY"]}/></SectionCard>
        <SectionCard title="Steps">
          {["Create Railway project and add Postgres service.","Copy DATABASE_URL from the Postgres service into your VIBA service variables.","Generate SESSION_SECRET, ACCESS_TOKEN, CREDENTIAL_ENCRYPTION_KEY with 48+ random bytes each.","Set PUBLIC_ORIGIN to your domain (use Railway temp domain first).","Deploy from main branch. Verify /api/healthz returns 200.","Add custom domain in Railway dashboard. Update PUBLIC_ORIGIN after DNS propagates."].map((s,i) => (
            <p key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-sky-300 font-mono shrink-0">{i+1}.</span>{s}</p>
          ))}
        </SectionCard>
      </div>
    );
  }

  function StripeTab() {
    return (
      <div className="space-y-4">
        <SectionCard title="Required env vars"><VarList vars={["STRIPE_SECRET_KEY","STRIPE_PUBLISHABLE_KEY","STRIPE_WEBHOOK_SECRET","STRIPE_PRICE_ID"]}/></SectionCard>
        <SectionCard title="Stripe product setup">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="pb-2 pr-4 font-medium">Product</th><th className="pb-2 pr-4 font-medium">Price</th><th className="pb-2 font-medium">Env var</th></tr></thead>
            <tbody>
              {priceMap.map(([name,price,env]) => (
                <tr key={env} className="border-t border-white/[0.05]">
                  <td className="py-2 pr-4 text-white">{name}</td>
                  <td className="py-2 pr-4 text-emerald-400">{price}</td>
                  <td className="py-2"><code className="text-sky-300 text-[10px]">{env}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
        <SectionCard title="Webhook">
          <p className="text-xs text-muted-foreground">Create endpoint: <code className="text-sky-300">https://your-domain.com/api/stripe/webhook</code></p>
          <p className="text-xs text-muted-foreground mt-1">Events to enable: <code className="text-sky-300">checkout.session.completed, invoice.payment_succeeded, customer.subscription.deleted</code></p>
          <p className="text-xs text-muted-foreground mt-1">Copy the signing secret into <code className="text-sky-300">STRIPE_WEBHOOK_SECRET</code>.</p>
        </SectionCard>
      </div>
    );
  }

  function SmtpTab() {
    return (
      <div className="space-y-4">
        <SectionCard title="Required env vars"><VarList vars={smtpVars}/></SectionCard>
        <SectionCard title="Notes">
          <p className="text-xs text-muted-foreground">SMTP is optional at launch but required for email verification, password reset, and spike notifications.</p>
          <p className="text-xs text-muted-foreground mt-2">Recommended providers: Postmark, Resend, SendGrid, or your own SMTP relay.</p>
          <p className="text-xs text-muted-foreground mt-2">Test SMTP using the Doctor tools under <code className="text-sky-300">/api/stats/test-notification</code>.</p>
        </SectionCard>
      </div>
    );
  }

  function DomainTab() {
    return (
      <div className="space-y-4">
        <SectionCard title="Domain: viba.guru">
          {["1. Add custom domain in Railway dashboard: viba.guru","2. Railway shows a DNS target (e.g. something.railway.app).","3. At GoDaddy: set root @ as ALIAS/ANAME to Railway target (if supported), or use CNAME flattening.","4. www: CNAME to Railway target.","5. Wait for DNS propagation (minutes to hours).","6. Set PUBLIC_ORIGIN=https://viba.guru in Railway env vars.","7. Verify SSL certificate is auto-issued by Railway."].map((s,i) => (
            <p key={i} className="text-xs text-muted-foreground">{s}</p>
          ))}
        </SectionCard>
        <SectionCard title="GoDaddy apex domain workaround">
          <p className="text-xs text-muted-foreground">GoDaddy does not support ALIAS/ANAME at root. Options:</p>
          <p className="text-xs text-muted-foreground mt-1">• Use Cloudflare as DNS proxy (free plan) — Cloudflare supports CNAME flattening at apex.</p>
          <p className="text-xs text-muted-foreground mt-1">• Forward root to www via GoDaddy, then CNAME www to Railway target.</p>
        </SectionCard>
      </div>
    );
  }

  function SmokeTab() {
    const checks = [
      "GET /api/healthz — HTTP 200","Public demo page loads","Login / signup flow works","Dashboard loads after login","Create a new session — agents respond","Provider list shows in /providers","Doctor page loads and shows status","Share report link works anonymously","/owner-actions loads for logged-in user","/setup-assistant loads","SMTP: receive a test email","Stripe: complete a test checkout (test mode)","Verify /api/stripe/webhook receives events",
    ];
    const [done, setDone] = useState<Record<number,boolean>>({});
    const count = Object.values(done).filter(Boolean).length;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3"><Badge variant="outline">{count}/{checks.length} complete</Badge></div>
        <div className="space-y-2">
          {checks.map((check,i) => {
            const isDone = Boolean(done[i]);
            return (
              <button key={i} onClick={()=>setDone((d)=>({...d,[i]:!isDone}))} className="flex w-full items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-left transition hover:bg-white/[0.05]">
                {isDone ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-400"/> : <Circle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground"/>}
                <span className="text-xs text-white">{check}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  export default function SetupAssistant() {
    const [tab, setTab] = useState<Tab>("guided");

    const tabContent: Record<Tab, React.ReactNode> = {
      guided: <GuidedTab/>,
      paid: <PaidTab/>,
      runner: <RunnerTab/>,
      railway: <RailwayTab/>,
      stripe: <StripeTab/>,
      smtp: <SmtpTab/>,
      domain: <DomainTab/>,
      smoke: <SmokeTab/>,
    };

    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3"><ShieldCheck className="h-7 w-7 text-emerald-400"/>Setup Assistant</h1>
            <p className="mt-1 text-sm text-muted-foreground">Configure VIBA for production. Owner Setup Runner can set Railway env vars directly.</p>
          </div>

          <div className="flex flex-wrap gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
            {TABS.map(({ id, label, icon:Icon }) => (
              <button key={id} onClick={()=>setTab(id)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${tab===id?"bg-white/[0.12] text-white":"text-muted-foreground hover:bg-white/[0.06] hover:text-white"}`}>
                <Icon className="h-3.5 w-3.5"/>{label}
              </button>
            ))}
          </div>

          {tabContent[tab]}

          <div className="flex justify-center pt-4">
            <Link href="/owner-actions" className="text-xs text-muted-foreground hover:text-white transition">← Back to Owner Actions</Link>
          </div>
        </div>
      </AppLayout>
    );
  }
  