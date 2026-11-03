// Airport builder: REAL runway geometry (OurAirports thresholds, widths, displaced thresholds) with
// procedural markings and lights; APPROXIMATE procedural taxiways, apron, terminals, tower, hangars and
// parked aircraft.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ATM, ATM_GLSL, NOISE_GLSL, atmos } from './sky.js';
import { airportGeometry, FT, D2R, ilsFreq } from './data.js';
import { TERMINAL_HINTS } from './surroundings.js';
import { trafficAirliner } from './ac-traffic.js';
import { rng } from './terrain.js';
import { Site, obb, overlap, runwayBox } from './env-site.js';
import { apronMaterial } from './env-apron.js';
import { buildAirportArt, buildBridges } from './env-buildings.js';

const GLYPHS = '0123456789LRC';
let glyphTex = null;
function glyphAtlas() {
  if (glyphTex) return glyphTex;
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 128; const c = cv.getContext('2d');
  c.fillStyle = '#000'; c.fillRect(0, 0, 1024, 128); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let i = 0; i < GLYPHS.length; i++) {
    c.save(); c.translate(i * 64 + 32, 66); c.scale(1, 1.55);
    c.font = '700 74px "Saira Condensed", "Arial Narrow", "Roboto Condensed", Impact, sans-serif'; c.fillText(GLYPHS[i], 0, 0); c.restore();
  }
  glyphTex = new THREE.CanvasTexture(cv); glyphTex.colorSpace = THREE.NoColorSpace; glyphTex.anisotropy = 8; glyphTex.minFilter = THREE.LinearMipmapLinearFilter;
  return glyphTex;
}
function glyphVec(ident) {
  const m = ident.match(/^(\d{1,2})([LRC]?)$/); if (!m) return new THREE.Vector4(-1, -1, -1, 0);
  const d = m[1], L = m[2] ? GLYPHS.indexOf(m[2]) : -1;
  return d.length === 2 ? new THREE.Vector4(+d[0], +d[1], L, 2) : new THREE.Vector4(+d[0], -1, L, 1);
}

const SURF_GLSL = /* glsl */`
${NOISE_GLSL}
float band(float x, float a, float b){ float w = fwidth(x) + 1e-4; float c = clamp(min(x - a, b - x)/w + 0.5, 0.0, 1.0); return min(c, max(b - a, 0.0)/w); }
`;

function runwayMaterial(rwy, wet) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, depthWrite: false });
  const U = {
    uL: { value: rwy.L }, uW: { value: rwy.W }, uD1: { value: rwy.a.disp }, uD2: { value: rwy.b.disp }, uConc: { value: rwy.surface === 'C' ? 1 : 0 },
    uPrec: { value: rwy.L > 1800 && rwy.lit ? 1 : 0 }, uG1: { value: glyphVec(rwy.a.ident) }, uG2: { value: glyphVec(rwy.b.ident) }, uGlyph: { value: glyphAtlas() },
    uWet: wet, uNight: ATM.uNight,
  };
  m.userData.key = 'rwy';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aRw; varying vec2 vRw;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRw = aRw;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uL, uW, uD1, uD2, uConc, uPrec, uWet, uNight; uniform vec4 uG1, uG2; uniform sampler2D uGlyph; varying vec2 vRw;
${SURF_GLSL}
float glyph(float idx, vec2 p){ if (idx < 0.0 || p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 0.0; return smoothstep(0.35, 0.65, texture2D(uGlyph, vec2((idx + 0.08 + p.x*0.84)/16.0, 0.04 + p.y*0.92)).r); }
float ident(vec4 G, float st, float t){
  float m = 0.0; float y0 = 60.0; float gh = 18.0, gw = 6.6, gap = 2.0;
  if (G.w < 0.5) return 0.0;
  if (G.z >= 0.0) { m = max(m, glyph(G.z, vec2((t + gw*0.5)/gw, (st - y0)/gh))); y0 += gh + 6.0; }
  if (G.w > 1.5) { float tw = gw*2.0 + gap; m = max(m, glyph(G.x, vec2((t + tw*0.5)/gw, (st - y0)/gh))); m = max(m, glyph(G.y, vec2((t + tw*0.5 - gw - gap)/gw, (st - y0)/gh))); }
  else m = max(m, glyph(G.x, vec2((t + gw*0.5)/gw, (st - y0)/gh)));
  return m;
}
float endMarks(float s, float t, float disp, vec4 G){
  float hw = uW*0.5, aw = abs(t), st = s - disp, m = 0.0;
  if (disp > 1.0 && s > 0.0 && st < 0.0) { // displaced threshold arrows
    float k = mod(s, 45.0); float shaft = band(k, 6.0, 30.0) * band(aw, -1.0, 0.45);
    float head = band(k, 30.0, 40.0) * step(aw, (40.0 - k) * 0.42);
    m = max(m, max(shaft, head) * 0.95);
    float hd = band(st, -14.0, -4.0) * step(abs(aw - hw*0.5), (-4.0 - st) * 0.45 + 0.2) * step(aw, hw - 2.0); m = max(m, hd);
  }
  if (disp > 1.0) m = max(m, band(st, 0.0, 3.0) * step(aw, hw - 0.8));
  float nk = uW >= 58.0 ? 8.0 : uW >= 44.0 ? 6.0 : uW >= 29.0 ? 4.0 : 3.0;
  float e = hw - 2.5 - aw;
  m = max(m, band(st, 6.0, 51.0) * step(0.0, e) * step(e, nk*3.6 - 1.8) * band(fract(e/3.6), 0.0, 0.5));
  m = max(m, ident(G, st, t));
  if (uPrec > 0.5) {
    m = max(m, band(st, 305.0, 350.0) * band(aw, 10.5, 19.5));
    float tdz = 0.0;
    float b3 = band(aw, 10.5, 12.3) + band(aw, 13.8, 15.6) + band(aw, 17.1, 18.9);
    float b2 = band(aw, 10.5, 12.3) + band(aw, 13.8, 15.6);
    float b1 = band(aw, 10.5, 12.3);
    tdz += band(st, 152.0, 175.0) * b3 + (band(st, 457.0, 480.0) + band(st, 610.0, 633.0)) * b2 + (band(st, 762.0, 785.0) + band(st, 914.0, 937.0)) * b1;
    m = max(m, min(tdz, 1.0) * step(st, uL*0.45));
  }
  return m;
}
`).replace('#include <map_fragment>', `
{
  float t = vRw.x, s = vRw.y, aw = abs(t), hw = uW*0.5;
  float n1 = vnoise(vec2(s, t) * 0.35), n2 = vnoise(vec2(s*0.02, t*0.15)), n3 = vnoise(vec2(s*1.9, t*1.9));
  vec3 base = uConc > 0.5 ? vec3(0.34, 0.335, 0.32) : vec3(0.105, 0.105, 0.11);
  base *= 0.86 + 0.16*n1 + 0.08*n3;
  if (uConc > 0.5) { float j = max(band(fract(s/7.6), 0.0, 0.012), band(fract((t + 50.0)/6.0), 0.0, 0.015)); base *= 1.0 - 0.35*j; }
  // rubber deposits around the touchdown zones
  float sA = s - uD1, sB = (uL - s) - uD2;
  float rub = (smoothstep(120.0, 300.0, sA) * (1.0 - smoothstep(500.0, 1100.0, sA)) + smoothstep(120.0, 300.0, sB) * (1.0 - smoothstep(500.0, 1100.0, sB)));
  rub *= (1.0 - smoothstep(4.0, 11.0, aw)) * (0.55 + 0.45*n2);
  base *= 1.0 - 0.55*rub * (uConc > 0.5 ? 1.2 : 0.7);
  if (aw > hw) base = base * 0.92 + 0.02;
  float paint = 0.0; vec3 pc = vec3(0.86, 0.86, 0.84);
  if (s > 0.0 && s < uL) {
    paint = max(endMarks(s, t, uD1, uG1), endMarks(uL - s, -t, uD2, uG2));
    paint = max(paint, band(aw, hw - 1.4, hw - 0.5) );
    float c0 = uD1 + 112.0, c1 = uL - uD2 - 112.0;
    paint = max(paint, step(c0, s) * step(s, c1) * band(aw, -1.0, 0.46) * band(fract((s - c0)/60.0), 0.0, 0.6));
    paint *= 0.82 + 0.18*n1;
  } else {
    float o = s < 0.0 ? -s : s - uL;
    float chev = band(fract((o + aw*0.9)/30.0), 0.0, 0.12) * step(aw, hw - 1.0) * step(o, 58.0);
    paint = chev; pc = vec3(0.85, 0.66, 0.12);
    base *= 0.9;
  }
  diffuseColor.rgb = mix(base, pc, paint);
  diffuseColor.rgb *= 1.0 - uWet * 0.35;
}`).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.08 + 0.25*vnoise(vRw*0.07), uWet);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uNight * 0.03;');
  };
  return atmos(m);
}

function taxiMaterial(wet, apron, halfDep = 125) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, depthWrite: false });
  m.userData.key = apron ? 'apron' + halfDep : 'taxi';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWet = wet; sh.uniforms.uNight = ATM.uNight;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aTw; varying vec3 vTw;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTw = aTw;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nuniform float uWet, uNight; varying vec3 vTw; float pool = 0.0;\n${SURF_GLSL}`)
      .replace('#include <map_fragment>', apron ? `
{ float t = vTw.x, s = vTw.y; float n = vnoise(vec2(s,t)*0.3), n2 = vnoise(vec2(s,t)*0.02);
  vec3 base = vec3(0.36, 0.355, 0.34) * (0.88 + 0.14*n) * (0.9 + 0.15*n2);
  float j = max(band(fract(s/6.0), 0.0, 0.015), band(fract(t/6.0), 0.0, 0.015)); base *= 1.0 - 0.3*j;
  float st = vTw.z; // stand spacing
  float lead = band(abs(fract(s/st + 0.5) - 0.5)*st, -1.0, 0.2) * step(t, -40.0);
  float lane = band(abs(t + 30.0), -1.0, 0.18);
  float y = max(lead, lane);
  diffuseColor.rgb = mix(base, vec3(0.85, 0.65, 0.12), y * 0.9) * (1.0 - uWet*0.3);
  float pd = length(vec2(abs(mod(s + 80.0, 160.0) - 80.0), t - (${halfDep.toFixed(1)} - 8.0)));
  pool = uNight * smoothstep(55.0, 0.0, pd);
}` : `
{ float t = vTw.x, s = vTw.y, hw = vTw.z; float n = vnoise(vec2(s,t)*0.3);
  vec3 base = vec3(0.13, 0.13, 0.135) * (0.85 + 0.2*n);
  float cl = band(abs(t), -1.0, 0.22);
  float ed = band(abs(t), hw - 1.2, hw - 1.0) + band(abs(t), hw - 0.75, hw - 0.55);
  diffuseColor.rgb = mix(base, vec3(0.85, 0.65, 0.12), min(cl + ed, 1.0) * 0.9) * (1.0 - uWet*0.3);
}`).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.15, uWet);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uNight * ${apron ? '0.25' : '0.03'} * vec3(1.0, 0.85, 0.65) + diffuseColor.rgb * pool * pool * 0.85 * vec3(1.0, 0.82, 0.6);`);
  };
  return atmos(m);
}

// strip geometry along a polyline (local frame) with aTw = (across, along, halfwidth)
function stripGeom(pts, width, y, extra) {
  const P = [], A = [], I = []; let along = 0; const hw = width / 2;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    let dx = q.x - o.x, dz = q.z - o.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    if (i) along += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    const rx = -dz, rz = dx;
    P.push(p.x - rx * hw, y, p.z - rz * hw, p.x + rx * hw, y, p.z + rz * hw);
    A.push(-hw, along, extra ?? hw, hw, along, extra ?? hw);
    if (i) { const b = (i - 1) * 2; I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('aTw', new THREE.Float32BufferAttribute(A, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(P.length).fill(0).map((_, i) => i % 3 === 1 ? 1 : 0), 3)); g.setIndex(I); return g;
}

// ---------------- light points ----------------
class LightSet {
  constructor() { this.p = []; this.c = []; this.c2 = []; this.d = []; this.k = []; }
  add(x, y, z, col, kind = 0, dir = [0, 0, 0], col2 = col, param = 0, size = 1) { this.p.push(x, y, z); this.c.push(...col); this.c2.push(...col2); this.d.push(...dir); this.k.push(kind, param, size); }
  build() {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.c, 3)); g.setAttribute('aCol2', new THREE.Float32BufferAttribute(this.c2, 3));
    g.setAttribute('aDir', new THREE.Float32BufferAttribute(this.d, 3)); g.setAttribute('aKP', new THREE.Float32BufferAttribute(this.k, 3));
    const pts = new THREE.Points(g, lightMaterial()); pts.frustumCulled = false; pts.renderOrder = 9; return pts;
  }
}
let _lightMat = null;
export const LIGHT_U = { uDay: { value: 0 }, uPx: { value: 1 }, uOn: { value: 1 } };
export function lightMaterial() {
  if (_lightMat) return _lightMat;
  _lightMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { ...ATM, ...LIGHT_U },
    vertexShader: /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aCol; attribute vec3 aCol2; attribute vec3 aDir; attribute vec3 aKP; uniform float uTime; uniform float uDay; uniform float uPx; uniform float uOn;
uniform float uHazeK; uniform float uHazeH;
varying vec3 vC;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0); vec4 mv = viewMatrix * wp; gl_Position = projectionMatrix * mv;
  vec3 tc = cameraPosition - wp.xyz; float d = length(tc); tc /= d;
  vec3 wd = length(aDir) > 0.0 ? normalize(mat3(modelMatrix) * aDir) : vec3(0.0);
  float k = aKP.x; vec3 c = aCol; float I = 1.0;
  if (k > 0.5 && k < 1.5) I = smoothstep(-0.15, 0.55, dot(tc, wd));
  else if (k > 1.5 && k < 2.5) { float ang = degrees(asin(clamp(tc.y, -1.0, 1.0))); c = ang > aKP.y ? vec3(1.0, 0.92, 0.85) : vec3(1.0, 0.05, 0.03); I = 1.6 * smoothstep(-0.2, 0.5, dot(tc, wd)); }
  else if (k > 2.5 && k < 3.5) { float ph = fract(uTime * 2.0 - aKP.y * 0.034); I = smoothstep(0.06, 0.0, ph) * 4.0 * smoothstep(-0.15, 0.55, dot(tc, wd)); }
  else if (k > 3.5) { c = dot(tc, wd) >= 0.0 ? aCol : aCol2; }
  float night = 1.0 - uDay;
  float od = uHazeK * d * exp(-max(cameraPosition.y, 0.0)/uHazeH);
  float T = exp(-od * 0.6);
  vC = c * I * aKP.z * T * mix(0.7, 4.0, night) * uOn / (1.0 + d / 6000.0);
  gl_PointSize = clamp(1400.0 * aKP.z / d, 1.6, 16.0) * uPx * mix(0.6, 1.0, night);
  if (I < 0.01) gl_PointSize = 0.0;
  #include <logdepthbuf_vertex>
}`,
    fragmentShader: /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vC;
void main(){ vec2 q = gl_PointCoord - 0.5; float r = dot(q, q) * 4.0; float a = exp(-r * 5.0) + 0.6 * exp(-r * 40.0); gl_FragColor = vec4(vC * a, 1.0);
  #include <logdepthbuf_fragment>
}`,
  });
  return _lightMat;
}

// ---------------- parked-aircraft geometry (shared, merged, vertex-coloured) ----------------
let _parkedGeo = null;
export function parkedAirlinerGeometry() {
  if (_parkedGeo) return _parkedGeo;
  try { return (_parkedGeo = trafficAirliner('high')); } catch (e) { console.warn('ac-traffic airliner failed, using the simple one', e); } // detailed airliner (ac-traffic.js); the simple one below is the fallback
  const parts = [], col = (g, r, gg, b) => { const n = g.attributes.position.count; const c = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.set([r, gg, b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g.index ? g.toNonIndexed() : g; };
  const fus = new THREE.CapsuleGeometry(1.95, 32, 6, 14).rotateX(Math.PI / 2); parts.push(col(fus, 0.93, 0.94, 0.95));
  const wing = new THREE.BufferGeometry(); const wv = [];
  const W = (s) => { const r = [-1.6, -0.7, -4], t = [s * 17, 0.2, 4.6], u = [s * 17, 0.2, 6.3], v = [-1.6, -0.7, 3.2]; return [r, t, u, r, u, v]; };
  for (const s of [1, -1]) for (const p of W(s)) wv.push(...p);
  wing.setAttribute('position', new THREE.Float32BufferAttribute(wv, 3)); wing.computeVertexNormals();
  const wingB = wing.clone(); const pb = wingB.attributes.position; for (let i = 0; i < pb.count; i++) pb.setY(i, pb.getY(i) - 0.25);
  parts.push(col(wing, 0.78, 0.8, 0.83)); parts.push(col(wingB, 0.7, 0.72, 0.74));
  const stab = new THREE.BoxGeometry(12, 0.25, 2.6).translate(0, 0.9, 16.8); parts.push(col(stab, 0.85, 0.86, 0.88));
  for (const s of [1, -1]) { const e = new THREE.CylinderGeometry(1.05, 0.95, 4.2, 12).rotateX(Math.PI / 2).translate(s * 5.8, -1.7, -2.5); parts.push(col(e, 0.85, 0.86, 0.88)); }
  const gear = new THREE.BoxGeometry(5.5, 2.2, 1).translate(0, -2.6, 1.2); parts.push(col(gear, 0.15, 0.15, 0.15));
  const ng = new THREE.BoxGeometry(0.6, 2.2, 0.6).translate(0, -2.6, -12.5); parts.push(col(ng, 0.15, 0.15, 0.15));
  const body = mergeGeometries(parts.map(p => { const q = p.index ? p.toNonIndexed() : p; if (q.attributes.uv) q.deleteAttribute('uv'); return q; }));
  const fin = new THREE.BufferGeometry(); const fv = [0, 1.6, 12.5, 0, 9.5, 17.6, 0, 9.5, 19.6, 0, 1.6, 12.5, 0, 9.5, 19.6, 0, 1.9, 19.0];
  fin.setAttribute('position', new THREE.Float32BufferAttribute(fv, 3)); fin.computeVertexNormals();
  const fin2 = fin.clone(); fin2.index = null; const fp = fin2.attributes.position.array; for (let i = 0; i < fp.length; i += 9) { const t = [fp[i + 3], fp[i + 4], fp[i + 5]]; fp.set([fp[i + 6], fp[i + 7], fp[i + 8]], i + 3); fp.set(t, i + 6); } fin2.computeVertexNormals();
  _parkedGeo = { body, fin: mergeGeometries([fin, fin2]) };
  return _parkedGeo;
}
const LIVERY_TAILS = [[0.85, 0.25, 0.2], [0.1, 0.25, 0.6], [0.95, 0.6, 0.15], [0.2, 0.55, 0.35], [0.55, 0.1, 0.45], [0.1, 0.5, 0.75], [0.9, 0.9, 0.9], [0.15, 0.15, 0.2], [0.95, 0.42, 0.18]];

// ---------------- main builder ----------------
export function buildAirport(apt, opts) {
  const { quality, wet, full, sharedMats } = opts;
  const g = airportGeometry(apt);
  const R = rng((apt.icao.charCodeAt(0) * 7919 + apt.icao.charCodeAt(1) * 104729 + apt.icao.charCodeAt(2) * 31 + (apt.icao.charCodeAt(3) || 0)) >>> 0);
  const group = new THREE.Group(); group.name = apt.icao;
  const lights = new LightSet();
  const W_ = [1, 0.95, 0.85], G_ = [0.15, 1, 0.35], R_ = [1, 0.08, 0.05], Y_ = [1, 0.75, 0.2], B_ = [0.2, 0.35, 1];
  const ilsEnds = [];
  // ---- runways ----
  for (const r of g.runways) {
    const sh = r.W > 40 ? 7.5 : 3, Wt = r.W + sh * 2, L = r.L, ext = 60;
    const rx = -r.dir.z, rz = r.dir.x; // right of le→he
    const P = [], A = [], I = [];
    const nS = Math.max(2, Math.ceil((L + ext * 2) / 150));
    for (let i = 0; i <= nS; i++) {
      const s = -ext + (L + ext * 2) * i / nS;
      for (const t of [-Wt / 2, Wt / 2]) { P.push(r.a.x + r.dir.x * s + rx * t, 0.06, r.a.z + r.dir.z * s + rz * t); A.push(t, s); }
      if (i) { const b = (i - 1) * 2; I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('aRw', new THREE.Float32BufferAttribute(A, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(P.length).fill(0).map((_, i) => i % 3 === 1 ? 1 : 0), 3)); geo.setIndex(I);
    // winding check: make faces point up
    const mesh = new THREE.Mesh(geo, runwayMaterial(r, wet)); mesh.renderOrder = 3; mesh.receiveShadow = true; mesh.frustumCulled = false; group.add(mesh);
    if (!r.lit && r.W < 30) continue;
    const hw = r.W / 2;
    // edge lights (white, yellow caution zone in the last 600 m as seen by the landing pilot)
    for (let s = 0; s <= L + 0.1; s += 60) for (const sd of [-1, 1]) {
      const x = r.a.x + r.dir.x * s + rx * sd * (hw + 1.5), z = r.a.z + r.dir.z * s + rz * sd * (hw + 1.5);
      lights.add(x, 0.4, z, s > L - 600 ? Y_ : W_, 4, [-r.dir.x, 0, -r.dir.z], s < 600 ? Y_ : W_, 0, 0.8);
    }
    // threshold (green) / end (red) bars
    for (const [E, s0] of [[r.a, r.a.disp], [r.b, r.b.disp]]) {
      const d = E.dir, ex = -d.z, ez = d.x;
      const tx = E.x + d.x * s0, tz = E.z + d.z * s0;
      for (let t = -hw; t <= hw + 0.1; t += 3) lights.add(tx + ex * t, 0.35, tz + ez * t, G_, 4, [-d.x, 0, -d.z], R_, 0, 0.9);
      if (s0 > 1) for (let t = -hw; t <= hw + 0.1; t += 3) lights.add(E.x + ex * t, 0.35, E.z + ez * t, R_, 1, [d.x, 0, d.z], R_, 0, 0.8);
    }
    const prec = r.L > 1800 && r.W >= 44;
    if (prec) { // centreline lights
      for (let s = 30; s < L - 29; s += 15) {
        const x = r.a.x + r.dir.x * s, z = r.a.z + r.dir.z * s; const fromA = L - s, fromB = s;
        const cA = fromA < 300 ? R_ : fromA < 900 ? ((s / 15 | 0) % 2 ? R_ : W_) : W_, cB = fromB < 300 ? R_ : fromB < 900 ? ((s / 15 | 0) % 2 ? R_ : W_) : W_;
        lights.add(x, 0.12, z, cA, 4, [-r.dir.x, 0, -r.dir.z], cB, 0, 0.55);
      }
    }
    // ILS ends: approach lights, TDZ lights and PAPI
    for (const E of [r.a, r.b]) {
      if (!(r.L > 1500 && (r.lit || r.W >= 30))) continue;
      const d = E.dir, ex = -d.z, ez = d.x; const tx = E.thrX, tz = E.thrZ; const face = [-d.x, 0, -d.z];
      ilsEnds.push(E);
      if (!prec) continue;
      for (let k = 1; k <= 30; k++) { const s = -30 * k; const bx = tx + d.x * s, bz = tz + d.z * s;
        for (let t = -2; t <= 2; t++) lights.add(bx + ex * t * 1.0, 0.8, bz + ez * t * 1.0, W_, 1, face, W_, 0, 0.9);
        if (k === 10) for (let t = -15; t <= 15; t += 1.5) if (Math.abs(t) > 3) lights.add(bx + ex * t, 0.8, bz + ez * t, W_, 1, face, W_, 0, 0.9);
        if (k >= 10) lights.add(bx, 1.2, bz, [1, 1, 1], 3, face, W_, 30 - k, 1.4);
      }
      for (let s = 30; s <= 900; s += 30) for (const sd of [-1, 1]) for (let j = 0; j < 3; j++) { const t = sd * (9 + j * 1.5); lights.add(tx + d.x * s + ex * t, 0.12, tz + d.z * s + ez * t, W_, 1, face, W_, 0, 0.5); }
      const ps = 320; for (let i = 0; i < 4; i++) { const t = -(hw + 15 + i * 9); lights.add(tx + d.x * ps + ex * t, 1.0, tz + d.z * ps + ez * t, W_, 2, face, W_, 3.5 - i * 0.333, 1.1); }
    }
  }
  // ---- apron / terminal placement (approximate) ----
  const main = [...g.runways].sort((a, b) => b.L - a.L)[0];
  const hint = TERMINAL_HINTS[apt.icao];
  let ax, az, adx, adz;
  if (hint) { ax = g.geo.x(hint.lon); az = g.geo.z(hint.lat); adx = Math.sin(hint.hdg * D2R); adz = -Math.cos(hint.hdg * D2R); }
  else { ax = g.cx * 0.3; az = g.cz * 0.3; adx = main.dir.x; adz = main.dir.z; }
  const nRw = g.runways.length;
  const len = apt.large ? Math.min(1500, 520 + nRw * 230) : 380, dep = apt.large ? 250 : 160;
  // the whole site (apron in front, terminal, curb and car park behind) must clear every runway strip + safety area
  // (exact oriented-box test against the real runway rectangles; 190 m each side keeps the parallel taxiway clear too)
  const rwPlace = g.runways.map(r => runwayBox(r, 190, 300)), back = apt.large ? 175 : 140;
  const clear = (cx, cz, l) => { let qx = -adz, qz = adx; if ((main.cx - cx) * qx + (main.cz - cz) * qz < 0) { qx = -qx; qz = -qz; } const o = obb(cx - qx * back / 2, cz - qz * back / 2, adx, adz, l / 2 + 40, (dep + back) / 2); return !rwPlace.some(r => overlap(o, r)); };
  let L2 = len, placed = false;
  const side0 = Math.sign((ax - main.cx) * -main.dir.z + (az - main.cz) * main.dir.x) || 1;
  for (let shrink = 0; shrink < 4 && !placed; shrink++) { if (shrink) L2 *= 0.75; for (let k = 0; k < 40 && !placed; k++) for (const sd of [side0, -side0]) {
    const off = k * 90 * sd; const cx = ax + -main.dir.z * off, cz = az + main.dir.x * off;
    if (clear(cx, cz, L2)) { ax = cx; az = cz; placed = true; break; }
  } }
  // fallback: spiral out around the airfield, both orientations
  for (let rad = 300; rad < 9000 && !placed; rad += 250) for (let a = 0; a < 32 && !placed; a++) for (const rot of [0, 1]) {
    const cx = g.cx + Math.cos(a / 32 * Math.PI * 2) * rad, cz = g.cz + Math.sin(a / 32 * Math.PI * 2) * rad; if (rot) { const t = adx; adx = -adz; adz = t; }
    if (clear(cx, cz, L2)) { ax = cx; az = cz; placed = true; break; } if (rot) { const t = adx; adx = adz; adz = -t; }
  }
  // normal pointing from apron toward the main runway = "front"
  let nx = -adz, nz = adx; if ((main.cx - ax) * nx + (main.cz - az) * nz < 0) { nx = -nx; nz = -nz; }
  g.apron = { x: ax, z: az, dx: adx, dz: adz, len: L2, dep, nx, nz };
  const stands = [];
  // apron surface
  {
    // extended 6 m to the façade (head-of-stand road); aTw = (t across, t < 0 terminal side; s along; stand spacing)
    const pts = [{ x: ax - adx * L2 / 2 - nx * 3, z: az - adz * L2 / 2 - nz * 3 }, { x: ax + adx * L2 / 2 - nx * 3, z: az + adz * L2 / 2 - nz * 3 }];
    const ag = stripGeom(pts, dep + 6, 0.0, 65);
    const at = ag.attributes.aTw; const sgn = ((-adz) * nx + adx * nz) > 0 ? 1 : -1; for (let i = 0; i < at.count; i++) at.setX(i, at.getX(i) * sgn - 3);
    const k0 = Math.max(1, Math.ceil(0.1 * L2 / 65 - 1e-9)), k1 = Math.ceil(0.9 * L2 / 65 - 1e-9) - 1;
    const am = new THREE.Mesh(ag, apronMaterial(wet, glyphAtlas(), { standT: -(dep / 2 - 45), k0, k1, hand: Math.sign(nz * adx - nx * adz) || 1 })); am.renderOrder = 1; am.receiveShadow = true; am.frustumCulled = false; group.add(am);
  }
  // ---- taxiways (approximate) ----
  const taxis = [], taxiNet = [];
  const tw = apt.large ? 23 : 18; const LETTERS = 'ABCDEFGH', LINKS = ['J', 'K', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'];
  for (const r of g.runways) {
    if (r.W < 25) continue;
    const k = taxiNet.length, net = { k, r, name: LETTERS[k] || 'Z', conns: [], links: [] }; taxiNet.push(net);
    const rx = -r.dir.z, rz = r.dir.x; const sd = Math.sign((ax - r.cx) * rx + (az - r.cz) * rz) || 1;
    const off = r.W / 2 + 165; const P = s => ({ x: r.a.x + r.dir.x * s + rx * sd * off, z: r.a.z + r.dir.z * s + rz * sd * off });
    const E = s => ({ x: r.a.x + r.dir.x * s + rx * sd * (r.W / 2 - 2), z: r.a.z + r.dir.z * s + rz * sd * (r.W / 2 - 2) });
    taxis.push([P(-20), P(r.L + 20)]); net.P = P; net.E = E; net.off = off; net.sd = sd;
    [0, r.L * 0.33, r.L * 0.62, r.L].forEach((s0, i) => { const s = Math.max(0, Math.min(r.L, s0)); taxis.push([E(s), P(s)]); net.conns.push({ name: net.name + (i + 1), s, a: E(s), b: P(s) }); });
    // link to apron
    const vs = Math.max(0, Math.min(r.L, (ax - r.a.x) * r.dir.x + (az - r.a.z) * r.dir.z));
    const p0 = P(vs), dA = Math.hypot(p0.x - ax, p0.z - az);
    if (dA < 4000 && (p0.x - ax) * nx + (p0.z - az) * nz < dep / 2) { // runway behind the terminal: links run round the apron ends, never through the building
      [-1, 1].forEach((sg, j) => { const q = { x: ax + adx * sg * (L2 / 2 + 35), z: az + adz * sg * (L2 / 2 + 35) }; const se = Math.max(0, Math.min(r.L, (q.x - r.a.x) * r.dir.x + (q.z - r.a.z) * r.dir.z)), pe = P(se); taxis.push([pe, q]); net.links.push({ name: LINKS[k * 2 + j] || 'L', s: se, a: pe, b: q }); });
    } else if (dA < 4000) {
      const fx = ax + nx * dep / 2, fz = az + nz * dep / 2;
      const q0 = { x: fx + (p0.x - ax) * 0.1, z: fz + (p0.z - az) * 0.1 }; taxis.push([p0, q0]);
      const s2 = Math.max(0, Math.min(r.L, vs + (vs > r.L / 2 ? -600 : 600))); const p1 = P(s2);
      const q1 = { x: fx + adx * Math.sign(s2 - vs) * L2 * 0.35, z: fz + adz * Math.sign(s2 - vs) * L2 * 0.35 }; taxis.push([p1, q1]);
      net.links.push({ name: LINKS[k * 2] || 'L', s: vs, a: p0, b: q0 }, { name: LINKS[k * 2 + 1] || 'M', s: s2, a: p1, b: q1 });
    }
  }
  { // no approximate taxiway may run through the terminal building (drop the strip and its routing link)
    const TD = apt.large ? 70 : 40, dd = dep / 2 + 6 + TD / 2, tcx = ax - nx * dd, tcz = az - nz * dd;
    const inT = (x, z) => { const dx = x - tcx, dz = z - tcz; return Math.abs(dx * adx + dz * adz) < L2 * 0.42 + 12 && Math.abs(-dx * adz + dz * adx) < TD / 2 + 12; };
    const cut = ([a, b]) => { const L = Math.hypot(b.x - a.x, b.z - a.z) || 1; for (let u = 0; u <= L; u += 4) if (inT(a.x + (b.x - a.x) * u / L, a.z + (b.z - a.z) * u / L)) return true; return false; };
    for (let i = taxis.length - 1; i >= 0; i--) if (cut(taxis[i])) taxis.splice(i, 1);
    for (const net of taxiNet) net.links = net.links.filter(l => !cut([l.a, l.b]));
  }
  const taxiMat = sharedMats?.taxi || taxiMaterial(wet, false);
  for (const t of taxis) {
    const tg = stripGeom(t, tw, 0.03); const m = new THREE.Mesh(tg, taxiMat); m.renderOrder = 2; m.receiveShadow = true; m.frustumCulled = false; group.add(m);
    if (full || quality !== 'low') {
      const [a, b] = t; const l = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / l, uz = (b.z - a.z) / l;
      for (let s = 0; s < l; s += 50) for (const sd of [-1, 1]) lights.add(a.x + ux * s - uz * sd * (tw / 2 + 0.8), 0.3, a.z + uz * s + ux * sd * (tw / 2 + 0.8), B_, 0, [0, 0, 0], B_, 0, 0.45);
      if (full) for (let s = 15; s < l - 10; s += 30) lights.add(a.x + ux * s, 0.12, a.z + uz * s, G_, 0, [0, 0, 0], G_, 0, 0.32);
    }
  }
  // ---- buildings ----
  const along = (s, d) => ({ x: ax + adx * s - nx * d, z: az + adz * s - nz * d }); // d>0 = behind apron (terminal side)
  // exclusion mask: runway strips + safety areas, every taxiway strip, the apron; buildings are shifted to a clear spot or culled
  const site = new Site(g); for (const t of taxis) site.addTaxi(t[0], t[1], tw / 2); site.addApron(obb(ax, az, adx, adz, L2 / 2 + 10, dep / 2));
  // try candidate (s, d) spots in order for a w (along) x dd (across) footprint; returns the world centre or null
  const spot = (cands, w, dd, sets) => { for (const [s0, d0] of cands) { const p = along(s0, d0); if (site.place(p.x, p.z, adx, adz, w / 2, dd / 2, [[0, 0]], sets)) return p; } return null; };
  const termDepth = apt.large ? 70 : 40, termH = apt.large ? 24 : 12;
  // gates & parked aircraft (jet bridges are instanced in env-buildings.js)
  const spacing = 65;
  const parked = [];
  for (let k = 1, i = 0; spacing * k - L2 / 2 < L2 * 0.4; k++) {
    const s = spacing * k - L2 / 2; if (s < -L2 * 0.4) continue; i++;
    const standP = along(s, dep / 2 - 45);
    const st = { x: standP.x, z: standP.z, s, gate: i, outHdg: (Math.atan2(nx, -nz) * 180 / Math.PI + 360) % 360, inHdg: (Math.atan2(-nx, nz) * 180 / Math.PI + 360) % 360, used: false };
    stands.push(st);
    if (full && R() < 0.72 && i % 7 !== 3) { st.used = true; const p = { x: standP.x - nx * 2, z: standP.z - nz * 2, rot: Math.atan2(nx, nz), tail: LIVERY_TAILS[(R() * LIVERY_TAILS.length) | 0], s: apt.large && R() < 0.3 ? 1.35 : 1 }; st.parkS = p.s; parked.push(p); }
  }
  if (full && parked.length) {
    const pg = parkedAirlinerGeometry();
    const bm = sharedMats?.parkBody || atmos(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.15 }));
    const fm = sharedMats?.parkFin || atmos(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide }));
    const ib = new THREE.InstancedMesh(pg.body, bm, parked.length), iF = new THREE.InstancedMesh(pg.fin, fm, parked.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Pv = new THREE.Vector3(), C = new THREE.Color();
    parked.forEach((p, i) => { Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot); S.setScalar(p.s); Pv.set(p.x, 3.6 * p.s, p.z); M.compose(Pv, Q, S); ib.setMatrixAt(i, M); iF.setMatrixAt(i, M); C.setRGB(...p.tail); iF.setColorAt(i, C); });
    ib.castShadow = iF.castShadow = quality === 'ultra'; ib.frustumCulled = iF.frustumCulled = false; group.add(ib, iF);
  }
  // tower and hangar spots through the Site; art in env-buildings.js
  const th = apt.large ? 72 : 32;
  const tp = spot([[L2 * 0.5 + 120, dep / 2 + 40], [L2 * 0.5 + 60, dep / 2 + 110], [-L2 * 0.5 - 120, dep / 2 + 40], [-L2 * 0.5 - 60, dep / 2 + 110], [L2 * 0.5 + 40, dep / 2 + 220], [L2 * 0.32, dep / 2 + termDepth + 75], [-L2 * 0.32, dep / 2 + termDepth + 75], [L2 * 0.32, dep / 2 + termDepth + 160], [-L2 * 0.32, dep / 2 + termDepth + 160]], 30, 28) || along(L2 * 0.3, dep / 2 + 6 + termDepth * 0.6); // fallback: on the terminal roof
  const tBase = site.placed.length && Math.hypot(site.placed[site.placed.length - 1].cx - tp.x, site.placed[site.placed.length - 1].cz - tp.z) < 1 ? 0 : termH;
  const hangarSpots = [];
  if (full) for (let i = 0; i < (apt.large ? 4 : 2); i++) { const s0 = -L2 / 2 - 140 - i * 110, hp = spot([[s0, dep / 2 - 20], [s0, dep / 2 + 90], [s0, dep / 2 + 200], [L2 / 2 + 220 + i * 110, dep / 2 + 60], [L2 / 2 + 220 + i * 110, dep / 2 + 170]], 132, 96); if (hp) hangarSpots.push(hp); }
  const art = { ax, az, adx, adz, nx, nz, dep, L2, termDepth, termH };
  buildAirportArt(group, { apt, g, f: art, along, stands, site, spot, lights, quality, full, R, taxiNet, ilsEnds, towerAt: { p: tp, base: tBase, h: th }, hangarSpots });
  if (full) buildBridges(group, stands, art, along);
  const pts = lights.build(); group.add(pts);
  const towerPos = new THREE.Vector3(tp.x, tBase + th + 2.6, tp.z);
  const frame = { ax, az, adx, adz, nx, nz, dep, L2, termDepth, termH, facadeD: dep / 2 + 6 };
  return { group, stands, towerPos, ilsEnds, geom: g, lightsCount: lights.p.length / 3, taxis, taxiNet, frame, site, placed };
}

// ILS geometry for a runway end in the world frame
export function ilsFor(apt, E, aptPos) {
  const g = airportGeometry(apt);
  const thr = new THREE.Vector3(aptPos.x + E.thrX, g.elev, aptPos.z + E.thrZ);
  const dir = new THREE.Vector3(E.dir.x, 0, E.dir.z);
  const tch = 15, gs = 3;
  const gpip = thr.clone().addScaledVector(dir, tch / Math.tan(gs * D2R));
  const far = new THREE.Vector3(aptPos.x + E.other.x, g.elev, aptPos.z + E.other.z);
  const locAnt = far.clone().addScaledVector(dir, 300);
  const f = ilsFreq(apt, E);
  return { apt, end: E, ident: E.ident, thr, dir, gpip, locAnt, gs, course: E.hdg, elev: g.elev, freq: f.mhz, real: f.real, length: E.length, width: E.width };
}
export function ilsDeviation(ils, pos) {
  const v = pos.clone().sub(ils.locAnt); const along = -(v.x * ils.dir.x + v.z * ils.dir.z); const right = -ils.dir.z, rz = ils.dir.x;
  const cross = v.x * right + v.z * rz;
  const locDeg = Math.atan2(cross, along) * 180 / Math.PI; // + = aircraft right of course (as seen inbound)
  const dg = pos.clone().sub(ils.gpip); const dist = -(dg.x * ils.dir.x + dg.z * ils.dir.z);
  const h = pos.y - ils.elev; const gsAng = Math.atan2(h, Math.max(dist, 1)) * 180 / Math.PI;
  const thrDist = -((pos.x - ils.thr.x) * ils.dir.x + (pos.z - ils.thr.z) * ils.dir.z);
  return { loc: locDeg, locDots: Math.max(-2.5, Math.min(2.5, -locDeg / 1.25)), gsDev: gsAng - ils.gs, gsDots: Math.max(-2.5, Math.min(2.5, (ils.gs - gsAng) / 0.35)), dist, thrDist, cross, along, h, valid: along > 0 && dist > -200 && Math.abs(locDeg) < 35 };
}
