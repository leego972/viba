import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Lock, ArrowRight, Loader2, Eye, EyeOff, MailCheck } from "lucide-react";
import SocialLoginButtons from "@/components/SocialLoginButtons";
import { useLocation } from "wouter";

function safeInternalPath(value: string | null, fallback = "/dashboard"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.origin === window.location.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
  } catch {
    return fallback;
  }
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const returnTo = useMemo(() => safeInternalPath(new URLSearchParams(window.location.search).get("returnTo")), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setUnverified(false);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await response.json() as { error?: string; code?: string };
      if (!response.ok) {
        if (data.code === "EMAIL_NOT_VERIFIED") setUnverified(true);
        else setError(data.error ?? "Invalid email or password.");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      window.location.assign(returnTo);
    } catch {
      setError("Could not connect to the server. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setResendSent(true);
    } finally {
      setResending(false);
    }
  };

  const inputStyle = { background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: "4px", color: "#0f172a", outline: "none" };
  const focus = (element: HTMLInputElement) => { element.style.borderColor = "#0d9488"; element.style.boxShadow = "0 0 0 2px rgba(13,148,136,0.12)"; };
  const blur = (element: HTMLInputElement) => { element.style.borderColor = "#cbd5e1"; element.style.boxShadow = "none"; };

  return (
    <div className="min-h-[100dvh] flex" style={{ background: "#faf8f2" }}>
      <div className="flex flex-col items-center justify-center w-full p-4">
        <div className="flex flex-col items-center gap-2 mb-8">
          <img src="/viba-logo.png" alt="VIBA" className="h-28 w-auto object-contain rounded-xl" />
          <span className="text-xs font-semibold uppercase" style={{ color: "#0f766e", letterSpacing: "0.18em" }}>Collaborative · Multi-Agent · Orchestration</span>
        </div>

        <div className="w-full max-w-sm p-8 space-y-6" style={{ background: "#fefcf7", border: "1px solid #dbd8cc", borderRadius: "4px", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)" }}>
          <div><h1 className="text-lg font-semibold tracking-tight" style={{ color: "#0f172a" }}>Sign in</h1><p className="text-sm" style={{ color: "#64748b" }}>Access your VIBA workspace</p></div>
          <SocialLoginButtons mode="login" returnPath={returnTo} />
          <div className="relative"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div><div className="relative flex justify-center"><span className="px-3 text-xs font-medium uppercase" style={{ background: "#fefcf7", color: "#94a3b8" }}>or</span></div></div>

          {unverified && <div className="px-4 py-3.5 space-y-3" style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "4px" }}><div className="flex items-start gap-2.5"><MailCheck className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#92400e" }} /><div><p className="text-sm font-semibold" style={{ color: "#92400e" }}>Check your inbox</p><p className="text-xs mt-0.5" style={{ color: "#78350f" }}>Verify the email sent to <strong>{email}</strong>.</p></div></div>{resendSent ? <p className="text-xs font-medium" style={{ color: "#065f46" }}>Verification email sent.</p> : <button type="button" onClick={() => void handleResend()} disabled={resending} className="text-xs font-semibold underline disabled:opacity-50" style={{ color: "#b45309" }}>{resending ? "Sending…" : "Resend verification email"}</button>}</div>}
          {error && <div className="px-3 py-2.5 text-sm" style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: "4px", color: "#be123c" }}>{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block space-y-1.5"><span className="block text-xs font-semibold uppercase" style={{ color: "#475569" }}>Email</span><div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#94a3b8" }} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full pl-9 pr-4 py-2.5 text-sm" style={inputStyle} onFocus={(event) => focus(event.currentTarget)} onBlur={(event) => blur(event.currentTarget)} required autoComplete="email" autoFocus /></div></label>
            <label className="block space-y-1.5"><span className="flex items-center justify-between text-xs font-semibold uppercase" style={{ color: "#475569" }}>Password<button type="button" onClick={() => setLocation("/forgot-password")} className="font-medium normal-case" style={{ color: "#0d9488" }}>Forgot?</button></span><div className="relative"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#94a3b8" }} /><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full pl-9 pr-10 py-2.5 text-sm" style={inputStyle} onFocus={(event) => focus(event.currentTarget)} onBlur={(event) => blur(event.currentTarget)} required autoComplete="current-password" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "#94a3b8" }} tabIndex={-1}>{showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button></div></label>
            <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 h-10 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "#0d9488", borderRadius: "4px" }}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}{loading ? "Signing in…" : "Sign In"}</button>
          </form>

          <p className="text-center text-sm" style={{ color: "#64748b" }}>No account? <button type="button" onClick={() => setLocation(`/signup?returnTo=${encodeURIComponent(returnTo)}`)} className="font-semibold" style={{ color: "#0d9488" }}>Create one</button></p>
        </div>
      </div>
    </div>
  );
}
