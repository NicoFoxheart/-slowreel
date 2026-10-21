// render-worker.js - renders and encodes the music video off the main thread (OffscreenCanvas + WebCodecs), so the
// page stays responsive however slow the GPU is. Any scene of the registry (scenes/index.js) renders here through the
// scene host (scenes/host.js), frame-exact: frame i is drawn at t = i / fps with that frame's audio numbers.
// Messages: {cmd:'start', width, height, fps, frames, F, left, right, sampleRate, codecs, sceneOpts, textLayer} / {cmd:'cancel'}.
//   sceneOpts: {scene, variant, quality, seed, title, artist, showText, intensity}
// Replies: {type:'ready', meta} | {type:'progress', stage, f, info, still?} | {type:'done', buffer} | {type:'error', message, name, init}.
//   still: a small ImageBitmap of the frame just rendered (about every 1.5 s) for the export screen.
import { createSceneHost } from './scenes/host.js?v=9b';
import { encodeVideo } from './video-core.js?v=9b';
import { silentFeatures } from './features.js?v=9b';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
let cancelled = false;
self.onmessage = async ({ data }) => {
  if (data.cmd === 'cancel') { cancelled = true; return; }
  if (data.cmd !== 'start') return;
  let host = null, init = true;
  try {
    const THREE = await import(THREE_URL);
    const { width, height, fps, frames, F, left, right, sampleRate, codecs, sceneOpts = {}, textLayer } = data;
    const scene = sceneOpts.scene || 'heart';
    host = createSceneHost({ THREE, canvas: new OffscreenCanvas(width, height), width, height, pixelRatio: 1, preserve: true, antialias: scene === 'heart' && sceneOpts.quality !== 'light' });
    const meta = await host.load({ ...sceneOpts, scene, textLayer });
    host.render(0, silentFeatures(), { duration: frames / fps, fps, frame: 0 });   // compiles every shader before the clock starts
    init = false; self.postMessage({ type: 'ready', meta: JSON.parse(JSON.stringify(meta)) });
    let lastStill = 0;
    const buffer = await encodeVideo({ scene: host, F, left, right, sampleRate, frames, fps, width, height, codecs, cancelled: () => cancelled,
      onProgress: async (stage, f, info) => {
        const now = performance.now();
        if (stage === 'frames' && now - lastStill > 1500 && typeof createImageBitmap === 'function') {
          lastStill = now;
          try {
            const k = Math.min(1, 480 / Math.max(width, height));
            const still = await createImageBitmap(host.canvas, { resizeWidth: Math.round(width * k), resizeHeight: Math.round(height * k), resizeQuality: 'medium' });
            self.postMessage({ type: 'progress', stage, f, info, still }, [still]); return;
          } catch { }
        }
        self.postMessage({ type: 'progress', stage, f, info });
      } });
    self.postMessage({ type: 'done', buffer }, [buffer]);
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e?.message || e), name: e?.name || 'Error', init });
  } finally { try { host?.dispose(); } catch { } }
};
