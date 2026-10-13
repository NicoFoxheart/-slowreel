// Impulse responses for the rain reverbs. Generated once per (character, size, tone, sampleRate) and cached.
// Every IR is 4-channel ("true stereo": L->L, L->R, R->L, R->R) except the loop IRs used inside feedback
// (infinite / shimmer), which are 2-channel so each side's loop gain stays exactly bounded.
import { rng, clamp } from './util.js';

export const REVERB_TYPES = [
  { id: 'room',      name: 'Wet Room',     rt: 1.1, pre: 0.006, er: 12, erSpan: 0.045, bright: 9000, dampEnd: 2600, swell: 0.002 },
  { id: 'hall',      name: 'Hall',         rt: 3.2, pre: 0.02,  er: 9,  erSpan: 0.09,  bright: 7500, dampEnd: 1700, swell: 0.015 },
  { id: 'darkhall',  name: 'Dark Hall',    rt: 5.6, pre: 0.028, er: 7,  erSpan: 0.13,  bright: 4200, dampEnd: 650,  swell: 0.06 },
  { id: 'cathedral', name: 'Cathedral',    rt: 9.0, pre: 0.045, er: 6,  erSpan: 0.22,  bright: 5600, dampEnd: 800,  swell: 0.22 },
  { id: 'plate',     name: 'Night Plate',  rt: 2.6, pre: 0.0,   er: 0,  erSpan: 0,     bright: 10000, dampEnd: 3200, swell: 0.003 },
  { id: 'reverse',   name: 'Reverse',      rt: 2.4, pre: 0.0,   er: 0,  erSpan: 0,     bright: 6500, dampEnd: 1500, swell: 0.01, reverse: true },
];

const floatCache = new Map(); // key -> Float32Array[]
const bufCache = new WeakMap(); // ctx -> Map(key -> AudioBuffer)

function toBuffer(ctx, key, chans) {
  let m = bufCache.get(ctx);
  if (!m) { m = new Map(); bufCache.set(ctx, m); }
  let b = m.get(key);
  if (b) return b;
  b = ctx.createBuffer(chans.length, chans[0].length, ctx.sampleRate);
  chans.forEach((d, i) => b.copyToChannel(d, i));
  m.set(key, b);
  return b;
}

function normalize(chans, target) {
  // scale so the mean per-channel energy (sqrt of sum of squares) equals target
  let e = 0;
  for (const d of chans) { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; e += Math.sqrt(s); }
  e /= chans.length;
  const k = e > 0 ? target / e : 1;
  for (const d of chans) for (let i = 0; i < d.length; i++) d[i] *= k;
}

function oneChannel(len, sr, T, rt, bright, dampEnd, swell, preS, seed) {
  const d = new Float32Array(len);
  const r = rng(seed);
  let y = 0, hpPrev = 0, hpOut = 0;
  const hpA = Math.exp((-2 * Math.PI * 70) / sr); // gentle DC / rumble removal
  for (let i = preS; i < len; i++) {
    const t = (i - preS) / sr;
    const prog = Math.min(1, t / rt);
    const fc = bright * Math.pow(dampEnd / bright, prog);
    const a = Math.exp((-2 * Math.PI * fc) / sr);
    const n = r() * 2 - 1;
    y = (1 - a) * n + a * y;
    // one-pole highpass
    hpOut = hpA * (hpOut + y - hpPrev); hpPrev = y;
    const env = Math.pow(10, (-3 * t) / rt) * (1 - Math.exp(-t / Math.max(0.0005, swell)));
    d[i] = hpOut * env;
  }
  // early reflections
  if (T.er) {
    for (let k = 0; k < T.er; k++) {
      const tt = Math.pow(r(), 1.4) * T.erSpan + 0.002;
      const idx = preS + Math.floor(tt * sr);
      const amp = (0.55 - 0.35 * (tt / T.erSpan)) * (r() < 0.5 ? -1 : 1) * 0.02 * Math.sqrt(rt);
      for (let j = 0; j < 24 && idx + j < len; j++) d[idx + j] += amp * Math.exp(-j / 5);
    }
  }
  // fade the last 8% so the IR never ends abruptly
  const fl = Math.floor(len * 0.08);
  for (let i = 0; i < fl; i++) d[len - 1 - i] *= i / fl;
  return d;
}

// size 0..1 scales decay 0.5x..2x; tone 0..1 scales brightness 0.5x..2x
export function reverbIR(ctx, typeId, size = 0.5, tone = 0.5, width = 1) {
  const T = REVERB_TYPES.find(t => t.id === typeId) || REVERB_TYPES[2];
  const sq = Math.round(clamp(size, 0, 1) * 20) / 20, tq = Math.round(clamp(tone, 0, 1) * 10) / 10;
  const wq = Math.round(clamp(width, 0, 1) * 10) / 10;
  const sr = ctx.sampleRate;
  const key = `rv|${T.id}|${sq}|${tq}|${wq}|${sr}`;
  let chans = floatCache.get(key);
  if (!chans) {
    const rt = T.rt * Math.pow(2, (sq - 0.5) * 2);
    const tm = Math.pow(2, (tq - 0.5) * 2);
    const bright = Math.min(sr * 0.45, T.bright * tm), dampEnd = Math.min(bright, T.dampEnd * tm);
    const preS = Math.floor(T.pre * sr);
    const len = Math.floor(Math.min(22, rt * 1.15 + T.pre + 0.1) * sr);
    chans = [0, 1, 2, 3].map(c => oneChannel(len, sr, T, rt, bright, dampEnd, T.swell, preS, 1000 + c * 7919 + Math.round(rt * 100)));
    // width: blend the "same side" and "cross" responses toward each other
    if (wq < 1) {
      const w = wq;
      for (let i = 0; i < len; i++) {
        const [ll, lr, rl, rr] = [chans[0][i], chans[1][i], chans[2][i], chans[3][i]];
        const m1 = (ll + lr) / 2, m2 = (rl + rr) / 2;
        chans[0][i] = m1 + (ll - m1) * w; chans[1][i] = m1 + (lr - m1) * w;
        chans[2][i] = m2 + (rl - m2) * w; chans[3][i] = m2 + (rr - m2) * w;
      }
    }
    if (T.reverse) {
      for (const d of chans) {
        d.reverse();
        // let the swell finish with a short pre-silence removal so the peak lands right before the dry note
        const fade = Math.floor(0.02 * sr);
        for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
      }
    }
    // cross channels quieter than direct ones -> natural image, still fully blended
    for (let i = 0; i < len; i++) { chans[1][i] *= 0.82; chans[2][i] *= 0.82; }
    normalize(chans, 0.62);
    if (floatCache.size > 40) floatCache.delete(floatCache.keys().next().value);
    floatCache.set(key, chans);
  }
  return toBuffer(ctx, key, chans);
}

// Plain decaying 2-channel IR for the shimmer loop (energy normalized to 1 per channel).
export function loopHallIR(ctx, seconds = 3) {
  const sr = ctx.sampleRate;
  const key = `lh|${seconds}|${sr}`;
  let chans = floatCache.get(key);
  if (!chans) {
    const T = { er: 0 };
    const len = Math.floor(seconds * 1.1 * sr);
    chans = [0, 1].map(c => oneChannel(len, sr, T, seconds, 7000, 1500, 0.03, 0, 4242 + c * 31));
    normalize(chans, 1);
    floatCache.set(key, chans);
  }
  return toBuffer(ctx, key, chans);
}

// ---- Flat-magnitude ("allpass noise") IR for the infinite loop ------------------------------
// Random phase, |H(f)| = 1 at every frequency, so a feedback loop with gain g < 1 can never run away.
function fftInPlace(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

export function flatLoopIR(ctx) {
  const sr = ctx.sampleRate;
  const key = `flat|${sr}`;
  let chans = floatCache.get(key);
  if (!chans) {
    let n = 1; while (n < sr * 1.2) n <<= 1; // ~1.5 s at 44.1k / 48k
    chans = [0, 1].map(c => {
      const r = rng(9001 + c * 101);
      const re = new Float64Array(n), im = new Float64Array(n);
      re[0] = 1; re[n / 2] = r() < 0.5 ? 1 : -1;
      for (let k = 1; k < n / 2; k++) {
        const ph = r() * 2 * Math.PI;
        re[k] = Math.cos(ph); im[k] = Math.sin(ph);
        re[n - k] = re[k]; im[n - k] = -im[k];
      }
      fftInPlace(re, im, true);
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) d[i] = re[i] / n;
      return d;
    });
    normalize(chans, 1); // flat magnitude => |H| = 1 everywhere
    floatCache.set(key, chans);
  }
  return { buffer: toBuffer(ctx, key, chans), seconds: chans[0].length / sr };
}
