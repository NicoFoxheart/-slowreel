// asian.js - Slowreel "East Asian" pack: Korean, Chinese and Japanese inspired instruments, all synthesized
// (no samples, no worklets). Plucked strings are waveguide / Karplus-Strong models computed in JS into cached buffers
// (pluck position, finger / pick softness, frequency-dependent loss, fractional-delay tuning, sawari bridge buzz, a
// soundboard or skin body); bowed strings are subtractive with formant bodies, bow noise and pitch jitter; flutes mix a
// tone with pitched breath noise and a level-driven membrane buzz; bells, gongs and drums are modal (additive sines with
// beating doublets / membrane modes); wind chimes are a gusty texture that strikes cached modal buffers.
//
// Same definition format as instruments.js: {id, name, kind, maxVoices, params:[...], macros:[ids], presets:[{id,name,params}],
// voice(ctx, env, P, midi, vel, t)} -> voice {out, release(t), stop(t), kill(t), endTime, nodes, dead, tick?}.
// Drum instruments (janggu, taiko) have kind 'drums' and a `drumMap` [{midi, name, short}] for MIDI 36-40.
// Wind chimes have kind 'texture': hold one long note; the note sets the root the chimes are tuned to.
// Light mode (env.light, set by the engine): fewer partials / formants / modes, no stereo doublets, no shimmer copy, no
// pitch jitter, fewer chime strikes. The engine halves maxVoices on its own.
//
// Integrator:  import { ASIAN, ASIAN_SCALES } from './asian.js';
//              INSTRUMENTS.push(...ASIAN); for (const d of ASIAN) INSTRUMENT_MAP[d.id] = d;
import { clamp, mtof, rng, noiseBuffer, wave, disconnectAll, krate, krateFilter, cached, release as relParam } from './util.js?v=9d';

const P = (id, name, min, max, def, extra = {}) => ({ id, name, min, max, default: def, unit: '', ...extra });
const ENUM = (id, name, options, def) => ({ id, name, min: 0, max: options.length - 1, default: def, unit: '', type: 'enum', options });
const TOGGLE = (id, name, def) => P(id, name, 0, 1, def, { type: 'toggle' });
const keyScale = (midi, per = 24) => Math.pow(2, (60 - midi) / per);   // low notes ring longer
const R = rng(1592);   // deterministic "randomness": the same render every time
const rand = (a = 0, b = 1) => a + (b - a) * R();
const vel2amp = v => Math.pow(clamp(v, 0, 1), 1.4);
const centsOf = ratio => 1200 * Math.log2(ratio);

// ---------------------------------------------------------------- scales (semitones from the tonic)
export const ASIAN_SCALES = [
  { id: 'pyeongjo', name: 'Pyeongjo', region: 'Korean', intervals: [0, 2, 5, 7, 9] },
  { id: 'gyemyeonjo', name: 'Gyemyeonjo', region: 'Korean', intervals: [0, 3, 5, 7, 10] },
  { id: 'gong', name: 'Gong mode', region: 'Chinese', intervals: [0, 2, 4, 7, 9] },
  { id: 'shang', name: 'Shang mode', region: 'Chinese', intervals: [0, 2, 5, 7, 10] },
  { id: 'jue', name: 'Jue mode', region: 'Chinese', intervals: [0, 3, 5, 8, 10] },
  { id: 'zhi', name: 'Zhi mode', region: 'Chinese', intervals: [0, 2, 5, 7, 9] },
  { id: 'yu', name: 'Yu mode', region: 'Chinese', intervals: [0, 3, 5, 7, 10] },
  { id: 'hirajoshi', name: 'Hirajoshi', region: 'Japanese', intervals: [0, 2, 3, 7, 8] },
  { id: 'in', name: 'In (Miyako-bushi)', region: 'Japanese', intervals: [0, 1, 5, 7, 8] },
  { id: 'yo', name: 'Yo', region: 'Japanese', intervals: [0, 2, 5, 7, 9] },
  { id: 'iwato', name: 'Iwato', region: 'Japanese', intervals: [0, 1, 5, 6, 10] },
  { id: 'kumoi', name: 'Kumoi', region: 'Japanese', intervals: [0, 2, 3, 7, 9] },
  { id: 'ryukyu', name: 'Ryukyu', region: 'Japanese', intervals: [0, 4, 5, 7, 11] },
];

// ---------------------------------------------------------------- voice plumbing (same contract as instruments.js)
class Voice {
  constructor(ctx, env, t) {
    this.ctx = ctx; this.env = env; this.t0 = t; this.out = ctx.createGain(); this.out.gain.value = 1;
    this.srcs = []; this.nodes = [this.out]; this.amps = []; this.rel = 0.5; this.endTime = Infinity;
    this.released = false; this.relAt = Infinity; this.extras = new Set();
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
  src(buffer, t) { const s = this.ctx.createBufferSource(); s.buffer = buffer; s.start(t); this.srcs.push(s); return this.node(s); }
  constant(v, t) { const c = this.ctx.createConstantSource(); c.offset.value = v; c.start(t); this.srcs.push(c); return this.node(c); }
  lfo(rate, depth, params, t, type = 'sine') {
    const l = this.osc(type, rate, t), g = this.gain(depth); l.connect(g); (Array.isArray(params) ? params : [params]).forEach(p => g.connect(p)); return g;
  }
  // several tick handlers on one voice (the engine calls v.tick(until))
  addTick(fn) { const prev = this.tick; this.tick = prev ? (u => { prev(u); fn(u); }) : fn; }
  shaper(curve) { const w = this.ctx.createWaveShaper(); w.curve = curve; return this.node(w); }
  // one-shot sources made after the voice started (tremolo plucks, chime strikes): freed when they end or with the voice
  extra(src, ...nodes) {
    const item = [src, ...nodes]; this.extras.add(item);
    src.onended = () => { if (!this.extras.has(item)) return; this.extras.delete(item); disconnectAll(...item); this.onExtraEnded?.(item); };
    return item;
  }
  release(t, r = this.rel) {
    if (this.released) return; this.released = true;
    t = Math.max(t, this.ctx.currentTime); this.relAt = t;
    if (this.oneShot) return;                     // plucked-and-ring / struck voices ring out past the note-off
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
    const done = () => {
      if (this.dead) return; this.dead = true; disconnectAll(...this.nodes);
      for (const item of this.extras) { try { item[0].stop(); } catch (e) { } disconnectAll(...item); }
      this.extras.clear(); this.env.voiceEnded?.(this);
    };
    if (first) first.onended = done; else done();
  }
  kill(t, fade = 0.04) {
    t = Math.max(t, this.ctx.currentTime);
    for (const a of this.amps) relParam(a, t, fade);
    this.released = true; this.relAt = Math.min(this.relAt, t);
    this.onRelease?.(t, fade);
    this.stop(t + fade * 2);
  }
  // a source whose envelope is below -100 dB by `until` stops there (same sound, less work for the audio thread)
  transient(src, until) { const i = this.srcs.indexOf(src); if (i > 0) { this.srcs.splice(i, 1); try { src.stop(until); } catch (e) { } } }
  stereo() { this.out.channelCount = 2; this.out.channelCountMode = 'explicit'; this.out.channelInterpretation = 'speakers'; }
}

// mono / legato memory per track (keyed by the track's resolved params object, one per track)
const monoMem = new WeakMap();
function monoLink(v, p, f, t, on) {
  if (!on) return { from: f, legato: false };
  const prev = monoMem.get(p);
  let from = f, legato = false;
  if (prev && !prev.v.dead && prev.v !== v) {
    legato = prev.v.relAt > t - 0.03 && prev.t0 < t - 0.005;   // the previous note is still held (or only just let go)
    if (legato) from = prev.f;
    if (prev.v.endTime > t) prev.v.kill(t, legato ? 0.045 : 0.03);
  }
  monoMem.set(p, { v, f, t0: t });
  return { from, legato };
}

// ---------------------------------------------------------------- buffer cache (per context, LRU, ~64 MB)
const bufCache = new WeakMap();
const BUF_BUDGET = 64 * 1024 * 1024;
function lruBuffer(ctx, key, make) {
  let c = bufCache.get(ctx);
  if (!c) { c = { map: new Map(), bytes: 0 }; bufCache.set(ctx, c); }
  const hit = c.map.get(key);
  if (hit) { c.map.delete(key); c.map.set(key, hit); return hit; }
  const d = make(ctx.sampleRate);
  const buf = ctx.createBuffer(1, d.length, ctx.sampleRate); buf.copyToChannel(d, 0);
  c.map.set(key, buf); c.bytes += d.length * 4;
  while (c.bytes > BUF_BUDGET && c.map.size > 1) { const [k, b] = c.map.entries().next().value; c.map.delete(k); c.bytes -= b.length * 4; }
  return buf;
}

// RBJ band-pass (0 dB peak), applied in place-free style: returns a new array
function bandpass(x, sr, f, q) {
  const w0 = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, al = Math.sin(w0) / (2 * q), a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - al) / a0;
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const xi = x[i], yi = b0 * xi + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi; }
  return y;
}
function finish(d, sr, fadeSec = 0.03) {
  // DC block, normalise to peak 1, fade the very end
  let x1 = 0, y1 = 0; for (let i = 0; i < d.length; i++) { const y = d[i] - x1 + 0.9985 * y1; x1 = d[i]; y1 = y; d[i] = y; }
  let pk = 1e-9; for (let i = 0; i < d.length; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > pk) pk = a; }
  const g = 1 / pk, fo = Math.min(d.length, Math.round(sr * fadeSec));
  for (let i = 0; i < d.length; i++) d[i] *= g * (i >= d.length - fo ? (d.length - i) / fo : 1);
  return d;
}

// ---------------------------------------------------------------- plucked string waveguide
// o: {f, t60, s (loop lowpass weight 0.05..0.5), pos (pluck position), soft (finger/pick smoothing 0..1, 1 = sharp), noise,
//     buzz (sawari 0..1), body [[f, q, gain]...], dry, click, clickTc, clickHp, thump [f, tc, gain], len}
function stringFloats(sr, o, seed) {
  const Pd = sr / o.f, s = clamp(o.s, 0.02, 0.5);
  const L = Math.max(2, Math.floor(Pd - s - 0.1)), d = Pd - s - L, a = (1 - d) / (1 + d);
  const w0 = 2 * Math.PI * o.f / sr, mag = Math.hypot(1 - s + s * Math.cos(w0), s * Math.sin(w0));
  const buzz = clamp(o.buzz || 0, 0, 1);
  // per-period loss for the wanted T60 at the fundamental (the loop lowpass is compensated at f0); the sawari clip
  // loses a little energy every period, so a buzzing string gets a slightly higher loop gain back
  const g = Math.min(0.99993, Math.pow(0.001, 1 / (o.t60 * o.f)) / mag * (1 + buzz * 0.006));
  const n = Math.ceil(sr * o.len), out = new Float32Array(n), dl = new Float32Array(L);
  // excitation: the force a pluck at `pos` puts on the bridge (a pulse with notches at multiples of 1/pos),
  // rounded by the finger or pick (one-pole lowpass, run round the period twice so it starts settled) plus some noise
  const E = Math.max(2, Math.round(Pd)), ex = new Float32Array(E), r = rng(seed);
  const bw = Math.max(1, Math.round(o.pos * E));
  for (let i = 0; i < E; i++) ex[i] = (i < bw ? 1 : -bw / (E - bw)) + (r() * 2 - 1) * o.noise;
  let z = 0; for (let k = 0; k < 2; k++) for (let i = 0; i < E; i++) { z += o.soft * (ex[i] - z); if (k) ex[i] = z; }
  let mean = 0; for (let i = 0; i < E; i++) mean += ex[i]; mean /= E;
  let pk = 1e-9; for (let i = 0; i < E; i++) { ex[i] -= mean; pk = Math.max(pk, Math.abs(ex[i])); }
  for (let i = 0; i < E; i++) ex[i] /= pk;
  let w = 0, apx = 0, apy = 0, prev = 0, envF = 0;
  const envRel = Math.exp(-1 / (Pd * 3)), keep = 1 - buzz * 0.5, give = 1 - buzz * 0.8;
  for (let i = 0; i < n; i++) {
    const v = dl[w];
    const ap = a * v + apx - a * apy; apx = v; apy = ap;          // fractional delay (tuning)
    let y = g * ((1 - s) * ap + s * prev); prev = ap;              // loss: highs die sooner
    if (buzz > 0) {                                               // sawari: the string grazes a curved bridge on one side
      const ay = y < 0 ? -y : y; envF = ay > envF ? ay : envF * envRel;
      const b = envF * keep; if (y > b) y = b + (y - b) * give;
    }
    const x = (i < E ? ex[i] : 0) + y;
    dl[w] = x; if (++w === L) w = 0;
    out[i] = x;
  }
  // body: parallel resonances (soundboard / skin) mixed with the dry string, plus the pick click and the skin thump
  const res = new Float32Array(n);
  for (let i = 0; i < n; i++) res[i] = out[i] * o.dry;
  for (const [bf, bq, bg] of o.body || []) { const b = bandpass(out, sr, bf, bq); for (let i = 0; i < n; i++) res[i] += b[i] * bg; }
  if (o.click > 0) {
    const cl = Math.min(n, Math.round(sr * o.clickTc * 9)), hp = Math.exp(-2 * Math.PI * (o.clickHp || 2000) / sr);
    let lp = 0;
    for (let i = 0; i < cl; i++) { const wn = r() * 2 - 1; lp = hp * lp + (1 - hp) * wn; res[i] += (wn - lp) * o.click * Math.exp(-i / (sr * o.clickTc)); }
  }
  if (o.thump) {
    const [tf, tc, tg] = o.thump, tl = Math.min(n, Math.round(sr * tc * 9));
    for (let i = 0; i < tl; i++) res[i] += Math.sin(2 * Math.PI * tf * i / sr) * tg * Math.exp(-i / (sr * tc)) * Math.min(1, i / (sr * 0.0015));
  }
  return finish(res, sr, 0.04);
}
const q10 = x => Math.round(clamp(x, 0, 1) * 10) / 10;
function stringBuffer(ctx, def, p, midi) {
  const vals = def.bufParams.map(id => q10(p[id]));
  const key = `str:${def.id}:${midi}:${vals.join(':')}`;
  return lruBuffer(ctx, key, sr => {
    const q = Object.fromEntries(def.bufParams.map((id, i) => [id, vals[i]]));
    const o = def.string(q, midi);
    o.f = mtof(midi); o.len = Math.min(o.maxLen || 6, o.t60 * 1.05 + 0.08);
    return stringFloats(sr, o, midi * 131 + def.id.length * 17);
  });
}

// expressive pitch gestures on a pitch bus (cents). Returns the lowest cents reached (for the stop time).
const GESTURE_KIND = { chuseong: 'rise', toeseong: 'fall', jeonseong: 'turn', shanghua: 'rise', xiahua: 'fall', huihua: 'turn',
  'ato-oshi': 'rise', 'oshi-hanashi': 'press', 'tsuki-iro': 'turn', tui: 'rise', huiyin: 'turn', 'suri-age': 'scoop', 'suri-sage': 'fall' };
function gesture(param, name, cents, t, delay = 0.2) {
  const k = GESTURE_KIND[name];
  if (!k || cents < 1) return 0;
  if (k === 'rise') { param.setValueAtTime(0, t + delay); param.setTargetAtTime(cents, t + delay, 0.07); return 0; }
  if (k === 'fall') { param.setValueAtTime(0, t + delay); param.setTargetAtTime(-cents, t + delay, 0.09); return -cents; }
  if (k === 'turn') { param.setValueAtTime(0, t + delay * 0.8); param.setTargetAtTime(cents, t + delay * 0.8, 0.045); param.setTargetAtTime(0, t + delay * 0.8 + 0.2, 0.06); return 0; }
  if (k === 'press') { param.setValueAtTime(cents, t); param.setValueAtTime(cents, t + delay * 0.9); param.setTargetAtTime(0, t + delay * 0.9, 0.06); return 0; }
  if (k === 'scoop') { param.setValueAtTime(-cents, t); param.setTargetAtTime(0, t + 0.005, 0.04); return -cents; }
  return 0;
}
// delayed vibrato into a pitch bus (or detune params): depth ramps in after the pluck / bow settles
function vibrato(v, rate, cents, into, t, delay, ramp) {
  if (cents < 0.5) return null;
  const l = v.osc('sine', rate, t), g = v.gain(0); l.connect(g); (Array.isArray(into) ? into : [into]).forEach(p => g.connect(p));
  g.gain.setValueAtTime(0, t + delay); g.gain.linearRampToValueAtTime(cents, t + delay + ramp);
  return g;
}

// one plucked-string voice (zithers and lutes share it; pipa adds tremolo on top)
function pluckVoice(def, ctx, env, p, midi, vel, t, natural = true) {
  const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel), light = env.light;
  const pb = v.constant(0, t);   // pitch bus in cents (bends, vibrato) -> every string source's detune
  const buf = stringBuffer(ctx, def, p, midi);
  const amp = v.gain(0); v.amps.push(amp.gain);
  const lp = v.filter('lowpass', clamp(f * (def.lp[0] + p.tone * def.lp[1]) * (0.45 + vel * 0.7), 700, 16000), 0.5);
  lp.connect(amp);
  if (!light && def.width) { const pn = v.pan(clamp((midi - 62) / 30, -1, 1) * def.width); amp.connect(pn); pn.connect(v.out); }
  else amp.connect(v.out);
  const s1 = v.src(buf, t); pb.connect(s1.detune); s1.connect(lp);
  const sh = p.shimmer || 0;
  let main = 1;
  if (!light && sh > 0.02) {   // a second, slightly detuned copy: the steel-string shimmer / sympathetic beating
    const s2 = v.src(buf, t); s2.detune.value = 2 + sh * 5; pb.connect(s2.detune);
    const g2 = v.gain(sh * 0.45); s2.connect(g2); g2.connect(lp); main = 1 / (1 + sh * 0.45);
  }
  // ornaments only on notes that are held: bends and nonghyeon / yuri on sustained tones, never on every note of a run.
  // The engine ticks a new voice once before it knows the note-off (scheduled notes learn it in the same pass), so
  // the first tick only primes; live notes decide just before the bend would start, if the key is still down.
  const kind = GESTURE_KIND[p.gesture], cents = p.bend * def.bendCents;
  const lo = kind === 'fall' || kind === 'scoop' ? -cents : 0;
  const vg = p.vibrato > 0.01 ? vibrato(v, def.vibRate * rand(0.92, 1.08), 1, pb.offset, t, 0, 0.001) : null;
  if (vg) { vg.gain.cancelScheduledValues(t); vg.gain.setValueAtTime(0, t); }
  let primed = false, bendDone = !kind || cents < 1, vibDone = !vg;
  if (!bendDone && (kind === 'press' || kind === 'scoop')) { gesture(pb.offset, p.gesture, cents, t, def.bendDelay); bendDone = true; }   // these shape the attack itself
  v.addTick((until) => {
    if (!primed) { primed = true; return; }
    const now = ctx.currentTime, held = d => (v.relAt < Infinity ? v.relAt - t >= d : now >= t + d - 0.08);
    const due = d => v.relAt < Infinity || now >= t + d - 0.08;
    if (!bendDone && due(def.bendDelay)) { bendDone = true; if (held(def.bendDelay + 0.12)) gesture(pb.offset, p.gesture, cents, Math.max(t, now + 0.01 - def.bendDelay), def.bendDelay); }
    if (!vibDone && due(def.vibDelay)) {
      vibDone = true;
      if (held(def.vibDelay + 0.15)) { const at = Math.max(t + def.vibDelay, now + 0.01); vg.gain.setValueAtTime(0, at); vg.gain.linearRampToValueAtTime(p.vibrato * def.vibCents, at + def.vibRamp); }
    }
    void until;
  });
  v.onRelease = (rt, r) => { if (vg && r > 0.06) { vg.gain.cancelAndHoldAtTime?.(rt); vg.gain.setTargetAtTime(0, rt, 0.25); } };   // the left hand lets go
  amp.gain.setValueAtTime(a * def.gain * p.level * main, t);
  v.rel = def.rel(p);   // strings ring on a while past the note-off (zithers longest), then the hand damps them
  v.buf = buf; v.pb = pb; v.lp = lp;
  if (natural) v.stop(t + buf.duration / Math.pow(2, Math.min(0, lo) / 1200) + 0.06);
  return v;
}

// ---------------------------------------------------------------- 1. Gayageum (Korean silk zither)
const GAYA_GEST = [{ value: 'none', label: 'None' }, { value: 'chuseong', label: 'Chuseong (rise)' }, { value: 'toeseong', label: 'Toeseong (fall)' }, { value: 'jeonseong', label: 'Jeonseong (turn)' }];
const gayageumDef = {
  id: 'gayageum', bufParams: ['tone', 'ring'], width: 0.35, lp: [3, 10], gain: 0.34,
  bendCents: 200, bendDelay: 0.24, vibRate: 4.8, vibCents: 85, vibDelay: 0.22, vibRamp: 0.7,
  rel: p => 0.5 + p.ring * 1.2,
  string: (q, midi) => ({ t60: (1.3 + q.ring * 3.4) * keyScale(midi, 30), s: 0.5 - q.tone * 0.32, pos: 0.17, soft: 0.1 + q.tone * 0.32, noise: 0.06,
    body: [[105, 1.3, 0.5], [235, 1.6, 0.65], [470, 2, 0.4], [1150, 2.4, 0.16]], dry: 0.55, click: 0.012, clickTc: 0.004, clickHp: 1800, maxLen: 6.5 }),
};
const gayageum = {
  id: 'gayageum', name: 'Gayageum', kind: 'synth', maxVoices: 12,
  params: [P('tone', 'Silk tone', 0, 1, 0.4), P('ring', 'Ring', 0, 1, 0.5), P('vibrato', 'Nonghyeon', 0, 1, 0.45), P('bend', 'Bend', 0, 1, 0.5),
    ENUM('gesture', 'Gesture', GAYA_GEST, 'none'), P('level', 'Level', 0, 1.5, 1)],
  macros: ['tone', 'ring', 'vibrato', 'bend'],
  presets: [
    { id: 'sanjo-silk', name: 'Sanjo Silk', params: { vibrato: 0.6, gesture: 'chuseong', bend: 0.5 } },
    { id: 'court-jeongak', name: 'Court Jeongak', params: { tone: 0.32, ring: 0.62, vibrato: 0.28, bend: 0.3, gesture: 'jeonseong' } },
    { id: 'moonlit-gayageum', name: 'Moonlit Strings', params: { tone: 0.18, ring: 0.85, vibrato: 0.35, bend: 0.25, gesture: 'toeseong', level: 1.15 } },
    { id: 'bright-25', name: '25-String Bright', params: { tone: 0.75, ring: 0.45, vibrato: 0.15, bend: 0, gesture: 'none', level: 0.9 } },
  ],
  voice(ctx, env, p, midi, vel, t) { return pluckVoice(gayageumDef, ctx, env, p, midi, vel, t); },
};

// ---------------------------------------------------------------- 2. Guzheng (Chinese zither, glissando-friendly)
const ZHENG_GEST = [{ value: 'none', label: 'None' }, { value: 'shanghua', label: 'Shang hua (slide up)' }, { value: 'xiahua', label: 'Xia hua (slide down)' }, { value: 'huihua', label: 'Hui hua (up and back)' }];
const guzhengDef = {
  id: 'guzheng', bufParams: ['tone', 'ring'], width: 0.55, lp: [4, 16], gain: 0.3,
  bendCents: 200, bendDelay: 0.18, vibRate: 5.6, vibCents: 45, vibDelay: 0.3, vibRamp: 0.6,
  rel: p => 0.6 + p.ring * 1.6,
  string: (q, midi) => ({ t60: (2 + q.ring * 4.2) * keyScale(midi, 28), s: 0.36 - q.tone * 0.28, pos: 0.12, soft: 0.35 + q.tone * 0.55, noise: 0.2,
    body: [[150, 1.2, 0.35], [380, 1.6, 0.35], [920, 1.8, 0.25], [2800, 1.5, 0.3]], dry: 0.8, click: 0.09, clickTc: 0.0025, clickHp: 3000, maxLen: 7 }),
};
const guzheng = {
  id: 'guzheng', name: 'Guzheng', kind: 'synth', maxVoices: 16,
  params: [P('tone', 'Brightness', 0, 1, 0.55), P('ring', 'Ring', 0, 1, 0.55), P('vibrato', 'Chan yin', 0, 1, 0.3), P('bend', 'Bend', 0, 1, 0.5),
    ENUM('gesture', 'Gesture', ZHENG_GEST, 'none'), P('shimmer', 'Steel shimmer', 0, 1, 0.35), P('level', 'Level', 0, 1.5, 1)],
  macros: ['tone', 'ring', 'vibrato', 'bend'],
  presets: [
    { id: 'guzheng', name: 'Guzheng', params: {} },
    { id: 'mountain-stream', name: 'Mountain Stream', params: { tone: 0.72, ring: 0.75, vibrato: 0.15, shimmer: 0.5, level: 0.85 } },
    { id: 'silk-rain', name: 'Silk Rain', params: { tone: 0.3, ring: 0.6, vibrato: 0.35, shimmer: 0.2, level: 1.1 } },
    { id: 'zheng-bend', name: 'Pressed Bends', params: { tone: 0.5, ring: 0.5, vibrato: 0.55, bend: 0.6, gesture: 'huihua', shimmer: 0.3 } },
  ],
  voice(ctx, env, p, midi, vel, t) { return pluckVoice(guzhengDef, ctx, env, p, midi, vel, t); },
};

// ---------------------------------------------------------------- 3. Koto (Japanese 13-string zither)
const KOTO_GEST = [{ value: 'none', label: 'None' }, { value: 'ato-oshi', label: 'Ato-oshi (press after)' }, { value: 'oshi-hanashi', label: 'Oshi-hanashi (press, let go)' }, { value: 'tsuki-iro', label: 'Tsuki-iro (quick push)' }];
const kotoDef = {
  id: 'koto', bufParams: ['tone', 'ring'], width: 0.4, lp: [4, 18], gain: 0.3,
  bendCents: 200, bendDelay: 0.2, vibRate: 5, vibCents: 40, vibDelay: 0.35, vibRamp: 0.6,
  rel: p => 0.4 + p.ring * 1.1,
  string: (q, midi) => ({ t60: (1.2 + q.ring * 3) * keyScale(midi, 30), s: 0.4 - q.tone * 0.3, pos: 0.1, soft: 0.45 + q.tone * 0.5, noise: 0.25,
    body: [[140, 1.3, 0.45], [330, 1.8, 0.45], [800, 2, 0.3], [2200, 2, 0.3]], dry: 0.72, click: 0.16, clickTc: 0.0022, clickHp: 3500, maxLen: 6 }),
};
const koto = {
  id: 'koto', name: 'Koto', kind: 'synth', maxVoices: 12,
  params: [P('tone', 'Tsume', 0, 1, 0.6), P('ring', 'Ring', 0, 1, 0.45), P('bend', 'Oshide', 0, 1, 0.5), P('vibrato', 'Yuri', 0, 1, 0.2),
    ENUM('gesture', 'Gesture', KOTO_GEST, 'none'), P('shimmer', 'Shimmer', 0, 1, 0.1), P('level', 'Level', 0, 1.5, 1)],
  macros: ['tone', 'ring', 'bend', 'vibrato'],
  presets: [
    { id: 'koto', name: 'Koto', params: {} },
    { id: 'oshide-koto', name: 'Oshide Koto', params: { gesture: 'ato-oshi', bend: 0.5, vibrato: 0.35 } },
    { id: 'snow-koto', name: 'Snow Koto', params: { tone: 0.3, ring: 0.7, vibrato: 0.15, gesture: 'tsuki-iro', bend: 0.25, shimmer: 0.25, level: 1.1 } },
    { id: 'bass-koto', name: '17-String Bass', params: { tone: 0.42, ring: 0.8, vibrato: 0.1, gesture: 'oshi-hanashi', bend: 0.3, level: 1.05 } },
  ],
  voice(ctx, env, p, midi, vel, t) { return pluckVoice(kotoDef, ctx, env, p, midi, vel, t); },
};

// ---------------------------------------------------------------- 4. Pipa (Chinese lute, lunzhi tremolo)
const PIPA_GEST = [{ value: 'none', label: 'None' }, { value: 'tui', label: 'Tui (push bend)' }, { value: 'huiyin', label: 'Hui yin (bend and back)' }];
const pipaDef = {
  id: 'pipa', bufParams: ['tone', 'ring'], width: 0.25, lp: [4, 16], gain: 0.3,
  bendCents: 200, bendDelay: 0.16, vibRate: 6, vibCents: 35, vibDelay: 0.25, vibRamp: 0.5,
  rel: p => 0.2 + p.ring * 0.6,
  string: (q, midi) => ({ t60: (0.8 + q.ring * 2.2) * keyScale(midi, 30), s: 0.34 - q.tone * 0.26, pos: 0.13, soft: 0.45 + q.tone * 0.5, noise: 0.25,
    body: [[260, 1.6, 0.5], [620, 2, 0.45], [1500, 2.2, 0.32], [3200, 1.8, 0.22]], dry: 0.7, click: 0.15, clickTc: 0.002, clickHp: 3000, maxLen: 4 }),
};
const pipa = {
  id: 'pipa', name: 'Pipa', kind: 'synth', maxVoices: 8,
  params: [P('tone', 'Nail', 0, 1, 0.6), P('ring', 'Ring', 0, 1, 0.45), P('tremolo', 'Lunzhi', 0, 1, 0), P('bend', 'Bend', 0, 1, 0.4),
    ENUM('gesture', 'Gesture', PIPA_GEST, 'none'), P('vibrato', 'Vibrato', 0, 1, 0.2), P('level', 'Level', 0, 1.5, 1)],
  macros: ['tone', 'ring', 'tremolo', 'bend'],
  presets: [
    { id: 'pipa', name: 'Pipa', params: {} },
    { id: 'lunzhi-tremolo', name: 'Lunzhi Tremolo', params: { tremolo: 0.65, ring: 0.4, tone: 0.62 } },
    { id: 'moon-pipa', name: 'Moon Pipa', params: { tone: 0.32, ring: 0.65, tremolo: 0.35, vibrato: 0.3, gesture: 'huiyin', bend: 0.35, level: 1.1 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const trem = p.tremolo >= 0.02;
    const v = pluckVoice(pipaDef, ctx, env, p, midi, vel, t, !trem);   // with tremolo the voice lives until the note-off
    if (!trem) return v;
    // lunzhi: the five fingers roll over the string while the note is held (after a short first pluck).
    // Each re-pluck restarts the string (the previous one fades in 8 ms), so the level stays put.
    const rate = 9 + p.tremolo * 9, hold = 0.22 - p.tremolo * 0.08, plucks = [];
    let next = t + hold, k = 0, prevG = null, primed = false;
    v.addTick((until) => {
      // the engine ticks a new voice once before it knows the note-off (scheduled notes get it right after), so the
      // first call only primes; the next one (same scheduler pass, or 25 ms later live) queues the re-plucks
      if (!primed) { primed = true; return; }
      const end = Math.min(until, v.relAt - 0.01, v.endTime - 0.05);
      while (next < end) {
        const s = ctx.createBufferSource(), g = ctx.createGain();
        s.buffer = v.buf; v.pb.connect(s.detune);
        const acc = (k % 4 === 0 ? 1 : 0.72) * rand(0.85, 1.05) * (0.75 + p.tremolo * 0.15);   // finger order: index leads
        g.gain.value = acc; s.connect(g); g.connect(v.lp);
        s.start(next);
        // the next finger meets the string a moment before it plucks: a short damp, then the new attack
        if (prevG) { const d0 = next - 0.014; prevG.g.gain.setValueAtTime(prevG.acc, d0); prevG.g.gain.setTargetAtTime(0, d0, 0.006); prevG.s.stop(next + 0.06); }
        const item = { s, g, acc, at: next }; plucks.push(item); prevG = item; v.extra(s, g);
        if (plucks.length > 12) plucks.shift();
        k++; next += (1 / rate) * rand(0.9, 1.1);
      }
    });
    const baseRelease = v.onRelease;
    v.onRelease = (rt, r) => {
      baseRelease?.(rt, r);   // plucks already queued past the note-off never sound; the last real one rings out
      for (const it of plucks) if (it.at >= rt) { try { it.s.stop(it.at); } catch (e) { } }
      const last = plucks.filter(it => it.at < rt).pop();
      if (last) { last.g.gain.cancelScheduledValues(rt - 0.014); try { last.s.stop(rt + 4); } catch (e) { } }
    };
    return v;
  },
};

// ---------------------------------------------------------------- 5. Shamisen (Japanese lute, sawari buzz)
const SHAMI_GEST = [{ value: 'none', label: 'None' }, { value: 'suri-age', label: 'Suri-age (slide up into)' }, { value: 'suri-sage', label: 'Suri-sage (slide down)' }];
const shamisenDef = {
  id: 'shamisen', bufParams: ['tone', 'ring', 'sawari', 'skin'], width: 0.15, lp: [5, 18], gain: 0.3,
  bendCents: 200, bendDelay: 0.25, vibRate: 5.5, vibCents: 30, vibDelay: 0.3, vibRamp: 0.5,
  rel: p => 0.18 + p.ring * 0.7,
  string: (q, midi) => ({ t60: (0.9 + q.ring * 2.2) * keyScale(midi, 30), s: 0.3 - q.tone * 0.24, pos: 0.08, soft: 0.55 + q.tone * 0.45, noise: 0.3,
    buzz: q.sawari * 0.9, body: [[200 + q.skin * 40, 2.4, 0.7], [560, 2.5, 0.5], [1250, 2.2, 0.45], [2600, 1.8, 0.4]], dry: 0.55,
    click: 0.08 + q.skin * 0.3, clickTc: 0.003, clickHp: 1600, thump: q.skin > 0.02 ? [210 + q.skin * 60, 0.03, q.skin * 0.9] : null, maxLen: 4.5 }),
};
const shamisen = {
  id: 'shamisen', name: 'Shamisen', kind: 'synth', maxVoices: 8,
  params: [P('tone', 'Bachi', 0, 1, 0.6), P('sawari', 'Sawari', 0, 1, 0.5), P('skin', 'Skin snap', 0, 1, 0.5), P('ring', 'Ring', 0, 1, 0.45),
    ENUM('gesture', 'Gesture', SHAMI_GEST, 'none'), P('bend', 'Slide', 0, 1, 0.4), P('vibrato', 'Vibrato', 0, 1, 0.1), P('level', 'Level', 0, 1.5, 1)],
  macros: ['tone', 'sawari', 'skin', 'ring'],
  presets: [
    { id: 'tsugaru', name: 'Tsugaru', params: { tone: 0.75, sawari: 0.55, skin: 0.8, ring: 0.4 } },
    { id: 'nagauta', name: 'Nagauta', params: { tone: 0.55, sawari: 0.4, skin: 0.4, ring: 0.45, gesture: 'suri-age', bend: 0.3 } },
    { id: 'jiuta-night', name: 'Jiuta Night', params: { tone: 0.35, sawari: 0.7, skin: 0.25, ring: 0.7, vibrato: 0.25, level: 1.1 } },
    { id: 'sanshin', name: 'Sanshin (Okinawa)', params: { tone: 0.4, sawari: 0, skin: 0.2, ring: 0.55, vibrato: 0.2, gesture: 'suri-age', bend: 0.25, level: 1.05 } },
  ],
  voice(ctx, env, p, midi, vel, t) { return pluckVoice(shamisenDef, ctx, env, p, midi, vel, t); },
};

// ---------------------------------------------------------------- bowed strings (haegeum, erhu)
const bowedWave = ctx => wave(ctx, 'asian-bow', Array.from({ length: 40 }, (_, i) => { const n = i + 1; return (1 / n) * (0.55 + 0.45 * Math.abs(Math.sin(n * Math.PI * 0.115))); }));
function bowedVoice(S, ctx, env, p, midi, vel, t) {
  const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel), light = env.light;
  const pb = v.constant(0, t);
  const { from, legato } = monoLink(v, p, f, t, p.legato >= 0.5);
  const o = v.osc(bowedWave(ctx), f, t); pb.connect(o.detune);
  const lp = v.filter('lowpass', clamp(f * (2.2 + p.bright * 7) * (0.6 + vel * 0.55), 700, 12000), 0.6);
  const sum = v.gain(1), hp = v.filter('highpass', S.hp, 0.7), amp = v.gain(0), press = v.gain(1);
  v.amps.push(amp.gain);
  o.connect(lp);
  const dry = v.gain(S.dry); lp.connect(dry); dry.connect(sum);
  const forms = light ? S.formants.slice(0, 2) : S.formants;
  for (const [ff, fq, fg] of forms) { const b = v.filter('bandpass', ff, fq), g = v.gain(fg * (light ? 1.25 : 1)); lp.connect(b); b.connect(g); g.connect(sum); }
  // bow hair on the string: noise around the body resonances, under the same envelope
  const nz = v.noise('white', t), nb = v.filter('bandpass', clamp(f * 2.5, S.noiseLo, S.noiseHi), 1.1), ng = v.gain(S.noise * (0.4 + p.bow * 0.9));
  nz.connect(nb); nb.connect(ng); ng.connect(sum);
  sum.connect(hp); hp.connect(press); press.connect(amp); amp.connect(v.out);
  // pitch: slide in from the previous note (legato), or a small scoop from below; vibrato after the bow settles;
  // the left hand never holds a fretless string perfectly still (slow random jitter)
  const slide = 0.03 + p.slide * 0.32;
  if (legato && Math.abs(from - f) > 0.5) { pb.offset.setValueAtTime(centsOf(from / f), t); pb.offset.setTargetAtTime(0, t + 0.01, slide / 3); }
  else if (S.scoop > 0) { pb.offset.setValueAtTime(-S.scoop * (0.4 + p.slide), t); pb.offset.setTargetAtTime(0, t + 0.01, 0.05 + p.slide * 0.06); }
  const vd = legato ? 0.12 : S.vibDelay;
  vibrato(v, S.vibRate * rand(0.94, 1.06), p.vibrato * S.vibCents, pb.offset, t, vd, S.vibRamp);
  if (!light) {
    const jn = v.noise('pink', t), jl = v.filter('lowpass', 7, 0.7), jg = v.gain(S.jitter * 13); jn.connect(jl); jl.connect(jg); jg.connect(pb.offset);
    const an = v.filter('lowpass', 14, 0.7), ag = v.gain(0.5 + p.bow); jn.connect(an); an.connect(ag); ag.connect(press.gain);   // bow pressure
  }
  // bow: swell in (no new attack on a legato slide), bite on hard notes
  const at = 0.03 + p.swell * p.swell * 1.4, pk = a * S.gain * p.level;
  amp.gain.setValueAtTime(legato ? pk * 0.55 : 0, t);
  amp.gain.setTargetAtTime(pk, t, legato ? 0.05 : at / 3);
  if (!legato && vel > 0.6) { const bg = v.gain(0), bb = v.filter('bandpass', clamp(f * 4, 1200, 5000), 0.8); nz.connect(bb); bb.connect(bg); bg.connect(v.out); bg.gain.setValueAtTime(0, t); bg.gain.linearRampToValueAtTime((vel - 0.6) * S.bite * p.level, t + 0.006); bg.gain.setTargetAtTime(0, t + 0.006, 0.03); }
  v.rel = 0.12 + p.swell * 0.5;
  v.onRelease = (rt, r) => { if (S.fall > 0 && r > 0.06) { pb.offset.cancelAndHoldAtTime?.(rt); pb.offset.setTargetAtTime(-S.fall * p.slide, rt, r * 0.6); } };
  return v;
}
const bowParams = (vib, bright, swell, slide) => [P('vibrato', 'Vibrato', 0, 1, vib), P('slide', 'Slide', 0, 1, slide), P('bow', 'Bow noise', 0, 1, 0.45), P('swell', 'Swell', 0, 1, swell),
  P('bright', 'Bright', 0, 1, bright), TOGGLE('legato', 'Legato (mono)', 1), P('level', 'Level', 0, 1.5, 1)];

const HAEGEUM = { gain: 0.15, hp: 180, dry: 0.3, formants: [[1450, 4.5, 1.9], [720, 3.5, 1.1], [2850, 5, 0.9]], noise: 0.5, noiseLo: 900, noiseHi: 4200,
  vibRate: 4.6, vibCents: 70, vibDelay: 0.3, vibRamp: 0.6, jitter: 8, scoop: 60, fall: 90, bite: 0.08 };
const haegeum = {
  id: 'haegeum', name: 'Haegeum', kind: 'synth', maxVoices: 3,
  params: bowParams(0.5, 0.55, 0.35, 0.5),
  macros: ['vibrato', 'slide', 'bow', 'swell'],
  presets: [
    { id: 'haegeum', name: 'Haegeum', params: {} },
    { id: 'sanjo-haegeum', name: 'Sanjo Haegeum', params: { vibrato: 0.8, slide: 0.75, bow: 0.6, swell: 0.25, bright: 0.65 } },
    { id: 'misty-haegeum', name: 'Misty Haegeum', params: { vibrato: 0.35, slide: 0.45, bow: 0.3, swell: 0.75, bright: 0.3, level: 1.15 } },
    { id: 'court-haegeum', name: 'Court Haegeum', params: { vibrato: 0.25, slide: 0.25, bow: 0.45, swell: 0.45, bright: 0.5 } },
  ],
  voice(ctx, env, p, midi, vel, t) { return bowedVoice(HAEGEUM, ctx, env, p, midi, vel, t); },
};
const ERHU = { gain: 0.15, hp: 160, dry: 0.5, formants: [[1050, 2.6, 1.15], [480, 2.2, 0.75], [2650, 3, 0.55]], noise: 0.28, noiseLo: 800, noiseHi: 3800,
  vibRate: 6, vibCents: 42, vibDelay: 0.28, vibRamp: 0.45, jitter: 4, scoop: 35, fall: 60, bite: 0.05 };
const erhu = {
  id: 'erhu', name: 'Erhu', kind: 'synth', maxVoices: 3,
  params: bowParams(0.55, 0.5, 0.3, 0.45),
  macros: ['vibrato', 'slide', 'bow', 'swell'],
  presets: [
    { id: 'erhu', name: 'Erhu', params: {} },
    { id: 'moon-over-spring', name: 'Moon Over Spring', params: { vibrato: 0.75, slide: 0.7, swell: 0.4, bright: 0.45 } },
    { id: 'night-erhu', name: 'Night Erhu', params: { vibrato: 0.4, slide: 0.5, bow: 0.25, swell: 0.7, bright: 0.25, level: 1.15 } },
    { id: 'gaohu-bright', name: 'Gaohu Bright', params: { vibrato: 0.6, slide: 0.35, bow: 0.5, swell: 0.2, bright: 0.8, level: 0.9 } },
  ],
  voice(ctx, env, p, midi, vel, t) { return bowedVoice(ERHU, ctx, env, p, midi, vel, t); },
};

// ---------------------------------------------------------------- bamboo flutes (daegeum, dizi, shakuhachi)
// membrane buzz (daegeum cheong / dizi dimo): an asymmetric clip that only bites when the tone is loud
function buzzCurve(ctx) {
  return cached(ctx, 'asian-buzz', () => {
    const n = 2049, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = x > 0 ? 0.32 * Math.tanh(x / 0.32) : 0.62 * Math.tanh(x / 0.62); }
    return c;
  });
}
function fluteVoice(S, ctx, env, p, midi, vel, t) {
  const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel), light = env.light;
  const pb = v.constant(0, t);
  const { from, legato } = monoLink(v, p, f, t, p.legato >= 0.5);
  const reg = clamp((midi - S.low) / 24, 0, 1);   // overblown upper register: brighter, buzzier
  const o = v.osc(wave(ctx, 'asian-' + S.id, S.harm), f, t); pb.connect(o.detune);
  const lp = v.filter('lowpass', clamp(f * (S.bright + reg * 3 + vel * 2), 900, 12000), 0.5);
  const amp = v.gain(0), breathMod = v.gain(1); v.amps.push(amp.gain);
  const toneG = v.gain(S.tone); o.connect(toneG); toneG.connect(lp); lp.connect(breathMod); breathMod.connect(amp);
  // breath: noise pitched at the bore (fundamental and 2nd harmonic) + open air hiss
  const breath = p.breath ?? 0.4;
  const nz = v.noise('white', t);
  const b1 = v.filter('bandpass', f, S.q1), g1 = v.gain(breath * S.pitched); nz.connect(b1); b1.connect(g1); g1.connect(breathMod);
  if (!light) { const b2 = v.filter('bandpass', f * 2, S.q1 * 0.8), g2 = v.gain(breath * S.pitched * 0.5); nz.connect(b2); b2.connect(g2); g2.connect(breathMod); }
  const ah = v.filter('bandpass', clamp(f * 4, 2500, 9000), 0.6), ag = v.gain(breath * S.air); nz.connect(ah); ah.connect(ag); ag.connect(breathMod);
  // membrane buzz, driven by how loud the tone is
  const buzz = p.buzz ?? 0;
  const out = v.gain(1); amp.connect(out);
  if (S.membrane && buzz > 0.01) {
    const pk0 = a * S.gain * p.level + 1e-4;
    const pre = v.gain((0.6 + buzz * 2.6 + reg * 1.2) / pk0), sh = v.shaper(buzzCurve(ctx)), bh = v.filter('highpass', S.membrane * 0.55, 0.7);
    const bp = v.filter('peaking', S.membrane, 1.4); bp.gain.value = 9;
    const bg = v.gain(buzz * pk0 * S.buzzGain);
    amp.connect(pre); pre.connect(sh); sh.connect(bh); bh.connect(bp); bp.connect(bg); bg.connect(out);
  }
  out.connect(v.out);
  // breath turbulence: tiny random level flutter
  if (!light) { const tn = v.noise('pink', t), tl = v.filter('lowpass', 18, 0.7), tg = v.gain(0.2 + breath * 0.4); tn.connect(tl); tl.connect(tg); tg.connect(breathMod.gain); }
  // attack: chiff / muraiki burst (noise that comes before the tone settles)
  const chiff = (S.chiff + (p.muraiki ?? 0) * 1.1) * (legato ? 0.2 : 1);
  if (chiff > 0.01) {
    const cb = v.filter('bandpass', clamp(f * 2.2, 700, 5000), 0.9), cg = v.gain(0); nz.connect(cb); cb.connect(cg); cg.connect(out);
    const ctc = 0.025 + (p.muraiki ?? 0) * 0.13;
    cg.gain.setValueAtTime(0, t); cg.gain.linearRampToValueAtTime(chiff * a * p.level * 0.5, t + 0.012); cg.gain.setTargetAtTime(0, t + 0.012, ctc);
  }
  // pitch gestures
  const slide = 0.03 + (p.slide ?? 0.4) * 0.25;
  const bendDown = (p.meri ?? 0) * S.meriCents + (p.scoop ?? 0) * S.scoopCents;
  if (legato && Math.abs(from - f) > 0.5) { pb.offset.setValueAtTime(centsOf(from / f), t); pb.offset.setTargetAtTime(0, t + 0.01, slide / 3); }
  else if (bendDown > 1) { pb.offset.setValueAtTime(-bendDown, t); pb.offset.setTargetAtTime(0, t + 0.02, S.riseTc * (0.6 + (p.meri ?? p.scoop ?? 0) * 0.8)); }
  else { pb.offset.setValueAtTime(14, t); pb.offset.setTargetAtTime(0, t, 0.02); }   // a breath of overshoot on the attack
  const orn = p.ornament ?? 0;
  if (!legato && orn > 0.05 && vel > 0.75 - orn * 0.5) {   // dizi die yin: a flick to the upper neighbour on accented notes
    pb.offset.cancelScheduledValues(t); pb.offset.setValueAtTime(200, t); pb.offset.setValueAtTime(200, t + 0.03 + orn * 0.035); pb.offset.setTargetAtTime(0, t + 0.03 + orn * 0.035, 0.007);
  }
  const vib = p.vibrato ?? 0.3;
  const vg = vibrato(v, S.vibRate * rand(0.94, 1.06), vib * S.vibCents, pb.offset, t, legato ? 0.15 : S.vibDelay, S.vibRamp);
  if (vg && S.vibAmp) { const ag2 = v.gain(S.vibAmp / Math.max(1, vib * S.vibCents)); vg.connect(ag2); ag2.connect(breathMod.gain); }   // breath vibrato moves the level too
  if (!light && S.jitter) { const jn = v.noise('pink', t), jl = v.filter('lowpass', 6, 0.7), jg = v.gain(S.jitter * 13); jn.connect(jl); jl.connect(jg); jg.connect(pb.offset); }
  // swell: breath builds the note
  const sw = p.swell ?? 0.3, at = S.attack + sw * sw * 1.2 + (p.muraiki ?? 0) * 0.12, pk = a * S.gain * p.level;
  amp.gain.setValueAtTime(legato ? pk * 0.6 : 0, t); amp.gain.setTargetAtTime(pk, t, legato ? 0.04 : at / 3);
  v.rel = S.rel + sw * 0.4;
  v.onRelease = (rt, r) => { if (S.fall && r > 0.06) { const fc = S.fall * (0.35 + (p.meri ?? p.scoop ?? 0.4)); pb.offset.cancelAndHoldAtTime?.(rt); pb.offset.setTargetAtTime(-fc, rt + r * 0.15, r * 0.5); } };
  return v;
}
const DAEGEUM = { id: 'daegeum', low: 58, harm: [1, 0.42, 0.3, 0.16, 0.1, 0.07, 0.04], bright: 3.5, tone: 1, q1: 9, pitched: 1.1, air: 0.3, gain: 0.15,
  membrane: 2300, buzzGain: 1.4, chiff: 0.25, meriCents: 0, scoopCents: 140, riseTc: 0.1, vibRate: 4.3, vibCents: 55, vibDelay: 0.35, vibRamp: 0.9, vibAmp: 0.18,
  jitter: 3, attack: 0.05, rel: 0.25, fall: 110 };
const daegeum = {
  id: 'daegeum', name: 'Daegeum', kind: 'synth', maxVoices: 4,
  params: [P('breath', 'Breath', 0, 1, 0.45), P('buzz', 'Cheong buzz', 0, 1, 0.5), P('vibrato', 'Yoseong', 0, 1, 0.5), P('swell', 'Swell', 0, 1, 0.4),
    P('scoop', 'Scoop', 0, 1, 0.35), P('slide', 'Slide', 0, 1, 0.45), TOGGLE('legato', 'Legato (mono)', 1), P('level', 'Level', 0, 1.5, 1)],
  macros: ['breath', 'buzz', 'vibrato', 'swell'],
  presets: [
    { id: 'sanjo-daegeum', name: 'Sanjo Daegeum', params: {} },
    { id: 'cheong-buzz', name: 'Cheong Buzz', params: { breath: 0.4, buzz: 0.85, vibrato: 0.6, swell: 0.3, scoop: 0.45 } },
    { id: 'court-daegeum', name: 'Court Daegeum', params: { breath: 0.35, buzz: 0.25, vibrato: 0.3, swell: 0.55, scoop: 0.2, slide: 0.3 } },
    { id: 'night-mist', name: 'Night Mist', params: { breath: 0.7, buzz: 0.15, vibrato: 0.35, swell: 0.8, scoop: 0.25, level: 1.15 } },
  ],
  voice(ctx, env, p, midi, vel, t) { return fluteVoice(DAEGEUM, ctx, env, p, midi, vel, t); },
};
const DIZI = { id: 'dizi', low: 67, harm: [1, 0.55, 0.42, 0.3, 0.2, 0.13, 0.08, 0.05], bright: 5, tone: 1, q1: 11, pitched: 0.7, air: 0.32, gain: 0.13,
  membrane: 3300, buzzGain: 1.6, chiff: 0.35, meriCents: 0, scoopCents: 0, riseTc: 0.06, vibRate: 5.6, vibCents: 30, vibDelay: 0.3, vibRamp: 0.5, vibAmp: 0.1,
  jitter: 2, attack: 0.025, rel: 0.18, fall: 50 };
const dizi = {
  id: 'dizi', name: 'Dizi', kind: 'synth', maxVoices: 4,
  params: [P('breath', 'Breath', 0, 1, 0.35), P('buzz', 'Dimo buzz', 0, 1, 0.55), P('vibrato', 'Vibrato', 0, 1, 0.35), P('ornament', 'Die yin', 0, 1, 0.3),
    P('swell', 'Swell', 0, 1, 0.2), P('slide', 'Slide', 0, 1, 0.3), TOGGLE('legato', 'Legato (mono)', 1), P('level', 'Level', 0, 1.5, 1)],
  macros: ['breath', 'buzz', 'vibrato', 'ornament'],
  presets: [
    { id: 'bangdi', name: 'Bangdi (bright)', params: { buzz: 0.7, breath: 0.3, vibrato: 0.35, ornament: 0.45, level: 0.9 } },
    { id: 'qudi', name: 'Qudi (mellow)', params: { buzz: 0.4, breath: 0.4, vibrato: 0.4, ornament: 0.2, swell: 0.35 } },
    { id: 'xiao-breath', name: 'Xiao Breath', params: { buzz: 0, breath: 0.65, vibrato: 0.3, ornament: 0, swell: 0.6, slide: 0.5, level: 1.2 } },
  ],
  voice(ctx, env, p, midi, vel, t) { return fluteVoice(DIZI, ctx, env, p, midi, vel, t); },
};
const SHAKU = { id: 'shakuhachi', low: 62, harm: [1, 0.24, 0.13, 0.06, 0.035, 0.02], bright: 3, tone: 0.9, q1: 7, pitched: 1.5, air: 0.55, gain: 0.15,
  membrane: 0, buzzGain: 0, chiff: 0.2, meriCents: 130, scoopCents: 0, riseTc: 0.35, vibRate: 4.2, vibCents: 55, vibDelay: 0.55, vibRamp: 1.4, vibAmp: 0.22,
  jitter: 4, attack: 0.06, rel: 0.3, fall: 120 };
const shakuhachi = {
  id: 'shakuhachi', name: 'Shakuhachi', kind: 'synth', maxVoices: 4,
  params: [P('breath', 'Breath', 0, 1, 0.5), P('meri', 'Meri', 0, 1, 0.45), P('vibrato', 'Yuri', 0, 1, 0.45), P('muraiki', 'Muraiki', 0, 1, 0.25),
    P('swell', 'Swell', 0, 1, 0.4), P('slide', 'Slide', 0, 1, 0.4), TOGGLE('legato', 'Legato (mono)', 1), P('level', 'Level', 0, 1.5, 1)],
  macros: ['breath', 'meri', 'vibrato', 'muraiki'],
  presets: [
    { id: 'honkyoku', name: 'Honkyoku', params: {} },
    { id: 'muraiki-storm', name: 'Muraiki Storm', params: { breath: 0.75, meri: 0.55, vibrato: 0.35, muraiki: 0.85, swell: 0.25 } },
    { id: 'komuso-night', name: 'Komuso Night', params: { breath: 0.6, meri: 0.35, vibrato: 0.55, muraiki: 0.1, swell: 0.75, level: 1.15 } },
    { id: 'deep-meri', name: 'Deep Meri', params: { breath: 0.45, meri: 0.9, vibrato: 0.5, muraiki: 0.3, swell: 0.4 } },
  ],
  voice(ctx, env, p, midi, vel, t) { return fluteVoice(SHAKU, ctx, env, p, midi, vel, t); },
};

// ---------------------------------------------------------------- 6. Temple bells / bronze gong / singing bowl / rin (modal)
// partials: [ratio, level, T60 seconds, beat Hz (doublet split)]
const BELL_MODELS = {
  bell: { gain: 0.18, partials: [[0.5, 0.85, 17, 0.33], [1, 1, 12, 0.21], [1.41, 0.38, 7.5, 0.55], [2.14, 0.42, 6, 0.85], [2.83, 0.3, 4.5, 1.3], [3.79, 0.2, 3.2, 1.8], [4.9, 0.12, 2.2, 2.4], [6.1, 0.07, 1.5, 3.1]],
    strike: { f: 160, q: 0.8, tc: 0.05, g: 0.5 } },
  gong: { gain: 0.15, partials: [[1, 1, 8, 0.12], [1.48, 0.7, 7, 0.2], [1.83, 0.55, 6.2, 0.3], [2.21, 0.5, 5.5, 0.25], [2.67, 0.45, 4.8, 0.4], [3.06, 0.38, 4.2, 0.5], [3.56, 0.3, 3.6, 0.45], [4.11, 0.24, 3, 0.6], [4.72, 0.18, 2.4, 0.7], [5.38, 0.12, 2, 0.8]],
    strike: { f: 240, q: 0.7, tc: 0.06, g: 0.45 }, bloom: true },
  bowl: { gain: 0.24, partials: [[1, 1, 14, 0.9], [2.71, 0.5, 8, 1.7], [5.15, 0.24, 4.2, 2.6], [8.15, 0.1, 2.2, 3.1]], strike: { f: 900, q: 0.7, tc: 0.012, g: 0.12 } },
  rin: { gain: 0.24, partials: [[1, 1, 9, 1.2], [2.62, 0.6, 5, 2], [4.87, 0.35, 3, 3.2], [7.5, 0.2, 1.8, 4], [10.6, 0.1, 1, 5]], strike: { f: 4500, q: 0.8, tc: 0.004, g: 0.22 } },
};
const BELL_OPTS = [{ value: 'bell', label: 'Temple bell' }, { value: 'gong', label: 'Bronze gong' }, { value: 'bowl', label: 'Singing bowl' }, { value: 'rin', label: 'Rin' }];
const templebells = {
  id: 'templebells', name: 'Temple Bells', kind: 'synth', maxVoices: 8,
  params: [P('strike', 'Strike', 0, 1, 0.45), P('ring', 'Ring', 0, 1, 0.6), P('beat', 'Beating', 0, 1, 0.6), P('bloom', 'Bloom', 0, 1, 0.3),
    ENUM('model', 'Model', BELL_OPTS, 'bell'), P('width', 'Width', 0, 1, 0.6), P('level', 'Level', 0, 1.5, 1)],
  macros: ['strike', 'ring', 'beat', 'bloom'],
  presets: [
    { id: 'temple-bell', name: 'Temple Bell', params: { model: 'bell', strike: 0.35, ring: 0.65, beat: 0.75, bloom: 0.15 } },
    { id: 'bronze-gong', name: 'Bronze Gong', params: { model: 'gong', strike: 0.5, ring: 0.55, beat: 0.5, bloom: 0.65, width: 0.75 } },
    { id: 'singing-bowl', name: 'Singing Bowl', params: { model: 'bowl', strike: 0.3, ring: 0.7, beat: 0.7, bloom: 0.1 } },
    { id: 'rin', name: 'Rin', params: { model: 'rin', strike: 0.65, ring: 0.5, beat: 0.5, bloom: 0, level: 0.9 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel), light = env.light;
    const M = BELL_MODELS[p.model] || BELL_MODELS.bell;
    const amp = v.gain(a * M.gain * p.level); v.amps.push(amp.gain); amp.connect(v.out);
    const A = light ? amp : v.pan(-0.45 * p.width), B = light ? amp : v.pan(0.45 * p.width);
    if (!light) { A.connect(amp); B.connect(amp); }
    const keep = v.constant(0, t);   // lives for the whole ring (partials stop early as they fade)
    const pb = M.bloom ? keep : null;
    if (pb) { pb.offset.setValueAtTime(p.bloom * 18, t); pb.offset.setTargetAtTime(-p.bloom * 28, t + 0.05, 1.4); }   // the gong's pitch sags as it blooms
    const ringMul = (0.45 + p.ring * 1.15) * keyScale(midi, 40);
    let longest = 0, total = 0;
    const parts = M.partials.filter(([r]) => f * r < 15000).slice(0, light ? 4 : 99);
    parts.forEach(([r, lv, t60, beat], k) => {
      const lvl = lv * (k === 0 ? 1 : Math.pow(0.3 + p.strike * 0.95, Math.min(3, k * 0.6))); total += lvl;
      const T = Math.min(18, t60 * ringMul * (1 - p.strike * 0.15 * k / parts.length)), tc = T / 6.9;
      const bloomTc = M.bloom ? 0.02 + p.bloom * 0.5 * (k / parts.length) : 0;
      const env1 = (g, peak) => {
        g.gain.setValueAtTime(0, t);
        if (bloomTc > 0.03) { g.gain.setTargetAtTime(peak, t, bloomTc); g.gain.setTargetAtTime(0, t + bloomTc * 3, tc); }
        else { g.gain.linearRampToValueAtTime(peak, t + 0.002 + (1 - p.strike) * 0.004); g.gain.setTargetAtTime(0, t + 0.006, tc); }
      };
      const bt = beat * p.beat * 1.4, end = t + 0.006 + bloomTc * 3 + tc * 8.5;
      if (light || bt < 0.01) {
        const o = v.osc('sine', f * r, t), g = v.gain(0); o.connect(g); g.connect(A); env1(g, lvl); if (pb) pb.connect(o.detune); v.transient(o, end);
      } else {
        const o1 = v.osc('sine', f * r - bt / 2, t), o2 = v.osc('sine', f * r + bt / 2, t), g1 = v.gain(0), g2 = v.gain(0);
        o1.connect(g1); g1.connect(A); o2.connect(g2); g2.connect(B); env1(g1, lvl * 0.56); env1(g2, lvl * 0.44);
        if (pb) { pb.connect(o1.detune); pb.connect(o2.detune); }
        v.transient(o1, end); v.transient(o2, end);
      }
      longest = Math.max(longest, end - t);
    });
    // mallet: wooden log (bell), padded beater (gong), felt (bowl), small stick (rin)
    const S = M.strike, n = v.noise('pink', t), sb = v.filter(S.f > 2000 ? 'highpass' : 'bandpass', S.f * (0.7 + p.strike * 0.6), S.q), sg = v.gain(0);
    n.connect(sb); sb.connect(sg); sg.connect(amp);
    sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(S.g * (0.4 + p.strike) * total * 0.5, t + 0.002); sg.gain.setTargetAtTime(0, t + 0.002, S.tc);
    v.stereo(); v.transient(n, t + 0.002 + S.tc * 12);
    if (M.bloom && p.bloom > 0.05 && !light) {   // the gong's shimmering wash rises after the strike
      const wn = v.noise('white', t), wb = v.filter('bandpass', clamp(f * 3.2, 600, 6000), 0.6), wg = v.gain(0);
      wn.connect(wb); wb.connect(wg); wg.connect(B);
      wg.gain.setValueAtTime(0, t); wg.gain.setTargetAtTime(p.bloom * 0.08 * total, t + 0.05, 0.35 + p.bloom * 0.4); wg.gain.setTargetAtTime(0, t + 0.9 + p.bloom, 0.9 * ringMul);
      v.transient(wn, t + 0.9 + p.bloom + 0.9 * ringMul * 12);
    }
    v.oneShot = true; v.rel = 2;
    v.stop(t + longest + 0.05);
    return v;
  },
};

// ---------------------------------------------------------------- drums (modal membranes): janggu and taiko
// circular-membrane mode ratios (thin heads) and air-loaded quasi-harmonic ratios (big drums)
const MEMBRANE = [1, 1.594, 2.136, 2.296, 2.653, 2.918];
const LOADED = [1, 1.5, 1.98, 2.44, 2.9, 3.4];
function drumVoice(ctx, env, t) { const v = new Voice(ctx, env, t); v.oneShot = true; v.rel = 0.1; return v; }
// modes on a membrane; hits = [[time offset, level]] re-excite the same modes (flams, rolls)
function modes(v, into, t, { f, ratios, amps, tcs, drop = 0, dropTc = 0.04, hits = [[0, 1]], light }) {
  const n = light ? Math.min(3, ratios.length) : ratios.length;
  let end = 0;
  for (let k = 0; k < n; k++) {
    const fk = f * ratios[k], o = v.osc('sine', fk * (1 + drop), t), g = v.gain(0);
    o.frequency.setValueAtTime(fk * (1 + drop), t); o.frequency.setTargetAtTime(fk, t, dropTc);
    for (const [dt, lv] of hits) {
      const at = t + dt;
      if (dt > 0) { o.frequency.setTargetAtTime(fk * (1 + drop * lv), at, 0.002); o.frequency.setTargetAtTime(fk, at + 0.004, dropTc); }
      g.gain.setTargetAtTime(amps[k] * lv, at, 0.0006); g.gain.setTargetAtTime(0, at + 0.0025, tcs[k]);
    }
    o.connect(g); g.connect(into);
    const e = t + hits[hits.length - 1][0] + tcs[k] * 11 + 0.01; v.transient(o, e); end = Math.max(end, e);
  }
  return end;
}
function noiseHit(v, into, t, { type = 'bandpass', f, q = 0.8, level, tc, hits = [[0, 1]], kind = 'white' }) {
  const n = v.noise(kind, t), b = v.filter(type, f, q), g = v.gain(0); n.connect(b); b.connect(g); g.connect(into);
  for (const [dt, lv] of hits) { const at = t + dt; g.gain.setTargetAtTime(level * lv, at, 0.0005); g.gain.setTargetAtTime(0, at + 0.002, tc); }
  const e = t + hits[hits.length - 1][0] + tc * 12 + 0.01; v.stereo(); v.transient(n, e);
  return e;
}
const drumParams = (extra) => [P('tune', 'Tune', -12, 12, 0, { unit: 'st', step: 0.5 }), P('decay', 'Decay', 0.3, 2, 1), P('hard', 'Stick', 0, 1, 0.5), P('body', 'Body', 0, 1, 0.5),
  ...extra, P('level', 'Level', 0, 1.5, 1)];

export const JANGGU_MAP = [
  { midi: 36, voice: 'kung', name: 'Kung (left head)', short: 'KUNG' },
  { midi: 37, voice: 'deong', name: 'Deong (both heads)', short: 'DEONG' },
  { midi: 38, voice: 'deok', name: 'Deok (stick)', short: 'DEOK' },
  { midi: 39, voice: 'tta', name: 'Tta (light stick)', short: 'TTA' },
  { midi: 40, voice: 'roll', name: 'Deoreoreo (roll)', short: 'ROLL' },
];
const janggu = {
  id: 'janggu', name: 'Janggu', kind: 'drums', maxVoices: 16, drumMap: JANGGU_MAP,
  params: drumParams([P('kungLevel', 'Kung level', 0, 1.5, 1), P('deokLevel', 'Deok level', 0, 1.5, 1)]),
  macros: ['tune', 'decay', 'hard', 'body'],
  presets: [
    { id: 'sanjo-janggu', name: 'Sanjo Janggu', params: {} },
    { id: 'soft-hand', name: 'Soft Hand', params: { hard: 0.15, decay: 1.25, body: 0.65, deokLevel: 0.7, level: 1.1 } },
    { id: 'pungmul', name: 'Pungmul', params: { tune: 2, hard: 0.85, decay: 0.8, body: 0.4, deokLevel: 1.15 } },
    { id: 'distant-shrine', name: 'Distant Shrine', params: { tune: -3, hard: 0.3, decay: 1.6, body: 0.75, level: 0.95 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const d = JANGGU_MAP[clamp(Math.round(midi), 36, 40) - 36], v = drumVoice(ctx, env, t), a = vel2amp(vel), light = env.light;
    const ratio = Math.pow(2, p.tune / 12), dec = p.decay, out = v.gain(1);
    const tone = v.filter('lowpass', 2500 + p.hard * 9000, 0.5); out.connect(tone); tone.connect(v.out);
    const lvl = a * p.level * 0.24;
    let end = t + 0.1;
    // left head (gungpyeon): thick hide, palm or round mallet: a low round boom with the waist's hollow honk
    const kung = (g) => {
      end = Math.max(end, modes(v, out, t, { f: 84 * ratio, ratios: LOADED, amps: [1, 0.42, 0.24, 0.12, 0.07, 0.04].map(x => x * g), tcs: [0.3, 0.15, 0.1, 0.06, 0.045, 0.035].map(x => x * dec), drop: 0.14, dropTc: 0.05, light }));
      end = Math.max(end, noiseHit(v, out, t, { f: 215 * ratio, q: 3.5, level: g * (0.25 + p.body * 0.6), tc: 0.06 * dec, kind: 'pink' }));
      noiseHit(v, out, t, { type: 'lowpass', f: 500 + p.hard * 900, q: 0.6, level: g * 0.35, tc: 0.008, kind: 'pink' });
    };
    // right head (chaepyeon): thin hide struck with the bamboo yeolchae: a crack and a bright short ring
    const deok = (g, hits = [[0, 1]], f0 = 335) => {
      end = Math.max(end, modes(v, out, t, { f: f0 * ratio, ratios: MEMBRANE, amps: [1, 0.62, 0.5, 0.36, 0.3, 0.2].map(x => x * g * 0.55), tcs: [0.085, 0.06, 0.05, 0.04, 0.035, 0.03].map(x => x * dec), drop: 0.05, dropTc: 0.02, hits, light }));
      end = Math.max(end, noiseHit(v, out, t, { f: 3200 + p.hard * 2500, q: 0.9, level: g * (0.35 + p.hard * 0.65), tc: 0.006 + (1 - p.hard) * 0.004, hits }));
      if (!light) noiseHit(v, out, t, { f: 1150 * ratio, q: 5, level: g * 0.18 * p.body, tc: 0.03 * dec, hits, kind: 'pink' });   // the shell
    };
    const kl = lvl * p.kungLevel, dl = lvl * p.deokLevel;
    if (d.voice === 'kung') kung(kl);
    else if (d.voice === 'deong') { kung(kl * 0.85); deok(dl * 0.9); }
    else if (d.voice === 'deok') deok(dl);
    else if (d.voice === 'tta') deok(dl * 0.55, [[0, 1]], 410);
    else { const times = [0, 0.052, 0.098, 0.138, 0.172, 0.202]; deok(dl * 0.85, times.map((x, i) => [x, Math.pow(0.74, i)])); }
    v.stop(end);
    return v;
  },
};

export const TAIKO_MAP = [
  { midi: 36, voice: 'don', name: 'Don (nagado center)', short: 'DON' },
  { midi: 37, voice: 'ka', name: 'Ka (rim)', short: 'KA' },
  { midi: 38, voice: 'shime', name: 'Shime (ten)', short: 'SHIME' },
  { midi: 39, voice: 'doko', name: 'Doko (two hits)', short: 'DOKO' },
  { midi: 40, voice: 'odaiko', name: 'O-daiko (great drum)', short: 'ODK' },
];
const taiko = {
  id: 'taiko', name: 'Taiko', kind: 'drums', maxVoices: 14, drumMap: TAIKO_MAP,
  params: drumParams([P('rimLevel', 'Ka level', 0, 1.5, 1), P('shimeLevel', 'Shime level', 0, 1.5, 1)]),
  macros: ['tune', 'decay', 'hard', 'body'],
  presets: [
    { id: 'taiko-hall', name: 'Taiko Hall', params: {} },
    { id: 'matsuri', name: 'Matsuri', params: { tune: 2, hard: 0.85, decay: 0.85, body: 0.45, rimLevel: 1.2, shimeLevel: 1.1 } },
    { id: 'thunder-temple', name: 'Thunder Temple', params: { tune: -3, hard: 0.35, decay: 1.6, body: 0.85, level: 0.95 } },
    { id: 'soft-mallets', name: 'Soft Mallets', params: { hard: 0.1, decay: 1.2, body: 0.6, rimLevel: 0.6, shimeLevel: 0.7, level: 1.1 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const d = TAIKO_MAP[clamp(Math.round(midi), 36, 40) - 36], v = drumVoice(ctx, env, t), a = vel2amp(vel), light = env.light;
    const ratio = Math.pow(2, p.tune / 12), dec = p.decay, out = v.gain(1);
    const tone = v.filter('lowpass', 2000 + p.hard * 9000, 0.5); out.connect(tone); tone.connect(v.out);
    const lvl = a * p.level * 0.24;
    let end = t + 0.1;
    // a big cowhide head over a hollow keyaki barrel: pitch falls as the tension settles; the barrel booms under it
    const big = (f0, g, size, hits = [[0, 1]]) => {
      end = Math.max(end, modes(v, out, t, { f: f0 * ratio, ratios: LOADED, amps: [1, 0.5, 0.3, 0.17, 0.1, 0.06].map(x => x * g), tcs: [0.5, 0.28, 0.17, 0.11, 0.08, 0.06].map(x => x * dec * size), drop: 0.2, dropTc: 0.06 * size, hits, light }));
      end = Math.max(end, noiseHit(v, out, t, { type: 'lowpass', f: 160 * ratio, q: 1.2, level: g * (0.3 + p.body * 0.9), tc: 0.12 * dec * size, hits, kind: 'brown' }));
      noiseHit(v, out, t, { type: 'lowpass', f: 700 + p.hard * 2200, q: 0.6, level: g * (0.25 + p.hard * 0.4), tc: 0.01, hits, kind: 'pink' });   // bachi on hide
    };
    if (d.voice === 'don') big(66, lvl, 1);
    else if (d.voice === 'doko') big(66, lvl * 0.9, 0.9, [[0, 0.8], [0.085, 1]]);
    else if (d.voice === 'odaiko') big(41, lvl * 1.05, 1.7);
    else if (d.voice === 'ka') {   // bachi on the wooden rim: two wood modes and a dry click
      const g = lvl * p.rimLevel * 0.8;
      end = Math.max(end, modes(v, out, t, { f: 1180 * ratio, ratios: [1, 2.27, 3.5], amps: [0.5 * g, 0.3 * g, 0.12 * g], tcs: [0.035, 0.022, 0.015].map(x => x * dec), light }));
      end = Math.max(end, noiseHit(v, out, t, { f: 2400, q: 1.4, level: g * (0.4 + p.hard * 0.6), tc: 0.005 }));
    } else {   // shime-daiko: a small rope-tightened drum, high and crisp
      const g = lvl * p.shimeLevel * 0.75;
      end = Math.max(end, modes(v, out, t, { f: 430 * ratio, ratios: MEMBRANE, amps: [1, 0.55, 0.42, 0.3, 0.22, 0.15].map(x => x * g * 0.6), tcs: [0.11, 0.07, 0.05, 0.04, 0.035, 0.03].map(x => x * dec), drop: 0.03, dropTc: 0.015, light }));
      end = Math.max(end, noiseHit(v, out, t, { type: 'highpass', f: 2200 + p.hard * 2000, q: 0.7, level: g * (0.3 + p.hard * 0.6), tc: 0.004 }));
    }
    v.stop(end);
    return v;
  },
};

// ---------------------------------------------------------------- 7. Wind chimes / furin (texture: hold a note)
// materials: partial [ratio, level, T60, beat], click (clapper) level / colour, octave above the played note
const CHIME_MATS = {
  glass: { partials: [[1, 1, 2.6, 0], [2.32, 0.42, 1.3, 0], [4.25, 0.26, 0.7, 0], [6.63, 0.12, 0.4, 0]], click: 0.3, clickHp: 5000, clickTc: 0.0012, oct: 24, maxF: 2900, gain: 0.5, spread: 0.25 },
  iron: { partials: [[1, 1, 7, 1.3], [2.76, 0.35, 3.6, 2.1], [5.4, 0.18, 1.8, 0], [8.93, 0.08, 0.9, 0]], click: 0.12, clickHp: 4000, clickTc: 0.0015, oct: 24, maxF: 2400, gain: 0.45, spread: 0.2 },
  bamboo: { partials: [[1, 1, 0.45, 0], [2.6, 0.4, 0.22, 0], [4.45, 0.2, 0.12, 0]], click: 0.55, clickHp: 900, clickTc: 0.005, oct: 12, maxF: 1300, gain: 0.4, spread: 0.8 },
  brass: { partials: [[1, 1, 6.5, 0.7], [2.756, 0.5, 3.8, 1.4], [5.404, 0.3, 2.2, 2], [8.933, 0.15, 1.1, 0]], click: 0.08, clickHp: 3500, clickTc: 0.0015, oct: 12, maxF: 2100, gain: 0.28, spread: 0.85 },
};
const TUNINGS = { single: [0], pair: [0, 7], yo: [0, 2, 5, 7, 9, 12], in: [0, 1, 5, 7, 8, 12] };
function chimeFloats(sr, M, f, ringMul, tone, seed) {
  const parts = M.partials.filter(([r]) => f * r < 15000);
  const len = Math.min(9, Math.max(...parts.map(x => x[2])) * ringMul + 0.06), n = Math.ceil(sr * len), d = new Float32Array(n), r = rng(seed);
  parts.forEach(([ratio, lv, t60, beat], k) => {
    const lvl = lv * (k === 0 ? 1 : Math.pow(0.35 + tone * 1.0, k * 0.7)), dk = Math.exp(Math.log(0.001) / (t60 * ringMul * sr));
    const comps = beat > 0 ? [[ratio * f - beat / 2, 0.56], [ratio * f + beat / 2, 0.44]] : [[ratio * f, 1]];
    for (const [fq, share] of comps) {
      const w = 2 * Math.PI * fq / sr, c2 = 2 * Math.cos(w), ph = r() * Math.PI * 2;
      let s1 = Math.sin(ph - w), s2 = Math.sin(ph - 2 * w), e = lvl * share;
      for (let i = 0; i < n; i++) { const s0 = c2 * s1 - s2; s2 = s1; s1 = s0; d[i] += s0 * e; e *= dk; }
    }
  });
  const at = Math.round(sr * 0.0008); for (let i = 0; i < at; i++) d[i] *= i / at;
  // clapper click
  const cl = Math.min(n, Math.round(sr * M.clickTc * 10)), hp = Math.exp(-2 * Math.PI * M.clickHp / sr);
  let lp = 0; for (let i = 0; i < cl; i++) { const wn = r() * 2 - 1; lp = hp * lp + (1 - hp) * wn; d[i] += (wn - lp) * M.click * Math.exp(-i / (sr * M.clickTc)); }
  return finish(d, sr, 0.02);
}
const CHIME_OPTS = [{ value: 'glass', label: 'Glass furin' }, { value: 'iron', label: 'Iron furin (Nanbu)' }, { value: 'bamboo', label: 'Bamboo' }, { value: 'brass', label: 'Brass tubes' }];
const TUNE_OPTS = [{ value: 'single', label: 'One bell' }, { value: 'pair', label: 'Two bells (fifth)' }, { value: 'yo', label: 'Yo pentatonic' }, { value: 'in', label: 'In scale' }];
const windchimes = {
  id: 'windchimes', name: 'Wind Chimes', kind: 'texture', maxVoices: 3,
  params: [P('wind', 'Wind', 0, 1, 0.45), P('density', 'Density', 0, 1, 0.4), P('ring', 'Ring', 0, 1, 0.55), P('tone', 'Tone', 0, 1, 0.5),
    ENUM('material', 'Material', CHIME_OPTS, 'glass'), ENUM('tuning', 'Tuning', TUNE_OPTS, 'single'), P('level', 'Level', 0, 1.5, 1)],
  macros: ['wind', 'density', 'ring', 'tone'],
  presets: [
    { id: 'glass-furin', name: 'Glass Furin', params: { material: 'glass', tuning: 'single', wind: 0.4, density: 0.35, ring: 0.6, tone: 0.55 } },
    { id: 'iron-furin', name: 'Iron Furin', params: { material: 'iron', tuning: 'pair', wind: 0.3, density: 0.25, ring: 0.6, tone: 0.45 } },
    { id: 'bamboo-chimes', name: 'Bamboo Chimes', params: { material: 'bamboo', tuning: 'yo', wind: 0.55, density: 0.55, ring: 0.5, tone: 0.5, level: 1.1 } },
    { id: 'temple-eaves', name: 'Temple Eaves', params: { material: 'brass', tuning: 'in', wind: 0.35, density: 0.3, ring: 0.55, tone: 0.45, level: 0.9 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), a = vel2amp(vel), light = env.light, M = CHIME_MATS[p.material] || CHIME_MATS.glass;
    const amp = v.gain(0); v.amps.push(amp.gain); amp.connect(v.out); v.stereo();
    v.constant(0, t);   // keeps the voice alive while the note is held; strikes are one-shots on top
    amp.gain.setValueAtTime(0, t); amp.gain.setTargetAtTime(a * M.gain * p.level, t, 0.25);
    let root = Math.round(midi) + M.oct; while (mtof(root) > M.maxF) root -= 12;
    const set = TUNINGS[p.tuning] || TUNINGS.single, ringMul = 0.5 + p.ring * 1.0, toneQ = q10(p.tone), ringQ = q10(p.ring);
    const w = 0.4 + p.wind * 1.8, ph = [rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)];
    const gust = x => { const u = x - t, s = 0.5 * Math.sin(6.283 * 0.047 * w * u + ph[0]) + 0.32 * Math.sin(6.283 * 0.121 * w * u + ph[1]) + 0.18 * Math.sin(6.283 * 0.29 * w * u + ph[2]);
      return Math.pow(clamp(0.5 + 0.55 * s, 0, 1), 0.6 + (1 - p.wind) * 1.6); };
    const rate = (0.35 + p.density * 5.5) * (light ? 0.6 : 1), cap = light ? 5 : 12;
    let next = t + rand(0.05, 0.35), last = -1, active = 0;
    v.onExtraEnded = () => { active--; };
    const strike = (at, g, idx) => {
      if (active >= cap) return;
      const m = root + set[idx], buf = lruBuffer(ctx, `chime:${p.material}:${m}:${ringQ}:${toneQ}`, sr => chimeFloats(sr, M, mtof(m), 0.5 + ringQ, toneQ, m * 37 + 11));
      const s = ctx.createBufferSource(), gn = ctx.createGain(), pn = ctx.createStereoPanner();
      s.buffer = buf; s.playbackRate.value = Math.pow(2, rand(-4, 4) / 1200);
      gn.gain.value = (0.3 + 0.7 * g) * rand(0.55, 1);
      pn.pan.value = clamp((set.length > 1 ? (idx / (set.length - 1) - 0.5) * 2 * M.spread : 0) + rand(-0.15, 0.15), -1, 1);
      s.connect(gn); gn.connect(pn); pn.connect(amp); s.start(at);
      v.extra(s, gn, pn); active++;
    };
    v.tick = (until) => {
      const end = Math.min(until, v.relAt, v.endTime - 0.05);
      while (next < end) {
        const g = gust(next);
        if (g > 0.06) {
          let idx = 0;
          if (set.length > 1) { if (p.tuning === 'pair') idx = R() < 0.72 ? 0 : 1; else { idx = Math.floor(R() * set.length); if (idx === last) idx = (idx + 1 + Math.floor(R() * (set.length - 1))) % set.length; } }
          strike(next, g, idx); last = idx;
          const bt = next + rand(0.045, 0.13);
          if (R() < 0.3 + g * 0.35 && bt < v.relAt) strike(bt, g * 0.45, set.length > 2 && R() < 0.5 ? (idx + 1) % set.length : idx);   // the clapper bounces
        }
        next += Math.min(3, -Math.log(1 - R() * 0.999) / (rate * (0.08 + 1.9 * g * g)));
      }
    };
    v.rel = 2.5 + p.ring * 2;   // the wind dies down and the last bells ring out
    return v;
  },
};

export const ASIAN = [gayageum, haegeum, daegeum, janggu, guzheng, erhu, dizi, pipa, templebells, koto, shakuhachi, shamisen, taiko, windchimes];
export const ASIAN_MAP = Object.fromEntries(ASIAN.map(d => [d.id, d]));
// Integrator hook: def.prewarm(ctx, params, midi) makes a plucked string's waveguide buffer ahead of time (the engine calls
// it while loading a project, in small slices), so play() and the scheduler only reuse cached buffers.
for (const [id, sd] of [['gayageum', gayageumDef], ['guzheng', guzhengDef], ['koto', kotoDef], ['pipa', pipaDef], ['shamisen', shamisenDef]])
  ASIAN_MAP[id].prewarm = (ctx, p, midi) => { stringBuffer(ctx, sd, p, midi); };
