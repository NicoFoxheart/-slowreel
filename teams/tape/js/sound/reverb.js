// reverb.js - impulse responses for the tape studio, synthesized from shaped noise (no samples).
// Characters: plate, spring, room, hall, cathedral, reverse, infinite. Generated once per (sampleRate, settings) and cached.
// Every IR is normalized to unit energy per channel, and the lows under ~120 Hz are thinned so reverb never turns to mud.
import { rng } from './util.js?v=10a';

export const REVERB_TYPES = [
  { value: 'plate',     label: 'Plate' },
  { value: 'spring',    label: 'Spring' },
  { value: 'room',      label: 'Tape room' },
  { value: 'hall',      label: 'Hall' },
  { value: 'cathedral', label: 'Cathedral' },
  { value: 'reverse',   label: 'Reverse' },
  { value: 'infinite',  label: 'Infinite' },
];

// rt: seconds to fall 60 dB. len: IR length. pre: pre-delay. damp: how fast highs die (0 bright .. 1 dark).
// er: early reflection count. swell: onset swell time. hp: low cut of the tail (Hz). lp: starting high cut (Hz).
const BASE = {
  plate:     { rt: 2.8, len: 3.6,  pre: 0.004, damp: 0.30, er: 0,  swell: 0.004, hp: 160, lp: 12000 },
  spring:    { rt: 2.2, len: 2.8,  pre: 0.010, damp: 0.35, er: 0,  swell: 0.002, hp: 220, lp: 4800, spring: true },
  room:      { rt: 0.9, len: 1.3,  pre: 0.003, damp: 0.60, er: 10, swell: 0.003, hp: 120, lp: 9000 },
  hall:      { rt: 3.6, len: 4.6,  pre: 0.022, damp: 0.50, er: 7,  swell: 0.030, hp: 120, lp: 10000 },
  cathedral: { rt: 7.5, len: 9.0,  pre: 0.045, damp: 0.58, er: 6,  swell: 0.160, hp: 110, lp: 8500 },
  reverse:   { rt: 2.4, len: 2.4,  pre: 0.0,   damp: 0.35, er: 0,  swell: 0.004, hp: 160, lp: 10000, reverse: true },
  infinite:  { rt: 28,  len: 16,   pre: 0.030, damp: 0.40, er: 0,  swell: 0.400, hp: 140, lp: 9000 },
};

// Length caps. 6 s is plenty for every room (a 7.5 s cathedral is ~44 dB down at 6 s; the cap ends it with a gentle
// 1.5 s fade, so the tail still dies away naturally). 'infinite' keeps its 28 s decay through a light feedback tail
// in effects.js instead of a 20 s impulse. Light mode squeezes every room under 2.5 s.
export const IR_MAX_SECONDS = 6;
export const LIGHT_IR_MAX_SECONDS = 2.5;

const cache = new Map();        // key -> AudioBuffer (shared by every context at that sample rate)
const floatCache = new Map();   // key -> [Float32Array L, R]

/** The quantized settings of an impulse response (and its cache key). Pure: also used by the asset worker. */
export function irPlan(type = 'hall', { size = 1, tone = 0.5, preDelay, light = false } = {}) {
  const b = BASE[type] || BASE.hall;
  if (!BASE[type]) type = 'hall';
  size = Math.round(Math.min(2, Math.max(0.4, +size || 1)) * 10) / 10;   // quantized: knob drags reuse the cache
  tone = Math.round(Math.min(1, Math.max(0, +tone)) * 10) / 10;
  const pre = preDelay === undefined ? b.pre : Math.round(Math.min(0.25, Math.max(0, +preDelay)) * 200) / 200;
  let rt = b.rt * size;
  let len = type === 'infinite' ? b.len * Math.min(1.25, size) : Math.min(14, b.len * size);
  let fade = type === 'infinite' ? 5 : 0.4;
  const cap = (light ? LIGHT_IR_MAX_SECONDS : IR_MAX_SECONDS) - pre;
  if (len > cap + (light ? 0 : 0.1)) {   // (a room a hair over the 6 s cap keeps its own length and fade)
    if (light) { rt = Math.min(rt, cap * 60 / 45); fade = Math.min(0.6, cap * 0.25); }   // a smaller room that still dies away
    else fade = 1.5;
    len = cap;
  }
  // A room cut while its tail is still above -40 dB (infinite, very large cathedrals) gets a feedback tail in
  // effects.js that carries the decay on at the room's own rate and darkness: {rt, fc}. Light rooms never do.
  let tail = null;
  if (!light && -60 * len / rt > -40) {
    const damp = Math.min(1, Math.max(0, b.damp + (0.5 - tone) * 0.6)), lp0 = b.lp * Math.pow(2, (tone - 0.5) * 1.2);
    tail = { rt, fc: Math.max(1500, lp0 * Math.pow(2, -7 * damp * len / rt)) };
  }
  return { type, size, tone, pre, rt, len, fade, tail, light: !!light, key: [type, size, tone, pre, light ? 'L' : ''].join('|') };
}

/**
 * makeIR(ctx, type, {size=1, tone=0.5, preDelay, light}) -> AudioBuffer (stereo)
 * size scales decay and length (0.4 .. 2). tone 0 dark .. 1 bright. Cached; when the samples are not made yet this
 * computes them right here (synchronously), so the engine asks for them ahead of time with assets.js (worker / idle).
 */
export function makeIR(ctx, type = 'hall', opts = {}) {
  const plan = irPlan(type, opts), sr = ctx.sampleRate, key = sr + '|' + plan.key;
  if (cache.has(key)) return cache.get(key);
  let ch = floatCache.get(key);
  if (!ch) ch = irFloats(sr, plan);
  floatCache.delete(key);   // the AudioBuffer below holds the samples from now on
  const buf = ctx.createBuffer(2, ch[0].length, sr);
  buf.copyToChannel(ch[0], 0); buf.copyToChannel(ch[1], 1);
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  cache.set(key, buf);
  return buf;
}
export function hasIR(sr, plan) { const key = sr + '|' + plan.key; return cache.has(key) || floatCache.has(key); }
export function putIRFloats(sr, plan, chans) { const key = sr + '|' + plan.key; if (!cache.has(key)) floatCache.set(key, chans); }

/** The impulse response samples for a plan (pure maths, no Web Audio). */
export function irFloats(sr, plan) {
  const b = BASE[plan.type] || BASE.hall, type = plan.type, size = plan.size, tone = plan.tone, pre = plan.pre;
  const rt = plan.rt, len = plan.len;
  const n = Math.round(len * sr), p = Math.round(pre * sr);
  const out = [new Float32Array(n + p), new Float32Array(n + p)];
  const damp = Math.min(1, Math.max(0, b.damp + (0.5 - tone) * 0.6));
  const lp0 = b.lp * Math.pow(2, (tone - 0.5) * 1.2);
  const k60 = -3 * Math.LN10 / (rt * sr);
  const swellN = Math.max(1, Math.round(b.swell * sr));
  const fadeN = Math.max(1, Math.round(Math.min(n * 0.25, plan.fade * sr)));

  for (let ch = 0; ch < 2; ch++) {
    const d = out[ch];
    const r = rng(1013 + ch * 7717 + type.length * 131);
    let lp = 0, lp2 = 0, hpState = 0, hpPrev = 0;
    const hpA = Math.exp(-2 * Math.PI * b.hp / sr);
    for (let i = 0; i < n; i++) {
      // time-varying low-pass: highs sink faster than lows (damp), like air and walls do
      const fc = Math.max(300, lp0 * Math.pow(2, -7 * damp * i / (rt * sr)));
      const a = 1 - Math.exp(-2 * Math.PI * fc / sr);
      const w = r() * 2 - 1;
      lp += a * (w - lp); lp2 += a * (lp - lp2);
      let e = Math.exp(k60 * i);
      if (i < swellN) e *= 0.5 - 0.5 * Math.cos(Math.PI * i / swellN);
      if (i >= n - fadeN) e *= 0.5 + 0.5 * Math.cos(Math.PI * (i - (n - fadeN)) / fadeN);
      let s = lp2 * e;
      // one-pole high-pass keeps the tail out of the low end
      const hp = hpA * (hpState + s - hpPrev); hpPrev = s; hpState = hp; s = hp;
      d[p + i] = s;
    }
    // early reflections: a few discrete taps, different per side
    if (b.er) {
      const span = (type === 'room' ? 0.045 : 0.09) * Math.min(1.5, size);
      for (let k = 0; k < b.er; k++) {
        const t = 0.004 + r() * span, idx = p + Math.round(t * sr);
        const g = (0.55 - 0.4 * (t / span)) * (r() < 0.5 ? -1 : 1) * 0.35;
        for (let j = 0; j < 24 && idx + j < d.length; j++) d[idx + j] += g * Math.exp(-j / 5) * (r() * 0.4 + 0.8) * 0.4 * Math.sqrt(sr / 44100);
      }
    }
    // spring: a train of falling chirps ("drips") every ~37/41 ms, decaying with the tail
    if (b.spring) {
      const T = (ch ? 0.041 : 0.037) * Math.sqrt(size), cl = Math.round(0.022 * sr);
      const env = Math.exp(-3 * Math.LN10 / rt * T);
      let amp = 0.9;
      for (let t = 0.012; t < len - 0.05; t += T, amp *= env) {
        const start = p + Math.round(t * sr);
        let ph = 0;
        for (let j = 0; j < cl && start + j < d.length; j++) {
          const u = j / cl, f = 3600 * Math.pow(250 / 3600, u);
          ph += 2 * Math.PI * f / sr;
          d[start + j] += Math.sin(ph) * Math.sin(Math.PI * u) * amp * 0.06;
        }
      }
      // gentle band-limit of the whole spring (two one-pole low-passes at ~4.8 kHz)
      const a = 1 - Math.exp(-2 * Math.PI * b.lp / sr); let y1 = 0, y2 = 0;
      for (let i = 0; i < d.length; i++) { y1 += a * (d[i] - y1); y2 += a * (y1 - y2); d[i] = y2; }
    }
    if (b.reverse) d.subarray(p).reverse();
  }
  // unit energy per channel
  for (let ch = 0; ch < 2; ch++) {
    const d = out[ch]; let e = 0;
    for (let i = 0; i < d.length; i++) e += d[i] * d[i];
    const g = e > 0 ? 1 / Math.sqrt(e) : 0;
    for (let i = 0; i < d.length; i++) d[i] *= g;
  }
  return out;
}
