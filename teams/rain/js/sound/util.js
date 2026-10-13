// Small helpers shared by the rain sound engine.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dbToGain = db => (db <= -80 ? 0 : Math.pow(10, db / 20));
export const gainToDb = g => (g <= 1e-9 ? -Infinity : 20 * Math.log10(g));
export const midiToHz = m => 440 * Math.pow(2, (m - 69) / 12);
// exponential map 0..1 -> lo..hi (for frequencies and times)
export const expMap = (t, lo, hi) => lo * Math.pow(hi / lo, clamp(t, 0, 1));

// Deterministic random (so renders are repeatable). mulberry32.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Freeze an AudioParam's value at time t so a new ramp can start from wherever it is.
export function holdAt(param, t) {
  if (param.cancelAndHoldAtTime) {
    try { param.cancelAndHoldAtTime(t); return; } catch (e) { /* fall through */ }
  }
  param.cancelScheduledValues(t);
}

// Smoothly move a param to a value (for knobs). Safe to call many times.
export function glide(param, value, ctx, seconds = 0.04) {
  const t = ctx.currentTime;
  try {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.setTargetAtTime(value, t, seconds / 3);
  } catch (e) { param.value = value; }
}

export function setNow(param, value, ctx) {
  try { param.cancelScheduledValues(ctx.currentTime); } catch (e) { /* ignore */ }
  param.value = value;
  try { param.setValueAtTime(value, ctx.currentTime); } catch (e) { /* ignore */ }
}

// Soft clip curve: linear up to `knee`, then smoothly bends to `ceiling` (never above it).
export function softClipCurve(knee = 0.75, ceiling = 0.891, n = 8192) {
  const c = new Float32Array(n);
  const span = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + span * Math.tanh((a - knee) / span);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

export function tanhCurve(drive = 2, n = 4096) {
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * drive) / norm;
  }
  return c;
}

// Cached white-noise buffer per context (used for hammers, bow air, grains of air).
const noiseCache = new WeakMap();
export function noiseBuffer(ctx, seconds = 2) {
  let b = noiseCache.get(ctx);
  if (b) return b;
  const len = Math.floor(ctx.sampleRate * seconds);
  b = ctx.createBuffer(2, len, ctx.sampleRate);
  const r = rng(77);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
  }
  noiseCache.set(ctx, b);
  return b;
}

// Hann window curve used for grains.
export const HANN = (() => {
  const n = 64, c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return c;
})();

export const isOffline = ctx => typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;

// Param list helpers -------------------------------------------------------
export function defaultsOf(params) {
  const o = {};
  for (const p of params) o[p.id] = p.default;
  return o;
}

// Accept an option id or an index for enum params; numbers are clamped.
export function coerce(param, value) {
  if (!param) return value;
  if (param.options) {
    if (typeof value === 'number') {
      const o = param.options[clamp(Math.round(value), 0, param.options.length - 1)];
      return o.id;
    }
    return param.options.some(o => o.id === value) ? value : param.default;
  }
  const v = Number(value);
  if (!Number.isFinite(v)) return param.default;
  return clamp(v, param.min, param.max);
}

// Fresh id helper
let idn = 0;
export const uid = (p = 'id') => `${p}-${Date.now().toString(36)}-${(idn++).toString(36)}`;
