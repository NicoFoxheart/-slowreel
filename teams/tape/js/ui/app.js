// app.js - Slowreel boot + the deck (transport, counter, master), Nico's tapes, projects, export dialog, the dock,
// QWERTY playing / recording, keyboard shortcuts, the visual loop and the test hook window.__studio.
import { S, on, emit, edit, track, clipOf, clamp, uid, clone, bpb, songBeats, fmtTime, isSongTrack, instDef, isSongParam,
  doUndo, doRedo, canUndo, canRedo, resetHistory } from './state.js?v=9c';
import { h, icon, knob } from './controls.js?v=9c';
import { loadEngine } from './engine.js?v=9c';
import { initArrange, render as renderArrange, fitZoom, zoomBy, setPlayhead, updateLoop, updateMeters, addClipHere, duplicateClip, deleteClip, addTrack, createClipAt, selectClip } from './arrange.js?v=9c';
import { initRoll, render as renderRoll, setRollHead, zoom as rollZoom } from './pianoroll.js?v=9c';
import { initPanels, renderTab, renderSongClip, updateMixMeters, animateCloud, KEYMAP, markKbKey } from './panels.js?v=9c';
import { createDeck, createVU } from './deck.js?v=9c';
import { exportMaster, renderProject, songSeconds, kb } from './exporter.js?v=9c';
import { initPhone, phoneFrame } from './phone.js?v=9c';
import { KEYS, CHORDS, scaleGroups } from './theory.js?v=9c';
import { TRACK_COLORS } from './sample-project.js?v=9c';
import { SONGS, loadSong } from '../../lib/songs.js?v=9c';
import { openProjects, autosave } from '../../lib/storage.js?v=9c';
import { measure } from '../../lib/export.js?v=9c';
import { initVisual, openVisual, isVisualOpen, exportVideoFor } from '../visual/visual-panel.js?v=9c';
import { mountStudio3D } from '../ui3d/studio3d.js?v=9c';
import { initSteps, renderSteps, isDrumTrack } from './steps.js?v=9c';
import { openChooser, closeChooser, blankProject, starterProject as styleStarter, guideFor, starterById } from './starters.js?v=9c';
import { createLiveArp } from '../sound/arp.js?v=9c';

const $ = id => document.getElementById(id);
const LAST_KEY = 'slowreel:last';
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { } };
// Slowreel is PC only: a phone (coarse pointer + small screen) gets a calm "open this on your computer" screen and never
// starts the audio engine. Tablets and touch laptops (wide screens) get the studio. ?device=phone|pc overrides (tests).
const PC_ONLY_SCREEN = (() => {
  try {
    const q = new URLSearchParams(location.search).get('device'); if (q === 'phone' || q === 'pc') return q === 'phone';
    const coarse = matchMedia('(pointer: coarse)').matches, small = Math.min(screen.width || innerWidth, screen.height || innerHeight) < 600;
    return coarse && small;
  } catch { return false; }
})();

// ---------------------------------------------------------------- boot
async function boot() {
  S.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
  S.engine = await loadEngine(S.ctx);
  if (S.engine.isMock && new URLSearchParams(location.search).get('engine') !== 'mock') toast('The full sound engine did not load; playing simple tones.');
  try { S.store = await openProjects({ appKey: 'tape' }); } catch (e) { console.warn('[slowreel] storage', e); }
  let proj = null;
  const last = lsGet(LAST_KEY);
  if (S.store && last) { try { proj = await S.store.load(last); } catch { } }
  if (!proj) proj = demoCopy();
  await openProject(proj, { fresh: true });
  if (S.store) {
    S.saver = autosave(S.store, () => S.project, 1500, { onSave: () => setSaveState('saved'), onError: e => setSaveState('error', e) });
    if (S.store.backend === 'memory') toast('Projects are kept for this visit only here.');
  }
  // first gesture wakes the audio
  const wake = () => { if (S.ctx.state !== 'running') S.ctx.resume(); };
  window.addEventListener('pointerdown', wake, { capture: true }); window.addEventListener('keydown', wake, { capture: true });
  initLight();
}
function demoCopy() { const d = clone(S.engine.demo); d.id = 'demo'; d.schema = d.schema || 'nfx-studio/1'; return d; }

async function openProject(p, { fresh } = {}) {
  S.project = p; normalize(p);
  S.autoOpen.clear(); S.autoSel = {};   // automation lanes are view state of one tape
  recipesMod?.then(m => m.closeTips()).catch(() => { });   // tips of an earlier recipe never stay over another tape (the panel reopens them for its own load)
  const firstClip = p.tracks.find(t => t.clips.some(c => !c.song));
  S.sel.trackId = firstClip?.id || p.tracks[0]?.id || null; S.sel.clipId = firstClip?.clips.find(c => !c.song)?.id || null; S.sel.notes.clear();
  if (S.playing) stop();
  resetHistory();
  lsSet(LAST_KEY, p.id);
  if (fresh) { fitZoom(); }
  syncTabs(); syncHeader(); renderArrange(); renderTapes(); renderDock(); emit('project');
  try { await S.engine.load(p); } catch (e) { console.warn('[slowreel] load', e); }
  const miss = S.engine.missingSamples?.() || [];
  if (miss.length && S.project === p) toast(`Re-import ${miss[0].name} on the Chop Sampler track (Sound tab): it is not on this computer.`);
  S.engine.setLoop(!!p.loop?.on, p.loop?.startBeat || 0, p.loop?.endBeat || 16);
  S.engine.seek?.(0); setPlayhead(0); drawIdle();
}
function normalize(p) {
  p.schema = p.schema || 'nfx-studio/1'; p.beatsPerBar = p.beatsPerBar || 4; p.lengthBars = p.lengthBars || 16;
  p.loop = p.loop || { on: false, startBeat: 0, endBeat: 16 };
  p.buses = p.buses || {}; p.buses.space = p.buses.space || { fx: [] }; p.buses.echo = p.buses.echo || { fx: [] };
  p.buses.space.fx = p.buses.space.fx || []; p.buses.echo.fx = p.buses.echo.fx || [];
  p.master = p.master || { volumeDb: 0, atmosphere: 0.5, fx: [] }; p.master.fx = p.master.fx || [];
  p.tracks.forEach(t => { t.sends = t.sends || { space: 0.4, echo: 0 }; t.fx = t.fx || []; t.clips = t.clips || []; t.clips.forEach(c => { if (!c.song) c.notes = c.notes || []; }); });
}

// ---------------------------------------------------------------- header deck
const keySel = $('f-key'), scaleSel = $('f-scale'), bpmIn = $('f-bpm'), lenIn = $('a-len');
KEYS.forEach(k => keySel.append(h('option', { value: k, text: k })));
scaleGroups().forEach(g => scaleSel.append(h('optgroup', { label: g.label }, ...g.scales.map(s => h('option', { value: s.id, text: s.name })))));
bpmIn.addEventListener('change', () => { const v = clamp(Math.round(+bpmIn.value || 70), 40, 160); bpmIn.value = v; edit(p => { p.bpm = v; }, { type: 'tempo' }); });
keySel.addEventListener('change', () => edit(p => { p.key = keySel.value; }, { type: 'all' }));
scaleSel.addEventListener('change', () => edit(p => { p.scale = scaleSel.value; }, { type: 'all' }));
lenIn.addEventListener('change', () => { const v = clamp(Math.round(+lenIn.value || 16), 4, 256); lenIn.value = v; edit(p => { p.lengthBars = v; }, { type: 'all' }); });

let masterKnobs = {};
function buildMasterCtl() {
  const el = $('masterctl'); el.textContent = '';
  const p = S.project;
  const live = (fn) => ({ onInput: fn, onCommit: v => { fn(v); edit(() => {}, { type: 'master' }); S.saver?.touch(); } });
  masterKnobs.atm = knob({ id: 'atmosphere', name: 'Atmos', min: 0, max: 1, default: 0.5 }, { value: p.master.atmosphere ?? 0.5, color: 'var(--signal)', idPrefix: 'm',
    ...live(v => { S.project.master.atmosphere = v; S.engine.setParam({ master: true }, 'atmosphere', v); }) });
  masterKnobs.space = knob({ id: 'space', name: 'Space', min: -24, max: 6, default: 0, unit: 'dB' }, { value: p.buses.space.returnDb ?? 0, color: 'var(--cobalt)', idPrefix: 'm',
    ...live(v => { S.project.buses.space.returnDb = v; S.engine.setParam({ bus: 'space' }, 'returnDb', v); }) });
  masterKnobs.vol = knob({ id: 'volume', name: 'Volume', min: -24, max: 6, default: 0, unit: 'dB' }, { value: p.master.volumeDb ?? 0, idPrefix: 'm',
    ...live(v => { S.project.master.volumeDb = v; S.engine.setParam({ master: true }, 'volumeDb', v); }) });
  el.append(masterKnobs.atm, masterKnobs.space, masterKnobs.vol);
}
on('master-sync', () => { masterKnobs.atm?.set(S.project.master.atmosphere ?? 0.5); masterKnobs.vol?.set(S.project.master.volumeDb ?? 0); });
function syncHeader() {
  const p = S.project;
  bpmIn.value = p.bpm; keySel.value = String(p.key || 'C').replace(/m$/, ''); scaleSel.value = p.scale || 'major'; lenIn.value = p.lengthBars;
  $('proj-name').textContent = p.name; $('ph-title').textContent = p.name;
  $('t-loop').setAttribute('aria-pressed', String(!!p.loop?.on));
  buildMasterCtl(); syncHistory();
}
on('render', () => { const p = S.project; bpmIn.value = p.bpm; lenIn.value = p.lengthBars; keySel.value = String(p.key).replace(/m$/, ''); scaleSel.value = p.scale; $('t-loop').setAttribute('aria-pressed', String(!!p.loop?.on)); });
on('project', () => { syncHeader(); });
function syncHistory() { $('b-undo').disabled = !canUndo(); $('b-redo').disabled = !canRedo(); }
on('history', syncHistory);

// save state LED
let saveTimer;
function setSaveState(st, err) {
  const el = $('proj-state');
  el.classList.toggle('dirty', st === 'dirty'); el.classList.toggle('err', st === 'error');
  el.lastChild.textContent = st === 'dirty' ? 'Saving soon' : st === 'error' ? (err?.code === 'too_large' ? 'Too big to save' : 'Not saved') : 'Saved';
}
on('dirty', () => { setSaveState('dirty'); clearTimeout(saveTimer); if (!S.saver) saveTimer = setTimeout(() => setSaveState('saved'), 400); });

// ---------------------------------------------------------------- transport
function play(from) {
  if (S.ctx.state !== 'running') S.ctx.resume();
  stopPreview();
  const b = from ?? S.engine.position().beat;
  S.engine.play(b >= songBeats() && !S.project.loop?.on ? 0 : b);
  S.playing = true; syncTransport(); startLoop();
}
function stop() {
  if (S.rec) finishRecording();
  S.engine.stop(); S.playing = false; syncTransport(); startLoop();
}
function togglePlay() { S.playing ? stop() : play(); }
function returnToStart() { seek(0); }
function seek(b) { S.engine.seek(b); setPlayhead(b); setRollHead(b); updateCounter(b); startLoop(); }
on('seek', seek);
function syncTransport() {
  $('t-play').setAttribute('aria-pressed', String(S.playing)); $('ph-play').setAttribute('aria-pressed', String(S.playing));
  $('t-play').querySelector('use').setAttribute('href', S.playing ? '#i-stop' : '#i-play');
  $('ph-play').querySelector('use').setAttribute('href', S.playing ? '#i-stop' : '#i-play');
  $('t-play').setAttribute('aria-label', S.playing ? 'Pause (Space)' : 'Play (Space)');
  $('led-play').classList.toggle('on', S.playing); $('led-play').classList.add('play');
  $('led-rec').classList.toggle('on', S.rec);
  $('t-rec').setAttribute('aria-pressed', String(S.rec));
  document.querySelector('.window .glass').classList.toggle('awake', S.playing);
}
function toggleLoop() {
  edit(p => { p.loop = { ...(p.loop || { startBeat: 0, endBeat: 4 * bpb() }), on: !p.loop?.on }; }, { type: 'loop' }, { render: false });
  S.engine.setLoop(S.project.loop.on, S.project.loop.startBeat, S.project.loop.endBeat);
  $('t-loop').setAttribute('aria-pressed', String(S.project.loop.on)); updateLoop();
}
on('loop', () => { $('t-loop').setAttribute('aria-pressed', String(!!S.project.loop?.on)); });
$('t-play').onclick = togglePlay;
$('t-stop').onclick = () => { if (S.playing) stop(); else returnToStart(); };
$('t-return').onclick = returnToStart;
$('t-loop').onclick = toggleLoop;
$('t-rec').onclick = () => toggleRec();
$('b-undo').onclick = doUndo; $('b-redo').onclick = doRedo;

// The counter's three numbers are text nodes updated in place (no innerHTML parsing per frame), only when they change.
const lcd = { parts: null, time: null, last: ['', '', '', ''] };
function updateCounter(beat) {
  const B = bpb(), bar = Math.floor(beat / B) + 1, bt = Math.floor(beat % B) + 1, tick = Math.floor((beat % 1) * 100);
  if (!lcd.parts || !lcd.parts[0].isConnected) {
    const el = $('lcd-counter'); el.textContent = '';
    lcd.parts = [document.createTextNode(''), document.createTextNode(''), document.createTextNode('')];
    el.append(lcd.parts[0], h('small', { text: '.' }), lcd.parts[1], h('small', { text: '.' }), lcd.parts[2]);
    lcd.time = $('lcd-time'); lcd.last = ['', '', '', ''];
  }
  const v = [String(bar).padStart(3, '0'), String(bt), String(tick).padStart(2, '0'), fmtTime(beat * 60 / S.project.bpm)];
  for (let i = 0; i < 3; i++) if (v[i] !== lcd.last[i]) { lcd.last[i] = v[i]; lcd.parts[i].nodeValue = v[i]; }
  if (v[3] !== lcd.last[3]) { lcd.last[3] = v[3]; lcd.time.textContent = v[3]; }
}

// ---------------------------------------------------------------- arrange toolbar
$('a-add').onclick = addClipHere;
$('a-dup').onclick = () => duplicateClip();
$('a-del').onclick = () => deleteClip();
$('a-snap').onchange = e => { S.snap = +e.target.value; };
$('a-zin').onclick = () => zoomBy(1.4); $('a-zout').onclick = () => zoomBy(1 / 1.4);
$('a-follow').onclick = e => { S.follow = !S.follow; e.currentTarget.setAttribute('aria-pressed', String(S.follow)); };
$('a-tapes').onclick = e => { const open = $('body').classList.toggle('tapes-closed'); e.currentTarget.setAttribute('aria-pressed', String(!open)); setTimeout(renderArrange, 30); };
function syncClipButtons() { const has = !!clipOf(); $('a-dup').disabled = !has; $('a-del').disabled = !has; $('a-add').disabled = !track(); }
on('select', syncClipButtons); on('render', syncClipButtons);

// ---------------------------------------------------------------- Nico's tapes (song browser)
let preview = null;
function renderTapes() {
  const ul = $('tape-list'); ul.textContent = '';
  $('tape-count').textContent = `${SONGS.length} songs`;
  SONGS.forEach((s, i) => {
    const cv = h('canvas', { 'aria-hidden': 'true' });
    const li = h('li', { class: 'tape', id: `tape-${s.id}`, style: { '--c': TRACK_COLORS[i % TRACK_COLORS.length] } },
      h('h3', { text: s.title, title: s.title }), h('span', { class: 'dur', text: fmtDur(s.duration) }), cv,
      h('div', { class: 'acts' },
        h('button', { class: 'key sm', id: `tape-listen-${s.id}`, 'aria-pressed': 'false', 'aria-label': `Listen to ${s.title}`, onclick: () => togglePreview(s.id) }, icon('play'), h('span', { class: 'lb', text: 'Listen' })),
        h('button', { class: 'key sm', id: `tape-clip-${s.id}`, 'aria-label': `Add ${s.title} as a song clip at the playhead`, title: 'Add a section of this song to a song track', onclick: () => addSongClip(s.id) }, icon('plus'), h('span', { class: 'lb', text: 'Clip' })),
        h('button', { class: 'key sm', id: `tape-cloud-${s.id}`, 'aria-label': `Make a Song Cloud instrument from ${s.title}`, title: 'Turn this song into a playable granular pad', onclick: () => addCloud(s.id) }, icon('cloud'), h('span', { class: 'lb', text: 'Cloud' })),
        h('button', { class: 'key sm', id: `tape-video-${s.id}`, 'aria-label': `Make a music video of ${s.title}`, title: 'Make a music video of this song (the fox heart)', onclick: () => openVisual({ kind: 'song', id: s.id }) }, icon('heart'), h('span', { class: 'lb', text: 'Video' }))));
    ul.append(li);
    requestAnimationFrame(() => drawPeaks(cv, s.peaks, getComputedStyle(li).getPropertyValue('--c')));
  });
}
const fmtDur = d => `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}`;
function drawPeaks(cv, peaks, col, progress = -1) {
  const d = Math.min(2, devicePixelRatio || 1), r = cv.getBoundingClientRect(); if (!r.width) return;
  cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, n = peaks.length, bw = W / n;
  for (let i = 0; i < n; i++) { const a = Math.max(d, peaks[i] * H * 0.48); g.fillStyle = progress >= 0 && i / n <= progress ? col : (progress >= 0 ? 'rgba(18,22,24,.22)' : col); g.globalAlpha = progress >= 0 ? 1 : 0.75; g.fillRect(i * bw + bw * 0.15, H / 2 - a, Math.max(1, bw * 0.7), a * 2); }
}
async function togglePreview(id) {
  const was = preview?.id; stopPreview(); if (was === id) return;
  if (S.ctx.state !== 'running') await S.ctx.resume();
  if (S.playing) stop();
  const btn = $(`tape-listen-${id}`); btn.setAttribute('aria-pressed', 'true'); $(`tape-${id}`).classList.add('playing');
  preview = { id, t0: S.ctx.currentTime };
  try {
    const buf = await (S.engine.loadSong ? S.engine.loadSong(id) : loadSong(S.ctx, id)); if (preview?.id !== id) return;   // one decode, shared with the engine
    const src = S.ctx.createBufferSource(), g = S.ctx.createGain(); src.buffer = buf; g.gain.value = 0.5;
    src.connect(g).connect(S.engine.output || S.ctx.destination);   // output feeds the speakers and the meters
    src.start(); preview.src = src; preview.t0 = S.ctx.currentTime; preview.dur = buf.duration; src.onended = () => { if (preview?.src === src) stopPreview(); };
    startLoop();
  } catch (e) { toast('Could not load that song.'); stopPreview(); }
}
function stopPreview() {
  if (!preview) return;
  try { preview.src?.stop(); } catch { }
  $(`tape-listen-${preview.id}`)?.setAttribute('aria-pressed', 'false'); $(`tape-${preview.id}`)?.classList.remove('playing');
  const li = $(`tape-${preview.id}`); if (li) drawPeaks(li.querySelector('canvas'), SONGS.find(s => s.id === preview.id).peaks, getComputedStyle(li).getPropertyValue('--c'));
  preview = null;
}
function addSongClip(songId) {
  let t = track(); if (!isSongTrack(t)) t = S.project.tracks.find(isSongTrack) || addTrack('song', { name: 'Songs' });
  if (!t) return;
  const s = SONGS.find(x => x.id === songId);
  const c = createClipAt(t, S.engine.position().beat, { songId });
  edit(p => { const tr = p.tracks.find(x => x.id === t.id); if (tr.clips.length === 1 && /^(Song|Songs)$/.test(tr.name)) tr.name = s.title; }, { type: 'track', trackId: t.id });
  toast(`${s.title} is on "${track(t.id).name}" at bar ${Math.floor(c.startBeat / bpb()) + 1}.`);
  gotoTab('notes');
}
function addCloud(songId) {
  const def = S.engine.instruments.find(i => i.params.some(isSongParam)); if (!def) return;
  const sp = def.params.find(isSongParam), s = SONGS.find(x => x.id === songId);
  const t = addTrack('instrument', { instrument: def.id, name: `${s.title} cloud`, params: { [sp.id]: songId } }); if (!t) return;
  const root = 48 + KEYS.indexOf(String(S.project.key).replace(/m$/, '')) + 12;
  const c = createClipAt(t, S.engine.position().beat, { lengthBeats: 8 * bpb() });
  edit(p => { const cc = p.tracks.find(x => x.id === t.id).clips.find(x => x.id === c.id); cc.notes = [{ p: Math.max(0, root), s: 0, d: 8 * bpb(), v: 0.6 }]; }, { type: 'notes', trackId: t.id });
  gotoTab('sound');
  toast(`${s.title} is now a playable cloud. Play it on the keys.`);
}

// ---------------------------------------------------------------- dock (tabs, tools, context)
const TABS = ['notes', 'sound', 'fx', 'mix', 'keys', 'beats'];
TABS.forEach((k, i) => { $(`tab-${k}`).onclick = () => gotoTab(k); $(`tab-${k}`).addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const vis = TABS.filter(tabShown), j = vis.indexOf(k); const n = vis[(j + (e.key === 'ArrowRight' ? 1 : vis.length - 1)) % vis.length]; gotoTab(n); $(`tab-${n}`).focus(); } }); });
// ---------------------------------------------------------------- Simple / All tools (view only: sound and export never change)
// Simple shows Notes, Sound and Keys (plus Beats when the tape has a drum kit), hides the automation A keys, the
// Arpeggiator (unless a track uses it) and the advanced clip tools. Remembered per viewer; on by default.
const SIMPLE_KEY = 'slowreel:simple';
const tabShown = k => !S.simple || k === 'notes' || k === 'sound' || k === 'keys' || (k === 'beats' && !!S.project?.tracks.some(isDrumTrack));
let shownSig = '';
function syncTabs() {
  const sig = TABS.map(k => (tabShown(k) ? 1 : 0)).join('');
  if (sig === shownSig) return; shownSig = sig;
  TABS.forEach(k => { $(`tab-${k}`).hidden = !tabShown(k); });
  if (!tabShown(S.tab)) gotoTab('notes');
}
function setSimple(on, { save = true } = {}) {
  S.simple = !!on;
  document.documentElement.classList.toggle('simple', S.simple);
  $('mode-simple').setAttribute('aria-pressed', String(S.simple)); $('mode-all').setAttribute('aria-pressed', String(!S.simple));
  if (S.simple) S.chord = 'off';   // the chord stamp is hidden in Simple: drawing places single notes
  if (save) lsSet(SIMPLE_KEY, S.simple ? 'on' : 'off');
  if (!S.project) return;
  shownSig = ''; syncTabs(); renderArrange(); renderDock();
  if (!$('set-pop').hidden) fillSettings();
}
$('mode-simple').onclick = () => setSimple(true);
$('mode-all').onclick = () => setSimple(false);
on('render', syncTabs);
{ const q = new URLSearchParams(location.search).get('tools'), saved = lsGet(SIMPLE_KEY);
  setSimple(q === 'all' ? false : q === 'simple' ? true : saved !== 'off', { save: false }); }
function gotoTab(k) {
  if (!tabShown(k)) k = 'notes';
  S.tab = k;
  TABS.forEach(x => { $(`tab-${x}`).setAttribute('aria-selected', String(x === k)); $(`tab-${x}`).tabIndex = x === k ? 0 : -1; $(`pane-${x}`).hidden = x !== k; });
  renderDock();
}
on('goto-tab', gotoTab);
on('open-editor', id => { const f = clipOf(id); if (f) { selectClip(id, f.t.id); gotoTab('notes'); } });
function renderDock() {
  renderDockCtx(); renderDockTools();
  if (S.tab === 'notes') renderNotes(); else if (S.tab === 'beats') renderSteps(); else renderTab();
}
on('select', () => { renderDockCtx(); renderDockTools(); if (S.tab === 'notes') renderNotes(); });
on('render', () => { renderDockCtx(); if (S.tab === 'notes') renderNotes(); });
function renderNotes() {
  const pane = $('pane-notes'), f = clipOf();
  if (!f && !S.project.tracks.length) {
    pane.textContent = '';
    pane.append(h('div', { class: 'empty' }, h('strong', { text: 'Nothing on this tape yet' }), h('span', { text: 'Add your first instrument above. Then press R and play to record a clip.' })));
    return;
  }
  if (!f) {
    pane.textContent = '';
    pane.append(h('div', { class: 'empty' }, h('strong', { text: 'Pick a clip to edit' }),
      h('span', { text: 'Click a clip in the arrange view. Double-click an empty lane to make a new one, or press Clip.' })));
    return;
  }
  if (f.c.song) { renderSongClip(pane); return; }
  renderRoll();
}
function renderDockCtx() {
  const el = $('dock-ctx'); el.textContent = '';
  const t = track(); if (!t) return;
  const f = clipOf();
  let txt = t.name;
  if (S.tab === 'notes' && f) txt = `${f.t.name} · bar ${Math.floor(f.c.startBeat / bpb()) + 1}, ${+(f.c.lengthBeats / bpb()).toFixed(2)} bars`;
  if (S.tab === 'fx') txt = { track: t.name, space: 'Space bus', echo: 'Echo bus', master: 'Master' }[S.fxTarget];
  if (S.tab === 'mix') txt = `${S.project.tracks.length} tracks · Space · Echo · Master`;
  el.append(h('i', { style: { '--c': S.tab === 'notes' && f ? f.t.color : t.color } }), h('span', { text: txt }));
}
function renderDockTools() {
  const el = $('dock-tools'); el.textContent = '';
  const f = clipOf();
  if (S.tab === 'notes' && f && !f.c.song) {
    const seg = h('div', { class: 'segk', role: 'group', 'aria-label': 'Tool' },
      h('button', { class: 'key sm', id: 'tool-draw', 'aria-pressed': String(S.tool === 'draw'), onclick: () => { S.tool = 'draw'; renderDockTools(); } }, 'Draw'),
      h('button', { class: 'key sm', id: 'tool-select', 'aria-pressed': String(S.tool === 'select'), onclick: () => { S.tool = 'select'; renderDockTools(); } }, 'Select'));
    const snap = h('select', { class: 'sel', id: 'pr-snap', 'aria-label': 'Note snap' }, ...[['0', 'Free'], ['0.25', '1/16'], ['0.5', '1/8'], ['1', 'Beat'], ['2', '1/2 bar'], ['4', 'Bar']].map(([v, n]) => h('option', { value: v, selected: +v === S.prSnap }, n)));
    snap.onchange = () => { S.prSnap = +snap.value; };
    const chord = h('select', { class: 'sel', id: 'pr-chord', 'aria-label': 'Chord stamp' }, ...CHORDS.map(c => h('option', { value: c.id, selected: c.id === S.chord }, c.id === 'off' ? 'Single note' : 'Chord: ' + c.name)));
    chord.onchange = () => { S.chord = chord.value; };
    const lock = h('button', { class: 'key sm led-green', id: 'pr-lock', 'aria-pressed': String(S.lock), title: 'Keep new and moved notes in the scale', onclick: e => { S.lock = !S.lock; e.currentTarget.setAttribute('aria-pressed', String(S.lock)); } }, h('span', { class: 'led' }), 'Scale lock');
    if (S.simple) el.append(seg, lock,
      h('button', { class: 'key sm sq', id: 'pr-zout', 'aria-label': 'Zoom out', onclick: () => rollZoom(1 / 1.3) }, icon('zout')),
      h('button', { class: 'key sm sq', id: 'pr-zin', 'aria-label': 'Zoom in', onclick: () => rollZoom(1.3) }, icon('zin')));
    else el.append(seg, h('label', { class: 'field' }, h('span', { class: 'label', text: 'Snap' }), snap), chord, lock,
      h('button', { class: 'key sm sq', id: 'pr-zout', 'aria-label': 'Zoom out', onclick: () => rollZoom(1 / 1.3) }, icon('zout')),
      h('button', { class: 'key sm sq', id: 'pr-zin', 'aria-label': 'Zoom in', onclick: () => rollZoom(1.3) }, icon('zin')));
  } else if (S.tab === 'fx') {
    const seg = h('div', { class: 'segk', role: 'group', 'aria-label': 'Effect chain' });
    [['track', 'Track'], ['space', 'Space'], ['echo', 'Echo'], ['master', 'Master']].forEach(([k, n]) => seg.append(h('button', { class: 'key sm', id: `fxt-${k}`, 'aria-pressed': String(S.fxTarget === k), text: n,
      onclick: () => { S.fxTarget = k; renderDockTools(); renderDockCtx(); renderTab(); } })));
    el.append(seg);
  } else if (S.tab === 'keys') {
    el.append(h('span', { class: 'label', text: 'Z X octave · C V velocity · R record' }));
  } else if (S.tab === 'beats') {
    el.append(h('span', { class: 'label', text: 'Step sequencer · Drum Machine, janggu, taiko' }));
  }
}

// ---------------------------------------------------------------- live keys + recording
const held = new Map();       // midi -> {trackId, s}
let recBuf = [], recTrack = null;
// live arpeggiator per track (Sound tab > Arpeggiator): keys go through it while the track's arp is on
const liveArps = new Map();
const liveArp = id => { let a = liveArps.get(id); if (!a) { a = createLiveArp(S.engine, id, () => track(id)?.arp, () => S.project.bpm); liveArps.set(id, a); } return a; };
on('project', () => { for (const a of liveArps.values()) { try { a.allOff(); a.dispose?.(); } catch { } } liveArps.clear(); });
function keyOn(m) {
  const t = track(); if (!t || isSongTrack(t)) { if (!keyOn.warned) { toast('Pick an instrument track to play.'); keyOn.warned = true; } return; }
  if (S.ctx.state !== 'running') S.ctx.resume();
  if (held.has(m)) return;
  const arp = t.arp?.on && !S.engine.isMock ? liveArp(t.id) : null;
  if (arp?.active()) arp.noteOn(m, S.vel); else S.engine.noteOn(t.id, m, S.vel);
  held.set(m, { trackId: t.id, s: S.engine.position().beat, v: S.vel, arp: arp?.active() ? arp : null });
  markKbKey(m, true); startLoop();
}
function keyOff(m) {
  const k = held.get(m); if (!k) return; held.delete(m);
  if (k.arp) k.arp.noteOff(m); else S.engine.noteOff(k.trackId, m);
  markKbKey(m, false);
  if (S.rec && S.playing && recTrack === k.trackId) {
    const e = S.engine.position().beat; let d = e - k.s; if (d < 0.1) d = 0.25;
    recBuf.push({ p: m, s: k.s, d: Math.round(d * 100) / 100, v: k.v });
  }
}
on('key-on', keyOn); on('key-off', keyOff);
on('toggle-rec', () => toggleRec());
function toggleRec() {
  if (S.rec) { finishRecording(); syncTransport(); renderTab(); return; }
  const t = track(); if (!t || isSongTrack(t)) { toast('Pick an instrument track to record into.'); return; }
  S.rec = true; recBuf = []; recTrack = t.id;
  if (!S.playing) play();
  syncTransport(); if (S.tab === 'keys') renderTab();
  toast(`Recording into ${t.name}. Press R again to finish.`);
}
function finishRecording() {
  S.rec = false;
  for (const [m, k] of held) if (k.trackId === recTrack) { const e = S.engine.position().beat; recBuf.push({ p: m, s: k.s, d: Math.max(0.25, e - k.s), v: k.v }); }
  if (recBuf.length && track(recTrack)) {
    const B = bpb(), s0 = Math.floor(Math.min(...recBuf.map(n => n.s)) / B) * B, e0 = Math.max(...recBuf.map(n => n.s + n.d));
    const c = { id: uid('c'), startBeat: s0, lengthBeats: Math.max(B, Math.ceil((e0 - s0) / B) * B), notes: recBuf.map(n => ({ ...n, s: Math.round((n.s - s0) * 100) / 100 })) };
    edit(p => { p.tracks.find(x => x.id === recTrack).clips.push(c); }, { type: 'clips', trackId: recTrack });
    selectClip(c.id, recTrack);
    toast(`Recorded ${recBuf.length} notes into a new clip.`);
  }
  recBuf = []; syncTransport();
}

// ---------------------------------------------------------------- global keyboard
const typing = el => el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeProj(); if (!$('export-scrim').hidden && !exporting) closeExport(); return; }
  if (typing(e.target) || !$('export-scrim').hidden || isVisualOpen()) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if (mod && k === 'y') { e.preventDefault(); doRedo(); return; }
  if (mod && k === 's') { e.preventDefault(); S.saver?.flush(); toast('Saved.'); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicateClip(); return; }
  if (mod || e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); if (!e.repeat) togglePlay(); return; }
  if (e.key === 'Home') { e.preventDefault(); returnToStart(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && clipOf() && !e.target.closest?.('#pane-notes')) { e.preventDefault(); deleteClip(); return; }
  if (e.repeat) { if (k in KEYMAP) e.preventDefault(); return; }
  if (k in KEYMAP) { e.preventDefault(); keyOn(12 * (S.octave + 1) + KEYMAP[k]); return; }
  if (k === 'z' || k === 'x') { S.octave = clamp(S.octave + (k === 'x' ? 1 : -1), 1, 7); held.forEach((_, m) => keyOff(m)); toast(`Octave ${S.octave}`); if (S.tab === 'keys') renderTab(); return; }
  if (k === 'c' || k === 'v') { S.vel = clamp(Math.round((S.vel + (k === 'v' ? 0.1 : -0.1)) * 10) / 10, 0.1, 1); toast(`Velocity ${Math.round(S.vel * 100)}`); if (S.tab === 'keys') renderTab(); return; }
  if (k === 'r') { toggleRec(); return; }
  if (k === 'l') { toggleLoop(); return; }
  if (/^[1-6]$/.test(k) && !e.target.closest?.('[role="slider"]')) { if (tabShown(TABS[+k - 1])) gotoTab(TABS[+k - 1]); return; }
});
window.addEventListener('keyup', e => { const k = e.key.toLowerCase(); for (const kk of [k]) if (kk in KEYMAP) { const m = 12 * (S.octave + 1) + KEYMAP[kk]; keyOff(m); } });
window.addEventListener('blur', () => held.forEach((_, m) => keyOff(m)));

// ---------------------------------------------------------------- projects popover
const pop = $('proj-pop');
let popOpen = false;
$('proj-btn').onclick = () => (popOpen ? closeProj() : openProj());
document.addEventListener('pointerdown', e => { if (popOpen && !pop.contains(e.target) && !$('proj-btn').contains(e.target)) closeProj(); });
function closeProj() { if (!popOpen) return; popOpen = false; pop.hidden = true; $('proj-btn').setAttribute('aria-expanded', 'false'); }
async function openProj() {
  popOpen = true; pop.hidden = false; $('proj-btn').setAttribute('aria-expanded', 'true');
  const r = $('proj-btn').getBoundingClientRect();
  pop.style.top = r.bottom + 8 + 'px'; pop.style.left = Math.max(10, Math.min(innerWidth - 330, r.right - 320)) + 'px';
  await fillProj();
  pop.querySelector('input')?.focus();
}
async function fillProj() {
  pop.textContent = '';
  const name = h('input', { class: 'txt', id: 'proj-rename', value: S.project.name, 'aria-label': 'Project name', maxlength: 60 });
  const doRename = () => { const v = name.value.trim(); if (v && v !== S.project.name) { edit(p => { p.name = v; }, { type: 'meta' }, { render: false }); $('proj-name').textContent = v; $('ph-title').textContent = v; fillProj(); } };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') doRename(); });
  pop.append(h('h2', { text: 'Projects' }),
    h('div', { class: 'row' }, name, h('button', { class: 'key', id: 'proj-rename-btn', text: 'Rename', onclick: doRename })),
    h('div', { class: 'row' },
      h('button', { class: 'key', id: 'proj-new', onclick: newProject }, icon('plus'), 'New'),
      h('button', { class: 'key', id: 'proj-dup', onclick: dupProject }, icon('dup'), 'Duplicate'),
      h('button', { class: 'key', id: 'proj-demo', title: 'Open a fresh copy of the first demo, Rain on the Reel', onclick: restoreDemo }, 'Original demo'),
      h('button', { class: 'key', id: 'proj-night', title: 'Open a fresh copy of the second demo: Night Garage, Antent-style future garage', onclick: openNightGarage }, 'Night Garage'),
      h('button', { class: 'key', id: 'proj-recipes', title: 'Starter projects that teach: Korean, Chinese, Japanese and ambient basics', onclick: () => { closeProj(); showRecipes(); } }, icon('book'), 'Recipes')));
  const ul = h('ul', { class: 'plist', 'data-scroll': '' });
  let list = [];
  try { await S.saver?.flush(); list = S.store ? await S.store.list() : []; } catch (e) { console.warn(e); }
  if (!list.find(x => x.id === S.project.id)) list.unshift({ id: S.project.id, name: S.project.name, updatedAt: S.project.updatedAt, bpm: S.project.bpm, lengthBars: S.project.lengthBars });
  list.forEach(it => {
    const cur = it.id === S.project.id;
    const acts = h('div', { class: 'pacts' });
    const li = h('li', { class: 'pitem' + (cur ? ' cur' : '') },
      h('button', { class: 'open', id: `proj-open-${it.id}`, 'aria-label': `Open ${it.name}`, onclick: () => openById(it.id) },
        h('span', { class: 'pn', text: it.name }), h('span', { class: 'pm', text: `${it.bpm || ''} BPM · ${it.lengthBars || ''} bars${it.updatedAt ? ' · ' + new Date(it.updatedAt).toLocaleDateString() : ''}` })), acts);
    acts.append(h('button', { class: 'key sm sq', 'aria-label': `Delete ${it.name}`, title: 'Delete', onclick: () => {
      acts.textContent = ''; acts.append(h('button', { class: 'key sm signal', id: `proj-del-yes`, text: 'Delete', onclick: () => deleteProject(it.id) }), h('button', { class: 'key sm', text: 'Keep', onclick: fillProj }));
      acts.querySelector('button').focus(); } }, icon('trash')));
    ul.append(li);
  });
  pop.append(ul, h('p', { class: 'pm-note', text: S.store ? (S.store.backend === 'db' ? 'Saved to your account, private to you.' : S.store.backend === 'indexeddb' ? 'Saved in this browser.' : 'Kept for this visit only.') : 'Saving is unavailable here.' }));
}
async function openById(id) {
  if (id === S.project.id) { closeProj(); return; }
  await S.saver?.flush();
  const p = await S.store?.load(id); if (!p) { toast('That project could not be opened.'); return; }
  closeProj(); await openProject(p, { fresh: true });
}
// "New": the calm "Start a new tape" chooser (js/ui/starters.js). Blank tape = zero tracks; a style starter sets the
// tempo, key, scale and room and adds a few named, empty tracks, then opens its style guide. Nico plays every note.
function newProject() { closeProj(); openChooser({ onPick: c => startTape(c) }); }
async function startTape(c) {
  await S.saver?.flush();
  const base = { instruments: S.engine.instruments, buses: S.engine.demo.buses, colors: TRACK_COLORS, uid };
  const p = c.kind === 'starter' ? styleStarter(typeof c.starter === 'string' ? starterById(c.starter) : c.starter, base) : blankProject(base);
  try { await S.store?.save(p); } catch (e) { console.warn('[slowreel] new tape save', e); }
  closeChooser(); await openProject(p, { fresh: true });
  if (p.starter) { await showGuide(); toast(`${p.name}: ${p.bpm} BPM, ${p.key}. The tracks are empty - play them on your keys.`); }
  else toast('A blank tape. Add your first instrument.');
  return p;
}
// The style guide (a starter's tips + the flow tips), shown in the recipes tips panel; a recipe tape shows its own tips.
async function showGuide() {
  try {
    const m = await recipesPanel(), p = S.project;
    if (p.recipe && !p.starter && m.openTips(p.recipe, { onReopen: () => showRecipes({ selected: p.recipe }) })) return;
    const sc = id => scaleGroups().flatMap(g => g.scales).find(s => s.id === id)?.name || id;
    m.openTips(guideFor(p, sc), { label: p.starter ? 'Style guide' : 'Flow guide' });
  } catch (e) { console.error('[slowreel] guide', e); toast('The guide could not open.'); }
}
$('b-guide').onclick = () => showGuide();
async function dupProject() {
  await S.saver?.flush();
  let p = clone(S.project); p.id = 'p-' + Date.now().toString(36); p.name = S.project.name + ' copy';
  if (S.store) { try { await S.store.save(S.project); p = await S.store.duplicate(S.project.id, p.name) || p; } catch { await S.store.save(p).catch(() => { }); } }
  closeProj(); await openProject(p, { fresh: false }); toast('Duplicated.');
}
async function restoreDemo() {
  await S.saver?.flush();
  const d = demoCopy(); d.id = 'demo';
  try { await S.store?.save(d); } catch { }
  closeProj(); await openProject(d, { fresh: true }); toast('The original demo, fresh.');
}
// The second demo, "Night Garage" (Antent-style future garage: drums, 808, supersaw pad with pump, chops, arp, automation).
// Fetched when asked for (demo-night-garage.json next to index.html); opening it always gives a fresh copy.
async function nightGarageCopy() {
  const r = await fetch('demo-night-garage.json?v=9c', { cache: 'no-cache' }); if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json(); d.id = 'demo-night-garage'; d.schema = d.schema || 'nfx-studio/1'; d.updatedAt = Date.now(); return d;
}
async function openNightGarage() {
  await S.saver?.flush();
  let d; try { d = await nightGarageCopy(); } catch (e) { console.warn('[slowreel] night garage', e); toast('Night Garage could not be loaded.'); return null; }
  try { await S.store?.save(d); } catch { }
  closeProj(); await openProject(d, { fresh: true }); toast('Night Garage, fresh. Press play.');
  return d;
}
// ---------------------------------------------------------------- recipes (js/recipes + js/ui/recipes-panel.js)
let recipesMod = null;
const recipesPanel = () => (recipesMod ||= import('./recipes-panel.js?v=9c'));
/** Load a recipe project the way opening a project or the demo does: the current tape is saved first, the recipe becomes
 *  the current project (its own id, saved, autosaved from here on) and starts with a clean undo history. */
async function loadRecipeProject(project, recipe) {
  await S.saver?.flush();
  const p = clone(project);
  if (!p.id || p.id === S.project?.id) p.id = 'p-' + Date.now().toString(36);
  p.createdAt = p.updatedAt = Date.now();
  try { await S.store?.save(p); } catch (e) { console.warn('[slowreel] recipe save', e); }
  await openProject(p, { fresh: true });
  toast(`Recipe loaded: ${recipe?.title || p.name}. Press play.`);
  return p;
}
async function showRecipes(opts = {}) {
  try { const m = await recipesPanel(); m.openRecipes({ onLoad: loadRecipeProject, ...opts }); }
  catch (e) { console.error('[slowreel] recipes', e); toast('Recipes could not open.'); }
}
$('b-recipes').onclick = () => showRecipes();
async function deleteProject(id) {
  try { await S.store?.remove(id); } catch { }
  if (id === S.project.id) { S.saver?.cancel?.(); const d = demoCopy(); await openProject(d, { fresh: true }); }
  await fillProj();
}

// ---------------------------------------------------------------- export dialog
let exporting = false, exportAbort = null;
$('b-export').onclick = openExport;
$('exp-close').onclick = () => { if (exporting) exportAbort?.abort(); closeExport(); };
$('export-scrim').addEventListener('pointerdown', e => { if (e.target === $('export-scrim') && !exporting) closeExport(); });
let lastFocus = null;
function openExport() {
  if (S.playing) stop();
  lastFocus = document.activeElement;
  const p = S.project, secs = songSeconds(p);
  $('exp-body').innerHTML = '';
  $('exp-body').append(
    h('p', { text: `I render "${p.name}" offline with the full reverb tail, then pack a WAV and an MP3 in one zip.` }),
    h('div', { class: 'specs' },
      spec('Length', `${fmtTime(secs)} + tail`), spec('Files', 'WAV + MP3 in .zip'),
      spec('WAV', '24-bit · 44.1 kHz'), spec('MP3', '320 kbps CBR')),
    h('p', { class: 'small', text: 'Kept as quiet as you mixed it: no loudness normalising, only a safety limiter at -1 dBFS.' }),
    h('ol', { class: 'steps', id: 'exp-steps' }, ...[['render', 'Render the mix'], ['wav', 'WAV 24-bit'], ['mp3', 'MP3 320 kbps'], ['zip', 'Pack the zip'], ['save', 'Save']].map(([id, n]) =>
      h('li', { id: `st-${id}` }, h('i'), h('span', { text: n }), h('span', { class: 'mono', text: '' })))),
    h('div', { class: 'progress', 'aria-hidden': 'true' }, h('i', { id: 'exp-bar' })));
  $('exp-foot').innerHTML = '';
  $('exp-foot').append(h('button', { class: 'key', id: 'exp-video', title: 'A music video with the fox heart and this mix', onclick: () => { if (exporting) return; closeExport(); openVisual({ kind: 'project' }); } }, icon('heart'), 'Music video'), h('span', { class: 'grow' }),
    h('button', { class: 'key', id: 'exp-cancel', text: 'Close', onclick: () => { if (exporting) exportAbort?.abort(); closeExport(); } }),
    h('button', { class: 'key signal', id: 'exp-go', onclick: runExport }, icon('export'), 'Export'));
  $('export-scrim').hidden = false; $('exp-go').focus();
}
const spec = (k, v) => h('div', { class: 'spec' }, h('span', { class: 'label', text: k }), h('strong', { text: v }));
function closeExport() { $('export-scrim').hidden = true; lastFocus?.focus?.(); }
async function runExport() {
  if (exporting) return; exporting = true; exportAbort = new AbortController();
  const go = $('exp-go'); go.disabled = true;
  const bar = $('exp-bar'); const W = { render: 0.35, wav: 0.4, mp3: 0.9, zip: 0.95, save: 1 };
  try {
    const r = await exportMaster({ signal: exportAbort.signal,
      onStep: (id, st, detail) => { const li = $(`st-${id}`); if (!li) return; li.className = st; if (detail) li.lastChild.textContent = detail; if (st === 'done') bar.style.width = W[id] * 100 + '%'; },
      onRenderProgress: f => { bar.style.width = Math.min(35, f * 35) + '%'; },
      onProgress: f => { bar.style.width = (40 + f * 50) + '%'; } });
    const msg = { saved: 'Saved. Find the zip in your downloads.', fallback: 'Downloaded.', declined: 'Saving was declined. Nothing was saved.', unavailable: 'Downloads are not available in this view.', error: `Could not save (${r.saveCode || 'error'}).` }[r.saveStatus];
    $('exp-body').append(h('p', { class: 'result', text: `${msg} Peak ${r.measure.peakDb.toFixed(1)} dBFS${r.measure.clippedSamples ? `, ${r.measure.clippedSamples} clipped samples` : ', no clipping'}.` }));
    go.disabled = false; go.lastChild.textContent = 'Export again';
  } catch (e) {
    console.warn(e);
    $('exp-body').append(h('p', { class: 'result err', text: e?.name === 'AbortError' ? 'Export cancelled.' : 'Export stopped: ' + (e?.message || e) }));
    go.disabled = false;
  } finally { exporting = false; }
}

// ---------------------------------------------------------------- toast
let toastT;
function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600); }
on('toast', toast);

// ---------------------------------------------------------------- visual loop (sleeps when quiet or hidden)
// Per frame: the playhead and counter only (transforms + text nodes, no layout reads). The decorative canvases (reels,
// VU, song cloud), meters and level analysis run at 30 fps (20 fps in Light mode); in Light mode the whole loop runs
// at 20 fps. Hidden canvases are skipped, the loop stops when the tab is hidden and sleeps 1.5 s after the music stops.
const deck = createDeck($('deck-canvas')), vu = createVU($('vu-canvas'));
const ui3d = mountStudio3D({ S, pcOnly: PC_ONLY_SCREEN });   // 3D studio deck (js/ui3d), setting 'ui3d', default on
let raf = 0, lastT = 0, quietSince = 0, lastDecor = 0, decorN = 0, level = 0;
const phoneMQ = matchMedia('(max-width: 760px)');
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const decorFps = () => (S.light ? 20 : 30);
function startLoop() { if (!raf && !document.hidden && !PC_ONLY_SCREEN) { lastT = performance.now(); lastDecor = 0; quietSince = 0; raf = requestAnimationFrame(loop); } }
function loop(now) {
  raf = 0;
  if (S.light && lastT && now - lastT < 1000 / 20 - 4) { raf = requestAnimationFrame(loop); return; }   // Light mode: 20 fps
  lastT = now;
  const pos = S.engine.position();
  if (S.playing && !pos.playing) { S.playing = false; if (S.rec) finishRecording(); syncTransport(); }
  const beat = pos.beat;
  const an = S.engine.analyser;
  const sounding = S.playing || held.size > 0 || !!preview;
  const frac = preview ? (S.ctx.currentTime - preview.t0) / (preview.dur || 1) : beat / songBeats();
  const phone = phoneMQ.matches;
  if (!phone) { updateCounter(beat); setPlayhead(beat); setRollHead(beat); }
  const decor = !lastDecor || now - lastDecor >= 1000 / decorFps() - 4;
  let moving = false;
  if (decor) {
    const dt = lastDecor ? Math.min(0.1, (now - lastDecor) / 1000) : 1 / decorFps(); lastDecor = now; decorN++;
    if (an) { const b = loop.buf || (loop.buf = new Float32Array(an.fftSize)); an.getFloatTimeDomainData(b); let s = 0; for (let i = 0; i < b.length; i += 4) s += b[i] * b[i]; level = Math.sqrt(s / (b.length / 4)) * 3; }
    if (phone) phoneFrame({ beat, dt, level, playing: S.playing, frac });
    else {
      deck.draw({ playing: S.playing || !!preview, frac: clamp(frac, 0, 1), level, analyser: an, dt, still: reduceMQ.matches });
      moving = vu.draw({ analyser: an, playing: sounding || level > 0.001, dt });
      ui3d.frame({ playing: S.playing || !!preview, frac: clamp(frac, 0, 1), level, beat });
      const levels = {}, mini = {};
      for (const t of S.project.tracks) { const m = S.engine.meter(t.id); levels[t.id] = m; mini[t.id] = clamp((m.rmsDb + 60) / 54, 0, 1); }
      updateMeters(mini); updateMixMeters(levels, S.engine.meter('master'));
      const t = track(); animateCloud(t ? mini[t.id] || 0 : 0, dt);
      if (preview && decorN % 3 === 0) { const li = $(`tape-${preview.id}`); if (li) drawPeaks(li.querySelector('canvas'), SONGS.find(s => s.id === preview.id).peaks, li.style.getPropertyValue('--c'), frac); }
    }
    if (!sounding && !moving && level < 0.0005) { if (!quietSince) quietSince = now; } else quietSince = 0;
  }
  if (quietSince && now - quietSince > 1500) { drawIdle(); return; }   // sleep
  raf = requestAnimationFrame(loop);
}
function drawIdle() {
  if (!S.project || !S.engine) return;
  const b = S.engine?.position().beat || 0;
  updateCounter(b);
  if (phoneMQ.matches) phoneFrame({ beat: b, dt: 0, level: 0, playing: false, frac: b / songBeats() });
  else { deck.draw({ playing: false, frac: clamp(b / songBeats(), 0, 1), level: 0, analyser: null, dt: 0 }); vu.draw({ analyser: null, playing: false, dt: 1 }); ui3d.frame({ playing: false, frac: clamp(b / songBeats(), 0, 1), level: 0, beat: b }); }
  updateMeters({}); animateCloud(0, 0);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else startLoop(); });
new ResizeObserver(() => { if (!raf) drawIdle(); }).observe($('deck-glass'));
phoneMQ.addEventListener?.('change', () => { if (!raf) drawIdle(); });

// ---------------------------------------------------------------- Light mode (weaker PCs) + settings
// Off by default. Turned on automatically only when a one-time render-speed probe (the busiest moment of the song,
// rendered offline with the full sound, best of two 2.5 s runs) shows this computer cannot keep up live: below 1.8x
// real time offline, live playback runs the audio thread at ~65% on average with peaks past 90%, which is where
// stutters start. The choice Nico makes in Settings always wins. Exports always render the full sound.
const LIGHT_KEY = 'slowreel:light', PROBE_KEY = 'slowreel:probe', PROBE_MIN_RTF = 1.8;
let probeInfo = null;
try { probeInfo = JSON.parse(lsGet(PROBE_KEY) || 'null'); } catch { }
function setLight(on, { save = true, why = '' } = {}) {
  on = !!on; S.light = on;
  S.engine.setLight?.(on);
  ui3d.setLight(on);
  if (save) lsSet(LIGHT_KEY, on ? 'on' : 'off');
  $('b-settings')?.classList.toggle('lit', on);
  if (!$('set-pop').hidden) fillSettings();
  if (why) toast(why);
}
function initLight() {
  const q = new URLSearchParams(location.search).get('light');
  if (q === '1' || q === '0') { setLight(q === '1', { save: false }); return; }
  const saved = lsGet(LIGHT_KEY);
  if (saved === 'on' || saved === 'off') { setLight(saved === 'on', { save: false }); return; }
  if (probeInfo && Date.now() - (probeInfo.at || 0) < 30 * 864e5) { if (probeInfo.rtf < PROBE_MIN_RTF) setLight(true, { save: false }); return; }
  // no choice and no recent probe: measure once, when the studio is idle
  const tryProbe = () => {
    if (S.playing || exporting || !S.engine?.speedProbe) { setTimeout(tryProbe, 5000); return; }
    const once = () => S.engine.speedProbe({ seconds: 2.5 });
    once().then(a => (a && a.rtf < PROBE_MIN_RTF ? once().then(b => (b && b.rtf > a.rtf ? b : a)) : a)).then(r => {   // a slow first run gets a second chance
      if (!r) return;
      probeInfo = { rtf: r.rtf, at: Date.now() }; lsSet(PROBE_KEY, JSON.stringify(probeInfo));
      if (r.rtf < PROBE_MIN_RTF && lsGet(LIGHT_KEY) === null) setLight(true, { save: false, why: 'Light mode is on: this computer is a little slow for the full sound. Change it in Settings.' });
      if (!$('set-pop').hidden) fillSettings();
    }).catch(e => console.warn('[slowreel] speed probe', e));
  };
  setTimeout(tryProbe, 4000);
}
const setPop = $('set-pop');
$('b-settings').onclick = () => (setPop.hidden ? openSettings() : closeSettings());
document.addEventListener('pointerdown', e => { if (!setPop.hidden && !setPop.contains(e.target) && !$('b-settings').contains(e.target)) closeSettings(); });
function openSettings() {
  setPop.hidden = false; $('b-settings').setAttribute('aria-expanded', 'true');
  const r = $('b-settings').getBoundingClientRect();
  setPop.style.top = r.bottom + 8 + 'px'; setPop.style.left = Math.max(10, Math.min(innerWidth - 330, r.right - 320)) + 'px';
  fillSettings(); setPop.querySelector('button')?.focus();
}
function closeSettings() { if (setPop.hidden) return; setPop.hidden = true; $('b-settings').setAttribute('aria-expanded', 'false'); }
function fillSettings() {
  setPop.textContent = '';
  const btn = h('button', { class: 'key led-green', id: 'set-light', 'aria-pressed': String(S.light), onclick: () => setLight(!S.light, { why: S.light ? 'Light mode is off: the full sound.' : 'Light mode is on.' }) }, h('span', { class: 'led' }), 'Light mode');
  const speed = probeInfo ? `This computer renders the busiest part of a song at ${probeInfo.rtf.toFixed(1)}x real time${probeInfo.rtf < PROBE_MIN_RTF ? ', so Light mode helps here.' : ', so the full sound should play smoothly.'}` : 'Slowreel checks once whether this computer keeps up with the full sound.';
  const mode = h('div', { class: 'segk', role: 'group', 'aria-label': 'How many tools to show' },
    h('button', { class: 'key sm', id: 'set-simple', 'aria-pressed': String(S.simple), text: 'Simple', onclick: () => setSimple(true) }),
    h('button', { class: 'key sm', id: 'set-all', 'aria-pressed': String(!S.simple), text: 'All tools', onclick: () => setSimple(false) }));
  setPop.append(h('h2', { text: 'Settings' }),
    h('div', { class: 'set-row mode-row' }, mode),
    h('p', { class: 'pm-note', text: 'Simple shows Notes, Sound and Keys (and Beats when the tape has drums). All tools adds Effects, Mixer, automation and every editing option. Your tapes sound and export the same either way.' }),
    h('div', { class: 'set-row' }, btn),
    h('p', { class: 'pm-note', text: 'For slower computers: one shared short room instead of every reverb, no shimmer, half the voices and grains, calmer visuals. Your project and your exports keep the full sound.' }),
    h('p', { class: 'pm-note', id: 'set-speed', text: speed }), ui3d.settingsRow());
}

// ---------------------------------------------------------------- test hook (BRIEF "Test contract")
window.__studio = {
  play() { play(0); return true; },
  stop() { stop(); return true; },
  status() {
    if (!S.project || !S.engine) return { playing: false, beat: 0, tracks: 0, clips: 0, notes: 0, project: null, cpuHint: 'starting' };
    const p = S.project, pos = S.engine.position();
    return { playing: pos.playing, beat: +pos.beat.toFixed(3), tracks: p.tracks.length, clips: p.tracks.reduce((a, t) => a + t.clips.length, 0),
      notes: p.tracks.reduce((a, t) => a + t.clips.reduce((b, c) => b + (c.notes?.length || 0), 0), 0), project: p.name,
      cpuHint: S.engine.isMock ? 'mock engine' : JSON.stringify(S.engine.stats?.() || {}) };
  },
  async renderOffline(seconds = 8) { const { buf } = await renderProject({ seconds, tailSeconds: 0 }); const m = measure(buf); return { ...m, seconds: +buf.duration.toFixed(2) }; },
  async exportMaster({ seconds = 6 } = {}) { return exportMaster({ seconds }); },
  // music video (test hook): source 'project' or a song id; returns {bytes, mime, width, height, frames, hasAudio, codec, saveStatus}
  // (also scene, variant, res '720'|'1080'|'1440'|'2160', quality, showText, fps: see visual-panel.js exportVideoFor)
  async exportVideo({ format = '9:16', seconds = 4, source = 'project', mood, intensity, ...more } = {}) {
    const r = await exportVideoFor({ source: source === 'project' ? { kind: 'project' } : { kind: 'song', id: source }, format, seconds, mood, intensity, ...more });
    return { bytes: r.bytes, mime: r.mime, width: r.width, height: r.height, frames: r.frames, hasAudio: r.hasAudio, codec: r.codec, note: r.note, where: r.where, saveStatus: r.saveStatus, scene: r.scene, variant: r.variant };
  },
  // extra test helpers (not in the contract): per-track meters, play from a beat, the live project and backend
  meters() { const o = {}; for (const t of S.project.tracks) o[t.name] = S.engine.meter(t.id); return o; },
  playFrom(beat) { play(beat); return true; },
  async loadNightGarage() { const d = await openNightGarage(); return d ? { id: d.id, name: d.name, tracks: d.tracks.length } : null; },
  async loadDemo() { await restoreDemo(); return { id: S.project.id, name: S.project.name }; },
  gotoTab(k) { gotoTab(k); return S.tab; },
  async newTape(kind = 'blank') { const p = await startTape(kind === 'blank' ? { kind: 'blank' } : { kind: 'starter', starter: kind }); return { id: p.id, name: p.name, tracks: p.tracks.length, bpm: p.bpm, key: p.key, scale: p.scale }; },
  setSimple(on) { setSimple(on, { save: false }); return S.simple; },
  tabs() { return TABS.filter(k => !$(`tab-${k}`).hidden); },
  info() { return { engine: S.engine.isMock ? 'mock' : 'real', backend: S.store?.backend || null, projectId: S.project?.id, stats: S.engine?.stats?.(), light: S.light, pcOnlyScreen: PC_ONLY_SCREEN }; },
  setLight(on) { setLight(on, { save: false }); return S.light; },
  speedProbe(seconds = 3) { return S.engine.speedProbe?.({ seconds }); },
  // load a recipe by id through the same path as the Recipes panel (tests)
  async loadRecipe(id) { const m = await import('../recipes/recipes.js?v=9c'); const r = m.recipeById?.(id) || m.RECIPES.find(x => x.id === id); if (!r) return null; const p = await loadRecipeProject(m.recipeProject ? m.recipeProject(r) : clone(r.project), r); return { id: p.id, name: p.name, tracks: p.tracks.length }; },
};

// ---------------------------------------------------------------- go
if (PC_ONLY_SCREEN) showPcOnly();
else {
  initArrange($('arr-scroll'), $('arr'));
  initRoll($('pane-notes'));
  initPanels({ sound: $('pane-sound'), fx: $('pane-fx'), mix: $('pane-mix'), keys: $('pane-keys') });
  initSteps($('pane-beats'));
  // pocket mode: only for a narrow window on a computer (phones get the made-for-your-computer screen instead)
  initVisual({ S, play: () => play(), stop, togglePreview, stopPreview, previewId: () => preview?.id || null, openAudioExport: openExport, toast });
  $('b-visual').onclick = () => openVisual({ kind: 'project' });
  initPhone({ play: () => play(), stop, returnToStart, keyOn: (tid, m) => { S.engine.noteOn(tid, m, 0.7); startLoop(); }, keyOff: (tid, m) => S.engine.noteOff(tid, m), startLoop });
  boot().catch(e => { console.error('[slowreel] boot failed', e); toast('Slowreel could not start: ' + (e?.message || e)); });
}
// Phones: Slowreel is made for a computer. A calm screen with the reels, no AudioContext, nothing else starts.
function showPcOnly() {
  document.documentElement.classList.add('pc-only');
  const sec = $('pconly'); sec.hidden = false;
  const cv = $('pc-reels'), d = createDeck(cv);
  const draw = () => d.draw({ playing: false, frac: 0.38, level: 0, analyser: null, dt: 0, still: true });
  requestAnimationFrame(draw); new ResizeObserver(() => requestAnimationFrame(draw)).observe(cv);
  // the studio stays PC only, but a phone can make a music video of one of Nico's songs (or a file from the phone)
  $('pc-video').onclick = () => import('../visual/phone-maker.js?v=9c').then(m => m.openPhoneMaker()).catch(e => { console.error('[slowreel] video maker', e); });
}
void renderTab; void instDef; void kb;
