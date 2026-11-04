// Roads around the primary airport (procedural, plausible; no map data): a divided 3+3-lane highway on the landside,
// out beyond the airport fence, with shoulders, lane markings, a concrete median barrier, guard rails, sound walls
// where it passes houses, lamp posts and bridges on pillars over water; a diamond interchange where the 2+2-lane
// airport access road crosses over it on a bridge and runs to the terminal curb (the env artist's landside road);
// and moving cars and trucks with head and tail lights at night. Lots and towers keep off the road corridors
// (near(), and the terrain shader gets the corridors as uniforms).
import * as THREE from 'three';
import { atmos, ATM } from './sky.js';

const LANE = 3.6;
export const TYPES = { hwy: { lanes: 3, med: 1.6, inner: 1.0, outer: 2.6 }, acc: { lanes: 2, med: 1.2, inner: 0.6, outer: 1.6 }, ramp: { lanes: 1, med: 0, inner: 0, outer: 1.4, oneWay: true } };
const halfW = T => T.oneWay ? (T.lanes * LANE) / 2 + T.outer : T.med + T.inner + T.lanes * LANE + T.outer;
const fr = x => x - Math.floor(x);
function h12(x, y) { let a = fr(x * 0.1031), b = fr(y * 0.1031), c = fr(x * 0.1031); const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33); a += d; b += d; c += d; return fr((a + b) * c); }
function catmull(ctrl, step) { // centripetal-ish Catmull-Rom through control points, sampled every `step` metres
  const out = []; for (let i = 0; i < ctrl.length - 1; i++) { const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)]; const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t; const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]); } }
  out.push(ctrl[ctrl.length - 1].slice()); return out; }
// road surface: asphalt with lane markings drawn from the across / along coordinates (metres)
function roadMat(T, us) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 }); m.userData.key = 'road' + T.lanes + (T.oneWay ? 'o' : '') + (us ? 'u' : '');
  const med = T.med, inner = T.med + T.inner, outerE = inner + T.lanes * LANE;
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aRd; varying vec2 vRd;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRd = aRd;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vRd; float rh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }').replace('#include <color_fragment>', `#include <color_fragment>
      { float a = ${T.oneWay ? 'vRd.x + ' + ((T.lanes * LANE) / 2).toFixed(2) : 'abs(vRd.x)'}, s = vRd.y; vec3 c = vec3(0.12, 0.125, 0.13) * (0.9 + 0.12 * rh(floor(vec2(vRd.x * 2.0, s * 0.5))));
        c *= 1.0 + 0.08 * smoothstep(0.6, 0.2, abs(fract(a / ${LANE.toFixed(1)}) - 0.5)) * step(${inner.toFixed(2)}, a) * step(a, ${outerE.toFixed(2)}); // wheel tracks
        ${T.oneWay ? `float e1 = abs(a - 0.15), e2 = abs(a - ${(T.lanes * LANE - 0.15).toFixed(2)}); if (min(e1, e2) < 0.1) c = vec3(0.75);`
        : `if (a < ${med.toFixed(2)}) c = vec3(0.42, 0.41, 0.39); // median strip
        if (abs(a - ${(inner - 0.12).toFixed(2)}) < 0.08) c = ${us ? 'vec3(0.72, 0.6, 0.2)' : 'vec3(0.75)'};
        if (abs(a - ${(outerE + 0.12).toFixed(2)}) < 0.1) c = vec3(0.75);
        for (int k = 1; k < ${T.lanes}; k++) { if (abs(a - ${inner.toFixed(2)} - float(k) * ${LANE.toFixed(1)}) < 0.075 && fract(s / 12.0) < 0.3) c = vec3(0.72); }
        if (a > ${(outerE + 0.25).toFixed(2)}) c *= 1.08;`}
        diffuseColor.rgb = c; }`);
  };
  return atmos(m);
}
const plainM = (c, k, o = {}) => { const m = atmos(new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.85, metalness: o.m ?? 0 })); m.userData.key = 'rd' + k; return m; };

export class Roads {
  constructor(scene, quality) { this.scene = scene; this.q = quality; this.group = new THREE.Group(); this.group.name = 'roads'; scene.add(this.group); this.paths = []; this.lanes = []; this.cars = null; this.corr = []; this.ix = null; }
  clear() { this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); this.group.clear(); this.paths = []; this.lanes = []; this.cars = null; this.lights = null; this.corr = []; this.ix = null; }
  // distance from (x, z) to the nearest road corridor centre line minus its half width (<0 = on the road)
  near(x, z) { let m = 1e9; for (const c of this.corr) { const P = c.pts; for (let i = 0; i < P.length - 1; i += c.stride) { const j = Math.min(P.length - 1, i + c.stride), ax = P[i][0], az = P[i][1], bx = P[j][0], bz = P[j][1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); m = Math.min(m, Math.hypot(x - ax - dx * t, z - az - dz * t) - c.hw); } }
    if (this.ix) m = Math.min(m, Math.hypot(x - this.ix.x, z - this.ix.z) - this.ix.r); return m; }
  // ctx: { b (primary built airport: x, z, elev, b.frame), heightAt(x, z) -> {h, water}, hullDist(x, z), dens(x, z), us (US markings) }
  build(ctx) {
    this.clear(); const b = ctx.b; if (!b || !b.b?.frame || this.q === 'low') return;
    const fr0 = b.b.frame, nx = fr0.nx, nz = fr0.nz, L = [-nx, -nz]; // landside direction (away from the runways)
    const curb = [b.x + fr0.ax + L[0] * (fr0.facadeD + (fr0.termDepth || 40) + 13), b.z + fr0.az + L[1] * (fr0.facadeD + (fr0.termDepth || 40) + 13)];
    // the access road leaves the curb in the landside direction if it can, else turns until it reaches the fence without crossing a runway strip
    const rw = b.b.site ? b.b.site.rw : [], inRw = (x, z) => rw.some(o => { const dx = x - b.x - o.cx, dz = z - b.z - o.cz; return Math.abs(dx * o.ux + dz * o.uz) < o.hl && Math.abs(-dx * o.uz + dz * o.ux) < o.hw; });
    let best = null; for (let k = 0; k < 24; k++) { const ang = Math.atan2(L[1], L[0]) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 12, dir = [Math.cos(ang), Math.sin(ang)]; let s = 0, ok = true;
      for (; s < 9000; s += 20) { const x = curb[0] + dir[0] * s, z = curb[1] + dir[1] * s; if (inRw(x, z)) { ok = false; break; } if (ctx.hullDist(x, z) < -40) break; }
      if (ok && s < 9000) { const cost = s + Math.ceil(k / 2) * 250; if (!best || cost < best.cost) best = { dir, s, cost }; } }
    if (!best) return; const Ld = best.dir, D = best.s + 650, I = [curb[0] + Ld[0] * D, curb[1] + Ld[1] * D], H = [-Ld[1], Ld[0]]; // interchange beyond the fence, highway direction
    this.ix = { x: I[0], z: I[1], r: 330 };
    // highway control points: straight through the interchange, gentle bends further out, pushed out of the airport fence (it bends round the field)
    const ctrl = []; for (let k = -5; k <= 5; k++) { const s = k * 2600, off = Math.abs(k) <= 1 ? 0 : (h12(k * 3.1 + b.x * 0.001, 7.7) * 520) * (1 + Math.abs(k) * 0.15); const p = [I[0] + H[0] * s + Ld[0] * off, I[1] + H[1] * s + Ld[1] * off];
      for (let it = 0; it < 30 && ctx.hullDist(p[0], p[1]) > -180; it++) { p[0] += Ld[0] * 200; p[1] += Ld[1] * 200; } ctrl.push(p); }
    const hw = catmull(ctrl, 14); this.addRoad('hwy', hw, ctx, { cars: 1 });
    // access road: curb -> over the highway on a bridge -> a little beyond (to the city)
    const acc = []; for (let s = 0; s <= D + 900; s += 14) acc.push([curb[0] + Ld[0] * s, curb[1] + Ld[1] * s]);
    this.addRoad('acc', acc, ctx, { bridgeAt: D, bridgeH: 7.6, cars: 1 });
    // diamond ramps: from the highway shoulders, parallel, up to the access road 150 m either side of the bridge
    const hwH = halfW(TYPES.hwy), acH = halfW(TYPES.acc);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const P = (along, across) => [I[0] + H[0] * along + Ld[0] * across, I[1] + H[1] * along + Ld[1] * across];
      const pts = catmull([P(sx * 520, sy * (hwH + 5)), P(sx * 300, sy * (hwH + 9)), P(sx * 120, sy * (hwH + 22)), P(sx * (acH + 14), sy * 120), P(sx * (acH + 5), sy * 165)], 10);
      const fromHwy = sx * sy > 0; this.addRoad('ramp', fromHwy ? pts : pts.slice().reverse(), ctx, { rampTo: fromHwy ? 'end' : 'start', cars: 0.5 });
    }
    this.carsBuild();
  }
  // a road: profile (terrain, bridges, ramp heights), surface, skirts, barriers, rails, sound walls, lamps, pillars, lanes for traffic
  addRoad(type, pts, ctx, o = {}) {
    const T = TYPES[type], hw = halfW(T), n = pts.length; if (n < 2) return;
    const ys = new Float32Array(n), gnd = new Float32Array(n), water = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const g = ctx.heightAt(pts[i][0], pts[i][1]); gnd[i] = g.h; water[i] = g.water ? 1 : 0; }
    for (let i = 0; i < n; i++) { let s = 0, w = 0; for (let k = -6; k <= 6; k++) { const j = Math.max(0, Math.min(n - 1, i + k)); s += gnd[j]; w++; } ys[i] = Math.max(s / w, gnd[i]) + 0.45; if (water[i]) ys[i] = Math.max(ys[i], 6); }
    const len = [0]; for (let i = 1; i < n; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    if (o.bridgeAt != null) for (let i = 0; i < n; i++) { const d = Math.abs(len[i] - o.bridgeAt), k = d < 45 ? 1 : d < 260 ? 1 - (d - 45) / 215 : 0; ys[i] = Math.max(ys[i], ys[i] * (1 - k) + (ctx.heightAt(...this.ixPt()).h + 0.45 + o.bridgeH) * k); }
    if (o.rampTo) { const accY = ctx.heightAt(...this.ixPt()).h + 0.45; for (let i = 0; i < n; i++) { const t = o.rampTo === 'end' ? len[i] / len[n - 1] : 1 - len[i] / len[n - 1], e = t * t * (3 - 2 * t), atAcc = this.accHeightAt(pts[o.rampTo === 'end' ? n - 1 : 0], accY); ys[i] = ys[i] * (1 - e) + atAcc * e; } }
    this.paths.push({ type, pts, ys, len });
    this.corr.push({ pts, hw: hw + 6, stride: 4 });
    // ---- geometry
    const V = [], RD = [], I = [], SK = [], SKI = [];
    const side = (i, a) => { const p = pts[i], q = pts[Math.min(n - 1, i + 1)], r = pts[Math.max(0, i - 1)]; let tx = q[0] - r[0], tz = q[1] - r[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; return [p[0] - tz * a, p[1] + tx * a, tx, tz]; }; // left of travel = (-tz, tx)
    for (let i = 0; i < n; i++) { for (const a of [-hw, hw]) { const [x, z] = side(i, a); V.push(x, ys[i], z); RD.push(T.oneWay ? a / hw * (T.lanes * LANE / 2 + T.outer) : a, len[i]); }
      if (i) { const k = (i - 1) * 2; I.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3)); g.setAttribute('aRd', new THREE.Float32BufferAttribute(RD, 2)); g.setIndex(I); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, roadMat(T, !!ctx.us)); mesh.frustumCulled = false; mesh.receiveShadow = true; this.group.add(mesh);
    // skirts / bridge girders down the sides, barriers and rails as strips
    const strips = [], strip = (a0, a1, y0f, y1f, col) => strips.push({ a0, a1, y0f, y1f, col });
    strip(-hw - 0.3, -hw - 0.3, i => ys[i] - Math.max(1.4, ys[i] - gnd[i] + 1.5), i => ys[i] - 0.05, 0x6b6a62); strip(hw + 0.3, hw + 0.3, i => ys[i] - Math.max(1.4, ys[i] - gnd[i] + 1.5), i => ys[i] - 0.05, 0x6b6a62);
    strip(-hw + 0.2, -hw + 0.2, i => ys[i], i => ys[i] + 0.75, 0xb8bcc0); strip(hw - 0.2, hw - 0.2, i => ys[i], i => ys[i] + 0.75, 0xb8bcc0); // guard rails / parapets
    if (!T.oneWay) { strip(-0.25, -0.25, i => ys[i], i => ys[i] + 0.82, 0xc9c7c0); strip(0.25, 0.25, i => ys[i], i => ys[i] + 0.82, 0xc9c7c0); } // median barrier
    // sound walls where the road passes houses (not on bridges)
    if (type === 'hwy') for (const sgn of [-1, 1]) { const a = sgn * (hw + 2.5); strip(a, a, i => ys[i] - 0.4, i => { const [x, z] = side(i, a + sgn * 60); return ctx.dens(x, z) > 0.2 && ys[i] - gnd[i] < 2 ? ys[i] + 4.2 : ys[i] - 0.4; }, 0x9a958a); }
    const SV = [], SC = [], SI = []; const cc = new THREE.Color();
    for (const S of strips) { const base = SV.length / 3; cc.setHex(S.col); for (let i = 0; i < n; i++) { const [x, z] = side(i, S.a0); SV.push(x, S.y0f(i), z, x, S.y1f(i), z); for (let k = 0; k < 2; k++) SC.push(cc.r * (k ? 1 : 0.8), cc.g * (k ? 1 : 0.8), cc.b * (k ? 1 : 0.8)); if (i) { const k = base + (i - 1) * 2; SI.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } } }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(SV, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(SC, 3)); sg.setIndex(SI); sg.computeVertexNormals();
    const sm = atmos(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })); sm.userData.key = 'rdStrip'; const smesh = new THREE.Mesh(sg, sm); smesh.frustumCulled = false; this.group.add(smesh);
    // pillars under elevated sections, lamp posts on the median (or the edge of one-way roads)
    const pil = [], lamps = []; for (let i = 0; i < n; i += 2) { const el = ys[i] - gnd[i]; if (el > 2.6 && (len[i] % 28) < 14.5) for (const a of T.oneWay ? [0] : [-hw * 0.55, hw * 0.55]) { const [x, z] = side(i, a); pil.push([x, gnd[i] - 1, z, el + 0.6]); } }
    for (let i = 0; i < n; i++) if (Math.floor(len[i] / 55) !== Math.floor((len[i - 1] ?? -1) / 55)) { const [x, z, tx, tz] = side(i, T.oneWay ? hw - 0.6 : 0); lamps.push([x, ys[i], z, Math.atan2(tx, tz)]); }
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    if (pil.length) { const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 1, 1.6).translate(0, 0.5, 0), plainM(0xa8a59c, 'pil'), pil.length); pil.forEach((p, i) => im.setMatrixAt(i, M.compose(new THREE.Vector3(p[0], p[1], p[2]), Q.identity(), new THREE.Vector3(1, p[3], 1)))); im.frustumCulled = false; this.group.add(im); }
    if (lamps.length) { const lg = new THREE.BoxGeometry(0.18, 11, 0.18).translate(0, 5.5, 0), arm = new THREE.BoxGeometry(0.15, 0.15, T.oneWay ? 2.4 : 5).translate(0, 10.9, T.oneWay ? -1.1 : 0);
      const im = new THREE.InstancedMesh(mergeBoxes([lg, arm]), plainM(0x7d8287, 'lamp', { m: 0.5, r: 0.5 }), lamps.length); lamps.forEach((p, i) => im.setMatrixAt(i, M.compose(new THREE.Vector3(p[0], p[1], p[2]), Q.setFromAxisAngle(Y, p[3]), new THREE.Vector3(1, 1, 1)))); im.frustumCulled = false; this.group.add(im);
      // lamp heads: glowing sprites at night
      const hp = []; for (const p of lamps) { const off = T.oneWay ? [[0, -2.2]] : [[0, -2.4], [0, 2.4]]; for (const [ox, oz] of off) { const c = Math.cos(p[3]), s = Math.sin(p[3]); hp.push(p[0] + oz * s, p[1] + 10.8, p[2] + oz * c); } }
      this.group.add(glowPoints(hp, ctx.lampCol || [1, 0.72, 0.42], 9));
    }
    // traffic lanes (direction +1 along pts, -1 against): lateral offsets of lane centres
    const offs = T.oneWay ? [[0, 1]] : Array.from({ length: T.lanes }, (_, k) => k).flatMap(k => { const a = T.med + T.inner + (k + 0.5) * LANE; return [[a, -1], [-a, 1]]; }); // right-hand traffic: the +1 direction drives on the right (-left offset)
    for (const [a, dir] of offs) this.lanes.push({ path: this.paths[this.paths.length - 1], off: a, dir, type, density: o.cars ?? 1 });
  }
  ixPt() { return [this.ix.x, this.ix.z]; }
  accHeightAt(p, accY) { const d = Math.hypot(p[0] - this.ix.x, p[1] - this.ix.z), k = d < 45 ? 1 : d < 260 ? 1 - (d - 45) / 215 : 0; return accY + 7.6 * k; }
  // ---- traffic
  carsBuild() {
    const N = { ultra: 520, high: 360, medium: 200 }[this.q] || 0; if (!N || !this.lanes.length) return;
    const total = this.lanes.reduce((s, l) => s + l.path.len[l.path.len.length - 1] * l.density, 0), cars = [];
    for (const l of this.lanes) { const Ln = l.path.len[l.path.len.length - 1], k = Math.round(N * Ln * l.density / total); for (let i = 0; i < k; i++) cars.push({ l, s: (i + h12(i, Ln * 0.01)) / k * Ln, v: (l.type === 'hwy' ? 27 : l.type === 'acc' ? 16 : 12) * (0.85 + h12(i * 1.7, Ln) * 0.3), truck: l.type === 'hwy' && h12(i * 3.3, 1.1) < 0.14, seg: 0 }); }
    const carG = mergeBoxes([new THREE.BoxGeometry(1.8, 0.75, 4.5).translate(0, 0.45, 0), new THREE.BoxGeometry(1.6, 0.52, 2.3).translate(0, 1.08, -0.2)]), truckG = mergeBoxes([new THREE.BoxGeometry(2.5, 2.4, 2.4).translate(0, 1.7, 6.4), new THREE.BoxGeometry(2.5, 3.0, 12.5).translate(0, 2.1, -1.4)]);
    const cm = atmos(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.4 })); cm.userData.key = 'rdCar';
    const ncar = cars.filter(c => !c.truck).length, ntr = cars.length - ncar;
    this.carMesh = new THREE.InstancedMesh(carG, cm, Math.max(1, ncar)); this.truckMesh = new THREE.InstancedMesh(truckG, cm, Math.max(1, ntr)); const COLS = ['#d9d9d9', '#1c1e21', '#8a9095', '#7a1c1c', '#22355a', '#f0f0ec', '#4b5157', '#b8a27a', '#2e4d3c'], c = new THREE.Color();
    let ic = 0, it = 0; for (const car of cars) { c.set(COLS[(h12(car.s, 3.3) * COLS.length) | 0]); if (car.truck) { car.ix = it++; this.truckMesh.setColorAt(car.ix, c.set(h12(car.s, 9) < 0.5 ? '#e8e8e4' : '#b23a2a')); } else { car.ix = ic++; this.carMesh.setColorAt(car.ix, c); } }
    for (const m of [this.carMesh, this.truckMesh]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(m); }
    this.cars = cars;
    const lp = new Float32Array(cars.length * 4 * 3), lc = new Float32Array(cars.length * 4 * 3); for (let i = 0; i < cars.length; i++) for (let k = 0; k < 4; k++) lc.set(k < 2 ? [1, 0.93, 0.8] : [1, 0.08, 0.04], (i * 4 + k) * 3);
    this.lights = glowPoints(lp, null, 3.5, lc); this.group.add(this.lights);
    this.update(0, null);
  }
  update(dt, cam) {
    if (!this.cars) return; const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
    const lp = this.lights.geometry.attributes.position.array;
    this.cars.forEach((car, ci) => {
      const pa = car.l.path, Ln = pa.len[pa.len.length - 1]; car.s = (car.s + car.v * dt) % Ln; const s = car.l.dir > 0 ? car.s : Ln - car.s;
      let i = Math.min(car.seg, pa.len.length - 2); while (i < pa.len.length - 2 && pa.len[i + 1] < s) i++; while (i > 0 && pa.len[i] > s) i--; car.seg = i;
      const t = (s - pa.len[i]) / Math.max(1e-3, pa.len[i + 1] - pa.len[i]), a = pa.pts[i], b = pa.pts[i + 1]; let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const dx = car.l.dir * tx, dz = car.l.dir * tz, x = a[0] + (b[0] - a[0]) * t - tz * car.l.off, z = a[1] + (b[1] - a[1]) * t + tx * car.l.off, y = pa.ys[i] + (pa.ys[i + 1] - pa.ys[i]) * t;
      P.set(x, y, z); Q.setFromAxisAngle(Y, Math.atan2(dx, dz)); M.compose(P, Q, S); (car.truck ? this.truckMesh : this.carMesh).setMatrixAt(car.ix, M);
      const fx = dx * (car.truck ? 7.6 : 2.3), fz = dz * (car.truck ? 7.6 : 2.3), bx = -dx * (car.truck ? 7.7 : 2.3), bz = -dz * (car.truck ? 7.7 : 2.3), sx = -dz * 0.65, sz = dx * 0.65, o = ci * 12;
      lp[o] = x + fx + sx; lp[o + 1] = y + 0.6; lp[o + 2] = z + fz + sz; lp[o + 3] = x + fx - sx; lp[o + 4] = y + 0.6; lp[o + 5] = z + fz - sz;
      lp[o + 6] = x + bx + sx; lp[o + 7] = y + 0.8; lp[o + 8] = z + bz + sz; lp[o + 9] = x + bx - sx; lp[o + 10] = y + 0.8; lp[o + 11] = z + bz - sz;
    });
    this.carMesh.instanceMatrix.needsUpdate = true; this.truckMesh.instanceMatrix.needsUpdate = true; this.lights.geometry.attributes.position.needsUpdate = true;
  }
  stats() { let calls = 0, tris = 0; this.group.traverse(o => { if (o.isMesh && o.visible) { calls++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } if (o.isPoints) calls++; }); return { roads: this.paths.length, cars: this.cars ? this.cars.length : 0, calls, tris: Math.round(tris) }; }
  // corridors for the terrain shader: up to 24 segments (highway, access road) + the interchange disc
  shaderCorridors() { const segs = []; for (const c of this.corr) { if (c.hw < 12) continue; const P = c.pts, k = Math.max(1, Math.ceil((P.length - 1) / 12)); for (let i = 0; i < P.length - 1 && segs.length < 24; i += k) { const j = Math.min(P.length - 1, i + k); segs.push([P[i][0], P[i][1], P[j][0], P[j][1], c.hw]); } } return { segs, ix: this.ix }; }
}
function mergeBoxes(gs) { const list = gs.map(g => g.index ? g.toNonIndexed() : g); let n = 0; for (const g of list) n += g.attributes.position.count; const P = new Float32Array(n * 3), N = new Float32Array(n * 3); let o = 0; for (const g of list) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; } const r = new THREE.BufferGeometry(); r.setAttribute('position', new THREE.BufferAttribute(P, 3)); r.setAttribute('normal', new THREE.BufferAttribute(N, 3)); return r; }
// additive glow sprites, only at night (uNight), sized in metres with a pixel floor
function glowPoints(pos, col, size, cols) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos instanceof Float32Array ? pos : new Float32Array(pos), 3)); if (cols) g.setAttribute('aCol', new THREE.BufferAttribute(cols, 3));
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uNight: ATM.uNight, uCol: { value: new THREE.Color(...(col || [1, 1, 1])) }, uSize: { value: size } },
    vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\nuniform float uSize; uniform vec3 uCol; ${cols ? 'attribute vec3 aCol;' : ''} varying vec3 vC; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; vC = ${cols ? 'aCol' : 'uCol'}; gl_PointSize = clamp(uSize * 500.0 / -mv.z, 1.5, 22.0);\n#include <logdepthbuf_vertex>\n}`,
    fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\nuniform float uNight; varying vec3 vC; void main(){ vec2 q = gl_PointCoord - 0.5; float a = exp(-dot(q, q) * 14.0); if (uNight < 0.02) discard; gl_FragColor = vec4(vC * a * uNight * 2.2, 1.0);\n#include <logdepthbuf_fragment>\n}` });
  const p = new THREE.Points(g, m); p.frustumCulled = false; return p;
}
