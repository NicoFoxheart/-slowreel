// visual-panel.js - the "Music video" window on the PC: pick a world (scenes/index.js), its variant, the sound (this tape,
// one of Nico's songs, or any imported audio file), format + resolution + quality, title on/off, then a frame-exact
// export with the audio inside. Everything 3D happens in workers: the live hero preview and the scene-card thumbnails
// in preview-worker.js (cards are rendered lazily, one at a time, when they scroll into view), the export in
// render-worker.js. The page only draws DOM, so the studio's audio never waits on the GPU.
import { h, icon } from '../ui/controls.js?v=10a';
import { SONGS, songUrl } from '../../lib/songs.js?v=10a';
import { FORMATS, RESOLUTIONS, DEFAULT_RES, videoSize, videoBitrate, pickCodecs, encodeSupport, makeVideo, renderProjectAudio, decodeAudio, saveVideo } from './video.js?v=10a';
import { kbmb, previewPacer } from './common.js?v=10a';
import { createPreview } from './preview.js?v=10a';
import { listScenes, GROUPS, DEFAULT_SCENE } from './scenes/index.js?v=10a';

let H = null;            // hooks from app.js
let ui = null;           // open window state
const st = { format: '16:9', res: DEFAULT_RES, quality: 'high', scene: DEFAULT_SCENE, variants: {}, showText: true, artist: 'Nicofoxheart', intensity: 0.6, filter: 'All', fps: 30 };
try {
  const saved = JSON.parse(localStorage.getItem('slowreel:visual') || '{}');
  if (saved.mood && !saved.variants) saved.variants = { heart: saved.mood };
  for (const k of Object.keys(st)) if (saved[k] !== undefined) st[k] = saved[k];
} catch { }
const remember = () => { try { localStorage.setItem('slowreel:visual', JSON.stringify(st)); } catch { } };
const QUALITY = [{ id: 'light', name: 'Light', note: 'Fast, for lighter PCs' }, { id: 'high', name: 'High', note: 'Film look, the default' }, { id: 'ultra', name: 'Ultra', note: 'Richest, slowest' }];
const thumbs = new Map();          // `${scene}:${variant}` -> ImageBitmap (kept while the page lives)
const metas = new Map();           // scene id -> meta (from the preview worker) or null when it cannot load
let imported = null;               // {name, buffer, F, url, duration} - an imported audio file, in memory only
let support = null;                // encodeSupport() result

/** hooks: {S, play, stop, togglePreview(id), stopPreview(), previewId(), openAudioExport(), toast} */
export function initVisual(hooks) { H = hooks; }
export const isVisualOpen = () => !!ui;

const sourceTitle = src => (src.kind === 'song' ? SONGS.find(s => s.id === src.id)?.title : src.kind === 'file' ? imported?.name : H.S.project?.name) || 'Untitled';
const sourceSeconds = src => (src.kind === 'song' ? SONGS.find(s => s.id === src.id)?.duration : src.kind === 'file' ? imported?.duration : H.S.engine?.projectSeconds?.(H.S.project));
const fmtTime = s => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
const fmtLeft = s => (!isFinite(s) ? '' : s < 60 ? `${Math.max(1, Math.round(s))} s left` : s < 3600 ? `${Math.round(s / 60)} min left` : `${Math.floor(s / 3600)} h ${Math.round(s % 3600 / 60)} min left`);
const grad = sw => `linear-gradient(135deg, ${(sw || ['#1d2024', '#4a5056'])[0]}, ${(sw || [])[1] || '#4a5056'})`;

/** Get the exact audio for a source: the rendered project mix, Nico's song or the imported file, decoded unchanged. */
async function sourceAudio(src, { seconds, onProgress } = {}) {
  if (src.kind === 'song') { const r = await fetch(songUrl(src.id)); if (!r.ok) throw new Error('could not load the song'); return decodeAudio(await r.arrayBuffer()); }
  if (src.kind === 'file') { if (!imported?.buffer) throw new Error('import an audio file first'); return imported.buffer; }
  return renderProjectAudio(H.S.engine, H.S.project, { seconds, onProgress });
}

/**
 * The whole export without the window (also window.__studio.exportVideo). format '16:9'|'9:16'|'1:1', res '720'|'1080'|
 * '1440'|'2160', scene + variant (mood = the heart's variant), quality 'light'|'high'|'ultra', showText, fps 30|60.
 */
export async function exportVideoFor({ source = { kind: 'project' }, format = st.format, res = st.res, seconds, scene = st.scene, variant, mood, quality = st.quality, showText = st.showText,
  intensity = st.intensity, title, artist = st.artist, fps = 30, meta, onProgress = () => { }, signal, save = true } = {}) {
  const [w, hh] = videoSize(FORMATS[format] ? format : '16:9', res);
  variant = variant ?? mood ?? st.variants[scene];
  H.stop?.(); H.stopPreview?.();                                 // the export never plays audio
  onProgress('audio', 0);
  const audio = await sourceAudio(source, { seconds, onProgress: f => onProgress('audio', f) });
  onProgress('audio', 1);
  const name = title ?? sourceTitle(source);
  const features = source.kind === 'file' && fps === 30 ? imported?.F : undefined;
  const r = await makeVideo({ audio, features, width: w, height: hh, fps, seconds, scene, variant, quality, showText, intensity, title: name, artist, meta: meta || metas.get(scene) || null, onProgress, signal });
  onProgress('save', 0);
  const saved = save ? await saveVideo(`${name} - ${format.replace(':', 'x')} ${res === '2160' ? '4K' : res + 'p'}`, r) : { status: 'skipped' };
  return { ...r, bytes: r.blob.size, saveStatus: saved.status, saveCode: saved.code, seconds: r.frames / r.fps };
}

// ------------------------------------------------------------------------------------------------ the window
export async function openVisual(source = { kind: 'project' }) {
  if (ui) closeVisual();
  const lastFocus = document.activeElement;
  if (source.kind === 'file' && !imported) source = { kind: 'project' };
  const ids = listScenes().map(s => s.id);
  if (!ids.includes(st.scene)) st.scene = DEFAULT_SCENE;

  // ---- cinema (dark glass): hero preview, variants, the worlds rail
  const heroGroup = h('span', { class: 'vz-eyebrow', id: 'vz-hero-group' }), heroName = h('h3', { class: 'vz-hero-name', id: 'vz-hero-name' }), heroDesc = h('p', { class: 'vz-hero-desc', id: 'vz-hero-desc' });
  const badge = h('span', { class: 'vz-badge mono', id: 'vz-badge' });
  const canvasBox = h('div', { class: 'vz-canvas', id: 'vz-canvas' });
  const wait = h('span', { class: 'vz-wait', id: 'vz-wait', text: 'Opening the world…' });
  const renderView = h('div', { class: 'vz-render', id: 'vz-render', hidden: true });
  const stage = h('div', { class: 'vz-stage', id: 'vz-stage' }, canvasBox, wait, renderView);
  const chips = h('div', { class: 'vz-chips', id: 'vz-variants', role: 'radiogroup', 'aria-label': 'Variant' });
  const filters = h('div', { class: 'vz-filters', role: 'tablist', 'aria-label': 'Scene groups' });
  const rail = h('div', { class: 'vz-rail', id: 'vz-rail', role: 'radiogroup', 'aria-label': 'Worlds' });
  const listenBtn = h('button', { class: 'vz-listen', id: 'vz-listen', 'aria-pressed': 'false' }, icon('play'), h('span', { id: 'vz-listen-l', text: 'Listen' }));
  const cinema = h('section', { class: 'vz-cinema' },
    h('div', { class: 'vz-hero-head' }, h('div', { class: 'vz-hero-text' }, heroGroup, heroName, heroDesc), h('div', { class: 'vz-hero-side' }, h('span', { class: 'vz-live' }, h('i'), 'Live'), badge)),
    stage,
    h('div', { class: 'vz-under' }, listenBtn, chips),
    h('div', { class: 'vz-worlds' }, h('div', { class: 'vz-worlds-head' }, h('span', { class: 'vz-eyebrow', text: 'Worlds' }), filters), rail));

  // ---- controls (light chassis)
  const srcSeg = ['project', 'song', 'file'].map(k => h('button', { class: 'key vz-seg', id: `vz-src-${k}`, 'aria-pressed': 'false', onclick: () => setSourceKind(k) },
    { project: 'This tape', song: "Nico's songs", file: 'Import' }[k]));
  const songList = h('div', { class: 'vz-songs', id: 'vz-songs', role: 'radiogroup', 'aria-label': "Nico's songs" },
    ...SONGS.map(s => h('button', { class: 'key vz-song', id: `vz-song-${s.id}`, 'aria-pressed': 'false', onclick: () => setSource({ kind: 'song', id: s.id }) },
      h('span', { class: 'nm', text: s.title }), h('span', { class: 'mono', text: fmtTime(s.duration) }))));
  const fileIn = h('input', { type: 'file', id: 'vz-file', accept: 'audio/*,.mp3,.wav,.m4a,.ogg,.oga,.flac,.aac', hidden: true });
  const drop = h('label', { class: 'vz-drop', id: 'vz-drop', for: 'vz-file', tabindex: '0' }, icon('plus'),
    h('span', {}, h('strong', { id: 'vz-drop-t', text: 'Import an audio file' }), h('small', { id: 'vz-drop-s', text: 'mp3, wav, m4a or ogg. Drop it here or click. It stays on this computer.' })), fileIn);
  const srcName = h('strong', { class: 'vz-src-name', id: 'vz-src-name' }), srcNote = h('span', { class: 'pm-note', id: 'vz-src-note' });
  const fmtKeys = Object.values(FORMATS).map(f => h('button', { class: 'key vz-fmt', id: `vz-fmt-${f.id.replace(':', 'x')}`, 'aria-pressed': 'false', onclick: () => setFormat(f.id) },
    h('i', { class: 'vz-shape', style: { '--ar': f.w / f.h } }), h('span', {}, h('strong', { text: f.id }), h('small', { text: f.use }))));
  const resKeys = RESOLUTIONS.map(r => h('button', { class: 'key vz-res', id: `vz-res-${r.id}`, 'aria-pressed': 'false', onclick: () => setRes(r.id) }, h('strong', { text: r.name }), h('em', { class: 'mono' })));
  const qKeys = QUALITY.map(q => h('button', { class: 'key vz-q', id: `vz-q-${q.id}`, 'aria-pressed': 'false', title: q.note, onclick: () => setQuality(q.id) }, q.name));
  const qNote = h('span', { class: 'pm-note', id: 'vz-q-note' });
  const textKey = h('button', { class: 'key vz-textkey', id: 'vz-showtext', 'aria-pressed': String(st.showText) }, h('span', { class: 'led' }), 'Show title');
  const titleIn = h('input', { class: 'vz-in', id: 'vz-title', type: 'text', maxlength: '60', value: sourceTitle(source), 'aria-label': 'Title on the video', placeholder: 'No title' });
  const artistIn = h('input', { class: 'vz-in', id: 'vz-artist', type: 'text', maxlength: '40', value: st.artist, 'aria-label': 'Artist on the video', placeholder: 'No artist' });
  const inten = h('input', { class: 'vz-range', id: 'vz-intensity', type: 'range', min: '0', max: '100', value: String(Math.round(st.intensity * 100)), 'aria-label': 'Intensity' });
  const intenRow = h('label', { class: 'vz-field', id: 'vz-int-row' }, h('span', { class: 'label' }, 'Intensity ', h('b', { class: 'mono', id: 'vz-int-v', text: `${Math.round(st.intensity * 100)}` })), inten);
  const codecTile = h('strong', { id: 'vz-codec', text: 'Checking…' }), lenTile = h('strong', { id: 'vz-len', class: 'mono' }), sizeTile = h('strong', { id: 'vz-size', class: 'mono' });
  const status = h('p', { class: 'vz-status', id: 'vz-status', role: 'status', 'aria-live': 'polite' });
  const controls = h('section', { class: 'vz-controls' },
    h('div', { class: 'vz-group' }, h('span', { class: 'label', text: 'Sound' }), h('div', { class: 'vz-segs' }, ...srcSeg), songList, drop, h('div', { class: 'vz-src' }, srcName, srcNote)),
    h('div', { class: 'vz-group' }, h('span', { class: 'label', text: 'Format' }), h('div', { class: 'vz-fmts' }, ...fmtKeys)),
    h('div', { class: 'vz-group' }, h('span', { class: 'label', text: 'Resolution' }), h('div', { class: 'vz-ress' }, ...resKeys)),
    h('div', { class: 'vz-group' }, h('span', { class: 'label', text: 'Quality' }), h('div', { class: 'vz-segs' }, ...qKeys), qNote),
    h('div', { class: 'vz-group' }, h('div', { class: 'vz-textrow' }, h('span', { class: 'label', text: 'Title' }), textKey), h('div', { class: 'vz-two', id: 'vz-textfields' }, titleIn, artistIn)),
    intenRow,
    h('div', { class: 'specs vz-specs' }, h('div', { class: 'spec' }, h('span', { class: 'label', text: 'Video' }), codecTile),
      h('div', { class: 'spec' }, h('span', { class: 'label', text: 'Length' }), lenTile), h('div', { class: 'spec' }, h('span', { class: 'label', text: 'File' }), sizeTile)),
    h('p', { class: 'pm-note', id: 'vz-note' }));

  const goBtn = h('button', { class: 'key signal vz-go', id: 'vz-go' }, icon('export'), 'Make video');
  const closeBtn = h('button', { class: 'key', id: 'vz-close-2', text: 'Close' });
  const audioBtn = h('button', { class: 'key', id: 'vz-audio', title: 'WAV + MP3 in a zip, as before' }, 'Audio only');
  const dlg = h('div', { class: 'dialog vz-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vz-h' },
    h('header', {}, h('div', {}, h('h2', { id: 'vz-h', text: 'Music video' }), h('span', { class: 'label', text: 'Cinematic worlds for any song · exported frame by frame' })),
      h('button', { class: 'key sm sq', id: 'vz-close', 'aria-label': 'Close' }, icon('close'))),
    h('div', { class: 'vz-body' }, cinema, controls),
    h('footer', {}, audioBtn, status, h('span', { class: 'grow' }), closeBtn, goBtn));
  const scrim = h('div', { class: 'scrim vz-scrim', id: 'visual-scrim' }, dlg);
  document.body.append(scrim);
  ui = { scrim, dlg, source, scene: null, raf: 0, live: null, exporting: null, lastFocus, ro: null, io: null, t0: performance.now(), audioEl: null, cards: new Map(), snapQueue: [], snapping: false };

  const close = () => { if (ui?.exporting) { ui.exporting.abort(); return; } closeVisual(); };
  dlg.querySelector('#vz-close').onclick = close; closeBtn.onclick = close;
  scrim.addEventListener('pointerdown', e => { if (e.target === scrim && !ui?.exporting) closeVisual(); });
  scrim.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }, true);
  audioBtn.onclick = () => { closeVisual(); H.openAudioExport?.(); };
  titleIn.oninput = () => ui?.scene?.setText({ title: titleIn.value });
  artistIn.oninput = () => { st.artist = artistIn.value; remember(); ui?.scene?.setText({ artist: artistIn.value }); };
  textKey.onclick = () => { st.showText = !st.showText; remember(); textKey.setAttribute('aria-pressed', String(st.showText)); dlg.querySelector('#vz-textfields').classList.toggle('off', !st.showText); ui?.scene?.setText({ showText: st.showText }); };
  dlg.querySelector('#vz-textfields').classList.toggle('off', !st.showText);
  inten.oninput = () => { st.intensity = inten.value / 100; dlg.querySelector('#vz-int-v').textContent = inten.value; ui?.scene?.setIntensity(st.intensity); remember(); };
  listenBtn.onclick = () => toggleListen();
  goBtn.onclick = () => runExport();
  fileIn.onchange = () => { const f = fileIn.files?.[0]; fileIn.value = ''; if (f) importFile(f); };
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
  for (const ev of ['dragenter', 'dragover']) dlg.addEventListener(ev, e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
  dlg.addEventListener('dragleave', e => { if (e.target === drop || !dlg.contains(e.relatedTarget)) drop.classList.remove('over'); });
  dlg.addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (!f) return; e.preventDefault(); drop.classList.remove('over'); if (!ui?.exporting) importFile(f); });

  Object.assign(ui, { showScene, pumpThumbs });
  buildFilters(); buildRail();
  setFormat(st.format, true); setRes(st.res, true); setQuality(st.quality, true); showSource();
  goBtn.focus();
  encodeSupport({ fps: 30 }).then(s => { support = s; if (ui) { updateRes(); updateCodec(); } }).catch(() => { });
  await startPreview();

  // -------------------------------------------------------------------------------------------- sound
  function setSourceKind(k) {
    if (ui.exporting) return;
    if (k === 'project') setSource({ kind: 'project' });
    else if (k === 'song') setSource({ kind: 'song', id: ui.source.kind === 'song' ? ui.source.id : SONGS[0].id });
    else if (imported) setSource({ kind: 'file' });
    else { ui.pendingKind = 'file'; showSource(); }
  }
  function setSource(src) {
    if (ui.exporting) return;
    const wasTitle = sourceTitle(ui.source);
    setListen(false); ui.pendingKind = null; ui.source = src;
    if (!titleIn.value || titleIn.value === wasTitle) { titleIn.value = sourceTitle(src); ui.scene?.setText({ title: titleIn.value }); }
    showSource();
  }
  function showSource() {
    const k = ui.pendingKind || ui.source.kind;
    srcSeg.forEach(b => b.setAttribute('aria-pressed', String(b.id === `vz-src-${k}`)));
    songList.hidden = k !== 'song'; drop.hidden = k !== 'file';
    dlg.querySelectorAll('.vz-song').forEach(b => b.setAttribute('aria-pressed', String(ui.source.kind === 'song' && b.id === `vz-song-${ui.source.id}`)));
    const s = ui.source;
    if (k === 'file' && !imported) { srcName.textContent = ''; srcNote.textContent = ''; }
    else {
      srcName.textContent = sourceTitle(s);
      srcNote.textContent = s.kind === 'song' ? 'Your song goes in exactly as it is.' : s.kind === 'file' ? `Imported · ${fmtTime(imported.duration)} · kept in memory, never uploaded.` : 'The full mix with its reverb tail, rendered offline.';
    }
    if (imported) { dlg.querySelector('#vz-drop-t').textContent = imported.name; dlg.querySelector('#vz-drop-s').textContent = `${fmtTime(imported.duration)} · drop or click to use another file`; }
    dlg.querySelector('#vz-listen-l').textContent = s.kind === 'project' ? 'Play the tape' : 'Listen';
    listenBtn.disabled = k === 'file' && !imported;
    updateSpecs();
  }
  async function importFile(file) {
    const note = dlg.querySelector('#vz-drop-s'), title = dlg.querySelector('#vz-drop-t');
    ui.pendingKind = 'file'; showSource(); setListen(false);
    title.textContent = file.name; note.textContent = 'Reading the sound…'; drop.classList.add('busy');
    try {
      const buf = await decodeAudio(await file.arrayBuffer());
      if (!ui) return;
      note.textContent = 'Listening for the beats…';
      const { computeFeatures } = await import('./features.js?v=10a');
      const F = await computeFeatures(buf, { fps: 30 });
      if (!ui) return;
      if (imported?.url) URL.revokeObjectURL(imported.url);
      imported = { name: file.name.replace(/\.[^.]+$/, '') || 'Imported sound', buffer: buf, F, url: URL.createObjectURL(file), duration: buf.duration };
      setSource({ kind: 'file' });
    } catch (e) {
      console.warn('[visual] import', e);
      if (ui) { title.textContent = 'That file could not be read'; note.textContent = 'Try an mp3, wav, m4a or ogg file.'; }
    } finally { drop.classList.remove('busy'); }
  }

  // -------------------------------------------------------------------------------------------- format / output
  function setFormat(id, quiet) {
    st.format = FORMATS[id] ? id : '16:9'; if (!quiet) remember();
    fmtKeys.forEach(k => k.setAttribute('aria-pressed', String(k.id === `vz-fmt-${st.format.replace(':', 'x')}`)));
    updateRes(); fitPreview(); updateCodec();
  }
  function setRes(id, quiet) {
    if (support && !support[id]) id = DEFAULT_RES;
    st.res = RESOLUTIONS.some(r => r.id === id) ? id : DEFAULT_RES; if (!quiet) remember();
    updateRes(); updateCodec();
  }
  function updateRes() {
    resKeys.forEach((k, i) => {
      const r = RESOLUTIONS[i], [w, hh] = videoSize(st.format, r.id), ok = !support || !!support[r.id];
      k.setAttribute('aria-pressed', String(r.id === st.res)); k.querySelector('em').textContent = `${w}×${hh}`;
      k.disabled = !ok; k.title = ok ? `${w}×${hh}${r.id === '2160' ? ' · long renders' : ''}` : `This browser cannot encode ${r.name} video`;
    });
  }
  function setQuality(id, quiet) {
    st.quality = QUALITY.some(q => q.id === id) ? id : 'high'; if (!quiet) remember();
    qKeys.forEach(k => k.setAttribute('aria-pressed', String(k.id === `vz-q-${st.quality}`)));
    qNote.textContent = QUALITY.find(q => q.id === st.quality).note + '. The preview shows ' + (st.quality === 'light' ? 'Light.' : 'High.');
    if (!quiet && ui.scene) loadScene(st.scene);
  }
  function updateSpecs() {
    const secs = ui.pendingKind === 'file' && !imported ? 0 : sourceSeconds(ui.source), [w, hh] = videoSize(st.format, st.res);
    lenTile.textContent = secs ? `${fmtTime(secs)}${ui.source.kind === 'project' ? ' + tail' : ''}` : '-';
    const br = ui.codecs ? ui.codecs.video.bitrate + ui.codecs.audio.bitrate : videoBitrate(w, hh, 30);
    sizeTile.textContent = secs ? `~${Math.round(br * secs / 8 / 1048576)} MB` : '-';
  }
  async function updateCodec() {
    const [w, hh] = videoSize(st.format, st.res), my = (ui.codecSeq = (ui.codecSeq || 0) + 1);
    const c = await pickCodecs(w, hh);
    if (!ui || my !== ui.codecSeq) return;
    ui.codecs = c;
    codecTile.textContent = c ? c.label.replace(' + ', ' · ') : 'Real-time recording';
    codecTile.title = c?.note || (c ? '' : 'This browser has no WebCodecs: the video records in real time.');
    dlg.querySelector('#vz-note').textContent = c ? c.note || `${w}×${hh} · ${st.quality} quality · 30 fps · every frame rendered exactly.` : 'This browser has no WebCodecs, so the video records in real time (as long as the song).';
    updateSpecs();
  }

  // -------------------------------------------------------------------------------------------- worlds
  function buildFilters() {
    const present = new Set(listScenes().map(s => s.group));
    const names = ['All', ...GROUPS.filter(g => present.has(g))];
    filters.replaceChildren(...names.map(g => h('button', { class: 'vz-filter', role: 'tab', 'aria-selected': String(st.filter === g), 'data-g': g, onclick: () => { st.filter = g; remember(); buildFilters(); applyFilter(); } }, g)));
  }
  function applyFilter() {
    for (const [id, card] of ui.cards) { const m = listScenes().find(s => s.id === id); card.hidden = card.dataset.broken === '1' || (st.filter !== 'All' && m?.group !== st.filter); }
    const shown = [...ui.cards.values()].filter(c => !c.hidden).length;
    rail.dataset.empty = shown ? '' : '1';
  }
  function buildRail() {
    const order = s => GROUPS.indexOf(s.group) * 100 + (s.id === DEFAULT_SCENE ? -1 : 0);
    const list = listScenes().sort((a, b) => order(a) - order(b));
    ui.io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { queueThumb(e.target.dataset.id); ui.io.unobserve(e.target); } }, { root: rail, rootMargin: '0px 200px' });
    for (const s of list) {
      const cv = h('canvas', { class: 'vz-thumb', width: '352', height: '198', 'aria-hidden': 'true' });
      const card = h('button', { class: 'vz-card', id: `vz-scene-${s.id}`, role: 'radio', 'aria-checked': String(s.id === st.scene), 'data-id': s.id, title: s.desc, style: { '--sw': grad(s.swatch) },
        onclick: () => chooseScene(s.id) }, h('span', { class: 'vz-thumbwrap' }, cv, h('span', { class: 'vz-shimmer' })),
        h('span', { class: 'vz-card-meta' }, h('span', { class: 'vz-eyebrow', text: s.group }), h('span', { class: 'vz-card-name', text: s.name })));
      ui.cards.set(s.id, card); rail.append(card); ui.io.observe(card);
    }
    rail.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const vis = [...ui.cards.values()].filter(c => !c.hidden), i = vis.indexOf(document.activeElement); if (i < 0) return;
      e.preventDefault(); vis[(i + (e.key === 'ArrowRight' ? 1 : vis.length - 1)) % vis.length].focus();
    });
    applyFilter();
  }
  function markCard(id) { for (const [k, c] of ui.cards) c.setAttribute('aria-checked', String(k === id)); }
  async function chooseScene(id) {
    if (ui.exporting || !metas.get(id) && metas.has(id)) return;
    st.scene = id; remember(); markCard(id);
    await loadScene(id);
  }
  async function loadScene(id) {
    if (!ui.scene) return;
    const my = (ui.loadSeq = (ui.loadSeq || 0) + 1);
    stage.classList.add('loading');
    const meta = await ui.scene.setScene({ scene: id, variant: st.variants[id] || null, quality: st.quality === 'light' ? 'light' : 'high' });
    if (!ui || my !== ui.loadSeq) return;
    stage.classList.remove('loading');
    if (!meta) { markBroken(id); if (id !== DEFAULT_SCENE) { st.scene = DEFAULT_SCENE; markCard(DEFAULT_SCENE); return loadScene(DEFAULT_SCENE); } return; }
    metas.set(id, meta);
    showScene();
  }
  function markBroken(id) { metas.set(id, null); const c = ui.cards.get(id); if (c) { c.dataset.broken = '1'; c.hidden = true; } applyFilter(); }
  function showScene() {
    const meta = metas.get(st.scene) || ui.scene?.meta; if (!meta) return;
    const variant = ui.scene.variant || meta.defaultVariant, v = meta.variants.find(x => x.id === variant);
    heroGroup.textContent = `${meta.group} · ${v?.name || ''}`; heroName.textContent = meta.name; heroDesc.textContent = meta.desc || '';
    chips.replaceChildren(...meta.variants.map(x => h('button', { class: 'vz-chip', role: 'radio', id: `vz-var-${x.id}`, 'aria-checked': String(x.id === variant), title: x.desc || x.name,
      style: { '--dot': x.swatch?.[1] || x.text?.accent || meta.text?.accent || '#ffd7a0' }, onclick: () => setVariant(x.id) }, h('i'), x.name)));
    intenRow.hidden = !meta.intensity;
    ui.scene.canvas.setAttribute('aria-label', `Preview: ${meta.name}, ${v?.name || ''}`);
  }
  function setVariant(id) {
    if (ui.exporting) return;
    st.variants[st.scene] = id; remember();
    ui.scene?.setVariant(id); showScene();
    chips.querySelectorAll('.vz-chip').forEach(c => c.setAttribute('aria-checked', String(c.id === `vz-var-${id}`)));
  }

  // thumbnails: one at a time, when a card scrolls into view, never while exporting
  function queueThumb(id) { if (!ui.snapQueue.includes(id)) ui.snapQueue.push(id); pumpThumbs(); }
  async function pumpThumbs() {
    if (!ui || ui.snapping || ui.exporting || !ui.scene) return;
    const id = ui.snapQueue.shift(); if (!id) return;
    ui.snapping = true;
    try {
      if (metas.get(id) === null) return;
      const meta = metas.get(id) || (await ui.scene.metas([id]))[0]?.meta || null;
      if (!ui) return;
      if (!meta) { markBroken(id); return; }
      metas.set(id, meta);
      const variant = st.variants[id] || meta.defaultVariant, key = `${id}:${variant}`;
      let bm = thumbs.get(key);
      if (!bm) { bm = await ui.scene.snap({ scene: id, variant, quality: 'light', size: [352, 198] }); if (bm) thumbs.set(key, bm); }
      if (!ui || !bm) return;
      const card = ui.cards.get(id), cv = card?.querySelector('canvas');
      if (cv) { cv.getContext('2d').drawImage(bm, 0, 0, cv.width, cv.height); card.classList.add('ready'); }
    } catch (e) { console.warn('[visual] thumbnail', id, e?.message || e); }
    finally {
      if (ui) { ui.snapping = false; const next = () => pumpThumbs(); (window.requestIdleCallback || setTimeout)(next, { timeout: 400 }); }
    }
  }

  // -------------------------------------------------------------------------------------------- export
  async function runExport() {
    if (ui.exporting) return;
    if ((ui.pendingKind || ui.source.kind) === 'file' && !imported) { status.textContent = 'Import an audio file first.'; status.classList.add('err'); return; }
    const ac = new AbortController(); ui.exporting = ac;
    setListen(false); stopLoop();
    goBtn.disabled = true; closeBtn.textContent = 'Cancel'; status.classList.remove('err'); status.textContent = '';
    dlg.classList.add('exporting');
    controls.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
    cinema.querySelectorAll('.vz-under button, .vz-rail button, .vz-filters button').forEach(el => { el.disabled = true; });
    const [w, hh] = videoSize(st.format, st.res), meta = metas.get(st.scene) || ui.scene?.meta;
    const secs = sourceSeconds(ui.source) || 0;
    const still = h('canvas', { class: 'vz-still', id: 'vz-still', width: String(Math.round(480 * Math.min(1, w / hh))), height: String(Math.round(480 * Math.min(1, hh / w))) });
    const bar = h('i'), stageL = h('span', { class: 'vz-r-stage', id: 'vz-r-stage', text: 'Preparing' }), frameL = h('span', { class: 'mono', id: 'vz-r-frame' }), leftL = h('strong', { class: 'vz-r-left', id: 'vz-r-left' });
    const tcL = h('span', { class: 'mono', id: 'vz-r-tc' }), fpsL = h('span', { class: 'mono', id: 'vz-r-fps' }), elL = h('span', { class: 'mono', id: 'vz-r-el' });
    renderView.replaceChildren(h('div', { class: 'vz-r-frame' }, still, h('span', { class: 'vz-r-wait', text: 'The first frames are on their way…' })),
      h('div', { class: 'vz-r-hud' },
        h('div', { class: 'vz-r-top' }, h('span', { class: 'vz-r-rec' }, h('i'), stageL), leftL),
        h('div', { class: 'vz-r-bar' }, bar),
        h('div', { class: 'vz-r-row' }, frameL, tcL, fpsL, elL),
        h('div', { class: 'vz-r-row dim' }, h('span', { text: `${meta?.name || st.scene} · ${meta?.variants?.find(v => v.id === (ui.scene?.variant || st.variants[st.scene] || meta?.defaultVariant))?.name || ''}` }), h('span', { class: 'mono', text: `${w}×${hh} · ${st.quality}` }))));
    renderView.hidden = false; canvasBox.hidden = true; dlg.classList.add('rendered');
    const isSong = ui.source.kind !== 'project', W = isSong ? { audio: [0, 1], listen: [1, 4], frames: [4, 99] } : { audio: [0, 20], listen: [20, 24], frames: [24, 99] };
    const setBar = (stage, f) => { const [a, b] = W[stage] || [99, 100]; bar.style.width = (a + (b - a) * Math.min(1, f)) + '%'; };
    const t0 = performance.now();
    const clock = setInterval(() => { elL.textContent = `${fmtTime((performance.now() - t0) / 1000)} elapsed`; }, 1000);
    try {
      const r = await exportVideoFor({ source: ui.source, seconds: window.__videoTestSeconds || undefined, title: titleIn.value, artist: artistIn.value, showText: st.showText, signal: ac.signal, meta,
        onProgress: (stage, f, info) => {
          setBar(stage, f);
          if (stage === 'audio') stageL.textContent = ui.source.kind === 'project' ? `Rendering the mix ${Math.round(f * 100)}%` : 'Reading the sound';
          else if (stage === 'listen') stageL.textContent = 'Listening for the beats';
          else if (stage === 'ready') stageL.textContent = 'Building the world';
          else if (stage === 'frames' && info) {
            stageL.textContent = 'Rendering';
            frameL.textContent = `Frame ${info.frame.toLocaleString()} / ${info.frames.toLocaleString()}`;
            tcL.textContent = `${fmtTime(info.frame / 30)} / ${fmtTime(info.frames / 30)}`;
            fpsL.textContent = `${info.fps.toFixed(1)} fps`;
            leftL.textContent = info.settled ? fmtLeft(info.eta) : 'Measuring speed…';
            if (info.still && info.frame > info.frames - 60 && renderView.classList.contains('has-still')) info.still.close?.();   // keep a frame from before the fade-out
            else if (info.still) { const g = still.getContext('2d'); g.drawImage(info.still, 0, 0, still.width, still.height); info.still.close?.(); renderView.classList.add('has-still'); }
          } else if (stage === 'finish') { stageL.textContent = 'Finishing the file'; leftL.textContent = 'Almost there'; }
          else if (stage === 'save') stageL.textContent = 'Saving';
        } });
      bar.style.width = '100%';
      const msg = { saved: 'Saved to your downloads', fallback: 'Downloaded', declined: 'Saving was declined', unavailable: 'Downloads are not available in this view', error: `Could not save (${r.saveCode || 'error'})` }[r.saveStatus] || 'Done';
      stageL.textContent = msg; leftL.textContent = kbmb(r.bytes);
      renderView.classList.add('done');
      status.textContent = `${r.width}×${r.height} · ${r.frames.toLocaleString()} frames · ${r.codec} · ${fmtTime((performance.now() - t0) / 1000)}`;
    } catch (e) {
      if (e?.name !== 'AbortError') console.warn('[visual] export', e);
      status.textContent = e?.name === 'AbortError' ? 'Cancelled. Nothing was saved.' : 'The video stopped: ' + (e?.message || e);
      status.classList.toggle('err', e?.name !== 'AbortError');
      renderView.hidden = true; canvasBox.hidden = false; dlg.classList.remove('rendered');
    } finally {
      clearInterval(clock);
      if (!ui) return;
      ui.exporting = null; goBtn.disabled = false; closeBtn.textContent = 'Close'; dlg.classList.remove('exporting');
      controls.querySelectorAll('button, input').forEach(el => { el.disabled = false; });
      cinema.querySelectorAll('.vz-under button, .vz-rail button, .vz-filters button').forEach(el => { el.disabled = false; });
      updateRes(); showSource();
      if (!renderView.hidden) {
        const back = h('button', { class: 'key dark vz-r-back', id: 'vz-r-back', onclick: () => { renderView.hidden = true; renderView.classList.remove('done', 'has-still'); dlg.classList.remove('rendered'); canvasBox.hidden = false; startLoop(); fitPreview(); } }, 'Back to the preview');
        renderView.querySelector('.vz-r-hud').append(back); back.focus();
      } else startLoop();
      pumpThumbs();
    }
  }
}

// ------------------------------------------------------------------------------------------------ listening
function toggleListen() { setListen(!listening()); }
function listening() {
  if (!ui) return false;
  const k = ui.source.kind;
  return k === 'song' ? H.previewId?.() === ui.source.id : k === 'file' ? !!(ui.audioEl && !ui.audioEl.paused) : !!H.S.playing;
}
function setListen(on) {
  if (!ui) return;
  const src = ui.source;
  if (src.kind !== 'file' && ui.audioEl) { ui.audioEl.pause(); }
  if (src.kind === 'song') { if (on !== listening()) H.togglePreview(src.id); }
  else if (src.kind === 'file') {
    if (on) {
      if (!imported) return;
      if (H.S.playing) H.stop(); H.stopPreview?.();
      if (!ui.audioEl || ui.audioEl.src !== imported.url) { ui.audioEl?.pause(); ui.audioEl = new Audio(imported.url); ui.audioEl.preload = 'auto'; }
      ui.audioEl.play().catch(e => console.warn('[visual] listen', e));
    } else ui.audioEl?.pause();
  }
  else if (on && !H.S.playing) H.play(); else if (!on && H.S.playing) H.stop();
}

// ------------------------------------------------------------------------------------------------ preview
async function startPreview() {
  const box = document.getElementById('vz-canvas');
  try {
    const pr = Math.min(1.5, window.devicePixelRatio || 1);
    const scene = await createPreview({ width: 480, height: 270, pixelRatio: pr, scene: st.scene, variant: st.variants[st.scene] || null, quality: st.quality === 'light' ? 'light' : 'high',
      intensity: st.intensity, title: document.getElementById('vz-title').value, artist: st.artist, showText: st.showText, antialias: pr < 1.25 })
      .catch(async e => { console.warn('[visual] scene', st.scene, e?.message || e); st.scene = DEFAULT_SCENE; return createPreview({ width: 480, height: 270, pixelRatio: pr, scene: DEFAULT_SCENE, intensity: st.intensity, title: document.getElementById('vz-title').value, artist: st.artist, showText: st.showText }); });
    if (!ui) { scene.dispose(); return; }
    ui.scene = scene; ui.pacer = previewPacer({ fps: 30, onScale: () => fitPreview() });
    if (scene.meta) metas.set(st.scene, scene.meta);
    scene.canvas.setAttribute('role', 'img');
    box.append(scene.canvas); document.getElementById('vz-wait')?.remove();
    ui.ro = new ResizeObserver(() => fitPreview()); ui.ro.observe(document.getElementById('vz-stage'));
    document.querySelectorAll('.vz-card').forEach(c => c.setAttribute('aria-checked', String(c.dataset.id === st.scene)));
    fitPreview(); startLoop();
    ui.showScene(); ui.pumpThumbs();
    // which worlds exist: probe the modules in the worker, quietly, after the hero is up
    const ids = [...ui.cards.keys()].filter(id => !metas.has(id));
    const list = await scene.metas(ids).catch(() => []);
    if (!ui) return;
    for (const x of list) { if (x.ok) metas.set(x.id, x.meta); else { metas.set(x.id, null); const c = ui.cards.get(x.id); if (c) { c.dataset.broken = '1'; c.hidden = true; } } }
    for (const [id, c] of ui.cards) if (metas.get(id) && !c.dataset.broken) { const m = metas.get(id); c.querySelector('.vz-card-name').textContent = m.name; c.querySelector('.vz-eyebrow').textContent = m.group; }
    ui.dlg.querySelectorAll('.vz-filter').forEach(f => { const g = f.dataset.g; f.hidden = g !== 'All' && ![...ui.cards.entries()].some(([id, c]) => !c.dataset.broken && metas.get(id)?.group === g); });
    const shown = [...ui.cards.values()].filter(c => !c.dataset.broken && !c.hidden).length;
    ui.dlg.querySelector('#vz-rail').dataset.empty = shown ? '' : '1';
  } catch (e) {
    console.warn('[visual] preview', e);
    const w = document.getElementById('vz-wait'); if (w) w.textContent = 'The 3D preview could not start here (WebGL). The export may still work.';
  }
}
function fitPreview() {
  if (!ui?.scene) return;
  const stage = document.getElementById('vz-stage'), [fw, fh] = videoSize(st.format, '1080'), ar = fw / fh;
  const bw = stage.clientWidth - 24, bh = stage.clientHeight - 24; if (bw <= 0 || bh <= 0) return;
  let w = bw, hh = w / ar; if (hh > bh) { hh = bh; w = hh * ar; }
  w = Math.floor(w); hh = Math.floor(hh);
  const c = ui.scene.canvas; c.style.width = w + 'px'; c.style.height = hh + 'px';
  const badge = document.getElementById('vz-badge'); if (badge) { const [ow, oh] = videoSize(st.format, st.res); badge.textContent = `${st.format} · ${ow}×${oh}`; }
  // the preview renders at most ~720 px wide (it is a preview; the export renders full size)
  const k = Math.min(1, 720 / Math.max(w, hh)) * (ui.pacer?.scale || 1);
  ui.scene.setSize(Math.max(64, Math.round(w * k)), Math.max(64, Math.round(hh * k)), Math.min(1.5, window.devicePixelRatio || 1));
}
function startLoop() { if (ui && !ui.raf && !document.hidden && !ui.exporting) { ui.pacer?.reset(); ui.raf = requestAnimationFrame(frame); } }
function stopLoop() { if (ui?.raf) { cancelAnimationFrame(ui.raf); ui.raf = 0; } }
let featMod = null;
import('./features.js?v=10a').then(m => { featMod = m; });
function frame(now) {
  if (!ui) return;
  ui.raf = 0;
  if (document.hidden || ui.exporting) return;          // resumes on visibilitychange / after the export
  if (ui.scene?.busy) { ui.raf = requestAnimationFrame(frame); return; }   // the preview worker is still drawing the last frame
  const dt = ui.pacer ? ui.pacer.tick(now) : 1 / 30;
  if (!dt) { ui.raf = requestAnimationFrame(frame); return; }
  let t = (now - ui.t0) / 1000;
  const on = listening();
  const btn = document.getElementById('vz-listen'); if (btn && btn.getAttribute('aria-pressed') !== String(!!on)) btn.setAttribute('aria-pressed', String(!!on));
  let f;
  if (on && ui.source.kind === 'file' && imported?.F && featMod) { t = ui.audioEl.currentTime; f = featMod.frameAt(imported.F, Math.round(t * 30)); }   // exactly what the video will show at t
  else if (on && H.S.engine?.analyser && featMod) { ui.live = ui.live || featMod.createLiveFeatures(H.S.engine.analyser); f = ui.live.update(dt); }
  else f = featMod ? featMod.idleFeatures(t) : { pulse: 0.2, low: 0.2, mid: 0.3, high: 0.2, level: 0.3, slow: 0.3, accent: 0, accentLag: 0 };
  ui.scene?.render(t, f);
  ui.raf = requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) startLoop(); });

export function closeVisual() {
  if (!ui) return;
  ui.exporting?.abort();
  stopLoop(); ui.ro?.disconnect(); ui.io?.disconnect();
  if (ui.source.kind === 'song' && H.previewId?.() === ui.source.id) H.stopPreview?.();
  ui.audioEl?.pause();
  ui.scene?.dispose(); ui.scrim.remove();
  const f = ui.lastFocus; ui = null; f?.focus?.();
}
