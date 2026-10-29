// Detailed but cheap generic narrow-body airliner for parked aircraft and AI traffic (no real brand).
// Contract (same as airport.js parkedAirlinerGeometry): { body, fin }
//   body: merged, non-indexed, vertex-coloured (position, normal, color): fuselage with a belly colour split, cockpit and
//         cabin windows, wings with metal leading edges, winglets, flap-track fairings, stabilisers, engines, pylons, gear.
//   fin : merged, non-indexed (position, normal), no colour: every livery-coloured part (fin + rudder, cheatline,
//         nacelle cowls, winglet faces). The caller tints it per instance (InstancedMesh colour) or per material.
// Body frame: x right, y up, z aft (nose at -z); wheels touch y = -3.62 (callers place the origin 3.6 m above ground).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const R = 1.98, H = 2.06, NOSE = -18.6, TAIL = 19.0;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// fuselage section at z: half-width w, crown top, keel bot, widest-line height ym
function section(z) {
  const y0 = -0.4;
  if (z < -12.1) { const u = Math.min(1, Math.max(0, (z - NOSE) / 6.5)); const w = R * Math.sqrt(1 - Math.pow(1 - u, 2.4)); const top = y0 + (H - y0) * Math.sqrt(1 - Math.pow(1 - u, 2.6)); const bot = y0 + (-H - y0) * Math.sqrt(1 - Math.pow(1 - u, 3.4)); return { w, top, bot, ym: y0 * Math.pow(1 - u, 1.5) }; }
  if (z < 3) return { w: R, top: H, bot: -H, ym: 0 };
  const v = Math.min(1, (z - 3) / (TAIL - 3));
  const top = H - 0.8 * Math.pow(Math.max(0, (z - 9.5) / 9.5), 1.6), bot = -H + 2.86 * Math.pow(v, 1.35);
  return { w: R * (1 - 0.86 * Math.pow(v, 2.4)), top, bot, ym: Math.min(top - 0.12, 1.05 * Math.pow(v, 1.3)) };
}
function fpt(z, th, off = 0, s = section(z)) {
  const c = Math.cos(th), sn = Math.sin(th);
  const p = new THREE.Vector3(s.w * sn, s.ym + (c >= 0 ? s.top - s.ym : s.ym - s.bot) * c, z);
  if (off) { const n = fnrm(z, th); p.addScaledVector(n, off); }
  return p;
}
function fnrm(z, th) { // numeric outward normal
  const e = 0.01, zz = Math.max(NOSE + 0.03, Math.min(TAIL - 0.03, z));
  const a = fpt(zz, th + e), b = fpt(zz, th - e), c = fpt(zz + e, th), d = fpt(zz - e, th);
  const n = c.sub(d).cross(a.sub(b)).normalize(); if (n.lengthSq() < 0.5) return new THREE.Vector3(0, 0, -1); return n;
}
// helpers ---------------------------------------------------------------------------------------------------------
function grid(rows, cols, at, wrap = false) { // indexed grid over (rows x cols) points at(i, j) -> Vector3
  const P = [], I = []; const cc = wrap ? cols : cols;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const p = at(i, j); P.push(p.x, p.y, p.z); }
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < (wrap ? cc : cols - 1); j++) {
    const j1 = (j + 1) % cols; const a = i * cols + j, b = i * cols + j1, c = (i + 1) * cols + j, d = (i + 1) * cols + j1; I.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
}
const flipped = g => { const I = g.index.array; for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; } g.computeVertexNormals(); return g; };
function colour(g, f) { // non-indexed, per-face colour f(centroid, normal) -> [r,g,b] or array
  const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  const P = n.attributes.position, N = n.attributes.normal, C = new Float32Array(P.count * 3), c = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < P.count; i += 3) {
    c.set(0, 0, 0); nn.set(0, 0, 0); for (let k = 0; k < 3; k++) { c.x += P.getX(i + k) / 3; c.y += P.getY(i + k) / 3; c.z += P.getZ(i + k) / 3; nn.x += N.getX(i + k); nn.y += N.getY(i + k); nn.z += N.getZ(i + k); }
    const col = typeof f === 'function' ? f(c, nn.normalize()) : f; for (let k = 0; k < 3; k++) C.set(col, (i + k) * 3);
  }
  n.setAttribute('color', new THREE.BufferAttribute(C, 3)); return n;
}
function plain(g) { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k); return n; }
// lifting surface: sections along a span path; sec(s) -> { le: Vector3, chord, chordDir, thickDir, t }
const AF = [0, 0.02, 0.07, 0.16, 0.3, 0.48, 0.66, 0.82, 1]; // chord stations (cosine-ish)
function airfoil(x) { return 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4); }
function liftSurface(spans, sec, camber = 0.015) {
  const ring = []; for (let k = AF.length - 1; k >= 0; k--) ring.push([AF[k], 1]); for (let k = 1; k < AF.length; k++) ring.push([AF[k], -1]);
  const at = (S, c, side) => S.le.clone().addScaledVector(S.chordDir, c * S.chord).addScaledVector(S.thickDir, (side * airfoil(Math.min(1, c)) * S.t + camber * 4 * c * (1 - c)) * S.chord);
  const g = grid(spans.length, ring.length, (i, j) => at(sec(spans[i]), ring[j][0], ring[j][1]));
  // winding: an upper-surface face must face thickDir
  { const P = g.attributes.position, I = g.index.array, k = 6; const a = new THREE.Vector3().fromBufferAttribute(P, I[k]), b = new THREE.Vector3().fromBufferAttribute(P, I[k + 1]), c = new THREE.Vector3().fromBufferAttribute(P, I[k + 2]);
    if (b.sub(a).cross(c.sub(a)).dot(sec(spans[0]).thickDir) < 0) flipped(g); }
  const caps = [], s0 = spans[0], s1 = spans[spans.length - 1], spanDir = sec(s1).le.clone().sub(sec(s0).le).normalize();
  for (const [s, want] of [[s0, -1], [s1, 1]]) {
    const S = sec(s); const pts = ring.map(([c, side]) => at(S, c, side));
    const P = [], I = []; for (const p of pts) P.push(p.x, p.y, p.z); for (let k = 1; k < pts.length - 1; k++) I.push(0, k, k + 1);
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); cg.setIndex(I);
    const n = pts[1].clone().sub(pts[0]).cross(pts[pts.length - 2].clone().sub(pts[0])); // rough polygon normal
    let area = new THREE.Vector3(); for (let k = 1; k < pts.length - 1; k++) area.add(pts[k].clone().sub(pts[0]).cross(pts[k + 1].clone().sub(pts[0])));
    if (area.dot(spanDir) * want < 0) flipped(cg); else cg.computeVertexNormals(); caps.push(cg);
  }
  return { g, caps };
}
function orient(g, outward) { // make faces point along `outward(centroid)` on average
  const P = g.attributes.position, I = g.index.array; let s = 0; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let k = 0; k < I.length; k += 3) { a.fromBufferAttribute(P, I[k]); b.fromBufferAttribute(P, I[k + 1]); c.fromBufferAttribute(P, I[k + 2]); const n = b.clone().sub(a).cross(c.clone().sub(a)); const m = a.clone().add(b).add(c).multiplyScalar(1 / 3); s += n.dot(outward(m)); }
  return s < 0 ? flipped(g) : g;
}
function lathe(prof, seg, ax = 'z') { // prof: [[r, z]], around the z axis
  const g = grid(prof.length, seg, (i, j) => { const a = j / seg * Math.PI * 2; return new THREE.Vector3(Math.sin(a) * prof[i][0], -Math.cos(a) * prof[i][0], prof[i][1]); }, true);
  return g;
}

// ------------------------------------------------------------------------------------------------------------------
export function airlinerGeometry(lod = 'high') {
  const hi = lod !== 'low';
  const body = [], liv = [];
  const WHITE = [0.93, 0.94, 0.95], BELLY = [0.6, 0.63, 0.68], WING = [0.72, 0.75, 0.78], METAL = [0.84, 0.86, 0.88], DARK = [0.05, 0.065, 0.08], TYRE = [0.07, 0.07, 0.075], STRUT = [0.62, 0.64, 0.66];
  // ---- fuselage
  const zs = hi ? [NOSE, NOSE + 0.06, NOSE + 0.22, NOSE + 0.5, NOSE + 0.9, NOSE + 1.4, NOSE + 2.0, NOSE + 2.7, NOSE + 3.5, NOSE + 4.4, NOSE + 5.4, -12.1, -8, -4, 0, 3, 5.5, 8, 10.5, 12.5, 14.3, 15.9, 17.2, 18.2, 18.8, TAIL]
    : [NOSE, NOSE + 0.3, NOSE + 1.0, NOSE + 2.2, NOSE + 3.8, -12.1, -4, 3, 7, 11, 14.5, 17.2, TAIL];
  const th = (hi ? [0, 20, 40, 60, 78, 92, 104, 115, 128, 142, 158] : [0, 36, 72, 98, 115, 145]).map(d => d * Math.PI / 180);
  const ths = [...th, Math.PI, ...th.slice(1).reverse().map(t => 2 * Math.PI - t)];
  const fus = grid(zs.length, ths.length, (i, j) => fpt(zs[i], ths[j]), true);
  // tip normals straight ahead
  { const N = fus.attributes.normal; for (let j = 0; j < ths.length; j++) { const n = fnrm(NOSE + 0.05, ths[j]).lerp(new THREE.Vector3(0, -0.15, -1), 0.6).normalize(); N.setXYZ(j, n.x, n.y, n.z); } }
  body.push(colour(orient(fus, m => new THREE.Vector3(m.x, m.y - section(m.z).ym, m.z < -15 ? -1 : m.z > 16 ? 0.5 : 0)), (c) => { const s = section(c.z); return c.y < s.ym - (s.ym - s.bot) * 0.418 ? BELLY : WHITE; }));
  // tail cap (APU exhaust)
  { const s = section(TAIL); const P = [0, s.ym + (s.top - s.ym) * 0.1, TAIL + 0.12], I = []; for (let j = 0; j < ths.length; j++) { const p = fpt(TAIL, ths[j]); P.push(p.x, p.y, p.z); } for (let j = 0; j < ths.length; j++) I.push(0, 1 + j, 1 + (j + 1) % ths.length);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); body.push(colour(orient(g, () => new THREE.Vector3(0, 0, 1)), [0.18, 0.18, 0.2])); }
  // cheatline band under the windows (livery colour), offset just off the skin
  if (true) { const bz = zs.filter(z => z > NOSE + 4.0 && z < 17.3); const bt = [86, 91, 96].map(d => d * Math.PI / 180);
    for (const sd of [1, -1]) { const g = grid(bz.length, bt.length, (i, j) => fpt(bz[i], sd > 0 ? bt[j] : 2 * Math.PI - bt[j], 0.022)); liv.push(plain(orient(g, m => new THREE.Vector3(m.x, 0, 0)))); } }
  // windows: cockpit panes (bilinear patches in (d from nose, theta)) and the cabin window row
  const patch = (corners, off, n = 2) => { const g = grid(n + 1, n + 1, (i, j) => { const u = j / n, v = i / n; const d = (1 - v) * ((1 - u) * corners[0][0] + u * corners[1][0]) + v * ((1 - u) * corners[3][0] + u * corners[2][0]); const t = (1 - v) * ((1 - u) * corners[0][1] + u * corners[1][1]) + v * ((1 - u) * corners[3][1] + u * corners[2][1]); return fpt(NOSE + d, t * Math.PI / 180, off); }); return g; };
  const panes = [[[1.55, 3], [2.0, 3], [2.32, 33], [1.86, 37]], [[1.95, 40], [2.38, 36], [2.78, 52], [2.3, 58]], [[2.42, 61], [2.88, 55], [3.42, 60], [2.95, 69]]];
  for (const sd of [1, -1]) for (const pc of panes) { const c = pc.map(([d, t]) => [d, sd > 0 ? t : 360 - t]); body.push(colour(orient(patch(c, 0.012), m => fnrm(m.z, Math.atan2(m.x, m.y - section(m.z).ym))), DARK)); }
  if (hi) {
    const wq = []; const ww = 0.11, wh = 0.16;
    for (let z = -10.97; z < 10.6; z += 0.535) for (const sd of [1, -1]) {
      const s = section(z); const yw = 0.42; const c = (yw - s.ym) / (s.top - s.ym); if (c > 0.98) continue; const t0 = Math.acos(c); const t = sd > 0 ? t0 : 2 * Math.PI - t0;
      const p = fpt(z, t, 0.01), n = fnrm(z, t), up = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize(), al = new THREE.Vector3().crossVectors(up, n).normalize();
      const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => p.clone().addScaledVector(al, a * ww).addScaledVector(up, b * wh));
      for (const k of [0, 1, 2, 0, 2, 3]) wq.push(q[k].x, q[k].y, q[k].z);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wq, 3)); g.computeVertexNormals(); body.push(colour(g, DARK));
    // door outlines (L1 / R1 / L2 / R2) as slightly darker panels
    for (const z of [-13.0, 11.6]) for (const sd of [1, -1]) { const s = section(z); const ta = Math.acos((1.3 - s.ym) / (s.top - s.ym)), tb = Math.acos(Math.max(-1, (-0.55 - s.ym) / (s.ym - s.bot)));
      const t0 = sd > 0 ? ta : 2 * Math.PI - tb, t1 = sd > 0 ? tb : 2 * Math.PI - ta; const g = grid(2, 4, (i, j) => fpt(z - 0.4 + 0.8 * i, t0 + (t1 - t0) * j / 3, 0.006));
      body.push(colour(orient(g, m => new THREE.Vector3(m.x, 0, 0)), [0.82, 0.84, 0.87])); }
  }
  // belly fairing
  { const bf = new THREE.SphereGeometry(1, hi ? 18 : 10, hi ? 9 : 6); bf.scale(2.25, 0.85, 7.2); bf.translate(0, -1.5, -0.4); body.push(colour(bf, [0.66, 0.68, 0.72])); }
  // ---- wings (root chord 6.6, LE sweep 27 deg, dihedral 5.5 deg)
  const dih = 5.5 * Math.PI / 180, span = 15.25, tanS = Math.tan(27 * Math.PI / 180);
  for (const S of [1, -1]) {
    const root = new THREE.Vector3(S * 1.6, -1.05, -4.3), sv = new THREE.Vector3(S * Math.cos(dih), Math.sin(dih), 0);
    const chordAt = s => s < 0.34 ? 6.6 + (3.75 - 6.6) * s / 0.34 : 3.75 + (1.5 - 3.75) * (s - 0.34) / 0.66;
    const sec = s => ({ le: root.clone().addScaledVector(sv, s * span).add(new THREE.Vector3(0, 0, s * span * tanS)), chord: chordAt(s), chordDir: new THREE.Vector3(0, 0, 1), thickDir: new THREE.Vector3(0, 1, 0), t: 0.145 - 0.04 * s });
    const spans = hi ? [0, 0.17, 0.34, 0.52, 0.7, 0.86, 1] : [0, 0.34, 1];
    const w = liftSurface(spans, sec, 0.016);
    const wcol = c => { const s = Math.min(1, Math.max(0, (Math.abs(c.x) - 1.6) / (span * Math.cos(dih)))); const S0 = sec(s); const f = (c.z - S0.le.z) / S0.chord; return f < 0.1 ? METAL : f > 0.8 ? [0.66, 0.69, 0.72] : WING; };
    body.push(colour(w.g, wcol));
    for (const cg of w.caps) body.push(colour(cg, WING));
    // sharklet: blended winglet rising from the tip (livery-coloured faces)
    const tip = sec(1); const wl = liftSurface(hi ? [0, 0.25, 0.6, 1] : [0, 1], s => { const k = Math.sin(s * Math.PI / 2); return { le: tip.le.clone().add(new THREE.Vector3(S * (0.12 + 0.38 * k), 2.35 * s - 0.05 + 0.3 * (1 - k) * s, 0.25 + 1.1 * s)), chord: 1.45 - 0.98 * s, chordDir: new THREE.Vector3(0, 0, 1), thickDir: new THREE.Vector3(S, 0.1 * (1 - s), 0).normalize(), t: 0.09 }; }, 0);
    liv.push(plain(wl.g), plain(wl.caps[1]));
    // flap-track fairings
    if (hi) for (const s of [0.22, 0.46, 0.64]) { const S0 = sec(s); const zt = S0.le.z + S0.chord * 1.18, z0 = S0.le.z + S0.chord * 0.52; const yb = S0.le.y - 0.05 * S0.chord;
      const prof = [[0.0, z0], [0.12, z0 + 0.25], [0.2, z0 + 0.7], [0.2, (z0 + zt) / 2], [0.14, zt - 0.5], [0.0, zt]];
      const ft = lathe(prof, 6); ft.scale(1, 1.5, 1); ft.translate(S0.le.x, yb - 0.12, 0); body.push(colour(orient(ft, m => new THREE.Vector3(m.x - S0.le.x, m.y - yb + 0.12, 0)), [0.68, 0.7, 0.73])); }
    // engine: nacelle (livery), inlet lip, dark fan face, spinner, core and exhaust plug; pylon
    const ex = S * 5.75, ey = -1.95, ez = -6.9;
    const nac = lathe([[0.93, 0.02], [1.04, 0.12], [1.11, 0.5], [1.12, 1.3], [1.08, 2.3], [0.96, 3.0], [0.88, 3.3]], hi ? 16 : 10); nac.translate(ex, ey, ez);
    liv.push(plain(orient(nac, m => new THREE.Vector3(m.x - ex, m.y - ey, 0))));
    const lip = lathe([[0.86, 0.5], [0.89, 0.12], [0.93, 0.02]], hi ? 16 : 10); lip.translate(ex, ey, ez); body.push(colour(orient(lip, m => new THREE.Vector3(ex - m.x, ey - m.y, -0.4)), METAL));
    const fan = new THREE.CircleGeometry(0.87, hi ? 16 : 10); fan.rotateY(Math.PI); fan.translate(ex, ey, ez + 0.5); body.push(colour(fan, [0.1, 0.11, 0.13]));
    const sp = lathe([[0.0, -0.05], [0.16, 0.18], [0.28, 0.45]], 10); sp.translate(ex, ey, ez); body.push(colour(orient(sp, m => new THREE.Vector3(m.x - ex, m.y - ey, -1)), [0.5, 0.52, 0.55]));
    const core = lathe([[0.88, 3.3], [0.62, 3.3], [0.58, 3.8], [0.44, 4.35], [0.3, 4.4], [0.05, 5.1]], 10); core.translate(ex, ey, ez); body.push(colour(orient(core, m => new THREE.Vector3(m.x - ex, m.y - ey, 0.3)), c => c.z > ez + 4.36 ? [0.42, 0.38, 0.34] : [0.28, 0.29, 0.31]));
    { const sh = new THREE.Shape(); sh.moveTo(0.9, 1.06); sh.lineTo(3.4, 1.12); sh.lineTo(5.0, 1.22); sh.lineTo(7.9, 1.24); sh.lineTo(7.4, 1.0); sh.lineTo(4.6, 0.52); sh.lineTo(3.4, 0.88); sh.lineTo(1.2, 1.0); sh.closePath();
      const pg = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false, curveSegments: 1 }); pg.translate(0, 0, -0.15); pg.rotateY(-Math.PI / 2); pg.translate(ex, ey, ez); body.push(colour(pg, WING)); }
  }
  // ---- horizontal stabilisers
  for (const S of [1, -1]) {
    const sec = s => ({ le: new THREE.Vector3(S * (0.4 + 6.1 * s), 1.0 + 0.62 * s, 13.6 + 6.1 * s * Math.tan(32 * Math.PI / 180)), chord: 3.7 - 2.35 * s, chordDir: new THREE.Vector3(0, 0, 1), thickDir: new THREE.Vector3(0, 1, 0), t: 0.11 });
    const st = liftSurface(hi ? [0, 0.5, 1] : [0, 1], sec, 0); body.push(colour(st.g, c => (c.z - sec(Math.min(1, Math.max(0, (Math.abs(c.x) - 0.4) / 6.1))).le.z) < 0.25 ? METAL : WING));
    body.push(colour(st.caps[1], WING));
  }
  // ---- fin + rudder (livery) with a dorsal fillet
  { const sec = s => ({ le: new THREE.Vector3(0, 1.3 + 7.0 * s, 11.7 + 7.0 * s * Math.tan(37 * Math.PI / 180)), chord: 6.1 - 4.0 * s, chordDir: new THREE.Vector3(0, 0, 1), thickDir: new THREE.Vector3(1, 0, 0), t: 0.11 });
    const f = liftSurface(hi ? [0, 0.35, 0.7, 1] : [0, 1], sec, 0); liv.push(plain(f.g), plain(f.caps[1]));
    const df = liftSurface([0, 1], s => ({ le: new THREE.Vector3(0, 1.75 + 0.9 * s, 9.0 + 2.9 * s), chord: 3.2 - 1.6 * s, chordDir: new THREE.Vector3(0, 0, 1), thickDir: new THREE.Vector3(1, 0, 0), t: 0.16 }), 0); liv.push(plain(df.g)); }
  // ---- landing gear (down): main legs with twin wheels, nose leg with twin wheels
  const wheel = (x, y, z, r, w) => { const g = new THREE.CylinderGeometry(r, r, w, hi ? 14 : 8, 1); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return colour(g, (c, n) => Math.abs(n.x) > 0.9 ? [0.42, 0.44, 0.46] : TYRE); };
  const strut = (x0, y0, z0, y1, r) => { const g = new THREE.CylinderGeometry(r, r, y0 - y1, 8); g.translate(x0, (y0 + y1) / 2, z0); return colour(g, STRUT); };
  for (const S of [1, -1]) { const x = S * 3.8; body.push(strut(x, -0.95, 1.25, -3.05, 0.13), wheel(x + 0.39, -3.04, 1.25, 0.58, 0.4), wheel(x - 0.39, -3.04, 1.25, 0.58, 0.4));
    const ax = new THREE.CylinderGeometry(0.07, 0.07, 1.0, 6); ax.rotateZ(Math.PI / 2); ax.translate(x, -3.04, 1.25); body.push(colour(ax, STRUT));
    const door = new THREE.BoxGeometry(0.05, 1.2, 0.9); door.translate(x + S * 0.2, -1.6, 1.25); body.push(colour(door, WING)); }
  body.push(strut(0, -1.3, -12.9, -3.25, 0.09), wheel(0.24, -3.24, -12.9, 0.38, 0.26), wheel(-0.24, -3.24, -12.9, 0.38, 0.26));
  const merge = parts => { const out = mergeGeometries(parts); out.computeBoundingSphere(); return out; };
  return { body: merge(body), fin: merge(liv) };
}
const _cache = {};
export function trafficAirliner(lod = 'high') { return _cache[lod] || (_cache[lod] = airlinerGeometry(lod)); }
