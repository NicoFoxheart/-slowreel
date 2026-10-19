// sampler.js - Chop Sampler: slices one of Nico's songs or an audio file Nico imports, mapped to keys from C3 (MIDI 48) up.
// Same definition format as instruments.js ({id, name, kind, maxVoices, params, macros, presets, voice}).
// Project storage: track.instrument.sample = {sampleId, name} (sampleId 'song:<songId>' or 'imp:<hash>'), per-slice edits in
// track.instrument.slices = [{pitch (st), reverse (bool), start 0..1, end 0..1}] (index = slice). Imported audio lives in
// IndexedDB ('slowreel-samples') keyed by a SHA-256 content hash; projects never hold audio.
// The voice starts its BufferSource in tick() (the engine calls tick right after creating a voice), where v.track.spec is known.
import { clamp, disconnectAll, release as relParam, cached } from './util.js?v=7';
import { SONGS } from './songs.js?v=7';
import { songBuffer as engineSongBuffer, loadSong as engineLoadSong } from './songs.js?v=7';
import { makeIR } from './reverb.js?v=7';

export const SLICE_BASE_MIDI = 48;   // C3 (Slowreel names MIDI 60 "C4")
const P = (id, name, min, max, def, extra = {}) => ({ id, name, min, max, default: def, unit: '', ...extra });
const ENUM = (id, name, options, def) => ({ id, name, min: 0, max: options.length - 1, default: def, unit: '', type: 'enum', options });
const SONG_OPTS = SONGS.map(s => ({ value: s.id, label: s.title }));
const MODES = [{ value: 'equal', label: 'Equal' }, { value: 'transient', label: 'Transients' }];

// ------------------------------------------------------------------ sample store (memory + IndexedDB)
const buffers = new Map();     // sampleId -> AudioBuffer
const names = new Map();       // sampleId -> name
const pending = new Map();     // sampleId -> Promise<AudioBuffer>
const levelGain = new WeakMap();

export function sampleBuffer(sampleId) {
  if (buffers.has(sampleId)) return buffers.get(sampleId);
  if (sampleId && sampleId.startsWith('song:')) { const b = engineSongBuffer(sampleId.slice(5)); if (b) { buffers.set(sampleId, b); return b; } }
  return null;
}
export function sampleName(sampleId) {
  if (names.has(sampleId)) return names.get(sampleId);
  if (sampleId?.startsWith('song:')) return SONGS.find(s => 'song:' + s.id === sampleId)?.title || sampleId;
  return sampleId || '';
}
/** Put a decoded buffer in the memory cache (tests, or audio made in the page). */
export function registerSample(sampleId, buffer, name = sampleId) { buffers.set(sampleId, buffer); names.set(sampleId, name); return sampleId; }

/** Drop a sample from the memory cache (tests; IndexedDB keeps it). */
export function forgetSample(sampleId) { buffers.delete(sampleId); pending.delete(sampleId); }

const DB = 'slowreel-samples', STORE = 'samples';
function idb() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('IndexedDB unavailable'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => { res(q.result); db.close(); }; q.onerror = () => rej(q.error); }); }
async function idbPut(key, val) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(val, key); tx.oncomplete = () => { res(); db.close(); }; tx.onerror = () => rej(tx.error); }); }

async function hashBytes(ab) {
  try { if (crypto?.subtle) { const d = new Uint8Array(await crypto.subtle.digest('SHA-256', ab)); return [...d.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join(''); } } catch (e) { }
  const u = new Uint8Array(ab); let h1 = 0x811c9dc5, h2 = 0x9e3779b9;   // fallback: two FNV-style passes
  for (let i = 0; i < u.length; i++) { h1 = Math.imul(h1 ^ u[i], 16777619); h2 = Math.imul(h2 ^ u[i], 2246822519); }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0') + u.length.toString(16);
}
const decode = (ctx, ab) => new Promise((res, rej) => { const q = ctx.decodeAudioData(ab, res, rej); if (q && q.then) q.then(res, rej); });

/** Import an audio File/Blob: decode, store the bytes in IndexedDB by content hash. -> {sampleId, name, duration}.
 * Throws a readable Error if the file cannot be decoded. Still works (memory only) when IndexedDB is blocked; `stored` says which. */
export async function importSampleFile(ctx, file) {
  const ab = await file.arrayBuffer();
  if (ab.byteLength > 80 * 1024 * 1024) throw new Error('That file is over 80 MB - trim it first.');
  const sampleId = 'imp:' + await hashBytes(ab);
  const name = (file.name || 'sample').replace(/\.[a-z0-9]+$/i, '');
  let buf;
  try { buf = await decode(ctx, ab.slice(0)); } catch (e) { throw new Error(`Could not read "${file.name || 'file'}" as audio.`); }
  registerSample(sampleId, buf, name);
  let stored = true;
  try { await idbPut(sampleId, { name, type: file.type || '', bytes: ab, added: Date.now() }); } catch (e) { stored = false; }
  return { sampleId, name, duration: buf.duration, stored };
}

let songBase = 'audio/';
/** Where Nico's mp3s live (same as the engine's songBaseUrl). */
export function setSampleSongBase(url) { songBase = url.endsWith('/') ? url : url + '/'; }
/** Load a sample: 'song:<id>' from Nico's songs (lib/songs.js), 'imp:<hash>' from IndexedDB. Rejects with err.missing = true if gone. */
export function loadSample(ctx, sampleId) {
  const have = sampleBuffer(sampleId); if (have) return Promise.resolve(have);
  if (pending.has(sampleId)) return pending.get(sampleId);
  let p;
  if (sampleId?.startsWith('song:')) p = engineLoadSong(ctx, sampleId.slice(5), songBase);   // shares the engine's decoded songs
  else if (sampleId?.startsWith('imp:')) p = idbGet(sampleId).catch(() => null).then(rec => {
    if (!rec) { const e = new Error('missing sample ' + sampleId); e.missing = true; throw e; }
    names.set(sampleId, rec.name); return decode(ctx, rec.bytes.slice(0));
  });
  else p = Promise.reject(Object.assign(new Error('no sample'), { missing: true }));
  p = p.then(b => { buffers.set(sampleId, b); pending.delete(sampleId); return b; }, e => { pending.delete(sampleId); throw e; });
  pending.set(sampleId, p);
  return p;
}

/** The sample a track plays: its imported sample, else the 'song' param. */
export function trackSampleId(spec) {
  const s = spec?.instrument?.sample?.sampleId;
  if (s) return s;
  const song = spec?.instrument?.params?.song || PRESET_SONG[spec?.instrument?.preset] || 'after-the-storm';
  return 'song:' + song;
}
/** [{trackId, sampleId, name}] for every Chop Sampler track. */
export function samplesInProject(project) {
  return (project?.tracks || []).filter(t => t.instrument?.id === 'chop').map(t => ({ trackId: t.id, sampleId: trackSampleId(t), name: t.instrument.sample?.name || sampleName(trackSampleId(t)) }));
}
/** Load every sample a project needs (call before play/render). -> {missing: [{trackId, sampleId, name}]} ("re-import <name>"). */
export async function ensureSamples(ctx, project) {
  const missing = [];
  await Promise.all(samplesInProject(project).map(s => loadSample(ctx, s.sampleId).catch(e => { missing.push(s); })));
  return { missing };
}

// ------------------------------------------------------------------ slicing
const sliceCache = new WeakMap();   // buffer -> Map(key -> slices)
/** Region of the sample in seconds for the given params. */
export function regionOf(buffer, p) {
  const dur = buffer.duration, len = clamp(p.length ?? 8, 0.25, dur), start = clamp((p.position ?? 0) * dur, 0, Math.max(0, dur - len));
  return [start, start + len];
}
/** Slices [{start, end}] in seconds. mode 'equal' or 'transient' (onsets by spectral-flux-like energy rise). Cached. */
export function computeSlices(buffer, p) {
  const n = clamp(Math.round(p.slices ?? 16), 1, 32), mode = p.sliceMode || 'equal';
  const [a, b] = regionOf(buffer, p);
  const key = `${mode}|${n}|${a.toFixed(4)}|${b.toFixed(4)}`;
  let m = sliceCache.get(buffer); if (!m) { m = new Map(); sliceCache.set(buffer, m); }
  if (m.has(key)) return m.get(key);
  let cuts = null;
  if (mode === 'transient' && n > 1) cuts = transients(buffer, a, b, n - 1);
  if (!cuts) { cuts = []; for (let i = 1; i < n; i++) cuts.push(a + (b - a) * i / n); }
  const edges = [a, ...cuts, b], out = [];
  for (let i = 0; i < n; i++) out.push({ start: edges[i], end: edges[i + 1] });
  if (m.size > 40) m.clear();
  m.set(key, out);
  return out;
}
/** Up to `max` onset times (s) inside [a, b], strongest first then sorted; null if the region is silent. */
export function transients(buffer, a, b, max) {
  const sr = buffer.sampleRate, ch = [...Array(buffer.numberOfChannels)].map((_, i) => buffer.getChannelData(i));
  const hop = Math.round(sr * 0.01), i0 = Math.floor(a * sr), i1 = Math.min(ch[0].length, Math.floor(b * sr));
  const env = [];
  for (let s = i0; s + hop <= i1; s += hop) { let e = 0; for (const d of ch) for (let i = s; i < s + hop; i += 2) { const x = d[i] - (i > 0 ? d[i - 1] : 0) * 0.5; e += x * x; } env.push(Math.log10(e / hop + 1e-9)); }
  if (env.length < 4 || Math.max(...env) < -7) return null;
  const flux = env.map((v, i) => (i < 2 ? 0 : Math.max(0, v - Math.max(env[i - 1], env[i - 2]))));
  const minGap = Math.max(3, Math.floor(env.length / (max + 1) / 3));
  const peaks = [];
  for (let i = 2; i < flux.length - 1; i++) if (flux[i] > 0.15 && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1]) peaks.push(i);
  peaks.sort((x, y) => flux[y] - flux[x]);
  const chosen = [];
  for (const i of peaks) { if (chosen.length >= max) break; if (i < minGap || chosen.some(j => Math.abs(j - i) < minGap)) continue; chosen.push(i); }
  if (!chosen.length) return null;
  chosen.sort((x, y) => x - y);
  const cuts = chosen.map(i => (i0 + i * hop) / sr - 0.005);
  // too few onsets: split the longest slices so there are always n slices
  while (cuts.length < max) {
    const edges = [a, ...cuts, b]; let k = 0, best = 0;
    for (let i = 0; i < edges.length - 1; i++) if (edges[i + 1] - edges[i] > best) { best = edges[i + 1] - edges[i]; k = i; }
    cuts.push(edges[k] + best / 2); cuts.sort((x, y) => x - y);
  }
  return cuts;
}
export const sliceIndexForMidi = (midi, n) => (((midi - SLICE_BASE_MIDI) % n) + n) % n;

// reversed copy, made once per buffer
const reversed = new WeakMap();
function reversedOf(ctx, buf) {
  let r = reversed.get(buf); if (r) return r;
  r = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) { const s = buf.getChannelData(c), d = r.getChannelData(c), n = s.length; for (let i = 0; i < n; i++) d[i] = s[n - 1 - i]; }
  reversed.set(buf, r); return r;
}
// level match (loudest half of 1 s blocks to about -20 dBFS RMS), like the song cloud
function matchGain(buf) {
  let g = levelGain.get(buf); if (g) return g;
  const d0 = buf.getChannelData(0), sr = buf.sampleRate, blocks = [];
  for (let s = 0; s + sr / 2 <= d0.length; s += sr / 2) { let e = 0, n = 0; for (let i = s; i < s + sr / 2; i += 8) { e += d0[i] * d0[i]; n++; } blocks.push(e / n); }
  if (!blocks.length) blocks.push(0.01);
  blocks.sort((x, y) => y - x);
  const top = blocks.slice(0, Math.max(1, blocks.length >> 1)), rms = Math.sqrt(top.reduce((x, y) => x + y, 0) / top.length);
  g = clamp(0.1 / (rms || 0.1), 0.25, 8); levelGain.set(buf, g); return g;
}

// per-track "Slowed" room (one convolver per track, shared by its voices)
const rooms = new WeakMap();
function roomFor(ctx, tr) {
  let r = rooms.get(tr); if (r) return r;
  const input = ctx.createGain(), conv = ctx.createConvolver(), out = ctx.createGain();
  conv.normalize = false; conv.buffer = makeIR(ctx, 'hall', { size: 1.5, tone: 0.35, preDelay: 0.04 }); out.gain.value = 0.9;
  input.connect(conv); conv.connect(out); out.connect(tr.input);
  r = { input }; rooms.set(tr, r); return r;
}

// ------------------------------------------------------------------ voice
class Voice {
  constructor(ctx, env, t) { this.ctx = ctx; this.env = env; this.t0 = t; this.out = ctx.createGain(); this.srcs = []; this.nodes = [this.out]; this.amps = []; this.rel = 0.2; this.endTime = Infinity; this.released = false; }
  node(n) { this.nodes.push(n); return n; }
  release(t, r = this.rel) { if (this.released) return; this.released = true; t = Math.max(t, this.ctx.currentTime); this.relT = t; for (const a of this.amps) relParam(a, t, r); this.stop(t + r * 1.7 + 0.05); }
  stop(t) {
    t = Math.max(t, this.ctx.currentTime); if (t >= this.endTime) return; this.endTime = t;
    for (const s of this.srcs) { try { s.stop(t); } catch (e) { } }
    const first = this.srcs[0];
    if (first) first.onended = () => { if (this.dead) return; this.dead = true; disconnectAll(...this.nodes); this.env.voiceEnded?.(this); };
    else this.dead = true;
  }
  kill(t) { for (const a of this.amps) relParam(a, t, 0.04); this.released = true; this.stop(t + 0.08); }
}
const vel2amp = v => Math.pow(clamp(v, 0, 1), 1.2);

const PRESET_SONG = { 'vocal-chops': 'hopeful-romantic', 'slowed-loop': 'sleepy-rain', 'stutter-cuts': 'infinite-love', 'tape-keys': 'after-the-storm' };

export const SAMPLER = {
  id: 'chop', name: 'Chop Sampler', kind: 'sampler', maxVoices: 12,
  params: [P('slowed', 'Slowed', 0, 1, 0.35), P('pitch', 'Pitch', -24, 24, 0, { unit: 'st', step: 1 }), P('position', 'Position', 0, 1, 0.3),
    P('tone', 'Tone', 0, 1, 0.7), ENUM('song', 'Song', SONG_OPTS, 'after-the-storm'), P('slices', 'Slices', 4, 32, 16, { step: 1 }),
    ENUM('sliceMode', 'Slicing', MODES, 'equal'), P('length', 'Region', 0.5, 30, 8, { unit: 's' }),
    P('attack', 'Attack', 0.001, 2, 0.005, { unit: 's' }), P('release', 'Release', 0.01, 4, 0.18, { unit: 's' }),
    P('loop', 'Loop', 0, 1, 0, { type: 'toggle' }), P('level', 'Level', 0, 1.5, 1)],
  macros: ['slowed', 'pitch', 'position', 'tone'],
  presets: [
    { id: 'vocal-chops', name: 'Vocal Chops', params: { song: 'hopeful-romantic', position: 0.42, length: 6, slices: 16, sliceMode: 'transient', slowed: 0.5, tone: 0.6, attack: 0.01, release: 0.35 } },
    { id: 'slowed-loop', name: 'Slowed Loop', params: { song: 'sleepy-rain', position: 0.35, length: 12, slices: 4, slowed: 1, tone: 0.5, loop: 1, attack: 0.4, release: 1.5, level: 0.9 } },
    { id: 'stutter-cuts', name: 'Stutter Cuts', params: { song: 'infinite-love', position: 0.5, length: 4, slices: 32, slowed: 0.1, tone: 0.8, attack: 0.002, release: 0.05 } },
    { id: 'tape-keys', name: 'Tape Keys', params: { song: 'after-the-storm', position: 0.3, length: 8, slices: 8, slowed: 0.35, tone: 0.65, release: 0.25 } },
  ],
  voice(ctx, env, p, midi, vel, t) {
    const v = new Voice(ctx, env, t), a = vel2amp(vel);
    const amp = v.node(ctx.createGain()); amp.gain.value = 0; v.amps.push(amp.gain);
    const lp = v.node(ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.Q.value = 0.5; lp.frequency.value = 500 * Math.pow(36, p.tone);
    const declick = v.node(ctx.createGain());
    declick.connect(lp); lp.connect(amp); amp.connect(v.out);
    const keep = ctx.createConstantSource(); keep.offset.value = 0; keep.start(t); v.srcs.push(keep); v.node(keep);
    v.rel = p.release;
    let started = false;
    v.tick = () => {
      if (started || v.released && v.endTime <= ctx.currentTime) return;
      const spec = v.track?.spec, sid = spec ? trackSampleId(spec) : 'song:' + p.song;
      const buf = sampleBuffer(sid);
      if (!buf) { if (!v._asked) { v._asked = true; loadSample(ctx, sid).catch(() => { }); } if (ctx.currentTime > t + 0.4) { started = true; v.stop(ctx.currentTime); } return; }
      started = true;
      const sl = computeSlices(buf, p), idx = sliceIndexForMidi(midi, sl.length), ed = spec?.instrument?.slices?.[idx] || {};
      const s0 = sl[idx].start, s1 = sl[idx].end, L = s1 - s0;
      const st = s0 + L * clamp(ed.start ?? 0, 0, 0.98), en = s0 + L * clamp(ed.end ?? 1, (ed.start ?? 0) + 0.02, 1);
      const rate = Math.pow(2, (p.pitch + (ed.pitch || 0)) / 12) * (1 - 0.25 * p.slowed);
      const rev = !!ed.reverse, src = ctx.createBufferSource();
      src.buffer = rev ? reversedOf(ctx, buf) : buf; src.playbackRate.value = rate;
      const off = rev ? buf.duration - en : st, len = en - st;
      const t0 = Math.max(t, ctx.currentTime + 0.003), late = (t0 - t) * rate;
      src.connect(declick); v.srcs.push(src); v.node(src);
      const pk = a * 0.5 * p.level * matchGain(buf);
      amp.gain.setValueAtTime(0, t0); amp.gain.linearRampToValueAtTime(pk, t0 + Math.max(0.003, p.attack));
      if (p.loop >= 0.5) {
        src.loop = true; src.loopStart = off; src.loopEnd = off + len;
        src.start(t0, off + Math.min(late, len * 0.9));
      } else {
        const play = Math.max(0.01, (len - late) / rate);
        src.start(t0, off + Math.min(late, len * 0.9), len);
        declick.gain.setValueAtTime(1, t0 + Math.max(0, play - 0.006)); declick.gain.linearRampToValueAtTime(0, t0 + play);
        v.stop(Math.min(v.endTime, t0 + play + 0.02));
      }
      if (v.endTime < Infinity) try { src.stop(v.endTime); } catch (e) { }
      // Slowed: more of the voice goes into a per-track hall
      // (Light mode: into the engine's one shared short room instead of a per-track convolver)
      if (p.slowed > 0.02 && v.track) { const wet = v.node(ctx.createGain()); wet.gain.value = p.slowed * 0.55; amp.connect(wet); wet.connect(env.light && env.lightRoomInput ? env.lightRoomInput : roomFor(ctx, v.track).input); }
    };
    return v;
  },
};
export const SAMPLER_INSTRUMENTS = [SAMPLER];

/**
 * Integrator hook, called by the engine at load() after ensureSamples (never on play): does the heavy one-time work a Chop
 * Sampler track needs before its first note - slices (transient detection), the level match, the reversed copy if a slice
 * is reversed, and the "Slowed" hall impulse (skipped in Light mode, which uses the shared room). tr = engine track runtime.
 */
export function warmSampler(ctx, tr, env = {}) {
  const spec = tr?.spec, p = tr?.params; if (!spec || !p) return;
  const buf = sampleBuffer(trackSampleId(spec)); if (!buf) return;
  computeSlices(buf, p); matchGain(buf);
  if ((spec.instrument?.slices || []).some(e => e && e.reverse)) reversedOf(ctx, buf);
  if (p.slowed > 0.02 && !env.light) roomFor(ctx, tr);
}
