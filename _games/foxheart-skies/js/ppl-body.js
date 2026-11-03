// People anatomy: skeleton (bind pose) and the sculpted signed-distance body, head and hands.
// Male average adult, 1.76 m (7.5 heads); female / heavy variants are morph targets (same skeleton).
import { P, Shape } from './ppl-sdf.js';

export const BN = ['pelvis', 'spine', 'chest', 'neck', 'head', 'clavL', 'armL', 'foreL', 'handL', 'fingL', 'clavR', 'armR', 'foreR', 'handR', 'fingR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'prop1', 'prop2', 'root'];
export const B = Object.fromEntries(BN.map((b, i) => [b, i])); export const NB = BN.length;
export const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 7, 8, 2, 10, 11, 12, 13, 0, 15, 16, 0, 18, 19, -1, -1, -1];
const nrm = v => { const l = Math.hypot(...v); return v.map(x => x / l); }, sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => a.map(x => x * k);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const mx = (s, v) => [v[0] * s, v[1], v[2]];
// ---------------------------------------------------------------- joints (right side; left = mirrored)
export const LM = { SH: [0.185, 1.43, -0.035], EL: [0.245, 1.146, -0.044], WR: [0.2875, 0.902, -0.009], HIP: [0.09, 0.92, 0], KNEE: [0.095, 0.495, 0.005], ANK: [0.10, 0.075, -0.025], CLAV: [0.02, 1.425, 0.0], NECK: [0, 1.45, -0.04], HEAD: [0, 1.585, -0.02], EYE: [0.032, 1.647, 0.061], EYER: 0.012, NECKCUT: 1.486 };
const HA = nrm(sub(LM.WR, LM.EL)); // forearm / hand axis (toward fingers)
// right-hand local frame: X = back of hand (lateral), Y = up the arm, Z = thumb (forward)
const HPN = nrm(sub([-1, 0, 0], mul(HA, dot([-1, 0, 0], HA)))); export const HF = { X: mul(HPN, -1), Y: mul(HA, -1) }; HF.Z = cross(HF.X, HF.Y);
export const J = new Float64Array(NB * 3);
{ const set = (b, v) => J.set(v, B[b] * 3);
  set('pelvis', [0, 0.92, 0]); set('spine', [0, 1.0, -0.015]); set('chest', [0, 1.17, -0.035]); set('neck', LM.NECK); set('head', LM.HEAD);
  for (const s of [-1, 1]) { const S = s < 0 ? 'L' : 'R'; set('clav' + S, mx(s, LM.CLAV)); set('arm' + S, mx(s, LM.SH)); set('fore' + S, mx(s, LM.EL)); set('hand' + S, mx(s, LM.WR)); set('fing' + S, mx(s, add(LM.WR, mul(HA, 0.093))));
    set('thigh' + S, mx(s, LM.HIP)); set('shin' + S, mx(s, LM.KNEE)); set('foot' + S, mx(s, LM.ANK)); } }
// bind orientation of each bone relative to its "pose-zero" frame (arms hanging straight down): quaternion [x,y,z,w]
function qFromTo(a, b) { const c = cross(a, b), d = dot(a, b); const q = [c[0], c[1], c[2], 1 + d]; const l = Math.hypot(...q); return q.map(x => x / l); }
export const QB = Array.from({ length: NB }, () => [0, 0, 0, 1]);
for (const s of [-1, 1]) { const S = s < 0 ? 'L' : 'R'; QB[B['arm' + S]] = qFromTo([0, -1, 0], nrm(mx(s, sub(LM.EL, LM.SH)))); const qf = qFromTo([0, -1, 0], mx(s, HA)); QB[B['fore' + S]] = qf; QB[B['hand' + S]] = qf; QB[B['fing' + S]] = qf; }

// ---------------------------------------------------------------- body (no head; neck shared with the head shape)
// par: { fem 0..1, heavy -1..1 }
function sharedNeck(par) { const f = par.fem || 0, h = par.heavy || 0;
  return [P.ell([0, 1.272, -0.022], [0.150 - f * 0.016 + h * 0.016, 0.166 - f * 0.006, 0.106 + h * 0.014 - f * 0.01], { k: 0.06, bones: [[B.chest, 1]], tag: 'rib' }),P.cap([0, 1.40, -0.035], [0, 1.62, -0.012], 0.0565 - f * 0.0075, { k: 0.03, bones: [[B.neck, 1]], tag: 'neck' }),
    ...[-1, 1].map(s => P.cap([0, 1.474, -0.06], [s * 0.15, 1.444, -0.05], 0.038 - f * 0.004, { k: 0.045, bones: [[B.chest, 0.45], [B.neck, 0.25], [B['clav' + (s < 0 ? 'L' : 'R')], 0.3]], tag: 'trap' })),
    ...[-1, 1].map(s => P.cap([s * 0.022, 1.432, 0.034], [s * 0.15, 1.452, -0.004], 0.016, { k: 0.03, bones: [[B.chest, 0.5], [B['clav' + (s < 0 ? 'L' : 'R')], 0.5]], tag: 'clav' }))]; }
export function bodyPrims(par = {}) {
  const f = par.fem || 0, h = par.heavy || 0, hp = Math.max(0, h), ar = 1 - f * 0.1 + h * 0.16, lg = 1 + f * 0.035 + h * 0.13; const L = [];
  // torso (ribcage is in sharedNeck)
  L.push(P.ell([0, 1.08 + h * 0.005, 0.003 + hp * 0.03], [0.132 - f * 0.02 + h * 0.034, 0.128, 0.094 + h * 0.048], { k: 0.07, bones: [[B.spine, 0.75], [B.pelvis, 0.25]], tag: 'abd' }));
  L.push(P.ell([0, 0.948, -0.006], [0.158 + f * 0.024 + h * 0.022, 0.104, 0.098 + h * 0.016 + f * 0.004], { k: 0.05, bones: [[B.pelvis, 1]], tag: 'pelvis' }));
  for (const s of [-1, 1]) { const S = s < 0 ? 'L' : 'R';
    L.push(P.ell([s * 0.064, 0.895, -0.052 - f * 0.01], [0.080 + f * 0.012 + h * 0.012, 0.098 + f * 0.006, 0.072 + f * 0.014 + h * 0.012], { k: 0.04, bones: [[B.pelvis, 0.75], [B['thigh' + S], 0.25]], tag: 'glute' }));
    L.push(P.ell([s * 0.088, 1.255, -0.058], [0.072 - f * 0.012, 0.13, 0.056], { k: 0.045, bones: [[B.chest, 1]], tag: 'lat' }));
    L.push(P.ell([s * 0.066, 1.315, 0.03 - f * 0.03], [0.062 - f * 0.02, 0.05, 0.033], { k: 0.035, bones: [[B.chest, 1]], tag: 'pec' }));
    L.push(P.ell([s * (0.074 + f * 0.004), 1.27 + f * 0.004, 0.035 + f * 0.04], [0.058, 0.056, 0.045 + f * 0.008], { k: 0.035, bones: [[B.chest, 1]], tag: 'breast' }));
    L.push(P.ell([s * (0.09 + f * 0.045), 0.87, -0.004], [0.05 + f * 0.012, 0.1, 0.07], { k: 0.05, bones: [[B.pelvis, 0.5], [B['thigh' + S], 0.5]], tag: 'hipside' }));
    if (hp > 0) L.push(P.ell([s * 0.13, 1.03, -0.01], [0.04 + hp * 0.02, 0.06, 0.07], { k: 0.05, bones: [[B.spine, 0.6], [B.pelvis, 0.4]], tag: 'flank' }));
  }
  L.unshift(...sharedNeck(par));
  // arms
  for (const s of [-1, 1]) { const S = s < 0 ? 'L' : 'R', sh = mx(s, LM.SH), el = mx(s, LM.EL), wr = mx(s, LM.WR), arm = B['arm' + S], fore = B['fore' + S], ha = mx(s, HA);
    L.push(P.ell(add(sh, [s * 0.004, -0.03, 0]), [0.047 * ar - f * 0.004, 0.068, 0.05 * ar], { k: 0.035, rot: [0, 0, s * 0.12], bones: [[arm, 0.65], [B['clav' + S], 0.35]], tag: 'delt' }));
    L.push(P.cone(sh, el, 0.044 * ar, 0.035 * ar, { k: 0.02, bones: [[arm, 1]], tag: 'uarm' }));
    L.push(P.ell(add(lerp(sh, el, 0.48), [0, 0, 0.012]), [0.031 * ar, 0.075, 0.034 * ar], { k: 0.02, rot: [0, 0, s * 0.2], bones: [[arm, 1]], tag: 'bicep' }));
    L.push(P.ell(add(lerp(sh, el, 0.42), [s * 0.004, 0, -0.016]), [0.033 * ar, 0.085, 0.032 * ar], { k: 0.02, rot: [0, 0, s * 0.2], bones: [[arm, 1]], tag: 'tricep' }));
    L.push(P.sph(add(el, [0, 0, -0.006]), 0.033 * ar, { k: 0.02, bones: [[arm, 0.5], [fore, 0.5]], tag: 'elbow' }));
    L.push(P.cone(el, add(wr, mul(ha, -0.02)), 0.037 * ar, 0.024 * ar, { k: 0.02, bones: [[fore, 1]], tag: 'farm' }));
    L.push(P.ell(lerp(el, wr, 0.27), [0.035 * ar, 0.075, 0.032 * ar], { k: 0.025, rot: [0.14, 0, s * 0.17], bones: [[fore, 1]], tag: 'fmus' }));
    L.push(P.ell(add(wr, mul(ha, -0.012)), [0.022 * ar, 0.022, 0.03 * ar], { k: 0.012, rot: [0.14, 0, s * 0.17], bones: [[fore, 0.6], [B['hand' + S], 0.4]], tag: 'wrist' }));
  }
  // legs
  for (const s of [-1, 1]) { const S = s < 0 ? 'L' : 'R', hip = mx(s, LM.HIP), kn = mx(s, LM.KNEE), an = mx(s, LM.ANK), th = B['thigh' + S], sh = B['shin' + S];
    L.push(P.cone(add(hip, [s * 0.006, 0.01, -0.004]), kn, 0.087 * lg, 0.05 * (1 + h * 0.08), { k: 0.035, bones: [[th, 1]], tag: 'thigh' }));
    L.push(P.ell(add(lerp(hip, kn, 0.42), [s * 0.008, 0, 0.022]), [0.058 * lg, 0.16, 0.055 * lg], { k: 0.03, bones: [[th, 1]], tag: 'quad' }));
    L.push(P.ell(add(lerp(hip, kn, 0.3), [-s * 0.03, 0, -0.005]), [0.045 * lg, 0.13, 0.05 * lg], { k: 0.03, bones: [[th, 1]], tag: 'adductor' }));
    L.push(P.sph(add(kn, [0, -0.005, 0.01]), 0.047 * (1 + h * 0.06), { k: 0.025, bones: [[th, 0.5], [sh, 0.5]], tag: 'knee' }));
    L.push(P.cone(kn, add(an, [0, 0.02, 0.008]), 0.046 * (1 + h * 0.06), 0.03, { k: 0.02, bones: [[sh, 1]], tag: 'shin' }));
    L.push(P.ell([s * 0.098, 0.355, -0.028], [0.046 * (1 + h * 0.12), 0.11, 0.046 * (1 + h * 0.1)], { k: 0.03, bones: [[sh, 1]], tag: 'calf' }));
    L.push(P.sph(an, 0.032, { k: 0.02, bones: [[sh, 0.6], [B['foot' + S], 0.4]], tag: 'ankle' }));
    L.push(P.box([s * 0.103, 0.032, 0.045], [0.038, 0.03, 0.11], 0.026, { k: 0.02, bones: [[B['foot' + S], 1]], tag: 'foot' }));
  }
  return L;
}
// ---------------------------------------------------------------- hands (local frame: x back of hand, y up the arm, z thumb)
function framed(s, prim, bones) { // right-hand local prim → world prim for side s
  const W = mx(1, LM.WR), X = HF.X, Y = HF.Y, Z = HF.Z;
  const f = (x, y, z) => { const px = s * x - W[0], py = y - W[1], pz = z - W[2]; return prim.f(px * X[0] + py * X[1] + pz * X[2], px * Y[0] + py * Y[1] + pz * Y[2], px * Z[0] + py * Z[1] + pz * Z[2]); };
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let c = 0; c < 8; c++) { const l = [(c & 1) ? prim.hi[0] : prim.lo[0], (c & 2) ? prim.hi[1] : prim.lo[1], (c & 4) ? prim.hi[2] : prim.lo[2]]; const w = add(W, add(mul(X, l[0]), add(mul(Y, l[1]), mul(Z, l[2])))); w[0] *= s; for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], w[i]); hi[i] = Math.max(hi[i], w[i]); } }
  return P.fn(f, lo, hi, { k: prim.k, sub: prim.sub, bones, tag: prim.tag });
}
export function handLocal(x, y, z, s) { const W = LM.WR, p = add(W, add(mul(HF.X, x), add(mul(HF.Y, y), mul(HF.Z, z)))); p[0] *= s; return p; }
export function handPrims(s, par = {}) {
  const S = s < 0 ? 'L' : 'R', hb = B['hand' + S], fb = B['fing' + S], f = par.fem || 0, k = 1 - f * 0.08 + (par.heavy || 0) * 0.06, L = [];
  L.push(framed(s, P.box([0.001, -0.052, 0.002], [0.0122 * k, 0.045, 0.04 * k], 0.0115, { k: 0.01 }), [[hb, 1]]));
  L.push(framed(s, P.ell([-0.006, -0.03, 0.028 * k], [0.014 * k, 0.026, 0.017 * k], { k: 0.008 }), [[hb, 1]]));
  L.push(framed(s, P.cone([0, 0.03, 0], [0, -0.012, 0.001], 0.025 * k, 0.022 * k, { k: 0.012 }), [[hb, 0.4], [B['fore' + S], 0.6]]));
  // fingers: knuckle z, length, curl
  const F = [[0.028, 0.084, 0.3, 0.0095], [0.009, 0.093, 0.36, 0.0098], [-0.01, 0.087, 0.42, 0.0093], [-0.028, 0.069, 0.5, 0.0083]];
  for (const [z0, len, curl, r] of F) { const zz = z0 * k, rr = r * k; const a = [0.001, -0.092, zz], m1 = [a[0] - Math.sin(curl * 0.4) * len * 0.45, a[1] - Math.cos(curl * 0.4) * len * 0.45, zz * 1.08];
    const m2 = [m1[0] - Math.sin(curl * 1.3) * len * 0.3, m1[1] - Math.cos(curl * 1.3) * len * 0.3, zz * 1.12], t = [m2[0] - Math.sin(curl * 2.0) * len * 0.25, m2[1] - Math.cos(curl * 2.0) * len * 0.25, zz * 1.14];
    L.push(framed(s, P.cone(a, m1, rr, rr * 0.92, { k: 0.004 }), [[fb, 1]])); L.push(framed(s, P.cone(m1, m2, rr * 0.92, rr * 0.84, { k: 0.003 }), [[fb, 1]])); L.push(framed(s, P.cone(m2, t, rr * 0.84, rr * 0.78, { k: 0.003 }), [[fb, 1]])); }
  // thumb
  L.push(framed(s, P.cone([-0.006, -0.02, 0.032 * k], [-0.017, -0.052, 0.054 * k], 0.0125 * k, 0.0105 * k, { k: 0.008 }), [[hb, 1]]));
  L.push(framed(s, P.cone([-0.017, -0.052, 0.054 * k], [-0.026, -0.078, 0.058 * k], 0.0102 * k, 0.0088 * k, { k: 0.004 }), [[hb, 1]]));
  return L;
}
// ---------------------------------------------------------------- head (with neck, trapezius and clavicle tops shared with the body)
// par: { fem, wide -1..1, nose -1..1 }
export function headPrims(par = {}) {
  const f = par.fem || 0, w = par.wide || 0, n = par.nose || 0, L = [], hd = [[B.head, 1]], E = LM.EYE;
  L.push(P.ell([0, 1.668, -0.028], [0.0765, 0.094, 0.098], { k: 0.03, bones: hd, tag: 'cran' }));
  L.push(P.ell([0, 1.69, 0.03], [0.067, 0.062, 0.056], { k: 0.03, bones: hd, tag: 'fore' }));
  L.push(P.ell([0, 1.615, 0.028], [0.0585 + w * 0.006 - f * 0.002, 0.075 - w * 0.003, 0.062], { k: 0.03, bones: hd, tag: 'face' }));
  for (const s of [-1, 1]) {
    L.push(P.ell([s * 0.041, 1.607, 0.046], [0.0245 + w * 0.003, 0.03, 0.027 + f * 0.003], { k: 0.022, bones: hd, tag: 'cheek' }));
    L.push(P.ell([s * 0.051, 1.632, 0.054], [0.023 + w * 0.003, 0.0135, 0.02], { k: 0.016, bones: hd, tag: 'zyg' }));
    L.push(P.cap([s * (0.054 + w * 0.004), 1.598 - f * 0.004, -0.014], [s * (0.028 + w * 0.003), 1.553 + f * 0.004, 0.058], 0.0148 - f * 0.0035 + w * 0.002, { k: 0.024, bones: hd, tag: 'jaw' }));
    L.push(P.cap([0, 1.6695, 0.0815], [s * 0.052, 1.675, 0.06], 0.0118 - f * 0.004, { k: 0.02, bones: hd, tag: 'brow' }));
  }
  L.push(P.ell([0, 1.549 + f * 0.003, 0.068], [0.0235 - f * 0.004 + w * 0.003, 0.02, 0.019], { k: 0.022, bones: hd, tag: 'chin' }));
  L.push(P.ell([0, 1.582, 0.061], [0.036, 0.03, 0.036], { k: 0.02, bones: hd, tag: 'muzzle' }));
  // eye sockets, then eyelids around the eyeball
  for (const s of [-1, 1]) L.push(P.sph([s * E[0], E[1] + 0.003, E[2] + 0.003], 0.0168, { k: 0.007, sub: true, tag: 'socket' }));
  for (const s of [-1, 1]) L.push(P.sph([s * E[0], E[1], E[2]], LM.EYER + 0.0014, { k: 0.0045, bones: hd, tag: 'lid' }));
  // nose
  const nl = 1 + n * 0.12 - f * 0.08;
  L.push(P.cone([0, 1.664, 0.08], [0, 1.664 - 0.054 * nl, 0.08 + 0.025 * nl], 0.0078 - f * 0.001, 0.0092 + n * 0.0008, { k: 0.012, bones: hd, tag: 'bridge' }));
  L.push(P.sph([0, 1.664 - 0.058 * nl, 0.078 + 0.025 * nl], 0.0112 + n * 0.0012 - f * 0.001, { k: 0.008, bones: hd, tag: 'tip' }));
  for (const s of [-1, 1]) L.push(P.sph([s * (0.0132 + n * 0.0012), 1.6, 0.0895], 0.0084 + n * 0.0006, { k: 0.008, bones: hd, tag: 'ala' }));
  for (const s of [-1, 1]) L.push(P.ell([s * 0.0082, 1.5948, 0.0962 + n * 0.002], [0.0034, 0.0021, 0.0042], { k: 0.0015, sub: true, tag: 'nostril' }));
  // mouth
  L.push(P.ell([0, 1.5826, 0.0897], [0.0232 - f * 0.001, 0.0062 + f * 0.0008, 0.0082 + f * 0.0008], { k: 0.006, bones: hd, tag: 'ulip' }));
  L.push(P.ell([0, 1.5707, 0.0868], [0.0208, 0.0071 + f * 0.0012, 0.0093 + f * 0.0012], { k: 0.006, bones: hd, tag: 'llip' }));
  L.push(P.ell([0, 1.5768, 0.0975 + f * 0.001], [0.0245, 0.0011, 0.012], { k: 0.0016, sub: true, tag: 'mline' }));
  L.push(P.cap([0, 1.5965, 0.0985], [0, 1.589, 0.0985], 0.0026, { k: 0.003, sub: true, tag: 'philtrum' }));
  // ears
  for (const s of [-1, 1]) { L.push(P.ell([s * 0.0775, 1.636, -0.014], [0.0095, 0.031, 0.0195], { k: 0.006, rot: [0.22, s * 0.12, 0], bones: hd, tag: 'ear' }));
    L.push(P.ell([s * 0.0865, 1.631, -0.01], [0.0052, 0.0165, 0.0115], { k: 0.003, rot: [0.22, s * 0.12, 0], sub: true, tag: 'concha' })); }
  L.push(...sharedNeck(par));
  return L;
}
// simplified cranium for hair volumes (and the beard base uses the full head)
export function craniumPrims() { return [P.ell([0, 1.668, -0.028], [0.0765, 0.094, 0.098], { k: 0.03 }), P.ell([0, 1.69, 0.03], [0.067, 0.062, 0.056], { k: 0.03 })]; }
export const shape = prims => new Shape(prims.slice());
// eye opening (almond) on the lid sphere: >0 outside the opening
export function eyeOpening(x, y, z) { const E = LM.EYE; let r = 1;
  for (const s of [-1, 1]) { const lx = (x - s * E[0]) * s, ly = y - E[1], lz = z - E[2]; if (lz < 0.003 || Math.hypot(lx, ly, lz) > LM.EYER + 0.0034) continue;
    const W = 0.0134, c0 = 0.0006, t = Math.max(-1, Math.min(1, (lx - c0) / W)), q = 1 - t * t;
    const up = 0.0066 * Math.pow(q, 0.8) + 0.0011 * t + 0.0003, lo = -0.0047 * Math.pow(q, 1.05) + 0.001 * t - 0.0004;
    r = Math.min(r, Math.max(Math.abs(lx - c0) - W, ly - up, lo - ly)); }
  return r; }
// region scalars: arm / leg parameter (metres from shoulder / hip along the limb)
export function limbT(p, s, a, b, c, l1, l2) { const A = mx(s, a), Bb = mx(s, b), C = mx(s, c); const u = sub(Bb, A), t1 = dot(sub(p, A), u) / dot(u, u); if (t1 < 1) return t1 * l1; const v = sub(C, Bb); return l1 + Math.max(0, dot(sub(p, Bb), v) / dot(v, v)) * l2; }
export const ARM = p => limbT(p, Math.sign(p[0]) || 1, LM.SH, LM.EL, LM.WR, 0.2904, 0.2501);
export const LEG = p => limbT(p, Math.sign(p[0]) || 1, LM.HIP, LM.KNEE, LM.ANK, 0.425, 0.4215);
export { nrm, sub, add, mul, dot, cross, lerp, mx };
// body / head seam: >0 on the head side (neck region only, so shoulders stay with the body under clothes)
export function headSide(x, y, z) { return Math.max(y - 1.53, Math.min(y - 1.483, (1 - Math.hypot(x / 0.071, (z + 0.016) / 0.064)) * 0.07)); }
