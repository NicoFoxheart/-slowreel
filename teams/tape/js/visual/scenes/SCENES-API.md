# Slowreel scenes API

A scene is a cinematic 3D world that any song can play under. Each scene is one file, `js/visual/scenes/<id>.js`.
It is loaded lazily through the registry (`scenes/index.js`) and rendered by the scene host (`scenes/host.js`). That
happens in the preview worker (the live hero preview and the card thumbnails), in the render worker (the frame-exact
export) and in `tests/scene-check.cjs`. You write only your own file. Do not edit shared files (kit*, host, index,
features, video*, panel). If the kit is missing something, build it inside your file.

Reference scene: `scenes/kit-demo.js`. It is hidden from the picker; you can copy it as a template.

## 1. The contract

```js
// scenes/hanok-rain.js
import * as kit from './kit.js?v=8';          // relative path, ends in .js, carries ?v=8 (the stamp tool rewrites it)

export const meta = {
  id: 'hanok-rain',                           // must equal the registry id (= file name)
  name: 'Hanok in the rain',
  group: 'Korea',                             // one of: Cozy, Korea, Japan, China, Nature, Night city, Classic
  desc: 'A Korean hanok courtyard in soft rain, paper lanterns, wet stone.',
  variants: [{ id: 'dusk', name: 'Rainy dusk' }, { id: 'night', name: 'Lantern night', text: { accent: '#ffb070' } }],
  defaultVariant: 'dusk',
  // optional:
  thumbT: 20,                                 // song second the card thumbnail shows (default 12)
  text: { ink: '#f6efe4', accent: '#ffc98a' },// title colour + progress-line accent (a variant's own `text` wins)
  swatch: ['#1f2a2c', '#f0a25a'],             // card colours while the thumbnail renders
};

export function createScene({ THREE, canvas, renderer, width, height, pixelRatio, variant, quality, seed, title, artist, showText, intensity }) {
  // build everything here (synchronous; bake textures here too)
  return {
    render(t, f, info) { /* draw one frame into the canvas (renderer target null) */ },
    resize(w, h, pr) { /* camera aspect, post.resize, mirror.resize */ },
    dispose() { /* free EVERY GPU resource you created (use kit.createBag) */ },
    // optional: setVariant(id) (switch without a rebuild; otherwise the host rebuilds), setIntensity(v 0..1)
  };
}
```

**Arguments**

| arg | meaning |
|---|---|
| `THREE` | three.js 0.160.0 core module. Never import `three` or `three/examples/jsm/*`: the addons import the bare `'three'`, which fails in workers. |
| `renderer` | **The host owns the `THREE.WebGLRenderer`**, one per canvas, kept across scene switches. Never create a renderer, never call `renderer.dispose()`/`setSize()`. Before your `createScene` the host resets it to: `autoClear = true`, `toneMapping = NoToneMapping`, `outputColorSpace = SRGBColorSpace`, `shadowMap.enabled = false` (PCFSoft), clear colour black, no clipping, the right size and pixel ratio. You may change any of that (for example `renderer.shadowMap.enabled = true`); the next scene gets a clean reset. |
| `canvas` | an `OffscreenCanvas` (workers) or a canvas element. Guard any DOM use with `typeof document !== 'undefined'`. |
| `width, height, pixelRatio` | CSS size and ratio; drawing-buffer pixels = `width*pixelRatio x height*pixelRatio`. Export: 1280x720 up to 3840x2160 with pr 1. Preview: about 480x270 with pr up to 1.5. Thumbnails: 352x198. |
| `variant` | always one of your `meta.variants` ids (the host falls back to `defaultVariant`). |
| `quality` | `'light'` (weak PCs and light preview), `'high'` (default export and preview), `'ultra'` (export only). See `kit.Q`. |
| `seed` | integer (default 1). Use `kit.rng(kit.hashSeed('<id>', variant, seed))` for every random choice. |
| `title, artist, showText` | for information only. **The host draws the title, artist, progress hairline, legibility gradient and fade in/out on top of your frame**, so do not draw text yourself. Keep the lower-left third free of very bright detail; that is where the title sits. |
| `intensity` | 0..1 (default 0.6), how strongly the scene reacts to audio. Scale your reactions with it. |

**`render(t, f, info)`**

- `t`: song time in seconds. The export calls it frame by frame (`t = i / fps`). The preview may jump (seek), go
  backwards or start anywhere; the thumbnail and determinism checks call it out of order.
- `f`: the audio features for this frame (section 3). With silence every field is 0. The scene must look complete
  and beautiful with silence.
- `info`: `{duration (s, 0 when unknown), fps, frame, live (true in the preview)}`.
- Draw into the default framebuffer (`renderer.setRenderTarget(null)` at the end; `post.render` does this for you).
  The host's overlay then blends on top.

**Rules (all are checked by scene-check or review)**

1. **Deterministic:** each frame is a pure function of `(t, f, seed, variant, quality, size)`. No `Math.random`, no
   `Date.now`/`performance.now` in the picture, and no state that cannot be recomputed from `t`. Motion comes from
   `t`. Audio-driven speeds come from `f.flow` (phase = k * f.flow), which never jumps. `kit.integral(fn, t)` gives
   positions under changing speeds. A smoother (`kit.smoother`) is allowed: it is exact for sequential frames and
   resets on a jump.
2. **Long-form:** the scene evolves over a 3-6 minute song: camera paths of 150-300 s (pingpong, eased), sun, cloud
   and fog drifting on 60-200 s periods with incommensurate rates (`Math.sin(t / 97)`, `Math.sin(t / 163)`), and
   weather that builds and eases. Nothing may visibly repeat in under about 2 minutes.
3. **Subtle audio:** rain density, lantern flicker depth, bloom, wind, camera breathing, and rare lightning on
   `f.big` only. Nothing may pulse or scale with the beat. Typical ranges are +-10-25% of a base value, smoothed.
4. **Every aspect:** compose for 16:9, 9:16 and 1:1. Use `kit.cameraPath` keys with `portrait` overrides and
   `kit.aspectFov`; check all three in scene-check.
5. **Procedural only:** no image, font, model or network fetch. Textures are baked once with `kit.bakeTexture` /
   `kit.noiseTexture` / `kit.canvasTexture` / `kit.dataTexture`. Use `kit.cached(renderer, key, make)` for textures
   that are identical across variants; the cache owns them, so never dispose a cached texture.
6. **Dispose everything:** put every geometry, material, texture, render target and kit object in one
   `kit.createBag()` and call `bag.dispose()` in `dispose()`. The preview switches scenes many times, and a leak
   shows up as rising `textures`/`geometries` in scene-check.
7. **Fast to build:** `createScene` should take under about 1.5 s on a mid GPU. Bake at 512-1024 px (2048 only on
   ultra). Build geometry with typed arrays, not per-vertex JS objects, for anything above about 50k vertices.
8. **Never touch the main thread:** a scene only ever runs in workers in the app. No `window`, no `document`, no
   `localStorage`.

## 2. The kit (`import * as kit from './kit.js?v=8'`)

All of it is core THREE (THREE is passed in), deterministic, and works in workers. Signatures are below; the JSDoc in
each file has details.

### Post chain (kit-post.js): this is what makes it look filmic

```js
const post = bag.add(kit.createPost(THREE, renderer, { width, height, pixelRatio, quality, tonemap: 'aces' /* | 'agx' | 'none' */,
  dof /* bool, default by quality */, rays /* god rays */, dirt /* lens dirt */, ca /* chromatic aberration */, msaa /* samples, 0 on light */ }));
// grade (every field may be changed per frame):
Object.assign(post.grade, { exposure: 1.1, temperature: 0.08 /* -1 cool .. +1 warm */, tint: 0, saturation: 0.95, contrast: 1.05,
  lift: [0.004, 0.006, 0.012], gamma: [1, 1, 1], gain: [1, 0.99, 0.97], vignette: 0.35, aberration: 0.0025, grain: null /* null = quality default */,
  grainSize: 1.6, dirt: 0.15, letterbox: 0 /* 0..0.15 bars */ });
post.grade.bloom = { strength: 0.06, threshold: 0, knee: 0.5, radius: 1 };      // mip-chain bloom (5-8 mips)
post.grade.dof = { focus: 10 /* m */, range: 6, strength: 0.5 };                // DOF-lite (depth-based blur)
post.grade.rays = { strength: 0.6, density: 0.9, decay: 0.965 };                 // screen-space sun shafts, needs setSun
// per frame:
post.setSun(sky.sunDir, camera);
post.render(scene, camera, t);          // = post.begin(); renderer.render(scene, camera); post.end(camera, t)
// several passes: post.begin(); renderer.render(a, cam); renderer.render(b, cam); post.end(camera, t);
post.resize(w, h, pr);
```
The chain renders into an HDR (half-float, MSAA on high/ultra) target. It runs bloom, rays, DOF, CA, the tonemap
(ACES RRT+ODT fit or AgX), white balance, lift/gamma/gain, saturation, contrast, vignette, lens dirt and
film grain, then writes sRGB to the canvas. Light your scene in linear HDR units. Exposure 1 suits a sunlit scene;
night scenes use about 3-8.

### Sky, sun, atmosphere, fog (kit-sky.js)

```js
const sky = bag.add(kit.createSky(THREE, renderer, { quality,
  sky: { sun: { elevation: 6, azimuth: -40, intensity: 4 }, moon: { elevation: 30, azimuth: 120, intensity: 0, phase: 0.3 },
         rayleigh: 1, mie: 1.4, mieG: 0.8, ozone: 1, altitude: 0.05 /* km */, stars: 1, nightGlow: [0, 0, 0],
         clouds: { coverage: 0.4, density: 1, height: 2, scale: 0.45, wind: [0.006, 0.002], softness: 0.35, opacity: 1 } },
  fog: { density: 0.006, base: 0, falloff: 0.08, noise: 0.3, sunG: 0.7, sunStrength: 0.6, tint: [1, 1, 1], skyDistance: 0, wind: [0.02, 0, 0.01] } }));
scene.add(sky.mesh);                                 // full-screen sky, draws behind everything
sky.patch(material);                                 // kit height fog + aerial perspective on any three material (returns it)
// per frame:
sky.params.sun.elevation = 6 + 1.5 * Math.sin(t / 170); sky.params.clouds.coverage = 0.4 + 0.1 * Math.sin(t / 97);
sky.update(t);                                       // re-bakes the scattering LUT only when the sun or moon moved
sky.applyLights({ sun: sunLight, moon: moonLight, hemi, target: new THREE.Vector3(0, 0, 0) });
if (t - envT > kit.Q[quality].envEvery || t < envT) { scene.environment = sky.bakeEnvironment(); envT = t; }   // PMREM IBL (owned by sky)
kit.sunFromHour(17.4 + t / 900) -> { elevation, azimuth }    // a slow sunset over the song
sky.sunDir, sky.sunColor, sky.moonDir, sky.moonColor, sky.ambient.{sky, ground, horizon}, sky.radiance(dir)
kit.patchFog(THREE, material, sky.fog.uniforms)     // same as sky.patch
```
This is a physically based single-scattering atmosphere (Rayleigh, Mie and ozone) with multiple-scattering
approximation, a sun disc with limb darkening, a moon with phase, stars and a Milky Way, and fbm clouds lit by the
sun. Fog is analytic exponential height fog with sun in-scatter, noise and sky colour at distance.

### Particles: rain, snow, petals, dust, fireflies (kit-fx.js)

```js
const rain = bag.add(kit.createParticles(THREE, renderer, { kind: 'rain' /* 'snow' | 'petals' | 'dust' | 'fireflies' */, quality,
  fog: sky.fog.uniforms, seed, count /* scaled by quality */, box: [24, 14, 24] /* m around the camera */, color, color2, size, speed,
  splashes: { ground: 0, box: [14, 14], count: 1400, size: 0.05, period: 0.45 } /* rain only */ }));
scene.add(rain.object);
// per frame:
rain.update(t, camera, { density: 0.45 + 0.5 * kit.soft(f.energy, 0.5), wind: [0.9, 0, 0.25], gust: 0.4, shutter: 1 / 45,
  lights: [{ position, color, intensity, radius }] /* <= 4, lit streaks near lanterns */, ambient: [r, g, b], sunDir, sunColor,
  brightness: 1, focus: 6 /* m, bokeh on near flakes/petals */, bokeh: 1, ground: 0 });
kit.windDrift(t, [0.9, 0, 0.2], 0.3) -> [x, y, z]     // integral of a gusty wind: offsets that never jump
kit.windAt(t, wind, gust) -> [x, y, z]                 // instantaneous wind (sway grass, bamboo, lanterns with it)
```
Rain is drawn as motion-blurred streaks (shutter-length, camera-relative) with splashes on the ground. Snow and petals
tumble with flutter. Everything is GPU-animated from `t`.

### Water, mirror reflections, wet ground (kit-surface.js)

```js
const mirror = bag.add(kit.createMirror(THREE, renderer, { y: 0, quality, width, height, pixelRatio }));   // planar reflection
const water = bag.add(kit.createWater(THREE, renderer, { size: 1200, segments /* for swell */, sky, mirror, quality, roughness: 0.14,
  deep: [0.004, 0.018, 0.03], shallow: [0.02, 0.09, 0.1], swell: 0, waves: [[1, 0.3, 0.12, 40], ...] }));
scene.add(water.mesh);  water.update(t, { rain: 0..1, sunDir, sunColor });  water.uniforms.uWaveStrength.value = ...
const wet = kit.patchWet(THREE, stoneMaterial, { sky, mirror, wetness: 0.8, puddles: 0.4, puddleScale: 2.6, rain: 0.6, ripples: 2, mirrorStrength: 1, darken: 0.45 });
wet.uniforms.uTime.value = t; wet.uniforms.uRain.value = 0.4 + 0.5 * f.energy;      // per frame
// per frame, BEFORE post.render:   rain.object.visible = false; mirror.update(scene, camera, { hide: [water.mesh] }); rain.object.visible = true;
mirror.resize(w, h, pr);
kit.heightfield(THREE, { width, depth, segX, segZ, height: (x, z) => ... }) -> BufferGeometry   // terrain, karsts, dunes
```
Water uses Fresnel, a sky or mirror reflection, sun glitter, subsurface tint, rain ripples and fog. Wet ground gets
darker porous albedo, glossy puddles with ripple normals and mirror reflections (neon and lanterns in puddles).

### Textures, passes, disposal (kit-gpu.js)

```js
const bag = kit.createBag();  bag.add(anything) -> it;  bag.dispose();   // geometries, materials (+ their textures), RTs, kit objects, Object3D trees
kit.bakeTexture(THREE, renderer, { width: 1024, height, fragment: 'vec4 bake(vec2 uv) { ... }', uniforms, type: 'byte'|'half'|'float', wrap: 'repeat'|'clamp', mipmaps: true, colorSpace: 'linear'|'srgb' })
kit.noiseTexture(THREE, renderer, { size: 256, scale: 8, octaves: 5, seed, kind: 'fbm'|'worley'|'ridged'|'mix' })     // cached, tileable
kit.normalMapFromHeight(THREE, renderer, heightTex, { strength: 2, channel: 'r'|'g'|'b'|'a' })
kit.canvasTexture(THREE, w, h, (ctx, w, h) => { ... }, { srgb: true, mipmaps: true })   // OffscreenCanvas 2D (hangul or kanji signs, paper patterns)
kit.dataTexture(THREE, w, h, (x, y) => [r, g, b, a], { type, wrap, filter })
kit.cached(renderer, 'myscene:stone:1024', () => kit.bakeTexture(...))                  // shared across variants and scene switches; never dispose
kit.createPass(THREE, { fragment, uniforms, defines, blending }) -> { material, uniforms, render(renderer, target|null), dispose() }   // full-screen pass
kit.halfFloatOK(renderer) -> bool
```
Bake fragments get `GLSL.common + noise + curl` prepended. Write LINEAR colours for albedo; `kSrgbToLinear(vec3)`
converts sRGB picks.

### GLSL chunks (`kit.GLSL.common | noise | curl | tonemap | atmosphere | fog | ripples | triplanar | all`)

Every chunk is guarded with `#ifndef`, and every name starts with `k`. Prepend `kit.GLSL.common + kit.GLSL.noise` to
your ShaderMaterial or to `onBeforeCompile` code.

- **hash:** `kHash11/12/13/21/22/33/41/42`
- **noise:** `kValue2/3`, `kSimplex2/3`, `kPerlin2p(p, period)`, `kWorley2(p)` / `kWorley2p(p, per)` -> (F1, F2)
- **fbm:** `kFbm2(p, oct)`, `kFbm3`, `kFbmS2/S3` (signed), `kFbm2p(p, per, oct)` (tileable), `kRidged2`,
  `kWarp2(p, oct, amount)` (domain warp)
- **curl:** `kCurl3(p)`
- **colour and tonemap:** `kACES`, `kAgX`, `kSrgbToLinear`, `kLinearToSrgb`, `kLuma`, `kBlackbody(kelvin)`
- **utilities:** `kSat`, `kRemap`, `kFresnel(cosT, f0)`, `kPhaseHG`, `kPhaseRayleigh`, `kRaySphere`
- **rain ripples:** `kRipples(p, t, density, layers)` -> normal xy
- **sampling:** `kTriplanar(tex, p, n, scale)`
- **fog:** `kFog(col, wpos, cam)` (needs the fog uniforms; `sky.patch` wires them)

### CPU helpers (kit.js)

```js
kit.Q[quality]  // { particles, shadowMap, mirror, msaa, geometry, octaves, pixelRatioCap, envEvery } (light / high / ultra budgets)
kit.rng(seed) -> r(); r.range(a, b); r.int(n); r.pick(arr); r.chance(p); r.gauss(); r.fork('label')
kit.hashSeed('hanok', variant, seed) -> uint32;  kit.hash01(...numbers) -> [0,1) stateless
kit.noise1(x, seed), kit.noise2(x, y, seed), kit.noise3(x, y, z, seed) (-1..1), kit.fbm2(x, y, { octaves, lacunarity, gain, seed }), kit.ridged2(...)
kit.clamp, lerp, smoothstep, smootherstep, remap(x, a, b, c, d), fract, deg, pingpong(t, period)
kit.integral(fn, t, step = 0.25)            // position under a time-varying speed, exact and jump-free
kit.flicker(t, seed, { speed: 1, depth: 0.25 }) -> 0..1   // lantern/candle 1.6 / old neon 0.6
kit.lightning(t, f, seed) -> 0..~1.5         // from f.big only: main stroke + restrikes
kit.smoother({ attack: 0.5, release: 3 }) -> { step(t, x), value, reset() }
kit.soft(x, knee = 0.6)                      // gentle response curve 0..1
kit.mixF(f, { bass: 0.5, energy: 0.5 })      // weighted feature mix
kit.silence(), kit.FEATURES                  // all-zero features / field names
kit.portraitness(aspect) -> 0 (16:9) .. 1 (9:16);  kit.aspectFov(fov16x9, aspect, w = 0.5)
kit.cameraPath(keys, { period: 240, mode: 'pingpong'|'loop'|'once', breathe: 0.03, seed, fovWiden: 0.5 }) -> { at(t, aspect, { breath }), apply(camera, t, { breath }) }
   keys: [{ pos: [x, y, z], look: [x, y, z], fov: 38, roll: 0, portrait: { pos, look, fov } }, ...]   (Catmull-Rom, eased turns, hand-held breathing)
kit.orbitPath({ center, radius, height, speed: 0.012, arc: 0.8, start, lookHeight, fov, breathe, seed }) -> same API
kit.sunShadow(dirLight, { size: kit.Q[quality].shadowMap, extent: 25, near, far, bias, normalBias, radius })
kit.kelvin(1900) -> linear [r, g, b]   // lantern 1900, candle 1800, sodium 2100, moon 4100, overcast 6500
```

Example camera:
```js
const path = kit.cameraPath([
  { pos: [-4.5, 1.6, 6.5], look: [0, 1.7, -4.4], fov: 38, portrait: { pos: [-2.5, 1.5, 7.5], fov: 40 } },
  { pos: [0.5, 1.3, 5.2], look: [0.5, 1.8, -4.4], fov: 36 },
  { pos: [4.2, 1.8, 6.8], look: [-0.5, 1.6, -4.4], fov: 40, portrait: { pos: [2.5, 1.7, 7.8] } },
], { period: 210, breathe: 0.035, seed });
// in render():  const cam = path.apply(camera, t, { breath: f.energy * intensity });  post.grade.dof.focus = distance(cam.pos, cam.look);
```

Example skeleton for `render` (see kit-demo.js for the full version):
```js
function render(t, f) {
  sky.params.sun.elevation = base + 1.2 * Math.sin(t / 170 + seed); sky.update(t); sky.applyLights({ sun, moon });
  if (t - envT > kit.Q[quality].envEvery || t < envT) { scene.environment = sky.bakeEnvironment(); envT = t; }
  const cam = path.apply(camera, t, { breath: f.energy });
  const k = kit.flicker(t, 3, { speed: 1.1, depth: 0.18 }) * (1 + intensity * (0.15 * f.level + 0.25 * f.accent));
  lantern.material.emissiveIntensity = 6 * k; lanternLight.intensity = 5 * k;
  const fl = kit.lightning(t, f, seed) * intensity;
  rain.update(t, camera, { density: 0.45 + 0.5 * kit.soft(f.energy, 0.5), wind: [0.9, 0, 0.25], gust: 0.4, lights: [...] });
  wet.uniforms.uTime.value = t;
  post.grade.bloom.strength = 0.07 * (1 + 0.25 * intensity * f.bass);
  rain.object.visible = false; mirror.update(scene, camera, { hide: [ground] }); rain.object.visible = true;
  post.setSun(sky.sunDir, camera); post.render(scene, camera, t);
}
function resize(w, h, pr = 1) { camera.aspect = w / h; camera.updateProjectionMatrix(); post.resize(w, h, pr); mirror.resize(w, h, pr); }
```

## 3. Audio features `f` (features.js; same fields offline and live)

Each song is normalised (to its 95th percentile), so quiet ambient mixes still move. Values are 0..about 1.2.
Silence makes every field 0.

| field | what it is | time scale | use it for |
|---|---|---|---|
| `level` | overall loudness envelope | 0.1 s up / 0.5 s down | light breathing, lantern brightness |
| `low` | bass band (30-160 Hz) envelope | 40 ms / 0.32 s | (fast) avoid for visible motion |
| `mid` | 160-2500 Hz envelope | 0.15 / 0.8 s | colour warmth drift |
| `high` | 2.5-12 kHz envelope | 50 ms / 0.35 s | sparkle, glitter intensity |
| `pulse` | beat-weighted low end (the heart's beat) | fast | heart only, never scale things with it |
| `slow` | 3 s loudness average | 3 s | camera breathing |
| `accent` | onset envelope (flux peaks), decays in 0.17 s | fast | small flicker kicks (max +25%) |
| `accentLag` | `accent` 3 frames ago | | |
| `onset` | 1 on the frame of an onset, else 0 | 1 frame | trigger a deterministic choice (with hash01(frame)) |
| **`energy`** | section energy (about 12 s window) | 1.5 s | **the main driver**: rain density, wind, fog, overall life |
| **`bass`** | smoothed bass | 0.4 / 1.5 s | bloom, warm glow, water swell |
| **`bright`** | smoothed highs | 0.4 / 1.5 s | sparkle, sun glitter, star twinkle |
| **`big`** | rare big-accent envelope (strongest onsets, at most one per 8 s, only while loud), tau 0.5 s | | lightning (`kit.lightning`), a gust, a lantern swing |
| **`flow`** | integral of `energy` over time (s) | monotonic | audio-dependent speeds: `phase = k * f.flow` never jumps |

Use the bold fields for scenes. Scale every reaction by `intensity`. The preview computes the same fields live from an
AnalyserNode (`createLiveFeatures`), and `idleFeatures(t)` gives a calm stand-in when nothing plays.

## 4. Registry (index.js)

These ids are pre-registered: `rain-window` (Cozy), `hanok-rain` (Korea), `bamboo-temple` (Japan), `guilin-mist`
(China), `golden-ocean` and `aurora-snow` (Nature), `neon-night` (Night city), `heart` (Classic, the original fox
heart wrapped as a scene; variants = its moods sakura / kitsune / moon) and `kit-demo` (hidden). The registry loads a
scene lazily with `import('./<id>.js?v=8')`. It checks that `meta.id` matches, that `variants` is a non-empty
`[{id, name}]` and that `createScene` exists. A missing, throwing or invalid module is hidden from the picker and never
breaks the studio. `meta` overrides the registry's static name, desc, group and swatch once loaded.

## 5. Pipeline

`makeVideo({audio, width, height, fps: 30|60, scene, variant, quality: 'light'|'high'|'ultra', showText, intensity, seed, title, artist, onProgress, signal})`
runs in this order: audio, then `computeFeatures`, then the render worker (`scene host -> your scene`, frame i at
t = i / fps), then WebCodecs, then the muxer.

- **H.264 + AAC .mp4:** High profile. The level is the lowest that fits: 4.0 at 1080p30, 5.0 at 1440p, 5.1
  (`avc1.640033`) at 4K30. Main and Baseline are fallbacks.
- **VP9 + Opus .webm:** used when the browser has no H.264/AAC encoder.
- **Bitrates:** 10 Mbps at 720p30, 16 at 1080p30, 28 at 1440p30, 45 at 4K30, x1.5 at 60 fps. 1:1 scales by pixel
  count. VP9 uses 75% of these.
- **Resolutions:** 720p, 1080p (default) and 1440p are offered in 16:9, 9:16 and 1:1. 4K appears only when
  `VideoEncoder.isConfigSupported` says yes.
- **Export screen:** shows a still every 1.5 s and an ETA measured from the last 3 s of frames plus the encoder flush.
  Cancel works at any frame.

## 6. Testing: `tests/scene-check.cjs`

```
cd /home/user/nicofoxheart/studio
NODE_PATH=$(npm root -g) node teams/tape/tests/scene-check.cjs <id> [variant] [--w 480 --h 270] [--frames 4] [--t 0,30,90,200]
    [--aspect 16:9|9:16|1:1] [--quality light|high|ultra] [--song sleepy-rain] [--all-variants] [--no-silence] [--text]
    [--video 3 [--res 720|1080|1440|2160] [--fps 30]]
```
- The scene renders through the real path: `preview-worker.js -> host.js -> index.js -> <id>.js`, in Chromium with
  SwiftShader (software WebGL2).
- Features come from one of Nico's songs (`audio/<song>.mp3`, default `i-am-with-you-always`), plus one silent frame.
- PNGs are written to `teams/tape/qa/scenes/<id>/<variant>-<16x9>-<quality>-t<T>.png` (and `-silence-`). **Look at
  every PNG with Read.** Your eyes judge the realism.
- The JSON output gives:
  - `msPerFrame`
  - per-frame `stats` (`calls`, `triangles`, `textures`, `geometries`, `programs`)
  - `memoryMB` (GPU estimate)
  - `determinism` (the same t rendered twice with another t between; it must be `identical: true`)
  - `errors` (console, shader and worker errors; must be `[]`)
  - `budget` (warnings against the limits below)
  - `pass`
- `--video 3` runs a real 3 s `makeVideo` export in the render worker and ffprobes it (the file and a mid-frame
  still go into the same folder). Headless Chromium here has no H.264/AAC encoder, so the test file is VP9/Opus
  WebM; the MP4 path is the same code with the other codec config.
- SwiftShader is roughly 10-50x slower than a mid GPU. Judge looks at 480x270 and speed from the budget. Keep runs
  short (4-core shared machine): use 2-4 times and `--frames 2`.
- Before you finish, run `--all-variants` in 16:9, then one run in `--aspect 9:16` and one in `--aspect 1:1`, plus
  one `--quality light` run.

## 7. Performance budget (per frame)

| | light | high (default) | ultra |
|---|---|---|---|
| draw calls | <= 150 | <= 350 | <= 500 |
| triangles | <= 0.5 M | <= 1.5 M | <= 3 M |
| shader programs | <= 30 | <= 40 | <= 48 |
| GPU memory (scene-check 480x270, excluding the screen-size targets) | <= 200 MB | <= 350 MB | <= 600 MB |
| SwiftShader ms/frame at 480x270 | <= 900 | <= 2500 | <= 5000 |
| target on a mid GPU (GTX 1660 / RX 6600 class) | 60 fps preview | >= 30 fps preview, >= 15 fps at 1080p export | >= 6 fps at 4K export |
| createScene time | < 1 s | < 1.5 s | < 3 s |

Reference: kit-demo (wet stone, mirror, rain and splashes, sky, fog, hills, post on high) uses about 80 calls, 160k
triangles, 14 programs and about 112 MB, and takes about 880 ms/frame at 480x270 on SwiftShader.

To save cost:
- Use one mirror at most; mirror resolution is `kit.Q[q].mirror`.
- Use shadows only on high/ultra (`kit.Q[q].shadowMap`).
- Use instancing (`InstancedMesh`) for bamboo, roof tiles, rocks and lanterns.
- Bake the env map at most every `kit.Q[q].envEvery` s of song time.
- Scale particle counts with quality (the kit does this).
- On light, drop DOF and rays (POST_Q does) and halve the geometry (`kit.Q.light.geometry`).
