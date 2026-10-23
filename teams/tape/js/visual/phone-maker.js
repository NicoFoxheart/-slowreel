// phone-maker.js - the phone video maker. The studio stays PC only; on a phone the "made for your computer" screen
// opens this simple page: pick one of Nico's songs or a file from the phone (kept in memory only, never stored or
// uploaded), a world (every scene in the registry, the same groups and names as the PC, the fox heart included) and its
// variant, title, 9:16 or 1:1, a light live preview, and the same frame-exact render worker + WebCodecs export as the PC
// at 720p, light quality, 30 fps. World cards get tiny light thumbnails, one at a time, when they scroll into view.
// No studio engine here; an AudioContext is made only if you press Listen.
import { h, icon } from '../ui/controls.js?v=10b';
import { SONGS, songUrl } from '../../lib/songs.js?v=10b';
import { makeVideo, decodeAudio, saveVideo, pickCodecs } from './video.js?v=10b';
import { computeFeatures, frameAt, idleFeatures } from './features.js?v=10b';
import { MOOD_LIST, fmtEta, kbmb, previewPacer } from './common.js?v=10b';
import { createPreview } from './preview.js?v=10b';
import { listScenes, GROUPS, DEFAULT_SCENE } from './scenes/index.js?v=10b';

const SIZES = { '9:16': [720, 1280], '1:1': [720, 720] };     // the phone makes 720p only
const QUALITY = 'light', FPS = 30;
const THUMB = [120, 160];          // card thumbnails (3:4, light quality): tiny, one at a time
const PREVIEW_RES = 0.75;          // the live preview draws at 75% of its shown size (the pacer may lower it more)
const KEY = 'slowreel.phoneVideo';
const st = { format: '9:16', scene: DEFAULT_SCENE, variants: {}, artist: 'Nicofoxheart', title: '' };
let root = null, cur = null, scene = null, pacer = null, raf = 0, t0 = performance.now(), listen = null, job = null, lastResult = null, wake = null, loadSeq = 0, sceneSeq = 0;
const metas = new Map();           // scene id -> meta (from the preview worker), null when it cannot load
const thumbs = new Map();          // `${id}:${variant}` -> ImageBitmap
const cards = new Map();           // scene id -> card button
let snapQueue = [], snapping = false, io = null, released = true, shown = 'idle';   // shown: 'wait' -> 'sent' -> 'idle' (the new world's first frame)
const $ = id => document.getElementById(id);
const fmtDur = d => `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}`;
const fmtMin = s => (s < 50 ? 'under a minute' : `about ${Math.max(1, Math.round(s / 60))} min`);
const cap = s => s[0].toUpperCase() + s.slice(1);
const grad = sw => `linear-gradient(160deg, ${sw?.[0] || '#1d1640'}, ${sw?.[1] || '#ff7fbf'})`;
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };

export function openPhoneMaker() {
  if (!root) { Object.assign(st, pick(store.get(KEY))); build(); }
  document.documentElement.classList.add('vmaker-on');
  root.hidden = false; window.scrollTo(0, 0); $('vm-back').focus();
  ensureScene().then(() => { startLoop(); pumpThumbs(); });
  centerCard(st.scene);
}
function centerCard(id) {   // scroll the rail only (scrollIntoView would also move the page)
  const c = cards.get(id), rail = $('vm-worlds'); if (!c || !rail) return;
  rail.scrollLeft = Math.max(0, c.offsetLeft - rail.offsetLeft - (rail.clientWidth - c.offsetWidth) / 2);
}
function closeMaker() {
  if (job) return;
  stopListen(); stopLoop();
  document.documentElement.classList.remove('vmaker-on'); root.hidden = true; $('pc-video')?.focus();
}
const pick = s => (s && typeof s === 'object' ? { scene: typeof s.scene === 'string' && listScenes().some(x => x.id === s.scene) ? s.scene : DEFAULT_SCENE,
  variants: s.variants && typeof s.variants === 'object' ? s.variants : {}, format: SIZES[s.format] ? s.format : '9:16' } : {});
const remember = () => store.set(KEY, { scene: st.scene, variants: st.variants, format: st.format });

function build() {
  const songBtns = SONGS.map(s => h('button', { class: 'key vm-song', id: `vm-song-${s.id}`, 'aria-pressed': 'false', onclick: () => pickSong(s.id) },
    h('span', { class: 'nm', text: s.title }), h('span', { class: 'mono', text: fmtDur(s.duration) })));
  const file = h('input', { type: 'file', id: 'vm-file', accept: 'audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac', class: 'sr', onchange: e => pickFile(e.target.files?.[0]) });
  const seg = (id, opts, val, on) => h('div', { class: 'segk vm-seg', role: 'group', id }, ...opts.map(([v, label]) =>
    h('button', { class: 'key', id: `${id}-${String(v).replace(':', 'x')}`, 'aria-pressed': String(v === val), onclick: e => { e.currentTarget.parentNode.querySelectorAll('.key').forEach(k => k.setAttribute('aria-pressed', String(k === e.currentTarget))); on(v); } }, label)));
  const rail = h('div', { class: 'vm-worlds', id: 'vm-worlds', role: 'radiogroup', 'aria-label': 'World' });
  root = h('section', { class: 'vmaker', id: 'vmaker', 'aria-labelledby': 'vm-h', hidden: true },
    h('div', { class: 'vm-head' },
      h('button', { class: 'key', id: 'vm-back', 'aria-label': 'Back', onclick: closeMaker }, icon('return'), 'Back'),
      h('div', {}, h('h1', { id: 'vm-h', text: 'Music video' }), h('span', { class: 'label', text: 'Slowreel · worlds' }))),
    h('div', { class: 'module vm-card' },
      h('h2', { class: 'label', text: '1 · Sound' }),
      h('div', { class: 'vm-songs' }, ...songBtns),
      h('label', { class: 'key vm-import', for: 'vm-file' }, icon('plus'), 'Use a song from this phone', file),
      h('p', { class: 'pm-note', id: 'vm-src-note', text: 'The sound goes in exactly as it is. A file from your phone stays on your phone.' })),
    h('div', { class: 'module vm-card' },
      h('h2', { class: 'label', text: '2 · World' }),
      h('div', { class: 'glass vm-stage', id: 'vm-stage' }, h('span', { class: 'vz-wait', id: 'vm-wait', text: 'Waking up the preview…' })),
      h('div', { class: 'vm-now' }, h('span', { class: 'label', id: 'vm-now-group' }), h('strong', { id: 'vm-now-name' }), h('span', { class: 'vm-now-desc', id: 'vm-now-desc' })),
      rail,
      h('div', { class: 'vm-chips', id: 'vm-chips', role: 'radiogroup', 'aria-label': 'Variant' }),
      h('div', { class: 'vm-row' },
        h('button', { class: 'key', id: 'vm-listen', 'aria-pressed': 'false', disabled: true, onclick: toggleListen }, h('span', { class: 'led' }), icon('play'), 'Listen'),
        seg('vm-fmt', [['9:16', '9:16'], ['1:1', '1:1']], st.format, v => { st.format = v; remember(); fit(); sizeNote(); })),
      h('label', { class: 'vz-field' }, h('span', { class: 'label', text: 'Title' }), h('input', { class: 'vz-in', id: 'vm-title', type: 'text', maxlength: '60', placeholder: 'No title', oninput: e => { st.title = e.target.value; scene?.setText({ title: st.title }); } })),
      h('label', { class: 'vz-field' }, h('span', { class: 'label', text: 'Artist' }), h('input', { class: 'vz-in', id: 'vm-artist', type: 'text', maxlength: '40', value: st.artist, oninput: e => { st.artist = e.target.value; scene?.setText({ artist: st.artist }); } }))),
    h('div', { class: 'module vm-card' },
      h('h2', { class: 'label', text: '3 · Make' }),
      h('p', { class: 'vm-spec', id: 'vm-size-note' }),
      h('div', { class: 'vm-warn', id: 'vm-warn' },
        h('strong', { text: 'Every frame is drawn on this phone.' }),
        h('span', { text: 'It takes a while and the phone may get warm. That is normal. Keep this page open: the screen stays on until the video is saved.' }),
        h('span', { class: 'vm-est', id: 'vm-est' })),
      h('div', { class: 'progress', 'aria-hidden': 'true' }, h('i', { id: 'vm-bar' })),
      h('p', { class: 'vz-status', id: 'vm-status', role: 'status', 'aria-live': 'polite' }),
      h('div', { class: 'vm-row vm-go' },
        h('button', { class: 'key', id: 'vm-cancel', hidden: true, onclick: () => job?.abort() }, 'Cancel'),
        h('button', { class: 'key', id: 'vm-save', hidden: true, onclick: saveAgain }, 'Save again'),
        h('button', { class: 'key signal', id: 'vm-make', disabled: true, onclick: make }, icon('export'), 'Make video'))));
  document.body.append(root);
  buildWorlds(rail);
  showWorld(); sizeNote();
}

async function sizeNote() {
  const [w, hh] = SIZES[st.format], el = $('vm-size-note'); if (!el) return;
  el.textContent = `${w}×${hh} · 30 fps · light`;
  const c = await pickCodecs(w, hh, { fps: FPS });
  if (SIZES[st.format][1] !== hh) return;
  el.textContent = `${w}×${hh} · 30 fps · ${c ? c.label : 'recorded in real time'}`;
  estimateNote();
}
// a time estimate before you press Make: only from a real measurement made on this phone before (this world, this size)
function estimateNote() {
  const el = $('vm-est'); if (!el) return;
  const ms = store.get(`${KEY}.speed`)?.[`${st.scene}:${st.format}`];
  el.textContent = ms && cur ? `Last time this world took ${fmtMin(cur.audio.duration * FPS * ms / 1000)} on this phone for a song this long.` : '';
  el.hidden = !el.textContent;
}

// ------------------------------------------------------------------------------------------------ worlds
function buildWorlds(rail) {
  const order = s => GROUPS.indexOf(s.group) * 100 + (s.id === DEFAULT_SCENE ? -1 : 0);
  const list = listScenes().sort((a, b) => order(a) - order(b));
  io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { queueThumb(e.target.dataset.id); io.unobserve(e.target); } }, { root: rail, rootMargin: '0px 90px' }) : null;
  for (const s of list) {
    const cv = h('canvas', { class: 'vm-wthumb', width: String(THUMB[0]), height: String(THUMB[1]), 'aria-hidden': 'true' });
    const card = h('button', { class: 'vm-world', id: `vm-world-${s.id}`, role: 'radio', 'aria-checked': String(s.id === st.scene), 'data-id': s.id, 'aria-label': s.name,
      style: { '--sw': grad(s.swatch) }, onclick: () => chooseWorld(s.id) },
      h('span', { class: 'vm-wpic' }, cv, h('span', { class: 'vm-wshim' })),
      h('span', { class: 'vm-wmeta' }, h('span', { class: 'vm-weye', text: s.group }), h('span', { class: 'vm-wname', text: s.name })));
    cards.set(s.id, card); rail.append(card);
    if (io) io.observe(card); else queueThumb(s.id);
  }
  rail.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const vis = [...cards.values()].filter(c => !c.hidden), i = vis.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); const n = vis[(i + (e.key === 'ArrowRight' ? 1 : vis.length - 1)) % vis.length]; n.focus(); n.click();
  });
}
const variantOf = id => { const m = metas.get(id); const v = st.variants[id]; return m ? (m.variants.some(x => x.id === v) ? v : m.defaultVariant) : v || (id === 'heart' ? 'sakura' : null); };
function chooseWorld(id) {
  if (job || metas.get(id) === null || id === st.scene && scene?.scene === id) return;
  st.scene = id; remember();
  for (const [k, c] of cards) c.setAttribute('aria-checked', String(k === id));
  showWorld(); loadWorld(); estimateNote();
}
async function loadWorld() {
  if (!scene) return;
  const my = ++sceneSeq, id = st.scene, stage = $('vm-stage');
  stage.classList.add('loading');
  const meta = await scene.setScene({ scene: id, variant: st.variants[id] || null, quality: QUALITY });
  if (my !== sceneSeq) return;
  if (!meta) { stage.classList.remove('loading'); markBroken(id); if (id !== DEFAULT_SCENE) { st.scene = DEFAULT_SCENE; for (const [k, c] of cards) c.setAttribute('aria-checked', String(k === DEFAULT_SCENE)); showWorld(); return loadWorld(); } return; }
  metas.set(id, meta); showWorld();
  shown = 'wait'; startLoop();          // the stage stays dimmed until the new world's first frame is on screen
}
function markBroken(id) { metas.set(id, null); const c = cards.get(id); if (c) c.hidden = true; }
function showWorld() {
  const s = listScenes().find(x => x.id === st.scene), meta = metas.get(st.scene) || null, variant = variantOf(st.scene);
  const vars = meta?.variants || (st.scene === 'heart' ? MOOD_LIST.map(m => ({ id: m.id, name: m.name, text: { accent: m.heart } })) : []);
  const v = vars.find(x => x.id === variant);
  $('vm-now-group').textContent = [meta?.group || s?.group, v?.name].filter(Boolean).join(' · ');
  $('vm-now-name').textContent = meta?.name || s?.name || '';
  $('vm-now-desc').textContent = meta?.desc || s?.desc || '';
  $('vm-chips').replaceChildren(...vars.map(x => h('button', { class: 'key vm-chip', role: 'radio', id: `vm-var-${x.id}`, 'aria-checked': String(x.id === variant),
    style: { '--dot': x.swatch?.[1] || x.text?.accent || meta?.text?.accent || '#ffd7a0' }, onclick: () => setVariant(x.id) }, h('i'), x.name)));
  scene?.canvas.setAttribute('aria-label', `Preview: ${meta?.name || s?.name || ''}${v ? ', ' + v.name : ''}`);
}
function setVariant(id) {
  if (job) return;
  st.variants[st.scene] = id; remember();
  if (scene?.scene === st.scene) scene.setVariant(id);
  showWorld();
  if (!thumbs.has(`${st.scene}:${id}`)) queueThumb(st.scene, true); else drawThumb(st.scene);
}

// thumbnails: one at a time when a card scrolls into view, light and tiny, never while making a video
function queueThumb(id, front = false) { snapQueue = snapQueue.filter(x => x !== id); front ? snapQueue.unshift(id) : snapQueue.push(id); pumpThumbs(); }
function drawThumb(id) {
  const bm = thumbs.get(`${id}:${variantOf(id)}`), card = cards.get(id), cv = card?.querySelector('canvas');
  if (bm && cv) { cv.getContext('2d').drawImage(bm, 0, 0, cv.width, cv.height); card.classList.add('ready'); }
}
async function pumpThumbs() {
  if (snapping || job || !scene || root?.hidden) return;
  const id = snapQueue.shift();
  if (!id) { if (!released) { released = true; scene.releaseSnaps?.(); } return; }   // all drawn: free the thumbnail renderer
  snapping = true;
  try {
    if (metas.get(id) === null) return;
    const meta = metas.get(id) || (await scene.metas([id]))[0]?.meta || null;
    if (!meta) { markBroken(id); return; }
    metas.set(id, meta);
    if (id === st.scene) showWorld();
    const key = `${id}:${variantOf(id)}`;
    if (!thumbs.has(key)) { released = false; const bm = await scene.snap({ scene: id, variant: variantOf(id), quality: QUALITY, size: THUMB }); if (bm) thumbs.set(key, bm); }
    drawThumb(id);
  } catch (e) { console.warn('[video maker] thumbnail', id, e?.message || e); }
  finally { snapping = false; (window.requestIdleCallback || setTimeout)(() => pumpThumbs(), { timeout: 300 }); }
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
    const F = await computeFeatures(audio, { fps: FPS, onProgress: f => { note.textContent = `Listening for the beats… ${Math.round(f * 100)}%`; } });
    if (seq !== loadSeq) return;
    cur = { audio, F, title };
    st.title = title; $('vm-title').value = title; note.textContent = `${label}. Ready.`;
    $('vm-make').disabled = false; $('vm-listen').disabled = false;
    estimateNote();
    await ensureScene(); scene?.setText({ title });
  } catch (e) {
    console.warn('[video maker] load', e);
    if (seq === loadSeq) note.textContent = 'That sound could not be read. Try another file (mp3, m4a or wav).';
  }
}

// ------------------------------------------------------------------------------------------------ preview (light)
let sceneLoading = null;
function ensureScene() { return scene ? Promise.resolve() : (sceneLoading ||= loadPreview().finally(() => { sceneLoading = null; })); }
async function loadPreview() {
  const make = id => createPreview({ width: 240, height: 426, pixelRatio: 1, scene: id, variant: st.variants[id] || null, quality: QUALITY, intensity: 0.6, antialias: false, title: st.title, artist: st.artist });
  try {
    const sc = await make(st.scene).catch(e => { if (st.scene === DEFAULT_SCENE) throw e; console.warn('[video maker] world', st.scene, e?.message || e); st.scene = DEFAULT_SCENE; return make(DEFAULT_SCENE); });
    pacer = previewPacer({ fps: FPS, minScale: 0.55, onScale: fit });   // a slow phone drops to 15 fps before the picture gets blocky
    scene = sc;
    if (sc.meta) metas.set(sc.scene || st.scene, sc.meta);
    scene.canvas.setAttribute('role', 'img');
    $('vm-wait')?.remove(); $('vm-stage').append(scene.canvas);
    new ResizeObserver(fit).observe($('vm-stage')); fit();
    for (const [k, c] of cards) c.setAttribute('aria-checked', String(k === st.scene));
    showWorld(); startLoop();
    // every world's meta (names, variants), from the worker; a world that cannot load is hidden
    const ids = [...cards.keys()].filter(id => !metas.has(id));
    const list = await scene.metas(ids).catch(() => []);
    for (const x of list) { if (x.ok) metas.set(x.id, x.meta); else markBroken(x.id); }
    for (const [id, c] of cards) { const m = metas.get(id); if (m) { c.querySelector('.vm-wname').textContent = m.name; c.querySelector('.vm-weye').textContent = m.group; c.setAttribute('aria-label', m.name); } }
    showWorld(); pumpThumbs();
  } catch (e) { console.warn('[video maker] preview', e); const w = $('vm-wait'); if (w) w.textContent = 'No 3D preview on this phone (WebGL). Making the video may still work.'; }
}
function fit() {
  if (!scene) return;
  const stage = $('vm-stage'), [w0, h0] = SIZES[st.format], ar = w0 / h0;
  const bw = stage.clientWidth - 16, bh = Math.min(stage.clientHeight - 16, 480); if (bw <= 0) return;
  let w = bw, hh = w / ar; if (hh > bh) { hh = bh; w = hh * ar; }
  w = Math.floor(w); hh = Math.floor(hh);
  const k = PREVIEW_RES * (pacer?.scale || 1);
  scene.canvas.style.width = w + 'px'; scene.canvas.style.height = hh + 'px'; scene.setSize(Math.max(48, Math.round(w * k)), Math.max(48, Math.round(hh * k)), 1);
}
function startLoop() { if (!raf && scene && !job && root && !root.hidden && !document.hidden) { pacer?.reset(); raf = requestAnimationFrame(frame); } }
function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
function frame(now) {
  raf = 0; if (!scene || job || root.hidden || document.hidden) return;
  if (shown === 'sent' && !scene.busy) { shown = 'idle'; $('vm-stage').classList.remove('loading'); }
  if (scene.busy || !pacer.tick(now)) { raf = requestAnimationFrame(frame); return; }
  const t = (now - t0) / 1000;
  let sent;
  if (listen && cur) { const lt = Math.max(0, listen.ctx.currentTime - listen.start); sent = scene.render(lt, frameAt(cur.F, Math.round(lt * FPS)), { live: true, fps: FPS }); }
  else sent = scene.render(t, idleFeatures(t), { live: true, fps: FPS });
  if (sent && shown === 'wait') shown = 'sent';
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
const lockUi = on => {
  if (on) root.querySelectorAll('.vm-song, .vm-import, #vm-listen, .vm-seg .key, .vm-world, .vm-chip, .vz-in').forEach(el => { if (!el.disabled) { el.disabled = true; el.classList.add('off'); } });
  else root.querySelectorAll('.off').forEach(el => { el.disabled = false; el.classList.remove('off'); });
  root.classList.toggle('vm-busy', on);
};
async function make() {
  if (job || !cur) return;
  stopListen(); stopLoop();
  snapQueue = []; if (!released) { released = true; scene?.releaseSnaps?.(); }   // the thumbnail renderer is not needed while exporting
  const ac = new AbortController(); job = ac;
  const [w, hh] = SIZES[st.format], bar = $('vm-bar'), status = $('vm-status'), est = $('vm-est');
  const sceneId = st.scene, variant = variantOf(sceneId), format = st.format;
  $('vm-make').disabled = true; $('vm-cancel').hidden = false; $('vm-save').hidden = true;
  lockUi(true);
  status.classList.remove('err'); status.textContent = 'Starting…'; bar.style.width = '0%';
  await keepAwake();
  const tStart = performance.now();
  // the honest estimate: measured from this phone's first frames (after the world is built), refined as it goes
  const m = { f0: -1, t0: 0, msPer: 0, shownAt: 0 };
  try {
    const r = await makeVideo({ audio: cur.audio, features: cur.F, width: w, height: hh, fps: FPS, seconds: window.__videoTestSeconds || undefined,
      scene: sceneId, variant, quality: QUALITY, meta: metas.get(sceneId) || null, intensity: 0.6, title: st.title, artist: st.artist, signal: ac.signal,
      onProgress: (stage, f, info) => {
        if (stage === 'frames' && info) {
          const now = performance.now();
          bar.style.width = (2 + 96 * f) + '%';
          if (m.f0 < 0) { m.f0 = info.frame; m.t0 = now; }
          const done = info.frame - m.f0, el = now - m.t0;
          if (done >= Math.min(12, info.frames - 1) && el > 1500) {
            m.msPer = el / done;
            if (!m.shownAt || now - m.shownAt > 15000) {
              m.shownAt = now;
              est.hidden = false; est.textContent = `${cap(fmtMin(info.frames * m.msPer / 1000))} on this phone, measured from its first frames.`;
            }
            status.textContent = `Frame ${info.frame} of ${info.frames} · ${fmtEta((info.frames - info.frame) * m.msPer / 1000)}`;
          } else status.textContent = `Frame ${info.frame} of ${info.frames} · measuring this phone's speed…`;
        } else if (stage === 'listen') status.textContent = 'Listening for the beats…';
        else if (stage === 'finish') { bar.style.width = '99%'; status.textContent = 'Finishing the file…'; }
      } });
    if (m.msPer) { const sp = store.get(`${KEY}.speed`) || {}; sp[`${sceneId}:${format}`] = Math.round(m.msPer); store.set(`${KEY}.speed`, sp); }
    lastResult = { name: `${st.title || 'Nicofoxheart'} - ${format.replace(':', 'x')}`, r };
    bar.style.width = '100%';
    const saved = await saveVideo(lastResult.name, r);
    const ms = Math.round(performance.now() - tStart);
    window.__lastVideo = { bytes: r.blob.size, mime: r.mime, width: r.width, height: r.height, frames: r.frames, hasAudio: r.hasAudio, codec: r.codec, where: r.where, saveStatus: saved.status, ms,
      scene: r.scene, variant: r.variant, quality: r.quality, msPerFrame: Math.round(m.msPer), estimate: est.textContent };
    status.textContent = `${saveMsg(saved)} ${r.width}×${r.height}, ${kbmb(r.blob.size)}, ${r.codec}, made in ${ms < 60000 ? Math.round(ms / 1000) + ' s' : Math.round(ms / 60000) + ' min'}.`;
    $('vm-save').hidden = false;
  } catch (e) {
    if (e?.name !== 'AbortError') console.warn('[video maker] export', e);
    status.textContent = e?.name === 'AbortError' ? 'Cancelled. Nothing was saved.' : 'The video stopped: ' + (e?.message || e);
    status.classList.toggle('err', e?.name !== 'AbortError'); bar.style.width = '0%';
    window.__lastVideo = { error: String(e?.message || e) };
  } finally {
    job = null; try { await wake?.release(); } catch { } wake = null;
    $('vm-make').disabled = !cur; $('vm-cancel').hidden = true;
    lockUi(false);
    $('vm-listen').disabled = !cur;
    startLoop(); pumpThumbs();
  }
}
const saveMsg = s => ({ saved: 'Saved. Find it in your downloads.', fallback: 'Downloaded.', declined: 'Saving was declined.', unavailable: 'Downloads are not available in this view.' }[s.status] || `Could not save (${s.code || 'error'}).`);
async function saveAgain() { if (!lastResult) return; const s = await saveVideo(lastResult.name, lastResult.r); $('vm-status').textContent = saveMsg(s); }
