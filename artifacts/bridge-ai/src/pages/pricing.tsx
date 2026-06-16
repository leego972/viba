import { useState, type FormEvent } from "react";
import { setSubscriptionToken, getSubscriptionToken } from "@/lib/auth";

async function checkSubscription(token: string): Promise<string | null> {
  const res = await fetch(
    `/api/stripe/subscription?token=${encodeURIComponent(token)}`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { status?: string };
  return data.status ?? null;
}

export default function Pricing() {
  const [email, setEmail] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");

  const [tokenInput, setTokenInput] = useState("");
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState("");

  const [portalToken, setPortalToken] = useState(getSubscriptionToken() ?? "");
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState("");

  const base = import.meta.env.BASE_URL as string;
  const appUrl = base.endsWith("/") ? base.slice(0, -1) : base || "/";

  async function handleCheckout(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setCheckoutLoading(true);
    setCheckoutError("");
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setCheckoutError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setCheckoutError("Network error — please check your connection.");
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function handleTokenSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    setTokenLoading(true);
    setTokenError("");
    try {
      const status = await checkSubscription(trimmed);
      if (status === "active" || status === "trialing") {
        setSubscriptionToken(trimmed);
        window.location.replace(appUrl + "/");
      } else if (status === "past_due") {
        setSubscriptionToken(trimmed);
        window.location.replace(appUrl + "/");
      } else {
        setTokenError("Token not found or subscription is not active.");
        setTokenInput("");
      }
    } catch {
      setTokenError("Could not verify token. Check your connection.");
    } finally {
      setTokenLoading(false);
    }
  }

  async function handlePortal(e: FormEvent) {
    e.preventDefault();
    const trimmed = portalToken.trim();
    if (!trimmed) return;
    setPortalLoading(true);
    setPortalError("");
    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: trimmed }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setPortalError(data.error ?? "Could not open billing portal.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setPortalError("Network error — please try again.");
    } finally {
      setPortalLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-16 space-y-16">

        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground border border-border rounded-full px-3 py-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            7-day free trial — no charge until day 8
          </div>
          <h1 className="text-4xl font-bold tracking-tight">VIBA Pro</h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            Coordinate ChatGPT, Claude, Gemini, Perplexity, and more in a single AI session.
          </p>
        </div>

        {/* Pricing card */}
        <div className="border border-border rounded-2xl overflow-hidden shadow-lg">
          <div className="bg-primary/5 px-8 py-8 text-center space-y-2">
            <p className="text-5xl font-bold">
              $50
              <span className="text-2xl font-normal text-muted-foreground">/mo</span>
            </p>
            <p className="text-sm text-muted-foreground">
              7-day free trial · cancel anytime · card required to start trial
            </p>
          </div>

          {/* Features */}
          <div className="px-8 py-6 space-y-3 border-t border-border">
            {[
              "Multi-agent AI orchestration — ChatGPT, Claude, Gemini, Perplexity & more",
              "Assign roles: Strategy, Code Review, Research, Execution",
              "Automatic task routing to the most capable model",
              "Human-in-the-loop approval for high-stakes actions",
              "Session memory, audit log, and cost tracking",
              "Connect your own API keys (BYOK)",
            ].map((feature) => (
              <div key={feature} className="flex items-start gap-3">
                <svg className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                </svg>
                <span className="text-sm">{feature}</span>
              </div>
            ))}
          </div>

          {/* Checkout form */}
          <div className="px-8 py-6 border-t border-border bg-muted/30">
            <form onSubmit={handleCheckout} className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="checkout-email">
                  Email address
                </label>
                <input
                  id="checkout-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {checkoutError && (
                  <p className="text-xs text-destructive">{checkoutError}</p>
                )}
              </div>
              <button
                type="submit"
                disabled={checkoutLoading}
                className="w-full inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
              >
                {checkoutLoading ? "Redirecting to Stripe…" : "Start 7-day free trial →"}
              </button>
              <p className="text-center text-xs text-muted-foreground">
                Your card will not be charged until your trial ends on day 8.
              </p>
            </form>
          </div>
        </div>

        {/* Already subscribed */}
        <div className="space-y-8">
          <div className="border border-border rounded-xl px-6 py-6 space-y-4">
            <h2 className="text-sm font-semibold">Already subscribed?</h2>
            <p className="text-sm text-muted-foreground">
              Enter the access token from your welcome email to unlock VIBA.
            </p>
            <form onSubmit={handleTokenSubmit} className="space-y-3">
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="viba_…"
                autoComplete="off"
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {tokenError && <p className="text-xs text-destructive">{tokenError}</p>}
              <button
                type="submit"
                disabled={tokenLoading || !tokenInput.trim()}
                className="w-full inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60 transition-colors"
              >
                {tokenLoading ? "Verifying…" : "Unlock VIBA"}
              </button>
            </form>
          </div>

          {/* Manage subscription */}
          <div className="border border-border rounded-xl px-6 py-6 space-y-4">
            <h2 className="text-sm font-semibold">Manage subscription</h2>
            <p className="text-sm text-muted-foreground">
              Update payment method, view invoices, or cancel — all in the Stripe portal.
            </p>
            <form onSubmit={handlePortal} className="space-y-3">
              <input
                type="text"
                value={portalToken}
                onChange={(e) => setPortalToken(e.target.value)}
                placeholder="viba_… (your access token)"
                autoComplete="off"
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {portalError && <p className="text-xs text-destructive">{portalError}</p>}
              <button
                type="submit"
                disabled={portalLoading || !portalToken.trim()}
                className="w-full inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60 transition-colors"
              >
                {portalLoading ? "Opening portal…" : "Open billing portal →"}
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}
