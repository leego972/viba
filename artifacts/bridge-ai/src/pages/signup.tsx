import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Lock, User, ArrowRight, Loader2, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import SocialLoginButtons from "@/components/SocialLoginButtons";
import { useLocation } from "wouter";


const inputStyle = {
  background: "#f8f6ef",
  border: "1px solid #cbd5e1",
  borderRadius: "4px",
  color: "#0f172a",
  outline: "none",
};

const focusStyle = { borderColor: "#0d9488", boxShadow: "0 0 0 2px rgba(13,148,136,0.12)" };
const blurStyle = { borderColor: "#cbd5e1", boxShadow: "none" };

export default function SignUpPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password, name: name.trim() || undefined }),
      });
      const data = await res.json() as { user?: { email?: string }; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not create account.");
        return;
      }
      setSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 1500);
    } catch {
      setError("Could not connect to the server. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center" style={{ background: "#faf8f2" }}>
        <div className="text-center space-y-3">
          <CheckCircle2 className="w-14 h-14 mx-auto" style={{ color: "#0d9488" }} />
          <h2 className="text-xl font-semibold tracking-tight" style={{ color: "#0f172a" }}>Account created</h2>
          <p className="text-sm" style={{ color: "#64748b" }}>Taking you to your dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex" style={{ background: "#faf8f2" }}>
      <div className="flex flex-col items-center justify-center w-full p-4">

        {/* Logo */}
        <div className="flex flex-col items-center gap-2 mb-8">
          <img
            src="/viba-logo.png"
            alt="VIBA"
            className="h-28 w-auto object-contain rounded-xl"
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
          className="w-full max-w-sm p-8 space-y-6"
          style={{ background: "#fefcf7", border: "1px solid #dbd8cc", borderRadius: "4px", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)" }}
        >
          <div className="space-y-0.5">
            <h1 className="text-lg font-semibold tracking-tight" style={{ color: "#0f172a" }}>
              Create account
            </h1>
            <p className="text-sm" style={{ color: "#64748b" }}>
              Get started with VIBA — free to join
            </p>
          </div>

          <SocialLoginButtons mode="register" returnPath="/dashboard" />

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full" style={{ borderTop: "1px solid #e2e8f0" }} />
            </div>
            <div className="relative flex justify-center">
              <span className="px-3 text-xs font-medium tracking-wider uppercase" style={{ background: "#fefcf7", color: "#94a3b8" }}>
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
              <label htmlFor="signup-name" className="block text-xs font-semibold tracking-wide uppercase" style={{ color: "#475569" }}>
                Name <span style={{ color: "#94a3b8", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#94a3b8" }} />
                <input
                  id="signup-name"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 text-sm"
                  style={inputStyle}
                  onFocus={e => Object.assign(e.target.style, focusStyle)}
                  onBlur={e => Object.assign(e.target.style, blurStyle)}
                  autoComplete="name"
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="signup-email" className="block text-xs font-semibold tracking-wide uppercase" style={{ color: "#475569" }}>
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#94a3b8" }} />
                <input
                  id="signup-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 text-sm"
                  style={inputStyle}
                  onFocus={e => Object.assign(e.target.style, focusStyle)}
                  onBlur={e => Object.assign(e.target.style, blurStyle)}
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="signup-password" className="block text-xs font-semibold tracking-wide uppercase" style={{ color: "#475569" }}>
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#94a3b8" }} />
                <input
                  id="signup-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-10 py-2.5 text-sm"
                  style={inputStyle}
                  onFocus={e => Object.assign(e.target.style, focusStyle)}
                  onBlur={e => Object.assign(e.target.style, blurStyle)}
                  required
                  autoComplete="new-password"
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

            <div className="space-y-1.5">
              <label htmlFor="signup-confirm" className="block text-xs font-semibold tracking-wide uppercase" style={{ color: "#475569" }}>
                Confirm password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#94a3b8" }} />
                <input
                  id="signup-confirm"
                  type={showConfirm ? "text" : "password"}
                  placeholder="Repeat your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-9 pr-10 py-2.5 text-sm"
                  style={inputStyle}
                  onFocus={e => Object.assign(e.target.style, focusStyle)}
                  onBlur={e => Object.assign(e.target.style, blurStyle)}
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "#94a3b8" }}
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
              {loading ? "Creating…" : "Create Account"}
            </button>
          </form>

          <p className="text-center text-sm" style={{ color: "#64748b" }}>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => setLocation("/login")}
              className="font-semibold"
              style={{ color: "#0d9488" }}
            >
              Sign in
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
