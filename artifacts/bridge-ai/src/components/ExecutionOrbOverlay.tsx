import { useEffect, useRef } from "react";

type ExecutionPhase = "idle" | "planning" | "working" | "verifying" | "complete" | "failed";

type Props = {
  phase?: ExecutionPhase;
  activeNodes?: string[];
};

type Point = { x: number; y: number };

type Pulse = {
  nodeId: string;
  startedAt: number;
  duration: number;
  direction: "outbound" | "return";
  hue: number;
};

const NODE_POINTS: Record<string, Point> = {
  strategy: { x: 0.15, y: 0.24 },
  research: { x: 0.18, y: 0.73 },
  code: { x: 0.82, y: 0.21 },
  browser: { x: 0.88, y: 0.52 },
  deploy: { x: 0.77, y: 0.82 },
  verify: { x: 0.47, y: 0.9 },
};

const ALL_NODES = Object.keys(NODE_POINTS);

function phaseNodes(phase: ExecutionPhase): string[] {
  switch (phase) {
    case "planning": return ["strategy", "research"];
    case "working": return ["code", "browser", "deploy"];
    case "verifying": return ["verify", "research"];
    case "complete": return ALL_NODES;
    case "failed": return ["browser"];
    default: return [];
  }
}

function cubicPoint(a: Point, b: Point, t: number): Point {
  const cx = 0.5 + (b.x - 0.5) * 0.25;
  const cy = 0.5 + (b.y - 0.5) * 0.1;
  const inv = 1 - t;
  return {
    x: inv * inv * 0.5 + 2 * inv * t * cx + t * t * b.x,
    y: inv * inv * 0.5 + 2 * inv * t * cy + t * t * b.y,
  };
}

function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color.replace("ALPHA", String(alpha)));
  gradient.addColorStop(0.45, color.replace("ALPHA", String(alpha * 0.35)));
  gradient.addColorStop(1, color.replace("ALPHA", "0"));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

export default function ExecutionOrbOverlay({ phase = "idle", activeNodes }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<ExecutionPhase>(phase);
  const explicitNodesRef = useRef<string[] | undefined>(activeNodes);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { explicitNodesRef.current = activeNodes; }, [activeNodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;

    let width = 1;
    let height = 1;
    let frame = 0;
    let last = performance.now();
    let nextPulseAt = last + 350;
    let pulseIndex = 0;
    const pulses: Pulse[] = [];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const createPulse = (now: number, nodeId: string, direction: "outbound" | "return") => {
      pulses.push({
        nodeId,
        startedAt: now,
        duration: direction === "outbound" ? 1050 : 900,
        direction,
        hue: direction === "outbound" ? 188 : 276,
      });
    };

    const onExecutionEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ phase?: ExecutionPhase; activeNodes?: string[] }>).detail;
      if (detail?.phase) phaseRef.current = detail.phase;
      if (detail?.activeNodes) explicitNodesRef.current = detail.activeNodes;
    };

    window.addEventListener("viba:execution", onExecutionEvent as EventListener);

    const draw = (now: number) => {
      const delta = Math.min(48, now - last);
      last = now;
      ctx.clearRect(0, 0, width, height);

      const cx = width * 0.5;
      const cy = height * 0.5;
      const minSide = Math.min(width, height);
      const phase = phaseRef.current;
      const nodes = explicitNodesRef.current?.length ? explicitNodesRef.current : phaseNodes(phase);

      if (!reducedMotion && now >= nextPulseAt) {
        const candidates = nodes.length ? nodes : ALL_NODES;
        const nodeId = candidates[pulseIndex % candidates.length] ?? "strategy";
        createPulse(now, nodeId, "outbound");
        window.setTimeout(() => createPulse(performance.now(), nodeId, "return"), 720);
        pulseIndex += 1;
        nextPulseAt = now + (nodes.length ? 620 : 1900);
      }

      const breathe = reducedMotion ? 1 : 1 + Math.sin(now / 900) * 0.035;
      const orbRadius = minSide * 0.018 * breathe;
      const haloRadius = minSide * 0.085;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      drawGlow(ctx, cx, cy, haloRadius, "rgba(230,242,255,ALPHA)", phase === "complete" ? 0.32 : 0.2);
      drawGlow(ctx, cx - orbRadius * 0.2, cy - orbRadius * 0.2, orbRadius * 2.1, "rgba(255,255,248,ALPHA)", 0.95);

      const pearl = ctx.createRadialGradient(cx - orbRadius * 0.35, cy - orbRadius * 0.4, orbRadius * 0.1, cx, cy, orbRadius * 1.45);
      pearl.addColorStop(0, "rgba(255,255,255,1)");
      pearl.addColorStop(0.34, "rgba(244,248,255,0.98)");
      pearl.addColorStop(0.72, "rgba(207,220,238,0.94)");
      pearl.addColorStop(1, "rgba(126,105,182,0.55)");
      ctx.fillStyle = pearl;
      ctx.beginPath();
      ctx.arc(cx, cy, orbRadius, 0, Math.PI * 2);
      ctx.fill();

      for (const [nodeId, point] of Object.entries(NODE_POINTS)) {
        const active = nodes.includes(nodeId);
        if (!active) continue;
        drawGlow(ctx, point.x * width, point.y * height, minSide * 0.035, "rgba(83,231,255,ALPHA)", 0.16);
      }

      for (let i = pulses.length - 1; i >= 0; i -= 1) {
        const pulse = pulses[i];
        const node = NODE_POINTS[pulse.nodeId];
        if (!node) {
          pulses.splice(i, 1);
          continue;
        }
        const raw = (now - pulse.startedAt) / pulse.duration;
        if (raw >= 1) {
          pulses.splice(i, 1);
          continue;
        }
        if (raw < 0) continue;

        const eased = 1 - Math.pow(1 - raw, 3);
        const t = pulse.direction === "outbound" ? eased : 1 - eased;
        const p = cubicPoint({ x: 0.5, y: 0.5 }, node, t);
        const x = p.x * width;
        const y = p.y * height;
        const alpha = Math.sin(Math.PI * raw);

        ctx.strokeStyle = `hsla(${pulse.hue}, 95%, 72%, ${0.18 * alpha})`;
        ctx.lineWidth = Math.max(0.8, minSide * 0.0015);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        const controlX = (cx + node.x * width) / 2 + (node.y - 0.5) * width * 0.08;
        const controlY = (cy + node.y * height) / 2 - (node.x - 0.5) * height * 0.08;
        ctx.quadraticCurveTo(controlX, controlY, node.x * width, node.y * height);
        ctx.stroke();

        drawGlow(ctx, x, y, minSide * 0.018, `hsla(${pulse.hue},95%,72%,ALPHA)`, 0.62 * alpha);
        ctx.fillStyle = `hsla(${pulse.hue}, 100%, 88%, ${0.95 * alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.5, minSide * 0.0035), 0, Math.PI * 2);
        ctx.fill();
      }

      if (phase === "complete") {
        const ring = ((now / 1300) % 1) * minSide * 0.12;
        ctx.strokeStyle = `rgba(124,255,216,${0.24 * (1 - ring / (minSide * 0.12))})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, orbRadius + ring, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
      frame = window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    frame = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("viba:execution", onExecutionEvent as EventListener);
    };
  }, []);

  return <canvas ref={canvasRef} className="viba-execution-orb-overlay" aria-hidden="true" />;
}
