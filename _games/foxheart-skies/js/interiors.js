// Walkable interiors (built only while on foot): terminal departure/arrival hall, jet bridge, aircraft
// cabin with passengers and crew. Everything static shares ONE canvas material atlas with baked
// (vertex-colour) lighting; seats, benches and people are instanced.
import * as THREE from 'three';
import { atmos } from './sky.js';
import { foxHeart } from './aircraft.js';
import { SHORT } from './atc.js';
import { People } from './people.js';
import { buildHall } from './env-hall.js';

const AT = 2048;
export const ACCENTS = {
  KTPA: { name: 'Tampa', accent: '#1aa6a0', accent2: '#f2a65a', wood: '#c9a27a', floor: '#e6e1d6', plant: 'palm', hello: 'Welcome to Tampa Bay', local: ['Cuban Coffee', 'Bay Books'], lang: null },
  KMIA: { name: 'Miami', accent: '#ff6f8f', accent2: '#29c4c4', wood: '#d6b48c', floor: '#ece6dc', plant: 'palm', hello: 'Bienvenidos a Miami', local: ['Café Cubano', 'Ocean Drive Shop'], lang: 'es' },
  MPTO: { name: 'Panamá', accent: '#e8622c', accent2: '#2f9e5b', wood: '#b9824f', floor: '#efe3d0', plant: 'tropical', hello: 'Bienvenidos a Panamá', local: ['Café Geisha de Boquete', 'Artesanías'], lang: 'es' },
  RKSI: { name: 'Incheon', accent: '#2b6fd6', accent2: '#d6453c', wood: '#d8c3a0', floor: '#e9e9e6', plant: 'pine', hello: '인천에 오신 것을 환영합니다', local: ['카페 Café', '한국 전통 Crafts'], lang: 'ko', lattice: true },
  RKSS: { name: 'Gimpo', accent: '#2b6fd6', accent2: '#d6453c', wood: '#d8c3a0', floor: '#e9e9e6', plant: 'pine', hello: '김포에 오신 것을 환영합니다', local: ['카페 Café', '서울 Gifts'], lang: 'ko', lattice: true },
  RJTT: { name: 'Haneda', accent: '#c9343c', accent2: '#1f2f5c', wood: '#d9c49d', floor: '#ecebe6', plant: 'pine', hello: '東京へようこそ', local: ['喫茶 Café', 'Tokyo Gifts'], lang: 'ja', lattice: true },
  KLAX: { name: 'Los Angeles', accent: '#f0a030', accent2: '#3a7bd5', wood: '#caa57f', floor: '#e8e3da', plant: 'palm', hello: 'Welcome to Los Angeles', local: ['Venice Coffee', 'Hollywood Books'], lang: null },
  KSFO: { name: 'San Francisco', accent: '#d9472b', accent2: '#4a90a4', wood: '#c4a07a', floor: '#e6e3dd', plant: 'cypress', hello: 'Welcome to San Francisco', local: ['Mission Coffee', 'Bay Books'], lang: null },
  KJFK: { name: 'New York', accent: '#3d5afe', accent2: '#f4b400', wood: '#b89070', floor: '#e4e1db', plant: 'tree', hello: 'Welcome to New York', local: ['Brooklyn Roasters', 'Hudson News'], lang: null },
  EGLL: { name: 'London', accent: '#6b3fa0', accent2: '#c8102e', wood: '#b9976f', floor: '#e5e3df', plant: 'tree', hello: 'Welcome to London', local: ['Tea & Coffee', 'Books & Papers'], lang: null },
  OMDB: { name: 'Dubai', accent: '#c99a3b', accent2: '#1b6b5f', wood: '#d6b98a', floor: '#efe8da', plant: 'palm', hello: 'مرحبا بكم في دبي · Welcome to Dubai', local: ['Arabic Coffee', 'Gold Souk'], lang: 'ar' },
  WSSS: { name: 'Singapore', accent: '#9c2f8f', accent2: '#1aa37a', wood: '#c7a57d', floor: '#e9e6df', plant: 'tropical', hello: 'Welcome to Singapore', local: ['Kopi', 'Orchid Garden'], lang: null },
};
const WORDS = { es: ['Salidas · Departures', 'Puerta', 'Llegadas · Arrivals', 'Control de seguridad · Security', 'Reclamo de equipaje · Baggage'], ko: ['출발 Departures', '탑승구 Gate', '도착 Arrivals', '보안검색 Security', '수하물 Baggage'], ja: ['出発 Departures', '搭乗口 Gate', '到着 Arrivals', '保安検査 Security', '手荷物 Baggage'], ar: ['المغادرة · Departures', 'Gate', 'الوصول · Arrivals', 'Security', 'Baggage'] };
const EN = ['Departures', 'Gate', 'Arrivals', 'Security', 'Baggage claim'];

// ---------------------------------------------------------------- atlas
const R = {}; // region name -> [x,y,w,h] px
function region(n, x, y, w, h) { R[n] = [x, y, w, h]; }
region('terrazzo', 0, 0, 256, 256); region('carpet', 256, 0, 256, 256); region('wood', 512, 0, 256, 256); region('white', 768, 0, 256, 256);
region('metal', 1024, 0, 256, 256); region('fabric', 1280, 0, 256, 256); region('leaf', 1536, 0, 256, 256); region('trunk', 1792, 0, 256, 256);
region('glass', 0, 256, 256, 256); region('counter', 256, 256, 256, 256); region('rubber', 512, 256, 256, 256); region('cabcarpet', 768, 256, 256, 256);
region('leather', 1024, 256, 256, 256); region('cabwall', 1280, 256, 256, 256); region('navy', 1536, 256, 256, 256); region('accent', 1792, 256, 256, 256);
region('signDep', 0, 512, 1024, 128); region('signGate', 1024, 512, 512, 128); region('signSec', 1536, 512, 512, 128);
region('shop0', 0, 640, 512, 256); region('shop1', 512, 640, 512, 256); region('shop2', 1024, 640, 512, 256); region('shop3', 1536, 640, 512, 256);
region('signHello', 0, 896, 1024, 128); region('signArr', 1024, 896, 512, 128); region('signBag', 1536, 896, 512, 128);
region('lattice', 0, 1024, 256, 256); region('light', 256, 1024, 256, 256); region('bins', 512, 1024, 256, 256); region('galley', 768, 1024, 256, 256);
region('logo', 1024, 1024, 256, 256); region('gateDesk', 1280, 1024, 512, 128); region('belt', 1280, 1152, 256, 128);
let atlasCache = null;
function buildAtlas(icao, gate, dest) {
  const A = ACCENTS[icao] || { name: '', accent: '#e8732f', accent2: '#2b6fd6', wood: '#c4a07a', floor: '#e6e3dd', plant: 'tree', hello: 'Welcome', local: ['Café', 'Books'] };
  const cv = document.createElement('canvas'); cv.width = cv.height = AT; const c = cv.getContext('2d');
  const tile = (n, f) => { const [x, y, w, h] = R[n]; c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.translate(x, y); f(c, w, h); c.restore(); };
  const noise = (w, h, n, a, col) => { for (let i = 0; i < n; i++) { c.fillStyle = col(Math.random()); c.globalAlpha = a; c.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3); } c.globalAlpha = 1; };
  const W = WORDS[A.lang] || EN;
  tile('terrazzo', (c, w, h) => { c.fillStyle = A.floor; c.fillRect(0, 0, w, h); noise(w, h, 1600, 0.35, r => r < 0.3 ? '#9a948a' : r < 0.6 ? '#ffffff' : r < 0.8 ? A.accent : '#6f6a62'); c.strokeStyle = 'rgba(120,110,100,.35)'; c.lineWidth = 2; c.strokeRect(0, 0, w, h); });
  tile('carpet', (c, w, h) => { c.fillStyle = '#3a4250'; c.fillRect(0, 0, w, h); c.strokeStyle = A.accent; c.globalAlpha = 0.35; c.lineWidth = 3; for (let i = -w; i < w * 2; i += 32) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h, h); c.stroke(); } c.globalAlpha = 1; noise(w, h, 2500, 0.2, () => '#000'); });
  tile('wood', (c, w, h) => { c.fillStyle = A.wood; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 4) { c.fillStyle = `rgba(90,60,30,${0.05 + Math.random() * 0.12})`; c.fillRect(0, y, w, 2); } c.fillStyle = 'rgba(60,40,20,.35)'; for (let y = 0; y < h; y += 64) c.fillRect(0, y, w, 2); });
  tile('white', (c, w, h) => { c.fillStyle = '#f1f0ec'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(0,0,0,.08)'; c.fillRect(0, 0, w, 2); c.fillRect(0, 0, 2, h); });
  tile('metal', (c, w, h) => { const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#c9ced4'); g.addColorStop(1, '#8e959e'); c.fillStyle = g; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 2) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`; c.fillRect(0, y, w, 1); } });
  tile('fabric', (c, w, h) => { c.fillStyle = A.accent2; c.fillRect(0, 0, w, h); noise(w, h, 3000, 0.25, r => r < 0.5 ? '#000' : '#fff'); });
  tile('leaf', (c, w, h) => { c.fillStyle = '#2f6b34'; c.fillRect(0, 0, w, h); for (let i = 0; i < 60; i++) { c.fillStyle = ['#3f8a3f', '#245a2a', '#4e9a48'][i % 3]; c.beginPath(); c.ellipse(Math.random() * w, Math.random() * h, 30, 8, Math.random() * 3, 0, 7); c.fill(); } });
  tile('trunk', (c, w, h) => { c.fillStyle = '#7b5d3f'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 14) { c.fillStyle = 'rgba(40,25,10,.4)'; c.fillRect(0, y, w, 4); } });
  tile('glass', (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2a3a4a'); g.addColorStop(1, '#0f1720'); c.fillStyle = g; c.fillRect(0, 0, w, h); });
  tile('counter', (c, w, h) => { c.fillStyle = '#20283a'; c.fillRect(0, 0, w, h); c.fillStyle = A.accent; c.fillRect(0, h * 0.62, w, 10); foxHeart(c, w / 2, h * 0.32, 44); c.fillStyle = '#fff'; c.font = '700 22px "Saira Condensed", sans-serif'; c.textAlign = 'center'; c.fillText('NICOFOXHEART AIR', w / 2, h * 0.86); });
  tile('rubber', (c, w, h) => { c.fillStyle = '#3b3e44'; c.fillRect(0, 0, w, h); c.fillStyle = '#2c2f34'; for (let x = 0; x < w; x += 16) c.fillRect(x, 0, 6, h); });
  tile('cabcarpet', (c, w, h) => { c.fillStyle = '#2b3448'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(242,154,76,.35)'; for (let x = 0; x < w; x += 40) for (let y = 0; y < h; y += 40) c.fillRect(x + 18, y + 18, 4, 4); });
  tile('leather', (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2b3a5c'); g.addColorStop(1, '#1b2747'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = '#f29a4c'; c.fillRect(0, 10, w, 18); });
  tile('cabwall', (c, w, h) => { c.fillStyle = '#ecebe7'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(0,0,0,.06)'; c.fillRect(0, h - 6, w, 6); });
  tile('navy', (c, w, h) => { c.fillStyle = '#1b2747'; c.fillRect(0, 0, w, h); c.fillStyle = '#f29a4c'; c.fillRect(w * 0.42, 0, w * 0.16, h * 0.4); });
  tile('accent', (c, w, h) => { c.fillStyle = A.accent; c.fillRect(0, 0, w, h); });
  const sign = (n, text, bg, fg, icon) => tile(n, (c, w, h) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = fg; c.font = `600 ${Math.round(h * 0.42)}px "Saira Condensed", "Noto Sans KR", "Noto Sans JP", sans-serif`; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillText(text, h * (icon ? 1.1 : 0.4), h / 2); if (icon) { c.fillStyle = fg; c.font = `${Math.round(h * 0.5)}px sans-serif`; c.fillText(icon, h * 0.25, h / 2); } });
  sign('signDep', W[0], '#151b26', '#ffd34d', '✈'); sign('signGate', `${W[1]} ${gate}  ·  ${dest}`, '#151b26', '#ffffff'); sign('signSec', W[3], '#151b26', '#ffd34d', '⛨');
  sign('signHello', A.hello, A.accent, '#ffffff'); sign('signArr', W[2], '#151b26', '#ffd34d', '✈'); sign('signBag', W[4], '#151b26', '#ffd34d', '⧉');
  const shop = (n, name, col) => tile(n, (c, w, h) => { c.fillStyle = '#2a2420'; c.fillRect(0, 0, w, h); c.fillStyle = col; c.fillRect(0, 0, w, 70); c.fillStyle = '#fff'; c.font = '700 40px "Saira Condensed", "Noto Sans KR", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(name, w / 2, 36);
    const g = c.createLinearGradient(0, 70, 0, h); g.addColorStop(0, '#f6e7cf'); g.addColorStop(1, '#c9a77c'); c.fillStyle = g; c.fillRect(16, 86, w - 32, h - 100); for (let i = 0; i < 18; i++) { c.fillStyle = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad'][i % 5]; c.fillRect(30 + (i % 9) * 50, 100 + Math.floor(i / 9) * 70, 34, 50); } });
  shop('shop0', A.local[0], A.accent); shop('shop1', 'Duty Free', '#1b2747'); shop('shop2', A.local[1], A.accent2); shop('shop3', 'Fox & Friends', '#e8732f');
  tile('lattice', (c, w, h) => { c.fillStyle = A.wood; c.fillRect(0, 0, w, h); c.fillStyle = '#3a2a1c'; for (let i = 0; i < w; i += 32) { c.fillRect(i + 13, 0, 6, h); c.fillRect(0, i + 13, w, 6); } });
  tile('light', (c, w, h) => { c.fillStyle = '#fffaf0'; c.fillRect(0, 0, w, h); });
  tile('bins', (c, w, h) => { c.fillStyle = '#f4f3ef'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(0,0,0,.12)'; for (let x = 0; x < w; x += 64) c.fillRect(x, 0, 3, h); c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(0, h * 0.75, w, 4); });
  tile('galley', (c, w, h) => { c.fillStyle = '#c7cbd1'; c.fillRect(0, 0, w, h); c.strokeStyle = '#8b9199'; c.lineWidth = 3; for (let x = 0; x < w; x += 64) for (let y = 0; y < h; y += 64) c.strokeRect(x + 4, y + 4, 56, 56); });
  tile('logo', (c, w, h) => { c.fillStyle = '#1b2747'; c.fillRect(0, 0, w, h); foxHeart(c, w / 2, h / 2, 90); });
  tile('gateDesk', (c, w, h) => { c.fillStyle = '#0d1420'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffd34d'; c.font = '700 44px "B612 Mono", monospace'; c.textBaseline = 'middle'; c.fillText(`${gate}`, 18, 40); c.fillStyle = '#fff'; c.font = '600 34px "Saira Condensed", sans-serif'; c.fillText(`NF 412  ${dest}`, 130, 40); c.fillStyle = '#55e08f'; c.fillText('BOARDING', 130, 92); });
  tile('belt', (c, w, h) => { c.fillStyle = '#222'; c.fillRect(0, 0, w, h); c.fillStyle = '#333'; for (let x = 0; x < w; x += 20) c.fillRect(x, 0, 10, h); });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, accent: A };
}
let MAT = null;
function atlasMaterial(tex) {
  const m = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aTile; varying vec4 vTile;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvTile = aTile;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vTile;').replace('#include <map_fragment>', 'vec2 tuv = vTile.xy + clamp(fract(vMapUv), 0.004, 0.996) * vTile.zw; vec4 sampledDiffuseColor = texture2D(map, tuv); diffuseColor *= sampledDiffuseColor;');
  };
  m.customProgramCacheKey = () => 'atlas';
  m.userData.key = 'atlas';
  return atmos(m);
}

// ---------------------------------------------------------------- geometry builder with baked light
class Builder {
  constructor(light) { this.P = []; this.N = []; this.U = []; this.C = []; this.T = []; this.I = []; this.light = light; }
  tileOf(n) { const [x, y, w, h] = R[n]; const p = 3; return [(x + p) / AT, 1 - (y + h - p) / AT, (w - 2 * p) / AT, (h - 2 * p) / AT]; }
  quad(a, b, c, d, n, tile, u0, v0, u1, v1, tint = [1, 1, 1], emissive = 0) {
    const base = this.P.length / 3; const T = this.tileOf(tile);
    for (const [p, uv] of [[a, [u0, v0]], [b, [u1, v0]], [c, [u1, v1]], [d, [u0, v1]]]) {
      this.P.push(p.x, p.y, p.z); this.N.push(n.x, n.y, n.z); this.U.push(uv[0], uv[1]); this.T.push(...T);
      const L = emissive ? emissive : this.light(p, n); const c3 = Array.isArray(L) ? L : [L, L, L]; this.C.push(c3[0] * tint[0], c3[1] * tint[1], c3[2] * tint[2]);
    }
    this.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // oriented box: center, size, rotation about Y, per-face tiles, repeat (metres per tile; 0 = stretch)
  box(cx, cy, cz, sx, sy, sz, tile, o = {}) {
    const ry = o.ry || 0, cs = Math.cos(ry), sn = Math.sin(ry); const rep = o.rep ?? 0; const tint = o.tint || [1, 1, 1];
    const V = (x, y, z) => new THREE.Vector3(cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs);
    const Nr = (x, y, z) => new THREE.Vector3(x * cs + z * sn, y, -x * sn + z * cs);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2; const faces = o.faces || 'pxnxpynypznz';
    const uv = (w, h) => rep ? [w / rep, h / rep] : [1, 1];
    const t = f => (o.tiles && o.tiles[f]) || tile; const em = f => (o.emit && o.emit[f]) || 0;
    if (faces.includes('pz')) { const [a, b] = uv(sx, sy); this.quad(V(-hx, -hy, hz), V(hx, -hy, hz), V(hx, hy, hz), V(-hx, hy, hz), Nr(0, 0, 1), t('pz'), 0, 0, a, b, tint, em('pz')); }
    if (faces.includes('nz')) { const [a, b] = uv(sx, sy); this.quad(V(hx, -hy, -hz), V(-hx, -hy, -hz), V(-hx, hy, -hz), V(hx, hy, -hz), Nr(0, 0, -1), t('nz'), 0, 0, a, b, tint, em('nz')); }
    if (faces.includes('px')) { const [a, b] = uv(sz, sy); this.quad(V(hx, -hy, hz), V(hx, -hy, -hz), V(hx, hy, -hz), V(hx, hy, hz), Nr(1, 0, 0), t('px'), 0, 0, a, b, tint, em('px')); }
    if (faces.includes('nx')) { const [a, b] = uv(sz, sy); this.quad(V(-hx, -hy, -hz), V(-hx, -hy, hz), V(-hx, hy, hz), V(-hx, hy, -hz), Nr(-1, 0, 0), t('nx'), 0, 0, a, b, tint, em('nx')); }
    if (faces.includes('py')) { const [a, b] = uv(sx, sz); this.quad(V(-hx, hy, hz), V(hx, hy, hz), V(hx, hy, -hz), V(-hx, hy, -hz), Nr(0, 1, 0), t('py'), 0, 0, a, b, tint, em('py')); }
    if (faces.includes('ny')) { const [a, b] = uv(sx, sz); this.quad(V(-hx, -hy, -hz), V(hx, -hy, -hz), V(hx, -hy, hz), V(-hx, -hy, hz), Nr(0, -1, 0), t('ny'), 0, 0, a, b, tint, em('ny')); }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3)); g.setAttribute('aTile', new THREE.Float32BufferAttribute(this.T, 4));
    g.setIndex(this.I); g.computeBoundingSphere(); return g;
  }
}

// ---------------------------------------------------------------- people (instanced, vertex-coloured)
let peopleGeo = null;
function personGeometry() {
  if (peopleGeo) return peopleGeo;
  const body = new THREE.CylinderGeometry(0.17, 0.21, 0.72, 10).translate(0, 1.12, 0);
  const legs = new THREE.CylinderGeometry(0.16, 0.13, 0.78, 8).translate(0, 0.39, 0);
  const shoulders = new THREE.SphereGeometry(0.2, 10, 6).scale(1.15, 0.5, 0.8).translate(0, 1.46, 0);
  const col = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };
  const merge = (gs) => { let n = 0; for (const g of gs) n += g.attributes.position.count; const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3); let o = 0; for (const g of gs) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); C.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; } const r = new THREE.BufferGeometry(); r.setAttribute('position', new THREE.BufferAttribute(P, 3)); r.setAttribute('normal', new THREE.BufferAttribute(N, 3)); r.setAttribute('color', new THREE.BufferAttribute(C, 3)); return r; };
  const torso = merge([col(body, [1, 1, 1]), col(shoulders, [1, 1, 1]), col(legs, [0.32, 0.34, 0.42])]);
  const head = merge([col(new THREE.SphereGeometry(0.115, 12, 10).translate(0, 1.66, 0), [1, 1, 1])]);
  const hair = merge([col(new THREE.SphereGeometry(0.122, 10, 6, 0, Math.PI * 2, 0, 1.4).translate(0, 1.685, 0.012), [1, 1, 1])]);
  peopleGeo = { torso, head, hair }; return peopleGeo;
}
const SKIN = [[0.96, 0.8, 0.68], [0.86, 0.66, 0.5], [0.66, 0.46, 0.32], [0.45, 0.3, 0.2], [0.92, 0.76, 0.6]];
const CLOTH = [[0.85, 0.3, 0.25], [0.2, 0.35, 0.6], [0.9, 0.9, 0.88], [0.25, 0.25, 0.28], [0.95, 0.65, 0.2], [0.3, 0.55, 0.45], [0.6, 0.35, 0.6], [0.55, 0.7, 0.85], [0.9, 0.5, 0.55]];
const HAIR = [[0.1, 0.08, 0.06], [0.3, 0.2, 0.1], [0.55, 0.4, 0.2], [0.85, 0.75, 0.5], [0.5, 0.5, 0.5]];
export class Crowd {
  constructor(parent, n, rnd) {
    const g = personGeometry(); const mat = atmos(new THREE.MeshBasicMaterial({ vertexColors: true })); mat.userData.key = 'ppl';
    this.mat = mat; this.n = n; this.t = new THREE.InstancedMesh(g.torso, mat, n); this.h = new THREE.InstancedMesh(g.head, mat, n); this.r = new THREE.InstancedMesh(g.hair, mat, n);
    const C = new THREE.Color();
    for (let i = 0; i < n; i++) { C.setRGB(...CLOTH[(rnd() * CLOTH.length) | 0]); this.t.setColorAt(i, C); C.setRGB(...SKIN[(rnd() * SKIN.length) | 0]); this.h.setColorAt(i, C); C.setRGB(...HAIR[(rnd() * HAIR.length) | 0]); this.r.setColorAt(i, C); }
    for (const m of [this.t, this.h, this.r]) { m.frustumCulled = false; parent.add(m); }
    this.M = new THREE.Matrix4(); this.Q = new THREE.Quaternion(); this.S = new THREE.Vector3(1, 1, 1); this.V = new THREE.Vector3(); this.Y = new THREE.Vector3(0, 1, 0);
    this.p = Array.from({ length: n }, () => ({ x: 0, y: -100, z: 0, yaw: 0, seated: false, scale: 1 }));
  }
  setColor(i, rgb) { const C = new THREE.Color(...rgb); this.t.setColorAt(i, C); this.t.instanceColor.needsUpdate = true; }
  commit(t) {
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i]; this.Q.setFromAxisAngle(this.Y, p.yaw); const bob = p.walking ? Math.abs(Math.sin(t * 6 + i)) * 0.04 : 0;
      this.S.set(p.scale, p.seated ? p.scale * 0.72 : p.scale, p.scale); this.V.set(p.x, p.y + bob, p.z); this.M.compose(this.V, this.Q, this.S);
      this.t.setMatrixAt(i, this.M);
      if (p.seated) { this.S.set(p.scale, p.scale, p.scale); this.V.set(p.x, p.y - 0.47 * p.scale, p.z); this.M.compose(this.V, this.Q, this.S); }
      this.h.setMatrixAt(i, this.M); this.r.setMatrixAt(i, this.M);
    }
    this.t.instanceMatrix.needsUpdate = this.h.instanceMatrix.needsUpdate = this.r.instanceMatrix.needsUpdate = true;
  }
  setExposure(k) { this.mat.color.setScalar(k); }
}

// ---------------------------------------------------------------- walk zones (world space)
export class WalkMap {
  constructor() { this.zones = []; this.blocks = []; }
  // rectangle from centre c (Vector3), axis u (unit, horizontal), half-length hl along u, half-width hw; floor y0..y1 along u
  rect(c, u, hl, hw, y0, y1 = y0, tag = '') { this.zones.push({ c: c.clone(), u: u.clone().setY(0).normalize(), hl, hw, y0, y1, tag }); }
  block(c, u, hl, hw) { this.blocks.push({ c: c.clone(), u: u.clone().setY(0).normalize(), hl, hw }); }
  local(z, x, zz) { const dx = x - z.c.x, dz = zz - z.c.z; return [dx * z.u.x + dz * z.u.z, -dx * z.u.z + dz * z.u.x]; }
  floorAt(x, z, prefY) {
    let best = null;
    for (const Z of this.zones) { const [a, b] = this.local(Z, x, z); if (Math.abs(a) <= Z.hl && Math.abs(b) <= Z.hw) { const y = Z.y0 + (Z.y1 - Z.y0) * (a + Z.hl) / (2 * Z.hl); if (best == null || Math.abs(y - prefY) < Math.abs(best.y - prefY)) best = { y, tag: Z.tag }; } }
    if (!best) return null;
    for (const B of this.blocks) { const [a, b] = this.local(B, x, z); if (Math.abs(a) <= B.hl && Math.abs(b) <= B.hw) return null; }
    return best;
  }
}

// frame helper: local (x along, y up, z inward) -> world
function frameFn(O, xAxis, zAxis) { return (x, y, z) => new THREE.Vector3(O.x + xAxis.x * x + zAxis.x * z, O.y + y, O.z + xAxis.z * x + zAxis.z * z); }

// ---------------------------------------------------------------- terminal hall
// opts: { icao, mode: 'dep'|'arr', gate, dest, O (world, façade point at the bridge door, y = apron level), n (unit toward apron/runway), depth, doorX }
export function buildTerminal(opts, rnd) {
  try { return buildHall(opts, rnd); } catch (e) { console.warn('env-hall failed, using the simple hall', e); }
  const { icao, mode, gate, dest } = opts;
  const at = buildAtlas(icao, gate, dest); const mat = atlasMaterial(at.tex); const A = at.accent;
  const F = 4.6, D = Math.max(46, opts.depth - 4), HW = 44; // floor height, depth, half width
  const zAxis = new THREE.Vector3(-opts.n.x, 0, -opts.n.z).normalize(), xAxis = new THREE.Vector3(-zAxis.z, 0, zAxis.x).multiplyScalar(-1);
  // right-handed: x = y × z
  xAxis.set(-zAxis.z, 0, zAxis.x).multiplyScalar(-1); { const yz = new THREE.Vector3(0, 1, 0).cross(zAxis); xAxis.copy(yz); }
  const O = opts.O.clone(); const W = frameFn(O, xAxis, zAxis);
  const group = new THREE.Group(); group.position.copy(O); group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, new THREE.Vector3(0, 1, 0), zAxis));
  const light = (p, n) => { const winK = Math.exp(-Math.max(0, p.z) / 14); const win = winK * 0.34, up = Math.max(0, n.y) * 0.16, low = (Math.abs(n.y) < 0.5 ? -0.16 * Math.exp(-(p.y - F) / 0.6) : 0), sky = Math.max(0, -n.y) * -0.1, corner = -0.08 * Math.exp(-(HW - Math.abs(p.x)) / 3) - 0.06 * Math.exp(-(D - p.z) / 3); const L = 0.72 + win + up + low + sky + corner; return [L * (1.04 - 0.08 * winK), L * (1.0 - 0.01 * winK), L * (0.92 + 0.12 * winK)]; };
  const B = new Builder(light);
  const dx = opts.doorX;
  // floor (terrazzo in halls, carpet at the gate)
  B.box(0, F - 0.15, D / 2, HW * 2, 0.3, D, 'terrazzo', { faces: 'py', rep: 4 });
  B.box(0, F + 0.005, 8.5, HW * 2 - 2, 0.01, 15, 'carpet', { faces: 'py', rep: 3 });
  // façade: low sill, mullions and transom
  B.box(0, F + 0.25, 0.1, HW * 2, 0.5, 0.2, 'metal', { faces: 'pxnxpypz' });
  for (let x = -HW; x <= HW; x += 3) if (Math.abs(x - dx) > 2.2) B.box(x, F + 5.5, 0.05, 0.12, 11, 0.25, 'metal');
  B.box(0, F + 3.2, 0.05, HW * 2, 0.1, 0.22, 'metal'); B.box(0, F + 11, 0.05, HW * 2, 0.25, 0.3, 'metal');
  // side and back walls, ceiling with wooden slats and skylight strips
  B.box(-HW, F + 7, D / 2, 0.4, 14, D, 'white', { faces: 'px', rep: 3 }); B.box(HW, F + 7, D / 2, 0.4, 14, D, 'white', { faces: 'nx', rep: 3 });
  B.box(0, F + 7, D, HW * 2, 14, 0.4, 'white', { faces: 'nz', rep: 3 });
  B.box(0, F + 13.6, D / 2, HW * 2, 0.2, D, 'white', { faces: 'ny', rep: 4 });
  for (let z = 1.5; z < D; z += 1.2) B.box(0, F + 12.6 - Math.sin(z / D * Math.PI) * 0.8, z, HW * 2, 0.35, 0.18, 'wood', { faces: 'nypznz', rep: 3 });
  for (let z = 6; z < D; z += 14) B.box(0, F + 13.4, z, HW * 1.6, 0.05, 1.6, 'light', { faces: 'ny', emit: { ny: 1.6 } });
  // signage
  const sign = (name, x, y, z, w, h, ry = 0) => B.box(x, y, z, w, h, 0.12, 'metal', { ry, tiles: { pz: name }, emit: { pz: 1.25 }, faces: 'pznz' });
  // ---- gate zone ----
  if (mode === 'dep') {
    sign('gateDesk', dx + 7, F + 2.6, 3.2, 3.6, 0.9);
    B.box(dx + 7, F + 0.55, 3.5, 3.2, 1.1, 0.9, 'counter', { tiles: { nz: 'counter' } });
    sign('signGate', dx, F + 3.9, 1.0, 4.4, 1.1);
  } else sign('signArr', dx, F + 3.9, 1.0, 4.4, 1.1);
  // ---- concourse shops ----
  const shopZ = D * 0.42;
  ['shop0', 'shop1', 'shop2', 'shop3'].forEach((n, i) => { const x = -33 + i * 22; if (Math.abs(x - dx) < 2) return; B.box(x, F + 2.5, shopZ + 4, 12, 5, 8, 'white', { tiles: { nz: n }, faces: 'nzpxnxpy', emit: { nz: 1.15 } }); });
  // café tables
  for (let i = 0; i < 6; i++) { const x = -38 + (i % 3) * 4, z = shopZ - 3 + Math.floor(i / 3) * 3.2; B.box(x, F + 0.74, z, 0.9, 0.06, 0.9, 'wood'); B.box(x, F + 0.37, z, 0.12, 0.74, 0.12, 'metal'); }
  // ---- security (dep) or baggage claim (arr) ----
  const secZ = D * 0.62;
  if (mode === 'dep') {
    sign('signSec', 0, F + 4.2, secZ - 3, 6, 1.4);
    for (const x of [-12, -4, 4, 12]) { B.box(x - 1.4, F + 0.45, secZ, 0.7, 0.9, 6, 'belt', { tiles: { py: 'belt' } }); B.box(x + 0.6, F + 1.1, secZ + 1.6, 0.12, 2.2, 0.12, 'metal'); B.box(x + 1.9, F + 1.1, secZ + 1.6, 0.12, 2.2, 0.12, 'metal'); B.box(x + 1.25, F + 2.2, secZ + 1.6, 1.42, 0.14, 0.14, 'metal'); }
  } else {
    sign('signBag', 0, F + 4.2, secZ - 3, 6, 1.4, Math.PI);
    for (const x of [-16, 16]) { B.box(x, F + 0.35, secZ + 2, 14, 0.7, 4, 'metal'); B.box(x, F + 0.72, secZ + 2, 13.4, 0.04, 3.4, 'belt', { faces: 'py' }); }
  }
  // ---- check-in islands (dep) / exit (arr) ----
  const ckZ = D * 0.82;
  if (mode === 'dep') {
    for (const x of [-26, 0, 26]) { B.box(x, F + 0.55, ckZ, 10, 1.1, 1.2, 'counter', { tiles: { nz: 'counter' } }); B.box(x, F + 2.2, ckZ + 1.2, 10, 2.2, 0.3, 'logo', { tiles: { nz: 'logo' }, emit: { nz: 1.1 } }); }
    sign('signDep', 0, F + 6.5, D - 0.4, 12, 1.5, Math.PI);
  } else {
    sign('signHello', 0, F + 6, D - 0.4, 16, 2.0, Math.PI);
  }
  // accents: planters with palms / tropical plants / pines, lattice screens for Korea/Japan
  const planters = [[-36, 5], [-20, 14], [20, 14], [36, 5], [-40, ckZ - 6], [40, ckZ - 6]];
  for (const [x, z] of planters) {
    B.box(x, F + 0.4, z, 1.6, 0.8, 1.6, 'wood');
    if (A.plant === 'palm') { for (let k = 0; k < 5; k++) B.box(x, F + 1.2 + k * 0.9, z, 0.32 - k * 0.03, 0.9, 0.32 - k * 0.03, 'trunk'); for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; B.box(x + Math.cos(a) * 1.3, F + 5.4 - 0.25, z + Math.sin(a) * 1.3, 2.6, 0.06, 0.6, 'leaf', { ry: -a }); } }
    else if (A.plant === 'tropical') { for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; B.box(x + Math.cos(a) * 0.6, F + 1.5 + (k % 3) * 0.4, z + Math.sin(a) * 0.6, 1.4, 0.05, 0.7, 'leaf', { ry: -a }); } }
    else { B.box(x, F + 1.5, z, 0.2, 1.4, 0.2, 'trunk'); B.box(x, F + 2.8, z, 1.4, 1.8, 1.4, 'leaf'); }
  }
  if (A.lattice) for (const x of [-30, -10, 10, 30]) B.box(x, F + 2, shopZ - 8, 6, 4, 0.15, 'lattice', { faces: 'pznz' });
  const mesh = new THREE.Mesh(B.geometry(), mat); mesh.frustumCulled = false; group.add(mesh);
  // light shafts through the façade (additive, faded by the sun from outside)
  const shaftC = document.createElement('canvas'); shaftC.width = 64; shaftC.height = 256; { const c = shaftC.getContext('2d'); const g = c.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, 'rgba(255,240,210,0.9)'); g.addColorStop(1, 'rgba(255,240,210,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 256); const h = c.createLinearGradient(0, 0, 64, 0); h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.25, 'rgba(0,0,0,0)'); h.addColorStop(0.75, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)'); c.globalCompositeOperation = 'destination-out'; c.fillStyle = h; c.fillRect(0, 0, 64, 256); }
  const shaftT = new THREE.CanvasTexture(shaftC); const shaftM = new THREE.MeshBasicMaterial({ map: shaftT, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (let x = -36; x <= 36; x += 9) { const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 15), shaftM); sh.position.set(x + 2, F + 5.2, 5.5); sh.rotation.set(-0.85, 0.15, 0); group.add(sh); }
  const shafts = shaftM;
  // glass façade
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, 11), new THREE.MeshBasicMaterial({ color: 0x9ccbe0, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));
  glass.position.set(0, F + 5.5, 0.04); group.add(glass);
  // benches at the gate (instanced: one bench = 6 seats)
  const bb = new Builder(() => 0.95); for (let k = 0; k < 6; k++) { bb.box(k * 0.62 - 1.55, 0.44, 0, 0.56, 0.08, 0.55, 'fabric'); bb.box(k * 0.62 - 1.55, 0.78, 0.26, 0.56, 0.62, 0.07, 'fabric'); } bb.box(0, 0.2, 0, 3.8, 0.06, 0.4, 'metal');
  const benchPos = []; for (const z of [5.5, 8.6, 11.7]) for (const x of [-34, -27, -20, -13, 13, 20, 27, 34]) if (Math.abs(x - dx) > 5 && Math.abs(x - dx - 7) > 3) benchPos.push([x, z]);
  const benches = new THREE.InstancedMesh(bb.geometry(), mat, benchPos.length); const M = new THREE.Matrix4();
  benchPos.forEach(([x, z], i) => { M.makeTranslation(x, F, z); benches.setMatrixAt(i, M); }); benches.frustumCulled = false; group.add(benches);
  // departures board (own small canvas so it can show live times)
  const board = boardCanvas(opts); const bm = new THREE.Mesh(new THREE.PlaneGeometry(14, 4.2), new THREE.MeshBasicMaterial({ map: board, toneMapped: false })); bm.position.set(0, F + 3.8, D - 0.3); bm.rotation.y = Math.PI; group.add(bm);
  if (mode === 'dep') { const b2 = bm.clone(); b2.position.set(-30, F + 3.6, 18.6); b2.rotation.y = 0; b2.scale.setScalar(0.6); group.add(b2); }
  // ---- people ----
  const NP = 72; const crowd = new People(group, NP, rnd); let k = 0; const walkers = [];
  const ACTS = ['idle', 'phone', 'read', 'talk', 'sleep', 'idle', 'phone'];
  for (const [x, z] of benchPos) for (let sI = 0; sI < 6; sI++) if (rnd() < 0.3 && k < 26) { const p = crowd.p[k++]; Object.assign(p, { x: x + sI * 0.62 - 1.55, y: F, z: z + 0.06, yaw: Math.PI, mode: 'sit', act: ACTS[(rnd() * ACTS.length) | 0], talkSide: rnd() < 0.5 ? 1 : -1, windowSide: 0 }); }
  if (mode === 'dep') { // queues at the check-in islands, facing the counters
    for (const x of [-26, 0, 26]) for (let q = 0; q < 4 && k < NP - 22; q++) { const p = crowd.p[k++]; Object.assign(p, { x: x - 2.5 + (q % 2) * 0.3, y: F, z: ckZ - 1.7 - q * 0.85, yaw: 0, mode: 'stand', act: rnd() < 0.3 ? 'phone' : 'idle', suitcase: rnd() < 0.7 }); }
    for (let q = 0; q < 3; q++) { const p = crowd.p[k++]; Object.assign(p, { x: -3 + q * 1.6, y: F, z: D - 6.5, yaw: 0, mode: 'stand', act: 'board-look', suitcase: q === 1 }); }
  }
  // a family walking together (two kids following a parent)
  const famPath = [[-30, D * 0.88], [0, D * 0.68], [0, 24], [-30, 18], [-30, D * 0.88]];
  for (let f = 0; f < 3 && k < NP - 2; f++) { const p = crowd.p[k++]; if (f > 0) { p.age = 'kid'; p.scale = 0.58 + rnd() * 0.12; p.backpack = true; crowd.paint(p); } Object.assign(p, { x: famPath[0][0] - f * 0.9, y: F, z: famPath[0][1] + f * 0.6, mode: 'walk', path: famPath, seg: 1, speed: 0.95, family: f, suitcase: f === 0 }); walkers.push(p); }
  while (k < NP - 1) { const p = crowd.p[k]; const path = [[-30 + rnd() * 60, D * 0.9], [-20 + rnd() * 40, secZ - 6], [-35 + rnd() * 70, D * 0.3], [-38 + rnd() * 76, 16]]; Object.assign(p, { x: path[0][0], y: F, z: path[0][1], mode: 'walk', path, seg: (rnd() * 4) | 0, speed: 0.9 + rnd() * 0.5, suitcase: rnd() < 0.45 }); walkers.push(p); k++; }
  { const p = crowd.p[NP - 1]; crowd.setCrew(NP - 1); Object.assign(p, { x: dx + 7, y: F, z: 4.6, yaw: Math.PI, mode: mode === 'dep' ? 'stand' : 'stand', act: 'idle' }); if (mode !== 'dep') p.hidden = true; }
  // ---- walk zones (world) ----
  const wm = new WalkMap(); const wc = (x, z) => W(x, 0, z);
  wm.rect(wc(0, D / 2), xAxis, HW - 0.6, D / 2 - 0.8, O.y + F, O.y + F, 'hall');
  const blk = (x, z, hx, hz) => wm.block(wc(x, z), xAxis, hx, hz);
  for (const [x, z] of benchPos) blk(x, z, 1.95, 0.45);
  ['shop0', 'shop1', 'shop2', 'shop3'].forEach((n, i) => { const x = -33 + i * 22; blk(x, shopZ + 4, 6.2, 4.2); });
  if (mode === 'dep') { for (const x of [-12, -4, 4, 12]) blk(x - 1.4, secZ, 0.45, 3.1); for (const x of [-26, 0, 26]) blk(x, ckZ, 5.1, 0.7); blk(dx + 7, 3.5, 1.7, 0.6); } else for (const x of [-16, 16]) blk(x, secZ + 2, 7.1, 2.1);
  for (const [x, z] of planters) blk(x, z, 0.9, 0.9);
  const update = (dt, t, cam) => {
    for (const p of walkers) { const tg = p.path[p.seg]; const ox = p.family ? -p.family * 0.8 : 0; const dxp = tg[0] + ox - p.x, dzp = tg[1] + (p.family ? p.family * 0.5 : 0) - p.z, d = Math.hypot(dxp, dzp); if (d < 0.5) { p.seg = (p.seg + 1) % p.path.length; continue; } p.x += dxp / d * p.speed * dt; p.z += dzp / d * p.speed * dt; p.yaw = Math.atan2(dxp, dzp); }
    crowd.commit(t, cam ? group.worldToLocal(cam.clone()) : null);
  };
  crowd.commit(0);
  const spawn = mode === 'dep' ? { pos: W(13, F, D * 0.92), yaw: 0 } : { pos: W(dx, F, 2.0), yaw: 0 };
  return { group, walk: wm, update, crowd, mat, shafts, spawn, xAxis, zAxis, O, F, D, exitPos: W(0, F, D - 2), world: W, dispose() { group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); at.tex.dispose(); board.dispose(); } };
}
function boardCanvas(o) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 308; const c = cv.getContext('2d');
  c.fillStyle = '#0b0f17'; c.fillRect(0, 0, 1024, 308); c.fillStyle = '#ffd34d'; c.font = '700 30px "B612 Mono", monospace'; c.fillText(o.mode === 'dep' ? 'DEPARTURES' : 'ARRIVALS', 20, 38);
  c.fillStyle = '#8e9bb1'; c.font = '20px "B612 Mono", monospace'; c.fillText('TIME   FLIGHT   ' + (o.mode === 'dep' ? 'DESTINATION' : 'FROM') + '              GATE   STATUS', 20, 72);
  const rows = o.board || []; c.font = '24px "B612 Mono", monospace';
  rows.slice(0, 7).forEach((r, i) => { const y = 106 + i * 30; c.fillStyle = i % 2 ? '#121826' : '#0f1420'; c.fillRect(10, y - 22, 1004, 29); c.fillStyle = '#e8edf5'; c.fillText(r.time, 20, y); c.fillText(r.flight, 110, y); c.fillText(r.city.slice(0, 22), 236, y); c.fillText(String(r.gate), 610, y); c.fillStyle = r.status === 'BOARDING' ? '#55e08f' : r.status === 'DELAYED' ? '#ff5d5d' : r.status === 'LANDED' ? '#66d7ea' : '#ffd34d'; c.fillText(r.status, 700, y); });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- jet bridge: two straight sections, F→R→D (world points)
export function buildBridge(pts, matSrc) {
  const group = new THREE.Group(); const wm = new WalkMap();
  const B = new Builder((p, n) => 0.82 + Math.max(0, n.y) * 0.1);
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]; const u = b.clone().sub(a).setY(0); const L = u.length(); u.normalize(); const c = a.clone().add(b).multiplyScalar(0.5);
    const ry = Math.atan2(u.x, u.z); const slope = Math.atan2(b.y - a.y, L);
    // tunnel built along local z
    const w = 2.6, h = 2.5;
    const add = (x, y, z, sx, sy, sz, tile, o = {}) => B.box(c.x + x * Math.cos(ry) + z * Math.sin(ry), c.y + y + z * Math.tan(slope), c.z - x * Math.sin(ry) + z * Math.cos(ry), sx, sy, sz, tile, { ry, ...o });
    add(0, 0, 0, w, 0.12, L, 'rubber', { rep: 2 });
    add(-w / 2, h / 2, 0, 0.1, h, L, 'cabwall', { rep: 2.5, faces: 'px' }); add(w / 2, h / 2, 0, 0.1, h, L, 'cabwall', { rep: 2.5, faces: 'nx' });
    add(0, h, 0, w, 0.1, L, 'white', { faces: 'ny', rep: 2 });
    for (let z = -L / 2 + 1; z < L / 2; z += 2.5) add(0, h - 0.06, z, 1.2, 0.04, 0.5, 'light', { faces: 'ny', emit: { ny: 1.7 } });
    // outside shell (grey) so it reads as a jet bridge from the apron
    add(0, h / 2, 0, w + 0.3, h + 0.3, L, 'metal', { faces: 'pxnxpy', tint: [0.75, 0.77, 0.8] });
    segs.push({ a, b, c, u, L });
    wm.rect(c, u, L / 2 + 0.6, w / 2 - 0.35, a.y, b.y, 'bridge');
  }
  // rotunda
  const r = pts[1]; B.box(r.x, r.y - 0.06, r.z, 3.4, 0.12, 3.4, 'rubber'); wm.rect(r, new THREE.Vector3(1, 0, 0), 1.6, 1.6, r.y, r.y, 'bridge');
  const geo = B.geometry(); const mesh = new THREE.Mesh(geo, matSrc); mesh.frustumCulled = false; group.add(mesh);
  // legs
  const legM = atmos(new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: 0.6 }));
  for (const p of [pts[0].clone().lerp(pts[1], 0.7), pts[1]]) { const ground = Math.min(pts[0].y, pts[1].y) - 3.2; const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, p.y - ground, 0.5), legM); leg.position.set(p.x, (p.y + ground) / 2, p.z); group.add(leg); }
  return { group, walk: wm, dispose() { geo.dispose(); } };
}

// ---------------------------------------------------------------- cabin (aircraft body frame)
import { buildCabinShell } from './ac-cabin.js';
export const CABIN = { floor: -0.55, door: new THREE.Vector3(-1.98, -0.55, -13.0), seatRows: 29, pitch: 0.79, z0: -10.6, ckFloor: -0.15 };
export function buildCabin(icao, rnd) {
  const group = new THREE.Group(); group.name = 'cabin';
  const fl = CABIN.floor;
  const seats = []; for (let r = 0; r < CABIN.seatRows; r++) for (const x of [-1.38, -0.88, -0.38, 0.38, 0.88, 1.38]) seats.push([x, CABIN.z0 + r * CABIN.pitch]);
  // detailed shell + seats (ac-cabin.js); the simple box cabin below is only a fallback if that build throws
  let shell = null; try { shell = buildCabinShell({ seats, rnd, floor: fl, rows: CABIN.seatRows, pitch: CABIN.pitch, z0: CABIN.z0 }); group.add(shell.group); } catch (e) { console.error('cabin: detailed interior failed, using the simple one', e); shell = null; }
  let at = null, mat = shell ? shell.mat : null;
  if (!shell) { at = buildAtlas(icao, 7, ''); mat = atlasMaterial(at.tex);
  const B = new Builder((p, n) => 0.86 + Math.max(0, n.y) * 0.12 - (Math.abs(n.y) < 0.5 ? 0.1 * Math.exp(-(p.y - fl) / 0.4) : 0));
  const z0 = -14.2, z1 = 12.4, L = z1 - z0, zc = (z0 + z1) / 2;
  B.box(0, fl - 0.05, zc, 3.7, 0.1, L, 'cabcarpet', { faces: 'py', rep: 1.2 });
  B.box(0, 1.55, zc, 2.4, 0.08, L, 'white', { faces: 'ny', rep: 2 });
  for (let z = z0 + 1; z < z1; z += 1.6) B.box(0, 1.5, z, 0.6, 0.03, 1.2, 'light', { faces: 'ny', emit: { ny: 1.5 } });
  // side walls with window gaps (window line ~ y 0.2..0.62), bins above
  for (const s of [-1, 1]) {
    B.box(s * 1.82, fl + 0.37, zc, 0.06, 0.74, L, 'cabwall', { faces: s < 0 ? 'px' : 'nx', rep: 1.5 });
    B.box(s * 1.8, 0.95, zc, 0.06, 0.66, L, 'cabwall', { faces: s < 0 ? 'px' : 'nx', rep: 1.5 });
    for (let z = -11.4 + 0.27; z < 13.2; z += 0.535) if (z > z0 && z < z1) B.box(s * 1.82, 0.41, z, 0.06, 0.44, 0.31, 'cabwall', { faces: s < 0 ? 'px' : 'nx' });
    B.box(s * 1.45, 1.27, zc, 0.75, 0.45, L - 3.4, 'bins', { faces: s < 0 ? 'pxny' : 'nxny', rep: 1.6, tiles: { ny: 'white' } });
  }
  // bulkheads, galley and cockpit door frame
  B.box(0, 0.5, z1, 3.7, 2.2, 0.1, 'galley', { faces: 'nz', rep: 1 });
  B.box(0.95, 0.5, -13.95, 1.6, 2.1, 0.5, 'galley', { faces: 'nzpzpx', rep: 0.8 });
  B.box(1.1, 0.5, -12.05, 1.3, 2.1, 0.1, 'logo', { faces: 'pz', tiles: { pz: 'logo' } });
  B.box(-1.25, 0.5, -14.2, 1.1, 2.2, 0.1, 'cabwall', { faces: 'pz' }); B.box(0.85, 0.5, -14.45, 1.6, 2.2, 0.1, 'cabwall', { faces: 'pz' });
  const mesh = new THREE.Mesh(B.geometry(), mat); mesh.frustumCulled = false; group.add(mesh);
  // seats (instanced): 3+3 rows
  const sb = new Builder(() => 0.95); sb.box(0, 0.4, 0, 0.47, 0.1, 0.46, 'leather', { tiles: { py: 'leather' } }); sb.box(0, 0.85, 0.24, 0.47, 0.8, 0.09, 'leather'); sb.box(0, 0.2, 0, 0.36, 0.4, 0.06, 'metal'); sb.box(-0.24, 0.6, 0.02, 0.04, 0.06, 0.4, 'metal'); sb.box(0, 1.15, 0.29, 0.3, 0.1, 0.02, 'white');
  const seatGeo = sb.geometry(); seatGeo.translate(0, fl, 0);
  const im = new THREE.InstancedMesh(seatGeo, mat, seats.length); const M = new THREE.Matrix4(); seats.forEach(([x, z], i) => { M.makeTranslation(x, 0, z); im.setMatrixAt(i, M); }); im.frustumCulled = false; group.add(im);
  }
  // passengers
  const N = 124; const crowd = new People(group, N, rnd); const free = seats.map((s, i) => i).sort(() => rnd() - 0.5);
  const boarders = []; let k = 0; const ACTS = ['idle', 'window', 'read', 'phone', 'sleep', 'talk', 'idle', 'window'];
  const sitAt = (p, si, act) => { const [x, z] = seats[si]; Object.assign(p, { x, y: fl, z: z + 0.1, yaw: Math.PI, mode: 'sit', act, windowSide: x < 0 ? 1 : -1, talkSide: rnd() < 0.5 ? 1 : -1, backpack: false, suitcase: false, seat: si }); };
  for (; k < 96; k++) { const p = crowd.p[k]; sitAt(p, free[k], Math.abs(seats[free[k]][0]) > 1.3 && rnd() < 0.5 ? 'window' : ACTS[(rnd() * ACTS.length) | 0]); }
  // a parent with a baby on the lap
  { const pp = crowd.p[0]; pp.act = 'baby'; pp.age = 'adult'; const b = crowd.p[k++]; Object.assign(b, { age: 'kid', scale: 0.33, x: pp.x, y: fl + 0.36, z: pp.z - 0.2, yaw: Math.PI, mode: 'sit', act: 'idle', backpack: false }); crowd.paint(b); b.baby = pp; }
  for (; k < N - 2; k++) { const [x, z] = seats[free[k]]; const p = crowd.p[k]; Object.assign(p, { x: -1.4, y: fl, z: -13.0, yaw: 0, mode: 'walk', hidden: true, target: { x, z }, seatIdx: free[k], delay: (k - 97) * 3.4 + 1, state: 'wait', suitcase: rnd() < 0.55, backpack: rnd() < 0.5 }); boarders.push(p); }
  const crew = crowd.p[N - 2]; crowd.setCrew(N - 2); Object.assign(crew, { x: -0.7, y: fl, z: -12.6, yaw: -Math.PI / 2, mode: 'stand', act: 'idle' });
  const crew2 = crowd.p[N - 1]; crowd.setCrew(N - 1); Object.assign(crew2, { x: 0, y: fl, z: 2.0, yaw: Math.PI, mode: 'stand', act: 'idle' });
  // walk zones in body frame (converted when on foot)
  const zones = [
    { x: 0, z: -13.1, hx: 1.7, hz: 0.95, y0: fl, y1: fl, tag: 'entry' },
    { x: 0, z: -0.3, hx: 0.27, hz: 11.75, y0: fl, y1: fl, tag: 'aisle' },
    { x: -2.25, z: -13.0, hx: 0.6, hz: 0.42, y0: fl, y1: fl, tag: 'door' },
    { x: -0.2, z: -14.55, hx: 0.42, hz: 0.45, y0: fl, y1: CABIN.ckFloor, tag: 'ckdoor', alongZ: true },
    { x: -0.05, z: -15.35, hx: 0.85, hz: 0.45, y0: CABIN.ckFloor, y1: CABIN.ckFloor, tag: 'cockpit' },
  ];
  // cabin signs: ceiling-hung boxes over the aisle (lit on both faces) + small PSU icons above every row
  const signMat = { belt: new THREE.MeshBasicMaterial({ map: signTexture('belt') }), smoke: new THREE.MeshBasicMaterial({ map: signTexture('smoke') }) };
  const houseMat = new THREE.MeshBasicMaterial({ color: 0x7d838b }); const sgeo = new THREE.PlaneGeometry(0.2, 0.1), hgeo = new THREE.BoxGeometry(0.46, 0.13, 0.055);
  for (let r = 2; r < CABIN.seatRows; r += 6) { const z = CABIN.z0 + r * CABIN.pitch - 0.38;
    const hb = new THREE.Mesh(hgeo, houseMat); hb.position.set(0, 1.43, z); group.add(hb); const rod = new THREE.Mesh(new THREE.BoxGeometry(0.02, shell ? 0.24 : 0.06, 0.02), houseMat); rod.position.set(0, shell ? 1.58 : 1.5, z); group.add(rod);
    for (const f of [-1, 1]) for (const [k, dx] of [['belt', -0.11], ['smoke', 0.11]]) { const pl = new THREE.Mesh(sgeo, signMat[k]); pl.position.set(dx * f, 1.43, z + f * 0.029); pl.rotation.y = f > 0 ? 0 : Math.PI; group.add(pl); } }
  const psuGeo = new THREE.PlaneGeometry(0.075, 0.038); const psu = {}; const Mp = new THREE.Matrix4(), Qp = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.93, 0, 0)), Sp = new THREE.Vector3(1, 1, 1);
  for (const [k, dx] of [['belt', -0.045], ['smoke', 0.045]]) { const m = new THREE.InstancedMesh(psuGeo, signMat[k], CABIN.seatRows * 2); let i = 0; for (let r = 0; r < CABIN.seatRows; r++) for (const sd of [-1, 1]) { Mp.compose(new THREE.Vector3(sd * 1.17 + dx, 1.035, CABIN.z0 + r * CABIN.pitch - 0.12), Qp, Sp); m.setMatrixAt(i++, Mp); } m.frustumCulled = false; group.add(m); psu[k] = m; }
  const sign = { belt: true, smoke: true, k: 1 };
  const paintSigns = () => { signMat.belt.color.setScalar(sign.belt ? 1.9 * sign.k : 0.09); signMat.smoke.color.setScalar(sign.smoke ? 1.9 * sign.k : 0.09); houseMat.color.setHex(0x7d838b).multiplyScalar(sign.k); };
  paintSigns();
  let boarded = 0, demoT = 0;
  const update = (dt, t, cam) => {
    shell?.mood(false, dt); shell?.setFlight(false);
    for (const p of boarders) {
      if (p.state === 'wait') { p.delay -= dt; if (p.delay < 0) { p.state = 'in'; p.hidden = false; p.y = fl; p.mode = 'walk'; } else { p.y = -100; continue; } }
      if (p.state === 'in') { const tx = 0, tz = -12.4; const d = Math.hypot(tx - p.x, tz - p.z); if (d < 0.15) p.state = 'aisle'; else { p.x += (tx - p.x) / d * 1.0 * dt; p.z += (tz - p.z) / d * 1.0 * dt; p.yaw = Math.atan2(tx - p.x, tz - p.z); } }
      else if (p.state === 'aisle') { const dz = p.target.z + 0.45 - p.z; if (Math.abs(dz) < 0.05) { p.state = (p.suitcase || p.backpack) ? 'lift' : 'side'; p.actT = 0; p.mode = 'stand'; p.yaw = p.target.x < 0 ? -Math.PI / 2 : Math.PI / 2; } else { p.z += Math.sign(dz) * Math.min(Math.abs(dz), 0.95 * dt); p.yaw = 0; } }
      else if (p.state === 'lift') { p.act = 'lift'; p.actT += dt; if (p.actT > 1.6) { p.suitcase = false; p.backpack = false; p.state = 'side'; p.act = 'idle'; } }
      else if (p.state === 'side') { const dx = p.target.x - p.x; p.mode = 'walk'; if (Math.abs(dx) < 0.05) { p.state = 'buckle'; p.mode = 'sit'; p.act = 'buckle'; p.actT = 0; p.x = p.target.x; p.z = p.target.z + 0.1; p.yaw = Math.PI; p.windowSide = p.x < 0 ? 1 : -1; } else { p.x += Math.sign(dx) * Math.min(Math.abs(dx), 0.6 * dt); p.z += (p.target.z + 0.1 - p.z) * Math.min(1, dt * 2); p.yaw = Math.sign(dx) * Math.PI / 2; } }
      else if (p.state === 'buckle') { p.actT += dt; if (p.actT > 2.2) { p.state = 'seated'; p.act = Math.abs(p.x) > 1.3 ? 'window' : ['idle', 'phone', 'read', 'talk'][p.i % 4]; boarded++; } }
    }
    const done = boarded >= boarders.length;
    if (done) { demoT += dt; crew2.act = demoT < 40 ? 'demo' : 'idle'; crew2.yaw = 0; crew2.z = -4.0; }
    for (const p of crowd.p) if (p.baby) { p.x = p.baby.x; p.z = p.baby.z - 0.22; }
    crowd.commit(t, cam ? group.worldToLocal(cam.clone()) : null);
    return done;
  };
  const deplane = () => { let i = 0; for (const p of crowd.p.slice(0, N - 2)) { if (p.baby) { p.hidden = true; continue; } p.state = 'out'; p.mode = 'stand'; p.act = 'idle'; p.y = fl; p.delay = 1 + (i++) * 0.85; } };
  const updateOut = (dt, t, cam) => {
    for (const p of crowd.p.slice(0, N - 2)) { if (p.state !== 'out') continue; p.delay -= dt; if (p.delay > 0) continue; p.mode = 'walk';
      if (Math.abs(p.x) > 0.05 && p.z > -12.3) { p.x -= Math.sign(p.x) * Math.min(Math.abs(p.x), 0.8 * dt); p.yaw = -Math.sign(p.x) * Math.PI / 2; }
      else if (p.z > -12.8) { p.z -= 1.05 * dt; p.yaw = Math.PI; } else { p.x -= 1.0 * dt; p.yaw = -Math.PI / 2; if (p.x < -2.4) { p.state = 'gone'; p.hidden = true; } } }
    crowd.commit(t, cam ? group.worldToLocal(cam.clone()) : null);
  };
  // in-flight life: reactions to the PA, signs and the ride; a few passengers get up when the belt sign is off
  const pax = crowd.p.slice(0, N - 2).filter(p => !p.baby);
  const seatAll = () => { for (const p of boarders) if (p.state !== 'seated') { p.hidden = false; p.state = 'seated'; p.mode = 'sit'; p.suitcase = p.backpack = false; p.x = p.target.x; p.z = p.target.z + 0.1; p.y = fl; p.yaw = Math.PI; p.windowSide = p.x < 0 ? 1 : -1; p.act = Math.abs(p.x) > 1.3 ? 'window' : ['idle', 'phone', 'read', 'talk'][p.i % 4]; } boarded = boarders.length; demoT = 99; crew2.act = 'idle'; };
  const LV = { react: null, reactT: 0, walkers: [], crewT: 0, crewDir: 1 };
  const react = (kind, secs = 7) => { LV.react = kind; LV.reactT = secs; };
  const pickWalkers = () => { if (LV.walkers.length) return; const cand = pax.filter(p => p.act !== 'baby' && p.act !== 'sleep' && Math.abs(p.x) < 1.0); for (let i = 0; i < 4 && cand.length; i++) { const p = cand.splice((rnd() * cand.length) | 0, 1)[0]; LV.walkers.push({ p, st: 'sit', t: 6 + i * 9 + rnd() * 10, hx: p.x, hz: p.z, gx: (rnd() - 0.5) * 0.9, gz: 11.2 + rnd() * 0.6 }); } };
  const walkTo = (p, x, z, sp, dt) => { const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz); if (d < 0.04) return true; const st = Math.min(d, sp * dt); p.x += dx / d * st; p.z += dz / d * st; p.yaw = Math.atan2(dx, dz); return false; };
  const live = (dt, t, cam, st) => { // st: { belt, airborne, comfort, nervous }
    shell?.mood(st.airborne, dt, st.lights); shell?.setFlight(true);
    if (!pax[0].baseAct) for (const p of pax) p.baseAct = p.act;
    LV.reactT -= dt; if (LV.reactT <= 0) LV.react = null;
    for (const p of pax) { if (p.walking) continue; let a = p.baseAct;
      if (LV.react === 'listen' && a !== 'sleep' && (p.seed * 7 % 1) < 0.7) a = 'listen';
      else if (LV.react === 'clap' && (p.seed * 13 % 1) < 0.75 && a !== 'baby') a = 'clap';
      else if (LV.react === 'buckle' && a !== 'sleep' && a !== 'baby' && (p.seed * 5 % 1) < 0.6) a = 'buckle';
      if (st.comfort < 40 && a !== 'baby' && (p.seed * 11 % 1) < (40 - st.comfort) / 40) a = 'grip';
      p.act = a; }
    // stretch-your-legs walkers
    if (st.airborne && !st.belt) pickWalkers();
    for (const w of LV.walkers) { const p = w.p; w.t -= dt;
      if (st.belt && w.st !== 'sit' && w.st !== 'back' && w.st !== 'side') w.st = 'back';
      if (w.st === 'sit') { if (!st.belt && st.airborne && w.t < 0) { w.st = 'out'; p.walking = true; p.mode = 'walk'; p.act = 'idle'; } }
      else if (w.st === 'out') { p.mode = 'walk'; if (walkTo(p, 0, p.z, 0.6, dt)) w.st = 'go'; }
      else if (w.st === 'go') { if (walkTo(p, w.gx, w.gz, 0.8, dt)) { w.st = 'stay'; w.t = 25 + rnd() * 40; p.mode = 'stand'; p.act = rnd() < 0.5 ? 'phone' : 'idle'; p.yaw = -Math.PI / 2 * Math.sign(w.gx || 1); } }
      else if (w.st === 'stay') { if (w.t < 0) w.st = 'back'; }
      else if (w.st === 'back') { p.mode = 'walk'; p.act = 'idle'; if (walkTo(p, 0, w.hz, st.belt ? 1.1 : 0.8, dt)) w.st = 'side'; }
      else if (w.st === 'side') { if (walkTo(p, w.hx, w.hz, 0.6, dt)) { w.st = 'sit'; w.t = 40 + rnd() * 60; p.walking = false; p.mode = 'sit'; p.yaw = Math.PI; p.act = st.belt ? 'buckle' : p.baseAct; } } }
    // cabin crew: compliance walk when the belt sign comes on, a slow service walk in cruise, seated-ish at the front otherwise
    LV.crewT -= dt; crew2.mode = 'walk';
    if (st.airborne && (LV.crewT > 0 || !st.belt)) { const zt = LV.crewDir > 0 ? 10.8 : -11.2; crew2.act = st.belt ? 'idle' : 'carry'; if (walkTo(crew2, 0, zt, st.belt ? 0.75 : 0.45, dt)) { LV.crewDir *= -1; if (st.belt && LV.crewDir > 0) LV.crewT = 0; } }
    else { crew2.act = 'idle'; if (walkTo(crew2, 0.25, -11.4, 0.8, dt)) { crew2.mode = 'stand'; crew2.yaw = Math.PI; } }
    for (const p of crowd.p) if (p.baby) { p.x = p.baby.x; p.z = p.baby.z - 0.22; }
    if (st.visible !== false) crowd.commit(t, cam ? group.worldToLocal(cam.clone()) : null);
  };
  const setSigns = (belt, smoke) => { if (belt && !sign.belt) { react('buckle', 4); LV.crewT = 60; LV.crewDir = 1; } sign.belt = belt; sign.smoke = smoke; paintSigns(); };
  const light = k => { sign.k = k; paintSigns(); shell?.setK(k); };
  crowd.commit(0);
  return { group, zones, update, updateOut, deplane, crowd, mat, boarders, seatsTotal: seats.length, seatAll, live, react, setSigns, light, sign, dispose() { group.traverse(o => { if (o.geometry && true) o.geometry.dispose(); }); at?.tex.dispose(); shell?.dispose(); } };
}
function signTexture(kind) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64; const x = c.getContext('2d');
  x.fillStyle = '#131519'; x.fillRect(0, 0, 128, 64); x.fillStyle = x.strokeStyle = '#f6f2e6'; x.lineWidth = 5; x.lineCap = 'round'; x.lineJoin = 'round';
  if (kind === 'belt') { x.fillRect(10, 28, 36, 8); x.fillRect(82, 28, 36, 8); x.strokeRect(46, 19, 36, 26); x.fillRect(55, 27, 18, 10); }
  else { x.fillRect(34, 29, 44, 8); x.fillStyle = '#ff8b3d'; x.fillRect(78, 29, 10, 8); x.strokeStyle = '#ff5050'; x.lineWidth = 5; x.beginPath(); x.arc(64, 32, 25, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.moveTo(46, 14); x.lineTo(82, 50); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
export function boardRows(dep, featured, mode, destIcao) {
  const out = []; const h0 = 15; let i = 0;
  for (const A of featured) { if (A.icao === dep.icao) continue; const city = (SHORT[A.icao] || A.city) + ' ' + (A.iata || ''); const mine = A.icao === destIcao;
    out.push({ time: String(h0 + Math.floor((i * 35 + 20) / 60)).padStart(2, '0') + ':' + String((i * 35 + 20) % 60).padStart(2, '0'), flight: mine ? 'NF 412' : ['NF', 'KE', 'AA', 'CM', 'JL', 'BA', 'EK', 'SQ', 'UA', 'DL', 'OZ'][i % 11] + ' ' + (100 + i * 37), city, gate: mine ? '7' : String(2 + (i * 3) % 18), status: mine ? (mode === 'dep' ? 'BOARDING' : 'LANDED') : ['ON TIME', 'ON TIME', 'DELAYED', 'GO TO GATE', 'ON TIME'][i % 5] });
    i++; }
  out.sort((a, b) => (b.flight === 'NF 412') - (a.flight === 'NF 412'));
  return out;
}
