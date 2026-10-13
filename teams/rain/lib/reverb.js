// reverb.js - impulse responses for ConvolverNode, made from shaped noise (no samples).
//   const ir = makeImpulse(ctx, REVERB_PRESETS.hall);  conv.buffer = ir;
// The tail is two independent noise streams (decorrelated stereo, `width`), shaped by an exponential envelope that
// falls 60 dB in `decay` seconds, darkened over time by a one-pole low-pass whose cutoff sinks as the tail decays
// (`damping`: highs die first, like a real room), with zero DC, a soft 6 ms onset and a fade at the very end.
// Results are cached per (sampleRate, options): calling again is free. Treat returned buffers as read-only.

/** Starting points; spread and override freely: makeImpulse(ctx, {...REVERB_PRESETS.hall, decay: 5}). */
export const REVERB_PRESETS = {
  room:      { seconds: 1.6, decay: 1.2, preDelay: 0.006, damping: 0.6, width: 0.8 },
  plate:     { seconds: 3.0, decay: 2.6, preDelay: 0.0,   damping: 0.25, width: 1 },
  hall:      { seconds: 4.0, decay: 3.4, preDelay: 0.025, damping: 0.45, width: 1 },
  cathedral: { seconds: 9.0, decay: 7.5, preDelay: 0.045, damping: 0.55, width: 1 },
  infinite:  { seconds: 16,  decay: 30,  preDelay: 0.03,  damping: 0.3, width: 1 },   // pair with a feedback "freeze"
  reverse:   { seconds: 2.5, decay: 2.2, preDelay: 0.0,   damping: 0.35, width: 1, reverse: true },
};

const cache = new Map();
const CACHE_MAX = 32;

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * @param {BaseAudioContext|{sampleRate:number}} ctx
 * @param {object} o seconds (tail length, default 3), decay (RT60 in s, default = seconds), preDelay (s, default 0.02),
 *   damping (0 bright .. 1 dark, default 0.4), width (0 mono .. 1 fully decorrelated, default 1), reverse (false),
 *   seed (1; change for a different but equally smooth tail), cache (true)
 * @returns {AudioBuffer} stereo, length preDelay + seconds, scaled to unit energy (sum of squares per channel ~ 1)
 */
export function makeImpulse(ctx, { seconds = 3, decay, preDelay = 0.02, damping = 0.4, width = 1, reverse = false, seed = 1, cache: useCache = true } = {}) {
  const sr = ctx.sampleRate;
  seconds = Math.max(0.05, +seconds || 3);
  decay = Math.max(0.05, decay === undefined ? seconds : +decay);
  preDelay = Math.max(0, +preDelay || 0);
  damping = Math.min(1, Math.max(0, +damping || 0));
  width = Math.min(1, Math.max(0, width === undefined ? 1 : +width));
  const key = [sr, seconds, decay, preDelay, damping, width, !!reverse, seed].join('|');
  if (useCache && cache.has(key)) return cache.get(key);

  const pre = Math.round(preDelay * sr), n = Math.round(seconds * sr), len = pre + n;
  const buf = typeof ctx.createBuffer === 'function' ? ctx.createBuffer(2, len, sr) : new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr });
  const L = new Float32Array(n), R = new Float32Array(n), env = new Float32Array(n);
  const rnd = mulberry32(seed * 7919 + 17);
  const g = 1 / Math.sqrt(1 + width * width);              // mid/side mix keeps level constant across widths
  const k60 = -3 * Math.LN10 / (decay * sr);               // amplitude reaches -60 dB at t = decay
  const attack = Math.max(1, Math.round(0.006 * sr));
  const fadeN = Math.max(1, Math.min(Math.round(0.25 * sr), Math.round(n * 0.08)));
  const fStart = Math.min(18000, 0.45 * sr), octaves = 7 * damping; // damping 1: highs sink 7 octaves by RT60
  let yl = 0, yr = 0;
  for (let i = 0; i < n; i++) {
    const m = rnd() * 2 - 1, s = rnd() * 2 - 1;
    const fc = Math.max(120, fStart * Math.pow(2, -octaves * i / (decay * sr)));
    const a = 1 - Math.exp(-2 * Math.PI * fc / sr);
    yl += a * ((m + width * s) * g - yl);
    yr += a * ((m - width * s) * g - yr);
    let e = Math.exp(k60 * i);
    if (i < attack) e *= 0.5 - 0.5 * Math.cos(Math.PI * i / attack);
    if (i >= n - fadeN) e *= 0.5 + 0.5 * Math.cos(Math.PI * (i - (n - fadeN)) / fadeN);
    env[i] = e; L[i] = yl * e; R[i] = yr * e;
  }
  // Remove DC exactly, shaped like the envelope so no step is introduced; then scale to unit energy.
  let sl = 0, sr2 = 0, se = 0;
  for (let i = 0; i < n; i++) { sl += L[i]; sr2 += R[i]; se += env[i]; }
  const dl = sl / se, dr = sr2 / se;
  let el = 0, er = 0;
  for (let i = 0; i < n; i++) { L[i] -= dl * env[i]; R[i] -= dr * env[i]; el += L[i] * L[i]; er += R[i] * R[i]; }
  const scale = 1 / Math.sqrt(Math.max(1e-20, (el + er) / 2));
  if (reverse) { L.reverse(); R.reverse(); }
  if (reverse) { // the reversed tail ends at its loudest point: close it with 4 ms so it does not click
    const f = Math.min(n, Math.round(0.004 * sr));
    for (let i = 0; i < f; i++) { const w = 0.5 + 0.5 * Math.cos(Math.PI * (i + 1) / f); L[n - f + i] *= w; R[n - f + i] *= w; }
  }
  const cl = buf.getChannelData(0), cr = buf.getChannelData(1);
  for (let i = 0; i < n; i++) { cl[pre + i] = L[i] * scale; cr[pre + i] = R[i] * scale; }

  if (useCache) { if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); cache.set(key, buf); }
  return buf;
}
