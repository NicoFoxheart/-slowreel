// People geometry core (no three.js dependency): signed-distance sculpting, narrow-band surface nets,
// smooth clipping (marching triangles) with hem bands, SDF ambient occlusion, morph-target projection and
// primitive-driven skin weights. All units metres; bind pose Y up, character faces +Z.

// ---------------------------------------------------------------- primitives
// Each primitive: { f(x,y,z) → distance, lo/hi bounding box (for the conservative skip test), bones: [[bone, w]...], k: blend radius, sub: bool }
const sq = v => v * v, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function rotM(rx = 0, ry = 0, rz = 0) { // world→local 3x3 (inverse of Rz*Ry*Rx)
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Ry * Rx * Rz (YXZ like three); inverse = transpose
  const m = [cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx, cx * sz, cx * cz, -sx, -sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx];
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}
export const P = {
  sph(c, r, o = {}) { const [cx, cy, cz] = c; return prim(o, (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r, [cx - r, cy - r, cz - r], [cx + r, cy + r, cz + r]); },
  ell(c, rr, o = {}) { // approximate ellipsoid (IQ), optional rotation o.rot=[rx,ry,rz]
    const [cx, cy, cz] = c, [a, b, d] = rr, M = o.rot ? rotM(...o.rot) : null; const R = Math.max(a, b, d);
    return prim(o, (x, y, z) => { let px = x - cx, py = y - cy, pz = z - cz; if (M) { const qx = M[0] * px + M[1] * py + M[2] * pz, qy = M[3] * px + M[4] * py + M[5] * pz, qz = M[6] * px + M[7] * py + M[8] * pz; px = qx; py = qy; pz = qz; }
      const k0 = Math.hypot(px / a, py / b, pz / d), k1 = Math.hypot(px / (a * a), py / (b * b), pz / (d * d)); return k1 < 1e-9 ? -Math.min(a, b, d) : k0 * (k0 - 1) / k1; }, M ? [cx - R, cy - R, cz - R] : [cx - a, cy - b, cz - d], M ? [cx + R, cy + R, cz + R] : [cx + a, cy + b, cz + d]);
  },
  cap(a, b, r, o = {}) { return P.cone(a, b, r, r, o); },
  cone(a, b, ra, rb, o = {}) { // round cone between points (IQ sdRoundCone, arbitrary points)
    const [ax, ay, az] = a, bx = b[0] - ax, by = b[1] - ay, bz = b[2] - az; const l2 = bx * bx + by * by + bz * bz, rr = ra - rb, a2 = l2 - rr * rr, il2 = 1 / l2; const R = Math.max(ra, rb);
    return prim(o, (x, y, z) => { const px = x - ax, py = y - ay, pz = z - az; const yv = px * bx + py * by + pz * bz, zv = yv - l2;
      const qx = px * l2 - bx * yv, qy = py * l2 - by * yv, qz = pz * l2 - bz * yv; const x2 = qx * qx + qy * qy + qz * qz, y2 = yv * yv * l2, z2 = zv * zv * l2; const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb; if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra; return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - ra; },
      [Math.min(ax, b[0]) - R, Math.min(ay, b[1]) - R, Math.min(az, b[2]) - R], [Math.max(ax, b[0]) + R, Math.max(ay, b[1]) + R, Math.max(az, b[2]) + R]);
  },
  box(c, h, r = 0, o = {}) { // rounded box, half sizes h, optional rotation
    const [cx, cy, cz] = c, [hx, hy, hz] = h, M = o.rot ? rotM(...o.rot) : null; const R = Math.hypot(hx, hy, hz);
    return prim(o, (x, y, z) => { let px = x - cx, py = y - cy, pz = z - cz; if (M) { const qx = M[0] * px + M[1] * py + M[2] * pz, qy = M[3] * px + M[4] * py + M[5] * pz, qz = M[6] * px + M[7] * py + M[8] * pz; px = qx; py = qy; pz = qz; }
      const qx = Math.abs(px) - hx + r, qy = Math.abs(py) - hy + r, qz = Math.abs(pz) - hz + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r; },
      M ? [cx - R, cy - R, cz - R] : [cx - hx, cy - hy, cz - hz], M ? [cx + R, cy + R, cz + R] : [cx + hx, cy + hy, cz + hz]);
  },
  fn(f, lo, hi, o = {}) { return prim(o, f, lo, hi); },
};
function prim(o, f, lo, hi) { return { f, lo, hi, k: o.k ?? 0.02, sub: !!o.sub, inter: !!o.inter, bones: o.bones || [], tag: o.tag || '', w: o.w ?? 1 }; }
export const mirror = (p, fac) => fac(p); // helper for readability

export function smin(a, b, k) { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
export function smax(a, b, k) { return -smin(-a, -b, k); }
function boxDist(p, lo, hi) { const dx = Math.max(lo[0] - p[0], 0, p[0] - hi[0]), dy = Math.max(lo[1] - p[1], 0, p[1] - hi[1]), dz = Math.max(lo[2] - p[2], 0, p[2] - hi[2]); return Math.sqrt(dx * dx + dy * dy + dz * dz); }

// A shape is an ordered list of primitives combined by smooth union / subtraction / intersection.
export class Shape {
  constructor(prims = []) { this.prims = prims; this._p = [0, 0, 0]; this.lo = [1e9, 1e9, 1e9]; this.hi = [-1e9, -1e9, -1e9]; for (const q of prims) if (!q.sub) for (let i = 0; i < 3; i++) { this.lo[i] = Math.min(this.lo[i], q.lo[i]); this.hi[i] = Math.max(this.hi[i], q.hi[i]); } }
  bound(x, y, z) { this._p[0] = x; this._p[1] = y; this._p[2] = z; return boxDist(this._p, this.lo, this.hi); }
  add(...ps) { for (const p of ps) if (p) this.prims.push(p); return this; }
  // spatial bins of candidate primitives (exact within M of the surface; conservative beyond)
  _bin() { const M = 0.14, C = this.cell || 0.05; this.M = M; const lo = this.lo.map(v => v - M), hi = this.hi.map(v => v + M); const n = [0, 1, 2].map(i => Math.max(1, Math.ceil((hi[i] - lo[i]) / C)));
    this.bl = lo; this.bn = n; this.bc = C; this.bins = new Array(n[0] * n[1] * n[2]);
    for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) { const c0 = [lo[0] + i * C, lo[1] + j * C, lo[2] + k * C], c1 = [c0[0] + C, c0[1] + C, c0[2] + C]; const L = [];
      this.prims.forEach((q, qi) => { const e = M + q.k; if (q.inter || (q.lo[0] - e < c1[0] && q.hi[0] + e > c0[0] && q.lo[1] - e < c1[1] && q.hi[1] + e > c0[1] && q.lo[2] - e < c1[2] && q.hi[2] + e > c0[2])) L.push(q); });
      this.bins[i + n[0] * (j + n[1] * k)] = L; } }
  eval(x, y, z) {
    if (!this.bins) this._bin();
    const bi = Math.floor((x - this.bl[0]) / this.bc), bj = Math.floor((y - this.bl[1]) / this.bc), bk = Math.floor((z - this.bl[2]) / this.bc), n = this.bn;
    const P = (bi < 0 || bj < 0 || bk < 0 || bi >= n[0] || bj >= n[1] || bk >= n[2]) ? null : this.bins[bi + n[0] * (bj + n[1] * bk)];
    if (P && !P.length) return this.M; // nothing within M
    const L = P || this.prims, p = this._p; p[0] = x; p[1] = y; p[2] = z; let d = P ? 1e3 : 1e3;
    for (let i = 0; i < L.length; i++) { const q = L[i];
      if (q.sub) { const lb = boxDist(p, q.lo, q.hi); if (lb > q.k - d && lb > q.k) continue; d = smax(d, -q.f(x, y, z), q.k); }
      else if (q.inter) d = smax(d, q.f(x, y, z), q.k);
      else { const lb = boxDist(p, q.lo, q.hi); if (lb >= d + q.k) continue; d = smin(d, q.f(x, y, z), q.k); } }
    return P ? Math.min(d, this.M) : d;
  }
  get fn() { return (x, y, z) => this.eval(x, y, z); }
}

// ---------------------------------------------------------------- surface nets (narrow band, lazy)
export function axis(a, b, sp) { const o = [a]; let x = a; while (x < b) { x += sp(x); o.push(x); } return o; }
export function polygonize(f, b, h, o = {}) {
  const xs = o.xs || axis(b[0], b[3], () => h), ys = o.ys || axis(b[1], b[4], () => h), zs = o.zs || axis(b[2], b[5], () => h);
  const nx = xs.length, ny = ys.length, nz = zs.length; let hmin = h; for (const A of [xs, ys, zs]) for (let i = 1; i < A.length; i++) hmin = Math.min(hmin, A[i] - A[i - 1]);
  const val = new Float32Array(nx * ny * nz).fill(NaN);
  const at = (i, j, k) => { const id = i + nx * (j + ny * k); let v = val[id]; if (v !== v) { v = f(xs[i], ys[j], zs[k]); if (v === 0) v = 1e-7; val[id] = v; } return v; };
  const cx = nx - 1, cy = ny - 1, cz = nz - 1, cell = new Int32Array(cx * cy * cz).fill(-1);
  const P = [], N = [], I = [];
  const eps = o.eps || Math.min(hmin * 0.25, 0.0012);
  const grad = (x, y, z, out) => { out[0] = f(x + eps, y, z) - f(x - eps, y, z); out[1] = f(x, y + eps, z) - f(x, y - eps, z); out[2] = f(x, y, z + eps) - f(x, y, z - eps); const l = Math.hypot(out[0], out[1], out[2]) || 1; out[0] /= l; out[1] /= l; out[2] /= l; return out; };
  const fgrad = (x, y, z, d, out) => { out[0] = f(x + eps, y, z) - d; out[1] = f(x, y + eps, z) - d; out[2] = f(x, y, z + eps) - d; const l = Math.hypot(out[0], out[1], out[2]) || 1; out[0] /= l; out[1] /= l; out[2] /= l; return out; };
  const g = [0, 0, 0], cv = new Float64Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const vert = (i, j, k) => { // vertex for cell (i,j,k), created on demand
    if (i < 0 || j < 0 || k < 0 || i >= cx || j >= cy || k >= cz) return -1; const id = i + cx * (j + cy * k); if (cell[id] >= 0) return cell[id];
    let neg = 0; for (let c = 0; c < 8; c++) { cv[c] = at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1)); if (cv[c] < 0) neg++; }
    if (neg === 0 || neg === 8) { cell[id] = -2; return -1; }
    const X0 = xs[i], Y0 = ys[j], Z0 = zs[k], DX = xs[i + 1] - X0, DY = ys[j + 1] - Y0, DZ = zs[k + 1] - Z0;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, bb] of EDGES) { const va = cv[a], vb = cv[bb]; if ((va < 0) === (vb < 0)) continue; const t = va / (va - vb);
      const ax = a & 1, ay = (a >> 1) & 1, az = (a >> 2) & 1, bx = bb & 1, by = (bb >> 1) & 1, bz = (bb >> 2) & 1; sx += ax + (bx - ax) * t; sy += ay + (by - ay) * t; sz += az + (bz - az) * t; n++; }
    let px = X0 + sx / n * DX, py = Y0 + sy / n * DY, pz = Z0 + sz / n * DZ; const ox = px, oy = py, oz = pz;
    for (let it = 0; it < 2; it++) { const d = f(px, py, pz); fgrad(px, py, pz, d, g); px -= g[0] * d; py -= g[1] * d; pz -= g[2] * d; }
    const dx = px - ox, dy = py - oy, dz = pz - oz, dl = Math.hypot(dx, dy, dz), lim = Math.min(DX, DY, DZ) * 0.7; if (dl > lim) { px = ox + dx / dl * lim; py = oy + dy / dl * lim; pz = oz + dz / dl * lim; }
    fgrad(px, py, pz, f(px, py, pz), g); const vi = P.length / 3; P.push(px, py, pz); N.push(g[0], g[1], g[2]); cell[id] = vi; return vi;
  };
  const quad = (a, b2, c, d, axis, outPos) => { if (a < 0 || b2 < 0 || c < 0 || d < 0) return;
    const ux = P[c * 3] - P[a * 3], uy = P[c * 3 + 1] - P[a * 3 + 1], uz = P[c * 3 + 2] - P[a * 3 + 2], vx = P[d * 3] - P[b2 * 3], vy = P[d * 3 + 1] - P[b2 * 3 + 1], vz = P[d * 3 + 2] - P[b2 * 3 + 2];
    const nn = axis === 0 ? uy * vz - uz * vy : axis === 1 ? uz * vx - ux * vz : ux * vy - uy * vx; if ((nn > 0) !== outPos) { const t = b2; b2 = d; d = t; }
    const d1 = ux * ux + uy * uy + uz * uz, d2 = vx * vx + vy * vy + vz * vz;
    if (d1 < d2) I.push(a, b2, c, a, c, d); else I.push(a, b2, d, b2, c, d); };
  // walk active blocks
  const B = 4;
  for (let bk = 0; bk < cz; bk += B) for (let bj = 0; bj < cy; bj += B) for (let bi = 0; bi < cx; bi += B) {
    const i1 = Math.min(bi + B, cx), j1 = Math.min(bj + B, cy), k1 = Math.min(bk + B, cz);
    const hx = (xs[i1] - xs[bi]) / 2, hy = (ys[j1] - ys[bj]) / 2, hz = (zs[k1] - zs[bk]) / 2, rad = Math.hypot(hx + (xs[Math.min(i1 + 1, cx)] - xs[i1]), hy + (ys[Math.min(j1 + 1, cy)] - ys[j1]), hz + (zs[Math.min(k1 + 1, cz)] - zs[k1])) * 1.6 + hmin;
    if (Math.abs(f(xs[bi] + hx, ys[bj] + hy, zs[bk] + hz)) > rad) continue;
    for (let k = bk; k < k1; k++) for (let j = bj; j < j1; j++) for (let i = bi; i < i1; i++) {
      const v0 = at(i, j, k);
      if (j > 0 && k > 0) { const v1 = at(i + 1, j, k); if ((v0 < 0) !== (v1 < 0)) quad(vert(i, j - 1, k - 1), vert(i, j, k - 1), vert(i, j, k), vert(i, j - 1, k), 0, v0 < 0); }
      if (i > 0 && k > 0) { const v1 = at(i, j + 1, k); if ((v0 < 0) !== (v1 < 0)) quad(vert(i - 1, j, k - 1), vert(i - 1, j, k), vert(i, j, k), vert(i, j, k - 1), 1, v0 < 0); }
      if (i > 0 && j > 0) { const v1 = at(i, j, k + 1); if ((v0 < 0) !== (v1 < 0)) quad(vert(i - 1, j - 1, k), vert(i, j - 1, k), vert(i, j, k), vert(i - 1, j, k), 2, v0 < 0); }
    }
  }
  const m = { P: new Float32Array(P), N: new Float32Array(N), I: new Uint32Array(I), A: {} };
  return m;
}
// make triangle winding agree with the vertex normals (outward)
function fixWinding(m) {
  const { P, N, I } = m; let agree = 0;
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; if (nx * N[a] + ny * N[a + 1] + nz * N[a + 2] > 0) agree++; else agree--; }
  if (agree < 0) for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; }
}

// ---------------------------------------------------------------- mesh utilities
export function vcount(m) { return m.P.length / 3; }
// per-vertex scalar field from a function of (x,y,z,i)
export function field(m, fn) { const n = vcount(m), o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = fn(m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2], i); return o; }
// keep the part where s >= 0 (s: per-vertex values or a function). Cuts edges smoothly; attributes interpolate.
export function clip(m, s) {
  if (typeof s === 'function') s = field(m, s);
  const n = vcount(m), names = Object.keys(m.A), map = new Int32Array(n).fill(-1);
  const P = [], N = [], A = {}; for (const k of names) A[k] = [];
  const copy = i => { if (map[i] >= 0) return map[i]; const v = P.length / 3; P.push(m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2]); N.push(m.N[i * 3], m.N[i * 3 + 1], m.N[i * 3 + 2]); for (const k of names) { const a = m.A[k], sz = a.size; for (let c = 0; c < sz; c++) A[k].push(a.data[i * sz + c]); } map[i] = v; return v; };
  const cut = new Map();
  const edge = (i, j) => { const key = i < j ? i * n + j : j * n + i; let v = cut.get(key); if (v !== undefined) return v; const t = s[i] / (s[i] - s[j]); v = P.length / 3;
    for (let c = 0; c < 3; c++) P.push(m.P[i * 3 + c] + (m.P[j * 3 + c] - m.P[i * 3 + c]) * t);
    let nx = m.N[i * 3] + (m.N[j * 3] - m.N[i * 3]) * t, ny = m.N[i * 3 + 1] + (m.N[j * 3 + 1] - m.N[i * 3 + 1]) * t, nz = m.N[i * 3 + 2] + (m.N[j * 3 + 2] - m.N[i * 3 + 2]) * t; const l = Math.hypot(nx, ny, nz) || 1; N.push(nx / l, ny / l, nz / l);
    for (const k of names) { const a = m.A[k], sz = a.size; for (let c = 0; c < sz; c++) A[k].push(a.data[i * sz + c] + (a.data[j * sz + c] - a.data[i * sz + c]) * t); }
    cut.set(key, v); return v; };
  const I = [], poly = [];
  for (let t = 0; t < m.I.length; t += 3) { const tri = [m.I[t], m.I[t + 1], m.I[t + 2]]; const ins = tri.map(i => s[i] >= 0);
    if (ins[0] && ins[1] && ins[2]) { I.push(copy(tri[0]), copy(tri[1]), copy(tri[2])); continue; } if (!ins[0] && !ins[1] && !ins[2]) continue;
    poly.length = 0; for (let e = 0; e < 3; e++) { const a = tri[e], b = tri[(e + 1) % 3], ia = ins[e], ib = ins[(e + 1) % 3]; if (ia) poly.push(copy(a)); if (ia !== ib) poly.push(edge(a, b)); }
    for (let q = 1; q + 1 < poly.length; q++) I.push(poly[0], poly[q], poly[q + 1]); }
  const out = { P: new Float32Array(P), N: new Float32Array(N), I: new Uint32Array(I), A: {} }; for (const k of names) out.A[k] = { data: new Float32Array(A[k]), size: m.A[k].size }; return out;
}
// boundary edges (directed as they appear in their triangle)
export function boundary(m) { const cnt = new Map(), n = vcount(m), dir = new Map();
  for (let t = 0; t < m.I.length; t += 3) for (let e = 0; e < 3; e++) { const a = m.I[t + e], b = m.I[t + (e + 1) % 3], key = a < b ? a * n + b : b * n + a; cnt.set(key, (cnt.get(key) || 0) + 1); dir.set(key, [a, b]); }
  const out = []; for (const [k, c] of cnt) if (c === 1) out.push(dir.get(k)); return out; }
// hem band: extrude every open boundary inward along -normal by depth; band faces point along the cut direction.
// opts.attr(name, srcIdx, isInner) may override attribute values for the band (e.g. mark hems).
export function hem(m, depth, o = {}) {
  const edges = boundary(m); if (!edges.length) return m; const names = Object.keys(m.A);
  const P = Array.from(m.P), N = Array.from(m.N), A = {}; for (const k of names) A[k] = Array.from(m.A[k].data); const I = Array.from(m.I);
  // cut direction at each boundary vertex: average of (edge midpoint → away from the adjacent triangle's centroid), projected on the tangent plane
  const outDir = new Map();
  const tri = new Map(); for (let t = 0; t < m.I.length; t += 3) for (let e = 0; e < 3; e++) { const a = m.I[t + e], b = m.I[t + (e + 1) % 3]; tri.set(a + ',' + b, t); }
  for (const [a, b] of edges) { const t = tri.get(a + ',' + b); const c = m.I[t] + m.I[t + 1] + m.I[t + 2] - a - b; const mx = (m.P[a * 3] + m.P[b * 3]) / 2, my = (m.P[a * 3 + 1] + m.P[b * 3 + 1]) / 2, mz = (m.P[a * 3 + 2] + m.P[b * 3 + 2]) / 2;
    const d = [mx - m.P[c * 3], my - m.P[c * 3 + 1], mz - m.P[c * 3 + 2]]; for (const v of [a, b]) { const o2 = outDir.get(v) || [0, 0, 0]; o2[0] += d[0]; o2[1] += d[1]; o2[2] += d[2]; outDir.set(v, o2); } }
  const outer = new Map(), inner = new Map();
  const push = (src, px, py, pz, nx, ny, nz, isInner) => { const v = P.length / 3; P.push(px, py, pz); N.push(nx, ny, nz); for (const k of names) { const a = m.A[k], sz = a.size; for (let c = 0; c < sz; c++) A[k].push(o.attr ? o.attr(k, c, a.data[src * sz + c], isInner) : a.data[src * sz + c]); } return v; };
  const mk = v => { if (outer.has(v)) return; const n0 = [m.N[v * 3], m.N[v * 3 + 1], m.N[v * 3 + 2]]; let d = outDir.get(v); const dn = d[0] * n0[0] + d[1] * n0[1] + d[2] * n0[2]; d = [d[0] - n0[0] * dn, d[1] - n0[1] * dn, d[2] - n0[2] * dn]; const l = Math.hypot(...d) || 1; d = d.map(x => x / l);
    const bn = [d[0] * 0.8 + n0[0] * 0.6, d[1] * 0.8 + n0[1] * 0.6, d[2] * 0.8 + n0[2] * 0.6]; const r = o.round ?? 0.25;
    outer.set(v, push(v, m.P[v * 3] + d[0] * depth * r, m.P[v * 3 + 1] + d[1] * depth * r, m.P[v * 3 + 2] + d[2] * depth * r, bn[0], bn[1], bn[2], false));
    inner.set(v, push(v, m.P[v * 3] - n0[0] * depth, m.P[v * 3 + 1] - n0[1] * depth, m.P[v * 3 + 2] - n0[2] * depth, d[0], d[1], d[2], true)); };
  for (const [a, b] of edges) { mk(a); mk(b); const ao = outer.get(a), bo = outer.get(b), ai = inner.get(a), bi = inner.get(b);
    I.push(b, a, ao, b, ao, bo); I.push(bo, ao, ai, bo, ai, bi); }
  const out = { P: new Float32Array(P), N: new Float32Array(N), I: new Uint32Array(I), A: {} }; for (const k of names) out.A[k] = { data: new Float32Array(A[k]), size: m.A[k].size }; return out;
}
export function merge(ms) { const names = Object.keys(ms[0].A); let nv = 0, ni = 0; for (const m of ms) { nv += vcount(m); ni += m.I.length; }
  const out = { P: new Float32Array(nv * 3), N: new Float32Array(nv * 3), I: new Uint32Array(ni), A: {} }; for (const k of names) out.A[k] = { data: new Float32Array(nv * ms[0].A[k].size), size: ms[0].A[k].size };
  let ov = 0, oi = 0; for (const m of ms) { out.P.set(m.P, ov * 3); out.N.set(m.N, ov * 3); for (let i = 0; i < m.I.length; i++) out.I[oi + i] = m.I[i] + ov; for (const k of names) out.A[k].data.set(m.A[k].data, ov * out.A[k].size); ov += vcount(m); oi += m.I.length; }
  return out; }
export function offset(m, fn) { const n = vcount(m), P = new Float32Array(m.P); for (let i = 0; i < n; i++) { const o = fn(m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2], i); for (let c = 0; c < 3; c++) P[i * 3 + c] += m.N[i * 3 + c] * o; } return { P, N: new Float32Array(m.N), I: new Uint32Array(m.I), A: Object.fromEntries(Object.entries(m.A).map(([k, a]) => [k, { data: new Float32Array(a.data), size: a.size }])) }; }
export function setAttr(m, name, size, fn) { const n = vcount(m), d = new Float32Array(n * size), tmp = new Array(size); for (let i = 0; i < n; i++) { fn(m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2], i, tmp, m.N[i * 3], m.N[i * 3 + 1], m.N[i * 3 + 2]); for (let c = 0; c < size; c++) d[i * size + c] = tmp[c]; } m.A[name] = { data: d, size }; return m; }

// ---------------------------------------------------------------- baking
export function bakeAO(m, f, o = {}) { // SDF ambient occlusion (two scales) into attribute 'ao'
  const n = vcount(m), d = new Float32Array(n), steps = o.steps || [[0.012, 1.0], [0.03, 0.7], [0.07, 0.45], [0.13, 0.25]], k = o.k ?? 1.6;
  const pos = o.pos || m.P;
  for (let i = 0; i < n; i++) { const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2], nx = m.N[i * 3], ny = m.N[i * 3 + 1], nz = m.N[i * 3 + 2]; let occ = 0, tot = 0;
    for (const [s, w] of steps) { const v = f(px + nx * s, py + ny * s, pz + nz * s); occ += w * Math.max(0, s - v) / s; tot += w; }
    d[i] = clamp(1 - k * occ / tot, 0.08, 1); }
  m.A.ao = { data: d, size: 1 }; return m; }
// mean curvature (SDF Laplacian = k1 + k2, 1/m) scaled to 0..1 per vertex, for the curvature-based skin scattering
export function bakeCurv(m, f, o = {}) { const n = vcount(m), e = o.eps || 0.004, sc = o.scale || 250, C = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = m.P[i * 3], y = m.P[i * 3 + 1], z = m.P[i * 3 + 2], c0 = f(x, y, z);
    const lap = (f(x + e, y, z) + f(x - e, y, z) + f(x, y + e, z) + f(x, y - e, z) + f(x, y, z + e) + f(x, y, z - e) - 6 * c0) / (e * e); C[i] = clamp(lap / sc, 0, 1); }
  return C; }
// morph target: project each vertex onto the variant SDF surface; returns a delta attribute
export function morph(m, f, name, o = {}) { const n = vcount(m), d = new Float32Array(n * 3), eps = 0.0008, mask = o.mask; const g = [0, 0, 0];
  for (let i = 0; i < n; i++) { const w = mask ? mask(m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2], i) : 1; if (w <= 0) continue; let x = m.P[i * 3], y = m.P[i * 3 + 1], z = m.P[i * 3 + 2]; const x0 = x, y0 = y, z0 = z; const off = o.off ? o.off[i] : 0;
    for (let it = 0; it < 4; it++) { const v = f(x, y, z) - off; if (Math.abs(v) < 2e-5) break; g[0] = f(x + eps, y, z) - f(x - eps, y, z); g[1] = f(x, y + eps, z) - f(x, y - eps, z); g[2] = f(x, y, z + eps) - f(x, y, z - eps); const l = Math.hypot(...g) || 1; x -= g[0] / l * v; y -= g[1] / l * v; z -= g[2] / l * v; }
    let dx = x - x0, dy = y - y0, dz = z - z0; const dl = Math.hypot(dx, dy, dz), lim = o.max || 0.08; if (dl > lim) { dx *= lim / dl; dy *= lim / dl; dz *= lim / dl; }
    d[i * 3] = dx * w; d[i * 3 + 1] = dy * w; d[i * 3 + 2] = dz * w; }
  m.A[name] = { data: d, size: 3 }; return m; }
// skin weights from primitive membership: w ∝ exp(-(d_k - d_min)/tau), summed per bone, top 4
export function skinWeights(m, prims, o = {}) {
  const n = vcount(m), SI = new Float32Array(n * 4), SW = new Float32Array(n * 4), tau = o.tau || 0.012, nb = o.nbones || 32, acc = new Float64Array(nb), pos = o.pos || m.P;
  const ps = prims.filter(p => !p.sub && p.bones.length), ds = new Float64Array(ps.length);
  for (let i = 0; i < n; i++) { const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]; let dmin = 1e9;
    for (let k = 0; k < ps.length; k++) { ds[k] = ps[k].f(x, y, z) / ps[k].w; if (ds[k] < dmin) dmin = ds[k]; }
    acc.fill(0); for (let k = 0; k < ps.length; k++) { const e = (ds[k] - dmin) / tau; if (e > 6) continue; const w = Math.exp(-e); for (const [b, bw] of ps[k].bones) acc[b] += w * bw; }
    if (o.override) o.override(x, y, z, acc);
    const top = []; for (let b = 0; b < nb; b++) if (acc[b] > 1e-4) top.push([acc[b], b]); top.sort((a, b) => b[0] - a[0]); top.length = Math.min(4, top.length); let s = 0; for (const t of top) s += t[0];
    for (let c = 0; c < 4; c++) { const t = top[c]; SI[i * 4 + c] = t ? t[1] : 0; SW[i * 4 + c] = t ? t[0] / s : 0; } }
  m.A.skinIndex = { data: SI, size: 4 }; m.A.skinWeight = { data: SW, size: 4 }; return m; }
export function constWeights(m, bone) { const n = vcount(m), SI = new Float32Array(n * 4), SW = new Float32Array(n * 4); for (let i = 0; i < n; i++) { SI[i * 4] = bone; SW[i * 4] = 1; } m.A.skinIndex = { data: SI, size: 4 }; m.A.skinWeight = { data: SW, size: 4 }; return m; }
export function ensure(m, name, size, v = 0) { if (!m.A[name]) m.A[name] = { data: new Float32Array(vcount(m) * size).fill(v), size }; return m; }
// light Taubin smoothing of positions (keeps volume); normals untouched unless renorm
export function smooth(m, iters = 2, lam = 0.5, mu = -0.53) { const n = vcount(m), nb = Array.from({ length: n }, () => new Set()); for (let t = 0; t < m.I.length; t += 3) for (let e = 0; e < 3; e++) { const a = m.I[t + e], b = m.I[t + (e + 1) % 3]; nb[a].add(b); nb[b].add(a); }
  const P = m.P, tmp = new Float32Array(P.length); for (let it = 0; it < iters * 2; it++) { const f = it % 2 ? mu : lam; for (let i = 0; i < n; i++) { let sx = 0, sy = 0, sz = 0, c = 0; for (const j of nb[i]) { sx += P[j * 3]; sy += P[j * 3 + 1]; sz += P[j * 3 + 2]; c++; } if (!c) { tmp.set([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], i * 3); continue; } tmp[i * 3] = P[i * 3] + f * (sx / c - P[i * 3]); tmp[i * 3 + 1] = P[i * 3 + 1] + f * (sy / c - P[i * 3 + 1]); tmp[i * 3 + 2] = P[i * 3 + 2] + f * (sz / c - P[i * 3 + 2]); } P.set(tmp); } return m; }
export function transform(m, fn) { const n = vcount(m), p = [0, 0, 0], q = [0, 0, 0]; for (let i = 0; i < n; i++) { p[0] = m.P[i * 3]; p[1] = m.P[i * 3 + 1]; p[2] = m.P[i * 3 + 2]; q[0] = m.N[i * 3]; q[1] = m.N[i * 3 + 1]; q[2] = m.N[i * 3 + 2]; fn(p, q); m.P.set(p, i * 3); const l = Math.hypot(...q) || 1; m.N.set([q[0] / l, q[1] / l, q[2] / l], i * 3); } return m; }
export { clamp, sq };
