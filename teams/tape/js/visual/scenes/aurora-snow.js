// aurora-snow.js - "Northern lights": a snowy boreal spruce forest around a frozen lake under the aurora borealis.
// The viewer stands on the near shore of a bay at eye height, looking north across ~500 m of wind-packed snow and black
// ice to a forested far shore, low hills and distant mountains. A small log cabin with a warm window sits on the far
// shore. The aurora is a set of physically-placed emitting curtains at 100-300 km altitude, 120-500 km to the north
// (so the lower border sits 10-30 degrees up, rays reach out of frame), integrated analytically in a full-screen pass
// (aurora-snow-glsl.js) that the planar mirror reflects in the black ice. Variants: green aurora (hero), violet
// (a strong display with pink/violet lower fringes and red tops, a thin moon), snowfall night (no aurora, moonlight
// through cloud, heavy snow) and twilight (deep blue hour, first stars, a faint arc appearing late).
import * as kit from './kit.js?v=9c';
import * as S from './aurora-snow-glsl.js?v=9c';
import { spruceGeometry, terrainGrid, cabinGeometries } from './aurora-snow-geo.js?v=9c';

export const meta = {
  id: 'aurora-snow',
  name: 'Northern lights',
  group: 'Nature',
  desc: 'Aurora curtains over a frozen lake, snow-laden spruces, a warm cabin window far away.',
  variants: [
    { id: 'green', name: 'Green aurora', text: { ink: '#eef6f2', accent: '#7ff0be' } },
    { id: 'violet', name: 'Violet aurora', text: { ink: '#f3eef8', accent: '#d59cff' } },
    { id: 'snowfall', name: 'Snowfall night', text: { ink: '#eef1f6', accent: '#ffc98a' } },
    { id: 'twilight', name: 'Twilight', text: { ink: '#eef2fa', accent: '#9fc4ff' } },
  ],
  defaultVariant: 'green',
  thumbT: 40,
  text: { ink: '#eef6f2', accent: '#7ff0be' },
  swatch: ['#0b1a2c', '#5ff0b0'],
};

// ------------------------------------------------------------------------------------------------ looks
// Units: kit HDR (a white wall in noon sun ~1.3). Night scenes run at exposure ~4-7.
const LOOKS = {
  green: { sun: [-24, -150], moon: { el: -12, az: 160, i: 0, phase: 0.5 }, clouds: 0, aurora: 1, red: 0.1, purple: 0.25,
    colG: [0.16, 1.0, 0.33], colR: [1.0, 0.07, 0.20], colP: [0.62, 0.22, 1.0], surge: 0.5,
    stars: 1, milky: 0.0038, airglow: 0.0022, nightGlow: [0.0010, 0.0016, 0.0030], fog: { density: 0.00022, falloff: 0.004, noise: 0.15 },
    exposure: 5.2, temperature: -0.04, tint: 0.0, saturation: 1.0, contrast: 1.06, lift: [0.0012, 0.0022, 0.0042], gain: [1, 1.0, 1.0], bloom: 0.055,
    snow: 0.14, snowSize: 1, iceSnow: 0.47, window: 1, wind: [0.25, 0, 0.08], night: [0.0068, 0.0094, 0.0168] },
  violet: { sun: [-26, -140], moon: { el: 7, az: 200, i: 0.011, phase: 0.18 }, clouds: 0, aurora: 1.2, red: 0.34, purple: 0.95,
    colG: [0.08, 0.95, 0.42], colR: [1.0, 0.04, 0.16], colP: [0.55, 0.18, 1.0], surge: 0.8,
    stars: 0.9, milky: 0.0032, airglow: 0.0016, nightGlow: [0.0012, 0.0012, 0.0030], fog: { density: 0.00024, falloff: 0.004, noise: 0.15 },
    exposure: 4.6, temperature: -0.02, tint: 0.04, saturation: 1.02, contrast: 1.07, lift: [0.0022, 0.0016, 0.0046], gain: [1, 0.98, 1.0], bloom: 0.06,
    snow: 0.12, snowSize: 1, iceSnow: 0.5, window: 1, wind: [0.3, 0, 0.1], night: [0.006, 0.0075, 0.014] },
  snowfall: { sun: [-30, -150], moon: { el: 30, az: -125, i: 0.07, phase: 0.45 }, clouds: 0.74, cloudDensity: 1.2, aurora: 0, red: 0, purple: 0,
    colG: [0.1, 1, 0.4], colR: [1, 0.1, 0.2], colP: [0.6, 0.2, 1], surge: 0,
    stars: 0.5, milky: 0.0, airglow: 0.0, nightGlow: [0.0018, 0.0021, 0.0030], fog: { density: 0.0008, falloff: 0.006, noise: 0.35, sunStrength: 0.25, skyDistance: 2600, tint: [0.75, 0.8, 0.9] },
    exposure: 3.0, temperature: -0.1, tint: 0.0, saturation: 0.92, contrast: 1.08, lift: [0.0006, 0.001, 0.002], gain: [1, 1, 1.02], bloom: 0.065,
    snow: 0.3, snowSize: 1.7, iceSnow: 0.28, window: 1.25, wind: [0.55, 0, 0.18], night: [0.006, 0.0075, 0.011] },
  twilight: { sun: [-4.2, -160], moon: { el: -10, az: 60, i: 0, phase: 0.5 }, clouds: 0.0, aurora: 0.32, red: 0.2, purple: 0.0,
    colG: [0.12, 1.0, 0.42], colR: [1.0, 0.1, 0.2], colP: [0.6, 0.2, 1], surge: 0,
    stars: 1, milky: 0.004, airglow: 0.0, nightGlow: [0, 0, 0], fog: { density: 0.0003, falloff: 0.004, noise: 0.15, sunStrength: 0.4 },
    exposure: 9, temperature: -0.28, tint: -0.03, saturation: 1.05, contrast: 1.05, lift: [0.001, 0.0018, 0.004], gain: [1, 1, 1], bloom: 0.05,
    snow: 0.1, snowSize: 1, iceSnow: 0.47, window: 0.9, wind: [0.2, 0, 0.06], night: [0.002, 0.003, 0.006] },
};

// ------------------------------------------------------------------------------------------------ the land (metres; x east, -z north)
const LAKE = { cx: -20, cz: -265, rx: 390, rz: 255 };
// kit.smoother, but a re-render of the same t (with other features, e.g. silence) recomputes that step from the state
// before it instead of keeping a stale value, so any frame is a pure function of the previous frame and its own inputs.
function smoother({ attack = 0.3, release = 1.5 } = {}) {
  let y = 0, last = null, y0 = 0, last0 = null;
  const adv = (yy, dt, x) => yy + (x - yy) * (1 - Math.exp(-dt / (x > yy ? attack : release)));
  return {
    step(t, x) {
      if (last !== null && t === last) { y = last0 === null ? x : adv(y0, t - last0, x); return y; }
      if (last === null || t < last || t - last > 1) { y0 = y = x; last0 = null; last = t; return y; }
      y0 = y; last0 = last; y = adv(y, t - last, x); last = t; return y;
    },
    get value() { return y; },
  };
}
function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, t = kit.clamp(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz));
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}
/** Signed distance to the shore in metres: > 0 on land, < 0 on the lake. */
function shoreD(x, z) {
  const ex = (x - LAKE.cx) / LAKE.rx, ez = (z - LAKE.cz) / LAKE.rz;
  let d = (Math.hypot(ex, ez) - 1) * 250 + 26 * kit.fbm2(x / 170, z / 170, { octaves: 4, seed: 11 });
  d = Math.max(d, 11 - segDist(x, z, -34, 3, 30, 3) + 3 * kit.noise2(x / 14, z / 14, 4));        // the near bank we stand on
  d = Math.max(d, 15 - segDist(x, z, 28, 0, 98, -128) + 7 * kit.noise2(x / 28, z / 28, 5));      // spit on the right
  d = Math.max(d, 13 - segDist(x, z, -42, 4, -88, -72) + 6 * kit.noise2(x / 24, z / 24, 6));     // spit on the left
  d = Math.max(d, 24 - Math.hypot(x + 205, z + 335) + 6 * kit.noise2(x / 20, z / 20, 7));         // a small island
  d = Math.max(d, 9 - Math.hypot((x - 15) / 1.25, z + 13) + 2.5 * kit.noise2(x / 9, z / 9, 14));       // a wooded point, right
  d = Math.max(d, 8 - Math.hypot((x + 17) / 1.3, z + 15) + 2.5 * kit.noise2(x / 9, z / 9, 15));        // and one on the left
  return d;
}
function mountains(x, z) {
  const r = Math.hypot(x + 20, (z + 700) * 0.85);
  const m = kit.smoothstep(1700, 4800, r);
  return m * (120 + 820 * kit.ridged2(x / 2900, z / 2900, { octaves: 4, seed: 3 })) + kit.smoothstep(900, 2600, r) * 60;
}
function groundH(x, z) {
  const d = shoreD(x, z);
  if (d < 0) return Math.max(-1.5, d * 0.08);
  let h = 0.12 + 0.85 * kit.smoothstep(0, 16, d);
  h += kit.smoothstep(20, 420, d) * (25 + 75 * kit.ridged2(x / 650, z / 650, { octaves: 5, seed: 9 }));
  h += 0.5 * kit.fbm2(x / 11, z / 11, { octaves: 3, seed: 8 }) * kit.smoothstep(2, 10, d);
  const nc = Math.hypot(x, z);
  if (nc < 60) h += (0.22 * kit.fbm2(x / 3.2, z / 2.2, { octaves: 3, seed: 12 }) + 0.06 * kit.noise2(x / 0.9, z / 0.7, 13)) * kit.smoothstep(60, 20, nc) * kit.smoothstep(0, 4, d);
  return h + mountains(x, z);
}

export function createScene({ THREE, renderer, width, height, pixelRatio = 1, variant = 'green', quality = 'high', seed = 1, intensity = 0.6 }) {
  const L = LOOKS[variant] || LOOKS.green;
  const Q = kit.Q[quality] || kit.Q.high, light = quality === 'light', ultra = quality === 'ultra';
  const bag = kit.createBag();
  const rnd = kit.rng(kit.hashSeed('aurora-snow', seed));          // the world layout is the same in every variant
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 30000);
  const sd = (seed % 997) * 0.731;

  // ---------------------------------------------------------------------------------------------- sky, fog, lights
  const sky = bag.add(kit.createSky(THREE, renderer, { quality, sky: {
    sun: { elevation: L.sun[0], azimuth: L.sun[1], intensity: 4 }, moon: { elevation: L.moon.el, azimuth: L.moon.az, intensity: L.moon.i, phase: L.moon.phase, size: 0.0095 },
    rayleigh: 1, mie: 0.8, mieG: 0.78, altitude: 0.3, stars: L.stars, milky: [0, 0, 0], nightGlow: L.nightGlow, groundAlbedo: 0.6, ms: 0.45,
    clouds: { coverage: L.clouds, density: L.cloudDensity || 1, height: 1.6, scale: 0.5, wind: [0.004, 0.0015], softness: 0.42, opacity: 1 } },
  fog: { base: 0, sunG: 0.6, sunStrength: 0.3, ...L.fog } }));
  scene.add(sky.mesh);
  const sun = new THREE.DirectionalLight(0xffffff, 1), moon = new THREE.DirectionalLight(0xffffff, 1), auroraL = new THREE.DirectionalLight(0x66ffaa, 0);
  const hemi = new THREE.HemisphereLight(0x223344, 0x111111, 1);
  auroraL.position.set(0, 60, -100); auroraL.target.position.set(0, 0, 0);
  scene.add(sun, sun.target, moon, moon.target, auroraL, auroraL.target, hemi);

  // ---------------------------------------------------------------------------------------------- aurora + stars overlay
  const NC = light ? 2 : 3, STEPS = light ? 20 : ultra ? 48 : 34;
  const skyU = {
    uInvProjView: { value: new THREE.Matrix4() },
    uCurt: { value: Array.from({ length: NC }, () => new THREE.Vector4()) }, uCurtB: { value: Array.from({ length: NC }, () => new THREE.Vector4()) },
    uColG: { value: new THREE.Vector3(...L.colG) }, uColR: { value: new THREE.Vector3(...L.colR) }, uColP: { value: new THREE.Vector3(...L.colP) },
    uExtK: { value: new THREE.Vector3(0.05, 0.062, 0.09) }, uMWN: { value: new THREE.Vector3(0.62, 0.42, 0.66).normalize() }, uMWC: { value: new THREE.Vector3(-0.55, 0.35, -0.2).normalize() },
    uAirCol: { value: new THREE.Vector3(0.35, 1.0, 0.45) },
    uTilt: { value: new Array(NC).fill(0) }, uEnvBias: { value: 0 }, uWin: { value: Array.from({ length: NC }, () => new THREE.Vector4()) }, uTau: { value: 0 }, uFold: { value: 0.5 }, uGain: { value: 0 }, uRed: { value: L.red }, uPurple: { value: L.purple }, uMilky: { value: L.milky }, uStars: { value: 0 },
    uAirglow: { value: L.airglow }, uTime: { value: 0 }, uTwinkle: { value: 0.3 }, uLsat: { value: 34 },
  };
  // the aurora is marched at half resolution into its own target (it is soft; the rays survive), the stars stay at full
  // resolution in the overlay that also adds the aurora texture; the mirror pass marches its own (already low-res) copy.
  Object.assign(skyU, { uAurTex: { value: null }, uInvRes: { value: new THREE.Vector2(1, 1) } });
  const mkSky = (defines, overlay) => {
    const m = new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: S.SKY_VS, fragmentShader: kit.GLSL.common + kit.GLSL.noise + S.SKY_FS,
      defines: { NC, ...defines }, transparent: overlay, depthTest: overlay, depthWrite: false, blending: overlay ? THREE.AdditiveBlending : THREE.NoBlending });
    m.extensions = { derivatives: true };
    return bag.add(m);
  };
  const triGeo = bag.add(new THREE.BufferGeometry());
  triGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const m4 = new THREE.Matrix4();
  const skyMesh = mat => { const me = new THREE.Mesh(triGeo, mat); me.frustumCulled = false; me.renderOrder = -10;
    me.onBeforeRender = (r, s, cam) => { m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); skyU.uInvProjView.value.copy(m4).invert(); }; return me; };
  const overlay = skyMesh(mkSky({ STARS: 1, AUR_TEX: 1 }, true));            // main view: stars + the half-res aurora
  const mirrorSky = skyMesh(mkSky({ STARS: 1, AURORA: 1, STEPS: Math.max(14, Math.round(STEPS * 0.6)) }, true));   // mirror view
  const auroraMesh = skyMesh(mkSky({ AURORA: 1, STEPS }, false));
  const auroraScene = new THREE.Scene(); auroraScene.add(auroraMesh);
  const aurRT = bag.add(new THREE.WebGLRenderTarget(2, 2, { type: kit.halfFloatOK(renderer) ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
  aurRT.texture.userData.kitShared = true;
  skyU.uAurTex.value = aurRT.texture;
  mirrorSky.visible = false;
  scene.add(overlay, mirrorSky);

  // ---------------------------------------------------------------------------------------------- terrain (snow)
  const tsz = light ? 512 : 1024;
  const snowH = kit.cached(renderer, 'aurora-snow:snowH:' + tsz, () => kit.bakeTexture(THREE, renderer, { width: tsz, fragment: `vec4 bake(vec2 uv) {
    float drift = kFbm2p(uv * 3.0, vec2(3.0), 5);
    vec2 q = vec2(uv.x * 5.0 + 0.35 * kFbm2p(uv * 4.0, vec2(4.0), 3), uv.y * 18.0);
    float rip = kFbm2p(q, vec2(5.0, 18.0), 4);
    float grain = kFbm2p(uv * 48.0, vec2(48.0), 3);
    return vec4(drift * 0.55 + rip * 0.3 + grain * 0.15); }` }));
  const snowN = kit.cached(renderer, 'aurora-snow:snowN:' + tsz, () => kit.normalMapFromHeight(THREE, renderer, snowH, { strength: 2.2 }));
  const glintU = { uGlint: { value: new THREE.Vector3() }, uGlintAmt: { value: 1 } };
  const groundMat = bag.add(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0, normalMap: snowN, normalScale: new THREE.Vector2(0.9, 0.9), envMapIntensity: 0.6 }));
  groundMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, glintU);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + kit.GLSL.common + kit.GLSL.noise + S.GROUND_FRAG_HEAD)
      .replace('#include <color_fragment>', S.GROUND_FRAG_COLOR).replace('#include <normal_fragment_maps>', light ? '#include <normal_fragment_maps>' : S.GROUND_FRAG_NORMAL).replace('#include <opaque_fragment>', S.GROUND_FRAG_OUT);
  };
  groundMat.customProgramCacheKey = () => 'aurora-ground' + (light ? '-l' : '');
  sky.patch(groundMat); groundMat.extensions = { derivatives: true };
  const g = Q.geometry;
  const forestMask = (x, z, d) => kit.smoothstep(150, 260, d) * kit.smoothstep(-0.25, 0.25, kit.fbm2(x / 260, z / 260, { octaves: 3, seed: 21 }) + 0.25);
  const nearGeo = bag.add(terrainGrid(THREE, { x0: -1100, x1: 1100, z0: -1700, z1: 160, cx: 0, cz: 0, segX: Math.round(250 * g), segZ: Math.round(230 * g),
    height: groundH, color: (x, z) => { const d = shoreD(x, z); return [forestMask(x, z, d) * 0.9, 0, 0]; } }));
  const near = new THREE.Mesh(nearGeo, groundMat); scene.add(near);
  const inNear = (x, z) => Math.min(kit.smoothstep(1100, 900, Math.abs(x)), kit.smoothstep(-1700, -1450, z), kit.smoothstep(160, 100, z));
  const farGeo = bag.add(terrainGrid(THREE, { x0: -14000, x1: 14000, z0: -16000, z1: 3000, cx: 0, cz: -300, segX: Math.round(300 * g), segZ: Math.round(240 * g), uvScale: 40,
    height: (x, z) => groundH(x, z) - 3 - 30 * inNear(x, z),
    color: (x, z, y) => {
      const e = 0.5, hx = groundH(x + e * 60, z) - groundH(x - e * 60, z), hz = groundH(x, z + e * 60) - groundH(x, z - e * 60), slope = Math.hypot(hx, hz) / 60;
      const n = kit.fbm2(x / 500, z / 500, { octaves: 3, seed: 33 });
      const forest = kit.smoothstep(560, 380, y + 90 * n) * kit.smoothstep(0.75, 0.45, slope) * 0.85;
      const rock = kit.smoothstep(0.55, 0.95, slope + 0.2 * n) * kit.smoothstep(250, 400, y);
      return [forest, rock, 0];
    } }));
  const far = new THREE.Mesh(farGeo, groundMat); scene.add(far);

  // ---------------------------------------------------------------------------------------------- the lake ice
  const mirror = bag.add(kit.createMirror(THREE, renderer, { y: 0, quality, width, height, pixelRatio, resolution: light ? 0.35 : ultra ? 0.75 : 0.5 }));
  // distance from the shore into the lake, baked once (it is the same land in every variant and seed)
  const shoreTex = (key, x0, z0, sx, sz, w, h) => kit.cached(renderer, 'aurora-snow:shore:' + key, () =>
    kit.dataTexture(THREE, w, h, (i, j) => { const v = kit.clamp(-shoreD(x0 + (i + 0.5) / w * sx, z0 + (j + 0.5) / h * sz) / 20); return [v, v, v, 1]; }));
  const shoreN = shoreTex('n', -40, -50, 80, 60, 128, 96), shoreF = shoreTex('f', -520, -720, 1040, 820, 256, 202);
  const iceU = { uMirror: { value: mirror.texture }, uMirrorMatrix: { value: mirror.matrix }, uMirrorOn: mirror.uniforms.uMirrorOn, uIceSnow: { value: L.iceSnow }, uMirrorK: { value: 1 },
    uShoreN: { value: shoreN }, uShoreF: { value: shoreF }, uShoreBN: { value: new THREE.Vector4(-40, -50, 1 / 80, 1 / 60) }, uShoreBF: { value: new THREE.Vector4(-520, -720, 1 / 1040, 1 / 820) } };
  const iceMat = bag.add(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0, envMapIntensity: 0.6 }));
  iceMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, iceU);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + kit.GLSL.common + kit.GLSL.noise + S.ICE_FRAG_HEAD)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + S.ICE_FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', S.ICE_FRAG_ROUGH).replace('#include <opaque_fragment>', S.ICE_FRAG_OUT);
  };
  iceMat.customProgramCacheKey = () => 'aurora-ice';
  sky.patch(iceMat); iceMat.extensions = { derivatives: true };
  const iceGeo = bag.add(new THREE.PlaneGeometry(2400, 1600, 1, 1)); iceGeo.rotateX(-Math.PI / 2); iceGeo.translate(-20, 0, -300);
  const ice = new THREE.Mesh(iceGeo, iceMat); scene.add(ice);

  // ---------------------------------------------------------------------------------------------- spruces
  const swayU = { uTime: { value: 0 }, uSway: { value: new THREE.Vector2() } };
  const treeMat = bag.add(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5,
    alphaTest: 0.5, alphaToCoverage: !light }));
  treeMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, swayU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + S.TREE_VERT_HEAD).replace('#include <begin_vertex>', S.TREE_VERT_BEGIN);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + kit.GLSL.common + kit.GLSL.noise + S.TREE_FRAG_HEAD)
      .replace('#include <color_fragment>', S.TREE_FRAG_COLOR).replace('#include <roughnessmap_fragment>', S.TREE_FRAG_ROUGH).replace('#include <normal_fragment_maps>', S.TREE_FRAG_NORMAL);
  };
  treeMat.customProgramCacheKey = () => 'aurora-tree';
  sky.patch(treeMat);
  const geoRnd = rnd.fork('trees-geo');
  const LODS = [[0, 0, 0], [1, 1, 1], [2, 2]].map(l => l.map(lod => bag.add(spruceGeometry(THREE, geoRnd, lod, light))));
  const lists = LODS.map(v => v.map(() => []));
  const cabinPos = (() => {                 // on the far shore, a little left of centre, ~14 m up from the ice edge
    const x = -58; let z = -420; for (; z > -700; z -= 2) if (shoreD(x, z) > 16) break;
    return { x, z, y: groundH(x, z) };
  })();
  const add = (lod, x, z, h, wf = 1, snow = null) => {
    const r = rnd;
    const y = groundH(x, z) - 0.15;
    const vi = r.int(LODS[lod].length);
    lists[lod][vi].push({ x, y, z, h, w: h * wf * (0.85 + 0.3 * r()), ry: r() * Math.PI * 2, snow: snow ?? (0.45 + 0.55 * r()), tone: r(), s: r() });
  };
  // hero trees on the near bank (they frame the view at the sides) and a few young ones at the water's edge
  [[11.2, -14.8, 13.5], [15.6, -11.2, 16.5], [14.6, -17.8, 7.2, 1.1], [10.6, -12.2, 3.1, 1.2], [19.5, -15.5, 11.5], [-14.2, -16.5, 12.0], [-18.8, -12.0, 15.0],
   [-12.6, -13.8, 2.6, 1.3], [-21, -17, 10.5], [-6.8, -8.6, 1.9, 1.3], [8.2, -8.8, 2.4, 1.2], [20, -7, 9.5], [-21, -7, 8.5], [17, 4, 13], [-19, 5, 12]]
    .forEach(([x, z, h, wf]) => add(0, x, z, h, wf || 1));
  // the spits: mid-ground trees 25-170 m away
  const spit = (ax, az, bx, bz, wdt, n) => {
    for (let i = 0, k = 0; i < n && k < n * 8; k++) {
      const t = rnd(), x = kit.lerp(ax, bx, t) + rnd.range(-wdt, wdt), z = kit.lerp(az, bz, t) + rnd.range(-wdt, wdt);
      const d = shoreD(x, z); if (d < 2.5 || Math.hypot(x, z) < 18) continue;
      const dist = Math.hypot(x, z), h = rnd.range(5, 17) * (d < 6 ? 0.6 : 1);
      add(dist < 45 ? 0 : 1, x, z, h); i++;
    }
  };
  spit(28, 0, 98, -128, 14, Math.round(70 * g)); spit(-42, 4, -88, -72, 12, Math.round(45 * g)); spit(-205, -335, -205, -335, 20, Math.round(26 * g));
  // the far shore: a dense band along the water and a sparser forest over the hills behind
  {
    const nBand = Math.round(2900 * g * (light ? 0.7 : 1)), nHill = Math.round(1900 * g * (light ? 0.6 : 1));
    let band = 0, hill = 0;
    for (let k = 0; k < 90000 && (band < nBand || hill < nHill); k++) {
      const x = rnd.range(-1050, 950), z = rnd.range(-1650, -300), d = shoreD(x, z);
      if (d < 2 || Math.hypot(x - cabinPos.x, z - cabinPos.z) < 15) continue;
      if (z > -60 && Math.abs(x) < 140) continue;
      const m = kit.fbm2(x / 140, z / 140, { octaves: 3, seed: 41 });
      if (d < 170) { if (band >= nBand || m < -0.35 || rnd() > 0.9) continue; band++; }
      else { if (hill >= nHill || m < -0.05 || rnd() > 0.5) continue; hill++; }
      add(2, x, z, rnd.range(8, 19) * (d < 8 ? 0.7 : 1), 1, 0.12 + 0.3 * rnd());
    }
  }
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpC = new THREE.Color(), yAx = new THREE.Vector3(0, 1, 0);
  let treeCount = 0; const farTrees = [];
  LODS.forEach((vars, lod) => vars.forEach((geo, vi) => {
    const list = lists[lod][vi]; if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, treeMat, list.length);
    list.forEach((t, i) => {
      tmpQ.setFromAxisAngle(yAx, t.ry); tmpS.set(t.w, t.h, t.w); tmpP.set(t.x, t.y, t.z);
      im.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS)); im.setColorAt(i, tmpC.setRGB(t.snow, t.tone, t.s));
    });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere(); im.frustumCulled = lod < 2;
    treeCount += list.length; scene.add(bag.add(im)); if (lod === 2) farTrees.push(im);
  }));

  // ---------------------------------------------------------------------------------------------- shore boulders
  {
    const bgeo = bag.add(new THREE.IcosahedronGeometry(1, light ? 2 : 3));
    const bp = bgeo.attributes.position;
    for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i); const k = 1 + 0.22 * kit.noise3(x * 1.3, y * 1.3, z * 1.3, 51) + 0.07 * kit.noise3(x * 4, y * 4, z * 4, 52); bp.setXYZ(i, x * k, y * k * 0.72, z * k); }
    bgeo.computeVertexNormals();
    { const bn = bgeo.attributes.normal, acc = new Map(), keyOf = i => Math.round(bp.getX(i) * 1e4) + ',' + Math.round(bp.getY(i) * 1e4) + ',' + Math.round(bp.getZ(i) * 1e4);
      for (let i = 0; i < bp.count; i++) { const k = keyOf(i), a = acc.get(k) || [0, 0, 0]; a[0] += bn.getX(i); a[1] += bn.getY(i); a[2] += bn.getZ(i); acc.set(k, a); }
      for (let i = 0; i < bp.count; i++) { const a = acc.get(keyOf(i)), l = Math.hypot(a[0], a[1], a[2]) || 1; bn.setXYZ(i, a[0] / l, a[1] / l, a[2] / l); } }
    const bmat = bag.add(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }));
    bmat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBN; varying vec3 vBP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvBP = position;\n#ifdef USE_INSTANCING\nvBN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);\n#else\nvBN = normalize(mat3(modelMatrix) * normal);\n#endif');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBN; varying vec3 vBP;\n' + kit.GLSL.common + kit.GLSL.noise)
        .replace('#include <color_fragment>', `float kS = smoothstep(0.25, 0.6, vBN.y + 0.25 * kFbm3(vBP * 3.0, 3));
          vec3 kR = vec3(0.045, 0.043, 0.04) * (0.6 + 0.8 * kFbm3(vBP * 6.0, 4));
          diffuseColor.rgb = mix(kR, vec3(0.82, 0.85, 0.9), kS);`);
    };
    bmat.customProgramCacheKey = () => 'aurora-boulder';
    sky.patch(bmat);
    const spots = [[3.2, -9.6, 0.7], [-3.5, -10.6, 0.5], [9.5, -11.5, 1.1], [-9.8, -10.2, 0.8], [1.2, -13.5, 0.35], [24, -14, 1.4], [-26, -12, 1.2], [6.6, -12.8, 0.45]];
    const bm = new THREE.InstancedMesh(bgeo, bmat, spots.length);
    spots.forEach(([x, z, r], i) => { tmpQ.setFromAxisAngle(yAx, i * 2.1); tmpS.set(r * 1.2, r, r); tmpP.set(x, Math.max(0, groundH(x, z)) - r * 0.25, z); bm.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS)); });
    bm.instanceMatrix.needsUpdate = true; bm.computeBoundingSphere();
    scene.add(bag.add(bm));
  }

  // ---------------------------------------------------------------------------------------------- the cabin
  const cab = cabinGeometries(THREE);
  const logMat = bag.add(sky.patch(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.07, 0.042, 0.026), roughness: 0.85 })));
  const cabSnowMat = bag.add(sky.patch(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.82, 0.85, 0.9), roughness: 0.8 })));
  const stoneMat = bag.add(sky.patch(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.06, 0.055, 0.05), roughness: 0.9 })));
  const warm = kit.kelvin(2050);
  const winMat = bag.add(sky.patch(new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(warm[0] * 6, warm[1] * 6, warm[2] * 6) })));
  const dimMat = bag.add(sky.patch(new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(warm[0] * 0.6, warm[1] * 0.6, warm[2] * 0.6) })));
  const cabin = new THREE.Group();
  for (const [geo, mat] of [[cab.walls, logMat], [cab.snow, cabSnowMat], [cab.eaves, logMat], [cab.chimney, stoneMat], [cab.windowLit, winMat], [cab.windowDim, dimMat]]) { bag.add(geo); cabin.add(new THREE.Mesh(geo, mat)); }
  cabin.position.set(cabinPos.x, cabinPos.y - 0.25, cabinPos.z);
  cabin.rotation.y = Math.atan2(-cabinPos.x, -cabinPos.z) * 0.8 + 0.15;
  scene.add(cabin);
  const winLight = new THREE.PointLight(new THREE.Color(...warm), 0, 26, 2);
  winLight.position.set(0, 1.4, 3.2).applyEuler(cabin.rotation).add(cabin.position);
  scene.add(winLight);

  // ---------------------------------------------------------------------------------------------- falling snow
  const flakes = bag.add(kit.createParticles(THREE, renderer, { kind: 'snow', quality, fog: sky.fog.uniforms, seed: seed + 5, count: 9000, box: [34, 18, 34], size: 0.0075 * L.snowSize, speed: 0.8 }));
  scene.add(flakes.object);

  // ---------------------------------------------------------------------------------------------- post + camera
  const post = bag.add(kit.createPost(THREE, renderer, { width, height, pixelRatio, quality, tonemap: 'agx', rays: false, dof: !light, ca: !light, dirt: true }));
  Object.assign(post.grade, { exposure: L.exposure, temperature: L.temperature, tint: L.tint, saturation: L.saturation, contrast: L.contrast, lift: L.lift, gain: L.gain,
    vignette: 0.38, aberration: 0.0018, dirt: 0.06 });
  post.grade.bloom = { strength: L.bloom, threshold: 0, knee: 0.5, radius: 1 };
  post.grade.dof = { focus: 400, range: 1200, strength: 0.25 };   // landscape at infinity: only the far mountains soften
  const gh = (x, z) => groundH(x, z);
  const key = (x, z, lx, ly, fov, portrait) => ({ pos: [x, gh(x, z) + 1.7, z], look: [lx, ly, -500], fov, portrait });
  const path = kit.cameraPath([
    key(-2.2, 1.2, -38, 78, 50, { look: [-10, 255, -500], fov: 52 }),
    key(0.8, 0.2, -12, 84, 49, { look: [12, 262, -500], fov: 51 }),
    key(3.6, -0.6, 12, 80, 50, { look: [30, 258, -500], fov: 52 }),
  ], { period: 280, breathe: 0.022, seed, fovWiden: 0.55 });

  // ---------------------------------------------------------------------------------------------- per frame
  const midS = smoother({ attack: 1.6, release: 4 }), bigS = smoother({ attack: 0.4, release: 5 }), enS = smoother({ attack: 2, release: 5 });
  let envT = -1e9;
  const target = new THREE.Vector3(0, 0, -60);
  const curt = [
    { base: 345, swing: 45, per: 173, amp: 52, bright: 1.0, w: 5.0, drift: 9, fold: 1.0, hb: 0, ph: 0.3, tilt: 0.42, win: [-40, 330, 120], wsw: 90 },
    { base: 600, swing: 60, per: 211, amp: 70, bright: 0.45, w: 10.0, drift: -6, fold: 0.6, hb: 6, ph: 2.1, tilt: -0.08, win: [80, 700, 200], wsw: 150 },
    { base: 170, swing: 30, per: 137, amp: 34, bright: 0.55, w: 4.0, drift: 13, fold: 1.2, hb: -2, ph: 4.4, tilt: 0.3, win: [-230, 120, 70], wsw: 120 },
  ];
  function auroraAt(t, f, info) {
    const surgeT = info.duration > 30 ? info.duration * 0.56 : 150;
    let act = 0.8 + 0.15 * Math.sin(t / 83 + sd) + 0.1 * Math.sin(t / 151 + 2 * sd) + L.surge * Math.exp(-Math.pow((t - surgeT) / 38, 2));
    if (variant === 'twilight') act *= 0.15 + 0.85 * kit.smoothstep(70, 260, t);
    const en = enS.step(t, f.energy || 0);
    act *= 1 + intensity * (0.22 * kit.soft(en, 0.6) + 0.12 * (f.level || 0));
    act += intensity * 0.55 * bigS.step(t, f.big || 0);
    return Math.max(0, act) * L.aurora;
  }
  function render(t, f, info = {}) {
    // light: twilight deepens slowly over the song; the moon creeps
    const skyAt = tt => {
      const el = variant === 'twilight' ? L.sun[0] - 4.8 * kit.smoothstep(0, 360, tt) : L.sun[0];
      sky.params.sun.elevation = el; sky.params.sun.azimuth = L.sun[1] + tt * 0.004;
      sky.params.moon.elevation = L.moon.el + tt * 0.0025; sky.params.moon.azimuth = L.moon.az + tt * 0.004;
      if (L.clouds > 0) sky.params.clouds.coverage = kit.clamp(L.clouds + 0.07 * Math.sin(tt / 97 + sd) + 0.04 * Math.sin(tt / 41));
      return el;
    };
    // the IBL is baked on a fixed time grid (from the sky at the grid time), so a seek or a resumed export gets the same env
    const tq = Math.floor(t / Q.envEvery) * Q.envEvery;
    if (tq !== envT) { skyAt(tq); sky.update(tq); scene.environment = sky.bakeEnvironment(); envT = tq; }
    const sunEl = skyAt(t);
    sky.update(t);
    sky.applyLights({ sun, moon, target });

    // aurora: activity drifts over minutes, breathes with the section energy, surges on rare big accents
    const act = auroraAt(t, f, info);
    const mid = midS.step(t, f.mid || 0);
    const tau = t * 0.055 + (f.flow || 0) * 0.018 * intensity;
    skyU.uTau.value = tau; skyU.uTime.value = t;
    skyU.uFold.value = kit.clamp(0.38 + 0.22 * Math.sin(t / 97 + sd) + 0.35 * intensity * mid);
    skyU.uGain.value = act > 0.002 ? 0.003 : 0;
    skyU.uEnvBias.value = 0.1 + 0.12 * Math.sin(t / 109 + sd) + 0.25 * (act - 0.8);
    // tall frames: the display is a little closer (higher in the sky), so the curtains fill the frame up toward the zenith
    const pnear = 1 - 0.32 * kit.portraitness(camera.aspect);
    let lightSum = 0;
    for (let i = 0; i < NC; i++) {
      const c = curt[i], b = c.bright * act * (0.82 + 0.18 * Math.sin(t / (59 + i * 17) + i * 1.7 + sd));
      skyU.uCurt.value[i].set((c.base + c.swing * Math.sin(t / c.per + c.ph + sd)) * pnear, c.amp, b, c.ph * 3.1 + sd);
      skyU.uWin.value[i].set(c.win[0] + c.wsw * Math.sin(t / (131 + 37 * i) + 2 * i + sd), c.win[1] * (0.85 + 0.15 * Math.sin(t / (89 + 19 * i) + i)), c.win[2], 0);
      skyU.uTilt.value[i] = c.tilt * (1 + 0.25 * Math.sin(t / (149 + 23 * i) + i));
      skyU.uCurtB.value[i].set(c.w, c.drift * tau, c.fold, c.hb + 3 * Math.sin(t / 121 + i));
      lightSum += b * (i === 1 ? 0.5 : 1);
    }
    skyU.uStars.value = L.stars * kit.clamp((-sunEl - 6) / 8) * (1 - 0.9 * kit.clamp(L.clouds * (L.clouds > 0 ? sky.params.clouds.coverage / L.clouds : 0)));
    skyU.uTwinkle.value = 0.22 + 0.25 * intensity * (f.bright || 0);
    // the aurora lights the snow: a soft green-led wash from the north + some of it in the sky ambient
    const cg = L.colG, cr = L.colR, cp = L.colP, kd = 0.014 * lightSum, kr = L.red * 0.08, kp = L.purple * 0.12;
    auroraL.color.setRGB(cg[0] + cr[0] * kr + cp[0] * kp, cg[1] + cr[1] * kr + cp[1] * kp, cg[2] + cr[2] * kr + cp[2] * kp);
    auroraL.intensity = kd; auroraL.visible = kd > 1e-4;
    const amb = sky.ambient.sky;
    hemi.color.setRGB(amb.r + L.night[0] + auroraL.color.r * kd * 0.3, amb.g + L.night[1] + auroraL.color.g * kd * 0.3, amb.b + L.night[2] + auroraL.color.b * kd * 0.3);
    hemi.groundColor.setRGB(hemi.color.r * 0.45, hemi.color.g * 0.47, hemi.color.b * 0.5);
    hemi.intensity = 1;

    // the cabin window: a fire inside (slow flicker), a touch brighter with the music
    const fl = kit.flicker(t, 7 + seed, { speed: 0.7, depth: 0.22 }) * (1 + intensity * 0.12 * (f.level || 0));
    const wk = L.window * fl;
    winMat.color.setRGB(warm[0] * 1.7 * wk, warm[1] * 1.7 * wk, warm[2] * 1.7 * wk);
    winLight.intensity = 9 * wk;

    // glints in the snow follow the brightest light around
    const gl = 0.6 + 0.6 * intensity * (f.bright || 0);
    glintU.uGlint.value.set(moon.visible ? moon.color.r * 3 + auroraL.color.r * kd * 2 : auroraL.color.r * kd * 2.5, moon.visible ? moon.color.g * 3 + auroraL.color.g * kd * 2 : auroraL.color.g * kd * 2.5,
      moon.visible ? moon.color.b * 3 + auroraL.color.b * kd * 2 : auroraL.color.b * kd * 2.5).multiplyScalar(gl);

    // camera: a very slow dolly along the bank; the breath follows the 3 s loudness
    path.apply(camera, t, { breath: (f.slow || 0) * intensity });

    // wind + snow
    const en = enS.value;
    const wind = [L.wind[0] * (1 + 0.5 * intensity * en), 0, L.wind[2]];
    const w = kit.windAt(t, wind, 0.35);
    swayU.uTime.value = t; swayU.uSway.value.set(0.0012 + 0.004 * Math.abs(w[0]), 0.0008 + 0.003 * Math.abs(w[2]));
    const fa = hemi.color;
    flakes.update(t, camera, { density: kit.clamp(L.snow * (1 + 0.25 * intensity * en)), wind, gust: 0.35, shutter: 1 / 50,
      ambient: [fa.r * 0.9 + moon.color.r * 0.5, fa.g * 0.9 + moon.color.g * 0.5, fa.b * 0.9 + moon.color.b * 0.5], brightness: 1.1, focus: 9, bokeh: 1 });

    post.grade.bloom.strength = L.bloom * (1 + 0.25 * intensity * (f.bass || 0));
    post.grade.exposure = L.exposure * (variant === 'twilight' ? 1 + 1.4 * kit.smoothstep(0, 360, t) : 1);
    flakes.object.visible = false; overlay.visible = false; mirrorSky.visible = true;
    mirror.update(scene, camera, { hide: light ? [ice, ...farTrees] : [ice] });   // light: the far forest is a few pixels in the ice
    flakes.object.visible = true; overlay.visible = true; mirrorSky.visible = false;
    // the half-res aurora for this view
    const prevRT = renderer.getRenderTarget(), ac = renderer.autoClear;
    renderer.setRenderTarget(aurRT); renderer.autoClear = true; renderer.render(auroraScene, camera); renderer.setRenderTarget(prevRT); renderer.autoClear = ac;
    post.render(scene, camera, t);
  }
  function resize(w, h, pr = 1) {
    camera.aspect = w / h; camera.updateProjectionMatrix(); post.resize(w, h, pr); mirror.resize(w, h, pr);
    const fw = Math.max(2, Math.round(w * pr)), fh = Math.max(2, Math.round(h * pr)), k = light ? 0.4 : ultra ? 0.66 : 0.5;
    aurRT.setSize(Math.max(2, Math.round(fw * k)), Math.max(2, Math.round(fh * k))); skyU.uInvRes.value.set(1 / fw, 1 / fh);
  }
  resize(width, height, pixelRatio);
  return {
    render, resize,
    dispose() { scene.environment = null; bag.dispose(); scene.clear(); },
    debug: { treeCount },
  };
}
