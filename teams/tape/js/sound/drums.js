// drums.js - BEATS lane: a synthesized drum machine (MIDI 36-51) and an 808 Bass. Web Audio nodes only, no samples.
// Same definition format as instruments.js: {id, name, kind, maxVoices, params, macros, presets:[{id,name,params}], voice()}.
// A voice: {out, release(t), kill(t), stop(t), endTime, dead}; the engine owns scheduling, polyphony and cleanup.
// Register with: INSTRUMENTS.push(...DRUM_INSTRUMENTS); Object.assign(INSTRUMENT_MAP, {drums, bass808}) (the integrator).
import { clamp, mtof, rng, noiseBuffer, disconnectAll, cached } from './util.js';

const P = (id, name, min, max, def, extra = {}) => ({ id, name, min, max, default: def, unit: '', ...extra });
const R = rng(3636);
const rand = (a = 0, b = 1) => a + (b - a) * R();
const vamp = v => Math.pow(clamp(v, 0, 1), 1.3);

// ---------------------------------------------------------------- the drum map (MIDI 36-51, one row per key in the step editor)
// voice = which synth model plays it; tune = semitone offset on top of that voice's Tune; lvl = row level trim
export const DRUM_MAP = [
  { midi: 36, voice: 'kick', name: 'Kick', short: 'KCK' },
  { midi: 37, voice: 'rim', name: 'Rim', short: 'RIM' },
  { midi: 38, voice: 'snare', name: 'Snare', short: 'SNR' },
  { midi: 39, voice: 'clap', name: 'Clap', short: 'CLP' },
  { midi: 40, voice: 'snare', name: 'Snare ghost', short: 'GHO', tune: -1, lvl: 0.5, dec: 0.7 },
  { midi: 41, voice: 'tom', name: 'Tom low', short: 'TL', tune: -5 },
  { midi: 42, voice: 'hat', name: 'Closed hat', short: 'CH' },
  { midi: 43, voice: 'tom', name: 'Tom mid', short: 'TM', tune: 0 },
  { midi: 44, voice: 'shaker', name: 'Shaker', short: 'SHK' },
  { midi: 45, voice: 'tom', name: 'Tom high', short: 'TH', tune: 5 },
  { midi: 46, voice: 'ohat', name: 'Open hat', short: 'OH' },
  { midi: 47, voice: 'cowbell', name: 'Cowbell', short: 'COW' },
  { midi: 48, voice: 'cowbell', name: 'Cowbell high', short: 'CW2', tune: 7 },
  { midi: 49, voice: 'crash', name: 'Crash', short: 'CRS' },
  { midi: 50, voice: 'riser', name: 'Noise riser', short: 'RSR' },
  { midi: 51, voice: 'kick', name: 'Boom kick', short: 'BOM', tune: -3, dec: 2.2, lvl: 0.95 },
];
export const DRUM_BY_MIDI = Object.fromEntries(DRUM_MAP.map(d => [d.midi, d]));
// the synth models that own Tune / Decay / Level params (crash and riser use "crash"/"riser")
const MODELS = [
  ['kick', 'Kick'], ['snare', 'Snare'], ['clap', 'Clap'], ['rim', 'Rim'], ['hat', 'Closed hat'], ['ohat', 'Open hat'],
  ['shaker', 'Shaker'], ['tom', 'Toms'], ['cowbell', 'Cowbell'], ['crash', 'Crash'], ['riser', 'Riser'],
];

// ---------------------------------------------------------------- shared voice plumbing (same contract as instruments.js)
class Voice {
  constructor(ctx, env, t) {
    this.ctx = ctx; this.env = env; this.t0 = t; this.out = ctx.createGain();
    this.srcs = []; this.nodes = [this.out]; this.amps = []; this.endTime = Infinity; this.released = false; this.ghosts = [];
  }
  node(n) { this.nodes.push(n); return n; }
  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return this.node(g); }
  filter(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = clamp(f, 10, 20000); b.Q.value = q; return this.node(b); }
  osc(type, freq, t) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.start(t); this.srcs.push(o); return this.node(o); }
  noise(t, kind = 'white') { const s = this.ctx.createBufferSource(); s.buffer = noiseBuffer(this.ctx, kind); s.loop = true; s.start(t, rand(0, 5)); this.srcs.push(s); return this.node(s); }
  shaper(curve) { const w = this.ctx.createWaveShaper(); w.curve = curve; w.oversample = '2x'; return this.node(w); }
  // one-shot: sources stop at `t`; when they end every node is freed and the engine is told (ghost voices too)
  stop(t) {
    t = Math.max(t, this.ctx.currentTime);
    if (t >= this.endTime && this.stopSet) return;
    this.endTime = t; this.stopSet = true;
    for (const s of this.srcs) { try { s.stop(t); } catch (e) { } }
    for (const g of this.ghosts) g.endTime = t;
    const first = this.srcs[0];
    const done = () => { if (this.dead) return; this.dead = true; disconnectAll(...this.nodes); this.env.voiceEnded?.(this); for (const g of this.ghosts) g.end(); };
    if (first) first.onended = done; else done();
  }
  fade(t, tc = 0.01) { for (const a of this.amps) { if (a.cancelAndHoldAtTime) a.cancelAndHoldAtTime(t); else a.cancelScheduledValues(t); a.setTargetAtTime(0, t, tc); } }
  kill(t) { t = Math.max(t, this.ctx.currentTime); this.fade(t, 0.01); this.released = true; this.stop(t + 0.06); }
}

// tanh drive curve y = tanh(k x) / tanh(k): unity peak, more harmonics as k rises
function driveCurve(ctx, k) {
  k = Math.max(0.05, Math.round(k * 10) / 10);
  return cached(ctx, 'drive:' + k, () => { const n = 2049, c = new Float32Array(n), d = Math.tanh(k); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / d; } return c; });
}
// metallic square stack (TR-808 hats / cymbals), ratios of the classic six oscillators
const METAL = [1, 1.4823, 1.8003, 2.5458, 2.6302, 3.8961];

// per-track memory (open-hat choke, 808 mono legato). Keyed by the track's resolved params object.
const memory = new WeakMap();
const mem = p => { let m = memory.get(p); if (!m) { m = { open: [], last: null }; memory.set(p, m); } return m; };

// ---------------------------------------------------------------- 1. Drum machine
const drumParams = [
  P('punch', 'Punch', 0, 1, 0.55), P('tone', 'Tone', 0, 1, 0.65), P('grit', 'Grit', 0, 1, 0.1), P('decay', 'Decay', 0.3, 2, 1),
  P('level', 'Level', 0, 1.5, 1),
];
for (const [id, name] of MODELS) {
  drumParams.push(P(id + 'Tune', name + ' tune', -12, 12, 0, { unit: 'st', step: 0.5 }), P(id + 'Decay', name + ' decay', 0.2, 3, 1), P(id + 'Level', name + ' level', 0, 1.5, 1));
}
const kit = o => o;   // presets list only what differs from the defaults
const drums = {
  id: 'drums', name: 'Drum Machine', kind: 'drums', maxVoices: 24,
  drumMap: DRUM_MAP,
  params: drumParams,
  macros: ['punch', 'tone', 'grit', 'decay'],
  presets: [
    { id: 'future-garage', name: 'Future Garage', params: kit({ punch: 0.45, tone: 0.6, grit: 0.08, decay: 1,
      kickTune: -2, kickDecay: 0.9, snareTune: 2, snareDecay: 1.15, snareLevel: 0.9, clapDecay: 1.3, rimLevel: 0.8,
      hatTune: 0, hatDecay: 0.8, hatLevel: 0.7, ohatDecay: 0.8, ohatLevel: 0.6, shakerLevel: 0.8, cowbellLevel: 0.6, crashLevel: 0.6, riserLevel: 0.8 }) },
    { id: 'phonk', name: 'Phonk', params: kit({ punch: 0.8, tone: 0.75, grit: 0.45, decay: 1.05,
      kickTune: 1, kickDecay: 0.8, kickLevel: 1.1, snareTune: 3, snareDecay: 0.8, clapDecay: 0.9, clapLevel: 1.1, hatTune: 2, hatDecay: 0.7,
      ohatDecay: 0.7, cowbellTune: 0, cowbellDecay: 1.9, cowbellLevel: 1.05, crashLevel: 0.7 }) },
    { id: 'lofi-dust', name: 'Lo-fi Dust', params: kit({ punch: 0.3, tone: 0.28, grit: 0.32, decay: 0.85,
      kickTune: -1, kickDecay: 0.75, snareTune: -2, snareDecay: 0.9, snareLevel: 0.95, clapLevel: 0.8, rimLevel: 1.1, hatTune: -3, hatDecay: 1.1, hatLevel: 0.85,
      ohatTune: -3, shakerLevel: 1.0, cowbellLevel: 0.5, crashTune: -4, crashLevel: 0.6 }) },
    { id: 'soft-ambient', name: 'Soft Ambient', params: kit({ punch: 0.15, tone: 0.45, grit: 0, decay: 1.4,
      kickTune: -3, kickDecay: 1.2, kickLevel: 0.85, snareTune: -1, snareDecay: 1.4, snareLevel: 0.7, clapDecay: 1.6, clapLevel: 0.65, rimLevel: 0.7,
      hatDecay: 1.3, hatLevel: 0.55, ohatDecay: 1.4, ohatLevel: 0.5, shakerDecay: 1.4, shakerLevel: 0.7, tomDecay: 1.4, tomLevel: 0.75,
      cowbellLevel: 0.45, crashDecay: 1.5, crashLevel: 0.5, riserDecay: 1.5, riserLevel: 0.7 }) },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const d = DRUM_BY_MIDI[clamp(Math.round(midi), 36, 51)] || DRUM_BY_MIDI[36];
    const m = d.voice === 'ohat' ? 'ohat' : d.voice, a = vamp(vel);
    const tune = (p[m + 'Tune'] ?? 0) + (d.tune || 0), dec = (p[m + 'Decay'] ?? 1) * (d.dec || 1) * p.decay;
    const lvl = (p[m + 'Level'] ?? 1) * (d.lvl ?? 1) * p.level * a * 0.6;   // 0.6: kit peaks near -6 dBFS raw, so the safety limiter stays out of it
    const v = new Voice(ctx, env, t);
    // voice bus: model -> (grit) -> tone lowpass -> out
    const sum = v.gain(1);
    let tail = sum;
    if (p.grit > 0.02) { const pre = v.gain(1 + p.grit * 3), sh = v.shaper(driveCurve(ctx, 1 + p.grit * 5)), post = v.gain(0.75 / (1 + p.grit * 2.2)); tail.connect(pre); pre.connect(sh); sh.connect(post); tail = post; }
    const bright = ['hat', 'ohat', 'shaker', 'crash'].includes(d.voice);   // metal and noise keep their air when Tone is low
    if (p.tone < 0.97) { const lp = v.filter('lowpass', bright ? 5000 * Math.pow(4, p.tone) : 1800 * Math.pow(11, p.tone), 0.5); tail.connect(lp); tail = lp; }
    tail.connect(v.out);
    const ratio = Math.pow(2, tune / 12);
    const env1 = (g, peak, att, tc, at = t) => { g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + att); g.gain.setTargetAtTime(0, at + att, tc); v.amps.push(g.gain); };
    let len = 0.5;
    const MODEL = {
      kick() {
        const base = 52 * ratio, o = v.osc('sine', base, t), g = v.gain(0);
        o.frequency.setValueAtTime(base * (3.2 + p.punch * 2.2), t); o.frequency.setTargetAtTime(base * 1.35, t, 0.012); o.frequency.setTargetAtTime(base, t + 0.03, 0.08);
        o.connect(g); g.connect(sum);
        const tc = 0.07 + dec * 0.11; env1(g, lvl * 0.62, 0.0015, tc); len = tc * 7;
        const sub = v.osc('triangle', base * 2, t), sg = v.gain(0); sub.frequency.setValueAtTime(base * 5, t); sub.frequency.setTargetAtTime(base * 2, t, 0.01);
        sub.connect(sg); sg.connect(sum); env1(sg, lvl * 0.12, 0.001, 0.025);
        if (p.punch > 0.02) { const n = v.noise(t), hp = v.filter('highpass', 2200, 0.7), ng = v.gain(0); n.connect(hp); hp.connect(ng); ng.connect(sum); env1(ng, lvl * 0.3 * p.punch, 0.0007, 0.0045); }
      },
      snare() {
        const f = 185 * ratio, o1 = v.osc('triangle', f, t), o2 = v.osc('sine', f * 1.78, t), g = v.gain(0);
        o1.frequency.setValueAtTime(f * 1.6, t); o1.frequency.setTargetAtTime(f, t, 0.012); o1.connect(g); o2.connect(g); g.connect(sum);
        env1(g, lvl * (0.22 + p.punch * 0.18), 0.001, 0.03 + dec * 0.025);
        const n = v.noise(t), bp = v.filter('highpass', 1200 * ratio, 0.6), pk = v.filter('peaking', 5200, 1); pk.gain.value = 4;
        const ng = v.gain(0); n.connect(bp); bp.connect(pk); pk.connect(ng); ng.connect(sum);
        const tc = 0.045 + dec * 0.05; env1(ng, lvl * 0.3, 0.001, tc); len = tc * 8;
      },
      clap() {
        const n = v.noise(t), bp = v.filter('bandpass', 1150 * ratio, 1.4), hp = v.filter('highpass', 650, 0.7), g = v.gain(0);
        n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(sum);
        const pk = lvl * 1.0, gg = g.gain; gg.setValueAtTime(0, t); v.amps.push(gg);
        for (let i = 0; i < 3; i++) { const s = t + i * 0.011; gg.setValueAtTime(pk * (0.8 + i * 0.1), s); gg.setTargetAtTime(pk * 0.1, s + 0.0005, 0.003); }
        const tc = 0.05 + dec * 0.07; gg.setValueAtTime(pk, t + 0.034); gg.setTargetAtTime(0, t + 0.0345, tc); len = 0.04 + tc * 8;
      },
      rim() {
        const f = 1680 * ratio, o1 = v.osc('triangle', f, t), o2 = v.osc('square', f * 0.271, t), bp = v.filter('bandpass', f, 2.5), g = v.gain(0);
        const g2 = v.gain(0.25); o1.connect(bp); o2.connect(g2); g2.connect(bp); bp.connect(g); g.connect(sum);
        const tc = 0.008 + dec * 0.008; env1(g, lvl * 0.45, 0.0005, tc); len = tc * 9;
      },
      hat(open = false) {
        // choke: a closed hat silences any open hat still ringing on this track
        const mm = mem(p);
        if (!open) { for (const o of mm.open) if (!o.dead && o.t0 < t) o.kill(t); mm.open = []; }
        const f0 = 300 * ratio, hp = v.filter('highpass', 7000 * Math.min(ratio, 1.3), 0.8), bp = v.filter('bandpass', 10000, 0.9), g = v.gain(0);
        const mix = v.gain(0.16);
        for (const r of METAL.slice(0, 4)) { const o = v.osc('square', f0 * r, t); o.connect(mix); }
        const n = v.noise(t), ng = v.gain(0.55); n.connect(ng); ng.connect(bp); mix.connect(bp); bp.connect(hp); hp.connect(g); g.connect(sum);
        const tc = open ? 0.09 + dec * 0.11 : 0.012 + dec * 0.014;
        env1(g, lvl * (open ? 0.42 : 0.48), 0.0008, tc); len = tc * 8;
        if (open) mm.open.push(v);
      },
      ohat() { MODEL.hat(true); },
      shaker() {
        const n = v.noise(t), bp = v.filter('bandpass', 6200 * ratio, 1.3), hp = v.filter('highpass', 3500, 0.7), g = v.gain(0);
        n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(sum);
        const tc = 0.022 + dec * 0.02; env1(g, lvl * 0.42, 0.012, tc); len = 0.012 + tc * 8;
      },
      tom() {
        const f = 120 * ratio, o = v.osc('sine', f * 1.5, t), g = v.gain(0);
        o.frequency.setTargetAtTime(f, t, 0.035); o.connect(g); g.connect(sum);
        const tc = 0.08 + dec * 0.09; env1(g, lvl * 0.5, 0.001, tc); len = tc * 7;
        const n = v.noise(t, 'pink'), bp = v.filter('bandpass', f * 4, 1), ng = v.gain(0); n.connect(bp); bp.connect(ng); ng.connect(sum); env1(ng, lvl * 0.12 * (0.5 + p.punch), 0.001, 0.01);
      },
      cowbell() {
        // TR-808: two squares (540 / 800 Hz) through a band-pass, fast hit then a long tail
        const f1 = 540 * ratio, f2 = 800 * ratio, o1 = v.osc('square', f1, t), o2 = v.osc('square', f2, t);
        const bp = v.filter('bandpass', f2 * 1.05, 1.1), hp = v.filter('highpass', 350, 0.7), g = v.gain(0);
        const m1 = v.gain(0.5), m2 = v.gain(0.5); o1.connect(m1); o2.connect(m2); m1.connect(bp); m2.connect(bp); bp.connect(hp); hp.connect(g); g.connect(sum);
        const pk = lvl * 0.34, gg = g.gain; v.amps.push(gg);
        const tc = 0.05 + dec * 0.11;
        gg.setValueAtTime(0, t); gg.linearRampToValueAtTime(pk, t + 0.001); gg.setTargetAtTime(pk * 0.35, t + 0.001, 0.012); gg.setTargetAtTime(0, t + 0.03, tc);
        len = 0.03 + tc * 8;
      },
      crash() {
        const f0 = 420 * ratio, mix = v.gain(0.1), hp = v.filter('highpass', 4800, 0.7), sh = v.filter('highshelf', 9000, 0.7), g = v.gain(0);
        sh.gain.value = -3 + p.tone * 4;
        for (const r of METAL) { const o = v.osc('square', f0 * r, t); o.connect(mix); }
        const n = v.noise(t), ng = v.gain(0.6); n.connect(ng); ng.connect(hp); mix.connect(hp); hp.connect(sh); sh.connect(g); g.connect(sum);
        const tc = 0.35 + dec * 0.45; env1(g, lvl * 0.3, 0.002, tc); len = tc * 7;
      },
      riser() {
        // tempo-synced white-noise sweep: 4 beats at Decay 1 (0.8-12 beats), filter opens as it swells, then a short fade
        const spb = 60 / clamp(env.bpm?.() || 90, 20, 300), L = clamp(4 * dec, 0.8, 12) * spb;
        const n = v.noise(t), bp = v.filter('bandpass', 350 * ratio, 2.2), g = v.gain(0); n.connect(bp); bp.connect(g); g.connect(sum);
        bp.frequency.setValueAtTime(350 * ratio, t); bp.frequency.exponentialRampToValueAtTime(clamp(8500 * ratio, 1000, 16000), t + L);
        const gg = g.gain; v.amps.push(gg); gg.setValueAtTime(0.0001, t); gg.exponentialRampToValueAtTime(lvl * 0.9, t + L); gg.setTargetAtTime(0, t + L, 0.03);
        len = L + 0.25;
      },
    };
    MODEL[d.voice]();
    v.stop(t + len + 0.05);
    v.release = () => { };   // one-shots ring out past note-off; stop/kill still work
    return v;
  },
};

// ---------------------------------------------------------------- 2. 808 Bass (mono, glides between overlapping notes)
const bass808 = {
  id: 'bass808', name: '808 Bass', kind: 'bass', maxVoices: 4,
  params: [P('glide', 'Glide', 0, 1, 0.35), P('drive', 'Drive', 0, 1, 0.2), P('length', 'Length', 0, 1, 0.6), P('punch', 'Punch', 0, 1, 0.45),
    P('tone', 'Tone', 0, 1, 0.55), P('bend', 'Pitch drop', 0, 12, 4, { unit: 'st', step: 0.5 }), P('level', 'Level', 0, 1.5, 1)],
  macros: ['glide', 'drive', 'length', 'punch'],
  presets: [
    { id: 'deep-sub', name: 'Deep Sub', params: { glide: 0.3, drive: 0.05, length: 0.8, punch: 0.3, tone: 0.4, bend: 2 } },
    { id: 'phonk-808', name: 'Phonk 808', params: { glide: 0.25, drive: 0.75, length: 0.55, punch: 0.75, tone: 0.75, bend: 7, level: 0.85 } },
    { id: 'garage-sub', name: 'Garage Sub', params: { glide: 0.15, drive: 0.2, length: 0.35, punch: 0.5, tone: 0.5, bend: 3 } },
    { id: 'slide-808', name: 'Long Slide', params: { glide: 0.7, drive: 0.45, length: 1, punch: 0.4, tone: 0.6, bend: 0, level: 0.95 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const f = mtof(midi), a = vamp(vel), mm = mem(p);
    const glideT = p.glide * p.glide * 0.35;
    const prev = mm.last;
    const overlaps = prev && !prev.dead && prev.endTime > t + 0.003 && prev.t0 < t - 0.002 && !(prev.offAt <= t + 0.003) && !prev.killed;
    // legato: the sounding voice glides to the new pitch and the new note is a "ghost" that owns its ending
    if (overlaps && glideT > 0.004) return prev.legato(f, a, t, glideT);
    if (overlaps) prev.kill(t);   // mono: no glide = cut the old note
    const v = new Voice(ctx, env, t);
    const o = v.osc('sine', f, t), amp = v.gain(0);
    v.freq = o.frequency;
    const bendTo = (fr, at) => { o.frequency.setValueAtTime(fr * Math.pow(2, p.bend / 12), at); o.frequency.setTargetAtTime(fr, at, 0.025 + p.punch * 0.01); };
    bendTo(f, t);
    o.connect(amp);
    // drive after the envelope, so the tail cleans up like a real distorted 808
    let tail = amp;
    if (p.drive > 0.02) { const sh = v.shaper(driveCurve(ctx, 1 + p.drive * 7)); amp.connect(sh); tail = sh; }
    const lp = v.filter('lowpass', 250 * Math.pow(24, p.tone), 0.6), out = v.gain(p.level * (p.drive > 0.02 ? 0.42 - p.drive * 0.12 : 0.42));
    tail.connect(lp); lp.connect(out); out.connect(v.out);
    if (p.punch > 0.02) {   // the click on top
      const n = v.noise(t), bp = v.filter('bandpass', 1800, 0.8), ng = v.gain(0); n.connect(bp); bp.connect(ng); ng.connect(v.out);
      ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(a * p.punch * 0.12 * p.level, t + 0.0008); ng.gain.setTargetAtTime(0, t + 0.0008, 0.004); v.amps.push(ng.gain);
    }
    const tc = p.length >= 0.99 ? 60 : 0.12 + Math.pow(p.length, 2) * 2.4;     // Length 1 = holds while the key is down
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(a, t + 0.003); amp.gain.setTargetAtTime(0, t + 0.003, tc);
    v.amps.push(amp.gain);
    const natural = at => at + Math.min(tc * 7, 30);
    v.owner = v; mm.last = v;
    v.stop(natural(t));
    v.release = (at, r = 0.06) => {
      if (v.owner !== v || v.released) return;   // a newer legato note owns the sound now
      v.offAt = at; v.released = true; at = Math.max(at, ctx.currentTime);
      v.fade(at, r / 4); v.stop(at + r * 1.7 + 0.03);
    };
    const baseKill = v.kill.bind(v);
    v.kill = at => { v.killed = true; baseKill(at); };
    v.legato = (nf, na, at, gt) => {
      // glide the oscillator from wherever it is now to the new note; re-swell the envelope a little
      o.frequency.cancelAndHoldAtTime ? o.frequency.cancelAndHoldAtTime(at) : o.frequency.cancelScheduledValues(at);
      o.frequency.setTargetAtTime(nf, at, gt / 3);
      amp.gain.cancelAndHoldAtTime ? amp.gain.cancelAndHoldAtTime(at) : amp.gain.cancelScheduledValues(at);
      amp.gain.linearRampToValueAtTime(Math.max(na, 0.3), at + 0.02); amp.gain.setTargetAtTime(0, at + 0.02, tc);
      v.released = false; v.offAt = undefined;
      v.stopSet = false; v.stop(natural(at));
      for (const old of v.ghosts) old.end();   // earlier legato notes hand over: only the newest one stays counted as a voice
      v.ghosts = [];
      const g = { out: ctx.createGain(), nodes: [], endTime: v.endTime, t0: at, dead: false, midi: 0 };
      g.nodes = [g.out];
      g.end = () => { if (g.dead) return; g.dead = true; try { g.out.disconnect(); } catch (e) { } env.voiceEnded?.(g); };
      g.release = (rt, r) => { if (v.owner !== g) return; g.offAt = rt; v.owner = v; v.released = false; v.release(rt, r); v.offAt = rt; g.endTime = v.endTime; };
      g.stop = st => { if (v.owner === g) { v.owner = v; v.stop(st); } };
      g.kill = kt => { if (v.owner === g) { v.owner = v; v.kill(kt); } };
      Object.defineProperty(g, 'offAt', { get: () => v.offAt, set: x => { v.offAt = x; }, configurable: true });
      g.legato = (...args) => v.legato(...args);
      Object.defineProperty(g, 'killed', { get: () => v.killed });
      v.owner = g; v.ghosts.push(g); mm.last = g;
      return g;
    };
    return v;
  },
};

export const DRUMS = drums;
export const BASS808 = bass808;
export const DRUM_INSTRUMENTS = [drums, bass808];
