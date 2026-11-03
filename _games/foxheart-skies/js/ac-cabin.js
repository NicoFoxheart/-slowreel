// Foxheart narrow-body PASSENGER CABIN shell (body frame, floor y = -0.55): sculpted sidewalls with deep window reveals
// and shades, overhead bins with door seams, latches and PSUs (reading lights, gaspers), a cove-lit arched ceiling, carpet
// with an aisle runner and floor-path lights, fabric seats with headrest covers, armrests and seatback IFE screens,
// galleys with trolleys, lavatory doors, bulkheads, exit signs. One procedural atlas (colour + normal + gloss) and one
// baked-light shader: AO baked per vertex; overhead wash, cove mood light (cool for boarding, warm at night) and window
// daylight are shader terms; exposure via setK(k). People, walk zones and signs stay in interiors.js (buildCabin).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ATM } from './sky.js';
import { canvas, tex, heightToNormal, roundRect, rng, clamp, smooth, lerp, V3, mergeAll, pchip } from './ac-util.js';
import { WINDOWS, WIN_Y, EXITS } from './ac-shape.js';
import { foxHeart } from './ac-livery.js';

const PI = Math.PI;
// ================================================================ atlas: 4 x 4 tiles of T px (colour, height -> normal, gloss -> normal alpha)
const NAMES = ['carpet', 'runner', 'fabric', 'headrest', 'plastic', 'ceiling', 'dado', 'shell', 'screen', 'bin', 'psu', 'alu', 'trolley', 'lav', 'bulk', 'misc'];
export const TILE = {}; NAMES.forEach((n, i) => { const c = i % 4, r = (i / 4) | 0; TILE[n] = [c / 4, 1 - (r + 1) / 4, 0.25, 0.25]; });
// sub-tiles of 'misc': light (white), dark, exit sign, red
const sub = (n, qx, qy) => { const t = TILE[n]; return [t[0] + qx * t[2] / 2, t[1] + (1 - qy) * t[3] / 2, t[2] / 2, t[3] / 2]; };
TILE.light = sub('misc', 0, 0); TILE.dark = sub('misc', 1, 0); TILE.exit = sub('misc', 0, 1); TILE.red = sub('misc', 1, 1);

function paintAtlas(T = 512) {
  const S = T * 4, C = canvas(S).c, H = canvas(S).c, G = canvas(S).c, R = rng(31);
  H.fillStyle = 'rgb(128,128,128)'; H.fillRect(0, 0, S, S); G.fillStyle = 'rgb(60,60,60)'; G.fillRect(0, 0, S, S);
  const at = (name, f) => { const i = NAMES.indexOf(name), x = (i % 4) * T, y = ((i / 4) | 0) * T; for (const c of [C, H, G]) { c.save(); c.translate(x, y); c.beginPath(); c.rect(0, 0, T, T); c.clip(); } f(T); for (const c of [C, H, G]) c.restore(); };
  const fill = (c, col, x = 0, y = 0, w = T, h = T) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  const grey = v => `rgb(${v | 0},${v | 0},${v | 0})`;
  const noise = (n, a, s, col = () => R() < 0.5 ? '#000' : '#fff', ctx = C) => { ctx.save(); ctx.globalAlpha = a; for (let i = 0; i < n; i++) { ctx.fillStyle = col(); ctx.fillRect(R() * T, R() * T, s * (0.5 + R()), s * (0.5 + R())); } ctx.restore(); };
  const hnoise = (n, amp, s) => { for (let i = 0; i < n; i++) { H.fillStyle = grey(128 + (R() - 0.5) * amp); H.fillRect(R() * T, R() * T, s, s); } };
  // carpet: navy-grey loop pile with a small diamond motif
  at('carpet', T => { fill(C, '#38445a'); fill(G, grey(15)); for (let y = 0; y < T; y += 32) for (let x = (y / 32) % 2 ? 16 : 0; x < T; x += 32) { C.fillStyle = 'rgba(120,140,175,0.22)'; C.beginPath(); C.moveTo(x, y - 5); C.lineTo(x + 5, y); C.lineTo(x, y + 5); C.lineTo(x - 5, y); C.fill(); C.fillStyle = 'rgba(232,115,47,0.25)'; C.fillRect(x - 1, y - 1, 2, 2); }
    noise(9000, 0.18, 2); hnoise(14000, 90, 2); });
  // aisle runner: darker pile, orange edge stripes along v (z)
  at('runner', T => { fill(C, '#2b3446'); fill(G, grey(15)); noise(9000, 0.18, 2); hnoise(14000, 90, 2); for (const x of [T * 0.04, T * 0.93]) { fill(C, '#b8642e', x, 0, T * 0.03, T); } });
  // seat fabric: navy twill with a fine orange pinstripe
  at('fabric', T => { fill(C, '#22325a'); fill(G, grey(28)); for (let y = 0; y < T; y += 3) { C.fillStyle = y % 6 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)'; C.fillRect(0, y, T, 1.5); H.fillStyle = grey(y % 6 ? 160 : 96); H.fillRect(0, y, T, 1.5); }
    for (let x = 0; x < T; x += 4) { H.fillStyle = 'rgba(128,128,128,0.35)'; H.fillRect(x, 0, 1, T); } for (const x of [T * 0.3, T * 0.7]) fill(C, 'rgba(232,115,47,0.55)', x, 0, 2, T); noise(4000, 0.08, 2); });
  // headrest cover: cream linen + fox heart + wordmark
  at('headrest', T => { fill(C, '#ece5d4'); fill(G, grey(30)); for (let y = 0; y < T; y += 2) { H.fillStyle = grey(R() < 0.5 ? 140 : 116); H.fillRect(0, y, T, 1); } for (let x = 0; x < T; x += 2) { H.fillStyle = 'rgba(128,128,128,0.4)'; H.fillRect(x, 0, 1, T); }
    foxHeart(C, T * 0.5, T * 0.42, T * 0.13); C.fillStyle = '#1b2747'; C.font = `700 ${T * 0.075}px "Saira Condensed","Arial Narrow",sans-serif`; C.textAlign = 'center'; C.fillText('FOXHEART', T * 0.5, T * 0.72); noise(3000, 0.06, 2); });
  // wall plastic: warm white, fine texture, satin
  at('plastic', T => { fill(C, '#e9e6df'); fill(G, grey(120)); hnoise(14000, 9, 2); noise(2000, 0.012, 3); });
  // ceiling panel: white with a perforated speaker / air grille band and a panel seam at the tile edge
  at('ceiling', T => { fill(C, '#efeee9'); fill(G, grey(70)); hnoise(12000, 16, 2); fill(H, grey(40), 0, 0, T, 3); fill(C, 'rgba(60,60,60,0.35)', 0, 0, T, 2);
    for (let y = T * 0.35; y < T * 0.65; y += 7) for (let x = T * 0.44; x < T * 0.56; x += 7) { C.fillStyle = 'rgba(70,70,70,0.45)'; C.fillRect(x, y, 2.5, 2.5); H.fillStyle = grey(70); H.fillRect(x, y, 2.5, 2.5); } });
  // dado: grey, return-air grille slots at the bottom
  at('dado', T => { fill(C, '#a3a6a8'); fill(G, grey(90)); hnoise(8000, 20, 2); for (let x = 8; x < T - 8; x += 12) { fill(C, '#3c4045', x, T * 0.62, 6, T * 0.3); fill(H, grey(40), x, T * 0.62, 6, T * 0.3); } });
  // seat shell back: light grey, tray table outline + latch, literature pocket (mesh)
  at('shell', T => { fill(C, '#c7cacd'); fill(G, grey(130)); hnoise(8000, 14, 2);
    const g = (x, y, w, h, r) => { for (const [c, st] of [[H, grey(50)], [C, 'rgba(40,44,50,0.4)']]) { c.strokeStyle = st; c.lineWidth = 3; roundRect(c, x, y, w, h, r); c.stroke(); } };
    g(T * 0.1, T * 0.42, T * 0.8, T * 0.3, 14); fill(C, '#5a5f66', T * 0.45, T * 0.44, T * 0.1, T * 0.03); fill(C, '#2a2e35', T * 0.08, T * 0.76, T * 0.84, T * 0.2); for (let y = T * 0.77; y < T * 0.95; y += 4) for (let x = T * 0.09; x < T * 0.91; x += 4) { H.fillStyle = grey(R() < 0.5 ? 100 : 150); H.fillRect(x, y, 2, 2); } });
  // IFE screen: moving map
  at('screen', T => { const gr = C.createLinearGradient(0, 0, 0, T); gr.addColorStop(0, '#0b2a4a'); gr.addColorStop(1, '#0d4d6e'); C.fillStyle = gr; C.fillRect(0, 0, T, T); fill(G, grey(230));
    C.fillStyle = 'rgba(80,140,90,0.55)'; C.beginPath(); C.moveTo(0, T * 0.7); C.bezierCurveTo(T * 0.3, T * 0.55, T * 0.45, T * 0.85, T, T * 0.6); C.lineTo(T, T); C.lineTo(0, T); C.fill();
    C.strokeStyle = '#ffffff'; C.lineWidth = T * 0.012; C.setLineDash([T * 0.03, T * 0.02]); C.beginPath(); C.moveTo(T * 0.15, T * 0.75); C.quadraticCurveTo(T * 0.5, T * 0.2, T * 0.85, T * 0.55); C.stroke(); C.setLineDash([]);
    C.fillStyle = '#f29a4c'; C.beginPath(); C.arc(T * 0.47, T * 0.38, T * 0.03, 0, 7); C.fill(); C.fillStyle = 'rgba(0,0,0,0.45)'; C.fillRect(0, 0, T, T * 0.14); C.fillStyle = '#e8edf5'; C.font = `600 ${T * 0.06}px sans-serif`; C.fillText('FOXHEART SKIES  ·  4h 12m to go', T * 0.05, T * 0.09); });
  // bin door: white, subtle vertical texture, a slim lower trim line
  at('bin', T => { fill(C, '#ecebe6'); fill(G, grey(140)); hnoise(14000, 14, 2); fill(C, 'rgba(120,120,120,0.25)', 0, T * 0.9, T, 3); });
  // PSU: grey panel with vent grille, call button icons
  at('psu', T => { fill(C, '#d6d6d1'); fill(G, grey(100)); for (let x = T * 0.05; x < T * 0.95; x += 9) { fill(C, '#6f7378', x, T * 0.12, 4, T * 0.22); fill(H, grey(50), x, T * 0.12, 4, T * 0.22); } fill(C, '#4a76c8', T * 0.42, T * 0.6, T * 0.06, T * 0.06); fill(C, '#c8c8c0', T * 0.52, T * 0.6, T * 0.06, T * 0.06); });
  // brushed aluminium
  at('alu', T => { fill(C, '#b7bcc2'); fill(G, grey(200)); for (let i = 0; i < 2500; i++) { const y = R() * T, v = 150 + (R() - 0.5) * 60; C.fillStyle = `rgba(${v},${v + 4},${v + 8},0.25)`; C.fillRect(0, y, T, 1); H.fillStyle = grey(128 + (R() - 0.5) * 30); H.fillRect(0, y, T, 1); } });
  // galley trolley / compartment front: alu, handle, latch, label strip
  at('trolley', T => { fill(C, '#b3b8be'); fill(G, grey(190)); for (let i = 0; i < 1500; i++) { const y = R() * T; C.fillStyle = 'rgba(255,255,255,0.06)'; C.fillRect(0, y, T, 1); }
    for (const [c, st] of [[H, grey(40)], [C, 'rgba(40,40,40,0.5)']]) { c.strokeStyle = st; c.lineWidth = 4; roundRect(c, 6, 6, T - 12, T - 12, 10); c.stroke(); }
    fill(C, '#2b2f35', T * 0.3, T * 0.1, T * 0.4, T * 0.06); fill(H, grey(200), T * 0.3, T * 0.1, T * 0.4, T * 0.06); fill(C, '#d23a2a', T * 0.8, T * 0.11, T * 0.05, T * 0.04); fill(C, '#1b2747', T * 0.1, T * 0.8, T * 0.8, T * 0.08);
    C.fillStyle = '#f29a4c'; C.font = `700 ${T * 0.06}px sans-serif`; C.textAlign = 'center'; C.fillText('FOXHEART', T * 0.5, T * 0.86); });
  // lavatory door: bi-fold line, sign, vacant indicator, ashtray
  at('lav', T => { fill(C, '#e6e3dc'); fill(G, grey(120)); hnoise(8000, 14, 2); fill(H, grey(50), T * 0.5 - 2, 0, 4, T); fill(C, 'rgba(60,60,60,0.35)', T * 0.5 - 1, 0, 2, T);
    fill(C, '#3a3f46', T * 0.32, T * 0.12, T * 0.36, T * 0.1); C.fillStyle = '#f0f0f0'; C.font = `600 ${T * 0.04}px sans-serif`; C.textAlign = 'center'; C.fillText('LAVATORY', T * 0.5, T * 0.185); fill(C, '#3fae5a', T * 0.62, T * 0.45, T * 0.08, T * 0.03); fill(C, '#8f949a', T * 0.6, T * 0.52, T * 0.12, T * 0.03); fill(C, '#6b7078', T * 0.7, T * 0.5, T * 0.04, T * 0.12); });
  // bulkhead: plastic with the Foxheart wordmark + heart
  at('bulk', T => { const gr = C.createLinearGradient(0, 0, 0, T); gr.addColorStop(0, '#1b2747'); gr.addColorStop(1, '#24365e'); C.fillStyle = gr; C.fillRect(0, 0, T, T); fill(G, grey(120)); hnoise(8000, 12, 2);
    foxHeart(C, T * 0.5, T * 0.4, T * 0.16); C.fillStyle = '#f2efe8'; C.font = `700 ${T * 0.09}px "Saira Condensed","Arial Narrow",sans-serif`; C.textAlign = 'center'; C.fillText('FOXHEART', T * 0.5, T * 0.72); C.fillStyle = '#f29a4c'; C.font = `300 ${T * 0.05}px sans-serif`; C.fillText('SKIES', T * 0.5, T * 0.8); });
  // misc: light | dark ; exit sign | red
  at('misc', T => { const h = T / 2; fill(C, '#ffffff', 0, 0, h, h); fill(C, '#1c1e22', h, 0, h, h); fill(G, grey(60), h, 0, h, h); fill(C, '#13151a', 0, h, h, h); fill(C, '#c8281e', h, h, h, h);
    C.fillStyle = '#38e07a'; C.font = `800 ${h * 0.34}px "Saira Condensed",sans-serif`; C.textAlign = 'center'; C.textBaseline = 'middle'; C.fillText('EXIT', h * 0.5, h * 1.5); fill(G, grey(200), 0, h, h, h); });
  const map = tex(C.canvas); const nrm = tex(heightToNormal(H.canvas, 2.2, false, G.canvas), { srgb: false });
  for (const t of [map, nrm]) { t.anisotropy = 8; } return { map, nrm };
}

// ================================================================ shader: baked AO + mood / cove / window light
function cabinMaterial(A) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: A.map }, uNrm: { value: A.nrm }, uAmb: { value: new THREE.Color(1, 1, 1) }, uCove: { value: new THREE.Color(0.7, 0.85, 1.1) }, uWin: { value: new THREE.Color(0.3, 0.32, 0.35) }, uEmit: { value: new THREE.Color(1, 1, 1) }, uK: { value: 1 } },
    vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>
attribute vec4 aTile; attribute vec3 aAO; attribute vec2 aE; varying vec2 vUv; varying vec4 vTile; varying vec3 vAO; varying vec2 vE; varying vec3 vP; varying vec3 vN; varying vec3 vV;
void main(){ vec4 lp = vec4(position, 1.0); vec3 ln = normal;
#ifdef USE_INSTANCING
  lp = instanceMatrix * lp; ln = mat3(instanceMatrix) * ln;
#endif
  vP = lp.xyz; vN = ln; vUv = uv; vTile = aTile; vAO = aAO; vE = aE; vec4 wp = modelMatrix * lp; vV = transpose(mat3(modelMatrix)) * (cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
#include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>
uniform sampler2D uMap; uniform sampler2D uNrm; uniform vec3 uAmb; uniform vec3 uCove; uniform vec3 uWin; uniform vec3 uEmit; uniform float uK;
varying vec2 vUv; varying vec4 vTile; varying vec3 vAO; varying vec2 vE; varying vec3 vP; varying vec3 vN; varying vec3 vV;
void main(){
  vec2 g = vTile.zw * 0.96; vec2 tuv = vTile.xy + (0.02 + 0.96 * fract(vUv)) * vTile.zw; vec2 dx = dFdx(vUv) * g, dy = dFdy(vUv) * g;
  vec4 C = textureGrad(uMap, tuv, dx, dy); vec4 Nt = textureGrad(uNrm, tuv, dx, dy);
  vec3 n = normalize(vN);
  vec3 dp1 = dFdx(vP), dp2 = dFdy(vP); vec2 du1 = dFdx(vUv), du2 = dFdy(vUv);
  vec3 p2 = cross(dp2, n), p1 = cross(n, dp1); vec3 T = p2 * du1.x + p1 * du2.x, B = p2 * du1.y + p1 * du2.y; float det = max(dot(T, T), dot(B, B)); float sc = det == 0.0 ? 0.0 : inversesqrt(det);
  vec3 tn = Nt.xyz * 2.0 - 1.0; n = normalize(T * (tn.x * sc) + B * (tn.y * sc) + n * tn.z);
  float gloss = Nt.a; vec3 v = normalize(vV);
  vec3 L = uAmb * (0.5 + 0.5 * (n.y * 0.5 + 0.5));
  L += uCove * (smoothstep(1.2, 1.6, vP.y) * max(0.0, -n.y) * (0.35 + 1.1 * smoothstep(0.1, 1.2, abs(vP.x))) + 0.15 * smoothstep(0.8, 1.5, vP.y));
  float sd = sign(vP.x); L += uWin * (0.3 + 0.7 * max(0.0, n.x * sd)) * smoothstep(-0.45, 0.45, vP.y) * (0.5 + 0.5 * smoothstep(0.5, 1.7, abs(vP.x)));
  vec3 r = reflect(-v, n); float sp = pow(max(r.y, 0.0), 4.0 + gloss * 60.0) * gloss * gloss;
  vec3 col = C.rgb * vAO * L + sp * (uAmb * 0.5 + uCove * 0.3) * vAO;
  col += C.rgb * (vE.x * uEmit + vE.y * uWin * 1.6);
  gl_FragColor = vec4(col * uK, 1.0);
#include <logdepthbuf_fragment>
#include <tonemapping_fragment>
#include <colorspace_fragment>
}` });
  m.color = new THREE.Color(1, 1, 1); // main.js scales cabin.mat.color for exposure; the shell uses uK (setK) instead
  return m;
}

// ================================================================ geometry helpers
const _v = V3();
// collect parts: geometry + tile + uv scale (metres per repeat) + emission (self, window glow) + ao multiplier
class Parts {
  constructor(ao) { this.list = []; this.ao = ao; }
  add(g, tile, o = {}) { const n = g.index ? g.toNonIndexed() : g; if (!n.attributes.normal) n.computeVertexNormals(); const N = n.attributes.position.count;
    const T = new Float32Array(N * 4), A = new Float32Array(N * 3), E = new Float32Array(N * 2), P = n.attributes.position, Nn = n.attributes.normal, t = TILE[tile], k = o.ao ?? 1, e = o.e || [0, 0];
    for (let i = 0; i < N; i++) { T.set(t, i * 4); E.set(e, i * 2); const a = o.flat ? k : k * this.ao(_v.fromBufferAttribute(P, i), Nn.getY(i), Nn.getX(i)); A[i * 3] = A[i * 3 + 1] = A[i * 3 + 2] = a; }
    if (o.tint) for (let i = 0; i < N; i++) { A[i * 3] *= o.tint[0]; A[i * 3 + 1] *= o.tint[1]; A[i * 3 + 2] *= o.tint[2]; }
    n.setAttribute('aTile', new THREE.BufferAttribute(T, 4)); n.setAttribute('aAO', new THREE.BufferAttribute(A, 3)); n.setAttribute('aE', new THREE.BufferAttribute(E, 2));
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(N * 2), 2));
    if (o.uvScale) { const U = n.attributes.uv; for (let i = 0; i < U.count; i++) U.setXY(i, U.getX(i) * o.uvScale[0], U.getY(i) * o.uvScale[1]); }
    this.list.push(n); return n; }
  merge() { return mergeAll(this.list, ['position', 'normal', 'uv', 'aTile', 'aAO', 'aE']); }
}
function flipG(g) { const I = g.index.array; for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; } g.computeVertexNormals(); return g; }
// make faces point toward the cabin interior (or a custom target)
function inward(g, target = m => V3(0, 0.55, m.z)) {
  const P = g.attributes.position, I = g.index.array, a = V3(), b = V3(), c = V3(); let s = 0;
  for (let k = 0; k < I.length; k += 3) { a.fromBufferAttribute(P, I[k]); b.fromBufferAttribute(P, I[k + 1]); c.fromBufferAttribute(P, I[k + 2]); const n = b.clone().sub(a).cross(c.clone().sub(a)); const m = a.clone().add(b).add(c).multiplyScalar(1 / 3); s += n.dot(target(m).sub(m)); }
  return s < 0 ? flipG(g) : g;
}
// sheet over (rows x cols); pos(i, j), uv(i, j)
function sheet(rows, cols, pos, uv) {
  const P = [], U = [], I = []; for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const p = pos(i, j); P.push(p.x, p.y, p.z); U.push(...uv(i, j)); }
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; I.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals(); return g;
}
// loft a 2-D profile [[x, y], ...] (right side) along z; uv: u = arc length, v = z
function loft(prof, z0, z1, sd, target) {
  const L = [0]; for (let i = 1; i < prof.length; i++) L.push(L[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
  return inward(sheet(2, prof.length, (i, j) => V3(sd * prof[j][0], prof[j][1], i ? z1 : z0), (i, j) => [L[j], i ? z1 : z0]), target);
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const rbox = (w, h, d, r, x, y, z, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, r).translate(x, y, z);
function rrPts(w, h, r, n = 4) { const P = []; for (const [cx, cy, q] of [[w / 2 - r, h / 2 - r, 0], [-(w / 2 - r), h / 2 - r, 1], [-(w / 2 - r), -(h / 2 - r), 2], [w / 2 - r, -(h / 2 - r), 3]]) for (let k = 0; k <= n; k++) { const a = (q + k / n) * PI / 2; P.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return P; }

// ================================================================ the seat (one instance; occupant faces -z, back at +z, floor at y = 0)
function seatGeometry(hi) {
  const P = new Parts(() => 1); const seg = hi ? 2 : 1;
  const back = (g, ang = 0.17, pivotY = 0.47, pivotZ = 0.2) => g.translate(0, -pivotY, -pivotZ).rotateX(ang).translate(0, pivotY, pivotZ);
  P.add(rbox(0.45, 0.12, 0.47, 0.045, 0, 0.405, -0.02, seg), 'fabric', { uvScale: [1.4, 1.4], ao: 0.95 });                           // cushion
  P.add(rbox(0.45, 0.06, 0.5, 0.02, 0, 0.33, -0.01, 1), 'shell', { ao: 0.7 });                                                    // pan
  P.add(back(rbox(0.45, 0.76, 0.12, 0.05, 0, 0.85, 0.22, seg)), 'fabric', { uvScale: [1.4, 1.4] });                             // backrest
  P.add(back(rbox(0.47, 0.8, 0.05, 0.02, 0, 0.84, 0.295, 1)), 'shell', { uvScale: [1, 1] });                                       // back shell
  P.add(back(new THREE.PlaneGeometry(0.38, 0.2).rotateY(PI).translate(0, 1.1, 0.155)), 'headrest', { ao: 1.05 });                  // headrest cover (faces -z)
  P.add(back(new THREE.PlaneGeometry(0.25, 0.16).translate(0, 0.98, 0.3235)), 'screen', { e: [0.85, 0], flat: true, ao: 0.35 });     // IFE (faces +z)
  P.add(back(rbox(0.27, 0.19, 0.012, 0.005, 0, 0.98, 0.317, 1)), 'dark', { ao: 0.8 });                                            // IFE bezel
  P.add(back(rbox(0.4, 0.27, 0.025, 0.01, 0, 0.66, 0.325, 1)), 'shell', { ao: 0.92 });                                            // tray table
  for (const x of [-0.245, 0.245]) { P.add(box(0.05, 0.05, 0.44, x, 0.62, 0.03), 'dark'); P.add(box(0.03, 0.2, 0.06, x, 0.5, 0.18), 'dark', { ao: 0.8 }); }
  for (const x of [-0.17, 0.17]) { P.add(box(0.035, 0.32, 0.05, x, 0.16, -0.18), 'alu', { ao: 0.75 }); P.add(box(0.035, 0.32, 0.05, x, 0.16, 0.2), 'alu', { ao: 0.75 }); P.add(box(0.03, 0.03, 0.46, x, 0.02, 0.01), 'alu', { ao: 0.7 }); }
  P.add(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 8).rotateZ(PI / 2).translate(0, 0.3, -0.12), 'alu', { ao: 0.8 });
  P.add(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 8).rotateZ(PI / 2).translate(0, 0.3, 0.16), 'alu', { ao: 0.8 });
  // AO toward the floor
  const g = P.merge(); const pos = g.attributes.position, A = g.attributes.aAO; for (let i = 0; i < pos.count; i++) { const k = 0.55 + 0.45 * smooth(0, 0.45, pos.getY(i)); A.setXYZ(i, A.getX(i) * k, A.getY(i) * k, A.getZ(i) * k); }
  return g;
}

// ================================================================ build
export function buildCabinShell(o) {
  const { seats, rnd = Math.random, floor: FL = -0.55, rows = 29, pitch = 0.79, z0: R0 = -10.6, quality = 'high' } = o;
  const hi = quality !== 'low';
  const A = paintAtlas(hi ? 512 : 256), mat = cabinMaterial(A);
  const group = new THREE.Group(); group.name = 'cabinShell';
  const ZF = -14.2, ZA = 12.4, ZS0 = -12.55, ZS1 = 11.15; // walls; sidewall run between the door zones
  const ao = (p, ny, nx) => { let a = 0.6 + 0.4 * smooth(FL, FL + 0.45, p.y); if (p.y > 0.55 && p.y < 1.05 && Math.abs(p.x) > 1.5) a *= 0.86 + 0.14 * smooth(1.05, 0.55, p.y); if (ny < -0.6 && p.y < 1.2 && p.y > 0.8) a *= 0.85; if (p.y > 1.5) a *= 0.97; return a; };
  const P = new Parts(ao);
  // ---------------- lining profile (right side)
  const BAND0 = 0.12, BAND1 = 0.7;
  const X = pchip([[-0.28, 1.80], [-0.05, 1.82], [BAND0, 1.835], [0.3, 1.842], [0.5, 1.828], [BAND1, 1.79], [0.86, 1.745], [0.98, 1.69], [1.03, 1.66]]);
  const dX = y => (X(y + 1e-3) - X(y - 1e-3)) / 2e-3;
  const DADO = [[1.80, FL], [1.80, -0.28]], LO = [[1.80, -0.28], [X(-0.05), -0.05], [X(BAND0), BAND0]], HI = [[X(BAND1), BAND1], [X(0.86), 0.86], [X(0.98), 0.98], [1.66, 1.03]];
  const UNDER = [[1.66, 1.03], [1.4, 1.045], [1.12, 1.06]], FRONT = [[1.12, 1.06], [1.085, 1.11], [1.062, 1.2], [1.064, 1.3], [1.085, 1.4], [1.13, 1.47], [1.19, 1.51]];
  const LIP = [[1.19, 1.51], [1.15, 1.532], [1.168, 1.548]], COVE = [[1.168, 1.548], [1.26, 1.562]];
  const CEIL = []; for (let k = 0; k <= (hi ? 10 : 5); k++) { const x = 1.26 * (1 - k / (hi ? 10 : 5)); CEIL.push([x, 1.56 + 0.13 * (1 - (x / 1.26) ** 2)]); }
  for (const sd of [1, -1]) {
    for (const [za, zb] of sd < 0 ? [[ZF, -13.43], [-12.57, ZA]] : [[ZF, ZA]]) P.add(loft(DADO, za, zb, sd), 'dado', { uvScale: [1 / 0.27, 1 / 0.5] });
    P.add(loft(LO, ZS0, ZS1, sd), 'plastic'); P.add(loft(HI, ZS0, ZS1, sd), 'plastic');
    P.add(loft(UNDER, ZF + 0.5, ZA - 0.3, sd), 'psu', { uvScale: [1 / 0.55, 1 / 0.79], ao: 0.92 });
    P.add(loft(LIP, ZF + 0.5, ZA - 0.3, sd), 'bin', { uvScale: [4, 1] }); P.add(loft(COVE, ZF + 0.5, ZA - 0.3, sd), 'light', { e: [1.1, 0], flat: true, ao: 1 });
    P.add(loft(CEIL, ZF, ZA, sd), 'ceiling', { uvScale: [1 / 2.6, 1 / (2 * pitch)] });
    // bins: dark backing + door fronts with seams, latches
    P.add(loft(FRONT.map(([x, y]) => [x + 0.012, y]), ZF + 0.5, ZA - 0.3, sd), 'dark', { ao: 0.5 });
    for (let z = R0 - 0.6 - 4 * pitch; z < ZA - 0.4; z += 2 * pitch) { const za = Math.max(ZF + 0.5, z) + 0.004, zb = Math.min(ZA - 0.3, z + 2 * pitch) - 0.004; if (zb - za < 0.2) continue;
      P.add(loft(FRONT, za, zb, sd), 'bin', { uvScale: [1 / 0.5, 1 / (2 * pitch)] });
      const zc = (za + zb) / 2; P.add(rbox(0.035, 0.03, 0.2, 0.01, sd * 1.075, 1.112, zc, 1), 'dark', { ao: 0.9 }); P.add(box(0.006, 0.012, 0.15, sd * 1.058, 1.112, zc), 'alu', { flat: true, ao: 1.1 }); }
    // window band: one bay per window (rounded hole), plain bays at the ends; reveals + shades
    const wins = WINDOWS.filter(w => w.side === sd).sort((a, b) => a.z - b.z), hole = rrPts(0.26, 0.37, 0.1, hi ? 4 : 2);
    const mapBand = (g) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const z = p.getX(i), y = p.getY(i); p.setXYZ(i, sd * X(y), y, z); } g.computeVertexNormals(); return inward(g); };
    const bay = (za, zb, w) => { const s = new THREE.Shape(); s.moveTo(za, BAND0); s.lineTo(zb, BAND0); s.lineTo(zb, BAND1); s.lineTo(za, BAND1); s.lineTo(za, BAND0);
      if (w) s.holes.push(new THREE.Path(hole.map(([a, b]) => new THREE.Vector2(w.z + a, WIN_Y + b))));
      const g = new THREE.ShapeGeometry(s, 2); const U = g.attributes.uv, p = g.attributes.position; for (let i = 0; i < U.count; i++) U.setXY(i, p.getX(i), p.getY(i)); P.add(mapBand(g), 'plastic'); };
    bay(ZS0, wins[0].z - 0.2675); for (const w of wins) bay(w.z - 0.2675, w.z + 0.2675, w); bay(wins[wins.length - 1].z + 0.2675, ZS1);
    for (const w of wins) {
      const ring = (sc, xAt) => hole.map(([a, b]) => { const y = WIN_Y + b * sc; return V3(sd * xAt(y), y, w.z + a * sc); });
      const inner = ring(1, X), outer = ring(0.86, () => 1.915); const n = hole.length;
      const g = sheet(2, n + 1, (i, j) => (i ? outer : inner)[j % n], (i, j) => [j / n * 1.0, i * 0.12]); P.add(inward(g, m => V3(sd * 1.85, WIN_Y, w.z)), 'plastic', { ao: 0.82 });
      // shade: pulled down by a random amount (a few closed)
      const r = rnd(), f = r < 0.62 ? 0.04 : r < 0.85 ? 0.35 + rnd() * 0.3 : 0.97, top = WIN_Y + 0.37 * 0.86 / 2, h = Math.max(0.012, 0.37 * 0.86 * f);
      const sg = new THREE.PlaneGeometry(0.26 * 0.86 * 0.98, h).rotateY(-sd * PI / 2).translate(sd * 1.905, top - h / 2, w.z); P.add(sg, 'plastic', { e: [0, 0.35], ao: 0.9 });
      if (w.exit) { P.add(box(0.012, 0.06, 0.24, sd * (X(0.66) - 0.006), 0.66, w.z), 'red', { flat: true, ao: 1 }); }
    }
    // closed door linings (R1 forward right, L2 / R2 aft) and the open L1 frame
    const doorWall = (za, zb, zd, open) => { const prof = [[1.80, -0.28], [1.84, 0.4], [1.75, 0.95], [1.66, 1.03]];
      if (!open) { P.add(loft(prof, za, zb, sd), 'plastic'); for (const dz of [-0.42, 0.42]) P.add(box(0.02, 1.75, 0.025, sd * 1.83, 0.33, zd + dz), 'dark', { ao: 0.6 }); P.add(rbox(0.05, 0.05, 0.3, 0.015, sd * 1.8, 0.35, zd, 1), 'alu', { flat: true }); }
      else { const zc = zd; P.add(loft(prof, za, zc - 0.43, sd), 'plastic'); P.add(loft(prof, zc + 0.43, zb, sd), 'plastic'); P.add(loft(prof.filter(p => p[1] > 0.9), zc - 0.43, zc + 0.43, sd), 'plastic');
        for (const dz of [-0.43, 0.43]) P.add(box(0.12, 1.88, 0.03, sd * 1.86, 0.39, zc + dz), 'plastic', { ao: 0.85 }); }
      P.add(box(0.03, 0.08, 0.2, sd * 1.06, 1.25, zd), 'exit', { e: [1.4, 0], flat: true }); };
    doorWall(ZF, ZS0, -13.0, sd < 0); doorWall(ZS1, ZA, 11.6, false);
    // PSUs above each row: reading lights (a few on), gaspers, attendant call button
    for (let r = 0; r < rows; r++) { const z = R0 + r * pitch - 0.14;
      for (const [k, x] of [[0, 1.2], [1, 1.36], [2, 1.52]]) { const yb = 1.06 - (x - 1.12) / (1.66 - 1.12) * 0.015 - 0.008; const on = rnd() < 0.18;
        P.add(new THREE.CylinderGeometry(0.024, 0.027, 0.012, hi ? 12 : 6).translate(sd * x, yb, z), on ? 'light' : 'alu', { e: on ? [1.5, 0] : [0, 0], flat: true, ao: on ? 1 : 0.95 });
        P.add(new THREE.CylinderGeometry(0.014, 0.019, 0.025, hi ? 10 : 5).translate(sd * x, yb - 0.004, z + 0.09), 'dark', { flat: true, ao: 0.9 }); }
      P.add(box(0.03, 0.006, 0.03, sd * 1.62, 1.04, z + 0.06), 'red', { flat: true, ao: 0.6 }); }
  }
  // ---------------- floor: carpet, aisle runner, floor-path lights
  P.add(inward(sheet(2, 2, (i, j) => V3(lerp(-1.8, 1.8, j), FL, i ? ZA : ZF - 0.6), (i, j) => [lerp(-1.8, 1.8, j) / 0.6, (i ? ZA : ZF - 0.6) / 0.6])), 'carpet');
  P.add(inward(sheet(2, 2, (i, j) => V3(lerp(-0.27, 0.27, j), FL + 0.002, i ? ZS1 : ZS0 + 0.6), (i, j) => [j, (i ? ZS1 : ZS0) / 0.8])), 'runner');
  for (const x of [-0.29, 0.29]) P.add(inward(sheet(2, 2, (i, j) => V3(x + lerp(-0.008, 0.008, j), FL + 0.004, i ? ZS1 : ZS0 + 0.6), (i, j) => [0.25, 0.25])), 'light', { e: [0.35, 0], flat: true, ao: 0.6 });
  // ---------------- forward: lav (left), cockpit door passage, galley (right); bulkhead with the logo at row 1
  const face = (w, h, x, y, z, dir, tile, op = {}) => { const g = new THREE.PlaneGeometry(w, h); if (dir < 0) g.rotateY(PI); g.translate(x, y, z); return P.add(g, tile, op); };
  P.add(box(1.1, 2.3, 0.4, -1.25, 0.6, ZF - 0.2), 'plastic', { ao: 0.9 }); face(0.6, 1.85, -1.22, FL + 0.93, ZF + 0.003, 1, 'lav', { ao: 1 }); P.add(box(0.06, 0.06, 0.012, -1.0, 0.35, ZF + 0.01), 'alu', { flat: true });
  P.add(box(0.84, 0.6, 0.3, -0.2, 1.4, ZF - 0.35), 'plastic', { ao: 0.85 }); P.add(box(0.1, 2.3, 0.3, -0.67, 0.6, ZF - 0.35), 'plastic'); P.add(box(0.1, 2.3, 0.3, 0.27, 0.6, ZF - 0.35), 'plastic');
  const galley = (x0, x1, zFace, dir) => { const w = x1 - x0, xc = (x0 + x1) / 2, d = 0.5, zc = zFace - dir * d / 2;
    P.add(box(w, 2.25, d, xc, 0.58, zc), 'alu', { ao: 0.8 });
    const n = Math.max(1, Math.floor(w / 0.32)); for (let k = 0; k < n; k++) { const x = x0 + (k + 0.5) * w / n; face(w / n - 0.02, 0.92, x, FL + 0.48, zFace + dir * 0.005, dir, 'trolley', { ao: 0.9 }); face(w / n - 0.02, 0.42, x, 0.95, zFace + dir * 0.005, dir, 'trolley', { ao: 0.95 }); }
    P.add(box(w, 0.035, 0.12, xc, 0.46, zFace + dir * 0.05), 'dark', { ao: 0.9 }); P.add(box(w, 0.03, 0.03, xc, 1.21, zFace + dir * 0.01), 'light', { e: [0.9, 0], flat: true }); };
  galley(0.32, 1.76, ZF + 0.45, 1);
  { const g = box(1.3, 1.5, 0.06, 1.1, FL + 1.0, -12.05); P.add(g, 'plastic', { ao: 0.9 }); face(1.2, 1.2, 1.1, FL + 1.1, -12.017, 1, 'bulk', { flat: true, ao: 1 }); }
  // ---------------- aft: galley centre, two lavs, wall
  face(3.7, 2.3, 0, 0.6, ZA, -1, 'plastic', { ao: 0.9 });
  galley(-0.72, 0.72, ZA - 0.5, -1); for (const x of [-1.27, 1.27]) { P.add(box(0.95, 2.25, 0.5, x, 0.58, ZA - 0.25), 'plastic', { ao: 0.92 }); face(0.6, 1.85, x, FL + 0.93, ZA - 0.503, -1, 'lav', { ao: 1 }); }
  // exit signs above the overwing exits (bins) and at the doors
  for (const e of EXITS.filter(e => e.side > 0)) for (const sd of [1, -1]) { P.add(box(0.03, 0.08, 0.2, sd * 1.06, 1.25, e.z), 'exit', { e: [1.4, 0], flat: true }); }
  const shellMesh = new THREE.Mesh(P.merge(), mat); shellMesh.frustumCulled = false; group.add(shellMesh);
  // flight-only closures: the L1 door and the flight-deck door (on foot the boarding door is open and the deck has its own door)
  const PD = new Parts(ao);
  PD.add(new THREE.PlaneGeometry(0.86, 1.86).rotateY(PI / 2).translate(-1.855, FL + 0.93, -13.0), 'plastic', { ao: 0.95 });
  PD.add(rbox(0.04, 0.05, 0.32, 0.015, -1.83, 0.33, -13.0, 1), 'alu', { flat: true }); PD.add(rbox(0.02, 0.22, 0.18, 0.04, -1.845, 0.92, -13.0, 1), 'dark', { ao: 0.7 });
  PD.add(box(0.1, 0.32, 0.7, -1.8, FL + 0.17, -13.0), 'shell', { ao: 0.8 }); PD.add(box(0.012, 0.03, 0.5, -1.745, FL + 0.3, -13.0), 'red', { flat: true });
  PD.add(new THREE.PlaneGeometry(0.84, 1.66).translate(-0.2, FL + 0.83, ZF - 0.2), 'plastic', { ao: 0.92 }); PD.add(box(0.07, 0.11, 0.02, 0.06, 0.55, ZF - 0.19), 'dark', { ao: 0.8 }); PD.add(rbox(0.22, 0.04, 0.05, 0.015, -0.45, 0.3, ZF - 0.18, 1), 'alu', { flat: true });
  PD.add(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 8).rotateX(PI / 2).translate(-0.2, 0.95, ZF - 0.195), 'dark', { flat: true, ao: 0.6 });
  const doors = new THREE.Mesh(PD.merge(), mat); doors.frustumCulled = false; doors.visible = false; group.add(doors);
  // ---------------- seats (instanced)
  const sg = seatGeometry(hi); sg.translate(0, FL, 0);
  const im = new THREE.InstancedMesh(sg, mat, seats.length); const M = new THREE.Matrix4(); seats.forEach(([x, z], i) => { M.makeTranslation(x, 0, z); im.setMatrixAt(i, M); }); im.frustumCulled = false; group.add(im);
  // ---------------- mood light: cool for boarding, neutral by day, warm and dim at night
  const U = mat.uniforms, cur = { amb: new THREE.Color(1, 1, 1), cove: new THREE.Color(0.7, 0.85, 1.1), win: new THREE.Color(0.3, 0.3, 0.3), emit: new THREE.Color(1, 1, 1) };
  const want = (airborne, night) => {
    const n = clamp(night, 0, 1); const day = 1 - n;
    if (!airborne) return { amb: new THREE.Color(0.96, 1.0, 1.06).multiplyScalar(lerp(1.0, 0.92, n)), cove: new THREE.Color(0.62, 0.8, 1.15), win: new THREE.Color(0.33, 0.34, 0.36).multiplyScalar(day), emit: new THREE.Color(0.95, 1.0, 1.05) };
    return { amb: new THREE.Color().lerpColors(new THREE.Color(1.0, 0.97, 0.92), new THREE.Color(0.44, 0.34, 0.27), n), cove: new THREE.Color().lerpColors(new THREE.Color(0.95, 0.82, 0.62), new THREE.Color(1.05, 0.52, 0.24), n), win: new THREE.Color(0.36, 0.36, 0.37).multiplyScalar(day), emit: new THREE.Color().lerpColors(new THREE.Color(1, 0.98, 0.94), new THREE.Color(1.0, 0.7, 0.45), n) };
  };
  const apply = () => { U.uAmb.value.copy(cur.amb); U.uCove.value.copy(cur.cove); U.uWin.value.copy(cur.win); U.uEmit.value.copy(cur.emit); };
  { const w = want(false, ATM.uNight.value); for (const k in cur) cur[k].copy(w[k]); apply(); }
  const mood = (airborne, dt = 1) => { const w = want(airborne, ATM.uNight.value), a = 1 - Math.exp(-dt / 2.5); for (const k in cur) cur[k].lerp(w[k], a); apply(); };
  const setK = k => { U.uK.value = k; };
  return { group, mat, mood, setK, seatsMesh: im, setFlight(on) { doors.visible = on; }, dispose() { group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); A.map.dispose(); A.nrm.dispose(); mat.dispose(); } };
}
