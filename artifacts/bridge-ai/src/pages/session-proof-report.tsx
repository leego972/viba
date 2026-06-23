import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCheck, FileCheck2, ShieldCheck } from "lucide-react";

type EvidenceStatus = "green" | "yellow" | "red";

type ProofEvidence = {
  status: EvidenceStatus;
  title: string;
  detail: string;
};

type ProofReceipt = {
  messageId: number;
  taskId: number | null;
  credits: number;
  agentName: string | null;
  provider: string | null;
  createdAt: string;
};

type ProofReport = {
  generatedAt: string;
  session: {
    id: number;
    goal: string;
    status: string;
    mode: string;
    autonomyMode: string;
    budgetCapCredits: number | null;
    creditsReserved: number;
    finalOutputPresent: boolean;
    repoUrl: string | null;
    repoBranch: string | null;
    workspaceEnv: string | null;
  };
  summary: {
    totalTasks: number;
    completedTasks: number;
    blockedTasks: number;
    approvals: { total: number; pending: number; rejected: number };
    messages: number;
    auditEvents: number;
    creditReceipts: number;
    totalCreditsReserved: number;
  };
  evidence: ProofEvidence[];
  receipts: ProofReceipt[];
  recentAuditEvents: Array<{ id: number; type: string; description: string; createdAt: string }>;
  risks: string[];
  nextAction: string;
  guarantee: string;
};

function evidenceClass(status: EvidenceStatus): string {
  if (status === "green") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (status === "yellow") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-red-500/30 bg-red-500/10 text-red-300";
}

function evidenceIcon(status: EvidenceStatus) {
  if (status === "green") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  return <AlertTriangle className="h-4 w-4 text-amber-400" />;
}

export default function SessionProofReport() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const [report, setReport] = useState<ProofReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadReport() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/sessions/${sessionId}/proof-report`, { credentials: "include" });
        const data = await response.json() as ProofReport | { error?: string; message?: string };
        if (!response.ok) throw new Error("message" in data ? data.message ?? data.error ?? "Could not load proof report." : "Could not load proof report.");
        if (!cancelled) setReport(data as ProofReport);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load proof report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (sessionId) void loadReport();
    return () => { cancelled = true; };
  }, [sessionId]);

  return (
    <AppLayout>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileCheck2 className="h-4 w-4" />
              Deterministic proof report
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Session proof report</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              A local report generated from stored session records, tasks, receipts, approvals, messages, and audit events. No paid providers are called.
            </p>
          </div>
          <Link href={`/sessions/${sessionId}`}>
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to session
            </Button>
          </Link>
        </div>

        {loading && <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading proof report…</CardContent></Card>}
        {error && <Card className="border-red-500/30 bg-red-500/5"><CardContent className="py-6 text-sm text-red-300">{error}</CardContent></Card>}

        {report && (
          <div className="grid gap-5">
            <Card className="border-border/70 shadow-sm">
              <CardContent className="grid gap-4 py-5 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <p className="text-sm text-muted-foreground">Session #{report.session.id}</p>
                  <h2 className="text-xl font-semibold">{report.session.goal}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{report.nextAction}</p>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <Badge variant="outline">{report.session.status}</Badge>
                  <Badge variant="outline">{report.session.mode}</Badge>
                  <Badge variant="outline" className="gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    No paid providers
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-4">
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Tasks</p><p className="text-2xl font-semibold">{report.summary.completedTasks}/{report.summary.totalTasks}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Receipts</p><p className="text-2xl font-semibold">{report.summary.creditReceipts}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Credits reserved</p><p className="text-2xl font-semibold">{report.summary.totalCreditsReserved}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Risks</p><p className="text-2xl font-semibold">{report.risks.length}</p></CardContent></Card>
            </div>

            <Card className="border-border/70 shadow-sm">
              <CardHeader><CardTitle className="text-base">Evidence</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {report.evidence.map((item) => (
                  <div key={item.title} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {evidenceIcon(item.status)}
                      <Badge variant="outline" className={evidenceClass(item.status)}>{item.status}</Badge>
                      <span className="text-sm font-medium">{item.title}</span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            {report.risks.length > 0 && (
              <Card className="border-amber-500/30 bg-amber-500/5">
                <CardHeader><CardTitle className="text-base">Remaining risks</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {report.risks.map((risk) => <p key={risk} className="text-sm text-amber-200">• {risk}</p>)}
                </CardContent>
              </Card>
            )}

            <Card className="border-border/70 shadow-sm">
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4" /> Credit receipts</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {report.receipts.length === 0 ? <p className="text-sm text-muted-foreground">No credit receipts found.</p> : report.receipts.map((receipt) => (
                  <div key={receipt.messageId} className="rounded-lg border px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{receipt.credits} credits</span>
                      <span className="text-xs text-muted-foreground">{new Date(receipt.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{receipt.agentName ?? "VIBA System"} · {receipt.provider ?? "system"}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-sm">
              <CardHeader><CardTitle className="text-base">Recent audit events</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {report.recentAuditEvents.length === 0 ? <p className="text-sm text-muted-foreground">No audit events found.</p> : report.recentAuditEvents.map((event) => (
                  <details key={event.id} className="rounded-lg border px-4 py-3">
                    <summary className="cursor-pointer text-sm font-medium">{event.type}</summary>
                    <p className="mt-2 text-sm text-muted-foreground">{event.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</p>
                  </details>
                ))}
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground">{report.guarantee}</p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
