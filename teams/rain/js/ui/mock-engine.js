// mock-engine.js - a small stand-in for the real rain sound engine (js/sound/), implementing the same API from
// shared/BRIEF.md so the UI can be built and tested before the real engine lands. Simple Web Audio tones with a
// convolution "Space" bus, a tape-ish "Echo" bus and a gentle master limiter. The integrator swaps in the real one;
// app.js already prefers js/sound/engine.js when it exists and only falls back to this file.
import { makeImpulse, REVERB_PRESETS } from '../../lib/reverb.js';
import { loadSong, SONGS } from '../../lib/songs.js';
import { SAMPLE_PROJECT } from './sample-project.js';

const dbToGain = db => (db <= -80 ? 0 : Math.pow(10, db / 20));
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const SONG_OPTS = SONGS.map(s => ({ id: s.id, name: s.title }));
const M = (id, name, def, min = 0, max = 1, unit = '') => ({ id, name, min, max, default: def, unit });

const INSTRUMENTS = [
  { id: 'dream-pad', name: 'Dream Pad', kind: 'synth', wave: 'sawtooth', a: 1.6, r: 3.5, cut: 1400, presets: [{ id: 'dusk', name: 'Dusk' }, { id: 'after-rain', name: 'After Rain' }, { id: 'lamplight', name: 'Lamplight' }], macros: [M('warmth', 'Warmth', 0.5), M('drift', 'Drift', 0.4), M('bloom', 'Bloom', 0.6)] },
  { id: 'felt-piano', name: 'Felt Piano', kind: 'synth', wave: 'triangle', a: 0.005, r: 1.6, cut: 2200, presets: [{ id: 'soft', name: 'Soft Felt' }, { id: 'upright', name: 'Late Upright' }], macros: [M('felt', 'Felt', 0.6), M('tone', 'Tone', 0.5), M('decay', 'Decay', 0.5)] },
  { id: 'glass-bells', name: 'Glass Bells', kind: 'synth', wave: 'sine', a: 0.002, r: 3.2, cut: 8000, fm: 3.5, presets: [{ id: 'window', name: 'Window Glass' }, { id: 'musicbox', name: 'Music Box' }], macros: [M('shine', 'Shine', 0.5), M('decay', 'Decay', 0.6)] },
  { id: 'choir-air', name: 'Choir Air', kind: 'synth', wave: 'sawtooth', a: 2.2, r: 3, cut: 900, presets: [{ id: 'aah', name: 'Distant Aah' }, { id: 'ooh', name: 'Soft Ooh' }], macros: [M('breath', 'Breath', 0.4), M('vowel', 'Vowel', 0.5), M('width', 'Width', 0.7)] },
  { id: 'bowed-strings', name: 'Bowed Strings', kind: 'synth', wave: 'sawtooth', a: 1.2, r: 2.4, cut: 1800, presets: [{ id: 'quartet', name: 'Night Quartet' }, { id: 'cello', name: 'Low Cello' }], macros: [M('bow', 'Bow', 0.5), M('vibrato', 'Vibrato', 0.3)] },
  { id: 'sub-drone', name: 'Sub Drone', kind: 'synth', wave: 'sine', a: 3, r: 4, cut: 300, presets: [{ id: 'floor', name: 'Floor Hum' }, { id: 'harbor', name: 'Harbor' }], macros: [M('depth', 'Depth', 0.6), M('motion', 'Motion', 0.3)] },
  { id: 'koto-pluck', name: 'Koto Pluck', kind: 'synth', wave: 'square', a: 0.002, r: 0.9, cut: 2600, presets: [{ id: 'koto', name: 'Koto' }, { id: 'kalimba', name: 'Kalimba' }], macros: [M('pluck', 'Pluck', 0.6), M('body', 'Body', 0.5)] },
  { id: 'night-texture', name: 'Night Texture', kind: 'noise', a: 2, r: 3, cut: 2400, presets: [{ id: 'rain', name: 'Rain on Glass' }, { id: 'city', name: 'Night City' }, { id: 'vinyl', name: 'Vinyl' }], macros: [M('amount', 'Amount', 0.6), M('tone', 'Tone', 0.5)] },
  { id: 'song-cloud', name: 'Song Cloud', kind: 'granular', a: 1.2, r: 2.5, presets: [{ id: 'haze', name: 'Haze' }, { id: 'frozen', name: 'Frozen Moment' }],
    macros: [M('position', 'Position', 0.35), M('grain', 'Grain', 0.4), M('density', 'Density', 0.5), M('spray', 'Spray', 0.3)],
    params: [{ id: 'songId', name: 'Song', options: SONG_OPTS, default: 'sleepy-rain' }, { id: 'freeze', name: 'Freeze', min: 0, max: 1, default: 0, step: 1 }] },
];
const REV_TYPES = [{ id: 'room', name: 'Wet Room' }, { id: 'plate', name: 'Plate' }, { id: 'hall', name: 'Hall' }, { id: 'cathedral', name: 'Cathedral' }, { id: 'infinite', name: 'Infinite' }, { id: 'reverse', name: 'Reverse' }];
const EFFECTS = [
  { id: 'reverb', name: 'Reverb', params: [{ id: 'type', name: 'Type', options: REV_TYPES, default: 'hall' }, M('mix', 'Mix', 0.35, 0, 1, '%'), M('size', 'Size', 0.6)] },
  { id: 'tape-echo', name: 'Tape Echo', params: [M('time', 'Time', 0.45, 0.05, 1.5, 's'), M('feedback', 'Feedback', 0.45, 0, 0.9, '%'), M('mix', 'Mix', 0.3, 0, 1, '%')] },
  { id: 'lowpass', name: 'Soft Filter', params: [M('cutoff', 'Cutoff', 3000, 80, 16000, 'Hz'), M('q', 'Resonance', 0.7, 0.1, 8)] },
  { id: 'tremolo', name: 'Tremolo', params: [M('rate', 'Rate', 3, 0.1, 12, 'Hz'), M('depth', 'Depth', 0.4, 0, 1, '%')] },
  { id: 'chorus', name: 'Chorus', params: [M('rate', 'Rate', 0.4, 0.05, 4, 'Hz'), M('depth', 'Depth', 0.5, 0, 1, '%')] },
];

export async function createEngine({ context }) {
  const ctx = context, offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
  const out = ctx.createGain(); out.gain.value = dbToGain(-1);
  const lim = new DynamicsCompressorNode(ctx, { threshold: -4, knee: 2, ratio: 20, attack: 0.004, release: 0.35 });
  const masterVol = ctx.createGain();
  const analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.82;
  masterVol.connect(lim).connect(out); out.connect(analyser); out.connect(ctx.destination);
  // Space bus
  const spaceIn = ctx.createGain(), conv = ctx.createConvolver(), spaceRet = ctx.createGain();
  spaceIn.connect(conv).connect(spaceRet).connect(masterVol);
  let revType = '';
  // Echo bus
  const echoIn = ctx.createGain(), dly = ctx.createDelay(3), fb = ctx.createGain(), tone = ctx.createBiquadFilter(), echoRet = ctx.createGain();
  dly.delayTime.value = 0.5; fb.gain.value = 0.45; tone.type = 'lowpass'; tone.frequency.value = 2400; echoRet.gain.value = 0.7;
  echoIn.connect(dly).connect(tone).connect(fb).connect(dly); tone.connect(echoRet).connect(masterVol); tone.connect(spaceIn);

  let project = null, tracks = new Map(), songBufs = new Map();
  const noise = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = noise.getChannelData(c); let b = 0; for (let i = 0; i < d.length; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 3 + (Math.random() * 2 - 1) * 0.15; } }
  const live = new Set(); // active voices {stop(t)}
  const held = new Map(); // `${track}:${midi}` -> voice

  function instDef(id) { return INSTRUMENTS.find(i => i.id === id) || INSTRUMENTS[0]; }
  function setSpace(type) {
    if (type === revType) return; revType = type;
    conv.buffer = makeImpulse(ctx, { ...(REVERB_PRESETS[type] || REVERB_PRESETS.hall), seconds: Math.min(9, (REVERB_PRESETS[type] || REVERB_PRESETS.hall).seconds) });
  }
  function buildTrack(t) {
    const input = ctx.createGain(); let node = input; const fxNodes = [];
    for (const fx of t.fx || []) {
      if (fx.bypass) continue; const p = fx.params || {};
      if (fx.id === 'lowpass') { const f = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: p.cutoff ?? 3000, Q: p.q ?? 0.7 }); node.connect(f); node = f; fxNodes.push(f); }
      else if (fx.id === 'tremolo') { const g = ctx.createGain(), l = new OscillatorNode(ctx, { frequency: p.rate ?? 3 }), d = ctx.createGain(); d.gain.value = (p.depth ?? 0.4) / 2; g.gain.value = 1 - (p.depth ?? 0.4) / 2; l.connect(d).connect(g.gain); l.start(); node.connect(g); node = g; fxNodes.push(l); }
      else if (fx.id === 'tape-echo' || fx.id === 'reverb' || fx.id === 'chorus') {
        const dry = ctx.createGain(), wet = ctx.createGain(), sum = ctx.createGain(); const mix = p.mix ?? 0.3; dry.gain.value = 1 - mix * 0.5; wet.gain.value = mix;
        node.connect(dry).connect(sum);
        if (fx.id === 'reverb') { const c = ctx.createConvolver(); c.buffer = makeImpulse(ctx, REVERB_PRESETS[p.type] || REVERB_PRESETS.hall); node.connect(c).connect(wet).connect(sum); }
        else if (fx.id === 'chorus') { const d = ctx.createDelay(0.05); d.delayTime.value = 0.012; const l = new OscillatorNode(ctx, { frequency: p.rate ?? 0.4 }), lg = ctx.createGain(); lg.gain.value = 0.004 * (p.depth ?? 0.5); l.connect(lg).connect(d.delayTime); l.start(); fxNodes.push(l); wet.gain.value = 0.5; node.connect(d).connect(wet).connect(sum); }
        else { const d = ctx.createDelay(2), f = ctx.createGain(); d.delayTime.value = p.time ?? 0.45; f.gain.value = p.feedback ?? 0.45; node.connect(d).connect(f).connect(d); d.connect(wet).connect(sum); }
        node = sum;
      }
    }
    const pan = new StereoPannerNode(ctx, { pan: t.pan || 0 }), vol = ctx.createGain(), ana = ctx.createAnalyser(); ana.fftSize = 512;
    const sS = ctx.createGain(), sE = ctx.createGain();
    node.connect(pan).connect(vol); vol.connect(masterVol); vol.connect(ana); vol.connect(sS).connect(spaceIn); vol.connect(sE).connect(echoIn);
    return { input, pan, vol, ana, sS, sE, fxNodes, def: t };
  }
  function mixTrack(n, t) {
    const anySolo = project.tracks.some(x => x.solo);
    const on = !t.mute && (!anySolo || t.solo);
    n.vol.gain.setTargetAtTime(on ? dbToGain(t.volumeDb ?? 0) : 0, ctx.currentTime, 0.02);
    n.pan.pan.setTargetAtTime(t.pan || 0, ctx.currentTime, 0.02);
    n.sS.gain.setTargetAtTime(t.sends?.space ?? 0.4, ctx.currentTime, 0.02);
    n.sE.gain.setTargetAtTime(t.sends?.echo ?? 0, ctx.currentTime, 0.02);
  }
  function mixMaster() {
    const m = project.master || {}; masterVol.gain.setTargetAtTime(dbToGain(m.volumeDb ?? 0), ctx.currentTime, 0.02);
    spaceRet.gain.setTargetAtTime(0.5 + (m.atmosphere ?? 0.5) * 0.9, ctx.currentTime, 0.05);
    const rv = (project.buses?.space?.fx || []).find(f => f.id === 'reverb'); setSpace(rv?.params?.type || 'cathedral');
    const ec = (project.buses?.echo?.fx || []).find(f => f.id === 'tape-echo');
    if (ec) { dly.delayTime.setTargetAtTime(ec.params?.time ?? 0.5, ctx.currentTime, 0.1); fb.gain.setTargetAtTime(ec.params?.feedback ?? 0.45, ctx.currentTime, 0.05); }
  }

  // ---- voices
  function voice(trackId, midi, vel, t0, dur) {
    const n = tracks.get(trackId); if (!n) return null; const t = n.def; if (t.kind === 'song') return null;
    if (live.size > 48) { const v = live.values().next().value; v.stop(ctx.currentTime, 0.05); live.delete(v); }
    const d = instDef(t.instrument?.id), P = { ...(t.instrument?.params || {}) }, mac = k => P[k] ?? d.macros.find(m => m.id === k)?.default ?? 0.5;
    const g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = 'lowpass'; g.gain.value = 0;
    const srcs = []; const peak = vel * 0.22;
    if (d.kind === 'noise') {
      const s = new AudioBufferSourceNode(ctx, { buffer: noise, loop: true }); f.type = 'bandpass'; f.frequency.value = mtof(midi) * 2 * (0.5 + mac('tone')); f.Q.value = 0.8; srcs.push(s); s.connect(f);
    } else if (d.kind === 'granular') {
      const buf = songBufs.get(P.songId || 'sleepy-rain'); if (!buf) return null;
      const s = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true, playbackRate: Math.pow(2, (midi - 60) / 12) });
      const pos = mac('position') * (buf.duration - 3), len = 0.12 + mac('grain') * 1.8; s.loopStart = pos; s.loopEnd = pos + len; f.frequency.value = 5000; srcs.push(s); s.connect(f);
      srcs.startOffset = pos;
    } else {
      const det = d.id === 'dream-pad' || d.id === 'choir-air' || d.id === 'bowed-strings' ? [-7, 0, 7] : [0];
      for (const c of det) { const o = new OscillatorNode(ctx, { type: d.wave, frequency: mtof(midi), detune: c * (0.5 + mac('drift')) }); o.connect(f); srcs.push(o); }
      if (d.fm) { const m = new OscillatorNode(ctx, { frequency: mtof(midi) * d.fm }), mg = ctx.createGain(); mg.gain.value = mtof(midi) * (0.3 + mac('shine')); m.connect(mg); srcs.forEach(s => mg.connect(s.frequency)); srcs.push(m); }
      f.frequency.value = d.cut * (0.5 + (mac('warmth') ?? 0.5)); f.Q.value = 0.5;
    }
    f.connect(g).connect(n.input);
    const a = d.a, r = d.r * (0.5 + (P.decay ?? 0.5));
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + a);
    if (a < 0.05) g.gain.setTargetAtTime(peak * 0.25, t0 + a, r * 0.4);
    srcs.forEach(s => s.start(t0, srcs.startOffset || 0));
    const v = { g, srcs, stopped: false, stop(t, rel = r) { if (v.stopped) return; v.stopped = true; t = Math.max(t, ctx.currentTime); try { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); } catch (e) {} g.gain.setTargetAtTime(0, t, rel / 4); srcs.forEach(s => { try { s.stop(t + rel * 1.5); } catch (e) {} }); setTimeout(() => live.delete(v), (t - ctx.currentTime + rel * 1.5) * 1000 + 50); } };
    if (dur !== undefined) v.stop(t0 + Math.max(dur, a), r);
    live.add(v); return v;
  }
  function songClip(t, c, t0, offBeats) {
    const n = tracks.get(t.id), s = c.song; const buf = s && songBufs.get(s.songId); if (!n || !buf) return;
    const spb = 60 / project.bpm, rate = s.rate || 1, len = c.lengthBeats * spb - offBeats * spb; if (len <= 0.01) return;
    const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: rate }), g = ctx.createGain(), gain = dbToGain(s.gainDb ?? 0);
    const fi = Math.max(0.005, s.fadeInSec || 0), fo = Math.max(0.01, s.fadeOutSec || 0), clipStart = -offBeats * spb;
    g.gain.setValueAtTime(offBeats > 0 ? gain * Math.min(1, offBeats * spb / fi) : 0, t0);
    if (offBeats * spb < fi) g.gain.linearRampToValueAtTime(gain, t0 + fi + clipStart);
    g.gain.setValueAtTime(gain, Math.max(t0, t0 + len - fo)); g.gain.linearRampToValueAtTime(0, t0 + len);
    src.connect(g).connect(n.input); src.start(t0, (s.offsetSec || 0) + offBeats * spb * rate); src.stop(t0 + len + 0.05);
    const v = { stop(t) { try { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, 0.08); src.stop(t + 0.5); } catch (e) {} live.delete(v); } }; live.add(v);
  }

  // ---- transport / scheduler (lookahead; one timer, never one per note)
  let playing = false, seg = null, timer = null, schedTo = 0;
  const loopOf = () => project.loop?.on && project.loop.endBeat > project.loop.startBeat ? project.loop : null;
  const endBeat = () => (project.lengthBars || 32) * (project.beatsPerBar || 4);
  function beatAt(time) { if (!seg) return 0; return seg.beat + (time - seg.time) * project.bpm / 60; }
  function scheduleRange(b0, b1, timeOf) {
    for (const t of project.tracks) {
      for (const c of t.clips || []) {
        const cs = c.startBeat, ce = c.startBeat + c.lengthBeats;
        if (t.kind === 'song') { if (cs >= b0 && cs < b1) songClip(t, c, timeOf(cs), 0); continue; }
        for (const nt of c.notes || []) { const nb = cs + nt.s; if (nt.s >= c.lengthBeats) continue; if (nb >= b0 && nb < b1) voice(t.id, nt.p, nt.v ?? 0.8, timeOf(nb), Math.min(nt.d, c.lengthBeats - nt.s) * 60 / project.bpm); }
      }
    }
  }
  function startSongsInside(b, time) { for (const t of project.tracks) if (t.kind === 'song') for (const c of t.clips || []) if (b > c.startBeat && b < c.startBeat + c.lengthBeats) songClip(t, c, time, b - c.startBeat); }
  function tick() {
    if (!playing) return; const horizon = ctx.currentTime + 0.25; let guard = 0;
    while (guard++ < 8) {
      const lp = loopOf(), limit = lp && seg.beat < lp.endBeat ? lp.endBeat : endBeat() + 8;
      const toBeat = Math.min(beatAt(horizon), limit); if (toBeat > schedTo) { scheduleRange(schedTo, toBeat, b => seg.time + (b - seg.beat) * 60 / project.bpm); schedTo = toBeat; }
      if (toBeat >= limit && lp) { const tEnd = seg.time + (lp.endBeat - seg.beat) * 60 / project.bpm; seg = { beat: lp.startBeat, time: tEnd }; schedTo = lp.startBeat; startSongsInside(lp.startBeat, tEnd); continue; }
      if (!lp && beatAt(ctx.currentTime) > endBeat() + 8) { api.stop(); }
      break;
    }
  }
  const api = {
    instruments: INSTRUMENTS.map(({ wave, a, r, cut, fm, ...m }) => ({ params: [], ...m })),
    effects: EFFECTS, demo: SAMPLE_PROJECT, analyser, output: out, isMock: true,
    async load(p) {
      project = p; const need = new Set();
      for (const t of p.tracks) { for (const c of t.clips || []) if (c.song?.songId) need.add(c.song.songId); if (t.instrument?.id === 'song-cloud') need.add(t.instrument.params?.songId || 'sleepy-rain'); }
      await Promise.all([...need].filter(id => !songBufs.has(id)).map(id => loadSong(ctx, id).then(b => songBufs.set(id, b)).catch(() => {})));
      const old = tracks; tracks = new Map();
      for (const t of p.tracks) { const n = buildTrack(t); tracks.set(t.id, n); mixTrack(n, t); }
      mixMaster();
      for (const n of old.values()) { n.vol.gain.setTargetAtTime(0, ctx.currentTime, 0.05); setTimeout(() => { try { n.vol.disconnect(); n.fxNodes.forEach(x => x.stop?.()); } catch (e) {} }, 400); }
      if (playing && !offline) { const b = api.position().beat; live.forEach(v => v.stop(ctx.currentTime, 0.1)); seg = { beat: b, time: ctx.currentTime + 0.03 }; schedTo = b; startSongsInside(b, seg.time); }
    },
    applyChange(p, change) {
      if (change && change.type === 'mix') { project = p; const t = p.tracks.find(x => x.id === change.trackId); const n = t && tracks.get(t.id); if (n) { for (const [id, x] of tracks) mixTrack(x, p.tracks.find(y => y.id === id) || x.def); return; } }
      if (change && change.type === 'master') { project = p; mixMaster(); return; }
      return api.load(p);
    },
    play(fromBeat = 0) {
      if (!project) return; api.stop(true); playing = true; const t0 = ctx.currentTime + (offline ? 0 : 0.06);
      seg = { beat: fromBeat, time: t0 }; schedTo = fromBeat; startSongsInside(fromBeat, t0);
      if (offline) { scheduleRange(fromBeat, endBeat() + 0.001, b => t0 + (b - fromBeat) * 60 / project.bpm); return; }
      tick(); timer = setInterval(tick, 40);
    },
    stop(quiet) { clearInterval(timer); timer = null; if (playing && seg && !quiet) seg = { beat: beatAt(ctx.currentTime), time: ctx.currentTime }; playing = false; live.forEach(v => v.stop(ctx.currentTime, 0.25)); live.clear(); },
    seek(beat) { if (playing) api.play(beat); else seg = { beat, time: ctx.currentTime }; },
    setLoop(on, s, e) { if (project) project.loop = { on, startBeat: s, endBeat: e }; },
    position() {
      if (!project) return { beat: 0, seconds: 0, playing: false };
      const b = playing ? Math.max(seg.beat, beatAt(ctx.currentTime)) : (seg?.beat || 0);
      return { beat: b, seconds: b * 60 / project.bpm, playing };
    },
    noteOn(trackId, midi, vel = 0.8) { const k = trackId + ':' + midi; held.get(k)?.stop(ctx.currentTime, 0.3); const v = voice(trackId, midi, vel, ctx.currentTime + 0.005); if (v) held.set(k, v); },
    noteOff(trackId, midi) { const k = trackId + ':' + midi; const v = held.get(k); if (v) { v.stop(ctx.currentTime); held.delete(k); } },
    setParam(target, id, value) {
      if (!project) return;
      if (target.master) { project.master[id] = value; mixMaster(); return; }
      const t = project.tracks.find(x => x.id === target.track), n = t && tracks.get(t.id); if (!n) return;
      if (['volumeDb', 'pan', 'mute', 'solo'].includes(id) || id.startsWith('send')) for (const [tid, x] of tracks) mixTrack(x, project.tracks.find(y => y.id === tid) || x.def);
    },
    meter(trackId) {
      const n = tracks.get(trackId); if (!n) return { peakDb: -Infinity, rmsDb: -Infinity };
      const a = n.ana, d = api._buf || (api._buf = new Float32Array(a.fftSize)); a.getFloatTimeDomainData(d); let pk = 0, s = 0;
      for (let i = 0; i < d.length; i++) { const x = Math.abs(d[i]); if (x > pk) pk = x; s += x * x; }
      return { peakDb: 20 * Math.log10(pk + 1e-9), rmsDb: 10 * Math.log10(s / d.length + 1e-12) };
    },
    async render(p, { tailSeconds = 8, seconds } = {}) {
      const len = seconds ?? ((p.lengthBars || 32) * (p.beatsPerBar || 4) * 60 / p.bpm + tailSeconds);
      const off = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(len * 44100), sampleRate: 44100 });
      const e = await createEngine({ context: off }); const copy = JSON.parse(JSON.stringify(p)); copy.loop = { ...copy.loop, on: false };
      await e.load(copy); e.play(0); return off.startRendering();
    },
    dispose() { api.stop(); try { out.disconnect(); analyser.disconnect(); } catch (e) {} },
  };
  return api;
}
