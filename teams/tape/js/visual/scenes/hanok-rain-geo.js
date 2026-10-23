// hanok-rain-geo.js - geometry for the hanok scene (scene-local helper of hanok-rain.js). Everything is built once at
// init into a few merged BufferGeometries (one per material) plus instance transforms, so the whole compound draws in a
// handful of calls. Units are metres. Proportions follow real hanok: 2.3-2.6 m bays (kan), ~2.5 m columns on natural
// stone footings (deombeong jucho) over a granite platform (gidan), deep eaves (~1.25 m past the columns) whose corners
// rise (anhyeo) and swing outward (anheori), a concave tiled slope (giwa: convex sumaksae rows over concave amsaw
// channels), stacked-tile ridges with lime mortar, round rafters (seokarae) under a lime-plastered soffit.
import * as kit from './kit.js?v=10b';

// ------------------------------------------------------------------------------------------------ merged builder
export function createBuilder(THREE) {
  const P = [], N = [], U = [], C = [], I = [], A = [];
  let n = 0;
  const v = new THREE.Vector3(), nn = new THREE.Vector3(), nm = new THREE.Matrix3();
  return {
    /** add a THREE geometry transformed by matrix; color [r,g,b] or fn(worldPos) -> [r,g,b]; aux: float or fn(worldPos) */
    add(geo, matrix, color = [1, 1, 1], aux = 0) {
      const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
      nm.getNormalMatrix(matrix);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(matrix); P.push(v.x, v.y, v.z);
        if (nor) { nn.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); N.push(nn.x, nn.y, nn.z); } else N.push(0, 1, 0);
        if (uv) U.push(uv.getX(i), uv.getY(i)); else U.push(0, 0);
        const c = typeof color === 'function' ? color(v) : color; C.push(c[0], c[1], c[2]);
        A.push(typeof aux === 'function' ? aux(v) : aux);
      }
      if (geo.index) for (let i = 0; i < geo.index.count; i++) I.push(geo.index.getX(i) + n);
      else for (let i = 0; i < pos.count; i++) I.push(i + n);
      n += pos.count;
      geo.dispose();
    },
    /** raw grid strip: rows[r][c] = [x,y,z], uvs[r][c] = [u,v]; desired: [x,y,z] the side normals should face */
    grid(rows, uvs, desired, color = [1, 1, 1], aux = 0) {
      const R = rows.length, Cn = rows[0].length, base = n;
      const pts = [];
      for (let r = 0; r < R; r++) for (let c = 0; c < Cn; c++) { const p = rows[r][c]; pts.push(p); P.push(p[0], p[1], p[2]); U.push(uvs[r][c][0], uvs[r][c][1]); N.push(0, 0, 0);
        v.set(p[0], p[1], p[2]); const cc = typeof color === 'function' ? color(v) : color; C.push(cc[0], cc[1], cc[2]); A.push(typeof aux === 'function' ? aux(v) : aux); }
      // winding from the first non-degenerate quad
      let flip = false;
      { const a = rows[0][0], b = rows[0][Math.min(1, Cn - 1)], d = rows[Math.min(1, R - 1)][0];
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
        const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        flip = cr[0] * desired[0] + cr[1] * desired[1] + cr[2] * desired[2] < 0; }
      const idx = [];
      for (let r = 0; r < R - 1; r++) for (let c = 0; c < Cn - 1; c++) {
        const a = base + r * Cn + c, b = a + 1, d = a + Cn, e = d + 1;
        if (!flip) idx.push(a, b, d, b, e, d); else idx.push(a, d, b, b, d, e);
      }
      // smooth normals inside the strip (hard edges between strips: hips stay crisp)
      const acc = new Float32Array(R * Cn * 3);
      for (let i = 0; i < idx.length; i += 3) {
        const ia = idx[i] - base, ib = idx[i + 1] - base, ic = idx[i + 2] - base, pa = pts[ia], pb = pts[ib], pc = pts[ic];
        const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
        const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
        for (const k of [ia, ib, ic]) { acc[k * 3] += cx; acc[k * 3 + 1] += cy; acc[k * 3 + 2] += cz; }
      }
      for (let k = 0; k < R * Cn; k++) { const x = acc[k * 3], y = acc[k * 3 + 1], z = acc[k * 3 + 2], l = Math.hypot(x, y, z) || 1; N[(base + k) * 3] = x / l; N[(base + k) * 3 + 1] = y / l; N[(base + k) * 3 + 2] = z / l; }
      for (const i of idx) I.push(i);
      n += R * Cn;
    },
    get count() { return n; },
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      g.setAttribute('aAux', new THREE.Float32BufferAttribute(A, 1));
      g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    },
  };
}

/** Box with metric UVs (texM metres per texture repeat); the box's longest axis always maps to v (wood grain). */
export function boxGeo(THREE, sx, sy, sz, texM = 1) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv, dims = [sx, sy, sz], long = sx >= sy && sx >= sz ? 0 : sy >= sz ? 1 : 2;
  // face order px nx py ny pz nz; (u axis, v axis) of each face
  const axes = [[2, 1], [2, 1], [0, 2], [0, 2], [0, 1], [0, 1]];
  for (let f = 0; f < 6; f++) {
    let [au, av] = axes[f]; const swap = au === long;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k; let u = uv.getX(i) * dims[au] / texM, w = uv.getY(i) * dims[av] / texM;
      if (swap) [u, w] = [w, u];
      uv.setXY(i, u, w);
    }
  }
  return g;
}

const M4 = THREE => new THREE.Matrix4();
/** matrix from position, rotation y and optional parent matrix */
export function mat(THREE, x, y, z, ry = 0, parent = null, rx = 0, rz = 0) {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')); m.setPosition(x, y, z);
  return parent ? new THREE.Matrix4().multiplyMatrices(parent, m) : m;
}

// ------------------------------------------------------------------------------------------------ sweeps (ridges)
const RIDGE_PROFILE = [[-0.19, -0.06], [0.19, -0.06], [0.19, 0.1], [0.15, 0.15], [0.15, 0.36], [0.11, 0.43], [-0.11, 0.43], [-0.15, 0.36], [-0.15, 0.15], [-0.19, 0.1]];
/** stacked-tile ridge along points (world), scale s; lime mortar band at the bottom (vertex colour) */
export function sweep(THREE, builder, pts, { scale = 1, profile = RIDGE_PROFILE, mortar = [0.42, 0.41, 0.39], tile = [0.05, 0.052, 0.056], rnd = Math.random } = {}) {
  const rows = [], uvs = [], cols = [];
  const up = new THREE.Vector3(0, 1, 0), T = new THREE.Vector3(), S = new THREE.Vector3(), Uv = new THREE.Vector3();
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    Uv.copy(up).addScaledVector(T, -T.dot(up)).normalize(); S.crossVectors(T, Uv).normalize();
    if (i > 0) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    const row = [], urow = [];
    for (let k = 0; k <= profile.length; k++) {
      const p = profile[k % profile.length];
      row.push([pts[i][0] + S.x * p[0] * scale + Uv.x * p[1] * scale, pts[i][1] + S.y * p[0] * scale + Uv.y * p[1] * scale, pts[i][2] + S.z * p[0] * scale + Uv.z * p[1] * scale]);
      urow.push([k / profile.length, acc / 0.3]);
    }
    rows.push(row); uvs.push(urow);
  }
  // colours: mortar band below 0.13 (profile y) - set per vertex by height in profile space
  const tone = 0.85 + 0.3 * rnd();
  const R = rows.length, Cn = rows[0].length;
  const colorRows = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < Cn; c++) colorRows.push(profile[c % profile.length][1] < 0.12 ? mortar : [tile[0] * tone, tile[1] * tone, tile[2] * tone]);
  let ci = 0;
  // desired normal: outward of the first ring -> use profile normal of vertex 0..1 (bottom face faces down)
  const p0 = rows[0][0], p1 = rows[0][1], c0 = pts[0];
  const mid = [(p0[0] + p1[0]) / 2 - c0[0], (p0[1] + p1[1]) / 2 - c0[1], (p0[2] + p1[2]) / 2 - c0[2]];
  builder.grid(rows, uvs, mid, () => colorRows[ci++]);
  // caps
  for (const end of [0, R - 1]) {
    const ring = rows[end], c = pts[end];
    const cap = [ring.slice(0, Cn), ring.map(() => c)];
    const dir = end === 0 ? [pts[0][0] - pts[1][0], pts[0][1] - pts[1][1], pts[0][2] - pts[1][2]] : [pts[R - 1][0] - pts[R - 2][0], pts[R - 1][1] - pts[R - 2][1], pts[R - 1][2] - pts[R - 2][2]];
    builder.grid(cap, cap.map(r => r.map(() => [0, 0])), dir, [tile[0] * tone, tile[1] * tone, tile[2] * tone]);
  }
}

// ------------------------------------------------------------------------------------------------ the roof
/**
 * A hanok roof: paljak (hip-and-gable, vg > 0) or matbae (gable, vg = 0). Local frame: centred at (0,0,0) of `matrix`,
 * front eave towards +z. The tiled skirt is a loft of rectangles (half extents hx(v), hz(v)) - hips appear at the
 * corners; the corners rise by `rise` and swing out by `bulge`. Pushes into B.tiles / B.ridge / B.wood / B.plaster and
 * returns instance transforms (end tiles, rafters) and drip origins.
 */
export function buildRoof(THREE, B, o, rnd) {
  const { matrix, hx0, hz0, yE, H, vg = 0.55, rise = 0.45, bulge = 0.3, pitch = 0.27, course = 0.3, wallHx, wallHz, wallY, thick = 0.3,
    perTile = 6, nv = 22, gableOver = 0.3, drips = false, ridgeLift = 0.22, lod = 1 } = o;
  const out = { endTiles: [], rafters: [], drips: [] };
  const y = v => yE + H * (0.48 * v + 0.52 * v * v);
  const hz = v => hz0 * (1 - v);
  const paljak = vg > 0;
  const xg = paljak ? hx0 - hz0 * vg : hx0 - gableOver;
  const hx = v => (paljak ? Math.max(xg, hx0 - hz0 * v) : hx0);
  const fade = v => (paljak ? Math.pow(Math.max(0, 1 - v / vg), 2) : Math.pow(Math.max(0, 1 - v), 2.5));
  // arclength table s(v) along the slope
  const NS = 200, sTab = new Float32Array(NS + 1);
  for (let i = 1; i <= NS; i++) { const a = (i - 1) / NS, b = i / NS; sTab[i] = sTab[i - 1] + Math.hypot(hz(a) - hz(b), y(a) - y(b)); }
  const s = v => { const x = kit.clamp(v) * NS, i = Math.min(NS - 1, Math.floor(x)); return kit.lerp(sTab[i], sTab[i + 1], x - i); };
  const corr = u => { const f = u - Math.floor(u); const du = (f - 0.5) / 0.23; const sum = Math.abs(du) < 1 ? Math.sqrt(1 - du * du) : 0; return 0.03 * (0.5 - 0.5 * Math.cos(6.2831853 * f)) * 0.35 + 0.055 * sum; };
  const ax0 = hx0, az0 = hz0;
  // point on the skirt: edge e (0 front +z, 1 right +x, 2 back -z, 3 left -x), along-edge coordinate a (-1..1), level v
  const pt = (x0, z0, v, withCorr, uCoord) => {
    const axn = x0 / ax0, azn = z0 / az0, w = Math.pow(Math.abs(axn * azn), 3) * fade(v);
    const c = withCorr ? corr(uCoord) * (1 - 0.3 * v) : 0;
    return [x0 + bulge * w * axn, y(v) + rise * w + c, z0 + bulge * w * azn];
  };
  const tf = (p) => { const q = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(matrix); return [q.x, q.y, q.z]; };
  const nE = v => v; // identity
  const edges = paljak ? [0, 1, 2, 3] : [0, 2];
  const vTop = paljak ? vg : 1;
  const nvS = Math.max(6, Math.round(nv * (paljak ? vg : 1) * lod));
  for (const e of edges) {
    const along = e === 0 || e === 2 ? hx0 : hz0;
    const nA = Math.max(8, Math.ceil(2 * along / pitch * perTile * lod));
    const rows = [], uvs = [];
    for (let j = 0; j <= nvS; j++) {
      const v = vTop * j / nvS, row = [], urow = [];
      for (let i = 0; i <= nA; i++) {
        const a = -1 + 2 * i / nA;
        let x0, z0, uw;
        if (e === 0) { x0 = a * hx(v); z0 = hz(v); uw = x0 / pitch; }
        else if (e === 2) { x0 = -a * hx(v); z0 = -hz(v); uw = -x0 / pitch; }
        else if (e === 1) { x0 = hx(v); z0 = -a * hz(v); uw = z0 / pitch + 0.37; }
        else { x0 = -hx(v); z0 = a * hz(v); uw = -z0 / pitch + 0.37; }
        if (!paljak) uw = (e === 0 ? x0 : -x0) / pitch;
        row.push(tf(pt(x0, z0, v, true, uw))); urow.push([uw / 4, s(v) / (course * 4)]);
      }
      rows.push(row); uvs.push(urow);
    }
    const dirs = [[0, 1, 0.3], [0.3, 1, 0], [0, 1, -0.3], [-0.3, 1, 0]][e];
    const dW = new THREE.Vector3(...dirs).transformDirection(matrix);
    B.tiles.grid(rows, uvs, [dW.x, dW.y, dW.z]);

    // eave details along this edge: end tiles (sumaksae discs), drip origins (amsaw channel ends), rafters
    const sign = e === 0 || e === 1 ? 1 : -1;
    const span = e === 0 || e === 2 ? hx0 : hz0;
    const k0 = Math.ceil(-span / pitch - 0.5), k1 = Math.floor(span / pitch - 0.5);
    for (let k = k0; k <= k1; k++) {
      for (const half of [0.5, 0]) {
        const uw = k + half; const along2 = uw * pitch;
        if (Math.abs(along2) > span - 0.06) continue;
        let x0, z0;
        if (e === 0) { x0 = along2; z0 = hz0; } else if (e === 2) { x0 = -along2; z0 = -hz0; } else if (e === 1) { x0 = hx0; z0 = along2 - 0.37 * pitch; if (Math.abs(z0) > span - 0.06) continue; } else { x0 = -hx0; z0 = -(along2 - 0.37 * pitch); if (Math.abs(z0) > span - 0.06) continue; }
        const p = pt(x0, z0, 0, false, 0), p2 = pt(x0 * (e % 2 ? 0.98 : 1), z0 * (e % 2 ? 1 : 0.98), 0.03, false, 0);
        // slope direction (down & out)
        const d = [p[0] - p2[0], p[1] - p2[1], p[2] - p2[2]]; const dl = Math.hypot(...d); d[0] /= dl; d[1] /= dl; d[2] /= dl;
        if (half === 0.5) {
          // sumaksae: round end tile, axis = slope direction
          const pos = [p[0] + d[0] * 0.02, p[1] + 0.035 + d[1] * 0.02, p[2] + d[2] * 0.02];
          out.endTiles.push({ pos: tf(pos), dir: new THREE.Vector3(...d).transformDirection(matrix), s: 0.95 + 0.1 * rnd(), tilt: (rnd() - 0.5) * 0.12 });
        } else if (drips) {
          const pos = [p[0] + d[0] * 0.05, p[1] - 0.02, p[2] + d[2] * 0.05];
          out.drips.push(tf(pos));
        }
      }
    }
    // rafters every ~0.34 m: from the wall line to just behind the fascia (corner ones fan to the wall corner)
    const rp = 0.34, r0 = Math.ceil(-span / rp), r1 = Math.floor(span / rp);
    for (let k = r0; k <= r1; k++) {
      const al = k * rp + 0.17; if (Math.abs(al) > span - 0.25) continue;
      let x0, z0, xi, zi;
      if (e === 0) { x0 = al; z0 = hz0; xi = kit.clamp(al, -wallHx, wallHx); zi = wallHz; }
      else if (e === 2) { x0 = -al; z0 = -hz0; xi = kit.clamp(-al, -wallHx, wallHx); zi = -wallHz; }
      else if (e === 1) { x0 = hx0; z0 = al; xi = wallHx; zi = kit.clamp(al, -wallHz, wallHz); }
      else { x0 = -hx0; z0 = -al; xi = -wallHx; zi = kit.clamp(-al, -wallHz, wallHz); }
      if (!paljak && (e === 1 || e === 3)) continue;
      const pe = pt(x0, z0, 0, false, 0); const inset = 0.1;
      const L = Math.hypot(pe[0] - xi, pe[2] - zi);
      const outer = [pe[0] - (pe[0] - xi) / L * inset, pe[1] - thick + 0.07, pe[2] - (pe[2] - zi) / L * inset];
      const inner = [xi, wallY - 0.05, zi];
      out.rafters.push({ a: tf(inner), b: tf(outer), r: 0.055 + 0.01 * rnd() });
    }
  }
  // upper slopes (paljak above vg; matbae: the whole slope is "upper" and was built above as edges 0/2)
  if (paljak) {
    for (const side of [1, -1]) {
      const nA = Math.max(8, Math.ceil(2 * (xg + gableOver) / pitch * perTile * lod)), nvU = Math.max(5, Math.round(nv * (1 - vg) * lod));
      const rows = [], uvs = [];
      for (let j = 0; j <= nvU; j++) {
        const v = vg + (1 - vg) * j / nvU, row = [], urow = [];
        for (let i = 0; i <= nA; i++) {
          const a = -1 + 2 * i / nA;
          let x0 = a * (xg + gableOver * kit.smoothstep(vg, vg + 0.08, v)); const uw = side * x0 / pitch;
          const p = pt(x0, side * hz(v), v, true, uw);
          row.push(tf(p)); urow.push([uw / 4, s(v) / (course * 4)]);
        }
        rows.push(row); uvs.push(urow);
      }
      const dW = new THREE.Vector3(0, 1, 0.3 * side).transformDirection(matrix);
      B.tiles.grid(rows, uvs, [dW.x, dW.y, dW.z]);
    }
    // gable triangles (hapgak) - timber boards, set back a little under the rake
    for (const sx of [1, -1]) {
      const rows = [], uvs = []; const n = 10;
      const top = [], bot = [];
      for (let j = 0; j <= n; j++) {
        const zz = -hz(vg) + 2 * hz(vg) * j / n; const vv = 1 - Math.abs(zz) / hz0; // v where hz(v) = |zz|
        top.push(tf([sx * (xg - 0.05), y(vv) - 0.08, zz])); bot.push(tf([sx * (xg - 0.05), y(vg) - 0.02, zz]));
      }
      rows.push(bot, top); uvs.push(bot.map((_, j) => [j / n * 2 * hz(vg), 0]), top.map((_, j) => [j / n * 2 * hz(vg), 1.5]));
      const dW = new THREE.Vector3(sx, 0, 0).transformDirection(matrix);
      B.wood.grid(rows, uvs, [dW.x, dW.y, dW.z], [0.62, 0.56, 0.5]);
    }
  } else {
    // matbae gable ends: vertical triangles at the rake
    for (const sx of [1, -1]) {
      const n = 10, top = [], bot = [];
      for (let j = 0; j <= n; j++) {
        const zz = -hz0 * 0.75 + 1.5 * hz0 * j / n, vv = 1 - Math.abs(zz) / hz0;
        top.push(tf([sx * (hx0 - gableOver - 0.05), y(vv) - 0.1, zz])); bot.push(tf([sx * (hx0 - gableOver - 0.05), wallY - 0.3, zz]));
      }
      const dW = new THREE.Vector3(sx, 0, 0).transformDirection(matrix);
      B.plaster.grid([bot, top], [bot.map((_, j) => [j / n * 1.5 * hz0, 0]), top.map((_, j) => [j / n * 1.5 * hz0, 1])], [dW.x, dW.y, dW.z], [0.8, 0.78, 0.74]);
    }
  }
  // fascia + soffit (plastered between the rafters): loft from the eave line to the wall line
  {
    const loops = paljak ? [0, 1, 2, 3] : [0, 2];
    for (const e of loops) {
      const along = e === 0 || e === 2 ? hx0 : hz0, nA = Math.max(8, Math.ceil(2 * along / 0.25 * lod));
      const r0 = [], r1 = [], r2 = [], r3 = [];
      for (let i = 0; i <= nA; i++) {
        const a = -1 + 2 * i / nA; let x0, z0, xw, zw;
        const cut = paljak ? 1 : 1;
        if (e === 0) { x0 = a * hx0 * cut; z0 = hz0; xw = a * wallHx; zw = wallHz; }
        else if (e === 2) { x0 = -a * hx0; z0 = -hz0; xw = -a * wallHx; zw = -wallHz; }
        else if (e === 1) { x0 = hx0; z0 = -a * hz0; xw = wallHx; zw = -a * wallHz; }
        else { x0 = -hx0; z0 = a * hz0; xw = -wallHx; zw = a * wallHz; }
        if (!paljak) { xw = a * (hx0 - gableOver - 0.05) * (e === 0 ? 1 : -1); }
        const p = pt(x0, z0, 0, false, 0);
        const dx = p[0] - xw, dz = p[2] - zw, L = Math.hypot(dx, dz) || 1;
        r0.push(tf([p[0], p[1] + 0.02, p[2]]));
        r1.push(tf([p[0], p[1] - thick, p[2]]));
        r2.push(tf([p[0] - dx / L * 0.06, p[1] - thick, p[2] - dz / L * 0.06]));
        r3.push(tf([xw, wallY, zw]));
      }
      const outN = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0]][e];
      const dO = new THREE.Vector3(...outN).transformDirection(matrix), dD = new THREE.Vector3(outN[0] * 0.3, -1, outN[2] * 0.3).transformDirection(matrix);
      const uvRow = (r, vv) => r.map((_, i) => [i / nA * 2 * along, vv]);
      B.wood.grid([r1, r0], [uvRow(r1, 0), uvRow(r0, 0.3)], [dO.x, dO.y, dO.z], [0.5, 0.45, 0.4]);
      B.plaster.grid([r2, r3], [uvRow(r2, 0), uvRow(r3, 1.2)], [dD.x, dD.y, dD.z], (q) => [0.55, 0.53, 0.5]);
    }
  }
  // ridges: main ridge (yongmaru), hips (chunmaru) and rake ridges (naerimmaru)
  const rs = lod < 0.8 ? 0.85 : 1;
  {
    const Lr = paljak ? xg + gableOver + 0.12 : hx0 - 0.05, n = 26, pts = [];
    for (let i = 0; i <= n; i++) { const a = -1 + 2 * i / n, x = a * Lr; pts.push(tf([x, y(1) - 0.04 + ridgeLift * Math.pow(kit.smoothstep(0.62, 1, Math.abs(a)), 2), 0])); }
    sweep(THREE, B.ridge, pts, { scale: rs * (paljak ? 1.15 : 1), rnd });
  }
  if (paljak) {
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const pts = [], n = 14;
      for (let i = 0; i <= n; i++) { const v = vg * (1 - i / n) - 0.012; const p = pt(sx * hx(Math.max(v, 0)), sz * hz(Math.max(v, 0)), Math.max(v, 0), false, 0); pts.push(tf([p[0], p[1] - 0.06, p[2]])); }
      // upturned tip
      const last = pts[pts.length - 1], prev = pts[pts.length - 2];
      pts.push([last[0] + (last[0] - prev[0]) * 0.5, last[1] + 0.12, last[2] + (last[2] - prev[2]) * 0.5]);
      sweep(THREE, B.ridge, pts, { scale: rs * 0.8, rnd });
      // rake ridge from the ridge end down the gable edge
      const rk = [];
      for (let i = 0; i <= 10; i++) { const v = 1 - (1 - vg) * i / 10; rk.push(tf([sx * (xg + gableOver - 0.02), y(v) + 0.0, sz * hz(v)])); }
      sweep(THREE, B.ridge, rk, { scale: rs * 0.72, rnd });
    }
  } else {
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const rk = [];
      for (let i = 0; i <= 12; i++) { const v = 1 - i / 12; const p = pt(sx * (hx0 - 0.03), sz * hz(v), v, false, 0); rk.push(tf([p[0], p[1] - 0.02, p[2]])); }
      sweep(THREE, B.ridge, rk, { scale: rs * 0.7, rnd });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ a building
/**
 * Body of a hanok building in its own frame (front +z), placed by `matrix`. bays: widths (m). fronts: per bay 'doors' |
 * 'window' | 'wall'. Adds timber (columns, beams, sills, door frames, maru), stone (platform, footings, steps, shoe
 * stone), plaster (wall panels, under-floor band) and paper panels (B.paper, aAux = glow index) and builds the roof.
 */
export function buildHall(THREE, B, o, rnd) {
  const { matrix, bays, depth, baseH = 0.6, baseOut = 0.75, colH = 2.5, colW = 0.21, floorH = 0.42, fronts = [], sideWalls = 'window', roofH = 2.6, overhang = 1.25,
    vg = 0.55, rise = 0.45, bulge = 0.3, drips = false, glowBase = 0, maru = true, lod = 1, backWall = true } = o;
  const W = bays.reduce((a, b) => a + b, 0), D = depth, hw = W / 2, hd = D / 2;
  const top = baseH + colH, floorY = baseH + floorH;
  const xs = [-hw]; for (const b of bays) xs.push(xs[xs.length - 1] + b);
  const M = (x, y, z, ry = 0, rx = 0, rz = 0) => mat(THREE, x, y, z, ry, matrix, rx, rz);
  const AO = (q) => { // fake ambient occlusion: darker high under the eaves and in the contact with the base
    const lp = q.clone().applyMatrix4(inv);
    const under = kit.smoothstep(top - 1.6, top + 0.4, lp.y) * 0.55; const foot = kit.smoothstep(baseH + 0.5, baseH, lp.y) * 0.25;
    const k = 1 - under - foot; return [k, k, k];
  };
  const inv = new THREE.Matrix4().copy(matrix).invert();
  const woodTone = () => { const t = 0.85 + 0.3 * rnd(); return (q) => { const a = AO(q); return [a[0] * t, a[1] * t * 0.98, a[2] * t * 0.95]; }; };
  const glows = [];
  // --- platform (gidan): granite skin blocks + top slabs
  const PX = hw + baseOut, PZ = hd + baseOut;
  B.stone.add(boxGeo(THREE, 2 * PX - 0.06, baseH - 0.02, 2 * PZ - 0.06, 1.2), M(0, (baseH - 0.02) / 2, 0), [0.8, 0.8, 0.78]);
  const courses = baseH > 0.55 ? 2 : 1, ch = baseH / courses;
  for (const face of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
    const len = face[0] === 0 ? 2 * PX : 2 * PZ;
    if (face[1] === -1 && !backWall) continue;
    for (let c = 0; c < courses; c++) {
      let a = -len / 2 + (c % 2 ? 0.35 * rnd() : 0);
      while (a < len / 2 - 0.05) {
        const l = Math.min(len / 2 - a, 0.55 + 0.75 * rnd()); const mid = a + l / 2; const prot = 0.01 + 0.025 * rnd();
        const g = boxGeo(THREE, l - 0.02, ch - 0.02, 0.28, 0.9); const yy = c * ch + ch / 2;
        const tn = 0.82 + 0.3 * rnd(); const col = [tn, tn * 0.98, tn * 0.95];
        if (face[0] === 0) B.stone.add(g, M(mid, yy, face[1] * (PZ - 0.14 + prot)), col);
        else B.stone.add(g, M(face[0] * (PX - 0.14 + prot), yy, mid, Math.PI / 2), col);
        a += l;
      }
    }
  }
  // top edge slabs
  for (const face of [[0, 1], [1, 0], [-1, 0]]) {
    const len = face[0] === 0 ? 2 * PX : 2 * PZ; let a = -len / 2;
    while (a < len / 2 - 0.05) { const l = Math.min(len / 2 - a, 0.8 + 0.6 * rnd()); const tn = 0.85 + 0.25 * rnd();
      const g = boxGeo(THREE, l - 0.015, 0.09, 0.55, 0.9);
      if (face[0] === 0) B.stone.add(g, M(a + l / 2, baseH + 0.02, face[1] * (PZ - 0.26)), [tn, tn, tn * 0.97]);
      else B.stone.add(g, M(face[0] * (PX - 0.26), baseH + 0.02, a + l / 2, Math.PI / 2), [tn, tn, tn * 0.97]);
      a += l; }
  }
  // steps in front of the middle bay
  const midX = (xs[Math.floor(bays.length / 2)] + xs[Math.floor(bays.length / 2) + 1]) / 2;
  const nSteps = Math.max(1, Math.round(baseH / 0.22));
  for (let i = 0; i < nSteps; i++) { const h = baseH * (nSteps - i) / (nSteps + 0.4); B.stone.add(boxGeo(THREE, 1.7, h, 0.34, 0.9), M(midX + (rnd() - 0.5) * 0.03, h / 2, PZ + 0.17 + i * 0.34), [0.9, 0.9, 0.88]); }
  // --- columns on natural stone footings
  const colsX = xs, colsZ = [hd, -hd];
  const footing = (x, z) => {
    const g = new THREE.IcosahedronGeometry(0.26, 1); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i); const k = 1 + 0.18 * kit.noise3(vx * 3 + x, vy * 3, vz * 3 + z, 5); p.setXYZ(i, vx * k * 1.05, Math.max(vy * k * 0.55, -0.02), vz * k * 1.05); }
    g.computeVertexNormals(); const tn = 0.8 + 0.3 * rnd();
    B.stone.add(g, M(x, baseH + 0.03, z, rnd() * 6), [tn, tn * 0.97, tn * 0.93]);
  };
  const fh = 0.16;
  const colAt = (x, z) => { footing(x, z); B.wood.add(boxGeo(THREE, colW, colH - fh, colW, 1.2), M(x + (rnd() - 0.5) * 0.01, baseH + fh + (colH - fh) / 2, z, (rnd() - 0.5) * 0.02), woodTone()); };
  for (const x of colsX) for (const z of colsZ) colAt(x, z);
  for (const z of [0]) for (const x of [xs[0], xs[xs.length - 1]]) if (D > 3.5) colAt(x, z);
  // beams: lintel (changbang) and purlin plate (jangyeo/dori) all round
  for (const z of colsZ) {
    B.wood.add(boxGeo(THREE, W + 0.3, 0.27, 0.15, 1.4), M(0, top - 0.17, z), woodTone());
    B.wood.add(boxGeo(THREE, W + 0.5, 0.2, 0.22, 1.4), M(0, top + 0.08, z), woodTone());
  }
  for (const x of [-hw, hw]) {
    B.wood.add(boxGeo(THREE, 0.15, 0.27, D + 0.2, 1.4), M(x, top - 0.17, 0), woodTone());
    B.wood.add(boxGeo(THREE, 0.22, 0.2, D + 0.4, 1.4), M(x, top + 0.08, 0), woodTone());
  }
  // projecting beam ends (bo) above the columns
  for (const x of colsX) B.wood.add(boxGeo(THREE, 0.2, 0.24, D + 0.7, 1.4), M(x, top + 0.24, 0), woodTone());
  // --- under-floor band (plaster with stone) and the floor
  B.plaster.add(boxGeo(THREE, W - 0.04, floorH - 0.02, D - 0.04, 1), M(0, baseH + (floorH - 0.02) / 2, 0), [0.42, 0.4, 0.37]);
  // --- front bays
  const lintelBot = top - 0.31;
  const bayFront = (i, kind, z, face) => {
    const x0 = xs[i] + colW / 2, x1 = xs[i + 1] - colW / 2, bw = x1 - x0, cx = (x0 + x1) / 2;
    const zz = z - face * 0.02;
    B.wood.add(boxGeo(THREE, bw, 0.14, 0.14, 1.2), M(cx, floorY + 0.07, zz), woodTone());            // sill (hinbang)
    if (kind === 'doors') {
      const doorTop = floorY + 0.14 + 1.75;
      B.wood.add(boxGeo(THREE, bw, 0.13, 0.13, 1.2), M(cx, doorTop + 0.065, zz), woodTone());          // door head (inbang)
      const nD = bw > 2.2 ? 4 : 2, dw = bw / nD;
      const gi = glowBase + glows.length; glows.push({ x: cx, y: floorY + 1.0, z: z - face * 0.12 });
      for (let d = 0; d < nD; d++) {
        const g = new THREE.PlaneGeometry(dw - 0.02, 1.74);
        B.paper.add(g, M(cx - bw / 2 + dw * (d + 0.5), floorY + 0.14 + 0.87, zz + face * 0.005, face > 0 ? 0 : Math.PI), [1, 1, 1], gi + 0.15 * d + 0.07 * rnd());
        if (d > 0) B.wood.add(boxGeo(THREE, 0.05, 1.74, 0.09, 1.2), M(cx - bw / 2 + dw * d, floorY + 0.14 + 0.87, zz), woodTone());
      }
      // transom lattice (gyochang) above the head
      const th = lintelBot - (doorTop + 0.13);
      if (th > 0.12) { const g = new THREE.PlaneGeometry(bw - 0.02, th); const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k), 0.3 + uv.getY(k) * 0.12);
        B.paper.add(g, M(cx, doorTop + 0.13 + th / 2, zz + face * 0.005, face > 0 ? 0 : Math.PI), [1, 1, 1], gi + 0.5); }
    } else {
      // plastered wall with timber rails; 'window' adds a lattice window
      const mid = floorY + 0.8, wTop = lintelBot;
      B.wood.add(boxGeo(THREE, bw, 0.12, 0.13, 1.2), M(cx, mid, zz), woodTone());
      B.plaster.add(boxGeo(THREE, bw, mid - floorY - 0.2, 0.1, 1), M(cx, (floorY + 0.14 + mid - 0.06) / 2, zz), AO);
      if (kind === 'window') {
        const ww = Math.min(1.1, bw * 0.55), wh = 0.85, wy = mid + 0.12 + wh / 2;
        const gi = glowBase + glows.length; glows.push({ x: cx, y: wy, z: z - face * 0.12 });
        const g = new THREE.PlaneGeometry(ww, wh); const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k), 0.08 + uv.getY(k) * 0.5);
        B.paper.add(g, M(cx, wy, zz + face * 0.005, face > 0 ? 0 : Math.PI), [1, 1, 1], gi + 0.1);
        for (const [sx, sy, px, py] of [[ww + 0.1, 0.07, 0, wh / 2 + 0.035], [ww + 0.1, 0.07, 0, -wh / 2 - 0.035], [0.07, wh, ww / 2 + 0.035, 0], [0.07, wh, -ww / 2 - 0.035, 0]])
          B.wood.add(boxGeo(THREE, sx, sy, 0.1, 1.2), M(cx + px, wy + py, zz), woodTone());
        // plaster around the window
        const sideW = (bw - ww - 0.14) / 2;
        for (const s of [-1, 1]) B.plaster.add(boxGeo(THREE, sideW, wTop - mid - 0.06, 0.1, 1), M(cx + s * (ww / 2 + 0.07 + sideW / 2), (mid + 0.06 + wTop) / 2, zz), AO);
        const above = wTop - (wy + wh / 2 + 0.07); if (above > 0.03) B.plaster.add(boxGeo(THREE, ww + 0.14, above, 0.1, 1), M(cx, wTop - above / 2, zz), AO);
        const below = wy - wh / 2 - 0.07 - (mid + 0.06); if (below > 0.03) B.plaster.add(boxGeo(THREE, ww + 0.14, below, 0.1, 1), M(cx, mid + 0.06 + below / 2, zz), AO);
      } else {
        B.plaster.add(boxGeo(THREE, bw, wTop - mid - 0.06, 0.1, 1), M(cx, (mid + 0.06 + wTop) / 2, zz), AO);
        B.wood.add(boxGeo(THREE, 0.11, wTop - mid, 0.12, 1.2), M(cx, (mid + wTop) / 2, zz), woodTone());
      }
    }
  };
  for (let i = 0; i < bays.length; i++) bayFront(i, fronts[i] || 'wall', hd, 1);
  if (backWall) for (let i = 0; i < bays.length; i++) bayFront(i, 'wall', -hd, -1);
  // side walls: plaster panels with a rail (and windows)
  for (const sx of [-1, 1]) {
    const z0 = -hd + colW / 2, z1 = hd - colW / 2, mid = floorY + 0.8;
    const halves = D > 3.5 ? [[z0, -colW / 2], [colW / 2, z1]] : [[z0, z1]];
    for (const [a, b] of halves) {
      const cz = (a + b) / 2, l = b - a;
      B.plaster.add(boxGeo(THREE, 0.1, lintelBot - floorY, l, 1), M(sx * hw, (floorY + lintelBot) / 2, cz), AO);
      B.wood.add(boxGeo(THREE, 0.13, 0.12, l, 1.2), M(sx * (hw + 0.02), mid, cz), woodTone());
      B.wood.add(boxGeo(THREE, 0.13, 0.14, l, 1.2), M(sx * (hw + 0.02), floorY + 0.07, cz), woodTone());
    }
  }
  // --- toenmaru (veranda) along the front with a shoe stone
  if (maru) {
    const dz = 0.78, y0 = floorY, x0 = xs[0] + colW / 2, x1 = xs[xs.length - 1] - colW / 2;
    const nP = Math.round((x1 - x0) / 0.24);
    for (let i = 0; i < nP; i++) { const l = (x1 - x0) / nP; const tn = 0.8 + 0.35 * rnd();
      B.wood.add(boxGeo(THREE, l - 0.006, 0.06, dz, 1.0), M(x0 + l * (i + 0.5), y0 - 0.03, hd + dz / 2 - 0.02), (q) => [tn * 1.15, tn * 1.08, tn * 1.0]); }
    B.wood.add(boxGeo(THREE, x1 - x0, 0.16, 0.12, 1.4), M((x0 + x1) / 2, y0 - 0.13, hd + dz - 0.04), woodTone());
    for (let i = 0; i < bays.length; i++) { const x = (xs[i] + xs[i + 1]) / 2; B.wood.add(boxGeo(THREE, 0.12, y0 - baseH - 0.2, 0.12, 1), M(x, baseH + (y0 - baseH - 0.2) / 2, hd + dz - 0.1), woodTone()); }
    // shoe stone (ttaetdol)
    B.stone.add(boxGeo(THREE, 1.4, 0.2, 0.5, 0.9), M(midX, baseH + 0.1, hd + dz + 0.4), [0.95, 0.95, 0.93]);
  }
  // --- roof
  const roof = buildRoof(THREE, B, { matrix: mat(THREE, 0, 0, 0, 0, matrix), hx0: hw + overhang, hz0: hd + overhang, yE: top + 0.14, H: roofH, vg, rise, bulge,
    wallHx: hw + 0.1, wallHz: hd + 0.1, wallY: top + 0.22, drips, lod }, rnd);
  // glow points in world space
  roof.glows = glows.map(g => { const q = new THREE.Vector3(g.x, g.y, g.z).applyMatrix4(matrix); return q; });
  roof.top = top; roof.baseH = baseH; roof.floorY = floorY;
  roof.eaveFront = new THREE.Vector3(0, top, hd + overhang).applyMatrix4(matrix);
  return roof;
}

// ------------------------------------------------------------------------------------------------ props
/** onggi jar (jangdok) lathe profile, ~1 m tall before scaling, with a lid */
export function jarGeometry(THREE, seg = 28) {
  const pts = [[0, 0], [0.17, 0], [0.2, 0.04], [0.29, 0.25], [0.35, 0.48], [0.355, 0.56], [0.33, 0.66], [0.26, 0.74], [0.2, 0.78], [0.2, 0.82], [0.215, 0.835],
    [0.22, 0.85], [0.205, 0.86], [0.19, 0.87], [0.17, 0.9], [0.1, 0.935], [0.04, 0.95], [0.035, 0.97], [0, 0.975]];
  return new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg);
}
/** cheongsachorong (red-and-blue silk lantern): body with blue bands, cap, tassel; vertex colour = silk colour */
export function lanternGeometry(THREE) {
  const B = createBuilder(THREE);
  const prof = []; for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push(new THREE.Vector2(0.15 + 0.035 * Math.sin(Math.PI * t), -0.21 + 0.42 * t)); }
  const body = new THREE.LatheGeometry(prof, 12);
  B.add(body, new THREE.Matrix4(), q => (Math.abs(q.y) > 0.15 ? [0.03, 0.06, 0.32] : [1.0, 0.16, 0.045]));
  const cap = new THREE.CylinderGeometry(0.06, 0.16, 0.06, 12); B.add(cap, new THREE.Matrix4().makeTranslation(0, 0.24, 0), [0.0, 0.0, 0.0]);
  const bot = new THREE.CylinderGeometry(0.15, 0.05, 0.05, 12); B.add(bot, new THREE.Matrix4().makeTranslation(0, -0.235, 0), [0.0, 0.0, 0.0]);
  const tas = new THREE.CylinderGeometry(0.018, 0.035, 0.32, 8); B.add(tas, new THREE.Matrix4().makeTranslation(0, -0.42, 0), [0.35, 0.03, 0.02]);
  const cord = new THREE.CylinderGeometry(0.006, 0.006, 0.85, 5); B.add(cord, new THREE.Matrix4().makeTranslation(0, 0.69, 0), [0, 0, 0]);
  return B.build();
}
export { M4 };
