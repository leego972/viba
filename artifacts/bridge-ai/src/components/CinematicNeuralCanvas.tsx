import { useEffect, useRef } from "react";

type Scene = "idle" | "planning" | "disconnect" | "repair" | "verify" | "complete";
type Props = { scene: Scene; affectedNode: string };
type Filament = { side: -1 | 1; lane: number; depth: number; phase: number };
type RGB = [number, number, number];

const PALETTE: Record<Scene, { a: RGB; b: RGB }> = {
  idle: { a: [65, 177, 211], b: [82, 86, 185] },
  planning: { a: [70, 190, 218], b: [91, 111, 198] },
  disconnect: { a: [166, 79, 96], b: [137, 84, 157] },
  repair: { a: [103, 91, 192], b: [151, 88, 174] },
  verify: { a: [58, 117, 193], b: [68, 164, 199] },
  complete: { a: [60, 184, 142], b: [70, 166, 169] },
};

function makeFilaments(count: number): Filament[] {
  const perSide = Math.ceil(count / 2);
  return Array.from({ length: count }, (_, index) => ({
    side: index % 2 === 0 ? -1 : 1,
    lane: (index % perSide) / Math.max(1, perSide - 1),
    depth: 0.3 + ((index * 37) % 70) / 100,
    phase: ((index * 29) % 100) / 100,
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

export default function CinematicNeuralCanvas({ scene }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef(scene);

  useEffect(() => { sceneRef.current = scene; }, [scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) return;

    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const filaments = makeFilaments(coarsePointer ? 36 : 58);

    let width = 1;
    let height = 1;
    let frame = 0;
    let last = performance.now();
    let elapsed = 0;
    let currentA: RGB = [...PALETTE[sceneRef.current].a];
    let currentB: RGB = [...PALETTE[sceneRef.current].b];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, coarsePointer ? 1.35 : 1.8);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (now: number) => {
      const delta = Math.min(40, now - last);
      last = now;
      elapsed += reducedMotion ? 0 : delta / 1000;
      context.clearRect(0, 0, width, height);

      const target = PALETTE[sceneRef.current];
      const colourEase = 1 - Math.exp(-delta / 5000);
      currentA = mix(currentA, target.a, colourEase);
      currentB = mix(currentB, target.b, colourEase);

      const cx = width * 0.5;
      const cy = height * 0.49;
      const slowWave = reducedMotion ? 0.5 : (Math.sin(elapsed * 0.22) + 1) / 2;
      const a = rgb(currentA);
      const b = rgb(currentB);
      const haloColour = rgb(mix(currentA, currentB, slowWave));

      const halo = context.createRadialGradient(cx, cy, 0, cx, cy, Math.min(width, height) * 0.33);
      halo.addColorStop(0, `rgba(${haloColour},0.11)`);
      halo.addColorStop(0.55, `rgba(${haloColour},0.045)`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = halo;
      context.fillRect(0, 0, width, height);

      context.save();
      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";

      for (const filament of filaments) {
        const lane = filament.lane;
        const crown = Math.sin(lane * Math.PI);
        const reach = width * (0.07 + crown * 0.13);
        const y = cy + (lane - 0.5) * height * 0.41;
        const x = cx + filament.side * reach;
        const endLane = Math.min(1, lane + 0.1 + filament.depth * 0.03);
        const endCrown = Math.sin(endLane * Math.PI);
        const endX = cx + filament.side * width * (0.07 + endCrown * 0.13);
        const endY = cy + (endLane - 0.5) * height * 0.41;
        const wavePosition = (slowWave + filament.phase) % 1;
        const colour = mix(currentA, currentB, wavePosition);
        const centrePull = width * (0.025 + filament.depth * 0.035);

        context.strokeStyle = `rgba(${rgb(colour)},${0.035 + filament.depth * 0.065})`;
        context.lineWidth = 0.45 + filament.depth * 0.65;
        context.beginPath();
        context.moveTo(x, y);
        context.bezierCurveTo(
          x - filament.side * centrePull,
          y,
          endX - filament.side * centrePull * 0.72,
          endY,
          endX,
          endY,
        );
        context.stroke();
      }

      const seam = context.createLinearGradient(cx, cy - height * 0.19, cx, cy + height * 0.19);
      seam.addColorStop(0, "rgba(255,255,255,0)");
      seam.addColorStop(0.5, `rgba(${haloColour},0.12)`);
      seam.addColorStop(1, "rgba(255,255,255,0)");
      context.strokeStyle = seam;
      context.lineWidth = 0.55;
      context.beginPath();
      context.moveTo(cx, cy - height * 0.19);
      context.bezierCurveTo(cx - 4, cy - height * 0.06, cx + 4, cy + height * 0.07, cx, cy + height * 0.19);
      context.stroke();

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
