/** Short UI sounds via Web Audio (no asset files).
 *
 * iOS Safari starts `AudioContext` in `suspended` and often drops playback when
 * `resume()` / oscillators run only from React async paths (after gesture ends).
 * We unlock on raw `pointerdown`/`touchstart` (capture) and await `resume()` before beeps.
 */

let ctxRef: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctxRef) {
      ctxRef = new AudioContext();
    }
    return ctxRef;
  } catch {
    return null;
  }
}

/** Inaudible graph tick — helps some iOS versions treat the context as used in-gesture. */
function primeAudioGraph(ctx: AudioContext): void {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.001);
}

async function ensureAudioRunning(): Promise<AudioContext | null> {
  const ctx = getCtx();
  if (!ctx) return null;
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  return ctx;
}

/**
 * Call from known gestures (e.g. drag start) — still prime + fire `resume` because
 * iOS may ignore later async playback without an earlier unlock.
 */
export function resumeAudio(): void {
  const ctx = getCtx();
  if (!ctx) return;
  primeAudioGraph(ctx);
  if (ctx.state === "suspended") void ctx.resume();
}

/**
 * Register once: first tap/scroll-adjacent touch runs synchronously inside the user
 * gesture stack so Web Audio unlocks before the first placement sound.
 */
export function attachAudioUserGestureUnlock(
  target: EventTarget = typeof document !== "undefined" ? document : window,
): () => void {
  const onGesture = () => {
    const ctx = getCtx();
    if (!ctx) return;
    primeAudioGraph(ctx);
    if (ctx.state === "suspended") void ctx.resume();
  };
  const opts = { capture: true, passive: true } as const;
  target.addEventListener("pointerdown", onGesture, opts);
  target.addEventListener("touchstart", onGesture, opts);
  return () => {
    target.removeEventListener("pointerdown", onGesture, opts);
    target.removeEventListener("touchstart", onGesture, opts);
  };
}

function beep(
  ctx: AudioContext,
  freq: number,
  duration: number,
  type: OscillatorType,
  volume: number,
  freqEnd?: number,
): void {
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
  void (async () => {
    const ctx = await ensureAudioRunning();
    if (!ctx) return;
    beep(ctx, 280, 0.07, "sine", 0.11, 160);
  })();
}

/** One or more full lines cleared */
export function playClearSound(lineCount: number): void {
  void (async () => {
    const ctx = await ensureAudioRunning();
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
  })();
}
