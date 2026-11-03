// Ramp life at the gate: the full turnaround (env-turnaround.js: catering, fuel, belt + container loaders, baggage
// train, lav + water, cleaning, GPU), pushback tug with tow bar, ground crew in hi-vis (a headset person walking by
// the nose gear, a wing walker, a marshaller with lit wands), wheel chocks and safety cones. Models: env-gse.js.
// Sequence: parked (chocks, cones, GPU) → prep (cones and chocks removed, GPU off, tug drives in and connects) →
// pushing (tug follows the nose gear, headset person walks alongside) → release (tug disconnects and drives off,
// crew salute, marshaller waves) → off. Arrival: marshaller guides you in, then chocks, cones and GPU appear.
import * as THREE from 'three';
import { atmos } from './sky.js';
import { DIM } from './aircraft.js';
import { RampCrew, pushTug, gpuUnit, coneGeometry, chockGeometry, gseMats, hoseMesh } from './env-gse.js';
import { Turnaround } from './env-turnaround.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const M = (c, o = {}) => atmos(new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.05, ...o }));

// people are proxies (position, rotation.y, visible, mode) committed into the instanced RampCrew each frame
function person(mats, opts = {}) { const o = new THREE.Object3D(); o.userData = { mode: 'idle', ...opts }; return o; }
function pose(p, t, mode) { p.userData.mode = mode; } // modes: idle | walk | wave | salute | push | guide

// services the player can call and dismiss (each maps to one or more turnaround vehicles; 'gpu' is the stand GPU)
export const SERVICES = [
  { id: 'fuel', name: 'Fuel', sub: 'hydrant dispenser · right wing', v: ['fuel'] }, { id: 'cat1', name: 'Catering front', sub: 'hi-lift truck · door R1', v: ['cat1'] },
  { id: 'cat2', name: 'Catering aft', sub: 'hi-lift truck · door R2', v: ['cat2'] }, { id: 'bags', name: 'Baggage & cargo', sub: 'belt loaders · ULD loader · baggage train', v: ['belt1', 'belt2', 'train', 'cont'] },
  { id: 'lav', name: 'Lavatory service', sub: 'waste truck · aft panel', v: ['lav'] }, { id: 'water', name: 'Potable water', sub: 'water truck · aft panel', v: ['water'] },
  { id: 'clean', name: 'Cabin cleaning', sub: 'cleaning crew + van', v: ['van'] }, { id: 'gpu', name: 'Ground power', sub: 'GPU · 400 Hz to the nose', gpu: true }];
const RANK = { working: 5, coming: 4, leaving: 3, done: 2, away: 1 };

export class GroundCrew {
  constructor(scene, quality = 'high') {
    this.g = new THREE.Group(); this.g.name = 'groundcrew'; this.g.userData.crew = this; this.g.visible = false; scene.add(this.g); this.state = 'off'; this.t = 0;
    const q = this.q = (() => { try { return JSON.parse(localStorage.getItem('foxheart.settings') || '{}').quality || quality; } catch (e) { return quality; } })();
    const mats = gseMats(q); this.mats = mats;
    // crew: slots 0-2 headset / wing walker / marshaller, 3-15 turnaround staff (env-turnaround.js)
    this.crew = new RampCrew(this.g, 16, q); this.crew.p[2].wands = true; this.crew.p[0].headset = true; this.crew.look(2, { vest: 0xff8a3a, shirt: 0x23272e, trousers: 0x1d2129, skin: 0x8d5f43, cap: 0x1d2a44 });
    this.turn = new Turnaround(this.g, this.crew, q);
    // pushback tug (hitch faces the aircraft) + tow bar
    const tug = new THREE.Group(); tug.add(pushTug()); this.tug = tug; this.g.add(tug);
    this.bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5), M(0xd0a21a, { roughness: 0.5 })); this.bar.castShadow = true; this.g.add(this.bar);
    // chocks and cones (instanced) + GPU with its cable
    this.chocks = Array.from({ length: 6 }, () => new THREE.Object3D()); this.cones = Array.from({ length: 6 }, () => new THREE.Object3D());
    this.chockIM = new THREE.InstancedMesh(chockGeometry(), mats.paint, 6); this.coneIM = new THREE.InstancedMesh(coneGeometry(), mats.paint, 6);
    for (const m of [this.chockIM, this.coneIM]) { m.frustumCulled = false; m.castShadow = true; this.g.add(m); }
    this.coneIM.onBeforeRender = (r, sc, cam) => { this.camD = cam.position.distanceTo(this.turn.svc.position); };
    this.gpu = gpuUnit(); this.g.add(this.gpu); this.cable = new THREE.Group(); this.g.add(this.cable);
    // people
    this.headset = person(mats, { headset: true }); this.wing = person(mats); this.marsh = person(mats, { wands: true });
  }
  // ---- manual ground services (call / dismiss); only while parked at a stand with the parking brake set
  get autoServices() { return this._auto !== false; } set autoServices(v) { this._auto = !!v; }
  canService() { if (this.state !== 'parked' || !this.turn.mode) return 'Ground services are available when parked at a gate'; if (this.fdm && !this.fdm.parkBrake) return 'Set the parking brake first'; return ''; }
  services() { const why = this.canService();
    return SERVICES.map(S => { let state = 'away';
      if (S.gpu) state = this.state !== 'off' && this.gpu.visible ? 'working' : 'away';
      else if (this.turn.mode) for (const id of S.v) { const st = this.turn.vstate(this.turn.V[id]); if (RANK[st] > RANK[state]) state = st; }
      return { id: S.id, name: S.name, sub: S.sub, state, allowed: !why, why }; }); }
  callService(id) { const why = this.canService(), S = SERVICES.find(s => s.id === id); if (!S) return { ok: false, msg: 'Unknown service' }; if (why) return { ok: false, msg: why };
    if (S.gpu) { this.gpu.visible = this.cable.visible = true; return { ok: true, msg: 'GPU connected' }; }
    S.v.forEach((v, i) => this.turn.call(this.turn.V[v], i * 2.5)); return { ok: true, msg: S.name + ' is on the way' }; }
  dismissService(id) { const S = SERVICES.find(s => s.id === id); if (!S) return { ok: false, msg: 'Unknown service' }; if (this.state === 'off' || !this.turn.mode) return { ok: false, msg: 'No ground services here' };
    if (S.gpu) { this.gpu.visible = this.cable.visible = false; return { ok: true, msg: 'GPU disconnected' }; }
    S.v.forEach(v => this.turn.dismiss(this.turn.V[v])); return { ok: true, msg: S.name + ': finishing up and leaving' }; }
  dismissAll() { const why = this.state === 'off' || !this.turn.mode; if (why) return { ok: false, msg: 'No ground services here' }; SERVICES.filter(s => !s.gpu).forEach(s => this.dismissService(s.id)); return { ok: true, msg: 'All ground services are leaving the stand' }; }
  callAll() { const why = this.canService(); if (why) return { ok: false, msg: why }; SERVICES.forEach((s, i) => s.gpu ? this.callService(s.id) : s.v.forEach((v, j) => this.turn.call(this.turn.V[v], i * 3 + j * 2.5))); return { ok: true, msg: 'All ground services called' }; }
  commit() { // proxies -> instances
    const C = this.crew, Z = new THREE.Matrix4().makeScale(0, 0, 0), m = new THREE.Matrix4();
    [this.headset, this.wing, this.marsh].forEach((o, i) => { const p = C.p[i]; p.vis = o.visible && this.g.visible; p.pos.copy(o.position); p.yaw = o.rotation.y; p.mode = o.userData.mode; });
    C.commit(this.t + (this.turn.t || 0));
    for (const [arr, im] of [[this.chocks, this.chockIM], [this.cones, this.coneIM]]) { arr.forEach((o, i) => { if (!o.visible) im.setMatrixAt(i, Z); else { o.updateMatrix(); im.setMatrixAt(i, o.matrix); } }); im.instanceMatrix.needsUpdate = true; }
    // far away: hide the whole turnaround (vehicles + crew); low quality culls earlier
    const far = (this.camD ?? 0) > (this.q === 'low' ? 520 : 950); this.turn.svc.visible = !!this.turn.mode && !far; for (const k in C.M) C.M[k].visible = !far;
  }
  // world position of an aircraft-local point on the ground
  gp(ac, x, z, ground) { const p = ac.localToWorld(V(x, 0, z)); p.y = ground(p.x, p.z).h; return p; }
  place(obj, ac, x, z, ground, yaw = 0) { obj.position.copy(this.gp(ac, x, z, ground)); obj.rotation.set(0, this.acYaw(ac) + yaw, 0); }
  acYaw(ac) { const f = V(0, 0, -1).applyQuaternion(ac.quaternion); return Math.atan2(-f.x, -f.z); }
  // parked at a gate: chocks, cones, GPU and crew around the aircraft
  atStand(ac, ground, arriving = false, svcMode = 'dep') {
    this.state = arriving ? 'arrive' : 'parked'; this.t = 0; this.g.visible = true; this.ground = ground;
    const nz = DIM.noseGearZ, mz = DIM.mainZ, mx = DIM.mainX; const ch = [[0.0, nz - 0.75], [0.0, nz + 0.75], [-mx, mz - 0.85], [-mx, mz + 0.85], [mx, mz - 0.85], [mx, mz + 0.85]];
    this.chockPos = ch; this.chocks.forEach((c, i) => { this.place(c, ac, ch[i][0], ch[i][1], ground, Math.PI / 2); c.visible = !arriving; });
    this.conePos = [[0, DIM.noseZ - 2.5], [-DIM.span / 2 - 0.6, 4], [DIM.span / 2 + 0.6, 4], [0, DIM.tailZ + 2], [-6.5, -4], [6.5, -4]];
    this.cones.forEach((c, i) => { this.place(c, ac, this.conePos[i][0], this.conePos[i][1], ground); c.visible = !arriving; });
    // GPU on the right of the nose, cable to the external-power receptacle behind the nose gear
    const gh = ground(ac.position.x, ac.position.z).h, hAC = ac.position.y - gh, W = (x, y, z) => { const p = ac.localToWorld(V(x, 0, z)); return [p.x, gh + y, p.z]; };
    this.place(this.gpu, ac, 4.2, -16.8, ground, 0.4); this.gpu.visible = !arriving;
    this.cable.traverse(o => o.geometry && o.geometry.dispose()); this.cable.clear(); this.cable.add(hoseMesh([W(4.65, 1.0, -15.73), W(3.6, 0.12, -15.45), W(1.7, 0.1, -15.1), W(0.8, hAC - 2.25, -15.0), W(0.6, hAC - 1.75, -15.0)], 0.035)); this.cable.visible = !arriving;
    if (arriving) this.turn.clear(); else this.turn.start(ac, gh, this.acYaw(ac), svcMode, this.autoServices);
    this.tug.visible = false; this.bar.visible = false;
    this.place(this.headset, ac, -1.8, nz - 0.6, ground, Math.PI / 2); this.place(this.wing, ac, -DIM.span / 2 + 1, 3, ground, Math.PI); this.place(this.marsh, ac, 0, nz - 16, ground, 0);
    this.headset.visible = !arriving; this.wing.visible = !arriving; this.marsh.visible = arriving;
  }
  startPush(ac) { if (this.state === 'off') return; this.state = 'prep'; this.t = 0; this.tug.visible = true; this.bar.visible = false; this.marsh.visible = false; this.wing.visible = true; this.headset.visible = true;
    this.tugFrom = this.gp(ac, 6, DIM.noseGearZ - 14, this.ground); this.tugYaw = this.acYaw(ac) + Math.PI * 0.5; this.turn.prep(); }
  release() { if (this.state === 'pushing' || this.state === 'prep') { this.state = 'release'; this.t = 0; this.bar.visible = false; } }
  clear() { this.state = 'off'; this.g.visible = false; this.turn.clear(); }
  update(dt, ac, fdm, ground) { this.fdm = fdm; if (this.state === 'off') return; this._step(dt, ac, fdm, ground); if (this.state !== 'off') { this.turn.update(dt); this.commit(); } }
  _step(dt, ac, fdm, ground) {
    this.t += dt; const t = this.t; ground = ground || this.ground; this.ground = ground;
    const nz = DIM.noseGearZ, yaw = this.acYaw(ac);
    const tugAt = (x, z) => this.gp(ac, x, z, ground);
    if (this.state === 'arrive') { pose(this.marsh, t, 'guide'); this.marsh.position.copy(this.gp(ac, 0, nz - 14, ground)); this.marsh.rotation.y = yaw; if (t > 6) this.atStand(ac, ground, false, 'arr'); return; }
    if (this.state === 'parked') { pose(this.headset, t, 'idle'); pose(this.wing, t, 'idle'); return; }
    if (this.state === 'prep') { // 0-2 s cones and chocks go, 1-3 s GPU off, 2-7 s tug drives in and hooks up
      const k = THREE.MathUtils.clamp((t - 0.3) / 1.6, 0, 1); this.cones.forEach((c, i) => { c.position.y = ground(c.position.x, c.position.z).h - k * 1.2; c.visible = k < 0.99; });
      this.chocks.forEach(c => { c.visible = t < 1.6; }); this.gpu.visible = this.cable.visible = t < 2.6;
      const hook = tugAt(0, nz - 0.4 - 3.5 - 2.5); const s = THREE.MathUtils.smoothstep(t, 2, 6.5); this.tug.position.lerpVectors(this.tugFrom, hook, s); this.tug.position.y = hook.y;
      this.tug.rotation.y = THREE.MathUtils.lerp(this.tugYaw, yaw, s); pose(this.headset, t, t < 2 ? 'walk' : 'idle'); pose(this.wing, t, 'idle');
      if (t > 6.6) { this.state = 'pushing'; this.t = 0; this.bar.visible = true; this.tugYawCur = yaw; }
    }
    if (this.state === 'pushing') {
      // the tug trails ahead of the nose gear like a trailer, yawing into the turn
      const ng = tugAt(0, nz - 0.4); const ahead = V(-Math.sin(this.tugYawCur), 0, -Math.cos(this.tugYawCur)); const tp = ng.clone().addScaledVector(ahead, 3.5 + 2.5); tp.y = ng.y;
      const want = Math.atan2(-(tp.x - ng.x), -(tp.z - ng.z)); this.tugYawCur += THREE.MathUtils.clamp(((yaw - this.tugYawCur + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -0.6 * dt, 0.6 * dt) * 1.0 + 0 * want;
      this.tug.position.copy(tp); this.tug.rotation.y = this.tugYawCur;
      const be = ng.clone(); be.y += 0.55; const ee = tp.clone().addScaledVector(ahead, -2.5); ee.y += 0.55; this.bar.position.copy(be); this.bar.lookAt(ee); this.bar.scale.set(1, 1, be.distanceTo(ee));
      this.headset.position.copy(tugAt(-2.2, nz + 0.5)); this.headset.rotation.y = yaw; pose(this.headset, t, fdm && Math.hypot(fdm.vel.x, fdm.vel.z) > 0.2 ? 'walk' : 'push');
      this.wing.position.copy(tugAt(-DIM.span / 2 + 1.5, 2)); this.wing.rotation.y = yaw; pose(this.wing, t, 'walk');
    }
    if (this.state === 'release') { // tug unhooks and drives away; crew step clear and salute, marshaller waves you off
      const away = V(-Math.sin(this.tugYawCur + 0.7), 0, -Math.cos(this.tugYawCur + 0.7)); this.tug.position.addScaledVector(away, dt * Math.min(5, t * 1.5)); this.tug.rotation.y = this.tugYawCur + 0.7 * Math.min(1, t / 2);
      this.tug.position.y = ground(this.tug.position.x, this.tug.position.z).h;
      if (t < 3) { this.headset.position.copy(tugAt(-2.2 - t * 1.6, nz + 0.5)); pose(this.headset, t, 'walk'); } else { pose(this.headset, t, t < 9 ? 'salute' : 'idle'); this.headset.rotation.y = yaw + Math.PI * 0.5; }
      this.marsh.visible = true; this.marsh.position.copy(tugAt(-7, nz - 10)); this.marsh.rotation.y = yaw + 0.6; pose(this.marsh, t, 'wave'); pose(this.wing, t, 'salute');
      if (t > 14) this.clear();
    }
  }
}
