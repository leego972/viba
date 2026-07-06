import { useState } from "react";
import { Link } from "wouter";
import { Mail, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setSent(true);
    } catch {
      setError("Could not connect to the server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#0a0e1a] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-gradient-to-br from-blue-950/60 via-[#0a0e1a] to-indigo-950/40 pointer-events-none" />
      <div className="relative z-10 w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-3">
          <img src="/viba-logo.png" alt="VIBA" className="h-24 w-auto rounded-xl" style={{ backgroundColor: "white" }} />
          <p className="text-sm text-muted-foreground">Collaborative Multi-Agent Orchestration</p>
        </div>

        <div className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm p-8 shadow-2xl">
          {sent ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-400" />
              <h2 className="text-lg font-semibold">Check your email</h2>
              <p className="text-sm text-muted-foreground">
                If an account exists for <span className="text-foreground font-medium">{email}</span>, we sent a password reset link. It expires in 1 hour.
              </p>
              <Link href="/login">
                <a className="mt-2 text-sm text-primary hover:underline flex items-center gap-1">
                  <ArrowLeft className="h-3 w-3" /> Back to sign in
                </a>
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold mb-1">Reset your password</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Enter your email and we'll send you a reset link.
              </p>

              {error && (
                <div className="mb-4 rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-2.5 text-sm text-destructive">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full rounded-lg border border-border bg-background/50 pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !email}
                  className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Send reset link
                </button>
              </form>

              <div className="mt-5 text-center">
                <Link href="/login">
                  <a className="text-sm text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 transition-colors">
                    <ArrowLeft className="h-3 w-3" /> Back to sign in
                  </a>
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
