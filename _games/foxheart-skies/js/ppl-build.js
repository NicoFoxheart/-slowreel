// People mesh builder: turns the sculpted SDF anatomy into skinned LOD layers (body, head, hands, eyes,
// layered garments, shoes, hair styles, beards, accessories and props). Built once, cached per quality.
import * as THREE from 'three';
import { P, Shape, polygonize, axis, clip, hem, merge, offset, setAttr, bakeAO, morph, skinWeights, constWeights, ensure, vcount, field, transform } from './ppl-sdf.js';
import { B, NB, J, LM, HF, bodyPrims, headPrims, handPrims, craniumPrims, eyeOpening, headSide, ARM, LEG, nrm, sub, add, mul, dot, cross, lerp, mx } from './ppl-body.js';

const ATTRS = [['skinIndex', 4], ['skinWeight', 4], ['aM0', 3], ['aM1', 3], ['aM2', 3], ['aAO', 1], ['aReg', 4], ['aExt', 4], ['uv', 2]];
const ramp = (x, a, b, fine, coarse, k = 0.3) => { const d = x < a ? a - x : x > b ? x - b : 0; return Math.min(coarse, fine + d * k); };
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function toGeo(m) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(m.P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(m.N, 3));
  for (const [k, s] of ATTRS) { const name = k === 'aAO' ? 'ao' : k; const a = m.A[name]; g.setAttribute(k, new THREE.BufferAttribute(a ? a.data : new Float32Array(vcount(m) * s).fill(k === 'aAO' ? 1 : 0), s)); }
  g.setIndex(new THREE.BufferAttribute(vcount(m) > 65535 ? m.I : new Uint16Array(m.I), 1)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2); return g;
}
const bonesOf = (m, i) => { const SI = m.A.skinIndex.data, SW = m.A.skinWeight.data; return [0, 1, 2, 3].map(c => [SI[i * 4 + c], SW[i * 4 + c]]); };
function boneSum(m, i, set) { let s = 0; for (const [b, w] of bonesOf(m, i)) if (set.has(b)) s += w; return s; }
const ARMB = new Set([B.armL, B.foreL, B.handL, B.fingL, B.armR, B.foreR, B.handR, B.fingR]), LEGB = new Set([B.thighL, B.shinL, B.footL, B.thighR, B.shinR, B.footR]);
// neck holes (positive inside the hole)
export function crewHole(x, y, z, big = 0) { const r = Math.hypot(x / (0.083 + big), (z + 0.012) / (0.074 + big * 0.6)); const fr = Math.max(0, Math.min(1, (z + 0.01) / 0.06)), bk = Math.max(0, Math.min(1, -(z + 0.01) / 0.06)); return Math.min((1 - r) * 0.08, y - (1.452 - 0.014 * fr + 0.01 * bk - big * 0.15)); }
export function vHole(x, y, z) { return Math.max(crewHole(x, y, z, 0.012), Math.min(z + 0.02, (y - 1.255) * 0.42 - Math.abs(x))); }
function regionBody(m) { // aReg = (arm t, leg t, crew hole, v hole) from bind position + weights
  return setAttr(m, 'aReg', 4, (x, y, z, i, o) => { const p = [x, y, z]; const aw = boneSum(m, i, ARMB), lw = boneSum(m, i, LEGB);
    o[0] = -0.12 + (ARM(p) + 0.12) * sstep(0.3, 0.7, aw); o[1] = -0.12 + (LEG(p) + 0.12) * sstep(0.3, 0.7, lw); o[2] = crewHole(x, y, z); o[3] = vHole(x, y, z); }); }

// ---------------------------------------------------------------- shapes (cached)
let SH = null;
function shapes() { if (SH) return SH; const body = bodyPrims({}), head = headPrims({}), hands = [...handPrims(-1), ...handPrims(1)];
  SH = { body, head, hands, sBody: new Shape(body), sHead: new Shape(head), sHands: new Shape(hands), all: new Shape([...body, ...head.filter(p => !['neck', 'trap', 'clav'].includes(p.tag)), ...hands]),
    fBody: new Shape(bodyPrims({ fem: 1 })).fn, hBody: new Shape(bodyPrims({ heavy: 1 })).fn, fHead: new Shape(headPrims({ fem: 1 })).fn, wHead: new Shape(headPrims({ wide: 1 })).fn, nHead: new Shape(headPrims({ nose: 1 })).fn,
    fHands: new Shape([...handPrims(-1, { fem: 1 }), ...handPrims(1, { fem: 1 })]).fn, hHands: new Shape([...handPrims(-1, { heavy: 1 }), ...handPrims(1, { heavy: 1 })]).fn };
  SH.fAll = (x, y, z) => { let d = SH.sBody.eval(x, y, z); for (const s of [SH.sHead, SH.sHands]) if (s.bound(x, y, z) < d) d = Math.min(d, s.eval(x, y, z)); return d; }; return SH; }
const AO_BODY = { steps: [[0.015, 1], [0.04, 0.7], [0.09, 0.4], [0.16, 0.2]], k: 1.5 };
const AO_FACE = { steps: [[0.003, 1], [0.008, 0.8], [0.018, 0.5], [0.04, 0.3]], k: 1.35 };
// wrist cut: >0 keeps the forearm side (only near the forearm axis)
function wristKeep(x, y, z) { const s = x < 0 ? -1 : 1, W = mx(s, LM.WR), A = mx(s, nrm(sub(LM.WR, LM.EL))); const d = [x - W[0], y - W[1], z - W[2]], u = dot(d, A); const rad = Math.hypot(d[0] - A[0] * u, d[1] - A[1] * u, d[2] - A[2] * u); return Math.max(-0.03 - u, rad - 0.055); }

// ---------------------------------------------------------------- body
function bodyMesh(h) { const S = shapes();
  let m = polygonize(S.sBody.fn, [-0.34, 0.055, -0.2, 0.34, 1.545, 0.21], h);
  m = clip(m, (x, y, z) => Math.min(0.003 - headSide(x, y, z), y - 0.07, wristKeep(x, y, z) + 0.003));
  skinWeights(m, S.body, { nbones: NB, tau: 0.012 }); bakeAO(m, S.fAll, AO_BODY); morph(m, S.fBody, 'aM0'); morph(m, S.hBody, 'aM1'); regionBody(m);
  tuck(m, (x, y, z) => 0.0022 * Math.max(sstep(-0.006, 0.003, headSide(x, y, z)), sstep(-0.006, 0.003, -wristKeep(x, y, z)))); return m; }
function tuck(m, fn) { for (let i = 0; i < vcount(m); i++) { const k = fn(m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2]); if (k > 0) for (let c = 0; c < 3; c++) m.P[i * 3 + c] -= m.N[i * 3 + c] * k; } }
function figureMesh(h) { // LOD2: whole figure (body + head + hands + feet), clothes painted in the shader
  const S = shapes(); const prims = [...S.body, ...S.head.filter(p => !['neck', 'trap', 'clav'].includes(p.tag) && !p.sub), ...S.hands]; const sh = new Shape(prims);
  const m = polygonize(sh.fn, [-0.36, -0.01, -0.2, 0.36, 1.79, 0.2], h);
  skinWeights(m, prims, { nbones: NB, tau: 0.016 }); bakeAO(m, sh.fn, AO_BODY); morph(m, S.fBody, 'aM0', { mask: (x, y) => y < 1.48 ? 1 : 0 }); morph(m, S.hBody, 'aM1', { mask: (x, y) => y < 1.48 ? 1 : 0 }); regionBody(m);
  setAttr(m, 'uv', 2, (x, y, z, i, o) => { o[0] = 0.5 + x / 0.2; o[1] = (y - 1.49) / 0.29; }); return m; }
function headMesh(fine, coarse) { const S = shapes();
  const ef = Math.min(fine, 0.0032), xs = axis(-0.11, 0.11, x => ramp(Math.abs(x), 0, 0.075, Math.abs(x) < 0.05 ? Math.max(ef, fine * 0.7) : fine, coarse * 0.85)), ys = axis(1.476, 1.775, y => y > 1.62 && y < 1.664 ? ef : ramp(y, 1.55, 1.70, fine, coarse)), zs = axis(-0.13, 0.125, z => z > 0.05 ? Math.max(ef, fine * 0.7) : ramp(z, -0.035, 0.2, fine, coarse));
  let m = polygonize(S.sHead.fn, null, fine, { xs, ys, zs });
  ensure(m, 'hem', 1, 0); m = clip(m, eyeOpening); m = hem(m, 0.0018, { round: 0.12, attr: (k, c, v, inner) => k === 'hem' ? (inner ? 1 : 0.5) : v });
  m = clip(m, (x, y, z) => headSide(x, y, z) + 0.003);
  skinWeights(m, S.head, { nbones: NB, tau: 0.01 }); bakeAO(m, S.sHead.fn, AO_FACE); { const a = m.A.ao.data, b = bakeAO({ P: m.P, N: m.N, A: {} }, S.fAll, AO_BODY).A.ao.data; for (let i = 0; i < a.length; i++) { const k = sstep(1.5, 1.545, m.P[i * 3 + 1]); a[i] = (1 + (a[i] - 1) * k) * b[i]; } }
  morph(m, S.fHead, 'aM0', { max: 0.02 }); morph(m, S.wHead, 'aM1', { max: 0.02 }); morph(m, S.nHead, 'aM2', { max: 0.02 });
  setAttr(m, 'uv', 2, (x, y, z, i, o) => { o[0] = 0.5 + x / 0.2; o[1] = (y - 1.49) / 0.29; });
  tuck(m, (x, y, z) => 0.0012 * sstep(0.003, -0.003, headSide(x, y, z)));
  const hm = m.A.hem.data; setAttr(m, 'aReg', 4, (x, y, z, i, o) => { o[0] = hm[i]; o[1] = scalpMask(x, y, z); o[2] = beardMask(x, y, z); o[3] = 0; }); return m; }
export function scalpMask(x, y, z) { const th = Math.atan2(x, z + 0.01); const a = Math.abs(th); const yl = a < 0.6 ? 1.703 - a * 0.012 : a < 1.3 ? 1.696 - (a - 0.6) * 0.09 : a < 2.0 ? 1.633 - (a - 1.3) * 0.02 : 1.619 - (a - 2.0) * 0.035;
  let v = sstep(-0.004, 0.006, y - yl); const ear = Math.hypot((Math.abs(x) - 0.078) * 0.6, y - 1.636, z + 0.012) - 0.031; v *= sstep(-0.004, 0.006, ear); return v; }
export function beardMask(x, y, z) { if (z < -0.02) return 0; const th = Math.atan2(x, z + 0.01), a = Math.abs(th); let v = sstep(1.64, 1.615, y) * sstep(1.45, 0.9, a) * sstep(-0.015, 0.01, z);
  const lip = Math.hypot(x / 0.027, (y - 1.577) / 0.011); v *= sstep(0.95, 1.25, lip); const sideburn = sstep(1.62, 1.6, y) ? 0 : 0; return Math.min(1, v + sideburn); }
function handsMesh(h) { const S = shapes();
  let m = polygonize(S.sHands.fn, [-0.37, 0.69, -0.09, 0.37, 0.96, 0.12], h, { xs: axis(-0.37, 0.37, x => Math.abs(x) < 0.21 ? 0.03 : h) });
  m = clip(m, (x, y, z) => -wristKeep(x, y, z) + 0.003);
  tuck(m, (x, y, z) => 0.0012 * sstep(0.003, -0.003, -wristKeep(x, y, z))); skinWeights(m, S.hands, { nbones: NB, tau: 0.006 }); bakeAO(m, S.fAll, { steps: [[0.004, 1], [0.01, 0.7], [0.025, 0.4], [0.06, 0.2]], k: 1.3 }); morph(m, S.fHands, 'aM0', { max: 0.01 }); morph(m, S.hHands, 'aM1', { max: 0.01 }); return m; }

// ---------------------------------------------------------------- eyes: eyeballs + blink lids (aReg.x: 0 eyeball, 1 lid; aReg.y side)
function eyesMesh(seg) { const parts = [];
  for (const s of [-1, 1]) { const c = mx(s, LM.EYE);
    const eb = new THREE.SphereGeometry(LM.EYER, seg, Math.round(seg * 0.75)).rotateX(Math.PI / 2); // pole forward (+z) for clean iris rings
    parts.push(fromThree(eb, (p, n) => { p[0] += c[0]; p[1] += c[1]; p[2] += c[2]; }, [0, s]));
    const lid = new THREE.SphereGeometry(LM.EYER + 0.0009, seg, Math.round(seg / 2), 0.26, 2.62, 0.52, 1.48); // closed-lid patch over the front; the shader swings it up under the lid when open
    parts.push(fromThree(lid, (p, n) => { p[0] += c[0]; p[1] += c[1]; p[2] += c[2]; }, [1, s]));
  }
  const m = merge(parts); constWeights(m, B.head); return m; }
function fromThree(g, tf, reg = [0, 0, 0, 0], ext) { const gi = g.index ? g : g; const P0 = g.attributes.position, N0 = g.attributes.normal, n = P0.count; const Pp = new Float32Array(n * 3), Nn = new Float32Array(n * 3), R = new Float32Array(n * 4), U = new Float32Array(n * 2);
  const p = [0, 0, 0], q = [0, 0, 0]; for (let i = 0; i < n; i++) { p[0] = P0.getX(i); p[1] = P0.getY(i); p[2] = P0.getZ(i); q[0] = N0.getX(i); q[1] = N0.getY(i); q[2] = N0.getZ(i); const rr = typeof reg === 'function' ? reg(p, q) : reg; tf && tf(p, q); Pp.set(p, i * 3); Nn.set(q, i * 3); R.set([rr[0] || 0, rr[1] || 0, rr[2] || 0, rr[3] || 0], i * 4); if (g.attributes.uv) U.set([g.attributes.uv.getX(i), g.attributes.uv.getY(i)], i * 2); }
  const I = g.index ? new Uint32Array(g.index.array) : new Uint32Array(Array.from({ length: n }, (_, i) => i));
  return { P: Pp, N: Nn, I, A: { aReg: { data: R, size: 4 }, uv: { data: U, size: 2 } } }; }

// ---------------------------------------------------------------- garments (shells of the body mesh)
// slot ids for the cloth shader: 0 top, 1 bottom, 2 shoe upper, 3 sole, 4 accent (tie/scarf), 5 shirt, 6 hat, 7 prop A, 8 prop B, 9 hi-vis
function shell(bm, o) { const R = bm.A.aReg.data;
  let m = offset(bm, (x, y, z, i) => o.off(x, y, z, R[i * 4], R[i * 4 + 1]));
  if (o.top) { const SI = m.A.skinIndex.data; for (let i = 0; i < SI.length; i++) if (SI[i] === B.thighL || SI[i] === B.thighR) SI[i] = B.pelvis; } // tops hang from the hips, not the thighs
  const keep = field(m, (x, y, z, i) => o.keep(x, y, z, R[i * 4], R[i * 4 + 1], R[i * 4 + 2], R[i * 4 + 3]));
  ensure(m, 'hem', 1, 0); setAttr(m, 'edge', 1, (x, y, z, i, out) => { out[0] = keep[i]; });
  m = clip(m, keep); m = hem(m, o.hemDepth || 0.01, { round: 0.3, attr: (k, c, v, inner) => k === 'hem' ? (inner ? 1 : 0.6) : k === 'edge' ? 0 : v });
  const H = m.A.hem.data, E = m.A.edge.data; const R2 = m.A.aReg.data;
  setAttr(m, 'aExt', 4, (x, y, z, i, out) => { out[0] = o.slot; out[1] = H[i]; out[2] = E[i]; out[3] = o.kind || 0; });
  setAttr(m, 'aReg', 4, (x, y, z, i, out) => { out[0] = R2[i * 4]; out[1] = R2[i * 4 + 1]; out[2] = R2[i * 4 + 2]; out[3] = R2[i * 4 + 3]; });
  bakeAO(m, shapes().fAll, { steps: [[0.025, 1], [0.06, 0.6], [0.12, 0.3]], k: 0.9 }); return m; }
const TOPS = {
  tee: { off: (x, y, z, a) => 0.0085 + (a > 0 ? 0.004 * sstep(0, 0.15, a) : 0), keep: (x, y, z, a, l, c) => Math.min(0.175 - a, y - 0.855, -c), hemDepth: 0.008 },
  long: { off: (x, y, z, a) => 0.009 + (a > 0 ? 0.004 : 0), keep: (x, y, z, a, l, c) => Math.min(0.5 - a, y - 0.85, -c), hemDepth: 0.008 },
  jacket: { off: (x, y, z, a) => 0.011 + (a > 0 ? 0.002 : 0) + sstep(1.0, 0.8, y) * 0.006, keep: (x, y, z, a, l, c, v) => Math.min(0.505 - a, y - 0.775, -v), hemDepth: 0.012 },
  hoodie: { off: (x, y, z, a) => 0.016 + (a > 0 ? 0.006 * sstep(0.1, 0.45, a) : 0), keep: (x, y, z, a, l, c) => Math.min(0.495 - a, y - 0.83, -crewHole(x, y, z, -0.006)), hemDepth: 0.014 },
  vest: { off: () => 0.024, keep: (x, y, z, a, l, c, v) => Math.min(-0.01 - a, y - 0.86, -v), hemDepth: 0.006 },
};
const BOTTOMS = {
  trousers: { off: (x, y, z, a, l) => 0.009 + sstep(0.2, 0.83, l) * 0.009, keep: (x, y, z, a, l) => Math.min(1.0 - y, 0.822 - l, -0.02 - a), hemDepth: 0.012 },
  jeans: { off: (x, y, z, a, l) => 0.007 + sstep(0.3, 0.83, l) * 0.005, keep: (x, y, z, a, l) => Math.min(0.985 - y, 0.82 - l, -0.02 - a), hemDepth: 0.009 },
  shorts: { off: (x, y, z, a, l) => 0.01 + sstep(0.0, 0.3, l) * 0.012, keep: (x, y, z, a, l) => Math.min(0.99 - y, 0.31 - l, -0.02 - a), hemDepth: 0.012 },
};
function skirtMesh(h, len = 0.5) { // lofted skirt around a female body, flared, weights blend pelvis → thighs
  const S = shapes(), fb = S.fBody, hv = new Shape(bodyPrims({ fem: 1, heavy: 1 })).fn; const yTop = 1.0, yBot = 1.0 - len; const rings = Math.max(6, Math.round(len / h)), segs = Math.max(16, Math.round(1.1 / h));
  const radAt = (f, y, th) => { const dx = Math.sin(th), dz = Math.cos(th); let r = 0.02; for (let i = 0; i < 40 && r < 0.4; i++) { const d = f(dx * r, y, -0.01 + dz * r); if (d > 0) { r -= 0.004; for (let k = 0; k < 8; k++) { r += 0.0005; if (f(dx * r, y, -0.01 + dz * r) > 0) break; } return r; } r += Math.max(0.004, -d * 0.8); } return r; };
  const Pp = [], Ii = [], M1 = []; const maxR = new Float32Array(segs);
  for (let j = 0; j <= rings; j++) { const t = j / rings, y = yTop - len * t;
    for (let i = 0; i < segs; i++) { const th = i / segs * Math.PI * 2; let r = radAt(fb, y, th) + 0.012 + t * t * 0.02; maxR[i] = Math.max(maxR[i] * (1 - 0.0), r); r = Math.max(r, maxR[i] - 0.004 * t) + Math.max(0, t - 0.15) * 0.07 * (0.75 + 0.25 * Math.cos(th)); const rh = radAt(hv, y, th) + 0.012 + t * t * 0.02;
      Pp.push(Math.sin(th) * r, y, -0.01 + Math.cos(th) * r + t * 0.012); M1.push(Math.sin(th) * Math.max(0, rh - r) * 0.8, 0, Math.cos(th) * Math.max(0, rh - r) * 0.8); } }
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) { const a = j * segs + i, b = j * segs + (i + 1) % segs, c = a + segs, d = b + segs; Ii.push(a, c, b, b, c, d); }
  const n = Pp.length / 3, N = new Float32Array(n * 3);
  for (let j = 0; j <= rings; j++) for (let i = 0; i < segs; i++) { const k = j * segs + i, l = j * segs + (i + 1) % segs, r = j * segs + (i + segs - 1) % segs, u = Math.max(0, j - 1) * segs + i, d = Math.min(rings, j + 1) * segs + i;
    const tx = Pp[l * 3] - Pp[r * 3], ty = Pp[l * 3 + 1] - Pp[r * 3 + 1], tz = Pp[l * 3 + 2] - Pp[r * 3 + 2], vx = Pp[u * 3] - Pp[d * 3], vy = Pp[u * 3 + 1] - Pp[d * 3 + 1], vz = Pp[u * 3 + 2] - Pp[d * 3 + 2];
    let nx = ty * vz - tz * vy, ny = tz * vx - tx * vz, nz = tx * vy - ty * vx; const L = Math.hypot(nx, ny, nz) || 1; N.set([-nx / L, -ny / L, -nz / L], k * 3); }
  let m = { P: new Float32Array(Pp), N, I: new Uint32Array(Ii), A: { aM1: { data: new Float32Array(M1), size: 3 } } };
  // fix outward normals
  for (let i = 0; i < n; i++) if (N[i * 3] * Pp[i * 3] + N[i * 3 + 2] * (Pp[i * 3 + 2] + 0.01) < 0) { N[i * 3] *= -1; N[i * 3 + 1] *= -1; N[i * 3 + 2] *= -1; }
  { let agree = 0; for (let t = 0; t < Ii.length; t += 3) { const a = Ii[t] * 3, b = Ii[t + 1] * 3, c = Ii[t + 2] * 3; const ux = Pp[b] - Pp[a], uy = Pp[b + 1] - Pp[a + 1], uz = Pp[b + 2] - Pp[a + 2], wx = Pp[c] - Pp[a], wy = Pp[c + 1] - Pp[a + 1], wz = Pp[c + 2] - Pp[a + 2]; const nx = uy * wz - uz * wy, nz = ux * wy - uy * wx; agree += (nx * Pp[a] + nz * (Pp[a + 2] + 0.01)) > 0 ? 1 : -1; } if (agree < 0) for (let t = 0; t < m.I.length; t += 3) { const x = m.I[t + 1]; m.I[t + 1] = m.I[t + 2]; m.I[t + 2] = x; } }
  ensure(m, 'hem', 1, 0); m = hem(m, 0.01, { round: 0.3, attr: (k, c, v, inner) => k === 'hem' ? (inner ? 1 : 0.6) : v });
  // weights
  const SI = new Float32Array(vcount(m) * 4), SW = new Float32Array(vcount(m) * 4);
  for (let i = 0; i < vcount(m); i++) { const x = m.P[i * 3], y = m.P[i * 3 + 1]; const down = sstep(0.95, 0.62, y) * 0.92, side = sstep(-0.07, 0.07, x); const wl = down * (1 - side), wr = down * side; SI.set([B.pelvis, B.thighL, B.thighR, B.spine], i * 4); SW.set([1 - down, wl, wr, 0], i * 4); }
  m.A.skinIndex = { data: SI, size: 4 }; m.A.skinWeight = { data: SW, size: 4 };
  const H = m.A.hem.data; setAttr(m, 'aExt', 4, (x, y, z, i, o) => { o[0] = 1; o[1] = H[i]; o[2] = 1; o[3] = 3; }); setAttr(m, 'aReg', 4, (x, y, z, i, o) => { o[0] = -0.1; o[1] = (1.0 - y) * 0.8; o[2] = -1; o[3] = -1; });
  bakeAO(m, S.fAll, { steps: [[0.025, 1], [0.06, 0.6], [0.12, 0.3]], k: 0.6 }); // (body is male here; mild)
  return m; }
function hoodMesh(h) { const S = shapes(); const sh = new Shape([P.ell([0, 1.47, -0.105], [0.11, 0.055, 0.06], { k: 0.04 }), ...[-1, 1].map(s => P.cap([s * 0.075, 1.46, -0.085], [s * 0.06, 1.42, 0.06], 0.026, { k: 0.04 })), P.ell([0, 1.43, -0.12], [0.08, 0.06, 0.045], { k: 0.03 })]);
  let m = polygonize(sh.fn, [-0.16, 1.32, -0.2, 0.16, 1.56, 0.12], h); m = clip(m, (x, y, z) => S.sBody.eval(x, y, z) - 0.014);
  skinWeights(m, [P.fn(() => 0, [-1, -1, -1], [1, 1, 1], { bones: [[B.chest, 0.8], [B.neck, 0.2]] })], { nbones: NB }); setAttr(m, 'aExt', 4, (x, y, z, i, o) => { o[0] = 0; o[1] = 0; o[2] = 1; o[3] = 4; }); setAttr(m, 'aReg', 4, (x, y, z, i, o) => { o[0] = -0.1; o[1] = -0.1; o[2] = -1; o[3] = -1; });
  bakeAO(m, (x, y, z) => Math.min(S.fAll(x, y, z), sh.eval(x, y, z)), { steps: [[0.01, 1], [0.03, 0.6], [0.06, 0.3]], k: 1.0 }); return m; }

// ---------------------------------------------------------------- shoes (both feet)
function shoeMesh(h, kind) { const L = [];
  for (const s of [-1, 1]) { const S = s < 0 ? 'L' : 'R', fb = [[B['foot' + S], 1]], x = s * 0.103; const dress = kind === 'dress';
    const soleH = dress ? 0.014 : 0.028, len = dress ? 0.135 : 0.13;
    const foot = (px, pz) => { // 2D footprint (heel circle → forefoot circle)
      const ax = x, az = -0.07, bx = x + s * 0.008, bz = 0.165, ra = 0.036, rb = dress ? 0.036 : 0.044; const ux = bx - ax, uz = bz - az, l = Math.hypot(ux, uz); const qx = px - ax, qz = pz - az; const t = Math.max(0, Math.min(1, (qx * ux + qz * uz) / (l * l))); const r = ra + (rb - ra) * t; let d = Math.hypot(qx - ux * t, qz - uz * t) - r;
      if (dress) { const tip = Math.hypot(px - bx, pz - (bz + 0.03)) - 0.018; d = Math.min(d, tip + 0.005); } return d; };
    L.push(P.fn((px, py, pz) => { const d2 = foot(px, pz), dy = Math.abs(py - soleH / 2) - soleH / 2; return Math.hypot(Math.max(d2, 0), Math.max(dy, 0)) + Math.min(Math.max(d2, dy), 0) - 0.003; }, [x - 0.07, -0.01, -0.12], [x + 0.07, soleH + 0.01, 0.24], { k: 0.004, bones: fb, tag: 'sole' }));
    L.push(P.ell([x + s * 0.004, soleH + 0.022, 0.08], [0.043 - (dress ? 0.004 : 0), 0.03 - (dress ? 0.004 : 0), len * 0.75], { k: 0.02, bones: fb, tag: 'upper' }));
    L.push(P.ell([x, soleH + 0.04, -0.035], [0.041, 0.05, 0.05], { k: 0.02, bones: fb, tag: 'heel' }));
    L.push(P.cap([x, soleH + 0.03, -0.03], [x, dress ? 0.095 : 0.115, -0.022], dress ? 0.038 : 0.043, { k: 0.015, bones: [[B['foot' + S], 0.8], [B['shin' + S], 0.2]], tag: 'collar' }));
    if (!dress) L.push(P.ell([x, soleH + 0.05, 0.035], [0.034, 0.025, 0.06], { k: 0.015, rot: [0.5, 0, 0], bones: fb, tag: 'tongue' }));
  }
  const sh = new Shape(L); let m = polygonize(sh.fn, [-0.18, -0.02, -0.13, 0.18, 0.15, 0.26], h); m = clip(m, (x, y, z) => (kind === 'dress' ? 0.088 : 0.108) - y + 0.0 * z);
  skinWeights(m, L, { nbones: NB, tau: 0.01 }); ensure(m, 'hem', 1, 0); m = hem(m, 0.006, { round: 0.2, attr: (k, c, v, inner) => k === 'hem' ? 1 : v });
  const soleH = kind === 'dress' ? 0.014 : 0.028, H = m.A.hem.data;
  setAttr(m, 'aExt', 4, (x, y, z, i, o) => { o[0] = y < soleH + 0.003 ? 3 : 2; o[1] = H[i]; o[2] = 1; o[3] = kind === 'dress' ? 5 : 6; }); setAttr(m, 'aReg', 4, (x, y, z, i, o) => { o[0] = y; o[1] = z; o[2] = soleH; o[3] = 0; });
  bakeAO(m, (x, y, z) => Math.min(sh.eval(x, y, z), y + 0.0), { steps: [[0.008, 1], [0.02, 0.6], [0.05, 0.3]], k: 0.9 }); return m; }

// ---------------------------------------------------------------- hair (volumes around the cranium, clipped at the hairline; aExt = flow tangent xyz + edge)
const HAIR = {
  short: { T: (x, y, z) => 0.006 + 0.004 * sstep(1.66, 1.74, y), line: { front: 1.704 }, flow: (x, y, z) => [x * 0.3, -0.25, -1] },
  side: { T: (x, y, z) => 0.007 + 0.016 * sstep(1.66, 1.75, y) * sstep(-0.06, 0.06, z), line: { front: 1.708 }, flow: (x, y, z) => [x > 0.025 ? 1 : -0.6, -0.35, -0.35], extra: [P.ell([0.012, 1.735, 0.035], [0.06, 0.035, 0.065], { k: 0.03 })] },
  long: { T: (x, y, z) => 0.01 + 0.006 * sstep(1.65, 1.74, y), line: { front: 1.712, long: 1.40, ears: false }, flow: (x, y, z) => [Math.sign(x) * 0.5 * sstep(1.6, 1.75, y), -1, -0.2 * sstep(1.6, 1.74, y)],
    extra: [P.box([0, 1.52, -0.105], [0.082, 0.14, 0.035], 0.03, { k: 0.06, rot: [0.12, 0, 0] }), ...[-1, 1].map(s => P.box([s * 0.078, 1.57, -0.02], [0.022, 0.1, 0.05], 0.018, { k: 0.04, rot: [0.0, 0, s * 0.06] }))] },
  bob: { T: (x, y, z) => 0.012 + 0.004 * sstep(1.65, 1.74, y), line: { front: 1.69, long: 1.565, ears: false, fringe: true }, flow: (x, y, z) => [Math.sign(x) * 0.3, -1, 0.15],
    extra: [P.ell([0, 1.62, -0.03], [0.098, 0.075, 0.105], { k: 0.04 }), P.box([0, 1.7, 0.075], [0.06, 0.03, 0.02], 0.015, { k: 0.03, rot: [-0.5, 0, 0] })] },
  pony: { T: (x, y, z) => 0.005 + 0.002 * sstep(1.66, 1.74, y), line: { front: 1.71 }, flow: (x, y, z) => [x * 0.2, 0.15, -1], extra: [P.cone([0, 1.68, -0.12], [0, 1.52, -0.165], 0.022, 0.012, { k: 0.02 }), P.sph([0, 1.675, -0.118], 0.02, { k: 0.01 })], ponyLong: true },
  bun: { T: (x, y, z) => 0.005 + 0.002 * sstep(1.66, 1.74, y), line: { front: 1.71 }, flow: (x, y, z) => [x * 0.2, 0.4, -1], extra: [P.ell([0, 1.74, -0.085], [0.04, 0.034, 0.036], { k: 0.012 })] },
  curly: { T: (x, y, z) => 0.022 + 0.012 * sstep(1.66, 1.76, y) + 0.004 * Math.sin(x * 240) * Math.sin(y * 230) * Math.sin(z * 250), line: { front: 1.70 }, flow: (x, y, z) => [Math.sin(y * 300), Math.cos(z * 280), Math.sin(x * 290)] },
  bald: { T: (x, y, z) => 0.003, line: { front: 1.64, crown: true }, flow: (x, y, z) => [0, -1, -0.3] },
};
export const HAIR_STYLES = Object.keys(HAIR);
function hairLine(x, y, z, L) { // >0 inside the hair region
  const th = Math.atan2(x, z + 0.01), a = Math.abs(th); const f = L.front;
  let yl = a < 0.55 ? f - a * a * 0.03 : a < 1.25 ? f - 0.009 - (a - 0.55) * 0.085 : a < 2.0 ? f - 0.069 - (a - 1.25) * 0.03 : f - 0.091 - (a - 2.0) * 0.03;
  let v = y - yl;
  if (L.ears !== false) { const ear = Math.hypot((Math.abs(x) - 0.08) * 0.7, (y - 1.637) * 0.9, z + 0.012) - 0.028; v = Math.min(v, ear + 0.003); }
  if (L.long) v = Math.max(v, Math.min(y - L.long, (a - 1.05) * 0.06));
  if (L.fringe) v = Math.max(v, Math.min(y - 1.684, (0.95 - a) * 0.06));
  if (L.crown) v = Math.min(v, 1.70 - y, (a - 1.1) * 0.05); // male pattern: ring around the sides/back
  return v; }
function hairMesh(style, fine, coarse) { const H = HAIR[style]; const S = shapes(); const cr = new Shape(craniumPrims());
  const sh = new Shape([P.fn((x, y, z) => cr.eval(x, y, z) - H.T(x, y, z) * sstep(-0.004, 0.012, hairLine(x, y, z, H.line)) - 0.0012, [-0.12, 1.5, -0.16], [0.12, 1.8, 0.12], { k: 0.0 }), ...(H.extra || [])]);
  const lo = H.line.long ? Math.min(H.line.long, 1.5) - 0.03 : H.ponyLong ? 1.49 : 1.56;
  const xs = axis(-0.13, 0.13, () => fine), ys = axis(lo, 1.8, y => ramp(y, 1.6, 1.74, fine, coarse)), zs = axis(-0.2, 0.13, z => ramp(z, 0.0, 0.2, fine, coarse));
  let m = polygonize(sh.fn, null, fine, { xs, ys, zs });
  const keep = field(m, (x, y, z) => { let v = hairLine(x, y, z, H.line); if (H.extra) for (const e of H.extra) if (e.f(x, y, z) < 0.006) v = Math.max(v, 0.01); return Math.min(v + 0.004, S.sHead.eval(x, y, z) + 0.0006); });
  m = clip(m, keep);
  // weights: head, lower long hair follows the chest
  const SI = new Float32Array(vcount(m) * 4), SW = new Float32Array(vcount(m) * 4); for (let i = 0; i < vcount(m); i++) { const y = m.P[i * 3 + 1], z = m.P[i * 3 + 2]; const lw = sstep(1.58, 1.46, y) * (z < -0.04 || Math.abs(m.P[i * 3]) > 0.07 ? 0.85 : 0.5); SI.set([B.head, B.chest, B.neck, 0], i * 4); SW.set([1 - lw, lw * 0.7, lw * 0.3, 0], i * 4); }
  m.A.skinIndex = { data: SI, size: 4 }; m.A.skinWeight = { data: SW, size: 4 };
  setAttr(m, 'aExt', 4, (x, y, z, i, o, nx, ny, nz) => { let f = H.flow(x, y, z); const d = f[0] * nx + f[1] * ny + f[2] * nz; f = [f[0] - nx * d, f[1] - ny * d, f[2] - nz * d]; const l = Math.hypot(...f) || 1; o[0] = f[0] / l; o[1] = f[1] / l; o[2] = f[2] / l;
    let e = hairLine(x, y, z, H.line); if (H.extra) for (const q of H.extra) if (q.f(x, y, z) < 0.006) e = Math.max(e, 0.02); o[3] = sstep(-0.002, 0.016, e); });
  bakeAO(m, (x, y, z) => Math.min(sh.eval(x, y, z), S.fAll(x, y, z)), { steps: [[0.006, 1], [0.015, 0.7], [0.04, 0.4], [0.08, 0.2]], k: 1.1 }); return m; }
function beardMesh(kind, fine) { const S = shapes(); const msk = kind === 'moustache' ? (x, y, z) => sstep(1.6, 1.592, y) * sstep(1.582, 1.588, y) * sstep(0.034, 0.02, Math.abs(x)) * sstep(0.05, 0.08, z) : beardMask;
  const T = kind === 'moustache' ? 0.0045 : 0.0065; const sh = new Shape([P.fn((x, y, z) => { const k = msk(x, y, z); return k < 0.06 ? 0.01 : S.sHead.eval(x, y, z) - T * k - 0.0008; }, [-0.1, 1.5, -0.05], [0.1, 1.66, 0.13], { k: 0 })]);
  let m = polygonize(sh.fn, [-0.09, 1.51, -0.04, 0.09, 1.65, 0.125], fine); m = clip(m, (x, y, z) => msk(x, y, z) - 0.12);
  constWeights(m, B.head); setAttr(m, 'aExt', 4, (x, y, z, i, o, nx, ny, nz) => { let f = [0, -1, 0.2]; const d = f[0] * nx + f[1] * ny + f[2] * nz; f = [f[0] - nx * d, f[1] - ny * d, f[2] - nz * d]; const l = Math.hypot(...f) || 1; o[0] = f[0] / l; o[1] = f[1] / l; o[2] = f[2] / l; o[3] = -Math.max(0.02, sstep(0.12, 0.6, msk(x, y, z))); });
  bakeAO(m, S.sHead.fn, AO_FACE); morph(m, S.fHead, 'aM0', { max: 0.02 }); morph(m, S.wHead, 'aM1', { max: 0.02 }); return m; }

// ---------------------------------------------------------------- accessories & props (rigid)
function threeMesh(g, bone, slot, kind = 0, tf) { const m = fromThree(g.index ? g : g, tf, [-0.1, -0.1, -1, -1]); constWeights(m, bone); setAttr(m, 'aExt', 4, (x, y, z, i, o) => { o[0] = slot; o[1] = 0; o[2] = 1; o[3] = kind; }); ensure(m, 'ao', 1, 1); return m; }
function rbox(w, h, d, r, seg = 2) { const g = new THREE.BoxGeometry(w, h, d, seg * 2 + 2, seg * 2 + 2, seg * 2 + 2); const p = g.attributes.position, n = g.attributes.normal, hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const cx = Math.max(-hw, Math.min(hw, x)), cy = Math.max(-hh, Math.min(hh, y)), cz = Math.max(-hd, Math.min(hd, z)); let dx = x - cx, dy = y - cy, dz = z - cz; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l; p.setXYZ(i, cx + dx * r, cy + dy * r, cz + dz * r); n.setXYZ(i, dx, dy, dz); }
  return g; }
function accessories() {
  const tie = (() => { const s = new THREE.Shape(); s.moveTo(-0.017, 0); s.lineTo(0.017, 0); s.lineTo(0.034, -0.2); s.lineTo(-0.034, -0.2); s.closePath(); const g = new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 1 }).toNonIndexed(); g.computeVertexNormals();
    const knot = rbox(0.04, 0.032, 0.02, 0.009, 2).translate(0, 0.006, 0.004); return merge([threeMesh(g, B.chest, 4, 7, (p, n) => { const t = -p[1]; p[2] += 0.104 - t * 0.03; p[1] += 1.418; }), threeMesh(knot, B.chest, 4, 7, (p) => { p[1] += 1.418; p[2] += 0.106; })]); })();
  const scarf = (() => { const k = new THREE.TorusGeometry(0.062, 0.016, 8, 22).rotateX(Math.PI / 2).scale(1.05, 1, 0.95); const knot = new THREE.SphereGeometry(0.022, 10, 8).scale(1.1, 0.8, 0.8); const tail = rbox(0.045, 0.1, 0.01, 0.004, 1);
    return merge([threeMesh(k, B.chest, 4, 7, p => { p[1] += 1.452; p[2] += -0.018; }), threeMesh(knot, B.chest, 4, 7, p => { p[0] += 0.03; p[1] += 1.43; p[2] += 0.064; }), threeMesh(tail, B.chest, 4, 7, p => { const y = p[1]; p[0] += 0.045 + y * 0.25; p[1] += 1.385; p[2] += 0.082; })]); })();
  const hat = (() => { const crown = new THREE.LatheGeometry([[0, 0.0], [0.095, 0.0], [0.1, 0.03], [0.112, 0.07], [0.11, 0.08], [0.0, 0.082]].map(([r, y]) => new THREE.Vector2(r, y)), 24).scale(1, 1, 1.12);
    const band = new THREE.CylinderGeometry(0.097, 0.097, 0.03, 24, 1, true).scale(1, 1, 1.12).translate(0, 0.016, 0); const visor = new THREE.CylinderGeometry(0.1, 0.1, 0.006, 20, 1, false, -Math.PI * 0.42, Math.PI * 0.84).scale(1, 1, 1.25).rotateX(-0.25).translate(0, 0.004, 0.035);
    const tf = p => { p[0] *= 1.05; p[2] *= 1.05; p[1] += 1.733; p[2] += -0.018; }; return merge([threeMesh(crown, B.head, 6, 8, tf), threeMesh(band, B.head, 4, 9, tf), threeMesh(visor, B.head, 3, 8, tf)]); })();
  // props in their own frames (bound to prop bones)
  const phone = merge([threeMesh(rbox(0.072, 0.148, 0.0085, 0.006, 2), B.prop1, 7, 10)]);
  const book = merge([threeMesh(rbox(0.15, 0.215, 0.026, 0.004, 1), B.prop1, 8, 11)]);
  const backpack = (() => { const bag = rbox(0.26, 0.36, 0.12, 0.045, 2), pocket = rbox(0.18, 0.14, 0.045, 0.018, 1); const st = []; for (const s of [-1, 1]) { const c = new THREE.CatmullRomCurve3([[0.075, 1.38, -0.15], [0.095, 1.475, -0.045], [0.11, 1.42, 0.075], [0.125, 1.28, 0.095], [0.155, 1.17, 0.02], [0.1, 1.11, -0.15]].map(([x, y, z]) => new THREE.Vector3(s * x, y, z))); st.push(new THREE.TubeGeometry(c, 24, 0.011, 5, false).scale(1, 1, 1)); }
    const tf = p => { p[1] += 1.24; p[2] += -0.19; }; return merge([threeMesh(bag, B.chest, 8, 12, tf), threeMesh(pocket, B.chest, 8, 12, p => { p[1] += 1.17; p[2] += -0.265; }), ...st.map(g => threeMesh(g, B.chest, 8, 12))]); })();
  const suitcase = (() => { const c = rbox(0.38, 0.54, 0.22, 0.03, 2).translate(0, 0.32, 0); const rods = [-1, 1].map(s => new THREE.CylinderGeometry(0.008, 0.008, 0.42, 6).translate(s * 0.07, 0.79, -0.08)); const grip = rbox(0.17, 0.025, 0.03, 0.01, 1).translate(0, 1.0, -0.08);
    const wheels = [-1, 1].map(s => new THREE.CylinderGeometry(0.03, 0.03, 0.025, 10).rotateZ(Math.PI / 2).translate(s * 0.15, 0.03, -0.08));
    return merge([threeMesh(c, B.prop2, 8, 13), ...rods.map(g => threeMesh(g, B.prop2, 7, 10)), threeMesh(grip, B.prop2, 7, 10), ...wheels.map(g => threeMesh(g, B.prop2, 7, 10))]); })();
  return { tie, scarf, hat, phone, book, backpack, suitcase }; }

// ---------------------------------------------------------------- build all layers
// layer: { geo, kind: 'skin'|'cloth'|'hair'|'eye', part }
let CACHE = {};
export function buildLayers(q = 'high') {
  if (CACHE[q]) return CACHE[q]; const t0 = performance.now(); const lowQ = q === 'low';
  const L = {}; let tl = performance.now(); const put = (name, m, kind, part = 0, extra = {}) => { const t = performance.now(); L[name] = { geo: toGeo(m), kind, part, tris: m.I.length / 3, ms: Math.round(t - tl), ...extra }; tl = performance.now(); };
  const b0 = bodyMesh(lowQ ? 0.027 : 0.022), b1 = bodyMesh(0.032);
  put('body0', b0, 'skin', 0); put('body1', b1, 'skin', 0); put('fig2', figureMesh(0.045), 'skin', 3);
  put('head0', headMesh(lowQ ? 0.0065 : 0.0055, 0.011), 'skin', 1); put('head1', headMesh(0.0115, 0.017), 'skin', 1);
  put('hands0', handsMesh(lowQ ? 0.0085 : 0.0068), 'skin', 2); put('hands1', handsMesh(0.012), 'skin', 2);
  put('eyes0', eyesMesh(lowQ ? 12 : 16), 'eye'); put('eyes1', eyesMesh(8), 'eye');
  for (const [k, o] of Object.entries(TOPS)) { put(k + '0', shell(b0, { ...o, top: true, slot: k === 'vest' ? 9 : 0, kind: { tee: 0, long: 0, jacket: 1, hoodie: 2, vest: 9 }[k] }), 'cloth'); put(k + '1', shell(b1, { ...o, top: true, slot: k === 'vest' ? 9 : 0, kind: { tee: 0, long: 0, jacket: 1, hoodie: 2, vest: 9 }[k] }), 'cloth'); }
  for (const [k, o] of Object.entries(BOTTOMS)) { put(k + '0', shell(b0, { ...o, slot: 1, kind: 3 }), 'cloth'); put(k + '1', shell(b1, { ...o, slot: 1, kind: 3 }), 'cloth'); }
  put('skirt0', skirtMesh(0.016, 0.5), 'cloth'); put('skirt1', skirtMesh(0.035, 0.5), 'cloth');
  put('hood0', hoodMesh(0.012), 'cloth'); put('hood1', hoodMesh(0.024), 'cloth');
  for (const k of ['sneaker', 'dress']) { put(k + '0', shoeMesh(lowQ ? 0.011 : 0.0092, k), 'cloth'); put(k + '1', shoeMesh(0.016, k), 'cloth'); }
  for (const k of HAIR_STYLES) { put('hair_' + k + '0', hairMesh(k, lowQ ? 0.009 : 0.0072, 0.012), 'hair', 0, { shells: lowQ ? 1 : 2 }); put('hair_' + k + '1', hairMesh(k, 0.013, 0.018), 'hair'); }
  put('beard0', beardMesh('beard', 0.005), 'hair'); put('beard1', beardMesh('beard', 0.01), 'hair'); put('moustache0', beardMesh('moustache', 0.0042), 'hair');
  const A = accessories(); for (const [k, m] of Object.entries(A)) put(k, m, 'cloth');
  // hair fur shells: duplicate LOD0 hair with a layer index in aExt? (layer in skinWeight slot unused) → separate attribute
  for (const k of Object.keys(L)) if (L[k].shells > 1) { const g = L[k].geo, n = g.attributes.position.count, sh = L[k].shells; const ng = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(g.attributes)) { const arr = new Float32Array(a.array.length * sh); for (let s = 0; s < sh; s++) arr.set(a.array, s * a.array.length); ng.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize)); }
    const lay = new Float32Array(n * sh); for (let s = 0; s < sh; s++) lay.fill(s, s * n, (s + 1) * n); ng.setAttribute('aLayer', new THREE.BufferAttribute(lay, 1));
    const idx = g.index.array, ni = new Uint32Array(idx.length * sh); for (let s = 0; s < sh; s++) for (let i = 0; i < idx.length; i++) ni[s * idx.length + i] = idx[i] + s * n; ng.setIndex(new THREE.BufferAttribute(ni, 1)); ng.boundingSphere = g.boundingSphere; L[k].geo = ng; L[k].tris *= sh; }
  L._ms = Math.round(performance.now() - t0); CACHE[q] = L; return L;
}
export { J, B, NB };
