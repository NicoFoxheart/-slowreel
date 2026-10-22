// preview.js - the live preview of any scene (scenes/index.js). It draws in a Worker on an OffscreenCanvas when the browser
// can, so the WebGL work (and a slow GPU) never sits on the main thread next to the studio's audio scheduler. Falls back
// to a scene host on the page (also with ?preview=page). The text layer is drawn here, where the page fonts are, and
// sent as a bitmap. Scene metas and scene-card snapshots also come from the worker (the page never loads scene code).
// createPreview({width, height, pixelRatio, scene = 'heart', variant (or mood), quality, intensity, title, artist, showText})
// -> {canvas, where, busy, meta, setScene({scene, variant, quality}) -> Promise<meta|null>, setVariant(id), setMood(id),
//     setSize(w, h, pr), setIntensity(v), setText({title, artist, showText}), render(t, f, info) -> bool,
//     snap({scene, variant, quality, size: [w, h], t, f}) -> Promise<ImageBitmap|null>, metas(ids) -> Promise<[{id, ok, meta}]>,
//     dispose()}
import { drawTextLayer } from './heart-scene.js?v=9d';
import { textStyle } from './scenes/index.js?v=9d';

export async function createPreview(opts) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined' && HTMLCanvasElement.prototype.transferControlToOffscreen && !/[?&]preview=page/.test(location.search)) {
    try { return await workerPreview(opts); } catch (e) { console.warn('[visual] preview worker unavailable, drawing on the page:', e?.message || e); }
  }
  return pagePreview(opts);
}

function textState(o) {
  return { w: o.width, h: o.height, pr: o.pixelRatio || 1, scene: o.scene || 'heart', variant: o.variant ?? o.mood ?? null, quality: o.quality || (o.light ? 'light' : 'high'),
    title: o.title || '', artist: o.artist || '', showText: o.showText !== false, intensity: o.intensity ?? 0.6, meta: null };
}
const moodOf = st => (st.scene === 'heart' ? (st.variant || 'sakura') : textStyle(st.meta, st.variant));
function makeLayer(st, canvas, tc) {
  // drawn at the size the canvas is shown (sharp even when a slow GPU makes the 3D render smaller)
  const cw = canvas.clientWidth || st.w, ch = canvas.clientHeight || st.h, k = Math.min(1.5, Math.max(st.pr, window.devicePixelRatio || 1));
  tc.width = Math.max(2, Math.round(cw * k)); tc.height = Math.max(2, Math.round(ch * k));
  const layout = drawTextLayer(tc, { title: st.showText ? st.title : '', artist: st.showText ? st.artist : '', mood: moodOf(st) });
  if (layout && !st.showText) layout.hideBar = true;
  return layout;
}
const sceneOpts = st => ({ scene: st.scene, variant: st.variant, quality: st.quality, title: st.title, artist: st.artist, showText: st.showText, intensity: st.intensity, seed: 1 });

async function workerPreview(o) {
  const st = textState(o);
  const canvas = document.createElement('canvas'); canvas.width = Math.round(st.w * st.pr); canvas.height = Math.round(st.h * st.pr);
  const tc = document.createElement('canvas');
  const layer = async () => { const layout = makeLayer(st, canvas, tc); return { bitmap: await createImageBitmap(tc, { imageOrientation: 'flipY' }), layout }; };
  const off = canvas.transferControlToOffscreen();
  const w = new Worker(new URL('./preview-worker.js?v=9d', import.meta.url), { type: 'module' });
  let busy = false, dead = false, seq = 0, rid = 0, loading = null;
  const pending = new Map();
  const ask = (msg, transfer = []) => new Promise((res, rej) => { const id = ++rid; pending.set(id, { res, rej }); w.postMessage({ ...msg, id }, transfer); });
  await new Promise(async (resolve, reject) => {
    const tm = setTimeout(() => reject(new Error('the preview worker did not start')), 30000);
    const fail = e => { clearTimeout(tm); dead = true; w.terminate(); reject(e); };
    w.onerror = ev => { ev.preventDefault?.(); fail(new Error(ev.message || 'the preview worker failed to load')); };
    w.onmessage = ({ data: m }) => {
      if (m.type === 'ready') { clearTimeout(tm); st.meta = m.meta; resolve(); }
      else if (m.type === 'error' && m.init) fail(new Error(m.message));
    };
    try { const text = await layer(); w.postMessage({ cmd: 'init', canvas: off, text, opts: { ...sceneOpts(st), width: st.w, height: st.h, pixelRatio: st.pr, antialias: o.antialias } }, [off, text.bitmap]); }
    catch (e) { fail(e); }
  });
  w.onerror = ev => { ev.preventDefault?.(); console.warn('[visual] preview worker:', ev.message); busy = false; };
  w.onmessage = ({ data: m }) => {
    if (m.type === 'drawn') busy = false;
    else if (m.type === 'loaded') { const l = loading; loading = null; l?.(m); }
    else if ((m.type === 'snap' || m.type === 'metas') && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p.res(m); }
    else if (m.type === 'error') { if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p.rej(new Error(m.message)); } else console.warn('[visual] preview:', m.message); }
  };
  // text redraws are async: only the newest one is sent
  const sendText = async (cmd, extra = {}) => {
    const my = ++seq, text = await layer().catch(() => null);
    if (dead || my !== seq || !text) { text?.bitmap.close(); return; }
    w.postMessage({ cmd, ...extra, text }, [text.bitmap]);
  };
  document.fonts?.ready?.then(() => !dead && sendText('text'));
  Promise.all([document.fonts?.load?.('64px "Dela Gothic One"'), document.fonts?.load?.('500 32px "M PLUS Rounded 1c"')]).then(() => !dead && sendText('text')).catch(() => { });
  // snapshots are queued: one at a time, so thumbnails never pile up in the worker
  let snapChain = Promise.resolve();
  const api = {
    canvas, where: 'worker',
    get busy() { return busy || !!loading; },
    get meta() { return st.meta; }, get scene() { return st.scene; }, get variant() { return st.variant; },
    async setScene({ scene = st.scene, variant = null, quality = st.quality } = {}) {
      if (dead) return null;
      if (scene === st.scene && quality === st.quality && (variant == null || variant === st.variant)) return st.meta;
      Object.assign(st, { scene, variant, quality });
      const m = await new Promise(res => { const prev = loading; loading = r => { prev?.(r); res(r); }; w.postMessage({ cmd: 'load', opts: sceneOpts(st), text: null }); });
      if (m.meta) { st.meta = m.meta; st.variant = st.variant && m.meta.variants.some(v => v.id === st.variant) ? st.variant : m.meta.defaultVariant; sendText('text'); }
      return m.meta || null;
    },
    setVariant(id) { if (dead || id === st.variant) return; st.variant = id; sendText('variant', { id }); },
    setMood(id) { api.setVariant(id); },
    setSize(wd, ht, pr = 1) {
      if (dead || (wd === st.w && ht === st.h && pr === st.pr)) return;
      Object.assign(st, { w: wd, h: ht, pr });
      w.postMessage({ cmd: 'size', w: wd, h: ht, pr }); sendText('text');
    },
    setIntensity(v) { st.intensity = v; if (!dead) w.postMessage({ cmd: 'intensity', v }); },
    setText(t) { if (dead) return; Object.assign(st, t); sendText('text'); },
    render(t, f, info) { if (dead || busy || loading) return false; busy = true; w.postMessage({ cmd: 'frame', t, f: { ...f }, info: info || { live: true } }); return true; },
    snap({ scene, variant, quality = 'light', size = [320, 180], t, f } = {}) {
      const job = snapChain.then(async () => {
        if (dead) return null;
        const r = await ask({ cmd: 'snap', opts: { scene, variant, quality, showText: false }, size, shots: [{ t: t ?? null, f }].map(s => (s.t == null ? {} : s)) });
        return r.shots?.[0]?.bitmap || null;
      });
      snapChain = job.catch(() => null);
      return job;
    },
    async metas(ids) { if (dead) return []; return (await ask({ cmd: 'metas', ids })).list; },
    releaseSnaps() { if (!dead) w.postMessage({ cmd: 'release' }); },
    dispose() { if (dead) return; dead = true; w.postMessage({ cmd: 'dispose' }); setTimeout(() => w.terminate(), 500); for (const p of pending.values()) p.res({}); pending.clear(); },
  };
  return api;
}

// Fallback: a scene host on the page (no snapshots: cards show their colour swatch instead).
async function pagePreview(o) {
  const st = textState(o);
  const [{ createSceneHost }, THREE, { probeScenes }] = await Promise.all([import('./scenes/host.js?v=9d'), import('three'), import('./scenes/index.js?v=9d')]);
  const host = createSceneHost({ THREE, width: st.w, height: st.h, pixelRatio: st.pr, antialias: st.scene === 'heart' && st.quality !== 'light' });
  const tc = document.createElement('canvas');
  const text = async () => { const layout = makeLayer(st, host.canvas, tc); return { bitmap: await createImageBitmap(tc, { imageOrientation: 'flipY' }), layout }; };
  st.meta = await host.load({ ...sceneOpts(st), textLayer: await text() });
  const retext = async () => { host.setText(await text()); };
  return {
    canvas: host.canvas, where: 'page', busy: false,
    get meta() { return st.meta; }, get scene() { return st.scene; }, get variant() { return st.variant; },
    async setScene({ scene = st.scene, variant = null, quality = st.quality } = {}) {
      Object.assign(st, { scene, variant, quality });
      try { st.meta = await host.load({ ...sceneOpts(st), textLayer: null }); st.variant = host.variant; await retext(); return st.meta; } catch (e) { console.warn('[visual] scene', e); return null; }
    },
    setVariant(id) { st.variant = id; host.setVariant(id).then(retext); },
    setMood(id) { this.setVariant(id); },
    setSize(w, h, pr = 1) { Object.assign(st, { w, h, pr }); host.resize(w, h, pr); retext(); },
    setIntensity(v) { host.setIntensity(v); },
    setText(t) { Object.assign(st, t); retext(); },
    render(t, f, info) { host.render(t, f, info || { live: true }); return true; },
    snap: async () => null,
    metas: ids => probeScenes(ids),
    releaseSnaps() { },
    dispose() { host.dispose(); },
  };
}
