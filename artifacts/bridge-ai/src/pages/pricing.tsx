import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Check, Zap, Star, Shield } from "lucide-react";

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

const FEATURES = [
  "1,000 credits per month included",
  "All 6 AI providers (ChatGPT, Claude, Gemini, Perplexity, Replit, Manus)",
  "Unlimited collaborative sessions",
  "Assign roles & orchestrate agents autonomously",
  "Task routing, cost tracking & audit logs",
  "Human-in-the-loop approval step for high-stakes actions",
  "Full session history — data never deleted",
];

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

  return (
    <div
      className="min-h-screen text-white"
      style={{ background: "linear-gradient(135deg,#0a0e1a 0%,#0d1224 60%,#080b16 100%)" }}
    >
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-5 max-w-5xl mx-auto">
        <span className="text-lg font-bold tracking-tight text-white">VIBA</span>
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <>
              <button
                onClick={() => setLocation("/billing")}
                className="text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Billing
              </button>
              <button
                onClick={() => setLocation("/")}
                className="text-sm bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg px-4 py-1.5 transition-colors"
              >
                Dashboard
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setLocation("/login")}
                className="text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Log in
              </button>
              <button
                onClick={() => setLocation("/signup")}
                className="text-sm bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg px-4 py-1.5 transition-colors"
              >
                Sign up
              </button>
            </>
          )}
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-16 space-y-20">
        {/* Hero */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            Orchestrate AI agents,{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-violet-400">
              together
            </span>
          </h1>
          <p className="text-zinc-400 text-lg max-w-xl mx-auto">
            Connect ChatGPT, Claude, Gemini, Perplexity and more in one session. Assign roles,
            route tasks by capability, and collaborate autonomously.
          </p>
        </div>

        {/* Membership plan card */}
        <div className="max-w-lg mx-auto">
          {plansLoading ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 h-96 animate-pulse" />
          ) : (
            <div className="relative rounded-2xl border border-blue-500/30 bg-gradient-to-b from-blue-950/40 to-zinc-900/60 overflow-hidden shadow-2xl shadow-blue-900/20">
              {/* Trial badge */}
              <div className="absolute top-0 right-0 m-4">
                <span className="flex items-center gap-1.5 bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded-full">
                  <Star className="w-3 h-3" />
                  7-day free trial
                </span>
              </div>

              <div className="p-8 space-y-6">
                {/* Plan header */}
                <div>
                  <p className="text-sm font-medium text-blue-400 uppercase tracking-widest mb-2">
                    {plan?.name ?? "VIBA Member"}
                  </p>
                  <div className="flex items-end gap-2">
                    <span className="text-5xl font-bold">{plan ? fmt(plan.unitAmount) : "$50"}</span>
                    <span className="text-zinc-400 mb-1">/month</span>
                  </div>
                  <p className="text-zinc-500 text-sm mt-1">
                    after your {plan?.trialDays ?? 7}-day free trial ends
                  </p>
                </div>

                {/* Features */}
                <ul className="space-y-3">
                  {FEATURES.map((f) => (
                    <li key={f} className="flex items-start gap-3 text-sm text-zinc-300">
                      <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <div className="space-y-3">
                  {checkoutError && (
                    <p className="text-sm text-red-400 text-center">{checkoutError}</p>
                  )}
                  <button
                    onClick={handleSubscribe}
                    disabled={checkoutLoading || authLoading}
                    className="w-full py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 disabled:opacity-60 transition-all shadow-lg shadow-blue-900/40"
                  >
                    {checkoutLoading
                      ? "Redirecting to Stripe…"
                      : authLoading
                        ? "Loading…"
                        : isAuthenticated
                          ? "Start Free Trial"
                          : "Sign up & Start Free Trial"}
                  </button>
                  <p className="text-center text-xs text-zinc-500 flex items-center justify-center gap-1.5">
                    <Shield className="w-3 h-3" />
                    No charge until day 8. Card required. Cancel anytime.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Credit packs */}
        <div className="space-y-8">
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-2 text-zinc-300 font-semibold text-lg">
              <Zap className="w-5 h-5 text-amber-400" />
              Need more credits?
            </div>
            <p className="text-zinc-500 text-sm">
              Top up anytime — credits are added instantly after payment.
            </p>
          </div>

          {plansLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-36 rounded-xl bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {packs.map((pack) => (
                <div
                  key={pack.key}
                  className="relative rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 hover:border-white/20 transition-all p-4 flex flex-col gap-3"
                >
                  {pack.badge && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-amber-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                      {pack.badge}
                    </span>
                  )}
                  <div>
                    <p className="text-xs text-zinc-500 font-medium">{pack.label}</p>
                    <p className="text-2xl font-bold mt-0.5">{fmt(pack.unitAmount)}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{pack.description}</p>
                  </div>
                  <button
                    onClick={() => handleBuyPack(pack.key)}
                    disabled={packLoading === pack.key}
                    className="mt-auto text-xs py-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-60 transition-colors font-medium"
                  >
                    {packLoading === pack.key ? "…" : "Buy"}
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="text-center text-xs text-zinc-600">
            Credit packs require an active VIBA membership. Credits never expire while your membership is active.
          </p>
        </div>
      </div>
    </div>
  );
}
