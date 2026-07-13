import { motion } from "framer-motion";
import { Clock, DollarSign, TrendingDown, Pause, Square, Play, FastForward, ShieldCheck } from "lucide-react";
import { useReducedMotion } from "@/lib/motionPreferences";
import { fmtUSD } from "@/lib/costSavings";

interface Props {
  sessionName?: string;
  phase?: string;
  progress?: number;
  elapsedMs?: number;
  cost?: number;
  estimatedPremiumCost?: number;
  status?: string;
  hasApproval?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function MissionHeader({
  sessionName,
  phase = "idle",
  progress = 0,
  elapsedMs = 0,
  cost = 0,
  estimatedPremiumCost,
  status,
  hasApproval = false,
  onPause,
  onResume,
  onStop,
}: Props) {
  const reduced = useReducedMotion();
  const isActive = status === "active";
  const isPaused = status === "paused";
  const savings = estimatedPremiumCost && estimatedPremiumCost > cost
    ? estimatedPremiumCost - cost
    : null;

  return (
    <div className="border-b border-white/[0.06] bg-[#0d0e14] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Mission name + phase */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isActive && !reduced && (
              <motion.div
                className="h-2 w-2 rounded-full bg-emerald-500 shrink-0"
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
            )}
            <h2 className="text-sm font-semibold text-white/90 truncate">
              {sessionName ?? "Untitled Mission"}
            </h2>
          </div>
          <div className="text-[10px] text-white/40 capitalize mt-0.5">{phase}</div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-[10px] text-white/50">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{fmtDuration(elapsedMs)}</span>
          </div>
          <div className="flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            <span>{fmtUSD(cost)}</span>
          </div>
          {savings && savings > 0 && (
            <div className="flex items-center gap-1 text-emerald-400">
              <TrendingDown className="h-3 w-3" />
              <span>{fmtUSD(savings)} saved</span>
            </div>
          )}
          {hasApproval && (
            <div className="flex items-center gap-1 text-amber-400">
              <ShieldCheck className="h-3 w-3" />
              <span>Approval needed</span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1">
          {isPaused && onResume && (
            <button
              type="button"
              onClick={onResume}
              className="flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[10px] font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
            >
              <Play className="h-3 w-3" />
              Resume
            </button>
          )}
          {isActive && onPause && (
            <button
              type="button"
              onClick={onPause}
              className="flex items-center gap-1 rounded-md bg-white/5 border border-white/10 px-2.5 py-1 text-[10px] font-medium text-white/60 hover:bg-white/10 transition-colors"
            >
              <Pause className="h-3 w-3" />
              Pause
            </button>
          )}
          {(isActive || isPaused) && onStop && (
            <button
              type="button"
              onClick={onStop}
              className="flex items-center gap-1 rounded-md bg-red-500/10 border border-red-500/20 px-2.5 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/20 transition-colors"
            >
              <Square className="h-3 w-3" />
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {progress > 0 && (
        <div className="mt-2 h-0.5 rounded-full bg-white/5 overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{
              background: "linear-gradient(90deg, #6366f1, #06b6d4)",
              boxShadow: "0 0 8px #6366f160",
            }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, progress)}%` }}
            transition={reduced ? { duration: 0 } : { duration: 0.5, ease: "easeOut" }}
          />
        </div>
      )}
    </div>
  );
}
