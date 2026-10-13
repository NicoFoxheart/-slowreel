// The rain instruments: all synthesized with Web Audio (no samples), plus the granular Song Cloud that
// turns one of Nico's songs into a playable pad. Each instrument: params (macros are params too), presets, voices.
import { clamp, expMap, midiToHz, holdAt, noiseBuffer, rng, defaultsOf, coerce, tanhCurve } from './util.js';
import { TEXTURES, textureBuffer } from './textures.js';

export const SONG_LIST = [
  { id: 'sleepy-rain', title: 'Sleepy Rain' },
  { id: 'after-the-storm', title: 'After the Storm' },
  { id: 'nature-of-love', title: 'Nature of Love' },
  { id: 'infinite-love', title: 'Infinite Love' },
  { id: 'hopeful-romantic', title: 'Hopeful Romantic' },
  { id: 'ill-never-leave-you', title: "I'll Never Leave You" },
  { id: 'ill-never-leave-you-nightcore', title: "I'll Never Leave You (Nightcore)" },
  { id: 'ballet-of-life', title: 'Ballet of Life' },
  { id: 'i-am-with-you-always', title: 'I Am With You Always' },
];

const P = (id, name, min, max, def, extra = {}) => ({ id, name, min, max, default: def, ...extra });

export const INSTRUMENTS = [
  { id: 'nightpad', name: 'Night Pad', kind: 'pad', maxVoices: 14,
    params: [P('glow', 'Glow', 0, 1, 0.45), P('breath', 'Breath', 0, 1, 0.4), P('drift', 'Drift', 0, 1, 0.35), P('swell', 'Swell', 0, 1, 0.55),
      P('release', 'Release', 0.2, 12, 5, { unit: 's' }), P('rate', 'Breath rate', 0.01, 0.5, 0.06, { unit: 'Hz' }), P('sub', 'Sub', 0, 1, 0.2),
      P('air', 'Air', 0, 1, 0.08), P('resonance', 'Resonance', 0, 1, 0.15)],
    macros: ['glow', 'breath', 'drift', 'swell'],
    presets: [
      { id: 'sodium', name: 'Sodium Lamps', params: {} },
      { id: 'neon-fog', name: 'Neon Fog', params: { glow: 0.6, breath: 0.55, drift: 0.6, swell: 0.45, release: 6, rate: 0.09, sub: 0.1, air: 0.15, resonance: 0.25 } },
      { id: 'deep-night', name: 'Deep Night', params: { glow: 0.27, breath: 0.3, drift: 0.25, swell: 0.65, release: 7, rate: 0.04, sub: 0.45, air: 0.05, resonance: 0.1 } },
      { id: 'wet-asphalt', name: 'Wet Asphalt', params: { glow: 0.4, breath: 0.75, drift: 0.45, swell: 0.4, release: 4, rate: 0.17, sub: 0.15, air: 0.2, resonance: 0.35 } },
    ] },
  { id: 'feltpiano', name: 'Felt Piano', kind: 'keys', maxVoices: 24,
    params: [P('felt', 'Felt', 0, 1, 0.65), P('tone', 'Tone', 0, 1, 0.45), P('sustain', 'Sustain', 0, 1, 0.5), P('mechanics', 'Mechanics', 0, 1, 0.45),
      P('unison', 'Unison', 0, 1, 0.4), P('release', 'Release', 0.1, 4, 0.6, { unit: 's' }), P('width', 'Width', 0, 1, 0.6)],
    macros: ['felt', 'tone', 'sustain', 'mechanics'],
    presets: [
      { id: 'felt-upright', name: 'Felt Upright', params: {} },
      { id: 'midnight-grand', name: 'Midnight Grand', params: { felt: 0.3, tone: 0.55, sustain: 0.75, mechanics: 0.25, unison: 0.5, release: 1.2, width: 0.8 } },
      { id: 'lullaby', name: 'Muffled Lullaby', params: { felt: 0.92, tone: 0.3, sustain: 0.45, mechanics: 0.6, unison: 0.3, release: 0.5, width: 0.5 } },
    ] },
  { id: 'tines', name: 'Night Tines', kind: 'keys', maxVoices: 16,
    params: [P('bell', 'Bell', 0, 1, 0.35), P('warmth', 'Warmth', 0, 1, 0.55), P('tremolo', 'Tremolo', 0, 1, 0.45), P('decay', 'Decay', 0, 1, 0.55),
      P('bark', 'Bark', 0, 1, 0.35), P('rate', 'Tremolo rate', 0.3, 7, 3.2, { unit: 'Hz' }), P('release', 'Release', 0.05, 3, 0.5, { unit: 's' })],
    macros: ['bell', 'warmth', 'tremolo', 'decay'],
    presets: [
      { id: 'suitcase', name: 'Suitcase at 3 AM', params: {} },
      { id: 'wet-glass', name: 'Wet Glass', params: { bell: 0.7, warmth: 0.32, tremolo: 0.25, decay: 0.7, bark: 0.2, rate: 2.2 } },
      { id: 'velvet', name: 'Velvet Tines', params: { bell: 0.15, warmth: 0.8, tremolo: 0.6, decay: 0.5, bark: 0.5, rate: 4 } },
    ] },
  { id: 'strings', name: 'Rain Strings', kind: 'strings', maxVoices: 12,
    params: [P('bow', 'Bow', 0, 1, 0.35), P('vibrato', 'Vibrato', 0, 1, 0.4), P('swell', 'Swell', 0, 1, 0.45), P('ensemble', 'Ensemble', 0, 1, 0.3),
      P('release', 'Release', 0.3, 8, 3, { unit: 's' }), P('vibRate', 'Vibrato rate', 3, 7, 4.8, { unit: 'Hz' })],
    macros: ['bow', 'vibrato', 'swell', 'ensemble'],
    presets: [
      { id: 'cello-night', name: 'Cello at Night', params: {} },
      { id: 'fog-violas', name: 'Violas in Fog', params: { bow: 0.5, vibrato: 0.5, swell: 0.55, ensemble: 0.55, release: 4, vibRate: 5.2 } },
      { id: 'far-orchestra', name: 'Far Orchestra', params: { bow: 0.25, vibrato: 0.3, swell: 0.8, ensemble: 0.85, release: 6, vibRate: 5 } },
    ] },
  { id: 'drone', name: 'Undertow', kind: 'bass', maxVoices: 6,
    params: [P('weight', 'Weight', 0, 1, 0.4), P('motion', 'Motion', 0, 1, 0.35), P('grit', 'Grit', 0, 1, 0.15), P('tone', 'Tone', 0, 1, 0.3),
      P('attack', 'Attack', 0.05, 10, 3, { unit: 's' }), P('release', 'Release', 0.5, 12, 5, { unit: 's' })],
    macros: ['weight', 'motion', 'grit', 'tone'],
    presets: [
      { id: 'undertow', name: 'Undertow', params: {} },
      { id: 'subway', name: 'Subway Hum', params: { weight: 0.6, motion: 0.2, grit: 0.55, tone: 0.45, attack: 1.5, release: 3 } },
      { id: 'low-tide', name: 'Low Tide', params: { weight: 0.25, motion: 0.8, grit: 0.05, tone: 0.2, attack: 6, release: 9 } },
    ] },
  { id: 'pluck', name: 'Street Pluck', kind: 'pluck', maxVoices: 16,
    params: [P('tone', 'Tone', 0, 1, 0.55), P('decay', 'Decay', 0, 1, 0.45), P('bend', 'Bend', 0, 1, 0.45), P('body', 'Body', 0, 1, 0.5),
      P('release', 'Release', 0.05, 2, 0.4, { unit: 's' })],
    macros: ['tone', 'decay', 'bend', 'body'],
    presets: [
      { id: 'koto', name: 'Koto in the Rain', params: {} },
      { id: 'night-harp', name: 'Night Harp', params: { tone: 0.4, decay: 0.75, bend: 0.08, body: 0.3, release: 0.8 } },
      { id: 'muted', name: 'Muted Strings', params: { tone: 0.25, decay: 0.2, bend: 0.2, body: 0.75, release: 0.2 } },
    ] },
  { id: 'textures', name: 'Night Textures', kind: 'texture', maxVoices: 4,
    params: [{ id: 'texture', name: 'Texture', default: 'rain', options: TEXTURES.map(t => ({ id: t.id, name: t.name })) },
      P('amount', 'Amount', 0, 1, 0.6), P('tone', 'Tone', 0, 1, 0.6), P('width', 'Width', 0, 1, 0.8), P('drift', 'Drift', 0, 1, 0.3),
      P('attack', 'Fade in', 0.05, 10, 2.5, { unit: 's' }), P('release', 'Fade out', 0.2, 12, 4, { unit: 's' })],
    macros: ['amount', 'tone', 'width', 'drift'],
    presets: [
      { id: 'soft-rain', name: 'Soft Rain', params: { texture: 'rain' } },
      { id: 'rain-glass', name: 'Rain on Glass', params: { texture: 'window', tone: 0.5 } },
      { id: 'downpour', name: 'Downpour', params: { texture: 'heavy', amount: 0.55, tone: 0.5 } },
      { id: 'vinyl', name: 'Vinyl Crackle', params: { texture: 'vinyl', amount: 0.5, tone: 0.55, width: 0.5, drift: 0.1 } },
      { id: 'night-city', name: 'Night City', params: { texture: 'city', amount: 0.55, tone: 0.5, drift: 0.4 } },
      { id: 'night-wind', name: 'Night Wind', params: { texture: 'wind', amount: 0.55, tone: 0.6, drift: 0.5 } },
      { id: 'far-thunder', name: 'Distant Thunder', params: { texture: 'thunder', amount: 0.6, tone: 0.55 } },
    ] },
  { id: 'cloud', name: 'Song Cloud', kind: 'granular', maxVoices: 6, usesSong: true,
    params: [{ id: 'song', name: 'Song', default: 'sleepy-rain', options: SONG_LIST.map(s => ({ id: s.id, name: s.title })) },
      P('position', 'Position', 0, 1, 0.3), P('grain', 'Grain', 0.03, 0.6, 0.22, { unit: 's' }), P('density', 'Density', 1, 40, 12, { unit: '/s' }),
      P('spray', 'Spray', 0, 1, 0.3), P('freeze', 'Freeze', 0, 1, 0, { step: 1, toggle: true }), P('scan', 'Scan', 0, 1, 0.2),
      P('pitchSpread', 'Pitch spread', 0, 1, 0.1), P('octaves', 'Octave grains', 0, 1, 0.1), P('tone', 'Tone', 0, 1, 0.6),
      P('width', 'Width', 0, 1, 0.8), P('attack', 'Fade in', 0.02, 8, 1.5, { unit: 's' }), P('release', 'Fade out', 0.1, 10, 3, { unit: 's' }),
      P('root', 'Root note', 36, 84, 60, { step: 1, unit: 'midi' })],
    macros: ['position', 'grain', 'density', 'spray'],
    presets: [
      { id: 'rain-memory', name: 'Rain Memory', params: { song: 'sleepy-rain', position: 0.3 } },
      { id: 'frozen-moment', name: 'Frozen Moment', params: { song: 'sleepy-rain', position: 0.55, grain: 0.4, density: 16, spray: 0.12, freeze: 1, pitchSpread: 0.05, attack: 3, release: 5 } },
      { id: 'after-storm-mist', name: 'After the Storm Mist', params: { song: 'after-the-storm', position: 0.4, grain: 0.3, density: 10, spray: 0.5, scan: 0.1, tone: 0.45 } },
      { id: 'glitter', name: 'Glitter Rain', params: { song: 'nature-of-love', position: 0.5, grain: 0.07, density: 30, spray: 0.7, pitchSpread: 0.25, octaves: 0.4, tone: 0.75 } },
    ] },
];

for (const d of INSTRUMENTS) d.macros = d.macros.map(id => { const p = d.params.find(x => x.id === id); return { id, name: p.name, min: p.min, max: p.max, default: p.default }; });

export const instrumentDef = id => INSTRUMENTS.find(i => i.id === id) || null;

export function resolveParams(def, presetId, overrides) {
  const p = defaultsOf(def.params);
  const pre = def.presets.find(x => x.id === presetId) || def.presets[0];
  for (const src of [pre && pre.params, overrides]) {
    if (!src) continue;
    for (const k of Object.keys(src)) { const pd = def.params.find(x => x.id === k); if (pd) p[k] = coerce(pd, src[k]); }
  }
  return p;
}

// ---------------- helpers ----------------
const waves = new WeakMap();
function pianoWave(ctx) {
  let w = waves.get(ctx); if (w) return w;
  const H = 18, re = new Float32Array(H + 1), im = new Float32Array(H + 1);
  for (let n = 1; n <= H; n++) im[n] = (1 / Math.pow(n, 1.1)) * (0.12 + 0.88 * Math.abs(Math.sin(Math.PI * n / 7.3)));
  w = ctx.createPeriodicWave(re, im); waves.set(ctx, w); return w;
}
function attackEnv(param, t, a, peak) { param.setValueAtTime(0, t); param.linearRampToValueAtTime(peak, t + Math.max(0.002, a)); }
function releaseEnv(param, t, r, est) {
  if (param.cancelAndHoldAtTime) { try { param.cancelAndHoldAtTime(t); } catch (e) { param.cancelScheduledValues(t); param.setValueAtTime(est, t); } }
  else { param.cancelScheduledValues(t); param.setValueAtTime(est, t); }
  param.setTargetAtTime(0, t, Math.max(0.005, r) / 6);
  return t + Math.max(0.01, r) * 1.3;
}
const vcurve = (v, lo) => lo + (1 - lo) * Math.pow(clamp(v, 0, 1), 1.2);

// ---------------- voice builders ----------------
// Each returns { out:GainNode(amp), nodes:[], sources:[], release(t)->endTime, est }
const V = {};

V.nightpad = (ctx, I, m, vel, t) => {
  const p = I.params, f = midiToHz(m), spread = 4 + p.drift * 22, r = I.rand;
  const merger = ctx.createChannelMerger(2), f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), amp = ctx.createGain();
  const nodes = [merger, f1, f2, amp], sources = [];
  [-1, -0.33, 0.33, 1].forEach((d, i) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d * spread + (r() - 0.5) * 3;
    o.connect(merger, 0, i % 2); sources.push(o);
  });
  const subLvl = p.sub * clamp(1 - (m - 52) / 14, 0, 1);
  if (subLvl > 0.01) {
    const s = ctx.createOscillator(), sg = ctx.createGain(); s.frequency.value = f / 2; sg.gain.value = subLvl * 1.2;
    s.connect(sg); sg.connect(merger, 0, 0); sg.connect(merger, 0, 1); sources.push(s); nodes.push(sg);
  }
  if (p.air > 0.01) {
    const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = noiseBuffer(ctx); n.loop = true; n.loopStart = r(); bp.type = 'bandpass'; bp.frequency.value = Math.min(9000, f * 6); bp.Q.value = 0.9;
    ng.gain.value = p.air * 0.35; n.connect(bp).connect(ng).connect(amp); sources.push(n); nodes.push(bp, ng);
  }
  const cutoff = clamp(expMap(p.glow, 250, 7000) * Math.pow(2, (m - 60) / 30) * (0.75 + 0.35 * vel), 120, 16000);
  const attack = expMap(p.swell, 0.03, 6);
  f1.type = f2.type = 'lowpass'; f1.Q.value = 0.5 + p.resonance * 5; f2.Q.value = 0.5;
  for (const fl of [f1, f2]) { fl.frequency.setValueAtTime(cutoff * 0.45, t); fl.frequency.setTargetAtTime(cutoff, t, attack / 2.5 + 0.05); }
  I.lfoOut.connect(f1.detune); I.lfoOut.connect(f2.detune);
  merger.connect(f1).connect(f2).connect(amp);
  const peak = 0.075 * vcurve(vel, 0.35);
  attackEnv(amp.gain, t, attack, peak);
  return { out: amp, nodes, sources, est: peak, release: tr => releaseEnv(amp.gain, tr, p.release, peak), cleanup() { try { I.lfoOut.disconnect(f1.detune); I.lfoOut.disconnect(f2.detune); } catch (e) { /* */ } } };
};

V.feltpiano = (ctx, I, m, vel, t) => {
  const p = I.params, f = midiToHz(m), r = I.rand;
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), amp = ctx.createGain(), pan = ctx.createStereoPanner();
  const w = pianoWave(ctx); o1.setPeriodicWave(w); o2.setPeriodicWave(w);
  o1.frequency.value = o2.frequency.value = f;
  const u = 0.6 + p.unison * 4.5; o1.detune.value = -u / 2 + (r() - 0.5) * 0.6; o2.detune.value = u / 2;
  const nodes = [lp, amp, pan], sources = [o1, o2];
  const g2 = ctx.createGain(); g2.gain.value = 0.8; o1.connect(lp); o2.connect(g2).connect(lp); nodes.push(g2);
  lp.type = 'lowpass'; lp.Q.value = 0.4;
  const toneK = Math.pow(2, (p.tone - 0.5) * 2.4);
  const bright = clamp(f * (1.6 + 13 * Math.pow(vel, 1.4) * (1 - 0.78 * p.felt)) * toneK, Math.min(f * 1.5, 400), 15000);
  const decayT = (2 + p.sustain * 16) * Math.pow(2, -(m - 60) / 28);
  lp.frequency.setValueAtTime(bright, t);
  lp.frequency.setTargetAtTime(clamp(f * 1.3 + 180, 100, bright), t + 0.01, 0.25 + decayT * 0.08);
  const a = 0.002 + p.felt * 0.012, peak = 0.16 * vcurve(vel, 0.18);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + a);
  amp.gain.setTargetAtTime(peak * 0.45, t + a, 0.18);
  amp.gain.setTargetAtTime(0, t + a + 0.35, decayT / 5);
  o1.connect(lp); // (already connected; harmless duplicate guard removed below)
  o1.disconnect(lp); o1.connect(lp);
  lp.connect(amp).connect(pan);
  pan.pan.value = clamp((m - 64) / 40, -1, 1) * 0.6 * p.width;
  // hammer: a soft felt thud + a little key noise
  if (p.mechanics > 0.01) {
    const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), hg = ctx.createGain(), th = ctx.createBiquadFilter(), tg = ctx.createGain();
    n.buffer = noiseBuffer(ctx); bp.type = 'bandpass'; bp.frequency.value = clamp(f * 2.5, 300, 4500); bp.Q.value = 0.8;
    th.type = 'lowpass'; th.frequency.value = 220;
    const hl = p.mechanics * 0.05 * vel * (1 - 0.5 * p.felt), tl = p.mechanics * 0.12 * vel;
    hg.gain.setValueAtTime(hl, t); hg.gain.setTargetAtTime(0, t + 0.002, 0.01);
    tg.gain.setValueAtTime(0, t); tg.gain.linearRampToValueAtTime(tl, t + 0.004); tg.gain.setTargetAtTime(0, t + 0.004, 0.025);
    n.connect(bp).connect(hg).connect(pan); n.connect(th).connect(tg).connect(pan);
    n.start(t, r() * 1.5); n.stop(t + 0.35);
    nodes.push(bp, hg, th, tg); I.track(n, [bp, hg, th, tg]);
  }
  return { out: pan, nodes, sources, est: peak * 0.4, release: tr => releaseEnv(amp.gain, tr, p.release, peak * 0.4), naturalEnd: t + a + 0.35 + decayT * 1.6 };
};

V.tines = (ctx, I, m, vel, t) => {
  const p = I.params, f = midiToHz(m);
  const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), bell = ctx.createOscillator(), bg = ctx.createGain(), amp = ctx.createGain();
  car.frequency.value = f; mod.frequency.value = f; bell.frequency.value = f * 7.02;
  const idx = (0.6 + p.bark * 2.8) * vel;
  mg.gain.setValueAtTime(f * idx, t); mg.gain.setTargetAtTime(f * idx * 0.15, t, 0.25);
  mod.connect(mg).connect(car.frequency);
  const bl = p.bell * 0.32 * vel * clamp(1.3 - (m - 60) / 40, 0.3, 1.3);
  bg.gain.setValueAtTime(bl, t); bg.gain.setTargetAtTime(0, t, 0.05 + p.bell * 0.12);
  bell.connect(bg).connect(amp); car.connect(amp);
  const decayT = (1.5 + p.decay * 9) * Math.pow(2, -(m - 60) / 30), peak = 0.13 * vcurve(vel, 0.25);
  amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(peak, t + 0.003);
  amp.gain.setTargetAtTime(peak * 0.6, t + 0.003, 0.3); amp.gain.setTargetAtTime(0, t + 0.5, decayT / 5);
  return { out: amp, nodes: [mg, bg, amp], sources: [car, mod, bell], est: peak * 0.5, release: tr => releaseEnv(amp.gain, tr, p.release, peak * 0.5), naturalEnd: t + 0.5 + decayT * 1.6 };
};

V.strings = (ctx, I, m, vel, t) => {
  const p = I.params, f = midiToHz(m), r = I.rand, e = 3 + p.ensemble * 14;
  const merger = ctx.createChannelMerger(2), lp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter(), amp = ctx.createGain();
  const vib = ctx.createOscillator(), vg = ctx.createGain();
  const nodes = [merger, lp, hp, amp, vg], sources = [vib];
  const attack = expMap(p.swell, 0.12, 5);
  vib.frequency.value = p.vibRate * (0.94 + 0.12 * r());
  vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(p.vibrato * 16, t + attack * 0.8 + 0.5);
  vib.connect(vg);
  [[-1, 0], [0, -1], [1, 1]].forEach(([d, ch]) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d * e + (r() - 0.5) * 2;
    vg.connect(o.detune);
    if (ch < 0) { o.connect(merger, 0, 0); o.connect(merger, 0, 1); } else o.connect(merger, 0, ch);
    sources.push(o);
  });
  lp.type = 'lowpass'; lp.frequency.value = clamp(f * (2.5 + p.bow * 8) * (0.8 + 0.3 * vel), 250, 9000); lp.Q.value = 0.6;
  hp.type = 'highpass'; hp.frequency.value = f * 0.6; hp.Q.value = 0.5;
  merger.connect(hp).connect(lp).connect(amp);
  if (p.bow > 0.02) {
    const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = noiseBuffer(ctx); n.loop = true; bp.type = 'bandpass'; bp.frequency.value = clamp(f * 3, 400, 6000); bp.Q.value = 2.5; ng.gain.value = p.bow * 0.25;
    n.connect(bp).connect(ng).connect(amp); sources.push(n); nodes.push(bp, ng);
  }
  const peak = 0.06 * vcurve(vel, 0.35);
  attackEnv(amp.gain, t, attack, peak);
  return { out: amp, nodes, sources, est: peak, release: tr => releaseEnv(amp.gain, tr, p.release, peak) };
};

V.drone = (ctx, I, m, vel, t) => {
  const p = I.params, f = midiToHz(m);
  const s1 = ctx.createOscillator(), s2 = ctx.createOscillator(), tri = ctx.createOscillator(), saw = ctx.createOscillator();
  const g2 = ctx.createGain(), gt = ctx.createGain(), gs = ctx.createGain(), lp = ctx.createBiquadFilter(), amp = ctx.createGain();
  s1.frequency.value = f; s2.frequency.value = f; s2.detune.value = 1.5 + p.motion * 5;
  tri.type = 'triangle'; tri.frequency.value = f * 2; saw.type = 'sawtooth'; saw.frequency.value = f; saw.detune.value = -3;
  g2.gain.value = 0.7; gt.gain.value = 0.15 + p.weight * 0.5; gs.gain.value = p.grit * 0.35;
  s1.connect(lp); s2.connect(g2).connect(lp); tri.connect(gt).connect(lp); saw.connect(gs).connect(lp);
  lp.type = 'lowpass'; lp.frequency.value = expMap(p.tone, 90, 2400); lp.Q.value = 0.7;
  I.lfoOut.connect(lp.detune);
  lp.connect(amp);
  const peak = 0.17 * vcurve(vel, 0.4);
  attackEnv(amp.gain, t, p.attack, peak);
  return { out: amp, nodes: [g2, gt, gs, lp, amp], sources: [s1, s2, tri, saw], est: peak, release: tr => releaseEnv(amp.gain, tr, p.release, peak), cleanup() { try { I.lfoOut.disconnect(lp.detune); } catch (e) { /* */ } } };
};

V.pluck = (ctx, I, m, vel, t) => {
  const p = I.params, f = midiToHz(m);
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain(), lp = ctx.createBiquadFilter(), amp = ctx.createGain();
  o1.type = 'sawtooth'; o2.type = 'triangle'; o1.frequency.value = f; o2.frequency.value = f * 2; g2.gain.value = 0.35;
  const bend = p.bend * 70;
  for (const o of [o1, o2]) { o.detune.setValueAtTime(bend, t); o.detune.setTargetAtTime(0, t + 0.005, 0.035); }
  const decayT = (0.3 + p.decay * 5.5) * Math.pow(2, -(m - 60) / 30);
  const bright = clamp(f * (3 + p.tone * 22) * (0.6 + 0.5 * vel), 300, 14000);
  lp.type = 'lowpass'; lp.Q.value = 0.9;
  lp.frequency.setValueAtTime(bright, t); lp.frequency.setTargetAtTime(clamp(f * 1.4 + 120, 100, bright), t + 0.003, 0.04 + decayT * 0.05);
  o1.connect(lp); o2.connect(g2).connect(lp); lp.connect(amp);
  const peak = 0.12 * vcurve(vel, 0.25);
  amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(peak, t + 0.002); amp.gain.setTargetAtTime(0, t + 0.002, decayT / 5);
  return { out: amp, nodes: [g2, lp, amp], sources: [o1, o2], est: peak * 0.3, release: tr => releaseEnv(amp.gain, tr, p.release, peak * 0.3), naturalEnd: t + decayT * 1.5 };
};

V.textures = (ctx, I, m, vel, t) => {
  const p = I.params, r = I.rand;
  const src = ctx.createBufferSource(), amp = ctx.createGain();
  src.buffer = textureBuffer(ctx, p.texture); src.loop = true;
  src.playbackRate.value = Math.pow(2, (m - 60) / 36);
  src.connect(amp);
  const peak = 0.9 * Math.pow(p.amount, 1.5) * vcurve(vel, 0.3);
  attackEnv(amp.gain, t, p.attack, peak);
  const off = r() * 11;
  return { out: amp, nodes: [amp], sources: [src], est: peak, startOffset: off, release: tr => releaseEnv(amp.gain, tr, p.release, peak) };
};

V.cloud = (ctx, I, m, vel, t) => {
  const p = I.params, amp = ctx.createGain(), pans = [];
  for (let i = 0; i < 4; i++) { const pn = ctx.createStereoPanner(); pn.pan.value = [-0.75, -0.25, 0.25, 0.75][i] * p.width; pn.connect(amp); pans.push(pn); }
  const peak = 0.85 * vcurve(vel, 0.3);
  attackEnv(amp.gain, t, p.attack, peak);
  const v = { out: amp, nodes: [amp, ...pans], sources: [], est: peak, continuous: true, midi: m, t0: t, nextGrain: t, grains: 0, pans,
    release: tr => releaseEnv(amp.gain, tr, p.release, peak) };
  return v;
};

// Grain scheduler for one cloud voice, up to time `until`.
function cloudTick(ctx, I, v, until) {
  const p = I.params, buf = I.env.getSong(p.song);
  const end = Math.min(until, v.end ?? Infinity);
  if (!buf) { v.nextGrain = Math.max(v.nextGrain, end); return; }
  const r = I.rand, dur = buf.duration, size = clamp(p.grain, 0.02, 0.8), dens = clamp(p.density, 0.5, 60);
  const overlap = Math.max(1, dens * size), ga = 0.5 / Math.sqrt(overlap);
  const baseRate = Math.pow(2, (v.midi - p.root) / 12);
  let made = 0;
  while (v.nextGrain < end && made < 400) {
    const gt = Math.max(v.nextGrain, ctx.currentTime + 0.005);
    let rate = baseRate * Math.pow(2, ((r() - 0.5) * 2 * p.pitchSpread * 30) / 1200);
    if (r() < p.octaves * 0.5) rate *= 2;
    const scanPos = p.freeze >= 0.5 ? 0 : (gt - v.t0) * p.scan * 0.5;
    let pos = p.position * dur + scanPos + (r() - 0.5) * 2 * p.spray * 1.5;
    const span = size * rate;
    pos = ((pos % (dur - span)) + (dur - span)) % (dur - span);
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.playbackRate.value = rate;
    const c = new Float32Array(32), a = ga * (0.7 + 0.3 * r());
    for (let i = 0; i < 32; i++) c[i] = a * Math.sin(Math.PI * i / 31) ** 2;
    g.gain.setValueAtTime(0, gt);
    g.gain.setValueCurveAtTime(c, gt, size);
    src.connect(g).connect(v.pans[(v.grains++) % 4]);
    src.start(gt, pos, span + 0.01); src.stop(gt + size + 0.02);
    I.track(src, [g]);
    made++;
    v.nextGrain = gt + (1 / dens) * (0.6 + 0.8 * r());
  }
}

// ---------------- instrument instance ----------------
// env: { getSong(id) -> AudioBuffer|null, requestSong(id), count(node) }
export function createInstrument(ctx, spec, env) {
  const def = instrumentDef(spec && spec.id) || INSTRUMENTS[0];
  const params = resolveParams(def, spec && spec.preset, spec && spec.params);
  const out = ctx.createGain();
  const voices = [];
  let transient = 0; // short-lived helper sources (hammers, grains) still playing
  const I = { def, params, env, rand: rng(1234 + def.id.length * 31), voices, out };
  I.track = (src, extra) => { transient++; src.onended = () => { transient--; try { src.disconnect(); extra.forEach(n => n.disconnect()); } catch (e) { /* */ } }; };

  // instance-level chains
  const inner = ctx.createGain();
  let chain = [], lfo = null;
  I.lfoOut = ctx.createGain(); I.lfoOut.gain.value = 0;
  const startT = ctx.currentTime;
  const addLfo = (freq) => { lfo = ctx.createOscillator(); lfo.frequency.value = freq; lfo.connect(I.lfoOut); lfo.start(startT); };
  if (def.id === 'nightpad') addLfo(params.rate);
  if (def.id === 'drone') addLfo(0.05);
  let tremPan = null, warm = null, body = null, shaper = null, texLp = null, texWidth = null, driftG = null, cloudLp = null, driftLfo = null;
  if (def.id === 'tines') {
    warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.Q.value = 0.5;
    tremPan = ctx.createStereoPanner(); addLfo(params.rate); I.lfoOut.connect(tremPan.pan);
    chain = [warm, tremPan];
  } else if (def.id === 'pluck') {
    body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 330; body.Q.value = 1.1; chain = [body];
  } else if (def.id === 'drone') {
    shaper = ctx.createWaveShaper(); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 28; hp.Q.value = 0.6; chain = [shaper, hp];
  } else if (def.id === 'textures') {
    texLp = ctx.createBiquadFilter(); texLp.type = 'lowpass'; texLp.Q.value = 0.5;
    // width: mid/side matrix via splitter -> gains -> merger
    const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2), ll = ctx.createGain(), lr = ctx.createGain(), rl = ctx.createGain(), rr = ctx.createGain();
    sp.connect(ll, 0); sp.connect(lr, 0); sp.connect(rl, 1); sp.connect(rr, 1);
    ll.connect(mg, 0, 0); rl.connect(mg, 0, 0); lr.connect(mg, 0, 1); rr.connect(mg, 0, 1);
    texWidth = { sp, mg, ll, lr, rl, rr };
    driftG = ctx.createGain(); driftLfo = ctx.createOscillator(); driftLfo.frequency.value = 0.037; const dl = ctx.createGain(); driftLfo.connect(dl).connect(driftG.gain); driftLfo.start(startT); texWidth.dl = dl;
    chain = [texLp, { input: sp, output: mg }, driftG];
  } else if (def.id === 'cloud') {
    cloudLp = ctx.createBiquadFilter(); cloudLp.type = 'lowpass'; cloudLp.Q.value = 0.5;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70; hp.Q.value = 0.6;
    chain = [hp, cloudLp];
  }
  let node = inner;
  for (const c of chain) { node.connect(c.input || c); node = c.output || c; }
  node.connect(out);

  function applyInstance() {
    const p = params, t = ctx.currentTime, set = (prm, v) => { if (ctx._rainOffline) prm.value = v; else prm.setTargetAtTime(v, t, 0.05); };
    if (def.id === 'nightpad') { set(lfo.frequency, p.rate); set(I.lfoOut.gain, p.breath * 1800); }
    if (def.id === 'drone') { set(lfo.frequency, 0.03 + p.motion * 0.12); set(I.lfoOut.gain, p.motion * 900); shaper.curve = tanhCurve(1 + p.grit * 4); }
    if (def.id === 'tines') { set(warm.frequency, expMap(1 - p.warmth, 1400, 11000)); set(lfo.frequency, p.rate); set(I.lfoOut.gain, p.tremolo * 0.75); }
    if (def.id === 'pluck') { set(body.gain, p.body * 8 - 1); }
    if (def.id === 'textures') {
      set(texLp.frequency, expMap(p.tone, 500, 16000));
      const w = clamp(p.width, 0, 1), a = (1 + w) / 2, b = (1 - w) / 2;
      set(texWidth.ll.gain, a); set(texWidth.rr.gain, a); set(texWidth.lr.gain, b); set(texWidth.rl.gain, b);
      set(driftG.gain, 1 - p.drift * 0.35); set(texWidth.dl.gain, p.drift * 0.35); set(driftLfo.frequency, 0.02 + p.drift * 0.06);
    }
    if (def.id === 'cloud') { set(cloudLp.frequency, expMap(p.tone, 900, 18000)); if (env.requestSong) env.requestSong(p.song); }
  }
  applyInstance();

  function cleanupVoice(v) {
    const i = voices.indexOf(v); if (i >= 0) voices.splice(i, 1);
    if (v.cleanup) v.cleanup();
    try { v.out.disconnect(); v.nodes.forEach(n => n.disconnect()); v.sources.forEach(s => s.disconnect()); } catch (e) { /* */ }
  }
  function finish(v, endT) {
    v.end = endT;
    if (v.sources.length) {
      v.sources.forEach(s => { try { s.stop(endT); } catch (e) { /* */ } });
      v.sources[0].onended = () => cleanupVoice(v);
    } else {
      // continuous voices without own sources (cloud): use a silent timer source to know when to clean up
      const k = ctx.createConstantSource(); k.offset.value = 0; k.connect(v.out); k.start(Math.max(ctx.currentTime, v.t0)); k.stop(endT); k.onended = () => cleanupVoice(v); v.sources.push(k);
    }
  }

  I.noteOn = (midi, vel = 0.7, t = ctx.currentTime) => {
    vel = clamp(vel, 0.02, 1);
    // polyphony cap: steal the oldest still-sounding voice
    const live = voices.filter(v => !(v.end <= t));
    if (live.length >= def.maxVoices) { const old = live[0]; if (old.end === undefined || old.end > t + 0.06) { releaseEnv(old.out.gain || old.amp?.gain || old.out.gain, t, 0.05, old.est); finish(old, t + 0.08); } }
    const v = V[def.id](ctx, I, midi, vel, t);
    v.midi = midi; v.t0 = v.t0 ?? t;
    v.out.connect(inner);
    const off = v.startOffset || 0;
    v.sources.forEach((s, i) => s.start(t, s.buffer && i === 0 ? off : undefined));
    voices.push(v);
    if (v.naturalEnd) { v.sources.forEach(s => { try { s.stop(v.naturalEnd + 0.1); } catch (e) { /* */ } }); v.end = v.naturalEnd; v.sources[0].onended = () => cleanupVoice(v); v.natural = true; }
    if (v.continuous) cloudTick(ctx, I, v, t + 0.3);
    return v;
  };
  I.noteOff = (v, t = ctx.currentTime) => {
    if (!v || v.released) return;
    v.released = true;
    const endT = v.release(Math.max(t, v.t0 + 0.005));
    if (v.natural && endT > v.end) return; // decayed by itself before the key was lifted
    finish(v, Math.min(endT, v.natural ? v.end : Infinity));
  };
  I.allOff = (t = ctx.currentTime, hard = false) => { for (const v of voices.slice()) { if (hard) { releaseEnv(v.out.gain, t, 0.03, v.est); v.released = true; finish(v, t + 0.05); } else I.noteOff(v, t); } };
  I.tick = until => { if (def.id !== 'cloud') return; for (const v of voices) if (v.continuous && !(v.end <= ctx.currentTime)) cloudTick(ctx, I, v, until); };
  I.set = (id, value) => {
    const pd = def.params.find(x => x.id === id); if (!pd) return false;
    params[id] = coerce(pd, value);
    applyInstance();
    return true;
  };
  I.voiceCount = () => voices.filter(v => !(v.end <= ctx.currentTime)).length;
  I.transientCount = () => transient;
  I.tail = () => (params.release || 1) * 1.4 + (def.id === 'feltpiano' ? 3 : 0);
  I.dispose = () => {
    I.allOff(ctx.currentTime, true);
    try { lfo && lfo.stop(); driftLfo && driftLfo.stop(); } catch (e) { /* */ }
    setTimeout(() => { try { inner.disconnect(); out.disconnect(); I.lfoOut.disconnect(); chain.forEach(c => (c.output || c).disconnect()); } catch (e) { /* */ } }, 200);
  };
  return I;
}
