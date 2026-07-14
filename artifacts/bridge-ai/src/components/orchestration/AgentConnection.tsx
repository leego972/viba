import { useEffect, useRef } from "react";
import type { AgentStatus } from "@/lib/orchestrationViewModel";

interface Point {
  x: number;
  y: number;
}

interface Props {
  from: Point;
  to: Point;
  status: AgentStatus;
  color: string;
  reducedMotion: boolean;
  id: string;
}

const STATUS_DASH: Record<AgentStatus, string> = {
  idle:      "4 8",
  queued:    "4 6",
  working:   "8 4",
  waiting:   "2 6",
  reviewing: "6 3",
  complete:  "none",
  failed:    "2 4",
  paused:    "2 8",
};

export function AgentConnection({ from, to, status, color, reducedMotion, id }: Props) {
  const pathRef = useRef<SVGPathElement>(null);

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2 - Math.sqrt(dx * dx + dy * dy) * 0.15;

  const d = `M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`;

  const isActive = status === "working" || status === "reviewing" || status === "delegating" as AgentStatus;
  const strokeColor = status === "complete" ? color + "60" : status === "idle" || status === "queued" ? color + "30" : color + "90";
  const strokeWidth = status === "complete" ? 1 : isActive ? 2 : 1.2;

  useEffect(() => {
    if (reducedMotion || !pathRef.current || !isActive) return;
    const el = pathRef.current;
    const len = el.getTotalLength?.() ?? 200;
    el.style.strokeDasharray = `${len}`;
    el.style.strokeDashoffset = `${len}`;

    const anim = el.animate(
      [{ strokeDashoffset: String(len) }, { strokeDashoffset: "0" }],
      { duration: 1800, iterations: Infinity, easing: "linear" }
    );
    return () => anim.cancel();
  }, [isActive, reducedMotion]);

  const particleId = `particle-${id}`;

  return (
    <g>
      {/* Main path */}
      <path
        ref={pathRef}
        d={d}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={isActive && !reducedMotion ? undefined : STATUS_DASH[status]}
        strokeLinecap="round"
      />

      {/* Moving task packet when active — refined dual-pulse */}
      {isActive && !reducedMotion && (
        <>
          {/* Leading packet — crisp, bright */}
          <circle r={2.5} fill={color} opacity={0.95}>
            <animateMotion dur="1.6s" repeatCount="indefinite" path={d} />
          </circle>
          {/* Trail — softer, larger, delayed */}
          <circle r={4.5} fill={color} opacity={0.18}>
            <animateMotion dur="1.6s" repeatCount="indefinite" begin="0.3s" path={d} />
          </circle>
          {/* Path glow overlay */}
          <path
            d={d}
            stroke={color}
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
            opacity={0.07}
          />
        </>
      )}

      {/* Arrowhead near target */}
      {status !== "idle" && (
        <circle cx={to.x} cy={to.y} r={2.5} fill={color} opacity={0.5} />
      )}
    </g>
  );
}
