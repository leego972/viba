import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Lock, ArrowRight, Loader2, Eye, EyeOff } from "lucide-react";
import SocialLoginButtons from "@/components/SocialLoginButtons";
import { useLocation } from "wouter";

const LOGO_OUTLINE = [
  "drop-shadow(1px 0 0 #000)",
  "drop-shadow(-1px 0 0 #000)",
  "drop-shadow(0 1px 0 #000)",
  "drop-shadow(0 -1px 0 #000)",
  "drop-shadow(1px 1px 0 #000)",
  "drop-shadow(-1px -1px 0 #000)",
  "drop-shadow(1px -1px 0 #000)",
  "drop-shadow(-1px 1px 0 #000)",
].join(" ");

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json() as { user?: { email?: string; name?: string }; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Invalid email or password.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      const params = new URLSearchParams(window.location.search);
      const returnTo = params.get("returnTo");
      window.location.href = returnTo ?? "/dashboard";
    } catch {
      setError("Could not connect to the server. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex" style={{ background: "#f0f4f8" }}>
      <div className="flex flex-col items-center justify-center w-full p-4">

        {/* Logo */}
        <div className="flex flex-col items-center gap-2 mb-8">
          <img
            src="/viba-logo.png"
            alt="VIBA"
            className="h-16 w-auto object-contain"
            style={{ filter: LOGO_OUTLINE }}
          />
          <span
            className="text-xs font-semibold tracking-[0.2em] uppercase"
            style={{ color: "#0f766e", letterSpacing: "0.18em" }}
          >
            Collaborative · Multi-Agent · Orchestration
          </span>
        </div>

        {/* Card */}
        <div
          className="w-full max-w-sm bg-white p-8 space-y-6"
          style={{ border: "1px solid #d1d9e0", borderRadius: "4px", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)" }}
        >
          <div className="space-y-0.5">
            <h1 className="text-lg font-semibold tracking-tight" style={{ color: "#0f172a" }}>
              Sign in
            </h1>
            <p className="text-sm" style={{ color: "#64748b" }}>
              Access your VIBA workspace
            </p>
          </div>

          <SocialLoginButtons mode="login" returnPath="/dashboard" />

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full" style={{ borderTop: "1px solid #e2e8f0" }} />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-3 text-xs font-medium tracking-wider uppercase" style={{ color: "#94a3b8" }}>
                or
              </span>
            </div>
          </div>

          {error && (
            <div
              className="px-3 py-2.5 text-sm"
              style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: "4px", color: "#be123c" }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="block text-xs font-semibold tracking-wide uppercase" style={{ color: "#475569" }}>
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#94a3b8" }} />
                <input
                  id="login-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 text-sm"
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    color: "#0f172a",
                    outline: "none",
                  }}
                  onFocus={e => { e.target.style.borderColor = "#0d9488"; e.target.style.boxShadow = "0 0 0 2px rgba(13,148,136,0.12)"; }}
                  onBlur={e => { e.target.style.borderColor = "#cbd5e1"; e.target.style.boxShadow = "none"; }}
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="login-password" className="block text-xs font-semibold tracking-wide uppercase" style={{ color: "#475569" }}>
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setLocation("/forgot-password")}
                  className="text-xs font-medium"
                  style={{ color: "#0d9488" }}
                >
                  Forgot?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#94a3b8" }} />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-10 py-2.5 text-sm"
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    color: "#0f172a",
                    outline: "none",
                  }}
                  onFocus={e => { e.target.style.borderColor = "#0d9488"; e.target.style.boxShadow = "0 0 0 2px rgba(13,148,136,0.12)"; }}
                  onBlur={e => { e.target.style.borderColor = "#cbd5e1"; e.target.style.boxShadow = "none"; }}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "#94a3b8" }}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 h-10 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
              style={{ background: "#0d9488", borderRadius: "4px", letterSpacing: "0.01em" }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <p className="text-center text-sm" style={{ color: "#64748b" }}>
            No account?{" "}
            <button
              type="button"
              onClick={() => setLocation("/signup")}
              className="font-semibold"
              style={{ color: "#0d9488" }}
            >
              Create one free
            </button>
          </p>
        </div>

        <p className="mt-6 text-xs" style={{ color: "#94a3b8" }}>
          © {new Date().getFullYear()} VIBA. All rights reserved.
        </p>
      </div>
    </div>
  );
}
