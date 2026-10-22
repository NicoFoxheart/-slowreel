// instruments.js - the tape studio's synthesized instruments (Web Audio only, no samples).
// Each instrument: {id, name, kind, maxVoices, params:[...], macros:[ids], presets:[{id, name, params}], voice(ctx, env, P, midi, vel, t)}
// A voice: {out, release(t), stop(t), endTime, tick?(until)}. The engine owns scheduling, polyphony and cleanup.
import { clamp, mtof, rng, wave, noiseBuffer, satCurve, hannCurve, disconnectAll, krate, krateFilter, release as relParam } from './util.js?v=9e';
import { SONGS, songBuffer, songGain } from './songs.js?v=9e';
import { nightBufferIfReady } from './nightrain.js?v=9e';
import { ensureNight } from './assets.js?v=9e';
import { ASIAN } from './asian.js?v=9e';
import { SYNTHS } from './synths.js?v=9e';
import { DRUM_INSTRUMENTS, DRUMS, DRUM_MAP } from './drums.js?v=9e';
import { SAMPLER } from './sampler.js?v=9e';
import { VOCALS } from './vocals.js?v=9e';

const P = (id, name, min, max, def, extra = {}) => ({ id, name, min, max, default: def, unit: '', ...extra });
const ENUM = (id, name, options, def) => ({ id, name, min: 0, max: options.length - 1, default: def, unit: '', type: 'enum', options });
const keyScale = (midi, per = 24) => Math.pow(2, (60 - midi) / per);   // low notes ring longer
const R = rng(4242);   // deterministic "randomness" (same render every time)
const rand = (a = 0, b = 1) => a + (b - a) * R();

// ---------------------------------------------------------------- voice plumbing
class Voice {
  constructor(ctx, env, t) {
    this.ctx = ctx; this.env = env; this.t0 = t; this.out = ctx.createGain(); this.out.gain.value = 1;
    this.srcs = []; this.nodes = [this.out]; this.amps = []; this.rel = 0.5; this.endTime = Infinity; this.released = false;
  }
  node(n) { this.nodes.push(n); return n; }
  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return this.node(g); }
  filter(type, f, q = 0.7) { const b = krateFilter(this.ctx.createBiquadFilter()); b.type = type; b.frequency.value = clamp(f, 10, 20000); b.Q.value = q; return this.node(b); }
  osc(type, freq, t) {
    const o = this.ctx.createOscillator(); krate(o.frequency, o.detune);
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.value = freq; o.start(t); this.srcs.push(o); return this.node(o);
  }
  noise(kind, t) {
    const s = this.ctx.createBufferSource(); s.buffer = noiseBuffer(this.ctx, kind); s.loop = true;
    s.start(t, rand(0, 5)); this.srcs.push(s); return this.node(s);
  }
  // slow per-voice tape wobble on every pitched oscillator
  wobble(oscs, cents, t, rate = rand(0.25, 0.7)) {
    if (cents <= 0.01 || this.env.light) return;   // Light mode: no per-voice wobble oscillator
    const l = this.osc('sine', rate, t), g = this.gain(cents);
    l.connect(g); oscs.forEach(o => g.connect(o.detune));
  }
  // release: every registered amp envelope falls to silence, then sources stop and nodes are freed
  release(t, r = this.rel) {
    if (this.released) return; this.released = true;
    t = Math.max(t, this.ctx.currentTime);
    for (const a of this.amps) relParam(a, t, r);
    this.stop(t + r * 1.7 + 0.05);
  }
  stop(t) {
    t = Math.max(t, this.ctx.currentTime);
    if (t >= this.endTime) return;
    this.endTime = t;
    for (const s of this.srcs) { try { s.stop(t); } catch (e) { } }
    const last = this.srcs[0];
    if (last) last.onended = () => { if (this.dead) return; disconnectAll(...this.nodes); this.dead = true; this.env.voiceEnded?.(this); };
    else this.dead = true;
  }
  kill(t) { for (const a of this.amps) relParam(a, t, 0.04); this.released = true; this.stop(t + 0.08); }
  // A source whose envelope has already faded to silence (below -100 dB) by `until`: it stops there instead of running
  // (with its filters) for the whole note. Same sound, less work for the audio thread.
  // A stereo noise source used to keep the voice stereo for its whole life; once it stops early the voice would fall
  // back to mono, and the track's panner treats mono differently (-3 dB at centre). stereo() pins the voice output to
  // stereo so the sound stays exactly as before.
  stereo() { this.out.channelCount = 2; this.out.channelCountMode = 'explicit'; this.out.channelInterpretation = 'speakers'; }
  transient(src, until) {
    const i = this.srcs.indexOf(src);
    if (i > 0) { this.srcs.splice(i, 1); try { src.stop(until); } catch (e) { } }
  }
}
const vel2amp = v => Math.pow(clamp(v, 0, 1), 1.4);

// ---------------------------------------------------------------- 1. Felt piano
const felt = {
  id: 'felt', name: 'Felt Piano', kind: 'synth', maxVoices: 14,
  params: [P('felt', 'Felt', 0, 1, 0.65), P('sustain', 'Sustain', 0, 1, 0.55), P('hammer', 'Hammer', 0, 1, 0.4), P('wobble', 'Wobble', 0, 1, 0.25),
    P('toy', 'Toy tines', 0, 1, 0), P('detune', 'Detune', 0, 1, 0.5), P('level', 'Level', 0, 1.5, 1)],
  macros: ['felt', 'sustain', 'hammer', 'wobble'],
  presets: [
    { id: 'felt-upright', name: 'Felt Upright', params: {} },
    { id: 'toy-piano', name: 'Toy Piano', params: { felt: 0.2, sustain: 0.3, hammer: 0.25, wobble: 0.35, toy: 0.85, detune: 0.3, level: 0.8 } },
    { id: 'muted-keys', name: 'Muted Keys', params: { felt: 0.95, sustain: 0.2, hammer: 0.6, wobble: 0.15, detune: 0.4, level: 1.2 } },
    { id: 'worn-upright', name: 'Worn Upright', params: { felt: 0.45, sustain: 0.75, hammer: 0.35, wobble: 0.7, detune: 1 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), ks = keyScale(midi), a = vel2amp(vel);
    const w = wave(ctx, 'piano', [1, 0.55, 0.3, 0.18, 0.1, 0.07, 0.045, 0.03, 0.02, 0.012]);
    const A = v.osc(w, f, t), B = v.osc(w, f, t); B.detune.value = 2 + p.detune * 5;
    // filter: hammer brightness that settles into felt darkness (created at its first value: k-rate reads the block start)
    const top = clamp(f * (1.8 + (1 - p.felt) * 9 * (0.4 + vel)), 300, 9000), rest = clamp(f * (1.1 + (1 - p.felt) * 2.2), 200, 5000);
    const lp = v.filter('lowpass', top, 0.6), amp = v.gain(0); v.amps.push(amp.gain);
    const mixB = v.gain(0.45); A.connect(lp); B.connect(mixB); mixB.connect(lp); lp.connect(amp); amp.connect(v.out);
    lp.frequency.setValueAtTime(top, t); lp.frequency.setTargetAtTime(rest, t + 0.01, 0.12 + p.felt * 0.25);
    const pk = a * 0.32 * p.level, at = 0.003 + p.felt * 0.008, sus = (0.7 + p.sustain * 6) * ks;
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(pk, t + at);
    amp.gain.setTargetAtTime(pk * 0.55, t + at, 0.09); amp.gain.setTargetAtTime(0, t + at + 0.25, sus / 2.2);
    // toy tines: bright, slightly inharmonic partials that die fast
    if (p.toy > 0.01) {
      const C = v.osc('sine', f * 4.03, t), D = v.osc('sine', f * 2.005, t), tg = v.gain(0);
      C.connect(tg); D.connect(tg); tg.connect(amp);
      tg.gain.setValueAtTime(p.toy * 0.55, t); tg.gain.setTargetAtTime(0, t + 0.004, 0.12 + p.sustain * 0.25);
      v.wobble([C, D], p.wobble * 9, t);
      const tEnd = t + 0.004 + (0.12 + p.sustain * 0.25) * 12; v.transient(C, tEnd); v.transient(D, tEnd);
    }
    // felt hammer: soft band-passed thump
    if (p.hammer > 0.01) {
      const n = v.noise('white', t), bp = v.filter('bandpass', clamp(f * 1.5, 250, 2600), 1.1), hg = v.gain(0);
      n.connect(bp); bp.connect(hg); hg.connect(v.out);
      hg.gain.setValueAtTime(0, t); hg.gain.linearRampToValueAtTime(p.hammer * a * 0.22 * p.level, t + 0.002); hg.gain.setTargetAtTime(0, t + 0.002, 0.012);
      v.amps.push(hg.gain);
      v.stereo(); v.transient(n, t + 0.002 + 0.012 * 12);
    }
    v.wobble([A, B], p.wobble * 9, t);
    v.rel = 0.22 + p.felt * 0.25 + (p.sustain > 0.85 ? 1.5 : 0);
    v.stop(t + at + 0.25 + sus * 3.2);     // natural end even if no note-off comes
    return v;
  },
};

// ---------------------------------------------------------------- 2. Music box / kalimba / celesta
const musicbox = {
  id: 'musicbox', name: 'Music Box', kind: 'synth', maxVoices: 16,
  params: [P('shine', 'Shine', 0, 1, 0.5), P('ring', 'Ring', 0, 1, 0.55), P('mechanism', 'Mechanism', 0, 1, 0.35), P('wobble', 'Wobble', 0, 1, 0.3),
    P('ratio2', 'Partial 2', 1, 8, 2), P('ratio3', 'Partial 3', 2, 16, 5.95), P('thump', 'Thump', 0, 1, 0), P('level', 'Level', 0, 1.5, 1)],
  macros: ['shine', 'ring', 'mechanism', 'wobble'],
  presets: [
    { id: 'music-box', name: 'Music Box', params: {} },
    { id: 'kalimba', name: 'Kalimba', params: { shine: 0.35, ring: 0.35, mechanism: 0.15, wobble: 0.15, ratio2: 5.9, ratio3: 12.7, thump: 0.6, level: 1.1 } },
    { id: 'celesta-dust', name: 'Celesta Dust', params: { shine: 0.65, ring: 0.7, mechanism: 0.1, wobble: 0.2, ratio2: 2, ratio3: 3.01, level: 0.9 } },
    { id: 'tin-glock', name: 'Tin Glock', params: { shine: 0.75, ring: 0.5, mechanism: 0.3, wobble: 0.25, ratio2: 2.76, ratio3: 5.4, level: 0.8 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), a = vel2amp(vel), ks = keyScale(midi, 18);
    const f = mtof(midi) * Math.pow(2, rand(-1, 1) * p.mechanism * 8 / 1200);  // imperfect comb tuning
    const amp = v.gain(0); v.amps.push(amp.gain); amp.connect(v.out);
    const ring = (0.35 + p.ring * 2.4) * ks;
    const parts = [[1, 1, 1], [p.ratio2, 0.22 + p.shine * 0.15, 0.6], [p.ratio3, p.shine * 0.32, 0.22]];
    const oscs = [];
    for (const [r, lv, dk] of parts) {
      if (f * r > 16000 || lv < 0.005) continue;
      const o = v.osc('sine', f * r, t), g = v.gain(0); o.connect(g); g.connect(amp); oscs.push(o);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lv, t + 0.002); g.gain.setTargetAtTime(0, t + 0.002, ring * dk / 3);
      if (dk < 1) v.transient(o, t + 0.002 + ring * dk / 3 * 12);
    }
    amp.gain.setValueAtTime(a * 0.3 * p.level, t);
    if (p.mechanism > 0.02) {   // the pin plucking the comb
      const n = v.noise('white', t), hp = v.filter('highpass', 3500, 0.7), cg = v.gain(0);
      n.connect(hp); hp.connect(cg); cg.connect(v.out);
      cg.gain.setValueAtTime(p.mechanism * a * 0.06 * p.level, t); cg.gain.setTargetAtTime(0, t + 0.001, 0.003);
      v.stereo(); v.transient(n, t + 0.001 + 0.003 * 12);
    }
    if (p.thump > 0.02) {       // kalimba body
      const n = v.noise('pink', t), bp = v.filter('bandpass', clamp(f * 0.5, 120, 600), 2.5), cg = v.gain(0);
      n.connect(bp); bp.connect(cg); cg.connect(v.out);
      cg.gain.setValueAtTime(p.thump * a * 0.5 * p.level, t); cg.gain.setTargetAtTime(0, t + 0.002, 0.018);
      v.stereo(); v.transient(n, t + 0.002 + 0.018 * 12);
    }
    v.wobble(oscs, p.wobble * 7, t, rand(0.3, 0.9));
    v.rel = 0.4 + p.ring * 1.6;   // music boxes ring past the note-off
    v.stop(t + ring * 2.6 + 0.1);
    return v;
  },
};

// ---------------------------------------------------------------- 3. Bowed strings
const strings = {
  id: 'strings', name: 'Bowed Strings', kind: 'synth', maxVoices: 10,
  params: [P('bow', 'Bow', 0, 1, 0.4), P('bright', 'Bright', 0, 1, 0.4), P('vibrato', 'Vibrato', 0, 1, 0.2), P('ensemble', 'Ensemble', 0, 1, 0.75),
    P('solo', 'Solo', 0, 1, 0, { type: 'toggle' }), P('glass', 'Glass', 0, 1, 0, { type: 'toggle' }), P('level', 'Level', 0, 1.5, 1)],
  macros: ['bow', 'bright', 'vibrato', 'ensemble'],
  presets: [
    { id: 'cassette-strings', name: 'Cassette Strings', params: {} },
    { id: 'solo-cello', name: 'Solo Cello', params: { bow: 0.35, bright: 0.45, vibrato: 0.55, ensemble: 0.1, solo: 1, level: 1.15 } },
    { id: 'slow-section', name: 'Slow Section', params: { bow: 0.9, bright: 0.25, vibrato: 0.15, ensemble: 0.6 } },
    { id: 'glass-bow', name: 'Glass Bow', params: { bow: 0.75, bright: 0.3, vibrato: 0.1, ensemble: 0.3, glass: 1, level: 1.1 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel);
    const n = p.solo >= 0.5 ? 1 : 3, spread = 3 + p.ensemble * 13;
    const oscs = [];
    const lp = v.filter('lowpass', 400, 0.6), shelf = v.filter('highshelf', 3200, 0.7); shelf.gain.value = -9;
    const body = v.filter('peaking', 420, 1.2); body.gain.value = p.solo >= 0.5 ? 4 : 2;
    const amp = v.gain(0); v.amps.push(amp.gain);
    for (let i = 0; i < n; i++) {
      const o = v.osc(p.glass >= 0.5 ? 'triangle' : 'sawtooth', f, t);
      o.detune.value = n === 1 ? 0 : (i - 1) * spread + rand(-2, 2);
      const g = v.gain(1 / Math.sqrt(n)); o.connect(g); g.connect(lp); oscs.push(o);
    }
    if (p.glass >= 0.5) { const s = v.osc('sine', f * 2, t), g = v.gain(0.35); s.connect(g); g.connect(lp); oscs.push(s); }
    lp.connect(body); body.connect(shelf); shelf.connect(amp); amp.connect(v.out);
    const at = 0.06 + p.bow * p.bow * 2.6, cut = clamp(f * (1.6 + p.bright * 6) + 250, 300, 8000);
    lp.frequency.value = cut * 0.45; lp.frequency.setValueAtTime(cut * 0.45, t); lp.frequency.setTargetAtTime(cut, t, at * 0.6 + 0.02);
    const pk = a * 0.14 * p.level;
    amp.gain.setValueAtTime(0, t); amp.gain.setTargetAtTime(pk, t, at / 2.2 + 0.005);
    // vibrato that arrives after the bow settles
    if (p.vibrato > 0.01) {
      const l = v.osc('sine', rand(4.6, 5.6), t), lg = v.gain(0); l.connect(lg); oscs.forEach(o => lg.connect(o.detune));
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(p.vibrato * 16, t + 0.4 + at);
    }
    // bow hair noise
    const nz = v.noise('white', t), bp = v.filter('bandpass', clamp(f * 3, 600, 6000), 1.8), ng = v.gain(0);
    nz.connect(bp); bp.connect(ng); ng.connect(amp);
    ng.gain.value = (0.06 + p.bright * 0.12) * (p.glass >= 0.5 ? 0.3 : 1);
    v.wobble(oscs, 3, t);
    v.rel = 0.35 + p.bow * 1.8;
    return v;
  },
};

// ---------------------------------------------------------------- 4. Tape pad (mellotron-style choir / flute / pad)
const VOICES = [{ value: 'choir', label: 'Choir' }, { value: 'flute', label: 'Flute' }, { value: 'pad', label: 'Pad' }];
const tapepad = {
  id: 'tapepad', name: 'Tape Pad', kind: 'synth', maxVoices: 10,
  params: [P('warmth', 'Warmth', 0, 1, 0.5), P('air', 'Air', 0, 1, 0.3), P('swell', 'Swell', 0, 1, 0.5), P('wobble', 'Wobble', 0, 1, 0.4),
    ENUM('voice', 'Voice', VOICES, 'choir'), P('level', 'Level', 0, 1.5, 1)],
  macros: ['warmth', 'air', 'swell', 'wobble'],
  presets: [
    { id: 'tape-choir', name: 'Tape Choir', params: {} },
    { id: 'tron-flute', name: 'Tron Flute', params: { voice: 'flute', warmth: 0.45, air: 0.45, swell: 0.3, wobble: 0.45, level: 1.1 } },
    { id: 'warm-pad', name: 'Warm Pad', params: { voice: 'pad', warmth: 0.6, air: 0.15, swell: 0.65, wobble: 0.3 } },
    { id: 'dusty-choir', name: 'Dusty Choir', params: { voice: 'choir', warmth: 0.8, air: 0.25, swell: 0.75, wobble: 0.75 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel);
    const amp = v.gain(0); v.amps.push(amp.gain);
    const warmLp = v.filter('lowpass', clamp(6500 * Math.pow(0.18, p.warmth), 700, 9000), 0.5);
    warmLp.connect(amp); amp.connect(v.out);
    const oscs = [];
    if (p.voice === 'flute') {
      const tri = v.osc('triangle', f, t), s = v.osc('sine', f * 2, t), g2 = v.gain(0.18);
      tri.connect(warmLp); s.connect(g2); g2.connect(warmLp); oscs.push(tri, s);
    } else if (p.voice === 'pad') {
      const s1 = v.osc('sawtooth', f, t), s2 = v.osc('triangle', f, t), lp = v.filter('lowpass', clamp(f * 3, 400, 4000), 0.7);
      s1.detune.value = -6; s2.detune.value = 7; const g1 = v.gain(0.5);
      s1.connect(g1); g1.connect(lp); s2.connect(lp); lp.connect(warmLp); oscs.push(s1, s2);
    } else {   // choir: two saws through fixed "oo-ah" formants
      const s1 = v.osc('sawtooth', f, t), s2 = v.osc('sawtooth', f, t); s1.detune.value = -7; s2.detune.value = 7;
      const sum = v.gain(0.5); s1.connect(sum); s2.connect(sum); oscs.push(s1, s2);
      for (const [fq, q, lv] of [[460, 3.2, 0.75], [880, 4, 0.55], [2700, 6, 0.28]]) {
        const bp = v.filter('bandpass', fq, q), g = v.gain(lv * 2.2); sum.connect(bp); bp.connect(g); g.connect(warmLp);
      }
    }
    if (p.air > 0.01) {    // breath
      const n = v.noise('pink', t), bp = v.filter('bandpass', clamp(f * 2.5, 800, 5000), 0.9), g = v.gain(p.air * 0.2);
      n.connect(bp); bp.connect(g); g.connect(warmLp);
    }
    const at = 0.12 + p.swell * 2.4, pk = a * 0.16 * p.level;
    amp.gain.setValueAtTime(0, t); amp.gain.setTargetAtTime(pk, t, at / 2.5);
    v.wobble(oscs, 4 + p.wobble * 22, t, rand(0.3, 0.55));
    v.rel = 0.5 + p.swell * 3;
    return v;
  },
};

// ---------------------------------------------------------------- 5. Drone / sub / reed organ
const drone = {
  id: 'drone', name: 'Drone', kind: 'synth', maxVoices: 6,
  params: [P('body', 'Body', 0, 1, 0.7), P('reed', 'Reed', 0, 1, 0.2), P('motion', 'Motion', 0, 1, 0.35), P('grit', 'Grit', 0, 1, 0.15), P('level', 'Level', 0, 1.5, 1)],
  macros: ['body', 'reed', 'motion', 'grit'],
  presets: [
    { id: 'warm-sub', name: 'Warm Sub', params: {} },
    { id: 'reed-organ', name: 'Reed Organ', params: { body: 0.3, reed: 0.75, motion: 0.3, grit: 0.25, level: 0.9 } },
    { id: 'low-hum', name: 'Low Hum', params: { body: 0.55, reed: 0.4, motion: 0.75, grit: 0.45 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel);
    const amp = v.gain(0); v.amps.push(amp.gain);
    const hp = v.filter('highpass', 32, 0.7);
    const sine = v.osc('sine', f, t), sg = v.gain(p.body * 0.9); sine.connect(sg); sg.connect(hp);
    const tri = v.osc('triangle', f * 2, t), tg = v.gain(0.12 + p.body * 0.1); tri.connect(tg); tg.connect(hp);
    const r1 = v.osc('sawtooth', f, t), r2 = v.osc('sawtooth', f * 2, t); r2.detune.value = 4;
    const rg = v.gain(p.reed * 0.55), lp = v.filter('lowpass', 250 + p.reed * 1300, 0.9);
    r1.connect(rg); const r2g = v.gain(0.4); r2.connect(r2g); r2g.connect(rg); rg.connect(lp);
    const sh = v.node(ctx.createWaveShaper()); sh.curve = satCurve(ctx, 1 + p.grit * 3); lp.connect(sh); sh.connect(hp);
    // motion: slow filter breathing + bellows tremolo
    const l = v.osc('sine', rand(0.06, 0.14), t), lg = v.gain(p.motion * 900); l.connect(lg); lg.connect(lp.detune);
    const trem = v.osc('sine', rand(0.18, 0.3), t), tgn = v.gain(p.motion * 0.18); trem.connect(tgn);
    const tremAmp = v.gain(1); tgn.connect(tremAmp.gain);
    hp.connect(tremAmp); tremAmp.connect(amp); amp.connect(v.out);
    const at = 1.4, pk = a * 0.2 * p.level;
    amp.gain.setValueAtTime(0, t); amp.gain.setTargetAtTime(pk, t, at / 2.5);
    v.wobble([sine, tri, r1, r2], 3, t);
    v.rel = 2.2;
    return v;
  },
};

// ---------------------------------------------------------------- 6. Pluck (nylon / koto / harp)
const WAVES = [{ value: 'nylon', label: 'Nylon' }, { value: 'koto', label: 'Koto' }, { value: 'harp', label: 'Harp' }];
const pluck = {
  id: 'pluck', name: 'Pluck', kind: 'synth', maxVoices: 12,
  params: [P('bright', 'Pluck', 0, 1, 0.45), P('decay', 'Decay', 0, 1, 0.5), P('body', 'Body', 0, 1, 0.35), P('bend', 'Bend', 0, 1, 0.1),
    ENUM('wave', 'String', WAVES, 'nylon'), P('level', 'Level', 0, 1.5, 1)],
  macros: ['bright', 'decay', 'body', 'bend'],
  presets: [
    { id: 'nylon', name: 'Nylon', params: {} },
    { id: 'koto', name: 'Koto', params: { wave: 'koto', bright: 0.6, decay: 0.45, body: 0.5, bend: 0.5, level: 0.9 } },
    { id: 'cassette-harp', name: 'Cassette Harp', params: { wave: 'harp', bright: 0.35, decay: 0.8, body: 0.2, bend: 0 } },
    { id: 'toy-pluck', name: 'Toy Pluck', params: { wave: 'nylon', bright: 0.75, decay: 0.2, body: 0.6, bend: 0.2, level: 0.85 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel), ks = keyScale(midi, 20);
    const w = p.wave === 'koto' ? wave(ctx, 'koto', [1, 0.15, 0.5, 0.1, 0.32, 0.08, 0.2, 0.05, 0.12])
      : p.wave === 'harp' ? 'triangle' : wave(ctx, 'nylon', [1, 0.45, 0.28, 0.2, 0.12, 0.09, 0.06, 0.04]);
    const o = v.osc(w, f, t), lp = v.filter('lowpass', f * 8, 0.7 + p.body * 5), amp = v.gain(0); v.amps.push(amp.gain);
    o.connect(lp); lp.connect(amp); amp.connect(v.out);
    if (p.bend > 0.01) { o.detune.value = p.bend * 45; o.detune.setValueAtTime(p.bend * 45, t); o.detune.setTargetAtTime(0, t + 0.005, 0.05); }
    const top = clamp(f * (2 + p.bright * 14 * (0.5 + vel)), 300, 10000);
    lp.frequency.value = top; lp.frequency.setValueAtTime(top, t); lp.frequency.setTargetAtTime(clamp(f * 1.4, 150, 4000), t + 0.003, 0.05 + p.decay * 0.25);
    const dec = (0.2 + p.decay * 1.8) * ks, pk = a * 0.3 * p.level;
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(pk, t + 0.002); amp.gain.setTargetAtTime(0, t + 0.002, dec / 2.5);
    v.wobble([o], 4, t);
    v.rel = 0.25 + p.decay * 0.4;
    v.stop(t + dec * 2.5 + 0.1);
    return v;
  },
};

// ---------------------------------------------------------------- 7. Noise textures
const KINDS = [{ value: 'nightrain', label: 'Night rain' }, { value: 'hiss', label: 'Cassette hiss' }, { value: 'crackle', label: 'Vinyl crackle' }, { value: 'wind', label: 'Wind' },
  { value: 'ocean', label: 'Ocean' }, { value: 'room', label: 'Room tone' }];
const texture = {
  id: 'texture', name: 'Textures', kind: 'texture', maxVoices: 4,
  params: [P('tone', 'Tone', 0, 1, 0.5), P('motion', 'Motion', 0, 1, 0.5), P('density', 'Density', 0, 1, 0.5),
    ENUM('noise', 'Source', KINDS, 'hiss'), P('level', 'Level', 0, 1.5, 1)],
  macros: ['tone', 'motion', 'density'],
  presets: [
    { id: 'night-rain', name: 'Night Rain', params: { noise: 'nightrain', tone: 0.45, motion: 0.4, density: 0.45 } },
    { id: 'rain-on-glass', name: 'Rain on Glass', params: { noise: 'nightrain', tone: 0.6, motion: 0.3, density: 0.1 } },
    { id: 'cassette-hiss', name: 'Cassette Hiss', params: { noise: 'hiss' } },
    { id: 'vinyl-crackle', name: 'Vinyl Crackle', params: { noise: 'crackle', tone: 0.55, motion: 0.3, density: 0.55 } },
    { id: 'wind', name: 'Wind', params: { noise: 'wind', tone: 0.45, motion: 0.6, density: 0.5 } },
    { id: 'ocean', name: 'Ocean', params: { noise: 'ocean', tone: 0.4, motion: 0.65, density: 0.5 } },
    { id: 'room-tone', name: 'Room Tone', params: { noise: 'room', tone: 0.35, motion: 0.3, density: 0.5 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), a = vel2amp(vel), pf = Math.pow(2, (midi - 60) / 24);
    const amp = v.gain(0); v.amps.push(amp.gain);
    const mod = v.gain(1); mod.connect(amp); amp.connect(v.out);
    const lfo = (rate, depth, param) => { const l = v.osc('sine', rate, t), g = v.gain(depth); l.connect(g); g.connect(param); };
    let lvl = 0.05;
    if (p.noise === 'nightrain') {
      // rain on the window (tone = how much glass you hear through) + the city far away (density = how much city)
      // The loops are made ahead of time (engine.load); if a preset switches to night rain mid-play they are made in the
      // background and the rain starts when they are ready, instead of stalling the page.
      const ready = nightBufferIfReady(ctx, 'glass') && nightBufferIfReady(ctx, 'city');
      if (!ready) { const keep = ctx.createConstantSource(); keep.offset.value = 0; keep.start(t); v.srcs.push(keep); v.node(keep); }
      const play = (kind, off, into) => {
        const go = (at) => { const s = ctx.createBufferSource(); s.buffer = nightBufferIfReady(ctx, kind); s.loop = true; s.playbackRate.value = Math.pow(pf, 0.25);
          s.connect(into); s.start(at, off); v.srcs.push(s); v.node(s); if (v.endTime < Infinity) s.stop(Math.max(at, v.endTime)); };
        if (ready) go(t);
        else Promise.all([ensureNight(ctx.sampleRate, 'glass'), ensureNight(ctx.sampleRate, 'city')]).then(() => { const at = Math.max(t, ctx.currentTime + 0.02); if (!v.dead && at < v.endTime) go(at); }, () => { });
      };
      const rl = v.filter('lowpass', 1800 * Math.pow(4, p.tone), 0.5), rg = v.gain(1);
      play('glass', rand(0, 11), rl); rl.connect(rg); rg.connect(mod);
      const cg = v.gain(p.density * 1.3); play('city', rand(0, 11), cg); cg.connect(mod);
      lfo(0.045, 0.3 * p.motion, rg.gain); lfo(0.031, 0.25 * p.motion, cg.gain); lvl = 0.9;
    } else if (p.noise === 'crackle') {
      const c = v.noise('crackle', t), hp = v.filter('highpass', 600 + p.tone * 1500, 0.6), lp = v.filter('lowpass', 5000 + p.tone * 6000, 0.5);
      const cg = v.gain(0.3 + p.density * 1.0); c.connect(hp); hp.connect(lp); lp.connect(cg); cg.connect(mod);
      const bed = v.noise('pink', t), bl = v.filter('bandpass', 1800, 0.5), bg = v.gain(0.04); bed.connect(bl); bl.connect(bg); bg.connect(mod);
      c.playbackRate.value = 0.6 + p.density * 0.9; lvl = 0.3;
    } else if (p.noise === 'wind') {
      const n = v.noise('white', t), bp = v.filter('bandpass', (350 + p.tone * 1500) * pf, 3 + p.density * 5), bp2 = v.filter('bandpass', (900 + p.tone * 2500) * pf, 6);
      const g2 = v.gain(0.4); n.connect(bp); n.connect(bp2); bp2.connect(g2); bp.connect(mod); g2.connect(mod);
      lfo(0.07, 900 * p.motion, bp.detune); lfo(0.11, 700 * p.motion, bp2.detune); lfo(0.05, 0.45 * p.motion, mod.gain); lvl = 0.26;
    } else if (p.noise === 'ocean') {
      const n = v.noise('pink', t), lp = v.filter('lowpass', (350 + p.tone * 1600) * pf, 0.6), hp = v.filter('highpass', 90, 0.6);
      n.connect(lp); lp.connect(hp); hp.connect(mod); lfo(0.075, 0.6 * p.motion, mod.gain); lfo(0.075, 700 * p.motion, lp.detune); lvl = 0.11;
    } else if (p.noise === 'room') {
      const n = v.noise('brown', t), lp = v.filter('lowpass', (200 + p.tone * 700) * pf, 0.7), hp = v.filter('highpass', 50, 0.7);
      n.connect(lp); lp.connect(hp); hp.connect(mod); lfo(0.09, 0.2 * p.motion, mod.gain);
      const hum = v.osc('sine', 50 * 2, t), hg = v.gain(0.004 * p.density); hum.connect(hg); hg.connect(mod); lvl = 0.12;
    } else {   // cassette hiss
      const n = v.noise('pink', t), bp = v.filter('bandpass', (2200 + p.tone * 5000) * pf, 0.35), sh = v.filter('highshelf', 8000, 0.7); sh.gain.value = -6;
      n.connect(bp); bp.connect(sh); sh.connect(mod); lfo(0.13, 0.12 * p.motion, mod.gain); lvl = 0.05 + p.density * 0.04;
    }
    amp.gain.setValueAtTime(0, t); amp.gain.setTargetAtTime(a * lvl * p.level, t, 0.6);
    v.rel = 4.5;   // weather fades away slowly
    return v;
  },
};

// ---------------------------------------------------------------- 8. Song cloud (granular, Nico's songs)
const SONG_OPTS = SONGS.map(s => ({ value: s.id, label: s.title }));
const cloud = {
  id: 'cloud', name: 'Song Cloud', kind: 'granular', maxVoices: 6, rootMidi: 60,
  params: [ENUM('song', 'Song', SONG_OPTS, 'hopeful-romantic'), P('position', 'Position', 0, 1, 0.3), P('size', 'Grain', 0.03, 0.9, 0.32, { unit: 's' }),
    P('density', 'Density', 2, 40, 10, { unit: '/s' }), P('spray', 'Spray', 0, 1, 0.3), P('freeze', 'Freeze', 0, 1, 0, { type: 'toggle' }),
    P('scan', 'Scan', 0, 1, 0.15), P('pitchSpread', 'Pitch spread', 0, 1, 0.1), P('tone', 'Tone', 0, 1, 0.55), P('width', 'Width', 0, 1, 0.7),
    P('attack', 'Attack', 0.01, 6, 0.8, { unit: 's' }), P('level', 'Level', 0, 1.5, 1)],
  macros: ['position', 'size', 'density', 'spray'],
  presets: [
    { id: 'soft-cloud', name: 'Soft Cloud', params: {} },
    { id: 'frozen-tape', name: 'Frozen Tape', params: { freeze: 1, size: 0.5, density: 14, spray: 0.08, tone: 0.45, attack: 1.5 } },
    { id: 'dust-grains', name: 'Dust Grains', params: { size: 0.07, density: 26, spray: 0.6, tone: 0.7, pitchSpread: 0.25, attack: 0.2, level: 0.9 } },
    { id: 'slow-bloom', name: 'Slow Bloom', params: { size: 0.7, density: 6, spray: 0.2, scan: 0.05, tone: 0.4, attack: 3.5 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), a = vel2amp(vel);
    const amp = v.gain(0); v.amps.push(amp.gain);
    const lp = v.filter('lowpass', 900 * Math.pow(18, p.tone), 0.5), hp = v.filter('highpass', 70, 0.6);
    const L = v.node(ctx.createStereoPanner()), Rr = v.node(ctx.createStereoPanner());
    L.pan.value = -p.width; Rr.pan.value = p.width; L.connect(hp); Rr.connect(hp); hp.connect(lp); lp.connect(amp); amp.connect(v.out);
    // keeps the voice alive (and gives Voice.stop an onended hook) without making sound
    const keep = ctx.createConstantSource(); keep.offset.value = 0; keep.start(t); v.srcs.push(keep); v.node(keep);
    amp.gain.setValueAtTime(0, t); const rate0 = Math.pow(2, (midi - 60) / 12), win = hannCurve(ctx);
    const dens = p.density * (env.light ? 0.5 : 1);   // Light mode: half the grains (level kept by the overlap rule below)
    const overlap = Math.max(1, dens * p.size), gAmp = 1 / Math.sqrt(overlap);
    // overlapping grains add up, so the voice level is scaled by 1/sqrt(overlap)
    amp.gain.setTargetAtTime(a * 0.5 * p.level * gAmp * songGain(p.song), t, p.attack / 3);   // songs are level-matched
    let next = t, side = 0, grains = 0;
    v.rel = 1.4 + p.size;
    v.tick = (until) => {
      const buf = songBuffer(p.song);
      if (!buf) { next = Math.max(next, until); return; }
      const end = Math.min(until, v.endTime - 0.02);
      while (next < end) {
        const age = next - t;
        let pos = p.position * buf.duration + (p.freeze >= 0.5 ? 0 : age * p.scan * 0.5) + rand(-1, 1) * p.spray * 2;
        let rate = rate0 * Math.pow(2, (R() < p.pitchSpread * 0.5 ? (R() < 0.5 ? 12 : -12) : rand(-1, 1) * p.pitchSpread * 20) / 1200);
        const dur = p.size, len = dur * rate;
        pos = ((pos % (buf.duration - len)) + (buf.duration - len)) % (buf.duration - len);
        if (env.grainsNow && env.grainsNow() >= env.grainCap()) { next += (1 / dens) * rand(0.7, 1.3); continue; }   // grain cap
        const s = ctx.createBufferSource(), g = ctx.createGain();
        s.buffer = buf; s.playbackRate.value = rate; g.gain.value = 0;
        s.connect(g); g.connect(side ? Rr : L); side ^= 1;
        g.gain.setValueCurveAtTime(win, next, dur);
        s.start(next, pos, len + 0.01); s.stop(next + dur + 0.02);
        let done = false;   // Chromium can fire 'ended' twice for a source given both a duration and a stop time
        s.onended = () => { if (done) return; done = true; disconnectAll(s, g); env.grainEnded?.(); };
        env.grainStarted?.({ t: next, pos: (pos + len / 2) / buf.duration, rate, dur, pan: side ? -p.width : p.width, vel: a, track: v.track?.id });
        grains++;
        next += (1 / dens) * rand(0.7, 1.3);
      }
    };
    return v;
  },
};

export const INSTRUMENTS = [felt, musicbox, strings, tapepad, drone, pluck, texture, cloud];
export const INSTRUMENT_MAP = Object.fromEntries(INSTRUMENTS.map(i => [i.id, i]));

// East Asian pack (js/sound/asian.js), registered here so every engine (live and offline) sees it. The region is the label
// the UI shows on the track and uses to group the instrument pickers.
export const INSTRUMENT_REGIONS = {
  gayageum: 'Korean', haegeum: 'Korean', daegeum: 'Korean', janggu: 'Korean',
  guzheng: 'Chinese', erhu: 'Chinese', dizi: 'Chinese', pipa: 'Chinese', templebells: 'Chinese',
  koto: 'Japanese', shakuhachi: 'Japanese', shamisen: 'Japanese', taiko: 'Japanese', windchimes: 'Japanese',
};
for (const d of ASIAN) { d.region = d.region || INSTRUMENT_REGIONS[d.id] || ''; if (!INSTRUMENT_MAP[d.id]) { INSTRUMENTS.push(d); INSTRUMENT_MAP[d.id] = d; } }

// Round 2 "Antent pack": synths (synths.js), drum machine + 808 (drums.js) and the Chop Sampler (sampler.js), registered the
// same way at module load. The Drum Machine gets a drumMap so the piano roll and the Beats tab show named rows.
Object.assign(INSTRUMENT_REGIONS, {
  supersaw: 'Pads & Synths', analog: 'Pads & Synths', fmkeys: 'Pads & Synths', lead: 'Pads & Synths', synthpluck: 'Pads & Synths', voxpad: 'Pads & Synths',
  synthbass: 'Bass', bass808: 'Bass', drums: 'Drums', chop: 'Samplers',
});
if (!DRUMS.drumMap) DRUMS.drumMap = DRUM_MAP.map(d => ({ midi: d.midi, name: d.name, short: d.short }));
// Voices pack (js/sound/vocals.js): choirs, solo voice, vocal chops, breath, angel pad
for (const d of VOCALS) { d.region = d.region || 'Voices'; if (!INSTRUMENT_MAP[d.id]) { INSTRUMENTS.push(d); INSTRUMENT_MAP[d.id] = d; } }
for (const d of [...SYNTHS, ...DRUM_INSTRUMENTS, SAMPLER]) { d.region = d.region || INSTRUMENT_REGIONS[d.id] || ''; if (!INSTRUMENT_MAP[d.id]) { INSTRUMENTS.push(d); INSTRUMENT_MAP[d.id] = d; } }

/** Full parameter values for an instrument: defaults <- preset <- overrides. */
export function resolveParams(id, presetId, overrides = {}) {
  const def = INSTRUMENT_MAP[id]; if (!def) return null;
  const out = {};
  for (const p of def.params) out[p.id] = p.default;
  const pr = def.presets.find(x => x.id === presetId) || def.presets[0];
  Object.assign(out, pr.params);
  for (const k in overrides) if (k in out && overrides[k] !== undefined && overrides[k] !== null) out[k] = overrides[k];
  return out;
}
