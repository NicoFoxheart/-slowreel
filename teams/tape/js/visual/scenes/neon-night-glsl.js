// neon-night-glsl.js - shader code for the neon-night scene: baked-irradiance PBR patch (facades, wet asphalt with
// streaked planar reflections, props), sign faces (lightboxes, neon tubes, screens), halos, steam, the night sky.
import * as kit from './kit.js?v=9e';
const G = kit.GLSL;

// FogExp2 with a soft height falloff (low mist hugs the street) - same formula in every material.
export const FOG = /* glsl */`
uniform vec3 uFogCol; uniform float uFogDen, uFogH;
vec3 nnFog(vec3 col, vec3 wp, vec3 cam) {
  float d = length(wp - cam);
  float h = exp(-max(min(wp.y, cam.y) , 0.0) / uFogH) * 0.55 + 0.45;
  float f = 1.0 - exp(-d * d * uFogDen * uFogDen * h);
  return mix(col, uFogCol, f);
}`;
export const FLICK = /* glsl */`uniform float uFlick[8];`;

/**
 * Patch a MeshStandardMaterial: baked irradiance (attribute aIrr, + aFl = flicker-sign light rgb, flicker index),
 * our fog, and per kind: 'facade' (procedural walls / windows / shopfronts from aFuv, aBld, aBld2), 'ground' (wet
 * asphalt, puddles, ripples, mirror with vertical streak blur, painted markings), 'prop' (just the light).
 */
export function patchLit(THREE, mat, { kind = 'prop', U, mirror = null, taps = 7 }) {
  const isF = kind === 'facade', isG = kind === 'ground';
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    if (mirror) Object.assign(sh.uniforms, { uMirror: mirror.uniforms.uMirror, uMirrorMatrix: mirror.uniforms.uMirrorMatrix, uMirrorOn: mirror.uniforms.uMirrorOn });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec3 aIrr; attribute vec4 aFl; ${FLICK}
      varying vec3 vIrr; varying vec3 vWp; varying vec3 vNw;
      ${isF ? 'attribute vec2 aFuv; attribute vec4 aBld; attribute vec4 aBld2; varying vec2 vFuv; varying vec4 vBld; varying vec4 vBld2;' : ''}
      ${isG ? 'attribute float aSurf; varying float vSurf;' : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
      { vec4 kw = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        kw = instanceMatrix * kw;
      #endif
        vWp = (modelMatrix * kw).xyz; }
      #ifdef USE_INSTANCING
      vNw = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
      #else
      vNw = normalize(mat3(modelMatrix) * objectNormal);
      #endif
      vIrr = aIrr + aFl.rgb * (uFlick[int(aFl.w + 0.5)] - 1.0);
      ${isF ? 'vFuv = aFuv; vBld = aBld; vBld2 = aBld2;' : ''}
      ${isG ? 'vSurf = aSurf;' : ''}`);
    let fs = sh.fragmentShader.replace('#include <common>', `#include <common>
      ${G.common}${G.noise}${G.ripples}${FOG}
      uniform float uTime, uRain, uWet, uAmb; uniform vec3 uAmbCol;
      varying vec3 vIrr; varying vec3 vWp; varying vec3 vNw;
      ${isF ? 'varying vec2 vFuv; varying vec4 vBld; varying vec4 vBld2;' : ''}
      ${isG ? 'varying float vSurf;' : ''}
      ${mirror ? 'uniform sampler2D uMirror; uniform mat4 uMirrorMatrix; uniform float uMirrorOn;' : ''}
      ${isF ? FACADE_HEAD : ''}${isG ? GROUND_HEAD : ''}`);
    if (isF) fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
        FacadeOut fo = facade(vFuv, vBld, vBld2, diffuseColor.rgb);
        diffuseColor.rgb = fo.albedo;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = fo.rough;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = fo.metal;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), vNw) + 1e-5); vec3 Nb = normalize(vNw + T * fo.bump.x + vec3(0.0, 1.0, 0.0) * fo.bump.y);
          normal = normalize((viewMatrix * vec4(Nb, 0.0)).xyz); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += fo.emit;`);
    if (isG) fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
        GroundOut go = ground(vWp, vSurf);
        diffuseColor.rgb = go.albedo;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = go.rough;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(go.n, 0.0)).xyz);`);
    fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * (vIrr + uAmbCol * uAmb);`);
    if (isG && mirror) fs = fs.replace('#include <opaque_fragment>', `
        if (uMirrorOn > 0.5) {
          vec4 mc = uMirrorMatrix * vec4(vWp, 1.0); vec2 muv = mc.xy / mc.w + go.n.xz * vec2(0.03, 0.05);
          vec3 V = normalize(cameraPosition - vWp); float cosv = max(dot(go.n, V), 0.0);
          float F = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
          float len = mix(0.11, 0.004, go.pud) * (0.35 + 0.65 * smoothstep(0.05, 0.5, 1.0 - cosv));
          vec3 acc = vec3(0.0); float ws = 0.0;
          for (int i = 0; i < ${taps}; i++) {
            float o = (float(i) / float(${taps - 1}) - 0.5) * 2.0; float w = exp(-o * o * 2.2);
            float jit = kHash12(gl_FragCoord.xy + float(i) * 7.1) - 0.5;
            vec2 q = muv + vec2(o * len * 0.035 + jit * len * 0.012, (o + jit * 0.16) * len);
            acc += texture2D(uMirror, q).rgb * w; ws += w;
          }
          vec3 refl = acc / ws;
          float k = F * mix(0.55 * go.wet, 1.0, go.pud);
          outgoingLight = outgoingLight * (1.0 - k) + refl * k;
        }
        #include <opaque_fragment>`);
    fs = fs.replace('#include <fog_fragment>', 'gl_FragColor.rgb = nnFog(gl_FragColor.rgb, vWp, cameraPosition);');
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'nn-' + kind + taps + (mirror ? 'm' : '');
  mat.needsUpdate = true;
  return mat;
}

// ------------------------------------------------------------------------------------------ facades
// aBld: x seed, y style (0 brick, 1 tile, 2 painted concrete, 3 metal panel, 4 glass curtain), z floor height, w bay width
// aBld2: x building width, y ground-floor height, z shop type (0 lit store, 1 shutter, 2 door, 3 half shutter, 4 none) + 0.9 * lit-window ratio, w top of the last window row
const FACADE_HEAD = /* glsl */`
uniform vec3 uWinWarm, uWinCool, uShop; uniform float uWinI, uShopI; uniform sampler2D uPudTex;
float tn(vec2 p) { return texture2D(uPudTex, p).r; }
struct FacadeOut { vec3 albedo; float rough; float metal; vec2 bump; vec3 emit; };
float boxMask(vec2 p, vec2 a, vec2 b, float e) { vec2 s = smoothstep(a - e, a + e, p) * (1.0 - smoothstep(b - e, b + e, p)); return s.x * s.y; }
vec3 interior(vec2 cell, vec2 lp, float seed, float warm) {
  vec4 h = kHash42(cell + seed * 17.0);
  vec3 c = mix(uWinCool, uWinWarm, warm);
  float ceil = 0.55 + 0.45 * smoothstep(0.0, 1.0, lp.y);                          // ceiling light falls off downward
  float stuff = 0.7 + 0.3 * tn(lp * vec2(0.6, 0.3) + h.xy);
  float cur = h.z < 0.45 ? mix(0.35, 1.0, smoothstep(0.0, 0.25, lp.x) * smoothstep(1.0, 0.75, lp.x)) : 1.0;   // curtains at the sides
  float blinds = h.z > 0.8 ? 0.55 + 0.45 * step(0.35, fract(lp.y * 9.0)) : 1.0;                               // horizontal blinds
  return c * ceil * stuff * cur * blinds * (0.55 + 0.9 * h.w);
}
FacadeOut facade(vec2 fu, vec4 B, vec4 B2, vec3 wall) {
  FacadeOut o; o.metal = 0.0; o.bump = vec2(0.0); o.emit = vec3(0.0);
  float seed = B.x, style = B.y, fh = B.z, bw = B.w, W = B2.x, gH = B2.y, shop = floor(B2.z), litR = fract(B2.z) / 0.9, topY = B2.w;
  // --- wall material
  vec3 alb = wall; float rough = 0.88; float n = tn(fu * vec2(0.09, 0.045) + seed * 3.1);
  if (style < 0.5) {                                                              // brick, running bond
    vec2 bp = fu / vec2(0.235, 0.075); bp.x += 0.5 * mod(floor(bp.y), 2.0);
    vec2 bi = floor(bp), bf = fract(bp);
    float mort = 1.0 - boxMask(bf, vec2(0.05, 0.12), vec2(0.95, 0.88), 0.03);
    alb *= 0.75 + 0.45 * kHash12(bi + seed);
    alb = mix(alb, vec3(0.18, 0.17, 0.16), mort * 0.8); rough = mix(0.82, 0.95, mort);
    o.bump = vec2(0.0, (bf.y < 0.12 ? -1.0 : bf.y > 0.88 ? 1.0 : 0.0) * 0.25 * mort);
  } else if (style < 1.5) {                                                       // small ceramic tiles (glossy)
    vec2 tp = fu / 0.105; vec2 tf = fract(tp);
    float gr = 1.0 - boxMask(tf, vec2(0.06), vec2(0.94), 0.03);
    alb *= 0.9 + 0.15 * kHash12(floor(tp) + seed); alb = mix(alb, alb * 0.45, gr); rough = mix(0.28, 0.9, gr);
    o.bump = (tf - 0.5) * gr * 0.4;
  } else if (style < 2.5) {                                                       // painted concrete
    alb *= 0.8 + 0.35 * n; rough = 0.9;
  } else if (style < 3.5) {                                                       // ribbed metal panel
    float r = fract(fu.x / 0.21); alb *= 0.85 + 0.2 * n; rough = 0.5; o.metal = 0.45;
    o.bump = vec2((r < 0.15 ? -1.0 : r < 0.3 ? 1.0 : 0.0) * 0.35, 0.0);
  } else {                                                                        // glass curtain wall + spandrels (towers)
    vec2 g = fract(fu / vec2(1.5, fh)); float mull = 1.0 - boxMask(g, vec2(0.03, 0.05), vec2(0.97, 0.7), 0.01);
    alb = mix(vec3(0.015, 0.018, 0.022), vec3(0.08), mull); rough = mix(0.06, 0.4, mull); o.metal = mix(0.0, 0.8, mull);
  }
  // grime: vertical rain streaks, darker toward the street (splash zone)
  float streak = tn(vec2(fu.x * 0.9 + seed * 5.0, fu.y * 0.03)) * tn(vec2(fu.x * 0.27, fu.y * 0.11 + seed));
  alb *= 1.0 - 0.6 * smoothstep(0.2, 0.45, streak) - 0.25 * smoothstep(0.8, 0.0, fu.y);
  rough *= mix(1.0, 0.55, uWet * (0.5 + 0.5 * smoothstep(1.2, 0.0, fu.y)));      // rain-wet walls are glossier
  // --- upper floors: windows
  float fy = fu.y - gH;
  if (fy > 0.0 && style < 3.9) {
    float nb = max(1.0, floor((W - 0.6) / bw)), off = (W - nb * bw) * 0.5;
    float bx = (fu.x - off) / bw, bi = floor(bx), fl = floor(fy / fh);
    vec2 lp = vec2(fract(bx), fract(fy / fh));
    vec4 hb = kHash42(vec2(bi, seed * 13.0));
    bool col = bi >= 0.0 && bi < nb && hb.x > 0.12 && fu.y < topY;
    float ww = hb.y < 0.3 ? 0.36 : 0.62;                                         // narrow (bathroom) or wide windows
    vec2 a = vec2(0.5 - ww * 0.5, 0.3), b = vec2(0.5 + ww * 0.5, 0.82);
    float m = col ? boxMask(lp, a, b, 0.004) : 0.0;
    float frame = col ? boxMask(lp, a - vec2(0.025, 0.03), b + vec2(0.025, 0.015), 0.004) - m : 0.0;
    float sill = col ? boxMask(lp, vec2(a.x - 0.05, a.y - 0.06), vec2(b.x + 0.05, a.y - 0.025), 0.004) : 0.0;
    if (m > 0.0) {
      vec2 cell = vec2(bi, fl);
      vec4 h = kHash42(cell + seed * 7.3);
      float slot = floor(uTime / (80.0 + 160.0 * h.z) + h.w * 10.0);              // someone switches a light every few minutes
      float on = step(kHash12(cell * 1.7 + slot * 3.1 + seed), litR);
      vec2 wp = (lp - a) / (b - a);
      float warm = step(0.42, h.y);
      vec3 em = interior(cell, wp, seed, warm) * uWinI * on;
      float mull = boxMask(fract(wp * vec2(hb.y < 0.3 ? 1.0 : 2.0, 1.0)), vec2(0.03, 0.0), vec2(0.97, 1.0), 0.01);
      o.emit += em * mull * m;
      alb = mix(alb, vec3(0.01, 0.012, 0.014), m); rough = mix(rough, 0.04, m * mull);
    }
    alb = mix(alb, vec3(0.32, 0.33, 0.33), frame); rough = mix(rough, 0.35, frame);
    alb = mix(alb, alb * 0.6 + 0.12, sill);
    // floor slab line
    float slab = boxMask(vec2(0.5, fract(fy / fh) * fh), vec2(0.0, 0.0), vec2(1.0, 0.12), 0.01);
    alb *= 1.0 - 0.2 * slab;
  }
  // --- ground floor
  if (fy <= 0.0 && fu.x > 0.15 && fu.x < W - 0.15) {
    float yy = fu.y;
    if (shop < 0.5 || shop > 2.5 && shop < 3.5) {                                // lit glass storefront (or half shutter)
      float top = shop < 0.5 ? gH - 0.95 : 0.65;
      float gm = boxMask(vec2(fu.x, yy), vec2(0.35, 0.12), vec2(W - 0.35, top), 0.01);
      float mx = fract((fu.x - 0.35) / 1.25), mul = boxMask(vec2(mx, 0.5), vec2(0.025, 0.0), vec2(0.975, 1.0), 0.004);
      vec2 sp = vec2(fu.x, yy);
      float I0 = 0.35 + 0.65 * fract(seed * 13.7);
      float row = floor((yy - 0.15) / 0.38), ry = fract((yy - 0.15) / 0.38);
      vec2 pc = vec2(floor(fu.x / 0.065), row);
      vec4 ph = kHash42(pc + seed * 31.0);
      vec3 prod = mix(vec3(0.45), kHash33(vec3(pc, seed * 9.0)), 0.45) * (0.5 + 0.7 * ph.y);
      float pm = step(0.12, ry) * step(ry, 0.25 + 0.6 * ph.x) * step(0.25, ph.z);
      float lip = smoothstep(0.08, 0.0, ry);
      float occ = smoothstep(0.5, 0.56, tn(vec2(fu.x * 0.12 + seed, 0.3 + yy * 0.02)));      // fridges, posters, a person
      float ceilL = smoothstep(0.09, 0.0, abs(yy - (top - 0.18))) * step(0.35, fract(fu.x * 0.7 + seed));
      vec3 em = uShop * uShopI * I0 * ((0.15 + 0.45 * smoothstep(0.0, top, yy)) * mix(vec3(0.3), prod, pm) * (1.0 - 0.75 * occ) * (1.0 - 0.6 * lip) + ceilL * 2.5);
      if (fract(seed * 7.0) > 0.55) em *= vec3(1.0, 0.82, 0.62) * 0.8;             // warm cafe / restaurant instead of a convenience store
      if (shop > 2.5) em *= 0.35;
      o.emit += em * gm * mul;
      alb = mix(alb, vec3(0.02), gm); rough = mix(rough, 0.05, gm);
      if (shop > 2.5) {                                                          // the shutter above the light gap
        float sh = smoothstep(top - 0.01, top + 0.01, yy) * step(yy, gH - 0.9);
        float c = fract(yy / 0.075); alb = mix(alb, vec3(0.32, 0.34, 0.35) * (0.85 + 0.2 * kValue2(fu * vec2(3.0, 0.5))), sh);
        rough = mix(rough, 0.45, sh); o.metal = mix(o.metal, 0.7, sh); o.bump = mix(o.bump, vec2(0.0, (c < 0.5 ? 0.3 : -0.3)), sh);
      }
    } else if (shop < 1.5) {                                                     // closed roller shutter
      float sh = boxMask(vec2(fu.x, yy), vec2(0.3, 0.0), vec2(W - 0.3, gH - 0.9), 0.01);
      float c = fract(yy / 0.075);
      vec3 sc = vec3(0.3, 0.31, 0.32) * (0.8 + 0.3 * kValue2(fu * vec2(2.0, 0.4) + seed));
      alb = mix(alb, sc, sh); rough = mix(rough, 0.42, sh); o.metal = mix(o.metal, 0.75, sh);
      o.bump = mix(o.bump, vec2(0.0, (c < 0.5 ? 0.3 : -0.3)), sh);
    } else if (shop < 2.5) {                                                     // a door and a small lit window
      float dx = W * fract(seed * 3.7) * 0.6 + 0.5;
      float door = boxMask(vec2(fu.x, yy), vec2(dx, 0.0), vec2(dx + 1.0, 2.15), 0.01);
      alb = mix(alb, vec3(0.04, 0.035, 0.03), door); rough = mix(rough, 0.3, door); o.metal = mix(o.metal, 0.5, door);
      float wm = boxMask(vec2(fu.x, yy), vec2(dx + 1.5, 1.1), vec2(dx + 2.5, 2.0), 0.01);
      o.emit += uWinWarm * uWinI * 0.6 * wm * step(0.4, fract(seed * 11.0));
    }
  }
  o.albedo = alb; o.rough = clamp(rough, 0.03, 1.0);
  return o;
}`;

// ------------------------------------------------------------------------------------------ ground
// aSurf: 0 asphalt, 1 sidewalk pavers, 2 concrete gutter strip
const GROUND_HEAD = /* glsl */`
uniform sampler2D uAsph, uAsphN, uPudTex, uGlyph; uniform float uPud, uMarkMode, uHalfW;
uniform vec4 uWords[4];
struct GroundOut { vec3 albedo; float rough; vec3 n; float pud; float wet; };
GroundOut ground(vec3 wp, float surf) {
  GroundOut o;
  vec2 p = wp.xz;
  vec4 a = texture2D(uAsph, p / 3.0);
  vec3 alb = a.rgb; float h = a.a;
  vec3 nt = texture2D(uAsphN, p / 3.0).xyz * 2.0 - 1.0;
  float rough = 0.75;
  if (surf > 0.5 && surf < 1.5) {                                                // sidewalk pavers (Tokyo)
    vec2 q = p / vec2(0.3, 0.3); q.x += 0.5 * mod(floor(q.y), 2.0); vec2 f = fract(q);
    float fw = fwidth(q.x) + fwidth(q.y), far = smoothstep(0.06, 0.35, fw);        // fade the joints out before they alias
    float j = (1.0 - smoothstep(0.0, 0.04 + fw * 0.5, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)))) * (1.0 - far);
    alb = vec3(0.22, 0.21, 0.2) * mix(0.8 + 0.35 * kHash12(floor(q)), 0.93, far) * (1.0 - 0.6 * j) * (1.0 - 0.12 * far); h = 1.0 - j * 0.6; rough = 0.7;
    nt = vec3(0.0, 0.0, 1.0);
  } else if (surf > 1.5) {                                                        // concrete gutter + drain grates
    alb = vec3(0.2, 0.2, 0.19) * (0.85 + 0.3 * a.r * 6.0); rough = 0.8;
    float g = step(fract(p.y / 9.0), 0.07) * step(0.0, 1.0);
    float bars = step(0.5, fract(p.y * 30.0));
    alb = mix(alb, vec3(0.03) * (0.5 + bars), g); h = mix(h, 0.0, g * (1.0 - bars));
  }
  // painted markings (worn): edge lines / crosswalk / painted words
  float paint = 0.0; vec3 pcol = vec3(0.75, 0.74, 0.7);
  float wear = smoothstep(0.25, 0.7, texture2D(uAsph, p / 1.3 + 0.37).a + 0.25);
  if (uMarkMode < 0.5) {                                                          // Seoul alley: double yellow edge lines
    float e = abs(abs(p.x) - (uHalfW - 0.55));
    float yl = (1.0 - smoothstep(0.045, 0.055, abs(e - 0.0))) + (1.0 - smoothstep(0.045, 0.055, abs(e - 0.18)));
    yl *= step(abs(p.x), uHalfW - 0.2);
    if (yl > 0.0) { paint = yl; pcol = vec3(0.75, 0.52, 0.08); }
  } else if (uMarkMode < 1.5) {                                                   // crossing: zebra stripes on the 4 crosswalks + stop lines
    float zx = step(abs(p.y - 12.5), 2.0) * step(abs(p.x), 10.5) * step(0.5, fract(p.x / 1.0));
    float zz = step(abs(p.x - 12.5), 2.0) * step(abs(p.y), 10.5) * step(0.5, fract(p.y / 1.0));
    float zx2 = step(abs(p.y + 12.5), 2.0) * step(abs(p.x), 10.5) * step(0.5, fract(p.x / 1.0));
    float zz2 = step(abs(p.x + 12.5), 2.0) * step(abs(p.y), 10.5) * step(0.5, fract(p.y / 1.0));
    float lane = step(abs(p.x), 0.06) * step(15.0, abs(p.y)) * step(0.5, fract(p.y / 6.0)) + step(abs(p.y), 0.06) * step(15.0, abs(p.x)) * step(0.5, fract(p.x / 6.0));
    paint = clamp(zx + zz + zx2 + zz2 + lane, 0.0, 1.0) * step(surf, 0.5);
  } else {                                                                        // tunnel / highway lanes
    float l = step(abs(abs(p.x) - 1.8), 0.07) * step(0.45, fract(p.y / 12.0)) + step(abs(abs(p.x) - 5.2), 0.08);
    paint = l; pcol = mix(pcol, vec3(0.8, 0.6, 0.15), step(4.5, abs(p.x)));
  }
  for (int i = 0; i < 4; i++) {                                                   // painted words on the asphalt (3 glyph blocks, read from the camera side)
    vec4 w = uWords[i]; if (w.w <= 0.0) continue;
    vec2 q = (p - w.xy) / w.w; q = vec2(q.x + 0.5, -q.y);                           // one block = w.w metres wide, 1.4x longer (perspective-stretched like real markings)
    q.y /= 1.4;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 3.0) continue;
    float k = floor(q.y); float gid = floor(fract(sin(w.z * 13.1 + k * 7.3) * 4373.1) * 64.0);
    vec2 gu = (vec2(gid - 8.0 * floor(gid / 8.0), floor(gid / 8.0)) + vec2(q.x, fract(q.y))) / 8.0;
    paint = max(paint, smoothstep(0.1, 0.3, texture2D(uGlyph, gu).r));
  }
  paint *= wear * step(surf, 0.5);
  alb = mix(alb, pcol, paint * 0.85); rough = mix(rough, 0.55, paint);
  // water: wet film everywhere, puddles in the low spots (large-scale noise + texture height), rain ripples
  float pn = texture2D(uPudTex, p / 11.0).r * 0.75 + texture2D(uPudTex, p / 3.7 + 0.3).r * 0.25;
  float pud = smoothstep(uPud + 0.05, uPud - 0.04, pn + (h - 0.5) * 0.25) * step(surf, 0.5 + step(1.5, surf));
  pud = max(pud, smoothstep(0.65, 0.0, abs(abs(p.x) - (uHalfW - 0.35))) * step(uMarkMode, 0.5) * 0.85 * step(surf, 0.5));   // water collects along the alley gutters
  float wet = uWet;
  alb *= mix(1.0, 0.55, wet) * mix(1.0, 0.75, pud);
  rough = mix(rough, rough * 0.4, wet); rough = mix(rough, 0.02, pud);
  float dcam = length(cameraPosition.xz - p);
  vec2 rg = vec2(0.0);
  if (uRain > 0.0 && pud > 0.02 && dcam < 32.0) rg = dcam < 12.0 ? kRipples(p * 1.3, uTime, uRain, 2) : kRipples(p * 1.3, uTime, uRain, 1);
  float fp = length(fwidth(p)), detail = 1.0 - smoothstep(0.025, 0.11, fp);     // a pixel covers more than a few cm: calm the normals (no sparkle)
  vec3 n = normalize(vec3(nt.x * (1.0 - pud) * 0.8 * detail, 1.0, nt.y * (1.0 - pud) * 0.8 * detail));
  n = normalize(n + vec3(-rg.x, 0.0, -rg.y) * (0.25 + 0.75 * pud) * (0.3 + 0.7 * detail));
  o.albedo = alb; o.rough = rough; o.n = n; o.pud = pud; o.wet = wet;
  return o;
}`;

export const ASPHALT_FS = /* glsl */`vec4 bake(vec2 uv) {
  float n = kFbm2p(uv * 8.0, vec2(8.0), 5), m = kFbm2p(uv * 64.0, vec2(64.0), 3);
  vec2 w = kWorley2p(uv * 22.0, vec2(22.0)); float agg = smoothstep(0.25, 0.0, w.x);
  float patchy = smoothstep(0.55, 0.62, kFbm2p(uv * 3.0 + 4.0, vec2(3.0), 4));
  vec2 c = kWorley2p(uv * 4.0 + 1.3, vec2(4.0)); float crack = 1.0 - smoothstep(0.0, 0.025, c.y - c.x);
  crack *= smoothstep(0.45, 0.6, kFbm2p(uv * 6.0, vec2(6.0), 3));
  vec3 col = vec3(0.075, 0.074, 0.072) * (0.8 + 0.4 * n) * (0.85 + 0.3 * m);
  col += agg * vec3(0.05, 0.048, 0.045) * kHash12(floor(uv * 22.0 * 3.0));
  col = mix(col, col * vec3(0.7, 0.7, 0.72), patchy);
  col = mix(col, vec3(0.02), crack * 0.8);
  float height = 0.5 + 0.25 * m + 0.2 * agg - 0.4 * crack - 0.08 * patchy;
  return vec4(col, height);
}`;

// ------------------------------------------------------------------------------------------ signs
export const SIGN_VS = /* glsl */`
attribute vec4 iA; attribute vec4 iB; attribute vec4 iC;
varying vec2 vUv; varying vec3 vN; varying vec3 vWp; varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec2 vSize;
void main() {
  vUv = uv; vN = normal; vA = iA; vB = iB; vC = iC;
  vSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vWp = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
// iA: rgb background / tube colour, a = intensity. iB: x type (0 lightbox, 1 neon panel, 2 screen, 3 lightbox w/ white glyphs), y glyph seed, z glyph count (<0 horizontal), w flicker index.
// iC: rgb glyph colour, a = aux (neon: border tube on/off; screen: palette)
export const SIGN_FS = /* glsl */`
uniform sampler2D uGlyph; uniform float uTime, uGlow, uShimmer;
${FLICK}
varying vec2 vUv; varying vec3 vN; varying vec3 vWp; varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec2 vSize;
vec4 glyph(float gid, vec2 q) {
  gid = mod(gid, 64.0);
  vec2 cell = vec2(gid - 8.0 * floor(gid / 8.0), floor(gid / 8.0));
  return texture2D(uGlyph, (cell + vec2(q.x, 1.0 - q.y)) / 8.0);
}
void main() {
  float type = vB.x, n = vB.z; float I = vA.a * uFlick[int(vB.w + 0.5)] * uShimmer;
  vec3 col;
  bool face = abs(vN.z) > 0.5;
  vec2 uv = vUv;
  float vert = n > 0.0 ? 1.0 : 0.0; float cnt = abs(n);
  vec2 sz = vSize;
  if (!face && type < 3.5) {
    // edges: lightboxes leak a little light through their sides; neon boxes are painted metal
    float leak = type < 0.5 || (type > 2.5 && type < 3.5) ? 0.22 : 0.0;
    col = vA.rgb * I * leak + vec3(0.012);
  } else {
    // content area: inset frame, cells along the long axis
    vec2 m = vec2(0.06 * min(sz.x, sz.y)) / sz; vec2 c = (uv - m) / (1.0 - 2.0 * m);
    float inside = step(0.0, c.x) * step(c.x, 1.0) * step(0.0, c.y) * step(c.y, 1.0);
    float k = vert > 0.5 ? floor((1.0 - c.y) * cnt) : floor(c.x * cnt);
    vec2 q = vert > 0.5 ? vec2(c.x, fract((1.0 - c.y) * cnt)) : vec2(fract(c.x * cnt), 1.0 - c.y);
    // keep the glyph cells square on the sign
    float cellW = vert > 0.5 ? sz.x : sz.x / cnt, cellH = vert > 0.5 ? sz.y / cnt : sz.y;
    float asp = cellW / cellH; if (asp > 1.0) q.x = (q.x - 0.5) * asp + 0.5; else q.y = (q.y - 0.5) / asp + 0.5;
    float qin = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
    float gid = floor(fract(sin(vB.y * 91.7 + k * 12.9898) * 43758.5453) * 64.0);
    vec4 g = glyph(gid, clamp(q, 0.0, 1.0)) * qin * inside;
    if (type > 3.5) {
      col = vA.rgb * I;                                                          // plain tube / lamp lens
    } else if (type < 0.5 || type > 2.5) {                                       // lightbox: translucent acrylic over fluorescent tubes
      float tubes = 0.88 + 0.12 * sin((vert > 0.5 ? uv.x : uv.y) * 3.14159 * 3.0);
      float edge = smoothstep(0.0, 0.12, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
      vec3 bg = vA.rgb * I * tubes * (0.75 + 0.25 * edge);
      float lw = fwidth(g.r); float letter = smoothstep(0.12 - lw, 0.32 + lw, g.r);
      vec3 gc = type > 2.5 ? vC.rgb * I * 1.1 : vC.rgb * I * 0.9;
      col = mix(bg, gc, letter);
      col = mix(vec3(0.02), col, inside);                                        // aluminium frame
    } else if (type < 1.5) {                                                     // neon tubes on a dark board
      float gw = fwidth(g.r);                                                     // widen the ramps by the pixel footprint (no dotted tubes)
      float tube = smoothstep(0.52 - gw, 0.7 + gw, g.r), core = smoothstep(0.8 - gw, 0.98 + gw * 0.5, g.r) * (1.0 - smoothstep(0.15, 0.5, gw));
      float broken = step(0.965, fract(sin(vB.y * 3.3 + k * 5.1) * 9137.7));
      vec3 board = vec3(0.012, 0.011, 0.014) + vA.rgb * I * g.g * 0.09 * uGlow;
      float bx = min(min(c.x, 1.0 - c.x) * sz.x, min(c.y, 1.0 - c.y) * sz.y);
      float border = vC.a > 0.5 ? (1.0 - smoothstep(0.012, 0.026, abs(bx - 0.04))) : 0.0;
      col = board + (vA.rgb * tube + mix(vA.rgb, vec3(1.0), 0.55) * core * 0.8) * I * (1.0 - broken * 0.9)
          + vC.rgb * border * I * 0.9;
    } else {                                                                      // LED screen: slow abstract content, pixel grid
      vec2 sp = uv * sz;
      float tt = uTime * 0.05 + vB.y * 10.0;
      vec3 a = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + vC.a + 0.15 * kFbm2(uv * 1.2 + tt, 2)));
      float bands = smoothstep(0.3, 0.7, kFbm2(vec2(uv.x * 1.4 - tt * 2.0, uv.y * 0.9 + tt), 2));
      float scene = floor(uTime / 17.0 + vB.y * 3.0);
      vec3 c2 = mix(a * 0.35, mix(vA.rgb, vec3(1.0), 0.4), bands);
      float txt = step(0.6, fract(sin(scene * 3.1 + floor(uv.y * 9.0) * 1.7) * 99.1)) * step(abs(uv.y - 0.25), 0.12) * step(0.5, fract(uv.x * 14.0 + scene));
      c2 = mix(c2, vec3(1.0), txt * 0.6);
      float fwp = max(fwidth(sp.x), fwidth(sp.y)) * 60.0;                       // the LED grid fades out before it can alias
      float px = mix(0.8 + 0.2 * step(0.2, fract(sp.x * 60.0)) * step(0.2, fract(sp.y * 60.0)), 0.84, smoothstep(0.25, 0.7, fwp));
      txt *= 1.0 - smoothstep(0.4, 1.0, fwidth(uv.x * 14.0));
      col = c2 * I * px;
    }
  }
  gl_FragColor = vec4(nnFog(col, vWp, cameraPosition), 1.0);
}`;

// ------------------------------------------------------------------------------------------ halos (lamps, traffic lights, headlights)
export const HALO_VS = /* glsl */`
attribute vec4 iCol; attribute vec4 iP;   // iCol rgb + flicker index, iP: xyz position (if instanceMatrix unused), w size
uniform float uHaloK; ${FLICK}
varying vec2 vQ; varying vec3 vCol; varying vec3 vWp;
void main() {
  vec3 c = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec4 mv = viewMatrix * modelMatrix * vec4(c, 1.0);
  float s = iP.w * (1.0 + 0.3 * uHaloK);
  mv.xy += position.xy * s; mv.z += s * 0.35;                                    // pull toward the camera a little so walls cut less
  vQ = position.xy * 2.0; vCol = iCol.rgb * uFlick[int(iCol.w + 0.5)]; vWp = (modelMatrix * vec4(c, 1.0)).xyz;
  gl_Position = projectionMatrix * mv;
}`;
export const HALO_FS = /* glsl */`
uniform float uHaloK;
varying vec2 vQ; varying vec3 vCol; varying vec3 vWp;
void main() {
  float r2 = dot(vQ, vQ); if (r2 > 1.0) discard;
  float g = exp(-r2 * 7.0) * 0.8 + exp(-r2 * 30.0) * 0.6;
  float d = length(vWp - cameraPosition);
  float fogT = exp(-d * d * uFogDen * uFogDen * 0.6);
  gl_FragColor = vec4(vCol * g * uHaloK * (1.0 - r2) * fogT, 1.0);
}`;

// ------------------------------------------------------------------------------------------ steam
export const STEAM_VS = /* glsl */`
attribute vec4 iS;    // x phase, y size, z seed, w lifetime
uniform float uTime, uWindX, uWindZ, uRise;
varying vec2 vQ; varying float vA; varying vec3 vWp; varying float vSeed;
void main() {
  vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float life = fract(uTime / iS.w + iS.x);
  vec3 c = base + vec3(uWindX * life * life * 2.2 + sin(life * 3.0 + iS.z) * 0.15, life * uRise, uWindZ * life * 1.5);
  vec4 mv = viewMatrix * modelMatrix * vec4(c, 1.0);
  float s = iS.y * (0.35 + 1.4 * life);
  float a = iS.z * 6.28 + life * 0.6; mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  mv.xy += R * position.xy * s;
  vQ = position.xy * 2.0; vA = smoothstep(0.0, 0.12, life) * (1.0 - life) * (1.0 - life); vWp = c; vSeed = iS.z;
  gl_Position = projectionMatrix * mv;
}`;
export const STEAM_FS = /* glsl */`
uniform float uTime, uSteam; uniform vec3 uSteamCol;
varying vec2 vQ; varying float vA; varying vec3 vWp; varying float vSeed;
void main() {
  float r = length(vQ); if (r > 1.0) discard;
  float n = kFbm2(vQ * 1.6 + vec2(vSeed * 13.0, -uTime * 0.25), 4);
  float d = smoothstep(1.0, 0.1, r) * smoothstep(0.25, 0.75, n + 0.25 * (1.0 - r));
  float a = d * vA * uSteam;
  vec3 col = uSteamCol * (0.6 + 0.6 * n);
  col = nnFog(col, vWp, cameraPosition);
  gl_FragColor = vec4(col * a, a);
}`;

// ------------------------------------------------------------------------------------------ sky
export const SKY_VS = /* glsl */`varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
export const SKY_FS = /* glsl */`
uniform vec3 uZenith, uGlowCol; uniform float uTime, uCloud, uFlash, uGlowH;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uGlowCol, uZenith, smoothstep(0.0, uGlowH, h));
  vec2 p = d.xz / (d.y + 0.12) * 1.3;
  float c = kFbm2(p * 0.9 + vec2(uTime * 0.004, uTime * 0.0013), 5);
  float c2 = kFbm2(p * 2.7 - vec2(uTime * 0.007, 0.0), 4);
  float cl = smoothstep(0.25, 0.85, c * 0.75 + c2 * 0.35) * uCloud;
  col = mix(col, uGlowCol * (1.1 + 0.6 * c2) * (0.7 + 0.6 * (1.0 - smoothstep(0.0, 0.7, h))), cl * 0.7);  // low cloud base lit from below
  col *= 1.0 + uFlash * (2.5 + 3.0 * cl);
  col += uGlowCol * 0.15 * exp(-h * 10.0);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Prefix for our ShaderMaterials: kit common + noise + fog. */
export const PRE = G.common + G.noise + FOG;
