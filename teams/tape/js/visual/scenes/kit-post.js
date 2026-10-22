// kit-post.js - the filmic post chain, written from scratch (core THREE only): HDR scene target (MSAA + depth), bloom on
// a proper mip chain (13-tap Karis prefilter + soft knee, tent upsample, energy-normalised), optional depth-of-field-lite,
// sun light shafts and lens dirt, white balance / tint / saturation / contrast / lift-gamma-gain, ACES or AgX, natural
// vignette, subtle chromatic aberration, resolution-independent film grain, dither (no banding in H.264), letterbox.
import * as G from './kit-glsl.js?v=9e';
import { createPass, halfFloatOK, bakeTexture, cached } from './kit-gpu.js?v=9e';

const DOWN_FS = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold, uKnee, uClamp;
vec3 S(vec2 o) { return min(texture2D(tSrc, vUv + uTexel * o).rgb, vec3(uClamp)); }
#ifdef FIRST
vec4 karis(vec3 a, vec3 b, vec3 c, vec3 d, float w) { vec3 m = (a + b + c + d) * 0.25; w /= 1.0 + kLuma(m); return vec4(m * w, w); }
#endif
void main() {
  vec3 a = S(vec2(-2, 2)), b = S(vec2(0, 2)), c = S(vec2(2, 2)), d = S(vec2(-2, 0)), e = S(vec2(0)), f = S(vec2(2, 0));
  vec3 g = S(vec2(-2, -2)), h = S(vec2(0, -2)), i = S(vec2(2, -2)), j = S(vec2(-1, 1)), k = S(vec2(1, 1)), l = S(vec2(-1, -1)), m = S(vec2(1, -1));
#ifdef FIRST
  // Karis average per group kills fireflies (single hot pixels that would flicker), then the soft threshold
  vec4 acc = karis(j, k, l, m, 0.5) + karis(a, b, d, e, 0.125) + karis(b, c, e, f, 0.125) + karis(d, e, g, h, 0.125) + karis(e, f, h, i, 0.125);
  vec3 col = acc.rgb / acc.a;
  float br = max(col.r, max(col.g, col.b));
  float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee); rq = rq * rq / (4.0 * uKnee + 1e-4);
  col *= max(rq, br - uThreshold) / max(br, 1e-4);
#else
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
#endif
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;
const UP_FS = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uRadius, uWeight;
vec3 S(vec2 o) { return texture2D(tSrc, vUv + uTexel * o * uRadius).rgb; }
void main() {
  vec3 s = S(vec2(-1, 1)) + S(vec2(0, 1)) * 2.0 + S(vec2(1, 1)) + S(vec2(-1, 0)) * 2.0 + S(vec2(0)) * 4.0 + S(vec2(1, 0)) * 2.0 + S(vec2(-1, -1)) + S(vec2(0, -1)) * 2.0 + S(vec2(1, -1));
  gl_FragColor = vec4(s / 16.0 * uWeight, 1.0);
}`;
const RAYMASK_FS = /* glsl */`
uniform sampler2D tSrc, tDepth; uniform vec2 uSun, uAspect2; uniform float uClamp;
void main() {
  float sky = step(0.9999995, texture2D(tDepth, vUv).r);
  vec3 c = min(texture2D(tSrc, vUv).rgb, vec3(uClamp));
  vec2 d = (vUv - uSun) * uAspect2; float w = exp(-dot(d, d) * 9.0);
  gl_FragColor = vec4(c * sky * (0.25 + w), 1.0);
}`;
const RAYBLUR_FS = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uSun; uniform float uDensity, uDecay;
void main() {
  vec2 d = (vUv - uSun) * uDensity / 48.0; vec2 uv = vUv; vec3 acc = vec3(0.0); float w = 1.0, n = 0.0;
  float j = kHash12(gl_FragCoord.xy) * 0.9;
  uv -= d * j;
  for (int i = 0; i < 48; i++) { uv -= d; acc += texture2D(tSrc, uv).rgb * w; n += w; w *= uDecay; }
  gl_FragColor = vec4(acc / n, 1.0);
}`;
const COMPOSITE_FS = /* glsl */`
uniform sampler2D tScene, tBloom, tDepth, tDirt, tBlurA, tBlurB, tRays;
uniform vec2 uResolution, uNearFar; uniform float uTime, uExposure, uBloom, uBloomNorm, uDirt, uVignette, uAberration, uGrain, uGrainSize, uContrast, uRays, uLetterbox, uAspect;
uniform vec4 uDof; uniform mat3 uColorMat; uniform vec3 uLift, uGamma, uGain;
float viewDist(float d) { float n = uNearFar.x, f = uNearFar.y; return (n * f) / (f - d * (f - n)); }
void main() {
  vec2 uv = vUv;
  vec3 col;
#ifdef CA
  vec2 off = (uv - 0.5) * uAberration * dot(uv - 0.5, uv - 0.5) * 4.0;
  col = vec3(texture2D(tScene, uv - off).r, texture2D(tScene, uv).g, texture2D(tScene, uv + off).b);
#else
  col = texture2D(tScene, uv).rgb;
#endif
#ifdef DOF
  float z = viewDist(texture2D(tDepth, uv).r);
  float coc = clamp((abs(z - uDof.x) - uDof.y * 0.5) / max(uDof.x * 0.75, 0.01), 0.0, 1.0) * uDof.z;
  col = mix(col, texture2D(tBlurA, uv).rgb, smoothstep(0.0, 0.45, coc));
  col = mix(col, texture2D(tBlurB, uv).rgb, smoothstep(0.45, 1.0, coc));
#endif
  vec3 bloom = texture2D(tBloom, uv).rgb * uBloomNorm;
  col = mix(col, bloom, uBloom);
#ifdef DIRT
  vec2 duv = (uv - 0.5) * vec2(max(uAspect, 1.0), max(1.0 / uAspect, 1.0)) * 0.8 + 0.5;
  col += bloom * texture2D(tDirt, duv).rgb * uDirt;
#endif
#ifdef RAYS
  col += texture2D(tRays, uv).rgb * uRays;
#endif
  col = max(uColorMat * (col * uExposure), 0.0);
  col = 0.18 * pow(col / 0.18 + 1e-7, vec3(uContrast));
  vec2 vp = (uv - 0.5) * vec2(uAspect, 1.0) / (0.5 * length(vec2(uAspect, 1.0)));
  float r2 = dot(vp, vp); col *= mix(1.0, 1.0 / ((1.0 + 0.55 * r2) * (1.0 + 0.55 * r2)), uVignette);   // cos^4-like natural falloff
#ifdef AGX
  col = kAgX(col);
#else
  col = kACES(col);
#endif
  col = uGain * (col + uLift * (1.0 - col));
  col = pow(max(col, 0.0), 1.0 / uGamma);
  vec3 s = kLinearToSrgb(col);
  // film grain: cell size follows the frame height (looks the same at 720p and 4K), strongest in the mid-tones
  float gs = max(uGrainSize * uResolution.y / 1080.0, 1.0);
  vec2 gp = gl_FragCoord.xy / gs, o = kHash21(floor(uTime * 60.0 + 0.5)) * 517.0;
  float n = (kValue2(gp + o) + 0.5 * kValue2(gp * 2.13 + o.yx)) / 1.5 - 0.5;
  float l = kLuma(s); s += n * uGrain * (0.3 + 2.8 * l * (1.0 - l));
  s += (kHash12(gl_FragCoord.xy + o) + kHash12(gl_FragCoord.xy * 1.37 + o.yx) - 1.0) / 255.0;
  if (abs(uv.y - 0.5) > 0.5 - uLetterbox) s = vec3(0.0);
  gl_FragColor = vec4(s, 1.0);
}`;
const DIRT_FS = /* glsl */`
vec4 bake(vec2 uv) {
  vec3 acc = vec3(0.0);
  for (int layer = 0; layer < 3; layer++) {
    float sc = 5.0 + float(layer) * 6.0; vec2 p = uv * sc; vec2 c = floor(p);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 cell = c + vec2(float(x), float(y)); vec4 h = kHash42(cell + float(layer) * 31.7);
      if (h.w < 0.45) continue;
      vec2 q = p - (cell + h.xy); float r = (0.12 + 0.38 * h.z) * (1.0 - float(layer) * 0.22);
      float dd = length(q) / r; float disk = smoothstep(1.0, 0.82, dd) * (0.55 + 0.45 * smoothstep(0.55, 0.95, dd));   // bokeh-like: brighter rim
      acc += disk * (0.25 + 0.75 * h.w) * mix(vec3(1.0, 0.95, 0.85), vec3(0.85, 0.95, 1.0), h.z) * (1.0 - float(layer) * 0.25);
    }
  }
  float smudge = kFbm2(uv * vec2(3.0, 9.0) + 4.0, 5); smudge = smoothstep(0.55, 0.8, smudge) * 0.6;
  float specks = step(0.9965, kHash12(floor(uv * 900.0))) * 0.8;
  return vec4(acc * 0.6 + smudge + specks, 1.0);
}`;

/** Quality presets the post chain (and scenes) use. */
export const POST_Q = {
  light: { msaa: 0, bloomMips: 5, dof: false, rays: false, dirt: true, ca: false, grain: 0.022 },
  high: { msaa: 4, bloomMips: 7, dof: true, rays: true, dirt: true, ca: true, grain: 0.03 },
  ultra: { msaa: 4, bloomMips: 8, dof: true, rays: true, dirt: true, ca: true, grain: 0.03 },
};

/** The grade defaults (every field may be changed per frame on post.grade). */
export function defaultGrade() {
  return {
    exposure: 1, tonemap: 'aces', temperature: 0, tint: 0, saturation: 1, contrast: 1,
    lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
    bloom: { strength: 0.06, threshold: 0, knee: 0.5, radius: 1 },
    dirt: 0.15, vignette: 0.35, aberration: 0.0025, grain: null, grainSize: 1.6, letterbox: 0,
    dof: { focus: 10, range: 6, strength: 0 },
    rays: { strength: 0, density: 0.9, decay: 0.965 },
  };
}

// white balance (LMS, like Unity's) * saturation, as one 3x3 matrix
function colorMatrix(THREE, out, temperature, tint, sat) {
  const t1 = temperature * 10 / 6, t2 = tint * 10 / 6;
  const x = 0.31271 - t1 * (t1 < 0 ? 0.1 : 0.05), y = 2.87 * x - 3 * x * x - 0.27509507 + t2 * 0.05;
  const X = x / y, Y = 1, Z = (1 - x - y) / y;
  const L = 0.7328 * X + 0.4296 * Y - 0.1624 * Z, M = -0.7036 * X + 1.6975 * Y + 0.0061 * Z, S = 0.0030 * X + 0.0136 * Y + 0.9834 * Z;
  const b = [0.949237 / L, 1.03542 / M, 1.08728 / S];
  const toLMS = new THREE.Matrix3().set(0.390405, 0.549941, 0.00892632, 0.0708416, 0.963172, 0.00135775, 0.0231082, 0.128021, 0.936245);
  const toLin = new THREE.Matrix3().set(2.85847, -1.62879, -0.024891, -0.210182, 1.1582, 0.000324281, -0.041812, -0.118169, 1.06867);
  const D = new THREE.Matrix3().set(b[0], 0, 0, 0, b[1], 0, 0, 0, b[2]);
  const lr = 0.2126 * (1 - sat), lg = 0.7152 * (1 - sat), lb = 0.0722 * (1 - sat);
  const Sm = new THREE.Matrix3().set(lr + sat, lg, lb, lr, lg + sat, lb, lr, lg, lb + sat);
  return out.copy(Sm).multiply(toLin).multiply(D).multiply(toLMS);
}

/**
 * createPost(THREE, renderer, {width, height, pixelRatio, quality, dof, rays, dirt, ca, msaa, tonemap})
 *   width/height are CSS-size numbers; buffers are width*pixelRatio x height*pixelRatio (what the renderer draws).
 * -> { grade, target, depthTexture, begin(), end(camera, t), render(scene, camera, t), setSun(dirWorld, camera),
 *      resize(w, h, pr), dispose() }
 * Typical frame:  mirror?.update(scene, camera); post.setSun(sky.sunDir, camera); post.render(scene, camera, t);
 */
export function createPost(THREE, renderer, { width, height, pixelRatio = 1, quality = 'high', dof, rays, dirt, ca, msaa, tonemap = 'aces' } = {}) {
  const Q = POST_Q[quality] || POST_Q.high;
  const useDof = dof ?? Q.dof, useRays = rays ?? Q.rays, useDirt = dirt ?? Q.dirt, useCA = ca ?? Q.ca;
  const gl2 = renderer.capabilities.isWebGL2, hf = halfFloatOK(renderer), TYPE = hf ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const samples = gl2 ? (msaa ?? Q.msaa) : 0, needDepth = useDof || useRays;
  const grade = defaultGrade(); grade.tonemap = tonemap; grade.grain = Q.grain;
  const rtOpts = { type: TYPE, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, generateMipmaps: false };
  let W = 1, H = 1;
  const depthTexture = needDepth ? new THREE.DepthTexture(1, 1, THREE.UnsignedIntType) : null;
  const target = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: true, samples, depthTexture });
  const mips = [], blurA = useDof ? new THREE.WebGLRenderTarget(1, 1, rtOpts) : null, blurB = useDof ? new THREE.WebGLRenderTarget(1, 1, rtOpts) : null;
  const raysA = useRays ? new THREE.WebGLRenderTarget(1, 1, rtOpts) : null, raysB = useRays ? new THREE.WebGLRenderTarget(1, 1, rtOpts) : null;
  const down0 = createPass(THREE, { fragment: DOWN_FS, defines: { FIRST: 1 }, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0 }, uKnee: { value: 0.5 }, uClamp: { value: 256 } } });
  const down = createPass(THREE, { fragment: DOWN_FS, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0 }, uKnee: { value: 0.5 }, uClamp: { value: 65000 } } });
  const up = createPass(THREE, { fragment: UP_FS, blending: THREE.AdditiveBlending, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 }, uWeight: { value: 1 } } });
  const rayMask = useRays ? createPass(THREE, { fragment: RAYMASK_FS, uniforms: { tSrc: { value: target.texture }, tDepth: { value: depthTexture }, uSun: { value: new THREE.Vector2(0.5, 0.8) }, uAspect2: { value: new THREE.Vector2(1, 1) }, uClamp: { value: 40 } } }) : null;
  const rayBlur = useRays ? createPass(THREE, { fragment: RAYBLUR_FS, uniforms: { tSrc: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.8) }, uDensity: { value: 0.9 }, uDecay: { value: 0.965 } } }) : null;
  const dirtTex = useDirt ? cached(renderer, 'kit:lensdirt', () => bakeTexture(THREE, renderer, { width: quality === 'light' ? 512 : 1024, fragment: DIRT_FS, wrap: 'mirror' })) : null;
  const defines = {}; if (useDof) defines.DOF = 1; if (useRays) defines.RAYS = 1; if (useDirt) defines.DIRT = 1; if (useCA) defines.CA = 1;
  const cu = {
    tScene: { value: target.texture }, tBloom: { value: null }, tDepth: { value: depthTexture }, tDirt: { value: dirtTex }, tBlurA: { value: blurA?.texture || null }, tBlurB: { value: blurB?.texture || null },
    tRays: { value: raysB?.texture || null }, uResolution: { value: new THREE.Vector2(1, 1) }, uNearFar: { value: new THREE.Vector2(0.1, 1000) }, uTime: { value: 0 },
    uExposure: { value: 1 }, uBloom: { value: 0.06 }, uBloomNorm: { value: 1 }, uDirt: { value: 0.25 }, uVignette: { value: 0.35 }, uAberration: { value: 0.0025 },
    uGrain: { value: 0.03 }, uGrainSize: { value: 1.6 }, uContrast: { value: 1 }, uRays: { value: 0 }, uLetterbox: { value: 0 }, uAspect: { value: 1 },
    uDof: { value: new THREE.Vector4(10, 6, 0, 0) }, uColorMat: { value: new THREE.Matrix3() }, uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
  };
  const comps = {};
  const composite = tm => comps[tm] || (comps[tm] = createPass(THREE, { fragment: COMPOSITE_FS, uniforms: cu, defines: { ...defines, ...(tm === 'agx' ? { AGX: 1 } : {}) }, prepend: G.common + G.noise + G.tonemap }));
  const sunUV = new THREE.Vector2(0.5, 0.8), v3 = new THREE.Vector3();
  let sunVis = 0, cmKey = '';

  function resize(w, h, pr = 1) {
    W = Math.max(1, Math.round(w * pr)); H = Math.max(1, Math.round(h * pr));
    target.setSize(W, H);
    for (const m of mips) m.dispose(); mips.length = 0;
    let mw = W >> 1, mh = H >> 1;
    for (let i = 0; i < Q.bloomMips && mw >= 4 && mh >= 4; i++) { const r = new THREE.WebGLRenderTarget(mw, mh, rtOpts); mips.push(r); mw >>= 1; mh >>= 1; }
    if (!mips.length) mips.push(new THREE.WebGLRenderTarget(Math.max(1, W >> 1), Math.max(1, H >> 1), rtOpts));
    blurA?.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1)); blurB?.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    raysA?.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2)); raysB?.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    cu.uResolution.value.set(W, H); cu.uAspect.value = W / H; cu.tBloom.value = mips[0].texture; cu.uBloomNorm.value = 1 / mips.length;
    rayMask?.uniforms.uAspect2.value.set(W / H, 1);
  }

  function begin() { renderer.setRenderTarget(target); renderer.clear(); }

  /** Where the sun is on screen (call each frame before end/render when using rays). dirWorld: unit vector to the sun. */
  function setSun(dirWorld, camera) {
    v3.copy(dirWorld).multiplyScalar(1e4).add(camera.getWorldPosition(new THREE.Vector3())).project(camera);
    const inFront = v3.z < 1 && dirWorld.dot(camera.getWorldDirection(new THREE.Vector3())) > 0;
    sunUV.set(v3.x * 0.5 + 0.5, v3.y * 0.5 + 0.5);
    const edge = Math.max(Math.abs(v3.x), Math.abs(v3.y));
    sunVis = inFront ? Math.max(0, Math.min(1, (1.6 - edge) / 0.6)) * Math.max(0, Math.min(1, dirWorld.y * 12 + 0.4)) : 0;
  }

  function end(camera, t = 0) {
    const g = grade, ac = renderer.autoClear;
    renderer.autoClear = false;
    // bloom: prefilter + down chain, then tent upsample adding each level into the one above
    down0.uniforms.tSrc.value = target.texture; down0.uniforms.uTexel.value.set(1 / W, 1 / H);
    down0.uniforms.uThreshold.value = g.bloom.threshold; down0.uniforms.uKnee.value = Math.max(1e-4, g.bloom.threshold * g.bloom.knee);
    down0.render(renderer, mips[0]);
    for (let i = 1; i < mips.length; i++) { down.uniforms.tSrc.value = mips[i - 1].texture; down.uniforms.uTexel.value.set(1 / mips[i - 1].width, 1 / mips[i - 1].height); down.render(renderer, mips[i]); }
    up.uniforms.uRadius.value = g.bloom.radius;
    for (let i = mips.length - 2; i >= 0; i--) { up.uniforms.tSrc.value = mips[i + 1].texture; up.uniforms.uTexel.value.set(1 / mips[i + 1].width, 1 / mips[i + 1].height); up.render(renderer, mips[i]); }
    // depth of field-lite: half and quarter resolution blurs of the scene, mixed by circle of confusion
    const dofOn = useDof && g.dof.strength > 0;
    if (useDof) {
      down.uniforms.tSrc.value = target.texture; down.uniforms.uTexel.value.set(1 / W, 1 / H); down.render(renderer, blurA);
      down.uniforms.tSrc.value = blurA.texture; down.uniforms.uTexel.value.set(1 / blurA.width, 1 / blurA.height); down.render(renderer, blurB);
    }
    // light shafts from the visible sky around the sun
    const raysOn = useRays && g.rays.strength > 0 && sunVis > 0;
    if (raysOn) {
      rayMask.uniforms.uSun.value.copy(sunUV); rayMask.render(renderer, raysA);
      rayBlur.uniforms.tSrc.value = raysA.texture; rayBlur.uniforms.uSun.value.copy(sunUV); rayBlur.uniforms.uDensity.value = g.rays.density; rayBlur.uniforms.uDecay.value = g.rays.decay;
      rayBlur.render(renderer, raysB);
    }
    // composite
    const key = `${g.temperature}|${g.tint}|${g.saturation}`;
    if (key !== cmKey) { colorMatrix(THREE, cu.uColorMat.value, g.temperature, g.tint, g.saturation); cmKey = key; }
    cu.uTime.value = t; cu.uExposure.value = g.exposure; cu.uBloom.value = g.bloom.strength; cu.uDirt.value = g.dirt; cu.uVignette.value = g.vignette;
    cu.uAberration.value = g.aberration; cu.uGrain.value = g.grain ?? Q.grain; cu.uGrainSize.value = g.grainSize; cu.uContrast.value = g.contrast;
    cu.uRays.value = raysOn ? g.rays.strength * sunVis : 0; cu.uLetterbox.value = g.letterbox;
    cu.uLift.value.fromArray(g.lift); cu.uGamma.value.fromArray(g.gamma); cu.uGain.value.fromArray(g.gain);
    cu.uDof.value.set(g.dof.focus, g.dof.range, dofOn ? g.dof.strength : 0, 0);
    if (camera) cu.uNearFar.value.set(camera.near, camera.far);
    if (!raysOn && useRays) cu.uRays.value = 0;
    composite(g.tonemap === 'agx' ? 'agx' : 'aces').render(renderer, null);
    renderer.autoClear = ac;
  }

  function render(scene, camera, t = 0) { begin(); renderer.render(scene, camera); end(camera, t); }

  function dispose() {
    target.dispose(); depthTexture?.dispose(); for (const m of mips) m.dispose(); blurA?.dispose(); blurB?.dispose(); raysA?.dispose(); raysB?.dispose();
    down0.dispose(); down.dispose(); up.dispose(); rayMask?.dispose(); rayBlur?.dispose(); for (const k in comps) comps[k].dispose();
  }

  resize(width, height, pixelRatio);
  return { grade, target, depthTexture, begin, end, render, setSun, resize, dispose, get size() { return { width: W, height: H }; }, get sunScreen() { return { uv: sunUV.clone(), visible: sunVis }; } };
}
