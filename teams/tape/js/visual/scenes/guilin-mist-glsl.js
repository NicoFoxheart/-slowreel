// guilin-mist-glsl.js - shader code for the Guilin river scene (guilin-mist.js): the layered river mist (analytic
// optical depth of a ground-hugging exponential layer + two drifting gaussian cloud bands that wrap the karst peaks
// halfway up, patchy from a tiling noise texture, lit by sky ambient + forward-scattered sun), the material patch for
// limestone karsts / floodplain / phoenix-tail bamboo (triplanar procedural canopy, cliffs with rain streaks, derivative
// bump, cavity AO, optional sumi-e ink look) and the detail-texture bake.

// ------------------------------------------------------------------------------------------------ mist (shared)
export const MIST = /* glsl */`
#ifndef GM_MIST
#define GM_MIST
uniform sampler2D uGmMistTex;
uniform vec4 uGmLow;    // density (1/m), scale height (m), patchiness 0..1, -
uniform vec4 uGmBand;   // density, centre height (m), thickness (m), patchiness
uniform vec4 uGmBand2;  // a second, higher and thinner band
uniform vec4 uGmWind;   // noise uv offsets (two scales)
uniform vec3 uGmAmb, uGmSun, uGmSunDir;
uniform float uGmG, uGmOn;
float gmErf(float x) { float x2 = x * x; float e = 1.0 - exp(-x2 * (1.2732395 + 0.147 * x2) / (1.0 + 0.147 * x2)); return sign(x) * sqrt(max(e, 0.0)); }
float gmNoise(vec2 xz) {
  float a = texture2D(uGmMistTex, xz / 1700.0 + uGmWind.xy).r;
  float b = texture2D(uGmMistTex, xz / 430.0 + uGmWind.zw).g;
  return clamp(a * 0.75 + b * 0.55 - 0.15, 0.0, 1.0);
}
float gmExpOD(float y0, float y1, float len, float h) {
  float fy = (y1 - y0) / h; float lin = abs(fy) > 1e-4 ? (1.0 - exp(-fy)) / fy : 1.0 - 0.5 * fy;
  return exp(-y0 / h) * len * lin;
}
float gmBandOD(float y0, float y1, float len, float H, float W) {
  float dy = y1 - y0;
  if (abs(dy) < 0.05 * W) { float u = (0.5 * (y0 + y1) - H) / W; return exp(-u * u) * len; }
  return len / dy * W * 0.8862269 * (gmErf((y1 - H) / W) - gmErf((y0 - H) / W));
}
float gmBandAt(vec3 ro, vec3 rd, float d, vec4 B, float seedOff) {
  if (B.x <= 0.0) return 0.0;
  float yr0 = abs(ro.y), yr1 = abs(ro.y + rd.y * d);
  // where the ray crosses the band centre: patch noise + a local height shift there
  float sc = abs(rd.y) > 1e-4 ? clamp((B.y - ro.y) / rd.y, 0.0, d) : d * 0.5;
  vec2 pc = ro.xz + rd.xz * sc;
  float n = gmNoise(pc * 0.8 + seedOff);
  float H = B.y + B.z * 1.6 * (texture2D(uGmMistTex, pc / 2600.0 + uGmWind.zw * 0.5 + seedOff * 0.001).b - 0.5);
  float od;
  if (ro.y < 0.0 && ro.y + rd.y * d > 0.0) { float s0 = -ro.y / rd.y; od = gmBandOD(-ro.y, 0.0, s0, H, B.z) + gmBandOD(0.0, ro.y + rd.y * d, d - s0, H, B.z); }
  else od = gmBandOD(yr0, yr1, d, H, B.z);
  float patchy = smoothstep(0.42, 0.72, n);
  return B.x * od * mix(1.0, patchy * 2.0, B.w);
}
float gmOD(vec3 ro, vec3 rd, float d) {
  float y1 = ro.y + rd.y * d, od;
  if (ro.y < 0.0 && y1 > 0.0) { float s0 = -ro.y / rd.y; od = gmExpOD(-ro.y, 0.0, s0, uGmLow.y) + gmExpOD(0.0, y1, d - s0, uGmLow.y); }
  else od = gmExpOD(abs(ro.y), abs(y1), d, uGmLow.y);
  vec2 pm = ro.xz + rd.xz * min(d, 420.0) * 0.55, pe = ro.xz + rd.xz * d;
  float n = 0.55 * gmNoise(pm) + 0.45 * gmNoise(pe + 300.0);
  od *= uGmLow.x * mix(1.0, smoothstep(0.1, 0.85, n) * 1.7, uGmLow.z);
  od += gmBandAt(ro, rd, d, uGmBand, 0.0) + gmBandAt(ro, rd, d, uGmBand2, 777.0);
  return od;
}
float gmHG(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566371 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
vec3 gmMistColor(vec3 rd) { return uGmAmb + uGmSun * gmHG(dot(rd, uGmSunDir), uGmG); }
vec3 gmMist(vec3 col, vec3 wp, vec3 cam) {
  if (uGmOn < 0.5) return col;
  vec3 r = wp - cam; float d = length(r); vec3 rd = r / max(d, 1e-3);
  float T = exp(-gmOD(cam, rd, d));
  return col * T + gmMistColor(rd) * (1.0 - T);
}
#endif
`;

// the mist in front of the sky (a big camera-centred back-faced sphere, premultiplied: rgb = in-scatter, a = T)
export const MIST_SKY_VS = /* glsl */`
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
export const MIST_SKY_FS = /* glsl */`
varying vec3 vW;
void main() {
  vec3 r = vW - cameraPosition; float d = length(r); vec3 rd = r / d;
  float T = exp(-gmOD(cameraPosition, rd, d));
  gl_FragColor = vec4(gmMistColor(rd) * (1.0 - T), T);
}`;

// ------------------------------------------------------------------------------------------------ detail bake
// r: broad tone (tileable fbm), g: canopy crowns (inverted worley, two scales), b: vertical streak noise, a: fine fbm
export const DETAIL_FS = /* glsl */`vec4 bake(vec2 uv) {
  float broad = kFbm2p(uv * 4.0, vec2(4.0), 5);
  vec2 w1 = kWorley2p(uv * 6.0, vec2(6.0)), w2 = kWorley2p(uv * 15.0 + 3.1, vec2(15.0));
  float crowns = 1.0 - smoothstep(0.0, 0.62, w1.x); crowns = crowns * 0.7 + (1.0 - smoothstep(0.0, 0.6, w2.x)) * 0.35;
  crowns *= 0.75 + 0.35 * kFbm2p(uv * 24.0, vec2(24.0), 3);
  float streak = kFbm2p(uv * vec2(28.0, 2.0), vec2(28.0, 2.0), 4);
  float fine = kFbm2p(uv * 32.0, vec2(32.0), 4);
  return vec4(broad, clamp(crowns, 0.0, 1.0), streak, fine);
}`;

// ------------------------------------------------------------------------------------------------ land material patch
// GM_KIND 0 = karst limestone + forest, 1 = floodplain / banks, 2 = phoenix-tail bamboo clumps
export const LAND_VS_HEAD = /* glsl */`
attribute float aAO;
uniform float uGmTime; uniform vec2 uGmWindV;
varying vec3 vGmW; varying vec3 vGmN; varying float vGmAO; varying vec2 vGmSeed; varying float vGmH;`;
export const LAND_VS_BEGIN = /* glsl */`
#if GM_KIND == 2
{ // bamboo sway: plumes bend with height, each clump on its own phase, wind gusts travel along the bank
  vec2 sp = vec2(0.0);
  #ifdef USE_INSTANCING
    sp = instanceMatrix[3].xz;
  #endif
  float hgt = max(position.y, 0.0), k = hgt * hgt * 0.012;
  float ph = sp.x * 0.07 + sp.y * 0.05;
  float g = 0.6 + 0.4 * sin(uGmTime * 0.37 + sp.y * 0.013);
  transformed.x += k * (uGmWindV.x * g + 0.35 * sin(uGmTime * 1.1 + ph) + 0.12 * sin(uGmTime * 2.7 + ph * 2.3));
  transformed.z += k * (uGmWindV.y * g + 0.25 * sin(uGmTime * 0.9 + ph * 1.7));
}
#endif`;
export const LAND_VS_END = /* glsl */`
{
  vec4 gw = vec4(transformed, 1.0); vec3 gn = objectNormal; vec2 sd = modelMatrix[3].xz;
  #ifdef USE_INSTANCING
    gw = instanceMatrix * gw;
    mat3 gim = mat3(instanceMatrix); gn /= vec3(dot(gim[0], gim[0]), dot(gim[1], gim[1]), dot(gim[2], gim[2])); gn = gim * gn;
    sd = instanceMatrix[3].xz;
  #endif
  gw = modelMatrix * gw; vGmW = gw.xyz; vGmN = normalize(mat3(modelMatrix) * gn); vGmAO = aAO; vGmSeed = sd; vGmH = position.y;
}`;
export const LAND_FS_HEAD = /* glsl */`
uniform sampler2D uGmDetail; uniform float uGmInk, uGmWet, uGmBump;
varying vec3 vGmW; varying vec3 vGmN; varying float vGmAO; varying vec2 vGmSeed; varying float vGmH;
vec4 gmTri(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture2D(uGmDetail, p.zy) * w.x + texture2D(uGmDetail, p.xz) * w.y + texture2D(uGmDetail, p.xy) * w.z;
}
float gmHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`;
export const LAND_FS_COLOR = /* glsl */`
vec3 gmNw = normalize(vGmN); float gmHgt = 0.0, gmRough = 0.85, gmRim = 0.0;
float gmFar = smoothstep(60.0, 420.0, length(vGmW - cameraPosition));   // fade sub-pixel bump detail (no sparkle)
{
  vec3 P = vGmW; float tone = gmHash(floor(vGmSeed * 0.37)), tone2 = gmHash(floor(vGmSeed * 0.53) + 7.0);
  vec4 big = gmTri(P / 260.0, gmNw), mid = gmTri(P / 26.0, gmNw), sm = gmTri(P / 7.5, gmNw);
  vec3 alb;
#if GM_KIND == 0
  // forest canopy on every ledge, grey-ochre limestone where the wall is steep (with dark rain streaks)
  float steep = 1.0 - gmNw.y;
  // shrubs cling to everything but the sheerest faces: rock only in patches of steep wall
  float rock = smoothstep(0.64, 0.74, big.r * 0.5 + mid.b * 0.3 + mid.a * 0.2 + tone2 * 0.15 + (steep - 0.85) * 0.25);
  rock *= smoothstep(0.35, 0.75, steep);
  float crowns = mid.g * 0.65 + sm.g * 0.45;
  vec3 vegA = vec3(0.020, 0.036, 0.016), vegB = vec3(0.050, 0.075, 0.030), vegC = vec3(0.060, 0.062, 0.032);
  vec3 veg = mix(vegA, vegB, crowns * crowns) * (0.8 + 0.4 * big.r);
  veg = mix(veg, vegC * (0.8 + 0.4 * sm.a), smoothstep(0.55, 0.8, big.g * 0.6 + tone * 0.5) * 0.6);   // drier / autumn patches
  veg *= 0.85 + 0.3 * tone;
  float streak = smoothstep(0.35, 0.75, mid.b) * 0.65 + smoothstep(0.5, 0.8, sm.b) * 0.25;
  vec3 lime = mix(vec3(0.22, 0.215, 0.20), vec3(0.26, 0.20, 0.13), smoothstep(0.45, 0.75, big.a + tone2 * 0.3));   // grey / iron-stained
  lime *= (0.65 + 0.5 * sm.a) * (1.0 - 0.55 * streak);
  alb = mix(veg, lime, rock);
  gmHgt = mix((mid.g - 0.5) * 2.0 + (sm.g - 0.5) * 1.2 * (1.0 - gmFar), ((sm.a - 0.5) * 0.9 - streak * 0.5) * (1.0 - gmFar) + (mid.a - 0.5) * 0.6, rock);
  gmRough = mix(0.82, 0.7, rock);
  // ink: wet black wash on the peaks, Mi dots where the forest is, paler cliffs
  vec3 ink = vec3(mix(0.016, 0.002, smoothstep(0.3, 0.7, crowns)) * (0.6 + 0.7 * big.r));
  ink = mix(ink, vec3(0.06 + 0.06 * (1.0 - streak)), rock * 0.8);
  alb = mix(alb, ink, uGmInk);
#elif GM_KIND == 1
  // floodplain: grass and rice-field greens, pale gravel and wet stones at the water line
  float beach = 1.0 - smoothstep(0.35, 1.6, P.y + (mid.r - 0.5) * 0.9);
  vec3 grass = mix(vec3(0.045, 0.07, 0.025), vec3(0.09, 0.10, 0.045), big.r) * (0.7 + 0.5 * mid.g);
  grass = mix(grass, vec3(0.03, 0.05, 0.022), smoothstep(0.5, 0.8, sm.g) * 0.6);
  vec3 grav = mix(vec3(0.16, 0.15, 0.13), vec3(0.26, 0.24, 0.21), sm.a) * (0.75 + 0.4 * mid.g);
  float wetline = 1.0 - smoothstep(0.0, 0.45, P.y);
  grav *= mix(1.0, 0.55, max(wetline, uGmWet * 0.5));
  alb = mix(grass, grav, beach);
  gmHgt = mix((sm.g - 0.5) * 0.25, (sm.a - 0.5) * 0.12, beach);
  gmRough = mix(0.9, mix(0.8, 0.5, wetline), beach);
  alb = mix(alb, vec3(mix(0.22, 0.08, 1.0 - beach) * (0.8 + 0.3 * big.r)), uGmInk);
#else
  // bamboo plumes: fresh yellow-green feathers, darker inside the clump
  float depth = clamp(vGmAO, 0.0, 1.0);
  vec3 bam = mix(vec3(0.020, 0.032, 0.012), mix(vec3(0.07, 0.10, 0.03), vec3(0.10, 0.11, 0.04), tone), depth);
  bam *= 0.75 + 0.5 * sm.g;
  alb = bam;
  gmHgt = (sm.g - 0.5) * 0.6 + (mid.a - 0.5) * 0.3;
  gmRough = 0.7;
  alb = mix(alb, vec3(0.012 + 0.03 * sm.g), uGmInk);
#endif
#if GM_KIND != 2
  alb *= mix(0.45, 1.0, vGmAO);
#endif
  diffuseColor.rgb = alb;
}`;
export const LAND_FS_ROUGH = /* glsl */`roughnessFactor = gmRough;`;
export const LAND_FS_NORMAL = /* glsl */`
{
  vec3 sp = -vViewPosition; vec3 dpx = dFdx(sp), dpy = dFdy(sp);
  float dhx = dFdx(gmHgt), dhy = dFdy(gmHgt);
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx); float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  normal = normalize(abs(det) * normal - grad * uGmBump);
  gmRim = 1.0 - abs(dot(normal, normalize(vViewPosition)));
}`;
// ink: darken silhouettes like a brush contour, flatten the light into a wash
export const LAND_FS_OUT = /* glsl */`
if (uGmInk > 0.0) {
  float lum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  vec3 wash = vec3(lum) * 0.8 + diffuseColor.rgb * 0.6;
  outgoingLight = mix(outgoingLight, wash, uGmInk * 0.7) * (1.0 - uGmInk * 0.65 * smoothstep(0.6, 0.97, gmRim));
}`;
