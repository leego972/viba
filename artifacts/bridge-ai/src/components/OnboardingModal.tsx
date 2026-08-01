import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Bot, CheckCircle2, Shield, Sparkles, X, Zap } from "lucide-react";

const ONBOARDING_KEY = "viba_onboarded_v3";

export function useOnboarding() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(ONBOARDING_KEY)) return;
    const timer = setTimeout(() => setShow(true), 500);
    return () => clearTimeout(timer);
  }, []);

  function dismiss() {
    localStorage.setItem(ONBOARDING_KEY, "1");
    setShow(false);
  }

  return { show, dismiss };
}

interface OnboardingModalProps {
  onClose: () => void;
}

export function OnboardingModal({ onClose }: OnboardingModalProps) {
  const [, navigate] = useLocation();

  function closeAndNavigate(path: string) {
    onClose();
    navigate(path);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.1] bg-[hsl(var(--background))] shadow-2xl shadow-black/50"
        role="dialog"
        aria-modal="true"
        aria-labelledby="viba-welcome-title"
      >
        <div className="h-[3px] w-full bg-gradient-to-r from-primary/60 via-violet-500/80 to-primary/60" />

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-16 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-muted/30 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground sm:top-4"
          aria-label="Close welcome popup"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="space-y-5 p-6 pt-7">
          <div className="flex items-start gap-3 pr-10 sm:pr-8">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/15">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 id="viba-welcome-title" className="text-xl font-semibold">Welcome to VIBA</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Start with built-in Groq immediately, or add OpenAI, Claude, Gemini and other providers later from Connections.
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-primary" />
              <span><strong>Groq is ready</strong> — no API key required from the user.</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Bot className="h-4 w-4 text-primary" />
              <span>Run one AI alone or coordinate several AI providers.</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Shield className="h-4 w-4 text-primary" />
              <span>Provider failures are reported clearly and VIBA can continue with Groq.</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <span>No simulation is used for live sessions.</span>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1" onClick={() => closeAndNavigate("/sessions/new")}>
              Start a session
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => closeAndNavigate("/dashboard")}>
              Go to dashboard
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
