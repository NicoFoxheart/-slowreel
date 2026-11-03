// Procedural, instanced people with real proportions, faces, hair styles, clothing, ages, props and a
// light forward-kinematics pose system (walk, stand, sit, read, phone, sleep, talk, window, lift bag,
// buckle, safety demo). One InstancedMesh per body part; matrices are composed on the CPU.
import * as THREE from 'three';
import { atmos } from './sky.js';
import { PeopleHD } from './ppl-core.js';

const SKIN = ['#f3d2b8', '#e7b48f', '#c98c62', '#9a6440', '#6b4126'];
const HAIRC = ['#1b130e', '#3b2416', '#6b4423', '#b88a4a', '#d8c08a', '#8a8a8a', '#d9d9d9', '#7a2a1a'];
const TOPS = ['#c0392b', '#2c4f7c', '#f4f1ea', '#2b2b30', '#e58e26', '#3f7d63', '#7b4a8c', '#86a8c8', '#e8a0a8', '#5a6b3b', '#d6c7a1', '#1f6f8b'];
const BOTTOMS = ['#2b3442', '#1f2024', '#5b4a3a', '#7a8794', '#3c4d6b', '#c9b99a'];
// ---------------------------------------------------------------- face atlas: 5 skin tones x 3 faces (+1 crew)
let faceTex = null;
function faces() {
  if (faceTex) return faceTex;
  const N = 4, C = 128, cv = document.createElement('canvas'); cv.width = cv.height = N * C; const c = cv.getContext('2d');
  for (let i = 0; i < 16; i++) {
    const tone = SKIN[i % 5], v = Math.floor(i / 5), x0 = (i % N) * C, y0 = Math.floor(i / N) * C;
    const g = c.createRadialGradient(x0 + C * 0.5, y0 + C * 0.45, 8, x0 + C * 0.5, y0 + C * 0.5, C * 0.7); g.addColorStop(0, tone); g.addColorStop(1, shade(tone, -0.28));
    c.fillStyle = g; c.fillRect(x0, y0, C, C);
    const cx = x0 + C / 2, ey = y0 + C * 0.47, dx = C * 0.15;
    // brows
    c.strokeStyle = shade(tone, -0.55); c.lineWidth = v === 1 ? 4 : 3; c.lineCap = 'round';
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(cx + s * dx - 9, ey - 13 + (v === 2 ? 1 : 0)); c.quadraticCurveTo(cx + s * dx, ey - 17, cx + s * dx + 9, ey - 12); c.stroke(); }
    // eyes
    for (const s of [-1, 1]) {
      c.fillStyle = '#f6f3ee'; c.beginPath(); c.ellipse(cx + s * dx, ey, 7.5, 4.2, 0, 0, 7); c.fill();
      c.fillStyle = i % 7 === 3 && v !== 0 ? '#4a6f8a' : '#3a2416'; c.beginPath(); c.arc(cx + s * dx, ey + 0.5, 3.6, 0, 7); c.fill();
      c.fillStyle = '#0c0806'; c.beginPath(); c.arc(cx + s * dx, ey + 0.5, 1.6, 0, 7); c.fill();
      c.strokeStyle = shade(tone, -0.45); c.lineWidth = 1.6; c.beginPath(); c.ellipse(cx + s * dx, ey, 7.8, 4.6, 0, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
    }
    // nose and mouth
    c.strokeStyle = shade(tone, -0.25); c.lineWidth = 2.2; c.beginPath(); c.moveTo(cx - 1, ey + 6); c.quadraticCurveTo(cx - 4, ey + 20, cx + 3, ey + 21); c.stroke();
    c.fillStyle = shade(tone, -0.3); c.beginPath(); c.ellipse(cx, ey + 33, v === 2 ? 9 : 11, v === 0 ? 3.2 : 4.2, 0, 0, 7); c.fill();
    c.fillStyle = 'rgba(200,90,90,.18)'; for (const s of [-1, 1]) { c.beginPath(); c.arc(cx + s * 22, ey + 16, 8, 0, 7); c.fill(); }
  }
  faceTex = new THREE.CanvasTexture(cv); faceTex.colorSpace = THREE.SRGBColorSpace; faceTex.anisotropy = 4; return faceTex;
}
function shade(hex, k) { const c = new THREE.Color(hex); if (k < 0) c.multiplyScalar(1 + k); else c.lerp(new THREE.Color(1, 1, 1), k); return '#' + c.getHexString(); }

// ---------------------------------------------------------------- part geometries (baked top-down light in vertex colours)
function bake(g, lo = 0.62, hi = 1.04) {
  g.computeBoundingBox(); const b = g.boundingBox, P = g.attributes.position, N = g.attributes.normal, n = P.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const t = (P.getY(i) - b.min.y) / Math.max(1e-3, b.max.y - b.min.y); const up = N ? Math.max(0, N.getY(i)) * 0.12 : 0; const side = N ? 0.92 + 0.08 * Math.abs(N.getZ(i)) : 1; const v = (lo + (hi - lo) * t + up) * side; col.set([v, v, v], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
}
const cyl = (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(0, -h / 2, 0); // hangs down from pivot
let GEO = null;
function geos() {
  if (GEO) return GEO;
  const torso = new THREE.CylinderGeometry(0.175, 0.15, 0.56, 14).scale(1, 1, 0.62).translate(0, 0.28, 0); // from hip pivot up
  const chest = new THREE.SphereGeometry(0.19, 14, 8).scale(1.02, 0.42, 0.62).translate(0, 0.52, 0);
  const hips = new THREE.SphereGeometry(0.165, 12, 8).scale(1, 0.5, 0.68).translate(0, 0.0, 0);
  const t = mergeGeo([torso, chest, hips]);
  const head = new THREE.SphereGeometry(0.103, 20, 16).scale(0.9, 1.1, 0.98).translate(0, 0.16, 0.0);
  // UVs: front hemisphere gets the face cell
  { const P = head.attributes.position, U = head.attributes.uv; for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i) - 0.16, z = P.getZ(i); if (z > 0) U.setXY(i, 0.5 + x / 0.2 * 0.95, 0.52 + y / 0.24 * 0.95); else U.setXY(i, 0.04, 0.04); } }
  const neck = new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8).translate(0, 0.04, 0);
  const ears = mergeGeo([new THREE.SphereGeometry(0.022, 6, 6).scale(0.5, 1, 1).translate(-0.093, 0.16, 0), new THREE.SphereGeometry(0.022, 6, 6).scale(0.5, 1, 1).translate(0.093, 0.16, 0)]);
  const skinHead = mergeGeo([neck, ears]);
  const capR = 0.112;
  const cap = () => new THREE.SphereGeometry(capR, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.94, 1.08, 1.04).rotateX(-0.22).translate(0, 0.17, -0.012);
  const hair = {
    short: cap(),
    long: mergeGeo([cap(), new THREE.BoxGeometry(0.2, 0.26, 0.05).translate(0, 0.07, -0.085), new THREE.SphereGeometry(0.105, 10, 8).scale(1, 1.25, 0.6).translate(0, 0.1, -0.06)]),
    bun: mergeGeo([cap(), new THREE.SphereGeometry(0.048, 10, 8).translate(0, 0.25, -0.08)]),
    pony: mergeGeo([cap(), new THREE.CylinderGeometry(0.03, 0.012, 0.2, 8).rotateX(0.35).translate(0, 0.1, -0.12)]),
    curly: mergeGeo([new THREE.SphereGeometry(0.125, 12, 10).scale(1.05, 1.0, 1.05).translate(0, 0.2, -0.015)]),
  };
  const upperArm = cyl(0.05, 0.043, 0.3), lowerArm = cyl(0.042, 0.035, 0.26), hand = new THREE.SphereGeometry(0.042, 8, 6).scale(0.8, 1.2, 0.5).translate(0, -0.05, 0);
  const thigh = cyl(0.078, 0.058, 0.44), shin = cyl(0.056, 0.042, 0.43);
  const shoe = new THREE.BoxGeometry(0.09, 0.07, 0.25).translate(0, -0.035, 0.05);
  const skirt = new THREE.CylinderGeometry(0.16, 0.26, 0.52, 14).translate(0, -0.24, 0);
  const backpack = new THREE.BoxGeometry(0.3, 0.38, 0.15).translate(0, 0.32, -0.19);
  const suitcase = mergeGeo([new THREE.BoxGeometry(0.38, 0.55, 0.22).translate(0, 0.33, 0), new THREE.CylinderGeometry(0.01, 0.01, 0.42, 6).translate(-0.08, 0.8, 0), new THREE.CylinderGeometry(0.01, 0.01, 0.42, 6).translate(0.08, 0.8, 0), new THREE.BoxGeometry(0.2, 0.03, 0.03).translate(0, 1.01, 0)]);
  const phone = new THREE.BoxGeometry(0.07, 0.14, 0.012); const book = new THREE.BoxGeometry(0.2, 0.26, 0.03);
  const scarf = new THREE.TorusGeometry(0.07, 0.025, 6, 14).rotateX(Math.PI / 2).translate(0, 0.57, 0.02);
  GEO = { torso: bake(t), head: bake(head, 0.95, 1.0), skinHead: bake(skinHead), hair: Object.fromEntries(Object.entries(hair).map(([k, g]) => [k, bake(g, 0.7, 1.1)])), upperArm: bake(upperArm, 0.75, 1), lowerArm: bake(lowerArm, 0.75, 1), hand: bake(hand, 0.85, 1), thigh: bake(thigh, 0.7, 0.95), shin: bake(shin, 0.6, 0.85), shoe: bake(shoe, 0.6, 0.8), skirt: bake(skirt, 0.65, 1), backpack: bake(backpack), suitcase: bake(suitcase), phone: bake(phone), book: bake(book), scarf: bake(scarf) };
  return GEO;
}
function mergeGeo(gs) {
  const list = gs.map(g => g.index ? g.toNonIndexed() : g); let n = 0; for (const g of list) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2); let o = 0;
  for (const g of list) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; }
  const r = new THREE.BufferGeometry(); r.setAttribute('position', new THREE.BufferAttribute(P, 3)); r.setAttribute('normal', new THREE.BufferAttribute(N, 3)); r.setAttribute('uv', new THREE.BufferAttribute(U, 2)); return r;
}

// ---------------------------------------------------------------- people set
// People: the HD implementation (ppl-core.js: one smooth GPU-skinned body per person, sculpted heads, hands,
// layered clothes, hair, LOD). Falls back to the legacy rigid-part people below if it cannot be built
// (for example without float textures). Same API either way: p[], paint(p), setCrew(i[, role]), setExposure(k), commit(t, camLocal).
export class People {
  constructor(parent, n, rnd, opts = {}) {
    if (!opts.legacy && !LEGACY) { try { return new PeopleHD(parent, n, rnd, opts); } catch (e) { console.warn('People HD failed, using legacy people:', e); LEGACY = true; } }
    return new LegacyPeople(parent, n, rnd, opts);
  }
  static setQuality(q) { PeopleHD.setQuality(q); }
}
let LEGACY = false;
class LegacyPeople {
  constructor(parent, n, rnd, opts = {}) {
    const G = geos(); this.n = n; this.rnd = rnd; this.parent = parent; this.meshes = {};
    this.mat = atmos(new THREE.MeshBasicMaterial({ vertexColors: true })); this.mat.userData.key = 'ppl2';
    const fm = new THREE.MeshBasicMaterial({ map: faces(), vertexColors: true }); fm.userData.key = 'face';
    fm.onBeforeCompile = (sh, r) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aCell;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = aCell + uv * 0.25;'); };
    this.faceMat = atmos(fm);
    const mk = (name, geo, mat = this.mat) => { const m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; m.count = n; parent.add(m); this.meshes[name] = m; return m; };
    for (const k of ['torso', 'skinHead', 'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR', 'handL', 'handR', 'thighL', 'thighR', 'shinL', 'shinR', 'shoeL', 'shoeR', 'skirt', 'backpack', 'suitcase', 'phone', 'book', 'scarf']) {
      const g = { upperArmL: G.upperArm, upperArmR: G.upperArm, lowerArmL: G.lowerArm, lowerArmR: G.lowerArm, handL: G.hand, handR: G.hand, thighL: G.thigh, thighR: G.thigh, shinL: G.shin, shinR: G.shin, shoeL: G.shoe, shoeR: G.shoe }[k] || G[k];
      mk(k, g);
    }
    const headGeo = G.head.clone(); const cells = new Float32Array(n * 2); headGeo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2)); mk('head', headGeo, this.faceMat); this.cells = cells;
    for (const [k, g] of Object.entries(G.hair)) mk('hair_' + k, g);
    this.p = []; const C = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const r = rnd; const ageR = r(); const age = ageR < 0.1 ? 'kid' : ageR < 0.18 ? 'teen' : ageR < 0.86 ? 'adult' : 'elder';
      const female = r() < 0.5; const skin = (r() * 5) | 0; const face = skin + 5 * ((r() * 3) | 0);
      const scale = age === 'kid' ? 0.55 + r() * 0.15 : age === 'teen' ? 0.88 + r() * 0.06 : (female ? 0.93 : 0.99) + r() * 0.07;
      const dress = female && age !== 'kid' && r() < 0.28, longSleeve = r() < 0.55, shorts = !dress && r() < 0.15;
      const hairStyle = age === 'elder' && !female && r() < 0.4 ? 'none' : female ? ['long', 'bun', 'pony', 'long', 'curly'][(r() * 5) | 0] : ['short', 'short', 'curly', 'short', 'none'][(r() * 5) | 0];
      const hairC = age === 'elder' ? HAIRC[5 + ((r() * 2) | 0)] : HAIRC[(r() * 5) | 0];
      const top = TOPS[(r() * TOPS.length) | 0], bottom = dress ? top : BOTTOMS[(r() * BOTTOMS.length) | 0];
      const p = { i, age, female, skin, face, scale, dress, longSleeve, shorts, hairStyle, hairC, top, bottom, x: 0, y: -100, z: 0, yaw: 0, mode: 'stand', act: 'idle', phase: r() * 6, speed: 1.1, backpack: r() < 0.3, suitcase: false, prop: null, stoop: age === 'elder' ? 0.12 : 0, seed: r() * 100, hidden: false, crew: false };
      this.p.push(p); this.paint(p);
    }
    this.M = new THREE.Matrix4(); this.tmp = new THREE.Matrix4(); this.Q = new THREE.Quaternion(); this.E = new THREE.Euler(); this.V = new THREE.Vector3(); this.S = new THREE.Vector3(); this.ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
    this.frame = 0; this.camPos = new THREE.Vector3();
  }
  paint(p) {
    const C = new THREE.Color(); const set = (k, c) => { this.meshes[k].setColorAt(p.i, C.set(c)); if (this.meshes[k].instanceColor) this.meshes[k].instanceColor.needsUpdate = true; };
    const skin = SKIN[p.skin];
    set('torso', p.top); for (const s of ['L', 'R']) { set('upperArm' + s, p.top); set('lowerArm' + s, p.longSleeve ? p.top : skin); set('hand' + s, skin); set('thigh' + s, p.shorts ? skin : p.bottom); set('shin' + s, p.dress || p.shorts ? skin : p.bottom); set('shoe' + s, p.crew ? '#111' : ['#1c1c1c', '#f2f2f2', '#6b4a2b', '#2b3442'][p.i % 4]); }
    set('skinHead', skin); set('skirt', p.bottom); set('backpack', ['#2b3442', '#c0392b', '#3f7d63', '#d6c7a1'][p.i % 4]); set('suitcase', ['#2c4f7c', '#1f2024', '#c0392b', '#9aa3b4', '#e58e26'][p.i % 5]); set('phone', '#111'); set('book', ['#a33', '#36a', '#3a6'][p.i % 3]); set('scarf', '#f29a4c');
    set('head', '#ffffff'); for (const k of Object.keys(GEO.hair)) set('hair_' + k, p.hairC);
    this.cells[p.i * 2] = (p.face % 4) * 0.25; this.cells[p.i * 2 + 1] = 1 - (Math.floor(p.face / 4) + 1) * 0.25; this.meshes.head.geometry.attributes.aCell.needsUpdate = true;
  }
  setCrew(i) { const p = this.p[i]; Object.assign(p, { crew: true, top: '#1b2747', bottom: '#1b2747', dress: p.female, longSleeve: true, shorts: false, backpack: false, age: 'adult', scale: Math.max(0.95, p.scale), stoop: 0 }); if (p.hairStyle === 'none') p.hairStyle = 'short'; this.paint(p); }
  setExposure(k) { this.mat.color.setScalar(k); this.faceMat.color.setScalar(k); }
  // ---------------------------------------------------------------- pose → part matrices
  commit(t, camPos) {
    this.frame++; if (camPos) this.camPos.copy(camPos);
    const M = this.M, T = this.tmp, mats = this.meshes;
    for (const p of this.p) {
      if (p.hidden || p.y < -50) { for (const k in mats) mats[k].setMatrixAt(p.i, this.ZERO); continue; }
      const far = this.camPos.distanceToSquared(this.V.set(p.x, p.y, p.z)) > 900; // LOD: far people animate at 1/3 rate, no props
      if (far && (this.frame + p.i) % 3 && p._init) continue; p._init = true;
      const A = this.pose(p, t);
      // root
      this.Q.setFromAxisAngle(this.V.set(0, 1, 0), p.yaw); const root = new THREE.Matrix4().compose(this.V.set(p.x, p.y, p.z), this.Q, this.S.setScalar(p.scale));
      const hip = root.clone().multiply(T.makeTranslation(0, A.hipY, A.hipZ)).multiply(rot(A.hipPitch + p.stoop * 0.3, A.hipYaw, A.hipRoll));
      const torso = hip.clone().multiply(rot(A.lean + p.stoop, A.torsoYaw, A.torsoRoll));
      mats.torso.setMatrixAt(p.i, torso);
      const neck = torso.clone().multiply(T.makeTranslation(0, 0.6, 0)).multiply(rot(A.headPitch + p.stoop * 0.6, A.headYaw, A.headRoll));
      mats.skinHead.setMatrixAt(p.i, neck); mats.head.setMatrixAt(p.i, neck);
      for (const k of Object.keys(GEO.hair)) mats['hair_' + k].setMatrixAt(p.i, k === p.hairStyle ? neck : this.ZERO);
      mats.scarf.setMatrixAt(p.i, p.crew ? torso : this.ZERO);
      mats.backpack.setMatrixAt(p.i, p.backpack && p.mode !== 'sit' ? torso : this.ZERO);
      for (const s of [-1, 1]) {
        const L = s < 0 ? 'L' : 'R', a = A.arm[L];
        const sh = torso.clone().multiply(T.makeTranslation(s * 0.2, 0.53, 0)).multiply(rot(a.sp, 0, s * a.sr));
        mats['upperArm' + L].setMatrixAt(p.i, sh);
        const el = sh.clone().multiply(T.makeTranslation(0, -0.3, 0)).multiply(rot(a.el, 0, 0));
        mats['lowerArm' + L].setMatrixAt(p.i, el);
        const hd = el.clone().multiply(T.makeTranslation(0, -0.26, 0)); mats['hand' + L].setMatrixAt(p.i, hd);
        if (L === 'R') { mats.phone.setMatrixAt(p.i, p.prop === 'phone' && !far ? hd.clone().multiply(T.makeTranslation(0, -0.06, 0.03)).multiply(rot(-1.2, 0, 0)) : this.ZERO); mats.book.setMatrixAt(p.i, p.prop === 'book' && !far ? hd.clone().multiply(T.makeTranslation(-0.12, -0.08, 0.05)).multiply(rot(-1.0, 0, 0)) : this.ZERO); }
        const l = A.leg[L]; const th = hip.clone().multiply(T.makeTranslation(s * 0.09, 0, 0)).multiply(rot(l.hp, 0, s * 0.02));
        mats['thigh' + L].setMatrixAt(p.i, th);
        const kn = th.clone().multiply(T.makeTranslation(0, -0.44, 0)).multiply(rot(l.kn, 0, 0));
        mats['shin' + L].setMatrixAt(p.i, kn); mats['shoe' + L].setMatrixAt(p.i, kn.clone().multiply(T.makeTranslation(0, -0.43, 0)).multiply(rot(-l.kn - l.hp, 0, 0)));
      }
      mats.skirt.setMatrixAt(p.i, p.dress ? hip.clone().multiply(rot(A.mode === 'sit' ? -0.9 : 0, 0, 0)) : this.ZERO);
      // rolling suitcase trails behind the right hand
      if (p.suitcase && p.mode !== 'sit') { const sc = root.clone().multiply(T.makeTranslation(0.32, 0, -0.45)).multiply(rot(-0.35, 0, 0)); mats.suitcase.setMatrixAt(p.i, sc); } else mats.suitcase.setMatrixAt(p.i, this.ZERO);
    }
    for (const k in mats) mats[k].instanceMatrix.needsUpdate = true;
  }
  pose(p, t) {
    const A = { hipY: 0.92, hipZ: 0, hipPitch: 0, hipYaw: 0, hipRoll: 0, lean: 0, torsoYaw: 0, torsoRoll: 0, headPitch: 0, headYaw: 0, headRoll: 0, mode: p.mode,
      arm: { L: { sp: 0.05, sr: 0.08, el: -0.15 }, R: { sp: 0.05, sr: 0.08, el: -0.15 } }, leg: { L: { hp: 0, kn: 0 }, R: { hp: 0, kn: 0 } } };
    const s = p.seed, slow = Math.sin(t * 0.37 + s), slow2 = Math.sin(t * 0.21 + s * 1.7);
    if (p.mode === 'walk') {
      p.phase += 0; const ph = (t * p.speed * 5.2 + s) % (Math.PI * 2); const sw = Math.sin(ph) * 0.5;
      A.leg.L.hp = -sw; A.leg.R.hp = sw; A.leg.L.kn = Math.max(0, Math.sin(ph + 1.6)) * 0.7; A.leg.R.kn = Math.max(0, Math.sin(ph + 1.6 + Math.PI)) * 0.7;
      A.arm.L.sp = sw * 0.7; A.arm.R.sp = -sw * 0.7; A.arm.L.el = -0.25; A.arm.R.el = -0.25; A.hipY = 0.92 + Math.abs(Math.cos(ph)) * 0.025; A.torsoYaw = sw * 0.12; A.lean = 0.04;
      if (p.suitcase) { A.arm.R.sp = -0.35; A.arm.R.el = -0.1; }
      if (p.act === 'carry') { A.arm.R.sp = 0.2; A.arm.R.el = -1.2; }
      A.headYaw = slow * 0.25;
    } else if (p.mode === 'sit') {
      A.hipY = 0.47; A.hipZ = 0.02; A.leg.L.hp = A.leg.R.hp = -1.5; A.leg.L.kn = A.leg.R.kn = 1.45; A.lean = -0.12; A.arm.L.sp = A.arm.R.sp = -0.55; A.arm.L.el = A.arm.R.el = -0.7;
      const act = p.act;
      if (act === 'read') { A.arm.L.sp = A.arm.R.sp = -0.9; A.arm.L.el = A.arm.R.el = -1.3; A.headPitch = 0.45; p.prop = 'book'; }
      else if (act === 'phone') { A.arm.R.sp = -1.0; A.arm.R.el = -1.6; A.headPitch = 0.5 + slow * 0.05; p.prop = 'phone'; }
      else if (act === 'sleep') { A.headRoll = 0.45 * (p.i % 2 ? 1 : -1); A.headPitch = 0.25; A.lean = -0.22; p.prop = null; }
      else if (act === 'window') { A.headYaw = p.windowSide * (0.9 + slow * 0.2); A.headPitch = 0.05; p.prop = null; }
      else if (act === 'talk') { A.headYaw = (p.talkSide ?? 1) * (0.7 + slow2 * 0.15); A.headPitch = Math.sin(t * 3 + s) * 0.06; A.arm.R.sp = -0.7 + Math.sin(t * 2.3 + s) * 0.15; A.arm.R.el = -1.0; p.prop = null; }
      else if (act === 'buckle') { A.arm.L.sp = A.arm.R.sp = -0.35; A.arm.L.el = A.arm.R.el = -1.1; A.arm.L.sr = A.arm.R.sr = -0.3; A.headPitch = 0.55; p.prop = null; }
      else if (act === 'baby') { A.arm.L.sp = A.arm.R.sp = -0.8; A.arm.L.el = A.arm.R.el = -1.5; A.arm.L.sr = A.arm.R.sr = -0.5; A.headPitch = 0.35; A.headYaw = slow * 0.2; }
      else if (act === 'listen') { A.headPitch = -0.16; A.headYaw = slow * 0.08; A.headRoll = 0.06 * (p.i % 2 ? 1 : -1); p.prop = null; }
      else if (act === 'grip') { A.arm.L.sp = A.arm.R.sp = -0.3; A.arm.L.sr = A.arm.R.sr = 0.32; A.arm.L.el = A.arm.R.el = -0.45; A.lean = -0.05; A.headPitch = 0.12; A.headYaw = Math.sin(t * 1.9 + s) * 0.3; p.prop = null; }
      else if (act === 'clap') { const c = Math.sin(t * 15 + s * 3); A.arm.L.sp = A.arm.R.sp = -1.05; A.arm.L.el = A.arm.R.el = -1.35; A.arm.L.sr = A.arm.R.sr = -0.32 + c * 0.16; A.headPitch = -0.05; A.headYaw = slow * 0.2; p.prop = null; }
      else { A.headYaw = slow * 0.35; A.headPitch = slow2 * 0.08; p.prop = null; }
    } else {
      A.headYaw = slow * 0.4; A.headPitch = slow2 * 0.06; A.arm.L.sp = Math.sin(t * 0.5 + s) * 0.04;
      if (p.act === 'board') { A.headPitch = -0.35; A.headYaw = slow * 0.15; }
      else if (p.act === 'phone') { A.arm.R.sp = -1.1; A.arm.R.el = -1.5; A.headPitch = 0.5; p.prop = 'phone'; }
      else if (p.act === 'lift') { const k = Math.min(1, (p.actT || 0) / 1.2); A.arm.L.sp = A.arm.R.sp = -2.9 * k; A.arm.L.el = A.arm.R.el = -0.3; A.headPitch = -0.4 * k; }
      else if (p.act === 'demo') { const ph = Math.floor(t / 2.5) % 4; if (ph === 0) { A.arm.L.sp = A.arm.R.sp = -1.4; A.arm.L.sr = A.arm.R.sr = 1.1; } else if (ph === 1) { A.arm.L.sp = A.arm.R.sp = -0.9; A.arm.L.el = A.arm.R.el = -1.2; A.arm.L.sr = A.arm.R.sr = -0.4; } else if (ph === 2) { A.arm.R.sp = -1.6; A.arm.R.sr = 0.2; A.arm.L.sp = 0.1; } else { A.arm.L.sp = -1.6; A.arm.L.sr = 0.2; A.arm.R.sp = 0.1; } }
      else if (p.act === 'board-look') { A.headPitch = -0.4; }
      p.prop = p.act === 'phone' ? 'phone' : null;
    }
    return A;
  }
}
const _e = new THREE.Euler(), _m = new THREE.Matrix4();
function rot(x, y, z) { _e.set(x, y, z, 'YXZ'); return new THREE.Matrix4().makeRotationFromEuler(_e); }
