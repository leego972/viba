import { useEffect, useRef } from "react";

type Scene = "idle" | "planning" | "disconnect" | "repair" | "verify" | "complete";
type Props = { scene: Scene; affectedNode: string };
type Filament = { side: -1 | 1; lane: number; phase: number; depth: number; speed: number; drift: number };
type RGB = [number, number, number];

const NODE_POSITIONS: Record<string, [number, number]> = {
  strategy: [0.13, 0.24], research: [0.16, 0.72], code: [0.82, 0.2],
  browser: [0.88, 0.52], deploy: [0.77, 0.82], verify: [0.45, 0.91],
};

const PALETTE: Record<Scene, { a: RGB; b: RGB; speed: number; opacity: number }> = {
  idle: { a: [65, 177, 211], b: [82, 86, 185], speed: 0.34, opacity: 0.42 },
  planning: { a: [70, 190, 218], b: [91, 111, 198], speed: 0.42, opacity: 0.52 },
  disconnect: { a: [190, 72, 94], b: [151, 78, 173], speed: 0.54, opacity: 0.56 },
  repair: { a: [103, 91, 192], b: [157, 80, 184], speed: 0.48, opacity: 0.58 },
  verify: { a: [58, 117, 193], b: [68, 164, 199], speed: 0.4, opacity: 0.56 },
  complete: { a: [60, 184, 142], b: [70, 166, 169], speed: 0.36, opacity: 0.58 },
};

function buildFilaments(count: number): Filament[] {
  const perSide = Math.ceil(count / 2);
  return Array.from({ length: count }, (_, index) => ({
    side: index % 2 === 0 ? -1 : 1,
    lane: (index % perSide) / Math.max(1, perSide - 1),
    phase: Math.random() * Math.PI * 2,
    depth: 0.3 + Math.random() * 0.7,
    speed: 0.18 + Math.random() * 0.22,
    drift: 0.35 + Math.random() * 0.55,
  }));
}

function mix(a: RGB, b: RGB, amount: number): RGB {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
}

function rgb(value: RGB): string {
  return `${Math.round(value[0])},${Math.round(value[1])},${Math.round(value[2])}`;
}

export default function CinematicNeuralCanvas({ scene, affectedNode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef(scene);
  const affectedRef = useRef(affectedNode);

  useEffect(() => { sceneRef.current = scene; }, [scene]);
  useEffect(() => { affectedRef.current = affectedNode; }, [affectedNode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const filaments = buildFilaments(coarsePointer ? 42 : 72);

    let width = 1;
    let height = 1;
    let elapsed = 0;
    let last = performance.now();
    let frame = 0;
    let currentA: RGB = [...PALETTE[sceneRef.current].a];
    let currentB: RGB = [...PALETTE[sceneRef.current].b];
    let currentSpeed = PALETTE[sceneRef.current].speed;
    let currentOpacity = PALETTE[sceneRef.current].opacity;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, coarsePointer ? 1.35 : 1.8);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const brainPoint = (filament: Filament, time: number, breathe: number, offset = 0) => {
      const cx = width * 0.5;
      const cy = height * 0.49;
      const lane = Math.min(1, Math.max(0, filament.lane + offset));
      const yBase = cy + (lane - 0.5) * height * 0.41;
      const crown = Math.sin(lane * Math.PI);
      const reach = width * (0.07 + crown * 0.13);
      const tide = Math.sin(time * 0.28 * filament.drift + filament.phase);
      const counterTide = Math.cos(time * 0.19 + filament.phase * 0.6);
      return {
        x: cx + filament.side * reach * breathe + tide * width * 0.009,
        y: yBase + counterTide * height * 0.012,
      };
    };

    const draw = (now: number) => {
      const delta = Math.min(34, now - last);
      last = now;
      elapsed += reducedMotion ? 0 : delta / 1000;
      context.clearRect(0, 0, width, height);

      const target = PALETTE[sceneRef.current];
      const colourEase = 1 - Math.exp(-delta / 1400);
      currentA = mix(currentA, target.a, colourEase);
      currentB = mix(currentB, target.b, colourEase);
      currentSpeed += (target.speed - currentSpeed) * colourEase;
      currentOpacity += (target.opacity - currentOpacity) * colourEase;

      const a = rgb(currentA);
      const b = rgb(currentB);
      const cx = width * 0.5;
      const cy = height * 0.49;
      const breathWave = Math.sin(elapsed * currentSpeed) * 0.72 + Math.sin(elapsed * currentSpeed * 0.47 + 1.1) * 0.28;
      const breathe = reducedMotion ? 1 : 1 + breathWave * 0.032;

      const haloRadius = Math.min(width, height) * (0.31 + breathWave * 0.006);
      const halo = context.createRadialGradient(cx, cy, 0, cx, cy, haloRadius);
      halo.addColorStop(0, `rgba(${a},0.095)`);
      halo.addColorStop(0.52, `rgba(${b},0.045)`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = halo;
      context.fillRect(0, 0, width, height);

      context.save();
      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";

      for (const filament of filaments) {
        const start = brainPoint(filament, elapsed, breathe);
        const end = brainPoint(filament, elapsed + 1.4, breathe, 0.09 + filament.depth * 0.035);
        const centrePull = width * (0.025 + filament.depth * 0.036);
        const sway = Math.sin(elapsed * 0.24 + filament.phase) * height * 0.022;
        const alpha = currentOpacity * (0.035 + filament.depth * 0.07);

        context.strokeStyle = `rgba(${filament.side < 0 ? a : b},${alpha})`;
        context.lineWidth = 0.45 + filament.depth * 0.7;
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.bezierCurveTo(
          start.x - filament.side * centrePull,
          start.y + sway,
          end.x - filament.side * centrePull * 0.72,
          end.y - sway,
          end.x,
          end.y,
        );
        context.stroke();

        const flow = reducedMotion ? 0.5 : (elapsed * filament.speed + filament.phase / (Math.PI * 2)) % 1;
        const eased = flow * flow * (3 - 2 * flow);
        const px = start.x + (end.x - start.x) * eased - filament.side * Math.sin(eased * Math.PI) * centrePull * 0.5;
        const py = start.y + (end.y - start.y) * eased + Math.sin(eased * Math.PI) * sway * 0.55;
        context.fillStyle = `rgba(${filament.side < 0 ? a : b},${0.1 + filament.depth * 0.16})`;
        context.beginPath();
        context.arc(px, py, 0.55 + filament.depth * 0.5, 0, Math.PI * 2);
        context.fill();
      }

      const seam = context.createLinearGradient(cx, cy - height * 0.19, cx, cy + height * 0.19);
      seam.addColorStop(0, "rgba(255,255,255,0)");
      seam.addColorStop(0.5, `rgba(${a},0.13)`);
      seam.addColorStop(1, "rgba(255,255,255,0)");
      context.strokeStyle = seam;
      context.lineWidth = 0.55;
      context.beginPath();
      context.moveTo(cx, cy - height * 0.19);
      context.bezierCurveTo(cx - 4, cy - height * 0.06, cx + 4, cy + height * 0.07, cx, cy + height * 0.19);
      context.stroke();

      if (sceneRef.current !== "idle") {
        Object.values(NODE_POSITIONS).forEach(([nx, ny], index) => {
          const tx = width * nx;
          const ty = height * ny;
          const progress = reducedMotion ? 0.62 : (elapsed * (0.035 + index * 0.0025) + index * 0.14) % 1;
          const controlX = cx + (tx - cx) * 0.46;
          const controlY = cy + Math.sin(index * 1.7) * height * 0.045;

          context.strokeStyle = `rgba(${index % 2 === 0 ? a : b},0.055)`;
          context.lineWidth = 0.45;
          context.beginPath();
          context.moveTo(cx, cy);
          context.quadraticCurveTo(controlX, controlY, tx, ty);
          context.stroke();

          const oneMinus = 1 - progress;
          const px = oneMinus * oneMinus * cx + 2 * oneMinus * progress * controlX + progress * progress * tx;
          const py = oneMinus * oneMinus * cy + 2 * oneMinus * progress * controlY + progress * progress * ty;
          context.fillStyle = `rgba(${index % 2 === 0 ? a : b},0.34)`;
          context.beginPath();
          context.arc(px, py, 0.9, 0, Math.PI * 2);
          context.fill();
        });
      }

      const affected = NODE_POSITIONS[affectedRef.current] ?? NODE_POSITIONS.browser;
      if (sceneRef.current === "disconnect" || sceneRef.current === "repair") {
        const tx = width * affected[0];
        const ty = height * affected[1];
        const localColour = sceneRef.current === "disconnect" ? a : b;
        context.strokeStyle = `rgba(${localColour},0.22)`;
        context.lineWidth = 0.85;
        context.beginPath();
        context.moveTo(cx, cy);
        context.quadraticCurveTo(cx + (tx - cx) * 0.5, cy - height * 0.04, tx, ty);
        context.stroke();
      }

      context.restore();
      frame = window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="viba-neural-canvas" aria-hidden="true" />;
}
