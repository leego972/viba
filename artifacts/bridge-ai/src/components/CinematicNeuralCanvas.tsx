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

type Spark = {
  from: number;
  to: number;
  startedAt: number;
  duration: number;
};

const NODE_POSITIONS: Record<string, [number, number]> = {
  strategy: [0.13, 0.24],
  research: [0.16, 0.72],
  code: [0.82, 0.2],
  browser: [0.88, 0.52],
  deploy: [0.77, 0.82],
  verify: [0.45, 0.91],
};

const SCENE_COLOURS: Record<Scene, { primary: string; secondary: string; glow: string }> = {
  idle: { primary: "81,220,255", secondary: "94,112,255", glow: "#51dcff" },
  planning: { primary: "104,225,255", secondary: "126,205,255", glow: "#68e1ff" },
  disconnect: { primary: "255,72,104", secondary: "255,126,141", glow: "#ff4868" },
  repair: { primary: "156,83,255", secondary: "210,91,255", glow: "#9c53ff" },
  verify: { primary: "38,100,255", secondary: "64,159,255", glow: "#2664ff" },
  complete: { primary: "54,255,173", secondary: "112,255,208", glow: "#36ffad" },
};

function buildParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, index) => {
    const t = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random());
    const side = index % 2 === 0 ? -1 : 1;
    return {
      x: 0.5 + side * 0.145 + Math.cos(t) * r * 0.185,
      y: 0.49 + Math.sin(t) * r * 0.235,
      z: Math.random(),
      vx: (Math.random() - 0.5) * 0.00042,
      vy: (Math.random() - 0.5) * 0.00042,
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
    const particles = buildParticles(coarse ? 180 : 360);
    const sparks: Spark[] = [];
    let width = 1;
    let height = 1;
    let elapsed = 0;
    let animationFrame = 0;
    let last = performance.now();
    let lastSpark = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, coarse ? 1.4 : 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const point = (particle: Particle, cx: number, cy: number, scale: number) => ({
      x: cx + (particle.x - 0.5) * width * scale,
      y: cy + (particle.y - 0.5) * height * scale,
    });

    const draw = (now: number) => {
      const delta = Math.min(32, now - last);
      last = now;
      elapsed += reducedMotion ? 0 : delta * 0.001;
      context.clearRect(0, 0, width, height);

      const activeScene = sceneRef.current;
      const colour = SCENE_COLOURS[activeScene];
      const pulseSpeed = activeScene === "repair" ? 2.6 : activeScene === "disconnect" ? 4.4 : activeScene === "complete" ? 1.7 : 1.25;
      const pulseDepth = activeScene === "disconnect" ? 0.08 : activeScene === "complete" ? 0.055 : 0.04;
      const breathing = reducedMotion ? 1 : 1 + Math.sin(elapsed * pulseSpeed) * pulseDepth;
      const intensity = activeScene === "idle" ? 0.6 : activeScene === "complete" ? 1.25 : 0.95;
      const cx = width * 0.5;
      const cy = height * 0.48;

      const halo = context.createRadialGradient(cx, cy, 8, cx, cy, Math.min(width, height) * 0.42);
      halo.addColorStop(0, `rgba(${colour.primary},${0.24 * intensity})`);
      halo.addColorStop(0.42, `rgba(${colour.secondary},${0.12 * intensity})`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = halo;
      context.fillRect(0, 0, width, height);

      context.save();
      context.globalCompositeOperation = "lighter";

      for (const particle of particles) {
        if (!reducedMotion) {
          particle.x += particle.vx * delta;
          particle.y += particle.vy * delta;
          const dx = particle.x - (0.5 + particle.side * 0.145);
          const dy = particle.y - 0.49;
          if ((dx * dx) / 0.039 + (dy * dy) / 0.061 > 1) {
            particle.vx *= -1;
            particle.vy *= -1;
          }
        }
      }

      const linkLimit = Math.min(width, height) * 0.092;
      for (let i = 0; i < particles.length; i += 1) {
        const a = particles[i];
        const ap = point(a, cx, cy, breathing);
        for (let j = i + 1; j < Math.min(particles.length, i + 16); j += 1) {
          const b = particles[j];
          if (a.side !== b.side && Math.abs(a.y - b.y) > 0.055) continue;
          const bp = point(b, cx, cy, breathing);
          const distance = Math.hypot(ap.x - bp.x, ap.y - bp.y);
          if (distance > linkLimit) continue;
          const alpha = (1 - distance / linkLimit) * 0.23 * intensity;
          context.strokeStyle = `rgba(${colour.primary},${alpha})`;
          context.lineWidth = 0.45 + a.z * 0.65;
          context.beginPath();
          context.moveTo(ap.x, ap.y);
          context.lineTo(bp.x, bp.y);
          context.stroke();
        }
      }

      if (!reducedMotion && now - lastSpark > (activeScene === "disconnect" ? 140 : activeScene === "repair" ? 220 : 420)) {
        const from = Math.floor(Math.random() * particles.length);
        let to = Math.floor(Math.random() * particles.length);
        if (to === from) to = (to + 1) % particles.length;
        sparks.push({ from, to, startedAt: now, duration: 260 + Math.random() * 420 });
        lastSpark = now;
      }

      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const spark = sparks[i];
        const progress = (now - spark.startedAt) / spark.duration;
        if (progress >= 1) {
          sparks.splice(i, 1);
          continue;
        }
        const start = point(particles[spark.from], cx, cy, breathing);
        const end = point(particles[spark.to], cx, cy, breathing);
        const head = Math.min(1, progress * 1.8);
        const tail = Math.max(0, head - 0.28);
        const sx = start.x + (end.x - start.x) * tail;
        const sy = start.y + (end.y - start.y) * tail;
        const ex = start.x + (end.x - start.x) * head;
        const ey = start.y + (end.y - start.y) * head;
        context.strokeStyle = `rgba(${colour.secondary},${1 - progress})`;
        context.shadowColor = colour.glow;
        context.shadowBlur = activeScene === "disconnect" ? 18 : 11;
        context.lineWidth = activeScene === "disconnect" ? 2.1 : 1.25;
        context.beginPath();
        context.moveTo(sx, sy);
        context.lineTo(ex, ey);
        context.stroke();
        context.shadowBlur = 0;
      }

      for (const particle of particles) {
        const p = point(particle, cx, cy, breathing);
        const pulse = reducedMotion ? 0.7 : 0.52 + Math.sin(elapsed * 2.5 + particle.phase) * 0.38;
        const radius = 0.7 + particle.z * 1.75 + (activeScene === "complete" ? 0.55 : 0);
        context.fillStyle = `rgba(${particle.side < 0 ? colour.primary : colour.secondary},${Math.max(0.13, pulse) * intensity})`;
        context.shadowColor = colour.glow;
        context.shadowBlur = particle.z > 0.82 ? 9 : 0;
        context.beginPath();
        context.arc(p.x, p.y, radius, 0, Math.PI * 2);
        context.fill();
      }
      context.shadowBlur = 0;

      const centreLine = context.createLinearGradient(cx, cy - height * 0.23, cx, cy + height * 0.22);
      centreLine.addColorStop(0, "rgba(255,255,255,0)");
      centreLine.addColorStop(0.45, `rgba(${colour.primary},.75)`);
      centreLine.addColorStop(1, "rgba(255,255,255,0)");
      context.strokeStyle = centreLine;
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(cx, cy - height * 0.23);
      context.bezierCurveTo(cx - 4, cy - height * 0.08, cx + 4, cy + height * 0.08, cx, cy + height * 0.22);
      context.stroke();

      const target = NODE_POSITIONS[affectedRef.current] ?? NODE_POSITIONS.browser;
      const showConnections = activeScene !== "idle";
      if (showConnections) {
        Object.values(NODE_POSITIONS).forEach(([nx, ny], index) => {
          const progress = reducedMotion ? 0.72 : (elapsed * (0.23 + index * 0.02) + index * 0.17) % 1;
          const tx = width * nx;
          const ty = height * ny;
          const x = cx + (tx - cx) * progress;
          const y = cy + (ty - cy) * progress;
          context.strokeStyle = `rgba(${colour.primary},.2)`;
          context.lineWidth = 0.8;
          context.beginPath();
          context.moveTo(cx, cy);
          context.quadraticCurveTo(cx + (tx - cx) * 0.48, cy + Math.sin(index) * 42, tx, ty);
          context.stroke();
          context.fillStyle = activeScene === "complete" ? "rgba(220,255,240,.98)" : `rgba(${colour.secondary},.95)`;
          context.shadowColor = colour.glow;
          context.shadowBlur = 14;
          context.beginPath();
          context.arc(x, y, 2.3, 0, Math.PI * 2);
          context.fill();
          context.shadowBlur = 0;
        });
      }

      if (activeScene === "disconnect" || activeScene === "repair") {
        const tx = width * target[0];
        const ty = height * target[1];
        context.strokeStyle = activeScene === "repair" ? "rgba(176,96,255,.94)" : "rgba(255,72,104,.95)";
        context.lineWidth = activeScene === "disconnect" ? 2.4 : 2;
        context.setLineDash(activeScene === "repair" ? [8, 7] : [3, 9]);
        context.lineDashOffset = reducedMotion ? 0 : -elapsed * 34;
        context.beginPath();
        context.moveTo(cx, cy);
        context.quadraticCurveTo(cx + (tx - cx) * 0.5, cy - 34, tx, ty);
        context.stroke();
        context.setLineDash([]);
      }

      context.restore();
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
