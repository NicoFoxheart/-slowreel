// Glass cockpit: PFD, ND, engine/warning display and gear/flap system display drawn on canvases,
// used both as textures in the 3D flight deck and as overlay panels in external views; plus the HUD.
import * as THREE from 'three';
import { atmos } from './sky.js';
import { FT, KT, D2R, R2D, fmtTime } from './data.js';
import { FLAPS } from './fdm.js';
import { ilsDeviation } from './airport.js';

const MONO = '"B612 Mono", "Consolas", monospace', SANS = '"B612", "Segoe UI", sans-serif';
const GRN = '#3dfc7c', CYAN = '#3ee6ff', AMB = '#ffb21e', MAG = '#ff5cff', WHT = '#f2f2f2', RED = '#ff3a2e', YEL = '#ffe600';
const wrap360 = a => ((a % 360) + 360) % 360;
function mk(n = 512) { const c = document.createElement('canvas'); c.width = c.height = n; return c; }

export class Displays {
  constructor() {
    this.pfd = mk(); this.nd = mk(); this.ewd = mk(); this.sd = mk();
    this.tex = {}; for (const k of ['pfd', 'nd', 'ewd', 'sd']) { const t = new THREE.CanvasTexture(this[k]); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; this.tex[k] = t; }
    this.frame = 0; this.ndRange = 20;
  }
  draw(S, which) { // S: snapshot of sim state
    const list = which || ['pfd', 'nd', 'ewd', 'sd'];
    for (const k of list) { const c = this[k].getContext('2d'); if (S.elecEmer && (k === 'nd' || k === 'sd')) { c.fillStyle = '#000'; c.fillRect(0, 0, this[k].width, this[k].height); } else this['draw_' + k](c, S); this.tex[k].needsUpdate = true; } // ND / SD unpowered in the electrical emergency configuration
  }
  // ------------------------------------------------ PFD
  draw_pfd(c, S) {
    const f = S.fdm, e = S.e; c.fillStyle = '#000'; c.fillRect(0, 0, 512, 512);
    const cx = 250, cy = 250, pp = 7.2; // px per degree
    // attitude
    c.save(); c.beginPath(); c.roundRect(138, 112, 224, 262, 18); c.clip();
    c.translate(cx, cy); c.rotate(-e.bank * D2R); c.translate(0, e.pitch * pp);
    c.fillStyle = '#2d7fd0'; c.fillRect(-400, -800, 800, 800); c.fillStyle = '#7a4a22'; c.fillRect(-400, 0, 800, 800);
    c.strokeStyle = WHT; c.lineWidth = 2; c.beginPath(); c.moveTo(-400, 0); c.lineTo(400, 0); c.stroke();
    c.font = `16px ${MONO}`; c.fillStyle = WHT; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let p = -30; p <= 30; p += 2.5) { if (!p) continue; const y = -p * pp; const big = p % 10 === 0, mid = p % 5 === 0; const w = big ? 46 : mid ? 26 : 10; c.beginPath(); c.moveTo(-w, y); c.lineTo(w, y); c.stroke(); if (big) { c.fillText(Math.abs(p), -w - 18, y); c.fillText(Math.abs(p), w + 18, y); } }
    c.restore();
    // bank scale
    c.save(); c.translate(cx, cy); c.strokeStyle = WHT; c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, 118, (-90 - 45) * D2R, (-90 + 45) * D2R); c.stroke();
    for (const a of [-45, -30, -20, -10, 0, 10, 20, 30, 45]) { c.save(); c.rotate(a * D2R); c.beginPath(); c.moveTo(0, -118); c.lineTo(0, a % 30 === 0 || a === 0 ? -132 : -126); c.stroke(); c.restore(); }
    c.fillStyle = YEL; c.beginPath(); c.moveTo(0, -116); c.lineTo(-9, -102); c.lineTo(9, -102); c.closePath(); c.fill();
    c.save(); c.rotate(-e.bank * D2R); c.fillStyle = YEL; c.beginPath(); c.moveTo(0, -114); c.lineTo(-10, -98); c.lineTo(10, -98); c.closePath(); c.fill();
    c.fillRect(-10 + Math.max(-20, Math.min(20, f.beta * R2D * 3)), -95, 20, 5); c.restore();
    // flight directors
    if (S.fd && S.fd.flare) { c.save(); c.font = `bold 22px ${MONO}`; c.fillStyle = (Date.now() / 300 | 0) % 2 ? YEL : GRN; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('FLARE', 0, 98); c.restore(); }
    if (S.fd) { c.strokeStyle = GRN; c.lineWidth = 3; const dx = Math.max(-80, Math.min(80, S.fd.roll * 4)), dy = Math.max(-80, Math.min(80, -S.fd.pitch * pp)); c.beginPath(); c.moveTo(dx, -70); c.lineTo(dx, 70); c.moveTo(-70, dy); c.lineTo(70, dy); c.stroke(); }
    // aircraft symbol
    c.fillStyle = '#000'; c.strokeStyle = YEL; c.lineWidth = 3;
    for (const s of [-1, 1]) { c.fillRect(s * 88 - (s > 0 ? 0 : 0) - 26 * (s < 0 ? 1 : 0), -4, 26, 8); c.strokeRect(s > 0 ? 62 : -88, -4, 26, 8); c.beginPath(); c.moveTo(s * 62, -4); c.lineTo(s * 40, -4); c.lineTo(s * 40, 14); c.stroke(); }
    c.fillRect(-5, -5, 10, 10); c.strokeRect(-5, -5, 10, 10);
    c.restore();
    // ILS deviation
    if (S.ilsDev && S.ilsDev.valid) {
      const d = S.ilsDev; c.fillStyle = WHT;
      for (let i = -2; i <= 2; i++) { if (!i) continue; c.beginPath(); c.arc(cx + i * 38, 392, 4, 0, 7); c.stroke(); c.beginPath(); c.arc(378, cy + i * 38, 4, 0, 7); c.strokeStyle = WHT; c.lineWidth = 2; c.stroke(); }
      c.fillStyle = YEL; c.fillRect(cx - 1, 384, 2, 16); c.fillRect(370, cy - 1, 16, 2);
      const dia = (x, y) => { c.fillStyle = MAG; c.beginPath(); c.moveTo(x, y - 9); c.lineTo(x + 7, y); c.lineTo(x, y + 9); c.lineTo(x - 7, y); c.closePath(); c.fill(); };
      dia(cx + d.locDots * 38, 392); dia(378, cy - d.gsDots * 38);
      c.font = `14px ${MONO}`; c.fillStyle = MAG; c.textAlign = 'left'; c.fillText(S.ils.apt.icao + ' ' + S.ils.ident, 146, 410); c.fillText(S.ils.freq.toFixed(2) + (S.ils.real ? '' : '*'), 146, 428);
      c.fillText((Math.max(0, d.thrDist) / 1852).toFixed(1) + ' NM', 146, 446);
    }
    // speed tape
    const ias = f.ias, sp = S.speeds; const tx = 30, tw = 80, ty = 112, th = 262, sc = 4.2;
    c.fillStyle = '#4a4f57'; c.fillRect(tx, ty, tw, th);
    c.save(); c.beginPath(); c.rect(tx, ty, tw + 20, th); c.clip();
    c.strokeStyle = WHT; c.fillStyle = WHT; c.lineWidth = 2; c.font = `19px ${MONO}`; c.textAlign = 'right';
    for (let v = Math.floor((ias - 40) / 5) * 5; v < ias + 40; v += 5) { if (v < 30) continue; const y = cy - (v - ias) * sc; c.beginPath(); c.moveTo(tx + tw - 12, y); c.lineTo(tx + tw, y); c.stroke(); if (v % 20 === 0) c.fillText(String(v).padStart(3, ' '), tx + tw - 16, y + 7); }
    // VLS amber, alpha-prot / stall barber, VMAX barber
    const yV = v => cy - (v - ias) * sc;
    c.fillStyle = AMB; c.fillRect(tx + tw - 4, yV(sp.vls), 4, Math.max(0, yV(sp.vls - 60) - yV(sp.vls)));
    const vmax = Math.min(sp.vfe, sp.vmo); c.fillStyle = RED; for (let v = vmax; v < vmax + 60; v += 4) c.fillRect(tx + tw - 7, yV(v + 2), 7, 4 * sc * 0.5);
    c.fillStyle = RED; for (let v = sp.vs1g * 1.03; v > sp.vs1g - 60; v -= 4) c.fillRect(tx + tw - 7, yV(v), 7, 4 * sc * 0.5);
    // target speed
    if (S.ap.athr || S.ap.on) { const y = yV(S.ap.spd); c.fillStyle = MAG; c.beginPath(); c.moveTo(tx + tw + 2, y); c.lineTo(tx + tw + 14, y - 8); c.lineTo(tx + tw + 14, y + 8); c.closePath(); c.fill(); }
    if (S.phase === 'takeoff') { c.fillStyle = CYAN; c.font = `14px ${MONO}`; c.textAlign = 'left'; for (const [n, v] of [['1', sp.v1], ['R', sp.vr]]) { const y = yV(v); c.fillText(n, tx + tw + 4, y + 5); } }
    // trend arrow
    const tr = f.accel * 10; if (Math.abs(tr) > 2) { c.strokeStyle = YEL; c.lineWidth = 2; c.beginPath(); c.moveTo(tx + tw + 6, cy); c.lineTo(tx + tw + 6, cy - tr * sc); c.stroke(); }
    c.restore();
    c.fillStyle = YEL; c.fillRect(tx - 4, cy - 2, 18, 4); c.beginPath(); c.moveTo(tx + tw, cy); c.lineTo(tx + tw + 12, cy - 8); c.lineTo(tx + tw + 12, cy + 8); c.closePath(); c.fill();
    c.font = `15px ${MONO}`; c.textAlign = 'center'; c.fillStyle = CYAN; if (!S.ap.athr) c.fillText(Math.round(S.ap.spd), tx + tw / 2, ty - 10);
    c.fillStyle = GRN; c.fillText('M.' + String(Math.round(f.mach * 1000)).padStart(3, '0').slice(0, 2), tx + tw / 2, ty + th + 20);
    // altitude tape
    const alt = S.altFt, ax = 400, aw = 70, as = 0.38;
    c.fillStyle = '#4a4f57'; c.fillRect(ax, ty, aw, th);
    c.save(); c.beginPath(); c.rect(ax, ty, aw, th); c.clip();
    c.strokeStyle = WHT; c.fillStyle = WHT; c.lineWidth = 2; c.font = `17px ${MONO}`; c.textAlign = 'left';
    for (let a = Math.floor((alt - 400) / 100) * 100; a < alt + 400; a += 100) { const y = cy - (a - alt) * as; c.beginPath(); c.moveTo(ax, y); c.lineTo(ax + 10, y); c.stroke(); if (a % 500 === 0) c.fillText(String(Math.round(a / 100)).padStart(3, ' '), ax + 14, y + 6); }
    // ground ribbon
    const gy = cy - (S.groundFt - alt) * as; if (gy < ty + th) { c.fillStyle = 'rgba(255,60,40,0.85)'; for (let y = gy; y < ty + th; y += 10) c.fillRect(ax, y, aw, 4); }
    c.restore();
    const sy = cy - (S.ap.alt - alt) * as; c.fillStyle = CYAN; if (sy > ty && sy < ty + th) c.fillRect(ax - 3, sy - 7, 8, 14);
    c.font = `16px ${MONO}`; c.textAlign = 'center'; c.fillStyle = CYAN; c.fillText(Math.round(S.ap.alt), ax + aw / 2, ty - 10);
    c.fillStyle = '#000'; c.strokeStyle = YEL; c.lineWidth = 2; c.fillRect(ax - 2, cy - 17, aw + 8, 34); c.strokeRect(ax - 2, cy - 17, aw + 8, 34);
    c.fillStyle = GRN; c.font = `bold 23px ${MONO}`; c.textAlign = 'right'; c.fillText(String(Math.round(alt / 20) * 20).padStart(5, ' '), ax + aw + 2, cy + 8);
    // vertical speed
    const vs = f.vel.y / FT * 60; const vx = 486; c.fillStyle = '#3a3f46'; c.fillRect(vx - 10, ty + 20, 26, th - 40);
    const vsy = v => cy - Math.sign(v) * Math.min(1, Math.sqrt(Math.abs(v) / 6000)) * (th / 2 - 26);
    c.strokeStyle = WHT; c.lineWidth = 1.5; for (const v of [-6000, -2000, -1000, 0, 1000, 2000, 6000]) { const y = vsy(v); c.beginPath(); c.moveTo(vx - 10, y); c.lineTo(vx - 2, y); c.stroke(); }
    c.strokeStyle = Math.abs(vs) > 6000 ? AMB : GRN; c.lineWidth = 3; c.beginPath(); c.moveTo(vx + 24, cy); c.lineTo(vx - 6, vsy(vs)); c.stroke();
    if (Math.abs(vs) > 200) { c.fillStyle = GRN; c.font = `14px ${MONO}`; c.textAlign = 'center'; c.fillText(String(Math.round(Math.abs(vs) / 100)).padStart(2, '0'), vx + 3, vs > 0 ? ty + 14 : ty + th - 4); }
    // heading tape
    const hdg = e.hdg; c.fillStyle = '#4a4f57'; c.fillRect(140, 450, 220, 42);
    c.save(); c.beginPath(); c.rect(140, 450, 220, 42); c.clip(); c.strokeStyle = WHT; c.fillStyle = WHT; c.font = `17px ${MONO}`; c.textAlign = 'center';
    for (let h = Math.floor(hdg / 5) * 5 - 30; h < hdg + 30; h += 5) { const x = cx - (wrap360(hdg - h + 180) - 180) * 4.4; c.beginPath(); c.moveTo(x, 450); c.lineTo(x, h % 10 === 0 ? 462 : 456); c.stroke(); if (h % 10 === 0) c.fillText(String(Math.round(wrap360(h) / 10)).padStart(2, '0'), x, 482); }
    const hb = cx - (wrap360(hdg - S.ap.hdg + 180) - 180) * 4.4; c.fillStyle = CYAN; c.fillRect(hb - 2, 450, 4, 14);
    const trk = cx - (wrap360(hdg - S.track + 180) - 180) * 4.4; c.strokeStyle = GRN; c.lineWidth = 2; c.beginPath(); c.moveTo(trk, 452); c.lineTo(trk + 6, 460); c.lineTo(trk, 468); c.lineTo(trk - 6, 460); c.closePath(); c.stroke();
    c.restore(); c.fillStyle = YEL; c.fillRect(cx - 1.5, 444, 3, 20);
    // radio altitude
    if (S.raFt < 2500 && !f.onGround) { c.font = `bold 22px ${MONO}`; c.textAlign = 'center'; c.fillStyle = S.raFt < 400 ? AMB : GRN; c.fillText(Math.round(S.raFt > 50 ? S.raFt / 10 * 10 : S.raFt), cx, 362); }
    // FMA
    const fm = f.fma(); c.fillStyle = '#000'; c.fillRect(0, 0, 512, 92); c.strokeStyle = '#666'; c.lineWidth = 1.5;
    for (const x of [110, 210, 310, 400]) { c.beginPath(); c.moveTo(x, 6); c.lineTo(x, 86); c.stroke(); }
    c.font = `bold 17px ${MONO}`; c.textAlign = 'center';
    const col = (t, x, y, k) => { if (!t) return; c.fillStyle = k; c.fillText(t, x, y); };
    col(fm.thr, 56, 28, fm.thr.includes('TOGA') || fm.thr === 'MAN THR' ? WHT : GRN); col(fm.vert, 160, 28, GRN); col(fm.lat, 260, 28, GRN);
    col(fm.arm, 210, 54, CYAN); col(fm.cat, 355, 28, WHT); col(fm.eng, 456, 28, WHT);
    if (S.ap.on || S.ap.athr) { c.strokeStyle = WHT; c.strokeRect(14, 10, 84, 26); }
    if (f.stall > 0.2) { c.fillStyle = RED; c.font = `bold 26px ${MONO}`; c.fillText('STALL', 250, 140); }
  }
  // ------------------------------------------------ ND
  draw_nd(c, S) {
    const f = S.fdm, e = S.e; c.fillStyle = '#000'; c.fillRect(0, 0, 512, 512);
    const cx = 256, cy = 430, R = 330; const range = S.ndRange || 20; const sc = R / (range * 1852);
    const h = e.hdg * D2R, cosH = Math.cos(h), sinH = Math.sin(h);
    const P = (x, z) => { const de = x - f.pos.x, dn = -(z - f.pos.z); const rt = de * cosH - dn * sinH, fw = de * sinH + dn * cosH; return [cx + rt * sc, cy - fw * sc]; };
    c.save(); c.beginPath(); c.arc(cx, cy, R + 2, Math.PI * 1.08, Math.PI * 1.92); c.lineTo(cx, cy); c.closePath(); c.rect(0, 380, 512, 132); c.clip();
    // range rings
    c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1.5; c.setLineDash([6, 8]); c.beginPath(); c.arc(cx, cy, R / 2, Math.PI, 2 * Math.PI); c.stroke(); c.setLineDash([]);
    // route
    if (S.route) { c.strokeStyle = GRN; c.lineWidth = 2.5; c.beginPath(); S.route.forEach((w, i) => { const [x, y] = P(w.x, w.z); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
      c.font = `15px ${MONO}`; S.route.forEach((w, i) => { const [x, y] = P(w.x, w.z); c.fillStyle = i === S.ap.wp ? WHT : GRN; c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.strokeStyle = c.fillStyle; c.strokeRect(-5, -5, 10, 10); c.restore(); c.fillText(w.name, x + 10, y - 8); }); }
    // ILS extended centreline
    if (S.ils) { const t = S.ils.thr, d = S.ils.dir; const [x0, y0] = P(t.x, t.z), [x1, y1] = P(t.x - d.x * 28000, t.z - d.z * 28000); c.strokeStyle = MAG; c.lineWidth = 2; c.setLineDash([12, 8]); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.setLineDash([]); }
    // runways of nearby airports (real geometry)
    c.lineCap = 'round';
    for (const A of S.airports) {
      const [ax, ay] = P(A.x, A.z); if (Math.hypot(ax - cx, ay - cy) > R + 60) continue;
      for (const r of A.geom.runways) { const [x0, y0] = P(A.x + r.a.x, A.z + r.a.z), [x1, y1] = P(A.x + r.b.x, A.z + r.b.z); c.strokeStyle = WHT; c.lineWidth = Math.max(2, r.W * sc * 1.2); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
      c.fillStyle = MAG; c.font = `14px ${MONO}`; c.fillText(A.icao, ax + 12, ay + 18);
    }
    // navaids
    c.font = `13px ${MONO}`;
    for (const n of S.navaids) {
      const [x, y] = P(n.x, n.z); if (Math.hypot(x - cx, y - cy) > R + 10 || y > cy) continue;
      const vor = n.type[0] === 'V' || n.type === 'T'; c.strokeStyle = vor ? CYAN : MAG; c.lineWidth = 1.5;
      if (vor) { c.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; c.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6); } c.closePath(); c.stroke(); }
      else { c.beginPath(); c.arc(x, y, 5, 0, 7); c.stroke(); }
      c.fillStyle = vor ? CYAN : MAG; c.fillText(n.id, x + 8, y - 6);
    }
    // other traffic (TCAS-style)
    for (const t of S.traffic) { const [x, y] = P(t.x, t.z); if (Math.hypot(x - cx, y - cy) > R) continue; c.fillStyle = WHT; c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x + 6, y); c.lineTo(x, y + 6); c.lineTo(x - 6, y); c.closePath(); c.fill(); const rel = Math.round((t.y - f.pos.y) / FT / 100); c.font = `12px ${MONO}`; c.fillText((rel > 0 ? '+' : '') + String(rel).padStart(2, '0'), x - 10, y + (rel > 0 ? -10 : 18)); }
    c.restore();
    // compass arc
    c.strokeStyle = WHT; c.fillStyle = WHT; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, R, Math.PI * 1.08, Math.PI * 1.92); c.stroke();
    c.font = `17px ${MONO}`; c.textAlign = 'center';
    for (let d = 0; d < 360; d += 5) {
      const rel = (wrap360(d - e.hdg + 180) - 180); if (Math.abs(rel) > 50) continue; const a = (rel - 90) * D2R;
      const x0 = cx + Math.cos(a) * R, y0 = cy + Math.sin(a) * R, l = d % 10 === 0 ? 14 : 7; c.beginPath(); c.moveTo(x0, y0); c.lineTo(cx + Math.cos(a) * (R + l), cy + Math.sin(a) * (R + l)); c.stroke();
      if (d % 30 === 0) { c.save(); c.translate(cx + Math.cos(a) * (R + 28), cy + Math.sin(a) * (R + 28)); c.rotate(rel * D2R); c.fillText(String(d / 10), 0, 6); c.restore(); }
    }
    const hbRel = wrap360(S.ap.hdg - e.hdg + 180) - 180; if (Math.abs(hbRel) < 50) { const a = (hbRel - 90) * D2R; c.fillStyle = CYAN; c.save(); c.translate(cx + Math.cos(a) * (R + 4), cy + Math.sin(a) * (R + 4)); c.rotate(hbRel * D2R); c.beginPath(); c.moveTo(0, 0); c.lineTo(-8, -14); c.lineTo(8, -14); c.closePath(); c.fill(); c.restore(); }
    const tkRel = wrap360(S.track - e.hdg + 180) - 180; { const a = (tkRel - 90) * D2R; c.strokeStyle = GRN; c.save(); c.translate(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10)); c.rotate(tkRel * D2R); c.beginPath(); c.moveTo(0, -8); c.lineTo(6, 0); c.lineTo(0, 8); c.lineTo(-6, 0); c.closePath(); c.stroke(); c.restore(); }
    c.fillStyle = YEL; c.fillRect(cx - 2, cy - R - 22, 4, 22);
    // own aircraft
    c.strokeStyle = YEL; c.lineWidth = 4; c.beginPath(); c.moveTo(cx, cy - 22); c.lineTo(cx, cy + 22); c.moveTo(cx - 20, cy - 4); c.lineTo(cx + 20, cy - 4); c.moveTo(cx - 8, cy + 18); c.lineTo(cx + 8, cy + 18); c.stroke();
    c.fillStyle = WHT; c.font = `15px ${MONO}`; c.textAlign = 'left';
    c.fillText('GS', 12, 26); c.fillStyle = GRN; c.fillText(String(Math.round(Math.hypot(f.vel.x, f.vel.z) / KT)).padStart(3, ' '), 40, 26);
    c.fillStyle = WHT; c.fillText('TAS', 92, 26); c.fillStyle = GRN; c.fillText(String(Math.round(f.tas)).padStart(3, ' '), 128, 26);
    const wd = S.windFrom, ws = S.windKt; c.fillStyle = GRN; c.fillText(`${String(Math.round(wd)).padStart(3, '0')}°/${Math.round(ws)}`, 12, 48);
    c.save(); c.translate(30, 76); c.rotate((wd + 180 - e.hdg) * D2R); c.strokeStyle = GRN; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -14); c.lineTo(0, 14); c.moveTo(-5, 8); c.lineTo(0, 14); c.lineTo(5, 8); c.stroke(); c.restore();
    c.textAlign = 'right';
    if (S.ils) { c.fillStyle = MAG; c.fillText('ILS' + S.ils.ident + ' ' + S.ils.freq.toFixed(2), 500, 26); c.fillText('CRS ' + String(Math.round(S.ils.course)).padStart(3, '0') + '°', 500, 46); }
    else if (S.route && S.route[S.ap.wp]) { const w = S.route[S.ap.wp]; c.fillStyle = WHT; c.fillText(w.name, 500, 26); c.fillStyle = GRN; c.fillText((Math.hypot(w.x - f.pos.x, w.z - f.pos.z) / 1852).toFixed(1) + ' NM', 500, 46); }
    c.fillStyle = CYAN; c.fillText(range + ' NM', 500, 498); c.fillStyle = WHT; c.textAlign = 'left'; c.fillText('ARC  TRUE', 12, 498);
  }
  // ------------------------------------------------ Engine / warning display
  draw_ewd(c, S) {
    const f = S.fdm; c.fillStyle = '#000'; c.fillRect(0, 0, 512, 512);
    const dial = (x, y, r, v, max, label, red, txt, cmd) => {
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.05; c.lineWidth = 3; c.strokeStyle = WHT; c.beginPath(); c.arc(x, y, r, a0, a1); c.stroke();
      c.strokeStyle = RED; c.beginPath(); c.arc(x, y, r, a0 + (a1 - a0) * red, a1); c.stroke();
      const a = a0 + (a1 - a0) * Math.min(1.05, v / max); c.strokeStyle = GRN; c.lineWidth = 4; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); c.stroke();
      if (cmd != null) { const ac = a0 + (a1 - a0) * cmd / max; c.fillStyle = CYAN; c.beginPath(); c.arc(x + Math.cos(ac) * (r + 6), y + Math.sin(ac) * (r + 6), 4, 0, 7); c.fill(); }
      c.fillStyle = '#000'; c.strokeStyle = '#888'; c.lineWidth = 1.5; c.fillRect(x + 4, y + 4, r * 1.05, 28); c.strokeRect(x + 4, y + 4, r * 1.05, 28);
      c.fillStyle = GRN; c.font = `bold 22px ${MONO}`; c.textAlign = 'right'; c.fillText(txt, x + 4 + r * 1.0, y + 26);
    };
    for (let i = 0; i < 2; i++) {
      const x = 105 + i * 170;
      dial(x, 92, 62, f.n1[i], 110, 'N1', 0.9, f.n1[i].toFixed(1), 20 + 76 * f.tl);
      dial(x, 222, 44, f.egt[i], 1100, 'EGT', 0.9, Math.round(f.egt[i]) + '');
    }
    c.fillStyle = WHT; c.font = `15px ${MONO}`; c.textAlign = 'center'; c.fillText('N1', 190, 100); c.fillText('%', 190, 118); c.fillText('EGT', 190, 226); c.fillText('°C', 190, 244);
    c.fillText('N2 %', 190, 300); c.fillText('FF KG/H', 190, 330);
    c.fillStyle = GRN; c.font = `bold 19px ${MONO}`;
    for (let i = 0; i < 2; i++) { c.fillStyle = f.engRun && !f.engRun[i] ? (f.n2[i] > 1 ? AMB : '#555') : GRN; c.fillText((f.n2 ? f.n2[i] : 58 + f.n1[i] * 0.42).toFixed(1), 95 + i * 190, 300); c.fillStyle = GRN; c.fillText(f.engRun && !f.engRun[i] ? (f.n2[i] > 16 ? Math.round(f.n2[i] * 5) : 0) : Math.round(280 + f.n1[i] ** 2 * 0.32), 95 + i * 190, 330); }
    if (f.reverser > 0.1) { c.fillStyle = f.reverser > 0.95 ? GRN : AMB; c.font = `bold 20px ${MONO}`; c.fillText('REV', 105, 60); c.fillText('REV', 275, 60); }
    // flaps / slats
    c.fillStyle = WHT; c.font = `15px ${MONO}`; c.textAlign = 'left'; c.fillText('S', 360, 172); c.fillText('F', 482, 172);
    c.strokeStyle = WHT; c.lineWidth = 2; c.beginPath(); c.moveTo(400, 150); c.lineTo(450, 150); c.stroke();
    c.strokeStyle = GRN; c.lineWidth = 4; c.beginPath(); c.moveTo(400, 152); c.lineTo(400 - f.slatPos * 30, 152 + f.slatPos * 18); c.moveTo(450, 152); c.lineTo(450 + f.flapPos * 30, 152 + f.flapPos * 22); c.stroke();
    c.fillStyle = Math.abs(f.flapPos - FLAPS[f.flapIdx].flap) > 0.01 ? CYAN : GRN; c.font = `bold 20px ${MONO}`; c.textAlign = 'center'; c.fillText(f.flapIdx === 1 && !f.onGround ? '1' : f.flapIdx === 1 ? '1+F' : FLAPS[f.flapIdx].name, 425, 200);
    c.fillStyle = WHT; c.font = `15px ${MONO}`; c.fillText('FOB', 400, 60); c.fillStyle = GRN; c.font = `bold 20px ${MONO}`; c.fillText(Math.round(f.fuel) + ' KG', 425, 86);
    // memo / warnings
    c.strokeStyle = WHT; c.lineWidth = 1.5; c.beginPath(); c.moveTo(10, 362); c.lineTo(502, 362); c.stroke();
    const msgs = S.warnings; let y = 392; c.textAlign = 'left'; c.font = `bold 18px ${MONO}`;
    for (const m of msgs.slice(0, 5)) { c.fillStyle = m.c === 'r' ? RED : m.c === 'a' ? AMB : m.c === 'b' ? CYAN : GRN; c.fillText(m.t, 22, y); y += 26; }
  }
  // ------------------------------------------------ System display: gear, brakes, spoilers, trim
  draw_sd(c, S) {
    const f = S.fdm; c.fillStyle = '#000'; c.fillRect(0, 0, 512, 512);
    c.fillStyle = WHT; c.font = `bold 20px ${MONO}`; c.textAlign = 'center'; c.fillText('WHEEL', 256, 30);
    const gp = f.gearPos; const tri = (x, y) => { const down = gp > 0.99, tr = gp > 0.01 && gp < 0.99; if (gp < 0.01) return; c.fillStyle = down ? GRN : RED; c.strokeStyle = c.fillStyle; c.lineWidth = 3; c.beginPath(); c.moveTo(x - 26, y); c.lineTo(x + 26, y); c.lineTo(x, y + 36); c.closePath(); tr ? c.stroke() : c.fill(); };
    tri(256, 70); tri(150, 150); tri(362, 150);
    c.fillStyle = WHT; c.font = `15px ${MONO}`; c.fillText('LDG GEAR', 256, 230);
    c.fillStyle = gp > 0.99 ? GRN : gp < 0.01 ? WHT : AMB; c.font = `bold 18px ${MONO}`; c.fillText(gp > 0.99 ? 'DOWN & LOCKED' : gp < 0.01 ? 'UP' : 'IN TRANSIT', 256, 254);
    // brakes / autobrake
    c.textAlign = 'left'; c.fillStyle = WHT; c.font = `15px ${MONO}`; c.fillText('BRAKES', 30, 300); c.fillText('AUTO BRK', 30, 324); c.fillText('PARK BRK', 30, 348);
    c.fillStyle = f.brake > 0.05 ? AMB : GRN; c.fillText(Math.round(f.brake * 100) + ' %', 150, 300);
    c.fillStyle = f.autobrake ? CYAN : WHT; c.fillText(f.autobrake === 1 ? 'LO' : f.autobrake === 2 ? 'MED' : 'OFF', 150, 324);
    c.fillStyle = f.parkBrake ? AMB : GRN; c.fillText(f.parkBrake ? 'ON' : 'OFF', 150, 348);
    // spoilers
    c.fillStyle = WHT; c.fillText('SPLR', 300, 300);
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) { const x = 380 + s * (20 + i * 18); const up = Math.max(f.speedbrake, f.groundSpoilers) > 0.05; c.fillStyle = up ? GRN : '#555'; c.beginPath(); c.moveTo(x - 6, 320); c.lineTo(x + 6, 320); c.lineTo(x, up ? 302 : 318); c.closePath(); c.fill(); }
    c.fillStyle = f.spoilersArmed ? CYAN : WHT; c.fillText(f.spoilersArmed ? 'GND SPLR ARMED' : 'GND SPLR OFF', 300, 348);
    // pitch trim
    c.fillStyle = WHT; c.fillText('PITCH TRIM', 30, 400); c.fillStyle = GRN; c.font = `bold 18px ${MONO}`; c.fillText((f.trimDisp >= 0 ? 'UP ' : 'DN ') + Math.abs(f.trimDisp || 0).toFixed(1) + '°', 170, 400);
    c.fillStyle = WHT; c.font = `15px ${MONO}`; c.fillText('GW', 300, 400); c.fillStyle = GRN; c.fillText(Math.round(f.mass + f.fuel - 8000) + ' KG', 340, 400);
    c.fillStyle = WHT; c.fillText('SAT', 30, 440); c.fillStyle = GRN; c.fillText(Math.round(15 - S.altFt * 0.00198) + ' °C', 80, 440);
    c.fillStyle = WHT; c.fillText('LT', 300, 440); c.fillStyle = GRN; c.fillText(fmtTime(S.localMin), 340, 440);
    c.fillStyle = WHT; c.fillText('G LOAD', 30, 470); c.fillStyle = Math.abs(f.nz - 1) > 0.6 ? AMB : GRN; c.fillText(f.nz.toFixed(2), 120, 470);
  }
}

// ------------------------------------------------ 3D flight deck (simplified, generic)
function panelTexture(kind) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256; const c = cv.getContext('2d');
  const base = kind === 'ped' ? '#59616c' : '#66707c'; c.fillStyle = base; c.fillRect(0, 0, 1024, 256);
  for (let i = 0; i < 4000; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.03})`; c.fillRect(Math.random() * 1024, Math.random() * 256, 2, 2); }
  c.strokeStyle = 'rgba(20,24,30,.55)'; c.lineWidth = 2; for (const x of [96, 330, 420, 600, 694, 928]) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 256); c.stroke(); }
  c.fillStyle = 'rgba(30,34,40,.7)'; for (const x of [96, 330, 420, 600, 694, 928]) for (const y of [14, 242]) { c.beginPath(); c.arc(x + 8, y, 3, 0, 7); c.fill(); c.beginPath(); c.arc(x - 8, y, 3, 0, 7); c.fill(); }
  c.fillStyle = '#eef1f4'; c.font = '600 13px "B612", sans-serif'; c.textAlign = 'center';
  if (kind === 'main') { [['MASTER WARN', 40], ['MASTER CAUT', 40], ['AUTO LAND', 980], ['CHRONO', 980]].forEach(([t, x], i) => { c.fillStyle = i < 2 ? '#3a1414' : '#2a2f36'; c.fillRect(x - 34, 40 + (i % 2) * 60, 68, 40); c.fillStyle = i === 0 ? '#ff5a4a' : i === 1 ? '#ffb84d' : '#eef1f4'; c.fillText(t, x, 64 + (i % 2) * 60); });
    c.fillStyle = '#eef1f4'; ['A/SKID & N/W STRG', 'AUTO BRK', 'LDG GEAR', 'BRK PRESS'].forEach((t, i) => c.fillText(t, 460 + i * 60 - 60, 236));
    c.fillStyle = '#2a2f36'; for (let i = 0; i < 3; i++) { c.fillRect(470 + i * 46, 170, 38, 30); } c.fillStyle = '#55e08f'; c.fillText('LO', 489, 190); c.fillText('MED', 535, 190); c.fillText('MAX', 581, 190);
    c.fillStyle = '#1d2026'; c.beginPath(); c.arc(660, 190, 22, 0, 7); c.fill(); c.fillStyle = '#d8dde3'; c.fillRect(655, 150, 10, 40); }
  else { c.fillStyle = '#eef1f4'; ['ENG 1', 'ENG 2', 'MODE', 'FLAPS', 'SPEED BRAKE', 'PARK BRK', 'RADIO', 'TCAS'].forEach((t, i) => c.fillText(t, 70 + i * 125, 30)); c.fillStyle = '#1d2026'; for (let i = 0; i < 8; i++) { c.beginPath(); c.arc(70 + i * 125, 120, 26, 0, 7); c.fill(); } }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
export const OVHD = { canvas: null, tex: null };
export function drawOverhead(st = {}) {
  if (!OVHD.canvas) { OVHD.canvas = document.createElement('canvas'); OVHD.canvas.width = 1024; OVHD.canvas.height = 768; OVHD.tex = new THREE.CanvasTexture(OVHD.canvas); OVHD.tex.colorSpace = THREE.SRGBColorSpace; OVHD.tex.anisotropy = 8; }
  const c = OVHD.canvas.getContext('2d'); c.fillStyle = '#5f6975'; c.fillRect(0, 0, 1024, 768);
  c.strokeStyle = 'rgba(20,24,30,.6)'; c.lineWidth = 3; for (let x = 0; x <= 1024; x += 256) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 768); c.stroke(); } for (let y = 0; y <= 768; y += 192) { c.beginPath(); c.moveTo(0, y); c.lineTo(1024, y); c.stroke(); }
  c.font = '600 18px "B612", sans-serif'; c.textAlign = 'center';
  for (const sw of (OVHD.layout || [])) {
    const on = st[sw.id]; const x = sw.x * 1024, y = sw.y * 768;
    c.fillStyle = '#eef1f4'; c.fillText(sw.label, x, y - 44);
    if (sw.kind === 'push') { c.fillStyle = '#20242a'; c.fillRect(x - 40, y - 30, 80, 60); c.fillStyle = on ? (sw.amberOn ? '#ffb84d' : '#55e08f') : 'rgba(255,255,255,.12)'; c.font = '700 16px "B612 Mono", monospace'; c.fillText(on ? (sw.onText || 'ON') : (sw.offText || 'OFF'), x, y + 6); c.font = '600 18px "B612", sans-serif'; if (sw.avail) { c.fillStyle = st[sw.avail] ? '#55e08f' : 'rgba(255,255,255,.1)'; c.fillText('AVAIL', x, y + 26); } }
    else { c.fillStyle = '#1b1e23'; c.beginPath(); c.arc(x, y, 22, 0, 7); c.fill(); c.strokeStyle = '#d8dde3'; c.lineWidth = 9; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + (on ? -28 : 28)); c.stroke(); c.fillStyle = '#d8dde3'; c.font = '600 13px "B612", sans-serif'; c.fillText(sw.onText || 'ON', x + 46, y - 18); c.fillText(sw.offText || 'OFF', x + 46, y + 30); c.font = '600 18px "B612", sans-serif'; }
  }
  if (OVHD.tex) OVHD.tex.needsUpdate = true; return OVHD.tex;
}
// ------------------------------------------------ 3D flight deck (simplified, generic, sun-lit)
export function buildCockpit(displays) {
  const g = new THREE.Group(); g.name = 'cockpit';
  const M = (c, r = 0.85, extra = {}) => atmos(new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.05, ...extra }));
  const panelM = M(0xffffff, 0.7, { map: panelTexture('main') }), pedM = M(0xffffff, 0.7, { map: panelTexture('ped') });
  const shieldM = M(0x2a2d33, 1.0), frameM = M(0x8a929c, 0.6), wallM = M(0xb9c0c8, 0.85, { side: THREE.DoubleSide }), trimM = M(0x3a3f47, 0.7);
  const z0 = -15.05;
  const box = (w, h, d, x, y, z, m, rx = 0, rz = 0, ry = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.set(rx, ry, rz); g.add(b); return b; };
  box(2.5, 0.5, 0.05, 0, 0.4, z0 - 0.9, panelM, -0.2);                // main panel (textured)
  // glareshield: a thin sloped extrusion instead of a heavy slab
  const prof = new THREE.Shape([new THREE.Vector2(-0.6, 0.655), new THREE.Vector2(-0.64, 0.7), new THREE.Vector2(-0.98, 0.735), new THREE.Vector2(-1.06, 0.69), new THREE.Vector2(-1.0, 0.64)].map(v => new THREE.Vector2(v.x, v.y)));
  const gs = new THREE.ExtrudeGeometry(prof, { depth: 2.5, bevelEnabled: false }); gs.rotateY(-Math.PI / 2); gs.translate(1.25, 0, 0); const gsm = new THREE.Mesh(gs, shieldM); gsm.position.z = z0; g.add(gsm);
  // FCU on the glareshield face
  const fcuC = document.createElement('canvas'); fcuC.width = 1024; fcuC.height = 96; { const c = fcuC.getContext('2d'); c.fillStyle = '#3a4049'; c.fillRect(0, 0, 1024, 96); c.fillStyle = '#121418'; [[60, 'SPD'], [300, 'HDG'], [560, 'ALT'], [800, 'V/S']].forEach(([x, t]) => { c.fillStyle = '#121418'; c.fillRect(x, 20, 150, 52); c.fillStyle = '#ffb84d'; c.font = '700 34px "B612 Mono", monospace'; c.fillText(t === 'SPD' ? '160' : t === 'HDG' ? '182' : t === 'ALT' ? '05000' : '-----', x + 12, 58); c.fillStyle = '#e8edf5'; c.font = '600 16px "B612", sans-serif'; c.fillText(t, x + 50, 16); c.fillStyle = '#1b1e23'; c.beginPath(); c.arc(x + 185, 46, 22, 0, 7); c.fill(); }); }
  const fcuT = new THREE.CanvasTexture(fcuC); fcuT.colorSpace = THREE.SRGBColorSpace; const fcu = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.09), M(0xffffff, 0.6, { map: fcuT })); fcu.position.set(0, 0.68, z0 - 0.62); fcu.rotation.x = -0.25; g.add(fcu); g.userData.fcuCanvas = fcuC; g.userData.fcuTex = fcuT;
  const scrMats = [];
  const scr = (tex, x, y, z, s, rx) => { const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }); scrMats.push(mat); const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), mat); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); const bz = new THREE.Mesh(new THREE.PlaneGeometry(s + 0.03, s + 0.03), trimM); bz.position.set(x, y, z - 0.004); bz.rotation.x = rx; g.add(bz); };
  const zs = z0 - 0.862, ys = 0.46;
  scr(displays.tex.pfd, -0.79, ys, zs, 0.235, -0.2); scr(displays.tex.nd, -0.535, ys, zs, 0.235, -0.2); scr(displays.tex.ewd, -0.13, ys + 0.01, zs, 0.2, -0.2);
  scr(displays.tex.sd, 0.13, ys + 0.01, zs, 0.2, -0.2); scr(displays.tex.nd, 0.555, ys, zs, 0.215, -0.2); scr(displays.tex.pfd, 0.80, ys, zs, 0.215, -0.2);
  const ped = box(0.56, 0.22, 0.95, 0, 0.1, z0 - 0.33, pedM);          // pedestal
  const levers = [];
  for (const sx of [-1, 1]) { const piv = new THREE.Group(); piv.position.set(sx * 0.06, 0.22, z0 - 0.28); const l = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.03), trimM); l.position.y = 0.08; piv.add(l); const k = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.045), M(0xd8dde3, 0.4)); k.position.y = 0.16; piv.add(k); g.add(piv); levers.push(piv); }
  // windshield & side-window frames (slim, painted light grey)
  box(0.03, 0.62, 0.03, 0, 1.0, z0 - 1.0, frameM, -0.62);
  for (const sx of [-1, 1]) {
    box(0.035, 0.82, 0.035, sx * 1.02, 1.05, z0 - 0.72, frameM, -0.45, sx * 0.42);   // A-pillar
    box(0.04, 0.62, 0.04, sx * 1.33, 1.08, z0 - 0.2, frameM, -0.08, sx * 0.25);      // side window post
    box(0.04, 0.62, 0.04, sx * 1.38, 1.06, z0 + 0.45, frameM, 0, sx * 0.22);         // aft side window post
    box(0.05, 0.04, 1.3, sx * 1.27, 0.8, z0 - 0.15, frameM);                          // sill
    box(0.04, 0.04, 1.2, sx * 1.2, 1.38, z0 - 0.1, frameM, 0, sx * 0.3);              // top rail
    box(0.05, 0.95, 2.2, sx * 1.42, 0.38, z0 + 0.25, wallM);                          // lower side wall
    // seats
    const seat = new THREE.Group(); seat.position.set(sx * 0.52, 0, z0 + 0.35); const sm = M(0x2e3a52, 0.9); const cush = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), sm); cush.position.y = 0.42; seat.add(cush); const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.12), sm); back.position.set(0, 0.85, 0.25); back.rotation.x = 0.15; seat.add(back); const sheep = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.6, 0.03), M(0xd9cfbf, 1.0)); sheep.position.set(0, 0.88, 0.18); sheep.rotation.x = 0.15; seat.add(sheep); g.add(seat);
  }
  box(2.7, 0.04, 0.5, 0, 1.36, z0 - 0.62, frameM, 0.5);
  const ov = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.05), M(0xffffff, 0.7, { map: drawOverhead({}) })); ov.position.set(0, 1.54, z0 + 0.0); ov.rotation.x = Math.PI / 2 + 0.16; g.add(ov); g.userData.overhead = ov;
  box(1.55, 0.04, 1.2, 0, 1.6, z0 + 0.0, wallM, 0.16);
  box(3.0, 0.05, 2.6, 0, -0.12, z0 + 0.2, M(0x2a2d33, 1.0));
  for (const sx of [-1, 1]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.15, 8), trimM); st.position.set(sx * 1.12, 0.32, z0 - 0.05); g.add(st); }
  g.userData.levers = levers; g.userData.screens = scrMats;
  g.visible = false;
  return g;
}
export const COCKPIT_EYE = new THREE.Vector3(-0.52, 1.02, -15.0);

// ------------------------------------------------ HUD (2D overlay, external views): compact and non-conformal
export function drawHUD(ctx, W, H, S, cam, units, mode = 'full') {
  ctx.clearRect(0, 0, W, H);
  const f = S.fdm, e = S.e; const sc = Math.min(W / 1600, H / 900) * 1.0;
  ctx.save(); ctx.lineWidth = 1.5 * sc; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 5 * sc;
  const col = 'rgba(170,255,215,0.95)'; ctx.strokeStyle = col; ctx.fillStyle = col;
  const cx = W / 2, cy = H * 0.58;
  const spd = units === 'metric' ? f.ias * 1.852 : f.ias, alt = units === 'metric' ? S.altFt * FT : S.altFt;
  const vs = f.vel.y / FT * 60;
  const box = (x, big, sub, sub2) => {
    ctx.fillStyle = 'rgba(6,12,20,0.35)'; ctx.fillRect(x - 70 * sc, cy - 22 * sc, 140 * sc, 44 * sc); ctx.fillStyle = col; ctx.strokeRect(x - 70 * sc, cy - 22 * sc, 140 * sc, 44 * sc);
    ctx.textAlign = 'center'; ctx.font = `bold ${Math.round(26 * sc)}px ${MONO}`; ctx.fillText(big, x, cy + 1 * sc);
    ctx.font = `${Math.round(13 * sc)}px ${MONO}`; ctx.fillText(sub, x, cy + 38 * sc); if (sub2) ctx.fillText(sub2, x, cy + 56 * sc);
  };
  const raShow = S.raFt < 2500, altBig = raShow ? Math.round(S.raFt / (S.raFt > 100 ? 10 : 1)) * (S.raFt > 100 ? 10 : 1) : Math.round(alt / 10) * 10, altLab = raShow ? (units === 'metric' ? 'M RADIO' : 'FT RADIO') : units === 'metric' ? 'M' : 'FT';
  if (mode === 'min') { // clean outside view: one quiet line, ILS dots on approach, modes
    ctx.textAlign = 'center'; ctx.font = `600 ${Math.round(15 * sc)}px ${MONO}`; const vsTxt = (vs >= 0 ? '▲' : '▼') + Math.abs(Math.round(vs / 10) * 10);
    ctx.fillText(`${Math.round(spd)} ${units === 'metric' ? 'KM/H' : 'KT'}    ${raShow ? 'RA ' + (units === 'metric' ? Math.round(S.raFt * FT) : altBig) : Math.round(alt / 10) * 10} ${units === 'metric' ? 'M' : 'FT'}    ${vsTxt} FPM`, cx, H * 0.80);
  } else {
  box(cx - 420 * sc, Math.round(spd), (units === 'metric' ? 'KM/H IAS' : 'KT IAS'), 'GS ' + Math.round(Math.hypot(f.vel.x, f.vel.z) / KT) + (S.ap.athr ? '  ▸' + Math.round(S.ap.spd) : ''));
  box(cx + 420 * sc, raShow && units === 'metric' ? Math.round(S.raFt * FT) : altBig, altLab, (vs >= 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(units === 'metric' ? vs * FT / 60 : vs / 10) * (units === 'metric' ? 1 : 10)) + (units === 'metric' ? ' M/S' : ' FPM'));
  // heading strip
  ctx.textAlign = 'center'; ctx.font = `bold ${Math.round(17 * sc)}px ${MONO}`; const hy = H * 0.1;
  ctx.fillText(String(Math.round(e.hdg) % 360).padStart(3, '0'), cx, hy);
  ctx.font = `${Math.round(12 * sc)}px ${MONO}`;
  for (let d = -40; d <= 40; d += 5) { const h = Math.round(e.hdg / 5) * 5 + d; const x = cx + (wrap360(h - e.hdg + 180) - 180) * 6 * sc; if (Math.abs(x - cx) < 30 * sc) continue; ctx.globalAlpha = 0.65; ctx.beginPath(); ctx.moveTo(x, hy + 14 * sc); ctx.lineTo(x, hy + (h % 10 === 0 ? 24 : 19) * sc); ctx.stroke(); if (h % 30 === 0) ctx.fillText(String(wrap360(h) / 10 | 0).padStart(2, '0'), x, hy + 34 * sc); ctx.globalAlpha = 1; }
  // bank / pitch readout
  ctx.font = `${Math.round(13 * sc)}px ${MONO}`; ctx.fillText(`PITCH ${e.pitch >= 0 ? '+' : ''}${e.pitch.toFixed(1)}°   BANK ${Math.abs(e.bank).toFixed(0)}°${Math.abs(e.bank) > 1 ? (e.bank > 0 ? 'R' : 'L') : ''}`, cx, hy + 52 * sc);
  }
  // ILS deviation mini scales beside the altitude box
  if (S.ilsDev && S.ilsDev.valid && S.ilsDev.dist < 30000 && !f.onGround) {
    const d = S.ilsDev, gx = cx + 510 * sc, lx = cx + 420 * sc, ly = cy - 52 * sc;
    ctx.globalAlpha = 0.75; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(gx, cy + i * 14 * sc, 2.5 * sc, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(lx + i * 18 * sc, ly, 2.5 * sc, 0, 7); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.fillStyle = '#ff7bff'; ctx.beginPath(); ctx.arc(gx, cy - d.gsDots * 14 * sc, 5.5 * sc, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(lx + d.locDots * 18 * sc, ly, 5.5 * sc, 0, 7); ctx.fill(); ctx.fillStyle = col;
    ctx.font = `${Math.round(12 * sc)}px ${MONO}`; ctx.fillText('ILS ' + S.ils.ident + ' ' + (Math.max(0, d.thrDist) / 1852).toFixed(1) + ' NM', lx, ly - 16 * sc);
  }
  // modes
  const fm = f.fma(); ctx.font = `${Math.round(14 * sc)}px ${MONO}`; ctx.textAlign = 'center';
  ctx.fillText([fm.thr, fm.vert, fm.lat, fm.arm && '(' + fm.arm + ')', fm.eng].filter(Boolean).join('    '), cx, H * 0.86);
  if (f.stall > 0.2) { ctx.fillStyle = '#ff4a3a'; ctx.font = `bold ${Math.round(34 * sc)}px ${MONO}`; ctx.fillText('STALL', cx, H * 0.3); }
  ctx.restore();
}
