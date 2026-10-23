// preview-worker.js - the live preview off the main thread (OffscreenCanvas from transferControlToOffscreen), so a slow GPU
// never blocks the studio's audio scheduling. Any scene of the registry (scenes/index.js) runs here through the scene host
// (scenes/host.js). The page sends one {cmd:'frame'} at a time and waits for 'drawn'. Snapshots (scene-card thumbnails,
// tests/scene-check.cjs) render on a second, hidden host one at a time, so they never touch the live picture.
// Messages in:  init {canvas, opts, text} | load {opts, text} | variant {id, text} | size {w, h, pr, text} | intensity {v}
//   | text {text} | frame {t, f, info} | snap {id, opts, shots: [{t, f}], text, png, pixels, measure, size: [w, h]}
//   | metas {id, ids} | release (free the snapshot host) | dispose
//   opts: {scene, variant, quality, seed, title, artist, showText, intensity, width, height, pixelRatio}
// Messages out: ready {meta} | loaded {meta} | drawn | snap {id, ...} | metas {id, list} | error {message, init, id}
import { createSceneHost } from './scenes/host.js?v=10b';
import { probeScenes } from './scenes/index.js?v=10b';
import { silentFeatures } from './features.js?v=10b';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const ONE = new Uint8Array(4);
let THREE = null, host = null, shown = null, snapHost = null, snapKey = '', meter = null;
const three = async () => (THREE ||= await import(THREE_URL));
const plain = m => (m ? JSON.parse(JSON.stringify(m)) : null);
const keep = bm => { try { shown?.close(); } catch { } shown = bm; };
const text = m => { if (host && m.text) { host.setText(m.text); if (m.text.bitmap) keep(m.text.bitmap); } };

async function snap(m) {
  const T = await three();
  if (m.measure && !meter) { const g = await import('./scenes/gpumem.js?v=10b'); meter = g.installGpuMeter(); if (snapHost) { snapHost.dispose(); snapHost = null; snapKey = ''; } }
  const [w, h] = m.size || [320, 180], o = { quality: 'high', seed: 1, showText: false, ...m.opts };
  if (!snapHost) snapHost = createSceneHost({ THREE: T, width: w, height: h, pixelRatio: 1, preserve: true, antialias: o.scene === 'heart' });
  const key = JSON.stringify([o.scene, o.variant, o.quality, o.seed, o.showText, o.title, o.artist, o.intensity]);
  const sz = snapHost.size;
  if (sz.width !== w || sz.height !== h) snapHost.resize(w, h, 1);
  let tLoad = 0;
  if (key !== snapKey || !snapHost.meta) { const t0 = performance.now(); await snapHost.load({ ...o, textLayer: m.text || null }); snapKey = key; tLoad = performance.now() - t0; }
  else if (m.text) snapHost.setText(m.text);
  const gl = snapHost.renderer.getContext(), shots = m.shots?.length ? m.shots : [{ t: snapHost.meta?.thumbT ?? 12 }];
  const out = [], transfer = [];
  for (const s0 of shots) {
    const s = { ...s0, t: s0.t ?? snapHost.meta?.thumbT ?? 12 };
    const reps = Math.max(1, s.frames || 1), ms = [];
    let stats = null;
    for (let r = 0; r < reps; r++) {
      const t0 = performance.now();
      snapHost.render(s.t + r / (s.fps || 30), s.f || silentFeatures(), { duration: s.duration || 0, fps: s.fps || 30 });
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, ONE); ms.push(performance.now() - t0);   // readPixels waits for the GPU (finish() may not)
      if (r === 0) stats = snapHost.stats();
      if (r === 0) {
        const one = { t: s.t, ms: 0, stats };
        if (m.pixels) { const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); one.pixels = px.buffer; transfer.push(px.buffer); }
        if (m.png) { const b = await snapHost.canvas.convertToBlob({ type: 'image/png' }); one.png = await b.arrayBuffer(); transfer.push(one.png); }
        else if (!m.pixels) { one.bitmap = await createImageBitmap(snapHost.canvas); transfer.push(one.bitmap); }
        out.push(one);
      }
    }
    out[out.length - 1].ms = ms; out[out.length - 1].stats = stats;
  }
  return { shots: out, loadMs: tLoad, meta: plain(snapHost.meta), memory: meter ? { textures: meter.textures, renderbuffers: meter.renderbuffers, buffers: meter.buffers, total: meter.total } : null,
    renderer: { maxTexture: snapHost.renderer.capabilities.maxTextureSize, isWebGL2: snapHost.renderer.capabilities.isWebGL2 }, transfer };
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.cmd === 'init') {
      const T = await three(), o = m.opts || {};
      host = createSceneHost({ THREE: T, canvas: m.canvas, width: o.width || 320, height: o.height || 180, pixelRatio: o.pixelRatio || 1, antialias: (o.scene || 'heart') === 'heart' && o.quality !== 'light' && o.antialias !== false });
      const meta = await host.load({ scene: 'heart', ...o, textLayer: m.text || null }); if (m.text?.bitmap) keep(m.text.bitmap);
      self.postMessage({ type: 'ready', meta: plain(meta) }); return;
    }
    if (m.cmd === 'snap') { const r = await snap(m); const { transfer, ...rest } = r; self.postMessage({ type: 'snap', id: m.id, ...rest }, transfer); return; }
    if (m.cmd === 'metas') { const list = await probeScenes(m.ids); self.postMessage({ type: 'metas', id: m.id, list: list.map(x => ({ id: x.id, ok: x.ok, meta: plain(x.meta) })) }); return; }
    if (m.cmd === 'release') { snapHost?.dispose(); snapHost = null; snapKey = ''; return; }
    if (m.cmd === 'dispose') { snapHost?.dispose(); host?.dispose(); host = snapHost = null; self.close(); return; }
    if (!host) return;
    if (m.cmd === 'frame') { host.render(m.t, m.f, m.info || { live: true }); self.postMessage({ type: 'drawn' }); }
    else if (m.cmd === 'load') {
      try { const meta = await host.load({ ...(host.options || {}), ...m.opts, textLayer: m.text || null }); if (m.text?.bitmap) keep(m.text.bitmap); self.postMessage({ type: 'loaded', meta: plain(meta) }); }
      catch (e) { self.postMessage({ type: 'loaded', meta: null, error: String(e?.message || e) }); }
    }
    else if (m.cmd === 'variant') { await host.setVariant(m.id); text(m); }
    else if (m.cmd === 'size') { host.resize(m.w, m.h, m.pr); text(m); }
    else if (m.cmd === 'intensity') host.setIntensity(m.v);
    else if (m.cmd === 'text') text(m);
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e?.message || e), init: m.cmd === 'init', id: m.id });
    if (m.cmd === 'frame') self.postMessage({ type: 'drawn' });
  }
};
