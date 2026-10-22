// neon-night-tunnel.js - an empty highway tunnel at night, seen from a car: two lanes, tiled walls, a vaulted
// concrete ceiling with rows of low-pressure sodium fixtures passing overhead in rhythm, jet fans, green emergency
// signs, a couple of cars ahead with red tail lights. The tube is infinite: the geometry slides back by whole light
// periods while every pattern (tiles, grime, fixture colour, segment lighting) is computed from the true world z, so
// nothing repeats. Light from the fixtures is analytic in the shader (nearest fixtures summed), the road mirrors them.
import * as kit from './kit.js?v=9d';
import { PRE, SIGN_VS, SIGN_FS, HALO_VS, HALO_FS } from './neon-night-glsl.js?v=9d';

const S = 6;                 // fixture spacing (m)
const W = 5.4, WALL = 3.8, TOP = 6.6;   // half width (m), wall height, crown height

const TUBE_VS = /* glsl */`
attribute float aSurf; varying float vSurf; varying vec3 vWp; varying vec3 vN;
void main() { vSurf = aSurf; vec4 w = modelMatrix * vec4(position, 1.0); vWp = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
const TUBE_FS = /* glsl */`
uniform sampler2D uAsph, uAsphN, uPudTex, uMirror; uniform mat4 uMirrorMatrix; uniform float uMirrorOn;
uniform float uTime, uLampI, uSeg, uTaps; uniform vec3 uSodium, uLed;
varying float vSurf; varying vec3 vWp; varying vec3 vN;
float tn(vec2 p) { return texture2D(uPudTex, p).r; }
vec3 lampCol(float k) { float seg = floor(k * ${S.toFixed(1)} / 420.0); float led = step(0.78, fract(sin(seg * 12.9898 + uSeg) * 43758.5453)); return mix(uSodium, uLed, led); }
float lampOn(float k) { return 1.0 - 0.85 * step(0.985, fract(sin(k * 7.13 + uSeg) * 9137.1)); }           // a dead tube now and then
void main() {
  vec3 p = vWp, N = normalize(vN), V = normalize(cameraPosition - p);
  vec3 alb; float rough = 0.7, spec = 0.04;
  if (vSurf < 0.5) {                                                            // road
    vec4 a = texture2D(uAsph, p.xz / 3.0); alb = a.rgb * 1.1;
    float l = step(abs(p.x), 0.07) * step(0.5, fract(p.z / 9.0)) + step(abs(abs(p.x) - (${W.toFixed(2)} - 0.6)), 0.07);
    alb = mix(alb, vec3(0.6, 0.58, 0.5), l * 0.8);
    float tyre = smoothstep(0.5, 0.0, abs(abs(p.x - 1.9) - 0.85)) + smoothstep(0.5, 0.0, abs(abs(p.x + 1.9) - 0.85));
    alb *= 1.0 - 0.25 * tyre; rough = mix(0.6, 0.3, tyre); spec = 0.05;
    vec3 nt = texture2D(uAsphN, p.xz / 3.0).xyz * 2.0 - 1.0; N = normalize(vec3(nt.x * 0.6, 1.0, nt.y * 0.6));
  } else if (vSurf < 1.5) {                                                     // tiled wall (cream ceramic, grimy at the bottom)
    vec2 q = vec2(p.z, p.y) / vec2(0.25, 0.25); vec2 f = fract(q);
    float g = 1.0 - smoothstep(0.0, 0.05, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    float grime = smoothstep(2.4, 0.0, p.y) * (0.5 + 0.5 * tn(vec2(p.z * 0.03, p.y * 0.1)));
    alb = vec3(0.5, 0.5, 0.47) * (0.92 + 0.1 * kHash12(floor(q))) * (1.0 - 0.6 * grime) * (1.0 - 0.25 * g);
    alb *= 0.8 + 0.25 * tn(vec2(p.z * 0.011, 0.5));
    float band = step(abs(p.y - 1.2), 0.12); alb = mix(alb, vec3(0.08, 0.07, 0.05), band);                // dark kerb band
    rough = mix(0.25, 0.8, g + grime * 0.6); spec = 0.05;
  } else {                                                                      // sprayed concrete vault, cable trays
    alb = vec3(0.16, 0.155, 0.15) * (0.7 + 0.5 * tn(p.xz * vec2(0.08, 0.02) + p.y * 0.05));
    rough = 0.9;
  }
  rough = clamp(rough, 0.05, 1.0);                                            // >1 would give pow(x, <0) = Inf sparkles
  // analytic light from the nearest fixtures (2 rows at x = +-1.6 on the crown)
  vec3 Lo = vec3(0.0);
  float k0 = floor(p.z / ${S.toFixed(1)});
  for (int j = -3; j <= 4; j++) {
    float k = k0 + float(j); vec3 lc = lampCol(k) * uLampI * lampOn(k);
    for (int s = -1; s <= 1; s += 2) {
      vec3 lp = vec3(float(s) * 1.6, ${TOP.toFixed(2)} - 0.45, k * ${S.toFixed(1)} + 0.5);
      vec3 L = lp - p; float d2 = dot(L, L); L *= inversesqrt(d2);
      float nl = max(dot(N, L), 0.0); float down = max(-L.y, 0.0);            // fixtures shine downward
      float atten = (0.25 + 0.75 * down) / (d2 + 0.3);
      vec3 H = normalize(L + V + vec3(0.0, 1e-4, 0.0)); float sp = pow(max(dot(N, H), 0.0), mix(400.0, 8.0, rough)) * mix(40.0, 0.5, rough);
      Lo += lc * atten * (alb * nl / 3.14159 + spec * sp * nl);
    }
  }
  vec3 col = Lo + alb * vec3(0.004, 0.0035, 0.003);
  if (vSurf < 0.5 && uMirrorOn > 0.5) {                                        // polished asphalt: long blurred reflections
    vec4 mc = uMirrorMatrix * vec4(p, 1.0); vec2 muv = mc.xy / mc.w;
    float cosv = max(V.y, 0.0), F = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
    vec3 acc = vec3(0.0); float ws = 0.0;
    for (int i = 0; i < 7; i++) { float o = (float(i) / 6.0 - 0.5) * 2.0, w = exp(-o * o * 2.0); acc += texture2D(uMirror, muv + vec2(0.0, o * 0.06)).rgb * w; ws += w; }
    col = mix(col, acc / ws, F * 0.45);
  }
  gl_FragColor = vec4(nnFog(col, p, cameraPosition), 1.0);
}`;

function profile() {   // cross-section points (x, y) from the right kerb, over the vault, to the left kerb + surface ids
  const pts = [];
  pts.push([W, 0, 1], [W, WALL, 1]);
  const n = 14; for (let i = 1; i < n; i++) { const a = i / n * Math.PI; pts.push([Math.cos(a) * W, WALL + Math.sin(a) * (TOP - WALL), 2]); }
  pts.push([-W, WALL, 1], [-W, 0, 1]);
  return pts;
}

export function buildTunnel({ THREE, renderer, bag, quality, seed, U, mirror }) {
  const r = kit.rng(kit.hashSeed('neon-tunnel', seed)), light = quality === 'light';
  const group = new THREE.Group(), LEN = 380, seg = Math.round(LEN / (light ? 3 : 1.5));
  // tube geometry: road strip + walls + vault, extruded along -z
  const P = [], Nn = [], A = [], I = [];
  const addStrip = (pa, pb, surf) => {           // pa, pb: [x, y] - a band from pa to pb along z (0 .. -LEN)
    const base = P.length / 3, nx = -(pb[1] - pa[1]), ny = pb[0] - pa[0], l = Math.hypot(nx, ny);
    for (let i = 0; i <= seg; i++) { const z = 30 - i / seg * LEN; P.push(pa[0], pa[1], z, pb[0], pb[1], z); Nn.push(nx / l, ny / l, 0, nx / l, ny / l, 0); A.push(surf, surf); }
    for (let i = 0; i < seg; i++) { const a = base + i * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  };
  addStrip([-W, 0], [W, 0], 0);
  const pr = profile(); for (let i = 0; i + 1 < pr.length; i++) addStrip(pr[i], pr[i + 1], pr[i + 1][2]);
  const geo = bag.add(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); geo.setAttribute('aSurf', new THREE.Float32BufferAttribute(A, 1));
  geo.setIndex(I); geo.computeBoundingSphere();
  // normals must face the inside: flip winding if needed (road normal must be +y)
  const tu = { ...U, uMirror: mirror.uniforms.uMirror, uMirrorMatrix: mirror.uniforms.uMirrorMatrix, uMirrorOn: mirror.uniforms.uMirrorOn, uLampI: { value: 26 }, uSeg: { value: seed * 1.37 },
    uSodium: { value: new THREE.Vector3(1, 0.52, 0.09) }, uLed: { value: new THREE.Vector3(...kit.kelvin(4600)) }, uTaps: { value: 7 } };
  const mat = bag.add(new THREE.ShaderMaterial({ uniforms: tu, vertexShader: TUBE_VS, fragmentShader: PRE + TUBE_FS, side: THREE.DoubleSide }));
  const tube = new THREE.Mesh(geo, mat); tube.frustumCulled = false; group.add(tube);
  const capG = bag.add(new THREE.PlaneGeometry(2 * W, TOP)); capG.translate(0, TOP / 2, 30 - LEN);
  const capM = bag.add(new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: PRE + 'void main() { gl_FragColor = vec4(uFogCol, 1.0); }' }));
  group.add(new THREE.Mesh(capG, capM));
  // road for the mirror hide list: the tube contains the road, so hide the whole tube in the mirror pass except walls? -> separate road mesh
  // (the road strip is the first band: draw it as its own mesh so walls and vault appear in the reflection)
  const roadGeo = bag.add(new THREE.BufferGeometry());
  const nr = (seg + 1) * 2; roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(P.slice(0, nr * 3), 3)); roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(Nn.slice(0, nr * 3), 3));
  roadGeo.setAttribute('aSurf', new THREE.Float32BufferAttribute(A.slice(0, nr), 1)); roadGeo.setIndex(I.slice(0, seg * 6)); roadGeo.computeBoundingSphere();
  geo.setIndex(I.slice(seg * 6));
  const road = new THREE.Mesh(roadGeo, mat); road.frustumCulled = false; group.add(road);

  // fixtures (emissive boxes) + halos, jet fans, emergency signs, cars ahead: all in one sign mesh
  const nf = Math.ceil(LEN / S) + 2, signs = [], halos = [];
  for (let k = 0; k < nf; k++) for (const s of [-1, 1]) {
    const z = 30 - k * S + 0.5;
    signs.push({ p: [s * 1.6, TOP - 0.38, z], sz: [0.32, 0.1, 1.25], A: [1, 0.5, 0.12, 1], B: [4, 0, 0, 0], fix: true, k });
    halos.push({ p: [s * 1.6, TOP - 0.6, z], size: 1.3, fix: true, k });
  }
  for (let k = 0; k < 3; k++) signs.push({ p: [W - 0.04, 2.4, -k * 96 - 40], sz: [0.02, 0.32, 0.65], A: [0.1, 1, 0.35, 3.2], B: [4, 0, 0, 0] });
  const cars = [{ lane: -1.9, d0: 34, col: [1, 0.02, 0.01] }, { lane: 1.9, d0: 70, col: [1, 0.02, 0.01] }, { lane: -1.9, d0: 120, col: [1, 0.03, 0.01] }];
  for (const c of cars) for (let k = 0; k < 2; k++) { signs.push({ car: c, k, sz: [0.32, 0.12, 0.04], A: [...c.col, 18], B: [4, 0, 0, 0] }); halos.push({ car: c, k, size: 0.9, col: [1, 0.03, 0.01].map(v => v * 0.5) }); }
  const sg = bag.add(new THREE.BoxGeometry(1, 1, 1));
  const iA = new Float32Array(signs.length * 4), iB = new Float32Array(signs.length * 4), iC = new Float32Array(signs.length * 4);
  signs.forEach((s, i) => { iA.set(s.A, i * 4); iB.set(s.B, i * 4); });
  sg.setAttribute('iA', new THREE.InstancedBufferAttribute(iA, 4)); sg.setAttribute('iB', new THREE.InstancedBufferAttribute(iB, 4)); sg.setAttribute('iC', new THREE.InstancedBufferAttribute(iC, 4));
  const sm = bag.add(new THREE.ShaderMaterial({ uniforms: { ...U, uGlyph: { value: null }, uGlow: { value: 1 } }, vertexShader: SIGN_VS, fragmentShader: PRE + SIGN_FS }));
  const signMesh = new THREE.InstancedMesh(sg, sm, signs.length); signMesh.frustumCulled = false; group.add(signMesh);
  const M = new THREE.Matrix4();
  signs.forEach((s, i) => { if (s.p) { M.makeScale(...s.sz); M.setPosition(...s.p); signMesh.setMatrixAt(i, M); } });
  // car bodies
  const cgeo = bag.add(new THREE.BoxGeometry(1.8, 1.25, 4.4)); cgeo.translate(0, 0.72, 0);
  const cmat = bag.add(new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.3, metalness: 0.7 }));
  const carMesh = new THREE.InstancedMesh(cgeo, cmat, cars.length); carMesh.frustumCulled = false; group.add(carMesh);
  // jet fans every 96 m (pairs of cylinders under the crown)
  const fan = []; for (let k = 0; k < 3; k++) for (const s of [-1, 1]) { const g = new THREE.CylinderGeometry(0.55, 0.55, 3.2, light ? 10 : 16, 1, true); g.rotateX(Math.PI / 2); g.translate(s * 2.2, TOP - 1.15, -k * 96 - 60); fan.push(g); }
  const fanGeo = bag.add(mergeSimple(THREE, fan));
  const fanMat = bag.add(new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.45, metalness: 0.8, side: THREE.DoubleSide }));
  group.add(new THREE.Mesh(fanGeo, fanMat));
  // halos
  const hg = bag.add(new THREE.PlaneGeometry(1, 1)); const hc = new Float32Array(halos.length * 4), hp = new Float32Array(halos.length * 4);
  halos.forEach((h, i) => { hc.set([...(h.col || [1, 0.45, 0.1].map(v => v * 0.25)), 0], i * 4); hp.set([0, 0, 0, h.size], i * 4); });
  hg.setAttribute('iCol', new THREE.InstancedBufferAttribute(hc, 4)); hg.setAttribute('iP', new THREE.InstancedBufferAttribute(hp, 4));
  const hm = bag.add(new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: HALO_VS, fragmentShader: PRE + HALO_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const haloMesh = new THREE.InstancedMesh(hg, hm, halos.length); haloMesh.frustumCulled = false; haloMesh.renderOrder = 5; group.add(haloMesh);
  halos.forEach((h, i) => { if (h.p) { M.makeTranslation(...h.p); haloMesh.setMatrixAt(i, M); } });

  // a tiny env for the car paint (orange tunnel)
  const env = (() => {
    const s = new THREE.Scene(), items = [];
    const room = new THREE.Mesh(new THREE.BoxGeometry(12, 8, 80), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.025, 0.008), side: THREE.BackSide })); s.add(room); items.push(room);
    for (let k = 0; k < 10; k++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.8, 0.4), side: THREE.DoubleSide })); m.rotation.x = Math.PI / 2; m.position.set(0, 3.5, -40 + k * 8); s.add(m); items.push(m); }
    const pm = new THREE.PMREMGenerator(renderer); const rt = pm.fromScene(s, 0.04); pm.dispose(); items.forEach(m => { m.geometry.dispose(); m.material.dispose(); }); bag.add(rt); return rt.texture;
  })();

  // ---- motion: position along the tunnel is a pure function of t and f.flow
  let camZ = 0;
  const per = S * 4;
  const carZ = (c, t) => camZ - c.d0 - 8 * Math.sin(t / (37 + c.d0) + c.d0) - 3 * Math.sin(t / 13.7 + c.d0 * 0.3);
  function camera(cam, t, f, I) {
    camZ = -(13 * t + 2.5 * I * (f.flow || 0));
    const sway = 0.12 * kit.noise1(t * 0.05, 3) + 0.03 * kit.noise1(t * 0.9, 5);
    const x = 1.9 + sway, y = 1.22 + 0.012 * kit.noise1(t * 2.3, 7);
    cam.position.set(x, y, camZ);
    const p = kit.portraitness(cam.aspect);
    cam.up.set(0, 1, 0); cam.lookAt(x - 0.25 + 0.6 * kit.noise1(t * 0.03, 9), y + 0.35 + p * 1.2, camZ - 30);
    cam.rotateZ(0.004 * kit.noise1(t * 0.4, 11));
    const fov = kit.aspectFov(48, cam.aspect, 0.65); if (Math.abs(cam.fov - fov) > 1e-6) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    return { pos: [x, y, camZ], look: [x, y, camZ - 30] };
  }
  const tq = new THREE.Quaternion(), tv = new THREE.Vector3(), ts = new THREE.Vector3(1, 1, 1);
  function update(t, f, wind, cam, I) {
    group.position.z = Math.ceil(camZ / per) * per;                       // slide the tube by whole periods
    tu.uLampI.value = 26 * (1 + 0.05 * I * (f.level || 0));
    // fixture colours / dead tubes follow the true index k (world z)
      for (let i = 0; i < signs.length; i++) {
      const s = signs[i];
      if (s.fix) {
        const k = Math.floor((s.p[2] + group.position.z) / S);
        const seg = Math.floor(k * S / 420), led = kit.fract(Math.sin(seg * 12.9898 + seed * 1.37) * 43758.5453) >= 0.78;
        const dead = kit.fract(Math.sin(k * 7.13 + seed * 1.37) * 9137.1) >= 0.985;
        const c = led ? kit.kelvin(4600) : [1, 0.52, 0.09];
        const I0 = (led ? 7 : 9) * (dead ? 0.12 : 1);
        iA[i * 4] = c[0]; iA[i * 4 + 1] = c[1]; iA[i * 4 + 2] = c[2]; iA[i * 4 + 3] = I0;
      } else if (s.car) {
        const z = carZ(s.car, t) - group.position.z;
        M.compose(tv.set(s.car.lane + (s.k ? 0.62 : -0.62), 0.92, z + 2.2), tq.identity(), ts.set(...s.sz)); signMesh.setMatrixAt(i, M);
      }
    }
    signMesh.geometry.attributes.iA.needsUpdate = true;
    halos.forEach((h, i) => {
      if (h.fix) { const k = Math.floor((h.p[2] + group.position.z) / S); const seg = Math.floor(k * S / 420), led = kit.fract(Math.sin(seg * 12.9898 + seed * 1.37) * 43758.5453) >= 0.78;
        const c = led ? [0.9, 0.95, 1] : [1, 0.45, 0.1]; hc[i * 4] = c[0] * 0.22; hc[i * 4 + 1] = c[1] * 0.22; hc[i * 4 + 2] = c[2] * 0.22; }
      else if (h.car) { M.makeTranslation(h.car.lane + (h.k ? 0.62 : -0.62), 0.92, carZ(h.car, t) - group.position.z + 2.5); haloMesh.setMatrixAt(i, M); }
    });
    haloMesh.geometry.attributes.iCol.needsUpdate = true; haloMesh.instanceMatrix.needsUpdate = true;
    cars.forEach((c, i) => { M.makeTranslation(c.lane, 0, carZ(c, t) - group.position.z); carMesh.setMatrixAt(i, M); });
    carMesh.instanceMatrix.needsUpdate = true; signMesh.instanceMatrix.needsUpdate = true;
  }
  const grade = { exposure: 0.95, temperature: 0.02, tint: 0.0, saturation: 1.05, contrast: 1.12, lift: [0.004, 0.002, 0.0], gain: [1.02, 0.98, 0.94], vignette: 0.45, bloom: 0.09 };
  return { group, groundMesh: road, camera, update, env, grade, fog: [0.03, 0.014, 0.004], fogDen: 0.011, fogH: 30 };
}
function mergeSimple(THREE, geos) {
  let nv = 0, ni = 0; for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), I = new Uint32Array(ni); let ov = 0, oi = 0;
  for (const g of geos) { P.set(g.attributes.position.array, ov * 3); N.set(g.attributes.normal.array, ov * 3); for (let i = 0; i < g.index.count; i++) I[oi + i] = g.index.array[i] + ov; oi += g.index.count; ov += g.attributes.position.count; g.dispose(); }
  const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.BufferAttribute(P, 3)); m.setAttribute('normal', new THREE.BufferAttribute(N, 3)); m.setIndex(new THREE.BufferAttribute(I, 1)); return m;
}
