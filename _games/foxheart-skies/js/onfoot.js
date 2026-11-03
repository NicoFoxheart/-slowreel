// On-foot mode: walking through the terminal, jet bridge, cabin and flight deck, in third person (your captain,
// an HD person from people.js, seen over the shoulder) or first person (V / pad View or RS click).
// Third-person camera: orbit (mouse / right stick), zoom (wheel), spring arm with collision against the walk
// zones (walls of the hall, jet bridge tunnel, cabin aisle), a per-zone height cap, and a voxel grid of the hall
// geometry (shops, columns, counters, security lanes). Tight spaces pull it in; the flight deck is always first person.
import * as THREE from 'three';
import { buildTerminal, buildBridge, buildCabin, boardRows, CABIN, WalkMap } from './interiors.js';
import { rng } from './terrain.js';
import { SHORT } from './atc.js';
import { People } from './people.js';

const EYE = 1.62, TAU = Math.PI * 2;
// per walk-zone tag: [max boom (m), camera height cap above that floor (m), shoulder offset (m)]
const ZCAM = { hall: [6, 3.35, 0.42], gatedoor: [2.0, 2.25, 0.24], bridge: [2.3, 2.1, 0.26], entry: [1.6, 1.84, 0.18], door: [1.3, 1.84, 0.12], aisle: [1.3, 1.82, 0.06] };
const FP_TAGS = new Set(['cockpit', 'ckdoor']);
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
// occupancy grid (0.25 m cells) of the hall geometry in its own frame, in the camera band (0.15 to 3.9 m above the floor)
function hallGrid(term) {
  const g = term.group, F = term.F, cs = 0.25, x0 = -46, x1 = 46, z0 = -1.5, z1 = term.D + 1.5, y0 = F + 0.15, y1 = F + 3.9;
  const nx = Math.ceil((x1 - x0) / cs), ny = Math.ceil((y1 - y0) / cs), nz = Math.ceil((z1 - z0) / cs), occ = new Uint8Array(nx * ny * nz);
  const cell = (v, o, n) => Math.min(n - 1, Math.max(0, Math.floor((v - o) / cs)));
  g.updateMatrixWorld(true); const inv = g.matrixWorld.clone().invert(), M = new THREE.Matrix4(), v = new THREE.Vector3();
  const mark = (x, y, z) => { const ix = Math.floor((x - x0) / cs), iy = Math.floor((y - y0) / cs), iz = Math.floor((z - z0) / cs); if (ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz) occ[(iy * nz + iz) * nx + ix] = 1; };
  g.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || !o.geometry || o.geometry.isInstancedBufferGeometry || !o.geometry.attributes.position) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material; if (m && (m.blending === THREE.AdditiveBlending || (m.transparent && m.depthWrite === false))) return; // light shafts, glass fx
    M.multiplyMatrices(inv, o.matrixWorld); const pa = o.geometry.attributes.position, idx = o.geometry.index, P = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(M); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; }
    const n = idx ? idx.count : pa.count;
    for (let t = 0; t + 2 < n; t += 3) {
      const a = (idx ? idx.getX(t) : t) * 3, b = (idx ? idx.getX(t + 1) : t + 1) * 3, c = (idx ? idx.getX(t + 2) : t + 2) * 3;
      const mny = Math.min(P[a + 1], P[b + 1], P[c + 1]), mxy = Math.max(P[a + 1], P[b + 1], P[c + 1]); if (mxy < y0 || mny > y1) continue;
      const mnx = Math.min(P[a], P[b], P[c]), mxx = Math.max(P[a], P[b], P[c]), mnz = Math.min(P[a + 2], P[b + 2], P[c + 2]), mxz = Math.max(P[a + 2], P[b + 2], P[c + 2]);
      const ex = mxx - mnx, ey = mxy - mny, ez = mxz - mnz; if (Math.max(ex, ez) < 0.08) continue; // cords and thin rods
      if (ex < 0.02 || ey < 0.02 || ez < 0.02) { // axis-aligned face: fill its box
        const X0 = cell(mnx, x0, nx), X1 = cell(mxx, x0, nx), Y0 = cell(Math.max(mny, y0), y0, ny), Y1 = cell(Math.min(mxy, y1), y0, ny), Z0 = cell(mnz, z0, nz), Z1 = cell(mxz, z0, nz);
        if (mxx < x0 || mnx > x1 || mxz < z0 || mnz > z1) continue;
        for (let iy = Y0; iy <= Y1; iy++) for (let iz = Z0; iz <= Z1; iz++) { const r = (iy * nz + iz) * nx; for (let ix = X0; ix <= X1; ix++) occ[r + ix] = 1; }
      } else { // slanted: sample the surface at half-cell spacing
        const s = Math.max(1, Math.ceil(Math.max(ex, ey, ez) / (cs * 0.5))); if (s > 400) continue;
        for (let i = 0; i <= s; i++) for (let j = 0; j <= s - i; j++) { const u = i / s, w = j / s; mark(P[a] + (P[b] - P[a]) * u + (P[c] - P[a]) * w, P[a + 1] + (P[b + 1] - P[a + 1]) * u + (P[c + 1] - P[a + 1]) * w, P[a + 2] + (P[b + 2] - P[a + 2]) * u + (P[c + 2] - P[a + 2]) * w); }
      }
    }
  });
  return { occ, nx, ny, nz, cs, x0, y0, z0, inv };
}
const _v = new THREE.Vector3(), _h = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Vector3();
export class OnFoot {
  constructor(scene, camera, aircraft, audio) {
    this.scene = scene; this.camera = camera; this.aircraft = aircraft; this.audio = audio;
    this.active = false; this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0; this.vy = 0; this.prompt = ''; this.parts = null; this.auto = null; this.time = 0;
    // third person: camMode 'third' | 'first' (saved by main.js), camDist = wheel zoom; bodyYaw = where the avatar faces (same convention as yaw)
    this.camMode = 'third'; this.camDist = 3.2; this.bodyYaw = 0; this.vel = new THREE.Vector3(); this.camE = 1; this.fpK = 0; this.lookIdle = 9; this.grid = null;
    this.avRoot = new THREE.Group(); this.avRoot.name = 'avatar'; this.avRoot.visible = false; scene.add(this.avRoot); this.av = null; this.anim = { t: 0, a: 1.1, stop: 0, v: 0 };
  }
  avatar() { // the player: a captain in uniform (HD person, built once)
    if (this.av) return this.av;
    let s = 917531; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    try { this.av = new People(this.avRoot, 1, r, {}); const p = this.av.p[0]; Object.assign(p, { age: 'adult', female: false, scale: 1.0, hairStyle: 'short', stoop: 0 }); this.av.setCrew(0, 'captain'); p.backpack = false; p.suitcase = false; p.mode = 'stand'; p.act = 'idle'; p.speed = 1.1; }
    catch (e) { console.warn('avatar failed', e); this.av = null; }
    return this.av;
  }
  get thirdPerson() { return this.camMode !== 'first'; }
  setCamMode(m) { this.camMode = m === 'first' ? 'first' : 'third'; this.lookIdle = 9; return this.camMode; }
  zoom(s) { this.camDist = THREE.MathUtils.clamp(this.camDist * (1 + s * 0.12), 1.2, 6); if (this.camMode === 'first' && s > 0) this.camMode = 'third'; return this.camDist; }
  // o: { mode:'dep'|'arr', apt, b (built airport entry), stand, dest, featured }
  build(o) {
    this.dispose(); const R = rng(Date.now() & 0xffff); this.o = o;
    const fr = o.b.b.frame, base = new THREE.Vector3(o.b.x, o.b.elev, o.b.z);
    const n = new THREE.Vector3(fr.nx, 0, fr.nz), ad = new THREE.Vector3(fr.adx, 0, fr.adz);
    const Ofac = base.clone().add(new THREE.Vector3(fr.ax, 0, fr.az)).add(ad.clone().multiplyScalar(o.stand.s)).addScaledVector(n, -fr.facadeD);
    // bridge geometry: façade F → rotunda Rr → aircraft door D
    this.aircraft.updateMatrixWorld(true);
    const D = this.aircraft.localToWorld(new THREE.Vector3(CABIN.door.x - 0.25, CABIN.floor, CABIN.door.z));
    const left = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.aircraft.quaternion).setY(0).normalize();
    const Rr = D.clone().addScaledVector(left, 7.5); Rr.y = D.y + 0.7;
    const Fp = Rr.clone().addScaledVector(n, -(Rr.clone().sub(Ofac).dot(n))); Fp.y = base.y + 4.6;
    // terminal hall around the façade point of this gate
    const destName = o.dest ? (SHORT[o.dest.icao] || o.dest.city) : '';
    const zAxis = n.clone().negate(); const xAxis = new THREE.Vector3(0, 1, 0).cross(zAxis);
    const doorX = Fp.clone().sub(Ofac).dot(xAxis);
    const term = buildTerminal({ icao: o.apt.icao, mode: o.mode, gate: o.stand.gateName, dest: destName.toUpperCase(), O: new THREE.Vector3(Ofac.x, base.y, Ofac.z), n, depth: fr.termDepth, doorX, board: boardRows(o.apt, o.featured, o.mode, o.dest?.icao) }, R);
    this.scene.add(term.group);
    const bridge = buildBridge([Fp.clone().addScaledVector(n, -0.8), Rr, D], term.mat); this.scene.add(bridge.group);
    const cabin = buildCabin(o.apt.icao, R); this.aircraft.add(cabin.group);
    for (const p of cabin.crowd.p) if (p.talkSide == null) p.talkSide = p.i % 2 ? 1 : -1; // the seated 'talk' pose needs a side (undefined gave NaN bones)
    if (o.mode === 'arr') { cabin.boarders.forEach(p => { p.state = 'seated'; p.seated = true; p.hidden = false; p.y = CABIN.floor + 0.42; p.x = p.target.x; p.z = p.target.z + 0.08; p.yaw = Math.PI; }); }
    // walk map: hall + bridge + cabin zones (cabin zones in world space)
    const wm = new WalkMap(); wm.zones.push(...term.walk.zones, ...bridge.walk.zones); wm.blocks.push(...term.walk.blocks);
    wm.rect(Fp.clone().addScaledVector(n, -1.2), n, 1.6, 1.1, base.y + 4.6, base.y + 4.6, 'gatedoor');
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.aircraft.quaternion).setY(0).normalize();
    for (const z of cabin.zones) { const c = this.aircraft.localToWorld(new THREE.Vector3(z.x, 0, z.z)); const yw = y => this.aircraft.localToWorld(new THREE.Vector3(0, y, 0)).y; wm.rect(c, fwd, z.hz, z.hx, yw(z.y0), yw(z.y1), z.tag); }
    this.walk = wm; this.parts = { term, bridge, cabin, Fp, Rr, D, n };
    this.grid = null; try { this.grid = hallGrid(term); } catch (e) { console.warn('hall camera grid failed', e); }
    this.avatar();
    if (o.stand.jb) o.stand.jb.visible = false;
    // route used by auto-walk (tests, and the J shortcut)
    const W = term.world; const toWorldBody = (x, y, z) => this.aircraft.localToWorld(new THREE.Vector3(x, y, z));
    this.routeToCockpit = [W(13, 4.6, term.D * 0.75), W(0, 4.6, term.D * 0.68), W(0, 4.6, 22), W(doorX, 4.6, 16), W(doorX, 4.6, 6), Fp.clone().addScaledVector(n, -1.5), Fp.clone().addScaledVector(n, 1.0), Rr.clone(), D.clone(), toWorldBody(-1.2, CABIN.floor, -13.0), toWorldBody(0, CABIN.floor, -13.3), toWorldBody(-0.2, CABIN.floor, -14.3), toWorldBody(-0.45, CABIN.ckFloor, -15.25)];
    this.routeOut = this.routeToCockpit.slice(4).reverse().concat([W(doorX, 4.6, 16), W(0, 4.6, 22), W(0, 4.6, term.D * 0.75), term.exitPos.clone()]);
    this.seat = toWorldBody(-0.52, CABIN.ckFloor, -15.05);
    this.exitPos = term.exitPos;
    this.boardingDone = false; this.announced = false; this.greeted = false;
    return this;
  }
  enter(where) {
    this.active = true; this.time = 0;
    const p = this.parts;
    if (where === 'cockpit') { this.pos.copy(this.seat).add(new THREE.Vector3(0, 0, 0)); this.pos.y = this.walk.floorAt(this.pos.x, this.pos.z, this.pos.y)?.y ?? this.pos.y; const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.aircraft.quaternion); this.yaw = Math.atan2(-back.x, -back.z); this.pos.addScaledVector(back, 0.35); this.parts.cabin.deplane(); this.deplaning = true; }
    else { const s = p.term.spawn; this.pos.copy(s.pos); const f = p.n.clone(); this.yaw = Math.atan2(-f.x, -f.z); }
    this.pitch = this.thirdPerson && where !== 'cockpit' ? -0.2 : -0.05; this.floorY = this.pos.y;
    this.bodyYaw = this.yaw; this.vel.set(0, 0, 0); this.camE = 0.8; this.fpK = where === 'cockpit' || !this.thirdPerson ? 1 : 0; this.lookIdle = 9; this.anim.stop = 0;
    if (this.av) { const q = this.av.p[0]; q.mode = 'stand'; }
  }
  dispose() {
    if (!this.parts) return; const { term, bridge, cabin } = this.parts;
    this.scene.remove(term.group); this.scene.remove(bridge.group); this.aircraft.remove(cabin.group); term.dispose(); bridge.dispose(); cabin.dispose();
    if (this.o?.stand?.jb) this.o.stand.jb.visible = true;
    this.parts = null; this.active = false; this.grid = null; this.avRoot.visible = false;
  }
  hideInteriors(v) { if (!v) this.avRoot.visible = false; if (!this.parts) return; this.parts.term.group.visible = this.parts.cabin.group.visible = v; }
  zoneTag() { const f = this.walk.floorAt(this.pos.x, this.pos.z, this.floorY); return f ? f.tag : ''; }
  zoneAt(x, z, prefY) { // walk zone under (x, z), ignoring furniture blocks (the camera may pass over benches)
    let best = null, by = 0;
    for (const Z of this.walk.zones) { const [a, b] = this.walk.local(Z, x, z); if (Math.abs(a) <= Z.hl && Math.abs(b) <= Z.hw) { const y = Z.y0 + (Z.y1 - Z.y0) * (a + Z.hl) / (2 * Z.hl); if (!best || Math.abs(y - prefY) < Math.abs(by - prefY)) { best = Z; by = y; } } }
    return best ? (this._za = this._za || {}, this._za.y = by, this._za.tag = best.tag, this._za) : null;
  }
  camFree(P) { // may the third-person camera be at world point P?
    const z = this.zoneAt(P.x, P.z, this.floorY); if (!z || Math.abs(z.y - this.floorY) > 1.3) return false;
    const h = P.y - z.y, cap = (ZCAM[z.tag] || ZCAM.hall)[1]; if (h > cap || h < 0.25) return false;
    if (this.grid && z.tag === 'hall') { const G = this.grid; _q.copy(P).applyMatrix4(G.inv); const R = 0.2; // the camera is a 20 cm sphere: centre + 6 probes
      const occ = (x, y, z) => { const ix = Math.floor((x - G.x0) / G.cs), iy = Math.floor((y - G.y0) / G.cs), iz = Math.floor((z - G.z0) / G.cs); return ix >= 0 && iy >= 0 && iz >= 0 && ix < G.nx && iy < G.ny && iz < G.nz && G.occ[(iy * G.nz + iz) * G.nx + ix] === 1; };
      const { x, y, z: zz } = _q; if (occ(x, y, zz) || occ(x + R, y, zz) || occ(x - R, y, zz) || occ(x, y + R, zz) || occ(x, y - R, zz) || occ(x, y, zz + R) || occ(x, y, zz - R)) return false; }
    return true;
  }
  // input: {fwd, side, run, dyaw, dpitch}
  update(dt, input, exposure) {
    if (!this.active || !this.parts) return; this.time += dt;
    const tp = this.thirdPerson;
    if (input.dyaw || input.dpitch) this.lookIdle = 0; else this.lookIdle += dt;
    this.yaw -= input.dyaw; this.pitch = THREE.MathUtils.clamp(this.pitch - input.dpitch, tp && this.fpK < 0.5 ? -1.0 : -1.3, tp && this.fpK < 0.5 ? 0.5 : 1.3);
    let fwd = input.fwd, side = input.side, autoDir = null;
    if (this.auto) { // auto-walk along a list of points
      const t = this.auto.pts[this.auto.i]; if (!t) { this.auto.done = true; this.vel.set(0, 0, 0); if (this.auto.pts === this.routeOut && this.parts) { const n = this.parts.n; this.yaw = this.bodyYaw = Math.atan2(-n.x, -n.z); this.pitch = tp ? -0.2 : -0.04; } this.auto = null; } // at the exit, turn back to face the hall
      else { const dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz); if (d < 0.35) this.auto.i++; else { autoDir = _d.set(dx / d, 0, dz / d); if (!tp) this.yaw = Math.atan2(-dx, -dz); } }
    }
    const sp = (input.run ? 3.4 : 1.7) * (this.auto ? 1.6 : 1);
    // movement: camera-relative; velocity eases in and out (auto-walk moves at once so its routes stay exact)
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
    const tgt = autoDir ? autoDir.clone() : f.multiplyScalar(fwd).add(r.multiplyScalar(side)); if (tgt.lengthSq() > 1) tgt.normalize(); tgt.multiplyScalar(sp);
    if (autoDir || !this.auto && this.vel.lengthSq() < 1e-6 && tgt.lengthSq() < 1e-6) this.vel.copy(tgt); else this.vel.lerp(tgt, 1 - Math.exp(-dt * 10));
    if (this.vel.lengthSq() < 1e-4 && tgt.lengthSq() < 1e-6) this.vel.set(0, 0, 0);
    const mv = this.vel.clone().multiplyScalar(dt), x0 = this.pos.x, z0 = this.pos.z;
    const tryMove = (dx, dz) => { const fl = this.walk.floorAt(this.pos.x + dx, this.pos.z + dz, this.floorY); if (fl && Math.abs(fl.y - this.floorY) < 0.6) { this.pos.x += dx; this.pos.z += dz; this.floorY = fl.y; return true; } return false; };
    if (mv.lengthSq() > 0 && !tryMove(mv.x, mv.z)) { if (!tryMove(mv.x, 0)) tryMove(0, mv.z); }
    this.pos.y = this.floorY; const moved = Math.hypot(this.pos.x - x0, this.pos.z - z0) / Math.max(dt, 1e-4);
    const tag = this.zoneTag();
    // the avatar faces where it walks (smooth turn); in first person the body follows the view
    if (!tp || this.fpK > 0.5) this.bodyYaw = this.yaw;
    else if (moved > 0.12) { const want = Math.atan2(-this.vel.x, -this.vel.z); this.bodyYaw = wrapA(this.bodyYaw + wrapA(want - this.bodyYaw) * (1 - Math.exp(-dt * 10))); }
    if (tp && this.auto && moved > 0.3) { const d = wrapA(this.bodyYaw - this.yaw); if (Math.abs(d) < 2.2) this.yaw += d * (1 - Math.exp(-dt * 2.2)); } // auto-walk: the camera swings in behind
    // camera
    const bob = Math.sin(this.time * 7) * 0.012 * (moved > 0.1 ? 1 : 0);
    const eye = tag === 'cockpit' ? 1.5 : EYE, Ef = _v.set(this.pos.x, this.pos.y + eye + bob, this.pos.z).clone();
    const sc = this.av ? this.av.p[0].scale : 1, H = _h.set(this.pos.x, this.pos.y + 1.58 * sc, this.pos.z);
    const zc = ZCAM[tag] || ZCAM.hall, cpi = Math.cos(this.pitch), D = new THREE.Vector3(-Math.sin(this.yaw) * cpi, Math.sin(this.pitch), -Math.cos(this.yaw) * cpi);
    const boom = Math.min(this.camDist, zc[0]), sh = zc[2] * Math.min(1, boom / 2.5);
    const C = _c.copy(H).addScaledVector(D, -boom); C.x += Math.cos(this.yaw) * sh; C.z -= Math.sin(this.yaw) * sh;
    C.y = THREE.MathUtils.clamp(C.y, this.floorY + 0.45, this.floorY + zc[1] - 0.06);
    let ok = 0; const L = H.distanceTo(C), n = Math.max(2, Math.ceil(L / 0.07)), P = new THREE.Vector3();
    if (tp) for (let i = 1; i <= n; i++) { P.lerpVectors(H, C, i / n); if (!this.camFree(P)) break; ok = i / n; }
    const want = Math.max(0, ok * L - (ok < 1 ? 0.2 : 0));
    this.camE = want < this.camE ? want : Math.min(want, this.camE + 2.6 * dt); // snap in on contact, ease back out
    const fpWant = !tp || FP_TAGS.has(tag) || this.camE < (this.fpK > 0.5 ? 0.62 : 0.45);
    this.fpK = THREE.MathUtils.clamp(this.fpK + (fpWant ? 1 : -1) * dt * 5, 0, 1); const kf = this.fpK * this.fpK * (3 - 2 * this.fpK);
    const Ct = H.clone().add(C.clone().sub(H).setLength(Math.max(0.001, this.camE)));
    this.camera.position.lerpVectors(Ct, Ef, kf);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')); this.camera.fov = 70 - 8 * (1 - kf); this.camera.near = 0.05; this.camera.updateProjectionMatrix();
    // interiors
    const { term, cabin } = this.parts; const k = Math.min(1.6, 0.62 / exposure);
    // the avatar: walk / run cycle at the real ground speed, idle when stopped; hidden in first person
    if (this.av) { const p = this.av.p[0]; this._animate(dt, moved); p.x = this.pos.x; p.y = this.pos.y; p.z = this.pos.z; p.yaw = this.bodyYaw + Math.PI;
      const show = tp && this.fpK < 0.55; this.avRoot.visible = show; if (show) { this.av.setExposure(k); this.av.commit(this.anim.t, H); } }
    term.mat.color.setScalar(k); if (term.shafts) term.shafts.opacity = 0.14 * Math.max(0, Math.min(1, (2.0 - exposure) / 1.2)); cabin.mat.color.setScalar(k); cabin.light && cabin.light(k); term.crowd.setExposure(k); cabin.crowd.setExposure(k);
    const cp = this.camera.position; term.update(dt, this.time, cp);
    if (this.deplaning) cabin.updateOut(dt, this.time, cp);
    else if (this.boarding) { const done = cabin.update(dt, this.time, cp); if (done && !this.boardingDone) { this.boardingDone = true; this.onEvent && this.onEvent('boarded'); } } else cabin.crowd.commit(this.time, cabin.group.worldToLocal(cp.clone()));
    // events and prompts
    this.prompt = '';
    if (this.o.mode === 'dep') {
      if (['bridge', 'gatedoor'].includes(tag) && !this.boarding) { this.boarding = true; this.onEvent && this.onEvent('boarding'); }
      if (['entry', 'door'].includes(tag) && !this.greeted) { this.greeted = true; this.onEvent && this.onEvent('greet'); }
      if (this.pos.distanceTo(this.seat) < 1.1) this.prompt = 'E  Take the captain’s seat';
      else if (tag === 'hall') this.prompt = 'Walk to the gate and down the jet bridge · J skips to the flight deck · V camera';
    } else {
      if (this.pos.distanceTo(this.exitPos) < 6) this.prompt = 'E  Leave the airport and finish your trip';
      else if (tag === 'cockpit') this.prompt = 'Follow the passengers out through the door on the left · J skips to the arrival hall';
    }
  }
  _animate(dt, v) { // walk / run cycle phase driven by the real speed; stride starts and ends at a heel strike (the smallest pose change)
    const A = this.anim, p = this.av.p[0]; A.v += (v - A.v) * (1 - Math.exp(-dt * 8)); const s = A.v;
    const phase = () => ((A.t * A.a * 5.2 + p.seed) % TAU + TAU) % TAU;
    const rebase = (a, target) => { const k = a * 5.2, per = TAU / k; let tn = (target - p.seed) / k; tn += Math.ceil((A.t - tn) / per) * per; A.t = tn; A.a = a; p.speed = a; if (p._bt != null && p._bt > tn + 7) p._bt = tn + 1; }; // the clock only ever moves forward
    if (s > 0.22 || (p.mode === 'walk' && s > 0.08)) {
      const a = s > 2.35 || (A.a > 1.2 && s > 2.0) ? 1.35 : 1.1;
      if (p.mode !== 'walk') { rebase(a, Math.PI * 0.5); p.mode = 'walk'; } else if (a !== A.a) rebase(a, phase());
      const w = Math.min(a > 1.2 ? 9.8 : 8.4, TAU * s / (a > 1.2 ? 1.8 : 1.45)); A.t += dt * Math.max(0.35, w / (a * 5.2)); A.stop = 0;
    } else if (p.mode === 'walk') { A.stop += dt; const q = phase() % Math.PI; if (Math.abs(q - Math.PI * 0.5) < 0.3 || A.stop > 0.45) p.mode = 'stand'; else A.t += dt * 0.9; }
    else A.t += dt;
  }
  autoWalk(pts) { let bi = 0, bd = 1e9; pts.forEach((q, i) => { const d = Math.hypot(q.x - this.pos.x, q.z - this.pos.z) + Math.abs(q.y - this.pos.y) * 20; if (d < bd) { bd = d; bi = i; } }); this.auto = { pts, i: bi, done: false }; }
}
