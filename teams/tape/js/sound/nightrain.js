// nightrain.js - the grafted night-rain texture: rain on a window and a distant city hum, synthesized (no samples).
// Two seamless 12 s stereo loops per sample rate, generated once and cached:
//   'glass' - soft rain bed, dull drops tapping glass, a few slow runs of water
//   'city'  - far traffic wash, a faint mains hum, cars passing far away
// Each loop is scaled to RMS ~ -22 dBFS so the instrument can set levels predictably.
import { rng } from './util.js?v=10a';

const LOOP = 12, XF = 1;
const floats = new Map();            // `${kind}|${sr}` -> [Float32Array L, R]
const buffers = new WeakMap();       // ctx -> Map(key -> AudioBuffer)

const lp1 = (fc, sr) => { const a = Math.exp(-2 * Math.PI * fc / sr); let y = 0; return x => (y = (1 - a) * x + a * y); };
const hp1 = (fc, sr) => { const l = lp1(fc, sr); return x => x - l(x); };
function pink(r) { let b0 = 0, b1 = 0, b2 = 0; return () => { const w = r() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; return (b0 + b1 + b2 + w * 0.1848) * 0.2; }; }

function glass(L, R, sr, r) {
  const n = L.length;
  // the rain itself, heard through the window: pink, band-limited, slow swells
  const pl = pink(r), pr = pink(rng(77)), ha = hp1(300, sr), hb = hp1(300, sr), la = lp1(2400, sr), lb = lp1(2400, sr), la2 = lp1(3200, sr), lb2 = lp1(3200, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr, m = 1 + 0.22 * Math.sin(2 * Math.PI * t * 2 / LOOP) + 0.12 * Math.sin(2 * Math.PI * t * 3 / LOOP + 1.3);
    L[i] += la2(la(ha(pl()))) * 0.14 * m; R[i] += lb2(lb(hb(pr()))) * 0.14 * m;
  }
  // drops hitting the glass: a soft click plus a short, low "tock" resonance
  const count = Math.floor(26 * n / sr);
  for (let k = 0; k < count; k++) {
    const i0 = Math.floor(r() * n), a = 0.35 * Math.pow(r(), 2.2), pan = 0.15 + 0.7 * r();
    const gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    const f0 = 700 + r() * 1900, dec = 0.006 + r() * 0.03, len = Math.floor(sr * dec * 5);
    let ph = 0, prev = 0;
    for (let j = 0; j < len; j++) {
      const tt = j / sr, w = r() * 2 - 1;
      ph += 2 * Math.PI * f0 * (1 - 0.2 * Math.min(1, tt / dec)) / sr;
      const click = j < sr * 0.0015 ? (w - prev) * 0.5 * (1 - j / (sr * 0.0015)) : 0; prev = w;
      const s = (Math.sin(ph) * 0.6 + click) * Math.exp(-tt / dec) * a;
      const idx = (i0 + j) % n; L[idx] += s * gl; R[idx] += s * gr;
    }
  }
  // water running down the pane: slow, quiet, gurgling band of noise drifting in pitch
  for (let k = 0; k < 3; k++) {
    const start = Math.floor(r() * n), dur = Math.floor((2 + r() * 3) * sr), side = r(), f0 = 900 + r() * 900;
    let low = 0, band = 0;
    for (let j = 0; j < dur; j++) {
      const x = j / dur, env = Math.pow(Math.sin(Math.PI * x), 2) * 0.05, fc = f0 * (1 - 0.3 * x) * (1 + 0.15 * Math.sin(j / sr * 23));
      const f = 2 * Math.sin(Math.PI * fc / sr); low += f * band; const high = (r() * 2 - 1) - low - 0.12 * band; band += f * high;
      const idx = (start + j) % n, s = band * env;
      L[idx] += s * (1 - side * 0.6); R[idx] += s * (0.4 + side * 0.6);
    }
  }
}

function city(L, R, sr, r) {
  const n = L.length;
  // far traffic: brown-ish rumble kept above 55 Hz so it never muddies the low end
  const l1 = lp1(320, sr), l2 = lp1(320, sr), h1 = hp1(55, sr), h2 = hp1(55, sr), h1b = hp1(55, sr), h2b = hp1(55, sr);
  let bl = 0, br = 0;
  for (let i = 0; i < n; i++) {
    bl = 0.996 * bl + (r() * 2 - 1) * 0.08; br = 0.996 * br + (r() * 2 - 1) * 0.08;
    L[i] += h1b(h1(l1(bl))) * 0.6; R[i] += h2b(h2(l2(br))) * 0.6;
  }
  // a faint electrical hum far away (soft harmonics of 60 Hz, mostly 120 / 180 Hz so it is felt, not boomy)
  for (let i = 0; i < n; i++) {
    const t = i / sr, w = 2 * Math.PI * 60 * t, s = (Math.sin(2 * w) * 0.010 + Math.sin(3 * w + 0.4) * 0.006 + Math.sin(5 * w + 1.1) * 0.002) * (0.85 + 0.15 * Math.sin(2 * Math.PI * t / LOOP));
    L[i] += s; R[i] += s * 0.9;
  }
  // cars passing far off, left to right or right to left
  for (let c = 0; c < 3; c++) {
    const start = Math.floor(r() * n), dur = Math.floor((5 + r() * 4) * sr), dir = r() < 0.5, amp = 0.05 + r() * 0.05, f = lp1(420 + r() * 500, sr), h = hp1(110, sr);
    for (let j = 0; j < dur; j++) {
      const x = j / dur, env = Math.pow(Math.sin(Math.PI * x), 3), pan = dir ? x : 1 - x, s = h(f(r() * 2 - 1)) * env * amp;
      const idx = (start + j) % n; L[idx] += s * Math.cos(pan * Math.PI / 2); R[idx] += s * Math.sin(pan * Math.PI / 2);
    }
  }
}

const GEN = { glass, city };

/** The loop samples for one kind at one sample rate (pure maths, about 0.3 s per kind: made ahead of time by assets.js). */
export function nightFloats(kind = 'glass', sr = 44100) {
  const n = Math.floor(LOOP * sr), total = Math.floor((LOOP + XF) * sr), xf = total - n;
  const L = new Float32Array(total), R = new Float32Array(total);
  (GEN[kind] || glass)(L, R, sr, rng(kind === 'city' ? 9101 : 5303));
  const oL = L.slice(0, n), oR = R.slice(0, n);
  for (let i = 0; i < xf; i++) { const a = i / xf, gi = Math.sin(a * Math.PI / 2), go = Math.cos(a * Math.PI / 2); oL[i] = L[i] * gi + L[n + i] * go; oR[i] = R[i] * gi + R[n + i] * go; }
  let e = 0; for (let i = 0; i < n; i++) e += oL[i] * oL[i] + oR[i] * oR[i];
  const g = 0.079 / (Math.sqrt(e / (2 * n)) || 1);
  for (let i = 0; i < n; i++) { oL[i] = Math.max(-0.7, Math.min(0.7, oL[i] * g)); oR[i] = Math.max(-0.7, Math.min(0.7, oR[i] * g)); }
  return [oL, oR];
}
export const hasNightFloats = (kind, sr) => floats.has(kind + '|' + sr);
export function putNightFloats(kind, sr, chans) { floats.set(kind + '|' + sr, chans); }

/** The loop as an AudioBuffer for this context, or null when its samples are not made yet (never computes on the play path). */
export function nightBufferIfReady(ctx, kind = 'glass') {
  const key = kind + '|' + ctx.sampleRate;
  return floats.has(key) || buffers.get(ctx)?.has(key) ? nightBuffer(ctx, kind) : null;
}

export function nightBuffer(ctx, kind = 'glass') {
  const sr = ctx.sampleRate, key = kind + '|' + sr;
  let m = buffers.get(ctx); if (!m) { m = new Map(); buffers.set(ctx, m); }
  let b = m.get(key);
  if (!b) {
    let ch = floats.get(key);
    if (!ch) { ch = nightFloats(kind, sr); floats.set(key, ch); }
    b = ctx.createBuffer(2, ch[0].length, sr); b.copyToChannel(ch[0], 0); b.copyToChannel(ch[1], 1); m.set(key, b);
  }
  return b;
}
