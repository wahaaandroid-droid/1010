/** Short UI sounds via Web Audio (no asset files). Call `resumeAudio` after a user gesture on iOS. */

let ctxRef: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctxRef) ctxRef = new AudioContext();
    return ctxRef;
  } catch {
    return null;
  }
}

export function resumeAudio(): void {
  const ctx = getCtx();
  if (ctx?.state === "suspended") void ctx.resume();
}

function beep(
  freq: number,
  duration: number,
  type: OscillatorType,
  volume: number,
  freqEnd?: number,
): void {
  const ctx = getCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd != null) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(40, freqEnd),
      t0 + duration,
    );
  }
  g.gain.setValueAtTime(volume, t0);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + duration);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Block settled on the grid */
export function playPlaceSound(): void {
  beep(280, 0.07, "sine", 0.11, 160);
}

/** One or more full lines cleared */
export function playClearSound(lineCount: number): void {
  const ctx = getCtx();
  if (!ctx) return;
  const n = Math.min(Math.max(lineCount, 1), 5);
  const t0 = ctx.currentTime;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * 0.055;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "triangle";
    const f = 520 * 1.18 ** i;
    osc.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.14);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  }
}
