// aurora-snow-glsl.js - shaders for the "Northern lights" scene (aurora-snow.js): the aurora + dense star field + Milky
// Way sky overlay, and the onBeforeCompile patches for the snow-laden spruces, the snow ground and the lake ice.
// Everything is core GLSL on top of the kit chunks (kit-glsl.js); no three/examples imports.

// ------------------------------------------------------------------------------------------------ sky overlay
// A full-screen triangle at the far plane, drawn after the opaque world (depth test LEQUAL, additive), so trees and
// hills hide it for free and the planar mirror reflects it like everything else.
// Aurora model (km, flat-earth march with curvature drop): each curtain is a vertical emitting sheet that follows a
// wavy east-west line z = c(x, t) far to the north, with a Gaussian thickness. The ray is marched between 88 and 340 km
// altitude; the time spent inside each sheet is integrated ANALYTICALLY per step (erf of the signed distance), so thin
// sheets never alias and the path length grows where the line of sight runs along the sheet - which is exactly what
// makes real folds glow brighter. Emission depends on the height above the curtain's lower border (green 557.7 nm O
// line from ~100 km, red 630 nm O above ~180 km, a pink/violet N2 fringe at the lower edge in strong displays) and
// on the position along the curtain (field-aligned rays, slowly drifting).
export const SKY_VS = /* glsl */`
uniform mat4 uInvProjView; varying vec3 vDir;
void main() { vec4 w = uInvProjView * vec4(position.xy, 1.0, 1.0); vDir = w.xyz / w.w - cameraPosition; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

export const SKY_FS = /* glsl */`
varying vec3 vDir;
uniform vec4 uCurt[NC];     // x: north distance of the line (km), y: wave amplitude (km), z: brightness, w: phase
uniform vec4 uCurtB[NC];    // x: half thickness (km), y: drift along the curtain (km), z: fold scale, w: lower border offset (km)
uniform float uTilt[NC];    // the line runs at this slope (north km per east km): diagonal bands in perspective
uniform vec4 uWin[NC];      // the curtain exists along x in [x - y, x + y] with soft ends of z km
uniform vec3 uColG, uColR, uColP, uExtK, uMWN, uMWC, uAirCol;
uniform sampler2D uAurTex; uniform vec2 uInvRes;
uniform float uEnvBias, uTau, uFold, uGain, uRed, uPurple, uMilky, uStars, uAirglow, uTime, uTwinkle, uLsat;
#define RE 6371.0
float erfA(float x) { return tanh(1.2027606 * x); }
float curve(float x, vec4 c, vec4 cb, float tl, out float dz) {
  float ph = c.w + uTau, F = 0.55 + 0.9 * uFold * cb.z, A = c.y;
  float a1 = x * 0.0031 + ph * 0.19;
  float a2 = x * 0.0104 + ph * 0.36 + 0.9 * sin(x * 0.0049 - ph * 0.13);
  float a3 = x * 0.0235 + ph * 0.63;
  float a4 = x * 0.061 - ph * 1.07;
  float a5 = x * 0.17 + ph * 2.3 + 1.3 * sin(x * 0.043 + ph);
  dz = tl + A * (0.0031 * cos(a1) + 0.42 * F * 0.0104 * cos(a2) + 0.15 * F * 0.0235 * cos(a3) + 0.05 * F * 0.061 * cos(a4) + 0.018 * F * 0.17 * cos(a5));
  return c.x + tl * x + A * (sin(a1) + 0.42 * F * sin(a2) + 0.15 * F * sin(a3) + 0.05 * F * sin(a4) + 0.018 * F * sin(a5));
}
vec3 emit(float x, float h, float fi, vec4 c, vec4 cb, vec4 wn) {
  float u = x + cb.y;
  float win = smoothstep(wn.y + wn.z, wn.y - wn.z, abs(x - wn.x));
  float r1 = kSimplex2(vec2(u * 0.43, uTau * 0.85 + fi));
  float r2 = kSimplex2(vec2(u * 0.125, uTau * 0.42 + fi * 1.7));
  float r3 = kSimplex2(vec2(u * 0.03, uTau * 0.17 + fi * 2.3));
  float r4 = kSimplex2(vec2(u * 0.0068 + fi, uTau * 0.06));
  float env = 0.12 + 0.88 * smoothstep(-0.4, 0.5, r4 * 0.8 + r3 * 0.3 + uEnvBias);
  float rays = clamp(0.5 + 0.5 * (0.58 * r1 + 0.42 * r2), 0.0, 1.0);
  rays = 0.32 + 1.05 * rays * rays;
  float hb = 100.0 + cb.w + 6.0 * r3 + 2.5 * r2;
  float dh = h - hb;
  float top = 55.0 + 150.0 * clamp(0.5 + 0.5 * (0.7 * r2 + 0.3 * r1), 0.0, 1.0) * (0.55 + 0.45 * env);
  float g = smoothstep(-1.8, 1.2, dh) * (0.22 + 0.55 * exp(-max(dh - 1.0, 0.0) / 30.0) + 0.6 * exp(-max(dh - 0.5, 0.0) / 6.0)) * exp(-max(dh, 0.0) / 140.0) * smoothstep(top + 30.0, top - 25.0, dh);
  float r = smoothstep(35.0, 120.0, dh) * exp(-max(dh - 120.0, 0.0) / 85.0) * smoothstep(top + 110.0, top, dh) * uRed;
  float p = exp(-(dh + 1.5) * (dh + 1.5) / 12.0) * uPurple;
  return (uColG * g * rays + uColR * r * (0.4 + 0.6 * rays) + uColP * p * rays) * env * win * c.z;
}
vec3 starLayer(vec3 d, float sc, float thr, float gain, float pxFade) {
  vec3 p = d * sc; vec3 c = floor(p); vec3 f = fract(p);
  vec3 h = kHash33(c + sc);
  vec3 o = 0.2 + 0.6 * kHash33(c + 7.0 + sc); float dist = length(f - o);
  float px = max(length(fwidth(p)), 1e-4);
  float r = max(px * 0.8, 0.03);
  float mag = pow(h.y, 5.0) * gain * (0.03 * 0.03) / (r * r) * smoothstep(pxFade, pxFade * 0.45, px);
  float tw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (1.7 + h.z * 4.5) + h.x * 80.0));
  vec3 tint = mix(vec3(1.0, 0.78, 0.6), vec3(0.76, 0.85, 1.0), smoothstep(0.1, 0.9, h.z));
  return tint * step(thr, h.x) * mag * tw * smoothstep(r, r * 0.2, dist);
}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = vec3(0.0);
  if (d.y > -0.03) {
    float dy = max(d.y, 0.0);
    float air = 1.0 / (dy + 0.035);
    vec3 ext = exp(-uExtK * air);
#ifdef STARS
    // Milky Way: a soft band with a brighter core toward the galactic centre, dark dust lanes, and its own faint stars
    float b = dot(d, uMWN);
    float band = exp(-b * b * 40.0);
    float core = 0.45 + 0.9 * pow(max(dot(d, uMWC) * 0.5 + 0.5, 0.0), 3.0);
    float cl = kFbm3(d * 7.0 + 3.0, 5);
    float rift = smoothstep(0.42, 0.72, kFbm3(d * 11.0 + 17.0, 4)) * exp(-pow(b - 0.025, 2.0) * 160.0);
    float mw = band * (0.55 + 0.5 * cl) * (1.0 - 0.55 * rift) * core;
    vec3 mwc = mix(vec3(0.70, 0.78, 1.0), vec3(1.0, 0.9, 0.76), smoothstep(0.6, 1.4, core));
    vec3 sky = uMilky * mw * mwc;
    if (uStars > 0.0) {
      sky += starLayer(d, 260.0, 0.86, 2.2, 6.0) * uStars;
      sky += starLayer(d, 520.0, 0.80 - band * 0.12, 1.0 + band * 0.8, 3.5) * uStars;
      sky += starLayer(d, 980.0, 0.84 - band * 0.25, 0.55 + band * 0.9, 2.2) * uStars;
    }
    // airglow: the faint green O emission that brightens 5-15 degrees above the horizon on dark nights
    sky += uAirCol * uAirglow * exp(-pow((dy - 0.13) / 0.11, 2.0)) * smoothstep(-0.02, 0.03, d.y);
    col += sky * ext * smoothstep(-0.03, 0.01, d.y);
#endif
#ifdef AURORA
    if (uGain > 0.0) {
      float hd = sqrt(max(1.0 - dy * dy, 1e-6));
      float t0 = RE * (-dy + sqrt(dy * dy + 2.0 * 88.0 / RE));
      float t1 = min(RE * (-dy + sqrt(dy * dy + 2.0 * 340.0 / RE)), 980.0 / hd);
      if (t1 > t0) {
        float dt = (t1 - t0) / float(STEPS);
        float k2 = hd * hd / (2.0 * RE);
        vec3 acc[NC]; float pl[NC]; float s0[NC];
        float x0 = d.x * t0, h0 = dy * t0 + t0 * t0 * k2, n0 = -d.z * t0;
        for (int i = 0; i < NC; i++) { float dz; float z = curve(x0, uCurt[i], uCurtB[i], uTilt[i], dz); s0[i] = (n0 - z) * inversesqrt(1.0 + dz * dz); acc[i] = vec3(0.0); pl[i] = 0.0; }
        for (int k = 1; k <= STEPS; k++) {
          float tt = t0 + dt * float(k);
          float x1 = d.x * tt, n1 = -d.z * tt, h1 = dy * tt + tt * tt * k2;
          for (int i = 0; i < NC; i++) {
            float dz; float z = curve(x1, uCurt[i], uCurtB[i], uTilt[i], dz);
            float s1 = (n1 - z) * inversesqrt(1.0 + dz * dz);
            float w = uCurtB[i].x, a = s0[i] / w, bb = s1 / w;
            float m = abs(bb - a) > 0.02 ? 0.8862269 * (erfA(bb) - erfA(a)) / (bb - a) : exp(-0.25 * (a + bb) * (a + bb));
            if (m > 3e-4) {
              float fr = a * bb < 0.0 ? a / (a - bb) : (abs(a) < abs(bb) ? 0.0 : 1.0);
              float L = m * dt;
              acc[i] += emit(mix(x0, x1, fr), mix(h0, h1, fr), float(i) * 7.31, uCurt[i], uCurtB[i], uWin[i]) * L; pl[i] += L;
            }
            s0[i] = s1;
          }
          x0 = x1; h0 = h1;
        }
        vec3 au = vec3(0.0);
        for (int i = 0; i < NC; i++) au += acc[i] * (uLsat * (1.0 - exp(-pl[i] / uLsat)) / max(pl[i], 1e-3));
        col += au * uGain * ext * smoothstep(-0.03, 0.02, d.y);
      }
    }
#endif
  }
#ifdef AUR_TEX
  col += texture2D(uAurTex, gl_FragCoord.xy * uInvRes).rgb;
#endif
  gl_FragColor = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------------------------------------ spruce patch
// Instanced, double-sided spruces (geometry from aurora-snow-geo.js). Attribute aTree = (rim 0..1.15, height 0..1 or -1
// for the trunk, fringe 0..1). instanceColor carries (snow amount, needle tone, seed) - read raw, never as a tint.
export const TREE_VERT_HEAD = /* glsl */`
attribute vec3 aTree; varying vec3 vTree; varying vec3 vTreeP; uniform float uTime; uniform vec2 uSway;`;
export const TREE_VERT_BEGIN = /* glsl */`
#include <begin_vertex>
vTree = aTree; vTreeP = position;
{
#ifdef USE_INSTANCING
  float ph = instanceMatrix[3].x * 0.071 + instanceMatrix[3].z * 0.053;
#else
  float ph = 0.0;
#endif
  float y2 = position.y * position.y;
  transformed.x += uSway.x * y2 * (sin(uTime * 0.83 + ph) + 0.35 * sin(uTime * 2.1 + ph * 3.0));
  transformed.z += uSway.y * y2 * (sin(uTime * 0.71 + ph * 1.7) + 0.35 * sin(uTime * 1.9 + ph * 2.0));
}`;
export const TREE_FRAG_HEAD = /* glsl */`
varying vec3 vTree; varying vec3 vTreeP;`;
export const TREE_FRAG_COLOR = /* glsl */`
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vec3 kP = vColor;
#else
  vec3 kP = vec3(0.7, 0.5, 0.3);
#endif
  float kSeed = kP.z * 37.0;
  vec3 tp = vTreeP;
  float kAng = atan(tp.z, tp.x);
  float kN = kFbm3(tp * vec3(16.0, 22.0, 16.0) + kSeed, 3);
  float kN2 = kValue2(vec2(kAng * 9.0 + kSeed, tp.y * 60.0));
  // snow sits on the upper side of every tier, thins toward the needle tips and in clumps
  float kTop = gl_FrontFacing ? 1.0 : 0.0;
  float kRim = vTree.x;
  float kClump = kValue2(vec2(kAng * 4.0 + kSeed, tp.y * 14.0));
  float kSnow = kTop * smoothstep(0.42, 0.6, kN * 0.8 + 0.36 * kP.x + 0.08 * (1.0 - kRim) + 0.14 * kN2 + 0.22 * (kClump - 0.5) - 0.06);
  kSnow *= 1.0 - 0.75 * smoothstep(0.88, 1.08, kRim);
  vec3 kNeedle = mix(vec3(0.0075, 0.0125, 0.009), vec3(0.020, 0.030, 0.019), kN2) * (0.75 + 0.5 * kP.y);
  kNeedle *= mix(0.35, 1.0, smoothstep(0.0, 0.8, kRim));      // dark inside the crown
  vec3 kSnowC = vec3(0.80, 0.83, 0.88) * (0.62 + 0.38 * smoothstep(0.0, 1.0, kRim)) * (0.8 + 0.2 * kN);
  diffuseColor.rgb = mix(kNeedle, kSnowC, kSnow);
  if (vTree.y < -0.5) diffuseColor.rgb = vec3(0.028, 0.020, 0.015) * (0.7 + 0.6 * kN2);
  // feathered needle fringe at the rim of each tier (alpha to coverage on high, alpha test on light)
  if (vTree.z > 0.0) {
    float kCl = kValue2(vec2(kAng * 31.0 + kSeed, tp.y * 12.0)) * 0.4 + kValue2(vec2(kAng * 120.0, kSeed + tp.y * 45.0)) * 0.35 + kValue2(vec2(kAng * 380.0, kSeed + tp.y * 140.0)) * 0.25;
    diffuseColor.a = smoothstep(0.9, 0.45, vTree.z * (0.45 + 1.0 * kCl));
  }`;
// lumpy snow and needle clumps: a small view-space normal jitter from object-space noise (no facets under soft light)
export const TREE_FRAG_NORMAL = /* glsl */`
#include <normal_fragment_maps>
{
  vec3 kq = vTreeP * vec3(70.0, 50.0, 70.0) + kSeed;
  vec3 kj = vec3(kValue2(kq.xz) - 0.5, kValue2(kq.zy + 3.0) - 0.5, kValue2(kq.xy + 7.0) - 0.5);
  normal = normalize(normal + kj * mix(0.9, 0.55, kSnow));
}`;
export const TREE_FRAG_ROUGH = /* glsl */`
#include <roughnessmap_fragment>
roughnessFactor = mix(0.92, 0.78, kSnow);`;

// ------------------------------------------------------------------------------------------------ snow ground patch
// Terrain (near shore + far mountains): vertex colour = (forest canopy, bare rock, unused). Adds micro glints that
// twinkle with the view direction and fade with pixel size (no aliasing in the preview).
export const GROUND_FRAG_HEAD = /* glsl */`
uniform vec3 uGlint; uniform float uGlintAmt;`;
export const GROUND_FRAG_COLOR = /* glsl */`
#if defined( USE_COLOR )
  vec3 kVC = vColor;
#else
  vec3 kVC = vec3(0.0);
#endif
  vec2 kXZ = vKitWorld.xz;
  float kPx = length(fwidth(kXZ));
  float kLod = smoothstep(1.5, 7.0, kPx);
  float kMot = mix(smoothstep(0.3, 0.85, kFbm2(kXZ * 0.22, 4)), 0.42, kLod);
  float kMot2 = mix(kValue2(kXZ * 1.7), 0.5, smoothstep(0.2, 1.2, kPx));
  vec3 kSnowC = vec3(0.84, 0.865, 0.91) * (0.93 + 0.07 * kMot2);
  vec3 kForest = mix(vec3(0.016, 0.022, 0.019), vec3(0.42, 0.45, 0.50), kMot * 0.75);
  vec3 kRock = vec3(0.05, 0.047, 0.045) * (0.7 + 0.6 * kMot2);
  // far slopes: snow does not hold on steep ground, so dark rock shows in streaks along the fall line (gullies)
  float kDistG = length(vKitWorld - cameraPosition);
  float kFarG = smoothstep(400.0, 1400.0, kDistG);
  float kRockS = 0.0;
  if (kFarG > 0.0) {
    vec3 kNw = inverseTransformDirection(normalize(vNormal), viewMatrix);
    vec2 kFall = normalize(kNw.xz + 1e-4);
    float kAcross = dot(kXZ, vec2(-kFall.y, kFall.x)), kAlong = dot(kXZ, kFall);
    float kStreak = kValue2(vec2(kAcross / 22.0, kAlong / 260.0)) * 0.6 + kValue2(vec2(kAcross / 7.0, kAlong / 90.0)) * 0.4;
    float kSteep = smoothstep(0.93, 0.62, kNw.y + 0.12 * kFbm2(kXZ / 140.0, 3));
    kRockS = kFarG * kSteep * smoothstep(0.38, 0.62, kStreak);
  }
  diffuseColor.rgb = mix(mix(kSnowC, kForest, clamp(kVC.r, 0.0, 1.0)), kRock, clamp(kVC.g + kRockS * (1.0 - kVC.r), 0.0, 1.0));`;
// sub-facet relief on the far mountains (the mesh is ~60-100 m per quad there): bumped normal from world fbm
export const GROUND_FRAG_NORMAL = /* glsl */`
#include <normal_fragment_maps>
{
  float kD = length(vKitWorld - cameraPosition);
  float kF = smoothstep(350.0, 1200.0, kD);
  if (kF > 0.0) {
    vec2 q = vKitWorld.xz / 150.0; float e = 0.04;
    float h0 = kFbm2(q, 4), hx = kFbm2(q + vec2(e, 0.0), 4), hz = kFbm2(q + vec2(0.0, e), 4);
    vec2 sl = vec2(hx - h0, hz - h0) / (e * 150.0) * 70.0;
    float r0 = kValue2(vKitWorld.xz / 35.0), rx = kValue2((vKitWorld.xz + vec2(3.0, 0.0)) / 35.0), rz = kValue2((vKitWorld.xz + vec2(0.0, 3.0)) / 35.0);
    sl += vec2(rx - r0, rz - r0) / 3.0 * 9.0;
    normal = normalize(normal - (viewMatrix * vec4(sl.x, 0.0, sl.y, 0.0)).xyz * kF);
  }
}`;
export const GROUND_FRAG_OUT = /* glsl */`
{
  vec3 kV = normalize(cameraPosition - vKitWorld);
  vec3 kC = floor(vKitWorld * 26.0);
  float kH = kHash13(kC);
  float kVw = kHash13(kC + floor(kV * 9.0 + kH * 3.0) * 1.7);
  float kPx2 = length(fwidth(vKitWorld * 26.0));
  float kG = step(0.986, kH) * smoothstep(0.82, 0.97, kVw) * smoothstep(1.2, 0.35, kPx2) * (1.0 - clamp(vColor.r + vColor.g, 0.0, 1.0));
  outgoingLight += uGlint * kG * uGlintAmt;
}
#include <opaque_fragment>`;

// ------------------------------------------------------------------------------------------------ lake ice patch
// Wind-packed snow streaks over black ice; white subsurface cracks; the black ice mirrors the sky (planar mirror).
export const ICE_FRAG_HEAD = /* glsl */`
uniform sampler2D uMirror; uniform mat4 uMirrorMatrix; uniform float uMirrorOn, uIceSnow, uMirrorK;
uniform sampler2D uShoreN, uShoreF; uniform vec4 uShoreBN, uShoreBF;     // metres from the shore into the lake (/20), near + far boxes
float kShoreDist(vec2 p) {
  vec2 un = (p - uShoreBN.xy) * uShoreBN.zw, uf = (p - uShoreBF.xy) * uShoreBF.zw;
  vec2 e = smoothstep(vec2(0.0), vec2(0.06), un) * smoothstep(vec2(1.0), vec2(0.94), un);
  return mix(texture2D(uShoreF, clamp(uf, 0.0, 1.0)).r, texture2D(uShoreN, clamp(un, 0.0, 1.0)).r, e.x * e.y) * 20.0;
}
float kIceSnow(vec2 p, out float n) {
  vec2 w = vec2(kFbm2(p * 0.011, 3), kFbm2(p * 0.011 + 7.3, 3));
  vec2 q = vec2(p.x * 0.010 + p.y * 0.003, p.y * 0.030) + w * 1.4;
  n = kFbm2(q, 5);
  float fine = kFbm2(vec2(p.x * 0.05, p.y * 0.16) + w * 3.0, 3);
  return smoothstep(uIceSnow - 0.09, uIceSnow + 0.06, n * 0.85 + fine * 0.22);
}`;
export const ICE_FRAG_COLOR = /* glsl */`
  vec2 kP2 = vKitWorld.xz;
  float kPxI = length(fwidth(kP2));
  float kNs; float kS = kIceSnow(kP2, kNs);
  // wind drifts snow off the land onto the ice: soft aprons along every shore instead of a cut edge
  float kSd = kShoreDist(kP2);
  float kAp = 1.0 - smoothstep(0.0, 0.5 + 3.2 * kFbm2(kP2 * 0.09 + 4.0, 3) + 0.004 * dot(kP2, kP2) / (1.0 + 0.0001 * dot(kP2, kP2)), kSd + 0.5 * kValue2(kP2 * 1.3));
  kS = max(kS, kAp);
  vec2 kW1 = kWorley2(kP2 * 0.21 + 3.0), kW2 = kWorley2(kP2 * 0.9 + 11.0);
  float kCr = (1.0 - smoothstep(0.0, 0.025 + kPxI * 0.05, kW1.y - kW1.x)) * 0.8 + (1.0 - smoothstep(0.0, 0.03 + kPxI * 0.2, kW2.y - kW2.x)) * 0.3;
  kCr *= smoothstep(0.35, 0.7, kFbm2(kP2 * 0.045 + 2.0, 3));          // cracks come in patches, not a net over everything
  kCr *= (1.0 - kS) * (1.0 - smoothstep(0.4, 2.0, kPxI));
  vec3 kIce = vec3(0.008, 0.011, 0.015) + vec3(0.13, 0.145, 0.16) * kCr;
  vec3 kSn = vec3(0.83, 0.855, 0.90) * (0.9 + 0.1 * kNs);
  diffuseColor.rgb = mix(kIce, kSn, kS);
  float kIceAmt = (1.0 - kS) * (1.0 - kCr * 0.6);`;
export const ICE_FRAG_ROUGH = /* glsl */`
#include <roughnessmap_fragment>
roughnessFactor = mix(0.85, 0.05, kIceAmt);`;
export const ICE_FRAG_OUT = /* glsl */`
if (uMirrorOn > 0.5 && kIceAmt > 0.01) {
  vec3 kV = normalize(cameraPosition - vKitWorld);
  float kF = kFresnel(max(kV.y, 0.0), 0.018);
  vec2 kWarp = vec2(kFbm2(kP2 * 0.35, 3), kFbm2(kP2 * 0.35 + 5.0, 3)) - 0.5;
  vec4 kMc = uMirrorMatrix * vec4(vKitWorld, 1.0);
  vec2 kMuv = kMc.xy / kMc.w + kWarp * 0.006;
  vec3 kRef = texture2D(uMirror, kMuv).rgb;
  outgoingLight = mix(outgoingLight, kRef * uMirrorK, kF * kIceAmt);
}
#include <opaque_fragment>`;
