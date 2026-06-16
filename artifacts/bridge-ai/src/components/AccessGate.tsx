import { useState, useEffect, type ReactNode, type FormEvent } from "react";
import {
  getStoredToken, setStoredToken, clearStoredToken,
  getSubscriptionToken, setSubscriptionToken, clearSubscriptionToken,
  isBypassValid, setBypassValid,
} from "@/lib/auth";

type AuthMode = "open" | "password" | "stripe";

interface AuthConfig {
  protected: boolean;
  mode: AuthMode;
  publishableKey?: string | null;
}

type SubStatus =
  | "trialing" | "active" | "past_due" | "cancelled"
  | "unpaid" | "not_found" | "pending";

type GateState =
  | { status: "loading" }
  | { status: "open" }
  | { status: "locked"; error?: string }        // password mode
  | { status: "verifying" }                      // password verify in progress
  | { status: "subscribe" }                      // stripe mode — redirect to /pricing
  | { status: "checking_sub" }                   // stripe mode — verifying token
  | { status: "past_due" };                      // stripe mode — payment failed

async function fetchAuthConfig(): Promise<AuthConfig> {
  const res = await fetch("/api/auth/config");
  if (!res.ok) throw new Error("Could not reach server");
  return res.json() as Promise<AuthConfig>;
}

async function verifyPasswordToken(token: string): Promise<boolean> {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return res.ok;
}

async function verifyBypassToken(token: string): Promise<boolean> {
  const res = await fetch("/api/auth/verify-bypass", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return res.ok;
}

async function checkSubscription(token: string): Promise<SubStatus> {
  const res = await fetch(
    `/api/stripe/subscription?token=${encodeURIComponent(token)}`,
  );
  if (res.status === 404) return "not_found";
  if (!res.ok) return "not_found";
  const data = (await res.json()) as { status?: string };
  return (data.status as SubStatus | undefined) ?? "not_found";
}

interface AccessGateProps { children: ReactNode; }

export function AccessGate({ children }: AccessGateProps) {
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [passcode, setPasscode] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        // ── Archibald Titan bypass — session flag already set ─────────────
        if (isBypassValid()) {
          if (!cancelled) setState({ status: "open" });
          return;
        }

        // ── Archibald Titan bypass — check URL param ──────────────────────
        const urlParams = new URLSearchParams(window.location.search);
        const bypassParam = urlParams.get("bypass");
        if (bypassParam) {
          const valid = await verifyBypassToken(bypassParam);
          if (valid) {
            setBypassValid();
            // Clean up the ?bypass= param without a reload
            const cleanUrl = window.location.pathname + window.location.hash;
            window.history.replaceState(null, "", cleanUrl);
            if (!cancelled) setState({ status: "open" });
            return;
          }
          // Invalid bypass — fall through to normal auth
        }

        const config = await fetchAuthConfig();

        if (!config.protected) {
          if (!cancelled) setState({ status: "open" });
          return;
        }

        // ── Password mode ─────────────────────────────────────────────────
        if (config.mode === "password") {
          const stored = getStoredToken();
          if (stored) {
            const valid = await verifyPasswordToken(stored);
            if (!cancelled) {
              if (valid) setState({ status: "open" });
              else { clearStoredToken(); setState({ status: "locked" }); }
            }
            return;
          }
          if (!cancelled) setState({ status: "locked" });
          return;
        }

        // ── Stripe mode ───────────────────────────────────────────────────
        if (config.mode === "stripe") {
          const stored = getSubscriptionToken();
          if (stored) {
            if (!cancelled) setState({ status: "checking_sub" });
            const subStatus = await checkSubscription(stored);
            if (!cancelled) {
              if (subStatus === "active" || subStatus === "trialing") {
                setState({ status: "open" });
              } else if (subStatus === "past_due") {
                setState({ status: "past_due" });
              } else {
                clearSubscriptionToken();
                setState({ status: "subscribe" });
              }
            }
            return;
          }
          if (!cancelled) setState({ status: "subscribe" });
          return;
        }

        if (!cancelled) setState({ status: "open" });
      } catch {
        // Server unreachable — show the app and let API queries surface errors
        if (!cancelled) setState({ status: "open" });
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  // Password mode form submit
  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = passcode.trim();
    if (!trimmed) return;
    setState({ status: "verifying" });
    const valid = await verifyPasswordToken(trimmed);
    if (valid) {
      setStoredToken(trimmed);
      setState({ status: "open" });
    } else {
      setState({ status: "locked", error: "Incorrect access code — try again." });
      setPasscode("");
    }
  }

  // ── Loading / verifying ───────────────────────────────────────────────────
  if (
    state.status === "loading" ||
    state.status === "verifying" ||
    state.status === "checking_sub"
  ) {
    const label =
      state.status === "verifying"
        ? "Verifying…"
        : state.status === "checking_sub"
          ? "Checking subscription…"
          : "Loading…";
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <span className="text-sm">{label}</span>
        </div>
      </div>
    );
  }

  // ── Open ─────────────────────────────────────────────────────────────────
  if (state.status === "open") return <>{children}</>;

  // ── Stripe: redirect to /pricing ────────────────────────────────────────
  if (state.status === "subscribe") {
    const base = import.meta.env.BASE_URL as string;
    const pricingUrl = base.endsWith("/") ? `${base}pricing` : `${base}/pricing`;
    window.location.replace(pricingUrl);
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <span className="text-sm">Redirecting to pricing…</span>
        </div>
      </div>
    );
  }

  // ── Stripe: past due ────────────────────────────────────────────────────
  if (state.status === "past_due") {
    const handlePortal = async () => {
      const token = getSubscriptionToken();
      if (!token) return;
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        const { url } = (await res.json()) as { url: string };
        window.location.href = url;
      }
    };
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-5 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold">Payment required</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Your last payment failed. Update your payment method to continue.
            </p>
          </div>
          <div className="space-y-2">
            <button
              onClick={handlePortal}
              className="w-full inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Update payment method
            </button>
            <button
              onClick={() => { clearSubscriptionToken(); setState({ status: "subscribe" }); }}
              className="w-full inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Enter a different token
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Password mode locked ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">VIBA</h1>
          <p className="text-sm text-muted-foreground">Enter your access code to continue</p>
        </div>
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Access code"
              autoFocus
              autoComplete="current-password"
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            {state.error && <p className="text-xs text-destructive">{state.error}</p>}
          </div>
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors"
          >
            Unlock
          </button>
        </form>
        <p className="text-center text-xs text-muted-foreground">
          Set <code className="font-mono bg-muted px-1 py-0.5 rounded text-xs">ACCESS_TOKEN</code>{" "}
          in your deployment environment to configure this.
        </p>
      </div>
    </div>
  );
}
