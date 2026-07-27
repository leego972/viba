import { useEffect, useRef } from "react";

type Scene = "idle" | "planning" | "disconnect" | "repair" | "verify" | "complete";

type Props = {
  scene: Scene;
  affectedNode: string;
};

type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  phase: number;
  side: -1 | 1;
};

const NODE_POSITIONS: Record<string, [number, number]> = {
  strategy: [0.13, 0.24],
  research: [0.16, 0.72],
  code: [0.82, 0.2],
  browser: [0.88, 0.52],
  deploy: [0.77, 0.82],
  verify: [0.45, 0.91],
};

function buildParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, index) => {
    const t = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random());
    const side = index % 2 === 0 ? -1 : 1;
    const lobeOffset = side * 0.16;
    return {
      x: 0.5 + lobeOffset + Math.cos(t) * r * 0.2,
      y: 0.48 + Math.sin(t) * r * 0.25,
      z: Math.random(),
      vx: (Math.random() - 0.5) * 0.0006,
      vy: (Math.random() - 0.5) * 0.0006,
      phase: Math.random() * Math.PI * 2,
      side,
    };
  });
}

export default function CinematicNeuralCanvas({ scene, affectedNode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef(scene);
  const affectedRef = useRef(affectedNode);

  useEffect(() => { sceneRef.current = scene; }, [scene]);
  useEffect(() => { affectedRef.current = affectedNode; }, [affectedNode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const particles = buildParticles(coarse ? 150 : 300);
    let width = 1;
    let height = 1;
    let frame = 0;
    let animationFrame = 0;
    let last = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, coarse ? 1.4 : 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (now: number) => {
      const delta = Math.min(32, now - last);
      last = now;
      frame += reducedMotion ? 0 : delta * 0.001;
      context.clearRect(0, 0, width, height);

      const activeScene = sceneRef.current;
      const intensity = activeScene === "idle" ? 0.38 : activeScene === "complete" ? 1.15 : 0.82;
      const breathing = reducedMotion ? 1 : 1 + Math.sin(frame * 1.35) * 0.035;
      const cx = width * 0.5;
      const cy = height * 0.49;

      const halo = context.createRadialGradient(cx, cy, 4, cx, cy, Math.min(width, height) * 0.32);
      halo.addColorStop(0, `rgba(107,235,255,${0.12 * intensity})`);
      halo.addColorStop(0.4, `rgba(112,91,255,${0.08 * intensity})`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = halo;
      context.fillRect(0, 0, width, height);

      for (const particle of particles) {
        if (!reducedMotion) {
          particle.x += particle.vx * delta;
          particle.y += particle.vy * delta;
          const dx = particle.x - (0.5 + particle.side * 0.16);
          const dy = particle.y - 0.48;
          if ((dx * dx) / 0.045 + (dy * dy) / 0.07 > 1) {
            particle.vx *= -1;
            particle.vy *= -1;
          }
        }
      }

      for (let i = 0; i < particles.length; i += 1) {
        const a = particles[i];
        const ax = cx + (a.x - 0.5) * width * breathing;
        const ay = cy + (a.y - 0.5) * height * breathing;
        for (let j = i + 1; j < Math.min(particles.length, i + 13); j += 1) {
          const b = particles[j];
          if (a.side !== b.side && Math.abs(a.y - b.y) > 0.08) continue;
          const bx = cx + (b.x - 0.5) * width * breathing;
          const by = cy + (b.y - 0.5) * height * breathing;
          const distance = Math.hypot(ax - bx, ay - by);
          const limit = Math.min(width, height) * 0.085;
          if (distance > limit) continue;
          const alpha = (1 - distance / limit) * 0.17 * intensity;
          context.strokeStyle = `rgba(${a.side < 0 ? "87,228,255" : "175,104,255"},${alpha})`;
          context.lineWidth = 0.55 + a.z * 0.5;
          context.beginPath();
          context.moveTo(ax, ay);
          context.lineTo(bx, by);
          context.stroke();
        }
      }

      for (const particle of particles) {
        const x = cx + (particle.x - 0.5) * width * breathing;
        const y = cy + (particle.y - 0.5) * height * breathing;
        const pulse = reducedMotion ? 0.6 : 0.45 + Math.sin(frame * 2.3 + particle.phase) * 0.3;
        const radius = 0.5 + particle.z * 1.5 + (activeScene === "complete" ? 0.55 : 0);
        context.fillStyle = particle.side < 0
          ? `rgba(96,231,255,${Math.max(0.12, pulse) * intensity})`
          : `rgba(194,101,255,${Math.max(0.12, pulse) * intensity})`;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }

      const target = NODE_POSITIONS[affectedRef.current] ?? NODE_POSITIONS.browser;
      if (activeScene === "disconnect" || activeScene === "repair") {
        const tx = width * target[0];
        const ty = height * target[1];
        const repaired = activeScene === "repair";
        context.strokeStyle = repaired ? "rgba(63,255,193,.78)" : "rgba(255,93,122,.82)";
        context.lineWidth = repaired ? 2 : 1.5;
        context.setLineDash(repaired ? [7, 8] : [3, 10]);
        context.lineDashOffset = reducedMotion ? 0 : -frame * 28;
        context.beginPath();
        context.moveTo(cx, cy);
        context.quadraticCurveTo(cx + (tx - cx) * 0.5, cy + (repaired ? 65 : -28), tx, ty);
        context.stroke();
        context.setLineDash([]);
      }

      if (activeScene === "planning" || activeScene === "verify" || activeScene === "complete") {
        const paths = Object.values(NODE_POSITIONS);
        paths.forEach(([nx, ny], index) => {
          const progress = reducedMotion ? 0.65 : (frame * (0.2 + index * 0.015) + index * 0.13) % 1;
          const x = cx + (width * nx - cx) * progress;
          const y = cy + (height * ny - cy) * progress;
          context.fillStyle = activeScene === "complete" ? "rgba(255,255,255,.95)" : "rgba(94,231,255,.92)";
          context.shadowColor = activeScene === "complete" ? "#ffffff" : "#55e7ff";
          context.shadowBlur = 13;
          context.beginPath();
          context.arc(x, y, 2.2, 0, Math.PI * 2);
          context.fill();
          context.shadowBlur = 0;
        });
      }

      animationFrame = window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    animationFrame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="viba-neural-canvas" aria-hidden="true" />;
}
