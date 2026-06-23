import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCheck, ExternalLink, FileText, ListChecks, ShieldCheck } from "lucide-react";

type Severity = "critical" | "high" | "medium" | "low" | "info";
type Evidence = "green" | "yellow" | "red";

type Finding = {
  severity: Severity;
  evidence: Evidence;
  area: string;
  title: string;
  detail: string;
  recommendation: string;
  source?: string;
};

type DoctorReportBody = {
  repoFullName: string;
  branch: string;
  publicUrl: string | null;
  generatedAt: string;
  healthScore: number;
  topBlockers: Finding[];
  findings: Finding[];
  nextAction: string;
  creditQuote?: {
    deterministicScanCredits: number;
    liveAgentEscalationCredits: string;
    repairCredits: string;
  };
  gates?: {
    mutatesGitHub: boolean;
    mutatesRailway: boolean;
    usesPaidProviders: boolean;
    approvalRequiredForRepair: boolean;
  };
};

type DoctorReportResponse = {
  id: number;
  repoFullName: string;
  branch: string;
  publicUrl: string | null;
  healthScore: number;
  report: DoctorReportBody;
  createdAt: string;
};

function severityClass(severity: Severity): string {
  if (severity === "critical" || severity === "high") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (severity === "medium") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  if (severity === "low") return "border-blue-500/30 bg-blue-500/10 text-blue-300";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
}

function evidenceIcon(evidence: Evidence) {
  if (evidence === "green") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (evidence === "yellow") return <AlertTriangle className="h-4 w-4 text-amber-400" />;
  return <AlertTriangle className="h-4 w-4 text-red-400" />;
}

function scoreClass(score: number): string {
  if (score >= 85) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (score >= 65) return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-red-500/30 bg-red-500/10 text-red-300";
}

export default function DoctorReportDetail() {
  const params = useParams<{ id: string }>();
  const reportId = params.id;
  const [report, setReport] = useState<DoctorReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadReport() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/doctor/reports/${reportId}`, { credentials: "include" });
        const data = await response.json() as DoctorReportResponse | { error?: string; message?: string };
        if (!response.ok) throw new Error("message" in data ? data.message ?? data.error ?? "Could not load report." : "Could not load report.");
        if (!cancelled) setReport(data as DoctorReportResponse);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (reportId) void loadReport();
    return () => { cancelled = true; };
  }, [reportId, retryCount]);

  const body = report?.report;

  return (
    <AppLayout>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              Doctor report
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Report detail</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Full deterministic Doctor report from stored scan results. Advanced findings stay collapsed until reviewed.
            </p>
          </div>
          <Link href="/doctor/history">
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              History
            </Button>
          </Link>
        </div>

        {loading && <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading report…</CardContent></Card>}
        {error && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="flex flex-col items-start gap-3 py-6">
              <p className="text-sm text-red-300">{error}</p>
              <Button size="sm" variant="outline" onClick={() => setRetryCount((value) => value + 1)}>Try again</Button>
            </CardContent>
          </Card>
        )}

        {report && body && (
          <div className="grid gap-5">
            <Card className="border-border/70 shadow-sm">
              <CardContent className="grid gap-4 py-5 md:grid-cols-[150px_1fr] md:items-center">
                <div className={`rounded-2xl border p-5 text-center ${scoreClass(report.healthScore)}`}>
                  <div className="text-4xl font-semibold">{report.healthScore}</div>
                  <div className="text-xs">health score</div>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Report #{report.id}</p>
                    <h2 className="text-xl font-semibold">{report.repoFullName}</h2>
                    <p className="text-sm text-muted-foreground">Branch: {report.branch} · Created: {new Date(report.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" /> Local scan</Badge>
                    <Badge variant="outline">No provider calls</Badge>
                    <Badge variant="outline">No mutation</Badge>
                    {report.publicUrl && <Badge variant="outline">Public URL checked</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{body.nextAction}</p>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/doctor/reports/${report.id}/proposal`}>
                      <Button size="sm" className="gap-2"><ClipboardCheck className="h-4 w-4" /> Proposal</Button>
                    </Link>
                    <Link href={`/doctor/reports/${report.id}/checklist`}>
                      <Button size="sm" variant="outline" className="gap-2"><ListChecks className="h-4 w-4" /> Checklist</Button>
                    </Link>
                    {report.publicUrl && (
                      <a href={report.publicUrl} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="ghost" className="gap-2"><ExternalLink className="h-4 w-4" /> Open URL</Button>
                      </a>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-sm">
              <CardHeader><CardTitle className="text-base">Top blockers</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {body.topBlockers.length === 0 ? <p className="text-sm text-muted-foreground">No major blockers found.</p> : body.topBlockers.map((finding, index) => (
                  <div key={`${finding.area}-${index}`} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {evidenceIcon(finding.evidence)}
                      <Badge variant="outline" className={severityClass(finding.severity)}>{finding.severity}</Badge>
                      <span className="text-sm font-medium">{finding.title}</span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{finding.detail}</p>
                    <p className="mt-2 text-sm">{finding.recommendation}</p>
                    {finding.source && <p className="mt-2 text-xs text-muted-foreground">Source: {finding.source}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-sm">
              <CardHeader><CardTitle className="text-base">All findings</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {body.findings.map((finding, index) => (
                  <details key={`${finding.area}-${index}`} className="rounded-lg border px-4 py-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      <span className="mr-2 inline-flex align-middle">{evidenceIcon(finding.evidence)}</span>
                      {finding.title}
                      <Badge variant="outline" className={`ml-2 ${severityClass(finding.severity)}`}>{finding.severity}</Badge>
                    </summary>
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <p>{finding.detail}</p>
                      <p className="text-foreground">{finding.recommendation}</p>
                      <p className="text-xs">Area: {finding.area}</p>
                      {finding.source && <p className="text-xs">Source: {finding.source}</p>}
                    </div>
                  </details>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-sm">
              <CardHeader><CardTitle className="text-base">Gates and quote</CardTitle></CardHeader>
              <CardContent className="grid gap-3 text-sm md:grid-cols-2">
                <div className="rounded-xl border p-4">
                  <p className="font-medium">Safety gates</p>
                  <p className="mt-2 text-muted-foreground">Provider calls: {body.gates?.usesPaidProviders ? "yes" : "no"}</p>
                  <p className="text-muted-foreground">GitHub mutation: {body.gates?.mutatesGitHub ? "yes" : "no"}</p>
                  <p className="text-muted-foreground">Railway mutation: {body.gates?.mutatesRailway ? "yes" : "no"}</p>
                  <p className="text-muted-foreground">Approval required: {body.gates?.approvalRequiredForRepair ? "yes" : "no"}</p>
                </div>
                <div className="rounded-xl border p-4">
                  <p className="font-medium">Credit quote</p>
                  <p className="mt-2 text-muted-foreground">Scan: {body.creditQuote?.deterministicScanCredits ?? 0} credits</p>
                  <p className="text-muted-foreground">Analysis: {body.creditQuote?.liveAgentEscalationCredits ?? "approval required"}</p>
                  <p className="text-muted-foreground">Repair: {body.creditQuote?.repairCredits ?? "approval required"}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
