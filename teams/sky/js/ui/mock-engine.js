// mock-engine.js - a small stand-in for the musician's sound engine (js/sound/). Same API as "Sound engine API" in
// shared/BRIEF.md, simple Web Audio voices, so the UI can be built and tested before the real engine lands.
// The integrator swaps it for js/sound/ (see js/engine-host.js). Not meant to sound finished.
import { makeImpulse, REVERB_PRESETS } from '../../lib/reverb.js';
import { loadSong } from '../../lib/songs.js';
import { sampleProject } from './sample-project.js';

const M = (id, name, d = 0.5) => ({ id, name, min: 0, max: 1, default: d });
const P = (...a) => a.map(([id, name]) => ({ id, name }));
export const INSTRUMENTS = [
  { id: 'dream-pad', name: 'Dream pad', kind: 'synth', presets: P(['first-light', 'First light'], ['high-cirrus', 'High cirrus'], ['warm-haze', 'Warm haze']), macros: [M('bright', 'Bright', 0.45), M('swell', 'Swell', 0.6), M('drift', 'Drift', 0.4)], params: [] },
  { id: 'felt-piano', name: 'Felt piano', kind: 'keys', presets: P(['soft-felt', 'Soft felt'], ['upright', 'Upright'], ['far-room', 'Far room']), macros: [M('tone', 'Tone', 0.4), M('felt', 'Felt', 0.7), M('room', 'Room', 0.5)], params: [] },
  { id: 'glass-bells', name: 'Glass bells', kind: 'bells', presets: P(['high-glass', 'High glass'], ['music-box', 'Music box']), macros: [M('shine', 'Shine', 0.6), M('decay', 'Decay', 0.6)], params: [] },
  { id: 'choir-air', name: 'Choir air', kind: 'voice', presets: P(['breath', 'Breath'], ['ooh', 'Ooh']), macros: [M('vowel', 'Vowel', 0.4), M('air', 'Air', 0.6)], params: [] },
  { id: 'bowed-strings', name: 'Bowed strings', kind: 'strings', presets: P(['slow-bow', 'Slow bow'], ['tremolo', 'Tremolo']), macros: [M('bow', 'Bow', 0.5), M('warmth', 'Warmth', 0.6)], params: [] },
  { id: 'sub-drone', name: 'Sub drone', kind: 'drone', presets: P(['deep', 'Deep'], ['tide', 'Tide']), macros: [M('depth', 'Depth', 0.6), M('motion', 'Motion', 0.3)], params: [] },
  { id: 'pluck', name: 'Koto pluck', kind: 'pluck', presets: P(['koto', 'Koto'], ['harp', 'Harp']), macros: [M('pluck', 'Pluck', 0.5), M('tone', 'Tone', 0.5)], params: [] },
  { id: 'noise-texture', name: 'Sky textures', kind: 'noise', presets: P(['wind', 'Wind'], ['rain', 'Rain'], ['ocean', 'Ocean'], ['vinyl', 'Vinyl']), macros: [M('texture', 'Texture', 0.4), M('motion', 'Motion', 0.6)], params: [] },
  { id: 'song-cloud', name: 'Song cloud', kind: 'granular', presets: P(['halo', 'Halo'], ['frozen', 'Frozen']), macros: [M('grain', 'Grain', 0.5), M('density', 'Density', 0.6), M('position', 'Position', 0.35), M('spray', 'Spray', 0.3), M('freeze', 'Freeze', 0)], params: [{ id: 'songId', name: 'Song', type: 'song' }] },
];
const REV_TYPES = ['Room', 'Plate', 'Cathedral', 'Hall', 'Infinite', 'Shimmer', 'Reverse'];
export const EFFECTS = [
  { id: 'reverb', name: 'Reverb', params: [{ id: 'type', name: 'Type', min: 0, max: REV_TYPES.length - 1, default: 2, step: 1, options: REV_TYPES }, { id: 'decay', name: 'Decay', min: 0.5, max: 20, default: 6, unit: 's' }, { id: 'tone', name: 'Tone', min: 0, max: 1, default: 0.5 }, { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.35 }] },
  { id: 'tape-delay', name: 'Tape echo', params: [{ id: 'time', name: 'Time', min: 0.125, max: 2, default: 0.75, unit: 'beats' }, { id: 'feedback', name: 'Feedback', min: 0, max: 0.9, default: 0.4 }, { id: 'tone', name: 'Tone', min: 0, max: 1, default: 0.5 }] },
  { id: 'soft-filter', name: 'Soft filter', params: [{ id: 'cutoff', name: 'Cutoff', min: 200, max: 16000, default: 6000, unit: 'Hz', curve: 'log' }, { id: 'res', name: 'Reso', min: 0, max: 1, default: 0.15 }] },
  { id: 'chorus', name: 'Chorus', params: [{ id: 'rate', name: 'Rate', min: 0.05, max: 3, default: 0.4, unit: 'Hz' }, { id: 'depth', name: 'Depth', min: 0, max: 1, default: 0.5 }, { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.4 }] },
  { id: 'tremolo', name: 'Tremolo', params: [{ id: 'rate', name: 'Rate', min: 0.1, max: 8, default: 2, unit: 'Hz' }, { id: 'depth', name: 'Depth', min: 0, max: 1, default: 0.4 }] },
  { id: 'warmth', name: 'Warmth', params: [{ id: 'drive', name: 'Drive', min: 0, max: 1, default: 0.3 }] },
];

const dbToGain = db => Math.pow(10, db / 20);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  if (!noiseCache.has(ctx)) { const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; noiseCache.set(ctx, b); }
  return noiseCache.get(ctx);
}
function reverbIR(ctx, p = {}) {
  const t = REV_TYPES[Math.round(p.type ?? 2)] || 'Cathedral';
  const base = { Room: REVERB_PRESETS.room, Plate: REVERB_PRESETS.plate, Cathedral: REVERB_PRESETS.cathedral, Hall: REVERB_PRESETS.hall, Infinite: REVERB_PRESETS.infinite, Shimmer: REVERB_PRESETS.cathedral, Reverse: REVERB_PRESETS.reverse }[t];
  const decay = Math.round(clamp(p.decay ?? base.decay, 0.5, 20) * 2) / 2;
  return makeImpulse(ctx, { ...base, decay, seconds: Math.min(16, Math.max(base.seconds, decay * 1.1)), damping: 0.2 + 0.6 * (1 - (p.tone ?? 0.5)) });
}

export async function createEngine({ context }) {
  const ctx = context, offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
  const out = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  Object.entries({ threshold: -3, knee: 2, ratio: 20, attack: 0.002, release: 0.3 }).forEach(([k, v]) => limiter[k].value = v);
  const analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.82;
  out.connect(limiter); limiter.connect(analyser); analyser.connect(ctx.destination);
  const spaceIn = ctx.createGain(), conv = ctx.createConvolver(), spaceOut = ctx.createGain();
  spaceIn.connect(conv); conv.connect(spaceOut); spaceOut.connect(out);
  const echoIn = ctx.createGain(), dly = ctx.createDelay(4), fb = ctx.createGain(), echoTone = ctx.createBiquadFilter(), echoOut = ctx.createGain();
  echoTone.type = 'lowpass'; echoIn.connect(dly); dly.connect(echoTone); echoTone.connect(fb); fb.connect(dly); echoTone.connect(echoOut); echoOut.connect(out); echoOut.connect(spaceIn);

  let project = null, tracks = new Map(), songs = new Map(), playing = false, timer = null;
  let startTime = 0, startBeat = 0, cursorBeat = 0, loop = { on: false, startBeat: 0, endBeat: 16 };
  const live = new Map(); const meterBuf = new Float32Array(256);
  const spb = () => 60 / (project?.bpm || 70);

  function applyBuses() {
    const p = project; if (!p) return;
    const rv = p.buses?.space?.fx?.find(f => f.id === 'reverb');
    const ir = reverbIR(ctx, rv?.params); if (conv.buffer !== ir) conv.buffer = ir;
    const atm = p.master?.atmosphere ?? 0.5;
    spaceOut.gain.value = (rv?.bypass ? 0 : 0.55 + atm * 0.9) * (rv?.params?.mix ?? 1);
    const tp = p.buses?.echo?.fx?.find(f => f.id === 'tape-delay')?.params || {};
    dly.delayTime.value = clamp((tp.time ?? 0.75) * spb(), 0.01, 3.9); fb.gain.value = clamp(tp.feedback ?? 0.4, 0, 0.9);
    echoTone.frequency.value = 800 + (tp.tone ?? 0.5) * 6000; echoOut.gain.value = 0.5 + atm * 0.4;
    out.gain.value = dbToGain(p.master?.volumeDb ?? 0);
  }
  function buildFx(fx, input) {
    let node = input; const nodes = [];
    for (const f of fx || []) {
      if (f.bypass) continue; const p = f.params || {};
      if (f.id === 'soft-filter') { const b = ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = p.cutoff ?? 6000; b.Q.value = 0.5 + (p.res ?? 0.15) * 8; node.connect(b); node = b; nodes.push(b); }
      else if (f.id === 'warmth') { const w = ctx.createWaveShaper(), k = 1 + (p.drive ?? 0.3) * 6, c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); } w.curve = c; node.connect(w); node = w; nodes.push(w); }
      else if (f.id === 'tremolo') { const g = ctx.createGain(), l = ctx.createOscillator(), d = ctx.createGain(); l.frequency.value = p.rate ?? 2; d.gain.value = (p.depth ?? 0.4) * 0.5; g.gain.value = 1 - d.gain.value; l.connect(d); d.connect(g.gain); l.start(); node.connect(g); node = g; nodes.push(g, l); }
      else if (f.id === 'chorus' || f.id === 'reverb' || f.id === 'tape-delay') {
        const sum = ctx.createGain(), wet = ctx.createGain(), dry = ctx.createGain(); node.connect(dry); dry.connect(sum);
        if (f.id === 'reverb') { const c = ctx.createConvolver(); c.buffer = reverbIR(ctx, p); node.connect(c); c.connect(wet); wet.gain.value = p.mix ?? 0.35; dry.gain.value = 1 - (p.mix ?? 0.35) * 0.5; }
        else if (f.id === 'chorus') { const d = ctx.createDelay(0.1), l = ctx.createOscillator(), lg = ctx.createGain(); d.delayTime.value = 0.018; l.frequency.value = p.rate ?? 0.4; lg.gain.value = 0.006 * (p.depth ?? 0.5); l.connect(lg); lg.connect(d.delayTime); l.start(); node.connect(d); d.connect(wet); wet.gain.value = p.mix ?? 0.4; nodes.push(l); }
        else { const d = ctx.createDelay(4), g = ctx.createGain(); d.delayTime.value = clamp((p.time ?? 0.75) * spb(), 0.01, 3.9); g.gain.value = clamp(p.feedback ?? 0.4, 0, 0.9); node.connect(d); d.connect(g); g.connect(d); d.connect(wet); wet.gain.value = 0.5; }
        wet.connect(sum); node = sum; nodes.push(sum);
      }
    }
    return { out: node, nodes };
  }
  function buildTracks() {
    for (const t of tracks.values()) { try { t.input.disconnect(); t.chainOut.disconnect(); t.vol.disconnect(); } catch { /* already gone */ } t.fxNodes.forEach(n => { try { n.stop?.(); } catch { /* not started */ } }); }
    tracks = new Map();
    const anySolo = project.tracks.some(t => t.solo);
    for (const t of project.tracks) {
      const input = ctx.createGain(); const fx = buildFx(t.fx, input);
      const vol = ctx.createGain(), pan = ctx.createStereoPanner(), an = ctx.createAnalyser(), sS = ctx.createGain(), sE = ctx.createGain();
      an.fftSize = 256; fx.out.connect(vol); vol.connect(pan); pan.connect(out); pan.connect(an); pan.connect(sS); pan.connect(sE); sS.connect(spaceIn); sE.connect(echoIn);
      const node = { input, vol, pan, an, sS, sE, chainOut: fx.out, fxNodes: fx.nodes, voices: [] };
      tracks.set(t.id, node); mixTrack(t, anySolo);
    }
  }
  function mixTrack(t, anySolo = project.tracks.some(x => x.solo)) {
    const n = tracks.get(t.id); if (!n) return;
    const audible = !t.mute && (!anySolo || t.solo);
    n.vol.gain.setTargetAtTime(audible ? dbToGain(t.volumeDb ?? 0) : 0, ctx.currentTime, 0.02);
    n.pan.pan.value = clamp(t.pan ?? 0, -1, 1);
    n.sS.gain.value = t.sends?.space ?? 0; n.sE.gain.value = t.sends?.echo ?? 0;
  }

  // ---------------------------------------------------------------- voices
  function voice(t, midi, vel, when, dur) {
    const n = tracks.get(t.id); if (!n) return null;
    const inst = t.instrument?.id, mp = t.instrument?.params || {}, f = mtof(midi), g = ctx.createGain(), nodes = [];
    g.connect(n.input); g.gain.value = 0;
    const osc = (type, freq, det = 0, gain = 1, to = g) => { const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = freq; o.detune.value = det; og.gain.value = gain; o.connect(og); og.connect(to); nodes.push(o); return o; };
    const lp = (freq, q = 0.5) => { const b = ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = freq; b.Q.value = q; b.connect(g); return b; };
    let a = 0.01, rel = 1.2, peak = vel * 0.22, decay = 0;
    if (inst === 'dream-pad') { const b = lp(600 + (mp.bright ?? 0.45) * 3500); osc('sawtooth', f, -9 - (mp.drift ?? 0.4) * 10, 0.5, b); osc('sawtooth', f, 9 + (mp.drift ?? 0.4) * 10, 0.5, b); osc('sine', f / 2, 0, 0.4, b); a = 0.8 + (mp.swell ?? 0.6) * 3; rel = 4; peak = vel * 0.12; }
    else if (inst === 'felt-piano') { const b = lp(900 + (mp.tone ?? 0.4) * 3000); osc('triangle', f, 0, 0.8, b); osc('sine', f * 2, 3, 0.2, b); a = 0.006 + (mp.felt ?? 0.7) * 0.02; decay = 3.5; rel = 1.5; peak = vel * 0.3; }
    else if (inst === 'glass-bells') { osc('sine', f, 0, 0.6); osc('sine', f * 2.76, 0, 0.25 * (mp.shine ?? 0.6)); osc('sine', f * 5.4, 0, 0.1 * (mp.shine ?? 0.6)); a = 0.002; decay = 1 + (mp.decay ?? 0.6) * 4; rel = 2; peak = vel * 0.2; }
    else if (inst === 'choir-air') { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500 + (mp.vowel ?? 0.4) * 900; bp.Q.value = 2; bp.connect(g); osc('sawtooth', f, -6, 0.5, bp); osc('sawtooth', f, 7, 0.5, bp); a = 1.4; rel = 3; peak = vel * 0.2; }
    else if (inst === 'bowed-strings') { const b = lp(1200 + (mp.warmth ?? 0.6) * 1500); const o = osc('sawtooth', f, 0, 0.6, b); osc('sawtooth', f, 8, 0.4, b); const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5; lg.gain.value = 6; l.connect(lg); lg.connect(o.detune); nodes.push(l); a = 0.3 + (mp.bow ?? 0.5) * 1.5; rel = 2.5; peak = vel * 0.12; }
    else if (inst === 'sub-drone') { osc('sine', f, 0, 0.8); osc('sine', f * 2, 2, 0.15 * (mp.depth ?? 0.6)); a = 2.5; rel = 4; peak = vel * 0.3; }
    else if (inst === 'pluck') { const b = lp(2500 + (mp.tone ?? 0.5) * 3000); osc('square', f, 0, 0.3, b); osc('triangle', f, 4, 0.6, b); b.frequency.setValueAtTime(3000 + (mp.tone ?? 0.5) * 4000, when); b.frequency.exponentialRampToValueAtTime(400, when + 0.4); a = 0.003; decay = 0.6 + (mp.pluck ?? 0.5); rel = 0.6; peak = vel * 0.25; }
    else if (inst === 'noise-texture') { const s = ctx.createBufferSource(); s.buffer = noiseBuffer(ctx); s.loop = true; const bp = ctx.createBiquadFilter(); bp.type = t.instrument.preset === 'rain' ? 'highpass' : 'bandpass'; bp.frequency.value = 400 + (mp.texture ?? 0.4) * 2400; bp.Q.value = 0.7; s.connect(bp); bp.connect(g); const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 0.07 + (mp.motion ?? 0.6) * 0.2; lg.gain.value = 300; l.connect(lg); lg.connect(bp.frequency); nodes.push(s, l); a = 2.5; rel = 3; peak = vel * 0.25; }
    else if (inst === 'song-cloud') {
      const buf = songs.get(mp.songId);
      if (buf) { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; const pos = (mp.position ?? 0.35) * buf.duration; s.loopStart = pos; s.loopEnd = pos + 0.08 + (mp.grain ?? 0.5) * 0.5; s.playbackRate.value = Math.pow(2, (midi - 62) / 12); s.connect(g); nodes.push(s); s._off = pos; }
      else osc('sine', f, 0, 0.5);
      a = 1.5; rel = 3; peak = vel * 0.5;
    } else { osc('triangle', f, 0, 0.6); rel = 1; }
    nodes.forEach(o => (o._off !== undefined ? o.start(when, o._off) : o.start(when)));
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(peak, when + a);
    if (decay) g.gain.setTargetAtTime(peak * 0.0001 + 0.0001, when + a, decay / 4);
    const v = { g, nodes, end: Infinity, stop(at) { at = Math.max(at, ctx.currentTime); g.gain.cancelScheduledValues(at); g.gain.setValueAtTime(decay ? peak * Math.exp(-(at - when) * 4 / decay) : peak, at); g.gain.setTargetAtTime(0, at, rel / 4); this.end = at + rel * 1.6; nodes.forEach(o => { try { o.stop(this.end); } catch { /* stopped */ } }); } };
    if (dur !== undefined) v.stop(when + Math.max(dur, a * 0.5));
    n.voices = n.voices.filter(x => x.end > ctx.currentTime); n.voices.push(v);
    if (n.voices.length > 24) n.voices.shift().stop(ctx.currentTime);
    return v;
  }
  function songSource(t, clip, when, intoBeats) {
    const s = clip.song, buf = songs.get(s?.songId), n = tracks.get(t.id); if (!buf || !n) return;
    const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = buf; src.playbackRate.value = s.rate || 1;
    const lenSec = clip.lengthBeats * spb(), into = intoBeats * spb(), gain = dbToGain(s.gainDb ?? 0);
    const fi = s.fadeInSec || 0.01, fo = s.fadeOutSec || 0.01;
    g.gain.setValueAtTime(into < fi ? gain * (into / fi) : gain, when);
    if (into < fi) g.gain.linearRampToValueAtTime(gain, when + fi - into);
    g.gain.setValueAtTime(gain, when + Math.max(0, lenSec - into - fo)); g.gain.linearRampToValueAtTime(0, when + lenSec - into);
    src.connect(g); g.connect(n.input); src.start(when, (s.offsetSec || 0) + into * (s.rate || 1)); src.stop(when + lenSec - into + 0.05);
    n.voices.push({ end: when + lenSec - into, stop(at) { g.gain.cancelScheduledValues(at); g.gain.setTargetAtTime(0, at, 0.05); try { src.stop(at + 0.3); } catch { /* done */ } this.end = at + 0.3; } });
  }

  // ---------------------------------------------------------------- scheduler (lookahead window, no timer per note)
  const beatToTime = b => startTime + (b - startBeat) * spb();
  function scheduleRange(b0, b1, jump) {
    for (const t of project.tracks) {
      for (const c of t.clips || []) {
        const cs = c.startBeat, ce = c.startBeat + c.lengthBeats;
        if (ce <= b0 || cs >= b1) continue;
        if (jump) { if ((t.kind === 'song' || c.song) && cs < b0) songSource(t, c, beatToTime(b0), b0 - cs); continue; }
        if (t.kind === 'song' || c.song) { if (cs >= b0) songSource(t, c, beatToTime(cs), 0); continue; }
        for (const nt of c.notes || []) {
          if (nt.s >= c.lengthBeats) continue;
          const s = cs + nt.s, e = Math.min(s + nt.d, ce);
          if (s >= b0 && s < b1) voice(t, nt.p, nt.v ?? 0.7, beatToTime(s), (e - s) * spb());
        }
      }
    }
  }
  function tick() {
    const ahead = offline ? Infinity : ctx.currentTime + 0.15;
    while (playing) {
      const until = offline ? endBeat() : startBeat + (ahead - startTime) / spb();
      const stopAt = loop.on && loop.endBeat > loop.startBeat ? loop.endBeat : Infinity;
      if (until < stopAt) { if (until > cursorBeat) scheduleRange(cursorBeat, until, false); cursorBeat = until; break; }
      scheduleRange(cursorBeat, stopAt, false);
      startTime = beatToTime(stopAt); startBeat = loop.startBeat; cursorBeat = loop.startBeat;
      scheduleRange(cursorBeat, cursorBeat + 0.001, true);
      if (offline) break;
    }
  }
  const endBeat = () => (project?.lengthBars || 16) * (project?.beatsPerBar || 4);
  function stopVoices(at = ctx.currentTime) { for (const n of tracks.values()) { n.voices.forEach(v => v.stop(at)); n.voices = []; } }

  const engine = {
    instruments: INSTRUMENTS, effects: EFFECTS, demo: sampleProject(), analyser, output: analyser, isMock: true,
    async load(p) {
      const wasPlaying = playing, at = wasPlaying ? engine.position().beat : cursorBeat;
      if (wasPlaying) engine.stop();
      project = p; loop = { ...(p.loop || loop) };
      const ids = new Set(); p.tracks.forEach(t => { (t.clips || []).forEach(c => c.song?.songId && ids.add(c.song.songId)); if (t.instrument?.params?.songId) ids.add(t.instrument.params.songId); });
      await Promise.all([...ids].filter(id => !songs.has(id)).map(id => loadSong(ctx, id).then(b => songs.set(id, b)).catch(() => { /* missing song: silent */ })));
      buildTracks(); applyBuses();
      if (wasPlaying) engine.play(at);
    },
    applyChange(p, change) {
      if (change?.type === 'mix' && project === p) { mixTrack(p.tracks.find(t => t.id === change.trackId) || {}); applyBuses(); return; }
      return engine.load(p);
    },
    play(fromBeat = cursorBeat) {
      if (!project) return; if (playing) engine.stop();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      playing = true; startBeat = cursorBeat = fromBeat; startTime = ctx.currentTime + (offline ? 0 : 0.06);
      scheduleRange(fromBeat, fromBeat + 0.0001, true); cursorBeat = fromBeat;
      tick(); if (!offline) timer = setInterval(tick, 25);
    },
    stop() { if (!playing) return; const b = engine.position().beat; playing = false; clearInterval(timer); timer = null; stopVoices(); cursorBeat = b; },
    seek(b) { if (playing) engine.play(b); else cursorBeat = b; },
    setLoop(on, s, e) { loop = { on: !!on, startBeat: s ?? loop.startBeat, endBeat: e ?? loop.endBeat }; if (project) project.loop = { ...loop }; },
    position() {
      if (!playing) return { beat: cursorBeat, seconds: cursorBeat * spb(), playing: false };
      let b = startBeat + Math.max(0, ctx.currentTime - startTime) / spb();
      if (loop.on && b >= loop.endBeat && loop.endBeat > loop.startBeat) b = loop.startBeat + ((b - loop.startBeat) % (loop.endBeat - loop.startBeat));
      return { beat: b, seconds: b * spb(), playing: true };
    },
    noteOn(trackId, midi, vel = 0.8) {
      const t = project?.tracks.find(x => x.id === trackId); if (!t || t.kind === 'song') return;
      if (ctx.state === 'suspended') ctx.resume?.();
      const k = trackId + ':' + midi; live.get(k)?.stop(ctx.currentTime); live.set(k, voice(t, midi, vel, ctx.currentTime + 0.005));
    },
    noteOff(trackId, midi) { const k = trackId + ':' + midi; live.get(k)?.stop(ctx.currentTime); live.delete(k); },
    setParam(target, id, value) {
      if (!project) return;
      if (target.master) { project.master[id] = value; applyBuses(); return; }
      if (target.bus) { applyBuses(); return; }
      const t = project.tracks.find(x => x.id === target.track); if (!t) return;
      if (target.fx !== undefined) { const n = tracks.get(t.id); if (n) engine.load(project); return; }
      if (['volumeDb', 'pan', 'mute', 'solo'].includes(id)) { t[id] = value; project.tracks.forEach(x => mixTrack(x)); }
      else if (id === 'space' || id === 'echo') { t.sends[id] = value; mixTrack(t); }
      else t.instrument.params[id] = value;
    },
    meter(trackId) {
      const n = tracks.get(trackId); if (!n) return { peakDb: -Infinity, rmsDb: -Infinity };
      n.an.getFloatTimeDomainData(meterBuf); let pk = 0, s = 0; for (let i = 0; i < meterBuf.length; i++) { const a = Math.abs(meterBuf[i]); if (a > pk) pk = a; s += a * a; }
      return { peakDb: 20 * Math.log10(pk || 1e-9), rmsDb: 10 * Math.log10(s / meterBuf.length || 1e-18) };
    },
    async render(p, { tailSeconds = 8, seconds } = {}) {
      const len = seconds ?? (p.lengthBars * p.beatsPerBar * 60 / p.bpm + tailSeconds);
      const off = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(len * 44100), sampleRate: 44100 });
      const e = await createEngine({ context: off }); const q = JSON.parse(JSON.stringify(p)); q.loop = { ...(q.loop || {}), on: false }; await e.load(q); e.play(0);
      return off.startRendering();
    },
    dispose() { engine.stop(); try { analyser.disconnect(); } catch { /* gone */ } },
  };
  return engine;
}
