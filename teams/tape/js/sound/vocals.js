// vocals.js - Slowreel "Voices" pack: synthesized female voices for dreamy ambient / future garage (Antent-style "ooh / aah"
// pads and pitched vocal chops). Everything is formant synthesis with native Web Audio nodes (no samples, no worklets):
//
//   glottal source  : band-limited PeriodicWaves built from a glottal-pulse spectrum (spectral tilt, a breathy H1 boost),
//                     a soft and a bright source cross-faded by velocity / swell (louder = brighter, as in a real voice)
//   breath          : white noise, pulsed by the glottal source (aspiration that fuses with the tone), fed through the
//                     same vocal tract, plus a little high "air" past the lips
//   vocal tract     : a Klatt-style CASCADE of 5 resonators (biquad lowpass = 2-pole resonator with unity gain at DC,
//                     Q = F/B) with real adult-female formant frequencies and bandwidths per vowel, plus a nasal zero for
//                     "mm". A cascade gets the relative formant levels right by itself and morphs vowels without the
//                     phase holes of parallel band-passes. Sopranos' F1 tracks the pitch on high notes (formant tuning).
//   pitch           : one cents bus per voice (glide / scoop / fall / jitter) + per-singer vibrato with delayed onset
//   level           : each note's gain is computed from the cascade's response at the note's harmonics, so every vowel
//                     and pitch sits at the same loudness (a few hundred multiply-adds, no buffers at note start)
//
// Same definition format as instruments.js: {id, name, kind, maxVoices, params:[...], macros:[ids], presets:[{id,name,params}],
// voice(ctx, env, P, midi, vel, t)} -> voice {out, release(t), stop(t), kill(t), endTime, nodes, dead}.
// Light mode (env.light): 3 formants instead of 5, one tract instead of two, fewer singers, no jitter / air paths.
// def.prewarm(ctx, params, midi) makes the glottal PeriodicWaves and noise buffers ahead of time.
//
// Integrator:  import { VOCALS } from './vocals.js';
//              for (const d of VOCALS) { d.region = d.region || 'Voices'; if (!INSTRUMENT_MAP[d.id]) { INSTRUMENTS.push(d); INSTRUMENT_MAP[d.id] = d; } }
import { clamp, mtof, rng, noiseBuffer, disconnectAll, krate, krateFilter, cached, release as relParam } from './util.js?v=9c';

const P = (id, name, min, max, def, extra = {}) => ({ id, name, min, max, default: def, unit: '', ...extra });
const ENUM = (id, name, options, def) => ({ id, name, min: 0, max: options.length - 1, default: def, unit: '', type: 'enum', options });
const TOGGLE = (id, name, def) => P(id, name, 0, 1, def, { type: 'toggle' });
const R = rng(7719);   // deterministic: the same render every time
const rand = (a = 0, b = 1) => a + (b - a) * R();
const vel2amp = v => Math.pow(clamp(v, 0, 1), 1.3);

// ---------------------------------------------------------------- female vowel table
// F = formant frequencies (Hz), B = bandwidths (Hz); adult female values (Peterson & Barney / Hillenbrand, rounded,
// slightly "sung"). nz = nasal zero depth in dB (only the hum), at nzF.
export const VOWELS = {
  mm: { F: [270, 1100, 2350, 3400, 4500], B: [80, 260, 300, 360, 420], nz: -22, nzF: 900 },
  ooh: { F: [330, 820, 2650, 3650, 4800], B: [70, 90, 150, 220, 300], nz: 0 },
  oh: { F: [480, 920, 2800, 3700, 4900], B: [75, 90, 160, 220, 300], nz: 0 },
  aah: { F: [850, 1230, 2850, 3800, 4950], B: [90, 100, 160, 230, 300], nz: 0 },
  uh: { F: [740, 1420, 2800, 3800, 4950], B: [85, 100, 160, 230, 300], nz: 0 },
  eh: { F: [600, 2250, 2950, 3900, 4950], B: [80, 110, 170, 230, 300], nz: 0 },
  ee: { F: [320, 2750, 3300, 4100, 5000], B: [60, 110, 180, 240, 300], nz: 0 },
};
// the Vowel knob: 0 = mm, 0.2 = ooh, 0.4 = oh, 0.6 = aah, 0.8 = eh, 1 = ee (smooth morph in between)
const AXIS = ['mm', 'ooh', 'oh', 'aah', 'eh', 'ee'];
const AXIS_POS = Object.fromEntries(AXIS.map((k, i) => [k, i / (AXIS.length - 1)]));
function mix(A, B, u) {
  return { F: A.F.map((f, i) => f * Math.pow(B.F[i] / f, u)), B: A.B.map((b, i) => b + (B.B[i] - b) * u), nz: A.nz + (B.nz - A.nz) * u, nzF: A.nzF || B.nzF || 900 };
}
export function vowelAt(x) {
  const pos = clamp(x, 0, 1) * (AXIS.length - 1), i = Math.min(AXIS.length - 2, Math.floor(pos));
  return mix(VOWELS[AXIS[i]], VOWELS[AXIS[i + 1]], pos - i);
}
const frameOf = v => (typeof v === 'string' ? mix(VOWELS[v], VOWELS[v], 0) : typeof v === 'number' ? vowelAt(v) : v);

// the resonator settings for one frame, a formant shift (vocal tract length) and the pitch
function tract(frame, shift, f0, n, sr) {
  const out = [], ny = sr * 0.45;
  for (let i = 0; i < n; i++) {
    let F = frame.F[i] * shift;
    if (i === 0 && F < f0 * 1.12) F = f0 * 1.12;          // soprano formant tuning: F1 rides just above the pitch
    F = Math.min(F, ny - 500 + i * 100);
    const Bw = frame.B[i] * Math.sqrt(shift) * (i === 0 && F > frame.F[0] * shift * 1.3 ? 1.6 : 1);
    out.push({ F, q: 20 * Math.log10(Math.max(0.8, F / Bw)) });   // lowpass Q is in dB in Web Audio
  }
  return { res: out, nz: frame.nz, nzF: (frame.nzF || 900) * shift };
}
// RBJ biquad magnitude^2 (lowpass with Q in dB, or peaking with linear Q) - matches Web Audio's BiquadFilterNode
function coefs(type, f, q, g, sr) {
  const w = 2 * Math.PI * f / sr, cs = Math.cos(w), sn = Math.sin(w);
  if (type === 'lowpass') { const a = sn / (2 * Math.pow(10, q / 20)); return [(1 - cs) / 2, 1 - cs, (1 - cs) / 2, 1 + a, -2 * cs, 1 - a]; }
  const A = Math.pow(10, g / 40);
  if (type === 'highshelf') { const a = sn / 2 * Math.SQRT2, r = 2 * Math.sqrt(A) * a;
    return [A * ((A + 1) + (A - 1) * cs + r), -2 * A * ((A - 1) + (A + 1) * cs), A * ((A + 1) + (A - 1) * cs - r), (A + 1) - (A - 1) * cs + r, 2 * ((A - 1) - (A + 1) * cs), (A + 1) - (A - 1) * cs - r]; }
  const a = sn / (2 * q); return [1 + a * A, -2 * cs, 1 - a * A, 1 + a / A, -2 * cs, 1 - a / A];
}
function mag2(c, f, sr) {
  const w = 2 * Math.PI * f / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = c[0] + c[1] * c1 + c[2] * c2, ni = -(c[1] * s1 + c[2] * s2), dr = c[3] + c[4] * c1 + c[5] * c2, di = -(c[4] * s1 + c[5] * s2);
  return (nr * nr + ni * ni) / (dr * dr + di * di);
}
function tractCoefs(tr, sr) {
  const cs = tr.res.map(r => coefs('lowpass', r.F, r.q, 0, sr));
  if (tr.nz < -0.5) cs.push(coefs('peaking', tr.nzF, 2.2, tr.nz, sr));
  cs.push(coefs('highshelf', PRESENCE_F, 0, PRESENCE_DB, sr));
  return cs;
}
// the formants above F5 that a 5-pole cascade leaves out (Klatt's "higher-pole correction"): a gentle high shelf
const PRESENCE_F = 2600, PRESENCE_DB = 7;
const H2 = (cs, f, sr) => { let m = 1; for (const c of cs) m *= mag2(c, f, sr); return m; };
// RMS of the glottal source through the tract (sum of harmonic powers); and of white noise (mean |H|^2 over the band)
const memo = new Map();
function remember(key, make) { let v = memo.get(key); if (v === undefined) { if (memo.size > 4000) memo.clear(); v = make(); memo.set(key, v); } return v; }
const trKey = tr => tr.res.map(r => Math.round(r.F) + '/' + r.q.toFixed(1)).join(',') + '|' + tr.nz.toFixed(1);
function voicedRms(tr, f0, tilt, h1, sr) { return remember(`v${trKey(tr)}|${f0.toFixed(1)}|${tilt.toFixed(2)}|${h1.toFixed(2)}|${sr}`, () => voicedRms0(tr, f0, tilt, h1, sr)); }
function noiseRms(tr, sr, lo = 300) { return remember(`n${trKey(tr)}|${lo}|${sr}`, () => noiseRms0(tr, sr, lo)); }
function voicedRms0(tr, f0, tilt, h1, sr) {
  const cs = tractCoefs(tr, sr); let p = 0;
  for (let k = 1; k <= HARM && k * f0 < Math.min(sr / 2, 16000); k++) { const a = glotAmp(k, tilt, h1); p += a * a * H2(cs, k * f0, sr); }
  return Math.sqrt(p / 2);
}
function noiseRms0(tr, sr, lo = 300) {
  const cs = tractCoefs(tr, sr); let p = 0, n = 0;
  for (let f = lo; f < Math.min(sr / 2, 14000); f += 60) { p += H2(cs, f, sr); n++; }
  return Math.sqrt(p / n * (Math.min(sr / 2, 14000) - lo) / (sr / 2)) * 0.2887;   // white noise +-0.5: rms 0.289
}

// ---------------------------------------------------------------- glottal source (PeriodicWave, cached per context)
// Harmonic amplitudes of a glottal pulse (flow derivative + lip radiation): k^-tilt, with H1 raised for an open, breathy
// glottis. tilt ~0.9 = pressed / bright, 1.2 = modal, 1.6 = soft, 2 = very breathy.
const HARM = 72;
const glotAmp = (k, tilt, h1) => (k === 1 ? h1 : 1) * Math.pow(k, -tilt) * (k > 40 ? Math.exp(-(k - 40) / 14) : 1);
const q10 = x => Math.round(x * 10) / 10;
function glottal(ctx, tilt, h1) {
  tilt = q10(tilt); h1 = q10(h1);
  return cached(ctx, `vox-glottal:${tilt}:${h1}`, () => {
    const re = new Float32Array(HARM + 1), im = new Float32Array(HARM + 1);
    for (let k = 1; k <= HARM; k++) im[k] = glotAmp(k, tilt, h1);
    return ctx.createPeriodicWave(re, im, { disableNormalization: true });
  });
}
// breathing LFO: a quick inhale, a long exhale (for Breath Swells)
function breathWave(ctx) {
  return cached(ctx, 'vox-breathwave', () => {
    const N = 24, re = new Float32Array(N + 1), im = new Float32Array(N + 1);
    // Fourier series of a smooth asymmetric pulse (rise 30%, fall 70%) computed numerically
    const M = 512, s = new Float32Array(M);
    for (let i = 0; i < M; i++) { const x = i / M; s[i] = x < 0.3 ? Math.sin(Math.PI / 2 * x / 0.3) ** 2 : Math.cos(Math.PI / 2 * (x - 0.3) / 0.7) ** 2; }
    for (let k = 1; k <= N; k++) { let a = 0, b = 0; for (let i = 0; i < M; i++) { a += s[i] * Math.cos(2 * Math.PI * k * i / M); b += s[i] * Math.sin(2 * Math.PI * k * i / M); } re[k] = 2 * a / M; im[k] = 2 * b / M; }
    return ctx.createPeriodicWave(re, im, { disableNormalization: true });
  });
}

// ---------------------------------------------------------------- voice plumbing (same contract as instruments.js)
class Voice {
  constructor(ctx, env, t) {
    this.ctx = ctx; this.env = env; this.t0 = t; this.out = ctx.createGain(); this.out.gain.value = 1;
    this.srcs = []; this.nodes = [this.out]; this.amps = []; this.rel = 0.5; this.endTime = Infinity; this.released = false; this.relAt = Infinity;
  }
  node(n) { this.nodes.push(n); return n; }
  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return this.node(g); }
  filter(type, f, q = 0.7) { const b = krateFilter(this.ctx.createBiquadFilter()); b.type = type; b.frequency.value = clamp(f, 10, 20000); b.Q.value = q; return this.node(b); }
  pan(x) { const p = this.ctx.createStereoPanner(); p.pan.value = clamp(x, -1, 1); return this.node(p); }
  osc(type, freq, t) {
    const o = this.ctx.createOscillator(); krate(o.frequency, o.detune);
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.value = freq; o.start(t); this.srcs.push(o); return this.node(o);
  }
  noise(kind, t) { const s = this.ctx.createBufferSource(); s.buffer = noiseBuffer(this.ctx, kind); s.loop = true; s.start(t, rand(0, 5)); this.srcs.push(s); return this.node(s); }
  constant(v, t) { const c = this.ctx.createConstantSource(); c.offset.value = v; c.start(t); this.srcs.push(c); return this.node(c); }
  lfo(rate, depth, params, t, type = 'sine') { const l = this.osc(type, rate, t), g = this.gain(depth); l.connect(g); (Array.isArray(params) ? params : [params]).forEach(p => g.connect(p)); return g; }
  release(t, r = this.rel) {
    if (this.released) return; this.released = true;
    t = Math.max(t, this.ctx.currentTime); this.relAt = t;
    for (const a of this.amps) relParam(a, t, r);
    this.onRelease?.(t, r);
    this.stop(t + r * 1.7 + 0.05);
  }
  stop(t) {
    t = Math.max(t, this.ctx.currentTime);
    if (t >= this.endTime) return;
    this.endTime = t;
    for (const s of this.srcs) { try { s.stop(t); } catch (e) { } }
    const first = this.srcs[0];
    const done = () => { if (this.dead) return; this.dead = true; disconnectAll(...this.nodes); this.env.voiceEnded?.(this); };
    if (first) first.onended = done; else done();
  }
  kill(t, fade = 0.04) {
    t = Math.max(t, this.ctx.currentTime);
    for (const a of this.amps) relParam(a, t, fade);
    this.released = true; this.relAt = Math.min(this.relAt, t);
    this.stop(t + fade * 2);
  }
}

// mono / legato memory and per-track note counters (keyed by the track's resolved params object, one per track)
const monoMem = new WeakMap(), counters = new WeakMap();
function monoLink(v, p, f, t) {
  const prev = monoMem.get(p);
  let from = f, legato = false;
  if (prev && !prev.v.dead && prev.v !== v && prev.v.endTime > t) {
    legato = prev.v.relAt > t - 0.04 && prev.t0 < t - 0.005;
    if (legato) from = prev.cur(t);
    prev.v.kill(t, legato ? 0.06 : 0.035);
  }
  return { from, legato, remember: cur => monoMem.set(p, { v, t0: t, cur }) };
}
function nextCount(p) { const n = (counters.get(p) || 0); counters.set(p, n + 1); return n; }

// ---------------------------------------------------------------- the singer: sources -> breath -> tract(s) -> out
// o: { f, light, tracts:[{shift, pan, singers:[{cents, vib, vibRate, vibDelay}]}], frame (start), target (frame or null),
//      morphAt, morphTc, coda (frame or null), codaAt, codaTc, motion:{to, amount, rate}, tilt, h1, bright (0..1 mix of the
//      pressed source), breath, breathHp, air, jitter, voiced (0..1), octave (0..1 head-voice layer), level (rms) }
// Returns { out (pre-envelope sum), pitch (ConstantSource offset in cents), oscs, filters }.
function singer(v, ctx, t, o) {
  const sr = ctx.sampleRate, light = !!o.light, n = light ? 3 : 5;
  const out = v.gain(1), pitch = v.constant(0, t);
  const fA = frameOf(o.frame), fB = o.target ? frameOf(o.target) : fA;
  const softW = glottal(ctx, o.tilt, o.h1), brightW = glottal(ctx, Math.max(0.6, o.tilt - 0.55), Math.max(1, o.h1 * 0.7));
  const oscs = [], filters = [];
  const tracts = light ? [{ ...o.tracts[0], pan: 0, singers: o.tracts[0].singers.slice(0, o.lightSingers || 2) }] : o.tracts;
  const noise = (o.breath > 0.001 || o.air > 0.001) ? v.noise('white', t) : null;
  let am = null;
  const motion = o.motion && o.motion.amount > 0.01 ? v.osc('sine', o.motion.rate, t) : null;
  tracts.forEach((T, ti) => {
    const trB = tract(fB, T.shift, o.f, n, sr), trA = tract(fA, T.shift, o.f, n, sr);
    const input = v.gain(1);
    // the cascade
    let node = input; const fl = [];
    trA.res.forEach((r, i) => {
      const b = v.filter('lowpass', r.F, r.q); node.connect(b); node = b; fl.push(b);
      b.frequency.setValueAtTime(r.F, t); b.Q.setValueAtTime(r.q, t);
      if (o.target && o.morphTc > 0) { b.frequency.setTargetAtTime(trB.res[i].F, t + (o.morphAt || 0), o.morphTc); b.Q.setTargetAtTime(trB.res[i].q, t + (o.morphAt || 0), o.morphTc); }
    });
    const nasal = (fA.nz < -0.5 || fB.nz < -0.5) ? v.filter('peaking', trA.nzF, 2.2) : null;
    if (nasal) {
      nasal.gain.value = fA.nz; nasal.gain.setValueAtTime(fA.nz, t);
      if (o.target && o.morphTc > 0) nasal.gain.setTargetAtTime(fB.nz, t + (o.morphAt || 0), o.morphTc);
      node.connect(nasal); node = nasal;
    }
    if (o.coda) {   // a diphthong ending (ey -> ee, oh -> ooh)
      const trC = tract(frameOf(o.coda), T.shift, o.f, n, sr);
      fl.forEach((b, i) => { b.frequency.setTargetAtTime(trC.res[i].F, t + o.codaAt, o.codaTc); b.Q.setTargetAtTime(trC.res[i].q, t + o.codaAt, o.codaTc); });
    }
    if (motion) {   // slow drift toward a neighbouring vowel and back (F1-F3; the two tracts drift in opposite phase)
      const trM = tract(frameOf(o.motion.to), T.shift, o.f, n, sr);
      fl.slice(0, 3).forEach((b, i) => { const g = v.gain((ti ? -1 : 1) * 1200 * Math.log2(trM.res[i].F / trB.res[i].F) * o.motion.amount * 0.5); motion.connect(g); g.connect(b.detune); });
    }
    const pres = v.filter('highshelf', PRESENCE_F, 0.7); pres.gain.value = PRESENCE_DB; node.connect(pres); node = pres;
    const hp = v.filter('highpass', 85, 0.6); node.connect(hp);
    const pn = tracts.length > 1 ? v.pan(T.pan) : null;
    if (pn) { hp.connect(pn); pn.connect(out); } else hp.connect(out);
    filters.push(fl);
    // voiced sources: a soft and a pressed glottis per singer, cross-faded by `bright`
    const vr = voicedRms(trB, o.f, o.tilt, o.h1, sr), per = (o.level * o.voiced) / Math.max(1e-4, vr) / Math.sqrt(T.singers.length * tracts.length);
    if (o.voiced > 0.001) T.singers.forEach((S, si) => {
      const mk = (w, g) => { const os = v.osc(w, o.f, t); os.detune.value = S.cents; pitch.connect(os.detune); const gg = v.gain(g * per); os.connect(gg); gg.connect(input); oscs.push(os); return os; };
      const pressed = !light && o.bright > 0.3;   // a second, pressed glottis only where it is heard (solo, chops)
      const lead = mk(softW, pressed ? 1 - o.bright * 0.6 : 1);
      const group = [lead];
      if (pressed) group.push(mk(brightW, o.bright * 0.6 * 0.8));
      if (o.octave > 0.01 && si === 0) { const oc = mk(softW, o.octave * 0.45); oc.frequency.value = o.f * 2; group.push(oc); }
      if (S.vib > 0.1) {   // vibrato with a delayed, gradual onset; its rate drifts a little
        const l = v.osc('sine', S.vibRate, t), lg = v.gain(0); l.connect(lg); group.forEach(os => lg.connect(os.detune));
        lg.gain.setValueAtTime(0, t); lg.gain.setValueAtTime(0, t + S.vibDelay); lg.gain.linearRampToValueAtTime(S.vib, t + S.vibDelay + 0.7);
      }
      if (!am && ti === 0 && si === 0) am = lead;
    });
    // breath: noise through the same tract (aspiration), pulsed by the glottis when there is voicing
    if (noise && o.breath > 0.001) {
      const bhp = v.filter('highpass', o.breathHp || 400, 0.6), bg = v.gain((o.level * o.breath) / Math.max(1e-4, noiseRms(trB, sr, o.breathHp || 400)) / Math.sqrt(tracts.length));
      noise.connect(bhp); bhp.connect(bg); bg.connect(input);
      if (ti === 0) v.breathGains = [];
      v.breathGains.push(bg.gain);
      if (am && o.voiced > 0.05 && ti === 0) {
        const pulse = v.gain(0.55); bhp.disconnect(); bhp.connect(pulse); pulse.connect(bg);
        const amg = v.gain(0.35); am.connect(amg); amg.connect(pulse.gain);
      }
    }
  });
  if (noise && o.air > 0.001 && !light) {   // air past the lips: a soft high hiss, outside the tract
    const ah = v.filter('highpass', 5200, 0.5), as = v.filter('highshelf', 11000, 0.7), ag = v.gain(o.level * o.air * 0.9);
    as.gain.value = -8; noise.connect(ah); ah.connect(as); as.connect(ag); ag.connect(out); v.airGain = ag.gain;
  }
  if (!light && o.jitter > 0) {   // natural pitch jitter: slow random wander of the whole voice
    const jn = v.noise('pink', t), jl = v.filter('lowpass', 7, 0.7), jg = v.gain(o.jitter * 90); jn.connect(jl); jl.connect(jg); jg.connect(pitch.offset);
  }
  return { out, pitch: pitch.offset, oscs, filters };
}
// singer list for a tract: n singers spread over `spread` cents, each with its own vibrato rate / onset
function crowd(n, spread, vib, rateLo = 4.9, rateHi = 5.9) {
  const s = [];
  for (let i = 0; i < n; i++) s.push({ cents: n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * spread + rand(-1.5, 1.5), vib: vib * rand(0.75, 1.15), vibRate: rand(rateLo, rateHi), vibDelay: rand(0.25, 0.7) });
  return s;
}
const SHIFT = x => Math.pow(2, x * 0.42);   // Formant knob -1..1 = vocal tract about 25% longer .. 34% shorter

// shared prewarm: the glottal waves a preset will use and the noise loops
function prewarmWaves(ctx, tilts) {
  noiseBuffer(ctx, 'white'); noiseBuffer(ctx, 'pink');
  for (const [tilt, h1] of tilts) { glottal(ctx, tilt, h1); glottal(ctx, Math.max(0.6, tilt - 0.55), Math.max(1, h1 * 0.7)); }
}

// ---------------------------------------------------------------- 1. Female Choir
const SECTIONS = [{ value: 'soprano', label: 'Sopranos' }, { value: 'alto', label: 'Altos' }, { value: 'mixed', label: 'Sopranos + altos' }];
const choirTilt = p => [1.05 + p.breath * 0.35 + (p.section === 'alto' ? 0.1 : 0), 1.2 + p.breath * 0.9];
const femchoir = {
  id: 'femchoir', name: 'Female Choir', kind: 'synth', maxVoices: 8,
  params: [P('vowel', 'Vowel', 0, 1, 0.2), P('motion', 'Motion', 0, 1, 0.3), P('breath', 'Breath', 0, 1, 0.35), P('ensemble', 'Ensemble', 0, 1, 0.6),
    ENUM('section', 'Section', SECTIONS, 'soprano'), P('open', 'Open', 0, 1, 0.4), P('swell', 'Swell', 0, 1, 0.45), P('vibrato', 'Vibrato', 0, 1, 0.35),
    P('formant', 'Formant', -1, 1, 0), P('release', 'Release', 0, 1, 0.5), P('level', 'Level', 0, 1.5, 1)],
  macros: ['vowel', 'motion', 'breath', 'ensemble'],
  presets: [
    { id: 'ooh-choir', name: 'Ooh Choir', params: {} },
    { id: 'aah-choir', name: 'Aah Choir', params: { vowel: 0.6, motion: 0.2, breath: 0.3, ensemble: 0.7, open: 0.5, vibrato: 0.4 } },
    { id: 'hum-choir', name: 'Hum Choir', params: { vowel: 0, motion: 0.15, breath: 0.15, ensemble: 0.55, open: 0, swell: 0.55, vibrato: 0.25, section: 'mixed', level: 1.15 } },
    { id: 'eh-choir', name: 'Eh Choir', params: { vowel: 0.8, motion: 0.25, breath: 0.4, ensemble: 0.6, open: 0.3, vibrato: 0.35 } },
    { id: 'alto-section', name: 'Alto Section', params: { vowel: 0.4, motion: 0.45, breath: 0.45, ensemble: 0.8, section: 'alto', open: 0.6, swell: 0.6, vibrato: 0.3 } },
  ],
  prewarm(ctx, p) { prewarmWaves(ctx, [choirTilt(p)]); },
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel), light = env.light;
    const n = 2 + Math.round(p.ensemble * 2), spread = 3 + p.ensemble * 11, vib = 6 + p.vibrato * 28;
    const base = SHIFT(p.formant), alto = p.section === 'alto' ? 0.93 : 1;
    const [tilt, h1] = choirTilt(p);
    const sh = p.section === 'mixed' ? [base, base * 0.93] : [base * alto * 1.02, base * alto * 0.98];
    const w = 0.35 + p.ensemble * 0.5;
    const target = vowelAt(p.vowel), start = vowelAt(Math.max(0, p.vowel - p.open * 0.45));
    const at = 0.08 + p.swell * p.swell * 2.6;
    const s = singer(v, ctx, t, {
      f, light, tracts: [{ shift: sh[0], pan: -w, singers: crowd(n, spread, vib) }, { shift: sh[1], pan: w, singers: crowd(n, spread, vib) }], lightSingers: 2,
      frame: start, target, morphAt: 0.02, morphTc: 0.08 + at * 0.35,
      motion: { to: vowelAt(p.vowel > 0.5 ? p.vowel - 0.22 : p.vowel + 0.22), amount: p.motion, rate: rand(0.07, 0.14) + p.motion * 0.12 },
      tilt, h1, bright: 0.1 + vel * 0.15, breath: 0.12 + p.breath * 0.55, air: p.breath * 0.25, jitter: 0.6, voiced: 1, level: 0.036,
    });
    s.pitch.setValueAtTime(-18, t); s.pitch.setTargetAtTime(0, t, 0.08);   // a soft scoop into the note
    const amp = v.gain(0); v.amps.push(amp.gain); s.out.connect(amp); amp.connect(v.out);
    const pk = a * p.level;
    amp.gain.setValueAtTime(0, t); amp.gain.setTargetAtTime(pk, t, at / 2.6);
    v.rel = 0.25 + p.release * p.release * 4.5;
    return v;
  },
};

// ---------------------------------------------------------------- 2. Solo Female Voice (mono, legato glide)
const VMODES = [{ value: 'fixed', label: 'Fixed vowel' }, { value: 'cycle', label: 'New vowel each note' }, { value: 'pitch', label: 'Opens with pitch' }];
const CYCLE = ['ooh', 'aah', 'oh', 'eh', 'aah', 'ooh', 'ee', 'oh'];
const soloTilt = p => [0.95 + p.breath * 0.45, 1.1 + p.breath * 1.1];
const solovoice = {
  id: 'solovoice', name: 'Solo Female Voice', kind: 'synth', maxVoices: 3,
  params: [P('vowel', 'Vowel', 0, 1, 0.6), P('breath', 'Breath', 0, 1, 0.45), P('vibrato', 'Vibrato', 0, 1, 0.45), P('glide', 'Glide', 0, 1, 0.35),
    ENUM('vowelMode', 'Vowels', VMODES, 'fixed'), P('swell', 'Swell', 0, 1, 0.35), P('fall', 'Fall', 0, 1, 0.15), P('formant', 'Formant', -1, 1, 0.05),
    P('release', 'Release', 0, 1, 0.45), P('level', 'Level', 0, 1.5, 1)],
  macros: ['vowel', 'breath', 'vibrato', 'glide'],
  presets: [
    { id: 'breathy-lead', name: 'Breathy Lead', params: {} },
    { id: 'ethereal-ooh', name: 'Ethereal Ooh', params: { vowel: 0.2, breath: 0.65, vibrato: 0.3, glide: 0.5, swell: 0.6, formant: 0.15, release: 0.7 } },
    { id: 'bright-aah', name: 'Bright Aah', params: { vowel: 0.62, breath: 0.2, vibrato: 0.6, glide: 0.25, swell: 0.25 } },
    { id: 'lyric-cycle', name: 'Lyric Cycle', params: { vowelMode: 'cycle', breath: 0.4, vibrato: 0.45, glide: 0.4 } },
    { id: 'sigh-lead', name: 'Sigh Lead', params: { vowel: 0.5, breath: 0.8, vibrato: 0.25, glide: 0.6, fall: 0.6, swell: 0.45, release: 0.6, vowelMode: 'pitch' } },
  ],
  prewarm(ctx, p) { prewarmWaves(ctx, [soloTilt(p)]); },
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel), light = env.light;
    const link = monoLink(v, p, f, t);
    let vx = p.vowel;
    if (p.vowelMode === 'cycle') vx = AXIS_POS[CYCLE[nextCount(p) % CYCLE.length]];
    else if (p.vowelMode === 'pitch') vx = clamp(0.2 + (midi - 57) / 30 * 0.45 + (p.vowel - 0.5) * 0.4, 0.15, 0.7);
    const target = vowelAt(vx), [tilt, h1] = soloTilt(p);
    const s = singer(v, ctx, t, {
      f, light, tracts: [{ shift: SHIFT(p.formant), pan: 0, singers: [{ cents: 0, vib: 10 + p.vibrato * 50, vibRate: rand(5.1, 5.7), vibDelay: link.legato ? 0.12 : 0.3 + (1 - p.vibrato) * 0.25 }] }], lightSingers: 1,
      frame: link.legato ? target : vowelAt(Math.max(0, vx - 0.12)), target, morphAt: 0, morphTc: 0.06,
      motion: { to: vowelAt(vx > 0.5 ? vx - 0.15 : vx + 0.15), amount: 0.15, rate: rand(0.1, 0.18) },
      tilt, h1, bright: 0.2 + vel * 0.45, breath: 0.1 + p.breath * 0.6, breathHp: 500, air: p.breath * 0.35, jitter: 0.8, voiced: 1, level: 0.085,
    });
    // pitch: a glide from the previous note (legato), or a small scoop up into a fresh note
    const glide = 0.03 + p.glide * p.glide * 0.45;
    if (link.legato) { const c = 1200 * Math.log2(link.from / f); s.pitch.setValueAtTime(c, t); s.pitch.setTargetAtTime(0, t, glide / 3); }
    else { s.pitch.setValueAtTime(-35 - p.glide * 30, t); s.pitch.setTargetAtTime(0, t + 0.01, 0.05); }
    const tc = link.legato ? glide / 3 : 0.05;
    link.remember(at => f * Math.pow(2, (link.legato ? 1200 * Math.log2(link.from / f) * Math.exp(-(at - t) / tc) : 0) / 1200));
    const amp = v.gain(0); v.amps.push(amp.gain); s.out.connect(amp); amp.connect(v.out);
    const pk = a * p.level, at = link.legato ? 0.05 : 0.05 + p.swell * 0.5;
    amp.gain.setValueAtTime(0, t); amp.gain.setTargetAtTime(pk * 0.82, t, at / 2.5);
    amp.gain.setTargetAtTime(pk, t + at, 0.6 + p.swell * 1.6);   // messa di voce: the long note grows a little
    v.rel = 0.12 + p.release * p.release * 2.5;
    v.onRelease = (rt, r) => { if (p.fall > 0.01) s.pitch.setTargetAtTime(-p.fall * 500, rt + 0.02, r * 0.5); };
    return v;
  },
};

// ---------------------------------------------------------------- 3. Vocal Chops (short pitched syllables)
// a: onset frame, b: the vowel, c: diphthong ending; burst: a soft consonant click
const SYL = {
  ah: { a: 'uh', b: 'aah', burst: 0.5 }, oh: { a: 'ooh', b: 'oh', c: 'ooh', burst: 0.2 }, ey: { a: 'eh', b: 'eh', c: 'ee', burst: 0.35 },
  uh: { a: 'mm', b: 'uh', burst: 0 }, ooh: { a: 'mm', b: 'ooh', burst: 0 }, ya: { a: 'ee', b: 'aah', burst: 0 },
};
const SYL_OPTS = [{ value: 'ah', label: 'Ah' }, { value: 'oh', label: 'Oh' }, { value: 'ey', label: 'Ey' }, { value: 'uh', label: 'Uh' }, { value: 'ooh', label: 'Ooh' },
  { value: 'ya', label: 'Ya' }, { value: 'cycle', label: 'Cycle (each note)' }, { value: 'key', label: 'By key' }];
const SYL_CYCLE = ['ah', 'oh', 'ey', 'uh', 'ya', 'ooh'];
const chopTilt = p => [0.9 + p.breath * 0.4, 1.1 + p.breath * 0.8];
const vocalchops = {
  id: 'vocalchops', name: 'Vocal Chops', kind: 'synth', maxVoices: 12,
  params: [P('formant', 'Formant', -1, 1, 0.15), P('decay', 'Decay', 0, 1, 0.35), P('breath', 'Breath', 0, 1, 0.3), P('fall', 'Fall', 0, 1, 0.1),
    ENUM('syllable', 'Syllable', SYL_OPTS, 'ah'), TOGGLE('reverse', 'Reverse', 0), P('tone', 'Tone', 0, 1, 0.7), P('vibrato', 'Vibrato', 0, 1, 0.15),
    P('level', 'Level', 0, 1.5, 1)],
  macros: ['formant', 'decay', 'breath', 'fall'],
  presets: [
    { id: 'ah-chop', name: 'Ah Chop', params: {} },
    { id: 'slowed-chop', name: 'Slowed Chop', params: { formant: -0.45, decay: 0.6, breath: 0.45, fall: 0.45, tone: 0.35, syllable: 'oh', vibrato: 0.25 } },
    { id: 'pitched-up', name: 'Pitched-Up Chop', params: { formant: 0.7, decay: 0.15, breath: 0.2, fall: 0, tone: 0.85, syllable: 'ey' } },
    { id: 'reverse-chop', name: 'Reverse Chop', params: { formant: 0.05, decay: 0.55, breath: 0.5, fall: 0, reverse: 1, syllable: 'ah', tone: 0.6 } },
    { id: 'cycle-chops', name: 'Cycle Chops', params: { formant: 0.25, decay: 0.3, breath: 0.3, fall: 0.15, syllable: 'cycle' } },
  ],
  prewarm(ctx, p) { prewarmWaves(ctx, [chopTilt(p)]); },
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel), light = env.light;
    const key = p.syllable === 'cycle' ? SYL_CYCLE[nextCount(p) % SYL_CYCLE.length] : p.syllable === 'key' ? SYL_CYCLE[((midi % 12) + 12) % 12 % SYL_CYCLE.length] : p.syllable;
    const S = SYL[key] || SYL.ah, rev = p.reverse >= 0.5;
    const dec = 0.1 + p.decay * p.decay * 1.4, revT = 0.12 + p.decay * 0.55;
    const [tilt, h1] = chopTilt(p);
    const s = singer(v, ctx, t, {
      f, light, tracts: [{ shift: SHIFT(p.formant), pan: 0, singers: light ? [{ cents: 0, vib: 0 }] : [{ cents: -4, vib: p.vibrato * 30, vibRate: 5.6, vibDelay: 0.12 }, { cents: 5, vib: p.vibrato * 26, vibRate: 5.1, vibDelay: 0.16 }] }], lightSingers: 1,
      // reversed: the syllable runs backwards (vowel first, closing at the end)
      frame: rev ? S.c || S.b : S.a, target: rev ? S.a : S.b, morphAt: rev ? revT * 0.55 : 0.005, morphTc: rev ? revT * 0.25 : 0.03,
      coda: !rev && S.c ? S.c : null, codaAt: 0.06 + dec * 0.3, codaTc: 0.05 + dec * 0.25,
      tilt, h1, bright: 0.3 + vel * 0.4, breath: 0.08 + p.breath * 0.5, breathHp: 600, air: p.breath * 0.3, jitter: 0.3, voiced: 1, level: 0.09,
    });
    const tone = v.filter('lowpass', 1500 * Math.pow(9, p.tone), 0.5), amp = v.gain(0); v.amps.push(amp.gain);
    s.out.connect(tone); tone.connect(amp); amp.connect(v.out);
    const pk = a * p.level;
    amp.gain.setValueAtTime(0, t);
    if (rev) {   // reverse feel: an accelerating swell that cuts off at the end
      const N = 64, c = new Float32Array(N); for (let i = 0; i < N; i++) c[i] = pk * 1.5 * Math.pow(i / (N - 1), 2.6);
      amp.gain.setValueCurveAtTime(c, t, revT); amp.gain.setTargetAtTime(0, t + revT + 0.005, 0.022);
      s.pitch.setValueAtTime(0, t); s.pitch.setTargetAtTime(30, t + revT * 0.6, revT * 0.3);
      v.rel = 0.03; v.stop(t + revT + 0.25);
    } else {
      amp.gain.linearRampToValueAtTime(pk, t + 0.012);   // soft but defined onset
      amp.gain.setTargetAtTime(pk * 0.25 * p.decay, t + 0.012 + dec * 0.4, dec / 2.5);
      s.pitch.setValueAtTime(-25, t); s.pitch.setTargetAtTime(0, t, 0.025);
      if (S.burst > 0 && !light) {   // a soft consonant: a 12 ms breath click
        const bn = v.noise('white', t), bb = v.filter('bandpass', 3800 * SHIFT(p.formant), 1.2), bg = v.gain(0);
        bn.connect(bb); bb.connect(bg); bg.connect(amp);
        bg.gain.setValueAtTime(0.06 * S.burst, t); bg.gain.setTargetAtTime(0, t + 0.004, 0.006);
        try { bn.stop(t + 0.15); } catch (e) { } v.srcs.splice(v.srcs.indexOf(bn), 1);
      }
      v.rel = 0.06 + p.decay * 0.5;
      v.stop(t + 0.012 + dec * 0.4 + (p.decay < 0.05 ? dec * 3.5 : 30));
      v.onRelease = (rt, r) => { if (p.fall > 0.01) s.pitch.setTargetAtTime(-p.fall * 1000, rt, r * 0.45 + 0.03); };
    }
    return v;
  },
};

// ---------------------------------------------------------------- 4. Breath & Whisper
const SHAPES = [{ value: 'pad', label: 'Pad' }, { value: 'breathe', label: 'Breathing' }, { value: 'sigh', label: 'Sigh' }];
const breathvox = {
  id: 'breathvox', name: 'Breath & Whisper', kind: 'synth', maxVoices: 6,
  params: [P('vowel', 'Vowel', 0, 1, 0.55), P('voice', 'Voice', 0, 1, 0.15), P('motion', 'Motion', 0, 1, 0.4), P('air', 'Air', 0, 1, 0.45),
    ENUM('shape', 'Shape', SHAPES, 'pad'), P('rate', 'Breath rate', 0, 1, 0.35), P('formant', 'Formant', -1, 1, 0), P('swell', 'Swell', 0, 1, 0.5), P('level', 'Level', 0, 1.5, 1)],
  macros: ['vowel', 'voice', 'motion', 'air'],
  presets: [
    { id: 'whisper-pad', name: 'Whisper Pad', params: {} },
    { id: 'breath-swells', name: 'Breath Swells', params: { shape: 'breathe', vowel: 0.62, voice: 0.05, motion: 0.5, air: 0.55, rate: 0.35 } },
    { id: 'sigh', name: 'Sigh', params: { shape: 'sigh', vowel: 0.6, voice: 0.35, motion: 0.1, air: 0.4, swell: 0.2 } },
    { id: 'air-choir', name: 'Air Choir', params: { vowel: 0.25, voice: 0.4, motion: 0.55, air: 0.35, formant: 0.1, swell: 0.7 } },
    { id: 'pitched-air', name: 'Pitched Air', params: { vowel: 0.8, voice: 0.6, motion: 0.3, air: 0.6, formant: 0.2, swell: 0.6 } },
  ],
  prewarm(ctx) { prewarmWaves(ctx, [[1.6, 2.2]]); breathWave(ctx); },
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel), light = env.light;
    const sh = SHIFT(p.formant), vw = vowelAt(p.vowel), other = vowelAt(p.vowel > 0.5 ? p.vowel - 0.3 : p.vowel + 0.3);
    const voiced = p.voice * p.voice * 0.6, sigh = p.shape === 'sigh';
    const s = singer(v, ctx, t, {
      f, light, tracts: [{ shift: sh * 1.02, pan: -0.55, singers: crowd(2, 6, 8) }, { shift: sh * 0.97, pan: 0.55, singers: crowd(2, 6, 8) }], lightSingers: 1,
      frame: sigh ? vowelAt(Math.min(1, p.vowel + 0.1)) : vw, target: sigh ? vowelAt(Math.max(0, p.vowel - 0.35)) : vw, morphAt: 0.25, morphTc: sigh ? 0.5 : 0,
      motion: { to: other, amount: p.motion, rate: 0.05 + p.motion * 0.1 },
      tilt: 1.6, h1: 2.2, bright: 0, breath: 1, breathHp: 250, air: p.air * 0.6, jitter: 0.4, voiced, level: 0.045,
    });
    // whispered pitch: two narrow resonances on the harmonics so the breath carries the note
    if (p.voice > 0.01) {
      const pn = v.noise('pink', t), pg = v.gain(0.9 * p.voice);
      for (const [k, g] of light ? [[2, 1]] : [[1, 0.6], [2, 1], [3, 0.5]]) { const b = v.filter('bandpass', f * k, 40), bg = v.gain(g); pn.connect(b); b.connect(bg); bg.connect(pg); }
      pg.connect(s.out);
    }
    const amp = v.gain(0); v.amps.push(amp.gain);
    const pk = a * p.level, at = 0.15 + p.swell * 2.2;
    amp.gain.setValueAtTime(0, t);
    if (sigh) {   // a falling "haa": quick in, slow out, the pitch sags
      amp.gain.setTargetAtTime(pk * 1.3, t, 0.05); amp.gain.setTargetAtTime(0, t + 0.25, 0.55 + p.swell);
      s.pitch.setValueAtTime(60, t); s.pitch.setTargetAtTime(-260, t + 0.15, 0.6);
      v.stop(t + 0.25 + (0.55 + p.swell) * 9);
    } else amp.gain.setTargetAtTime(pk, t, at / 2.6);
    if (p.shape === 'breathe') {   // in and out: a quick inhale, a long exhale (and the inhale is brighter)
      const rate = 0.08 + p.rate * 0.3, bw = v.osc(breathWave(ctx), rate, t), bd = v.gain(0.85);
      const mod = v.gain(0.15); bw.connect(bd); bd.connect(mod.gain); s.out.connect(mod); mod.connect(amp);
      const br = v.gain(500); bw.connect(br); s.filters.flat().slice(1, 3).forEach(b => br.connect(b.detune));
    } else s.out.connect(amp);
    amp.connect(v.out);
    v.rel = sigh ? 0.9 : 0.6 + p.swell * 2.2;
    return v;
  },
};

// ---------------------------------------------------------------- 5. Angel Pad (high, shimmering, made for long reverbs)
const angelpad = {
  id: 'angelpad', name: 'Angel Pad', kind: 'synth', maxVoices: 8,
  params: [P('vowel', 'Vowel', 0, 1, 0.2), P('shimmer', 'Shimmer', 0, 1, 0.45), P('swell', 'Swell', 0, 1, 0.7), P('air', 'Air', 0, 1, 0.45),
    P('motion', 'Motion', 0, 1, 0.45), P('formant', 'Formant', -1, 1, 0.3), P('vibrato', 'Vibrato', 0, 1, 0.3), P('release', 'Release', 0, 1, 0.75), P('level', 'Level', 0, 1.5, 1)],
  macros: ['vowel', 'shimmer', 'swell', 'air'],
  presets: [
    { id: 'angel-ooh', name: 'Angel Ooh', params: {} },
    { id: 'halo-ee', name: 'Halo Ee', params: { vowel: 0.95, shimmer: 0.55, swell: 0.75, air: 0.5, formant: 0.2, motion: 0.35 } },
    { id: 'seraph-aah', name: 'Seraph Aah', params: { vowel: 0.58, shimmer: 0.35, swell: 0.6, air: 0.35, formant: 0.15, vibrato: 0.4 } },
    { id: 'frozen-halo', name: 'Frozen Halo', params: { vowel: 0.3, shimmer: 0.8, swell: 0.95, air: 0.7, motion: 0.7, formant: 0.45, vibrato: 0.15, release: 1 } },
  ],
  prewarm(ctx) { prewarmWaves(ctx, [[1.35, 2.0]]); },
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel), light = env.light;
    const sh = SHIFT(p.formant), vib = 5 + p.vibrato * 22;
    const s = singer(v, ctx, t, {
      f, light, tracts: [{ shift: sh * 1.03, pan: -0.8, singers: crowd(3, 9, vib, 4.6, 5.6) }, { shift: sh * 0.98, pan: 0.8, singers: crowd(3, 9, vib, 4.6, 5.6) }], lightSingers: 2,
      frame: vowelAt(Math.max(0, p.vowel - 0.2)), target: vowelAt(p.vowel), morphAt: 0.1, morphTc: 0.4 + p.swell,
      motion: { to: vowelAt(p.vowel > 0.5 ? p.vowel - 0.25 : p.vowel + 0.25), amount: p.motion, rate: 0.05 + p.motion * 0.07 },
      tilt: 1.35, h1: 2.0, bright: 0.1, breath: 0.25, air: 0.15 + p.air * 0.7, jitter: 0.5, voiced: 1, octave: light ? 0 : p.shimmer, level: 0.036,
    });
    const amp = v.gain(0); v.amps.push(amp.gain);
    // shimmer: the top of the voice flickers slowly (two beating high shelves)
    if (!light && p.shimmer > 0.01) {
      const hs = v.filter('highshelf', 3500, 0.7); hs.gain.value = 2 + p.shimmer * 5; s.out.connect(hs);
      const fl = v.gain(1 - p.shimmer * 0.3); hs.connect(fl); fl.connect(amp);
      v.lfo(rand(0.31, 0.47), p.shimmer * 0.3, fl.gain, t);
    } else s.out.connect(amp);
    amp.connect(v.out);
    const pk = a * p.level, at = 0.4 + p.swell * p.swell * 4;
    amp.gain.setValueAtTime(0, t); amp.gain.setTargetAtTime(pk, t, at / 2.6);
    v.rel = 0.8 + p.release * 4;
    return v;
  },
};

export const VOCALS = [femchoir, solovoice, vocalchops, breathvox, angelpad];
export const VOCALS_MAP = Object.fromEntries(VOCALS.map(d => [d.id, d]));
