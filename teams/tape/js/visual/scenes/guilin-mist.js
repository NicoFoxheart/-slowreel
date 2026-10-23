// guilin-mist.js - "Guilin mist": the Li River between Guilin and Yangshuo at first light. Rows of tower-karst peaks
// (70-430 m, sugar-loaf limestone under dense forest, grey and iron-stained cliffs with rain streaks) recede in shan shui
// layers into the haze; low river mist and two drifting cloud bands wrap the peaks halfway up; the jade river mirrors
// it all, with fine drizzle rings; phoenix-tail bamboo leans over the banks; a cormorant fisherman's bamboo raft with a
// lantern glides ahead of the camera, which floats slowly downstream (about 1 m/s), never repeating within a song.
// Variants: misty dawn (hero), golden morning, ink painting (a sumi-e grade of the same 3D world), moonlit lantern night.
import * as kit from './kit.js?v=10a';
import * as GL from './guilin-mist-glsl.js?v=10a';
import * as GEO from './guilin-mist-geo.js?v=10a';

export const meta = {
  id: 'guilin-mist', name: 'Guilin mist', group: 'China',
  desc: 'Karst peaks over the Li river at dawn, drifting mist, a fisherman\'s bamboo raft with a lantern.',
  variants: [
    { id: 'dawn', name: 'Misty dawn' },
    { id: 'golden', name: 'Golden morning', text: { accent: '#ffcf8a' } },
    { id: 'ink', name: 'Ink painting', text: { ink: '#2a2622', accent: '#a8322a' } },
    { id: 'moon', name: 'Moonlit lantern', text: { accent: '#ffb46a' } },
  ],
  defaultVariant: 'dawn', thumbT: 24,
  text: { ink: '#f4efe6', accent: '#e9c99a' },
  swatch: ['#5d7280', '#e9d9c0'],
};

// per-variant light, weather and grade
const LOOKS = {
  dawn: {
    sun: { e0: 2.5, e1: 6, az: -128, intensity: 4 }, sunK: 0.3, moon: 0, clouds: 0.88, cloudDensity: 0.9, mie: 2.4, mieG: 0.78, rayleigh: 1.1,
    fog: { density: 0.00046, falloff: 0.0028, sunStrength: 0.25, sunG: 0.72, skyDistance: 9000, tint: [0.9, 0.97, 1.08] },
    low: [0.0016, 16, 0.75], band: [0.0042, 70, 22, 0.85], band2: [0.0016, 165, 30, 0.9], mistAmb: 1.0, mistSun: 0.18, mistG: 0.55, mistTint: [0.84, 0.94, 1.1],
    rain: 0.55, ripples: 0.12, water: { deep: [0.004, 0.016, 0.014], shallow: [0.012, 0.05, 0.04], rough: 0.07, waves: 0.09 },
    lantern: 5, exposure: 1.3, temperature: -0.12, tint: 0.0, saturation: 0.86, contrast: 1.04, lift: [0.006, 0.008, 0.012], gain: [1, 1, 1.02], bloom: 0.07, rays: 0.25, vignette: 0.32, ink: 0,
  },
  golden: {
    sun: { e0: 7.5, e1: 12, az: -136, intensity: 4.2 }, moon: 0, clouds: 0.42, cloudDensity: 0.8, mie: 2.0, mieG: 0.8, rayleigh: 1,
    fog: { density: 0.00028, falloff: 0.0024, sunStrength: 0.7, sunG: 0.75, skyDistance: 9000, tint: [1.02, 0.99, 0.95] },
    low: [0.0008, 12, 0.85], band: [0.0018, 58, 18, 0.95], band2: [0.0005, 150, 28, 0.95], mistAmb: 0.9, mistSun: 0.7, mistG: 0.6, mistTint: [1.04, 0.99, 0.92],
    rain: 0, ripples: 0, water: { deep: [0.004, 0.018, 0.014], shallow: [0.016, 0.06, 0.042], rough: 0.08, waves: 0.11 },
    lantern: 0, exposure: 0.8, temperature: 0.04, tint: 0.01, saturation: 1.05, contrast: 1.1, lift: [0.006, 0.004, 0.0], gain: [1.02, 0.99, 0.94], bloom: 0.08, rays: 0.55, vignette: 0.3, ink: 0,
  },
  ink: {
    sun: { e0: 3.0, e1: 6, az: -128, intensity: 4 }, sunK: 0.35, moon: 0, clouds: 0.9, cloudDensity: 0.7, mie: 2.6, mieG: 0.7, rayleigh: 0.9,
    fog: { density: 0.00055, falloff: 0.0026, sunStrength: 0.25, sunG: 0.6, skyDistance: 8000, tint: [1, 1, 1] },
    low: [0.0017, 16, 0.9], band: [0.0042, 72, 22, 0.95], band2: [0.0016, 170, 30, 0.95], mistAmb: 1.15, mistSun: 0.15, mistG: 0.5, mistTint: [1, 1, 1],
    rain: 0, ripples: 0, water: { deep: [0.03, 0.03, 0.03], shallow: [0.05, 0.05, 0.05], rough: 0.06, waves: 0.07 },
    lantern: 0, exposure: 1.45, temperature: 0.05, tint: 0, saturation: 0.05, contrast: 1.5, lift: [0.03, 0.026, 0.018], gain: [1.0, 0.97, 0.9], bloom: 0.02, rays: 0, vignette: 0.42, ink: 1,
  },
  moon: {
    sun: { e0: -20, e1: -20, az: -128, intensity: 4 }, moon: 0.1, moonEl: 24, moonAz: -112, clouds: 0.45, cloudDensity: 0.8, mie: 1.6, mieG: 0.8, rayleigh: 1,
    fog: { density: 0.0005, falloff: 0.0028, sunStrength: 0.5, sunG: 0.75, skyDistance: 9000, tint: [0.9, 0.95, 1.08] },
    low: [0.0014, 15, 0.8], band: [0.0036, 68, 22, 0.9], band2: [0.0012, 160, 30, 0.9], mistAmb: 1.0, mistSun: 0.6, mistG: 0.6, mistTint: [0.88, 0.94, 1.1],
    rain: 0, ripples: 0.02, water: { deep: [0.003, 0.01, 0.014], shallow: [0.008, 0.03, 0.035], rough: 0.06, waves: 0.08 },
    lantern: 14, exposure: 6.5, temperature: -0.1, tint: 0, saturation: 0.9, contrast: 1.05, lift: [0.0, 0.002, 0.006], gain: [1, 1, 1.03], bloom: 0.1, rays: 0, vignette: 0.38, ink: 0,
  },
};
const SHAPES = 6;

export function createScene({ THREE, renderer, width, height, pixelRatio = 1, variant = 'dawn', quality = 'high', seed = 1, intensity = 0.6 }) {
  const L = LOOKS[variant] || LOOKS.dawn;
  const Qk = kit.Q[quality] || kit.Q.high, light = quality === 'light', ultra = quality === 'ultra';
  const bag = kit.createBag();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.5, 16000);
  let inten = intensity;

  // ---------------------------------------------------------------- sky + fog
  const sky = bag.add(kit.createSky(THREE, renderer, { quality, sky: {
    sun: { elevation: L.sun.e0, azimuth: L.sun.az, intensity: L.sun.intensity }, moon: { elevation: L.moonEl ?? -30, azimuth: L.moonAz ?? 150, intensity: L.moon, phase: 0.42 },
    rayleigh: L.rayleigh, mie: L.mie, mieG: L.mieG, altitude: 0.03, stars: variant === 'moon' ? 0.8 : 0,
    clouds: { coverage: L.clouds, density: L.cloudDensity, height: 2.2, scale: 0.5, softness: 0.55, wind: [0.004, 0.0015] } },
  fog: { ...L.fog, base: 0, noise: 0 } }));
  scene.add(sky.mesh);

  // ---------------------------------------------------------------- shared mist uniforms
  const mistTex = kit.cached(renderer, 'guilin:mistnoise:256', () => kit.bakeTexture(THREE, renderer, { width: 256, fragment: `vec4 bake(vec2 uv) {
    return vec4(kFbm2p(uv * 4.0, vec2(4.0), 5), kFbm2p(uv * 6.0 + 1.7, vec2(6.0), 5), kFbm2p(uv * 3.0 + 4.1, vec2(3.0), 4), 1.0); }` }));
  const MU = {
    uGmMistTex: { value: mistTex }, uGmLow: { value: new THREE.Vector4() }, uGmBand: { value: new THREE.Vector4() }, uGmBand2: { value: new THREE.Vector4() },
    uGmWind: { value: new THREE.Vector4() }, uGmAmb: { value: new THREE.Vector3() }, uGmSun: { value: new THREE.Vector3() }, uGmSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uGmG: { value: L.mistG }, uGmOn: { value: 1 },
  };
  const LU = { uGmTime: { value: 0 }, uGmWindV: { value: new THREE.Vector2(0.3, 0.1) }, uGmInk: { value: L.ink }, uGmWet: { value: L.rain > 0 ? 0.6 : 0.15 }, uGmBump: { value: 0.8 } };
  const detailSize = light ? 512 : 1024;
  const detail = kit.cached(renderer, 'guilin:detail:' + detailSize, () => kit.bakeTexture(THREE, renderer, { width: detailSize, fragment: GL.DETAIL_FS }));
  LU.uGmDetail = { value: detail };

  /** add the river mist after the kit fog to any three material (and the kit fog itself) */
  function mistify(mat, key = 'm') {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      prev?.call(mat, sh, r);
      Object.assign(sh.uniforms, MU);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GL.MIST)
        .replace('#include <fog_fragment>', '#include <fog_fragment>\n gl_FragColor.rgb = gmMist(gl_FragColor.rgb, vKitWorld, cameraPosition);');
    };
    const pk = mat.customProgramCacheKey?.bind(mat);
    mat.customProgramCacheKey = () => (pk ? pk() : '') + '|gmmist' + key;
    return sky.patch(mat);
  }
  /** land material: karst (0), floodplain (1), bamboo (2) */
  function landMaterial(kind) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, envMapIntensity: 1 });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, LU);
      sh.defines = { ...(sh.defines || {}), GM_KIND: kind };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GL.LAND_VS_HEAD)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + GL.LAND_VS_BEGIN)
        .replace('#include <project_vertex>', '#include <project_vertex>\n' + GL.LAND_VS_END);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GL.LAND_FS_HEAD)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + GL.LAND_FS_COLOR)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + GL.LAND_FS_ROUGH)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + GL.LAND_FS_NORMAL)
        .replace('#include <opaque_fragment>', GL.LAND_FS_OUT + '\n#include <opaque_fragment>');
    };
    mat.customProgramCacheKey = () => 'gmland' + kind;
    return bag.add(mistify(mat, 'l' + kind));
  }

  // ---------------------------------------------------------------- lights
  const sun = new THREE.DirectionalLight(0xffffff, 1), moon = new THREE.DirectionalLight(0xffffff, 1);
  scene.add(sun, sun.target, moon, moon.target);

  // ---------------------------------------------------------------- water + mirror
  const mirror = bag.add(kit.createMirror(THREE, renderer, { y: 0, quality, width, height, pixelRatio }));
  const water = bag.add(kit.createWater(THREE, renderer, { size: 30000, sky, mirror, quality, roughness: L.water.rough, deep: L.water.deep, shallow: L.water.shallow,
    waveScale: 1.0, waveSpeed: 0.5, waveStrength: L.water.waves }));
  {
    const m = water.mesh.material;
    Object.assign(m.uniforms, MU);
    m.fragmentShader = GL.MIST + m.fragmentShader.replace('vec2 g = (n1.xy + n2.xy * 0.8 + n3.xy * 0.5 + n4.xy * 0.3) * uWaveStrength;',
      'float gmD = length(cameraPosition.xz - p), gmF = 1.0 - smoothstep(25.0, 220.0, gmD); vec2 g = (n1.xy + n2.xy * 0.8 + (n3.xy * 0.5 + n4.xy * 0.3) * gmF) * uWaveStrength * mix(0.5, 1.0, gmF);').replace('if (uRain > 0.0) g += kRipples(p, uTime, uRain, int(uRippleLayers)) * 1.6;',
      'float gmRd = length(cameraPosition.xz - p); if (uRain > 0.0 && gmRd < 28.0) g += kRipples(p, uTime, uRain, int(uRippleLayers)) * 0.9 * (1.0 - smoothstep(4.0, 28.0, gmRd));').replace('col = kFog(col, vWorld, cameraPosition);', 'col = kFog(col, vWorld, cameraPosition); col = gmMist(col, vWorld, cameraPosition);');
    m.fragmentShader = m.fragmentShader.replace('vec3 m = texture2D(uMirror, muv).rgb;', 'vec3 m = texture2D(uMirror, clamp(muv, vec2(0.001), vec2(0.999))).rgb;')
      .replace('refl = mix(refl, m, smoothstep(0.0, 0.03, muv.x) * smoothstep(1.0, 0.97, muv.x) * smoothstep(0.0, 0.03, muv.y) * smoothstep(1.0, 0.97, muv.y));', 'refl = m;');
    m.uniforms.uDistort.value = 0.035;
    m.needsUpdate = true;
  }
  scene.add(water.mesh);

  // ---------------------------------------------------------------- karst peaks
  const geoScale = Qk.geometry;
  const hiSeg = light ? [32, 22] : ultra ? [96, 66] : [64, 44];
  const shapeSeeds = Array.from({ length: SHAPES }, (_, k) => kit.hashSeed('guilin-mist', 'shape', k, seed));
  const geoHi = shapeSeeds.map(s => bag.add(GEO.karstGeometry(THREE, s, hiSeg[0], hiSeg[1])));
  const geoLo = shapeSeeds.map(s => bag.add(GEO.karstGeometry(THREE, s, light ? 16 : 26, light ? 11 : 18)));
  const geoFar = shapeSeeds.map(s => bag.add(GEO.karstGeometry(THREE, s, light ? 12 : 16, light ? 8 : 11)));
  const peaks = GEO.layoutPeaks(seed, SHAPES);
  const karstMat = landMaterial(0);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), p4 = new THREE.Vector3(), s4 = new THREE.Vector3();
  const mirrorOnly = [], mainOnly = [];
  function peakMeshes(band, geos, list) {
    for (let k = 0; k < SHAPES; k++) {
      const ps = peaks.filter(p => p.shape === k && band.includes(p.band));
      if (!ps.length) continue;
      const im = new THREE.InstancedMesh(geos[k], karstMat, ps.length);
      ps.forEach((p, i) => {
        e4.set(p.tilt[0], p.rot, p.tilt[1]); q4.setFromEuler(e4);
        m4.compose(p4.set(p.x, -1.2, p.z), q4, s4.set(p.rx, p.h, p.rz)); im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true; im.frustumCulled = false;
      scene.add(im); list?.push(im);
    }
  }
  peakMeshes(['near'], geoHi, mainOnly);
  peakMeshes(['near'], geoLo, mirrorOnly);
  peakMeshes(['mid'], geoLo, null);
  const farMeshes = []; peakMeshes(['far'], geoFar, farMeshes);
  mirrorOnly.forEach(m => { m.visible = false; });

  // ---------------------------------------------------------------- floodplain + bamboo
  const groundGeo = bag.add(GEO.groundGeometry(THREE, seed, geoScale));
  const ground = new THREE.Mesh(groundGeo, landMaterial(1)); ground.frustumCulled = false; scene.add(ground);
  const bambooGeo = bag.add(GEO.bambooGeometry(THREE, kit.hashSeed('guilin-mist', 'bamboo-geo', seed), light ? 0.5 : 1));
  const clumps = GEO.layoutBamboo(seed, light ? 140 : 260);
  const bamboo = new THREE.InstancedMesh(bambooGeo, landMaterial(2), clumps.length);
  clumps.forEach((c, i) => { e4.set(0, c.rot, 0); q4.setFromEuler(e4); m4.compose(p4.set(c.x, c.y, c.z), q4, s4.set(c.s * c.w, c.s, c.s * c.w)); bamboo.setMatrixAt(i, m4); });
  bamboo.instanceMatrix.needsUpdate = true; bamboo.frustumCulled = false; scene.add(bamboo);

  // ---------------------------------------------------------------- the raft
  const R = GEO.raftParts(THREE);
  const raft = new THREE.Group(); scene.add(raft);
  const mk = (color, rough, extra = {}) => bag.add(mistify(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra }), 'r'));
  const raftMats = {
    bamboo: mk(new THREE.Color(0.20, 0.15, 0.075), 0.55), cloth: mk(new THREE.Color(0.018, 0.022, 0.034), 0.9), skin: mk(new THREE.Color(0.25, 0.14, 0.09), 0.6),
    hat: mk(new THREE.Color(0.36, 0.27, 0.14), 0.85, { side: THREE.DoubleSide }), bird: mk(new THREE.Color(0.012, 0.012, 0.014), 0.38), dark: mk(new THREE.Color(0.03, 0.025, 0.02), 0.7),
  };
  for (const k in R.parts) {
    if (!R.parts[k].length) continue;
    const g = bag.add(GEO.merge(THREE, R.parts[k])); R.parts[k].forEach(p => p.geo.dispose());
    const mesh = new THREE.Mesh(g, raftMats[k]); raft.add(mesh);
  }
  // punting pole (rotates around the fisherman's hands)
  const poleGeo = bag.add(new THREE.CylinderGeometry(0.022, 0.03, 5.2, 6)); poleGeo.translate(0, -1.4, 0);
  const pole = new THREE.Mesh(poleGeo, raftMats.bamboo); pole.position.fromArray(R.polePivot); raft.add(pole);
  // lantern: paper shell (emissive), a soft glow sprite and a point light
  const warm = kit.kelvin(1850);
  const lanternMat = bag.add(mistify(new THREE.MeshStandardMaterial({ color: 0x1a0904, emissive: new THREE.Color(...warm), emissiveIntensity: 0, roughness: 0.7 }), 'lan'));
  const lanternGeo = bag.add(new THREE.CylinderGeometry(0.13, 0.13, 0.3, 14));
  const lantern = new THREE.Mesh(lanternGeo, lanternMat); lantern.position.fromArray(R.lanternPos); raft.add(lantern);
  const capGeo = bag.add(new THREE.CylinderGeometry(0.08, 0.14, 0.05, 12));
  const cap1 = new THREE.Mesh(capGeo, raftMats.dark); cap1.position.set(0, 0.175, 0); lantern.add(cap1);
  const cap2 = new THREE.Mesh(capGeo, raftMats.dark); cap2.position.set(0, -0.175, 0); cap2.rotation.x = Math.PI; lantern.add(cap2);
  const lanternLight = new THREE.PointLight(new THREE.Color(...warm), 0, 18, 2); lanternLight.position.fromArray(R.lanternPos); raft.add(lanternLight);
  const glowMat = bag.add(new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(...warm) }, uI: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += position.xy; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uI; varying vec2 vUv; void main() { float r = length(vUv); float g = exp(-r * r * 9.0) * 0.6 + exp(-r * 3.5) * 0.25; gl_FragColor = vec4(uColor * uI * g * smoothstep(1.0, 0.7, r), 1.0); }',
  }));
  const glow = new THREE.Mesh(bag.add(new THREE.PlaneGeometry(1.8, 1.8)), glowMat); glow.renderOrder = 5; glow.frustumCulled = false; lantern.add(glow);

  // ---------------------------------------------------------------- mist in front of the sky
  const mistSkyMat = bag.add(new THREE.ShaderMaterial({ uniforms: MU, vertexShader: GL.MIST_SKY_VS, fragmentShader: GL.MIST + GL.MIST_SKY_FS, side: THREE.BackSide,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor, blendEquation: THREE.AddEquation }));
  const mistSky = new THREE.Mesh(bag.add(new THREE.SphereGeometry(13000, 48, 24)), mistSkyMat); mistSky.renderOrder = -10; mistSky.frustumCulled = false; scene.add(mistSky);

  // ---------------------------------------------------------------- drizzle
  const rain = L.rain > 0 ? bag.add(kit.createParticles(THREE, renderer, { kind: 'rain', quality, fog: sky.fog.uniforms, seed, count: light ? 500 : 1100, box: [22, 12, 26], size: 0.004, speed: 6.5,
    color: [0.75, 0.8, 0.85] })) : null;
  if (rain) scene.add(rain.object);

  // ---------------------------------------------------------------- post
  const post = bag.add(kit.createPost(THREE, renderer, { width, height, pixelRatio, quality, tonemap: 'aces', dof: false, dirt: variant !== 'ink', ca: variant !== 'ink' }));
  Object.assign(post.grade, { exposure: L.exposure, temperature: L.temperature, tint: L.tint, saturation: L.saturation, contrast: L.contrast, lift: L.lift, gain: L.gain, vignette: L.vignette,
    aberration: 0.0015, dirt: variant === 'moon' ? 0.12 : 0.05 });
  post.grade.bloom = { strength: L.bloom, threshold: 0, knee: 0.5, radius: 1 };
  post.grade.rays = { strength: L.rays, density: 0.85, decay: 0.962 };
  if (variant === 'ink') post.grade.grainSize = 1.3;

  // ---------------------------------------------------------------- time-dependent state (pure functions of t)
  function sunElevation(t) { return L.sun.e0 + (L.sun.e1 - L.sun.e0) * (1 - Math.exp(-t / 240)) + 0.25 * Math.sin(t / 151); }
  function setSky(t) {
    sky.params.sun.elevation = sunElevation(t);
    sky.params.sun.azimuth = L.sun.az + 3 * Math.sin(t / 397);
    if (L.moon) { sky.params.moon.elevation = (L.moonEl ?? 24) + 2 * Math.sin(t / 420); sky.params.moon.azimuth = (L.moonAz ?? -112) + 4 * Math.sin(t / 530); }
    sky.params.clouds.coverage = kit.clamp(L.clouds + 0.08 * Math.sin(t / 97 + 1.3) + 0.05 * Math.sin(t / 233));
  }
  let envGrid = NaN;
  const occluders = peaks.filter(p => p.band !== 'far');
  /** 0 = sun hidden behind a peak, 1 = in the open (soft edge ~1.5 deg) */
  function sunOpen(cx, cz, elev, az) {
    const sx = Math.cos(kit.deg(az)), sz = Math.sin(kit.deg(az)); let open = 1;
    for (const p of occluders) {
      const dx = p.x - cx, dz = p.z - cz, along = dx * sx + dz * sz; if (along < 20) continue;
      const side = Math.abs(dx * sz - dz * sx), rad = Math.max(p.rx, p.rz) * 0.75;
      if (side > rad * 1.3) continue;
      const w = Math.sqrt(Math.max(0, 1 - (side / (rad * 1.3)) ** 2));          // the dome: lower towards its edges
      const top = Math.atan2(p.h * Math.pow(w, 0.35) - 1.2 - 2.3, along) * 180 / Math.PI;
      open = Math.min(open, kit.smoothstep(top - 0.4, top + 1.2, elev));
      if (open <= 0) return 0;
    }
    return open;
  }
  function camAt(t, f, aspect) {
    const pr = kit.portraitness(aspect);
    const travel = 0.95 * t + 0.18 * (f.flow || 0);
    const z = 60 - travel;
    const lat = (14 * Math.sin(t / 157 + 0.7) + 6 * Math.sin(t / 61 + 2.1)) * (1 - 0.4 * pr);
    const x = GEO.riverX(z) + lat;
    const y = 2.3 + 0.5 * Math.sin(t / 89 + 1) + 0.035 * Math.sin(t * 0.83) + 0.02 * Math.sin(t * 1.37 + 1);
    const dxdz = (GEO.riverX(z - 40) - GEO.riverX(z + 40)) / 80;
    const yaw = -Math.atan(dxdz) * 0.8 + (0.17 * Math.sin(t / 127 + 0.3) + 0.08 * Math.sin(t / 211 + 1.9)) * (1 - 0.45 * pr) - lat * 0.003;
    const pitch = kit.deg(3.2 + 2.2 * pr + 0.8 * Math.sin(t / 173));
    const br = 0.03 * (1 + 0.6 * kit.clamp(f.slow || 0)) * inten;
    const nx = kit.noise2(t * 0.07, 3.1) * br, ny = kit.noise2(t * 0.09, 7.7) * br;
    const dir = [-Math.sin(yaw) * Math.cos(pitch + ny), Math.sin(pitch + ny), -Math.cos(yaw) * Math.cos(pitch + ny)];
    const yawN = yaw + nx;
    dir[0] = -Math.sin(yawN) * Math.cos(pitch + ny); dir[2] = -Math.cos(yawN) * Math.cos(pitch + ny);
    const fov = kit.aspectFov(40, aspect, 0.55);
    return { pos: [x, y, z], dir, fov, yaw, pr, roll: 0.004 * Math.sin(t * 0.61) + 0.003 * Math.sin(t * 0.37 + 2) };
  }
  const tmpV = new THREE.Vector3(), lights4 = [];

  function render(t, f) {
    f = f || kit.silence();
    const I = inten;
    const energy = f.energy || 0, bass = f.bass || 0, bright = f.bright || 0;
    // --- sky, env on a fixed song-time grid (deterministic whatever order frames come in)
    const grid = Math.floor(t / Qk.envEvery) * Qk.envEvery;
    if (grid !== envGrid) { setSky(grid); sky.update(grid); scene.environment = sky.bakeEnvironment(); envGrid = grid; }
    setSky(t); sky.update(t);
    // --- camera
    const c = camAt(t, f, camera.aspect);
    camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
    camera.up.set(0, 1, 0); camera.lookAt(c.pos[0] + c.dir[0], c.pos[1] + c.dir[1], c.pos[2] + c.dir[2]); camera.rotateZ(c.roll);
    if (Math.abs(camera.fov - c.fov) > 1e-6) { camera.fov = c.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    sky.applyLights({ sun, moon, target: tmpV.set(c.pos[0], 0, c.pos[2] - 300) });
    const so = sunOpen(c.pos[0], c.pos[2], sky.params.sun.elevation, sky.params.sun.azimuth);
    sun.intensity = (L.sunK ?? 1) * (0.35 + 0.65 * so);
    post.grade.rays.strength = L.rays * (0.3 + 0.7 * so);
    mistSky.position.copy(camera.position);
    // --- mist: slow drift, breathing over minutes, a little denser when the music is full
    const swell = 1 + 0.18 * Math.sin(t / 113 + 0.5) + 0.12 * Math.sin(t / 197 + 2.0) + 0.12 * I * kit.soft(energy, 0.6);
    const fl = 0.0009 * (f.flow || 0) * I;
    MU.uGmLow.value.set(L.low[0] * swell, L.low[1], L.low[2], 0);
    MU.uGmBand.value.set(L.band[0] * (1 + 0.25 * Math.sin(t / 141 + 1.1)), L.band[1] + 10 * Math.sin(t / 173), L.band[2], L.band[3]);
    MU.uGmBand2.value.set(L.band2[0] * (1 + 0.3 * Math.sin(t / 167 + 2.6)), L.band2[1] + 15 * Math.sin(t / 211 + 0.4), L.band2[2], L.band2[3]);
    MU.uGmWind.value.set(t * 0.00042 + fl, t * 0.00011, -t * 0.0011 + fl * 1.6, t * 0.00052);
    const amb = sky.ambient, lit = sky.params.sun.elevation > -4 ? sky.sunColor : sky.moonColor;
    const mt = L.mistTint;
    const ambK = L.mistAmb * 0.32;
    const aR = amb.sky.r * 0.9 + amb.horizon.r * 0.8, aG = amb.sky.g * 0.9 + amb.horizon.g * 0.8, aB = amb.sky.b * 0.9 + amb.horizon.b * 0.8;
    const aL = (0.2126 * aR + 0.7152 * aG + 0.0722 * aB) * ambK, hue = L.mistHue ?? 0.75;
    MU.uGmAmb.value.set(kit.lerp(aR * ambK, aL, hue) * mt[0], kit.lerp(aG * ambK, aL, hue) * mt[1], kit.lerp(aB * ambK, aL, hue) * mt[2]);
    MU.uGmSun.value.set(lit.r * L.mistSun, lit.g * L.mistSun, lit.b * L.mistSun);
    MU.uGmSunDir.value.copy(sky.params.sun.elevation > -4 ? sky.sunDir : sky.moonDir);
    // --- wind, bamboo, water, drizzle
    const wind = kit.windAt(t, [0.35 + 0.25 * I * energy, 0, 0.12], 0.4);
    LU.uGmTime.value = t; LU.uGmWindV.value.set(wind[0], wind[2]);
    const drizzle = L.rain * kit.clamp(0.35 + 0.4 * Math.sin(t / 131 + 2) + 0.25 * Math.sin(t / 59 + 0.3) + 0.35 * I * kit.soft(energy, 0.5), 0, 1.2);
    water.update(t, { rain: L.ripples > 0 ? L.ripples * (L.rain > 0 ? 0.25 + 0.75 * drizzle : 1) : 0 });
    water.uniforms.uSunCol2.value.multiplyScalar((L.sunK ?? 1) * so);
    water.uniforms.uSunSpec.value = 1 + 0.4 * I * bright;
    water.uniforms.uWaveStrength.value = L.water.waves * (1 + 0.25 * Math.sin(t / 71) + 0.3 * I * kit.soft(energy, 0.6));
    // --- raft: drifts with the camera, slowly changing distance and bearing
    const pr = c.pr;
    const D = 44 + 12 * Math.sin(t / 143 + 0.4) + 5 * Math.sin(t / 61);
    const bearing = -Math.atan((GEO.riverX(c.pos[2] - 40) - GEO.riverX(c.pos[2] + 40)) / 80) * 0.8 - kit.deg(kit.lerp(8, 2.5, pr) + 3.5 * Math.sin(t / 97 + 1));
    const rx = c.pos[0] - Math.sin(bearing) * D, rz = c.pos[2] - Math.cos(bearing) * D;
    raft.position.set(rx, 0.02 * Math.sin(t * 0.9) + 0.012 * Math.sin(t * 1.7 + 1), rz);
    raft.rotation.set(0.012 * Math.sin(t * 0.7 + 0.5), bearing + 0.55 + 0.12 * Math.sin(t / 53), 0.018 * Math.sin(t * 0.9 + 2));
    pole.rotation.set(-0.4 + 0.22 * Math.sin(t * 2 * Math.PI / 11), 0, 0.28 + 0.05 * Math.sin(t / 7));
    // lantern: kelvin warmth, flicker, a little breath with the music
    const fk = kit.flicker(t, 3 + seed, { speed: 1.2, depth: 0.22 }) * (1 + I * (0.12 * (f.level || 0) + 0.18 * (f.accent || 0) + 0.15 * bass));
    const lan = L.lantern * fk;
    lanternMat.emissiveIntensity = lan * 2.2; lanternLight.intensity = lan * 3.2;
    glowMat.uniforms.uI.value = lan * 0.035;
    lantern.rotation.set(0.05 * Math.sin(t * 1.1), 0, 0.06 * Math.sin(t * 0.8 + 1));
    lantern.visible = true;
    // --- drizzle particles
    if (rain) {
      lights4.length = 0;
      if (L.lantern > 0) { lantern.getWorldPosition(tmpV); lights4.push({ position: tmpV.clone(), color: lanternLight.color, intensity: lan * 0.3, radius: 3 }); }
      const a = sky.ambient.sky;
      rain.update(t, camera, { density: kit.clamp(drizzle, 0, 1), wind: [wind[0] * 1.5, 0, wind[2] * 1.5], gust: 0.4, shutter: 1 / 50, lights: lights4,
        ambient: [a.r * 0.1, a.g * 0.11, a.b * 0.13], brightness: 0.45, focus: 8 });
    }
    // --- lightning never (not this world); a rare big accent becomes a soft gust instead (wave strength + bamboo)
    if (f.big) { water.uniforms.uWaveStrength.value *= 1 + 0.6 * I * Math.min(f.big, 1); LU.uGmWindV.value.multiplyScalar(1 + 0.8 * I * Math.min(f.big, 1)); }
    // --- grade breath
    post.grade.bloom.strength = L.bloom * (1 + 0.25 * I * bass);
    post.grade.exposure = L.exposure * (1 + 0.04 * I * kit.soft(energy, 0.6));
    // --- reflections (the far LOD of the near peaks in the mirror, no rain)
    if (rain) rain.object.visible = false;
    mainOnly.forEach(m => { m.visible = false; }); mirrorOnly.forEach(m => { m.visible = true; });
    mirror.update(scene, camera, { hide: light ? [water.mesh, bamboo, ...farMeshes] : [water.mesh] });
    mainOnly.forEach(m => { m.visible = true; }); mirrorOnly.forEach(m => { m.visible = false; });
    if (rain) rain.object.visible = true;
    post.setSun(sky.params.sun.elevation > -4 ? sky.sunDir : sky.moonDir, camera);
    post.render(scene, camera, t);
  }
  function resize(w, h, pr = 1) { camera.aspect = w / h; camera.updateProjectionMatrix(); post.resize(w, h, pr); mirror.resize(w, h, pr); }
  resize(width, height, pixelRatio);
  return {
    render, resize,
    setIntensity(v) { inten = kit.clamp(v); },
    dispose() { scene.environment = null; bag.dispose(); scene.clear(); },
  };
}
