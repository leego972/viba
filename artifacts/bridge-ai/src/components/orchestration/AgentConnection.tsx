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
  highlighted?: boolean;
}

const STATUS_DASH: Record<AgentStatus, string> = {
  idle:      "3 9",
  queued:    "4 7",
  working:   "9 5",
  waiting:   "2 7",
  reviewing: "7 4",
  complete:  "none",
  failed:    "2 5",
  paused:    "2 9",
};

export function AgentConnection({
  from,
  to,
  status,
  color,
  reducedMotion,
  id,
  highlighted = false,
}: Props) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const bendDirection = id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 2 === 0 ? 1 : -1;
  const mx = (from.x + to.x) / 2 + (-dy / Math.max(distance, 1)) * distance * 0.11 * bendDirection;
  const my = (from.y + to.y) / 2 + (dx / Math.max(distance, 1)) * distance * 0.11 * bendDirection;
  const d = `M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`;

  const isActive = status === "working" || status === "reviewing";
  const isComplete = status === "complete";
  const isFailed = status === "failed";
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "-");
  const gradientId = `agent-flow-${safeId}`;
  const glowId = `agent-glow-${safeId}`;
  const strokeOpacity = isComplete ? 0.34 : isActive ? 0.84 : status === "queued" ? 0.34 : 0.22;
  const packetDuration = status === "reviewing" ? 1.95 : 1.45;

  return (
    <g>
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={from.x} y1={from.y} x2={to.x} y2={to.y}>
          <stop offset="0%" stopColor={color} stopOpacity={0.16} />
          <stop offset="45%" stopColor={color} stopOpacity={isActive ? 0.86 : 0.36} />
          <stop offset="100%" stopColor={color} stopOpacity={isActive ? 0.65 : 0.22} />
        </linearGradient>
        <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation={highlighted ? 3.2 : 2.1} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path
        d={d}
        stroke="rgba(255,255,255,0.035)"
        strokeWidth={1}
        fill="none"
        strokeLinecap="round"
      />

      <path
        d={d}
        stroke={`url(#${gradientId})`}
        strokeWidth={highlighted ? 2.4 : isActive ? 1.8 : 1.1}
        fill="none"
        strokeDasharray={isActive && !reducedMotion ? "10 7" : STATUS_DASH[status]}
        strokeLinecap="round"
        opacity={strokeOpacity}
        filter={isActive || highlighted ? `url(#${glowId})` : undefined}
      >
        {isActive && !reducedMotion && (
          <animate attributeName="stroke-dashoffset" from="34" to="0" dur="1.15s" repeatCount="indefinite" />
        )}
      </path>

      {isActive && !reducedMotion && (
        <>
          <circle r={highlighted ? 3.2 : 2.45} fill={color} opacity={0.98} filter={`url(#${glowId})`}>
            <animateMotion dur={`${packetDuration}s`} repeatCount="indefinite" path={d} />
          </circle>
          <circle r={highlighted ? 6 : 4.6} fill={color} opacity={0.12}>
            <animateMotion dur={`${packetDuration}s`} repeatCount="indefinite" begin="-0.14s" path={d} />
          </circle>
          {highlighted && (
            <circle r={1.8} fill="#ffffff" opacity={0.9}>
              <animateMotion dur={`${packetDuration}s`} repeatCount="indefinite" begin="-0.48s" path={d} />
            </circle>
          )}
        </>
      )}

      {isComplete && !reducedMotion && (
        <circle cx={to.x} cy={to.y} r={3} fill={color} opacity={0.75}>
          <animate attributeName="r" values="2.5;4;2.5" dur="2.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.45;0.85;0.45" dur="2.8s" repeatCount="indefinite" />
        </circle>
      )}

      {!isComplete && status !== "idle" && (
        <circle
          cx={to.x}
          cy={to.y}
          r={isFailed ? 3 : 2.5}
          fill={isFailed ? "#ef4444" : color}
          opacity={isActive ? 0.85 : 0.45}
          filter={isActive ? `url(#${glowId})` : undefined}
        />
      )}
    </g>
  );
}
