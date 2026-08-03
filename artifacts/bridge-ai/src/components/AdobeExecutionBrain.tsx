export type ExecutionVisualPhase = "idle" | "planning" | "working" | "verifying" | "complete" | "failed";

interface Props {
  phase: ExecutionVisualPhase;
  activeNodes?: string[];
  className?: string;
  compact?: boolean;
  showOverlay?: boolean;
}

export default function AdobeExecutionBrain({
  phase,
  className = "",
  compact = false,
}: Props) {
  return (
    <div
      className={`relative isolate overflow-hidden ${className}`}
      aria-label={`VIBA execution visual unavailable: ${phase}`}
      style={{
        background: compact
          ? "radial-gradient(circle at center, rgba(45,55,105,.32), rgba(7,9,14,.96) 68%)"
          : "radial-gradient(circle at center, rgba(50,63,132,.34), rgba(7,9,14,.98) 72%)",
      }}
    />
  );
}
