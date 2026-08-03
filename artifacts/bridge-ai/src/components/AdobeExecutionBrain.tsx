import ExecutionOrbOverlay from "@/components/ExecutionOrbOverlay";
import "@/components/execution-orb-overlay.css";

export type ExecutionVisualPhase = "idle" | "planning" | "working" | "verifying" | "complete" | "failed";

export const ADOBE_BRAIN_FRAMES = {
  idle: "https://platform-cs-jpn3.adobe.io/rendition/id/urn:aaid:sc:AP:da498ddc-22a2-4762-b7f5-86c08a1548c4?size=1200",
  planning: "https://platform-cs-jpn3.adobe.io/rendition/id/urn:aaid:sc:AP:22b22ddb-1b95-4682-8cad-029e4dccbaac?size=1200",
  working: "https://platform-cs-jpn3.adobe.io/rendition/id/urn:aaid:sc:AP:9a0cd621-8524-4bc7-858d-65e4e46070e7?size=1200",
  verifying: "https://platform-cs-jpn3.adobe.io/rendition/id/urn:aaid:sc:AP:def911ca-2100-4f08-8b13-e1e7af778814?size=1200",
  complete: "https://platform-cs-jpn3.adobe.io/rendition/id/urn:aaid:sc:AP:fc2cd941-a5b4-4089-89b8-cd5da98cb548?size=1200",
  failed: "https://platform-cs-jpn3.adobe.io/rendition/id/urn:aaid:sc:AP:a5d1763c-afdd-49a7-b852-1ad994764866?size=1200",
} as const;

const PRELOAD_FRAMES = Object.values(ADOBE_BRAIN_FRAMES);
let preloaded = false;

function preloadFrames() {
  if (preloaded || typeof Image === "undefined") return;
  preloaded = true;
  PRELOAD_FRAMES.forEach((src) => {
    const image = new Image();
    image.src = src;
  });
}

interface Props {
  phase: ExecutionVisualPhase;
  activeNodes?: string[];
  className?: string;
  compact?: boolean;
  showOverlay?: boolean;
}

export default function AdobeExecutionBrain({
  phase,
  activeNodes,
  className = "",
  compact = false,
  showOverlay = true,
}: Props) {
  preloadFrames();
  const src = ADOBE_BRAIN_FRAMES[phase];

  return (
    <div
      className={`relative isolate overflow-hidden ${className}`}
      aria-label={`VIBA execution brain: ${phase}`}
      style={{ background: "#07090e" }}
    >
      <img
        src={src}
        alt="VIBA Adobe cinematic execution brain"
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-cover"
        style={{
          filter: compact ? "saturate(1.08) contrast(1.08)" : "saturate(1.08) contrast(1.04)",
          transform: compact ? "scale(1.2)" : "scale(1.02)",
          transition: "opacity 600ms ease, filter 600ms ease",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: compact
            ? "radial-gradient(circle, transparent 30%, rgba(4,8,22,.48) 100%)"
            : "linear-gradient(180deg, rgba(4,8,22,.03), rgba(4,8,22,.32))",
        }}
      />
      {showOverlay && <ExecutionOrbOverlay phase={phase} activeNodes={activeNodes} />}
    </div>
  );
}
