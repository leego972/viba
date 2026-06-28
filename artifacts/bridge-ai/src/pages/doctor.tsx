import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DoctorProposalPreview } from "@/components/DoctorProposalPreview";
import { Stethoscope, Search, AlertTriangle, RefreshCw, History, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface DoctorFinding {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
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

interface ReportSummary {
  id: string;
  owner: string;
  repo: string;
  branch: string;
  healthScore: number;
  findingCount: number;
  scannedAt: string;
}

function healthColor(score: number) {
  if (score >= 80) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-red-400";
}

export default function DoctorPage() {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentReport, setCurrentReport] = useState<DoctorReport | null>(null);
  const [history, setHistory] = useState<ReportSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  async function scan() {
    if (!owner.trim() || !repo.trim()) return;
    setScanning(true);
    setError(null);
    setCurrentReport(null);
    try {
      const res = await fetch("/api/doctor/scan", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: owner.trim(), repo: repo.trim(), branch: branch.trim() || "main" }),
      });
      const data = await res.json() as DoctorReport & { error?: string; message?: string };
      if (!res.ok) {
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
      } else {
        setCurrentReport(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/doctor/reports", { credentials: "include" });
      const data = await res.json() as { reports: ReportSummary[] };
      setHistory(data.reports ?? []);
      setShowHistory(true);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function loadReport(id: string) {
    const res = await fetch(`/api/doctor/reports/${id}`, { credentials: "include" });
    if (!res.ok) return;
    const data = await res.json() as DoctorReport;
    setCurrentReport(data);
    setShowHistory(false);
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Stethoscope className="h-4.5 w-4.5 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Project Doctor</h1>
          </div>
          <p className="text-sm text-muted-foreground pl-12">
            Scan any GitHub repository for health issues, missing configuration, and documentation gaps.
            No paid AI calls — all analysis is static and free.
          </p>
        </div>

        {/* Scan form */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-6 space-y-5">
          <h2 className="text-sm font-medium">Scan a repository</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Owner / Organisation</Label>
              <Input
                placeholder="e.g. leego972"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                className="h-9 text-sm bg-background/50"
                onKeyDown={(e) => e.key === "Enter" && scan()}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Repository</Label>
              <Input
                placeholder="e.g. viba"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                className="h-9 text-sm bg-background/50"
                onKeyDown={(e) => e.key === "Enter" && scan()}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Branch</Label>
            <Input
              placeholder="main"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="h-9 text-sm bg-background/50 w-48"
              onKeyDown={(e) => e.key === "Enter" && scan()}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/8 px-3 py-2 text-xs text-red-300">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              onClick={scan}
              disabled={scanning || !owner.trim() || !repo.trim()}
              className="gap-2"
            >
              {scanning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {scanning ? "Scanning…" : "Run scan"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={loadHistory}
              disabled={loadingHistory}
              className="gap-2 h-9 text-xs"
            >
              {loadingHistory ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
              Scan history
            </Button>
          </div>
        </div>

        {/* History panel */}
        {showHistory && history.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Previous scans (this session)</h3>
              <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowHistory(false)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {history.map((r) => (
              <button
                key={r.id}
                className="w-full text-left rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-3 hover:bg-white/[0.05] transition-colors"
                onClick={() => loadReport(r.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{r.owner}/{r.repo} <span className="text-muted-foreground font-normal text-xs">({r.branch})</span></p>
                    <p className="text-xs text-muted-foreground">{r.findingCount} findings · {new Date(r.scannedAt).toLocaleTimeString()}</p>
                  </div>
                  <span className={`text-lg font-bold ${healthColor(r.healthScore)}`}>{r.healthScore}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {showHistory && history.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-6">No scans in this session yet.</p>
        )}

        {/* Report */}
        {currentReport && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">
                Scan results —{" "}
                <span className="font-normal text-muted-foreground">
                  {currentReport.owner}/{currentReport.repo}
                </span>
              </h2>
              <Badge variant="outline" className="text-xs">
                {new Date(currentReport.scannedAt).toLocaleString()}
              </Badge>
            </div>
            <DoctorProposalPreview report={currentReport} />
          </div>
        )}
      </div>
    </AppLayout>
  );
}
