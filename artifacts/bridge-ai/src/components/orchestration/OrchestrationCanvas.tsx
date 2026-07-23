import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OrchestrationAgent, OrchestrationViewModel } from "@/lib/orchestrationViewModel";
import { PHASE_LABELS } from "@/lib/orchestrationViewModel";
import { useReducedMotion } from "@/lib/motionPreferences";
import { AgentConnection } from "./AgentConnection";
import { AgentNode } from "./AgentNode";
import { CoordinatorNode } from "./CoordinatorNode";

interface Props {
  vm: OrchestrationViewModel;
  height?: number;
}

interface NodePosition {
  x: number;
  y: number;
  agent: OrchestrationAgent;
}

interface CanvasSize {
  w: number;
  h: number;
}

function getRadialPositions(count: number, cx: number, cy: number, radius: number): Array<{ x: number; y: number }> {
  if (count === 0) return [];
  if (count === 1) return [{ x: cx, y: cy - radius }];
  return Array.from({ length: count }, (_, index) => {
    const angle = (2 * Math.PI * index) / count - Math.PI / 2;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function humanise(value: string): string {
  const cleaned = value.replace(/[_-]+/g, " ").trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : "Activity updated";
}

function clampText(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 1)).trimEnd()}…`;
}

export function OrchestrationCanvas({ vm, height = 520 }: Props) {
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<CanvasSize>({ w: 700, h: Math.max(height, 500) });
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [pageVisible, setPageVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState !== "hidden",
  );

  const isMobile = size.w < 640;
  const minimumHeight = isMobile ? 460 : 500;
  const effectiveHeight = Math.max(height, minimumHeight);
  const animationsEnabled = !reducedMotion && pageVisible;

  const updateSize = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    setSize({ w: element.offsetWidth, h: effectiveHeight });
  }, [effectiveHeight]);

  useEffect(() => {
    updateSize();
    const observer = new ResizeObserver(updateSize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateSize]);

  useEffect(() => {
    const onVisibilityChange = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const visibleAgents = vm.isDemo ? [] : vm.agents;
  const hasRealTelemetry = !vm.isDemo && visibleAgents.length > 0;
  const activeAgents = visibleAgents.filter((agent) => agent.status === "working" || agent.status === "reviewing");
  const latestEvent = vm.events.at(-1);
  const selectedAgent = selectedAgentId
    ? visibleAgents.find((agent) => agent.id === selectedAgentId) ?? null
    : null;

  const highlightedAgentId = useMemo(() => {
    const eventAgent = latestEvent?.agentName?.toLowerCase();
    if (eventAgent) {
      const matched = visibleAgents.find((agent) => {
        const name = agent.name.toLowerCase();
        return eventAgent === name || eventAgent.includes(name) || name.includes(eventAgent);
      });
      if (matched) return matched.id;
    }
    return activeAgents[0]?.id;
  }, [activeAgents, latestEvent, visibleAgents]);

  const nodeSize = isMobile ? 48 : 58;
  const coordinatorSize = isMobile ? 70 : 80;
  const horizontalSafeZone = isMobile ? 82 : 118;
  const topSafeZone = isMobile ? 104 : 110;
  const bottomSafeZone = selectedAgent ? (isMobile ? 178 : 132) : 94;
  const usableHeight = Math.max(190, size.h - topSafeZone - bottomSafeZone);
  const cx = size.w / 2;
  const cy = topSafeZone + usableHeight / 2;
  const maxHorizontalRadius = Math.max(78, size.w / 2 - horizontalSafeZone);
  const maxVerticalRadius = Math.max(78, usableHeight / 2 - 28);
  const radius = Math.max(78, Math.min(maxHorizontalRadius, maxVerticalRadius, isMobile ? 148 : 224));
  const radialPositions = getRadialPositions(visibleAgents.length, cx, cy, radius);
  const nodePositions: NodePosition[] = visibleAgents.map((agent, index) => ({
    x: radialPositions[index].x,
    y: radialPositions[index].y,
    agent,
  }));

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none overflow-hidden bg-[#07090e]"
      style={{ height: effectiveHeight, minHeight: effectiveHeight }}
      aria-label="Live AI collaboration viewer"
    >
      <div
        className="absolute inset-0 pointer-events-none opacity-70"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(circle at center, black 6%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(circle at center, black 6%, transparent 78%)",
        }}
      />

      {animationsEnabled && hasRealTelemetry && (
        <motion.div
          className="absolute inset-[-30%] pointer-events-none"
          style={{
            background:
              "conic-gradient(from 180deg at 50% 50%, transparent 0deg, rgba(99,102,241,0.055) 75deg, transparent 150deg, rgba(6,182,212,0.05) 235deg, transparent 320deg)",
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 36, repeat: Infinity, ease: "linear" }}
        />
      )}

      <div className="absolute left-3 right-3 top-3 z-30 flex items-center gap-2">
        <div className="flex min-w-0 items-center gap-2 rounded-full border border-white/[0.08] bg-black/35 px-3 py-1.5 backdrop-blur-md">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{
              background: activeAgents.length > 0 ? "#22d3ee" : vm.phase === "complete" ? "#22c55e" : "#6b7280",
              boxShadow: activeAgents.length > 0 ? "0 0 8px rgba(34,211,238,0.8)" : undefined,
            }}
          />
          <span className="truncate text-[10px] font-semibold uppercase tracking-[0.15em] text-white/75">
            {PHASE_LABELS[vm.phase]}
          </span>
          <span className="text-[10px] tabular-nums text-white/35">· {formatElapsed(vm.elapsedMs)}</span>
        </div>

        <div className="flex min-w-[120px] flex-1 items-center gap-2 rounded-full border border-white/[0.07] bg-black/30 px-3 py-1.5 backdrop-blur-md">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: "linear-gradient(90deg, #6366f1, #22d3ee)",
                boxShadow: "0 0 10px rgba(34,211,238,0.45)",
              }}
              initial={false}
              animate={{ width: `${Math.max(0, Math.min(100, vm.progress))}%` }}
              transition={reducedMotion ? { duration: 0 } : { duration: 0.75, ease: "easeOut" }}
            />
          </div>
          <span className="w-8 text-right text-[10px] font-semibold tabular-nums text-white/72">
            {Math.round(vm.progress)}%
          </span>
        </div>

        <div className="hidden rounded-full border border-white/[0.07] bg-black/30 px-3 py-1.5 text-[10px] text-white/42 backdrop-blur-md sm:block">
          <strong className="font-semibold text-cyan-300/85">{activeAgents.length}</strong> active
        </div>
      </div>

      <svg
        className="absolute inset-0 pointer-events-none overflow-visible"
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="canvasGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#6366f13b" />
            <stop offset="62%" stopColor="#22d3ee0d" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>

        <ellipse
          cx={cx}
          cy={cy}
          rx={radius * 0.84}
          ry={radius * 0.58}
          fill="url(#canvasGlow)"
          opacity={hasRealTelemetry ? 0.55 : 0.16}
        />

        {[0.46, 0.78, 1.08].map((ring, index) => (
          <circle
            key={ring}
            cx={cx}
            cy={cy}
            r={radius * ring}
            fill="none"
            stroke={index === 1 ? "rgba(99,102,241,0.09)" : "rgba(255,255,255,0.035)"}
            strokeWidth={1}
            strokeDasharray={index === 2 ? "2 8" : undefined}
          />
        ))}

        {nodePositions.map((position) => (
          <AgentConnection
            key={position.agent.id}
            id={position.agent.id}
            from={{ x: cx, y: cy }}
            to={{ x: position.x, y: position.y }}
            status={position.agent.status}
            color={position.agent.color}
            reducedMotion={!animationsEnabled}
            highlighted={position.agent.id === highlightedAgentId}
          />
        ))}
      </svg>

      {nodePositions.map((position, index) => (
        <motion.div
          key={position.agent.id}
          className="absolute z-10"
          style={{ left: position.x, top: position.y, x: "-50%", y: "-50%" }}
          initial={animationsEnabled ? { opacity: 0, scale: 0.82 } : false}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: animationsEnabled ? Math.min(index * 0.06, 0.36) : 0 }}
        >
          <AgentNode
            agent={position.agent}
            reducedMotion={!animationsEnabled}
            size={nodeSize}
            highlighted={position.agent.id === highlightedAgentId}
            selected={position.agent.id === selectedAgentId}
            onClick={() => setSelectedAgentId((current) => current === position.agent.id ? null : position.agent.id)}
          />
        </motion.div>
      ))}

      <div
        className="absolute z-20"
        style={{ left: cx, top: cy, transform: "translate(-50%, -50%)" }}
      >
        <CoordinatorNode
          phase={hasRealTelemetry ? vm.phase : "idle"}
          reducedMotion={!animationsEnabled}
          size={coordinatorSize}
          progress={vm.progress}
          activeCount={activeAgents.length}
        />
      </div>

      {!hasRealTelemetry && (
        <div className="absolute inset-x-6 bottom-10 z-20 text-center">
          <p className="text-sm font-medium text-white/58">No live collaboration activity yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-white/30">
            Start a session to display verified task delegation, agent status, handoffs and progress.
          </p>
        </div>
      )}

      <AnimatePresence mode="wait">
        {selectedAgent ? (
          <motion.div
            key={selectedAgent.id}
            className="absolute bottom-3 left-3 right-3 z-40 rounded-xl border border-white/10 bg-[#10131b]/96 p-3 shadow-2xl backdrop-blur-xl"
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: selectedAgent.color, boxShadow: `0 0 8px ${selectedAgent.color}` }} />
                  <span className="truncate text-sm font-semibold text-white/92">{selectedAgent.name}</span>
                  <span className="truncate text-xs text-white/40">{selectedAgent.role}</span>
                </div>
                {selectedAgent.taskSummary && (
                  <p className="mt-1 truncate text-[10px] text-white/52">{selectedAgent.taskSummary}</p>
                )}
              </div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs text-white/38 transition-colors hover:bg-white/5 hover:text-white/75"
                onClick={() => setSelectedAgentId(null)}
                aria-label="Close agent details"
              >
                Close
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-white/5 pt-2 text-[10px] sm:grid-cols-4">
              <div><span className="text-white/32">Provider</span><div className="mt-0.5 truncate capitalize text-white/72">{selectedAgent.provider}</div></div>
              <div><span className="text-white/32">Status</span><div className="mt-0.5 capitalize" style={{ color: selectedAgent.color }}>{selectedAgent.status}</div></div>
              <div><span className="text-white/32">Cost</span><div className="mt-0.5 text-emerald-400">{selectedAgent.cost === undefined ? "Live total" : `$${selectedAgent.cost.toFixed(4)}`}</div></div>
              <div><span className="text-white/32">Latency</span><div className="mt-0.5 text-white/72">{selectedAgent.latencyMs ? `${selectedAgent.latencyMs}ms` : "Measuring"}</div></div>
            </div>
          </motion.div>
        ) : hasRealTelemetry ? (
          <motion.div
            key={latestEvent?.id ?? "waiting"}
            className="absolute bottom-3 left-3 right-3 z-30 flex items-center gap-3 rounded-xl border border-white/[0.07] bg-black/35 px-3 py-2.5 backdrop-blur-md"
            initial={reducedMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            <span className="relative flex h-2 w-2 shrink-0">
              {animationsEnabled && activeAgents.length > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-35" />}
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-semibold text-white/74">
                {latestEvent ? humanise(latestEvent.action) : "Waiting for the next verified event"}
              </p>
              {latestEvent?.detail && (
                <p className="mt-0.5 truncate text-[9px] text-white/34">{clampText(latestEvent.detail, isMobile ? 62 : 118)}</p>
              )}
            </div>
            <span className="hidden text-[9px] tabular-nums text-white/28 sm:block">
              {latestEvent ? latestEvent.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Live"}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
