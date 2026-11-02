// Foxheart narrow-body: the hull definition shared by the exterior, the livery painter and the cabin.
// Body frame: x = right wing, y = up, z = aft (nose at -z). Section at z: crown `top`, keel `bot`, half-width `w`,
// widest-line height `ym`; theta = 0 at the crown, PI/2 on the right side, PI under the keel, 3PI/2 on the left.
import * as THREE from 'three';
import { pchip } from './ac-util.js';

export const NOSE_Z = -18.6, TAIL_Z = 19.0, HULL_L = TAIL_Z - NOSE_Z;
const N = d => d + NOSE_Z;
const TOP = pchip([[N(0), -0.38], [N(0.03), -0.2], [N(0.15), 0.08], [N(0.4), 0.42], [N(0.8), 0.78], [N(1.3), 1.1], [N(1.8), 1.36], [N(2.4), 1.63], [N(3.0), 1.85], [N(3.8), 1.98], [N(5.0), 2.045], [N(6.5), 2.06], [9.5, 2.06], [11.5, 2.02], [13.5, 1.92], [15.5, 1.76], [17.5, 1.55], [18.6, 1.4], [TAIL_Z, 1.3]]);
const BOT = pchip([[N(0), -0.38], [N(0.03), -0.56], [N(0.15), -0.78], [N(0.4), -1.02], [N(0.8), -1.3], [N(1.3), -1.53], [N(2.0), -1.75], [N(3.0), -1.92], [N(4.2), -2.02], [N(5.5), -2.06], [3.5, -2.06], [5.5, -2.0], [7.5, -1.82], [9.5, -1.55], [11.5, -1.22], [13.5, -0.82], [15.5, -0.38], [17.5, 0.12], [18.6, 0.55], [TAIL_Z, 0.8]]);
const WID = pchip([[N(0), 0], [N(0.03), 0.2], [N(0.15), 0.43], [N(0.4), 0.69], [N(0.8), 0.98], [N(1.3), 1.24], [N(2.0), 1.5], [N(3.0), 1.74], [N(4.2), 1.9], [N(5.5), 1.965], [N(7.2), 1.98], [6.5, 1.98], [9.5, 1.94], [11.5, 1.85], [13.5, 1.65], [15.5, 1.3], [17.5, 0.8], [18.6, 0.45], [TAIL_Z, 0.28]]);
const YM = pchip([[N(0), -0.38], [N(0.4), -0.3], [N(1.3), -0.2], [N(3.0), -0.08], [N(5.0), -0.02], [N(7.2), 0], [5.0, 0], [9.5, 0.12], [11.5, 0.3], [13.5, 0.55], [15.5, 0.78], [17.5, 0.95], [TAIL_Z, 1.05]]);
export function SEC(z) { const top = TOP(z), bot = BOT(z); const ym = Math.min(top - 0.04, Math.max(bot + 0.04, YM(z))); return { top, bot, w: Math.max(0, WID(z)), ym }; }
export function hullPoint(z, th, out = new THREE.Vector3(), s = SEC(z)) {
  const c = Math.cos(th); return out.set(s.w * Math.sin(th), s.ym + (c >= 0 ? s.top - s.ym : s.ym - s.bot) * c, z);
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
export function hullNormal(z, th, out = new THREE.Vector3()) {
  const e = 1e-3, zz = Math.min(TAIL_Z - 2e-3, Math.max(NOSE_Z + 0.02, z));
  hullPoint(zz + e, th, _a); hullPoint(zz - e, th, _b); hullPoint(zz, th + e, _c); hullPoint(zz, th - e, _d);
  return out.crossVectors(_a.sub(_b), _c.sub(_d)).normalize();
}
// theta of the hull point at height y on the given side (+1 right, -1 left)
export function thetaAt(z, y, side, s = SEC(z)) {
  const c = y >= s.ym ? (y - s.ym) / (s.top - s.ym) : (y - s.ym) / (s.ym - s.bot); const t = Math.acos(Math.max(-1, Math.min(1, c)));
  return side > 0 ? t : Math.PI * 2 - t;
}
// half-width of the hull at height y (0 outside the section)
export function halfWidth(z, y, s = SEC(z)) { const c = y >= s.ym ? (y - s.ym) / (s.top - s.ym) : (y - s.ym) / (s.ym - s.bot); return Math.abs(c) >= 1 ? 0 : s.w * Math.sqrt(1 - c * c); }
export function insideHull(p, pad = 0) { const s = SEC(p.z); if (s.w <= 0) return false; const hy = p.y >= s.ym ? s.top - s.ym : s.ym - s.bot; return (p.x / (s.w + pad)) ** 2 + ((p.y - s.ym) / (hy + pad)) ** 2 < 1; }

// ------------------------------------------------------------------ cabin windows, doors
export const FLOOR_Y = -0.55, WIN_Y = 0.40, WIN_PITCH = 0.535;
export const WINDOWS = []; // { z, side, exit }
for (let k = -21; k <= 19; k++) { const z = 0.2675 + k * WIN_PITCH; for (const side of [1, -1]) WINDOWS.push({ z, side, exit: k === -1 || k === 0, i: WINDOWS.length }); }
// passenger doors (centre z, side), plug doors 0.81 x 1.85 m with 0.18 m corners; L1 is the working one
export const DOOR = { w: 0.81, h: 1.85, r: 0.18, y0: FLOOR_Y, y1: FLOOR_Y + 1.85 };
export const DOORS = [{ id: 'L1', z: -13.0, side: -1 }, { id: 'R1', z: -13.0, side: 1 }, { id: 'L2', z: 11.6, side: -1 }, { id: 'R2', z: 11.6, side: 1 }];
export const EXITS = WINDOWS.filter(w => w.exit).map(w => ({ z: w.z, side: w.side, w: 0.51, h: 0.96, r: 0.12 }));
// main-gear stow position (wheel well in the belly fairing) and fairing envelope, shared by gear + body
export const GEAR = { mainX: 3.8, mainZ: 1.25, hingeY: -0.95, wheelR: 0.58, wheelW: 0.42, track: 0.39, retract: 86 * Math.PI / 180, noseZ: -12.9, noseHingeY: -1.25, noseR: 0.38, noseW: 0.28 };
