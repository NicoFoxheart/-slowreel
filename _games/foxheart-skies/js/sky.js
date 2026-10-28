// Physically based sky (single-scattering Rayleigh + Mie, rendered to a small LUT), sun/moon, stars,
// aerial perspective shared by every material, layered clouds and rain.
import * as THREE from 'three';
import { D2R } from './data.js';

export const ATM = {
  uSkyLUT: { value: null }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uHazeK: { value: 4e-5 }, uHazeH: { value: 1400 }, uFogTint: { value: new THREE.Color(0.6, 0.62, 0.66) }, uFogTintMix: { value: 0 },
  uTime: { value: 0 }, uNight: { value: 0 }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uAmbCol: { value: new THREE.Color(0.3, 0.4, 0.5) },
};

export const ATM_GLSL = /* glsl */`
uniform sampler2D uSkyLUT; uniform vec3 uSunDir; uniform float uHazeK; uniform float uHazeH; uniform vec3 uFogTint; uniform float uFogTintMix;
vec2 atmLutUV(vec3 d){ float az = atan(d.x, -d.z); float el = asin(clamp(d.y,-1.,1.)); return vec2(az*0.15915494+0.5, 0.5 + 0.5*sign(el)*sqrt(abs(el)/1.5707963)); }
vec3 atmSky(vec3 d){ return texture2D(uSkyLUT, atmLutUV(d)).rgb; }
float atmTrans(vec3 rel){
  float dist = length(rel); float h0 = max(cameraPosition.y, 0.0); float h1 = max(h0 + rel.y, 0.0);
  float a = exp(-h0/uHazeH), b = exp(-h1/uHazeH); float dh = h1 - h0;
  float od = abs(dh) < 1.0 ? uHazeK*a*dist : uHazeK*dist*uHazeH*(a-b)/dh;
  return exp(-od);
}
vec3 atmFogCol(vec3 d){ vec3 fc = atmSky(normalize(vec3(d.x, max(d.y,0.0)*0.5+0.02, d.z))); return mix(fc, uFogTint, uFogTintMix); }
vec3 atmApply(vec3 col, vec3 rel){ float T = atmTrans(rel); return col*T + atmFogCol(rel/max(length(rel),1e-3))*(1.0-T); }
`;

// Patch any built-in material so it uses the shared aerial perspective instead of three's flat fog.
export function atmos(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    for (const k of ['uSkyLUT', 'uSunDir', 'uHazeK', 'uHazeH', 'uFogTint', 'uFogTintMix']) sh.uniforms[k] = ATM[k];
    sh.vertexShader = sh.vertexShader.replace('#include <fog_pars_vertex>', 'varying vec3 vAtmRel;').replace('#include <fog_vertex>', 'vAtmRel = mvPosition.xyz * mat3(viewMatrix);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <fog_pars_fragment>', 'varying vec3 vAtmRel;\n' + ATM_GLSL)
      .replace('#include <fog_fragment>', mat.userData.additive ? 'gl_FragColor.rgb *= atmTrans(vAtmRel);' : 'gl_FragColor.rgb = atmApply(gl_FragColor.rgb, vAtmRel);');
    prev && prev.call(mat, sh, r);
  };
  mat.customProgramCacheKey = () => 'atm' + (mat.userData.additive ? 'A' : '') + (mat.userData.key || '');
  return mat;
}

const LUT_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const LUT_FS = /* glsl */`
precision highp float; varying vec2 vUv;
uniform vec3 uSun; uniform float uAlt; uniform float uSunI; uniform float uMie; uniform float uOvercast; uniform vec3 uNightFloor;
const float PI = 3.14159265; const float Re = 6360e3; const float Ra = 6420e3; const float Hr = 8000.0; const float Hm = 1200.0;
const vec3 bR = vec3(5.8e-6, 13.5e-6, 33.1e-6);
vec2 rs(vec3 ro, vec3 rd, float r){ float b = dot(ro, rd); float c = dot(ro, ro) - r*r; float d = b*b - c; if (d < 0.0) return vec2(1e9, -1e9); d = sqrt(d); return vec2(-b-d, -b+d); }
void main(){
  float az = (vUv.x - 0.5) * 2.0 * PI; float s = vUv.y*2.0 - 1.0; float el = sign(s) * s*s * PI*0.5;
  vec3 rd = vec3(sin(az)*cos(el), sin(el), -cos(az)*cos(el));
  vec3 ro = vec3(0.0, Re + clamp(uAlt, 2.0, 20000.0), 0.0);
  vec2 ta = rs(ro, rd, Ra); float tmax = ta.y; vec2 tg = rs(ro, rd, Re); bool ground = tg.x > 0.0; if (ground) tmax = min(tmax, tg.x);
  tmax = min(tmax, 400e3);
  vec3 bM = vec3(21e-6 * uMie);
  float seg = tmax / 16.0; float t = 0.0; vec3 sR = vec3(0.0), sM = vec3(0.0); float oR = 0.0, oM = 0.0;
  float mu = dot(rd, uSun); float pR = 3.0/(16.0*PI)*(1.0+mu*mu); float g = 0.76;
  float pM = 3.0/(8.0*PI)*((1.0-g*g)*(1.0+mu*mu))/((2.0+g*g)*pow(1.0+g*g-2.0*g*mu, 1.5));
  for (int i = 0; i < 16; i++) {
    vec3 p = ro + rd*(t + seg*0.5); float h = length(p) - Re; float hr = exp(-h/Hr)*seg, hm = exp(-h/Hm)*seg; oR += hr; oM += hm;
    vec2 tl = rs(p, uSun, Ra); float sl = tl.y/8.0; float t2 = 0.0; float lR = 0.0, lM = 0.0; bool sh = false;
    for (int j = 0; j < 8; j++) { vec3 q = p + uSun*(t2 + sl*0.5); float hq = length(q) - Re; if (hq < 0.0) { sh = true; break; } lR += exp(-hq/Hr)*sl; lM += exp(-hq/Hm)*sl; t2 += sl; }
    if (!sh) { vec3 att = exp(-(bR*(oR+lR) + bM*1.1*(oM+lM))); sR += att*hr; sM += att*hm; }
    t += seg;
  }
  vec3 col = uSunI * (sR*bR*pR + sM*bM*pM);
  if (ground) { vec3 att = exp(-(bR*oR + bM*1.1*oM)); col += att * vec3(0.05, 0.06, 0.05) * max(uSun.y, 0.0) * uSunI * 0.12; }
  col += uNightFloor * (0.6 + 0.4*max(rd.y, 0.0));
  // overcast deck: grey, brighter towards zenith, very flat
  float lum = dot(col, vec3(0.3, 0.55, 0.15));
  float day = smoothstep(-0.12, 0.25, uSun.y);
  vec3 oc = vec3(0.78, 0.81, 0.86) * (0.004 + 1.3*day) * (0.75 + 0.35*max(rd.y, 0.0)) * uSunI/22.0 * 0.9 + uNightFloor * 0.6;
  col = mix(col, oc, uOvercast * smoothstep(-0.25, 0.05, rd.y));
  gl_FragColor = vec4(col, 1.0);
}`;

const DOME_FS = /* glsl */`
varying vec3 vDir; uniform vec3 uSunCol; uniform vec3 uMoonDir; uniform float uMoon; uniform float uSunDisc; uniform float uNight;
${ATM_GLSL}
void main(){
  vec3 d = normalize(vDir);
  vec3 col = atmSky(d);
  float sd = dot(d, uSunDir);
  col += uSunCol * uSunDisc * (smoothstep(0.99996, 0.999985, sd) * 60.0 + pow(max(sd, 0.0), 900.0) * 1.5);
  float md = dot(d, uMoonDir);
  col += vec3(0.9, 0.92, 1.0) * uMoon * smoothstep(0.99990, 0.99993, md) * 0.5 + vec3(0.6,0.7,0.9)*uMoon*pow(max(md,0.0), 400.0)*0.02;
  col = mix(col, atmFogCol(d), uFogTintMix * (1.0 - smoothstep(-0.05, 0.35, d.y)));
  gl_FragColor = vec4(col, 1.0);
  #include <logdepthbuf_fragment>
}`;
const DOME_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main(){ vDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

const NOISE_GLSL = /* glsl */`
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
float fbm5(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a*vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6)*p + 3.1; a *= 0.5; } return s; }
`;
export { NOISE_GLSL };

const CLOUD_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;
const CLOUD_FS = /* glsl */`
varying vec3 vW; uniform float uCover; uniform float uScale; uniform vec2 uOff; uniform vec3 uSunCol; uniform vec3 uAmbCol; uniform float uLayer; uniform float uDark; uniform float uFade;
${ATM_GLSL}
${NOISE_GLSL}
float dens(vec2 p){
  float n = fbm5(p * uScale + uOff) ;
  float m = fbm5(p * uScale * 4.3 - uOff*1.7 + 11.0);
  float v = n*0.75 + m*0.35;
  return smoothstep(1.02 - uCover, 1.02 - uCover + 0.28, v);
}
void main(){
  vec3 rel = vW - cameraPosition; float dist = length(rel); vec3 vd = rel / dist;
  float d = dens(vW.xz);
  if (d < 0.01) discard;
  vec2 sdir = normalize(uSunDir.xz + 1e-4);
  float dl = dens(vW.xz + sdir * 650.0);
  bool below = cameraPosition.y < vW.y;
  float sunUp = smoothstep(-0.08, 0.15, uSunDir.y);
  float mu = max(dot(vd, uSunDir), 0.0);
  vec3 col;
  if (below) {
    float thick = d;
    col = uAmbCol * (1.05 - 0.55*thick) * (1.0 - uDark*0.5) + uSunCol * sunUp * (0.35*(1.0 - thick) + 0.9*pow(mu, 6.0)*(1.0 - thick)) ;
  } else {
    float lit = exp(-dl*1.8);
    col = uAmbCol * 0.55 + uSunCol * sunUp * (0.45 + 0.75*lit) * (0.6 + 0.4*max(uSunDir.y, 0.0));
  }
  col *= (1.0 - 0.18*uLayer);
  float a = d * (0.92 - 0.25*uLayer);
  a *= 1.0 - smoothstep(uFade*0.55, uFade, dist);
  col = atmApply(col, rel);
  gl_FragColor = vec4(col * a, a);
  #include <logdepthbuf_fragment>
}`;

const RAIN_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aEnd; uniform float uT; uniform vec3 uCam; uniform vec3 uVel; varying float vA;
void main(){
  vec3 p = position; float box = 60.0;
  p.y = mod(p.y - uT * 9.0, box) - box*0.5;
  p.xz = mod(p.xz - uCam.xz + box*0.5, box) - box*0.5;
  vec3 w = uCam + p;
  vec3 streak = (vec3(0.0, -9.0, 0.0) - uVel) * 0.035;
  w += streak * aEnd;
  vA = (1.0 - aEnd*0.7) * (1.0 - smoothstep(10.0, 30.0, length(p)));
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  #include <logdepthbuf_vertex>
}`;
const RAIN_FS = /* glsl */`
#include <logdepthbuf_pars_fragment>
varying float vA; uniform vec3 uCol; uniform float uAlpha;
void main(){ gl_FragColor = vec4(uCol * vA * uAlpha, vA * uAlpha);
  #include <logdepthbuf_fragment>
}`;

export class Sky {
  constructor(renderer, scene, quality) {
    this.renderer = renderer; this.scene = scene; this.quality = quality;
    this.lut = new THREE.WebGLRenderTarget(256, 128, { type: THREE.HalfFloatType, depthBuffer: false, wrapS: THREE.RepeatWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.lut.texture.wrapS = THREE.RepeatWrapping;
    ATM.uSkyLUT.value = this.lut.texture;
    this.lutMat = new THREE.ShaderMaterial({ vertexShader: LUT_VS, fragmentShader: LUT_FS, depthTest: false, depthWrite: false,
      uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uAlt: { value: 10 }, uSunI: { value: 22 }, uMie: { value: 1 }, uOvercast: { value: 0 }, uNightFloor: { value: new THREE.Vector3(0.0012, 0.0019, 0.0042) } } });
    this.lutScene = new THREE.Scene(); this.lutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.lutScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lutMat));

    this.domeMat = new THREE.ShaderMaterial({ vertexShader: DOME_VS, fragmentShader: '#include <common>\n#include <logdepthbuf_pars_fragment>\n' + DOME_FS, side: THREE.BackSide, depthWrite: false,
      uniforms: { ...ATM, uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: 0 }, uSunDisc: { value: 1 } } });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.domeMat);
    this.dome.scale.setScalar(190000); this.dome.renderOrder = -10; this.dome.frustumCulled = false;
    scene.add(this.dome);

    // stars
    const N = 2600, sp = new Float32Array(N * 3), sc = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      sp[i * 3] = r * Math.cos(t); sp[i * 3 + 1] = Math.abs(u) * 0.98 + 0.02; sp[i * 3 + 2] = r * Math.sin(t);
      sc[i] = Math.pow(Math.random(), 6) * 2.4 + 0.25;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('aMag', new THREE.BufferAttribute(sc, 1));
    this.starMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uNight: ATM.uNight, uTime: ATM.uTime, uDim: { value: 1 } },
      vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\nattribute float aMag; varying float vB; uniform float uNight; uniform float uTime; uniform float uDim;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float tw = 0.8 + 0.2*sin(uTime*3.0 + position.x*400.0);
        vB = aMag * uNight * uDim * tw * smoothstep(0.0, 0.12, position.y); gl_PointSize = 1.2 + aMag*1.1;\n#include <logdepthbuf_vertex>\n}`,
      fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\nvarying float vB; void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)); gl_FragColor = vec4(vec3(0.85,0.9,1.0)*vB*a*0.9, 1.0);\n#include <logdepthbuf_fragment>\n}` });
    this.stars = new THREE.Points(sg, this.starMat); this.stars.scale.setScalar(180000); this.stars.frustumCulled = false; this.stars.renderOrder = -9;
    scene.add(this.stars);

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3); this.sun.position.set(0, 1, 0); scene.add(this.sun); scene.add(this.sun.target);
    this.amb = new THREE.AmbientLight(0x223344, 0.0); scene.add(this.amb);

    // clouds: two stacked procedural layers following the camera
    this.clouds = [];
    for (let i = 0; i < 2; i++) {
      const m = new THREE.ShaderMaterial({ vertexShader: CLOUD_VS, fragmentShader: '#include <common>\n#include <logdepthbuf_pars_fragment>\n' + CLOUD_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        uniforms: { ...ATM, uCover: { value: 0 }, uScale: { value: 1 / 5200 }, uOff: { value: new THREE.Vector2(i * 37.1, i * 11.3) }, uLayer: { value: i }, uDark: { value: 0 }, uFade: { value: 70000 } } });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(160000, 160000, 1, 1).rotateX(-Math.PI / 2), m);
      mesh.frustumCulled = false; mesh.renderOrder = 5 + i; mesh.visible = false; scene.add(mesh); this.clouds.push(mesh);
    }
    // rain
    const RN = 5000, rp = new Float32Array(RN * 6), re = new Float32Array(RN * 2);
    for (let i = 0; i < RN; i++) { const x = (Math.random() - .5) * 60, y = (Math.random() - .5) * 60, z = (Math.random() - .5) * 60; rp.set([x, y, z, x, y, z], i * 6); re[i * 2] = 0; re[i * 2 + 1] = 1; }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3)); rg.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
    this.rainMat = new THREE.ShaderMaterial({ vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { uT: { value: 0 }, uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() }, uCol: { value: new THREE.Color(0.55, 0.6, 0.68) }, uAlpha: { value: 0.35 } } });
    this.rain = new THREE.LineSegments(rg, this.rainMat); this.rain.frustumCulled = false; this.rain.visible = false; this.rain.renderOrder = 8; scene.add(this.rain);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(this.dome.geometry, this.domeMat); this.envDome.scale.setScalar(100); this.envScene.add(this.envDome);
    this.envGroundMat = new THREE.MeshBasicMaterial({ color: 0x334433, side: THREE.DoubleSide });
    const eg = new THREE.Mesh(new THREE.CircleGeometry(400, 32).rotateX(-Math.PI / 2), this.envGroundMat); eg.position.y = -8; this.envScene.add(eg);
    this.envRT = null;

    this.sunDir = new THREE.Vector3(0, 1, 0); this.moonDir = new THREE.Vector3(0, 1, 0);
    this.sunElev = 45; this.weather = { cover: 0, base: 1500, thick: 900, overcast: 0, rain: 0, vis: 60000, haze: 1, fog: 0 };
    this.lutAlt = -1e9; this.lutDirty = true; this.envAge = 1e9; this.exposure = 0.6; this.inCloud = 0;
  }

  setSun(elevDeg, azDeg) {
    const e = elevDeg * D2R, a = azDeg * D2R;
    this.sunDir.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
    // moon: stylised position (opposite-ish to the sun, high in the night sky)
    const me = Math.max(18, 55 - Math.max(0, elevDeg) * 0.5) * D2R, ma = (azDeg + 160) * D2R;
    this.moonDir.set(Math.sin(ma) * Math.cos(me), Math.sin(me), -Math.cos(ma) * Math.cos(me));
    this.sunElev = elevDeg; this.lutDirty = true; this.envAge = 1e9;
  }

  setWeather(kind, wind) {
    const W = {
      clear: { cover: 0.18, base: 2600, thick: 700, overcast: 0, rain: 0, vis: 110000, haze: 1.0, dark: 0 },
      scattered: { cover: 0.46, base: 1500, thick: 900, overcast: 0, rain: 0, vis: 75000, haze: 1.3, dark: 0.1 },
      overcast: { cover: 0.97, base: 900, thick: 1200, overcast: 0.88, rain: 0, vis: 22000, haze: 1.8, dark: 0.45 },
      rain: { cover: 0.99, base: 500, thick: 2200, overcast: 0.96, rain: 1, vis: 5500, haze: 2.5, dark: 0.7 },
      fog: { cover: 0.9, base: 120, thick: 300, overcast: 0.7, rain: 0, vis: 700, haze: 2.5, dark: 0.3, fog: 1 },
    }[kind] || {};
    this.weather = { kind, ...W, fog: W.fog || 0 };
    this.lutDirty = true; this.envAge = 1e9;
  }

  // visibility in metres → haze extinction at sea level
  hazeFor(vis) { return 3.9 / vis; }

  update(dt, camera, simTime) {
    const w = this.weather, camY = camera.position.y;
    ATM.uTime.value = simTime;
    const night = 1 - THREE.MathUtils.smoothstep(this.sunElev, -10, -2);
    ATM.uNight.value = night;
    ATM.uSunDir.value.copy(this.sunDir);
    // haze: visibility with exponential height profile; fog weather uses a thin dense layer
    let hk = this.hazeFor(w.vis), hh = w.fog ? 220 : 1300 + 400 * (1 - w.overcast);
    // inside cloud: whiteout
    const inC = w.cover > 0.6 && camY > w.base && camY < w.base + w.thick ? 1 : (w.cover > 0.35 && camY > w.base && camY < w.base + w.thick * 0.5 ? 0.35 : 0);
    this.inCloud += (inC - this.inCloud) * Math.min(1, dt * 2);
    hk = THREE.MathUtils.lerp(hk, 0.02, this.inCloud); if (this.inCloud > 0.05) hh = Math.max(hh, 3000);
    ATM.uHazeK.value = hk; ATM.uHazeH.value = hh;
    const sunUp = THREE.MathUtils.smoothstep(this.sunElev, -6, 8);
    const gray = 0.008 + 0.7 * sunUp;
    ATM.uFogTint.value.setRGB(gray * 0.86, gray * 0.89, gray * 0.94).multiplyScalar(1 + this.inCloud * 0.4);
    ATM.uFogTintMix.value = Math.max(w.overcast * 0.75, this.inCloud);

    // LUT refresh when sun or altitude changed
    if (this.lutDirty || Math.abs(camY - this.lutAlt) > 300) {
      const u = this.lutMat.uniforms; u.uSun.value.copy(this.sunDir); u.uAlt.value = camY; u.uMie.value = w.haze; u.uOvercast.value = w.overcast;
      const prev = this.renderer.getRenderTarget(); this.renderer.setRenderTarget(this.lut); this.renderer.render(this.lutScene, this.lutCam); this.renderer.setRenderTarget(prev);
      this.lutAlt = camY; this.lutDirty = false;
    }
    // sun light colour: transmittance through the air mass
    const el = Math.max(this.sunElev, -2) * D2R, am = 1 / (Math.sin(Math.max(el, 0.01)) + 0.15 * Math.pow(Math.max(this.sunElev, 0) + 3.885, -1.253));
    const tr = [Math.exp(-0.06 * am * w.haze), Math.exp(-0.13 * am * w.haze), Math.exp(-0.30 * am * w.haze)];
    const sunVis = THREE.MathUtils.smoothstep(this.sunElev, -3, 2);
    const ocDim = 1 - 0.82 * w.overcast;
    ATM.uSunCol.value.setRGB(tr[0], tr[1], tr[2]).multiplyScalar(3.2 * sunVis);
    this.domeMat.uniforms.uSunDisc.value = (1 - w.overcast) * sunVis;
    this.domeMat.uniforms.uMoonDir.value.copy(this.moonDir); this.domeMat.uniforms.uMoon.value = night * (1 - w.overcast);
    const zen = this.skyApprox();
    ATM.uAmbCol.value.copy(zen);
    if (sunVis > 0.01) {
      this.sun.position.copy(this.sunDir).multiplyScalar(1000).add(camera.position);
      this.sun.color.setRGB(tr[0], tr[1], tr[2]); this.sun.intensity = 3.0 * sunVis * ocDim;
    } else {
      this.sun.position.copy(this.moonDir).multiplyScalar(1000).add(camera.position);
      this.sun.color.setRGB(0.55, 0.65, 0.9); this.sun.intensity = 0.06 * (1 - w.overcast * 0.8);
    }
    this.sun.target.position.copy(camera.position);
    this.amb.color.setRGB(0.32, 0.38, 0.55); this.amb.intensity = 0.06 * night + 0.25 * w.overcast * sunUp;
    // exposure: daylight vs twilight vs night (simple auto-exposure)
    let ex = this.sunElev > 12 ? 0.55 : this.sunElev > 0 ? THREE.MathUtils.lerp(1.0, 0.55, this.sunElev / 12) : this.sunElev > -8 ? THREE.MathUtils.lerp(1.0, 2.6, -this.sunElev / 8) : 2.6;
    ex *= 1 + w.overcast * 0.55 * sunUp;
    this.exposure = ex;

    // dome & stars follow the camera
    this.dome.position.copy(camera.position); this.stars.position.copy(camera.position);
    this.starMat.uniforms.uDim.value = 1 - w.overcast;
    this.stars.visible = night > 0.02 && w.overcast < 0.9;
    // clouds
    const scale = w.overcast > 0.5 ? 1 / 3800 : 1 / 5600;
    this.clouds.forEach((c, i) => {
      c.visible = w.cover > 0.02 && (i === 0 || this.quality !== 'low');
      c.position.set(Math.round(camera.position.x / 500) * 500, w.base + i * w.thick * 0.55, Math.round(camera.position.z / 500) * 500);
      const u = c.material.uniforms; u.uCover.value = i === 0 ? w.cover : w.cover * 0.85; u.uScale.value = scale * (i ? 1.3 : 1);
      u.uOff.value.x += dt * 0.00018 * (i ? 1.2 : 1); u.uDark.value = w.dark || 0; u.uFade.value = w.vis < 8000 ? 30000 : 75000;
    });
    // rain
    this.rain.visible = w.rain > 0 && this.quality !== 'off';
    this.rainMat.uniforms.uT.value = simTime; this.rainMat.uniforms.uCam.value.copy(camera.position);
    this.rainMat.uniforms.uAlpha.value = 0.12 + 0.3 * sunUp; this.rainMat.uniforms.uCol.value.setRGB(0.55, 0.6, 0.68).multiplyScalar(0.12 + 0.88 * sunUp);

    // environment map (reflections/ambient for PBR materials)
    this.envAge += dt;
    if (this.envAge > 30) { this.updateEnv(); this.envAge = 0; }
  }

  skyApprox() { // rough zenith/ambient colour for non-PBR shaders
    const s = THREE.MathUtils.smoothstep(this.sunElev, -8, 20), n = 1 - THREE.MathUtils.smoothstep(this.sunElev, -10, -2);
    const c = new THREE.Color(0.20 * s + 0.010 * n, 0.32 * s + 0.016 * n, 0.55 * s + 0.032 * n);
    const g = this.weather.overcast; const l = (c.r + c.g + c.b) / 3;
    return c.lerp(new THREE.Color(l * 1.1, l * 1.12, l * 1.18), g);
  }

  updateEnv() {
    const s = THREE.MathUtils.smoothstep(this.sunElev, -6, 15);
    this.envGroundMat.color.setRGB(0.05 * s + 0.002, 0.06 * s + 0.002, 0.045 * s + 0.003);
    const old = this.envRT;
    this.envDome.position.set(0, 0, 0);
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
    this.scene.environment = this.envRT.texture;
    if (old) old.dispose();
  }
}
