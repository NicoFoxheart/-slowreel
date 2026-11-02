// Emergency ground scene (lead-owned): airport fire and rescue trucks (ARFF) that drive out to the aircraft after an
// emergency landing, flash their light bars and foam a burning engine; belly-landing sparks; engine fire smoke;
// evacuation slides with passengers running clear to an assembly point. Built procedurally, instanced, no per-frame allocations.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
// a pooled particle system (sparks, smoke, foam): fixed-size buffers, soft round sprites
class Particles {
  constructor(scene, o) {
    this.n = o.n; this.o = o; this.pos = new Float32Array(o.n * 3); this.vel = new Float32Array(o.n * 3); this.life = new Float32Array(o.n); this.age = new Float32Array(o.n); this.i = 0;
    const g = new THREE.BufferGeometry(); this.attr = new THREE.BufferAttribute(this.pos, 3); this.attr.setUsage(THREE.DynamicDrawUsage); g.setAttribute('position', this.attr);
    this.alpha = new THREE.BufferAttribute(new Float32Array(o.n), 1); this.alpha.setUsage(THREE.DynamicDrawUsage); g.setAttribute('alpha', this.alpha);
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: o.add ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uMap: { value: new THREE.CanvasTexture(c) }, uColor: { value: new THREE.Color(o.color) }, uSize: { value: o.size }, uScale: { value: 600 } },
      vertexShader: 'attribute float alpha; varying float vA; uniform float uSize; uniform float uScale; void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize * uScale / max(1.0, -mv.z) * (0.6 + 0.8 * (1.0 - alpha)); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D uMap; uniform vec3 uColor; varying float vA; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(uColor, t.a * vA); if (gl_FragColor.a < 0.01) discard; }' });
    this.pts = new THREE.Points(g, mat); this.pts.frustumCulled = false; this.pts.renderOrder = 7; scene.add(this.pts); this.live = 0;
  }
  emit(p, v, spread, life) { const k = this.i; this.i = (this.i + 1) % this.n; const j = k * 3; this.pos[j] = p.x; this.pos[j + 1] = p.y; this.pos[j + 2] = p.z;
    this.vel[j] = v.x + (Math.random() - 0.5) * spread; this.vel[j + 1] = v.y + (Math.random() - 0.5) * spread; this.vel[j + 2] = v.z + (Math.random() - 0.5) * spread; this.life[k] = life * (0.7 + Math.random() * 0.6); this.age[k] = 0; this.live = 1; }
  update(dt) {
    if (!this.live) return; const o = this.o, a = this.alpha.array; let any = 0;
    for (let k = 0; k < this.n; k++) { if (this.age[k] >= this.life[k]) { a[k] = 0; continue; } any = 1; this.age[k] += dt; const j = k * 3, t = this.age[k] / this.life[k];
      this.vel[j + 1] += o.g * dt; const dr = Math.max(0, 1 - o.drag * dt); this.vel[j] *= dr; this.vel[j + 1] *= dr; this.vel[j + 2] *= dr;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt; a[k] = (1 - t) * Math.min(1, t * 8) * o.alpha; }
    this.attr.needsUpdate = true; this.alpha.needsUpdate = true; this.live = any;
  }
  clear() { this.life.fill(0); this.age.fill(1); this.alpha.array.fill(0); this.alpha.needsUpdate = true; this.live = 0; }
}
function truckGeometries() { // ~10.5 m six-wheel ARFF truck: forward-control cab, water/foam tank body, roof + bumper turrets, light bar
  const B = (w, h, d, r, x, y, z) => new RoundedBoxGeometry(w, h, d, 3, r).translate(x, y, z);
  const paint = mergeGeometries([B(2.9, 2.0, 7.4, 0.18, 0, 2.05, 1.5), B(2.9, 1.6, 2.9, 0.22, 0, 2.15, -3.5), B(2.95, 0.5, 10.4, 0.12, 0, 0.95, 0.2), B(2.7, 0.35, 0.5, 0.1, 0, 1.0, -5.3)]);
  const dark = mergeGeometries([B(2.92, 0.95, 1.6, 0.16, 0, 2.55, -4.15), B(0.06, 0.8, 1.9, 0.03, 1.47, 2.45, -3.4), B(0.06, 0.8, 1.9, 0.03, -1.47, 2.45, -3.4), B(2.4, 0.5, 0.2, 0.06, 0, 1.2, -5.5)]); // windows + grille
  const stripe = mergeGeometries([B(2.98, 0.22, 10.3, 0.06, 0, 1.35, 0.2)]);
  const metal = mergeGeometries([new THREE.CylinderGeometry(0.28, 0.32, 0.35, 16).translate(0, 3.25, -1.6), new THREE.CylinderGeometry(0.09, 0.12, 1.9, 12).rotateX(Math.PI / 2).translate(0, 3.45, -2.6), new THREE.CylinderGeometry(0.07, 0.09, 1.0, 12).rotateX(Math.PI / 2).translate(0.6, 0.95, -5.8), B(2.6, 0.12, 6.6, 0.04, 0, 3.1, 1.6)]);
  const tyre = new THREE.CylinderGeometry(0.62, 0.62, 0.48, 20).rotateZ(Math.PI / 2), wheels = [];
  for (const z of [-3.2, 1.6, 3.4]) for (const x of [-1.25, 1.25]) wheels.push(tyre.clone().translate(x, 0.62, z));
  const lightR = mergeGeometries([B(0.7, 0.18, 0.34, 0.06, -0.55, 3.08, -4.4), new THREE.SphereGeometry(0.1, 10, 8).translate(-1.3, 2.9, 4.95)]), lightB = mergeGeometries([B(0.7, 0.18, 0.34, 0.06, 0.55, 3.08, -4.4), new THREE.SphereGeometry(0.1, 10, 8).translate(1.3, 2.9, 4.95)]);
  return { paint, dark, stripe, metal, tyres: mergeGeometries(wheels), lightR, lightB };
}
export class Rescue {
  constructor(scene) {
    this.scene = scene; this.g = new THREE.Group(); this.g.visible = false; scene.add(this.g); this.trucks = []; this.t = 0; this.evac = null;
    this.sparks = new Particles(scene, { n: 260, color: 0xffb347, size: 0.35, g: -9.8, drag: 0.6, alpha: 1, add: true });
    this.smoke = new Particles(scene, { n: 220, color: 0x2a2a2c, size: 5.5, g: 1.2, drag: 0.35, alpha: 0.55 });
    this.foam = new Particles(scene, { n: 360, color: 0xf4f7fa, size: 1.3, g: -9.8, drag: 0.15, alpha: 0.85 });
  }
  buildTrucks() {
    if (this.mats) return; const G = truckGeometries();
    this.mats = { paint: new THREE.MeshPhysicalMaterial({ color: 0xd4c21c, roughness: 0.32, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.15 }), dark: new THREE.MeshStandardMaterial({ color: 0x11161c, roughness: 0.12, metalness: 0.3 }),
      stripe: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, emissive: 0x111111 }), metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 0.85 }), tyre: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }),
      red: new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a10, emissiveIntensity: 2 }), blue: new THREE.MeshStandardMaterial({ color: 0x000820, emissive: 0x2050ff, emissiveIntensity: 2 }) };
    this.G = G;
  }
  makeTruck() { const m = this.mats, G = this.G, t = new THREE.Group(); for (const [g, mat] of [[G.paint, m.paint], [G.dark, m.dark], [G.stripe, m.stripe], [G.metal, m.metal], [G.tyres, m.tyre], [G.lightR, m.red], [G.lightB, m.blue]]) { const me = new THREE.Mesh(g, mat); me.castShadow = true; t.add(me); } this.g.add(t); return t; }
  // dispatch: trucks leave from `from` (fire station side of the airfield) and take stations around the aircraft
  dispatch(from, fire) {
    this.buildTrucks(); this.g.visible = true; this.fire = fire; if (this.trucks.length) return;
    const slots = [[-26, -4, 'L'], [26, -4, 'R'], [9, -42, 'N']]; // aircraft frame (x right, z forward negative): abeam each engine, and off the nose
    slots.forEach(([x, z, k], i) => { const obj = this.makeTruck(); const p = from.clone().add(_v.set((i - 1) * 9, 0, i * 6)); obj.position.copy(p); this.trucks.push({ obj, slot: new THREE.Vector3(x, 0, z), k, delay: i * 2.5, v: 0, hdg: 0, parked: false }); });
  }
  clear() { for (const t of this.trucks) this.g.remove(t.obj); this.trucks = []; this.g.visible = false; this.sparks.clear(); this.smoke.clear(); this.foam.clear(); this.clearEvac(); this.fire = false; }
  // per frame. ac: aircraft Object3D; s: { scrape (m/s), fire: [bool,bool], ground(x,z) → {h}, foamOn }
  update(dt, ac, s) {
    this.t += dt; const L = Math.floor(this.t * 6) % 2; if (this.mats) { this.mats.red.emissiveIntensity = L ? 3 : 0.15; this.mats.blue.emissiveIntensity = L ? 0.15 : 3; }
    // sparks along the belly and nacelles while sliding
    if (s.scrape > 2) { const n = Math.min(14, Math.ceil(s.scrape / 4)); for (let k = 0; k < n; k++) { const pr = k % 3 === 0 ? [0, -2.1, -2 + Math.random() * 8] : [(k % 2 ? 5.75 : -5.75), -3.0, -5 + Math.random() * 2]; _v.set(pr[0], pr[1], pr[2]).applyMatrix4(ac.matrixWorld); _w.set(0, 0, 1).applyQuaternion(ac.quaternion).multiplyScalar(s.scrape * 0.4); _w.y = 2 + Math.random() * 3; this.sparks.emit(_v, _w, 6, 0.6); } }
    // smoke from a burning engine (or after a belly slide)
    for (let i = 0; i < 2; i++) if (s.fire[i] || (s.smoulder && Math.random() < 0.3)) { _v.set(i ? 5.75 : -5.75, -2.6, -3).applyMatrix4(ac.matrixWorld); _w.set(0, 2.5, 0); if (Math.random() < 0.6) this.smoke.emit(_v, _w, 2.5, 6); }
    // trucks: drive to their slot, park facing the aircraft, foam the engines
    for (const t of this.trucks) {
      if (t.delay > 0) { t.delay -= dt; continue; }
      _v.copy(t.slot).applyMatrix4(ac.matrixWorld); _v.y = 0; const o = t.obj, dx = _v.x - o.position.x, dz = _v.z - o.position.z, d = Math.hypot(dx, dz);
      const tgtV = d > 3 ? Math.min(19, 2 + d * 0.35) : 0; t.v += Math.max(-6 * dt, Math.min(3.5 * dt, tgtV - t.v));
      const want = d > 3 ? Math.atan2(-dx, -dz) : Math.atan2(ac.position.x - o.position.x, ac.position.z - o.position.z) + Math.PI; let dh = want - t.hdg; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); t.hdg += Math.max(-dt * 0.9, Math.min(dt * 0.9, dh));
      o.position.x -= Math.sin(t.hdg) * t.v * dt; o.position.z -= Math.cos(t.hdg) * t.v * dt; o.position.y = s.ground(o.position.x, o.position.z).h; o.rotation.set(0, t.hdg, 0); t.parked = d < 4 && t.v < 0.5;
      if (t.parked && (s.fire[0] || s.fire[1] || s.foamOn) && t.k !== 'N') { const i = t.k === 'L' ? 0 : 1; _v.set(0, 3.45, -3.5).applyMatrix4(o.matrixWorld); _w.set(i ? 5.75 : -5.75, -2.6, -4).applyMatrix4(ac.matrixWorld).sub(_v); const dist = _w.length(); _w.normalize().multiplyScalar(Math.min(32, 9 + dist * 0.9)); _w.y += dist * 0.28; for (let k = 0; k < 3; k++) this.foam.emit(_v, _w, 1.6, 1.4); }
    }
    this.sparks.update(dt); this.smoke.update(dt); this.foam.update(dt); this.updateEvac(dt, ac, s);
  }
  // evacuation: four slides off the doors, passengers run out to an assembly point upwind
  evacuate(ac, belly) {
    if (this.evac) return; const doorY = belly ? 0.6 : 1.0, groundY = belly ? -2.4 : -4.6; const slideM = new THREE.MeshStandardMaterial({ color: 0xf2bf1f, roughness: 0.55 }); const doors = [[-1.95, -12.6], [1.95, -12.6], [-1.95, 13.4], [1.95, 13.4]];
    const grp = new THREE.Group(); const slides = [];
    for (const [x, z] of doors) { const len = belly ? 4.5 : 8.2, out = Math.sign(x), drop = doorY - groundY, run = Math.sqrt(Math.max(1, len * len - drop * drop)); const g = mergeGeometries([new RoundedBoxGeometry(1.9, 0.28, len, 2, 0.12), new THREE.CapsuleGeometry(0.2, len - 0.4, 4, 10).rotateX(Math.PI / 2).translate(0.95, 0.2, 0), new THREE.CapsuleGeometry(0.2, len - 0.4, 4, 10).rotateX(Math.PI / 2).translate(-0.95, 0.2, 0)]);
      const m = new THREE.Mesh(g, slideM); m.rotation.order = 'YXZ'; m.rotation.y = out > 0 ? -Math.PI / 2 : Math.PI / 2; m.rotation.x = -Math.atan2(drop, run); m.position.set(x + out * (run / 2 + 0.2), (doorY + groundY) / 2, z); m.scale.set(1, 1, 0.02); grp.add(m); slides.push({ m, foot: new THREE.Vector3(x + out * (run + 1.2), groundY, z), top: new THREE.Vector3(x, doorY, z) }); }
    ac.add(grp); // slides belong to the aircraft frame
    const body = mergeGeometries([new THREE.CapsuleGeometry(0.21, 0.95, 4, 10).translate(0, 0.72, 0), new THREE.SphereGeometry(0.13, 12, 10).translate(0, 1.55, 0)]); const N = 72;
    const mesh = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.75 }), N); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; const col = new THREE.Color(); const pal = [0x2f4a6e, 0x8c2f2f, 0x2e2e2e, 0xd9d2c3, 0x3f6b45, 0x6b4f8c, 0xb5793a, 0x1f5f7a, 0x9a9a9a];
    for (let i = 0; i < N; i++) { mesh.setColorAt(i, col.setHex(pal[i % pal.length]).offsetHSL(0, 0, (Math.random() - 0.5) * 0.1)); mesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); } this.scene.add(mesh);
    _v.set(0, 0, 1).applyQuaternion(ac.quaternion); const ap = ac.position.clone().addScaledVector(_v.set(_v.x, 0, _v.z).normalize(), 55); // assembly point behind the aircraft, clear of the engines
    const people = []; for (let i = 0; i < N; i++) people.push({ slide: i % 4, t0: 1.5 + Math.floor(i / 4) * 1.1 + Math.random() * 0.4, p: new THREE.Vector3(), done: false, off: new THREE.Vector3((Math.random() - 0.5) * 22, 0, (Math.random() - 0.5) * 14), spd: 2.6 + Math.random() * 1.6, ph: Math.random() * 6 });
    this.evac = { grp, slides, mesh, people, t: 0, ap, ac };
  }
  updateEvac(dt, ac, s) {
    const E = this.evac; if (!E) return; E.t += dt;
    for (const sl of E.slides) sl.m.scale.z = Math.min(1, sl.m.scale.z + dt * 0.8); // slides inflate in about a second
    for (let i = 0; i < E.people.length; i++) { const P = E.people[i], tt = E.t - P.t0; if (tt < 0) continue; const sl = E.slides[P.slide];
      if (tt < 1.4) { _v.copy(sl.top).lerp(sl.foot, tt / 1.4).applyMatrix4(ac.matrixWorld); P.p.copy(_v); _e.set(-0.9, 0, 0); }
      else { _w.copy(E.ap).add(P.off); _w.y = P.p.y; _v.copy(_w).sub(P.p); const d = _v.length(); if (d > 0.5) { P.p.addScaledVector(_v.normalize(), Math.min(d, P.spd * dt)); _e.set(0, Math.atan2(_v.x, _v.z), 0); } else _e.set(0, 0, 0); P.p.y = s.ground(P.p.x, P.p.z).h + (d > 0.5 ? Math.abs(Math.sin((E.t + P.ph) * 9)) * 0.08 : 0); }
      _q.setFromEuler(_e); E.mesh.setMatrixAt(i, _m.compose(P.p, _q, _s)); }
    E.mesh.instanceMatrix.needsUpdate = true;
  }
  clearEvac() { const E = this.evac; if (!E) return; E.ac.remove(E.grp); this.scene.remove(E.mesh); E.mesh.geometry.dispose(); this.evac = null; }
}
