// golden-ocean.js - "Golden ocean": an open ocean seen from a drone a few metres above the water. A projected-grid sea
// (Gerstner swell + wind sea, two animated detail tiles with slope variance so the sun glitter path widens with distance
// the way it does on film), Fresnel reflection of a per-frame sky cube (clouds and the headland reflect), backlit crest
// subsurface, foam, a physically based kit sky with clouds lit from below, aerial perspective, a cliff headland with a
// lighthouse 2 km off, a fainter coast behind it. Variants: golden sunset (hero), pastel dawn, moonlit night, stormy grey.
// Audio: swell height follows the smoothed bass, glitter the highs, wind/roughness and whitecaps the section energy,
// lightning on rare big accents (storm only). Everything is a pure function of (t, features, seed, variant, quality).
import * as kit from './kit.js?v=9e';
import { BAKE_FS, DOWN4_FS, OCEAN_VS, OCEAN_FS, BEAM_VS, BEAM_FS, DECK_VS, DECK_FS } from './golden-ocean-glsl.js?v=9e';

export const meta = {
  id: 'golden-ocean',
  name: 'Golden ocean',
  group: 'Nature',
  desc: 'An open ocean at golden hour from just above the swell: sun glitter, a lighthouse on the cliffs.',
  variants: [
    { id: 'golden', name: 'Golden sunset' },
    { id: 'dawn', name: 'Pastel dawn', text: { accent: '#f4b8c4' } },
    { id: 'night', name: 'Moonlit night', text: { accent: '#bcd2f0' } },
    { id: 'storm', name: 'Stormy grey', text: { accent: '#c9d2d8' } },
  ],
  defaultVariant: 'golden',
  thumbT: 30,
  text: { ink: '#fbf2e6', accent: '#ffbf73' },
  swatch: ['#2a4a66', '#ffb35c'],
};

// per-variant look. sun/moon: [elevation start, elevation end (over ~6 min), azimuth]. Azimuth -90 = straight ahead (-z).
const LOOKS = {
  golden: {
    sun: [6.5, 2.0, -84], sunI: 4, moon: null, mie: 1.35, mieG: 0.8, rayleigh: 1.0, ms: 0.35,
    clouds: { coverage: 0.36, density: 1.1, height: 2.4, scale: 0.42, softness: 0.42, wind: [0.004, 0.0015] }, cloudDrift: 0.07,
    fog: { density: 1.3e-4, falloff: 0.004, sunStrength: 0.9, sunG: 0.75, noise: 0 },
    swell: 1.0, sea: 1.0, detA: 0.3, detB: 0.34, sigma0: 0.0016, gust: 0.35, foam: 0.05, crestFoam: 0.2, foamJ: 0.55, sss: 0.06, glitter: 1,
    deep: [0.005, 0.02, 0.03], sssCol: [0.03, 0.2, 0.15],
    camY: 1, exposure: 0.52, temperature: 0.1, tint: 0.0, saturation: 1.1, contrast: 1.05, lift: [0.003, 0.003, 0.006], gain: [1.0, 0.985, 0.95],
    bloom: 0.055, rays: 0.32, lamp: 0.25, beam: 0.02, rain: 0, sunVis: 1,
  },
  dawn: {
    sun: [-1.6, 3.2, -76], sunI: 4, moon: null, mie: 2.1, mieG: 0.76, rayleigh: 1.0, ms: 0.45,
    clouds: { coverage: 0.3, density: 0.7, height: 3.0, scale: 0.36, softness: 0.55, wind: [0.003, 0.001] }, cloudDrift: 0.06,
    fog: { density: 2.4e-4, falloff: 0.006, sunStrength: 0.7, sunG: 0.7, noise: 0 },
    swell: 0.55, sea: 0.3, detA: 0.12, detB: 0.2, sigma0: 0.0006, gust: 0.6, foam: 0.0, crestFoam: 0.05, foamJ: 0.5, sss: 0.03, glitter: 1,
    deep: [0.004, 0.012, 0.02], sssCol: [0.04, 0.16, 0.16],
    camY: 0.85, exposure: 1.35, expByElev: [-2, 3.4, 3.5, 1.25], temperature: -0.01, tint: 0.035, saturation: 0.92, contrast: 0.98, lift: [0.006, 0.005, 0.01], gain: [1.0, 0.985, 0.99],
    bloom: 0.06, rays: 0.18, lamp: 0.6, beam: 0.05, rain: 0, sunVis: 1,
  },
  night: {
    sun: [-22, -24, -60], sunI: 4, moon: [12, 21, -87, 0.11, 0.06], mie: 1.4, mieG: 0.8, rayleigh: 1.0, ms: 0.35,
    clouds: { coverage: 0.3, density: 0.9, height: 2.2, scale: 0.4, softness: 0.4, wind: [0.004, 0.0015] }, cloudDrift: 0.08,
    fog: { density: 1.1e-4, falloff: 0.004, sunStrength: 0.6, sunG: 0.75, noise: 0 },
    swell: 0.9, sea: 0.8, detA: 0.24, detB: 0.2, sigma0: 0.0015, gust: 0.35, foam: 0.08, crestFoam: 0.3, foamJ: 0.55, sss: 0.0, glitter: 0.55,
    deep: [0.003, 0.009, 0.018], sssCol: [0.03, 0.2, 0.15],
    camY: 1, exposure: 3.4, temperature: -0.16, tint: 0.0, saturation: 0.85, contrast: 1.06, lift: [0.0, 0.002, 0.006], gain: [1.0, 1.0, 1.02],
    bloom: 0.07, rays: 0, lamp: 1.0, beam: 0.22, rain: 0, sunVis: 1,
  },
  storm: {
    sun: [10, 7, -70], sunI: 4, disc: 0.3, moon: null, mie: 3.0, mieG: 0.72, rayleigh: 1.0, ms: 0.5,
    clouds: { coverage: 0.95, density: 3.6, height: 1.3, scale: 0.55, softness: 0.55, wind: [0.012, 0.005] }, cloudDrift: 0.05,
    fog: { density: 5.5e-4, falloff: 0.006, sunStrength: 0.25, sunG: 0.6, noise: 0.25, wind: [3, 0, 1.5] },
    swell: 2.6, sea: 3.1, detA: 0.4, detB: 0.3, sigma0: 0.009, gust: 0.45, foam: 1.25, crestFoam: 1.2, foamJ: 0.66, sss: 0.05, glitter: 0.45,
    streak: 0.6, envRough: 0.6, deck: { amt: 0.85, brk: 0.55 },
    deep: [0.012, 0.026, 0.023], sssCol: [0.05, 0.17, 0.12],
    camY: 1.8, exposure: 0.62, temperature: -0.06, tint: -0.01, saturation: 0.72, contrast: 1.12, lift: [0.002, 0.003, 0.004], gain: [0.97, 0.99, 1.0],
    bloom: 0.05, rays: 0, lamp: 1.0, beam: 0.35, rain: 1, sunVis: 0.12,
  },
};

const G = 9.81;

export function createScene({ THREE, renderer, width, height, pixelRatio = 1, variant = 'golden', quality = 'high', seed = 1, intensity = 0.6 }) {
  const L = LOOKS[variant] || LOOKS.golden;
  const Q = kit.Q[quality] || kit.Q.high;
  const light = quality === 'light', ultra = quality === 'ultra';
  const bag = kit.createBag();
  const rnd = kit.rng(kit.hashSeed('golden-ocean', variant, seed));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.5, 40000);
  let inten = intensity ?? 0.6;

  // ---------------------------------------------------------------------------------------------- sky + fog
  const sky = bag.add(kit.createSky(THREE, renderer, { quality,
    sky: { sun: { elevation: L.sun[0], azimuth: L.sun[2], intensity: L.sunI, discBrightness: L.disc ?? 40 },
      moon: L.moon ? { elevation: L.moon[0], azimuth: L.moon[2], intensity: L.moon[3], phase: L.moon[4], size: 0.0095 } : { elevation: -30, azimuth: 100, intensity: 0 },
      rayleigh: L.rayleigh, mie: L.mie, mieG: L.mieG, ms: L.ms, altitude: 0.01, groundAlbedo: 0.06, clouds: { ...L.clouds } },
    fog: { ...L.fog, base: 0, skyDistance: 0 } }));
  scene.add(sky.mesh);

  const sunLight = new THREE.DirectionalLight(0xffffff, 1); scene.add(sunLight, sunLight.target);
  const moonLight = new THREE.DirectionalLight(0xffffff, 1); scene.add(moonLight, moonLight.target);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1); scene.add(hemi);
  sunLight.target.position.set(-600, 0, -2000); moonLight.target.position.copy(sunLight.target.position);

  // ---------------------------------------------------------------------------------------------- waves
  // wind sea travels toward the camera, a little to the right; the long swell comes from a different, older storm
  const windAng = Math.PI / 2 + kit.deg(rnd.range(-25, -12));         // direction the waves travel (atan2(z, x))
  const swellAng = Math.PI / 2 + kit.deg(rnd.range(18, 34));
  const NGW = light ? 8 : 12;
  const geoWaves = [];
  const swellL = [118, 83, 61];
  for (let i = 0; i < 3; i++) {
    const a = swellAng + rnd.gauss() * 0.12, Lw = swellL[i] * rnd.range(0.92, 1.08);
    geoWaves.push({ dir: [Math.cos(a), Math.sin(a)], amp: [0.34, 0.2, 0.11][i], len: Lw, q: 0.6, group: 0, phase: rnd.range(0, 6.283) });
  }
  for (let i = 0; i < NGW - 3; i++) {
    const u = i / Math.max(1, NGW - 4);
    const Lw = 34 * Math.pow(3.2 / 34, u) * rnd.range(0.9, 1.1);
    const a = windAng + rnd.gauss() * (0.25 + 0.45 * u);
    const ka = 0.045 * rnd.range(0.8, 1.15) * Math.pow(Math.max(0.2, Math.cos(a - windAng)), 1.5);
    geoWaves.push({ dir: [Math.cos(a), Math.sin(a)], amp: ka * Lw / (2 * Math.PI), len: Lw, q: 0.9, group: 1, phase: rnd.range(0, 6.283) });
  }
  const uGW = geoWaves.map(w => new THREE.Vector4(w.dir[0], w.dir[1], w.amp, w.len));
  const uGP = geoWaves.map(w => new THREE.Vector4(0, w.q, w.group, 0));
  const ampSum = geoWaves.reduce((s, w) => s + w.amp * (w.group ? L.sea : L.swell), 0);

  // detail tiles: two patches (52 m and 6.6 m) of short waves, each with its own dispersion
  const NW = light ? 20 : ultra ? 40 : 32;
  const detSize = light ? 128 : ultra ? 512 : 256;
  const hf = kit.halfFloatOK(renderer);
  const down4 = bag.add(kit.createPass(THREE, { fragment: DOWN4_FS, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } } }));
  function makeTile(tile, label) {
    const r = rnd.fork(label), list = [], seen = new Set();
    let guard = 0;
    while (list.length < NW && guard++ < 4000) {
      const mag = Math.exp(r.range(Math.log(2.2), Math.log(58)));
      const spread = 0.35 + 0.5 * (Math.log(mag) / Math.log(58));
      let a = windAng + r.gauss() * spread; if (r.chance(0.12)) a += Math.PI;   // a few waves against the wind
      const m = Math.round(mag * Math.cos(a)), n = Math.round(mag * Math.sin(a));
      const key = m + ',' + n; if ((m === 0 && n === 0) || seen.has(key)) continue; seen.add(key);
      const kmag = Math.hypot(m, n) * 2 * Math.PI / tile;
      const dirW = Math.pow(Math.max(0.25, Math.cos(Math.atan2(n, m) - windAng)), 1.2);
      list.push({ m, n, k: kmag, om: Math.sqrt(G * kmag + 7.4e-5 * kmag * kmag * kmag), ka: dirW * r.range(0.7, 1.3), phase: r.range(0, 6.283) });
    }
    const norm = Math.sqrt(list.reduce((s, w) => s + w.ka * w.ka * 0.5, 0)) / 0.5;   // RMS slope of the tile = 0.5 (both axes)
    list.forEach(w => { w.ka /= norm; });
    while (list.length < NW) list.push({ m: 1, n: 0, k: 1, om: 0, ka: 0, phase: 0 });
    // explicit 4x mip chain (hardware mipmaps of render targets are not reliable on every GPU/driver, e.g. SwiftShader,
    // and the export must be frame-exact): level 0 is the bake, each next level is a 4x4 box of the previous one
    const levels = [];
    for (let sz = detSize, i = 0; i < 4; i++, sz = Math.max(2, sz >> 2)) {
      levels.push(bag.add(new THREE.WebGLRenderTarget(sz, sz, { type: hf ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: false,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping })));
    }
    const uW = list.map(w => new THREE.Vector4(w.m, w.n, w.ka, 0));
    const pass = bag.add(kit.createPass(THREE, { fragment: BAKE_FS, defines: { NW }, uniforms: { uW: { value: uW }, uTile: { value: tile } } }));
    return { levels, list, uW, pass, tile, update(t) {
      for (let i = 0; i < list.length; i++) uW[i].w = (list[i].phase - list[i].om * t) % (2 * Math.PI);
      const prev = renderer.getRenderTarget(); pass.render(renderer, levels[0]);
      for (let i = 1; i < levels.length; i++) { down4.uniforms.tSrc.value = levels[i - 1].texture; down4.uniforms.uTexel.value.set(1 / levels[i - 1].width, 1 / levels[i - 1].height); down4.render(renderer, levels[i]); }
      renderer.setRenderTarget(prev);
    } };
  }
  const tileA = makeTile(52, 'tileA'), tileB = makeTile(6.6, 'tileB');

  // reflection cube: the sky (clouds, no sun disc: the sun is the analytic glitter) and the headland
  const envSize = light ? 96 : ultra ? 384 : 192;
  // (two cubes instead of mipmaps: a sharp one and a small blurry one for rough water - see the note on mip chains)
  const cubeOpts = { type: hf ? THREE.HalfFloatType : THREE.UnsignedByteType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const cubeRT = bag.add(new THREE.WebGLCubeRenderTarget(envSize, cubeOpts)), cubeBlurRT = bag.add(new THREE.WebGLCubeRenderTarget(light ? 12 : 20, cubeOpts));
  const cubeCam = new THREE.CubeCamera(1, 40000, cubeRT), cubeBlurCam = new THREE.CubeCamera(1, 40000, cubeBlurRT);

  const foamTex = kit.noiseTexture(THREE, renderer, { size: light ? 256 : 512, scale: 8, octaves: 4, seed: 11, kind: 'worley' });
  const gustTex = kit.noiseTexture(THREE, renderer, { size: 256, scale: 4, octaves: 4, seed: 5, kind: 'fbm' });

  const rotA = rnd.range(0, 6.283), rotB = rnd.range(0, 6.283);
  const oceanU = {
    ...sky.fog.uniforms,
    uInvProjView: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uDmax: { value: 24000 }, uPix: { value: 0.003 },
    uSwell: { value: L.swell }, uSea: { value: L.sea }, uAmpNorm: { value: 1 / Math.max(0.05, ampSum) },
    uGW: { value: uGW }, uGP: { value: uGP },
    uDetA0: { value: tileA.levels[0].texture }, uDetA1: { value: tileA.levels[1].texture }, uDetA2: { value: tileA.levels[2].texture }, uDetA3: { value: tileA.levels[3].texture },
    uDetB0: { value: tileB.levels[0].texture }, uDetB1: { value: tileB.levels[1].texture }, uDetB2: { value: tileB.levels[2].texture }, uDetB3: { value: tileB.levels[3].texture },
    uDetSize: { value: detSize }, uEnvBlur: { value: cubeBlurRT.texture }, uFoamTex: { value: foamTex }, uGust: { value: gustTex }, uEnv: { value: cubeRT.texture },
    uEnvSize: { value: envSize },
    uDetAP: { value: new THREE.Vector4(1 / 52, Math.cos(rotA), Math.sin(rotA), L.detA) }, uDetBP: { value: new THREE.Vector4(1 / 6.6, Math.cos(rotB), Math.sin(rotB), L.detB) },
    uSunL: { value: new THREE.Vector3(0, 1, 0) }, uSunE: { value: new THREE.Vector3() }, uMoonL: { value: new THREE.Vector3(0, 1, 0) }, uMoonE: { value: new THREE.Vector3() },
    uAmb: { value: new THREE.Vector3() }, uDeep: { value: new THREE.Vector3(...L.deep) }, uSssCol: { value: new THREE.Vector3(...L.sssCol) }, uFoamLight: { value: new THREE.Vector3() },
    uSigma0: { value: L.sigma0 }, uFoam: { value: L.foam }, uFoamJ: { value: L.foamJ }, uCrestFoam: { value: L.crestFoam }, uGlitter: { value: 1 }, uTime: { value: 0 },
    uGustAmt: { value: L.gust }, uSss: { value: L.sss }, uStreak: { value: L.streak || 0 }, uEnvRough: { value: L.envRough || 0 }, uWind: { value: new THREE.Vector2(Math.cos(windAng) * 1.2, Math.sin(windAng) * 1.2) },
  };
  const oceanMat = bag.add(new THREE.ShaderMaterial({ uniforms: oceanU, defines: { NGW },
    vertexShader: OCEAN_VS, fragmentShader: kit.GLSL.common + kit.GLSL.noise + kit.GLSL.fog + OCEAN_FS }));
  oceanMat.extensions = { derivatives: true };
  // projected grid: a screen-space mesh (NDC with margins for the horizontal wave displacement)
  const gx = light ? 200 : ultra ? 600 : 380, gy = light ? 150 : ultra ? 460 : 300;
  const Y0 = -1.35, Y1 = 1.05, X0 = -1.18, X1 = 1.18;
  const gridGeo = bag.add(new THREE.PlaneGeometry(X1 - X0, Y1 - Y0, gx, gy)); gridGeo.translate((X0 + X1) / 2, (Y0 + Y1) / 2, 0);
  const ocean = new THREE.Mesh(gridGeo, oceanMat); ocean.frustumCulled = false; ocean.name = 'ocean'; scene.add(ocean);

  // ---------------------------------------------------------------------------------------------- headland + lighthouse
  const TIP = [-560, -2050], AX = (() => { const l = Math.hypot(1, 0.3); return [1 / l, 0.3 / l]; })(), PERP = [-AX[1], AX[0]];
  const s1 = (kit.hashSeed('go-land', seed) % 1000) + 1;
  function inland(x, z) {
    const dx = x - TIP[0], dz = z - TIP[1];
    const along = dx * AX[0] + dz * AX[1], across = dx * PERP[0] + dz * PERP[1];
    const wig = 55 * kit.fbm2(x * 0.0045, z * 0.0045, { octaves: 4, seed: s1 }) + 12 * kit.fbm2(x * 0.03, z * 0.03, { octaves: 2, seed: s1 + 3 });
    const halfW = 280 * Math.sqrt(kit.clamp(-along / 520 + 0.03)) + Math.max(0, -along) * 0.1;
    return halfW - Math.abs(across) + wig - Math.max(along, 0) * 1.5;
  }
  function landH(x, z) {
    const d = inland(x, z);
    if (d < -60) return -14;
    const cliffH = 46 + 26 * kit.fbm2(x * 0.0018 + 5, z * 0.0018, { octaves: 3, seed: s1 + 7 });
    const face = kit.smoothstep(-5, 16, d) * 0.82 + kit.smoothstep(-12, 40, d) * 0.18;
    const ledges = 3.5 * Math.sin(d * 0.9 + 3 * kit.noise2(x * 0.02, z * 0.02, s1));
    const hills = (18 * kit.fbm2(x * 0.0035, z * 0.0035, { octaves: 4, seed: s1 + 9 }) + 0.035 * Math.max(0, d - 20)) * kit.smoothstep(10, 120, d);
    return cliffH * face + hills + ledges * face * (1 - face) * 2.5 - 14 * (1 - face);
  }
  const landGeo = bag.add(kit.heightfield(THREE, { width: 2900, depth: 1700, segX: light ? 150 : ultra ? 420 : 300, segZ: light ? 90 : ultra ? 250 : 176, height: () => 0 }));
  landGeo.translate(-1950, 0, -2550);
  { const p = landGeo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, landH(p.getX(i), p.getZ(i))); landGeo.computeVertexNormals(); }
  {
    const p = landGeo.attributes.position, n = landGeo.attributes.normal, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = n.getY(i);
      const v = kit.fbm2(x * 0.02, z * 0.02, { octaves: 3, seed: s1 + 21 }) * 0.5 + 0.5, strata = 0.5 + 0.5 * Math.sin(y * 1.7 + v * 3);
      const rock = [0.13 + 0.05 * strata, 0.11 + 0.04 * strata, 0.095 + 0.03 * strata].map(c => c * (0.75 + 0.5 * v));
      const grass = [0.05 + 0.03 * v, 0.065 + 0.025 * v, 0.03 + 0.01 * v];
      const g = kit.smoothstep(0.62, 0.86, ny) * kit.smoothstep(4, 14, y);
      const wet = kit.smoothstep(4, 0.5, y);
      for (let k = 0; k < 3; k++) col[i * 3 + k] = kit.lerp(rock[k], grass[k], g) * (1 - 0.45 * wet);
    }
    landGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const landMat = bag.add(sky.patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 })));
  const land = new THREE.Mesh(landGeo, landMat); land.name = 'land'; scene.add(land);

  // a far coast behind and to the left (layering: water -> headland -> hazy hills)
  const farGeo = bag.add(kit.heightfield(THREE, { width: 16000, depth: 3000, segX: light ? 120 : 220, segZ: light ? 16 : 28, height: () => 0 }));
  farGeo.translate(-9000, 0, -11500);
  { const p = farGeo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i);
    const front = kit.smoothstep(-10000, -10600, z), side = kit.smoothstep(-2600, -6500, x);
    const h = (70 + 300 * kit.ridged2(x * 0.00035, z * 0.0006, { octaves: 5, seed: s1 + 31 })) * front * side;
    p.setY(i, h - 25); } farGeo.computeVertexNormals(); }
  const farMat = bag.add(sky.patch(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.05, 0.06, 0.045), roughness: 0.95 })));
  const far = new THREE.Mesh(farGeo, farMat); scene.add(far);

  // lighthouse on the tip: tower, gallery, lantern room, cap, keeper's house
  const lhPos = [TIP[0] - AX[0] * 70, 0, TIP[1] - AX[1] * 70]; lhPos[1] = landH(lhPos[0], lhPos[2]) - 0.5;
  const paint = bag.add(sky.patch(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.72, 0.71, 0.68), roughness: 0.55 })));
  const iron = bag.add(sky.patch(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.03, 0.03, 0.03), roughness: 0.4, metalness: 0.6 })));
  const roofM = bag.add(sky.patch(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.16, 0.05, 0.04), roughness: 0.7 })));
  const glassM = bag.add(sky.patch(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.02, 0.02, 0.02), emissive: new THREE.Color(1, 0.86, 0.62), emissiveIntensity: 0, roughness: 0.2 })));
  const lh = new THREE.Group(); lh.position.set(lhPos[0], lhPos[1], lhPos[2]); scene.add(lh);
  const addPart = (geo, mat, y, x = 0, z = 0) => { const m = new THREE.Mesh(bag.add(geo), mat); m.position.set(x, y, z); lh.add(m); return m; };
  addPart(new THREE.CylinderGeometry(2.1, 3.1, 21, 20), paint, 10.5);
  addPart(new THREE.CylinderGeometry(2.7, 2.5, 0.5, 20), iron, 21.2);
  addPart(new THREE.CylinderGeometry(1.55, 1.55, 2.6, 16), glassM, 22.75);
  addPart(new THREE.ConeGeometry(1.85, 1.7, 16), iron, 24.9);
  const house = addPart(new THREE.BoxGeometry(10, 4.4, 6.5), paint, 2.2, -11, 4);
  const roof = addPart(new THREE.CylinderGeometry(3.9, 3.9, 10.4, 3, 1), roofM, 4.4 + 1.0, -11, 4); roof.rotation.z = Math.PI / 2; roof.scale.set(1, 1, 0.9);
  house.rotation.y = roof.rotation.y = 0.3;
  const lampPos = new THREE.Vector3(lhPos[0], lhPos[1] + 22.75, lhPos[2]);

  // the rotating beam (two opposite cones of lit haze) and the lamp's glare
  const BEAM_LEN = 1400, BEAM_R = 60;
  const beamGeo = bag.add(new THREE.ConeGeometry(BEAM_R, BEAM_LEN, 20, 1, true)); beamGeo.translate(0, -BEAM_LEN / 2, 0); beamGeo.rotateZ(Math.PI / 2);
  const beams = [0, 1].map(() => {
    const u = { ...sky.fog.uniforms, uApex: { value: lampPos.clone() }, uDir: { value: new THREE.Vector3(1, 0, 0) }, uColor: { value: new THREE.Vector3() }, uLen: { value: BEAM_LEN }, uRad: { value: BEAM_R }, uFall: { value: 420 } };
    const m = bag.add(new THREE.ShaderMaterial({ uniforms: u, vertexShader: BEAM_VS, fragmentShader: kit.GLSL.common + kit.GLSL.noise + kit.GLSL.fog + BEAM_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    const mesh = new THREE.Mesh(beamGeo, m); mesh.position.copy(lampPos); mesh.frustumCulled = false; mesh.renderOrder = 5; scene.add(mesh);
    return { mesh, u };
  });
  const glowTex = kit.cached(renderer, 'golden-ocean:glow:64', () => kit.dataTexture(THREE, 64, 64, (x, y) => {
    const dx = (x + 0.5) / 32 - 1, dy = (y + 0.5) / 32 - 1, r = Math.hypot(dx, dy);
    const v = Math.max(0, Math.exp(-r * r * 30) + 0.25 * Math.exp(-r * 6) - 0.25 * Math.exp(-6)) * kit.smoothstep(1, 0.85, r);
    return [v, v, v, 1];
  }));
  const glowMat = bag.add(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  glowMat.map = glowTex;   // cached: the bag skips it
  const glow = new THREE.Sprite(glowMat); glow.position.copy(lampPos); glow.renderOrder = 6; scene.add(glow);

  // storm: a low dark deck with racing scud, multiplied over the kit sky (also seen by the reflection cube)
  let deck = null;
  if (L.deck) {
    const du = { uTime: { value: 0 }, uAmt: { value: L.deck.amt }, uBreak: { value: L.deck.brk }, uOct: { value: light ? 3 : 5 },
      uWindC: { value: new THREE.Vector2(Math.cos(windAng) * -0.012, Math.sin(windAng) * -0.012) }, uSunD: { value: new THREE.Vector3(0, 1, 0) } };
    const dm = bag.add(new THREE.ShaderMaterial({ uniforms: du, vertexShader: DECK_VS, fragmentShader: kit.GLSL.common + kit.GLSL.noise + DECK_FS,
      side: THREE.BackSide, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
      blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, blendEquation: THREE.AddEquation }));
    deck = new THREE.Mesh(bag.add(new THREE.SphereGeometry(20000, 48, 24)), dm);
    deck.frustumCulled = false; deck.renderOrder = -1e9 + 1; deck.name = 'storm-deck'; scene.add(deck);
    deck.userData.u = du;
  }

  // storm rain (streaks only, no splashes on open water)
  const rain = L.rain ? bag.add(kit.createParticles(THREE, renderer, { kind: 'rain', quality, fog: sky.fog.uniforms, seed, box: [30, 18, 30] })) : null;
  if (rain) scene.add(rain.object);

  // ---------------------------------------------------------------------------------------------- post + camera
  const post = bag.add(kit.createPost(THREE, renderer, { width, height, pixelRatio, quality, tonemap: 'aces', dof: false }));
  Object.assign(post.grade, { exposure: L.exposure, temperature: L.temperature, tint: L.tint, saturation: L.saturation, contrast: L.contrast, lift: L.lift, gain: L.gain,
    vignette: variant === 'storm' ? 0.45 : 0.32, aberration: 0.0012, dirt: 0.05 });
  post.grade.bloom = { strength: L.bloom, threshold: 0, knee: 0.5, radius: 1 };
  post.grade.rays = { strength: L.rays, density: 0.85, decay: 0.962 };

  const cy = L.camY;
  const path = kit.cameraPath([
    { pos: [0, 3.4 * cy, 0], look: [45, 3.4 * cy - 50, -1000], fov: 38, portrait: { look: [70, 3.4 * cy - 78, -1000], fov: 36 } },
    { pos: [-22, 4.6 * cy, -30], look: [10, 4.6 * cy - 55, -1000], fov: 36, portrait: { look: [55, 4.6 * cy - 84, -1000], fov: 35 } },
    { pos: [-48, 2.7 * cy, -52], look: [70, 2.7 * cy - 42, -1000], fov: 40, portrait: { look: [80, 2.7 * cy - 72, -1000], fov: 37 } },
    { pos: [-20, 5.6 * cy, -95], look: [25, 5.6 * cy - 60, -1000], fov: 37, portrait: { look: [60, 5.6 * cy - 90, -1000], fov: 35 } },
  ], { period: 290, breathe: 0.14, seed, fovWiden: 0.55 });

  // ---------------------------------------------------------------------------------------------- per frame
  const tmpV = new THREE.Vector3(), toCam = new THREE.Vector3(), beamDir = new THREE.Vector3();
  const hideForCube = [ocean, glow, beams[0].mesh, beams[1].mesh]; if (rain) hideForCube.push(rain.object);
  const cubeOnlySky = [land, far, lh];

  function render(t, f = {}) {
    const k = inten;
    const bass = f.bass || 0, bright = f.bright || 0, energy = f.energy || 0;
    // light: a slow sunset / sunrise / moonrise over ~6 minutes, plus slow wander
    const prog = kit.smootherstep(0, 380, t);
    sky.params.sun.elevation = kit.lerp(L.sun[0], L.sun[1], prog) + 0.25 * Math.sin(t / 97 + seed);
    sky.params.sun.azimuth = L.sun[2] + 1.5 * prog + 0.4 * Math.sin(t / 151);
    if (L.moon) { sky.params.moon.elevation = kit.lerp(L.moon[0], L.moon[1], prog) + 0.3 * Math.sin(t / 113); sky.params.moon.azimuth = L.moon[2] - 2 * prog; }
    const C = sky.params.clouds;
    C.coverage = kit.clamp(L.clouds.coverage + L.cloudDrift * Math.sin(t / 131 + 0.7 * seed) + 0.04 * Math.sin(t / 59 + 2.1) + (variant === 'storm' ? 0.04 * kit.soft(energy, 0.5) * k : 0), 0, 0.98);
    sky.params.nightGlow = [0, 0, 0];
    const fl = variant === 'storm' ? kit.lightning(t, f, seed) * (0.4 + 0.6 * k) : 0;
    if (fl > 0) sky.params.nightGlow = [fl * 0.5, fl * 0.55, fl * 0.7];
    sky.fog.params.density = L.fog.density * (1 + 0.12 * Math.sin(t / 173 + 1.2) + (variant === 'storm' ? 0.2 * Math.sin(t / 71) : 0));
    sky.update(t);
    sky.applyLights({ sun: sunLight, moon: moonLight, hemi, distance: 3000, target: sunLight.target.position });

    // sun visibility through the cloud deck (storm: rare soft breaks)
    let sunVis = L.sunVis;
    if (variant === 'storm') sunVis = 0.08 + 0.35 * Math.pow(kit.smoothstep(0.55, 1, 0.5 + 0.5 * Math.sin(t / 47 + seed) * Math.sin(t / 83 + 1)), 2);
    else sunVis *= 1 - 0.55 * kit.smoothstep(0.55, 0.9, C.coverage);
    sunLight.intensity = sunVis;

    // waves: swell follows the bass, wind sea + roughness follow the section energy (both smoothed, +-15-25%)
    const sw = bass, wd = energy;   // both already smoothed by features.js (no extra state: same t + features = same frame)
    const swellAmp = L.swell * (1 + 0.08 * Math.sin(t / 151 + 0.4) + 0.2 * k * kit.soft(sw, 0.6));
    const seaAmp = L.sea * (1 + 0.1 * Math.sin(t / 109 + 2.0) + 0.18 * k * kit.soft(wd, 0.6));
    oceanU.uSwell.value = swellAmp; oceanU.uSea.value = seaAmp;
    for (let i = 0; i < geoWaves.length; i++) { const w = geoWaves[i], kk = 2 * Math.PI / w.len; uGP[i].x = (w.phase - Math.sqrt(G * kk) * t) % (2 * Math.PI); }
    const rough = 1 + 0.1 * Math.sin(t / 89 + 0.3) + 0.2 * k * kit.soft(wd, 0.6);
    oceanU.uDetAP.value.w = L.detA * rough; oceanU.uDetBP.value.w = L.detB * rough;
    oceanU.uFoam.value = L.foam * (1 + 0.5 * k * kit.soft(wd, 0.6)) * (1 + 0.15 * Math.sin(t / 67));
    oceanU.uGlitter.value = L.glitter * (1 + 0.25 * k * kit.soft(bright, 0.5));
    oceanU.uTime.value = t;
    tileA.update(t); tileB.update(t);

    // light into the water shader
    oceanU.uSunL.value.copy(sky.sunDir);
    oceanU.uSunE.value.set(sky.sunColor.r, sky.sunColor.g, sky.sunColor.b).multiplyScalar(sunVis * (sky.params.sun.elevation > -3 ? 1 : 0));
    oceanU.uMoonL.value.copy(sky.moonDir);
    const mVis = L.moon ? 1 - 0.6 * kit.smoothstep(0.5, 0.9, C.coverage) : 0;
    oceanU.uMoonE.value.set(sky.moonColor.r, sky.moonColor.g, sky.moonColor.b).multiplyScalar(mVis * (sky.params.moon.elevation > -1 ? 1 : 0));
    const amb = sky.ambient.sky;
    oceanU.uAmb.value.set(amb.r + fl * 0.6, amb.g + fl * 0.65, amb.b + fl * 0.8);
    oceanU.uFoamLight.value.copy(oceanU.uSunE.value);
    hemi.intensity = 1 + fl * 2;

    // camera
    const cam = path.apply(camera, t, { breath: (f.slow || 0) * k });
    camera.updateMatrixWorld();
    oceanU.uCamPos.value.copy(camera.position);
    oceanU.uInvProjView.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    oceanU.uPix.value = (Y1 - Y0) / gy * Math.tan(kit.deg(camera.fov) / 2);
    void cam;

    // lighthouse: lamp on at dusk/night, two beams sweeping every 16 s, a flash when one faces the camera
    const ang = (t / 16) * Math.PI * 2 + seed;
    const lampOn = L.lamp;
    toCam.copy(camera.position).sub(lampPos); const camDist = toCam.length(); toCam.normalize();
    let flash = 0;
    beams.forEach((b, i) => {
      const a = ang + i * Math.PI; beamDir.set(Math.cos(a), -0.012, Math.sin(a)).normalize();
      b.mesh.quaternion.setFromUnitVectors(tmpV.set(1, 0, 0), beamDir);
      b.u.uDir.value.copy(beamDir); b.u.uApex.value.copy(lampPos);
      const c = kit.kelvin(4200); b.u.uColor.value.set(c[0], c[1], c[2]).multiplyScalar(L.beam * lampOn);
      b.mesh.visible = L.beam > 0.001;
      const cosA = beamDir.x * toCam.x + beamDir.z * toCam.z;
      flash += Math.pow(Math.max(0, cosA), 900);
    });
    const fogT = Math.exp(-sky.fog.params.density * camDist * 0.9);
    const lampI = lampOn * (2.5 + 1400 * flash) * fogT;
    glowMat.color.setRGB(1.0 * lampI, 0.86 * lampI, 0.64 * lampI);
    glow.scale.setScalar(camDist * 0.006 * (1 + 2.5 * Math.min(1, flash * 2)));
    glow.visible = lampOn > 0;
    glassM.emissiveIntensity = lampOn * 6;

    if (deck) {
      const du = deck.userData.u; deck.position.copy(camera.position); deck.updateMatrixWorld();
      du.uTime.value = t; du.uSunD.value.copy(sky.sunDir);
      // the deck thickens and thins over minutes; a loud section darkens it a little more
      du.uAmt.value = L.deck.amt * kit.clamp(0.82 + 0.12 * Math.sin(t / 79 + seed) + 0.06 * Math.sin(t / 137) + 0.08 * k * kit.soft(energy, 0.5), 0, 1);
      du.uBreak.value = L.deck.brk * kit.clamp(sunVis * 2.2, 0, 1);
    }
    if (rain) {
      const a2 = sky.ambient.sky;
      rain.update(t, camera, { density: 0.3 + 0.45 * kit.soft(energy, 0.5) * (0.5 + k), wind: [3.2, 0, 1.6], gust: 0.5, shutter: 1 / 50,
        ambient: [a2.r * 0.3 + fl, a2.g * 0.3 + fl, a2.b * 0.33 + fl * 1.1], brightness: 0.8, focus: 4 });
    }

    // reflection cube from the camera (sky without the analytic sun/moon discs, plus the land)
    const vis = hideForCube.map(o => o.visible); hideForCube.forEach(o => { o.visible = false; });
    sky.uniforms.uEnvPass.value = 1;
    cubeCam.position.copy(camera.position); cubeCam.updateMatrixWorld();
    cubeCam.update(renderer, scene);
    const vis2 = cubeOnlySky.map(o => o.visible); cubeOnlySky.forEach(o => { o.visible = false; });
    cubeBlurCam.position.copy(camera.position); cubeBlurCam.updateMatrixWorld();
    cubeBlurCam.update(renderer, scene);
    cubeOnlySky.forEach((o, i) => { o.visible = vis2[i]; });
    sky.uniforms.uEnvPass.value = 0;
    hideForCube.forEach((o, i) => { o.visible = vis[i]; });

    // grade: bloom breathes a little with the bass; lightning lifts exposure for an instant
    post.grade.bloom.strength = L.bloom * (1 + 0.25 * k * kit.soft(bass, 0.6));
    let ex = L.exposure;
    if (L.expByElev) { const e = L.expByElev; ex = Math.exp(kit.lerp(Math.log(e[1]), Math.log(e[3]), kit.smoothstep(e[0], e[2], sky.params.sun.elevation))); }
    post.grade.exposure = ex * (1 + fl * 0.35);
    post.setSun(sky.sunDir, camera);
    post.render(scene, camera, t);
  }

  function resize(w, h, pr = 1) { camera.aspect = w / h; camera.updateProjectionMatrix(); post.resize(w, h, pr); }
  resize(width, height, pixelRatio);
  return {
    render, resize,
    setIntensity(v) { inten = kit.clamp(v); },
    dispose() { bag.dispose(); scene.clear(); },
  };
}
