import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, Clock, History, Stethoscope } from "lucide-react";

type DoctorReportRow = {
  id: number;
  repo_full_name: string;
  branch: string;
  public_url: string | null;
  health_score: number;
  created_at: string;
};

function scoreBadge(score: number) {
  if (score >= 85) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (score >= 65) return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-red-500/30 bg-red-500/10 text-red-300";
}

function scoreIcon(score: number) {
  if (score >= 85) return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  return <AlertTriangle className="h-4 w-4 text-amber-400" />;
}

export default function DoctorHistory() {
  const [reports, setReports] = useState<DoctorReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadReports() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/doctor/reports", { credentials: "include" });
        const data = await response.json() as { reports?: DoctorReportRow[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Could not load Doctor reports.");
        if (!cancelled) setReports(data.reports ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load Doctor reports.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadReports();
    return () => { cancelled = true; };
  }, []);

  return (
    <AppLayout>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <History className="h-4 w-4" />
              GitHub / Railway Doctor
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Doctor history</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Review previous deterministic scans and track whether project health is improving over time.
            </p>
          </div>
          <Link href="/doctor">
            <Button className="gap-2">
              <Stethoscope className="h-4 w-4" />
              Run Doctor
            </Button>
          </Link>
        </div>

        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Recent reports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && <p className="text-sm text-muted-foreground">Loading Doctor history…</p>}
            {error && <p className="text-sm text-red-300">{error}</p>}
            {!loading && !error && reports.length === 0 && (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                No Doctor reports yet. Run the first scan from Project Doctor.
              </div>
            )}
            {reports.map((report) => (
              <div key={report.id} className="rounded-xl border p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {scoreIcon(report.health_score)}
                      <span className="font-medium">{report.repo_full_name}</span>
                      <Badge variant="outline" className="font-mono text-[11px]">{report.branch}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(report.created_at).toLocaleString()}</span>
                      {report.public_url && <span>{report.public_url}</span>}
                    </div>
                  </div>
                  <Badge variant="outline" className={scoreBadge(report.health_score)}>
                    {report.health_score} health score
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
