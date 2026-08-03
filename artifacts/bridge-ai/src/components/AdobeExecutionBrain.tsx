import ExecutionOrbOverlay from "@/components/ExecutionOrbOverlay";
import "@/components/execution-orb-overlay.css";
import { assetUrl, hero } from "@/lib/assets";

export type ExecutionVisualPhase = "idle" | "planning" | "working" | "verifying" | "complete" | "failed";

interface Props {
  phase: ExecutionVisualPhase;
  activeNodes?: string[];
  className?: string;
  compact?: boolean;
  showOverlay?: boolean;
}

const PHASE_FILTERS: Record<ExecutionVisualPhase, string> = {
  idle: "saturate(1.04) contrast(1.05) brightness(.92)",
  planning: "saturate(1.12) contrast(1.08) hue-rotate(4deg)",
  working: "saturate(1.2) contrast(1.1) brightness(1.02)",
  verifying: "saturate(1.08) contrast(1.12) hue-rotate(14deg)",
  complete: "saturate(1.16) contrast(1.08) brightness(1.06)",
  failed: "saturate(.78) contrast(1.16) hue-rotate(300deg) brightness(.82)",
};

export default function AdobeExecutionBrain({
  phase,
  activeNodes,
  className = "",
  compact = false,
  showOverlay = true,
}: Props) {
  return (
    <div
      className={`relative isolate overflow-hidden ${className}`}
      aria-label={`VIBA execution brain: ${phase}`}
      style={{ background: "#07090e" }}
    >
      <img
        src={assetUrl(hero.brain)}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={hero.brain.width}
        height={hero.brain.height}
        className="absolute inset-0 h-full w-full select-none object-cover"
        style={{
          objectPosition: "50% 50%",
          filter: PHASE_FILTERS[phase],
          transform: compact ? "scale(1.08)" : "scale(1.015)",
          transition: "filter 500ms ease, transform 500ms ease",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: compact
            ? "radial-gradient(circle at center, transparent 34%, rgba(4,8,22,.42) 100%)"
            : "linear-gradient(180deg, rgba(4,8,22,.02), rgba(4,8,22,.24))",
        }}
      />
      {showOverlay && <ExecutionOrbOverlay phase={phase} activeNodes={activeNodes} />}
    </div>
  );
}
