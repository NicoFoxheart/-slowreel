// Procedural art for the flight deck: tiling material sets (paint, crackle, leather, carpet, sheepskin, vinyl, brushed
// metal, rubber) with normal + roughness maps, a panel atlas painter (labels, seams, screws, backlit legends),
// geometry helpers (fillets, swept padded frames, bevelled shapes) and a merge-by-material builder that bakes AO
// into vertex colours. Everything is generated at load time; nothing is fetched.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ------------------------------------------------ noise
let SEED = 1337;
export function rand() { SEED = (SEED * 1664525 + 1013904223) >>> 0; return SEED / 4294967296; }
const HASH = new Uint8Array(512); { const p = []; for (let i = 0; i < 256; i++) p.push(i); for (let i = 255; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) HASH[i] = p[i & 255]; }
const h2 = (x, y) => HASH[(HASH[x & 255] + y) & 511] / 255;
function vnoise(x, y, per) { // tileable value noise, period `per` cells
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const X0 = ((xi % per) + per) % per, Y0 = ((yi % per) + per) % per, X1 = (X0 + 1) % per, Y1 = (Y0 + 1) % per;
  const a = h2(X0, Y0), b = h2(X1, Y0), c = h2(X0, Y1), d = h2(X1, Y1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, per, oct = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, per * f); a *= 0.5; f *= 2; } return s; }

// ------------------------------------------------ canvases → textures
export function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function tex(c, srgb = true, rep = true) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
// height (Float32Array, w*h, any range) → tangent-space normal map canvas (wraps at the edges when `wrap`)
export function normalFromHeight(H, w, h, strength = 2, wrap = true) {
  const c = canvas(w, h), x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data;
  const at = (i, j) => { if (wrap) { i = (i + w) % w; j = (j + h) % h; } else { i = Math.max(0, Math.min(w - 1, i)); j = Math.max(0, Math.min(h - 1, j)); } return H[j * w + i]; };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const dx = (at(i + 1, j) - at(i - 1, j)) * strength, dy = (at(i, j + 1) - at(i, j - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), k = (j * w + i) * 4;
    d[k] = (-dx / l * 0.5 + 0.5) * 255; d[k + 1] = (dy / l * 0.5 + 0.5) * 255; d[k + 2] = (1 / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  x.putImageData(img, 0, 0); return c;
}
function fromFn(w, h, fn) { // fn(u,v) → [r,g,b] 0..1 ; returns canvas
  const c = canvas(w, h), x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const p = fn(i, j); const k = (j * w + i) * 4; d[k] = p[0] * 255; d[k + 1] = p[1] * 255; d[k + 2] = p[2] * 255; d[k + 3] = 255; }
  x.putImageData(img, 0, 0); return c;
}
const col = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }; // sRGB components 0..1 (canvas space)

// ------------------------------------------------ tiling material sets
// each returns { map, normalMap, roughnessMap, scale } (scale: metres per texture repeat for box-mapped UVs)
export function matSet(kind, hex) {
  const N = 256; const H = new Float32Array(N * N); const R = new Float32Array(N * N); const A = new Float32Array(N * N);
  let nStr = 2, rough = [0.6, 0.1], scale = 0.25;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = i / N, v = j / N, k = j * N + i;
    if (kind === 'paint') { // speckled satin panel paint (orange peel)
      const n = fbm(u * 32, v * 32, 32, 3); const sp = rand(); H[k] = n * 0.6 + (sp > 0.985 ? 0.6 : 0); A[k] = (sp > 0.992 ? 0.08 : sp < 0.006 ? -0.07 : 0) + (n - 0.5) * 0.05; R[k] = n;
      nStr = 1.6; rough = [0.62, 0.12]; scale = 0.18;
    } else if (kind === 'crackle') { // wrinkle-finish anti-glare black
      const a = fbm(u * 24, v * 24, 24, 4), b = fbm(u * 24 + 7.3, v * 24 + 3.1, 24, 4); const r = 1 - Math.abs(a - b) * 4; H[k] = Math.max(0, r) ** 3 + fbm(u * 64, v * 64, 64, 2) * 0.25; A[k] = H[k] * 0.06; R[k] = 1 - H[k] * 0.3;
      nStr = 4; rough = [0.86, 0.12]; scale = 0.12;
    } else if (kind === 'leather') { // pebble grain
      const a = fbm(u * 40, v * 40, 40, 3); const cell = vnoise(u * 90, v * 90, 90); H[k] = cell * 0.7 + a * 0.4; A[k] = (a - 0.5) * 0.12; R[k] = 1 - cell;
      nStr = 2.4; rough = [0.5, 0.18]; scale = 0.16;
    } else if (kind === 'carpet') { // short-pile loop carpet
      const f = vnoise(u * 128, v * 128, 128), m = fbm(u * 8, v * 8, 8, 3); H[k] = f * 0.8 + ((i + j) % 4 < 2 ? 0.15 : 0); A[k] = (f - 0.5) * 0.25 + (m - 0.5) * 0.12; R[k] = 0.5;
      nStr = 3.2; rough = [0.95, 0.04]; scale = 0.2;
    } else if (kind === 'sheep') { // sheepskin curls
      const c1 = fbm(u * 20, v * 20, 20, 4), c2 = vnoise(u * 60 + c1 * 3, v * 60, 60); const curl = Math.sin((c1 * 9 + c2 * 2) * Math.PI) * 0.5 + 0.5; H[k] = curl * 0.8 + c2 * 0.3; A[k] = (curl - 0.5) * 0.22; R[k] = 0.5;
      nStr = 5; rough = [0.97, 0.03]; scale = 0.14;
    } else if (kind === 'vinyl') { // soft-touch wall lining
      const n = fbm(u * 48, v * 48, 48, 3); H[k] = n; A[k] = (fbm(u * 6, v * 6, 6, 2) - 0.5) * 0.06 + (n - 0.5) * 0.03; R[k] = n;
      nStr = 1.4; rough = [0.72, 0.1]; scale = 0.3;
    } else if (kind === 'brushed') { // brushed aluminium, streaks along u
      const s = vnoise(u * 3, v * 220, 220) * 0.6 + vnoise(u * 1, v * 600, 600) * 0.4; H[k] = s * 0.4; A[k] = (s - 0.5) * 0.12; R[k] = s;
      nStr = 0.8; rough = [0.32, 0.16]; scale = 0.15;
    } else { // rubber / plastic
      const n = fbm(u * 64, v * 64, 64, 2); H[k] = n * 0.5; A[k] = (n - 0.5) * 0.05; R[k] = n;
      nStr = 1.2; rough = [0.8, 0.08]; scale = 0.12;
    }
  }
  const base = col(hex);
  const map = fromFn(N, N, (i, j) => { const a = A[j * N + i]; return [Math.min(1, Math.max(0, base[0] + a)), Math.min(1, Math.max(0, base[1] + a)), Math.min(1, Math.max(0, base[2] + a))]; });
  const rmap = fromFn(N, N, (i, j) => { const r = rough[0] + (R[j * N + i] - 0.5) * rough[1]; return [0, r, 0]; }); // roughness is read from G
  return { map: tex(map), normalMap: tex(normalFromHeight(H, N, N, nStr), false), roughnessMap: tex(rmap, false), scale };
}

// ------------------------------------------------ panel atlas: one big canvas for all labelled faces
export class Atlas {
  // albedo at full resolution; emissive (backlit legends) and height (seams, screws, speckle) at half resolution
  constructor(W = 2048, H = 2048, pxPerM = 800) {
    this.W = W; this.H = H; this.ppm = pxPerM; this.alb = canvas(W, H); this.emi = canvas(W / 2, H / 2); this.hgt = canvas(W / 2, H / 2);
    this.a = this.alb.getContext('2d'); this.e = this.emi.getContext('2d'); this.h = this.hgt.getContext('2d');
    this.e.fillStyle = '#000'; this.e.fillRect(0, 0, W, H); this.h.fillStyle = '#808080'; this.h.fillRect(0, 0, W, H);
    this.e.setTransform(0.5, 0, 0, 0.5, 0, 0); this.h.setTransform(0.5, 0, 0, 0.5, 0, 0);
    this.x = 4; this.y = 4; this.rowH = 0; this.regions = {};
  }
  // reserve w×h metres; returns a painter whose coordinates are metres from the region's top-left
  region(id, wm, hm, paint = '#4a5662') {
    const w = Math.ceil(wm * this.ppm), h = Math.ceil(hm * this.ppm);
    if (this.x + w + 4 > this.W) { this.x = 4; this.y += this.rowH + 8; this.rowH = 0; }
    if (this.y + h > this.H) console.warn('atlas full', id);
    const r = { id, x: this.x, y: this.y, w, h, wm, hm }; this.x += w + 8; this.rowH = Math.max(this.rowH, h); this.regions[id] = r;
    const a = this.a; a.fillStyle = paint; a.fillRect(r.x - 3, r.y - 3, w + 6, h + 6);
    const gr = a.createLinearGradient(0, r.y, 0, r.y + h); gr.addColorStop(0, 'rgba(255,255,255,0.035)'); gr.addColorStop(1, 'rgba(0,0,0,0.05)'); a.fillStyle = gr; a.fillRect(r.x, r.y, w, h);
    for (let i = 0; i < w * h / 90; i++) { a.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'; a.fillRect(r.x + rand() * w, r.y + rand() * h, 1.2, 1.2); }
    const hh = this.h; for (let i = 0; i < w * h / 160; i++) { hh.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},0.22)`; hh.fillRect(r.x + rand() * w, r.y + rand() * h, 3, 3); }
    return new Painter(this, r);
  }
  finish() {
    const w = this.W / 2, h = this.H / 2; const img = this.h.getImageData(0, 0, w, h).data; const H = new Float32Array(w * h); for (let i = 0; i < w * h; i++) H[i] = img[i * 4] / 255;
    this.normal = tex(normalFromHeight(H, w, h, 2.6, false), false, false); this.map = tex(this.alb, true, false); this.emissive = tex(this.emi, true, false);
    this.hgt = null; this.h = null;
  }
}
export class Painter {
  constructor(at, r) { this.at = at; this.r = r; this.k = at.ppm; }
  X(m) { return this.r.x + m * this.k; } Y(m) { return this.r.y + m * this.k; }
  // text label: backlit → also drawn in the emissive canvas
  text(t, x, y, size = 0.011, color = '#eef2f6', opts = {}) {
    const { a, e } = this.at; const f = `${opts.weight || 600} ${Math.round(size * this.k)}px ${opts.font || '"B612", "Segoe UI", sans-serif'}`;
    for (const [ctx, c] of [[a, color], ...(opts.lit === false ? [] : [[e, opts.glow || '#ffe8c0']])]) { ctx.font = f; ctx.textAlign = opts.align || 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = c; ctx.fillText(t, this.X(x), this.Y(y)); }
  }
  box(x, y, w, h, fill, opts = {}) { const { a } = this.at; a.fillStyle = fill; a.beginPath(); a.roundRect(this.X(x), this.Y(y), w * this.k, h * this.k, (opts.r || 0) * this.k); a.fill(); if (opts.height != null) { const hh = this.at.h; hh.fillStyle = `rgb(${opts.height},${opts.height},${opts.height})`; hh.beginPath(); hh.roundRect(this.X(x), this.Y(y), w * this.k, h * this.k, (opts.r || 0) * this.k); hh.fill(); } }
  line(x0, y0, x1, y1, color = '#eef2f6', wm = 0.0012, lit = true) { for (const [ctx, c] of [[this.at.a, color], ...(lit ? [[this.at.e, '#ffe8c0']] : [])]) { ctx.strokeStyle = c; ctx.lineWidth = wm * this.k; ctx.beginPath(); ctx.moveTo(this.X(x0), this.Y(y0)); ctx.lineTo(this.X(x1), this.Y(y1)); ctx.stroke(); } }
  // engraved seam between sub-panels (dark groove in albedo + height)
  seam(x0, y0, x1, y1) {
    const { a, h } = this.at; a.strokeStyle = 'rgba(10,14,18,0.75)'; a.lineWidth = Math.max(1.5, 0.0018 * this.k); a.beginPath(); a.moveTo(this.X(x0), this.Y(y0)); a.lineTo(this.X(x1), this.Y(y1)); a.stroke();
    a.strokeStyle = 'rgba(255,255,255,0.07)'; a.lineWidth = 1; a.beginPath(); a.moveTo(this.X(x0) + 1.5, this.Y(y0) + 1.5); a.lineTo(this.X(x1) + 1.5, this.Y(y1) + 1.5); a.stroke();
    h.strokeStyle = '#202020'; h.lineWidth = Math.max(2, 0.0022 * this.k); h.beginPath(); h.moveTo(this.X(x0), this.Y(y0)); h.lineTo(this.X(x1), this.Y(y1)); h.stroke();
  }
  frame(x, y, w, h) { this.seam(x, y, x + w, y); this.seam(x + w, y, x + w, y + h); this.seam(x + w, y + h, x, y + h); this.seam(x, y + h, x, y); for (const [sx, sy] of [[x + 0.008, y + 0.008], [x + w - 0.008, y + 0.008], [x + 0.008, y + h - 0.008], [x + w - 0.008, y + h - 0.008]]) this.screw(sx, sy); }
  screw(x, y, r = 0.0032) {
    const { a, h } = this.at, X = this.X(x), Y = this.Y(y), R = r * this.k;
    const g = a.createRadialGradient(X - R * 0.3, Y - R * 0.3, R * 0.1, X, Y, R); g.addColorStop(0, '#c9ced4'); g.addColorStop(1, '#5c636b'); a.fillStyle = g; a.beginPath(); a.arc(X, Y, R, 0, 7); a.fill();
    a.strokeStyle = '#2a2e33'; a.lineWidth = Math.max(1, R * 0.35); const ang = rand() * Math.PI; a.beginPath(); a.moveTo(X - Math.cos(ang) * R * 0.75, Y - Math.sin(ang) * R * 0.75); a.lineTo(X + Math.cos(ang) * R * 0.75, Y + Math.sin(ang) * R * 0.75); a.stroke();
    const hg = h.createRadialGradient(X, Y, 0, X, Y, R); hg.addColorStop(0, '#d8d8d8'); hg.addColorStop(0.8, '#b0b0b0'); hg.addColorStop(1, '#808080'); h.fillStyle = hg; h.beginPath(); h.arc(X, Y, R, 0, 7); h.fill();
    h.strokeStyle = '#606060'; h.lineWidth = Math.max(1, R * 0.35); h.beginPath(); h.moveTo(X - Math.cos(ang) * R * 0.75, Y - Math.sin(ang) * R * 0.75); h.lineTo(X + Math.cos(ang) * R * 0.75, Y + Math.sin(ang) * R * 0.75); h.stroke();
  }
  // module title strip: white line with the title in a gap (Airbus/Boeing style panel graphics)
  title(t, x, y, w, size = 0.0105) { const tw = t.length * size * 0.62 + 0.012; this.line(x, y, x + w / 2 - tw / 2, y); this.line(x + w / 2 + tw / 2, y, x + w, y); this.text(t, x + w / 2, y, size, '#eef2f6', { weight: 700 }); }
  // worn paint along the region border (lighter scuffs)
  wear(n = 60) { const { a } = this.at, r = this.r; for (let i = 0; i < n; i++) { const side = (rand() * 4) | 0; const t = rand(); const x = side < 2 ? r.x + t * r.w : side === 2 ? r.x + rand() * 6 : r.x + r.w - rand() * 6; const y = side >= 2 ? r.y + t * r.h : side === 0 ? r.y + rand() * 6 : r.y + r.h - rand() * 6; a.fillStyle = 'rgba(190,196,204,0.18)'; a.fillRect(x, y, 1 + rand() * 6, 1 + rand() * 2); } }
}

// ------------------------------------------------ geometry helpers
const V = (x, y, z) => new THREE.Vector3(x, y, z);
export { V };
// rounded polygon (3D, planar-ish): returns sampled closed outline with fillet radius r at each corner
export function filletOutline(pts, r, seg = 5) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const P = pts[i], A = pts[(i + pts.length - 1) % pts.length], B = pts[(i + 1) % pts.length];
    const u1 = A.clone().sub(P), u2 = B.clone().sub(P); const l1 = u1.length(), l2 = u2.length(); u1.divideScalar(l1); u2.divideScalar(l2);
    const th = Math.acos(THREE.MathUtils.clamp(u1.dot(u2), -1, 1)); const d = Math.min(r / Math.tan(th / 2), l1 * 0.45, l2 * 0.45);
    const s = P.clone().addScaledVector(u1, d), e = P.clone().addScaledVector(u2, d);
    for (let k = 0; k <= seg; k++) { const t = k / seg; out.push(s.clone().multiplyScalar((1 - t) * (1 - t)).addScaledVector(P, 2 * t * (1 - t)).addScaledVector(e, t * t)); }
  }
  return out;
}
// subdivide a closed polyline so no segment is longer than `maxLen`
export function densify(pts, maxLen = 0.05) { const out = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const n = Math.max(1, Math.ceil(a.distanceTo(b) / maxLen)); for (let k = 0; k < n; k++) out.push(a.clone().lerp(b, k / n)); } return out; }
// sweep a 2D profile [(o = outward in-plane, d = depth toward the inside)] along a closed outline.
// `inward(i)` gives the inside-facing normal at point i (toward the cockpit), the outline must be ordered consistently.
export function sweepFrame(outline, inward, profile) {
  const n = outline.length, m = profile.length; const P = [], I = [];
  for (let i = 0; i < n; i++) {
    const p = outline[i], a = outline[(i + n - 1) % n], b = outline[(i + 1) % n]; const N = inward(i);
    const t = b.clone().sub(a).normalize(); let o = t.clone().cross(N).normalize(); // in-plane perpendicular
    // make `o` point away from the outline centroid (outward)
    if (!sweepFrame._c || sweepFrame._o !== outline) { sweepFrame._c = outline.reduce((s, q) => s.add(q), V(0, 0, 0)).divideScalar(n); sweepFrame._o = outline; }
    if (o.dot(p.clone().sub(sweepFrame._c)) < 0) o.negate();
    for (const [ou, dd] of profile) P.push(p.x + o.x * ou + N.x * dd, p.y + o.y * ou + N.y * dd, p.z + o.z * ou + N.z * dd);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m - 1; j++) { const a = i * m + j, b = ((i + 1) % n) * m + j; I.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
}
// grid surface from a function f(u,v) → Vector3 over [0,1]²; `skip(u,v)` drops cells (window holes)
export function gridSurface(f, nu, nv, skip, us, vs) {
  const U = us || Array.from({ length: nu + 1 }, (_, i) => i / nu), Vv = vs || Array.from({ length: nv + 1 }, (_, j) => j / nv);
  const P = [], I = [], UV = []; const W = Vv.length;
  for (const u of U) for (const v of Vv) { const p = f(u, v); P.push(p.x, p.y, p.z); UV.push(u, v); }
  for (let i = 0; i < U.length - 1; i++) for (let j = 0; j < W - 1; j++) {
    if (skip && skip((U[i] + U[i + 1]) / 2, (Vv[j] + Vv[j + 1]) / 2)) continue;
    const a = i * W + j, b = (i + 1) * W + j; I.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I); g.computeVertexNormals(); return g;
}
// strip between two polylines of equal length
export function strip(A, B) {
  const P = [], I = []; for (let i = 0; i < A.length; i++) { P.push(A[i].x, A[i].y, A[i].z, B[i].x, B[i].y, B[i].z); if (i) { const a = (i - 1) * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
}
export function polyLerp(pts, n) { // resample an open polyline to n points evenly by length
  const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + pts[i].distanceTo(pts[i - 1])); const T = L[L.length - 1]; const out = [];
  for (let k = 0; k < n; k++) { const s = k / (n - 1) * T; let i = 1; while (i < pts.length - 1 && L[i] < s) i++; const t = (s - L[i - 1]) / Math.max(1e-9, L[i] - L[i - 1]); out.push(pts[i - 1].clone().lerp(pts[i], THREE.MathUtils.clamp(t, 0, 1))); }
  return out;
}
// rounded-rectangle shape (optionally with a rounded-rect hole) for bevelled extrusions
export function rrShape(w, h, r, hole) {
  const s = new THREE.Shape(); const x = -w / 2, y = -h / 2; s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  if (hole) { const [hw, hh, hr, hx = 0, hy = 0] = hole; const p = new THREE.Path(); const X = hx - hw / 2, Y = hy - hh / 2; p.moveTo(X + hr, Y); p.quadraticCurveTo(X, Y, X, Y + hr); p.lineTo(X, Y + hh - hr); p.quadraticCurveTo(X, Y + hh, X + hr, Y + hh); p.lineTo(X + hw - hr, Y + hh); p.quadraticCurveTo(X + hw, Y + hh, X + hw, Y + hh - hr); p.lineTo(X + hw, Y + hr); p.quadraticCurveTo(X + hw, Y, X + hw - hr, Y); p.lineTo(X + hr, Y); s.holes.push(p); }
  return s;
}
export function bevelBox(w, h, d, r = 0.006, bevel = 0.004) { // extruded rounded rect, centred, depth along +z
  const g = new THREE.ExtrudeGeometry(rrShape(w, h, r), { depth: Math.max(0.001, d - bevel * 2), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 }); g.translate(0, 0, -d / 2 + bevel); return g;
}
// knurled knob: lathe profile with ridges, axis along +y
export function knob(r = 0.012, h = 0.016, ridges = 24, cap = true) {
  const g = new THREE.CylinderGeometry(r, r * 1.04, h, ridges * 2, 1, !cap); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), y = p.getY(i); const a = Math.atan2(z, x); const rr = Math.hypot(x, z); if (rr > r * 0.5) { const k = (Math.round(a / (Math.PI * 2) * ridges * 2) % 2) ? 0.92 : 1; p.setX(i, x * k); p.setZ(i, z * k); } }
  g.translate(0, h / 2, 0); g.computeVertexNormals(); return g;
}

// ------------------------------------------------ merge builder with baked AO + box-mapped UVs
export class Merge {
  constructor(aoFn) { this.ao = aoFn; this.parts = {}; }
  add(geo, key, matrix, opts = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone(); if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal, cnt = p.count;
    if (opts.boxUV || !g.attributes.uv) { const s = 1 / (opts.uvScale || 0.25); const uv = new Float32Array(cnt * 2); for (let i = 0; i < cnt; i++) { const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)); let u, v; if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); } uv[i * 2] = u * s; uv[i * 2 + 1] = v * s; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); }
    const c = new Float32Array(cnt * 3); const tint = opts.tint || [1, 1, 1]; const tmpP = new THREE.Vector3(), tmpN = new THREE.Vector3();
    for (let i = 0; i < cnt; i++) { tmpP.fromBufferAttribute(p, i); tmpN.fromBufferAttribute(n, i); const a = opts.noAO ? 1 : this.ao(tmpP, tmpN); c[i * 3] = a * tint[0]; c[i * 3 + 1] = a * tint[1]; c[i * 3 + 2] = a * tint[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    (this.parts[key] = this.parts[key] || []).push(g); return g;
  }
  build(mats, group, shadow = true) {
    const meshes = {};
    for (const k in this.parts) { const g = mergeGeometries(this.parts[k], false); if (!g) { console.warn('merge failed', k); continue; } g.computeBoundingSphere(); const m = new THREE.Mesh(g, mats[k]); m.castShadow = shadow && !mats[k].transparent; m.receiveShadow = shadow; m.name = 'deck-' + k; m.frustumCulled = false; group.add(m); meshes[k] = m; }
    this.parts = {}; return meshes;
  }
}
