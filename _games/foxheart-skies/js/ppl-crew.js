// Flight deck crew: a seated pilot (white shirt, epaulettes, tie, headset) built from the HD people system,
// with idle life (breathing, blinks, looks at the instruments / outside / the other pilot or the camera),
// hands on the sidestick and armrest, and reach-and-press gestures for checklist actions.
// buildCopilot(opts) → { object3d, update(dt, ctx), gesture(name), setExposure(k), person, people }
//   opts: { seat: 'right' (default, first officer) | 'left' (captain), role, female, quality, seed }
//   object3d is in aircraft body-frame coordinates (add it to the aircraft / cockpit group).
//   update(dt, ctx): ctx.k (exposure scale, like crowd.setExposure) or ctx.exposure (sky exposure), ctx.camPos (aircraft-local Vector3, for LOD and "look at you").
//   gesture('overhead' | 'pedestal' | 'fcu' | 'glareshield'): reach, press and return (~1.8 s).
import * as THREE from 'three';
import { PeopleHD } from './ppl-core.js';

export const DECK_SEAT = { x: 0.56, hipY: 0.5, hipZ: -15.36 }; // flight deck seats (flightdeck.js: seat(±0.56), cushion top ~0.41)
const EYE = { right: new THREE.Vector3(-0.52, 1.2, -15.55), left: new THREE.Vector3(0.52, 1.2, -15.55) }; // default camera: the other pilot's eye
export function buildCopilot(opts = {}) {
  const side = opts.seat === 'left' ? -1 : 1, role = opts.role || (side > 0 ? 'fo-deck' : 'captain-deck');
  const g = new THREE.Group(); g.name = side > 0 ? 'copilot' : 'captain';
  let s = opts.seed ?? (side > 0 ? 424242 : 777001); const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const P = new PeopleHD(g, 1, rnd, { quality: opts.quality });
  const p = P.p[0]; p.age = 'adult'; if (opts.female != null) p.female = !!opts.female; if (p.hairStyle === 'none') p.hairStyle = 'short'; P.setCrew(0, role);
  Object.assign(p, { mode: 'pilot', act: 'pilot', pilotSide: side, x: side * DECK_SEAT.x, y: DECK_SEAT.hipY - 0.535 * p.scale, z: DECK_SEAT.hipZ + 0.025, yaw: Math.PI, stoop: 0 });
  const cam = EYE[side > 0 ? 'right' : 'left'].clone(); let t = 0;
  const api = {
    object3d: g, people: P, person: p,
    update(dt, ctx = {}) { t += Math.max(0, dt || 0);
      if (ctx.k != null) P.setExposure(ctx.k); else if (ctx.exposure) P.setExposure(Math.min(1.05, 0.5 / ctx.exposure));
      const cp = ctx.camPos || cam; p.lookAt = ctx.camPos ? [cp.x, cp.y, cp.z] : null; P.commit(t, cp); },
    gesture(name) { p._g = { name, t0: t }; return name; },
    setExposure(k) { P.setExposure(k); },
    dispose() { g.traverse(o => { if (o.geometry && o.geometry.isInstancedBufferGeometry) o.geometry.dispose(); }); },
  };
  api.update(0); return api;
}
