import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, ShieldCheck, Wrench } from "lucide-react";

type ProposalStep = {
  area: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  fixType: string;
  ownerAction: string;
  suggestedPath: string | null;
  risk: "low" | "medium" | "high";
  approvalRequired: boolean;
  canAutoPreparePr: boolean;
};

type Proposal = {
  reportId: number;
  generatedAt: string;
  sourceReport: {
    repoFullName: string;
    branch: string;
    healthScore: number;
    createdAt: string;
  };
  summary: {
    totalFindings: number;
    prReadyCount: number;
    manualOnlyCount: number;
    highRiskCount: number;
  };
  proposal: ProposalStep[];
  nextAction: string;
  guarantee: string;
};

function riskClass(risk: ProposalStep["risk"]): string {
  if (risk === "high") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (risk === "medium") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
}

function severityClass(severity: ProposalStep["severity"]): string {
  if (severity === "critical" || severity === "high") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (severity === "medium") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-blue-500/30 bg-blue-500/10 text-blue-300";
}

export default function DoctorProposalPreview() {
  const params = useParams<{ id: string }>();
  const reportId = params.id;
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadProposal() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/doctor/reports/${reportId}/repair-proposal`, { credentials: "include" });
        const data = await response.json() as Proposal | { error?: string; message?: string };
        if (!response.ok) throw new Error("message" in data ? data.message ?? data.error ?? "Could not load proposal." : "Could not load proposal.");
        if (!cancelled) setProposal(data as Proposal);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load proposal.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (!reportId) {
      setLoading(false);
      setError("No report ID specified. Return to Doctor history and select a report.");
      return;
    }
    void loadProposal();
    return () => { cancelled = true; };
  }, [reportId, retryCount]);

  return (
    <AppLayout>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Wrench className="h-4 w-4" />
              Doctor proposal preview
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Proposal preview</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              A local preview generated from a stored Doctor report. It lists review steps, manual items, risk level, and approval status.
            </p>
          </div>
          <Link href="/doctor/history">
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Doctor history
            </Button>
          </Link>
        </div>

        {loading && (
          <Card>
            <CardContent className="flex items-center gap-3 py-8 px-6">
              <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin shrink-0" />
              <p className="text-sm text-muted-foreground">Loading proposal…</p>
            </CardContent>
          </Card>
        )}
        {error && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="flex flex-col items-start gap-4 py-8 px-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
                <p className="text-sm font-medium text-red-300">Could not load proposal</p>
              </div>
              <p className="text-sm text-muted-foreground">{error}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setRetryCount(c => c + 1)}>
                  Try again
                </Button>
                <Link href="/doctor/history">
                  <Button size="sm" variant="ghost" className="gap-1.5">
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to history
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {proposal && (
          <div className="grid gap-5">
            <Card className="border-border/70 shadow-sm">
              <CardContent className="grid gap-4 py-5 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <p className="text-sm text-muted-foreground">{proposal.sourceReport.repoFullName} · {proposal.sourceReport.branch}</p>
                  <h2 className="text-xl font-semibold">Health score {proposal.sourceReport.healthScore}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{proposal.nextAction}</p>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" /> Local only</Badge>
                  <Badge variant="outline">No provider calls</Badge>
                  <Badge variant="outline">Approval required</Badge>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-4">
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Findings</p><p className="text-2xl font-semibold">{proposal.summary.totalFindings}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Code/config candidates</p><p className="text-2xl font-semibold">{proposal.summary.prReadyCount}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Manual items</p><p className="text-2xl font-semibold">{proposal.summary.manualOnlyCount}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">High risk</p><p className="text-2xl font-semibold">{proposal.summary.highRiskCount}</p></CardContent></Card>
            </div>

            <Card className="border-border/70 shadow-sm">
              <CardHeader><CardTitle className="text-base">Review steps</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {proposal.proposal.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center space-y-2">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
                    <p className="text-sm font-medium">No issues to address</p>
                    <p className="text-xs text-muted-foreground">This project scored clean — no repair steps are needed.</p>
                  </div>
                ) : proposal.proposal.map((step, index) => (
                  <div key={`${step.area}-${index}`} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <Badge variant="outline" className={severityClass(step.severity)}>{step.severity}</Badge>
                      <Badge variant="outline" className={riskClass(step.risk)}>{step.risk} risk</Badge>
                      <Badge variant="outline">{step.fixType}</Badge>
                      <span className="text-sm font-medium">{step.title}</span>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">{step.ownerAction}</p>
                    <div className="mt-3 grid gap-2 rounded-lg border bg-muted/20 p-3 text-xs md:grid-cols-3">
                      <div><span className="text-muted-foreground">Path: </span>{step.suggestedPath ?? "Manual review"}</div>
                      <div><span className="text-muted-foreground">Approval: </span>{step.approvalRequired ? "Required" : "Not required"}</div>
                      <div><span className="text-muted-foreground">Type: </span>{step.canAutoPreparePr ? "Code/config" : "Manual"}</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-sm">
              <CardContent className="flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center">
                {proposal.summary.highRiskCount > 0 ? <AlertTriangle className="h-4 w-4 text-amber-400" /> : <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                <p className="text-muted-foreground">{proposal.guarantee}</p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
