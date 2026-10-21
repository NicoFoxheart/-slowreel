// host.js - the scene host: owns the WebGLRenderer (one per canvas, kept across scene switches), loads a scene through
// the registry, resets renderer state between scenes, resizes, draws the title overlay (title/artist layer, a soft
// legibility gradient, the progress hairline, fade in from / out to black) on top of scenes that do not draw their own,
// and reports renderer stats. Used by render-worker.js (export), preview-worker.js (live preview + thumbnails), the page
// fallbacks and tests/scene-check.cjs. No DOM needed (OffscreenCanvas); the text layer arrives as an ImageBitmap.
import { loadScene, pickVariant, textStyle } from './index.js?v=9a';
import { disposeCached, createPass } from './kit-gpu.js?v=9a';

const OVERLAY_FS = /* glsl */`
uniform sampler2D tText; uniform float uHasLayer, uText, uFade, uProg, uBarOn; uniform vec4 uBar; uniform vec3 uAccent; uniform float uGradY;
void main() {
  vec4 txt = uHasLayer > 0.5 ? texture2D(tText, vUv) : vec4(0.0);
  float g = uText * smoothstep(uGradY + 0.28, 0.0, vUv.y) * 0.32;
  vec3 col = txt.rgb; float a = txt.a;
  if (uBarOn > 0.5) {
    vec2 p = vUv * 2.0 - 1.0;
    float inBar = step(uBar.x, p.x) * step(p.x, uBar.x + uBar.z) * step(abs(p.y - uBar.y), uBar.w * 0.5);
    float filled = step(p.x, uBar.x + uBar.z * uProg);
    vec4 b = vec4(mix(vec3(1.0), uAccent, filled), inBar * mix(0.18, 0.85, filled));
    col = mix(col, b.rgb, b.a); a = a + b.a * (1.0 - a);
  }
  float keep = (1.0 - g) * (1.0 - a) * (1.0 - uFade);
  gl_FragColor = vec4(col * a * (1.0 - uFade), 1.0 - keep);
}`;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hexRGB = h => { const n = parseInt(String(h).replace('#', '').slice(0, 6), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

/**
 * createSceneHost({THREE, canvas, width, height, pixelRatio = 1, preserve = false, antialias = false, onWarn})
 * (antialias: MSAA on the canvas itself - only the heart wants it; kit scenes antialias inside kit.createPost.)
 * -> { canvas, renderer, meta, sceneId, variant, load(opts), setVariant(v), setText({bitmap, layout}), setIntensity(v),
 *      resize(w, h, pr), render(t, f, info), stats(), unload(), dispose() }
 * load({scene, variant, quality, seed, title, artist, showText, intensity, textLayer}) -> meta (rejects if the scene fails).
 */
export function createSceneHost({ THREE, canvas, width = 1280, height = 720, pixelRatio = 1, preserve = false, antialias = false, onWarn = (...a) => console.warn(...a) } = {}) {
  canvas = canvas || (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height }));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias, alpha: false, preserveDrawingBuffer: preserve, powerPreference: 'high-performance', stencil: false });
  renderer.info.autoReset = false;
  let W = width, H = height, PR = pixelRatio, scene = null, meta = null, cur = null;
  // overlay
  const ou = { tText: { value: null }, uHasLayer: { value: 0 }, uText: { value: 0 }, uFade: { value: 0 }, uProg: { value: 0 }, uBarOn: { value: 0 }, uBar: { value: new THREE.Vector4() },
    uAccent: { value: new THREE.Vector3(1, 0.85, 0.65) }, uGradY: { value: 0.2 } };
  const overlay = createPass(THREE, { fragment: OVERLAY_FS, uniforms: ou, blending: THREE.CustomBlending });
  overlay.material.blendSrc = THREE.OneFactor; overlay.material.blendDst = THREE.OneMinusSrcAlphaFactor;
  overlay.material.blendSrcAlpha = THREE.ZeroFactor; overlay.material.blendDstAlpha = THREE.OneFactor;
  let textTex = null, layout = null;

  function reset() {
    renderer.setRenderTarget(null); renderer.autoClear = true; renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = false; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = true;
    renderer.setClearColor(0x000000, 1); renderer.localClippingEnabled = false; renderer.clippingPlanes = []; renderer.sortObjects = true;
    renderer.setPixelRatio(PR); renderer.setSize(W, H, false);
  }

  function setText(t) {
    if (!t) return;
    if (meta?.ownsText) { if (t.bitmap) scene?.setTextLayer?.(t.bitmap, t.layout); else scene?.setText?.(t); return; }
    textTex?.dispose(); textTex = null; layout = t.layout || null;
    if (t.bitmap) { textTex = new THREE.Texture(t.bitmap); textTex.flipY = false; textTex.generateMipmaps = false; textTex.minFilter = THREE.LinearFilter; textTex.needsUpdate = true; }
    ou.tText.value = textTex; ou.uHasLayer.value = textTex ? 1 : 0;
    ou.uText.value = layout?.hasText && cur?.showText !== false ? 1 : 0;
    if (layout) { ou.uBar.value.set(layout.x0, layout.y, layout.w, layout.h); ou.uGradY.value = (layout.y + 1) / 2; }
  }

  async function load(opts) {
    const { module, meta: m } = await loadScene(opts.scene);
    unload(); reset();
    const variant = pickVariant(m, opts.variant);
    cur = { quality: 'high', seed: 1, title: '', artist: '', showText: true, intensity: 0.6, ...opts, variant };
    const args = { THREE, canvas, renderer, width: W, height: H, pixelRatio: PR, variant, quality: cur.quality, seed: cur.seed | 0, title: cur.title, artist: cur.artist,
      showText: cur.showText, intensity: cur.intensity, textLayer: m.ownsText ? opts.textLayer || null : null };
    try { scene = module.createScene(args); }
    catch (e) { scene = null; meta = null; reset(); throw e; }
    if (!scene || typeof scene.render !== 'function') { scene = null; throw new Error(`scene "${opts.scene}": createScene must return {render, resize, dispose}`); }
    meta = m;
    const st = textStyle(m, variant); ou.uAccent.value.fromArray(hexRGB(st.accent));
    if (!m.ownsText && opts.textLayer) setText(opts.textLayer); else if (!m.ownsText) setText({ layout: null });
    return m;
  }
  async function setVariant(v) {
    if (!cur) return;
    const variant = pickVariant(meta, v); if (variant === cur.variant) return;
    if (scene?.setVariant) { scene.setVariant(variant); cur.variant = variant; const st = textStyle(meta, variant); ou.uAccent.value.fromArray(hexRGB(st.accent)); return; }
    await load({ ...cur, variant, textLayer: null });
  }
  function resize(w, h, pr = PR) {
    W = Math.max(2, Math.round(w)); H = Math.max(2, Math.round(h)); PR = pr;
    renderer.setPixelRatio(PR); renderer.setSize(W, H, false);
    scene?.resize?.(W, H, PR);
  }
  /** One frame. info: {duration (s, enables fades + progress), fps, frame, live}. */
  function render(t, f, info = {}) {
    if (!scene) return;
    renderer.info.reset();
    scene.render(t, f, info);
    if (meta?.ownsText) return;
    const d = info.duration || 0, show = cur?.showText !== false;
    ou.uFade.value = d > 0 ? Math.max(1 - smooth(0, 1.2, t), smooth(d - 1.6, d - 0.05, t)) : 0;
    ou.uProg.value = d > 0 ? Math.min(1, t / d) : 0;
    ou.uBarOn.value = d > 0 && show && layout && !layout.hideBar ? 1 : 0;
    ou.uText.value = show && layout?.hasText ? 1 : 0;
    if (!show) ou.uHasLayer.value = 0; else ou.uHasLayer.value = textTex ? 1 : 0;
    overlay.render(renderer, null);
  }
  function stats() {
    const i = renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, points: i.render.points, lines: i.render.lines, textures: i.memory.textures, geometries: i.memory.geometries, programs: i.programs?.length || 0 };
  }
  function unload() {
    if (scene) { try { scene.dispose(); } catch (e) { onWarn('[scene] dispose', e); } }
    scene = null; meta = null;
  }
  function dispose() { unload(); textTex?.dispose(); overlay.dispose(); disposeCached(renderer); renderer.dispose(); try { renderer.forceContextLoss(); } catch { } }

  reset();
  return {
    canvas, renderer, load, setVariant, setText, resize, render, stats, unload, dispose,
    setIntensity(v) { if (cur) cur.intensity = v; scene?.setIntensity?.(v); },
    get meta() { return meta; }, get sceneId() { return meta?.id || null; }, get variant() { return cur?.variant; }, get options() { return cur ? { ...cur, textLayer: undefined } : null; },
    get size() { return { width: W, height: H, pixelRatio: PR }; },
  };
}
