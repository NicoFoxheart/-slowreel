// kit.js - the Slowreel scene kit. Everything a scene needs to look filmic, in core THREE only (THREE is always passed in;
// nothing here imports three or its addons). See SCENES-API.md for the contract and examples.
//   import * as kit from './kit.js?v=8';
// GPU pieces: createPost (post chain), createSky (+ fog, env, lights), createParticles (rain/snow/petals/dust/fireflies),
// createMirror, createWater, patchWet, patchFog, bakeTexture, noiseTexture, normalMapFromHeight, canvasTexture,
// dataTexture, heightfield, createPass, cached, createBag. CPU pieces (this file): rng, hashSeed, math, noise2/3, fbm2,
// ridged2, audio smoothing, flicker, lightning, camera paths, aspect framing, quality presets, GLSL chunks.
import * as GLSL from './kit-glsl.js?v=10a';
export { GLSL };
export { createPass, PASS_VS, halfFloatOK, cached, disposeCached, bakeTexture, noiseTexture, normalMapFromHeight, canvasTexture, dataTexture, createBag } from './kit-gpu.js?v=10a';
export { createPost, defaultGrade, POST_Q } from './kit-post.js?v=10a';
export { createSky, patchFog, defaultSky, defaultFog, sunFromHour, SKY_Q } from './kit-sky.js?v=10a';
export { createParticles, windDrift, windAt } from './kit-fx.js?v=10a';
export { createMirror, createWater, patchWet, heightfield } from './kit-surface.js?v=10a';

// ------------------------------------------------------------------------------------------------ quality
/**
 * What each quality level means (scenes read Q[quality] for their own budgets). Export uses the quality the user picked;
 * the live preview always runs 'light' or 'high'. pixelRatioCap applies to the preview only.
 */
export const Q = {
  light: { name: 'light', particles: 0.35, shadowMap: 1024, mirror: 0.35, msaa: 0, geometry: 0.5, octaves: 4, pixelRatioCap: 1, envEvery: 20 },
  high: { name: 'high', particles: 1, shadowMap: 2048, mirror: 0.5, msaa: 4, geometry: 1, octaves: 6, pixelRatioCap: 1.5, envEvery: 8 },
  ultra: { name: 'ultra', particles: 1.5, shadowMap: 4096, mirror: 0.75, msaa: 4, geometry: 1.5, octaves: 7, pixelRatioCap: 2, envEvery: 4 },
};

// ------------------------------------------------------------------------------------------------ math
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const smootherstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * t * (t * (t * 6 - 15) + 10); };
export const remap = (x, a, b, c, d) => c + (d - c) * clamp((x - a) / (b - a));
export const fract = x => x - Math.floor(x);
export const deg = d => d * Math.PI / 180;
/** Ping-pong 0..1..0 with zero speed at the turns (cosine ease): period = seconds for 0 -> 1. */
export const pingpong = (t, period) => 0.5 - 0.5 * Math.cos(Math.PI * t / period);

// ------------------------------------------------------------------------------------------------ seeded randomness
/** FNV-1a hash of any mix of strings / numbers -> uint32. hashSeed('hanok', variant, seed) */
export function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const p of parts) { const s = String(p); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } h ^= 0x9e; h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
/**
 * Seeded RNG (mulberry32). const r = rng(seed); r() -> [0,1); r.range(a, b); r.int(n) -> 0..n-1; r.pick(arr);
 * r.gauss() (mean 0, sd 1); r.chance(p); r.fork(label) -> an independent stream. Use it at init, never Math.random.
 */
export function rng(seed = 1) {
  let s = (seed >>> 0) || 0x9e3779b9;
  const r = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  r.range = (a, b) => a + (b - a) * r();
  r.int = n => Math.floor(r() * n);
  r.pick = a => a[Math.floor(r() * a.length)];
  r.chance = p => r() < p;
  r.gauss = () => { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  r.fork = label => rng(hashSeed(seed, label));
  return r;
}
/** A stateless hash of numbers -> [0,1) (for per-frame randomness that must not depend on render order). */
export function hash01(...n) { return hashSeed(...n) / 4294967296; }

// ------------------------------------------------------------------------------------------------ CPU noise
const GRAD3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
const perms = new Map();
function perm(seed) {
  let p = perms.get(seed); if (p) return p;
  const r = rng(hashSeed('perm', seed)), a = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  p = new Uint8Array(512); for (let i = 0; i < 512; i++) p[i] = a[i & 255];
  perms.set(seed, p); return p;
}
/** 2D simplex noise -1..1 (seeded). For geometry, layouts and CPU animation. */
export function noise2(x, y, seed = 0) {
  const P = perm(seed), F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * G2;
  const x0 = x - (i - t), y0 = y - (j - t), i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2, ii = i & 255, jj = j & 255;
  const c = (gx, gy, g) => { let q = 0.5 - gx * gx - gy * gy; if (q < 0) return 0; q *= q; const G = GRAD3[g % 12]; return q * q * (G[0] * gx + G[1] * gy); };
  return 70 * (c(x0, y0, P[ii + P[jj]]) + c(x1, y1, P[ii + i1 + P[jj + j1]]) + c(x2, y2, P[ii + 1 + P[jj + 1]]));
}
/** 3D simplex noise -1..1 (seeded). noise3(x, y, t) gives smooth 2D noise that evolves over time. */
export function noise3(x, y, z, seed = 0) {
  const P = perm(seed), F3 = 1 / 3, G3 = 1 / 6;
  const s = (x + y + z) * F3, i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s), t = (i + j + k) * G3;
  const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) { if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; } }
  else { if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } }
  const ii = i & 255, jj = j & 255, kk = k & 255;
  const c = (gx, gy, gz, g) => { let q = 0.6 - gx * gx - gy * gy - gz * gz; if (q < 0) return 0; q *= q; const G = GRAD3[g % 12]; return q * q * (G[0] * gx + G[1] * gy + G[2] * gz); };
  return 32 * (c(x0, y0, z0, P[ii + P[jj + P[kk]]]) + c(x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3, P[ii + i1 + P[jj + j1 + P[kk + k1]]])
    + c(x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3, P[ii + i2 + P[jj + j2 + P[kk + k2]]]) + c(x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3, P[ii + 1 + P[jj + 1 + P[kk + 1]]]));
}
/** fbm of noise2, ~-1..1. {octaves = 5, lacunarity = 2, gain = 0.5, seed} */
export function fbm2(x, y, { octaves = 5, lacunarity = 2, gain = 0.5, seed = 0 } = {}) {
  let s = 0, a = 1, n = 0, f = 1;
  for (let i = 0; i < octaves; i++) { s += a * noise2(x * f + i * 17.1, y * f - i * 9.3, seed); n += a; a *= gain; f *= lacunarity; }
  return s / n;
}
/** Ridged multifractal 0..1 (sharp crests: karst peaks, mountain ridges). */
export function ridged2(x, y, { octaves = 5, lacunarity = 2.1, gain = 0.5, seed = 0 } = {}) {
  let s = 0, a = 0.5, n = 0, f = 1, w = 1;
  for (let i = 0; i < octaves; i++) { let r = 1 - Math.abs(noise2(x * f + i * 3.1, y * f + i * 7.7, seed)); r *= r * w; w = clamp(r * 2); s += a * r; n += a; a *= gain; f *= lacunarity; }
  return s / n;
}
/** Smooth 1D noise -1..1 for CPU animation: noise1(t * 0.2, seed). */
export const noise1 = (x, seed = 0) => noise2(x, 0.5 + (seed % 97) * 3.7, seed);

// ------------------------------------------------------------------------------------------------ time & motion
/**
 * Integral of fn over [0, t] on a fixed grid (step s) - a pure function of t (same arithmetic every call), so speeds that
 * change over time (scripted gusts, a boat that slows) give positions that never jump. ~t/step calls of fn per frame.
 */
export function integral(fn, t, step = 0.25) {
  const n = Math.floor(Math.max(0, t) / step); let s = 0;
  for (let i = 0; i < n; i++) s += (fn(i * step) + fn((i + 1) * step)) * 0.5 * step;
  const r = t - n * step; if (r > 0) s += (fn(n * step) + fn(t)) * 0.5 * r;
  return s;
}
/**
 * Lantern / candle / neon flicker 0..1 (1 = full), deterministic in t. speed ~1 (candle 1.6, old neon 0.6), depth 0..1.
 * Add audio: intensity = base * flicker(t, i) * (1 + f.accent * 0.15).
 */
export function flicker(t, seed = 0, { speed = 1, depth = 0.25 } = {}) {
  const n = noise2(t * 2.1 * speed, seed * 7.3, seed) * 0.55 + noise2(t * 7.3 * speed, seed * 3.1 + 5, seed) * 0.3 + noise2(t * 19 * speed, seed + 11, seed) * 0.15;
  return clamp(1 - depth * (0.5 + 0.5 * n));
}
/**
 * Lightning flash 0..~1.5 from the big-accent envelope f.big (rare, at most every 8 s): a main stroke + 1-2 restrikes.
 * Scene use: if (fl > 0) { sky.params.nightGlow = ...; sunLight.intensity += fl * 6; post.grade.exposure *= 1 + fl * 0.5 }
 */
export function lightning(t, f, seed = 0) {
  const b = f.big || 0; if (b < 0.02) return 0;
  const age = -Math.log(Math.max(b, 1e-4)) * 0.5;             // seconds since the strike (big decays with tau 0.5 s)
  const strike = Math.floor((t - age) * 4);
  const re = hash01(seed, strike) > 0.4 ? 1 : 0;
  const pulse = (a, w) => Math.exp(-((age - a) * (age - a)) / (w * w));
  return b * (pulse(0.02, 0.05) + 0.6 * re * pulse(0.16 + 0.1 * hash01(seed, strike, 2), 0.04) + 0.35 * pulse(0.33, 0.06)) * 1.2;
}

// ------------------------------------------------------------------------------------------------ audio smoothing
/**
 * The audio features (every frame, from features.js): pulse, low, mid, high, level, slow, accent, accentLag, energy,
 * bass, bright, big, onset, flow (see SCENES-API.md). Missing fields read as 0.
 */
export const FEATURES = ['pulse', 'low', 'mid', 'high', 'level', 'slow', 'accent', 'accentLag', 'energy', 'bass', 'bright', 'big', 'onset', 'flow'];
export function silence() { const o = {}; for (const k of FEATURES) o[k] = 0; return o; }
/**
 * Extra smoothing with attack / release (seconds), for when a field moves too fast for your effect. Deterministic for
 * sequential frames (the export) and idempotent for the same t; resets on a jump backwards or > 1 s forwards (seek).
 * const s = smoother({attack: 0.5, release: 3}); ... const glow = s.step(t, f.level);
 */
export function smoother({ attack = 0.3, release = 1.5, initial = 0 } = {}) {
  let y = initial, last = null;
  return {
    step(t, x) {
      if (last === null || t < last || t - last > 1) { y = x; last = t; return y; }
      const dt = t - last; last = t; if (dt <= 0) return y;
      const k = 1 - Math.exp(-dt / (x > y ? attack : release)); y += (x - y) * k; return y;
    },
    get value() { return y; }, reset(v = initial) { y = v; last = null; },
  };
}
/** Soft response curve: 0..1 in, 0..1 out, gentle at the top (keeps reactions subtle). */
export const soft = (x, knee = 0.6) => (x <= 0 ? 0 : 1 - Math.exp(-x / knee));
/** Weighted mix of feature fields: mixF(f, {bass: 0.5, energy: 0.5}). */
export function mixF(f, w) { let s = 0; for (const k in w) s += (f[k] || 0) * w[k]; return s; }

// ------------------------------------------------------------------------------------------------ framing & camera
/** 0 at 16:9 (or wider), 1 at 9:16 (or taller): blend framings with it. */
export const portraitness = aspect => clamp((16 / 9 - aspect) / (16 / 9 - 9 / 16));
/**
 * Vertical FOV (degrees) for this aspect from the one you designed at 16:9. Narrower aspects widen the view part of the
 * way (w = 0 crops the sides, w = 1 keeps the full width); w = 0.5 is a good default: 9:16 keeps ~60% of the 16:9 width.
 */
export function aspectFov(fov16x9, aspect, w = 0.5) {
  const base = 16 / 9; if (aspect >= base) return fov16x9;
  const t = Math.tan(fov16x9 * Math.PI / 360) * Math.pow(base / aspect, w);
  return Math.atan(t) * 360 / Math.PI;
}
const v3 = (a, out = [0, 0, 0]) => { if (!a) return out; if (Array.isArray(a)) { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; } else { out[0] = a.x; out[1] = a.y; out[2] = a.z; } return out; };
function catmull(p0, p1, p2, p3, t) {            // uniform Catmull-Rom on numbers
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
/**
 * A slow, deterministic camera path through keyframes. keys: [{pos: [x,y,z], look: [x,y,z], fov?: deg (at 16:9), roll?: rad,
 *   portrait?: {pos, look, fov}}] - portrait overrides are blended in by portraitness(aspect).
 * opts: period (s for one pass, default 240), mode 'pingpong' (default: there and back, eased at the turns) | 'loop' |
 *   'once', breathe (m of slow hand-held drift, default 0.03), seed, fovWiden (aspectFov w, default 0.5).
 * path.at(t, aspect, {breath}) -> {pos: [x,y,z], look: [x,y,z], fov, roll}; path.apply(camera, t, {breath}) sets a
 * PerspectiveCamera (position, lookAt, fov, roll, updateProjectionMatrix). breath 0..1 (e.g. f.energy) adds a little
 * more drift when the music is fuller.
 */
export function cameraPath(keys, { period = 240, mode = 'pingpong', breathe = 0.03, seed = 1, fovWiden = 0.5 } = {}) {
  if (!keys?.length) throw new Error('cameraPath needs keys');
  const K = keys.map(k => ({ pos: v3(k.pos), look: v3(k.look), fov: k.fov ?? 40, roll: k.roll ?? 0,
    p: k.portrait ? { pos: v3(k.portrait.pos ?? k.pos), look: v3(k.portrait.look ?? k.look), fov: k.portrait.fov ?? k.fov ?? 40 } : null }));
  const n = K.length, sd = (seed % 1000) * 1.37;
  const sample = (arr, u) => {                     // u 0..1 along the keys
    if (n === 1) return arr(0);
    const x = clamp(u) * (n - 1), i = Math.min(n - 2, Math.floor(x)), t = x - i;
    const g = j => arr(Math.max(0, Math.min(n - 1, j)));
    return catmull(g(i - 1), g(i), g(i + 1), g(i + 2), t);
  };
  function at(t, aspect = 16 / 9, { breath = 0 } = {}) {
    let u = mode === 'loop' ? fract(t / period) : mode === 'once' ? smootherstep(0, 1, t / period) : pingpong(t, period);
    const p = portraitness(aspect), o = { pos: [0, 0, 0], look: [0, 0, 0], fov: 40, roll: 0 };
    for (let c = 0; c < 3; c++) {
      const a = sample(j => K[j].pos[c], u), b = sample(j => (K[j].p ? K[j].p.pos[c] : K[j].pos[c]), u);
      const la = sample(j => K[j].look[c], u), lb = sample(j => (K[j].p ? K[j].p.look[c] : K[j].look[c]), u);
      o.pos[c] = lerp(a, b, p); o.look[c] = lerp(la, lb, p);
    }
    const fa = sample(j => K[j].fov, u), fb = sample(j => (K[j].p ? K[j].p.fov : K[j].fov), u);
    o.fov = aspectFov(lerp(fa, fb, p), aspect, fovWiden);
    o.roll = sample(j => K[j].roll, u);
    // hand-held breathing: two slow noise octaves on the position and a smaller one on the target
    const amp = breathe * (1 + 0.6 * clamp(breath));
    for (let c = 0; c < 3; c++) {
      o.pos[c] += amp * (noise2(t * 0.071 + c * 11.3, sd) + 0.4 * noise2(t * 0.23 + c * 5.1, sd + 3));
      o.look[c] += amp * 0.6 * noise2(t * 0.053 + c * 7.7, sd + 9);
    }
    o.roll += amp * 0.12 * noise2(t * 0.06, sd + 21);
    return o;
  }
  const tmp = { x: 0, y: 0, z: 0 };
  function apply(camera, t, opts = {}) {
    const o = at(t, camera.aspect, opts);
    camera.position.set(o.pos[0], o.pos[1], o.pos[2]);
    tmp.x = o.look[0]; tmp.y = o.look[1]; tmp.z = o.look[2];
    camera.up.set(0, 1, 0); camera.lookAt(tmp.x, tmp.y, tmp.z);
    if (o.roll) camera.rotateZ(o.roll);
    if (Math.abs(camera.fov - o.fov) > 1e-6) { camera.fov = o.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    return o;
  }
  return { at, apply, keys: K };
}
/**
 * A slow orbit (temples, islands): center [x,y,z], radius, height, speed (rad/s, ~0.01), arc (rad, pingpong range;
 * 0 = full circle), lookHeight. Returns the same {at, apply} as cameraPath.
 */
export function orbitPath({ center = [0, 0, 0], radius = 12, height = 3, speed = 0.012, arc = 0.8, start = 0, lookHeight = 1, fov = 40, breathe = 0.03, seed = 1, fovWiden = 0.5 } = {}) {
  const sd = (seed % 1000) * 2.1;
  function at(t, aspect = 16 / 9, { breath = 0 } = {}) {
    const a = start + (arc > 0 ? (pingpong(t * speed, arc) - 0.5) * arc * 2 : t * speed);
    const amp = breathe * (1 + 0.6 * clamp(breath));
    const pos = [center[0] + Math.cos(a) * radius, center[1] + height + amp * noise2(t * 0.07, sd), center[2] + Math.sin(a) * radius];
    pos[0] += amp * noise2(t * 0.061, sd + 1); pos[2] += amp * noise2(t * 0.057, sd + 2);
    return { pos, look: [center[0], center[1] + lookHeight, center[2]], fov: aspectFov(fov, aspect, fovWiden), roll: amp * 0.1 * noise2(t * 0.05, sd + 5) };
  }
  return { at, apply(camera, t, opts = {}) { const o = at(t, camera.aspect, opts); camera.position.set(...o.pos); camera.up.set(0, 1, 0); camera.lookAt(...o.look); if (o.roll) camera.rotateZ(o.roll); if (Math.abs(camera.fov - o.fov) > 1e-6) { camera.fov = o.fov; camera.updateProjectionMatrix(); } camera.updateMatrixWorld(); return o; } };
}

// ------------------------------------------------------------------------------------------------ lights
/** Sun shadow setup for a DirectionalLight: extent = half-size (m) of the shadowed area around light.target. */
export function sunShadow(light, { size = 2048, extent = 25, near = 0.5, far = 200, bias = -0.0004, normalBias = 0.03, radius = 2 } = {}) {
  light.castShadow = true;
  light.shadow.mapSize.set(size, size);
  const c = light.shadow.camera; c.left = -extent; c.right = extent; c.top = extent; c.bottom = -extent; c.near = near; c.far = far; c.updateProjectionMatrix();
  light.shadow.bias = bias; light.shadow.normalBias = normalBias; light.shadow.radius = radius;
  return light;
}
/** Colour temperature (Kelvin) -> linear RGB array (normalised): lanterns 1900, candles 1800, sodium 2100, moon 4100. */
export function kelvin(k) {
  const t = k / 100, s = x => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  const r = t <= 66 ? 1 : clamp(1.29293618 * Math.pow(t - 60, -0.1332047592));
  const g = t <= 66 ? clamp(0.39008157 * Math.log(t) - 0.63184144) : clamp(1.12989086 * Math.pow(t - 60, -0.0755148492));
  const b = t >= 66 ? 1 : t <= 19 ? 0 : clamp(0.54320678 * Math.log(t - 10) - 1.19625408);
  return [s(r), s(g), s(b)];
}
