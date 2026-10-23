// guilin-mist-geo.js - geometry for the Guilin river scene: the river course, tower-karst peaks (sugar-loaf profiles
// with flutes, ledges, leaning and twin summits, each base shape at three detail levels), the peak layout (near bank
// cliffs, the mid rows and the far ranges, never inside the river corridor), the floodplain with banks (a grid that is
// dense near the river and the camera), phoenix-tail bamboo clumps, and the cormorant fisherman's bamboo raft.
import * as kit from './kit.js?v=10b';

// ------------------------------------------------------------------------------------------------ the river
export const riverX = z => 70 * Math.sin(z / 640 + 0.4) + 28 * Math.sin(z / 265 + 1.3) + 9 * Math.sin(z / 97 + 2.2);
export const riverHalf = z => 72 + 14 * Math.sin(z / 410 + 0.4) + 6 * Math.sin(z / 150 + 2);

// ------------------------------------------------------------------------------------------------ helpers
function indexed(THREE, pos, idx, extra = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  for (const k in extra) g.setAttribute(k, new THREE.Float32BufferAttribute(extra[k].data, extra[k].size));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
/** Merge non-indexed or indexed geometries (position + normal [+ aAO]) into one, applying optional matrices. */
export function merge(THREE, parts) {
  let nv = 0, ni = 0;
  for (const { geo } of parts) { nv += geo.attributes.position.count; ni += geo.index ? geo.index.count : geo.attributes.position.count; }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), A = new Float32Array(nv), I = new Uint32Array(ni);
  let ov = 0, oi = 0; const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const { geo, matrix, ao = 1 } of parts) {
    const p = geo.attributes.position, n = geo.attributes.normal, a = geo.attributes.aAO;
    if (matrix) nm.getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); if (matrix) v.applyMatrix4(matrix); P.set([v.x, v.y, v.z], (ov + i) * 3);
      v.fromBufferAttribute(n, i); if (matrix) v.applyMatrix3(nm).normalize(); N.set([v.x, v.y, v.z], (ov + i) * 3);
      A[ov + i] = a ? a.getX(i) : ao;
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) I[oi + i] = geo.index.getX(i) + ov;
    else for (let i = 0; i < p.count; i++) I[oi + i] = ov + i;
    ov += p.count; oi += geo.index ? geo.index.count : p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('aAO', new THREE.BufferAttribute(A, 1));
  g.setIndex(new THREE.BufferAttribute(I, 1)); g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------------------------------------ karst towers
/** One tower-karst shape (unit height, base radius ~1) at `seg` x `rings` resolution; shape params come from `seed`. */
export function karstGeometry(THREE, seed, seg, rings) {
  const r = kit.rng(seed);
  const p = r.range(2.4, 4.6), q = r.range(1.3, 2.1), waist = r.range(-0.1, 0.14);
  const shoulder = r.chance(0.35) ? [r.range(0.35, 0.7), r.range(0.12, 0.3)] : null;     // stepped towers
  const lean = [r.range(-0.18, 0.18), r.range(-0.18, 0.18)];
  const twin = r.chance(0.45) ? r.range(0.12, 0.32) : 0, twinDir = r.range(0, Math.PI);
  const flute = r.range(0.05, 0.11), lump = r.range(0.16, 0.28), ns = r.int(1000);
  const pos = [], ao = [], idx = [];
  const vMin = -0.06;
  for (let j = 0; j < rings; j++) {
    const v = vMin + (0.985 - vMin) * Math.pow(j / (rings - 1), 0.92);
    const vc = Math.max(v, 0);
    let r0 = Math.pow(Math.max(1 - Math.pow(vc, p), 0), 1 / q) * (1 + waist * Math.sin(Math.PI * vc));
    if (shoulder) r0 *= 1 - shoulder[1] * kit.smoothstep(shoulder[0] - 0.06, shoulder[0] + 0.06, vc);
    if (v < 0.1) r0 *= 1 + 0.3 * (0.1 - v) / 0.1;                         // talus flare at the foot
    for (let i = 0; i < seg; i++) {
      const th = i / seg * Math.PI * 2, cx = Math.cos(th), sz = Math.sin(th);
      const X = cx * 1.3, Y = v * 2.2, Z = sz * 1.3;
      const big = kit.noise3(X * 1.1 + ns, Y * 0.9, Z * 1.1, 3) * 0.65 + kit.noise3(X * 2.3, Y * 2.1 + ns, Z * 2.3, 5) * 0.35;
      const fl = Math.abs(kit.noise3(X * 4.5, Y * 0.9, Z * 4.5 + ns, 9));                // vertical flutes / cliff faces
      const led = kit.noise3(X * 1.6, Y * 7.0 + ns * 0.1, Z * 1.6, 11);                   // horizontal ledges
      const fine = kit.noise3(X * 9, Y * 9, Z * 9 + ns, 13);
      const fine2 = kit.noise3(X * 19, Y * 15, Z * 19 + ns, 17);
      const d = lump * big + flute * (0.5 - fl) * 2 + 0.022 * led + 0.03 * fine + 0.014 * fine2 * kit.smoothstep(0.3, 0.9, vc);
      const rr = Math.max(r0 * (1 + d), 0.02);
      const tw = twin ? 1 - twin * Math.pow(vc, 3) * (0.5 + 0.5 * Math.cos(2 * (th - twinDir))) : 1;
      const y = v * tw + 0.05 * Math.pow(vc, 2) * big;
      pos.push(cx * rr + lean[0] * vc * vc, y, sz * rr + lean[1] * vc * vc);
      ao.push(kit.clamp(0.62 + d * 2.6, 0.25, 1) * (0.55 + 0.45 * kit.smoothstep(-0.02, 0.18, v)));
    }
  }
  // apex
  let ax = 0, ay = 0, az = 0; const top = (rings - 1) * seg;
  for (let i = 0; i < seg; i++) { ax += pos[(top + i) * 3]; ay += pos[(top + i) * 3 + 1]; az += pos[(top + i) * 3 + 2]; }
  pos.push(ax / seg, ay / seg + 0.012, az / seg); ao.push(0.9);
  for (let j = 0; j < rings - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * seg + i, b = j * seg + (i + 1) % seg, c = a + seg, d = b + seg;
    idx.push(a, c, b, b, c, d);
  }
  const apex = rings * seg;
  for (let i = 0; i < seg; i++) idx.push(top + i, apex, top + (i + 1) % seg);
  return indexed(THREE, pos, idx, { aAO: { data: ao, size: 1 } });
}

/**
 * Peak layout: [{x, z, h, rx, rz, rot, tilt: [x, z], shape, band: 'near'|'mid'|'far'}]. Same world for every
 * variant (seeded by the scene seed only).
 */
export function layoutPeaks(seed, shapes) {
  const r = kit.rng(kit.hashSeed('guilin-mist', 'peaks', seed));
  const out = [];
  const clear = (x, z, rad) => Math.abs(x - riverX(z)) - riverHalf(z) > rad * (r.chance(0.12) ? 0.8 : 1.05) + 22;
  const fits = (x, z, rad, k) => { for (const o of out) { if (o.band === 'far') continue; const dd = Math.hypot(o.x - x, o.z - z); if (dd < k * (Math.max(o.rx, o.rz) + rad)) return false; } return true; };
  const add = (band, x, z, h, rad) => {
    const ax = r.range(0.78, 1.22), az = r.range(0.78, 1.22);
    out.push({ band, x, z, h, rx: rad * ax, rz: rad * az, rot: r.range(0, Math.PI * 2), tilt: [r.range(-0.04, 0.04), r.range(-0.04, 0.04)], shape: r.int(shapes) });
  };
  // near: the bank cliffs and the first rows (the camera drifts from z 60 to about -450)
  for (let z = 260; z > -2400; z -= 110) for (let xr = -640; xr <= 640; xr += 110) {
    if (!r.chance(0.3)) continue;
    const zz = z + r.range(-45, 45), x = riverX(zz) + xr + r.range(-45, 45);
    let h = r.range(80, 220) * (r.chance(0.18) ? 1.35 : 1); const rad = h * r.range(0.3, 0.5);
    if (!clear(x, zz, rad) || !fits(x, zz, rad, 0.5)) continue;
    add('near', x, zz, h, rad);
  }
  // mid rows
  for (let z = 900; z > -5600; z -= 250) for (let x = -3200; x <= 3200; x += 250) {
    const zz = z + r.range(-110, 110), xx = x + r.range(-110, 110);
    if (Math.abs(xx - riverX(zz)) < 720 && zz > -2400) continue;
    if (!r.chance(0.38)) continue;
    const h = r.range(110, 320) * (r.chance(0.15) ? 1.3 : 1), rad = h * r.range(0.33, 0.55);
    if (!clear(xx, zz, rad) || !fits(xx, zz, rad, 0.45)) continue;
    add('mid', xx, zz, h, rad);
  }
  // far ranges (pale silhouettes in the haze)
  for (let z = -5600; z > -11500; z -= 470) for (let x = -7500; x <= 7500; x += 470) {
    if (!r.chance(0.55)) continue;
    const zz = z + r.range(-200, 200), xx = x + r.range(-200, 200);
    const h = r.range(160, 430), rad = h * r.range(0.45, 0.7);
    if (!clear(xx, zz, rad)) continue;
    add('far', xx, zz, h, rad);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ floodplain
/** Ground: banks rising from under the water to fields 1.5-3 m above it. Dense near the river and the camera. */
export function groundGeometry(THREE, seed, geoScale = 1) {
  const zs = [];
  for (let z = 3200; z > 600; z -= 160) zs.push(z);
  const step = geoScale < 1 ? 18 : 12;
  for (let z = 600; z > -1800; z -= step) zs.push(z);
  for (let z = -1800; z > -3000; z -= 30) zs.push(z);
  for (let z = -3000; z >= -12500; z -= 180) zs.push(z);
  const nu = Math.round(60 * Math.max(geoScale, 0.6)) | 0, W = 9000;
  const us = []; for (let i = -nu; i <= nu; i++) { const u = i / nu; us.push(Math.sign(u) * W * Math.pow(Math.abs(u), 2.7)); }
  const pos = [], ao = [], idx = [];
  const s = (seed % 97) * 3.1;
  for (const z of zs) {
    const cx = riverX(z), hw = riverHalf(z);
    for (const u of us) {
      const x = cx + u;
      const d = Math.abs(x - cx) - hw;
      const n = kit.fbm2(x * 0.004 + s, z * 0.004, { octaves: 4, seed: 5 }), n2 = kit.noise2(x * 0.03, z * 0.03, 7);
      const bank = kit.smoothstep(-14, 30 + 14 * n, d + 6 * n2);
      let y = -2.2 + bank * (3.4 + 1.2 * n) + 0.25 * n2 * bank;
      y += kit.smoothstep(150, 900, d) * 2.0 * (n + 0.3);                 // gentle rise of the fields far from the river
      pos.push(x, y, z); ao.push(1);
    }
  }
  const nx = us.length;
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  return indexed(THREE, pos, idx, { aAO: { data: ao, size: 1 } });
}
/** Ground height (same formula, for placing bamboo on the banks). */
export function groundY(x, z, seed) {
  const s = (seed % 97) * 3.1, cx = riverX(z), hw = riverHalf(z), d = Math.abs(x - cx) - hw;
  const n = kit.fbm2(x * 0.004 + s, z * 0.004, { octaves: 4, seed: 5 }), n2 = kit.noise2(x * 0.03, z * 0.03, 7);
  const bank = kit.smoothstep(-14, 30 + 14 * n, d + 6 * n2);
  return -2.2 + bank * (3.4 + 1.2 * n) + 0.25 * n2 * bank + kit.smoothstep(150, 900, d) * 2.0 * (n + 0.3);
}

// ------------------------------------------------------------------------------------------------ bamboo
/** A phoenix-tail bamboo clump: arching feathery plumes (unit ~ 1 m; scale it 6-10 m tall). aAO = 0 inside .. 1 tips. */
export function bambooGeometry(THREE, seed, detail = 1) {
  const r = kit.rng(seed), parts = [];
  const plumes = detail < 1 ? 6 : 9, along = detail < 1 ? 5 : 6, around = 4;
  for (let k = 0; k < plumes; k++) {
    const az = (k / plumes) * Math.PI * 2 + r.range(-0.4, 0.4), lean = r.range(0.3, 0.75), h = r.range(0.75, 1.05), w = r.range(0.2, 0.3);
    const pos = [], ao = [], idx = [];
    for (let j = 0; j <= along; j++) {
      const s = j / along;
      // arching spine: up, then out and drooping at the tip
      const out = 0.12 * s + lean * Math.pow(s, 1.8) * 0.5, up = h * (Math.sin(s * Math.PI * 0.62) / Math.sin(Math.PI * 0.62)) - 0.12 * Math.pow(s, 3) * lean;
      const cx = Math.cos(az) * out, cz = Math.sin(az) * out;
      const rad = w * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, s * 0.9))) * (1 - 0.85 * Math.pow(s, 4)) + 0.01;
      for (let i = 0; i < around; i++) {
        const th = i / around * Math.PI * 2, jag = 1 + 0.35 * kit.noise2(i * 1.7 + k * 3, j * 1.3, seed);
        pos.push(cx + Math.cos(th) * rad * jag, up + Math.sin(th) * rad * 0.5 * jag, cz + Math.sin(th) * rad * jag);
        ao.push(kit.clamp(0.15 + 0.85 * s, 0, 1));
      }
    }
    for (let j = 0; j < along; j++) for (let i = 0; i < around; i++) {
      const a = j * around + i, b = j * around + (i + 1) % around, c = a + around, d = b + around;
      idx.push(a, c, b, b, c, d);
    }
    parts.push({ geo: indexed(THREE, pos, idx, { aAO: { data: ao, size: 1 } }) });
  }
  const g = merge(THREE, parts); parts.forEach(p => p.geo.dispose());
  g.computeVertexNormals();
  return g;
}
/** Bamboo clumps along both banks near the camera's stretch of river: [{x, y, z, s, rot}] */
export function layoutBamboo(seed, count) {
  const r = kit.rng(kit.hashSeed('guilin-mist', 'bamboo', seed)), out = [];
  let z = 220;
  while (out.length < count && z > -2600) {
    z -= r.range(9, 30);
    if (r.chance(0.25)) z -= r.range(30, 90);                              // gaps (fields, a village landing)
    for (const side of [-1, 1]) {
      if (!r.chance(0.72)) continue;
      const zz = z + r.range(-6, 6), off = riverHalf(zz) + r.range(10, 34);
      const x = riverX(zz) + side * off;
      const n = 1 + (r.chance(0.5) ? 1 : 0) + (r.chance(0.25) ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const xx = x + side * k * r.range(4, 8), z2 = zz + r.range(-7, 7);
        out.push({ x: xx, y: groundY(xx, z2, seed) - 0.8, z: z2, s: r.range(5.5, 9.5), w: r.range(0.9, 1.4), rot: r.range(0, Math.PI * 2) });
      }
    }
  }
  return out.slice(0, count);
}

// ------------------------------------------------------------------------------------------------ the raft
/**
 * A cormorant fisherman's bamboo raft (local frame: bow towards -z, deck at y ~ 0.08): 7 bamboo poles bent up at the
 * bow, a fisherman (dark indigo clothes, conical straw hat) with a punting pole, two cormorants, a fish basket and a
 * lantern on a bow post. Returns {groups: {bamboo, cloth, hat, bird, basket}, lanternPos (local), polePivot}.
 */
export function raftParts(THREE) {
  const parts = { bamboo: [], cloth: [], skin: [], hat: [], bird: [], dark: [] };
  const m4 = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  const L = 7.2, nPoles = 7, rad = 0.065;
  for (let k = 0; k < nPoles; k++) {
    const x = (k - (nPoles - 1) / 2) * rad * 2.05;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const s = i / 12, z = L / 2 - s * L;
      const lift = s > 0.72 ? Math.pow((s - 0.72) / 0.28, 2) * 0.62 : 0;           // the bow is heated and bent up
      pts.push(new THREE.Vector3(x * (1 - 0.18 * Math.max(0, s - 0.72) / 0.28), 0.04 + lift + 0.004 * Math.sin(k * 3.1 + s * 9), z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, 24, rad * (0.92 + 0.12 * ((k * 7) % 3) / 2), 7, false);
    parts.bamboo.push({ geo: g });
  }
  // cross lashing bars
  for (const z of [-2.4, -0.6, 1.2, 2.9]) { const g = new THREE.CylinderGeometry(0.03, 0.03, nPoles * rad * 2.1, 6); parts.bamboo.push({ geo: g, matrix: m4(0, 0.12, z, 0, 0, Math.PI / 2) }); }
  // fish basket (bamboo weave, near the stern)
  parts.bamboo.push({ geo: new THREE.CylinderGeometry(0.2, 0.15, 0.36, 10, 1, false), matrix: m4(0.12, 0.3, 2.2) });
  // fisherman: standing near the stern, facing the bow-left, holding the pole
  const fx = 0.02, fz = 1.45;
  parts.cloth.push({ geo: new THREE.CylinderGeometry(0.075, 0.07, 0.84, 8), matrix: m4(fx - 0.1, 0.5, fz, 0, 0, 0.02) });       // legs
  parts.cloth.push({ geo: new THREE.CylinderGeometry(0.075, 0.07, 0.84, 8), matrix: m4(fx + 0.1, 0.5, fz + 0.05, 0, 0, -0.02) });
  parts.cloth.push({ geo: new THREE.CylinderGeometry(0.17, 0.2, 0.68, 10), matrix: m4(fx, 1.24, fz, 0.06, 0, 0) });             // jacket
  parts.cloth.push({ geo: new THREE.CylinderGeometry(0.05, 0.045, 0.6, 6), matrix: m4(fx - 0.2, 1.3, fz - 0.18, -0.9, 0, 0.35) }); // arms reaching the pole
  parts.cloth.push({ geo: new THREE.CylinderGeometry(0.05, 0.045, 0.6, 6), matrix: m4(fx + 0.17, 1.22, fz - 0.2, -1.05, 0, -0.2) });
  parts.skin.push({ geo: new THREE.SphereGeometry(0.105, 12, 8), matrix: m4(fx, 1.72, fz - 0.02) });
  parts.hat.push({ geo: new THREE.ConeGeometry(0.34, 0.2, 18, 1, true), matrix: m4(fx, 1.86, fz - 0.02) });
  // cormorants: one on the bow, one on the side; black, upright, S-shaped neck
  const bird = (x, z, ry, s) => {
    parts.bird.push({ geo: new THREE.SphereGeometry(0.14, 12, 8), matrix: m4(x, 0.36 * s, z, 0.5, ry, 0, 0.8 * s, 1.5 * s, 0.85 * s) });
    parts.bird.push({ geo: new THREE.CylinderGeometry(0.035, 0.05, 0.3, 6), matrix: m4(x + Math.sin(ry) * -0.04 * s, 0.62 * s, z - Math.cos(ry) * 0.04 * s, -0.25, ry, 0, s, s, s) });
    parts.bird.push({ geo: new THREE.SphereGeometry(0.05, 8, 6), matrix: m4(x - Math.sin(ry) * 0.07 * s, 0.78 * s, z - Math.cos(ry) * 0.07 * s, 0, ry, 0, s, s, s) });
    parts.dark.push({ geo: new THREE.ConeGeometry(0.016, 0.12, 5), matrix: m4(x - Math.sin(ry) * 0.15 * s, 0.77 * s, z - Math.cos(ry) * 0.15 * s, -Math.PI / 2 + 0.2, ry, 0, s, s, s) });
    parts.bird.push({ geo: new THREE.ConeGeometry(0.07, 0.22, 6), matrix: m4(x + Math.sin(ry) * 0.12 * s, 0.14 * s, z + Math.cos(ry) * 0.12 * s, 2.5, ry, 0, s, s, s) });   // tail
  };
  bird(-0.12, -2.55, 0.4, 1); bird(0.32, 0.4, -1.2, 0.95);
  // lantern post at the bow
  parts.dark.push({ geo: new THREE.CylinderGeometry(0.018, 0.022, 1.3, 6), matrix: m4(0, 0.85, -3.05, 0.25, 0, 0) });
  parts.dark.push({ geo: new THREE.CylinderGeometry(0.012, 0.012, 0.42, 5), matrix: m4(0, 1.47, -3.38, Math.PI / 2 - 0.2, 0, 0) });
  return { parts, lanternPos: [0, 1.25, -3.58], polePivot: [fx - 0.05, 1.25, fz - 0.35], m4 };
}
