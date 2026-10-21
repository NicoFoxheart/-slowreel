// aurora-snow-geo.js - procedural geometry for the "Northern lights" scene: snow-laden spruces (pagoda tiers that
// droop under the snow, jagged spokes, a feathered needle fringe, trunk, spire), a terrain grid that is dense near the
// camera and coarse far away, and a small log cabin. Plain typed arrays; core THREE passed in.

/**
 * A spruce of unit height (y 0..1), trunk at the origin. Attribute aTree = (rim 0..~1.15, height fraction or -1 trunk,
 * fringe 0..1). lod 0 (hero, ~1.1k tris), 1 (~350), 2 (far, ~60).
 */
export function spruceGeometry(THREE, rnd, lod = 0, light = false) {
  const tiers = (light ? [18, 10, 6] : [27, 13, 7])[lod], spokes = (light ? [13, 8, 6] : [19, 10, 6])[lod], fringe = lod < 2, inner = lod < 2;
  const P = [], A = [], I = [];
  const v = (x, y, z, rim, hf, fr) => { P.push(x, y, z); A.push(rim, hf, fr); return P.length / 3 - 1; };
  const tri = (a, b, c) => {     // wind so the face normal points up / outward (the snowy side is the front face)
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, wx = P[c * 3] - ax, wy = P[c * 3 + 1] - ay, wz = P[c * 3 + 2] - az;
    const ny = uz * wx - ux * wz;
    const cx = (ax + P[b * 3] + P[c * 3]) / 3, cz = (az + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
    const nx = uy * wz - uz * wy, nz = ux * wy - uy * wx;
    if (ny + 0.3 * (nx * cx + nz * cz) < 0) I.push(a, c, b); else I.push(a, b, c);
  };
  const base = 0.05 + rnd() * 0.06, width = 0.125 + rnd() * 0.05, lean = (rnd() - 0.5) * 0.012;
  for (let i = 0; i < tiers; i++) {
    const f = Math.min(1, (i + (i ? (rnd() - 0.5) * 0.8 : 0)) / (tiers - 0.6));
    const y = base + (0.95 - base) * Math.pow(f, 0.92);
    const R = width * Math.pow(1 - f, 0.75) * (0.62 + 0.6 * Math.pow(rnd(), 0.8)) * (1 + 0.25 * Math.sin(f * 9 + width * 40)) + 0.016;
    const droop = R * (0.48 + 0.4 * rnd()) * (1 - 0.35 * f);
    const yc = y + 0.012, ox = lean * y, oz = lean * 0.6 * y;
    const c = v(ox, yc, oz, 0, f, 0);
    const a0 = rnd() * Math.PI * 2, r1 = [], r2 = [], r3 = [], tx = (rnd() - 0.5) * 0.5 * droop, tz = (rnd() - 0.5) * 0.5 * droop;
    for (let j = 0; j < spokes; j++) {
      const a = a0 + (j + (rnd() - 0.5) * 0.55) / spokes * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const k = 0.58 + 0.62 * Math.pow(rnd(), 0.7), lump = (rnd() - 0.3) * 0.25 * droop;
      if (inner) r1.push(v(ox + ca * R * 0.5 * k, yc - droop * 0.28 + lump, oz + sa * R * 0.5 * k, 0.5, f, 0));
      const rr = R * k, yr = yc - droop * (0.8 + 0.4 * rnd()) * (0.7 + 0.3 * k) + tx * ca + tz * sa;
      r2.push(v(ox + ca * rr, yr, oz + sa * rr, 1, f, 0));
      if (fringe) { const fk = 1.3 + 0.25 * rnd(); r3.push(v(ox + ca * rr * fk, yr - droop * (0.3 + 0.35 * rnd()), oz + sa * rr * fk, 1.15, f, 1)); }
    }
    for (let j = 0; j < spokes; j++) {
      const n = (j + 1) % spokes;
      if (inner) { tri(c, r1[j], r1[n]); tri(r1[j], r2[j], r2[n]); tri(r1[j], r2[n], r1[n]); } else tri(c, r2[j], r2[n]);
      if (fringe) { tri(r2[j], r3[j], r3[n]); tri(r2[j], r3[n], r2[n]); }
    }
  }
  // spire
  const sp = v(lean, 1.0, lean * 0.6, 0.2, 1, 0), sr = [];
  for (let j = 0; j < 5; j++) { const a = j / 5 * Math.PI * 2; sr.push(v(lean * 0.95 + Math.cos(a) * 0.012, 0.9, lean * 0.57 + Math.sin(a) * 0.012, 0.6, 0.95, 0)); }
  for (let j = 0; j < 5; j++) tri(sp, sr[j], sr[(j + 1) % 5]);
  // trunk (hidden inside the crown except at the base)
  if (lod < 2) {
    const tr = 0.012 + 0.008 * rnd(), seg = 5, b0 = [], b1 = [];
    for (let j = 0; j < seg; j++) { const a = j / seg * Math.PI * 2; b0.push(v(Math.cos(a) * tr * 1.3, -0.02, Math.sin(a) * tr * 1.3, 0, -1, 0)); b1.push(v(Math.cos(a) * tr * 0.6 + lean * 0.5, 0.5, Math.sin(a) * tr * 0.6, 0, -1, 0)); }
    for (let j = 0; j < seg; j++) { const n = (j + 1) % seg; I.push(b0[j], b1[n], b1[j], b0[j], b0[n], b1[n]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aTree', new THREE.Float32BufferAttribute(A, 3));
  g.setIndex(I); g.computeVertexNormals();
  // soften normals outward so the crown reads as one rounded volume under soft light
  const p = g.attributes.position, nn = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    let x = nn.getX(i) + p.getX(i) * 1.5, y = nn.getY(i) + 0.25, z = nn.getZ(i) + p.getZ(i) * 1.5; const l = Math.hypot(x, y, z) || 1;
    nn.setXYZ(i, x / l, y / l, z / l);
  }
  g.computeBoundingSphere();
  return g;
}

/**
 * A terrain grid with quadratic spacing around (cx, cz): fine near the camera, coarse far. Columns cover
 * [x0, x1], rows [z0, z1] (z0 < cz < z1). height(x, z) and color(x, z, y) -> [r, g, b] fill position / colour; uv = xz / uvScale.
 */
export function terrainGrid(THREE, { x0, x1, z0, z1, cx = 0, cz = 0, segX = 200, segZ = 200, height, color, uvScale = 5 }) {
  const axis = (a0, a1, c, n) => {
    const out = new Float32Array(n + 1), nl = Math.max(2, Math.round(n * (c - a0) / (a1 - a0))), nr = n - nl;
    for (let i = 0; i <= nl; i++) { const u = 1 - i / nl; out[i] = c - (c - a0) * u * u; }
    for (let i = 1; i <= nr; i++) { const u = i / nr; out[nl + i] = c + (a1 - c) * u * u; }
    return out;
  };
  const xs = axis(x0, x1, cx, segX), zs = axis(z0, z1, cz, segZ);
  const nx = xs.length, nz = zs.length, pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = xs[i], z = zs[j], y = height(x, z);
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    const c = color ? color(x, z, y) : [0, 0, 0]; col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
    uv[k * 2] = x / uvScale; uv[k * 2 + 1] = z / uvScale;
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6); let q = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

/** Merge simple geometries (non-indexed or indexed) into one, keeping position/normal only. */
export function mergeSimple(THREE, geos) {
  const P = [], N = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.attributes.normal) g.computeVertexNormals();
    P.push(...g.attributes.position.array); N.push(...g.attributes.normal.array);
    if (g !== g0) g.dispose();
    g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  out.computeBoundingSphere();
  return out;
}

/**
 * A small log cabin (6 x 4.4 m, door side +z) as separate geometries: walls, roof snow, roof underside/eaves, chimney,
 * lit windows (front), dark window (side). Returns {walls, snow, eaves, chimney, windowLit, windowDim}.
 */
export function cabinGeometries(THREE) {
  const W = 6, D = 4.4, H = 2.5, ridge = 1.7, over = 0.45;
  const box = (w, h, d, x, y, z, ry = 0) => { const b = new THREE.BoxGeometry(w, h, d); if (ry) b.rotateY(ry); b.translate(x, y, z); return b; };
  const walls = mergeSimple(THREE, [box(W, H, D, 0, H / 2, 0), (() => {   // gable triangles
    const g = new THREE.BufferGeometry(), hw = W / 2 + 0.01, hd = D / 2;
    const p = [-hw, H, hd, hw, H, hd, 0, H + ridge, hd, hw, H, -hd, -hw, H, -hd, 0, H + ridge, -hd];
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals(); return g; })(),
  box(0.25, 0.4, D + 0.3, -W / 2 - 0.05, 0.2, 0), box(0.25, 0.4, D + 0.3, W / 2 + 0.05, 0.2, 0)]);
  const slope = Math.atan2(ridge, W / 2), len = Math.hypot(W / 2, ridge) + over;
  // place each half so its top edge meets at the ridge and it runs down to the eave
  const half = (side, th, lift) => {
    const b = new THREE.BoxGeometry(len, th, D + over * 2);
    b.translate(-len / 2, th / 2 + lift, 0);            // top-right corner at the origin (ridge)
    b.rotateZ(slope);
    if (side > 0) b.rotateY(Math.PI);
    b.translate(0, H + ridge + 0.02, 0);
    return b;
  };
  const eaves = mergeSimple(THREE, [half(-1, 0.14, 0), half(1, 0.14, 0)]);
  const snow = mergeSimple(THREE, [half(-1, 0.32, 0.12), half(1, 0.32, 0.12), box(W + 0.7, 0.18, D + 0.7, 0, 0.0, 0)]);
  const chimney = mergeSimple(THREE, [box(0.55, 1.5, 0.55, 1.5, H + ridge - 0.1, -0.8)]);
  const windowLit = mergeSimple(THREE, [box(0.95, 0.8, 0.05, -1.4, 1.45, D / 2 + 0.02), box(0.7, 0.6, 0.05, 1.7, 1.5, D / 2 + 0.02)]);
  const windowDim = mergeSimple(THREE, [box(0.05, 0.75, 0.9, W / 2 + 0.02, 1.45, 0.6)]);
  return { walls, snow, eaves, chimney, windowLit, windowDim };
}
