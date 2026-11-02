// Foxheart livery and surface detail, painted procedurally: colour + height (-> normal) + ORM (ao, roughness, metal)
// for the fuselage, fin, wings, winglets, nacelles and spinners. Everything is generic (no real airline marks).
import * as THREE from 'three';
import { canvas, tex, heightToNormal, roundRect, rng, clamp } from './ac-util.js';
import { NOSE_Z, HULL_L, SEC, thetaAt, WINDOWS, DOORS, DOOR, EXITS, WIN_Y } from './ac-shape.js';

export function foxHeart(c, x, y, s, light = false) {
  // heart with fox ears; s = half-size
  c.save(); c.translate(x, y); c.scale(s / 32, s / 32); c.translate(-32, -30);
  const g = c.createLinearGradient(0, 0, 64, 64); g.addColorStop(0, '#ffc583'); g.addColorStop(1, '#e2672a');
  c.fillStyle = g; c.beginPath();
  c.moveTo(32, 56); c.bezierCurveTo(18, 46, 6, 37, 6, 23); c.bezierCurveTo(6, 15, 11, 9, 18, 9); c.lineTo(14, 1); c.lineTo(25, 8); c.bezierCurveTo(28, 9, 30, 11, 32, 14);
  c.bezierCurveTo(34, 11, 36, 9, 39, 8); c.lineTo(50, 1); c.lineTo(46, 9); c.bezierCurveTo(53, 9, 58, 15, 58, 23); c.bezierCurveTo(58, 37, 46, 46, 32, 56); c.closePath(); c.fill();
  c.fillStyle = light ? '#1b2747' : '#fff'; c.globalAlpha = 0.95; c.beginPath(); c.moveTo(32, 47); c.bezierCurveTo(25, 41, 18, 35, 18, 27); c.bezierCurveTo(21, 30, 26, 31, 32, 36); c.bezierCurveTo(38, 31, 43, 30, 46, 27); c.bezierCurveTo(46, 35, 39, 41, 32, 47); c.fill();
  c.globalAlpha = 1; c.fillStyle = '#1a0d03'; c.beginPath(); c.arc(24, 23, 2.4, 0, 7); c.arc(40, 23, 2.4, 0, 7); c.fill();
  c.restore();
}
const NAVY = '#1b2747';
// three layers painted together
class Layers {
  constructor(w, h, base = '#eef0f1', rough = 0.32) {
    this.w = w; this.h = h; const a = canvas(w, h), b = canvas(w, h), o = canvas(w, h); this.C = a.c; this.H = b.c; this.O = o.c; this.cv = { C: a.cv, H: b.cv, O: o.cv };
    this.C.fillStyle = base; this.C.fillRect(0, 0, w, h); this.H.fillStyle = 'rgb(128,128,128)'; this.H.fillRect(0, 0, w, h); this.O.fillStyle = `rgb(255,${Math.round(rough * 255)},0)`; this.O.fillRect(0, 0, w, h);
  }
  // groove (panel joint): darker colour line, lower height, AO + roughness
  groove(path, wpx = 1.6, depth = 70, colA = 0.16) {
    const { C, H, O } = this; for (const [ctx, st, lw] of [[H, `rgb(${128 - depth},${128 - depth},${128 - depth})`, wpx * 1.4], [C, `rgba(30,38,48,${colA})`, wpx], [O, 'rgba(150,190,0,0.7)', wpx * 1.6]]) { ctx.save(); ctx.strokeStyle = st; ctx.lineWidth = lw; path(ctx); ctx.stroke(); ctx.restore(); }
  }
  rivets(pts, r = 1.1, up = 26) { const { H, O } = this; H.fillStyle = `rgb(${128 + up},${128 + up},${128 + up})`; O.fillStyle = 'rgba(235,110,0,0.5)'; for (const [x, y] of pts) { H.fillRect(x - r / 2, y - r / 2, r, r); } }
  done(strength = 2.4, wrap = true) { return { map: tex(this.cv.C), normalMap: tex(heightToNormal(this.cv.H, strength, wrap), { srgb: false }), orm: tex(this.cv.O, { srgb: false }) }; }
}

// ------------------------------------------------------------------ fuselage
export function fuselageMaps(W = 4096) {
  const H = W / 2, L = new Layers(W, H, '#eef0f1', 0.3); const { C, H: Hc, O } = L; const R = rng(7);
  const X = z => (z - NOSE_Z) / HULL_L * W, Yt = th => th / (Math.PI * 2) * H, Yd = d => d / 360 * H;
  const pxZ = W / HULL_L, pxT = H / (Math.PI * 2 * 2.02), K = H / 1024; // px per metre along / around (mid section)
  // subtle large-scale tone variation of the white paint
  for (let i = 0; i < 26; i++) { const x = R() * W, y = R() * H, r = (0.15 + R() * 0.3) * H; const g = C.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${R() < 0.5 ? '210,214,220' : '255,252,246'},0.10)`); g.addColorStop(1, 'rgba(255,255,255,0)'); C.fillStyle = g; C.fillRect(0, 0, W, H); }
  // fox swoosh: widens toward the tail and wraps under the belly; navy core; white pinstripes
  const sw = x => { const t = x / W; return (70 + 360 * Math.pow(Math.max(0, t - 0.12) / 0.88, 1.6)) * K; };
  const band = (f, fill, ctx = C) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(0, H / 2 - f(0)); for (let x = 0; x <= W; x += 8) ctx.lineTo(x, H / 2 - f(x)); for (let x = W; x >= 0; x -= 8) ctx.lineTo(x, H / 2 + f(x)); ctx.closePath(); ctx.fill(); };
  const grad = C.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, '#f7b46a'); grad.addColorStop(0.55, '#f08a3e'); grad.addColorStop(1, '#e2602a');
  band(sw, grad); band(sw, 'rgb(255,76,0)', O);
  C.strokeStyle = '#ffffff'; C.lineWidth = 6 * K; for (const s of [-1, 1]) { C.beginPath(); for (let x = 0; x <= W; x += 8) { const y = H / 2 + s * (sw(x) + 9 * K); x ? C.lineTo(x, y) : C.moveTo(x, y); } C.stroke(); }
  const w2 = x => sw(x) * 0.52 + 18 * K; band(w2, NAVY);
  // titles (true proportions: squash x by the along/around pixel ratio), badge, registration
  const asp = pxZ / pxT;
  const side = (fn, th, z, flipX, flipY) => { C.save(); C.translate(X(z), Yt(th)); C.scale((flipX ? -1 : 1) * asp, flipY ? -1 : 1); fn(C); C.restore(); };
  const title = c => { const f = Math.round(0.78 * pxT); c.textBaseline = 'middle'; c.textAlign = 'center'; c.fillStyle = NAVY; c.font = `700 ${f}px "Saira Condensed", "Arial Narrow", sans-serif`; c.fillText('NICOFOXHEART', -0.9 * pxT, 0); const w = c.measureText('NICOFOXHEART').width; c.fillStyle = '#e8732f'; c.font = `300 ${f}px "Saira Condensed", "Arial Narrow", sans-serif`; c.textAlign = 'left'; c.fillText('AIR', -0.9 * pxT + w / 2 + 0.18 * pxT, 0); };
  const thT = Math.acos(1.12 / 2.06);
  side(title, thT, -6.6, true, false); side(title, Math.PI * 2 - thT, -6.6, false, true);
  for (const [th, fx, fy] of [[thT, true, false], [Math.PI * 2 - thT, false, true]]) side(c => foxHeart(c, 0, 0, 0.42 * pxT), th, -14.75, fx, fy);
  const reg = c => { c.fillStyle = '#5c6474'; c.font = `600 ${Math.round(0.26 * pxT)}px "B612 Mono", monospace`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('N-FOX7H', 0, 0); };
  side(reg, Math.acos(0.9 / 2.0), 15.2, true, false); side(reg, Math.PI * 2 - Math.acos(0.9 / 2.0), 15.2, false, true);
  // ---- structure: frames (rivet rows), butt joints, lap joints, stringer rivets
  const rv = [], frameZ = []; for (let z = -16.0; z < 18.6; z += 0.535) frameZ.push(z);
  for (const z of frameZ) { const x = X(z); for (let y = 2; y < H; y += 3.2 * K) rv.push([x, y]); }
  for (let k = 0; k < frameZ.length; k += 4) { const x = X(frameZ[k]) + 0.12 * pxZ; L.groove(c => { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); }, 1.4 * K, 55, 0.09); for (let y = 2; y < H; y += 3.2 * K) rv.push([x - 2.4 * K, y], [x + 2.4 * K, y]); }
  for (const d of [36, 128, 232, 324]) { const y = Yd(d); L.groove(c => { c.beginPath(); c.moveTo(X(-16.6), y); c.lineTo(X(18.4), y); }, 1.4 * K, 50, 0.08); for (let x = X(-16.6); x < X(18.4); x += 3.2 * K) rv.push([x, y - 2.4 * K], [x, y + 2.4 * K]); }
  for (let d = 7.5; d < 360; d += 15) { const y = Yd(d); for (let x = X(-16.4); x < X(18.2); x += 5 * K) rv.push([x, y]); }
  // radome joint, tail-cone joint
  L.groove(c => { c.beginPath(); c.moveTo(X(-16.75), 0); c.lineTo(X(-16.75), H); }, 1.8 * K, 70, 0.18);
  L.groove(c => { c.beginPath(); c.moveTo(X(17.6), 0); c.lineTo(X(17.6), H); }, 1.6 * K, 60, 0.12);
  // window doublers: rivet ring around each window
  for (const w of WINDOWS) { const x = X(w.z), y = Yt(thetaAt(w.z, WIN_Y, w.side)); for (let a = 0; a < 26; a++) { const t = a / 26 * Math.PI * 2; rv.push([x + Math.cos(t) * 0.2 * pxZ, y + Math.sin(t) * 0.26 * pxT]); } }
  L.rivets(rv, 1.15 * K, 22);
  // ---- doors, exits, hatches
  const outline = (zc, side, y0, y1, w, r, o = {}) => { // rounded rect on the side; returns canvas rect
    const ya = Yt(thetaAt(zc, y1, side)), yb = Yt(thetaAt(zc, y0, side)); const top = Math.min(ya, yb), hh = Math.abs(yb - ya), x = X(zc - w / 2), ww = w * pxZ;
    L.groove(c => roundRect(c, x, top, ww, hh, r * pxZ), (o.gap || 2.2) * K, o.depth || 95, o.alpha ?? 0.42);
    if (o.red) { C.save(); C.strokeStyle = 'rgba(200,40,30,0.85)'; C.lineWidth = 3 * K; roundRect(C, x - 0.05 * pxZ, top - 0.05 * pxT, ww + 0.1 * pxZ, hh + 0.1 * pxT, (r + 0.05) * pxZ); C.stroke(); C.restore(); }
    return { x, y: top, w: ww, h: hh };
  };
  for (const d of DOORS) {
    const b = outline(d.z, d.side, DOOR.y0, DOOR.y1, DOOR.w, DOOR.r);
    // handle recess, viewport, arming placard, slide warning stripe
    const hx = b.x + b.w * 0.5, yC = b.y + b.h * 0.5; const fy = d.side > 0 ? 1 : -1; // canvas down = aircraft down on the right, up on the left
    L.groove(c => roundRect(c, hx - 0.16 * pxZ, yC + fy * 0.05 * pxT - 0.04 * pxT, 0.32 * pxZ, 0.08 * pxT, 0.03 * pxZ), 1.3 * K, 60, 0.3);
    C.fillStyle = '#20262e'; C.beginPath(); C.ellipse(hx, yC - fy * 0.42 * pxT, 0.07 * pxZ, 0.07 * pxT, 0, 0, 7); C.fill(); L.groove(c => { c.beginPath(); c.ellipse(hx, yC - fy * 0.42 * pxT, 0.085 * pxZ, 0.085 * pxT, 0, 0, 7); }, 1.2 * K, 40, 0.25);
    O.fillStyle = 'rgb(255,20,0)'; O.beginPath(); O.ellipse(hx, yC - fy * 0.42 * pxT, 0.07 * pxZ, 0.07 * pxT, 0, 0, 7); O.fill();
    C.fillStyle = 'rgba(220,60,40,0.85)'; C.fillRect(hx - 0.2 * pxZ, yC + fy * 0.25 * pxT, 0.4 * pxZ, 0.035 * pxT);
    C.fillStyle = 'rgba(30,40,55,0.6)'; for (let k = 0; k < 3; k++) C.fillRect(hx - 0.12 * pxZ, yC + fy * (0.33 + k * 0.05) * pxT, 0.24 * pxZ, 0.012 * pxT);
    // scuffs around the forward doors (stairs, bridge)
    if (d.z < 0) { C.save(); C.globalAlpha = 0.18; C.strokeStyle = '#8f949a'; C.lineWidth = 1; for (let k = 0; k < 60; k++) { const x = b.x + (R() - 0.2) * b.w * 1.4, y = b.y + b.h * (d.side > 0 ? 0.7 + R() * 0.35 : -0.05 + R() * 0.35); C.beginPath(); C.moveTo(x, y); C.lineTo(x + (R() - 0.5) * 18 * K, y + (R() - 0.5) * 4 * K); C.stroke(); } C.restore(); }
  }
  for (const e of EXITS) { const b = outline(e.z, e.side, WIN_Y - 0.55, WIN_Y + 0.41, e.w, e.r, { red: true, gap: 1.8 }); const fy = e.side > 0 ? 1 : -1; C.fillStyle = 'rgba(200,40,30,0.9)'; C.fillRect(b.x + b.w * 0.25, b.y + b.h * 0.5 - fy * 0.3 * pxT, b.w * 0.5, 0.05 * pxT); }
  // cargo doors (right, lower), bulk door, avionics hatch, service panels
  const lowRect = (z0, z1, d0, d1, r = 0.1, o = {}) => L.groove(c => roundRect(c, X(z0), Yd(d0), X(z1) - X(z0), Yd(d1) - Yd(d0), r * pxZ), (o.gap || 1.8) * K, o.depth || 85, o.alpha ?? 0.35);
  lowRect(-9.0, -7.2, 112, 150); lowRect(6.0, 7.8, 114, 150); lowRect(9.3, 10.1, 120, 146, 0.08); lowRect(-15.7, -14.9, 168, 192, 0.06);
  lowRect(-16.3, -15.9, 118, 128, 0.03); lowRect(-15.5, -15.15, 236, 246, 0.03); lowRect(12.8, 13.2, 205, 215, 0.03); lowRect(14.0, 14.35, 150, 158, 0.03); lowRect(-11.6, -11.25, 200, 207, 0.03);
  for (let i = 0; i < 26; i++) { const z = -12 + R() * 24, d = 150 + R() * 60, wz = 0.18 + R() * 0.3, wd = 2 + R() * 4; if (Math.abs(z - 1) < 6) continue; lowRect(z, z + wz, d, d + wd, 0.02, { gap: 1.2, depth: 55, alpha: 0.22 }); }
  // static ports (grey "keep clean" patches) and the APU air inlet
  for (const d of [96, 264]) { C.fillStyle = 'rgba(150,156,164,0.55)'; C.beginPath(); C.ellipse(X(-15.2), Yd(d), 0.1 * pxZ, 0.1 * pxT, 0, 0, 7); C.fill(); C.fillStyle = '#3a4048'; for (const k of [-1, 1]) { C.beginPath(); C.arc(X(-15.2) + k * 0.03 * pxZ, Yd(d), 1.8 * K, 0, 7); C.fill(); } C.strokeStyle = 'rgba(200,40,30,0.8)'; C.lineWidth = 2 * K; C.beginPath(); C.ellipse(X(-15.2), Yd(d), 0.13 * pxZ, 0.13 * pxT, 0, 0, 7); C.stroke(); }
  lowRect(15.6, 16.2, 62, 72, 0.05); C.fillStyle = 'rgba(25,30,36,0.85)'; C.fillRect(X(15.65), Yd(63), X(16.15) - X(15.65), Yd(71) - Yd(63));
  // nose gear bay (seen when the doors open)
  C.fillStyle = '#2c3138'; C.fillRect(X(-14.7), Yd(170), X(-12.2) - X(-14.7), Yd(190) - Yd(170)); O.fillStyle = 'rgb(120,200,0)'; O.fillRect(X(-14.7), Yd(170), X(-12.2) - X(-14.7), Yd(190) - Yd(170));
  // ---- weathering: belly grime aft of the wing, streaks from doors/drains, wing-root stains, APU soot
  const streak = (x, y, len, dir, a, wdt) => { const g = C.createLinearGradient(x, y, x + len, y + dir * len * 0.25); g.addColorStop(0, `rgba(70,62,52,${a})`); g.addColorStop(1, 'rgba(70,62,52,0)'); C.save(); C.strokeStyle = g; C.lineWidth = wdt; C.beginPath(); C.moveTo(x, y); C.bezierCurveTo(x + len * 0.3, y + dir * len * 0.08, x + len * 0.7, y + dir * len * 0.2, x + len, y + dir * len * 0.26); C.stroke(); C.restore(); };
  for (let i = 0; i < 140; i++) { const z = -4 + R() * 21, d = 150 + R() * 60; streak(X(z), Yd(d), (0.8 + R() * 3) * pxZ, d < 180 ? 1 : -1, 0.05 + R() * 0.07, (2 + R() * 6) * K); }
  for (const d of DOORS) for (const k of [0.1, 0.9]) { const y = Yt(thetaAt(d.z, DOOR.y0 + 0.1, d.side)); streak(X(d.z - DOOR.w / 2 + k * DOOR.w), y, 1.6 * pxZ, d.side > 0 ? 1 : -1, 0.07, 2.2 * K); }
  { const g = C.createLinearGradient(0, Yd(140), 0, Yd(180)); g.addColorStop(0, 'rgba(60,55,48,0)'); g.addColorStop(1, 'rgba(60,55,48,0.12)'); C.fillStyle = g; C.fillRect(X(-2), Yd(140), X(17) - X(-2), Yd(40)); const g2 = C.createLinearGradient(0, Yd(180), 0, Yd(220)); g2.addColorStop(0, 'rgba(60,55,48,0.12)'); g2.addColorStop(1, 'rgba(60,55,48,0)'); C.fillStyle = g2; C.fillRect(X(-2), Yd(180), X(17) - X(-2), Yd(40)); }
  { const g = C.createLinearGradient(X(17.4), 0, X(19), 0); g.addColorStop(0, 'rgba(30,28,26,0)'); g.addColorStop(1, 'rgba(30,28,26,0.55)'); C.fillStyle = g; C.fillRect(X(17.4), 0, X(19) - X(17.4), H); O.fillStyle = g; }
  { const g = O.createLinearGradient(X(17.4), 0, X(19), 0); g.addColorStop(0, 'rgba(230,140,0,0)'); g.addColorStop(1, 'rgba(200,215,0,0.8)'); O.fillStyle = g; O.fillRect(X(17.4), 0, X(19) - X(17.4), H); }
  { O.save(); O.globalAlpha = 0.5; const g = O.createLinearGradient(0, Yd(140), 0, Yd(220)); g.addColorStop(0, 'rgba(255,90,0,0)'); g.addColorStop(0.5, 'rgb(240,140,0)'); g.addColorStop(1, 'rgba(255,90,0,0)'); O.fillStyle = g; O.fillRect(X(-2), Yd(140), X(17) - X(-2), Yd(80)); O.restore(); }
  // fine orange-peel / dirt noise in height + colour
  Hc.save(); for (let i = 0; i < W * H / 60; i++) { const v = 128 + ((R() - 0.5) * 10) | 0; Hc.fillStyle = `rgb(${v},${v},${v})`; Hc.fillRect(R() * W, R() * H, 2, 2); } Hc.restore();
  C.save(); C.globalAlpha = 0.035; for (let i = 0; i < 9000; i++) { C.fillStyle = R() < 0.5 ? '#6f6a60' : '#ffffff'; C.fillRect(R() * W, R() * H, 2 + R() * 6, 1 + R() * 3); } C.restore();
  return L.done(2.2, true);
}

// ------------------------------------------------------------------ fin (+ rudder): u = chord, v split (top half = right side)
export function finMaps(S = 1024) {
  const W = S, H = S * 2, L = new Layers(W, H, NAVY, 0.3); const { C, O } = L;
  for (const half of [0, 1]) {
    C.save(); C.translate(0, half * S); C.beginPath(); C.rect(0, 0, W, S); C.clip(); O.save(); O.translate(0, half * S);
    const g = C.createLinearGradient(0, S, W * 0.6, 0); g.addColorStop(0, '#18223e'); g.addColorStop(1, '#25365e'); C.fillStyle = g; C.fillRect(0, 0, W, S);
    const k = S / 512; const g2 = C.createLinearGradient(0, S, W, 0); g2.addColorStop(0, '#f7b46a'); g2.addColorStop(1, '#e2602a');
    C.fillStyle = g2; C.beginPath(); C.moveTo(0, S); C.lineTo(W, S); C.lineTo(W, 120 * k); C.bezierCurveTo(380 * k, 260 * k, 200 * k, 420 * k, 0, 470 * k); C.closePath(); C.fill();
    C.strokeStyle = '#fff'; C.lineWidth = 7 * k; C.beginPath(); C.moveTo(W, 104 * k); C.bezierCurveTo(380 * k, 244 * k, 200 * k, 404 * k, 0, 454 * k); C.stroke();
    foxHeart(C, 240 * k, 250 * k, 100 * k);
    // leading-edge erosion strip, spars, ribs, rivets
    C.fillStyle = 'rgba(190,196,204,0.55)'; C.fillRect(0, 0, 0.018 * W, S); O.fillStyle = 'rgb(255,70,200)'; O.fillRect(0, 0, 0.018 * W, S);
    O.restore(); C.restore();
    const y0 = half * S;
    for (const c of [0.15, 0.62]) L.groove(x => { x.beginPath(); x.moveTo(c * W, y0); x.lineTo(c * W, y0 + S); }, 1.4, 50, 0.12);
    for (let s = 0.08; s < 1; s += 0.075) { const y = y0 + (1 - s) * S; L.groove(x => { x.beginPath(); x.moveTo(0.02 * W, y); x.lineTo(0.68 * W, y); }, 1.1, 40, 0.08); }
    const rv = []; for (let s = 0.04; s < 1; s += 0.075) for (let x = 0.03 * W; x < 0.66 * W; x += 4) rv.push([x, y0 + (1 - s) * S]); for (const c of [0.14, 0.16, 0.61, 0.63]) for (let y = y0; y < y0 + S; y += 4) rv.push([c * W, y]); L.rivets(rv, 1.2, 20);
  }
  return L.done(2.0, false);
}
// sharklet: navy with an orange tip; the outboard half carries a small fox heart
export function wingletMaps(S = 512) {
  const L = new Layers(S, S * 2, NAVY, 0.3); const { C } = L;
  for (const half of [0, 1]) { const y0 = half * S; const g = C.createLinearGradient(0, y0 + S, 0, y0); g.addColorStop(0, '#1b2747'); g.addColorStop(0.55, '#24365e'); g.addColorStop(0.8, '#e2702e'); g.addColorStop(1, '#f7b46a'); C.fillStyle = g; C.fillRect(0, y0, S, S); if (half === 0) foxHeart(C, S * 0.42, y0 + S * 0.55, S * 0.16); }
  return L.done(1.5, false);
}

// ------------------------------------------------------------------ wing / stabiliser: u = chord (0 LE), v split (top half = upper surface)
export function wingMaps(S = 2048) {
  const W = S, H = S, L = new Layers(W, H, '#c9cdd2', 0.42); const { C, O } = L; const R = rng(11);
  const half = H / 2, Yu = s => (1 - s) * half, Yl = s => half + (1 - s) * half;
  // metal leading edge (slats) on both surfaces
  for (const [y0] of [[0], [half]]) { const g = C.createLinearGradient(0, 0, 0.12 * W, 0); g.addColorStop(0, '#eef1f4'); g.addColorStop(0.7, '#cfd5db'); g.addColorStop(1, '#b8bfc7'); C.fillStyle = g; C.fillRect(0, y0, 0.12 * W, half); O.fillStyle = 'rgb(255,58,235)'; O.fillRect(0, y0, 0.12 * W, half); }
  // slightly darker trailing-edge devices, subtle paint mottling
  C.fillStyle = 'rgba(90,96,104,0.10)'; C.fillRect(0.74 * W, 0, 0.26 * W, H);
  C.save(); C.globalAlpha = 0.05; for (let i = 0; i < 4000; i++) { C.fillStyle = R() < 0.5 ? '#8a9098' : '#ffffff'; C.fillRect(0.12 * W + R() * 0.88 * W, R() * H, 3 + R() * 12, 1 + R() * 5); } C.restore();
  // spars, ribs, rivets, both halves
  const rv = [];
  for (const yOf of [Yu, Yl]) {
    for (const c of [0.13, 0.62]) { L.groove(x => { x.beginPath(); x.moveTo(c * W, yOf(1)); x.lineTo(c * W, yOf(0)); }, 1.3, 50, 0.1); for (let y = yOf(1); y < yOf(0); y += 3.5) rv.push([c * W - 3, y], [c * W + 3, y]); }
    for (let s = 0.03; s < 1; s += 0.045) { const y = yOf(s); for (let x = 0.13 * W; x < 0.74 * W; x += 3.5) rv.push([x, y]); }
    for (let s = 0.09; s < 1; s += 0.18) L.groove(x => { x.beginPath(); x.moveTo(0.13 * W, yOf(s)); x.lineTo(0.74 * W, yOf(s)); }, 1.2, 45, 0.08);
  }
  // upper surface: walkway near the root, NO STEP markings, fuel caps
  C.fillStyle = '#5d636b'; C.fillRect(0.2 * W, Yu(0.13), 0.34 * W, Yu(0.015) - Yu(0.13)); O.fillStyle = 'rgb(255,230,0)'; O.fillRect(0.2 * W, Yu(0.13), 0.34 * W, Yu(0.015) - Yu(0.13));
  C.strokeStyle = '#2c3036'; C.lineWidth = 3; C.strokeRect(0.2 * W, Yu(0.13), 0.34 * W, Yu(0.015) - Yu(0.13));
  C.fillStyle = 'rgba(40,44,50,0.75)'; C.font = `600 ${Math.round(S * 0.012)}px sans-serif`; C.textAlign = 'center';
  for (let s = 0.2; s < 0.9; s += 0.16) { C.save(); C.translate(0.5 * W, Yu(s)); C.rotate(-Math.PI / 2); C.fillText('NO STEP', 0, 0); C.restore(); }
  for (let s = 0.12; s < 0.92; s += 0.1) { C.save(); C.translate(0.8 * W, Yu(s)); C.rotate(-Math.PI / 2); C.fillStyle = 'rgba(40,44,50,0.55)'; C.fillText('NO STEP', 0, 0); C.restore(); }
  // lower surface: fuel-tank access panels (ovals), drains, NACA fuel vent near the tip
  for (let s = 0.08; s < 0.88; s += 0.045) { const cx = 0.38 * W, cy = Yl(s); L.groove(x => { x.beginPath(); x.ellipse(cx, cy, 0.035 * W, 0.009 * H, 0, 0, 7); }, 1.3, 60, 0.18); for (let a = 0; a < 14; a++) { const t = a / 14 * Math.PI * 2; rv.push([cx + Math.cos(t) * 0.04 * W, cy + Math.sin(t) * 0.0115 * H]); } }
  C.fillStyle = '#2d3238'; C.beginPath(); C.moveTo(0.42 * W, Yl(0.86)); C.lineTo(0.47 * W, Yl(0.855)); C.lineTo(0.47 * W, Yl(0.865)); C.closePath(); C.fill();
  // lower-surface grime behind the engine and gear
  C.save(); C.globalAlpha = 0.12; for (let i = 0; i < 160; i++) { C.fillStyle = '#4a4640'; const s = 0.05 + R() * 0.35; C.fillRect(0.3 * W + R() * 0.6 * W, Yl(s), 6 + R() * 40, 1 + R() * 3); } C.restore();
  L.rivets(rv, 1.3, 18);
  return L.done(2.2, false);
}

// ------------------------------------------------------------------ nacelle (latheZ uv: u around from the bottom, v = arc length)
// bands: v positions { lipIn, lipOut, cowl } of the inner duct end, the metal lip end and the fan-cowl end
export function nacelleMaps(bands, S = 1024) {
  const W = S, H = S / 2, L = new Layers(W, H, NAVY, 0.3); const { C, O } = L; const Y = v => (1 - v) * H;
  // inner duct: acoustic liner (dark grey, perforated)
  C.fillStyle = '#3b4048'; C.fillRect(0, Y(bands.lipIn), W, H - Y(bands.lipIn)); O.fillStyle = 'rgb(255,170,90)'; O.fillRect(0, Y(bands.lipIn), W, H - Y(bands.lipIn));
  C.fillStyle = 'rgba(20,22,26,0.5)'; for (let y = Y(bands.lipIn) + 2; y < H; y += 3) for (let x = (y | 0) % 6; x < W; x += 6) C.fillRect(x, y, 1, 1);
  // polished lip
  const g = C.createLinearGradient(0, Y(bands.lipOut), 0, Y(bands.lipIn)); g.addColorStop(0, '#c9cfd6'); g.addColorStop(0.5, '#f2f5f8'); g.addColorStop(1, '#b9c0c8'); C.fillStyle = g; C.fillRect(0, Y(bands.lipOut), W, Y(bands.lipIn) - Y(bands.lipOut)); O.fillStyle = 'rgb(255,45,255)'; O.fillRect(0, Y(bands.lipOut), W, Y(bands.lipIn) - Y(bands.lipOut));
  // orange accent ring behind the lip, fox hearts on both sides, panel lines + latches
  const yA = Y(bands.lipOut) - 0.035 * H; C.fillStyle = '#e8732f'; C.fillRect(0, yA - 0.02 * H, W, 0.02 * H);
  for (const u of [0.25, 0.75]) { C.save(); C.translate(u * W, Y((bands.lipOut + bands.cowl) / 2)); C.scale(1, 1.8); foxHeart(C, 0, 0, H * 0.06); C.restore(); }
  for (const u of [0.0, 0.5, 1.0]) L.groove(x => { x.beginPath(); x.moveTo(u * W, Y(bands.lipOut) - 2); x.lineTo(u * W, 0); }, 1.6, 70, 0.3);
  L.groove(x => { x.beginPath(); x.moveTo(0, Y(bands.cowl)); x.lineTo(W, Y(bands.cowl)); }, 2, 80, 0.35);
  L.groove(x => { x.beginPath(); x.moveTo(0, Y(bands.lipOut) - 1); x.lineTo(W, Y(bands.lipOut) - 1); }, 1.6, 60, 0.3);
  for (let k = 0; k < 4; k++) { const v = bands.lipOut + (bands.cowl - bands.lipOut) * (0.25 + k * 0.17); L.groove(x => roundRect(x, 0.02 * W, Y(v) - 6, 0.04 * W, 12, 3), 1.2, 60, 0.35); L.groove(x => roundRect(x, 0.94 * W, Y(v) - 6, 0.04 * W, 12, 3), 1.2, 60, 0.35); }
  // intake danger arc (red) on the lower outboard cowl
  for (const u of [0.18, 0.82]) { C.fillStyle = 'rgba(205,40,30,0.9)'; C.fillRect(u * W - 0.03 * W, Y(bands.lipOut) - 0.09 * H, 0.06 * W, 0.012 * H); }
  return L.done(1.8, true);
}
// spinner with a white swirl (u around, v along)
export function spinnerTex(S = 256) {
  const { cv, c } = canvas(S, S); const img = c.createImageData(S, S), D = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const u = x / S, v = 1 - y / S; const f = ((u * 2 + v * 1.35) % 1 + 1) % 1; const sw = v > 0.12 && (f < 0.05 || (f > 0.5 && f < 0.55)) ? 1 : 0; const sh = 40 + v * 14; const o = (y * S + x) * 4; const col = sw ? 236 : sh; D[o] = col; D[o + 1] = col; D[o + 2] = col + (sw ? 0 : 4); D[o + 3] = 255; }
  c.putImageData(img, 0, 0); return tex(cv);
}
// generic painted-panel tile (box-uv, metres): normal + ORM for fairings, pylons, doors
export function panelTile(S = 512, metres = 2) {
  const L = new Layers(S, S, '#ffffff', 0.36); const k = S / metres;
  for (const p of [0, 0.9]) { L.groove(x => { x.beginPath(); x.moveTo(p * k, 0); x.lineTo(p * k, S); }, 1.4, 55, 0.2); L.groove(x => { x.beginPath(); x.moveTo(0, p * k + 0.3 * k); x.lineTo(S, p * k + 0.3 * k); }, 1.4, 55, 0.2); }
  const rv = []; for (const p of [0.03, 0.87, 0.93]) for (let t = 0; t < S; t += 5) rv.push([p * k, t], [t, p * k + 0.3 * k]); L.rivets(rv, 1.4, 20);
  const m = L.done(2, true); for (const t of [m.map, m.normalMap, m.orm]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } return m;
}
