// util.js - small helpers shared by the sky sound engine (no dependencies).

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dbToGain = db => (db <= -90 ? 0 : Math.pow(10, db / 20));
export const gainToDb = g => (g > 1e-9 ? 20 * Math.log10(g) : -120);
export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
/** Map 0..1 to lo..hi on an exponential (log-frequency) curve. */
export const expMap = (t, lo, hi) => lo * Math.pow(hi / lo, clamp(+t || 0, 0, 1));
export const velCurve = v => Math.pow(clamp(v ?? 0.8, 0, 1), 1.4);

/** Deterministic random generator (mulberry32). */
export function rng(seed = 1) {
  let a = seed | 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Per-context shared resources (noise buffer, curves, periodic waves).
const perCtx = new WeakMap();
export function shared(ctx) { let s = perCtx.get(ctx); if (!s) { s = {}; perCtx.set(ctx, s); } return s; }

/** 4 s of decorrelated stereo white noise, made once per context. */
export function noiseBuffer(ctx) {
  const s = shared(ctx);
  if (!s.noise) {
    const len = Math.round(ctx.sampleRate * 4), b = ctx.createBuffer(2, len, ctx.sampleRate), r = rng(4242);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = r() * 2 - 1; }
    // smooth the loop seam
    const f = 256; for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < f; i++) { const w = i / f; d[i] *= w; d[len - 1 - i] *= w; } }
    s.noise = b;
  }
  return s.noise;
}

/** Hann window (sin^2) used for grain envelopes. */
export const HANN = (() => { const n = 33, a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.pow(Math.sin(Math.PI * i / (n - 1)), 2); return a; })();

/** Set a param smoothly from "now" (for live knob moves). */
export function glide(ctx, param, value, seconds = 0.05) {
  if (!param || !Number.isFinite(value)) return;
  const t = ctx.currentTime;
  try { param.cancelScheduledValues(t); param.setTargetAtTime(value, t, Math.max(0.005, seconds / 3)); } catch { param.value = value; }
}
/** Set a param immediately (used when building the graph). */
export function setNow(param, value) { if (param && Number.isFinite(value)) param.value = value; }

export function safeDisconnect(...nodes) { for (const n of nodes) { try { n && n.disconnect(); } catch { /* already */ } } }
export function safeStop(src, t) { try { src.stop(t); } catch { /* not started or already stopped */ } }

/** Soft-clip curve: linear up to `knee`, then a tanh shoulder that never exceeds `ceiling`. */
export function softClipCurve(knee = 0.7, ceiling = 0.87, n = 4097) {
  const c = new Float32Array(n), span = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + span * Math.tanh((ax - knee) / span);
    c[i] = Math.sign(x) * y;
  }
  return c;
}
/** Warm saturation curve (tanh, normalised to unity peak); drive 0..1. */
export function driveCurve(drive = 0.3, n = 2049) {
  const k = 1 + drive * 9, c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  return c;
}

/** Envelope helpers built only from setValueAtTime / setTargetAtTime so releases chain cleanly at any moment. */
export function envAttack(param, t, peak, attack, sustain = 1, decay = 1) {
  param.setValueAtTime(0, t);
  param.setTargetAtTime(peak, t, Math.max(0.0015, attack / 4));
  if (sustain < 1) param.setTargetAtTime(peak * sustain, t + attack, Math.max(0.01, decay / 4));
}
export function envRelease(param, t, release) {
  param.cancelScheduledValues(t);
  param.setTargetAtTime(0, t, Math.max(0.004, release / 6));
}

/** Read peak / RMS (dBFS) from an AnalyserNode. */
export function readMeter(an, buf) {
  if (!an) return { peakDb: -120, rmsDb: -120 };
  an.getFloatTimeDomainData(buf);
  let pk = 0, s = 0;
  for (let i = 0; i < buf.length; i++) { const v = buf[i]; const a = v < 0 ? -v : v; if (a > pk) pk = a; s += v * v; }
  return { peakDb: gainToDb(pk), rmsDb: gainToDb(Math.sqrt(s / buf.length)) };
}
