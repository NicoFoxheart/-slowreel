// Apron surface (environment artist): light concrete in 5 m slabs (sealed joints, per-slab tone, grime, tyre and
// oil stains at each stand) with ICAO-style painted markings computed per stand: taxilane centreline, curved lead-in
// lines from both directions with black edging, nose-gear stop bar, stand numbers (glyph atlas), red equipment
// restraint lines, hatched equipment staging areas, hydrant pit covers, head-of-stand and rear airside service roads
// (edge lines + dashed centre), and warm floodlight pools from the masts at night. Stand-local coordinates:
// u = along the apron from the stand centreline, v = toward the runway from the stand point (aircraft origin v = -2).
import * as THREE from 'three';
import { ATM, NOISE_GLSL, atmos } from './sky.js';

export function apronMaterial(wet, glyphTex, P) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, depthWrite: false });
  m.userData.key = 'apronEnv';
  const U = { uWet: wet, uNight: ATM.uNight, uGlyph: { value: glyphTex }, uStandT: { value: P.standT }, uK: { value: new THREE.Vector2(P.k0, P.k1) } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aTw; varying vec3 vTw;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTw = aTw;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uWet, uNight, uStandT; uniform vec2 uK; uniform sampler2D uGlyph; varying vec3 vTw; float paintM = 0.0, poolM = 0.0;
${NOISE_GLSL}
float band(float x, float a, float b){ float w = fwidth(x) + 1e-4; float c = clamp(min(x - a, b - x)/w + 0.5, 0.0, 1.0); return min(c, max(b - a, 0.0)/w); }
float glyph(float idx, vec2 p){ if (idx < 0.0 || p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 0.0; return smoothstep(0.35, 0.65, texture2D(uGlyph, vec2((idx + 0.08 + p.x*0.84)/16.0, 0.04 + p.y*0.92)).r); }`)
      .replace('#include <map_fragment>', `{
  float t = vTw.x, s = vTw.y, st = vTw.z; vec2 P = vec2(s, t);
  float k = floor(s / st + 0.5), u = s - k * st, v = t - uStandT; float inS = step(uK.x - 0.5, k) * step(k, uK.y + 0.5);
  // concrete slabs
  vec2 sl = floor(P / 5.0); float sh = h12(sl + 3.7), n = vnoise(P * 0.4), n2 = vnoise(P * 0.035), n3 = vnoise(P * 2.3);
  vec3 base = vec3(0.6, 0.592, 0.565) * (0.87 + 0.11 * sh) * (0.9 + 0.12 * n) * (0.9 + 0.14 * n2) * (0.96 + 0.06 * n3);
  vec2 jf = abs(fract(P / 5.0 + 0.5) - 0.5) * 5.0; float jw = max(fwidth(P.x), fwidth(P.y)); float joint = 1.0 - smoothstep(0.025, 0.05 + jw, min(jf.x, jf.y));
  base *= 1.0 - 0.38 * joint * (0.7 + 0.3 * n3);
  float tyre = inS * (exp(-u * u / 0.9) * smoothstep(-26.0, -13.0, v) * smoothstep(60.0, 20.0, v) + exp(-pow(abs(u) - 3.8, 2.0) / 0.5) * smoothstep(-6.0, -1.0, v) * smoothstep(14.0, 3.0, v)) * (0.45 + 0.55 * vnoise(P * vec2(0.15, 1.8)));
  float oil = inS * smoothstep(0.55, 0.85, vnoise(P * 0.9 + 13.0)) * (exp(-(pow(abs(u) - 5.8, 2.0) + pow(v + 7.0, 2.0)) / 18.0) + exp(-(u * u + pow(v + 22.0, 2.0)) / 10.0));
  float grime = smoothstep(0.5, 0.9, vnoise(P * 0.09 + 5.0)) * 0.6 + smoothstep(0.6, 0.95, n3) * 0.15;
  base *= 1.0 - 0.3 * tyre - 0.45 * oil - 0.12 * grime;
  // markings
  float Y = 0.0, Wh = 0.0, Rd = 0.0, Bk = 0.0; const float vT = 70.0, Rr = 38.0;
  Y = max(Y, band(abs(v - vT), -1.0, 0.075));
  float lead = band(abs(u), -1.0, 0.075) * step(-16.6, v) * step(v, vT - Rr);
  for (int i = 0; i < 2; i++) { float sd = i == 0 ? -1.0 : 1.0; float d = abs(length(vec2(u, v) - vec2(sd * Rr, vT - Rr)) - Rr); lead = max(lead, band(d, -1.0, 0.075) * step(0.0, u * sd) * step(u * sd, Rr) * step(vT - Rr, v)); }
  Bk = max(Bk, inS * band(abs(u), 0.075, 0.2) * step(-16.6, v) * step(v, vT - Rr));
  Y = max(Y, inS * lead);
  Y = max(Y, inS * band(abs(v + 14.9), -1.0, 0.15) * step(abs(u), 2.6)); Bk = max(Bk, inS * band(abs(v + 14.9), 0.15, 0.3) * step(abs(u), 2.75));
  Y = max(Y, inS * band(abs(u), -1.0, 0.1) * band(v, -17.6, -14.9));
  // stand number on a black box on the lead-in line, upright for the pilot taxiing in
  float g = k - uK.x + 1.0, d1 = floor(g / 10.0), d2 = mod(g, 10.0); vec2 q = vec2(-u, -(v - 25.0)); float boxM = inS * step(abs(u), 3.1) * step(abs(v - 25.0), 2.9);
  float num = g < 9.5 ? glyph(d2, vec2((q.x + 1.2) / 2.4, (q.y + 2.3) / 4.6)) : max(glyph(d1, vec2((q.x + 2.55) / 2.4, (q.y + 2.3) / 4.6)), glyph(d2, vec2((q.x - 0.15) / 2.4, (q.y + 2.3) / 4.6)));
  Bk = max(Bk, boxM); Y = max(Y * (1.0 - boxM), boxM * num);
  // equipment restraint area (red) and hatched equipment staging areas between stands (white)
  Rd = max(Rd, inS * band(abs(abs(u) - 21.6), -1.0, 0.1) * step(-36.0, v) * step(v, 30.0)); Rd = max(Rd, inS * band(abs(v - 30.0), -1.0, 0.1) * step(abs(u), 21.6)); Rd = max(Rd, inS * band(abs(v + 36.0), -1.0, 0.1) * step(abs(u), 21.6) * step(3.0, abs(u)));
  float ea = step(24.5, abs(u)) * step(abs(u), 30.5) * step(-31.0, v) * step(v, -9.0);
  float eo = ea * (1.0 - step(24.65, abs(u)) * step(abs(u), 30.35) * step(-30.85, v) * step(v, -9.15)); float hatch = ea * band(abs(fract((abs(u) + v) / 2.4) - 0.5) * 2.4, -1.0, 0.12);
  Wh = max(Wh, inS * max(eo, hatch * 0.85));
  // service roads (rear v 36..44, head of stand v -49..-41): edge lines, dashed centre, darker wearing course
  float rr = step(36.0, v) * step(v, 44.0), rf = step(-49.0, v) * step(v, -41.0);
  base *= 1.0 - 0.12 * max(rr, rf) * (0.7 + 0.3 * n);
  float edges = band(abs(v - 36.15), -1.0, 0.075) + band(abs(v - 43.85), -1.0, 0.075) + band(abs(v + 41.15), -1.0, 0.075) + band(abs(v + 48.85), -1.0, 0.075);
  float dash = step(fract(s / 9.0), 0.33) * (band(abs(v - 40.0), -1.0, 0.07) + band(abs(v + 45.0), -1.0, 0.07));
  Wh = max(Wh, min(1.0, edges + dash));
  // hydrant pit covers
  for (int i = 0; i < 2; i++) { float sd = i == 0 ? -1.0 : 1.0; float pr = length(vec2(u - sd * 18.6, v + 2.4)); base = mix(base, vec3(0.28, 0.29, 0.3), inS * (1.0 - smoothstep(0.32, 0.36, pr))); base = mix(base, vec3(0.75), inS * band(pr, 0.36, 0.4)); }
  vec3 col = base; float wornP = 0.82 + 0.18 * n3;
  col = mix(col, vec3(0.05, 0.05, 0.05), Bk * 0.9); col = mix(col, vec3(0.9, 0.66, 0.08) * wornP, Y * 0.95); col = mix(col, vec3(0.92, 0.92, 0.9) * wornP, Wh * 0.9); col = mix(col, vec3(0.75, 0.1, 0.08) * wornP, Rd * 0.9);
  paintM = max(max(Y, Wh), max(Rd, Bk));
  diffuseColor.rgb = col * (1.0 - uWet * 0.3);
  float pd = length(vec2(32.5 - abs(u), v - 35.0)); poolM = uNight * (exp(-pd * pd / 1500.0) + 0.35 * exp(-pd * pd / 6000.0));
}`).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(0.9, 0.62, paintM), 0.12, uWet);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (uNight * 0.08 * vec3(1.0, 0.9, 0.75) + poolM * 0.95 * vec3(1.0, 0.84, 0.62));');
  };
  return atmos(m);
}
