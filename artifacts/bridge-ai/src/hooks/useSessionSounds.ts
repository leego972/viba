import { useCallback, useEffect, useRef, useState } from "react";

type SoundEvent = "message" | "task_complete" | "approval" | "session_done";

function createCtx(): AudioContext | null {
  try { return new AudioContext(); } catch { return null; }
}

function tone(
  ctx: AudioContext,
  freq: number,
  gainPeak: number,
  duration: number,
  type: OscillatorType = "sine",
  startTime = ctx.currentTime,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

/**
 * Refined, optional session sounds — off by default.
 * Uses Web Audio API only; no external files, no deps.
 *
 * Sounds are deliberately subtle: short, low-gain tones that signal
 * events without pulling attention away from the content.
 */
export function useSessionSounds() {
  const [enabled, setEnabled] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);

  const ensure = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = createCtx();
    if (ctxRef.current?.state === "suspended") ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  const play = useCallback((event: SoundEvent) => {
    if (!enabled) return;
    const ctx = ensure();
    if (!ctx) return;

    const t = ctx.currentTime;
    switch (event) {
      case "message":
        // Soft single chime — barely perceptible
        tone(ctx, 880, 0.04, 0.35, "sine", t);
        break;
      case "task_complete":
        // Two-note ascending interval — resolved, satisfying
        tone(ctx, 523, 0.05, 0.3, "sine", t);
        tone(ctx, 784, 0.04, 0.45, "sine", t + 0.18);
        break;
      case "approval":
        // Low warm pulse — attentive, not alarming
        tone(ctx, 330, 0.06, 0.5, "sine", t);
        tone(ctx, 415, 0.04, 0.4, "sine", t + 0.1);
        break;
      case "session_done":
        // Three-note resolution chord — quiet, elegant
        tone(ctx, 523, 0.04, 0.6, "sine", t);
        tone(ctx, 659, 0.035, 0.6, "sine", t + 0.12);
        tone(ctx, 784, 0.03, 0.8, "sine", t + 0.24);
        break;
    }
  }, [enabled, ensure]);

  const toggle = useCallback(() => {
    setEnabled(prev => {
      const next = !prev;
      if (next) ensure(); // warm up AudioContext on user gesture
      return next;
    });
  }, [ensure]);

  useEffect(() => {
    return () => { ctxRef.current?.close(); };
  }, []);

  return { enabled, toggle, play };
}
