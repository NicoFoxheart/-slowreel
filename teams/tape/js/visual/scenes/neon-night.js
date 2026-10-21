// neon-night.js - "Neon night drive": an Antent / future-garage night in the rain. Wet asphalt mirrors the neon,
// vertical Hangul lightboxes stack up the walls of a narrow Seoul alley, power cables sag overhead, steam drifts from a
// kitchen vent, a traffic light changes at the alley mouth where cars pass. Variants: Seoul alley (pink / cyan), Tokyo
// crossing (warm / white, slow crane over the zebra crossings), highway tunnel (sodium lights passing overhead) and
// night train window (the city sliding past behind wet glass with the carriage reflected in it).
// Light: every sign, shop and lamp is baked into per-vertex irradiance (neon-night-city.js), the ground mirrors the
// scene with roughness streaks, fog + halos scatter the light, the kit post chain grades it (AgX, bloom, DOF, grain).
import * as kit from './kit.js?v=9b';
import { ASPHALT_FS, SKY_VS, SKY_FS, PRE } from './neon-night-glsl.js?v=9b';
import { glyphAtlas } from './neon-night-glyphs.js?v=9b';
import { buildCity, lin } from './neon-night-city.js?v=9b';
import { buildTunnel } from './neon-night-tunnel.js?v=9b';
import { buildTrain } from './neon-night-train.js?v=9b';

export const meta = {
  id: 'neon-night', name: 'Neon night drive', group: 'Night city',
  desc: 'A wet neon street at night in the rain: signs glowing in the puddles, steam, cables and passing headlights.',
  variants: [
    { id: 'seoul', name: 'Seoul alley', text: { ink: '#f4eef8', accent: '#ff5fa8' } },
    { id: 'tokyo', name: 'Tokyo crossing', text: { ink: '#f8f2e8', accent: '#ffc27a' } },
    { id: 'tunnel', name: 'Highway tunnel', text: { ink: '#fbefe0', accent: '#ff9a3c' } },
    { id: 'train', name: 'Night train', text: { ink: '#eef2f8', accent: '#8fd0ff' } },
  ],
  defaultVariant: 'seoul', thumbT: 24,
  text: { ink: '#f4eef8', accent: '#ff5fa8' }, swatch: ['#1a0f2e', '#ff4fa0'],
};

// ---------------------------------------------------------------------------------------------- palettes
const K = kit.kelvin;
const PAL = {
  seoul: {
    neon: [[1, 0.06, 0.32], [1, 0.06, 0.32], [0.95, 0.08, 0.75], [0.08, 0.75, 1], [0.08, 0.75, 1], [0.2, 0.35, 1], [1, 0.12, 0.06], [0.25, 1, 0.55], [1, 0.45, 0.1]],
    box: [{ bg: [1, 1, 1], fg: [0.8, 0.02, 0.05] }, { bg: [1, 0.97, 0.98], fg: [0.02, 0.08, 0.5] }, { bg: [0.9, 0.04, 0.3], fg: [1, 1, 1], white: true }, { bg: [0.05, 0.55, 1], fg: [1, 1, 1], white: true },
      { bg: [0.06, 0.06, 0.5], fg: [0.3, 0.95, 1], white: true }, { bg: [1, 0.62, 0.05], fg: [0.15, 0.02, 0.01] }, { bg: [0.92, 0.2, 0.62], fg: [1, 1, 1], white: true }, { bg: [0.02, 0.7, 0.62], fg: [1, 1, 1], white: true }],
    neonI: 11, boxI: 3.0, shop: K(6200), shopWarm: K(3000), shopI: 1.0, winWarm: K(2900), winCool: K(5600), winI: 0.55, screen: [[0.2, 0.5, 1]], screenI: 2.5,
    brick: r => [r.range(0.16, 0.24), r.range(0.07, 0.1), r.range(0.05, 0.07)],
    tiles: [[0.42, 0.38, 0.32], [0.5, 0.5, 0.48], [0.32, 0.36, 0.4], [0.45, 0.33, 0.25]],
    paint: [[0.38, 0.37, 0.35], [0.46, 0.43, 0.37], [0.3, 0.35, 0.33], [0.4, 0.36, 0.4]],
    fog: [0.026, 0.016, 0.04], fogDen: 0.017, fogH: 9, sky: { zenith: [0.0016, 0.0013, 0.0032], glow: [0.05, 0.022, 0.05], glowH: 0.5 },
    lamp: K(4200), lampSodium: K(2100), env: { left: [1, 0.1, 0.45], right: [0.1, 0.7, 1], low: K(5500) },
    grade: { exposure: 0.9, temperature: -0.03, tint: 0.04, saturation: 1.1, contrast: 1.1, lift: [0.004, 0.002, 0.008], gain: [1.02, 0.97, 1.03], vignette: 0.42, bloom: 0.085 },
  },
  tokyo: {
    neon: [[1, 0.55, 0.15], [1, 0.75, 0.4], [1, 0.12, 0.06], [1, 0.9, 0.75], [0.3, 0.9, 0.6], [1, 0.3, 0.45]],
    box: [{ bg: [1, 0.96, 0.88], fg: [0.02, 0.02, 0.02] }, { bg: [1, 0.96, 0.88], fg: [0.75, 0.03, 0.02] }, { bg: [1, 0.98, 0.95], fg: [0.02, 0.1, 0.45] }, { bg: [1, 0.72, 0.18], fg: [0.1, 0.03, 0.01] },
      { bg: [0.85, 0.08, 0.04], fg: [1, 1, 0.95], white: true }, { bg: [0.05, 0.05, 0.06], fg: [1, 0.85, 0.6], white: true }, { bg: [0.1, 0.45, 0.2], fg: [1, 1, 1], white: true }, { bg: [1, 0.85, 0.6], fg: [0.3, 0.05, 0.02] }],
    neonI: 9, boxI: 3.4, shop: K(5200), shopWarm: K(3100), shopI: 1.6, winWarm: K(3000), winCool: K(5000), winI: 0.85,
    screen: [[1, 0.75, 0.5], [0.6, 0.8, 1], [1, 0.5, 0.35], [0.9, 0.9, 1]], screenI: 3.0,
    brick: r => [r.range(0.2, 0.26), r.range(0.12, 0.15), r.range(0.09, 0.11)],
    tiles: [[0.5, 0.47, 0.42], [0.55, 0.55, 0.53], [0.35, 0.34, 0.33], [0.44, 0.4, 0.36]],
    paint: [[0.42, 0.41, 0.39], [0.5, 0.48, 0.44], [0.34, 0.34, 0.35]],
    fog: [0.02, 0.016, 0.014], fogDen: 0.0105, fogH: 18, sky: { zenith: [0.0022, 0.002, 0.0026], glow: [0.06, 0.04, 0.03], glowH: 0.45 },
    lamp: K(3600), lampSodium: K(2200), env: { left: [1, 0.75, 0.45], right: [1, 0.95, 0.85], low: K(4500) },
    grade: { exposure: 1.2, temperature: 0.06, tint: 0.0, saturation: 0.98, contrast: 1.07, lift: [0.004, 0.003, 0.002], gain: [1.03, 1.0, 0.95], vignette: 0.4, bloom: 0.075 },
  },
};

PAL.train = { ...PAL.tokyo, neon: [...PAL.seoul.neon, ...PAL.tokyo.neon], box: [...PAL.tokyo.box, ...PAL.seoul.box.slice(2, 6)], neonI: 10, fog: [0.02, 0.016, 0.026], fogDen: 0.012, fogH: 14 };

// ---------------------------------------------------------------------------------------------- layouts
function seoulLayout(r) {
  const common = { w: [4.2, 9], floors: [2, 5], gH: [3.4, 4.0], styles: [[0, 0.35], [1, 0.3], [2, 0.25], [3, 0.1]], shops: [[0, 0.3], [1, 0.3], [2, 0.15], [3, 0.25]],
    lit: [0.25, 0.6], signs: 1, vert: 1.25, ac: 0.1, pipes: 0.3, clutter: 0.4, clearZ: 6, gaps: 0.12, setback: 0.3, vMax: 6.2 };
  const poles = [];
  const zs = [26, 12, -2, -16, -30, -44, -58];
  for (const x of [-34, -12, 14, 37]) poles.push({ x: x + r.range(-2, 2), z: -66.6, h: 10, lamp: { dir: [0, -1], color: PAL.seoul.lampSodium, I: 26, h: 7 } });
  for (const x of [-25, 2, 25]) poles.push({ x: x + r.range(-2, 2), z: -78.4, h: 10, lamp: { dir: [0, 1], color: PAL.seoul.lamp, I: 26, h: 7 } });
  zs.forEach((z, i) => { const s = i % 2 ? 1 : -1; poles.push({ x: s * 2.78, z: z + r.range(-1.5, 1.5), h: r.range(10, 11), lamp: i % 2 === 0 || i === 3 ? { dir: [-s, 0], color: i === 3 ? PAL.seoul.lampSodium : PAL.seoul.lamp, I: i === 3 ? 22 : 30, h: 6.3 } : null }); });
  return {
    id: 'seoul', neonShare: 0.4, faulty: 0.06, markMode: 0, halfW: 3.1,
    runs: [
      { ...common, p0: [-3.1, 32], p1: [-3.1, -66] },
      { ...common, p0: [3.1, -66], p1: [3.1, 32] },
      { ...common, p0: [-70, -79], p1: [70, -79], floors: [3, 6], vert: 1, signs: 1.1, crosses: 0.08, shops: [[0, 0.6], [3, 0.25], [1, 0.15]] },
      { ...common, p0: [-90, -112], p1: [90, -112], floors: [14, 24], gH: [3, 3.2], w: [14, 24], styles: [[1, 0.5], [2, 0.5]], shops: [[4, 1]], lit: [0.35, 0.65], signs: 0, vert: 0, ac: 0, pipes: 0, clutter: 0, crosses: 0.25, fh: 2.8 },
    ],
    grounds: [{ x0: -3.1, x1: 3.1, z0: -66, z1: 32 }, { x0: -70, x1: 70, z0: -79, z1: -66, cell: 1.2 }, { x0: -90, x1: 90, z0: -112, z1: -79, cell: 6, surf: 0 }],
    poles, drops: 3,
    traffic: { x: 4.3, z: -67.2, h: 5.6, arm: [-3.4, 0], face: 1 },
    lanes: [{ axis: 'x', c: -70.2, dir: 1, v: 7.5, span: 150, from: -75, n: 3 }, { axis: 'x', c: -74.4, dir: -1, v: 6.5, span: 150, from: -75, n: 3 }],
    steam: [{ p: [2.85, 2.7, -12.5], col: [0.05, 0.035, 0.03], rise: 3.4, k: 0.6 }, { p: [-2.9, 0.15, -27], col: [0.03, 0.03, 0.045], rise: 2.6, size: 0.8, k: 0.4 }],
    words: [[0.2, -7, 3, 1.0], [-0.3, -37, 7, 1.0]],
  };
}
function tokyoLayout(r) {
  const common = { w: [7, 16], floors: [5, 11], gH: [4.2, 4.8], fh: 3.4, styles: [[1, 0.35], [2, 0.25], [3, 0.2], [4, 0.2]], shops: [[0, 0.65], [1, 0.1], [3, 0.25]],
    lit: [0.5, 0.85], signs: 1, vert: 0.5, ac: 0.03, pipes: 0, clutter: 0.1, gaps: 0.05, setback: 0.2, deep: 7, tenant: true, screens: 0.5, cornerScreen: 0.9, vMax: 30 };
  const runs = [], deep = 7, A = 11.5, F = 72;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    // along x (front at z = sz*A, facing the road): d_x must be -sz
    const ax0 = sx * A, ax1 = sx * F; const fwdA = Math.sign(ax1 - ax0) === -sz;
    runs.push({ ...common, p0: fwdA ? [ax0, sz * A] : [ax1, sz * A], p1: fwdA ? [ax1, sz * A] : [ax0, sz * A] });
    // along z (front at x = sx*A): d_z must be sx; skip the corner (taken by the other row) with start / end
    const bz0 = sz * A, bz1 = sz * F; const fwdB = Math.sign(bz1 - bz0) === sx;
    runs.push({ ...common, p0: fwdB ? [sx * A, bz0] : [sx * A, bz1], p1: fwdB ? [sx * A, bz1] : [sx * A, bz0], start: fwdB ? deep : 0, endPad: fwdB ? 0 : deep });
  }
  // the far ends of the four streets close on taller blocks (T-junctions ~75 m out), so no vista ends in empty sky
  const far = { ...common, floors: [9, 16], w: [9, 18], vert: 0.3, screens: 0.3, cornerScreen: 0, lit: [0.45, 0.8], clutter: 0 };
  runs.push({ ...far, p0: [-40, -F - 3], p1: [40, -F - 3] }, { ...far, p0: [40, F + 3], p1: [-40, F + 3] }, { ...far, p0: [F + 3, -40], p1: [F + 3, 40] }, { ...far, p0: [-F - 3, 40], p1: [-F - 3, -40] });
  const grounds = [{ x0: -8, x1: 8, z0: -8, z1: 8, cell: 0.7 }, { x0: -8, x1: 8, z0: 8, z1: F + 3, cell: 0.8 }, { x0: -8, x1: 8, z0: -F - 3, z1: -8, cell: 0.8 }, { x0: 8, x1: F + 3, z0: -8, z1: 8, cell: 0.8 }, { x0: -F - 3, x1: -8, z0: -8, z1: 8, cell: 0.8 }];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x0 = Math.min(sx * 8, sx * A), x1 = Math.max(sx * 8, sx * A), z0 = Math.min(sz * 8, sz * F), z1 = Math.max(sz * 8, sz * F);
    grounds.push({ x0, x1, z0, z1, y: 0.15, surf: 1, cell: 0.9, curb: { o: sx > 0 ? [8, 0, sz > 0 ? 8 : -F] : [-8, 0, sz > 0 ? F : -8], a: [0, 0, sx > 0 ? 1 : -1], l: F - 8, n: [-sx, 0, 0] } });
    const xa0 = Math.min(sx * A, sx * F), xa1 = Math.max(sx * A, sx * F), za0 = Math.min(sz * 8, sz * A), za1 = Math.max(sz * 8, sz * A);
    grounds.push({ x0: xa0, x1: xa1, z0: za0, z1: za1, y: 0.15, surf: 1, cell: 0.9, curb: { o: sz > 0 ? [sx > 0 ? F : -A, 0, 8] : [sx > 0 ? A : -F, 0, -8], a: [sz > 0 ? -1 : 1, 0, 0], l: F - A, n: [0, 0, -sz] } });
  }
  const poles = [];
  for (const [x, z, dx, dz] of [[8.6, 14, -1, 0], [8.6, -16, -1, 0], [-8.6, 16, 1, 0], [-8.6, -14, 1, 0], [16, 8.6, 0, -1], [-15, 8.6, 0, -1], [15, -8.6, 0, 1], [-16, -8.6, 0, 1], [8.6, 34, -1, 0], [-8.6, -36, 1, 0], [36, -8.6, 0, 1], [-38, 8.6, 0, -1]])
    poles.push({ x, z, h: 9.5, lamp: { dir: [dx, dz], color: PAL.tokyo.lamp, I: 34, h: 7.8 } });
  return {
    id: 'tokyo', neonShare: 0.18, faulty: 0.03, markMode: 1, halfW: 8, runs, grounds, poles, drops: 0,
    traffic: { x: 9.2, z: -9.0, h: 5.6, arm: [-3.0, 0], face: 1 },
    lanes: [{ axis: 'x', c: -3.0, dir: 1, v: 9, span: 150, from: -75, n: 4 }, { axis: 'x', c: 3.0, dir: -1, v: 8, span: 150, from: -75, n: 4 }, { axis: 'z', c: 3.0, dir: 1, v: 8.5, span: 150, from: -75, n: 3 }, { axis: 'z', c: -3.0, dir: -1, v: 7.5, span: 150, from: -75, n: 3 }],
    steam: [{ p: [-11.4, 3.2, 22], col: [0.05, 0.045, 0.04], rise: 3.5, k: 0.5 }], words: [],
  };
}

// ---------------------------------------------------------------------------------------------- environment (IBL) from a tiny emissive room
function makeEnv(THREE, renderer, bag, env, fog) {
  const s = new THREE.Scene(), items = [];
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 30, 120), new THREE.MeshBasicMaterial({ color: new THREE.Color(fog[0] * 0.6, fog[1] * 0.6, fog[2] * 0.6), side: THREE.BackSide })); s.add(room); items.push(room);
  const add = (c, k, x, y, z, w, h, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0] * k, c[1] * k, c[2] * k), side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.y = ry; s.add(m); items.push(m); };
  for (let i = 0; i < 9; i++) { add(env.left, 3, -5, 3 + (i % 3) * 2.5, -50 + i * 11, 0.6, 2.5, Math.PI / 2); add(env.right, 3, 5, 4 + (i % 2) * 3, -45 + i * 11, 0.6, 2.5, -Math.PI / 2); add(env.low, 1.2, i % 2 ? 5 : -5, 1.5, -50 + i * 12, 4, 2, i % 2 ? -Math.PI / 2 : Math.PI / 2); }
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.04); pm.dispose();
  for (const m of items) { m.geometry.dispose(); m.material.dispose(); }
  bag.add(rt);
  return rt.texture;
}

export function createScene({ THREE, renderer, width, height, pixelRatio = 1, variant = 'seoul', quality = 'high', seed = 1, intensity = 0.6 }) {
  const bag = kit.createBag(), light = quality === 'light';
  const rnd = kit.rng(kit.hashSeed('neon-night', variant, seed));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1500);
  const isCity = variant === 'seoul' || variant === 'tokyo';
  const pal = PAL[variant] || PAL.seoul;

  // shared uniforms (every material holds the same objects)
  const U = {
    uTime: { value: 0 }, uRain: { value: 0.6 }, uWet: { value: 1 }, uAmb: { value: 1 }, uAmbCol: { value: new THREE.Vector3(...pal.fog.map(v => v * 0.25)) },
    uFogCol: { value: new THREE.Vector3(...pal.fog) }, uFogDen: { value: pal.fogDen }, uFogH: { value: pal.fogH }, uFlick: { value: new Float32Array(8).fill(1) },
    uWinWarm: { value: new THREE.Vector3(...pal.winWarm) }, uWinCool: { value: new THREE.Vector3(...pal.winCool) }, uShop: { value: new THREE.Vector3(...pal.shop) },
    uWinI: { value: pal.winI }, uShopI: { value: pal.shopI }, uShimmer: { value: 1 }, uHaloK: { value: 1 },
    uPud: { value: 0.42 }, uMarkMode: { value: 0 }, uHalfW: { value: 3.1 }, uWords: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) },
  };
  // baked textures (shared across variants)
  const ts = light ? 512 : 1024;
  const asph = kit.cached(renderer, 'neon:asphalt:' + ts, () => kit.bakeTexture(THREE, renderer, { width: ts, fragment: ASPHALT_FS }));
  const asphN = kit.cached(renderer, 'neon:asphaltN:' + ts, () => kit.normalMapFromHeight(THREE, renderer, asph, { strength: 3, channel: 'a' }));
  const pudTex = kit.noiseTexture(THREE, renderer, { size: 256, scale: 4, octaves: 5, seed: 11, kind: 'fbm' });
  U.uAsph = { value: asph }; U.uAsphN = { value: asphN }; U.uPudTex = { value: pudTex };
  const glyphTex = glyphAtlas(THREE, renderer, { style: variant === 'tokyo' || variant === 'train' ? 'kanji' : 'hangul', cell: light ? 96 : 160, seed: 1 });
  U.uGlyph = { value: glyphTex };

  const mirror = bag.add(kit.createMirror(THREE, renderer, { y: 0, quality, width, height, pixelRatio }));

  // sky dome (city glow under low cloud)
  const skyU = { uZenith: { value: new THREE.Vector3(...pal.sky.zenith) }, uGlowCol: { value: new THREE.Vector3(...pal.sky.glow) }, uTime: { value: 0 }, uCloud: { value: 0.9 }, uFlash: { value: 0 }, uGlowH: { value: pal.sky.glowH } };
  const skyMesh = new THREE.Mesh(bag.add(new THREE.SphereGeometry(1000, 32, 16)), bag.add(new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VS, fragmentShader: kit.GLSL.common + kit.GLSL.noise + SKY_FS, side: THREE.BackSide, depthWrite: false })));
  skyMesh.renderOrder = -10; skyMesh.frustumCulled = false; scene.add(skyMesh);

  // ---- the world
  let world, path, rainOn = true, groundHide = [];
  if (isCity) {
    const Lay = variant === 'tokyo' ? tokyoLayout(rnd) : seoulLayout(rnd);
    U.uMarkMode.value = Lay.markMode; U.uHalfW.value = Lay.halfW;
    (Lay.words || []).forEach((w, i) => U.uWords.value[i].set(...w));
    scene.environment = makeEnv(THREE, renderer, bag, pal.env, pal.fog);
    world = buildCity({ THREE, renderer, bag, quality, seed, U, mirror, glyphTex, pal }, Lay);
    bag.add(world.group); scene.add(world.group); groundHide = [world.groundMesh];
    path = variant === 'tokyo' ? kit.cameraPath([
      { pos: [-10.2, 1.7, 13.5], look: [6, 4.2, -10], fov: 44, portrait: { look: [6, 7.5, -10], fov: 50 } },
      { pos: [-8.6, 4.2, 11.8], look: [7, 5.5, -12], fov: 42, portrait: { look: [7, 9, -12] } },
      { pos: [-6.0, 7.8, 13.0], look: [8, 6.2, -14], fov: 42, portrait: { look: [8, 10, -14] } },
      { pos: [-2.5, 9.2, 15.5], look: [10, 5.5, -10], fov: 44, portrait: { look: [10, 9, -10] } },
    ], { period: 280, breathe: 0.045, seed }) : kit.cameraPath([
      { pos: [-0.5, 1.45, 14], look: [0.35, 2.9, -20], fov: 42, portrait: { look: [0.3, 5.2, -20], fov: 50 } },
      { pos: [0.55, 1.6, 2], look: [-0.25, 3.2, -32], fov: 40, portrait: { look: [-0.2, 5.8, -32] } },
      { pos: [-0.35, 1.5, -10], look: [0.5, 2.7, -48], fov: 41, portrait: { look: [0.4, 5.4, -48] } },
      { pos: [0.4, 1.65, -22], look: [-0.3, 3.0, -66], fov: 40, portrait: { look: [-0.2, 5.6, -66] } },
    ], { period: 300, breathe: 0.04, seed });
  } else if (variant === 'tunnel') {
    world = buildTunnel({ THREE, renderer, bag, quality, seed, U, mirror });
    scene.environment = world.env; bag.add(world.group); scene.add(world.group); groundHide = [world.groundMesh]; rainOn = false; skyMesh.visible = false;
  } else {
    scene.environment = makeEnv(THREE, renderer, bag, { left: [1, 0.5, 0.25], right: [0.4, 0.6, 1], low: K(4000) }, [0.01, 0.01, 0.014]);
    world = buildTrain({ THREE, renderer, bag, quality, seed, U, glyphTex, mirror, pal, width, height, pixelRatio });
    bag.add(world.group); scene.add(world.group); groundHide = world.groundMeshes;
  }

  const fogBase = world.fog || pal.fog, fogDen = world.fogDen || pal.fogDen;
  U.uFogH.value = world.fogH || pal.fogH; U.uAmbCol.value.set(...fogBase.map(v => v * 0.25));
  // ---- rain
  const rain = rainOn ? bag.add(kit.createParticles(THREE, renderer, { kind: 'rain', quality, seed, box: [22, 14, 26], splashes: { ground: 0, box: [12, 16], count: 1800, size: 0.045, period: 0.4 } })) : null;
  if (rain) scene.add(rain.object);

  // ---- post
  const post = bag.add(kit.createPost(THREE, renderer, { width, height, pixelRatio, quality, tonemap: 'aces', rays: false }));
  const gr = world.grade || pal.grade;
  Object.assign(post.grade, { exposure: gr.exposure, temperature: gr.temperature, tint: gr.tint, saturation: gr.saturation, contrast: gr.contrast, lift: gr.lift, gain: gr.gain, vignette: gr.vignette, aberration: 0.0022, dirt: 0.22, grainSize: 1.4 });
  post.grade.bloom = { strength: gr.bloom, threshold: 0, knee: 0.5, radius: 1 };
  post.grade.dof = { focus: 14, range: 16, strength: light ? 0 : 0.3 };

  // ---- audio smoothing (exact for sequential export frames, resets on seek)
  const sLevel = kit.smoother({ attack: 0.4, release: 2.5 }), sBig = kit.smoother({ attack: 0.02, release: 0.35 });
  const camPos = new THREE.Vector3(), rainC = new THREE.Vector3();
  if (world.noDof) post.grade.dof.strength = 0;

  function render(t, f, info = {}) {
    const I = kit.clamp(intensity ?? 0.6, 0, 1);
    const energy = f.energy || 0, lvl = sLevel.step(t, f.level || 0), big = sBig.step(t, f.big || 0);
    U.uTime.value = t; skyU.uTime.value = t;
    // weather that builds and eases over the song (incommensurate periods), the music adds a little
    const rainBase = kit.clamp(0.55 + 0.22 * Math.sin(t / 131 + seed) + 0.12 * Math.sin(t / 57 + 2.1));
    const rainK = kit.clamp(rainBase + 0.3 * I * kit.soft(energy, 0.6), 0.15, 1);
    U.uRain.value = 0.35 + 0.6 * rainK;
    U.uPud.value = 0.42 + 0.035 * Math.sin(t / 190 + 1);
    U.uFogDen.value = fogDen * (1 + 0.2 * Math.sin(t / 97 + 0.7) + 0.12 * rainK);
    // neon life: two faulty tubes, a sign that stutters on rare big accents, a breath of the level
    const fl = U.uFlick.value;
    fl[0] = 1;
    fl[1] = Math.min(1, kit.flicker(t, 3, { speed: 0.6, depth: 0.35 }) * (kit.hash01(seed, Math.floor(t * 3.1)) > 0.93 ? 0.15 : 1) + 0.05);
    fl[4] = kit.flicker(t, 9, { speed: 0.9, depth: 0.25 }) * (kit.hash01(seed, 7, Math.floor(t * 1.7)) > 0.95 ? 0.3 : 1);
    const stutter = kit.clamp(big * 1.6) * I;
    fl[2] = 1 - stutter * (0.5 + 0.5 * Math.sign(Math.sin(t * 47 + 3 * Math.sin(t * 13))));
    fl[3] = 1;
    // traffic light: green 28 s, amber 3 s, red 33 s
    const ph = kit.fract((t + seed * 17) / 64) * 64;
    fl[7] = ph < 28 ? 1 : 0.03; fl[6] = ph >= 28 && ph < 31 ? 1 : 0.03; fl[5] = ph >= 31 ? 1 : 0.03;
    U.uShimmer.value = 1 + 0.07 * I * lvl;
    U.uHaloK.value = 0.85 + 0.35 * rainK;
    const flash = rainOn ? kit.lightning(t, f, seed) * I * 0.5 : 0;
    skyU.uFlash.value = flash;
    U.uFogCol.value.set(fogBase[0] * (1 + flash * 3), fogBase[1] * (1 + flash * 3), fogBase[2] * (1 + flash * 3.5));
    skyU.uCloud.value = 0.8 + 0.15 * Math.sin(t / 113);

    let cam;
    if (path) cam = path.apply(camera, t, { breath: energy * I });
    else cam = world.camera(camera, t, f, I);
    camPos.copy(camera.position);
    const wind = 0.6 + 0.5 * Math.sin(t / 71) + 0.4 * I * energy;
    if (world.update) world.update(t, f, wind, camera, I);
    if (rain) rain.update(t, camera, { density: rainK, wind: world.rainCenterZ ? [-9, 0, 0] : [0.7 * wind, 0, 0.25], center: world.rainCenterZ ? rainC.set(camPos.x, camPos.y - 2, camPos.z + world.rainCenterZ) : undefined, gust: 0.35, shutter: 1 / 40, lights: world.rainLights ? world.rainLights(camPos) : [], ambient: [0.05 + flash, 0.04 + flash, 0.07 + flash * 1.2], brightness: 1.8, focus: 4, ground: 0 });
    // post
    post.grade.bloom.strength = gr.bloom * (1 + 0.25 * I * (f.bass || 0)) * (1 + 0.15 * rainK);
    post.grade.exposure = gr.exposure * (1 + flash * 0.25);
    if (cam) post.grade.dof.focus = Math.max(6, Math.hypot(cam.pos[0] - cam.look[0], cam.pos[1] - cam.look[1], cam.pos[2] - cam.look[2]) * (variant === 'tokyo' ? 1.1 : 0.6));
    if (world.beforeRender) world.beforeRender(t, camera, post);
    if (groundHide.length) { if (rain) rain.object.visible = false; mirror.update(scene, camera, { hide: groundHide }); if (rain) rain.object.visible = true; }
    if (world.render) world.render(scene, camera, post, t);
    else post.render(scene, camera, t);
  }
  function resize(w, h, pr = 1) { camera.aspect = w / h; camera.updateProjectionMatrix(); post.resize(w, h, pr); mirror.resize(w, h, pr); world.resize?.(w, h, pr); }
  resize(width, height, pixelRatio);
  return { render, resize, dispose() { bag.dispose(); scene.clear(); } };
}
