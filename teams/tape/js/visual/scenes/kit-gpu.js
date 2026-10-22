// kit-gpu.js - GPU plumbing for the scene kit: full-screen passes, baked procedural textures (noise, normal maps,
// canvas / data textures), a per-renderer texture cache and a disposal bag. Core THREE only, passed in.
import * as G from './kit-glsl.js?v=9c';

const quads = new WeakMap();   // THREE module -> {geo, cam, scene, mesh}
function quadFor(THREE) {
  let q = quads.get(THREE);
  if (!q) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));   // one big triangle
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const mesh = new THREE.Mesh(geo); mesh.frustumCulled = false;
    const scene = new THREE.Scene(); scene.add(mesh);
    q = { geo, mesh, scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
    quads.set(THREE, q);
  }
  return q;
}
export const PASS_VS = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/**
 * A full-screen pass. fragment: GLSL with `varying vec2 vUv;` available and GLSL.common + noise prepended.
 * -> {material, uniforms, render(renderer, target|null, {clear}), dispose()}. blending: THREE blending constant.
 */
export function createPass(THREE, { fragment, uniforms = {}, defines = {}, blending, prepend = G.common + G.noise } = {}) {
  const material = new THREE.ShaderMaterial({ uniforms, defines, vertexShader: PASS_VS, fragmentShader: prepend + '\nvarying vec2 vUv;\n' + fragment,
    depthTest: false, depthWrite: false, blending: blending ?? THREE.NoBlending });
  return {
    material, uniforms,
    render(renderer, target = null, { clear = false } = {}) {
      const q = quadFor(THREE), ac = renderer.autoClear;
      renderer.autoClear = false; renderer.setRenderTarget(target);
      if (clear) renderer.clear();
      q.mesh.material = material; renderer.render(q.scene, q.cam);
      renderer.autoClear = ac;
    },
    dispose() { material.dispose(); },
  };
}

/** True when the GPU can render into half-float targets (HDR). Falls back to 8-bit when not. */
export function halfFloatOK(renderer) {
  const c = renderer.capabilities;
  return c.isWebGL2 ? !!(renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'))
    : !!(renderer.extensions.has('OES_texture_half_float') && renderer.extensions.has('EXT_color_buffer_half_float'));
}

// ------------------------------------------------------------------------------------------------ cache
const caches = new WeakMap();   // renderer -> Map(key -> texture)
/**
 * Per-renderer cache: the same key returns the same texture for every scene on that renderer (preview scene switches
 * reuse noise textures). Cached textures are owned by the cache - never dispose them yourself; the host frees them
 * with disposeCached(renderer) when the renderer goes away.
 */
export function cached(renderer, key, make) {
  let m = caches.get(renderer); if (!m) caches.set(renderer, (m = new Map()));
  if (!m.has(key)) { const tex = make(); tex.userData.kitCached = true; m.set(key, tex); }
  return m.get(key);
}
export function disposeCached(renderer) {
  const m = caches.get(renderer); if (!m) return;
  for (const t of m.values()) { t.userData.kitCached = false; t.dispose(); }
  caches.delete(renderer);
}

// ------------------------------------------------------------------------------------------------ baked textures
const WRAP = THREE => ({ repeat: THREE.RepeatWrapping, clamp: THREE.ClampToEdgeWrapping, mirror: THREE.MirroredRepeatWrapping });
/**
 * Render a GLSL function into a texture once (fast, any size). fragment must define `vec4 bake(vec2 uv)` (uv 0..1);
 * GLSL.common + noise + curl are available. Values are stored as they are: write LINEAR colours for albedo maps
 * (kSrgbToLinear on sRGB picks). type 'byte' (default) | 'half' | 'float'. Returns a THREE.Texture (dispose() frees it).
 */
export function bakeTexture(THREE, renderer, { width = 512, height, fragment, uniforms = {}, type = 'byte', wrap = 'repeat', mipmaps = true, anisotropy = 8, colorSpace = 'linear' } = {}) {
  height = height || width;
  const ty = type === 'float' ? THREE.FloatType : type === 'half' && halfFloatOK(renderer) ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const rt = new THREE.WebGLRenderTarget(width, height, { type: ty, depthBuffer: false, generateMipmaps: mipmaps,
    minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: WRAP(THREE)[wrap], wrapT: WRAP(THREE)[wrap] });
  const pass = createPass(THREE, { uniforms, fragment: fragment + '\nvoid main() { gl_FragColor = bake(vUv); }', prepend: G.common + G.noise + G.curl });
  const prev = renderer.getRenderTarget();
  pass.render(renderer, rt); renderer.setRenderTarget(prev);
  pass.dispose();
  const tex = rt.texture;
  tex.anisotropy = Math.min(anisotropy, renderer.capabilities.getMaxAnisotropy());
  if (colorSpace === 'srgb') tex.colorSpace = THREE.SRGBColorSpace;
  tex.dispose = () => { rt.dispose(); };   // a render-target texture: freeing it frees the target
  tex.userData.rt = rt;
  return tex;
}

/**
 * Tileable noise texture (cached per renderer by its options). kind: 'fbm' (R,G,B,A = four independent fbm),
 * 'worley' (R=F1, G=F2, B=F2-F1 cracks, A=fbm), 'ridged', 'mix' (R fbm, G fbm, B worley F1, A ridged). scale = cells
 * across the tile (integer). Use it for albedo variation, roughness, puddle masks, cloud/mist shapes, displacement.
 */
export function noiseTexture(THREE, renderer, { size = 256, scale = 8, octaves = 5, seed = 0, kind = 'mix', type = 'byte' } = {}) {
  const key = `noise:${size}:${scale}:${octaves}:${seed}:${kind}:${type}`;
  return cached(renderer, key, () => bakeTexture(THREE, renderer, { width: size, type, uniforms: { uScale: { value: scale }, uSeed: { value: seed % 997 }, uOct: { value: octaves } },
    fragment: `uniform float uScale, uSeed; uniform int uOct;
    float fb(vec2 p, float s) { return kFbm2p(p * uScale + s * 13.7 + uSeed * 7.1, vec2(uScale), uOct); }
    float rd(vec2 p, float s) { float v = 0.0, a = 0.5, n = 0.0; vec2 q = p * uScale + s * 5.3 + uSeed; vec2 per = vec2(uScale);
      for (int i = 0; i < 8; i++) { if (i >= uOct) break; float r = 1.0 - abs(kPerlin2p(q, per)); v += a * r * r; n += a; q *= 2.0; per *= 2.0; a *= 0.5; } return v / n; }
    vec4 bake(vec2 uv) {
      ${kind === 'fbm' ? 'return vec4(fb(uv, 0.0), fb(uv, 1.0), fb(uv, 2.0), fb(uv, 3.0));'
        : kind === 'worley' ? 'vec2 w = kWorley2p(uv * uScale + uSeed * 0.0, vec2(uScale)); return vec4(w.x, w.y, clamp((w.y - w.x) * 2.0, 0.0, 1.0), fb(uv, 1.0));'
        : kind === 'ridged' ? 'return vec4(rd(uv, 0.0), rd(uv, 1.0), rd(uv, 2.0), rd(uv, 3.0));'
        : 'vec2 w = kWorley2p(uv * uScale, vec2(uScale)); return vec4(fb(uv, 0.0), fb(uv, 1.0), w.x, rd(uv, 2.0));'}
    }` }));
}

/** Tangent-space normal map (OpenGL convention, +Y up) from one channel of a height texture. Same size as the source. */
export function normalMapFromHeight(THREE, renderer, height, { strength = 2, channel = 'r', size } = {}) {
  const w = size || height.image?.width || 512, h = size || height.image?.height || w;
  const tex = bakeTexture(THREE, renderer, { width: w, height: h, uniforms: { tH: { value: height }, uTexel: { value: new THREE.Vector2(1 / w, 1 / h) }, uStrength: { value: strength } },
    fragment: `uniform sampler2D tH; uniform vec2 uTexel; uniform float uStrength;
    float H(vec2 uv) { return texture2D(tH, uv).${channel}; }
    vec4 bake(vec2 uv) { float l = H(uv - vec2(uTexel.x, 0.0)), r = H(uv + vec2(uTexel.x, 0.0)), d = H(uv - vec2(0.0, uTexel.y)), u = H(uv + vec2(0.0, uTexel.y));
      vec3 n = normalize(vec3((l - r) * uStrength, (d - u) * uStrength, 1.0)); return vec4(n * 0.5 + 0.5, 1.0); }` });
  return tex;
}

/** A 2D-canvas texture (OffscreenCanvas in workers). draw(ctx, w, h) once. srgb = true for colour art. */
export function canvasTexture(THREE, w, h, draw, { srgb = true, mipmaps = true } = {}) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = mipmaps; tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  return tex;
}

/** CPU data texture: fn(x, y) -> [r, g, b, a] in 0..1 (byte) or any float (float). For small LUTs and masks. */
export function dataTexture(THREE, w, h, fn, { type = 'byte', wrap = 'clamp', filter = 'linear' } = {}) {
  const f = type === 'float', data = f ? new Float32Array(w * h * 4) : new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y), i = (y * w + x) * 4;
    for (let k = 0; k < 4; k++) data[i + k] = f ? (v[k] ?? 1) : Math.max(0, Math.min(255, Math.round((v[k] ?? 1) * 255)));
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, f ? THREE.FloatType : THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = WRAP(THREE)[wrap]; tex.magFilter = tex.minFilter = filter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------------------------------------------ disposal
/**
 * A bag of GPU things to free together. bag.add(x) returns x; x may be a geometry, material, texture, render target,
 * anything with dispose(), or an Object3D (its geometries, materials and their textures are freed). Cached textures are
 * skipped. bag.dispose() frees everything once.
 */
export function createBag() {
  const items = new Set();
  const freeMaterial = m => {
    for (const k in m) { const v = m[k]; if (v && v.isTexture && !v.userData?.kitCached) v.dispose(); }
    if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k]?.value; if (v && v.isTexture && !v.userData?.kitCached && !v.userData?.kitShared) v.dispose(); }
    m.dispose();
  };
  const free = x => {
    if (!x) return;
    if (x.isObject3D) { x.traverse(o => { o.geometry?.dispose?.(); const m = o.material; if (Array.isArray(m)) m.forEach(freeMaterial); else if (m) freeMaterial(m); if (o.isInstancedMesh) o.dispose?.(); }); return; }
    if (x.isMaterial) return freeMaterial(x);
    if (x.isTexture && x.userData?.kitCached) return;
    x.dispose?.();
  };
  return { add(x) { items.add(x); return x; }, dispose() { for (const x of items) { try { free(x); } catch (e) { console.warn('[kit] dispose', e); } } items.clear(); } };
}
