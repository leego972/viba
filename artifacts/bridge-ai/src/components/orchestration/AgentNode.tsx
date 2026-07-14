import { motion } from "framer-motion";
import type { OrchestrationAgent } from "@/lib/orchestrationViewModel";
import { STATUS_COLORS } from "@/lib/orchestrationViewModel";

interface Props {
  agent: OrchestrationAgent;
  reducedMotion: boolean;
  onClick?: () => void;
  size?: number;
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

export function AgentNode({ agent, reducedMotion, onClick, size = 52 }: Props) {
  const statusColor = STATUS_COLORS[agent.status] ?? "#6b7280";
  const isActive = agent.status === "working" || agent.status === "reviewing";
  const isIdle = agent.status === "idle" || agent.status === "queued";

  return (
    <motion.button
      type="button"
      className="relative flex flex-col items-center group cursor-pointer focus:outline-none"
      style={{ width: size + 40 }}
      onClick={onClick}
      whileHover={reducedMotion ? {} : { scale: 1.06 }}
      whileTap={reducedMotion ? {} : { scale: 0.97 }}
    >
      {/* Active working glow */}
      {isActive && !reducedMotion && (
        <motion.div
          className="absolute rounded-full"
          style={{
            width: size + 16,
            height: size + 16,
            top: -8,
            left: "50%",
            x: "-50%",
            background: `radial-gradient(circle, ${agent.color}50 0%, transparent 70%)`,
          }}
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Idle breathing — very gentle, signals the node is alive */}
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
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Node circle */}
      <div
        className="relative z-10 flex items-center justify-center rounded-full border text-xs font-bold text-white transition-shadow"
        style={{
          width: size,
          height: size,
          background: `radial-gradient(circle at 35% 35%, ${agent.color}35 0%, #0f1117 100%)`,
          borderColor: agent.color + "80",
          boxShadow: isActive
            ? `0 0 14px ${agent.color}60, inset 0 0 10px ${agent.color}15`
            : `0 0 6px ${agent.color}25`,
        }}
      >
        <span className="text-[11px] font-bold" style={{ color: agent.color }}>
          {agent.name.charAt(0).toUpperCase()}
        </span>
      </div>

      {/* Status dot */}
      <motion.div
        className="absolute top-0 right-1 z-20 rounded-full border-2 border-[#0a0b0f]"
        style={{ width: 10, height: 10, background: statusColor }}
        animate={isActive && !reducedMotion ? { scale: [1, 1.3, 1] } : {}}
        transition={{ duration: 0.8, repeat: Infinity }}
      />

      {/* Name + Role */}
      <div className="mt-1.5 text-center leading-tight">
        <div className="text-[9px] font-semibold text-white/90 truncate max-w-[56px]">{agent.name}</div>
        <div className="text-[8px] text-white/40 truncate max-w-[56px]">{agent.role}</div>
      </div>

      {/* Status label */}
      <div
        className="mt-0.5 rounded-full px-1.5 py-0.5 text-[7px] font-semibold uppercase tracking-wider"
        style={{ background: statusColor + "20", color: statusColor }}
      >
        {STATUS_LABELS[agent.status] ?? agent.status}
      </div>

      {/* Tooltip on hover */}
      {agent.taskSummary && (
        <div className="pointer-events-none absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 w-48 rounded-lg border border-white/10 bg-[#1a1d2e] p-2 text-[9px] text-white/70 opacity-0 group-hover:opacity-100 transition-opacity shadow-xl">
          <div className="font-semibold text-white/90 mb-0.5">{agent.role}</div>
          <div>{agent.taskSummary}</div>
          {agent.cost !== undefined && agent.cost > 0 && (
            <div className="mt-1 text-emerald-400">Cost: ${agent.cost.toFixed(4)}</div>
          )}
          {agent.latencyMs !== undefined && agent.latencyMs > 0 && (
            <div className="text-white/40">Latency: {agent.latencyMs}ms</div>
          )}
        </div>
      )}
    </motion.button>
  );
}
