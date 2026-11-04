// People shading: GPU-skinned ShaderMaterials (bone matrices + per-person data in float textures),
// skin (curvature scattering, two-lobe GGX, spec mask, coloured AO, face atlas), fabrics (weave, folds, seams, hems),
// hair (Kajiya-Kay shells + strand cards, alpha-to-coverage) and eyes (capped sclera, occlusion, iris parallax, cornea glint, lids, lashes).
import * as THREE from 'three';
import { atmos } from './sky.js';
import { NB, LM, EO } from './ppl-body.js';

// bone texture row: NB 3x4 matrices, then DYN = (lid closure, gaze yaw, gaze pitch, seated), DYN2 = (smile, jaw open, brow raise, -)
export const DATA_W = 10, BONE_W = NB * 3 + 2, DYN = NB * 3, DYN2 = NB * 3 + 1;
// ---------------------------------------------------------------- face atlas: 4 x 2 cells; R = shading, G = redness (lips/blush), B = brow hair
let FACE = null;
export function faceAtlas() {
  if (FACE) return FACE; const C = 256, cv = document.createElement('canvas'); cv.width = C * 4; cv.height = C * 2; const c = cv.getContext('2d');
  c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
  const U = x => (0.5 + x / 0.2) * C, V = y => (1 - (y - 1.49) / 0.29) * C; // head-space metres → cell pixels
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  // cell variants: [female, age(0 young..1 old), browWeight, lipFull, makeup]
  const V8 = [[0, 0.1, 1.0, 0.5, 0], [0, 0.45, 1.15, 0.4, 0], [0, 0.95, 0.85, 0.3, 0], [0, 0.2, 0.8, 0.7, 0], [1, 0.1, 0.55, 0.9, 1], [1, 0.4, 0.6, 0.7, 0.6], [1, 0.9, 0.5, 0.5, 0.3], [1, 0.2, 0.65, 1.0, 0.2]];
  V8.forEach(([fem, age, bw, lip, mk], i) => {
    const ox = (i % 4) * C, oy = Math.floor(i / 4) * C; c.save(); c.beginPath(); c.rect(ox, oy, C, C); c.clip(); c.translate(ox, oy);
    const blur = (px, f) => { c.filter = `blur(${px}px)`; f(); c.filter = 'none'; };
    // R: shading — upper lid crease, under-eye, nasolabial, wrinkles, eye makeup
    c.globalCompositeOperation = 'lighter';
    for (const s of [-1, 1]) { const ex = U(s * 0.032), ey = V(1.647);
      blur(2.2, () => { c.strokeStyle = `rgba(${Math.round(70 + mk * 90)},0,0,1)`; c.lineWidth = 3 + mk * 2; c.beginPath(); c.ellipse(ex + s * 1, ey - 3.5, 14, 7, 0, Math.PI * 1.08, Math.PI * 1.92); c.stroke(); });
      blur(3, () => { c.fillStyle = `rgba(${Math.round(35 + age * 40)},0,0,1)`; c.beginPath(); c.ellipse(ex + s * 1.5, ey + 9, 11, 4, 0, 0, 7); c.fill(); });
      if (mk > 0.3) blur(1, () => { c.strokeStyle = `rgba(${Math.round(120 * mk)},0,0,1)`; c.lineWidth = 2; c.beginPath(); c.moveTo(ex - s * 13, ey - 1); c.quadraticCurveTo(ex, ey - 7, ex + s * 16, ey - 4); c.stroke(); });
      if (age > 0.35) blur(1.4, () => { c.strokeStyle = `rgba(${Math.round(age * 80)},0,0,1)`; c.lineWidth = 1.6; for (let k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(ex + s * 17, ey + k * 4); c.lineTo(ex + s * 25, ey + k * 6 - 1); c.stroke(); } });
      blur(3, () => { c.strokeStyle = `rgba(${Math.round(40 + age * 70)},0,0,1)`; c.lineWidth = 2.5 + age * 2; c.beginPath(); c.moveTo(U(s * 0.016), V(1.603)); c.quadraticCurveTo(U(s * 0.03), V(1.585), U(s * 0.028), V(1.562)); c.stroke(); });
    }
    if (age > 0.5) blur(1.5, () => { c.strokeStyle = `rgba(${Math.round(age * 60)},0,0,1)`; c.lineWidth = 1.5; for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(U(-0.04), V(1.70 + k * 0.009)); c.quadraticCurveTo(U(0), V(1.703 + k * 0.009), U(0.04), V(1.70 + k * 0.009)); c.stroke(); } });
    // G: redness — lips, cheeks, nose tip
    blur(1.1, () => { c.fillStyle = `rgb(0,${Math.round(150 + lip * 70 + mk * 30)},0)`; c.beginPath(); const lw = 0.0225, top = 1.5885, mid = 1.5768, bot = 1.5638;
      const mc = mid + 0.001; c.moveTo(U(-lw), V(mc)); c.quadraticCurveTo(U(-0.012), V(top + 0.001), U(-0.003), V(top - 0.0005)); c.lineTo(U(0), V(top - 0.0018)); c.lineTo(U(0.003), V(top - 0.0005)); c.quadraticCurveTo(U(0.012), V(top + 0.001), U(lw), V(mc));
      c.quadraticCurveTo(U(0.012), V(bot - lip * 0.002), U(0), V(bot - lip * 0.0025)); c.quadraticCurveTo(U(-0.012), V(bot - lip * 0.002), U(-lw), V(mc)); c.fill(); });
    blur(1.2, () => { c.strokeStyle = 'rgb(90,0,0)'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(U(-0.023), V(1.5779)); c.quadraticCurveTo(U(0), V(1.5752), U(0.023), V(1.5779)); c.stroke(); });
    blur(9, () => { c.fillStyle = `rgba(0,${Math.round(55 + mk * 50 + (1 - age) * 20)},0,1)`; for (const s of [-1, 1]) { c.beginPath(); c.arc(U(s * 0.046), V(1.612), 15, 0, 7); c.fill(); } c.beginPath(); c.arc(U(0), V(1.607), 6, 0, 7); c.fill(); });
    // B: eyebrows (strokes)
    c.globalCompositeOperation = 'lighter';
    for (const s of [-1, 1]) { const x0 = 0.011, x1 = 0.054, yb = 1.6745 + (fem ? 0.002 : 0);
      for (let k = 0; k < 90 * bw; k++) { const t = rnd(), x = x0 + (x1 - x0) * t, arch = fem ? Math.sin(t * Math.PI * 0.85) * 0.0042 : Math.sin(t * Math.PI * 0.7) * 0.0022, th = (fem ? 0.0026 : 0.0042) * bw * (1 - t * 0.55);
        const y = yb + arch - (rnd() - 0.5) * th; c.strokeStyle = `rgba(0,0,${Math.round(150 + rnd() * 100)},${0.5 + 0.4 * rnd()})`; c.lineWidth = 1.1; c.beginPath(); c.moveTo(U(s * x), V(y)); c.lineTo(U(s * (x + 0.006 + rnd() * 0.004)), V(y + 0.002 * (t < 0.3 ? 1.6 : 0.5))); c.stroke(); } }
    c.restore();
  });
  FACE = new THREE.CanvasTexture(cv); FACE.colorSpace = THREE.NoColorSpace; FACE.anisotropy = 4; FACE.generateMipmaps = true; FACE.minFilter = THREE.LinearMipmapLinearFilter; return FACE;
}

// ---------------------------------------------------------------- GLSL
// eye construction constants for GLSL (metres, eye-local)
const EYEC = `const float ER = ${LM.EYER.toFixed(4)}; const float EW = ${EO.W.toFixed(5)}; const float EC0 = ${EO.C0.toFixed(5)}; const float EUP = ${EO.UP.toFixed(5)}; const float ELO = ${EO.LO.toFixed(5)}; const float ETILT = ${EO.TILT.toFixed(3)}; const float EIRIS = ${EO.IRIS.toFixed(3)}; const float ECLOSE = ${EO.CLOSE.toFixed(3)};`;
// light rig: world-fixed when uKeyD.w = 1 (setLighting), else camera-relative three-point rig (key high and to the camera's left, cool fill from the right, rim from behind)
const RIG = /* glsl */`
uniform mat3 uObj; uniform vec4 uKeyD; uniform vec4 uFillD; uniform vec4 uRimD;
void rig(vec3 V, out vec3 up, out vec3 K, out vec3 F, out vec3 Rr) {
  up = normalize(uObj * vec3(0., 1., 0.));
  if (uKeyD.w > 0.5) { K = normalize(uKeyD.xyz); F = normalize(uFillD.xyz); Rr = normalize(uRimD.xyz); return; }
  vec3 vf = V - up * dot(V, up); float vl = length(vf); vf = vl > 1e-4 ? vf / vl : normalize(uObj * vec3(0., 0., 1.)); vec3 sd = normalize(cross(up, vf));
  K = normalize(up * 0.9 + vf * 0.8 - sd * 0.5); F = normalize(up * 0.15 + vf * 0.55 + sd * 0.85); Rr = normalize(up * 0.65 - vf * 0.75 + sd * 0.4); }
`;
const VS_HEAD = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
uniform highp sampler2D uBones; uniform highp sampler2D uData; uniform mat4 uMS; uniform float uPart;
attribute vec4 skinIndex; attribute vec4 skinWeight; attribute vec3 aM0; attribute vec3 aM1; attribute vec3 aM2; attribute float aAO; attribute vec4 aReg; attribute vec4 aExt; attribute float aPid;
#ifdef HAIR
attribute float aLayer; varying float vLayer;
#endif
varying vec3 vN; varying vec3 vW; varying vec3 vB; varying float vAO; varying vec4 vReg; varying vec4 vExt; varying vec2 vUv; varying vec3 vT; varying vec3 vLoc; varying vec2 vCov; flat varying int vPid;
varying vec3 vSock; varying vec3 vLk; varying vec3 vVi; varying float vLid;
${RIG}
${EYEC}
mat4 boneM(int b, int r) { ivec2 c = ivec2(b * 3, r); vec4 a = texelFetch(uBones, c, 0), q = texelFetch(uBones, c + ivec2(1, 0), 0), d = texelFetch(uBones, c + ivec2(2, 0), 0);
  return mat4(a.x, q.x, d.x, 0., a.y, q.y, d.y, 0., a.z, q.z, d.z, 0., a.w, q.w, d.w, 1.); }
vec4 dataT(int i, int r) { return texelFetch(uData, ivec2(i, r), 0); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1., 0., 0., 0., c, s, 0., -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0., -s, 0., 1., 0., s, 0., c); }
float g2(vec3 q, vec3 c, float r) { vec3 d = q - c; return exp(-dot(d, d) / (r * r)); }
// procedural face blendshapes in bind space: ex = (smile, jaw open, brow raise, -), ageK = jowls + thinner lips
vec3 faceDeform(vec3 p, vec4 ex, float ageK) {
  vec3 d = vec3(0.0); if (p.y < 1.49 || p.y > 1.71 || p.z < -0.01) return d;
  float sx = p.x < 0.0 ? -1.0 : 1.0; vec3 q = vec3(abs(p.x), p.y, p.z);
  float wc = g2(q, vec3(0.0245, 1.5786, 0.083), 0.0105), wk = g2(q, vec3(0.037, 1.601, 0.074), 0.014), wl = g2(q, vec3(0.033, 1.6385, 0.071), 0.0075) * step(q.y, 1.6445);
  d += (wc * vec3(sx * 0.0013, 0.0024, -0.0009) + wk * vec3(sx * 0.0004, 0.0012, 0.0006) + wl * vec3(0.0, 0.0007, 0.0002)) * ex.x;
  d.y += exp(-pow((q.x - 0.032) / 0.022, 2.0) - pow((q.y - 1.676) / 0.008, 2.0)) * smoothstep(0.05, 0.07, q.z) * 0.0016 * ex.z;
  float wj = g2(q, vec3(0.046, 1.556, 0.045), 0.015), wlp = exp(-pow(q.x / 0.022, 4.0) - pow((q.y - 1.5768) / 0.008, 2.0)) * smoothstep(0.075, 0.085, q.z);
  d += (wj * vec3(sx * 0.0012, -0.0018, 0.0002) + wlp * vec3(0.0, (1.5768 - q.y) * 0.3, -0.0012)) * ageK;
  float ja = ex.y * 0.11;
  if (ja > 0.0) { float yl = 1.5768 + 0.0011 * pow(min(1.0, q.x / 0.0236), 3.0);
    float w = smoothstep(yl + 0.0011, yl - 0.0011, q.y) * smoothstep(-0.03, 0.02, q.z) * (1.0 - smoothstep(0.05, 0.072, q.x)) * smoothstep(1.50, 1.535, q.y);
    vec3 r = p + d - vec3(0.0, 1.612, -0.008); float c = cos(ja * w), s = sin(ja * w); d += vec3(r.x, c * r.y - s * r.z, s * r.y + c * r.z) - r; }
  return d; }
void main() {
  int row = int(aPid + 0.5); vPid = row;
  vec3 mw = (uMS * dataT(5, row)).xyz;
  vec3 pos = position + aM0 * mw.x + aM1 * mw.y + aM2 * mw.z; vec3 nrm = normal; vB = position; vLoc = vec3(0.); vCov = vec2(0.); vSock = vec3(0.); vLk = vec3(0., 0., 1.); vVi = vec3(0., 0., 1.); vLid = 0.;
  vec3 tng = aExt.xyz; vec4 dyn = texelFetch(uBones, ivec2(${DYN}, row), 0), dyn2 = texelFetch(uBones, ivec2(${DYN + 1}, row), 0); float seated = dyn.w;
  mat3 Rm = mat3(1.0);
#ifdef FACE
  pos += faceDeform(position, dyn2, dataT(9, row).w);
#endif
#ifdef CLOTH
  { float sl = aExt.x; if (seated > 0.5 && (sl < 0.5 || sl > 8.5) && aExt.w < 3.5) pos -= nrm * 0.032 * smoothstep(0.955, 0.915, position.y); } // shirt tucked behind the waistband when seated
#endif
#ifdef BODY
  { vec4 g6 = dataT(6, row); float neck = g6.w > 0.5 ? aReg.w : aReg.z;
    float hemY = seated > 0.5 ? max(g6.y, 0.95) : g6.y;
    float cT = step(0.0, g6.x) * smoothstep(0.0, 0.035, g6.x - aReg.x) * smoothstep(0.0, 0.035, position.y - hemY) * smoothstep(-0.007, 0.012, -neck);
    float cB = step(0.0, g6.z) * smoothstep(0.0, 0.035, g6.z - aReg.y) * smoothstep(0.0, 0.03, 1.0 - position.y) * step(aReg.x, -0.04);
    vCov = vec2(cT, cB); if (uPart < 0.5) pos -= nrm * max(cT, cB) * 0.013; }
#endif
#ifdef EYE
  { float kind = aReg.x, side = aReg.y; vec3 c = vec3(side * ${LM.EYE[0].toFixed(4)}, ${LM.EYE[1].toFixed(4)}, ${LM.EYE[2].toFixed(4)}); vec3 lp = pos - c;
    if (kind < 0.5) Rm = rotY(dyn.y - side * dyn2.w) * rotX(dyn.z); else if (kind < 2.5) Rm = rotX(dyn.x * ECLOSE);
    vLoc = lp / ER; vec3 rp = Rm * lp; vSock = rp / ER; vLid = dyn.x; pos = c + rp; nrm = Rm * nrm; }
#endif
#ifdef HAIR
  vLayer = aLayer; pos += nrm * aLayer * 0.0024 * (0.4 + 0.6 * aExt.w);
#endif
  mat4 S = boneM(int(skinIndex.x), row) * skinWeight.x + boneM(int(skinIndex.y), row) * skinWeight.y + boneM(int(skinIndex.z), row) * skinWeight.z + boneM(int(skinIndex.w), row) * skinWeight.w;
  vec4 sp = S * vec4(pos, 1.0); mat3 S3 = mat3(S);
  vec4 wp = modelMatrix * sp; vW = wp.xyz; vN = normalize(mat3(modelMatrix) * (S3 * nrm)); vT = normalize(mat3(modelMatrix) * (S3 * tng + 1e-5));
#ifdef EYE
  { mat3 Mw = mat3(modelMatrix) * S3 * Rm; vec3 V = normalize(cameraPosition - vW), up, K, F, Rr; rig(V, up, K, F, Rr); mat3 Mt = transpose(Mw); vLk = normalize(Mt * K); vVi = normalize(Mt * V); }
#endif
  vAO = aAO; vReg = aReg; vExt = aExt; vUv = uv;
  vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
const FS_COMMON = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>
uniform highp sampler2D uData; uniform highp sampler2D uBones; uniform float uK; uniform float uPart; uniform vec3 uSky; uniform vec3 uGnd; uniform vec3 uKey; uniform vec3 uFill; uniform vec3 uRim; uniform float uACut;
${RIG}
${EYEC}
varying vec3 vN; varying vec3 vW; varying vec3 vB; varying float vAO; varying vec4 vReg; varying vec4 vExt; varying vec2 vUv; varying vec3 vT; varying vec3 vLoc; varying vec2 vCov; flat varying int vPid;
varying vec3 vSock; varying vec3 vLk; varying vec3 vVi; varying float vLid;
float oA = 1.0;
vec4 dataT(int i) { return texelFetch(uData, ivec2(i, vPid), 0); }
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y), mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float fbm(vec3 p) { return vn(p) * 0.55 + vn(p * 2.03) * 0.3 + vn(p * 4.1) * 0.15; }
vec3 bump(vec3 N, vec3 P, float h, float k) { vec3 dx = dFdx(P), dy = dFdy(P); float hx = dFdx(h), hy = dFdy(h); vec3 r1 = cross(dy, N), r2 = cross(N, dx); float det = dot(dx, r1); if (abs(det) < 1e-12) return N; vec3 g = sign(det) * (hx * r1 + hy * r2); return normalize(abs(det) * N - k * g); }
float aaf(float freq) { return 1.0 - smoothstep(0.25, 0.6, fwidth(freq)); } // fade patterns that would alias
struct Lit { vec3 N; vec3 V; vec3 L; vec3 F; vec3 Rr; vec3 up; vec3 amb; float nl; };
Lit lightSetup(vec3 N) { Lit l; l.N = N; l.V = normalize(cameraPosition - vW); rig(l.V, l.up, l.L, l.F, l.Rr); l.nl = dot(N, l.L); l.amb = mix(uGnd, uSky, dot(N, l.up) * 0.5 + 0.5); return l; }
vec3 envC(vec3 R, Lit l) { return mix(uGnd, uSky, dot(R, l.up) * 0.5 + 0.5) + uKey * pow(max(dot(R, l.L), 0.0), 10.0) * 0.7 + uFill * pow(max(dot(R, l.F), 0.0), 6.0) * 0.35; }
float ggxD(float NoH, float a) { float a2 = a * a; float d = NoH * NoH * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
float smithV(float NoV, float NoL, float a) { float k = a * 0.5; return 0.25 / ((NoV * (1.0 - k) + k) * (NoL * (1.0 - k) + k)); }
float lidUpG(float lx) { float o = lx - EC0 + 0.0012; float t = clamp(o / (EW + 0.0012 * sign(o)), -1.0, 1.0); return EUP * pow(max(0.0, 1.0 - t * t), 0.72) + ETILT * (lx - EC0); }
float lidLoG(float lx) { float o = lx - EC0 - 0.0015; float t = clamp(o / (EW - 0.0015 * sign(o)), -1.0, 1.0); return ELO * pow(max(0.0, 1.0 - t * t), 0.9) + ETILT * (lx - EC0); }
vec3 finish(vec3 c) { return c * uK; }
`;
const FS_TAIL = /* glsl */`
  if (oA < uACut) discard;
  gl_FragColor = vec4(col, oA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
// ---- skin (body / head / hands / LOD2 figure): pre-integrated-style curvature scattering, two-lobe GGX with a spec mask, coloured AO, ear / nose back-scatter
const FS_SKIN = FS_COMMON + /* glsl */`
uniform sampler2D uFace;
vec3 sssD(float nl, float c) { vec3 w = vec3(0.26, 0.10, 0.07) + c * vec3(0.42, 0.17, 0.12); vec3 d = clamp((vec3(nl) + w) / (1.0 + w), 0.0, 1.0); return mix(d, d * d * (3.0 - 2.0 * d), 0.5); }
float skinSpec(vec3 N, vec3 V, vec3 L, float rgh, float NoV) { vec3 H = normalize(L + V); float NoL = max(dot(N, L), 0.0), NoH = max(dot(N, H), 0.0), VoH = max(dot(V, H), 0.0);
  float a1 = rgh * rgh, a2 = (rgh + 0.27) * (rgh + 0.27); float D = 0.85 * ggxD(NoH, a1) + 0.15 * ggxD(NoH, a2); float F = 0.028 + 0.972 * pow(1.0 - VoH, 5.0);
  return D * smithV(NoV, NoL, a1) * F * NoL; }
float gs2(vec2 p, vec2 c, vec2 r) { vec2 d = (p - c) / r; return exp(-dot(d, d)); }
void main() {
  #include <logdepthbuf_fragment>
  vec4 d0 = dataT(0), d1 = dataT(1), d9 = dataT(9); vec3 skin = d0.rgb; vec3 hairC = d1.rgb; float age = d9.x; float skL = dot(skin, vec3(0.2126, 0.7152, 0.0722));
  vec3 N = normalize(vN); float ao = vAO, wet = 0.0; float dist = length(cameraPosition - vW);
  float n1 = vn(vB * 900.), n2 = fbm(vB * 55.), n3 = vn(vB * 260.);
  vec3 alb = skin * (0.97 + 0.06 * n2);
  float hb = ((n1 - 0.5) * 0.3 + (n3 - 0.5) * 0.25) * (1.0 - smoothstep(0.7, 1.5, dist));
  bool head = uPart > 0.5 && uPart < 1.5, fig = uPart > 2.5;
  float spm = 0.5, rgh = 0.42, thin = 0.0, curv = clamp(vExt.x, 0.0, 1.0);
  if (head || fig) {
    vec4 f = texture2D(uFace, vec2((mod(d0.w, 4.) + clamp(vUv.x, 0.01, 0.99)) * 0.25, 1.0 - (floor(d0.w / 4.) + 1.0 - clamp(vUv.y, 0.01, 0.99)) * 0.5));
    float front = smoothstep(0.0, 0.05, vB.z); vec2 q = vec2(abs(vB.x), vB.y);
    float fh = smoothstep(1.665, 1.70, vB.y) * front;
    float nose = (1.0 - smoothstep(0.007, 0.016, q.x)) * smoothstep(1.59, 1.6, vB.y) * (1.0 - smoothstep(1.62, 1.64, vB.y)) * step(0.082, vB.z);
    float ear = smoothstep(0.066, 0.078, q.x) * step(1.6, vB.y) * step(vB.y, 1.68);
    float red = max(max(gs2(q, vec2(0.043, 1.607), vec2(0.016)) * front, nose), ear);
    alb *= mix(vec3(1.0), vec3(1.02, 1.0, 0.95), fh) * mix(vec3(1.0), vec3(1.05, 0.93, 0.92), red * 0.55);
    alb *= 1.0 - f.r * 0.45 * front;
    float lip = smoothstep(0.35, 0.8, f.g) * front;
    vec3 lipC = skin * mix(vec3(1.02, 0.70, 0.69), vec3(0.86, 0.64, 0.62), 1.0 - smoothstep(0.04, 0.2, skL)) + vec3(d9.y * 0.06, 0.0, 0.008);
    alb = mix(alb, lipC, lip);
    alb = mix(alb, alb * vec3(1.03, 0.9, 0.89), clamp(f.g * 2.2, 0., 1.) * (1.0 - smoothstep(0.35, 0.6, f.g)) * front * 0.5);
    alb = mix(alb, hairC * 0.7 + skin * 0.08, f.b * 0.8 * front);
    spm = 0.5 + 0.35 * fh + 0.45 * nose + 0.25 * gs2(q, vec2(0.046, 1.628), vec2(0.012, 0.008)) + 0.45 * lip - 0.25 * gs2(q, vec2(0.04, 1.594), vec2(0.016, 0.014));
    rgh = mix(0.42, 0.3, lip); thin = max(ear, nose);
    if (head) {
      float lid = vReg.x;
      if (lid > 0.2) { float up = step(${LM.EYE[1].toFixed(4)}, vB.y); float k = smoothstep(0.3, 0.9, lid);
        alb = mix(alb, mix(skin * vec3(0.98, 0.64, 0.62), hairC * 0.25 + 0.012, up), k); ao *= mix(1.0, 0.55, up * k); wet = (1.0 - up) * k; }
      float scalp = vReg.y, beard = vReg.z; float stub = clamp(d1.w * 3.0, 0.0, 1.0);
      alb = mix(alb, mix(alb, hairC * 0.45 + skin * 0.3, 0.7), scalp * d9.z);
      alb = mix(alb, mix(alb, alb * vec3(0.8, 0.82, 0.86) * 0.88 + hairC * 0.1, 0.5 + 0.2 * n1), beard * stub);
      hb += (vn(vB * 2600.) - 0.5) * beard * stub * 0.6 * (1.0 - smoothstep(0.6, 1.2, dist));
    }
    if (fig) { // painted face at distance: soft eye shadow and a dark iris dot, never white
      for (int s = -1; s <= 1; s += 2) { vec2 e = vec2(float(s) * 0.032, 1.647);
        alb *= 1.0 - 0.3 * gs2(vB.xy, e + vec2(0.0, 0.001), vec2(0.012, 0.006)) * front;
        alb = mix(alb, vec3(0.05, 0.035, 0.028), (1.0 - smoothstep(0.0018, 0.0042, length(vB.xy - e))) * front * 0.75); }
      vec4 g6 = dataT(6); alb = mix(alb, dataT(2).rgb, vCov.x); alb = mix(alb, dataT(3).rgb, vCov.y * (1.0 - vCov.x)); alb = mix(alb, dataT(4).rgb, 1.0 - smoothstep(0.1, 0.115, vB.y));
    }
  }
  // V of a jacket: shirt and tie area painted on the body
  if (uPart < 0.5 || uPart > 2.5) { vec4 g6 = dataT(6); if (g6.w > 0.5 && vReg.w > 0.0 && vB.y < 1.47 && vB.y > 1.0) { alb = dataT(8).rgb * (0.92 + 0.08 * n2); hb = (vn(vB * 1400.) - 0.5) * 0.4; ao *= 0.9 + 0.1 * smoothstep(0.0, 0.02, vReg.w); spm = 0.0; } }
  N = bump(N, vW, hb * 0.00025, 1.0);
  Lit l = lightSetup(N); float NoV = max(dot(N, l.V), 1e-3);
  float boost = 1.0 + 1.4 * (1.0 - smoothstep(0.03, 0.22, skL)); // darker skin: stronger fill and rim so the planes always read
  float aoD = mix(1.0, ao, 0.6); vec3 aoA = pow(vec3(mix(1.0, ao, 0.92)), vec3(0.78, 1.0, 1.08));
  vec3 dif = uKey * sssD(dot(N, l.L), curv) + uFill * sssD(dot(N, l.F), curv) * boost + uRim * max(dot(N, l.Rr), 0.0) * (0.5 + 0.5 * boost);
  vec3 trans = skin * vec3(1.0, 0.32, 0.18) * uKey * pow(clamp(dot(l.V, -l.L) * 0.5 + 0.5, 0.0, 1.0), 4.0) * thin * 0.6;
  vec3 col = alb * (l.amb * aoA + dif * aoD) + trans;
  vec3 sp = skinSpec(N, l.V, l.L, rgh, NoV) * uKey + skinSpec(N, l.V, l.F, rgh, NoV) * uFill * boost + skinSpec(N, l.V, l.Rr, rgh, NoV) * uRim * (0.6 + 0.5 * boost);
  col += sp * spm * (0.35 + 0.65 * ao);
  float Fv = 0.028 + 0.972 * pow(1.0 - NoV, 5.0); col += envC(reflect(-l.V, N), l) * Fv * 0.3 * spm * ao;
  if (wet > 0.0) { vec3 H = normalize(l.L + l.V); col += uKey * pow(max(dot(N, H), 0.0), 140.0) * 0.9 * wet + envC(reflect(-l.V, N), l) * 0.06 * wet; }
  col = finish(col);
` + FS_TAIL;
const FS_CLOTH = FS_COMMON + /* glsl */`
void main() {
  #include <logdepthbuf_fragment>
  float slot = vExt.x, hemF = vExt.y, edge = vExt.z, kind = vExt.w; vec3 N = normalize(vN); float ao = vAO; if (!gl_FrontFacing) ao *= 0.8;
  vec4 d2 = dataT(2), d3 = dataT(3), d4 = dataT(4), d7 = dataT(7), d8 = dataT(8);
  vec3 alb; float fab = 0.0; float rough = 0.85, sheenK = 0.25, specK = 0.03;
  if (slot < 0.5) { alb = d2.rgb; fab = d2.w; } else if (slot < 1.5) { alb = d3.rgb; fab = d3.w + 10.0; } else if (slot < 2.5) { alb = d4.rgb; fab = 20.0; } else if (slot < 3.5) { alb = vec3(d4.w); fab = 21.0; }
  else if (slot < 4.5) { alb = d7.rgb; fab = 30.0; } else if (slot < 5.5) { alb = d8.rgb; fab = 0.0; } else if (slot < 6.5) { alb = d2.rgb; fab = 1.0; } else if (slot < 7.5) { alb = vec3(0.035, 0.037, 0.04); fab = 40.0; } else if (slot < 8.5) { alb = d7.rgb; fab = 41.0; } else { alb = vec3(0.85, 0.95, 0.05); fab = 4.0; }
  if (kind > 10.5 && kind < 11.5) { alb = mix(vec3(0.5, 0.12, 0.1), vec3(0.1, 0.22, 0.45), step(0.5, fract(d7.w * 3.7))); fab = 42.0; }
  if (kind > 13.5) { // service items and deck gear
    if (kind < 14.5) { alb = vec3(0.03, 0.04, 0.08); float st = dataT(8).w; float u = (abs(vB.x) - 0.075) / 0.011; if (st > 0.5 && u > 0.0 && u < st && fract(u) > 0.35) { alb = vec3(0.78, 0.58, 0.2); specK = 0.6; rough = 0.25; } fab = 40.0; }
    else if (kind < 15.5) { alb = vec3(0.55, 0.56, 0.58); fab = 40.0; specK = 0.1; }
    else if (kind < 16.5) { float f = h13(floor(vB * 9.0 + 0.5) + float(vPid)); alb = alb; if (vN.y < 0.0) f = 0.4; alb = f < 0.25 ? vec3(0.55, 0.3, 0.12) : f < 0.5 ? vec3(0.85, 0.8, 0.7) : f < 0.75 ? vec3(0.35, 0.5, 0.18) : vec3(0.7, 0.22, 0.12); fab = 40.0; specK = 0.15; }
    else if (kind < 17.5) { alb = vec3(0.62, 0.64, 0.67); fab = 40.0; specK = 0.35; rough = 0.35; }
    else if (kind < 18.5) { alb = vec3(0.07, 0.075, 0.08); fab = 40.0; specK = 0.15; }
    else { alb = vec3(0.86, 0.85, 0.82); fab = 40.0; specK = 0.1; }
  }
  float n1 = vn(vB * 1700.), n2 = fbm(vB * 45.), n3 = vn(vB * 420.);
  float h = 0.0;
  // weave / material
  if (fab < 0.5) { h = (n1 - 0.5) * 0.6 + (n3 - 0.5) * 0.3; alb *= 0.95 + 0.08 * n2; }                                  // cotton jersey
  else if (fab < 1.5) { h = (vn(vB * 2600.) - 0.5) * 0.5; alb *= 0.96 + 0.05 * n2; sheenK = 0.18; }                        // wool suiting
  else if (fab < 2.5) { h = (n1 - 0.5) * 0.9; alb *= 0.93 + 0.1 * n2; sheenK = 0.35; }                                     // fleece knit
  else if (fab < 3.5) { h = (n1 - 0.5) * 0.4; specK = 0.08; rough = 0.5; }                                                // synthetic
  else if (fab < 4.5) { float band = max(1.0 - smoothstep(0.012, 0.016, abs(vB.y - 1.02)), 1.0 - smoothstep(0.012, 0.016, abs(vB.y - 1.15)));
    alb = mix(vec3(0.82, 0.92, 0.04), vec3(0.62, 0.64, 0.66), band); specK = band * 0.5; h = (n1 - 0.5) * 0.5; }               // hi-vis
  else if (fab > 10.5 && fab < 11.5) { float tw = (vB.x + vB.y * 1.7 - vB.z * 0.6) * 1600.; float a = aaf(tw * 0.159);
    h = sin(tw) * 0.5 * a + (n1 - 0.5) * 0.4; alb *= 0.86 + 0.18 * n2 + 0.08 * sin(tw) * a; alb = mix(alb, alb * 1.25 + 0.03, smoothstep(0.62, 0.9, fbm(vB * 9.)) * 0.35); } // denim
  else if (fab > 9.5 && fab < 12.5) { h = (vn(vB * 2200.) - 0.5) * 0.45; alb *= 0.95 + 0.06 * n2; }                       // trousers
  else if (fab > 19.5 && fab < 20.5) { h = (n3 - 0.5) * 0.5; if (kind > 4.5 && kind < 5.5) { specK = 0.35; rough = 0.25; sheenK = 0.05; } else { specK = 0.06; } } // shoe upper
  else if (fab > 20.5 && fab < 21.5) { h = (n3 - 0.5) * 0.3; specK = 0.05; }
  else if (fab > 29.5 && fab < 30.5) { h = (n1 - 0.5) * 0.4; specK = 0.12; sheenK = 0.3; }
  else if (fab > 39.5) { specK = 0.4; rough = 0.2; sheenK = 0.05; }
  // folds (compression waves near elbows, knees, ankles; waist bunching) — baked as AO + bump
  float fold = 0.0;
  if (slot < 0.5 && vReg.x > 0.18) fold += sin(vReg.x * 140. + n2 * 6.0) * smoothstep(0.17, 0.27, vReg.x) * (1.0 - smoothstep(0.32, 0.42, vReg.x));
  if (slot > 0.5 && slot < 1.5) { fold += sin(vReg.y * 120. + vB.x * 30. + n2 * 5.0) * (smoothstep(0.62, 0.8, vReg.y) + 0.6 * smoothstep(0.34, 0.42, vReg.y) * (1.0 - smoothstep(0.46, 0.54, vReg.y))); }
  if (slot < 0.5 && kind < 2.5) fold += sin(atan(vB.x, vB.z) * 14. + n2 * 4.0) * (1.0 - smoothstep(0.0, 0.06, edge)) * step(vB.y, 1.0) * 0.6;
  h += fold * 1.6; ao *= 1.0 - max(0.0, -fold) * 0.16;
  // hems, cuffs, seams, details
  if (hemF > 0.1) { ao *= 0.86; h += 0.0; }
  float nearEdge = 1.0 - smoothstep(0.012, 0.022, edge);
  if (fab > 1.5 && fab < 2.5 && edge < 0.05) { float rib = sin(atan(vB.x, vB.z) * 90.0 + vB.y * 200.); h += rib * 0.6 * aaf(vB.x * 15.); ao *= 0.95; }
  if (slot < 0.5 && kind < 0.5) ao *= 1.0 - nearEdge * 0.12;
  if (slot < 1.5) { float seam = 1.0 - smoothstep(0.0012, 0.003, abs(abs(vB.x) - 0.165) * step(1.0, 1.0)); if (slot < 0.5) { float sh = 1.0 - smoothstep(0.002, 0.005, abs(vReg.x - 0.012)); ao *= 1.0 - sh * 0.3 * step(-0.05, vReg.x); } }
  if (slot > 0.5 && slot < 1.5) { // waistband, belt, fly
    float wb = smoothstep(0.955, 0.962, vB.y); ao *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.004, abs(vB.y - 0.958)));
    float belt = step(0.5, fract(d3.w * 0.0 + float(vPid) * 0.37)) * step(fab, 11.5) * smoothstep(0.962, 0.966, vB.y) * (1.0 - smoothstep(0.988, 0.992, vB.y));
    alb = mix(alb, vec3(0.05, 0.035, 0.025), belt); if (belt > 0.5 && abs(vB.x) < 0.022 && vB.z > 0.05) { alb = vec3(0.55, 0.5, 0.42); specK = 0.6; rough = 0.2; }
    float fly = (1.0 - smoothstep(0.0015, 0.003, abs(vB.x - 0.012))) * step(0.86, vB.y) * step(vB.y, 0.955) * step(0.05, vB.z); ao *= 1.0 - fly * 0.35;
    if (fab > 10.5 && fab < 11.5) { float st = (1.0 - smoothstep(0.0008, 0.0016, abs(abs(vB.x) - 0.165))) * step(vB.y, 0.95); alb = mix(alb, vec3(0.55, 0.42, 0.18), st * 0.6); }
  }
  if (kind > 0.5 && kind < 1.5) { // tailored jacket: lapels, buttons, pocket flaps, sleeve stripes
    float lap = smoothstep(0.0, 0.004, edge) * (1.0 - smoothstep(0.032, 0.036, edge)) * step(1.12, vB.y) * step(0.0, vB.z); h += lap * 0.0; ao *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.003, abs(edge - 0.034))) * step(1.12, vB.y) * step(0.02, vB.z);
    alb *= 1.0 + lap * 0.06;
    for (int b = 0; b < 2; b++) { float by = 1.12 - float(b) * 0.1; float db = length(vec2(vB.x, vB.y - by)); if (vB.z > 0.05 && db < 0.009) { alb = vec3(0.04); specK = 0.5; rough = 0.2; ao *= smoothstep(0.009, 0.007, db) * 0.5 + 0.5; } }
    ao *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.003, abs(vB.y - 0.905))) * step(0.06, abs(vB.x)) * step(abs(vB.x), 0.14) * step(0.03, vB.z);
    float stripes = d8.w; if (stripes > 0.5 && vReg.x > 0.4) { float s = (vReg.x - 0.425) / 0.012; float k = step(0.0, s) * step(s, stripes) * step(0.3, fract(s)); alb = mix(alb, vec3(0.8, 0.6, 0.2), k); specK = mix(specK, 0.5, k); }
  }
  if (kind > 1.5 && kind < 2.5 && vB.z > 0.05) { float pk = (1.0 - smoothstep(0.002, 0.005, abs(abs(vB.x) - 0.12 + (vB.y - 0.88) * 0.3))) * step(0.87, vB.y) * step(vB.y, 1.02); pk = max(pk, (1.0 - smoothstep(0.002, 0.005, abs(vB.y - 1.02))) * step(abs(vB.x), 0.1)); ao *= 1.0 - pk * 0.3; }
  if (kind > 5.5 && kind < 6.5 && slot > 1.5 && slot < 2.5) { float side = sign(vB.x); float lx = abs(vB.x - side * 0.103); if (lx < 0.016 && vB.z > 0.0 && vB.z < 0.1 && vReg.x > vReg.z + 0.035) { float lace = step(0.5, fract(vB.z * 70.)); alb = mix(alb, vec3(0.9), 0.85); h += lace; ao *= 0.85 + 0.15 * lace; } }
  if (slot > 1.5 && slot < 3.5) ao *= 0.75 + 0.25 * smoothstep(0.0, 0.012, vB.y);
  if (kind > 9.5 && kind < 10.5 && vReg.x < -0.05) { vec3 nb = normalize(vN); }
  N = bump(N, vW, h * 0.00022, 1.0);
  Lit l = lightSetup(N);
  float dif = max(0.0, (l.nl + 0.3) / 1.3); float NoV = max(dot(N, l.V), 0.0);
  vec3 H = normalize(l.L + l.V); float spec = pow(max(dot(N, H), 0.0), mix(8.0, 90.0, 1.0 - rough)) * specK * ao;
  float sheen = pow(1.0 - NoV, 2.2) * sheenK;
  vec3 col = alb * (l.amb * (0.3 + 0.7 * ao) + uKey * dif * (0.45 + 0.55 * ao) + uFill * clamp((dot(N, l.F) + 0.3) / 1.3, 0.0, 1.0) * (0.5 + 0.5 * ao) + uRim * max(dot(N, l.Rr), 0.0) * 0.45 * ao) + (uKey * spec + l.amb * sheen * alb * 1.5);
  // phone screen glow
  if (kind > 9.5 && kind < 10.5 && slot > 6.5 && slot < 7.5 && abs(vB.z) > 0.003 && vB.z > 0.0 && abs(vB.x) < 0.032 && abs(vB.y) < 0.066) col = mix(col, vec3(0.35, 0.45, 0.6) * (0.7 + 0.3 * n2), 0.85);
  if (kind > 10.5 && kind < 11.5 && (abs(abs(vB.x) - 0.075) < 0.003 || abs(abs(vB.y) - 0.1075) < 0.003) && abs(vB.z) < 0.011) col = vec3(0.85, 0.83, 0.78) * l.amb * 1.4;
  col = finish(col);
` + FS_TAIL;
// ---- hair (anisotropic, strand alpha, shells)
// ---- hair: sculpted base shell with a painted strand texture (no fur-shell speckle), strand cards on top (aReg.x = 1, uv across / along),
// beards (aExt.w < 0). Edges fade with strand-shaped alpha through alpha-to-coverage (MSAA) or a 0.5 alpha test without it.
const FS_HAIR = FS_COMMON + /* glsl */`
varying float vLayer;
void main() {
  #include <logdepthbuf_fragment>
  vec4 d1 = dataT(1); vec3 hc = d1.rgb; vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N; vec3 T = normalize(vT);
  float card = step(0.5, vReg.x), beard = step(vExt.w, 0.0) * (1.0 - card), edge = abs(vExt.w);
  vec3 tb = normalize(vExt.xyz + 1e-5); vec3 q = vB - tb * dot(vB, tb);
  float fine = 1.0 - smoothstep(0.3, 0.9, length(fwidth(vB)) * 1600.0);
  float strand = mix(0.5, vn(q * 1600.) * 0.55 + vn(q * 520.) * 0.45, fine), clump = fbm(q * 110. + tb * 5.0);
  float root = 1.0;
  if (card > 0.5) { float u = vUv.x, v = vUv.y, w = abs(u - 0.5) * 2.0, tip = 1.0 - v * v * 0.6;
    float s2 = vn(vec3(u * 24.0 + vReg.y * 7.0, v * 1.3, vReg.y * 13.0)) * 0.65 + vn(vec3(u * 61.0, v * 2.5, vReg.y)) * 0.35;
    oA = smoothstep(tip, tip - 0.4, w) * smoothstep(0.0, 0.15, v) * smoothstep(0.25, 0.6, s2 + 0.2 - v * 0.25);
    strand = mix(strand, s2, 0.6); root = mix(0.72, 1.0, smoothstep(0.0, 0.45, v)); }
  else if (beard > 0.5) oA = smoothstep(0.08, 0.6, edge + (strand - 0.5) * 0.55);
  else oA = smoothstep(0.02, 0.5, edge + (strand - 0.5) * 0.4 - 0.04);
  float lum = dot(hc, vec3(0.2126, 0.7152, 0.0722));
  vec3 alb = hc * (0.76 + 0.36 * strand) * (0.88 + 0.22 * clump) * root * mix(1.0, 0.8, beard);
  N = bump(N, vW, (strand * 0.5 + clump) * 0.0005 * fine, 1.0);
  Lit l = lightSetup(N);
  float dif = clamp((l.nl + 0.5) / 1.5, 0.0, 1.0), dfF = clamp((dot(N, l.F) + 0.5) / 1.5, 0.0, 1.0);
  vec3 H = normalize(l.L + l.V); float sh = (strand - 0.5) * 0.2 + (clump - 0.5) * 0.25;
  vec3 T1 = normalize(T + N * (0.1 + sh)), T2 = normalize(T + N * (-0.18 + sh));
  float th1 = dot(T1, H), th2 = dot(T2, H), thr = dot(T1, normalize(l.Rr + l.V));
  float s1 = pow(sqrt(max(0.0, 1.0 - th1 * th1)), 80.0) * 0.3 * (0.4 + 1.2 * strand), s2 = pow(sqrt(max(0.0, 1.0 - th2 * th2)), 20.0) * 0.2 * (0.5 + clump);
  float sr = pow(sqrt(max(0.0, 1.0 - thr * thr)), 30.0) * 0.3;
  vec3 specC = mix(vec3(1.0), hc * 2.0 + 0.1, 0.25) * mix(1.0, 0.55, smoothstep(0.3, 0.6, lum));
  float ao = vAO;
  vec3 col = alb * (l.amb * (0.42 + 0.58 * ao) + uKey * dif * (0.55 + 0.45 * ao) + uFill * dfF * 0.8 * ao + uRim * max(dot(N, l.Rr), 0.0) * 0.7)
    + (uKey * (s1 * specC + s2 * hc * 1.6) * smoothstep(-0.2, 0.3, l.nl) + uRim * sr * (hc + 0.12)) * ao * mix(1.0, 0.4, beard);
  col = finish(col);
` + FS_TAIL;
// ---- eyes: eyeball (sclera capped by the skin tone, iris with parallax, limbal ring, collarette and caustic), occlusion term tied to the lid positions,
// cornea glint from the key light and a 4% environment reflection; blink lid with a lash line; alpha-tested lash cards; corner filler with the caruncle.
const FS_EYE = FS_COMMON + /* glsl */`
vec3 irisCol(float k) { return k < 0.5 ? vec3(0.10, 0.05, 0.022) : k < 1.5 ? vec3(0.2, 0.105, 0.04) : k < 2.5 ? vec3(0.26, 0.19, 0.075) : k < 3.5 ? vec3(0.16, 0.27, 0.40) : k < 4.5 ? vec3(0.16, 0.25, 0.12) : vec3(0.3, 0.33, 0.36); }
void main() {
  #include <logdepthbuf_fragment>
  vec4 d0 = dataT(0), d1 = dataT(1), d7 = dataT(7); vec3 skin = d0.rgb; float skL = dot(skin, vec3(0.2126, 0.7152, 0.0722));
  float kind = vReg.x, side = vReg.y; vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  Lit l = lightSetup(N); float dist = length(cameraPosition - vW), NoV = max(dot(N, l.V), 1e-3); vec3 col;
  if (kind > 1.5 && kind < 3.5) { // lashes
    float lower = step(2.5, kind), u = vUv.x, v = vUv.y; float st = vn(vec3(u * mix(140.0, 60.0, lower), v * 1.5, side * 5.0));
    oA = (1.0 - smoothstep(0.4, 1.0, v)) * smoothstep(0.0, 0.1, u) * (1.0 - smoothstep(0.9, 1.0, u)) * mix(1.0, 0.55, lower) * (0.45 + 0.8 * st);
    col = (d1.rgb * 0.3 + vec3(0.012, 0.009, 0.008)) * (l.amb * 0.7 + uKey * 0.35 * max(l.nl, 0.2));
  } else if (kind > 0.5 && kind < 1.5) { // blink lid
    float v = vUv.y; vec3 alb = skin * 0.93 * mix(vec3(0.97, 0.78, 0.76), vec3(1.0), smoothstep(0.0, 0.12, v));
    alb = mix(d1.rgb * 0.25 + 0.012, alb, smoothstep(0.012, 0.045, v));
    col = alb * (l.amb * 0.8 + uKey * clamp((l.nl + 0.4) / 1.4, 0.0, 1.0) * 0.85 + uFill * clamp((dot(N, l.F) + 0.4) / 1.4, 0.0, 1.0) * 0.8) * 0.85;
  } else { // eyeball (0) and corner filler (4)
    vec3 so = vSock * ER; float lx = so.x * side;
    float drop = max(0.0, vLid * ECLOSE - 0.035) * (ER + 0.0008), yU = lidUpG(lx) - drop, yL = lidLoG(lx), hgt = EUP - ELO;
    float occUp = mix(0.5, 1.0, smoothstep(0.0, 0.42 * hgt, yU - so.y)), cx = abs(lx - EC0) / EW, occC = mix(1.0, 0.62, smoothstep(0.5, 1.0, cx));
    float occ = occUp * occC * mix(0.8, 1.0, smoothstep(0.0, 0.15 * hgt, so.y - yL));
    vec3 tint = vec3(1.0, 0.93, 0.86); vec3 alb = tint * (min(0.6, 1.25 * skL) / dot(tint, vec3(0.2126, 0.7152, 0.0722)));
    float vein = smoothstep(0.62, 0.9, vn(vSock * 22.0 + side * 3.0)) * smoothstep(0.35, 0.95, cx); alb *= mix(vec3(1.0), vec3(1.0, 0.8, 0.78), vein * 0.4);
    alb = mix(alb, skin * vec3(1.08, 0.66, 0.66) + vec3(0.02, 0.0, 0.0), smoothstep(0.78, 0.98, cx) * step(lx, EC0) * 0.85);
    alb = mix(alb, skin * 0.9, smoothstep(4.0, 8.0, dist));
    if (kind < 0.5 && vLoc.z > 0.0) {
      vec2 p = vLoc.xy - vVi.xy / max(vVi.z, 0.3) * 0.04; float r = length(p), ang = atan(p.y, p.x);
      float pr = 0.196 * (1.06 - 0.12 * clamp(dot(uKey, vec3(0.33)) * uK, 0.0, 1.0)); vec3 ic = irisCol(d7.w);
      float fib = vn(vec3(ang * 11.0, r * 22.0, side * 4.0)) * 0.6 + vn(vec3(ang * 34.0, r * 9.0, 2.0)) * 0.4;
      vec3 irisC = ic * (0.62 + 0.75 * fib);
      irisC *= 1.0 + 0.55 * (1.0 - smoothstep(pr + 0.03, pr + 0.15, r)) * smoothstep(pr - 0.01, pr + 0.03, r);
      irisC = mix(irisC, ic * 0.25, smoothstep(EIRIS - 0.11, EIRIS - 0.02, r));
      irisC *= 1.0 + 0.8 * max(0.0, dot(normalize(p + 1e-4), -normalize(vLk.xy + 1e-4))) * smoothstep(0.1, 0.5, r) * max(0.0, vLk.z);
      irisC = mix(irisC, vec3(0.006), 1.0 - smoothstep(pr - 0.012, pr + 0.008, r));
      alb = mix(alb, irisC, 1.0 - smoothstep(EIRIS - 0.012, EIRIS + 0.012, length(vLoc.xy)));
    }
    col = alb * (l.amb * 0.85 + uKey * clamp((l.nl + 0.25) / 1.25, 0.0, 1.0) + uFill * clamp((dot(N, l.F) + 0.25) / 1.25, 0.0, 1.0) * 0.8) * occ;
    vec3 H = normalize(l.L + l.V), Hf = normalize(l.F + l.V);
    float g = pow(max(dot(N, H), 0.0), 700.0) * 3.0 * step(0.0, l.nl), gf = pow(max(dot(N, Hf), 0.0), 500.0) * 0.8, Fc = 0.04 + 0.96 * pow(1.0 - NoV, 5.0);
    float occS = mix(0.35, 1.0, smoothstep(0.0, 0.25 * hgt, yU - so.y)) * occC;
    col += (uKey * g + uFill * gf) * occS + envC(reflect(-l.V, N), l) * Fc * occ * 0.9;
  }
  col = finish(col);
` + FS_TAIL;

export function makeMaterials(U) {
  const base = (fs, defines, key, extra = {}) => { const m = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS_HEAD, fragmentShader: fs, defines, side: extra.side || THREE.FrontSide, extensions: { derivatives: true } });
    m.userData.key = key; atmos(m); return m; };
  const M = {};
  const mk = (name, fs, defines, part, side) => { const m = base(fs, defines, 'ppl-' + name, { side }); if (part != null) { m.uniforms = { ...U, uPart: { value: part }, uFace: { value: faceAtlas() } }; } M[name] = m; };
  mk('body', FS_SKIN, { BODY: '' }, 0); mk('head', FS_SKIN, { FACE: '' }, 1); mk('hands', FS_SKIN, {}, 2); mk('fig', FS_SKIN, { BODY: '' }, 3);
  mk('cloth', FS_CLOTH, { CLOTH: '' }, null, THREE.DoubleSide); mk('hair', FS_HAIR, { HAIR: '', FACE: '' }, null, THREE.DoubleSide); mk('eye', FS_EYE, { EYE: '' }, null, THREE.DoubleSide);
  M.cloth.uniforms = { ...U, uPart: { value: 0 } }; M.hair.uniforms = { ...U, uPart: { value: 0 } }; M.eye.uniforms = { ...U, uPart: { value: 0 } };
  M.hair.alphaToCoverage = true; M.eye.alphaToCoverage = true;
  // morph selectors: body-like (fem, heavy) vs head-like (fem, wide, nose)
  const bodySel = new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), headSel = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0);
  for (const k of ['body', 'hands', 'fig', 'cloth']) M[k].uniforms.uMS = { value: bodySel }; for (const k of ['head', 'hair', 'eye']) M[k].uniforms.uMS = { value: headSel };
  return M;
}
