import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Check, Zap, Star, Shield, Compass, FileCheck2, TrendingUp } from "lucide-react";

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

const MEMBERSHIP_FEATURES = [
  "AI Business Asset Passport workflow",
  "Research, design, build, verify, score, improve, and monetise operating chain",
  "Growth Engine with proof gates, readiness score, revenue path, and next best action",
  "Workbench with guarded analysis, quality gate, risk flags, and review packet",
  "Role-based agent sessions for strategy, research, building, testing, risk, monetisation, and verification",
  "Workspace context for repos, builds, specs, logs, screenshots, and business documents",
  "Human approval model for high-risk or business-critical actions",
  "Session history and operating records for professional follow-up"
];

const PASSPORT_OUTCOMES = [
  { title: "Know what matters", text: "Research the system, buyer, risk, offer, and evidence before spending time or money." },
  { title: "Build with control", text: "Turn work into clear tasks, agent roles, implementation steps, and reviewable outputs." },
  { title: "Verify before selling", text: "Use proof gates, quality checks, and readiness scoring before calling an asset ready." },
  { title: "Improve the revenue path", text: "Package reports, campaigns, repair sprints, retainers, and next actions from the work." },
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
  const monthlyCredits = plan?.monthlyCredits ?? 1000;

  return (
    <div
      className="min-h-screen text-white"
      style={{ background: "radial-gradient(circle at top left, rgba(20,184,166,0.22), transparent 32%), linear-gradient(135deg,#070b16 0%,#0d1224 58%,#070914 100%)" }}
    >
      <nav className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <button onClick={() => setLocation("/")} className="flex items-center gap-2 text-left">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-950 font-bold">V</span>
          <span className="text-lg font-bold tracking-tight text-white">VIBA</span>
        </button>
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
                onClick={() => setLocation("/dashboard")}
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

      <div className="max-w-6xl mx-auto px-6 py-14 space-y-16">
        <section className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-400/25 bg-teal-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-teal-200">
              <Compass className="h-3.5 w-3.5" /> AI Business Asset Passport
            </div>
            <div className="space-y-4">
              <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
                Membership for businesses that need assets built, verified, and improved.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-zinc-300">
                VIBA researches, designs, builds, verifies, scores, improves, and monetises the systems your business depends on. The membership gives professionals a proof-led operating system, not another loose AI chat box.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MiniMetric icon={FileCheck2} label="Proof-led" value="Gates before done" />
              <MiniMetric icon={TrendingUp} label="Commercial" value="Revenue path" />
              <MiniMetric icon={Shield} label="Private" value="No shame board" />
            </div>
          </div>

          <div className="max-w-lg lg:ml-auto">
            {plansLoading ? (
              <div className="rounded-3xl border border-white/10 bg-white/5 h-[560px] animate-pulse" />
            ) : (
              <div className="relative overflow-hidden rounded-3xl border border-teal-400/30 bg-gradient-to-b from-teal-950/35 to-zinc-950/70 shadow-2xl shadow-teal-950/30">
                <div className="absolute right-5 top-5">
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white">
                    <Star className="h-3 w-3" /> {plan?.trialDays ?? 7}-day trial
                  </span>
                </div>

                <div className="p-8 space-y-6">
                  <div>
                    <p className="text-sm font-medium text-teal-300 uppercase tracking-widest mb-2">
                      {plan?.name ?? "VIBA Passport Membership"}
                    </p>
                    <div className="flex items-end gap-2">
                      <span className="text-5xl font-bold">{plan ? fmt(plan.unitAmount) : "$50"}</span>
                      <span className="text-zinc-400 mb-1">/month</span>
                    </div>
                    <p className="text-zinc-500 text-sm mt-2">
                      Includes {monthlyCredits.toLocaleString()} monthly credits. Extra credits are optional.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-sm font-semibold text-white">Best for</p>
                    <p className="mt-1 text-sm leading-6 text-zinc-400">
                      Professionals, founders, agencies, consultants, builders, and business owners who need systems researched, designed, built, checked, improved, and packaged into sellable assets.
                    </p>
                  </div>

                  <ul className="space-y-3">
                    {MEMBERSHIP_FEATURES.map((f) => (
                      <li key={f} className="flex items-start gap-3 text-sm text-zinc-300">
                        <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="space-y-3 pt-2">
                    {checkoutError && (
                      <p className="text-sm text-red-400 text-center">{checkoutError}</p>
                    )}
                    <button
                      onClick={handleSubscribe}
                      disabled={checkoutLoading || authLoading}
                      className="w-full rounded-xl bg-gradient-to-r from-teal-500 to-blue-600 py-3.5 font-semibold text-white shadow-lg shadow-teal-950/40 transition-all hover:from-teal-400 hover:to-blue-500 disabled:opacity-60"
                    >
                      {checkoutLoading
                        ? "Redirecting to Stripe…"
                        : authLoading
                          ? "Loading…"
                          : isAuthenticated
                            ? "Start Passport Membership"
                            : "Sign up & Start Trial"}
                    </button>
                    <p className="text-center text-xs text-zinc-500 flex items-center justify-center gap-1.5">
                      <Shield className="w-3 h-3" />
                      No charge until trial ends. Card required. Cancel anytime.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          {PASSPORT_OUTCOMES.map((item) => (
            <article key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-xl shadow-black/10">
              <p className="font-semibold text-white">{item.title}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{item.text}</p>
            </article>
          ))}
        </section>

        <section className="space-y-8">
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-2 text-zinc-200 font-semibold text-lg">
              <Zap className="w-5 h-5 text-amber-400" />
              Need more execution credits?
            </div>
            <p className="text-zinc-500 text-sm">
              Top up when you need heavier research, build, verification, or multi-agent work.
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
                  className="relative rounded-xl border border-white/10 bg-white/[0.04] p-4 flex flex-col gap-3 transition-all hover:border-white/20 hover:bg-white/[0.07]"
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
                    className="mt-auto rounded-lg bg-white/10 py-2 text-xs font-medium transition-colors hover:bg-white/20 disabled:opacity-60"
                  >
                    {packLoading === pack.key ? "…" : "Buy credits"}
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="text-center text-xs text-zinc-600">
            Credit packs require an active VIBA membership. Credits remain available while your membership is active.
          </p>
        </section>
      </div>
    </div>
  );
}

function MiniMetric({ icon: Icon, label, value }: { icon: typeof FileCheck2; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <Icon className="h-5 w-5 text-teal-300" />
      <p className="mt-3 text-xs uppercase tracking-[0.16em] text-zinc-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}
