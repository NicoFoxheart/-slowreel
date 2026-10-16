// preview-worker.js - draws the live fox-heart preview off the main thread (OffscreenCanvas from transferControlToOffscreen),
// so a slow GPU never blocks the studio's audio scheduling. The page sends one {cmd:'frame'} at a time and waits for 'drawn'.
// Messages: init {canvas, opts, text} | size {w, h, pr, text} | mood {id, text} | intensity {v} | text {text} | frame {t, f} | dispose.
import { setThree, createHeartScene } from './heart-scene.js';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
let scene = null, shown = null;
const text = m => { if (scene && m.text?.bitmap) { scene.setTextLayer(m.text.bitmap, m.text.layout); try { shown?.close(); } catch { } shown = m.text.bitmap; } };
self.onmessage = async ({ data: m }) => {
  try {
    if (m.cmd === 'init') {
      setThree(await import(THREE_URL));
      scene = createHeartScene({ ...m.opts, canvas: m.canvas, textLayer: m.text }); shown = m.text.bitmap;
      self.postMessage({ type: 'ready' }); return;
    }
    if (!scene) return;
    if (m.cmd === 'frame') { scene.render(m.t, m.f); self.postMessage({ type: 'drawn' }); }
    else if (m.cmd === 'size') { scene.setSize(m.w, m.h, m.pr); text(m); }
    else if (m.cmd === 'mood') { scene.setMood(m.id); text(m); }
    else if (m.cmd === 'intensity') scene.setIntensity(m.v);
    else if (m.cmd === 'text') text(m);
    else if (m.cmd === 'dispose') { scene.dispose(); scene = null; self.close(); }
  } catch (e) { self.postMessage({ type: 'error', message: String(e?.message || e), init: m.cmd === 'init' }); if (m.cmd === 'frame') self.postMessage({ type: 'drawn' }); }
};
