// Procedural generic twin-engine narrow-body airliner (A320/737 class; no real brand or livery).
// Body frame: x = right wing, y = up, z = aft (nose points to -z). Origin ~ centre of gravity.
import * as THREE from 'three';
import { atmos, ATM } from './sky.js';

export const DIM = { length: 37.6, span: 35.8, noseZ: -18.6, tailZ: 19.0, R: 1.98, wheelY: -3.62, mainZ: 1.25, mainX: 3.8, noseGearZ: -12.9 };

function fuselageGeometry() {
  const R = DIM.R, st = [];
  const N0 = 16; for (let i = 0; i <= N0; i++) { const t = i / N0; const tt = Math.pow(t, 0.85); st.push({ z: DIM.noseZ + 5.4 * tt, r: R * Math.sqrt(1 - Math.pow(1 - tt, 2.3)), cy: -0.42 * Math.pow(1 - tt, 2) }); }
  for (let z = -12.8; z < 6.4; z += 2.2) st.push({ z, r: R, cy: 0 });
  const N2 = 16; for (let i = 0; i <= N2; i++) { const t = i / N2; st.push({ z: 6.4 + (DIM.tailZ - 6.4) * t, r: R * (1 - 0.86 * Math.pow(t, 1.25)), cy: 1.12 * Math.pow(t, 1.55) }); }
  const S = 40, P = [], U = [], I = [];
  st.forEach((s, i) => {
    for (let j = 0; j <= S; j++) { const th = j / S * Math.PI * 2; P.push(s.r * Math.sin(th), s.cy + s.r * 1.04 * Math.cos(th), s.z); U.push((s.z - DIM.noseZ) / DIM.length, 1 - j / S); }
    if (i) for (let j = 0; j < S; j++) { const a = (i - 1) * (S + 1) + j, b = a + 1, c = a + S + 1, d = c + 1; I.push(a, c, b, b, c, d); }
  });
  // cap the tail cone (APU exhaust)
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals();
  return g;
}

// Generic lofted lifting surface. o: root LE point, span: vector to tip (root→tip incl. dihedral), chordDir: aft unit,
// thickDir: "up" for this surface; c0..c1 chord fractions, s0..s1 span fractions.
function surface(o) {
  const { root, spanV, chordDir, thickDir, cr, ct, sweep, tr = 0.12, tt = 0.1, c0 = 0, c1 = 1, s0 = 0, s1 = 1, ns = 6, nc = 10, mirror = false, camber = 0.02 } = o;
  const P = [], UV = [], I = [];
  const pt = (s, c, side) => {
    const ch = cr + (ct - cr) * s, le = sweep * s, th = (tr + (tt - tr) * s);
    const x = c; const yt = 5 * th * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const cam = camber * 4 * x * (1 - x);
    const v = new THREE.Vector3().copy(root).addScaledVector(spanV, s).addScaledVector(chordDir, le + c * ch).addScaledVector(thickDir, (side * yt + cam) * ch);
    return v;
  };
  const grid = (side) => {
    const base = P.length / 3;
    for (let i = 0; i <= ns; i++) for (let j = 0; j <= nc; j++) {
      const s = s0 + (s1 - s0) * i / ns; const cf = j / nc; const c = c0 + (c1 - c0) * (0.5 - 0.5 * Math.cos(Math.PI * cf));
      const p = pt(s, c, side); P.push(p.x, p.y, p.z); UV.push(c, s);
    }
    for (let i = 0; i < ns; i++) for (let j = 0; j < nc; j++) {
      const a = base + i * (nc + 1) + j, b = a + 1, cc = a + nc + 1, d = cc + 1;
      if (side > 0) I.push(a, b, cc, b, d, cc); else I.push(a, cc, b, b, cc, d);
    }
  };
  grid(1); grid(-1);
  // end caps (root & tip / cut faces)
  const cap = (s, flip) => {
    const base = P.length / 3; const n = nc;
    for (let j = 0; j <= n; j++) { const c = c0 + (c1 - c0) * (0.5 - 0.5 * Math.cos(Math.PI * j / n)); const a = pt(s, c, 1), b = pt(s, c, -1); P.push(a.x, a.y, a.z, b.x, b.y, b.z); UV.push(c, s, c, s); }
    for (let j = 0; j < n; j++) { const a = base + j * 2, b = a + 1, c = a + 2, d = a + 3; if (flip) I.push(a, b, c, b, d, c); else I.push(a, c, b, b, c, d); }
  };
  cap(s0, false); cap(s1, true);
  // front/back faces when cut chordwise
  const face = (c, flip) => {
    const base = P.length / 3;
    for (let i = 0; i <= ns; i++) { const s = s0 + (s1 - s0) * i / ns; const a = pt(s, c, 1), b = pt(s, c, -1); P.push(a.x, a.y, a.z, b.x, b.y, b.z); UV.push(c, s, c, s); }
    for (let i = 0; i < ns; i++) { const a = base + i * 2, b = a + 1, cc = a + 2, d = a + 3; if (flip) I.push(a, b, cc, b, d, cc); else I.push(a, cc, b, b, cc, d); }
  };
  if (c0 > 0.001) face(c0, true); if (c1 < 0.999) face(c1, false);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  // orientation check: make the first top triangle face thickDir
  let idx = I;
  const ta = new THREE.Vector3(P[idx[0] * 3], P[idx[0] * 3 + 1], P[idx[0] * 3 + 2]), tb = new THREE.Vector3(P[idx[1] * 3], P[idx[1] * 3 + 1], P[idx[1] * 3 + 2]), tc = new THREE.Vector3(P[idx[2] * 3], P[idx[2] * 3 + 1], P[idx[2] * 3 + 2]);
  const n = tb.clone().sub(ta).cross(tc.clone().sub(ta));
  if (n.dot(thickDir) < 0) { idx = I.slice(); for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } }
  g.setIndex(idx); g.computeVertexNormals();
  g.userData.pt = pt; return g;
}

function liveryCanvas() {
  const W = 2048, H = 1024, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  const X = z => (z - DIM.noseZ) / DIM.length * W;           // along fuselage
  const Yth = th => th / 360 * H;                              // around (0 = top, 90 = right side)
  c.fillStyle = '#f2f3f4'; c.fillRect(0, 0, W, H);
  // fox swoosh: widens toward the tail and wraps under the belly
  const w = x => { const t = x / W; return 70 + 360 * Math.pow(Math.max(0, t - 0.12) / 0.88, 1.6); };
  const grad = c.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, '#f7b46a'); grad.addColorStop(0.55, '#f08a3e'); grad.addColorStop(1, '#e2602a');
  c.fillStyle = grad; c.beginPath(); c.moveTo(0, H / 2 - w(0));
  for (let x = 0; x <= W; x += 16) c.lineTo(x, H / 2 - w(x)); for (let x = W; x >= 0; x -= 16) c.lineTo(x, H / 2 + w(x)); c.closePath(); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 6; for (const sgn of [-1, 1]) { c.beginPath(); for (let x = 0; x <= W; x += 16) { const y = H / 2 + sgn * (w(x) + 9); x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
  c.fillStyle = '#1b2747'; c.beginPath(); const w2 = x => w(x) * 0.52 + 18;
  c.moveTo(0, H / 2 - w2(0)); for (let x = 0; x <= W; x += 16) c.lineTo(x, H / 2 - w2(x)); for (let x = W; x >= 0; x -= 16) c.lineTo(x, H / 2 + w2(x)); c.closePath(); c.fill();
  // panel lines (frame stations and lap joints)
  c.strokeStyle = 'rgba(40,50,60,0.10)'; c.lineWidth = 1.5; for (let z = -15; z < 18; z += 2.1) { c.beginPath(); c.moveTo(X(z), 0); c.lineTo(X(z), H); c.stroke(); } for (const th of [40, 120, 240, 320]) { c.beginPath(); c.moveTo(0, Yth(th)); c.lineTo(W, Yth(th)); c.stroke(); }
  // windows
  const winY = [Yth(79), Yth(281)];
  const emis = document.createElement('canvas'); emis.width = W; emis.height = H; const e = emis.getContext('2d'); e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  for (let z = -11.4; z < 13.2; z += 0.535) {
    if (Math.abs(z + 0.0) < 0.9 || Math.abs(z - 11.6) < 0.6 || Math.abs(z + 13) < 0.7) continue;
    for (const y of winY) { c.fillStyle = '#121a26'; rr(c, X(z) - 6, y - 14, 12.5, 26, 5); c.fill(); e.fillStyle = Math.random() < 0.85 ? '#ffd9a0' : '#5a4a3a'; rr(e, X(z) - 5, y - 12, 10.5, 22, 4); e.fill(); }
  }
  // doors (outlines)
  c.strokeStyle = 'rgba(40,50,70,0.55)'; c.lineWidth = 2.2;
  for (const z of [-13.0, -0.45, 0.45, 11.6]) for (const y of winY) { const big = Math.abs(z) > 5; const hw = big ? 21 : 13, hh = big ? 62 : 38; rr(c, X(z) - hw, y - hh * 0.45, hw * 2, hh, 6); c.stroke(); }
  // cockpit windows (dark), around the top of the nose
  c.fillStyle = '#0d131c';
  const cw = (z0, z1, t0, t1, k = 0) => { c.beginPath(); c.moveTo(X(z0), Yth(t0)); c.lineTo(X(z1), Yth(t0 - k)); c.lineTo(X(z1), Yth(t1 + k)); c.lineTo(X(z0), Yth(t1)); c.closePath(); c.fill(); };
  cw(-16.95, -16.15, 2, 30, 2); cw(-16.95, -16.15, 358 - 28, 358, -2);
  cw(-16.05, -15.35, 33, 58, 4); cw(-16.05, -15.35, 360 - 58, 360 - 33, -4);
  c.fillRect(X(-16.95), 0, X(-16.15) - X(-16.95), Yth(2)); c.fillRect(X(-16.95), Yth(358), X(-16.15) - X(-16.95), Yth(2));
  // titles: right side is mirrored horizontally, left side mirrored vertically
  const title = (y, fx, fy) => {
    c.save(); c.translate(X(-6.5), y); c.scale(fx, fy);
    c.fillStyle = '#1b2747'; c.font = '700 64px "Saira Condensed", "Arial Narrow", sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'center';
    c.fillText('NICOFOXHEART', 0, 0); c.fillStyle = '#e8732f'; c.font = '300 64px "Saira Condensed", "Arial Narrow", sans-serif'; c.fillText('AIR', 290, 0); c.restore();
  };
  title(Yth(52), -1, 1); title(Yth(308), 1, -1);
  // small fox-heart badge near the forward door
  for (const [y, fx, fy] of [[Yth(52), -1, 1], [Yth(308), 1, -1]]) { c.save(); c.translate(X(-14.4), y); c.scale(fx * 0.9, fy * 0.9); foxHeart(c, 0, 0, 34); c.restore(); }
  // registration near the tail
  c.save(); c.translate(X(15.5), Yth(66)); c.scale(-1, 1); c.fillStyle = '#5c6474'; c.font = '600 26px "B612 Mono", monospace'; c.textAlign = 'center'; c.fillText('N-FOX7H', 0, 0); c.restore();
  c.save(); c.translate(X(15.5), Yth(294)); c.scale(1, -1); c.fillStyle = '#5c6474'; c.font = '600 26px "B612 Mono", monospace'; c.textAlign = 'center'; c.fillText('N-FOX7H', 0, 0); c.restore();
  return { cv, emis };
}
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
export function foxHeart(c, x, y, s, light = false) {
  // heart with fox ears; s = half-size
  c.save(); c.translate(x, y); c.scale(s / 32, s / 32); c.translate(-32, -30);
  const g = c.createLinearGradient(0, 0, 64, 64); g.addColorStop(0, '#ffc583'); g.addColorStop(1, '#e2672a');
  c.fillStyle = g; c.beginPath();
  c.moveTo(32, 56); c.bezierCurveTo(18, 46, 6, 37, 6, 23); c.bezierCurveTo(6, 15, 11, 9, 18, 9); c.lineTo(14, 1); c.lineTo(25, 8); c.bezierCurveTo(28, 9, 30, 11, 32, 14);
  c.bezierCurveTo(34, 11, 36, 9, 39, 8); c.lineTo(50, 1); c.lineTo(46, 9); c.bezierCurveTo(53, 9, 58, 15, 58, 23); c.bezierCurveTo(58, 37, 46, 46, 32, 56); c.closePath(); c.fill();
  c.fillStyle = light ? '#1b2747' : '#fff'; c.globalAlpha = 0.95; c.beginPath(); c.moveTo(32, 47); c.bezierCurveTo(25, 41, 18, 35, 18, 27); c.bezierCurveTo(21, 30, 26, 31, 32, 36); c.bezierCurveTo(38, 31, 43, 30, 46, 27); c.bezierCurveTo(46, 35, 39, 41, 32, 47); c.fill();
  c.globalAlpha = 1; c.fillStyle = '#1a0d03'; c.beginPath(); c.arc(24, 23, 2.4, 0, 7); c.arc(40, 23, 2.4, 0, 7); c.fill();
  c.restore();
}
function finCanvas() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512; const c = cv.getContext('2d');
  // u = chord (LE→TE) → canvas x; v = span (root→tip) → canvas y bottom→top
  const g = c.createLinearGradient(0, 512, 300, 0); g.addColorStop(0, '#1b2747'); g.addColorStop(1, '#22335a'); c.fillStyle = g; c.fillRect(0, 0, 512, 512);
  const g2 = c.createLinearGradient(0, 512, 512, 0); g2.addColorStop(0, '#f7b46a'); g2.addColorStop(1, '#e2602a');
  c.fillStyle = g2; c.beginPath(); c.moveTo(0, 512); c.lineTo(512, 512); c.lineTo(512, 120); c.bezierCurveTo(380, 260, 200, 420, 0, 470); c.closePath(); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 7; c.beginPath(); c.moveTo(512, 104); c.bezierCurveTo(380, 244, 200, 404, 0, 454); c.stroke();
  foxHeart(c, 250, 250, 105);
  return cv;
}

export function buildAircraft(quality) {
  const root = new THREE.Group(); root.name = 'aircraft';
  const model = new THREE.Group(); root.add(model);
  const { cv, emis } = liveryCanvas();
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const etex = new THREE.CanvasTexture(emis); etex.colorSpace = THREE.SRGBColorSpace;
  const bodyMat = atmos(new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.3, metalness: 0.08, clearcoat: 0.7, clearcoatRoughness: 0.12, emissiveMap: etex, emissive: 0xffffff, emissiveIntensity: 0 }));
  const wingC = document.createElement('canvas'); wingC.width = wingC.height = 256; const wmC = document.createElement('canvas'); wmC.width = wmC.height = 256;
  { const c = wingC.getContext('2d'), m = wmC.getContext('2d'); c.fillStyle = '#e1e4e8'; c.fillRect(0, 0, 256, 256); m.fillStyle = 'rgb(0,120,60)'; m.fillRect(0, 0, 256, 256);
    const le = c.createLinearGradient(0, 0, 26, 0); le.addColorStop(0, '#f3f5f7'); le.addColorStop(1, '#c9ced4'); c.fillStyle = le; c.fillRect(0, 0, 24, 256); m.fillStyle = 'rgb(0,60,230)'; m.fillRect(0, 0, 24, 256);
    c.strokeStyle = 'rgba(60,70,80,.18)'; c.lineWidth = 1.2; for (let x = 24; x < 256; x += 38) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 256); c.stroke(); } for (let y = 0; y < 256; y += 21) { c.beginPath(); c.moveTo(24, y); c.lineTo(256, y); c.stroke(); }
    c.fillStyle = 'rgba(40,45,55,.25)'; for (let y = 10; y < 256; y += 42) for (let x = 40; x < 240; x += 76) c.fillRect(x, y, 3, 3);
    c.fillStyle = '#ffffff'; c.globalAlpha = 0.6; c.font = '12px sans-serif'; c.fillText('NO STEP', 120, 120); c.globalAlpha = 1; }
  const wingTex = new THREE.CanvasTexture(wingC); wingTex.colorSpace = THREE.SRGBColorSpace; wingTex.anisotropy = 8; const wingMR = new THREE.CanvasTexture(wmC);
  const wingMat = atmos(new THREE.MeshStandardMaterial({ map: wingTex, roughnessMap: wingMR, metalnessMap: wingMR, roughness: 1, metalness: 1, side: THREE.DoubleSide }));
  const wingDark = atmos(new THREE.MeshStandardMaterial({ color: 0xc2c7ce, roughness: 0.5, metalness: 0.25, side: THREE.DoubleSide }));
  const navy = atmos(new THREE.MeshPhysicalMaterial({ color: 0x1b2747, roughness: 0.3, metalness: 0.1, clearcoat: 0.6, side: THREE.DoubleSide }));
  const metal = atmos(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.9 }));
  const dark = atmos(new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }));
  const tire = atmos(new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }));
  const finTex = new THREE.CanvasTexture(finCanvas()); finTex.colorSpace = THREE.SRGBColorSpace; finTex.anisotropy = 8;
  const finMat = atmos(new THREE.MeshPhysicalMaterial({ map: finTex, roughness: 0.3, clearcoat: 0.6, side: THREE.DoubleSide, emissiveMap: finTex, emissive: 0xffffff, emissiveIntensity: 0 }));
  const shadow = quality === 'ultra';
  const add = (g, m, parent = model) => { const mesh = new THREE.Mesh(g, m); mesh.castShadow = shadow; mesh.receiveShadow = shadow; parent.add(mesh); return mesh; };

  add(fuselageGeometry(), bodyMat);
  // belly fairing
  const bf = new THREE.SphereGeometry(1, 24, 12); bf.scale(2.3, 0.9, 7.4); bf.translate(0, -1.55, -0.2); add(bf, atmos(new THREE.MeshStandardMaterial({ color: 0x9aa3b4, roughness: 0.4, metalness: 0.2 })));

  const parts = { surfaces: {}, gear: {}, fans: [], wheels: [], rev: [] };
  const wingRootY = -1.05, dihedral = 5.5 * Math.PI / 180, sweepLE = 27 * Math.PI / 180;
  const span = 15.3;
  for (const side of [1, -1]) {
    const S = side;
    const rootP = new THREE.Vector3(S * 1.7, wingRootY, -4.3);
    const spanV = new THREE.Vector3(S * Math.cos(dihedral), Math.sin(dihedral), 0).multiplyScalar(span);
    const base = { root: rootP, spanV, chordDir: new THREE.Vector3(0, 0, 1), thickDir: new THREE.Vector3(0, 1, 0), cr: 6.8, ct: 1.55, sweep: span * Math.tan(sweepLE), tr: 0.14, tt: 0.105 };
    add(surface({ ...base, c0: 0.11, c1: 0.76, ns: 10, nc: 12 }), wingMat);
    add(surface({ ...base, c0: 0, c1: 0.11, s0: 0, s1: 0.16, ns: 2, nc: 5 }), wingMat);
    add(surface({ ...base, c0: 0.76, c1: 1, s0: 0.93, s1: 1, ns: 1, nc: 4 }), wingDark);
    const pivotOf = (geo, s0, s1, c, opts = {}) => {
      const pt = geo.userData.pt; const h0 = pt(s0, c, 0), h1 = pt(s1, c, 0);
      const pivot = new THREE.Group(); pivot.position.copy(h0); model.add(pivot);
      const mesh = new THREE.Mesh(geo, opts.mat || wingDark); mesh.position.copy(h0).negate(); mesh.castShadow = shadow; pivot.add(mesh);
      return { pivot, axis: h1.clone().sub(h0).normalize(), home: h0.clone(), sign: S, chord: (base.cr + (base.ct - base.cr) * (s0 + s1) / 2) };
    };
    const flapIn = pivotOf(surface({ ...base, c0: 0.76, c1: 1, s0: 0.0, s1: 0.42, ns: 3, nc: 5 }), 0, 0.42, 0.76);
    const flapOut = pivotOf(surface({ ...base, c0: 0.76, c1: 1, s0: 0.42, s1: 0.70, ns: 2, nc: 5 }), 0.42, 0.70, 0.76);
    const ail = pivotOf(surface({ ...base, c0: 0.76, c1: 1, s0: 0.70, s1: 0.93, ns: 2, nc: 5 }), 0.70, 0.93, 0.76);
    const slat = pivotOf(surface({ ...base, c0: 0, c1: 0.11, s0: 0.16, s1: 0.98, ns: 6, nc: 5 }), 0.16, 0.98, 0.11, { mat: wingMat });
    const spoilers = [];
    for (let k = 0; k < 5; k++) {
      const s0 = 0.08 + k * 0.105, s1 = s0 + 0.1;
      const g = new THREE.BufferGeometry(); const pt = (s, c) => { const ch = base.cr + (base.ct - base.cr) * s; const p = rootP.clone().addScaledVector(spanV, s).addScaledVector(base.chordDir, base.sweep * s + c * ch); p.y += 0.36 * (1 - s * 0.6) * (ch / 6.8) + 0.02; return p; };
      const a = pt(s0, 0.6), b = pt(s1, 0.6), cc = pt(s1, 0.76), d = pt(s0, 0.76);
      g.setAttribute('position', new THREE.Float32BufferAttribute([a, b, cc, a, cc, d].flatMap(v => [v.x, v.y, v.z]), 3)); g.computeVertexNormals();
      const pivot = new THREE.Group(); pivot.position.copy(a); model.add(pivot); const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xaeb3ba, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide })); atmos(m.material); m.position.copy(a).negate(); pivot.add(m);
      spoilers.push({ pivot, axis: b.clone().sub(a).normalize(), sign: S });
    }
    // winglet / sharklet
    const tipRoot = rootP.clone().add(spanV).add(new THREE.Vector3(0, 0, base.sweep));
    const wl = surface({ root: tipRoot.clone().add(new THREE.Vector3(0, 0.05, 0.05)), spanV: new THREE.Vector3(S * 0.45, 2.35, 0.9), chordDir: new THREE.Vector3(0, 0, 1), thickDir: new THREE.Vector3(S, 0, 0), cr: 1.45, ct: 0.55, sweep: 0.9, tr: 0.09, tt: 0.08, ns: 4, nc: 6, camber: 0 });
    add(wl, finMat);
    parts.surfaces[S > 0 ? 'R' : 'L'] = { flapIn, flapOut, ail, slat, spoilers, tip: tipRoot.clone().add(new THREE.Vector3(S * 0.4, 2.3, 1.4)), wingTip: tipRoot.clone() };
    // engine
    const ex = S * 5.75, ey = -1.95, ez = -6.9;
    const prof = [[0.94, 0], [1.03, 0.05], [1.1, 0.25], [1.12, 0.7], [1.11, 2.0], [1.04, 2.9], [0.86, 3.6], [0.78, 3.95], [0.70, 3.95], [0.72, 3.4], [0.86, 2.6], [0.93, 0.6], [0.90, 0.1], [0.94, 0]].map(([r, y]) => new THREE.Vector2(r, y));
    const nac = new THREE.LatheGeometry(prof, 36); nac.rotateX(Math.PI / 2); nac.translate(ex, ey, ez);
    add(nac, navy);
    const lip = new THREE.TorusGeometry(0.985, 0.065, 8, 40); lip.translate(ex, ey, ez + 0.02); add(lip, metal);
    const fan = new THREE.Group(); fan.position.set(ex, ey, ez + 0.55); model.add(fan);
    const spin = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.65, 24).rotateX(-Math.PI / 2), atmos(new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.3, metalness: 0.6 }))); spin.position.z = -0.25; fan.add(spin);
    const bladeG = new THREE.BoxGeometry(0.06, 0.62, 0.22); bladeG.translate(0, 0.62, 0);
    for (let k = 0; k < 22; k++) { const b = new THREE.Mesh(bladeG, metal); b.rotation.z = k / 22 * Math.PI * 2; b.rotateY(0.55); fan.add(b); }
    const disk = new THREE.Mesh(new THREE.CircleGeometry(0.92, 32), dark); disk.position.z = 0.2; fan.add(disk);
    parts.fans.push(fan);
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 24).rotateX(Math.PI / 2), atmos(new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.5, metalness: 0.7 }))); core.position.set(ex, ey, ez + 4.4); model.add(core);
    // reverser translating sleeve (moves aft when deployed)
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(1.06, 0.88, 1.0, 36, 1, true).rotateX(Math.PI / 2), navy); sleeve.position.set(ex, ey, ez + 3.1); model.add(sleeve);
    parts.rev.push({ sleeve, z: ez + 3.1 });
    const pylon = new THREE.BoxGeometry(0.34, 1.0, 4.6); pylon.translate(ex, ey + 1.05, ez + 2.4); add(pylon, wingMat);
  }
  // horizontal stabiliser & elevators
  for (const S of [1, -1]) {
    const root = new THREE.Vector3(S * 0.5, 1.0, 13.7), spanV = new THREE.Vector3(S * 6.3, 6.3 * Math.tan(6 * Math.PI / 180), 0);
    const base = { root, spanV, chordDir: new THREE.Vector3(0, 0, 1), thickDir: new THREE.Vector3(0, 1, 0), cr: 3.7, ct: 1.35, sweep: 6.3 * Math.tan(32 * Math.PI / 180), tr: 0.1, tt: 0.09, camber: 0 };
    add(surface({ ...base, c0: 0, c1: 0.7, ns: 4, nc: 8 }), wingMat);
    const g = surface({ ...base, c0: 0.7, c1: 1, ns: 3, nc: 4 }); const pt = g.userData.pt; const h0 = pt(0, 0.7, 0), h1 = pt(1, 0.7, 0);
    const pivot = new THREE.Group(); pivot.position.copy(h0); model.add(pivot); const m = new THREE.Mesh(g, wingDark); m.position.copy(h0).negate(); pivot.add(m);
    parts.surfaces['E' + (S > 0 ? 'R' : 'L')] = { pivot, axis: h1.clone().sub(h0).normalize(), sign: S };
  }
  // vertical fin & rudder
  {
    const root = new THREE.Vector3(0, 1.45, 11.6), spanV = new THREE.Vector3(0, 6.4, 0);
    const base = { root, spanV, chordDir: new THREE.Vector3(0, 0, 1), thickDir: new THREE.Vector3(1, 0, 0), cr: 6.0, ct: 2.1, sweep: 6.4 * Math.tan(37 * Math.PI / 180), tr: 0.11, tt: 0.09, camber: 0 };
    add(surface({ ...base, c0: 0, c1: 0.68, ns: 6, nc: 10 }), finMat);
    const g = surface({ ...base, c0: 0.68, c1: 1, ns: 4, nc: 4 }); const pt = g.userData.pt; const h0 = pt(0, 0.68, 0), h1 = pt(1, 0.68, 0);
    const pivot = new THREE.Group(); pivot.position.copy(h0); model.add(pivot); const m = new THREE.Mesh(g, finMat); m.position.copy(h0).negate(); pivot.add(m);
    parts.surfaces.rudder = { pivot, axis: h1.clone().sub(h0).normalize() };
    // fin texture mapping: uv already (chord, span)
  }
  // landing gear
  const strutMat = metal;
  const mkWheel = (r, w) => { const g = new THREE.Group(); const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 24).rotateZ(Math.PI / 2), tire); g.add(t); const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w * 1.02, 16).rotateZ(Math.PI / 2), metal); g.add(hub); t.castShadow = shadow; return g; };
  for (const S of [1, -1]) {
    const hinge = new THREE.Group(); hinge.position.set(S * DIM.mainX, -1.25, DIM.mainZ); model.add(hinge);
    const len = 1.85; const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, len, 10), strutMat); strut.position.y = -len / 2; hinge.add(strut); strut.castShadow = shadow;
    const axle = new THREE.Group(); axle.position.y = -(DIM.wheelY + 1.25) * -1 - 0.0; axle.position.y = DIM.wheelY + 0.58 + 1.25; hinge.add(axle);
    const w1 = mkWheel(0.58, 0.42), w2 = mkWheel(0.58, 0.42); w1.position.x = 0.38; w2.position.x = -0.38; axle.add(w1, w2); parts.wheels.push(w1, w2);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 1.4), wingMat); door.position.set(S * 0.25, -0.9, 0); hinge.add(door);
    parts.gear['M' + (S > 0 ? 'R' : 'L')] = { hinge, sign: S };
  }
  {
    const hinge = new THREE.Group(); hinge.position.set(0, -1.4, DIM.noseGearZ); model.add(hinge);
    const len = 1.75; const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, len, 10), strutMat); strut.position.y = -len / 2; hinge.add(strut);
    const steer = new THREE.Group(); steer.position.y = DIM.wheelY + 0.38 + 1.4; hinge.add(steer);
    const w1 = mkWheel(0.38, 0.28), w2 = mkWheel(0.38, 0.28); w1.position.x = 0.24; w2.position.x = -0.24; steer.add(w1, w2); parts.wheels.push(w1, w2);
    parts.gear.N = { hinge, steer };
    const taxiLight = new THREE.SpotLight(0xfff2dd, 0, 260, 0.42, 0.5, 1.3); taxiLight.position.set(0, 0.6, -0.3); steer.add(taxiLight); const tt = new THREE.Object3D(); tt.position.set(0, -2.5, -40); steer.add(tt); taxiLight.target = tt;
    parts.taxiLight = taxiLight;
  }
  // landing lights (wing roots) and tail logo light emulation
  const landing = [];
  for (const S of [1, -1]) {
    const L = new THREE.SpotLight(0xfff6e8, 0, 900, 0.2, 0.45, 1.2); L.position.set(S * 4.6, -0.9, -3.4); model.add(L);
    const t = new THREE.Object3D(); t.position.set(S * 6, -9, -200); model.add(t); L.target = t; landing.push(L);
    if (quality === 'low' && S < 0) L.visible = false;
  }
  parts.landing = landing;
  // point-sprite lights: nav, beacon, strobes, landing glow
  const sR = parts.surfaces.R.tip, sL = parts.surfaces.L.tip;
  const lp = [
    [sR.x, sR.y - 1.9, sR.z - 0.6, 'navG'], [sL.x, sL.y - 1.9, sL.z - 0.6, 'navR'], [0, 2.3, 19.05, 'navW'],
    [0, 2.15, -1.2, 'bcn'], [0, -2.25, 3.0, 'bcn'],
    [sR.x, sR.y - 1.8, sR.z - 0.2, 'stb'], [sL.x, sL.y - 1.8, sL.z - 0.2, 'stb'], [0, 1.55, 19.1, 'stb'],
    [4.6, -0.9, -3.45, 'land'], [-4.6, -0.9, -3.45, 'land'], [0, -2.9, DIM.noseGearZ - 0.5, 'taxi'],
  ];
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp.flatMap(l => l.slice(0, 3)), 3));
  lg.setAttribute('aCol', new THREE.Float32BufferAttribute(new Float32Array(lp.length * 3), 3));
  const lmat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPx: { value: 1 } },
    vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\nattribute vec3 aCol; varying vec3 vC; uniform float uPx; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; vC = aCol; float d = -mv.z; gl_PointSize = clamp(1100.0/d, 2.0, 26.0) * uPx * clamp(length(aCol), 0.0, 1.0); \n#include <logdepthbuf_vertex>\n}`,
    fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\nvarying vec3 vC; void main(){ vec2 q = gl_PointCoord-0.5; float r = dot(q,q)*4.0; float a = exp(-r*6.0) + 0.5*exp(-r*40.0); gl_FragColor = vec4(vC*a*1.5, 1.0);\n#include <logdepthbuf_fragment>\n}` });
  const lpts = new THREE.Points(lg, lmat); lpts.frustumCulled = false; lpts.renderOrder = 10; model.add(lpts);
  parts.lightPts = { pts: lpts, kinds: lp.map(l => l[3]), mat: lmat };
  parts.mats = { bodyMat, finMat };
  root.userData.parts = parts;
  return root;
}

const _q = new THREE.Quaternion();
function setRot(s, angle) { s.pivot.quaternion.setFromAxisAngle(s.axis, angle * (s.sign ?? 1)); }
// st: animation state from the flight model
export function animateAircraft(ac, st, dt, t, night) {
  const P = ac.userData.parts; if (!P) return;
  const D = Math.PI / 180;
  for (const k of ['R', 'L']) {
    const S = P.surfaces[k];
    const fl = st.flapPos; // 0..1
    for (const f of [S.flapIn, S.flapOut]) {
      setRot(f, fl * 32 * D);
      const aft = new THREE.Vector3(0, -0.25, 1).normalize();
      f.pivot.position.copy(f.home).addScaledVector(aft, fl * 0.32 * f.chord * 0.6);
    }
    setRot(S.slat, -st.slatPos * 22 * D);
    S.slat.pivot.position.copy(S.slat.home).add(new THREE.Vector3(0, -0.15 * st.slatPos, -0.35 * st.slatPos));
    const ail = k === 'R' ? st.ailR : st.ailL; setRot(S.ail, ail);
    S.spoilers.forEach((sp, i) => { const roll = k === 'R' ? st.spoilerRollR : st.spoilerRollL; const a = Math.max(st.speedbrake * (i < 4 ? 40 : 30), roll * (i > 0 ? 35 : 0)) * D; sp.pivot.quaternion.setFromAxisAngle(sp.axis, -a * sp.sign); });
  }
  setRot(P.surfaces.ER, st.elevator); setRot(P.surfaces.EL, st.elevator);
  P.surfaces.rudder.pivot.quaternion.setFromAxisAngle(P.surfaces.rudder.axis, -st.rudder);
  // gear (gearPos 1 = down)
  const gp = st.gearPos; const up = 1 - gp;
  P.gear.MR.hinge.rotation.z = -up * 88 * D; P.gear.ML.hinge.rotation.z = up * 88 * D; P.gear.N.hinge.rotation.x = up * 95 * D;
  P.gear.N.steer.rotation.y = -st.steer;
  P.gear.MR.hinge.visible = P.gear.ML.hinge.visible = P.gear.N.hinge.visible = gp > 0.02;
  // wheels
  for (const w of P.wheels) w.rotation.x -= st.groundSpeed * dt / 0.55 * (st.onGround ? 1 : 0.995) ;
  // fans
  P.fans.forEach((f, i) => { f.rotation.z += (st.n1[i] / 100) * 85 * dt; });
  P.rev.forEach(r => { r.sleeve.position.z = r.z + st.reverser * 0.9; });
  // lights
  const L = P.lightPts, col = L.pts.geometry.attributes.aCol; const on = st.lights;
  const beacon = on.beacon && (t % 1.0) < 0.12, strobe = on.strobe && ((t % 1.2) < 0.05 || ((t % 1.2) > 0.12 && (t % 1.2) < 0.16));
  L.kinds.forEach((k, i) => {
    let c = [0, 0, 0];
    if (k === 'navG' && on.nav) c = [0.1, 1.0, 0.35]; else if (k === 'navR' && on.nav) c = [1.0, 0.08, 0.05]; else if (k === 'navW' && on.nav) c = [0.6, 0.6, 0.6];
    else if (k === 'bcn' && beacon) c = [1.0, 0.05, 0.02]; else if (k === 'stb' && strobe) c = [3, 3, 3];
    else if (k === 'land' && on.landing) c = [1.6, 1.5, 1.3]; else if (k === 'taxi' && on.taxi && gp > 0.9) c = [1.0, 0.95, 0.85];
    col.setXYZ(i, c[0], c[1], c[2]);
  });
  col.needsUpdate = true;
  P.landing.forEach(l => { l.intensity = on.landing ? (night ? 2600 : 600) : 0; });
  P.taxiLight.intensity = on.taxi && gp > 0.9 ? (night ? 900 : 200) : 0;
  P.mats.bodyMat.emissiveIntensity = night * 1.6;
  P.mats.finMat.emissiveIntensity = on.logo ? night * 0.35 : 0;
}
