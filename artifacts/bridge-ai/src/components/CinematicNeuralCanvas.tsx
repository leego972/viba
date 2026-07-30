import { useEffect, useRef } from "react";

type Scene = "idle" | "planning" | "disconnect" | "repair" | "verify" | "complete";
type Props = { scene: Scene; affectedNode: string };
type Filament = { side: -1 | 1; lane: number; phase: number; depth: number; speed: number };
type RGB = [number, number, number];

const NODE_POSITIONS: Record<string, [number, number]> = {
  strategy: [0.13, 0.24], research: [0.16, 0.72], code: [0.82, 0.2],
  browser: [0.88, 0.52], deploy: [0.77, 0.82], verify: [0.45, 0.91],
};

const PALETTE: Record<Scene, { a: RGB; b: RGB; speed: number; opacity: number }> = {
  idle: { a: [77, 213, 255], b: [103, 91, 255], speed: 0.72, opacity: 0.62 },
  planning: { a: [83, 226, 255], b: [111, 127, 255], speed: 0.9, opacity: 0.76 },
  disconnect: { a: [255, 92, 118], b: [190, 92, 255], speed: 1.08, opacity: 0.78 },
  repair: { a: [129, 105, 255], b: [215, 91, 255], speed: 1.02, opacity: 0.82 },
  verify: { a: [70, 157, 255], b: [84, 219, 255], speed: 0.86, opacity: 0.8 },
  complete: { a: [67, 244, 190], b: [87, 218, 255], speed: 0.74, opacity: 0.84 },
};

function buildFilaments(count: number): Filament[] {
  const perSide = Math.ceil(count / 2);
  return Array.from({ length: count }, (_, index) => ({
    side: index % 2 === 0 ? -1 : 1,
    lane: (index % perSide) / Math.max(1, perSide - 1),
    phase: Math.random() * Math.PI * 2,
    depth: 0.35 + Math.random() * 0.65,
    speed: 0.55 + Math.random() * 0.42,
  }));
}

function mix(a: RGB, b: RGB, amount: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
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
    const filaments = buildFilaments(coarsePointer ? 34 : 56);

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
      const ratio = Math.min(window.devicePixelRatio || 1, coarsePointer ? 1.4 : 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const brainPoint = (side: -1 | 1, lane: number, time: number, breathe: number) => {
      const cx = width * 0.5;
      const cy = height * 0.49;
      const y = cy + (lane - 0.5) * height * 0.42;
      const crown = Math.sin(lane * Math.PI);
      const reach = width * (0.082 + crown * 0.118);
      const ripple = Math.sin(time * 0.62 + lane * 7.4) * width * 0.0045;
      return { x: cx + side * reach * breathe + ripple, y };
    };

    const draw = (now: number) => {
      const delta = Math.min(32, now - last);
      last = now;
      elapsed += reducedMotion ? 0 : delta / 1000;
      context.clearRect(0, 0, width, height);

      const target = PALETTE[sceneRef.current];
      const colourEase = 1 - Math.exp(-delta / 950);
      currentA = mix(currentA, target.a, colourEase);
      currentB = mix(currentB, target.b, colourEase);
      currentSpeed += (target.speed - currentSpeed) * colourEase;
      currentOpacity += (target.opacity - currentOpacity) * colourEase;

      const a = rgb(currentA);
      const b = rgb(currentB);
      const breathe = reducedMotion ? 1 : 1 + Math.sin(elapsed * currentSpeed) * 0.024;
      const cx = width * 0.5;
      const cy = height * 0.49;

      const halo = context.createRadialGradient(cx, cy, 0, cx, cy, Math.min(width, height) * 0.34);
      halo.addColorStop(0, `rgba(${a},0.14)`);
      halo.addColorStop(0.5, `rgba(${b},0.07)`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = halo;
      context.fillRect(0, 0, width, height);

      context.save();
      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";

      for (const filament of filaments) {
        const start = brainPoint(filament.side, filament.lane, elapsed, breathe);
        const endLane = Math.min(1, filament.lane + 0.14 + filament.depth * 0.04);
        const end = brainPoint(filament.side, endLane, elapsed + 0.7, breathe);
        const sway = Math.sin(elapsed * 0.56 + filament.phase) * height * 0.014;
        const centrePull = width * (0.032 + filament.depth * 0.028);
        const alpha = currentOpacity * (0.055 + filament.depth * 0.1);

        context.strokeStyle = `rgba(${filament.side < 0 ? a : b},${alpha})`;
        context.lineWidth = 0.65 + filament.depth * 0.95;
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.bezierCurveTo(
          start.x - filament.side * centrePull,
          start.y + sway,
          end.x - filament.side * centrePull * 0.7,
          end.y - sway,
          end.x,
          end.y,
        );
        context.stroke();

        const flow = reducedMotion ? 0.5 : (elapsed * filament.speed + filament.phase / (Math.PI * 2)) % 1;
        const px = start.x + (end.x - start.x) * flow - filament.side * Math.sin(flow * Math.PI) * centrePull * 0.45;
        const py = start.y + (end.y - start.y) * flow + Math.sin(flow * Math.PI * 2 + filament.phase) * height * 0.008;
        context.fillStyle = `rgba(${filament.side < 0 ? a : b},${0.16 + filament.depth * 0.26})`;
        context.beginPath();
        context.arc(px, py, 0.7 + filament.depth * 0.65, 0, Math.PI * 2);
        context.fill();
      }

      const seam = context.createLinearGradient(cx, cy - height * 0.2, cx, cy + height * 0.2);
      seam.addColorStop(0, "rgba(255,255,255,0)");
      seam.addColorStop(0.5, `rgba(${a},0.24)`);
      seam.addColorStop(1, "rgba(255,255,255,0)");
      context.strokeStyle = seam;
      context.lineWidth = 0.75;
      context.beginPath();
      context.moveTo(cx, cy - height * 0.2);
      context.bezierCurveTo(cx - 3, cy - height * 0.07, cx + 3, cy + height * 0.08, cx, cy + height * 0.2);
      context.stroke();

      if (sceneRef.current !== "idle") {
        Object.values(NODE_POSITIONS).forEach(([nx, ny], index) => {
          const tx = width * nx;
          const ty = height * ny;
          const progress = reducedMotion ? 0.65 : (elapsed * (0.08 + index * 0.006) + index * 0.14) % 1;
          const controlX = cx + (tx - cx) * 0.46;
          const controlY = cy + Math.sin(index * 1.7) * height * 0.055;

          context.strokeStyle = `rgba(${index % 2 === 0 ? a : b},0.11)`;
          context.lineWidth = 0.7;
          context.beginPath();
          context.moveTo(cx, cy);
          context.quadraticCurveTo(controlX, controlY, tx, ty);
          context.stroke();

          const oneMinus = 1 - progress;
          const px = oneMinus * oneMinus * cx + 2 * oneMinus * progress * controlX + progress * progress * tx;
          const py = oneMinus * oneMinus * cy + 2 * oneMinus * progress * controlY + progress * progress * ty;
          context.fillStyle = `rgba(${index % 2 === 0 ? a : b},0.58)`;
          context.beginPath();
          context.arc(px, py, 1.35, 0, Math.PI * 2);
          context.fill();
        });
      }

      const affected = NODE_POSITIONS[affectedRef.current] ?? NODE_POSITIONS.browser;
      if (sceneRef.current === "disconnect" || sceneRef.current === "repair") {
        const tx = width * affected[0];
        const ty = height * affected[1];
        const localColour = sceneRef.current === "disconnect" ? a : b;
        context.strokeStyle = `rgba(${localColour},0.42)`;
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(cx, cy);
        context.quadraticCurveTo(cx + (tx - cx) * 0.5, cy - height * 0.045, tx, ty);
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
