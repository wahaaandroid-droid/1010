/** Short UI sounds via Web Audio (no asset files).
 *
 * iOS Safari: creating `AudioContext` outside a user gesture can leave audio broken for the
 * whole session until a later “strong” gesture (e.g. a button click). Initial `pageshow` /
 * `visibilitychange` are *not* user gestures — those handlers must not construct the context.
 *
 * We only `new AudioContext()` from pointer/touch/click unlock paths, prime with buffer + silent
 * HTMLAudio there, and schedule beeps without an extra async hop when already `running`.
 */

let ctxRef: AudioContext | null = null;

const SOUND_ENABLED_STORAGE_KEY = "1010-sound-enabled";

function readStoredSoundEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    const raw = localStorage.getItem(SOUND_ENABLED_STORAGE_KEY);
    if (raw == null) return true;
    return raw !== "0" && raw !== "false";
  } catch {
    return true;
  }
}

let soundEnabled = readStoredSoundEnabled();

export function isGameSoundEnabled(): boolean {
  return soundEnabled;
}

export function setGameSoundEnabled(on: boolean): void {
  soundEnabled = on;
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SOUND_ENABLED_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextConstructor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Create the context — call only from user-gesture unlock (`unlockAudioFromUserGesture`). */
function getOrCreateCtxInUserGesture(): AudioContext | null {
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

function getExistingCtx(): AudioContext | null {
  return ctxRef;
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

/**
 * Re-touch the graph + `resume()` without creating a context.
 *
 * iOS WebKit: opening Safari’s “…” sheet often fires `visibilitychange` / `focus`. Users report
 * audio starts only after that — the page was “visible” the whole time, yet the first `running`
 * session can be effectively muted until this nudge runs again. Always calling `resume()` (even
 * when already running) plus a silent buffer tick matches what fixes output after closing the sheet.
 */
function resumeExistingContextAfterLifecycle(): void {
  const ctx = ctxRef;
  if (!ctx) return;
  try {
    primeSilentBuffer(ctx);
    void ctx.resume();
  } catch {
    /* ignore */
  }
}

/** Run synchronously from user-gesture listeners (capture) and from drag start/end. */
function unlockAudioFromUserGesture(): void {
  primeHtml5AudioUnlock();
  const wasNewContext = ctxRef == null;
  const ctx = getOrCreateCtxInUserGesture();
  if (!ctx) return;
  primeSilentBuffer(ctx);
  primeAudioGraph(ctx);
  if (ctx.state === "suspended") void ctx.resume();
  /**
   * First `AudioContext` on iOS can report `running` yet stay muted until a later graph nudge
   * (often triggered by Safari UI, e.g. closing the “…” sheet). Re-run the same nudge on the next
   * microtask while activation is still fresh — cheap and matches user-visible recovery.
   */
  if (wasNewContext) {
    queueMicrotask(() => {
      resumeExistingContextAfterLifecycle();
    });
  }
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
      resumeExistingContextAfterLifecycle();
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisible, opts);
  }

  const onPageShow = () => resumeExistingContextAfterLifecycle();
  /** Closing Safari’s chrome often fires `focus` without a clean `visibilitychange`; mirror the sheet-close fix. */
  const onWinFocus = () => resumeExistingContextAfterLifecycle();
  if (typeof window !== "undefined") {
    window.addEventListener("pageshow", onPageShow, opts);
    window.addEventListener("focus", onWinFocus, opts);
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
      window.removeEventListener("focus", onWinFocus, opts);
    }
  };
}

function runWithAudio(fn: (ctx: AudioContext) => void): void {
  const ctx = getExistingCtx();
  if (!ctx) return;

  try {
    /**
     * Do not skip priming when `state === "running"`. On some iOS builds the context reports
     * `running` after the first gesture yet produces no audible output until a later lifecycle
     * nudge (e.g. Safari menu close). A one-sample buffer + `resume()` right before scheduling the
     * real beep matches that recovery path.
     */
    primeSilentBuffer(ctx);
    primeAudioGraph(ctx);
    void ctx.resume();
  } catch {
    /* ignore */
  }
  fn(ctx);
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
  if (!soundEnabled) return;
  runWithAudio((ctx) => beep(ctx, 280, 0.07, "sine", 0.11, 160));
}

/** One or more full lines cleared */
export function playClearSound(lineCount: number): void {
  if (!soundEnabled) return;
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
