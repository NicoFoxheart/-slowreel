// kit-fx.js - GPU weather: rain streaks (screen-space quads stretched along the motion of one camera shutter, energy-
// conserving width, near-camera defocus, lit by up to 4 point lights + ambient, fogged), rain splashes (crowns + rings,
// a new random spot every cycle), snow (bokeh for near flakes), sakura / maple petals (3D tumbling, cupped, two-sided
// with translucency), dust motes and fireflies. Stateless: every particle's position is a pure function of
// (seed, time, drift) computed in the vertex shader, so frames are deterministic and seeking is free.
import * as G from './kit-glsl.js?v=10a';

const FOGLESS = `
float kFogT(vec3 w, vec3 c) { return 1.0; }`;

const HEAD = `
attribute vec4 aSeed; attribute vec4 aR;
uniform float uTime, uDensity, uPx, uBrightness, uFocus, uBokeh, uSize, uSpeedVar, uFlutter, uNear;
uniform vec3 uBox, uCenter, uDrift, uVel; uniform vec2 uRes;
varying vec2 vQ; varying float vA; varying vec3 vW; varying float vSoft; varying vec4 vR;
vec3 kWrap(vec3 p) { return uCenter + mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5; }
#define KILL { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vA = 0.0; return; }
`;
const LIGHT_FS = `
uniform vec3 uColor, uAmbient; uniform float uBrightness; uniform vec4 uLightPos[4]; uniform vec3 uLightCol[4]; uniform int uNumLights;
varying vec2 vQ; varying float vA; varying vec3 vW; varying float vSoft; varying vec4 vR;
vec3 kLit(vec3 w) {
  vec3 l = uAmbient;
  for (int i = 0; i < 4; i++) { if (i >= uNumLights) break; vec3 d = uLightPos[i].xyz - w; l += uLightCol[i] / (1.0 + dot(d, d) / (uLightPos[i].w * uLightPos[i].w)); }
  return l;
}
`;

const RAIN_VS = `
uniform float uShutter, uWidth;
void main() {
  if (aSeed.w > uDensity) KILL
  vec3 vel = uVel * (1.0 + (aR.x - 0.5) * uSpeedVar);
  vec3 p = kWrap(aSeed.xyz * uBox + vel * uTime + uDrift);
  vec3 tail = p - vel * uShutter;
  vec4 ch = projectionMatrix * viewMatrix * vec4(p, 1.0), ct = projectionMatrix * viewMatrix * vec4(tail, 1.0);
  if (ch.w < uNear || ct.w < uNear) KILL
  vec2 sh = ch.xy / ch.w * uRes * 0.5, st = ct.xy / ct.w * uRes * 0.5;
  vec2 dir = sh - st; float len = length(dir); dir = len > 1e-3 ? dir / len : vec2(0.0, 1.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float wpx = uWidth * (0.7 + 0.6 * aR.y) * uPx / ch.w, w = max(wpx, 1.2), energy = min(1.0, wpx / w * 1.6);
  float defocus = smoothstep(2.5, 0.35, ch.w); w *= 1.0 + defocus * 4.0; energy /= 1.0 + defocus * 5.0;
  vec4 c = mix(ct, ch, position.y);
  c.xy += (nrm * position.x * w * 0.5 + dir * (position.y - 0.5) * w) / (uRes * 0.5) * c.w;
  gl_Position = c;
  vQ = position.xy; vW = mix(tail, p, position.y); vR = aR;
  vA = energy * smoothstep(uNear, uNear * 3.0, ch.w) * kFogT(p, cameraPosition) * (0.55 + 0.45 * aR.z);
}`;
const RAIN_FS = `
void main() {
  float across = 1.0 - vQ.x * vQ.x; float along = smoothstep(0.0, 0.3, vQ.y) * smoothstep(1.0, 0.75, vQ.y);
  float a = across * along * vA;
  gl_FragColor = vec4(uColor * kLit(vW) * uBrightness * a, 1.0);
}`;

const SPLASH_VS = `
uniform float uPeriod, uGround;
varying float vAge;
void main() {
  if (aSeed.w > uDensity) KILL
  float cyc = uTime / (uPeriod * (0.8 + 0.4 * aR.x)) + aSeed.z, n = floor(cyc);
  vAge = fract(cyc);
  vec2 rnd = kHash22(aSeed.xy * 97.0 + n * 1.618);
  vec3 p = vec3(uCenter.x + (rnd.x - 0.5) * uBox.x, uGround, uCenter.z + (rnd.y - 0.5) * uBox.z);
  vec3 toCam = cameraPosition - p; toCam.y = 0.0; vec3 right = normalize(vec3(-toCam.z, 0.0, toCam.x) + vec3(1e-5, 0.0, 0.0));
  float size = uSize * (0.6 + 0.8 * aR.y);
  vec3 wp = p + right * position.x * size + vec3(0.0, position.y * size * 1.1, 0.0);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  if (-mv.z < uNear) KILL
  gl_Position = projectionMatrix * mv;
  float px = size * uPx / -mv.z;
  vQ = position.xy; vW = wp; vR = aR;
  vA = smoothstep(0.6, 2.5, px) * kFogT(p, cameraPosition);
}`;
const SPLASH_FS = `
varying float vAge;
void main() {
  float a = vAge, acc = 0.0;
  for (int i = 0; i < 7; i++) {
    float s = float(i) / 3.0 - 1.0; float x = s * (0.12 + a * 0.85);
    float y = (1.0 - abs(s) * 0.45) * 3.4 * a * (1.0 - a);
    acc += smoothstep(0.1, 0.0, length((vQ - vec2(x, y)) * vec2(1.0, 0.75))) * (1.0 - a);
  }
  float ring = smoothstep(0.07, 0.0, abs(length(vec2(vQ.x, vQ.y * 5.0)) - a * 0.95)) * (1.0 - a) * 0.7;
  float alpha = (acc + ring) * vA;
  gl_FragColor = vec4(uColor * kLit(vW) * uBrightness * alpha, 1.0);
}`;

const SNOW_VS = `
void main() {
  if (aSeed.w > uDensity) KILL
  vec3 vel = uVel * (0.65 + 0.7 * aR.y);
  vec3 p = aSeed.xyz * uBox + vel * uTime + uDrift;
  float ph = aSeed.w * 61.0;
  p += vec3(sin(uTime * (0.45 + aR.x * 0.6) + ph) + 0.5 * sin(uTime * (1.3 + aR.z) + ph * 1.7), 0.0, cos(uTime * (0.4 + aR.y * 0.5) + ph * 1.3)) * uFlutter * (0.5 + aR.z);
  p = kWrap(p);
  vec4 mv = viewMatrix * vec4(p, 1.0); float dist = -mv.z;
  if (dist < uNear) KILL
  float rpx = uSize * (0.5 + aR.x) * uPx / dist;
  float coc = uBokeh * abs(1.0 / dist - 1.0 / uFocus) * uPx * 0.004;
  float rr = max(rpx, 0.8) + coc;
  mv.xy += position.xy * rr * dist / uPx;
  gl_Position = projectionMatrix * mv;
  vQ = position.xy; vW = p; vR = aR; vSoft = clamp(coc / rr, 0.0, 1.0);
  vA = min(1.0, (rpx * rpx + 0.3) / (rr * rr)) * smoothstep(uNear, uNear * 2.5, dist) * kFogT(p, cameraPosition);
}`;
const SNOW_FS = `
void main() {
  float d = length(vQ); if (d > 1.0) discard;
  float a = smoothstep(1.0, mix(0.35, 0.82, vSoft), d) * (1.0 + vSoft * 0.35 * smoothstep(0.6, 0.95, d));
  gl_FragColor = vec4(uColor * kLit(vW) * uBrightness, a * vA);
}`;

const PETAL_VS = `
uniform vec3 uSunDir;
varying vec3 vN; varying vec3 vView;
mat3 rotAxis(vec3 a, float t) { float c = cos(t), s = sin(t), k = 1.0 - c; return mat3(c + a.x * a.x * k, a.y * a.x * k + a.z * s, a.z * a.x * k - a.y * s, a.x * a.y * k - a.z * s, c + a.y * a.y * k, a.z * a.y * k + a.x * s, a.x * a.z * k + a.y * s, a.y * a.z * k - a.x * s, c + a.z * a.z * k); }
void main() {
  if (aSeed.w > uDensity) KILL
  vec4 h = kHash41(aSeed.w * 917.0 + aSeed.x * 13.0);
  vec3 vel = uVel * (0.7 + 0.6 * aR.y);
  vec3 p = aSeed.xyz * uBox + vel * uTime + uDrift;
  float ph = aSeed.w * 41.0;
  p += vec3(sin(uTime * (0.5 + aR.x * 0.5) + ph), 0.25 * sin(uTime * (1.1 + aR.z) + ph * 2.1), cos(uTime * (0.43 + aR.y * 0.4) + ph * 1.3)) * uFlutter * (0.6 + aR.z);
  p = kWrap(p);
  vec3 axis = normalize(h.xyz - 0.5 + vec3(0.0, 0.0, 1e-3));
  mat3 R = rotAxis(axis, uTime * (0.6 + h.w * 2.2) + h.x * 6.283) * rotAxis(vec3(1.0, 0.0, 0.0), sin(uTime * (1.7 + h.y) + ph) * 0.6);
  float size = uSize * (0.7 + 0.6 * aR.x);
  vec3 lp = vec3(position.x * 0.62, position.y, position.x * position.x * 0.22) * size;
  vec3 wp = p + R * lp;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  if (-mv.z < uNear) KILL
  gl_Position = projectionMatrix * mv;
  vN = R * normalize(vec3(-position.x * 0.42, 0.0, 1.0)); vView = normalize(cameraPosition - wp);
  vQ = position.xy; vW = wp; vR = aR;
  float px = size * uPx / -mv.z;
  vA = smoothstep(0.4, 1.5, px) * smoothstep(uNear, uNear * 2.5, -mv.z) * kFogT(wp, cameraPosition);
}`;
const PETAL_FS = `
uniform vec3 uColor2, uSunDir, uSunCol;
varying vec3 vN; varying vec3 vView;
void main() {
  float y = vQ.y * 0.5 + 0.5;
  float w = pow(sin(clamp(y, 0.0, 1.0) * 3.14159), 0.65) * (0.45 + 0.55 * y);
  float inside = smoothstep(w, w - 0.12, abs(vQ.x));
  inside *= 1.0 - smoothstep(-0.03, 0.03, (y - 0.84) * 0.85 - abs(vQ.x));      // the notch at the tip
  float a = inside * vA; if (a < 0.01) discard;
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  float ndl = dot(n, uSunDir), back = max(-ndl, 0.0);
  vec3 base = mix(uColor2, uColor, smoothstep(0.0, 0.9, y)) * (0.85 + 0.3 * vR.w);
  vec3 light = kLit(vW) + uSunCol * (max(ndl, 0.0) * 0.8 + back * 0.55 + 0.12);
  float glint = pow(max(dot(reflect(-uSunDir, n), vView), 0.0), 24.0) * 0.25;
  gl_FragColor = vec4(base * light * uBrightness + uSunCol * glint, a);
}`;

const MOTE_VS = `
uniform float uBlink;
void main() {
  if (aSeed.w > uDensity) KILL
  vec3 p = aSeed.xyz * uBox + uVel * uTime + uDrift;
  float ph = aSeed.w * 73.0;
  p += vec3(sin(uTime * (0.21 + aR.x * 0.3) + ph), sin(uTime * (0.17 + aR.y * 0.25) + ph * 1.9) * 0.6, cos(uTime * (0.19 + aR.z * 0.3) + ph * 1.3)) * uFlutter;
  p = kWrap(p);
  vec4 mv = viewMatrix * vec4(p, 1.0); float dist = -mv.z;
  if (dist < uNear) KILL
  float rpx = uSize * (0.5 + aR.x) * uPx / dist;
  float coc = uBokeh * abs(1.0 / dist - 1.0 / uFocus) * uPx * 0.004;
  float rr = max(rpx, 1.0) * 3.0 + coc;
  mv.xy += position.xy * rr * dist / uPx;
  gl_Position = projectionMatrix * mv;
  float blink = mix(1.0, pow(max(sin(uTime * (0.9 + aR.y * 1.4) + ph), 0.0), 6.0), uBlink);
  vQ = position.xy; vW = p; vR = aR; vSoft = clamp(coc / rr, 0.0, 1.0);
  vA = blink * min(1.0, (rpx * rpx * 9.0 + 0.5) / (rr * rr)) * smoothstep(uNear, uNear * 3.0, dist) * kFogT(p, cameraPosition);
}`;
const MOTE_FS = `
void main() {
  float d = length(vQ); if (d > 1.0) discard;
  float core = exp(-d * d * mix(18.0, 3.0, vSoft)), halo = exp(-d * d * 4.0) * 0.25;
  gl_FragColor = vec4(uColor * kLit(vW) * uBrightness * (core + halo) * vA, 1.0);
}`;

const KINDS = {
  rain: { vs: RAIN_VS, fs: RAIN_FS, quad: 'streak', blend: 'add', count: 24000, box: [36, 20, 36], color: [0.55, 0.6, 0.68], size: 0.0016, speed: 8.5 },
  snow: { vs: SNOW_VS, fs: SNOW_FS, quad: 'disc', blend: 'normal', count: 9000, box: [30, 16, 30], color: [0.92, 0.94, 1.0], size: 0.009, speed: 0.95 },
  petals: { vs: PETAL_VS, fs: PETAL_FS, quad: 'petal', blend: 'normal', count: 1600, box: [26, 14, 26], color: [1.0, 0.62, 0.74], color2: [1.0, 0.9, 0.92], size: 0.022, speed: 0.7 },
  dust: { vs: MOTE_VS, fs: MOTE_FS, quad: 'disc', blend: 'add', count: 2500, box: [16, 8, 16], color: [1.0, 0.92, 0.78], size: 0.0012, speed: 0.02 },
  fireflies: { vs: MOTE_VS, fs: MOTE_FS, quad: 'disc', blend: 'add', count: 260, box: [30, 6, 30], color: [0.85, 1.0, 0.45], size: 0.006, speed: 0.0 },
};
const QSCALE = { light: 0.35, high: 1, ultra: 1.5 };

/** Wind drift that never jumps: wind (m/s, [x,y,z]) with gusts (0..1) - the integral of wind*(1+gust(t)). */
export function windDrift(t, wind = [0, 0, 0], gust = 0.3) {
  const G = gust * (-0.6 / 0.23 * (Math.cos(0.23 * t + 1.3) - Math.cos(1.3)) - 0.4 / 0.61 * (Math.cos(0.61 * t + 0.2) - Math.cos(0.2)));
  return [wind[0] * (t + G), wind[1] * (t + G), wind[2] * (t + G)];
}
export function windAt(t, wind = [0, 0, 0], gust = 0.3) { const k = 1 + gust * (0.6 * Math.sin(0.23 * t + 1.3) + 0.4 * Math.sin(0.61 * t + 0.2)); return [wind[0] * k, wind[1] * k, wind[2] * k]; }

/**
 * createParticles(THREE, renderer, {kind, count, box, quality, fog, seed, color, color2, size, speed, splashes, layer})
 *   kind: 'rain' | 'snow' | 'petals' | 'dust' | 'fireflies'. count is scaled by quality (light 0.35, ultra 1.5).
 *   box: [x, y, z] metres of the volume that follows the camera (particles wrap inside it). fog: sky.fog.uniforms.
 *   splashes (rain only): {count = 1500, ground = 0, box: [x, z] = [16, 16], size = 0.05, period = 0.45}
 * -> { object (Group: add to your scene), update(t, camera, opts), dispose() }
 * update opts (all optional, per frame): density 0..1 (fraction of particles shown - drive it with audio for rain),
 *   wind [x,y,z] m/s, gust 0..1, drift [x,y,z] (override the integral yourself), brightness, ambient [r,g,b]|Color,
 *   lights [{position, color, intensity, radius}] (<= 4), sunDir Vector3, sunColor Color (petals), focus m (bokeh),
 *   bokeh 0..1, center Vector3 (default: 35% of the box ahead of the camera), shutter s (rain, default 1/45), ground y (splashes).
 */
export function createParticles(THREE, renderer, { kind = 'rain', count, box, quality = 'high', fog = null, seed = 1, color, color2, size, speed, splashes = null, flutter } = {}) {
  const K = KINDS[kind]; if (!K) throw new Error(`unknown particle kind "${kind}"`);
  const n = Math.max(1, Math.round((count ?? K.count) * (QSCALE[quality] ?? 1)));
  box = box || K.box;
  const group = new THREE.Group(); group.name = `kit-${kind}`;
  const vel = new THREE.Vector3(0, -(speed ?? K.speed), 0);
  const uniforms = {
    uTime: { value: 0 }, uDensity: { value: 1 }, uPx: { value: 500 }, uBrightness: { value: 1 }, uFocus: { value: 6 }, uBokeh: { value: 1 }, uSize: { value: size ?? K.size },
    uSpeedVar: { value: 0.35 }, uFlutter: { value: flutter ?? (kind === 'snow' ? 0.35 : kind === 'petals' ? 0.6 : kind === 'dust' ? 0.25 : kind === 'fireflies' ? 0.9 : 0) }, uNear: { value: 0.12 },
    uBox: { value: new THREE.Vector3(...box) }, uCenter: { value: new THREE.Vector3() }, uDrift: { value: new THREE.Vector3() }, uVel: { value: vel }, uRes: { value: new THREE.Vector2(1, 1) },
    uShutter: { value: 1 / 45 }, uWidth: { value: size ?? K.size }, uColor: { value: new THREE.Vector3(...(color || K.color)) }, uColor2: { value: new THREE.Vector3(...(color2 || K.color2 || K.color)) },
    uAmbient: { value: new THREE.Vector3(0.6, 0.62, 0.7) }, uLightPos: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -1000, 0, 1)) }, uLightCol: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
    uNumLights: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, uBlink: { value: kind === 'fireflies' ? 1 : 0 },
    uPeriod: { value: 0.45 }, uGround: { value: 0 },
    ...(fog || {}),
  };
  const fogChunk = fog ? G.fog : FOGLESS;
  const mkGeo = (quad, count, rnd) => {
    const g = new THREE.InstancedBufferGeometry();
    const P = quad === 'streak' ? [-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0] : [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0];
    if (quad === 'petal') P.splice(0, 12, -1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0);
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex([0, 1, 2, 2, 1, 3]);
    const s = new Float32Array(count * 4), r = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { for (let k = 0; k < 4; k++) { s[i * 4 + k] = rnd(); r[i * 4 + k] = rnd(); } s[i * 4 + 3] = (i + rnd()) / count; }
    // density rank = index order, shuffled so a lower density thins the whole volume evenly
    for (let i = count - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), t = s[i * 4 + 3]; s[i * 4 + 3] = s[j * 4 + 3]; s[j * 4 + 3] = t; }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(s, 4)); g.setAttribute('aR', new THREE.InstancedBufferAttribute(r, 4));
    g.instanceCount = count; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  };
  const mkMat = (vs, fs, blend) => new THREE.ShaderMaterial({
    uniforms, vertexShader: G.common + G.noise + fogChunk + HEAD + vs, fragmentShader: G.common + LIGHT_FS + fs,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    blending: blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  let s0 = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => { s0 |= 0; s0 = s0 + 0x6D2B79F5 | 0; let t = Math.imul(s0 ^ s0 >>> 15, 1 | s0); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const main = new THREE.Mesh(mkGeo(K.quad, n, rnd), mkMat(K.vs, K.fs, K.blend)); main.frustumCulled = false; main.renderOrder = 10; group.add(main);
  let splash = null, sU = null;
  if (kind === 'rain' && splashes) {
    const sc = Math.max(1, Math.round((splashes.count ?? 1500) * (QSCALE[quality] ?? 1)));
    sU = { ...uniforms, uBox: { value: new THREE.Vector3((splashes.box || [16, 16])[0], 1, (splashes.box || [16, 16])[1]) }, uSize: { value: splashes.size ?? 0.05 },
      uPeriod: { value: splashes.period ?? 0.45 }, uGround: { value: splashes.ground ?? 0 }, uCenter: { value: new THREE.Vector3() }, uBrightness: { value: 1 } };
    const m = new THREE.ShaderMaterial({ uniforms: sU, vertexShader: G.common + G.noise + fogChunk + HEAD + SPLASH_VS, fragmentShader: G.common + LIGHT_FS + SPLASH_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    splash = new THREE.Mesh(mkGeo('disc', sc, rnd), m); splash.frustumCulled = false; splash.renderOrder = 11; group.add(splash);
  }
  const v2 = new THREE.Vector2(), fwd = new THREE.Vector3(), cpos = new THREE.Vector3();
  const setColor = (dst, c) => { if (!c) return; if (c.isColor) dst.set(c.r, c.g, c.b); else dst.set(c[0], c[1], c[2]); };

  function update(t, camera, o = {}) {
    const U = uniforms;
    U.uTime.value = t; U.uDensity.value = Math.max(0, Math.min(1, o.density ?? 1));
    renderer.getDrawingBufferSize(v2); U.uRes.value.copy(v2);
    U.uPx.value = v2.y / (2 * Math.tan((camera.fov ?? 50) * Math.PI / 360)) / (camera.zoom || 1);
    camera.getWorldPosition(cpos); camera.getWorldDirection(fwd);
    if (o.center) U.uCenter.value.copy(o.center); else U.uCenter.value.copy(cpos).addScaledVector(fwd, box[2] * 0.35);
    const wind = o.wind || [0, 0, 0], gust = o.gust ?? 0.3;
    const d = o.drift || windDrift(t, wind, gust); U.uDrift.value.set(d[0], d[1], d[2]);
    const w = windAt(t, wind, gust); vel.set(w[0], -(speed ?? K.speed) + w[1], w[2]);
    if (o.brightness != null) U.uBrightness.value = o.brightness;
    if (o.ambient) setColor(U.uAmbient.value, o.ambient);
    if (o.focus != null) U.uFocus.value = o.focus; if (o.bokeh != null) U.uBokeh.value = o.bokeh;
    if (o.shutter != null) U.uShutter.value = o.shutter;
    if (o.sunDir) U.uSunDir.value.copy(o.sunDir); if (o.sunColor) setColor(U.uSunCol.value, o.sunColor);
    const L = o.lights || [];
    U.uNumLights.value = Math.min(4, L.length);
    for (let i = 0; i < 4; i++) {
      const l = L[i]; if (!l) continue;
      const p = l.position; if (p.isVector3) U.uLightPos.value[i].set(p.x, p.y, p.z, l.radius ?? 2); else U.uLightPos.value[i].set(p[0], p[1], p[2], l.radius ?? 2);
      setColor(U.uLightCol.value[i], l.color || [1, 0.8, 0.5]); U.uLightCol.value[i].multiplyScalar(l.intensity ?? 1);
    }
    if (sU) {
      sU.uCenter.value.set(cpos.x + fwd.x * sU.uBox.value.x * 0.35, 0, cpos.z + fwd.z * sU.uBox.value.z * 0.35);
      if (o.ground != null) sU.uGround.value = o.ground;
      sU.uBrightness.value = U.uBrightness.value * (o.splashBrightness ?? 1);
    }
  }
  function dispose() { main.geometry.dispose(); main.material.dispose(); if (splash) { splash.geometry.dispose(); splash.material.dispose(); } }
  return { object: group, uniforms, update, dispose, count: n };
}
