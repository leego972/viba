import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { AlertTriangle, CheckCircle2, Clock, XCircle, Zap, RefreshCw, ExternalLink, TrendingDown, TrendingUp, History } from "lucide-react";

interface BillingStatus {
  subscriptionStatus: string;
  creditsRemaining: number;
  creditsPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

interface CreditPack {
  key: string;
  label: string;
  description: string;
  credits: number;
  unitAmount: number;
  badge: string | null;
}

interface CreditTransaction {
  id: number;
  amount: number;
  balanceAfter: number;
  reason: string;
  sessionId: number | null;
  createdAt: string;
}

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
    active: { label: "Active", icon: <CheckCircle2 className="w-3.5 h-3.5" />, cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    trialing: { label: "Trial", icon: <Clock className="w-3.5 h-3.5" />, cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    past_due: { label: "Past Due", icon: <AlertTriangle className="w-3.5 h-3.5" />, cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    canceled: { label: "Canceled", icon: <XCircle className="w-3.5 h-3.5" />, cls: "bg-red-500/15 text-red-400 border-red-500/30" },
    none: { label: "No Subscription", icon: <XCircle className="w-3.5 h-3.5" />, cls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
  };
  const c = configs[status] ?? configs["none"]!;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${c.cls}`}>
      {c.icon} {c.label}
    </span>
  );
}

export default function Billing() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [packLoading, setPackLoading] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [txnLoading, setTxnLoading] = useState(false);

  // Check if we just bought credits (Stripe redirected back with ?credits_added=N)
  const params = new URLSearchParams(window.location.search);
  const creditsAdded = params.get("credits_added");

  const fetchTransactions = useCallback(async () => {
    setTxnLoading(true);
    try {
      const res = await fetch("/api/billing/transactions", { credentials: "include" });
      if (res.ok) {
        const d = await res.json() as { transactions: CreditTransaction[] };
        setTransactions(d.transactions);
      }
    } catch {
      // ignore
    } finally {
      setTxnLoading(false);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const [statusRes, plansRes] = await Promise.all([
        fetch("/api/billing/status", { credentials: "include" }),
        fetch("/api/billing/plans"),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json() as BillingStatus);
      if (plansRes.ok) {
        const d = await plansRes.json() as { creditPacks: CreditPack[] };
        setPacks(d.creditPacks);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchTransactions();
  }, [fetchStatus, fetchTransactions]);

  async function handlePortal() {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const d = await res.json() as { url?: string; error?: string };
      if (d.url) window.location.href = d.url;
      else alert(d.error ?? "Could not open billing portal");
    } catch {
      alert("Network error — please try again");
    } finally {
      setPortalLoading(false);
    }
  }

  async function handleBuyPack(packKey: string) {
    setPackLoading(packKey);
    try {
      const res = await fetch("/api/billing/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ packKey }),
      });
      const d = await res.json() as { url?: string; error?: string };
      if (d.url) window.location.href = d.url;
      else alert(d.error ?? "Could not start checkout");
    } catch {
      alert("Network error — please try again");
    } finally {
      setPackLoading(null);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchStatus();
    setRefreshing(false);
  }

  const hasSubscription = status && status.subscriptionStatus !== "none" && status.subscriptionStatus !== "canceled";
  const isPastDue = status?.subscriptionStatus === "past_due";
  const isActive = status?.subscriptionStatus === "active" || status?.subscriptionStatus === "trialing";
  const periodEnd = status?.creditsPeriodEnd ? new Date(status.creditsPeriodEnd) : null;
  const creditPct = status ? Math.min(100, (status.creditsRemaining / 1000) * 100) : 0;

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Billing & Credits</h1>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Credits added banner */}
        {creditsAdded && (
          <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-300 font-medium">
              +{creditsAdded} credits added to your account!
            </p>
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-28 rounded-xl bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : !hasSubscription ? (
          /* No active subscription */
          <div className="rounded-xl border border-border bg-muted/20 p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-muted/40 flex items-center justify-center mx-auto">
              <Zap className="w-7 h-7 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">No active subscription</h2>
              <p className="text-muted-foreground text-sm mt-1">
                Subscribe to unlock VIBA's collaborative AI orchestration — 7-day free trial, no charge until day 8.
              </p>
            </div>
            <button
              onClick={() => setLocation("/pricing")}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-6 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Start Free Trial
            </button>
          </div>
        ) : (
          <>
            {/* Past-due warning */}
            {isPastDue && (
              <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-4">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <p className="text-sm font-semibold text-amber-300">Payment failed — please update your card</p>
                  <p className="text-xs text-amber-400/80">
                    Your services remain active while we retry. Update your payment details to avoid suspension.
                    Your data is safe and will never be deleted.
                  </p>
                  <button
                    onClick={handlePortal}
                    disabled={portalLoading}
                    className="inline-flex items-center gap-1.5 text-xs bg-amber-500 text-black font-semibold rounded-lg px-4 py-2 hover:bg-amber-400 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {portalLoading ? "Opening…" : "Update Card Details"}
                  </button>
                </div>
              </div>
            )}

            {/* Subscription card */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1.5">Subscription</p>
                  <StatusBadge status={status!.subscriptionStatus} />
                </div>
                {isActive && (
                  <button
                    onClick={handlePortal}
                    disabled={portalLoading}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {portalLoading ? "Opening…" : "Manage"}
                  </button>
                )}
              </div>
              {periodEnd && (
                <p className="text-xs text-muted-foreground">
                  {status!.subscriptionStatus === "trialing"
                    ? `Trial ends ${periodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
                    : `Renews ${periodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                VIBA Member — $50/month · 1,000 credits per billing period
              </p>
            </div>

            {/* Credits card */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Credits Remaining</p>
              <div className="flex items-end gap-3">
                <span className="text-4xl font-bold tabular-nums">
                  {(status!.creditsRemaining).toLocaleString()}
                </span>
                <span className="text-muted-foreground text-sm mb-1">/ 1,000 this period</span>
              </div>
              {/* Progress bar */}
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${creditPct}%`,
                    background: creditPct > 30
                      ? "linear-gradient(90deg,#2563eb,#7c3aed)"
                      : creditPct > 10
                        ? "linear-gradient(90deg,#d97706,#f59e0b)"
                        : "linear-gradient(90deg,#dc2626,#ef4444)",
                  }}
                />
              </div>
              {status!.creditsRemaining <= 0 && (
                <p className="text-xs text-red-400 font-medium">
                  ⚠ No credits remaining — AI services are paused. Buy a top-up pack below to continue.
                </p>
              )}
              {status!.creditsRemaining > 0 && status!.creditsRemaining <= 100 && (
                <p className="text-xs text-amber-400 font-medium">
                  ⚠ Credits running low — consider topping up.
                </p>
              )}
              {periodEnd && status!.creditsRemaining > 0 && (
                <p className="text-xs text-muted-foreground">
                  Resets automatically on {periodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                </p>
              )}
            </div>

            {/* Top-up packs */}
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold">Top up credits</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Credits are added instantly after payment. They carry over until your subscription ends.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {packs.map((pack) => (
                  <div
                    key={pack.key}
                    className="relative rounded-xl border border-border bg-muted/20 hover:bg-muted/30 transition-colors p-4 flex flex-col gap-3"
                  >
                    {pack.badge && (
                      <span className="absolute -top-2 left-4 bg-amber-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {pack.badge}
                      </span>
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground">{pack.label}</p>
                      <p className="text-2xl font-bold mt-0.5">{fmt(pack.unitAmount)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{pack.description}</p>
                    </div>
                    <button
                      onClick={() => handleBuyPack(pack.key)}
                      disabled={packLoading === pack.key}
                      className="w-full py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-sm font-medium disabled:opacity-60 transition-colors"
                    >
                      {packLoading === pack.key ? "Loading…" : `Buy ${pack.description}`}
                    </button>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground text-center">
                All payments secured by Stripe. Credits are non-refundable but never expire while your membership is active.
              </p>
            </div>
          </>
        )}
        {/* Credit Usage History */}
        {(transactions.length > 0 || txnLoading) && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-semibold">Credit Usage History</h2>
            </div>
            {txnLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-11 rounded-lg bg-muted/30 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                {transactions.map((txn) => {
                  const isGrant = txn.amount > 0;
                  const label = txn.reason === "agent_run"
                    ? txn.sessionId ? `Agent run · session #${txn.sessionId}` : "Agent run"
                    : txn.reason === "monthly_renewal" ? "Monthly credit refresh"
                    : txn.reason === "credit_pack" ? "Credit pack purchase"
                    : txn.reason === "trial_grant" ? "Trial credits"
                    : txn.reason;
                  return (
                    <div key={txn.id} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isGrant ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                          {isGrant
                            ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                            : <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-foreground">{label}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(txn.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-4">
                        <p className={`font-semibold tabular-nums ${isGrant ? "text-emerald-400" : "text-red-400"}`}>
                          {isGrant ? "+" : ""}{txn.amount.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">{txn.balanceAfter.toLocaleString()} left</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
