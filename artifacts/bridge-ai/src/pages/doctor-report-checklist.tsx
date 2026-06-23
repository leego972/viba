import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, ArrowLeft, CheckCircle2, RotateCcw, XCircle } from "lucide-react";

type Severity = "critical" | "high" | "medium" | "low" | "info";
type Evidence = "green" | "yellow" | "red";
type ItemState = "open" | "reviewed" | "dismissed";

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
  topBlockers: Finding[];
  findings: Finding[];
  nextAction: string;
};

type DoctorReportResponse = {
  id: number;
  repoFullName: string;
  branch: string;
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

function itemType(finding: Finding): "manual" | "code/config" {
  const area = finding.area.toLowerCase();
  if (area.includes("env") || area.includes("credential") || area.includes("health") || area.includes("railway") || area.includes("stripe")) return "manual";
  return "code/config";
}

function stateClass(state: ItemState): string {
  if (state === "reviewed") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (state === "dismissed") return "border-muted bg-muted/40 text-muted-foreground";
  return "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

export default function DoctorReportChecklist() {
  const params = useParams<{ id: string }>();
  const reportId = params.id;
  const [report, setReport] = useState<DoctorReportResponse | null>(null);
  const [states, setStates] = useState<Record<string, ItemState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadReport() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/doctor/reports/${reportId}`, { credentials: "include" });
        const data = await response.json() as DoctorReportResponse | { error?: string; message?: string };
        if (!response.ok) throw new Error("message" in data ? data.message ?? data.error ?? "Could not load checklist." : "Could not load checklist.");
        if (!cancelled) setReport(data as DoctorReportResponse);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load checklist.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (reportId) void loadReport();
    return () => { cancelled = true; };
  }, [reportId]);

  const findings = report?.report.findings ?? [];
  const counts = findings.reduce<Record<ItemState, number>>((acc, finding, index) => {
    const key = `${finding.area}-${index}`;
    const state = states[key] ?? "open";
    acc[state] = (acc[state] ?? 0) + 1;
    return acc;
  }, { open: 0, reviewed: 0, dismissed: 0 });

  function setItemState(key: string, state: ItemState) {
    setStates((current) => ({ ...current, [key]: state }));
  }

  function resetAll() {
    setStates({});
  }

  return (
    <AppLayout>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" />
              Doctor checklist
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Findings checklist</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Client-side review checklist for the stored Doctor report. No database write, provider call, or deployment action is performed.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/doctor/reports/${reportId}`}>
              <Button variant="outline" className="gap-2"><ArrowLeft className="h-4 w-4" /> Report</Button>
            </Link>
            <Button variant="ghost" className="gap-2" onClick={resetAll}><RotateCcw className="h-4 w-4" /> Reset</Button>
          </div>
        </div>

        {loading && <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading checklist…</CardContent></Card>}
        {error && <Card className="border-red-500/30 bg-red-500/5"><CardContent className="py-6 text-sm text-red-300">{error}</CardContent></Card>}

        {report && (
          <div className="grid gap-5">
            <Card className="border-border/70 shadow-sm">
              <CardContent className="grid gap-4 py-5 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <p className="text-sm text-muted-foreground">Report #{report.id} · {report.repoFullName} · {report.branch}</p>
                  <h2 className="text-xl font-semibold">Health score {report.healthScore}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{report.report.nextAction}</p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Open</p><p className="font-semibold">{counts.open ?? 0}</p></div>
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Reviewed</p><p className="font-semibold">{counts.reviewed ?? 0}</p></div>
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Dismissed</p><p className="font-semibold">{counts.dismissed ?? 0}</p></div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-sm">
              <CardHeader><CardTitle className="text-base">Checklist items</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {findings.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No findings found.</div>
                ) : findings.map((finding, index) => {
                  const key = `${finding.area}-${index}`;
                  const state = states[key] ?? "open";
                  return (
                    <div key={key} className="rounded-xl border p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {state === "reviewed" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : state === "dismissed" ? <XCircle className="h-4 w-4 text-muted-foreground" /> : <AlertTriangle className="h-4 w-4 text-amber-400" />}
                        <Badge variant="outline" className={stateClass(state)}>{state}</Badge>
                        <Badge variant="outline" className={severityClass(finding.severity)}>{finding.severity}</Badge>
                        <Badge variant="outline">{itemType(finding)}</Badge>
                        <span className="text-sm font-medium">{finding.title}</span>
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">{finding.detail}</p>
                      <p className="mt-2 text-sm">{finding.recommendation}</p>
                      <div className="mt-3 grid gap-2 rounded-lg border bg-muted/20 p-3 text-xs md:grid-cols-3">
                        <div><span className="text-muted-foreground">Area: </span>{finding.area}</div>
                        <div><span className="text-muted-foreground">Source: </span>{finding.source ?? "Not specified"}</div>
                        <div><span className="text-muted-foreground">Evidence: </span>{finding.evidence}</div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant={state === "reviewed" ? "default" : "outline"} onClick={() => setItemState(key, "reviewed")}>Mark reviewed</Button>
                        <Button size="sm" variant={state === "dismissed" ? "default" : "outline"} onClick={() => setItemState(key, "dismissed")}>Dismiss</Button>
                        <Button size="sm" variant="ghost" onClick={() => setItemState(key, "open")}>Reset item</Button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
