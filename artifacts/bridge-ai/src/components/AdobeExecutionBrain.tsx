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

const OPERATORS: Operator[] = [
  { id: "scout", label: "Scout", role: "Research", x: 18, y: 24, accent: "#6ee7ff" },
  { id: "architect", label: "Architect", role: "Planning", x: 80, y: 23, accent: "#a78bfa" },
  { id: "builder", label: "Builder", role: "Execution", x: 82, y: 73, accent: "#34d399" },
  { id: "auditor", label: "Auditor", role: "Verification", x: 17, y: 74, accent: "#f0abfc" },
];

const DEFAULT_ACTIVE_BY_PHASE: Record<ExecutionVisualPhase, OperatorId[]> = {
  idle: ["scout", "architect", "builder", "auditor"],
  planning: ["scout", "architect"],
  working: ["scout", "architect", "builder"],
  verifying: ["builder", "auditor"],
  complete: ["auditor"],
  failed: ["architect", "auditor"],
};

function videoForPhase(phase: ExecutionVisualPhase): string {
  const main = import.meta.env.VITE_VIBA_BRAIN_VIDEO_MAIN as string | undefined;
  const active = import.meta.env.VITE_VIBA_BRAIN_VIDEO_ACTIVE as string | undefined;
  return phase === "idle" || phase === "complete" ? (main ?? "") : (active ?? main ?? "");
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
        @keyframes viba-float-a { 0%,100%{transform:translate3d(-50%,-50%,0)} 50%{transform:translate3d(-50%,calc(-50% - 8px),0)} }
        @keyframes viba-float-b { 0%,100%{transform:translate3d(-50%,-50%,0)} 50%{transform:translate3d(calc(-50% + 6px),calc(-50% + 6px),0)} }
        @keyframes viba-orbit-glow { 0%,100%{opacity:.36;filter:blur(8px)} 50%{opacity:.88;filter:blur(13px)} }
        @keyframes viba-plasma-out { 0%{stroke-dashoffset:44;opacity:.18} 35%{opacity:1} 100%{stroke-dashoffset:0;opacity:.2} }
        @keyframes viba-plasma-back { 0%{stroke-dashoffset:-44;opacity:.12} 35%{opacity:.95} 100%{stroke-dashoffset:0;opacity:.18} }
        @keyframes viba-node-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,0),0 0 18px var(--accent)} 50%{box-shadow:0 0 0 7px rgba(255,255,255,.04),0 0 34px var(--accent)} }
        @keyframes viba-brain-breathe { 0%,100%{transform:translate(-50%,-50%) scale(1);filter:drop-shadow(0 0 22px rgba(77,214,255,.72)) drop-shadow(0 0 52px rgba(128,72,255,.55))} 50%{transform:translate(-50%,-50%) scale(1.045);filter:drop-shadow(0 0 30px rgba(77,214,255,.95)) drop-shadow(0 0 72px rgba(128,72,255,.8))} }
      `}</style>

      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <filter id="viba-plasma-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.35" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {OPERATORS.map((operator, index) => {
          const isActive = active.has(operator.id);
          const duration = 2.4 + index * 0.3;
          return (
            <g key={operator.id} filter="url(#viba-plasma-glow)">
              <path
                d={`M 50 50 Q ${(50 + operator.x) / 2} ${(50 + operator.y) / 2 - (index % 2 ? 5 : -5)} ${operator.x} ${operator.y}`}
                fill="none"
                stroke={operator.accent}
                strokeWidth={isActive ? 0.62 : 0.2}
                strokeLinecap="round"
                strokeDasharray="3 7"
                style={{ opacity: isActive ? 0.82 : 0.14, animation: reducedMotion || !isActive ? "none" : `viba-plasma-out ${duration}s linear infinite` }}
              />
              {isActive && (
                <path
                  d={`M ${operator.x} ${operator.y} Q ${(50 + operator.x) / 2} ${(50 + operator.y) / 2 + (index % 2 ? 4 : -4)} 50 50`}
                  fill="none"
                  stroke="#fff7e8"
                  strokeWidth="0.36"
                  strokeLinecap="round"
                  strokeDasharray="2 8"
                  style={{ animation: reducedMotion ? "none" : `viba-plasma-back ${duration + 0.65}s linear infinite`, animationDelay: `${index * 0.28}s` }}
                />
              )}
            </g>
          );
        })}
      </svg>

      <div className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 translate-y-[58px] rounded-full border border-white/25 bg-black/55 px-4 py-2 text-center backdrop-blur-md" style={{ boxShadow: "0 0 30px rgba(139,92,246,.42), inset 0 0 14px rgba(255,255,255,.06)" }}>
        <div className="text-[11px] font-semibold tracking-[0.2em] text-white">VIBA CORE</div>
        <div className="mt-0.5 text-[8px] tracking-[0.16em] text-white/65">AI ORCHESTRATOR</div>
      </div>

      {OPERATORS.map((operator, index) => {
        const isActive = active.has(operator.id);
        return (
          <div key={operator.id} className="absolute" style={{ left: `${operator.x}%`, top: `${operator.y}%`, transform: "translate(-50%,-50%)", animation: reducedMotion ? "none" : `${index % 2 ? "viba-float-b" : "viba-float-a"} ${4.3 + index * 0.35}s ease-in-out infinite`, animationDelay: `${index * -0.7}s` }}>
            <div className="rounded-2xl border px-3 py-2.5 text-center backdrop-blur-md" style={{ minWidth: 82, borderColor: isActive ? operator.accent : "rgba(255,255,255,.14)", background: isActive ? "rgba(7,12,28,.82)" : "rgba(7,12,28,.58)", opacity: isActive ? 1 : 0.58, boxShadow: isActive ? `0 0 20px ${operator.accent}66, inset 0 0 12px rgba(255,255,255,.04)` : "0 0 10px rgba(255,255,255,.03)", ["--accent" as string]: operator.accent, animation: reducedMotion || !isActive ? "none" : "viba-node-pulse 2.2s ease-in-out infinite" }}>
              <div className="mx-auto mb-1.5 flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-bold" style={{ borderColor: operator.accent, color: operator.accent, boxShadow: `0 0 16px ${operator.accent}77` }}>{operator.label.slice(0, 1)}</div>
              <div className="text-[11px] font-semibold tracking-[0.08em] text-white">{operator.label}</div>
              <div className="mt-0.5 text-[8px] tracking-[0.12em] text-white/58">{operator.role}</div>
            </div>
          </div>
        );
      })}

      <div className="absolute inset-[17%] rounded-full border border-white/7" style={{ animation: reducedMotion ? "none" : "viba-orbit-glow 3.6s ease-in-out infinite" }} />
    </div>
  );
}

export default function AdobeExecutionBrain({ phase, activeNodes, className = "", compact = false, showOverlay = true }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const source = videoForPhase(phase);
  const fallbackBrain = `${import.meta.env.BASE_URL}viba-brain-logo.svg`;

  useEffect(() => {
    setVideoReady(false);
    const video = videoRef.current;
    if (!video || !source) return;
    video.load();
    void video.play().catch(() => undefined);
  }, [source]);

  return (
    <div className={`relative isolate overflow-hidden bg-[#07090e] ${className}`} aria-label={`VIBA execution brain animation: ${phase}`}>
      <div className="absolute inset-0 z-0" style={{ background: "radial-gradient(circle at 50% 48%, rgba(54,88,255,.2), transparent 34%), radial-gradient(circle at 50% 52%, rgba(151,65,255,.16), transparent 48%)" }} />
      <img
        src={fallbackBrain}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 z-[2] h-[42%] w-[42%] max-h-[270px] max-w-[270px] object-contain"
        style={{ opacity: videoReady ? 0.18 : 1, animation: "viba-brain-breathe 3.2s ease-in-out infinite", transition: "opacity 500ms ease" }}
      />
      {source && (
        <video
          ref={videoRef}
          key={source}
          className="absolute inset-0 z-[3] h-full w-full select-none transition-opacity duration-500"
          style={{ objectFit: compact ? "cover" : "contain", objectPosition: "50% 50%", transform: compact ? "scale(1.04)" : "none", opacity: videoReady ? 1 : 0 }}
          autoPlay muted loop playsInline preload="auto" disablePictureInPicture aria-hidden="true"
          onCanPlay={() => setVideoReady(true)}
          onError={() => setVideoReady(false)}
        >
          <source src={source} type="video/mp4" />
        </video>
      )}
      <div className="pointer-events-none absolute inset-0 z-10" style={{ background: compact ? "radial-gradient(circle at center, transparent 42%, rgba(4,8,22,.32) 100%)" : "linear-gradient(180deg, rgba(4,8,22,.01), rgba(4,8,22,.18))" }} />
      {showOverlay && <PlasmaOverlay phase={phase} activeNodes={activeNodes} />}
    </div>
  );
}
