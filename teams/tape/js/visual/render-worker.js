// render-worker.js - renders and encodes the music video off the main thread (OffscreenCanvas + WebCodecs), so the
// page stays responsive however slow the GPU is (phones). Messages: {cmd:'start', ...} / {cmd:'cancel'}.
// Replies: {type:'ready'} | {type:'progress', stage, f, info} | {type:'done', buffer} | {type:'error', message, name, init}.
import { setThree, createHeartScene } from './heart-scene.js?v=7';
import { encodeVideo } from './video-core.js?v=7';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
let cancelled = false;
self.onmessage = async ({ data }) => {
  if (data.cmd === 'cancel') { cancelled = true; return; }
  if (data.cmd !== 'start') return;
  let scene = null, init = true;
  try {
    setThree(await import(THREE_URL));
    const { width, height, fps, frames, F, left, right, sampleRate, codecs, sceneOpts, textLayer } = data;
    scene = createHeartScene({ ...sceneOpts, canvas: new OffscreenCanvas(width, height), width, height, pixelRatio: 1, preserve: true, textLayer });
    scene.render(0, { pulse: 0, low: 0, mid: 0, high: 0, level: 0, slow: 0, accent: 0, accentLag: 0 }, { duration: frames / fps });   // compile shaders
    init = false; self.postMessage({ type: 'ready' });
    const buffer = await encodeVideo({ scene, F, left, right, sampleRate, frames, fps, width, height, codecs, cancelled: () => cancelled,
      onProgress: (stage, f, info) => self.postMessage({ type: 'progress', stage, f, info }) });
    self.postMessage({ type: 'done', buffer }, [buffer]);
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e?.message || e), name: e?.name || 'Error', init });
  } finally { try { scene?.dispose(); } catch { } }
};
