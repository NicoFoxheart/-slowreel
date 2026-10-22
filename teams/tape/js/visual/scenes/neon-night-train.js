// neon-night-train.js - a night train window: an elevated line runs past a rainy shopping street (signs, lit
// windows, wet road, cars, lamps), seen through wet glass from inside a dim carriage. The city is one period of
// streets rendered twice (a wrap copy) as it slides by; the glass is a full-screen pass over the rendered city:
// a water-film softness plus depth-based motion blur (near poles and cars smear, far towers stay crisp), beads that
// refract a sharp inverted image of the lights, rivulets pushed back by the slipstream, the reflection of the lit
// carriage (ceiling strips, hand straps, windows across the aisle, bench seats) and the window frame.
import * as kit from './kit.js?v=10';
import { buildCity } from './neon-night-city.js?v=10';

const DOWN_FS = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel;
void main() {                                                                // 4 bilinear taps = a 4x4 box: half resolution, no mipmaps
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  gl_FragColor = vec4(min(c * 0.25, vec3(60.0)), 1.0);
}`;

const GLASS_FS = /* glsl */`
uniform sampler2D tScene, tHalf, tQuart, tDepth; uniform vec2 uRes;
uniform float uTime, uAspect, uRainK, uPortrait, uSpeed, uFocal, uNear, uFar, uRock, uTaps;
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float boxM(vec2 p, vec2 a, vec2 b, float e) { vec2 s = smoothstep(a - e, a + e, p) * (1.0 - smoothstep(b - e, b + e, p)); return s.x * s.y; }
vec2 cl(vec2 uv) { return clamp(uv, vec2(0.001), vec2(0.999)); }
float linZ(vec2 uv) { float z = texture2D(tDepth, cl(uv)).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
// the city behind the glass: a thin water film softens it a little, and the train's speed smears the near street
// sideways (screen speed = v / depth), while the far towers stay crisp
vec3 outside(vec2 uv) {
  float z = min(linZ(uv), min(linZ(uv + vec2(0.012, 0.0)), linZ(uv - vec2(0.012, 0.0))));
  float L = clamp(uSpeed * (1.0 / 40.0) / max(z, 0.5) * uFocal / uAspect, 0.0, 0.09);      // blur length in uv (x)
  vec3 sharp = texture2D(tScene, cl(uv)).rgb, soft = texture2D(tHalf, cl(uv)).rgb;
  vec3 base = mix(sharp, soft, 0.55);
  if (L * uRes.x < 0.75) return base;
  vec3 acc = vec3(0.0); float n = 0.0;
  for (int i = 0; i < 12; i++) { if (float(i) >= uTaps) break; float o = (float(i) + 0.5) / uTaps - 0.5; acc += texture2D(tHalf, cl(uv + vec2(o * L, 0.0))).rgb; n += 1.0; }
  return mix(base, acc / n, smoothstep(0.75, 3.0, L * uRes.x));
}
// beads sitting on the pane: tiny lenses that show a sharp inverted image of the lights behind them
vec4 beads(vec2 p, float cell, float dens, float seed, float aa) {
  vec2 q = p / cell, id = floor(q); vec4 o = vec4(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = id + vec2(float(i), float(j)); vec4 h = kHash42(c + seed);
    if (h.w > dens) continue;
    float life = fract(uTime / (5.0 + 9.0 * h.z) + h.x);                    // a bead grows, then the air flow takes it
    float rad = (0.12 + 0.3 * h.y * h.y) * smoothstep(0.0, 0.25, life) * (1.0 - smoothstep(0.9, 1.0, life));
    vec2 d = (q - c - 0.2 - 0.6 * h.xy) - vec2(-0.5, -0.12) * smoothstep(0.75, 1.0, life);
    d.y *= 1.12;
    float l = length(d);
    float m = 1.0 - smoothstep(rad - aa / cell, rad + aa / cell, l);
    if (m > o.z) { float s = clamp(l / max(rad, 1e-3), 0.0, 1.0); o.xy = -d / max(rad, 1e-3); o.z = m; o.w = smoothstep(0.72, 1.0, s); }
  }
  return o;
}
// rivulets pushed back and down by the slipstream: a drop head with a thin wandering trail behind it
vec4 rivulets(vec2 g, float dens, float seed, float aa) {
  vec2 f = normalize(vec2(-1.0, -0.2)), pp = vec2(-f.y, f.x);
  float a = dot(g, f) * 9.0, b = dot(g, pp) * 34.0;
  float lane = floor(b); vec4 h = kHash42(vec2(lane, seed));
  if (h.w > dens) return vec4(0.0);
  float s = a / 3.0 + h.x * 7.0, seg = floor(s);
  vec4 hs = kHash42(vec2(seg, lane + seed * 3.0));
  if (hs.x > 0.6) return vec4(0.0);
  float head = fract(uTime * (0.35 + 0.7 * hs.y) + hs.z * 5.0) * 1.3 - 0.15;
  float e = (fract(s) - head) * 3.0;                                          // along the path, < 0 = behind the head
  float y = fract(b) - 0.5 + 0.18 * sin(a * 1.7 + h.z * 6.3) * smoothstep(0.0, -1.0, e);
  float wHead = 0.26 * (0.7 + 0.5 * hs.w), wTrail = 0.07 * (1.0 + e * 0.15) * step(e, 0.0) * smoothstep(-2.4 - 2.0 * h.y, -0.3, e);
  float dh = length(vec2(e / 0.55, y / wHead));
  float mh = 1.0 - smoothstep(1.0 - aa * 30.0, 1.0 + aa * 30.0, dh);
  float mt = wTrail > 0.0 ? 1.0 - smoothstep(wTrail - aa * 34.0, wTrail + aa * 34.0, abs(y)) : 0.0;
  float m = max(mh, mt * 0.8);
  if (m <= 0.0) return vec4(0.0);
  float nx = mh > mt ? y / wHead : y / max(wTrail, 1e-3);
  return vec4(-pp * nx * 0.9 - f * (mh > mt ? e / 0.55 : 0.0) * 0.6, m, smoothstep(0.5, 1.0, abs(nx)));
}
// what the window reflects: the lit carriage behind the camera (ceiling light strips, the windows across the
// aisle, hand straps, bench seats)
vec3 interior(vec2 c) {
  float x = c.x;
  vec3 col = vec3(0.05, 0.055, 0.058) * (0.55 + 0.45 * smoothstep(-0.5, 0.45, c.y));
  float win = boxM(vec2(fract(x * 0.42 + 0.31), c.y), vec2(0.1, -0.16), vec2(0.9, 0.29), 0.012);
  col *= 1.0 - 0.85 * win;
  float strip = exp(-pow((c.y - 0.445) * 70.0, 2.0)) * smoothstep(0.02, 0.05, fract(x * 0.37 + 0.13));
  col += vec3(0.92, 1.0, 0.97) * 4.0 * strip + vec3(0.9, 0.95, 0.95) * 0.1 * smoothstep(0.33, 0.47, c.y);
  float seat = smoothstep(-0.2, -0.235, c.y);
  col = mix(col, vec3(0.025, 0.05, 0.075) * (0.7 + 0.3 * smoothstep(-0.5, -0.24, c.y)), seat);
  float rx = fract(x * 1.9 + 0.5) - 0.5 + uRock * 14.0 * (0.4 - c.y);
  float strap = smoothstep(0.005, 0.002, abs(rx)) * step(0.3, c.y) * step(c.y, 0.405);
  float ring = smoothstep(0.006, 0.002, abs(length(vec2(rx, c.y - 0.278)) - 0.02));
  float rail = smoothstep(0.004, 0.0015, abs(c.y - 0.405));
  col += vec3(0.16, 0.16, 0.15) * (ring + rail) + vec3(0.05) * strap;
  return col;
}
void main() {
  vec2 uv = vUv, c = (uv - 0.5) * vec2(uAspect, 1.0);
  vec2 hs = mix(vec2(0.5 * uAspect - 0.055, 0.395), vec2(0.5 * uAspect - 0.04, 0.43), uPortrait);
  vec2 wc = vec2(0.0, 0.025);
  float d = sdBox(c - wc, hs, 0.045);
  float aa = 1.2 / uRes.y;
  vec3 col;
  if (d < 0.0) {
    vec2 g = c - wc;
    vec4 a = beads(g, 0.016, 0.42 * uRainK, 1.0, aa), b = beads(g + 3.1, 0.04, 0.26 * uRainK, 7.0, aa), rv = rivulets(g, 0.55 * uRainK, 3.0, aa);
    vec4 D = a; if (b.z > D.z) D = b; if (rv.z > D.z) D = rv;
    vec3 bg = outside(uv);
    if (D.z > 0.0) {
      vec2 off = D.xy * vec2(0.045 / uAspect, 0.045) + vec2(0.0, 0.012);   // the inverted mini image of what is behind the drop
      vec3 lens = texture2D(tHalf, cl(uv + off)).rgb * (1.0 - 0.3 * D.w) * 0.94;
      bg = mix(bg, lens + 0.003, D.z);
    }
    float edge = smoothstep(-0.1, 0.0, d) * 0.5 + smoothstep(-0.22, -0.4, g.y) * 0.35;   // condensation at the edges of the pane
    bg = mix(bg, texture2D(tQuart, cl(uv)).rgb * 0.7 + vec3(0.012, 0.014, 0.016), edge * 0.6);
    float F = 0.07 + 0.05 * smoothstep(0.0, 0.6, abs(g.x) / uAspect);           // the pane reflects the lit carriage
    col = bg * (1.0 - F) + interior(c) * F * (1.0 - 0.4 * D.z);
  } else {
    // frame: rubber gasket, brushed aluminium, then the painted wall panel of the carriage lit by the ceiling strips
    float t = d;
    vec3 wall = vec3(0.34, 0.345, 0.33) * (0.45 + 0.55 * smoothstep(-0.5, 0.5, c.y)) * (0.94 + 0.06 * kValue2(c * vec2(30.0, 3.0)));
    float seam = smoothstep(0.003, 0.0, abs(fract(c.x * 0.7 + 0.25) - 0.5) - 0.497);
    wall *= 1.0 - 0.4 * seam;
    float bevel = smoothstep(0.012, 0.0, abs(t - 0.024));
    vec3 alu = vec3(0.3, 0.31, 0.32) * (0.55 + 0.35 * smoothstep(-0.4, 0.4, c.y)) + vec3(0.5) * bevel * smoothstep(-0.1, 0.3, c.y);
    col = t < 0.01 ? vec3(0.006) : t < 0.038 ? alu : wall;
    col *= 0.3;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildTrain({ THREE, renderer, bag, quality, seed, U, glyphTex, mirror, pal, width, height, pixelRatio }) {
  const r = kit.rng(kit.hashSeed('neon-train', seed)), P = 480;
  const common = { w: [5, 11], floors: [3, 7], gH: [3.6, 4.2], styles: [[0, 0.2], [1, 0.35], [2, 0.3], [3, 0.15]], shops: [[0, 0.5], [1, 0.15], [3, 0.35]],
    lit: [0.3, 0.7], signs: 1.1, vert: 1.2, ac: 0.08, pipes: 0.15, clutter: 0.2, gaps: 0.1, setback: 0.4, vMax: 7 };
  const poles = [];
  for (let x = 6; x < P; x += 26 + r.range(-4, 4)) poles.push({ x, z: -6.6, h: 9, lamp: { dir: [0, -1], color: kit.kelvin(r.chance(0.3) ? 2100 : 4000), I: 28, h: 7.2 } });
  const Lay = { id: 'train', neonShare: 0.35, faulty: 0.05, markMode: 0, halfW: 30,
    runs: [{ ...common, p0: [8, -19.5], p1: [P - 8, -19.5],     // a 16 m cross street sits on every (mirror) seam
      cellK: quality === 'light' ? 1.25 : 1 }, { ...common, p0: [0, -46], p1: [P, -46], cellK: quality === 'light' ? 2.6 : 1.8, floors: [8, 18], fh: 2.9, signs: 0.3, vert: 0.3, screens: 0.15, shops: [[0, 0.6], [1, 0.4]], crosses: 0.1 }],
    grounds: [{ x0: 0, x1: P, z0: -19.5, z1: -6, cell: 0.9 }, { x0: 0, x1: P, z0: -6, z1: 4, cell: 2, surf: 2 }, { x0: 0, x1: P, z0: -46, z1: -19.5, cell: 4 }],
    poles, drops: 1, lanes: [{ axis: 'x', c: -10.5, dir: -1, v: 8, span: P, from: 0, n: 5 }, { axis: 'x', c: -14.5, dir: 1, v: 7, span: P, from: 0, n: 5 }], steam: [], words: [] };
  const city = buildCity({ THREE, renderer, bag, quality, seed, U, mirror, glyphTex, pal }, Lay);
  const group = new THREE.Group(); group.add(city.group);
  const ghost = city.group.clone(); group.add(ghost);
  let ghostGround = null; ghost.traverse(o => { if (o.isMesh && o.geometry === city.groundMesh.geometry) ghostGround = o; });
  // the clone copied the instance matrices once; share the live ones so the cars and their lamps move in both copies
  const srcI = [], dstI = [];
  city.group.traverse(o => { if (o.isInstancedMesh) srcI.push(o); });
  ghost.traverse(o => { if (o.isInstancedMesh) dstI.push(o); });
  srcI.forEach((o, i) => { if (dstI[i]) { dstI[i].instanceMatrix = o.instanceMatrix; if (o.instanceColor) dstI[i].instanceColor = o.instanceColor; } });
  // the city render target + depth (for speed-dependent motion blur) and a half / quarter chain made by explicit
  // passes: no hardware mipmaps, so every frame is exact whatever was rendered before
  const hf = kit.halfFloatOK(renderer), type = hf ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const mk = depth => bag.add(new THREE.WebGLRenderTarget(2, 2, { type, depthBuffer: depth, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, samples: 0 }));
  const rt = mk(true), half = mk(false), quart = mk(false);
  rt.depthTexture = bag.add(new THREE.DepthTexture(2, 2));
  const down = bag.add(kit.createPass(THREE, { fragment: DOWN_FS, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } } }));
  const glass = kit.createPass(THREE, { fragment: GLASS_FS, prepend: kit.GLSL.common + kit.GLSL.noise, uniforms: {
    tScene: { value: rt.texture }, tHalf: { value: half.texture }, tQuart: { value: quart.texture }, tDepth: { value: rt.depthTexture },
    uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uAspect: { value: 1 }, uRainK: { value: 0.7 }, uPortrait: { value: 0 },
    uSpeed: { value: 9 }, uFocal: { value: 1 }, uNear: { value: 0.1 }, uFar: { value: 1500 }, uRock: { value: 0 }, uTaps: { value: quality === 'light' ? 6 : 12 } } });
  bag.add(glass);
  let X = 0, rock = 0, mirrorSign = 1; const X0 = P * (0.3 + 0.25 * r());
  function camera(cam, t, f, I) {
    X = X0 + 9 * t + 2 * I * (f.flow || 0);                                  // X0: the song opens mid-street, not on a seam
    glass.uniforms.uSpeed.value = 9 + 2 * I * (f.energy || 0);
    // street coordinate u = X sits at the camera. Cycle c of the street covers u in [cP, (c+1)P]; odd cycles are the
    // same street mirrored end to end, so the strip only repeats exactly every 2P (~100 s) and the seams are
    // symmetric instead of cut. The second copy is drawn only while the next/previous cycle is in view.
    const c0 = Math.floor(X / P), fr = X / P - c0, cn = fr > 0.5 ? c0 + 1 : c0 - 1;
    const place = (g, c) => { const s0 = c * P - X; const odd = (c & 1) !== 0; g.position.x = odd ? s0 + P : s0; g.scale.x = odd ? -1 : 1; };
    place(city.group, c0); place(ghost, cn);
    ghost.visible = fr * P < 55 || fr * P > P - 55;
    mirrorSign = city.group.scale.x;
    const p = kit.portraitness(cam.aspect);
    // the carriage rocks a little on the rails; the view drifts slowly as the passenger shifts in the seat
    rock = 0.004 * kit.noise1(t * 1.7, 2) + 0.0015 * Math.sin(t * 9.1);
    const sway = 0.35 * Math.sin(t / 47 + 1.3) + 0.2 * Math.sin(t / 113);
    cam.position.set(0, 7.6 + 0.012 * kit.noise1(t * 3.1, 4), 1.6);
    cam.up.set(0, 1, 0); cam.lookAt(0.0, 6.0 + p * 1.5 + sway, -20); cam.rotateZ(rock);
    const fov = kit.aspectFov(46, cam.aspect, 0.75); if (Math.abs(cam.fov - fov) > 1e-6) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    glass.uniforms.uFocal.value = 0.5 / Math.tan(cam.fov * Math.PI / 360); glass.uniforms.uNear.value = cam.near; glass.uniforms.uFar.value = cam.far;
    return null;
  }
  function update(t, f, wind, cam, I) { city.update(t, f, wind); glass.uniforms.uTime.value = t; glass.uniforms.uRock.value = rock; glass.uniforms.uRainK.value = U.uRain.value; }
  const camPos = new THREE.Vector3();
  function rainLights(cp) {
    const gx = city.group.position.x;
    camPos.set((cp.x - gx) * mirrorSign, cp.y, cp.z - 10);
    return city.rainLights(camPos).map(l => ({ ...l, position: [gx + l.position[0] * mirrorSign, l.position[1], l.position[2]] }));
  }
  function render(scene, cam, post, t) {
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam);
    down.uniforms.tSrc.value = rt.texture; down.uniforms.uTexel.value.set(1 / rt.width, 1 / rt.height); down.render(renderer, half);
    down.uniforms.tSrc.value = half.texture; down.uniforms.uTexel.value.set(1 / half.width, 1 / half.height); down.render(renderer, quart);
    post.begin(); glass.render(renderer, post.target); post.end(cam, t);
  }
  function resize(w, h, pr = 1) {
    const W = Math.max(2, Math.round(w * pr)), H = Math.max(2, Math.round(h * pr));
    rt.setSize(W, H); half.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1)); quart.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    glass.uniforms.uRes.value.set(W, H); glass.uniforms.uAspect.value = w / h; glass.uniforms.uPortrait.value = kit.portraitness(w / h);
  }
  resize(width, height, pixelRatio);
  const grade = { exposure: 1.0, temperature: -0.02, tint: 0.02, saturation: 1.05, contrast: 1.08, lift: [0.003, 0.003, 0.006], gain: [1.0, 0.99, 1.02], vignette: 0.38, bloom: 0.09 };
  return { group, groundMesh: city.groundMesh, groundMeshes: quality === 'light' ? [city.groundMesh, ghost] : [city.groundMesh, ghostGround],   // light: the far copy skips the reflection pass
    ghost, camera, update, render, resize, rainLights, grade, noDof: true, rainCenterZ: -11 };
}
