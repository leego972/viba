import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Check, Zap, Star, Shield, Clock } from "lucide-react";

interface Plan {
  name: string;
  unitAmount: number;
  currency: string;
  monthlyCredits: number;
  trialDays: number;
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
  creditPacks: CreditPack[];
}

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

function defaultFeatures(plan?: Plan) {
  const monthlyCredits = plan?.monthlyCredits ?? 1000;
  return [
    `${monthlyCredits.toLocaleString()} credits per month included`,
    "Included monthly credits reset each billing month and do not accumulate",
    "Trial users get 500 credits per day for 3 days",
    "Full multi-agent orchestration workspace",
    "Website/project review, repair planning, and implementation sessions",
    "Background full-run mode continues after the user exits",
    "Task routing, cost tracking, and audit logs",
    "Human approval gate for high-stakes actions",
    "Full session history across web, Android, and iOS hybrid app",
  ];
}

export default function Pricing() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [plans, setPlans] = useState<PlansData | null>(null);
  const [plansLoading, setPlansLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [packLoading, setPackLoading] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/plans")
      .then((r) => r.json())
      .then((d) => setPlans(d as PlansData))
      .catch(() => {})
      .finally(() => setPlansLoading(false));
  }, []);

  async function handleSubscribe() {
    if (!isAuthenticated) {
      setLocation("/signup?next=/pricing");
      return;
    }

    setCheckoutLoading(true);
    setCheckoutError("");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (res.status === 409) {
        setLocation("/billing");
        return;
      }
      if (!res.ok || !data.url) {
        setCheckoutError(data.error ?? "Something went wrong — please try again.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setCheckoutError("Network error — please check your connection.");
    } finally {
      setCheckoutLoading(false);
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
        alert(data.error ?? "Could not start checkout — please try again.");
        return;
      }
      window.location.href = data.url;
    } catch {
      alert("Network error — please check your connection.");
    } finally {
      setPackLoading(null);
    }
  }

  const plan = plans?.plan;
  const packs = plans?.creditPacks ?? [];
  const trialDays = plan?.trialDays ?? 3;
  const monthlyCredits = plan?.monthlyCredits ?? 1000;
  const features = defaultFeatures(plan);

  return (
    <div
      className="min-h-screen text-white"
      style={{ background: "linear-gradient(135deg,#0a0e1a 0%,#0d1224 60%,#080b16 100%)" }}
    >
      <nav className="flex items-center justify-between px-6 py-5 max-w-5xl mx-auto">
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

      <div className="max-w-5xl mx-auto px-6 py-16 space-y-20">
        <div className="text-center space-y-4">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            Run AI build work with <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-violet-400">VIBA credits</span>
          </h1>
          <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
            Start with a {trialDays}-day trial. Trial credits reset to 500 each day, so users can test real work without banking a large free balance. Paid membership includes {monthlyCredits.toLocaleString()} credits each month.
          </p>
        </div>

        <div className="max-w-lg mx-auto">
          {plansLoading ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 h-96 animate-pulse" />
          ) : (
            <div className="relative rounded-2xl border border-blue-500/30 bg-gradient-to-b from-blue-950/40 to-zinc-900/60 overflow-hidden shadow-2xl shadow-blue-900/20">
              <div className="absolute top-0 right-0 m-4">
                <span className="flex items-center gap-1.5 bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded-full">
                  <Star className="w-3 h-3" />
                  {trialDays}-day trial
                </span>
              </div>

              <div className="p-8 space-y-6">
                <div>
                  <p className="text-sm font-medium text-blue-400 uppercase tracking-widest mb-2">{plan?.name ?? "VIBA Member"}</p>
                  <div className="flex items-end gap-2">
                    <span className="text-5xl font-bold">{plan ? fmt(plan.unitAmount) : "$50"}</span>
                    <span className="text-zinc-400 mb-1">/month</span>
                  </div>
                  <p className="text-zinc-500 text-sm mt-1">{monthlyCredits.toLocaleString()} credits reset each billing month. Unused included monthly credits do not accumulate.</p>
                </div>

                <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">
                  <div className="flex gap-2 font-semibold mb-1"><Clock className="w-4 h-4 mt-0.5" /> Trial allowance</div>
                  <p className="text-amber-100/80">Trial credits reset to 500 daily for 3 days. This is enough for a real review, a written fix plan, or small repairs, while larger full-fix workflows continue after upgrading.</p>
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
                  {checkoutError && <p className="text-sm text-red-400 text-center">{checkoutError}</p>}
                  <button
                    onClick={handleSubscribe}
                    disabled={checkoutLoading || authLoading}
                    className="w-full py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 disabled:opacity-60 transition-all shadow-lg shadow-blue-900/40"
                  >
                    {checkoutLoading ? "Redirecting to Stripe…" : authLoading ? "Loading…" : isAuthenticated ? "Start Trial" : "Sign up & Start Trial"}
                  </button>
                  <p className="text-center text-xs text-zinc-500 flex items-center justify-center gap-1.5">
                    <Shield className="w-3 h-3" /> Secure Stripe checkout. Cancel from Billing before renewal.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-8">
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-2 text-zinc-300 font-semibold text-lg">
              <Zap className="w-5 h-5 text-amber-400" /> Need more credits?
            </div>
            <p className="text-zinc-500 text-sm">When a session pauses because credits finish, buy another {monthlyCredits.toLocaleString()}-credit pack for $50 or wait for monthly renewal.</p>
          </div>

          {plansLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
              <div className="h-36 rounded-xl bg-white/5 animate-pulse" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
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
                    disabled={packLoading === pack.key}
                    className="mt-auto text-sm py-2.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-60 transition-colors font-medium"
                  >
                    {packLoading === pack.key ? "Opening…" : `Buy ${pack.credits.toLocaleString()} credits`}
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
