import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Shield, Zap, X } from "lucide-react";

interface UpgradePromptProps {
  /** Shown inline (banner) or as an overlay modal */
  variant?: "banner" | "modal";
  feature?: string;
  onDismiss?: () => void;
}

export function UpgradePrompt({ variant = "banner", feature, onDismiss }: UpgradePromptProps) {
  const [, setLocation] = useLocation();

  const features = [
    "Repair sessions — fix build, UI, and security issues",
    "Multi-agent collaboration with specialist role routing",
    "Deep security audit (OWASP ASVS / WSTG)",
    "GitHub PR creation & repository writes",
    "Railway / Replit deployment actions",
    "Client-ready proof reports",
    "4,000 credits/month (vs 750 on Basic)",
  ];

  if (variant === "modal") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl space-y-5">
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="absolute right-4 top-4 text-zinc-500 hover:text-zinc-300 transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 border border-indigo-500/30">
              <Zap className="h-5 w-5 text-indigo-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Pro feature{feature ? ` — ${feature}` : ""}</p>
              <p className="text-xs text-zinc-500">Available on VIBA Pro Repair</p>
            </div>
          </div>

          <p className="text-sm text-zinc-400 leading-relaxed">
            Upgrade to VIBA Pro to repair, retest, collaborate with multiple AI agents, and generate proof reports.
          </p>

          <ul className="space-y-1.5">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-xs text-zinc-400">
                <Shield className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-500" />
                {f}
              </li>
            ))}
          </ul>

          <div className="flex gap-2 pt-1">
            <Button
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white"
              onClick={() => setLocation("/pricing")}
            >
              Upgrade to Pro — $89/mo
            </Button>
            {onDismiss && (
              <Button variant="outline" size="icon" onClick={onDismiss} className="border-white/10 text-zinc-400">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/8 px-4 py-3 flex items-center gap-3">
      <Zap className="h-4 w-4 text-indigo-400 shrink-0" />
      <p className="text-sm text-zinc-400 flex-1">
        <span className="font-medium text-zinc-200">Pro feature{feature ? ` — ${feature}` : ""}.</span>{" "}
        Upgrade to VIBA Pro for repairs, deep security, multi-agent collaboration, and proof reports.
      </p>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10 text-xs"
        onClick={() => setLocation("/pricing")}
      >
        Upgrade
      </Button>
      {onDismiss && (
        <button onClick={onDismiss} className="text-zinc-600 hover:text-zinc-400">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

interface LockedButtonProps {
  label: string;
  feature?: string;
}

/** Drop-in replacement for a button that the current plan doesn't allow */
export function LockedButton({ label, feature }: LockedButtonProps) {
  const [, setLocation] = useLocation();
  return (
    <button
      title={`Pro feature${feature ? ` — ${feature}` : ""}. Upgrade to VIBA Pro.`}
      onClick={() => setLocation("/pricing")}
      className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/20 bg-indigo-500/8 px-3 py-1.5 text-xs font-medium text-indigo-400/80 cursor-pointer hover:bg-indigo-500/15 transition-colors"
    >
      <Zap className="h-3 w-3" />
      {label}
      <span className="ml-0.5 text-[10px] font-normal opacity-60">Pro</span>
    </button>
  );
}
