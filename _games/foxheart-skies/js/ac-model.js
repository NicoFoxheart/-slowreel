// Foxheart narrow-body, PLAYER exterior (detailed). Built on the hull in ac-shape.js and painted by ac-livery.js:
// lofted hull with a blended belly fairing, framed cockpit + cabin windows, door handles, antennas, probes, APU exhaust;
// cranked supercritical wing (metal-LE slats, flaps with canoe fairings, ailerons, spoilers, static wicks, sharklets);
// high-bypass engines (lip, fan blades + spinner that spin with N1, core cowl, plug, translating reverser sleeve, pylon);
// trailing-link gear with torque links, twin wheels (tyres + hubs) and doors; lights; contrails; a far LOD.
// Same `parts` contract as the legacy builder in aircraft.js (animateAircraft drives both); the extra animation
// (reverser sleeves, nose doors, contrails, distance LOD) runs through parts.anim.
// Body frame: x = right wing, y = up, z = aft (nose at -z); wheels touch y = -3.62.
import * as THREE from 'three';
import { atmos } from './sky.js';
import { V3, clamp, smooth, lerp, rng, canvas, tex, latheZ, mergeAll, attr, boxUV, heightToNormal } from './ac-util.js';
import { NOSE_Z, TAIL_Z, HULL_L, SEC, hullPoint, hullNormal, thetaAt, WINDOWS, DOORS, DOOR, WIN_Y, GEAR } from './ac-shape.js';
import { fuselageMaps, finMaps, wingMaps, wingletMaps, nacelleMaps, spinnerTex, panelTile } from './ac-livery.js';
import { airlinerGeometry } from './ac-traffic.js';

const PI = Math.PI, D = PI / 180;
const _a = V3(), _b = V3(), _c = V3(), _n = V3(), _m = V3(), _n2 = V3();

// ================================================================ geometry helpers
// indexed (rows x cols) grid; pos(i, j) -> Vector3, uv(i, j) -> [u, v]
function sheet(rows, cols, pos, uv) {
  const P = new Float32Array(rows * cols * 3), U = new Float32Array(rows * cols * 2), I = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const k = i * cols + j, p = pos(i, j); P[k * 3] = p.x; P[k * 3 + 1] = p.y; P[k * 3 + 2] = p.z; if (uv) { const t = uv(i, j); U[k * 2] = t[0]; U[k * 2 + 1] = t[1]; } }
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; I.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals(); return g;
}
function flip(g) {
  if (g.index) { const I = g.index.array; for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; } g.index.needsUpdate = true; }
  else for (const key in g.attributes) { const A = g.attributes[key], s = A.itemSize, a = A.array; for (let v = 0; v + 2 < A.count; v += 3) for (let q = 0; q < s; q++) { const t = a[(v + 1) * s + q]; a[(v + 1) * s + q] = a[(v + 2) * s + q]; a[(v + 2) * s + q] = t; } }
  const N = g.attributes.normal; if (N) { for (let i = 0; i < N.array.length; i++) N.array[i] = -N.array[i]; N.needsUpdate = true; } return g;
}
// make the faces point along outward(centroid) on balance
function orient(g, outward) {
  const P = g.attributes.position, I = g.index ? g.index.array : null, n = I ? I.length : P.count; let s = 0;
  for (let k = 0; k + 2 < n; k += 3) { _a.fromBufferAttribute(P, I ? I[k] : k); _b.fromBufferAttribute(P, I ? I[k + 1] : k + 1); _c.fromBufferAttribute(P, I ? I[k + 2] : k + 2);
    _n.subVectors(_b, _a).cross(_m.subVectors(_c, _a)); _m.copy(_a).add(_b).add(_c).multiplyScalar(1 / 3); s += _n.dot(outward(_m)); }
  return s < 0 ? flip(g) : g;
}
const M4 = () => new THREE.Matrix4();
const colorise = (g, col) => attr(g.index ? g.toNonIndexed() : g, 'color', col);
// painted part: box-projected uv (metres / 2, for the panel tile) + vertex tint
const pv = (g, col = [0.9, 0.91, 0.92]) => colorise(boxUV(g, 2), col);
// flat triangle soup with explicit normals and uvs
class Soup {
  constructor() { this.P = []; this.N = []; this.U = []; }
  v(p, n, u = 0, w = 0) { this.P.push(p.x, p.y, p.z); this.N.push(n.x, n.y, n.z); this.U.push(u, w); }
  geo() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2)); return g; }
}
// superellipse loft along z: sec(t) -> { z, cx, cy, hx, hy, n }; closed ends optional
function loftZ(rows, segs, sec, capA = true, capB = true) {
  const S = []; for (let i = 0; i < rows; i++) S.push(sec(i / (rows - 1)));
  const pt = (s, j) => { const a = j / segs * PI * 2, ca = Math.cos(a), sa = Math.sin(a), e = 2 / (s.n || 2.5); return V3(s.cx + s.hx * Math.sign(sa) * Math.pow(Math.abs(sa), e), s.cy - s.hy * Math.sign(ca) * Math.pow(Math.abs(ca), e), s.z); };
  const g = sheet(rows, segs + 1, (i, j) => pt(S[i], j), (i, j) => [j / segs, i / (rows - 1)]);
  const list = [orient(g, m => { const s = S[Math.round(clamp((m.z - S[0].z) / ((S[rows - 1].z - S[0].z) || 1), 0, 1) * (rows - 1))]; return V3(m.x - s.cx, m.y - s.cy, 0); })];
  for (const [s, dir, on] of [[S[0], -1, capA], [S[rows - 1], 1, capB]]) { if (!on) continue; const P = [s.cx, s.cy, s.z], I = []; for (let j = 0; j < segs; j++) { const p = pt(s, j); P.push(p.x, p.y, p.z); I.push(0, 1 + j, 1 + (j + 1) % segs); }
    const c = new THREE.BufferGeometry(); c.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); c.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(P.length / 3 * 2), 2)); c.setIndex(I); c.computeVertexNormals(); list.push(orient(c, () => V3(0, 0, dir))); }
  return mergeAll(list);
}
// lathe around z, re-mapped so v = arc-length fraction of a longer profile (for banded nacelle textures)
function latheBand(prof, seg, v0, v1, flipN) { const g = latheZ(prof, seg, { uvLen: true, flip: flipN }); const U = g.attributes.uv; for (let i = 0; i < U.count; i++) U.setY(i, v0 + (v1 - v0) * U.getY(i)); return g; }
const arcLen = prof => { let L = 0; for (let i = 1; i < prof.length; i++) L += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]); return L; };

// ================================================================ hull (+ blended belly fairing)
const FAIR = { zA: -7.6, zB: 7.2, yc: -0.95, a: 2.2, b: 1.24, n: 2.8, k: 0.22 };
export function fairing(p) {
  const e = smooth(FAIR.zA, FAIR.zA + 3.4, p.z) * (1 - smooth(FAIR.zB - 5.4, FAIR.zB, p.z)); if (e <= 0) return p;
  const wy = 1 - smooth(-0.45, 0.3, p.y); if (wy <= 0) return p;
  const dx = p.x, dy = p.y - FAIR.yc, r = Math.hypot(dx, dy); if (r < 1e-5) return p;
  const ux = dx / r, uy = dy / r, rf = Math.pow(Math.pow(Math.abs(ux) / FAIR.a, FAIR.n) + Math.pow(Math.abs(uy) / FAIR.b, FAIR.n), -1 / FAIR.n);
  const sm = 0.5 * (r + rf + Math.sqrt((r - rf) ** 2 + FAIR.k ** 2)), rr = r + (sm - r) * e * wy;
  p.x = ux * rr; p.y = FAIR.yc + uy * rr; return p;
}
export function skin(z, th, off = 0, out = V3()) { hullPoint(z, th, out); fairing(out); if (off) out.addScaledVector(hullNormal(z, th, _n2), off); return out; }
const skinN = (z, th) => { const e = 2e-3; const a = skin(z + e, th), b = skin(z - e, th), c = skin(z, th + e), d = skin(z, th - e); const n = a.sub(b).cross(c.sub(d)).normalize(); return n.lengthSq() > 0.5 ? n : hullNormal(z, th); };

function hullGeo(hi) {
  const nd = hi ? [0, .008, .025, .05, .09, .14, .2, .28, .38, .5, .64, .8, 1, 1.22, 1.46, 1.72, 2, 2.3, 2.62, 2.96, 3.34, 3.76, 4.24, 4.8, 5.45, 6.2, 7.1]
    : [0, .04, .15, .35, .65, 1.05, 1.55, 2.15, 2.9, 3.8, 4.9, 6.2, 7.1];
  const zs = nd.map(d => NOSE_Z + d); const st = hi ? 0.55 : 1.5; for (let z = NOSE_Z + 7.1 + st; z < 9; z += st) zs.push(z); for (let z = 9; z < TAIL_Z - 0.05; z += hi ? 0.4 : 1.1) zs.push(z); zs.push(TAIL_Z);
  const NT = hi ? 80 : 36, cols = NT + 1;
  const g = sheet(zs.length, cols, (i, j) => skin(zs[i], j / NT * PI * 2), (i, j) => [(zs[i] - NOSE_Z) / HULL_L, 1 - j / NT]);
  orient(g, m => V3(m.x, m.y - SEC(m.z).ym, m.z < NOSE_Z + 0.5 ? -1 : 0));
  const N = g.attributes.normal;
  for (let i = 0; i < zs.length; i++) { const a = i * cols, b = a + NT; const x = N.getX(a) + N.getX(b), y = N.getY(a) + N.getY(b), z = N.getZ(a) + N.getZ(b), l = Math.hypot(x, y, z) || 1; N.setXYZ(a, x / l, y / l, z / l); N.setXYZ(b, x / l, y / l, z / l); }
  const tip = V3(0, -0.12, -1).normalize(); for (let j = 0; j < cols; j++) N.setXYZ(j, tip.x, tip.y, tip.z);
  return g;
}

// ================================================================ windows (cabin + flight deck), seals, emissive index
function rrPts(w, h, r, n = 5) { const P = []; for (const [cx, cy, q] of [[w / 2 - r, h / 2 - r, 0], [-(w / 2 - r), h / 2 - r, 1], [-(w / 2 - r), -(h / 2 - r), 2], [w / 2 - r, -(h / 2 - r), 3]]) for (let k = 0; k <= n; k++) { const a = (q + k / n) * PI / 2; P.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return P; }
const triO = (soup, A, B, C, u, v) => { _n.subVectors(B[0], A[0]).cross(_m.subVectors(C[0], A[0])); const T = _n.dot(A[1]) < 0 ? [A, C, B] : [A, B, C]; for (const [P, N] of T) soup.v(P, N, u, v); };
function windowsGeo(hi) {
  const glass = new Soup(), seal = new Soup(); let idx = 0;
  const cab = WINDOWS.map(w => ({ ...w, th: thetaAt(w.z, WIN_Y, w.side) }));
  const outline = hi ? rrPts(0.23, 0.32, 0.085, 4) : rrPts(0.23, 0.32, 0.085, 2);
  for (const w of cab) {
    const R = skin(w.z, w.th + 0.01).distanceTo(skin(w.z, w.th - 0.01)) / 0.02, sd = w.side;
    const at = (a, b, off) => { const z = w.z + a, th = w.th - sd * b / R; return [skin(z, th, off), hullNormal(z, th)]; };
    const u = (idx++ + 0.5) / 128; const c = at(0, 0, 0.004); const ring = outline.map(([a, b]) => at(a, b, 0.004));
    const ringO = outline.map(([a, b]) => { const l = Math.hypot(a, b) || 1; return at(a + a / l * 0.035, b + b / l * 0.035, 0.0015); });
    const ringI = outline.map(([a, b]) => { const l = Math.hypot(a, b) || 1; return at(a - a / l * 0.004, b - b / l * 0.004, 0.009); });
    const n = outline.length;
    for (let k = 0; k < n; k++) triO(glass, c, ring[k], ring[(k + 1) % n], u, 0.5);
    for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; const quad = (A, B) => { triO(seal, A[k], B[k], B[k1], 0, 0); triO(seal, A[k], B[k1], A[k1], 0, 0); }; quad(ringO, ringI); quad(ringI, ring); }
  }
  // flight-deck panes: corners (d from the nose, theta deg) [bottom-inner, top-inner, top-outer, bottom-outer]
  const panes = [[[1.36, 2.6], [2.16, 2.6], [2.46, 32.5], [1.74, 38.5]], [[1.92, 41.5], [2.52, 36.5], [2.98, 51], [2.34, 58.5]], [[2.48, 61.5], [3.07, 55], [3.56, 59.5], [3.0, 69]]];
  const nP = hi ? 5 : 2;
  for (const sd of [1, -1]) for (const pc of panes) {
    const cor = pc.map(([d, t]) => [NOSE_Z + d, (sd > 0 ? t : 360 - t) * D]); const cz = cor.reduce((s, c) => s + c[0], 0) / 4, ct = cor.reduce((s, c) => s + c[1], 0) / 4;
    const bil = (u, v, grow = 0) => { let z = (1 - v) * ((1 - u) * cor[0][0] + u * cor[3][0]) + v * ((1 - u) * cor[1][0] + u * cor[2][0]); let t = (1 - v) * ((1 - u) * cor[0][1] + u * cor[3][1]) + v * ((1 - u) * cor[1][1] + u * cor[2][1]);
      if (grow) { const R = 1.6, dz = z - cz, dt = (t - ct) * R, l = Math.hypot(dz, dt) || 1; z += dz / l * grow; t += dt / l * grow / R; } return [z, t]; };
    const S = (z, t, off) => [skin(z, t, off), skinN(z, t)];
    const Q = (A, B, C, Dd, soup, uu) => { triO(soup, A, B, C, uu, 0.5); triO(soup, A, C, Dd, uu, 0.5); };
    const u = 127.5 / 128; // flight deck: emissive slot 127 (dim)
    for (let i = 0; i < nP; i++) for (let j = 0; j < nP; j++) { const p = (a, b) => S(...bil(a / nP, b / nP), 0.004); Q(p(i, j), p(i + 1, j), p(i + 1, j + 1), p(i, j + 1), glass, u); }
    // seal / frame ring around the pane (perimeter walk)
    const per = []; for (let k = 0; k < nP; k++) per.push([k / nP, 0]); for (let k = 0; k < nP; k++) per.push([1, k / nP]); for (let k = nP; k > 0; k--) per.push([k / nP, 1]); for (let k = nP; k > 0; k--) per.push([0, k / nP]);
    for (let k = 0; k < per.length; k++) { const A = per[k], B = per[(k + 1) % per.length];
      const i0 = S(...bil(A[0], A[1]), 0.004), i1 = S(...bil(B[0], B[1]), 0.004), m0 = S(...bil(A[0], A[1], 0.012), 0.012), m1 = S(...bil(B[0], B[1], 0.012), 0.012), o0 = S(...bil(A[0], A[1], 0.05), 0.002), o1 = S(...bil(B[0], B[1], 0.05), 0.002);
      Q(i0, i1, m1, m0, seal, 0); Q(m0, m1, o1, o0, seal, 0); }
  }
  return { glass: glass.geo(), seal: colorise(boxUV(seal.geo(), 2), [0.16, 0.17, 0.19]), count: idx };
}
function windowGlowTex(n) { const { cv, c } = canvas(128, 1); const R = rng(5); for (let i = 0; i < 128; i++) { const lit = i === 127 ? 0.25 : (R() < 0.86 ? 0.75 + R() * 0.25 : 0.12); const h = 32 + R() * 10; c.fillStyle = `hsl(${h},85%,${Math.round(lit * 70)}%)`; c.fillRect(i, 0, 1, 1); } const t = tex(cv); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t; }

// ================================================================ hull details: antennas, probes, handles, APU exhaust
function blade(L, H, sw, t) { // swept blade antenna: x along (aft), y up, z lateral (centred)
  const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(L, 0); s.lineTo(sw + L * 0.42, H); s.quadraticCurveTo(sw, H * 1.04, sw * 0.82, H * 0.9); s.quadraticCurveTo(sw * 0.35, H * 0.3, 0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: t * 0.35, bevelSize: t * 0.3, bevelSegments: 2, curveSegments: 4 }); g.translate(0, 0, -t / 2); return g;
}
function onHullMatrix(z, th, sink = 0.02) { const p = skin(z, th), n = skinN(z, th); const al = V3(0, 0, 1).addScaledVector(n, -n.z).normalize(), lat = V3().crossVectors(al, n); return M4().makeBasis(al, n, lat).setPosition(p.addScaledVector(n, -sink)); }
function hullDetails(hi) {
  const paint = [], metal = [], dark = [];
  const ants = [[-6.6, 0, 0.42, 0.33, 0.22], [8.6, 0, 0.42, 0.33, 0.22], [-12.4, 0, 0.17, 0.12, 0.06], [-10.2, 0, 0.12, 0.1, 0.05], [-12.0, PI, 0.17, 0.12, 0.06], [-9.6, PI + 0.16, 0.13, 0.1, 0.05], [-9.6, PI - 0.16, 0.13, 0.1, 0.05], [9.2, PI, 0.42, 0.3, 0.2], [-5.2, PI, 0.12, 0.08, 0.04]];
  for (const [z, th, L, H, sw] of ants) paint.push(pv(blade(L, H, sw, 0.022).applyMatrix4(onHullMatrix(z - L / 2, th)), [0.9, 0.91, 0.92]));
  // GPS / satcom domes on the crown
  for (const [z, th] of [[-3.0, 0.07], [-3.0, -0.07], [-1.5, 0]]) { const g = new THREE.SphereGeometry(0.09, 10, 5, 0, PI * 2, 0, PI / 2); g.scale(1, 0.35, 1.5); paint.push(pv(g.applyMatrix4(onHullMatrix(z, th, 0.0)), [0.86, 0.87, 0.88])); }
  // pitot probes (L-shaped: blade mast + forward tube), AoA vanes, TAT probe
  for (const [sd, y, z] of [[1, 0.3, -16.05], [-1, 0.3, -16.05], [-1, -0.05, -15.75]]) {
    const m = onHullMatrix(z, thetaAt(z, y, sd), 0.01);
    metal.push(colorise(blade(0.12, 0.11, 0.07, 0.016).applyMatrix4(m), [0.78, 0.8, 0.82]));
    metal.push(colorise(new THREE.CylinderGeometry(0.011, 0.015, 0.2, 8).rotateZ(PI / 2).translate(-0.02, 0.105, 0).applyMatrix4(m), [0.8, 0.82, 0.84]));
  }
  for (const sd of [1, -1]) { const z = -15.45, th = thetaAt(z, 0.02, sd); const g = new THREE.BoxGeometry(0.1, 0.07, 0.008).translate(0.04, 0.035, 0); dark.push(colorise(g.applyMatrix4(onHullMatrix(z, th, 0.005)), [0.12, 0.12, 0.13])); }
  { const z = -14.6, th = thetaAt(z, 0.75, -1); const g = blade(0.08, 0.07, 0.03, 0.02); metal.push(colorise(g.applyMatrix4(onHullMatrix(z, th, 0.01)), [0.75, 0.77, 0.8])); }
  // door handles (flush flaps) + slide-bar fairings, cargo-door hinge strips
  for (const d of DOORS) { const y = (DOOR.y0 + DOOR.y1) / 2 - 0.05, th = thetaAt(d.z, y, d.side); const g = new THREE.BoxGeometry(0.3, 0.012, 0.075, 2, 1, 1); g.translate(0, 0.004, 0); dark.push(colorise(g.applyMatrix4(onHullMatrix(d.z, th, 0.0)), [0.3, 0.32, 0.35]));
    const vp = new THREE.CylinderGeometry(0.075, 0.08, 0.012, hi ? 16 : 8).translate(0, 0.0, 0); const thv = thetaAt(d.z, y + 0.42, d.side); dark.push(colorise(vp.applyMatrix4(onHullMatrix(d.z, thv, 0.004)), [0.08, 0.09, 0.1])); }
  // APU exhaust in the tail cone
  { const s = SEC(TAIL_Z); const prof = [[0.27, 0.02], [0.24, 0.05], [0.2, 0.0], [0.185, -0.3]]; const g = latheZ(prof, hi ? 24 : 12); g.translate(0, s.ym + 0.02, TAIL_Z - 0.02); metal.push(colorise(g, [0.28, 0.27, 0.26]));
    const cap = new THREE.CircleGeometry(0.19, 16); cap.translate(0, s.ym + 0.02, TAIL_Z - 0.3); dark.push(colorise(cap, [0.04, 0.04, 0.04])); }
  return { paint, metal, dark };
}

// ================================================================ lifting surfaces
const afY = (x, side, t, cam) => { x = clamp(x, 0, 1); const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x ** 4); return cam * x * (1 - x) * (1.1 + 2.2 * x) + side * yt; };
const fpt = (S, c, side, out = V3()) => out.copy(S.le).addScaledVector(S.cdir, c * S.chord).addScaledVector(S.tdir, afY(c, side, S.t, S.cam) * S.chord);
// lofted lifting surface between chord fractions c0..c1 over stations ss; sec(s) -> { le, chord, cdir, tdir, t, cam }
function foil(o) {
  const { sec, ss, c0 = 0, c1 = 1, nc = 10, uv = (c, s, sd) => [c, sd > 0 ? 0.5 + 0.5 * s : 0.5 * s], caps = [false, false], sOf = s => s } = o;
  const cs = []; for (let k = 0; k <= nc; k++) { const f = k / nc; cs.push(c0 + (c1 - c0) * (c0 < 1e-3 ? 1 - Math.cos(f * PI / 2) : f)); }
  const S = ss.map(sec), list = [], sheets = [];
  const spanDir = S[S.length - 1].le.clone().sub(S[0].le).normalize();
  for (const sd of [1, -1]) {
    const g = sheet(ss.length, cs.length, (i, j) => fpt(S[i], cs[j], sd), (i, j) => uv(cs[j], sOf(ss[i]), sd));
    orient(g, m => { let best = S[0], bd = 1e9; for (const s of S) { const d = s.le.distanceToSquared(m); if (d < bd) { bd = d; best = s; } } return best.tdir.clone().multiplyScalar(sd); }); sheets.push(g); list.push(g);
  }
  if (c0 < 1e-3) { const [A, B] = sheets, NA = A.attributes.normal, NB = B.attributes.normal, cols = cs.length;
    for (let i = 0; i < ss.length; i++) { const k = i * cols; const x = NA.getX(k) + NB.getX(k), y = NA.getY(k) + NB.getY(k), z = NA.getZ(k) + NB.getZ(k), l = Math.hypot(x, y, z) || 1; NA.setXYZ(k, x / l, y / l, z / l); NB.setXYZ(k, x / l, y / l, z / l); } }
  const strip = (c, dirSign) => { const g = sheet(ss.length, 2, (i, j) => fpt(S[i], c, j ? -1 : 1), (i, j) => uv(c, sOf(ss[i]), 1)); return orient(g, () => S[0].cdir.clone().multiplyScalar(dirSign)); };
  if (c0 > 1e-3) list.push(strip(c0, -1)); if (c1 < 0.999) list.push(strip(c1, 1));
  ss.forEach((s, i) => { if (!(i === 0 && caps[0]) && !(i === ss.length - 1 && caps[1])) return; const ring = [...cs.map(c => fpt(S[i], c, 1)), ...cs.slice().reverse().map(c => fpt(S[i], c, -1))];
    const P = [], I = []; for (const p of ring) P.push(p.x, p.y, p.z); for (let k = 1; k < ring.length - 1; k++) I.push(0, k, k + 1);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(ring.flatMap(() => uv(0.5, sOf(s), 1)), 2)); g.setIndex(I); g.computeVertexNormals();
    list.push(orient(g, () => spanDir.clone().multiplyScalar(i === 0 ? -1 : 1))); });
  return mergeAll(list);
}
const mirrorSec = sec => s => { const S = sec(s); return { ...S, le: V3(-S.le.x, S.le.y, S.le.z), cdir: V3(-S.cdir.x, S.cdir.y, S.cdir.z), tdir: V3(-S.tdir.x, S.tdir.y, S.tdir.z) }; };
// thin raised panel on the upper surface (spoilers): b0..b1, chord cA..cB
function slab(sec, ss, cA, cB, lift = 0.012, uv) {
  const S = ss.map(sec), nc = 4; const cs = []; for (let k = 0; k <= nc; k++) cs.push(cA + (cB - cA) * k / nc);
  const top = (i, j) => fpt(S[i], cs[j], 1).addScaledVector(S[i].tdir, lift), bot = (i, j) => fpt(S[i], cs[j], 1).addScaledVector(S[i].tdir, -0.004);
  const T = orient(sheet(ss.length, cs.length, top, (i, j) => uv(cs[j], ss[i])), () => S[0].tdir);
  const edges = []; const n = ss.length - 1;
  const e = (f, out) => edges.push(orient(sheet(f.length, 2, (i, j) => (j ? bot : top)(...f[i]), () => [0.3, 0.5]), out));
  e(cs.map((_, j) => [0, j]), () => S[0].le.clone().sub(S[n].le)); e(cs.map((_, j) => [n, j]), () => S[n].le.clone().sub(S[0].le));
  e(ss.map((_, i) => [i, 0]), () => S[0].cdir.clone().negate()); e(ss.map((_, i) => [i, nc]), () => S[0].cdir.clone());
  return mergeAll([T, ...edges]);
}
// static wick: thin rod at p pointing along dir
function wick(p, dir, uvAt) { const g = new THREE.CylinderGeometry(0.004, 0.009, 0.3, 5); g.translate(0, 0.15, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir.clone().normalize())); g.translate(p.x, p.y, p.z); const n = g.toNonIndexed(); const U = n.attributes.uv; for (let i = 0; i < U.count; i++) U.setXY(i, uvAt[0], uvAt[1]); return n; }

// main wing planform: cranked trailing edge, washout, supercritical-ish section
const WG = { b0: 1.2, bK: 6.2, bT: 16.95, sweep: Math.tan(27 * D), dih: Math.tan(5.5 * D), zRef: -4.3, bRef: 1.7, yRef: -1.05 };
export function wingSec(b) {
  const le = WG.zRef + (b - WG.bRef) * WG.sweep, y = WG.yRef + (b - WG.bRef) * WG.dih, kin = b <= WG.bK;
  const f = kin ? (b - WG.b0) / (WG.bK - WG.b0) : (b - WG.bK) / (WG.bT - WG.bK);
  const te = kin ? lerp(2.5, 2.8, f) : lerp(2.8, 5.0, f), t = kin ? lerp(0.152, 0.124, f) : lerp(0.124, 0.102, f);
  const inc = lerp(2.0, -1.0, (b - WG.b0) / (WG.bT - WG.b0)) * D;
  return { le: V3(b, y, le), chord: te - le, cdir: V3(0, -Math.sin(inc), Math.cos(inc)), tdir: V3(0, Math.cos(inc), Math.sin(inc)), t, cam: 0.022 };
}
const wingS = b => (b - WG.b0) / (WG.bT - WG.b0);
function sharkletSec(s) { // right side; s = 0 at the wingtip section
  const T = wingSec(WG.bT), Rb = 0.62, phiM = 76 * D, arc = Rb * phiM, Ls = 2.0, L = s * (arc + Ls);
  let x, y, phi; if (L <= arc) { phi = L / Rb; x = WG.bT + Rb * Math.sin(phi); y = T.le.y + Rb * (1 - Math.cos(phi)); } else { phi = phiM; x = WG.bT + Rb * Math.sin(phiM) + Math.cos(phiM) * (L - arc); y = T.le.y + Rb * (1 - Math.cos(phiM)) + Math.sin(phiM) * (L - arc); }
  const inc = lerp(-1.0, 0, s) * D, ci = Math.cos(inc);
  return { le: V3(x, y, T.le.z + 2.0 * Math.pow(s, 1.3)), chord: lerp(T.chord, 0.36, Math.pow(s, 0.75)), cdir: V3(0, -Math.sin(inc), ci), tdir: V3(-Math.sin(phi) * ci, Math.cos(phi) * ci, Math.sin(inc)), t: lerp(T.t, 0.085, s), cam: lerp(T.cam, 0.004, smooth(0, 0.4, s)) };
}
const HT = { b0: 0.35, bT: 6.3, z0: 13.7, y0: 1.0, sweep: Math.tan(32 * D), dih: Math.tan(6 * D), cr: 3.75, ct: 1.3 };
function htpSec(b) { const f = (b - HT.b0) / (HT.bT - HT.b0); return { le: V3(b, HT.y0 + (b - HT.b0) * HT.dih, HT.z0 + (b - HT.b0) * HT.sweep), chord: lerp(HT.cr, HT.ct, f), cdir: V3(0, 0, 1), tdir: V3(0, 1, 0), t: lerp(0.11, 0.09, f), cam: 0 }; }
const VT = { y0: 1.4, h: 6.45, z0: 11.55, sweep: Math.tan(37 * D), cr: 6.05, ct: 2.05 };
function finSec(s) { return { le: V3(0, VT.y0 + VT.h * s, VT.z0 + VT.h * s * VT.sweep), chord: lerp(VT.cr, VT.ct, s), cdir: V3(0, 0, 1), tdir: V3(1, 0, 0), t: lerp(0.115, 0.09, s), cam: 0 }; }

// ================================================================ engine
const ENG = { x: 5.75, y: -1.95, z0: -6.95 };
const NAC = [[0.99, 0.95], [0.985, 0.72], [0.968, 0.45], [0.948, 0.22], [0.942, 0.12], [0.948, 0.05], [0.962, 0.016], [0.982, 0.002], [1.0, 0], [1.024, 0.008], [1.05, 0.03], [1.078, 0.07], [1.105, 0.13], [1.135, 0.27], [1.16, 0.5], [1.178, 0.85], [1.187, 1.3], [1.187, 1.75], [1.18, 2.2]];
const SLV = [[1.18, 2.2], [1.168, 2.65], [1.14, 3.15], [1.1, 3.6], [1.05, 3.95], [1.0, 4.2], [0.993, 4.236], [0.982, 4.232], [0.976, 4.19], [1.0, 3.8], [1.02, 3.2], [1.03, 2.6]];
const CORE = [[0.0, 3.0], [0.74, 3.2], [0.76, 3.7], [0.74, 4.25], [0.69, 4.7], [0.62, 5.1], [0.56, 5.37], [0.553, 5.402], [0.542, 5.398], [0.535, 5.3]];
const PLUG = [[0.0, 5.0], [0.41, 5.1], [0.4, 5.4], [0.36, 5.65], [0.27, 5.9], [0.15, 6.1], [0.04, 6.2], [0.0, 6.21]];
function bladesGeo(n, hi) { // wide-chord swept fan blades around +z at z = 0
  const P = []; const rows = hi ? 6 : 3, cols = hi ? 4 : 2;
  for (let k = 0; k < n; k++) { const ps = k / n * PI * 2; const er = V3(Math.cos(ps), Math.sin(ps), 0), et = V3(-Math.sin(ps), Math.cos(ps), 0), ez = V3(0, 0, 1);
    const g = sheet(rows + 1, cols + 1, (i, j) => { const f = i / rows, r = lerp(0.32, 0.975, f), beta = lerp(32, 62, f) * D, ch = lerp(0.26, 0.44, Math.sin(f * PI * 0.62)), sw = 0.07 * f * f - 0.02, c = j / cols - 0.5, bow = 0.03 * (1 - 4 * c * c) * (1 - f * 0.5);
      return er.clone().multiplyScalar(r).addScaledVector(ez, Math.cos(beta) * c * ch + sw).addScaledVector(et, Math.sin(beta) * c * ch).addScaledVector(ez.clone().multiplyScalar(-Math.sin(beta)).addScaledVector(et, Math.cos(beta)), bow); }, (i, j) => [j / cols, i / rows]);
    P.push(g); }
  return mergeAll(P);
}
const nacBandsOf = () => { const Lall = arcLen([...NAC, ...SLV.slice(1)]); return { lipIn: arcLen(NAC.slice(0, 6)) / Lall, lipOut: arcLen(NAC.slice(0, 13)) / Lall, cowl: arcLen(NAC) / Lall }; };
function engineParts(sd, hi, ex = sd * ENG.x, ey = ENG.y, z0 = ENG.z0) {
  const seg = hi ? 48 : 20, Lall = arcLen([...NAC, ...SLV.slice(1)]), Lnac = arcLen(NAC), bands = nacBandsOf();
  const nac = latheBand(NAC, seg, 0, Lnac / Lall); nac.translate(ex, ey, z0);
  const sleeve = latheBand(SLV, seg, Lnac / Lall, 1); sleeve.translate(ex, ey, z0);
  const core = colorise(latheZ(CORE, seg), [0.62, 0.64, 0.67]); core.translate(ex, ey, z0);
  const plug = colorise(latheZ(PLUG, seg >> 1), [0.34, 0.31, 0.29]); plug.translate(ex, ey, z0);
  // fan face backdrop (booster / OGV ring) and the reverser cascade revealed when the sleeve opens
  const disk = colorise(new THREE.RingGeometry(0.3, 0.995, seg, 1).translate(ex, ey, z0 + 1.2), [0.035, 0.037, 0.04]);
  const ogv = colorise(latheZ([[0.99, 1.0], [0.99, 1.25]], seg, { flip: true }), [0.08, 0.085, 0.09]); ogv.translate(ex, ey, z0);
  const casc = colorise(latheZ([[1.12, 2.15], [1.12, 2.85]], seg), [0.07, 0.07, 0.075]); casc.translate(ex, ey, z0);
  // pylon (strut) + aft fairing down to the core
  const b = Math.abs(ex), wl = z => { const S = wingSec(b); const c = clamp((z - S.le.z) / S.chord, 0, 1); return fpt(S, c, -1).y; };
  const zLE = wingSec(b).le.z;
  const pyl = loftZ(hi ? 16 : 8, hi ? 20 : 10, t => {
    const z = lerp(z0 + 0.9, z0 + 7.0, t), top = z < zLE ? lerp(ey + 1.3, wl(zLE) + 0.05, smooth(z0 + 0.9, zLE, z)) : wl(z) + 0.12;
    const bot = z < z0 + 4.0 ? ey + 1.02 : lerp(ey + 1.02, ey + 0.62, smooth(z0 + 4.0, z0 + 4.8, z)) + (z > z0 + 5.6 ? (wl(z) + 0.05 - ey - 0.62) * smooth(z0 + 5.6, z0 + 7.0, z) : 0);
    const hx = 0.21 * smooth(z0 + 0.85, z0 + 1.9, z) * (1 - 0.55 * smooth(z0 + 4.6, z0 + 7.0, z)) + 0.02;
    return { z, cx: ex, cy: (top + bot) / 2, hx, hy: Math.max(0.03, (top - bot) / 2), n: 3.2 }; });
  const pylon = pv(pyl, [0.9, 0.91, 0.92]); { const P = pylon.attributes.position, C = pylon.attributes.color; for (let i = 0; i < P.count; i++) if (P.getZ(i) > z0 + 4.2 && P.getY(i) < ey + 1.0) C.setXYZ(i, 0.55, 0.53, 0.5); }
  return { nac, sleeve, core, plug, disk, ogv, casc, pylon, bands, fanZ: z0 + 0.95, ex, ey, z0 };
}

// ================================================================ gear
function tyreGeo(R, W, hi) { const h = W / 2; const prof = [[R * 0.6, -h * 0.98], [R * 0.75, -h * 1.02], [R * 0.88, -h * 0.97], [R * 0.96, -h * 0.82], [R * 0.995, -h * 0.55], [R, -h * 0.2], [R, h * 0.2], [R * 0.995, h * 0.55], [R * 0.96, h * 0.82], [R * 0.88, h * 0.97], [R * 0.75, h * 1.02], [R * 0.6, h * 0.98]];
  const g = latheZ(prof, hi ? 36 : 16, { uvLen: true }); g.rotateY(PI / 2); return g; }
function hubGeo(R, W, hi) { const h = W / 2; const out = [[R * 0.61, h * 0.97], [R * 0.57, h * 0.9], [R * 0.5, h * 0.82], [R * 0.3, h * 0.78], [R * 0.2, h * 0.9], [R * 0.12, h * 0.96], [0.0, h * 0.96]];
  const a = latheZ(out, hi ? 24 : 10); const b = latheZ(out.map(([r, z]) => [r, -z]), hi ? 24 : 10, { flip: true }); const L = [a, b];
  if (hi) for (let k = 0; k < 8; k++) { const t = k / 8 * PI * 2; for (const s of [1, -1]) L.push(new THREE.CylinderGeometry(R * 0.022, R * 0.022, 0.03, 6).rotateX(PI / 2).translate(Math.cos(t) * R * 0.24, Math.sin(t) * R * 0.24, s * h * 0.8)); }
  const g = mergeAll(L); g.rotateY(PI / 2); return g; }
function tyreTex() { const { cv, c } = canvas(64, 256); c.fillStyle = '#808080'; c.fillRect(0, 0, 64, 256); c.fillStyle = '#303030'; for (const v of [0.36, 0.45, 0.55, 0.64]) c.fillRect(0, (1 - v) * 256 - 2, 64, 4); c.fillStyle = '#9a9a9a'; for (let y = 0; y < 256; y += 9) if (y < 70 || y > 186) c.fillRect(0, y, 64, 1);
  const n = tex(heightToNormal(cv, 3, true), { srgb: false }); n.wrapS = n.wrapT = THREE.RepeatWrapping; return n; }
function mainGear(sd, hi) {
  const R = GEAR.wheelR, W = GEAR.wheelW, L = -(-3.62 + R) + GEAR.hingeY; // hinge -> axle drop (positive)
  const ay = -L, paint = [], metal = [];
  const cyl = (r0, r1, y0, y1, n = hi ? 14 : 8, x = 0, z = 0) => new THREE.CylinderGeometry(r1, r0, y1 - y0, n).translate(x, (y0 + y1) / 2, z);
  paint.push(pv(new THREE.CylinderGeometry(0.13, 0.13, 0.75, hi ? 12 : 6).rotateX(PI / 2), [0.8, 0.81, 0.83])); // trunnion
  paint.push(pv(cyl(0.135, 0.125, -1.3, 0.05), [0.8, 0.81, 0.83]));            // main fitting / outer cylinder
  paint.push(pv(cyl(0.16, 0.16, -1.36, -1.22), [0.78, 0.79, 0.81]));            // gland nut
  metal.push(colorise(cyl(0.098, 0.098, ay + 0.15, -1.2), [0.92, 0.93, 0.95])); // chrome slider
  paint.push(pv(cyl(0.12, 0.12, ay - 0.1, ay + 0.2), [0.78, 0.79, 0.81]));       // axle yoke
  metal.push(colorise(new THREE.CylinderGeometry(0.07, 0.07, 2 * GEAR.track + W * 0.9, 10).rotateZ(PI / 2).translate(0, ay, 0), [0.7, 0.72, 0.74]));
  // torque links (scissor) ahead of the leg
  const up = V3(0, -1.25, -0.07), apex = V3(0, (ay - 1.25) / 2 + 0.02, -0.32), lo = V3(0, ay + 0.24, -0.07);
  for (const [a, b] of [[up, apex], [apex, lo]]) { const d = b.clone().sub(a), l = d.length(); const g = new THREE.BoxGeometry(0.05, l, 0.075); g.translate(0, l / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize())); g.translate(a.x, a.y, a.z); paint.push(pv(g, [0.74, 0.75, 0.77])); }
  // side stay to the wing / body (inboard), and the drag brace aft
  for (const [a, b, r] of [[V3(0, -0.85, 0), V3(-sd * 1.1, 0.2, 0.05), 0.05], [V3(0, -0.6, 0.05), V3(0, 0.25, 0.85), 0.045]]) { const d = b.clone().sub(a); const g = new THREE.CylinderGeometry(r, r, d.length(), 8); g.translate(0, d.length() / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize())); g.translate(a.x, a.y, a.z); paint.push(pv(g, [0.74, 0.75, 0.77])); }
  // brake hydraulic lines (dark) down the leg
  { const g = new THREE.CylinderGeometry(0.012, 0.012, 1.6, 5).translate(sd * 0.13, -0.6, 0.06); paint.push(pv(g, [0.15, 0.15, 0.16])); }
  // leg fairing door on the outboard side (curved panel)
  { const s = sheet(5, 2, (i, j) => { const f = i / 4; return V3(sd * (0.2 + 0.05 * Math.sin(f * PI)), lerp(0.1, -1.3, j), lerp(-0.48, 0.48, f)); }); orient(s, () => V3(sd, 0, 0)); const back = flip(s.clone()); paint.push(pv(s, [0.9, 0.91, 0.92]), pv(back, [0.55, 0.57, 0.6])); }
  return { paint, metal, axleY: ay };
}
function noseGear(hi) {
  const R = GEAR.noseR, W = GEAR.noseW, L = -(-3.62 + R) + GEAR.noseHingeY, ay = -L, paint = [], metal = [];
  const cyl = (r0, r1, y0, y1, n = hi ? 12 : 6, x = 0, z = 0) => new THREE.CylinderGeometry(r1, r0, y1 - y0, n).translate(x, (y0 + y1) / 2, z);
  paint.push(pv(cyl(0.1, 0.1, -0.95, 0.05), [0.8, 0.81, 0.83]), pv(cyl(0.125, 0.125, -0.62, -0.45), [0.78, 0.79, 0.81]));
  metal.push(colorise(cyl(0.072, 0.072, ay + 0.12, -0.9), [0.92, 0.93, 0.95]));
  paint.push(pv(new THREE.BoxGeometry(0.12, 0.16, 0.24).translate(0, ay + 0.05, 0.05), [0.78, 0.79, 0.81]));
  metal.push(colorise(new THREE.CylinderGeometry(0.05, 0.05, 2 * 0.24 + W * 0.9, 8).rotateZ(PI / 2).translate(0, ay, 0), [0.7, 0.72, 0.74]));
  for (const [a, b] of [[V3(0, -0.95, 0.06), V3(0, (ay - 0.95) / 2, 0.24)], [V3(0, (ay - 0.95) / 2, 0.24), V3(0, ay + 0.18, 0.06)]]) { const d = b.clone().sub(a), l = d.length(); const g = new THREE.BoxGeometry(0.04, l, 0.06); g.translate(0, l / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize())); g.translate(a.x, a.y, a.z); paint.push(pv(g, [0.74, 0.75, 0.77])); }
  // drag brace forward-up, taxi / take-off light housings on the leg
  { const a = V3(0, -0.7, -0.05), b = V3(0, 0.15, -0.9), d = b.clone().sub(a); const g = new THREE.CylinderGeometry(0.04, 0.04, d.length(), 8); g.translate(0, d.length() / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize())); g.translate(a.x, a.y, a.z); paint.push(pv(g, [0.74, 0.75, 0.77])); }
  paint.push(pv(new THREE.BoxGeometry(0.34, 0.12, 0.1).translate(0, -0.55, -0.14), [0.2, 0.21, 0.22]));
  return { paint, metal, axleY: ay };
}

// ================================================================ light sprites + contrails
function lightPoints(lp) {
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp.flatMap(l => l.slice(0, 3)), 3)); lg.setAttribute('aCol', new THREE.Float32BufferAttribute(new Float32Array(lp.length * 3), 3));
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPx: { value: 1 } },
    vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\nattribute vec3 aCol; varying vec3 vC; uniform float uPx; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; vC = aCol; float d = -mv.z; gl_PointSize = clamp(1100.0/d, 2.0, 26.0) * uPx * clamp(length(aCol), 0.0, 1.0); \n#include <logdepthbuf_vertex>\n}`,
    fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\nvarying vec3 vC; void main(){ vec2 q = gl_PointCoord-0.5; float r = dot(q,q)*4.0; float a = exp(-r*6.0) + 0.5*exp(-r*40.0); gl_FragColor = vec4(vC*a*1.5, 1.0);\n#include <logdepthbuf_fragment>\n}` });
  const pts = new THREE.Points(lg, mat); pts.frustumCulled = false; pts.renderOrder = 10; return { pts, kinds: lp.map(l => l[3]), mat };
}
const TRAIL_N = 160;
function contrails() { // two world-space ribbons, newest sample first; billboarded in the vertex shader
  const n = TRAIL_N * 2 * 2, P = new Float32Array(n * 3), Q = new Float32Array(n * 3), A = new Float32Array(n * 2), I = [];
  for (let e = 0; e < 2; e++) for (let i = 0; i < TRAIL_N; i++) { const v = (e * TRAIL_N + i) * 2; A[v * 2 + 1] = -1; A[v * 2 + 3] = 1; A[v * 2] = A[v * 2 + 2] = -1e6; if (i < TRAIL_N - 1) I.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aPrev', new THREE.BufferAttribute(Q, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aInfo', new THREE.BufferAttribute(A, 2).setUsage(THREE.DynamicDrawUsage)); g.setIndex(I);
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(1, 1, 1) }, uLife: { value: 14 } },
    vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\nattribute vec3 aPrev; attribute vec2 aInfo; uniform float uTime; uniform float uLife; varying float vA; varying float vS;
      void main(){ float age = uTime - aInfo.x; vec3 p = position; vec3 d = p - aPrev; d = length(d) > 1e-3 ? normalize(d) : vec3(0.0,0.0,1.0); vec3 v = normalize(cameraPosition - p); vec3 s = cross(d, v); s = length(s) > 1e-4 ? normalize(s) : vec3(0.0,1.0,0.0);
        float w = 0.9 + age * 1.6 + age * age * 0.05; p += s * aInfo.y * w; p.y -= age * age * 0.04; vS = aInfo.y;
        vA = smoothstep(0.12, 0.6, age) * pow(clamp(1.0 - age / uLife, 0.0, 1.0), 1.4) * (age < 0.0 ? 0.0 : 1.0); vA *= clamp(1.6 / (1.0 + w * 0.08), 0.25, 1.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);\n#include <logdepthbuf_vertex>\n}`,
    fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\nuniform vec3 uCol; varying float vA; varying float vS; void main(){ float e = 1.0 - vS * vS; gl_FragColor = vec4(uCol, vA * e * 0.85);\n#include <logdepthbuf_fragment>\n}` });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 6; mesh.name = 'contrails';
  return { mesh, mat, g, last: -1e9, lastPos: [V3(1e9, 0, 0), V3(1e9, 0, 0)], on: 0 };
}

// ================================================================ build
export function buildPlayerAircraft(quality = 'high') {
  const hi = quality !== 'low', big = quality === 'high' || quality === 'ultra', shadow = quality === 'ultra';
  const root = new THREE.Group(); root.name = 'aircraft';
  const model = new THREE.Group(); model.name = 'exterior'; root.add(model);
  const detail = new THREE.Group(); detail.name = 'detail'; model.add(detail);
  // ---------------- materials (one per surface family)
  const F = fuselageMaps(big ? 4096 : 2048), Wm = wingMaps(big ? 2048 : 1024), Fm = finMaps(big ? 1024 : 512), Lm = wingletMaps(big ? 512 : 256), PT = panelTile(512, 2);
  const Nm = nacelleMaps(nacBandsOf(), big ? 1024 : 512);
  const orm = (o, m) => Object.assign(o, { map: m.map, normalMap: m.normalMap, aoMap: m.orm, roughnessMap: m.orm, metalnessMap: m.orm, roughness: 1, metalness: 1 });
  const hullMat = atmos(new THREE.MeshPhysicalMaterial(orm({ clearcoat: 1, clearcoatRoughness: 0.07, clearcoatNormalMap: F.normalMap, clearcoatNormalScale: new THREE.Vector2(0.35, 0.35), aoMapIntensity: 0.8, envMapIntensity: 1.0 }, F)));
  const finMat = atmos(new THREE.MeshPhysicalMaterial(orm({ clearcoat: 1, clearcoatRoughness: 0.08, emissiveMap: Fm.map, emissive: 0xffffff, emissiveIntensity: 0 }, Fm)));
  const wingMat = atmos(new THREE.MeshPhysicalMaterial(orm({ clearcoat: 0.45, clearcoatRoughness: 0.2, normalScale: new THREE.Vector2(0.8, 0.8) }, Wm)));
  const wletMat = atmos(new THREE.MeshPhysicalMaterial(orm({ clearcoat: 1, clearcoatRoughness: 0.08 }, Lm)));
  const nacMat = atmos(new THREE.MeshPhysicalMaterial(orm({ clearcoat: 1, clearcoatRoughness: 0.08 }, Nm)));
  const paintMat = atmos(new THREE.MeshPhysicalMaterial({ vertexColors: true, map: PT.map, normalMap: PT.normalMap, aoMap: PT.orm, roughnessMap: PT.orm, roughness: 1, metalness: 0.05, clearcoat: 0.5, clearcoatRoughness: 0.15 }));
  const metalMat = atmos(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.92 }));
  const bladeMat = atmos(new THREE.MeshStandardMaterial({ color: 0x9aa1aa, roughness: 0.32, metalness: 0.9, side: THREE.DoubleSide }));
  const spinMat = atmos(new THREE.MeshPhysicalMaterial({ map: spinnerTex(256), roughness: 0.25, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 }));
  const tyreN = tyreTex(); const tyreMat = atmos(new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.9, metalness: 0, normalMap: tyreN }));
  const glowTex = windowGlowTex(); const glassMat = atmos(new THREE.MeshPhysicalMaterial({ color: 0x0c1118, roughness: 0.05, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4, emissiveMap: glowTex, emissive: 0xffffff, emissiveIntensity: 0 }));
  const lensMat = atmos(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.08, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.85 }));
  const add = (g, m, parent = detail, cast = shadow) => { const mesh = new THREE.Mesh(g, m); mesh.castShadow = cast; mesh.receiveShadow = shadow; parent.add(mesh); return mesh; };
  const statPaint = [], statMetal = [], statWing = [], lens = [];

  // ---------------- hull, windows, details
  add(hullGeo(hi), hullMat);
  const win = windowsGeo(hi); add(win.glass, glassMat, detail, false); statPaint.push(win.seal);
  const det = hullDetails(hi); statPaint.push(...det.paint, ...det.dark); statMetal.push(...det.metal);

  // ---------------- wings
  const parts = { surfaces: {}, gear: {}, fans: [], wheels: [], rev: [], spoilerPanels: [] };
  const wUV = (c, s, sd) => [c, sd > 0 ? 0.5 + 0.5 * s : 0.5 * s], WICK_UV = [0.35, 0.535];
  const ncB = hi ? 16 : 7, ncD = hi ? 6 : 3;
  const pivotOf = (geo, sec, b0, b1, c, mat = wingMat, sd = 1) => {
    const h0 = fpt(sec(b0), c, 0), h1 = fpt(sec(b1), c, 0); const pivot = new THREE.Group(); pivot.position.copy(h0); detail.add(pivot);
    const mesh = new THREE.Mesh(geo, mat); mesh.position.copy(h0).negate(); mesh.castShadow = shadow; mesh.receiveShadow = shadow; pivot.add(mesh);
    return { pivot, axis: h1.clone().sub(h0).normalize(), home: h0.clone(), sign: sd, chord: (sec(b0).chord + sec(b1).chord) / 2, mesh };
  };
  const attachTo = (P, geo, mat) => { const m = new THREE.Mesh(geo, mat); m.position.copy(P.home).negate(); m.castShadow = shadow; P.pivot.add(m); return m; };
  for (const sd of [1, -1]) {
    const sec = sd > 0 ? wingSec : mirrorSec(wingSec), bs = b => b * 1; // stations in |b|
    const S = b => sec(b), sOf = b => wingS(b);
    const box = [1.2, 2.0, 2.4, 3.0, 3.9, 4.75, 5.45, 6.05, 6.2, 7.3, 8.3, 9.4, 10.5, 11.6, 12.0, 12.2, 13.4, 14.4, 15.6, 16.3, 16.95];
    statWing.push(foil({ sec: S, ss: box, c0: 0.12, c1: 0.74, nc: ncB, uv: wUV, sOf }));
    statWing.push(foil({ sec: S, ss: [1.2, 1.8, 2.4], c0: 0, c1: 0.12, nc: ncD, uv: wUV, sOf }), foil({ sec: S, ss: [5.45, 6.05], c0: 0, c1: 0.12, nc: ncD, uv: wUV, sOf, caps: [true, true] }), foil({ sec: S, ss: [16.6, 16.95], c0: 0, c1: 0.12, nc: ncD, uv: wUV, sOf, caps: [true, false] }));
    statWing.push(foil({ sec: S, ss: [1.2, 2.0], c0: 0.74, c1: 1, nc: ncD, uv: wUV, sOf }), foil({ sec: S, ss: [12.0, 12.2], c0: 0.74, c1: 1, nc: ncD, uv: wUV, sOf, caps: [true, true] }), foil({ sec: S, ss: [15.6, 16.3, 16.95], c0: 0.74, c1: 1, nc: ncD, uv: wUV, sOf, caps: [true, false] }));
    // slats: five segments on one droop axis (gap over the pylon)
    const slatG = mergeAll([[2.4, 3.9, 5.45], [6.05, 7.3, 8.9], [8.95, 10.3, 11.7], [11.75, 13.0, 14.3], [14.35, 15.5, 16.6]].map(ss => foil({ sec: S, ss, c0: 0, c1: 0.12, nc: ncD + 2, uv: wUV, sOf, caps: [true, true] })));
    const slat = pivotOf(slatG, S, 2.4, 16.6, 0.12, wingMat, sd);
    // flaps (+ aft canoe fairings that ride on them), aileron with static wicks
    const flapIn = pivotOf(foil({ sec: S, ss: [2.0, 3.0, 4.1, 5.2, 6.2], c0: 0.74, c1: 1, nc: ncD, uv: wUV, sOf, caps: [true, true] }), S, 2.0, 6.2, 0.74, wingMat, sd);
    const flapOut = pivotOf(foil({ sec: S, ss: [6.25, 7.3, 8.3, 9.4, 10.5, 12.0], c0: 0.74, c1: 1, nc: ncD, uv: wUV, sOf, caps: [true, true] }), S, 6.25, 12.0, 0.74, wingMat, sd);
    const ailB = [12.2, 13.0, 13.9, 14.8, 15.6]; const wk = [12.9, 14.0, 15.1].map(b => wick(fpt(S(b), 1, 0), V3(0, -0.05, 1), WICK_UV));
    const ail = pivotOf(mergeAll([foil({ sec: S, ss: ailB, c0: 0.74, c1: 1, nc: ncD, uv: wUV, sOf, caps: [true, true] }), ...wk]), S, 12.2, 15.6, 0.74, wingMat, sd);
    // canoes: lathe, narrowed, hung under the lower surface; aft part follows its flap
    const canoe = (b, flap) => { const Sb = S(b), zh = fpt(Sb, 0.74, -1).z, zf = fpt(Sb, 0.5, -1).z, zt = fpt(Sb, 1, 0).z + 1.0, len = zt - zf, yb = fpt(Sb, 0.62, -1).y - 0.03;
      const prof = []; for (let k = 0; k <= 12; k++) { const f = k / 12; prof.push([0.3 * Math.pow(Math.sin(PI * Math.pow(f, 0.62)), 0.75) + 0.002, zf + f * len]); }
      const front = prof.filter(p => p[1] <= zh + 0.001), back = prof.filter(p => p[1] >= zh - 0.001); if (front[front.length - 1][1] < zh) { const r = 0.3 * Math.pow(Math.sin(PI * Math.pow((zh - zf) / len, 0.62)), 0.75); front.push([r, zh]); back.unshift([r, zh]); }
      const mk = pr => { const g = latheZ(pr.map(([r, z]) => [r, z]), hi ? 14 : 8); g.scale(0.45, 1, 1); g.translate(sd * b, yb, 0); return pv(g, [0.88, 0.89, 0.9]); };
      statPaint.push(mk(front)); return mk(back); };
    attachTo(flapIn, mergeAll([canoe(3.9, flapIn)], ['position', 'normal', 'uv', 'color']), paintMat);
    attachTo(flapOut, mergeAll([canoe(7.3, flapOut), canoe(9.4, flapOut), canoe(11.6, flapOut)], ['position', 'normal', 'uv', 'color']), paintMat);
    // spoilers (5), hinged at their leading edge
    const spoilers = [];
    for (const [b0, b1] of [[3.0, 4.7], [4.75, 6.15], [6.3, 8.2], [8.25, 10.1], [10.15, 12.0]]) {
      const g = slab(S, [b0, (b0 + b1) / 2, b1], 0.585, 0.745, 0.01, (c, b) => wUV(c, sOf(b), 1));
      const a = fpt(S(b0), 0.585, 1), bb = fpt(S(b1), 0.585, 1); const pivot = new THREE.Group(); pivot.position.copy(a); detail.add(pivot);
      const m = new THREE.Mesh(g, wingMat); m.position.copy(a).negate(); m.castShadow = shadow; pivot.add(m); spoilers.push({ pivot, axis: bb.clone().sub(a).normalize(), sign: sd });
    }
    // sharklet
    const shs = [0, 0.03, 0.07, 0.12, 0.18, 0.25, 0.33, 0.43, 0.55, 0.68, 0.82, 1];
    const shSec = sd > 0 ? sharkletSec : mirrorSec(sharkletSec);
    const wl = foil({ sec: shSec, ss: shs, c0: 0, c1: 1, nc: hi ? 12 : 5, uv: (c, s, side) => [c, side < 0 ? 0.5 + 0.5 * s : 0.5 * s], caps: [false, true] });
    add(mergeAll([wl, wick(fpt(shSec(1), 0.92, 0), V3(0, 0.1, 1), [0.5, 0.95]), wick(fpt(shSec(0.6), 1, 0), V3(0, 0, 1), [0.5, 0.8])]), wletMat);
    const tipLE = fpt(S(WG.bT), 0.0, 0);
    parts.surfaces[sd > 0 ? 'R' : 'L'] = { flapIn, flapOut, ail, slat, spoilers, tip: fpt(shSec(1), 0.3, 0), wingTip: tipLE.clone() };
    // landing light lens (wing root, lower surface)
    { const p = fpt(S(4.2), 0.05, -1); const g = new THREE.SphereGeometry(0.11, 10, 6, 0, PI * 2, 0, PI / 2); g.rotateX(PI); g.scale(1, 0.4, 1.3); g.translate(p.x, p.y + 0.02, p.z + 0.08); lens.push(colorise(g, [0.85, 0.88, 0.9])); }
    // nav + strobe lens at the wingtip leading edge
    { const p = fpt(S(16.85), 0.0, 0); const g = new THREE.SphereGeometry(0.075, 10, 6); g.scale(1.6, 0.8, 1.6); g.translate(p.x + sd * 0.0, p.y, p.z - 0.03); lens.push(colorise(g, sd > 0 ? [0.4, 0.9, 0.5] : [0.95, 0.35, 0.3])); }
  }
  add(mergeAll(statWing), wingMat);
  // ---------------- tailplane
  for (const sd of [1, -1]) {
    const sec = sd > 0 ? htpSec : mirrorSec(htpSec), sOf = b => 0.15 + 0.35 * (b - HT.b0) / (HT.bT - HT.b0);
    const hs = [0.35, 0.95, 2.0, 3.2, 4.4, 5.5, 6.1, 6.3];
    add(mergeAll([foil({ sec, ss: hs, c0: 0, c1: 0.7, nc: hi ? 12 : 6, uv: wUV, sOf, caps: [false, true] }), foil({ sec, ss: [0.35, 0.95], c0: 0.7, c1: 1, nc: 3, uv: wUV, sOf }), foil({ sec, ss: [6.1, 6.3], c0: 0.7, c1: 1, nc: 3, uv: wUV, sOf, caps: [true, true] })]), wingMat);
    const eb = [0.95, 2.0, 3.2, 4.4, 5.5, 6.1]; const wk = [3.6, 4.8, 5.9].map(b => wick(fpt(sec(b), 1, 0), V3(0, 0, 1), WICK_UV));
    const el = pivotOf(mergeAll([foil({ sec, ss: eb, c0: 0.7, c1: 1, nc: hi ? 5 : 3, uv: wUV, sOf, caps: [true, true] }), ...wk]), sec, 0.95, 6.1, 0.7, wingMat, sd);
    parts.surfaces['E' + (sd > 0 ? 'R' : 'L')] = el;
  }
  // ---------------- fin, rudder, dorsal fillet
  {
    const finUV = (c, s, sd) => [c, sd > 0 ? 0.5 + 0.5 * s : 0.5 * s], fs = [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.97, 1];
    add(mergeAll([foil({ sec: finSec, ss: fs, c0: 0, c1: 0.68, nc: hi ? 14 : 6, uv: finUV, caps: [false, true] }), foil({ sec: finSec, ss: [0, 0.03], c0: 0.68, c1: 1, nc: 3, uv: finUV }), foil({ sec: finSec, ss: [0.97, 1], c0: 0.68, c1: 1, nc: 3, uv: finUV, caps: [true, true] })]), finMat);
    const wk = [0.6, 0.75, 0.9].map(s => wick(fpt(finSec(s), 1, 0), V3(0, 0.05, 1), [0.3, 0.925]));
    const rg = mergeAll([foil({ sec: finSec, ss: [0.03, 0.25, 0.5, 0.75, 0.97], c0: 0.68, c1: 1, nc: hi ? 5 : 3, uv: finUV, caps: [true, true] }), ...wk]);
    const rud = pivotOf(rg, finSec, 0.03, 0.97, 0.68, finMat); parts.surfaces.rudder = rud;
    const fil = loftZ(hi ? 12 : 6, hi ? 16 : 8, t => { const z = lerp(8.6, 13.4, t), crown = SEC(z).top; const top = crown + 1.05 * Math.pow(smooth(8.6, 13.6, z), 1.6); return { z, cx: 0, cy: (top + crown - 0.25) / 2, hx: 0.02 + 0.2 * Math.pow(smooth(8.6, 12.0, z), 0.8), hy: (top - crown + 0.25) / 2, n: 2.4 }; }, true, false);
    { const U = fil.attributes.uv; for (let i = 0; i < U.count; i++) U.setXY(i, 0.12, 0.62); } add(fil, finMat);
  }
  // ---------------- engines
  const statNac = [];
  for (const sd of [1, -1]) {
    const E = engineParts(sd, hi);
    statNac.push(E.nac); statMetal.push(E.core, E.plug); statPaint.push(E.pylon, E.disk, E.ogv, E.casc);
    const sl = new THREE.Mesh(E.sleeve, nacMat); sl.castShadow = shadow; detail.add(sl); parts.rev.push({ sleeve: sl, z: 0 });
    const fan = new THREE.Group(); fan.position.set(E.ex, E.ey, E.fanZ); detail.add(fan);
    fan.add(new THREE.Mesh(bladesGeo(hi ? 18 : 12, hi), bladeMat));
    const spin = latheZ([[0.0, -0.44], [0.07, -0.41], [0.15, -0.33], [0.23, -0.21], [0.29, -0.08], [0.325, 0.06], [0.335, 0.2]], hi ? 32 : 14, { uvLen: true }); fan.add(new THREE.Mesh(spin, spinMat));
    parts.fans.push(fan);
    // fan-cowl hinge line + exhaust soot on the core cowl via the metal tint already; nothing else per engine
  }
  add(mergeAll(statNac), nacMat);
  // ---------------- gear
  {
    const tg = tyreGeo(GEAR.wheelR, GEAR.wheelW, hi), hg = hubGeo(GEAR.wheelR, GEAR.wheelW, hi), tgN = tyreGeo(GEAR.noseR, GEAR.noseW, hi), hgN = hubGeo(GEAR.noseR, GEAR.noseW, hi);
    const axleSet = (t, h, track) => { const g = new THREE.Group(); for (const s of [1, -1]) { const a = new THREE.Mesh(t, tyreMat), b = new THREE.Mesh(h, metalMat); a.position.x = b.position.x = s * track; a.castShadow = shadow; g.add(a, b); } return g; };
    const hubG = colorise(hg, [0.6, 0.62, 0.65]), hubGN = colorise(hgN, [0.6, 0.62, 0.65]);
    for (const sd of [1, -1]) {
      const hinge = new THREE.Group(); hinge.position.set(sd * GEAR.mainX, GEAR.hingeY, GEAR.mainZ); detail.add(hinge);
      const G = mainGear(sd, hi); add(mergeAll(G.paint, ['position', 'normal', 'uv', 'color']), paintMat, hinge); add(mergeAll(G.metal, ['position', 'normal', 'uv', 'color']), metalMat, hinge);
      const axle = axleSet(tg, hubG, GEAR.track); axle.position.y = G.axleY; hinge.add(axle); parts.wheels.push(axle);
      parts.gear['M' + (sd > 0 ? 'R' : 'L')] = { hinge, sign: sd };
    }
    const hinge = new THREE.Group(); hinge.position.set(0, GEAR.noseHingeY, GEAR.noseZ); detail.add(hinge);
    const steer = new THREE.Group(); hinge.add(steer);
    const G = noseGear(hi); add(mergeAll(G.paint, ['position', 'normal', 'uv', 'color']), paintMat, steer); add(mergeAll(G.metal, ['position', 'normal', 'uv', 'color']), metalMat, steer);
    const axle = axleSet(tgN, hubGN, 0.24); axle.position.y = G.axleY; steer.add(axle); parts.wheels.push(axle);
    // the legacy animation places `steer` at the axle height; keep its origin there and shift the leg up
    steer.position.y = G.axleY; for (const ch of steer.children) ch.position.y -= G.axleY;
    parts.gear.N = { hinge, steer };
    const taxiLight = new THREE.SpotLight(0xfff2dd, 0, 260, 0.42, 0.5, 1.3); taxiLight.position.set(0, 0.6, -0.3); steer.add(taxiLight); const tt = new THREE.Object3D(); tt.position.set(0, -2.5, -40); steer.add(tt); taxiLight.target = tt; parts.taxiLight = taxiLight;
    // nose-gear doors: hinged along the bay edges, open while the gear is down
    const doors = [];
    for (const sd of [1, -1]) { const z0 = -14.6, z1 = -13.25, x = sd * 0.31, y = SEC(-13.9).bot - 0.012; const piv = new THREE.Group(); piv.position.set(x, y, 0); detail.add(piv);
      const g = new THREE.BoxGeometry(0.3, 0.018, z1 - z0); g.translate(-sd * 0.15, 0, (z0 + z1) / 2); const m = new THREE.Mesh(pv(g, [0.9, 0.91, 0.92]), paintMat); piv.add(m); doors.push({ piv, sd }); }
    parts.noseDoors = doors;
  }
  // ---------------- static merged groups
  add(mergeAll(statPaint, ['position', 'normal', 'uv', 'color']), paintMat);
  add(mergeAll(statMetal, ['position', 'normal', 'uv', 'color']), metalMat);
  // beacons (top + belly), tail light lens
  { const t = skin(-1.2, 0, 0.0); const g = new THREE.SphereGeometry(0.1, 10, 6, 0, PI * 2, 0, PI / 2); g.scale(1, 0.55, 1.5); lens.push(colorise(g.clone().translate(t.x, t.y - 0.01, t.z), [0.95, 0.15, 0.1]));
    const b = skin(3.0, PI, 0.0); lens.push(colorise(g.clone().rotateX(PI).translate(b.x, b.y + 0.01, b.z), [0.95, 0.15, 0.1]));
    const s = SEC(TAIL_Z); const tl = new THREE.SphereGeometry(0.06, 8, 5); tl.translate(0, s.top - 0.06, TAIL_Z - 0.05); lens.push(colorise(tl, [0.95, 0.95, 0.95])); }
  add(mergeAll(lens, ['position', 'normal', 'uv', 'color']), lensMat, detail, false);

  // ---------------- lights (legacy contract)
  const landing = [];
  for (const sd of [1, -1]) { const L = new THREE.SpotLight(0xfff6e8, 0, 900, 0.2, 0.45, 1.2); const p = fpt(wingSec(4.2), 0.05, -1); L.position.set(sd * p.x, p.y - 0.05, p.z); model.add(L);
    const t = new THREE.Object3D(); t.position.set(sd * 6, -9, -200); model.add(t); L.target = t; landing.push(L); if (quality === 'low' && sd < 0) L.visible = false; }
  parts.landing = landing;
  const sR = parts.surfaces.R.wingTip, sL = parts.surfaces.L.wingTip, ts = SEC(TAIL_Z), bcnT = skin(-1.2, 0, 0.08), bcnB = skin(3.0, PI, 0.08), lr = fpt(wingSec(4.2), 0.05, -1);
  const lp = [[sR.x + 0.05, sR.y, sR.z - 0.12, 'navG'], [sL.x - 0.05, sL.y, sL.z - 0.12, 'navR'], [0, ts.top - 0.06, TAIL_Z + 0.02, 'navW'], [bcnT.x, bcnT.y, bcnT.z, 'bcn'], [bcnB.x, bcnB.y, bcnB.z, 'bcn'],
    [sR.x + 0.1, sR.y, sR.z + 0.05, 'stb'], [sL.x - 0.1, sL.y, sL.z + 0.05, 'stb'], [0, ts.ym, TAIL_Z + 0.15, 'stb'], [lr.x, lr.y - 0.08, lr.z, 'land'], [-lr.x, lr.y - 0.08, lr.z, 'land'], [0, -2.9, GEAR.noseZ - 0.5, 'taxi']];
  parts.lightPts = lightPoints(lp); model.add(parts.lightPts.pts);
  parts.mats = { bodyMat: glassMat, finMat };
  // ---------------- far LOD (> ~900 m): the merged traffic model, 2 draw calls
  const far = new THREE.Group(); far.name = 'far'; far.visible = false; model.add(far);
  try { const A = airlinerGeometry('low'); far.add(new THREE.Mesh(A.body, atmos(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.1 }))), new THREE.Mesh(A.fin, atmos(new THREE.MeshStandardMaterial({ color: 0x1b2747, roughness: 0.35, metalness: 0.1 })))); } catch (e) { console.warn('far LOD', e); }
  const _wp = V3();
  parts.lightPts.pts.onBeforeRender = (r, s, cam) => { if (!cam.isPerspectiveCamera) return; root.getWorldPosition(_wp); const d = cam.position.distanceTo(_wp), want = detail.visible ? d < 1000 : d < 850; if (want !== detail.visible && far.children.length) { detail.visible = want; far.visible = !want; } };
  // ---------------- contrails (world space, added to the scene on first use)
  const trail = hi ? contrails() : null;
  const _p = V3(), exh = [V3(ENG.x, ENG.y, ENG.z0 + 6.2), V3(-ENG.x, ENG.y, ENG.z0 + 6.2)];
  parts.anim = (st, dt, t, night, ac) => {
    for (const d of parts.noseDoors) d.piv.rotation.z = d.sd * st.gearPos * 82 * D;
    for (const r of parts.rev) r.sleeve.position.z = st.reverser * 0.62;
    if (!trail) return;
    if (!trail.mesh.parent && ac.parent) ac.parent.add(trail.mesh);
    const U = trail.mat.uniforms; U.uTime.value = t; const n = clamp(night, 0, 1); U.uCol.value.setRGB(lerp(1, 0.16, n), lerp(1, 0.18, n), lerp(1, 0.24, n));
    const alt = ac.position.y, want = !st.onGround && alt > 7900 && Math.max(st.n1[0], st.n1[1]) > 40;
    if (!want && !trail.on) return;
    const g = trail.g, P = g.attributes.position.array, Q = g.attributes.aPrev.array, A = g.attributes.aInfo.array, V = TRAIL_N * 2;
    for (let e = 0; e < 2; e++) { _p.copy(exh[e]).applyQuaternion(ac.quaternion).add(ac.position); const o = e * V;
      if (_p.distanceTo(trail.lastPos[e]) > 600) { for (let v = 0; v < V; v++) { P.set([_p.x, _p.y, _p.z], (o + v) * 3); Q.set([_p.x, _p.y, _p.z + 1], (o + v) * 3); A[(o + v) * 2] = -1e6; } trail.lastPos[e].copy(_p); }
      if (t - trail.last > 0.07) { P.copyWithin((o + 2) * 3, o * 3, (o + V - 2) * 3); A.copyWithin((o + 2) * 2, o * 2, (o + V - 2) * 2); for (let v = 0; v < 2; v++) A[(o + v) * 2 + 1] = v ? 1 : -1; }
      for (let v = 0; v < 2; v++) { P.set([_p.x, _p.y, _p.z], (o + v) * 3); if (t - trail.last > 0.07) A[(o + v) * 2] = want ? t : -1e6; }
      for (let i = 0; i < TRAIL_N; i++) { const a = o + i * 2, b = i < TRAIL_N - 1 ? a + 2 : a - 2, s = i < TRAIL_N - 1 ? 1 : -1; for (let v = 0; v < 2; v++) { const k = (a + v) * 3, k2 = (b + v) * 3; if (s > 0) { Q[k] = P[k2]; Q[k + 1] = P[k2 + 1]; Q[k + 2] = P[k2 + 2]; } else { Q[k] = 2 * P[k] - P[k2]; Q[k + 1] = 2 * P[k + 1] - P[k2 + 1]; Q[k + 2] = 2 * P[k + 2] - P[k2 + 2]; } } }
      trail.lastPos[e].copy(_p); }
    if (t - trail.last > 0.07) trail.last = t;
    trail.on = want ? 1 : (A.some((x, i) => i % 2 === 0 && x > t - U.uLife.value) ? 1 : 0);
    g.attributes.position.needsUpdate = g.attributes.aPrev.needsUpdate = g.attributes.aInfo.needsUpdate = true;
  };
  root.userData.parts = parts;
  return root;
}
