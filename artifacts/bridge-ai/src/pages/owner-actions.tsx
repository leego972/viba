import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, ClipboardList, Download, Rocket } from "lucide-react";

type ActionItem = {
  id: string;
  group: string;
  title: string;
  detail: string;
  link?: string;
};

const ACTIONS: ActionItem[] = [
  { id: "github-pr4-ready", group: "GitHub", title: "PR #4 ready for review", detail: "Replit verification has passed and PR #4 is no longer draft.", link: "https://github.com/leego972/bridge-ai/pull/4" },
  { id: "github-pr4-merged", group: "GitHub", title: "PR #4 merged into main", detail: "Main branch contains the market readiness/value feature pass." },
  { id: "github-main-ci", group: "GitHub", title: "Main CI green", detail: "Main branch typecheck/build/test suite passed after merge." },
  { id: "railway-env", group: "Railway", title: "Production env vars set", detail: "DATABASE_URL, SESSION_SECRET, ACCESS_TOKEN, PUBLIC_ORIGIN, CREDENTIAL_ENCRYPTION_KEY, SMTP vars present." },
  { id: "railway-deploy", group: "Railway", title: "Production deploy completed", detail: "Railway deployment built from main and booted without DB/env errors." },
  { id: "railway-health", group: "Railway", title: "Healthcheck passed", detail: "/api/healthz returns HTTP 200 on production URL." },
  { id: "stripe-test-products", group: "Stripe", title: "Test products/prices created", detail: "Stripe TEST mode products/prices match the app pricing page exactly." },
  { id: "stripe-webhook", group: "Stripe", title: "Webhook configured", detail: "Webhook points to /api/stripe/webhook and only includes handled events." },
  { id: "stripe-checkout", group: "Stripe", title: "Test checkout verified", detail: "A test checkout completes and webhook updates billing/credits if supported." },
  { id: "email-smtp", group: "Email", title: "SMTP configured", detail: "Verification and reset email can send from the verified sender." },
  { id: "launch-demo", group: "Launch", title: "Public demo tested", detail: "/demo, /demo/doctor-report, and /demo/proof-report work without login." },
  { id: "launch-smoke", group: "Launch", title: "Production smoke test passed", detail: "Auth, dashboard, sessions, Doctor, reports, share links, and mobile checks passed." },
  { id: "launch-users", group: "Launch", title: "Controlled launch users selected", detail: "5-10 trusted users/projects selected for the first controlled launch window." },
];

const STORAGE_KEY = "viba_owner_action_checklist_v1";

export default function OwnerActions() {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
  });

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(checked)); }, [checked]);

  const groups = useMemo(() => Array.from(new Set(ACTIONS.map((item) => item.group))), []);
  const done = ACTIONS.filter((item) => checked[item.id]).length;
  const markdown = [`# VIBA Owner Action Checklist`, "", `Progress: ${done}/${ACTIONS.length}`, "", ...groups.flatMap((group) => [`## ${group}`, ...ACTIONS.filter((item) => item.group === group).map((item) => `- [${checked[item.id] ? "x" : " "}] ${item.title} — ${item.detail}`), ""])].join("\n");

  const download = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "viba-owner-action-checklist.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/market-readiness" className="text-sm text-muted-foreground hover:text-foreground">← Market readiness</Link>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                <ClipboardList className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Owner Action Checklist</h1>
                <p className="text-sm text-muted-foreground">One practical command list for GitHub, Railway, Stripe, email, and controlled launch.</p>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant="outline">{done}/{ACTIONS.length} complete</Badge>
            <Button variant="outline" size="sm" onClick={download}><Download className="mr-2 h-4 w-4" />Export MD</Button>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
          <div className="flex items-center gap-3">
            <Rocket className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">Launch rule</p>
              <p className="text-xs text-muted-foreground">Do not move to public launch until GitHub, Railway, Stripe test mode, email, share reports, Doctor, and mobile smoke all pass.</p>
            </div>
          </div>
        </div>

        {groups.map((group) => (
          <section key={group} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{group}</h2>
            <div className="space-y-2">
              {ACTIONS.filter((item) => item.group === group).map((item) => {
                const isDone = Boolean(checked[item.id]);
                return (
                  <button
                    key={item.id}
                    onClick={() => setChecked((current) => ({ ...current, [item.id]: !isDone }))}
                    className="flex w-full items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-left transition hover:bg-white/[0.05]"
                  >
                    {isDone ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />}
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{item.title}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span>
                      {item.link && <span className="mt-2 block text-xs text-primary">{item.link}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-6 flex justify-center">
        <Link href="/setup-assistant" className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 py-3 text-sm font-medium transition hover:bg-white/[0.06]">Open Setup Assistant</Link>
      </div>
    </AppLayout>
  );
}
