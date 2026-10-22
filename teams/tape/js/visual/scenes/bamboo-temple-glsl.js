// bamboo-temple-glsl.js - shader pieces for the Kyoto bamboo & torii scene (bamboo-temple.js).
// One patch (btPatch) turns a three.js MeshStandardMaterial into a grove material: kit height fog + aerial perspective,
// a canopy "gobo" that dapples the direct sun on every surface (the same canopy the volumetric shafts are marched
// through), in-material volumetric sun shafts (raymarched against the real depth of each fragment), analytic lantern /
// andon / bamboo up-lights for the night, and per-kind procedural surfaces (culms with nodes and wax bloom, leaf cards
// with wind and translucency, ground with path stones and leaf litter, brushwood fences, lacquered torii, mossy stone).
import * as G from './kit-glsl.js?v=10';

/** Path centre line (x at z), mirrored on the CPU by pathX() in bamboo-temple.js. */
export const BT_COMMON = /* glsl */`
#ifndef BT_COMMON
#define BT_COMMON
uniform vec3 uBtSunDir, uBtSunCol, uBtLampCol, uBtUpCol;
uniform sampler2D uBtGobo;
uniform vec2 uBtGoboOff, uBtWindDir;
uniform float uBtCanopyH, uBtCanopyMix, uBtShaft, uBtShaftExt, uBtSwayAmp, uBtSwayPhase, uBtGustPhase, uBtTime, uBtAndon, uBtUp, uBtGroveEnd;
uniform vec4 uBtLamp[4];
float btPathX(float z) { return (1.7 * sin(z * 0.052 + 0.4) + 0.6 * sin(z * 0.13 + 1.9)) * smoothstep(-60.0, -38.0, z); }
// culm sway at the top (m): slow pendulum + travelling gusts + a steady lean down-wind
vec2 btSway(vec2 p, float s) {
  float ph = uBtSwayPhase * (0.82 + 0.36 * s) + s * 6.2832 + dot(p, vec2(0.071, 0.113));
  float gust = 0.55 + 0.45 * sin(uBtGustPhase + dot(p, vec2(0.045, 0.083)));
  return uBtSwayAmp * gust * (vec2(sin(ph), 0.55 * sin(ph * 1.37 + 1.1)) + uBtWindDir * 0.9);
}
#endif
`;

const BT_FRAG = /* glsl */`
#ifndef BT_FRAG
#define BT_FRAG
// canopy transmittance at a canopy-plane point q (= xz): sparse sun flecks, a brighter slit over the path, open beyond the grove
float btCanopy(vec2 q) {
  float grove = max(smoothstep(uBtGroveEnd - 5.0, uBtGroveEnd + 4.0, q.y), smoothstep(-71.0, -79.0, q.y));
  float dp = abs(q.x - btPathX(q.y));
  float gap = 1.0 - smoothstep(0.8, 5.0, dp);
  float n1 = texture2D(uBtGobo, q * 0.043 + uBtGoboOff).r;
  float n2 = texture2D(uBtGobo, q * 0.19 + uBtGoboOff * 2.6 + 0.37).g;
  float v = n1 * 0.62 + n2 * 0.38 + gap * 0.16;
  float holes = smoothstep(0.6, 0.67, v);
  return mix(1.0, holes, grove * uBtCanopyMix);
}
float btCanopyLo(vec2 q) {
  float grove = max(smoothstep(uBtGroveEnd - 5.0, uBtGroveEnd + 4.0, q.y), smoothstep(-71.0, -79.0, q.y));
  float gap = 1.0 - smoothstep(0.8, 5.0, abs(q.x - btPathX(q.y)));
  vec4 n = texture2D(uBtGobo, q * 0.043 + uBtGoboOff);
  float holes = smoothstep(0.56, 0.74, n.r * 0.75 + n.b * 0.25 + gap * 0.12);
  return mix(1.0, holes, grove * uBtCanopyMix);
}
float btSunVis(vec3 p) {
  float k = (uBtCanopyH - p.y) / max(uBtSunDir.y, 0.06);
  if (k <= 0.0) return 1.0;
  return btCanopy(p.xz + uBtSunDir.xz * k);
}
// volumetric sun shafts: march the view ray through the canopy-shadowed mist (denser near the ground)
vec3 btShafts(vec3 wpos, vec3 cam) {
  if (uBtShaft <= 0.0) return vec3(0.0);
  vec3 r = wpos - cam; float dist = length(r); vec3 rd = r / max(dist, 1e-4);
  float d = min(dist, 70.0);
  if (d < 0.3) return vec3(0.0);
  float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float acc = 0.0, prev = 0.0;
  for (int i = 1; i <= BT_STEPS; i++) {
    float u = (float(i) - j) / float(BT_STEPS);
    float s = d * u * u;
    vec3 p = cam + rd * s;
    float dens = exp(-max(p.y, 0.0) * 0.11) * mix(0.1, 1.0, smoothstep(uBtGroveEnd + 1.0, uBtGroveEnd + 16.0, p.z));
    float kk = (uBtCanopyH - p.y) / max(uBtSunDir.y, 0.06);
    float vis = kk <= 0.0 ? 1.0 : btCanopyLo(p.xz + uBtSunDir.xz * kk);
    acc += vis * dens * exp(-s * uBtShaftExt) * (s - prev);
    prev = s;
  }
  float ph = kPhaseHG(dot(rd, uBtSunDir), 0.5) * 0.7 + kPhaseHG(dot(rd, uBtSunDir), 0.1) * 0.3;
  return uBtSunCol * acc * ph * uBtShaft;
}
// night lights: 4 stone lanterns + periodic path andon (every 6 m, both sides) + bamboo up-lights behind the fences
vec3 btLamps(vec3 p, vec3 n) {
  vec3 e = vec3(0.0);
  if (uBtAndon + uBtLamp[0].w <= 0.0) return e;
  for (int i = 0; i < 4; i++) {
    vec3 L = uBtLamp[i].xyz - p; float d2 = dot(L, L);
    e += uBtLampCol * uBtLamp[i].w * max(dot(n, L * inversesqrt(d2)), 0.0) / (d2 + 0.08);
  }
  if (uBtAndon > 0.0 && p.z > uBtGroveEnd - 2.0) {
    float zc = floor(p.z / 6.0 + 0.5) * 6.0;
    float px = btPathX(zc); float side = sign(p.x - px + 1e-4);
    vec3 a = vec3(px + side * 1.82, 0.32, zc) - p; float d2 = dot(a, a);
    e += uBtLampCol * uBtAndon * 0.22 * max(dot(n, a * inversesqrt(d2)), 0.0) / (d2 + 0.05);
    // up-light: on the ground behind the fence, aimed up into the culms
    float zu = floor((p.z - 3.0) / 6.0 + 0.5) * 6.0 + 3.0;
    vec3 b = vec3(btPathX(zu) + side * 2.9, 0.05, zu) - p; float b2 = dot(b, b); vec3 bd = b * inversesqrt(b2);
    float cone = smoothstep(0.35, 0.8, -bd.y);
    e += uBtUpCol * uBtUp * cone * max(dot(n, bd), 0.0) / (b2 + 0.2);
  }
  return e;
}
#endif
`;

// ------------------------------------------------------------------------------------------------ culms
const CULM_VS_HEAD = /* glsl */`
attribute vec4 aC;   // base x, base z, height (m), radius (m)
attribute vec4 aL;   // lean x, lean z (m of offset per m of height at the top), seed, age
varying vec4 vCulm;  // h (m), dir.x, dir.y, v
varying vec4 vCS;    // seed, age, radius at h, H
varying vec3 vBtUp;
`;
const CULM_NORMAL = /* glsl */`
  float btV = position.y, btH = aC.z, btHm = btV * btH;
  vec3 objectNormal = normalize(vec3(position.x, 0.0, position.z));
`;
const CULM_BEGIN = /* glsl */`
  float btR = aC.w * (1.0 - 0.5 * pow(max(btV, 0.0), 1.5)) * (1.0 + 0.22 * exp(-btHm * 2.5));
  #ifdef BT_STUMP
    btR = aC.w;
  #endif
  vec2 btBend = aL.xy * (btHm * btHm / max(btH, 1.0));
  vec2 btSw = btSway(aC.xy, aL.z) * btV * btV;
  vec3 transformed = vec3(aC.x + btBend.x + btSw.x, btHm - 0.12, aC.y + btBend.y + btSw.y) + vec3(position.x, 0.0, position.z) * btR;
  vCulm = vec4(btHm, uv.x, position.z, btV); vCS = vec4(aL.z, aL.w, btR, btH);
  vec3 btAx = normalize(vec3(2.0 * aL.x * btHm / max(btH, 1.0) + 2.0 * btSw.x / max(btH, 1.0), 1.0, 2.0 * aL.y * btHm / max(btH, 1.0) + 2.0 * btSw.y / max(btH, 1.0)));
  vBtUp = normalize((viewMatrix * vec4(btAx, 0.0)).xyz);
`;
const CULM_FS_HEAD = /* glsl */`
varying vec4 vCulm; varying vec4 vCS; varying vec3 vBtUp;
uniform sampler2D tBtCulm;
float btRidge = 0.0, btRough = 0.45, btBumpS = 0.0;
`;
const CULM_MAP = /* glsl */`
  {
  float h = vCulm.x, sd = vCS.x, age = vCS.y;
  vec4 T = texture2D(tBtCulm, vec2(vCulm.y + sd * 3.1, h / 4.0 + sd * 7.3));
  float fib = T.r, m = T.g, lich = T.b, dark = T.a;
  float k = 0.86 + 0.32 * sd;
  float s = (h / 0.40 + 5.5 * (1.0 - exp(-h))) * k + sd * 13.0;
  float dsdh = (1.0 / 0.40 + 5.5 * exp(-h)) * k;
  float fn = fract(s);
  float above = fn / dsdh, below = (1.0 - fn) / dsdh;
  vec3 young = vec3(0.085, 0.17, 0.035), old = vec3(0.23, 0.215, 0.07);
  float hue = fract(sd * 7.31);
  vec3 col = mix(young, old, age) * (0.8 + 0.36 * hue);
  col = mix(col, col * vec3(0.85, 1.05, 1.15), (1.0 - age) * fract(sd * 3.7) * 0.5);
  col *= 0.84 + 0.3 * fib;
  col = mix(col, col * vec3(1.35, 1.18, 0.62), smoothstep(0.5, 0.75, m) * (0.25 + age));
  col = mix(col, vec3(0.035, 0.037, 0.026), dark * 0.6 * (0.3 + age));
  lich *= (0.2 + age) * (1.2 - smoothstep(2.0, 9.0, h));
  lich = clamp(lich, 0.0, 1.0);
  col = mix(col, vec3(0.36, 0.38, 0.33), lich * 0.85);
  float wax = smoothstep(0.06, 0.0, below) * (1.0 - age * 0.75);
  col = mix(col, vec3(0.34, 0.39, 0.34), wax * 0.7);
  col = mix(col, vec3(0.22, 0.27, 0.22), (1.0 - age) * 0.14);
  float btRa = above / 0.005; btRidge = exp(-btRa * btRa);
  float btSc = (above - 0.014) / 0.0035; float scar = exp(-btSc * btSc);   // x*x: pow() of a negative base is undefined on GPUs
  col *= 1.0 - 0.42 * btRidge - 0.32 * scar;
  float dirt = smoothstep(0.8, 0.0, h);
  col = mix(col, vec3(0.05, 0.038, 0.026), dirt * 0.75);
  btBumpS = -2.0 * (above / 0.005) * btRidge;
  btRough = 0.34 + 0.3 * wax + 0.4 * lich + 0.4 * dirt + 0.08 * fib + 0.2 * dark;
  #ifdef BT_STUMP
    if (!gl_FrontFacing) col = vec3(0.30, 0.24, 0.14) * (0.6 + 0.4 * fib);
  #endif
  diffuseColor.rgb = col;
  }
`;

// ------------------------------------------------------------------------------------------------ leaf / blossom cards
const CARD_VS_HEAD = /* glsl */`
attribute vec4 aP;   // anchor xyz (lean already applied), size (m)
attribute vec4 aQ;   // yaw, pitch, seed, height fraction of the culm (sway weight)
attribute vec4 aS;   // culm base xz, sway seed, light (self shadowing 0..1)
varying float vSeed, vShade;
`;
const CARD_NORMAL = /* glsl */`
  float btFl = (0.05 + 0.35 * uBtSwayAmp) * sin(uBtSwayPhase * 2.7 + aQ.z * 40.0) + 0.04 * sin(uBtTime * 3.1 + aQ.z * 90.0);
  float btCy = cos(aQ.x + btFl * 0.6), btSy = sin(aQ.x + btFl * 0.6), btPt = aQ.y + btFl, btCp = cos(btPt), btSp = sin(btPt);
  mat3 btRot = mat3(btCy, 0.0, -btSy, 0.0, 1.0, 0.0, btSy, 0.0, btCy) * mat3(1.0, 0.0, 0.0, 0.0, btCp, btSp, 0.0, -btSp, btCp);
  vec3 objectNormal = btRot * vec3(0.0, 0.0, 1.0);
`;
const CARD_BEGIN = /* glsl */`
  vec2 btSw = btSway(aS.xy, aS.z) * aQ.w * aQ.w;
  vec3 transformed = aP.xyz + vec3(btSw.x, 0.0, btSw.y) + btRot * vec3(position.xy * aP.w, 0.0);
  vSeed = aQ.z; vShade = aS.w;
`;
const CARD_FS_HEAD = /* glsl */`
varying float vSeed, vShade;
uniform float uBtCardTrans; uniform vec3 uBtCardTint;
`;
const CARD_MAP = /* glsl */`
  diffuseColor.rgb *= uBtCardTint * (0.78 + 0.44 * fract(vSeed * 13.7)) * mix(0.35, 1.0, vShade);
`;
const CARD_EMIT = /* glsl */`
  {
  vec3 V = normalize(vKitWorld - cameraPosition);
  float fwd = pow(max(dot(V, uBtSunDir), 0.0), 5.0);
  totalEmissiveRadiance += diffuseColor.rgb * uBtSunCol * (0.05 + 1.3 * fwd) * uBtCardTrans * vShade;
  }
`;

// ------------------------------------------------------------------------------------------------ ground
const GROUND_FS_HEAD = /* glsl */`
uniform sampler2D tBtLitter, tBtPath, tBtNoise; uniform float uBtPetals, uBtDamp;
float btGroundRough = 0.85; vec3 btGroundN = vec3(0.0, 1.0, 0.0);
`;
const GROUND_MAP = /* glsl */`
  {
  vec2 xz = vKitWorld.xz;
  float px = btPathX(xz.y), dp = xz.x - px;
  float clear = smoothstep(uBtGroveEnd + 2.0, uBtGroveEnd - 6.0, xz.y) * smoothstep(-80.0, -71.0, xz.y);   // 1 in the torii clearing
  float halfW = mix(1.78, 1.9, clear);
  vec2 puv = vec2(dp / 3.6 + 0.5, xz.y / 3.6);
  vec4 P = texture2D(tBtPath, puv);
  vec2 luv = xz / 2.4;
  vec4 Lt = texture2D(tBtLitter, luv);
  vec4 N = texture2D(tBtNoise, xz / 37.0);
  vec4 N2 = texture2D(tBtNoise, xz / 9.0 + 0.5);
  float onPath = 1.0 - smoothstep(halfW - 0.08, halfW + 0.12 + 0.1 * N2.r, abs(dp));
  // clearing: raked pale gravel around the approach
  vec3 grav = mix(vec3(0.07, 0.066, 0.058), vec3(0.15, 0.142, 0.128), N2.b) * (0.7 + 0.4 * N.g) * (0.75 + 0.5 * Lt.a);
  vec3 litter = Lt.rgb;
  float moss = smoothstep(0.5, 0.72, N.r * 0.7 + N2.g * 0.3);
  litter = mix(litter, vec3(0.035, 0.06, 0.018) * (0.8 + 0.5 * N2.b), moss * 0.85);
  float mossC = smoothstep(0.42, 0.62, N.r * 0.6 + N2.g * 0.4);
  vec3 offc = mix(litter, mix(grav, vec3(0.025, 0.05, 0.012) * (0.7 + 0.6 * N2.b), mossC * 0.9), clear * 0.75);
  vec3 col = mix(offc, P.rgb, onPath);
  float hgt = mix(mix(Lt.a, N2.b * 0.4, clear * 0.75), P.a, onPath);
  // damp morning: darker stone, a little glossier
  col *= mix(1.0, 0.82, uBtDamp * onPath);
  // fallen sakura petals
  if (uBtPetals > 0.0) {
    vec2 c = floor(xz * 9.0); vec2 f = fract(xz * 9.0) - 0.5; vec2 hsh = kHash22(c);
    float near = smoothstep(14.0, 4.0, length(xz - vec2(5.8, -54.5)));
    float on = step(1.0 - uBtPetals * (0.12 + 0.7 * near) * (0.5 + N.b), hsh.x);
    vec2 o = (hsh - 0.5) * 0.5; float pr = length((f - o) * vec2(1.0, 1.5));
    float pet = on * smoothstep(0.13, 0.09, pr);
    col = mix(col, vec3(0.82, 0.62, 0.66), pet * 0.9); hgt += pet * 0.2;
  }
  // soft contact darkening at the fence feet and culm-dense ground
  float fenceAO = smoothstep(0.55, 0.0, abs(abs(dp) - 2.1)) * (1.0 - clear);
  col *= 1.0 - 0.45 * fenceAO;
  diffuseColor.rgb = col;
  btGroundRough = mix(mix(0.9, 0.95, moss), mix(0.72, 0.5, uBtDamp) - 0.15 * P.a, onPath);
  // height-gradient normal
  #ifndef BT_LIGHT
  vec2 e = vec2(1.0 / 1024.0, 0.0);
  float hx = mix(texture2D(tBtLitter, luv + e.xy).a, texture2D(tBtPath, puv + e.xy).a, onPath) - mix(Lt.a, P.a, onPath);
  float hz = mix(texture2D(tBtLitter, luv + e.yx).a, texture2D(tBtPath, puv + e.yx).a, onPath) - mix(Lt.a, P.a, onPath);
  float sc = mix(0.010, 0.012, onPath) / (mix(2.4, 3.6, onPath) / 1024.0);
  btGroundN = normalize(vec3(-hx * sc, 1.0, -hz * sc));
  #endif
  }
`;

// ------------------------------------------------------------------------------------------------ brushwood fence (shibagaki)
const FENCE_VS_HEAD = /* glsl */`varying vec2 vFuv;`;
const FENCE_FS_HEAD = /* glsl */`varying vec2 vFuv; float btFenceRough = 0.9; float btFenceBump = 0.0;`;
const FENCE_MAP = /* glsl */`
  {
  float u = vFuv.x, v = vFuv.y;
  float top = 1.0 + 0.07 * kFbm2(vec2(u * 1.3, 3.0), 3) + 0.05 * kValue2(vec2(u * 14.0, 1.0));
  float wob = 0.5 * kFbm2(vec2(u * 3.0, v * 1.5), 3);
  float strandU = u * 34.0 + wob + v * 0.5;
  float sid = floor(strandU), sf = fract(strandU);
  float sh = kHash12(vec2(sid, floor(v * 1.1 + kHash12(vec2(sid, 3.0)) * 3.0)));
  float tip = top - 0.14 * kHash12(vec2(sid, 9.0));
  if (v > top + 0.04 * sin(sid * 1.7) || (v > tip && sf > 0.5)) discard;
  float strand = smoothstep(0.0, 0.3, sf) * smoothstep(1.0, 0.65, sf);
  float bundle = 0.6 + 0.4 * smoothstep(0.2, 0.8, kValue2(vec2(u * 4.0, v * 0.6)));
  vec3 c1 = vec3(0.045, 0.028, 0.016), c2 = vec3(0.17, 0.105, 0.055), c3 = vec3(0.12, 0.10, 0.07);
  vec3 col = mix(c1, c2, sh) * bundle;
  col = mix(col, c3, smoothstep(0.6, 0.9, kFbm2(vec2(u * 0.8, v * 1.5), 3)) * 0.5);
  col *= 0.15 + 0.85 * strand;
  col *= 0.6 + 0.4 * smoothstep(0.0, 0.6, v);
  diffuseColor.rgb = col;
  btFenceBump = (sf - 0.5) * strand;
  btFenceRough = 0.88;
  }
`;

// ------------------------------------------------------------------------------------------------ torii lacquer + stone
const TORII_MAP = /* glsl */`
  {
  vec3 w = vKitWorld;
  float n = kFbm3(w * vec3(3.0, 0.8, 3.0), 4), n2 = kValue3(w * vec3(18.0, 2.5, 18.0));
  vec3 lac = diffuseColor.rgb;
  vec3 faded = lac * vec3(1.22, 1.5, 1.4);
  vec3 col = mix(lac, faded, smoothstep(0.5, 0.75, n) * 0.55);
  float streak = smoothstep(0.62, 0.8, kValue3(vec3(w.x * 9.0, w.y * 0.6, w.z * 9.0)));
  col *= 1.0 - 0.25 * streak;
  col = mix(col, vec3(0.03, 0.025, 0.02), smoothstep(0.8, 0.0, w.y) * 0.35);
  col *= 0.92 + 0.12 * n2;
  diffuseColor.rgb = col;
  }
`;
const STONE_FS_HEAD = /* glsl */`uniform float uBtMoss; float btStoneRough = 0.85;`;
const STONE_MAP = /* glsl */`
  {
  vec3 w = vKitWorld; vec3 nW = normalize(vBtN);
  float g = kValue3(w * 60.0), n = kFbm3(w * 4.0, 4), n2 = kFbm3(w * 1.3 + 7.0, 3);
  vec3 col = mix(vec3(0.13, 0.13, 0.12), vec3(0.24, 0.235, 0.22), n) * (0.85 + 0.3 * g);
  col = mix(col, vec3(0.05, 0.05, 0.045), smoothstep(0.55, 0.85, n2) * 0.5);
  float lich = smoothstep(0.62, 0.7, kValue3(w * 9.0 + 3.0)) * smoothstep(0.4, 0.6, n2);
  col = mix(col, vec3(0.34, 0.36, 0.30), lich * 0.7);
  float up = smoothstep(0.15, 0.75, nW.y);
  float moss = clamp(up * smoothstep(0.35, 0.6, n * 0.6 + n2 * 0.5) + smoothstep(0.7, 0.0, w.y) * smoothstep(0.4, 0.6, n2) * 0.8, 0.0, 1.0) * uBtMoss;
  col = mix(col, vec3(0.03, 0.065, 0.015) * (0.7 + 0.6 * g), moss);
  diffuseColor.rgb *= col;
  btStoneRough = mix(0.82, 0.95, moss);
  }
`;
const BARK_MAP = /* glsl */`
  {
  vec3 w = vKitWorld;
  float n = kFbm3(w * vec3(2.5, 2.5, 2.5), 4);
  float lent = smoothstep(0.72, 0.8, kValue3(vec3(w.x * 3.0, w.y * 40.0, w.z * 3.0)));
  vec3 col = mix(vec3(0.045, 0.032, 0.028), vec3(0.11, 0.085, 0.07), n);
  col = mix(col, vec3(0.16, 0.13, 0.10), lent * 0.5);
  col = mix(col, vec3(0.06, 0.08, 0.03), smoothstep(0.62, 0.8, kFbm3(w * 1.2 + 2.0, 3)) * 0.6);
  diffuseColor.rgb = col;
  }
`;
const HILL_MAP = /* glsl */`
  {
  vec3 w = vKitWorld;
  float crowns = kFbm2(w.xz * 0.12, 4), big = kFbm2(w.xz * 0.012 + 3.0, 3);
  vec3 col = mix(vec3(0.012, 0.024, 0.012), vec3(0.04, 0.06, 0.025), crowns);
  col = mix(col, col * vec3(1.3, 1.0, 0.7), smoothstep(0.55, 0.75, big) * 0.6);
  diffuseColor.rgb = col;
  }
`;

const KINDS = {
  culm: { vsHead: CULM_VS_HEAD, normal: CULM_NORMAL, begin: CULM_BEGIN, fsHead: CULM_FS_HEAD, map: CULM_MAP,
    rough: 'float roughnessFactor = clamp(btRough, 0.25, 1.0);',
    nrm: 'normal = normalize(normal - vBtUp * btBumpS * 0.35);' },
  card: { vsHead: CARD_VS_HEAD, normal: CARD_NORMAL, begin: CARD_BEGIN, fsHead: CARD_FS_HEAD, mapAfter: CARD_MAP, emit: CARD_EMIT },
  ground: { fsHead: GROUND_FS_HEAD, map: GROUND_MAP, rough: 'float roughnessFactor = btGroundRough;',
    nrm: 'normal = normalize((viewMatrix * vec4(btGroundN, 0.0)).xyz);' },
  fence: { vsHead: FENCE_VS_HEAD, uvVary: 'vFuv = uv;', fsHead: FENCE_FS_HEAD, map: FENCE_MAP, rough: 'float roughnessFactor = btFenceRough;',
    nrm: 'normal = normalize(normal + vec3(btFenceBump * 0.9, 0.0, 0.0));' },
  torii: { mapAfter: TORII_MAP },
  stone: { fsHead: STONE_FS_HEAD, mapAfter: STONE_MAP, rough: 'float roughnessFactor = btStoneRough;' },
  bark: { mapAfter: BARK_MAP },
  hill: { mapAfter: HILL_MAP },
  plain: {},
};

/**
 * Turn a MeshStandardMaterial into a grove material of `kind` (see KINDS). fogU = sky.fog.uniforms, U = the scene's
 * shared uniforms (bt*), extra = kind-local uniforms. steps = volumetric shaft samples (0 = no shafts in this material).
 */
export function btPatch(THREE, material, { kind = 'plain', fogU, U, extra = {}, steps = 10, lamps = true, defines = {}, sunK = 1 }) {
  const K = KINDS[kind];
  material.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, fogU, U, extra);
    sh.defines = Object.assign(sh.defines || {}, { BT_STEPS: Math.max(1, steps), BT_SUNK: sunK.toFixed(3) }, defines);
    let vs = sh.vertexShader, fs = sh.fragmentShader;
    vs = vs.replace('#include <common>', '#include <common>\nvarying vec3 vKitWorld; varying vec3 vBtN;\n' + G.common + G.noise + BT_COMMON + (K.vsHead || ''));
    if (K.normal) vs = vs.replace('#include <beginnormal_vertex>', K.normal);
    if (K.begin) vs = vs.replace('#include <begin_vertex>', K.begin);
    if (K.uvVary) vs = vs.replace('#include <uv_vertex>', '#include <uv_vertex>\n' + K.uvVary);
    vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
      { vec4 kw = vec4(transformed, 1.0); vec3 kn = objectNormal;
      #ifdef USE_INSTANCING
        kw = instanceMatrix * kw; kn = mat3(instanceMatrix) * kn;
      #endif
        vKitWorld = (modelMatrix * kw).xyz; vBtN = normalize(mat3(modelMatrix) * kn); }`);
    fs = fs.replace('#include <common>', '#include <common>\nvarying vec3 vKitWorld; varying vec3 vBtN;\n' + G.common + G.noise + G.fog + BT_COMMON + BT_FRAG + (K.fsHead || ''));
    if (K.map) fs = fs.replace('#include <map_fragment>', K.map);
    if (K.mapAfter) fs = fs.replace('#include <map_fragment>', '#include <map_fragment>\n' + K.mapAfter);
    if (K.rough) fs = fs.replace('#include <roughnessmap_fragment>', K.rough);
    if (K.nrm) fs = fs.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + K.nrm);
    if (K.emit) fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + K.emit);
    fs = fs.replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );',
      'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= btSunVis(vKitWorld) * BT_SUNK;'));
    if (lamps) fs = fs.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n\treflectedLight.directDiffuse += diffuseColor.rgb * RECIPROCAL_PI * btLamps(vKitWorld, normalize(inverseTransformDirection(normal, viewMatrix)));');
    fs = fs.replace('#include <fog_fragment>', steps > 0 ? 'gl_FragColor.rgb = kFog(gl_FragColor.rgb, vKitWorld, cameraPosition) + btShafts(vKitWorld, cameraPosition);'
      : 'gl_FragColor.rgb = kFog(gl_FragColor.rgb, vKitWorld, cameraPosition);');
    sh.vertexShader = vs; sh.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => `bt|${kind}|${steps}|${lamps}|${sunK}|${JSON.stringify(defines)}`;
  material.needsUpdate = true;
  return material;
}

/** Depth material (shadow casting) for instanced culms: the same vertex bend + sway as the culm material. */
export function btCulmDepth(THREE, U) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + BT_COMMON + CULM_VS_HEAD)
      .replace('#include <begin_vertex>', 'float btV = position.y, btH = aC.z, btHm = btV * btH;\n' + CULM_BEGIN);
  };
  m.customProgramCacheKey = () => 'bt|culmdepth';
  return m;
}

/** Volumetric shafts for the sky pixels: a camera-centred back-faced sphere, additive, behind all geometry. */
export function btShaftDome(THREE, fogU, U, steps) {
  return new THREE.ShaderMaterial({
    uniforms: { ...fogU, ...U }, defines: { BT_STEPS: Math.max(1, steps) },
    vertexShader: 'varying vec3 vKitWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vKitWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: G.common + G.noise + G.fog + BT_COMMON + BT_FRAG + `varying vec3 vKitWorld;
      void main() { vec3 wp = cameraPosition + normalize(vKitWorld - cameraPosition) * 90.0; vec3 c = btShafts(wp, cameraPosition); float T = kFogT(wp, cameraPosition); gl_FragColor = vec4(c * (0.55 + 0.45 * T), 1.0); }`,
    side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
}

// ------------------------------------------------------------------------------------------------ baked textures
const CELL = /* glsl */`
vec2 btCell(vec2 c, float n, float s) { c = mod(c, n); return kHash22(c + s * 17.31); }
`;
/** Bamboo leaf litter over dark soil (rgb = linear albedo, a = height), tileable, one tile = 2.4 m. */
export const LITTER_FS = CELL + /* glsl */`
vec4 bake(vec2 uv) {
  vec3 soil = mix(vec3(0.035, 0.026, 0.018), vec3(0.07, 0.05, 0.032), kFbm2p(uv * 8.0, vec2(8.0), 4));
  vec3 col = soil; float hgt = 0.0;
  for (int L = 0; L < 4; L++) {
    float n = 26.0 + float(L) * 3.0;
    vec2 p = uv * n;
    vec2 ci = floor(p);
    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
      vec2 c = ci + vec2(float(dx), float(dy));
      vec2 h = btCell(c, n, float(L));
      vec2 h2 = btCell(c + 31.0, n, float(L) + 4.0);
      if (h2.y < 0.18) continue;
      vec2 o = c + h;
      float a = h2.x * 6.2832;
      vec2 d = p - o; vec2 r = vec2(cos(a) * d.x + sin(a) * d.y, -sin(a) * d.x + cos(a) * d.y);
      float len = 0.75 + 0.6 * h.y, wid = 0.085 + 0.05 * h2.y;
      float x = r.x / len;
      if (abs(x) > 1.0) continue;
      float w = wid * pow(max(1.0 - x * x, 0.0), 0.7) * (x < 0.0 ? 1.0 : (1.0 - x * 0.35));
      float inside = smoothstep(w, w * 0.6, abs(r.y + 0.03 * sin(x * 3.0 + h.x * 9.0)));
      if (inside <= 0.0) continue;
      float tone = kHash12(c + float(L) * 7.0);
      vec3 leaf = tone < 0.55 ? mix(vec3(0.26, 0.18, 0.085), vec3(0.42, 0.31, 0.15), tone / 0.55)
               : tone < 0.85 ? mix(vec3(0.14, 0.09, 0.045), vec3(0.20, 0.13, 0.06), (tone - 0.55) / 0.3)
               : vec3(0.17, 0.17, 0.07);
      leaf *= 0.85 + 0.25 * smoothstep(0.0, 0.02, abs(r.y)) ;
      leaf *= mix(0.6, 1.0, float(L) / 3.0);
      col = mix(col, leaf, inside);
      hgt = mix(hgt, 0.3 + 0.2 * float(L) + 0.1 * (1.0 - abs(x)), inside);
    }
  }
  return vec4(col, hgt);
}`;
/** The path: irregular granite flagstones in the middle, kerbs, then fine compacted gravel to the fences. u across 3.6 m (centre 0.5), v along 3.6 m. */
export const PATH_FS = CELL + /* glsl */`
vec4 bake(vec2 uv) {
  float x = (uv.x - 0.5) * 3.6;
  // gravel / packed earth
  vec2 gw = kWorley2p(uv * vec2(90.0, 90.0), vec2(90.0));
  float peb = smoothstep(0.32, 0.05, gw.x);
  vec2 cell = floor(uv * 90.0);
  float pt = kHash12(mod(cell, 90.0));
  vec3 earth = mix(vec3(0.075, 0.062, 0.048), vec3(0.12, 0.10, 0.08), kFbm2p(uv * 12.0, vec2(12.0), 4));
  vec3 col = mix(earth, mix(vec3(0.13, 0.125, 0.115), vec3(0.24, 0.225, 0.2), pt), peb * 0.8);
  float hgt = peb * 0.25;
  // flagstones (ishidatami) in a 1.4 m strip
  float strip = 1.0 - smoothstep(0.66, 0.70, abs(x));
  vec2 sp = vec2(uv.x * 5.0, uv.y * 5.0);
  vec2 w = kWorley2p(sp + vec2(0.37, 0.0), vec2(5.0));
  float edge = w.y - w.x;
  float joint = smoothstep(0.04, 0.1, edge);
  float tone = kFbm2p(uv * vec2(5.0, 5.0) + floor(w.x * 7.0) * 0.0, vec2(5.0), 2);
  float speck = kValue2(uv * 900.0);
  vec3 stone = mix(vec3(0.15, 0.148, 0.14), vec3(0.32, 0.31, 0.29), kFbm2p(uv * 22.0, vec2(22.0), 5)) * (0.7 + 0.6 * tone) * (0.88 + 0.22 * speck);
  stone = mix(stone, vec3(0.06, 0.07, 0.04), smoothstep(0.6, 0.85, kFbm2p(uv * 9.0 + 3.0, vec2(9.0), 4)) * 0.35);
  vec3 jointCol = mix(vec3(0.03, 0.025, 0.02), vec3(0.03, 0.06, 0.015), smoothstep(0.4, 0.7, kFbm2p(uv * 30.0, vec2(30.0), 3)));
  vec3 flag = mix(jointCol, stone, joint);
  // kerb stones along both edges of the strip
  float kerb = smoothstep(0.66, 0.68, abs(x)) * (1.0 - smoothstep(0.80, 0.82, abs(x)));
  float kj = smoothstep(0.0, 0.015, abs(fract(uv.y * 3.6 / 0.9 + (x > 0.0 ? 0.5 : 0.0)) - 0.5) - 0.48 + 0.48);
  vec3 kerbC = mix(vec3(0.10, 0.1, 0.095), vec3(0.2, 0.19, 0.18), kFbm2p(uv * vec2(40.0, 10.0), vec2(40.0, 10.0), 4));
  col = mix(col, flag, strip);
  col = mix(col, mix(jointCol, kerbC, kj), kerb);
  hgt = mix(hgt, 0.55 + 0.25 * joint * (0.7 + 0.3 * tone) - 0.3 * (1.0 - joint), strip);
  hgt = mix(hgt, 0.75 * kj, kerb);
  // stray dry leaves near the fences
  float edgeZone = smoothstep(1.2, 1.75, abs(x));
  vec2 lc = floor(uv * 40.0); vec2 lh = btCell(lc, 40.0, 3.0);
  vec2 lp = fract(uv * 40.0) - lh; float la = lh.x * 6.28;
  vec2 lr = vec2(cos(la) * lp.x + sin(la) * lp.y, -sin(la) * lp.x + cos(la) * lp.y);
  float lf = smoothstep(0.06, 0.03, abs(lr.y) + lr.x * lr.x * 0.12) * step(abs(lr.x), 0.5) * step(1.0 - edgeZone * 0.8 - 0.06, lh.y);
  col = mix(col, mix(vec3(0.24, 0.16, 0.08), vec3(0.36, 0.27, 0.13), lh.x), lf * 0.9);
  hgt = max(hgt, lf * 0.6);
  return vec4(col, hgt);
}`;

/** Culm surface detail in (around, along) space: r fibres, g mottling, b lichen, a dark patches; v period = 4 m. */
export const CULM_TEX_FS = /* glsl */`
vec4 bake(vec2 uv) {
  float fib = kFbm2p(uv * vec2(64.0, 3.0), vec2(64.0, 3.0), 3);
  float mott = kFbm2p(uv * vec2(3.0, 8.0), vec2(3.0, 8.0), 4);
  float lich = smoothstep(0.6, 0.68, kFbm2p(uv * vec2(14.0, 150.0), vec2(14.0, 150.0), 3)) * smoothstep(0.42, 0.62, kFbm2p(uv * vec2(4.0, 12.0) + 0.3, vec2(4.0, 12.0), 3));
  float dark = smoothstep(0.58, 0.8, kFbm2p(uv * vec2(2.0, 4.0) + 0.7, vec2(2.0, 4.0), 3));
  return vec4(fib, mott, lich, dark);
}`;
