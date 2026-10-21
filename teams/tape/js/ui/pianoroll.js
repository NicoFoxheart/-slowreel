// pianoroll.js - note editor for the selected instrument clip: draw (with chord stamp + scale lock), select (click,
// shift-click, marquee, Ctrl+A), move, resize, delete, velocity lane, audition keys. Notes may run as long as you like;
// drawing past the clip end grows the clip.
import { S, on, emit, begin, end, edit, clipOf, snapTo, clamp, bpb, isSongTrack, instDef } from './state.js?v=9a';
import { h } from './controls.js?v=9a';
import { noteName, isBlack, inScale, snapToScale, chordNotes, keyIndex, scaleById } from './theory.js?v=9a';

const LO = 24, HI = 108, RH = 13, KW = 54, RULER = 22, VEL = 58;
let pane, scroller, grid, velLane, notesLayer, headEl, built = null;
const rowY = m => (HI - m) * RH;
const pitchAt = y => clamp(HI - Math.floor(y / RH), LO, HI);
let lastLen = 2, lastDrumLen = 0.25;
// drum kits (janggu, taiko: kind 'drums' with a drumMap): rows are named voices, no scale lock, no chord stamp
const drumMapOf = t => { const d = instDef(t?.instrument?.id); return d?.kind === 'drums' && Array.isArray(d.drumMap) ? d.drumMap : null; };
const lockFor = t => S.lock && !drumMapOf(t);

export function initRoll(paneEl) {
  pane = paneEl;
  on('render', ch => { if (S.tab === 'notes') render(ch); });
  on('select', () => { if (S.tab === 'notes') render(); });
}

export function render() {
  const f = clipOf();
  if (!f || isSongTrack(f.t) || f.c.song) { built = null; return false; }
  const { t, c } = f;
  const keySig = `${c.id}|${c.startBeat}|${S.prZoom}|${S.project.key}|${S.project.scale}|${c.lengthBeats}|${t.color}|${t.instrument?.id || ''}`;
  if (built !== keySig || !pane.contains(scroller)) build(t, c, keySig);
  drawNotes(t, c);
  return true;
}

function build(t, c, sig) {
  const keepScroll = built && built.split('|')[0] === c.id ? { l: scroller.scrollLeft, t: scroller.scrollTop } : null;
  built = sig;
  pane.textContent = '';
  const extra = 8 * bpb();
  const beats = c.lengthBeats + extra, W = beats * S.prZoom, Hh = (HI - LO + 1) * RH;
  scroller = h('div', { class: 'scroller', 'data-scroll': '', tabindex: 0, id: 'roll-scroll', 'aria-label': 'Piano roll. Arrows move selected notes, Shift+arrows resize, Delete removes, Ctrl+A selects all.' });
  const pr = h('div', { class: 'pr', style: { width: KW + W + 'px', '--c': t.color, '--beatpx': S.prZoom + 'px', '--barpx': S.prZoom * bpb() + 'px' } });
  // ruler
  const rul = h('div', { class: 'pr-bars', style: { width: W + 'px' } });
  for (let b = 0; b < beats; b += bpb()) rul.append(h('span', { class: 'bar', style: { left: b * S.prZoom + 'px' }, text: String(Math.floor((c.startBeat + b) / bpb()) + 1) }));
  pr.append(h('div', { class: 'pr-ruler' }, h('div', { class: 'pr-corner' }), rul));
  // keys + grid
  const keys = h('div', { class: 'pr-keys', style: { height: Hh + 'px' } });
  const rows = h('div', { class: 'rows' });
  const root = keyIndex(S.project.key), dm = drumMapOf(t), drumAt = new Map((dm || []).map(d => [d.midi, d]));
  for (let m = HI; m >= LO; m--) {
    const dv = drumAt.get(m);
    const inS = dm ? !!dv : inScale(m, S.project.key, S.project.scale), isC = m % 12 === 0, isRoot = !dm && ((m - root) % 12 + 12) % 12 === 0;
    const k = h('div', { class: 'pr-key' + (isBlack(m) ? ' blk' : '') + (isC ? ' c' : '') + (dv ? ' drum' : ''), 'data-m': m, title: dv ? dv.name : null,
      text: dv ? (dv.short || dv.name) : isC || isRoot ? noteName(m) : '' });
    keys.append(k);
    rows.append(h('div', { class: 'row' + (inS ? '' : ' out') + (isBlack(m) ? ' blk' : '') + (isRoot ? ' root' : '') + (isC ? ' c' : '') }));
  }
  keys.addEventListener('pointerdown', e => { const k = e.target.closest('.pr-key'); if (!k) return; e.preventDefault(); audition(+k.dataset.m, true, k); });
  grid = h('div', { class: 'pr-grid', style: { width: W + 'px', height: Hh + 'px' } }, rows,
    h('div', { class: 'beyond', style: { left: c.lengthBeats * S.prZoom + 'px' } }),
    notesLayer = h('div', { class: 'notes' }), headEl = h('div', { class: 'pr-head' }));
  pr.append(h('div', { class: 'pr-main' }, keys, grid));
  // velocity
  velLane = h('div', { class: 'vel-lane', style: { width: W + 'px' }, 'aria-label': 'Velocity: drag a bar up or down' });
  pr.append(h('div', { class: 'pr-vel' }, h('div', { class: 'pr-corner' }, h('span', { class: 'label', text: 'Vel' })), velLane));
  scroller.append(pr); pane.append(scroller);
  grid.addEventListener('pointerdown', gridDown);
  grid.addEventListener('dblclick', e => { const n = e.target.closest('.note'); if (n) { const f = clipOf(); edit(() => { f.c.notes.splice(+n.dataset.i, 1); }, { type: 'notes', trackId: f.t.id }); S.sel.notes.clear(); } });
  velLane.addEventListener('pointerdown', velDown);
  scroller.addEventListener('keydown', keyDown);
  scroller.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2); } }, { passive: false });
  // initial scroll: centre on the notes
  requestAnimationFrame(() => {
    if (keepScroll) { scroller.scrollLeft = keepScroll.l; scroller.scrollTop = keepScroll.t; return; }
    const ns = c.notes || []; const mid = dm ? 38 : ns.length ? ns.reduce((a, n) => a + n.p, 0) / ns.length : 60 + root;
    scroller.scrollTop = Math.max(0, rowY(Math.round(mid)) - scroller.clientHeight / 2 + RULER);
  });
}

function drawNotes(t, c) {
  notesLayer.textContent = ''; velLane.textContent = '';
  (c.notes || []).forEach((n, i) => {
    const sel = S.sel.notes.has(i);
    const el = h('div', { class: 'note' + (sel ? ' sel' : ''), 'data-i': i, title: `${noteName(n.p)} · vel ${Math.round((n.v ?? 0.8) * 100)}`,
      style: { left: n.s * S.prZoom + 'px', top: rowY(n.p) + 'px', width: Math.max(4, n.d * S.prZoom - 1) + 'px', '--v': (n.v ?? 0.8).toFixed(2) } }, h('span', { class: 'rz' }));
    notesLayer.append(el);
    velLane.append(h('div', { class: 'vel-bar' + (sel ? ' sel' : ''), 'data-i': i, style: { left: n.s * S.prZoom + 'px', height: Math.max(2, (n.v ?? 0.8) * (VEL - 14)) + 'px' } }));
  });
  pane.querySelector('.pr-keys')?.querySelectorAll('.pr-key.on').forEach(k => k.classList.remove('on'));
}

export function zoom(f) { S.prZoom = clamp(S.prZoom * f, 12, 200); render(); emit('roll-zoom'); }

// ---------------------------------------------------------------- audition
let auditionT = null;
function audition(m, hold, keyEl) {
  const f = clipOf(); if (!f) return;
  S.engine?.noteOn(f.t.id, m, S.vel); keyEl?.classList.add('on');
  const off = () => { S.engine?.noteOff(f.t.id, m); keyEl?.classList.remove('on'); window.removeEventListener('pointerup', off); };
  if (hold) window.addEventListener('pointerup', off); else { clearTimeout(auditionT); auditionT = setTimeout(off, 280); }
}

// ---------------------------------------------------------------- grid gestures
function local(e) { const r = grid.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function gridDown(e) {
  if (e.button !== 0) return;
  const f = clipOf(); if (!f) return;
  const { t, c } = f; const notes = c.notes || (c.notes = []);
  scroller.focus({ preventScroll: true });
  e.preventDefault();
  const p0 = local(e), snap = S.prSnap || 0;
  const noteEl = e.target.closest('.note');
  if (noteEl) {
    const i = +noteEl.dataset.i;
    if (e.shiftKey) { S.sel.notes.has(i) ? S.sel.notes.delete(i) : S.sel.notes.add(i); drawNotes(t, c); return; }
    if (!S.sel.notes.has(i)) { S.sel.notes.clear(); S.sel.notes.add(i); drawNotes(t, c); }
    audition(notes[i].p, false);
    const resize = e.target.classList.contains('rz');
    const orig = [...S.sel.notes].map(j => ({ j, s: notes[j].s, p: notes[j].p, d: notes[j].d }));
    let moved = false, dup = e.altKey;
    const mv = ev => {
      const p = local(ev), dx = (p.x - p0.x) / S.prZoom, dy = Math.round((p0.y - p.y) / RH);
      if (!moved && Math.abs(p.x - p0.x) < 3 && Math.abs(p.y - p0.y) < 3) return;
      if (!moved) { moved = true; begin(); if (dup) { orig.forEach(o => notes.push({ ...notes[o.j] })); } }
      for (const o of orig) {
        const n = notes[o.j];
        if (resize) { n.d = Math.max(snap || 0.0625, snap ? snapTo(o.s + o.d + dx, snap) - o.s : o.d + dx); }
        else {
          n.s = Math.max(0, snap ? snapTo(o.s + dx, snap) : o.s + dx);
          let np = clamp(o.p + dy, LO, HI); if (lockFor(t) && dy) np = snapToScale(np, S.project.key, S.project.scale); n.p = np;
        }
      }
      growClip(c, notes);
      drawNotes(t, c);
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (moved) { if (!drumMapOf(t)) lastLen = notes[orig[0].j].d; end({ type: 'notes', trackId: t.id }); } };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    return;
  }
  // empty space: marquee (select tool or Shift) or draw
  if (S.tool === 'select' || e.shiftKey) {
    const add = e.shiftKey ? new Set(S.sel.notes) : new Set();
    const mq = h('div', { class: 'marquee' }); grid.append(mq);
    const mv = ev => {
      const p = local(ev), x0 = Math.min(p0.x, p.x), y0 = Math.min(p0.y, p.y), x1 = Math.max(p0.x, p.x), y1 = Math.max(p0.y, p.y);
      Object.assign(mq.style, { left: x0 + 'px', top: y0 + 'px', width: x1 - x0 + 'px', height: y1 - y0 + 'px' });
      S.sel.notes = new Set(add);
      notes.forEach((n, i) => { const nx0 = n.s * S.prZoom, nx1 = nx0 + n.d * S.prZoom, ny0 = rowY(n.p), ny1 = ny0 + RH; if (nx1 > x0 && nx0 < x1 && ny1 > y0 && ny0 < y1) S.sel.notes.add(i); });
      drawNotes(t, c);
    };
    const up = () => { mq.remove(); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); drawNotes(t, c); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    if (!e.shiftKey) { S.sel.notes.clear(); drawNotes(t, c); }
    return;
  }
  // draw
  const start = Math.max(0, snap ? Math.floor(p0.x / S.prZoom / snap) * snap : p0.x / S.prZoom);
  const drum = !!drumMapOf(t), lock = lockFor(t);
  let root = pitchAt(p0.y); if (lock) root = snapToScale(root, S.project.key, S.project.scale);
  const ps = (drum ? [root] : chordNotes(root, S.chord, lock, S.project.key, S.project.scale)).filter(m => m >= LO && m <= HI);
  begin();
  const first = notes.length;
  ps.forEach(p => notes.push({ p, s: start, d: drum ? lastDrumLen : lastLen, v: S.vel }));
  S.sel.notes = new Set(ps.map((_, k) => first + k));
  growClip(c, notes); drawNotes(t, c);
  ps.forEach(p => audition(p, false));
  const mv = ev => {
    const p = local(ev), endB = snap ? Math.max(start + snap, Math.ceil(p.x / S.prZoom / snap) * snap) : Math.max(start + 0.0625, p.x / S.prZoom);
    for (let k = first; k < notes.length; k++) notes[k].d = endB - start;
    growClip(c, notes); drawNotes(t, c);
  };
  const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (drum) lastDrumLen = notes[first]?.d || lastDrumLen; else lastLen = notes[first]?.d || lastLen; end({ type: 'notes', trackId: t.id }); render(); };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
/** Grow the clip (in whole bars) when notes run past its end. */
function growClip(c, notes) {
  const last = Math.max(0, ...notes.map(n => n.s + n.d));
  if (last > c.lengthBeats + 0.001) { const B = bpb(); c.lengthBeats = Math.ceil(last / B) * B; }
}

function velDown(e) {
  const f = clipOf(); if (!f) return; const { t, c } = f; const notes = c.notes || [];
  e.preventDefault();
  const r = velLane.getBoundingClientRect(), bx = (e.clientX - r.left) / S.prZoom;
  let best = -1, bd = 1e9;
  notes.forEach((n, i) => { const d = Math.abs(n.s - bx) * S.prZoom - (S.sel.notes.has(i) ? 3 : 0); if (d < bd) { bd = d; best = i; } });
  if (best < 0 || bd > 12) return;
  const targets = S.sel.notes.has(best) ? [...S.sel.notes] : [best];
  begin();
  const set = ev => { const v = clamp(1 - (ev.clientY - r.top - 4) / (VEL - 14), 0.05, 1); targets.forEach(i => { notes[i].v = Math.round(v * 100) / 100; }); drawNotes(t, c); };
  set(e);
  const up = () => { window.removeEventListener('pointermove', set); window.removeEventListener('pointerup', up); end({ type: 'notes', trackId: t.id }); };
  window.addEventListener('pointermove', set); window.addEventListener('pointerup', up);
}

function keyDown(e) {
  const f = clipOf(); if (!f) return; const { t, c } = f; const notes = c.notes || [];
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); e.stopPropagation(); S.sel.notes = new Set(notes.map((_, i) => i)); drawNotes(t, c); return; }
  if (!S.sel.notes.size) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault(); e.stopPropagation();
    edit(() => { c.notes = notes.filter((_, i) => !S.sel.notes.has(i)); }, { type: 'notes', trackId: t.id });
    S.sel.notes.clear(); render(); return;
  }
  if (mod && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault(); e.stopPropagation();
    const sel = [...S.sel.notes].map(i => notes[i]); const span = Math.max(...sel.map(n => n.s + n.d)) - Math.min(...sel.map(n => n.s));
    edit(() => { const first = notes.length; sel.forEach(n => notes.push({ ...n, s: n.s + span })); S.sel.notes = new Set(sel.map((_, k) => first + k)); growClip(c, notes); }, { type: 'notes', trackId: t.id });
    render(); return;
  }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  if (!(e.key in arrows)) return;
  e.preventDefault(); e.stopPropagation();
  const [dx, dy] = arrows[e.key], step = S.prSnap || 0.25;
  edit(() => {
    for (const i of S.sel.notes) {
      const n = notes[i];
      if (e.shiftKey && dx) n.d = Math.max(step, n.d + dx * step);
      else if (dx) n.s = Math.max(0, n.s + dx * step);
      else if (dy) {
        let np = n.p + dy * (e.shiftKey ? 12 : 1);
        if (lockFor(t) && !e.shiftKey) { while (np >= LO && np <= HI && !inScale(np, S.project.key, S.project.scale)) np += dy; }
        n.p = clamp(np, LO, HI);
      }
    }
    growClip(c, notes);
  }, { type: 'notes', trackId: t.id });
  if (dy) audition(notes[[...S.sel.notes][0]].p, false);
  render();
}

export function setRollHead(beat) {
  const f = clipOf(); if (!headEl || !f || built?.split('|')[0] !== f.c.id) return;
  const x = (beat - f.c.startBeat) * S.prZoom;
  const disp = x < 0 || x > (f.c.lengthBeats) * S.prZoom ? 'none' : 'block', tx = `translateX(${Math.round(x * 2) / 2}px)`;
  if (headEl._d !== disp) { headEl._d = disp; headEl.style.display = disp; }   // write only what changed
  if (headEl._t !== tx) { headEl._t = tx; headEl.style.transform = tx; }
}
export function markKey(m, onOff) { pane.querySelector(`.pr-key[data-m="${m}"]`)?.classList.toggle('on', onOff); }
void scaleById;
