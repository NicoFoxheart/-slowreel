// engine.js - the tape studio sound engine (see ../../SOUND-API.md).
//   import { createEngine } from './js/sound/engine.js';
//   const engine = await createEngine({ context: new AudioContext() });
//   await engine.load(engine.demo); engine.play(0);
import { clamp, dbToGain, gainToDb, num, safetyCurve, disconnectAll } from './util.js?v=10';
import { INSTRUMENTS, INSTRUMENT_MAP, resolveParams } from './instruments.js?v=10';
import { EFFECTS, createEffect, resolveFx } from './effects.js?v=10';
import { SONGS, loadSong, songBuffer, songsInProject } from './songs.js?v=10';
import { REVERB_TYPES } from './reverb.js?v=10';
import { ensureBasics, ensureNight, assetMode, ensureIR } from './assets.js?v=10';
import { noiseBuffer } from './util.js?v=10';
import { nightBuffer } from './nightrain.js?v=10';
import { DEMO } from './demo.js?v=10';
// Round 2 "Antent pack": new effects, the arpeggiator, the Chop Sampler's samples and automation lanes
import { FX2, createFx2, resolveFx2, scheduleFx } from './fx2.js?v=10';
import { arpNotes } from './arp.js?v=10';
import { ensureSamples, setSampleSongBase, warmSampler } from './sampler.js?v=10';
import { applyAutomation, resetAutomation } from '../ui/automation.js?v=10';

const GLOBAL_VOICE_CAP = 64, GRAIN_CAP = 64;   // Light mode halves both (and every instrument's own voice cap)
const DEFAULT_SPACE_FX = () => [{ id: 'reverb', params: { type: 'hall', mix: 1, size: 1.25, tone: 0.45, preDelay: 0.03 }, bypass: false }];
const DEFAULT_ECHO_FX = () => [{ id: 'echo', params: { beats: 0.75, feedback: 0.62, tone: 0.38, wow: 0.45, drive: 0.35, spread: 0.75, mix: 1 }, bypass: false }];
const clone = o => JSON.parse(JSON.stringify(o));

export const ENGINE_VERSION = 'tape-1';

export async function createEngine({ context, songBaseUrl = 'audio/', light = false } = {}) {
  const ctx = context || new AudioContext();
  const offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
  setSampleSongBase(songBaseUrl);
  const stats = { voices: 0, grains: 0, nodes: 0, maxVoices: 0, maxGrains: 0, maxNodes: 0 };
  const bump = () => { stats.maxVoices = Math.max(stats.maxVoices, stats.voices); stats.maxGrains = Math.max(stats.maxGrains, stats.grains); stats.maxNodes = Math.max(stats.maxNodes, stats.nodes); };

  let project = null;
  const tracks = new Map();     // id -> track runtime
  const allVoices = [];         // every sounding voice (scheduled + live), oldest first
  const songSources = new Set();
  const grainLog = [];          // recent song-cloud grains, for the glowing cloud visual (live context only)

  // ------------------------------------------------------------ fx environment
  const env = {
    bpm: () => num(project?.bpm, 70),
    light: !!light,                 // Light mode (weaker PCs): see setLight()
    lightRoomInput: null,           // the shared short room every reverb sends to in Light mode
    grainsNow: () => stats.grains,
    grainCap: () => (env.light ? GRAIN_CAP / 2 : GRAIN_CAP),
    voiceEnded(v) { const i = allVoices.indexOf(v); if (i >= 0) allVoices.splice(i, 1); stats.voices = allVoices.length; stats.nodes -= v.nodes.length; },
    grainStarted(g) {
      stats.grains++; stats.gs = (stats.gs || 0) + 1; stats.nodes += 2; bump();
      if (g && !offline) { grainLog.push(g); if (grainLog.length > 160) grainLog.splice(0, grainLog.length - 120); }
    },
    grainEnded() { stats.grains--; stats.ge = (stats.ge || 0) + 1; stats.nodes -= 2; },
  };

  // ------------------------------------------------------------ master + buses
  const sum = ctx.createGain();
  const masterFxIn = ctx.createGain(), masterFxOut = ctx.createGain();
  const masterTape = createEffect(ctx, 'tape', { drive: 0.12, age: 0.12, wow: 0.12, flutter: 0.08, hiss: 0.12 }, env);
  const masterVol = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  // Safety limiter: only acts above -3 dBFS (quiet ambient mixes never touch it). Chromium's compressor adds an automatic
  // makeup gain (+1.195 dB for these settings, measured), which `unmakeup` removes so a song clip at 0 dB leaves at 0 dB.
  limiter.threshold.value = -3; limiter.knee.value = 3; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.25;
  const unmakeup = ctx.createGain(); unmakeup.gain.value = Math.pow(10, -1.195 / 20);
  const safety = ctx.createWaveShaper(); safety.curve = safetyCurve(ctx, 0.886, 0.78); safety.oversample = 'none';
  const output = ctx.createGain();
  const analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.8;
  sum.connect(masterFxIn); masterFxOut.connect(masterTape.input); masterTape.output.connect(masterVol);
  masterVol.connect(limiter); limiter.connect(unmakeup); unmakeup.connect(safety); safety.connect(output); output.connect(analyser); output.connect(ctx.destination);
  stats.nodes += 10;

  const makeBus = (name) => {
    const bus = { name, input: ctx.createGain(), chainOut: ctx.createGain(), ret: ctx.createGain(), fx: [], sig: '' };
    bus.input.channelCount = 2;
    bus.chainOut.connect(bus.ret); bus.ret.connect(sum);
    return bus;
  };
  const space = makeBus('space'), echo = makeBus('echo');
  const echoToSpace = ctx.createGain(); echoToSpace.gain.value = 0.35; echo.ret.connect(echoToSpace); echoToSpace.connect(space.input);
  let masterFx = [], masterSig = '';

  // Light mode: one shared short room (impulse <= 2.5 s, no shimmer) on the Space return. Every reverb in the project
  // (Space bus, track inserts) sends its wet share there instead of running its own convolver.
  let lightRoom = null;
  const roomSpec = () => { const f = (project?.buses?.space?.fx || []).find(x => !x.bypass && (x.id === 'reverb' || x.id === 'shimmer')); return resolveFx('reverb', { ...(f ? f.params : { type: 'hall', size: 1.25, tone: 0.45, preDelay: 0.03 }), mix: 1, shimmer: 0 }); };
  function syncLightRoom() {
    if (!env.light) { if (lightRoom) { lightRoom.dispose(); lightRoom = null; } env.lightRoomInput = null; return; }
    const spec = roomSpec();
    if (!lightRoom) {
      lightRoom = createEffect(ctx, 'reverb', spec, { ...env, light: false, irLight: true });
      lightRoom.output.connect(space.ret); env.lightRoomInput = lightRoom.input;
    } else for (const k of ['type', 'size', 'tone', 'preDelay']) if (lightRoom.params[k] !== spec[k]) lightRoom.set(k, spec[k]);
  }
  const voiceCap = def => (env.light ? Math.max(2, Math.ceil(def.maxVoices / 2)) : def.maxVoices);
  const globalCap = () => (env.light ? GLOBAL_VOICE_CAP / 2 : GLOBAL_VOICE_CAP);
  // everything the graph needs before it can play: impulse responses, noise loops, night rain (if used)
  const usesNight = p => (p?.tracks || []).some(t => t.kind !== 'song' && t.instrument?.id === 'texture' && resolveParams('texture', t.instrument.preset, t.instrument.params || {})?.noise === 'nightrain');
  function assetsReady() {
    const sr = ctx.sampleRate, wait = [ensureBasics(sr, { night: false })];
    if (usesNight(project)) wait.push(ensureNight(sr, 'glass'), ensureNight(sr, 'city'));
    for (const f of allFx()) if (f.ready) wait.push(f.ready);
    if (lightRoom?.ready) wait.push(lightRoom.ready);
    return Promise.all(wait).then(() => {
      // copy the cached samples into this context's buffers now (about 1 ms each), not when the first note plays
      for (const t of ['white', 'pink', 'brown', 'crackle']) noiseBuffer(ctx, t);
      if (usesNight(project)) { nightBuffer(ctx, 'glass'); nightBuffer(ctx, 'city'); }
    });
  }

  function buildChain(list, input, out, old) {
    if (old) for (const f of old) f.dispose();
    try { input.disconnect(); } catch (e) { }
    const fx = [];
    let node = input;
    for (const spec of list || []) {
      if (spec.bypass) { fx.push(null); continue; }
      const f = createEffect(ctx, spec.id, spec.params || {}, env) || createFx2(ctx, spec.id, spec.params || {}, env);
      if (!f) { fx.push(null); continue; }
      node.connect(f.input); node = f.output; fx.push(f);
      if (playing && f.transport) f.transport(true, ctx.currentTime);
    }
    node.connect(out);
    return fx;
  }
  const sigOf = list => JSON.stringify((list || []).map(f => [f.id, !!f.bypass]));
  function syncFxParams(fx, list) {
    (list || []).forEach((spec, i) => { const f = fx[i]; if (!f) return; const p = resolveFx(spec.id, spec.params || {}) || resolveFx2(spec.id, spec.params || {}); if (!p) return; for (const k in p) if (f.params[k] !== p[k]) f.set(k, p[k]); });
  }

  function syncBusesAndMaster() {
    project.buses = project.buses || {};
    project.buses.space = project.buses.space || { fx: DEFAULT_SPACE_FX() };
    project.buses.echo = project.buses.echo || { fx: DEFAULT_ECHO_FX() };
    project.master = project.master || { volumeDb: 0, atmosphere: 0.5, fx: [] };
    syncLightRoom();
    for (const [bus, spec] of [[space, project.buses.space], [echo, project.buses.echo]]) {
      const sig = sigOf(spec.fx);
      if (sig !== bus.sig) { bus.fx = buildChain(spec.fx, bus.input, bus.chainOut, bus.fx); bus.sig = sig; } else syncFxParams(bus.fx, spec.fx);
      const t = ctx.currentTime;
      bus.ret.gain.setTargetAtTime(dbToGain(num(spec.returnDb, 0)), t, 0.03);
    }
    const msig = sigOf(project.master.fx);
    if (msig !== masterSig) { masterFx = buildChain(project.master.fx, masterFxIn, masterFxOut, masterFx); masterSig = msig; } else syncFxParams(masterFx, project.master.fx);
    applyMaster();
  }
  function applyMaster(t = ctx.currentTime) {
    const m = project.master, atm = clamp(num(m.atmosphere, 0.5), 0, 1);
    masterVol.gain.setTargetAtTime(dbToGain(num(m.volumeDb, 0)), t, 0.03);
    // Atmosphere: more room, more echo bloom, a little more tape. 0.5 = neutral.
    const spaceDb = num(project.buses.space.returnDb, 0), echoDb = num(project.buses.echo.returnDb, 0);
    space.ret.gain.setTargetAtTime(dbToGain(spaceDb + (atm - 0.5) * 14), t, 0.05);
    echo.ret.gain.setTargetAtTime(dbToGain(echoDb + (atm - 0.5) * 8), t, 0.05);
    masterTape.set('hiss', 0.06 + atm * 0.16); masterTape.set('age', 0.08 + atm * 0.14); masterTape.set('wow', 0.06 + atm * 0.14);
  }

  // ------------------------------------------------------------ tracks
  function buildTrack(spec) {
    const tr = { id: spec.id, spec, input: ctx.createGain(), chainOut: ctx.createGain(), fader: ctx.createGain(), panner: ctx.createStereoPanner(),
      mute: ctx.createGain(), sendSpace: ctx.createGain(), sendEcho: ctx.createGain(), analyser: ctx.createAnalyser(), fx: [], sig: '', live: new Map(), voices: [] };
    tr.analyser.fftSize = 1024; tr.buf = new Float32Array(1024);
    tr.chainOut.connect(tr.fader); tr.fader.connect(tr.panner); tr.panner.connect(tr.mute);
    tr.mute.connect(sum); tr.mute.connect(tr.sendSpace); tr.mute.connect(tr.sendEcho); tr.mute.connect(tr.analyser);
    tr.sendSpace.connect(space.input); tr.sendEcho.connect(echo.input);
    stats.nodes += 9;
    tracks.set(spec.id, tr);
    return tr;
  }
  function syncTrack(spec) {
    let tr = tracks.get(spec.id) || buildTrack(spec);
    tr.spec = spec;
    spec.fx = spec.fx || []; spec.sends = spec.sends || { space: 0.3, echo: 0 };
    const sig = sigOf(spec.fx) + spec.kind;
    if (sig !== tr.sig) { tr.fx = buildChain(spec.fx, tr.input, tr.chainOut, tr.fx); tr.sig = sig; } else syncFxParams(tr.fx, spec.fx);
    if (spec.kind !== 'song') {
      spec.instrument = spec.instrument || { id: 'felt', preset: 'felt-upright', params: {} };
      tr.def = INSTRUMENT_MAP[spec.instrument.id] || INSTRUMENT_MAP.felt;
      tr.params = resolveParams(tr.def.id, spec.instrument.preset, spec.instrument.params || {});
    } else { tr.def = null; tr.params = null; }
    return tr;
  }
  // instruments that make buffers per pitch (asian.js plucked strings: def.prewarm) get them made here, before play(),
  // in slices of ~10 ms on a live context so loading never blocks the page for long
  let warmGen = 0;
  async function prewarm(p, onlyTrackId) {
    const jobs = [], gen = ++warmGen;
    for (const spec of p?.tracks || []) {
      if (spec.kind === 'song' || (onlyTrackId && spec.id !== onlyTrackId)) continue;
      const tr = tracks.get(spec.id); if (!tr?.def?.prewarm || !tr.params) continue;
      const ms = new Set(); for (const c of spec.clips || []) for (const n of notesOf(spec, c)) ms.add(n.p);
      for (const m of ms) jobs.push([tr.def, tr.params, m]);
    }
    let t0 = performance.now();
    for (const [def, params, m] of jobs) {
      try { def.prewarm(ctx, params, m); } catch (e) { console.warn('[tape] prewarm', def.id, e); }
      if (!offline && performance.now() - t0 > 10) { await new Promise(r => setTimeout(r, 0)); if (gen !== warmGen && !onlyTrackId) return; t0 = performance.now(); }
    }
  }
  // the notes a clip plays: through the track's arpeggiator when it is on (arpNotes is cached per clip + settings)
  const notesOf = (spec, c) => (spec.arp?.on ? arpNotes(c, spec.arp, num(project?.bpm, 70)) : (c.notes || []));
  // Chop Sampler tracks: decode their samples (Nico's songs or imported audio from IndexedDB) and do the slicing /
  // level match / reversed copy / Slowed room now, so the first note never computes them. -> {missing}
  let missingSamples = [];
  async function warmSamples(p) {
    if (!(p?.tracks || []).some(t => t.instrument?.id === 'chop')) { missingSamples = []; return; }
    // the "Slowed" hall is made in the asset worker (same plan as sampler.js roomFor), not on the main thread
    const [r] = await Promise.all([ensureSamples(ctx, p), env.light ? null : ensureIR(ctx.sampleRate, 'hall', { size: 1.5, tone: 0.35, preDelay: 0.04 }).catch(() => { })]);
    missingSamples = r.missing;
    for (const spec of p.tracks) if (spec.instrument?.id === 'chop') { const tr = tracks.get(spec.id); if (tr?.params) try { warmSampler(ctx, tr, env); } catch (e) { console.warn('[tape] sampler warm', e); } }
  }
  const automationCtx = { ctx, tracks };
  function resetAllAutomation(beat) { for (const spec of project?.tracks || []) if (spec.automation?.length) try { resetAutomation(automationCtx, spec, beat); } catch (e) { console.warn('[tape] automation', e); } }
  function applyMixer(t = ctx.currentTime) {
    const anySolo = project.tracks.some(s => s.solo);
    for (const s of project.tracks) {
      const tr = tracks.get(s.id); if (!tr) continue;
      tr.fader.gain.setTargetAtTime(dbToGain(num(s.volumeDb, 0)), t, 0.02);
      tr.panner.pan.setTargetAtTime(clamp(num(s.pan, 0), -1, 1), t, 0.02);
      const audible = !s.mute && (!anySolo || s.solo);
      tr.mute.gain.setTargetAtTime(audible ? 1 : 0, t, 0.015);
      tr.sendSpace.gain.setTargetAtTime(clamp(num(s.sends?.space, 0.3), 0, 1.5), t, 0.02);
      tr.sendEcho.gain.setTargetAtTime(clamp(num(s.sends?.echo, 0), 0, 1.5), t, 0.02);
    }
  }
  function removeTrack(id) {
    const tr = tracks.get(id); if (!tr) return;
    for (const v of allVoices.slice()) if (v.track === tr) v.kill(ctx.currentTime);
    tr.fx.forEach(f => f && f.dispose());
    disconnectAll(tr.input, tr.chainOut, tr.fader, tr.panner, tr.mute, tr.sendSpace, tr.sendEcho, tr.analyser);
    stats.nodes -= 9;
    tracks.delete(id);
  }

  // ------------------------------------------------------------ voices
  function startVoice(tr, midi, vel, t) {
    if (!tr.def) return null;
    // polyphony: per-track cap, then global cap (oldest goes first, with a short fade)
    const mine = tr.voices.filter(v => !v.dead && v.endTime > t);
    tr.voices = mine;
    while (mine.length >= voiceCap(tr.def)) mine.shift().kill(t);
    const sounding = allVoices.filter(v => v.endTime > t && !v.dead);
    for (let i = 0; sounding.length - i >= globalCap(); i++) sounding[i].kill(t);
    const v = tr.def.voice(ctx, env, tr.params, midi, clamp(num(vel, 0.8), 0, 1), Math.max(t, ctx.currentTime));
    v.track = tr; v.midi = midi;
    v.out.connect(tr.input);
    tr.voices.push(v); allVoices.push(v);
    stats.voices = allVoices.length; stats.nodes += v.nodes.length; bump();
    if (v.tick) v.tick(t + lookahead());
    return v;
  }

  // ------------------------------------------------------------ transport + lookahead scheduler
  let playing = false, segs = [], schedBeat = 0, stopBeat = 0, endBeat = Infinity, timer = null, loopOverride = null;
  const lookahead = () => (offline ? 1.0 : (typeof document !== 'undefined' && document.hidden ? 1.2 : 0.4));
  const bpm = () => clamp(num(project?.bpm, 70), 20, 300);
  const spb = () => 60 / bpm();
  const seg = (time) => { for (let i = segs.length - 1; i >= 0; i--) if (segs[i].t <= time + 1e-9) return segs[i]; return segs[0]; };
  const beatAt = time => { const s = seg(time); return s.b + (time - s.t) / spb(); };
  const loopState = () => { const l = loopOverride || project?.loop || {}; return { on: !!l.on && num(l.endBeat, 0) > num(l.startBeat, 0) + 0.25, s: num(l.startBeat, 0), e: num(l.endBeat, 0) }; };
  const projectBeats = () => {
    let end = num(project?.lengthBars, 0) * num(project?.beatsPerBar, 4);
    for (const t of project?.tracks || []) for (const c of t.clips || []) end = Math.max(end, num(c.startBeat, 0) + num(c.lengthBeats, 0));
    return end || 16;
  };

  // Scheduling work is queued and done track by track. Offline it all runs at once (same order as always); live it runs
  // in slices of ~6 ms with a yield in between, so pressing play or a big chord never blocks the page. A slice that is
  // about to be late (its notes start within 120 ms) finishes without waiting.
  const jobs = [];
  const SLICE_MS = 6;
  let moreT = 0;
  function scheduleRange(fromB, toB, s, cutB, startSegment) {
    // fromB..toB in beats of segment s; notes released no later than cutB (loop end)
    // beat-synced bus / master effects (pump, tape stop, auto filter); track effects go with their track in scheduleTrack
    const tb = b => s.t + (b - s.b) * spb();
    for (const list of [space.fx, echo.fx, masterFx]) if (list.length) scheduleFx(list, fromB, toB, tb, project);
    jobs.push({ fromB, toB, s, cutB, startSegment, list: project.tracks.slice(), i: 0 });
  }
  const urgent = j => j.s.t + (j.fromB - j.s.b) * spb() <= ctx.currentTime + 0.12;
  function drain(budget) {
    const t0 = performance.now();
    while (jobs.length) {
      const j = jobs[0];
      while (j.i < j.list.length) {
        scheduleTrack(j.list[j.i++], j);
        if (j.i < j.list.length && performance.now() - t0 > budget && !urgent(j)) return false;
      }
      jobs.shift();
      if (jobs.length && performance.now() - t0 > budget && !urgent(jobs[0])) return false;
    }
    return true;
  }
  function scheduleTrack(spec, { fromB, toB, s, cutB, startSegment }) {
    const tb = b => s.t + (b - s.b) * spb();
    {
      const tr = tracks.get(spec.id); if (!tr) return;
      for (const c of spec.clips || []) {
        const cs = num(c.startBeat, 0), cl = num(c.lengthBeats, 0), ce = cs + cl;
        if (ce <= fromB || cs >= toB + 64) continue;
        if (spec.kind === 'song') {
          if (!c.song) continue;
          if (cs >= fromB && cs < toB) startSongClip(tr, c, cs, tb(cs), Math.min(ce, cutB), tb);
          else if (startSegment && cs < fromB && ce > fromB + 0.05) startSongClip(tr, c, fromB, tb(fromB), Math.min(ce, cutB), tb);
          continue;
        }
        for (const n of notesOf(spec, c)) {
          const ns = num(n.s, 0); if (ns < 0 || ns >= cl) continue;
          const b = cs + ns, d = Math.min(num(n.d, 1), cl - ns);
          let at = b;
          if (b >= fromB && b < toB) at = b;
          else if (startSegment && b < fromB && b + d > fromB + 0.25) at = fromB;   // long notes already under way
          else continue;
          const off = Math.min(b + d, cutB);
          if (off <= at) continue;
          const v = startVoice(tr, num(n.p, 60), num(n.v, 0.8), tb(at));
          if (v) v.release(tb(off));
        }
      }
      // round 2: beat-synced track effects and automation lanes, for the same beat range as the notes (live and offline)
      if (tr.fx.length) scheduleFx(tr.fx, fromB, toB, tb, project);
      if (spec.automation?.length) try { applyAutomation(automationCtx, spec, fromB, toB, tb); } catch (e) { console.warn('[tape] automation', e); }
    }
  }

  function startSongClip(tr, c, fromB, time, endB, tb) {
    const sg = c.song, buf = songBuffer(sg.songId);
    if (!buf) { loadSong(ctx, sg.songId, songBaseUrl).catch(() => { }); return; }
    const rate = clamp(num(sg.rate, 1), 0.25, 4), cs = num(c.startBeat, 0);
    const clipStartT = tb(cs), clipEndT = tb(endB), fullEndT = tb(cs + num(c.lengthBeats, 0));
    const into = (fromB - cs) * spb();
    const off = num(sg.offsetSec, 0) + into * rate;
    if (off >= buf.duration || clipEndT <= time) return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.playbackRate.value = rate;
    const lvl = dbToGain(num(sg.gainDb, 0));
    const fi = Math.max(0.005, num(sg.fadeInSec, 0.5)), fo = Math.max(0.005, num(sg.fadeOutSec, 1));
    const envAt = tt => Math.min(1, Math.max(0, (tt - clipStartT) / fi), Math.max(0, (fullEndT - tt) / fo));
    const t0 = Math.max(time, ctx.currentTime);
    g.gain.setValueAtTime(lvl * envAt(t0), t0);
    if (clipStartT + fi > t0) g.gain.linearRampToValueAtTime(lvl, clipStartT + fi);
    const foStart = Math.max(t0, fullEndT - fo);
    if (foStart < clipEndT) { g.gain.setValueAtTime(lvl * envAt(foStart), foStart); g.gain.linearRampToValueAtTime(lvl * envAt(clipEndT), clipEndT); }
    if (fullEndT > clipEndT + 0.001) g.gain.linearRampToValueAtTime(0, clipEndT + 0.03);   // cut by loop end: short fade
    src.connect(g); g.connect(tr.input);
    src.start(t0, off); src.stop(clipEndT + 0.05);
    const item = { src, g, tr };
    songSources.add(item); stats.nodes += 2;
    src.onended = () => { if (!songSources.has(item)) return; disconnectAll(src, g); songSources.delete(item); stats.nodes -= 2; };
  }

  function tick(horizon) {
    if (!project) return;
    const hz = horizon ?? (ctx.currentTime + lookahead());
    const budget = offline ? Infinity : SLICE_MS;
    if (playing && !drain(budget)) { more(); }    // unfinished work first; new ranges wait for the next slice
    else if (playing) {
      let guard = 0;
      while (guard++ < 8) {
        const s = segs[segs.length - 1];
        const L = loopState();
        const target = s.b + (hz - s.t) / spb();
        const cut = L.on && schedBeat < L.e ? L.e : endBeat;
        const to = Math.min(target, cut);
        if (to > schedBeat) { scheduleRange(schedBeat, to, s, cut, false); schedBeat = to; }
        if (L.on && schedBeat >= L.e - 1e-9 && target >= L.e) {
          const t = s.t + (L.e - s.b) * spb();
          segs.push({ t, b: L.s }); if (segs.length > 3) segs.shift();
          schedBeat = L.s;
          scheduleRange(L.s, L.s, segs[segs.length - 1], L.e, true);   // nothing yet, but long notes at loop start
          continue;
        }
        break;
      }
      if (!drain(budget)) more();
      if (!L_on() && schedBeat >= endBeat && !offline) {
        const tEnd = seg(ctx.currentTime).t + (endBeat - seg(ctx.currentTime).b) * spb();
        if (ctx.currentTime > tEnd + 0.05) { stopTransport(false); }
      }
    }
    for (const v of allVoices) if (v.tick && !v.dead) v.tick(hz);
    // tidy voices that ended (onended may be throttled)
    for (let i = allVoices.length - 1; i >= 0; i--) { const v = allVoices[i]; if (v.dead) { allVoices.splice(i, 1); } }
    stats.voices = allVoices.length; bump();
    if (!playing && !allVoices.some(v => v.tick) && timer && !anyLive()) { clearInterval(timer); timer = null; }
  }
  const L_on = () => loopState().on;
  const anyLive = () => { for (const tr of tracks.values()) if (tr.live.size) return true; return false; };
  function ensureTimer() { if (!offline && !timer) timer = setInterval(() => tick(), 25); }
  function more() { if (!offline && !moreT) moreT = setTimeout(() => { moreT = 0; tick(); }, 0); }

  function startTransport(fromBeat, at) {
    jobs.length = 0;
    killAll(at);
    resetAllAutomation(fromBeat);
    playing = true;
    segs = [{ t: at, b: fromBeat }];
    schedBeat = fromBeat; endBeat = projectBeats();
    for (const f of allFx()) f.transport && f.transport(true, at);
    masterTape.transport(true, at);
    scheduleRange(fromBeat, fromBeat, segs[0], loopState().on && fromBeat < loopState().e ? loopState().e : endBeat, true);
    tick(at + lookahead());
    ensureTimer();
  }
  function stopTransport(kill = true) {
    const t = ctx.currentTime;
    stopBeat = playing ? beatAt(t) : stopBeat;
    playing = false; jobs.length = 0;
    if (kill) killAll(t);
    resetAllAutomation(stopBeat);
    for (const f of allFx()) f.transport && f.transport(false, t);
    masterTape.transport(false, t);
  }
  function killAll(t) {
    for (const v of allVoices.slice()) if (!v.isLive) v.kill(t);
    for (const it of songSources) { try { it.g.gain.cancelScheduledValues(t); it.g.gain.setTargetAtTime(0, t, 0.02); it.src.stop(t + 0.1); } catch (e) { } }
  }
  const allFx = () => { const a = [...space.fx, ...echo.fx, ...masterFx]; for (const tr of tracks.values()) a.push(...tr.fx); return a.filter(Boolean); };

  // ------------------------------------------------------------ public API
  const engine = {
    version: ENGINE_VERSION,
    context: ctx,
    output, analyser,
    songs: SONGS,
    reverbTypes: REVERB_TYPES,
    demo: clone(DEMO),
    instruments: INSTRUMENTS.map(i => ({
      id: i.id, name: i.name, kind: i.kind, maxVoices: i.maxVoices, region: i.region || '',
      ...(i.drumMap ? { drumMap: i.drumMap.map(d => ({ midi: d.midi, name: d.name, short: d.short })) } : {}),
      presets: i.presets.map(p => ({ id: p.id, name: p.name })),
      macros: i.macros.map(id => { const p = i.params.find(x => x.id === id); return { id, name: p.name, min: p.min, max: p.max, default: p.default, unit: p.unit }; }),
      params: i.params.map(p => ({ ...p })),
    })),
    effects: [...EFFECTS, ...FX2].map(e => ({ id: e.id, name: e.name, params: e.params.map(p => ({ ...p })) })),

    presetParams(instrumentId, presetId) { return resolveParams(instrumentId, presetId, {}); },
    trackParams(trackId) { const tr = tracks.get(trackId); return tr?.params ? { ...tr.params } : null; },

    newProject(name = 'Untitled tape') {
      const now = Date.now();
      return { schema: 'nfx-studio/1', id: 'p' + now.toString(36), name, bpm: 70, beatsPerBar: 4, key: 'C', scale: 'major', lengthBars: 16,
        loop: { on: false, startBeat: 0, endBeat: 16 }, tracks: [], buses: { space: { fx: DEFAULT_SPACE_FX() }, echo: { fx: DEFAULT_ECHO_FX() } },
        master: { volumeDb: 0, atmosphere: 0.5, fx: [] }, createdAt: now, updatedAt: now };
    },
    newTrack({ kind = 'instrument', instrument = 'felt', preset, name, color } = {}) {
      const def = INSTRUMENT_MAP[instrument] || INSTRUMENT_MAP.felt;
      const id = 't' + Math.random().toString(36).slice(2, 8);
      if (kind === 'song') return { id, name: name || 'Song', color: color || '#c98b5a', kind, volumeDb: -6, pan: 0, mute: false, solo: false,
        sends: { space: 0.25, echo: 0 }, fx: [{ id: 'tape', params: { drive: 0.25, age: 0.35, wow: 0.3, flutter: 0.2, hiss: 0.1 }, bypass: false }], clips: [] };
      return { id, name: name || def.name, color: color || '#b88a6a', kind: 'instrument', instrument: { id: def.id, preset: preset || def.presets[0].id, params: {} },
        volumeDb: 0, pan: 0, mute: false, solo: false, sends: { space: 0.35, echo: def.id === 'texture' ? 0 : 0.1 }, fx: [], clips: [] };
    },

    async load(p) {
      project = p;
      project.tracks = project.tracks || [];
      syncBusesAndMaster();
      const ids = new Set(project.tracks.map(t => t.id));
      for (const id of [...tracks.keys()]) if (!ids.has(id)) removeTrack(id);
      for (const spec of project.tracks) syncTrack(spec);
      applyMixer();
      if (playing) endBeat = projectBeats();
      const want = songsInProject(project);
      // songs are decoded and every buffer the graph needs is made here (worker / idle time), never on play()
      await Promise.all([...want.map(id => loadSong(ctx, id, songBaseUrl).catch(e => console.warn('[tape] song failed to load', id, e))),
        assetsReady().catch(e => console.warn('[tape] assets', e)), prewarm(project).catch(e => console.warn('[tape] prewarm', e)),
        warmSamples(project).catch(e => console.warn('[tape] samples', e))]);
      if (!offline) ensureBasics(ctx.sampleRate).catch(() => { });   // night rain too, in the background, for later edits
      return engine;
    },
    /** Resolves when every impulse response / noise loop the current graph needs is in place. */
    ready() { return project ? assetsReady() : Promise.resolve(); },
    /** Chop Sampler samples the project needs but this device does not have: [{trackId, sampleId, name}] ("re-import <name>"). */
    missingSamples() { return missingSamples.slice(); },
    /** Load / warm the Chop Sampler samples again (after an import). */
    ensureSamples() { return project ? warmSamples(project).then(() => ({ missing: missingSamples.slice() })) : Promise.resolve({ missing: [] }); },
    get light() { return env.light; },
    /**
     * Light mode for weaker PCs (live playback only; render() and exports always use the full sound):
     * one shared short room (<= 2.5 s, no shimmer) instead of every reverb's own, half the voice and grain caps.
     * Returns a promise that resolves when the light room is ready.
     */
    setLight(on) {
      on = !!on;
      if (on === env.light) return Promise.resolve(on);
      env.light = on;
      if (!project) return Promise.resolve(on);
      space.sig = ''; echo.sig = ''; masterSig = '';
      for (const tr of tracks.values()) tr.sig = '';
      syncBusesAndMaster();
      for (const spec of project.tracks) syncTrack(spec);
      if (on) { const t = ctx.currentTime; const cap = globalCap(); const live = allVoices.filter(v => !v.dead && v.endTime > t); for (let i = 0; i < live.length - cap; i++) live[i].kill(t); }
      return assetsReady().then(() => on);
    },
    /**
     * Quick render-speed probe: renders `seconds` of the busiest moment of the project offline with the full sound and
     * returns {rtf (x real time), ms, fromBeat}. Below ~1.8x the PC will not keep up live; the UI then turns on Light mode.
     */
    async speedProbe({ seconds = 3 } = {}) {
      if (!project) return null;
      const end = projectBeats(), secPerBeat = spb();
      let best = 0, bestN = -1;
      for (let b = 0; b < end; b += 1) {
        let n = 0;
        for (const t of project.tracks) for (const c of t.clips || []) {
          const cs = num(c.startBeat, 0);
          if (t.kind === 'song') { if (b >= cs && b < cs + num(c.lengthBeats, 0)) n += 3; continue; }
          for (const x of c.notes || []) { const st = cs + num(x.s, 0); if (b >= st && b < st + num(x.d, 1)) n++; }
        }
        if (n > bestN) { bestN = n; best = b; }
      }
      const toBeat = Math.min(end, best + seconds / secPerBeat), audio = (toBeat - best) * secPerBeat;
      const t0 = performance.now();
      await engine.render(project, { fromBeat: best, toBeat, tailSeconds: 0 });
      const ms = performance.now() - t0;
      return { rtf: Math.round(audio * 1000 / ms * 100) / 100, ms: Math.round(ms), seconds: Math.round(audio * 10) / 10, fromBeat: best, notes: bestN };
    },
    applyChange(p, change = {}) {
      if (p !== project) return engine.load(p);
      const type = change.type;
      if (type === 'notes' || type === 'clips' || type === 'clip') { endBeat = projectBeats(); if (change.trackId && tracks.get(change.trackId)?.spec.kind === 'song') engine.load(p); else if (!offline) prewarm(p, change.trackId).catch(() => { }); return; }
      if (type === 'mixer') { applyMixer(); return; }
      if (type === 'loop') { engine.setLoop(p.loop?.on, p.loop?.startBeat, p.loop?.endBeat); return; }
      if (type === 'tempo') {
        if (playing) { const now = ctx.currentTime; segs.push({ t: now, b: beatAt(now) }); if (segs.length > 3) segs.shift(); }
        allFx().forEach(f => f.retime && f.retime()); return;
      }
      if (type === 'track' && change.trackId) { const spec = p.tracks.find(t => t.id === change.trackId); if (spec) { syncTrack(spec); applyMixer(); if (!offline) { prewarm(p, change.trackId).catch(() => { }); if (spec.instrument?.id === 'chop') warmSamples(p).catch(() => { }); } return; } }
      if (type === 'master') { syncBusesAndMaster(); return; }
      return engine.load(p);
    },

    play(fromBeat) {
      if (!project) return;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      const b = fromBeat === undefined || fromBeat === null ? stopBeat : Math.max(0, +fromBeat || 0);
      startTransport(b, ctx.currentTime + 0.3);
    },
    stop() { if (playing) stopTransport(true); else killAll(ctx.currentTime); },
    seek(beat) { beat = Math.max(0, +beat || 0); if (playing) startTransport(beat, ctx.currentTime + 0.2); else stopBeat = beat; },
    setLoop(on, startBeat, endBeat) {
      if (project) project.loop = { on: !!on, startBeat: num(startBeat, project.loop?.startBeat || 0), endBeat: num(endBeat, project.loop?.endBeat || 16) };
      loopOverride = null;
      if (playing) { const now = ctx.currentTime, b = beatAt(now), L = loopState(); if (L.on && (b >= L.e || b < L.s)) startTransport(L.s, now + 0.03); else if (schedBeat > b + 0.01 && L.on && schedBeat > L.e) startTransport(b, now + 0.03); }
    },
    position() {
      const now = ctx.currentTime;
      if (!playing || !segs.length) return { beat: stopBeat, seconds: stopBeat * spb(), playing: false };
      const beat = Math.max(0, beatAt(now));
      return { beat, seconds: beat * spb(), playing: true };
    },

    noteOn(trackId, midi, velocity = 0.8) {
      const tr = tracks.get(trackId); if (!tr || !tr.def) return;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      const old = tr.live.get(midi); if (old) old.release(ctx.currentTime, 0.08);
      const v = startVoice(tr, midi, velocity, ctx.currentTime + 0.005);
      if (!v) return;
      v.isLive = true; tr.live.set(midi, v);
      if (!playing) for (const f of [...tr.fx, ...space.fx, ...echo.fx]) f && f.transport && f.transport(true, ctx.currentTime);
      ensureTimer();
    },
    noteOff(trackId, midi) {
      const tr = tracks.get(trackId); if (!tr) return;
      const v = tr.live.get(midi); if (!v) return;
      tr.live.delete(midi); v.release(ctx.currentTime);
    },
    allNotesOff() { for (const tr of tracks.values()) { for (const v of tr.live.values()) v.release(ctx.currentTime); tr.live.clear(); } },

    setParam(target = {}, paramId, value) {
      if (!project) return;
      const t = ctx.currentTime;
      if (target.master) {
        if (target.fx !== undefined) { const i = +target.fx; const spec = project.master.fx[i]; if (!spec) return; setFx(masterFx, project.master.fx, i, paramId, value, () => { masterSig = ''; syncBusesAndMaster(); }); return; }
        project.master[paramId] = value; applyMaster(t); return;
      }
      if (target.bus) {
        const bus = target.bus === 'echo' ? echo : space, spec = project.buses[target.bus === 'echo' ? 'echo' : 'space'];
        if (target.fx !== undefined) { setFx(bus.fx, spec.fx, +target.fx, paramId, value, () => { bus.sig = ''; syncBusesAndMaster(); }); if (env.light) syncLightRoom(); return; }
        spec[paramId] = value; applyMaster(t); return;
      }
      const spec = project.tracks.find(s => s.id === target.track), tr = tracks.get(target.track);
      if (!spec || !tr) return;
      if (target.fx !== undefined) {
        const i = typeof target.fx === 'number' ? target.fx : spec.fx.findIndex(f => f.id === target.fx);
        setFx(tr.fx, spec.fx, i, paramId, value, () => { tr.sig = ''; syncTrack(spec); });
        return;
      }
      if (paramId === 'volumeDb' || paramId === 'pan' || paramId === 'mute' || paramId === 'solo') { spec[paramId] = value; applyMixer(t); return; }
      if (paramId === 'space' || paramId === 'echo' || paramId === 'sends.space' || paramId === 'sends.echo') { spec.sends = spec.sends || {}; spec.sends[paramId.replace('sends.', '')] = +value; applyMixer(t); return; }
      if (paramId === 'preset') { spec.instrument.preset = value; spec.instrument.params = {}; syncTrack(spec); return; }
      if (paramId === 'instrument') { spec.instrument = { id: value, preset: INSTRUMENT_MAP[value]?.presets[0].id, params: {} }; syncTrack(spec); return; }
      if (spec.instrument && tr.def) {
        spec.instrument.params = spec.instrument.params || {}; spec.instrument.params[paramId] = value;
        tr.params = resolveParams(tr.def.id, spec.instrument.preset, spec.instrument.params);
        if (paramId === 'song') loadSong(ctx, value, songBaseUrl).catch(() => { });
        if (tr.def.id === 'chop' && !offline) { clearTimeout(tr.warmT); tr.warmT = setTimeout(() => warmSamples(project).catch(() => { }), 120); }
      }
    },

    meter(trackId) {
      const a = trackId === 'master' || trackId === undefined ? analyser : tracks.get(trackId)?.analyser;
      if (!a) return { peakDb: -120, rmsDb: -120 };
      const buf = a._buf || (a._buf = new Float32Array(a.fftSize));
      a.getFloatTimeDomainData(buf);
      let pk = 0, s = 0; for (let i = 0; i < buf.length; i++) { const x = buf[i]; const ax = x < 0 ? -x : x; if (ax > pk) pk = ax; s += x * x; }
      return { peakDb: gainToDb(pk), rmsDb: gainToDb(Math.sqrt(s / buf.length)) };
    },
    // Recent song-cloud grains for visuals: [{t, age, pos 0..1 in the song, rate, dur, pan -1..1, vel, track}], newest last.
    cloudGrains(windowSec = 1.5, trackId) {
      const now = ctx.currentTime, out = [];
      for (const g of grainLog) { const age = now - g.t; if (age >= -0.25 && age <= windowSec && (!trackId || g.track === trackId)) out.push({ ...g, age }); }
      return out;
    },
    stats() { return { voices: allVoices.length, grains: stats.grains, nodes: stats.nodes, maxVoices: stats.maxVoices, maxGrains: stats.maxGrains, maxNodes: stats.maxNodes, tracks: tracks.size, gs: stats.gs, ge: stats.ge, light: env.light, assets: assetMode() }; },
    loadSong(id) { return loadSong(ctx, id, songBaseUrl); },
    songBuffer,
    projectSeconds(p = project) { const old = project; project = p; const s = projectBeats() * spb(); project = old; return s; },

    async render(p, { tailSeconds = 8, sampleRate = 44100, fromBeat = 0, toBeat, onProgress, light = false } = {}) {
      const pr = clone(p || project);
      pr.loop = { ...(pr.loop || {}), on: false };
      const b0 = Math.max(0, fromBeat), bpmV = clamp(num(pr.bpm, 70), 20, 300);
      let end = num(pr.lengthBars, 0) * num(pr.beatsPerBar, 4);
      for (const t of pr.tracks || []) for (const c of t.clips || []) end = Math.max(end, num(c.startBeat, 0) + num(c.lengthBeats, 0));
      const b1 = toBeat === undefined ? end : Math.min(end, toBeat);
      const seconds = Math.max(0.5, (b1 - b0) * 60 / bpmV + tailSeconds);
      const off = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
      const sub = await createEngine({ context: off, songBaseUrl, light: !!light });   // full sound unless asked
      await sub.load(pr);
      sub._renderStart(b0, b1);
      const step = 0.5;
      for (let t = step; t < seconds; t += step) {
        off.suspend(t).then(() => { sub._tick(t + 1.0); if (onProgress) onProgress(t / seconds); off.resume(); });
      }
      const buf = await off.startRendering();
      engine.lastRenderStats = sub.stats();
      sub.dispose();
      return buf;
    },
    _renderStart(b0, b1) {
      startTransport(b0, 0);
      endBeat = b1;
      const tEnd = (b1 - b0) * spb();
      for (const f of allFx()) f.transport && f.transport(false, tEnd);
      masterTape.transport(false, tEnd);
    },
    _tick(h) { tick(h); },

    dispose() {
      if (timer) clearInterval(timer); timer = null;
      playing = false;
      for (const v of allVoices.slice()) { try { v.kill(ctx.currentTime); } catch (e) { } }
      for (const id of [...tracks.keys()]) removeTrack(id);
      for (const f of [...space.fx, ...echo.fx, ...masterFx, masterTape, lightRoom]) f && f.dispose();
      disconnectAll(sum, masterFxIn, masterFxOut, masterVol, limiter, unmakeup, safety, output, analyser, space.input, space.chainOut, space.ret, echo.input, echo.chainOut, echo.ret, echoToSpace);
      project = null;
    },
  };
  function setFx(fxList, specList, i, paramId, value, rebuild) {
    const spec = specList[i]; if (!spec) return;
    if (paramId === 'bypass') { spec.bypass = !!value; rebuild(); return; }
    spec.params = spec.params || {}; spec.params[paramId] = value;
    const f = fxList[i]; if (f) f.set(paramId, value);
  }
  return engine;
}
