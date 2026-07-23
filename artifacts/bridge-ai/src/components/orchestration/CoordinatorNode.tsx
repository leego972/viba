import { motion } from "framer-motion";
import type { CoordinatorPhase } from "@/lib/orchestrationViewModel";
import { PHASE_LABELS } from "@/lib/orchestrationViewModel";

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
        <circle
          cx={ringSize / 2}
          cy={ringSize / 2}
          r={ringRadius}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth="2"
        />
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

      {!reducedMotion && (
        <motion.div
          className="absolute rounded-full"
          style={{
            width: size + 24,
            height: size + 24,
            background: `radial-gradient(circle, ${color}2f 0%, transparent 70%)`,
          }}
          animate={isWorking
            ? { scale: [1, 1.16, 1], opacity: [0.5, 0.95, 0.5] }
            : { scale: [1, 1.06, 1], opacity: [0.35, 0.55, 0.35] }}
          transition={{ duration: isWorking ? 1.8 : 3.6, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {!reducedMotion && isWorking && [0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="absolute h-1.5 w-1.5 rounded-full"
          style={{
            background: color,
            boxShadow: `0 0 8px ${color}`,
            left: "50%",
            top: "50%",
            marginLeft: -3,
            marginTop: -3,
          }}
          animate={{ rotate: 360 }}
          transition={{
            duration: 4.8 + index * 0.7,
            repeat: Infinity,
            ease: "linear",
            delay: index * -1.1,
          }}
          transformTemplate={({ rotate }) => `rotate(${rotate}) translateX(${ringRadius + 1}px)`}
          aria-hidden="true"
        />
      ))}

      <div
        className="relative z-10 flex flex-col items-center justify-center rounded-full border-2 shadow-lg"
        style={{
          width: size,
          height: size,
          background: `radial-gradient(circle at 35% 30%, ${color}48 0%, #10131c 58%, #090b10 100%)`,
          borderColor: `${color}95`,
          boxShadow: `0 0 22px ${color}45, 0 0 52px ${color}1f, inset 0 0 16px rgba(255,255,255,0.035)`,
        }}
      >
        <span className="text-[10px] font-bold tracking-[0.22em] text-white/95 uppercase leading-none">VIBA</span>
        <span className="mt-1 text-[8px] font-medium text-white/55 leading-none">{PHASE_LABELS[phase]}</span>
        <span className="mt-1 text-[8px] tabular-nums leading-none" style={{ color }}>
          {Math.round(safeProgress)}%
        </span>
      </div>

      <div
        className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[8px] font-semibold uppercase tracking-[0.2em]"
        style={{ color: `${color}cc` }}
      >
        {activeCount > 0 ? `${activeCount} active` : "Coordinator"}
      </div>
    </div>
  );
}
