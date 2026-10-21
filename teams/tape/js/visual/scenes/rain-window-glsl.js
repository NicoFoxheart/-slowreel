// rain-window-glsl.js - shaders for the "Rain on the window" scene (scenes/rain-window.js).
// Three stages, all procedural and pure functions of time:
//   1. OUTSIDE (BASE_* + SPRITE_*): the world behind the glass, rendered twice into small HDR targets with mipmaps -
//      once as the lens sees it focused on the glass (every light a circle of confusion: cat-eye bokeh discs, soft
//      silhouettes) and once sharp (what each water drop's tiny lens images: an inverted, minified city).
//   2. GLASS (GLASS_FS): the pane - static beads, fresh impacts, runners that stick, slip and wiggle down leaving
//      clear wet tracks with trail droplets, condensation mist, a faint room reflection and lamp glints on the drops.
//   3. the kit post chain (bloom, grade, ACES, grain) on top.
// Units: the glass is in centimetres, the world in metres, colours are linear HDR.

// ------------------------------------------------------------------------------------------------ outside: base layer
export const BASE_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const OUTSIDE_COMMON = /* glsl */`
uniform sampler2D tProf;     // building / tree profiles: row 0 near, 1 mid, 2 far; R height above street, G tone, B lit share
uniform vec3 uDepth;         // distance of the three rows (m)
uniform vec3 uLot;           // lot width of each row (m)
uniform vec3 uCamP;          // camera position (m); the street (or field) is at y = uRoadY
uniform float uRoadY;
vec4 profAt(float x, float row, float lot) {
  float i = clamp(floor(x / lot) + 128.0, 0.0, 255.0);
  return texture2D(tProf, vec2((i + 0.5) / 256.0, (row + 0.5) / 3.0));
}`;

export const BASE_FS = OUTSIDE_COMMON + /* glsl */`
uniform vec2 uView;          // tan(half fov) * aspect, tan(half fov) of the overscanned outside camera
uniform float uPitch, uT, uSoft, uDetail, uFlash, uVis, uCloud, uSway, uWinB, uLampSp, uLampOff;
uniform vec2 uFlashP;        // where the lightning lights the cloud deck (cloud-plane coords)
uniform vec3 uSkyTop, uSkyHor, uHaze, uFacade, uGround, uLampC, uWinWarm, uWinCool, uCityGlow, uStreet;
uniform vec4 uHouse;         // country: house x0, x1, wall height, roof height
uniform vec3 uPorch;         // country: porch light position
uniform vec3 uPorchC;
uniform vec4 uNeon[6];       // neon spill on the near facade: x, y, radius, strength
uniform vec3 uNeonC[6];
varying vec2 vUv;

vec3 rayDir(vec2 uv) {
  vec2 n = uv * 2.0 - 1.0;
  vec3 d = vec3(n.x * uView.x, n.y * uView.y, -1.0);
  float c = cos(uPitch), s = sin(uPitch);
  return vec3(d.x, d.y * c - d.z * s, d.y * s + d.z * c);
}

// a row of buildings (or trees) as a vertical plane at distance D: coverage with a defocus-wide soft edge
float rowCover(vec3 dw, float D, float row, float lot, float sway, out vec3 P) {
  P = uCamP + dw * (D / max(-dw.z, 1e-4));
  float bw = max(uSoft * D * uView.y, 0.02);
  float c = 0.0;
  for (int k = -2; k <= 2; k++) {
    float x = P.x + float(k) * bw * 0.45;
    x += sway * sin(uT * 0.55 + x * 0.21) * kSat((P.y - uRoadY) / 12.0);
    float top = uRoadY + profAt(x, row, lot).r;
    c += smoothstep(top + bw, top - bw, P.y);
  }
  return c * 0.2;
}

vec3 skyCol(vec3 dw) {
  float el = dw.y / length(dw);
  vec3 c = mix(uSkyHor, uSkyTop, pow(kSat(el * 3.0 + 0.05), 0.65));
  // the low cloud deck, lit from below by the town
  vec2 cp = (uCamP.xz + dw.xz * (650.0 / max(dw.y, 0.035))) * 0.0011 + vec2(uT * 0.0042, uT * 0.0013);
  float cl = uDetail > 0.5 ? kFbm2(cp, 5) : kFbm2(cp, 3);
  float cl2 = kFbm2(cp * 0.37 + 4.1 - vec2(uT * 0.0011, 0.0), 3);
  float dens = mix(cl, cl2, 0.45);
  c *= mix(1.0, 0.45 + 1.1 * dens, uCloud);
  // a warm town glow along the horizon
  c += uCityGlow * exp(-max(el, 0.0) * 9.0) * (0.75 + 0.5 * cl2);
  // lightning inside the clouds: a broad flash, brightest where the clouds are thick
  vec2 fp = cp - uFlashP;
  c += uFlash * vec3(0.78, 0.82, 1.0) * (0.04 + 0.5 * exp(-dot(fp, fp) * 1.4) * (0.25 + 1.4 * dens * dens));
  return c;
}

// procedural windows of a mid or far building row (sharp: real windows, bokeh: their average glow)
vec3 windows(vec3 P, vec4 pr, float row) {
  float hy = P.y - uRoadY;
  vec2 wc = vec2(P.x / 3.1, hy / 3.4), id = floor(wc), f = fract(wc);
  float inside = step(4.5, hy) * step(hy, pr.r - 1.6);
  vec3 wcol = mix(uWinWarm, uWinCool, step(0.86, kHash12(id * 1.7 + row * 9.1)));
  float b = kHash12(id + row * 71.3);
  float lit = step(b, pr.b) * (0.55 + 0.9 * kHash12(id * 3.3 + 1.7));
  float rect = smoothstep(0.16, 0.24, f.x) * smoothstep(0.84, 0.76, f.x) * smoothstep(0.22, 0.3, f.y) * smoothstep(0.78, 0.7, f.y);
  float w = mix(pr.b * 0.32 * 0.95, lit * rect, uDetail);
  return wcol * uWinB * w * inside;
}

vec3 rowCol(vec3 P, float D, float row, float lot) {
  vec4 pr = profAt(P.x, row, lot);
  vec3 c = uFacade * (0.55 + 0.9 * pr.g);
  c += windows(P, pr, row) * exp(-D / (uVis * 1.4));
  c += uFlash * vec3(0.03, 0.032, 0.042);
  return mix(c, uHaze * (1.0 + 2.5 * uFlash), 1.0 - exp(-D / uVis));
}

#ifndef COUNTRY
vec3 nearFacade(vec3 P) {
  vec4 pr = profAt(P.x, 0.0, uLot.x);
  float hy = P.y - uRoadY;
  vec3 c = uFacade * (0.6 + 0.8 * pr.g);
  c += uLampC * 0.05 * exp(-hy / 5.0);                                // streetlight on the lower floors
  c += uStreet * smoothstep(3.6, 2.6, hy) * smoothstep(0.0, 0.6, hy);  // shop fronts glow
  c += uWinWarm * uWinB * pr.b * 0.06 * step(4.5, hy);                 // light from lit rooms
  for (int i = 0; i < 6; i++) { vec2 d = (P.xy - vec2(uNeon[i].x, uRoadY + uNeon[i].y)) / uNeon[i].z; c += uNeonC[i] * uNeon[i].w * exp(-dot(d, d)); }
  c += uFlash * vec3(0.016, 0.017, 0.023);
  return mix(c, uHaze, 1.0 - exp(-uDepth.x / uVis));
}
vec3 street(vec3 dw) {
  float s = (uRoadY - uCamP.y) / min(dw.y, -1e-4); vec3 G = uCamP + dw * s;
  vec3 c = uGround;
  // pools of light under the streetlights on both kerbs
  for (int r = 0; r < 2; r++) {
    float z0 = r == 0 ? -31.0 : -47.0, off = uLampOff + (r == 0 ? 0.0 : uLampSp * 0.5);
    float xi = floor((G.x - off) / uLampSp + 0.5) * uLampSp + off;
    for (int k = -1; k <= 1; k++) { float dx = G.x - xi - float(k) * uLampSp, dz = G.z - z0; c += uLampC * 0.045 * exp(-(dx * dx + dz * dz * 1.6) / 34.0); }
  }
  c += uHaze * 0.22 + uStreet * 0.25 * smoothstep(-52.0, -61.0, G.z);   // wet asphalt catches the sky and the shop light
  for (int i = 0; i < 6; i++) { float dx = (G.x - uNeon[i].x) / (uNeon[i].z * 1.2); c += uNeonC[i] * uNeon[i].w * 0.35 * exp(-dx * dx) * smoothstep(-36.0, -60.0, G.z); }
  c *= mix(1.0, 1.5, smoothstep(-49.0, -51.0, G.z));                   // the far pavement is lighter
  c += uFlash * vec3(0.006, 0.0065, 0.009);
  return mix(c, uHaze, 1.0 - exp(-length(G - uCamP) / uVis));
}
#else
vec3 field(vec3 dw) {
  float s = (uRoadY - uCamP.y) / min(dw.y, -1e-4); vec3 G = uCamP + dw * s;
  float n = uDetail > 0.5 ? kFbm2(G.xz * vec2(0.35, 0.9), 4) : kFbm2(G.xz * vec2(0.2, 0.5), 2);
  vec3 c = uGround * (0.7 + 0.6 * n);
  vec3 dp = G - vec3(uPorch.x, uRoadY, uPorch.z);
  c += uPorchC * 0.06 * exp(-dot(dp.xz, dp.xz) / 22.0);
  c += uHaze * 0.12;
  c += uFlash * vec3(0.004, 0.0045, 0.006);
  return mix(c, uHaze, 1.0 - exp(-length(G - uCamP) / uVis));
}
#endif

void main() {
  vec3 dw = rayDir(vUv);
  vec3 col = skyCol(dw);
  vec3 P;
#ifndef COUNTRY
  float c3 = rowCover(dw, uDepth.z, 2.0, uLot.z, 0.0, P); col = mix(col, rowCol(P, uDepth.z, 2.0, uLot.z), c3);
  float c2 = rowCover(dw, uDepth.y, 1.0, uLot.y, 0.0, P); col = mix(col, rowCol(P, uDepth.y, 1.0, uLot.y), c2);
  float c1 = rowCover(dw, uDepth.x, 0.0, uLot.x, 0.0, P); col = mix(col, nearFacade(P), c1);
  float bw = max(uSoft * uDepth.x * uView.y, 0.02);
  col = mix(col, street(dw), smoothstep(uRoadY + bw, uRoadY - bw, P.y));
#else
  float c2 = rowCover(dw, uDepth.y, 1.0, uLot.y, 0.0, P);
  vec3 hill = uFacade * 0.6 + uFlash * vec3(0.004, 0.0045, 0.006);
  col = mix(col, mix(hill, uHaze, 1.0 - exp(-uDepth.y / uVis)), c2);
  float c1 = rowCover(dw, uDepth.x, 0.0, uLot.x, uSway, P);
  vec3 tree = uFacade * (0.5 + 0.5 * kValue2(P.xy * 0.7)) + uFlash * vec3(0.002, 0.0022, 0.003);
  vec3 dpt = P - uPorch; tree += uPorchC * 0.004 * exp(-dot(dpt.xy, dpt.xy) / 60.0);
  col = mix(col, mix(tree, uHaze, 1.0 - exp(-uDepth.x / uVis)), c1);
  // the neighbour's house with its porch light
  float bwH = max(uSoft * -uPorch.z * uView.y, 0.02);
  vec3 H = uCamP + dw * ((-uPorch.z - 0.4) / max(-dw.z, 1e-4));
  float hx = H.x, hy = H.y - uRoadY, xc = 0.5 * (uHouse.x + uHouse.y), hw = 0.5 * (uHouse.y - uHouse.x);
  float wall = smoothstep(uHouse.x - bwH, uHouse.x + bwH, hx) * smoothstep(uHouse.y + bwH, uHouse.y - bwH, hx) * smoothstep(uHouse.z + bwH, uHouse.z - bwH, hy);
  float roofTop = uHouse.z + uHouse.w * (1.0 - abs(hx - xc) / (hw + 0.6));
  float roof = smoothstep(uHouse.x - 0.6 - bwH, uHouse.x - 0.6 + bwH, hx) * smoothstep(uHouse.y + 0.6 + bwH, uHouse.y + 0.6 - bwH, hx) * smoothstep(roofTop + bwH, roofTop - bwH, hy) * step(uHouse.z - 0.3, hy);
  vec3 dl = vec3(H.x, H.y, uPorch.z) - uPorch;
  vec3 wallC = uFacade * 1.6 + uPorchC * 0.16 * exp(-dot(dl.xy, dl.xy) / 5.0) + uFlash * vec3(0.004, 0.0045, 0.006);
  vec3 roofC = uFacade * 0.8 + uPorchC * 0.02 * exp(-dot(dl.xy, dl.xy) / 9.0);
  col = mix(col, roofC, kSat(roof));
  col = mix(col, wallC, kSat(wall));
  col = mix(col, field(dw), smoothstep(uRoadY + bwH, uRoadY - bwH, H.y));
#endif
  gl_FragColor = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------------------------------------ outside: lights
// One instanced quad per light. Each light is drawn as its circle of confusion (radius from the focus distance), with
// energy conserved (a sharp light is a small bright dot, a defocused one a big dim disc), cat-eye vignetting toward the
// frame edges, a slightly brighter rim and a faint longitudinal-CA fringe, like a real fast lens.
export const SPRITE_VS = OUTSIDE_COMMON + /* glsl */`
attribute vec3 aPos;    // world position (m); for cars: lane centre + offset within the car
attribute vec3 aCol;    // linear colour x brightness x nominal disc area
attribute vec4 aP;      // kind, phase, period, id
attribute vec4 aQ;      // kind specific
attribute vec4 aS;      // stretch x, stretch y, reflected (0/1), occlusion test (0/1)
uniform float uT, uAperture, uFocus, uMinR, uVis, uCarDens, uCat, uScreenH, uGain;
uniform vec2 uRes;
varying vec2 vC; varying vec3 vCol; varying vec2 vNdc; varying float vR; varying float vSoft;
float occl(vec3 wp) {
  float v = 1.0, zd = -wp.z;
  for (int j = 0; j < 2; j++) {
    float D = j == 0 ? uDepth.x : uDepth.y, lot = j == 0 ? uLot.x : uLot.y;
    if (D < zd - 0.6) {
      float q = D / zd; float X = uCamP.x + (wp.x - uCamP.x) * q, Y = uCamP.y + (wp.y - uCamP.y) * q;
      float top = uRoadY + profAt(X, float(j), lot).r;
      v *= smoothstep(top - 0.5, top + 0.5, Y);
    }
  }
  return v;
}
void main() {
  float kind = aP.x; vec3 wp = aPos; float I = 1.0;
  if (kind < 0.5) {                       // steady light, or a window that switches on and off over the song
    if (aQ.x > 0.0) {
      float s = uT / aQ.x + aP.y, k = floor(s), fr = s - k;
      float on = step(kHash11(k * 7.13 + aQ.z * 0.731), aQ.y), was = step(kHash11((k - 1.0) * 7.13 + aQ.z * 0.731), aQ.y);
      I = mix(was, on, smoothstep(0.0, 0.25 / aQ.x, fr));
    }
  } else if (kind < 1.5) {                // a television: restless cool flicker
    I = 0.45 + 0.4 * kValue2(vec2(uT * 2.7, aQ.z)) + 0.15 * kValue2(vec2(uT * 9.0, aQ.z + 5.0));
  } else if (kind < 2.5) {                // aviation obstruction beacon (LED, fast ramps)
    float ph = fract(uT / aP.z + aP.y);
    I = smoothstep(0.0, 0.04, ph) * (1.0 - smoothstep(0.38, 0.46, ph));
  } else if (kind < 3.5) {                // a car on a long loop of road; whether it is there changes every lap
    float s = aQ.z + aQ.x * uT; float lap = floor(s / aQ.y);
    wp.x += s - lap * aQ.y - aQ.y * 0.5;
    I = step(kHash11(lap * 3.71 + aQ.w * 0.917), uCarDens);
  } else if (kind < 4.5) {                // traffic signal aspect: on during [aQ.y, aQ.z) of an aQ.x-second cycle
    float ph = fract(uT / aQ.x + aQ.w);
    I = smoothstep(aQ.y, aQ.y + 0.004, ph) * (1.0 - smoothstep(aQ.z, aQ.z + 0.004, ph));
  } else {                                // neon tube: steady, with rare buzzing dropouts
    float win = floor(uT / 6.0 + aQ.z * 0.37);
    float bad = step(kHash11(win * 1.93 + aQ.z * 3.1), 0.07);
    I = 1.0 - bad * 0.75 * step(0.45, kValue2(vec2(uT * 23.0, aQ.z)));
  }
  if (aS.z > 0.5) wp.y = 2.0 * uRoadY - wp.y;
  else if (aS.w > 0.5) I *= occl(wp);
  vec4 vp = viewMatrix * vec4(wp, 1.0); float dist = -vp.z;
  vec4 clip = projectionMatrix * vp;
  float r = max(uAperture * abs(1.0 - uFocus / max(dist, 0.01)), uMinR);
  vec2 ext = vec2(r * aS.x, r * aS.y);
  float rf = r / uScreenH, area = 3.14159 * rf * rf * aS.x * aS.y;
  I *= exp(-dist / uVis);
  vCol = aCol * I * uGain / max(area, 1e-7);
  vR = r; vC = position.xy; vNdc = clip.xy / max(clip.w, 1e-4); vSoft = aS.z;
  if (I < 1e-4 || dist < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  clip.xy += position.xy * ext * 2.0 / uRes * clip.w;
  gl_Position = clip;
}`;

export const SPRITE_FS = /* glsl */`
uniform float uCat;
varying vec2 vC; varying vec3 vCol; varying vec2 vNdc; varying float vR; varying float vSoft;
void main() {
  float d = length(vC);
  float aa = mix(max(1.3 / vR, 0.035), 0.85, vSoft);   // reflections in the wet road are rough, soft streaks
  float disc = smoothstep(1.0, 1.0 - aa, d);
  float d2 = length(vC + vNdc * uCat);                 // mechanical vignetting: cat-eye discs toward the corners
  disc *= smoothstep(1.0, 1.0 - aa, d2);
  if (disc <= 0.0) discard;
  float rim = 0.86 + 0.22 * smoothstep(0.55, 0.98, d) + 0.025 * sin(d * 31.0);
  vec3 fringe = mix(vec3(1.0), vec3(0.9, 1.0, 1.12), smoothstep(0.82, 1.0, d) * step(4.0, vR));
  gl_FragColor = vec4(vCol * disc * rim * fringe, 1.0);
}`;

// ------------------------------------------------------------------------------------------------ the glass
export const MICRO_FS = /* glsl */`
// 4 cm of glass: two sizes of micro droplets (normal xy in RG, coverage in B) and a mist-density fbm in A, tileable
vec4 bake(vec2 uv) {
  vec3 acc = vec3(0.5, 0.5, 0.0); float best = 0.0;
  for (int L = 0; L < 2; L++) {
    float per = L == 0 ? 44.0 : 90.0;
    vec2 p = uv * per, c = floor(p);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 cell = c + vec2(float(x), float(y));
      vec4 h = kHash42(mod(cell, per) + float(L) * 17.0);
      if (h.w > 0.8) continue;
      vec2 q = p - (cell + 0.15 + 0.7 * h.xy);
      float r = mix(0.12, 0.42, h.z * h.z);
      float d = length(q) / r;
      float cov = smoothstep(1.0, 0.75, d);
      if (cov > best) { best = cov; acc = vec3(0.5 + 0.5 * q / r, cov); }
    }
  }
  return vec4(acc, kFbm2p(uv * 4.0, vec2(4.0), 5));
}`;

export const GLASS_FS = /* glsl */`
uniform sampler2D tBlur, tSharp, tMicro;
uniform vec2 uRes, uCam, uLampUV, uLampDir;
uniform float uAspect, uOS, uGlassH, uPix, uT, uRain, uRun, uMist, uSharpH, uBlurH, uSeed, uWet, uFlash, uLampR, uSpec;
uniform vec4 uW;               // slow weather: w(t) = x + y sin(t/97 + z) + 0.15 sin(t/163 + w)
uniform vec4 uRA, uRA2, uRB, uRB2;   // runner layers: (column cm, R min, R max, speed cm/s), (P min, P max, density, salt)
uniform vec3 uLamp, uRoom, uCandle;

vec2 toBg(vec2 uv) { return (uv - 0.5) / uOS + 0.5; }
float weather(float t) { return clamp(uW.x + uW.y * sin(t / 97.0 + uW.z) + 0.15 * sin(t / 163.0 + uW.w), 0.1, 1.0); }

// one layer of beads on a jittered grid (one cell per pixel: each bead stays inside its cell). Beads are born on rain
// impacts, grow slowly, and are swept away by a runner: a bead older than the trail at this point is gone.
vec4 bead(vec2 g, float cell, vec2 rr, float dens, vec2 life, float salt, float trailAge) {
  vec2 p = g / cell + vec2(salt * 7.31, salt * 3.17);
  vec2 id = floor(p), f = p - id;
  vec4 h0 = kHash42(id + salt * 13.7);
  float L = mix(life.x, life.y, h0.x);
  float s = uT / L + h0.y, k = floor(s), u = s - k;
  if (u * L > trailAge) return vec4(0.0);
  vec4 h = kHash42(id * 1.37 + vec2(k * 11.71, salt * 5.3));
  if (h.w > dens) return vec4(0.0);
  float r = mix(rr.x, rr.y, h.z * h.z) / cell;
  r *= (0.82 + 0.18 * smoothstep(0.0, 0.6, u)) * smoothstep(0.0, 0.3 / L, u);
  vec2 c = 0.5 + (h.xy - 0.5) * max(1.0 - 2.2 * r, 0.0);
  vec2 d = f - c; d.y *= 1.0 + 0.1 * r * cell / rr.y;           // big beads sag a little
  float l = length(d); vec2 n = d / max(l, 1e-5);
  float wob = 1.0 + 0.07 * ((n.x * n.x - n.y * n.y) * (h0.z - 0.5) + 2.0 * n.x * n.y * (h0.w - 0.5)) * 2.0;
  float re = r * wob, px = uPix / cell;
  float cov = kSat((re - l) / px + 0.5) * kSat(re / px * 1.2) * (1.0 - smoothstep(0.965, 1.0, u));
  return vec4(cov, d / re, re * cell);
}

float wig(float y, float ph) {
  return sin(y * 0.43 + ph) * 0.5 + sin(y * 1.21 + ph * 2.1) * 0.27 + (kValue2(vec2(y * 1.9, ph * 7.0)) - 0.5) * 0.62;
}
// runners: drops that grew too heavy. Per column and cycle a drop sits and grows, breaks free, then stick-slips down a
// wiggly path; the path is a function of height, so the wet track it leaves is exactly where it went.
void runners(vec2 g, vec4 A, vec4 B, inout vec4 best, inout float wet, inout float age, inout float film) {
  float cw = A.x, ci0 = floor(g.x / cw);
  for (int j = -1; j <= 1; j++) {
    float ci = ci0 + float(j);
    vec4 hc = kHash42(vec2(ci * 0.917, B.w));
    float P = mix(B.x, B.y, hc.x);
    float s = uT / P + hc.y, k0 = floor(s);
    for (int m = 0; m < 2; m++) {
      float k = k0 - float(m);
      float tau = (s - k) * P;
      vec4 h = kHash42(vec2(ci * 1.71 + k * 3.33, B.w * 7.1 + k * 0.13));
      if (h.w > B.z * weather(uT - tau)) continue;
      float R = mix(A.y, A.z, h.z);
      float tS = mix(0.6, 0.4 * P, h.x * h.x);
      float y0 = mix(-0.25, 0.75, h.y) * uGlassH + uCam.y;
      float ph = h.x * 40.0 + ci * 2.7;
      float xc = (ci + 0.5 + (h.y - 0.5) * 0.3) * cw, amp = cw * 0.24;
      float tm = max(tau - tS, 0.0);
      float te = tm - 0.9 * (1.0 - exp(-tm / 0.9));
      float v = A.w * mix(0.6, 1.45, kHash11(h.z * 91.0 + k)) * (R / A.z);
      float dist = v * (te + 0.6 * (sin(1.7 * te + ph) - sin(ph)) / 1.7 + 0.3 * (sin(4.3 * te + ph * 1.3) - sin(ph * 1.3)) / 4.3);
      float yh = y0 - dist;
      float Rh = R * (0.55 + 0.45 * smoothstep(0.0, tS, tau));
      // the head: a drop with a fuller bottom and a short tail dragged above it
      vec2 d = g - vec2(xc + amp * wig(yh, ph), yh);
      float up = max(d.y, 0.0) / Rh;
      vec2 q = vec2(d.x * (1.0 + 0.6 * up), d.y * (d.y > 0.0 ? 0.74 : 1.06));
      float cov = kSat((Rh - length(q)) / uPix + 0.5);
      if (cov > best.x) best = vec4(cov, q / Rh, Rh);
      if (g.y > yh && g.y < y0 + Rh) {
        float xt = xc + amp * wig(g.y, ph), ad = abs(g.x - xt);
        float a = (g.y - yh) / max(v, 0.01);
        float wT = R * mix(0.6, 0.32, kSat(a / 45.0));
        float band = smoothstep(wT + uPix, wT - uPix, ad) * exp(-a / 40.0);
        if (band > wet) { wet = band; film = (g.x - xt) / wT * band; }
        if (ad < R * 1.15) age = min(age, a);
        // droplets left behind along the track
        float seg = R * 0.9, yi = floor(g.y / seg);
        vec4 hs = kHash42(vec2(yi * 0.71 + ci * 13.1, k + B.w));
        float yc = (yi + 0.5) * seg;
        if (hs.x < 0.72 && yc > yh + Rh * 1.3 && yc < y0) {
          float rt = R * (0.1 + 0.28 * hs.y * hs.y) * (1.0 - 0.3 * kSat(a / 90.0));
          vec2 dc = g - vec2(xc + amp * wig(yc, ph) + (hs.z - 0.5) * R * 0.5, yc + (hs.w - 0.5) * max(seg - 2.0 * rt, 0.0));
          float ct = kSat((rt - length(dc)) / uPix + 0.5) * kSat(rt / uPix * 1.2);
          if (ct > best.x) best = vec4(ct, dc / rt, rt);
        }
      }
    }
  }
}

void main() {
  vec2 uv = vUv;
  vec2 sp = (uv - 0.5) * vec2(uAspect, 1.0);
  vec2 g = sp * uGlassH + uCam;                               // this pixel on the glass (cm)
  vec4 best = vec4(0.0); float wet = 0.0, age = 1e5, film = 0.0;
  runners(g, uRA, uRA2, best, wet, age, film);
#ifdef RUN2
  runners(g, uRB, uRB2, best, wet, age, film);
#endif
  float w = weather(uT);
  vec4 b;
  b = bead(g, 0.62, vec2(0.05, 0.27), 0.42 * uWet * (0.6 + 0.4 * w), vec2(40.0, 110.0), 1.0, age); if (b.x > best.x) best = b;
  b = bead(g, 0.31, vec2(0.025, 0.1), 0.72 * uWet, vec2(30.0, 90.0), 2.0, age); if (b.x > best.x) best = b;
#ifdef BEADC
  b = bead(g, 0.16, vec2(0.014, 0.05), 0.85 * uWet, vec2(25.0, 70.0), 3.0, age); if (b.x > best.x) best = b;
#endif
  b = bead(g, 0.47, vec2(0.035, 0.13), uRain, vec2(3.5, 11.0), 4.0, age); if (b.x > best.x) best = b;
  b = bead(g + vec2(0.23, 0.11), 0.47, vec2(0.03, 0.11), uRain * 0.7, vec2(2.5, 8.0), 5.0, age); if (b.x > best.x) best = b;

  // condensation mist: patchy, heavier low on the pane, wiped clear along the tracks
  vec4 mic = texture2D(tMicro, g / 4.0);
  float mlo = texture2D(tMicro, g / 37.0 + 0.31).a * 0.6 + texture2D(tMicro, g / 23.0 + vec2(0.7, 0.2)).a * 0.4;
  float mist = uMist * smoothstep(0.36, 0.64, mlo) * (0.65 + 0.7 * smoothstep(0.25 * uGlassH, -0.5 * uGlassH, g.y - uCam.y));
  mist = kSat(mist) * (1.0 - wet);

  // through the glass: the defocused world, blurred and veiled where misted
  vec2 ub = toBg(uv);
  vec2 mo = (mic.xy - 0.5) * 2.0 * mic.z * mist * 0.006;
  vec3 clr = textureLod(tBlur, ub + mo + vec2(film * 0.0035, 0.0), 0.0).rgb * (1.0 + 0.06 * wet);
  vec3 haze = textureLod(tBlur, ub, 3.2).rgb * 0.45 + textureLod(tBlur, ub + vec2(0.0, 0.006), 4.2).rgb * 0.35 + textureLod(tBlur, ub, 5.5).rgb * 0.2;
  vec2 lp = (uv - uLampUV) * vec2(uAspect, 1.0);
  float lampNear = exp(-dot(lp, lp) / (uLampR * uLampR * 9.0));
  vec3 col = mix(clr, haze * 1.1, mist * 0.92) + (uRoom * 0.8 + uLamp * 0.008 * lampNear) * mist;
  col *= 1.0 - 0.12 * mic.z * mist;

  // water drops: a tiny lens each - the scene inverted and minified (sharp, the drop images it near the glass),
  // darkened toward the rim where light is totally internally reflected, with a warm glint of the room lamp
  if (best.x > 0.0) {
    vec2 o = best.yz; float e = kSat(length(o)), r = best.w;
    float D = 0.21 * (0.85 + 0.35 * e * e);
    vec2 ud = toBg(uv - vec2(o.x / uAspect, o.y) * D);
    float lod = log2(max(D / max(r / uGlassH, 1e-4) * uSharpH / uOS / uRes.y, 1.0)) + 0.4;
    vec3 tr = textureLod(tSharp, ud, lod).rgb * 0.62 + textureLod(tBlur, ud, 1.0).rgb * 0.38;
    float rim = smoothstep(0.55, 1.0, e);
    vec3 dc = tr * (0.96 - 0.82 * rim * rim);
    vec2 gp = o - uLampDir * 0.48;
    vec3 glint = mix(uLamp, vec3(kLuma(uLamp)), 0.45) * uSpec * smoothstep(0.012, 0.07, r);   // a bright highlight reads warm-white
    dc += glint * (exp(-dot(gp, gp) / 0.010) + 0.25 * exp(-dot(gp, gp) / 0.06));
    vec2 gq = o + uLampDir * 0.62;
    dc += glint * 0.08 * exp(-dot(gq, gq) / 0.02);
    dc += (uRoom * 1.5 + uLamp * 0.004) * rim * rim;
    col = mix(col, dc, best.x);
  }

  // a faint reflection of the dim room: the lamp, very out of focus, and a candle glow low on the sill
  float lampDisc = smoothstep(uLampR, uLampR * 0.55, length(lp));
  vec3 refl = uRoom + uLamp * (0.026 * lampDisc + 0.01 * lampNear);
  col += refl * (1.0 - 0.35 * best.x);
  vec2 cp = (uv - vec2(0.86, -0.08)) * vec2(uAspect, 1.0);
  col += uCandle * exp(-dot(cp, cp) / 0.09);
  gl_FragColor = vec4(col, 1.0);
}`;
