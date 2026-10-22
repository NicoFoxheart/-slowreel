// bamboo-temple-geo.js - procedural geometry for the Kyoto bamboo & torii scene: the grove layout (moso culms with
// per-culm height, girth, age, lean toward the path, chunked for culling), canopy leaf cards, brushwood fences with split
// bamboo rails, a myojin torii, kasuga stone lanterns, a cherry tree, and the
// canvas-drawn leaf / blossom card textures. Everything is deterministic from the seeded rng passed in.
import * as kit from './kit.js?v=9e';

/** Path centre line x(z) - the same function as btPathX in bamboo-temple-glsl.js. */
export const pathX = z => (1.7 * Math.sin(z * 0.052 + 0.4) + 0.6 * Math.sin(z * 0.13 + 1.9)) * kit.smoothstep(-60, -38, z);
export const GROVE_END = -46, TORII_Z = -58, FENCE_X = 2.1;

/** Merge indexed / non-indexed geometries (position, normal, uv) after applying each part's matrix. */
export function merge(THREE, parts) {
  let nv = 0, ni = 0;
  const gs = parts.map(({ geo, matrix }) => { const g = geo.index ? geo.clone() : geo.clone(); if (matrix) g.applyMatrix4(matrix); if (!g.index) { const a = []; for (let i = 0; i < g.attributes.position.count; i++) a.push(i); g.setIndex(a); } nv += g.attributes.position.count; ni += g.index.count; return g; });
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), I = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of gs) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    P.set(p.array, ov * 3); if (n) N.set(n.array, ov * 3); if (u) U.set(u.array, ov * 2);
    const idx = g.index.array; for (let i = 0; i < idx.length; i++) I[oi + i] = idx[i] + ov;
    ov += p.count; oi += idx.length; g.dispose();
  }
  for (const pt of parts) pt.geo.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.setIndex(new THREE.BufferAttribute(I, 1)); out.computeBoundingSphere();
  return out;
}
const M = (THREE, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) => new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s));

/** Unit culm: radius 1, height 0..1 (position.y = v), radial x rings; uv = (angle/2pi, v). */
export function culmGeometry(THREE, radial, rings) {
  const P = [], U = [], I = [];
  for (let j = 0; j <= rings; j++) { const v = Math.pow(j / rings, 1.15); for (let i = 0; i <= radial; i++) { const a = i / radial * Math.PI * 2; P.push(Math.cos(a), v, Math.sin(a)); U.push(i / radial, v); } }
  for (let j = 0; j < rings; j++) for (let i = 0; i < radial; i++) { const a = j * (radial + 1) + i, b = a + radial + 1; I.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(P.map((x, k) => (k % 3 === 1 ? 0 : x)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I);
  return g;
}

/**
 * The grove: arrays of culm instances {x, z, H, r, lx, lz, seed, age, lod} and canopy cards, split into z chunks.
 * q: quality ('light' thins the far culms and the cards).
 */
export function layoutGrove(rnd, quality) {
  const light = quality === 'light', culms = [], stumps = [];
  const step = 1.06;
  for (let z = 36; z > -98; z -= step) {
    for (const side of [-1, 1]) {
      for (let d = 2.5; d < 31; d += d > 12 ? step * 1.3 : step) {
        const zz = z + rnd.range(-0.48, 0.48) * step, dd = d + rnd.range(-0.42, 0.42) * step, x = pathX(zz) + side * dd;
        const keep = rnd(), H = rnd.range(11, 17.5), g = rnd.gauss(), lr = rnd(), ag = rnd(), sd = rnd(), lg = rnd.gauss(), lg2 = rnd.gauss();
        // the torii clearing: an oval opening in the grove (bamboo closes again behind the shrine), the approach stays open
        if (zz < GROVE_END + 2) { const ex = x / 12.5, ez = (zz - TORII_Z + 1) / 15; if (ex * ex + ez * ez < 1 || (zz < TORII_Z && Math.abs(x) < 2.6)) continue; }
        if (keep > (dd < 4 ? 0.9 : 0.8)) continue;
        if (light && dd > 19) continue;
        if (light && dd > 10 && keep > 0.55) continue;
        const toward = dd < 9 ? 1 : 0.35;
        culms.push({ x, z: zz, H, r: kit.clamp(0.058 + 0.017 * g, 0.035, 0.095), lx: -side * lr * 0.055 * toward + lg * 0.012, lz: lg2 * 0.012,
          seed: sd, age: Math.pow(ag, 0.8), lod: dd < 9.5 && zz > -64 ? 0 : 1, side });
      }
      if (rnd() < 0.55) { const zz = z + rnd.range(-0.5, 0.5), dd = rnd.range(2.6, 7); if (zz > GROVE_END) stumps.push({ x: pathX(zz) + side * dd, z: zz, H: rnd.range(0.2, 0.75), r: rnd.range(0.04, 0.08), seed: rnd(), age: rnd.range(0.6, 1) }); }
    }
  }
  // canopy cards
  const cards = [];
  for (const c of culms) {
    const n = c.lod === 0 ? (light ? 4 : 7) : (light ? 2 : 4);
    for (let k = 0; k < n; k++) {
      const f = rnd.range(0.56, 1.0), y = f * c.H - 0.12, a = rnd() * Math.PI * 2, rr = rnd.range(0.15, 1.4) * (0.6 + f * 0.6);
      const bend = y * y / c.H;
      cards.push({ x: c.x + c.lx * bend + Math.cos(a) * rr, y, z: c.z + c.lz * bend + Math.sin(a) * rr, size: rnd.range(1.0, 1.9) * (c.lod ? 1.3 : 1),
        yaw: rnd() * Math.PI * 2, pitch: rnd.range(-0.7, 0.7) - 0.2, seed: rnd(), w: f, bx: c.x, bz: c.z, ss: c.seed, shade: kit.clamp((0.3 + 0.7 * (f - 0.56) / 0.44) * rnd.range(0.7, 1.1), 0.2, 1) });
    }
  }
  return { culms, stumps, cards };
}

const CHUNK = 12;
/** Split items by z into chunks (frustum culling); fn(items) -> geometry. */
export function chunked(items, fn) {
  const m = new Map();
  for (const it of items) { const k = Math.floor(it.z / CHUNK); if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
  return [...m.values()].map(list => fn(list));
}
function sphereOf(THREE, list, yMax) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const c of list) { x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); z0 = Math.min(z0, c.z); z1 = Math.max(z1, c.z); }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  return new THREE.Sphere(new THREE.Vector3(cx, yMax / 2, cz), Math.hypot(x1 - x0, z1 - z0, yMax) / 2 + 3);
}
/** InstancedBufferGeometry of culms (attributes aC, aL) sharing the unit culm's buffers. */
export function culmInstances(THREE, base, list) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index; for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
  const C = new Float32Array(list.length * 4), L = new Float32Array(list.length * 4);
  list.forEach((c, i) => { C.set([c.x, c.z, c.H, c.r], i * 4); L.set([c.lx, c.lz, c.seed, c.age], i * 4); });
  g.setAttribute('aC', new THREE.InstancedBufferAttribute(C, 4)); g.setAttribute('aL', new THREE.InstancedBufferAttribute(L, 4));
  g.instanceCount = list.length; g.boundingSphere = sphereOf(THREE, list, 20);
  return g;
}
export function cardInstances(THREE, base, list) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index; for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
  const P = new Float32Array(list.length * 4), Q = new Float32Array(list.length * 4), S = new Float32Array(list.length * 4);
  list.forEach((c, i) => { P.set([c.x, c.y, c.z, c.size], i * 4); Q.set([c.yaw, c.pitch, c.seed, c.w], i * 4); S.set([c.bx, c.bz, c.ss, c.shade], i * 4); });
  g.setAttribute('aP', new THREE.InstancedBufferAttribute(P, 4)); g.setAttribute('aQ', new THREE.InstancedBufferAttribute(Q, 4)); g.setAttribute('aS', new THREE.InstancedBufferAttribute(S, 4));
  g.instanceCount = list.length; g.boundingSphere = sphereOf(THREE, list.map(c => ({ x: c.x, z: c.z })), 22);
  return g;
}

/** Brushwood fence ribbons (front + back) along one side of the path; uv = (metres along, metres up). */
export function fenceGeometry(THREE, side, { z0 = 34, z1 = GROVE_END + 1, step = 0.5, height = 1.16, thick = 0.16 } = {}) {
  const P = [], N = [], U = [], I = [];
  let s = 0, prev = null;
  const rows = [];
  for (let z = z0; z >= z1 - 1e-6; z -= step) { const x = pathX(z) + side * FENCE_X; if (prev) s += Math.hypot(x - prev[0], z - prev[1]); prev = [x, z]; rows.push([x, z, s]); }
  for (const off of [0, thick]) {
    const base = P.length / 3;
    rows.forEach(([x, z, sv], i) => {
      const nx = -side, xx = x + side * off;
      P.push(xx, 0, z, xx, height, z); N.push(nx * (off ? -1 : 1), 0, 0, nx * (off ? -1 : 1), 0, 0); U.push(sv, 0, sv, height);
      if (i > 0) { const a = base + (i - 1) * 2, b = base + i * 2; I.push(a, b, a + 1, a + 1, b, b + 1); }
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I);
  g.computeBoundingSphere();
  return { geo: g, rows };
}
/** Split-bamboo rails on the path face of a fence + rope ties. */
export function railGeometry(THREE, side, rows) {
  const parts = [];
  for (const y of [0.26, 0.6, 0.92]) {
    const pts = rows.filter((r, i) => i % 4 === 0 || i === rows.length - 1).map(([x, z]) => new THREE.Vector3(x - side * 0.03, y, z));
    const curve = new THREE.CatmullRomCurve3(pts);
    parts.push({ geo: new THREE.TubeGeometry(curve, Math.max(8, Math.round(curve.getLength() / 0.6)), 0.024, 6, false) });
  }
  return merge(THREE, parts);
}
export function tieGeometry(THREE, side, rows) {
  const parts = [], box = new THREE.BoxGeometry(0.06, 0.07, 0.055);
  rows.forEach(([x, z], i) => { if (i % 4 !== 2) return; for (const y of [0.26, 0.6, 0.92]) parts.push({ geo: box.clone(), matrix: M(THREE, { p: [x - side * 0.03, y, z] }) }); });
  box.dispose();
  return merge(THREE, parts);
}

/** Myojin torii: {red, black} merged geometries, centred at x = 0, z = 0, facing +z. */
export function toriiGeometry(THREE) {
  const red = [], black = [];
  const lean = 0.022;
  for (const s of [-1, 1]) {
    red.push({ geo: new THREE.CylinderGeometry(0.17, 0.195, 4.6, 28, 1), matrix: M(THREE, { p: [s * 1.6, 2.3, 0], r: [0, 0, s * lean] }) });
    black.push({ geo: new THREE.CylinderGeometry(0.235, 0.245, 0.5, 28, 1), matrix: M(THREE, { p: [s * 1.65, 0.25, 0], r: [0, 0, s * lean] }) });
    black.push({ geo: new THREE.CylinderGeometry(0.25, 0.25, 0.04, 28, 1), matrix: M(THREE, { p: [s * 1.645, 0.52, 0], r: [0, 0, s * lean] }) });
  }
  red.push({ geo: new THREE.BoxGeometry(4.25, 0.26, 0.15), matrix: M(THREE, { p: [0, 3.62, 0] }) });             // nuki
  red.push({ geo: new THREE.BoxGeometry(0.24, 0.55, 0.14), matrix: M(THREE, { p: [0, 4.03, 0] }) });             // gakuzuka
  const curved = (len, h, d, y, rise, segs = 56) => {
    const g = new THREE.BoxGeometry(len, h, d, segs, 1, 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), u = Math.abs(x) / (len / 2); p.setY(i, p.getY(i) + rise * Math.pow(u, 2.6) + (p.getY(i) > 0 ? 0.05 * Math.pow(u, 3) : 0)); }
    g.computeVertexNormals(); return { geo: g, matrix: M(THREE, { p: [0, y, 0] }) };
  };
  red.push(curved(4.95, 0.28, 0.3, 4.42, 0.16));                                                                 // shimaki
  black.push(curved(5.9, 0.3, 0.42, 4.72, 0.3));                                                                  // kasagi
  return { red: merge(THREE, red), black: merge(THREE, black) };
}

/** Kasuga-style stone lantern (about 2.3 m): {stone, glow} merged, base at the origin. */
export function lanternGeometry(THREE) {
  const st = [], H6 = (rt, rb, h, y) => ({ geo: new THREE.CylinderGeometry(rt, rb, h, 6, 1), matrix: M(THREE, { p: [0, y, 0] }) });
  st.push(H6(0.38, 0.44, 0.2, 0.1), H6(0.3, 0.37, 0.09, 0.245));
  const pillar = []; for (let i = 0; i <= 14; i++) { const v = i / 14; pillar.push(new THREE.Vector2(0.135 - 0.02 * v + (Math.abs(v - 0.5) < 0.04 ? 0.025 : 0) + (v < 0.06 || v > 0.94 ? 0.03 : 0), 0.29 + v * 0.98)); }
  st.push({ geo: new THREE.LatheGeometry(pillar, 16) });
  st.push(H6(0.36, 0.2, 0.2, 1.37), H6(0.24, 0.26, 0.06, 1.5));
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; st.push({ geo: new THREE.BoxGeometry(0.06, 0.34, 0.06), matrix: M(THREE, { p: [Math.cos(a) * 0.205, 1.7, Math.sin(a) * 0.205], r: [0, -a, 0] }) }); }
  st.push(H6(0.25, 0.25, 0.05, 1.895));
  st.push(H6(0.08, 0.56, 0.24, 2.05), H6(0.56, 0.52, 0.06, 1.93));
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; st.push({ geo: new THREE.SphereGeometry(0.06, 8, 6), matrix: M(THREE, { p: [Math.cos(a) * 0.55, 1.99, Math.sin(a) * 0.55], s: [1, 1.3, 1] }) }); }
  const hoju = []; for (let i = 0; i <= 12; i++) { const v = i / 12; hoju.push(new THREE.Vector2(Math.max(0.001, (v < 0.25 ? 0.09 - v * 0.15 : 0.11 * Math.sin(Math.min(1, (v - 0.25) / 0.75) * Math.PI) + 0.005 * (1 - v))), 2.17 + v * 0.26)); }
  st.push({ geo: new THREE.LatheGeometry(hoju, 14) });
  const glow = new THREE.CylinderGeometry(0.15, 0.15, 0.3, 6, 1); glow.translate(0, 1.7, 0);
  return { stone: merge(THREE, st), glow };
}

/** A small Somei-yoshino cherry: bark geometry + blossom card anchors. */
export function sakuraTree(THREE, rnd, { x, z }) {
  const parts = [], tips = [];
  const up = new THREE.Vector3(0, 1, 0);
  function branch(p, dir, len, rad, depth) {
    const end = p.clone().addScaledVector(dir, len);
    const g = new THREE.CylinderGeometry(rad * 0.72, rad, len, 8, 2, true);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
    parts.push({ geo: g, matrix: new THREE.Matrix4().compose(p.clone().addScaledVector(dir, len / 2), q, new THREE.Vector3(1, 1, 1)) });
    if (depth >= 2) tips.push({ p: end.clone(), d: dir.clone(), depth });
    if (depth >= 4 || rad < 0.025) { tips.push({ p: end.clone(), d: dir.clone(), depth: 5 }); return; }
    const n = depth === 0 ? 4 : rnd.int(2) + 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd.range(-0.5, 0.5);
      const spread = depth === 0 ? rnd.range(0.55, 0.9) : rnd.range(0.35, 0.75);
      const nd = dir.clone().multiplyScalar(Math.cos(spread)).add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(Math.sin(spread))).normalize();
      nd.y = depth > 1 ? nd.y * 0.7 + 0.05 : nd.y; nd.normalize();
      branch(end, nd, len * rnd.range(0.62, 0.8), rad * 0.62, depth + 1);
    }
  }
  branch(new THREE.Vector3(x, -0.2, z), new THREE.Vector3(0.12, 1, 0.05).normalize(), 2.6, 0.24, 0);
  const cards = [];
  for (const t of tips) {
    const n = t.depth >= 5 ? 6 : 2;
    for (let i = 0; i < n; i++) cards.push({ x: t.p.x + rnd.range(-0.5, 0.5), y: t.p.y + rnd.range(-0.35, 0.3), z: t.p.z + rnd.range(-0.5, 0.5), size: rnd.range(0.7, 1.15),
      yaw: rnd() * 6.283, pitch: rnd.range(-0.8, 0.8), seed: rnd(), w: 0.25, bx: x, bz: z, ss: rnd(), shade: rnd.range(0.55, 1) });
  }
  return { bark: merge(THREE, parts), cards };
}

// ------------------------------------------------------------------------------------------------ card textures (canvas)
/** Bamboo foliage card: twigs with fans of narrow lanceolate leaves on a transparent ground. */
export function drawLeafCard(rnd) {
  return (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const leaf = (x, y, a, len, wid, col) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.35, -wid, len, 0); ctx.quadraticCurveTo(len * 0.35, wid, 0, 0);
      ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = 'rgba(200,220,140,0.25)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(1, 0); ctx.lineTo(len * 0.9, 0); ctx.stroke();
      ctx.restore();
    };
    const S = w / 512;
    for (let t = 0; t < 22; t++) {
      let x = rnd.range(0.12, 0.88) * w, y = rnd.range(0.12, 0.88) * h, a = rnd() * Math.PI * 2;
      const segs = 3 + rnd.int(4);
      ctx.strokeStyle = `rgba(${70 + rnd.int(30)},${70 + rnd.int(20)},${30 + rnd.int(20)},0.9)`; ctx.lineWidth = 1.6 * S;
      for (let s = 0; s < segs; s++) {
        const l = rnd.range(18, 34) * S, nx = x + Math.cos(a) * l, ny = y + Math.sin(a) * l;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
        x = nx; y = ny; a += rnd.range(-0.5, 0.5);
        const fan = 2 + rnd.int(4);
        for (let k = 0; k < fan; k++) {
          const la = a + rnd.range(-1.3, 1.3) + (k % 2 ? 0.6 : -0.6), hue = 78 + rnd.range(-8, 18), sat = 38 + rnd.range(-10, 18), lig = 26 + rnd.range(-6, 16);
          leaf(x, y, la, rnd.range(34, 62) * S, rnd.range(4.2, 6.8) * S, `hsl(${hue},${sat}%,${lig}%)`);
        }
      }
    }
  };
}
/** Cherry blossom card: clusters of five-petal flowers (white to pale pink), a few red-brown young leaves and twigs. */
export function drawBlossomCard(rnd) {
  return (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const S = w / 512;
    for (let c = 0; c < 9; c++) {
      const cx = rnd.range(0.15, 0.85) * w, cy = rnd.range(0.15, 0.85) * h;
      ctx.strokeStyle = 'rgba(60,40,35,0.9)'; ctx.lineWidth = 2.2 * S;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + rnd.range(-60, 60) * S, cy + rnd.range(-60, 60) * S); ctx.stroke();
      const n = 10 + rnd.int(10);
      for (let i = 0; i < n; i++) {
        const fx = cx + rnd.gauss() * 34 * S, fy = cy + rnd.gauss() * 34 * S, r = rnd.range(9, 14) * S, rot = rnd() * 6.28;
        const pink = rnd.range(0, 1);
        for (let p = 0; p < 5; p++) {
          const a = rot + p / 5 * Math.PI * 2;
          ctx.save(); ctx.translate(fx + Math.cos(a) * r * 0.55, fy + Math.sin(a) * r * 0.55); ctx.rotate(a);
          ctx.beginPath(); ctx.ellipse(0, 0, r * 0.62, r * 0.45, 0, 0, Math.PI * 2);
          ctx.fillStyle = `rgb(${250 - pink * 6},${232 - pink * 30},${238 - pink * 22})`; ctx.fill();
          ctx.restore();
        }
        ctx.beginPath(); ctx.arc(fx, fy, r * 0.22, 0, 6.28); ctx.fillStyle = 'rgb(200,90,110)'; ctx.fill();
      }
      if (rnd() < 0.5) { ctx.save(); ctx.translate(cx + 30 * S, cy - 20 * S); ctx.rotate(rnd() * 6.28); ctx.beginPath(); ctx.ellipse(0, 0, 16 * S, 6 * S, 0, 0, 6.28); ctx.fillStyle = 'rgb(120,70,50)'; ctx.fill(); ctx.restore(); }
    }
  };
}
