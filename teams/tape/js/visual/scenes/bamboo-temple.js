// bamboo-temple.js - "Kyoto bamboo & torii": a slow dolly down a stone path through an Arashiyama-like moso grove
// (brushwood shibagaki fences, 11-17 m culms with nodes, wax bloom, lichen and age variation, leaning in over the path,
// swaying in a wind that follows the music), morning mist with volumetric sun shafts through the canopy, falling bamboo
// leaves, then a clearing with a vermilion myojin torii, mossy kasuga stone lanterns, a cherry tree and the forested hill behind the shrine.
// Variants: misty morning, golden afternoon, cherry blossom, lantern night (Hanatouro andon + up-lit bamboo, fireflies).
// Geometry: bamboo-temple-geo.js. Shaders and material patches: bamboo-temple-glsl.js.
import * as kit from './kit.js?v=9e';
import { btPatch, btCulmDepth, btShaftDome, LITTER_FS, PATH_FS, CULM_TEX_FS } from './bamboo-temple-glsl.js?v=9e';
import { pathX, GROVE_END, TORII_Z, FENCE_X, culmGeometry, layoutGrove, chunked, culmInstances, cardInstances, fenceGeometry, railGeometry, tieGeometry,
  toriiGeometry, lanternGeometry, sakuraTree, drawLeafCard, drawBlossomCard } from './bamboo-temple-geo.js?v=9e';

export const meta = {
  id: 'bamboo-temple', name: 'Kyoto bamboo & torii', group: 'Japan',
  desc: 'A slow walk through an Arashiyama bamboo grove in morning mist, light shafts through the canopy, toward a vermilion torii.',
  variants: [
    { id: 'misty', name: 'Misty morning' },
    { id: 'golden', name: 'Golden afternoon', text: { accent: '#ffc77a' } },
    { id: 'sakura', name: 'Cherry blossom', text: { accent: '#f6b8c8' } },
    { id: 'night', name: 'Lantern night', text: { accent: '#ffb46a' } },
  ],
  defaultVariant: 'misty', thumbT: 40,
  text: { ink: '#f3f1e8', accent: '#d9e6b0' },
  swatch: ['#2c3a2a', '#e9e3c8'],
};

const LOOKS = {
  misty: { sun: [16, -60], sunI: 4, moon: 0, mie: 2.6, mieG: 0.8, clouds: 0.3,
    fog: { density: 0.021, falloff: 0.085, noise: 0.5, sunG: 0.75, sunStrength: 0.06, skyAmount: 0.32, tint: [0.8, 0.9, 0.84], skyDistance: 260, wind: [0.12, 0.0, 0.04] },
    shaft: 0.04, shaftExt: 0.018, canopy: 1, dim: 0.35, exposure: 1.3, temperature: 0.02, tint: 0.0, saturation: 0.9, contrast: 1.08,
    lift: [0.004, 0.008, 0.01], gain: [1.0, 1.0, 0.97], bloom: 0.09, rays: 0.25, env: 0.5, wind: 0.16, damp: 0.75, dust: 1.2, petals: 0, lamps: 0, andon: 0, blossom: false },
  golden: { sun: [8.5, -60], sunI: 4, moon: 0, mie: 1.8, mieG: 0.8, clouds: 0.25,
    fog: { density: 0.011, falloff: 0.07, noise: 0.35, sunG: 0.8, sunStrength: 0.15, skyAmount: 0.5, tint: [0.95, 0.92, 0.84], skyDistance: 220, wind: [0.1, 0.0, 0.05] },
    shaft: 0.05, shaftExt: 0.01, canopy: 1, dim: 0.25, exposure: 1.05, temperature: 0.13, tint: 0.01, saturation: 0.98, contrast: 1.09,
    lift: [0.008, 0.005, 0.0], gain: [1.03, 0.99, 0.92], bloom: 0.09, rays: 0.35, env: 0.5, wind: 0.2, damp: 0.0, dust: 1.6, petals: 0, lamps: 0, andon: 0, blossom: false },
  sakura: { sun: [27, -102], sunI: 4, moon: 0, mie: 1.5, mieG: 0.78, clouds: 0.4,
    fog: { density: 0.01, falloff: 0.08, noise: 0.35, sunG: 0.7, sunStrength: 0.12, skyAmount: 0.5, tint: [0.95, 0.93, 0.95], skyDistance: 240, wind: [0.15, 0.0, 0.05] },
    shaft: 0.035, shaftExt: 0.012, canopy: 1, dim: 0.3, exposure: 0.8, temperature: 0.04, tint: 0.03, saturation: 1.0, contrast: 1.07,
    lift: [0.008, 0.006, 0.01], gain: [1.0, 0.98, 0.98], bloom: 0.1, rays: 0.2, env: 0.6, wind: 0.18, damp: 0.2, dust: 0.6, petals: 1, lamps: 0, andon: 0, blossom: true },
  night: { sun: [-24, 40], sunI: 4, moon: 0.09, moonAt: [36, -140], mie: 1.4, mieG: 0.8, clouds: 0.25,
    fog: { density: 0.02, falloff: 0.08, noise: 0.4, sunG: 0.7, sunStrength: 0.3, skyAmount: 1, tint: [0.85, 0.9, 1.0], skyDistance: 200, wind: [0.1, 0.0, 0.04] },
    shaft: 0.06, shaftExt: 0.02, canopy: 1, dim: 0, exposure: 5.5, temperature: -0.04, tint: 0.0, saturation: 0.92, contrast: 1.06,
    lift: [0.0, 0.002, 0.006], gain: [1.0, 1.0, 1.02], bloom: 0.12, rays: 0, env: 0.6, wind: 0.12, damp: 0.5, dust: 0, petals: 0, lamps: 1, andon: 1, blossom: false },
};

const LANTERNS = [[-2.75, -51.2, 0.3], [2.75, -51.2, -0.2], [-3.0, -64.5, 0.1], [3.0, -64.5, 0.4]];
const SAKURA = { x: 4.6, z: -57.5 };

export function createScene({ THREE, renderer, width, height, pixelRatio = 1, variant = 'misty', quality = 'high', seed = 1, intensity = 0.6 }) {
  const L = LOOKS[variant] || LOOKS.misty;
  const Qk = kit.Q[quality] || kit.Q.high, light = quality === 'light', big = !light;
  const bag = kit.createBag(), rnd = kit.rng(kit.hashSeed('bamboo-temple', seed));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.2, 2500);
  const steps = light ? 3 : quality === 'ultra' ? 12 : 6;

  // ---------------------------------------------------------------- sky, fog, lights
  const night = variant === 'night';
  const sky = bag.add(kit.createSky(THREE, renderer, { quality, sky: { sun: { elevation: L.sun[0], azimuth: L.sun[1], intensity: L.sunI },
    moon: { elevation: (L.moonAt || [30, 0])[0], azimuth: (L.moonAt || [30, 0])[1], intensity: L.moon, phase: 0.42 }, mie: L.mie, mieG: L.mieG,
    clouds: { coverage: L.clouds, density: 1, softness: 0.4, scale: 0.4 } }, fog: L.fog }));
  scene.add(sky.mesh);
  const fogU = sky.fog.uniforms;
  const sun = new THREE.DirectionalLight(0xffffff, 1); scene.add(sun, sun.target);
  const moon = new THREE.DirectionalLight(0xffffff, 1); scene.add(moon, moon.target);
  const shadowSize = quality === 'ultra' ? 2048 : 1024;
  if (big) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; kit.sunShadow(night ? moon : sun, { size: shadowSize, extent: 15, far: 220, bias: -0.0006, normalBias: 0.04, radius: 2 }); }

  // shared uniforms of every grove material
  const gobo = kit.noiseTexture(THREE, renderer, { size: 512, scale: 8, octaves: 5, seed: 3, kind: 'fbm' });
  const U = {
    uBtSunDir: { value: new THREE.Vector3(0, 1, 0) }, uBtSunCol: { value: new THREE.Vector3() }, uBtLampCol: { value: new THREE.Vector3(...kit.kelvin(1900)) }, uBtUpCol: { value: new THREE.Vector3(...kit.kelvin(2700)) },
    uBtGobo: { value: gobo }, uBtGoboOff: { value: new THREE.Vector2() }, uBtWindDir: { value: new THREE.Vector2(0.8, 0.3) },
    uBtCanopyH: { value: 11 }, uBtCanopyMix: { value: L.canopy }, uBtShaft: { value: 0 }, uBtShaftExt: { value: L.shaftExt }, uBtSwayAmp: { value: 0.15 }, uBtSwayPhase: { value: 0 },
    uBtGustPhase: { value: 0 }, uBtTime: { value: 0 }, uBtAndon: { value: 0 }, uBtUp: { value: 0 }, uBtGroveEnd: { value: GROVE_END },
    uBtLamp: { value: LANTERNS.map(([x, z]) => new THREE.Vector4(x, 1.72, z, 0)) },
  };
  // light quality has no shadow map: stand-in occlusion of the direct sun by the other culms, and a cheaper ground
  const std = (o, kind, extra, opt = {}) => bag.add(btPatch(THREE, new THREE.MeshStandardMaterial({ metalness: 0, ...o }), { kind, fogU, U, extra, steps,
    sunK: big ? 1 : 0.55, ...opt, defines: { ...(big ? {} : { BT_LIGHT: 1 }), ...(opt.defines || {}) } }));

  // ---------------------------------------------------------------- grove
  const lay = layoutGrove(rnd.fork('grove'), quality);
  const culmNear = bag.add(culmGeometry(THREE, light ? 7 : 9, light ? 16 : 26)), culmFar = bag.add(culmGeometry(THREE, 5, light ? 6 : 9));
  const culmTex = kit.cached(renderer, 'bt:culm:' + (big ? 1024 : 512), () => kit.bakeTexture(THREE, renderer, { width: big ? 256 : 128, height: big ? 1024 : 512, fragment: CULM_TEX_FS }));
  const culmU = { tBtCulm: { value: culmTex } };
  const culmMat = std({ color: 0xffffff, roughness: 0.45, envMapIntensity: L.env }, 'culm', culmU);
  const culmDepth = bag.add(btCulmDepth(THREE, U));
  const meshes = [];
  for (const lod of [0, 1]) {
    for (const g of chunked(lay.culms.filter(c => c.lod === lod), list => culmInstances(THREE, lod ? culmFar : culmNear, list))) {
      bag.add(g); const m = new THREE.Mesh(g, culmMat); m.castShadow = big && lod === 0; m.receiveShadow = big; m.customDepthMaterial = culmDepth; scene.add(m); meshes.push(m);
    }
  }
  const stumpMat = std({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide, envMapIntensity: L.env }, 'culm', culmU, { defines: { BT_STUMP: 1 } });
  if (lay.stumps.length) { const g = bag.add(culmInstances(THREE, bag.add(culmGeometry(THREE, 9, 3)), lay.stumps)); const m = new THREE.Mesh(g, stumpMat); m.receiveShadow = big; scene.add(m); }

  // canopy cards
  const leafTex = kit.cached(renderer, 'bt:leafcard:512', () => kit.canvasTexture(THREE, 512, 512, drawLeafCard(kit.rng(77)), { srgb: true }));
  const quad = bag.add(new THREE.PlaneGeometry(1, 1));
  // alpha-test only (alpha-to-coverage is not frame-exact on every rasteriser)
  const cardOpts = { alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.62, envMapIntensity: L.env * 1.1 };
  const leafMat = std({ map: leafTex, ...cardOpts }, 'card', { uBtCardTrans: { value: 1 }, uBtCardTint: { value: new THREE.Vector3(1, 1, 1) } });
  for (const g of chunked(lay.cards, list => cardInstances(THREE, quad, list))) { bag.add(g); const m = new THREE.Mesh(g, leafMat); m.receiveShadow = false; scene.add(m); }

  // ---------------------------------------------------------------- ground
  const tsz = big ? 1024 : 512;
  const litterTex = kit.cached(renderer, 'bt:litter:' + tsz, () => kit.bakeTexture(THREE, renderer, { width: tsz, fragment: LITTER_FS }));
  const pathTex = kit.cached(renderer, 'bt:path:' + tsz, () => kit.bakeTexture(THREE, renderer, { width: tsz, fragment: PATH_FS }));
  const gNoise = kit.noiseTexture(THREE, renderer, { size: 256, scale: 6, octaves: 5, seed: 11, kind: 'mix' });
  const groundGeo = bag.add(new THREE.PlaneGeometry(170, 116.5, 1, 1)); groundGeo.rotateX(-Math.PI / 2); groundGeo.translate(0, 0, -17.75);   // ends where the hill rises: no grazing hill/ground intersection (z-fight shimmer)
  const groundMat = std({ color: 0xffffff, roughness: 0.85, envMapIntensity: L.env * 0.9 }, 'ground',
    { tBtLitter: { value: litterTex }, tBtPath: { value: pathTex }, tBtNoise: { value: gNoise }, uBtPetals: { value: L.petals }, uBtDamp: { value: L.damp } });
  const ground = new THREE.Mesh(groundGeo, groundMat); ground.receiveShadow = big; ground.renderOrder = 2; scene.add(ground);   // after the culms: early-z skips hidden ground

  // ---------------------------------------------------------------- fences
  const fenceMat = std({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide, envMapIntensity: L.env * 0.7 }, 'fence');
  const railMat = std({ color: new THREE.Color().setRGB(0.2, 0.15, 0.07), roughness: 0.72, envMapIntensity: L.env }, 'plain');
  const tieMat = std({ color: new THREE.Color().setRGB(0.02, 0.018, 0.016), roughness: 0.8 }, 'plain');
  for (const side of [-1, 1]) {
    const { geo, rows } = fenceGeometry(THREE, side);
    const f = new THREE.Mesh(bag.add(geo), fenceMat); f.receiveShadow = big; scene.add(f);
    const r = new THREE.Mesh(bag.add(railGeometry(THREE, side, rows)), railMat); r.receiveShadow = big; scene.add(r);
    scene.add(new THREE.Mesh(bag.add(tieGeometry(THREE, side, rows)), tieMat));
  }

  // ---------------------------------------------------------------- torii + lanterns
  const tg = toriiGeometry(THREE);
  const red = std({ color: new THREE.Color().setRGB(0.55, 0.05, 0.016), roughness: 0.5, envMapIntensity: 0.8 }, 'torii');
  const blk = std({ color: new THREE.Color().setRGB(0.018, 0.016, 0.015), roughness: 0.42, envMapIntensity: 0.8 }, 'torii');
  for (const [g, m] of [[tg.red, red], [tg.black, blk]]) { const o = new THREE.Mesh(bag.add(g), m); o.position.set(0, 0, TORII_Z); o.castShadow = o.receiveShadow = big; scene.add(o); }
  const lg = lanternGeometry(THREE);
  const stoneMat = std({ color: 0xffffff, roughness: 0.85, envMapIntensity: L.env }, 'stone', { uBtMoss: { value: 1 } });
  const warm = kit.kelvin(1900);
  const glowMat = bag.add(sky.patch(new THREE.MeshBasicMaterial({ color: night ? new THREE.Color(warm[0] * 9, warm[1] * 9, warm[2] * 9) : new THREE.Color(0.012, 0.011, 0.01) })));
  const stones = new THREE.InstancedMesh(bag.add(lg.stone), stoneMat, LANTERNS.length), glows = new THREE.InstancedMesh(bag.add(lg.glow), glowMat, LANTERNS.length);
  const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion();
  LANTERNS.forEach(([x, z, yaw], i) => { mtx.compose(new THREE.Vector3(x, 0, z), qq.setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)); stones.setMatrixAt(i, mtx); glows.setMatrixAt(i, mtx); });
  stones.castShadow = stones.receiveShadow = big; scene.add(stones, glows);
  // Hanatouro andon along the path (night only)
  let andon = null;
  if (L.andon) {
    const zs = []; for (let z = 30; z > GROVE_END + 2; z -= 6) zs.push(z);
    const ag = bag.add(new THREE.CylinderGeometry(0.11, 0.12, 0.42, 12)); ag.translate(0, 0.27, 0);
    const cg = bag.add(new THREE.CylinderGeometry(0.03, 0.16, 0.08, 12)); cg.translate(0, 0.52, 0);
    const bg = bag.add(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 12)); bg.translate(0, 0.03, 0);
    andon = new THREE.InstancedMesh(ag, bag.add(sky.patch(new THREE.MeshBasicMaterial({ color: new THREE.Color(warm[0] * 2.4, warm[1] * 2.4, warm[2] * 2.4) }))), zs.length * 2);
    const capM = std({ color: new THREE.Color(0.02, 0.016, 0.012), roughness: 0.6 }, 'plain');
    const caps = new THREE.InstancedMesh(cg, capM, zs.length * 2), bases = new THREE.InstancedMesh(bg, capM, zs.length * 2);
    let k = 0; for (const z of zs) for (const s of [-1, 1]) { mtx.makeTranslation(pathX(z) + s * 1.8, 0, z); andon.setMatrixAt(k, mtx); caps.setMatrixAt(k, mtx); bases.setMatrixAt(k, mtx); k++; }
    scene.add(andon, caps, bases);
  }

  // ---------------------------------------------------------------- cherry tree, hill
  const tree = sakuraTree(THREE, rnd.fork('sakura'), SAKURA);
  const barkMat = std({ color: 0xffffff, roughness: 0.9, envMapIntensity: L.env }, 'bark');
  const barkMesh = new THREE.Mesh(bag.add(tree.bark), barkMat); barkMesh.castShadow = barkMesh.receiveShadow = big; scene.add(barkMesh);
  const blossomTex = L.blossom ? kit.cached(renderer, 'bt:blossom:512', () => kit.canvasTexture(THREE, 512, 512, drawBlossomCard(kit.rng(91)), { srgb: true })) : leafTex;
  const treeCardMat = std({ map: blossomTex, ...cardOpts, envMapIntensity: 0.8 }, 'card', { uBtCardTrans: { value: L.blossom ? 0.7 : 1 }, uBtCardTint: { value: L.blossom ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(0.55, 0.62, 0.4) } });
  const tc = bag.add(cardInstances(THREE, quad, tree.cards)); scene.add(new THREE.Mesh(tc, treeCardMat));
  const hillY = (x, z) => { const r = kit.smoothstep(-74, -190, z); return -0.4 + r * (55 + 75 * kit.ridged2(x * 0.006, z * 0.006, { octaves: 4, seed: 5 })) + kit.smoothstep(-70, -110, z) * 6 * (0.5 + 0.5 * kit.noise2(x * 0.03, z * 0.03, 3)) + r * 5 * kit.fbm2(x * 0.045, z * 0.045, { octaves: 3, seed: 9 }); };
  const hillGeo = bag.add(kit.heightfield(THREE, { width: 760, depth: 420, segX: big ? 140 : 70, segZ: big ? 90 : 45, height: (x, z) => hillY(x, z - 290) }));
  hillGeo.translate(0, 0, -290); hillGeo.computeBoundingSphere();
  const hillMat = std({ color: 0xffffff, roughness: 0.95, envMapIntensity: L.env }, 'hill', {}, { lamps: false });
  const hill = new THREE.Mesh(hillGeo, hillMat); hill.renderOrder = 3; scene.add(hill);

  // volumetric shafts over the sky pixels
  const dome = new THREE.Mesh(bag.add(new THREE.SphereGeometry(1500, 24, 12)), bag.add(btShaftDome(THREE, fogU, U, steps)));
  dome.frustumCulled = false; dome.renderOrder = 5; scene.add(dome);   // far behind every surface: no knife-edge depth test against the hill

  // ---------------------------------------------------------------- particles
  const fxs = [];
  const leaves = bag.add(kit.createParticles(THREE, renderer, { kind: 'petals', quality, fog: fogU, seed: seed + 3, count: 110, box: [16, 10, 24], size: 0.04, speed: 0.5,
    color: [0.16, 0.15, 0.06], color2: [0.26, 0.21, 0.09], flutter: 0.8 }));
  scene.add(leaves.object); fxs.push(leaves);
  const petals = L.petals ? bag.add(kit.createParticles(THREE, renderer, { kind: 'petals', quality, fog: fogU, seed: seed + 5, count: 1500, box: [18, 11, 26], size: 0.016, speed: 0.6,
    color: [0.98, 0.8, 0.86], color2: [1.0, 0.93, 0.95], flutter: 0.9 })) : null;
  if (petals) { scene.add(petals.object); fxs.push(petals); }
  const dust = L.dust ? bag.add(kit.createParticles(THREE, renderer, { kind: 'dust', quality, fog: fogU, seed: seed + 7, count: 1800, box: [12, 6, 16] })) : null;
  if (dust) { scene.add(dust.object); fxs.push(dust); }
  const flies = night ? bag.add(kit.createParticles(THREE, renderer, { kind: 'fireflies', quality, fog: fogU, seed: seed + 9, count: 240, box: [22, 3.2, 30], color: [0.7, 1.0, 0.3], size: 0.005 })) : null;
  if (flies) { scene.add(flies.object); fxs.push(flies); }

  // ---------------------------------------------------------------- post + camera
  const post = bag.add(kit.createPost(THREE, renderer, { width, height, pixelRatio, quality, tonemap: 'aces' }));
  Object.assign(post.grade, { exposure: L.exposure, temperature: L.temperature, tint: L.tint, saturation: L.saturation, contrast: L.contrast, lift: L.lift, gain: L.gain, vignette: 0.42, dirt: 0.06 });
  post.grade.bloom.strength = L.bloom; post.grade.rays.strength = L.rays; post.grade.dof = { focus: 20, range: 14, strength: 0.32 };
  const K = (z, off, y, zl, loff, ly, fov, pz = 0) => ({ pos: [pathX(z) + off, y, z], look: [pathX(zl) + loff, ly, zl], fov,
    portrait: { pos: [pathX(z + pz) + off * 0.5, y - 0.1, z + pz], look: [pathX(zl) + loff * 0.5, ly + 3.4, zl], fov: fov + 4 } });
  const path = kit.cameraPath([
    K(12, -0.4, 1.55, -14, 0.45, 2.7, 40),
    K(1, 0.35, 1.48, -26, -0.3, 2.6, 38),
    K(-11, -0.3, 1.62, -38, 0.2, 2.8, 37),
    K(-23, 0.25, 1.55, -58, 0.1, 3.0, 35, 2),
    K(-33, 0.0, 1.5, -58, 0.0, 3.1, 34, 3),
  ], { period: 300, breathe: 0.04, seed });

  // ---------------------------------------------------------------- frame
  const cpos = new THREE.Vector3(), fwd = new THREE.Vector3(), ctr = new THREE.Vector3(), tmpV = new THREE.Vector3(), rgt = new THREE.Vector3(), upv = new THREE.Vector3();
  const amb = new THREE.Vector3();
  function skyAt(t, audioFog) {
    // quantised to the sky's own LUT key steps, so a cached LUT always matches these exact values (frame-exact)
    sky.params.sun.elevation = Math.round((L.sun[0] + 1.6 * Math.sin(t / 173 + seed * 0.7)) / 0.05) * 0.05;
    sky.params.sun.azimuth = Math.round((L.sun[1] + 4 * Math.sin(t / 229 + 1.1)) / 0.1) * 0.1;
    sky.params.clouds.coverage = kit.clamp(L.clouds + 0.1 * Math.sin(t / 97 + 1.3));
    sky.fog.params.density = L.fog.density * (1 + 0.22 * Math.sin(t / 89 + 0.4) + 0.12 * Math.sin(t / 151 + 2.0) + 0.08 * audioFog);
  }
  function render(t, f = {}, info = {}) {
    const k = intensity, e = kit.soft(f.energy || 0, 0.6);
    // slow light and weather (incommensurate periods; nothing repeats within minutes)
    skyAt(t, k * e);
    sky.update(t);
    sky.applyLights({ sun, moon, target: ctr.set(0, 0, -10) });
    // passing clouds dim the sun (and the shafts) every minute or two
    const veil = 0.5 + 0.5 * Math.sin(t / 47 + 2.1) * Math.sin(t / 131 + 0.4);
    const cloud = 1 - L.dim * kit.smoothstep(0.55, 0.95, veil);
    sun.intensity = cloud;

    // camera
    const cam = path.apply(camera, t, { breath: (f.slow || 0) * k });
    camera.getWorldPosition(cpos); camera.getWorldDirection(fwd);
    dome.position.copy(cpos);

    // wind: sway amplitude follows the music gently, rare big accents bring a gust
    const g = kit.soft(f.big || 0, 0.5), w = e;   // energy is already a 1.5 s envelope, big a 0.5 s decay: pure functions of t
    U.uBtSwayAmp.value = L.wind * (1 + 0.7 * k * w) + 0.25 * k * g;
    U.uBtSwayPhase.value = t * Math.PI * 2 * 0.2;
    U.uBtGustPhase.value = t * 0.31;
    U.uBtTime.value = t;
    const sa = U.uBtSwayAmp.value;
    U.uBtGoboOff.value.set(t * 0.00022 + Math.sin(t * 1.26) * sa * 0.006, t * 0.00009 + Math.cos(t * 0.93) * sa * 0.005);
    // sun / moon into the grove uniforms
    const lightDir = night ? sky.moonDir : sky.sunDir, lightCol = night ? sky.moonColor : sky.sunColor;
    U.uBtSunDir.value.copy(lightDir);
    U.uBtSunCol.value.set(lightCol.r, lightCol.g, lightCol.b).multiplyScalar(night ? 1 : cloud);
    U.uBtShaft.value = L.shaft * (1 + 0.15 * k * (f.bass || 0));
    // the shadow camera follows the view, snapped to its texels (no shimmering)
    const lit = night ? moon : sun;
    ctr.copy(cpos).addScaledVector(fwd, 12); ctr.y = 0;
    if (big) {
      const ld = tmpV.copy(lightDir).negate().normalize();
      rgt.crossVectors(ld, upv.set(0, 1, 0)).normalize(); upv.crossVectors(rgt, ld).normalize();
      const tex = 30 / shadowSize, a = ctr.dot(rgt), b = ctr.dot(upv);
      ctr.addScaledVector(rgt, Math.round(a / tex) * tex - a).addScaledVector(upv, Math.round(b / tex) * tex - b);
    }
    lit.target.position.copy(ctr); lit.position.copy(ctr).addScaledVector(lightDir, 80); lit.target.updateMatrixWorld();

    // lanterns, andon and up-lights (night)
    const lamps = [];
    if (L.lamps) {
      for (let i = 0; i < 4; i++) {
        const fl = kit.flicker(t, i * 3 + 1, { speed: 1.3, depth: 0.16 }) * (1 + k * (0.1 * (f.level || 0) + 0.2 * (f.accent || 0)));
        U.uBtLamp.value[i].w = 1.25 * fl;
        if (lamps.length < 3) lamps.push({ position: [LANTERNS[i][0], 1.72, LANTERNS[i][1]], color: warm, intensity: 0.5 * fl, radius: 2.2 });
      }
      U.uBtAndon.value = 1.0 * (1 + 0.06 * k * (f.level || 0)); U.uBtUp.value = 3.2;
      lamps.push({ position: [cpos.x + fwd.x * 6, 0.4, cpos.z + fwd.z * 6], color: warm, intensity: 0.12, radius: 3 });
    }

    // particles
    const wd = [0.5 + 0.9 * sa, 0, 0.15 + 0.3 * sa];
    const sunC = lightCol, ambC = sky.ambient.sky;
    amb.set(ambC.r, ambC.g, ambC.b).multiplyScalar(0.18);
    const pFocus = Math.max(3, Math.hypot(cam.look[0] - cam.pos[0], cam.look[2] - cam.pos[2]) * 0.6);
    leaves.update(t, camera, { density: kit.clamp(0.25 + 0.35 * k * w + 0.4 * k * g + (L.blossom ? 0 : 0.1)), wind: wd, gust: 0.35, sunDir: lightDir, sunColor: [sunC.r * 0.35 * cloud, sunC.g * 0.35 * cloud, sunC.b * 0.35 * cloud],
      ambient: [amb.x * 1.5, amb.y * 1.5, amb.z * 1.5], lights: lamps, focus: pFocus, bokeh: 0.8, brightness: 1 });
    if (petals) {
      const near = kit.smoothstep(-8, -40, cpos.z);
      petals.update(t, camera, { density: kit.clamp(0.22 + 0.55 * near + 0.15 * k * w + 0.3 * k * g), wind: [wd[0] * 1.2, 0, wd[2]], gust: 0.4, sunDir: lightDir,
        sunColor: [sunC.r * 0.4 * cloud, sunC.g * 0.4 * cloud, sunC.b * 0.4 * cloud], ambient: [amb.x * 2.5, amb.y * 2.5, amb.z * 2.5], focus: pFocus, bokeh: 0.9 });
    }
    if (dust) dust.update(t, camera, { density: 0.75, wind: [0.04, 0.01, 0.02], gust: 0.3, ambient: [sunC.r * 0.02 * cloud, sunC.g * 0.02 * cloud, sunC.b * 0.02 * cloud], brightness: L.dust, focus: pFocus, bokeh: 1 });
    if (flies) flies.update(t, camera, { density: 0.8 + 0.2 * k * w, wind: [0.05, 0, 0.02], gust: 0.3, ambient: [1, 1, 1], brightness: 2.2, focus: pFocus, bokeh: 1,
      center: tmpV.set(cpos.x + fwd.x * 10, 1.4, cpos.z + fwd.z * 10) });

    // grade
    post.grade.bloom.strength = L.bloom * (1 + 0.25 * k * (f.bass || 0));
    post.grade.dof.focus = Math.hypot(cam.look[0] - cam.pos[0], cam.look[1] - cam.pos[1], cam.look[2] - cam.pos[2]);
    // the eye adapts as the walk nears the bright clearing; a passing cloud opens the exposure a little
    post.grade.exposure = L.exposure * (night ? 1 : (1 + 0.12 * (1 - cloud)) * kit.lerp(1, 0.78, kit.smoothstep(-4, -30, cpos.z)));
    post.setSun(lightDir, camera);
    post.render(scene, camera, t);
  }
  // image-based light: baked once (the sun drifts by under 2 degrees, and a re-bake mid-song would make frames depend on
  // which frames were rendered before - the PMREM blur reuses its scratch targets)
  skyAt(0, 0); sky.update(0); scene.environment = sky.bakeEnvironment();
  function resize(w, h, pr = 1) { camera.aspect = w / h; camera.updateProjectionMatrix(); post.resize(w, h, pr); }
  resize(width, height, pixelRatio);
  return {
    render, resize,
    setIntensity(v) { intensity = kit.clamp(v); },
    dispose() { scene.environment = null; bag.dispose(); scene.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); scene.clear(); },
  };
}
