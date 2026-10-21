// phone-maker.js - the phone video maker. The studio stays PC only; on a phone the "made for your computer" screen
// opens this simple page: pick one of Nico's songs or a file from the phone (kept in memory only, never stored or
// uploaded), title, mood, 9:16 or 1:1, a light preview, and the same frame-exact renderer + WebCodecs export as the PC.
// No studio engine here; an AudioContext is made only if you press Listen.
import { h, icon } from '../ui/controls.js?v=9a';
import { SONGS, songUrl } from '../../lib/songs.js?v=9a';
import { makeVideo, decodeAudio, saveVideo, pickCodecs } from './video.js?v=9a';
import { computeFeatures, frameAt, idleFeatures } from './features.js?v=9a';
import { MOOD_LIST, fmtEta, kbmb, previewPacer } from './common.js?v=9a';
import { createPreview } from './preview.js?v=9a';

const SIZES = { '9:16': { 720: [720, 1280], 1080: [1080, 1920] }, '1:1': { 720: [720, 720], 1080: [1080, 1080] } };
const st = { format: '9:16', size: 720, mood: 'sakura', artist: 'Nicofoxheart', title: '' };
let root = null, cur = null, scene = null, pacer = null, raf = 0, t0 = performance.now(), listen = null, job = null, lastResult = null, wake = null, loadSeq = 0;
const $ = id => document.getElementById(id);
const fmtDur = d => `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}`;

export function openPhoneMaker() {
  if (!root) build();
  document.documentElement.classList.add('vmaker-on');
  root.hidden = false; window.scrollTo(0, 0); $('vm-back').focus();
  startLoop();
}
function closeMaker() {
  if (job) return;
  stopListen(); stopLoop();
  document.documentElement.classList.remove('vmaker-on'); root.hidden = true; $('pc-video')?.focus();
}

function build() {
  const songBtns = SONGS.map(s => h('button', { class: 'key vm-song', id: `vm-song-${s.id}`, 'aria-pressed': 'false', onclick: () => pickSong(s.id) },
    h('span', { class: 'nm', text: s.title }), h('span', { class: 'mono', text: fmtDur(s.duration) })));
  const file = h('input', { type: 'file', id: 'vm-file', accept: 'audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac', class: 'sr', onchange: e => pickFile(e.target.files?.[0]) });
  const seg = (id, opts, val, on) => h('div', { class: 'segk vm-seg', role: 'group', id }, ...opts.map(([v, label]) =>
    h('button', { class: 'key', id: `${id}-${String(v).replace(':', 'x')}`, 'aria-pressed': String(v === val), onclick: e => { e.currentTarget.parentNode.querySelectorAll('.key').forEach(k => k.setAttribute('aria-pressed', String(k === e.currentTarget))); on(v); } }, label)));
  root = h('section', { class: 'vmaker', id: 'vmaker', 'aria-labelledby': 'vm-h', hidden: true },
    h('div', { class: 'vm-head' },
      h('button', { class: 'key', id: 'vm-back', 'aria-label': 'Back', onclick: closeMaker }, icon('return'), 'Back'),
      h('div', {}, h('h1', { id: 'vm-h', text: 'Music video' }), h('span', { class: 'label', text: 'Slowreel · fox heart' }))),
    h('div', { class: 'module vm-card' },
      h('h2', { class: 'label', text: '1 · Sound' }),
      h('div', { class: 'vm-songs' }, ...songBtns),
      h('label', { class: 'key vm-import', for: 'vm-file' }, icon('plus'), 'Use a song from this phone', file),
      h('p', { class: 'pm-note', id: 'vm-src-note', text: 'The sound goes in exactly as it is. A file from your phone stays on your phone.' })),
    h('div', { class: 'module vm-card' },
      h('h2', { class: 'label', text: '2 · Look' }),
      h('div', { class: 'glass vm-stage', id: 'vm-stage' }, h('span', { class: 'vz-wait', id: 'vm-wait', text: 'Pick a song above' })),
      h('div', { class: 'vm-row' },
        h('button', { class: 'key', id: 'vm-listen', 'aria-pressed': 'false', disabled: true, onclick: toggleListen }, h('span', { class: 'led' }), icon('play'), 'Listen'),
        seg('vm-fmt', [['9:16', '9:16'], ['1:1', '1:1']], st.format, v => { st.format = v; fit(); sizeNote(); })),
      h('label', { class: 'vz-field' }, h('span', { class: 'label', text: 'Title' }), h('input', { class: 'vz-in', id: 'vm-title', type: 'text', maxlength: '60', placeholder: 'No title', oninput: e => { st.title = e.target.value; scene?.setText({ title: st.title }); } })),
      h('label', { class: 'vz-field' }, h('span', { class: 'label', text: 'Artist' }), h('input', { class: 'vz-in', id: 'vm-artist', type: 'text', maxlength: '40', value: st.artist, oninput: e => { st.artist = e.target.value; scene?.setText({ artist: st.artist }); } })),
      h('div', { class: 'vz-group' }, h('span', { class: 'label', text: 'Mood' }),
        h('div', { class: 'vz-moods' }, ...MOOD_LIST.map(m => h('button', { class: 'key vz-mood', id: `vm-mood-${m.id}`, 'aria-pressed': String(m.id === st.mood),
          onclick: e => { st.mood = m.id; root.querySelectorAll('.vz-mood').forEach(k => k.setAttribute('aria-pressed', String(k === e.currentTarget))); scene?.setMood(m.id); } },
          h('i', { style: { background: `linear-gradient(135deg, ${m.sky}, ${m.heart})` } }), m.name))))),
    h('div', { class: 'module vm-card' },
      h('h2', { class: 'label', text: '3 · Make' }),
      h('div', { class: 'vm-row' }, h('span', { class: 'label', text: 'Size' }), seg('vm-size', [[720, '720p'], [1080, '1080p']], st.size, v => { st.size = v; sizeNote(); })),
      h('p', { class: 'pm-note', id: 'vm-size-note' }),
      h('p', { class: 'vm-warn', text: 'This takes a few minutes. Keep this page open and the screen on until it is saved.' }),
      h('div', { class: 'progress', 'aria-hidden': 'true' }, h('i', { id: 'vm-bar' })),
      h('p', { class: 'vz-status', id: 'vm-status', role: 'status', 'aria-live': 'polite' }),
      h('div', { class: 'vm-row vm-go' },
        h('button', { class: 'key', id: 'vm-cancel', hidden: true, onclick: () => job?.abort() }, 'Cancel'),
        h('button', { class: 'key', id: 'vm-save', hidden: true, onclick: saveAgain }, 'Save again'),
        h('button', { class: 'key signal', id: 'vm-make', disabled: true, onclick: make }, icon('export'), 'Make video'))));
  document.body.append(root);
  sizeNote();
}

async function sizeNote() {
  const [w, hh] = SIZES[st.format][st.size], el = $('vm-size-note'); if (!el) return;
  el.textContent = `${w}×${hh}, 30 fps.`;
  const c = await pickCodecs(w, hh);
  el.textContent = `${w}×${hh}, 30 fps, ${c ? c.label : 'recorded in real time'}.${c?.note ? ' ' + c.note : ''}`;
}

// ------------------------------------------------------------------------------------------------ sound
function markSong(id) { SONGS.forEach(s => $(`vm-song-${s.id}`).setAttribute('aria-pressed', String(s.id === id))); }
async function pickSong(id) {
  const s = SONGS.find(x => x.id === id);
  markSong(id);
  await load(async () => { const r = await fetch(songUrl(id)); if (!r.ok) throw new Error('could not load the song'); return r.arrayBuffer(); }, s.title, `"${s.title}" · ${fmtDur(s.duration)}`);
}
async function pickFile(f) {
  if (!f) return;
  markSong(null);
  const name = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 60);
  await load(() => f.arrayBuffer(), name, `"${f.name}" from this phone (kept on the phone)`);
  $('vm-file').value = '';
}
async function load(getBytes, title, label) {
  if (job) return;
  const seq = ++loadSeq;
  stopListen(); cur = null; $('vm-make').disabled = true; $('vm-listen').disabled = true;
  const note = $('vm-src-note'); note.textContent = 'Reading the sound…';
  try {
    const audio = await decodeAudio(await getBytes());
    if (seq !== loadSeq) return;
    note.textContent = 'Listening for the beats…';
    const F = await computeFeatures(audio, { fps: 30, onProgress: f => { note.textContent = `Listening for the beats… ${Math.round(f * 100)}%`; } });
    if (seq !== loadSeq) return;
    cur = { audio, F, title };
    st.title = title; $('vm-title').value = title; note.textContent = `${label}. Ready.`;
    $('vm-make').disabled = false; $('vm-listen').disabled = false;
    await ensureScene(); scene?.setText({ title });
  } catch (e) {
    console.warn('[video maker] load', e);
    if (seq === loadSeq) note.textContent = 'That sound could not be read. Try another file (mp3, m4a or wav).';
  }
}

// ------------------------------------------------------------------------------------------------ preview (light)
let sceneLoading = null;
function ensureScene() { return scene ? Promise.resolve() : (sceneLoading ||= loadScene().finally(() => { sceneLoading = null; })); }
async function loadScene() {
  try {
    const sc = await createPreview({ width: 300, height: 533, pixelRatio: 1, mood: st.mood, intensity: 0.6, light: true, antialias: false, title: st.title, artist: st.artist });
    pacer = previewPacer({ fps: 30, minScale: 0.35, onScale: fit });
    scene = sc;
    scene.canvas.setAttribute('role', 'img'); scene.canvas.setAttribute('aria-label', 'Preview: the glowing fox heart');
    $('vm-wait')?.remove(); $('vm-stage').append(scene.canvas);
    new ResizeObserver(fit).observe($('vm-stage')); fit(); startLoop();
  } catch (e) { console.warn('[video maker] preview', e); const w = $('vm-wait'); if (w) w.textContent = 'No 3D preview on this phone (WebGL). Making the video may still work.'; }
}
function fit() {
  if (!scene) return;
  const stage = $('vm-stage'), [w0, h0] = SIZES[st.format][720], ar = w0 / h0;
  const bw = stage.clientWidth - 12, bh = Math.min(stage.clientHeight - 12, 480); if (bw <= 0) return;
  let w = bw, hh = w / ar; if (hh > bh) { hh = bh; w = hh * ar; }
  w = Math.floor(w); hh = Math.floor(hh);
  const k = pacer?.scale || 1;
  scene.canvas.style.width = w + 'px'; scene.canvas.style.height = hh + 'px'; scene.setSize(Math.max(48, Math.round(w * k)), Math.max(48, Math.round(hh * k)), 1);
}
function startLoop() { if (!raf && scene && !job && root && !root.hidden && !document.hidden) { pacer?.reset(); raf = requestAnimationFrame(frame); } }
function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
function frame(now) {
  raf = 0; if (!scene || job || root.hidden || document.hidden) return;
  if (scene.busy || !pacer.tick(now)) { raf = requestAnimationFrame(frame); return; }
  const t = (now - t0) / 1000;
  let f;
  if (listen && cur) { const lt = Math.max(0, listen.ctx.currentTime - listen.start); f = frameAt(cur.F, Math.round(lt * 30)); scene.render(lt, f); }
  else scene.render(t, idleFeatures(t));
  raf = requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  startLoop();
  if (job && !wake) keepAwake();
});

function toggleListen() { listen ? stopListen() : startListen(); }
async function startListen() {
  if (!cur) return;
  const C = window.AudioContext || window.webkitAudioContext;
  const ctx = listen?.ctx || new C(); await ctx.resume();
  const src = ctx.createBufferSource(); src.buffer = cur.audio; src.connect(ctx.destination);
  const start = ctx.currentTime + 0.05; src.start(start);
  listen = { ctx, src, start }; src.onended = () => { if (listen?.src === src) stopListen(); };
  $('vm-listen').setAttribute('aria-pressed', 'true'); startLoop();
}
function stopListen() {
  if (!listen) return;
  try { listen.src.stop(); } catch { }
  listen.ctx.close().catch(() => { }); listen = null;
  $('vm-listen')?.setAttribute('aria-pressed', 'false');
}

// ------------------------------------------------------------------------------------------------ make
async function keepAwake() {
  try { wake = await navigator.wakeLock?.request('screen'); wake?.addEventListener?.('release', () => { wake = null; }); } catch { wake = null; }
}
async function make() {
  if (job || !cur) return;
  stopListen(); stopLoop();
  const ac = new AbortController(); job = ac;
  const [w, hh] = SIZES[st.format][st.size], bar = $('vm-bar'), status = $('vm-status');
  $('vm-make').disabled = true; $('vm-cancel').hidden = false; $('vm-save').hidden = true;
  root.querySelectorAll('.vm-song, .vm-import, #vm-listen, .vm-seg .key, .vz-mood, .vz-in').forEach(el => { el.disabled = true; el.classList.add('off'); });
  status.classList.remove('err'); status.textContent = 'Starting…'; bar.style.width = '0%';
  await keepAwake();
  const tStart = performance.now();
  try {
    const r = await makeVideo({ audio: cur.audio, features: cur.F, width: w, height: hh, fps: 30, seconds: window.__videoTestSeconds || undefined,
      mood: st.mood, intensity: 0.6, title: st.title, artist: st.artist, light: true, signal: ac.signal,
      onProgress: (stage, f, info) => {
        if (stage === 'frames' && info) { bar.style.width = (2 + 96 * f) + '%'; status.textContent = `Frame ${info.frame} of ${info.frames} · ${fmtEta(info.eta)}`; }
        else if (stage === 'finish') { bar.style.width = '99%'; status.textContent = 'Finishing the file…'; }
      } });
    lastResult = { name: `${st.title || 'Nicofoxheart'} - ${st.format.replace(':', 'x')}`, r };
    bar.style.width = '100%';
    const saved = await saveVideo(lastResult.name, r);
    window.__lastVideo = { bytes: r.blob.size, mime: r.mime, width: r.width, height: r.height, frames: r.frames, hasAudio: r.hasAudio, codec: r.codec, where: r.where, saveStatus: saved.status, ms: Math.round(performance.now() - tStart) };
    status.textContent = `${saveMsg(saved)} ${r.width}×${r.height}, ${kbmb(r.blob.size)}, ${r.codec}.`;
    $('vm-save').hidden = false;
  } catch (e) {
    if (e?.name !== 'AbortError') console.warn('[video maker] export', e);
    status.textContent = e?.name === 'AbortError' ? 'Cancelled. Nothing was saved.' : 'The video stopped: ' + (e?.message || e);
    status.classList.toggle('err', e?.name !== 'AbortError'); bar.style.width = '0%';
    window.__lastVideo = { error: String(e?.message || e) };
  } finally {
    job = null; try { await wake?.release(); } catch { } wake = null;
    $('vm-make').disabled = !cur; $('vm-cancel').hidden = true;
    root.querySelectorAll('.off').forEach(el => { el.disabled = false; el.classList.remove('off'); });
    $('vm-listen').disabled = !cur;
    startLoop();
  }
}
const saveMsg = s => ({ saved: 'Saved. Find it in your downloads.', fallback: 'Downloaded.', declined: 'Saving was declined.', unavailable: 'Downloads are not available in this view.' }[s.status] || `Could not save (${s.code || 'error'}).`);
async function saveAgain() { if (!lastResult) return; const s = await saveVideo(lastResult.name, lastResult.r); $('vm-status').textContent = saveMsg(s); }
