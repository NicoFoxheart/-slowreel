// hanok-rain-fx.js - textures, material patches and two small GPU effects for the hanok scene (scene-local helper of
// hanok-rain.js): baked giwa tile / granite paving / timber / lime plaster / hanji lattice textures; a roof patch (wet
// sheen, snow in the channels, fallen leaves), a paper-door glow patch, an emissive-by-vertex-colour patch; eave drips
// (water falling from every amsaw channel end in beaded strings, with splash rings where it lands) and distant city
// lights. All stateless in t.
import * as kit from './kit.js?v=9b';

// ------------------------------------------------------------------------------------------------ bakes (linear albedo)
// giwa: 4 x 4 tiles per texture. u: one row period (sumaksae centred at 0.5, amsaw channel at 0/1). v: one course.
export const TILE_FS = `vec4 bake(vec2 uv) {
  vec2 g = uv * 4.0, c = floor(g), f = fract(g);
  float hs = kHash12(c + 0.37), hb = kHash12(c * 1.7 + 3.3), hc = kHash12(c * 3.1 + 9.2);
  float du = (f.x - 0.5) / 0.23, sumM = smoothstep(1.03, 0.9, abs(du));
  float sumH = sqrt(max(0.0, 1.0 - du * du));
  float chan = 0.5 - 0.5 * cos(6.2831853 * f.x);
  float lap = (1.0 - f.y) * smoothstep(0.0, 0.035, f.y);                   // each course laps onto the one below
  float sLap = (1.0 - f.y) * smoothstep(0.0, 0.05, f.y);
  float n = kFbm2p(uv * 24.0, vec2(24.0), 4), m = kFbm2p(uv * 90.0, vec2(90.0), 3);
  float h = mix(chan * 0.28 + lap * 0.12, 0.55 + 0.35 * sumH + sLap * 0.1, sumM) + 0.03 * n + 0.012 * m;
  vec3 clay = vec3(0.043, 0.045, 0.05) * (0.72 + 0.55 * hs);
  vec3 sumC = vec3(0.05, 0.051, 0.056) * (0.75 + 0.5 * hb);
  vec3 col = mix(clay, sumC, sumM);
  // grime in the channels, crevice between sumak and amsaw, lime/lichen speckle
  col *= mix(1.0, 0.62, (1.0 - chan) * (1.0 - sumM) * 0.8);
  col *= mix(1.0, 0.45, smoothstep(0.85, 1.0, abs(du)) * smoothstep(1.15, 1.0, abs(du)));
  col *= mix(1.0, 0.55, smoothstep(0.06, 0.0, f.y));
  float lich = smoothstep(0.62, 0.78, kFbm2p(uv * 9.0 + hc, vec2(9.0), 5)) * 0.6;
  col = mix(col, vec3(0.085, 0.09, 0.07), lich * (0.4 + 0.6 * m));
  col *= 0.9 + 0.2 * n;
  return vec4(col, h);
}`;
export const TILE_ORM_FS = `uniform sampler2D tA; vec4 bake(vec2 uv) {
  vec4 a = texture2D(tA, uv); vec2 f = fract(uv * 4.0);
  float chan = 0.5 - 0.5 * cos(6.2831853 * f.x), du = abs(f.x - 0.5) / 0.23;
  float ao = mix(0.55, 1.0, smoothstep(0.0, 0.6, a.a)) * mix(0.6, 1.0, smoothstep(0.0, 0.08, f.y));
  float rough = 0.5 + 0.25 * kFbm2p(uv * 30.0, vec2(30.0), 3);
  return vec4(ao, rough, 0.0, 1.0);
}`;
// granite paving (baksuk-like slabs, irregular cells ~0.7 m), 6 m per texture
export const PAVE_FS = `
vec3 cellP(vec2 p, float per) { vec2 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0; vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 o = vec2(float(x), float(y)); vec2 cc = mod(i + o, per);
    vec2 r = o + 0.15 + 0.7 * kHash22(cc) - f; r.x *= 0.82; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = cc; } else if (d < d2) d2 = d; }
  return vec3(sqrt(d2) - sqrt(d1), kHash12(id), kHash12(id + 7.7)); }
vec4 bake(vec2 uv) {
  vec3 c = cellP(uv * 9.0 + 0.08 * vec2(kFbmS2(uv * 30.0, 3), kFbmS2(uv * 30.0 + 5.0, 3)), 9.0);
  float joint = smoothstep(0.025, 0.09, c.x);
  float n = kFbm2p(uv * 40.0, vec2(40.0), 4), sp = kHash12(floor(uv * 1024.0)), sp2 = kHash12(floor(uv * 1024.0) + 3.1);
  vec3 g = vec3(0.30, 0.29, 0.275) * (0.78 + 0.4 * c.y) * (0.9 + 0.18 * n);
  g = mix(g, vec3(0.06, 0.06, 0.06), step(0.9, sp) * 0.7);          // biotite flecks
  g = mix(g, vec3(0.5, 0.49, 0.47), step(0.93, sp2) * 0.5);         // feldspar flecks
  g *= mix(1.0, 0.75, smoothstep(0.55, 0.8, kFbm2p(uv * 14.0 + c.z * 3.0, vec2(14.0), 4)) * c.z);   // weathering stains
  vec3 col = mix(vec3(0.035, 0.032, 0.026), g, joint);
  float h = joint * (0.75 + 0.15 * n + 0.1 * c.y) + 0.04 * kFbm2p(uv * 120.0, vec2(120.0), 2);
  return vec4(col, h);
}`;
export const PAVE_ORM_FS = `uniform sampler2D tA; vec4 bake(vec2 uv) { vec4 a = texture2D(tA, uv); float j = smoothstep(0.3, 0.7, a.a);
  return vec4(mix(0.5, 1.0, j), mix(0.95, 0.62 + 0.25 * kFbm2p(uv * 50.0, vec2(50.0), 3), j), 0.0, 1.0); }`;
// cut granite for the platform / steps / footings
export const GRANITE_FS = `vec4 bake(vec2 uv) {
  float n = kFbm2p(uv * 10.0, vec2(10.0), 5), sp = kHash12(floor(uv * 512.0)), sp2 = kHash12(floor(uv * 512.0) + 1.7);
  vec3 g = vec3(0.32, 0.31, 0.295) * (0.85 + 0.25 * n);
  g = mix(g, vec3(0.07), step(0.88, sp) * 0.6); g = mix(g, vec3(0.52, 0.51, 0.49), step(0.92, sp2) * 0.5);
  float chisel = kFbm2p(uv * vec2(60.0, 8.0), vec2(60.0, 8.0), 3);
  g *= mix(1.0, 0.7, smoothstep(0.6, 0.85, kFbm2p(uv * 4.0, vec2(4.0), 5)));    // dark wet staining
  return vec4(g, 0.5 * n + 0.3 * chisel + 0.2 * sp);
}`;
// weathered dark timber (pine darkened with oil and age); grain along v. 1 m per texture.
export const WOOD_FS = `vec4 bake(vec2 uv) {
  float x = uv.x + 0.04 * kFbmS2(vec2(uv.x * 3.0, uv.y * 0.6), 4);
  float rings = sin((x * 46.0 + 3.0 * kFbmS2(vec2(uv.x * 6.0, uv.y * 1.5), 4)) * 3.14159);
  float grain = smoothstep(0.3, 1.0, abs(rings));
  float fib = kFbm2p(vec2(uv.x * 160.0, uv.y * 6.0), vec2(160.0, 6.0), 3);
  vec3 a = vec3(0.075, 0.048, 0.03), b = vec3(0.12, 0.08, 0.052);
  vec3 col = mix(a, b, grain * 0.6 + fib * 0.4) * (0.85 + 0.3 * kFbm2p(uv * vec2(3.0, 1.0), vec2(3.0, 1.0), 4));
  float crack = smoothstep(0.985, 1.0, kValue2(vec2(uv.x * 40.0, uv.y * 2.0)) ) * 0.6;
  col *= 1.0 - crack;
  return vec4(col, grain * 0.3 + fib * 0.6 - crack);
}`;
// lime plaster (warm white, slightly uneven, rain stains streaking down from above). 1 m per texture.
export const PLASTER_FS = `vec4 bake(vec2 uv) {
  float n = kFbm2p(uv * 5.0, vec2(5.0), 6), s = kFbm2p(uv * vec2(14.0, 1.5), vec2(14.0, 1.0), 4), m = kFbm2p(uv * 60.0, vec2(60.0), 3);
  vec3 c = mix(vec3(0.5, 0.47, 0.42), vec3(0.66, 0.63, 0.57), n) * (0.92 + 0.1 * m);
  c *= mix(1.0, 0.72, smoothstep(0.55, 0.85, s) * 0.8);
  return vec4(c, n * 0.6 + m * 0.4);
}`;
// hanji lattice (ddisal pattern). rgb albedo (wood bars / cream paper), a = paper transmission (0 on the wood).
export const DOOR_FS = `vec4 bake(vec2 uv) {
  float fx = 0.045, fy = 0.03;                                     // frame
  float frame = 1.0 - step(fx, uv.x) * step(uv.x, 1.0 - fx) * step(fy, uv.y) * step(uv.y, 1.0 - fy);
  float panel = 1.0 - step(0.13, uv.y);                            // bottom board (gungpan)
  float rail = step(0.13, uv.y) * step(uv.y, 0.16);
  float vx = abs(fract(uv.x * 12.0) - 0.5), vbar = step(0.42, vx);
  float hb = 0.0; for (int b = 0; b < 3; b++) { float c = b == 0 ? 0.29 : b == 1 ? 0.57 : 0.87;
    for (int k = 0; k < 4; k++) { float y = c - 0.045 + float(k) * 0.03; hb = max(hb, 1.0 - step(0.0045, abs(uv.y - y))); } }
  float wood = clamp(frame + panel + rail + vbar + hb, 0.0, 1.0);
  float fib = kFbm2p(uv * vec2(28.0, 50.0), vec2(28.0, 50.0), 4), fib2 = kValue2(uv * vec2(300.0, 90.0));
  vec3 paper = vec3(0.62, 0.58, 0.5) * (0.92 + 0.12 * fib);
  vec3 woodC = vec3(0.07, 0.045, 0.028) * (0.85 + 0.3 * kFbm2p(uv * vec2(40.0, 3.0), vec2(40.0, 3.0), 3));
  float trans = (1.0 - wood) * (0.82 + 0.25 * fib + 0.06 * fib2);
  return vec4(mix(paper, woodC, wood), trans);
}`;

export function bakeAll(THREE, renderer, quality) {
  const big = quality !== 'light', S = big ? 1024 : 512, S2 = big ? 512 : 256, u = quality === 'ultra';
  const C = (k, f) => kit.cached(renderer, `hanok:${k}:${S}`, f);
  const tile = C('tile', () => kit.bakeTexture(THREE, renderer, { width: u ? 1024 : 512, fragment: TILE_FS }));
  const tileN = C('tileN', () => kit.normalMapFromHeight(THREE, renderer, tile, { strength: u ? 24 : 12, channel: 'a' }));
  const tileO = C('tileO', () => kit.bakeTexture(THREE, renderer, { width: 256, fragment: TILE_ORM_FS, uniforms: { tA: { value: tile } } }));
  const pave = C('pave', () => kit.bakeTexture(THREE, renderer, { width: S, fragment: PAVE_FS }));
  const paveN = C('paveN', () => kit.normalMapFromHeight(THREE, renderer, pave, { strength: big ? 10 : 6, channel: 'a' }));
  const paveO = C('paveO', () => kit.bakeTexture(THREE, renderer, { width: S2, fragment: PAVE_ORM_FS, uniforms: { tA: { value: pave } } }));
  const granite = C('granite', () => kit.bakeTexture(THREE, renderer, { width: S2, fragment: GRANITE_FS }));
  const graniteN = C('graniteN', () => kit.normalMapFromHeight(THREE, renderer, granite, { strength: 3, channel: 'a' }));
  const wood = C('wood', () => kit.bakeTexture(THREE, renderer, { width: S2, fragment: WOOD_FS }));
  const woodN = C('woodN', () => kit.normalMapFromHeight(THREE, renderer, wood, { strength: 2, channel: 'a' }));
  const plaster = C('plaster', () => kit.bakeTexture(THREE, renderer, { width: S2, fragment: PLASTER_FS }));
  const door = C('door', () => kit.bakeTexture(THREE, renderer, { width: S2, height: big ? 1024 : 512, fragment: DOOR_FS, wrap: 'clamp' }));
  return { tile, tileN, tileO, pave, paveN, paveO, granite, graniteN, wood, woodN, plaster, door };
}

// ------------------------------------------------------------------------------------------------ material patches
/** world position / normal varyings + uniforms for the custom bits below (chainable, instancing-safe) */
function chain(material, key, fn) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (sh, r) => { prev?.call(material, sh, r); fn(sh); };
  material.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|' + key;
  material.needsUpdate = true;
  return material;
}
const WORLD_VS = (sh) => {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHW; varying vec3 vHN;')
    .replace('#include <project_vertex>', `#include <project_vertex>
    { vec4 hw = vec4(transformed, 1.0); vec3 hn = objectNormal;
    #ifdef USE_INSTANCING
      hw = instanceMatrix * hw; hn = mat3(instanceMatrix) * hn;
    #endif
      vHW = (modelMatrix * hw).xyz; vHN = normalize(mat3(modelMatrix) * hn); }`);
};
/** roof / ridge / ground weather: wetness (darker, glossier), snow (in channels and on flat faces), fallen leaves */
export function patchWeather(material, U, { leaves = true, ground = false } = {}) {
  return chain(material, 'hanokwx' + (leaves ? 'l' : '') + (ground ? 'g' : ''), (sh) => {
    Object.assign(sh.uniforms, U);
    WORLD_VS(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vHW; varying vec3 vHN; uniform float uWet, uSnow, uLeaves;
      ${kit.GLSL.common}${kit.GLSL.noise}
      float hxSnow; float hxLeaf; vec3 hxLeafC;
      vec2 hxLeafAt(vec2 p, float scale, out vec3 lc) {          // maple leaves scattered in cells: mask, edge
        vec2 g = p / scale, i = floor(g), f = fract(g) - 0.5; vec4 h = kHash42(i);
        lc = vec3(0.0);
        float a = h.y * 6.2831; float pile = kValue2(p * 0.35 + 3.0); if (h.x > uLeaves * (0.3 + 1.7 * pile * pile)) return vec2(0.0); vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * (f - (h.zw - 0.5) * 0.4);
        float r = length(q) / (0.28 + 0.06 * h.z), th = atan(q.y, q.x);
        float lobes = 0.62 + 0.38 * pow(abs(cos(th * 2.5)), 0.6);  // five-lobed outline
        float m = smoothstep(lobes, lobes - 0.12, r);
        lc = mix(vec3(0.42, 0.035, 0.012), vec3(0.5, 0.16, 0.012), h.z); lc = mix(lc, vec3(0.45, 0.3, 0.03), step(0.8, h.w));
        return vec2(m, h.w);
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float up = clamp(vHN.y, 0.0, 1.0);
        float n = kValue2(vHW.xz * 3.1) * 0.6 + kValue2(vHW.xz * 11.0) * 0.4;
        ${ground ? 'float cav = 0.0;' : 'float cav = 1.0 - smoothstep(0.25, 0.75, diffuseColor.r * 0.0 + 0.5);'}
        hxSnow = uSnow > 0.0 ? smoothstep(0.35, 0.75, up) * smoothstep(1.0 - uSnow, 1.0 - uSnow + 0.25, n * 0.7 + up * 0.3 + 0.15) : 0.0;
        diffuseColor.rgb *= mix(1.0, 0.55, uWet * (1.0 - hxSnow));
        hxLeaf = 0.0;
        ${leaves ? `if (uLeaves > 0.0 && up > 0.5) { vec3 lc; vec2 L = hxLeafAt(vHW.xz, ${ground ? '0.3' : '0.5'}, lc); vec3 lc2; vec2 L2 = hxLeafAt(vHW.xz + 0.37, ${ground ? '0.23' : '0.4'}, lc2);
          hxLeaf = max(L.x, L2.x); hxLeafC = L.x > L2.x ? lc : lc2; diffuseColor.rgb = mix(diffuseColor.rgb, hxLeafC * mix(1.0, 0.6, uWet), hxLeaf * (1.0 - hxSnow)); }` : ''}
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.8, 0.84), hxSnow);
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.42, uWet); roughnessFactor = mix(roughnessFactor, 0.75, hxSnow); roughnessFactor = mix(roughnessFactor, 0.55, hxLeaf);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, normalize((viewMatrix * vec4(vHN, 0.0)).xyz), hxSnow * 0.85 + hxLeaf * 0.6));`);
  });
}
/** paper panels: emissive from the door texture's alpha x per-room glow (aAux = room index + variation) */
export function patchPaper(material, U) {
  return chain(material, 'hanokpaper', (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAux; varying float vAux; varying vec2 vPUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAux = aAux; vPUv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAux; varying vec2 vPUv; uniform float uRoom[8]; uniform vec3 uPaperCol;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        int ri = int(floor(vAux)); float g = 0.0;
        for (int i = 0; i < 8; i++) if (i == ri) g = uRoom[i];
        float tr = texture2D(map, vMapUv).a;
        // a lamp low in the room: brighter in the lower middle of each panel group
        float lamp = 0.75 + 0.45 * exp(-pow((vPUv.y - 0.38) * 2.2, 2.0)) * (0.85 + 0.3 * fract(vAux * 7.0));
        totalEmissiveRadiance = uPaperCol * tr * g * lamp;
      }`);
  });
}
/** emissive = emissive colour x vertex colour (silk lanterns) */
export function patchVertexEmissive(material) {
  return chain(material, 'hanokvem', (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.rgb;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vec3(0.04) * max(vColor.r, 0.3);');
  });
}

// ------------------------------------------------------------------------------------------------ eave drips
const DRIP_VS = `
attribute vec4 aO; attribute vec4 aR;
uniform float uCyc, uRate, uShutter, uWidth, uPx, uNear, uG, uDensity; uniform vec2 uRes; uniform vec3 uWind;
varying vec2 vQ; varying float vA; varying vec3 vW; varying float vSplash; varying float vAge;
#define KILL { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vA = 0.0; return; }
void main() {
  if (aR.z > uDensity) KILL
  float rate = uRate * aO.w;
  float cyc = uCyc * aO.w + aR.x;
  float age = (fract(cyc) + aR.y) / max(rate, 0.05);
  float h = max(aO.y - aR.w, 0.2), tf = sqrt(2.0 * h / uG);
  vec3 drift = uWind * 0.12;
  if (age < tf) {
    vec3 head = vec3(aO.x + drift.x * age, aO.y - 0.5 * uG * age * age, aO.z + drift.z * age);
    vec3 vel = vec3(drift.x, -uG * age, drift.z);
    vec3 tail = head - vel * uShutter + vec3(0.0, 0.014, 0.0);
    vec4 ch = projectionMatrix * viewMatrix * vec4(head, 1.0), ct = projectionMatrix * viewMatrix * vec4(tail, 1.0);
    if (ch.w < uNear || ct.w < uNear) KILL
    vec2 sh = ch.xy / ch.w * uRes * 0.5, st = ct.xy / ct.w * uRes * 0.5;
    vec2 dir = sh - st; float len = length(dir); dir = len > 1e-3 ? dir / len : vec2(0.0, 1.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    float wpx = uWidth * uPx / ch.w, w = max(wpx, 1.1), energy = min(1.0, wpx / w * 1.8);
    float defocus = smoothstep(2.0, 0.4, ch.w); w *= 1.0 + defocus * 5.0; energy /= 1.0 + defocus * 6.0;
    vec4 c = mix(ct, ch, position.y);
    c.xy += (nrm * position.x * w * 0.5 + dir * (position.y - 0.5) * w) / (uRes * 0.5) * c.w;
    gl_Position = c; vQ = position.xy; vW = head; vSplash = 0.0; vAge = 0.0;
    vA = energy * (0.6 + 0.4 * aR.z) * smoothstep(0.03, 0.16, age) * kFogT(head, cameraPosition);
  } else {
    float a = (age - tf) / 0.42; if (a > 1.0) KILL
    vec3 p = vec3(aO.x + drift.x * tf, aR.w + 0.004, aO.z + drift.z * tf);
    float R = 0.02 + 0.11 * sqrt(a);
    vec3 wp = p + vec3(position.x * R, 0.0, (position.y * 2.0 - 1.0) * R);
    vec4 mv = viewMatrix * vec4(wp, 1.0); if (-mv.z < uNear) KILL
    gl_Position = projectionMatrix * mv; vQ = vec2(position.x, position.y * 2.0 - 1.0); vW = wp; vSplash = 1.0; vAge = a;
    vA = (1.0 - a) * smoothstep(1.5, 4.0, -mv.z) * kFogT(p, cameraPosition);
  }
}`;
const DRIP_FS = `
uniform vec3 uColor, uAmbient; uniform vec4 uLightPos[4]; uniform vec3 uLightCol[4]; uniform int uNumLights; uniform float uBrightness;
varying vec2 vQ; varying float vA; varying vec3 vW; varying float vSplash; varying float vAge;
vec3 kLit(vec3 w) { vec3 l = uAmbient; for (int i = 0; i < 4; i++) { if (i >= uNumLights) break; vec3 d = uLightPos[i].xyz - w; l += uLightCol[i] / (1.0 + dot(d, d) / (uLightPos[i].w * uLightPos[i].w)); } return l; }
void main() {
  float a;
  if (vSplash < 0.5) { float across = 1.0 - vQ.x * vQ.x; float along = smoothstep(0.0, 0.2, vQ.y) * smoothstep(1.0, 0.8, vQ.y); a = across * along * vA; }
  else { float r = length(vQ); float ring = exp(-pow((r - 0.86) / 0.07, 2.0)) + 0.35 * exp(-pow((r - 0.55) / 0.08, 2.0)) * (1.0 - vAge); a = ring * vA * 0.35; }
  gl_FragColor = vec4(uColor * kLit(vW) * uBrightness * a, 1.0);
}`;
export function createDrips(THREE, renderer, { origins, ground = 0, fog, seed = 1, quality = 'high' }) {
  const per = quality === 'light' ? 4 : 7, n = origins.length * per;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3)); g.setIndex([0, 1, 2, 2, 1, 3]);
  const O = new Float32Array(n * 4), R = new Float32Array(n * 4), r = kit.rng(kit.hashSeed('hanok-drips', seed));
  let k = 0;
  for (const o of origins) {
    const rate = 0.55 + 0.9 * r(), ph = r() * 10, act = r(), dy = -0.04 * r();
    for (let j = 0; j < per; j++) { O.set([o[0], o[1] + dy, o[2], rate], k * 4); R.set([ph, j, act, o[3] ?? ground], k * 4); k++; }
  }
  g.setAttribute('aO', new THREE.InstancedBufferAttribute(O, 4)); g.setAttribute('aR', new THREE.InstancedBufferAttribute(R, 4));
  g.instanceCount = n; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const U = { uCyc: { value: 0 }, uRate: { value: 2 }, uShutter: { value: 1 / 24 }, uWidth: { value: 0.007 }, uPx: { value: 500 }, uNear: { value: 0.15 }, uG: { value: 9.81 }, uDensity: { value: 1 },
    uRes: { value: new THREE.Vector2(1, 1) }, uWind: { value: new THREE.Vector3() }, uColor: { value: new THREE.Vector3(0.6, 0.66, 0.75) }, uAmbient: { value: new THREE.Vector3(0.5, 0.55, 0.65) },
    uLightPos: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -1000, 0, 1)) }, uLightCol: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, uNumLights: { value: 0 }, uBrightness: { value: 1 }, ...(fog || {}) };
  const m = new THREE.ShaderMaterial({ uniforms: U, vertexShader: kit.GLSL.common + kit.GLSL.noise + kit.GLSL.fog + DRIP_VS, fragmentShader: kit.GLSL.common + DRIP_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 12;
  const v2 = new THREE.Vector2();
  return {
    mesh, uniforms: U,
    update(t, camera, { cyc, rate, density, wind = [0, 0, 0], lights = [], ambient, brightness = 1 }) {
      U.uCyc.value = cyc; U.uRate.value = rate; U.uDensity.value = density; U.uWind.value.set(wind[0], wind[1], wind[2]); U.uBrightness.value = brightness;
      renderer.getDrawingBufferSize(v2); U.uRes.value.copy(v2); U.uPx.value = v2.y / (2 * Math.tan(camera.fov * Math.PI / 360));
      if (ambient) U.uAmbient.value.set(ambient[0], ambient[1], ambient[2]);
      U.uNumLights.value = Math.min(4, lights.length);
      lights.slice(0, 4).forEach((l, i) => { U.uLightPos.value[i].set(l.position.x, l.position.y, l.position.z, l.radius ?? 2); U.uLightCol.value[i].set(l.color.r, l.color.g, l.color.b).multiplyScalar(l.intensity); });
    },
    dispose() { g.dispose(); m.dispose(); },
  };
}

// ------------------------------------------------------------------------------------------------ distant city lights
const CITY_VS = `
attribute vec4 aP; attribute vec4 aC;
uniform vec2 uRes; uniform float uTime, uGain;
varying vec2 vQ; varying vec3 vC;
void main() {
  vec4 c = projectionMatrix * viewMatrix * vec4(aP.xyz, 1.0);
  float px = aP.w;
  c.xy += position.xy * px * 2.0 / uRes * c.w;
  gl_Position = c; vQ = position.xy;
  float tw = 0.85 + 0.15 * sin(uTime * (0.7 + aC.w * 2.0) + aC.w * 40.0) * sin(uTime * 0.31 + aC.w * 9.0);
  vC = aC.rgb * uGain * tw * kFogT(aP.xyz, cameraPosition);
}`;
const CITY_FS = `varying vec2 vQ; varying vec3 vC; void main() { float d = dot(vQ, vQ); if (d > 1.0) discard; gl_FragColor = vec4(vC * exp(-d * 5.0), 1.0); }`;
export function createCityLights(THREE, { points, fog }) {
  const n = points.length, g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3)); g.setIndex([0, 1, 2, 2, 1, 3]);
  const P = new Float32Array(n * 4), C = new Float32Array(n * 4);
  points.forEach((p, i) => { P.set([p.x, p.y, p.z, p.px], i * 4); C.set([p.c[0], p.c[1], p.c[2], p.tw], i * 4); });
  g.setAttribute('aP', new THREE.InstancedBufferAttribute(P, 4)); g.setAttribute('aC', new THREE.InstancedBufferAttribute(C, 4));
  g.instanceCount = n; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const U = { uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uGain: { value: 1 }, ...(fog || {}) };
  const m = new THREE.ShaderMaterial({ uniforms: U, vertexShader: kit.GLSL.common + kit.GLSL.noise + kit.GLSL.fog + CITY_VS, fragmentShader: CITY_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 5;
  return { mesh, uniforms: U, dispose() { g.dispose(); m.dispose(); } };
}
