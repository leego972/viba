import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AlertTriangle, CheckCircle2, GitBranch, Loader2, ShieldCheck, Stethoscope, Wrench } from "lucide-react";

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

type DoctorReport = {
  repoFullName: string;
  branch: string;
  publicUrl: string | null;
  generatedAt: string;
  healthScore: number;
  topBlockers: Finding[];
  findings: Finding[];
  nextAction: string;
  creditQuote: {
    deterministicScanCredits: number;
    liveAgentEscalationCredits: string;
    repairCredits: string;
  };
  gates: {
    mutatesGitHub: boolean;
    mutatesRailway: boolean;
    usesPaidProviders: boolean;
    approvalRequiredForRepair: boolean;
  };
};

const FLOW_STEPS = [
  { label: "Scan", detail: "cheap checks" },
  { label: "Diagnose", detail: "rank blockers" },
  { label: "Quote", detail: "show cost" },
  { label: "Approve", detail: "owner gate" },
  { label: "Repair", detail: "PR-first" },
  { label: "Verify", detail: "proof report" },
];

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

function intelligenceStepState(index: number, report: DoctorReport | null): "done" | "active" | "locked" {
  if (!report) return index === 0 ? "active" : "locked";
  if (index <= 2) return "done";
  if (index === 3) return "active";
  return "locked";
}

export default function Doctor() {
  const [repoFullName, setRepoFullName] = useState("leego972/bridge-ai");
  const [branch, setBranch] = useState("mobile-capacitor-redesign");
  const [publicUrl, setPublicUrl] = useState("https://viba.guru");
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runDoctor() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/doctor/github-railway/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoFullName, branch, publicUrl: publicUrl || null }),
      });
      const data = await response.json() as { ok?: boolean; message?: string; report?: DoctorReport };
      if (!response.ok || !data.report) {
        setError(data.message ?? "Doctor scan failed.");
        return;
      }
      setReport(data.report);
    } catch {
      setError("Network error while running Doctor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Stethoscope className="h-4 w-4" />
            GitHub / Railway Doctor
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Project Doctor</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Run a cheap deterministic diagnosis before spending credits on deeper agent analysis or repair. Doctor v1 does not mutate GitHub, change Railway, or call paid AI providers.
          </p>
        </div>

        <Card className="border-border/70 shadow-sm">
          <CardContent className="py-4">
            <div className="grid gap-3 md:grid-cols-6">
              {FLOW_STEPS.map((step, index) => {
                const state = intelligenceStepState(index, report);
                return (
                  <div
                    key={step.label}
                    className={`rounded-xl border px-3 py-3 transition ${
                      state === "done"
                        ? "border-emerald-500/30 bg-emerald-500/10"
                        : state === "active"
                          ? "border-primary/40 bg-primary/10"
                          : "border-border/60 bg-muted/20 opacity-70"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                        state === "done"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : state === "active"
                            ? "bg-primary/20 text-primary"
                            : "bg-muted text-muted-foreground"
                      }`}>
                        {state === "done" ? "✓" : index + 1}
                      </span>
                      <span className="text-sm font-medium">{step.label}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{step.detail}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="h-4 w-4" />
              Diagnose project
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[1.2fr_0.8fr_1fr_auto] md:items-end">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Repository</label>
              <Input value={repoFullName} onChange={(e) => setRepoFullName(e.target.value)} placeholder="owner/repo" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Branch</label>
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Public URL</label>
              <Input value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="https://viba.guru" />
            </div>
            <Button onClick={runDoctor} disabled={loading || !repoFullName || !branch} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
              Run Doctor
            </Button>
          </CardContent>
        </Card>

        {error && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="py-4 text-sm text-red-300">{error}</CardContent>
          </Card>
        )}

        {report && (
          <div className="grid gap-5">
            <Card className="border-border/70 shadow-sm">
              <CardContent className="grid gap-4 py-5 md:grid-cols-[160px_1fr] md:items-center">
                <div className="rounded-2xl border bg-muted/30 p-5 text-center">
                  <div className="text-4xl font-semibold">{report.healthScore}</div>
                  <div className="text-xs text-muted-foreground">health score</div>
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="gap-1">
                      <ShieldCheck className="h-3 w-3" />
                      No paid AI calls
                    </Badge>
                    <Badge variant="outline">No GitHub mutation</Badge>
                    <Badge variant="outline">No Railway mutation</Badge>
                    <Badge variant="outline">0 scan credits</Badge>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Recommended next action</p>
                    <p className="text-sm text-muted-foreground">{report.nextAction}</p>
                  </div>
                  <div className="grid gap-2 rounded-xl border bg-muted/20 p-3 text-sm md:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Current stage</p>
                      <p className="font-medium">Approval gate</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Deeper analysis</p>
                      <p className="font-medium">Quote required</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Repair mode</p>
                      <p className="font-medium">PR-first only</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Top blockers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.topBlockers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No major blockers found.</p>
                ) : report.topBlockers.map((finding, index) => (
                  <div key={`${finding.area}-${index}`} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {evidenceIcon(finding.evidence)}
                      <Badge variant="outline" className={severityClass(finding.severity)}>{finding.severity}</Badge>
                      <span className="text-sm font-medium">{finding.title}</span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{finding.detail}</p>
                    <p className="mt-2 text-sm">{finding.recommendation}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wrench className="h-4 w-4" />
                  Evidence details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.findings.map((finding, index) => (
                  <details key={`${finding.area}-${index}`} className="rounded-lg border px-4 py-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      {finding.title}
                      <span className="ml-2 text-xs text-muted-foreground">{finding.area}</span>
                    </summary>
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <p>{finding.detail}</p>
                      <p className="text-foreground">{finding.recommendation}</p>
                      {finding.source && <p className="text-xs">Source: {finding.source}</p>}
                    </div>
                  </details>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
