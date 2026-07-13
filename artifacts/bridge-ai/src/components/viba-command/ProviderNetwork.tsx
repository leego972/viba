import { motion } from "framer-motion";
import { ShieldCheck, ShieldAlert, ShieldOff, RefreshCw } from "lucide-react";
import type { CircuitBreakerEntry } from "@workspace/api-client-react";
import { useReducedMotion } from "@/lib/motionPreferences";

interface Props {
  entries: CircuitBreakerEntry[];
  onReset?: (provider: string) => void;
  resetting?: string | null;
}

const STATE_CFG = {
  closed:    { color: "#22c55e", label: "Online",   Icon: ShieldCheck,  dot: "bg-emerald-500" },
  "half-open":{ color: "#f59e0b", label: "Probing",  Icon: ShieldAlert,  dot: "bg-amber-500"   },
  open:      { color: "#ef4444", label: "Offline",  Icon: ShieldOff,    dot: "bg-red-500"     },
} as const;

export function ProviderNetwork({ entries, onReset, resetting }: Props) {
  const reduced = useReducedMotion();

  if (entries.length === 0) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span>All providers clear</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {entries.map((entry, i) => {
        const cfg = STATE_CFG[entry.state] ?? STATE_CFG.closed;
        const { Icon } = cfg;
        const isResetting = resetting === entry.provider;

        return (
          <motion.div
            key={entry.provider}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 border border-white/[0.05] bg-white/[0.02]"
            initial={reduced ? false : { opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, delay: i * 0.05 }}
          >
            {/* Live dot */}
            <motion.div
              className={`h-1.5 w-1.5 rounded-full shrink-0 ${cfg.dot}`}
              animate={entry.state === "open" && !reduced ? { opacity: [1, 0.3, 1] } : {}}
              transition={{ duration: 1.2, repeat: Infinity }}
            />

            <Icon className="h-3 w-3 shrink-0" style={{ color: cfg.color }} />

            <span className="flex-1 text-[10px] font-medium capitalize text-white/70 truncate">
              {entry.provider}
            </span>

            <span
              className="text-[9px] font-semibold shrink-0"
              style={{ color: cfg.color }}
            >
              {cfg.label}
            </span>

            {entry.state === "open" && onReset && (
              <button
                type="button"
                className="shrink-0 text-white/30 hover:text-white/70 transition-colors"
                onClick={() => onReset(entry.provider)}
                disabled={isResetting}
                aria-label={`Reset ${entry.provider}`}
              >
                <RefreshCw className={`h-3 w-3 ${isResetting ? "animate-spin" : ""}`} />
              </button>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
