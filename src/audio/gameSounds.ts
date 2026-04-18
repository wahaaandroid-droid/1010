/** Short UI sounds via Web Audio (no asset files).
 *
 * iOS Safari keeps `AudioContext` `suspended` until a user gesture, and may drop the
 * first scheduled beeps if they happen only after an `async` continuation. We unlock
 * aggressively on capture-phase pointer/touch/click, prime with a 1-frame buffer +
 * silent HTMLAudio, use `webkitAudioContext` when needed, and schedule beeps without
 * an extra `async` hop when the context is already running.
 */

let ctxRef: AudioContext | null = null;

type AudioContextCtor = typeof AudioContext;

function getAudioContextConstructor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctxRef) {
      const Ctor = getAudioContextConstructor();
      if (!Ctor) return null;
      ctxRef = new Ctor();
    }
    return ctxRef;
  } catch {
    return null;
  }
}

/** Minimal silent WAV — used for HTMLMediaElement unlock on iOS. */
const SILENT_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAACAAgAZGF0YQAAAAA=";

let silentHtmlAudio: HTMLAudioElement | null = null;

function primeHtml5AudioUnlock(): void {
  if (typeof document === "undefined") return;
  try {
    if (!silentHtmlAudio) {
      silentHtmlAudio = new Audio(SILENT_WAV_DATA_URI);
      silentHtmlAudio.preload = "auto";
      silentHtmlAudio.volume = 0.001;
    }
    void silentHtmlAudio.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

/** One-sample buffer — reliable “graph touched” signal on many iOS versions. */
function primeSilentBuffer(ctx: AudioContext): void {
  try {
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(ctx.currentTime);
  } catch {
    /* ignore */
  }
}

/** Inaudible oscillator tick — extra nudge for some WebKit builds. */
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

/** Run synchronously from user-gesture listeners (capture) and from drag start. */
function unlockAudioFromUserGesture(): void {
  primeHtml5AudioUnlock();
  const ctx = getCtx();
  if (!ctx) return;
  primeSilentBuffer(ctx);
  primeAudioGraph(ctx);
  if (ctx.state === "suspended") void ctx.resume();
}

/**
 * Call from known gestures (e.g. drag start) — same unlock path as document capture.
 */
export function resumeAudio(): void {
  unlockAudioFromUserGesture();
}

/**
 * Register once: taps/touches/clicks run unlock inside the user-gesture window so the
 * context is often `running` before the first `playPlaceSound` after pointerup.
 */
export function attachAudioUserGestureUnlock(
  target: EventTarget = typeof document !== "undefined" ? document : window,
): () => void {
  const onGesture = () => unlockAudioFromUserGesture();
  const opts = { capture: true, passive: true } as const;
  target.addEventListener("pointerdown", onGesture, opts);
  target.addEventListener("touchstart", onGesture, opts);
  target.addEventListener("touchend", onGesture, opts);
  target.addEventListener("click", onGesture, opts);

  const onVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      unlockAudioFromUserGesture();
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisible, opts);
  }

  const onPageShow = () => unlockAudioFromUserGesture();
  if (typeof window !== "undefined") {
    window.addEventListener("pageshow", onPageShow, opts);
  }

  return () => {
    target.removeEventListener("pointerdown", onGesture, opts);
    target.removeEventListener("touchstart", onGesture, opts);
    target.removeEventListener("touchend", onGesture, opts);
    target.removeEventListener("click", onGesture, opts);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisible, opts);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("pageshow", onPageShow, opts);
    }
  };
}

function runWithAudio(fn: (ctx: AudioContext) => void): void {
  const ctx = getCtx();
  if (!ctx) return;

  const fire = () => fn(ctx);

  if (ctx.state === "running") {
    fire();
    return;
  }

  primeSilentBuffer(ctx);
  primeAudioGraph(ctx);
  void ctx.resume().then(() => {
    if (ctx.state === "running") fire();
  });
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
  runWithAudio((ctx) => beep(ctx, 280, 0.07, "sine", 0.11, 160));
}

/** One or more full lines cleared */
export function playClearSound(lineCount: number): void {
  runWithAudio((ctx) => {
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
  });
}
