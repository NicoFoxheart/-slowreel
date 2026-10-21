// preview.js - the live preview of the fox heart. It draws in a Worker on an OffscreenCanvas when the browser can, so the
// WebGL work (and a slow GPU) never sits on the main thread next to the studio's audio scheduler. Same interface as
// createHeartScene: {canvas, busy, setSize, setMood, setIntensity, setText, render(t, f), dispose}. Falls back to drawing
// on the page (also with ?preview=page). The text layer is drawn here, where the page fonts are, and sent as a bitmap.
import { loadHeart } from './common.js?v=8p';
import { drawTextLayer } from './heart-scene.js?v=8p';

export async function createPreview(opts) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined' && HTMLCanvasElement.prototype.transferControlToOffscreen && !/[?&]preview=page/.test(location.search)) {
    try { return await workerPreview(opts); } catch (e) { console.warn('[visual] preview worker unavailable, drawing on the page:', e?.message || e); }
  }
  const { createHeartScene } = await loadHeart();
  return createHeartScene(opts);
}

async function workerPreview({ width, height, pixelRatio = 1, mood = 'sakura', intensity = 0.6, title = '', artist = '', light = false, antialias = true }) {
  const st = { w: width, h: height, pr: pixelRatio, mood, title, artist };
  const canvas = document.createElement('canvas'); canvas.width = Math.round(width * pixelRatio); canvas.height = Math.round(height * pixelRatio);
  const tc = document.createElement('canvas');
  const layer = async () => {
    // the text is drawn at the size the canvas is shown (sharp even when a slow GPU makes the 3D render smaller)
    const cw = canvas.clientWidth || st.w, ch = canvas.clientHeight || st.h, k = Math.min(1.5, Math.max(st.pr, window.devicePixelRatio || 1));
    tc.width = Math.max(2, Math.round(cw * k)); tc.height = Math.max(2, Math.round(ch * k));
    const layout = drawTextLayer(tc, { title: st.title, artist: st.artist, mood: st.mood });
    return { bitmap: await createImageBitmap(tc, { imageOrientation: 'flipY' }), layout };
  };
  const off = canvas.transferControlToOffscreen();
  const w = new Worker(new URL('./preview-worker.js?v=8p', import.meta.url), { type: 'module' });
  let busy = false, dead = false, seq = 0;
  await new Promise(async (resolve, reject) => {
    const tm = setTimeout(() => reject(new Error('the preview worker did not start')), 20000);
    const fail = e => { clearTimeout(tm); dead = true; w.terminate(); reject(e); };
    w.onerror = ev => { ev.preventDefault?.(); fail(new Error(ev.message || 'the preview worker failed to load')); };
    w.onmessage = ({ data: m }) => {
      if (m.type === 'ready') { clearTimeout(tm); resolve(); }
      else if (m.type === 'error' && m.init) fail(new Error(m.message));
    };
    try { const text = await layer(); w.postMessage({ cmd: 'init', canvas: off, text, opts: { width, height, pixelRatio, mood, intensity, light, antialias, title, artist } }, [off, text.bitmap]); }
    catch (e) { fail(e); }
  });
  w.onerror = ev => { ev.preventDefault?.(); console.warn('[visual] preview worker:', ev.message); busy = false; };
  w.onmessage = ({ data: m }) => { if (m.type === 'drawn') busy = false; else if (m.type === 'error') console.warn('[visual] preview:', m.message); };
  // text redraws are async: only the newest one is sent
  const sendText = async (cmd, extra = {}) => {
    const my = ++seq, text = await layer().catch(() => null);
    if (dead || my !== seq || !text) { text?.bitmap.close(); return; }
    w.postMessage({ cmd, ...extra, text }, [text.bitmap]);
  };
  document.fonts?.ready?.then(() => !dead && sendText('text'));
  Promise.all([document.fonts?.load?.('64px "Dela Gothic One"'), document.fonts?.load?.('500 32px "M PLUS Rounded 1c"')]).then(() => !dead && sendText('text')).catch(() => { });
  return {
    canvas, where: 'worker',
    get busy() { return busy; },
    setSize(wd, ht, pr = 1) {
      if (dead || (wd === st.w && ht === st.h && pr === st.pr)) return;
      Object.assign(st, { w: wd, h: ht, pr });
      w.postMessage({ cmd: 'size', w: wd, h: ht, pr }); sendText('text');
    },
    setMood(id) { if (dead) return; st.mood = id; w.postMessage({ cmd: 'mood', id }); sendText('text'); },
    setIntensity(v) { if (!dead) w.postMessage({ cmd: 'intensity', v }); },
    setText(t) { if (dead) return; Object.assign(st, t); sendText('text'); },
    render(t, f) { if (dead || busy) return false; busy = true; w.postMessage({ cmd: 'frame', t, f: { ...f } }); return true; },
    dispose() { if (dead) return; dead = true; w.postMessage({ cmd: 'dispose' }); setTimeout(() => w.terminate(), 500); },
  };
}
