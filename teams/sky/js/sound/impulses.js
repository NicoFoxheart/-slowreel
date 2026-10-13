// impulses.js - the sky reverb spaces, made from shaped noise (no samples). Generated once per
// (sampleRate, character) and cached, so switching types is cheap after the first time.
//
// Each tail = decorrelated stereo noise x exponential decay (RT60 = `decay`), darkened over time by a
// one-pole low-pass whose cutoff sinks as the tail decays (`damping`), with a soft "bloom" onset (`bloom` s)
// so long spaces swell instead of slapping, a few early reflections for the stone rooms, zero DC and a
// faded end. Scaled to unit energy, so a send level means about the same loudness for every space.
import { rng } from './util.js';

export const SPACES = [
  { id: 'room',      name: 'Glass room',  seconds: 1.4, decay: 1.1, preDelay: 0.004, damping: 0.55, bloom: 0.004, early: 4 },
  { id: 'chapel',    name: 'Chapel',      seconds: 3.2, decay: 2.8, preDelay: 0.014, damping: 0.4,  bloom: 0.02,  early: 6 },
  { id: 'hall',      name: 'Hall',        seconds: 5.0, decay: 4.4, preDelay: 0.024, damping: 0.45, bloom: 0.04,  early: 6 },
  { id: 'cathedral', name: 'Cathedral',   seconds: 10,  decay: 8.5, preDelay: 0.04,  damping: 0.5,  bloom: 0.12,  early: 8 },
  { id: 'glass',     name: 'Glass hall',  seconds: 6.5, decay: 5.5, preDelay: 0.012, damping: 0.12, bloom: 0.05,  early: 0 },
  { id: 'cloud',     name: 'Cloud',       seconds: 7.5, decay: 6.5, preDelay: 0.09,  damping: 0.3,  bloom: 0.9,   early: 0 },
  { id: 'reverse',   name: 'Reverse',     seconds: 2.8, decay: 2.4, preDelay: 0.0,   damping: 0.35, bloom: 0.004, early: 0, reverse: true },
  { id: 'endless',   name: 'Endless sky', seconds: 14,  decay: 18,  preDelay: 0.05,  damping: 0.38, bloom: 0.3,   early: 0 },
];
export const spaceIndex = id => Math.max(0, SPACES.findIndex(s => s.id === id));

const cache = new Map();

/** @returns {AudioBuffer} stereo impulse response for the given space (index or id), scaled by `size` (0.5..1.5). */
export function spaceImpulse(ctx, which, size = 1) {
  const sp = typeof which === 'number' ? SPACES[Math.max(0, Math.min(SPACES.length - 1, Math.round(which)))] : (SPACES.find(s => s.id === which) || SPACES[3]);
  size = Math.round(Math.max(0.4, Math.min(1.6, size || 1)) * 10) / 10; // quantised: at most a few variants are cached
  const sr = ctx.sampleRate, key = `${sr}|${sp.id}|${size}`;
  if (cache.has(key)) return cache.get(key);

  const seconds = Math.min(18, sp.seconds * size), decay = sp.decay * size;
  const pre = Math.round(sp.preDelay * sr), n = Math.round(seconds * sr), len = pre + n;
  const buf = ctx.createBuffer(2, len, sr);
  const L = new Float32Array(n), R = new Float32Array(n), env = new Float32Array(n);
  const r = rng(sp.id.length * 977 + 31);
  const k60 = -3 * Math.LN10 / (decay * sr);
  const bloomN = Math.max(1, Math.round(sp.bloom * sr));
  const fadeN = Math.max(1, Math.min(Math.round(0.35 * sr), Math.round(n * 0.1)));
  const fStart = Math.min(16000, 0.42 * sr), oct = 6.5 * sp.damping;
  let yl = 0, yr = 0, y2l = 0, y2r = 0;
  for (let i = 0; i < n; i++) {
    const fc = Math.max(150, fStart * Math.pow(2, -oct * i / (decay * sr)));
    const a = 1 - Math.exp(-2 * Math.PI * fc / sr);
    yl += a * ((r() * 2 - 1) - yl); yr += a * ((r() * 2 - 1) - yr);
    y2l += a * (yl - y2l); y2r += a * (yr - y2r); // 2-pole: smoother, less fizzy top
    let e = Math.exp(k60 * i);
    if (i < bloomN) e *= Math.pow(Math.sin(0.5 * Math.PI * i / bloomN), 2);
    if (i >= n - fadeN) e *= 0.5 + 0.5 * Math.cos(Math.PI * (i - (n - fadeN)) / fadeN);
    env[i] = e; L[i] = y2l * e; R[i] = y2r * e;
  }
  // a few early reflections (stone / glass surfaces), alternating sides
  for (let k = 0; k < sp.early; k++) {
    const t = Math.round((0.007 + 0.011 * k + r() * 0.006) * sr * size);
    if (t >= n) break;
    const g = 0.5 * Math.exp(-k * 0.35) * (r() < 0.5 ? -1 : 1);
    (k % 2 ? R : L)[t] += g * 3; (k % 2 ? L : R)[Math.min(n - 1, t + Math.round(0.0013 * sr))] += g * 1.6;
  }
  // remove DC (shaped like the envelope), then unit energy
  let sl = 0, sr2 = 0, se = 0;
  for (let i = 0; i < n; i++) { sl += L[i]; sr2 += R[i]; se += env[i]; }
  const dl = sl / se, dr = sr2 / se;
  let el = 0, er = 0;
  for (let i = 0; i < n; i++) { L[i] -= dl * env[i]; R[i] -= dr * env[i]; el += L[i] * L[i]; er += R[i] * R[i]; }
  const scale = 1 / Math.sqrt(Math.max(1e-20, (el + er) / 2));
  if (sp.reverse) {
    L.reverse(); R.reverse();
    const f = Math.min(n, Math.round(0.006 * sr));
    for (let i = 0; i < f; i++) { const w = 0.5 + 0.5 * Math.cos(Math.PI * (i + 1) / f); L[n - f + i] *= w; R[n - f + i] *= w; }
  }
  const cl = buf.getChannelData(0), cr = buf.getChannelData(1);
  for (let i = 0; i < n; i++) { cl[pre + i] = L[i] * scale; cr[pre + i] = R[i] * scale; }
  if (cache.size > 24) cache.delete(cache.keys().next().value);
  cache.set(key, buf);
  return buf;
}
