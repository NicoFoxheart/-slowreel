// steps.js - BEATS lane: step-sequencer editor for a Drum Machine clip (rows = drum voices, MIDI 36-51).
// It reads and writes the clip's ordinary `notes` array ({p, s, d, v}), so the project schema and the engine are unchanged.
// Small optional metadata lives in `clip.beat = {steps, swing, mute:[midi], muted:[notes]}` (the engine ignores it):
// notes of a muted row move to `clip.beat.muted` and come back on unmute, so `notes` is always exactly what plays.
// Swing 0-0.75 is written into the notes as offsets: every odd 16th step starts `swing * stepBeats` late.
//
// Integrator: initSteps(document.getElementById('pane-beats')); call renderSteps() when the Beats tab opens.
// It listens to 'render' / 'select' itself while isActive() (default: S.tab === 'beats').
import { S, on, emit, begin, end, edit, clipOf, clamp, uid, bpb, track, instDef } from './state.js?v=9d';
import { h, knob } from './controls.js?v=9d';
import { DRUM_MAP } from '../sound/drums.js?v=9d';

export const STEP_BEATS = 0.25;                    // one step = a 16th note
export const MIN_STEPS = 4, MAX_STEPS = 128;       // 128 steps = 8 bars of 4/4
export const MAX_SWING = 0.75;
export const DRUM_ROWS = DRUM_MAP.map(d => ({ midi: d.midi, name: d.name, short: d.short }));
const ROW_SET = new Set(DRUM_ROWS.map(r => r.midi));
const VEL_STEPS = [1, 0.7, 0.4];                   // alt-click cycles accent -> normal -> ghost

// any drum kit: the Drum Machine, or an instrument of kind 'drums' with a drumMap (janggu, taiko)
export const isDrumTrack = t => !!t && t.kind !== 'song' && (t.instrument?.id === 'drums' || (() => { const d = instDef(t.instrument?.id); return d?.kind === 'drums' && Array.isArray(d.drumMap) && d.drumMap.length > 0; })());
// the rows the editor shows for a track: its kit's own drumMap (janggu / taiko: 5 named voices), else the Drum Machine's 16
const rowsFor = t => { const d = t?.instrument?.id !== 'drums' ? instDef(t?.instrument?.id) : null; return d?.drumMap?.length ? d.drumMap.filter(r => ROW_SET.has(r.midi)).map(r => ({ midi: r.midi, name: r.name, short: r.short || r.name })) : DRUM_ROWS; };
let ROWS = DRUM_ROWS;
const r4 = x => Math.round(x * 10000) / 10000;

// ---------------------------------------------------------------- pure helpers (no DOM; tested in tests/round2-beats.*)
/** The clip's step settings with defaults filled in (does not modify the clip). */
export function beatInfo(c) {
  const b = c.beat || {};
  const steps = clamp(Math.round(b.steps ?? (c.lengthBeats || 4) / STEP_BEATS), MIN_STEPS, MAX_STEPS);
  return { steps, swing: clamp(+b.swing || 0, 0, MAX_SWING), mute: Array.isArray(b.mute) ? b.mute : [], muted: Array.isArray(b.muted) ? b.muted : [] };
}
const meta = c => { const i = beatInfo(c); c.beat = { steps: i.steps, swing: i.swing, mute: i.mute.slice(), muted: i.muted.slice() }; return c.beat; };
export const swingOffset = (step, swing) => (step % 2 === 1 ? swing * STEP_BEATS : 0);
export const stepPos = (step, swing) => r4(step * STEP_BEATS + swingOffset(step, swing));
/** Nearest step index for a note start `s` (beats) under `swing`. */
export function stepOf(s, swing) {
  const k0 = Math.floor(s / STEP_BEATS + 1e-6);
  let best = Math.max(0, k0), bd = Infinity;
  for (let k = Math.max(0, k0 - 1); k <= k0 + 1; k++) { const d = Math.abs(s - stepPos(k, swing)); if (d < bd - 1e-9) { bd = d; best = k; } }
  return best;
}
const allDrumNotes = c => [...(c.notes || []), ...beatInfo(c).muted];
/** Grid view of the clip: {steps, swing, rows: Map(midi -> Array(steps) of velocity, 0 = off), mute:Set} */
export function readGrid(c) {
  const { steps, swing, mute } = beatInfo(c);
  const rows = new Map(DRUM_ROWS.map(r => [r.midi, new Array(steps).fill(0)]));
  for (const n of allDrumNotes(c)) {
    if (!ROW_SET.has(n.p)) continue;
    const k = stepOf(n.s, swing); if (k >= steps) continue;
    rows.get(n.p)[k] = Math.max(rows.get(n.p)[k], clamp(n.v ?? 0.8, 0.01, 1));
  }
  return { steps, swing, rows, mute: new Set(mute) };
}
// find the note for (midi, step) in notes or muted notes
function findNote(c, midi, step) {
  const { swing } = beatInfo(c);
  for (const list of [c.notes || [], c.beat?.muted || []]) {
    const i = list.findIndex(n => n.p === midi && stepOf(n.s, swing) === step);
    if (i >= 0) return { list, i, n: list[i] };
  }
  return null;
}
const sortNotes = list => list.sort((a, b) => a.s - b.s || a.p - b.p);
/** Turn a step on (with velocity) or off. Returns true if the step is now on. */
export function setStep(c, midi, step, vel) {
  const m = meta(c); c.notes = c.notes || [];
  const f = findNote(c, midi, step);
  if (!vel) { if (f) f.list.splice(f.i, 1); return false; }
  vel = r4(clamp(vel, 0.05, 1));
  if (f) { f.n.v = vel; return true; }
  const n = { p: midi, s: stepPos(step, m.swing), d: STEP_BEATS, v: vel };
  (m.mute.includes(midi) ? m.muted : c.notes).push(n);
  sortNotes(c.notes); sortNotes(m.muted);
  return true;
}
export const getStep = (c, midi, step) => findNote(c, midi, step)?.n.v || 0;
export function toggleStep(c, midi, step, vel = 0.8) { return setStep(c, midi, step, getStep(c, midi, step) ? 0 : vel); }
/** Next accent level for alt-click: off -> ghost(0.4); 1 -> 0.7 -> 0.4 -> 1 */
export function nextVel(v) { if (!v) return 0.4; const i = VEL_STEPS.findIndex(x => v >= x - 0.05); return VEL_STEPS[(i < 0 ? VEL_STEPS.length - 1 : i + 1) % VEL_STEPS.length]; }
/** Re-time every drum note to the new swing (notes snap to their nearest step). */
export function setSwing(c, swing) {
  const m = meta(c), old = m.swing; swing = r4(clamp(swing, 0, MAX_SWING));
  for (const n of [...(c.notes || []), ...m.muted]) { if (!ROW_SET.has(n.p)) continue; n.s = stepPos(stepOf(n.s, old), swing); }
  m.swing = swing;
  return swing;
}
/** Pattern length in steps; the clip length follows (notes past the end are kept but do not play). */
export function setLength(c, steps) {
  const m = meta(c); m.steps = clamp(Math.round(steps), MIN_STEPS, MAX_STEPS);
  c.lengthBeats = m.steps * STEP_BEATS;
  return m.steps;
}
/** Copy the pattern `times` times after itself (e.g. 16 steps x2 -> 32 steps). */
export function repeatPattern(c, times = 2) {
  const m = meta(c), L = m.steps, n2 = clamp(L * times, MIN_STEPS, MAX_STEPS), len = L * STEP_BEATS;
  for (const key of ['notes', 'muted']) {
    const list = key === 'notes' ? (c.notes = c.notes || []) : m.muted;
    const base = list.filter(n => n.s < len - 1e-6);
    const rest = list.filter(n => n.s >= len - 1e-6 && !ROW_SET.has(n.p));   // drop old drum notes past the pattern
    const out = [...base, ...rest];
    for (let r = 1; r * L < n2; r++) for (const n of base) { const s = r4(n.s + r * len); if (s < n2 * STEP_BEATS) out.push({ ...n, s }); }
    sortNotes(out);
    if (key === 'notes') c.notes = out; else m.muted = out;
  }
  return setLength(c, n2);
}
/** Mute or unmute a row: its notes move between clip.notes and clip.beat.muted. */
export function setRowMute(c, midi, mute) {
  const m = meta(c); c.notes = c.notes || [];
  const has = m.mute.includes(midi);
  if (mute && !has) { m.mute.push(midi); m.muted.push(...c.notes.filter(n => n.p === midi)); c.notes = c.notes.filter(n => n.p !== midi); }
  if (!mute && has) { m.mute = m.mute.filter(x => x !== midi); c.notes.push(...m.muted.filter(n => n.p === midi)); m.muted = m.muted.filter(n => n.p !== midi); sortNotes(c.notes); }
  return mute;
}
export function clearPattern(c) { const m = meta(c); c.notes = (c.notes || []).filter(n => !ROW_SET.has(n.p)); m.muted = []; }

// ---------------------------------------------------------------- view
const CW = 22, RH = 21, HEADW = 132;
let pane = null, isActive = () => S.tab === 'beats', root = null, gridEl = null, phEl = null, built = '', cells = new Map(), cursor = { r: 0, k: 0 };
let phTimer = null;

export function initSteps(paneEl, opts = {}) {
  pane = paneEl; if (opts.isActive) isActive = opts.isActive;
  injectCss();
  on('render', ch => { if (ch?.type === 'mixer-live') return; if (isActive()) renderSteps(); });
  on('select', () => { if (isActive()) renderSteps(); });
}

/** Draw the editor for the selected clip. Returns true when a drum clip is shown. */
export function renderSteps() {
  if (!pane) return false;
  const f = clipOf();
  if (!f || !isDrumTrack(f.t) || f.c.song) { empty(); return false; }
  const { t, c } = f, g = readGrid(c);
  ROWS = rowsFor(t);
  const sig = `${c.id}|${g.steps}|${t.color}|${bpb()}|${g.mute.size}|${ROWS.length}`;
  if (sig !== built || !pane.contains(root)) build(t, c, g, sig);
  else refresh(t, c, g);
  tickPlayhead();
  return true;
}

function empty() {
  built = ''; cells.clear(); pane.textContent = '';
  const t = track(), drum = S.project?.tracks.find(isDrumTrack);
  const box = h('div', { class: 'stp-empty' },
    h('p', { class: 'label', text: 'Beats' }),
    h('p', { text: isDrumTrack(t) ? 'Pick a pattern on this drum track, or start a new one.' : 'Select a clip on a drum track (Drum Machine, janggu or taiko) to edit its steps.' }));
  const dt = isDrumTrack(t) ? t : drum;
  if (dt) {
    const acts = h('div', { class: 'stp-acts' });
    dt.clips.slice(0, 6).forEach((c, i) => acts.append(h('button', { class: 'key sm', id: `stp-open-${i}`, text: c.name || `Bar ${Math.floor(c.startBeat / bpb()) + 1}`,
      onclick: () => { S.sel.trackId = dt.id; S.sel.clipId = c.id; S.sel.notes.clear(); emit('select'); } })));
    acts.append(h('button', { class: 'key sm', id: 'stp-new', text: 'New 1-bar pattern', onclick: () => newPattern(dt.id) }));
    box.append(acts);
  }
  pane.append(box);
}

function newPattern(trackId) {
  const id = uid('c');
  edit(p => {
    const tr = p.tracks.find(x => x.id === trackId);
    const start = Math.max(0, ...tr.clips.map(c => c.startBeat + c.lengthBeats));
    const c = { id, startBeat: Math.ceil(start / bpb()) * bpb(), lengthBeats: 4, notes: [], beat: { steps: 16, swing: 0, mute: [], muted: [] } };
    // a starting groove: kick 1 + 3, closed hats on 8ths
    const kit = rowsFor(tr);
    if (kit === DRUM_ROWS) { for (const k of [0, 8]) setStep(c, 36, k, 0.9); for (let k = 2; k < 16; k += 4) setStep(c, 42, k, 0.6); }
    else { for (const k of [0, 8]) setStep(c, kit[0].midi, k, 0.9); for (const k of [4, 12]) setStep(c, (kit[1] || kit[0]).midi, k, 0.6); }
    tr.clips.push(c);
  }, { type: 'clips', trackId });
  S.sel.trackId = trackId; S.sel.clipId = id; S.sel.notes.clear(); emit('select');
}

function commit(fn, t) { edit(() => fn(clipOf().c), { type: 'notes', trackId: t.id }); }

function build(t, c, g, sig) {
  built = sig; pane.textContent = ''; cells.clear();
  const keepX = root?.querySelector('.stp-scroll')?.scrollLeft || 0;
  root = h('div', { class: 'stp', style: { '--c': t.color, '--cw': CW + 'px', '--rh': RH + 'px', '--hw': HEADW + 'px' } });
  // toolbar
  const lenKeys = h('div', { class: 'stp-group', role: 'group', 'aria-label': 'Pattern length' }, h('span', { class: 'label', text: 'Steps' }));
  for (const n of [8, 12, 16, 24, 32, 64]) lenKeys.append(h('button', { class: 'key sm', id: `stp-len-${n}`, 'aria-pressed': String(g.steps === n), text: String(n), onclick: () => commit(cc => setLength(cc, n), t) }));
  lenKeys.append(
    h('button', { class: 'key sm sq', id: 'stp-len-dn', 'aria-label': 'One step shorter', text: '−', onclick: () => commit(cc => setLength(cc, beatInfo(cc).steps - 1), t) }),
    h('span', { class: 'mono stp-num', id: 'stp-len-val', text: String(g.steps) }),
    h('button', { class: 'key sm sq', id: 'stp-len-up', 'aria-label': 'One step longer', text: '+', onclick: () => commit(cc => setLength(cc, beatInfo(cc).steps + 1), t) }));
  const sw = knob({ id: 'swing', name: 'Swing', min: 0, max: MAX_SWING, default: 0, unit: '%' }, { value: g.swing, size: 'sm', color: 'var(--saffron)', idPrefix: 'stp',
    onInput: v => { begin(); setSwing(clipOf().c, v); refresh(t, clipOf().c, readGrid(clipOf().c)); },
    onCommit: v => { begin(); setSwing(clipOf().c, v); end({ type: 'notes', trackId: t.id }); } });
  const bar = h('div', { class: 'stp-bar' }, lenKeys,
    h('div', { class: 'stp-group' },
      h('button', { class: 'key sm', id: 'stp-x2', title: 'Copy the pattern after itself', disabled: g.steps * 2 > MAX_STEPS, onclick: () => commit(cc => repeatPattern(cc, 2), t), text: 'Repeat ×2' }),
      h('button', { class: 'key sm', id: 'stp-clear', onclick: () => commit(cc => clearPattern(cc), t), text: 'Clear' })),
    h('div', { class: 'stp-swing' }, sw),
    h('span', { class: 'label stp-hint', text: 'click · drag to paint · drag up/down = velocity · alt-click = accent' }));
  // grid
  const scroll = h('div', { class: 'scroller stp-scroll', tabindex: 0, id: 'stp-scroll', role: 'grid', 'aria-label': 'Drum steps. Arrows and Home/End move, Space or Enter toggles, A cycles accent, M mutes the row, Delete clears.' });
  gridEl = h('div', { class: 'stp-grid', style: { width: HEADW + g.steps * CW + 'px' } });
  const ruler = h('div', { class: 'stp-row stp-ruler' }, h('div', { class: 'stp-head' }, h('span', { class: 'label', text: 'Voice' })));
  for (let k = 0; k < g.steps; k++) ruler.append(h('div', { class: 'stp-num-cell mono' + (k % 4 === 0 ? ' beat' : '') + (k % (4 * bpb()) === 0 ? ' bar' : ''), 'data-k': k,
    text: k % 4 === 0 ? (k % (4 * bpb()) === 0 ? String(Math.floor(k / (4 * bpb())) + 1) : '·') : '' }));
  gridEl.append(ruler);
  ROWS.forEach((r, ri) => {
    const muted = g.mute.has(r.midi);
    const mk = h('button', { class: 'key sm stp-m led-saffron', id: `stp-mute-${r.midi}`, 'aria-pressed': String(muted), 'aria-label': `Mute ${r.name}`, title: 'Mute row', onclick: () => commit(cc => setRowMute(cc, r.midi, !beatInfo(cc).mute.includes(r.midi)), t) }, 'M', h('span', { class: 'led' }));
    const nm = h('button', { class: 'stp-name', id: `stp-name-${r.midi}`, title: `${r.name} · MIDI ${r.midi} · click to hear`, onpointerdown: e => { e.preventDefault(); audition(t, r.midi, 0.85); } },
      h('span', { class: 'mono stp-short', text: r.short }), h('span', { class: 'stp-full', text: r.name }));
    const row = h('div', { class: 'stp-row' + (muted ? ' muted' : '') + (ri % 2 ? ' alt' : ''), role: 'row', 'data-m': r.midi }, h('div', { class: 'stp-head' }, mk, nm));
    for (let k = 0; k < g.steps; k++) {
      const cell = h('div', { class: 'stp-cell' + (Math.floor(k / 4) % 2 ? ' odd' : '') + (k % 4 === 0 ? ' beat' : ''), role: 'gridcell', 'data-m': r.midi, 'data-k': k, 'data-r': ri }, h('i'));
      cells.set(r.midi + ':' + k, cell); row.append(cell);
    }
    gridEl.append(row);
  });
  phEl = h('div', { class: 'stp-ph', hidden: true });
  gridEl.append(phEl);
  scroll.append(gridEl);
  root.append(bar, scroll); pane.append(root);
  scroll.scrollLeft = keepX;
  gridEl.addEventListener('pointerdown', e => cellDown(e, t));
  scroll.addEventListener('keydown', e => keyDown(e, t));
  refresh(t, c, g);
}

function paintCell(cell, v, cur) {
  cell.classList.toggle('on', v > 0); cell.style.setProperty('--v', v ? v.toFixed(2) : '0');
  cell.setAttribute('aria-selected', String(v > 0));
  cell.title = v ? `vel ${Math.round(v * 100)}` : '';
  cell.classList.toggle('cur', !!cur);
}
function refresh(t, c, g) {
  for (const r of ROWS) { const a = g.rows.get(r.midi); for (let k = 0; k < g.steps; k++) { const cell = cells.get(r.midi + ':' + k); if (cell) paintCell(cell, a[k], cursor.r === ROWS.indexOf(r) && cursor.k === k && root?.contains(document.activeElement) && document.activeElement.id === 'stp-scroll'); } }
  const lv = root?.querySelector('#stp-len-val'); if (lv) lv.textContent = String(g.steps);
  root?.querySelectorAll('[id^="stp-len-"]').forEach(b => { const n = +b.id.slice(8); if (n) b.setAttribute('aria-pressed', String(n === g.steps)); });
  const k = root?.querySelector('#stp-swing'); if (k && k.get && Math.abs(k.get() - g.swing) > 1e-4 && document.activeElement !== k) k.set(g.swing);
}

let audT = new Map();
function audition(t, midi, vel) {
  const eng = S.engine; if (!eng?.noteOn) return;
  try { eng.noteOn(t.id, midi, vel); clearTimeout(audT.get(midi)); audT.set(midi, setTimeout(() => { try { eng.noteOff(t.id, midi); } catch (e) { } }, 160)); } catch (e) { }
}

function cellDown(e, t) {
  if (e.button !== 0) return;
  const cell = e.target.closest('.stp-cell'); if (!cell) return;
  e.preventDefault(); gridEl.parentElement.focus({ preventScroll: true });
  const f = clipOf(); if (!f) return; const c = f.c;
  const midi = +cell.dataset.m, k0 = +cell.dataset.k, ri = +cell.dataset.r;
  cursor = { r: ri, k: k0 };
  const was = getStep(c, midi, k0);
  begin();
  if (e.altKey) { const v = nextVel(was); setStep(c, midi, k0, v); audition(t, midi, v); end({ type: 'notes', trackId: t.id }); return; }
  const x0 = e.clientX, y0 = e.clientY;
  let mode = was ? 'pending' : 'paint';
  const done = new Set([k0]); let lastK = k0;
  if (!was) { setStep(c, midi, k0, S.vel ?? 0.8); audition(t, midi, S.vel ?? 0.8); }
  refresh(t, c, readGrid(c));
  const mv = ev => {
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    if (mode === 'pending') { if (Math.abs(dy) > 4 && Math.abs(dy) >= Math.abs(dx)) mode = 'vel'; else if (Math.abs(dx) > CW / 2) { mode = 'erase'; setStep(c, midi, k0, 0); } else return; }
    if (mode === 'vel') { setStep(c, midi, k0, clamp(was - dy / 90, 0.05, 1)); }
    else {
      // paint / erase along the starting row only, filling any steps skipped by a fast drag
      const r = gridEl.getBoundingClientRect(), k = clamp(Math.floor((ev.clientX - r.left - HEADW) / CW), 0, beatInfo(c).steps - 1);
      const lo = Math.min(k, lastK), hi = Math.max(k, lastK);
      for (let j = lo; j <= hi; j++) if (!done.has(j)) { done.add(j); setStep(c, midi, j, mode === 'paint' ? (S.vel ?? 0.8) : 0); }
      lastK = k;
    }
    refresh(t, c, readGrid(c));
  };
  const up = () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
    if (mode === 'pending') setStep(c, midi, k0, 0);
    end({ type: 'notes', trackId: t.id });
    refresh(t, c, readGrid(c));
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}

function keyDown(e, t) {
  const f = clipOf(); if (!f) return; const c = f.c, steps = beatInfo(c).steps;
  const mv = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
  const r = ROWS[cursor.r];
  if (mv) { cursor = { r: clamp(cursor.r + mv[0], 0, ROWS.length - 1), k: clamp(cursor.k + mv[1], 0, steps - 1) }; }
  else if (e.key === 'Home' || e.key === 'End') { cursor = { r: cursor.r, k: e.key === 'Home' ? 0 : steps - 1 }; }
  else if (e.key === ' ' || e.key === 'Enter') { commit(cc => { if (toggleStep(cc, r.midi, cursor.k, S.vel ?? 0.8)) audition(t, r.midi, S.vel ?? 0.8); }, t); }
  else if (e.key === 'a' || e.key === 'A') { commit(cc => setStep(cc, r.midi, cursor.k, nextVel(getStep(cc, r.midi, cursor.k))), t); }
  else if (e.key === 'm' || e.key === 'M') { commit(cc => setRowMute(cc, r.midi, !beatInfo(cc).mute.includes(r.midi)), t); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { commit(cc => setStep(cc, r.midi, cursor.k, 0), t); }
  else return;
  e.preventDefault(); e.stopPropagation();
  const cc = clipOf()?.c; if (cc && root?.isConnected) refresh(t, cc, readGrid(cc));
  cells.get(ROWS[cursor.r].midi + ':' + cursor.k)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// playhead: polls the engine while the transport runs; sleeps when the pane is hidden or stopped
function tickPlayhead() {
  if (phTimer) return;
  const step = () => {
    phTimer = null;
    if (!root?.isConnected || !isActive()) { if (phEl) phEl.hidden = true; return; }
    const f = clipOf(), pos = S.engine?.position?.();
    let show = false;
    if (f && pos && pos.playing) {
      const local = pos.beat - f.c.startBeat;
      if (local >= 0 && local < f.c.lengthBeats) { const k = Math.floor(local / STEP_BEATS); phEl.style.transform = `translateX(${HEADW + k * CW}px)`; show = true; }
    }
    phEl.hidden = !show;
    phTimer = pos?.playing ? requestAnimationFrame(step) : setTimeout(step, 300);
  };
  step();
}

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('stp-css')) return;
  document.head.append(h('style', { id: 'stp-css', text: CSS }));
}
const CSS = `
.stp { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.stp-bar { display: flex; align-items: center; gap: var(--s4); padding: 6px var(--s3); border-bottom: 1px solid var(--seam-strong); background: var(--panel); flex-wrap: wrap; min-height: 54px; }
.stp-group { display: flex; align-items: center; gap: 4px; }
.stp-group .label { margin-right: 4px; }
.stp-num { font: 600 12px/1 var(--f-mono); min-width: 28px; text-align: center; color: var(--ink); }
.stp-swing .knob { transform: scale(.92); }
.stp-hint { margin-left: auto; color: var(--ink-4); letter-spacing: .06em; }
.stp-scroll { background: var(--lane); }
.stp-grid { position: relative; padding-bottom: 6px; }
.stp-row { display: flex; height: var(--rh); }
.stp-row.alt .stp-head { background: var(--panel); }
.stp-head { position: sticky; left: 0; z-index: 3; width: var(--hw); flex: none; display: flex; align-items: center; gap: 5px; padding: 0 6px; background: var(--panel-hi); border-right: 1px solid var(--seam-strong); border-bottom: 1px solid rgba(18,22,24,.06); }
.stp-ruler { position: sticky; top: 0; z-index: 4; height: 22px; background: var(--panel); border-bottom: 1px solid var(--seam-strong); }
.stp-ruler .stp-head { background: var(--panel); border-bottom: 0; }
.stp-num-cell { width: var(--cw); flex: none; font: 500 9px/22px var(--f-mono); color: var(--ink-4); text-align: center; }
.stp-num-cell.bar { color: var(--ink-2); font-weight: 700; border-left: 1px solid var(--seam-strong); }
.stp-m.key.sm { width: 25px; justify-content: flex-start; padding-left: 5px; min-height: 17px; height: 17px; padding: 0; font: 700 9px/1 var(--f-sans); border-radius: 4px; }
.stp-m .led { top: 2px; right: 2px; width: 4px; height: 4px; }
.stp-m[aria-pressed="true"] { background: linear-gradient(#FFC93A, #F2A900); }
.stp-name { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; background: none; border: 0; padding: 0; cursor: pointer; text-align: left; color: var(--ink); }
.stp-short { font: 700 9.5px/1 var(--f-mono); color: var(--c); filter: saturate(1.1) brightness(.85); width: 26px; flex: none; }
.stp-full { font: 500 11px/1 var(--f-sans); color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stp-name:active .stp-full { color: var(--signal); }
.stp-row.muted .stp-full, .stp-row.muted .stp-short { color: var(--ink-4); }
.stp-cell { width: var(--cw); flex: none; padding: 2px 1.5px; cursor: pointer; touch-action: none; border-bottom: 1px solid rgba(18,22,24,.05); }
.stp-cell.odd { background: rgba(18,22,24,.035); }
.stp-cell.beat { border-left: 1px solid rgba(18,22,24,.10); }
.stp-cell i { display: block; height: 100%; border-radius: 3px; background: linear-gradient(#FAFBFA, #E4E7E5); box-shadow: inset 0 1px 0 rgba(255,255,255,.9), inset 0 -1px 0 rgba(0,0,0,.10), 0 0 0 1px rgba(18,22,24,.08); position: relative; overflow: hidden; }
.stp-cell:hover i { background: linear-gradient(#FFFFFF, #ECEEEC); }
.stp-cell.on i { background: color-mix(in srgb, var(--c) calc(40% + var(--v) * 60%), #FFFFFF); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 70%, #000 25%), inset 0 1px 0 rgba(255,255,255,.35); }
.stp-cell.on i::after { content: ""; position: absolute; left: 2px; right: 2px; bottom: 2px; height: calc((var(--rh) - 10px) * var(--v)); max-height: calc(100% - 4px); border-radius: 1px; background: rgba(255,255,255,.55); }
.stp-row.muted .stp-cell.on i { background: color-mix(in srgb, var(--c) 18%, #FFFFFF); box-shadow: inset 0 0 0 1px rgba(18,22,24,.2); }
.stp-cell.cur i { outline: 2px solid var(--cobalt); outline-offset: 0; }
.stp-ph { position: absolute; top: 0; bottom: 0; left: 0; width: var(--cw); background: rgba(236,78,32,.13); border-left: 2px solid var(--signal); pointer-events: none; z-index: 2; }
.stp-ph[hidden] { display: none; }
.stp-empty { padding: var(--s5); display: flex; flex-direction: column; gap: var(--s2); color: var(--ink-2); font: var(--t-ui); }
.stp-acts { display: flex; gap: 6px; flex-wrap: wrap; }
`;
