// arrange.js - the multitrack timeline: track heads, lanes, clips (move / resize / duplicate / delete, also by keyboard),
// ruler with seek + loop strip, playhead, zoom, snap. All edits go through state.edit / begin+end (undoable).
import { S, on, emit, edit, begin, end, track, clipOf, snapTo, songBeats, bpb, uid, clamp, isSongTrack, instDef, optName, instGroups } from './state.js?v=8';
import { h, icon } from './controls.js?v=8';
import { SONGS, getSong } from '../../lib/songs.js?v=8';
import { TRACK_COLORS } from './sample-project.js?v=8';
import { createAutomationEditor, automationTargets } from './automation.js?v=8';

const HEAD = 196, ROW = 50, RULER = 30, MAX_TRACKS = 16;
let root, scroller, overlay = {}, laneW = 0, totalBeats = 0;
// Layout values the playhead needs every frame, kept up to date by observers so the animation loop never forces a
// layout (reading clientWidth / scrollLeft right after writing styles made every frame recalculate the page).
let viewW = 0, viewLeft = 0, meterEls = null, lastHeadX = NaN, lastRulerV = '';
const dpr = () => Math.min(2, window.devicePixelRatio || 1);
const xOf = b => b * S.zoom;

export function initArrange(scrollEl, rootEl) {
  scroller = scrollEl; root = rootEl;
  on('render', ch => { if (!ch || ch.type !== 'mixer-live') render(); });
  on('select', () => markSelection());
  scroller.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX);
  }, { passive: false });
  new ResizeObserver(() => { const w = scroller.clientWidth; viewW = w; viewLeft = scroller.scrollLeft; if (Math.abs(w - (scroller._w || 0)) > 40) { scroller._w = w; render(); } }).observe(scroller);
  scroller.addEventListener('scroll', () => { viewLeft = scroller.scrollLeft; }, { passive: true });
  viewW = scroller.clientWidth;
}

export function fitZoom() {
  const avail = Math.max(300, scroller.clientWidth - HEAD - 24);
  S.zoom = clamp(avail / songBeats(), 6, 40);
}
export function zoomBy(f, clientX) {
  const r = scroller.getBoundingClientRect();
  const px = clientX !== undefined ? clientX - r.left - HEAD : (scroller.clientWidth - HEAD) / 2;
  const beat = (scroller.scrollLeft + px) / S.zoom;
  S.zoom = clamp(S.zoom * f, 4, 120);
  render();
  scroller.scrollLeft = Math.max(0, beat * S.zoom - px);
}

// ---------------------------------------------------------------- render
export function render() {
  if (!S.project) return;
  const p = S.project, B = bpb();
  const lastEnd = Math.max(0, ...p.tracks.flatMap(t => t.clips.map(c => c.startBeat + c.lengthBeats)));
  totalBeats = Math.max(songBeats(), lastEnd) + 8 * B;
  laneW = Math.max(xOf(totalBeats), scroller.clientWidth - HEAD);
  totalBeats = laneW / S.zoom;
  const sl = scroller.scrollLeft, st = scroller.scrollTop;
  root.textContent = '';
  root.style.width = HEAD + laneW + 'px';
  const barPx = xOf(B);
  root.style.setProperty('--barpx', barPx + 'px'); root.style.setProperty('--beatpx', S.zoom + 'px');

  // ruler
  const ruler = h('div', { class: 'ruler', style: { width: laneW + 'px' }, role: 'slider', tabindex: 0, id: 'arr-ruler', 'aria-label': 'Song position (drag the top strip to set the loop)', 'aria-valuemin': 0, 'aria-valuemax': songBeats() });
  const step = barPx < 26 ? 4 : barPx < 48 ? 2 : 1;
  for (let bar = 0; bar * B < totalBeats; bar++) {
    if (bar % step === 0) ruler.append(h('span', { class: 'bar', style: { left: xOf(bar * B) + 'px' }, text: String(bar + 1) }));
    else ruler.append(h('span', { class: 'bar minor', style: { left: xOf(bar * B) + 'px' } }));
  }
  const lp = p.loop || { on: false, startBeat: 0, endBeat: 16 };
  ruler.append(h('div', { class: 'loopstrip', title: 'Drag here to set the loop' }),
    h('div', { class: 'loopband' + (lp.on ? ' on' : ''), style: { left: xOf(lp.startBeat) + 'px', width: xOf(lp.endBeat - lp.startBeat) + 'px' } }),
    overlay.mark = h('div', { class: 'ph-mark' }));
  const corner = h('div', { class: 'arr-corner' },
    h('span', { class: 'label', text: `${p.tracks.length} tracks` }),
    h('span', { class: 'label end-label', text: `${p.lengthBars} bars` }));
  root.append(h('div', { class: 'arr-ruler' }, corner, ruler));
  bindRuler(ruler);

  // rows
  const rows = h('div', { class: 'rows' });
  p.tracks.forEach((t, i) => { rows.append(trackRow(t, i)); if (S.autoOpen.has(t.id) && !S.simple) rows.append(autoRow(t, B)); });
  // add row
  const canAdd = p.tracks.length < MAX_TRACKS;
  let addRow;
  rows.append(addRow = h('div', { class: 'add-row' },
    h('div', { class: 'thead' }, h('div', { class: 'add-btns' },
      h('button', { class: 'key sm', id: 'add-inst-track', disabled: !canAdd, 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: e => openInstPicker(e.currentTarget) }, '+ Instrument'),
      h('button', { class: 'key sm', id: 'add-song-track', disabled: !canAdd, onclick: () => addTrack('song') }, '+ Song track'))),
    h('div', { class: 'lane empty-lane', style: { width: laneW + 'px' } })));
  // a blank tape: no tracks yet, one friendly way in (the same instrument picker as "+ Instrument")
  if (!p.tracks.length) {
    addRow.hidden = true;
    rows.append(h('div', { class: 'arr-empty', id: 'arr-empty', style: { width: Math.max(320, viewW || scroller.clientWidth) + 'px' } },
      h('button', { class: 'key dark first-inst', id: 'first-inst', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: e => openInstPicker(e.currentTarget) }, icon('plus'), 'Add your first instrument'),
      h('p', {}, 'Pick a sound, then play it on your computer keys: ', h('span', { class: 'kbd', text: 'A S D F' }), ' white, ', h('span', { class: 'kbd', text: 'W E T Y U' }), ' black.')));
  }
  root.append(rows);

  // overlays (in lane coordinates)
  // automation lanes make rows taller than ROW: measure where the add row starts (render only, never per frame)
  const hgt = S.autoOpen.size && !S.simple && p.tracks.length ? Math.round(addRow.getBoundingClientRect().top - root.getBoundingClientRect().top) : RULER + p.tracks.length * ROW;
  root.append(
    overlay.loop = h('div', { class: 'loopshade', hidden: !lp.on, style: { left: HEAD + xOf(lp.startBeat) + 'px', width: xOf(lp.endBeat - lp.startBeat) + 'px', top: RULER + 'px', height: (hgt - RULER) + 'px' } }),
    h('div', { class: 'endshade', style: { left: HEAD + xOf(songBeats()) + 'px', width: Math.max(0, laneW - xOf(songBeats())) + 'px', top: RULER + 'px', height: (hgt - RULER) + 'px' } }),
    overlay.head = h('div', { class: 'playhead', style: { top: RULER + 'px', height: (hgt - RULER) + 'px' } }));
  scroller.scrollLeft = sl; scroller.scrollTop = st;
  viewLeft = scroller.scrollLeft; meterEls = null; lastHeadX = NaN; lastRulerV = '';
  requestAnimationFrame(drawClipCanvases);
  setPlayhead(S.engine?.position?.().beat ?? 0);
  markSelection();
}

function trackRow(t, i) {
  const def = instDef(t.instrument?.id);
  const sel = t.id === S.sel.trackId;
  const preset = def?.presets.find(x => x.id === t.instrument?.preset);
  const sub = isSongTrack(t) ? 'Song clips' : [def?.region && t.name === def?.name ? '' : (def?.name || t.instrument?.id || ''), def?.region, preset?.name].filter(Boolean).join(' · ');
  const nameBtn = h('button', { class: 'tname', id: `tn-${t.id}`, title: 'Double-click or F2 to rename', text: t.name });
  nameBtn.addEventListener('dblclick', () => rename(nameBtn, t));
  nameBtn.addEventListener('keydown', e => { if (e.key === 'F2') { e.preventDefault(); rename(nameBtn, t); } });
  const mute = h('button', { class: 'key m', id: `mute-${t.id}`, 'aria-pressed': String(!!t.mute), 'aria-label': `Mute ${t.name}`, title: 'Mute', text: 'M',
    onclick: e => { e.stopPropagation(); setMS(t, 'mute'); } });
  const solo = h('button', { class: 'key s', id: `solo-${t.id}`, 'aria-pressed': String(!!t.solo), 'aria-label': `Solo ${t.name}`, title: 'Solo', text: 'S',
    onclick: e => { e.stopPropagation(); setMS(t, 'solo'); } });
  const nAuto = (t.automation || []).filter(l => l.points?.length).length;
  const auto = h('button', { class: 'key a', id: `auto-${t.id}`, 'aria-pressed': String(S.autoOpen.has(t.id)), 'aria-label': `Automation lane for ${t.name}`,
    title: nAuto ? `Automation (${nAuto} lane${nAuto > 1 ? 's' : ''})` : 'Automation: show a lane under this track', text: nAuto ? 'A•' : 'A',
    onclick: e => { e.stopPropagation(); if (S.autoOpen.has(t.id)) S.autoOpen.delete(t.id); else S.autoOpen.add(t.id); render(); } });
  const head = h('div', { class: 'thead' + (sel ? ' sel' : ''), style: { '--c': t.color }, 'data-track': t.id },
    h('span', { class: 'chip' }), nameBtn, h('div', { class: S.simple ? 'tbtns' : 'tbtns three' }, mute, solo, S.simple ? null : auto, h('div', { class: 'mini', 'data-meter': t.id }, h('i'))),
    h('span', { class: 'tinst', text: sub }));
  head.addEventListener('pointerdown', e => { if (e.target.closest('input')) return; selectTrack(t.id); });
  const lane = h('div', { class: 'lane' + (sel ? ' sel' : '') + (t.instrument?.id && /cloud/.test(t.instrument.id) ? ' cloud-lane' : ''), style: { width: laneW + 'px', '--c': t.color }, 'data-track': t.id });
  for (const c of t.clips) lane.append(clipEl(t, c));
  lane.addEventListener('pointerdown', e => laneDown(e, t));
  lane.addEventListener('dblclick', e => { if (e.target === lane) createClipAt(t, (e.clientX - lane.getBoundingClientRect().left) / S.zoom); });
  return h('div', { class: 'track-row', 'data-track': t.id, style: { '--c': t.color } }, head, lane);
}

// Automation lane under a track: breakpoints for volume, pan, sends, instrument params and effect params. The editor
// mutates the live track; every gesture is one undo step (begin / end), the engine reads the lanes while it schedules.
function autoRow(t, B) {
  const live = S.project.tracks.find(x => x.id === t.id);
  const targets = automationTargets(live, { instruments: S.engine?.instruments || [], effects: S.engine?.effects || [] });
  const used = (live.automation || []).find(l => l.points?.length);
  const selected = S.autoSel[t.id] || (used ? `${used.target}|${used.param}` : 'track|volumeDb');
  const ed = createAutomationEditor({ track: live, targets, pxPerBeat: S.zoom, beats: totalBeats, beatsPerBar: B, headWidth: HEAD, height: 84, color: t.color, snap: S.snap ? Math.min(S.snap, 1) : 0.25, selected,
    onBegin: () => begin(), onChange: () => { }, onEnd: () => end({ type: 'notes', trackId: t.id }, { render: false }), onSelect: k => { S.autoSel[t.id] = k; } });
  return h('div', { class: 'auto-row', 'data-auto': t.id, style: { '--c': t.color } }, ed);
}

function clipEl(t, c) {
  const song = c.song ? getSong(c.song.songId) : null;
  const name = song ? song.title : (c.name || t.name);
  const cloud = /cloud/.test(t.instrument?.id || '');
  const el = h('div', { class: 'clip' + (song ? ' song' : '') + (cloud ? ' cloud' : ''), tabindex: 0, role: 'button', id: `clip-${c.id}`, 'data-clip': c.id,
    'aria-label': `${name} clip, bar ${Math.floor(c.startBeat / bpb()) + 1}, ${+(c.lengthBeats / bpb()).toFixed(2)} bars. Arrows move, Shift+arrows resize, Delete removes, Enter edits.`,
    style: { left: xOf(c.startBeat) + 'px', width: Math.max(6, xOf(c.lengthBeats)) + 'px', '--c': t.color } },
    h('div', { class: 'ctop', text: name }), h('canvas', { 'aria-hidden': 'true' }), h('span', { class: 'rz l' }), h('span', { class: 'rz r' }));
  el._t = t; el._c = c;
  el.addEventListener('keydown', e => clipKey(e, t, c));
  el.addEventListener('dblclick', e => { e.stopPropagation(); emit('open-editor', c.id); });
  el.addEventListener('focus', () => { if (S.sel.clipId !== c.id) selectClip(c.id, t.id); });
  return el;
}

function drawClipCanvases() {
  root.querySelectorAll('.clip').forEach(drawClip);
}
export function drawClip(el) {
  const cv = el.querySelector('canvas'), t = el._t, c = el._c; if (!cv) return;
  const r = cv.getBoundingClientRect(), d = dpr();
  const w = Math.max(1, Math.round(r.width * d)), hh = Math.max(1, Math.round(r.height * d));
  cv.width = w; cv.height = hh;
  const g = cv.getContext('2d'); g.clearRect(0, 0, w, hh);
  const col = t.color;
  if (c.song) {
    const s = getSong(c.song.songId); if (!s) return;
    const bps = S.project.bpm / 60, rate = c.song.rate || 1, gain = Math.pow(10, (c.song.gainDb || 0) / 20);
    const lenSec = c.lengthBeats / bps;
    g.fillStyle = col; g.globalAlpha = 0.85;
    const mid = hh / 2;
    for (let x = 0; x < w; x += 2 * d) {
      const tSec = (x / d) / S.zoom / bps;                      // seconds into the clip
      const src = (c.song.offsetSec || 0) + tSec * rate;
      if (src >= s.duration) break;
      const pk = s.peaks[Math.min(119, Math.floor(src / s.duration * 120))] || 0;
      let env = 1; const fi = c.song.fadeInSec || 0, fo = c.song.fadeOutSec || 0;
      if (fi > 0 && tSec < fi) env = tSec / fi; if (fo > 0 && tSec > lenSec - fo) env = Math.min(env, Math.max(0, (lenSec - tSec) / fo));
      const a = Math.max(0.5 * d, pk * env * Math.min(1.4, gain) * (mid - 2 * d));
      g.fillRect(x, mid - a, 1.2 * d, a * 2);
    }
    return;
  }
  const notes = c.notes || []; if (!notes.length) return;
  let lo = 127, hi = 0; notes.forEach(n => { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); });
  lo -= 2; hi += 2; const span = Math.max(12, hi - lo), nh = Math.max(1.5 * d, Math.min(4 * d, hh / span));
  const cloud = /cloud/.test(t.instrument?.id || '');
  if (cloud) { g.shadowColor = col; g.shadowBlur = 8 * d; }
  g.fillStyle = col;
  for (const n of notes) {
    if (n.s >= c.lengthBeats) continue;
    const x = n.s * S.zoom * d, ww = Math.max(2 * d, Math.min(n.d, c.lengthBeats - n.s) * S.zoom * d - d);
    const y = hh - ((n.p - lo) / span) * (hh - nh) - nh;
    g.globalAlpha = cloud ? 0.55 : 0.45 + 0.55 * (n.v ?? 0.8);
    g.fillRect(x, y, ww, nh);
  }
}

// ---------------------------------------------------------------- selection
export function selectTrack(id) { if (S.sel.trackId === id) return; S.sel.trackId = id; emit('select'); }
export function selectClip(clipId, trackId) {
  S.sel.clipId = clipId; if (trackId) S.sel.trackId = trackId; S.sel.notes.clear(); emit('select');
}
function markSelection() {
  root.querySelectorAll('.clip').forEach(el => el.classList.toggle('sel', el._c.id === S.sel.clipId));
  root.querySelectorAll('.thead[data-track], .lane[data-track]').forEach(el => el.classList.toggle('sel', el.dataset.track === S.sel.trackId));
}

// ---------------------------------------------------------------- track ops
function setMS(t, k) {
  edit(p => { const x = p.tracks.find(x => x.id === t.id); x[k] = !x[k]; }, { type: 'mixer', trackId: t.id });
}
function rename(btn, t) {
  const inp = h('input', { class: 'tname', value: t.name, 'aria-label': 'Track name', maxlength: 40 });
  btn.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = ok => { if (done) return; done = true; const v = inp.value.trim(); if (ok && v && v !== t.name) edit(p => { p.tracks.find(x => x.id === t.id).name = v; }, { type: 'track', trackId: t.id }); else render(); };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
}
export function addTrack(kind, opts = {}) {
  if (S.project.tracks.length >= MAX_TRACKS) { emit('toast', `Slowreel holds ${MAX_TRACKS} tracks.`); return null; }
  const used = new Set(S.project.tracks.map(t => t.color));
  const color = TRACK_COLORS.find(c => !used.has(c)) || TRACK_COLORS[S.project.tracks.length % TRACK_COLORS.length];
  const id = uid('t');
  let t;
  if (kind === 'song') {
    t = { id, name: opts.name || 'Song', color, kind: 'song', instrument: { id: 'song', preset: '', params: {} }, volumeDb: -6, pan: 0, mute: false, solo: false, sends: { space: 0.3, echo: 0 }, fx: [], clips: [] };
  } else {
    const def = instDef(opts.instrument) || S.engine.instruments[0];
    t = { id, name: opts.name || def.name, color, kind: 'instrument', instrument: { id: def.id, preset: opts.preset || def.presets[0]?.id || '', params: opts.params || {} }, volumeDb: -6, pan: 0, mute: false, solo: false, sends: { space: 0.45, echo: 0.12 }, fx: [], clips: [] };
  }
  edit(p => { p.tracks.push(t); }, { type: 'all' });
  S.sel.trackId = id; S.sel.clipId = null; emit('select');
  requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
  return t;
}
// "+ Instrument": a picker grouped by region (Slowreel, Korean, Chinese, Japanese)
let instPop = null;
function closeInstPicker() {
  if (!instPop) return; const { el, btn, off } = instPop; instPop = null;
  el.remove(); off(); btn?.setAttribute('aria-expanded', 'false'); if (btn?.isConnected) btn.focus();
}
function openInstPicker(btn) {
  if (instPop) { closeInstPicker(); return; }
  const el = h('div', { class: 'pop inst-pop', id: 'inst-pop', role: 'dialog', 'aria-label': 'Add an instrument track' }, h('h2', { text: 'Add a track' }));
  const body = h('div', { class: 'inst-groups', 'data-scroll': '' });
  let n = 0;
  for (const g of instGroups()) {
    const grid = h('div', { class: 'cartridges', role: 'group', 'aria-label': g.label });
    g.items.forEach(d => grid.append(h('button', { class: 'key cart', id: `add-inst-${d.id}`, style: { '--c': TRACK_COLORS[n++ % TRACK_COLORS.length] },
      onclick: () => { closeInstPicker(); addTrack('instrument', { instrument: d.id }); } }, h('span', { class: 'sw' }), d.name)));
    body.append(h('section', { class: 'inst-group' }, h('span', { class: 'label', text: g.label }), grid));
  }
  el.append(body);
  document.body.append(el);
  const r = btn.getBoundingClientRect(), H = Math.min(el.offsetHeight, innerHeight - 20);
  el.style.left = Math.max(10, Math.min(innerWidth - el.offsetWidth - 10, r.left)) + 'px';
  el.style.top = (r.bottom + 6 + H < innerHeight - 10 ? r.bottom + 6 : Math.max(10, r.top - 6 - H)) + 'px';
  const outside = e => { if (!el.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeInstPicker(); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); closeInstPicker(); } };
  document.addEventListener('pointerdown', outside, true); el.addEventListener('keydown', esc);
  instPop = { el, btn, off: () => document.removeEventListener('pointerdown', outside, true) };
  btn.setAttribute('aria-expanded', 'true');
  el.querySelector('button')?.focus();
}
export function removeTrack(id) {
  const i = S.project.tracks.findIndex(t => t.id === id); if (i < 0) return;
  edit(p => { p.tracks.splice(i, 1); }, { type: 'all' });
  S.sel.trackId = S.project.tracks[Math.min(i, S.project.tracks.length - 1)]?.id || null;
  if (!clipOf()) S.sel.clipId = null;
  emit('select'); emit('render', { type: 'all' });
}

// ---------------------------------------------------------------- clip ops
const playheadBeat = () => S.engine?.position?.().beat ?? 0;
export function createClipAt(t, beat, opts = {}) {
  const B = bpb(), start = Math.max(0, Math.floor(snapTo(beat - (S.snap || 1) / 2, S.snap || 1) / (S.snap || 1)) * (S.snap || 1));
  const c = { id: uid('c'), startBeat: Math.max(0, start), lengthBeats: opts.lengthBeats || 4 * B, notes: [] };
  if (isSongTrack(t)) {
    const songId = opts.songId || lastSongOn(t) || 'sleepy-rain';
    const s = getSong(songId);
    const bps = S.project.bpm / 60;
    c.song = { songId, offsetSec: opts.offsetSec ?? 0, gainDb: -6, fadeInSec: 2, fadeOutSec: 3, rate: 1 };
    c.lengthBeats = opts.lengthBeats || Math.min(Math.round(Math.min(s.duration, 32) * bps / B) * B || B, 16 * B);
    if (s?.user && !opts.lengthBeats) c.lengthBeats = Math.max(B, Math.ceil(s.duration * bps / B) * B);   // music from Nico's computer: the whole song
  }
  edit(p => {
    p.tracks.find(x => x.id === t.id).clips.push(c);
    const end = Math.ceil((c.startBeat + c.lengthBeats) / B); if (c.song && end > p.lengthBars) p.lengthBars = Math.min(256, end);   // the tape grows to fit a long song clip
  }, { type: 'clips', trackId: t.id });
  selectClip(c.id, t.id);
  requestAnimationFrame(() => document.getElementById('clip-' + c.id)?.focus({ preventScroll: true }));
  return c;
}
const lastSongOn = t => t.clips.slice().reverse().find(c => c.song)?.song.songId;
export function addClipHere() {
  const t = track(); if (!t) return;
  createClipAt(t, playheadBeat());
}
export function duplicateClip(id = S.sel.clipId) {
  const f = clipOf(id); if (!f) return;
  const n = JSON.parse(JSON.stringify(f.c)); n.id = uid('c'); n.startBeat = f.c.startBeat + f.c.lengthBeats;
  edit(p => { p.tracks.find(x => x.id === f.t.id).clips.push(n); }, { type: 'clips', trackId: f.t.id });
  selectClip(n.id, f.t.id);
  requestAnimationFrame(() => document.getElementById('clip-' + n.id)?.focus({ preventScroll: true }));
}
export function deleteClip(id = S.sel.clipId) {
  const f = clipOf(id); if (!f) return;
  const list = f.t.clips, i = list.indexOf(f.c);
  edit(p => { const tr = p.tracks.find(x => x.id === f.t.id); tr.clips = tr.clips.filter(c => c.id !== id); }, { type: 'clips', trackId: f.t.id });
  const next = track(f.t.id)?.clips[Math.min(i, list.length - 2)];
  S.sel.clipId = null; emit('select');
  if (next) requestAnimationFrame(() => document.getElementById('clip-' + next.id)?.focus({ preventScroll: true }));
}
/** Move / resize a clip; left-resize keeps notes (and song audio) where they are in time. */
function applyGeometry(c, start, len, mode, t) {
  const B = bpb();
  if (mode === 'l') {
    const d = start - c.startBeat;
    if (c.notes) c.notes.forEach(n => { n.s -= d; });
    if (c.notes) c.notes = c.notes.filter(n => n.s + n.d > 0).map(n => { if (n.s < 0) { n.d += n.s; n.s = 0; } return n; });
    if (c.song) c.song.offsetSec = Math.max(0, (c.song.offsetSec || 0) + d * 60 / S.project.bpm * (c.song.rate || 1));
  }
  c.startBeat = Math.max(0, start); c.lengthBeats = Math.max(0.25, len);
  if (c.song) { const s = getSong(c.song.songId); if (s) { const maxBeats = (s.duration - (c.song.offsetSec || 0)) / (c.song.rate || 1) * S.project.bpm / 60; c.lengthBeats = Math.min(c.lengthBeats, Math.max(1, maxBeats)); } }
  void B; void t;
}
function clipKey(e, t, c) {
  const step = S.snap || 0.25, mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Enter') { e.preventDefault(); emit('open-editor', c.id); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteClip(c.id); return; }
  if (mod && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicateClip(c.id); return; }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault(); e.stopPropagation();
  const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const tr = S.project.tracks, i = tr.findIndex(x => x.id === t.id);
    for (let j = i + dir; j >= 0 && j < tr.length; j += dir) if (isSongTrack(tr[j]) === isSongTrack(t)) {
      const dest = tr[j].id;
      edit(p => { const a = p.tracks.find(x => x.id === t.id), b = p.tracks.find(x => x.id === dest); const k = a.clips.findIndex(x => x.id === c.id); b.clips.push(a.clips.splice(k, 1)[0]); }, { type: 'all' });
      S.sel.trackId = dest; emit('select'); break;
    }
  } else edit(p => {
    const cc = p.tracks.find(x => x.id === t.id).clips.find(x => x.id === c.id);
    if (e.shiftKey) applyGeometry(cc, cc.startBeat, cc.lengthBeats + dir * step, 'r');
    else applyGeometry(cc, Math.max(0, cc.startBeat + dir * step), cc.lengthBeats, 'move');
  }, { type: 'clips', trackId: t.id });
  requestAnimationFrame(() => document.getElementById('clip-' + c.id)?.focus({ preventScroll: true }));
}

function laneDown(e, t) {
  if (e.button !== 0) return;
  const el = e.target.closest('.clip');
  selectTrack(t.id);
  if (!el) { if (S.sel.clipId) { S.sel.clipId = null; emit('select'); } return; }
  const c = el._c, mode = e.target.classList.contains('rz') ? (e.target.classList.contains('l') ? 'l' : 'r') : 'move';
  if (S.sel.clipId !== c.id) selectClip(c.id, t.id);
  el.focus({ preventScroll: true });
  e.preventDefault();
  const x0 = e.clientX, y0 = e.clientY, s0 = c.startBeat, l0 = c.lengthBeats, end0 = s0 + l0;
  let moved = false, dup = e.altKey, curTrack = t, cur = c, curEl = el;
  const snap = S.snap || 0;
  const mv = ev => {
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    if (!moved) {
      moved = true; begin(); curEl.classList.add('drag');
      if (dup) { // leave a copy behind
        const copy = JSON.parse(JSON.stringify(cur)); copy.id = uid('c');
        S.project.tracks.find(x => x.id === curTrack.id).clips.push(copy);
        const ghost = clipEl(curTrack, copy); curEl.parentNode.insertBefore(ghost, curEl); requestAnimationFrame(() => drawClip(ghost));
      }
    }
    const db = dx / S.zoom;
    if (mode === 'move') {
      const ns = Math.max(0, snap ? snapTo(s0 + db, snap) : s0 + db);
      cur.startBeat = ns;
      // vertical: hop to another compatible track
      const rows = [...root.querySelectorAll('.track-row')];
      const over = rows.find(r => { const b = r.getBoundingClientRect(); return ev.clientY >= b.top && ev.clientY < b.bottom; });
      const destId = over?.dataset.track;
      if (destId && destId !== curTrack.id) {
        const dest = S.project.tracks.find(x => x.id === destId);
        if (dest && isSongTrack(dest) === isSongTrack(curTrack)) {
          const src = S.project.tracks.find(x => x.id === curTrack.id);
          src.clips = src.clips.filter(x => x !== cur); dest.clips.push(cur);
          over.querySelector('.lane').append(curEl); curEl._t = dest; curEl.style.setProperty('--c', dest.color);
          curTrack = dest; S.sel.trackId = dest.id; markSelection();
        }
      }
    } else if (mode === 'r') {
      const ne = Math.max(s0 + 0.25, snap ? snapTo(end0 + db, snap) : end0 + db);
      applyGeometry(cur, s0, ne - s0, 'r');
    } else {
      const ns = clamp(snap ? snapTo(s0 + db, snap) : s0 + db, 0, end0 - 0.25);
      applyGeometry(cur, ns, end0 - ns, 'l');
    }
    curEl.style.left = xOf(cur.startBeat) + 'px'; curEl.style.width = Math.max(6, xOf(cur.lengthBeats)) + 'px';
    if (mode !== 'move') drawClip(curEl);
  };
  const up = () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    curEl.classList.remove('drag');
    if (moved) end({ type: 'all' });
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}

// ---------------------------------------------------------------- ruler: seek + loop
function bindRuler(ruler) {
  const beatAt = ev => Math.max(0, (ev.clientX - ruler.getBoundingClientRect().left) / S.zoom);
  ruler.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; e.preventDefault(); ruler.focus({ preventScroll: true });
    const loopMode = e.clientY - ruler.getBoundingClientRect().top < 12;
    const b0 = snapTo(beatAt(e), loopMode ? (S.snap || 1) : 0.25);
    if (loopMode) begin(); else emit('seek', b0);
    const mv = ev => {
      const b = beatAt(ev);
      if (loopMode) {
        const b1 = snapTo(b, S.snap || 1); if (Math.abs(b1 - b0) < (S.snap || 1)) return;
        S.project.loop = { on: true, startBeat: Math.min(b0, b1), endBeat: Math.max(b0, b1) };
        S.engine?.setLoop(true, S.project.loop.startBeat, S.project.loop.endBeat);
        updateLoop();
      } else emit('seek', snapTo(b, 0.25));
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (loopMode) { end({ type: 'loop' }, { render: false }); emit('loop'); } };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  ruler.addEventListener('keydown', e => {
    const b = S.engine?.position?.().beat ?? 0, B = bpb();
    const m = { ArrowLeft: -1, ArrowRight: 1, PageUp: -B, PageDown: B };
    if (e.key in m) { e.preventDefault(); emit('seek', Math.max(0, Math.round(b) + m[e.key] * (m[e.key] === 1 || m[e.key] === -1 ? (S.snap || 1) : 1))); }
    else if (e.key === 'Home') { e.preventDefault(); emit('seek', 0); }
  });
}
export function updateLoop() {
  const lp = S.project.loop || {};
  const band = root.querySelector('.loopband');
  if (band) { band.classList.toggle('on', !!lp.on); band.style.left = xOf(lp.startBeat) + 'px'; band.style.width = xOf(lp.endBeat - lp.startBeat) + 'px'; }
  if (overlay.loop) { overlay.loop.hidden = !lp.on; overlay.loop.style.left = HEAD + xOf(lp.startBeat) + 'px'; overlay.loop.style.width = xOf(lp.endBeat - lp.startBeat) + 'px'; }
}

// ---------------------------------------------------------------- playhead (called every frame while playing)
export function setPlayhead(beat) {
  const x = Math.round(xOf(beat) * 2) / 2;
  if (x !== lastHeadX) {   // compositor-only transforms; no layout reads below
    lastHeadX = x;
    if (overlay.head) overlay.head.style.transform = `translateX(${HEAD + x}px)`;
    if (overlay.mark) overlay.mark.style.transform = `translateX(${x}px)`;
  }
  const v = beat.toFixed(1);
  if (v !== lastRulerV) { lastRulerV = v; overlay.ruler = overlay.ruler?.isConnected ? overlay.ruler : root.querySelector('#arr-ruler'); overlay.ruler?.setAttribute('aria-valuenow', v); }
  if (S.follow && S.playing) {
    const vis = viewW - HEAD, left = viewLeft;
    if (vis > 0 && (x > left + vis - 30 || x < left)) { viewLeft = Math.max(0, x - vis * 0.2); scroller.scrollLeft = viewLeft; }
  }
}
export function updateMeters(levels) {
  if (!meterEls) meterEls = [...root.querySelectorAll('.mini[data-meter]')].map(m => ({ id: m.dataset.meter, bar: m.firstChild, w: '' }));
  for (const m of meterEls) { const w = ((levels[m.id] ?? 0) * 100).toFixed(1) + '%'; if (w !== m.w) { m.w = w; m.bar.style.width = w; } }
}
export { HEAD };
void SONGS; void optName;
