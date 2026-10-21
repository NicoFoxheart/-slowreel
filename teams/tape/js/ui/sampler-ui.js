// sampler-ui.js - the Chop Sampler panel: source (one of Nico's songs or an imported audio file, by file picker or drag-drop),
// the waveform behind dark glass with the region and slice markers, slice keys (C3 up) and a per-slice editor
// (pitch, reverse, start / end trim). The instrument's own knobs (Slowed, Pitch, Position, Tone, Slices, Region, ...) stay in the
// standard Sound panel; this panel is shown above or beside them for tracks whose instrument id is 'chop'.
import { h, knob } from './controls.js?v=9b';
import { SAMPLER, SLICE_BASE_MIDI, sampleBuffer, sampleName, loadSample, importSampleFile, trackSampleId, computeSlices, regionOf } from '../sound/sampler.js?v=9b';
import { SONGS } from '../sound/songs.js?v=9b';

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = m => NOTE[m % 12] + (Math.floor(m / 12) - 1);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Resolved sampler params for a track spec: defaults <- preset <- track overrides. */
export function samplerParams(track) {
  const out = {};
  for (const p of SAMPLER.params) out[p.id] = p.default;
  Object.assign(out, SAMPLER.presets.find(p => p.id === track?.instrument?.preset)?.params || {}, track?.instrument?.params || {});
  return out;
}

let cssDone = false;
function injectCss() {
  if (cssDone) return; cssDone = true;
  document.head.append(h('style', { id: 'sr-chop-css', text: `
.sr-chop{display:flex;flex-direction:column;gap:10px;min-width:0}
.sr-chop .src{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.sr-chop select{font:var(--t-ui);color:var(--ink);background:var(--panel-hi);border:1px solid var(--seam-strong);border-radius:var(--r-key);padding:5px 8px;max-width:260px}
.sr-chop .status{font:var(--t-ui);color:var(--ink-2)}
.sr-chop .status.warn{color:var(--signal);font-weight:600}
.sr-chop .glass{position:relative;background:var(--glass);border-radius:var(--r-panel);box-shadow:inset 0 2px 6px rgba(0,0,0,.45);padding:8px;min-height:120px}
.sr-chop .glass canvas{display:block;width:100%;height:120px;cursor:pointer}
.sr-chop .glass .ovl{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:var(--t-ui);color:var(--glass-dim);pointer-events:none;text-align:center;padding:0 16px}
.sr-chop.drop .glass{box-shadow:inset 0 0 0 2px var(--saffron),inset 0 2px 6px rgba(0,0,0,.45)}
.sr-chop .slices{display:flex;flex-wrap:wrap;gap:4px}
.sr-chop .slices .key{min-width:38px;padding:0 6px;font:500 11px/1 var(--f-mono)}
.sr-chop .slices .key.edited{box-shadow:var(--key-shadow),inset 0 -3px 0 var(--saffron)}
.sr-chop .ed{display:flex;flex-wrap:wrap;align-items:center;gap:14px}
.sr-chop .ed .label{font:var(--t-label);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
` }));
}

/**
 * opts: {track, ctx (AudioContext for decoding), engine?, color?, onBegin(), onChange(kind), onEnd(kind), audition?(midi)}
 *  kind 'sample' = the source changed (integrator: await ensureSamples(ctx, project) then engine.applyChange(project, {type:'track', trackId}))
 *  kind 'slices' = per-slice edits (voices read them at note start; no engine call needed).
 * Returns the panel element; el.update(track?) redraws (e.g. after Slices / Region / Position knobs move).
 */
export function createSamplerPanel(opts) {
  injectCss();
  let o = { color: '#F2A900', ...opts }, selected = 0, peaksFor = null, peaks = null;
  const root = h('div', { class: 'sr-chop', role: 'group', 'aria-label': 'Chop Sampler' });
  const songSel = h('select', { 'aria-label': 'Sample source song', onchange: () => {
    if (songSel.value === '__imp') return;
    o.onBegin?.(); const ins = o.track.instrument; ins.params = ins.params || {};
    ins.params.song = songSel.value; delete ins.sample;
    o.onChange?.('sample'); o.onEnd?.('sample'); refresh(); } });
  const file = h('input', { type: 'file', accept: 'audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac', hidden: true, onchange: () => { if (file.files[0]) doImport(file.files[0]); file.value = ''; } });
  const impBtn = h('button', { class: 'key sm', type: 'button', id: 'chop-import', onclick: () => file.click() }, 'Import audio');
  const status = h('span', { class: 'status', role: 'status' });
  const cv = h('canvas', { 'aria-hidden': 'true' });
  const ovl = h('div', { class: 'ovl' });
  const glass = h('div', { class: 'glass' }, cv, ovl);
  const sliceRow = h('div', { class: 'slices', role: 'group', 'aria-label': 'Slices (keys from C3 up)' });
  const ed = h('div', { class: 'ed' });
  root.append(h('div', { class: 'src' }, h('span', { class: 'label', text: 'Source' }), songSel, impBtn, file, status), glass, sliceRow, ed);

  // drag-drop an audio file anywhere on the panel
  root.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); root.classList.add('drop'); } });
  root.addEventListener('dragleave', e => { if (!root.contains(e.relatedTarget)) root.classList.remove('drop'); });
  root.addEventListener('drop', e => { e.preventDefault(); root.classList.remove('drop'); const f = e.dataTransfer?.files?.[0]; if (f) doImport(f); });

  async function doImport(f) {
    status.className = 'status'; status.textContent = `Reading ${f.name}...`;
    try {
      const r = await importSampleFile(o.ctx, f);
      o.onBegin?.(); o.track.instrument.sample = { sampleId: r.sampleId, name: r.name };
      o.onChange?.('sample'); o.onEnd?.('sample');
      refresh(r.stored ? null : 'Not saved on this device (storage blocked): re-import it next time.');
    } catch (e) { status.className = 'status warn'; status.textContent = e.message || 'Could not import that file.'; }
  }

  const sid = () => trackSampleId(o.track);
  const sliceEdits = () => (o.track.instrument.slices = o.track.instrument.slices || []);
  function refresh(note) {
    // a sample that points at one of Nico's songs ('song:<id>') shows as that song, not as an import
    const id = sid(), smp = o.track.instrument.sample, imp = smp && !String(smp.sampleId || '').startsWith('song:') ? smp : null;
    songSel.textContent = '';
    if (imp) songSel.append(h('option', { value: '__imp', text: 'Imported: ' + (imp.name || 'sample'), selected: true }));
    for (const s of SONGS) songSel.append(h('option', { value: s.id, text: s.title, selected: !imp && 'song:' + s.id === id }));
    const buf = sampleBuffer(id);
    if (!buf) {
      ovl.textContent = 'Loading...'; status.className = 'status'; status.textContent = '';
      loadSample(o.ctx, id).then(() => { if (sid() === id) refresh(note); }).catch(e => {
        if (sid() !== id) return;
        const name = imp?.name || sampleName(id);
        ovl.textContent = ''; status.className = 'status warn';
        status.textContent = e?.missing ? `Re-import ${name}` : `Could not load ${name}`;
        impBtn.textContent = e?.missing ? `Re-import ${name}` : 'Import audio';
        draw(null);
      });
      draw(null); return;
    }
    impBtn.textContent = 'Import audio';
    ovl.textContent = '';
    status.className = note ? 'status warn' : 'status';
    status.textContent = note || `${imp?.name || sampleName(id)} · ${buf.duration.toFixed(1)} s`;
    draw(buf);
  }

  function draw(buf) {
    const p = samplerParams(o.track);
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.max(200, cv.clientWidth || 600), H = 120;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const css = getComputedStyle(root), ink = css.getPropertyValue('--glass-ink').trim() || '#EEF0EA', dim = css.getPropertyValue('--glass-dim').trim() || '#8A9490';
    sliceRow.textContent = ''; ed.textContent = '';
    if (!buf) return;
    const [a, b] = regionOf(buf, p), sl = computeSlices(buf, p), n = sl.length;
    selected = clamp(selected, 0, n - 1);
    // whole-song overview strip (top 18 px) + region box
    if (peaksFor !== buf) { peaksFor = buf; peaks = overview(buf, 600); }
    const top = 18;
    g.fillStyle = dim; g.globalAlpha = 0.55;
    for (let i = 0; i < peaks.length; i++) { const x = i / peaks.length * W, hh = Math.max(1, peaks[i] * (top - 4)); g.fillRect(x, (top - hh) / 2, Math.max(1, W / peaks.length - 0.5), hh); }
    g.globalAlpha = 1; g.strokeStyle = o.color; g.lineWidth = 1.5;
    g.strokeRect(a / buf.duration * W + 0.5, 1, Math.max(2, (b - a) / buf.duration * W - 1), top - 2);
    // zoomed region with slices
    const y0 = top + 6, hh = H - y0 - 2, mid = y0 + hh / 2, d = buf.getChannelData(0), sr = buf.sampleRate;
    const xOfT = t => (t - a) / (b - a) * W;
    const s = sl[selected]; g.fillStyle = o.color; g.globalAlpha = 0.16; g.fillRect(xOfT(s.start), y0, xOfT(s.end) - xOfT(s.start), hh); g.globalAlpha = 1;
    const i0 = Math.floor(a * sr), per = Math.max(1, Math.floor((b - a) * sr / W)), stride = Math.max(1, Math.floor(per / 64));
    let gmax = 1e-4; const cols = [];
    for (let x = 0; x < W; x++) { let mn = 0, mx = 0; const st = i0 + x * per; for (let i = st; i < st + per && i < d.length; i += stride) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; } cols.push([mn, mx]); gmax = Math.max(gmax, mx, -mn); }
    for (let x = 0; x < W; x++) {
      const t = a + x / W * (b - a), inSel = t >= s.start && t < s.end;
      g.fillStyle = inSel ? o.color : ink; g.globalAlpha = inSel ? 1 : 0.8;
      const [mn, mx] = cols[x]; g.fillRect(x, mid - mx / gmax * hh / 2, 1, Math.max(1, (mx - mn) / gmax * hh / 2));
    }
    g.globalAlpha = 1; g.font = '10px ui-monospace, monospace'; g.textBaseline = 'top';
    sl.forEach((z, i) => {
      const x = Math.round(xOfT(z.start)) + 0.5;
      g.strokeStyle = i === selected ? o.color : 'rgba(238,240,234,.45)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + hh); g.stroke();
      if (xOfT(z.end) - xOfT(z.start) > 22) { g.fillStyle = i === selected ? o.color : dim; g.fillText(noteName(SLICE_BASE_MIDI + i), x + 3, y0 + 2); }
    });
    cv._hit = ev => { const r = cv.getBoundingClientRect(), t = a + (ev.clientX - r.left) / r.width * (b - a); const i = sl.findIndex(z => t >= z.start && t < z.end); return i; };
    // slice keys
    const edits = o.track.instrument.slices || [];
    sl.forEach((z, i) => sliceRow.append(h('button', { class: 'key sm' + (isEdited(edits[i]) ? ' edited' : ''), type: 'button', 'aria-pressed': String(i === selected),
      title: `Slice ${i + 1} (${noteName(SLICE_BASE_MIDI + i)}), ${(z.end - z.start).toFixed(2)} s`, text: noteName(SLICE_BASE_MIDI + i),
      onclick: () => pick(i, true) })));
    // per-slice editor
    const e = edits[selected] || {};
    const upd = (k, v, commit) => { const all = sliceEdits(); const cur = { ...(all[selected] || {}) }; cur[k] = v; all[selected] = cur; for (let i = 0; i < all.length; i++) if (!all[i]) all[i] = {}; o.onChange?.('slices'); if (commit) { o.onEnd?.('slices'); draw(buf); } };
    const kn = (id, name, min, max, def, unit, step) => knob({ id, name, min, max, default: def, unit, step }, { value: e[id] ?? def, size: 'sm', color: o.color, idPrefix: 'chop-slice',
      onInput: v => { if (!kn.began) { kn.began = true; o.onBegin?.(); } upd(id, v, false); }, onCommit: v => { kn.began = false; upd(id, v, true); } });
    const rev = h('button', { class: 'key sm', type: 'button', id: 'chop-reverse', 'aria-pressed': String(!!e.reverse), onclick: () => { o.onBegin?.(); upd('reverse', !e.reverse, true); } }, h('span', { class: 'led' }), 'Reverse');
    const reset = h('button', { class: 'key sm', type: 'button', disabled: !isEdited(e), onclick: () => { o.onBegin?.(); sliceEdits()[selected] = {}; o.onChange?.('slices'); o.onEnd?.('slices'); draw(buf); } }, 'Reset slice');
    ed.append(h('span', { class: 'label', text: `Slice ${selected + 1} · ${noteName(SLICE_BASE_MIDI + selected)}` }),
      kn('pitch', 'Pitch', -24, 24, 0, 'st', 1), kn('start', 'Start', 0, 0.95, 0, '%'), kn('end', 'End', 0.05, 1, 1, '%'), rev, reset);
  }
  const isEdited = e => !!e && ((e.pitch || 0) !== 0 || !!e.reverse || (e.start ?? 0) > 0 || (e.end ?? 1) < 1);
  function pick(i, play) {
    selected = i; draw(sampleBuffer(sid()));
    if (!play) return;
    const m = SLICE_BASE_MIDI + i;
    if (o.audition) o.audition(m);
    else if (o.engine) { o.engine.noteOn(o.track.id, m, 0.85); setTimeout(() => o.engine.noteOff(o.track.id, m), 450); }
  }
  cv.addEventListener('pointerdown', ev => { const i = cv._hit?.(ev); if (i >= 0) pick(i, true); });

  root.update = t => { if (t) o.track = t; refresh(); };
  root.selectedSlice = () => selected;
  refresh();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { const b = sampleBuffer(sid()); if (b && root.isConnected) draw(b); }).observe(glass);
  return root;
}

function overview(buf, n) {
  const d = buf.getChannelData(0), per = Math.floor(d.length / n), out = new Float32Array(n); let mx = 1e-4;
  for (let i = 0; i < n; i++) { let m = 0; for (let j = i * per; j < (i + 1) * per; j += 16) { const v = Math.abs(d[j]); if (v > m) m = v; } out[i] = m; mx = Math.max(mx, m); }
  for (let i = 0; i < n; i++) out[i] /= mx;
  return out;
}
