// Flight deck of a generic modern narrow-body (no manufacturer branding). Curved inner shell with a multi-pane
// windshield, eyebrow windows and padded bevelled frames; sculpted crackle-black glareshield with FCU / EFIS;
// main panel with recessed displays; pedestal (thrust levers, speedbrake, flaps, trim wheels, MCDUs, ECP, engine
// masters, radio panels, park brake); side consoles (sidesticks, tillers, cup holders, O2 masks, tray tables);
// a working 3D overhead panel (instanced guarded switches and lit pushbuttons, clickable, cold & dark start);
// sculpted sheepskin seats, jump seat and cockpit door. Static geometry is merged per material with baked AO;
// switches and keys are instanced; panel faces share texture atlases; flood/dome lights are shader terms.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { matSet, Atlas, Merge, V, filletOutline, densify, sweepFrame, gridSurface, strip, polyLerp, rrShape, bevelBox, knob, canvas, tex } from './fdart.js';

export const COCKPIT_EYE = new THREE.Vector3(-0.52, 1.20, -15.55);
const FLOOR = -0.15, CENTER = V(0, 1.05, -15.5);
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mx = v => V(-v.x, v.y, v.z);
const RB = (w, h, d, r = 0.02, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const RX = a => new THREE.Matrix4().makeRotationX(a), RY = a => new THREE.Matrix4().makeRotationY(a), RZ = a => new THREE.Matrix4().makeRotationZ(a);
const S3 = (x, y, z) => new THREE.Matrix4().makeScale(x, y, z);
const mul = (...m) => m.reduce((a, b) => a.multiply(b), new THREE.Matrix4());

// ------------------------------------------------ flood / dome / display-spill lights (shader terms, no extra three.js lights)
export const FLOOD = { p: [...Array(6)].map(() => new THREE.Vector4(0, 0, 0, 8)), c: [...Array(6)].map(() => new THREE.Vector3()) };
const FL_LOCAL = [V(0, 1.80, -15.2), V(-0.55, 0.84, -16.2), V(0.55, 0.84, -16.2), V(0, 1.50, -15.6), V(-0.6, 0.66, -16.15), V(0.6, 0.66, -16.15)];
const FL_FALL = [1.0, 26, 26, 3.5, 12, 12];
function patchFlood(m) {
  m.onBeforeCompile = sh => {
    sh.uniforms.uFlP = { value: FLOOD.p }; sh.uniforms.uFlC = { value: FLOOD.c };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec4 uFlP[6]; uniform vec3 uFlC[6];')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      { vec3 fpos = -vViewPosition; for (int i = 0; i < 6; i++) { vec3 L = uFlP[i].xyz - fpos; float d2 = max(dot(L, L), 1e-4); float ndl = max(dot(normal, L * inversesqrt(d2)), 0.0) * 0.85 + 0.15;
        reflectedLight.indirectDiffuse += diffuseColor.rgb * uFlC[i] * ndl / (1.0 + d2 * uFlP[i].w); } }`);
  };
  m.customProgramCacheKey = () => 'deckflood'; return m;
}
const deckMat = o => patchFlood(new THREE.MeshStandardMaterial({ vertexColors: true, ...o }));
function colorAttr(g, rgb = [1, 1, 1]) { const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.set(rgb, i * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; }

// ------------------------------------------------ face frames (panel faces as seen by the pilot: R = right, U = up, N = toward the pilot)
function faceFrame(bl, br, tl) { const R = br.clone().sub(bl); const w = R.length(); R.normalize(); const Ut = tl.clone().sub(bl); const U = Ut.clone().addScaledVector(R, -Ut.dot(R)); const h = U.length(); U.normalize(); return { o: bl.clone(), R, U, N: R.clone().cross(U), w, h }; }
const fpt = (F, x, y, z = 0) => F.o.clone().addScaledVector(F.R, x).addScaledVector(F.U, y).addScaledVector(F.N, z);
const fmat = (F, x, y, z = 0) => new THREE.Matrix4().makeBasis(F.R, F.U, F.N).setPosition(fpt(F, x, y, z));
// painter coordinates (x right, y down from the top edge) → face matrix
const pmat = (F, px, py, z = 0) => fmat(F, px, F.h - py, z);
function facing(geo, ref = COCKPIT_EYE) { // flip a planar piece so it faces the pilot
  const p = geo.attributes.position; const a = V(p.getX(0), p.getY(0), p.getZ(0)), b = V(p.getX(1), p.getY(1), p.getZ(1)), c = V(p.getX(2), p.getY(2), p.getZ(2));
  const n = b.clone().sub(a).cross(c.clone().sub(a)); if (n.dot(ref.clone().sub(a)) < 0) { for (let i = 0; i < p.count; i += 3) { const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1); p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)); p.setXYZ(i + 2, x, y, z); } geo.computeVertexNormals(); }
  return geo;
}
function quad(a, b, c, d) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([a, b, c, a, c, d].flatMap(p => [p.x, p.y, p.z]), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2)); g.computeVertexNormals(); return g; }

// ------------------------------------------------ 7-segment readouts
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '', A: 'abcefg', C: 'adef', E: 'adefg', F: 'aefg', H: 'bcefg', L: 'def', P: 'abefg', S: 'afgcd', t: 'defg', b: 'cdefg', d: 'bcdeg', r: 'eg', o: 'cdeg', n: 'ceg', U: 'bcdef', I: 'bc' };
function seg7(c, str, x, y, h, color, glow = 8) {
  const w = h * 0.52, t = h * 0.13, sk = h * 0.09; c.save(); c.fillStyle = color; c.shadowColor = color; c.shadowBlur = glow;
  const P = (px, py) => [x + px + (h - py) / h * sk, y + py];
  const seg = { a: [[t, 0], [w - t, 0], [w - t * 1.6, t], [t * 1.6, t]], b: [[w, t * 0.5], [w, h / 2 - t * 0.3], [w - t, h / 2 - t * 0.8], [w - t, t * 1.5]], c: [[w, h / 2 + t * 0.3], [w, h - t * 0.5], [w - t, h - t * 1.5], [w - t, h / 2 + t * 0.8]],
    d: [[t, h], [w - t, h], [w - t * 1.6, h - t], [t * 1.6, h - t]], e: [[0, h / 2 + t * 0.3], [0, h - t * 0.5], [t, h - t * 1.5], [t, h / 2 + t * 0.8]], f: [[0, t * 0.5], [0, h / 2 - t * 0.3], [t, h / 2 - t * 0.8], [t, t * 1.5]],
    g: [[t * 0.6, h / 2], [t * 1.4, h / 2 - t * 0.5], [w - t * 1.4, h / 2 - t * 0.5], [w - t * 0.6, h / 2], [w - t * 1.4, h / 2 + t * 0.5], [t * 1.4, h / 2 + t * 0.5]] };
  for (const ch of String(str)) {
    if (ch === '.') { c.beginPath(); const [px, py] = P(-t * 0.6, h - t * 0.5); c.arc(px, py, t * 0.55, 0, 7); c.fill(); continue; }
    for (const s of SEG[ch] ?? '') { c.beginPath(); seg[s].forEach(([px, py], i) => { const q = P(px, py); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.closePath(); c.fill(); }
    x += w + h * 0.2;
  }
  c.restore();
}

// ------------------------------------------------ pushbutton legend atlas (instanced legends with per-instance lighting)
const AMB = [2.4, 1.15, 0.12], GRN = [0.45, 2.2, 0.7], BLU = [0.35, 1.1, 2.8], WHT = [1.9, 1.9, 1.8], RED = [2.9, 0.25, 0.15], OFFC = [0, 0, 0];
class Legends {
  constructor() { this.c = canvas(1024, 1024); this.x = this.c.getContext('2d'); this.x.fillStyle = '#000'; this.x.fillRect(0, 0, 1024, 1024); this.cells = {}; this.n = 0; }
  cell(top, bot, big) {
    const key = top + '|' + bot + '|' + (big ? 1 : 0); if (key in this.cells) return this.cells[key];
    const i = this.n++, cx = (i % 8) * 128, cy = Math.floor(i / 8) * 96, x = this.x; x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const fit = (t, y, size) => { let s = size; do { x.font = `700 ${s}px "B612", "Arial Narrow", sans-serif`; s--; } while (x.measureText(t).width > 112 && s > 10); x.fillText(t, cx + 64, cy + y); };
    if (top === 'BAR') { x.beginPath(); x.roundRect(cx + 34, cy + 16, 60, 12, 5); x.fill(); } else if (top) fit(top, big ? 34 : 28, big ? 30 : 25);
    if (bot) fit(bot, big ? 70 : 68, big ? 26 : 25);
    return (this.cells[key] = [cx / 1024, 1 - (cy + 96) / 1024, 128 / 1024, 96 / 1024]);
  }
  material() {
    const t = tex(this.c, false, false); this.tex = t;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: t }, uDay: { value: 1 }, uPow: { value: 1 } },
      vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aCell; attribute vec3 aTop; attribute vec3 aBot; varying vec2 vU; varying vec3 vT; varying vec3 vB; varying float vH;
void main() { vU = aCell.xy + uv * aCell.zw; vH = uv.y; vT = aTop; vB = aBot; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
#include <logdepthbuf_vertex>
}`,
      fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uMap; uniform float uDay; uniform float uPow; varying vec2 vU; varying vec3 vT; varying vec3 vB; varying float vH;
void main() {
#include <logdepthbuf_fragment>
  float m = texture2D(uMap, vU).r; vec3 g = (vH > 0.5 ? vT : vB) * uPow; float lit = max(max(g.r, g.g), g.b);
  vec3 col = vec3(0.018, 0.02, 0.024) + m * (vec3(0.10) * uDay + g) + g * 0.03;
  gl_FragColor = vec4(col, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}` });
    return this.mat;
  }
}

// ------------------------------------------------ the build
export function buildCockpit(displays, opts = {}) {
  const g = new THREE.Group(); g.name = 'cockpit';
  // ---------- materials (procedural sets) ----------
  const SETS = { shell: matSet('vinyl', '#c3c2bc'), frame: matSet('leather', '#787e86'), paint: matSet('paint', '#4a5662'), crackle: matSet('crackle', '#16181b'), carpet: matSet('carpet', '#2f343b'),
    leather: matSet('leather', '#2a2d33'), sheep: matSet('sheep', '#e3d8c3'), metal: matSet('brushed', '#b4b9bf'), dark: matSet('rubber', '#202328'), rubber: matSet('rubber', '#151618') };
  const mk = (k, o = {}) => { const s = SETS[k]; const m = deckMat({ map: s.map, normalMap: s.normalMap, roughnessMap: s.roughnessMap, roughness: 1, metalness: 0, envMapIntensity: 1, ...o }); m.userData.scale = s.scale; return m; };
  const MATS = { shell: mk('shell', { side: THREE.DoubleSide }), frame: mk('frame', { side: THREE.DoubleSide }), paint: mk('paint'), crackle: mk('crackle', { side: THREE.DoubleSide }), carpet: mk('carpet'),
    leather: mk('leather', { envMapIntensity: 0.8 }), sheep: mk('sheep', { envMapIntensity: 0.9 }), metal: mk('metal', { metalness: 1, envMapIntensity: 1.2 }), dark: mk('dark'), rubber: mk('rubber'),
    red: deckMat({ color: 0xb3261c, roughness: 0.35 }), white: deckMat({ color: 0xe9e8e2, roughness: 0.45 }), yellow: deckMat({ color: 0xd9a514, roughness: 0.5 }) };
  // ---------- atlases ----------
  const AT = { main: new Atlas(2048, 2048, 940), ovh: new Atlas(1024, 1392, 1150), ped: new Atlas(2048, 2048, 980) };
  const ao = (p, n) => {
    let a = 0.5 + 0.5 * sm(FLOOR, FLOOR + 0.5, p.y);
    if (p.z < -16.1 && p.y < 0.86 && p.y > 0.2 && Math.abs(p.x) < 1.1) a *= 0.62 + 0.38 * sm(0, 0.3, 0.86 - p.y);
    if (p.z < -16.15 && p.y < 0.32) a *= 0.55;
    if (Math.abs(p.x) < 0.3 && p.y < 0.31 && p.z > -16.3 && p.z < -14.85) a *= 0.75 + 0.25 * sm(FLOOR, 0.31, p.y);
    if (Math.abs(p.x) > 0.8 && Math.abs(p.x) < 1.3 && p.y < 0.52) a *= 0.75 + 0.25 * sm(FLOOR, 0.52, p.y);
    if (p.y > 1.45) a *= 0.86 + 0.14 * sm(1.88, 1.5, p.y);
    return a * (0.82 + 0.18 * (n.y * 0.5 + 0.5));
  };
  const M = new Merge(ao);
  const add = (geo, key, mat) => M.add(geo, key, mat, key.startsWith('atlas') ? {} : { boxUV: true, uvScale: MATS[key].userData.scale });

  // ======================================================= SHELL: windows, frames, posts, roof, sills
  const WL = {
    FL: [V(-0.045, 0.78, -16.98), V(-0.98, 0.83, -16.48), V(-0.86, 1.50, -16.00), V(-0.045, 1.50, -16.42)],
    S1: [V(-1.06, 0.88, -16.34), V(-1.22, 0.92, -15.62), V(-1.10, 1.49, -15.52), V(-0.93, 1.50, -15.92)],
    S2: [V(-1.24, 0.94, -15.50), V(-1.27, 0.98, -14.95), V(-1.17, 1.42, -14.92), V(-1.12, 1.46, -15.42)],
  };
  const END_T = V(-1.20, 1.38, -14.45), END_B = V(-1.29, 1.00, -14.45);
  const PROFILE = [[-0.008, 0.003], [-0.002, 0.016], [0.008, 0.03], [0.024, 0.04], [0.046, 0.044], [0.07, 0.04], [0.09, 0.029], [0.104, 0.013], [0.112, 0.0]];
  const glassGeos = [], windows = [];
  for (const k in WL) for (const side of [-1, 1]) windows.push({ k, side, pts: WL[k].map(p => side < 0 ? p.clone() : mx(p)) });
  const frameFor = (pts, n, r = 0.075) => add(sweepFrame(densify(filletOutline(pts, r, 5), 0.04), () => n, PROFILE), 'frame');
  for (const w of windows) {
    const c = w.pts.reduce((s, p) => s.add(p), V(0, 0, 0)).multiplyScalar(0.25);
    const n = w.pts[1].clone().sub(w.pts[0]).cross(w.pts[3].clone().sub(w.pts[0])).normalize(); if (n.dot(CENTER.clone().sub(c)) < 0) n.negate();
    w.n = n; w.c = c; frameFor(w.pts, n);
    const o = n.clone().multiplyScalar(-0.004); glassGeos.push(quad(...w.pts.map(p => p.clone().add(o))));
  }
  // posts between panes (padded lining under the frames)
  for (const sd of [1, -1]) {
    const f = p => sd < 0 ? p.clone() : mx(p); const { FL, S1, S2 } = WL;
    add(strip(polyLerp([f(FL[1]), f(FL[2])], 10), polyLerp([f(S1[0]), f(S1[3])], 10)), 'shell');
    add(strip(polyLerp([f(S1[1]), f(S1[2])], 10), polyLerp([f(S2[0]), f(S2[3])], 10)), 'shell');
    add(strip(polyLerp([f(S2[1]), f(S2[2])], 10), polyLerp([f(END_B), f(END_T)], 10)), 'shell');
  }
  add(strip(polyLerp([WL.FL[0], WL.FL[3]], 10), polyLerp([mx(WL.FL[0]), mx(WL.FL[3])], 10)), 'shell');
  // roof: sections at constant z from the left window-top line over the crown to the right one
  const TOP = [WL.FL[3], WL.FL[2], WL.S1[3], WL.S1[2], WL.S2[3], WL.S2[2], END_T];
  const TL = [0]; for (let i = 1; i < TOP.length; i++) TL.push(TL[i - 1] + TOP[i].distanceTo(TOP[i - 1])); const TLEN = TL[TL.length - 1];
  const topAt = u => { const s = u * TLEN; let i = 1; while (i < TOP.length - 1 && TL[i] < s) i++; return TOP[i - 1].clone().lerp(TOP[i], THREE.MathUtils.clamp((s - TL[i - 1]) / (TL[i] - TL[i - 1]), 0, 1)); };
  const crown = z => 1.86 - 0.30 * Math.pow(THREE.MathUtils.clamp((-15.0 - z) / 1.6, 0, 1), 1.5);
  const roofAt = (u, v) => { const p = topAt(u), X = -p.x, ph = v * Math.PI, yc = crown(p.z); return V(-X * Math.cos(ph), p.y + (yc - p.y) * Math.pow(Math.max(0, Math.sin(ph)), 0.8), p.z); };
  const uA = TL[2] / TLEN + 0.03, uB = TL[3] / TLEN - 0.03, EB = [[0.09, 0.2], [0.8, 0.91]];
  const inEB = (u, v) => u > uA && u < uB && EB.some(([a, b]) => v > a && v < b);
  const lin = (n, extra = []) => [...new Set([...Array.from({ length: n + 1 }, (_, i) => +(i / n).toFixed(5)), ...extra])].sort((a, b) => a - b);
  add(gridSurface(roofAt, 0, 0, inEB, lin(64, [uA, uB]), lin(44, EB.flat())), 'shell');
  for (const [a, b] of EB) { // eyebrow windows: glass + frame
    const gg = gridSurface((u, v) => { const p = roofAt(uA + (uB - uA) * u, a + (b - a) * v); return p.add(p.clone().sub(CENTER).normalize().multiplyScalar(0.004)); }, 4, 2); glassGeos.push(gg);
    const corners = [roofAt(uA, a), roofAt(uB, a), roofAt(uB, b), roofAt(uA, b)]; const c = corners.reduce((s, p) => s.add(p), V(0, 0, 0)).multiplyScalar(0.25);
    frameFor(corners, CENTER.clone().sub(c).normalize(), 0.03);
  }
  // sills / side walls below the side windows, down to the side consoles
  for (const sd of [1, -1]) { const f = p => sd < 0 ? p.clone() : mx(p); const B = polyLerp([WL.FL[1], WL.S1[0], WL.S1[1], WL.S2[0], WL.S2[1], END_B].map(f), 36); add(strip(B, B.map(p => V(sd < 0 ? -1.285 : 1.285, 0.515, p.z))), 'shell'); }
  // aft bulkhead with the door opening (roof curve on top)
  { const sh = new THREE.Shape(); sh.moveTo(-1.29, FLOOR); sh.lineTo(-1.29, 1.0); for (let i = 0; i <= 32; i++) { const p = roofAt(1, i / 32); sh.lineTo(p.x, p.y); } sh.lineTo(1.29, 1.0); sh.lineTo(1.29, FLOOR); sh.closePath();
    const hole = new THREE.Path(); hole.moveTo(-0.62, FLOOR + 0.006); hole.lineTo(0.22, FLOOR + 0.006); hole.lineTo(0.22, 1.72); hole.lineTo(-0.62, 1.72); hole.closePath(); sh.holes.push(hole);
    const bg = new THREE.ShapeGeometry(sh, 6); bg.translate(0, 0, -14.452); add(bg, 'shell');
    add(new THREE.BoxGeometry(0.9, 0.05, 0.04), 'paint', T(-0.2, 1.745, -14.47)); for (const x of [-0.645, 0.245]) add(new THREE.BoxGeometry(0.05, 1.9, 0.04), 'paint', T(x, FLOOR + 0.95, -14.47)); }
  // floor, nose bulkhead, corner walls
  add(new THREE.PlaneGeometry(2.6, 2.2).rotateX(-Math.PI / 2), 'carpet', T(0, FLOOR, -15.55));
  add(new THREE.PlaneGeometry(2.6, 1.1), 'dark', T(0, FLOOR + 0.5, -16.62));
  for (const sd of [-1, 1]) add(new THREE.PlaneGeometry(0.32, 0.6), 'paint', T(sd * 1.14, 0.56, -16.46));

  // ======================================================= GLARESHIELD
  { const A = polyLerp([V(0, 0.775, -16.99), WL.FL[1], V(-1.05, 0.845, -16.44)], 30); const Bv = A.map(p => V(p.x, 1.0, -16.31));
    add(strip(A, Bv), 'crackle'); add(strip(A.map(mx), Bv.map(mx)), 'crackle');
    const P2 = (z, y) => [-z, y]; const lip = new THREE.Shape(); lip.moveTo(...P2(-16.34, 1.0)); lip.lineTo(...P2(-16.17, 1.0)); lip.quadraticCurveTo(...P2(-16.115, 1.0), ...P2(-16.115, 0.97));
    lip.lineTo(...P2(-16.1, 0.885)); lip.quadraticCurveTo(...P2(-16.1, 0.862), ...P2(-16.13, 0.862)); lip.lineTo(...P2(-16.37, 0.858)); lip.lineTo(...P2(-16.37, 0.97)); lip.closePath();
    const lg = new THREE.ExtrudeGeometry(lip, { depth: 2.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.006, bevelSegments: 3, curveSegments: 8 }); lg.rotateY(Math.PI / 2); lg.translate(-1.025, 0, 0); add(lg, 'crackle'); }
  const FGS = faceFrame(V(-1.0, 0.885, -16.10), V(1.0, 0.885, -16.10), V(-1.0, 0.97, -16.115));

  // ======================================================= MAIN PANEL faces (atlas) + knee panels
  const MP = { L: [V(-1.04, 0.30, -16.20), V(-0.25, 0.30, -16.27), V(-1.04, 0.855, -16.275)], C: [V(-0.25, 0.30, -16.27), V(0.25, 0.30, -16.27), V(-0.25, 0.855, -16.345)], R: [V(0.25, 0.30, -16.27), V(1.04, 0.30, -16.20), V(0.25, 0.855, -16.345)] };
  const faces = {};
  const face = (id, atlas, bl, br, tl, paint) => { const F = faceFrame(bl, br, tl); F.P = AT[atlas].region(id, F.w, F.h, paint); F.atlas = atlas; F.id = id; faces[id] = F; return F; };
  const FL_ = face('mpL', 'main', ...MP.L), FC = face('mpC', 'main', ...MP.C), FR_ = face('mpR', 'main', ...MP.R);
  for (const sd of [-1, 1]) { const a = V(sd * 1.04, 0.30, -16.20), b = V(sd * 0.25, 0.30, -16.27); add(facing(quad(sd < 0 ? a : b, sd < 0 ? b : a, V(sd < 0 ? -0.25 : 1.04, 0.10, -16.45), V(sd < 0 ? -1.04 : 0.25, 0.10, -16.40))), 'paint'); }
  add(new THREE.BoxGeometry(0.02, 0.56, 0.03), 'dark', T(-0.25, 0.575, -16.29)); add(new THREE.BoxGeometry(0.02, 0.56, 0.03), 'dark', T(0.25, 0.575, -16.29));

  // ======================================================= PEDESTAL & SIDE CONSOLES bodies
  { const sh = new THREE.Shape(); const pts = [[-16.27, FLOOR], [-16.27, 0.42], [-15.93, 0.31], [-14.88, 0.31], [-14.88, FLOOR]]; sh.moveTo(-pts[0][0], pts[0][1]); for (const [z, y] of pts.slice(1)) sh.lineTo(-z, y); sh.closePath();
    const pg = new THREE.ExtrudeGeometry(sh, { depth: 0.49, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.006, bevelSegments: 2 }); pg.rotateY(Math.PI / 2); pg.translate(-0.245, 0, 0); add(pg, 'paint'); }
  const FPS = face('pedS', 'ped', V(-0.25, 0.3165, -15.925), V(0.25, 0.3165, -15.925), V(-0.25, 0.4265, -16.262));
  const FPT = face('pedT', 'ped', V(-0.25, 0.3165, -14.89), V(0.25, 0.3165, -14.89), V(-0.25, 0.3165, -15.92));
  for (const sd of [-1, 1]) add(RB(0.42, 0.67, 1.80, 0.03), 'paint', T(sd * 1.05, FLOOR + 0.335, -15.58));
  const FSL = face('scL', 'ped', V(-1.245, 0.5215, -14.70), V(-0.855, 0.5215, -14.70), V(-1.245, 0.5215, -16.46));
  const FSR = face('scR', 'ped', V(0.855, 0.5215, -14.70), V(1.245, 0.5215, -14.70), V(0.855, 0.5215, -16.46));

  // ======================================================= OVERHEAD body + face
  { const sh = new THREE.Shape(); const pts = [[-16.18, 1.56], [-15.02, 1.75], [-15.02, 1.93], [-16.18, 1.74]]; sh.moveTo(-pts[0][0], pts[0][1]); for (const [z, y] of pts.slice(1)) sh.lineTo(-z, y); sh.closePath();
    const og = new THREE.ExtrudeGeometry(sh, { depth: 0.88, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.008, bevelSegments: 2 }); og.rotateY(Math.PI / 2); og.translate(-0.44, 0, 0); add(og, 'paint'); }
  const FOV = face('ovh', 'ovh', V(-0.45, 1.5505, -16.18), V(0.45, 1.5505, -16.18), V(-0.45, 1.7405, -15.02));

  // ======================================================= instanced controls registry
  const LEG = new Legends();
  const I = { cap: [], key: [], togBase: [], tog: [], rot: [], knob: [], guard: [], legend: [], hit: [] };
  const controls = [];
  const dynCanvas = []; // readout planes
  const lab = (F, t, px, py, size = 0.0085, o = {}) => F.P.text(t, px, py, size, o.color || '#eef2f6', o);
  // pushbutton: kind → legend lighting rule
  function pb(F, px, py, o) {
    const w = o.w || 0.028, h = o.h || 0.024, big = !!o.big;
    const base = pmat(F, px, py, 0); const ci = I.cap.push(mul(base.clone(), S3(w / 0.028, h / 0.024, 1))) - 1;
    const li = I.legend.push({ m: mul(base.clone(), T(0, 0, 0.0122), S3(w / 0.028 * 0.92, h / 0.024 * 0.9, 1)), cell: LEG.cell(o.top ?? '', o.bot ?? '', big), top: OFFC, bot: OFFC }) - 1;
    if (o.label) lab(F, o.label, px, py - h / 2 - 0.0075, o.lsize || 0.0072);
    if (o.guard) I.guard.push(mul(base.clone(), S3((w + 0.012) / 0.04, (h + 0.012) / 0.034, 1)));
    const c = { id: o.id, label: o.name || o.label || o.id, kind: 'pb', F, px, py, ci, li, base, o, hit: mul(base.clone(), T(0, 0, 0.008), S3(w + 0.006, h + 0.006, 0.02)) };
    controls.push(c); return c;
  }
  function tog(F, px, py, o) { // positions listed top → bottom (first = up)
    const base = pmat(F, px, py, 0); I.togBase.push(base.clone()); const ti = I.tog.push(base.clone()) - 1; const n = o.pos.length;
    const ang = n === 2 ? [0.55, -0.55] : [0.55, 0, -0.55];
    if (o.label) lab(F, o.label, px, py - 0.03, o.lsize || 0.0072); o.pos.forEach((p, i) => { if (o.posLab !== false) lab(F, p, px + 0.021, py - 0.016 + i * (0.032 / (n - 1)), 0.0058, { align: 'left', weight: 600 }); });
    if (o.guard) I.guard.push(mul(base.clone(), S3(0.9, 1.6, 1)));
    const c = { id: o.id, label: o.name || o.label, kind: 'tog', F, px, py, ti, base, ang, o, hit: mul(base.clone(), T(0, 0, 0.012), S3(0.024, 0.036, 0.03)) }; controls.push(c); return c;
  }
  function rot(F, px, py, o) { // rotary selector, positions left → right
    const base = pmat(F, px, py, 0); const ri = I[o.big ? 'knob' : 'rot'].push(base.clone()) - 1; const n = o.pos.length; const spread = o.spread || 0.7;
    const ang = o.pos.map((_, i) => n === 1 ? 0 : -spread + 2 * spread * i / (n - 1)); const r = o.big ? 0.026 : 0.021;
    if (o.label) lab(F, o.label, px, py - r - 0.012, o.lsize || 0.0072);
    o.pos.forEach((p, i) => { const a = ang[i]; if (o.posLab !== false) lab(F, p, px + Math.sin(a) * r, py - Math.cos(a) * r, 0.0056, { weight: 600 }); });
    const c = { id: o.id, label: o.name || o.label, kind: 'rot', F, px, py, ri, base, ang, o, big: !!o.big, hit: mul(base.clone(), T(0, 0, 0.01), S3(0.034, 0.034, 0.03)) }; controls.push(c); return c;
  }
  function knobCtl(F, px, py, o) { // continuous dimmer / FCU knob
    const base = pmat(F, px, py, 0); const ri = I.knob.push(base.clone()) - 1; if (o.label) lab(F, o.label, px, py - 0.03, o.lsize || 0.0068);
    if (o.scale !== false) for (let i = 0; i <= 6; i++) { const a = -2.2 + i * 4.4 / 6; F.P.line(px + Math.sin(a) * 0.019, py - Math.cos(a) * 0.019, px + Math.sin(a) * 0.023, py - Math.cos(a) * 0.023, '#eef2f6', 0.0009); }
    const c = { id: o.id, label: o.name || o.label, kind: 'knob', F, px, py, ri, base, o, big: true, hit: mul(base.clone(), T(0, 0, 0.012), S3(0.034, 0.034, 0.03)) }; controls.push(c); return c;
  }
  function readout(F, px, py, w, h, cv, u0, v0, u1, v1) { // a window showing part of a dynamic canvas
    F.P.box(px - w / 2 - 0.003, py - h / 2 - 0.003, w + 0.006, h + 0.006, '#07080a', { r: 0.002, height: 70 });
    const geo = new THREE.PlaneGeometry(w, h); const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    geo.applyMatrix4(pmat(F, px, py, 0.0012)); dynCanvas.push({ geo, cv });
  }

  // ======================================================= DISPLAYS (recessed in bevelled bezels with soft keys)
  const screens = [], screenMats = [];
  const scrMat = t => { const m = new THREE.MeshBasicMaterial({ map: t, toneMapped: true }); screenMats.push(m); return m; };
  function display(F, cx, cy, size, texture, keys = 5) {
    const bz = new THREE.ExtrudeGeometry(rrShape(size + 0.034, size + 0.062, 0.012, [size + 0.002, size + 0.002, 0.004, 0, 0.014]), { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 2, curveSegments: 3 });
    add(bz, 'dark', fmat(F, cx, cy - 0.014, 0));
    F.P.box(cx - size / 2 - 0.02, F.h - cy - size / 2 - 0.03, size + 0.04, size + 0.07, 'rgba(0,0,0,0.25)', { r: 0.01 });
    const sg = new THREE.PlaneGeometry(size, size); sg.applyMatrix4(fmat(F, cx, cy, 0.004)); screens.push({ geo: sg, tex: texture });
    glassGeos.push(new THREE.PlaneGeometry(size + 0.002, size + 0.002).applyMatrix4(fmat(F, cx, cy, 0.0075)));
    for (let i = 0; i < keys; i++) I.key.push(fmat(F, cx + (i - (keys - 1) / 2) * 0.036, cy - size / 2 - 0.026, 0.016));
    I.knob.push(mul(fmat(F, cx + size / 2 + 0.002, cy - size / 2 - 0.027, 0.014), S3(0.45, 0.45, 0.45)));
  }
  display(FL_, 0.40, 0.365, 0.2, displays.tex.pfd); display(FL_, 0.655, 0.365, 0.2, displays.tex.nd);
  display(FR_, FR_.w - 0.655, 0.365, 0.2, displays.tex.nd); display(FR_, FR_.w - 0.40, 0.365, 0.2, displays.tex.pfd);
  display(FC, 0.25, 0.447, 0.19, displays.tex.ewd, 0); display(FC, 0.25, 0.229, 0.19, displays.tex.sd, 0);
  // standby instrument (ISIS) and clock
  const isisCv = canvas(160), clockCv = canvas(160);
  { const bz = new THREE.ExtrudeGeometry(rrShape(0.105, 0.105, 0.01, [0.086, 0.086, 0.004]), { depth: 0.01, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.002, bevelSegments: 2 }); add(bz, 'dark', fmat(FC, 0.07, 0.44, 0));
    const ig = new THREE.PlaneGeometry(0.086, 0.086).applyMatrix4(fmat(FC, 0.07, 0.44, 0.004)); screens.push({ geo: ig, tex: tex(isisCv, true, false), cv: isisCv, kind: 'isis' });
    const ring = new THREE.TorusGeometry(0.041, 0.006, 8, 40); add(ring, 'metal', fmat(FC, 0.07, 0.235, 0.004)); add(new THREE.CylinderGeometry(0.041, 0.041, 0.006, 40).rotateX(Math.PI / 2), 'dark', fmat(FC, 0.07, 0.235, 0.0));
    const cg = new THREE.CircleGeometry(0.037, 40).applyMatrix4(fmat(FC, 0.07, 0.235, 0.0035)); screens.push({ geo: cg, tex: tex(clockCv, true, false), cv: clockCv, kind: 'clock', lit: false });
    lab(FC, 'STBY', 0.07, FC.h - 0.44 - 0.064, 0.0065); lab(FC, 'CLOCK', 0.07, FC.h - 0.235 - 0.058, 0.0065); }

  // ======================================================= ATLAS FACE GRAPHICS: main panel
  for (const [F, sd] of [[FL_, -1], [FR_, 1]]) {
    F.P.frame(0.01, 0.01, F.w - 0.02, F.h - 0.02); F.P.seam(0.01, F.h - 0.2, F.w - 0.01, F.h - 0.2); F.P.wear(80);
    const lx = sd < 0 ? 0.12 : F.w - 0.12;
    lab(F, sd < 0 ? 'CAPT' : 'F/O', lx, 0.05, 0.011, { weight: 700 });
    lab(F, 'PFD ND XFR', sd < 0 ? 0.40 : F.w - 0.40, F.h - 0.17, 0.0068); lab(F, 'LOUD SPKR', sd < 0 ? 0.58 : F.w - 0.58, F.h - 0.17, 0.0068); lab(F, 'CONSOLE / FLOOR', sd < 0 ? 0.22 : F.w - 0.22, F.h - 0.17, 0.0068);
  }
  FC.P.frame(0.008, 0.008, FC.w - 0.016, FC.h - 0.016); lab(FC, 'LDG GEAR', FC.w - 0.07, 0.07, 0.0075, { weight: 700 }); lab(FC, 'UP', FC.w - 0.045, 0.165, 0.0065); lab(FC, 'DN', FC.w - 0.045, 0.32, 0.0065); lab(FC, 'AUTO BRK', FC.w - 0.07, 0.385, 0.0068, { weight: 700 });
  FC.P.box(FC.w - 0.079, 0.15, 0.018, 0.185, '#0b0c0e', { r: 0.006, height: 40 });
  for (const F of [FL_, FR_]) { pb(F, F === FL_ ? 0.40 : F.w - 0.40, F.h - 0.14, { id: 'xfr' + F.id, top: '', bot: 'XFR', name: 'PFD/ND transfer' }); }

  // ======================================================= GLARESHIELD units: FCU, EFIS ×2, master warning/caution
  const fcuCv = canvas(1024, 96);
  { add(bevelBox(0.62, 0.088, 0.05, 0.008, 0.004), 'paint', fmat(FGS, 1.0, 0.044, 0.025)); const F = face('fcu', 'main', fpt(FGS, 0.69, 0.0, 0.0505), fpt(FGS, 1.31, 0.0, 0.0505), fpt(FGS, 0.69, 0.088, 0.0505));
    for (const [x, t] of [[0.065, 'SPD'], [0.215, 'HDG'], [0.395, 'ALT'], [0.535, 'V/S']]) { lab(F, t, x, 0.012, 0.0072, { weight: 700 }); }
    readout(F, 0.065, 0.032, 0.07, 0.022, fcuCv, 0, 0, 0.25, 1); readout(F, 0.215, 0.032, 0.07, 0.022, fcuCv, 0.25, 0, 0.5, 1); readout(F, 0.395, 0.032, 0.09, 0.022, fcuCv, 0.5, 0, 0.75, 1); readout(F, 0.535, 0.032, 0.085, 0.022, fcuCv, 0.75, 0, 1, 1);
    knobCtl(F, 0.065, 0.066, { id: 'fcuSpd', name: 'Speed knob', scale: false }); knobCtl(F, 0.215, 0.066, { id: 'fcuHdg', name: 'Heading knob', scale: false }); knobCtl(F, 0.395, 0.066, { id: 'fcuAlt', name: 'Altitude knob', scale: false }); knobCtl(F, 0.535, 0.066, { id: 'fcuVs', name: 'Vertical speed knob', scale: false });
    pb(F, 0.135, 0.066, { id: 'fcuLoc', top: 'BAR', bot: 'LOC', w: 0.026, h: 0.02, name: 'LOC' }); pb(F, 0.30, 0.03, { id: 'fcuAp1', top: 'BAR', bot: 'AP1', w: 0.026, h: 0.02, name: 'Autopilot 1' }); pb(F, 0.335, 0.03, { id: 'fcuAp2', top: 'BAR', bot: 'AP2', w: 0.026, h: 0.02, name: 'Autopilot 2' });
    pb(F, 0.3175, 0.066, { id: 'fcuAthr', top: 'BAR', bot: 'A/THR', w: 0.03, h: 0.02, name: 'Autothrust' }); pb(F, 0.465, 0.066, { id: 'fcuExped', top: 'BAR', bot: 'EXPED', w: 0.028, h: 0.02, name: 'EXPED' }); pb(F, 0.6, 0.066, { id: 'fcuAppr', top: 'BAR', bot: 'APPR', w: 0.026, h: 0.02, name: 'Approach' });
    F.P.seam(0.27, 0.005, 0.27, 0.083); F.P.seam(0.365, 0.005, 0.365, 0.083); }
  const efisCv = canvas(256, 64);
  for (const sd of [-1, 1]) {
    const cx = 1.0 + sd * 0.53; add(bevelBox(0.30, 0.080, 0.035, 0.008, 0.004), 'paint', fmat(FGS, cx, 0.043, 0.0175));
    const F = face(sd < 0 ? 'efisL' : 'efisR', 'main', fpt(FGS, cx - 0.15, 0.003, 0.0355), fpt(FGS, cx + 0.15, 0.003, 0.0355), fpt(FGS, cx - 0.15, 0.083, 0.0355));
    lab(F, 'BARO', 0.05, 0.012, 0.0065, { weight: 700 }); readout(F, 0.05, 0.03, 0.055, 0.018, efisCv, sd < 0 ? 0 : 0.5, 0, sd < 0 ? 0.5 : 1, 1);
    knobCtl(F, 0.05, 0.062, { id: 'baro' + sd, name: 'Baro knob', scale: false });
    ['FD', 'LS'].forEach((t, i) => pb(F, 0.105, 0.025 + i * 0.03, { id: t.toLowerCase() + sd, top: 'BAR', bot: t, w: 0.022, h: 0.019, name: t === 'FD' ? 'Flight director' : 'Landing system' }));
    ['CSTR', 'WPT', 'VOR.D', 'NDB', 'ARPT'].forEach((t, i) => pb(F, 0.14 + i * 0.026, 0.022, { id: 'efis' + t + sd, top: 'BAR', bot: t, w: 0.022, h: 0.018, name: t }));
    rot(F, 0.17, 0.06, { id: 'ndMode' + sd, label: '', pos: ['LS', 'VOR', 'NAV', 'ARC', 'PLAN'], name: 'ND mode', spread: 1.1 }); rot(F, 0.245, 0.06, { id: 'ndRange' + sd, label: '', pos: ['10', '20', '40', '80', '160'], name: 'ND range', spread: 1.1 });
    const mw = pb(FGS, 1.0 + sd * 0.84, 0.062, { id: 'mw' + sd, top: 'MASTER', bot: 'WARN', w: 0.042, h: 0.026, big: true, name: 'Master warning' });
    const mc = pb(FGS, 1.0 + sd * 0.84, 0.03, { id: 'mc' + sd, top: 'MASTER', bot: 'CAUT', w: 0.042, h: 0.026, big: true, name: 'Master caution' });
    add(bevelBox(0.06, 0.07, 0.012, 0.006, 0.003), 'dark', fmat(FGS, 1.0 + sd * 0.84, 0.046, 0.0)); mw.o.z0 = mc.o.z0 = 0.006;
  }

  // ======================================================= CENTER PANEL: gear lever, gear lights, autobrake
  const gearPiv = new THREE.Group(); { const F = FC; gearPiv.matrixAutoUpdate = false; gearPiv.matrix.copy(pmat(F, F.w - 0.07, 0.2425, 0.0)); g.add(gearPiv);
    const arm = colorAttr(new THREE.CylinderGeometry(0.006, 0.006, 0.075, 10).rotateX(Math.PI / 2).translate(0, 0, 0.037)); const wheel = colorAttr(new THREE.TorusGeometry(0.019, 0.007, 10, 28).translate(0, 0, 0.078)); const disc = colorAttr(new THREE.CylinderGeometry(0.016, 0.016, 0.008, 24).rotateX(Math.PI / 2).translate(0, 0, 0.078));
    gearPiv.userData.lever = new THREE.Group(); gearPiv.add(gearPiv.userData.lever); gearPiv.userData.lever.add(new THREE.Mesh(arm, MATS.metal), new THREE.Mesh(wheel, MATS.white), new THREE.Mesh(disc, MATS.white));
    gearPiv.userData.lever.children.forEach(m => { m.castShadow = true; }); }
  const gearLights = [0, 1, 2].map(i => pb(FC, FC.w - 0.11 + i * 0.03 + (i === 1 ? 0 : 0), 0.035 + (i === 1 ? 0 : 0.012), { id: 'gl' + i, top: 'UNLK', bot: '▼', w: 0.024, h: 0.022, name: 'Gear indicator' }));
  const gearCtl = { id: 'gear', label: 'Landing gear lever', kind: 'lever', hit: mul(pmat(FC, FC.w - 0.07, 0.2425, 0.05), S3(0.06, 0.2, 0.1)) }; controls.push(gearCtl);
  ['LO', 'MED', 'MAX'].forEach((t, i) => pb(FC, FC.w - 0.105 + i * 0.035, 0.398, { id: 'abrk' + t, top: t, bot: 'ON', w: 0.03, h: 0.026, name: 'Autobrake ' + t }));

  // ======================================================= PEDESTAL: slope (MCDUs), top (ECP, thrust quadrant, engines, radios, lights, park brake)
  const mcduCv = canvas(512, 384), rmpCv = canvas(512, 64), elecCv = canvas(256, 48);
  FPS.P.frame(0.004, 0.004, FPS.w - 0.008, FPS.h - 0.008);
  for (const sd of [-1, 1]) { // MCDUs
    const cx = 0.125 + (sd > 0 ? 0.25 : 0); add(bevelBox(0.235, 0.33, 0.03, 0.01, 0.004), 'dark', pmat(FPS, cx, 0.175, 0.012));
    const F = face(sd < 0 ? 'mcduL' : 'mcduR', 'ped', fpt(FPS, cx - 0.1175, FPS.h - 0.34, 0.0285), fpt(FPS, cx + 0.1175, FPS.h - 0.34, 0.0285), fpt(FPS, cx - 0.1175, FPS.h - 0.01, 0.0285), '#2a2e34');
    const sx = 0.1175; readout(F, sx, 0.085, 0.15, 0.115, mcduCv, sd < 0 ? 0 : 0.5, 0, sd < 0 ? 0.5 : 1, 1);
    for (let r = 0; r < 6; r++) for (const s of [-1, 1]) I.key.push(mul(pmat(F, sx + s * 0.098, 0.04 + r * 0.018, 0.002), S3(0.85, 1.1, 1)));
    const fk = ['DIR', 'PROG', 'PERF', 'INIT', 'DATA', 'F-PLN', 'RAD NAV', 'FUEL PRED', 'SEC F-PLN', 'ATC COMM', 'MCDU MENU', 'AIRPORT'];
    fk.forEach((t, i) => { const x = 0.035 + (i % 6) * 0.033, y = 0.165 + Math.floor(i / 6) * 0.02; I.key.push(mul(pmat(F, x, y, 0.002), S3(1.15, 1.25, 1))); lab(F, t, x, y, 0.0035, { weight: 700 }); });
    const al = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; for (let i = 0; i < 30; i++) { const x = 0.1 + (i % 5) * 0.022, y = 0.215 + Math.floor(i / 5) * 0.018; I.key.push(mul(pmat(F, x, y, 0.002), S3(0.8, 1.05, 1))); lab(F, i < 26 ? al[i] : ['-', '+', 'SP', 'OVFY', 'CLR'][i - 26] || '', x, y, 0.0045, { weight: 700 }); }
    for (let i = 0; i < 12; i++) { const x = 0.03 + (i % 3) * 0.022, y = 0.235 + Math.floor(i / 3) * 0.019; I.key.push(mul(pmat(F, x, y, 0.002), S3(0.8, 1.05, 1))); lab(F, '123456789.0-'[i], x, y, 0.005, { weight: 700 }); }
    lab(F, 'BRT', 0.215, 0.165, 0.004); lab(F, 'FAIL', 0.02, 0.165, 0.004, { color: '#ffb84d' });
  }
  { const F = FPT; F.P.frame(0.004, 0.004, F.w - 0.008, F.h - 0.008); F.P.wear(60);
    F.P.title('ECAM', 0.01, 0.012, F.w - 0.02, 0.0075); ['ENG', 'BLEED', 'PRESS', 'ELEC', 'HYD', 'FUEL', 'APU', 'COND', 'DOOR', 'WHEEL', 'F/CTL'].forEach((t, i) => pb(F, 0.03 + i * 0.0445, 0.045, { id: 'ecp' + t, top: 'BAR', bot: t, w: 0.034, h: 0.022, name: 'ECAM ' + t + ' page' }));
    pb(F, 0.06, 0.09, { id: 'ecpCLR', top: '', bot: 'CLR', w: 0.034, h: 0.02, name: 'ECAM CLR' }); pb(F, 0.45, 0.09, { id: 'ecpRCL', top: '', bot: 'RCL', w: 0.034, h: 0.02, name: 'ECAM recall' }); pb(F, 0.255, 0.09, { id: 'ecpSTS', top: '', bot: 'STS', w: 0.034, h: 0.02, name: 'ECAM status' });
    F.P.seam(0.01, 0.112, F.w - 0.01, 0.112);
    // thrust quadrant slots and detents
    for (const x of [0.2, 0.31]) F.P.box(x - 0.007, 0.14, 0.014, 0.25, '#08090b', { r: 0.006, height: 30 });
    F.P.box(0.043, 0.16, 0.012, 0.18, '#08090b', { r: 0.005, height: 30 }); F.P.box(0.455, 0.16, 0.012, 0.18, '#08090b', { r: 0.005, height: 30 });
    [['TOGA', 0.155], ['FLX MCT', 0.19], ['CL', 0.23], ['IDLE', 0.31], ['REV', 0.37]].forEach(([t, y]) => { lab(F, t, 0.255, y, 0.0062, { weight: 700 }); F.P.line(0.215, y, 0.232, y); F.P.line(0.278, y, 0.295, y); });
    lab(F, 'SPEED BRAKE', 0.05, 0.142, 0.0062, { weight: 700 }); [['RET', 0.17], ['1/2', 0.25], ['FULL', 0.33]].forEach(([t, y]) => lab(F, t, 0.085, y, 0.0058));
    lab(F, 'FLAPS', 0.455, 0.142, 0.0062, { weight: 700 }); [['0', 0.17], ['1', 0.205], ['2', 0.245], ['3', 0.285], ['FULL', 0.325]].forEach(([t, y]) => lab(F, t, 0.425, y, 0.0058));
    lab(F, 'PITCH TRIM', 0.03, 0.42, 0.0055, { weight: 700 }); lab(F, 'PITCH TRIM', 0.48, 0.42, 0.0055, { weight: 700 });
    F.P.seam(0.01, 0.43, F.w - 0.01, 0.43);
    F.P.title('ENG', 0.08, 0.455, 0.35, 0.0075);
    tog(F, 0.17, 0.53, { id: 'master1', label: 'MASTER 1', pos: ['ON', 'OFF'], name: 'Engine 1 master', guard: true }); tog(F, 0.34, 0.53, { id: 'master2', label: 'MASTER 2', pos: ['ON', 'OFF'], name: 'Engine 2 master', guard: true });
    rot(F, 0.255, 0.535, { id: 'engMode', label: 'MODE', pos: ['CRANK', 'NORM', 'IGN'], name: 'Engine mode selector', big: true, spread: 0.8 });
    pb(F, 0.17, 0.475, { id: 'eng1fault', top: 'FIRE', bot: 'FAULT', w: 0.03, h: 0.022, name: 'Engine 1 fire / fault' }); pb(F, 0.34, 0.475, { id: 'eng2fault', top: 'FIRE', bot: 'FAULT', w: 0.03, h: 0.022, name: 'Engine 2 fire / fault' });
    F.P.seam(0.01, 0.6, F.w - 0.01, 0.6);
    for (const [i, x0] of [[0, 0.01], [1, 0.26]]) { // radio management panels
      F.P.title('RMP ' + (i + 1), x0, 0.615, 0.24, 0.007); lab(F, 'ACTIVE', x0 + 0.06, 0.632, 0.0055); lab(F, 'STBY/CRS', x0 + 0.18, 0.632, 0.0055);
      readout(F, x0 + 0.06, 0.652, 0.085, 0.022, rmpCv, i * 0.5, 0, i * 0.5 + 0.25, 1); readout(F, x0 + 0.18, 0.652, 0.085, 0.022, rmpCv, i * 0.5 + 0.25, 0, i * 0.5 + 0.5, 1);
      pb(F, x0 + 0.12, 0.652, { id: 'xfr' + i, top: '', bot: '⇄', w: 0.022, h: 0.02, name: 'Frequency transfer' }); knobCtl(F, x0 + 0.18, 0.7, { id: 'rmpK' + i, name: 'Frequency knob', scale: false });
      ['VHF1', 'VHF2', 'VHF3', 'HF1'].forEach((t, k) => pb(F, x0 + 0.03 + k * 0.026, 0.705, { id: 'rmp' + i + t, top: 'BAR', bot: t, w: 0.022, h: 0.018, name: t }));
    }
    F.P.seam(0.01, 0.75, F.w - 0.01, 0.75); F.P.title('LIGHTING', 0.01, 0.77, 0.2, 0.007); F.P.title('PARK BRK', 0.2, 0.77, 0.11, 0.007); F.P.title('ATC / TCAS', 0.32, 0.77, 0.18, 0.007);
    knobCtl(F, 0.045, 0.83, { id: 'floodMain', label: 'MAIN PNL FLOOD', name: 'Main panel flood light' }); knobCtl(F, 0.135, 0.83, { id: 'floodPed', label: 'PED FLOOD', name: 'Pedestal flood light' });
    knobCtl(F, 0.045, 0.93, { id: 'integ', label: 'INTEG LT', name: 'Integral panel lighting' }); knobCtl(F, 0.135, 0.93, { id: 'console', label: 'CONSOLE FLOOR', name: 'Console / floor light' });
    rot(F, 0.4, 0.85, { id: 'tcas', pos: ['STBY', 'TA', 'TA/RA'], name: 'TCAS mode', big: true, spread: 0.8 }); rot(F, 0.4, 0.95, { id: 'xpdr', pos: ['STBY', 'AUTO', 'ON'], name: 'Transponder', spread: 0.8 });
    F.P.box(0.215, 0.80, 0.08, 0.2, '#30353b', { r: 0.008, height: 140 }); lab(F, 'ON', 0.27, 0.83, 0.006); lab(F, 'OFF', 0.27, 0.95, 0.006);
  }
  const parkCtl = { id: 'park', label: 'Parking brake handle', kind: 'lever', hit: mul(pmat(FPT, 0.255, 0.88, 0.03), S3(0.07, 0.1, 0.06)) }; controls.push(parkCtl);
  // side consoles
  for (const [F, sd] of [[FSL, -1], [FSR, 1]]) {
    F.P.frame(0.006, 0.006, F.w - 0.012, F.h - 0.012); F.P.wear(70);
    const ix = sd < 0 ? F.w - 0.06 : 0.06; // inboard edge
    lab(F, 'NOSE WHEEL STEERING', sd < 0 ? 0.17 : F.w - 0.17, 0.28, 0.0065, { weight: 700 }); lab(F, 'PRIORITY', sd < 0 ? 0.23 : F.w - 0.23, 0.6, 0.0062);
    F.P.box(sd < 0 ? 0.05 : F.w - 0.33, 0.05, 0.28, 0.17, '#3b434c', { r: 0.008, height: 150 }); lab(F, 'TABLE', sd < 0 ? 0.19 : F.w - 0.19, 0.13, 0.008, { weight: 700, lit: false, color: '#c9d0d8' });
    F.P.title('AUDIO CONTROL', sd < 0 ? 0.02 : F.w - 0.38, 1.18, 0.36, 0.0065);
    for (let i = 0; i < 6; i++) knobCtl(F, (sd < 0 ? 0.05 : F.w - 0.31) + i * 0.052, 1.24, { id: 'acp' + sd + i, label: ['VHF1', 'VHF2', 'VHF3', 'HF1', 'INT', 'CAB'][i], name: 'Audio volume', scale: false });
    F.P.box(sd < 0 ? 0.05 : F.w - 0.31, 1.29, 0.26, 0.03, '#15171a', { r: 0.01, height: 40 }); for (let i = 0; i < 18; i++) F.P.box((sd < 0 ? 0.06 : F.w - 0.30) + i * 0.0135, 1.297, 0.006, 0.016, '#050506', { r: 0.002 });
    lab(F, 'LOUDSPEAKER', sd < 0 ? 0.18 : F.w - 0.18, 1.345, 0.0055);
    lab(F, 'OXY', ix + (sd < 0 ? -0.26 : 0.26), 1.52, 0.0065, { weight: 700 });
  }

  // ======================================================= OVERHEAD PANEL layout (painter coords: y = 0 aft edge … 1.175 front edge)
  { const F = FOV, P = F.P; P.wear(90);
    const mod = (t, x, y, w, h) => { P.frame(x, y, w, h); P.title(t, x + 0.01, y + 0.014, w - 0.02, 0.008); };
    // row A (front): exterior lights + APU
    mod('EXT LT', 0.012, 1.02, 0.6, 0.145); mod('APU', 0.625, 1.02, 0.265, 0.145);
    [['strobe', 'STROBE', ['ON', 'AUTO', 'OFF']], ['beacon', 'BEACON', ['ON', 'OFF']], ['wing', 'WING', ['ON', 'OFF']], ['nav', 'NAV & LOGO', ['ON', 'OFF']], ['rwyTurnoff', 'RWY TURN OFF', ['ON', 'OFF']], ['landL', 'LAND L', ['ON', 'OFF']], ['landR', 'LAND R', ['ON', 'OFF']], ['nose', 'NOSE', ['T.O', 'TAXI', 'OFF']]]
      .forEach(([id, t, pos], i) => tog(F, 0.05 + i * 0.073, 1.105, { id, label: t, pos, name: t + ' lights', lsize: 0.0066 }));
    pb(F, 0.69, 1.1, { id: 'apuMaster', top: 'FAULT', bot: 'ON', label: 'MASTER SW', name: 'APU master switch' }); pb(F, 0.81, 1.1, { id: 'apuStart', top: 'ON', bot: 'AVAIL', label: 'START', name: 'APU start' });
    // row B: signs, interior lights, wipers
    mod('SIGNS', 0.012, 0.86, 0.29, 0.145); mod('INT LT', 0.31, 0.86, 0.3, 0.145); mod('WIPER', 0.625, 0.86, 0.265, 0.145);
    tog(F, 0.07, 0.945, { id: 'belts', label: 'SEAT BELTS', pos: ['ON', 'OFF'], name: 'Seat belt signs' }); tog(F, 0.16, 0.945, { id: 'smoke', label: 'NO SMOKING', pos: ['ON', 'OFF'], name: 'No smoking signs' }); tog(F, 0.25, 0.945, { id: 'emerExit', label: 'EMER EXIT LT', pos: ['ON', 'ARM', 'OFF'], name: 'Emergency exit lights', guard: true });
    tog(F, 0.37, 0.945, { id: 'dome', label: 'DOME', pos: ['BRT', 'DIM', 'OFF'], name: 'Dome light' }); tog(F, 0.46, 0.945, { id: 'annLt', label: 'ANN LT', pos: ['TEST', 'BRT', 'DIM'], name: 'Annunciator lights' }); knobCtl(F, 0.555, 0.95, { id: 'integ', label: 'OVHD INTEG LT', name: 'Integral panel lighting' });
    rot(F, 0.69, 0.95, { id: 'wipers', label: 'WIPER', pos: ['OFF', 'SLOW', 'FAST'], name: 'Windshield wipers', spread: 0.8 }); pb(F, 0.81, 0.945, { id: 'rainRpl', top: 'FAULT', bot: 'ON', label: 'RAIN RPLNT', name: 'Rain repellent' });
    // row C: electrics
    mod('ELEC', 0.012, 0.68, 0.878, 0.165);
    readout(F, 0.1, 0.725, 0.05, 0.018, elecCv, 0, 0, 0.5, 1); readout(F, 0.2, 0.725, 0.05, 0.018, elecCv, 0.5, 0, 1, 1);
    pb(F, 0.1, 0.785, { id: 'bat1', top: 'FAULT', bot: 'OFF', label: 'BAT 1', name: 'Battery 1' }); pb(F, 0.2, 0.785, { id: 'bat2', top: 'FAULT', bot: 'OFF', label: 'BAT 2', name: 'Battery 2' });
    pb(F, 0.33, 0.785, { id: 'extPwr', top: 'AVAIL', bot: 'ON', label: 'EXT PWR', name: 'External (ground) power' }); pb(F, 0.46, 0.785, { id: 'gen1', top: 'FAULT', bot: 'OFF', label: 'GEN 1', name: 'Generator 1' });
    pb(F, 0.56, 0.785, { id: 'apuGen', top: 'FAULT', bot: 'OFF', label: 'APU GEN', name: 'APU generator' }); pb(F, 0.66, 0.785, { id: 'gen2', top: 'FAULT', bot: 'OFF', label: 'GEN 2', name: 'Generator 2' }); pb(F, 0.79, 0.785, { id: 'busTie', top: '', bot: 'OFF', label: 'BUS TIE', name: 'Bus tie' });
    lab(F, 'BAT V', 0.15, 0.705, 0.0058);
    // row D: air conditioning / bleed
    mod('AIR COND', 0.012, 0.5, 0.878, 0.165);
    pb(F, 0.1, 0.6, { id: 'pack1', top: 'FAULT', bot: 'OFF', label: 'PACK 1', name: 'Pack 1 (air conditioning)' }); pb(F, 0.22, 0.6, { id: 'bleed1', top: 'FAULT', bot: 'OFF', label: 'ENG 1 BLEED', name: 'Engine 1 bleed' });
    pb(F, 0.4, 0.6, { id: 'apuBleed', top: 'FAULT', bot: 'ON', label: 'APU BLEED', name: 'APU bleed air' }); rot(F, 0.52, 0.6, { id: 'xbleed', label: 'X BLEED', pos: ['SHUT', 'AUTO', 'OPEN'], name: 'Crossbleed', spread: 0.8 });
    pb(F, 0.64, 0.6, { id: 'bleed2', top: 'FAULT', bot: 'OFF', label: 'ENG 2 BLEED', name: 'Engine 2 bleed' }); pb(F, 0.78, 0.6, { id: 'pack2', top: 'FAULT', bot: 'OFF', label: 'PACK 2', name: 'Pack 2 (air conditioning)' });
    P.line(0.1, 0.565, 0.78, 0.565, '#eef2f6', 0.0012); P.line(0.4, 0.565, 0.4, 0.585);
    // row E: fuel
    mod('FUEL', 0.012, 0.32, 0.878, 0.165);
    [['fuelL1', 'L TK 1', 0.07], ['fuelL2', 'L TK 2', 0.15], ['fuelC1', 'CTR TK 1', 0.34], ['fuelC2', 'CTR TK 2', 0.43], ['fuelR1', 'R TK 1', 0.62], ['fuelR2', 'R TK 2', 0.70]].forEach(([id, t, x]) => pb(F, x, 0.42, { id, top: 'FAULT', bot: 'OFF', label: t, name: t + ' fuel pump' }));
    pb(F, 0.81, 0.42, { id: 'fuelMode', top: 'FAULT', bot: 'MAN', label: 'MODE SEL', name: 'Fuel mode' });
    // row F: hydraulics + fire
    mod('HYD', 0.012, 0.14, 0.42, 0.165); mod('FIRE', 0.44, 0.14, 0.45, 0.165);
    pb(F, 0.07, 0.24, { id: 'hyd1', top: 'FAULT', bot: 'OFF', label: 'ENG 1 PUMP', name: 'Engine 1 hydraulic pump' }); pb(F, 0.18, 0.24, { id: 'hydElec', top: 'FAULT', bot: 'ON', label: 'ELEC PUMP', name: 'Electric hydraulic pump' });
    pb(F, 0.28, 0.24, { id: 'ptu', top: 'FAULT', bot: 'OFF', label: 'PTU', name: 'Power transfer unit' }); pb(F, 0.38, 0.24, { id: 'hyd2', top: 'FAULT', bot: 'OFF', label: 'ENG 2 PUMP', name: 'Engine 2 hydraulic pump' });
    [['fire1', 'ENG 1', 0.52], ['fireApu', 'APU', 0.665], ['fire2', 'ENG 2', 0.81]].forEach(([id, t, x]) => { pb(F, x, 0.235, { id, top: 'FIRE', bot: t, w: 0.05, h: 0.034, big: true, guard: true, name: t + ' fire pushbutton (guarded)' }); pb(F, x, 0.29, { id: id + 'test', top: '', bot: 'TEST', w: 0.024, h: 0.016, name: t + ' fire test' }); });
    // row G (aft): ADIRS, oxygen, calls
    mod('ADIRS', 0.012, 0.0, 0.52, 0.13); mod('OXYGEN', 0.54, 0.0, 0.17, 0.13); mod('CALLS', 0.72, 0.0, 0.17, 0.13);
    [['ir1', 'IR 1', 0.1], ['ir3', 'IR 3', 0.24], ['ir2', 'IR 2', 0.38]].forEach(([id, t, x]) => rot(F, x, 0.08, { id, label: t, pos: ['OFF', 'NAV', 'ATT'], name: t + ' inertial reference', big: true, spread: 0.8 }));
    pb(F, 0.625, 0.08, { id: 'crewOxy', top: '', bot: 'OFF', label: 'CREW SUPPLY', name: 'Crew oxygen' }); pb(F, 0.805, 0.08, { id: 'callAll', top: '', bot: 'ALL', label: 'CABIN', name: 'Call the cabin crew' });
  }

  // ======================================================= build atlases, merged meshes, atlas faces
  for (const k in AT) AT[k].finish();
  const atlasMat = {};
  for (const k in AT) { atlasMat[k] = deckMat({ map: AT[k].map, normalMap: AT[k].normal, emissiveMap: AT[k].emissive, emissive: 0xffe2b8, emissiveIntensity: 0, roughness: 0.62, metalness: 0, vertexColors: true }); MATS['atlas_' + k] = atlasMat[k]; }
  for (const id in faces) { const F = faces[id]; const at = AT[F.atlas], r = at.regions[id]; const geo = new THREE.PlaneGeometry(F.w, F.h).translate(F.w / 2, F.h / 2, 0); const uv = geo.attributes.uv;
    const u0 = r.x / at.W, u1 = (r.x + r.w) / at.W, v0 = 1 - (r.y + r.h) / at.H, v1 = 1 - r.y / at.H; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    add(geo, 'atlas_' + F.atlas, fmat(F, 0, 0, 0.0008)); }

  // ======================================================= SEATS, jump seat, door, details (merged)
  function seat(x) {
    const zc = -15.42; for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.03, 0.95), 'metal', T(x + s * 0.12, FLOOR + 0.015, zc));
    add(RB(0.30, 0.36, 0.34, 0.03), 'dark', T(x, FLOOR + 0.19, zc)); add(RB(0.46, 0.09, 0.47, 0.035), 'leather', T(x, 0.345, zc));
    for (const s of [-1, 1]) add(RB(0.07, 0.07, 0.44, 0.03), 'leather', T(x + s * 0.205, 0.40, zc)); add(RB(0.36, 0.03, 0.40, 0.012), 'sheep', T(x, 0.398, zc + 0.01));
    const B = mul(T(x, 0.37, zc + 0.235), RX(0.2));
    add(RB(0.46, 0.66, 0.11, 0.04), 'leather', mul(B.clone(), T(0, 0.36, 0.03))); for (const s of [-1, 1]) add(RB(0.07, 0.58, 0.12, 0.03), 'leather', mul(B.clone(), T(s * 0.205, 0.36, -0.005)));
    add(RB(0.34, 0.56, 0.03, 0.012), 'sheep', mul(B.clone(), T(0, 0.37, -0.035))); add(RB(0.28, 0.17, 0.10, 0.045), 'leather', mul(B.clone(), T(0, 0.80, 0.02)));
    for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 8), 'metal', mul(B.clone(), T(s * 0.07, 0.70, 0.03)));
    for (const s of [-1, 1]) { add(RB(0.06, 0.05, 0.30, 0.022), 'leather', T(x + s * 0.265, 0.62, zc - 0.03)); add(new THREE.BoxGeometry(0.02, 0.17, 0.03), 'dark', T(x + s * 0.265, 0.53, zc + 0.12)); }
    add(new THREE.BoxGeometry(0.12, 0.012, 0.012), 'metal', T(x + 0.2, 0.27, zc - 0.22)); add(RB(0.03, 0.03, 0.03, 0.012), 'dark', T(x + 0.265, 0.27, zc - 0.22));
  }
  seat(-0.56); seat(0.56);
  add(RB(0.42, 0.48, 0.07, 0.03), 'leather', T(0.6, 0.98, -14.5)); add(RB(0.42, 0.40, 0.08, 0.03), 'leather', T(0.6, 0.5, -14.52));
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.5, 0.004), 'dark', T(0.6 + s * 0.12, 0.98, -14.537)); add(new THREE.BoxGeometry(0.03, 0.03, 0.04), 'metal', T(0.6, 0.86, -14.54));
  // fire extinguisher, coat hook, flight bag, gaspers, standby compass, map lights, grab handles
  add(new THREE.CylinderGeometry(0.055, 0.055, 0.36, 20), 'red', T(-0.98, 0.25, -14.53)); add(new THREE.CylinderGeometry(0.02, 0.03, 0.06, 12), 'dark', T(-0.98, 0.46, -14.53)); add(new THREE.BoxGeometry(0.09, 0.012, 0.025), 'dark', T(-0.95, 0.49, -14.53));
  for (const y of [0.15, 0.36]) add(new THREE.TorusGeometry(0.058, 0.006, 6, 20).rotateX(Math.PI / 2), 'metal', T(-0.98, y, -14.53));
  add(new THREE.TorusGeometry(0.022, 0.005, 6, 12, Math.PI * 1.3).rotateY(Math.PI / 2), 'metal', T(-0.85, 1.48, -14.475)); add(new THREE.BoxGeometry(0.03, 0.05, 0.01), 'metal', T(-0.85, 1.5, -14.452));
  add(bevelBox(0.42, 0.30, 0.20, 0.03, 0.01), 'leather', mul(T(-0.78, FLOOR + 0.155, -14.72), RY(0.2))); add(new THREE.TorusGeometry(0.06, 0.012, 8, 16, Math.PI), 'leather', mul(T(-0.78, FLOOR + 0.31, -14.72), RY(0.2)));
  for (const sd of [-1, 1]) for (const [y, z] of [[0.86, -16.1], [0.9, -15.28]]) { const p = V(sd * 1.235, y, z); add(new THREE.TorusGeometry(0.03, 0.009, 8, 20).rotateY(Math.PI / 2), 'dark', T(p.x, p.y, p.z)); add(new THREE.SphereGeometry(0.022, 14, 10), 'metal', T(p.x - sd * 0.006, p.y, p.z)); }
  add(RB(0.07, 0.06, 0.06, 0.012), 'dark', T(0, 1.455, -16.41)); add(new THREE.PlaneGeometry(0.04, 0.02).translate(0, 0, 0.031), 'white', T(0, 1.455, -16.41));
  for (const sd of [-1, 1]) { add(new THREE.CylinderGeometry(0.025, 0.03, 0.05, 14), 'dark', T(sd * 0.6, 1.76, -15.42)); add(new THREE.CylinderGeometry(0.022, 0.022, 0.004, 14), 'white', T(sd * 0.6, 1.733, -15.42)); }
  // window crank & release handle on the sliding windows
  for (const sd of [-1, 1]) { add(new THREE.BoxGeometry(0.012, 0.012, 0.11), 'metal', T(sd * 1.14, 0.95, -15.74)); add(new THREE.CylinderGeometry(0.012, 0.012, 0.035, 10).rotateZ(Math.PI / 2), 'dark', T(sd * 1.12, 0.95, -15.69)); add(RB(0.03, 0.06, 0.02, 0.008), 'red', T(sd * 0.99, 1.38, -15.9)); }
  // rudder pedals
  for (const x0 of [-0.56, 0.56]) for (const s of [-1, 1]) add(RB(0.09, 0.19, 0.025, 0.01), 'dark', mul(T(x0 + s * 0.11, 0.0, -16.42), RX(-0.5)));

  // ======================================================= side console furniture: sidesticks, tillers, cup holders, O2 boxes, tables, armrests
  const sticks = [], tillers = [];
  for (const sd of [-1, 1]) {
    const boot = new THREE.LatheGeometry([[0.045, 0], [0.042, 0.008], [0.036, 0.012], [0.038, 0.02], [0.03, 0.026], [0.031, 0.034], [0.022, 0.04], [0.016, 0.046], [0.0, 0.048]].map(([r, y]) => new THREE.Vector2(r, y)), 20);
    add(boot, 'rubber', T(sd * 1.03, 0.521, -15.66));
    const st = new THREE.Group(); st.position.set(sd * 1.03, 0.555, -15.66); g.add(st);
    const grip = new THREE.Group(); st.add(grip);
    const gm = colorAttr(new THREE.CapsuleGeometry(0.021, 0.085, 6, 14).translate(0, 0.06, 0)); const gripMesh = new THREE.Mesh(gm, MATS.dark); gripMesh.rotation.set(-0.22, 0, sd * 0.12); grip.add(gripMesh);
    const btn = new THREE.Mesh(colorAttr(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 12)), MATS.red); btn.position.set(sd * -0.005, 0.12, -0.02); grip.add(btn);
    const trig = new THREE.Mesh(colorAttr(RB(0.012, 0.03, 0.012, 0.004)), MATS.dark); trig.position.set(0, 0.07, -0.025); grip.add(trig);
    [gripMesh, btn, trig].forEach(m => { m.castShadow = true; m.receiveShadow = true; }); sticks.push(grip);
    // tiller
    add(new THREE.CylinderGeometry(0.03, 0.035, 0.02, 20), 'dark', T(sd * 1.07, 0.531, -16.08)); const tl = new THREE.Group(); tl.position.set(sd * 1.07, 0.55, -16.08); g.add(tl);
    const tw = new THREE.Mesh(colorAttr(new THREE.TorusGeometry(0.05, 0.009, 8, 28).rotateX(Math.PI / 2)), MATS.dark); tl.add(tw); const tk = new THREE.Mesh(colorAttr(new THREE.CylinderGeometry(0.009, 0.009, 0.035, 10).translate(0, 0.018, 0)), MATS.dark); tk.position.set(0, 0, 0.05); tl.add(tk);
    for (let i = 0; i < 3; i++) { const sp = new THREE.Mesh(colorAttr(new THREE.BoxGeometry(0.006, 0.006, 0.05)), MATS.dark); sp.rotation.y = i * Math.PI * 2 / 3; sp.position.set(Math.sin(i * Math.PI * 2 / 3) * 0.025, 0, Math.cos(i * Math.PI * 2 / 3) * 0.025); tl.add(sp); }
    tillers.push(tl);
    // cup holder (+ a coffee on the captain's side)
    add(new THREE.TorusGeometry(0.042, 0.006, 8, 24).rotateX(Math.PI / 2), 'metal', T(sd * 1.18, 0.524, -15.32)); add(new THREE.CircleGeometry(0.04, 20).rotateX(-Math.PI / 2), 'rubber', T(sd * 1.18, 0.5225, -15.32));
    if (sd < 0) { add(new THREE.CylinderGeometry(0.036, 0.03, 0.1, 20), 'white', T(-1.18, 0.572, -15.32)); add(new THREE.CylinderGeometry(0.038, 0.038, 0.012, 20), 'dark', T(-1.18, 0.627, -15.32)); }
    // O2 mask box
    add(RB(0.15, 0.08, 0.17, 0.012), 'paint', T(sd * 1.16, 0.565, -14.9)); add(RB(0.13, 0.012, 0.15, 0.004), 'yellow', T(sd * 1.16, 0.607, -14.9)); add(RB(0.03, 0.02, 0.05, 0.006), 'red', T(sd * 1.1, 0.612, -14.84));
    // console armrest
    add(RB(0.09, 0.07, 0.36, 0.03), 'leather', T(sd * 1.0, 0.56, -15.3));
  }
  // tray tables (stowed, pull handle)
  for (const sd of [-1, 1]) { add(RB(0.30, 0.012, 0.18, 0.006), 'paint', T(sd * (sd < 0 ? 1.05 : 1.05), 0.53, -16.36)); add(new THREE.BoxGeometry(0.08, 0.008, 0.012), 'metal', T(sd * 1.05, 0.54, -16.27)); }

  // ======================================================= sun visors (tinted), wipers (outside the glass)
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x3a2412, transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
  const visors = new THREE.Group(); g.add(visors);
  for (const sd of [-1, 1]) {
    const a = roofAt(0.12, sd < 0 ? 0.24 : 0.76), b = roofAt(0.2, sd < 0 ? 0.12 : 0.88);
    const v1 = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.22), visorMat); v1.position.copy(a.clone().add(b).multiplyScalar(0.5)).add(V(0, -0.035, 0)); v1.lookAt(v1.position.clone().add(V(0, -1, 0.25))); visors.add(v1);
    const v2 = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.2), visorMat); v2.position.set(sd * 0.98, 1.43, -15.75); v2.lookAt(V(0, 1.2, -15.6)); visors.add(v2);
    add(new THREE.CylinderGeometry(0.004, 0.004, 0.45, 6).rotateZ(Math.PI / 2), 'metal', T(sd * 0.45, roofAt(0.16, 0.5).y - 0.03, -16.18));
  }
  const wipers = [];
  for (const w of windows.filter(w => w.k === 'FL')) {
    const [BI, BO] = w.pts; const along = BI.clone().sub(BO).normalize(); const up = w.pts[3].clone().sub(BI); up.addScaledVector(along, -up.dot(along)).normalize(); const out = w.n.clone().negate();
    const piv = BO.clone().lerp(BI, 0.15).addScaledVector(up, 0.03).addScaledVector(out, 0.03);
    const grp = new THREE.Group(); grp.matrixAutoUpdate = false; grp.matrix.makeBasis(along, up, out).setPosition(piv); g.add(grp);
    const arm = new THREE.Group(); grp.add(arm); const am = new THREE.Mesh(colorAttr(new THREE.BoxGeometry(0.62, 0.012, 0.012).translate(0.31, 0, 0)), MATS.dark); arm.add(am);
    const blade = new THREE.Mesh(colorAttr(new THREE.BoxGeometry(0.55, 0.008, 0.02).translate(0.33, -0.012, -0.012)), MATS.rubber); arm.add(blade); wipers.push({ arm, sd: w.side });
  }

  // ======================================================= thrust levers, speedbrake, flaps, trim wheels, park brake handle (dynamic)
  const dyn = (geo, mat) => { const m = new THREE.Mesh(colorAttr(geo), mat); m.castShadow = true; m.receiveShadow = true; return m; };
  const lever = (x, z, gripGeo, gripMat, len = 0.26) => { const piv = new THREE.Group(); piv.position.set(x, 0.2, z); g.add(piv); piv.add(dyn(new THREE.BoxGeometry(0.014, len, 0.022).translate(0, len / 2, 0), MATS.metal)); const gr = dyn(gripGeo, gripMat); gr.position.y = len; piv.add(gr); return piv; };
  const thr = [-0.055, 0.055].map(x => { const p = lever(x, -15.6, RB(0.07, 0.042, 0.06, 0.018), MATS.dark); const b = dyn(new THREE.CylinderGeometry(0.007, 0.007, 0.01, 10).rotateZ(Math.PI / 2), MATS.red); b.position.set(x < 0 ? -0.038 : 0.038, 0.26, 0); p.add(b); return p; });
  for (const x of [-0.105, 0.105]) { const sh = new THREE.Shape(); sh.absarc(0, 0, 0.17, Math.PI / 2 - 0.55, Math.PI / 2 + 0.5, false); sh.lineTo(0, 0); const qg = new THREE.ExtrudeGeometry(sh, { depth: 0.008, bevelEnabled: false }); qg.rotateY(Math.PI / 2); add(qg, 'dark', T(x - 0.004, 0.2, -15.6)); }
  const sbrk = lever(-0.205, -15.68, RB(0.05, 0.018, 0.03, 0.008), MATS.dark, 0.17);
  const flap = lever(0.205, -15.68, RB(0.035, 0.035, 0.05, 0.012), MATS.white, 0.17);
  const trimW = [-1, 1].map(sd => { const w = new THREE.Group(); w.position.set(sd * 0.272, 0.215, -15.56); g.add(w); const d = dyn(new THREE.CylinderGeometry(0.12, 0.12, 0.028, 56).rotateZ(Math.PI / 2), MATS.dark); w.add(d); const st = dyn(new THREE.BoxGeometry(0.03, 0.012, 0.012), MATS.white); st.position.set(0, 0.12, 0); w.add(st); return w; });
  const parkH = new THREE.Group(); parkH.matrixAutoUpdate = false; parkH.matrix.copy(pmat(FPT, 0.255, 0.88, 0)); g.add(parkH); const parkK = new THREE.Group(); parkH.add(parkK);
  parkK.add(dyn(new THREE.CylinderGeometry(0.018, 0.022, 0.03, 20).rotateX(Math.PI / 2).translate(0, 0, 0.015), MATS.dark), dyn(RB(0.07, 0.022, 0.022, 0.008).translate(0, 0, 0.04), MATS.dark));

  // ======================================================= cockpit door (opens into the cabin when walking)
  const door = new THREE.Group(); door.position.set(0.22, 0, -14.45); g.add(door);
  { const dp = dyn(bevelBox(0.84, 1.86, 0.045, 0.01, 0.006), MATS.paint); dp.position.set(-0.42, FLOOR + 0.94, -0.03); door.add(dp);
    const handle = dyn(new THREE.BoxGeometry(0.12, 0.022, 0.022), MATS.metal); handle.position.set(-0.74, FLOOR + 1.0, -0.068); door.add(handle);
    const peep = dyn(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 12).rotateX(Math.PI / 2), MATS.metal); peep.position.set(-0.42, FLOOR + 1.55, -0.058); door.add(peep);
    for (const y of [0.55, 1.35]) { const rib = dyn(new THREE.BoxGeometry(0.74, 0.025, 0.012), MATS.dark); rib.position.set(-0.42, FLOOR + y, -0.058); door.add(rib); }
    const kick = dyn(new THREE.BoxGeometry(0.80, 0.18, 0.006), MATS.dark); kick.position.set(-0.42, FLOOR + 0.1, -0.055); door.add(kick);
    const lamp = dyn(new THREE.BoxGeometry(0.05, 0.02, 0.01), MATS.dark); lamp.position.set(-0.75, FLOOR + 1.2, -0.06); door.add(lamp); }

  // ======================================================= instanced meshes for controls
  const instGeo = {
    cap: colorAttr(bevelBox(0.028, 0.024, 0.012, 0.004, 0.0025).translate(0, 0, 0.006)),
    key: colorAttr(bevelBox(0.024, 0.012, 0.006, 0.003, 0.0015).translate(0, 0, 0.003)),
    togBase: colorAttr(new THREE.CylinderGeometry(0.0085, 0.0095, 0.006, 16).rotateX(Math.PI / 2).translate(0, 0, 0.003)),
    tog: (() => { const a = new THREE.CylinderGeometry(0.0028, 0.0038, 0.026, 10).rotateX(Math.PI / 2).translate(0, 0, 0.017); const b = new THREE.SphereGeometry(0.0046, 12, 8).translate(0, 0, 0.031); return colorAttr(mergeG([a, b])); })(),
    rot: (() => { const k = knob(0.0105, 0.012, 18).rotateX(Math.PI / 2); colorAttr(k, [0.16, 0.17, 0.19]); const p = colorAttr(new THREE.BoxGeometry(0.0022, 0.009, 0.001).translate(0, 0.0045, 0.0122), [1, 1, 1]); return mergeG([k, p]); })(),
    knob: (() => { const k = knob(0.0125, 0.016, 22).rotateX(Math.PI / 2); colorAttr(k, [0.15, 0.16, 0.18]); const p = colorAttr(new THREE.BoxGeometry(0.002, 0.01, 0.001).translate(0, 0.006, 0.0162), [1, 1, 1]); const s = colorAttr(new THREE.CylinderGeometry(0.016, 0.016, 0.002, 20).rotateX(Math.PI / 2), [0.1, 0.1, 0.11]); return mergeG([s, k, p]); })(),
    guard: (() => { const parts = []; for (const [w, h, x, y] of [[0.04, 0.004, 0, 0.017], [0.04, 0.004, 0, -0.017], [0.004, 0.034, 0.02, 0], [0.004, 0.034, -0.02, 0]]) parts.push(new THREE.BoxGeometry(w, h, 0.016).translate(x, y, 0.008)); return colorAttr(mergeG(parts)); })(),
  };
  const instMat = { cap: deckMat({ color: 0x2a2d31, roughness: 0.4 }), key: deckMat({ color: 0x26292e, roughness: 0.45 }), togBase: deckMat({ color: 0x9aa1a8, roughness: 0.3, metalness: 0.8 }), tog: deckMat({ color: 0xc9ced3, roughness: 0.25, metalness: 0.9 }), rot: deckMat({ color: 0xffffff, roughness: 0.45 }), knob: deckMat({ color: 0xffffff, roughness: 0.4 }), guard: deckMat({ color: 0xb02a1e, roughness: 0.4 }) };
  const IM = {};
  for (const k of ['cap', 'key', 'togBase', 'tog', 'rot', 'knob', 'guard']) { const list = I[k]; if (!list.length) continue; const im = new THREE.InstancedMesh(instGeo[k], instMat[k], list.length); list.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = k !== 'key'; im.receiveShadow = true; im.frustumCulled = false; g.add(im); IM[k] = im; }
  // legends
  const legMat = LEG.material(); const legGeo = new THREE.PlaneGeometry(0.026, 0.022);
  const legIM = new THREE.InstancedMesh(legGeo, legMat, I.legend.length); const aCell = new Float32Array(I.legend.length * 4), aTop = new Float32Array(I.legend.length * 3), aBot = new Float32Array(I.legend.length * 3);
  I.legend.forEach((l, i) => { legIM.setMatrixAt(i, l.m); aCell.set(l.cell, i * 4); }); legIM.frustumCulled = false;
  legGeo.setAttribute('aCell', new THREE.InstancedBufferAttribute(aCell, 4)); const topAttr = new THREE.InstancedBufferAttribute(aTop, 3), botAttr = new THREE.InstancedBufferAttribute(aBot, 3); legGeo.setAttribute('aTop', topAttr); legGeo.setAttribute('aBot', botAttr); g.add(legIM);
  // hit proxies (raycast only)
  const hitIM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }), controls.length); controls.forEach((c, i) => { c.index = i; hitIM.setMatrixAt(i, c.hit); }); hitIM.visible = true; hitIM.frustumCulled = false; hitIM.userData.noShadow = true; g.add(hitIM);
  hitIM.castShadow = false;

  // screens & readouts
  const scrMeshes = [];
  for (const s of screens) { const m = new THREE.Mesh(s.geo, s.cv ? new THREE.MeshBasicMaterial({ map: s.tex }) : scrMat(s.tex)); if (s.cv) { screenMats.push(m.material); s.mat = m.material; } g.add(m); scrMeshes.push(m); }
  const dynTex = new Map(); for (const d of dynCanvas) { if (!dynTex.has(d.cv)) { const t = tex(d.cv, true, false); const mat = new THREE.MeshBasicMaterial({ map: t }); dynTex.set(d.cv, { t, mat }); screenMats.push(mat); } g.add(new THREE.Mesh(d.geo, dynTex.get(d.cv).mat)); }
  // glass (additive reflections only — the world stays fully visible through the holes)
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.06, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, envMapIntensity: 1.0, side: THREE.DoubleSide, specularIntensity: 1 });
  const glass = new THREE.Mesh(mergeG(glassGeos.map(gg => { const n = gg.index ? gg.toNonIndexed() : gg; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); n.computeVertexNormals(); return n; })), glassMat);
  glass.renderOrder = 20; glass.frustumCulled = false; g.add(glass);
  // merged static geometry
  const merged = M.build(MATS, g, true);

  // ======================================================= cockpit environment map (interior room with windows) for reflections
  const envScene = new THREE.Scene(); let envRT = null; const envRoomMat = new THREE.MeshBasicMaterial({ color: 0x404040, side: THREE.BackSide });
  { const room = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 2.4), envRoomMat); envScene.add(room); }
  const envWin = new THREE.MeshBasicMaterial({ color: 0xffffff }); const envGnd = new THREE.MeshBasicMaterial({ color: 0x404040 }); const envDisp = new THREE.MeshBasicMaterial({ color: 0x000000 });
  for (const [w, h, p, ry] of [[1.9, 0.7, V(0, 0.25, -1.19), 0], [1.0, 0.6, V(-1.29, 0.25, -0.3), Math.PI / 2], [1.0, 0.6, V(1.29, 0.25, -0.3), -Math.PI / 2]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), envWin); m.position.copy(p); m.rotation.y = ry; envScene.add(m); const gd = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.25), envGnd); gd.position.copy(p).add(V(0, -h / 2 - 0.12, 0.001 * Math.sign(-p.z || 1))); gd.rotation.y = ry; envScene.add(gd); }
  for (const x of [-0.6, -0.33, 0, 0.33, 0.6]) { const d = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.2), envDisp); d.position.set(x, -0.45, -1.18); envScene.add(d); }
  const deckMats = [...Object.values(MATS), ...Object.values(instMat), glassMat];
  function updateEnv(renderer, pmrem, sky, light) {
    const z = sky.skyApprox(), sunUp = THREE.MathUtils.smoothstep(sky.sunElev, -6, 12);
    envWin.color.setRGB(z.r * 3.2 + 0.6 * sunUp, z.g * 3.0 + 0.62 * sunUp, z.b * 2.6 + 0.66 * sunUp);
    envGnd.color.setRGB(0.12 * sunUp + 0.01, 0.12 * sunUp + 0.01, 0.11 * sunUp + 0.012);
    const wall = 0.05 + 0.32 * sunUp + light.dome * 0.35 + light.flood * 0.15; envRoomMat.color.setRGB(wall, wall * 0.98, wall * 0.95);
    envDisp.color.setRGB(0.05 * light.disp, 0.2 * light.disp, 0.35 * light.disp);
    const old = envRT; envRT = pmrem.fromScene(envScene, 0, 0.05, 20); for (const m of deckMats) m.envMap = envRT.texture; if (old) old.dispose();
  }

  // ======================================================= runtime
  const st = { last: {}, t: 0, rd: 0, chrono: null, ndRange: null, fcuDirty: 0 };
  const C = id => controls.find(c => c.id === id);
  const sysGet = (ctx, id) => { const s = ctx.sys.sw; if (id in s) return s[id]; return null; };
  function legendLights(c, ctx, test) {
    const s = ctx.sys, sw = s.sw, f = ctx.fdm, ap = f.ap, id = c.id, o = c.o; let top = OFFC, bot = OFFC;
    if (test && (o.top || o.bot)) return [o.top ? (o.top === 'FIRE' ? RED : o.top === 'BAR' ? GRN : o.top === 'AVAIL' ? GRN : o.top === 'ON' ? BLU : AMB) : OFFC, o.bot ? (o.bot === 'ON' ? BLU : o.bot === 'AVAIL' ? GRN : WHT) : OFFC];
    if (['bat1', 'bat2', 'gen1', 'gen2', 'apuGen', 'pack1', 'pack2', 'bleed1', 'bleed2', 'fuelL1', 'fuelL2', 'fuelC1', 'fuelC2', 'fuelR1', 'fuelR2', 'hyd1', 'hyd2', 'ptu', 'crewOxy', 'busTie'].includes(id)) bot = sw[id] ? OFFC : WHT;
    else if (id === 'fuelMode') bot = sw.fuelMode ? OFFC : WHT;
    else if (id === 'apuMaster' || id === 'apuBleed' || id === 'hydElec' || id === 'rainRpl') bot = sw[id] ? BLU : OFFC;
    else if (id === 'extPwr') { top = s.extAvail && !sw.extPwr ? GRN : OFFC; bot = sw.extPwr ? BLU : OFFC; }
    else if (id === 'apuStart') { top = sw.apuStart && !s.apuAvail ? BLU : OFFC; bot = s.apuAvail ? GRN : OFFC; }
    else if (id === 'fcuAp1') top = ap.on ? GRN : OFFC; else if (id === 'fcuAthr') top = ap.athr ? GRN : OFFC; else if (id === 'fcuLoc') top = (ap.lat === 'LOC' || ap.locArmed) && !ap.appr ? GRN : OFFC;
    else if (id === 'fcuAppr') top = ap.appr ? GRN : OFFC; else if (id.startsWith('fd')) top = GRN; else if (id.startsWith('ls')) top = ap.ils ? GRN : OFFC;
    else if (id.startsWith('mw')) { const on = ctx.warn === 'r' && (st.t * 2.5 % 1) < 0.6; top = bot = on ? RED : OFFC; } else if (id.startsWith('mc')) { const on = ctx.warn === 'a'; top = bot = on ? AMB : OFFC; }
    else if (id.startsWith('gl')) { const gp = f.gearPos; top = gp > 0.01 && gp < 0.99 ? RED : OFFC; bot = gp > 0.99 ? GRN : OFFC; }
    else if (id.startsWith('abrk')) bot = (f.autobrake === 1 && id === 'abrkLO') || (f.autobrake === 2 && id === 'abrkMED') || (f.autobrake === 3 && id === 'abrkMAX') ? BLU : OFFC;
    else if (id.startsWith('ecp') && id === 'ecpWHEEL') top = GRN; else if (id.startsWith('rmp') && id.endsWith('VHF1')) top = GRN;
    else if (id.startsWith('efis') || id.startsWith('ecp')) top = st.last['p_' + id] ? GRN : OFFC;
    return [top, bot];
  }
  function stateOf(c, ctx) {
    const sw = ctx.sys.sw, f = ctx.fdm;
    if (c.kind === 'tog') { const v = sw[c.id]; const pos = c.o.pos; if (typeof v === 'boolean') return v ? 0 : pos.length - 1; if (c.id === 'nose') return { 'TO': 0, 'TAXI': 1, 'OFF': 2 }[v] ?? 2; return Math.max(0, pos.indexOf(v)); }
    if (c.kind === 'rot') { if (c.id in sw) return Math.max(0, c.o.pos.indexOf(sw[c.id])); return st.last['r_' + c.id] ?? (c.id.startsWith('ndRange') ? 1 : c.id.startsWith('ndMode') ? 3 : 1); }
    if (c.kind === 'knob') { if (c.id in sw) return sw[c.id]; return st.last['k_' + c.id] ?? 0.5; }
    if (c.kind === 'pb') { if (c.id in sw) return sw[c.id] ? 1 : 0; return 0; }
    return 0;
  }
  const tmpM = new THREE.Matrix4();
  function refreshControls(ctx) {
    const test = ctx.sys.sw.annLt === 'TEST' && ctx.sys.dc; let legDirty = false, capDirty = false, togDirty = false, rotDirty = false, knobDirty = false;
    for (const c of controls) {
      if (c.kind === 'pb') {
        const [t, b] = legendLights(c, ctx, test); const i = c.li; if (aTop[i * 3] !== t[0] || aTop[i * 3 + 1] !== t[1] || aTop[i * 3 + 2] !== t[2] || aBot[i * 3] !== b[0] || aBot[i * 3 + 1] !== b[1] || aBot[i * 3 + 2] !== b[2]) { aTop.set(t, i * 3); aBot.set(b, i * 3); legDirty = true; }
        const pressed = (c.id in ctx.sys.sw && ctx.sys.sw[c.id] === true && ['bat1', 'bat2', 'gen1', 'gen2', 'apuGen', 'pack1', 'pack2', 'bleed1', 'bleed2', 'apuMaster', 'apuBleed', 'extPwr', 'hydElec'].includes(c.id)) || (st.press[c.id] > 0); const key = 'c_' + c.id;
        if (st.last[key] !== pressed) { st.last[key] = pressed; IM.cap.setMatrixAt(c.ci, mul(c.base.clone(), T(0, 0, pressed ? -0.003 : 0), S3((c.o.w || 0.028) / 0.028, (c.o.h || 0.024) / 0.024, 1))); legIM.setMatrixAt(c.li, mul(c.base.clone(), T(0, 0, (pressed ? -0.003 : 0) + 0.0122), S3((c.o.w || 0.028) / 0.028 * 0.92, (c.o.h || 0.024) / 0.024 * 0.9, 1))); capDirty = true; }
      } else if (c.kind === 'tog') { const s = stateOf(c, ctx); if (st.last['t_' + c.id] !== s) { st.last['t_' + c.id] = s; IM.tog.setMatrixAt(c.ti, mul(c.base.clone(), RX(-c.ang[s]))); togDirty = true; } }
      else if (c.kind === 'rot') { const s = stateOf(c, ctx); if (st.last['ro_' + c.id] !== s) { st.last['ro_' + c.id] = s; (c.big ? IM.knob : IM.rot).setMatrixAt(c.ri, mul(c.base.clone(), RZ(-c.ang[s]))); if (c.big) knobDirty = true; else rotDirty = true; } }
      else if (c.kind === 'knob') { const v = stateOf(c, ctx); if (st.last['kn_' + c.id] !== v) { st.last['kn_' + c.id] = v; IM.knob.setMatrixAt(c.ri, mul(c.base.clone(), RZ(-(-2.2 + 4.4 * (typeof v === 'number' ? v : 0.5))))); knobDirty = true; } }
    }
    if (legDirty) { topAttr.needsUpdate = botAttr.needsUpdate = true; } if (capDirty) { IM.cap.instanceMatrix.needsUpdate = true; legIM.instanceMatrix.needsUpdate = true; }
    if (togDirty) IM.tog.instanceMatrix.needsUpdate = true; if (rotDirty && IM.rot) IM.rot.instanceMatrix.needsUpdate = true; if (knobDirty) IM.knob.instanceMatrix.needsUpdate = true;
  }
  st.press = {};
  // ---------- dynamic canvases
  function drawFcu(ctx) {
    const c = fcuCv.getContext('2d'), ap = ctx.fdm.ap, on = ctx.sys.ac; c.fillStyle = '#0a0806'; c.fillRect(0, 0, 1024, 96); if (!on) { st.fcuTex.needsUpdate = true; return; }
    const col = '#ff9b2f'; const vs = ap.vert === 'V/S' ? (ap.vs >= 0 ? '+' : '-') + String(Math.abs(Math.round(ap.vs / 100))).padStart(2, '0') + 'oo' : '-----';
    seg7(c, ap.athr || ap.spd ? String(Math.round(ap.spd)).padStart(3, ' ') : '---', 50, 18, 60, col); if (!ap.athr) { c.fillStyle = col; c.beginPath(); c.arc(220, 48, 9, 0, 7); c.fill(); }
    seg7(c, String(Math.round(ap.hdg) % 360).padStart(3, '0'), 306, 18, 60, col); seg7(c, String(Math.round(ap.alt)).padStart(5, '0'), 530, 18, 60, col);
    c.fillStyle = col; c.font = '700 26px "B612 Mono", monospace'; c.fillText(ap.vert === 'ALT' ? '●' : '', 750, 60); seg7(c, vs.replace('+', ' '), 790, 18, 60, col); if (ap.vert === 'V/S' && ap.vs >= 0) { c.fillRect(784, 44, 26, 7); c.fillRect(793, 35, 7, 25); } else if (ap.vert === 'V/S') c.fillRect(784, 44, 26, 7);
    st.fcuTex.needsUpdate = true;
  }
  function drawRmp(ctx) { const c = rmpCv.getContext('2d'); c.fillStyle = '#060707'; c.fillRect(0, 0, 512, 64); if (ctx.sys.dc) { const a = ctx.freq || 118.7, sb = st.stby || 121.9; for (const [i, f] of [[0, a], [1, sb], [2, a], [3, sb]]) seg7(c, f.toFixed(3).slice(0, 7), 6 + i * 128, 14, 34, '#ffb24a', 6); } dynTex.get(rmpCv).t.needsUpdate = true; }
  function drawEfis(ctx) { const c = efisCv.getContext('2d'); c.fillStyle = '#060707'; c.fillRect(0, 0, 256, 64); if (ctx.sys.ac) for (const i of [0, 1]) seg7(c, '1013', 14 + i * 128, 12, 38, '#ffb24a', 6); dynTex.get(efisCv).t.needsUpdate = true; }
  function drawElec(ctx) { const c = elecCv.getContext('2d'); c.fillStyle = '#060707'; c.fillRect(0, 0, 256, 48); const s = ctx.sys.sw; for (const [i, on] of [[0, s.bat1], [1, s.bat2]]) if (on || ctx.sys.ac) seg7(c, ctx.sys.ac ? '28.2' : '25.6', 18 + i * 128, 8, 30, '#ffb24a', 5); dynTex.get(elecCv).t.needsUpdate = true; }
  function drawMcdu(ctx) {
    const c = mcduCv.getContext('2d'); c.fillStyle = '#020403'; c.fillRect(0, 0, 512, 384); if (!ctx.sys.ac) { dynTex.get(mcduCv).t.needsUpdate = true; return; }
    for (const [i, x0] of [[0, 0], [1, 256]]) {
      c.save(); c.translate(x0, 0); c.font = '700 19px "B612 Mono", monospace'; c.textAlign = 'center'; c.fillStyle = '#f2f2f2'; const r = ctx.route || {};
      if (i === 0) { c.fillText(`${r.o || 'KTPA'}/${r.d || 'KMIA'}  F-PLN`, 128, 26); const wps = r.wps || ['RWY', 'TBAY', 'SRQ', 'FMY', 'EVGL', 'DADE']; c.textAlign = 'left';
        wps.slice(0, 6).forEach((w, k) => { c.fillStyle = k === 0 ? '#f2f2f2' : '#3dfc7c'; c.font = '700 18px "B612 Mono", monospace'; c.fillText(String(w).slice(0, 7), 12, 70 + k * 46); c.fillStyle = '#3ee6ff'; c.font = '16px "B612 Mono", monospace'; c.fillText(k ? `${240 + k * 10}/ FL${String(Math.round((r.alt || 9000) / 100)).padStart(3, '0')}` : '', 120, 70 + k * 46); });
        c.fillStyle = '#f2f2f2'; c.fillText('DEST   TIME  DIST  EFOB', 12, 360); }
      else { c.fillText('PERF TAKE OFF', 128, 26); c.textAlign = 'left'; const sp = ctx.fdm.speeds(); [['V1', Math.round(sp.v2 - 6)], ['VR', Math.round(sp.v2 - 3)], ['V2', Math.round(sp.v2)], ['FLAPS/THS', '1/UP0.5'], ['FLEX TO TEMP', '54°'], ['TRANS ALT', '18000']].forEach(([k, v], j) => { c.fillStyle = '#f2f2f2'; c.font = '15px "B612 Mono", monospace'; c.fillText(k, 12, 58 + j * 50); c.fillStyle = '#3ee6ff'; c.font = '700 20px "B612 Mono", monospace'; c.fillText(String(v), 12, 80 + j * 50); }); }
      c.restore();
    }
    dynTex.get(mcduCv).t.needsUpdate = true;
  }
  function drawIsis(S) {
    const c = isisCv.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, 160, 160); if (!S) return; const e = S.e;
    c.save(); c.beginPath(); c.rect(28, 20, 104, 120); c.clip(); c.translate(80, 80); c.rotate(-e.bank * Math.PI / 180); c.translate(0, e.pitch * 3); c.fillStyle = '#1d6fd1'; c.fillRect(-150, -300, 300, 300); c.fillStyle = '#8a5a2b'; c.fillRect(-150, 0, 300, 300); c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(-150, 0); c.lineTo(150, 0); c.stroke();
    for (const p of [-10, 10]) { c.beginPath(); c.moveTo(-14, -p * 3); c.lineTo(14, -p * 3); c.stroke(); } c.restore();
    c.strokeStyle = '#ffe600'; c.lineWidth = 4; c.beginPath(); c.moveTo(48, 80); c.lineTo(70, 80); c.moveTo(90, 80); c.lineTo(112, 80); c.stroke();
    c.fillStyle = '#000'; c.fillRect(0, 0, 28, 160); c.fillRect(132, 0, 28, 160); c.fillStyle = '#fff'; c.font = '700 13px "B612 Mono", monospace'; c.textAlign = 'center'; c.fillText(Math.round(S.fdm.ias), 14, 84); c.fillText(Math.round(S.altFt / 10) * 10 > 9999 ? Math.round(S.altFt / 100) : Math.round(S.altFt / 10) * 10, 146, 84);
    c.fillStyle = '#3dfc7c'; c.font = '11px "B612 Mono", monospace'; c.fillText(Math.round(S.e.hdg).toString().padStart(3, '0'), 80, 154);
  }
  function drawClock(tod, t) {
    const c = clockCv.getContext('2d'); c.fillStyle = '#111316'; c.fillRect(0, 0, 160, 160); c.translate(80, 80); c.strokeStyle = '#e8e8e8';
    for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2, r0 = i % 5 ? 64 : 58; c.lineWidth = i % 5 ? 1.5 : 3.5; c.beginPath(); c.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0); c.lineTo(Math.sin(a) * 70, -Math.cos(a) * 70); c.stroke(); }
    c.fillStyle = '#060707'; c.fillRect(-36, 14, 72, 24); seg7(c, String(Math.floor(tod / 60) % 24).padStart(2, '0') + String(Math.floor(tod % 60)).padStart(2, '0'), -31, 18, 16, '#ff9b2f', 3);
    const ch = st.chrono != null ? (t - st.chrono) : 0; const a = (ch % 60) / 60 * Math.PI * 2; c.strokeStyle = '#ffffff'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.sin(a) * 60, -Math.cos(a) * 60); c.stroke(); c.fillStyle = '#ccc'; c.beginPath(); c.arc(0, 0, 5, 0, 7); c.fill();
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
  st.fcuTex = dynTex.get(fcuCv).t;
  const isisS = screens.find(s => s.kind === 'isis'), clockS = screens.find(s => s.kind === 'clock');
  // ---------- per-frame update
  const vTmp = new THREE.Vector3();
  function update(dt, ctx) {
    st.t += dt; const f = ctx.fdm, sys = ctx.sys, sw = sys.sw, night = ctx.night;
    // levers
    const rev = f.reverser > 0.05; thr.forEach(l => { l.rotation.x = rev ? 0.32 + 0.12 * f.tl * f.reverser : 0.06 - 0.5 * f.tl; });
    sbrk.rotation.x = -0.3 + 0.55 * Math.max(f.speedbrake, f.groundSpoilers); sbrk.position.y = f.spoilersArmed ? 0.21 : 0.2;
    flap.rotation.x = [-0.35, -0.18, 0, 0.17, 0.32][f.flapIdx] ?? 0; trimW.forEach(w => { w.rotation.x = (f.law === 'direct' ? f.trim : (f.trimDisp || 0)) * 0.9; });
    gearPiv.userData.lever.position.y += ((f.gearDown ? -0.06 : 0.065) - gearPiv.userData.lever.position.y) * Math.min(1, dt * 8); gearPiv.updateMatrixWorld(true);
    parkK.rotation.z = f.parkBrake ? -Math.PI / 2 : 0;
    const inp = ctx.inp || { pitch: 0, roll: 0 }; sticks.forEach(s => { s.rotation.x += ((-inp.pitch) * 0.28 - s.rotation.x) * Math.min(1, dt * 12); s.rotation.z += ((-inp.roll) * 0.28 - s.rotation.z) * Math.min(1, dt * 12); });
    tillers.forEach(t => { t.rotation.y = -(f.steer || 0) * 1.2; });
    // wipers
    const wspd = sw.wipers === 'FAST' ? 2.6 : sw.wipers === 'SLOW' ? 1.4 : 0; st.wph = (st.wph || 0) + dt * wspd; wipers.forEach(w => { const target = wspd ? (0.5 - 0.5 * Math.cos(st.wph * Math.PI)) * 1.35 : 0; w.arm.rotation.z += ((w.sd < 0 ? 1 : -1) * target - w.arm.rotation.z) * Math.min(1, dt * (wspd ? 30 : 3)); });
    for (const k in st.press) st.press[k] -= dt;
    refreshControls(ctx);
    // power & lighting
    const ac = sys.ac, dc = sys.dc; const dispK = ac ? Math.min(1.2, 0.75 / ctx.exposure + 0.1) : 0;
    for (const m of screenMats) m.color.setScalar(dispK); if (clockS) clockS.mat.color.setScalar(Math.min(1.2, 0.62 / ctx.exposure + 0.15));
    legMat.uniforms.uPow.value = dc ? (sw.annLt === 'DIM' ? 0.35 : 1) * (night > 0.5 ? 0.55 : 1) : 0; legMat.uniforms.uDay.value = THREE.MathUtils.clamp(1.6 / ctx.exposure * 0.55, 0.15, 1.2) * (0.4 + 0.6 * (1 - night)) + sw.integ * dc * 0.9;
    const integ = (dc ? sw.integ : 0) * 0.55; for (const k in atlasMat) atlasMat[k].emissiveIntensity = integ;
    const dome = dc ? { OFF: 0, DIM: 0.35, BRT: 1 }[sw.dome] : 0; const flood = dc ? sw.floodMain : 0, ped = dc ? sw.floodPed : 0;
    const cam = ctx.camera; const vm = cam.matrixWorldInverse;
    FL_LOCAL.forEach((p, i) => { vTmp.copy(p); g.localToWorld(vTmp); vTmp.applyMatrix4(vm); FLOOD.p[i].set(vTmp.x, vTmp.y, vTmp.z, FL_FALL[i]); });
    FLOOD.c[0].set(1.0, 0.9, 0.76).multiplyScalar(1.5 * dome); FLOOD.c[1].set(1.0, 0.92, 0.8).multiplyScalar(1.1 * flood); FLOOD.c[2].copy(FLOOD.c[1]); FLOOD.c[3].set(1.0, 0.92, 0.8).multiplyScalar(0.9 * ped + (dc ? sw.console : 0) * 0.35);
    const spill = ac ? 0.05 * night : 0; FLOOD.c[4].set(0.4, 0.62, 0.85).multiplyScalar(spill); FLOOD.c[5].copy(FLOOD.c[4]);
    st.light = { dome, flood, disp: ac ? 1 : 0 };
    // readouts (throttled)
    st.rd += dt; if (st.rd > 0.25) { st.rd = 0; st.k = (st.k || 0) + 1; drawFcu(ctx); if (st.k % 2 === 0) drawEfis(ctx); if (st.k % 4 === 0) { drawRmp(ctx); drawElec(ctx); drawClock(ctx.tod, st.t); clockS.mat.map.needsUpdate = true; } if (st.k % 12 === 1) drawMcdu(ctx); if (ac && ctx.S) { drawIsis(ctx.S); isisS.mat.map.needsUpdate = true; } }
  }
  // ---------- interaction
  const desc = (c, ctx) => {
    if (c.id === 'gear') return 'Landing gear lever: ' + (ctx.fdm.gearDown ? 'DOWN' : 'UP') + ' (click to move)';
    if (c.id === 'park') return 'Parking brake: ' + (ctx.fdm.parkBrake ? 'ON' : 'OFF') + ' (click to toggle)';
    const sw = ctx.sys.sw; let s = '';
    if (c.kind === 'tog' || c.kind === 'rot') s = c.o.pos[stateOf(c, ctx)];
    else if (c.kind === 'knob') { const v = stateOf(c, ctx); s = typeof v === 'number' ? Math.round(v * 100) + '%' : ''; }
    else if (c.kind === 'pb' && c.id in sw) s = sw[c.id] ? 'ON' : 'OFF';
    if (c.id === 'apuStart') s = ctx.sys.apuAvail ? 'AVAIL' : sw.apuStart ? `STARTING ${Math.round(ctx.sys.apuN)}%` : 'press to start (MASTER SW first)';
    if (c.id === 'extPwr') s = ctx.sys.extAvail ? (sw.extPwr ? 'ON' : 'AVAIL') : 'not available (no ground power)';
    if (c.id.startsWith('fcu')) s = { fcuSpd: 'scroll to set speed, click to select', fcuHdg: 'scroll to set heading, click to select', fcuAlt: 'scroll to set altitude, click to level off', fcuVs: 'scroll to set V/S' }[c.id] || 'click';
    return `${c.label}${s ? ': ' + s : ''}`;
  };
  function click(c, ctx, dir = 1, byWheel = false) {
    const sw = ctx.sys.sw, A = ctx.actions || {}; ctx.sys.touched[c.id] = true; st.press[c.id] = 0.25;
    if (c.id === 'gear') return A.gear && A.gear(); if (c.id === 'park') return A.park && A.park();
    if (c.kind === 'tog' || c.kind === 'rot') {
      const n = c.o.pos.length; let s = stateOf(c, ctx); s = c.kind === 'tog' ? (s + (dir > 0 ? 1 : -1) + n) % n : byWheel ? THREE.MathUtils.clamp(s + dir, 0, n - 1) : (s + dir + n) % n;
      if (c.id in sw) { const cur = sw[c.id]; const v = c.o.pos[s]; sw[c.id] = typeof cur === 'boolean' ? s === 0 : c.id === 'nose' ? ['TO', 'TAXI', 'OFF'][s] : v; }
      else st.last['r_' + c.id] = s;
      if (c.id === 'belts' || c.id === 'smoke') A.signs && A.signs(sw.belts, sw.smoke);
      if (c.id.startsWith('ndRange')) A.ndRange && A.ndRange([10, 20, 40, 80, 160][s]);
      A.sound && A.sound('switch'); return;
    }
    if (c.kind === 'knob') {
      if (c.id.startsWith('fcu')) return A.fcuPush && A.fcuPush(c.id, dir);
      const v = stateOf(c, ctx); const nv = typeof v === 'number' ? (byWheel ? THREE.MathUtils.clamp(Math.round(v * 8 + dir) / 8, 0, 1) : ((Math.round(v * 4) + (dir > 0 ? 1 : -1) + 5) % 5) / 4) : 0.5; if (c.id in sw) sw[c.id] = nv; else st.last['k_' + c.id] = nv; A.sound && A.sound('knob'); return;
    }
    if (c.kind === 'pb') {
      A.sound && A.sound('pb');
      if (c.id in sw && typeof sw[c.id] === 'boolean') { if (c.id === 'apuStart') { if (sw.apuMaster) sw.apuStart = true; return; } if (c.id === 'extPwr' && !ctx.sys.extAvail) return A.toast && A.toast('No ground power connected'); sw[c.id] = !sw[c.id]; return; }
      if (c.id === 'fcuAp1' || c.id === 'fcuAp2') return A.ap && A.ap(); if (c.id === 'fcuAthr') return A.athr && A.athr(); if (c.id === 'fcuAppr' || c.id === 'fcuLoc') return A.appr && A.appr();
      if (c.id.startsWith('abrk')) return A.autobrake && A.autobrake({ abrkLO: 1, abrkMED: 2, abrkMAX: 3 }[c.id]);
      if (c.id === 'callAll') return A.callCabin && A.callCabin(); if (c.id.startsWith('fire')) return A.toast && A.toast('Fire pushbuttons are guarded. No fire today.');
      if (c.id.startsWith('mw') || c.id.startsWith('mc')) return A.silence && A.silence();
      if (c.id.startsWith('xfr') && c.id.length === 4) { const a = ctx.freq, b = st.stby || 121.9; st.stby = a; return A.swapFreq && A.swapFreq(b); }
      if (c.id.startsWith('efis') || c.id.startsWith('ecp')) st.last['p_' + c.id] = !st.last['p_' + c.id];
    }
  }
  function wheel(c, ctx, d) { const A = ctx.actions || {}; if (c.id.startsWith('fcu') && c.kind === 'knob') { A.fcuTurn && A.fcuTurn(c.id, d); return true; } if (c.kind === 'knob' || c.kind === 'rot') { click(c, ctx, d, true); return true; } return false; }
  function setDoor(open) { door.rotation.y = open ? 1.35 : 0; }
  // hide/show deck detail (performance: nothing to draw when not in the flight deck)
  g.userData = { screens: screenMats, controls, hit: hitIM, update, click, wheel, desc, updateEnv, setDoor, light: () => st.light || { dome: 0, flood: 0, disp: 1 }, mats: deckMats, merged, chrono: t => { st.chrono = st.chrono == null ? t : null; } };
  g.visible = false;
  return g;
}
function mergeG(list) { const out = list.map(gg => { const n = gg.index ? gg.toNonIndexed() : gg.clone(); return n; }); const keys = Object.keys(out[0].attributes); for (const o of out) for (const k of Object.keys(o.attributes)) if (!keys.includes(k)) o.deleteAttribute(k); for (const o of out) for (const k of keys) if (!o.attributes[k]) { const sz = out[0].attributes[k].itemSize; o.setAttribute(k, new THREE.BufferAttribute(new Float32Array(o.attributes.position.count * sz).fill(1), sz)); } return mergeGeometries(out); }
