// kit-glsl.js - GLSL chunks for Slowreel scenes (re-exported by kit.js as GLSL). Every chunk is guarded (#ifndef), so
// you can paste several that need each other: GLSL.common is always safe to include first. All names start with k / K
// so they never clash with three.js chunks. Written for WebGL2 (GLSL ES 3.00 through three's ShaderMaterial), loops
// have constant bounds so they also compile on WebGL1.

export const common = /* glsl */`
#ifndef KIT_COMMON
#define KIT_COMMON
#define K_PI 3.14159265359
#define K_TAU 6.28318530718
float kSat(float x) { return clamp(x, 0.0, 1.0); }
vec3 kSat(vec3 x) { return clamp(x, 0.0, 1.0); }
float kLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float kRemap(float x, float a, float b, float c, float d) { return c + (d - c) * clamp((x - a) / (b - a), 0.0, 1.0); }
// hashes without sine (Dave Hoskins, MIT): stable on every GPU, inputs up to ~1e5
float kHash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float kHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float kHash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 kHash21(float p) { vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec2 kHash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 kHash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
vec4 kHash42(vec2 p) { vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099)); p4 += dot(p4, p4.wzxy + 33.33); return fract((p4.xxyz + p4.yzzw) * p4.zywx); }
vec4 kHash41(float p) { vec4 p4 = fract(vec4(p) * vec4(0.1031, 0.1030, 0.0973, 0.1099)); p4 += dot(p4, p4.wzxy + 33.33); return fract((p4.xxyz + p4.yzzw) * p4.zywx); }
// Henyey-Greenstein phase (normalised over the sphere)
float kPhaseHG(float cosT, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * K_PI * pow(max(1.0 + g2 - 2.0 * g * cosT, 1e-4), 1.5)); }
float kPhaseRayleigh(float cosT) { return 3.0 / (16.0 * K_PI) * (1.0 + cosT * cosT); }
float kFresnel(float cosT, float f0) { return f0 + (1.0 - f0) * pow(1.0 - kSat(cosT), 5.0); }
vec3 kSrgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 kLinearToSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
// blackbody colour (linear, normalised), 1000..12000 K - lanterns ~1900, candles ~1800, sodium ~2100, moon ~4100
vec3 kBlackbody(float k) {
  float t = k / 100.0; vec3 c;
  c.r = t <= 66.0 ? 1.0 : clamp(1.29293618 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
  c.g = t <= 66.0 ? clamp(0.39008157 * log(t) - 0.63184144, 0.0, 1.0) : clamp(1.12989086 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
  c.b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.54320678 * log(t - 10.0) - 1.19625408, 0.0, 1.0));
  return kSrgbToLinear(c);
}
#endif
`;

export const noise = /* glsl */`
#ifndef KIT_NOISE
#define KIT_NOISE
// value noise (quintic), 0..1
float kValue2(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(kHash12(i), kHash12(i + vec2(1, 0)), u.x), mix(kHash12(i + vec2(0, 1)), kHash12(i + vec2(1, 1)), u.x), u.y);
}
float kValue3(vec3 p) {
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(kHash13(i), kHash13(i + vec3(1, 0, 0)), u.x), mix(kHash13(i + vec3(0, 1, 0)), kHash13(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(kHash13(i + vec3(0, 0, 1)), kHash13(i + vec3(1, 0, 1)), u.x), mix(kHash13(i + vec3(0, 1, 1)), kHash13(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
// simplex noise (Ashima Arts / Stefan Gustavson, MIT), -1..1
vec2 kMod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 kMod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 kMod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 kPermute(vec3 x) { return kMod289(((x * 34.0) + 1.0) * x); }
vec4 kPermute(vec4 x) { return kMod289(((x * 34.0) + 1.0) * x); }
float kSimplex2(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy)); vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  i = kMod289(i);
  vec3 p = kPermute(kPermute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0); m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0; vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5); vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float kSimplex3(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy;
  i = kMod289(i);
  vec4 p = kPermute(kPermute(kPermute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857; vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z); vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0; vec4 s1 = floor(b1) * 2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = 1.79284291400159 - 0.85373472095314 * vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0); m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
// fractal sums. oct <= 8. fbm returns ~0..1 (value) or ~-1..1 (simplex)
const mat2 K_ROT2 = mat2(0.80, 0.60, -0.60, 0.80);
float kFbm2(vec2 p, int oct) { float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * kValue2(p); n += a; p = K_ROT2 * p * 2.03 + 17.1; a *= 0.5; } return s / n; }
float kFbmS2(vec2 p, int oct) { float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * kSimplex2(p); n += a; p = K_ROT2 * p * 2.01 + 7.3; a *= 0.5; } return s / n; }
float kFbm3(vec3 p, int oct) { float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * kValue3(p); n += a; p = p * 2.02 + vec3(17.1, 3.7, 9.2); a *= 0.5; } return s / n; }
float kFbmS3(vec3 p, int oct) { float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * kSimplex3(p); n += a; p = p * 2.02 + vec3(7.1, 3.3, 1.9); a *= 0.5; } return s / n; }
// ridged (mountain crests), 0..1
float kRidged2(vec2 p, int oct) { float s = 0.0, a = 0.5, n = 0.0, w = 1.0; for (int i = 0; i < 8; i++) { if (i >= oct) break; float r = 1.0 - abs(kSimplex2(p)); r *= r * w; w = clamp(r * 2.0, 0.0, 1.0); s += a * r; n += a; p = K_ROT2 * p * 2.07 + 3.1; a *= 0.5; } return s / n; }
// domain-warped fbm (clouds, mist, marble), 0..1
float kWarp2(vec2 p, int oct, float amount) { vec2 q = vec2(kFbm2(p, oct), kFbm2(p + vec2(5.2, 1.3), oct)); return kFbm2(p + amount * (q - 0.5) * 4.0, oct); }
// cellular (Worley): x = F1, y = F2 distances in cell units
vec2 kWorley2(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 d = vec2(8.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)); vec2 o = kHash22(i + g); float r = length(g + o - f);
    if (r < d.x) { d.y = d.x; d.x = r; } else if (r < d.y) d.y = r;
  }
  return d;
}
// tileable versions for baked textures: period in cells (integers)
vec2 kGrad2p(vec2 i, vec2 per) { float a = kHash12(mod(i, per)) * K_TAU; return vec2(cos(a), sin(a)); }
float kPerlin2p(vec2 p, vec2 per) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(kGrad2p(i, per), f), b = dot(kGrad2p(i + vec2(1, 0), per), f - vec2(1, 0));
  float c = dot(kGrad2p(i + vec2(0, 1), per), f - vec2(0, 1)), d = dot(kGrad2p(i + vec2(1, 1), per), f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4142;
}
float kFbm2p(vec2 p, vec2 per, int oct) { float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * kPerlin2p(p, per); n += a; p *= 2.0; per *= 2.0; a *= 0.5; } return s / n * 0.5 + 0.5; }
vec2 kWorley2p(vec2 p, vec2 per) {
  vec2 i = floor(p), f = fract(p); vec2 d = vec2(8.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)); vec2 o = kHash22(mod(i + g, per)); float r = length(g + o - f);
    if (r < d.x) { d.y = d.x; d.x = r; } else if (r < d.y) d.y = r;
  }
  return d;
}
#endif
`;

export const curl = /* glsl */`
#ifndef KIT_CURL
#define KIT_CURL
// divergence-free flow (curl of a simplex potential): drifting mist, embers, snow turbulence. ~unit magnitude
vec3 kCurl3(vec3 p) {
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0), dy = vec3(0.0, e, 0.0), dz = vec3(0.0, 0.0, e);
  vec3 a = vec3(kSimplex3(p), kSimplex3(p + vec3(31.4, 7.7, 2.1)), kSimplex3(p + vec3(-5.3, 19.9, 41.0)));
  vec3 ax = vec3(kSimplex3(p + dx), kSimplex3(p + dx + vec3(31.4, 7.7, 2.1)), kSimplex3(p + dx + vec3(-5.3, 19.9, 41.0)));
  vec3 ay = vec3(kSimplex3(p + dy), kSimplex3(p + dy + vec3(31.4, 7.7, 2.1)), kSimplex3(p + dy + vec3(-5.3, 19.9, 41.0)));
  vec3 az = vec3(kSimplex3(p + dz), kSimplex3(p + dz + vec3(31.4, 7.7, 2.1)), kSimplex3(p + dz + vec3(-5.3, 19.9, 41.0)));
  vec3 gx = (ax - a) / e, gy = (ay - a) / e, gz = (az - a) / e;
  return vec3(gy.z - gz.y, gz.x - gx.z, gx.y - gy.x) * 0.25;
}
#endif
`;

export const tonemap = /* glsl */`
#ifndef KIT_TONEMAP
#define KIT_TONEMAP
// ACES fitted (Stephen Hill), same as three.js ACESFilmicToneMapping (exposure 1 here = three's exposure 1)
vec3 kRRTODT(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 kACES(vec3 c) {
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c = IN * (c / 0.6); c = kRRTODT(c); c = OUT * c; return clamp(c, 0.0, 1.0);
}
// AgX (Troy Sobotka; three.js r160 port): softer, keeps hue of saturated lights (neon, lanterns) instead of going yellow/white
vec3 kAgXContrast(vec3 x) { vec3 x2 = x * x; vec3 x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 kAgX(vec3 c) {
  const mat3 S2R = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 R2S = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 INSET = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 OUTSET = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  c = S2R * c; c = INSET * c; c = max(c, 1e-10); c = log2(c);
  c = (c + 12.47393) / (4.026069 + 12.47393); c = clamp(c, 0.0, 1.0);
  c = kAgXContrast(c); c = OUTSET * c; c = pow(max(vec3(0.0), c), vec3(2.2)); c = R2S * c;
  return clamp(c, 0.0, 1.0);
}
#endif
`;

// Physical sky model shared by the sky-view LUT (kit-sky.js), the fog and the water. Units: km. One "sun" + one "moon".
export const atmosphere = /* glsl */`
#ifndef KIT_ATMO
#define KIT_ATMO
const float K_RE = 6360.0, K_RA = 6460.0;
uniform float uAtmoRayleigh, uAtmoMie, uAtmoOzone, uAtmoMieG, uAtmoAltitude;
vec3 kBetaR() { return vec3(5.802e-3, 13.558e-3, 33.1e-3) * uAtmoRayleigh; }
vec3 kBetaO() { return vec3(0.650e-3, 1.881e-3, 0.085e-3) * uAtmoOzone; }
float kRaySphere(vec3 ro, vec3 rd, float r) { float b = dot(ro, rd), c = dot(ro, ro) - r * r, d = b * b - c; if (d < 0.0) return -1.0; d = sqrt(d); float t = -b - d; return t > 0.0 ? t : -b + d; }
bool kHitsGround(vec3 ro, vec3 rd) { float b = dot(ro, rd), c = dot(ro, ro) - K_RE * K_RE; return b < 0.0 && b * b - c > 0.0; }
// extinction at a height (km above the ground): rayleigh, mie, ozone densities
vec3 kDens(float h) { return vec3(exp(-h / 8.0), exp(-h / 1.2), max(0.0, 1.0 - abs(h - 25.0) / 15.0)); }
vec3 kExt(vec3 d) { return kBetaR() * d.x + vec3(4.4e-3 + 3.996e-3) * uAtmoMie * d.y + kBetaO() * d.z; }
vec3 kTransmittanceTo(vec3 p, vec3 dir) {
  if (kHitsGround(p, dir)) return vec3(0.0);
  float tl = kRaySphere(p, dir, K_RA); float ds = tl / 8.0; vec3 od = vec3(0.0);
  for (int i = 0; i < 8; i++) { vec3 q = p + dir * ds * (float(i) + 0.5); od += kExt(kDens(length(q) - K_RE)) * ds; }
  return exp(-od);
}
// single scattering + a cheap multiple-scattering term (msFactor), one directional source of radiance E
vec3 kScatter(vec3 rd, vec3 L, float E, int steps, float msFactor) {
  vec3 ro = vec3(0.0, K_RE + uAtmoAltitude, 0.0);
  float tmax = kRaySphere(ro, rd, K_RA);
  if (kHitsGround(ro, rd)) { float b = dot(ro, rd), c = dot(ro, ro) - K_RE * K_RE; tmax = -b - sqrt(max(b * b - c, 0.0)); }
  float ds = tmax / float(steps), cosT = dot(rd, L);
  float pr = kPhaseRayleigh(cosT), pm = kPhaseHG(cosT, uAtmoMieG);
  vec3 sum = vec3(0.0), od = vec3(0.0);
  for (int i = 0; i < 32; i++) {
    if (i >= steps) break;
    vec3 q = ro + rd * ds * (float(i) + 0.5); float h = length(q) - K_RE; vec3 d = kDens(h);
    vec3 ext = kExt(d); od += ext * ds * 0.5;
    vec3 T = exp(-od); vec3 Ts = kTransmittanceTo(q, L);
    vec3 sR = kBetaR() * d.x, sM = vec3(3.996e-3) * uAtmoMie * d.y;
    sum += T * ((sR * pr + sM * pm) * Ts + (sR + sM) * msFactor * (Ts * 0.6 + 0.08 * max(L.y + 0.1, 0.0))) * ds;
    od += ext * ds * 0.5;
  }
  return sum * E;
}
// sky-view LUT mapping (azimuth, non-linear elevation: more texels near the horizon)
vec2 kSkyUV(vec3 d) { float az = atan(d.z, d.x); float el = asin(clamp(d.y, -1.0, 1.0)); float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (0.5 * K_PI)); return vec2(az / K_TAU + 0.5, v); }
vec3 kSkyDir(vec2 uv) { float az = (uv.x - 0.5) * K_TAU; float a = 2.0 * uv.y - 1.0; float el = sign(a) * a * a * 0.5 * K_PI; return vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az)); }
#endif
`;

// Height fog with aerial perspective (needs atmosphere's kSkyUV and these uniforms: kit-sky.js fog.uniforms).
export const fog = /* glsl */`
#ifndef KIT_FOG
#define KIT_FOG
uniform sampler2D uSkyLut;
uniform vec3 uFogSunDir, uFogSunColor, uFogTint, uFogWind;
uniform float uFogDensity, uFogBase, uFogFalloff, uFogSunG, uFogSunStrength, uFogNoise, uFogTime, uFogStart, uFogSkyAmount, uFogOn;
vec2 kFogSkyUV(vec3 d) { float az = atan(d.z, d.x); float el = asin(clamp(d.y, -1.0, 1.0)); float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / 1.5707963); return vec2(az / 6.2831853 + 0.5, v); }
// optical depth of exponential height fog along a ray (analytic)
float kFogOD(vec3 ro, vec3 rd, float dist) {
  float k = max(uFogFalloff, 1e-5), h0 = ro.y - uFogBase, fy = rd.y * dist * k;
  float lin = abs(fy) > 1e-4 ? (1.0 - exp(-fy)) / fy : 1.0 - 0.5 * fy;
  return uFogDensity * exp(-k * h0) * max(dist - uFogStart, 0.0) * lin;
}
// the colour fog adds in direction rd: sky light from the LUT (aerial perspective) + forward-scattered sun
vec3 kFogInscatter(vec3 rd) {
  vec3 sky = texture2D(uSkyLut, kFogSkyUV(normalize(vec3(rd.x, max(rd.y, 0.04), rd.z)))).rgb;
  return (sky * uFogSkyAmount + uFogSunColor * kPhaseHG(dot(rd, uFogSunDir), uFogSunG) * uFogSunStrength) * uFogTint;
}
// transmittance only (for additive particles)
float kFogT(vec3 wpos, vec3 cam) { vec3 r = wpos - cam; float d = length(r); return uFogOn > 0.5 ? exp(-kFogOD(cam, r / max(d, 1e-4), d)) : 1.0; }
vec3 kFog(vec3 col, vec3 wpos, vec3 cam) {
  if (uFogOn < 0.5) return col;
  vec3 r = wpos - cam; float d = length(r); vec3 rd = r / max(d, 1e-4);
  float od = kFogOD(cam, rd, d);
  if (uFogNoise > 0.0) { vec3 m = cam + rd * min(d, 60.0) * 0.5; od *= mix(1.0, 0.35 + 1.3 * kValue3(m * 0.08 + uFogWind * uFogTime), uFogNoise); }
  float T = exp(-od);
  return col * T + kFogInscatter(rd) * (1.0 - T);
}
#endif
`;

// Rain ripples on a horizontal wet surface (cells of rings, Lagarde style). Returns the height gradient (d/dx, d/dz) at
// p (world xz, metres); add it to the normal as n = normalize(vec3(-g.x, 1, -g.y)). density 0..1, layers 1..2.
export const ripples = /* glsl */`
#ifndef KIT_RIPPLES
#define KIT_RIPPLES
vec2 kRippleLayer(vec2 q, float t, float density) {
  vec2 cell = floor(q), g = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j)); vec4 h = kHash42(c + 0.37);
    if (h.w > density) continue;
    float period = 0.55 + h.z * 0.7, ph = fract(t / period + h.x);
    vec2 d = q - (c + 0.15 + 0.7 * h.xy); float r = length(d);
    float s = r - ph * 0.85, w = 0.09;
    float env = exp(-s * s / (w * w)) * (1.0 - ph) * (1.0 - ph);
    float dh = (cos(s * 38.0) * 38.0 - 2.0 * s / (w * w) * sin(s * 38.0)) * env * 0.012;
    g += d / max(r, 1e-3) * dh;
  }
  return g;
}
vec2 kRipples(vec2 p, float t, float density, int layers) {
  vec2 g = kRippleLayer(p * 3.1, t, density) * 3.1;
  if (layers > 1) g += kRippleLayer(p * 4.7 + 13.7, t * 1.13 + 0.5, density * 0.8) * 4.7 * 0.7;
  return g;
}
#endif
`;

// Triplanar sampling (rock, plaster, bark on any shape without UVs). scale = repeats per metre.
export const triplanar = /* glsl */`
#ifndef KIT_TRIPLANAR
#define KIT_TRIPLANAR
vec4 kTriplanar(sampler2D tex, vec3 p, vec3 n, float scale) {
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture2D(tex, p.yz * scale) * w.x + texture2D(tex, p.xz * scale) * w.y + texture2D(tex, p.xy * scale) * w.z;
}
#endif
`;

/** Every chunk joined in dependency order (common, noise, curl, tonemap, ripples, triplanar). Atmosphere/fog are separate. */
export const all = common + noise + curl + tonemap + ripples + triplanar;
