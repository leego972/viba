import { useState, useRef, useEffect, useCallback } from "react";
import type { OrchestrationViewModel, OrchestrationAgent } from "@/lib/orchestrationViewModel";
import { CoordinatorNode } from "./CoordinatorNode";
import { AgentNode } from "./AgentNode";
import { AgentConnection } from "./AgentConnection";
import { useReducedMotion } from "@/lib/motionPreferences";

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
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });
}

export function OrchestrationCanvas({ vm, height = 520 }: Props) {
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const minimumHeight = isMobile ? 420 : 520;
  const effectiveHeight = Math.max(height, minimumHeight);
  const [size, setSize] = useState<CanvasSize>({ w: 600, h: effectiveHeight });
  const [selectedAgent, setSelectedAgent] = useState<OrchestrationAgent | null>(null);

  const updateSize = useCallback(() => {
    if (containerRef.current) {
      setSize({ w: containerRef.current.offsetWidth, h: effectiveHeight });
    }
  }, [effectiveHeight]);

  useEffect(() => {
    updateSize();
    const ro = new ResizeObserver(updateSize);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [updateSize]);

  const nodeSize = isMobile ? 46 : 54;
  const coordSize = isMobile ? 66 : 76;

  // Reserve enough room for node labels, status pills, hover motion and the
  // selected-agent panel. This prevents the radial graph from being clipped.
  const horizontalSafeZone = isMobile ? 76 : 104;
  const topSafeZone = isMobile ? 92 : 112;
  const bottomSafeZone = selectedAgent ? (isMobile ? 170 : 126) : (isMobile ? 112 : 128);
  const usableHeight = Math.max(180, size.h - topSafeZone - bottomSafeZone);
  const cx = size.w / 2;
  const cy = topSafeZone + usableHeight / 2;
  const maxHorizontalRadius = Math.max(72, size.w / 2 - horizontalSafeZone);
  const maxVerticalRadius = Math.max(72, usableHeight / 2 - 26);
  const radius = Math.max(72, Math.min(maxHorizontalRadius, maxVerticalRadius, isMobile ? 142 : 220));

  // Demo view models are placeholders only. Never present fabricated agents as real telemetry.
  const visibleAgents = vm.isDemo ? [] : vm.agents;
  const positions = getRadialPositions(visibleAgents.length, cx, cy, radius);

  const nodePositions: NodePosition[] = visibleAgents.map((agent, i) => ({
    x: positions[i].x,
    y: positions[i].y,
    agent,
  }));

  const hasRealTelemetry = !vm.isDemo && visibleAgents.length > 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none overflow-visible"
      style={{ height: effectiveHeight, minHeight: effectiveHeight }}
      aria-label="AI orchestration canvas"
    >
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
            <stop offset="0%" stopColor="#6366f140" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>

        <ellipse
          cx={cx}
          cy={cy}
          rx={radius * 0.7}
          ry={radius * 0.5}
          fill="url(#canvasGlow)"
          opacity={hasRealTelemetry ? 0.4 : 0.18}
        />

        {[0.4, 0.75, 1.05].map((r, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={radius * r}
            fill="none"
            stroke="rgba(255,255,255,0.04)"
            strokeWidth={1}
          />
        ))}

        {nodePositions.map((pos) => (
          <AgentConnection
            key={pos.agent.id}
            id={pos.agent.id}
            from={{ x: cx, y: cy }}
            to={{ x: pos.x, y: pos.y }}
            status={pos.agent.status}
            color={pos.agent.color}
            reducedMotion={reducedMotion}
          />
        ))}
      </svg>

      {nodePositions.map((pos) => (
        <div
          key={pos.agent.id}
          className="absolute z-10"
          style={{
            left: pos.x,
            top: pos.y,
            transform: "translate(-50%, -50%)",
          }}
        >
          <AgentNode
            agent={pos.agent}
            reducedMotion={reducedMotion}
            size={nodeSize}
            onClick={() => setSelectedAgent(selectedAgent?.id === pos.agent.id ? null : pos.agent)}
          />
        </div>
      ))}

      <div
        className="absolute z-10"
        style={{
          left: cx,
          top: cy,
          transform: "translate(-50%, -50%)",
        }}
      >
        <CoordinatorNode phase={hasRealTelemetry ? vm.phase : "idle"} reducedMotion={reducedMotion} size={coordSize} />
      </div>

      {!hasRealTelemetry && (
        <div className="absolute inset-x-6 bottom-10 text-center">
          <p className="text-sm font-medium text-white/55">No real orchestration activity yet</p>
          <p className="mt-1 text-xs text-white/30">Start a session to display actual agents, task delegation, provider usage, execution status and measured performance.</p>
        </div>
      )}

      {selectedAgent && hasRealTelemetry && (
        <div className="absolute bottom-3 left-3 right-3 z-30 rounded-xl border border-white/10 bg-[#12151f]/95 p-3 backdrop-blur-sm shadow-2xl">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="h-3 w-3 rounded-full shrink-0"
                style={{ background: selectedAgent.color, boxShadow: `0 0 6px ${selectedAgent.color}80` }}
              />
              <span className="text-sm font-semibold text-white truncate">{selectedAgent.name}</span>
              <span className="text-xs text-white/40">·</span>
              <span className="text-xs text-white/60 truncate">{selectedAgent.role}</span>
            </div>
            <button
              type="button"
              className="text-white/40 hover:text-white/80 transition-colors text-xs"
              onClick={() => setSelectedAgent(null)}
            >
              ✕
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
            <div>
              <div className="text-white/40 mb-0.5">Provider</div>
              <div className="font-medium capitalize text-white/75">{selectedAgent.provider}</div>
            </div>
            <div>
              <div className="text-white/40 mb-0.5">Status</div>
              <div className="font-medium capitalize" style={{ color: selectedAgent.color }}>{selectedAgent.status}</div>
            </div>
            {selectedAgent.cost !== undefined && (
              <div>
                <div className="text-white/40 mb-0.5">Cost</div>
                <div className="font-medium text-emerald-400">${selectedAgent.cost.toFixed(4)}</div>
              </div>
            )}
            {selectedAgent.latencyMs !== undefined && selectedAgent.latencyMs > 0 && (
              <div>
                <div className="text-white/40 mb-0.5">Latency</div>
                <div className="font-medium text-white/70">{selectedAgent.latencyMs}ms</div>
              </div>
            )}
          </div>
          {selectedAgent.taskSummary && (
            <div className="mt-2 text-[10px] text-white/60 border-t border-white/5 pt-2">
              {selectedAgent.taskSummary}
            </div>
          )}
          {selectedAgent.confidence !== undefined && (
            <div className="mt-1.5">
              <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${selectedAgent.confidence * 100}%`, background: selectedAgent.color }}
                />
              </div>
              <div className="text-[9px] text-white/30 mt-0.5">Confidence: {Math.round(selectedAgent.confidence * 100)}%</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}