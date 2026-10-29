// Hand-flown landing aids: PAPI lights beside the touchdown zone, an optional "boxes in the sky" glide path tunnel,
// flight director guidance (localiser + glideslope + flare) and the approach coach line.
import * as THREE from 'three';
import { atmos } from './sky.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI, FT = 0.3048, KT = 0.514444;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap180 = a => ((a + 540) % 360) - 180;
const PAPI_SET = [3.5, 3 + 1 / 6, 2 + 5 / 6, 2.5]; // inner (runway side) to outer unit, degrees
const RED = new THREE.Color(3.2, 0.10, 0.05), WHITE = new THREE.Color(3.0, 2.85, 2.6);

function dotTex() { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function frameGeo(w, h, t) { const s = new THREE.Shape(); s.moveTo(-w / 2, -h / 2); s.lineTo(w / 2, -h / 2); s.lineTo(w / 2, h / 2); s.lineTo(-w / 2, h / 2); s.lineTo(-w / 2, -h / 2);
  const p = new THREE.Path(); p.moveTo(-w / 2 + t, -h / 2 + t); p.lineTo(-w / 2 + t, h / 2 - t); p.lineTo(w / 2 - t, h / 2 - t); p.lineTo(w / 2 - t, -h / 2 + t); p.lineTo(-w / 2 + t, -h / 2 + t); s.holes.push(p); return new THREE.ShapeGeometry(s); }

export class LandingAids {
  constructor(scene) {
    this.g = new THREE.Group(); this.g.name = 'landing-aids'; scene.add(this.g); this.ils = null;
    // PAPI: four light units with housings, coloured per unit from the aircraft's elevation angle
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3)); pg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    this.papiPts = new THREE.Points(pg, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, map: dotTex(), transparent: true, depthWrite: false, toneMapped: false }));
    this.papiPts.frustumCulled = false; this.papiPts.renderOrder = 5; this.g.add(this.papiPts);
    const hm = atmos(new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.7 })), hg = new THREE.BoxGeometry(1.1, 0.7, 0.9); this.housings = [];
    for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(hg, hm); this.g.add(m); this.housings.push(m); }
    // glide path boxes: magenta frames every 300 m along the 3 degree path, the next ten ahead of the aircraft
    this.boxMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.35, 1.6), transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const bg = frameGeo(64, 36, 0.9); this.boxes = []; for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(bg, this.boxMat); m.visible = false; m.renderOrder = 4; this.g.add(m); this.boxes.push(m); }
    this.papiState = [0, 0, 0, 0];
  }
  setup(ils, ground) {
    this.ils = ils; if (!ils) { this.g.visible = false; return; } this.g.visible = true;
    const left = new THREE.Vector3(ils.dir.z, 0, -ils.dir.x); // left of the landing direction
    this.units = PAPI_SET.map((a, i) => { const p = ils.gpip.clone().addScaledVector(left, ils.width / 2 + 15 + i * 9); p.y = (ground ? ground(p.x, p.z).h : ils.elev) + 0.6; return p; });
    const pos = this.papiPts.geometry.attributes.position; this.units.forEach((p, i) => { pos.setXYZ(i, p.x, p.y + 0.15, p.z); this.housings[i].position.copy(p); this.housings[i].rotation.y = Math.atan2(-ils.dir.x, -ils.dir.z); }); pos.needsUpdate = true;
    this.papiPts.geometry.computeBoundingSphere();
  }
  // eye: the pilot's eye position; boxes: show the glide path tunnel
  update(ils, eye, opts = {}, ground) {
    if (ils !== this.ils) this.setup(ils, ground); if (!ils) return;
    const col = this.papiPts.geometry.attributes.color;
    this.units.forEach((u, i) => { const d = Math.hypot(eye.x - u.x, eye.z - u.z); const ang = Math.atan2(eye.y - u.y, Math.max(d, 1)) * R2D; const white = ang > PAPI_SET[i]; this.papiState[i] = white ? 1 : 0; const c = white ? WHITE : RED; col.setXYZ(i, c.r, c.g, c.b); });
    col.needsUpdate = true; this.papiPts.material.size = opts.px ? 9 * opts.px : 9;
    // boxes
    const on = !!opts.boxes; const dg = eye.clone().sub(ils.gpip); const dist = -(dg.x * ils.dir.x + dg.z * ils.dir.z); // metres before the aiming point
    const yaw = Math.atan2(-ils.dir.x, -ils.dir.z), tan3 = Math.tan(ils.gs * D2R);
    const first = Math.floor((dist - 120) / 300) * 300; // the next box ahead (smaller distance) of the aircraft
    this.boxes.forEach((b, k) => { const s = first - k * 300; const vis = on && s > 60 && dist > 60 && s < 18520; b.visible = vis; if (!vis) return;
      b.position.copy(ils.gpip).addScaledVector(ils.dir, -s); b.position.y = ils.elev + s * tan3; b.rotation.set(0, yaw, 0); const k2 = clamp(s / 1500, 0.35, 1); b.scale.set(k2, k2, 1); });
    this.boxMat.opacity = 0.75;
  }
  papiText() { const w = this.papiState.reduce((a, b) => a + b, 0); return w === 2 ? 'on path' : w > 2 ? (w === 4 ? 'high' : 'slightly high') : (w === 0 ? 'low' : 'slightly low'); }
}

// Flight director for a hand-flown ILS approach (degrees of bank / pitch still to go; null when there is no guidance)
export function fdGuide(fdm, ils, dev, e) {
  if (!ils || !dev || !dev.valid || fdm.onGround || dev.thrDist < -300 || dev.along > 40000) return null;
  const V = Math.max(fdm.vel.length(), 30), gs = Math.max(Math.hypot(fdm.vel.x, fdm.vel.z), 1);
  const track = (Math.atan2(fdm.vel.x, -fdm.vel.z) * R2D + 360) % 360;
  const xt = dev.cross, xtRate = fdm.vel.x * -ils.dir.z + fdm.vel.z * ils.dir.x;
  const corr = clamp(-(xt * 0.06 + xtRate * 1.9), -30, 30);
  let bankCmd = clamp(wrap180(ils.course + corr - track) * 1.8, -25, 25); if (fdm.ra < 15) bankCmd = clamp(bankCmd, -3, 3);
  const gamma = Math.asin(clamp(fdm.vel.y / V, -1, 1));
  let vsCmd; // m/s
  if (fdm.ra < 40 * FT) vsCmd = -clamp(fdm.ra * 0.25, 0.6, 4); // flare: sink rate shrinks with height
  else { const target = ils.elev + Math.max(0, dev.dist) * Math.tan(ils.gs * D2R); vsCmd = -gs * Math.tan(ils.gs * D2R) + clamp((target - fdm.pos.y) * 0.18, -3, 3); }
  const gCmd = Math.asin(clamp(vsCmd / V, -0.3, 0.3));
  return { roll: clamp(bankCmd - e.bank, -20, 20), pitch: clamp((gCmd - gamma) * R2D * 1.6, -10, 10), flare: fdm.ra < 40 * FT };
}

// One plain-language line for a hand-flown approach. dev from ilsDeviation, vtgt = target speed (kt)
export function coachLine(fdm, dev, vtgt, athr, pad) {
  const raFt = fdm.ra / FT;
  if (fdm.onGround) return { text: Math.hypot(fdm.vel.x, fdm.vel.z) / KT > 40 ? 'Keep it on the centreline · ' + (pad ? 'hold B to brake' : 'B to brake') : '', cls: 'good' };
  if (raFt < 35 && fdm.gearDown) return { text: raFt < 20 ? 'FLARE · thrust idle · hold it gently off' : 'FLARE · ' + (pad ? 'ease the left stick back gently' : 'ease the nose up gently'), cls: 'flare' };
  const parts = []; let worst = 0;
  const g = dev.gsDots; // + = below the path
  if (g > 0.7) { parts.push('Too low · raise the nose a little'); worst = 2; } else if (g > 0.25) { parts.push('A bit low'); worst = Math.max(worst, 1); }
  else if (g < -0.7) { parts.push('Too high · lower the nose a little'); worst = 2; } else if (g < -0.25) { parts.push('A bit high'); worst = Math.max(worst, 1); } else parts.push('On the glide path');
  const l = dev.locDots; // - = the runway centreline is to the left
  if (Math.abs(l) > 0.25) { parts.push((l < 0 ? 'steer left' : 'steer right') + (Math.abs(l) > 1 ? ' now' : ' a little')); worst = Math.max(worst, Math.abs(l) > 1 ? 2 : 1); }
  const ias = fdm.ias, dv = ias - vtgt, trend = fdm.accel * 10;
  if (athr) parts.push('auto-speed ' + Math.round(vtgt) + ' kt');
  else if (dv > 10) { parts.push('fast · less thrust' + (trend > 3 ? ' (still speeding up)' : '')); worst = Math.max(worst, dv > 20 ? 2 : 1); }
  else if (dv < -4) { parts.push('slow · more thrust' + (trend < -3 ? ' (still slowing)' : '')); worst = Math.max(worst, dv < -10 ? 2 : 1); }
  else parts.push(trend > 4 ? 'speed rising · ease the thrust' : trend < -4 ? 'speed dropping · a little thrust' : 'speed good');
  return { text: parts.join(' · '), cls: worst === 0 ? 'good' : worst === 1 ? 'warn' : 'bad' };
}
