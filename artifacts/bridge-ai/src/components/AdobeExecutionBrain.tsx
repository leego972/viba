import { useEffect, useMemo, useRef, useState } from "react";

export type ExecutionVisualPhase = "idle" | "planning" | "working" | "verifying" | "complete" | "failed";

interface Props {
  phase: ExecutionVisualPhase;
  activeNodes?: string[];
  className?: string;
  compact?: boolean;
  showOverlay?: boolean;
}

type OperatorId = "scout" | "architect" | "builder" | "auditor";

type Operator = {
  id: OperatorId;
  label: string;
  role: string;
  x: number;
  y: number;
  accent: string;
};

// Base brain animation (self-hosted, served from /public/assets/brain).
// Used as the underlying layer for every phase; the operator plasma
// overlay (PlasmaOverlay, below) renders on top of it via z-20.
const BRAIN_ANIMATION_SRC = `${import.meta.env.BASE_URL}assets/brain/viba-brain-animation.mp4`;
// Static still frame, shown while the video buffers and as a fallback if
// it fails to load (blocked format, network error, etc.) so the brain
// screen never renders blank.
const BRAIN_POSTER_SRC = `${import.meta.env.BASE_URL}assets/hero/viba-brain-hero.webp`;

const SUPPLIED_ADOBE_VIDEOS = {
  main: BRAIN_ANIMATION_SRC,
  active: BRAIN_ANIMATION_SRC,
} as const;

const OPERATORS: Operator[] = [
  { id: "scout", label: "Scout", role: "Research", x: 18, y: 24, accent: "#6ee7ff" },
  { id: "architect", label: "Architect", role: "Planning", x: 80, y: 23, accent: "#a78bfa" },
  { id: "builder", label: "Builder", role: "Execution", x: 82, y: 73, accent: "#34d399" },
  { id: "auditor", label: "Auditor", role: "Verification", x: 17, y: 74, accent: "#f0abfc" },
];

const DEFAULT_ACTIVE_BY_PHASE: Record<ExecutionVisualPhase, OperatorId[]> = {
  idle: [],
  planning: ["scout", "architect"],
  working: ["scout", "architect", "builder"],
  verifying: ["builder", "auditor"],
  complete: ["auditor"],
  failed: ["architect", "auditor"],
};

function videoForPhase(phase: ExecutionVisualPhase): string {
  return phase === "idle" || phase === "complete"
    ? SUPPLIED_ADOBE_VIDEOS.main
    : SUPPLIED_ADOBE_VIDEOS.active;
}

function normalizeActiveNodes(activeNodes: string[] | undefined, phase: ExecutionVisualPhase): Set<OperatorId> {
  if (!activeNodes?.length) return new Set(DEFAULT_ACTIVE_BY_PHASE[phase]);

  const matches = new Set<OperatorId>();
  const normalized = activeNodes.map((node) => node.toLowerCase());

  for (const operator of OPERATORS) {
    if (normalized.some((node) => node.includes(operator.id) || node.includes(operator.label.toLowerCase()))) {
      matches.add(operator.id);
    }
  }

  return matches.size ? matches : new Set(DEFAULT_ACTIVE_BY_PHASE[phase]);
}

function PlasmaOverlay({ phase, activeNodes }: { phase: ExecutionVisualPhase; activeNodes?: string[] }) {
  const active = useMemo(() => normalizeActiveNodes(activeNodes, phase), [activeNodes, phase]);
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden="true">
      <style>{`
        @keyframes viba-float-a { 0%,100%{transform:translate3d(-50%,-50%,0)} 50%{transform:translate3d(-50%,calc(-50% - 7px),0)} }
        @keyframes viba-float-b { 0%,100%{transform:translate3d(-50%,-50%,0)} 50%{transform:translate3d(calc(-50% + 5px),calc(-50% + 5px),0)} }
        @keyframes viba-orbit-glow { 0%,100%{opacity:.45;filter:blur(8px)} 50%{opacity:.85;filter:blur(12px)} }
        @keyframes viba-plasma-out { 0%{stroke-dashoffset:42;opacity:.12} 35%{opacity:.95} 100%{stroke-dashoffset:0;opacity:.18} }
        @keyframes viba-plasma-back { 0%{stroke-dashoffset:-42;opacity:.08} 35%{opacity:.85} 100%{stroke-dashoffset:0;opacity:.16} }
        @keyframes viba-node-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,0),0 0 18px var(--accent)} 50%{box-shadow:0 0 0 7px rgba(255,255,255,.03),0 0 32px var(--accent)} }
      `}</style>

      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <filter id="viba-plasma-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.35" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {OPERATORS.map((operator, index) => {
          const isActive = active.has(operator.id);
          const duration = 2.7 + index * 0.32;
          return (
            <g key={operator.id} filter="url(#viba-plasma-glow)">
              <path
                d={`M 50 50 Q ${(50 + operator.x) / 2} ${(50 + operator.y) / 2 - (index % 2 ? 5 : -5)} ${operator.x} ${operator.y}`}
                fill="none"
                stroke={operator.accent}
                strokeWidth={isActive ? 0.55 : 0.18}
                strokeLinecap="round"
                strokeDasharray="3 7"
                style={{
                  opacity: isActive ? 0.7 : 0.12,
                  animation: reducedMotion || !isActive ? "none" : `viba-plasma-out ${duration}s linear infinite`,
                }}
              />
              {isActive && (
                <path
                  d={`M ${operator.x} ${operator.y} Q ${(50 + operator.x) / 2} ${(50 + operator.y) / 2 + (index % 2 ? 4 : -4)} 50 50`}
                  fill="none"
                  stroke="#fff7e8"
                  strokeWidth="0.32"
                  strokeLinecap="round"
                  strokeDasharray="2 8"
                  style={{
                    animation: reducedMotion ? "none" : `viba-plasma-back ${duration + 0.65}s linear infinite`,
                    animationDelay: `${index * 0.28}s`,
                  }}
                />
              )}
            </g>
          );
        })}
      </svg>

      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/25 bg-black/45 px-3 py-1.5 text-center backdrop-blur-md"
        style={{ boxShadow: "0 0 26px rgba(139,92,246,.32), inset 0 0 14px rgba(255,255,255,.05)" }}
      >
        <div className="text-[10px] font-semibold tracking-[0.18em] text-white">VIBA CORE</div>
        <div className="mt-0.5 text-[8px] tracking-[0.16em] text-white/60">GROK COORDINATOR</div>
      </div>

      {OPERATORS.map((operator, index) => {
        const isActive = active.has(operator.id);
        return (
          <div
            key={operator.id}
            className="absolute"
            style={{
              left: `${operator.x}%`,
              top: `${operator.y}%`,
              transform: "translate(-50%,-50%)",
              animation: reducedMotion ? "none" : `${index % 2 ? "viba-float-b" : "viba-float-a"} ${4.6 + index * 0.35}s ease-in-out infinite`,
              animationDelay: `${index * -0.7}s`,
            }}
          >
            <div
              className="rounded-2xl border px-2.5 py-2 text-center backdrop-blur-md"
              style={{
                minWidth: 78,
                borderColor: isActive ? operator.accent : "rgba(255,255,255,.14)",
                background: isActive ? "rgba(7,12,28,.78)" : "rgba(7,12,28,.54)",
                opacity: isActive ? 1 : 0.5,
                transition: "opacity 300ms ease, border-color 300ms ease, background 300ms ease",
                boxShadow: isActive ? `0 0 18px ${operator.accent}55, inset 0 0 12px rgba(255,255,255,.03)` : "0 0 10px rgba(255,255,255,.03)",
                ["--accent" as string]: operator.accent,
                animation: reducedMotion || !isActive ? "none" : "viba-node-pulse 2.4s ease-in-out infinite",
              }}
            >
              <div
                className="mx-auto mb-1.5 flex h-7 w-7 items-center justify-center rounded-full border text-[9px] font-bold"
                style={{ borderColor: operator.accent, color: operator.accent, boxShadow: `0 0 14px ${operator.accent}66` }}
              >
                {operator.label.slice(0, 1)}
              </div>
              <div className="text-[10px] font-semibold tracking-[0.08em] text-white">{operator.label}</div>
              <div className="mt-0.5 text-[8px] tracking-[0.12em] text-white/55">{operator.role}</div>
            </div>
          </div>
        );
      })}

      <div
        className="absolute inset-[18%] rounded-full border border-white/5"
        style={{ animation: reducedMotion ? "none" : "viba-orbit-glow 4s ease-in-out infinite" }}
      />
    </div>
  );
}

export default function AdobeExecutionBrain({
  phase,
  activeNodes,
  className = "",
  compact = false,
  showOverlay = true,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const source = videoForPhase(phase);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setVideoFailed(false);
    video.load();
    void video.play().catch(() => undefined);
  }, [source]);

  return (
    <div
      className={`relative isolate overflow-hidden bg-[#07090e] ${className}`}
      aria-label={`VIBA Adobe execution animation: ${phase}`}
    >
      {videoFailed ? (
        // Video failed to load (bad format, network error, etc.) — fall
        // back to the static brain still so the screen is never blank.
        <img
          src={BRAIN_POSTER_SRC}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full select-none object-contain"
          style={{ objectPosition: "50% 50%" }}
        />
      ) : (
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
          poster={BRAIN_POSTER_SRC}
          disablePictureInPicture
          aria-hidden="true"
          onError={() => setVideoFailed(true)}
        >
          <source src={source} type="video/mp4" />
        </video>
      )}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background: compact
            ? "radial-gradient(circle at center, transparent 42%, rgba(4,8,22,.32) 100%)"
            : "linear-gradient(180deg, rgba(4,8,22,.02), rgba(4,8,22,.18))",
        }}
      />
      {showOverlay && <PlasmaOverlay phase={phase} activeNodes={activeNodes} />}
    </div>
  );
}
