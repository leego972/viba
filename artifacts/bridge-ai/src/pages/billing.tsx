import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { AlertTriangle, CheckCircle2, Clock, XCircle, Zap, RefreshCw, ExternalLink, TrendingDown, TrendingUp, History, ToggleLeft, ToggleRight, ShieldCheck } from "lucide-react";
import { PlanBadge } from "@/components/PlanBadge";

interface AutoTopupConfig { enabled: boolean; threshold: number; packKey: string; }

interface BillingStatus {
  subscriptionStatus: string;
  creditsRemaining: number;
  creditsPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  planKey: string;
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
  const [autoTopup, setAutoTopup] = useState<AutoTopupConfig>({ enabled: false, threshold: 100, packKey: "" });
  const [autoTopupSaving, setAutoTopupSaving] = useState(false);
  const [annualLoading, setAnnualLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const check = () => setIsAdmin(!!sessionStorage.getItem("viba_admin_token"));
    check();
    window.addEventListener("storage", check);
    return () => window.removeEventListener("storage", check);
  }, []);

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
      const [statusRes, plansRes, topupRes] = await Promise.all([
        fetch("/api/billing/status", { credentials: "include" }),
        fetch("/api/billing/plans"),
        fetch("/api/billing/auto-topup", { credentials: "include" }),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json() as BillingStatus);
      if (plansRes.ok) {
        const d = await plansRes.json() as { creditPacks: CreditPack[] };
        setPacks(d.creditPacks);
      }
      if (topupRes.ok) setAutoTopup(await topupRes.json() as AutoTopupConfig);
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

  async function saveAutoTopupToServer(cfg: AutoTopupConfig, rollbackTo: AutoTopupConfig) {
    setAutoTopupSaving(true);
    try {
      const res = await fetch("/api/billing/auto-topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(cfg),
      });
      if (!res.ok) setAutoTopup(rollbackTo);
    } catch {
      setAutoTopup(rollbackTo);
    } finally {
      setAutoTopupSaving(false);
    }
  }

  async function handleSubscribeAnnual() {
    setAnnualLoading(true);
    try {
      const res = await fetch("/api/billing/checkout/annual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const d = await res.json() as { url?: string; error?: string };
      if (res.status === 409) { setLocation("/billing"); return; }
      if (d.url) window.location.href = d.url;
      else alert(d.error ?? "Could not start annual checkout — please try again");
    } catch {
      alert("Network error — please try again");
    } finally {
      setAnnualLoading(false);
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
  const PLAN_CREDITS: Record<string, number> = {
    basic_assessment: 750,
    pro_repair: 4000,
    viba_monthly: 1000,
    viba_annual: 23400,
  };
  const totalCredits = PLAN_CREDITS[status?.planKey ?? "basic_assessment"] ?? 750;
  const creditPct = status ? Math.min(100, (status.creditsRemaining / totalCredits) * 100) : 0;

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Billing & Credits</h1>
            {status?.planKey && <PlanBadge planKey={status.planKey} />}
          </div>
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
          /* No active subscription — show monthly and annual plan cards */
          <div className="rounded-xl border border-border bg-muted/20 p-6 space-y-5">
            <div className="text-center space-y-1">
              <h2 className="text-lg font-semibold">Choose your plan</h2>
              <p className="text-muted-foreground text-sm">7-day free trial — no charge until day 8.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Basic */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Basic Assessment</p>
                  <p className="text-2xl font-bold">$25<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                  <p className="text-xs text-muted-foreground mt-1">750 credits per month · scans & reports</p>
                </div>
                <button
                  onClick={() => setLocation("/pricing")}
                  className="w-full py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-sm font-medium transition-colors"
                >
                  Start Basic Trial
                </button>
              </div>
              {/* Pro Repair */}
              <div className="relative rounded-xl border border-indigo-500/40 bg-indigo-500/5 p-5 space-y-3">
                <span className="absolute -top-2.5 left-4 bg-indigo-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                  RECOMMENDED
                </span>
                <div>
                  <p className="text-xs text-indigo-400 uppercase tracking-wider font-medium mb-1">Pro Repair</p>
                  <p className="text-2xl font-bold">$89<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                  <p className="text-xs text-emerald-400 font-medium mt-1">4,000 credits · repairs · multi-agent</p>
                </div>
                <button
                  onClick={() => setLocation("/pricing")}
                  className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"
                >
                  Start Pro Trial
                </button>
              </div>
            </div>
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
                  <div className="flex items-center gap-2">
                    <StatusBadge status={status!.subscriptionStatus} />
                    {isAdmin && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border bg-red-500/15 text-red-400 border-red-500/30">
                        <ShieldCheck className="w-3.5 h-3.5" /> Admin
                      </span>
                    )}
                  </div>
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
                {status?.planKey === "viba_annual"
                  ? "VIBA Pro — Annual · $600/year · 23,400 credits per year"
                  : status?.planKey === "pro_repair"
                  ? "VIBA Pro Repair · $89/month · 4,000 credits per month"
                  : status?.planKey === "basic_assessment"
                  ? "VIBA Basic Assessment · $25/month · 750 credits per month"
                  : "VIBA Member · 1,000 credits per month"}
              </p>
            </div>

            {/* Credits card */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Credits Remaining</p>
              <div className="flex items-end gap-3">
                <span className="text-4xl font-bold tabular-nums">
                  {isAdmin ? "∞" : (status!.creditsRemaining).toLocaleString()}
                </span>
                {!isAdmin && (
                  <span className="text-muted-foreground text-sm mb-1">/ {totalCredits.toLocaleString()} this period</span>
                )}
              </div>
              {/* Progress bar — hidden for admin */}
              {!isAdmin && (
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
              )}
              {!isAdmin && status!.creditsRemaining <= 0 && (
                <p className="text-xs text-red-400 font-medium">
                  ⚠ No credits remaining — AI services are paused. Buy a top-up pack below to continue.
                </p>
              )}
              {!isAdmin && status!.creditsRemaining > 0 && status!.creditsRemaining <= 100 && (
                <p className="text-xs text-amber-400 font-medium">
                  ⚠ Credits running low — consider topping up.
                </p>
              )}
              {isAdmin && (
                <p className="text-xs text-red-400/70 font-medium">Admin account — unlimited credits.</p>
              )}
              {periodEnd && status!.creditsRemaining > 0 && (
                <p className="text-xs text-muted-foreground">
                  Resets automatically on {periodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                </p>
              )}
            </div>

            {/* Auto top-up */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Auto Top-Up</p>
                  <p className="text-sm font-medium">Automatically refill when credits run low</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Never have a session paused mid-run due to empty credits.</p>
                </div>
                <button
                  onClick={() => { const prev = autoTopup; const next = { ...autoTopup, enabled: !autoTopup.enabled }; setAutoTopup(next); void saveAutoTopupToServer(next, prev); }}
                  className="shrink-0 ml-4"
                  title={autoTopup.enabled ? "Disable auto top-up" : "Enable auto top-up"}
                  disabled={autoTopupSaving}
                >
                  {autoTopup.enabled
                    ? <ToggleRight className="w-8 h-8 text-primary" />
                    : <ToggleLeft className="w-8 h-8 text-muted-foreground" />}
                </button>
              </div>
              {autoTopup.enabled && (
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground font-medium">Trigger threshold</p>
                    <select
                      className="w-full rounded-lg border border-border bg-background text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                      value={autoTopup.threshold}
                      onChange={e => { const prev = autoTopup; const next = { ...autoTopup, threshold: Number(e.target.value) }; setAutoTopup(next); void saveAutoTopupToServer(next, prev); }}
                    >
                      {[50, 100, 150, 200, 250].map(n => (
                        <option key={n} value={n}>Below {n} credits</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground font-medium">Pack to buy</p>
                    <select
                      className="w-full rounded-lg border border-border bg-background text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                      value={autoTopup.packKey}
                      onChange={e => { const prev = autoTopup; const next = { ...autoTopup, packKey: e.target.value }; setAutoTopup(next); void saveAutoTopupToServer(next, prev); }}
                    >
                      <option value="">Select pack…</option>
                      {packs.map(p => <option key={p.key} value={p.key}>{p.label} — {p.description}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-emerald-300">
                        {autoTopupSaving ? "Saving…" : `When your balance drops below ${autoTopup.threshold} credits, your saved card is charged automatically and credits are added instantly.`}
                      </p>
                    </div>
                  </div>
                </div>
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
          ) : transactions.length === 0 ? (
            <div className="rounded-xl border border-border bg-muted/10 px-6 py-8 text-center">
              <History className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No credit transactions yet.</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Usage will appear here once you start running sessions.</p>
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
                    : txn.reason.startsWith("auto_topup") || txn.reason.startsWith("new subscription") && txn.reason.includes("viba_annual") ? "Annual plan — initial credits"
                    : txn.reason.startsWith("new subscription") ? "New subscription — credits granted"
                    : txn.reason.startsWith("Auto top-up") || txn.reason.toLowerCase().includes("auto top-up") ? "Auto top-up"
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
      </div>
    </AppLayout>
  );
}
