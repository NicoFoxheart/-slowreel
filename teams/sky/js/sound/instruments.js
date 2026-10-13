// instruments.js - the sky instruments. All synthesized with Web Audio nodes (no samples), except the Song Cloud,
// which turns one of Nico's songs into a playable granular pad.
//
// Each definition: {id, name, kind, poly, macros:[paramIds], params:[descriptors], presets:[{id, name, params}],
//   core(ctx, out, P, env) -> {update(P, id, live), voice(midi, vel, t, P) -> Voice, tick?(until), ready?, dispose()}}
// Macro knobs are ordinary params (0..1) listed in `macros`. A param with `options` takes the option index.
import { SONG_LIST } from './songs.js';
import { clamp, expMap, mtof, dbToGain, velCurve, glide, setNow, noiseBuffer, HANN, envAttack, envRelease, safeDisconnect, safeStop, driveCurve, shared } from './util.js';

const P = (id, name, min, max, def, extra = {}) => ({ id, name, min, max, default: def, ...extra });
const M = (id, name, def = 0.5) => P(id, name, 0, 1, def);
const LEVEL = P('level', 'Level', -24, 6, 0, { unit: 'dB' });
const OCT = P('octave', 'Octave', -2, 2, 0, { step: 1 });
const REL = (d = 4, max = 14) => P('release', 'Release', 0.1, max, d, { unit: 's' });

// ---------------------------------------------------------------------------------------------------------------
// Voice: owns the nodes of one note. release() starts the tail; kill() fades fast (stop / voice stealing).
class Voice {
  constructor(ctx) { this.ctx = ctx; this.nodes = []; this.srcs = []; this.amps = []; this.links = []; this.releaseTime = 2; this.end = Infinity; this.oneShot = false; this.released = false; this.onDone = null; this._hooked = false; }
  node(n) { this.nodes.push(n); return n; }
  src(n, t) { this.nodes.push(n); this.srcs.push(n); n.start(t); return n; }
  osc(type, freq, t, detune = 0) { const o = this.ctx.createOscillator(); if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type); o.frequency.value = freq; o.detune.value = detune; return this.src(o, t); }
  gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return this.node(g); }
  link(from, param) { from.connect(param); this.links.push([from, param]); }
  finish(endT) {
    this.end = endT;
    for (const s of this.srcs) safeStop(s, endT);
    if (!this._hooked && this.srcs.length) { this._hooked = true; this.srcs[0].onended = () => this.cleanup(); }
  }
  release(t) {
    if (this.released) return; this.released = true;
    if (this.oneShot) return;
    for (const a of this.amps) envRelease(a, t, this.releaseTime);
    this.finish(t + this.releaseTime * 1.15 + 0.05);
  }
  kill(t, fade = 0.025) {
    this.released = true;
    if (this.end <= t) return;
    for (const a of this.amps) { a.cancelScheduledValues(t); a.setTargetAtTime(0, t, fade / 3); }
    this.finish(Math.min(this.end, t + fade * 2.5 + 0.02));
  }
  cleanup() {
    for (const [from, param] of this.links) { try { from.disconnect(param); } catch { /* gone */ } }
    this.links = []; safeDisconnect(...this.nodes); this.nodes = []; this.srcs = [];
    if (this.onDone) this.onDone(this);
  }
}

const panner = (ctx, pan, dest) => { const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(dest); return p; };
const biquad = (ctx, type, freq, q = 0.7) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; };
const startLfo = (ctx, rate, type = 'sine') => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = rate; o.start(); return o; };
const gainNode = (ctx, v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
const setter = live => (ctx, prm, v, s = 0.06) => (live ? glide(ctx, prm, v, s) : setNow(prm, v));

// ---------------------------------------------------------------------------------------------------------------
const glassPad = {
  id: 'glassPad', name: 'Glass Pad', kind: 'pad', poly: 12,
  macros: ['brightness', 'motion', 'bloom', 'glass'],
  params: [M('brightness', 'Brightness', 0.5), M('motion', 'Motion', 0.4), M('bloom', 'Bloom', 0.55), M('glass', 'Glass', 0.45),
    P('detune', 'Detune', 0, 30, 8, { unit: 'cents' }), REL(5), OCT, LEVEL],
  presets: [
    { id: 'glass-pad', name: 'Glass Pad', params: { brightness: 0.5, motion: 0.4, bloom: 0.55, glass: 0.45, detune: 8, release: 5 } },
    { id: 'aurora', name: 'Aurora', params: { brightness: 0.66, motion: 0.75, bloom: 0.7, glass: 0.65, detune: 13, release: 7 } },
    { id: 'frozen-lake', name: 'Frozen Lake', params: { brightness: 0.3, motion: 0.2, bloom: 0.8, glass: 0.25, detune: 6, release: 9 } },
    { id: 'prism', name: 'Prism', params: { brightness: 0.78, motion: 0.5, bloom: 0.3, glass: 0.85, detune: 5, release: 4 } },
  ],
  core(ctx, out, Pr) {
    const level = gainNode(ctx, 1), lp = biquad(ctx, 'lowpass', 3000, 0.5), hp = biquad(ctx, 'highpass', 70, 0.6);
    lp.connect(hp); hp.connect(level); level.connect(out);
    const pL = panner(ctx, -0.6, lp), pR = panner(ctx, 0.6, lp), glassIn = gainNode(ctx, 1);
    glassIn.connect(lp);
    const l1 = startLfo(ctx, 0.11), l1G = gainNode(ctx, 0), l1N = gainNode(ctx, 0), l2 = startLfo(ctx, 0.053), l2G = gainNode(ctx, 0);
    l1.connect(l1G); l1.connect(l1N); l2.connect(l2G); l2G.connect(lp.detune);
    const update = (p, id, live) => {
      const s = setter(live);
      s(ctx, lp.frequency, expMap(p.brightness, 450, 9000), 0.1);
      s(ctx, l1G.gain, p.motion * 14); s(ctx, l1N.gain, -p.motion * 14); s(ctx, l2G.gain, p.motion * 650);
      s(ctx, glassIn.gain, 0.2 + p.glass * 1.6); s(ctx, level.gain, dbToGain(p.level));
    };
    update(Pr, null, false);
    return {
      update,
      voice(midi, vel, t, p) {
        const V = new Voice(ctx), f = mtof(midi + 12 * Math.round(p.octave)), atk = expMap(p.bloom, 0.15, 5), amp = 0.07 * velCurve(vel);
        V.releaseTime = p.release;
        const oA = V.osc('triangle', f, t, -p.detune), oB = V.osc('triangle', f, t, p.detune);
        const oC = V.osc('sine', f * 2, t, 3), oD = V.osc('sine', f * 4, t, -4);
        V.link(l1G, oA.detune); V.link(l1N, oB.detune);
        const gA = V.gain(), gB = V.gain(), gC = V.gain(), c1 = V.gain(0.3), c2 = V.gain(f < 1400 ? 0.09 : 0.03);
        oA.connect(gA); gA.connect(pL); oB.connect(gB); gB.connect(pR);
        oC.connect(c1); oD.connect(c2); c1.connect(gC); c2.connect(gC); gC.connect(glassIn);
        envAttack(gA.gain, t, amp, atk); envAttack(gB.gain, t, amp, atk); envAttack(gC.gain, t, amp, atk * 1.7);
        V.amps.push(gA.gain, gB.gain, gC.gain);
        return V;
      },
      dispose() { safeStop(l1); safeStop(l2); safeDisconnect(level, lp, hp, pL, pR, glassIn, l1, l1G, l1N, l2, l2G); },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------------
const BELL_MODELS = [
  { name: 'Glass', ratios: [1, 2.0, 3.01, 4.17, 5.43], amps: [1, 0.5, 0.28, 0.16, 0.08], decays: [1, 0.62, 0.45, 0.3, 0.2] },
  { name: 'Celesta', ratios: [1, 2, 3, 4.01], amps: [1, 0.28, 0.07, 0.04], decays: [1, 0.4, 0.25, 0.15] },
  { name: 'Bowl', ratios: [1, 2.71, 5.15, 8.4], amps: [1, 0.42, 0.18, 0.07], decays: [1, 0.8, 0.5, 0.3] },
  { name: 'Chime', ratios: [1, 2.76, 5.4, 8.93], amps: [1, 0.48, 0.22, 0.1], decays: [1, 0.55, 0.35, 0.2] },
];
const bells = {
  id: 'bells', name: 'Crystal Bells', kind: 'bells', poly: 18,
  macros: ['hardness', 'decay', 'shimmer', 'tone'],
  params: [P('model', 'Body', 0, BELL_MODELS.length - 1, 0, { step: 1, options: BELL_MODELS.map(m => m.name) }),
    M('hardness', 'Strike', 0.45), M('decay', 'Ring', 0.55), M('shimmer', 'Shimmer', 0.3), M('tone', 'Tone', 0.6), LEVEL],
  presets: [
    { id: 'glass-bell', name: 'Glass Bell', params: { model: 0, hardness: 0.45, decay: 0.55, shimmer: 0.3, tone: 0.6 } },
    { id: 'celesta-light', name: 'Celesta Light', params: { model: 1, hardness: 0.35, decay: 0.38, shimmer: 0.15, tone: 0.55 } },
    { id: 'singing-bowl', name: 'Singing Bowl', params: { model: 2, hardness: 0.2, decay: 0.85, shimmer: 0.6, tone: 0.45 } },
    { id: 'wind-chime', name: 'Wind Chime', params: { model: 3, hardness: 0.55, decay: 0.62, shimmer: 0.35, tone: 0.7 } },
  ],
  core(ctx, out, Pr) {
    const level = gainNode(ctx, 1), lp = biquad(ctx, 'lowpass', 8000, 0.5), hp = biquad(ctx, 'highpass', 120, 0.6);
    lp.connect(hp); hp.connect(level); level.connect(out);
    const pans = [-0.55, -0.15, 0.2, 0.55].map(x => panner(ctx, x, lp));
    const update = (p, id, live) => { const s = setter(live); s(ctx, lp.frequency, expMap(p.tone, 1600, 13000), 0.1); s(ctx, level.gain, dbToGain(p.level)); };
    update(Pr, null, false);
    return {
      update,
      voice(midi, vel, t, p) {
        const V = new Voice(ctx), f = mtof(midi), m = BELL_MODELS[clamp(Math.round(p.model), 0, BELL_MODELS.length - 1)];
        V.oneShot = true;
        const hard = clamp(p.hardness * 0.75 + velCurve(vel) * 0.45, 0, 1.2), T = expMap(p.decay, 1.2, 14), base = 0.12 * velCurve(vel);
        const att = 0.0015 + (1 - Math.min(1, hard)) * 0.006;
        const out = V.gain(1); out.connect(pans[(midi * 7) % pans.length]);
        let endT = t + 0.3;
        m.ratios.forEach((r, i) => {
          const fr = f * r; if (fr > 12500) return;
          const a = base * m.amps[i] * (i === 0 ? 1 : 0.3 + hard * 1.1) / (1 + fr / 5000);
          const Ti = T * m.decays[i] * clamp(1.5 - fr / 9000, 0.35, 1.3);
          const tw = i < 2 && p.shimmer > 0.02;
          const parts = tw ? [[fr, a * (1 - p.shimmer * 0.35)], [fr + p.shimmer * 1.8 * (i + 1), a * p.shimmer * 0.45]] : [[fr, a]];
          for (const [fq, amp] of parts) {
            const o = V.osc('sine', fq, t), g = V.gain();
            o.connect(g); g.connect(out);
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + att); g.gain.setTargetAtTime(0, t + att, Ti / 6.9);
            V.amps.push(g.gain);
          }
          endT = Math.max(endT, t + att + Ti * 1.05);
        });
        V.finish(endT + 0.05);
        return V;
      },
      dispose() { safeDisconnect(level, lp, hp, ...pans); },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------------
const VOWELS = [[800, 1150, 2900], [450, 800, 2830], [350, 600, 2700]]; // ah, oh, oo (soprano)
const vowelAt = v => { const x = clamp(v, 0, 1) * 2, i = Math.min(1, Math.floor(x)), k = x - i; return VOWELS[i].map((f, j) => f + (VOWELS[i + 1][j] - f) * k); };
const choir = {
  id: 'choir', name: 'Choir Air', kind: 'voice', poly: 10,
  macros: ['vowel', 'breath', 'ensemble', 'brightness'],
  params: [M('vowel', 'Vowel (ah to oo)', 0.3), M('breath', 'Breath', 0.3), M('ensemble', 'Ensemble', 0.5), M('brightness', 'Brightness', 0.5),
    P('attack', 'Attack', 0.05, 6, 1.4, { unit: 's' }), REL(3.5, 10), OCT, LEVEL],
  presets: [
    { id: 'angel-air', name: 'Angel Air', params: { vowel: 0.15, breath: 0.3, ensemble: 0.5, brightness: 0.6, attack: 1.2, release: 3.5 } },
    { id: 'distant-choir', name: 'Distant Choir', params: { vowel: 0.45, breath: 0.45, ensemble: 0.75, brightness: 0.32, attack: 2, release: 5 } },
    { id: 'ooh-cloud', name: 'Ooh Cloud', params: { vowel: 0.95, breath: 0.2, ensemble: 0.6, brightness: 0.42, attack: 1.6, release: 4 } },
    { id: 'whisper-choir', name: 'Whisper Choir', params: { vowel: 0.35, breath: 0.95, ensemble: 0.4, brightness: 0.55, attack: 1, release: 3 } },
  ],
  core(ctx, out, Pr) {
    const input = gainNode(ctx, 1), sum = gainNode(ctx, 3.2), lp = biquad(ctx, 'lowpass', 4000, 0.5), hp = biquad(ctx, 'highpass', 140, 0.6), level = gainNode(ctx, 1);
    const fs = [7, 10, 12].map(q => biquad(ctx, 'bandpass', 1000, q)), fg = [1, 0.62, 0.3].map(v => gainNode(ctx, v));
    fs.forEach((f, i) => { input.connect(f); f.connect(fg[i]); fg[i].connect(sum); });
    const body = biquad(ctx, 'lowpass', 700, 0.5), bodyG = gainNode(ctx, 0.07); input.connect(body); body.connect(bodyG); bodyG.connect(sum);
    const airIn = gainNode(ctx, 1), airHP = biquad(ctx, 'highpass', 3200, 0.5), airG = gainNode(ctx, 0.05); airIn.connect(airHP); airHP.connect(airG); airG.connect(sum);
    sum.connect(lp); lp.connect(hp); hp.connect(level); level.connect(out);
    const vib = startLfo(ctx, 4.7), vibG = gainNode(ctx, 9), drift = startLfo(ctx, 0.17), driftG = gainNode(ctx, 0);
    vib.connect(vibG); drift.connect(driftG);
    const update = (p, id, live) => {
      const s = setter(live), fq = vowelAt(p.vowel);
      fs.forEach((f, i) => s(ctx, f.frequency, fq[i], 0.25));
      s(ctx, lp.frequency, expMap(p.brightness, 1500, 8000), 0.1); s(ctx, driftG.gain, p.ensemble * 7); s(ctx, level.gain, dbToGain(p.level));
    };
    update(Pr, null, false);
    return {
      update,
      voice(midi, vel, t, p) {
        const V = new Voice(ctx), f = mtof(midi + 12 * Math.round(p.octave)), v = velCurve(vel), e = 3 + p.ensemble * 11;
        V.releaseTime = p.release;
        const vg = V.gain(); vg.connect(input);
        const dets = p.ensemble > 0.45 ? [-e, 0, e] : [-e * 0.6, e * 0.6];
        dets.forEach((d, i) => { const o = V.osc('sawtooth', f, t, d); o.connect(vg); V.link(vibG, o.detune); if (i === 0) V.link(driftG, o.detune); });
        envAttack(vg.gain, t, 0.05 * v * (1 - p.breath * 0.85) * (dets.length === 3 ? 0.8 : 1), p.attack);
        V.amps.push(vg.gain);
        if (p.breath > 0.02) {
          const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx); n.loop = true;
          V.nodes.push(n); V.srcs.push(n); n.start(t, (midi * 0.137) % 3.5);
          const ng = V.gain(); n.connect(ng); ng.connect(input); ng.connect(airIn);
          envAttack(ng.gain, t, 0.045 * v * p.breath, p.attack * 0.8); V.amps.push(ng.gain);
        }
        return V;
      },
      dispose() { safeStop(vib); safeStop(drift); safeDisconnect(input, sum, lp, hp, level, ...fs, ...fg, body, bodyG, airIn, airHP, airG, vib, vibG, drift, driftG); },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------------
const HARP_MODELS = [
  { name: 'Harp', parts: [[1, 'triangle', 1, 1], [2, 'sine', 0.22, 0.6], [3, 'sine', 0.07, 0.4]], dec: 1 },
  { name: 'Glass koto', parts: [[1, 'sawtooth', 0.45, 1], [2, 'sine', 0.18, 0.5]], dec: 0.75, bend: 30 },
  { name: 'Kalimba', parts: [[1, 'sine', 1, 1], [5.92, 'sine', 0.16, 0.12], [3, 'sine', 0.05, 0.3]], dec: 0.7 },
  { name: 'Dew', parts: [[1, 'sine', 1, 1], [2, 'sine', 0.18, 0.7], [4, 'sine', 0.08, 0.35]], dec: 0.45 },
];
const harp = {
  id: 'harp', name: 'Starlight Harp', kind: 'pluck', poly: 20,
  macros: ['brightness', 'decay', 'body', 'sparkle'],
  params: [P('model', 'Body', 0, HARP_MODELS.length - 1, 0, { step: 1, options: HARP_MODELS.map(m => m.name) }),
    M('brightness', 'Brightness', 0.5), M('decay', 'Decay', 0.5), M('body', 'Body', 0.35), M('sparkle', 'Sparkle', 0.35), LEVEL],
  presets: [
    { id: 'starlight-harp', name: 'Starlight Harp', params: { model: 0, brightness: 0.5, decay: 0.55, body: 0.35, sparkle: 0.35 } },
    { id: 'glass-koto', name: 'Glass Koto', params: { model: 1, brightness: 0.45, decay: 0.5, body: 0.2, sparkle: 0.25 } },
    { id: 'lumen-kalimba', name: 'Lumen Kalimba', params: { model: 2, brightness: 0.4, decay: 0.45, body: 0.3, sparkle: 0.2 } },
    { id: 'dew-drops', name: 'Dew Drops', params: { model: 3, brightness: 0.55, decay: 0.4, body: 0.1, sparkle: 0.6 } },
  ],
  core(ctx, out, Pr) {
    const level = gainNode(ctx, 1), lp = biquad(ctx, 'lowpass', 9000, 0.5), hp = biquad(ctx, 'highpass', 90, 0.6);
    lp.connect(hp); hp.connect(level); level.connect(out);
    const pans = [-0.45, -0.1, 0.15, 0.45].map(x => panner(ctx, x, lp));
    const update = (p, id, live) => setter(live)(ctx, level.gain, dbToGain(p.level));
    update(Pr, null, false);
    return {
      update,
      voice(midi, vel, t, p) {
        const V = new Voice(ctx), f = mtof(midi), m = HARP_MODELS[clamp(Math.round(p.model), 0, HARP_MODELS.length - 1)], v = velCurve(vel);
        V.oneShot = true;
        const T = expMap(p.decay, 0.6, 9) * m.dec, amp = 0.13 * v;
        const filt = V.node(ctx.createBiquadFilter()); filt.type = 'lowpass'; filt.Q.value = 0.6;
        const c0 = Math.min(12000, f * (3 + p.brightness * 14) * (0.6 + v * 0.5)), c1 = Math.min(c0, f * 1.6 + 300);
        filt.frequency.setValueAtTime(c0, t); filt.frequency.setTargetAtTime(c1, t + 0.004, T * 0.12);
        filt.connect(pans[(midi * 5) % pans.length]);
        const add = (ratio, type, a, dec, att = 0.002, delay = 0) => {
          const fq = f * ratio; if (fq > 13000 || a <= 0) return;
          const o = V.osc(type, fq, t), g = V.gain(); o.connect(g); g.connect(filt);
          if (m.bend) { o.detune.setValueAtTime(m.bend, t); o.detune.setTargetAtTime(0, t, 0.025); }
          const t0 = t + delay;
          g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(a * amp, t0 + att); g.gain.setTargetAtTime(0, t0 + att, T * dec / 6.9);
          V.amps.push(g.gain);
        };
        for (const [r, type, a, dec] of m.parts) add(r, type, a, dec);
        add(0.5, 'sine', p.body * 0.35, 0.8, 0.004);
        add(2, 'sine', p.sparkle * 0.2, 1.3, 0.012, 0.004);
        V.finish(t + T * 1.35 + 0.1);
        return V;
      },
      dispose() { safeDisconnect(level, lp, hp, ...pans); },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------------
const strings = {
  id: 'strings', name: 'Halo Strings', kind: 'strings', poly: 12,
  macros: ['bow', 'warmth', 'vibrato', 'ensemble'],
  params: [M('bow', 'Bow (attack)', 0.55), M('warmth', 'Warmth', 0.5), M('vibrato', 'Vibrato', 0.35), M('ensemble', 'Ensemble', 0.5),
    P('tremolo', 'Tremolo', 0, 1, 0), REL(3.5, 12), OCT, LEVEL],
  presets: [
    { id: 'halo-strings', name: 'Halo Strings', params: { bow: 0.55, warmth: 0.5, vibrato: 0.35, ensemble: 0.5, tremolo: 0, release: 3.5 } },
    { id: 'high-violins', name: 'High Violins', params: { bow: 0.6, warmth: 0.62, vibrato: 0.45, ensemble: 0.6, tremolo: 0, release: 4 } },
    { id: 'cello-mist', name: 'Cello Mist', params: { bow: 0.65, warmth: 0.32, vibrato: 0.25, ensemble: 0.4, tremolo: 0, release: 4.5 } },
    { id: 'glow-tremolo', name: 'Glow Tremolo', params: { bow: 0.4, warmth: 0.45, vibrato: 0.15, ensemble: 0.55, tremolo: 0.6, release: 3 } },
  ],
  core(ctx, out, Pr) {
    const level = gainNode(ctx, 1), hp = biquad(ctx, 'highpass', 110, 0.6), dip = biquad(ctx, 'peaking', 2700, 1), trem = gainNode(ctx, 1);
    dip.gain.value = -4; hp.connect(dip); dip.connect(trem); trem.connect(level); level.connect(out);
    const pL = panner(ctx, -0.55, hp), pR = panner(ctx, 0.55, hp);
    const vib = startLfo(ctx, 5.1), vibG = gainNode(ctx, 0), tl = startLfo(ctx, 5.6), tlG = gainNode(ctx, 0);
    vib.connect(vibG); tl.connect(tlG); tlG.connect(trem.gain);
    const update = (p, id, live) => {
      const s = setter(live);
      s(ctx, vibG.gain, p.vibrato * 17); s(ctx, tlG.gain, p.tremolo * 0.4); s(ctx, trem.gain, 1 - p.tremolo * 0.4); s(ctx, level.gain, dbToGain(p.level));
    };
    update(Pr, null, false);
    return {
      update,
      voice(midi, vel, t, p) {
        const V = new Voice(ctx), f = mtof(midi + 12 * Math.round(p.octave)), v = velCurve(vel), e = 3 + p.ensemble * 12;
        const atk = expMap(p.bow, 0.08, 5); V.releaseTime = p.release;
        const c = clamp(f * (1.5 + p.warmth * 7), 380, 6500);
        const fL = V.node(biquad(ctx, 'lowpass', c * 0.45, 0.6)), fR = V.node(biquad(ctx, 'lowpass', c * 0.45, 0.6));
        for (const fl of [fL, fR]) { fl.frequency.setValueAtTime(c * 0.45, t); fl.frequency.setTargetAtTime(c, t, atk * 0.45 + 0.02); }
        const oL = V.osc('sawtooth', f, t, -e), oR = V.osc('sawtooth', f, t, e), oC = V.osc('sawtooth', f, t, e * 0.3);
        [oL, oR, oC].forEach(o => V.link(vibG, o.detune));
        oL.connect(fL); oR.connect(fR); oC.connect(fL); oC.connect(fR);
        const gL = V.gain(), gR = V.gain(); fL.connect(gL); fR.connect(gR); gL.connect(pL); gR.connect(pR);
        envAttack(gL.gain, t, 0.042 * v, atk); envAttack(gR.gain, t, 0.042 * v, atk);
        V.amps.push(gL.gain, gR.gain);
        return V;
      },
      dispose() { safeStop(vib); safeStop(tl); safeDisconnect(level, hp, dip, trem, pL, pR, vib, vibG, tl, tlG); },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Organ registrations: harmonic weights over a base at f/2 (index n = harmonic n of f/2; 2 = the played pitch).
function organWave(ctx, reg) {
  const s = shared(ctx); s.organ = s.organ || new Map();
  const key = Math.round(clamp(reg, 0, 1) * 20);
  if (!s.organ.has(key)) {
    const r = key / 20, n = 17, real = new Float32Array(n), imag = new Float32Array(n);
    const mellow = { 1: 0.32, 2: 1, 4: 0.28, 8: 0.06 }, bright = { 1: 0.2, 2: 1, 4: 0.62, 6: 0.36, 8: 0.4, 10: 0.1, 12: 0.16, 16: 0.1 };
    for (let h = 1; h < n; h++) imag[h] = (mellow[h] || 0) * (1 - r) + (bright[h] || 0) * r;
    s.organ.set(key, ctx.createPeriodicWave(real, imag));
  }
  return s.organ.get(key);
}
const organ = {
  id: 'organ', name: 'Glass Organ', kind: 'organ', poly: 12,
  macros: ['registration', 'swell', 'celeste', 'air'],
  params: [M('registration', 'Stops (flute to principal)', 0.35), M('swell', 'Swell', 0.5), M('celeste', 'Celeste', 0.5), M('air', 'Pipe air', 0.3),
    REL(2.5, 10), OCT, LEVEL],
  presets: [
    { id: 'cathedral-organ', name: 'Cathedral Organ', params: { registration: 0.6, swell: 0.45, celeste: 0.35, air: 0.25, release: 3 } },
    { id: 'flute-stop', name: 'Flute Stop', params: { registration: 0.05, swell: 0.4, celeste: 0.2, air: 0.45, release: 2 } },
    { id: 'voix-celeste', name: 'Voix Celeste', params: { registration: 0.4, swell: 0.6, celeste: 0.8, air: 0.2, release: 3.5 } },
    { id: 'glass-harmonium', name: 'Glass Harmonium', params: { registration: 0.85, swell: 0.55, celeste: 0.5, air: 0.15, release: 2.5 } },
  ],
  core(ctx, out, Pr) {
    const level = gainNode(ctx, 1), hp = biquad(ctx, 'highpass', 60, 0.6), lp = biquad(ctx, 'lowpass', 7000, 0.5), pan = ctx.createStereoPanner();
    pan.connect(hp); hp.connect(lp); lp.connect(level); level.connect(out);
    const rot = startLfo(ctx, 0.37), rotG = gainNode(ctx, 0); rot.connect(rotG); rotG.connect(pan.pan);
    const live = new Set();
    const update = (p, id, isLive) => {
      const s = setter(isLive); s(ctx, rotG.gain, p.celeste * 0.45); s(ctx, level.gain, dbToGain(p.level));
      if (id === 'registration') { const w = organWave(ctx, p.registration); for (const V of live) V.waveOscs.forEach(o => { try { o.setPeriodicWave(w); } catch { /* ended */ } }); }
    };
    update(Pr, null, false);
    return {
      update,
      voice(midi, vel, t, p) {
        const V = new Voice(ctx), f = mtof(midi + 12 * Math.round(p.octave)), v = velCurve(vel), w = organWave(ctx, p.registration);
        V.releaseTime = p.release;
        const atk = expMap(p.swell, 0.04, 3), g = V.gain(); g.connect(pan);
        const o1 = V.osc(w, f / 2, t), o2 = V.osc(w, f / 2, t, 4 + p.celeste * 12), c2 = V.gain(p.celeste * 0.75);
        o1.connect(g); o2.connect(c2); c2.connect(g); V.waveOscs = [o1, o2];
        envAttack(g.gain, t, 0.05 * v / (1 + p.celeste * 0.5), atk); V.amps.push(g.gain);
        if (p.air > 0.02) {
          const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx); n.loop = true; V.nodes.push(n); V.srcs.push(n); n.start(t, (midi * 0.311) % 3.5);
          const bp = V.node(biquad(ctx, 'bandpass', Math.min(9000, f * 2), 3)), ng = V.gain(); n.connect(bp); bp.connect(ng); ng.connect(pan);
          envAttack(ng.gain, t, 0.07 * v * p.air, atk * 0.5, 0.45, 0.4); V.amps.push(ng.gain);
        }
        live.add(V); V.onDone = x => live.delete(x);
        return V;
      },
      dispose() { safeStop(rot); safeDisconnect(level, hp, lp, pan, rot, rotG); },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------------
const sub = {
  id: 'sub', name: 'Sub Swell', kind: 'drone', poly: 6,
  macros: ['weight', 'drive', 'movement', 'swell'],
  params: [M('weight', 'Weight', 0.35), M('drive', 'Drive', 0.15), M('movement', 'Movement', 0.4), M('swell', 'Swell', 0.6), M('tone', 'Tone', 0.4), REL(4, 12), OCT, LEVEL],
  presets: [
    { id: 'sub-swell', name: 'Sub Swell', params: { weight: 0.35, drive: 0.15, movement: 0.4, swell: 0.6, tone: 0.4, release: 4 } },
    { id: 'deep-bloom', name: 'Deep Bloom', params: { weight: 0.55, drive: 0.25, movement: 0.6, swell: 0.8, tone: 0.5, release: 6 } },
    { id: 'earth-hum', name: 'Earth Hum', params: { weight: 0.7, drive: 0.55, movement: 0.25, swell: 0.4, tone: 0.55, release: 3 } },
    { id: 'soft-floor', name: 'Soft Floor', params: { weight: 0.15, drive: 0, movement: 0.2, swell: 0.7, tone: 0.25, release: 5 } },
  ],
  core(ctx, out, Pr) {
    const input = gainNode(ctx, 1), sh = ctx.createWaveShaper(), lp = biquad(ctx, 'lowpass', 400, 0.6), hp = biquad(ctx, 'highpass', 30, 0.7), level = gainNode(ctx, 1);
    input.connect(sh); sh.connect(lp); lp.connect(hp); hp.connect(level); level.connect(out);
    const l = startLfo(ctx, 0.045), lG = gainNode(ctx, 0); l.connect(lG); lG.connect(lp.detune);
    let curveQ = -1;
    const update = (p, id, live) => {
      const s = setter(live), q = Math.round(p.drive * 10) / 10;
      if (q !== curveQ) { sh.curve = driveCurve(q * 0.6); curveQ = q; }
      s(ctx, lp.frequency, expMap(p.tone, 160, 1400), 0.1); s(ctx, lG.gain, p.movement * 900); s(ctx, level.gain, dbToGain(p.level));
    };
    update(Pr, null, false);
    return {
      update,
      voice(midi, vel, t, p) {
        const V = new Voice(ctx), f = mtof(midi + 12 * Math.round(p.octave)), v = velCurve(vel); V.releaseTime = p.release;
        const g = V.gain(); g.connect(input);
        const o1 = V.osc('sine', f, t), o2 = V.osc('triangle', f, t, 3), o3 = V.osc('sine', f * 2, t, -2), g2 = V.gain(p.weight * 0.5), g3 = V.gain(p.weight * 0.14);
        o1.connect(g); o2.connect(g2); g2.connect(g); o3.connect(g3); g3.connect(g);
        envAttack(g.gain, t, 0.15 * v, expMap(p.swell, 0.1, 6)); V.amps.push(g.gain);
        return V;
      },
      dispose() { safeStop(l); safeDisconnect(input, sh, lp, hp, level, l, lG); },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------------
const AIR_MODELS = ['Wind', 'Breath', 'Glass whistle', 'Ocean air'];
const air = {
  id: 'air', name: 'Sky Air', kind: 'texture', poly: 6,
  macros: ['color', 'movement', 'swell', 'focus'],
  params: [P('model', 'Texture', 0, AIR_MODELS.length - 1, 0, { step: 1, options: AIR_MODELS }),
    M('color', 'Color', 0.5), M('movement', 'Movement', 0.5), M('swell', 'Swell', 0.6), M('focus', 'Focus', 0.3), REL(5, 14), LEVEL],
  presets: [
    { id: 'high-wind', name: 'High Wind', params: { model: 0, color: 0.55, movement: 0.6, swell: 0.6, focus: 0.3, release: 5 } },
    { id: 'sky-breath', name: 'Sky Breath', params: { model: 1, color: 0.45, movement: 0.4, swell: 0.5, focus: 0.1, release: 4 } },
    { id: 'glass-whistle', name: 'Glass Whistle', params: { model: 2, color: 0.5, movement: 0.35, swell: 0.65, focus: 0.5, release: 6 } },
    { id: 'ocean-air', name: 'Ocean Air', params: { model: 3, color: 0.35, movement: 0.7, swell: 0.7, focus: 0.1, release: 7 } },
  ],
  core(ctx, out, Pr) {
    const amp = gainNode(ctx, 1), hp = biquad(ctx, 'highpass', 90, 0.6), level = gainNode(ctx, 1);
    amp.connect(hp); hp.connect(level); level.connect(out);
    const l1 = startLfo(ctx, 0.07), l1G = gainNode(ctx, 0), l2 = startLfo(ctx, 0.093), l2G = gainNode(ctx, 0);
    l1.connect(l1G); l2.connect(l2G); l2G.connect(amp.gain);
    const update = (p, id, live) => {
      const s = setter(live), oceanish = Math.round(p.model) === 3 ? 1 : 0.45;
      s(ctx, l1G.gain, p.movement * 1500); s(ctx, l2G.gain, p.movement * 0.45 * oceanish); s(ctx, amp.gain, 1 - p.movement * 0.45 * oceanish); s(ctx, level.gain, dbToGain(p.level));
    };
    update(Pr, null, false);
    return {
      update,
      voice(midi, vel, t, p) {
        const V = new Voice(ctx), f = mtof(midi), v = velCurve(vel), model = clamp(Math.round(p.model), 0, 3); V.releaseTime = p.release;
        const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx); n.loop = true; V.nodes.push(n); V.srcs.push(n); n.start(t, (midi * 0.173 + t * 0.37) % 3.5);
        const g = V.gain(); g.connect(amp);
        const atk = expMap(p.swell, 0.3, 8);
        const center = expMap(p.color, 250, 5000) * Math.pow(2, (midi - 72) / 24);
        let peak = 0.1 * v;
        if (model === 2) {
          const q = 25 + p.focus * 70;
          [[1, 1], [2, 0.35]].forEach(([r, a]) => {
            const fq = f * r; if (fq > 12000) return;
            const bp = V.node(biquad(ctx, 'bandpass', fq, q)), bg = V.gain(a); n.connect(bp); bp.connect(bg); bg.connect(g); V.link(l1G, bp.detune);
          });
          peak = 0.1 * v * Math.sqrt(q) * 0.9;
          l1G.gain.value; // whistles drift by the same LFO (cents) - kept subtle by the per-voice link below
        } else {
          const f1 = V.node(biquad(ctx, model === 0 ? 'bandpass' : 'lowpass', clamp(center, 120, 12000), model === 0 ? 0.7 + p.focus * 5 : 0.3 + p.focus));
          n.connect(f1); f1.connect(g); V.link(l1G, f1.detune);
          if (model === 0) peak *= 1.3 + p.focus;
          if (model === 3) peak *= 0.9;
        }
        envAttack(g.gain, t, peak, atk); V.amps.push(g.gain);
        return V;
      },
      dispose() { safeStop(l1); safeStop(l2); safeDisconnect(amp, hp, level, l1, l1G, l2, l2G); },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Song Cloud: granular instrument over one of Nico's songs. Midi 60 (C4) = the song's own pitch.
const songCloud = {
  id: 'songCloud', name: 'Song Cloud', kind: 'granular', poly: 6,
  macros: ['position', 'size', 'density', 'spray'],
  params: [P('songId', 'Song', null, null, 'infinite-love', { type: 'song', options: SONG_LIST.map(s => s.title), optionIds: SONG_LIST.map(s => s.id) }),
    M('position', 'Position', 0.12), M('size', 'Grain size', 0.45), M('density', 'Density', 0.5), M('spray', 'Spray', 0.35),
    P('freeze', 'Freeze', 0, 1, 0, { step: 1 }), M('drift', 'Drift', 0.2), M('sparkle', 'Octave sparkle', 0.1), M('tone', 'Tone', 0.55), M('width', 'Width', 0.7),
    P('attack', 'Attack', 0.05, 8, 1.5, { unit: 's' }), REL(4, 14), LEVEL],
  presets: [
    { id: 'song-cloud', name: 'Song Cloud', params: { position: 0.12, size: 0.45, density: 0.5, spray: 0.35, freeze: 0, drift: 0.2, sparkle: 0.1, tone: 0.55, width: 0.7, attack: 1.5, release: 4 } },
    { id: 'frozen-moment', name: 'Frozen Moment', params: { size: 0.68, density: 0.55, spray: 0.12, freeze: 1, drift: 0, sparkle: 0.05, tone: 0.5, width: 0.8, attack: 3, release: 6 } },
    { id: 'glass-dust', name: 'Glass Dust', params: { size: 0.16, density: 0.78, spray: 0.5, freeze: 0, drift: 0.3, sparkle: 0.5, tone: 0.7, width: 1, attack: 1, release: 4 } },
    { id: 'slow-tide', name: 'Slow Tide', params: { size: 0.9, density: 0.25, spray: 0.6, freeze: 0, drift: 0.45, sparkle: 0, tone: 0.4, width: 0.6, attack: 4, release: 8 } },
  ],
  core(ctx, out, Pr, env) {
    const level = gainNode(ctx, 1), lp = biquad(ctx, 'lowpass', 6000, 0.5), hp = biquad(ctx, 'highpass', 110, 0.6);
    lp.connect(hp); hp.connect(level); level.connect(out);
    const PANS = [-0.85, -0.3, 0.3, 0.85], pans = PANS.map(x => panner(ctx, x * 0.7, lp));
    let buffer = null, songId = null;
    const core = { ready: Promise.resolve(), grainEnds: [], clouds: new Set(), rnd: Math.random };
    const loadSong = id => {
      songId = id; buffer = env.songNow(id);
      if (!buffer) core.ready = env.song(id).then(b => { if (songId === id) buffer = b; }).catch(e => console.warn('[sky] song cloud:', e.message));
      else core.ready = Promise.resolve();
    };
    loadSong(Pr.songId);
    const update = (p, id, live) => {
      const s = setter(live);
      if (p.songId !== songId) loadSong(p.songId);
      s(ctx, lp.frequency, expMap(p.tone, 1500, 14000), 0.1); s(ctx, level.gain, dbToGain(p.level));
      pans.forEach((pn, i) => s(ctx, pn.pan, PANS[i] * p.width));
    };
    update(Pr, null, false);
    const envAt = (c, x) => {
      const a = x <= c.start ? 0 : 1 - Math.exp(-(x - c.start) / Math.max(0.01, c.atk / 4));
      if (x <= c.relT) return a;
      const ar = c.relT <= c.start ? 0 : 1 - Math.exp(-(c.relT - c.start) / Math.max(0.01, c.atk / 4));
      return ar * Math.exp(-(x - c.relT) / Math.max(0.01, c.rel / 6));
    };
    core.update = update;
    core.voice = (midi, vel, t, p) => {
      const V = new Voice(ctx);
      const c = { midi, vel: velCurve(vel), start: t, atk: p.attack, rel: p.release, relT: Infinity, next: t, scan: 0, rate: Math.pow(2, (midi - 60) / 12), grains: [], P: p };
      V.cloud = c; core.clouds.add(c);
      V.release = tr => { if (V.released) return; V.released = true; c.relT = Math.max(c.start, tr); V.end = c.relT + c.rel * 1.1 + 1; };
      V.kill = (tk, fade = 0.03) => {
        V.released = true; c.relT = Math.min(c.relT, tk); c.rel = Math.min(c.rel, fade * 2); V.end = Math.min(V.end, tk + 0.1); c.dead = tk;
        for (const gr of c.grains) if (gr.end > tk) { try { gr.g.gain.cancelScheduledValues(tk); gr.g.gain.setTargetAtTime(0, tk, fade / 3); safeStop(gr.src, tk + fade * 3); } catch { /* ended */ } }
      };
      return V;
    };
    core.tick = (until) => {
      const now = ctx.currentTime;
      core.grainEnds = core.grainEnds.filter(e => e > now);
      for (const c of core.clouds) {
        const p = c.P, endT = c.relT === Infinity ? Infinity : c.relT + c.rel * 1.1;
        if (c.dead !== undefined || c.next >= endT) { if (c.next >= endT || c.dead !== undefined) { core.clouds.delete(c); } continue; }
        if (!buffer) { c.next = Math.max(c.next, until); continue; }
        if (c.next < now) c.next = now + 0.005;
        c.grains = c.grains.filter(g => g.end > now);
        const dens = expMap(p.density, 2.5, 38), size = expMap(p.size, 0.04, 0.8), spray = p.spray * 3.5;
        const overlap = Math.max(1, dens * size), base = 0.5 / Math.sqrt(overlap);
        const dur = buffer.duration;
        while (c.next < until && c.next < endT) {
          const t = c.next; c.next += (1 / dens) * (0.6 + 0.8 * core.rnd());
          const amp = base * c.vel * envAt(c, t);
          if (amp < 2e-4) continue;
          if (core.grainEnds.length > 96) continue;
          const up = core.rnd() < p.sparkle * 0.6, rate = c.rate * (up ? 2 : 1), gd = up ? size * 0.7 : size;
          let pos = p.position * dur + c.scan + (core.rnd() * 2 - 1) * spray;
          const need = gd * rate + 0.05;
          pos = ((pos % dur) + dur) % dur; if (pos > dur - need) pos = Math.max(0, dur - need - core.rnd() * 2);
          const src = ctx.createBufferSource(), g = ctx.createGain();
          src.buffer = buffer; src.playbackRate.value = rate; g.gain.value = 0;
          src.connect(g); g.connect(pans[Math.floor(core.rnd() * pans.length)]);
          const curve = new Float32Array(HANN.length), a = amp * (up ? 0.55 : 1);
          for (let i = 0; i < curve.length; i++) curve[i] = HANN[i] * a;
          g.gain.setValueCurveAtTime(curve, t, gd);
          src.start(t, pos); src.stop(t + gd + 0.01);
          src.onended = () => safeDisconnect(src, g);
          const gr = { src, g, end: t + gd + 0.01 }; c.grains.push(gr); core.grainEnds.push(gr.end);
          if (!(p.freeze >= 0.5)) c.scan += (1 / dens) * p.drift * 0.6;
        }
      }
    };
    core.activeGrains = () => core.grainEnds.length;
    core.dispose = () => { for (const c of core.clouds) for (const gr of c.grains) safeStop(gr.src); core.clouds.clear(); safeDisconnect(level, lp, hp, ...pans); };
    return core;
  },
};

export const INSTRUMENT_DEFS = [glassPad, bells, choir, harp, strings, organ, sub, air, songCloud];
export const instrumentDef = id => INSTRUMENT_DEFS.find(d => d.id === id) || null;

export function resolveParams(def, presetId, overrides = {}) {
  const P0 = {};
  for (const p of def.params) P0[p.id] = p.default;
  const pr = def.presets.find(x => x.id === presetId) || def.presets[0];
  Object.assign(P0, pr.params);
  for (const k of Object.keys(overrides || {})) if (k in P0 && overrides[k] !== undefined && overrides[k] !== null) P0[k] = overrides[k];
  return P0;
}

/** One instrument on one track: owns its core (shared nodes) and its voices. */
export class InstrumentInstance {
  constructor(ctx, defId, presetId, overrides, out, env) {
    this.ctx = ctx; this.def = instrumentDef(defId) || glassPad; this.presetId = presetId; this.out = out; this.env = env;
    this.P = resolveParams(this.def, presetId, overrides);
    this.core = this.def.core(ctx, out, this.P, env);
    this.voices = []; // {midi, start, v, live}
  }
  get ready() { return this.core.ready || Promise.resolve(); }
  setAll(presetId, overrides) {
    const next = resolveParams(this.def, presetId, overrides);
    this.presetId = presetId;
    const changed = Object.keys(next).filter(k => next[k] !== this.P[k]);
    if (!changed.length) return;
    Object.assign(this.P, next);
    for (const k of changed) this.core.update(this.P, k, true);
  }
  set(id, value) { if (!(id in this.P)) return false; this.P[id] = value; this.core.update(this.P, id, true); return true; }
  prune(t) { if (this.voices.length > 8) this.voices = this.voices.filter(x => x.v.end > t - 0.1); }
  noteOn(midi, vel, t, dur = null, live = false) {
    this.prune(this.ctx.currentTime);
    const sounding = this.voices.filter(x => x.v.end > t && x.start <= t + 0.001);
    if (!this.def.poly || sounding.length >= this.def.poly) {
      const oldest = sounding.sort((a, b) => a.start - b.start)[0]; if (oldest) oldest.v.kill(t, 0.03);
    }
    if (!this.def.id.match(/bells|harp/)) for (const x of sounding) if (x.midi === midi && !x.v.released) x.v.release(t);
    const v = this.core.voice(midi, vel, t, { ...this.P });
    if (dur != null) v.release(t + Math.max(0.02, dur));
    const rec = { midi, start: t, v, live };
    this.voices.push(rec);
    return rec;
  }
  noteOff(midi, t) { for (const x of this.voices) if (x.live && x.midi === midi && !x.v.released) x.v.release(t); }
  allOff(t, hard = true) { for (const x of this.voices) { if (hard) x.v.kill(t, 0.04); else x.v.release(t); } }
  tick(until) { if (this.core.tick) this.core.tick(until); }
  activeVoices(t) { return this.voices.filter(x => x.v.end > t && x.start <= t).length; }
  activeGrains() { return this.core.activeGrains ? this.core.activeGrains() : 0; }
  dispose() { this.allOff(this.ctx.currentTime, true); this.core.dispose(); }
}

/** Public description (no functions) for engine.instruments. */
export function describeInstruments() {
  return INSTRUMENT_DEFS.map(d => ({
    id: d.id, name: d.name, kind: d.kind, poly: d.poly,
    presets: d.presets.map(p => ({ id: p.id, name: p.name, params: { ...p.params } })),
    macros: d.macros.map(id => ({ ...d.params.find(p => p.id === id) })),
    params: d.params.map(p => ({ ...p })),
  }));
}
