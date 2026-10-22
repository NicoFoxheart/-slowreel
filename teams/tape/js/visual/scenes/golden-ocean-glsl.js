// golden-ocean-glsl.js - shaders for the "Golden ocean" scene: a projected-grid ocean (Gerstner swell + wind sea in the
// vertex shader, two animated FFT-like detail tiles baked every frame with their slope variance, LEAN-style filtering so
// the sun glitter widens physically with distance, Beckmann sun/moon specular with masking, Fresnel sky reflection from
// a per-frame cube map, upwelling body colour, backlit crest subsurface, Jacobian foam and whitecaps), the detail bake,
// and the lighthouse beam (volumetric chord through hazy air).

// ------------------------------------------------------------------------------------------------ detail tile bake
// One tileable patch of short waves (integer wave vectors on the torus, deep-water + capillary dispersion). The CPU
// passes each wave's phase already advanced to t (double precision), so the shader never multiplies big times.
// Output: RG = slope (d h/dx, d h/dz) encoded *0.25+0.5, BA = squared slopes *0.125 (mip-filtered -> slope variance).
export const BAKE_FS = /* glsl */`
uniform vec4 uW[NW];   // (m, n) integer wave vector, k*a (slope amplitude), phase(t)
uniform float uTile;
void main() {
  vec2 p = vUv * uTile;
  vec2 s = vec2(0.0);
  for (int i = 0; i < NW; i++) {
    vec4 w = uW[i];
    vec2 kv = w.xy * (6.2831853 / uTile);
    float k = max(length(kv), 1e-4);
    s += (w.z * cos(dot(kv, p) + w.w) / k) * kv;
  }
  gl_FragColor = vec4(s * 0.25 + 0.5, s * s * 0.125);
}`;

// 4x downsample (4 bilinear taps = a 4x4 box) for the explicit mip chain of the detail tiles; linear averages of the
// slopes and squared slopes keep the variance exact (LEAN mapping)
export const DOWN4_FS = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel;
void main() {
  gl_FragColor = 0.25 * (texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)) + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0))
    + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)) + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)));
}`;

// ------------------------------------------------------------------------------------------------ ocean
export const OCEAN_VS = /* glsl */`
uniform mat4 uInvProjView;
uniform vec3 uCamPos;
uniform float uDmax, uPix, uSwell, uSea, uAmpNorm;
uniform vec4 uGW[NGW];   // dir.x, dir.z, amplitude (m), wavelength (m)
uniform vec4 uGP[NGW];   // phase(t), horizontal Q, group (0 swell / 1 wind sea), -
varying vec3 vWorld; varying vec2 vX0; varying vec3 vGeoN; varying float vJ; varying float vHeight; varying float vVarLost;
void main() {
  vec4 a = uInvProjView * vec4(position.xy, -1.0, 1.0); a.xyz /= a.w;
  vec4 b = uInvProjView * vec4(position.xy, 1.0, 1.0); b.xyz /= b.w;
  vec3 rd = normalize(b.xyz - a.xyz);
  vec3 ro = uCamPos;
  vec2 hz = normalize(rd.xz + vec2(1e-6));
  float tHit = rd.y < -1e-6 ? ro.y / -rd.y : 1e12;
  float horiz = tHit * length(rd.xz);
  vec2 x0 = horiz < uDmax ? ro.xz + rd.xz * tHit : ro.xz + hz * uDmax;
  float dist = length(vec3(x0.x - ro.x, ro.y, x0.y - ro.z));
  // grid spacing on the water (metres): screen spacing stretched by the grazing angle
  float graze = max(ro.y / dist, 0.004);
  float spacing = dist * uPix / graze;
  vec3 P = vec3(x0.x, 0.0, x0.y);
  float dxdx = 1.0, dzdz = 1.0, dxdz = 0.0, dydx = 0.0, dydz = 0.0, varLost = 0.0;
  for (int i = 0; i < NGW; i++) {
    vec4 w = uGW[i]; vec4 q = uGP[i];
    float k = 6.2831853 / w.w;
    float amp = w.z * mix(uSwell, uSea, q.z);
    float fade = smoothstep(2.5, 5.0, w.w / spacing);
    float ph = k * dot(w.xy, x0) + q.x;
    float s = sin(ph), c = cos(ph);
    float ya = amp * fade, qa = q.y * ya;
    P.x += w.x * qa * c; P.z += w.y * qa * c; P.y += ya * s;
    float wa = k * qa * s;
    dxdx -= w.x * w.x * wa; dzdz -= w.y * w.y * wa; dxdz -= w.x * w.y * wa;
    dydx += w.x * k * ya * c; dydz += w.y * k * ya * c;
    float ka = k * amp;
    varLost += (1.0 - fade) * 0.5 * ka * ka;
  }
  vGeoN = vec3(dydz * dxdz - dzdz * dydx, dzdz * dxdx - dxdz * dxdz, dxdz * dydx - dydz * dxdx);
  vJ = dxdx * dzdz - dxdz * dxdz;
  vHeight = P.y * uAmpNorm;
  vVarLost = varLost;
  vX0 = x0; vWorld = P;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;

export const OCEAN_FS = /* glsl */`
uniform sampler2D uDetA0, uDetA1, uDetA2, uDetA3, uDetB0, uDetB1, uDetB2, uDetB3, uFoamTex, uGust;
uniform samplerCube uEnv, uEnvBlur;
uniform float uEnvSize, uDetSize;
uniform vec4 uDetAP, uDetBP;     // 1/tile, cos, sin, strength
uniform vec3 uSunL, uSunE, uMoonL, uMoonE, uAmb, uDeep, uSssCol, uFoamLight;
uniform float uSigma0, uFoam, uFoamJ, uGlitter, uTime, uGustAmt, uSss, uCrestFoam, uStreak, uEnvRough;
uniform vec2 uWind;
varying vec3 vWorld; varying vec2 vX0; varying vec3 vGeoN; varying float vJ; varying float vHeight; varying float vVarLost;

// manual trilinear over the explicit 4x chain (level = 0.5 * log2(texel footprint))
vec4 chain(sampler2D t0, sampler2D t1, sampler2D t2, sampler2D t3, vec2 uv, float lv) {
  float f = fract(lv); vec4 a, b;
  if (lv < 1.0) { a = textureLod(t0, uv, 0.0); b = textureLod(t1, uv, 0.0); }
  else if (lv < 2.0) { a = textureLod(t1, uv, 0.0); b = textureLod(t2, uv, 0.0); }
  else { a = textureLod(t2, uv, 0.0); b = textureLod(t3, uv, 0.0); f = min(lv - 2.0, 1.0); }
  return mix(a, b, f);
}
vec2 tileUV(vec4 P) { return vec2(P.y * vX0.x - P.z * vX0.y, P.z * vX0.x + P.y * vX0.y) * P.x; }
float tileLevel(vec2 uv) {
  vec2 dx = dFdx(uv) * uDetSize, dy = dFdy(uv) * uDetSize;
  float a = length(dx), b = length(dy), fp = pow(max(a, b), 0.65) * pow(max(min(a, b), 1e-6), 0.35);
  return clamp(0.5 * log2(max(fp, 1e-6)) + 0.15, 0.0, 3.0);
}
void detail(vec4 d, vec4 P, float g, inout vec2 s, inout vec2 v) {
  vec2 m = (d.xy - 0.5) * 4.0, m2 = d.zw * 8.0;
  vec2 var = max(m2 - m * m, 0.0);
  // the tile is rotated by (c, s): rotate the slope back into world axes
  vec2 mw = vec2(P.y * m.x + P.z * m.y, -P.z * m.x + P.y * m.y);
  float c2 = P.y * P.y, s2 = P.z * P.z, str = P.w * g;
  s += mw * str;
  v += vec2(c2 * var.x + s2 * var.y, s2 * var.x + c2 * var.y) * str * str;
}
float lambdaM(float cosT, float sig) {
  float c = clamp(cosT, 1e-3, 0.9999);
  float nu = c / sqrt(1.0 - c * c) / (1.41421 * sig);
  return nu < 1.6 ? (1.0 - 1.259 * nu + 0.396 * nu * nu) / (3.535 * nu + 2.181 * nu * nu) : 0.0;
}
// Beckmann glitter of a distant light (sun, moon) on facets around slope s with slope variance v (per axis)
vec3 glint(vec3 L, vec3 E, vec3 V, vec2 s, vec2 v) {
  if (L.y <= -0.01) return vec3(0.0);
  vec3 H = normalize(L + V);
  vec2 z = -H.xz / max(H.y, 1e-3);
  vec2 d = z - s;
  vec2 vv = max(v, vec2(4e-5));
  float p = exp(-0.5 * (d.x * d.x / vv.x + d.y * d.y / vv.y)) / (6.2831853 * sqrt(vv.x * vv.y));
  float hy2 = H.y * H.y;
  float fr = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, H), 0.0, 1.0), 5.0);
  vec2 lh = normalize(L.xz + 1e-5), vh = normalize(V.xz + 1e-5);
  float sl = sqrt(lh.x * lh.x * vv.x + lh.y * lh.y * vv.y), sv = sqrt(vh.x * vh.x * vv.x + vh.y * vh.y * vv.y);
  float mask = 1.0 + lambdaM(max(L.y, 0.0), sl) + lambdaM(V.y, sv);
  return E * min(fr * p / (4.0 * hy2 * hy2 * max(V.y, 0.03) * mask), 600.0) * smoothstep(-0.01, 0.02, L.y);
}
void main() {
  vec3 V0 = cameraPosition - vWorld; float dist = length(V0); vec3 V = V0 / dist;
  vec3 Ng = normalize(vGeoN);
  vec2 s = -Ng.xz / max(Ng.y, 0.2);
  // wind gust patches: cat's paws of rougher water drifting downwind
  float g = texture2D(uGust, (vX0 - uWind * uTime) * 0.0016).r;
  g = mix(1.0 - uGustAmt, 1.0 + uGustAmt, smoothstep(0.3, 0.7, g));
  vec2 v = vec2(vVarLost * 0.5 + uSigma0 * g);
  vec2 uvA = tileUV(uDetAP), uvB = tileUV(uDetBP);
  detail(chain(uDetA0, uDetA1, uDetA2, uDetA3, uvA, tileLevel(uvA)), uDetAP, g, s, v);
  detail(chain(uDetB0, uDetB1, uDetB2, uDetB3, uvB, tileLevel(uvB)), uDetBP, g, s, v);
  // specular anti-aliasing: slope change inside the pixel becomes roughness
  vec2 fw = fwidth(s); v += fw * fw * 0.35;
  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
  float NdV = max(dot(N, V), 0.0);
  vec3 R = reflect(-V, N);
  float occl = mix(0.55, 1.0, smoothstep(-0.15, 0.02, R.y));   // rays sent down hit the back of the next wave: dark water
  R.y = abs(R.y) + 0.002; R = normalize(R);
  float sig = sqrt(v.x + v.y);
  vec3 sky = mix(textureLod(uEnv, R, 0.0).rgb, textureLod(uEnvBlur, R, 0.0).rgb, max(smoothstep(0.02, 0.14, sig), uEnvRough)) * occl;
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  F = mix(F, min(F, 0.75), smoothstep(0.02, 0.2, sig));   // rough grazing water is not a perfect mirror
  // upwelling light from the deep water + backlit crests (subsurface) + sky-lit crest tint
  vec3 Ed = uAmb + uSunE * max(uSunL.y, 0.0) + uMoonE * max(uMoonL.y, 0.0);
  float crest = smoothstep(-0.1, 1.0, vHeight);
  vec3 body = uDeep * Ed * 0.3183 * (1.0 + 1.6 * crest);
  vec2 lh = normalize(uSunL.xz + 1e-5);
  float back = pow(max(dot(-V.xz / max(length(V.xz), 1e-4), lh), 0.0), 3.0);
  float thin = crest * crest * (0.35 + 0.65 * smoothstep(0.0, 0.6, dot(N, V)));
  body += uSssCol * uSunE * back * thin * uSss * (1.0 - smoothstep(0.25, 0.7, uSunL.y));
  vec3 col = body * (1.0 - F) + sky * F;
  col += (glint(uSunL, uSunE, V, s, v) + glint(uMoonL, uMoonE, V, s, v)) * uGlitter;
  // foam: compressed crests (Gerstner Jacobian) broken into lacy cells + wind whitecaps
  vec4 ft = texture2D(uFoamTex, vX0 * 0.31 + uWind * uTime * 0.02);
  vec4 ftb = texture2D(uFoamTex, vX0 * 0.83 - uWind * uTime * 0.03 + 0.5);
  vec4 ft2 = texture2D(uFoamTex, vX0 * 0.041 - uWind.yx * uTime * 0.006);
  vec4 ft3 = texture2D(uFoamTex, vec2(vX0.x * 0.012 - vX0.y * 0.004, vX0.y * 0.012 + vX0.x * 0.004) + uWind * uTime * 0.0012);
  float lace = clamp(ft.a * 0.5 + ftb.a * 0.3 + (1.0 - ft.b) * 0.45 - 0.22 + (ft2.a - 0.5) * 0.6, 0.0, 1.0);
  float jf = smoothstep(uFoamJ, uFoamJ - 0.35, vJ) * uCrestFoam;
  float cap = uFoam * smoothstep(0.6, 0.85, ft3.a * 0.7 + g * 0.3) * smoothstep(0.0, 0.9, crest + 0.2);
  float fa = clamp(jf + cap, 0.0, 0.82);
  float foam = smoothstep(1.0 - fa, 1.0 - fa + 0.22, lace) * min(fa * 1.4, 1.0) * (0.45 + 0.55 * smoothstep(0.2, 0.8, ft2.a));
  // storm: spindrift streaks of old foam drawn out along the wind (long along, thin across), patchy with the gusts
  if (uStreak > 0.0) {
    vec2 wd = normalize(uWind); vec2 q = vec2(dot(vX0, wd), dot(vX0, vec2(-wd.y, wd.x)));
    vec4 sa = texture2D(uFoamTex, vec2(q.x * 0.0045 - uTime * 0.004, q.y * 0.075));
    vec4 sb = texture2D(uFoamTex, vec2(q.x * 0.011 - uTime * 0.009, q.y * 0.21 + 0.37));
    float st = smoothstep(0.62, 0.86, sa.a * 0.6 + sb.a * 0.4) * (0.35 + 0.65 * smoothstep(0.4, 0.7, ft2.a)) * g;
    foam = max(foam, st * uStreak * (1.0 - smoothstep(400.0, 2500.0, dist)));
  }
  foam = mix(foam, fa * 0.45, smoothstep(150.0, 1500.0, dist));
  vec3 fcol = 0.62 * (uAmb + uFoamLight * max(dot(N, uSunL), 0.0) + uMoonE * max(dot(N, uMoonL), 0.0)) * 0.3183;
  col = mix(col, fcol, clamp(foam, 0.0, 0.95));
  // aerial perspective with the sky's true horizon colour (the kit's fog samples the sky a little higher, which leaves a
  // dark seam where the sea meets the sky)
  if (uFogOn > 0.5) {
    vec3 rr = vWorld - cameraPosition; float dd = length(rr); vec3 rdd = rr / max(dd, 1e-4);
    float T = exp(-kFogOD(cameraPosition, rdd, dd));
    vec3 hzc = texture2D(uSkyLut, kFogSkyUV(normalize(vec3(rdd.x, 0.003, rdd.z)))).rgb;
    vec3 ins = (hzc * uFogSkyAmount + uFogSunColor * kPhaseHG(dot(rdd, uFogSunDir), uFogSunG) * uFogSunStrength) * uFogTint;
    col = col * T + ins * (1.0 - T);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------------------------------------ lighthouse beam
export const BEAM_VS = /* glsl */`
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
export const BEAM_FS = /* glsl */`
uniform vec3 uApex, uDir, uColor; uniform float uLen, uRad, uFall;
varying vec3 vW;
void main() {
  vec3 rd = normalize(vW - cameraPosition);
  vec3 w0 = cameraPosition - uApex;
  float b = dot(rd, uDir), d = dot(rd, w0), e = dot(uDir, w0), den = max(1.0 - b * b, 1e-4);
  float sc = (b * e - d) / den, ta = (e - b * d) / den;
  ta = clamp(ta, 0.0, uLen);
  vec3 pc = cameraPosition + rd * max(sc, 0.0), qa = uApex + uDir * ta;
  float r = max(uRad * ta / uLen, 0.3);
  float x = length(pc - qa) / r;
  float chord = max(1.0 - x * x, 0.0);
  float I = chord * exp(-ta / uFall) * (1.0 + 6.0 * kPhaseHG(dot(uDir, -rd), 0.7)) / (1.0 + ta * 0.02);
  float T = kFogT(qa, cameraPosition);
  gl_FragColor = vec4(uColor * I * T, 1.0);
}`;

// ------------------------------------------------------------------------------------------------ storm deck
// A low, fast nimbostratus/scud deck multiplied over the kit sky (drawn right after it, so the sea's reflection cube gets
// it too): dark overhead, a paler band toward the horizon where the deck thins, ragged scud racing below it, and a
// soft break around the hidden sun. Output is a multiplier (CustomBlending dst * src).
export const DECK_VS = /* glsl */`
varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;
export const DECK_FS = /* glsl */`
uniform float uTime, uAmt, uBreak, uOct;
uniform vec2 uWindC;
uniform vec3 uSunD;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float y = max(d.y, 0.0);
  float tc = 1.0 / (y + 0.045);                      // distance (km) to a 1 km deck plane, flattened at the horizon
  vec2 p = d.xz * tc * 0.6 + uWindC * uTime;
  int oct = int(uOct);
  float n = kWarp2(p, oct, 0.45);
  float base = smoothstep(0.3, 0.72, n);
  float scud = smoothstep(0.52, 0.78, kFbm2(p * 2.6 + uWindC * uTime * 1.8 + 7.0, oct));
  float dark = mix(0.6, 0.26, base) * mix(1.0, 0.72, scud);
  float far = smoothstep(0.0, 0.22, y);              // the deck thins toward the horizon: a paler band there
  float f = mix(1.0, dark, uAmt * mix(0.28, 1.0, far));
  f = mix(f, 1.0, uBreak * pow(max(dot(d, uSunD), 0.0), 10.0) * (1.0 - 0.6 * base));
  f = mix(1.0, f, smoothstep(-0.02, 0.01, d.y));
  gl_FragColor = vec4(vec3(f) * vec3(0.97, 0.995, 1.02), 1.0);
}`;
