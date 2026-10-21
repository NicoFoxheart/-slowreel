// neon-night-city.js - builds the street worlds of the neon-night scene from a layout: rows of buildings with
// procedural facades (one merged mesh), signs (one instanced mesh: lightboxes, neon boards, screens, plain tubes),
// utility poles + street lamps, sagging power cables, wall props (AC units, gas pipes, crates, bags), cars, a traffic
// light, steam vents. Static light from every sign, shop window and lamp is baked into per-vertex irradiance (a
// light map without textures), so hundreds of light sources cost nothing per frame and never pop.
import * as kit from './kit.js?v=9b';
import { patchLit, SIGN_VS, SIGN_FS, HALO_VS, HALO_FS, STEAM_VS, STEAM_FS, PRE } from './neon-night-glsl.js?v=9b';

// ------------------------------------------------------------------------------------------ geometry accumulator
function Acc() {
  const P = [], N = [], I = [], X = {}, names = [];
  let n = 0;
  return {
    get count() { return n; },
    attr(name, size) { if (!X[name]) { X[name] = { size, data: [] }; names.push(name); } return X[name]; },
    // a grid patch: origin o, axes a (along, length la), b (up, length lb), normal nr, cells ca x cb; per-vertex fn(i, j, s, t) -> extra attrs
    grid(o, a, la, b, lb, nr, ca, cb, extra) {
      const base = n;
      for (let j = 0; j <= cb; j++) for (let i = 0; i <= ca; i++) {
        const s = i / ca * la, t = j / cb * lb;
        P.push(o[0] + a[0] * s + b[0] * t, o[1] + a[1] * s + b[1] * t, o[2] + a[2] * s + b[2] * t); N.push(nr[0], nr[1], nr[2]);
        if (extra) for (const k in extra) { const v = extra[k](s, t); const at = this.attr(k, v.length); at.data.push(...v); }
        n++;
      }
      for (let j = 0; j < cb; j++) for (let i = 0; i < ca; i++) {
        const q = base + j * (ca + 1) + i, r = q + ca + 1;
        I.push(q, q + 1, r, q + 1, r + 1, r);
      }
    },
    build(THREE) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      for (const k of names) g.setAttribute(k, new THREE.Float32BufferAttribute(X[k].data, X[k].size));
      g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
      g.computeBoundingSphere();
      return g;
    },
    P, N,
  };
}
// merge indexed geometries (position, normal) into one
function merge(THREE, geos) {
  let nv = 0, ni = 0; for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const P = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3), I = new Uint32Array(ni); let ov = 0, oi = 0;
  for (const g of geos) {
    P.set(g.attributes.position.array, ov * 3); Nn.set(g.attributes.normal.array, ov * 3);
    const c = g.attributes.position.count;
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) I[oi + i] = a[i] + ov; oi += a.length; } else { for (let i = 0; i < c; i++) I[oi + i] = ov + i; oi += c; }
    ov += c; g.dispose();
  }
  const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.BufferAttribute(P, 3)); m.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); m.setIndex(new THREE.BufferAttribute(I, 1));
  m.computeBoundingSphere(); return m;
}

// ------------------------------------------------------------------------------------------ light bake
function lightGrid(lights, cell = 8, R = 22) {
  const map = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  for (const L of lights) {
    const r = Math.min(R, L.range || R), i0 = Math.floor((L.p[0] - r) / cell), i1 = Math.floor((L.p[0] + r) / cell), j0 = Math.floor((L.p[2] - r) / cell), j1 = Math.floor((L.p[2] + r) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); let a = map.get(k); if (!a) map.set(k, (a = [])); a.push(L); }
  }
  return (x, z) => map.get(key(Math.floor(x / cell), Math.floor(z / cell))) || [];
}
function irradiance(q, x, y, z, nx, ny, nz, out, outF, wrap = 0) {
  out[0] = out[1] = out[2] = 0; outF[0] = outF[1] = outF[2] = 0; outF[3] = 0; let fmax = 0;
  for (const L of q(x, z)) {
    const dx = L.p[0] - x, dy = L.p[1] - y, dz = L.p[2] - z, d2 = dx * dx + dy * dy + dz * dz, R = L.range || 22;
    if (d2 > R * R) continue;
    const d = Math.sqrt(d2) + 1e-4; let c = (dx * nx + dy * ny + dz * nz) / d;
    c = wrap ? (c + wrap) / (1 + wrap) : c; if (c <= 0) continue;
    const fall = (1 - d2 / (R * R)); const e = c * fall * fall / (d2 + L.r * L.r);
    if (L.fl) { const v = e * (L.P[0] + L.P[1] + L.P[2]); if (v > fmax) { fmax = v; outF[3] = L.fl; } outF[0] += L.P[0] * e; outF[1] += L.P[1] * e; outF[2] += L.P[2] * e; }
    else { out[0] += L.P[0] * e; out[1] += L.P[1] * e; out[2] += L.P[2] * e; }
  }
}

const lin = h => { const c = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]; return c.map(v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); };
export { lin };

/**
 * buildCity(ctx, layout) -> { group, rainLights(cam) -> [...], update(t, f), signsMesh, lights }
 * ctx: { THREE, renderer, bag, quality, seed, U (shared uniforms), mirror, glyphTex, pal }
 */
export function buildCity(ctx, Lay) {
  const { THREE, bag, quality, U, pal } = ctx;
  const r = kit.rng(kit.hashSeed('neon-city', Lay.id, ctx.seed));
  const group = new THREE.Group();
  const lights = [];            // {p, P (rgb power), r (size), range, fl (flicker index), rain}
  const signs = [];             // {m: Matrix4, A, B, C}
  const halos = [];             // {p, col, size, fl}
  const props = { box: [], cyl: [] };   // {m, color, rough, metal, n (facing), emit}
  const facade = Acc(), gnd = Acc();
  const light = quality === 'light', gq = light ? 1.4 : 1;
  const up = [0, 1, 0];
  const M = new THREE.Matrix4(), V = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3();

  // sign helper: centre c, axes x (width dir), y (up), z (face normal), sizes w, h, dpt
  const sign = (c, xa, za, w, h, dpt, A, B, Cc) => {
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...xa).multiplyScalar(w), new THREE.Vector3(0, h, 0), new THREE.Vector3(...za).multiplyScalar(dpt));
    m.setPosition(c[0], c[1], c[2]); signs.push({ m, A, B, C: Cc });
  };
  const pickW = ws => { let s = 0; for (const w of ws) s += w[1]; let x = r() * s; for (const w of ws) { x -= w[1]; if (x <= 0) return w[0]; } return ws[0][0]; };

  // ---------------------------------------------------------------------------------------- buildings
  const buildingsInfo = [];
  for (const run of Lay.runs) {
    const dx = run.p1[0] - run.p0[0], dz = run.p1[1] - run.p0[1], len = Math.hypot(dx, dz), d = [dx / len, 0, dz / len], n = [-d[2], 0, d[0]];
    let u = run.start || 0;
    while (u < len - (run.endPad || 0) - 1) {
      const w = Math.min(len - (run.endPad || 0) - u, r.range(run.w[0], run.w[1]));
      const style = pickW(run.styles), fh = run.fh || r.range(2.75, 3.1), gH = run.gH ? r.range(run.gH[0], run.gH[1]) : r.range(3.4, 4.0);
      const floors = r.int(run.floors[1] - run.floors[0] + 1) + run.floors[0];
      const H = gH + floors * fh + r.range(0.4, 1.0), set = r.range(0, run.setback ?? 0.35);
      const shop = pickW(run.shops), litR = kit.clamp(r.range(run.lit[0], run.lit[1]));
      const wall = style === 0 ? pal.brick(r) : style === 1 ? r.pick(pal.tiles) : style === 2 ? r.pick(pal.paint) : style === 3 ? [0.22, 0.24, 0.26] : [0.05, 0.05, 0.06];
      const wv = wall.map(v => v * r.range(0.85, 1.12));
      const seed = r(), bw = style === 4 ? 1.5 : r.range(1.7, 2.6);
      const o = [run.p0[0] + d[0] * u - n[0] * set, 0, run.p0[1] + d[2] * u - n[2] * set];
      const B = [seed, style, fh, bw], B2 = [w, gH, shop + 0.9 * litR, gH + floors * fh];
      const cs = 0.55 * gq * (run.cellK || 1);                                // far rows can use coarser light cells
      facade.grid(o, d, w, up, H, n, Math.max(2, Math.ceil(w / cs)), Math.max(2, Math.ceil(H / cs)), { aFuv: (s, t) => [s, t], aBld: () => B, aBld2: () => B2, color: () => wv });
      // side returns (visible where neighbours differ) and roof
      const deep = run.deep || 7;
      const Bs = [seed + 0.5, style, fh, bw], Bs2 = [deep, gH, 4 + 0.9 * litR * 0.5, gH + floors * fh];
      const oL = o, oR = [o[0] + d[0] * w, 0, o[2] + d[2] * w], back = [-n[0], 0, -n[2]];
      facade.grid([oL[0] + back[0] * deep, 0, oL[2] + back[2] * deep], n, deep, up, H, [-d[0], 0, -d[2]], Math.max(2, Math.ceil(deep / 1.2)), Math.max(2, Math.ceil(H / 1.2)), { aFuv: (s, t) => [s, t], aBld: () => Bs, aBld2: () => Bs2, color: () => wv });
      facade.grid(oR, back, deep, up, H, d, Math.max(2, Math.ceil(deep / 1.2)), Math.max(2, Math.ceil(H / 1.2)), { aFuv: (s, t) => [s, t], aBld: () => Bs, aBld2: () => Bs2, color: () => wv });
      facade.grid([o[0], H, o[2]], d, w, back, deep, [0, 1, 0], 2, 2, { aFuv: (s, t) => [s, t + 100], aBld: () => [seed, 2, fh, bw], aBld2: () => [w, 0, 4, 0], color: () => wv.map(v => v * 0.6) });
      buildingsInfo.push({ o, d, n, w, H, gH, fh, floors, shop, style, run });
      // shop light (baked onto the street)
      const cx = o[0] + d[0] * w / 2, cz = o[2] + d[2] * w / 2;
      if (shop === 0 || shop === 3) {
        const warm = (seed * 7) % 1 > 0.55, col = warm ? pal.shopWarm : pal.shop, k = (shop === 0 ? 1 : 0.3) * pal.shopI * 0.19 * (w - 0.7) * (gH - 1.1) * (warm ? 0.65 : 1);
        lights.push({ p: [cx + n[0] * 0.9, 1.5, cz + n[2] * 0.9], P: col.map(v => v * k), r: 1.4, range: 14 });
      }
      // ---- signs on this building
      const sd = run.signs ?? 1;
      if (shop !== 4 && r.chance(0.85 * sd)) {                                // signboard over the shop
        const sw = w - r.range(0.4, 1.2), sh = r.range(0.65, 0.95), y = gH - 0.5;
        const c = [cx + n[0] * 0.08, y, cz + n[2] * 0.08];
        addSign(c, d, n, sw, sh, 0.14, false, -Math.max(2, Math.round(sw / (sh * 1.1))));
      }
      const nV = run.vert ?? 1;
      for (let k = 0; k < 2; k++) {                                          // vertical projecting signs at the building edges
        if (!r.chance(0.62 * nV)) continue;
        const uu = k === 0 ? r.range(0.35, 0.7) : w - r.range(0.35, 0.7);
        const sw = r.range(0.5, 0.75), maxH = Math.min(run.vMax || 6, H - gH - 0.8);
        if (maxH < 1.6) continue;
        const sh = r.range(1.6, maxH), y0 = gH + r.range(0.15, 1.2), c = [o[0] + d[0] * uu + n[0] * (sw / 2 + 0.25), y0 + sh / 2, o[2] + d[2] * uu + n[2] * (sw / 2 + 0.25)];
        if (run.tenant) addStack(c, d, n, sw * 2.2, fh, y0, Math.min(floors, Math.floor((H - y0 - 0.5) / fh)));
        else addSign(c, n, d, sw, sh, r.range(0.18, 0.28), true, Math.max(2, Math.min(7, Math.round(sh / (sw * 1.05)))));
      }
      for (let f = 1; f < Math.min(floors, 4); f++) {                         // flat signs between upper windows (cafes, karaoke, PC rooms)
        if (!r.chance(0.22 * sd)) continue;
        const sw = Math.min(w - 0.8, r.range(1.4, 3.0)), sh = r.range(0.45, 0.7), uu = r.range(sw / 2 + 0.3, w - sw / 2 - 0.3);
        const c = [o[0] + d[0] * uu + n[0] * 0.08, gH + f * fh + 0.15, o[2] + d[2] * uu + n[2] * 0.08];
        addSign(c, d, n, sw, sh, 0.1, false, -Math.max(2, Math.round(sw / (sh * 1.15))), r.chance(0.5) ? 1 : undefined);
      }
      const first = u <= (run.start || 0) + 0.01;
      if (run.screens && r.chance(first && run.cornerScreen ? run.cornerScreen : run.screens) && H > 18) {                   // LED screen / billboard high on the facade
        const sw = Math.min(w - 1, r.range(6, 12)), sh = sw * r.range(0.45, 0.7), uu = w / 2, y = H - sh / 2 - r.range(1, 3);
        const c = [o[0] + d[0] * uu + n[0] * 0.2, y, o[2] + d[2] * uu + n[2] * 0.2];
        const col = r.pick(pal.screen);
        sign(c, d, n, sw, sh, 0.3, [...col, pal.screenI], [2, r() * 100, -3, 0], [1, 1, 1, r()]);
        lights.push({ p: [c[0] + n[0] * 2, c[1], c[2] + n[2] * 2], P: col.map(v => v * pal.screenI * sw * sh * 0.07), r: sw * 0.4, range: 40 });
      }
      if (run.crosses && r.chance(run.crosses)) {                             // a red neon church cross on the roof (Seoul skyline)
        const c = [cx - n[0] * 2, H + 3.2, cz - n[2] * 2], col = [1, 0.06, 0.04];
        sign([c[0], c[1], c[2]], d, n, 0.16, 4.2, 0.16, [...col, 9], [4, 0, 0, 0], [0, 0, 0, 0]);
        sign([c[0], c[1] + 0.9, c[2]], d, n, 2.2, 0.16, 0.16, [...col, 9], [4, 0, 0, 0], [0, 0, 0, 0]);
        lights.push({ p: c, P: col.map(v => v * 0.9), r: 1, range: 10 });
      }
      // ---- wall props
      for (let f = 0; f < floors; f++) for (let b = 0; b < Math.floor(w / bw); b++) {
        if (!r.chance(run.ac ?? 0.12)) continue;                              // outdoor AC unit under a window
        const uu = (b + 0.5) * bw + r.range(-0.4, 0.4), y = gH + f * fh + 0.35;
        const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...d).multiplyScalar(0.8), new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(...n).multiplyScalar(0.3));
        m.setPosition(o[0] + d[0] * uu + n[0] * 0.17, y, o[2] + d[2] * uu + n[2] * 0.17);
        props.box.push({ m, color: [0.42, 0.42, 0.4], rough: 0.5, metal: 0.2, n });
      }
      if (run.pipes && r.chance(run.pipes)) {                                 // yellow gas pipe riser
        const uu = r.range(0.2, w - 0.2), hh = gH + floors * fh * r.range(0.4, 1);
        const m = new THREE.Matrix4().compose(V.set(o[0] + d[0] * uu + n[0] * 0.06, hh / 2, o[2] + d[2] * uu + n[2] * 0.06), Q.identity(), S.set(0.025, hh, 0.025));
        props.cyl.push({ m, color: [0.42, 0.3, 0.03], rough: 0.4, metal: 0.1, n });
        const m2 = new THREE.Matrix4().compose(V.set(o[0] + d[0] * w / 2 + n[0] * 0.06, gH + 0.2, o[2] + d[2] * w / 2 + n[2] * 0.06), Q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...d)), S.set(0.025, w, 0.025));
        props.cyl.push({ m: m2, color: [0.42, 0.3, 0.03], rough: 0.4, metal: 0.1, n });
      }
      if (run.clutter && shop !== 0) for (let k = 0; k < 3; k++) if (r.chance(run.clutter) && !(run.clearZ != null && o[2] + d[2] * w * 0.5 > run.clearZ)) {   // crates / bags by the wall
        const uu = r.range(0.5, w - 0.5), kind = r();
        if (kind < 0.55) {
          const stack = 1 + r.int(4), col = r.pick([[0.03, 0.12, 0.05], [0.2, 0.03, 0.02], [0.03, 0.06, 0.16], [0.25, 0.2, 0.04], [0.12, 0.12, 0.12]]);
          for (let s = 0; s < stack; s++) {
            const m = new THREE.Matrix4().compose(V.set(o[0] + d[0] * uu + n[0] * 0.4, 0.16 + s * 0.31, o[2] + d[2] * uu + n[2] * 0.4), Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.range(-0.15, 0.15) + Math.atan2(d[0], d[2])), S.set(0.55, 0.3, 0.38));
            props.box.push({ m, color: col, rough: 0.35, metal: 0, n: [0, 0.6, 0] });
          }
        } else {
          const m = new THREE.Matrix4().compose(V.set(o[0] + d[0] * uu + n[0] * 0.45, 0.25, o[2] + d[2] * uu + n[2] * 0.45), Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6), S.set(0.55, 0.5, 0.5));
          props.box.push({ m, color: kind < 0.8 ? [0.02, 0.02, 0.022] : [0.25, 0.25, 0.22], rough: 0.25, metal: 0, n: [0, 1, 0], bag: true });
        }
      }
      u += w + (r.chance(run.gaps ?? 0.12) ? r.range(0.4, 1.2) : 0);
    }
  }

  function signColors(kindHint) {
    const neon = kindHint === 1 || (kindHint === undefined && r.chance(Lay.neonShare ?? 0.35));
    if (neon) { const c = r.pick(pal.neon); return { type: 1, A: [...c, pal.neonI * r.range(0.75, 1.25)], C: [...(r.chance(0.35) ? r.pick(pal.neon) : c), r.chance(0.5) ? 1 : 0] }; }
    const lb = r.pick(pal.box);
    return { type: lb.white ? 3 : 0, A: [...lb.bg, pal.boxI * r.range(0.7, 1.2)], C: [...lb.fg, 0] };
  }
  function addSign(c, xa, za, w, h, dpt, both, count, kindHint) {
    const s = signColors(kindHint);
    const fl = r.chance(Lay.faulty ?? 0.05) ? (r.chance(0.5) ? 1 : 4) : r.chance(0.04) ? 2 : 0;
    sign(c, xa, za, w, h, dpt, s.A, [s.type, r() * 100, count, fl], s.C);
    const cov = s.type === 1 ? 0.18 : 0.9;
    const k = s.A[3] * w * h * cov * 0.19 * (both ? 2 : 1);
    const p = both ? c : [c[0] + za[0] * 0.45, c[1], c[2] + za[2] * 0.45];
    const col = s.type === 1 ? s.A : s.A.map((v, i) => i < 3 ? v * 0.75 + s.C[i] * 0.25 : v);
    lights.push({ p, P: [col[0] * k, col[1] * k, col[2] * k], r: Math.max(0.5, Math.min(w, h) * 0.6), range: 16, fl });
    if (s.type === 1 && r.chance(0.5)) halos.push({ p: [p[0] + za[0] * 0.2, p[1], p[2] + za[2] * 0.2], col: s.A.slice(0, 3).map(v => v * 0.05 * s.A[3] / pal.neonI), size: Math.max(w, h) * 0.6, fl });
  }
  function addStack(c, d, n, w, fh, y0, count) {                              // Tokyo tenant signs: one lightbox per floor
    for (let f = 0; f < count; f++) {
      const y = y0 + f * fh + fh * 0.5, cc = [c[0], y, c[2]];
      if (r.chance(0.18)) continue;
      const ww = w * r.range(0.75, 1.15), hh = fh * r.range(0.55, 0.8);
      addSign([cc[0] + n[0] * (ww * 0.5 - 0.3), y, cc[2] + n[2] * (ww * 0.5 - 0.3)], n, d, ww, hh, 0.24, true, -Math.max(2, Math.round(ww / (hh * 0.9))), 0);
    }
  }

  // ---------------------------------------------------------------------------------------- poles, lamps, cables
  const poleGeo = [], poles = [];
  const pole = (x, z, h, lamp) => {
    const g = new THREE.CylinderGeometry(0.13, 0.19, h, light ? 8 : 12, 1); g.translate(x, h / 2, z); poleGeo.push(g);
    const arm = new THREE.BoxGeometry(1.6, 0.1, 0.1); arm.translate(x, h - 1.0, z); poleGeo.push(arm);
    if (r.chance(0.5)) { const tr = new THREE.CylinderGeometry(0.24, 0.24, 0.85, 10); tr.translate(x + 0.4, h - 2.1, z + 0.25); poleGeo.push(tr); }
    poles.push({ x, z, h, top: h - 1.0 });
    if (lamp) {
      const dir = lamp.dir, ah = lamp.h || 6.2, ax = x + dir[0] * 1.3, az = z + dir[1] * 1.3;
      const a = new THREE.BoxGeometry(Math.abs(dir[0]) * 1.4 + 0.06, 0.06, Math.abs(dir[1]) * 1.4 + 0.06); a.translate(x + dir[0] * 0.7, ah, z + dir[1] * 0.7); poleGeo.push(a);
      const hd = new THREE.BoxGeometry(0.55, 0.1, 0.28); hd.translate(ax, ah - 0.04, az); poleGeo.push(hd);
      const col = lamp.color, I = lamp.I;
      sign([ax, ah - 0.1, az], [1, 0, 0], [0, -1, 0], 0.46, 0.2, 0.02, [...col, I], [4, 0, 0, 0], [0, 0, 0, 0]);
      lights.push({ p: [ax, ah - 0.3, az], P: col.map(v => v * I * 0.16), r: 0.5, range: 22, rain: 1 });
      halos.push({ p: [ax, ah - 0.25, az], col: col.map(v => v * 0.35), size: 2.2, fl: 0, lamp: 1 });
    }
  };
  for (const pl of Lay.poles || []) pole(pl.x, pl.z, pl.h || 10.5, pl.lamp);
  // cables: catenaries between consecutive poles and service drops onto the facades
  const cableGeo = [];
  const cable = (a, b, sag, rad) => {
    const pts = [], seg = light ? 10 : 16;
    for (let i = 0; i <= seg; i++) { const s = i / seg; pts.push(new THREE.Vector3(kit.lerp(a[0], b[0], s), kit.lerp(a[1], b[1], s) - sag * 4 * s * (1 - s), kit.lerp(a[2], b[2], s))); }
    cableGeo.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, rad, light ? 3 : 4, false));
  };
  for (let i = 0; i + 1 < poles.length; i++) {
    const a = poles[i], b = poles[i + 1]; if (Math.hypot(a.x - b.x, a.z - b.z) > 30) continue;
    const nc = 3 + r.int(4);
    for (let k = 0; k < nc; k++) { const h0 = a.top + 0.5 - k * 0.35 + r.range(-0.1, 0.1), h1 = b.top + 0.5 - k * 0.35 + r.range(-0.1, 0.1); cable([a.x + r.range(-0.6, 0.6), h0, a.z], [b.x + r.range(-0.6, 0.6), h1, b.z], r.range(0.25, 0.7), r.range(0.008, 0.02)); }
  }
  for (const p of poles) {
    const nd = Lay.drops ?? 3;
    for (let k = 0; k < nd; k++) {
      const bi = buildingsInfo[r.int(buildingsInfo.length)]; if (!bi) break;
      const uu = r.range(0.3, bi.w - 0.3), tx = bi.o[0] + bi.d[0] * uu, tz = bi.o[2] + bi.d[2] * uu, ty = bi.gH + r.range(0.5, 2.6);
      if (Math.hypot(tx - p.x, tz - p.z) > 16) continue;
      cable([p.x, p.top + r.range(-0.6, 0.4), p.z], [tx, ty, tz], r.range(0.15, 0.5), 0.011);
    }
  }
  for (const c of Lay.cables || []) cable(c.a, c.b, c.sag, c.r || 0.012);
  const darkMat = bag.add(patchLit(THREE, new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.35, metalness: 0.2, envMapIntensity: 0.5 }), { kind: 'prop', U }));
  const concMat = bag.add(patchLit(THREE, new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 0.8, metalness: 0, envMapIntensity: 0.4 }), { kind: 'prop', U }));
  const addBaked = (geo, mat, wrap = 0.3) => {
    const pa = geo.attributes.position, na = geo.attributes.normal, irr = new Float32Array(pa.count * 3), fl = new Float32Array(pa.count * 4);
    geo.setAttribute('aIrr', new THREE.BufferAttribute(irr, 3)); geo.setAttribute('aFl', new THREE.BufferAttribute(fl, 4));
    const mesh = new THREE.Mesh(geo, mat); group.add(mesh); bakeQueue.push({ geo, wrap }); return mesh;
  };
  const bakeQueue = [];
  if (poleGeo.length) addBaked(merge(THREE, poleGeo), concMat);
  if (cableGeo.length) addBaked(merge(THREE, cableGeo), darkMat, 0.8);

  // ---------------------------------------------------------------------------------------- traffic light, cars, extra
  const flickTraffic = [];
  if (Lay.traffic) {
    const T = Lay.traffic, g = [];
    const pg = new THREE.CylinderGeometry(0.09, 0.11, T.h, 10); pg.translate(T.x, T.h / 2, T.z); g.push(pg);
    const ag = new THREE.BoxGeometry(Math.abs(T.arm[0]) + 0.08, 0.08, Math.abs(T.arm[1]) + 0.08); ag.translate(T.x + T.arm[0] / 2, T.h - 0.2, T.z + T.arm[1] / 2); g.push(ag);
    const hx = T.x + T.arm[0], hz = T.z + T.arm[1];
    const hg = new THREE.BoxGeometry(1.25, 0.38, 0.32); hg.translate(hx, T.h - 0.55, hz); g.push(hg);
    addBaked(merge(THREE, g), darkMat);
    const cols = [[1, 0.04, 0.02], [1, 0.45, 0.0], [0.05, 1, 0.45]];
    for (let k = 0; k < 3; k++) {
      const c = [hx - 0.38 + k * 0.38, T.h - 0.55, hz + T.face * 0.17];
      sign(c, [1, 0, 0], [0, 0, T.face], 0.22, 0.22, 0.02, [...cols[k], 14], [4, 0, 0, 5 + k], [0, 0, 0, 0]);
      halos.push({ p: [c[0], c[1], c[2] + T.face * 0.15], col: cols[k].map(v => v * 0.6), size: 1.2, fl: 5 + k });
    }
  }
  // cars on the cross streets: body + cabin boxes (instanced), head/tail lamps in the sign mesh, halos
  const cars = [];
  for (const lane of Lay.lanes || []) for (let k = 0; k < lane.n; k++) cars.push({ lane, off: r(), col: r.pick([[0.02, 0.02, 0.022], [0.3, 0.3, 0.32], [0.5, 0.5, 0.52], [0.08, 0.02, 0.02], [0.02, 0.04, 0.08]]), len: r.range(4.2, 4.9) });

  // ---------------------------------------------------------------------------------------- facades + ground meshes
  const facadeGeo = facade.build(THREE);
  const facadeMat = bag.add(patchLit(THREE, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, envMapIntensity: 0.55 }), { kind: 'facade', U }));
  const facadeMesh = new THREE.Mesh(bag.add(facadeGeo), facadeMat); group.add(facadeMesh);
  { const pa = facadeGeo.attributes.position; facadeGeo.setAttribute('aIrr', new THREE.BufferAttribute(new Float32Array(pa.count * 3), 3)); facadeGeo.setAttribute('aFl', new THREE.BufferAttribute(new Float32Array(pa.count * 4), 4)); bakeQueue.push({ geo: facadeGeo, wrap: 0 }); }
  const gc = 0.5 * gq;
  for (const gr of Lay.grounds) {
    const ca = Math.max(1, Math.ceil((gr.x1 - gr.x0) / (gr.cell || gc))), cb = Math.max(1, Math.ceil((gr.z1 - gr.z0) / (gr.cell || gc)));
    gnd.grid([gr.x0, gr.y || 0, gr.z1], [1, 0, 0], gr.x1 - gr.x0, [0, 0, -1], gr.z1 - gr.z0, [0, 1, 0], ca, cb, { aSurf: () => [gr.surf || 0] });
    if (gr.curb) {                                                            // the curb face (sidewalk edge)
      const c = gr.curb; gnd.grid(c.o, c.a, c.l, up, gr.y, c.n, Math.ceil(c.l / 1.5), 1, { aSurf: () => [2] });
    }
  }
  const groundGeo = bag.add(gnd.build(THREE));
  { const pa = groundGeo.attributes.position; groundGeo.setAttribute('aIrr', new THREE.BufferAttribute(new Float32Array(pa.count * 3), 3)); groundGeo.setAttribute('aFl', new THREE.BufferAttribute(new Float32Array(pa.count * 4), 4)); bakeQueue.push({ geo: groundGeo, wrap: 0 }); }
  const groundMat = bag.add(patchLit(THREE, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, envMapIntensity: 0.25, side: THREE.DoubleSide }), { kind: 'ground', U, mirror: ctx.mirror, taps: light ? 5 : 7 }));
  const groundMesh = new THREE.Mesh(groundGeo, groundMat); group.add(groundMesh);

  // ---------------------------------------------------------------------------------------- bake the light
  const q = lightGrid(lights);
  const e = [0, 0, 0], ef = [0, 0, 0, 0];
  for (const { geo, wrap } of bakeQueue) {
    const pa = geo.attributes.position.array, na = geo.attributes.normal.array, irr = geo.attributes.aIrr.array, fl = geo.attributes.aFl.array;
    for (let i = 0, c = geo.attributes.position.count; i < c; i++) {
      irradiance(q, pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2], na[i * 3], na[i * 3 + 1], na[i * 3 + 2], e, ef, wrap);
      irr[i * 3] = e[0]; irr[i * 3 + 1] = e[1]; irr[i * 3 + 2] = e[2]; fl[i * 4] = ef[0]; fl[i * 4 + 1] = ef[1]; fl[i * 4 + 2] = ef[2]; fl[i * 4 + 3] = ef[3];
    }
  }

  // ---------------------------------------------------------------------------------------- props (instanced)
  const propMat = bag.add(patchLit(THREE, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.1, envMapIntensity: 0.6 }), { kind: 'prop', U }));
  const mkInst = (geo, list) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, propMat, list.length), irr = new Float32Array(list.length * 3), fl = new Float32Array(list.length * 4);
    const p = new THREE.Vector3();
    list.forEach((it, i) => {
      im.setMatrixAt(i, it.m); im.setColorAt(i, new THREE.Color(...it.color));
      p.setFromMatrixPosition(it.m); const nn = it.n || [0, 1, 0], ln = Math.hypot(...nn) || 1;
      irradiance(q, p.x + nn[0] * 0.3, p.y + 0.2, p.z + nn[2] * 0.3, nn[0] / ln, nn[1] / ln, nn[2] / ln, e, ef, 0.6);
      irr.set(e, i * 3); fl.set(ef, i * 4);
    });
    geo.setAttribute('aIrr', new THREE.InstancedBufferAttribute(irr, 3)); geo.setAttribute('aFl', new THREE.InstancedBufferAttribute(fl, 4));
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.frustumCulled = false; group.add(im); bag.add(geo); return im;
  };
  const boxG = new THREE.BoxGeometry(1, 1, 1);
  const bags = props.box.filter(b => b.bag), boxes = props.box.filter(b => !b.bag);
  mkInst(boxG, boxes);
  if (bags.length) { const sg = new THREE.SphereGeometry(0.5, light ? 8 : 12, light ? 6 : 8); sg.scale(1, 0.85, 1); mkInst(sg, bags); }
  mkInst(new THREE.CylinderGeometry(1, 1, 1, light ? 6 : 8, 1), props.cyl);
  if (!boxes.length) boxG.dispose();

  // car bodies
  let carMesh = null;
  if (cars.length) {
    const cg = merge(THREE, [(() => { const g = new THREE.BoxGeometry(1, 0.55, 1); g.translate(0, 0.45, 0); return g; })(), (() => { const g = new THREE.BoxGeometry(0.55, 0.42, 0.92); g.translate(-0.05, 0.92, 0); return g; })()]);
    const cm = bag.add(new THREE.MeshStandardMaterial({ roughness: 0.22, metalness: 0.6, envMapIntensity: 1.2 }));
    cm.onBeforeCompile = sh => { Object.assign(sh.uniforms, U); sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <project_vertex>', '#include <project_vertex>\nvWp = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;\n' + PRE).replace('#include <fog_fragment>', 'gl_FragColor.rgb = nnFog(gl_FragColor.rgb, vWp, cameraPosition);'); };
    cm.customProgramCacheKey = () => 'nn-car';
    carMesh = new THREE.InstancedMesh(bag.add(cg), cm, cars.length); carMesh.frustumCulled = false;
    cars.forEach((c, i) => carMesh.setColorAt(i, new THREE.Color(...c.col))); group.add(carMesh);
  }

  // ---------------------------------------------------------------------------------------- sign mesh
  const carLampBase = signs.length;
  for (const c of cars) for (let k = 0; k < 4; k++) signs.push({ m: new THREE.Matrix4(), A: k < 2 ? [1, 0.92, 0.8, 40] : [1, 0.02, 0.01, 10], B: [4, 0, 0, 0], C: [0, 0, 0, 0], dyn: true });
  const signGeo = bag.add(new THREE.BoxGeometry(1, 1, 1));
  const iA = new Float32Array(signs.length * 4), iB = new Float32Array(signs.length * 4), iC = new Float32Array(signs.length * 4);
  signs.forEach((s, i) => { iA.set(s.A, i * 4); iB.set(s.B, i * 4); iC.set(s.C, i * 4); });
  signGeo.setAttribute('iA', new THREE.InstancedBufferAttribute(iA, 4)); signGeo.setAttribute('iB', new THREE.InstancedBufferAttribute(iB, 4)); signGeo.setAttribute('iC', new THREE.InstancedBufferAttribute(iC, 4));
  const signMat = bag.add(new THREE.ShaderMaterial({ uniforms: { ...U, uGlyph: { value: ctx.glyphTex }, uGlow: { value: 1 }, uShimmer: U.uShimmer }, vertexShader: SIGN_VS,
    fragmentShader: PRE + SIGN_FS }));
  const signMesh = new THREE.InstancedMesh(signGeo, signMat, Math.max(1, signs.length)); signMesh.frustumCulled = false;
  signs.forEach((s, i) => signMesh.setMatrixAt(i, s.m)); group.add(signMesh);

  // ---------------------------------------------------------------------------------------- halos
  const carHaloBase = halos.length;
  for (const c of cars) for (let k = 0; k < 2; k++) halos.push({ p: [0, -100, 0], col: [1, 0.9, 0.75].map(v => v * 0.25), size: 1.4, fl: 0, dyn: true });
  const haloGeo = bag.add(new THREE.PlaneGeometry(1, 1));
  const hc = new Float32Array(halos.length * 4), hp = new Float32Array(halos.length * 4);
  halos.forEach((h, i) => { hc.set([...h.col, h.fl], i * 4); hp.set([...h.p, h.size], i * 4); });
  haloGeo.setAttribute('iCol', new THREE.InstancedBufferAttribute(hc, 4)); haloGeo.setAttribute('iP', new THREE.InstancedBufferAttribute(hp, 4));
  const haloMat = bag.add(new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: HALO_VS, fragmentShader: PRE + HALO_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const haloMesh = new THREE.InstancedMesh(haloGeo, haloMat, Math.max(1, halos.length)); haloMesh.frustumCulled = false; haloMesh.renderOrder = 5;
  halos.forEach((h, i) => { M.makeTranslation(h.p[0], h.p[1], h.p[2]); haloMesh.setMatrixAt(i, M); }); group.add(haloMesh);

  // ---------------------------------------------------------------------------------------- steam
  const steams = [];
  for (const v of Lay.steam || []) {
    const n = light ? 7 : 12, sg = new THREE.PlaneGeometry(1, 1), iS = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) iS.set([i / n + r.range(0, 0.05), r.range(0.5, 0.8) * (v.size || 1), r(), r.range(5, 8)], i * 4);
    sg.setAttribute('iS', new THREE.InstancedBufferAttribute(iS, 4));
    const su = { ...U, uWindX: { value: 0.2 }, uWindZ: { value: 0 }, uRise: { value: v.rise || 3.2 }, uSteam: { value: 0.5 }, uSteamCol: { value: new THREE.Vector3(...v.col) } };
    const sm = bag.add(new THREE.ShaderMaterial({ uniforms: su, vertexShader: STEAM_VS, fragmentShader: PRE + STEAM_FS, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
    const im = new THREE.InstancedMesh(bag.add(sg), sm, n); im.frustumCulled = false; im.renderOrder = 6;
    for (let i = 0; i < n; i++) { M.makeTranslation(v.p[0] + r.range(-0.15, 0.15), v.p[1], v.p[2] + r.range(-0.15, 0.15)); im.setMatrixAt(i, M); }
    group.add(im); steams.push({ im, su, v });
  }

  // ---------------------------------------------------------------------------------------- per frame
  const rainCands = lights.filter(l => l.rain).concat(lights.filter(l => !l.rain && l.P[0] + l.P[1] + l.P[2] > 1.2));
  const tmpL = [];
  function rainLights(cam) {
    tmpL.length = 0;
    for (const l of rainCands) { const d = Math.hypot(l.p[0] - cam.x, l.p[2] - cam.z); if (d < 16) tmpL.push({ l, w: kit.smoothstep(16, 9, d) }); }
    tmpL.sort((a, b) => b.w - a.w);
    return tmpL.slice(0, 4).map(({ l, w }) => { const sum = l.P[0] + l.P[1] + l.P[2] + 1e-4;
      return { position: l.p, color: [Math.min(1, l.P[0] / sum * 2), Math.min(1, l.P[1] / sum * 2), Math.min(1, l.P[2] / sum * 2)], intensity: w * (l.rain ? 1.6 : 0.9), radius: l.rain ? 2.6 : 1.6 }; });
  }
  const tmpQ = new THREE.Quaternion(), yAx = new THREE.Vector3(0, 1, 0);
  function update(t, f, wind) {
    for (const s of steams) { s.su.uWindX.value = 0.25 + wind * 0.5; s.su.uSteam.value = (s.v.k || 0.55); }
    if (cars.length) {
      cars.forEach((c, i) => {
        const L = c.lane, span = L.span, u = kit.fract((t * L.v) / span + c.off), x = L.from + (L.dir > 0 ? u : 1 - u) * span * 1;   // position along the lane
        const p = [L.axis === 'x' ? x : L.c, 0, L.axis === 'x' ? L.c : x];
        const heading = L.axis === 'x' ? (L.dir > 0 ? 0 : Math.PI) : (L.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
        tmpQ.setFromAxisAngle(yAx, heading);
        M.compose(V.set(p[0], 0.05, p[2]), tmpQ, S.set(c.len, 1.2, 1.8)); carMesh.setMatrixAt(i, M);
        const fx = Math.cos(heading), fz = -Math.sin(heading), sx = -fz, sz = fx;     // forward + side in xz
        for (let k = 0; k < 4; k++) {
          const front = k < 2, side = (k % 2 ? 1 : -1) * 0.68, along = (front ? 0.5 : -0.5) * c.len + (front ? 0.01 : -0.01);
          const cx = p[0] + fx * along + sx * side, cz = p[2] + fz * along + sz * side;
          const m = signs[carLampBase + i * 4 + k].m;
          m.makeBasis(new THREE.Vector3(sx, 0, sz).multiplyScalar(0.28), new THREE.Vector3(0, 0.12, 0), new THREE.Vector3(fx, 0, fz).multiplyScalar(front ? 0.03 : -0.03));
          m.setPosition(cx, 0.72, cz); signMesh.setMatrixAt(carLampBase + i * 4 + k, m);
          if (front) { M.makeTranslation(cx + fx * 0.35, 0.72, cz + fz * 0.35); haloMesh.setMatrixAt(carHaloBase + i * 2 + k, M); }
        }
      });
      carMesh.instanceMatrix.needsUpdate = true; signMesh.instanceMatrix.needsUpdate = true; haloMesh.instanceMatrix.needsUpdate = true;
    }
  }
  return { group, lights, rainLights, update, groundMesh, signCount: signs.length, haloCount: halos.length };
}
