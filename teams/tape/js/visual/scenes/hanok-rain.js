// hanok-rain.js - "Seoul rain, hanok": a traditional Korean hanok courtyard (madang) at blue hour in light rain.
// A five-bay main hall (anchae) on a granite platform faces the courtyard, an L-wing (sarangchae) closes the left side,
// a plastered wall with a tiled coping the right; beyond it neighbouring roofs, a few city lights and layered misty
// mountains (Bugaksan close behind, Bukhansan's granite peaks far right). Curved giwa roofs with rising, outswung eave
// corners, round end tiles and rafters, hanji lattice doors glowing warm, red-and-blue silk lanterns (cheongsachorong),
// wet granite paving that mirrors the light, rain strings dripping from every tile channel, onggi jars on the jangdokdae.
// Variants share the world: blue hour rain (hero), lantern night, autumn maples (dry, low sun, drifting leaves) and first
// snow. Everything is a pure function of (t, f, seed): slow camera glides, drifting light and weather, subtle audio.
import * as kit from './kit.js?v=9d';
import { createBuilder, buildHall, buildRoof, boxGeo, mat, jarGeometry, lanternGeometry } from './hanok-rain-geo.js?v=9d';
import { createMaple } from './hanok-rain-tree.js?v=9d';
import { bakeAll, patchWeather, patchPaper, patchVertexEmissive, createDrips, createCityLights } from './hanok-rain-fx.js?v=9d';

export const meta = {
  id: 'hanok-rain', name: 'Hanok in the rain', group: 'Korea',
  desc: 'A Korean hanok courtyard at blue hour: curved tile roofs, glowing hanji doors, silk lanterns, rain strings off the eaves.',
  variants: [
    { id: 'blue-rain', name: 'Blue hour rain' },
    { id: 'lantern-night', name: 'Lantern night', text: { accent: '#ffb070' } },
    { id: 'autumn', name: 'Autumn maples', text: { ink: '#fbf1e2', accent: '#ff9a52' } },
    { id: 'first-snow', name: 'First snow', text: { ink: '#f3f6fb', accent: '#ffcf96' } },
  ],
  defaultVariant: 'blue-rain', thumbT: 24,
  text: { ink: '#f4eee6', accent: '#ffc27a' }, swatch: ['#1c2733', '#f0a25a'],
};

const LOOKS = {
  'blue-rain': { sun: [-4.0, 175], sunDrift: -1 / 400, moon: 0, clouds: 0.72, cloudDensity: 1.25, mie: 1.4, rayleigh: 1.15, ozone: 3.2,
    fog: { density: 0.0013, falloff: 0.0035, noise: 0.35, sunStrength: 0.05, skyDistance: 9000, tint: [0.48, 0.9, 1.15] },
    skyTint: [0.5, 0.97, 1.12], exposure: 16, temperature: -0.06, tint: -0.06, saturation: 0.97, contrast: 1.07, lift: [0.002, 0.006, 0.012], gain: [0.92, 1.0, 1.04], bloom: 0.085, emis: 0.3,
    weather: 'rain', rain: 0.62, wet: 1, puddles: 0.36, lanterns: 1, rooms: 1, snow: 0, leaves: 0, drips: 1, city: 1, envScale: 1, nightGlow: [0.0002, 0.0012, 0.0042] },
  'lantern-night': { sun: [-15, 175], sunDrift: 0, moon: 0.012, clouds: 0.85, cloudDensity: 1.5, mie: 1.5, rayleigh: 1,
    fog: { density: 0.0024, falloff: 0.003, noise: 0.4, sunStrength: 0.3, skyDistance: 450, tint: [1.5, 1.2, 0.95] },
    exposure: 10, temperature: 0.0, tint: -0.05, saturation: 0.92, contrast: 1.07, lift: [0.002, 0.004, 0.01], gain: [0.94, 0.98, 1.04], bloom: 0.1,
    weather: 'rain', rain: 0.42, wet: 1, puddles: 0.4, lanterns: 1.25, rooms: 1.1, snow: 0, leaves: 0, drips: 0.75, city: 1.4, envScale: 1, nightGlow: [0.034, 0.025, 0.019], skyTint: [1.25, 1.12, 1.0] },
  'autumn': { sun: [9, 128], sunDrift: -1 / 70, moon: 0, clouds: 0.32, cloudDensity: 1.0, mie: 1.7, rayleigh: 1,
    fog: { density: 0.0009, falloff: 0.003, noise: 0.15, sunStrength: 0.8, skyDistance: 0, tint: [1, 0.97, 0.92] },
    exposure: 1.05, temperature: 0.1, tint: 0.01, saturation: 1.02, contrast: 1.05, lift: [0.006, 0.004, 0.002], gain: [1.0, 0.975, 0.93], bloom: 0.06,
    weather: 'leaves', rain: 0, wet: 0.08, puddles: 0.06, lanterns: 0.0, rooms: 0.25, snow: 0, leaves: 0.16, autumn: true, drips: 0, city: 0, envScale: 1, shadows: true, rays: 0.35 },
  'first-snow': { sun: [-2.6, 175], sunDrift: -1 / 300, moon: 0, clouds: 0.8, cloudDensity: 1.3, mie: 1.5, rayleigh: 1.05,
    fog: { density: 0.002, falloff: 0.003, noise: 0.3, sunStrength: 0.15, skyDistance: 9000, tint: [0.9, 0.96, 1.04] },
    skyTint: [0.58, 0.96, 1.1], exposure: 5.6, temperature: -0.06, tint: -0.06, saturation: 0.92, contrast: 1.05, lift: [0.004, 0.007, 0.013], gain: [0.92, 1.0, 1.05], bloom: 0.08, emis: 0.9,
    weather: 'snow', rain: 0, wet: 0.2, puddles: 0.05, lanterns: 1, rooms: 1, snow: 0.78, leaves: 0, drips: 0.1, city: 0.8, envScale: 1, nightGlow: [0.0004, 0.0012, 0.0036] },
};

export function createScene({ THREE, renderer, width, height, pixelRatio = 1, variant = 'blue-rain', quality = 'high', seed = 1, intensity = 0.6 }) {
  const L = LOOKS[variant] || LOOKS['blue-rain'];
  const Qk = kit.Q[quality] || kit.Q.high, big = quality !== 'light', ultra = quality === 'ultra';
  const bag = kit.createBag(), rnd = kit.rng(kit.hashSeed('hanok-rain', seed)), rndV = kit.rng(kit.hashSeed('hanok-rain', variant, seed));
  let amount = intensity;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 12000);

  // ---------------------------------------------------------------- sky, fog, light
  const sky = bag.add(kit.createSky(THREE, renderer, { quality, sky: { sun: { elevation: L.sun[0], azimuth: L.sun[1] }, moon: { elevation: 24, azimuth: 60, intensity: L.moon, phase: 0.42 },
    mie: L.mie, rayleigh: L.rayleigh, ozone: L.ozone ?? 1.6, altitude: 0.08, clouds: { coverage: L.clouds, density: L.cloudDensity, scale: 0.5, wind: [0.004, 0.0015], softness: 0.45 }, nightGlow: L.nightGlow || [0, 0, 0] }, fog: L.fog }));
  scene.add(sky.mesh);
  // rain-cloud twilight: the overcast scatters away the violet of a clear twilight; tint the sky (and so the IBL baked
  // from it) toward the steel blue of a wet Seoul dusk, leaving the grade free to keep the lamps amber
  { const sm = sky.mesh.material; if (sm && sm.fragmentShader && sm.fragmentShader.includes('gl_FragColor = vec4(col, 1.0);')) {
    sm.uniforms.uHxSkyTint = { value: new THREE.Vector3(...(L.skyTint || [1, 1, 1])) };
    sm.fragmentShader = sm.fragmentShader.replace('gl_FragColor = vec4(col, 1.0);', 'gl_FragColor = vec4(col * uHxSkyTint, 1.0);').replace('void main()', 'uniform vec3 uHxSkyTint;\nvoid main()');
    sm.needsUpdate = true; } }
  const sun = new THREE.DirectionalLight(0xffffff, 1); scene.add(sun, sun.target);
  const moon = new THREE.DirectionalLight(0xffffff, 1); scene.add(moon, moon.target);
  const flash = new THREE.DirectionalLight(0xc8d4ff, 0); flash.position.set(-30, 80, -60); scene.add(flash);
  if (L.shadows && big) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; kit.sunShadow(sun, { size: Qk.shadowMap, extent: 16, far: 160, bias: -0.0005, normalBias: 0.04 }); sun.target.position.set(0, 0, -4); }

  // ---------------------------------------------------------------- textures + materials
  const T = bakeAll(THREE, renderer, quality);
  const rep = (tex) => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex; };
  const Uroof = { uWet: { value: L.wet }, uSnow: { value: L.snow }, uLeaves: { value: L.leaves * 0.25 } };
  const Ustone = { uWet: { value: L.wet * 0.75 }, uSnow: { value: L.snow * 0.8 }, uLeaves: { value: L.leaves * 0.15 } };
  const Uground = { uWet: { value: 0 }, uSnow: { value: L.snow * 1.15 }, uLeaves: { value: L.leaves } };
  const Ujar = { uWet: { value: L.wet * 0.8 }, uSnow: { value: L.snow }, uLeaves: { value: 0 } };
  const Umount = { uWet: { value: 0 }, uSnow: { value: L.snow * 1.1 }, uLeaves: { value: 0 } };
  const std = (o, wx, wxOpt) => { const m = new THREE.MeshStandardMaterial(o); if (wx) patchWeather(m, wx, wxOpt); sky.patch(m); return bag.add(m); };
  const tileMat = std({ map: rep(T.tile), normalMap: rep(T.tileN), roughnessMap: rep(T.tileO), aoMap: T.tileO, aoMapIntensity: 1, vertexColors: true, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1, 1), envMapIntensity: L.wet > 0.5 ? 3.4 : 2.2 }, Uroof, { leaves: true });
  const ridgeMat = std({ vertexColors: true, roughness: 0.6, metalness: 0, envMapIntensity: 1.8 }, Uroof, { leaves: false });
  const woodMat = std({ map: T.wood, normalMap: T.woodN, vertexColors: true, roughness: 0.72, metalness: 0, normalScale: new THREE.Vector2(0.6, 0.6) });
  const plasterMat = std({ map: T.plaster, vertexColors: true, roughness: 0.93, metalness: 0 });
  const stoneMat = std({ map: T.granite, normalMap: T.graniteN, vertexColors: true, roughness: 0.82, metalness: 0, normalScale: new THREE.Vector2(0.8, 0.8) }, Ustone, { leaves: true });
  const Upaper = { uRoom: { value: new Array(8).fill(0) }, uPaperCol: { value: new THREE.Vector3(...kit.kelvin(L.weather === 'rain' ? 1850 : 2200)) } };
  const paperMat = bag.add(sky.patch(patchPaper(new THREE.MeshStandardMaterial({ map: T.door, roughness: 0.88, metalness: 0, emissive: 0xffffff, side: THREE.FrontSide }), Upaper)));
  const jarMat = std({ color: 0xffffff, roughness: 0.2, metalness: 0, envMapIntensity: 3.0 }, Ujar, { leaves: false });

  // eave occlusion: IBL knows nothing of the deep hanok overhangs, so everything under a roof sees less sky (the soffit,
  // the maru, the walls and paper doors go dim and the warm room light takes over, as in real dusk photographs)
  const roofU = { uHxRoof: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uHxRoofY: { value: [0, 0] } };
  const patchEaveAO = (m) => {
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
    m.onBeforeCompile = (sh, rr) => { prev?.call(m, sh, rr); Object.assign(sh.uniforms, roofU);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform vec4 uHxRoof[2]; uniform float uHxRoofY[2];
        float hxEaveAO(vec3 w) { float ao = 1.0;
          for (int i = 0; i < 2; i++) { vec4 b = uHxRoof[i]; float H = uHxRoofY[i];
            float d = min(min(w.x - b.x, b.z - w.x), min(w.z - b.y, b.w - w.z));
            if (d > -0.05 && w.y < H) ao = min(ao, 1.0 - 0.8 * smoothstep(0.0, 0.85, (d + 0.05) / max(H - w.y, 0.25))); }
          return ao; }`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { float eao = hxEaveAO(vKitWorld); reflectedLight.indirectDiffuse *= eao; reflectedLight.indirectSpecular *= eao; }`); };
    m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|hxeao'; m.needsUpdate = true; return m;
  };
  for (const m of [woodMat, plasterMat, stoneMat, paperMat]) patchEaveAO(m);

  // ---------------------------------------------------------------- the compound
  const B = { tiles: createBuilder(THREE), ridge: createBuilder(THREE), wood: createBuilder(THREE), plaster: createBuilder(THREE), stone: createBuilder(THREE), paper: createBuilder(THREE) };
  const lod = big ? (ultra ? 1.25 : 1) : 0.55;
  const main = buildHall(THREE, B, { matrix: mat(THREE, 0, 0, -8.6, 0), bays: [2.4, 2.4, 2.7, 2.4, 2.4], depth: 4.8, baseH: 0.75, colH: 2.5, roofH: 2.95, overhang: 1.28,
    fronts: ['window', 'doors', 'doors', 'doors', 'window'], drips: true, glowBase: 0, rise: 0.5, bulge: 0.34, lod }, rnd);
  const wing = buildHall(THREE, B, { matrix: mat(THREE, -10.6, 0, 1.0, Math.PI / 2), bays: [2.3, 2.3, 2.3], depth: 4.2, baseH: 0.5, colH: 2.35, roofH: 2.45, overhang: 1.22,
    fronts: ['doors', 'window', 'doors'], drips: true, glowBase: 5, rise: 0.42, bulge: 0.28, lod, backWall: false }, rnd);
  // courtyard wall (right): granite footing, lime plaster with a timber band, tiled coping
  const WX = 8.6, WZ0 = -13.5, WZ1 = 13.5, WL = WZ1 - WZ0, WH = 2.05;
  {
    // plaster core, then a dry-laid granite lower half (two rough courses) and kkotdam tile patterns above
    B.plaster.add(boxGeo(THREE, 0.34, WH, WL, 1.0), mat(THREE, WX, WH / 2, (WZ0 + WZ1) / 2), (q) => { const k = 0.78 + 0.2 * kit.smoothstep(WH, 1.1, q.y); return [k, k * 0.985, k * 0.96]; });
    for (let row = 0; row < 3; row++) {
      let a = WZ0 + (row % 2) * 0.2 * rnd(); const y0 = row * 0.33;
      while (a < WZ1 - 0.05) { const l = Math.min(WZ1 - a, 0.32 + 0.45 * rnd()), h = 0.26 + 0.08 * rnd(), tn = 0.72 + 0.35 * rnd();
        B.stone.add(boxGeo(THREE, 0.4 + 0.04 * rnd(), h, l - 0.035, 0.6), mat(THREE, WX - 0.01, y0 + h / 2 + 0.02, a + l / 2, (rnd() - 0.5) * 0.06, null, 0, (rnd() - 0.5) * 0.08), [tn, tn * 0.98, tn * 0.95]); a += l; }
    }
    const T1 = (y, z, sy, sz, rx = 0) => B.ridge.add(boxGeo(THREE, 0.37, sy, sz, 1), mat(THREE, WX, y, z, 0, null, rx), [0.2, 0.19, 0.18]);
    for (let z = WZ0 + 1.6; z < WZ1 - 1.2; z += 2.9) {
      const yc = 1.48, pw = 1.5, ph = 0.56;
      T1(yc + ph / 2, z, 0.035, pw); T1(yc - ph / 2, z, 0.035, pw); T1(yc, z - pw / 2, ph, 0.035); T1(yc, z + pw / 2, ph, 0.035);
      for (const s of [-1, 1]) for (const u of [-1, 1]) T1(yc + u * 0.1, z + s * 0.2, 0.035, 0.3, s * u * 0.62);
    }
    buildRoof(THREE, B, { matrix: mat(THREE, WX, 0, (WZ0 + WZ1) / 2, Math.PI / 2), hx0: WL / 2 + 0.25, hz0: 0.5, yE: WH + 0.02, H: 0.36, vg: 0, rise: 0.06, bulge: 0.0,
      wallHx: WL / 2, wallHz: 0.18, wallY: WH, thick: 0.1, perTile: big ? 4 : 3, nv: 6, gableOver: 0.12, ridgeLift: 0.08, lod: 1 }, rnd);
  }
  // neighbouring hanok roofs beyond the wall (lower LOD), each over a plain plastered body
  const neighbours = [];
  for (const nb of [{ x: 15.5, y: -0.4, z: -10, r: 0.04, hx: 5.6, hz: 3.0, H: 2.4, vg: 0 }, { x: 23, y: -1.2, z: 1.5, r: Math.PI / 2 + 0.05, hx: 6.5, hz: 3.3, H: 2.6, vg: 0.5 },
    { x: 19, y: -0.8, z: -24, r: -0.06, hx: 7.2, hz: 3.6, H: 2.7, vg: 0.55 }, { x: 33, y: -2.4, z: -14, r: 0.1, hx: 6.0, hz: 3.2, H: 2.5, vg: 0 }, { x: 31, y: -3.2, z: 12, r: Math.PI / 2 - 0.08, hx: 5.5, hz: 3.0, H: 2.3, vg: 0.5 }]) {
    const m = mat(THREE, nb.x, nb.y, nb.z, nb.r), top = 3.1;
    buildRoof(THREE, B, { matrix: m, hx0: nb.hx, hz0: nb.hz, yE: top, H: nb.H, vg: nb.vg, rise: nb.vg ? 0.4 : 0.12, bulge: nb.vg ? 0.25 : 0.05, wallHx: nb.hx - 1.1, wallHz: nb.hz - 1.1, wallY: top + 0.1,
      perTile: 3, nv: 12, lod: big ? 0.6 : 0.4 }, rnd);
    B.plaster.add(boxGeo(THREE, 2 * (nb.hx - 1.2), top + 3, 2 * (nb.hz - 1.2), 1.0), mat(THREE, 0, (top - 3) / 2, 0, 0, m), [0.55, 0.53, 0.5]);
    neighbours.push(nb);
  }
  for (const nb of [{ x: -21, y: -0.6, z: -9, r: 0.03, hx: 6.2, hz: 3.2, H: 2.5, vg: 0.5 }, { x: -24, y: -1.5, z: 9, r: Math.PI / 2 + 0.04, hx: 5.8, hz: 3.0, H: 2.4, vg: 0 }, { x: -9, y: -0.5, z: -22, r: -0.03, hx: 6.8, hz: 3.4, H: 2.6, vg: 0.55 }]) {
    const m = mat(THREE, nb.x, nb.y, nb.z, nb.r), top = 3.1;
    buildRoof(THREE, B, { matrix: m, hx0: nb.hx, hz0: nb.hz, yE: top, H: nb.H, vg: nb.vg, rise: nb.vg ? 0.4 : 0.12, bulge: nb.vg ? 0.25 : 0.05, wallHx: nb.hx - 1.1, wallHz: nb.hz - 1.1, wallY: top + 0.1,
      perTile: 3, nv: 12, lod: big ? 0.5 : 0.35 }, rnd);
    B.plaster.add(boxGeo(THREE, 2 * (nb.hx - 1.2), top + 3, 2 * (nb.hz - 1.2), 1.0), mat(THREE, 0, (top - 3) / 2, 0, 0, m), [0.5, 0.48, 0.45]);
  }
  // jangdokdae: a low stone platform with onggi jars (front-left corner of the courtyard)
  const JX = -6.3, JZ = 6.9;
  B.stone.add(boxGeo(THREE, 2.5, 0.22, 2.8, 0.9), mat(THREE, JX, 0.11, JZ, 0.03), [0.78, 0.78, 0.76]);
  const meshOf = (b, m, name) => { const g = bag.add(b.build()); const me = new THREE.Mesh(g, m); me.name = name; me.castShadow = me.receiveShadow = true; scene.add(me); return me; };
  const tilesMesh = meshOf(B.tiles, tileMat, 'tiles'), ridgeMesh = meshOf(B.ridge, ridgeMat, 'ridges'), woodMesh = meshOf(B.wood, woodMat, 'timber');
  const plasterMesh = meshOf(B.plaster, plasterMat, 'plaster'), stoneMesh = meshOf(B.stone, stoneMat, 'stone'), paperMesh = meshOf(B.paper, paperMat, 'hanji');
  paperMesh.castShadow = false;

  // instanced: round end tiles, rafters, jars
  const Y = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const endTiles = [...main.endTiles, ...wing.endTiles];
  const rafters = [...main.rafters, ...wing.rafters];
  {
    const g = bag.add(new THREE.CylinderGeometry(0.078, 0.078, 0.07, big ? 12 : 8));
    const im = new THREE.InstancedMesh(g, ridgeMat, endTiles.length); im.name = 'end-tiles';
    endTiles.forEach((e, i) => { q.setFromUnitVectors(Y, e.dir); ps.set(...e.pos); sc.set(e.s, 1, e.s); m4.compose(ps, q, sc); im.setMatrixAt(i, m4); });
    im.castShadow = true; scene.add(im);
  }
  {
    const g = bag.add(new THREE.CylinderGeometry(1, 1, 1, big ? 8 : 6, 1));
    const im = new THREE.InstancedMesh(g, woodMat, rafters.length); im.name = 'rafters';
    const d = new THREE.Vector3();
    rafters.forEach((r, i) => { const a = new THREE.Vector3(...r.a), b2 = new THREE.Vector3(...r.b); d.subVectors(b2, a); const len = d.length(); d.normalize(); q.setFromUnitVectors(Y, d); ps.addVectors(a, b2).multiplyScalar(0.5); sc.set(r.r, len, r.r); m4.compose(ps, q, sc); im.setMatrixAt(i, m4); });
    const col = new THREE.Color(); rafters.forEach((r, i) => { const k = 0.5 + 0.25 * rnd(); im.setColorAt(i, col.setRGB(k, k * 0.97, k * 0.93)); });
    im.castShadow = true; scene.add(im);
  }
  {
    const g = bag.add(jarGeometry(THREE, big ? 28 : 16)); const jars = [];
    const layout = [[-0.75, -0.85, 1.05], [0.15, -0.95, 1.0], [0.85, -0.7, 0.82], [-0.85, 0.15, 0.92], [0.0, 0.05, 0.88], [0.8, 0.25, 0.72], [-0.6, 0.95, 0.66], [0.25, 0.95, 0.6], [0.95, 1.05, 0.52]];
    for (const [x, z, s] of layout) jars.push({ x: JX + x + (rnd() - 0.5) * 0.08, z: JZ + z + (rnd() - 0.5) * 0.08, s: s * (0.95 + 0.1 * rnd()), r: rnd() * 6.3 });
    const im = new THREE.InstancedMesh(g, jarMat, jars.length); im.name = 'onggi';
    const col = new THREE.Color();
    jars.forEach((j, i) => { q.setFromAxisAngle(Y, j.r); ps.set(j.x, 0.22, j.z); sc.set(j.s, j.s * (0.95 + 0.1 * rnd()), j.s); m4.compose(ps, q, sc); im.setMatrixAt(i, m4);
      const k = 0.8 + 0.4 * rnd(); im.setColorAt(i, col.setRGB(0.075 * k, 0.034 * k, 0.016 * k)); });
    im.castShadow = im.receiveShadow = true; scene.add(im);
  }

  // maples (danpung-namu) beyond the right wall and behind the wing: green at blue hour, crimson in autumn, red + snow
  const PAL = { green: [[0.03, 0.062, 0.018], [0.045, 0.08, 0.02], [0.028, 0.05, 0.024]],
    red: [[0.42, 0.03, 0.014], [0.52, 0.1, 0.012], [0.5, 0.2, 0.02], [0.32, 0.022, 0.018]],
    late: [[0.3, 0.025, 0.012], [0.38, 0.06, 0.012], [0.28, 0.1, 0.016]] };
  const maplePal = L.autumn ? PAL.red : L.weather === 'snow' ? PAL.late : PAL.green;
  const maples = [
    createMaple(THREE, renderer, { x: 11.6, z: -2.2, y: -0.25, height: 7.2, spread: 3.8, seed: seed * 7 + 1, quality, palette: maplePal, snow: L.snow * 0.7, sky }),
    createMaple(THREE, renderer, { x: -15.8, z: -4.5, y: -0.4, height: 6.2, spread: 3.2, seed: seed * 7 + 2, quality, palette: maplePal, snow: L.snow * 0.7, sky, leafScale: 0.6 }),
  ];
  if (big) for (const [mx, mz, my, mh, ms, k] of [[-24, -1, -0.8, 7.5, 4.2, 3], [-18, -17, -0.6, 6.8, 3.8, 4], [15, -19, -0.8, 7.0, 4.0, 5], [21.5, 7.5, -1.4, 7.8, 4.4, 6], [-6, -20.5, -0.5, 6.4, 3.6, 7]])
    maples.push(createMaple(THREE, renderer, { x: mx, z: mz, y: my, height: mh, spread: ms, seed: seed * 7 + k, quality, palette: maplePal, snow: L.snow * 0.7, sky, leafScale: 0.42 }));
  for (const mp of maples) { bag.add(mp); scene.add(mp.trunk, mp.leaves); }

  // ---------------------------------------------------------------- ground: wet granite paving + mirror
  const mirror = (L.weather === 'rain' || L.wet > 0.3) ? bag.add(kit.createMirror(THREE, renderer, { y: 0, quality, width, height, pixelRatio })) : null;
  const groundGeo = bag.add(new THREE.PlaneGeometry(90, 90, 1, 1)); groundGeo.rotateX(-Math.PI / 2);
  { const uv = groundGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 90 / 6, uv.getY(i) * 90 / 6); }
  const groundMat = new THREE.MeshStandardMaterial({ map: rep(T.pave), normalMap: rep(T.paveN), roughnessMap: rep(T.paveO), aoMap: T.paveO, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.9, 0.9), envMapIntensity: 1.5 });
  patchWeather(groundMat, Uground, { leaves: true, ground: true });
  const wet = kit.patchWet(THREE, groundMat, { sky, mirror, wetness: L.wet * 0.72, puddles: L.puddles, puddleScale: 2.3, rain: L.rain, ripples: big ? 2 : 1, mirrorStrength: 0.8, darken: 0.42 });
  bag.add(groundMat);
  const ground = new THREE.Mesh(groundGeo, groundMat); ground.position.set(0, 0, 0); ground.receiveShadow = true; ground.name = 'madang'; scene.add(ground);

  // the land beyond the courtyard (under the far roofs, trees and the city): dark, fogged
  { const g = bag.add(kit.heightfield(THREE, { width: 3000, depth: 3000, segX: 60, segZ: 60, height: (x, z) => { const r = Math.max(Math.abs(x), Math.abs(z)); return -1.5 - kit.smoothstep(60, 600, r) * 12 + 18 * kit.smoothstep(80, 400, r) * (0.5 + 0.5 * kit.fbm2(x * 0.006, z * 0.006, { octaves: 4, seed: 12 })); } }));
    const m = bag.add(sky.patch(patchWeather(new THREE.MeshLambertMaterial({ color: new THREE.Color(0.03, 0.035, 0.03) }), Umount, { leaves: false })));
    const me = new THREE.Mesh(g, m); me.position.y = -0.05; me.name = 'land'; scene.add(me); }
  // ---------------------------------------------------------------- lanterns (cheongsachorong) under the main eave
  const lanternGeo = bag.add(lanternGeometry(THREE));
  const lanterns = [];
  const warm = new THREE.Color(...kit.kelvin(1850)), silk = new THREE.Color(1.0, 0.42, 0.2);
  const hooks = [[-2.55, main.top + 0.3, -6.2 + 0.78], [2.55, main.top + 0.3, -6.2 + 0.78], [-10.6 + 2.1 + 0.75, wing.top + 0.28, 1.0]];
  hooks.forEach((h, i) => {
    const m = bag.add(sky.patch(patchVertexEmissive(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, emissive: 0xffffff, emissiveIntensity: 0 }))));
    const pivot = new THREE.Group(); pivot.position.set(...h); scene.add(pivot);
    const mesh = new THREE.Mesh(lanternGeo, m); mesh.position.y = -1.12; pivot.add(mesh);
    const light = new THREE.PointLight(silk, 0, 9, 2); light.position.y = -1.12; pivot.add(light);
    const on = L.lanterns > 0 && (i < 2 || L.lanterns > 1.1);
    light.visible = on && (big || i === 0);            // an unlit light still costs every fragment: leave it out of the shaders
    lanterns.push({ pivot, mesh, light, mat: m, seed: 11 + i * 7, on });
  });
  // light spilling from the paper doors onto the maru, columns and wet stone
  const roomLights = [];
  const roomPos = [...main.glows, ...wing.glows];
  const spill = L.rooms < 0.5 ? [] : big ? [1, 3] : [2];
  for (const gi of spill) { const p = roomPos[gi]; if (!p) continue; const l = new THREE.PointLight(new THREE.Color(...kit.kelvin(2400)), 0, 9, 2);
    const fw = new THREE.Vector3(-p.x, 0, 2 - p.z).normalize();          // step out of the room, toward the madang: lights the maru and the eave soffit
    l.position.copy(p).addScaledVector(fw, 0.9); l.position.y += 0.35; scene.add(l); roomLights.push({ l, gi }); }
  // per-room glow programme: some rooms change over the song (a light comes on, one dims) - deterministic
  const rooms = roomPos.map((_, i) => ({ base: (0.75 + 0.5 * rndV()) * (i === 0 || i === 4 ? 0.55 : 1), on: rndV() < 0.25 ? 40 + rndV() * 120 : -1, off: rndV() < 0.15 ? 150 + rndV() * 120 : 1e9, seed: 31 + i }));
  rooms[6] && (rooms[6].base *= 0.4);

  // ---------------------------------------------------------------- far world: mountains, city lights
  const hBug = (x, z) => { // Bugaksan-like forested hill ~1 km behind
    const pk = 340 * Math.exp(-((x + 180) ** 2) / (2 * 560 ** 2) - ((z + 1080) ** 2) / (2 * 330 ** 2));
    const sh = 150 * Math.exp(-((x - 820) ** 2) / (2 * 520 ** 2) - ((z + 1300) ** 2) / (2 * 300 ** 2)) + 120 * Math.exp(-((x + 1300) ** 2) / (2 * 500 ** 2) - ((z + 1250) ** 2) / (2 * 380 ** 2));
    const n = 26 * kit.ridged2(x * 0.004, z * 0.004, { octaves: 5, seed: 3 }) + 7 * kit.fbm2(x * 0.03, z * 0.03, { octaves: 3, seed: 5 });
    return (pk + sh + n) * kit.smoothstep(-460, -700, z) - 6;
  };
  const hBuk = (x, z) => { // Bukhansan-like granite peaks, far right
    let h = 0; for (const [px, pz, ph, w] of [[2300, -5600, 820, 380], [2950, -5300, 760, 300], [3600, -5900, 700, 420], [1500, -5200, 560, 520], [-600, -6200, 520, 700], [-2600, -6000, 480, 800], [4600, -5600, 600, 600]])
      h = Math.max(h, ph * Math.exp(-((x - px) ** 2 + (z - pz) ** 2) / (2 * w * w)));
    h += 90 * kit.ridged2(x * 0.0012, z * 0.0012, { octaves: 5, seed: 9 }) + 260 * Math.exp(-((z + 5800) ** 2) / (2 * 900 ** 2));
    return h * kit.smoothstep(-3700, -4600, z) - 10;
  };
  const mountMat = bag.add(sky.patch(patchWeather(new THREE.MeshLambertMaterial({ vertexColors: true }), Umount, { leaves: false })));
  const mkMount = (fn, w, d, cx, cz, sx, sz, rock) => {
    const g = bag.add(kit.heightfield(THREE, { width: w, depth: d, segX: Math.round(sx * lod), segZ: Math.round(sz * lod), height: (x, z) => fn(x + cx, z + cz) }));
    const p = g.attributes.position, nrm = g.attributes.normal, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const slope = 1 - nrm.getY(i), n = 0.5 + 0.5 * kit.noise2(p.getX(i) * 0.01, p.getZ(i) * 0.01, 4);
      let col = [0.026 + 0.012 * n, 0.034 + 0.012 * n, 0.026 + 0.006 * n];
      if (L.autumn) { const h = kit.hash01(Math.round(p.getX(i) / 37), Math.round(p.getZ(i) / 37), 3), a = kit.smoothstep(0.25, 0.75, n * 0.6 + h * 0.4);
        const pal = h < 0.35 ? [0.16, 0.035, 0.012] : h < 0.6 ? [0.2, 0.08, 0.012] : h < 0.8 ? [0.17, 0.12, 0.02] : [0.03, 0.045, 0.025]; col = col.map((v, k) => kit.lerp(v, pal[k], a * 0.85)); }
      if (rock) { const r = kit.smoothstep(0.32, 0.55, slope + 0.15 * n) * kit.smoothstep(150, 420, p.getY(i)); col = col.map((v, k) => kit.lerp(v, [0.2, 0.195, 0.185][k], r)); }
      c.set(col, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const me = new THREE.Mesh(g, mountMat); me.position.set(cx, 0, cz); me.frustumCulled = false; scene.add(me); return me;
  };
  mkMount(hBug, 4200, 1500, 250, -1200, 150, 50, false);
  mkMount(hBuk, 12000, 3600, 1000, -5700, 160, 40, true);
  // city lights: hillside houses and streets right of the wall, at the foot of the hills
  let city = null;
  if (L.city > 0) {
    const pts = [], rc = kit.rng(kit.hashSeed('hanok-city', seed));
    const S = height * pixelRatio / 540;
    for (let i = 0; i < (big ? 900 : 450); i++) {
      const dist = 150 + 1500 * Math.pow(rc(), 0.8), bear = kit.deg(18 + 75 * rc());
      const x = Math.sin(bear) * dist, z = -Math.cos(bear) * dist;
      const gy = Math.max(0, hBug(x, z)); if (gy > 140) continue;
      const warmL = rc() < 0.65, c = warmL ? [1.0, 0.55, 0.22] : rc() < 0.5 ? [0.85, 0.92, 1.0] : [1.0, 0.82, 0.6];
      const k = (0.4 + rc() * 1.2) * (dist / 600) ** 0.6;
      pts.push({ x, y: gy + 2 + 18 * rc() * rc(), z, px: (0.7 + 0.9 * rc()) * S, c: c.map(v => v * k), tw: rc() });
    }
    city = bag.add(createCityLights(THREE, { points: pts, fog: sky.fog.uniforms })); scene.add(city.mesh);
  }

  // ---------------------------------------------------------------- weather
  // the kit's particles know nothing of roofs: kill any rain / snow / leaf inside the eave footprints below the eave line
  roofU.uHxRoof.value[0].set(-7.35, -12.2, 7.35, -4.98); roofU.uHxRoof.value[1].set(-13.8, -3.6, -7.4, 5.6);
  roofU.uHxRoofY.value = [main.top + 0.35, wing.top + 0.3];
  function hideUnderRoofs(obj) {
    obj.traverse((o) => {
      const m = o.material; if (!m || !m.isShaderMaterial || !/p = kWrap\(/.test(m.vertexShader)) return;
      Object.assign(m.uniforms, roofU);
      m.vertexShader = m.vertexShader.replace('void main() {', `uniform vec4 uHxRoof[2]; uniform float uHxRoofY[2];
        bool hxRoof(vec3 q) { for (int i = 0; i < 2; i++) { vec4 b = uHxRoof[i]; if (q.x > b.x && q.x < b.z && q.z > b.y && q.z < b.w && q.y < uHxRoofY[i]) return true; } return false; }
        void main() {`).replace(/(p = kWrap\([^;]*\);)/g, '$1 if (hxRoof(p)) KILL');
      m.needsUpdate = true;
    });
  }
  let fx = null, drips = null;
  if (L.weather === 'rain') {
    fx = kit.createParticles(THREE, renderer, { kind: 'rain', quality, fog: sky.fog.uniforms, seed, box: [22, 13, 22], splashes: { ground: 0, box: [16, 16], count: 1600, size: 0.045, period: 0.42 } });
  } else if (L.weather === 'snow') {
    fx = kit.createParticles(THREE, renderer, { kind: 'snow', quality, fog: sky.fog.uniforms, seed, box: [26, 14, 26], count: 7000 });
  } else if (L.weather === 'leaves') {
    fx = kit.createParticles(THREE, renderer, { kind: 'petals', quality, fog: sky.fog.uniforms, seed, box: [24, 10, 24], count: 520, color: [0.62, 0.07, 0.02], color2: [0.85, 0.36, 0.04], size: 0.032, speed: 0.85 });
  }
  if (fx) { bag.add(fx); scene.add(fx.object); hideUnderRoofs(fx.object); }
  if (L.drips > 0) {
    const all = [...main.drips, ...wing.drips].filter(p => p[0] > -7.9 && p[0] < 8.3 && p[2] > -5.6 && p[2] < 14).map(p => [p[0], p[1], p[2], 0]);
    drips = bag.add(createDrips(THREE, renderer, { origins: all, ground: 0, fog: sky.fog.uniforms, seed, quality }));
    scene.add(drips.mesh);
  }

  // ---------------------------------------------------------------- post + camera
  const post = bag.add(kit.createPost(THREE, renderer, { width, height, pixelRatio, quality, tonemap: 'aces', msaa: ultra ? 4 : big ? 2 : 0 }));
  Object.assign(post.grade, { exposure: L.exposure, temperature: L.temperature, tint: L.tint, saturation: L.saturation, contrast: L.contrast, lift: L.lift, gain: L.gain, vignette: 0.32, dirt: 0.08, aberration: 0.001 });
  post.grade.bloom.strength = L.bloom; post.grade.bloom.radius = 1; post.grade.rays.strength = L.rays || 0; post.grade.dof.strength = 0.45; post.grade.dof.range = 7;
  const path = kit.cameraPath([
    { pos: [-4.3, 1.45, 10.2], look: [1.4, 2.7, -7.5], fov: 42, portrait: { pos: [-2.4, 1.35, 5.2], look: [0.4, 2.45, -7.5], fov: 40 } },
    { pos: [-1.6, 1.65, 7.0], look: [1.8, 2.9, -8.0], fov: 38, portrait: { pos: [-0.8, 1.5, 3.4], look: [1.0, 2.55, -8.0], fov: 38 } },
    { pos: [1.8, 1.6, 3.2], look: [-3.6, 3.0, -6.8], fov: 40, portrait: { pos: [2.2, 1.5, 1.4], look: [-2.6, 2.65, -6.8], fov: 40 } },
    { pos: [5.4, 1.85, -3.0], look: [-4.2, 2.75, -6.0], fov: 42, portrait: { pos: [4.6, 1.7, -2.2], look: [-3.0, 2.6, -6.0], fov: 44 } },
  ], { period: 250, breathe: 0.035, seed });

  let envT = -1e9;
  const tmpV = new THREE.Vector3();
  const lightsFx = [];
  const silence = kit.silence();
  function render(t, f = silence, info = {}) {
    f = f || silence; const A = amount;
    const en = (f.energy || 0) * A, bass = (f.bass || 0) * A;
    // slow light & weather (incommensurate periods: nothing repeats within the song)
    sky.params.sun.elevation = L.sun[0] + L.sunDrift * t + 0.35 * Math.sin(t / 173 + seed);
    sky.params.sun.azimuth = L.sun[1] + 2 * Math.sin(t / 211);
    sky.params.clouds.coverage = kit.clamp(L.clouds + 0.06 * Math.sin(t / 97 + 1.3) + 0.04 * Math.sin(t / 151));
    const fogK = 1 + 0.22 * Math.sin(t / 127 + 0.7) + 0.12 * Math.sin(t / 59 + 2.1) + 0.12 * en;
    sky.fog.params.density = L.fog.density * fogK;
    sky.update(t);
    sky.applyLights({ sun, moon, target: tmpV.set(0, 0, -4) });
    sun.target.updateMatrixWorld();
    if (t - envT > Qk.envEvery || t < envT) { scene.environment = sky.bakeEnvironment(); envT = t; }
    const cam = path.apply(camera, t, { breath: kit.clamp((f.slow || 0) * 0.6 + en * 0.4) });

    // weather intensity: builds and eases over minutes; the music adds a little
    const rainK = L.rain * (1 + 0.22 * Math.sin(t / 83 + 0.4) + 0.12 * Math.sin(t / 151 + 2.0)) * (1 + 0.25 * kit.soft(en, 0.5));
    const windK = 1 + 0.3 * Math.sin(t / 71) + 0.35 * en + 0.4 * (f.big || 0) * A;
    const wind = [0.7 * windK, 0, 0.25 * windK];
    // lanterns: candle-like flicker inside silk, a pendulum sway in the wind
    lightsFx.length = 0;
    for (const l of lanterns) {
      const k = l.on ? L.lanterns * kit.flicker(t, l.seed, { speed: 1.0, depth: 0.16 }) * (1 + 0.1 * (f.level || 0) * A + 0.14 * (f.accent || 0) * A) : 0;
      l.mat.emissiveIntensity = 0.12 * k * (L.emis ?? 1); l.light.intensity = 0.7 * k;
      const w = kit.windAt(t, wind, 0.4);
      l.pivot.rotation.z = -0.035 * w[0] * (0.6 + 0.4 * kit.noise1(t * 0.31, l.seed)) - 0.01 * Math.sin(t * 2.4 + l.seed);
      l.pivot.rotation.x = 0.025 * w[2] + 0.012 * Math.sin(t * 2.1 + l.seed * 1.3);
      l.pivot.updateMatrixWorld();
      if (k > 0) { const p = l.light.getWorldPosition(new THREE.Vector3()); lightsFx.push({ position: p, color: l.light.color, intensity: 0.5 * k, radius: 1.6 }); }
    }
    // rooms behind the hanji
    const R = Upaper.uRoom.value;
    for (let i = 0; i < 8; i++) {
      const r = rooms[i]; if (!r) { R[i] = 0; continue; }
      let g = r.base * L.rooms * (0.94 + 0.06 * kit.noise1(t * 0.05, r.seed));
      if (r.on > 0) g *= kit.smoothstep(r.on, r.on + 2.5, t);
      g *= 1 - 0.85 * kit.smoothstep(r.off, r.off + 3, t);
      R[i] = 0.1 * (L.emis ?? 1) * g * (1 + 0.06 * bass);
    }
    for (const rl of roomLights) rl.l.intensity = 26 * R[rl.gi];
    if (lightsFx.length < 4) for (const rl of roomLights) { if (lightsFx.length >= 4) break; lightsFx.push({ position: rl.l.position, color: rl.l.color, intensity: 0.35 * R[rl.gi], radius: 1.4 }); }
    // lightning: rare distant flashes on the biggest accents (rain variants only)
    const fl = L.weather === 'rain' ? kit.lightning(t, f, seed) * A * 0.7 : 0;
    flash.intensity = fl * 1.2;
    sky.params.nightGlow = L.nightGlow ? L.nightGlow.map((v, k) => v + fl * [0.004, 0.0045, 0.006][k]) : [fl * 0.004, fl * 0.0045, fl * 0.006];
    // weather fx
    const amb = sky.ambient.sky, ab = [amb.r * 0.22 + fl * 0.02, amb.g * 0.22 + fl * 0.022, amb.b * 0.25 + fl * 0.026];
    if (fx) {
      if (L.weather === 'rain') fx.update(t, camera, { density: kit.clamp(rainK), wind, gust: 0.45, shutter: 1 / 48, lights: lightsFx, ambient: ab, brightness: 1.0, focus: 6 });
      else if (L.weather === 'snow') fx.update(t, camera, { density: kit.clamp(0.5 + 0.18 * Math.sin(t / 89) + 0.2 * kit.soft(en, 0.5)), wind: [0.35 * windK, 0, 0.12], gust: 0.5, lights: lightsFx, ambient: [amb.r * 0.5, amb.g * 0.5, amb.b * 0.55], brightness: 1, focus: 6, bokeh: 1 });
      else fx.update(t, camera, { density: kit.clamp(0.45 + 0.25 * Math.sin(t / 77) + 0.2 * kit.soft(en, 0.5)), wind: [0.8 * windK, -0.05, 0.35], gust: 0.6, sunDir: sky.sunDir, sunColor: sky.sunColor, ambient: [amb.r * 0.4, amb.g * 0.4, amb.b * 0.4], brightness: 1, focus: 6 });
    }
    if (drips) {
      const cyc = 3.2 * t + 1.6 * (f.flow || 0) * A;      // never jumps: t and flow are monotonic
      drips.update(t, camera, { cyc, rate: 3.2 + 1.6 * en, density: kit.clamp(L.drips * (0.55 + 0.6 * rainK)), wind, lights: lightsFx, ambient: [amb.r * 0.5, amb.g * 0.5, amb.b * 0.55], brightness: 3 });
    }
    for (const mp of maples) { mp.update(t, wind, 0.45); if (L.autumn) mp.uniforms.uTrans.value.set(sky.sunColor.r, sky.sunColor.g, sky.sunColor.b).multiplyScalar(0.06); }
    if (city) { city.uniforms.uTime.value = t; city.uniforms.uGain.value = 14 * L.city; renderer.getDrawingBufferSize(city.uniforms.uRes.value); }
    wet.uniforms.uTime.value = t; wet.uniforms.uRain.value = L.weather === 'rain' ? kit.clamp(0.35 + 0.6 * rainK) : 0;
    // grade: tiny bloom breathing with the bass, exposure follows the falling light a touch
    post.grade.exposure = L.exposure * (1 + 0.08 * Math.sin(t / 143)) * (1 + fl * 0.35);
    post.grade.bloom.strength = L.bloom * (1 + 0.25 * kit.soft(bass, 0.6));
    post.grade.dof.focus = Math.hypot(cam.pos[0] - cam.look[0], cam.pos[1] - cam.look[1], cam.pos[2] - cam.look[2]) * 0.8;
    if (mirror) { if (fx) fx.object.visible = false; if (drips) drips.mesh.visible = false; mirror.update(scene, camera, { hide: [ground] }); if (fx) fx.object.visible = true; if (drips) drips.mesh.visible = true; }
    post.setSun(sky.sunDir, camera);
    post.render(scene, camera, t);
  }
  function resize(w, h, pr = 1) { camera.aspect = w / h; camera.updateProjectionMatrix(); post.resize(w, h, pr); mirror?.resize(w, h, pr); }
  resize(width, height, pixelRatio);
  return {
    render, resize,
    setIntensity(v) { amount = kit.clamp(v); },
    dispose() { bag.dispose(); scene.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); scene.clear(); scene.environment = null; },
  };
}
