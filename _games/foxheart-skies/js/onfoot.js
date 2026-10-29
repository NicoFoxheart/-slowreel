// On-foot mode: first-person walking through the terminal, jet bridge, cabin and flight deck.
import * as THREE from 'three';
import { buildTerminal, buildBridge, buildCabin, boardRows, CABIN, WalkMap } from './interiors.js';
import { rng } from './terrain.js';
import { SHORT } from './atc.js';

const EYE = 1.62;
export class OnFoot {
  constructor(scene, camera, aircraft, audio) {
    this.scene = scene; this.camera = camera; this.aircraft = aircraft; this.audio = audio;
    this.active = false; this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0; this.vy = 0; this.prompt = ''; this.parts = null; this.auto = null; this.time = 0;
  }
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
    if (o.mode === 'arr') { cabin.boarders.forEach(p => { p.state = 'seated'; p.seated = true; p.hidden = false; p.y = CABIN.floor + 0.42; p.x = p.target.x; p.z = p.target.z + 0.08; p.yaw = Math.PI; }); }
    // walk map: hall + bridge + cabin zones (cabin zones in world space)
    const wm = new WalkMap(); wm.zones.push(...term.walk.zones, ...bridge.walk.zones); wm.blocks.push(...term.walk.blocks);
    wm.rect(Fp.clone().addScaledVector(n, -1.2), n, 1.6, 1.1, base.y + 4.6, base.y + 4.6, 'gatedoor');
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.aircraft.quaternion).setY(0).normalize();
    for (const z of cabin.zones) { const c = this.aircraft.localToWorld(new THREE.Vector3(z.x, 0, z.z)); const yw = y => this.aircraft.localToWorld(new THREE.Vector3(0, y, 0)).y; wm.rect(c, fwd, z.hz, z.hx, yw(z.y0), yw(z.y1), z.tag); }
    this.walk = wm; this.parts = { term, bridge, cabin, Fp, Rr, D, n };
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
    this.pitch = -0.05; this.floorY = this.pos.y;
  }
  dispose() {
    if (!this.parts) return; const { term, bridge, cabin } = this.parts;
    this.scene.remove(term.group); this.scene.remove(bridge.group); this.aircraft.remove(cabin.group); term.dispose(); bridge.dispose(); cabin.dispose();
    if (this.o?.stand?.jb) this.o.stand.jb.visible = true;
    this.parts = null; this.active = false;
  }
  hideInteriors(v) { if (!this.parts) return; this.parts.term.group.visible = this.parts.cabin.group.visible = v; }
  zoneTag() { const f = this.walk.floorAt(this.pos.x, this.pos.z, this.floorY); return f ? f.tag : ''; }
  // input: {fwd, side, run, dyaw, dpitch}
  update(dt, input, exposure) {
    if (!this.active || !this.parts) return; this.time += dt;
    this.yaw -= input.dyaw; this.pitch = THREE.MathUtils.clamp(this.pitch - input.dpitch, -1.3, 1.3);
    let fwd = input.fwd, side = input.side;
    if (this.auto) { // auto-walk along a list of points
      const t = this.auto.pts[this.auto.i]; if (!t) { this.auto.done = true; if (this.auto.pts === this.routeOut && this.parts) { const n = this.parts.n; this.yaw = Math.atan2(-n.x, -n.z); this.pitch = -0.04; } this.auto = null; } // at the exit, turn back to face the hall
      else { const dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz); if (d < 0.35) this.auto.i++; else { this.yaw = Math.atan2(-dx, -dz); fwd = 1; side = 0; } }
    }
    const sp = (input.run ? 3.4 : 1.7) * (this.auto ? 1.6 : 1);
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
    const mv = f.multiplyScalar(fwd).add(r.multiplyScalar(side)); if (mv.lengthSq() > 1) mv.normalize(); mv.multiplyScalar(sp * dt);
    const tryMove = (dx, dz) => { const fl = this.walk.floorAt(this.pos.x + dx, this.pos.z + dz, this.floorY); if (fl && Math.abs(fl.y - this.floorY) < 0.6) { this.pos.x += dx; this.pos.z += dz; this.floorY = fl.y; return true; } return false; };
    if (mv.lengthSq() > 0 && !tryMove(mv.x, mv.z)) { if (!tryMove(mv.x, 0)) tryMove(0, mv.z); }
    this.pos.y = this.floorY;
    const tag = this.zoneTag();
    // camera
    const eye = tag === 'cockpit' ? 1.5 : EYE;
    this.camera.position.set(this.pos.x, this.pos.y + eye + Math.sin(this.time * 7) * 0.012 * (mv.lengthSq() > 1e-6 ? 1 : 0), this.pos.z);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')); this.camera.fov = 70; this.camera.near = 0.05; this.camera.updateProjectionMatrix();
    // interiors
    const { term, cabin } = this.parts; const k = Math.min(1.6, 0.62 / exposure);
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
      else if (tag === 'hall') this.prompt = 'Walk to the gate and down the jet bridge · J skips to the flight deck';
    } else {
      if (this.pos.distanceTo(this.exitPos) < 6) this.prompt = 'E  Leave the airport and finish your trip';
      else if (tag === 'cockpit') this.prompt = 'Follow the passengers out through the door on the left · J skips to the arrival hall';
    }
  }
  autoWalk(pts) { let bi = 0, bd = 1e9; pts.forEach((q, i) => { const d = Math.hypot(q.x - this.pos.x, q.z - this.pos.z) + Math.abs(q.y - this.pos.y) * 20; if (d < bd) { bd = d; bi = i; } }); this.auto = { pts, i: bi, done: false }; }
}
