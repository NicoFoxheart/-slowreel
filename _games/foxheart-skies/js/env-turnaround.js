// Turnaround choreography (environment artist), driven by groundcrew.js on sim time. Everything lives in a stand
// frame = the parked aircraft's body frame on the ground (x right wing, z aft): services on the RIGHT, passengers by
// the bridge on the left. Vehicles drive in on the head-of-stand road (z = -43) or the rear service road (z = +42)
// via the equipment lane outside the wingtip (x = 21), dock, work (box up, belts running, hoses on, ULDs rolling),
// then back out with a turn and leave. Departure: most services are already working when you arrive at the gate and
// finish in ~3.5 min; fuel and the aft catering truck drive in. Arrival: they drive in after the chocks.
// Pushback (prep): whatever is still docked undocks and leaves at speed; anything not clear in 6.6 s is hidden.
import * as THREE from 'three';
import { makeVehicle, POSE, bagsMesh, uldMeshes, hoseMesh, gseMats, T } from './env-gse.js';

const RZ = 42, FZ = -43, LX = 21, PI = Math.PI;
const clamp = THREE.MathUtils.clamp, sm = THREE.MathUtils.smoothstep;
class Leg {
  constructor(pts, rev = false, v = 5.2) { this.c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal'); this.L = this.c.getLength(); this.T = 2.5 + this.L / v; this.rev = rev; }
  pose(u, o) { u = clamp(u, 0, 1); return this.at(this.L * u * u * (3 - 2 * u), o); }
  at(s, o) { // arc distance; extrapolates straight off both ends (trailers)
    const L = this.L, e = clamp(s / L, 0, 1), p = this.c.getPointAt(e), t = this.c.getTangentAt(e), x = s < 0 ? s : s > L ? s - L : 0;
    o.x = p.x + t.x * x; o.z = p.z + t.z * x; if (this.rev) t.negate(); o.yaw = Math.atan2(-t.x, -t.z); return o;
  }
  near(x, z) { let best = 0, bd = 1e9; for (let i = 0; i <= 400; i++) { const p = this.c.getPointAt(i / 400), d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = i / 400; } } return best * this.L; }
}
const DEP = { cat1: [null, 92], belt1: [null, 200], belt2: [null, 184], cont: [null, 172], train: [null, 160], lav: [null, 58], water: [null, 74], van: [null, 46], fuel: [3, 146], cat2: [10, 114] };
const ARR = { belt1: 3, train: 6, belt2: 9, cont: 12, van: 14, cat1: 18, cat2: 26, lav: 30, water: 36, fuel: 44 };
const DEPLOY = { cat: 9, belt: 4, cont: 5, fuel: 6, lav: 2, water: 2, van: 0, train: 0 };
const CART_OFF = [3.95, 8.15, 12.55, 16.95]; // arc distance behind the tug centre: cart, cart, ULD dolly, ULD dolly

export class Turnaround {
  constructor(parent, crew, quality) {
    gseMats(quality); this.q = quality; this.crew = crew;
    this.svc = new THREE.Group(); this.svc.name = 'turnaround'; this.svc.visible = false; parent.add(this.svc);
    const V = {}; for (const id of ['cat1', 'cat2', 'belt1', 'belt2', 'cont', 'fuel', 'lav', 'water', 'van']) V[id] = makeVehicle(id.replace(/\d$/, ''));
    V.train = makeVehicle('btug'); V.train.cars = [makeVehicle('cart'), makeVehicle('cart'), makeVehicle('dolly'), makeVehicle('dolly')];
    for (const id in V) { V[id].id = id; this.svc.add(V[id].obj); if (V[id].cars) V[id].cars.forEach(c => this.svc.add(c.obj)); }
    this.V = V; this.bags = bagsMesh(64); this.svc.add(this.bags); [this.uldA, this.uldB] = uldMeshes(3); this.svc.add(this.uldA, this.uldB);
    this.hoses = new THREE.Group(); this.svc.add(this.hoses); this._o = { x: 0, z: 0, yaw: 0 }; this.mode = null;
    this._m = new THREE.Matrix4(); this._m2 = new THREE.Matrix4(); this._v = new THREE.Vector3();
  }
  // ac: aircraft (world), groundH: apron height, mode 'dep' | 'arr'
  start(ac, groundH, yaw, mode, auto = true) {
    this.mode = mode; this.t = 0; this.prepT = null; this.svc.visible = true;
    this.svc.position.set(ac.position.x, groundH, ac.position.z); this.svc.rotation.set(0, yaw, 0); this.svc.updateMatrixWorld(true);
    const h = this.hAC = ac.position.y - groundH; this.hDoor = h - 0.55; this.hCargo = h - 1.55;
    const V = this.V;
    // docks (centre x, z, yaw) from the contact points on the hull
    const tip = POSE.beltTip(V.belt1, this.hCargo), bx = 1.55 - tip.z; this.beltPhi = tip.phi;
    const D = { cat1: [6.75, -13.0, PI / 2], cat2: [6.75, 11.6, PI / 2], belt1: [bx, -8.4, PI / 2], belt2: [bx, 9.2, PI / 2], cont: [5.75, 5.9, PI / 2], fuel: [16, -1.5, 0], lav: [3.2, 19.4, 0], water: [7.2, 17.8, 0], van: [14, -37, PI / 2], train: [12.8, -8.6, 0] };
    const P = {
      cat1: [[[100, FZ], [40, FZ], [LX, FZ + 7], [LX, -19], [14.5, -13], [10.5, -13], [6.75, -13]], [[6.75, -13], [10, -13], [13, -11.6], [15, -9]], [[15, -9], [14.4, -9.8], [15.5, -17], [18, -26], [LX, -34], [28, FZ], [100, FZ]]],
      cat2: [[[100, RZ], [40, RZ], [LX, RZ - 7], [LX, 19], [14.5, 11.6], [10.5, 11.6], [6.75, 11.6]], [[6.75, 11.6], [11, 11.6], [16, 11.6]], [[16, 11.6], [14.5, 12.4], [13.6, 15], [14.5, 21], [17.5, 28], [LX + 1, 35], [30, RZ], [100, RZ]]],
      belt1: [[[100, FZ], [40, FZ], [LX, FZ + 7], [LX, -16], [14, -8.4], [bx + 3.5, -8.4], [bx, -8.4]], [[bx, -8.4], [bx + 3, -8.4], [bx + 6.5, -7], [bx + 9, -4.2]], [[bx + 9, -4.2], [bx + 8.4, -4.9], [bx + 9, -12], [18, -22], [LX, -31], [28, FZ], [100, FZ]]],
      belt2: [[[100, RZ], [40, RZ], [LX, RZ - 7], [LX, 17], [14, 9.2], [bx + 3.5, 9.2], [bx, 9.2]], [[bx, 9.2], [bx + 3, 9.2], [bx + 6.5, 7.8], [bx + 9, 5]], [[bx + 9, 5], [bx + 8.4, 5.7], [bx + 9, 13], [18, 22], [LX, 31], [28, RZ], [100, RZ]]],
      cont: [[[100, RZ], [40, RZ], [LX, RZ - 7], [LX, 15], [15, 5.9], [9.75, 5.9], [5.75, 5.9]], [[5.75, 5.9], [8.95, 5.9], [12.95, 4.5], [15.45, 1.5]], [[15.45, 1.5], [14.85, 2.3], [15.5, 10], [18, 20], [LX, 30], [28, RZ], [100, RZ]]],
      fuel: [[[100, RZ], [40, RZ], [LX + 1, RZ - 6], [LX, 22], [18.5, 10], [16.2, 4], [16, 1.5], [16, -1.5]], null, [[16, -1.5], [16, -6], [16.6, -12], [18.5, -22], [LX, -32], [28, FZ], [100, FZ]]],
      lav: [[[100, RZ], [20, RZ], [8, RZ - 1], [4, RZ - 5], [3.2, 30], [3.2, 24], [3.2, 19.4]], [[3.2, 19.4], [3.2, 27], [2.5, 35], [-1, 40], [-5, 41.5]], [[-5, 41.5], [0, 42], [30, RZ], [100, RZ]]],
      water: [[[100, RZ], [24, RZ], [12, RZ - 1], [8, RZ - 5], [7.2, 30], [7.2, 23], [7.2, 17.8]], [[7.2, 17.8], [7.2, 26], [6.5, 34], [3, 39.5], [-1, 41.5]], [[-1, 41.5], [4, 42], [30, RZ], [100, RZ]]],
      van: [[[100, FZ], [40, FZ], [24, FZ + 1.5], [18, -38], [14, -37]], null, [[14, -37], [8, -37.5], [0, -39], [-12, FZ], [-100, FZ]]],
      train: [[[100, RZ], [40, RZ], [LX + 1, RZ - 6], [LX, 26], [16, 15], [13.2, 6], [12.8, 0], [12.8, -8.6]], null, [[LX, 26], [16, 15], [13.2, 6], [12.8, 0], [12.8, -8.6], [12.8, -14], [14.5, -22], [LX, -31], [28, FZ], [100, FZ]]],
    };
    for (const id in V) {
      const v = V[id], [x, z, yw] = D[id], [pin, prev, pfwd] = P[id], tl = !auto ? [Infinity, null] : mode === 'dep' ? DEP[id] : [ARR[id], null];
      Object.assign(v, { dock: { x, z, yaw: yw }, legIn: new Leg(pin, false, id === 'train' ? 4 : 5.2), legRev: prev && new Leg(prev, true, 2.2), legFwd: new Leg(pfwd, false, id === 'train' ? 4 : 5.5), at: tl[0], out: tl[1], dep: DEPLOY[v.type === 'btug' ? 'train' : v.type] ?? 0, fast: 1, gone: false, docked: v.at === null, recall: false });
      v.legIn.T = Math.max(v.legIn.T, 8); if (id === 'train') v.s0 = v.legFwd.near(12.8, -8.6);
    }
    // hoses and cables (stand frame, static once docked)
    this.hoses.clear(); const hw = h - 0.05;
    const mk = (pts, r, col) => { const m = hoseMesh(pts, r, col); m.visible = false; this.hoses.add(m); return m; };
    this.hFuel = mk([[16.5, 2.75, -0.25], [15.7, 3.1, 1.0], [14.6, hw - 0.05, 2.1], [13.5, hw, 2.62]], 0.05);
    const pit = mk([[17.1, 0.7, -1.2], [17.7, 0.25, -0.8], [18.6, 0.06, -0.4]], 0.06); pit.add(new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 16), gseMats().metal).translateX(18.6).translateY(0.02).translateZ(-0.4)); this.hPit = pit;
    this.hLav = mk([[2.5, 0.9, 16.45], [2.0, 1.6, 16.0], [1.2, h - 0.95, 15.2], [0.6, h - 0.5, 14.8]], 0.06, 0x3a3f45);
    this.hWater = mk([[6.5, 0.9, 14.85], [5.2, 1.4, 14.2], [2.5, h - 1.3, 13.0], [0.95, h - 0.95, 12.6]], 0.045, 0x2a4f8a);
    this.update(0);
  }
  prep() { // pushback requested: clear the stand
    if (this.prepT != null || !this.mode) return; this.prepT = this.t;
    for (const id in this.V) { const v = this.V[id], tin = v.at == null ? -1e9 : v.at; if (this.t < tin + v.legIn.T) { v.gone = true; continue; } if (v.out == null || v.out > this.t) { v.out = this.t; v.fast = 3.2; } }
  }
  // ---- manual services: state of one vehicle, call (drive in + dock + work), dismiss (undock + leave now)
  vstate(v) { const t = this.t; if (!this.mode) return 'away'; if (v.gone) return v.recall ? 'coming' : v.docked ? 'done' : 'away'; if (v.at === Infinity) return 'away'; const tin = v.at == null ? -1e9 : v.at;
    if (t < tin || (v.at != null && t < tin + v.legIn.T)) return 'coming'; if (v.out == null || t < v.out) return 'working'; return 'leaving'; }
  call(v, delay = 0) { const st = this.vstate(v); if (st === 'leaving') { v.recall = true; return; } if (st === 'coming' || st === 'working') return;
    Object.assign(v, { at: this.t + delay, out: null, gone: false, fast: 1, docked: false }); }
  dismiss(v) { const st = this.vstate(v); v.recall = false; if (st === 'working') v.out = Math.max(this.t, v.out == null ? this.t : Math.min(v.out, this.t));
    else if (st === 'coming') { if (v.at > this.t) { v.at = Infinity; v.gone = false; } else v.out = v.at + v.legIn.T - v.dep; } }
  clear() { this.svc.visible = false; this.mode = null; for (let i = 3; i < this.crew.n; i++) this.crew.p[i].vis = false; }
  // phase of a vehicle at time t: { vis, x, z, yaw, k (deploy 0..1), work (s since docked, -1 if not working), s (train arc) }
  phase(v, t, o) {
    o.vis = false; o.k = 0; o.work = -1; o.s = null; if (v.gone) return o;
    const tin = v.at == null ? -1e9 : v.at; if (t < tin) return o;
    o.vis = true;
    if (v.at != null && t < tin + v.legIn.T) { const u = (t - tin) / v.legIn.T; if (v.id === 'train') { o.s = v.legIn.L * u * u * (3 - 2 * u); o.legT = v.legIn; } else v.legIn.pose(u, o); return o; }
    const tDock = v.at == null ? -20 - v.dep : tin + v.legIn.T; const park = () => { o.x = v.dock.x; o.z = v.dock.z; o.yaw = v.dock.yaw; if (v.id === 'train') { o.s = v.legIn.L; o.legT = v.legIn; } };
    v.docked = true;
    if (v.out == null || t < v.out) { park(); o.k = v.dep ? clamp((t - tDock) / v.dep, 0, 1) : 1; o.work = o.k >= 1 ? t - tDock - v.dep : -1; return o; }
    let u = (t - v.out) * v.fast;
    if (u < v.dep) { park(); o.k = 1 - u / v.dep; return o; } u -= v.dep;
    if (v.legRev) { if (u < v.legRev.T) { v.legRev.pose(u / v.legRev.T, o); return o; } u -= v.legRev.T; }
    if (u < v.legFwd.T) { const e = u / v.legFwd.T; if (v.id === 'train') { o.s = v.s0 + (v.legFwd.L - v.s0) * e * e * (3 - 2 * e) * 1.15; o.legT = v.legFwd; } else v.legFwd.pose(e, o); return o; }
    o.vis = false; v.gone = true; return o;
  }
  update(dt) {
    if (!this.mode) return; this.t += dt; const t = this.t, o = this._o, C = this.crew, dep = this.mode === 'dep';
    if (this.prepT != null && t - this.prepT > 6.6) for (const id in this.V) this.V[id].gone = true;
    const ph = {};
    for (const id in this.V) {
      const v = this.V[id]; if (v.gone && v.recall) { v.recall = false; this.call(v, 1.5); } this.phase(v, t, o); ph[id] = { vis: o.vis, k: o.k, work: o.work };
      v.obj.visible = o.vis; if (v.cars) v.cars.forEach(c => c.obj.visible = o.vis);
      if (!o.vis) continue;
      if (o.s != null) { o.legT.at(o.s, o); v.obj.position.set(o.x, 0, o.z); v.obj.rotation.y = o.yaw; v.cars.forEach((c, i) => { o.legT.at(o.s - CART_OFF[i], o); c.obj.position.set(o.x, 0, o.z); c.obj.rotation.y = o.yaw; }); }
      else { v.obj.position.set(o.x, 0, o.z); v.obj.rotation.y = o.yaw; }
      if (v.type === 'cat') POSE.cat(v, ph[id].k, this.hDoor, ph[id].work >= 0 ? ph[id].work : null);
      if (v.type === 'cont') POSE.cont(v, ph[id].k, this.hCargo);
      if (v.type === 'fuel') POSE.fuel(v, ph[id].k, 1.7);
      if (v.type === 'belt') v.boom.rotation.x = 0.02 + (this.beltPhi - 0.02) * sm(ph[id].k, 0, 1);
    }
    this.svc.updateMatrixWorld(true); gseMats().belt.map.offset.y -= dt * 1.9 * (dep ? 1 : -1);
    // hoses
    const conn = (id, pre = 2) => ph[id].work >= 0 && (this.V[id].out == null || t < this.V[id].out - pre);
    this.hFuel.visible = conn('fuel', 4); this.hPit.visible = ph.fuel.vis && ph.fuel.k > 0.3;
    this.hLav.visible = conn('lav'); this.hWater.visible = conn('water');
    // bags: belts (up on departure, down on arrival) and carts; ULDs on dollies + the loader
    let bi = 0; const B = this.bags, M = this._m, M2 = this._m2;
    const beltOn = id => ph[id].work >= 0 && (this.V[id].out == null || t < this.V[id].out - 3);
    for (const id of ['belt1', 'belt2']) {
      const v = this.V[id]; if (!beltOn(id)) continue; const phi = v.boom.rotation.x, w = ph[id].work;
      for (let n = 0; n < 6; n++) { const d0 = ((w * 0.95 + n * 2.3) % 13.8); if (d0 > v.Lb - 0.5) continue; const d = dep ? d0 + 0.3 : v.Lb - 0.2 - d0;
        M2.copy(T(0, v.py + 0.13 * Math.cos(phi) + d * Math.sin(phi), v.pz - d * Math.cos(phi), (n % 3) * 0.4 - 0.4, phi)); B.setMatrixAt(bi++, M.multiplyMatrices(v.obj.matrix, M2)); }
    }
    const tr = this.V.train; const tDockTrain = tr.at == null ? -20 : tr.at + tr.legIn.T;
    const fill = i => dep ? 1 - clamp((t - tDockTrain - 20 - i * 40) / 140, 0, 1) : clamp((t - tDockTrain - 15 - i * 30) / 140, 0, 1);
    if (ph.train.vis) for (let ci = 0; ci < 2; ci++) { const c = tr.cars[ci], nb = Math.round(fill(ci) * 20);
      for (let j = 0; j < nb && bi < 64; j++) { const L = Math.floor(j / 8), r = j % 8; M2.copy(T((r % 2) * 0.66 - 0.33, 0.62 + L * 0.27, Math.floor(r / 2) * 0.68 - 1.02, ((j * 7) % 3) * 0.5)); B.setMatrixAt(bi++, M.multiplyMatrices(c.obj.matrix, M2)); } }
    for (let i = bi; i < 64; i++) B.setMatrixAt(i, ZERO); B.instanceMatrix.needsUpdate = true; B.count = 64;
    let ui = 0; const UA = this.uldA, UB = this.uldB, cv = this.V.cont, cw = ph.cont.work, cyc = cw >= 0 && (cv.out == null || t < cv.out - 2) ? Math.floor(cw / 40) : -1;
    const uldDone = cw >= 0 ? clamp(Math.floor(cw / 40), 0, 2) : dep && (cv.gone || (cv.out != null && t >= cv.out)) ? 2 : 0; // ULDs moved so far
    if (ph.train.vis) for (let di = 0; di < 2; di++) { const has = dep ? di >= uldDone : di < uldDone; if (!has) continue; M2.copy(T(0, 0.6, 0, 0)); M.multiplyMatrices(tr.cars[2 + di].obj.matrix, M2); UA.setMatrixAt(ui, M); UB.setMatrixAt(ui++, M); }
    if (cyc >= 0 && cyc < 2) { const p = (cw % 40) / 40, e = sm(p, 0.1, 0.85), z = dep ? 3.0 - 7.6 * e : -4.6 + 7.6 * e; if (p < 0.88) { M2.copy(T(0, cv.main.position.y + 0.08, z)); M.multiplyMatrices(cv.obj.matrix, M2); UA.setMatrixAt(ui, M); UB.setMatrixAt(ui++, M); } }
    for (let i = ui; i < 3; i++) { UA.setMatrixAt(i, ZERO); UB.setMatrixAt(i, ZERO); } UA.instanceMatrix.needsUpdate = UB.instanceMatrix.needsUpdate = true;
    // service crew (slots 3..)
    const man = (i, v, x, y, z, yaw, mode, vis = true) => { const p = C.p[i]; p.vis = vis && !!v.obj.visible; if (!p.vis) return; p.pos.set(x, y, z); v.obj.localToWorld(p.pos); p.yaw = this.svc.rotation.y + v.obj.rotation.y + yaw; p.mode = mode; };
    const work = id => ph[id].work >= 0;
    man(3, this.V.belt1, 1.05, 0, 2.7, -PI / 2, beltOn('belt1') ? 'load' : 'idle', work('belt1'));
    man(4, this.V.belt2, 1.05, 0, 2.7, -PI / 2, beltOn('belt2') ? 'load' : 'idle', work('belt2'));
    man(5, cv, 0.8, cv.bridge.position.y + 0.02, -2.4, PI, 'idle', ph.cont.k > 0.9);
    const fv = this.V.fuel; man(6, fv, -0.5, fv.plat.position.y, 3.95, -PI / 2, 'idle', ph.fuel.k > 0.6);
    for (const [i, id] of [[7, 'cat1'], [8, 'cat2']]) { const v = this.V[id]; man(i, v, -0.5, v.boxG.position.y, v.plat.position.z + 0.4, PI, 'idle', ph[id].k > 0.98); }
    man(9, this.V.lav, -1.35, 0, -3.3, -2.4, 'idle', work('lav')); man(10, this.V.water, -1.35, 0, -3.3, -2.3, 'idle', work('water'));
    man(11, tr, 0, 1.12, 0.45, PI, 'sit', ph.train.vis);
    // cleaners: walk between the van and the bridge stairs (they work inside the cabin)
    const van = this.V.van, vd = (van.at == null ? -1e9 : van.at) + van.legIn.T;
    for (const j of [0, 1]) { const p = C.p[12 + j]; let f = -1; if (dep) f = t > 28 + j * 1.5 && t < 44 ? 1 - (t - 28 - j * 1.5) / 14 : -1; else f = ph.van.vis && t > vd + 2 + j * 1.5 && t < vd + 16 + j * 1.5 ? (t - vd - 2 - j * 1.5) / 14 : -1;
      p.vis = f >= 0 && this.svc.visible; if (!p.vis) continue; const a = [12.5, -35.6 + j * 0.8], b = [-3 + j * 0.8, -24.5]; const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f; p.pos.set(x, 0, z); this.svc.localToWorld(p.pos);
      p.yaw = this.svc.rotation.y + Math.atan2((b[0] - a[0]) * (dep ? -1 : 1), (b[1] - a[1]) * (dep ? -1 : 1)); p.mode = 'walk'; }
    { const p = C.p[14]; p.vis = this.svc.visible && this.prepT == null; p.pos.set(3.2, 0, -21.5); this.svc.localToWorld(p.pos); p.yaw = this.svc.rotation.y + 0.3; p.mode = 'idle'; }
  }
  stats() { let tris = 0, calls = 0; this.svc.traverseVisible(o => { if (o.isMesh) { calls++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } }); return { calls, tris: Math.round(tris) }; }
}
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
