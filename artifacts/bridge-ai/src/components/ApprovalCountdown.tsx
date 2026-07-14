import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface Props {
  seconds?: number;
  onExpire?: () => void;
}

/**
 * Refined SVG ring countdown for the approval modal.
 * Draws down from `seconds` to 0, transitioning amber → muted as time passes.
 * Pure visual — does not auto-approve; `onExpire` is informational only.
 */
export function ApprovalCountdown({ seconds = 90, onExpire }: Props) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
    const id = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) { clearInterval(id); onExpire?.(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [seconds, onExpire]);

  const r = 20;
  const circ = 2 * Math.PI * r;
  const progress = remaining / seconds;
  const dash = circ * progress;
  const urgent = remaining <= 20;

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <svg width={52} height={52} viewBox="0 0 52 52" className="-rotate-90">
        {/* Track */}
        <circle cx={26} cy={26} r={r} fill="none" stroke="currentColor"
          strokeWidth={2.5} className="text-white/8" />
        {/* Progress arc */}
        <motion.circle
          cx={26} cy={26} r={r} fill="none"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={circ}
          animate={{
            strokeDashoffset: circ - dash,
            stroke: urgent ? "#f59e0b" : "#6b7280",
          }}
          transition={{ duration: 0.8, ease: "linear" }}
        />
      </svg>
      <span
        className={`text-[11px] font-mono tabular-nums -mt-1 transition-colors duration-700 ${
          urgent ? "text-amber-400" : "text-muted-foreground/60"
        }`}
      >
        {remaining}s
      </span>
    </div>
  );
}
