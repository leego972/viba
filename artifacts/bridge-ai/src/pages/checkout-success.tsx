import { useState, type FormEvent } from "react";
import { setSubscriptionToken } from "@/lib/auth";

async function checkSubscription(token: string): Promise<string | null> {
  const res = await fetch(
    `/api/stripe/subscription?token=${encodeURIComponent(token)}`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { status?: string };
  return data.status ?? null;
}

export default function CheckoutSuccess() {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const base = import.meta.env.BASE_URL as string;
  const appUrl = base.endsWith("/") ? base.slice(0, -1) : base || "/";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    try {
      const status = await checkSubscription(trimmed);
      if (status === "active" || status === "trialing" || status === "past_due") {
        setSubscriptionToken(trimmed);
        window.location.replace(appUrl + "/");
      } else {
        setError("Token not found yet — Stripe may still be processing. Wait a moment and try again.");
      }
    } catch {
      setError("Network error — please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8">

        {/* Success icon */}
        <div className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold">You&apos;re subscribed!</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Welcome to VIBA Pro. Your 7-day free trial starts now.
            </p>
          </div>
        </div>

        {/* Email notice */}
        <div className="border border-border rounded-xl p-5 bg-muted/30 space-y-2">
          <div className="flex items-center gap-2 font-medium text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-primary" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v.6l-7 4.375L3 4.6V4z" />
              <path d="M3 6.133V15a1 1 0 001 1h12a1 1 0 001-1V6.133l-7 4.375L3 6.133z" />
            </svg>
            Check your email
          </div>
          <p className="text-sm text-muted-foreground">
            We&apos;ve sent your access token to the email you provided at checkout.
            The token starts with <code className="font-mono bg-muted px-1 rounded text-xs">viba_</code>
          </p>
        </div>

        {/* Token entry */}
        <div className="space-y-4">
          <h2 className="text-sm font-medium">Enter your token to get started</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="viba_…"
                autoComplete="off"
                autoFocus
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
            <button
              type="submit"
              disabled={loading || !token.trim()}
              className="w-full inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {loading ? "Verifying…" : "Unlock VIBA →"}
            </button>
          </form>
          <p className="text-xs text-muted-foreground text-center">
            Email not arrived?{" "}
            <a href={`${appUrl}/pricing`} className="underline hover:text-foreground">
              Back to pricing
            </a>
          </p>
        </div>

      </div>
    </div>
  );
}
