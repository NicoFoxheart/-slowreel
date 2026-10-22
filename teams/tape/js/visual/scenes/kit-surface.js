// kit-surface.js - reflective surfaces: a planar mirror (reflected camera with an oblique near plane, ported from the
// idea of three's Reflector without importing it), a water material (scrolling normal-map waves + optional Gerstner
// swell, Fresnel, mirror or sky reflection, sun glitter, subsurface tint, rain ripples, fog), a "wet" patch for three's
// PBR materials (darker porous albedo, glossy puddles with ripples and mirror reflections), and a heightfield helper.
import * as G from './kit-glsl.js?v=10';
import { halfFloatOK, noiseTexture, normalMapFromHeight, cached } from './kit-gpu.js?v=10';

/**
 * createMirror(THREE, renderer, {y = 0, resolution = 0.5, quality}) - renders the scene mirrored in the plane y = y.
 * -> { texture, matrix (Matrix4: world -> mirror uv, use as uMirrorMatrix), uniforms ({uMirror, uMirrorMatrix}),
 *      update(scene, camera, {hide: [objects]}), resize(w, h, pr), dispose() }
 * Call update() BEFORE post.render() each frame (it changes the render target). Hide the water/ground itself.
 * Cost: one extra scene render at `resolution` x the frame size - use 0.35 on 'light', 0.5 on 'high', 0.75 on 'ultra'.
 */
export function createMirror(THREE, renderer, { y = 0, resolution, quality = 'high', width = 1280, height = 720, pixelRatio = 1 } = {}) {
  const res = resolution ?? ({ light: 0.35, high: 0.5, ultra: 0.75 }[quality] || 0.5);
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: halfFloatOK(renderer) ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: true, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  rt.texture.userData.kitShared = true;
  const vcam = new THREE.PerspectiveCamera(), matrix = new THREE.Matrix4();
  const normal = new THREE.Vector3(0, 1, 0), planePoint = new THREE.Vector3(0, y, 0), camPos = new THREE.Vector3(), view = new THREE.Vector3(), target = new THREE.Vector3();
  const rot = new THREE.Matrix4(), look = new THREE.Vector3(), plane = new THREE.Plane(), clip = new THREE.Vector4(), qv = new THREE.Vector4();
  const uniforms = { uMirror: { value: rt.texture }, uMirrorMatrix: { value: matrix }, uMirrorOn: { value: 0 } };
  function resize(w, h, pr = 1) { rt.setSize(Math.max(2, Math.round(w * pr * res)), Math.max(2, Math.round(h * pr * res))); }
  function update(scene, camera, { hide = [], clipBias = 0.002 } = {}) {
    planePoint.set(0, y, 0);
    camPos.setFromMatrixPosition(camera.matrixWorld);
    view.subVectors(planePoint, camPos);
    if (view.dot(normal) > 0) { uniforms.uMirrorOn.value = 0; return; }   // camera under the plane: no reflection
    uniforms.uMirrorOn.value = 1;
    view.reflect(normal).negate().add(planePoint);
    rot.extractRotation(camera.matrixWorld); look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    target.subVectors(planePoint, look).reflect(normal).negate().add(planePoint);
    vcam.position.copy(view); vcam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal); vcam.lookAt(target);
    vcam.near = camera.near; vcam.far = camera.far; vcam.updateMatrixWorld();
    vcam.projectionMatrix.copy(camera.projectionMatrix);
    matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);
    // oblique near plane = the mirror plane (nothing under the water is reflected)
    plane.setFromNormalAndCoplanarPoint(normal, planePoint).applyMatrix4(vcam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = vcam.projectionMatrix.elements;
    qv.set((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    clip.multiplyScalar(2 / clip.dot(qv));
    e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1 - clipBias; e[14] = clip.w;
    vcam.projectionMatrixInverse.copy(vcam.projectionMatrix).invert();
    const vis = hide.map(o => o.visible); hide.forEach(o => { o.visible = false; });
    const prev = renderer.getRenderTarget(), ac = renderer.autoClear;
    renderer.setRenderTarget(rt); renderer.autoClear = true; renderer.render(scene, vcam);
    renderer.setRenderTarget(prev); renderer.autoClear = ac;
    hide.forEach((o, i) => { o.visible = vis[i]; });
  }
  resize(width, height, pixelRatio);
  return { texture: rt.texture, matrix, uniforms, camera: vcam, update, resize, dispose() { rt.dispose(); } };
}

const WATER_VS = /* glsl */`
uniform float uTime, uSwell; uniform vec4 uWaves[4];
varying vec3 vWorld; varying vec3 vSwellN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  // Gerstner swell (dir.xy, steepness, wavelength)
  for (int i = 0; i < 4; i++) {
    vec4 wv = uWaves[i]; if (wv.w <= 0.0 || uSwell <= 0.0) continue;
    float k = 6.2831853 / wv.w, c = sqrt(9.81 / k), a = wv.z / k * uSwell; vec2 d = normalize(wv.xy);
    float f = k * (dot(d, w.xz) - c * uTime);
    w.x += d.x * a * cos(f); w.z += d.y * a * cos(f); w.y += a * sin(f);
    n.x -= d.x * k * a * cos(f); n.z -= d.y * k * a * cos(f); n.y -= wv.z * uSwell * sin(f);
  }
  vWorld = w.xyz; vSwellN = normalize(n);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const WATER_FS = /* glsl */`
uniform sampler2D uNormal, uMirror; uniform mat4 uMirrorMatrix; uniform float uMirrorOn;
uniform float uTime, uRough, uDistort, uRain, uWaveScale, uWaveSpeed, uWaveStrength, uRippleLayers, uSunSpec, uOpacityNear;
uniform vec3 uDeep, uShallow, uSunDir2, uSunCol2, uSkyTint;
varying vec3 vWorld; varying vec3 vSwellN;
vec3 nmap(vec2 uv) { return texture2D(uNormal, uv).xyz * 2.0 - 1.0; }
void main() {
  vec2 p = vWorld.xz;
  vec2 s = vec2(uTime * uWaveSpeed);
  vec3 n1 = nmap(p * 0.06 * uWaveScale + s * vec2(0.021, 0.013)), n2 = nmap(p * 0.13 * uWaveScale - s * vec2(0.017, -0.026));
  vec3 n3 = nmap(p * 0.37 * uWaveScale + s * vec2(-0.05, 0.034)), n4 = nmap(p * 0.9 * uWaveScale - s * vec2(0.08, 0.06));
  vec2 g = (n1.xy + n2.xy * 0.8 + n3.xy * 0.5 + n4.xy * 0.3) * uWaveStrength;
  if (uRain > 0.0) g += kRipples(p, uTime, uRain, int(uRippleLayers)) * 1.6;
  vec3 N = normalize(vSwellN + vec3(g.x, 0.0, g.y));
  vec3 V = normalize(cameraPosition - vWorld); float dist = length(cameraPosition - vWorld);
  float NdV = max(dot(N, V), 0.0);
  float F = kFresnel(NdV, 0.02);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 refl = texture2D(uSkyLut, kFogSkyUV(R)).rgb * uSkyTint;
  if (uMirrorOn > 0.5) {
    vec4 mc = uMirrorMatrix * vec4(vWorld, 1.0); vec2 muv = mc.xy / mc.w + N.xz * uDistort / (1.0 + dist * 0.05);
    vec3 m = texture2D(uMirror, muv).rgb;
    refl = mix(refl, m, smoothstep(0.0, 0.03, muv.x) * smoothstep(1.0, 0.97, muv.x) * smoothstep(0.0, 0.03, muv.y) * smoothstep(1.0, 0.97, muv.y));
  }
  // sun glitter: GGX highlight on the rippled normal
  vec3 H = normalize(V + uSunDir2); float NdH = max(dot(N, H), 0.0), a2 = uRough * uRough * uRough * uRough;
  float D = a2 / (3.14159 * pow(NdH * NdH * (a2 - 1.0) + 1.0, 2.0));
  vec3 spec = uSunCol2 * D * F * max(dot(N, uSunDir2), 0.0) * uSunSpec;
  // body: deep colour, lighter where waves face the sun (subsurface)
  float sss = pow(max(dot(V, -uSunDir2) * 0.5 + 0.5, 0.0), 4.0) * max(g.x * uSunDir2.x + g.y * uSunDir2.z + 0.2, 0.0);
  vec3 body = mix(uDeep, uShallow, clamp(sss * 2.0, 0.0, 1.0)) * (texture2D(uSkyLut, kFogSkyUV(vec3(0.0, 1.0, 0.0))).rgb * 1.5 + uSunCol2 * max(uSunDir2.y, 0.0) * 0.15);
  vec3 col = mix(body, refl, F) + spec;
  col = kFog(col, vWorld, cameraPosition);
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * createWater(THREE, renderer, {size = 400, segments, sky, mirror, quality, deep, shallow, roughness, waves, swell, rain})
 *   sky: from createSky (needed: reflections + fog). mirror: from createMirror (optional: scene reflections).
 *   waves: up to 4 Gerstner waves [[dirX, dirZ, steepness 0..0.3, wavelength m], ...] used when swell > 0 (needs segments).
 * -> { mesh, uniforms, update(t, {rain, sunDir, sunColor}), dispose() }   (uniforms are live: uWaveStrength, uRough...)
 */
export function createWater(THREE, renderer, { size = 400, segments, sky, mirror = null, quality = 'high', deep = [0.004, 0.018, 0.03], shallow = [0.02, 0.09, 0.1], roughness = 0.12,
  waves = [[1, 0.3, 0.12, 22], [0.7, -0.6, 0.08, 9], [-0.2, 1, 0.06, 5.5], [0.4, 0.9, 0.04, 3]], swell = 0, rain = 0, waveScale = 1, waveSpeed = 1, waveStrength = 0.35 } = {}) {
  const seg = segments ?? (swell > 0 ? ({ light: 128, high: 256, ultra: 384 }[quality] || 256) : 1);
  const geo = new THREE.PlaneGeometry(size, size, seg, seg); geo.rotateX(-Math.PI / 2);
  const h = noiseTexture(THREE, renderer, { size: quality === 'light' ? 256 : 512, scale: 8, octaves: 5, kind: 'fbm', seed: 3 });
  const nrm = cached(renderer, `kit:waternormal:${quality}`, () => normalMapFromHeight(THREE, renderer, h, { strength: 6 }));
  const uniforms = {
    ...(sky ? sky.fog.uniforms : {}), uNormal: { value: nrm }, uMirror: { value: mirror ? mirror.texture : null }, uMirrorMatrix: { value: mirror ? mirror.matrix : new THREE.Matrix4() },
    uMirrorOn: mirror ? mirror.uniforms.uMirrorOn : { value: 0 },
    uTime: { value: 0 }, uSwell: { value: swell }, uWaves: { value: [0, 1, 2, 3].map(i => new THREE.Vector4(...(waves[i] || [1, 0, 0, 0]))) },
    uRough: { value: roughness }, uDistort: { value: 0.06 }, uRain: { value: rain }, uWaveScale: { value: waveScale }, uWaveSpeed: { value: waveSpeed }, uWaveStrength: { value: waveStrength },
    uRippleLayers: { value: quality === 'light' ? 1 : 2 }, uSunSpec: { value: 1 }, uOpacityNear: { value: 1 },
    uDeep: { value: new THREE.Vector3(...deep) }, uShallow: { value: new THREE.Vector3(...shallow) }, uSunDir2: { value: new THREE.Vector3(0, 1, 0) }, uSunCol2: { value: new THREE.Vector3(1, 1, 1) },
    uSkyTint: { value: new THREE.Vector3(1, 1, 1) },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: WATER_VS, fragmentShader: G.common + G.noise + G.fog + G.ripples + WATER_FS });
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'kit-water'; mesh.frustumCulled = false;
  function update(t, { rain: r, sunDir, sunColor } = {}) {
    uniforms.uTime.value = t; if (r != null) uniforms.uRain.value = r;
    const sd = sunDir || sky?.sunDir, sc = sunColor || sky?.sunColor;
    if (sd) uniforms.uSunDir2.value.copy(sd);
    if (sc) uniforms.uSunCol2.value.set(sc.r, sc.g, sc.b);
  }
  return { mesh, uniforms, update, dispose() { geo.dispose(); mat.dispose(); } };
}

/**
 * Make a three.js MeshStandardMaterial / MeshPhysicalMaterial wet (for horizontal ground: stone, asphalt, wood decks).
 * opts: {sky (fog: optional), mirror (optional), wetness 0..1, puddles 0..1 (coverage), puddleScale (m), rain 0..1,
 *   ripples (layers 1|2), mirrorStrength, darken}. Returns {material, uniforms} - uniforms are live (uWetness, uPuddles,
 *   uRain, uTime: set uniforms.uTime.value = t every frame). The fog patch is applied too when sky is given.
 */
export function patchWet(THREE, material, { sky = null, mirror = null, renderer = null, wetness = 0.7, puddles = 0.35, puddleScale = 3, rain = 0.5, ripples = 2, mirrorStrength = 1, darken = 0.45 } = {}) {
  const uniforms = {
    uWetness: { value: wetness }, uPuddles: { value: puddles }, uPuddleScale: { value: puddleScale }, uRain: { value: rain }, uTime: { value: 0 }, uDarken: { value: darken },
    uMirror: { value: mirror ? mirror.texture : null }, uMirrorMatrix: { value: mirror ? mirror.matrix : new THREE.Matrix4() }, uMirrorOn: mirror ? mirror.uniforms.uMirrorOn : { value: 0 },
    uMirrorStrength: { value: mirrorStrength },
  };
  const fogU = sky ? sky.fog.uniforms : null;
  const prevKey = material.customProgramCacheKey?.bind(material), prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    Object.assign(sh.uniforms, uniforms, fogU || {});
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vKitWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
      { vec4 kw = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        kw = instanceMatrix * kw;
      #endif
        vKitWorld = (modelMatrix * kw).xyz; }`);
    const head = `varying vec3 vKitWorld;
      uniform float uWetness, uPuddles, uPuddleScale, uRain, uTime, uDarken, uMirrorOn, uMirrorStrength; uniform sampler2D uMirror; uniform mat4 uMirrorMatrix;
      ${G.common}${G.noise}${G.ripples}${fogU ? G.fog : ''}
      float kPuddle(vec2 p) { float n = kFbm2(p / uPuddleScale, 4) + 0.15 * kValue2(p * 2.3); return smoothstep(1.0 - uPuddles + 0.06, 1.0 - uPuddles - 0.02, 1.0 - n); }
      `;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + head)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float kPud = kPuddle(vKitWorld.xz) * uWetness; float kWet = max(uWetness, kPud);
        diffuseColor.rgb *= mix(1.0, 1.0 - uDarken, kWet) * mix(1.0, 0.7, kPud);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.35, kWet); roughnessFactor = mix(roughnessFactor, 0.03, kPud);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 kG = uRain > 0.0 ? kRipples(vKitWorld.xz, uTime, uRain, ${ripples}) : vec2(0.0);
        vec3 kNw = normalize(vec3(-kG.x, 1.0, -kG.y));
        vec3 kNv = normalize((viewMatrix * vec4(kNw, 0.0)).xyz);
        normal = normalize(mix(normal, kNv, kPud * 0.92 + kWet * 0.08));`)
      .replace('#include <opaque_fragment>', `
        if (uMirrorOn > 0.5 && kWet > 0.01) {
          vec4 kMc = uMirrorMatrix * vec4(vKitWorld, 1.0); vec2 kMuv = kMc.xy / kMc.w + kG * 0.04;
          vec3 kV = normalize(cameraPosition - vKitWorld); float kF = kFresnel(max(kV.y, 0.0), 0.02);
          vec3 kRef = texture2D(uMirror, kMuv).rgb;
          outgoingLight = mix(outgoingLight, kRef, kF * (kPud + kWet * 0.25) * uMirrorStrength);
        }
        #include <opaque_fragment>`);
    if (fogU) sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', 'gl_FragColor.rgb = kFog(gl_FragColor.rgb, vKitWorld, cameraPosition);');
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey() : '') + `|kitwet${ripples}${fogU ? 'f' : ''}`;
  material.needsUpdate = true;
  return { material, uniforms };
}

/**
 * Heightfield terrain geometry: a grid of segX x segZ quads over width x depth metres centred at the origin, y =
 * height(x, z) (use kit.fbm2 / kit.ridged2 for mountains, karsts, dunes). Normals computed. -> BufferGeometry
 */
export function heightfield(THREE, { width = 100, depth = 100, segX = 128, segZ = 128, height = () => 0 } = {}) {
  const g = new THREE.PlaneGeometry(width, depth, segX, segZ); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
