import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import type { OrchestrationEvent } from "@/lib/orchestrationViewModel";
import { useReducedMotion } from "@/lib/motionPreferences";
import { cn } from "@/lib/utils";

interface Props {
  events: OrchestrationEvent[];
  maxVisible?: number;
  compact?: boolean;
}

const TYPE_STYLES = {
  info:     "text-white/60",
  success:  "text-emerald-400",
  warning:  "text-amber-400",
  error:    "text-red-400",
  approval: "text-violet-400",
} as const;

const TYPE_DOT = {
  info:     "bg-white/20",
  success:  "bg-emerald-500",
  warning:  "bg-amber-500",
  error:    "bg-red-500",
  approval: "bg-violet-500",
} as const;

export function AgentActivityTimeline({ events, maxVisible = 8, compact = false }: Props) {
  const reduced = useReducedMotion();
  const visible = events.slice(-maxVisible).reverse();

  if (visible.length === 0) {
    return (
      <div className="text-[11px] text-white/30 py-4 text-center">
        No activity yet — waiting for agents…
      </div>
    );
  }

  return (
    <div className="space-y-0 relative">
      {/* Vertical line */}
      <div className="absolute left-[7px] top-0 bottom-0 w-px bg-white/[0.06]" />

      <AnimatePresence initial={false}>
        {visible.map((ev) => (
          <motion.div
            key={ev.id}
            className="relative flex gap-3 py-1.5"
            initial={reduced ? false : { opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {/* Dot */}
            <div className="relative z-10 mt-1 shrink-0">
              <div className={cn("h-[7px] w-[7px] rounded-full mt-0.5", TYPE_DOT[ev.type])} />
            </div>

            <div className="flex-1 min-w-0">
              {!compact && (
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="text-[9px] text-white/30 font-mono shrink-0">
                    {format(ev.timestamp, "HH:mm:ss")}
                  </span>
                  <span
                    className="text-[9px] font-semibold shrink-0"
                    style={{ color: ev.agentColor }}
                  >
                    {ev.agentName}
                  </span>
                </div>
              )}
              <div className={cn("text-[10px] leading-snug", TYPE_STYLES[ev.type])}>
                {ev.action}
              </div>
              {ev.costDelta !== undefined && ev.costDelta < 0 && (
                <div className="text-[9px] text-emerald-400/70 mt-0.5">
                  Saved {Math.abs(ev.costDelta).toFixed(3)} credits
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
