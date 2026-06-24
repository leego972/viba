import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Coins, Gauge, ShieldCheck } from "lucide-react";

type BudgetState = {
  sessionId: number;
  budgetCapCredits: number | null;
  creditsReserved: number;
  remainingBudgetCredits: number | null;
};

export default function SessionBudget() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const [budget, setBudget] = useState<BudgetState | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadBudget() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/sessions/${sessionId}/budget`, { credentials: "include" });
      const data = await response.json() as BudgetState | { error?: string; message?: string };
      if (!response.ok) throw new Error("message" in data ? data.message ?? data.error ?? "Could not load budget." : "Could not load budget.");
      const next = data as BudgetState;
      setBudget(next);
      setInputValue(next.budgetCapCredits === null ? "" : String(next.budgetCapCredits));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load budget.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (sessionId) void loadBudget(); }, [sessionId]);

  async function saveBudget(value: number | null) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/sessions/${sessionId}/budget`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetCapCredits: value }),
      });
      const data = await response.json() as BudgetState | { error?: string; message?: string };
      if (!response.ok) throw new Error("message" in data ? data.message ?? data.error ?? "Could not update budget." : "Could not update budget.");
      setMessage(value === null ? "Budget cap cleared." : `Budget cap set to ${value} credits.`);
      await loadBudget();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update budget.");
    } finally {
      setSaving(false);
    }
  }

  const proposedValue = inputValue.trim() === "" ? null : Number.parseInt(inputValue.trim(), 10);
  const invalidInput = proposedValue !== null && (!Number.isFinite(proposedValue) || proposedValue < 0);

  return (
    <AppLayout>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Gauge className="h-4 w-4" />
              Session control
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Budget cap</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Set a clear credit limit for this session. VIBA will pause before going over the selected cap.
            </p>
          </div>
          <Link href={`/sessions/${sessionId}`}>
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to session
            </Button>
          </Link>
        </div>

        {loading && <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading budget settings…</CardContent></Card>}
        {error && <Card className="border-red-500/30 bg-red-500/5"><CardContent className="py-4 text-sm text-red-300">{error}</CardContent></Card>}
        {message && <Card className="border-emerald-500/30 bg-emerald-500/5"><CardContent className="py-4 text-sm text-emerald-300">{message}</CardContent></Card>}

        {budget && (
          <div className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-3">
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Current cap</p><p className="text-2xl font-semibold">{budget.budgetCapCredits ?? "Off"}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Reserved</p><p className="text-2xl font-semibold">{budget.creditsReserved}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Remaining</p><p className="text-2xl font-semibold">{budget.remainingBudgetCredits ?? "No cap"}</p></CardContent></Card>
            </div>

            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Coins className="h-4 w-4" />
                  Set budget cap
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Cap in credits</label>
                  <Input value={inputValue} onChange={(e) => setInputValue(e.target.value)} placeholder="Example: 500" inputMode="numeric" />
                  <p className="text-xs text-muted-foreground">Leave blank to clear. The cap cannot be below already reserved credits.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[250, 500, 1000, 2000].map((value) => (
                    <Button key={value} variant="outline" onClick={() => setInputValue(String(value))}>{value}</Button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled={saving || invalidInput} onClick={() => saveBudget(proposedValue)}>
                    {saving ? "Saving…" : "Save cap"}
                  </Button>
                  <Button variant="outline" disabled={saving || budget.creditsReserved > 0} onClick={() => saveBudget(null)}>
                    Clear cap
                  </Button>
                  {budget.creditsReserved > 0 && <span className="text-xs text-muted-foreground">Clear is disabled after credits are reserved.</span>}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-sm">
              <CardContent className="flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center">
                <Badge variant="outline" className="w-fit gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  Local control
                </Badge>
                <p className="text-muted-foreground">This screen uses VIBA session records and budget APIs only.</p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
