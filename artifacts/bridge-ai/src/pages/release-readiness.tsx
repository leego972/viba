import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, ClipboardCheck, ExternalLink, Rocket, ShieldCheck, SquareCheckBig } from "lucide-react";

type CheckItem = {
  id: string;
  title: string;
  detail: string;
  group: "routes" | "build" | "manual" | "release";
  link?: string;
};

const CHECKS: CheckItem[] = [
  { id: "doctor-home", group: "routes", title: "Doctor home loads", detail: "Open /doctor and confirm the form, status cards, and history link render.", link: "/doctor" },
  { id: "doctor-history", group: "routes", title: "Doctor history loads", detail: "Open /doctor/history and confirm View Report and Proposal links are visible.", link: "/doctor/history" },
  { id: "doctor-detail", group: "routes", title: "Doctor report detail checked", detail: "Use a real report ID and verify report detail, proposal, checklist, and implementation plan links." },
  { id: "session-workspace", group: "routes", title: "Session workspace checked", detail: "Use a real session ID and verify workspace, Next Action, Budget, Proof Report, and Approvals links." },
  { id: "proof-export", group: "routes", title: "Proof export checked", detail: "Open a proof report and verify copy, JSON, Markdown, and print actions." },
  { id: "typecheck", group: "build", title: "Typecheck passed", detail: "pnpm run typecheck passes across all workspace packages." },
  { id: "api-build", group: "build", title: "API build passed", detail: "pnpm --filter @workspace/api-server run build passes." },
  { id: "frontend-build", group: "build", title: "Frontend build passed", detail: "pnpm --filter @workspace/bridge-ai run build passes." },
  { id: "github-actions", group: "build", title: "GitHub Actions green", detail: "Backend CI is green on the exact PR head commit." },
  { id: "workflow-lockfile", group: "manual", title: "Workflow lockfile mode reviewed", detail: "Confirm whether backend-ci.yml still uses --frozen-lockfile=false, then fix only when lockfile is current." },
  { id: "env-vars", group: "manual", title: "Environment variables reviewed", detail: "Confirm Railway/server env vars are present before any production deploy." },
  { id: "stripe-live", group: "manual", title: "Stripe live setup deliberately deferred", detail: "Confirm no live Stripe price/webhook/Billing Portal setup is enabled unless owner approves." },
  { id: "providers", group: "manual", title: "Paid providers disabled", detail: "Confirm no paid-provider execution is enabled by default." },
  { id: "no-secrets", group: "release", title: "No secrets committed", detail: "Confirm no .env, token, secret, private key, or credential file is committed." },
  { id: "owner-approval", group: "release", title: "Owner approval before merge", detail: "PR remains draft/open until explicit owner approval to merge." },
  { id: "deploy-approval", group: "release", title: "Deploy approval required", detail: "No Railway production deploy happens before explicit owner approval." },
];

const GROUP_LABELS: Record<CheckItem["group"], string> = {
  routes: "Route smoke tests",
  build: "Build gates",
  manual: "Manual platform gates",
  release: "Release controls",
};

const STORAGE_KEY = "viba_release_readiness_checks";

function loadState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export default function ReleaseReadiness() {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => loadState());

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(checked)); } catch {}
  }, [checked]);

  const completed = CHECKS.filter((item) => checked[item.id]).length;
  const percent = Math.round((completed / CHECKS.length) * 100);
  const grouped = useMemo(() => {
    return CHECKS.reduce<Record<CheckItem["group"], CheckItem[]>>((acc, item) => {
      acc[item.group].push(item);
      return acc;
    }, { routes: [], build: [], manual: [], release: [] });
  }, []);

  function toggle(id: string) {
    setChecked((current) => ({ ...current, [id]: !current[id] }));
  }

  function clearAll() {
    setChecked({});
  }

  function markBuildGreen() {
    setChecked((current) => ({ ...current, typecheck: true, "api-build": true, "frontend-build": true, "github-actions": true }));
  }

  return (
    <AppLayout>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Rocket className="h-4 w-4" />
              Release control
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Release readiness</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Owner-facing checklist for the final manual gates. This page stores checklist state locally in the browser and does not call providers, Stripe, Railway, or GitHub mutation APIs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={markBuildGreen}>Mark build green</Button>
            <Button variant="ghost" onClick={clearAll}>Reset</Button>
          </div>
        </div>

        <Card className="border-border/70 shadow-sm">
          <CardContent className="grid gap-4 py-5 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="text-sm text-muted-foreground">Readiness score</p>
              <h2 className="text-2xl font-semibold">{completed}/{CHECKS.length} complete</h2>
              <div className="mt-3 h-2 rounded-full bg-muted">
                <div className="h-2 rounded-full bg-primary" style={{ width: `${percent}%` }} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 md:justify-end">
              <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" /> Local only</Badge>
              <Badge variant="outline">No deployment</Badge>
              <Badge variant="outline">No billing changes</Badge>
            </div>
          </CardContent>
        </Card>

        {(Object.keys(grouped) as Array<CheckItem["group"]>).map((group) => (
          <Card key={group} className="border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardCheck className="h-4 w-4" />
                {GROUP_LABELS[group]}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {grouped[group].map((item) => {
                const done = Boolean(checked[item.id]);
                return (
                  <div key={item.id} className="rounded-xl border p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <button type="button" className="flex flex-1 items-start gap-3 text-left" onClick={() => toggle(item.id)}>
                        {done ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-400" /> : <SquareCheckBig className="mt-0.5 h-5 w-5 text-muted-foreground" />}
                        <span>
                          <span className="block text-sm font-medium">{item.title}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span>
                        </span>
                      </button>
                      {item.link && (
                        <Link href={item.link}>
                          <Button size="sm" variant="outline" className="gap-1.5">
                            <ExternalLink className="h-3.5 w-3.5" />
                            Open
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppLayout>
  );
}
