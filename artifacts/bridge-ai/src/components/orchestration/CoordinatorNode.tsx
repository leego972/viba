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
}

export function CoordinatorNode({ phase, reducedMotion, size = 72 }: Props) {
  const color = PHASE_COLORS[phase];

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* Outer glow ring */}
      {!reducedMotion && (
        <motion.div
          className="absolute rounded-full"
          style={{
            width: size + 24,
            height: size + 24,
            background: `radial-gradient(circle, ${color}30 0%, transparent 70%)`,
          }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Middle pulse ring */}
      {!reducedMotion && (
        <motion.div
          className="absolute rounded-full border"
          style={{
            width: size + 8,
            height: size + 8,
            borderColor: color + "60",
          }}
          animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
        />
      )}

      {/* Core circle */}
      <div
        className="relative z-10 flex flex-col items-center justify-center rounded-full border-2 shadow-lg"
        style={{
          width: size,
          height: size,
          background: `radial-gradient(circle at 35% 35%, ${color}40 0%, #0f1117 100%)`,
          borderColor: color + "80",
          boxShadow: `0 0 20px ${color}40, 0 0 40px ${color}20`,
        }}
      >
        <span className="text-[10px] font-bold tracking-widest text-white/90 uppercase leading-none">VIBA</span>
        <span className="text-[8px] text-white/50 mt-0.5 leading-none">{PHASE_LABELS[phase]}</span>
      </div>

      {/* Label below */}
      <div
        className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold uppercase tracking-widest"
        style={{ color }}
      >
        Coordinator
      </div>
    </div>
  );
}
