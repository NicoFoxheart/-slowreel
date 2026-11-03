// HD people: one smooth GPU-skinned body per person (shared geometry, bone matrices in a float texture),
// sculpted heads with eyes and blinking lids, shaped hands, layered garments and shoes, hair styles, LOD.
// Same public API as the old instanced people (p[], paint, setCrew, setExposure, commit).
import * as THREE from 'three';
import { buildLayers } from './ppl-build.js';
import { makeMaterials, DATA_W, BONE_W, DYN } from './ppl-shade.js';
import { B, NB, J, QB, LM, HF } from './ppl-body.js';
import { atmos } from './sky.js';

const SKIN_OLD = ['#f3d2b8', '#e7b48f', '#c98c62', '#9a6440', '#6b4126'];
const SKIN = [['#f2cdb3', '#ecc1a2', '#e6b896'], ['#dfab86', '#d49f78', '#cf9a6e'], ['#b97f58', '#c28a62', '#a87050'], ['#8f5d3e', '#7f5236', '#94603e'], ['#5e3b27', '#4e301f', '#6a4129']];
const HAIRC = ['#1b130e', '#3b2416', '#6b4423', '#b88a4a', '#d8c08a', '#8a8a8a', '#d9d9d9', '#7a2a1a'];
const TOPS = ['#c0392b', '#2c4f7c', '#f4f1ea', '#2b2b30', '#e58e26', '#3f7d63', '#7b4a8c', '#86a8c8', '#e8a0a8', '#5a6b3b', '#d6c7a1', '#1f6f8b'];
const BOTTOMS = ['#2b3442', '#1f2024', '#5b4a3a', '#7a8794', '#3c4d6b', '#c9b99a'];
const DENIM = ['#2f4466', '#3b5478', '#26344d', '#4a6283', '#1f2533'], JACKETS = ['#2b3442', '#55595f', '#7a6a55', '#1d1f24', '#3a4a3f', '#6b2f2f'], HOODIES = ['#4b5563', '#1f2933', '#7a2e2e', '#2f5d50', '#c9c4b8', '#2c3e66'];
const SHOES = [['#f1f1ef', 0.92], ['#1d1d1f', 0.9], ['#5a5f68', 0.9], ['#2b3a55', 0.92], ['#7a2a24', 0.9]], DSHOES = [['#151515', 0.05], ['#3d2a1d', 0.08], ['#5a3a22', 0.1]];
const STYLE_MAP = { short: ['short', 'side', 'short'], curly: ['curly', 'curly', 'short'], long: ['long', 'bob', 'long'], bun: ['bun'], pony: ['pony'] };
const lin = (hex, out) => { const c = new THREE.Color(hex); out[0] = c.r; out[1] = c.g; out[2] = c.b; return out; };
const hash = (a, b) => { let x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
let QUALITY = null;
function quality() { if (QUALITY) return QUALITY; try { const o = JSON.parse(localStorage.getItem('foxheart.settings') || '{}'); return o.quality || 'high'; } catch (e) { return 'high'; } }
const LOD_R = { low: [1.5, 5], medium: [2.2, 7], high: [2.8, 8.5], ultra: [3.4, 10] };

// ---------------------------------------------------------------- 3x4 affine helpers (row-major)
const M12 = () => new Float64Array(12);
function mSet(o, r00, r01, r02, tx, r10, r11, r12, ty, r20, r21, r22, tz) { o[0] = r00; o[1] = r01; o[2] = r02; o[3] = tx; o[4] = r10; o[5] = r11; o[6] = r12; o[7] = ty; o[8] = r20; o[9] = r21; o[10] = r22; o[11] = tz; return o; }
function mMul(o, a, b) { const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7], a8 = a[8], a9 = a[9], a10 = a[10], a11 = a[11];
  const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7], b8 = b[8], b9 = b[9], b10 = b[10], b11 = b[11];
  o[0] = a0 * b0 + a1 * b4 + a2 * b8; o[1] = a0 * b1 + a1 * b5 + a2 * b9; o[2] = a0 * b2 + a1 * b6 + a2 * b10; o[3] = a0 * b3 + a1 * b7 + a2 * b11 + a3;
  o[4] = a4 * b0 + a5 * b4 + a6 * b8; o[5] = a4 * b1 + a5 * b5 + a6 * b9; o[6] = a4 * b2 + a5 * b6 + a6 * b10; o[7] = a4 * b3 + a5 * b7 + a6 * b11 + a7;
  o[8] = a8 * b0 + a9 * b4 + a10 * b8; o[9] = a8 * b1 + a9 * b5 + a10 * b9; o[10] = a8 * b2 + a9 * b6 + a10 * b10; o[11] = a8 * b3 + a9 * b7 + a10 * b11 + a11; return o; }
function mEuler(o, x, y, z, tx = 0, ty = 0, tz = 0) { const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z); const ce = c * e, cf = c * f, de = d * e, df = d * f;
  return mSet(o, ce + df * b, de * b - cf, a * d, tx, a * f, a * e, -b, ty, cf * b - de, df + ce * b, a * c, tz); }
function mQuat(o, q, tx = 0, ty = 0, tz = 0) { const [x, y, z, w] = q; const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return mSet(o, 1 - (yy + zz), xy - wz, xz + wy, tx, xy + wz, 1 - (xx + zz), yz - wx, ty, xz - wy, yz + wx, 1 - (xx + yy), tz); }
function mAxis(o, ax, ang) { const [x, y, z] = ax, c = Math.cos(ang), s = Math.sin(ang), t = 1 - c; return mSet(o, t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0, t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0, t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0); }
function mMirror(o) { o[1] = -o[1]; o[2] = -o[2]; o[4] = -o[4]; o[8] = -o[8]; o[3] = -o[3]; return o; } // conjugate by diag(-1,1,1)
function mScale(o, k) { for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) o[i] *= k; return o; }
const qInv = q => [-q[0], -q[1], -q[2], q[3]], qRot = (q, v) => { const m = mQuat(M12(), q); return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[4] * v[0] + m[5] * v[1] + m[6] * v[2], m[8] * v[0] + m[9] * v[1] + m[10] * v[2]]; };
// precomputed per bone: local offset in the parent's pose-zero frame, inverse bind (QB^-1 · T(-J))
const PAR = [-1, 0, 1, 2, 3, 2, 5, 6, 7, 8, 2, 10, 11, 12, 13, 0, 15, 16, 0, 18, 19, -1, -1, -1];
const OFF = [], IB = [];
for (let b = 0; b < NB; b++) { const p = PAR[b]; const jb = [J[b * 3], J[b * 3 + 1], J[b * 3 + 2]]; OFF.push(p < 0 ? jb : qRot(qInv(QB[p]), [jb[0] - J[p * 3], jb[1] - J[p * 3 + 1], jb[2] - J[p * 3 + 2]]));
  const qi = mQuat(M12(), qInv(QB[b])), t = mSet(M12(), 1, 0, 0, -jb[0], 0, 1, 0, -jb[1], 0, 0, 1, -jb[2]); IB.push(mMul(M12(), qi, t)); }
const CURL_AX = (() => { const a = qRot(qInv(QB[B.handR]), HF.Z); const l = Math.hypot(...a); return a.map(v => v / l); })();

// ---------------------------------------------------------------- the people set
export class PeopleHD {
  constructor(parent, n, rnd, opts = {}) {
    this.n = n; this.rnd = rnd; this.parent = parent; this.q = opts.quality || quality();
    this.p = [];
    for (let i = 0; i < n; i++) { // identical random draw sequence to the original implementation (layouts stay the same)
      const r = rnd; const ageR = r(); const age = ageR < 0.1 ? 'kid' : ageR < 0.18 ? 'teen' : ageR < 0.86 ? 'adult' : 'elder';
      const female = r() < 0.5; const skin = (r() * 5) | 0; const face = skin + 5 * ((r() * 3) | 0);
      const scale = age === 'kid' ? 0.55 + r() * 0.15 : age === 'teen' ? 0.88 + r() * 0.06 : (female ? 0.93 : 0.99) + r() * 0.07;
      const dress = female && age !== 'kid' && r() < 0.28, longSleeve = r() < 0.55, shorts = !dress && r() < 0.15;
      const hairStyle = age === 'elder' && !female && r() < 0.4 ? 'none' : female ? ['long', 'bun', 'pony', 'long', 'curly'][(r() * 5) | 0] : ['short', 'short', 'curly', 'short', 'none'][(r() * 5) | 0];
      const hairC = age === 'elder' ? HAIRC[5 + ((r() * 2) | 0)] : HAIRC[(r() * 5) | 0];
      const top = TOPS[(r() * TOPS.length) | 0], bottom = dress ? top : BOTTOMS[(r() * BOTTOMS.length) | 0];
      const p = { i, age, female, skin, face, scale, dress, longSleeve, shorts, hairStyle, hairC, top, bottom, x: 0, y: -100, z: 0, yaw: 0, mode: 'stand', act: 'idle', phase: r() * 6, speed: 1.1, backpack: r() < 0.3, suitcase: false, prop: null, stoop: age === 'elder' ? 0.12 : 0, seed: r() * 100, hidden: false, crew: false };
      this.p.push(p);
    }
    // GPU data
    this.boneArr = new Float32Array(BONE_W * 4 * n); this.boneTex = new THREE.DataTexture(this.boneArr, BONE_W, n, THREE.RGBAFormat, THREE.FloatType); this.boneTex.needsUpdate = true;
    this.dataArr = new Float32Array(DATA_W * 4 * n); this.dataTex = new THREE.DataTexture(this.dataArr, DATA_W, n, THREE.RGBAFormat, THREE.FloatType); this.dataTex.needsUpdate = true;
    this.U = { uBones: { value: this.boneTex }, uData: { value: this.dataTex }, uK: { value: 1 }, uSky: { value: new THREE.Color(0.56, 0.58, 0.62) }, uGnd: { value: new THREE.Color(0.34, 0.31, 0.28) }, uKey: { value: new THREE.Color(0.78, 0.75, 0.7) }, uObj: { value: new THREE.Matrix3() }, uPart: { value: 0 } };
    this.M = makeMaterials(this.U);
    this.L = buildLayers(this.q === 'low' ? 'low' : 'high');
    this.group = new THREE.Group(); this.group.name = 'people';
    this.layers = {}; this.lists = {};
    for (const [name, Ly] of Object.entries(this.L)) { if (name[0] === '_') continue;
      const g = new THREE.InstancedBufferGeometry(); g.index = Ly.geo.index; for (const [k, a] of Object.entries(Ly.geo.attributes)) g.setAttribute(k, a);
      const pid = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); pid.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aPid', pid); g.instanceCount = 0; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      const mat = Ly.kind === 'skin' ? [this.M.body, this.M.head, this.M.hands, this.M.fig][Ly.part] : this.M[Ly.kind];
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.visible = false; m.name = 'ppl-' + name; this.group.add(m); this.layers[name] = { mesh: m, pid, tris: Ly.tris, list: [], last: '' }; }
    this._shadow();
    for (const p of this.p) this.paint(p);
    this.W = Array.from({ length: NB }, M12); this.T1 = M12(); this.T2 = M12(); this.R = M12(); this.S = M12();
    this.frame = 0; this.camPos = new THREE.Vector3(); this.hasCam = false; this.V = new THREE.Vector3();
    parent.add(this.group);
    this.meshes = Object.fromEntries(Object.entries(this.layers).map(([k, v]) => [k, v.mesh]));
    this.mat = this.M.body; this.faceMat = this.M.head;
  }
  _shadow() { // soft contact shadow under standing / walking people
    const g = new THREE.InstancedBufferGeometry(); const base = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    const pid = new THREE.InstancedBufferAttribute(new Float32Array(this.n), 1); pid.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aPid', pid); g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ uniforms: { uBones: this.U.uBones, uK: this.U.uK }, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\n#include <fog_pars_vertex>\nuniform highp sampler2D uBones; attribute float aPid; varying vec2 vUv;
        void main(){ int r = int(aPid + 0.5); ivec2 c = ivec2(${B.root * 3}, r); vec4 a = texelFetch(uBones, c, 0), q = texelFetch(uBones, c + ivec2(1, 0), 0), d = texelFetch(uBones, c + ivec2(2, 0), 0);
        mat4 S = mat4(a.x, q.x, d.x, 0., a.y, q.y, d.y, 0., a.z, q.z, d.z, 0., a.w, q.w, d.w, 1.); vUv = uv; vec4 mvPosition = viewMatrix * modelMatrix * (S * vec4(position * vec3(0.62, 1., 0.5) + vec3(0., 0.004, 0.), 1.)); gl_Position = projectionMatrix * mvPosition;\n#include <logdepthbuf_vertex>\n#include <fog_vertex>\n}`,
      fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\n#include <fog_pars_fragment>\nvarying vec2 vUv; void main(){\n#include <logdepthbuf_fragment>\n float d = length((vUv - 0.5) * 2.0); float a = (1.0 - smoothstep(0.15, 1.0, d)) * 0.42; gl_FragColor = vec4(0.0, 0.0, 0.0, a);\n#include <fog_fragment>\n}` });
    mat.userData.key = 'ppl-shadow'; mat.userData.additive = true; atmos(mat); mat.onBeforeCompile = ((prev) => (sh, r) => { prev(sh, r); sh.fragmentShader = sh.fragmentShader.replace('gl_FragColor.rgb *= atmTrans(vAtmRel);', ''); })(mat.onBeforeCompile);
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.visible = false; m.renderOrder = 1; this.group.add(m); this.layers._shadow = { mesh: m, pid, tris: 2, list: [], last: '' };
  }
  // ---------------------------------------------------------------- appearance → per-person data row
  _traits(p) { // derived, deterministic from seed
    const h = k => hash(p.seed + p.i * 0.37, k); const kid = p.age === 'kid', elder = p.age === 'elder', baby = kid && p.scale < 0.45;
    const T = p._t = { kid, elder, baby };
    T.skinHex = SKIN[p.skin][(h(1) * 3) | 0];
    T.fem = p.female && !kid ? 1 : p.female ? 0.4 : 0; T.heavy = kid ? 0 : Math.max(-0.55, Math.min(1, (h(2) - 0.42) * 1.6 + (elder ? 0.25 : 0) + (p.crew ? -0.25 : 0)));
    T.wide = (h(3) - 0.5) * 1.6; T.nose = (h(4) - 0.5) * 1.6 + (p.skin > 2 ? 0.25 : 0);
    T.cell = p.female ? 4 + (elder ? 2 : h(5) < 0.3 ? 5 - 4 : h(5) < 0.55 ? 3 : h(5) < 0.75 ? 0 : 1) : (elder ? 2 : h(5) < 0.4 ? 0 : h(5) < 0.7 ? 3 : 1);
    if (p.female) T.cell = elder ? 6 : [4, 5, 7, 4][(h(5) * 4) | 0]; else T.cell = elder ? 2 : [0, 1, 3, 0][(h(5) * 4) | 0];
    T.eye = p.skin >= 2 ? (h(6) < 0.85 ? 0 : 1) : [0, 1, 2, 3, 3, 4, 5][(h(6) * 7) | 0];
    const hs = p.hairStyle; let style = hs === 'none' ? (elder ? 'bald' : 'none') : (STYLE_MAP[hs] || ['short'])[(h(7) * (STYLE_MAP[hs] || ['short']).length) | 0];
    if (baby) style = 'none'; T.hair = style; T.scalp = style === 'none' ? (baby ? 0.5 : 1) : style === 'bald' ? 0.55 : 0.85;
    T.beard = !p.female && !kid && p.age !== 'teen' ? (h(8) < 0.14 ? 'beard' : h(8) < 0.24 ? 'moustache' : null) : null; T.stubble = T.beard === 'beard' ? 1 : !p.female && !kid && p.age !== 'teen' ? (h(9) < 0.4 ? 0.25 : 0.05) : 0;
    if (p.crew) { T.beard = null; T.stubble = p.female ? 0 : 0.06; }
    // outfit
    if (p.crew) { const role = p.role || 'cabin';
      if (role === 'ground') { Object.assign(T, { top: 'long', vest: true, topHex: '#2a2f38', topFab: 3, bot: 'trousers', botHex: '#23272e', botFab: 0, shoe: 'sneaker', shoeHex: '#1e1e1e', sole: 0.12, acc: null }); }
      else { const navy = role === 'agent' ? '#26324f' : '#1b2747'; Object.assign(T, { top: 'jacket', topHex: navy, topFab: 1, bot: p.female && role !== 'captain' && role !== 'fo' ? 'skirt' : 'trousers', botHex: navy, botFab: 0, shoe: 'dress', shoeHex: '#121212', sole: 0.04, shirt: '#f2f2ee', acc: p.female && role !== 'captain' && role !== 'fo' ? 'scarf' : 'tie', accHex: p.female ? '#f29a4c' : role === 'agent' ? '#c0392b' : '#1b2747', stripes: role === 'captain' ? 4 : role === 'fo' ? 3 : 0, hat: role === 'captain' }); if (T.acc === 'tie' && role !== 'captain' && role !== 'fo') T.accHex = '#f29a4c'; }
      if (p.female && (T.hair === 'long' || T.hair === 'curly')) T.hair = 'bun'; if (!p.female && !['short', 'side', 'bald'].includes(T.hair)) T.hair = 'short';
    } else {
      const lt = p.longSleeve ? h(10) : 1; T.top = p.dress ? 'tee' : !p.longSleeve ? 'tee' : lt < 0.32 ? 'hoodie' : lt < 0.5 && !kid ? 'jacket' : 'long'; T.vest = false;
      T.topHex = T.top === 'jacket' ? JACKETS[(h(11) * JACKETS.length) | 0] : T.top === 'hoodie' ? HOODIES[(h(11) * HOODIES.length) | 0] : p.top; T.topFab = T.top === 'jacket' ? 1 : T.top === 'hoodie' ? 2 : 0;
      T.shirt = ['#f2f2ee', '#c9d6e6', '#2b2b30', '#e8e1d2'][(h(12) * 4) | 0];
      T.bot = p.dress ? 'skirt' : p.shorts ? 'shorts' : p.female && h(13) < 0.18 ? 'skirt' : h(13) < 0.55 ? 'jeans' : 'trousers'; T.botHex = T.bot === 'jeans' ? DENIM[(h(14) * DENIM.length) | 0] : p.bottom; T.botFab = T.bot === 'jeans' ? 1 : 0;
      if (baby) { T.top = 'long'; T.bot = 'trousers'; T.botHex = T.topHex; }
      const dressShoe = !kid && (T.top === 'jacket' || h(15) < 0.2); const sh = dressShoe ? DSHOES[(h(16) * DSHOES.length) | 0] : SHOES[(h(16) * SHOES.length) | 0]; T.shoe = dressShoe ? 'dress' : 'sneaker'; T.shoeHex = sh[0]; T.sole = dressShoe ? sh[1] : T.shoeHex === '#f1f1ef' ? 0.95 : h(17) < 0.6 ? 0.92 : 0.1;
      T.acc = null; T.accHex = ['#2b3442', '#c0392b', '#3f7d63', '#d6c7a1', '#5a3a22'][p.i % 5]; T.stripes = 0; T.hat = false;
    }
    T.sleeve = { tee: 0.175, long: 0.5, jacket: 0.505, hoodie: 0.495 }[T.top]; T.hem = { tee: 0.885, long: 0.88, jacket: 0.775, hoodie: 0.86 }[T.top]; T.leg = { trousers: 0.822, jeans: 0.82, shorts: 0.31, skirt: -1 }[T.bot];
    T.headK = 1 + 0.5 * (1 - Math.min(1, p.scale / (p.female ? 0.95 : 1.02))) + Math.pow(1 - Math.min(1, p.scale / (p.female ? 0.95 : 1.02)), 2);
    if (!kid) T.headK = 1 + (p.female ? -0.02 : 0); T.shoulderK = p.female ? 0.9 : kid ? 0.96 : 1; T.hipK = p.female ? 1.05 : 1;
    return T; }
  paint(p) {
    const T = this._traits(p), o = p.i * DATA_W * 4, D = this.dataArr, c = [0, 0, 0];
    const put = (k, hex, w) => { lin(hex, c); D[o + k * 4] = c[0]; D[o + k * 4 + 1] = c[1]; D[o + k * 4 + 2] = c[2]; D[o + k * 4 + 3] = w; };
    put(0, T.skinHex, T.cell); put(1, p.hairC, T.stubble); put(2, T.topHex, T.topFab); put(3, T.botHex, T.botFab); put(4, T.shoeHex, T.sole);
    D.set([T.fem, T.heavy, T.wide, T.nose], o + 20); D.set([T.sleeve, T.hem, T.leg, T.top === 'jacket' ? 1 : 0], o + 24);
    put(7, T.accHex, T.eye); put(8, T.shirt || '#f2f2ee', T.stripes || 0); D.set([T.kid ? 0 : T.elder ? 1 : 0.4, p.female && !T.kid ? 0.4 + hash(p.seed, 20) * 0.6 : 0, T.scalp, 0], o + 36);
    if (T.vest) { /* ground crew vest drawn over the long top */ }
    this.dataTex.needsUpdate = true; p._lod = -1; p._sig = null;
  }
  setCrew(i, role) { const p = this.p[i]; Object.assign(p, { crew: true, role: role || p.role || 'cabin', top: '#1b2747', bottom: '#1b2747', dress: p.female, longSleeve: true, shorts: false, backpack: false, age: 'adult', scale: Math.max(0.95, p.scale), stoop: 0 }); if (p.hairStyle === 'none') p.hairStyle = 'short'; this.paint(p); }
  setExposure(k) { this.U.uK.value = k; }
  static setQuality(q) { QUALITY = q; }
  stats() { let tris = 0, calls = 0; for (const L of Object.values(this.layers)) if (L.mesh.visible && L.mesh.geometry.instanceCount) { calls++; tris += L.tris * L.mesh.geometry.instanceCount; } return { tris: Math.round(tris), calls }; }
  // ---------------------------------------------------------------- per frame
  commit(t, camPos) {
    this.frame++; if (camPos) { this.camPos.copy(camPos); this.hasCam = true; }
    this.parent.updateMatrixWorld(); const e = this.parent.matrixWorld.elements; this.U.uObj.value.set(e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]);
    const R = LOD_R[this.q] || LOD_R.high, r0 = R[0] * R[0], r1 = R[1] * R[1];
    for (const k in this.layers) this.layers[k].list.length = 0;
    const add = (name, i) => { const L = this.layers[name]; if (L) L.list.push(i); };
    for (const p of this.p) {
      if (p.hidden || p.y < -50) continue;
      const d2 = this.hasCam ? this.camPos.distanceToSquared(this.V.set(p.x, p.y + 1, p.z)) : 25; const lod = d2 < r0 ? 0 : d2 < r1 ? 1 : 2;
      const far = d2 > 900; if (!(far && (this.frame + p.i) % 3 && p._init)) { this.pose(p, t); p._init = true; }
      const T = p._t, i = p.i;
      if (lod === 2) { add('fig2', i); if (T.hair !== 'none') add('hair_' + T.hair + '1', i); if (T.bot === 'skirt') add('skirt1', i); if (T.hat) add('hat', i); }
      else { const s = String(lod); add('body' + s, i); add('head' + s, i); add('hands' + s, i); add('eyes' + s, i); add(T.top + s, i); if (T.vest) add('vest' + s, i); if (T.top === 'hoodie') add('hood' + s, i);
        add(T.bot + s, i); add(T.shoe + s, i); if (T.hair !== 'none') add('hair_' + T.hair + s, i); if (T.beard === 'beard') add('beard' + s, i); else if (T.beard === 'moustache' && lod === 0) add('moustache0', i);
        if (T.acc) add(T.acc, i); if (T.hat) add('hat', i);
        if (p.prop === 'phone') add('phone', i); else if (p.prop === 'book') add('book', i); }
      if (p.backpack && p.mode !== 'sit') add('backpack', i); if (p.suitcase && p.mode !== 'sit') add('suitcase', i);
      if (p.mode !== 'sit' && !p.baby) add('_shadow', i);
    }
    for (const L of Object.values(this.layers)) { const n = L.list.length, g = L.mesh.geometry; g.instanceCount = n; L.mesh.visible = n > 0; if (!n) continue; const sig = L.list.join(','); if (sig !== L.last) { L.pid.array.set(L.list); L.pid.needsUpdate = true; L.last = sig; } }
    this.boneTex.needsUpdate = true;
  }
  // ---------------------------------------------------------------- pose → bone matrices (+ blink / gaze)
  pose(p, t) {
    const T = p._t || this._traits(p);
    const A = { hipY: 0.92, hipZ: 0, hipPitch: 0, hipYaw: 0, hipRoll: 0, lean: 0, torsoYaw: 0, torsoRoll: 0, headPitch: 0, headYaw: 0, headRoll: 0, mode: p.mode, rootX: 0,
      arm: { L: { sp: 0.04, sr: 0.1, el: -0.22, wx: 0, wy: 0, wz: 0, curl: 0.35, clav: 0 }, R: { sp: 0.04, sr: 0.1, el: -0.22, wx: 0, wy: 0, wz: 0, curl: 0.35, clav: 0 } }, leg: { L: { hp: 0, kn: 0, ab: 0.02, ft: null }, R: { hp: 0, kn: 0, ab: 0.02, ft: null } }, eyes: 0 };
    const s = p.seed, slow = Math.sin(t * 0.37 + s), slow2 = Math.sin(t * 0.21 + s * 1.7), breath = Math.sin(t * (1.45 + (s % 1) * 0.3) + s);
    A.lean += breath * 0.008; A.arm.L.clav = A.arm.R.clav = breath * 0.012;
    let gazeY = 0, gazeP = 0;
    if (p.mode === 'walk') {
      const ph = (t * p.speed * 5.2 + s) % (Math.PI * 2); const amp = Math.min(1.2, p.speed / 1.1);
      for (const [S, o] of [['L', 0], ['R', Math.PI]]) { const q = ph + o, l = A.leg[S]; l.hp = -0.4 * amp * Math.sin(q); const u = ((q - Math.PI * 1.5) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        l.kn = u < Math.PI ? 1.05 * amp * Math.pow(Math.sin(u), 1.3) : 0.14 * amp * Math.sin(u - Math.PI); const g = (c) => Math.exp(-Math.pow(Math.atan2(Math.sin(q - c), Math.cos(q - c)) / 0.45, 2));
        l.ft = -0.28 * amp * g(Math.PI * 0.5) + 0.55 * amp * g(Math.PI * 1.42); }
      A.hipY = 0.912 + 0.013 * Math.cos(2 * ph) * amp; A.hipRoll = 0.045 * Math.sin(ph) * amp; A.hipYaw = 0.09 * Math.sin(ph) * amp; A.torsoYaw = -0.11 * Math.sin(ph) * amp; A.rootX = 0.012 * Math.sin(ph) * amp;
      A.lean = 0.05 + 0.01 * Math.cos(2 * ph); A.headPitch = -0.02 * Math.cos(2 * ph);
      A.arm.L.sp = 0.3 * Math.sin(ph) * amp; A.arm.R.sp = -0.3 * Math.sin(ph) * amp; A.arm.L.el = -0.2 - 0.3 * Math.max(0, -A.arm.L.sp) * 1.6; A.arm.R.el = -0.2 - 0.3 * Math.max(0, -A.arm.R.sp) * 1.6; A.arm.L.sr = A.arm.R.sr = 0.12;
      if (p.suitcase) { A.arm.R.sp = 0.42; A.arm.R.el = -0.08; A.arm.R.sr = 0.22; A.arm.R.curl = 1.1; A.arm.R.wy = -0.3; }
      if (p.act === 'carry') { A.arm.R.sp = 0.2; A.arm.R.el = -1.3; A.arm.R.curl = 0.8; }
      A.headYaw = slow * 0.25; gazeY = slow * 0.12;
    } else if (p.mode === 'sit') {
      A.hipY = 0.535 + (p.baby ? 0.38 : 0); A.hipZ = 0.025; const sp = (s * 7.3) % 1; const kn = 1.38 + sp * 0.25;
      A.hipPitch = -0.3; A.leg.L.hp = A.leg.R.hp = -1.12; A.leg.L.kn = kn; A.leg.R.kn = kn + (sp - 0.5) * 0.3; A.leg.L.ab = 0.06 + sp * 0.06; A.leg.R.ab = 0.06 + ((s * 3.1) % 1) * 0.06;
      if (p.baby) { A.leg.L.kn = A.leg.R.kn = 0.5; A.hipY = 0.54 + 0.36; }
      A.lean = 0.2; A.arm.L.sp = A.arm.R.sp = -0.42; A.arm.L.el = A.arm.R.el = -0.95; A.arm.L.sr = A.arm.R.sr = 0.05; A.arm.L.wx = A.arm.R.wx = 0.25; A.arm.L.curl = A.arm.R.curl = 0.55;
      const act = p.act;
      if (act === 'read') { A.arm.L.sp = A.arm.R.sp = -0.55; A.arm.L.el = A.arm.R.el = -1.5; A.arm.L.sr = A.arm.R.sr = -0.12; A.arm.L.wy = 0.6; A.arm.R.wy = 0.6; A.arm.L.curl = A.arm.R.curl = 0.6; A.headPitch = 0.5; gazeP = 0.3; p.prop = 'book'; }
      else if (act === 'phone') { A.arm.R.sp = -0.42; A.arm.R.el = -1.75; A.arm.R.sr = -0.22; A.arm.R.wy = -1.3; A.arm.R.wx = 0.25; A.arm.R.curl = 0.75; A.arm.L.sp = -0.3; A.arm.L.el = -1.2; A.headPitch = 0.48 + slow * 0.04; gazeP = 0.32; p.prop = 'phone'; }
      else if (act === 'sleep') { A.headRoll = 0.4 * (p.i % 2 ? 1 : -1); A.headPitch = 0.28; A.lean = 0.1; A.eyes = 1; p.prop = null; }
      else if (act === 'window') { A.headYaw = p.windowSide * (0.9 + slow * 0.2); A.headPitch = 0.05; gazeY = p.windowSide * 0.2; p.prop = null; }
      else if (act === 'talk') { A.headYaw = p.talkSide * (0.7 + slow2 * 0.15); A.headPitch = Math.sin(t * 3 + s) * 0.06; gazeY = p.talkSide * 0.25; A.arm.R.sp = -0.6 + Math.sin(t * 2.3 + s) * 0.15; A.arm.R.el = -1.2; A.arm.R.wy = 0.5 + Math.sin(t * 1.7 + s) * 0.4; A.arm.R.curl = 0.25; p.prop = null; }
      else if (act === 'buckle') { A.arm.L.sp = A.arm.R.sp = -0.32; A.arm.L.el = A.arm.R.el = -1.15; A.arm.L.sr = A.arm.R.sr = -0.32; A.arm.L.curl = A.arm.R.curl = 0.8; A.headPitch = 0.55; gazeP = 0.35; p.prop = null; }
      else if (act === 'baby') { p.prop = null; A.arm.L.sp = A.arm.R.sp = -0.75; A.arm.L.el = A.arm.R.el = -1.55; A.arm.L.sr = A.arm.R.sr = -0.5; A.arm.L.curl = A.arm.R.curl = 0.4; A.headPitch = 0.35; A.headYaw = slow * 0.2; gazeP = 0.3; }
      else if (act === 'listen') { A.headPitch = -0.16; A.headYaw = slow * 0.08; A.headRoll = 0.06 * (p.i % 2 ? 1 : -1); gazeP = -0.1; p.prop = null; }
      else if (act === 'grip') { A.arm.L.sp = A.arm.R.sp = -0.32; A.arm.L.sr = A.arm.R.sr = 0.3; A.arm.L.el = A.arm.R.el = -0.5; A.arm.L.curl = A.arm.R.curl = 1.2; A.lean = 0.25; A.headPitch = 0.12; A.headYaw = Math.sin(t * 1.9 + s) * 0.3; gazeY = Math.sin(t * 2.7 + s) * 0.3; p.prop = null; }
      else if (act === 'clap') { const c = Math.sin(t * 15 + s * 3); A.arm.L.sp = A.arm.R.sp = -0.95; A.arm.L.el = A.arm.R.el = -1.3; A.arm.L.sr = A.arm.R.sr = -0.36 + c * 0.13; A.arm.L.wy = A.arm.R.wy = -0.9; A.arm.L.curl = A.arm.R.curl = 0.1; A.headPitch = -0.05; A.headYaw = slow * 0.2; p.prop = null; }
      else { A.headYaw = slow * 0.35; A.headPitch = slow2 * 0.08; gazeY = slow * 0.2; p.prop = null; }
    } else {
      A.headYaw = slow * 0.4; A.headPitch = slow2 * 0.06; gazeY = slow * 0.22; const ws = Math.sin(t * 0.23 + s * 2.1); A.hipRoll = ws * 0.035; A.rootX = ws * 0.02; A.leg.L.kn = Math.max(0, ws) * 0.12; A.leg.R.kn = Math.max(0, -ws) * 0.12; A.leg.L.hp = -A.leg.L.kn * 0.5; A.leg.R.hp = -A.leg.R.kn * 0.5; A.torsoRoll = -ws * 0.02;
      A.arm.L.sp = Math.sin(t * 0.5 + s) * 0.04; A.arm.L.el = A.arm.R.el = -0.25;
      if (p.suitcase) { A.arm.R.sp = -0.05; A.arm.R.sr = 0.28; A.arm.R.el = -0.15; A.arm.R.curl = 1.1; }
      if (p.act === 'board') { A.headPitch = -0.35; A.headYaw = slow * 0.15; }
      else if (p.act === 'phone') { A.arm.R.sp = -0.55; A.arm.R.el = -1.7; A.arm.R.sr = -0.2; A.arm.R.wy = -1.3; A.arm.R.wx = 0.25; A.arm.R.curl = 0.75; A.headPitch = 0.5; gazeP = 0.3; }
      else if (p.act === 'lift') { const k = Math.min(1, (p.actT || 0) / 1.2); A.arm.L.sp = A.arm.R.sp = -2.85 * k; A.arm.L.el = A.arm.R.el = -0.35; A.arm.L.clav = A.arm.R.clav = 0.25 * k; A.arm.L.curl = A.arm.R.curl = 0.9; A.headPitch = -0.4 * k; gazeP = -0.2 * k; A.lean = -0.05 * k; }
      else if (p.act === 'demo') { const ph = Math.floor(t / 2.5) % 4; if (ph === 0) { A.arm.L.sp = A.arm.R.sp = -1.4; A.arm.L.sr = A.arm.R.sr = 1.1; A.arm.L.curl = A.arm.R.curl = 0.1; } else if (ph === 1) { A.arm.L.sp = A.arm.R.sp = -0.9; A.arm.L.el = A.arm.R.el = -1.2; A.arm.L.sr = A.arm.R.sr = -0.4; } else if (ph === 2) { A.arm.R.sp = -1.6; A.arm.R.sr = 0.2; A.arm.R.curl = 0.1; A.arm.L.sp = 0.1; } else { A.arm.L.sp = -1.6; A.arm.L.sr = 0.2; A.arm.L.curl = 0.1; A.arm.R.sp = 0.1; } }
      else if (p.act === 'board-look') { A.headPitch = -0.4; gazeP = -0.15; }
      p.prop = p.act === 'phone' ? 'phone' : null;
    }
    if (A.headPitch < 0) A.headPitch = Math.max(A.headPitch, -0.5);
    // blink & saccades
    if (p._bt == null || t < (p._bt0 || 0) - 1) { p._bt = t + 1 + (s % 1) * 4; p._bt0 = t; }
    let blink = 0; if (t > p._bt) { const u = (t - p._bt) / 0.16; blink = u < 1 ? Math.sin(u * Math.PI) : 0; if (u >= 1) { p._bt = t + 2 + hash(s, Math.floor(t)) * 4.5; } }
    if (A.eyes) blink = 1; if (p.act === 'buckle' || p.act === 'read' || p.act === 'phone') blink = Math.max(blink, 0.28);
    const sac = Math.floor(t * 0.7 + s); const sy = (hash(s, sac) - 0.5) * 0.22, sp2 = (hash(s + 3, sac) - 0.5) * 0.1;
    this._fk(p, A, T, blink, Math.max(-0.45, Math.min(0.45, gazeY + sy - A.headYaw * 0.15)), Math.max(-0.3, Math.min(0.4, gazeP + sp2)));
    return A;
  }
  _fk(p, A, T, blink, gy, gp) {
    const W = this.W, t1 = this.T1, t2 = this.T2, R = this.R, sc = p.scale;
    const row = p.i * BONE_W * 4, out = this.boneArr;
    const put = (b, m) => { mMul(t2, m, IB[b]); const o = row + b * 12; out[o] = t2[0]; out[o + 1] = t2[1]; out[o + 2] = t2[2]; out[o + 3] = t2[3]; out[o + 4] = t2[4]; out[o + 5] = t2[5]; out[o + 6] = t2[6]; out[o + 7] = t2[7]; out[o + 8] = t2[8]; out[o + 9] = t2[9]; out[o + 10] = t2[10]; out[o + 11] = t2[11]; };
    const child = (b, parentM, rx, ry, rz, offK = 1, mirror = false, scale = 1) => { const o = OFF[b]; mEuler(R, rx, ry, rz, o[0] * offK, o[1] * offK, o[2] * offK); if (mirror) { mMirror(R); R[3] = o[0] * offK; } if (scale !== 1) mScale(R, scale); mMul(W[b], parentM, R); };
    // root (position, yaw, scale)
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw); const rootM = W[B.root]; mSet(rootM, cy * sc, 0, sy * sc, p.x + A.rootX * cy * sc, 0, sc, 0, p.y, -sy * sc, 0, cy * sc, p.z - A.rootX * sy * sc);
    out.set([rootM[0], rootM[1], rootM[2], rootM[3], rootM[4], rootM[5], rootM[6], rootM[7], rootM[8], rootM[9], rootM[10], rootM[11]], row + B.root * 12);
    // pelvis: root · T(0, hipY, hipZ) · R(hip)
    mEuler(R, A.hipPitch + p.stoop * 0.3, A.hipYaw, A.hipRoll, 0, A.hipY, A.hipZ); mMul(W[B.pelvis], rootM, R); put(B.pelvis, W[B.pelvis]);
    const lean = A.lean + p.stoop; child(B.spine, W[B.pelvis], lean * 0.45, A.torsoYaw * 0.5, A.torsoRoll * 0.5); put(B.spine, W[B.spine]);
    child(B.chest, W[B.spine], lean * 0.55, A.torsoYaw * 0.5, A.torsoRoll * 0.5); put(B.chest, W[B.chest]);
    child(B.neck, W[B.chest], (A.headPitch + p.stoop * 0.6) * 0.35, A.headYaw * 0.35, A.headRoll * 0.35); put(B.neck, W[B.neck]);
    child(B.head, W[B.neck], (A.headPitch + p.stoop * 0.6) * 0.65, A.headYaw * 0.65, A.headRoll * 0.65, 1, false, T.headK); put(B.head, W[B.head]);
    for (const S of ['L', 'R']) { const s = S === 'L' ? -1 : 1, a = A.arm[S], mir = s < 0;
      const cl = B['clav' + S], ar = B['arm' + S], fo = B['fore' + S], ha = B['hand' + S], fi = B['fing' + S];
      child(cl, W[B.chest], 0, 0, s * a.clav); put(cl, W[cl]);
      // arm (right-side angles, mirrored for the left)
      mEuler(R, a.sp, 0, a.sr); if (mir) mMirror(R); { const o = OFF[ar]; R[3] = o[0] * T.shoulderK; R[7] = o[1]; R[11] = o[2]; } mMul(W[ar], W[cl], R); put(ar, W[ar]);
      mEuler(R, a.el, 0, 0); if (mir) mMirror(R); { const o = OFF[fo]; R[3] = o[0]; R[7] = o[1]; R[11] = o[2]; } mMul(W[fo], W[ar], R); put(fo, W[fo]);
      mEuler(R, a.wx, a.wy, a.wz); if (mir) mMirror(R); { const o = OFF[ha]; R[3] = o[0]; R[7] = o[1]; R[11] = o[2]; } mMul(W[ha], W[fo], R); put(ha, W[ha]);
      mAxis(R, CURL_AX, -(a.curl - 0.35) * 0.9); if (mir) mMirror(R); { const o = OFF[fi]; R[3] = o[0]; R[7] = o[1]; R[11] = o[2]; } mMul(W[fi], W[ha], R); put(fi, W[fi]);
      const l = A.leg[S], th = B['thigh' + S], sh = B['shin' + S], ft = B['foot' + S];
      mEuler(R, l.hp, 0, s * l.ab); { const o = OFF[th]; R[3] = o[0] * T.hipK; R[7] = o[1]; R[11] = o[2]; } mMul(W[th], W[B.pelvis], R); put(th, W[th]);
      child(sh, W[th], l.kn, 0, 0); put(sh, W[sh]);
      const footP = l.ft != null ? l.ft - (l.hp + l.kn) : -(l.hp + l.kn) + (p.mode === 'sit' ? 0.12 : 0); child(ft, W[sh], footP, 0, -s * l.ab * 0.8); put(ft, W[ft]); }
    // props
    if (p.prop === 'phone' || p.prop === 'book') { // in the right hand's bind frame: X back, Y up the arm, Z thumb
      const X = HF.X, Y = HF.Y, Z = HF.Z; // basis to place the prop relative to the palm
      const bx = p.prop === 'phone' ? -0.028 : -0.03, by = p.prop === 'phone' ? -0.075 : -0.07, bz = p.prop === 'phone' ? 0.012 : -0.06;
      const pp = [J[B.handR * 3] + X[0] * bx + Y[0] * by + Z[0] * bz, J[B.handR * 3 + 1] + X[1] * bx + Y[1] * by + Z[1] * bz, J[B.handR * 3 + 2] + X[2] * bx + Y[2] * by + Z[2] * bz];
      // prop frame: screen (+z of the prop) faces the palm normal's opposite (toward the face when the palm faces the face)
      const nz = [-X[0], -X[1], -X[2]], ny = p.prop === 'phone' ? [-Y[0], -Y[1], -Y[2]] : [Z[0], Z[1], Z[2]], nx = [ny[1] * nz[2] - ny[2] * nz[1], ny[2] * nz[0] - ny[0] * nz[2], ny[0] * nz[1] - ny[1] * nz[0]];
      const Wh = mMul(this.T2, W[B.handR], IB[B.handR]); mMul(W[B.prop1], Wh, mSet(this.S, nx[0], ny[0], nz[0], pp[0], nx[1], ny[1], nz[1], pp[1], nx[2], ny[2], nz[2], pp[2]));
      const o = row + B.prop1 * 12; out.set(Array.from(W[B.prop1]), o); }
    if (p.suitcase) { if (p.mode === 'walk') mEuler(R, -0.38, 0, 0, 0.32, 0, -0.42); else mEuler(R, 0, 0.3, 0, 0.36, 0, 0.12); mMul(W[B.prop2], rootM, R); out.set(Array.from(W[B.prop2]), row + B.prop2 * 12); }
    // eyes: blink, gaze
    const d = row + DYN * 4; out[d] = blink; out[d + 1] = gy; out[d + 2] = gp; out[d + 3] = 0;
  }
}
