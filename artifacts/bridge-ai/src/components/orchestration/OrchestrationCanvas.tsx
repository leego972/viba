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
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });
}

export function OrchestrationCanvas({ vm, height = 340 }: Props) {
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<CanvasSize>({ w: 600, h: height });
  const [selectedAgent, setSelectedAgent] = useState<OrchestrationAgent | null>(null);

  const updateSize = useCallback(() => {
    if (containerRef.current) {
      setSize({ w: containerRef.current.offsetWidth, h: height });
    }
  }, [height]);

  useEffect(() => {
    updateSize();
    const ro = new ResizeObserver(updateSize);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [updateSize]);

  const cx = size.w / 2;
  const cy = size.h / 2;
  const nodeSize = 52;
  const coordSize = 72;

  const radius = Math.min(cx - 80, cy - 60, 180);
  const positions = getRadialPositions(vm.agents.length, cx, cy, radius);

  const nodePositions: NodePosition[] = vm.agents.map((agent, i) => ({
    x: positions[i].x,
    y: positions[i].y,
    agent,
  }));

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none"
      style={{ height }}
      aria-label="AI orchestration canvas"
    >
      {/* SVG layer for connections */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={size.w}
        height={size.h}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="canvasGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#6366f140" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>

        {/* Background glow at center */}
        <ellipse
          cx={cx}
          cy={cy}
          rx={radius * 0.7}
          ry={radius * 0.5}
          fill="url(#canvasGlow)"
          opacity={0.4}
        />

        {/* Grid rings */}
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

        {/* Connections */}
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

      {/* Agent nodes */}
      {nodePositions.map((pos) => (
        <div
          key={pos.agent.id}
          className="absolute"
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

      {/* VIBA coordinator node */}
      <div
        className="absolute"
        style={{
          left: cx,
          top: cy,
          transform: "translate(-50%, -50%)",
        }}
      >
        <CoordinatorNode phase={vm.phase} reducedMotion={reducedMotion} size={coordSize} />
      </div>

      {/* Agent inspector panel */}
      {selectedAgent && (
        <div className="absolute bottom-2 left-2 right-2 z-20 rounded-xl border border-white/10 bg-[#12151f]/95 p-3 backdrop-blur-sm shadow-2xl">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-full shrink-0"
                style={{ background: selectedAgent.color, boxShadow: `0 0 6px ${selectedAgent.color}80` }}
              />
              <span className="text-sm font-semibold text-white">{selectedAgent.name}</span>
              <span className="text-xs text-white/40">·</span>
              <span className="text-xs text-white/60">{selectedAgent.role}</span>
            </div>
            <button
              type="button"
              className="text-white/40 hover:text-white/80 transition-colors text-xs"
              onClick={() => setSelectedAgent(null)}
            >
              ✕
            </button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
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

      {/* Demo watermark */}
      {vm.isDemo && (
        <div className="absolute top-2 right-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-amber-400">
          Demo
        </div>
      )}
    </div>
  );
}
