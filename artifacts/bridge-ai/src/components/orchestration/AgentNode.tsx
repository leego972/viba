import { motion } from "framer-motion";
import { Check, Pause, X } from "lucide-react";
import type { OrchestrationAgent } from "@/lib/orchestrationViewModel";
import { STATUS_COLORS } from "@/lib/orchestrationViewModel";

interface Props {
  agent: OrchestrationAgent;
  reducedMotion: boolean;
  onClick?: () => void;
  size?: number;
  highlighted?: boolean;
  selected?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  idle:      "Idle",
  queued:    "Queued",
  working:   "Working",
  waiting:   "Waiting",
  reviewing: "Reviewing",
  complete:  "Done",
  failed:    "Failed",
  paused:    "Paused",
};

export function AgentNode({
  agent,
  reducedMotion,
  onClick,
  size = 52,
  highlighted = false,
  selected = false,
}: Props) {
  const statusColor = STATUS_COLORS[agent.status] ?? "#6b7280";
  const isActive = agent.status === "working" || agent.status === "reviewing";
  const isIdle = agent.status === "idle" || agent.status === "queued";
  const isComplete = agent.status === "complete";
  const isFailed = agent.status === "failed";
  const isPaused = agent.status === "paused";

  const coreContent = isComplete
    ? <Check className="h-4 w-4" />
    : isFailed
      ? <X className="h-4 w-4" />
      : isPaused
        ? <Pause className="h-3.5 w-3.5" />
        : <span className="text-[11px] font-bold">{agent.name.charAt(0).toUpperCase()}</span>;

  return (
    <motion.button
      type="button"
      className="relative flex flex-col items-center group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#090b10] rounded-xl"
      style={{ width: size + 52 }}
      onClick={onClick}
      aria-label={`${agent.name}, ${agent.role}, ${STATUS_LABELS[agent.status] ?? agent.status}`}
      initial={reducedMotion ? false : { opacity: 0, scale: 0.82, y: 6 }}
      animate={{
        opacity: 1,
        scale: highlighted && !reducedMotion ? 1.06 : 1,
        y: 0,
      }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      whileHover={reducedMotion ? {} : { scale: highlighted ? 1.09 : 1.05, y: -2 }}
      whileTap={reducedMotion ? {} : { scale: 0.97 }}
    >
      {isActive && !reducedMotion && (
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: size + 24,
            height: size + 24,
            top: -12,
            left: "50%",
            x: "-50%",
            background: `radial-gradient(circle, ${agent.color}52 0%, ${agent.color}12 42%, transparent 72%)`,
          }}
          animate={{ scale: [0.94, 1.16, 0.94], opacity: [0.45, 0.9, 0.45] }}
          transition={{ duration: highlighted ? 1.1 : 1.65, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {highlighted && !reducedMotion && (
        <motion.div
          className="absolute rounded-full border pointer-events-none"
          style={{
            width: size + 18,
            height: size + 18,
            top: -9,
            left: "50%",
            x: "-50%",
            borderColor: `${agent.color}75`,
            boxShadow: `0 0 18px ${agent.color}45`,
          }}
          initial={{ scale: 0.75, opacity: 0 }}
          animate={{ scale: [0.86, 1.2], opacity: [0.9, 0] }}
          transition={{ duration: 1.35, repeat: Infinity, ease: "easeOut" }}
        />
      )}

      {isIdle && !reducedMotion && (
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: size + 8,
            height: size + 8,
            top: -4,
            left: "50%",
            x: "-50%",
            background: `radial-gradient(circle, ${agent.color}18 0%, transparent 70%)`,
          }}
          animate={{ opacity: [0.22, 0.5, 0.22] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {isActive && !reducedMotion && (
        <motion.div
          className="absolute rounded-full border border-dashed pointer-events-none"
          style={{
            width: size + 10,
            height: size + 10,
            top: -5,
            left: "50%",
            x: "-50%",
            borderColor: `${agent.color}55`,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: agent.status === "reviewing" ? 5.5 : 7.5, repeat: Infinity, ease: "linear" }}
        />
      )}

      <motion.div
        className="relative z-10 flex items-center justify-center rounded-full border text-xs font-bold text-white"
        style={{
          width: size,
          height: size,
          color: agent.color,
          background: `radial-gradient(circle at 35% 30%, ${agent.color}42 0%, #111520 55%, #090b10 100%)`,
          borderColor: selected ? agent.color : `${agent.color}82`,
          boxShadow: selected
            ? `0 0 0 2px ${agent.color}35, 0 0 22px ${agent.color}70, inset 0 0 13px ${agent.color}17`
            : isActive
              ? `0 0 16px ${agent.color}62, inset 0 0 12px ${agent.color}16`
              : `0 0 7px ${agent.color}2f`,
        }}
        animate={isComplete && !reducedMotion ? { scale: [1, 1.12, 1] } : {}}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        {coreContent}
      </motion.div>

      <motion.div
        className="absolute top-0 right-2 z-20 rounded-full border-2 border-[#090b10]"
        style={{ width: 10, height: 10, background: statusColor, boxShadow: `0 0 8px ${statusColor}75` }}
        animate={isActive && !reducedMotion ? { scale: [1, 1.34, 1] } : {}}
        transition={{ duration: 0.85, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="mt-1.5 text-center leading-tight min-w-0">
        <div className="text-[9px] font-semibold text-white/90 truncate max-w-[74px]">{agent.name}</div>
        <div className="text-[8px] text-white/42 truncate max-w-[74px]">{agent.role}</div>
      </div>

      <div
        className="mt-1 rounded-full px-2 py-0.5 text-[7px] font-semibold uppercase tracking-[0.12em]"
        style={{ background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}22` }}
      >
        {STATUS_LABELS[agent.status] ?? agent.status}
      </div>

      {agent.taskSummary && (
        <div className="pointer-events-none absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-50 w-52 rounded-xl border border-white/10 bg-[#11141d]/98 p-2.5 text-[9px] text-white/68 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-1.5 font-semibold text-white/92 mb-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }} />
            {agent.role}
          </div>
          <div className="leading-relaxed">{agent.taskSummary}</div>
          {(agent.cost !== undefined || (agent.latencyMs !== undefined && agent.latencyMs > 0)) && (
            <div className="mt-2 flex items-center gap-3 border-t border-white/5 pt-1.5 text-[8px]">
              {agent.cost !== undefined && agent.cost > 0 && <span className="text-emerald-400">${agent.cost.toFixed(4)}</span>}
              {agent.latencyMs !== undefined && agent.latencyMs > 0 && <span className="text-white/38">{agent.latencyMs}ms</span>}
            </div>
          )}
        </div>
      )}
    </motion.button>
  );
}
