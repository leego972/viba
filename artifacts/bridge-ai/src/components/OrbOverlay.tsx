import { useEffect, useRef } from "react";

/**
 * OrbOverlay — agent-presence animation for the VIBA Brain screen.
 *
 * Sits at the brain's center (fills its parent via width/height 100%,
 * so place it as a sibling inside CommandOrb's own `relative h-[22rem]
 * max-w-[22rem]` container). Pulses/ripples like a drop hitting water,
 * then splits into one orb per active agent seat, each traveling out to
 * that seat's real position and fading there.
 *
 * Node angles/radius below are a BEST-EFFORT ESTIMATE derived from the
 * Tailwind classes on the AGENTS array in tool-console.tsx (three of the
 * four cards use `bottom-*` positioning against an auto-height card, so
 * exact centers couldn't be derived from source alone). To get exact
 * values, run this in devtools on the live page and feed the results
 * into NODE_ANGLES_DEG below:
 *
 *   [...document.querySelectorAll('[class*="absolute"][class*="w-32"]')]
 *     .map(el => { const r = el.getBoundingClientRect(),
 *                   p = el.parentElement!.getBoundingClientRect();
 *                   return { cx: r.left - p.left + r.width / 2,
 *                            cy: r.top - p.top + r.height / 2 }; })
 */

// Order matches AGENTS in tool-console.tsx: Director, Builder, Designer, QA
const NODE_LABELS = ["Director", "Builder", "Designer", "QA"];
const NODE_ANGLES_DEG = [-139, -61, 42, 156]; // 0 = right, clockwise — NW, NE, SE, SW
const MAX_SEATS = NODE_ANGLES_DEG.length;
const RADIUS_FRAC = 0.48; // fraction of container's min(width, height)

const CORE_RADIUS = 9;
const HOLD_MS = 5000;
const GROW_MS = 650;
const SPLIT_ARRIVE_MS = 800;
const SPLIT_FADE_MS = 700;
const SPLIT_TRAVEL_MS = SPLIT_ARRIVE_MS + SPLIT_FADE_MS;
const GAP_MS = 400;
const RIPPLE_INTERVAL_MS = 700;
const RIPPLE_LIFETIME_MS = 1500;

const GOLD_CORE = "#fff3d0";
const GOLD_MID = "#ffcf5c";
const GOLD_EDGE = "#e8a020";

type Phase = "GROW" | "HOLD" | "SPLIT" | "GAP";
type Ripple = { bornAt: number };
type SplitOrb = { fromX: number; fromY: number; toX: number; toY: number; bornAt: number };

export interface OrbOverlayProps {
  /**
   * How many seats are active this cycle. Lights up the first N seats
   * (Director first, then Builder, Designer, QA). Ignored if
   * `activeNodes` is provided. Omit both props to auto-cycle 1..MAX_SEATS
   * as a demo.
   */
  activeCount?: number;
  /** Exact seat indices (0-3) to light up, for when specific agents —
   * not just a count — are the ones currently participating. */
  activeNodes?: number[];
}

export function OrbOverlay({ activeCount, activeNodes }: OrbOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Mutable animation state lives in refs so prop changes don't restart
  // the rAF loop and frame updates don't trigger React re-renders.
  const demoModeRef = useRef(activeCount === undefined && activeNodes === undefined);
  const activeNodeIndicesRef = useRef<number[]>(
    activeNodes ?? defaultNodesForCount(activeCount ?? 1)
  );
  const activeCountRef = useRef(activeNodeIndicesRef.current.length);

  const demoIndexRef = useRef(0);
  const demoSequence = useRef(Array.from({ length: MAX_SEATS }, (_, i) => i + 1));

  const phaseRef = useRef<Phase>("GROW");
  const phaseStartRef = useRef(performance.now());
  const lastRippleAtRef = useRef(0);
  const ripplesRef = useRef<Ripple[]>([]);
  const splitOrbsRef = useRef<SplitOrb[]>([]);
  const orbScaleRef = useRef(0);
  const containerSizeRef = useRef({ w: 352, h: 352 });

  // Sync incoming props into refs without restarting the loop.
  useEffect(() => {
    if (activeNodes && activeNodes.length > 0) {
      demoModeRef.current = false;
      activeNodeIndicesRef.current = activeNodes.filter((i) => i >= 0 && i < MAX_SEATS);
      activeCountRef.current = activeNodeIndicesRef.current.length;
    } else if (activeCount !== undefined) {
      demoModeRef.current = false;
      const n = Math.max(1, Math.min(MAX_SEATS, Math.round(activeCount)));
      activeCountRef.current = n;
      activeNodeIndicesRef.current = defaultNodesForCount(n);
    } else {
      demoModeRef.current = true;
    }
  }, [activeCount, activeNodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let dpr = Math.max(1, window.devicePixelRatio || 1);

    function resize() {
      if (!canvas || !ctx) return;
      dpr = Math.max(1, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      containerSizeRef.current = { w: rect.width || 352, h: rect.height || 352 };
      canvas.width = containerSizeRef.current.w * dpr;
      canvas.height = containerSizeRef.current.h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener("resize", resize);
    resize();

    const brainCenter = () => ({
      x: containerSizeRef.current.w / 2,
      y: containerSizeRef.current.h / 2,
    });

    const nodePosition = (i: number) => {
      const { x, y } = brainCenter();
      const rad = (NODE_ANGLES_DEG[i] * Math.PI) / 180;
      const radiusPx = Math.min(containerSizeRef.current.w, containerSizeRef.current.h) * RADIUS_FRAC;
      return { x: x + Math.cos(rad) * radiusPx, y: y + Math.sin(rad) * radiusPx };
    };

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

    function setPhase(p: Phase) {
      phaseRef.current = p;
      phaseStartRef.current = performance.now();
      if (p === "HOLD") {
        ripplesRef.current = [];
        lastRippleAtRef.current = performance.now();
      }
      if (p === "SPLIT") {
        const origin = brainCenter();
        splitOrbsRef.current = activeNodeIndicesRef.current.map((idx) => {
          const target = nodePosition(idx);
          return { fromX: origin.x, fromY: origin.y, toX: target.x, toY: target.y, bornAt: performance.now() };
        });
        orbScaleRef.current = 0;
      }
    }

    function drawOrb(x: number, y: number, radius: number, alpha: number) {
      if (alpha <= 0 || radius <= 0 || !ctx) return;
      ctx.save();
      ctx.globalAlpha = alpha;

      const glowR = radius * 4.2;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
      glow.addColorStop(0, "rgba(255, 210, 110, 0.35)");
      glow.addColorStop(0.4, "rgba(255, 190, 80, 0.14)");
      glow.addColorStop(1, "rgba(255, 180, 60, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, glowR, 0, Math.PI * 2);
      ctx.fill();

      const core = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.35, radius * 0.1, x, y, radius);
      core.addColorStop(0, GOLD_CORE);
      core.addColorStop(0.5, GOLD_MID);
      core.addColorStop(1, GOLD_EDGE);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    function drawRipple(x: number, y: number, t: number) {
      if (!ctx) return;
      const maxR = CORE_RADIUS * 6;
      const r = CORE_RADIUS * 1.2 + easeOutCubic(t) * maxR;
      const alpha = (1 - t) * 0.5;
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = GOLD_MID;
      ctx.lineWidth = 2 * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function tick() {
      const t = performance.now();
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const { x: cx, y: cy } = brainCenter();

      const elapsed = t - phaseStartRef.current;
      const phase = phaseRef.current;

      if (phase === "GROW") {
        orbScaleRef.current = easeOutCubic(Math.min(1, elapsed / GROW_MS));
        if (elapsed >= GROW_MS) setPhase("HOLD");
      } else if (phase === "HOLD") {
        orbScaleRef.current = 1 + Math.sin(t / 260) * 0.06;
        if (t - lastRippleAtRef.current >= RIPPLE_INTERVAL_MS) {
          ripplesRef.current.push({ bornAt: t });
          lastRippleAtRef.current = t;
        }
        const count = activeCountRef.current;
        const holdLimit = count > 1 || demoModeRef.current ? HOLD_MS : Infinity;
        if (elapsed >= holdLimit) {
          setPhase(count > 1 ? "SPLIT" : "GAP");
        }
      } else if (phase === "SPLIT") {
        if (elapsed >= SPLIT_TRAVEL_MS) setPhase("GAP");
      } else if (phase === "GAP") {
        if (elapsed >= GAP_MS) {
          if (demoModeRef.current) {
            demoIndexRef.current = (demoIndexRef.current + 1) % demoSequence.current.length;
            activeCountRef.current = demoSequence.current[demoIndexRef.current];
            activeNodeIndicesRef.current = defaultNodesForCount(activeCountRef.current);
          }
          setPhase("GROW");
        }
      }

      ripplesRef.current = ripplesRef.current.filter((rp) => t - rp.bornAt < RIPPLE_LIFETIME_MS);
      for (const rp of ripplesRef.current) drawRipple(cx, cy, (t - rp.bornAt) / RIPPLE_LIFETIME_MS);

      if (phaseRef.current === "GROW" || phaseRef.current === "HOLD") {
        drawOrb(cx, cy, CORE_RADIUS * orbScaleRef.current, 1);
      }

      if (phaseRef.current === "SPLIT") {
        for (const orb of splitOrbsRef.current) {
          const elapsedOrb = t - orb.bornAt;
          if (elapsedOrb <= SPLIT_ARRIVE_MS) {
            const p = Math.min(1, elapsedOrb / SPLIT_ARRIVE_MS);
            const eased = easeInOutSine(p);
            drawOrb(orb.fromX + (orb.toX - orb.fromX) * eased, orb.fromY + (orb.toY - orb.fromY) * eased, CORE_RADIUS, 1);
          } else {
            const p2 = Math.min(1, (elapsedOrb - SPLIT_ARRIVE_MS) / SPLIT_FADE_MS);
            const pulse = 1 + Math.sin(p2 * Math.PI) * 0.25;
            const alpha = 1 - easeOutCubic(p2);
            drawOrb(orb.toX, orb.toY, CORE_RADIUS * pulse, Math.max(0, alpha));
          }
        }
      }

      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 20,
      }}
    />
  );
}

function defaultNodesForCount(n: number): number[] {
  const clamped = Math.max(1, Math.min(MAX_SEATS, n));
  return Array.from({ length: clamped }, (_, i) => i);
}

export { NODE_LABELS, MAX_SEATS };
