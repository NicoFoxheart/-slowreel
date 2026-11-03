// Airport buildings and airside furniture (environment artist), all procedural and unbranded, merged per material:
// terminal (curtain wall with mullions, sky reflections and lit floors at night, apron-level service wall, wave roof
// with overhang and columns, fixed links + stair towers + gate numbers, name sign), landside (elevated departures
// curb with canopy, arrivals road, multi-storey car park with parked cars, moving cars), articulated jet bridges
// (rotunda, two telescoping tunnels, cab with bellows, drive bogie; instanced, animated by setDocked), control tower,
// hangars, fire station, cargo shed, floodlight masts, windsocks, ILS localizer/glide-path antennas, approach-light
// stanchions and taxiway signs (hold / location / direction). Everything is placed through the Site exclusion mask.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { atmos, ATM, NOISE_GLSL } from './sky.js';
import { Atlas } from './env-kit.js';

const PI = Math.PI, H = PI / 2, V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const M4 = (x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), V3(sx, sy, sz));
const C = h => new THREE.Color(h);

// ---------------------------------------------------------------- textures + materials (shared by every airport)
function ctex(w, h, draw, rep = true) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }
const speck = (c, w, h, n, a, dark = true) => { for (let i = 0; i < n; i++) { c.fillStyle = dark ? `rgba(30,28,25,${Math.random() * a})` : `rgba(255,255,255,${Math.random() * a})`; c.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3); } };
let MT = null;
export function bldMats() {
  if (MT) return MT;
  const panel = ctex(256, 256, (c, w, h) => { // 3 m: 1.5 x 0.75 m cladding panels, joints, rain streaks
    c.fillStyle = '#e4e5e4'; c.fillRect(0, 0, w, h); for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.05})`; c.fillRect(x * 128, y * 64, 128, 64); }
    c.fillStyle = 'rgba(40,40,40,.55)'; for (let y = 0; y < h; y += 64) c.fillRect(0, y, w, 2); for (let x = 0; x < w; x += 128) c.fillRect(x, 0, 2, h);
    for (let i = 0; i < 40; i++) { const x = Math.random() * w, g = c.createLinearGradient(0, 0, 0, 40 + Math.random() * 40); g.addColorStop(0, 'rgba(60,55,50,.12)'); g.addColorStop(1, 'rgba(60,55,50,0)'); c.fillStyle = g; c.fillRect(x, Math.floor(Math.random() * 4) * 64 + 2, 2 + Math.random() * 4, 80); }
    speck(c, w, h, 600, 0.08); });
  const conc = ctex(256, 256, (c, w, h) => { c.fillStyle = '#cfccc5'; c.fillRect(0, 0, w, h); speck(c, w, h, 4000, 0.1); speck(c, w, h, 1500, 0.08, false); c.fillStyle = 'rgba(60,60,60,.25)'; for (let y = 0; y < h; y += 77) c.fillRect(0, y, w, 1.5); for (let i = 0; i < 18; i++) { c.fillStyle = 'rgba(0,0,0,.04)'; c.beginPath(); c.ellipse(Math.random() * w, Math.random() * h, 10 + Math.random() * 40, 6 + Math.random() * 20, 0, 0, 7); c.fill(); } });
  const roof = ctex(128, 128, (c, w, h) => { c.fillStyle = '#b9bec2'; c.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 32) { c.fillStyle = '#e9ecee'; c.fillRect(x, 0, 3, h); c.fillStyle = '#8a9095'; c.fillRect(x + 3, 0, 2, h); } speck(c, w, h, 300, 0.08); });
  const std = (key, o) => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, ...o }); m.userData.key = key; return atmos(m); };
  // curtain wall: metric uv (u along, v up); mullions 1.8 m, transoms 3.6 m; sky reflection (fresnel) + warm lit floors at night
  const glass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.1 }); glass.defines = { USE_UV: '' }; glass.userData.key = 'cwall';
  glass.onBeforeCompile = sh => {
    sh.uniforms.uNight = ATM.uNight;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight; float gFrame = 0.0, gRnd = 0.0;\n' + NOISE_GLSL)
      .replace('#include <map_fragment>', `{ vec2 gp = vUv; float mx = abs(fract(gp.x / 1.8 + 0.5) - 0.5) * 1.8, my = abs(fract(gp.y / 3.6 + 0.5) - 0.5) * 3.6;
        gFrame = 1.0 - smoothstep(0.04, 0.07, mx) * smoothstep(0.055, 0.09, my); gRnd = h12(floor(gp / vec2(1.8, 3.6)) + 7.0);
        diffuseColor.rgb = mix(vec3(0.03, 0.045, 0.05), vec3(0.24, 0.25, 0.26), gFrame); }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.04, 0.45, gFrame);').replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(0.05, 0.6, gFrame);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { vec3 Nw = normalize(inverseTransformDirection(normal, viewMatrix)); vec3 Vw = normalize(vAtmRel); vec3 Rw = reflect(Vw, Nw);
        float fr = 0.05 + 0.95 * pow(1.0 - clamp(dot(-Vw, Nw), 0.0, 1.0), 5.0);
        vec3 sk = atmSky(normalize(vec3(Rw.x, max(Rw.y, 0.03), Rw.z))); sk = mix(sk * vec3(0.32, 0.31, 0.29), sk, smoothstep(-0.08, 0.06, Rw.y));
        vec3 room = uNight * step(0.28, gRnd) * vec3(1.0, 0.8, 0.55) * (0.5 + 0.7 * gRnd) * 1.4 + (1.0 - uNight) * vec3(0.035, 0.04, 0.04) * (0.6 + 0.8 * gRnd);
        totalEmissiveRadiance += (1.0 - gFrame) * (sk * (0.18 + 0.82 * fr) * 0.75 + room * vColor); }`);
  };
  const sign = new THREE.MeshBasicMaterial({ vertexColors: true }); sign.userData.key = 'bldSign';
  MT = { panel: std('bldPanel', { map: panel, roughness: 0.55, metalness: 0.15 }), conc: std('bldConc', { map: conc, roughness: 0.92 }), roof: std('bldRoof', { map: roof, roughness: 0.4, metalness: 0.45 }),
    dark: std('bldDark', { roughness: 0.75 }), car: std('bldCar', { roughness: 0.3, metalness: 0.35 }), metal: std('bldMetal', { roughness: 0.35, metalness: 0.6 }), glass: atmos(glass), sign: atmos(sign), lamp: atmos(Object.assign(new THREE.MeshBasicMaterial({ vertexColors: true }), { userData: { key: 'bldLamp' } })) };
  return MT;
}

// ---------------------------------------------------------------- bucket: merge per material, metric box uv (in local space), vertex colour
class Bk {
  constructor() { this.L = {}; }
  add(key, g, m, col = 0xffffff, s = 3, uv = 'box') {
    if (g.index) g = g.toNonIndexed(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals(); const n = g.attributes.position.count, P = g.attributes.position, N = g.attributes.normal;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2)); const U = g.attributes.uv;
    if (uv === 'box') for (let i = 0; i < n; i++) { const ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i)), az = Math.abs(N.getZ(i)), x = P.getX(i), y = P.getY(i), z = P.getZ(i); if (ay >= ax && ay >= az) U.setXY(i, x / s, z / s); else if (ax >= az) U.setXY(i, z / s, y / s); else U.setXY(i, x / s, y / s); }
    else if (uv === 'metric') { const [su, sv] = s; for (let i = 0; i < n; i++) U.setXY(i, U.getX(i) * su, U.getY(i) * sv); }
    else if (Array.isArray(uv)) { const [u0, v0, u1, v1] = uv; for (let i = 0; i < n; i++) U.setXY(i, u0 + (u1 - u0) * U.getX(i), v0 + (v1 - v0) * U.getY(i)); }
    if (m) g.applyMatrix4(m);
    const c = col instanceof THREE.Color ? col : C(col), A = new Float32Array(n * 3); for (let i = 0; i < n; i++) { A[i * 3] = c.r; A[i * 3 + 1] = c.g; A[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(A, 3)); (this.L[key] ||= []).push(g); return this;
  }
  geo(key) { const L = this.L[key]; if (!L || !L.length) return null; const g = mergeGeometries(L); delete this.L[key]; return g; }
  build(parent, shadow) { const mt = bldMats(); for (const k of Object.keys(this.L)) { const g = this.geo(k); if (!g) continue; const m = new THREE.Mesh(g, mt[k]); m.castShadow = shadow && !['glass', 'sign', 'lamp'].includes(k); m.receiveShadow = shadow; m.frustumCulled = false; m.name = 'bld-' + k; parent.add(m); } }
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (a, b, h, s = 16, open = false) => new THREE.CylinderGeometry(a, b, h, s, 1, open);
// glass plane with metric uv (w x h), facing +z before m
const gplane = (B, w, h, m, tint = 0xffffff) => B.add('glass', new THREE.PlaneGeometry(w, h), m, tint, [w, h], 'metric');
// extrude a (z, y) profile along x (width), centred
function prof(pts, width) { const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))); const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 6 }); g.translate(0, 0, -width / 2); g.rotateY(-H); return g; }

// ---------------------------------------------------------------- sign atlas (per airport)
function signAtlas(apt, gates, taxiTexts) {
  const A = new Atlas(1024, 1024), c = A.c;
  const F = (s, w = 700) => `${w} ${s}px "Saira Condensed", "Arial Narrow", "Roboto Condensed", sans-serif`;
  const txt = (s, x, y, size, col, al = 'center', w = 700) => { c.fillStyle = col; c.font = F(size, w); c.textAlign = al; c.textBaseline = 'middle'; c.fillText(s, x, y); };
  const name = (apt.name || apt.icao).replace(/\bAirport\b/i, '').trim().toUpperCase().slice(0, 42);
  A.cell('name', 1024, 96, (c, w, h) => { c.fillStyle = '#1d232b'; c.fillRect(0, 0, w, h); txt(name, w / 2, h / 2 + 2, name.length > 30 ? 46 : 58, '#f3f4f5'); });
  A.cell('nameL', 1024, 96, (c, w, h) => { c.fillStyle = '#f3f4f5'; c.fillRect(0, 0, w, h); txt('DEPARTURES  ·  ' + (apt.iata || apt.icao), w / 2, h / 2 + 2, 54, '#1d232b'); });
  for (const gname of gates) A.cell('g' + gname, 96, 96, (c, w, h) => { c.fillStyle = '#20262e'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffd34d'; c.fillRect(0, h - 10, w, 10); txt(String(gname), w / 2, h / 2 - 3, 60, '#ffffff'); });
  A.cell('fire', 512, 80, (c, w, h) => { c.fillStyle = '#b3141a'; c.fillRect(0, 0, w, h); txt('FIRE & RESCUE', w / 2, h / 2 + 2, 52, '#fff'); });
  for (let i = 1; i <= 4; i++) A.cell('hangar' + i, 256, 80, (c, w, h) => { c.fillStyle = '#2b3138'; c.fillRect(0, 0, w, h); txt('HANGAR ' + i, w / 2, h / 2 + 2, 50, '#f3f4f5'); });
  A.cell('cargo', 512, 80, (c, w, h) => { c.fillStyle = '#1f3c5a'; c.fillRect(0, 0, w, h); txt('CARGO TERMINAL', w / 2, h / 2 + 2, 50, '#fff'); });
  A.cell('park', 256, 128, (c, w, h) => { c.fillStyle = '#1f4fa0'; c.fillRect(0, 0, w, h); txt('P', 60, h / 2 + 4, 110, '#fff'); txt('PARKING', 170, h / 2 + 2, 34, '#fff'); });
  A.cell('shutter', 128, 128, (c, w, h) => { c.fillStyle = '#c9ccce'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 6) { c.fillStyle = '#8f9599'; c.fillRect(0, y, w, 1.5); } speck(c, w, h, 200, 0.15); });
  A.cell('redDoor', 128, 128, (c, w, h) => { c.fillStyle = '#b7171d'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 6) { c.fillStyle = '#7d0d12'; c.fillRect(0, y, w, 1.5); } c.fillStyle = 'rgba(255,255,255,.75)'; for (let i = 0; i < 4; i++) c.fillRect(10 + i * 28, h * 0.45, 20, 12); });
  A.cell('hdoor', 128, 128, (c, w, h) => { c.fillStyle = '#9aa1a8'; c.fillRect(0, 0, w, h); c.fillStyle = '#6b7279'; for (let x = 0; x < w; x += 16) c.fillRect(x, 0, 2, h); for (let y = 0; y < h; y += 32) c.fillRect(0, y, w, 1); speck(c, w, h, 300, 0.12); });
  A.cell('wsock', 32, 128, (c, w, h) => { for (let i = 0; i < 5; i++) { c.fillStyle = i % 2 ? '#f4f4f4' : '#ff5a14'; c.fillRect(0, i * h / 5, w, h / 5); } });
  // taxiway signs: hold (white on red), location (yellow on black), direction (black on yellow)
  for (const t of taxiTexts) A.cell(t.key, t.w * 64, 48, (c, w, h) => {
    if (t.kind === 'hold') { c.fillStyle = '#c4161c'; c.fillRect(0, 0, w, h); txt(t.text, w / 2, h / 2 + 2, 36, '#fff'); }
    else if (t.kind === 'loc') { c.fillStyle = '#111'; c.fillRect(0, 0, w, h); c.strokeStyle = '#f5c400'; c.lineWidth = 3; c.strokeRect(5, 5, w - 10, h - 10); txt(t.text, w / 2, h / 2 + 2, 34, '#f5c400'); }
    else { c.fillStyle = '#f5c400'; c.fillRect(0, 0, w, h); txt(t.text, w / 2, h / 2 + 2, 34, '#111'); } });
  A.texture(); return A;
}

// ---------------------------------------------------------------- jet bridges (instanced; one draw call per part for the whole airport)
function bridgeParts() {
  const W = 0xe6e8ea, G = 0x8c939a, D = 0x2a2f35, Y = 0xe2ad15, P = {};
  const one = f => { const B = new Bk(); f(B); return B.geo('panel'); };
  P.col = one(B => { B.add('panel', cyl(0.9, 1.1, 1, 14).translate(0, 0.5, 0), null, G, 2); });
  P.drum = one(B => { B.add('panel', cyl(2.6, 2.6, 3.3, 20).translate(0, 1.65, 0), null, W); B.add('panel', cyl(2.65, 2.65, 1.1, 20, true).translate(0, 1.9, 0), null, D); B.add('panel', cyl(2.9, 2.9, 0.3, 20).translate(0, 3.4, 0), null, G); });
  P.link = one(B => { B.add('panel', box(3.2, 3.4, 10), M4(0, 1.7, 0), W); for (const s of [-1, 1]) B.add('panel', box(0.02, 1.2, 9.6), M4(s * 1.61, 1.95, 0), D); B.add('panel', box(3.4, 0.25, 10.2), M4(0, 3.45, 0), G); });
  const tunnel = (w, h, L, z0) => one(B => { B.add('panel', box(w, h, L), M4(0, h / 2, z0 + L / 2), W, 3); for (const s of [-1, 1]) B.add('panel', box(0.03, 0.9, L - 0.6), M4(s * (w / 2 + 0.01), h * 0.6, z0 + L / 2), D);
    for (let z = z0 + 0.6; z < z0 + L; z += 2.4) B.add('panel', box(w + 0.12, h + 0.12, 0.14), M4(0, h / 2, z), 0xd2d5d8); B.add('panel', box(w * 0.6, 0.12, L), M4(0, h + 0.06, z0 + L / 2), G); B.add('panel', box(w, 0.2, L), M4(0, -0.1, z0 + L / 2), G); });
  P.tunA = tunnel(2.9, 2.9, 14, -14); P.tunB = tunnel(3.25, 3.25, 13, 0);
  P.cab = one(B => { B.add('panel', box(3.8, 3.3, 3.2), M4(0, 1.65, -1.6), W); for (const s of [-1, 1]) B.add('panel', box(0.03, 1.2, 2.2), M4(s * 1.91, 2.0, -1.6), D);
    for (let i = 0; i < 6; i++) B.add('panel', box(3.6 - i * 0.05, 3.1 - i * 0.04, 0.18), M4(0, 1.6, -3.3 - i * 0.2), i % 2 ? 0x1c1f23 : 0x30353b);
    B.add('panel', box(3.2, 0.25, 0.4), M4(0, 0.1, -4.4), Y); B.add('panel', box(0.9, 0.7, 0.8), M4(1.4, 0.1, -1.0), G); });
  P.legs = one(B => { for (const s of [-1, 1]) B.add('panel', box(0.32, 1, 0.32), M4(s * 1.1, 0.5, 0), G, 2); B.add('panel', box(2.6, 0.35, 0.5), M4(0, 0.95, 0), G); });
  P.bogie = one(B => { B.add('panel', box(2.8, 0.5, 1.1), M4(0, 0.85, 0), Y); for (const s of [-1, 1]) { B.add('panel', new THREE.TorusGeometry(0.42, 0.18, 8, 16).rotateY(H), M4(s * 1.15, 0.6, 0), 0x1b1c1e); B.add('panel', cyl(0.3, 0.3, 0.3, 12).rotateZ(H), M4(s * 1.15, 0.6, 0), 0x8a9096); } });
  return P;
}
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _mm = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const setM = (im, i, x, y, z, yaw, pitch = 0, sx = 1, sy = 1, sz = 1) => { _q.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ')); im.setMatrixAt(i, _mm.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz))); };
// stands: [{ x, z, s, parkS (aircraft scale or 0) }], frame f; floor y of the terminal departure level
export function buildBridges(group, stands, f, along, floorY = 4.6) {
  const P = bridgeParts(), mat = bldMats().panel, n = stands.length; if (!n) return null;
  const IM = {}; for (const k in P) { IM[k] = new THREE.InstancedMesh(P[k], mat, n); IM[k].frustumCulled = false; IM[k].castShadow = true; IM[k].receiveShadow = true; group.add(IM[k]); }
  const nx = f.nx, nz = f.nz, lx = -nz, lz = nx; // n = toward the runway, l = aircraft left (aircraft nose faces -n)
  const B = stands.map((st, i) => {
    const F1 = along(st.s, f.dep / 2 + 6), F0 = { x: F1.x + lx * 6.98, z: F1.z + lz * 6.98 }, s = st.parkS || 1, dsx = st.x - nx * (2 + 13 * s) + lx * 1.98 * s, dsz = st.z - nz * (2 + 13 * s) + lz * 1.98 * s;
    const R = { x: F0.x + nx * 10, z: F0.z + nz * 10 };
    const dock = { x: dsx + lx * 0.4, z: dsz + lz * 0.4, y: st.parkS ? 3.05 * s : 2.85, yaw: Math.atan2(lx, lz) }; // cab back sits outboard of the door; cab faces the fuselage (-l)
    const u0 = Math.atan2(-(dock.x - R.x), -(dock.z - R.z)); const ret = { yaw: u0 - 0.42, L: 16.5, y: 3.6 };
    const b = { i, st, R, dock, ret, e: st.parkS ? 1 : 0, target: st.parkS ? 1 : 0, hidden: false, F0 };
    st.jb = new THREE.Object3D(); st.jb.name = 'jetbridge';
    Object.defineProperty(st.jb, 'visible', { get: () => !b.hidden, set: v => { b.hidden = !v; pose(b); } });
    st.jb.userData.setDocked = v => { b.target = v ? 1 : 0; b.t0 = performance.now(); anim.add(b); };
    return b;
  });
  const pose = b => {
    const i = b.i; if (b.hidden) { for (const k in IM) { IM[k].setMatrixAt(i, ZERO); IM[k].instanceMatrix.needsUpdate = true; } return; }
    const e = b.e * b.e * (3 - 2 * b.e), R = b.R, d = b.dock, fy = floorY;
    // cab position: retracted = along the swung tunnel at 16.5 m; docked = at the door
    const rx = R.x - Math.sin(b.ret.yaw) * b.ret.L, rz = R.z - Math.cos(b.ret.yaw) * b.ret.L;
    const cx = rx + (d.x - rx) * e, cz = rz + (d.z - rz) * e, cy = b.ret.y + (d.y - b.ret.y) * e;
    const dx = cx - R.x, dz = cz - R.z, Lh = Math.hypot(dx, dz), yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(cy - fy, Lh), Ls = Math.hypot(Lh, cy - fy);
    let dy = yaw - d.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); const cabYaw = yaw - dy * e; // cab turns to face the fuselage as it docks
    setM(IM.col, i, R.x, 0, R.z, 0, 0, 1, fy - 0.35, 1); setM(IM.drum, i, R.x, fy - 0.3, R.z, yaw);
    setM(IM.link, i, b.F0.x + nx * 3.7, fy - 0.3, b.F0.z + nz * 3.7, Math.atan2(nx, nz), 0, 1, 1, 0.74);
    setM(IM.tunA, i, R.x, fy - 0.2, R.z, yaw, pitch, 1, 1, Math.min(1, (Ls - 1) / 14));
    const ux = -Math.sin(yaw) * Math.cos(pitch), uy = Math.sin(pitch), uz = -Math.cos(yaw) * Math.cos(pitch);
    setM(IM.tunB, i, cx - ux * 0.2, cy - 0.35 - uy * 0.2, cz - uz * 0.2, yaw, pitch);
    setM(IM.cab, i, cx, cy - 0.35, cz, cabYaw);
    const bx = cx - ux * 3.2, bz = cz - uz * 3.2, by = cy - 0.35 - uy * 3.2 - 0.2; setM(IM.legs, i, bx, 0, bz, yaw, 0, 1, Math.max(0.5, by), 1); setM(IM.bogie, i, bx, 0, bz, yaw);
    for (const k in IM) IM[k].instanceMatrix.needsUpdate = true;
  };
  const anim = new Set(); let last = performance.now();
  IM.tunA.onBeforeRender = () => { const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; for (const b of anim) { const d = b.target - b.e; if (Math.abs(d) < 1e-3) { b.e = b.target; anim.delete(b); } else b.e += Math.sign(d) * Math.min(Math.abs(d), dt / 6); pose(b); } };
  B.forEach(pose); return { IM, B };
}

// ---------------------------------------------------------------- the rest of the airport art
// ctx: { apt, g, f (frame), along, stands, site, spot, lights, quality, full, R, taxiNet, ilsEnds, towerAt: {p, base, h}, hangarSpots: [p], dirs }
export function buildAirportArt(group, ctx) {
  const { apt, f, along, stands, lights, full, R } = ctx, q = ctx.quality, sh = q === 'high' || q === 'ultra';
  const B = new Bk(); const nx = f.nx, nz = f.nz, xA = V3(-nz, 0, nx), zA = V3(-nx, 0, -nz); // terminal frame: x along, z landside
  const TD = f.termDepth, TH = f.termH, Lw = f.L2 * 0.84, FL = 4.6;
  const O = along(0, f.dep / 2 + 6); const tq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, V3(0, 1, 0), zA));
  const TM = (x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(V3(O.x, 0, O.z).add(xA.clone().multiplyScalar(x)).add(zA.clone().multiplyScalar(z)).setY(y), tq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'))), V3(sx, sy, sz));
  const toT = p => ({ x: (p.x - O.x) * xA.x + (p.z - O.z) * xA.z, z: (p.x - O.x) * zA.x + (p.z - O.z) * zA.z });
  const gateNames = stands.map((s, i) => String(i + 1)), taxiTexts = [];
  if (full) for (const net of ctx.taxiNet) { const idt = `${net.r.a.ident}-${net.r.b.ident}`; taxiTexts.push({ key: 'h' + net.k, kind: 'hold', text: idt, w: 3 }); for (const c of [...net.conns, ...net.links]) { taxiTexts.push({ key: 'l' + c.name, kind: 'loc', text: c.name, w: 1 }); taxiTexts.push({ key: 'd' + c.name, kind: 'dir', text: '← ' + net.name + ' →', w: 2 }); } }
  const SA = signAtlas(apt, full ? gateNames : [], taxiTexts); const signMat = atmos(Object.assign(new THREE.MeshBasicMaterial({ vertexColors: true, map: SA.tex }), { userData: { key: 'bldSign' } }));
  const S = new Bk(); const sign = (name, w, h, m) => S.add('sign', new THREE.PlaneGeometry(w, h), m, 0xffffff, 1, SA.R[name]);
  // ---- terminal: apron-level service wall, curtain wall above, ends, landside wall, wave roof + overhang + columns, name signs
  B.add('panel', box(Lw, FL, 0.4), TM(0, FL / 2, 0.2), 0xd9dbdc, 3);
  for (let x = -Lw / 2 + 9; x < Lw / 2 - 4; x += 18) { B.add('dark', box(4.2, 3.4, 0.1), TM(x, 1.7, -0.02), 0x30353a); B.add('lamp', box(0.6, 0.15, 0.1), TM(x, 3.75, -0.05), C(0xffe7b0).multiplyScalar(1.6)); }
  gplane(B, Lw, TH - FL, TM(0, FL + (TH - FL) / 2, 0, PI));
  B.add('panel', box(Lw, 0.6, 0.8), TM(0, FL, 0), 0xb8bcc0, 3);
  for (const s of [-1, 1]) { gplane(B, TD, TH, TM(s * Lw / 2, TH / 2, TD / 2, s * H)); B.add('panel', box(0.6, TH, 0.6), TM(s * Lw / 2, TH / 2, 0), 0xc8cbcd); }
  gplane(B, Lw, TH, TM(0, TH / 2, TD));
  const rp = [[-9, TH + 1.0], [-9, TH + 1.9], [TD * 0.25, TH + 3.6], [TD * 0.6, TH + 3.9], [TD + 12, TH + 2.2], [TD + 12, TH + 1.5], [TD, TH + 0.3], [0, TH + 0.3]];
  B.add('roof', prof(rp, Lw + 10), TM(0, 0, 0), 0xd5d9dc, 2);
  for (let x = -Lw / 2 + 4; x <= Lw / 2 - 4; x += 18) { B.add('metal', cyl(0.22, 0.32, TH + 1.8 - FL, 10), TM(x, FL + (TH + 1.8 - FL) / 2, -7.2), 0xdfe2e4); B.add('metal', cyl(0.22, 0.32, TH + 2.2, 10), TM(x, (TH + 2.2) / 2, TD + 10), 0xdfe2e4); }
  sign('name', Math.min(60, Lw * 0.45), 5.6, TM(0, TH + 4.6, -5.5, PI)); B.add('metal', box(Math.min(60, Lw * 0.45), 0.25, 1.2), TM(0, TH + 1.9, -5.3), 0x6d747a); sign('nameL', Math.min(50, Lw * 0.4), 4.7, TM(0, TH + 4.4, TD + 9));
  // fixed links, stair towers and gate numbers at every stand
  stands.forEach((st, i) => { const F1 = along(st.s, f.dep / 2 + 6), p = toT({ x: F1.x - nz * 6.98, z: F1.z + nx * 6.98 }), lxT = p.x, sx = lxT + 4.4 * Math.sign(lxT - toT(F1).x || 1);
    B.add('panel', box(4.2, TH - FL - 1, 4.2), TM(sx, (TH - 1) / 2, -2.1), 0x5d646b, 3); B.add('dark', box(0.8, TH - 3, 0.02), TM(sx, (TH - 1) / 2, -4.22), 0x1b2026);
    if (full) sign('g' + gateNames[i], 3.2, 3.2, TM(lxT, Math.min(TH - 2.2, FL + 6.5), -0.25, PI)); });
  // ---- landside: departures deck with canopy, arrivals road, car park, cars
  const roadMat = 0x3a3b3d;
  if (full) {
    const LR = Lw / 2 + 140, landOK = ctx.spot([[0, f.dep / 2 + 6 + TD + 60]], Lw + 280, 110, ['rw', 'tw']);
    if (landOK) {
      B.add('dark', box(LR * 2, 0.1, 16), TM(0, 0.05, TD + 13), roadMat, 6); for (let x = -LR + 3; x < LR; x += 9) B.add('lamp', box(3, 0.02, 0.15), TM(x, 0.11, TD + 13), 0xd8d8d0);
      B.add('conc', box(Lw * 0.9, 0.7, 13), TM(0, FL - 0.35, TD + 8.5), 0x9c9c98, 4); B.add('conc', box(Lw * 0.9, 1.1, 0.3), TM(0, FL + 0.55, TD + 15), 0xa8a8a4, 4);
      for (let x = -Lw * 0.45 + 4; x < Lw * 0.45; x += 12) B.add('conc', box(0.8, FL - 0.7, 0.8), TM(x, (FL - 0.7) / 2, TD + 11), 0x9c9c98, 2);
      for (const s of [-1, 1]) B.add('conc', box(70, 0.6, 12), TM(s * (Lw * 0.45 + 34), FL / 2 - 0.3, TD + 8.5, 0, 0, s * Math.atan2(FL, 70)), 0x9c9c98, 4);
      B.add('roof', box(Lw * 0.9, 0.35, 7), TM(0, FL + 6.2, TD + 5.5), 0xdadde0, 2); for (let x = -Lw * 0.45 + 6; x < Lw * 0.45; x += 24) B.add('metal', cyl(0.18, 0.18, 6, 8), TM(x, FL + 3, TD + 8.6), 0xcfd3d6);
      // multi-storey car park
      const cpW = Math.min(Lw * 0.6, 220), cpZ = TD + 32, cpD = 56;
      for (let k = 0; k <= 4; k++) { B.add('conc', box(cpW, 0.4, cpD), TM(0, k * 3.2 + 0.2, cpZ + cpD / 2), 0xb9b8b3, 4); if (k) for (const s of [-1, 1]) B.add('conc', box(cpW, 1.0, 0.25), TM(0, k * 3.2 + 0.9, cpZ + (s > 0 ? cpD : 0)), 0xc9c8c3, 4); }
      for (let x = -cpW / 2 + 2; x < cpW / 2; x += 8.1) for (let z = 2; z < cpD; z += 9) B.add('conc', box(0.5, 12.8, 0.5), TM(x, 6.4, cpZ + z), 0xaeada8, 2);
      B.add('conc', box(14, 13.6, 10), TM(cpW / 2 + 7, 6.8, cpZ + 10), 0xa8a7a2, 4); sign('park', 6, 3, TM(cpW / 2 + 7, 11, cpZ + 4.9, PI));
      // parked + moving cars
      const carG = (() => { const b = new Bk(); b.add('panel', box(1.8, 0.75, 4.4), M4(0, 0.6, 0), 0xffffff, 3); b.add('panel', box(1.6, 0.6, 2.2), M4(0, 1.2, 0.2), 0x2a333c, 3); for (const sx of [-0.85, 0.85]) for (const sz of [-1.4, 1.4]) b.add('panel', cyl(0.33, 0.33, 0.25, 8).rotateZ(H), M4(sx, 0.33, sz), 0x161616); return b.geo('panel'); })();
      const COL = [0xe8e8e8, 0x1a1a1a, 0x8c949c, 0x7a1d1d, 0x1d3557, 0xc0c4c8, 0x2f4f3a, 0xd9d2c3];
      const nPark = Math.min(220, Math.floor((cpW / 2.6) * 2 * 5 * 0.55)), nMove = 24, cars = new THREE.InstancedMesh(carG, bldMats().car, nPark + nMove); cars.frustumCulled = false; cars.castShadow = sh; group.add(cars);
      let ci = 0; const cc = new THREE.Color();
      for (let k = 0; k < 5 && ci < nPark; k++) for (const row of [cpZ + 6, cpZ + cpD - 6]) for (let x = -cpW / 2 + 3; x < cpW / 2 - 3 && ci < nPark; x += 2.6) { if (R() < 0.42) continue; const m = TM(x, k * 3.2 + 0.4, row + (R() - 0.5) * 0.3, (R() - 0.5) * 0.06); cars.setMatrixAt(ci, m); cars.setColorAt(ci++, cc.set(COL[(R() * COL.length) | 0])); }
      const mv = []; for (let j = 0; j < nMove; j++) { mv.push({ lane: j % 3, s: R() * LR * 2, v: 9 + R() * 5, i: ci }); cars.setColorAt(ci++, cc.set(COL[(R() * COL.length) | 0])); }
      for (let j = ci; j < nPark + nMove; j++) cars.setMatrixAt(j, ZERO);
      let last = performance.now(); cars.onBeforeRender = () => { const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; for (const c of mv) { c.s = (c.s + c.v * dt) % (LR * 2); const dir = c.lane === 2 ? -1 : 1, x = dir > 0 ? -LR + c.s : LR - c.s; const deck = c.lane === 0 && Math.abs(x) < Lw * 0.45; cars.setMatrixAt(c.i, TM(x, deck ? FL : 0.05, TD + (c.lane === 0 ? (deck ? 6 : 9.5) : c.lane === 1 ? 13 : 17.5), dir > 0 ? -H : H)); } cars.instanceMatrix.needsUpdate = true; };
      if (cars.instanceColor) cars.instanceColor.needsUpdate = true;
    }
  }
  // ---- control tower (spot chosen by airport.js through the Site)
  { const { p, base, h } = ctx.towerAt; const T0 = (x, y, z, ry = 0) => M4(p.x + x, base + y, p.z + z, ry);
    if (!base) { B.add('panel', box(26, 8, 22), T0(0, 4, 0, Math.atan2(-f.adz, f.adx)), 0xd0d2d3, 3); }
    const prof2 = [[4.6, 0], [4.2, h * 0.3], [3.4, h * 0.82], [3.4, h - 6]].map(([r, y]) => new THREE.Vector2(r, y));
    B.add('conc', new THREE.LatheGeometry(prof2, 20), T0(0, 0, 0), 0xe2e1dc, 3);
    for (let i = 0; i < 8; i++) { const a = i / 8 * PI * 2; B.add('conc', box(0.5, h - 6, 0.7), T0(Math.cos(a) * 3.9, (h - 6) / 2, Math.sin(a) * 3.9, -a), 0xd2d1cc, 3); }
    B.add('panel', cyl(6.2, 4.4, 5, 20), T0(0, h - 4.5, 0), 0xdcdfe1, 3); B.add('dark', cyl(6.25, 6.25, 0.9, 20, true), T0(0, h - 3, 0), 0x22272c);
    B.add('panel', cyl(6.9, 6.9, 0.5, 20), T0(0, h - 1.8, 0), 0xc9ccce);
    { const cab = new THREE.CylinderGeometry(8.2, 6.6, 5.2, 12, 1, true); B.add('glass', cab, T0(0, h + 1.1, 0), 0xb8f0d8, [2 * PI * 7.4, 5.2], 'metric'); }
    B.add('roof', cyl(8.8, 8.4, 1.1, 12), T0(0, h + 4.25, 0), 0xd5d8da, 2); B.add('metal', cyl(9.2, 9.2, 0.12, 24, true), T0(0, h - 1.45, 0), 0x9aa0a6);
    for (const [x, z, hh] of [[2, 1, 9], [-2.5, -1.5, 6], [0.5, -3, 4.5]]) B.add('metal', cyl(0.07, 0.12, hh, 6), T0(x, h + 4.8 + hh / 2, z), 0xcfd3d6);
    lights.add(p.x + 2, base + h + 13.8, p.z + 1, [1, 0.08, 0.05], 0, [0, 0, 0], [1, 0.08, 0.05], 0, 1.4); }
  if (full) {
    // ---- hangars (arched roof, ribbed door, office annex, sign)
    (ctx.hangarSpots || []).forEach((hp, i) => { const yaw = Math.atan2(-f.adz, f.adx) + H; const HM = (x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().makeRotationY(yaw).premultiply(new THREE.Matrix4().makeTranslation(hp.x, 0, hp.z)).multiply(M4(x, y, z, ry, rx, rz, sx, sy, sz));
      // door faces the apron: hangar local -z = toward the apron (+n)
      B.add('panel', box(72, 14, 78), HM(0, 7, 0), 0xc7ccd1, 3);
      const cy0 = 14 - 40 * Math.cos(H * 0.62) * 0.45, SQ = new THREE.Matrix4().makeScale(1, 0.45, 1);
      B.add('roof', new THREE.CylinderGeometry(40, 40, 78, 24, 1, true, -H * 0.62, H * 1.24), HM(0, cy0, 0).multiply(SQ).multiply(new THREE.Matrix4().makeRotationX(-H)), 0xbfc4c8, 2);
      for (let z = -36; z <= 36; z += 9) B.add('metal', new THREE.TorusGeometry(40, 0.25, 4, 24, H * 1.24).rotateZ(H - H * 0.62), HM(0, cy0, z).multiply(SQ), 0x8f969c);
      S.add('sign', new THREE.PlaneGeometry(66, 15), HM(0, 7.5, -39.05, PI), 0xffffff, 1, SA.R.hdoor);
      B.add('dark', box(68, 0.6, 0.6), HM(0, 15.2, -39.1), 0x2b3036); sign('hangar' + Math.min(4, i + 1), 12, 3.75, HM(0, 17.4, -39.2, PI));
      B.add('panel', box(14, 9, 60), HM(43, 4.5, 6), 0xd9dcdf, 3); for (let y = 2.4; y < 9; y += 3.4) B.add('dark', box(0.05, 1.3, 56), HM(50.03, y, 6), 0x23292f);
      B.add('conc', box(80, 0.08, 30), HM(0, 0.04, -55), 0xa9a7a1, 4); });
    // ---- fire station, cargo terminal (placed through the Site)
    const main = [...ctx.g.runways].sort((a, b) => b.L - a.L)[0];
    { const yaw = Math.atan2(-f.adz, f.adx); const c0 = ctx.spot([[f.L2 / 2 + 300, f.dep / 2 - 10], [-f.L2 / 2 - 600, f.dep / 2 - 10], [f.L2 / 2 + 420, f.dep / 2 + 60], [-f.L2 / 2 - 720, f.dep / 2 + 60]], 52, 40);
      if (c0) { const FM = (x, y, z, ry = 0) => M4(c0.x, 0, c0.z).multiply(M4(0, 0, 0, yaw)).multiply(M4(x, y, z, ry));
        B.add('panel', box(44, 8, 20), FM(0, 4, 0), 0xe9e4dc, 3); B.add('panel', box(14, 4.5, 14), FM(-12, 10.2, 2), 0xd8d2c8, 3); gplane(B, 14, 3, FM(-12, 10.4, -5.02, PI));
        for (let i = 0; i < 5; i++) S.add('sign', new THREE.PlaneGeometry(6.4, 5.6), FM(-16 + i * 8, 2.8, -10.03, PI), 0xffffff, 1, SA.R.redDoor);
        sign('fire', 18, 2.8, FM(6, 6.8, -10.05, PI)); B.add('panel', box(4, 18, 4), FM(20, 9, 6), 0xb3141a, 2); B.add('conc', box(52, 0.08, 26), FM(0, 0.04, -23), 0xa9a7a1, 4); } }
    { const yaw = Math.atan2(-f.adz, f.adx); const c0 = ctx.spot([[-f.L2 / 2 - 380, f.dep / 2 + 40], [f.L2 / 2 + 640, f.dep / 2 + 40], [-f.L2 / 2 - 520, f.dep / 2 + 150], [f.L2 / 2 + 780, f.dep / 2 + 150]], 150, 70);
      if (c0) { const CM = (x, y, z, ry = 0) => M4(c0.x, 0, c0.z).multiply(M4(0, 0, 0, yaw)).multiply(M4(x, y, z, ry)); const nzs = new THREE.Vector3(0, 0, -1).applyMatrix4(new THREE.Matrix4().makeRotationY(yaw)); const fl = (nzs.x * f.nx + nzs.z * f.nz) > 0 ? 1 : -1; // docks face the apron
        B.add('panel', box(140, 14, 60), CM(0, 7, 0), 0xc4ccd4, 3); B.add('roof', box(142, 0.6, 62), CM(0, 14.2, 0), 0xb7bcc0, 2);
        for (let i = 0; i < 12; i++) { S.add('sign', new THREE.PlaneGeometry(5, 4.6), CM(-60 + i * 11, 2.6, fl * -30.03, fl > 0 ? PI : 0), 0xffffff, 1, SA.R.shutter); B.add('dark', box(6.4, 0.3, 1.2), CM(-60 + i * 11, 5.2, fl * -30.6), 0x2b3036); }
        sign('cargo', 28, 4.4, CM(0, 10.5, fl * -30.06, fl > 0 ? PI : 0)); B.add('conc', box(150, 0.08, 50), CM(0, 0.04, fl * -56), 0xaaa8a2, 4); } }
    // ---- floodlight masts behind the stands (between stands), with lit heads
    for (let k = 0; k <= stands.length; k++) { const s0 = stands.length ? (k < stands.length ? stands[k].s - 32.5 : stands[stands.length - 1].s + 32.5) : 0; const p = along(s0, f.dep / 2 - 45 - 35);
      B.add('metal', new THREE.LatheGeometry([[0.45, 0], [0.4, 10], [0.24, 32]].map(([r, y]) => new THREE.Vector2(r, y)), 10), M4(p.x, 0, p.z), 0x9ca2a8);
      B.add('dark', box(4.4, 1.2, 0.5), M4(p.x, 32.4, p.z, Math.atan2(-f.adz, f.adx)), 0x3a3f45); for (let j = -1.5; j <= 1.5; j += 1) B.add('lamp', box(0.8, 0.5, 0.05), M4(p.x + nx * 0.28 + f.adx * j, 32.2, p.z + nz * 0.28 + f.adz * j, Math.atan2(nx, nz)), C(0xfff1d6).multiplyScalar(1.4));
      lights.add(p.x + nx * 0.6, 32.2, p.z + nz * 0.6, [1, 0.86, 0.62], 0, [0, 0, 0], [1, 0.86, 0.62], 0, 2.6); }
    // ---- runway furniture: windsocks, ILS antennas, approach-light stanchions, taxiway signs
    const ends = ctx.g.ends || [];
    for (const r of ctx.g.runways) for (const E of [r.a, r.b]) {
      const d = E.dir, ex = -d.z, ez = d.x, sd = Math.sign((f.ax - r.cx) * ex + (f.az - r.cz) * ez) || 1, side = -sd; // the side away from the terminal
      const tx = E.thrX ?? E.x, tz = E.thrZ ?? E.z;
      { const x = tx + d.x * 320 + ex * side * (r.W / 2 + 75), z = tz + d.z * 320 + ez * side * (r.W / 2 + 75); B.add('metal', cyl(0.06, 0.09, 6.2, 6), M4(x, 3.1, z), 0xd0d0d0);
        const sock = new THREE.CylinderGeometry(0.45, 0.18, 3.2, 12, 1, true).rotateZ(-H).translate(1.65, 0, 0); S.add('sign', sock, M4(x, 6.0, z, Math.atan2(d.x, d.z) + H, 0, -0.18), 0xffffff, 1, SA.R.wsock);
        B.add('conc', cyl(3, 3, 0.15, 16), M4(x, 0.07, z), 0xe8e8e8); }
      if (!ctx.ilsEnds.includes(E)) continue;
      { const o = E.other, lx0 = (o.thrX ?? o.x) + d.x * 260, lz0 = (o.thrZ ?? o.z) + d.z * 260; // localizer beyond the far end
        for (let k = -7; k <= 7; k++) { const x = lx0 + ex * k * 2.4, z = lz0 + ez * k * 2.4; B.add('metal', cyl(0.05, 0.05, 2.6, 5), M4(x, 1.3, z), 0x9aa0a6); B.add('metal', box(0.1, 0.9, 1.4), M4(x, 2.6, z, Math.atan2(d.x, d.z)), 0xd6d9db); }
        B.add('metal', box(0.15, 0.15, 34), M4(lx0, 1.2, lz0, Math.atan2(ex, ez)), 0x7d848b); B.add('panel', box(3, 2.6, 2.4), M4(lx0 + d.x * 12, 1.3, lz0 + d.z * 12, Math.atan2(d.x, d.z)), 0xd9dcde, 2); }
      { const x = tx + d.x * 300 + ex * side * (r.W / 2 + 115), z = tz + d.z * 300 + ez * side * (r.W / 2 + 115); B.add('metal', box(0.6, 15, 0.6), M4(x, 7.5, z), 0xc23b22); for (const y of [5, 8.5, 12.5]) B.add('metal', box(1.6, 0.7, 0.3), M4(x - d.x * 0.5, y, z - d.z * 0.5, Math.atan2(d.x, d.z)), 0xe6e6e6); B.add('panel', box(2.4, 2.4, 2.2), M4(x + ex * side * 3, 1.2, z + ez * side * 3), 0xd9dcde, 2); }
      if (r.L > 1800 && r.W >= 44) for (let k = 1; k <= 30; k++) { const x = tx - d.x * 30 * k, z = tz - d.z * 30 * k, hh = 0.8; B.add('metal', cyl(0.05, 0.07, hh, 5), M4(x, hh / 2, z), 0xcfa520); B.add('metal', box(k === 10 ? 30 : 4.6, 0.08, 0.08), M4(x, hh, z, Math.atan2(ex, ez)), 0x7d848b); }
    }
    for (const net of ctx.taxiNet) { const r = net.r; for (const c of [...net.conns, ...net.links]) {
      const ax = c.b.x - c.a.x, az = c.b.z - c.a.z, L = Math.hypot(ax, az) || 1, ux = ax / L, uz = az / L, rx = -uz, rz = ux; const isConn = net.conns.includes(c);
      if (isConn) { const k = Math.min(0.9, (r.W / 2 + 70) / L); const hx = c.a.x + ax * k, hz = c.a.z + az * k; // hold position: sign on the left side facing the pilot leaving the taxiway
        const sx = hx + rx * 16, sz = hz + rz * 16, yaw = Math.atan2(ux, uz); // faces the pilot taxiing from the parallel taxiway toward the runway
        for (const [nm, w, off] of [['h' + net.k, 3, -0.6], ['l' + c.name, 1, 1.6]]) S.add('sign', new THREE.PlaneGeometry(w * 1.05, 0.95), M4(sx + rx * off + ux * 0.16, 1.0, sz + rz * off + uz * 0.16, yaw), 0xffffff, 1, SA.R[nm]);
        B.add('dark', box(4.8, 1.2, 0.3), M4(sx, 1.0, sz, yaw), 0x1c1d20); for (const o of [-1.8, 1.8]) B.add('metal', cyl(0.05, 0.05, 0.5, 6), M4(sx + rx * o, 0.25, sz + rz * o), 0x9aa0a6);
        for (const sg of [-1, 1]) lights.add(hx + rx * sg * 13.5, 0.6, hz + rz * sg * 13.5, [1, 0.75, 0.1], 3, [ux, 0, uz], [1, 0.75, 0.1], sg > 0 ? 0 : 15, 0.9);
        for (let t = -10; t <= 10; t += 2.5) lights.add(hx + rx * t, 0.15, hz + rz * t, [1, 0.06, 0.04], 1, [ux, 0, uz], [1, 0.06, 0.04], 0, 0.55); }
      const dx = c.b.x - ux * 30 + rx * 17, dz = c.b.z - uz * 30 + rz * 17, yaw2 = Math.atan2(-ux, -uz);
      S.add('sign', new THREE.PlaneGeometry(2.1, 0.95), M4(dx - ux * 0.16, 1.0, dz - uz * 0.16, yaw2), 0xffffff, 1, SA.R['d' + c.name]); B.add('dark', box(2.3, 1.2, 0.3), M4(dx, 1.0, dz, yaw2), 0x1c1d20);
    } }
  }
  B.build(group, sh); S.build(group, false); group.children.filter(m => m.name === 'bld-sign').forEach(m => { m.material = signMat; });
  return { atlas: SA };
}
