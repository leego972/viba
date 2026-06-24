import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, ArrowLeft, CheckCircle2, Info, MapPin, Stethoscope } from "lucide-react";

type Severity = "critical" | "high" | "medium" | "low" | "info";

type Finding = {
  severity: Severity;
  evidence: string;
  area: string;
  title: string;
  detail: string;
  recommendation: string;
  source?: string;
};

type DoctorReportResponse = {
  id: number;
  repoFullName: string;
  branch: string;
  healthScore: number;
  createdAt: string;
  report: {
    findings: Finding[];
    nextAction: string;
  };
};

type PlanItem = {
  finding: Finding;
  likelyFile: string;
  verification: string;
  risk: "high" | "medium" | "low";
};

function likelyFile(finding: Finding): string {
  if (finding.source && finding.source.includes("/")) return finding.source;
  const area = finding.area.toLowerCase();
  if (area.includes("workflow") || area.includes("ci")) return ".github/workflows/backend-ci.yml";
  if (area.includes("package") || area.includes("mobile")) return "artifacts/bridge-ai/package.json";
  if (area.includes("doc")) return "docs/";
  if (
    area.includes("env") ||
    area.includes("stripe") ||
    area.includes("railway") ||
    area.includes("credential") ||
    area.includes("health")
  )
    return "Manual platform setting";
  return "Review required";
}

function verification(finding: Finding): string {
  const area = finding.area.toLowerCase();
  if (area.includes("ci") || area.includes("workflow"))
    return "Run typecheck, API build, frontend build — then confirm CI passes";
  if (area.includes("package") || area.includes("mobile"))
    return "Run pnpm install, typecheck, API build, frontend build";
  if (area.includes("doc")) return "Review rendered doc and re-run Doctor";
  if (
    area.includes("env") ||
    area.includes("stripe") ||
    area.includes("railway") ||
    area.includes("credential")
  )
    return "Verify in platform UI and re-run Doctor";
  if (area.includes("health"))
    return "Check app startup logs and /api/healthz endpoint after deployment";
  return "Run standard typecheck + build verification, then re-run Doctor";
}

function risk(finding: Finding): "high" | "medium" | "low" {
  if (finding.severity === "critical" || finding.severity === "high") return "high";
  if (finding.severity === "medium") return "medium";
  return "low";
}

function severityClass(s: Severity): string {
  if (s === "critical" || s === "high") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (s === "medium") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  if (s === "info") return "border-blue-500/30 bg-blue-500/10 text-blue-300";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
}

function riskClass(r: "high" | "medium" | "low"): string {
  if (r === "high") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (r === "medium") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
}

function FindingIcon({ severity }: { severity: Severity }) {
  if (severity === "info") return <Info className="h-4 w-4 text-blue-400 shrink-0" />;
  if (severity === "critical" || severity === "high")
    return <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />;
  if (severity === "medium") return <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />;
  return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
}

export default function DoctorImplementationPlan() {
  const params = useParams<{ id: string }>();
  const reportId = params.id;
  const [data, setData] = useState<DoctorReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!reportId) {
      setLoading(false);
      setError("No report ID specified.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/doctor/reports/${reportId}`, { credentials: "include" })
      .then(async (r) => {
        const d = await r.json() as DoctorReportResponse | { error?: string; message?: string };
        if (!r.ok)
          throw new Error(
            "message" in d ? (d.message ?? d.error ?? "Could not load report.") : "Could not load report.",
          );
        if (!cancelled) setData(d as DoctorReportResponse);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load report.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportId, retryCount]);

  const findings = data?.report.findings ?? [];
  const actionable = findings.filter((f) => f.severity !== "info");
  const plan: PlanItem[] = actionable.map((f) => ({
    finding: f,
    likelyFile: likelyFile(f),
    verification: verification(f),
    risk: risk(f),
  }));

  const highRisk = plan.filter((p) => p.risk === "high").length;
  const mediumRisk = plan.filter((p) => p.risk === "medium").length;
  const lowRisk = plan.filter((p) => p.risk === "low").length;

  return (
    <AppLayout>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Stethoscope className="h-4 w-4" />
              GitHub / Railway Doctor
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Implementation plan</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Client-side planning view generated from stored findings. Read-only — no branches, commits, PRs,
              GitHub mutations, or provider calls.
            </p>
          </div>
          <Link href={`/doctor/reports/${reportId}`}>
            <Button variant="outline" className="gap-2 shrink-0">
              <ArrowLeft className="h-4 w-4" />
              Report detail
            </Button>
          </Link>
        </div>

        {/* Loading */}
        {loading && (
          <Card>
            <CardContent className="flex items-center gap-3 py-8 px-6">
              <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin shrink-0" />
              <p className="text-sm text-muted-foreground">Loading findings…</p>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {error && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="flex flex-col gap-4 py-8 px-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-400" />
                <p className="text-sm font-medium text-red-300">Could not load report</p>
              </div>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button size="sm" variant="outline" onClick={() => setRetryCount((c) => c + 1)}>
                Try again
              </Button>
            </CardContent>
          </Card>
        )}

        {data && (
          <div className="grid gap-5">
            {/* Summary card */}
            <Card className="border-border/70 shadow-sm">
              <CardContent className="grid gap-4 py-5 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {data.repoFullName} · <span className="font-mono text-xs">{data.branch}</span>
                  </p>
                  <h2 className="text-xl font-semibold">
                    {plan.length} actionable item{plan.length !== 1 ? "s" : ""}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">{data.report.nextAction}</p>
                </div>
                <Badge variant="outline" className="text-sm px-3 py-1">
                  Score {data.healthScore} / 100
                </Badge>
              </CardContent>
            </Card>

            {/* Risk summary */}
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-red-400">High risk</p>
                  <p className="text-2xl font-semibold">{highRisk}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-amber-400">Medium risk</p>
                  <p className="text-2xl font-semibold">{mediumRisk}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-emerald-400">Low risk</p>
                  <p className="text-2xl font-semibold">{lowRisk}</p>
                </CardContent>
              </Card>
            </div>

            {/* Plan items */}
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Plan items</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {plan.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center space-y-2">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
                    <p className="text-sm font-medium">No actionable items</p>
                    <p className="text-xs text-muted-foreground">
                      All findings are informational. No implementation steps needed.
                    </p>
                  </div>
                ) : (
                  plan.map((item, i) => (
                    <div key={`plan-${i}`} className="rounded-xl border p-4 space-y-3">
                      {/* Title row */}
                      <div className="flex flex-wrap items-center gap-2">
                        <FindingIcon severity={item.finding.severity} />
                        <Badge
                          variant="outline"
                          className={`${severityClass(item.finding.severity)} text-[10px]`}
                        >
                          {item.finding.severity}
                        </Badge>
                        <Badge variant="outline" className={`${riskClass(item.risk)} text-[10px]`}>
                          {item.risk} risk
                        </Badge>
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          {item.finding.area}
                        </Badge>
                        <span className="text-sm font-medium flex-1 min-w-0">{item.finding.title}</span>
                      </div>

                      {/* Recommendation */}
                      <p className="text-sm text-muted-foreground">{item.finding.recommendation}</p>

                      {/* File + Verification */}
                      <div className="grid gap-2 sm:grid-cols-2 text-xs">
                        <div className="rounded-lg border bg-muted/30 px-3 py-2">
                          <p className="text-muted-foreground mb-1 flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> Likely file / area
                          </p>
                          <p className="font-mono break-all">{item.likelyFile}</p>
                        </div>
                        <div className="rounded-lg border bg-muted/30 px-3 py-2">
                          <p className="text-muted-foreground mb-1">Verification</p>
                          <p>{item.verification}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Back link */}
            <div className="flex flex-wrap gap-3">
              <Link href={`/doctor/reports/${data.id}`}>
                <Button variant="outline" className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Report detail
                </Button>
              </Link>
              <Link href={`/doctor/reports/${data.id}/checklist`}>
                <Button variant="outline" className="gap-2">
                  Findings checklist
                </Button>
              </Link>
              <Link href={`/doctor/reports/${data.id}/proposal`}>
                <Button className="gap-2">View proposal</Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
