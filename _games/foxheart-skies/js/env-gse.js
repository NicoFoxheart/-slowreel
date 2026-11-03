// Ground support equipment for the turnaround (environment artist). Procedural, unbranded GSE: bevelled cabs with
// glazing, tyres + hubs, hazard tape and decals from one canvas atlas, flashing beacons; catering hi-lift trucks
// (scissor box + sliding front platform + galley trolley), belt loaders (raising boom, scrolling belt), container
// loader (two lifting roller decks), hydrant dispenser (lift platform + hoses), lav and potable-water trucks,
// cleaning van, baggage tug with carts and ULD dollies, towbar pushback tug, GPU, cones and chocks; plus the lit,
// instanced ramp crew (RampCrew), bags and LD3 containers. Every vehicle is ~5 merged meshes sharing 8 materials.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { atmos, ATM } from './sky.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const T = (x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), V(sx, sy, sz));
const PI = Math.PI, H = PI / 2;
const Q = { seg: 2, cs: 16 }; // geometry detail (set by gseMats(quality))

// ---------------------------------------------------------------- decal atlas
const AW = 1024, AH = 512, CELL = {};
let _atlas = null, _beltTex = null;
function atlasTex() {
  if (_atlas) return _atlas;
  const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH; const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, AW, AH);
  const F = (s, w = 700) => `${w} ${s}px "Saira Condensed", "Arial Narrow", "Roboto Condensed", sans-serif`;
  const cell = (n, x, y, w, h, f) => { c.save(); c.translate(x, y); c.beginPath(); c.rect(0, 0, w, h); c.clip(); f(c, w, h); c.restore(); CELL[n] = [(x + 1.5) / AW, 1 - (y + h - 1.5) / AH, (x + w - 1.5) / AW, 1 - (y + 1.5) / AH]; };
  const stripes = (c, w, h, a, b, k) => { c.fillStyle = a; c.fillRect(0, 0, w, h); c.fillStyle = b; for (let x = -h * 2; x < w + h; x += k * 2) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + k, h); c.lineTo(x + k + h, 0); c.lineTo(x + h, 0); c.fill(); } };
  const grime = (c, w, h, n, a) => { for (let i = 0; i < n; i++) { c.fillStyle = `rgba(40,36,30,${Math.random() * a})`; c.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 4, 1 + Math.random() * 2); } };
  const text = (c, s, x, y, size, col, al = 'left', w = 700) => { c.fillStyle = col; c.font = F(size, w); c.textAlign = al; c.textBaseline = 'middle'; c.fillText(s, x, y); };
  cell('white', 0, 0, 32, 32, (c, w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); });
  cell('hazard', 32, 0, 256, 32, (c, w, h) => { stripes(c, w, h, '#f2c200', '#161616', 14); grime(c, w, h, 120, 0.25); });
  cell('hazRW', 288, 0, 256, 32, (c, w, h) => stripes(c, w, h, '#f4f4f4', '#d0201a', 14));
  cell('grille', 544, 0, 128, 64, (c, w, h) => { c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h); c.fillStyle = '#3c4148'; for (let y = 6; y < h - 4; y += 8) c.fillRect(6, y, w - 12, 4); });
  cell('louvre', 672, 0, 128, 64, (c, w, h) => { c.fillStyle = '#c4c8cc'; c.fillRect(0, 0, w, h); for (let y = 4; y < h - 3; y += 6) { c.fillStyle = '#50555c'; c.fillRect(5, y, w - 10, 3); c.fillStyle = '#eef0f2'; c.fillRect(5, y + 3, w - 10, 1); } });
  cell('tread', 800, 0, 128, 64, (c, w, h) => { c.fillStyle = '#8d9298'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 8) for (let x = (y / 8 % 2) * 6; x < w; x += 12) { c.fillStyle = '#c5c9ce'; c.save(); c.translate(x, y); c.rotate(((x + y) / 4 % 2) ? 0.7 : -0.7); c.fillRect(-4, -1, 8, 2); c.restore(); } grime(c, w, h, 200, 0.3); });
  cell('shutter', 928, 0, 96, 128, (c, w, h) => { c.fillStyle = '#d9dcde'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 6) { c.fillStyle = '#9aa0a6'; c.fillRect(0, y, w, 1.5); } c.fillStyle = '#2b2f34'; c.fillRect(w * 0.42, h - 10, w * 0.16, 5); grime(c, w, h, 160, 0.2); });
  cell('catSide', 0, 64, 512, 192, (c, w, h) => { c.fillStyle = '#f2f3f4'; c.fillRect(0, 0, w, h); c.fillStyle = '#1d7f86'; c.fillRect(0, h * 0.7, w, h * 0.14); c.fillStyle = '#18324f'; c.fillRect(0, h * 0.86, w, h * 0.04);
    text(c, 'INFLIGHT CATERING', 24, h * 0.36, 58, '#18324f'); text(c, 'galley services · ramp 24h', 26, h * 0.55, 26, '#5b6670', 'left', 500); c.strokeStyle = 'rgba(0,0,0,.18)'; c.lineWidth = 2; for (const x of [w * 0.33, w * 0.66]) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h * 0.7); c.stroke(); } grime(c, w, h, 300, 0.12); });
  cell('fuel', 512, 64, 256, 112, (c, w, h) => { c.fillStyle = '#f1f2f3'; c.fillRect(0, 0, w, h); c.fillStyle = '#c4161c'; c.fillRect(0, 0, w, 10); c.fillRect(0, h - 10, w, 10); text(c, 'JET A-1', 14, h * 0.42, 52, '#c4161c'); text(c, 'NO SMOKING · NO NAKED LIGHTS', 14, h * 0.76, 17, '#222', 'left', 600);
    c.save(); c.translate(w - 44, h * 0.48); c.rotate(PI / 4); c.fillStyle = '#d4161c'; c.fillRect(-24, -24, 48, 48); c.strokeStyle = '#fff'; c.lineWidth = 2; c.strokeRect(-20, -20, 40, 40); c.restore(); text(c, '3', w - 44, h * 0.5, 26, '#fff', 'center'); });
  cell('water', 768, 64, 256, 64, (c, w, h) => { c.fillStyle = '#f2f4f5'; c.fillRect(0, 0, w, h); c.fillStyle = '#1d5fae'; c.fillRect(0, h * 0.62, w, h * 0.38); text(c, 'POTABLE WATER', 12, h * 0.32, 34, '#1d5fae'); text(c, 'DRINKING WATER ONLY', 12, h * 0.82, 18, '#fff', 'left', 600); });
  cell('lav', 768, 128, 256, 64, (c, w, h) => { c.fillStyle = '#e9ebec'; c.fillRect(0, 0, w, h); c.fillStyle = '#3d4f61'; c.fillRect(0, h * 0.62, w, h * 0.38); text(c, 'LAVATORY SERVICE', 12, h * 0.32, 32, '#3d4f61'); text(c, 'WASTE · DO NOT CONNECT TO WATER', 12, h * 0.82, 15, '#fff', 'left', 600); });
  cell('uld', 512, 176, 256, 160, (c, w, h) => { const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#b9bec4'); g.addColorStop(1, '#a3a9b0'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(0,0,0,.18)'; for (let x = 8; x < w; x += 18) c.fillRect(x, 0, 3, h);
    c.fillStyle = '#2c3440'; c.fillRect(10, 10, w - 20, h * 0.5); c.fillStyle = '#3a4554'; for (let y = 14; y < h * 0.5 + 6; y += 9) c.fillRect(12, y, w - 24, 3); c.fillStyle = '#d0201a'; c.fillRect(0, h * 0.66, w, 8);
    text(c, 'AKE 20417 FH', w / 2, h * 0.83, 30, '#1b1f24', 'center'); grime(c, w, h, 300, 0.2); });
  cell('canvas', 0, 256, 256, 128, (c, w, h) => { c.fillStyle = '#24344d'; c.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 24) { const g = c.createLinearGradient(x, 0, x + 24, 0); g.addColorStop(0, 'rgba(0,0,0,.25)'); g.addColorStop(0.5, 'rgba(255,255,255,.07)'); g.addColorStop(1, 'rgba(0,0,0,.25)'); c.fillStyle = g; c.fillRect(x, 0, 24, h); } c.fillStyle = '#d7dadd'; c.fillRect(0, h * 0.8, w, 7); grime(c, w, h, 300, 0.2); });
  cell('ramp', 256, 256, 256, 64, (c, w, h) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h); c.fillStyle = '#e36b1c'; c.beginPath(); c.moveTo(10, 50); c.lineTo(30, 14); c.lineTo(42, 14); c.lineTo(22, 50); c.fill(); c.beginPath(); c.moveTo(28, 50); c.lineTo(48, 14); c.lineTo(60, 14); c.lineTo(40, 50); c.fill(); text(c, 'RAMP SERVICES', 70, h * 0.52, 34, '#1f2a36'); });
  cell('gpuP', 256, 320, 256, 64, (c, w, h) => { c.fillStyle = '#2a2f36'; c.fillRect(0, 0, w, h); text(c, '400 Hz · 90 kVA', 10, 18, 22, '#e8eaec', 'left', 600); for (let i = 0; i < 3; i++) { c.fillStyle = '#0d0f12'; c.beginPath(); c.arc(30 + i * 40, 44, 12, 0, 7); c.fill(); c.strokeStyle = '#9ed36a'; c.lineWidth = 2; c.beginPath(); c.arc(30 + i * 40, 44, 9, 3.6, 5.2); c.stroke(); } c.fillStyle = '#c4161c'; c.beginPath(); c.arc(w - 30, 40, 13, 0, 7); c.fill(); c.fillStyle = '#5fd35f'; c.fillRect(160, 34, 20, 12); });
  cell('van', 512, 336, 256, 64, (c, w, h) => { c.fillStyle = '#f3f4f5'; c.fillRect(0, 0, w, h); c.fillStyle = '#2a8f5a'; c.fillRect(0, h * 0.7, w, h * 0.12); text(c, 'CABIN CLEANING', 10, h * 0.36, 32, '#20313f'); });
  cell('plate', 768, 192, 128, 32, (c, w, h) => { c.fillStyle = '#f5d000'; c.fillRect(0, 0, w, h); c.strokeStyle = '#111'; c.lineWidth = 2; c.strokeRect(1, 1, w - 2, h - 2); text(c, 'GSE ' + (100 + (Math.random() * 800 | 0)), w / 2, h / 2 + 1, 22, '#111', 'center'); });
  cell('door', 896, 192, 64, 128, (c, w, h) => { c.fillStyle = '#e9ecee'; c.fillRect(0, 0, w, h); c.strokeStyle = '#7d848b'; c.lineWidth = 3; c.strokeRect(3, 3, w - 6, h - 6); c.fillStyle = '#2b3036'; c.fillRect(w - 16, h * 0.5, 8, 14); });
  _atlas = new THREE.CanvasTexture(cv); _atlas.colorSpace = THREE.SRGBColorSpace; _atlas.anisotropy = 8; _atlas.minFilter = THREE.LinearMipmapLinearFilter;
  const bc = document.createElement('canvas'); bc.width = 64; bc.height = 128; const b = bc.getContext('2d'); b.fillStyle = '#1c1d1f'; b.fillRect(0, 0, 64, 128);
  for (let y = 0; y < 128; y += 16) { b.fillStyle = '#34363a'; b.fillRect(0, y, 64, 4); b.fillStyle = '#0e0f10'; b.fillRect(0, y + 4, 64, 1); }
  _beltTex = new THREE.CanvasTexture(bc); _beltTex.wrapS = _beltTex.wrapT = THREE.RepeatWrapping; _beltTex.colorSpace = THREE.SRGBColorSpace;
  return _atlas;
}

// ---------------------------------------------------------------- shared materials
let MATS = null;
export function gseMats(q = 'high') {
  if (MATS) return MATS;
  Q.seg = q === 'low' ? 1 : 2; Q.cs = q === 'low' ? 10 : 16;
  const tex = atlasTex();
  const std = (key, o) => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, ...o }); m.userData.key = key; return atmos(m); };
  const beacon = new THREE.MeshBasicMaterial({ vertexColors: true }); beacon.userData.key = 'gseBeacon';
  beacon.onBeforeCompile = sh => {
    sh.uniforms.uT = ATM.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vPh;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPh = dot(modelMatrix[3].xz, vec2(0.71, 0.37)) + position.x * 3.0;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uT; varying float vPh;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.16 + 3.4 * pow(max(0.0, sin(uT * 7.0 + vPh)), 12.0);');
  };
  const belt = new THREE.MeshStandardMaterial({ map: _beltTex, roughness: 0.8 }); belt.userData.key = 'gseBelt';
  const wand = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.2, 0.25) }); wand.userData.key = 'gseWand';
  MATS = {
    paint: std('gsePaint', { map: tex, roughness: 0.42, metalness: 0.08 }),
    dark: std('gseDark', { roughness: 0.82, metalness: 0.0 }),
    metal: std('gseMetal', { roughness: 0.34, metalness: 0.55 }),
    glass: std('gseGlass', { roughness: 0.06, metalness: 0.4, emissive: 0x0b1118 }),
    lamp: atmos(Object.assign(new THREE.MeshBasicMaterial({ vertexColors: true }), { userData: { key: 'gseLamp' } })),
    beacon: atmos(beacon), belt: atmos(belt), wand: atmos(wand),
    crew: std('gseCrew', { roughness: 0.78, metalness: 0.0 }),
  };
  return MATS;
}

// ---------------------------------------------------------------- geometry kit: merge per material, vertex colour, atlas uv
class Kit {
  constructor() { this.L = {}; }
  add(key, g, m, color = 0xffffff, cell = 'white') {
    if (g.index) g = g.toNonIndexed(); if (m) g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count; if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const U = g.attributes.uv, r = CELL[cell] || CELL.white;
    if (cell === 'white') { const cu = (r[0] + r[2]) / 2, cv = (r[1] + r[3]) / 2; for (let i = 0; i < n; i++) U.setXY(i, cu, cv); }
    else for (let i = 0; i < n; i++) U.setXY(i, r[0] + (r[2] - r[0]) * U.getX(i), r[1] + (r[3] - r[1]) * U.getY(i));
    const c = color instanceof THREE.Color ? color : new THREE.Color(color), C = new Float32Array(n * 3); for (let i = 0; i < n; i++) { C[i * 3] = c.r; C[i * 3 + 1] = c.g; C[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(C, 3)); (this.L[key] ||= []).push(g); return this;
  }
  build(shadowKeys = ['paint', 'dark']) { const grp = new THREE.Group(); for (const k in this.L) { const m = new THREE.Mesh(mergeGeometries(this.L[k]), MATS[k]); m.castShadow = shadowKeys.includes(k); m.name = k; grp.add(m); } this.L = {}; return grp; }
}
const rb = (w, h, d, r = 0.05) => new RoundedBoxGeometry(w, h, d, Q.seg, Math.max(0.002, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)));
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rbt, h, s = Q.cs) => new THREE.CylinderGeometry(rt, rbt, h, s);
const plane = (w, h) => new THREE.PlaneGeometry(w, h);
// side profile [[z, y], ...] extruded across x (width), centred on x = 0
function prof(pts, width, bev = 0.04) {
  const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, width - bev * 2), bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelOffset: -bev, bevelSegments: Q.seg, curveSegments: 4 });
  g.translate(0, 0, bev - width / 2); g.rotateY(-H); return g;
}
// flat polygon [[z, y], ...] on the side plane x (normal pointing +x if sgn > 0)
function sidePoly(pts, x, sgn) { const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(sgn > 0 ? -p[0] : p[0], p[1])))); g.rotateY(sgn > 0 ? H : -H); g.translate(x, 0, 0); return g; }
// bar between two points
function bar(a, b, r, s = 6) { const A = V(...a), B = V(...b), L = A.distanceTo(B); const g = new THREE.CylinderGeometry(r, r, L, s, 1, true); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), B.clone().sub(A).normalize())); g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2); return g; }
function decal(k, cell, w, h, m) { k.add('paint', plane(w, h), m, 0xffffff, cell); }
function wheel(k, x, y, z, r, w, hub = 0xb4b9bf) {
  const ri = r * 0.6, sd = Math.sign(x) || 1;
  k.add('dark', new THREE.TorusGeometry((r + ri) / 2, (r - ri) / 2, Q.seg * 3 + 2, Q.cs + 6).scale(1, 1, w / (r - ri)).rotateY(H), T(x, y, z), 0x202224);
  k.add('metal', cyl(ri * 1.02, ri * 1.02, w * 0.72).rotateZ(H), T(x, y, z), hub);
  k.add('metal', cyl(r * 0.24, r * 0.3, 0.06, 10).rotateZ(H), T(x + sd * w * 0.38, y, z), 0x8a9096);
  k.add('dark', cyl(ri * 0.95, ri * 0.95, 0.02).rotateZ(H), T(x - sd * w * 0.37, y, z), 0x111214);
}
function beacon(k, x, y, z) { k.add('dark', cyl(0.09, 0.1, 0.05, 10), T(x, y + 0.025, z), 0x222222); k.add('beacon', new THREE.SphereGeometry(0.085, 10, 6, 0, PI * 2, 0, H * 1.1).scale(1, 1.4, 1), T(x, y + 0.05, z), new THREE.Color(1.6, 0.62, 0.05)); }
function lamp(k, x, y, z, w, h, col, face = 0) { k.add('lamp', plane(w, h), T(x, y, z, face), col); }
// truck cab: z0 = front face, raked windscreen, side glass, grille, bumper with hazard tape, lamps, mirrors
function cab(k, o) {
  const { z0, len, w, y0, h, rake = 0.3, col = 0xeef0f1, back = true } = o; const yb = y0 + h * 0.44, yt = y0 + h;
  k.add('paint', prof([[z0, y0], [z0 + len, y0], [z0 + len, yt], [z0 + rake + 0.1, yt], [z0 + 0.03, yb]], w, 0.07), null, col);
  // windscreen
  const dz = rake + 0.07, dy = yt - yb, L = Math.hypot(dz, dy), nz = -dy / L, ny = dz / L, al = Math.atan2(-ny, nz);
  k.add('glass', plane(w - 0.2, L - 0.16), T(0, (yb + yt) / 2 + ny * 0.012, z0 + 0.03 + dz / 2 + nz * 0.012, 0, al), 0x2a3640);
  k.add('dark', box(0.04, 0.03, L * 0.8), T(0.25, yb + dy * 0.12 + 0.03, z0 + dz * 0.12 - 0.01, 0, -Math.atan2(dy, dz) + PI / 2 - H, 0), 0x111111);
  for (const s of [-1, 1]) {
    k.add('glass', sidePoly([[z0 + 0.12 + rake * 0.2, yb + 0.1], [z0 + len - 0.14, yb + 0.1], [z0 + len - 0.14, yt - 0.1], [z0 + rake + 0.2, yt - 0.1]], s * (w / 2 + 0.006), s), null, 0x2a3640);
    k.add('dark', box(0.012, h * 0.5, 0.025), T(s * (w / 2 + 0.006), y0 + h * 0.3, z0 + len * 0.82), 0x30353a); // door seam
    k.add('metal', box(0.03, 0.03, 0.16), T(s * (w / 2 + 0.02), yb - 0.08, z0 + len * 0.7), 0x9aa0a6); // handle
    k.add('dark', bar([s * (w / 2), yt - 0.2, z0 + 0.25], [s * (w / 2 + 0.28), yt - 0.25, z0 + 0.1], 0.015), null, 0x1b1d20);
    k.add('dark', rb(0.06, 0.32, 0.18, 0.02), T(s * (w / 2 + 0.3), yt - 0.38, z0 + 0.1), 0x1b1d20); // mirror
    lamp(k, s * (w / 2 - 0.28), y0 + 0.22, z0 - 0.005, 0.26, 0.12, new THREE.Color(2.2, 2.1, 1.9), PI); // headlights
    lamp(k, s * (w / 2 - 0.08), y0 + 0.22, z0 - 0.005, 0.1, 0.12, new THREE.Color(1.6, 0.7, 0.1), PI);
  }
  decal(k, 'grille', w * 0.5, 0.26, T(0, y0 + 0.2, z0 - 0.006, PI));
  k.add('dark', rb(w + 0.08, 0.2, 0.22, 0.04), T(0, y0 - 0.06, z0 + 0.02), 0x1d1f22); decal(k, 'hazard', w, 0.14, T(0, y0 - 0.06, z0 - 0.095, PI));
  decal(k, 'plate', 0.42, 0.11, T(0, y0 - 0.06, z0 - 0.1, PI));
  if (back) k.add('dark', box(w * 0.9, 0.04, 0.02), T(0, yt - 0.02, z0 + len - 0.02), 0x2a2d31);
}
function rails(k, x, y, z0, z1, hgt, col = 0xe8b416, posts = 3) {
  k.add('paint', bar([x, y + hgt, z0], [x, y + hgt, z1], 0.025), null, col); k.add('paint', bar([x, y + hgt * 0.5, z0], [x, y + hgt * 0.5, z1], 0.018), null, col);
  for (let i = 0; i < posts; i++) { const z = z0 + (z1 - z0) * i / (posts - 1); k.add('paint', bar([x, y, z], [x, y + hgt, z], 0.022), null, col); }
}
function scissor(len, half, sgn) { const k = new Kit(); for (const s of [-1, 1]) k.add('metal', rb(0.09, 0.13, len, 0.02), T(s * half, 0, 0), 0x5d646b); k.add('metal', cyl(0.04, 0.04, half * 2 + 0.1, 8).rotateZ(H), null, 0x777e85); const g = k.build([]); g.userData.sgn = sgn; return g; }
function setScissor(arms, gap, len) { const th = Math.asin(THREE.MathUtils.clamp((gap - 0.1) / len, 0, 1)); for (const a of arms) a.rotation.x = a.userData.sgn * th; }
function chassisWheels(k, zs, x, r, w) { for (const z of zs) for (const s of [-1, 1]) wheel(k, s * x, r, z, r, w); }

const WHITE = 0xeef0f1, YEL = 0xe5ae12, GREY = 0x7d848b, DGREY = 0x3c4148;

// ---------------------------------------------------------------- vehicles (face -z, ground y = 0). front = local z of the docking contact
function cateringTruck() {
  const k = new Kit(), yR = 1.42;
  k.add('dark', rb(1.0, 0.3, 7.6, 0.04), T(0, 0.75, 0.2), 0x1f2124);
  chassisWheels(k, [-3.0, 2.7], 1.0, 0.48, 0.32);
  for (const z of [-3.0, 2.7]) for (const s of [-1, 1]) k.add('paint', rb(0.44, 0.08, 1.2, 0.03), T(s * 1.02, 1.02, z), GREY);
  for (const s of [-1, 1]) { k.add('paint', rb(0.06, 0.34, 4.2, 0.02), T(s * 1.16, 0.8, 0.0), GREY); decal(k, 'hazard', 3.9, 0.12, T(s * 1.195, 0.74, 0.0, s * H)); k.add('dark', cyl(0.28, 0.28, 0.9, 12).rotateX(H), T(s * 0.75, 0.62, -0.9), 0x2a2d31); }
  k.add('dark', rb(2.3, 0.24, 0.2, 0.04), T(0, 0.62, 4.15), 0x1d1f22); decal(k, 'hazRW', 2.2, 0.18, T(0, 0.62, 4.256));
  for (const s of [-1, 1]) lamp(k, s * 0.95, 0.78, 4.13, 0.22, 0.12, new THREE.Color(1.8, 0.1, 0.06));
  cab(k, { z0: -4.5, len: 1.75, w: 2.32, y0: 0.88, h: 1.6, rake: 0.34 }); beacon(k, -0.6, 2.48, -3.4);
  k.add('paint', rb(2.0, 0.2, 6.0, 0.03), T(0, 1.18, 1.05), GREY); // scissor base frame
  const obj = new THREE.Group(); obj.add(k.build());
  const arms = [scissor(5.0, 0.86, 1), scissor(5.0, 0.86, -1)]; arms.forEach(a => { a.position.set(0, 0, 1.05); obj.add(a); });
  // insulated box with the front door, side decals, rear roller shutter, marker lamps, roof beacon
  const kb = new Kit(), bw = 2.44, bh = 2.5, bl = 6.1, bz = 1.05;
  kb.add('paint', rb(bw, bh, bl, 0.08), T(0, bh / 2 + 0.02, bz), WHITE);
  for (const s of [-1, 1]) { decal(kb, 'catSide', bl - 0.5, 1.82, T(s * (bw / 2 + 0.004), 1.4, bz, s * H)); for (const z of [bz - bl / 2 + 0.1, bz + bl / 2 - 0.1]) lamp(kb, s * (bw / 2 + 0.005), bh - 0.1, z, 0.08, 0.05, new THREE.Color(1.8, 0.8, 0.1), s * H); }
  decal(kb, 'shutter', 2.0, 2.25, T(0, 1.2, bz + bl / 2 + 0.004)); decal(kb, 'door', 1.0, 2.0, T(0, 1.1, bz - bl / 2 - 0.004, PI));
  kb.add('dark', box(bw * 0.97, 0.16, bl), T(0, -0.06, bz), 0x25282c); beacon(kb, 0.8, bh + 0.02, bz - bl / 2 + 0.4);
  const boxG = kb.build(); boxG.position.y = yR; obj.add(boxG);
  // sliding front platform (child of the box): tread deck, rails, rubber bumper
  const kp = new Kit(); kp.add('metal', box(2.2, 0.1, 2.3), T(0, -0.05, 0), 0x9aa0a6); decal(kp, 'tread', 2.1, 2.2, T(0, 0.002, 0, 0, -H));
  for (const s of [-1, 1]) rails(kp, s * 1.05, 0, -1.1, 1.1, 1.1, YEL);
  kp.add('dark', rb(2.2, 0.16, 0.12, 0.04), T(0, -0.02, -1.18), 0x151515); decal(kp, 'hazard', 2.1, 0.1, T(0, -0.1, -1.0, 0, 0));
  const plat = kp.build([]); plat.position.z = bz - bl / 2 + 1.12; boxG.add(plat);
  const kt = new Kit(); kt.add('metal', rb(0.32, 1.03, 0.8, 0.02), T(0, 0.52, 0), 0xc9ced3); kt.add('dark', box(0.3, 0.02, 0.7), T(0, 0.02, 0), 0x222222); const trolley = kt.build([]); trolley.position.set(0.3, 0, -2.0 + 0.6); trolley.visible = false; boxG.add(trolley);
  return { obj, type: 'cat', arms, boxG, plat, trolley, yR, platZ0: plat.position.z, front: -4.8, len: 9.2 };
}
function poseCatering(v, k, h, t) { // k: 0 stowed .. 1 deployed; h: target box floor height
  const lift = Math.max(2.62, h) - v.yR, a = THREE.MathUtils.smoothstep(k, 0, 0.6), b = THREE.MathUtils.smoothstep(k, 0.62, 1);
  v.boxG.position.y = v.yR + lift * a; setScissor(v.arms, v.boxG.position.y - 1.28, 5.0); v.arms.forEach(m => m.position.y = 1.28 + (v.boxG.position.y - 1.28) / 2);
  v.plat.position.z = v.platZ0 - 2.8 * b;
  v.trolley.visible = b > 0.99 && t != null; if (v.trolley.visible) { const p = (t % 14) / 14, e = p < 0.5 ? THREE.MathUtils.smoothstep(p, 0.05, 0.4) : 1 - THREE.MathUtils.smoothstep(p, 0.6, 0.95); v.trolley.position.z = -1.55 - 3.2 * e; }
}
function beltLoader() {
  const k = new Kit(), Lb = 8.4;
  k.add('paint', rb(1.5, 0.42, 6.6, 0.06), T(0, 0.6, 0), YEL); chassisWheels(k, [-2.3, 2.3], 0.86, 0.33, 0.24);
  for (const s of [-1, 1]) { decal(k, 'hazard', 6.2, 0.12, T(s * 0.756, 0.5, 0, s * H)); for (const z of [-2.3, 2.3]) k.add('paint', rb(0.3, 0.06, 0.85, 0.02), T(s * 0.86, 0.72, z), YEL); }
  // driver station: seat, column + wheel, canopy on posts
  k.add('dark', rb(0.5, 0.12, 0.5, 0.04), T(-0.35, 0.95, 1.6), 0x222428); k.add('dark', rb(0.5, 0.55, 0.1, 0.04), T(-0.35, 1.25, 1.88), 0x222428);
  k.add('dark', bar([-0.35, 0.85, 0.95], [-0.35, 1.35, 1.2], 0.03), null, 0x222222); k.add('dark', new THREE.TorusGeometry(0.17, 0.018, 6, 16).rotateX(-1.1), T(-0.35, 1.36, 1.2), 0x18191b);
  for (const [x, z] of [[-0.72, 0.9], [-0.72, 2.1], [0.02, 0.9], [0.02, 2.1]]) k.add('metal', bar([x, 0.8, z], [x, 2.05, z], 0.025), null, 0x555b62);
  k.add('paint', rb(0.86, 0.05, 1.35, 0.02), T(-0.35, 2.07, 1.5), YEL); beacon(k, -0.35, 2.1, 1.0);
  k.add('paint', rb(0.6, 0.6, 1.1, 0.05), T(0.4, 1.05, 2.4), YEL); decal(k, 'louvre', 0.9, 0.4, T(0.705, 1.05, 2.4, H)); // engine housing
  k.add('dark', rb(1.5, 0.18, 0.18, 0.04), T(0, 0.45, -3.35), 0x1a1a1a); decal(k, 'plate', 0.4, 0.1, T(0, 0.45, -3.445, PI));
  for (const s of [-1, 1]) lamp(k, s * 0.55, 0.7, -3.31, 0.14, 0.1, new THREE.Color(2.2, 2.1, 1.9), PI);
  const obj = new THREE.Group(); obj.add(k.build());
  // boom (pivot at the rear, low): side beams, belt, rails stopping short of the front, rubber bumper
  const kb = new Kit();
  for (const s of [-1, 1]) { kb.add('paint', rb(0.12, 0.3, Lb, 0.03), T(s * 0.48, 0, -Lb / 2), YEL); rails(kb, s * 0.5, 0.12, -Lb + 1.2, -0.3, 0.72, YEL, 5); decal(kb, 'hazard', Lb - 0.4, 0.1, T(s * 0.545, -0.08, -Lb / 2, s * H)); }
  for (let z = -0.6; z > -Lb + 0.3; z -= 1.3) kb.add('dark', cyl(0.06, 0.06, 0.9, 8).rotateZ(H), T(0, -0.05, z), 0x2b2b2b);
  kb.add('dark', rb(0.95, 0.2, 0.16, 0.05), T(0, 0.05, -Lb - 0.02), 0x111111);
  const boom = kb.build(); const beltM = new THREE.Mesh(plane(0.84, Lb).rotateX(-H).translate(0, 0.13, -Lb / 2), MATS.belt); boom.add(beltM);
  const tex = MATS.belt.map; tex.repeat.set(1, Lb / 0.5);
  boom.position.set(0, 0.85, 3.3); obj.add(boom);
  return { obj, type: 'belt', boom, Lb, pz: 3.3, py: 0.85, len: 8.6 };
}
// angle so the boom tip reaches height hgt; returns local z of the tip
function beltTip(v, hgt) { const phi = Math.asin(THREE.MathUtils.clamp((hgt - v.py - 0.12) / v.Lb, 0, 0.6)); return { phi, z: v.pz - v.Lb * Math.cos(phi) }; }
function containerLoader() {
  const k = new Kit();
  k.add('paint', rb(2.6, 0.5, 8.4, 0.06), T(0, 0.45, 0), YEL); chassisWheels(k, [-3.0, 3.0], 1.15, 0.38, 0.3);
  for (const s of [-1, 1]) decal(k, 'hazard', 8.0, 0.14, T(s * 1.305, 0.4, 0, s * H));
  k.add('paint', rb(2.3, 0.2, 4.0, 0.03), T(0, 0.8, 1.9), GREY);
  // operator cab front-left (low), with glass
  k.add('paint', rb(0.9, 1.3, 1.3, 0.08), T(-0.85, 1.35, -3.2), YEL);
  for (const s of [-1, 1]) k.add('glass', plane(1.0, 0.6), T(-0.85 + s * 0.456, 1.62, -3.2, s * H), 0x2a3640);
  k.add('glass', plane(0.7, 0.6), T(-0.85, 1.62, -3.856, PI), 0x2a3640); beacon(k, -0.85, 2.0, -3.2);
  for (const s of [-1, 1]) lamp(k, s * 1.05, 0.45, -4.21, 0.16, 0.1, new THREE.Color(2.2, 2.1, 1.9), PI);
  const obj = new THREE.Group(); obj.add(k.build());
  const deck = (w, l, rollers, guide) => { const kd = new Kit(); kd.add('paint', rb(w, 0.24, l, 0.04), T(0, -0.12, 0), YEL); for (let z = -l / 2 + 0.2; z < l / 2 - 0.1; z += 0.32) kd.add('dark', cyl(0.045, 0.045, w - 0.2, 8).rotateZ(H), T(0, 0.02, z), 0x2e3135);
    if (guide) for (const s of [-1, 1]) kd.add('paint', rb(0.08, 0.22, l, 0.02), T(s * (w / 2 - 0.04), 0.13, 0), YEL); decal(kd, 'hazard', l - 0.2, 0.12, T(w / 2 + 0.004, -0.12, 0, H)); return kd; };
  const km = deck(3.0, 4.2, true, true); const main = km.build([]); main.position.set(0, 1.0, 1.9); obj.add(main);
  const kbr = deck(1.7, 2.4, true, false); for (const s of [-1, 1]) rails(kbr, 0.85, 0, -1.1, 1.1, 1.0, YEL); kbr.add('dark', rb(1.7, 0.18, 0.14, 0.05), T(0, 0.0, -1.24), 0x111111);
  const bridge = kbr.build([]); bridge.position.set(0.35, 1.0, -2.9); obj.add(bridge);
  const arms = [scissor(3.6, 1.0, 1), scissor(3.6, 1.0, -1)]; arms.forEach(a => { a.position.set(0, 0, 1.9); obj.add(a); });
  return { obj, type: 'cont', main, bridge, arms, front: -4.2, len: 8.6 };
}
function poseLoader(v, k, h) { const y = 1.0 + (h - 1.0) * THREE.MathUtils.smoothstep(k, 0, 1); v.main.position.y = y; v.bridge.position.y = y; setScissor(v.arms, y - 0.12 - 0.92, 3.6); v.arms.forEach(a => a.position.y = 0.92 + (y - 0.12 - 0.92) / 2); }
function fuelDispenser() {
  const k = new Kit();
  k.add('dark', rb(1.0, 0.3, 6.6, 0.04), T(0, 0.78, 0.1), 0x1f2124); chassisWheels(k, [-2.4, 2.2], 1.02, 0.5, 0.34);
  for (const z of [-2.4, 2.2]) for (const s of [-1, 1]) k.add('paint', rb(0.46, 0.08, 1.22, 0.03), T(s * 1.04, 1.06, z), GREY);
  cab(k, { z0: -3.7, len: 1.7, w: 2.34, y0: 0.9, h: 1.58, rake: 0.32 }); beacon(k, 0.6, 2.5, -2.6);
  // equipment body with louvres + signage, filter vessel, hose reels
  k.add('paint', rb(2.3, 1.25, 3.3, 0.06), T(0, 1.62, 0.25), WHITE);
  for (const s of [-1, 1]) { decal(k, 'fuel', 1.9, 0.82, T(s * 1.154, 1.72, -0.35, s * H)); decal(k, 'louvre', 1.0, 0.7, T(s * 1.154, 1.62, 1.2, s * H)); decal(k, 'hazRW', 3.1, 0.12, T(s * 1.154, 1.06, 0.25, s * H)); }
  k.add('metal', cyl(0.34, 0.34, 0.8), T(-0.55, 2.62, -0.6), 0xcfd3d7); k.add('metal', new THREE.SphereGeometry(0.34, 12, 6, 0, PI * 2, 0, H), T(-0.55, 3.02, -0.6), 0xcfd3d7);
  k.add('metal', cyl(0.48, 0.48, 0.1).rotateZ(H), T(0.05, 2.75, 1.25), 0x9aa0a6); k.add('metal', cyl(0.48, 0.48, 0.1).rotateZ(H), T(1.0, 2.75, 1.25), 0x9aa0a6); k.add('dark', cyl(0.4, 0.4, 0.86).rotateZ(H), T(0.52, 2.75, 1.25), 0x161616);
  k.add('dark', rb(2.3, 0.22, 0.2, 0.04), T(0, 0.64, 3.4), 0x1d1f22); decal(k, 'hazard', 2.2, 0.16, T(0, 0.64, 3.506));
  for (const s of [-1, 1]) lamp(k, s * 0.95, 0.82, 3.3, 0.22, 0.12, new THREE.Color(1.8, 0.1, 0.06));
  const obj = new THREE.Group(); obj.add(k.build());
  const kp = new Kit(); kp.add('metal', box(2.1, 0.1, 1.3), T(0, -0.05, 0), 0x9aa0a6); decal(kp, 'tread', 2.0, 1.2, T(0, 0.002, 0, 0, -H)); for (const s of [-1, 1]) rails(kp, s * 1.0, 0, -0.6, 0.6, 1.1, YEL);
  kp.add('paint', bar([-1.0, 1.1, 0.62], [1.0, 1.1, 0.62], 0.025), null, YEL);
  const plat = kp.build([]); plat.position.set(0, 1.0, 3.95); obj.add(plat);
  const arms = [scissor(1.25, 0.85, 1), scissor(1.25, 0.85, -1)]; arms.forEach(a => { a.position.set(0, 0, 3.95); obj.add(a); });
  return { obj, type: 'fuel', plat, arms, len: 7.6 };
}
function poseFuel(v, k, hgt) { const y = 1.0 + (hgt - 1.0) * THREE.MathUtils.smoothstep(k, 0, 0.7); v.plat.position.y = y; setScissor(v.arms, y - 0.82, 1.25); v.arms.forEach(a => a.position.y = 0.82 + (y - 0.82) / 2); }
function serviceTruck(kind) { // lav or potable water truck (5.8 m)
  const k = new Kit();
  k.add('dark', rb(0.95, 0.26, 5.2, 0.04), T(0, 0.7, 0.2), 0x1f2124); chassisWheels(k, [-1.9, 1.8], 0.92, 0.42, 0.28);
  for (const z of [-1.9, 1.8]) for (const s of [-1, 1]) k.add('paint', rb(0.4, 0.07, 1.05, 0.03), T(s * 0.94, 0.92, z), GREY);
  cab(k, { z0: -2.9, len: 1.5, w: 2.06, y0: 0.82, h: 1.5, rake: 0.3 }); beacon(k, 0, 2.34, -2.0);
  if (kind === 'lav') {
    k.add('metal', cyl(0.62, 0.62, 2.5, 20).rotateX(H), T(0, 1.55, 0.95), 0xd6dadd); for (const z of [-0.25, 2.15]) k.add('metal', cyl(0.64, 0.64, 0.06, 20).rotateX(H), T(0, 1.55, z), 0x9aa0a6);
    k.add('paint', rb(2.0, 1.1, 0.55, 0.05), T(0, 1.5, -0.62), WHITE); for (const s of [-1, 1]) decal(k, 'lav', 0.52, 0.5, T(s * 1.004, 1.62, -0.62, s * H));
    k.add('dark', cyl(0.3, 0.3, 0.5).rotateZ(H), T(0, 2.35, 2.0), 0x161616);
  } else {
    k.add('paint', rb(2.0, 1.45, 2.9, 0.08), T(0, 1.62, 0.9), WHITE); for (const s of [-1, 1]) decal(k, 'water', 2.4, 0.6, T(s * 1.004, 1.75, 0.9, s * H));
    k.add('metal', rb(0.6, 0.4, 0.6, 0.04), T(0.6, 2.55, 2.0), 0xb8bdc2); decal(k, 'louvre', 1.6, 0.6, T(0, 1.55, 2.354));
  }
  k.add('dark', rb(2.0, 0.2, 0.18, 0.04), T(0, 0.58, 2.85), 0x1d1f22); decal(k, 'hazRW', 1.9, 0.14, T(0, 0.58, 2.946));
  for (const s of [-1, 1]) lamp(k, s * 0.85, 0.75, 2.8, 0.2, 0.1, new THREE.Color(1.8, 0.1, 0.06));
  const obj = new THREE.Group(); obj.add(k.build()); return { obj, type: kind, len: 5.8 };
}
function cleaningVan() {
  const k = new Kit(), w = 1.96;
  k.add('paint', prof([[-2.5, 0.42], [2.5, 0.42], [2.5, 2.2], [-1.15, 2.24], [-2.15, 1.32], [-2.5, 1.12]], w, 0.1), null, WHITE);
  for (const s of [-1, 1]) { decal(k, 'van', 2.6, 0.62, T(s * (w / 2 + 0.004), 1.15, 0.9, s * H)); k.add('glass', sidePoly([[-2.0, 1.42], [1.95, 1.42], [1.95, 2.05], [-1.15, 2.08]], s * (w / 2 + 0.005), s), null, 0x23303a); k.add('dark', box(0.01, 1.3, 0.02), T(s * (w / 2 + 0.008), 1.15, -0.95), 0x2a2d31); }
  const dz = 1.0, dy = 0.92, L = Math.hypot(dz, dy); k.add('glass', plane(w - 0.22, L - 0.14), T(0, 1.78, -1.66, 0, Math.atan2(-dz / L, -dy / L)), 0x23303a);
  chassisWheels(k, [-1.62, 1.55], 0.86, 0.36, 0.24);
  k.add('dark', rb(w + 0.04, 0.24, 0.2, 0.05), T(0, 0.5, -2.52), 0x1e2023); k.add('dark', rb(w + 0.04, 0.24, 0.2, 0.05), T(0, 0.5, 2.52), 0x1e2023); decal(k, 'grille', 0.9, 0.18, T(0, 0.85, -2.505, PI));
  for (const s of [-1, 1]) { lamp(k, s * 0.7, 0.95, -2.505, 0.3, 0.14, new THREE.Color(2.2, 2.1, 1.9), PI); lamp(k, s * 0.85, 1.0, 2.505, 0.14, 0.3, new THREE.Color(1.8, 0.1, 0.06)); }
  beacon(k, 0, 2.24, -0.6);
  const obj = new THREE.Group(); obj.add(k.build()); return { obj, type: 'van', len: 5.0 };
}
function baggageTug() {
  const k = new Kit();
  k.add('paint', prof([[-1.35, 0.3], [1.3, 0.3], [1.3, 0.95], [-0.4, 0.95], [-0.9, 0.85], [-1.35, 0.7]], 1.3, 0.06), null, YEL);
  chassisWheels(k, [-0.85, 0.85], 0.62, 0.3, 0.24);
  k.add('dark', rb(0.55, 0.12, 0.5, 0.04), T(0, 1.05, 0.45), 0x222428); k.add('dark', rb(0.55, 0.5, 0.1, 0.04), T(0, 1.32, 0.72), 0x222428);
  k.add('dark', bar([0, 0.95, -0.35], [0, 1.35, -0.12], 0.03), null, 0x222222); k.add('dark', new THREE.TorusGeometry(0.16, 0.017, 6, 14).rotateX(-1.1), T(0, 1.36, -0.12), 0x18191b);
  for (const [x, z] of [[-0.6, -0.55], [0.6, -0.55], [-0.6, 1.2], [0.6, 1.2]]) k.add('metal', bar([x, 0.9, z], [x, 2.0, z], 0.028), null, 0x555b62);
  k.add('paint', rb(1.32, 0.05, 1.9, 0.02), T(0, 2.02, 0.33), YEL); beacon(k, 0, 2.05, 0.6);
  k.add('dark', rb(1.3, 0.16, 0.14, 0.04), T(0, 0.45, -1.4), 0x141414); decal(k, 'hazard', 1.2, 0.1, T(0, 0.45, -1.475, PI));
  k.add('metal', box(0.2, 0.08, 0.3), T(0, 0.45, 1.42), 0x555b62);
  for (const s of [-1, 1]) lamp(k, s * 0.45, 0.82, -1.36, 0.14, 0.09, new THREE.Color(2.2, 2.1, 1.9), PI);
  const obj = new THREE.Group(); obj.add(k.build()); return { obj, type: 'btug', len: 2.8 };
}
function bagCart() {
  const k = new Kit();
  k.add('paint', rb(1.5, 0.14, 3.0, 0.03), T(0, 0.55, 0), 0x52606f); chassisWheels(k, [-1.05, 1.05], 0.62, 0.2, 0.14);
  for (const [x, z] of [[-0.72, -1.45], [0.72, -1.45], [-0.72, 1.45], [0.72, 1.45]]) k.add('metal', box(0.06, 1.4, 0.06), T(x, 1.3, z), 0x6d747c);
  k.add('paint', rb(1.56, 0.06, 3.06, 0.02), T(0, 2.0, 0), 0x2c3e57);
  decal(k, 'canvas', 2.9, 1.3, T(0.755, 1.32, 0, H)); k.add('dark', cyl(0.09, 0.09, 2.9, 8).rotateX(H), T(-0.74, 1.88, 0), 0x24344d);
  k.add('paint', rb(1.44, 1.3, 0.05, 0.02), T(0, 1.3, -1.48), 0x52606f); decal(k, 'hazRW', 1.3, 0.12, T(0, 0.72, 1.53));
  k.add('metal', bar([0, 0.5, -1.5], [0, 0.42, -2.5], 0.035), null, 0x40464d);
  const obj = new THREE.Group(); obj.add(k.build()); return { obj, type: 'cart', len: 3.0, bar: 1.0 };
}
function uldDolly() {
  const k = new Kit();
  k.add('paint', rb(1.7, 0.16, 3.2, 0.03), T(0, 0.5, 0), 0xc8ccd0); chassisWheels(k, [-1.15, 1.15], 0.7, 0.2, 0.14);
  for (let z = -1.4; z <= 1.45; z += 0.35) k.add('dark', cyl(0.035, 0.035, 1.5, 6).rotateZ(H), T(0, 0.6, z), 0x2e3135);
  for (const s of [-1, 1]) { k.add('paint', rb(0.06, 0.16, 3.2, 0.02), T(s * 0.83, 0.66, 0), YEL); decal(k, 'hazard', 3.0, 0.1, T(s * 0.855, 0.5, 0, s * H)); }
  k.add('metal', bar([0, 0.45, -1.6], [0, 0.42, -2.6], 0.035), null, 0x40464d);
  const obj = new THREE.Group(); obj.add(k.build()); return { obj, type: 'dolly', len: 3.2, bar: 1.0 };
}
export function pushTug() { // towbar pushback tug; front (hitch) faces +z, toward the aircraft
  const k = new Kit();
  k.add('paint', prof([[-3.0, 0.35], [3.0, 0.35], [3.0, 1.0], [2.6, 1.25], [-2.7, 1.25], [-3.0, 1.0]], 2.6, 0.1), null, YEL);
  chassisWheels(k, [-1.7, 1.7], 1.1, 0.56, 0.44);
  for (const s of [-1, 1]) decal(k, 'hazard', 5.6, 0.16, T(s * 1.304, 0.55, 0, s * H));
  k.add('paint', rb(1.3, 0.9, 1.7, 0.1), T(-0.55, 1.68, 1.0), YEL); // cab (low, offset)
  for (const s of [-1, 1]) k.add('glass', plane(1.4, 0.55), T(-0.55 + s * 0.656, 1.82, 1.0, s * H), 0x2a3640);
  k.add('glass', plane(1.1, 0.55), T(-0.55, 1.82, 1.856), 0x2a3640); k.add('glass', plane(1.1, 0.5), T(-0.55, 1.82, 0.144, PI), 0x2a3640);
  k.add('dark', rb(1.35, 0.08, 1.75, 0.03), T(-0.55, 2.15, 1.0), 0x1b1d20); beacon(k, -0.55, 2.19, 0.6); beacon(k, 0.8, 1.27, -2.4);
  k.add('dark', rb(2.7, 0.3, 0.3, 0.06), T(0, 0.65, 3.05), 0x151515); decal(k, 'hazard', 2.5, 0.2, T(0, 0.65, 3.21)); k.add('dark', rb(2.7, 0.3, 0.3, 0.06), T(0, 0.65, -3.05), 0x151515);
  k.add('metal', rb(0.4, 0.25, 0.35, 0.04), T(0, 0.62, 3.25), 0x50565d);
  for (const s of [-1, 1]) { lamp(k, s * 1.0, 1.05, 3.005, 0.24, 0.12, new THREE.Color(2.2, 2.1, 1.9)); lamp(k, s * 1.05, 1.05, -3.005, 0.2, 0.12, new THREE.Color(1.8, 0.1, 0.06), PI); }
  decal(k, 'louvre', 1.2, 0.5, T(0.6, 1.252, -1.2, 0, -H));
  return k.build();
}
export function gpuUnit() {
  const k = new Kit();
  k.add('paint', rb(1.3, 1.25, 2.3, 0.07), T(0, 1.05, 0), 0xd5d9dc); chassisWheels(k, [-0.75, 0.75], 0.62, 0.26, 0.16);
  k.add('dark', rb(1.2, 0.14, 2.3, 0.03), T(0, 0.38, 0), 0x2a2d31);
  for (const s of [-1, 1]) { decal(k, 'louvre', 1.4, 0.7, T(s * 0.654, 1.1, -0.2, s * H)); decal(k, 'hazard', 2.1, 0.08, T(s * 0.654, 0.5, 0, s * H)); }
  decal(k, 'gpuP', 1.05, 0.28, T(0, 1.2, 1.154)); decal(k, 'ramp', 1.0, 0.25, T(0, 0.8, 1.154));
  k.add('dark', cyl(0.28, 0.28, 0.5).rotateZ(H), T(0, 1.9, 0.5), 0x111111); k.add('metal', bar([0, 0.4, -1.15], [0, 0.32, -2.1], 0.035), null, 0x40464d);
  beacon(k, -0.45, 1.68, -0.8);
  return k.build();
}
export function coneGeometry() { const k = new Kit(); k.add('paint', new THREE.LatheGeometry([[0.2, 0], [0.17, 0.05], [0.035, 0.72], [0.0, 0.74]].map(([r, y]) => new THREE.Vector2(r, y)), 14), null, 0xff5a14); k.add('paint', cyl(0.1, 0.13, 0.12, 14), T(0, 0.4, 0), 0xf2f2f2); k.add('paint', rb(0.44, 0.04, 0.44, 0.015), T(0, 0.02, 0), 0x2a2a2a); return mergeGeometries(k.L.paint); }
export function chockGeometry() { const s = new THREE.Shape([new THREE.Vector2(-0.2, 0), new THREE.Vector2(0.2, 0), new THREE.Vector2(0.06, 0.22), new THREE.Vector2(-0.06, 0.22)]); const g = new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: false }); g.translate(0, 0, -0.25); const k = new Kit(); k.add('paint', g, null, 0xf2c218); k.add('paint', bar([0, 0.18, 0.25], [0, 0.18, 0.7], 0.012, 4), null, 0x222222); return mergeGeometries(k.L.paint); }
export function hoseMesh(pts, r = 0.05, col = 0x151515) { const k = new Kit(); k.add('dark', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => V(...p))), 28, r, 7), null, col); return k.build([]); }

export function makeVehicle(type) {
  return { cat: cateringTruck, belt: beltLoader, cont: containerLoader, fuel: fuelDispenser, lav: () => serviceTruck('lav'), water: () => serviceTruck('water'), van: cleaningVan, btug: baggageTug, cart: bagCart, dolly: uldDolly }[type]();
}
export const POSE = { cat: poseCatering, cont: poseLoader, fuel: poseFuel, beltTip };

// ---------------------------------------------------------------- bags and LD3 containers (instanced)
export function bagsMesh(n) {
  const k = new Kit(); k.add('paint', rb(0.55, 0.36, 0.24, 0.06), T(0, 0.18, 0)); k.add('dark', new THREE.TorusGeometry(0.06, 0.012, 4, 10, PI), T(0, 0.36, 0), 0x333333);
  const g = mergeGeometries([...k.L.paint, ...k.L.dark.map(x => x)]); const im = new THREE.InstancedMesh(g, MATS.paint, n); im.frustumCulled = false;
  const C = new THREE.Color(), cols = [0x1b1d22, 0x23324d, 0x6a1f22, 0x4b5258, 0x2f4a33, 0x4b2f55, 0x8a6b3d, 0x1f5f8a, 0xb7472a, 0x2a2a2a]; for (let i = 0; i < n; i++) { C.set(cols[i % cols.length]); im.setColorAt(i, C); }
  return im;
}
export function uldMeshes(n) {
  const s = new THREE.Shape([[-0.78, 0], [0.78, 0], [1.23, 0.58], [1.23, 1.63], [-0.78, 1.63]].map(p => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.47, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelOffset: -0.03, bevelSegments: 1 }); g.translate(-0.22, 0, -0.765);
  const k = new Kit(); k.add('metal', g, null, 0xb9bec4); k.add('metal', box(1.6, 0.06, 1.5), T(0, 0.03, 0), 0x6d747a);
  const kd = new Kit(); decal(kd, 'uld', 1.95, 1.55, T(0, 0.8, 0.77)); decal(kd, 'uld', 1.95, 1.55, T(0, 0.8, -0.77, PI));
  const a = new THREE.InstancedMesh(mergeGeometries(k.L.metal), MATS.metal, n), b = new THREE.InstancedMesh(mergeGeometries(kd.L.paint), MATS.paint, n); a.frustumCulled = b.frustumCulled = false; a.castShadow = true;
  return [a, b];
}

// ---------------------------------------------------------------- ramp crew: lit, instanced (9 draw calls for everyone)
// person faces +z; modes: idle walk wave salute guide push load sit
const VEST = new THREE.Color(0xc6ef1e), STRIPE = new THREE.Color(0xdfe3e6);
function colored(g, c) { const k = new Kit(); k.add('crew', g, null, c); return k.L.crew[0]; }
const capsule = (r, l) => new THREE.CapsuleGeometry(r, l, 3, 10);
function crewGeos() {
  const torso = mergeGeometries([colored(capsule(0.165, 0.36).translate(0, 0.3, 0), 0xffffff), colored(cyl(0.19, 0.182, 0.46, 14).translate(0, 0.3, 0), VEST), colored(cyl(0.193, 0.19, 0.035, 14).translate(0, 0.2, 0), STRIPE), colored(cyl(0.193, 0.19, 0.035, 14).translate(0, 0.38, 0), STRIPE), colored(cyl(0.05, 0.055, 0.12, 8).translate(0, 0.6, 0), 0xb98a6a)]);
  const head = mergeGeometries([colored(new THREE.SphereGeometry(0.105, 14, 10).scale(0.92, 1.05, 1), 0xffffff), colored(new THREE.SphereGeometry(0.03, 6, 4).translate(0, -0.01, 0.1), 0xffffff)]);
  const cap = mergeGeometries([colored(new THREE.SphereGeometry(0.112, 14, 8, 0, PI * 2, 0, H).translate(0, 0.025, 0), 0xffffff), colored(cyl(0.11, 0.11, 0.015, 12).scale(1, 1, 1.05).translate(0, 0.03, 0.08), 0xffffff)]);
  const ear = mergeGeometries([colored(cyl(0.045, 0.045, 0.04, 12).rotateZ(H).translate(0.112, 0, 0), 0xffffff), colored(cyl(0.045, 0.045, 0.04, 12).rotateZ(H).translate(-0.112, 0, 0), 0xffffff), colored(new THREE.TorusGeometry(0.12, 0.012, 4, 14, PI).translate(0, 0.0, 0), 0x222222)]);
  const ua = colored(capsule(0.055, 0.24).translate(0, -0.15, 0), 0xffffff);
  const fa = mergeGeometries([colored(capsule(0.05, 0.2).translate(0, -0.13, 0), 0xffffff), colored(new THREE.SphereGeometry(0.05, 8, 6).translate(0, -0.29, 0), 0x2a2a2a)]);
  const th = colored(capsule(0.075, 0.32).translate(0, -0.22, 0), 0xffffff);
  const sh = mergeGeometries([colored(capsule(0.064, 0.3).translate(0, -0.2, 0), 0xffffff), colored(cyl(0.068, 0.068, 0.04, 10).translate(0, -0.15, 0), STRIPE), colored(rb(0.12, 0.09, 0.27, 0.03).translate(0, -0.43, 0.05), 0x141414)]);
  const wand = colored(cyl(0.022, 0.022, 0.42, 8).translate(0, -0.48, 0), 0xffffff);
  return { torso, head, cap, ear, ua, fa, th, sh, wand };
}
const _m = new THREE.Matrix4(), _a = new THREE.Matrix4(), _b = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const TR = (m, x, y, z, rx = 0, ry = 0, rz = 0) => m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'XYZ')), _s);
function limbs(mode, t, ph) {
  const s = Math.sin(t * 6.4 + ph), o = { leg: [0, 0], knee: [0, 0], arm: [[0.05, 0, -0.08], [0.05, 0, 0.08]], el: [-0.25, -0.25], lean: 0, bob: 0, hip: 0.92 };
  const walk = mode === 'walk' || mode === 'push';
  if (walk) { o.leg = [s * 0.45, -s * 0.45]; o.knee = [Math.max(0, -s) * 0.6, Math.max(0, s) * 0.6]; o.arm[0][0] = -s * 0.35; o.arm[1][0] = s * 0.35; o.bob = Math.abs(s) * 0.03; }
  else if (mode === 'idle') { const b = Math.sin(t * 1.3 + ph); o.arm[0][0] = 0.05 + b * 0.03; o.arm[1][0] = 0.05 - b * 0.03; o.lean = 0.02 * b; }
  if (mode === 'wave') { const w = Math.sin(t * 2.6 + ph); o.arm = [[0, 0, -2.4 + w * 0.5], [0, 0, 2.4 - w * 0.5]]; o.el = [0, 0]; }
  if (mode === 'guide') { const w = Math.sin(t * 2.2 + ph); o.arm = [[-1.4 + w * 0.6, 0, -0.3], [-1.4 + w * 0.6, 0, 0.3]]; o.el = [-1.2 - w * 0.4, -1.2 - w * 0.4]; }
  if (mode === 'salute') { o.arm[1] = [-2.6, 0, 0.5]; o.el[1] = -1.6; }
  if (mode === 'push') { o.arm = [[-0.9, 0, -0.1], [-0.9, 0, 0.1]]; o.el = [-0.6, -0.6]; o.lean = 0.12; }
  if (mode === 'load') { const p = (t / 2.4 + ph * 0.1) % 1, up = p < 0.5 ? THREE.MathUtils.smoothstep(p, 0.05, 0.4) : 1 - THREE.MathUtils.smoothstep(p, 0.55, 0.95); o.lean = 0.45 * (1 - up); o.arm = [[-0.6 - 0.9 * up, 0, -0.15], [-0.6 - 0.9 * up, 0, 0.15]]; o.el = [-0.9 + 0.6 * up, -0.9 + 0.6 * up]; o.knee = [0.5 * (1 - up), 0.5 * (1 - up)]; o.leg = [-0.25 * (1 - up), -0.25 * (1 - up)]; o.hip = 0.92 - 0.12 * (1 - up); }
  if (mode === 'sit') { o.leg = [-1.45, -1.45]; o.knee = [1.4, 1.4]; o.arm = [[-0.9, 0, -0.1], [-0.9, 0, 0.1]]; o.el = [-0.5, -0.5]; o.hip = 0.0; }
  return o;
}
export class RampCrew {
  constructor(parent, n, q) {
    gseMats(q); const G = crewGeos(); this.n = n; this.p = [];
    const mk = (g, m, c) => { const im = new THREE.InstancedMesh(g, m, c); im.frustumCulled = false; im.castShadow = q !== 'low'; parent.add(im); return im; };
    this.M = { torso: mk(G.torso, MATS.crew, n), head: mk(G.head, MATS.crew, n), cap: mk(G.cap, MATS.crew, n), ear: mk(G.ear, MATS.crew, n), ua: mk(G.ua, MATS.crew, n * 2), fa: mk(G.fa, MATS.crew, n * 2), th: mk(G.th, MATS.crew, n * 2), sh: mk(G.sh, MATS.crew, n * 2), wand: mk(G.wand, MATS.wand, n * 2) };
    const SK = [0xb98a6a, 0x8d5f43, 0xe0b496, 0x6b4630, 0xc99a78], C = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const p = { pos: new THREE.Vector3(), yaw: 0, mode: 'idle', vis: false, ph: i * 1.7, headset: false, wands: false };
      this.p.push(p);
      this.look(i, { shirt: [0x2b3442, 0x23272e, 0x3a4250][i % 3], trousers: [0x23272e, 0x2e3440, 0x1d2129][i % 3], skin: SK[i % 5], cap: [0x1d2a44, 0xf2f2f2, 0xe8b416, 0x1d2a44][i % 4] });
    }
    for (const k in this.M) this.M[k].instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  look(i, o) { const C = new THREE.Color(); const M = this.M;
    if (o.vest != null) M.torso.setColorAt(i, C.set(o.vest)); else M.torso.setColorAt(i, C.setRGB(1, 1, 1));
    M.head.setColorAt(i, C.set(o.skin)); M.cap.setColorAt(i, C.set(o.cap)); M.ear.setColorAt(i, C.set(0xc8261c));
    for (const s of [0, 1]) { M.ua.setColorAt(i * 2 + s, C.set(o.shirt)); M.fa.setColorAt(i * 2 + s, C.set(o.shirt)); M.th.setColorAt(i * 2 + s, C.set(o.trousers)); M.sh.setColorAt(i * 2 + s, C.set(o.trousers)); M.wand.setColorAt(i * 2 + s, C.setRGB(1, 1, 1)); }
    for (const k in M) if (M[k].instanceColor) M[k].instanceColor.needsUpdate = true; }
  commit(t) {
    const M = this.M;
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i];
      if (!p.vis) { for (const k of ['torso', 'head', 'cap', 'ear']) M[k].setMatrixAt(i, ZERO); for (const k of ['ua', 'fa', 'th', 'sh', 'wand']) { M[k].setMatrixAt(i * 2, ZERO); M[k].setMatrixAt(i * 2 + 1, ZERO); } continue; }
      const o = limbs(p.mode, t, p.ph);
      const root = TR(_m, p.pos.x, p.pos.y, p.pos.z, 0, p.yaw, 0), hip = new THREE.Matrix4().multiplyMatrices(root, TR(_a, 0, o.hip + o.bob, 0, o.lean, 0, 0));
      M.torso.setMatrixAt(i, hip); const head = new THREE.Matrix4().multiplyMatrices(hip, TR(_a, 0, 0.75, 0.01, -o.lean * 0.5, Math.sin(t * 0.7 + p.ph) * 0.25, 0));
      M.head.setMatrixAt(i, head); M.cap.setMatrixAt(i, head); M.ear.setMatrixAt(i, p.headset ? head : ZERO);
      for (let j = 0; j < 2; j++) {
        const sd = j ? 1 : -1;
        const th = new THREE.Matrix4().multiplyMatrices(hip, TR(_a, sd * 0.1, 0, 0, o.leg[j], 0, 0)); M.th.setMatrixAt(i * 2 + j, th);
        M.sh.setMatrixAt(i * 2 + j, _b.multiplyMatrices(th, TR(_a, 0, -0.44, 0, o.knee[j], 0, 0)));
        const ar = o.arm[j]; const sh = new THREE.Matrix4().multiplyMatrices(hip, TR(_a, sd * 0.22, 0.5, 0, ar[0], ar[1], ar[2])); M.ua.setMatrixAt(i * 2 + j, sh);
        const fa = new THREE.Matrix4().multiplyMatrices(sh, TR(_a, 0, -0.3, 0, o.el[j], 0, 0)); M.fa.setMatrixAt(i * 2 + j, fa); M.wand.setMatrixAt(i * 2 + j, p.wands ? fa : ZERO);
      }
    }
    for (const k in M) M[k].instanceMatrix.needsUpdate = true;
  }
}
