import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle, CheckCircle2, XCircle, Info, GitBranch, ExternalLink, RefreshCw,
  ChevronDown, ChevronUp, Wrench, Shield,
} from "lucide-react";

type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

interface DoctorFinding {
  id: string;
  severity: FindingSeverity;
  area: string;
  title: string;
  recommendation: string;
  evidence: string | null;
  prReady: boolean;
  findingType: string;
}

interface DoctorReport {
  id: string;
  owner: string;
  repo: string;
  branch: string;
  healthScore: number;
  findings: DoctorFinding[];
  scannedAt: string;
}

interface PrepareResult {
  branch: string;
  prNumber: number;
  prUrl: string;
  itemsPatched: { title: string; severity: string }[];
  manualItems: { title: string; severity: string; recommendation: string }[];
}

function severityIcon(s: FindingSeverity) {
  const map = {
    critical: <XCircle className="h-3.5 w-3.5 text-red-400" />,
    high: <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />,
    medium: <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />,
    low: <Info className="h-3.5 w-3.5 text-blue-400" />,
    info: <Info className="h-3.5 w-3.5 text-zinc-400" />,
  };
  return map[s] ?? map.info;
}

function severityColor(s: FindingSeverity) {
  const map = {
    critical: "bg-red-500/12 text-red-400 border-red-500/30",
    high: "bg-orange-500/12 text-orange-400 border-orange-500/30",
    medium: "bg-amber-500/12 text-amber-400 border-amber-500/30",
    low: "bg-blue-500/12 text-blue-400 border-blue-500/30",
    info: "bg-zinc-500/12 text-zinc-400 border-zinc-500/30",
  };
  return map[s] ?? map.info;
}

function healthColor(score: number) {
  if (score >= 80) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-red-400";
}

interface Props {
  report: DoctorReport;
}

export function DoctorProposalPreview({ report }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [result, setResult] = useState<PrepareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const prReadyItems = report.findings.filter((f) => f.prReady);
  const manualItems = report.findings.filter((f) => !f.prReady);

  function toggleExpand(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function preparePR() {
    if (!confirmed) return;
    setPreparing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/doctor/reports/${report.id}/prepare-repair-pr`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json() as PrepareResult & { error?: string; message?: string };
      if (!res.ok) {
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setPreparing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Health score summary */}
      <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 py-4">
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Health Score</p>
          <p className={`text-3xl font-bold ${healthColor(report.healthScore)}`}>
            {report.healthScore}<span className="text-sm font-normal text-muted-foreground">/100</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground mb-0.5">Repository</p>
          <p className="text-sm font-medium">{report.owner}/{report.repo}</p>
          <p className="text-xs text-muted-foreground">branch: {report.branch}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground mb-0.5">Findings</p>
          <p className="text-sm font-medium">{report.findings.length} total</p>
          <p className="text-xs text-muted-foreground">{prReadyItems.length} PR-ready</p>
        </div>
      </div>

      {/* Findings list */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground/80">All Findings</h3>
        {report.findings.map((f) => (
          <div
            key={f.id}
            className="rounded-lg border border-white/[0.07] bg-white/[0.02] overflow-hidden"
          >
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
              onClick={() => toggleExpand(f.id)}
            >
              {severityIcon(f.severity)}
              <span className="flex-1 text-sm">{f.title}</span>
              <Badge className={`text-[11px] border ${severityColor(f.severity)}`}>{f.severity}</Badge>
              {f.prReady ? (
                <Badge className="text-[11px] gap-1 bg-primary/10 text-primary border-primary/25">
                  <GitBranch className="h-2.5 w-2.5" /> PR-ready
                </Badge>
              ) : (
                <Badge className="text-[11px] gap-1 bg-zinc-500/10 text-zinc-400 border-zinc-500/25">
                  Manual
                </Badge>
              )}
              {expanded[f.id] ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
            </button>
            {expanded[f.id] && (
              <div className="px-4 pb-3 pt-0 space-y-1.5 border-t border-white/[0.05]">
                <p className="text-xs text-muted-foreground pt-2"><span className="text-foreground/60 font-medium">Area:</span> {f.area}</p>
                <p className="text-xs text-muted-foreground"><span className="text-foreground/60 font-medium">Recommendation:</span> {f.recommendation}</p>
                {f.evidence && <p className="text-xs text-muted-foreground"><span className="text-foreground/60 font-medium">Evidence:</span> {f.evidence}</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Repair proposal */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Wrench className="h-4 w-4 text-primary" />
            Repair Proposal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {prReadyItems.length > 0 ? (
            <>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-foreground/70">{prReadyItems.length} PR-ready items to patch:</p>
                {prReadyItems.map((f) => (
                  <div key={f.id} className="flex items-start gap-2 text-xs text-foreground/80">
                    <CheckCircle2 className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                    <span>{f.title}</span>
                  </div>
                ))}
              </div>

              {manualItems.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-foreground/70">{manualItems.length} manual-only items (skipped in PR):</p>
                  {manualItems.map((f) => (
                    <div key={f.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Shield className="h-3 w-3 text-zinc-500 mt-0.5 shrink-0" />
                      <span>{f.title}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-lg border border-white/[0.08] bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground/60">Files changed:</span> VIBA-DOCTOR-AUDIT.md (full audit record)
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No PR-ready items found. All findings require manual action.</p>
          )}
        </CardContent>
      </Card>

      {/* Prepare PR section */}
      {prReadyItems.length > 0 && !result && (
        <div className="space-y-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Prepare Repair PR</h3>
            <p className="text-xs text-muted-foreground">
              VIBA will create branch <code className="text-primary/80 bg-primary/10 px-1 rounded">viba-repair/report-{report.id.slice(0, 8)}-…</code> and
              open a PR with the PR-ready fixes. No deployment will occur.
            </p>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="confirm-pr"
              checked={confirmed}
              onCheckedChange={(v) => setConfirmed(!!v)}
              className="mt-0.5"
            />
            <Label htmlFor="confirm-pr" className="text-xs leading-relaxed cursor-pointer">
              I approve VIBA to create a repair branch and PR for the items listed above.{" "}
              <span className="text-muted-foreground">Do not deploy. Do not touch secrets. Do not modify production.</span>
            </Label>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/8 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <Button
            onClick={preparePR}
            disabled={!confirmed || preparing}
            className="gap-2"
          >
            {preparing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
            {preparing ? "Creating branch & PR…" : "Prepare Repair PR"}
          </Button>
        </div>
      )}

      {/* Success result */}
      {result && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-5 space-y-4">
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm font-medium">Repair PR created successfully</span>
          </div>

          <div className="space-y-1.5 text-xs">
            <p><span className="text-muted-foreground">Branch:</span> <code className="text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded">{result.branch}</code></p>
            <p><span className="text-muted-foreground">PR:</span>{" "}
              <a href={result.prUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1">
                #{result.prNumber} <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </p>
          </div>

          {result.itemsPatched.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground/70">Items patched:</p>
              {result.itemsPatched.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-emerald-200/70">
                  <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                  {item.title}
                </div>
              ))}
            </div>
          )}

          {result.manualItems.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground/70">Skipped (manual action required):</p>
              {result.manualItems.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Shield className="h-3 w-3 text-zinc-500 mt-0.5 shrink-0" />
                  <span>{item.title} — {item.recommendation}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
