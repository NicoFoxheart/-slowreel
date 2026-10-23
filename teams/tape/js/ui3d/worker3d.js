// worker3d.js - draws the Slowreel 3D studio deck off the main thread (OffscreenCanvas from transferControlToOffscreen),
// so WebGL work never sits next to the studio's audio scheduler. It draws only while something moves (reels, needle,
// glows, the camera settling after the mouse), at most 30 fps (20 on a software renderer), and sleeps otherwise.
// Messages in:  init {canvas, w, h, dpr, layout, state} | layout {w, h, dpr, layout} | state {...} | visible {v} | stats | dispose
// Messages out: ready {soft, renderer} | error {message, init} | lost | stats {frames, awake, fps}
import { setThree, createStudioScene } from './scene3d.js?v=10a';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
let scene = null, visible = true, awake = false, last = 0, fps = 30, dead = false, frames = 0;
const raf = typeof self.requestAnimationFrame === 'function' ? f => self.requestAnimationFrame(f) : f => setTimeout(() => f(performance.now()), 1000 / fps);

function wake() { if (!awake && visible && scene && !dead) { awake = true; last = 0; raf(tick); } }
function tick(now) {
  if (!visible || !scene || dead) { awake = false; return; }
  if (last && now - last < 1000 / fps - 3) { raf(tick); return; }     // 30 fps cap
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / fps; last = now;
  let moving = false;
  try { moving = scene.update(dt); scene.render(); frames++; }
  catch (e) { self.postMessage({ type: 'error', message: String(e?.message || e) }); awake = false; return; }
  if (moving) raf(tick); else awake = false;
}

/** Software renderers (SwiftShader, llvmpipe) get the light pipeline: DPR 1, no MSAA, 20 fps, fewer shadow updates. */
function rendererName() {
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2') || new OffscreenCanvas(1, 1).getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return null; }
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.cmd === 'init') {
      const name = rendererName();
      if (name === null) throw new Error('WebGL is not available in a worker here');
      const soft = /swiftshader|llvmpipe|software|basic render/i.test(name) || !!m.forceSoft;
      if (soft) fps = 20;
      setThree(await import(THREE_URL));
      m.canvas.addEventListener?.('webglcontextlost', e => { e.preventDefault?.(); dead = true; self.postMessage({ type: 'lost' }); });
      scene = createStudioScene({ canvas: m.canvas, width: m.w, height: m.h, dpr: m.dpr, layout: m.layout, soft });
      scene.set(m.state || {});
      scene.update(1 / fps); scene.render();           // compile shaders + first frame before the page shows it
      self.postMessage({ type: 'ready', soft, renderer: name });
      wake(); return;
    }
    if (!scene) return;
    if (m.cmd === 'state') { scene.set(m.state); wake(); }
    else if (m.cmd === 'layout') { scene.layout(m.w, m.h, m.layout, m.dpr); last = 0; if (!awake) { scene.update(1 / fps); scene.render(); } wake(); }
    else if (m.cmd === 'stats') self.postMessage({ type: 'stats', frames, awake, fps });
    else if (m.cmd === 'visible') { visible = !!m.v; if (visible) wake(); }
    else if (m.cmd === 'dispose') { dead = true; try { scene.dispose(); } catch { } scene = null; self.close(); }
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e?.message || e), init: m.cmd === 'init' });
  }
};
