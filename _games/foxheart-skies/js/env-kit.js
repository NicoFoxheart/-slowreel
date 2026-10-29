// Environment-art toolkit (environment artist): procedural PBR textures (albedo + packed normal/roughness),
// the interior "hall" material model, merged-geometry buckets and shape helpers.
//
// Hall lighting model (all interior materials): diffuse = baked AO (vertex colour) x analytic hall light
// (warm/cool fixture pools + window and skylight daylight that follow the time of day) instead of sky IBL;
// the sun is masked by the real glazing (curtain-wall mullions and roof skylights) so sun patches move with
// the time of day; specular = a cube-camera capture of the hall baked once into a PMREM and box-projected,
// so polished floors and glass reflect the room in the right place. Nothing is rendered per frame.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { atmos, ATM } from './sky.js';

export const texSize = (q, big) => q === 'low' ? 256 : (q === 'ultra' || (big && q === 'high')) ? 1024 : 512;

// ---------------------------------------------------------------- noise (tileable, sampled from a cached tile)
function hashi(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vnoiseP(x, y, per, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const m = v => ((v % per) + per) % per, x0 = m(xi), x1 = m(xi + 1), y0 = m(yi), y1 = m(yi + 1);
  const a = hashi(x0, y0, s), b = hashi(x1, y0, s), c = hashi(x0, y1, s), d = hashi(x1, y1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const TILE = 256; let _tiles = null;
function tiles() {
  if (_tiles) return _tiles;
  const mk = (base, oct, s) => { const a = new Float32Array(TILE * TILE); for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) { let f = 0, amp = 0.5, fr = base, nm = 0; for (let o = 0; o < oct; o++) { f += amp * vnoiseP(x / TILE * fr, y / TILE * fr, fr, s + o * 31); nm += amp; amp *= 0.5; fr *= 2; } a[y * TILE + x] = f / nm; } return a; };
  _tiles = [mk(4, 5, 1), mk(16, 3, 7), mk(64, 2, 13)]; return _tiles;
}
// sample tile k at (u, v) in tile units (wraps), bilinear
export function nz(k, u, v) {
  const T = tiles()[k]; const x = u * TILE - 0.5, y = v * TILE - 0.5; const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const X0 = ((xi % TILE) + TILE) % TILE, Y0 = ((yi % TILE) + TILE) % TILE, X1 = (X0 + 1) % TILE, Y1 = (Y0 + 1) % TILE;
  const a = T[Y0 * TILE + X0], b = T[Y0 * TILE + X1], c = T[Y1 * TILE + X0], d = T[Y1 * TILE + X1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export const hash01 = (x, y, s = 0) => hashi(x | 0, y | 0, s | 0);

// ---------------------------------------------------------------- PBR texture sets
// fn(u, v, s): set s.r s.g s.b (sRGB 0..1), s.h (height, metres-ish units), s.rough (0..1)
export function pbrSet(size, fn, o = {}) {
  const N = size * size, A = new Uint8Array(N * 4), NR = new Uint8Array(N * 4), H = new Float32Array(N); const s = {};
  const cl = v => v < 0 ? 0 : v > 255 ? 255 : v;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    s.r = s.g = s.b = 0.5; s.h = 0; s.rough = 0.5; fn((x + 0.5) / size, (y + 0.5) / size, s);
    const i = y * size + x; A[i * 4] = cl(s.r * 255); A[i * 4 + 1] = cl(s.g * 255); A[i * 4 + 2] = cl(s.b * 255); A[i * 4 + 3] = 255; H[i] = s.h; NR[i * 4 + 2] = cl(s.rough * 255); NR[i * 4 + 3] = 255;
  }
  const k = (o.bump ?? 1) * size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, xl = y * size + (x + size - 1) % size, xr = y * size + (x + 1) % size, yu = ((y + size - 1) % size) * size + x, yd = ((y + 1) % size) * size + x;
    let nx = (H[xl] - H[xr]) * k * 0.5, ny = (H[yu] - H[yd]) * k * 0.5; const l = Math.hypot(nx, ny, 1); nx /= l; ny /= l;
    NR[i * 4] = cl((nx * 0.5 + 0.5) * 255); NR[i * 4 + 1] = cl((ny * 0.5 + 0.5) * 255);
  }
  const mk = (d, srgb) => { const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
  return { map: mk(A, true), nr: mk(NR, false), dispose() { this.map.dispose(); this.nr.dispose(); } };
}
const hexRGB = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; }; // sRGB components (Color stores sRGB->linear? no: Color(hex) converts to linear in r152+)
export function srgb(hex) { const c = new THREE.Color(hex); c.convertLinearToSRGB(); return [c.r, c.g, c.b]; }
const mix = (a, b, t) => a + (b - a) * t, sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// library of procedural surfaces; every generator returns { map, nr } tiling textures
export const SURF = {
  // polished terrazzo in large tiles (2 x 2 tiles per repeat), coloured chips, waxed sheen variation
  terrazzo(size, base = '#e6e1d6', chip = '#9a948a', accent = '#1aa6a0') {
    const B = srgb(base), C1 = srgb(chip), C2 = srgb(accent), C3 = [1, 1, 1], C4 = srgb('#5d5850');
    return pbrSet(size, (u, v, s) => {
      const n = nz(0, u * 2, v * 2), f = nz(2, u * 3, v * 3), g = nz(1, u * 2, v * 2);
      let r = B[0] * (0.94 + 0.1 * n), gg = B[1] * (0.94 + 0.1 * n), b = B[2] * (0.94 + 0.1 * n);
      // chips: cellular blobs
      const cx = u * 48, cy = v * 48, ix = Math.floor(cx), iy = Math.floor(cy); let chipc = null, ch = 0;
      for (let dy = -1; dy <= 1 && !chipc; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = ((ix + dx) % 48 + 48) % 48, Y = ((iy + dy) % 48 + 48) % 48; const h = hash01(X, Y, 5);
        if (h > 0.62) continue; const px = ix + dx + hash01(X, Y, 6), py = iy + dy + hash01(X, Y, 7); const rr = 0.12 + 0.3 * hash01(X, Y, 8);
        const d = Math.hypot(cx - px, (cy - py) * (0.8 + 0.4 * hash01(X, Y, 9))); if (d < rr) { const t = hash01(X, Y, 10); chipc = t < 0.45 ? C1 : t < 0.7 ? C3 : t < 0.85 ? C4 : C2; ch = 1 - d / rr; break; }
      }
      if (chipc) { r = mix(r, chipc[0], 0.85); gg = mix(gg, chipc[1], 0.85); b = mix(b, chipc[2], 0.85); }
      // tile joints (2 x 2 tiles per repeat)
      const jx = Math.min(u * 2 % 1, 1 - u * 2 % 1), jy = Math.min(v * 2 % 1, 1 - v * 2 % 1), j = Math.min(jx, jy);
      const joint = 1 - sst(0.0015, 0.004, j);
      const tv = 0.97 + 0.06 * hash01(Math.floor(u * 2), Math.floor(v * 2), 3); r *= tv; gg *= tv; b *= tv;
      r = mix(r, r * 0.62, joint); gg = mix(gg, gg * 0.62, joint); b = mix(b, b * 0.6, joint);
      s.r = r; s.g = gg; s.b = b; s.h = -joint * 0.0012 + (chipc ? ch * 0.00005 : 0) + f * 0.00004;
      s.rough = mix(0.09 + 0.1 * g + 0.05 * f, 0.6, joint);
    }, { bump: 1.6 });
  },
  // loop-pile carpet with a woven pattern and a border-free field
  carpet(size, base = '#3a4250', pat = '#1aa6a0') {
    const B = srgb(base), P = srgb(pat);
    return pbrSet(size, (u, v, s) => {
      const f = nz(2, u * 4, v * 4), n = nz(0, u, v), g = nz(1, u * 3, v * 3);
      const lu = (u * 64) % 1, lv = (v * 64) % 1; const loop = Math.sin(lu * Math.PI) * Math.sin(lv * Math.PI);
      const dia = Math.abs(((u + v) * 8) % 1 - 0.5), dia2 = Math.abs(((u - v + 4) * 8) % 1 - 0.5); const pm = sst(0.06, 0.03, Math.min(dia, dia2)) * 0.55;
      const k = 0.85 + 0.25 * f + 0.1 * n;
      s.r = mix(B[0], P[0], pm) * k; s.g = mix(B[1], P[1], pm) * k; s.b = mix(B[2], P[2], pm) * k;
      s.h = loop * 0.0009 + f * 0.0006 + g * 0.0004; s.rough = 0.92;
    }, { bump: 1.2 });
  },
  // timber with grain along v
  wood(size, base = '#c9a27a') {
    const B = srgb(base);
    return pbrSet(size, (u, v, s) => {
      const w = nz(0, u * 1, v * 0.25), g = nz(1, u * 8, v * 0.5), fine = nz(2, u * 16, v * 1);
      const ring = 0.5 + 0.5 * Math.sin((u * 26 + w * 6) * Math.PI);
      const k = 0.78 + 0.18 * ring + 0.1 * g - 0.08 * fine;
      s.r = B[0] * k; s.g = B[1] * k; s.b = B[2] * (k * 0.97); s.h = fine * 0.00025 + ring * 0.0002; s.rough = 0.5 + 0.15 * g;
    }, { bump: 1 });
  },
  // brushed metal (streaks along u)
  brushed(size, base = '#c9ced4') {
    const B = srgb(base);
    return pbrSet(size, (u, v, s) => {
      const st = nz(2, u * 0.5, v * 32), st2 = nz(1, u * 0.25, v * 16), n = nz(0, u, v);
      const k = 0.9 + 0.12 * st + 0.05 * st2; s.r = B[0] * k; s.g = B[1] * k; s.b = B[2] * k; s.h = st * 0.00012; s.rough = 0.26 + 0.12 * st2 + 0.06 * n;
    }, { bump: 1 });
  },
  // satin paint with a faint orange-peel
  paint(size) {
    return pbrSet(size, (u, v, s) => { const f = nz(2, u * 2, v * 2), n = nz(0, u, v); const k = 0.96 + 0.05 * n; s.r = s.g = s.b = k; s.h = f * 0.0002; s.rough = 0.42 + 0.08 * n; }, { bump: 1 });
  },
  // composite wall panels (2 x 1 panels per repeat) with recessed joints and fixings
  panels(size, base = '#efeee9') {
    const B = srgb(base);
    return pbrSet(size, (u, v, s) => {
      const n = nz(0, u, v), f = nz(2, u, v); const jx = Math.min(u * 2 % 1, 1 - u * 2 % 1) / 2, jy = Math.min(v % 1, 1 - v % 1);
      const joint = 1 - sst(0.003, 0.006, Math.min(jx, jy)); const pv = 0.97 + 0.05 * hash01(Math.floor(u * 2), Math.floor(v), 4);
      const k = pv * (0.97 + 0.04 * n) * (1 - 0.45 * joint); s.r = B[0] * k; s.g = B[1] * k; s.b = B[2] * k; s.h = -joint * 0.003 + f * 0.00005; s.rough = mix(0.32 + 0.06 * n, 0.7, joint);
    }, { bump: 1 });
  },
  // honed stone / marble with soft veins and cladding joints (1 x 2 slabs)
  stone(size, base = '#d9d4ca', vein = '#8f8a80') {
    const B = srgb(base), V = srgb(vein);
    return pbrSet(size, (u, v, s) => {
      const w = nz(0, u * 2, v * 2), w2 = nz(1, u, v); const ve = Math.abs(Math.sin((u * 3 + v * 1.2 + w * 3.5 + w2) * Math.PI)); const vm = Math.pow(1 - ve, 18) * 0.8 + Math.pow(1 - Math.abs(Math.sin((u * 7 - v * 2 + w2 * 5) * Math.PI)), 40) * 0.4;
      const jx = Math.min(u % 1, 1 - u % 1), jy = Math.min(v * 2 % 1, 1 - v * 2 % 1) / 2; const joint = 1 - sst(0.002, 0.004, Math.min(jx, jy));
      const k = (0.95 + 0.08 * w) * (1 - 0.4 * joint); s.r = mix(B[0], V[0], vm) * k; s.g = mix(B[1], V[1], vm) * k; s.b = mix(B[2], V[2], vm) * k; s.h = -joint * 0.0015; s.rough = mix(0.16 + 0.08 * w2, 0.6, joint);
    }, { bump: 1 });
  },
  // leatherette / vinyl upholstery grain
  leather(size) {
    return pbrSet(size, (u, v, s) => { const g = nz(2, u * 4, v * 4), c = nz(1, u * 4, v * 4); const k = 0.92 + 0.1 * g; s.r = s.g = s.b = k; s.h = (g * 0.6 + c * 0.4) * 0.0005; s.rough = 0.48 + 0.12 * c; }, { bump: 1.4 });
  },
  // ribbed rubber (belts, treads, bridge floors)
  rubber(size) {
    return pbrSet(size, (u, v, s) => { const r = Math.sin(u * 16 * Math.PI * 2); const f = nz(2, u, v); s.r = s.g = s.b = 0.85 + 0.1 * f; s.h = Math.max(0, r) * 0.0008 + f * 0.0001; s.rough = 0.7 + 0.1 * f; }, { bump: 1 });
  },
  // anti-slip aluminium tread plate (escalator steps, bridge cab)
  tread(size) {
    return pbrSet(size, (u, v, s) => { const g = Math.abs(Math.sin(u * 40 * Math.PI)); const f = nz(2, u, v); s.r = s.g = s.b = 0.75 + 0.15 * f - 0.25 * (1 - g); s.h = g * 0.0008; s.rough = 0.35 + 0.2 * (1 - g); }, { bump: 1 });
  },
};

// ---------------------------------------------------------------- shared uniforms of the hall lighting model
export const NL = 24;
export const HALL_U = {
  uToHall: { value: new THREE.Matrix4() }, uHallR: { value: new THREE.Matrix3() },
  uHall: { value: new THREE.Vector4(44, 66, 4.6, 11.5) }, // half width, depth, floor y, façade height above floor
  uVault: { value: 4 }, uSkyY: { value: 18 },
  uSkyCol: { value: new THREE.Color(0, 0, 0) }, uAmb: { value: new THREE.Color(0.5, 0.48, 0.45) }, uExpK: { value: 1 },
  uSunL: { value: new THREE.Vector3(0, -1, 0) }, uSunK: { value: 2.2 },
  uFac: { value: new THREE.Vector4(0.35, 11, 1.5, 9) }, uSkyl: { value: new THREE.Vector4(18, 1.45, 3, 60) },
  uLP: { value: Array.from({ length: NL }, () => new THREE.Vector4(0, -100, 0, 0.01)) }, uLC: { value: Array.from({ length: NL }, () => new THREE.Color(0, 0, 0)) },
  uBoxMin: { value: new THREE.Vector3(-44, 4.6, 0) }, uBoxMax: { value: new THREE.Vector3(44, 20, 66) }, uProbe: { value: new THREE.Vector3(0, 7, 33) }, uBoxOn: { value: 0 },
  uFloorAO: { value: null }, uFloorDecal: { value: null }, uFloorX: { value: new THREE.Vector4(0, 0, 1 / 88, 1 / 66) },
  uGlassRefl: { value: 1.5 }, uTime: ATM.uTime,
};
// bridge interiors and small rooms: simple tunnel light, with the same exposure compensation
export const ROOM_U = { uRoomCol: { value: new THREE.Color(0.95, 0.9, 0.82) } };

const HALL_PARS = /* glsl */`
#define NL ${NL}
uniform mat4 uToHall; uniform mat3 uHallR; uniform vec4 uHall; uniform float uVault; uniform float uSkyY;
uniform vec3 uSkyCol; uniform vec3 uAmb; uniform float uExpK; uniform vec3 uSunL; uniform float uSunK;
uniform vec4 uFac; uniform vec4 uSkyl; uniform vec4 uLP[NL]; uniform vec3 uLC[NL];
uniform vec3 uBoxMin; uniform vec3 uBoxMax; uniform vec3 uProbe; uniform float uBoxOn; uniform float uGlassRefl;
uniform sampler2D uFloorAO; uniform sampler2D uFloorDecal; uniform vec4 uFloorX; uniform vec3 uRoomCol;
varying vec3 vHall;
float hallSun(vec3 p){
  vec3 L = uSunL; if (L.y < 0.02) return 0.0;
  float m = 0.0;
  if (L.z < -0.015 && p.z > -0.2) { // curtain wall (plane z = 0)
    float t = -p.z / L.z; vec3 h = p + L * t;
    float fy = h.y - uHall.z;
    if (fy > uFac.x && fy < uFac.y && abs(h.x) < uHall.x) {
      float mx = abs(fract(h.x / uFac.z + 0.5) - 0.5) * uFac.z;
      float px = abs(fract((h.x - uFac.w * 0.5) / uFac.w + 0.5) - 0.5) * uFac.w;
      float g = smoothstep(0.035, 0.08, mx) * smoothstep(0.14, 0.24, px);
      float ty = min(abs(fy - 3.3), abs(fy - 7.4)); g *= smoothstep(0.04, 0.1, ty);
      m = max(m, g * smoothstep(uFac.x, uFac.x + 0.2, fy) * smoothstep(uFac.y, uFac.y - 0.3, fy));
    }
  }
  { // skylight strips in the vault
    float t = (uSkyY - p.y) / L.y; vec3 h = p + L * t;
    float sx = abs(fract(h.x / uSkyl.x + 0.5) - 0.5) * uSkyl.x;
    float inz = smoothstep(uSkyl.z, uSkyl.z + 0.3, h.z) * smoothstep(uSkyl.w, uSkyl.w - 0.3, h.z) * step(abs(h.x), uHall.x);
    float bars = smoothstep(0.03, 0.08, abs(fract(h.z / 1.8 + 0.5) - 0.5) * 1.8);
    m = max(m, smoothstep(uSkyl.y, uSkyl.y - 0.12, sx) * inz * bars);
  }
  return m;
}
vec3 hallIrr(vec3 p, vec3 n){
  float y = p.y - uHall.z;
  vec3 E = uAmb * (0.78 + 0.22 * n.y);
  float w = exp(-max(p.z, 0.0) / 13.0);
  E += uSkyCol * (0.16 + 1.05 * w) * (0.3 + 0.7 * clamp(0.5 - 0.5 * n.z, 0.0, 1.0));
  float sx = abs(fract(p.x / uSkyl.x + 0.5) - 0.5) * uSkyl.x;
  E += uSkyCol * 0.32 * (0.35 + 0.65 * max(n.y, 0.0)) * (0.55 + 0.45 * exp(-sx * sx / 26.0));
  E += uSkyCol * 0.35 * exp(-max(uHall.y - p.z, 0.0) / 9.0) * clamp(0.5 + 0.5 * n.z, 0.0, 1.0);
  for (int i = 0; i < NL; i++) {
    vec3 d = uLP[i].xyz - p; float r = uLP[i].w; float dd = dot(d, d);
    float a = r * r / (dd + r * r * 0.3) * (1.0 - smoothstep(r * 1.4, r * 3.4, sqrt(dd)));
    float c = 0.3 + 0.7 * max(dot(n, d * inversesqrt(dd + 1e-4)), 0.0);
    E += uLC[i] * (a * c);
  }
  float wallD = min(uHall.x - abs(p.x), uHall.y - p.z);
  E *= 1.0 - 0.22 * exp(-max(wallD, 0.0) / 1.4) - 0.2 * exp(-max(y, 0.0) / 0.3) * (1.0 - abs(n.y));
  return E;
}
vec3 hallRad(vec3 viewDir, vec3 nrm, float rough){
  #ifdef ENVMAP_TYPE_CUBE_UV
  vec3 r = reflect(-viewDir, nrm); r = normalize(mix(r, nrm, rough * rough));
  vec3 rw = inverseTransformDirection(r, viewMatrix);
  if (uBoxOn > 0.5) {
    vec3 rh = uHallR * rw; vec3 ph = vHall;
    vec3 t1 = (uBoxMax - ph) / rh, t2 = (uBoxMin - ph) / rh; vec3 tm = max(t1, t2); float t = min(min(tm.x, tm.y), tm.z);
    vec3 dh = ph + rh * max(t, 0.0) - uProbe; rw = normalize(dh * uHallR);
  }
  return textureCubeUV(envMap, rw, rough).rgb * envMapIntensity;
  #else
  return vec3(0.0);
  #endif
}
`;

// mode: 'hall' (terminal lighting), 'room' (bridge / small rooms: uniform tunnel light), flags: floor, glass, leaf
export function hallMaterial(o = {}) {
  const mode = o.mode || 'hall';
  const m = new THREE.MeshStandardMaterial({ color: o.color ?? 0xffffff, roughness: o.rough ?? 0.6, metalness: o.metal ?? 0, map: o.tex?.map || null, normalMap: o.tex?.nr || null, roughnessMap: o.tex?.nr || null, vertexColors: true, side: o.side ?? THREE.FrontSide, transparent: !!o.glass, alphaTest: o.alphaTest || 0, envMapIntensity: o.env ?? 1, emissive: o.emissive ?? 0x000000 });
  if (o.normalScale) m.normalScale.set(o.normalScale, o.normalScale);
  if (o.glass) { m.premultipliedAlpha = true; m.depthWrite = false; m.opacity = o.opacity ?? 0.1; }
  const key = ['hall', mode, o.floor ? 'F' : '', o.glass ? 'G' : '', o.leaf ? 'L' : '', o.decal ? 'D' : ''].join('');
  m.userData.key = key;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    Object.assign(sh.uniforms, HALL_U, ROOM_U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform mat4 uToHall; varying vec3 vHall;')
      .replace('#include <project_vertex>', `#include <project_vertex>
{ vec4 hp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  hp = instanceMatrix * hp;
#endif
  vHall = (uToHall * modelMatrix * hp).xyz; }`);
    let fs = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + HALL_PARS)
      .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', 'vec3 mapN = vec3(texture2D( normalMap, vNormalMapUv ).xy * 2.0 - 1.0, 0.0); mapN.z = sqrt(max(1.0 - dot(mapN.xy, mapN.xy), 0.0));')
      .replace('roughnessFactor *= texelRoughness.g;', 'roughnessFactor *= texelRoughness.b;');
    // floor: contact-shadow AO texture + decal inlays in hall-plan UVs
    const floorUV = 'vec2 fuv = (vHall.xz - uFloorX.xy) * uFloorX.zw;';
    if (o.floor) fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
  ${floorUV}
  float floorAO = texture2D(uFloorAO, fuv).r;
  ${o.decal ? 'vec4 dec = texture2D(uFloorDecal, fuv); diffuseColor.rgb = mix(diffuseColor.rgb, dec.rgb * dec.rgb, dec.a);' : ''}`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + (o.decal ? 'roughnessFactor = mix(roughnessFactor, 0.08, dec.a * 0.6);' : ''));
    // direct sun: masked by the glazing (and furniture contact shadows on floors)
    const sunMask = mode === 'hall' ? (o.floor ? 'float hSun = hallSun(vHall) * uSunK * texture2D(uFloorAO, fuv + uSunL.xz / max(uSunL.y, 0.1) * 0.45 * uFloorX.zw).r;' : 'float hSun = hallSun(vHall) * uSunK;') : 'float hSun = 0.0;';
    fs = fs.replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= hSun;'))
      .replace('#include <lights_fragment_begin>', '');
    fs = fs.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive;\n' + sunMask);
    const irr = mode === 'hall' ? 'hallIrr(vHall, hN)' : 'uRoomCol';
    fs = fs.replace('#include <lights_fragment_maps>', `
#if defined( RE_IndirectDiffuse )
  { vec3 hN = normalize(uHallR * inverseTransformDirection(geometryNormal, viewMatrix));
    iblIrradiance += PI * ${irr} * uExpK ${o.floor ? '* floorAO' : ''}; }
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
  radiance += hallRad(geometryViewDir, geometryNormal, material.roughness) ${o.floor ? '* (0.35 + 0.65 * floorAO)' : ''};
#endif`);
    if (o.leaf) fs = fs.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse += diffuseColor.rgb * 0.25 * hSun * uSunCol(); ');
    if (o.glass) fs = fs.replace('#include <opaque_fragment>', 'gl_FragColor = vec4(totalDiffuse * diffuseColor.a + totalSpecular * uGlassRefl, diffuseColor.a);').replace('#include <premultiplied_alpha_fragment>', '');
    if (o.leaf) fs = fs.replace('uniform vec3 uRoomCol;', 'uniform vec3 uRoomCol; vec3 uSunCol(){ return vec3(1.0, 0.95, 0.85); }');
    sh.fragmentShader = fs;
    prev && prev.call(m, sh, r);
  };
  return atmos(m);
}

// ---------------------------------------------------------------- emissive atlas material (signs, screens, light fittings)
// vertex colour > 1 makes fittings glow into the bloom; .color is scaled for exposure by the owner
export function emitMaterial(tex) {
  const m = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true });
  m.userData.key = 'envEmit'; return atmos(m);
}

// ---------------------------------------------------------------- geometry
export const M4 = (x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
export const G = {
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  rbox: (w, h, d, r = 0.02, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)),
  cyl: (rt, rb, h, seg = 16, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open),
  sphere: (r, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs),
  plane: (w, h, sx = 1, sy = 1) => new THREE.PlaneGeometry(w, h, sx, sy),
  lathe: (pts, seg = 16) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg),
  // extrude a 2D outline (x,y pairs) along +z by depth, bevelled
  extrude: (pts, depth, bevel = 0.01, curveSeg = 2) => { const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))); const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(1e-3, depth - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: curveSeg, curveSegments: curveSeg * 3 }); g.translate(0, 0, bevel); return g; },
  shapeExtrude: (shape, depth, bevel = 0.01, seg = 2) => { const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1e-3, depth - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: seg, curveSegments: seg * 4 }); g.translate(0, 0, bevel); return g; },
  tube: (pts, r, seg = 24, rs = 8) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), seg, r, rs, false),
  // straight round bar between two points
  bar: (a, b, r, rs = 8) => { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b); const L = A.distanceTo(B); const g = new THREE.CylinderGeometry(r, r, L, rs, 1, true); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); g.applyQuaternion(q); g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2); return g; },
};
// rounded-rectangle 2D outline
export function rrect(w, h, r, seg = 4) { const s = new THREE.Shape(); const x = -w / 2, y = -h / 2; r = Math.min(r, w / 2, h / 2); s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s; }

// Bucket: merges every geometry added under one material key; UVs at real-world scale; vertex colour = tint x AO
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
export class Bucket {
  constructor(aoFn = null) { this.parts = new Map(); this.aoFn = aoFn; }
  // o: { m (Matrix4), tint ([r,g,b] linear or hex), uv: 'box'|'cyl'|'keep'|[u0,v0,u1,v1] (atlas rect for 0..1 uvs), s (metres per repeat), ao: [y0, y1, min] local-height AO, glow (vertex colour multiplier for emissive) }
  add(key, geo, o = {}) {
    let g = geo.index ? geo : geo; if (o.m) g.applyMatrix4(o.m);
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    const P = g.attributes.position, N = g.attributes.normal, n = P.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    const U = g.attributes.uv; const s = o.s || 1;
    if (o.uv === 'box' || (!o.uv && !Array.isArray(o.uv))) {
      for (let i = 0; i < n; i++) { const ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i)), az = Math.abs(N.getZ(i)); const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        if (ay >= ax && ay >= az) U.setXY(i, x / s, z / s); else if (ax >= az) U.setXY(i, z / s, y / s); else U.setXY(i, x / s, y / s); }
    } else if (o.uv === 'keep') { const su = o.su ?? 1, sv = o.sv ?? 1; for (let i = 0; i < n; i++) U.setXY(i, U.getX(i) * su, U.getY(i) * sv); }
    else if (Array.isArray(o.uv)) { const [u0, v0, u1, v1] = o.uv; for (let i = 0; i < n; i++) U.setXY(i, u0 + (u1 - u0) * U.getX(i), v0 + (v1 - v0) * U.getY(i)); }
    const tint = o.tint == null ? [1, 1, 1] : Array.isArray(o.tint) ? o.tint : (() => { const c = new THREE.Color(o.tint); return [c.r, c.g, c.b]; })();
    const C = new Float32Array(n * 3); const glow = o.glow ?? 1;
    let yMin = Infinity, yMax = -Infinity; if (o.ao) { yMin = o.ao[0]; yMax = o.ao[1]; }
    for (let i = 0; i < n; i++) {
      let a = 1; const y = P.getY(i);
      if (o.ao) a *= mix(o.ao[2], 1, sst(yMin, yMax, y));
      if (this.aoFn && !o.noHallAO) a *= this.aoFn(P.getX(i), y, P.getZ(i), N.getX(i), N.getY(i), N.getZ(i));
      C[i * 3] = tint[0] * a * glow; C[i * 3 + 1] = tint[1] * a * glow; C[i * 3 + 2] = tint[2] * a * glow;
    }
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    if (!g.index) { const I = new Uint32Array(n); for (let i = 0; i < n; i++) I[i] = i; g.setIndex(new THREE.BufferAttribute(I, 1)); }
    if (!this.parts.has(key)) this.parts.set(key, []); this.parts.get(key).push(g); return g;
  }
  geometry(key) { const L = this.parts.get(key); if (!L || !L.length) return null; const g = mergeGeometries(L, false); L.forEach(x => x.dispose()); this.parts.delete(key); g.computeBoundingSphere(); return g; }
  // build one Mesh per key; mats: { key: material }
  meshes(mats, parent) { const out = {}; for (const key of [...this.parts.keys()]) { const mat = mats[key]; if (!mat) { console.warn('env: no material for', key); continue; } const g = this.geometry(key); if (!g) continue; const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.name = key; out[key] = m; parent && parent.add(m); } return out; }
}
// instanced mesh from a bucket key (template built at the origin), with matrices
export function instanced(bucket, key, mat, mats, parent) { const g = bucket.geometry(key); if (!g || !mats.length) return null; const im = new THREE.InstancedMesh(g, mat, mats.length); mats.forEach((m, i) => im.setMatrixAt(i, m)); im.frustumCulled = false; parent && parent.add(im); return im; }

// ---------------------------------------------------------------- canvas atlas helper
export class Atlas {
  constructor(w, h) { this.cv = document.createElement('canvas'); this.cv.width = w; this.cv.height = h; this.c = this.cv.getContext('2d'); this.R = {}; this.x = 0; this.y = 0; this.row = 0; this.W = w; this.H = h; }
  // allocate a w x h px cell (shelf packing) and draw into it; returns uv rect [u0, v0, u1, v1]
  cell(name, w, h, draw) {
    if (this.x + w > this.W) { this.x = 0; this.y += this.row; this.row = 0; }
    if (this.y + h > this.H) { console.warn('env atlas full', name); return this.R[name] = [0, 0, 0.001, 0.001]; }
    const x = this.x, y = this.y; this.x += w + 2; this.row = Math.max(this.row, h + 2);
    const c = this.c; c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.translate(x, y); draw(c, w, h); c.restore();
    const r = [(x + 0.5) / this.W, 1 - (y + h - 0.5) / this.H, (x + w - 0.5) / this.W, 1 - (y + 0.5) / this.H]; this.R[name] = r; return r;
  }
  texture() { const t = new THREE.CanvasTexture(this.cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; this.tex = t; return t; }
}

// ---------------------------------------------------------------- baked reflections: one cube capture -> PMREM
const _pm = new WeakMap();
export function bakeProbe(renderer, scene, worldPos, hide = [], size = 256) {
  let pm = _pm.get(renderer); if (!pm) { pm = new THREE.PMREMGenerator(renderer); _pm.set(renderer, pm); }
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cam = new THREE.CubeCamera(0.2, 4000, rt); cam.position.copy(worldPos); cam.updateMatrixWorld(true);
  const vis = hide.map(o => o.visible); hide.forEach(o => o.visible = false);
  const ae = renderer.autoClear; renderer.autoClear = true;
  try { cam.update(renderer, scene); } finally { renderer.autoClear = ae; hide.forEach((o, i) => o.visible = vis[i]); }
  const env = pm.fromCubemap(rt.texture); rt.dispose(); return env;
}
export { mergeGeometries };
