import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, ClipboardCheck, FileCheck2, Gauge, ListChecks, Route, ShieldCheck } from "lucide-react";

type Task = { id: number; title: string; status: string; type?: string | null };
type Approval = { id: number; type: string; description: string; status: string; createdAt?: string };
type SessionData = {
  id: number;
  goal: string;
  status: string;
  mode: string;
  autonomyMode: string;
  finalOutput?: string | null;
  tasks?: Task[];
  approvals?: Approval[];
};
type BudgetData = { budgetCapCredits: number | null; creditsReserved: number; remainingBudgetCredits?: number | null; creditsRemaining?: number | null };

function statusClass(status: string): string {
  if (status === "completed") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (status === "active") return "border-blue-500/30 bg-blue-500/10 text-blue-300";
  if (status.includes("paused") || status.includes("stopped")) return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-border text-muted-foreground";
}

function decideNextAction(session: SessionData, budget: BudgetData | null): string {
  const tasks = session.tasks ?? [];
  const approvals = session.approvals ?? [];
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending").length;
  const blockedTasks = tasks.filter((task) => task.status.includes("blocked")).length;
  const incompleteTasks = tasks.filter((task) => task.status !== "complete" && task.status !== "completed").length;
  const remaining = budget?.remainingBudgetCredits ?? budget?.creditsRemaining ?? null;

  if (pendingApprovals > 0) return "Review pending approvals before continuing execution.";
  if (remaining !== null && remaining <= 0) return "Increase the budget cap before running more work.";
  if (blockedTasks > 0) return "Review blocked tasks and decide whether they need manual handling or a tool handoff.";
  if (session.status === "completed") return "Open the proof report, review final evidence, then close or export the session.";
  if (incompleteTasks > 0) return "Continue staged work, then verify with a proof report when tasks are complete.";
  return "Review the session state and decide whether to run the next step, export proof, or close.";
}

export default function SessionNextAction() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const [session, setSession] = useState<SessionData | null>(null);
  const [budget, setBudget] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [sessionResponse, budgetResponse] = await Promise.all([
          fetch(`/api/sessions/${sessionId}`, { credentials: "include" }),
          fetch(`/api/sessions/${sessionId}/budget`, { credentials: "include" }),
        ]);
        const sessionData = await sessionResponse.json() as SessionData | { error?: string; message?: string };
        if (!sessionResponse.ok) throw new Error("message" in sessionData ? sessionData.message ?? sessionData.error ?? "Could not load session." : "Could not load session.");
        let budgetData: BudgetData | null = null;
        if (budgetResponse.ok) budgetData = await budgetResponse.json() as BudgetData;
        if (!cancelled) {
          setSession(sessionData as SessionData);
          setBudget(budgetData);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load next action.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (sessionId) void load();
    return () => { cancelled = true; };
  }, [sessionId]);

  const tasks = session?.tasks ?? [];
  const approvals = session?.approvals ?? [];
  const completedTasks = tasks.filter((task) => task.status === "complete" || task.status === "completed").length;
  const blockedTasks = tasks.filter((task) => task.status.includes("blocked")).length;
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending").length;
  const remaining = budget?.remainingBudgetCredits ?? budget?.creditsRemaining ?? null;

  return (
    <AppLayout>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Route className="h-4 w-4" /> Session control</div>
            <h1 className="text-3xl font-semibold tracking-tight">Next action</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">Compact local status panel for deciding what to do next. No provider calls are made.</p>
          </div>
          <Link href={`/sessions/${sessionId}`}><Button variant="outline" className="gap-2"><ArrowLeft className="h-4 w-4" /> Back to session</Button></Link>
        </div>

        {loading && <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading session state…</CardContent></Card>}
        {error && <Card className="border-red-500/30 bg-red-500/5"><CardContent className="py-6 text-sm text-red-300">{error}</CardContent></Card>}

        {session && (
          <div className="grid gap-5">
            <Card className="border-border/70 shadow-sm">
              <CardContent className="grid gap-4 py-5 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <p className="text-sm text-muted-foreground">Session #{session.id}</p>
                  <h2 className="text-xl font-semibold">{session.goal}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{decideNextAction(session, budget)}</p>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <Badge variant="outline" className={statusClass(session.status)}>{session.status}</Badge>
                  <Badge variant="outline">{session.mode}</Badge>
                  <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" /> Local only</Badge>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-4">
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Tasks complete</p><p className="text-2xl font-semibold">{completedTasks}/{tasks.length}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Blocked tasks</p><p className="text-2xl font-semibold">{blockedTasks}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Pending approvals</p><p className="text-2xl font-semibold">{pendingApprovals}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Budget remaining</p><p className="text-2xl font-semibold">{remaining ?? "No cap"}</p></CardContent></Card>
            </div>

            <Card className="border-border/70 shadow-sm">
              <CardHeader><CardTitle className="text-base">Actions</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Link href={`/sessions/${sessionId}/proof-report`}><Button variant="outline" className="gap-2"><FileCheck2 className="h-4 w-4" /> Proof report</Button></Link>
                <Link href={`/sessions/${sessionId}/budget`}><Button variant="outline" className="gap-2"><Gauge className="h-4 w-4" /> Budget</Button></Link>
                <Link href={`/sessions/${sessionId}/approvals`}><Button variant="outline" className="gap-2"><ClipboardCheck className="h-4 w-4" /> Approvals</Button></Link>
                <Link href={`/sessions/${sessionId}`}><Button className="gap-2"><ListChecks className="h-4 w-4" /> Workspace</Button></Link>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
