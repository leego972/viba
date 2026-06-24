import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCheck, Clock, ExternalLink, ShieldCheck, XCircle } from "lucide-react";

type Approval = {
  id: number;
  type: string;
  description: string;
  status: string;
  createdAt?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  returnFeedback?: string | null;
};

type SessionMeta = { id: number; goal: string; status: string };

function statusClass(status: string): string {
  if (status === "approved") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (status === "pending") return "border-blue-500/30 bg-blue-500/10 text-blue-300";
  if (status === "rejected" || status === "returned") return "border-red-500/30 bg-red-500/10 text-red-300";
  return "border-border text-muted-foreground";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "approved") return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
  if (status === "rejected" || status === "returned") return <XCircle className="h-4 w-4 text-red-400 shrink-0" />;
  return <Clock className="h-4 w-4 text-blue-400 shrink-0" />;
}

export default function SessionApprovals() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const [session, setSession] = useState<SessionMeta | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [approveError, setApproveError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    async function load() {
      try {
        const [sessionRes, approvalsRes] = await Promise.all([
          fetch(`/api/sessions/${sessionId}`, { credentials: "include" }),
          fetch(`/api/sessions/${sessionId}/approvals`, { credentials: "include" }),
        ]);
        const sessionData = await sessionRes.json() as SessionMeta | { error?: string; message?: string };
        if (!sessionRes.ok) throw new Error("message" in sessionData ? sessionData.message ?? sessionData.error ?? "Could not load session." : "Could not load session.");
        const approvalsData = await approvalsRes.json() as Approval[] | { error?: string };
        if (!cancelled) {
          setSession(sessionData as SessionMeta);
          setApprovals(Array.isArray(approvalsData) ? approvalsData : []);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load approvals.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (sessionId) void load();
    return () => { cancelled = true; };
  }, [sessionId]);

  async function handleApprove(approvalId: number) {
    setApprovingId(approvalId);
    setApproveError("");
    try {
      const res = await fetch(`/api/sessions/${sessionId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ approvalId }),
      });
      const data = await res.json() as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Approve failed.");
      setApprovals(prev => prev.map(a => a.id === approvalId ? { ...a, status: "approved", approvedAt: new Date().toISOString() } : a));
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : "Approve failed.");
    } finally {
      setApprovingId(null);
    }
  }

  const pending = approvals.filter(a => a.status === "pending").length;
  const approved = approvals.filter(a => a.status === "approved").length;
  const rejected = approvals.filter(a => a.status === "rejected" || a.status === "returned").length;

  return (
    <AppLayout>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">

        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ClipboardCheck className="h-4 w-4" />
              Session approval queue
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Approvals</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Review and approve pending gates. Rejection and returns must be handled in the session workspace.
            </p>
          </div>
          <Link href={`/sessions/${sessionId}`}>
            <Button variant="outline" className="gap-2 shrink-0">
              <ArrowLeft className="h-4 w-4" />
              Back to session
            </Button>
          </Link>
        </div>

        {loading && (
          <Card>
            <CardContent className="flex items-center gap-3 py-8 px-6">
              <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin shrink-0" />
              <p className="text-sm text-muted-foreground">Loading approvals…</p>
            </CardContent>
          </Card>
        )}
        {error && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="py-6 px-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {session && (
          <>
            {/* Session summary */}
            <Card className="border-border/70 shadow-sm">
              <CardContent className="grid gap-4 py-5 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <p className="text-sm text-muted-foreground">Session #{session.id}</p>
                  <h2 className="text-xl font-semibold">{session.goal}</h2>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <Badge variant="outline">{session.status}</Badge>
                  <Badge variant="outline" className="gap-1">
                    <ShieldCheck className="h-3 w-3" /> No provider calls
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Counts */}
            <div className="grid grid-cols-3 gap-3">
              <Card><CardContent className="p-4">
                <p className="text-xs text-blue-400">Pending</p>
                <p className="text-2xl font-semibold">{pending}</p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-emerald-400">Approved</p>
                <p className="text-2xl font-semibold">{approved}</p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Rejected / Returned</p>
                <p className="text-2xl font-semibold">{rejected}</p>
              </CardContent></Card>
            </div>

            {approveError && (
              <Card className="border-red-500/30 bg-red-500/5">
                <CardContent className="py-3 px-6 text-sm text-red-300">{approveError}</CardContent>
              </Card>
            )}

            {/* Approval list */}
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">
                  All approvals ({approvals.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {approvals.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center space-y-2">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
                    <p className="text-sm font-medium">No approvals</p>
                    <p className="text-xs text-muted-foreground">No approval gates have been created for this session.</p>
                  </div>
                ) : approvals.map((approval) => (
                  <div key={approval.id} className="rounded-xl border p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                        <StatusIcon status={approval.status} />
                        <Badge variant="outline" className={`${statusClass(approval.status)} text-[10px]`}>
                          {approval.status}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          {approval.type}
                        </Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">#{approval.id}</span>
                    </div>

                    <p className="text-sm">{approval.description}</p>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      {approval.createdAt && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Created {new Date(approval.createdAt).toLocaleString()}
                        </span>
                      )}
                      {approval.approvedAt && (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" /> Approved {new Date(approval.approvedAt).toLocaleString()}
                        </span>
                      )}
                    </div>

                    {(approval.rejectionReason || approval.returnFeedback) && (
                      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                        <p className="text-xs text-red-300">
                          {approval.rejectionReason ?? approval.returnFeedback}
                        </p>
                      </div>
                    )}

                    {/* Actions */}
                    {approval.status === "pending" ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => void handleApprove(approval.id)}
                          disabled={approvingId === approval.id}
                          className="gap-1.5"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {approvingId === approval.id ? "Approving…" : "Approve"}
                        </Button>
                        <Link href={`/sessions/${sessionId}`}>
                          <Button size="sm" variant="outline" className="gap-1.5">
                            <ExternalLink className="h-3.5 w-3.5" />
                            Handle in workspace
                          </Button>
                        </Link>
                      </div>
                    ) : (
                      <Link href={`/sessions/${sessionId}`}>
                        <Button size="sm" variant="ghost" className="gap-1.5 text-xs">
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open workspace
                        </Button>
                      </Link>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
