// mock-engine.js - a small stand-in for the real sound engine (js/sound/), same API as "Sound engine API" in BRIEF.md.
// Simple Web Audio tones, a convolver "Space" bus, a tape "Echo" bus, a soft limiter. The UI is built against this;
// the integrator swaps in the real engine (see js/ui/engine.js). Not meant to sound finished.
import { makeImpulse, REVERB_PRESETS } from '../../lib/reverb.js';
import { SONGS, loadSong } from '../../lib/songs.js';
import { SAMPLE_PROJECT } from './sample-project.js';

const dbToGain = db => (db <= -60 ? 0 : Math.pow(10, db / 20));
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const M = (id, name, min, max, def, unit = '') => ({ id, name, min, max, default: def, unit });

const SONG_OPTIONS = SONGS.map(s => ({ id: s.id, name: s.title }));
const INSTRUMENTS = [
  { id: 'dream-pad', name: 'Dream Pad', kind: 'synth',
    presets: [{ id: 'morning', name: 'Morning glow' }, { id: 'wide', name: 'Wide horizon' }, { id: 'dark', name: 'Dusk' }],
    macros: [M('tone', 'Tone', 0, 1, 0.45), M('attack', 'Swell', 0.01, 4, 1.2, 's'), M('release', 'Fade', 0.1, 8, 3, 's'), M('detune', 'Width', 0, 30, 9, 'ct')], params: [] },
  { id: 'felt-piano', name: 'Felt Piano', kind: 'synth',
    presets: [{ id: 'felt', name: 'Soft felt' }, { id: 'upright', name: 'Old upright' }],
    macros: [M('tone', 'Felt', 0, 1, 0.35), M('release', 'Sustain', 0.3, 6, 2.4, 's'), M('detune', 'Wobble', 0, 20, 4, 'ct')], params: [] },
  { id: 'glass-bells', name: 'Glass Bells', kind: 'synth',
    presets: [{ id: 'music-box', name: 'Music box' }, { id: 'glass', name: 'Glass' }],
    macros: [M('tone', 'Shine', 0, 1, 0.6), M('release', 'Ring', 0.5, 8, 3.5, 's'), M('ratio', 'Metal', 1, 4, 2.76)], params: [] },
  { id: 'sub-drone', name: 'Sub Drone', kind: 'synth',
    presets: [{ id: 'floor', name: 'Floor' }, { id: 'hum', name: 'Warm hum' }],
    macros: [M('tone', 'Body', 0, 1, 0.3), M('attack', 'Rise', 0.1, 6, 2, 's'), M('release', 'Fall', 0.5, 8, 4, 's')], params: [] },
  { id: 'koto-pluck', name: 'Koto Pluck', kind: 'synth',
    presets: [{ id: 'koto', name: 'Koto' }, { id: 'harp', name: 'Paper harp' }],
    macros: [M('tone', 'Bright', 0, 1, 0.5), M('release', 'Decay', 0.1, 3, 0.8, 's')], params: [] },
  { id: 'noise-texture', name: 'Noise Texture', kind: 'texture',
    presets: [{ id: 'night-rain', name: 'Night rain' }, { id: 'tape', name: 'Tape hiss' }, { id: 'wind', name: 'Wind' }],
    macros: [M('tone', 'Colour', 0, 1, 0.5), M('attack', 'Swell', 0.05, 6, 2, 's'), M('release', 'Fade', 0.2, 8, 3, 's')], params: [] },
  { id: 'song-cloud', name: 'Song Cloud', kind: 'granular',
    presets: [{ id: 'haze', name: 'Haze' }, { id: 'frozen', name: 'Frozen moment' }],
    macros: [M('grain', 'Grain', 0.04, 0.6, 0.22, 's'), M('density', 'Density', 2, 30, 12, '/s'), M('position', 'Position', 0, 1, 0.35), M('spray', 'Spray', 0, 0.2, 0.03)],
    params: [{ id: 'songId', name: 'Song', options: SONG_OPTIONS, default: 'infinite-love' }, M('freeze', 'Freeze', 0, 1, 0)] },
];
const REVERB_TYPES = ['room', 'plate', 'hall', 'cathedral', 'shimmer', 'infinite', 'reverse'].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1) }));
const EFFECTS = [
  { id: 'reverb', name: 'Reverb', params: [{ id: 'type', name: 'Type', options: REVERB_TYPES, default: 'hall' }, M('mix', 'Mix', 0, 1, 1), M('tone', 'Tone', 0, 1, 0.5)] },
  { id: 'shimmer', name: 'Shimmer Verb', params: [{ id: 'type', name: 'Type', options: REVERB_TYPES, default: 'hall' }, M('mix', 'Mix', 0, 1, 0.35), M('tone', 'Tone', 0, 1, 0.55), M('shimmer', 'Shimmer', 0, 1, 0.55)] },
  { id: 'tape-delay', name: 'Tape Delay', params: [M('time', 'Time', 0.05, 1.5, 0.48, 's'), M('feedback', 'Repeats', 0, 0.9, 0.45), M('tone', 'Tone', 0, 1, 0.4), M('mix', 'Mix', 0, 1, 1)] },
  { id: 'filter', name: 'Filter', params: [M('cutoff', 'Cutoff', 80, 16000, 4000, 'Hz'), M('q', 'Reso', 0.1, 12, 0.7)] },
  { id: 'saturate', name: 'Tape Saturation', params: [M('drive', 'Drive', 0, 1, 0.3), M('mix', 'Mix', 0, 1, 0.6)] },
  { id: 'tremolo', name: 'Tremolo', params: [M('rate', 'Rate', 0.05, 8, 0.6, 'Hz'), M('depth', 'Depth', 0, 1, 0.35)] },
];
const inst = id => INSTRUMENTS.find(i => i.id === id) || INSTRUMENTS[0];
const P = (track, id) => {
  const p = track.instrument?.params || {}; if (p[id] !== undefined) return p[id];
  const d = inst(track.instrument?.id); return ([...d.macros, ...d.params].find(m => m.id === id) || {}).default;
};
const fxDef = id => EFFECTS.find(e => e.id === id);
const fxP = (fx, id) => (fx.params && fx.params[id] !== undefined ? fx.params[id] : (fxDef(fx.id)?.params.find(p => p.id === id) || {}).default);

let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0; for (let i = 0; i < d.length; i++) { last = last * 0.6 + (Math.random() * 2 - 1) * 0.4; d[i] = last; }
  return (noiseBuf = b);
}

export async function createEngine({ context }) {
  const ctx = context;
  const offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
  let project = null;
  const tracks = new Map();        // id -> {input, fader, pan, sendS, sendE, meter, fxSig, fxNodes, def}
  const songs = new Map();         // id -> AudioBuffer
  const voices = new Set();
  const live = new Map();          // `${track}:${midi}` -> voice

  // master
  const masterIn = ctx.createGain();
  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 20; limiter.attack.value = 0.004; limiter.release.value = 0.3;
  const ceiling = ctx.createGain(); ceiling.gain.value = dbToGain(-1);
  const analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.8;
  masterIn.connect(master).connect(limiter).connect(ceiling).connect(analyser).connect(ctx.destination);
  // buses
  const spaceIn = ctx.createGain(), conv = ctx.createConvolver(), spaceTone = ctx.createBiquadFilter(), spaceOut = ctx.createGain();
  spaceTone.type = 'lowpass'; spaceTone.frequency.value = 6000;
  spaceIn.connect(conv).connect(spaceTone).connect(spaceOut).connect(masterIn);
  const echoIn = ctx.createGain(), delay = ctx.createDelay(2), fb = ctx.createGain(), echoTone = ctx.createBiquadFilter(), echoOut = ctx.createGain();
  echoTone.type = 'lowpass'; echoTone.frequency.value = 2600;
  echoIn.connect(delay).connect(echoTone).connect(fb).connect(delay); echoTone.connect(echoOut).connect(masterIn);
  echoOut.connect(spaceIn); // echoes bloom into the reverb
  let reverbKey = '';

  function applyBuses() {
    const rv = project.buses?.space?.fx?.[0] || { id: 'reverb', params: {} };
    const type = fxP(rv, 'type') || 'hall';
    if (type !== reverbKey) { reverbKey = type; conv.buffer = makeImpulse(ctx, REVERB_PRESETS[type] || REVERB_PRESETS.hall); }
    const atm = project.master?.atmosphere ?? 0.5;
    spaceTone.frequency.value = 1500 + 9000 * fxP(rv, 'tone');
    spaceOut.gain.value = fxP(rv, 'mix') * (0.5 + atm) * dbToGain(project.buses?.space?.returnDb ?? 0);
    const ec = project.buses?.echo?.fx?.[0] || { id: 'tape-delay', params: {} };
    delay.delayTime.setTargetAtTime(fxP(ec, 'time'), ctx.currentTime, 0.05);
    fb.gain.value = clamp(fxP(ec, 'feedback'), 0, 0.92);
    echoTone.frequency.value = 800 + 6000 * fxP(ec, 'tone');
    echoOut.gain.value = fxP(ec, 'mix') * (0.5 + atm) * dbToGain(project.buses?.echo?.returnDb ?? 0);
    master.gain.value = dbToGain(project.master?.volumeDb ?? 0);
  }

  function buildFx(t, fxList) {
    t.input.disconnect(); t.fxNodes.forEach(n => n.out.disconnect());
    let prev = t.input; t.fxNodes = [];
    fxList.forEach(fx => {
      if (fx.bypass) return;
      let node;
      if (fx.id === 'filter') { const f = ctx.createBiquadFilter(); f.frequency.value = fxP(fx, 'cutoff'); f.Q.value = fxP(fx, 'q'); node = { in: f, out: f, set: (k, v) => (k === 'cutoff' ? f.frequency : f.Q).setTargetAtTime(v, ctx.currentTime, 0.03) }; }
      else if (fx.id === 'saturate') {
        const ws = ctx.createWaveShaper(), dry = ctx.createGain(), wet = ctx.createGain(), inn = ctx.createGain(), out = ctx.createGain();
        const curve = d => { const c = new Float32Array(1024), k = 1 + d * 20; for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); } return c; };
        ws.curve = curve(fxP(fx, 'drive')); wet.gain.value = fxP(fx, 'mix'); dry.gain.value = 1 - fxP(fx, 'mix');
        inn.connect(dry).connect(out); inn.connect(ws).connect(wet).connect(out);
        node = { in: inn, out, set: (k, v) => { if (k === 'drive') ws.curve = curve(v); else { wet.gain.value = v; dry.gain.value = 1 - v; } } };
      } else if (fx.id === 'tremolo') {
        const g = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
        lfo.frequency.value = fxP(fx, 'rate'); depth.gain.value = fxP(fx, 'depth') * 0.5; g.gain.value = 1 - fxP(fx, 'depth') * 0.5;
        lfo.connect(depth).connect(g.gain); lfo.start();
        node = { in: g, out: g, set: (k, v) => { if (k === 'rate') lfo.frequency.value = v; else { depth.gain.value = v * 0.5; g.gain.value = 1 - v * 0.5; } } };
      } else if (fx.id === 'tape-delay' || fx.id === 'reverb' || fx.id === 'shimmer') {
        const inn = ctx.createGain(), out = ctx.createGain(), wet = ctx.createGain(), dry = ctx.createGain();
        let core;
        if (fx.id !== 'tape-delay') { core = ctx.createConvolver(); core.buffer = makeImpulse(ctx, REVERB_PRESETS[fxP(fx, 'type')] || REVERB_PRESETS.hall); inn.connect(core).connect(wet); }
        else { core = ctx.createDelay(2); const f = ctx.createGain(); core.delayTime.value = fxP(fx, 'time'); f.gain.value = fxP(fx, 'feedback'); inn.connect(core).connect(wet); core.connect(f).connect(core); core._fb = f; }
        wet.gain.value = fxP(fx, 'mix') * 0.6; dry.gain.value = 1; inn.connect(dry).connect(out); wet.connect(out);
        node = { in: inn, out, set: (k, v) => { if (k === 'mix') wet.gain.value = v * 0.6; else if (k === 'time') core.delayTime.value = v; else if (k === 'feedback') core._fb.gain.value = v; else if (k === 'type') core.buffer = makeImpulse(ctx, REVERB_PRESETS[v] || REVERB_PRESETS.hall); } };
      } else return;
      node.fx = fx; prev.connect(node.in); prev = node.out; t.fxNodes.push(node);
    });
    prev.connect(t.fader);
  }

  function applyTrack(t, tr, anySolo) {
    const audible = !tr.mute && (!anySolo || tr.solo);
    t.fader.gain.setTargetAtTime(audible ? dbToGain(tr.volumeDb ?? 0) : 0, ctx.currentTime, 0.02);
    t.pan.pan.value = clamp(tr.pan || 0, -1, 1);
    t.sendS.gain.value = tr.sends?.space ?? 0.4;
    t.sendE.gain.value = tr.sends?.echo ?? 0;
  }

  async function load(p) {
    project = JSON.parse(JSON.stringify(p));
    const anySolo = project.tracks.some(t => t.solo);
    const ids = new Set(project.tracks.map(t => t.id));
    for (const [id, t] of tracks) if (!ids.has(id)) { t.pan.disconnect(); tracks.delete(id); }
    for (const tr of project.tracks) {
      let t = tracks.get(tr.id);
      if (!t) {
        t = { input: ctx.createGain(), fader: ctx.createGain(), pan: ctx.createStereoPanner(), sendS: ctx.createGain(), sendE: ctx.createGain(), meter: ctx.createAnalyser(), fxNodes: [], fxSig: null };
        t.meter.fftSize = 512; t.input.connect(t.fader); t.fader.connect(t.pan); t.pan.connect(masterIn);
        t.pan.connect(t.sendS).connect(spaceIn); t.pan.connect(t.sendE).connect(echoIn); t.pan.connect(t.meter);
        tracks.set(tr.id, t);
      }
      t.def = tr;
      const sig = JSON.stringify((tr.fx || []).map(f => [f.id, !!f.bypass]));
      if (sig !== t.fxSig) { t.fxSig = sig; buildFx(t, tr.fx || []); }
      else t.fxNodes.forEach(n => { const now = (tr.fx || []).find((f, i) => f.id === n.fx.id); if (now) { for (const k in now.params) if (now.params[k] !== n.fx.params?.[k]) n.set(k, now.params[k]); n.fx = JSON.parse(JSON.stringify(now)); } });
      applyTrack(t, tr, anySolo);
    }
    applyBuses();
    const need = new Set();
    project.tracks.forEach(tr => { if (tr.instrument?.id === 'song-cloud') need.add(P(tr, 'songId')); tr.clips.forEach(c => c.song?.songId && need.add(c.song.songId)); });
    await Promise.all([...need].filter(id => id && !songs.has(id)).map(id => loadSong(ctx, id).then(b => songs.set(id, b)).catch(() => {})));
  }

  // ------------------------------------------------------------- voices
  const maxVoices = 56;
  function voice(tr, midi, vel, t0, dur) {
    const t = tracks.get(tr.id); if (!t) return null;
    const now = ctx.currentTime;
    for (const v of voices) if (v.end < now) voices.delete(v);
    if (voices.size >= maxVoices) return null;
    const id = tr.instrument?.id, preset = tr.instrument?.preset;
    const out = ctx.createGain(); out.gain.value = 0; out.connect(t.input);
    const nodes = [];
    const tone = P(tr, 'tone') ?? 0.5, f = mtof(midi);
    let atk = 0.01, rel = P(tr, 'release') ?? 1, peak = 0.2 * vel, sustain = 1;
    const osc = (type, freq, det = 0, g = 1, dest = out) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = det; const gg = ctx.createGain(); gg.gain.value = g; o.connect(gg).connect(dest); nodes.push(o); return o; };
    if (id === 'dream-pad') {
      const lp = ctx.createBiquadFilter(); lp.frequency.value = 300 + tone * 3200 * (preset === 'dark' ? 0.5 : 1); lp.Q.value = 0.3; lp.connect(out);
      const d = P(tr, 'detune'); osc('sawtooth', f, -d, 0.5, lp); osc('sawtooth', f, d, 0.5, lp); if (preset === 'wide') osc('triangle', f / 2, 0, 0.5, lp);
      atk = P(tr, 'attack'); peak = 0.07 * vel;
    } else if (id === 'felt-piano') {
      const lp = ctx.createBiquadFilter(); lp.frequency.value = 600 + tone * 3000; lp.connect(out);
      osc('triangle', f, P(tr, 'detune') * (Math.random() - 0.5), 0.8, lp); osc('sine', f * 2, 0, 0.2, lp);
      atk = 0.006; sustain = 0.0; peak = 0.22 * vel;
    } else if (id === 'glass-bells') {
      osc('sine', f, 0, 0.7); const o2 = osc('sine', f * P(tr, 'ratio'), 0, 0.15 + 0.3 * tone); if (preset === 'music-box') o2.frequency.value = f * 4;
      atk = 0.003; sustain = 0; peak = 0.12 * vel;
    } else if (id === 'sub-drone') {
      osc('sine', f, 0, 0.8); osc('triangle', f * 1.5, 0, 0.12 * tone); atk = P(tr, 'attack'); peak = 0.16 * vel;
    } else if (id === 'koto-pluck') {
      const lp = ctx.createBiquadFilter(); lp.frequency.setValueAtTime(800 + tone * 6000, t0); lp.frequency.exponentialRampToValueAtTime(300, t0 + 0.6); lp.connect(out);
      osc(preset === 'harp' ? 'triangle' : 'square', f, 0, 0.5, lp); atk = 0.002; sustain = 0; peak = 0.12 * vel;
    } else if (id === 'noise-texture') {
      const src = ctx.createBufferSource(); src.buffer = noise(ctx); src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = preset === 'wind' ? 'bandpass' : 'highpass'; bp.frequency.value = preset === 'tape' ? 6000 : 400 + tone * 3000; bp.Q.value = preset === 'wind' ? 2 : 0.5;
      src.connect(bp).connect(out); nodes.push(src); atk = P(tr, 'attack'); peak = 0.06 * vel;
      if (preset === 'night-rain') { bp.frequency.value = 1800 + tone * 2500; const hum = osc('sine', 55, 0, 0.5, out); const hum2 = osc('sine', 110.4, 0, 0.18, out); void hum; void hum2; }
    } else if (id === 'song-cloud') {
      const buf = songs.get(P(tr, 'songId')); if (!buf) { out.disconnect(); return null; }
      atk = 0.4; peak = 0.5 * vel; rel = 2;
      const grain = P(tr, 'grain'), dens = P(tr, 'density'), pos = P(tr, 'position'), spray = P(tr, 'spray'), rate = Math.pow(2, (midi - 60) / 12);
      const span = Math.min(dur ?? 8, 30) + rel;
      for (let g = 0; g < span * dens && g < 400; g++) {
        const at = t0 + g / dens + Math.random() * 0.02;
        const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
        const e = ctx.createGain(); e.gain.value = 0; e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(0.35, at + grain / 2); e.gain.linearRampToValueAtTime(0, at + grain);
        s.connect(e).connect(out); const off = clamp((pos + (Math.random() - 0.5) * 2 * spray) * buf.duration, 0, buf.duration - grain * 2);
        s.start(at, off, grain * rate + 0.01); nodes.push(s);
      }
    } else { osc('sine', f, 0, 1); }
    const g = out.gain; g.setValueAtTime(0, t0); g.linearRampToValueAtTime(peak, t0 + atk);
    if (sustain === 0) g.setTargetAtTime(0, t0 + atk, rel / 4);
    nodes.forEach(n => { if (n.start && !n.buffer) n.start(t0); else if (n.loop) n.start(t0); });
    const v = { out, nodes, end: Infinity, release(at) { const T = Math.max(at, ctx.currentTime); if (T > ctx.currentTime + 0.02) g.setTargetAtTime(0, T, rel / 4); else { g.cancelScheduledValues(T); g.setValueAtTime(g.value, T); g.setTargetAtTime(0, T, sustain ? rel / 4 : 0.08); } this.end = T + rel * 1.6; nodes.forEach(n => { try { n.stop(this.end); } catch {} }); } };
    if (sustain) { /* held */ } else if (dur === undefined) v.end = t0 + rel * 2;
    if (dur !== undefined) { if (sustain) { g.setValueAtTime(peak, Math.max(t0 + atk, t0 + dur)); } v.release(t0 + Math.max(dur, atk)); }
    voices.add(v); return v;
  }

  function songClip(tr, clip, when, intoSec) {
    const t = tracks.get(tr.id), s = clip.song, buf = songs.get(s?.songId); if (!t || !buf) return;
    const bps = project.bpm / 60, len = clip.lengthBeats / bps, rate = s.rate || 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const g = ctx.createGain(), gain = dbToGain(s.gainDb ?? 0), fi = s.fadeInSec || 0, fo = s.fadeOutSec || 0;
    const t0 = when - intoSec;
    g.gain.setValueAtTime(fi > intoSec ? 0 : gain, when);
    if (fi > intoSec) g.gain.linearRampToValueAtTime(gain, t0 + fi);
    g.gain.setValueAtTime(gain, Math.max(when, t0 + len - fo)); g.gain.linearRampToValueAtTime(0, t0 + len);
    src.connect(g).connect(t.input);
    const off = (s.offsetSec || 0) + intoSec * rate;
    if (off >= buf.duration) return;
    src.start(when, off); src.stop(t0 + len + 0.05);
    voices.add({ out: g, nodes: [src], end: t0 + len, release(at) { g.gain.cancelScheduledValues(at); g.gain.setTargetAtTime(0, at, 0.05); try { src.stop(at + 0.3); } catch {} this.end = at + 0.3; } });
  }

  // Schedule everything that starts in [b0, b1) at time t(beat) = tAt + (beat - b0) / bps. segStart: also pick up notes already sounding.
  function scheduleRange(b0, b1, tAt, segStart) {
    const bps = project.bpm / 60, anySolo = project.tracks.some(t => t.solo);
    for (const tr of project.tracks) {
      if (tr.mute || (anySolo && !tr.solo)) continue;
      for (const c of tr.clips) {
        const cs = c.startBeat, ce = c.startBeat + c.lengthBeats;
        if (ce <= b0 || cs >= b1) continue;
        if (tr.kind === 'song' || c.song) {
          if (cs >= b0) songClip(tr, c, tAt + (cs - b0) / bps, 0);
          else if (segStart) songClip(tr, c, tAt, (b0 - cs) / bps);
          continue;
        }
        for (const n of c.notes || []) {
          const ns = cs + n.s; if (n.s >= c.lengthBeats) continue;
          const d = Math.min(n.d, c.lengthBeats - n.s);
          if (ns >= b0 && ns < b1) voice(tr, n.p, n.v ?? 0.8, tAt + (ns - b0) / bps, d / bps);
          else if (segStart && ns < b0 && ns + d > b0 + 0.05) voice(tr, n.p, (n.v ?? 0.8) * 0.8, tAt, (ns + d - b0) / bps);
        }
      }
    }
  }

  // ------------------------------------------------------------- transport (lookahead)
  let timer = null, playing = false, segs = [], cursorBeat = 0, cursorTime = 0, loop = { on: false, startBeat: 0, endBeat: 16 };
  const songEnd = () => project.lengthBars * (project.beatsPerBar || 4);
  function tick() {
    const bps = project.bpm / 60, horizon = ctx.currentTime + 0.25;
    let guard = 0;
    while (cursorTime < horizon && guard++ < 8) {
      let end = cursorBeat + Math.max(0.25, (horizon - cursorTime) * bps), wrap = false;
      if (loop.on && loop.endBeat > loop.startBeat && cursorBeat < loop.endBeat && end >= loop.endBeat) { end = loop.endBeat; wrap = true; }
      const first = segs.length && segs[segs.length - 1].time === cursorTime && segs[segs.length - 1].fresh;
      if (first) segs[segs.length - 1].fresh = false;
      scheduleRange(cursorBeat, end, cursorTime, first);
      cursorTime += (end - cursorBeat) / bps;
      if (wrap) { cursorBeat = loop.startBeat; segs.push({ time: cursorTime, beat: cursorBeat, fresh: true }); if (segs.length > 4) segs.shift(); }
      else cursorBeat = end;
    }
    if (!loop.on && position().beat > songEnd() + 0.5) stop();
  }
  function play(fromBeat = 0) {
    if (!project) return;
    stop(true);
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    playing = true; cursorBeat = fromBeat; cursorTime = ctx.currentTime + 0.06;
    segs = [{ time: cursorTime, beat: fromBeat, fresh: true }];
    tick(); timer = setInterval(tick, 40);
  }
  function stop(quiet) {
    clearInterval(timer); timer = null;
    const now = ctx.currentTime; voices.forEach(v => v.release(now)); voices.clear();
    if (playing && !quiet) { const p = position(); lastBeat = p.beat; }
    playing = false;
  }
  let lastBeat = 0;
  function position() {
    if (!playing || !project) return { beat: lastBeat, seconds: lastBeat * 60 / (project?.bpm || 70), playing: false };
    const now = ctx.currentTime, bps = project.bpm / 60;
    let s = segs[0]; for (const x of segs) if (x.time <= now) s = x;
    const beat = Math.max(0, s.beat + (now - s.time) * bps);
    return { beat, seconds: beat / bps, playing: true };
  }

  const engine = {
    instruments: INSTRUMENTS, effects: EFFECTS, demo: SAMPLE_PROJECT, isMock: true,
    analyser, output: ceiling, context: ctx,
    load,
    applyChange(p, change) { return load(p); },
    play, stop: () => stop(false),
    seek(beat) { if (playing) play(beat); else lastBeat = beat; },
    setLoop(on, s, e) { loop = { on: !!on, startBeat: s, endBeat: e }; },
    position,
    noteOn(trackId, midi, vel = 0.8) {
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      const tr = project?.tracks.find(t => t.id === trackId); if (!tr || tr.kind === 'song') return;
      const k = trackId + ':' + midi; live.get(k)?.release(ctx.currentTime);
      const v = voice(tr, midi, vel, ctx.currentTime + 0.005); if (v) live.set(k, v);
    },
    noteOff(trackId, midi) { const k = trackId + ':' + midi; const v = live.get(k); if (v) { v.release(ctx.currentTime); live.delete(k); } },
    setParam(target, id, value) {
      if (!project) return;
      if (target.master) { project.master[id] = value; applyBuses(); return; }
      if (target.bus && target.fx === undefined) { project.buses[target.bus][id] = value; applyBuses(); return; }
      if (target.bus) { const fx = project.buses[target.bus].fx[target.fx ?? 0]; if (fx) { fx.params = { ...fx.params, [id]: value }; applyBuses(); } return; }
      const tr = project.tracks.find(t => t.id === target.track); if (!tr) return; const t = tracks.get(tr.id);
      if (target.fx !== undefined) { const fx = tr.fx[target.fx]; if (!fx) return; fx.params = { ...fx.params, [id]: value }; const n = t.fxNodes.find(n => n.fx === fx || n.fx.id === fx.id); n?.set(id, value); return; }
      if (id === 'volumeDb' || id === 'pan' || id === 'mute' || id === 'solo') { tr[id] = value; const anySolo = project.tracks.some(x => x.solo); project.tracks.forEach(x => applyTrack(tracks.get(x.id), x, anySolo)); return; }
      if (/^(sends?\.)?(space|echo)$/.test(id)) { tr.sends[id.replace(/^sends?\./, '')] = value; applyTrack(t, tr, project.tracks.some(x => x.solo)); return; }
      tr.instrument.params = { ...tr.instrument.params, [id]: value };
      if (id === 'songId' && !songs.has(value)) loadSong(ctx, value).then(b => songs.set(value, b)).catch(() => {});
    },
    meter(trackId) {
      const t = tracks.get(trackId); if (!t) return { peakDb: -Infinity, rmsDb: -Infinity };
      const a = t._buf || (t._buf = new Float32Array(t.meter.fftSize)); t.meter.getFloatTimeDomainData(a);
      let pk = 0, s = 0; for (let i = 0; i < a.length; i++) { const x = Math.abs(a[i]); if (x > pk) pk = x; s += x * x; }
      return { peakDb: 20 * Math.log10(pk || 1e-9), rmsDb: 10 * Math.log10(s / a.length || 1e-18) };
    },
    async render(p, { tailSeconds = 6 } = {}) {
      const beats = p.lengthBars * (p.beatsPerBar || 4), secs = beats * 60 / p.bpm + tailSeconds;
      const off = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(secs * 44100), sampleRate: 44100 });
      const e2 = await createEngine({ context: off });
      const q = JSON.parse(JSON.stringify(p)); q.loop = { ...q.loop, on: false };
      await e2.load(q); e2._scheduleAll(beats);
      return off.startRendering();
    },
    _scheduleAll(beats) { scheduleRange(0, beats, 0.02, true); },
    dispose() { stop(true); try { masterIn.disconnect(); ceiling.disconnect(); analyser.disconnect(); } catch {} },
  };
  void offline;
  return engine;
}
