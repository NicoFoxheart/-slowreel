// Procedural night textures (no samples): rain, rain on glass, heavy rain, vinyl, night city, wind, distant thunder.
// Each is a seamless 12 s stereo loop, generated once per sample rate and cached.
import { rng } from './util.js';

export const TEXTURES = [
  { id: 'rain', name: 'Soft rain' },
  { id: 'window', name: 'Rain on glass' },
  { id: 'heavy', name: 'Heavy rain' },
  { id: 'vinyl', name: 'Vinyl crackle' },
  { id: 'city', name: 'Night city' },
  { id: 'wind', name: 'Night wind' },
  { id: 'thunder', name: 'Distant thunder' },
];

const LOOP = 12, XF = 1;
const floatCache = new Map();
const bufCache = new WeakMap();

function pinkish(r) {
  // Paul Kellet's economy pink filter state machine
  let b0 = 0, b1 = 0, b2 = 0;
  return () => { const w = r() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; return (b0 + b1 + b2 + w * 0.1848) * 0.2; };
}
function onePoleLP(fc, sr) { const a = Math.exp(-2 * Math.PI * fc / sr); let y = 0; return x => (y = (1 - a) * x + a * y); }
function onePoleHP(fc, sr) { const lp = onePoleLP(fc, sr); return x => x - lp(x); }

function addDrops(L, R, sr, r, { rate, amp, lo, hi, tick = 0.5, decayMs = [8, 30] }) {
  const n = L.length, count = Math.floor(rate * n / sr);
  for (let k = 0; k < count; k++) {
    const i0 = Math.floor(r() * n), a = amp * Math.pow(r(), 2.6), pan = r();
    const gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    if (r() < tick) {
      // a short bright tick
      const len = Math.floor(sr * (0.002 + r() * 0.004)); let prev = 0;
      for (let j = 0; j < len && i0 + j < n; j++) { const w = r() * 2 - 1, s = (w - prev) * Math.exp(-j / (len / 4)) * a; prev = w; L[i0 + j] += s * gl; R[i0 + j] += s * gr; }
    } else {
      // a small "plink": decaying, slightly falling sine
      const f0 = lo + (hi - lo) * r(), dec = (decayMs[0] + r() * (decayMs[1] - decayMs[0])) / 1000, len = Math.floor(sr * dec * 5);
      let ph = 0;
      for (let j = 0; j < len && i0 + j < n; j++) { const tt = j / sr, f = f0 * (1 - 0.25 * Math.min(1, tt / dec)); ph += 2 * Math.PI * f / sr; const s = Math.sin(ph) * Math.exp(-tt / dec) * a * 0.6; L[i0 + j] += s * gl; R[i0 + j] += s * gr; }
    }
  }
}

function bed(L, R, sr, r, { level, hp, lp, gust = 0 }) {
  const pl = pinkish(r), pr = pinkish(rng(Math.floor(r() * 1e9))), h1 = onePoleHP(hp, sr), h2 = onePoleHP(hp, sr), l1 = onePoleLP(lp, sr), l2 = onePoleLP(lp, sr);
  const g1 = r() * 6, g2 = r() * 6;
  for (let i = 0; i < L.length; i++) {
    const t = i / sr, m = 1 + gust * (0.5 * Math.sin(2 * Math.PI * t / LOOP * 2 + g1) + 0.3 * Math.sin(2 * Math.PI * t / LOOP * 3 + g2));
    L[i] += l1(h1(pl())) * level * m; R[i] += l2(h2(pr())) * level * m;
  }
}

const GEN = {
  rain(L, R, sr, r) { bed(L, R, sr, r, { level: 0.22, hp: 500, lp: 7000, gust: 0.25 }); addDrops(L, R, sr, r, { rate: 90, amp: 0.22, lo: 1800, hi: 5200, tick: 0.55 }); },
  window(L, R, sr, r) { bed(L, R, sr, r, { level: 0.1, hp: 250, lp: 2600, gust: 0.3 }); addDrops(L, R, sr, r, { rate: 32, amp: 0.45, lo: 900, hi: 3200, tick: 0.35, decayMs: [10, 45] }); },
  heavy(L, R, sr, r) { bed(L, R, sr, r, { level: 0.4, hp: 300, lp: 9000, gust: 0.35 }); addDrops(L, R, sr, r, { rate: 180, amp: 0.2, lo: 1500, hi: 6000, tick: 0.65 }); },
  vinyl(L, R, sr, r) {
    const h = onePoleHP(2500, sr), h2 = onePoleHP(2500, sr);
    for (let i = 0; i < L.length; i++) { L[i] += h(r() * 2 - 1) * 0.012; R[i] += h2(r() * 2 - 1) * 0.012; }
    const n = L.length, pops = Math.floor(28 * n / sr);
    for (let k = 0; k < pops; k++) {
      const i0 = Math.floor(r() * n), a = (r() < 0.06 ? 0.7 : 0.25) * Math.pow(r(), 3), len = 2 + Math.floor(r() * 10), side = r();
      for (let j = 0; j < len && i0 + j < n; j++) { const s = (r() * 2 - 1) * a * Math.exp(-j / 3); L[i0 + j] += s * (0.6 + 0.4 * side); R[i0 + j] += s * (1 - 0.4 * side); }
    }
  },
  city(L, R, sr, r) {
    // distant traffic wash (brown-ish), a few cars passing left to right, high air
    const l1 = onePoleLP(380, sr), l2 = onePoleLP(380, sr), hpA = onePoleHP(70, sr), hpB = onePoleHP(70, sr);
    let bl = 0, br = 0;
    for (let i = 0; i < L.length; i++) { bl = 0.995 * bl + (r() * 2 - 1) * 0.1; br = 0.995 * br + (r() * 2 - 1) * 0.1; L[i] += hpA(l1(bl)) * 0.55; R[i] += hpB(l2(br)) * 0.55; }
    const n = L.length;
    for (let c = 0; c < 4; c++) {
      const start = Math.floor(r() * n), dur = (4 + r() * 4) * sr, dir = r() < 0.5 ? 1 : -1, amp = 0.05 + r() * 0.07, f = onePoleLP(500 + r() * 700, sr), hh = onePoleHP(120, sr);
      for (let j = 0; j < dur; j++) {
        const i = (start + j) % n, x = j / dur, env = Math.pow(Math.sin(Math.PI * x), 2), pan = dir > 0 ? x : 1 - x;
        const s = hh(f(r() * 2 - 1)) * env * amp;
        L[i] += s * Math.cos(pan * Math.PI / 2); R[i] += s * Math.sin(pan * Math.PI / 2);
      }
    }
    const a1 = onePoleHP(4000, sr), a2 = onePoleHP(4000, sr);
    for (let i = 0; i < n; i++) { L[i] += a1(r() * 2 - 1) * 0.004; R[i] += a2(r() * 2 - 1) * 0.004; }
  },
  wind(L, R, sr, r) {
    for (const [D, ph] of [[L, r() * 6], [R, r() * 6]]) {
      let low = 0, band = 0; const lp = onePoleLP(5000, sr);
      for (let i = 0; i < D.length; i++) {
        const t = i / sr, k = 2 * Math.PI / LOOP;
        const fc = 380 + 260 * Math.sin(k * t + ph) + 140 * Math.sin(3 * k * t + ph * 2), q = 0.18;
        const f = 2 * Math.sin(Math.PI * fc / sr);
        const x = lp(r() * 2 - 1); low += f * band; const high = x - low - q * band; band += f * high;
        const g = 0.55 + 0.45 * Math.sin(2 * k * t + ph * 3);
        D[i] += band * 0.25 * g;
      }
    }
  },
  thunder(L, R, sr, r) {
    bed(L, R, sr, r, { level: 0.08, hp: 600, lp: 5000, gust: 0.2 });
    addDrops(L, R, sr, r, { rate: 30, amp: 0.12, lo: 2000, hi: 5000, tick: 0.6 });
    const n = L.length, start = Math.floor(n * 0.3), dur = Math.floor(6 * sr), lp1 = onePoleLP(180, sr), lp2 = onePoleLP(140, sr), hp = onePoleHP(38, sr), hp2 = onePoleHP(38, sr);
    let b = 0;
    for (let j = 0; j < dur; j++) {
      const t = j / sr, env = (1 - Math.exp(-t / 0.35)) * Math.exp(-t / 1.6) * (1 + 0.6 * Math.sin(t * 7 + r() * 0.2));
      b = 0.99 * b + (r() * 2 - 1) * 0.12;
      const s = env * 1.4, i = (start + j) % n;
      L[i] += hp(lp1(b)) * s; R[i] += hp2(lp2(b)) * s * 0.9;
    }
  },
};

export function textureBuffer(ctx, id) {
  const sr = ctx.sampleRate, key = `${id}|${sr}`;
  let chans = floatCache.get(key);
  if (!chans) {
    const gen = GEN[id] || GEN.rain;
    const total = Math.floor((LOOP + XF) * sr), n = Math.floor(LOOP * sr), xf = total - n;
    const L = new Float32Array(total), R = new Float32Array(total);
    gen(L, R, sr, rng(4000 + id.length * 97 + id.charCodeAt(0)));
    // seamless loop: fold the extra second over the start with an equal-power crossfade
    const oL = new Float32Array(n), oR = new Float32Array(n);
    for (let i = 0; i < n; i++) { oL[i] = L[i]; oR[i] = R[i]; }
    for (let i = 0; i < xf; i++) { const a = i / xf, gi = Math.sin(a * Math.PI / 2), go = Math.cos(a * Math.PI / 2); oL[i] = L[i] * gi + L[n + i] * go; oR[i] = R[i] * gi + R[n + i] * go; }
    // normalize to a calm, known level (RMS ~ -20 dBFS)
    let s = 0; for (let i = 0; i < n; i++) s += oL[i] * oL[i] + oR[i] * oR[i];
    const rms = Math.sqrt(s / (2 * n)) || 1, k = 0.1 / rms;
    let pk = 0; for (let i = 0; i < n; i++) { oL[i] *= k; oR[i] *= k; pk = Math.max(pk, Math.abs(oL[i]), Math.abs(oR[i])); }
    if (pk > 0.9) { const m = 0.9 / pk; for (let i = 0; i < n; i++) { oL[i] *= m; oR[i] *= m; } }
    chans = [oL, oR];
    floatCache.set(key, chans);
  }
  let m = bufCache.get(ctx); if (!m) { m = new Map(); bufCache.set(ctx, m); }
  let b = m.get(key);
  if (!b) { b = ctx.createBuffer(2, chans[0].length, sr); b.copyToChannel(chans[0], 0); b.copyToChannel(chans[1], 1); m.set(key, b); }
  return b;
}
