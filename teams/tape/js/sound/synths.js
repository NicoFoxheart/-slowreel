// synths.js - Slowreel round 2 "Antent pack": classic synths (Web Audio only, no samples, no worklets).
// Same definition format as instruments.js: {id, name, kind:'synth', maxVoices, params:[...], macros:[ids], presets:[{id,name,params}],
// voice(ctx, env, P, midi, vel, t)} -> voice {out, release(t), stop(t), kill(t), endTime, nodes, dead}.
// Integrator: INSTRUMENTS.push(...SYNTHS) and INSTRUMENT_MAP[d.id] = d (or spread both lists) - nothing else is needed.
import { clamp, mtof, rng, noiseBuffer, satCurve, cached, disconnectAll, release as relParam } from './util.js?v=10';

const P = (id, name, min, max, def, extra = {}) => ({ id, name, min, max, default: def, unit: '', ...extra });
const ENUM = (id, name, options, def) => ({ id, name, min: 0, max: options.length - 1, default: def, unit: '', type: 'enum', options });
const keyScale = (midi, per = 24) => Math.pow(2, (60 - midi) / per);
const R = rng(7331);
const rand = (a = 0, b = 1) => a + (b - a) * R();
const vel2amp = v => Math.pow(clamp(v, 0, 1), 1.4);

// ---------------------------------------------------------------- voice plumbing (same contract as instruments.js)
class Voice {
  constructor(ctx, env, t) {
    this.ctx = ctx; this.env = env; this.t0 = t; this.out = ctx.createGain(); this.out.gain.value = 1;
    this.srcs = []; this.nodes = [this.out]; this.amps = []; this.rel = 0.5; this.endTime = Infinity; this.released = false; this.relAt = Infinity;
  }
  node(n) { this.nodes.push(n); return n; }
  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return this.node(g); }
  filter(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = clamp(f, 10, 20000); b.Q.value = q; return this.node(b); }
  pan(v) { const p = this.ctx.createStereoPanner(); p.pan.value = clamp(v, -1, 1); return this.node(p); }
  osc(type, freq, t) {
    const o = this.ctx.createOscillator();
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.value = freq; o.start(t); this.srcs.push(o); return this.node(o);
  }
  noise(kind, t) {
    const s = this.ctx.createBufferSource(); s.buffer = noiseBuffer(this.ctx, kind); s.loop = true;
    s.start(t, rand(0, 5)); this.srcs.push(s); return this.node(s);
  }
  lfo(rate, depth, params, t, type = 'sine') {
    if (Math.abs(depth) < 1e-6) return null;
    const l = this.osc(type, rate, t), g = this.gain(depth); l.connect(g); (Array.isArray(params) ? params : [params]).forEach(p => g.connect(p)); return g;
  }
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
    if (first) first.onended = () => { if (this.dead) return; disconnectAll(...this.nodes); this.dead = true; this.env.voiceEnded?.(this); };
    else this.dead = true;
  }
  kill(t, fade = 0.04) { for (const a of this.amps) relParam(a, t, fade); this.released = true; this.relAt = Math.min(this.relAt, t); this.stop(t + fade * 2); }
}

// mono / glide memory per track: keyed by the track's resolved params object (one per track, replaced when params change)
const monoState = new WeakMap();
function monoStart(v, p, f, t, glideSec) {
  const prev = monoState.get(p);
  let from = f, legato = false;
  if (prev && !prev.v.dead) {
    legato = prev.v.relAt > t - 0.004 && prev.t0 < t;   // previous note still held at t
    const recent = prev.v.relAt > t - 0.6;
    if (glideSec > 0.001 && (legato || recent)) from = prev.f;
    if (legato || prev.v.endTime > t) prev.v.kill(t, legato ? 0.03 : 0.015);   // mono: one voice sounds
  } else if (prev && glideSec > 0.001 && t - prev.t0 < 4) from = prev.f;
  monoState.set(p, { v, f, t0: t });
  return { from, legato };
}
function glideTo(param, from, to, t, sec) {
  param.setValueAtTime(from, t);
  if (sec > 0.001 && Math.abs(from - to) > 0.01) param.setTargetAtTime(to, t, sec / 3); else param.setValueAtTime(to, t);
}

// ---------------------------------------------------------------- 1. Supersaw Dream Pad
const supersaw = {
  id: 'supersaw', name: 'Supersaw Pad', kind: 'synth', maxVoices: 8,
  params: [P('tone', 'Tone', 0, 1, 0.45), P('detune', 'Detune', 0, 1, 0.45), P('swell', 'Swell', 0, 1, 0.55), P('drift', 'Drift', 0, 1, 0.4),
    P('width', 'Width', 0, 1, 0.8), P('resonance', 'Resonance', 0, 1, 0.15), P('release', 'Release', 0, 1, 0.55), P('sub', 'Sub', 0, 1, 0), P('level', 'Level', 0, 1.5, 1)],
  macros: ['tone', 'detune', 'swell', 'drift'],
  presets: [
    { id: 'dream-pad', name: 'Dream Pad', params: {} },
    { id: 'glass-wash', name: 'Glass Wash', params: { tone: 0.72, detune: 0.35, swell: 0.7, drift: 0.3, width: 1, release: 0.75, level: 0.85 } },
    { id: 'night-drive', name: 'Night Drive', params: { tone: 0.3, detune: 0.6, swell: 0.2, drift: 0.55, resonance: 0.35, release: 0.35, sub: 0.35 } },
    { id: 'garage-stab', name: 'Garage Stab', params: { tone: 0.55, detune: 0.5, swell: 0, drift: 0.15, width: 0.7, release: 0.15, level: 0.9 } },
    { id: 'frozen-choir-saw', name: 'Frozen Saws', params: { tone: 0.38, detune: 0.8, swell: 0.9, drift: 0.75, width: 1, release: 0.9, level: 0.9 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel);
    const spread = 4 + p.detune * 42;   // cents at the outer saws
    const lp = v.filter('lowpass', 400, 0.5 + p.resonance * 7), hp = v.filter('highpass', 70, 0.6), amp = v.gain(0); v.amps.push(amp.gain);
    const groups = [v.pan(-p.width * 0.85), v.pan(0), v.pan(p.width * 0.85)];
    const gsum = groups.map(() => v.gain(1));
    groups.forEach((g, i) => { gsum[i].connect(g); g.connect(lp); });
    const offs = [-1, -0.62, -0.28, 0, 0.3, 0.64, 1], oscs = [];
    offs.forEach((o, i) => {
      const s = v.osc('sawtooth', f, t); s.detune.value = o * spread + rand(-1.5, 1.5);
      s.connect(gsum[i === 3 ? 1 : (i % 2 ? 0 : 2)]); oscs.push(s);
    });
    gsum[1].gain.value = 0.55;   // center saw a bit under the sides
    if (p.sub > 0.01) { const s = v.osc('sine', f / 2, t), g = v.gain(p.sub * 1.6); s.connect(g); g.connect(hp); oscs.push(s); }
    lp.connect(hp); hp.connect(amp); amp.connect(v.out);
    const at = 0.01 + p.swell * p.swell * 3.2;
    const cut = clamp(f * (1.2 + p.tone * 5) + 250 + p.tone * p.tone * 5000, 200, 12000);
    lp.frequency.setValueAtTime(cut * 0.35, t); lp.frequency.setTargetAtTime(cut, t, at * 0.7 + 0.03);
    // filter drift: two slow unsynced LFOs on the cutoff, plus slow pitch drift of the saws
    v.lfo(rand(0.05, 0.11), p.drift * 700, lp.detune, t); v.lfo(rand(0.13, 0.21), p.drift * 300, lp.detune, t, 'triangle');
    v.lfo(rand(0.2, 0.45), 2 + p.drift * 6, oscs.map(o => o.detune), t);
    const pk = a * 0.06 * p.level;
    amp.gain.setValueAtTime(0, t);
    if (at < 0.03) { amp.gain.linearRampToValueAtTime(pk, t + at); amp.gain.setTargetAtTime(pk * 0.7, t + at, 0.25); }
    else amp.gain.setTargetAtTime(pk, t, at / 2.5);
    v.rel = 0.08 + p.release * p.release * 5;
    return v;
  },
};

// ---------------------------------------------------------------- 2. Analog Poly
const OSC2 = [{ value: 'saw', label: 'Saw' }, { value: 'square', label: 'Square' }, { value: 'sub', label: 'Sub octave' }, { value: 'fifth', label: 'Fifth' }];
const analog = {
  id: 'analog', name: 'Analog Poly', kind: 'synth', maxVoices: 8,
  params: [P('cutoff', 'Cutoff', 0, 1, 0.4), P('resonance', 'Resonance', 0, 1, 0.3), P('envAmt', 'Env amount', 0, 1, 0.5), P('contour', 'Contour', 0, 1, 0.45),
    ENUM('osc2', 'Osc 2', OSC2, 'saw'), P('detune', 'Detune', 0, 1, 0.3), P('attack', 'Attack', 0, 1, 0.05), P('sustain', 'Sustain', 0, 1, 0.6),
    P('release', 'Release', 0, 1, 0.35), P('level', 'Level', 0, 1.5, 1)],
  macros: ['cutoff', 'resonance', 'envAmt', 'contour'],
  presets: [
    { id: 'soft-poly', name: 'Soft Poly', params: {} },
    { id: 'resonant-sweep', name: 'Resonant Sweep', params: { cutoff: 0.2, resonance: 0.7, envAmt: 0.75, contour: 0.7, attack: 0.35, release: 0.6, level: 0.85 } },
    { id: 'square-keys', name: 'Square Keys', params: { osc2: 'square', cutoff: 0.5, resonance: 0.15, envAmt: 0.35, contour: 0.3, sustain: 0.4, detune: 0.2 } },
    { id: 'dusk-brass', name: 'Dusk Brass', params: { osc2: 'fifth', cutoff: 0.3, resonance: 0.2, envAmt: 0.6, contour: 0.4, attack: 0.15, sustain: 0.75, level: 0.85 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel);
    const o1 = v.osc('sawtooth', f, t), mode = p.osc2;
    const o2 = v.osc(mode === 'square' ? 'square' : mode === 'sub' ? 'square' : 'sawtooth', mode === 'sub' ? f / 2 : mode === 'fifth' ? f * 1.4983 : f, t);
    o1.detune.value = -p.detune * 9; o2.detune.value = p.detune * 9 + rand(-1, 1);
    const g1 = v.gain(0.5), g2 = v.gain(mode === 'fifth' ? 0.28 : 0.42);
    const lp = v.filter('lowpass', 400, 0.6 + p.resonance * 13), hp = v.filter('highpass', 45, 0.6), amp = v.gain(0); v.amps.push(amp.gain);
    o1.connect(g1); o2.connect(g2); g1.connect(lp); g2.connect(lp); lp.connect(hp); hp.connect(amp); amp.connect(v.out);
    // filter envelope (contour = decay time); resonance is compensated a little so it stays quiet
    const base = clamp(90 * Math.pow(70, p.cutoff) + f * 0.5, 60, 9000), peak = clamp(base * Math.pow(2, p.envAmt * 5.5 * (0.6 + vel * 0.4)), 60, 15000);
    const fat = 0.003 + p.attack * p.attack * 2, fdec = 0.06 + p.contour * p.contour * 2.5;
    lp.frequency.setValueAtTime(base, t); lp.frequency.linearRampToValueAtTime(peak, t + fat);
    lp.frequency.setTargetAtTime(base + (peak - base) * 0.12, t + fat, fdec / 3);
    const pk = a * 0.2 * p.level / (1 + p.resonance * 0.8), at = 0.004 + p.attack * p.attack * 2.5;
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(pk, t + at);
    amp.gain.setTargetAtTime(pk * (0.15 + p.sustain * 0.85), t + at, 0.05 + p.contour * 0.6);
    v.lfo(rand(0.3, 0.6), 3, [o1.detune, o2.detune], t);
    v.rel = 0.04 + p.release * p.release * 3;
    v.onRelease = (rt, r) => relParam(lp.frequency, rt, r * 1.4);   // filter closes with the release
    return v;
  },
};

// ---------------------------------------------------------------- 3. FM E-Piano (2-op FM + tine)
const RATIOS = [{ value: '1', label: '1:1 Tine' }, { value: '2', label: '2:1 Reed' }, { value: '3.5', label: '3.5:1 Bell' }, { value: '0.5', label: '1:2 Hollow' }];
const fmkeys = {
  id: 'fmkeys', name: 'FM E-Piano', kind: 'synth', maxVoices: 12,
  params: [P('bell', 'Bell', 0, 1, 0.4), P('decay', 'Decay', 0, 1, 0.5), P('tremolo', 'Tremolo', 0, 1, 0.35), P('tine', 'Tine', 0, 1, 0.4),
    ENUM('ratio', 'Ratio', RATIOS, '1'), P('rate', 'Trem rate', 0.5, 9, 4.2, { unit: 'Hz' }), P('warmth', 'Warmth', 0, 1, 0.5), P('level', 'Level', 0, 1.5, 1)],
  macros: ['bell', 'decay', 'tremolo', 'tine'],
  presets: [
    { id: 'dream-keys', name: 'Dream Keys', params: {} },
    { id: 'bell-tines', name: 'Bell Tines', params: { bell: 0.7, decay: 0.7, tremolo: 0.15, tine: 0.75, ratio: '3.5', warmth: 0.3, level: 0.8 } },
    { id: 'felted-ep', name: 'Felted EP', params: { bell: 0.2, decay: 0.4, tremolo: 0.5, tine: 0.15, warmth: 0.85, rate: 3.2, level: 1.15 } },
    { id: 'glass-fm', name: 'Glass FM', params: { bell: 0.55, decay: 0.8, tremolo: 0.25, tine: 0.5, ratio: '2', warmth: 0.25, rate: 5.5, level: 0.85 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel), ks = keyScale(midi, 20), ratio = parseFloat(p.ratio) || 1;
    const car = v.osc('sine', f, t), mod = v.osc('sine', f * ratio, t), idx = v.gain(0);
    mod.connect(idx); idx.connect(car.frequency);
    const i0 = f * ratio * (0.4 + p.bell * 3.2) * (0.45 + vel * 0.75), i1 = f * ratio * (0.12 + p.bell * 0.35);
    const dec = (0.6 + p.decay * 4.5) * ks;
    idx.gain.setValueAtTime(i0, t); idx.gain.setTargetAtTime(i1, t + 0.002, 0.08 + p.decay * 0.25); idx.gain.setTargetAtTime(0, t + 0.5, dec / 2);
    const lp = v.filter('lowpass', clamp(f * (3 + (1 - p.warmth) * 14), 600, 12000), 0.5);
    const trem = v.gain(1), amp = v.gain(0); v.amps.push(amp.gain);
    car.connect(lp); lp.connect(trem); trem.connect(amp);
    const pan = v.pan(0); amp.connect(pan); pan.connect(v.out);
    // tremolo: amplitude + a gentle stereo auto-pan, like the suitcase amp
    if (p.tremolo > 0.01) {
      trem.gain.value = 1 - p.tremolo * 0.35; v.lfo(p.rate, p.tremolo * 0.35, trem.gain, t);
      v.lfo(p.rate, p.tremolo * 0.45, pan.pan, t, 'triangle');
    }
    // tine: short metallic partial at the attack
    if (p.tine > 0.01 && f * 7 < 15000) {
      const tn = v.osc('sine', f * 7.02, t), tg = v.gain(0); tn.connect(tg); tg.connect(trem);
      tg.gain.setValueAtTime(p.tine * 0.35 * (0.4 + vel * 0.6), t); tg.gain.setTargetAtTime(0, t + 0.001, 0.025 + p.decay * 0.03);
    }
    const pk = a * 0.24 * p.level;
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(pk, t + 0.003);
    amp.gain.setTargetAtTime(pk * 0.6, t + 0.003, 0.12); amp.gain.setTargetAtTime(0, t + 0.3, dec / 2.2);
    v.lfo(rand(0.3, 0.6), 2.5, car.detune, t);
    v.rel = 0.18 + p.decay * 0.25;
    v.stop(t + 0.3 + dec * 3.4);
    return v;
  },
};

// ---------------------------------------------------------------- 4. Synth Lead (mono, glide, vibrato)
const lead = {
  id: 'lead', name: 'Synth Lead', kind: 'synth', maxVoices: 2,
  params: [P('glide', 'Glide', 0, 1, 0.35), P('vibrato', 'Vibrato', 0, 1, 0.35), P('tone', 'Tone', 0, 1, 0.45), P('shape', 'Shape', 0, 1, 0.3),
    P('detune', 'Detune', 0, 1, 0.25), P('attack', 'Attack', 0, 1, 0.1), P('release', 'Release', 0, 1, 0.3), P('breath', 'Breath', 0, 1, 0.1), P('level', 'Level', 0, 1.5, 1)],
  macros: ['glide', 'vibrato', 'tone', 'shape'],
  presets: [
    { id: 'dream-lead', name: 'Dream Lead', params: {} },
    { id: 'square-whistle', name: 'Square Whistle', params: { glide: 0.25, vibrato: 0.45, tone: 0.35, shape: 1, detune: 0, breath: 0.3, level: 0.85 } },
    { id: 'night-saw', name: 'Night Saw', params: { glide: 0.55, vibrato: 0.25, tone: 0.6, shape: 0, detune: 0.6, attack: 0.05, level: 0.8 } },
    { id: 'sine-flute', name: 'Sine Flute', params: { glide: 0.2, vibrato: 0.5, tone: 0.15, shape: 0.5, detune: 0.1, attack: 0.3, breath: 0.55, level: 1.15 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel), gl = p.glide * p.glide * 0.6;
    const { from, legato } = monoStart(v, p, f, t, gl);
    // shape 0 = saws, 0.5 = sine/triangle, 1 = square
    const saw1 = v.osc('sawtooth', f, t), saw2 = v.osc('sawtooth', f, t), sq = v.osc('square', f, t), tri = v.osc('triangle', f, t);
    const oscs = [saw1, saw2, sq, tri];
    oscs.forEach(o => glideTo(o.frequency, from, f, t, gl));
    saw1.detune.value = -p.detune * 14; saw2.detune.value = p.detune * 14;
    const sh = p.shape, gs = clamp(1 - sh * 2, 0, 1), gt = 1 - Math.abs(sh - 0.5) * 2, gq = clamp(sh * 2 - 1, 0, 1);
    const mix = [[saw1, gs * 0.5], [saw2, gs * 0.5], [sq, gq * 0.55], [tri, Math.max(0.05, gt) * 0.9]];
    const lp = v.filter('lowpass', 1000, 1.2), hp = v.filter('highpass', 90, 0.6), amp = v.gain(0); v.amps.push(amp.gain);
    for (const [o, g] of mix) { const gg = v.gain(g); o.connect(gg); gg.connect(lp); }
    lp.connect(hp); hp.connect(amp); amp.connect(v.out);
    const cut = clamp(f * (1.5 + p.tone * 9) + 300, 300, 12000);
    lp.frequency.setValueAtTime(legato ? cut : cut * 1.6, t); lp.frequency.setTargetAtTime(cut, t, 0.12);
    if (p.breath > 0.01) { const n = v.noise('pink', t), bp = v.filter('bandpass', clamp(f * 2, 600, 6000), 1.2), g = v.gain(p.breath * 0.35); n.connect(bp); bp.connect(g); g.connect(amp); }
    // delayed vibrato
    if (p.vibrato > 0.01) {
      const vg = v.lfo(rand(4.8, 5.6), 1, oscs.map(o => o.detune), t);
      vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(p.vibrato * 30, t + 0.35 + p.vibrato * 0.3);
    }
    const pk = a * 0.16 * p.level, at = legato ? 0.03 : 0.005 + p.attack * p.attack * 1.2;
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(pk, t + at); amp.gain.setTargetAtTime(pk * 0.85, t + at, 0.2);
    v.rel = 0.05 + p.release * p.release * 2;
    return v;
  },
};

// ---------------------------------------------------------------- 5. Synth Bass (sub + saw, filter pluck, mono glide)
const bass = {
  id: 'synthbass', name: 'Synth Bass', kind: 'synth', maxVoices: 2,
  params: [P('sub', 'Sub', 0, 1, 0.6), P('pluck', 'Pluck', 0, 1, 0.5), P('decay', 'Decay', 0, 1, 0.4), P('drive', 'Drive', 0, 1, 0.25),
    P('cutoff', 'Cutoff', 0, 1, 0.3), P('resonance', 'Resonance', 0, 1, 0.25), P('detune', 'Detune', 0, 1, 0), P('glide', 'Glide', 0, 1, 0),
    P('release', 'Release', 0, 1, 0.2), P('level', 'Level', 0, 1.5, 1)],
  macros: ['sub', 'pluck', 'decay', 'drive'],
  presets: [
    { id: 'deep-sub', name: 'Deep Sub', params: { sub: 1, pluck: 0.15, decay: 0.7, drive: 0.15, cutoff: 0.15, glide: 0.25 } },
    { id: 'pluck-bass', name: 'Pluck Bass', params: {} },
    { id: 'reese', name: 'Reese', params: { sub: 0.55, pluck: 0.2, decay: 0.8, drive: 0.4, cutoff: 0.35, resonance: 0.1, detune: 0.75, glide: 0.2, level: 0.85 } },
    { id: 'soft-acid', name: 'Soft Acid', params: { sub: 0.35, pluck: 0.8, decay: 0.3, drive: 0.35, cutoff: 0.2, resonance: 0.75, glide: 0.35, level: 0.85 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel), gl = p.glide * p.glide * 0.4;
    const { from, legato } = monoStart(v, p, f, t, gl);
    const sub = v.osc('sine', f, t), s1 = v.osc('sawtooth', f, t), s2 = v.osc('sawtooth', f, t);
    [sub, s1, s2].forEach(o => glideTo(o.frequency, from, f, t, gl));
    s1.detune.value = -p.detune * 18; s2.detune.value = p.detune * 18 + 0.5;
    const sg = v.gain(p.sub * 0.9), wg = v.gain(0.42 * (1 - p.sub * 0.45));
    const lp = v.filter('lowpass', 300, 0.7 + p.resonance * 11), drv = v.node(ctx.createWaveShaper()), hp = v.filter('highpass', 30, 0.7), amp = v.gain(0); v.amps.push(amp.gain);
    drv.curve = satCurve(ctx, 1 + p.drive * 4);
    s1.connect(wg); s2.connect(wg); wg.connect(lp); lp.connect(drv); sub.connect(sg); sg.connect(drv);
    const post = v.gain(1 / (1 + p.drive * 0.6)); drv.connect(post); post.connect(hp); hp.connect(amp); amp.connect(v.out);
    const base = clamp(f * 1.2 + 60 * Math.pow(30, p.cutoff), 50, 4000), peak = clamp(base * Math.pow(2, p.pluck * 5 * (0.6 + vel * 0.4)), 50, 9000);
    const fdec = 0.03 + p.decay * p.decay * 0.9;
    if (legato) lp.frequency.setValueAtTime(base * 1.3, t); else lp.frequency.setValueAtTime(peak, t);
    lp.frequency.setTargetAtTime(base, t + 0.002, fdec / 3);
    const pk = a * 0.26 * p.level / (1 + p.resonance * 0.5);
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(pk, t + (legato ? 0.02 : 0.004));
    amp.gain.setTargetAtTime(pk * (0.55 + p.decay * 0.4), t + 0.01, 0.15 + p.decay * 0.6);
    v.rel = 0.04 + p.release * p.release * 1.2;
    return v;
  },
};

// ---------------------------------------------------------------- 6. Pluck Synth (filtered short saw / square / Karplus-Strong string)
// Karplus-Strong is computed in JS into a cached AudioBuffer (a DelayNode loop cannot go below 128 samples in Web Audio).
function ksBuffer(ctx, midi, decay, bright) {
  const dq = Math.round(decay * 10) / 10, bq = Math.round(bright * 10) / 10;
  return cached(ctx, `ks:${midi}:${dq}:${bq}`, () => {
    const sr = ctx.sampleRate, f = mtof(midi), N = Math.max(2, Math.round(sr / f - 0.5));
    const t60 = (0.4 + dq * 3.6) * keyScale(midi, 30), secs = Math.min(5, t60 * 1.1 + 0.05), n = Math.ceil(sr * secs);
    const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0), r = rng(midi * 7 + 3);
    const loss = Math.pow(0.001, 1 / (t60 * f)) / 1.0, ex = Math.min(n, N);
    let lpz = 0; const exA = 0.15 + bq * 0.8;     // excitation brightness: one-pole lowpass on the noise burst
    let mean = 0; const exc = new Float32Array(ex);
    for (let i = 0; i < ex; i++) { lpz += exA * ((r() * 2 - 1) - lpz); exc[i] = lpz; mean += lpz; }
    mean /= ex; for (let i = 0; i < ex; i++) exc[i] -= mean;
    const s = 0.5 - bq * 0.12;    // averaging weight: brighter strings average less
    for (let i = 0; i < n; i++) {
      const x = i < ex ? exc[i] : 0;
      const a1 = i - N >= 0 ? d[i - N] : 0, a2 = i - N - 1 >= 0 ? d[i - N - 1] : 0;
      d[i] = x + loss * ((1 - s) * a1 + s * a2);
    }
    let pk = 1e-9; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(d[i]));
    const g = 0.9 / pk, fo = Math.min(n, Math.round(sr * 0.02));
    for (let i = 0; i < n; i++) d[i] *= g * (i >= n - fo ? (n - i) / fo : 1);
    buf._rate = f / (sr / (N + s));   // tuning correction for the integer delay
    return buf;
  });
}
const PWAVES = [{ value: 'saw', label: 'Saw' }, { value: 'square', label: 'Square' }, { value: 'string', label: 'String (Karplus)' }];
const synthpluck = {
  id: 'synthpluck', name: 'Pluck Synth', kind: 'synth', maxVoices: 12,
  params: [P('bright', 'Bright', 0, 1, 0.5), P('decay', 'Decay', 0, 1, 0.35), P('body', 'Body', 0, 1, 0.3), P('width', 'Width', 0, 1, 0.4),
    ENUM('wave', 'Source', PWAVES, 'saw'), P('detune', 'Detune', 0, 1, 0.25), P('level', 'Level', 0, 1.5, 1)],
  macros: ['bright', 'decay', 'body', 'width'],
  presets: [
    { id: 'garage-pluck', name: 'Garage Pluck', params: {} },
    { id: 'glass-string', name: 'Glass String', params: { wave: 'string', bright: 0.75, decay: 0.5, body: 0.2, width: 0.5, level: 0.9 } },
    { id: 'soft-harp-synth', name: 'Soft Harp', params: { wave: 'string', bright: 0.3, decay: 0.75, body: 0.35, width: 0.3 } },
    { id: 'square-pluck', name: 'Square Pluck', params: { wave: 'square', bright: 0.4, decay: 0.25, body: 0.55, width: 0.6, detune: 0.1, level: 0.85 } },
  ],
  // engine hook (integrator): the Karplus string buffer for each pitch is made at load(), never when play() starts
  prewarm(ctx, p, midi) { if (p.wave === 'string') ksBuffer(ctx, midi, p.decay, p.bright); },
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel), ks = keyScale(midi, 22);
    const amp = v.gain(0); v.amps.push(amp.gain);
    const pan = v.pan(rand(-1, 1) * p.width * 0.7);
    const lp = v.filter('lowpass', 2000, 0.7 + p.body * 8), hp = v.filter('highpass', 80, 0.6);
    lp.connect(hp); hp.connect(amp); amp.connect(pan); pan.connect(v.out);
    let dec;
    if (p.wave === 'string') {
      const buf = ksBuffer(ctx, midi, p.decay, p.bright), s = ctx.createBufferSource();
      s.buffer = buf; s.playbackRate.value = buf._rate; s.start(t); v.srcs.push(s); v.node(s);
      s.connect(lp); lp.frequency.value = clamp(f * (3 + p.bright * 12), 800, 14000);
      dec = buf.duration;
      const pk = a * 0.22 * p.level;
      amp.gain.setValueAtTime(pk, t);
      v.stop(t + buf.duration / buf._rate + 0.05);
    } else {
      const type = p.wave === 'square' ? 'square' : 'sawtooth';
      const o1 = v.osc(type, f, t), o2 = v.osc(type, f, t), g = v.gain(0.5);
      o1.detune.value = -p.detune * 12; o2.detune.value = p.detune * 12; o1.connect(g); o2.connect(g); g.connect(lp);
      dec = (0.08 + p.decay * p.decay * 1.6) * ks;
      const top = clamp(f * (2 + p.bright * 22 * (0.4 + vel * 0.6)), 300, 14000), rest = clamp(f * 0.9 + 120, 100, 3000);
      lp.frequency.setValueAtTime(top, t); lp.frequency.setTargetAtTime(rest, t + 0.002, dec / 3.2);
      const pk = a * 0.17 * p.level / (1 + p.body * 0.6);
      amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(pk, t + 0.002); amp.gain.setTargetAtTime(0, t + 0.002, dec / 2.3);
      v.stop(t + dec * 3.2 + 0.1);
    }
    v.rel = 0.12 + p.decay * 0.25;
    return v;
  },
};

// ---------------------------------------------------------------- 7. Vox Pad (formant choir, ooh / oh / aah / eeh)
// vowel formants [F1, F2, F3] (Hz) and levels for a soft mixed choir
const VOWELS = [[[325, 700, 2530], [1, 0.35, 0.12]], [[450, 830, 2650], [1, 0.45, 0.15]], [[730, 1090, 2540], [1, 0.55, 0.22]], [[400, 1900, 2700], [1, 0.4, 0.25]]];
function vowelAt(x) {
  const pos = clamp(x, 0, 1) * (VOWELS.length - 1), i = Math.min(VOWELS.length - 2, Math.floor(pos)), u = pos - i, A = VOWELS[i], B = VOWELS[i + 1];
  return [A[0].map((fq, k) => fq * Math.pow(B[0][k] / fq, u)), A[1].map((l, k) => l + (B[1][k] - l) * u)];
}
const voxpad = {
  id: 'voxpad', name: 'Vox Pad', kind: 'synth', maxVoices: 8,
  params: [P('vowel', 'Vowel', 0, 1, 0.25), P('motion', 'Motion', 0, 1, 0.3), P('breath', 'Breath', 0, 1, 0.25), P('swell', 'Swell', 0, 1, 0.5),
    P('formant', 'Formant', -1, 1, 0), P('ensemble', 'Ensemble', 0, 1, 0.6), P('release', 'Release', 0, 1, 0.5), P('level', 'Level', 0, 1.5, 1)],
  macros: ['vowel', 'motion', 'breath', 'swell'],
  presets: [
    { id: 'ooh-choir', name: 'Ooh Choir', params: { vowel: 0 } },
    { id: 'aah-choir', name: 'Aah Choir', params: { vowel: 0.66, motion: 0.2, breath: 0.2, swell: 0.6 } },
    { id: 'vocal-chop', name: 'Vocal Chop', params: { vowel: 0.55, motion: 0.55, breath: 0.15, swell: 0.02, ensemble: 0.25, formant: 0.25, release: 0.12, level: 1.1 } },
    { id: 'breathy-vox', name: 'Breathy Vox', params: { vowel: 0.3, motion: 0.35, breath: 0.7, swell: 0.45, formant: 0.15, ensemble: 0.4 } },
    { id: 'angel-air', name: 'Angel Air', params: { vowel: 0.9, motion: 0.4, breath: 0.4, swell: 0.8, formant: 0.45, ensemble: 0.85, release: 0.8, level: 0.9 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), f = mtof(midi), a = vel2amp(vel);
    const n = p.ensemble > 0.15 ? 3 : 1, spread = 4 + p.ensemble * 14, src = v.gain(1 / Math.sqrt(n)), oscs = [];
    for (let i = 0; i < n; i++) {
      const o = v.osc('sawtooth', f, t); o.detune.value = n === 1 ? 0 : (i - 1) * spread + rand(-2, 2); o.connect(src); oscs.push(o);
    }
    // glottal tilt: soften the saws before the formants
    const tilt = v.filter('lowpass', clamp(f * 6, 900, 5000), 0.5); src.connect(tilt);
    const amp = v.gain(0); v.amps.push(amp.gain);
    const sum = v.gain(1), hp = v.filter('highpass', 110, 0.6); sum.connect(hp); hp.connect(amp); amp.connect(v.out);
    const shift = Math.pow(2, p.formant * 0.35), [fq, lv] = vowelAt(p.vowel), [fq2] = vowelAt(p.vowel < 0.5 ? p.vowel + 0.35 : p.vowel - 0.35);
    const mrate = rand(0.12, 0.22) + p.motion * 0.25, filters = [];
    fq.forEach((F, k) => {
      const bp = v.filter('bandpass', F * shift, [5, 8, 12][k]), g = v.gain(lv[k] * [3.2, 4.2, 5][k]);
      tilt.connect(bp); bp.connect(g); g.connect(sum); filters.push(bp);
      // motion: formants drift toward the neighbouring vowel ("ooh-aah" chops)
      const cents = 1200 * Math.log2(fq2[k] / F) * p.motion * 0.5;
      v.lfo(mrate, cents, bp.detune, t);
    });
    if (p.breath > 0.01) {
      const nz = v.noise('pink', t), bp = v.filter('bandpass', clamp(fq[1] * shift * 1.8, 900, 6000), 0.8), g = v.gain(p.breath * 0.5);
      nz.connect(bp); bp.connect(g); g.connect(sum);
      const nz2 = v.filter('highpass', 5000, 0.5), g2 = v.gain(p.breath * 0.08); nz.connect(nz2); nz2.connect(g2); g2.connect(sum);
    }
    const vib = v.lfo(rand(4.6, 5.4), 1, oscs.map(o => o.detune), t);
    vib.gain.setValueAtTime(0, t); vib.gain.linearRampToValueAtTime(9, t + 0.6);
    v.lfo(rand(0.2, 0.4), 4, oscs.map(o => o.detune), t);
    const at = 0.012 + p.swell * p.swell * 2.6, pk = a * 0.12 * p.level;
    amp.gain.setValueAtTime(0, t);
    if (at < 0.05) { amp.gain.linearRampToValueAtTime(pk, t + at); amp.gain.setTargetAtTime(pk * 0.75, t + at, 0.15); }
    else amp.gain.setTargetAtTime(pk, t, at / 2.5);
    v.rel = 0.06 + p.release * p.release * 4;
    return v;
  },
};

export const SYNTHS = [supersaw, analog, fmkeys, lead, bass, synthpluck, voxpad];
export const SYNTH_MAP = Object.fromEntries(SYNTHS.map(s => [s.id, s]));
