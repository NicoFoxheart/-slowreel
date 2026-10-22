// kit-sky.js - physically-plausible sky: Rayleigh + Mie + ozone single scattering with a multiple-scattering term,
// rendered into a small sky-view LUT (re-rendered only when the quantised sky parameters change, so every frame is a
// pure function of the parameters), a full-screen sky pass (LUT + sun disc with limb darkening + moon with phase +
// anti-aliased stars and a faint milky way + a curved, domain-warped cloud layer lit by the sun/moon), exponential
// height fog with aerial perspective (fog colour = the sky in that direction + forward-scattered sun), a CPU copy of the
// model for light colours (sun / moon / ambient), PMREM environment baking and a fog patch for three's materials.
import * as G from './kit-glsl.js?v=10';
import { createPass, halfFloatOK } from './kit-gpu.js?v=10';

// ------------------------------------------------------------------------------------------------ CPU model (km)
const RE = 6360, RA = 6460, BR = [5.802e-3, 13.558e-3, 33.1e-3], BO = [0.650e-3, 1.881e-3, 0.085e-3], BM_S = 3.996e-3, BM_E = 4.4e-3 + 3.996e-3;
const dens = h => [Math.exp(-h / 8), Math.exp(-h / 1.2), Math.max(0, 1 - Math.abs(h - 25) / 15)];
function raySphere(o, d, r) { const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2], c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r, q = b * b - c; if (q < 0) return -1; const s = Math.sqrt(q), t = -b - s; return t > 0 ? t : -b + s; }
function hitsGround(o, d) { const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2], c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - RE * RE; return b < 0 && b * b - c > 0; }
function ext(P, d) { return [0, 1, 2].map(i => BR[i] * P.rayleigh * d[0] + BM_E * P.mie * d[1] + BO[i] * P.ozone * d[2]); }
function transmittance(P, o, dir, n = 12) {
  if (hitsGround(o, dir)) return [0, 0, 0];
  const tl = raySphere(o, dir, RA), ds = tl / n, od = [0, 0, 0];
  for (let i = 0; i < n; i++) { const t = ds * (i + 0.5), q = [o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t]; const e = ext(P, dens(Math.hypot(...q) - RE)); for (let k = 0; k < 3; k++) od[k] += e[k] * ds; }
  return od.map(x => Math.exp(-x));
}
const phaseR = c => 3 / (16 * Math.PI) * (1 + c * c);
const phaseHG = (c, g) => (1 - g * g) / (4 * Math.PI * Math.pow(Math.max(1 + g * g - 2 * g * c, 1e-4), 1.5));
function radiance(P, rd, L, E, steps = 16) {
  const ro = [0, RE + P.altitude, 0];
  let tmax = raySphere(ro, rd, RA);
  if (hitsGround(ro, rd)) { const b = ro[1] * rd[1], c = ro[1] * ro[1] - RE * RE; tmax = -b - Math.sqrt(Math.max(b * b - c, 0)); }
  const ds = tmax / steps, cosT = rd[0] * L[0] + rd[1] * L[1] + rd[2] * L[2], pr = phaseR(cosT), pm = phaseHG(cosT, P.mieG);
  const sum = [0, 0, 0], od = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const t = ds * (i + 0.5), q = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t], d = dens(Math.hypot(...q) - RE), e = ext(P, d);
    for (let k = 0; k < 3; k++) od[k] += e[k] * ds * 0.5;
    const Ts = transmittance(P, q, L, 6);
    for (let k = 0; k < 3; k++) {
      const sR = BR[k] * P.rayleigh * d[0], sM = BM_S * P.mie * d[1], T = Math.exp(-od[k]);
      sum[k] += T * ((sR * pr + sM * pm) * Ts[k] + (sR + sM) * P.ms * (Ts[k] * 0.6 + 0.08 * Math.max(L[1] + 0.1, 0))) * ds;
    }
    for (let k = 0; k < 3; k++) od[k] += e[k] * ds * 0.5;
  }
  return sum.map(x => x * E);
}
const dirFrom = (elevDeg, azDeg) => { const e = elevDeg * Math.PI / 180, a = azDeg * Math.PI / 180; return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)]; };

/**
 * Sun elevation/azimuth for an hour of the day (0..24, fractional), a simple arc: sunrise at `rise`, sunset at `set`,
 * highest at noon. Use it to drift the light slowly over a song: sunFromHour(17.2 + t / 600).
 */
export function sunFromHour(hour, { rise = 6, set = 18.5, maxElevation = 58, azimuthRise = -100, azimuthSet = 100 } = {}) {
  const u = (hour - rise) / (set - rise);
  return { elevation: Math.sin(u * Math.PI) * maxElevation * (u < 0 || u > 1 ? 0.6 : 1), azimuth: azimuthRise + (azimuthSet - azimuthRise) * u };
}

export const SKY_Q = { light: { lut: [128, 64], steps: 14, oct: 4 }, high: { lut: [192, 108], steps: 20, oct: 6 }, ultra: { lut: [256, 144], steps: 28, oct: 7 } };

const SKY_VS = /* glsl */`
uniform mat4 uInvProjView; varying vec3 vDir;
void main() { vec4 w = uInvProjView * vec4(position.xy, 1.0, 1.0); vDir = w.xyz / w.w - cameraPosition; gl_Position = vec4(position.xy, 1.0, 1.0); }`;
const SKY_FS = /* glsl */`
varying vec3 vDir;
uniform vec3 uSunDir, uSunDisc, uMoonDir, uMoonDisc, uMoonLight, uCloudSun, uCloudAmb, uNightGlow, uGroundRad, uMilky;
uniform float uSunSize, uMoonSize, uStars, uTime, uCloudCover, uCloudHeight, uCloudScale, uCloudDensity, uCloudSoft, uCloudOpacity, uFogSkyDist, uEnvPass, uAlt;
uniform vec2 uCloudWind; uniform int uCloudOct;
vec3 starField(vec3 d) {
  vec3 acc = vec3(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float sc = layer == 0 ? 180.0 : 420.0; vec3 p = d * sc; vec3 c = floor(p); vec3 f = fract(p);
    vec3 h = kHash33(c + float(layer) * 91.0);
    float on = step(layer == 0 ? 0.93 : 0.82, h.x);
    vec3 o = 0.2 + 0.6 * kHash33(c + 7.0); float dist = length(f - o);
    float px = max(length(fwidth(p)), 1e-4);
    float r = max(px * 0.85, 0.035);
    float mag = pow(h.y, layer == 0 ? 5.0 : 9.0) * (layer == 0 ? 2.2 : 1.2) * (0.035 * 0.035) / (r * r);
    float tw = 0.7 + 0.3 * sin(uTime * (1.3 + h.z * 4.0) + h.x * 60.0);
    vec3 tint = mix(vec3(1.0, 0.78, 0.6), vec3(0.75, 0.85, 1.0), h.z);
    acc += tint * on * mag * tw * smoothstep(r, r * 0.25, dist);
  }
  return acc;
}
float cloudField(vec2 p, int oct) { return kWarp2(p, oct, 0.38); }
void main() {
  vec3 d = normalize(vDir);
  vec3 col = texture2D(uSkyLut, kSkyUV(d)).rgb;
  vec3 ro = vec3(0.0, K_RE + uAlt, 0.0);
  float horizonT = exp(-0.12 / max(d.y + 0.02, 0.012));
  if (uEnvPass < 0.5) {
    // sun disc with limb darkening (only above the horizon; the ground and scene cover the rest)
    float ang = length(d - uSunDir) / uSunSize;
    if (ang < 1.0) { float mu = sqrt(1.0 - ang * ang); col += uSunDisc * (1.0 - 0.6 * (1.0 - mu)) * smoothstep(1.0, 0.9, ang); }
    col += uSunDisc * 0.0025 * kPhaseHG(dot(d, uSunDir), 0.985);
    // night: stars, milky way, moon
    if (uStars > 0.0 && d.y > -0.05) {
      vec3 gal = normalize(vec3(0.3, 0.75, 0.6)); float band = exp(-pow(dot(d, gal), 2.0) * 18.0);
      float mw = band * (0.35 + 0.65 * kFbm3(d * 5.0, 5)) * smoothstep(0.35, 0.75, kFbm3(d * 2.2 + 3.0, 4));
      col += (starField(d) * (1.0 + band * 2.0) + uMilky * mw) * uStars * horizonT;
    }
    vec3 mr = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0001))), mu2 = cross(mr, uMoonDir);
    vec2 mq = vec2(dot(d - uMoonDir, mr), dot(d - uMoonDir, mu2)) / uMoonSize;
    float mrr = dot(mq, mq);
    if (mrr < 1.0 && dot(d, uMoonDir) > 0.0) {
      vec3 n = vec3(mq, sqrt(1.0 - mrr));
      float shade = max(dot(n, uMoonLight), 0.0); shade = shade / (shade + max(n.z, 0.05)) * 2.0;   // Lommel-Seeliger
      float maria = 0.72 + 0.28 * smoothstep(0.35, 0.65, kFbm3(n * 2.6 + 4.0, 5));
      col += uMoonDisc * (shade * maria + 0.012) * smoothstep(1.0, 0.92, sqrt(mrr)) * horizonT;
    }
    col += uMoonDisc * 0.0004 * kPhaseHG(dot(d, uMoonDir), 0.9);
  }
  // clouds: one curved layer, domain-warped fbm, self-shadowed toward the light, silver lining, aerial perspective
  if (uCloudCover > 0.001 && d.y > -0.01) {
    float tc = kRaySphere(ro, d, K_RE + uAlt + uCloudHeight);
    vec3 pc = d * tc;
    vec2 cp = pc.xz * uCloudScale + uCloudWind * uTime;
    int oct = uEnvPass > 0.5 ? 3 : uCloudOct;
    float th = 1.0 - uCloudCover;
    float dn = smoothstep(th, th + uCloudSoft, cloudField(cp, oct));
    vec3 Ld = normalize(uSunDir.y > -0.07 ? uSunDir : uMoonDir);
    vec2 sp = cp + normalize(Ld.xz + 1e-4) * 0.08 * (1.15 - max(Ld.y, 0.0));
    float d2 = smoothstep(th, th + uCloudSoft, cloudField(sp, max(oct - 2, 2)));
    float shadow = exp(-d2 * uCloudDensity * 1.6) * (1.0 - exp(-dn * 2.5) * 0.35);
    float cosT = dot(d, Ld);
    float ph = (kPhaseHG(cosT, 0.6) * 0.7 + kPhaseHG(cosT, -0.25) * 0.3) * 4.0 * K_PI;
    vec3 lit = uCloudSun * (shadow * ph * 0.55 + 0.06) + uCloudAmb * (1.0 - 0.5 * dn);
    float ap = 1.0 - exp(-tc * 0.012);
    lit = mix(lit, col, clamp(ap, 0.0, 0.9));
    col = mix(col, lit, dn * smoothstep(-0.01, 0.06, d.y) * uCloudOpacity);
  }
  // below the horizon: dim ground under the haze (scenes usually cover it)
  if (d.y < 0.0) col = mix(col, uGroundRad + col * 0.4, smoothstep(0.0, -0.04, d.y) * 0.85);
  col += uNightGlow * exp(-max(d.y, 0.0) * 6.0);
  if (uFogSkyDist > 0.0) col = kFog(col, cameraPosition + d * uFogSkyDist, cameraPosition);
  gl_FragColor = vec4(col, 1.0);
}`;
const LUT_FS = /* glsl */`
uniform vec3 uSun, uMoon; uniform float uSunE, uMoonE, uMS; uniform int uSteps;
void main() {
  vec3 d = kSkyDir(vUv);
  vec3 c = kScatter(d, uSun, uSunE, uSteps, uMS);
  if (uMoonE > 0.0) c += kScatter(d, uMoon, uMoonE, uSteps, uMS);
  gl_FragColor = vec4(c, 1.0);
}`;

/** Default sky parameters (change sky.params, then sky.update(t) each frame). Angles in degrees, heights in km. */
export function defaultSky() {
  return {
    sun: { elevation: 12, azimuth: -30, intensity: 4, discBrightness: 40, size: 0.0085 },
    moon: { elevation: -30, azimuth: 150, intensity: 0, phase: 0.35, size: 0.012, discBrightness: 1 },
    rayleigh: 1, mie: 1, ozone: 1, mieG: 0.8, altitude: 0.05, ms: 0.35, groundAlbedo: 0.12,
    stars: 1, milky: [0.016, 0.018, 0.026], nightGlow: [0.0, 0.0, 0.0],
    clouds: { coverage: 0.35, height: 2.0, scale: 0.45, wind: [0.006, 0.002], density: 1, softness: 0.35, opacity: 1 },
  };
}
export function defaultFog() {
  return { on: true, density: 0.004, base: 0, falloff: 0.08, sunG: 0.7, sunStrength: 0.6, skyAmount: 1, tint: [1, 1, 1], noise: 0, wind: [0.02, 0, 0.01], start: 0, skyDistance: 0 };
}

/**
 * createSky(THREE, renderer, {quality, sky: {...defaultSky overrides}, fog: {...defaultFog overrides}})
 * -> { mesh, params, fog: {params, uniforms}, sunDir, sunColor, moonDir, moonColor, ambient: {sky, ground, horizon},
 *      lut, update(t), applyLights({sun, moon, hemi}), bakeEnvironment(), patch(material), dispose() }
 * mesh: full-screen sky (add it to your scene; it draws first, behind everything). sunColor/moonColor are linear
 * radiance x intensity for a DirectionalLight (light.color = sky.sunColor, intensity 1). Units: a white wall in noon sun
 * is about 1.3 before exposure.
 */
export function createSky(THREE, renderer, { quality = 'high', sky = {}, fog = {} } = {}) {
  const Q = SKY_Q[quality] || SKY_Q.high;
  const P = defaultSky(); deepAssign(P, sky);
  const FP = defaultFog(); deepAssign(FP, fog);
  const type = halfFloatOK(renderer) ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const lutRT = new THREE.WebGLRenderTarget(Q.lut[0], Q.lut[1], { type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, generateMipmaps: false });
  lutRT.texture.userData.kitShared = true;
  const atmoU = { uAtmoRayleigh: { value: 1 }, uAtmoMie: { value: 1 }, uAtmoOzone: { value: 1 }, uAtmoMieG: { value: 0.8 }, uAtmoAltitude: { value: 0.05 } };
  const lutPass = createPass(THREE, { fragment: LUT_FS, prepend: G.common + G.atmosphere, uniforms: { ...atmoU, uSun: { value: new THREE.Vector3() }, uMoon: { value: new THREE.Vector3() }, uSunE: { value: 4 }, uMoonE: { value: 0 }, uMS: { value: 0.35 }, uSteps: { value: Q.steps } } });
  // fog uniforms (shared by every patched material and the sky)
  const fogU = {
    uSkyLut: { value: lutRT.texture }, uFogSunDir: { value: new THREE.Vector3(0, 1, 0) }, uFogSunColor: { value: new THREE.Vector3() }, uFogTint: { value: new THREE.Vector3(1, 1, 1) }, uFogWind: { value: new THREE.Vector3() },
    uFogDensity: { value: 0 }, uFogBase: { value: 0 }, uFogFalloff: { value: 0.08 }, uFogSunG: { value: 0.7 }, uFogSunStrength: { value: 0.6 }, uFogNoise: { value: 0 }, uFogTime: { value: 0 },
    uFogStart: { value: 0 }, uFogSkyAmount: { value: 1 }, uFogOn: { value: 1 },
  };
  const skyU = {
    ...atmoU, ...fogU, uInvProjView: { value: new THREE.Matrix4() },
    uSunDir: { value: new THREE.Vector3() }, uSunDisc: { value: new THREE.Vector3() }, uMoonDir: { value: new THREE.Vector3() }, uMoonDisc: { value: new THREE.Vector3() }, uMoonLight: { value: new THREE.Vector3(0, 0, 1) },
    uCloudSun: { value: new THREE.Vector3() }, uCloudAmb: { value: new THREE.Vector3() }, uNightGlow: { value: new THREE.Vector3() }, uGroundRad: { value: new THREE.Vector3() }, uMilky: { value: new THREE.Vector3() },
    uSunSize: { value: 0.0085 }, uMoonSize: { value: 0.012 }, uStars: { value: 0 }, uTime: { value: 0 }, uCloudCover: { value: 0 }, uCloudHeight: { value: 2 }, uCloudScale: { value: 0.45 },
    uCloudDensity: { value: 1 }, uCloudSoft: { value: 0.35 }, uCloudOpacity: { value: 1 }, uFogSkyDist: { value: 0 }, uEnvPass: { value: 0 }, uAlt: { value: 0.05 },
    uCloudWind: { value: new THREE.Vector2() }, uCloudOct: { value: Q.oct },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VS, fragmentShader: G.common + G.noise + G.atmosphere + G.fog + SKY_FS, depthTest: false, depthWrite: false });
  mat.extensions = { derivatives: true };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = -1e9; mesh.name = 'kit-sky';
  const m4 = new THREE.Matrix4();
  mesh.onBeforeRender = (r, s, camera) => { m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); skyU.uInvProjView.value.copy(m4).invert(); };

  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), sunColor = new THREE.Color(), moonColor = new THREE.Color();
  const ambient = { sky: new THREE.Color(), ground: new THREE.Color(), horizon: new THREE.Color() };
  let lutKey = '', cpuKey = '', env = null, envKey = '', pmrem = null;
  const q = (x, s) => Math.round(x / s);

  function update(t = 0) {
    const sd = dirFrom(P.sun.elevation, P.sun.azimuth), md = dirFrom(P.moon.elevation, P.moon.azimuth);
    sunDir.fromArray(sd); moonDir.fromArray(md);
    for (const [k, v] of [['uAtmoRayleigh', P.rayleigh], ['uAtmoMie', P.mie], ['uAtmoOzone', P.ozone], ['uAtmoMieG', P.mieG], ['uAtmoAltitude', P.altitude]]) atmoU[k].value = v;
    // the LUT depends only on quantised parameters -> identical frames whatever was rendered before
    const key = [q(P.sun.elevation, 0.05), q(P.sun.azimuth, 0.1), q(P.moon.elevation, 0.1), q(P.moon.azimuth, 0.2), q(P.sun.intensity, 0.01), q(P.moon.intensity, 0.0005),
      q(P.rayleigh, 0.005), q(P.mie, 0.005), q(P.ozone, 0.01), q(P.mieG, 0.002), q(P.altitude, 0.005), q(P.ms, 0.005)].join(',');
    if (key !== lutKey) {
      lutKey = key;
      const u = lutPass.uniforms; u.uSun.value.copy(sunDir); u.uMoon.value.copy(moonDir); u.uSunE.value = P.sun.intensity; u.uMoonE.value = P.moon.intensity; u.uMS.value = P.ms;
      const prev = renderer.getRenderTarget(); lutPass.render(renderer, lutRT); renderer.setRenderTarget(prev);
    }
    if (key + P.groundAlbedo + P.clouds.height !== cpuKey) { cpuKey = key + P.groundAlbedo + P.clouds.height; cpuLights(sd, md); }
    // sky pass uniforms
    const S = skyU;
    S.uSunDir.value.copy(sunDir); S.uMoonDir.value.copy(moonDir);
    const tr = transmittance(P, [0, RE + P.altitude, 0], sd, 8);
    S.uSunDisc.value.set(tr[0], tr[1], tr[2]).multiplyScalar(P.sun.intensity * P.sun.discBrightness * (P.sun.elevation > -2 ? 1 : 0));
    const trm = transmittance(P, [0, RE + P.altitude, 0], md, 8);
    S.uMoonDisc.value.set(trm[0] * 1.0, trm[1] * 0.98, trm[2] * 0.95).multiplyScalar(Math.max(P.moon.intensity, 0.0) * 60 * P.moon.discBrightness + (P.moon.intensity > 0 ? 0 : 0.08));
    const ph = (P.moon.phase ?? 0.35) * Math.PI * 2; S.uMoonLight.value.set(Math.sin(ph), 0, Math.cos(ph)).normalize();
    S.uSunSize.value = P.sun.size; S.uMoonSize.value = P.moon.size;
    S.uStars.value = P.stars * Math.max(0, Math.min(1, (-P.sun.elevation - 2) / 10));
    S.uMilky.value.fromArray(P.milky); S.uNightGlow.value.fromArray(P.nightGlow); S.uTime.value = t; S.uAlt.value = P.altitude;
    const C = P.clouds; S.uCloudCover.value = C.coverage; S.uCloudHeight.value = C.height; S.uCloudScale.value = C.scale; S.uCloudDensity.value = C.density; S.uCloudSoft.value = C.softness;
    S.uCloudOpacity.value = C.opacity; S.uCloudWind.value.set(C.wind[0], C.wind[1]);
    // fog
    const F = FP;
    fogU.uFogOn.value = F.on ? 1 : 0; fogU.uFogDensity.value = F.density; fogU.uFogBase.value = F.base; fogU.uFogFalloff.value = F.falloff; fogU.uFogSunG.value = F.sunG;
    fogU.uFogSunStrength.value = F.sunStrength; fogU.uFogSkyAmount.value = F.skyAmount; fogU.uFogTint.value.fromArray(F.tint); fogU.uFogNoise.value = F.noise;
    fogU.uFogWind.value.fromArray(F.wind); fogU.uFogTime.value = t; fogU.uFogStart.value = F.start; S.uFogSkyDist.value = F.on ? F.skyDistance : 0;
    const lit = P.sun.elevation > -4 ? sunDir : moonDir; fogU.uFogSunDir.value.copy(lit);
    fogU.uFogSunColor.value.set((P.sun.elevation > -4 ? sunColor : moonColor).r, (P.sun.elevation > -4 ? sunColor : moonColor).g, (P.sun.elevation > -4 ? sunColor : moonColor).b);
  }

  function cpuLights(sd, md) {
    const o = [0, RE + P.altitude, 0];
    const ts = transmittance(P, o, sd), tm = transmittance(P, o, md);
    sunColor.setRGB(ts[0] * P.sun.intensity, ts[1] * P.sun.intensity, ts[2] * P.sun.intensity);
    moonColor.setRGB(tm[0] * P.moon.intensity, tm[1] * P.moon.intensity * 0.98, tm[2] * P.moon.intensity * 0.95);
    const dirs = [[90, 0], [45, 0], [45, 90], [45, 180], [45, 270], [12, 45], [12, 135], [12, 225], [12, 315]], avg = [0, 0, 0], hor = [0, 0, 0];
    for (const [e, a] of dirs) {
      const d = dirFrom(e, a), r = radiance(P, d, sd, P.sun.intensity, 12), rm = P.moon.intensity > 0 ? radiance(P, d, md, P.moon.intensity, 8) : [0, 0, 0];
      for (let k = 0; k < 3; k++) { avg[k] += (r[k] + rm[k]) / dirs.length; if (e === 12) hor[k] += (r[k] + rm[k]) / 4; }
    }
    ambient.sky.setRGB(avg[0] * Math.PI, avg[1] * Math.PI, avg[2] * Math.PI);
    ambient.horizon.setRGB(hor[0], hor[1], hor[2]);
    const sunIrr = Math.max(sd[1], 0), moonIrr = Math.max(md[1], 0), a = P.groundAlbedo;
    ambient.ground.setRGB(...[0, 1, 2].map(k => a * ((k === 0 ? sunColor.r : k === 1 ? sunColor.g : sunColor.b) * sunIrr + (k === 0 ? moonColor.r : k === 1 ? moonColor.g : moonColor.b) * moonIrr + avg[k] * Math.PI * 0.5)));
    // light at the cloud layer (above most of the haze) and the clouds' ambient
    const oc = [0, RE + P.altitude + P.clouds.height, 0], useSun = P.sun.elevation > -4;
    const tc = transmittance(P, oc, useSun ? sd : md), E = useSun ? P.sun.intensity : P.moon.intensity;
    skyU.uCloudSun.value.set(tc[0] * E, tc[1] * E, tc[2] * E);
    skyU.uCloudAmb.value.set(avg[0] * 1.6 + hor[0] * 0.6, avg[1] * 1.6 + hor[1] * 0.6, avg[2] * 1.6 + hor[2] * 0.6);
    skyU.uGroundRad.value.set(ambient.ground.r / Math.PI, ambient.ground.g / Math.PI, ambient.ground.b / Math.PI);
  }

  /** Copy the sky's light into your lights: sun/moon DirectionalLights (position set from the direction), hemi HemisphereLight. */
  function applyLights({ sun, moon, hemi, distance = 50, target } = {}) {
    if (sun) { sun.color.copy(sunColor); sun.intensity = 1; sun.position.copy(sunDir).multiplyScalar(distance).add(target || sun.target.position); sun.visible = P.sun.elevation > -3; }
    if (moon) { moon.color.copy(moonColor); moon.intensity = 1; moon.position.copy(moonDir).multiplyScalar(distance).add(target || moon.target.position); moon.visible = P.moon.elevation > -3 && P.moon.intensity > 0; }
    if (hemi) { hemi.color.copy(ambient.sky); hemi.groundColor.copy(ambient.ground); hemi.intensity = 1; }
  }

  /**
   * PMREM environment of this sky (for scene.environment: image-based light and reflections on every PBR material).
   * Cached by the quantised sky parameters (cloud cover in 5% steps); call it again when the light has moved - it only
   * re-bakes when the key changed. Call it after sky.update(t). Costs a few ms on a GPU; at most every few seconds of song time.
   */
  function bakeEnvironment() {
    const key = lutKey + '|' + q(P.clouds.coverage, 0.05) + '|' + q(FP.on ? FP.density : 0, 0.0005);
    if (env && key === envKey) return env.texture;
    pmrem = pmrem || new THREE.PMREMGenerator(renderer);
    const parent = mesh.parent, s = new THREE.Scene(); s.add(mesh);
    const prevT = skyU.uTime.value; skyU.uEnvPass.value = 1; skyU.uTime.value = 0;
    const rt = pmrem.fromScene(s, 0, 0.1, 100);
    skyU.uEnvPass.value = 0; skyU.uTime.value = prevT; s.remove(mesh); parent?.add(mesh);
    env?.dispose(); env = rt; envKey = key; env.texture.userData.kitShared = true;
    return env.texture;
  }

  /** Patch a three.js material (MeshStandard/Physical/Lambert/Basic...) so it gets this height fog. Returns the material. */
  function patch(material) { return patchFog(THREE, material, fogU); }

  function dispose() { lutRT.dispose(); lutPass.dispose(); mat.dispose(); geo.dispose(); env?.dispose(); pmrem?.dispose(); }

  update(0);
  return { mesh, params: P, fog: { params: FP, uniforms: fogU }, atmosphereUniforms: atmoU, uniforms: skyU, sunDir, sunColor, moonDir, moonColor, ambient, lut: lutRT.texture,
    update, applyLights, bakeEnvironment, patch, dispose, radiance: (dir, steps = 12) => radiance(P, [dir.x, dir.y, dir.z], [sunDir.x, sunDir.y, sunDir.z], P.sun.intensity, steps) };
}

/**
 * Give a built-in three.js material the kit's height fog + aerial perspective (replaces three's fog chunk).
 * fogUniforms: sky.fog.uniforms. Works with instancing. Keeps any onBeforeCompile you set before (it is chained).
 */
export function patchFog(THREE, material, fogUniforms) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    Object.assign(sh.uniforms, fogUniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vKitWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
      { vec4 kw = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        kw = instanceMatrix * kw;
      #endif
      #ifdef USE_BATCHING
        kw = batchingMatrix * kw;
      #endif
        vKitWorld = (modelMatrix * kw).xyz; }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vKitWorld;\n' + G.common + G.noise + G.fog)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = kFog(gl_FragColor.rgb, vKitWorld, cameraPosition);');
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|kitfog';
  material.needsUpdate = true;
  return material;
}

function deepAssign(a, b) { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deepAssign(a[k], b[k]); else a[k] = b[k]; } return a; }
export { deepAssign };
