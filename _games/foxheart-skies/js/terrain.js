// Terrain: one camera-centred warped grid displaced on the GPU. Land/water/urban/hill masks are painted on
// canvases from the APPROXIMATE hand-made surroundings (surroundings.js); the same height function runs in
// JS so the aircraft collides with the hills it sees.
import * as THREE from 'three';
import { ATM, ATM_GLSL, NOISE_GLSL, atmos } from './sky.js';
import { REGIONS, climateFor } from './surroundings.js';
import { Geo, haversine, D2R } from './data.js';

export const HILL_SCALE = 4000;
const NEAR_SIZE = 48000, WIDE_SIZE = 440000;

const CLIMATES = {
  subtropical: { grass: [0.20, 0.27, 0.12], dry: [0.36, 0.34, 0.22], dark: [0.10, 0.17, 0.08], soil: [0.33, 0.29, 0.21], fields: 0.35, shallow: [0.05, 0.30, 0.30] },
  tropical: { grass: [0.13, 0.25, 0.08], dry: [0.26, 0.30, 0.14], dark: [0.06, 0.15, 0.05], soil: [0.33, 0.24, 0.16], fields: 0.25, shallow: [0.06, 0.28, 0.27] },
  temperate: { grass: [0.22, 0.28, 0.13], dry: [0.38, 0.35, 0.22], dark: [0.11, 0.17, 0.09], soil: [0.31, 0.26, 0.20], fields: 0.75, shallow: [0.06, 0.18, 0.20] },
  'temperate-green': { grass: [0.20, 0.31, 0.12], dry: [0.36, 0.37, 0.20], dark: [0.10, 0.18, 0.08], soil: [0.30, 0.26, 0.19], fields: 1.0, shallow: [0.06, 0.17, 0.19] },
  mediterranean: { grass: [0.30, 0.30, 0.17], dry: [0.45, 0.40, 0.28], dark: [0.15, 0.19, 0.11], soil: [0.40, 0.34, 0.26], fields: 0.3, shallow: [0.05, 0.20, 0.24] },
  desert: { grass: [0.55, 0.45, 0.31], dry: [0.62, 0.52, 0.37], dark: [0.47, 0.38, 0.27], soil: [0.58, 0.47, 0.33], fields: 0.05, shallow: [0.10, 0.38, 0.40] },
  boreal: { grass: [0.15, 0.22, 0.12], dry: [0.28, 0.28, 0.20], dark: [0.07, 0.13, 0.08], soil: [0.25, 0.23, 0.19], fields: 0.4, shallow: [0.05, 0.14, 0.17] },
};

function hash32(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// ---- JS twin of the GLSL noise (keep in sync with NOISE_GLSL) ----
const fr = x => x - Math.floor(x);
function h12(x, y) { let a = fr(x * 0.1031), b = fr(y * 0.1031), c = fr(x * 0.1031); const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33); a += d; b += d; c += d; return fr((a + b) * c); }
function vnoise(x, y) { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy; const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = h12(ix, iy), b = h12(ix + 1, iy), c = h12(ix, iy + 1), d = h12(ix + 1, iy + 1); return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy; }
function fbm4(x, y) { let s = 0, a = 0.5; for (let i = 0; i < 4; i++) { s += a * vnoise(x, y); const nx = 1.6 * x - 1.2 * y + 3.1, ny = 1.2 * x + 1.6 * y + 3.1; x = nx; y = ny; a *= 0.5; } return s; }

export class Masks {
  constructor(quality) { this.nearN = quality === 'low' ? 1024 : 2048; this.wideN = 1024; this.near = null; this.wide = null; }
  build(geo, cx, cz, airports, extraCities) {
    const mk = (N, size) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = N; const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, N, N);
      const s = N / size, ox = cx - size / 2, oz = cz - size / 2;
      const P = (lat, lon) => [(geo.x(lon) - ox) * s, (geo.z(lat) - oz) * s];
      const poly = (arr, style) => { ctx.fillStyle = style; ctx.beginPath(); for (let i = 0; i < arr.length; i += 2) { const [x, y] = P(arr[i], arr[i + 1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.fill(); };
      const regions = REGIONS.filter(r => { const c = geo.toLatLon(cx, cz); return haversine(c.lat, c.lon, (r.bbox[0] + r.bbox[2]) / 2, (r.bbox[1] + r.bbox[3]) / 2) < size * 0.6 + 400e3; });
      ctx.globalCompositeOperation = 'source-over';
      for (const r of regions) for (const p of r.water) poly(p, '#ff0000');
      for (const r of regions) for (const p of (r.wetland || [])) poly(p, '#730000');
      for (const r of regions) for (const rv of (r.rivers || [])) {
        ctx.strokeStyle = '#ff0000'; ctx.lineWidth = Math.max(1, rv[0] * s); ctx.lineJoin = ctx.lineCap = 'round'; ctx.beginPath();
        for (let i = 1; i < rv.length; i += 2) { const [x, y] = P(rv[i], rv[i + 1]); i > 1 ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
      }
      for (const r of regions) for (const p of (r.land || [])) poly(p, '#000000');
      // carve land under every runway and apron so no runway ever sits in the water
      ctx.fillStyle = '#000';
      for (const a of airports) {
        const g = a.geom; if (!g) continue; const ax = geo.x(a.lon), az = geo.z(a.lat);
        for (const r of g.runways) {
          ctx.save(); ctx.translate((ax + r.cx - ox) * s, (az + r.cz - oz) * s); ctx.rotate(Math.atan2(r.dir.z, r.dir.x));
          ctx.fillRect(-(r.L / 2 + 250) * s, -(r.W / 2 + 160) * s, (r.L + 500) * s, (r.W + 320) * s); ctx.restore();
        }
        if (g.apron) { const ap = g.apron; ctx.save(); ctx.translate((ax + ap.x - ox) * s, (az + ap.z - oz) * s); ctx.rotate(Math.atan2(ap.dz, ap.dx)); ctx.fillRect(-(ap.len / 2 + 300) * s, -(ap.dep / 2 + 300) * s, (ap.len + 600) * s, (ap.dep + 600) * s); ctx.restore(); }
      }
      ctx.globalCompositeOperation = 'lighter';
      const blob = (lat, lon, rM, v, ch) => {
        const [x, y] = P(lat, lon); const rr = Math.max(1.5, rM * s); const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
        const c = a => ch === 'g' ? `rgba(0,${Math.round(255 * Math.min(1, v * a))},0,1)` : `rgba(0,0,${Math.round(255 * Math.min(1, v * a))},1)`;
        g.addColorStop(0, c(1)); g.addColorStop(0.35, c(0.82)); g.addColorStop(0.65, c(0.38)); g.addColorStop(1, c(0)); ctx.fillStyle = g; ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      };
      const cities = [...regions.flatMap(r => r.cities), ...extraCities];
      for (const c of cities) blob(c.lat, c.lon, c.r * 1000, c.d, 'g');
      for (const r of regions) for (const h of r.hills) blob(h.lat, h.lon, h.r * 1000 * 1.25, h.h / HILL_SCALE, 'b');
      ctx.globalCompositeOperation = 'source-over';
      // soften
      const out = document.createElement('canvas'); out.width = out.height = N; const o = out.getContext('2d', { willReadFrequently: true });
      o.filter = `blur(${N === this.wideN ? 1.2 : 1.6}px)`; o.drawImage(cv, 0, 0); o.filter = 'none';
      const data = o.getImageData(0, 0, N, N).data;
      const tex = new THREE.CanvasTexture(out); tex.colorSpace = THREE.NoColorSpace; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.anisotropy = 4; tex.generateMipmaps = true;
      tex.flipY = false;
      return { N, size, cx, cz, data, tex, cities };
    };
    if (this.near) this.near.tex.dispose(); if (this.wide) this.wide.tex.dispose();
    this.near = mk(this.nearN, NEAR_SIZE); this.wide = mk(this.wideN, WIDE_SIZE);
  }
  sampleOne(M, x, z, out) {
    const u = (x - M.cx) / M.size + 0.5, v = (z - M.cz) / M.size + 0.5;
    const fx = Math.min(Math.max(u * M.N - 0.5, 0), M.N - 1.001), fy = Math.min(Math.max(v * M.N - 0.5, 0), M.N - 1.001);
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, N = M.N, d = M.data;
    for (let c = 0; c < 3; c++) {
      const a = d[(iy * N + ix) * 4 + c], b = d[(iy * N + ix + 1) * 4 + c], e = d[((iy + 1) * N + ix) * 4 + c], f = d[((iy + 1) * N + ix + 1) * 4 + c];
      out[c] = ((a + (b - a) * tx) * (1 - ty) + (e + (f - e) * tx) * ty) / 255;
    }
    return out;
  }
  sample(x, z, out = [0, 0, 0]) {
    if (!this.near) { out[0] = out[1] = out[2] = 0; return out; }
    const un = (x - this.near.cx) / this.near.size + 0.5, vn = (z - this.near.cz) / this.near.size + 0.5;
    const e = 1 - Math.min(1, Math.max(0, (Math.max(Math.abs(un - 0.5), Math.abs(vn - 0.5)) - 0.45) / 0.05));
    const w = this.sampleOne(this.wide, x, z, [0, 0, 0]);
    if (e <= 0) { out[0] = w[0]; out[1] = w[1]; out[2] = w[2]; return out; }
    const n = this.sampleOne(this.near, x, z, [0, 0, 0]);
    for (let c = 0; c < 3; c++) out[c] = w[c] + (n[c] - w[c]) * e;
    return out;
  }
}

const TERRAIN_COMMON = /* glsl */`
uniform sampler2D uNear; uniform sampler2D uWide; uniform vec4 uNearR; uniform vec4 uWideR;
uniform float uBase; uniform float uNoiseAmp; uniform vec4 uApt[4]; uniform float uAptElev[4];
${NOISE_GLSL}
float fbm4(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a*vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6)*p + 3.1; a *= 0.5; } return s; }
vec4 masksL(vec2 p){
  vec2 un = (p - uNearR.xy)/uNearR.z + 0.5; vec2 uw = (p - uWideR.xy)/uWideR.z + 0.5;
  vec4 mw = textureLod(uWide, uw, 0.0);
  float e = 1.0 - clamp((max(abs(un.x-0.5), abs(un.y-0.5)) - 0.45)/0.05, 0.0, 1.0);
  if (e <= 0.0) return mw;
  return mix(mw, textureLod(uNear, un, 0.0), e);
}
float terrainH(vec2 p, vec4 m, out float flatF){
  float n = fbm4(p / 6500.0);
  float rough = uNoiseAmp * (n - 0.38) * 2.0 + 18.0 * (vnoise(p/900.0) - 0.5) * step(1.0, uNoiseAmp);
  flatF = 1.0; float base = uBase; float wsum = 0.0;
  for (int i = 0; i < 4; i++) { vec4 A = uApt[i]; if (A.z > 1.0) { float d = length(p - A.xy);
    float fl = clamp((d - A.z) / 1800.0, 0.0, 1.0); fl = fl * fl * (3.0 - 2.0 * fl); flatF = min(flatF, fl);
    float wb = clamp((d - A.z) / (A.z * 1.5 + 6000.0), 0.0, 1.0); wb = 1.0 - wb * wb * (3.0 - 2.0 * wb); base = mix(base, A.w, wb * (1.0 - wsum)); wsum = max(wsum, wb); } }
  float hills = m.b * ${HILL_SCALE.toFixed(1)};
  float land = base + (hills + max(rough, -base + 2.0)) * flatF - 0.15 * (1.0 - flatF);
  float coast = smoothstep(0.08, 0.5, m.r);
  land = mix(land, min(land, 1.2), coast * flatF);
  return mix(land, -0.2, smoothstep(0.47, 0.53, m.r) * step(0.42, m.r));
}
`;

const TERRAIN_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
${TERRAIN_COMMON}
uniform vec2 uCenter; varying vec3 vW; varying vec3 vN; varying float vFlat;
void main(){
  vec2 p = position.xz + uCenter;
  float f; vec4 m = masksL(p); float h = terrainH(p, m, f);
  float e = max(20.0, length(position.xz) * 0.02);
  float f2; float hx = terrainH(p + vec2(e, 0.0), masksL(p + vec2(e, 0.0)), f2);
  float hz = terrainH(p + vec2(0.0, e), masksL(p + vec2(0.0, e)), f2);
  vN = normalize(vec3(h - hx, e, h - hz));
  vW = vec3(p.x, h, p.y); vFlat = f;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
  #include <logdepthbuf_vertex>
}`;

const TERRAIN_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
${TERRAIN_COMMON}
${ATM_GLSL}
uniform vec3 uSunCol; uniform vec3 uAmbCol; uniform float uNight; uniform float uTime; uniform float uWet;
uniform vec3 cGrass; uniform vec3 cDry; uniform vec3 cDark; uniform vec3 cSoil; uniform vec3 cShallow; uniform float uFields;
varying vec3 vW; varying vec3 vN; varying float vFlat;
vec4 masksF(vec2 p){
  vec2 un = (p - uNearR.xy)/uNearR.z + 0.5; vec2 uw = (p - uWideR.xy)/uWideR.z + 0.5;
  vec4 mw = texture2D(uWide, uw);
  float e = 1.0 - clamp((max(abs(un.x-0.5), abs(un.y-0.5)) - 0.45)/0.05, 0.0, 1.0);
  return e <= 0.0 ? mw : mix(mw, texture2D(uNear, un), e);
}
void main(){
  vec2 p = vW.xz; vec3 rel = vW - cameraPosition; float dist = length(rel); vec3 vd = rel/dist;
  vec4 m = masksF(p);
  float n1 = fbm5(p / 2200.0), n2 = vnoise(p / 140.0), n3 = vnoise(p / 31.0);
  float wv = m.r + (n2 - 0.5) * 0.10 + (n1 - 0.5)*0.06;
  float water = smoothstep(0.49, 0.53, wv) * step(0.42, m.r);
  float marsh = smoothstep(0.30, 0.42, m.r) * (1.0 - water);
  vec3 N = normalize(vN);
  // ---- land albedo ----
  vec3 col = mix(cGrass, cDry, smoothstep(0.35, 0.75, n1));
  col = mix(col, cDark, smoothstep(0.52, 0.72, fbm5(p/900.0 + 7.0)) * 0.85);
  // field patchwork
  vec2 q = mat2(0.94, 0.34, -0.34, 0.94) * p; vec2 cell = floor(q / vec2(420.0, 300.0)); float hc = h12(cell);
  vec3 fieldC = hc < 0.3 ? cDry * 1.08 : hc < 0.55 ? cGrass * 1.15 : hc < 0.75 ? cSoil : cDark * 1.2;
  vec2 fq = fract(q / vec2(420.0, 300.0)); float edge = smoothstep(0.0, 0.02, min(min(fq.x, 1.0-fq.x), min(fq.y, 1.0-fq.y)));
  float fieldsW = uFields * smoothstep(0.35, 0.6, vnoise(p/5000.0 + 3.0)) * (1.0 - m.g);
  col = mix(col, fieldC * mix(0.8, 1.0, edge), fieldsW);
  col *= 0.88 + 0.24 * n3;
  // rock on steep slopes and high ground
  col = mix(col, cSoil * 0.9 + 0.05, smoothstep(0.88, 0.72, N.y));
  col = mix(col, vec3(0.42, 0.40, 0.38), smoothstep(1400.0, 2600.0, vW.y));
  col = mix(col, vec3(0.92), smoothstep(3000.0, 3300.0, vW.y + n2 * 200.0));
  // airport grass
  float apt = 1.0 - vFlat;
  vec3 aptGrass = mix(cGrass, cDry, 0.25 + 0.35 * n2) * (1.0 + 0.035 * sin(p.x * 0.05) + 0.08 * (n3 - 0.5)) + 0.01;
  col = mix(col, aptGrass, apt * 0.85);
  // urban fabric: blocks, roofs and streets
  float urb = smoothstep(0.08, 0.5, m.g + (n2 - 0.5)*0.2) * (1.0 - apt);
  vec2 bq = mat2(0.97, 0.24, -0.24, 0.97) * p; vec2 bc = floor(bq / 110.0); vec2 bf = fract(bq / 110.0);
  float street = 1.0 - smoothstep(0.035, 0.06, min(min(bf.x, 1.0-bf.x), min(bf.y, 1.0-bf.y)));
  vec2 lot = floor(bq / 22.0); float hl = h12(lot + bc*0.37);
  vec3 roof = mix(vec3(0.34, 0.33, 0.32), vec3(0.46, 0.42, 0.37), hl) * (0.88 + 0.22*h12(lot*1.7));
  float trees = smoothstep(0.45, 0.75, vnoise(p / 70.0) * 0.6 + fbm5(p / 400.0) * 0.6);
  roof = mix(roof, cDark * 1.1, trees * 0.75);
  float blockTone = 0.85 + 0.3 * h12(bc * 0.71);
  vec3 urbanC = mix(roof * blockTone, vec3(0.17, 0.17, 0.18), street * 0.9);
  col = mix(col, urbanC, urb);
  col = mix(col, mix(cDark * 0.7, vec3(0.05, 0.09, 0.08), n2), marsh);
  col *= 1.0 - uWet * 0.35;
  // ---- lighting ----
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 lit = col * (uSunCol * ndl * 0.95 + uAmbCol * (0.55 + 0.45*N.y) * 1.1);
  // ---- water ----
  if (water > 0.001) {
    vec2 wp = p * 0.06; float t = uTime;
    float e = 0.6;
    float w0 = vnoise(wp + vec2(t*0.35, t*0.22)) + 0.5*vnoise(wp*2.7 - vec2(t*0.5, -t*0.31));
    float wx = vnoise(wp + vec2(e,0) + vec2(t*0.35, t*0.22)) + 0.5*vnoise((wp+vec2(e,0))*2.7 - vec2(t*0.5, -t*0.31));
    float wz = vnoise(wp + vec2(0,e) + vec2(t*0.35, t*0.22)) + 0.5*vnoise((wp+vec2(0,e))*2.7 - vec2(t*0.5, -t*0.31));
    float amp = 0.45 / (1.0 + dist / 700.0);
    vec3 wn = normalize(vec3((w0 - wx)*amp, 1.0, (w0 - wz)*amp));
    vec3 R = reflect(vd, wn); R.y = max(abs(R.y), 0.06);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-vd, wn), 0.0), 5.0);
    fres = min(fres, 0.38);
    vec3 sky = atmSky(normalize(R)) * mix(0.5, 0.75, smoothstep(0.05, 0.5, uSunDir.y));
    float shallow = 1.0 - smoothstep(0.53, 0.8, m.r);
    vec3 deep = mix(vec3(0.006, 0.026, 0.05), cShallow * 0.5, shallow);
    vec3 body = deep * (uSunCol * max(uSunDir.y, 0.0) * 0.6 + uAmbCol * 0.9);
    float near = 1.0 - smoothstep(1500.0, 12000.0, dist);
    float sd = max(dot(R, uSunDir), 0.0);
    float spec = pow(sd, 900.0) * 24.0 * near + pow(sd, mix(160.0, 400.0, near)) * mix(0.45, 0.25, near);
    vec3 wcol = mix(body, sky, fres) + uSunCol * spec * smoothstep(-0.02, 0.05, uSunDir.y);
    lit = mix(lit, wcol, water);
  }
  // ---- night city lights ----
  if (uNight > 0.01 && urb > 0.02) {
    vec2 g = bq / 26.0; vec2 gi = floor(g); vec2 gf = fract(g) - 0.5; float hh = h12(gi + 0.31);
    vec2 off = vec2(h12(gi + 1.7), h12(gi + 4.1)) - 0.5;
    float px = max(fwidth(g.x), 1e-4);
    float pt = smoothstep(0.12 + px, 0.0, length(gf - off*0.6)) * step(hh, 0.55*urb + 0.1);
    float avg = 0.55*urb * 0.08;
    float lightsF = mix(pt, avg, smoothstep(0.08, 0.35, px));
    vec3 lc = mix(vec3(1.0, 0.62, 0.28), vec3(0.95, 0.92, 0.85), step(0.6, hh));
    float st = street * mix(1.0, 0.25, smoothstep(0.1, 0.4, px));
    lit += (lc * lightsF * 3.0 + vec3(1.0, 0.55, 0.22) * st * 0.35 * urb) * uNight;
  }
  lit = atmApply(lit, rel);
  gl_FragColor = vec4(lit, 1.0);
  #include <logdepthbuf_fragment>
}`;

export class Terrain {
  constructor(scene, quality) {
    this.scene = scene; this.quality = quality;
    this.masks = new Masks(quality);
    const N = quality === 'low' ? 160 : quality === 'medium' ? 200 : 256, R = 165000, a = 6.6;
    const g = new THREE.BufferGeometry(); const pos = new Float32Array((N + 1) * (N + 1) * 3); const idx = [];
    const warp = t => R * Math.sinh(a * t) / Math.sinh(a);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const k = (j * (N + 1) + i) * 3; pos[k] = warp(i / N * 2 - 1); pos[k + 1] = 0; pos[k + 2] = warp(j / N * 2 - 1); }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const A = j * (N + 1) + i, B = A + 1, C = A + N + 1, D = C + 1; idx.push(A, C, B, B, C, D); }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
    this.uniforms = {
      ...ATM, uNear: { value: null }, uWide: { value: null }, uNearR: { value: new THREE.Vector4() }, uWideR: { value: new THREE.Vector4() },
      uBase: { value: 0 }, uNoiseAmp: { value: 30 }, uApt: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) }, uAptElev: { value: [0, 0, 0, 0] },
      uCenter: { value: new THREE.Vector2() }, uWet: { value: 0 },
      cGrass: { value: new THREE.Color() }, cDry: { value: new THREE.Color() }, cDark: { value: new THREE.Color() }, cSoil: { value: new THREE.Color() }, cShallow: { value: new THREE.Color() }, uFields: { value: 0.5 },
    };
    this.mat = new THREE.ShaderMaterial({ vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS, uniforms: this.uniforms, extensions: { derivatives: true } });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = -5;
    scene.add(this.mesh);
    this.apts = []; this.base = 0; this.noiseAmp = 30; this._m = [0, 0, 0];
  }
  // airports: [{x, z, r, elev}] in local frame (max 4)
  setup(geo, cx, cz, aptZones, aptObjs, opts) {
    this.geo = geo; this.apts = aptZones.slice(0, 4); this.aptObjs = aptObjs || []; this.base = opts.base; this.noiseAmp = opts.noiseAmp;
    const cl = CLIMATES[opts.climate] || CLIMATES.temperate; const u = this.uniforms;
    u.cGrass.value.setRGB(...cl.grass); u.cDry.value.setRGB(...cl.dry); u.cDark.value.setRGB(...cl.dark); u.cSoil.value.setRGB(...cl.soil); u.cShallow.value.setRGB(...cl.shallow); u.uFields.value = cl.fields;
    this.masks.build(geo, cx, cz, aptObjs, opts.extraCities || []);
    u.uNear.value = this.masks.near.tex; u.uWide.value = this.masks.wide.tex;
    u.uNearR.value.set(cx, cz, this.masks.near.size, 0); u.uWideR.value.set(cx, cz, this.masks.wide.size, 0);
    u.uBase.value = opts.base; u.uNoiseAmp.value = opts.noiseAmp;
    for (let i = 0; i < 4; i++) { const a = this.apts[i]; u.uApt.value[i].set(a ? a.x : 0, a ? a.z : 0, a ? a.r : 0, a ? a.elev : 0); }
    this.center = null;
  }
  update(camPos) {
    const c = this.uniforms.uCenter.value;
    if (!this.center || Math.hypot(camPos.x - c.x, camPos.z - c.y) > 1500) { c.set(Math.round(camPos.x / 100) * 100, Math.round(camPos.z / 100) * 100); this.center = true; }
  }
  // JS twin of terrainH: ground height (m MSL) and water flag
  heightAt(x, z) {
    const m = this.masks.sample(x, z, this._m);
    const n = fbm4(x / 6500, z / 6500);
    const rough = this.noiseAmp * (n - 0.38) * 2 + (this.noiseAmp >= 1 ? 18 * (vnoise(x / 900, z / 900) - 0.5) : 0);
    let flatF = 1, base = this.base, wsum = 0;
    for (const a of this.apts) { const d = Math.hypot(x - a.x, z - a.z); flatF = Math.min(flatF, THREE.MathUtils.smoothstep(d, a.r, a.r + 1800));
      const wb = 1 - THREE.MathUtils.smoothstep(d, a.r, a.r * 2.5 + 6000); base = base + (a.elev - base) * wb * (1 - wsum); wsum = Math.max(wsum, wb); }
    let land = base + (m[2] * HILL_SCALE + Math.max(rough, -base + 2)) * flatF - 0.15 * (1 - flatF);
    const coast = THREE.MathUtils.smoothstep(m[0], 0.08, 0.5); land = land + (Math.min(land, 1.2) - land) * coast * flatF;
    const w = m[0] >= 0.42 ? THREE.MathUtils.smoothstep(m[0], 0.47, 0.53) : 0;
    return { h: land + (-0.2 - land) * w, water: w > 0.5, urban: m[1] };
  }
}

// ---------------- city blocks & landmarks (approximate) ----------------
export function facadeMaterial(opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.05 });
  m.userData.key = 'fac' + (opts.glass ? 'g' : '');
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = ATM.uNight;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBP; varying vec3 vBN; varying float vInst;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n vBP = (instanceMatrix * vec4(position,1.0)).xyz; vBN = normalize(mat3(instanceMatrix) * normal); vInst = float(gl_InstanceID);\n#else\n vBP = position; vBN = normal; vInst = 0.0;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBP; varying vec3 vBN; varying float vInst; uniform float uNight;\nfloat fh(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }\nfloat winMask = 0.0; vec3 winEmit = vec3(0.0);')
      .replace('#include <color_fragment>', `#include <color_fragment>
      { vec3 n = normalize(vBN); float side = 1.0 - step(0.6, abs(n.y));
        float u = abs(n.x) > 0.5 ? vBP.z : vBP.x; float v = vBP.y;
        float fw = ${opts.glass ? '3.0' : '3.4'}, bw = ${opts.glass ? '2.0' : '3.2'};
        vec2 g = vec2(u / bw, v / fw); vec2 f = fract(g);
        float wm = step(${opts.glass ? '0.04' : '0.18'}, f.x) * step(f.x, ${opts.glass ? '0.96' : '0.82'}) * step(0.22, f.y) * step(f.y, 0.88) * side * step(1.6, v);
        winMask = wm;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.08, 0.11), wm * ${opts.glass ? '0.85' : '0.75'});
        float lit = step(fh(vec3(floor(g), vInst)), ${opts.glass ? '0.55' : '0.38'});
        winEmit = wm * lit * uNight * mix(vec3(1.0, 0.78, 0.5), vec3(0.85, 0.9, 1.0), step(0.7, fh(vec3(floor(g.x), vInst, 3.0)))) * ${opts.glass ? '2.2' : '1.6'};
      }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, winMask);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += winEmit;');
  };
  return atmos(m);
}

export class City {
  constructor(scene, quality) { this.scene = scene; this.quality = quality; this.group = new THREE.Group(); scene.add(this.group); this.lights = null; }
  clear() { this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); this.group.clear(); }
  build(terrain, geo, cx, cz, airportsLocal) {
    this.clear();
    const q = this.quality; const max = { low: 0, medium: 2500, high: 6000, ultra: 11000 }[q] ?? 4000; if (!max) return;
    const near = terrain.masks.near; if (!near) return;
    const cities = near.cities.map(c => ({ x: geo.x(c.lon), z: geo.z(c.lat), r: c.r * 1000, h: c.h, d: c.d }));
    const R = rng(1234), out = [];
    const range = q === 'ultra' ? 17000 : 13000, step0 = 85;
    // [env] keep city blocks off EVERY built airport: runway strip + safety area (150 m each side, 300 m past the ends)
    // and the terminal/apron site, padded by the largest block footprint (not only the 4 nearest airport discs)
    const keepOut = []; for (const a of terrain.aptObjs || []) { const g = a.geom; if (!g) continue; const ox = geo.x(a.lon), oz = geo.z(a.lat); if (Math.hypot(ox - cx, oz - cz) > range + 8000) continue;
      for (const r of g.runways) keepOut.push([ox + r.cx, oz + r.cz, r.dir.x, r.dir.z, r.L / 2 + 300 + 40, r.W / 2 + 150 + 40]);
      if (g.apron) { const ap = g.apron; keepOut.push([ox + ap.x, oz + ap.z, ap.dx, ap.dz, ap.len / 2 + 450, ap.dep / 2 + 650]); } }
    const kept = (x, z) => { for (const k of keepOut) { const dx = x - k[0], dz = z - k[1]; if (Math.abs(dx * k[2] + dz * k[3]) < k[4] && Math.abs(-dx * k[3] + dz * k[2]) < k[5]) return false; } return true; };
    for (let z = cz - range; z < cz + range && out.length < max * 1.4; z += step0) for (let x = cx - range; x < cx + range; x += step0) {
      const jx = x + (R() - 0.5) * step0 * 0.7, jz = z + (R() - 0.5) * step0 * 0.7;
      const m = terrain.masks.sample(jx, jz); if (m[0] > 0.3 || m[1] < 0.18) continue;
      if (R() > m[1] * 1.15) continue;
      if (airportsLocal.some(a => Math.hypot(jx - a.x, jz - a.z) < a.r + 500) || !kept(jx, jz)) continue;
      let hmax = 8, core = 0;
      for (const c of cities) { const d = Math.hypot(jx - c.x, jz - c.z) / c.r; if (d < 1) { const inf = (1 - d) * (1 - d); hmax = Math.max(hmax, c.h * inf); if (c.h > 60) core = Math.max(core, 1 - d); } }
      const tall = core > 0.25 && R() < 0.75;
      const h = tall ? hmax * (0.35 + 0.65 * R()) : Math.min(hmax, 6 + R() * R() * 26);
      const fp = tall ? 22 + R() * 26 : 14 + R() * 26;
      const t = terrain.heightAt(jx, jz); if (t.water) continue;
      out.push([jx, t.h, jz, fp * (0.7 + R() * 0.6), Math.max(5, h), fp, R() * Math.PI, R()]);
    }
    out.sort((a, b) => Math.hypot(a[0] - cx, a[2] - cz) - Math.hypot(b[0] - cx, b[2] - cz));
    const list = out.slice(0, max);
    const geo1 = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    for (const glass of [false, true]) {
      const sel = list.filter(b => glass ? b[4] > 45 : b[4] <= 45); if (!sel.length) continue;
      const mat = facadeMaterial({ glass }); if (glass) { mat.metalness = 0.4; mat.roughness = 0.35; }
      const im = new THREE.InstancedMesh(geo1, mat, sel.length); const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Color();
      sel.forEach((b, i) => {
        Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b[6]); S.set(b[3], b[4], b[5]); P.set(b[0], b[1] - 1, b[2]); M.compose(P, Q, S); im.setMatrixAt(i, M);
        const r = b[7]; glass ? C.setRGB(0.45 + r * 0.2, 0.52 + r * 0.15, 0.6 + r * 0.1) : C.setRGB(0.62 + r * 0.25, 0.58 + r * 0.22, 0.52 + r * 0.2); im.setColorAt(i, C);
      });
      im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false; this.group.add(im);
    }
    this.count = list.length;
    // landmarks (tall towers) with red obstruction lights
    const lmMat = facadeMaterial({ glass: true }); lmMat.color.setRGB(0.7, 0.76, 0.82); lmMat.metalness = 0.5; lmMat.roughness = 0.3;
    const lights = [];
    for (const r of REGIONS) for (const L of r.landmarks) {
      const x = geo.x(L.lon), z = geo.z(L.lat); if (Math.hypot(x - cx, z - cz) > 120000) continue;
      const t = terrain.heightAt(x, z); const grp = new THREE.Group(); grp.position.set(x, t.h, z);
      const segs = L.kind === 'burj' ? 9 : 5;
      for (let i = 0; i < segs; i++) { const f0 = i / segs, w = L.w * (1 - f0 * 0.82), h = L.h * 0.82 / segs; const m = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.42 * (1 - 0.08), w * 0.5, h, L.kind === 'burj' ? 6 : 8), lmMat); m.position.y = f0 * L.h * 0.82 + h / 2; grp.add(m); }
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.6, L.w * 0.08, L.h * 0.18, 6), lmMat); sp.position.y = L.h * 0.91; grp.add(sp);
      this.group.add(grp); lights.push(x, t.h + L.h, z);
    }
    if (lights.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(lights, 3));
      const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: ATM.uTime },
        vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\nuniform float uTime; varying float vB; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; vB = step(0.5, fract(uTime*0.75)); gl_PointSize = clamp(9000.0/-mv.z, 3.0, 14.0);\n#include <logdepthbuf_vertex>\n}`,
        fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\nvarying float vB; void main(){ float a = smoothstep(0.5,0.0,length(gl_PointCoord-0.5)); gl_FragColor = vec4(vec3(1.0,0.1,0.05)*a*vB*6.0, 1.0);\n#include <logdepthbuf_fragment>\n}` });
      const pts = new THREE.Points(g, m); pts.frustumCulled = false; this.group.add(pts);
    }
  }
}

export function genericSurroundings(apt, geo) {
  // Non-featured airports: a plausible town nearby (seeded by ICAO), purely decorative.
  const R = rng(hash32(apt.icao)); const ang = R() * Math.PI * 2, d = 7000 + R() * 9000;
  const lat = apt.lat + Math.cos(ang) * d / 111320, lon = apt.lon + Math.sin(ang) * d / (111320 * Math.cos(apt.lat * D2R));
  return { cities: [{ lat, lon, r: 5 + R() * 5, d: 0.6, h: 30 + R() * 80 }, { lat: (apt.lat + lat) / 2, lon: (apt.lon + lon) / 2, r: 3, d: 0.4, h: 14 }], noiseAmp: 40 + R() * 160, climate: climateFor(apt.lat, apt.lon) };
}
