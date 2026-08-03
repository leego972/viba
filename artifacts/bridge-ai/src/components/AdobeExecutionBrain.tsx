import { useEffect, useRef } from "react";

export type ExecutionVisualPhase = "idle" | "planning" | "working" | "verifying" | "complete" | "failed";

interface Props {
  phase: ExecutionVisualPhase;
  activeNodes?: string[];
  className?: string;
  compact?: boolean;
  showOverlay?: boolean;
}

const SUPPLIED_ADOBE_VIDEOS = {
  main: "https://at.adobe.com/SQFrff2FxDkq786F",
  active: "https://at.adobe.com/u1yW29X4jlSsOUwS",
} as const;

function videoForPhase(phase: ExecutionVisualPhase): string {
  return phase === "idle" || phase === "complete"
    ? SUPPLIED_ADOBE_VIDEOS.main
    : SUPPLIED_ADOBE_VIDEOS.active;
}

export default function AdobeExecutionBrain({
  phase,
  className = "",
  compact = false,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const source = videoForPhase(phase);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.load();
    void video.play().catch(() => undefined);
  }, [source]);

  return (
    <div
      className={`relative isolate overflow-hidden bg-[#07090e] ${className}`}
      aria-label={`VIBA Adobe execution animation: ${phase}`}
    >
      <video
        ref={videoRef}
        key={source}
        className="absolute inset-0 h-full w-full select-none"
        style={{
          objectFit: compact ? "cover" : "contain",
          objectPosition: "50% 50%",
          transform: compact ? "scale(1.04)" : "none",
        }}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        aria-hidden="true"
      >
        <source src={source} type="video/mp4" />
      </video>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: compact
            ? "radial-gradient(circle at center, transparent 42%, rgba(4,8,22,.32) 100%)"
            : "linear-gradient(180deg, rgba(4,8,22,.02), rgba(4,8,22,.18))",
        }}
      />
    </div>
  );
}
