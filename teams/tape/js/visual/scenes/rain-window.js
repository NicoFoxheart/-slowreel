// rain-window.js - "Rain on the window": night, from inside a dim room, a pane covered in rain. The lens is focused on
// the glass, so the world outside is a field of bokeh (streetlights, windows, a passing car, a blinking tower light,
// lightning in the clouds) while every water drop holds its own sharp, inverted miniature of it. Beads sit and grow,
// fresh impacts land, heavy drops break free and stick-slip down in wiggly paths leaving clear wet tracks with trail
// droplets; condensation mist veils the rest. Variants: city night, blue hour, neon, countryside (trees, one porch light).
// Shaders: rain-window-glsl.js. Everything is procedural and a pure function of (t, f, seed).
import * as kit from './kit.js?v=9c';
import { BASE_VS, BASE_FS, SPRITE_VS, SPRITE_FS, GLASS_FS, MICRO_FS } from './rain-window-glsl.js?v=9c';

export const meta = {
  id: 'rain-window', name: 'Rain on the window', group: 'Cozy',
  desc: 'Night rain on a window pane, a city in soft bokeh behind the drops.',
  variants: [
    { id: 'city-night', name: 'City night' },
    { id: 'blue-hour', name: 'Blue hour', text: { accent: '#9fc4ff' } },
    { id: 'neon', name: 'Neon', text: { accent: '#ff7ad9' } },
    { id: 'countryside', name: 'Countryside', text: { accent: '#ffc27a' } },
  ],
  defaultVariant: 'city-night', thumbT: 24,
  text: { ink: '#f3eee8', accent: '#ffc98a' }, swatch: ['#14161c', '#e8a35a'],
};

const K = kit.kelvin;
const mul = (c, s) => [c[0] * s, c[1] * s, c[2] * s];
const LOOKS = {
  'city-night': { world: 'city', camH: 14, pitch: -8, fov: 36, lamps: [[2050, 0.65], [3900, 0.35]], lampB: 1.7, winProb: 0.3, winB: 0.3,
    skyTop: [0.0035, 0.004, 0.0055], skyHor: [0.03, 0.021, 0.016], cityGlow: [0.012, 0.007, 0.004], cloud: 0.85, haze: [0.022, 0.017, 0.015],
    facade: [0.0035, 0.0034, 0.0037], ground: [0.0022, 0.0021, 0.0022], street: [0.03, 0.024, 0.017], vis: 1300,
    rain: 0.55, run: 0.6, wet: 1, mist: 0.75, cars: 0.62, lightning: 1,
    lamp: mul(K(2600), 1.0), room: [0.0016, 0.0011, 0.0008], candle: mul(K(1800), 0.012), spec: 0.9,
    grade: { exposure: 1.9, temperature: 0.02, tint: 0, saturation: 0.95, contrast: 1.06, lift: [0.003, 0.0035, 0.005], gain: [1, 0.985, 0.96] }, bloom: 0.11 },
  'blue-hour': { world: 'city', camH: 14, pitch: -6, fov: 36, lamps: [[2100, 0.8], [4000, 0.2]], lampB: 1.4, winProb: 0.3, winB: 0.28,
    skyTop: [0.014, 0.028, 0.075], skyHor: [0.055, 0.06, 0.085], cityGlow: [0.018, 0.012, 0.01], cloud: 0.5, haze: [0.034, 0.042, 0.065],
    facade: [0.007, 0.0095, 0.016], ground: [0.004, 0.005, 0.008], street: [0.028, 0.024, 0.02], vis: 1600,
    rain: 0.38, run: 0.42, wet: 0.8, mist: 0.5, cars: 0.7, lightning: 0.6,
    lamp: mul(K(2700), 0.7), room: [0.0012, 0.001, 0.0009], candle: mul(K(1800), 0.008), spec: 0.7,
    grade: { exposure: 1.9, temperature: -0.06, tint: 0.01, saturation: 0.95, contrast: 1.05, lift: [0.002, 0.004, 0.008], gain: [0.98, 0.99, 1.02] }, bloom: 0.1 },
  neon: { world: 'city', camH: 11, pitch: -9, fov: 36, lamps: [[4300, 0.7], [2200, 0.3]], lampB: 1.3, winProb: 0.36, winB: 0.3, neon: true,
    skyTop: [0.003, 0.003, 0.006], skyHor: [0.022, 0.014, 0.024], cityGlow: [0.01, 0.004, 0.009], cloud: 0.85, haze: [0.018, 0.012, 0.022],
    facade: [0.003, 0.003, 0.004], ground: [0.0018, 0.0018, 0.0022], street: [0.02, 0.018, 0.02], vis: 1100,
    rain: 0.62, run: 0.7, wet: 1, mist: 0.65, cars: 0.66, lightning: 0.8,
    lamp: mul(K(2500), 0.8), room: [0.0013, 0.0009, 0.0008], candle: mul(K(1800), 0.008), spec: 0.8,
    grade: { exposure: 2.2, temperature: -0.02, tint: 0.03, saturation: 1.08, contrast: 1.08, lift: [0.003, 0.002, 0.006], gain: [1, 0.97, 1] }, bloom: 0.13 },
  countryside: { world: 'country', camH: 2.6, pitch: -2.5, fov: 36, lampB: 2.2,
    skyTop: [0.0042, 0.0047, 0.0062], skyHor: [0.0155, 0.0155, 0.0175], cityGlow: [0.009, 0.0055, 0.0032], cloud: 0.9, haze: [0.0105, 0.011, 0.0125],
    facade: [0.0011, 0.0012, 0.0012], ground: [0.0016, 0.0018, 0.0015], vis: 900,
    rain: 0.6, run: 0.6, wet: 1, mist: 0.8, cars: 0.45, lightning: 1.3, sway: 0.25,
    lamp: mul(K(2400), 0.9), room: [0.0014, 0.001, 0.0007], candle: mul(K(1800), 0.016), spec: 0.9,
    grade: { exposure: 3.2, temperature: 0.03, tint: 0, saturation: 0.92, contrast: 1.05, lift: [0.003, 0.0035, 0.0045], gain: [1, 0.98, 0.95] }, bloom: 0.12 },
};
const QS = {
  light: { bg: 0.34, sharp: 0.3, run2: false, beadC: false },
  high: { bg: 0.5, sharp: 0.42, run2: true, beadC: true },
  ultra: { bg: 0.7, sharp: 0.6, run2: true, beadC: true },
};
const OS = 1.4;            // the outside is rendered with overscan, so drops at the frame edge still have a world to refract
const GLASS_DIST = 0.17;   // m from the lens to the pane (focus distance)
const NOM = Math.PI * 0.05 * 0.05;   // nominal disc area (radius 5% of the short side): brightness x NOM = flux
const PW = 256;

export function createScene({ THREE, renderer, width, height, pixelRatio = 1, variant = 'city-night', quality = 'high', seed = 1, intensity = 0.6 }) {
  const V = LOOKS[variant] || LOOKS['city-night'];
  const Qs = QS[quality] || QS.high;
  const country = V.world === 'country';
  const bag = kit.createBag();
  const R = kit.rng(kit.hashSeed('rain-window', variant, seed));
  let amount = intensity;
  const roadY = -V.camH;
  const tanH16 = Math.tan(V.fov * Math.PI / 360);

  // ---------------------------------------------------------------------------------------------- the world profiles
  const prof = new Float32Array(PW * 3 * 4);
  const LOT = country ? [0.5, 8, 25] : [4, 8, 25];
  const DEPTH = country ? [45, 360, 2000] : [62, 260, 1400];
  const setLot = (row, i, h, tone, lit) => { const o = (row * PW + i) * 4; prof[o] = h; prof[o + 1] = tone; prof[o + 2] = lit; prof[o + 3] = 1; };
  const lotH = (row, x) => prof[(row * PW + kit.clamp(Math.floor(x / LOT[row]) + 128, 0, 255)) * 4];
  const lotLit = (row, x) => prof[(row * PW + kit.clamp(Math.floor(x / LOT[row]) + 128, 0, 255)) * 4 + 2];
  // the tower with the beacon sits where the frame's upper third is, in every aspect
  const beaconX = 58, beaconElev = kit.deg(V.pitch) + Math.atan(0.6 * tanH16);
  const beaconY = DEPTH[2] * Math.tan(beaconElev);     // above the camera
  if (!country) {
    const fill = (row, hMin, hMax, wMin, wMax, tall, gap, lit) => {
      for (let i = 0; i < PW;) {
        const w = wMin + R.int(wMax - wMin + 1);
        const h = R.chance(gap) ? 0 : R.chance(tall) ? R.range(hMax, hMax * 1.45) : hMin + (hMax - hMin) * Math.pow(R(), 1.4);
        const tone = R.range(0.15, 1), l = kit.clamp(lit * R.range(0.55, 1.35), 0, 0.95);
        for (let k = 0; k < w && i < PW; k++, i++) setLot(row, i, h, tone, l);
      }
    };
    fill(0, 9, 24, 3, 8, 0.05, 0.07, V.winProb);
    fill(1, 22, 95, 2, 6, 0.12, 0.03, V.winProb * 0.8);
    fill(2, 35, 170, 1, 3, 0.15, 0.0, V.winProb * 0.7);
    // keep the line of sight to the beacon open, and give it its tower
    const sightY = d => V.camH + d * Math.tan(beaconElev);
    for (let row = 0; row < 2; row++) {
      const xs = beaconX * DEPTH[row] / DEPTH[2];
      for (let x = xs - 9; x <= xs + 9; x += LOT[row]) { const i = kit.clamp(Math.floor(x / LOT[row]) + 128, 0, 255), o = (row * PW + i) * 4; prof[o] = Math.min(prof[o], sightY(DEPTH[row]) - 4); }
    }
    { const i = Math.floor(beaconX / LOT[2]) + 128, o = (2 * PW + i) * 4; prof[o] = V.camH + beaconY; prof[o + 2] = 0.12; prof[o - 4] = Math.min(prof[o - 4], V.camH + beaconY * 0.55); prof[o + 4] = Math.min(prof[o + 4], V.camH + beaconY * 0.6); }
  } else {
    // tree line: overlapping crowns with a gap onto the open field, ragged leaf clumps
    const crowns = [];
    for (let x = -64; x < 64;) {
      const inGap = x > -17 && x < 3;
      const r = inGap ? R.range(0.8, 1.6) : R.range(2.2, 4.6);
      crowns.push({ x, r, top: inGap ? R.range(0.8, 1.8) : R.range(6.5, 13.5) });
      x += inGap ? R.range(2.5, 6) : r * R.range(0.8, 1.4);
    }
    for (let i = 0; i < PW; i++) {
      const x = (i - 128 + 0.5) * LOT[0]; let h = 0;
      for (const c of crowns) { const dx = (x - c.x) / c.r; if (Math.abs(dx) < 1) h = Math.max(h, c.top - c.r * 0.9 * (1 - Math.sqrt(1 - dx * dx))); }
      h += (h > 0.5 ? 1 : 0) * 0.35 * kit.noise1(x * 1.3, 5);
      setLot(0, i, Math.max(0, h), 0.5, 0);
    }
    for (let i = 0; i < PW; i++) { const x = (i - 128) * LOT[1]; setLot(1, i, 10 + 9 * kit.fbm2(x * 0.004, 0.5, { octaves: 4, seed: 3 }) + 6 * kit.noise1(x * 0.011, 9), 0.5, 0); }
  }
  const profTex = bag.add(new THREE.DataTexture(prof, PW, 3, THREE.RGBAFormat, THREE.FloatType));
  profTex.minFilter = profTex.magFilter = THREE.NearestFilter; profTex.generateMipmaps = false; profTex.needsUpdate = true;

  // ---------------------------------------------------------------------------------------------- the lights
  const L = { pos: [], col: [], p: [], q: [], s: [] };
  let lid = 0;
  const add = (pos, col, bright, p = [0, 0, 0], q = [0, 0, 0, 0], s = [1, 1, 0, 0]) => {
    L.pos.push(...pos); L.col.push(...mul(col, bright * NOM)); L.p.push(p[0], p[1], p[2], lid); L.q.push(...q); L.s.push(...s); lid++;
  };
  const lampSp = 27, lampOff = R.range(-6, 6);
  const neon = [];
  if (!country) {
    // streetlights on both kerbs (+ their long reflections in the wet road)
    for (let row = 0; row < 2; row++) {
      const z = row ? -47 : -31, off = lampOff + (row ? lampSp * 0.5 : 0);
      for (let x = off - lampSp * 4; x <= off + lampSp * 4; x += lampSp) {
        const pick = R() < V.lamps[0][1] ? V.lamps[0][0] : V.lamps[1][0];
        const c = K(pick), b = V.lampB * R.range(0.85, 1.15) * (R.chance(0.08) ? 0.35 : 1);
        add([x, roadY + 7.6, z], c, b, [0, 0, 0], [0, 0, 0, 0], [1, 1, 0, 1]);
        add([x, roadY + 2.2, z], c, b * 0.14, [0, 0, 0], [0, 0, 0, 0], [0.8, 2.8, 1, 0]);   // wet-road streak just in front of the kerb
      }
    }
    // shop fronts at street level
    for (let x = -80; x < 80; x += R.range(4, 11)) {
      if (lotH(0, x) < 1) continue;
      const c = R.chance(0.6) ? K(R.range(2900, 3600)) : K(R.range(4500, 6500));
      add([x, roadY + R.range(2.2, 3.2), -DEPTH[0] + 0.3], c, R.range(0.45, 1.1), [0, 0, 0], [R.chance(0.3) ? R.range(150, 320) : 0, 0.85, lid], [R.range(1, 1.6), 1, 0, 1]);
    }
    // windows of the row across the street (they switch on and off over the song)
    for (let x = -78; x < 78; x += R.range(2.6, 3.1)) {
      const h = lotH(0, x), pl = lotLit(0, x);
      for (let y = 4.8; y < h - 1.4; y += 3.2) {
        const tv = R.chance(0.05), cool = R.chance(0.14);
        const c = tv ? [0.45, 0.62, 1] : cool ? K(R.range(4500, 6200)) : K(R.range(2500, 3500));
        const toggles = R.chance(0.45), on = R.chance(pl);
        if (!toggles && !on) continue;   // dark room
        add([x + R.range(-0.2, 0.2), roadY + y + R.range(-0.15, 0.15), -DEPTH[0] + 0.2], c, V.winB * 2.0 * (0.25 + 1.1 * Math.pow(R(), 2.2)) * (tv ? 0.7 : 1),
          [tv ? 1 : 0, R(), 0], [toggles ? R.range(70, 260) : 0, pl, lid, 0], [1, 1, 0, 1]);
      }
    }
    // a sparse field of farther lights (offices, balconies) and red obstruction lights on the tall roofs
    for (let n = 0; n < 160; n++) {
      const x = R.range(-260, 260), h = lotH(1, x); if (h < 12) continue;
      add([x, roadY + R.range(5, h - 2), -DEPTH[1] + 0.5], R.chance(0.7) ? K(R.range(2700, 3600)) : K(5500), R.range(0.35, 0.8), [0, R(), 0], [R.chance(0.3) ? R.range(90, 300) : 0, 0.8, lid, 0], [1, 1, 0, 1]);
    }
    for (let x = -280; x < 280; x += LOT[1]) {
      const h = lotH(1, x); if (h > 70 && R.chance(0.6)) add([x + R.range(1, 6), roadY + h + 0.6, -DEPTH[1] + 0.5], [1, 0.05, 0.02], 0.5, [0, 0, 0], [0, 0, 0, 0], [1, 1, 0, 1]);
    }
    // the blinking aviation beacons
    add([beaconX, V.camH * 0 + beaconY + 1, -DEPTH[2] + 1], [1, 0.03, 0.01], 1.5, [2, R(), 2.0], [0, 0, 0, 0], [1, 1, 0, 1]);
    add([-230, DEPTH[2] * 1.4 * Math.tan(beaconElev - 0.01), -DEPTH[2] * 1.4], [1, 0.03, 0.01], 1.0, [2, R(), 1.7], [0, 0, 0, 0], [1, 1, 0, 1]);
    // traffic signals on both kerbs at the junction
    const sigX = R.range(12, 26), cyc = 46, ph = R();
    for (const z of [-30.5, -47.5]) {
      for (const [c, a, b, dy] of [[[0.05, 1, 0.5], 0, 0.42, 0], [[1, 0.42, 0.02], 0.42, 0.5, 0.35], [[1, 0.04, 0.02], 0.5, 1, 0.7]]) {
        add([sigX + (z < -40 ? 1.5 : 0), roadY + 4.6 + dy, z], c, 1.0, [4, 0, 0], [cyc, a, b, ph], [1, 1, 0, 0]);
        add([sigX + (z < -40 ? 1.5 : 0), roadY + 4.6 + dy, z], c, 0.3, [4, 0, 0], [cyc, a, b, ph], [0.8, 3, 1, 0]);
      }
    }
    // cars: a head lamp and a tail lamp each, both lanes, with reflections
    for (let lane = 0; lane < 2; lane++) {
      const z = lane ? -43 : -35.5, dir = lane ? -1 : 1;
      for (let n = 0; n < 9; n++) {
        const v = dir * R.range(8, 14), loop = 1500, start = R.range(0, loop), carId = lane * 100 + n;
        const head = K(R.chance(0.6) ? 5200 : 3600), hb = R.range(2.2, 3.2);
        for (const refl of [0, 1]) {
          const s = refl ? [0.9, 3.4, 1, 0] : [1, 1, 0, 0], k = refl ? 0.3 : 1;
          add([dir * 2.1, roadY + 0.72, z], head, hb * k, [3, 0, 0], [v, loop, start, carId], s);
          add([-dir * 2.1, roadY + 0.85, z], [1, 0.04, 0.015], 0.7 * k, [3, 0, 0], [v, loop, start, carId], s);
        }
      }
    }
    // neon signs: vertical and horizontal tubes on the facades, their spill and their reflections
    if (V.neon) {
      const pal = [[1, 0.08, 0.55], [0.1, 0.85, 1], [1, 0.25, 0.08], [0.55, 0.2, 1], [0.2, 1, 0.45], [1, 0.12, 0.2]];
      for (let n = 0; n < 7; n++) {
        const x = R.range(-46, 46); if (lotH(0, x) < 8) continue;
        const c = pal[R.int(pal.length)], vert = R.chance(0.6), len = vert ? R.range(4, 8.5) : R.range(3, 7), y0 = vert ? R.range(4.5, 6) : R.range(3.6, 4.4);
        const steps = Math.round(len / 0.45), signId = n + 1;
        for (let k = 0; k <= steps; k++) {
          const px = vert ? x : x - len / 2 + k * 0.45, py = vert ? y0 + k * 0.45 : y0;
          add([px, roadY + py, -DEPTH[0] + 1.2], c, 0.16, [5, 0, 0], [0, 0, signId, 0], [1, 1, 0, 1]);
          if (k % 3 === 0) add([px, roadY + py, -DEPTH[0] + 1.2], c, 0.11, [5, 0, 0], [0, 0, signId, 0], [0.9, 3, 1, 0]);
        }
        if (neon.length < 6) neon.push({ x: vert ? x : x, y: y0 + (vert ? len / 2 : 0), r: vert ? 4.5 : len * 0.7, s: 0.03, c });
      }
    }
  } else {
    // the neighbour's porch light, its lit window, its reflection in the wet yard
    const porch = [5.5, roadY + 2.3, -30];
    add(porch, K(2400), V.lampB, [0, 0, 0], [0, 0, 0, 0], [1, 1, 0, 0]);
    add([porch[0] + 3.4, roadY + 1.5, -30.2], K(2700), 0.45, [0, 0, 0], [240, 0.75, lid, 0], [1.2, 1, 0, 0]);
    add(porch, K(2400), V.lampB * 0.18, [0, 0, 0], [0, 0, 0, 0], [1.1, 2.4, 1, 0]);
    // a few far farm lights, seen through the gap in the trees
    for (const fx of [-150, -40, 90]) add([fx + R.range(-25, 25), roadY + R.range(1.5, 4.5), -R.range(300, 345)], K(R.range(2200, 3800)), R.range(0.18, 0.45), [0, R(), 0], [0, 0, 0, 0], [1, 1, 0, 1]);
    // a country road far across the field: now and then a car
    for (let n = 0; n < 4; n++) {
      const dir = n % 2 ? -1 : 1, v = dir * R.range(14, 22), loop = 2600, start = R.range(0, loop);
      add([dir * 2, roadY + 0.7, -210], K(4800), 2.6, [3, 0, 0], [v, loop, start, n], [1.3, 1, 0, 1]);
      add([-dir * 2, roadY + 0.8, -210], [1, 0.04, 0.015], 0.8, [3, 0, 0], [v, loop, start, n], [1, 1, 0, 1]);
    }
  }
  const nL = lid;
  const sg = bag.add(new THREE.InstancedBufferGeometry());
  sg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); sg.setIndex([0, 1, 2, 0, 2, 3]);
  sg.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(L.pos), 3));
  sg.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(L.col), 3));
  sg.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(L.p), 4));
  sg.setAttribute('aQ', new THREE.InstancedBufferAttribute(new Float32Array(L.q), 4));
  sg.setAttribute('aS', new THREE.InstancedBufferAttribute(new Float32Array(L.s), 4));
  sg.instanceCount = nL;

  // ---------------------------------------------------------------------------------------------- outside scene
  const v3 = a => new THREE.Vector3(...a);
  const shared = { tProf: { value: profTex }, uDepth: { value: v3(DEPTH) }, uLot: { value: v3(LOT) }, uCamP: { value: new THREE.Vector3() }, uRoadY: { value: roadY } };
  const bu = { ...shared, uView: { value: new THREE.Vector2() }, uPitch: { value: kit.deg(V.pitch) }, uT: { value: 0 }, uSoft: { value: 0.01 }, uDetail: { value: 0 },
    uFlash: { value: 0 }, uVis: { value: V.vis }, uCloud: { value: V.cloud }, uSway: { value: 0 }, uWinB: { value: V.winB || 0 }, uLampSp: { value: lampSp }, uLampOff: { value: lampOff },
    uFlashP: { value: new THREE.Vector2() }, uSkyTop: { value: v3(V.skyTop) }, uSkyHor: { value: v3(V.skyHor) }, uHaze: { value: v3(V.haze) }, uFacade: { value: v3(V.facade) },
    uGround: { value: v3(V.ground) }, uLampC: { value: v3(K(V.lamps ? V.lamps[0][0] : 2400)) }, uWinWarm: { value: v3(K(3000)) }, uWinCool: { value: v3(K(5600)) },
    uCityGlow: { value: v3(V.cityGlow) }, uStreet: { value: v3(V.street || [0, 0, 0]) },
    uHouse: { value: new THREE.Vector4(2.2, 11.5, 3.1, 2.4) }, uPorch: { value: new THREE.Vector3(5.5, roadY + 2.3, -30) }, uPorchC: { value: v3(K(2400)) },
    uNeon: { value: Array.from({ length: 6 }, (_, i) => neon[i] ? new THREE.Vector4(neon[i].x, neon[i].y, neon[i].r, neon[i].s) : new THREE.Vector4(0, 0, 1, 0)) },
    uNeonC: { value: Array.from({ length: 6 }, (_, i) => v3(neon[i] ? neon[i].c : [0, 0, 0])) } };
  const pre = kit.GLSL.common + kit.GLSL.noise;
  const baseMat = bag.add(new THREE.ShaderMaterial({ uniforms: bu, vertexShader: BASE_VS, fragmentShader: pre + BASE_FS, defines: country ? { COUNTRY: 1 } : {},
    depthTest: false, depthWrite: false, blending: THREE.NoBlending }));
  const triGeo = bag.add(new THREE.BufferGeometry()); triGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const baseMesh = new THREE.Mesh(triGeo, baseMat); baseMesh.frustumCulled = false; baseMesh.renderOrder = 0;
  const su = { ...shared, uT: bu.uT, uAperture: { value: 10 }, uFocus: { value: GLASS_DIST }, uMinR: { value: 1 }, uVis: { value: V.vis * 1.3 }, uCarDens: { value: V.cars || 0.5 },
    uCat: { value: 0.22 }, uScreenH: { value: 100 }, uGain: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) } };
  const spriteMat = bag.add(new THREE.ShaderMaterial({ uniforms: su, vertexShader: pre + SPRITE_VS, fragmentShader: SPRITE_FS, transparent: true,
    depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  const sprites = new THREE.Mesh(sg, spriteMat); sprites.frustumCulled = false; sprites.renderOrder = 1;
  const outside = new THREE.Scene(); outside.add(baseMesh, sprites);
  const bgCam = new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 8000);

  const hf = kit.halfFloatOK(renderer);
  const rtOpt = { type: hf ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
  const rtBlur = bag.add(new THREE.WebGLRenderTarget(4, 4, rtOpt)), rtSharp = bag.add(new THREE.WebGLRenderTarget(4, 4, rtOpt));

  // ---------------------------------------------------------------------------------------------- the glass
  const micro = kit.cached(renderer, 'rain-window:micro:' + (quality === 'light' ? 512 : 1024), () => kit.bakeTexture(THREE, renderer, { width: quality === 'light' ? 512 : 1024, fragment: MICRO_FS }));
  const W4 = (x, y, z, w) => new THREE.Vector4(x, y, z, w);
  const wPh = [R.range(0, 6.28), R.range(0, 6.28), R.range(0, 6.28)];
  const gu = { tBlur: { value: rtBlur.texture }, tSharp: { value: rtSharp.texture }, tMicro: { value: micro }, uRes: { value: new THREE.Vector2(1, 1) }, uCam: { value: new THREE.Vector2() },
    uLampUV: { value: new THREE.Vector2(0.84, 0.36) }, uLampDir: { value: new THREE.Vector2(0.55, 0.6).normalize() }, uAspect: { value: 16 / 9 }, uOS: { value: OS }, uGlassH: { value: 20 },
    uPix: { value: 0.05 }, uT: { value: 0 }, uRain: { value: 0.5 }, uRun: { value: 0.5 }, uMist: { value: 0.3 }, uSharpH: { value: 100 }, uBlurH: { value: 100 }, uSeed: { value: seed % 97 },
    uWet: { value: V.wet }, uFlash: { value: 0 }, uLampR: { value: 0.16 }, uSpec: { value: V.spec },
    uW: { value: W4(0.58, 0.24, wPh[0], wPh[1]) },
    uRA: { value: W4(2.6, 0.2, 0.36, 2.4) }, uRA2: { value: W4(10, 27, V.run * 0.85, 11 + (seed % 50)) },
    uRB: { value: W4(1.35, 0.08, 0.14, 1.3) }, uRB2: { value: W4(8, 22, V.run * 0.6, 37 + (seed % 50)) },
    uLamp: { value: v3(V.lamp) }, uRoom: { value: v3(V.room) }, uCandle: { value: v3(V.candle) } };
  const defs = {}; if (Qs.run2) defs.RUN2 = 1; if (Qs.beadC) defs.BEADC = 1;
  const glass = bag.add(kit.createPass(THREE, { fragment: GLASS_FS, uniforms: gu, defines: defs }));

  // ---------------------------------------------------------------------------------------------- post
  const post = bag.add(kit.createPost(THREE, renderer, { width, height, pixelRatio, quality, tonemap: 'aces', dof: false, rays: false, msaa: 0, dirt: true, ca: quality !== 'light' }));
  Object.assign(post.grade, V.grade, { vignette: 0.42, aberration: 0.001, dirt: 0.08, grainSize: 1.5 });
  post.grade.bloom = { strength: V.bloom, threshold: 0, knee: 0.5, radius: 1 };

  let Wp = 1, Hp = 1;
  function resize(w, h, pr = 1) {
    Wp = Math.max(1, Math.round(w * pr)); Hp = Math.max(1, Math.round(h * pr));
    rtBlur.setSize(Math.max(8, Math.round(Wp * Qs.bg * OS)), Math.max(8, Math.round(Hp * Qs.bg * OS)));
    rtSharp.setSize(Math.max(8, Math.round(Wp * Qs.sharp * OS)), Math.max(8, Math.round(Hp * Qs.sharp * OS)));
    post.resize(w, h, pr);
  }
  resize(width, height, pixelRatio);

  // lightning: where in the clouds this strike is (same strike id as kit.lightning)
  function flashPos(t, f) {
    const b = f.big || 0; if (b < 0.02) return [0, 0];
    const age = -Math.log(Math.max(b, 1e-4)) * 0.5, strike = Math.floor((t - age) * 4);
    return [kit.hash01(seed, strike, 11) * 1.6 - 0.8, 0.25 + kit.hash01(seed, strike, 12) * 0.6];
  }

  function render(t, f = {}) {
    const asp = Wp / Hp, a = amount;
    const energy = f.energy || 0;
    // the camera: a slow slider move along the pane and a gentle push in, with a breath of hand-held drift
    const fov = kit.aspectFov(V.fov, asp, 0.5) * (1 - 0.09 * kit.pingpong(t + 40, 230));
    const tanH = Math.tan(fov * Math.PI / 360);
    const br = 0.0012 * (0.4 + a * (f.slow || 0));
    const cx = 0.16 * Math.sin(t / 149 + seed) + 0.06 * Math.sin(t / 61 + 2.1 * seed) + br * Math.sin(t * 0.83 + 1.3);
    const cy = 0.025 * Math.sin(t / 113 + 0.7 * seed) + br * Math.sin(t * 0.61 + 4.1);
    bgCam.fov = 2 * Math.atan(tanH * OS) * 180 / Math.PI; bgCam.aspect = asp;
    bgCam.position.set(cx, cy, 0); bgCam.rotation.set(kit.deg(V.pitch) + 0.004 * Math.sin(t / 89), 0, 0); bgCam.updateProjectionMatrix(); bgCam.updateMatrixWorld();
    shared.uCamP.value.set(cx, cy, 0);
    bu.uView.value.set(tanH * OS * asp, tanH * OS); bu.uPitch.value = bgCam.rotation.x; bu.uT.value = t;

    // weather over the song, audio on top (subtle)
    const w = kit.clamp(0.58 + 0.24 * Math.sin(t / 97 + wPh[0]) + 0.15 * Math.sin(t / 163 + wPh[1]), 0.1, 1);
    gu.uRain.value = V.rain * (0.35 + 0.65 * w) * (0.85 + 0.45 * a * kit.soft(energy, 0.5));
    gu.uMist.value = V.mist * (0.75 + 0.25 * Math.sin(t / 131 + wPh[2]));
    su.uCarDens.value = (V.cars || 0.5) * (0.8 + 0.2 * Math.sin(t / 120 + 1));
    bu.uSway.value = (V.sway || 0) * (0.7 + 0.3 * Math.sin(t / 53) + 0.5 * a * energy);
    const fl = kit.lightning(t, f, seed) * a * V.lightning;
    const fp = flashPos(t, f);
    bu.uFlash.value = fl * 0.4; bu.uFlashP.value.set(fp[0] + cx * 0.001, fp[1]);

    // focus breathes very slightly (the bokeh size), the lamp in the room flickers like a candle
    const shortSide = Math.min(Wp, Hp);
    const ap = 0.05 * shortSide * (1 + 0.04 * Math.sin(t / 71 + 0.4));
    const k = kit.flicker(t, 11, { speed: 1.3, depth: 0.12 }) * (1 + a * (0.08 * (f.level || 0) + 0.12 * (f.accent || 0)));
    gu.uLamp.value.set(V.lamp[0] * k, V.lamp[1] * k, V.lamp[2] * k);
    const kc = kit.flicker(t, 23, { speed: 1.7, depth: 0.22 });
    gu.uCandle.value.set(V.candle[0] * kc, V.candle[1] * kc, V.candle[2] * kc);
    gu.uRoom.value.set(V.room[0] + fl * 0.004, V.room[1] + fl * 0.0042, V.room[2] + fl * 0.005);

    const ac = renderer.autoClear; renderer.autoClear = false;
    // outside, as the lens sees it (defocused)
    const sB = Qs.bg;
    bu.uSoft.value = (ap / Hp) * 2 / OS; bu.uDetail.value = 0;
    su.uAperture.value = ap * sB; su.uMinR.value = 1; su.uRes.value.set(rtBlur.width, rtBlur.height); su.uScreenH.value = rtBlur.height / OS;
    renderer.setRenderTarget(rtBlur); renderer.render(outside, bgCam);
    // outside, as each drop images it (sharp)
    bu.uSoft.value = 3 / rtSharp.height; bu.uDetail.value = 1;
    su.uAperture.value = 0; su.uMinR.value = 0.85; su.uRes.value.set(rtSharp.width, rtSharp.height); su.uScreenH.value = rtSharp.height / OS;
    renderer.setRenderTarget(rtSharp); renderer.render(outside, bgCam);

    // the glass
    const glassH = 2 * GLASS_DIST * tanH * 100;
    gu.uRes.value.set(Wp, Hp); gu.uAspect.value = asp; gu.uGlassH.value = glassH; gu.uPix.value = glassH / Hp;
    gu.uCam.value.set(cx * 100, cy * 100); gu.uT.value = t; gu.uSharpH.value = rtSharp.height; gu.uBlurH.value = rtBlur.height; gu.uFlash.value = fl;
    gu.uLampUV.value.set(asp >= 1 ? 0.86 : 0.8, asp >= 1 ? 0.34 : 0.3);
    post.grade.bloom.strength = V.bloom * (1 + 0.25 * a * (f.bass || 0));
    post.grade.exposure = V.grade.exposure * (1 + 0.03 * Math.sin(t / 83));
    post.begin();
    glass.render(renderer, post.target);
    post.end(null, t);
    renderer.autoClear = ac;
  }

  return {
    render, resize,
    setIntensity(v) { amount = kit.clamp(v); },
    dispose() { bag.dispose(); outside.clear(); },
  };
}
