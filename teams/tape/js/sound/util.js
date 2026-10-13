// util.js - small helpers shared by the tape sound engine (no DOM, works in AudioContext and OfflineAudioContext).

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const dbToGain = db => (db <= -120 ? 0 : Math.pow(10, db / 20));
export const gainToDb = g => (g <= 1e-6 ? -120 : 20 * Math.log10(g));
export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
export const lerp = (a, b, t) => a + (b - a) * t;
export const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

// Deterministic random so offline renders are repeatable.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Per-context caches (noise buffers, curves, periodic waves).
const ctxCache = new WeakMap();
export function cacheFor(ctx) {
  let c = ctxCache.get(ctx);
  if (!c) { c = new Map(); ctxCache.set(ctx, c); }
  return c;
}
export function cached(ctx, key, make) {
  const c = cacheFor(ctx);
  if (!c.has(key)) c.set(key, make());
  return c.get(key);
}

// Noise buffers: 'white', 'pink', 'brown', 'crackle' (sparse vinyl clicks), stereo, loopable, 6 s.
// The samples are computed once per (type, length, sample rate) and shared by every context (live, offline renders,
// the asset worker); each context only copies them into its own AudioBuffer (fast, no maths on the play path).
const noiseCache = new Map();   // `${type}|${seconds}|${sr}` -> [Float32Array L, Float32Array R]
export const noiseKey = (type, seconds, sr) => type + '|' + seconds + '|' + sr;
export function hasNoiseFloats(type, seconds, sr) { return noiseCache.has(noiseKey(type, seconds, sr)); }
export function putNoiseFloats(type, seconds, sr, chans) { noiseCache.set(noiseKey(type, seconds, sr), chans); }
export function noiseBuffer(ctx, type = 'white', seconds = 6) {
  return cached(ctx, 'noise:' + type + ':' + seconds, () => {
    const sr = ctx.sampleRate, key = noiseKey(type, seconds, sr);
    let ch = noiseCache.get(key);
    if (!ch) { ch = noiseFloats(type, seconds, sr); noiseCache.set(key, ch); }
    const buf = ctx.createBuffer(2, ch[0].length, sr);
    buf.copyToChannel(ch[0], 0); buf.copyToChannel(ch[1], 1);
    return buf;
  });
}
/** The raw noise samples (pure maths, no Web Audio: also runs in the asset worker). */
export function noiseFloats(type = 'white', seconds = 6, sr = 44100) {
  const n = Math.round(sr * seconds), out = [];
  {
    for (let ch = 0; ch < 2; ch++) {
      const d = new Float32Array(n), r = rng(97 + ch * 31 + type.length * 7); out.push(d);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < n; i++) {
        const w = r() * 2 - 1;
        if (type === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        } else if (type === 'brown') {
          last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5;
        } else if (type === 'crackle') {
          const p = r();
          if (p < 0.0009) { last = (r() * 2 - 1) * (0.3 + 0.7 * r()); } else last *= 0.55;
          d[i] = last + w * 0.004;
        } else d[i] = w * 0.5;
      }
      // seamless loop: short crossfade of the end into the start
      const f = Math.round(sr * 0.05);
      for (let i = 0; i < f; i++) { const t = i / f; d[n - f + i] = d[n - f + i] * (1 - t) + d[i] * t; }
    }
  }
  return out;
}

// Soft saturation curve: tanh(x*g)/g, so small signals pass at exactly unity gain (safe inside feedback loops)
// and louder ones are squeezed more as drive (g) rises.
export function satCurve(ctx, drive = 1) {
  const k = Math.round(drive * 20) / 20;
  return cached(ctx, 'sat2:' + k, () => {
    const n = 2049, c = new Float32Array(n), g = Math.max(0.05, k);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * g) / g; }
    return c;
  });
}

// Safety clip: linear below `knee`, smoothly approaches `ceil` (never exceeds it).
export function safetyCurve(ctx, ceil = 0.891, knee = 0.75) {
  return cached(ctx, 'safety:' + ceil + ':' + knee, () => {
    const n = 8192, c = new Float32Array(n), span = ceil - knee;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
      const y = a <= knee ? a : knee + span * Math.tanh((a - knee) / span);
      c[i] = Math.sign(x) * y;
    }
    return c;
  });
}

// Hann window curve for grains.
export function hannCurve(ctx, n = 128) {
  return cached(ctx, 'hann:' + n, () => { const c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = Math.sin(Math.PI * i / (n - 1)) ** 2; return c; });
}

// Periodic waves from harmonic amplitude lists.
export function wave(ctx, key, amps) {
  return cached(ctx, 'wave:' + key, () => {
    const re = new Float32Array(amps.length + 1), im = new Float32Array(amps.length + 1);
    amps.forEach((a, i) => { im[i + 1] = a; });
    return ctx.createPeriodicWave(re, im);
  });
}

// Exponential-ish ADSR on an AudioParam. Returns the time the attack+decay phase ends.
export function adsr(param, t, { a = 0.01, d = 0.3, s = 0.7, peak = 1 }) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + Math.max(0.002, a));
  param.setTargetAtTime(peak * s, t + a, Math.max(0.005, d / 3));
  return t + a + d;
}
// Release from whatever the current value is (uses setTargetAtTime so it is click-free).
export function release(param, t, r = 0.5) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t); else param.cancelScheduledValues(t);
  param.setTargetAtTime(0, t, Math.max(0.005, r / 4));
}

// k-rate automation for oscillator pitch and filter params: one value per 128-sample block (2.9 ms) instead of one per
// sample. Chromium otherwise recomputes filter coefficients / pitch per sample whenever a param has an LFO input or a
// lingering setTarget envelope (5x the cost for an LFO'd filter). Our pitch wobbles, vibratos and filter sweeps are all
// far slower than 2.9 ms, so this sounds the same. Gains (envelopes) and delay times (tape wow) stay a-rate.
export function krate(...params) { for (const p of params) { if (p && 'automationRate' in p) { try { p.automationRate = 'k-rate'; } catch (e) { } } } }
export const krateFilter = b => (krate(b.frequency, b.detune, b.Q, b.gain), b);

export function disconnectAll(...nodes) { for (const n of nodes) { try { n && n.disconnect(); } catch (e) { /* already gone */ } } }

// Smooth param set: t === 0 means "initial value, set it now"; otherwise glide with time constant tc.
export function sp(param, v, t, tc = 0.03) {
  if (!isFinite(v)) return;
  if (!t) { param.cancelScheduledValues(0); param.value = v; } else param.setTargetAtTime(v, t, tc);
}
