// state.js - the one shared UI state, edit history and a tiny event hub. Every view reads S and calls edit().
export const S = {
  engine: null, ctx: null, store: null, saver: null,
  project: null,
  sel: { trackId: null, clipId: null, notes: new Set() },
  zoom: 18,            // arrange: px per beat
  prZoom: 48,          // piano roll: px per beat
  snap: 1,             // arrange snap (beats)
  prSnap: 0.5,         // piano roll snap (beats)
  tool: 'draw',        // piano roll: draw | select
  chord: 'off', lock: true,
  follow: true, rec: false, octave: 4, vel: 0.75,
  tab: 'notes', fxTarget: 'track',
  playing: false,
  audioReady: false,
  simple: true,        // Simple mode (view only): Notes / Sound / Keys, no automation keys, a shorter clip toolbar
  light: false,        // Light mode (weaker PCs): lighter sound engine, visuals at 20 fps
  autoOpen: new Set(), // track ids whose automation lane is shown under the track (view state, not saved)
  autoSel: {},         // trackId -> automation lane key shown
};

const subs = new Map();
export const on = (ev, fn) => { (subs.get(ev) || subs.set(ev, new Set()).get(ev)).add(fn); };
export const emit = (ev, data) => subs.get(ev)?.forEach(fn => { try { fn(data); } catch (e) { console.warn('[ui]', ev, e); } });

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const uid = (p = 'x') => p + Math.random().toString(36).slice(2, 8);
export const clone = o => JSON.parse(JSON.stringify(o));
export const bpb = () => S.project?.beatsPerBar || 4;
export const songBeats = () => (S.project?.lengthBars || 16) * bpb();
export const track = id => S.project?.tracks.find(t => t.id === (id ?? S.sel.trackId)) || null;
export const clipOf = (id = S.sel.clipId) => { for (const t of S.project?.tracks || []) { const c = t.clips.find(c => c.id === id); if (c) return { t, c }; } return null; };
export const isSongTrack = t => t && (t.kind === 'song');
export const snapTo = (b, s) => (s > 0 ? Math.round(b / s) * s : b);
export const fmtTime = s => { s = Math.max(0, s); const m = Math.floor(s / 60); return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };

// ---------------------------------------------------------------- history (snapshots; projects are small)
const undo = [], redo = [];
let pending = null;
/** Take a snapshot before a gesture that mutates S.project in place (drags). Call end() when it is over. */
export function begin() { if (!pending) pending = JSON.stringify(S.project); }
export function end(change = { type: 'all' }, { render = true } = {}) {
  if (!pending) return;
  const before = pending; pending = null;
  if (before === JSON.stringify(S.project)) return;
  push(before); changed(change, render);
}
/** One-shot edit: fn mutates S.project. */
export function edit(fn, change = { type: 'all' }, { render = true } = {}) {
  const before = JSON.stringify(S.project);
  const r = fn(S.project);
  if (before === JSON.stringify(S.project)) return r;
  push(before); changed(change, render);
  return r;
}
function push(before) { undo.push(before); if (undo.length > 120) undo.shift(); redo.length = 0; emit('history'); }
export function changed(change, render = true) {
  S.project.updatedAt = Date.now();
  S.saver?.touch(); emit('dirty');
  try {
    const eng = S.engine;
    if (eng) { if (change.type === 'all' || !eng.applyChange) eng.load(S.project); else eng.applyChange(S.project, change); }
  } catch (e) { console.warn('[ui] engine update', e); }
  if (render) emit('render', change);
}
export const canUndo = () => undo.length > 0, canRedo = () => redo.length > 0;
export function doUndo() { if (!undo.length) return; redo.push(JSON.stringify(S.project)); restore(undo.pop()); }
export function doRedo() { if (!redo.length) return; undo.push(JSON.stringify(S.project)); restore(redo.pop()); }
function restore(json) {
  S.project = JSON.parse(json);
  if (!clipOf()) S.sel.clipId = null;
  if (!track()) S.sel.trackId = S.project.tracks[0]?.id || null;
  S.sel.notes.clear();
  S.engine?.load(S.project);
  S.saver?.touch(); emit('dirty'); emit('history'); emit('render', { type: 'all' }); emit('project');
}
export function resetHistory() { undo.length = 0; redo.length = 0; pending = null; emit('history'); }

// ---------------------------------------------------------------- definitions (real engine and mock differ a little)
export const optId = o => (o && typeof o === 'object' ? (o.id ?? o.value) : o);
export const optName = o => (o && typeof o === 'object' ? (o.name ?? o.label ?? o.id ?? o.value) : String(o));
export const instDef = id => S.engine?.instruments.find(i => i.id === id) || null;
/** Instruments grouped for pickers: Slowreel's own first, the Antent pack (synths, bass, drums, samplers), then the
 *  East Asian pack by region. */
export const INST_REGIONS = ['', 'Pads & Synths', 'Bass', 'Drums', 'Samplers', 'Voices', 'Korean', 'Chinese', 'Japanese'];
export const instGroups = () => INST_REGIONS.map(r => ({ region: r, label: r || 'Slowreel', items: (S.engine?.instruments || []).filter(d => (d.region || '') === r) })).filter(g => g.items.length);
export const fxDef = id => S.engine?.effects.find(e => e.id === id) || null;
export const isSongParam = p => Array.isArray(p.options) && p.options.length > 3 && p.options.every(o => /^[a-z0-9-]+$/.test(optId(o))) && p.options.some(o => optId(o) === 'sleepy-rain');
export const isEnum = p => Array.isArray(p.options) || p.type === 'enum';
export const isToggle = p => p.type === 'toggle' || (p.id === 'freeze' && p.min === 0 && p.max === 1);
/** Current value of an instrument parameter: track override, else preset (real engine), else default. */
export function instValue(t, p) {
  const ov = t.instrument?.params || {};
  if (ov[p.id] !== undefined) return ov[p.id];
  const pre = S.engine?.presetParams?.(t.instrument.id, t.instrument.preset);
  if (pre && pre[p.id] !== undefined) return pre[p.id];
  return p.default;
}
export function fxValue(fx, p) { return fx.params?.[p.id] !== undefined ? fx.params[p.id] : p.default; }
