// store.js - app state, events, undo/redo and engine sync. Every edit goes through commit() or a gesture.

export const S = {
  project: null, engine: null, ctx: null, store: null, saver: null, engineKind: 'mock',
  sel: { trackId: null, clipId: null, notes: new Set(), target: 'track' },   // target: track | space | echo | master
  view: { ppb: 8, snap: 1, follow: true, dock: 'roll', keysOn: true, octave: 4, vel: 0.75 },
  rec: { armed: false, notes: [], open: new Map() },
  undo: [], redo: [],
};

const subs = new Map();
export const on = (ev, fn) => { if (!subs.has(ev)) subs.set(ev, new Set()); subs.get(ev).add(fn); return () => subs.get(ev).delete(fn); };
export const emit = (ev, data) => subs.get(ev)?.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });

export const track = id => S.project?.tracks.find(t => t.id === (id ?? S.sel.trackId)) || null;
export const selTrack = () => track(S.sel.trackId);
export const selClip = () => { const t = selTrack(); return t?.clips.find(c => c.id === S.sel.clipId) || null; };
export const findClip = id => { for (const t of S.project.tracks) { const c = t.clips.find(x => x.id === id); if (c) return { t, c }; } return null; };
export const uid = p => `${p}${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}`;
export const spb = () => 60 / (S.project?.bpm || 70);
export const beatsPerBar = () => S.project?.beatsPerBar || 4;
export const songBeats = () => (S.project?.lengthBars || 32) * beatsPerBar();
export const snapBeat = (b, snap = S.view.snap) => (snap > 0 ? Math.round(b / snap) * snap : Math.round(b * 64) / 64);

const MAX_UNDO = 150;
let syncTimer = null;
function syncEngine(change) {
  if (!S.engine) return;
  if (change?.type === 'mix' || change?.type === 'param') { try { S.engine.applyChange?.(S.project, change); } catch (e) { console.warn(e); } return; }
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const p = S.engine.applyChange ? S.engine.applyChange(S.project, change || { type: 'structure' }) : S.engine.load(S.project);
    Promise.resolve(p).catch(e => console.warn('[daylong] engine sync', e));
  }, 40);
}
function after(change) {
  S.saver?.touch(); emit('dirty');
  syncEngine(change);
  emit('project', change || {});
}

/** Apply an edit with undo. fn(project) mutates. change: {type:'structure'|'notes'|'mix'|'param', ...} */
export function commit(fn, change) {
  const before = JSON.stringify(S.project);
  fn(S.project);
  if (JSON.stringify(S.project) === before) return false;
  S.undo.push(before); if (S.undo.length > MAX_UNDO) S.undo.shift(); S.redo = [];
  after(change); return true;
}
/** For continuous gestures (knobs, drags): snapshot once, mutate live, then end(). */
export function gesture() {
  const before = JSON.stringify(S.project);
  return {
    end(change) { const now = JSON.stringify(S.project); if (now === before) return false; S.undo.push(before); if (S.undo.length > MAX_UNDO) S.undo.shift(); S.redo = []; after(change); return true; },
    cancel() { S.project = JSON.parse(before); after({ type: 'structure' }); },
  };
}
export function undo() { if (!S.undo.length) return; S.redo.push(JSON.stringify(S.project)); restore(S.undo.pop()); }
export function redo() { if (!S.redo.length) return; S.undo.push(JSON.stringify(S.project)); restore(S.redo.pop()); }
function restore(json) {
  const keep = S.project; S.project = JSON.parse(json); S.project.id = keep.id;
  validateSel(); S.saver?.touch(); emit('dirty');
  Promise.resolve(S.engine?.load(S.project)).catch(() => {});
  emit('project', { type: 'structure', undo: true });
}
export function validateSel() {
  const t = track(S.sel.trackId) || S.project.tracks[0];
  S.sel.trackId = t?.id || null;
  if (!t?.clips.some(c => c.id === S.sel.clipId)) { S.sel.clipId = null; S.sel.notes.clear(); }
}
/** Replace the whole project (open, new, demo). */
export async function setProject(p) {
  S.project = p; S.undo = []; S.redo = []; S.sel = { trackId: p.tracks[0]?.id || null, clipId: null, notes: new Set(), target: 'track' };
  if (S.engine) { try { S.engine.stop(); } catch { /* idle */ } await S.engine.load(p); }
  emit('project', { type: 'open' }); emit('select');
}
export function select({ trackId, clipId, target } = {}) {
  if (trackId !== undefined) S.sel.trackId = trackId;
  if (clipId !== undefined) { if (clipId !== S.sel.clipId) S.sel.notes.clear(); S.sel.clipId = clipId; }
  S.sel.target = target || 'track';
  emit('select');
}

// Day palette: the song is a day. t in 0..1 -> {zen, hor} colours. Shared by the arrange sky, horizon and visuals.
export const DAY = [
  [0.00, '#8ea4d6', '#ffcfb2'], [0.10, '#8bb8ea', '#ffe1c2'], [0.28, '#6cb0ef', '#def0ff'], [0.48, '#4c9eee', '#cde8ff'],
  [0.66, '#6ba5e3', '#fde3bb'], [0.78, '#7b8fd0', '#ffbf8c'], [0.87, '#5a5c9c', '#f19c97'], [0.94, '#2b3876', '#77729f'], [1.00, '#131c3e', '#2a3868'],
];
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
export function dayAt(t) {
  t = Math.min(1, Math.max(0, t));
  let i = 0; while (i < DAY.length - 2 && DAY[i + 1][0] < t) i++;
  const [t0, z0, h0] = DAY[i], [t1, z1, h1] = DAY[i + 1], k = (t - t0) / (t1 - t0 || 1);
  return { zen: mix(hex(z0), hex(z1), k), hor: mix(hex(h0), hex(h1), k) };
}
export const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
export const TOD = ['dawn', 'morning', 'noon', 'golden hour', 'dusk', 'night'];
export const todAt = t => TOD[Math.min(5, Math.floor(Math.max(0, t) * 5.999 * 0.999 + (t > 0.86 ? 0.3 : 0)))];
export const TRACK_COLORS = ['#4c9be8', '#f2a65a', '#e58fa0', '#5dbfa8', '#9a8fd8', '#e0b440', '#3fa7b5', '#ee7d63', '#7d8fb3', '#6fb4d6'];
