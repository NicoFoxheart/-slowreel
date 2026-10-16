// features.js - what the heart listens to. One set of numbers per video frame, all 0..~1.2:
//   pulse (low end, beat-weighted: heart scale), low (bass level: halo), mid / high (colour breathing, rim, sparks),
//   level (overall), slow (3 s energy: camera), accent (onset envelope: ear twitch).
// computeFeatures() reads a whole AudioBuffer offline (deterministic, normalised per song so quiet ambient mixes still move
// the heart, time-sliced so the page never freezes). createLiveFeatures() does the same from an AnalyserNode for the preview.

const N = 2048, BANDS = { low: [30, 160], mid: [160, 2500], high: [2500, 12000] }, FLUX = [160, 10000];
let fftTables = null;
function tables() {
  if (fftTables) return fftTables;
  const rev = new Uint32Array(N), bits = Math.log2(N);
  for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const cos = new Float32Array(N / 2), sin = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos(-2 * Math.PI * i / N); sin[i] = Math.sin(-2 * Math.PI * i / N); }
  const hann = new Float32Array(N); for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  return (fftTables = { rev, cos, sin, hann });
}
function fft(re, im) {
  const { rev, cos, sin } = tables();
  for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let i = 0; i < N; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
      const a = i + j, b = a + half, tr = re[b] * cos[k] - im[b] * sin[k], ti = re[b] * sin[k] + im[b] * cos[k];
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}
const binRange = (sr, [lo, hi]) => [Math.max(1, Math.round(lo * N / sr)), Math.min(N / 2 - 1, Math.round(hi * N / sr))];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const coef = (fps, sec) => 1 - Math.exp(-1 / (fps * sec));
const yieldTask = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
function percentile(arr, p) { const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(a.length * p))] || 0; }
function movingAvg(a, w) {
  const n = a.length, out = new Float32Array(n), pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
  for (let i = 0; i < n; i++) { const lo = Math.max(0, i - w), hi = Math.min(n, i + w + 1); out[i] = (pre[hi] - pre[lo]) / (hi - lo); }
  return out;
}

/** Offline: AudioBuffer -> {fps, frames, pulse, low, mid, high, level, slow, accent} (Float32Arrays, one value per frame). */
export async function computeFeatures(buffer, { fps = 30, seconds, signal, onProgress, budgetMs = 24 } = {}) {
  const sr = buffer.sampleRate, len = Math.min(buffer.length, Math.round((seconds || buffer.duration) * sr));
  const frames = Math.max(1, Math.round(len / sr * fps)), hop = sr / fps;
  const L = buffer.getChannelData(0), R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const { hann } = tables(), re = new Float32Array(N), im = new Float32Array(N), prevLog = new Float32Array(N / 2);
  const bLow = binRange(sr, BANDS.low), bMid = binRange(sr, BANDS.mid), bHigh = binRange(sr, BANDS.high), bFlux = binRange(sr, FLUX);
  const raw = { low: new Float32Array(frames), mid: new Float32Array(frames), high: new Float32Array(frames), level: new Float32Array(frames), flux: new Float32Array(frames) };
  const band = ([a, b]) => { let s = 0; for (let k = a; k <= b; k++) s += re[k] * re[k] + im[k] * im[k]; return Math.sqrt(s / (b - a + 1)); };
  let t0 = performance.now();
  for (let f = 0; f < frames; f++) {
    const c = Math.round(f * hop) - N / 2;
    let e = 0;
    for (let i = 0; i < N; i++) { const j = c + i, v = j >= 0 && j < len ? (L[j] + R[j]) * 0.5 : 0; e += v * v; re[i] = v * hann[i]; im[i] = 0; }
    fft(re, im);
    raw.low[f] = band(bLow); raw.mid[f] = band(bMid); raw.high[f] = band(bHigh); raw.level[f] = Math.sqrt(e / N);
    let fl = 0;
    for (let k = bFlux[0]; k <= bFlux[1]; k++) { const m = Math.log1p(60 * Math.sqrt(re[k] * re[k] + im[k] * im[k])); if (m > prevLog[k]) fl += m - prevLog[k]; prevLog[k] = m; }
    raw.flux[f] = fl;
    if (performance.now() - t0 > budgetMs) {
      onProgress?.(f / frames);
      await yieldTask(); t0 = performance.now();
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    }
  }
  return shape(raw, frames, fps);
}

// normalise per song (95th percentile), add envelopes and onsets. Pure function of the raw numbers -> deterministic.
function shape(raw, frames, fps) {
  const norm = {};
  for (const k of ['low', 'mid', 'high', 'level', 'flux']) {
    const a = raw[k], p = Math.max(percentile(a, 0.95), k === 'flux' ? 1e-3 : 1e-5), o = new Float32Array(frames);
    for (let i = 0; i < frames; i++) o[i] = clamp(a[i] / p, 0, 1.3);
    norm[k] = o;
  }
  const lowAvg = movingAvg(norm.low, Math.round(fps * 0.75)), fluxAvg = movingAvg(norm.flux, Math.round(fps * 0.75));
  const out = { fps, frames, pulse: new Float32Array(frames), low: new Float32Array(frames), mid: new Float32Array(frames), high: new Float32Array(frames),
    level: new Float32Array(frames), slow: new Float32Array(frames), accent: new Float32Array(frames), onsets: 0 };
  const env = { low: 0, rel: 0, mid: 0, high: 0, level: 0, slow: 0, acc: 0 };
  const C = { la: coef(fps, 0.04), lr: coef(fps, 0.32), ma: coef(fps, 0.15), mr: coef(fps, 0.8), ha: coef(fps, 0.05), hr: coef(fps, 0.35), va: coef(fps, 0.1), vr: coef(fps, 0.5), s: coef(fps, 3) };
  const accDecay = Math.exp(-1 / (fps * 0.17)), refractory = Math.round(fps * 0.22);
  const follow = (cur, x, a, r) => cur + (x - cur) * (x > cur ? a : r);
  let last = -1e9;
  for (let i = 0; i < frames; i++) {
    env.low = follow(env.low, norm.low[i], C.la, C.lr);
    env.rel = follow(env.rel, Math.max(0, norm.low[i] - lowAvg[i] * 0.85) * 2.2, C.la, C.lr);
    env.mid = follow(env.mid, norm.mid[i], C.ma, C.mr);
    env.high = follow(env.high, norm.high[i], C.ha, C.hr);
    env.level = follow(env.level, norm.level[i], C.va, C.vr);
    env.slow += (norm.level[i] - env.slow) * C.s;
    env.acc *= accDecay;
    const fx = norm.flux[i];
    if (fx > fluxAvg[i] * 1.45 + 0.22 && fx >= (norm.flux[i - 1] || 0) && fx >= (norm.flux[i + 1] || 0) && i - last >= refractory) {
      env.acc = Math.max(env.acc, clamp((fx - fluxAvg[i]) / 1.2, 0.35, 1)); last = i; out.onsets++;
    }
    out.pulse[i] = clamp(env.low * 0.55 + env.rel * 0.8, 0, 1.25); out.low[i] = env.low; out.mid[i] = env.mid; out.high[i] = env.high;
    out.level[i] = env.level; out.slow[i] = env.slow; out.accent[i] = env.acc;
  }
  return out;
}

/** The numbers for one frame (index clamped). */
export function frameAt(F, i) {
  i = clamp(i | 0, 0, F.frames - 1);
  return { pulse: F.pulse[i], low: F.low[i], mid: F.mid[i], high: F.high[i], level: F.level[i], slow: F.slow[i], accent: F.accent[i], accentLag: F.accent[Math.max(0, i - 3)] };
}

/** A calm breathing heart when nothing plays. */
export function idleFeatures(t) {
  const b = Math.pow(Math.max(0, Math.sin(t * 1.9)), 10);
  return { pulse: 0.18 + b * 0.35, low: 0.25 + b * 0.2, mid: 0.3 + 0.12 * Math.sin(t * 0.4), high: 0.25 + 0.1 * Math.sin(t * 0.63 + 1), level: 0.3, slow: 0.3, accent: 0, accentLag: 0 };
}

/** Live: an AnalyserNode -> the same kind of numbers, per animation frame (dt in seconds). */
export function createLiveFeatures(analyser) {
  const n = analyser.frequencyBinCount, db = new Float32Array(n), prev = new Float32Array(n), sr = analyser.context.sampleRate, fftN = n * 2;
  const rng = ([a, b]) => [Math.max(1, Math.round(a * fftN / sr)), Math.min(n - 1, Math.round(b * fftN / sr))];
  const R = { low: rng(BANDS.low), mid: rng(BANDS.mid), high: rng(BANDS.high), flux: rng(FLUX) };
  const peak = { low: 1e-4, mid: 1e-4, high: 1e-4, level: 1e-4, flux: 1e-2 };
  const st = { pulse: 0, low: 0, mid: 0, high: 0, level: 0, slow: 0, accent: 0, accentLag: 0, avgLow: 0, avgFlux: 0, since: 1 };
  const lag = [];
  return {
    update(dt) {
      dt = clamp(dt || 1 / 30, 1 / 120, 0.1);
      analyser.getFloatFrequencyData(db);
      const band = ([a, b]) => { let s = 0; for (let k = a; k <= b; k++) { const m = Math.pow(10, db[k] / 20); s += m * m; } return Math.sqrt(s / (b - a + 1)); };
      const x = { low: band(R.low), mid: band(R.mid), high: band(R.high), level: band([1, n - 1]) };
      let fl = 0; for (let k = R.flux[0]; k <= R.flux[1]; k++) { const m = Math.log1p(60 * Math.pow(10, db[k] / 20)); if (m > prev[k]) fl += m - prev[k]; prev[k] = m; }
      x.flux = fl;
      const nv = {};
      for (const k in x) { peak[k] = Math.max(x[k], peak[k] * Math.exp(-dt / 10)); nv[k] = clamp(x[k] / Math.max(peak[k] * 0.8, k === 'flux' ? 0.5 : 1e-4), 0, 1.3); }
      const c = s => 1 - Math.exp(-dt / s), f = (cur, v, a, r) => cur + (v - cur) * (v > cur ? c(a) : c(r));
      st.avgLow += (nv.low - st.avgLow) * c(0.75); st.avgFlux += (nv.flux - st.avgFlux) * c(0.75);
      st.low = f(st.low, nv.low, 0.04, 0.32); st.mid = f(st.mid, nv.mid, 0.15, 0.8); st.high = f(st.high, nv.high, 0.05, 0.35);
      st.level = f(st.level, nv.level, 0.1, 0.5); st.slow += (nv.level - st.slow) * c(3);
      st.rel = f(st.rel || 0, Math.max(0, nv.low - st.avgLow * 0.85) * 2.2, 0.04, 0.32);
      st.pulse = clamp(st.low * 0.55 + st.rel * 0.8, 0, 1.25);
      st.accent *= Math.exp(-dt / 0.17); st.since += dt;
      if (nv.flux > st.avgFlux * 1.45 + 0.22 && st.since > 0.22) { st.accent = Math.max(st.accent, clamp((nv.flux - st.avgFlux) / 1.2, 0.35, 1)); st.since = 0; }
      lag.push(st.accent); if (lag.length > 3) st.accentLag = lag.shift();
      return st;
    },
  };
}
