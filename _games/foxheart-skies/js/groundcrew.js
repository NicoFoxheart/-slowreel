// Ramp life at the gate: pushback tug with tow bar, ground crew in hi-vis (a headset person walking by the nose
// gear, a wing walker, a marshaller with lit wands), wheel chocks, safety cones and a ground power unit.
// Sequence: parked (chocks, cones, GPU) → prep (cones and chocks removed, GPU off, tug drives in and connects) →
// pushing (tug follows the nose gear, headset person walks alongside) → release (tug disconnects and drives off,
// crew salute, marshaller waves) → off. Arrival: marshaller guides you in, then chocks, cones and GPU appear.
import * as THREE from 'three';
import { atmos } from './sky.js';
import { DIM } from './aircraft.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const M = (c, o = {}) => atmos(new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.05, ...o }));
function rbox(w, h, d, r) { const s = new THREE.Shape(); const x = -w / 2, y = -h / 2; s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, d - r * 2), bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.6, bevelSegments: 2, curveSegments: 3 }); g.translate(0, 0, -d / 2 + r); return g; }

function person(mats, opts = {}) {
  const g = new THREE.Group(); const L = {};
  const cap = (r, h, m) => new THREE.Mesh(new THREE.CapsuleGeometry(r, h, 4, 10), m);
  const hip = new THREE.Group(); hip.position.y = 0.92; g.add(hip);
  for (const s of [-1, 1]) { const th = new THREE.Group(); th.position.set(s * 0.1, 0, 0); hip.add(th); const up = cap(0.075, 0.34, mats.trouser); up.position.y = -0.22; th.add(up);
    const kn = new THREE.Group(); kn.position.y = -0.44; th.add(kn); const lo = cap(0.065, 0.34, mats.trouser); lo.position.y = -0.21; kn.add(lo); const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.26), mats.boot); boot.position.set(0, -0.44, 0.05); kn.add(boot); L['leg' + s] = th; L['knee' + s] = kn; }
  const torso = new THREE.Group(); hip.add(torso); const body = cap(0.17, 0.38, mats.shirt); body.position.y = 0.3; torso.add(body);
  const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.185, 0.46, 14, 1, true), mats.vest); vest.position.y = 0.3; torso.add(vest);
  for (const y of [0.2, 0.36]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.193, 0.19, 0.035, 14, 1, true), mats.reflect); st.position.y = y; torso.add(st); }
  const head = new THREE.Group(); head.position.y = 0.66; torso.add(head); head.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), mats.skin));
  if (opts.headset) for (const s of [-1, 1]) { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 12).rotateZ(Math.PI / 2), mats.cup); cup.position.set(s * 0.115, 0, 0); head.add(cup); }
  const capm = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.capc); capm.position.y = 0.02; head.add(capm);
  for (const s of [-1, 1]) { const sh = new THREE.Group(); sh.position.set(s * 0.22, 0.5, 0); torso.add(sh); const ua = cap(0.055, 0.25, mats.vest); ua.position.y = -0.16; sh.add(ua);
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el); const fa = cap(0.05, 0.22, mats.shirt); fa.position.y = -0.14; el.add(fa); const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mats.glove); hand.position.y = -0.3; el.add(hand);
    if (opts.wands) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.42, 8), mats.wand); w.position.y = -0.5; el.add(w); }
    L['arm' + s] = sh; L['elbow' + s] = el; }
  g.userData.L = L; g.userData.torso = torso; g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}
function pose(p, t, mode) { // mode: idle | walk | wave | salute | push
  const L = p.userData.L; const s = Math.sin(t * 6.5);
  const walk = mode === 'walk' || mode === 'push';
  L['leg-1'].rotation.x = walk ? s * 0.45 : 0; L['leg1'].rotation.x = walk ? -s * 0.45 : 0; L['knee-1'].rotation.x = walk ? Math.max(0, -s) * 0.6 : 0; L['knee1'].rotation.x = walk ? Math.max(0, s) * 0.6 : 0;
  L['arm-1'].rotation.set(walk ? -s * 0.35 : 0.05, 0, -0.08); L['arm1'].rotation.set(walk ? s * 0.35 : 0.05, 0, 0.08); L['elbow-1'].rotation.x = L['elbow1'].rotation.x = -0.25;
  if (mode === 'wave') { const w = Math.sin(t * 2.6); L['arm-1'].rotation.set(0, 0, -2.4 + w * 0.5); L['arm1'].rotation.set(0, 0, 2.4 - w * 0.5); L['elbow-1'].rotation.x = L['elbow1'].rotation.x = 0; }
  if (mode === 'guide') { const w = Math.sin(t * 2.2); L['arm-1'].rotation.set(-1.4 + w * 0.6, 0, -0.3); L['arm1'].rotation.set(-1.4 + w * 0.6, 0, 0.3); L['elbow-1'].rotation.x = L['elbow1'].rotation.x = -1.2 - w * 0.4; }
  if (mode === 'salute') { L['arm1'].rotation.set(-2.6, 0, 0.5); L['elbow1'].rotation.x = -1.6; }
  if (mode === 'push') { L['arm-1'].rotation.set(-0.4, 0, -0.2); L['elbow-1'].rotation.x = -1.3; }
}

export class GroundCrew {
  constructor(scene) {
    this.g = new THREE.Group(); this.g.name = 'groundcrew'; this.g.visible = false; scene.add(this.g); this.state = 'off'; this.t = 0;
    const mats = { trouser: M(0x23272e, { roughness: 0.85 }), boot: M(0x141414, { roughness: 0.7 }), shirt: M(0x2b3442, { roughness: 0.85 }), vest: M(0xd7f22a, { roughness: 0.6, emissive: 0x2a3300, emissiveIntensity: 0.4 }),
      reflect: M(0xe6e8ea, { roughness: 0.25, metalness: 0.6 }), skin: M(0xb98a6a, { roughness: 0.7 }), cup: M(0xc8261c, { roughness: 0.5 }), capc: M(0x1d2a44, { roughness: 0.8 }), glove: M(0x2d2d2d, { roughness: 0.8 }),
      wand: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.2, 0.25) }) };
    this.mats = mats;
    // tug
    const tug = new THREE.Group(); const yel = M(0xe3b21b, { roughness: 0.45 }), dark = M(0x1e2125, { roughness: 0.7 }), glass = M(0x203040, { roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.7 });
    const body = new THREE.Mesh(rbox(2.5, 0.9, 5.0, 0.12), yel); body.position.y = 0.85; tug.add(body);
    const cab = new THREE.Mesh(rbox(1.3, 0.75, 1.3, 0.08), dark); cab.position.set(-0.45, 1.65, 1.2); tug.add(cab); const gl = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.2), glass); gl.position.set(-0.45, 1.7, 1.2); tug.add(gl);
    for (const [x, z] of [[-1.1, -1.6], [1.1, -1.6], [-1.1, 1.6], [1.1, 1.6]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.42, 20).rotateZ(Math.PI / 2), dark); w.position.set(x, 0.5, z); tug.add(w); }
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.12, 5.02), M(0x222222)); stripe.position.y = 0.55; tug.add(stripe);
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.3, 0.1) })); this.beacon.position.set(-0.45, 2.1, 1.2); tug.add(this.beacon);
    tug.traverse(o => { if (o.isMesh) o.castShadow = true; }); this.tug = tug; this.g.add(tug);
    this.bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5), M(0x2a2a2a)); this.g.add(this.bar);
    // chocks, cones, GPU
    const chockS = new THREE.Shape([new THREE.Vector2(-0.2, 0), new THREE.Vector2(0.2, 0), new THREE.Vector2(0.05, 0.22), new THREE.Vector2(-0.05, 0.22)]); const chockG = new THREE.ExtrudeGeometry(chockS, { depth: 0.5, bevelEnabled: false }); chockG.translate(0, 0, -0.25);
    const chockM = M(0xf2c218, { roughness: 0.7 }); this.chocks = []; for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(chockG, chockM); c.castShadow = true; this.g.add(c); this.chocks.push(c); }
    const coneG = new THREE.LatheGeometry([[0.2, 0], [0.18, 0.04], [0.04, 0.72], [0.0, 0.74]].map(([r, y]) => new THREE.Vector2(r, y)), 16); const coneM = M(0xff5a14, { roughness: 0.6 }), band = M(0xf4f4f4, { roughness: 0.3 });
    this.cones = []; for (let i = 0; i < 5; i++) { const c = new THREE.Group(); c.add(new THREE.Mesh(coneG, coneM)); const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.12, 16, 1, true), band); b2.position.y = 0.4; c.add(b2); const base = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.04, 0.44), coneM); base.position.y = 0.02; c.add(base); this.g.add(c); this.cones.push(c); }
    const gpu = new THREE.Group(); const gb = new THREE.Mesh(rbox(1.2, 1.1, 2.0, 0.08), M(0xdadfe3, { roughness: 0.5 })); gb.position.y = 0.85; gpu.add(gb); for (const [x, z] of [[-0.55, -0.7], [0.55, -0.7], [-0.55, 0.7], [0.55, 0.7]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 12).rotateZ(Math.PI / 2), dark); w.position.set(x, 0.22, z); gpu.add(w); }
    gpu.traverse(o => { if (o.isMesh) o.castShadow = true; }); this.gpu = gpu; this.g.add(gpu); this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5), dark); this.g.add(this.cable);
    // people
    this.headset = person(mats, { headset: true }); this.wing = person(mats); this.marsh = person(mats, { wands: true }); this.g.add(this.headset, this.wing, this.marsh);
  }
  // world position of an aircraft-local point on the ground
  gp(ac, x, z, ground) { const p = ac.localToWorld(V(x, 0, z)); p.y = ground(p.x, p.z).h; return p; }
  place(obj, ac, x, z, ground, yaw = 0) { obj.position.copy(this.gp(ac, x, z, ground)); obj.rotation.set(0, this.acYaw(ac) + yaw, 0); }
  acYaw(ac) { const f = V(0, 0, -1).applyQuaternion(ac.quaternion); return Math.atan2(-f.x, -f.z); }
  // parked at a gate: chocks, cones, GPU and crew around the aircraft
  atStand(ac, ground, arriving = false) {
    this.state = arriving ? 'arrive' : 'parked'; this.t = 0; this.g.visible = true; this.ground = ground;
    const nz = DIM.noseGearZ, mz = DIM.mainZ, mx = DIM.mainX; const ch = [[0.0, nz - 0.75], [0.0, nz + 0.75], [-mx, mz - 0.85], [-mx, mz + 0.85], [mx, mz - 0.85], [mx, mz + 0.85]];
    this.chockPos = ch; this.chocks.forEach((c, i) => { this.place(c, ac, ch[i][0], ch[i][1], ground, Math.PI / 2); c.visible = !arriving; });
    this.conePos = [[0, DIM.noseZ - 2.5], [-DIM.span / 2 - 0.6, 4], [DIM.span / 2 + 0.6, 4], [0, DIM.tailZ + 2], [-6.5, -4]];
    this.cones.forEach((c, i) => { this.place(c, ac, this.conePos[i][0], this.conePos[i][1], ground); c.visible = !arriving; });
    this.place(this.gpu, ac, -4.2, nz - 2.5, ground, 0.3); this.gpu.visible = !arriving; this.cable.visible = !arriving;
    this.tug.visible = false; this.bar.visible = false;
    this.place(this.headset, ac, -1.8, nz - 0.6, ground, Math.PI / 2); this.place(this.wing, ac, -DIM.span / 2 + 1, 3, ground, Math.PI); this.place(this.marsh, ac, 0, nz - 16, ground, Math.PI);
    this.headset.visible = !arriving; this.wing.visible = !arriving; this.marsh.visible = arriving;
  }
  startPush(ac) { if (this.state === 'off') return; this.state = 'prep'; this.t = 0; this.tug.visible = true; this.bar.visible = false; this.marsh.visible = false; this.wing.visible = true; this.headset.visible = true;
    this.tugFrom = this.gp(ac, 6, DIM.noseGearZ - 14, this.ground); this.tugYaw = this.acYaw(ac) + Math.PI * 0.5; }
  release() { if (this.state === 'pushing' || this.state === 'prep') { this.state = 'release'; this.t = 0; this.bar.visible = false; } }
  clear() { this.state = 'off'; this.g.visible = false; }
  update(dt, ac, fdm, ground) {
    if (this.state === 'off') return; this.t += dt; const t = this.t; ground = ground || this.ground; this.ground = ground;
    this.beacon.visible = (t * 2) % 1 < 0.5;
    const nz = DIM.noseGearZ, yaw = this.acYaw(ac);
    const tugAt = (x, z) => this.gp(ac, x, z, ground);
    if (this.state === 'arrive') { pose(this.marsh, t, 'guide'); this.marsh.position.copy(this.gp(ac, 0, nz - 14, ground)); this.marsh.rotation.y = yaw + Math.PI; if (t > 6) this.atStand(ac, ground, false); return; }
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
      this.marsh.visible = true; this.marsh.position.copy(tugAt(-7, nz - 10)); this.marsh.rotation.y = yaw + Math.PI * 0.8; pose(this.marsh, t, 'wave'); pose(this.wing, t, 'salute');
      if (t > 14) this.clear();
    }
  }
}
