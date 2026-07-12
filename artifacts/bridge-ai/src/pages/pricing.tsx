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

const FEATURES = [
  "1,000 diagnostic credits per month",
  "Ranked findings — Critical → High → Warning → Informational",
  "Evidence table with every check and its result",
  "Owner approval required before any high-risk action",
  "Browser, security, route, and code evidence checks",
  "All 6 providers: ChatGPT, Claude, Gemini, Perplexity, Replit, Manus",
  "Full session history — data never deleted, audit trail always intact",
];

export default function Pricing() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [plansData, setPlansData] = useState<PlansData | null>(null);
  const [plansLoading, setPlansLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [annualCheckoutLoading, setAnnualCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [packLoading, setPackLoading] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/plans")
      .then((r) => r.json())
      .then((d) => setPlansData(d as PlansData))
      .catch(() => {})
      .finally(() => setPlansLoading(false));
  }, []);

  async function handleSubscribe(planKey: string = "pro_repair") {
    if (!isAuthenticated) {
      setLocation(`/signup?next=/pricing`);
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

  async function handleSubscribeAnnual() {
    if (!isAuthenticated) {
      setLocation("/signup?next=/pricing");
      return;
    }
    setAnnualCheckoutLoading(true);
    setCheckoutError("");
    try {
      const res = await fetch("/api/billing/checkout/annual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (res.status === 409) { setLocation("/billing"); return; }
      if (!res.ok || !data.url) {
        setCheckoutError(data.error ?? "Something went wrong — please try again.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setCheckoutError("Network error. Please check your connection.");
    } finally {
      setAnnualCheckoutLoading(false);
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

      <div className="max-w-5xl mx-auto px-6 py-16 space-y-20">
        {/* Hero */}
        <div className="text-center space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold border border-indigo-500/30 bg-indigo-500/10 text-indigo-300">
            Evidence-backed AI technical operations
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            Professional technical diagnosis{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-violet-400">
              without hiring a full engineering team.
            </span>
          </h1>
          <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
            Use VIBA to inspect, audit, repair-plan, and verify websites, repositories, and deployments — with evidence-backed reports your team can act on.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-zinc-500 pt-1">
            {["Cancel anytime", "Human approval before high-risk actions", "No hidden deletion of user data", "Evidence-backed reports"].map(r => (
              <span key={r} className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-emerald-500" />{r}
              </span>
            ))}
          </div>
        </div>

        {/* Plan cards — monthly and annual */}
        <div className="max-w-3xl mx-auto">
          {plansLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="rounded-2xl border border-white/10 bg-white/5 h-96 animate-pulse" />
              <div className="rounded-2xl border border-white/10 bg-white/5 h-96 animate-pulse" />
            </div>
          ) : (
            <>
              {checkoutError && (
                <p className="text-sm text-red-400 text-center mb-4">{checkoutError}</p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* Basic Assessment */}
                <div className="relative rounded-2xl border border-white/10 bg-white/5 overflow-hidden flex flex-col">
                  <div className="absolute top-0 right-0 m-4">
                    <span className="flex items-center gap-1.5 bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded-full">
                      <Star className="w-3 h-3" />
                      7-day free trial
                    </span>
                  </div>
                  <div className="p-8 space-y-6 flex flex-col flex-1">
                    <div>
                      <p className="text-sm font-medium text-zinc-400 uppercase tracking-widest mb-2">Basic Assessment</p>
                      <div className="flex items-end gap-2">
                        <span className="text-5xl font-bold">$25</span>
                        <span className="text-zinc-400 mb-1">/month</span>
                      </div>
                      <p className="text-zinc-500 text-sm mt-1">750 credits per month</p>
                    </div>
                    <ul className="space-y-2.5 flex-1">
                      {["750 credits per month", "Website & code quality scans", "Lighthouse, Axe, SEO technical audit", "Passive security baseline audit", "QA report generation", "1 imported provider (+ Groq free)", "No repair actions"].map((f) => (
                        <li key={f} className="flex items-start gap-3 text-sm text-zinc-300">
                          <Check className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <div className="space-y-3">
                      <button
                        onClick={() => handleSubscribe("basic_assessment")}
                        disabled={checkoutLoading !== null || authLoading}
                        className="w-full py-3.5 rounded-xl font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/10 disabled:opacity-60 transition-all"
                      >
                        {checkoutLoading === "basic_assessment" ? "Redirecting…" : authLoading ? "Loading…" : isAuthenticated ? "Start Basic Trial" : "Sign up & Start Free Trial"}
                      </button>
                      <p className="text-center text-xs text-zinc-500 flex items-center justify-center gap-1.5">
                        <Shield className="w-3 h-3" />
                        No charge until day 8. Cancel anytime.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Pro Repair — recommended */}
                <div className="relative rounded-2xl border border-indigo-500/50 bg-gradient-to-b from-indigo-950/50 to-zinc-900/60 overflow-hidden shadow-2xl shadow-indigo-900/20 flex flex-col">
                  <div className="absolute top-0 left-0 m-4">
                    <span className="bg-indigo-500 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                      RECOMMENDED
                    </span>
                  </div>
                  <div className="absolute top-0 right-0 m-4">
                    <span className="flex items-center gap-1.5 bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded-full">
                      <Star className="w-3 h-3" />
                      7-day free trial
                    </span>
                  </div>
                  <div className="p-8 space-y-6 flex flex-col flex-1">
                    <div>
                      <p className="text-sm font-medium text-indigo-400 uppercase tracking-widest mb-2">Pro Repair</p>
                      <div className="flex items-end gap-2">
                        <span className="text-5xl font-bold">$89</span>
                        <span className="text-zinc-400 mb-1">/month</span>
                      </div>
                      <p className="text-emerald-400 text-sm font-medium mt-1">4,000 credits — 5× more than Basic</p>
                    </div>
                    <ul className="space-y-2.5 flex-1">
                      {FEATURES.map((f) => (
                        <li key={f} className="flex items-start gap-3 text-sm text-zinc-300">
                          <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <div className="space-y-3">
                      <button
                        onClick={() => handleSubscribe("pro_repair")}
                        disabled={checkoutLoading !== null || authLoading}
                        className="w-full py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-60 transition-all shadow-lg shadow-indigo-900/40"
                      >
                        {checkoutLoading === "pro_repair" ? "Redirecting…" : authLoading ? "Loading…" : isAuthenticated ? "Start Pro Trial" : "Sign up & Start Free Trial"}
                      </button>
                      <p className="text-center text-xs text-zinc-500 flex items-center justify-center gap-1.5">
                        <Shield className="w-3 h-3" />
                        No charge until day 8. Cancel anytime.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </>
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

        {/* Buyer reassurance */}
        <div className="border border-white/8 rounded-2xl p-8 text-center space-y-6">
          <h3 className="text-lg font-semibold text-zinc-200">Built for serious operators. Designed to be trusted.</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm text-zinc-400">
            {[
              { icon: Shield, text: "Cancel anytime — no lock-in" },
              { icon: Shield, text: "Human approval before high-risk actions" },
              { icon: Shield, text: "No hidden deletion of your data" },
              { icon: Shield, text: "Evidence-backed reports, not guesses" },
              { icon: Shield, text: "Defensive security only" },
              { icon: Shield, text: "Owner-readable audit trail, always" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2 justify-center sm:justify-start">
                <Icon className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <span>{text}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-600 max-w-lg mx-auto">
            VIBA is a BYOK (bring your own key) platform. Your API keys, session data, and reports stay within your account. No training on your data.
          </p>
        </div>
      </div>
    </div>
  );
}
