import { useEffect, useMemo, useRef } from "react";

type Scene = "idle" | "planning" | "disconnect" | "repair" | "verify" | "complete";

type Props = {
  scene: Scene;
  activeNodeIds: string[];
  failedNodeId?: string;
  seed: number;
};

type Point = { x: number; y: number; z: number; group: number };

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function CinematicNeuralCanvas({ scene, activeNodeIds, failedNodeId, seed }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    const random = mulberry32(seed || 17);
    const quality = window.innerWidth < 700 ? 0.55 : window.devicePixelRatio > 1.5 ? 0.78 : 1;
    const count = Math.floor(260 * quality);
    const points: Point[] = Array.from({ length: count }, (_, index) => {
      const angle = random() * Math.PI * 2;
      const radius = Math.pow(random(), 0.56);
      const hemisphere = index % 2 === 0 ? -1 : 1;
      return {
        x: Math.cos(angle) * radius * 0.72 + hemisphere * 0.08,
        y: Math.sin(angle) * radius * (0.72 - Math.abs(Math.cos(angle)) * 0.14),
        z: random() * 2 - 1,
        group: index % 8,
      };
    });

    let frame = 0;
    let animationFrame = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      frame += reducedMotion ? 0 : 0.012;
      context.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      const scale = Math.min(width, height) * 0.31;
      const intensity = scene === "idle" ? 0.5 : scene === "complete" ? 1.25 : 1;
      const pulse = 1 + Math.sin(frame * 2.1) * 0.025 * intensity;
      const projected = points.map((point) => {
        const rotation = frame * 0.18;
        const x = point.x * Math.cos(rotation) - point.z * Math.sin(rotation) * 0.2;
        const z = point.x * Math.sin(rotation) * 0.2 + point.z * Math.cos(rotation);
        return {
          x: cx + x * scale * pulse,
          y: cy + point.y * scale * pulse + Math.sin(frame + point.group) * 1.5,
          z,
          group: point.group,
        };
      });

      context.globalCompositeOperation = "lighter";
      for (let index = 0; index < projected.length; index += 1) {
        const point = projected[index];
        for (let offset = 1; offset <= 3; offset += 1) {
          const other = projected[(index + offset * 13) % projected.length];
          const distance = Math.hypot(point.x - other.x, point.y - other.y);
          if (distance > scale * 0.42) continue;
          const alpha = Math.max(0, 1 - distance / (scale * 0.42)) * 0.13 * intensity;
          context.strokeStyle = scene === "disconnect" && point.group === 3
            ? `rgba(255,76,115,${alpha * 2.5})`
            : scene === "repair" && point.group === 3
              ? `rgba(63,255,193,${alpha * 2.3})`
              : `rgba(91,211,255,${alpha})`;
          context.lineWidth = 0.7;
          context.beginPath();
          context.moveTo(point.x, point.y);
          context.lineTo(other.x, other.y);
          context.stroke();
        }
      }

      projected.forEach((point, index) => {
        const wave = (frame * 1.7 + index * 0.071) % 6.28;
        const active = activeNodeIds.length > 0 && activeNodeIds.includes(String(point.group));
        const radius = (1.05 + (point.z + 1) * 0.7) * (active ? 1.7 : 1);
        const alpha = (0.3 + (point.z + 1) * 0.2 + Math.max(0, Math.sin(wave)) * 0.38) * intensity;
        context.fillStyle = scene === "disconnect" && point.group === 3
          ? `rgba(255,76,115,${alpha})`
          : scene === "repair" && point.group === 3
            ? `rgba(63,255,193,${alpha})`
            : `rgba(${active ? "197,122,255" : "100,225,255"},${alpha})`;
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();
      });

      const halo = context.createRadialGradient(cx, cy, scale * 0.08, cx, cy, scale * 0.95);
      halo.addColorStop(0, scene === "complete" ? "rgba(128,255,220,.26)" : "rgba(111,221,255,.2)");
      halo.addColorStop(0.45, "rgba(108,91,255,.08)");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = halo;
      context.beginPath();
      context.arc(cx, cy, scale, 0, Math.PI * 2);
      context.fill();
      context.globalCompositeOperation = "source-over";

      if (!reducedMotion) animationFrame = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
    };
  }, [activeNodeIds, failedNodeId, reducedMotion, scene, seed]);

  return <canvas ref={canvasRef} className="viba-neural-canvas" aria-hidden="true" />;
}
