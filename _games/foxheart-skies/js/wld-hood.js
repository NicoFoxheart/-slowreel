// Neighbourhoods: real-looking suburbs, terraces, apartment blocks and downtowns instead of boxes.
// One street grid per world (blocks of 110 m, rotated per region); every block gets a class from the city density
// (the same analytic city blobs the terrain masks are painted from) and a deterministic layout from a hash of its
// index. The SAME formulas run in GLSL (HOOD_GLSL, used by the terrain shader to paint streets, sidewalks, lawns,
// driveways, hedges, pools, tree canopies and the far roofs) and in JS (genBlock: the 3D houses, garages, trees,
// pools, cars and lamps near the camera, and the tall buildings of the far ring), so the 3D houses sit exactly on
// their painted lots. Region styles: stucco + barrel tile + pools + palms (Florida, Gulf, tropics), brick terraces
// + slate (UK), siding + shingle (US north), plaster + clay tile (Europe), apartment towers (Korea, Japan, China).
import * as THREE from 'three';
import { atmos, ATM } from './sky.js';

export const B = 110, RW = 4.2, RWA = 7.6, SW = 1.9; // block size, street / arterial half width (asphalt), sidewalk width
// region styles: wall + roof palettes (sRGB hex), roof kind mix, pools, trees, garages, terraces, apartment height
export const STYLES = {
  warm: { walls: ['#efe6d4', '#f4efe6', '#e9d7bc', '#f1dcc8', '#dfe6e0', '#f5e9c9', '#e4d1c3'], roofs: ['#b4553a', '#c46a45', '#a9493a', '#d08a5c', '#c9c4bb', '#9b4a35'], hip: 0.7, flat: 0.12, pool: 0.38, palm: 0.55, tree: 0.55, garage: 0.85, two: 0.25, terrace: 0, apt: 9, roofKind: 0, lawn: [0.27, 0.36, 0.14] },
  us: { walls: ['#e6e2d8', '#c9ced1', '#d9cbb0', '#b8c4c7', '#efece6', '#a9a397', '#d3c2a6'], roofs: ['#4a4a4c', '#5b5048', '#3b3d42', '#6a5a4c', '#545a5e', '#7b6a58'], hip: 0.3, flat: 0.04, pool: 0.08, palm: 0, tree: 0.85, garage: 0.9, two: 0.55, terrace: 0, apt: 12, roofKind: 1, lawn: [0.24, 0.33, 0.13] },
  uk: { walls: ['#9a5a43', '#a86a4f', '#8d4f3b', '#b07a5d', '#c9b8a0', '#e7e1d4', '#a3634a'], roofs: ['#4b4e55', '#5a5e66', '#7a4535', '#3f434a', '#6b4031'], hip: 0.25, flat: 0.03, pool: 0, palm: 0, tree: 0.7, garage: 0.25, two: 0.9, terrace: 0.75, apt: 8, roofKind: 2, lawn: [0.22, 0.34, 0.14] },
  eu: { walls: ['#efe8d8', '#e8d9bf', '#f1ece2', '#ddd0b8', '#e9e2cf', '#cfc6b4'], roofs: ['#9e4b33', '#b05a3c', '#8e4232', '#5a5a5e', '#a6543a'], hip: 0.45, flat: 0.08, pool: 0.05, palm: 0, tree: 0.7, garage: 0.5, two: 0.75, terrace: 0.25, apt: 10, roofKind: 0, lawn: [0.24, 0.33, 0.14] },
  asia: { walls: ['#e9e6df', '#d7d9d6', '#cfd3d6', '#e6dccb', '#f1efe9'], roofs: ['#3d5a7a', '#5b5f66', '#7b3d36', '#4c6b5b', '#6e6e70'], hip: 0.4, flat: 0.45, pool: 0, palm: 0, tree: 0.45, garage: 0.15, two: 0.75, terrace: 0, apt: 22, roofKind: 3, lawn: [0.25, 0.32, 0.15] },
  gulf: { walls: ['#e8dcc4', '#efe6d3', '#d9c7a6', '#f2ede2', '#e2d3b6'], roofs: ['#d9cdb6', '#cdbf9f', '#e6dcc8', '#bfae8d'], hip: 0.05, flat: 0.92, pool: 0.45, palm: 0.75, tree: 0.35, garage: 0.6, two: 0.6, terrace: 0, apt: 16, roofKind: 4, lawn: [0.42, 0.38, 0.26] },
};
export function styleFor(apt, climate) {
  const cc = apt?.cc || '', cl = climate || '';
  if (/^(KR|JP|CN|TW|HK)$/.test(cc)) return 'asia'; if (/^(GB|IE)$/.test(cc)) return 'uk'; if (/^(AE|QA|SA|KW|BH|OM)$/.test(cc) || /desert/.test(cl)) return 'gulf';
  if (cc === 'US' || cc === 'CA' || cc === 'AU') return /subtropical|tropical|mediterranean/.test(cl) ? 'warm' : 'us';
  if (/tropical|subtropical|mediterranean/.test(cl)) return 'warm'; return 'eu';
}
export function gridAngleFor(apt, style) { const h = hashStr(apt?.icao || 'X'); return style === 'us' || style === 'warm' ? 0 : style === 'uk' ? (h % 40 - 20) * Math.PI / 180 : ((h % 50) - 25) * Math.PI / 180; }
function hashStr(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

// ---- shared math (keep the JS and GLSL versions identical)
const fr = x => x - Math.floor(x);
export function h12(x, y) { let a = fr(x * 0.1031), b = fr(y * 0.1031), c = fr(x * 0.1031); const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33); a += d; b += d; c += d; return fr((a + b) * c); }
const mix = (a, b, t) => a + (b - a) * t;
const blob = t => t >= 1 ? 0 : t < 0.35 ? 1 - 0.18 * t / 0.35 : t < 0.65 ? 0.82 - 0.44 * (t - 0.35) / 0.3 : 0.38 * (1 - (t - 0.65) / 0.35);
export const NCITY = 24;
// the world-wide hood context: grid rotation, cities (local frame), style
export const HOOD = { c: 1, s: 0, cities: [], style: 'us', S: STYLES.us, on: false, hull: [] };
// the primary airport's fence: convex hull (local frame, CCW in x / z); distance > 0 inside
export function hullDist(x, z) { const H = HOOD.hull, n = H.length; if (n < 3) return -1e5; let m = 1e5; for (let i = 0; i < n; i++) { const a = H[i], b = H[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ex = (b[0] - a[0]) / L, ez = (b[1] - a[1]) / L; m = Math.min(m, ex * (z - a[1]) - ez * (x - a[0])); } return m; }
export function setHood(o) { HOOD.c = Math.cos(o.angle || 0); HOOD.s = Math.sin(o.angle || 0); HOOD.cities = (o.cities || []).slice(0, NCITY); HOOD.style = o.style || 'us'; HOOD.S = STYLES[HOOD.style] || STYLES.us; HOOD.hull = (o.hull || []).slice(0, 16); HOOD.on = true; }
export function densAt(x, z) { let d = 0; for (const c of HOOD.cities) { const t = Math.hypot(x - c.x, z - c.z) / c.r; if (t < 1) d += c.d * blob(t); } return Math.min(1, d); }
function coreAt(x, z) { let h = 0; for (const c of HOOD.cities) { if (c.h < 45) continue; const t = Math.hypot(x - c.x, z - c.z) / c.r; if (t < 0.55) h = Math.max(h, c.h * (1 - t / 0.55)); } return h; }
const isArt = i => ((i % 8) + 8) % 8 === 0;
// block class: 0 none, 1 low suburb, 2 suburb, 3 dense (terraces / townhouses / walk-ups), 4 urban mid-rise, 5 core towers; park flag
export function blockInfo(bi, bj) {
  const { c, s } = HOOD, cu = (bi + 0.5) * B, cv = (bj + 0.5) * B, x = c * cu + s * cv, z = -s * cu + c * cv;
  const dn = densAt(x, z) + (h12(bi * 1.3, bj * 0.7) - 0.5) * 0.12, core = coreAt(x, z);
  const cls = dn < 0.14 ? 0 : core > 30 && dn > 0.5 ? 5 : dn < 0.3 ? 1 : dn < 0.55 ? 2 : dn < 0.74 ? 3 : dn < 0.9 ? 4 : 5;
  const park = cls >= 2 && cls <= 4 && h12(bi * 0.37 + 4.1, bj * 0.53 + 1.7) < 0.07;
  return { cls, park, dn, core, x, z, artL: isArt(bi), artR: isArt(bi + 1), artB: isArt(bj), artT: isArt(bj + 1) };
}
// lots of a low-rise block: two rows of lots facing the streets along u; each lot: house, garage, driveway, pool, trees
export function lotsOf(bi, bj, info) {
  const S = HOOD.S, out = [], cls = info.cls; if (cls < 1 || cls > 3 || info.park) return out;
  const terrace = cls === 3 && h12(bi * 2.1, bj * 1.7) < S.terrace;
  if (cls === 3 && !terrace && S.apt >= 15) return out; // Asian dense blocks are apartment rows (far ring)
  const sxL = info.artL ? 10.8 : 7.6, sxR = info.artR ? 10.8 : 7.6, span = B - sxL - sxR, lotW = cls === 1 ? 30 : cls === 2 ? 22 : terrace ? 6.4 : 15;
  const n = Math.max(1, Math.floor(span / lotW)), lw = span / n;
  for (let row = 0; row < 2; row++) { const front = (row ? info.artT : info.artB) ? 10.8 : 7.6, road = (row ? info.artT : info.artB) ? RWA : RW;
    for (let li = 0; li < n; li++) {
      const kx = bi * 7 + li, ky = bj * 5 + row * 2.3, H = k => h12(kx + k * 3.7, ky + k * 1.9), lotC = sxL + (li + 0.5) * lw;
      const L = { row, li, lotC, lw, front, road, terrace };
      if (terrace) { L.hw = lw - 0.15; L.hd = mix(9, 11.5, H(1)); L.sb = mix(2.2, 3.6, H(2)); }
      else { L.hw = cls === 1 ? Math.min(mix(13, 19, H(0)), lw - 4.2) : cls === 2 ? Math.min(mix(11, 15, H(0)), lw - 3.6) : Math.min(mix(8, 11, H(0)), lw - 3.0); L.hd = cls === 1 ? mix(12, 16, H(1)) : cls === 2 ? mix(11, 14, H(1)) : mix(10, 13, H(1)); L.sb = mix(3.5, 7, H(2)); }
      L.fy0 = front + L.sb;
      L.flat = H(10) < S.flat; L.hip = !L.flat && H(9) < S.hip; L.ridgeU = terrace || H(11) < 0.6; L.st = terrace ? (H(12) < 0.3 ? 3 : 2) : 1 + (H(12) < S.two ? 1 : 0);
      L.gw = 0; L.gs = H(3) > 0.5 ? 1 : -1; if (!terrace && H(13) < S.garage && lw - L.hw >= 4.6) { L.gw = lw - L.hw - 1.4 >= 6.4 ? 6 : 3.4; L.gx = lotC + L.gs * (L.hw / 2 + L.gw / 2); }
      L.pool = !terrace && H(4) < S.pool && L.fy0 + L.hd + 6.6 < B / 2 - 1; if (L.pool) { L.pw = Math.min(7, lw - 2.5); L.px = lotC + (H(5) - 0.5) * Math.max(0, L.hw - L.pw); L.pz0 = L.fy0 + L.hd + 2.2; }
      L.t1 = !terrace && H(6) < S.tree; L.t1x = lotC - L.gs * (L.hw / 2 + 1.8); L.t1y = front + L.sb * 0.45;
      L.t2 = H(7) < S.tree * 0.9 && L.fy0 + L.hd + 5 < B / 2 - 1.5; L.t2x = lotC + (H(8) - 0.5) * lw * 0.6; L.t2y = Math.min(B / 2 - 2.2, L.fy0 + L.hd + 4 + H(14) * 3.5);
      L.t3 = !terrace && H(19) < S.tree * 0.7 && L.fy0 + L.hd + 4 < B / 2 - 3; L.t3x = lotC - (H(8) - 0.5) * lw * 0.6; L.t3y = B / 2 - 3.2;
      L.lit = H(22) < 0.5; L.palm = H(15) < S.palm; L.car = H(16) < 0.55; L.wall = S.walls[(H(17) * S.walls.length) | 0]; L.roof = S.roofs[((H(18) * 6) | 0) % S.roofs.length];
      out.push(L);
    } }
  return out;
}
// tall buildings of a block (far ring): apartment slabs / rows, mid-rise blocks, towers with setbacks
export function tallOf(bi, bj, info) {
  const S = HOOD.S, out = [], cls = info.cls; if (info.park) return out;
  const H = k => h12(bi * 3.1 + k * 5.3, bj * 2.7 + k * 1.3), sx = info.artL ? 11 : 8, sz = info.artB ? 11 : 8, W0 = B - sx - (info.artR ? 11 : 8), D0 = B - sz - (info.artT ? 11 : 8);
  if (cls === 3 && S.apt >= 15) { const rows = 3; for (let r = 0; r < rows; r++) { if (H(r) < 0.18) continue; out.push({ u: sx + W0 * 0.5, v: sz + D0 * (r + 0.5) / rows, w: W0 * mix(0.6, 0.9, H(r + 3)), d: 13, h: 3 * Math.round(mix(12, S.apt + 3, H(r + 6))), kind: 1 }); } return out; }
  if (cls === 3) { if (H(0) < 0.25) out.push({ u: sx + W0 * 0.5, v: sz + D0 * 0.5, w: W0 * 0.8, d: D0 * 0.42, h: 3 * Math.round(mix(3, 5, H(1))), kind: 1 }); return out; }
  if (cls === 4) { const n = 1 + (H(0) < 0.5 ? 1 : 0); for (let k = 0; k < n; k++) out.push({ u: sx + W0 * (n === 1 ? 0.5 : 0.27 + k * 0.46), v: sz + D0 * 0.5, w: W0 * (n === 1 ? mix(0.55, 0.85, H(k + 1)) : 0.42), d: D0 * mix(0.45, 0.8, H(k + 3)), h: 3 * Math.round(mix(4, S.apt, H(k + 5))), kind: H(k + 9) < 0.35 ? 3 : 1 }); return out; }
  if (cls === 5) { const n = H(0) < 0.4 ? 1 : 2; const hmax = Math.max(40, info.core * mix(0.45, 1.15, H(1)));
    for (let k = 0; k < n; k++) { const w = mix(24, 44, H(k + 2)) * (n === 2 ? 0.85 : 1), d = mix(24, 40, H(k + 4)); out.push({ u: sx + W0 * (n === 1 ? 0.5 : 0.28 + k * 0.44), v: sz + D0 * mix(0.35, 0.65, H(k + 6)), w, d, h: Math.max(30, hmax * mix(0.55, 1, H(k + 8))), kind: H(k + 10) < 0.6 ? 2 : 3, tiers: H(k + 12) < 0.55 ? 3 : 1 }); }
    if (H(20) < 0.6) out.push({ u: sx + W0 * 0.5, v: sz + D0 * 0.9, w: W0 * 0.8, d: 14, h: 3 * Math.round(mix(3, 6, H(21))), kind: 3 }); return out; }
  return out;
}
export const toLocal = (u, v) => [HOOD.c * u + HOOD.s * v, -HOOD.s * u + HOOD.c * v];
export const toGrid = (x, z) => [HOOD.c * x - HOOD.s * z, HOOD.s * x + HOOD.c * z];

// ---- GLSL twin: paint a lot / street / park on the ground (terrain fragment shader)
export const HOOD_GLSL = /* glsl */`
uniform vec4 uHood; uniform vec4 uCity[${NCITY}]; uniform float uCityHa[${NCITY}]; uniform vec2 uHull[16]; uniform float uHullN; uniform vec4 uRoadSeg[24]; uniform float uRoadW[24]; uniform float uRoadN; uniform vec3 uRoadIx; uniform vec3 uRoofs[6]; uniform vec4 uHoodS; uniform vec4 uHoodS2;
float hBlob(float t){ return t >= 1.0 ? 0.0 : t < 0.35 ? 1.0 - 0.18 * t / 0.35 : t < 0.65 ? 0.82 - 0.44 * (t - 0.35) / 0.3 : 0.38 * (1.0 - (t - 0.65) / 0.35); }
vec2 hDens(vec2 x){ float d = 0.0, core = 0.0; for (int i = 0; i < ${NCITY}; i++) { vec4 c = uCity[i]; if (c.z > 1.0) { float t = length(x - c.xy) / c.z; d += c.w * hBlob(t); if (uCityHa[i] >= 45.0 && t < 0.55) core = max(core, uCityHa[i] * (1.0 - t / 0.55)); } } return vec2(min(1.0, d), core); }
bool hArt(float i){ return abs(mod(i, 8.0)) < 0.5; }
float hRect(vec2 q, vec2 a, vec2 b){ vec2 d = max(a - q, q - b); return max(d.x, d.y); } // <0 inside
// airport fence: the primary airport's convex hull (local frame, CCW); >0 inside (metres from the fence)
float hHull(vec2 x){ if (uHullN < 3.0) return -1e5; float m = 1e5; for (int i = 0; i < 16; i++) { if (float(i) >= uHullN) break; vec2 a = uHull[i], b = uHull[int(mod(float(i) + 1.0, uHullN))]; vec2 e = normalize(b - a); m = min(m, e.x * (x.y - a.y) - e.y * (x.x - a.x)); } return m; }
// distance to the road corridors (wld-roads.js): highway, access road, interchange disc
float hRoads(vec2 x){ float m = 1e5; for (int i = 0; i < 24; i++) { if (float(i) >= uRoadN) break; vec4 s = uRoadSeg[i]; vec2 d = s.zw - s.xy; float t = clamp(dot(x - s.xy, d) / max(dot(d, d), 1.0), 0.0, 1.0); m = min(m, length(x - s.xy - d * t) - uRoadW[i]); } if (uRoadIx.z > 0.0) m = min(m, length(x - uRoadIx.xy) - uRoadIx.z); return m; }
vec3 hoodGlow = vec3(0.0); // night light from the neighbourhood (street lamps, windows), added by the terrain shader
// returns: rgb = ground colour, a = coverage (0 = leave the terrain colour)
vec4 hoodGround(vec2 p, vec2 pL, float urbMask, vec3 grass, vec3 dark, float px){
  hoodGlow = vec3(0.0);
  float hd0 = hHull(pL); if (hd0 > -24.0) { // inside the airport fence: airport grass; just outside: perimeter road and fence
    if (hd0 > 0.0) return vec4(0.0); float o = -hd0; vec3 c = o < 7.0 ? vec3(0.2, 0.2, 0.21) * (0.95 + 0.1 * h12(floor(pL / 3.0))) : o < 8.2 ? vec3(0.32, 0.33, 0.33) : mix(grass * 1.05, dark, 0.25);
    if (o > 8.2 && o < 9.0) c = vec3(0.12); hoodGlow = (o < 7.0 && fract(dot(pL, vec2(0.7071)) / 45.0) < 0.12) ? vec3(0.9, 0.7, 0.4) * 0.25 : vec3(0.0); return vec4(c, 1.0); }
  float rdd = hRoads(pL); if (rdd < 16.0) return vec4(mix(grass * 1.05, dark, 0.2 + 0.15 * h12(floor(pL / 9.0))), 1.0); // highway verges / embankments
  vec2 g = vec2(uHood.x * p.x - uHood.y * p.y, uHood.y * p.x + uHood.x * p.y); vec2 bi = floor(g / ${B.toFixed(1)}); vec2 f = g - bi * ${B.toFixed(1)};
  vec2 cg = (bi + 0.5) * ${B.toFixed(1)}; vec2 cl = vec2(uHood.x * cg.x + uHood.y * cg.y, -uHood.y * cg.x + uHood.x * cg.y);
  vec2 dc = hDens(cl); float dn = dc.x + (h12(bi * vec2(1.3, 0.7)) - 0.5) * 0.12, core = dc.y; if (dn < 0.14 || urbMask < 0.02) return vec4(0.0);
  float cls = dn < 0.3 ? 1.0 : dn < 0.55 ? 2.0 : dn < 0.74 ? 3.0 : dn < 0.9 ? 4.0 : 5.0; if (core > 30.0 && dn > 0.5) cls = 5.0;
  bool park = cls >= 2.0 && cls <= 4.0 && h12(bi * vec2(0.37, 0.53) + vec2(4.1, 1.7)) < 0.07;
  bool aL = hArt(bi.x), aR = hArt(bi.x + 1.0), aB = hArt(bi.y), aT = hArt(bi.y + 1.0);
  float dL = f.x - (aL ? ${RWA} : ${RW}), dR = ${B.toFixed(1)} - f.x - (aR ? ${RWA} : ${RW}), dB = f.y - (aB ? ${RWA} : ${RW}), dT = ${B.toFixed(1)} - f.y - (aT ? ${RWA} : ${RW});
  float de = min(min(dL, dR), min(dB, dT)); bool artNear = (dL == de && aL) || (dR == de && aR) || (dB == de && aB) || (dT == de && aT);
  vec3 asph = vec3(0.13, 0.135, 0.14) * (0.92 + 0.12 * h12(floor(g / 3.0)));
  vec3 lawnB = mix(grass * 1.08, uHoodS2.rgb, 0.6), lamp = uHood.w > 0.5 ? vec3(0.85, 0.9, 1.0) : vec3(1.0, 0.62, 0.3);
  bool apt = cls >= 4.0 || (cls >= 3.0 && uHoodS.w >= 15.0);
  // ---- far LODs: lot average (7-16 m per pixel) then block average (beyond 30 m per pixel), streets anti-aliased by coverage
  float k = smoothstep(3.0, 7.0, px), kB = smoothstep(16.0, 32.0, px); vec3 rm = (uRoofs[0] + uRoofs[1] + uRoofs[2] + uRoofs[3]) * 0.25, conc = vec3(0.55, 0.53, 0.5);
  vec3 blk = park ? mix(lawnB, dark * 1.1, 0.5) : apt ? mix(vec3(0.36, 0.355, 0.35), dark * 1.1, 0.2) : lawnB * 0.62 + rm * 0.2 + dark * 1.05 * 0.11 + conc * 0.07;
  blk *= 0.9 + 0.16 * h12(bi * 0.71); vec3 lotC3 = blk;
  if (!park && !apt && kB < 1.0) { // per-lot speckle: each lot's own roof colour and lawn tone
    bool tr = cls == 3.0 && h12(bi * vec2(2.1, 1.7)) < uHoodS.z; float sL = aL ? 10.8 : 7.6, sR = aR ? 10.8 : 7.6, lwF = cls == 1.0 ? 30.0 : cls == 2.0 ? 22.0 : tr ? 6.4 : 15.0, nF = max(1.0, floor((${B.toFixed(1)} - sL - sR) / lwF)), lw2 = (${B.toFixed(1)} - sL - sR) / nF;
    float rw2 = f.y < ${(B / 2).toFixed(1)} ? 0.0 : 1.0, li2 = clamp(floor((f.x - sL) / lw2), 0.0, nF - 1.0); vec2 k2 = vec2(bi.x * 7.0 + li2, bi.y * 5.0 + rw2 * 2.3);
    vec3 roofL = uRoofs[int(h12(k2 + 18.0 * vec2(3.7, 1.9)) * 5.99)]; float rf = cls == 1.0 ? 0.17 : cls == 2.0 ? 0.21 : 0.32; lotC3 = lawnB * (0.84 + 0.24 * h12(k2 + 20.0 * vec2(3.7, 1.9))) * (1.0 - rf - 0.17) + roofL * rf + dark * 1.05 * 0.11 + conc * 0.06; }
  float dcl = min(min(f.x, ${B.toFixed(1)} - f.x), min(f.y, ${B.toFixed(1)} - f.y)), sw = ${(RW + SW).toFixed(1)}; float st = clamp((sw - dcl) / px + 0.5, 0.0, 1.0) * clamp(2.0 * sw / px, 0.0, 1.0);
  vec3 far = mix(mix(lotC3, blk, kB), asph * 1.25, st);
  vec3 farGlow = lamp * clamp((10.0 - dcl) / px + 0.5, 0.0, 1.0) * clamp(16.0 / px, 0.0, 1.0) * (artNear ? 0.6 : 0.32) + vec3(1.0, 0.75, 0.45) * 0.03 * step(cls, 3.5) * (1.0 - float(park));
  if (k >= 1.0) { hoodGlow = farGlow; return vec4(far, 1.0); }
  vec3 c = lawnB; vec3 glow = vec3(0.0);
  if (de < 0.0) { c = asph; float ax = min(abs(f.x), abs(${B.toFixed(1)} - f.x)), ay = min(abs(f.y), abs(${B.toFixed(1)} - f.y));
    bool artX = (ax < ${RWA} && ((f.x < ${(B / 2).toFixed(1)} && aL) || (f.x > ${(B / 2).toFixed(1)} && aR))), artY = (ay < ${RWA} && ((f.y < ${(B / 2).toFixed(1)} && aB) || (f.y > ${(B / 2).toFixed(1)} && aT)));
    if ((artX && ax < 0.18) || (artY && ay < 0.18)) c = vec3(0.6, 0.5, 0.18); else if ((artX && abs(ax - 3.6) < 0.1 && fract(g.y / 9.0) < 0.5) || (artY && abs(ay - 3.6) < 0.1 && fract(g.x / 9.0) < 0.5)) c = vec3(0.62);
    if (de > -0.25) c = vec3(0.4); } // kerb
  else if (de < ${SW}) c = vec3(0.36, 0.355, 0.34) * (0.95 + 0.08 * h12(floor(g / 1.5)));
  else if (park) { float tr = smoothstep(0.55, 0.8, vnoise(g / 9.0)); c = mix(lawnB * 1.05, dark * 1.15, tr * 0.85); if (abs(f.x - f.y) < 1.4 || abs(f.x + f.y - ${B.toFixed(1)}) < 1.4) c = vec3(0.5, 0.48, 0.44); }
  else if (apt) { c = vec3(0.42, 0.41, 0.4) * (0.9 + 0.12 * h12(floor(g / 6.0)));
    if (cls < 5.0 && fract(f.x / 5.6) < 0.08 && f.y > ${(B * 0.72).toFixed(1)}) c = vec3(0.7);
    float tr = smoothstep(0.62, 0.8, vnoise(g / 6.0)); c = mix(c, dark * 1.2, tr * 0.7 * step(cls, 4.5)); }
  else { // low-rise lots (same layout as lotsOf in wld-hood.js)
    bool terrace = cls == 3.0 && h12(bi * vec2(2.1, 1.7)) < uHoodS.z;
    float sxL = aL ? 10.8 : 7.6, sxR = aR ? 10.8 : 7.6, span = ${B.toFixed(1)} - sxL - sxR, lotW = cls == 1.0 ? 30.0 : cls == 2.0 ? 22.0 : terrace ? 6.4 : 15.0;
    float n = max(1.0, floor(span / lotW)), lw = span / n;
    float row = f.y < ${(B / 2).toFixed(1)} ? 0.0 : 1.0; float fy = row < 0.5 ? f.y : ${B.toFixed(1)} - f.y; bool aF = row < 0.5 ? aB : aT; float front = aF ? 10.8 : 7.6, road = aF ? ${RWA} : ${RW};
    float li = clamp(floor((f.x - sxL) / lw), 0.0, n - 1.0), lotC = sxL + (li + 0.5) * lw; vec2 kk = vec2(bi.x * 7.0 + li, bi.y * 5.0 + row * 2.3);
    #define HH(k) h12(kk + float(k) * vec2(3.7, 1.9))
    float hw, hd, sb; if (terrace) { hw = lw - 0.15; hd = mix(9.0, 11.5, HH(1)); sb = mix(2.2, 3.6, HH(2)); }
    else { hw = cls == 1.0 ? min(mix(13.0, 19.0, HH(0)), lw - 4.2) : cls == 2.0 ? min(mix(11.0, 15.0, HH(0)), lw - 3.6) : min(mix(8.0, 11.0, HH(0)), lw - 3.0); hd = cls == 1.0 ? mix(12.0, 16.0, HH(1)) : cls == 2.0 ? mix(11.0, 14.0, HH(1)) : mix(10.0, 13.0, HH(1)); sb = mix(3.5, 7.0, HH(2)); }
    float fy0 = front + sb; float gs = HH(3) > 0.5 ? 1.0 : -1.0; float gw = 0.0, gx = 0.0; if (!terrace && HH(13) < uHoodS.y && lw - hw >= 4.6) { gw = lw - hw - 1.4 >= 6.4 ? 6.0 : 3.4; gx = lotC + gs * (hw * 0.5 + gw * 0.5); }
    vec2 q = vec2(f.x, fy);
    c = lawnB * (0.84 + 0.24 * HH(20)); if (HH(21) < 0.5) c *= 1.0 + 0.04 * sign(sin(g.x * 1.1)); c = mix(c, c * vec3(1.18, 1.1, 0.8), smoothstep(0.62, 0.85, vnoise(g / 7.0)) * 0.6);
    float lx = abs(fract((f.x - sxL) / lw + 0.5) - 0.5) * lw; if (!terrace && (lx < 0.3 || abs(fy - ${(B / 2).toFixed(1)}) < 0.35) && fy > front) c = dark * 1.1;
    if (terrace && fy > fy0 + hd + 0.5 && lx < 0.18) c = vec3(0.42, 0.33, 0.28);
    if (gw > 0.0 && hRect(q, vec2(gx - gw * 0.45, road), vec2(gx + gw * 0.45, fy0)) < 0.0) c = vec3(0.56, 0.54, 0.5);
    else if (gw == 0.0 && !terrace && hRect(q, vec2(lotC + gs * (hw * 0.5 + 0.3), road), vec2(lotC + gs * (hw * 0.5 + 3.1), fy0 + 4.0)) < 0.0) c = vec3(0.54, 0.52, 0.48);
    if (hRect(q, vec2(lotC - 0.6, road + ${SW}), vec2(lotC + 0.6, fy0)) < 0.0) c = vec3(0.58, 0.56, 0.52);
    if (!terrace && HH(4) < uHoodS.x && fy0 + hd + 6.6 < ${(B / 2 - 1).toFixed(1)}) { float pw = min(7.0, lw - 2.5), px2 = lotC + (HH(5) - 0.5) * max(0.0, hw - pw), pz0 = fy0 + hd + 2.2; float pr = hRect(q, vec2(px2 - pw * 0.5, pz0), vec2(px2 + pw * 0.5, pz0 + 4.0)); if (pr < 0.7) c = pr < 0.0 ? vec3(0.1, 0.5, 0.58) + 0.05 * sin(g.x * 2.0) : vec3(0.74, 0.72, 0.66); }
    // canopies: front yard, back yard (two) and street trees on tree-lined blocks
    float tc = 0.0;
    if (!terrace && HH(6) < uHoodS2.w) tc = max(tc, 1.0 - smoothstep(2.0, 3.0, length(q - vec2(lotC - gs * (hw * 0.5 + 1.8), front + sb * 0.45))));
    if (HH(7) < uHoodS2.w * 0.9 && fy0 + hd + 5.0 < ${(B / 2 - 1.5).toFixed(1)}) tc = max(tc, 1.0 - smoothstep(2.4, 3.4, length(q - vec2(lotC + (HH(8) - 0.5) * lw * 0.6, min(${(B / 2 - 2.2).toFixed(1)}, fy0 + hd + 4.0 + HH(14) * 3.5)))));
    if (!terrace && HH(19) < uHoodS2.w * 0.7 && fy0 + hd + 4.0 < ${(B / 2 - 3.0).toFixed(1)}) tc = max(tc, 1.0 - smoothstep(2.6, 3.6, length(q - vec2(lotC - (HH(8) - 0.5) * lw * 0.6, ${(B / 2 - 3.2).toFixed(1)}))));
    if (h12(bi * vec2(0.91, 1.37)) < uHoodS2.w * 0.75) { float kx = clamp(floor((f.x - sxL - 6.0) / 12.0 + 0.5), 0.0, floor((span - 9.0) / 12.0)); tc = max(tc, 1.0 - smoothstep(2.2, 3.0, length(q - vec2(sxL + 6.0 + kx * 12.0, road + ${SW} + 0.9)))); }
    c = mix(c, dark * (1.05 + 0.2 * vnoise(g / 2.0)), tc * 0.9);
    // roofs (far LOD; the 3D house covers this near the camera)
    float hr = hRect(q, vec2(lotC - hw * 0.5, fy0), vec2(lotC + hw * 0.5, fy0 + hd)), gr = gw > 0.0 ? hRect(q, vec2(gx - gw * 0.5, fy0), vec2(gx + gw * 0.5, fy0 + 6.5)) : 9.0;
    if (hr < 0.0 || gr < 0.0) { vec3 rc = uRoofs[int(HH(18) * 5.99)]; bool ridgeU = terrace || HH(11) < 0.6; float sh = ridgeU ? step(fy0 + hd * 0.5, fy) : step(lotC, f.x); c = rc * (0.82 + 0.22 * sh); if (gr < 0.0 && hr >= 0.0) c *= 0.9; }
    // night: street lamps at every other lot along the street, lit front windows
    float lj = li - mod(li, 2.0); float lampU = sxL + (lj + 0.5) * lw; float dl = length(q - vec2(lampU, road + 0.6)); glow += lamp * exp(-dl * dl / 45.0) * step(fy, front + 3.0) * 1.3;
    if (HH(22) < 0.5 && hr > -0.0 && hr < 0.9 && fy < fy0 + 0.4 && abs(abs(f.x - lotC) - hw * 0.26) < 0.7) glow += vec3(1.0, 0.72, 0.42) * 0.9;
  }
  if (!park && !apt && de < ${SW}) glow += lamp * 0.15 * (1.0 - smoothstep(0.0, 6.0, de + 4.0));
  if (apt && de < ${SW} + 2.0) glow += lamp * 0.22;
  hoodGlow = mix(glow, farGlow, k); return vec4(mix(c, far, k), 1.0);
}`;
// terrain shader uniforms for HOOD_GLSL (call after setHood)
const _lin = hex => new THREE.Color(hex);
export function hoodUniforms(u) {
  const S = HOOD.S;
  u.uHood.value.set(HOOD.c, HOOD.s, HOOD.on ? 1 : 0, /uk|eu|asia/.test(HOOD.style) ? 1 : 0); u.uHullN.value = HOOD.hull.length; for (let i = 0; i < 16; i++) { const h = HOOD.hull[i]; u.uHull.value[i].set(h ? h[0] : 0, h ? h[1] : 0); }
  for (let i = 0; i < NCITY; i++) { const c = HOOD.cities[i]; u.uCity.value[i].set(c ? c.x : 0, c ? c.z : 0, c ? c.r : 0, c ? c.d : 0); u.uCityHa.value[i] = c ? c.h : 0; }
  for (let i = 0; i < 6; i++) u.uRoofs.value[i].copy(_lin(S.roofs[i % S.roofs.length]));
  u.uHoodS.value.set(S.pool, S.garage, S.terrace, S.apt); u.uHoodS2.value.set(S.lawn[0], S.lawn[1], S.lawn[2], S.tree);
}
export function hoodUniformDefs() { return { uHood: { value: new THREE.Vector4() }, uCity: { value: Array.from({ length: NCITY }, () => new THREE.Vector4()) }, uCityHa: { value: new Array(NCITY).fill(0) }, uRoofs: { value: Array.from({ length: 6 }, () => new THREE.Color()) }, uHoodS: { value: new THREE.Vector4() }, uHoodS2: { value: new THREE.Vector4() }, uHull: { value: Array.from({ length: 16 }, () => new THREE.Vector2()) }, uHullN: { value: 0 }, uRoadSeg: { value: Array.from({ length: 24 }, () => new THREE.Vector4()) }, uRoadW: { value: new Array(24).fill(0) }, uRoadN: { value: 0 }, uRoadIx: { value: new THREE.Vector3() } }; }

// ---------------------------------------------------------------- 3D kits and materials
// building bodies: one material for every style (aStyle per instance): 0 house, 1 apartment with balconies, 2 glass tower,
// 3 office / commercial, 4 warehouse, 6 garage; windows, doors, balconies and lit windows at night are procedural
function bodyMat() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0 }); m.userData.key = 'hoodBody';
  m.onBeforeCompile = sh => {
    sh.uniforms.uNight = ATM.uNight;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aStyle; varying vec3 vL; varying vec3 vLN; varying float vSt; varying float vId;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)); vL = position * sc; vLN = normal; vSt = aStyle; vId = float(gl_InstanceID);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vL; varying vec3 vLN; varying float vSt; varying float vId; uniform float uNight; float wMask = 0.0; vec3 wEmit = vec3(0.0); float wGloss = 0.0;
float hh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      { vec3 n = vLN; float side = 1.0 - step(0.6, abs(n.y)); float front = step(0.6, n.z);
        float u = abs(n.x) > 0.5 ? vL.z : vL.x, v = vL.y; int st = int(vSt + 0.5);
        float fh = st == 0 ? 2.9 : st == 2 ? 3.6 : st == 4 ? 99.0 : 3.1, ww = st == 0 ? 3.4 : st == 2 ? 1.6 : st == 3 ? 2.2 : 3.0;
        vec2 g = vec2(u / ww, (v - (st == 0 ? 0.35 : 0.0)) / fh); vec2 f = fract(g);
        float win = 0.0;
        if (st == 0) win = step(0.3, f.x) * step(f.x, 0.7) * step(0.35, f.y) * step(f.y, 0.78) * step(0.4, v);
        else if (st == 1) win = step(0.14, f.x) * step(f.x, 0.86) * step(0.34, f.y) * step(f.y, 0.84) * step(3.0, v);
        else if (st == 2) win = step(0.04, f.x) * step(f.x, 0.96) * step(0.06, f.y) * step(f.y, 0.97) * step(4.0, v);
        else if (st == 3) win = step(0.06, f.x) * step(f.x, 0.94) * step(0.42, f.y) * step(f.y, 0.86) * step(3.5, v);
        else if (st == 5) win = step(0.2, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.8) * step(3.2, v);
        win *= side;
        // doors: house front door, garage door, warehouse dock doors, shop fronts
        float door = 0.0; if (st == 0) door = front * step(abs(vL.x), 0.55) * step(v, 2.2); if (st == 6) door = front * step(abs(vL.x), 1.3) * step(v, 2.3);
        if (st == 4) door = side * step(fract(u / 9.0), 0.4) * step(v, 4.2); if (st == 3) win = max(win, side * step(v, 3.2) * step(0.06, fract(u / 4.0)) * step(0.6, v));
        // balconies: a slab and railing band at each storey on the long faces
        float balc = 0.0; if (st == 1) balc = side * step(abs(n.z), 0.5) * 0.0 + side * step(f.y, 0.2) * step(3.0, v);
        wMask = win;
        diffuseColor.rgb = mix(diffuseColor.rgb, st == 2 ? vec3(0.1, 0.16, 0.2) : st == 0 ? vec3(0.1, 0.12, 0.14) : vec3(0.2, 0.25, 0.3), win * (st == 2 ? 0.92 : st == 0 ? 0.82 : 0.75));
        diffuseColor.rgb = mix(diffuseColor.rgb, st == 6 || st == 4 ? vec3(0.72, 0.72, 0.7) : vec3(0.32, 0.22, 0.16), door);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.86, 0.84), balc * 0.7);
        if (st == 4) diffuseColor.rgb *= 0.9 + 0.1 * step(0.5, fract(u / 1.2)); // ribbed cladding
        diffuseColor.rgb *= 0.9 + 0.12 * smoothstep(0.0, 6.0, v) - 0.12 * (1.0 - side) * 0.0; // a little darker near the ground
        float lit = step(hh(vec3(floor(g), vId)), st == 2 ? 0.5 : 0.36);
        wEmit = win * lit * uNight * mix(vec3(1.0, 0.76, 0.48), vec3(0.86, 0.9, 1.0), step(0.7, hh(vec3(floor(g.x), vId, 3.0)))) * (st == 2 ? 2.0 : 1.5);
        wGloss = win * (st == 2 ? 1.0 : 0.6); }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, wGloss);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.6, wGloss * step(1.5, vSt) * step(vSt, 2.5));')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += wEmit;');
  };
  return atmos(m);
}
// roofs: barrel tile / shingle / slate / glazed tile / flat gravel by region; instance colour
function roofMat(kind) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 }); m.userData.key = 'hoodRoof' + kind;
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vR;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)); vR = position * sc;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vR;').replace('#include <color_fragment>', `#include <color_fragment>
      { float along = vR.x, up = length(vR.yz); float t;
        ${kind === 0 ? 'float w = abs(sin(along * 5.2)); t = 0.78 + 0.22 * w - 0.12 * step(0.92, fract(up * 2.6));'
        : kind === 1 ? 't = 0.86 + 0.14 * step(0.5, fract(up * 3.2)) * step(0.5, fract(along * 1.1 + step(0.5, fract(up * 1.6)) * 0.5)) - 0.08 * step(0.9, fract(up * 3.2));'
        : kind === 2 ? 't = 0.88 + 0.1 * step(0.5, fract(along * 2.4 + step(0.5, fract(up * 2.0)) * 0.5)) - 0.1 * step(0.88, fract(up * 4.0));'
        : kind === 3 ? 't = 0.85 + 0.15 * step(0.85, fract(along * 2.0));' : 't = 0.9 + 0.1 * fract(sin(dot(floor(vR.xz * 2.0), vec2(12.9, 78.2))) * 437.5);'}
        diffuseColor.rgb *= t; }`);
  };
  return atmos(m);
}
const plain = (c, o = {}) => { const m = atmos(new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.85, metalness: o.m ?? 0, vertexColors: !!o.vc, ...(o.e ? { emissive: o.e } : {}) })); m.userData.key = 'hoodP' + (o.k || ''); return m; };
function gableGeo(hip) { // unit roof: base 1 x 1 at y 0, ridge along x at y 1 (hip: ridge shortened)
  const r = hip ? 0.22 : 0.5, P = [-0.5, 0, -0.5, 0.5, 0, -0.5, r, 1, 0, -r, 1, 0, -0.5, 0, 0.5, 0.5, 0, 0.5];
  const idx = [0, 3, 2, 0, 2, 1, 4, 5, 2, 4, 2, 3, 0, 4, 3, 1, 2, 5, 0, 1, 5, 0, 5, 4];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(idx); const ng = g.toNonIndexed(); ng.computeVertexNormals(); return ng; }
function colored(geo, hex) { const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; }
function merge(gs) { const list = gs.map(g => g.index ? g.toNonIndexed() : g); let n = 0; for (const g of list) n += g.attributes.position.count; const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3); let o = 0;
  for (const g of list) { if (!g.attributes.normal) g.computeVertexNormals(); P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); if (g.attributes.color) C.set(g.attributes.color.array, o * 3); else C.fill(1, o * 3, (o + g.attributes.position.count) * 3); o += g.attributes.position.count; }
  const r = new THREE.BufferGeometry(); r.setAttribute('position', new THREE.BufferAttribute(P, 3)); r.setAttribute('normal', new THREE.BufferAttribute(N, 3)); r.setAttribute('color', new THREE.BufferAttribute(C, 3)); return r; }
let KITS = null;
function kits() {
  if (KITS) return KITS;
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const tree = merge([colored(new THREE.CylinderGeometry(0.06, 0.09, 0.45, 4, 1, true).translate(0, 0.22, 0), '#5a4330'), colored(new THREE.IcosahedronGeometry(0.45, 0).scale(1, 0.82, 1).translate(0, 0.68, 0), '#ffffff')]);
  const fronds = []; for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; fronds.push(colored(new THREE.PlaneGeometry(0.16, 0.42).rotateX(-1.1).translate(0, 0.02, 0.2).rotateY(a).translate(0, 0.97, 0), '#ffffff')); }
  const palm = merge([colored(new THREE.CylinderGeometry(0.025, 0.045, 1, 5).translate(0, 0.5, 0), '#8a7a62'), ...fronds]);
  const conifer = merge([colored(new THREE.CylinderGeometry(0.05, 0.07, 0.25, 5).translate(0, 0.12, 0), '#4d3a2a'), colored(new THREE.ConeGeometry(0.32, 0.85, 7).translate(0, 0.62, 0), '#ffffff')]);
  const car = merge([colored(new THREE.BoxGeometry(1.8, 0.75, 4.4).translate(0, 0.45, 0), '#ffffff'), colored(new THREE.BoxGeometry(1.6, 0.5, 2.3).translate(0, 1.07, -0.15), '#2a3038')]);
  const lamp = merge([colored(new THREE.BoxGeometry(0.14, 7.5, 0.14).translate(0, 3.75, 0), '#5d6166'), colored(new THREE.BoxGeometry(0.3, 0.14, 2.2).translate(0, 7.45, 1.0), '#8a8f94')]);
  const gear = merge([colored(new THREE.BoxGeometry(0.28, 0.6, 0.22).translate(-0.2, 0.3, 0.1), '#9aa0a5'), colored(new THREE.BoxGeometry(0.16, 0.45, 0.16).translate(0.22, 0.22, -0.15), '#8a9095'), colored(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8).translate(0.25, 0.25, 0.25), '#b0b4b8'), colored(new THREE.BoxGeometry(1.02, 0.12, 1.02).translate(0, 0.06, 0).scale(1, 0.4, 1), '#77797c')]);
  KITS = { box, gable: gableGeo(false), hip: gableGeo(true), tree, palm, conifer, car, lamp, gear, pool: new THREE.BoxGeometry(1, 0.2, 1).translate(0, 0.1, 0) };
  return KITS;
}
// an instanced kit with capacity, per-instance colour (and style)
class Kit {
  constructor(group, geo, mat, cap, styled) { this.cap = cap; this.mesh = new THREE.InstancedMesh(geo, mat, cap); this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); if (styled) { this.st = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); geo.setAttribute('aStyle', this.st); } group.add(this.mesh); }
  fill(lists) { let n = 0; const M = this.mesh.instanceMatrix.array, C = this.mesh.instanceColor.array, S = this.st && this.st.array;
    for (const L of lists) { const k = Math.min(L.n, this.cap - n); if (k <= 0) break; M.set(L.m.subarray(0, k * 16), n * 16); C.set(L.c.subarray(0, k * 3), n * 3); if (S && L.s) S.set(L.s.subarray(0, k), n); n += k; }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; if (this.st) this.st.needsUpdate = true; return n; }
}
// growable instance list (matrix, colour, style)
class List { constructor() { this.n = 0; this.m = new Float32Array(16 * 64); this.c = new Float32Array(3 * 64); this.s = new Float32Array(64); }
  push(mat, col, st = 0) { if (this.n * 16 >= this.m.length) { const g = (a, k) => { const b = new a.constructor(a.length * 2); b.set(a); return b; }; this.m = g(this.m); this.c = g(this.c); this.s = g(this.s); }
    mat.toArray(this.m, this.n * 16); this.c[this.n * 3] = col.r; this.c[this.n * 3 + 1] = col.g; this.c[this.n * 3 + 2] = col.b; this.s[this.n] = st; this.n++; } }
const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _P = new THREE.Vector3(), _S = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0), _C = new THREE.Color();
const KIT_NAMES = ['body', 'gable', 'hip', 'flat', 'gear', 'tree', 'palm', 'conifer', 'pool', 'car', 'lamp'];
function makeKits(group, cap, roofKind) {
  const K = kits(), bm = bodyMat(), rm = roofMat(roofKind), flatM = roofMat(4);
  const leaf = plain(0xffffff, { vc: true, k: 'leaf', r: 0.95 }), carM = plain(0xffffff, { vc: true, k: 'car', r: 0.4, m: 0.3 }), poolM = plain(0x2aa6b8, { r: 0.08, m: 0.1, k: 'pool', e: 0x041418 }), lampM = plain(0xffffff, { vc: true, k: 'lamp' }), gearM = plain(0xffffff, { vc: true, k: 'gear' });
  const g = (geo, mat, c, st) => new Kit(group, geo.clone(), mat, c, st);
  return { body: g(K.box, bm, cap, true), gable: g(K.gable, rm, cap), hip: g(K.hip, rm, cap), flat: g(K.box, flatM, cap), gear: g(K.gear, gearM, Math.ceil(cap / 3)), tree: g(K.tree, leaf, cap), palm: g(K.palm, leaf, Math.ceil(cap / 2)), conifer: g(K.conifer, leaf, Math.ceil(cap / 2)), pool: g(K.pool, poolM, Math.ceil(cap / 3)), car: g(K.car, carM, cap), lamp: g(K.lamp, lampM, Math.ceil(cap / 2)) };
}
function put(L, x, y, z, yaw, sx, sy, sz, col, st) { _Q.setFromAxisAngle(_Y, yaw); _P.set(x, y, z); _S.set(sx, sy, sz); _M.compose(_P, _Q, _S); L.push(_M, typeof col === 'string' ? _C.set(col) : col, st); }
const CAR_COLS = ['#d8d8d8', '#1d1f22', '#8a8f94', '#6d1f1f', '#20324f', '#eeeeea', '#4a4f55', '#7a6a50', '#2f4a3a'];
// ---------------------------------------------------------------- generation of one block's instances
// ctx: { heightAt(x, z) -> { h, water }, blocked(x, z) -> bool (airport keep-out) }
function lists() { const o = {}; for (const k of KIT_NAMES) o[k] = new List(); return o; }
function genLowRise(bi, bj, info, ctx, out) {
  const S = HOOD.S, { c, s } = HOOD, ux = c, uz = -s, vx = s, vz = c; // grid axes in the local frame
  if (!info.park && h12(bi * 0.91, bj * 1.37) < S.tree * 0.75) { // tree-lined street: a tree every 12 m in the verge
    const sxL = info.artL ? 10.8 : 7.6, sxR = info.artR ? 10.8 : 7.6, span = B - sxL - sxR;
    for (let row = 0; row < 2; row++) { const road = (row ? info.artT : info.artB) ? RWA : RW, fy = road + SW + 0.9, v = row ? B - fy : fy;
      for (let kx = 0; kx <= Math.floor((span - 9) / 12); kx++) { const u = sxL + 6 + kx * 12, x = c * (bi * B + u) + s * (bj * B + v), z = -s * (bi * B + u) + c * (bj * B + v); if (ctx.blocked(x, z)) continue; const g = ctx.heightAt(x, z); if (g.water) continue; const r = h12(x * 0.13, z * 0.17), sc = 0.75 + r * 0.4;
        if (S.palm > 0.5) put(out.palm, x, g.h - 0.2, z, r * 6.28, 9 * sc, 11 * sc, 9 * sc, _C.setRGB(0.6, 0.72, 0.4)); else put(out.tree, x, g.h - 0.2, z, r * 6.28, 8.5 * sc, 9.5 * sc, 8.5 * sc, _C.setRGB(0.24 + r * 0.1, 0.34 + r * 0.1, 0.15)); } } }
  for (const L of lotsOf(bi, bj, info)) {
    const sgn = L.row ? -1 : 1, vOf = fy => L.row ? B - fy : fy, at = (u, fy) => [c * (bi * B + u) + s * (bj * B + vOf(fy)), -s * (bi * B + u) + c * (bj * B + vOf(fy))];
    const face = Math.atan2(-sgn * vx, -sgn * vz); // the front of the house looks at the street it faces
    const [hx, hz] = at(L.lotC, L.fy0 + L.hd / 2); if (ctx.blocked(hx, hz)) continue; const gnd = ctx.heightAt(hx, hz); if (gnd.water) continue; const y = gnd.h - 0.3;
    const H = L.st * 2.9 + 0.45, wall = _C.set(L.wall).clone(), roof = new THREE.Color(L.roof).multiplyScalar(0.92 + 0.16 * h12(bi * 9 + L.li, bj * 3 + L.row));
    put(out.body, hx, y, hz, face, L.hw, H, L.hd, wall, 0);
    if (L.flat) { put(out.flat, hx, y + H, hz, face, L.hw + 0.3, 0.35, L.hd + 0.3, roof.clone().multiplyScalar(0.9)); if (h12(bi + L.li, bj) < 0.5) put(out.gear, hx, y + H + 0.3, hz, face, 3, 1.6, 3, '#ffffff'); }
    else { const span = L.ridgeU ? L.hd : L.hw, rh = span * (L.hip ? 0.26 : HOOD.style === 'uk' ? 0.42 : 0.34), yaw = L.ridgeU ? face : face + Math.PI / 2;
      put(L.hip ? out.hip : out.gable, hx, y + H, hz, yaw, (L.ridgeU ? L.hw : L.hd) + 0.7, rh, span + 0.8, roof); }
    if (L.gw) { const [gx, gz] = at(L.gx, L.fy0 + 3.25); put(out.body, gx, y, gz, face, L.gw, 3.0, 6.5, wall.clone().multiplyScalar(0.96), 6); put(out.flat, gx, y + 3.0, gz, face, L.gw + 0.3, 0.3, 6.8, roof.clone().multiplyScalar(0.85));
      if (L.car) { const [cx, cz] = at(L.gx, L.road + 3.4); put(out.car, cx, ctx.heightAt(cx, cz).h - 0.25, cz, face, 1, 1, 1, CAR_COLS[(h12(bi * 3 + L.li, bj * 7 + L.row) * CAR_COLS.length) | 0]); } }
    if (L.pool) { const [px, pz] = at(L.px, L.pz0 + 2); put(out.pool, px, y + 0.2, pz, face, L.pw, 1, 4, '#ffffff'); }
    const tree = (u, fy, k) => { const [tx, tz] = at(u, fy), th = ctx.heightAt(tx, tz).h - 0.2, r = h12(tx * 0.13, tz * 0.17), sc = 0.8 + r * 0.6;
      if (L.palm && S.palm) put(out.palm, tx, th, tz, r * 6.28, 9 * sc, 10 * sc, 9 * sc, _C.setRGB(0.62 + r * 0.2, 0.72, 0.42));
      else if (HOOD.style !== 'warm' && HOOD.style !== 'gulf' && r < 0.18) put(out.conifer, tx, th, tz, r * 6.28, 9 * sc, 13 * sc, 9 * sc, _C.setRGB(0.18, 0.3 + r * 0.2, 0.17));
      else put(out.tree, tx, th, tz, r * 6.28, 10 * sc, 10 * sc, 10 * sc, _C.setRGB(0.26 + r * 0.12, 0.36 + r * 0.12, 0.16)); };
    if (L.t1) tree(L.t1x, L.t1y, 1); if (L.t2) tree(L.t2x, L.t2y, 2); if (L.t3) tree(L.t3x, L.t3y, 3);
    if (L.terrace && L.li % 2 === 0) { const [cx, cz] = at(L.lotC + L.lw / 2, L.fy0 + L.hd * 0.5); put(out.body, cx, y + H + L.hd * 0.2, cz, face, 0.7, 1.6, 0.9, '#8c5a45', 7); } // chimney stack on the party wall
    if (h12(bi * 5 + L.li, bj * 2 + L.row) < 0.22) { const [cx, cz] = at(L.lotC + (h12(L.li, bj) - 0.5) * L.lw * 0.6, L.road - 1.25); put(out.car, cx, ctx.heightAt(cx, cz).h - 0.25, cz, face + Math.PI / 2, 1, 1, 1, CAR_COLS[(h12(bi + L.li * 3, bj * 5) * CAR_COLS.length) | 0]); }
    if (L.li % 2 === 0) { const [lx, lz] = at(L.lotC, L.road + 0.6); put(out.lamp, lx, ctx.heightAt(lx, lz).h - 0.2, lz, face + Math.PI, 1, 1, 1, '#ffffff'); }
  }
}
export function genTall(bi, bj, info, ctx, out) {
  const { c, s } = HOOD;
  for (const T of tallOf(bi, bj, info)) {
    const u = bi * B + T.u, v = bj * B + T.v, x = c * u + s * v, z = -s * u + c * v; if (ctx.blocked(x, z)) continue; const g = ctx.heightAt(x, z); if (g.water) continue;
    const r = h12(bi * 1.7 + T.u, bj * 2.3 + T.v), y = g.h - 0.5, yaw = Math.atan2(s, c); // local x along the grid u axis
    const wall = T.kind === 2 ? _C.setRGB(0.5 + r * 0.2, 0.58 + r * 0.14, 0.66 + r * 0.1).clone() : _C.set(HOOD.S.walls[(r * HOOD.S.walls.length) | 0]).clone();
    const st = T.kind === 1 ? 1 : T.kind === 2 ? 2 : 3;
    if (T.tiers > 1) { const h1 = T.h * 0.55, h2 = T.h * 0.85; put(out.body, x, y, z, yaw, T.w, h1, T.d, wall, st); put(out.body, x, y + h1, z, yaw, T.w * 0.8, h2 - h1, T.d * 0.8, wall, st); put(out.body, x, y + h2, z, yaw, T.w * 0.6, T.h - h2, T.d * 0.6, wall, st); put(out.flat, x, y + T.h, z, yaw, T.w * 0.62, 0.8, T.d * 0.62, _C.setRGB(0.45, 0.45, 0.46)); put(out.gear, x, y + T.h + 0.6, z, yaw, T.w * 0.4, 4, T.d * 0.4, '#ffffff'); }
    else if (T.h <= 18 && T.kind === 1 && HOOD.style !== 'gulf' && r < 0.75 && out.hip) { put(out.body, x, y, z, yaw, T.w, T.h, T.d, wall, st); put(out.hip, x, y + T.h, z, yaw, T.w + 1, Math.min(T.w, T.d) * 0.28, T.d + 1, new THREE.Color(HOOD.S.roofs[(r * 7 * HOOD.S.roofs.length | 0) % HOOD.S.roofs.length])); }
    else { put(out.body, x, y, z, yaw, T.w, T.h, T.d, wall, st); put(out.flat, x, y + T.h, z, yaw, T.w + 0.4, 0.7, T.d + 0.4, _C.setRGB(0.42, 0.42, 0.43)); if (T.w > 18 && T.h > 15 && r < 0.5) put(out.gear, x, y + T.h + 0.5, z, yaw, Math.min(T.w, T.d) * 0.6, 3, Math.min(T.w, T.d) * 0.6, '#ffffff'); }
  }
}

// ---------------------------------------------------------------- near tiles: low-rise neighbourhoods around the camera
export class Hood {
  constructor(scene, quality) { this.group = new THREE.Group(); this.group.name = 'hood'; scene.add(this.group); this.R = { ultra: 1900, high: 1350, medium: 900 }[quality] || 0; this.cap = { ultra: 16000, high: 10000, medium: 5000 }[quality] || 0; this.tiles = new Map(); this.kits = null; this.ctx = null; this.dirty = false; this.count = 0; }
  setup(ctx) { this.clear(); this.ctx = ctx; if (!this.R || !HOOD.on) return; if (!this.kits) this.kits = makeKits(this.group, this.cap, HOOD.S.roofKind); else { this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); this.group.clear(); this.kits = makeKits(this.group, this.cap, HOOD.S.roofKind); } } // roof kind changes per world
  clear() { this.tiles.clear(); if (this.kits) for (const k of Object.values(this.kits)) k.mesh.count = 0; this.count = 0; }
  // stream tiles of 6 x 6 blocks around the camera: build at most `budget` tiles per call, drop far ones, then refill the kits
  update(cam, budget = 1) {
    if (!this.kits || !this.ctx) return; const T = 6 * B, [gu, gv] = toGrid(cam.x, cam.z), ti0 = Math.floor(gu / T), tj0 = Math.floor(gv / T), rr = Math.ceil(this.R / T) + 1, want = new Set();
    for (let tj = tj0 - rr; tj <= tj0 + rr; tj++) for (let ti = ti0 - rr; ti <= ti0 + rr; ti++) { const du = Math.max(0, Math.abs((ti + 0.5) * T - gu) - T / 2), dv = Math.max(0, Math.abs((tj + 0.5) * T - gv) - T / 2); if (Math.hypot(du, dv) < this.R) want.add(ti + ',' + tj); }
    for (const k of this.tiles.keys()) if (!want.has(k)) { this.tiles.delete(k); this.dirty = true; }
    const miss = [...want].filter(k => !this.tiles.has(k)).map(k => { const [ti, tj] = k.split(',').map(Number); return [Math.hypot((ti + 0.5) * T - gu, (tj + 0.5) * T - gv), k, ti, tj]; }).sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(budget, miss.length); i++) { const [, k, ti, tj] = miss[i]; const out = lists(); for (let bj = tj * 6; bj < tj * 6 + 6; bj++) for (let bi = ti * 6; bi < ti * 6 + 6; bi++) { const info = blockInfo(bi, bj); if (info.cls >= 1 && info.cls <= 3) genLowRise(bi, bj, info, this.ctx, out); } this.tiles.set(k, out); this.dirty = true; }
    if (this.dirty) { this.dirty = false; const all = [...this.tiles.values()]; let n = 0; for (const name of KIT_NAMES) { const c = this.kits[name].fill(all.map(t => t[name])); if (name === 'body') n = c; } this.count = n; }
    return miss.length;
  }
  stats() { let calls = 0, tris = 0; for (const k of Object.values(this.kits || {})) { if (!k.mesh.count) continue; calls++; const g = k.mesh.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * k.mesh.count; } return { tiles: this.tiles.size, houses: this.count, calls, tris: Math.round(tris) }; }
}
export { makeKits, lists, KIT_NAMES };
// far-ring kits for City (terrain.js): fresh geometry per build (City disposes it), shared cached materials
let TM = null;
const TROOF = {};
export function tallKits() { const K = kits(); if (!TM) TM = { body: bodyMat(), flat: roofMat(4), gear: plain(0xffffff, { vc: true, k: 'gear' }) }; const rk = HOOD.S.roofKind; TROOF[rk] = TROOF[rk] || roofMat(rk);
  return [['body', K.box.clone(), TM.body], ['flat', K.box.clone(), TM.flat], ['gear', K.gear.clone(), TM.gear], ['hip', K.hip.clone(), TROOF[rk]]]; }
// road corridors for the terrain shader (from Roads.shaderCorridors)
export function roadUniforms(u, rc) { const segs = rc ? rc.segs : []; u.uRoadN.value = segs.length; for (let i = 0; i < 24; i++) { const s = segs[i]; u.uRoadSeg.value[i].set(s ? s[0] : 0, s ? s[1] : 0, s ? s[2] : 0, s ? s[3] : 0); u.uRoadW.value[i] = s ? s[4] : 0; } u.uRoadIx.value.set(rc?.ix ? rc.ix.x : 0, rc?.ix ? rc.ix.z : 0, rc?.ix ? rc.ix.r : 0); }
