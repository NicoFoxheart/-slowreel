// kit-demo.js - the kit's reference scene (hidden from the picker; `node tests/scene-check.cjs kit-demo`). A stone
// courtyard with paper lanterns, three looks: rainy dusk (wet stone, puddle reflections, ripples, rain + splashes,
// height fog), golden lake (water, sun glitter, light shafts, dust) and snowy night (moon, stars, snow, lantern glow).
// Copy it as a template: meta + createScene, everything built from the kit, everything freed by one bag.
import * as kit from './kit.js?v=9e';

export const meta = {
  id: 'kit-demo', name: 'Kit demo', group: 'Classic', desc: 'Reference scene for the kit.',
  variants: [{ id: 'dusk-rain', name: 'Rainy dusk' }, { id: 'golden-lake', name: 'Golden lake' }, { id: 'night-snow', name: 'Snowy night' }],
  defaultVariant: 'dusk-rain', thumbT: 20, text: { ink: '#f6efe4', accent: '#ffc98a' },
};

const LOOKS = {
  'dusk-rain': { sun: [3.5, -70], moon: 0, clouds: 0.82, cloudDensity: 1.5, mie: 1.8, fog: { density: 0.014, falloff: 0.06, noise: 0.45, sunStrength: 0.2, skyDistance: 1800, tint: [0.42, 0.46, 0.55] },
    exposure: 1.15, temperature: 0.05, tint: 0, saturation: 0.95, contrast: 1.05, lift: [0.004, 0.006, 0.012], gain: [1, 0.99, 0.97], weather: 'rain', ground: 'stone', lanterns: 1.0, rays: 0, bloom: 0.07 },
  'golden-lake': { sun: [5, -12], moon: 0, clouds: 0.38, cloudDensity: 1.0, mie: 1.6, fog: { density: 0.0022, falloff: 0.03, noise: 0.2, sunStrength: 0.9, skyDistance: 0 },
    exposure: 0.9, temperature: 0.12, tint: 0.02, saturation: 1.05, contrast: 1.04, lift: [0.006, 0.004, 0.0], gain: [1.0, 0.98, 0.94], weather: 'dust', ground: 'water', lanterns: 0.35, rays: 0.6, bloom: 0.06 },
  'night-snow': { sun: [-22, 40], moon: 0.09, clouds: 0.25, cloudDensity: 0.8, mie: 1.2, fog: { density: 0.006, falloff: 0.05, noise: 0.25, sunStrength: 0.25, skyDistance: 0 },
    exposure: 7, temperature: -0.12, tint: 0, saturation: 0.9, contrast: 1.06, lift: [0.0, 0.002, 0.008], gain: [1, 1, 1.02], weather: 'snow', ground: 'snow', lanterns: 1.2, rays: 0, bloom: 0.08 },
};

const STONE_FS = `vec4 bake(vec2 uv) {
  vec2 w = kWorley2p(uv * 5.0, vec2(5.0)); float edge = w.y - w.x;
  float grout = smoothstep(0.03, 0.11, edge);
  float n = kFbm2p(uv * 12.0, vec2(12.0), 5), m = kFbm2p(uv * 40.0, vec2(40.0), 3);
  float tone = kHash12(floor((uv * 5.0 - w.x * 0.0) * 1.0) + floor(n * 3.0));
  vec3 stone = mix(vec3(0.20, 0.19, 0.18), vec3(0.36, 0.34, 0.31), n * 0.8 + m * 0.2) * (0.85 + 0.3 * tone);
  vec3 col = mix(vec3(0.05, 0.045, 0.04), stone, grout);
  float height = grout * (0.7 + 0.3 * n) + m * 0.08;
  return vec4(col, height);
}`;
const ORM_FS = `vec4 bake(vec2 uv) {
  vec2 w = kWorley2p(uv * 5.0, vec2(5.0)); float grout = smoothstep(0.03, 0.11, w.y - w.x);
  float n = kFbm2p(uv * 20.0, vec2(20.0), 4);
  return vec4(1.0, mix(0.97, 0.62 + 0.25 * n, grout), 0.0, 1.0);
}`;
const PLASTER_FS = `vec4 bake(vec2 uv) {
  float n = kFbm2p(uv * 6.0, vec2(6.0), 6), s = kFbm2p(uv * vec2(3.0, 18.0), vec2(3.0, 18.0), 4);
  vec3 c = mix(vec3(0.52, 0.47, 0.40), vec3(0.66, 0.61, 0.53), n) * (0.9 + 0.12 * s);
  return vec4(c, n);
}`;

export function createScene({ THREE, renderer, width, height, pixelRatio = 1, variant = 'dusk-rain', quality = 'high', seed = 1 }) {
  const L = LOOKS[variant] || LOOKS['dusk-rain'];
  const bag = kit.createBag(), rnd = kit.rng(kit.hashSeed('kit-demo', seed));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 2500);
  const big = quality !== 'light';

  // sky + fog
  const sky = bag.add(kit.createSky(THREE, renderer, { quality, sky: { sun: { elevation: L.sun[0], azimuth: L.sun[1] }, moon: { elevation: 32, azimuth: 30, intensity: L.moon, phase: 0.3 },
    mie: L.mie, clouds: { coverage: L.clouds, density: L.cloudDensity } }, fog: L.fog }));
  scene.add(sky.mesh);

  // lights
  const sun = new THREE.DirectionalLight(0xffffff, 1); scene.add(sun, sun.target);
  const moon = new THREE.DirectionalLight(0xffffff, 1); scene.add(moon, moon.target);
  if (big && L.ground !== 'snow') { renderer.shadowMap.enabled = true; kit.sunShadow(sun, { size: kit.Q[quality].shadowMap, extent: 14 }); }

  // ground
  let ground, mirror = null, water = null, wet = null;
  const tsz = big ? 1024 : 512;
  if (L.ground === 'water') {
    mirror = bag.add(kit.createMirror(THREE, renderer, { y: 0, quality, width, height, pixelRatio }));
    water = bag.add(kit.createWater(THREE, renderer, { size: 1200, sky, mirror, quality, roughness: 0.16, waveStrength: 0.28, deep: [0.006, 0.02, 0.028] }));
    ground = water.mesh; scene.add(ground);
  } else {
    const albedo = kit.cached(renderer, 'demo:stone:' + tsz, () => kit.bakeTexture(THREE, renderer, { width: tsz, fragment: STONE_FS }));
    const orm = kit.cached(renderer, 'demo:orm:' + tsz, () => kit.bakeTexture(THREE, renderer, { width: tsz, fragment: ORM_FS }));
    const nrm = kit.cached(renderer, 'demo:stoneN:' + tsz, () => kit.normalMapFromHeight(THREE, renderer, albedo, { strength: 5, channel: 'a' }));
    const geo = bag.add(new THREE.PlaneGeometry(400, 400, 1, 1)); geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 400 / 3.2, uv.getY(i) * 400 / 3.2);
    const snow = L.ground === 'snow';
    const mat = new THREE.MeshStandardMaterial({ map: snow ? null : albedo, roughnessMap: snow ? null : orm, normalMap: nrm, normalScale: new THREE.Vector2(snow ? 0.25 : 1, snow ? 0.25 : 1),
      color: snow ? 0xe8ecf4 : 0xffffff, roughness: snow ? 0.85 : 1, metalness: 0 });
    if (L.weather === 'rain') {
      mirror = bag.add(kit.createMirror(THREE, renderer, { y: 0, quality, width, height, pixelRatio }));
      wet = kit.patchWet(THREE, mat, { sky, mirror, wetness: 0.8, puddles: 0.42, puddleScale: 2.6, rain: 0.6, ripples: big ? 2 : 1 });
    } else sky.patch(mat);
    ground = new THREE.Mesh(geo, bag.add(mat)); ground.receiveShadow = true; scene.add(ground);
  }

  // a few plaster pillars on stone bases and a low wall (courtyard or pier)
  const plaster = kit.cached(renderer, 'demo:plaster:512', () => kit.bakeTexture(THREE, renderer, { width: 512, fragment: PLASTER_FS }));
  const plasterN = kit.cached(renderer, 'demo:plasterN:512', () => kit.normalMapFromHeight(THREE, renderer, plaster, { strength: 2, channel: 'a' }));
  const pillarMat = bag.add(sky.patch(new THREE.MeshStandardMaterial({ map: plaster, normalMap: plasterN, roughness: 0.85 })));
  const woodMat = bag.add(sky.patch(new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.55 })));
  const pillarGeo = bag.add(new THREE.CylinderGeometry(0.22, 0.24, 3.2, 24));
  const beamGeo = bag.add(new THREE.BoxGeometry(9, 0.32, 0.32));
  const posts = new THREE.Group(); scene.add(posts);
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(pillarGeo, L.ground === 'water' ? woodMat : pillarMat); p.position.set(-3.6 + i * 2.4, 1.6, -4.5 + rnd.range(-0.1, 0.1)); p.castShadow = p.receiveShadow = true; posts.add(p);
  }
  const beam = new THREE.Mesh(beamGeo, woodMat); beam.position.set(0, 3.25, -4.5); beam.castShadow = true; posts.add(beam);
  if (L.ground === 'water') { posts.position.y = -0.6; }

  // paper lanterns: emissive shells + point lights that flicker
  const lanternGeo = bag.add(new THREE.SphereGeometry(0.28, 32, 16)); lanternGeo.scale(1, 1.25, 1);
  const lanterns = [];
  const warm = kit.kelvin(1900);
  for (let i = 0; i < 3; i++) {
    const m = bag.add(sky.patch(new THREE.MeshStandardMaterial({ color: 0x220a04, emissive: new THREE.Color(...warm), emissiveIntensity: 6 * L.lanterns, roughness: 0.6 })));
    const mesh = new THREE.Mesh(lanternGeo, m); mesh.position.set(-2.4 + i * 2.4, 2.55, -4.2); scene.add(mesh);
    const light = new THREE.PointLight(new THREE.Color(...warm), 0, 9, 2); light.position.copy(mesh.position).y -= 0.1; scene.add(light);
    lanterns.push({ mesh, light, mat: m, seed: i * 3 + 1 });
  }

  // distant hills (aerial perspective in the fog)
  const hillGeo = bag.add(kit.heightfield(THREE, { width: 1600, depth: 1600, segX: big ? 160 : 80, segZ: big ? 160 : 80,
    height: (x, z) => { const r = Math.hypot(x, z); const ring = kit.smoothstep(180, 420, r); return ring * (40 + 140 * kit.ridged2(x * 0.004, z * 0.004, { octaves: 5, seed: 7 })) - 2; } }));
  const hills = new THREE.Mesh(hillGeo, bag.add(sky.patch(new THREE.MeshStandardMaterial({ color: L.ground === 'snow' ? 0xc8d0dc : 0x2c3a2a, roughness: 0.95 }))));
  scene.add(hills);

  // weather
  const fx = L.weather === 'rain' ? kit.createParticles(THREE, renderer, { kind: 'rain', quality, fog: sky.fog.uniforms, seed, splashes: { ground: 0, box: [14, 14], count: 1400 } })
    : L.weather === 'snow' ? kit.createParticles(THREE, renderer, { kind: 'snow', quality, fog: sky.fog.uniforms, seed })
      : kit.createParticles(THREE, renderer, { kind: 'dust', quality, fog: sky.fog.uniforms, seed, box: [14, 6, 14] });
  bag.add(fx); scene.add(fx.object);

  // post + camera
  const post = bag.add(kit.createPost(THREE, renderer, { width, height, pixelRatio, quality, tonemap: 'aces' }));
  Object.assign(post.grade, { exposure: L.exposure, temperature: L.temperature, tint: L.tint, saturation: L.saturation, contrast: L.contrast, lift: L.lift, gain: L.gain });
  post.grade.bloom.strength = L.bloom; post.grade.rays.strength = L.rays; post.grade.dof.strength = 0.5;
  const path = kit.cameraPath([
    { pos: [-4.5, 1.6, 6.5], look: [0, 1.7, -4.4], fov: 38, portrait: { pos: [-2.5, 1.5, 7.5], fov: 40 } },
    { pos: [0.5, 1.3, 5.2], look: [0.5, 1.8, -4.4], fov: 36 },
    { pos: [4.2, 1.8, 6.8], look: [-0.5, 1.6, -4.4], fov: 40, portrait: { pos: [2.5, 1.7, 7.8] } },
  ], { period: 210, breathe: 0.035, seed });
  if (L.ground === 'water') sky.params.altitude = 0.02;

  let envT = -1e9;
  const tmp = new THREE.Vector3();
  function render(t, f) {
    // slow drifting light and weather (never a short loop)
    sky.params.sun.elevation = L.sun[0] + 1.2 * Math.sin(t / 170 + seed);
    sky.params.clouds.coverage = kit.clamp(L.clouds + 0.08 * Math.sin(t / 97 + 1.3));
    sky.update(t);
    sky.applyLights({ sun, moon, target: tmp.set(0, 0, -3) });
    if (t - envT > kit.Q[quality].envEvery || t < envT) { scene.environment = sky.bakeEnvironment(); envT = t; }
    const cam = path.apply(camera, t, { breath: f.energy });
    // lanterns breathe with the music, subtly
    const lights = [];
    for (const l of lanterns) {
      const k = kit.flicker(t, l.seed, { speed: 1.1, depth: 0.18 }) * (1 + 0.12 * (f.level || 0) + 0.18 * (f.accent || 0)) * L.lanterns;
      l.mat.emissiveIntensity = 6 * k; l.light.intensity = 5 * k;
      lights.push({ position: l.light.position, color: l.light.color, intensity: 0.9 * k, radius: 1.6 });
    }
    // weather responds to the energy of the song; lightning on rare big accents (rain only)
    const fl = L.weather === 'rain' ? kit.lightning(t, f, seed) : 0;
    const amb = sky.ambient.sky;
    fx.update(t, camera, { density: L.weather === 'rain' ? 0.45 + 0.5 * kit.soft(f.energy || 0, 0.5) : L.weather === 'snow' ? 0.55 + 0.35 * (f.energy || 0) : 0.6,
      wind: L.weather === 'snow' ? [0.35, 0, 0.1] : [0.9, 0, 0.25], gust: 0.4, lights, ambient: [amb.r * 0.25 + fl, amb.g * 0.25 + fl, amb.b * 0.28 + fl * 1.1],
      brightness: L.weather === 'dust' ? 2.5 : 1, focus: 6 });
    if (wet) { wet.uniforms.uTime.value = t; wet.uniforms.uRain.value = 0.4 + 0.5 * (f.energy || 0); }
    if (water) water.update(t, { rain: 0 });
    if (fl > 0) { sun.intensity += fl * 3; sky.params.nightGlow = [fl * 0.05, fl * 0.055, fl * 0.07]; } else sky.params.nightGlow = [0, 0, 0];
    post.grade.dof.focus = Math.hypot(cam.pos[0] - cam.look[0], cam.pos[1] - cam.look[1], cam.pos[2] - cam.look[2]);
    post.grade.bloom.strength = L.bloom * (1 + 0.25 * (f.bass || 0));
    if (mirror) { fx.object.visible = false; mirror.update(scene, camera, { hide: [ground] }); fx.object.visible = true; }
    post.setSun(sky.sunDir, camera);
    post.render(scene, camera, t);
  }
  function resize(w, h, pr = 1) { camera.aspect = w / h; camera.updateProjectionMatrix(); post.resize(w, h, pr); mirror?.resize(w, h, pr); }
  resize(width, height, pixelRatio);
  return { render, resize, dispose() { bag.dispose(); scene.clear(); } };
}
