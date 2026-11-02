// Aircraft-art helpers: curves, procedural canvas textures (height -> normal), lathe/loft geometry, merging.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// monotone cubic (PCHIP) through [[x, y], ...] sorted by x
export function pchip(pts) {
  const n = pts.length, x = pts.map(p => p[0]), y = pts.map(p => p[1]), h = [], d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h[i] = x[i + 1] - x[i]; d[i] = (y[i + 1] - y[i]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) { if (d[i - 1] * d[i] <= 0) m[i] = 0; else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); } }
  return t => {
    if (t <= x[0]) return y[0]; if (t >= x[n - 1]) return y[n - 1];
    let i = 0; while (i < n - 2 && t > x[i + 1]) i++;
    const s = (t - x[i]) / h[i], s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * y[i] + (s3 - 2 * s2 + s) * h[i] * m[i] + (-2 * s3 + 3 * s2) * y[i + 1] + (s3 - s2) * h[i] * m[i + 1];
  };
}

// ---------------------------------------------------------------- canvases & textures
export function canvas(w, h = w) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return { cv, c: cv.getContext('2d', { willReadFrequently: true }) }; }
export function tex(cv, o = {}) {
  const t = new THREE.CanvasTexture(cv); if (o.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = o.aniso ?? 8; if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } if (o.wrapS) t.wrapS = o.wrapS; if (o.wrapT) t.wrapT = o.wrapT;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
}
// grey height canvas (128 = neutral) -> tangent-space normal canvas (OpenGL convention, canvas y down = -v)
export function heightToNormal(hcv, strength = 2, wrap = true, alphaFrom = null) {
  const w = hcv.width, h = hcv.height; const src = hcv.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h); const img = out.c.createImageData(w, h), D = img.data; const al = alphaFrom ? alphaFrom.getContext('2d').getImageData(0, 0, w, h).data : null;
  const H = new Float32Array(w * h); for (let i = 0; i < w * h; i++) H[i] = src[i * 4] / 255;
  for (let y = 0; y < h; y++) {
    const y0 = wrap ? (y - 1 + h) % h : Math.max(0, y - 1), y1 = wrap ? (y + 1) % h : Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const x0 = wrap ? (x - 1 + w) % w : Math.max(0, x - 1), x1 = wrap ? (x + 1) % w : Math.min(w - 1, x + 1);
      const dx = (H[y * w + x1] - H[y * w + x0]) * strength, dy = (H[y1 * w + x] - H[y0 * w + x]) * strength;
      let nx = -dx, ny = dy, nz = 1; const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz); nx *= l; ny *= l; nz *= l;
      const o = (y * w + x) * 4; D[o] = (nx * 0.5 + 0.5) * 255; D[o + 1] = (ny * 0.5 + 0.5) * 255; D[o + 2] = (nz * 0.5 + 0.5) * 255; D[o + 3] = al ? al[o] : 255;
    }
  }
  out.c.putImageData(img, 0, 0); return out.cv;
}
export function roundRect(c, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
export function speckle(c, w, h, n, col, a, size = 2, R = Math.random) { c.save(); c.globalAlpha = a; for (let i = 0; i < n; i++) { c.fillStyle = typeof col === 'function' ? col(R()) : col; const s = size * (0.5 + R()); c.fillRect(R() * w, R() * h, s, s); } c.restore(); }

// ---------------------------------------------------------------- geometry
// lathe around +z (forward = -z): prof [[r, z], ...]; normals from the 2-D profile (traverse direction decides the side);
// u = around (0 bottom, .25 right, .5 top), v = along the profile (by arc length)
export function latheZ(prof, seg, o = {}) {
  const n = prof.length, P = [], N = [], U = [], I = [];
  const L = [0]; for (let i = 1; i < n; i++) L.push(L[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1])); const LL = L[n - 1] || 1;
  for (let i = 0; i < n; i++) {
    const a = prof[Math.max(0, i - 1)], b = prof[Math.min(n - 1, i + 1)]; const tr = b[0] - a[0], tz = b[1] - a[1]; let nr = tz, nz = -tr; const l = Math.hypot(nr, nz) || 1; nr /= l; nz /= l; if (o.flip) { nr = -nr; nz = -nz; }
    for (let j = 0; j <= seg; j++) { const ph = j / seg * Math.PI * 2, s = Math.sin(ph), c = -Math.cos(ph); P.push(s * prof[i][0], c * prof[i][0], prof[i][1]); N.push(s * nr, c * nr, nz); U.push(j / seg, (o.uvLen ? L[i] / LL : i / (n - 1))); }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) { const a = i * (seg + 1) + j, b = a + 1, c = a + seg + 1, d = c + 1; if (o.flip) I.push(a, c, b, b, c, d); else I.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); return g;
}
// lofted superellipse: sec(t) -> { cx, cy, cz, hx, hz, n } for t in [0,1] (sections lie in x-z planes stacked along y)
export function loftSE(nA, nB, sec, uvScale = 1) {
  const P = [], U = [], I = [];
  for (let b = 0; b <= nB; b++) { const S = sec(b / nB); const e = 2 / (S.n || 2);
    for (let a = 0; a <= nA; a++) { const ang = a / nA * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang); P.push(S.cx + S.hx * Math.sign(ca) * Math.pow(Math.abs(ca), e), S.cy, S.cz + S.hz * Math.sign(sa) * Math.pow(Math.abs(sa), e)); U.push(a / nA * uvScale, b / nB); } }
  for (let b = 0; b < nB; b++) for (let a = 0; a < nA; a++) { const i0 = b * (nA + 1) + a, i1 = i0 + 1, i2 = i0 + nA + 1, i3 = i2 + 1; I.push(i0, i2, i1, i1, i2, i3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals();
  // weld the seam normals
  const N = g.attributes.normal; for (let b = 0; b <= nB; b++) { const i0 = b * (nA + 1), i1 = i0 + nA; const x = N.getX(i0) + N.getX(i1), y = N.getY(i0) + N.getY(i1), z = N.getZ(i0) + N.getZ(i1); const l = Math.hypot(x, y, z) || 1; N.setXYZ(i0, x / l, y / l, z / l); N.setXYZ(i1, x / l, y / l, z / l); }
  return g;
}
// keep only the given attributes (filling missing ones), non-indexed, then merge
export function mergeAll(list, keys = ['position', 'normal', 'uv']) {
  const out = list.filter(Boolean).map(g => { const n = g.index ? g.toNonIndexed() : g.clone(); for (const k of Object.keys(n.attributes)) if (!keys.includes(k)) n.deleteAttribute(k);
    for (const k of keys) if (!n.attributes[k]) { const sz = k === 'uv' ? 2 : k === 'aTile' || k === 'aBake' ? 4 : 3; n.setAttribute(k, new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * sz), sz)); } return n; });
  if (!out.length) return new THREE.BufferGeometry();
  const g = mergeGeometries(out); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
}
// per-vertex constant attribute
export function attr(g, name, vals) { const n = g.attributes.position.count, sz = vals.length, a = new Float32Array(n * sz); for (let i = 0; i < n; i++) a.set(vals, i * sz); g.setAttribute(name, new THREE.BufferAttribute(a, sz)); return g; }
// box-projected uv (per face, non-indexed) in metres / scale
export function boxUV(g, scale = 1) {
  const n = g.index ? g.toNonIndexed() : g; const P = n.attributes.position, U = new Float32Array(P.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3();
  for (let i = 0; i < P.count; i += 3) { a.fromBufferAttribute(P, i); b.fromBufferAttribute(P, i + 1); c.fromBufferAttribute(P, i + 2); f.subVectors(b, a).cross(c.clone().sub(a)); const ax = Math.abs(f.x), ay = Math.abs(f.y), az = Math.abs(f.z);
    for (let k = 0; k < 3; k++) { const p = [a, b, c][k]; let u, v; if (ax >= ay && ax >= az) { u = p.z * Math.sign(f.x); v = p.y; } else if (ay >= az) { u = p.x; v = p.z * -Math.sign(f.y); } else { u = -p.x * Math.sign(f.z); v = p.y; } U[(i + k) * 2] = u / scale; U[(i + k) * 2 + 1] = v / scale; } }
  n.setAttribute('uv', new THREE.BufferAttribute(U, 2)); return n;
}
// orient a tube/extrusion between two points (cylinder along +y in its own frame)
export function between(geo, a, b) { const d = b.clone().sub(a), L = d.length(); const g = geo.clone(); g.scale(1, L, 1); g.translate(0, L / 2, 0); const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()); g.applyQuaternion(q); g.translate(a.x, a.y, a.z); return g; }
