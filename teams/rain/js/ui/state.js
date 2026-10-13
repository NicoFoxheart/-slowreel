// state.js - the one source of truth for the UI: project, selection, view settings, undo history, the engine
// and the transport. Views listen with on('project'|'select'|'ui'|'transport'|'tick'|'audio', fn).
import { openProjects, autosave, newId } from '../../lib/storage.js';
import { toast } from './dom.js';

export const S = {
  project: null, engine: null, ctx: null, audioOn: false, engineName: 'mock',
  catalog: { instruments: [], effects: [], demo: null },
  sel: { trackId: null, clipId: null, notes: new Set() },
  inspect: { kind: 'track' },           // {kind:'track'} | {kind:'bus', bus} | {kind:'master'}
  ui: { ppb: 22, snap: 1, rollPpb: 44, chord: 'single', scaleLock: true, octave: 4, vel: 0.8, dock: 'roll', insp: 'sound', follow: true, keysOn: true },
  transport: { playing: false, beat: 0, startBeat: 0, recording: false },
  store: null, saver: null, saveState: 'saved',
};
const L = {};
export const on = (ev, fn) => ((L[ev] ||= []).push(fn), () => (L[ev] = L[ev].filter(f => f !== fn)));
export const emit = (ev, d) => (L[ev] || []).forEach(f => { try { f(d); } catch (e) { console.warn(ev, e); } });

// ---------------------------------------------------------------- lookups
export const P = () => S.project;
export const track = id => S.project.tracks.find(t => t.id === id);
export const selTrack = () => track(S.sel.trackId) || null;
export function findClip(id) { for (const t of S.project.tracks) { const c = t.clips.find(c => c.id === id); if (c) return { t, c }; } return null; }
export const selClip = () => (S.sel.clipId ? findClip(S.sel.clipId) : null);
export const instDef = id => S.catalog.instruments.find(i => i.id === id) || null;
export const fxDef = id => S.catalog.effects.find(f => f.id === id) || null;
export const totalBeats = () => S.project.lengthBars * S.project.beatsPerBar;
export const spb = () => 60 / S.project.bpm;
export function snapBeat(b, mode = 'round') { const s = S.ui.snap; if (!s) return b; return Math[mode](b / s) * s; }

export function select({ trackId, clipId, keepNotes } = {}) {
  if (trackId !== undefined) S.sel.trackId = trackId;
  if (clipId !== undefined) { if (clipId !== S.sel.clipId && !keepNotes) S.sel.notes.clear(); S.sel.clipId = clipId; }
  if (trackId !== undefined || clipId !== undefined) S.inspect = { kind: 'track' };
  emit('select');
}

// ---------------------------------------------------------------- history + edits
const undoStack = [], redoStack = [];
const snap = () => JSON.stringify(S.project);
export const canUndo = () => undoStack.length > 0, canRedo = () => redoStack.length > 0;
/** Make an edit. `fn(project)` mutates; `sync` tells the engine how to follow: 'load' | 'mix' | 'master' | 'none'. */
export function commit(label, fn, { sync = 'load', trackId, merge } = {}) {
  const before = snap();
  const top = undoStack[undoStack.length - 1];
  if (!(merge && top && top.merge === merge && Date.now() - top.at < 1200)) undoStack.push({ json: before, label, merge, at: Date.now() });
  else top.at = Date.now();
  if (undoStack.length > 120) undoStack.shift();
  redoStack.length = 0;
  fn(S.project);
  changed(sync, trackId);
}
export function changed(sync = 'load', trackId) {
  S.project.updatedAt = new Date().toISOString();
  S.saveState = 'dirty'; emit('save');
  S.saver?.touch();
  emit('project', { sync, trackId });
  syncEngine(sync, trackId);
}
export function undo() { if (!undoStack.length) return; const u = undoStack.pop(); redoStack.push({ json: snap(), label: u.label }); restore(u.json); toast('Undid ' + u.label); }
export function redo() { if (!redoStack.length) return; const r = redoStack.pop(); undoStack.push({ json: snap(), label: r.label }); restore(r.json); toast('Redid ' + r.label); }
function restore(json) {
  const p = JSON.parse(json); Object.keys(S.project).forEach(k => delete S.project[k]); Object.assign(S.project, p);
  if (!track(S.sel.trackId)) S.sel.trackId = S.project.tracks[0]?.id || null;
  if (S.sel.clipId && !findClip(S.sel.clipId)) S.sel.clipId = null;
  S.sel.notes.clear(); changed('load'); emit('select');
}
export function clearHistory() { undoStack.length = 0; redoStack.length = 0; emit('project', { sync: 'none' }); }

// ---------------------------------------------------------------- engine
let loadT = null, loadBusy = null;
export function syncEngine(sync, trackId) {
  const e = S.engine; if (!e || sync === 'none') return;
  try {
    if ((sync === 'mix' || sync === 'master') && typeof e.applyChange === 'function') { const r = e.applyChange(S.project, sync === 'mix' ? { type: 'mix', trackId } : { type: 'master' }); r?.catch?.(err => console.warn(err)); return; }
  } catch (err) { console.warn('applyChange failed, reloading', err); }
  clearTimeout(loadT); loadT = setTimeout(reloadEngine, sync === 'load-now' ? 0 : 90);
}
export async function reloadEngine() {
  if (!S.engine) return; if (loadBusy) { await loadBusy; }
  loadBusy = Promise.resolve(S.engine.load(S.project)).catch(e => { console.error('engine.load', e); toast('The sound engine stumbled on that edit', 'warn'); }).finally(() => (loadBusy = null));
  return loadBusy;
}
/** Live, cheap parameter change while a knob moves (the commit that follows makes it durable). */
export function liveParam(target, id, value) { try { S.engine?.setParam?.(target, id, value); } catch (e) { /* engine may not know this id; the commit's load covers it */ } }

let createEngineFn = null, startingAudio = null;
export function setEngineFactory(fn, name) { createEngineFn = fn; S.engineName = name; }
/** Create the AudioContext + live engine. Only ever called from a user gesture (play, a key, a pad, a click). */
export function ensureAudio() {
  if (S.audioOn) { if (S.ctx.state !== 'running') S.ctx.resume(); return Promise.resolve(true); }
  if (startingAudio) return startingAudio;
  startingAudio = (async () => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    S.ctx = ctx; if (ctx.state !== 'running') ctx.resume().catch(() => {});
    S.engine = await createEngineFn({ context: ctx });
    await S.engine.load(S.project);
    S.audioOn = true; document.documentElement.classList.add('audio-on'); emit('audio');
    return true;
  })().catch(e => { console.error('audio start failed', e); toast('Sound could not start: ' + (e.message || e), 'warn'); startingAudio = null; return false; });
  return startingAudio;
}

// ---------------------------------------------------------------- transport
export async function play(fromBeat) {
  if (!(await ensureAudio())) return;
  if (loadBusy) await loadBusy;
  const b = fromBeat ?? S.transport.beat;
  S.transport.startBeat = b; S.engine.play(b); S.transport.playing = true; emit('transport');
}
export function pause() { if (!S.engine) return; const pos = S.engine.position(); S.engine.stop(); S.transport.playing = false; S.transport.beat = pos.beat; emit('transport'); }
export function stop() {
  if (S.transport.playing) { S.engine.stop(); S.transport.playing = false; S.transport.beat = S.transport.startBeat; }
  else S.transport.beat = 0;
  S.engine?.seek?.(S.transport.beat); emit('transport'); emit('tick', S.transport.beat);
}
export function togglePlay() { S.transport.playing ? pause() : play(); }
export function seek(beat) {
  beat = Math.max(0, Math.min(beat, totalBeats())); S.transport.beat = beat;
  if (S.transport.playing) { S.engine.play(beat); S.transport.startBeat = beat; } else S.engine?.seek?.(beat);
  emit('tick', beat);
}
export function setLoop(on, s, e) {
  const lp = S.project.loop; commit(on !== lp.on ? (on ? 'loop on' : 'loop off') : 'loop region', p => { p.loop = { on, startBeat: s ?? lp.startBeat, endBeat: e ?? lp.endBeat }; }, { sync: 'none', merge: 'loop' });
  S.engine?.setLoop?.(S.project.loop.on, S.project.loop.startBeat, S.project.loop.endBeat);
}

// ---------------------------------------------------------------- projects
export const fresh = p => { const c = JSON.parse(JSON.stringify(p)); c.id = newId('p'); c.createdAt = c.updatedAt = new Date().toISOString(); return c; };
export function normalize(p) {
  p.schema ||= 'nfx-studio/1'; p.bpm ||= 66; p.beatsPerBar ||= 4; p.key ||= 'C'; p.scale ||= 'major'; p.lengthBars ||= 32;
  p.loop ||= { on: false, startBeat: 0, endBeat: 16 }; p.tracks ||= []; p.buses ||= { space: { fx: [] }, echo: { fx: [] } };
  p.buses.space ||= { fx: [] }; p.buses.echo ||= { fx: [] }; p.master ||= { volumeDb: 0, atmosphere: 0.5, fx: [] };
  for (const t of p.tracks) { t.clips ||= []; t.fx ||= []; t.sends ||= { space: 0.4, echo: 0 }; t.volumeDb ??= 0; t.pan ??= 0; for (const c of t.clips) { if (t.kind !== 'song') c.notes ||= []; c.id ||= newId('c'); } }
  return p;
}
export async function openProject(p, { keepHistory } = {}) {
  const wasPlaying = S.transport.playing; if (wasPlaying) pause();
  S.project = normalize(p); S.transport.beat = 0;
  S.sel = { trackId: p.tracks.find(t => t.kind !== 'song')?.id || p.tracks[0]?.id || null, clipId: null, notes: new Set() };
  try { localStorage.setItem('lamplit.last', p.id); } catch (e) {}
  if (!keepHistory) clearHistory();
  emit('open'); emit('project', { sync: 'load' }); emit('select'); emit('tick', 0);
  if (S.engine) { S.engine.stop(); await reloadEngine(); }
}
export async function initStore() {
  S.store = await openProjects({ appKey: 'lamplit-rain' });
  S.saver = autosave(S.store, () => S.project, 1500, {
    onSave: () => { S.saveState = 'saved'; emit('save'); },
    onError: e => { S.saveState = 'error'; emit('save'); console.warn('autosave', e); toast(e?.code === 'too_large' ? 'This project is too big to save' : 'Saving failed - your work is still here', 'warn'); },
  });
  return S.store;
}
