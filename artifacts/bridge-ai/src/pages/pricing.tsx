import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Check, Zap, Star, Shield, Clock } from "lucide-react";

interface Plan {
  key: string;
  name: string;
  unitAmount: number;
  currency: string;
  monthlyCredits: number;
  trialDays: number;
  trialDailyCredits?: number;
  badge?: string | null;
  configured: boolean;
}

interface CreditPack {
  key: string;
  label: string;
  description: string;
  credits: number;
  unitAmount: number;
  badge: string | null;
  configured: boolean;
}

interface PlansData {
  plan: Plan;
  plans?: Plan[];
  proPlan?: Plan;
  creditPacks: CreditPack[];
}

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

function planFeatures(plan: Plan, isPro: boolean) {
  return [
    `${plan.monthlyCredits.toLocaleString()} credits per month included`,
    isPro ? "Best value for heavier monthly usage" : "Good entry plan for serious solo usage",
    "Included monthly credits reset each billing month and do not accumulate",
    `Trial users get ${Number(plan.trialDailyCredits ?? 500).toLocaleString()} credits per day for ${plan.trialDays} days`,
    "Normal chat is free; credits are deducted only when agents perform billable task actions",
    "Complexity-based credit usage for agent task actions",
    "Background full-run mode continues after the user exits",
    "Task routing, cost tracking, and audit logs",
    "Human approval gate for high-stakes actions",
    "Shared web, Android, and iOS hybrid app surface",
  ];
}

function fallbackPlans(data: PlansData | null): Plan[] {
  if (data?.plans?.length) return data.plans;
  const member = data?.plan ?? {
    key: "viba_member",
    name: "VIBA Member",
    unitAmount: 5000,
    currency: "usd",
    monthlyCredits: 1500,
    trialDays: 3,
    trialDailyCredits: 500,
    badge: "Member",
    configured: true,
  };
  const pro = data?.proPlan ?? {
    key: "viba_pro",
    name: "VIBA Pro",
    unitAmount: 15000,
    currency: "usd",
    monthlyCredits: 6000,
    trialDays: member.trialDays,
    trialDailyCredits: member.trialDailyCredits ?? 500,
    badge: "Best Value",
    configured: member.configured,
  };
  return [member, pro];
}

export default function Pricing() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [plansData, setPlansData] = useState<PlansData | null>(null);
  const [plansLoading, setPlansLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState("");
  const [packLoading, setPackLoading] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/plans")
      .then((r) => r.json())
      .then((d) => setPlansData(d as PlansData))
      .catch(() => {})
      .finally(() => setPlansLoading(false));
  }, []);

  async function handleSubscribe(planKey: string) {
    if (!isAuthenticated) {
      setLocation(`/signup?next=/pricing&plan=${encodeURIComponent(planKey)}`);
      return;
    }

    setCheckoutLoading(planKey);
    setCheckoutError("");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ planKey }),
      });
      const data = (await res.json()) as { url?: string; error?: string; message?: string };
      if (res.status === 409) {
        setLocation("/billing");
        return;
      }
      if (!res.ok || !data.url) {
        setCheckoutError(data.message ?? data.error ?? "Something went wrong. Please try again.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setCheckoutError("Network error. Please check your connection.");
    } finally {
      setCheckoutLoading(null);
    }
  }

  async function handleBuyPack(packKey: string) {
    if (!isAuthenticated) {
      setLocation("/login?next=/billing");
      return;
    }
    setPackLoading(packKey);
    try {
      const res = await fetch("/api/billing/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ packKey }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        alert(data.error ?? "Could not start checkout. Please try again.");
        return;
      }
      window.location.href = data.url;
    } catch {
      alert("Network error. Please check your connection.");
    } finally {
      setPackLoading(null);
    }
  }

  const planOptions = fallbackPlans(plansData);
  const packs = plansData?.creditPacks ?? [];
  const trialDays = planOptions[0]?.trialDays ?? 3;
  const trialCredits = planOptions[0]?.trialDailyCredits ?? 500;

  return (
    <div
      className="min-h-screen text-white"
      style={{ background: "linear-gradient(135deg,#0a0e1a 0%,#0d1224 60%,#080b16 100%)" }}
    >
      <nav className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <span className="text-lg font-bold tracking-tight text-white">VIBA</span>
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <>
              <button onClick={() => setLocation("/billing")} className="text-sm text-zinc-400 hover:text-white transition-colors">Billing</button>
              <button onClick={() => setLocation("/dashboard")} className="text-sm bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg px-4 py-1.5 transition-colors">Dashboard</button>
            </>
          ) : (
            <>
              <button onClick={() => setLocation("/login")} className="text-sm text-zinc-400 hover:text-white transition-colors">Log in</button>
              <button onClick={() => setLocation("/signup")} className="text-sm bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg px-4 py-1.5 transition-colors">Sign up</button>
            </>
          )}
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-16 space-y-20">
        <div className="text-center space-y-4">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            Choose the right <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-violet-400">VIBA credit plan</span>
          </h1>
          <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
            Start with a {trialDays}-day trial. Trial credits reset to {trialCredits.toLocaleString()} each day. Paid plans include monthly credits for billable agent task actions, with top-ups available when usage spikes.
          </p>
        </div>

        <div className="max-w-5xl mx-auto">
          {plansLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="rounded-2xl border border-white/10 bg-white/5 h-96 animate-pulse" />
              <div className="rounded-2xl border border-white/10 bg-white/5 h-96 animate-pulse" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {planOptions.map((plan) => {
                const isPro = plan.key === "viba_pro" || plan.monthlyCredits >= 6000;
                const features = planFeatures(plan, isPro);
                return (
                  <div
                    key={plan.key}
                    className={`relative rounded-2xl border overflow-hidden shadow-2xl ${isPro ? "border-violet-500/40 bg-gradient-to-b from-violet-950/40 to-zinc-900/60 shadow-violet-900/20" : "border-blue-500/30 bg-gradient-to-b from-blue-950/35 to-zinc-900/60 shadow-blue-900/20"}`}
                  >
                    <div className="absolute top-0 right-0 m-4">
                      <span className={`flex items-center gap-1.5 text-white text-xs font-semibold px-3 py-1.5 rounded-full ${isPro ? "bg-violet-500" : "bg-emerald-500"}`}>
                        <Star className="w-3 h-3" />
                        {plan.badge ?? (isPro ? "Best Value" : `${trialDays}-day trial`)}
                      </span>
                    </div>

                    <div className="p-8 space-y-6">
                      <div>
                        <p className={`text-sm font-medium uppercase tracking-widest mb-2 ${isPro ? "text-violet-300" : "text-blue-400"}`}>{plan.name}</p>
                        <div className="flex items-end gap-2">
                          <span className="text-5xl font-bold">{fmt(plan.unitAmount)}</span>
                          <span className="text-zinc-400 mb-1">/month</span>
                        </div>
                        <p className="text-zinc-500 text-sm mt-1">{plan.monthlyCredits.toLocaleString()} credits reset each billing month. Unused included monthly credits do not accumulate.</p>
                      </div>

                      <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">
                        <div className="flex gap-2 font-semibold mb-1"><Clock className="w-4 h-4 mt-0.5" /> Trial allowance</div>
                        <p className="text-amber-100/80">Trial credits reset to {trialCredits.toLocaleString()} daily for {trialDays} days. Larger workflows can continue after upgrading.</p>
                      </div>

                      <ul className="space-y-3">
                        {features.map((f) => (
                          <li key={f} className="flex items-start gap-3 text-sm text-zinc-300">
                            <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                            {f}
                          </li>
                        ))}
                      </ul>

                      <div className="space-y-3">
                        <button
                          onClick={() => handleSubscribe(plan.key)}
                          disabled={checkoutLoading === plan.key || Boolean(checkoutLoading) || authLoading || !plan.configured}
                          className={`w-full py-3.5 rounded-xl font-semibold text-white disabled:opacity-60 transition-all shadow-lg ${isPro ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 shadow-violet-900/40" : "bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 shadow-blue-900/40"}`}
                        >
                          {checkoutLoading === plan.key ? "Redirecting to Stripe..." : authLoading ? "Loading..." : isAuthenticated ? `Start ${plan.name}` : `Sign up & Start ${plan.name}`}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {checkoutError && <p className="text-sm text-red-400 text-center mt-5">{checkoutError}</p>}
          <p className="text-center text-xs text-zinc-500 flex items-center justify-center gap-1.5 mt-5">
            <Shield className="w-3 h-3" /> Secure Stripe checkout. Cancel or manage billing from Billing.
          </p>
        </div>

        <div className="space-y-8">
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-2 text-zinc-300 font-semibold text-lg">
              <Zap className="w-5 h-5 text-amber-400" /> Need more credits?
            </div>
            <p className="text-zinc-500 text-sm">Top up from $50 to $300. Every $50 adds 1,000 credits. Top-ups are best for overflow usage; Pro is better value for steady heavy usage.</p>
          </div>

          {plansLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl mx-auto">
              <div className="h-36 rounded-xl bg-white/5 animate-pulse" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl mx-auto">
              {packs.map((pack) => (
                <div key={pack.key} className="relative rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 hover:border-white/20 transition-all p-5 flex flex-col gap-4">
                  {pack.badge && (
                    <span className="absolute -top-2 left-5 bg-amber-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">{pack.badge}</span>
                  )}
                  <div>
                    <p className="text-xs text-zinc-500 font-medium">{pack.label}</p>
                    <p className="text-3xl font-bold mt-0.5">{fmt(pack.unitAmount)}</p>
                    <p className="text-sm text-zinc-400 mt-0.5">{pack.credits.toLocaleString()} credits</p>
                  </div>
                  <button
                    onClick={() => handleBuyPack(pack.key)}
                    disabled={packLoading === pack.key || !pack.configured}
                    className="mt-auto text-sm py-2.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-60 transition-colors font-medium"
                  >
                    {packLoading === pack.key ? "Opening..." : `Buy ${pack.credits.toLocaleString()} credits`}
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="text-center text-xs text-zinc-600">Credit packs require an active VIBA membership. Bought top-up credits are added immediately; included monthly credits reset rather than stacking.</p>
        </div>
      </div>
    </div>
  );
}
