import { useState, useEffect, type ReactNode } from "react";
import { getStoredToken, setStoredToken, clearStoredToken } from "@/lib/auth";

interface AuthConfig {
  protected: boolean;
}

type GateState =
  | { status: "loading" }
  | { status: "open" }
  | { status: "locked"; error?: string }
  | { status: "verifying" };

async function fetchAuthConfig(): Promise<AuthConfig> {
  const res = await fetch("/api/auth/config");
  if (!res.ok) throw new Error("Could not reach server");
  return res.json() as Promise<AuthConfig>;
}

async function verifyToken(token: string): Promise<boolean> {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return res.ok;
}

interface AccessGateProps {
  children: ReactNode;
}

export function AccessGate({ children }: AccessGateProps) {
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [passcode, setPasscode] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const config = await fetchAuthConfig();

        if (!config.protected) {
          if (!cancelled) setState({ status: "open" });
          return;
        }

        // Try to validate any previously stored token
        const stored = getStoredToken();
        if (stored) {
          const valid = await verifyToken(stored);
          if (!cancelled) {
            if (valid) {
              setState({ status: "open" });
            } else {
              clearStoredToken();
              setState({ status: "locked" });
            }
          }
          return;
        }

        if (!cancelled) setState({ status: "locked" });
      } catch {
        // Server unreachable — show the app and let API queries surface errors
        if (!cancelled) setState({ status: "open" });
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = passcode.trim();
    if (!trimmed) return;

    setState({ status: "verifying" });
    const valid = await verifyToken(trimmed);
    if (valid) {
      setStoredToken(trimmed);
      setState({ status: "open" });
    } else {
      setState({ status: "locked", error: "Incorrect access code — try again." });
      setPasscode("");
    }
  }

  if (state.status === "loading" || state.status === "verifying") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <svg
            className="animate-spin h-5 w-5"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <span className="text-sm">
            {state.status === "verifying" ? "Verifying…" : "Loading…"}
          </span>
        </div>
      </div>
    );
  }

  if (state.status === "locked") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-primary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">VIBA</h1>
            <p className="text-sm text-muted-foreground">Enter your access code to continue</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
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
              {state.error && (
                <p className="text-xs text-destructive">{state.error}</p>
              )}
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

  // status === "open"
  return <>{children}</>;
}
