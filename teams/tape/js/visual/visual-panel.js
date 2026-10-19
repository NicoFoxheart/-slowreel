// visual-panel.js - the "Music video" window on the PC: live preview of Nico's fox heart, format, title / artist, mood,
// intensity, and the frame-exact video export with the audio inside. Three.js loads only when the window first opens;
// the preview renders only while it is open (30 fps cap, pixel ratio <= 1.5) and never touches the audio graph.
import { h, icon } from '../ui/controls.js?v=7';
import { SONGS, songUrl } from '../../lib/songs.js?v=7';
import { FORMATS, pickCodecs, makeVideo, renderProjectAudio, decodeAudio, saveVideo } from './video.js?v=7';
import { MOOD_LIST, fmtEta, kbmb, previewPacer } from './common.js?v=7';
import { createPreview } from './preview.js?v=7';

let H = null;            // hooks from app.js
let ui = null;           // open window state
const st = { format: '9:16', mood: 'sakura', intensity: 0.6, artist: 'Nicofoxheart' };
try { Object.assign(st, JSON.parse(localStorage.getItem('slowreel:visual') || '{}')); } catch { }
const remember = () => { try { localStorage.setItem('slowreel:visual', JSON.stringify({ format: st.format, mood: st.mood, intensity: st.intensity, artist: st.artist })); } catch { } };

/** hooks: {S, play, stop, togglePreview(id), stopPreview(), previewId(), openAudioExport(), toast} */
export function initVisual(hooks) { H = hooks; }
export const isVisualOpen = () => !!ui;

const sourceTitle = src => (src.kind === 'song' ? SONGS.find(s => s.id === src.id)?.title : H.S.project?.name) || 'Untitled';

/** Get the exact audio for a source: the rendered project mix, or Nico's song decoded unchanged. */
async function sourceAudio(src, { seconds, onProgress } = {}) {
  if (src.kind === 'song') { const r = await fetch(songUrl(src.id)); if (!r.ok) throw new Error('could not load the song'); return decodeAudio(await r.arrayBuffer()); }
  return renderProjectAudio(H.S.engine, H.S.project, { seconds, onProgress });
}

/** The whole export without the window (also used by window.__studio.exportVideo). */
export async function exportVideoFor({ source = { kind: 'project' }, format = st.format, seconds, mood = st.mood, intensity = st.intensity, title, artist = st.artist,
  onProgress = () => { }, signal, save = true } = {}) {
  const F = FORMATS[format] || FORMATS['9:16'];
  H.stop?.(); H.stopPreview?.();                                 // the export never plays audio
  onProgress('audio', 0);
  const audio = await sourceAudio(source, { seconds, onProgress: f => onProgress('audio', f) });
  onProgress('audio', 1);
  const name = title ?? sourceTitle(source);
  const r = await makeVideo({ audio, width: F.w, height: F.h, fps: 30, seconds, mood, intensity, title: name, artist, onProgress, signal });
  onProgress('save', 0);
  const saved = save ? await saveVideo(`${name} - ${F.id.replace(':', 'x')}`, r) : { status: 'skipped' };
  return { ...r, bytes: r.blob.size, saveStatus: saved.status, saveCode: saved.code, seconds: r.frames / 30 };
}

// ------------------------------------------------------------------------------------------------ the window
export async function openVisual(source = { kind: 'project' }) {
  if (ui) closeVisual();
  const lastFocus = document.activeElement;
  const title = sourceTitle(source);
  const scrim = h('div', { class: 'scrim vz-scrim', id: 'visual-scrim' });
  const canvasBox = h('div', { class: 'vz-canvas', id: 'vz-canvas' });
  const stage = h('div', { class: 'glass vz-stage', id: 'vz-stage' }, canvasBox, h('span', { class: 'vz-wait', id: 'vz-wait', text: 'Waking the heart…' }));
  const listenBtn = h('button', { class: 'key', id: 'vz-listen', 'aria-pressed': 'false' }, h('span', { class: 'led' }), icon('play'), source.kind === 'song' ? 'Listen' : 'Play the project');
  const fmtKeys = Object.values(FORMATS).map(f => h('button', { class: 'key vz-fmt', id: `vz-fmt-${f.id.replace(':', 'x')}`, 'aria-pressed': String(st.format === f.id), onclick: () => setFormat(f.id) },
    h('i', { class: 'vz-shape', style: { '--ar': f.w / f.h } }), h('span', {}, h('strong', { text: f.id }), h('small', { text: f.use })), h('em', { class: 'mono', text: `${f.w}×${f.h}` })));
  const moodKeys = MOOD_LIST.map(m => h('button', { class: 'key vz-mood', id: `vz-mood-${m.id}`, 'aria-pressed': String(st.mood === m.id), onclick: () => setMood(m.id) },
    h('i', { style: { background: `linear-gradient(135deg, ${m.sky}, ${m.heart})` } }), m.name));
  const titleIn = h('input', { class: 'vz-in', id: 'vz-title', type: 'text', maxlength: '60', value: title, 'aria-label': 'Title on the video', placeholder: 'No title' });
  const artistIn = h('input', { class: 'vz-in', id: 'vz-artist', type: 'text', maxlength: '40', value: st.artist, 'aria-label': 'Artist on the video', placeholder: 'No artist' });
  const inten = h('input', { class: 'vz-range', id: 'vz-intensity', type: 'range', min: '0', max: '100', value: String(Math.round(st.intensity * 100)), 'aria-label': 'Intensity' });
  const codecTile = h('strong', { id: 'vz-codec', text: 'Checking…' });
  const lenTile = h('strong', { id: 'vz-len', text: '' });
  const bar = h('i', { id: 'vz-bar' }), status = h('p', { class: 'vz-status', id: 'vz-status', role: 'status', 'aria-live': 'polite', text: '' });
  const goBtn = h('button', { class: 'key signal', id: 'vz-go' }, icon('export'), 'Make video');
  const closeBtn = h('button', { class: 'key', id: 'vz-close-2', text: 'Close' });
  const audioBtn = source.kind === 'project' ? h('button', { class: 'key', id: 'vz-audio', title: 'WAV + MP3 in a zip, as before' }, 'Audio only') : null;
  const dlg = h('div', { class: 'dialog vz-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vz-h' },
    h('header', {}, h('div', {}, h('h2', { id: 'vz-h', text: 'Music video' }), h('span', { class: 'label', text: `Fox heart · ${source.kind === 'song' ? "Nico's tape" : 'this project'}` })),
      h('button', { class: 'key sm sq', id: 'vz-close', 'aria-label': 'Close' }, icon('close'))),
    h('div', { class: 'vz-body' },
      h('div', { class: 'vz-left' }, stage, h('div', { class: 'vz-under' }, listenBtn, h('span', { class: 'pm-note', text: 'Preview at 30 fps. The video renders every frame exactly, at full size.' }))),
      h('div', { class: 'vz-right' },
        h('div', { class: 'vz-src' }, h('span', { class: 'label', text: 'Sound' }), h('strong', { text: title }),
          h('span', { class: 'pm-note', text: source.kind === 'song' ? 'Your song goes in exactly as it is.' : 'The full mix with its reverb tail, rendered offline.' })),
        h('div', { class: 'vz-group' }, h('span', { class: 'label', text: 'Format' }), h('div', { class: 'vz-fmts' }, ...fmtKeys)),
        h('div', { class: 'vz-two' }, h('label', { class: 'vz-field' }, h('span', { class: 'label', text: 'Title' }), titleIn), h('label', { class: 'vz-field' }, h('span', { class: 'label', text: 'Artist' }), artistIn)),
        h('div', { class: 'vz-group' }, h('span', { class: 'label', text: 'Mood' }), h('div', { class: 'vz-moods' }, ...moodKeys)),
        h('label', { class: 'vz-field' }, h('span', { class: 'label' }, 'Intensity ', h('b', { class: 'mono', id: 'vz-int-v', text: `${Math.round(st.intensity * 100)}` })), inten),
        h('div', { class: 'specs vz-specs' }, h('div', { class: 'spec' }, h('span', { class: 'label', text: 'Video' }), codecTile), h('div', { class: 'spec' }, h('span', { class: 'label', text: 'Length' }), lenTile)),
        h('div', { class: 'progress', 'aria-hidden': 'true' }, bar), status)),
    h('footer', {}, audioBtn, h('span', { class: 'grow' }), closeBtn, goBtn));
  scrim.append(dlg); document.body.append(scrim);
  ui = { scrim, source, scene: null, raf: 0, last: 0, live: null, exporting: null, lastFocus, ro: null, t0: performance.now() };

  const close = () => { if (ui?.exporting) { ui.exporting.abort(); return; } closeVisual(); };
  dlg.querySelector('#vz-close').onclick = close; closeBtn.onclick = close;
  scrim.addEventListener('pointerdown', e => { if (e.target === scrim && !ui?.exporting) closeVisual(); });
  scrim.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }, true);
  if (audioBtn) audioBtn.onclick = () => { closeVisual(); H.openAudioExport?.(); };
  titleIn.oninput = () => ui?.scene?.setText({ title: titleIn.value });
  artistIn.oninput = () => { st.artist = artistIn.value; remember(); ui?.scene?.setText({ artist: artistIn.value }); };
  inten.oninput = () => { st.intensity = inten.value / 100; dlg.querySelector('#vz-int-v').textContent = inten.value; ui?.scene?.setIntensity(st.intensity); remember(); };
  listenBtn.onclick = () => toggleListen();
  goBtn.onclick = () => runExport();
  const secs = source.kind === 'song' ? SONGS.find(s => s.id === source.id)?.duration : H.S.engine?.projectSeconds?.(H.S.project);
  lenTile.textContent = secs ? `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}${source.kind === 'project' ? ' + tail' : ''}` : '-';
  goBtn.focus();
  updateCodec();
  await startPreview();

  function setFormat(id) {
    st.format = id; remember();
    fmtKeys.forEach(k => k.setAttribute('aria-pressed', String(k.id === `vz-fmt-${id.replace(':', 'x')}`)));
    fitPreview(); updateCodec();
  }
  function setMood(id) { st.mood = id; remember(); moodKeys.forEach(k => k.setAttribute('aria-pressed', String(k.id === `vz-mood-${id}`))); ui?.scene?.setMood(id); }
  async function updateCodec() {
    const F = FORMATS[st.format], c = await pickCodecs(F.w, F.h);
    if (!ui) return;
    codecTile.textContent = c ? c.label : 'Real-time recording';
    codecTile.title = c?.note || (c ? '' : 'This browser has no WebCodecs: the video records in real time.');
    const note = dlg.querySelector('#vz-note') || h('p', { class: 'pm-note', id: 'vz-note' });
    note.textContent = c ? c.note : 'This browser has no WebCodecs, so the video records in real time (as long as the song).';
    if (!note.isConnected) status.before(note);
  }
  async function runExport() {
    if (ui.exporting) return;
    const ac = new AbortController(); ui.exporting = ac;
    setListen(false); stopLoop();
    goBtn.disabled = true; closeBtn.textContent = 'Cancel';
    dlg.querySelectorAll('.vz-right button, .vz-right input, #vz-listen').forEach(el => { el.disabled = true; });
    const isSong = source.kind === 'song', W = isSong ? { audio: [0, 3], listen: [3, 8], frames: [8, 98] } : { audio: [0, 25], listen: [25, 30], frames: [30, 98] };
    const setBar = (stage, f) => { const [a, b] = W[stage] || [98, 100]; bar.style.width = (a + (b - a) * Math.min(1, f)) + '%'; };
    const t0 = performance.now();
    try {
      const r = await exportVideoFor({ source, title: titleIn.value, artist: artistIn.value, signal: ac.signal,
        onProgress: (stage, f, info) => {
          setBar(stage, f);
          if (stage === 'audio') status.textContent = isSong ? 'Reading the song…' : `Rendering the mix… ${Math.round(f * 100)}%`;
          else if (stage === 'listen') status.textContent = 'Listening for the beats…';
          else if (stage === 'frames' && info) status.textContent = `Frame ${info.frame} / ${info.frames} · ${info.fps.toFixed(1)} fps · ${fmtEta(info.eta)}`;
          else if (stage === 'finish') status.textContent = 'Finishing the file…';
          else if (stage === 'save') status.textContent = 'Saving…';
        } });
      bar.style.width = '100%';
      const msg = { saved: 'Saved. Find it in your downloads.', fallback: 'Downloaded.', declined: 'Saving was declined. Nothing was saved.', unavailable: 'Downloads are not available in this view.', error: `Could not save (${r.saveCode || 'error'}).` }[r.saveStatus] || '';
      status.textContent = `${msg} ${r.width}×${r.height}, ${r.frames} frames, ${kbmb(r.bytes)}, ${((performance.now() - t0) / 1000).toFixed(0)} s.`;
      status.classList.remove('err');
    } catch (e) {
      if (e?.name !== 'AbortError') console.warn('[visual] export', e);
      status.textContent = e?.name === 'AbortError' ? 'Cancelled. Nothing was saved.' : 'The video stopped: ' + (e?.message || e);
      status.classList.toggle('err', e?.name !== 'AbortError'); bar.style.width = '0%';
    } finally {
      if (!ui) return;
      ui.exporting = null; goBtn.disabled = false; closeBtn.textContent = 'Close';
      dlg.querySelectorAll('.vz-right button, .vz-right input, #vz-listen').forEach(el => { el.disabled = false; });
      startLoop();
    }
  }
}

function toggleListen() { setListen(!listening()); }
function listening() { return ui && (ui.source.kind === 'song' ? H.previewId?.() === ui.source.id : !!H.S.playing); }
function setListen(on) {
  if (!ui) return;
  const src = ui.source;
  if (src.kind === 'song') { if (on !== listening()) H.togglePreview(src.id); }
  else if (on && !H.S.playing) H.play(); else if (!on && H.S.playing) H.stop();
}

async function startPreview() {
  const box = document.getElementById('vz-canvas');
  try {
    const pr = Math.min(1.5, window.devicePixelRatio || 1);
    const scene = await createPreview({ width: 320, height: 568, pixelRatio: pr, mood: st.mood, intensity: st.intensity, title: document.getElementById('vz-title').value, artist: st.artist, antialias: pr < 1.25 });
    if (!ui) { scene.dispose(); return; }
    ui.scene = scene; ui.pacer = previewPacer({ fps: 30, onScale: () => fitPreview() });
    ui.scene.canvas.setAttribute('role', 'img'); ui.scene.canvas.setAttribute('aria-label', 'Preview: the glowing fox heart');
    box.append(ui.scene.canvas); document.getElementById('vz-wait')?.remove();
    ui.ro = new ResizeObserver(() => fitPreview()); ui.ro.observe(document.getElementById('vz-stage'));
    fitPreview(); startLoop();
  } catch (e) {
    console.warn('[visual] preview', e);
    const w = document.getElementById('vz-wait'); if (w) w.textContent = 'The 3D preview could not start here (WebGL). The export may still work.';
  }
}
function fitPreview() {
  if (!ui?.scene) return;
  const stage = document.getElementById('vz-stage'), F = FORMATS[st.format], ar = F.w / F.h;
  const bw = stage.clientWidth - 16, bh = stage.clientHeight - 16; if (bw <= 0 || bh <= 0) return;
  let w = bw, hh = w / ar; if (hh > bh) { hh = bh; w = hh * ar; }
  w = Math.floor(w); hh = Math.floor(hh);
  const c = ui.scene.canvas; c.style.width = w + 'px'; c.style.height = hh + 'px';
  ui.scene.setSize(Math.max(64, Math.round(w * (ui.pacer?.scale || 1))), Math.max(64, Math.round(hh * (ui.pacer?.scale || 1))), Math.min(1.5, window.devicePixelRatio || 1));
}
function startLoop() { if (ui && !ui.raf && !document.hidden) { ui.pacer?.reset(); ui.raf = requestAnimationFrame(frame); } }
function stopLoop() { if (ui?.raf) { cancelAnimationFrame(ui.raf); ui.raf = 0; } }
let idleMod = null;
import('./features.js?v=7').then(m => { idleMod = m; });
function frame(now) {
  if (!ui) return;
  ui.raf = 0;
  if (document.hidden) return;                         // resumes on visibilitychange
  if (ui.scene?.busy) { ui.raf = requestAnimationFrame(frame); return; }   // the preview worker is still drawing the last frame
  const dt = ui.pacer ? ui.pacer.tick(now) : 1 / 30;
  if (!dt) { ui.raf = requestAnimationFrame(frame); return; }
  const t = (now - ui.t0) / 1000;
  const on = listening();
  const btn = document.getElementById('vz-listen'); if (btn && btn.getAttribute('aria-pressed') !== String(!!on)) btn.setAttribute('aria-pressed', String(!!on));
  let f;
  if (on && H.S.engine?.analyser && idleMod) { ui.live = ui.live || idleMod.createLiveFeatures(H.S.engine.analyser); f = ui.live.update(dt); }
  else f = idleMod ? idleMod.idleFeatures(t) : { pulse: 0.2, low: 0.2, mid: 0.3, high: 0.2, level: 0.3, slow: 0.3, accent: 0, accentLag: 0 };
  ui.scene?.render(t, f);
  ui.raf = requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) startLoop(); });

export function closeVisual() {
  if (!ui) return;
  ui.exporting?.abort();
  stopLoop(); ui.ro?.disconnect();
  if (ui.source.kind === 'song' && H.previewId?.() === ui.source.id) H.stopPreview?.();
  ui.scene?.dispose(); ui.scrim.remove();
  const f = ui.lastFocus; ui = null; f?.focus?.();
}
