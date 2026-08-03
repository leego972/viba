import { motion } from "framer-motion";
import AdobeExecutionBrain, { type ExecutionVisualPhase } from "@/components/AdobeExecutionBrain";
import type { CoordinatorPhase } from "@/lib/orchestrationViewModel";
import { PHASE_LABELS } from "@/lib/orchestrationViewModel";

const PHASE_COLORS: Record<CoordinatorPhase, string> = {
  idle:             "#94a3b8",
  planning:         "#818cf8",
  delegating:       "#22d3ee",
  reviewing:        "#fbbf24",
  waiting_approval: "#fb7185",
  synthesising:     "#c084fc",
  complete:         "#34d399",
  error:            "#fb7185",
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
  const ringSize = size + 34;
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
        <circle cx={ringSize / 2} cy={ringSize / 2} r={ringRadius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
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
          animate={{ strokeDashoffset: dashOffset, opacity: safeProgress > 0 ? 0.95 : 0.28 }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.8, ease: "easeOut" }}
          style={{ filter: `drop-shadow(0 0 6px ${color}90)` }}
        />
      </svg>

      {!reducedMotion && isWorking && (
        <motion.div
          className="absolute inset-0 rounded-full border border-dashed"
          style={{ borderColor: `${color}55` }}
          animate={{ rotate: 360 }}
          transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
        />
      )}

      <div
        className="relative z-10 overflow-hidden rounded-full border shadow-2xl"
        style={{
          width: size,
          height: size,
          borderColor: `${color}a0`,
          boxShadow: `0 0 24px ${color}55, 0 0 58px ${color}25`,
        }}
      >
        <AdobeExecutionBrain
          phase={EXECUTION_PHASE[phase]}
          compact
          showOverlay={!reducedMotion}
          className="absolute inset-0 h-full w-full"
        />
        <motion.div
          className="pointer-events-none absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: Math.max(10, size * 0.18),
            height: Math.max(10, size * 0.18),
            background: "radial-gradient(circle at 32% 28%, #ffffff 0%, #f8f9ff 30%, #dbe5f0 64%, #9d8fc8 100%)",
            boxShadow: "0 0 8px rgba(255,255,255,.95), 0 0 20px rgba(129,220,255,.72), 0 0 34px rgba(166,120,255,.38)",
          }}
          animate={reducedMotion ? undefined : { scale: isWorking ? [1, 1.13, 1] : [1, 1.06, 1], opacity: [0.9, 1, 0.9] }}
          transition={{ duration: isWorking ? 1.5 : 3.2, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div
        className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-black/55 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] backdrop-blur-md"
        style={{ color: `${color}e6` }}
      >
        {activeCount > 0 ? `${activeCount} active · ${PHASE_LABELS[phase]}` : PHASE_LABELS[phase]}
      </div>
    </div>
  );
}
