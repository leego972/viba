import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Loader2, Zap } from "lucide-react";

type Phase = "loading" | "success" | "timeout";

export default function CheckoutSuccess() {
  const [, setLocation] = useLocation();
  const [phase, setPhase] = useState<Phase>("loading");
  const [credits, setCredits] = useState(0);

  useEffect(() => {
    let attempts = 0;
    const MAX = 20; // 20 × 2 s = 40 s max wait

    const poll = async () => {
      try {
        const res = await fetch("/api/billing/status", { credentials: "include" });
        if (res.ok) {
          const data = (await res.json()) as {
            subscriptionStatus: string;
            creditsRemaining: number;
          };
          const active = data.subscriptionStatus === "active" || data.subscriptionStatus === "trialing";
          if (active && data.creditsRemaining > 0) {
            setCredits(data.creditsRemaining);
            setPhase("success");
            return;
          }
        }
      } catch {
        // network hiccup — keep polling
      }

      attempts++;
      if (attempts >= MAX) {
        setPhase("timeout");
      } else {
        setTimeout(poll, 2000);
      }
    };

    // Small initial delay to let webhook land
    setTimeout(poll, 1500);
  }, []);

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "linear-gradient(135deg,#0a0e1a 0%,#0d1224 60%,#080b16 100%)" }}
    >
      <div className="max-w-md w-full text-center space-y-8">
        {phase === "loading" && (
          <>
            <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto" />
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-white">Setting up your account…</h1>
              <p className="text-zinc-400 text-sm">
                Activating your trial and loading your credits. This takes a few seconds.
              </p>
            </div>
          </>
        )}

        {phase === "success" && (
          <>
            <div className="w-20 h-20 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-white">You're in! 🎉</h1>
              <p className="text-zinc-400 text-sm">
                Your 7-day free trial has started. No charge until day 8.
              </p>
            </div>

            <div className="rounded-2xl border border-blue-500/20 bg-blue-950/30 p-6 space-y-2">
              <div className="flex items-center justify-center gap-2">
                <Zap className="w-5 h-5 text-amber-400" />
                <span className="text-2xl font-bold text-white tabular-nums">
                  {credits.toLocaleString()}
                </span>
                <span className="text-zinc-400">credits ready</span>
              </div>
              <p className="text-xs text-zinc-500">
                Credits refill to 1,000 automatically every billing period
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setLocation("/")}
                className="flex-1 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 transition-all"
              >
                Go to Dashboard
              </button>
              <button
                onClick={() => setLocation("/sessions/new")}
                className="flex-1 py-3 rounded-xl font-semibold border border-white/10 text-white bg-white/5 hover:bg-white/10 transition-colors"
              >
                Start a Session
              </button>
            </div>
          </>
        )}

        {phase === "timeout" && (
          <>
            <div className="w-20 h-20 rounded-full bg-blue-500/15 border border-blue-500/30 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10 text-blue-400" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-white">Payment received!</h1>
              <p className="text-zinc-400 text-sm">
                Your subscription is being activated. It may take a minute to appear — check your billing page.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setLocation("/billing")}
                className="py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 transition-all"
              >
                View Billing
              </button>
              <button
                onClick={() => setLocation("/")}
                className="py-2 text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
              >
                Go to Dashboard
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
