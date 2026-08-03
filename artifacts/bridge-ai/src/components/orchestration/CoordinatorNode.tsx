import { motion } from "framer-motion";
import type { CoordinatorPhase } from "@/lib/orchestrationViewModel";
import { PHASE_LABELS } from "@/lib/orchestrationViewModel";
import AdobeExecutionBrain, { type ExecutionVisualPhase } from "@/components/AdobeExecutionBrain";

const PHASE_COLORS: Record<CoordinatorPhase, string> = {
  idle:             "#4b5563",
  planning:         "#6366f1",
  delegating:       "#06b6d4",
  reviewing:        "#f59e0b",
  waiting_approval: "#ef4444",
  synthesising:     "#a78bfa",
  complete:         "#22c55e",
  error:            "#ef4444",
};

const EXECUTION_PHASE: Record<CoordinatorPhase, ExecutionVisualPhase> = {
  idle: "idle",
  planning: "planning",
  delegating: "working",
  reviewing: "verifying",
  waiting_approval: "verifying",
  synthesising: "working",
  complete: "complete",
  error: "failed",
};

interface Props {
  phase: CoordinatorPhase;
  reducedMotion: boolean;
  size?: number;
  progress?: number;
  activeCount?: number;
}

export function CoordinatorNode({
  phase,
  reducedMotion,
  size = 72,
  progress = 0,
  activeCount = 0,
}: Props) {
  const color = PHASE_COLORS[phase];
  const safeProgress = Math.max(0, Math.min(100, progress));
  const ringSize = size + 30;
  const ringRadius = (ringSize - 6) / 2;
  const circumference = 2 * Math.PI * ringRadius;
  const dashOffset = circumference * (1 - safeProgress / 100);
  const isWorking = activeCount > 0 && !["complete", "error", "idle"].includes(phase);

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: ringSize, height: ringSize }}
      aria-label={`VIBA coordinator: ${PHASE_LABELS[phase]}, ${Math.round(safeProgress)} percent complete`}
    >
      <svg
        className="absolute inset-0 -rotate-90 overflow-visible"
        width={ringSize}
        height={ringSize}
        viewBox={`0 0 ${ringSize} ${ringSize}`}
        aria-hidden="true"
      >
        <circle cx={ringSize / 2} cy={ringSize / 2} r={ringRadius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="2" />
        <motion.circle
          cx={ringSize / 2}
          cy={ringSize / 2}
          r={ringRadius}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: dashOffset, opacity: safeProgress > 0 ? 0.95 : 0.2 }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.8, ease: "easeOut" }}
          style={{ filter: `drop-shadow(0 0 5px ${color}80)` }}
        />
      </svg>

      {!reducedMotion && isWorking && (
        <motion.div
          className="absolute inset-0 rounded-full border border-dashed"
          style={{ borderColor: `${color}45` }}
          animate={{ rotate: 360 }}
          transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
        />
      )}

      {!reducedMotion && isWorking && [0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="absolute inset-0 pointer-events-none"
          animate={{ rotate: 360 }}
          transition={{ duration: 4.8 + index * 0.7, repeat: Infinity, ease: "linear", delay: index * -1.1 }}
          aria-hidden="true"
        >
          <span
            className="absolute h-1.5 w-1.5 rounded-full"
            style={{
              left: "50%",
              top: "50%",
              marginLeft: -3,
              marginTop: -3,
              transform: `translateX(${ringRadius + 1}px)`,
              background: color,
              boxShadow: `0 0 8px ${color}`,
            }}
          />
        </motion.span>
      ))}

      <AdobeExecutionBrain
        phase={EXECUTION_PHASE[phase]}
        compact
        className="relative z-10 rounded-full border-2 shadow-lg"
        showOverlay={!reducedMotion}
      />

      <div
        className="pointer-events-none absolute z-30 flex flex-col items-center justify-center rounded-full"
        style={{ width: size, height: size }}
      >
        <span className="text-[8px] font-bold tracking-[0.2em] text-white/95 uppercase leading-none drop-shadow">VIBA</span>
        <span className="mt-1 text-[7px] font-medium text-white/70 leading-none drop-shadow">{PHASE_LABELS[phase]}</span>
        <span className="mt-1 text-[7px] tabular-nums leading-none drop-shadow" style={{ color }}>
          {Math.round(safeProgress)}%
        </span>
      </div>

      <style>{`.relative.z-10.rounded-full.border-2.shadow-lg { width: ${size}px; height: ${size}px; border-color: ${color}95; box-shadow: 0 0 22px ${color}45, 0 0 52px ${color}1f; }`}</style>

      <div
        className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[8px] font-semibold uppercase tracking-[0.2em]"
        style={{ color: `${color}cc` }}
      >
        {activeCount > 0 ? `${activeCount} active` : "Coordinator"}
      </div>
    </div>
  );
}
