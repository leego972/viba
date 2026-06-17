import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Lock, ArrowRight, Loader2, Eye, EyeOff } from "lucide-react";
import SocialLoginButtons from "@/components/SocialLoginButtons";
import { useLocation } from "wouter";

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
    <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-gradient-to-br from-blue-950/60 via-[#0a0e1a] to-indigo-950/40 pointer-events-none" />
      <div
        className="fixed inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
        }}
      />
      <div className="relative z-10 w-full max-w-md">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="relative">
            <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full" />
            <img
              src="/viba-logo.png"
              alt="VIBA"
              className="relative h-20 w-auto object-contain drop-shadow-2xl"
            />
          </div>
          <p className="text-sm text-gray-400">Collaborative Multi-Agent Orchestration</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl p-6 space-y-5">
          <div className="text-center space-y-1">
            <h2 className="text-xl font-bold text-white">Sign in to your account</h2>
            <p className="text-sm text-gray-400">Welcome back — enter your credentials to continue.</p>
          </div>

          <SocialLoginButtons mode="login" returnPath="/dashboard" />

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-[#0f1320] px-2 text-gray-500">or sign in with email</span>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="login-email" className="block text-sm font-medium text-gray-300">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  id="login-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-md bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 text-sm"
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="login-password" className="block text-sm font-medium text-gray-300">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 rounded-md bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 text-sm"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 h-11 rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-white font-medium text-sm transition-all mt-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <div className="flex items-center justify-between pt-1">
            <p className="text-sm text-gray-500">
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={() => setLocation("/signup")}
                className="text-blue-400 hover:text-blue-300 underline-offset-4 hover:underline transition-colors font-medium"
              >
                Sign up free
              </button>
            </p>
            <button
              type="button"
              onClick={() => setLocation("/forgot-password")}
              className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
            >
              Forgot password?
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
