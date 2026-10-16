// heart-scene.js - Nicofoxheart's glowing 3D heart with fox ears (from his first music page), as a music-video scene:
// dusk-violet sky with drifting haze and stars, a soft halo, the heart pulsing with the low end, ears twitching on
// accents, colour breathing with the mids and highs, sakura petals and fox-fire sparks, a calm drifting camera,
// title + artist text. Everything is a pure function of (time, audio numbers), so an offline export is frame-exact.
// three.js is injected (setThree) so the same scene runs on the page (import map) and in the render worker.
let THREE = null;
export function setThree(T) { THREE = T; }
const HAS_DOM = typeof document !== 'undefined';
const mkCanvas = (w, h) => { if (HAS_DOM) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; } return new OffscreenCanvas(w, h); };

export const MOODS = {
  sakura: { name: 'Sakura dusk', sky: ['#0d0b1f', '#1d1640', '#3b1d58'], haze: '#ff8fc7', heart: '#ff7fbf', heart2: '#ffb0d8', emissive: '#6a1146',
    sheen: '#ffd0ea', ear: '#ffa65c', earTip: '#8a3428', inner: '#ffe0ef', halo: '#ff8fc7', halo2: '#ffb36b', rim: '#ffc4e4', key: '#ffd6ec',
    back: '#7fd6ff', sparks: ['#ffb36b', '#ff8fc7', '#7fd6ff', '#fff1f8'], petal: ['#ffd6ec', '#ffbfdd', '#fff2f8'], ring: '#c4b4ff', ink: '#f3eefe', accent: '#ff8fc7' },
  kitsune: { name: 'Fox fire', sky: ['#0e0812', '#2a1026', '#5a2230'], haze: '#ffb36b', heart: '#ff7f8f', heart2: '#ffb36b', emissive: '#6e1c14',
    sheen: '#ffd9b8', ear: '#ffa04a', earTip: '#6e2414', inner: '#fff0e0', halo: '#ffa05c', halo2: '#ff6f91', rim: '#ffd29a', key: '#ffe2c4',
    back: '#ff6f91', sparks: ['#ffb36b', '#ffd27a', '#ff7a5c', '#fff3dc'], petal: ['#ffd8b8', '#ffc29a', '#ffeedd'], ring: '#ffc99a', ink: '#fff3e8', accent: '#ffb36b' },
  moon: { name: 'Moon rain', sky: ['#050816', '#0f1c40', '#26386a'], haze: '#7fd6ff', heart: '#f39ad2', heart2: '#c9b8ff', emissive: '#3a1452',
    sheen: '#dfe8ff', ear: '#ffb37a', earTip: '#5a2a50', inner: '#f2eaff', halo: '#8fbfff', halo2: '#ff9fd6', rim: '#bfe6ff', key: '#e6eeff',
    back: '#7fd6ff', sparks: ['#7fd6ff', '#c9d8ff', '#ffffff', '#ffb6e6'], petal: ['#e8efff', '#d8e2ff', '#ffe6f4'], ring: '#a9c4ff', ink: '#eef3ff', accent: '#7fd6ff' },
};
const FOV = 32, DEG = Math.PI / 180;
const hexVec = h => { const n = parseInt(h.slice(1), 16); return new THREE.Vector3((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const SKY_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const SKY_FS = `precision highp float;
uniform vec3 cTop, cMid, cLow, cHaze, cHalo, cHalo2; uniform float uTime, uAspect, uGlow, uWarm, uStars; uniform vec2 uCenter; varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= .5; } return v; }
void main(){
  vec2 uv = vUv; vec2 p = vec2((uv.x - .5) * uAspect, uv.y - .5);
  vec3 col = mix(cLow, cMid, smoothstep(0., .5, uv.y)); col = mix(col, cTop, smoothstep(.42, 1., uv.y));
  col += cHaze * .10 * smoothstep(.45, 0., uv.y);
  float n = fbm(vec2(p.x * 1.4 + uTime * .010, p.y * 3.0 - uTime * .003));
  float n2 = fbm(vec2(p.x * 2.6 - uTime * .014, p.y * 5.0 + 3.1));
  col = mix(col, col + cHaze * .10 + cHalo2 * .03, smoothstep(.48, .82, n) * smoothstep(.85, .1, uv.y));
  col += cTop * .5 * smoothstep(.55, .9, n2) * smoothstep(.3, .9, uv.y);
  vec2 sp = p * 70.; vec2 ci = floor(sp); vec2 cf = fract(sp) - .5; float h = hash(ci);
  vec2 off = vec2(hash(ci + 7.1), hash(ci + 3.3)) - .5; float d = length(cf - off * .6);
  float star = smoothstep(.10, 0., d) * step(.955, h) * (.45 + .55 * sin(uTime * (.7 + h * 2.4) + h * 40.));
  col += star * uStars * smoothstep(.3, .85, uv.y) * vec3(1., .94, 1.);
  float r = length((p - uCenter) * vec2(1., 1.05));
  col += mix(cHalo, cHalo2, uWarm) * (exp(-r * 2.6) * .30 + exp(-r * 7.) * .22) * uGlow;
  gl_FragColor = vec4(pow(max(col, 0.), vec3(2.2)), 1.);
}`;
const RIM_VS = `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const RIM_FS = `uniform vec3 uColor; uniform float uStrength; varying vec3 vN; varying vec3 vV;
void main(){ float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), 2.2); gl_FragColor = vec4(uColor * f * uStrength, 1.); }`;
const SPARK_VS = `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale; varying vec3 vC; varying float vA;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = max(1., aSize * uScale / -mv.z); gl_Position = projectionMatrix * mv; vC = aColor; vA = aAlpha; }`;
const SPARK_FS = `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - .5) * 2.; float a = smoothstep(1., 0., d); a *= a;
  float core = smoothstep(.28, 0., d); gl_FragColor = vec4(vC * (a * .55 + core * .9) * vA, 1.); }`;
const POST_FS = `precision highp float; uniform sampler2D tScene; uniform float uBloom, uExposure, uTime; varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 aces(vec3 x){ x *= uExposure * .6; return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }
void main(){
  vec3 c = texture2D(tScene, vUv).rgb;
  vec3 b = textureLod(tScene, vUv, 2.5).rgb * .22 + textureLod(tScene, vUv, 4.).rgb * .34 + textureLod(tScene, vUv, 5.5).rgb * .44;
  c += max(b - vec3(.16), 0.) * uBloom;
  c = pow(aces(c), vec3(1. / 2.2));
  c += (hash(gl_FragCoord.xy + fract(uTime * 7.) * 91.) - .5) / 255.;
  gl_FragColor = vec4(c, 1.);
}`;
const VIG_FS = `uniform float uFade, uAspect, uText; varying vec2 vUv;
void main(){ vec2 p = (vUv - .5) * vec2(uAspect, 1.); float v = smoothstep(.45, 1.15, length(p / vec2(max(uAspect, 1.), max(1. / uAspect, 1.)) * 1.25));
  float bottom = smoothstep(.42, 0., vUv.y) * .35 * uText; float a = clamp(v * .55 + bottom, 0., 1.); a = 1. - (1. - a) * (1. - uFade);
  gl_FragColor = vec4(0., 0., 0., a); }`;

function radialTexture(stops) {
  const c = mkCanvas(128, 128), g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); stops.forEach(([o, a]) => gr.addColorStop(o, `rgba(255,255,255,${a})`));
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); return t;
}
function petalTexture() {
  const c = mkCanvas(64, 64), g = c.getContext('2d');
  g.translate(32, 34); g.beginPath(); g.moveTo(0, 28); g.bezierCurveTo(-22, 14, -20, -14, -7, -26); g.lineTo(0, -19); g.lineTo(7, -26); g.bezierCurveTo(20, -14, 22, 14, 0, 28); g.closePath();
  const gr = g.createLinearGradient(0, 28, 0, -26); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.55, 'rgba(255,236,246,.95)'); gr.addColorStop(1, 'rgba(255,200,228,.9)');
  g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(255,170,210,.5)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, 22); g.lineTo(0, -8); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function heartGeometry(light) {
  const s = new THREE.Shape(), x = -2.5, y = -5;
  s.moveTo(x + 2.5, y + 2.5); s.bezierCurveTo(x + 2.5, y + 2.5, x + 2, y, x, y); s.bezierCurveTo(x - 3, y, x - 3, y + 3.5, x - 3, y + 3.5);
  s.bezierCurveTo(x - 3, y + 5.5, x - 1.5, y + 7.7, x + 2.5, y + 9.5); s.bezierCurveTo(x + 6, y + 7.7, x + 8, y + 5.5, x + 8, y + 3.5);
  s.bezierCurveTo(x + 8, y + 3.5, x + 8, y, x + 5, y); s.bezierCurveTo(x + 3.5, y, x + 2.5, y + 2.5, x + 2.5, y + 2.5);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 1.6, bevelEnabled: true, bevelSegments: light ? 6 : 10, steps: 1, bevelSize: 1, bevelThickness: 1, curveSegments: light ? 28 : 48 });
  geo.center(); geo.rotateZ(Math.PI); geo.scale(0.22, 0.22, 0.19); geo.computeVertexNormals();
  return geo;
}
function earShape(k = 1) {
  const s = new THREE.Shape();
  s.moveTo(-0.5 * k, 0); s.quadraticCurveTo(-0.44 * k, 0.56 * k, -0.04 * k, 1.0 * k); s.quadraticCurveTo(0.34 * k, 0.56 * k, 0.5 * k, 0); s.quadraticCurveTo(0, -0.07 * k, -0.5 * k, 0);
  return s;
}

/** Draw the title + artist layer into a 2D canvas (same size as the video). Returns the progress-hairline layout (NDC). */
export function drawTextLayer(canvas, { title = '', artist = '', mood = 'sakura' } = {}) {
  const M = typeof mood === 'string' ? (MOODS[mood] || MOODS.sakura) : mood;
  const cw = canvas.width, ch = canvas.height; if (!cw || !ch) return null;
  const g = canvas.getContext('2d'); g.clearRect(0, 0, cw, ch);
  title = (title || '').trim(); artist = (artist || '').trim();
  const portrait = cw / ch < 0.8, wide = cw / ch > 1.2;
  const cx = wide ? cw * 0.065 : cw / 2, align = wide ? 'left' : 'center';
  const ty = portrait ? ch * 0.735 : ch * (wide ? 0.845 : 0.835);
  let size = portrait ? cw * 0.072 : wide ? ch * 0.062 : cw * 0.06;
  const maxW = wide ? cw * 0.6 : cw * 0.84;
  g.textAlign = align; g.textBaseline = 'alphabetic';
  const tf = s => `${Math.round(s)}px "Dela Gothic One", "Arial Black", "Helvetica Neue", system-ui, sans-serif`;
  let shown = title;
  if (title) {
    g.font = tf(size); let w = g.measureText(title).width;
    if (w > maxW) { size = Math.max(size * 0.6, size * maxW / w); g.font = tf(size); w = g.measureText(title).width; }
    while (w > maxW && shown.length > 4) { shown = shown.slice(0, -2).trimEnd(); w = g.measureText(shown + '…').width; if (w <= maxW) shown += '…'; }
    g.shadowColor = M.accent + 'aa'; g.shadowBlur = size * 0.55; g.fillStyle = M.ink; g.fillText(shown, cx, ty);
    g.shadowBlur = 0; g.fillText(shown, cx, ty);
  }
  const asz = Math.max(10, size * 0.36);
  const ay = title ? ty + size * 0.78 : ty;
  if (artist) {
    g.font = `500 ${Math.round(asz)}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Helvetica Neue", system-ui, sans-serif`;
    try { g.letterSpacing = `${(asz * 0.32).toFixed(1)}px`; } catch { }
    g.fillStyle = M.accent; g.shadowColor = M.accent + '88'; g.shadowBlur = asz * 0.6;
    g.fillText(artist.toUpperCase(), cx + (align === 'center' ? asz * 0.16 : 0), ay); g.shadowBlur = 0;
    try { g.letterSpacing = '0px'; } catch { }
  }
  const barW = wide ? 0.26 : 0.36, barY = ((title || artist) ? ay + asz * 1.25 : ty) / ch;
  const left = wide ? cx / cw : 0.5 - barW / 2;
  return { x0: left * 2 - 1, w: barW * 2, y: 1 - barY * 2, h: Math.max(2, Math.round(ch / 700)) / ch * 2, hasText: !!(title || artist) };
}

/**
 * createHeartScene({canvas, width, height, pixelRatio, mood, intensity, light, antialias, preserve, title, artist})
 * -> { canvas, renderer, setSize(w, h, pr), setMood(id), setIntensity(v), setText({title, artist}), render(t, features, {duration}), dispose() }
 */
export function createHeartScene({ canvas, width = 1080, height = 1920, pixelRatio = 1, mood = 'sakura', intensity = 0.6, light = false, antialias = true,
  preserve = false, title = '', artist = 'Nicofoxheart', textLayer = null } = {}) {
  canvas = canvas || mkCanvas(width, height);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias, alpha: false, preserveDrawingBuffer: preserve, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
  // HDR scene target with mipmaps: the composite pass reads blurred mip levels for a single-pass bloom
  const gl2 = renderer.capabilities.isWebGL2, halfOk = gl2 && !!renderer.extensions.get('EXT_color_buffer_float');
  const rt = new THREE.WebGLRenderTarget(width, height, { type: halfOk ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: antialias && gl2 ? 4 : 0,
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
  renderer.autoClear = false;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 100);
  const M = { ...MOODS.sakura };
  let W = width, H = height, aspect = width / height, baseDist = 10, lookY = 0, inten = intensity, txt = { title, artist };

  // sky (full-screen, behind everything)
  const skyU = { cTop: { value: new THREE.Vector3() }, cMid: { value: new THREE.Vector3() }, cLow: { value: new THREE.Vector3() }, cHaze: { value: new THREE.Vector3() },
    cHalo: { value: new THREE.Vector3() }, cHalo2: { value: new THREE.Vector3() }, uTime: { value: 0 }, uAspect: { value: aspect }, uGlow: { value: 0.5 }, uWarm: { value: 0 },
    uStars: { value: 0.8 }, uCenter: { value: new THREE.Vector2() } };
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS, depthWrite: false, depthTest: false }));
  sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);

  // halo sprites behind the heart (the cheap bloom)
  const haloTex = radialTexture([[0, 1], [0.2, 0.55], [0.5, 0.16], [1, 0]]);
  const mkSprite = (op) => { const m = new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: op }); const s = new THREE.Sprite(m); scene.add(s); return s; };
  const haloWide = mkSprite(0.3), haloHot = mkSprite(0.4), haloFront = mkSprite(0.1);
  haloWide.position.set(0, 0, -1.6); haloHot.position.set(0, 0, -0.9); haloFront.position.set(0, 0.05, 1.2); haloFront.renderOrder = 5;

  // the heart
  const heart = new THREE.Group(); scene.add(heart);
  const geo = heartGeometry(light);
  const mat = light ? new THREE.MeshStandardMaterial({ roughness: 0.36, metalness: 0.05 })
    : new THREE.MeshPhysicalMaterial({ roughness: 0.38, metalness: 0.04, clearcoat: 0.7, clearcoatRoughness: 0.28, sheen: 0.7, sheenRoughness: 0.45 });
  heart.add(new THREE.Mesh(geo, mat));
  const rimMat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color() }, uStrength: { value: 1 } }, vertexShader: RIM_VS, fragmentShader: RIM_FS,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const rim = new THREE.Mesh(geo, rimMat); rim.scale.setScalar(1.006); heart.add(rim);

  // fox ears on the lobes: a curved ear (amber, darker tip) with a pale inner ear, pivoting at the base
  const earGeo = new THREE.ExtrudeGeometry(earShape(), { depth: 0.12, bevelEnabled: true, bevelSegments: light ? 2 : 4, bevelSize: 0.05, bevelThickness: 0.05, curveSegments: light ? 10 : 18 });
  earGeo.translate(0, 0, -0.06); earGeo.computeVertexNormals();
  const earCol = new Float32Array(earGeo.attributes.position.count * 3); earGeo.setAttribute('color', new THREE.BufferAttribute(earCol, 3));
  const innerGeo = new THREE.ShapeGeometry(earShape(0.6), light ? 8 : 14); innerGeo.translate(0.0, 0.12, 0.115);
  const earMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.02 });
  const innerMat = new THREE.MeshStandardMaterial({ roughness: 0.55, side: THREE.DoubleSide });
  const ears = [-1, 1].map(side => {
    const pivot = new THREE.Group(), ear = new THREE.Group();
    ear.add(new THREE.Mesh(earGeo, earMat)); ear.add(new THREE.Mesh(innerGeo, innerMat));
    ear.scale.set(0.92, 1.08, 1); pivot.add(ear);
    pivot.position.set(side * 0.7, 0.74, 0); pivot.userData.side = side; heart.add(pivot); return pivot;
  });

  // lights
  const hemi = new THREE.HemisphereLight(0x6b5aa8, 0x3a1830, 1.1); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffd0ea, 2.4); key.position.set(3, 4, 6); scene.add(key);
  const back = new THREE.DirectionalLight(0x7fd6ff, 1.8); back.position.set(-5, -2, -3); scene.add(back);
  const fire = new THREE.PointLight(0xffb36b, 0, 0, 0); fire.position.set(0, -0.4, 3); scene.add(fire);

  // the dashed orbit ring with ticks (from his page)
  const ring = new THREE.Group(); scene.add(ring);
  const R = 2.05, rp = []; for (let a = 0; a <= 160; a++) { const th = a / 160 * Math.PI * 2; rp.push(new THREE.Vector3(Math.cos(th) * R, Math.sin(th) * R, 0)); }
  const ringMat = new THREE.LineDashedMaterial({ dashSize: 0.05, gapSize: 0.07, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false });
  const ringLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rp), ringMat); ringLine.computeLineDistances(); ring.add(ringLine);
  const tp = []; for (let d = 0; d < 360; d += 30) { const th = d * DEG; tp.push(new THREE.Vector3(Math.cos(th) * (R - 0.07), Math.sin(th) * (R - 0.07), 0), new THREE.Vector3(Math.cos(th) * (R + 0.07), Math.sin(th) * (R + 0.07), 0)); }
  const tickMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });
  ring.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tp), tickMat));

  // sakura petals (instanced) and fox-fire sparks (points); seeded, positions are functions of time
  const rnd = mulberry(20241012);
  const NP = light ? 56 : 150, NS = light ? 110 : 280;
  const petalMat = new THREE.MeshBasicMaterial({ map: petalTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, alphaTest: 0.02 });
  const petals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.17, 0.17), petalMat, NP); petals.frustumCulled = false; scene.add(petals);
  const pSeed = Array.from({ length: NP }, () => [rnd(), rnd(), rnd(), rnd(), rnd()]);
  const sparkPos = new Float32Array(NS * 3), sparkA = new Float32Array(NS), sparkS = new Float32Array(NS), sparkC = new Float32Array(NS * 3);
  const sSeed = Array.from({ length: NS }, () => [rnd(), rnd(), rnd(), rnd(), rnd()]);
  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3)); sgeo.setAttribute('aAlpha', new THREE.BufferAttribute(sparkA, 1));
  sgeo.setAttribute('aSize', new THREE.BufferAttribute(sparkS, 1)); sgeo.setAttribute('aColor', new THREE.BufferAttribute(sparkC, 3));
  const sparkU = { uScale: { value: 1000 } };
  const sparks = new THREE.Points(sgeo, new THREE.ShaderMaterial({ uniforms: sparkU, vertexShader: SPARK_VS, fragmentShader: SPARK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false; scene.add(sparks);

  // overlay: bloom composite, vignette + fade, title text, progress hairline
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1), overlay = new THREE.Scene(), post = new THREE.Scene();
  const postU = { tScene: { value: rt.texture }, uBloom: { value: 1 }, uExposure: { value: 1 }, uTime: { value: 0 } };
  post.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: postU, vertexShader: SKY_VS.replace('0.9999', '0.0'), fragmentShader: POST_FS, depthTest: false, depthWrite: false })));
  const vigU = { uFade: { value: 0 }, uAspect: { value: aspect }, uText: { value: 1 } };
  overlay.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: vigU, vertexShader: SKY_VS.replace('0.9999', '0.0'), fragmentShader: VIG_FS, transparent: true, depthTest: false, depthWrite: false })));
  const textCanvas = textLayer ? null : mkCanvas(2, 2);
  let textTex = textCanvas ? new THREE.CanvasTexture(textCanvas) : new THREE.Texture(); textTex.colorSpace = THREE.SRGBColorSpace;
  const textMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: textTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  overlay.add(textMesh);
  const barTrack = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthTest: false, toneMapped: false }));
  const barFill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, toneMapped: false }));
  overlay.add(barTrack, barFill);
  let layout = null;

  const colors = {};
  function setMood(id) {
    Object.assign(M, MOODS[id] || MOODS.sakura);
    skyU.cTop.value.copy(hexVec(M.sky[0])); skyU.cMid.value.copy(hexVec(M.sky[1])); skyU.cLow.value.copy(hexVec(M.sky[2]));
    skyU.cHaze.value.copy(hexVec(M.haze)); skyU.cHalo.value.copy(hexVec(M.halo)); skyU.cHalo2.value.copy(hexVec(M.halo2));
    for (const k of ['heart', 'heart2', 'emissive', 'halo', 'halo2', 'rim', 'ear', 'earTip']) colors[k] = new THREE.Color(M[k]);
    mat.emissive.set(M.emissive); if (mat.sheenColor) mat.sheenColor.set(M.sheen);
    innerMat.color.set(M.inner); innerMat.emissive.set(M.inner).multiplyScalar(0.18);
    earMat.emissive.set(M.ear).multiplyScalar(0.12);
    const pos = earGeo.attributes.position, c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) { c.copy(colors.ear).lerp(colors.earTip, smooth(0.6, 0.98, pos.getY(i))); earCol[i * 3] = c.r; earCol[i * 3 + 1] = c.g; earCol[i * 3 + 2] = c.b; }
    earGeo.attributes.color.needsUpdate = true;
    key.color.set(M.key); back.color.set(M.back); fire.color.set(M.halo2);
    ringMat.color.set(M.ring); tickMat.color.set(M.ring); rimMat.uniforms.uColor.value.set(M.rim);
    haloWide.material.color.set(M.halo); haloHot.material.color.set(M.halo2).lerp(new THREE.Color(M.halo), 0.5); haloFront.material.color.set(M.halo);
    const pc = M.petal.map(h => new THREE.Color(h));
    for (let i = 0; i < NP; i++) petals.setColorAt(i, pc[i % pc.length]);
    if (petals.instanceColor) petals.instanceColor.needsUpdate = true;
    const sc = M.sparks.map(h => new THREE.Color(h));
    for (let i = 0; i < NS; i++) { const col = sc[Math.floor(sSeed[i][4] * sc.length)]; sparkC[i * 3] = col.r; sparkC[i * 3 + 1] = col.g; sparkC[i * 3 + 2] = col.b; }
    sgeo.attributes.aColor.needsUpdate = true;
    barFill.material.color.set(M.accent);
    drawText();
  }

  function setSize(w, h, pr = 1) {
    W = w; H = h; aspect = w / h;
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false); rt.setSize(Math.round(w * pr), Math.round(h * pr));
    camera.aspect = aspect; camera.updateProjectionMatrix();
    const tan = Math.tan(FOV / 2 * DEG), needH = 3.0 / (aspect > 1.2 ? 0.52 : 0.5), needW = 2.7 / 0.62, visH = Math.max(needH, needW / aspect);
    baseDist = visH / (2 * tan);
    const centerFromTop = aspect < 0.8 ? 0.42 : aspect > 1.2 ? 0.46 : 0.44;
    lookY = -(0.5 - centerFromTop) * visH;
    skyU.uAspect.value = aspect; vigU.uAspect.value = aspect;
    sparkU.uScale.value = h * pr / (2 * tan);
    if (textCanvas) { textCanvas.width = Math.round(w * pr); textCanvas.height = Math.round(h * pr); }
    drawText();
  }

  function fontsReady() {
    const f = HAS_DOM && document.fonts; if (!f?.load) return;
    Promise.all([f.load('64px "Dela Gothic One"'), f.load('500 32px "M PLUS Rounded 1c"')]).then(() => drawText()).catch(() => { });
  }
  function applyLayout(l) {
    layout = l; if (!l) return;
    barTrack.position.set(l.x0 + l.w / 2, l.y, 0); barTrack.scale.set(l.w, l.h, 1);
    vigU.uText.value = l.hasText ? 1 : 0.4;
  }
  function drawText() {
    if (!textCanvas) return;
    applyLayout(drawTextLayer(textCanvas, { ...txt, mood: M }));
    textTex.needsUpdate = true;
  }
  /** Worker path: the text layer is drawn on the main thread (where the fonts are) and arrives as an ImageBitmap. */
  function setTextLayer(bitmap, l) {
    if (textTex) textTex.dispose();
    textTex = new THREE.Texture(bitmap); textTex.flipY = false; textTex.colorSpace = THREE.SRGBColorSpace; textTex.needsUpdate = true;
    textMesh.material.map = textTex; textMesh.material.needsUpdate = true; applyLayout(l);
  }
  function setText(t) { txt = { ...txt, ...t }; drawText(); }
  function setIntensity(v) { inten = Math.min(1, Math.max(0, v)); }

  const v3 = new THREE.Vector3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc3 = new THREE.Vector3(), cTmp = new THREE.Color();
  /** Draw one frame. t in seconds, f = features ({pulse, low, mid, high, level, slow, accent, accentLag}); duration enables fades + progress. */
  function render(t, f, { duration = 0 } = {}) {
    const k = 0.45 + inten * 0.9, still = 1;
    // camera: slow drift and breathing dolly
    camera.position.set(Math.sin(t * 0.071) * 0.32 * still, Math.sin(t * 0.053 + 1) * 0.2 + 0.05, baseDist * (1 - 0.022 * Math.sin(t * 0.037) - f.slow * 0.025 * inten));
    camera.lookAt(0, lookY, 0);
    // heart: sway, float, pulse
    const breath = Math.pow(Math.max(0, Math.sin(t * 1.9)), 10) * 0.012;
    const s = 1 + breath + f.pulse * 0.085 * k + f.accent * 0.012 * k;
    heart.scale.setScalar(s);
    heart.rotation.set(Math.sin(t * 0.31) * 0.08 + 0.04, Math.sin(t * 0.21) * 0.62 + Math.sin(t * 0.083) * 0.22, Math.sin(t * 0.17) * 0.035);
    heart.position.y = Math.sin(t * 0.5) * 0.07;
    cTmp.copy(colors.heart).lerp(colors.heart2, Math.min(1, f.mid * 0.32 * k)); mat.color.copy(cTmp);
    mat.emissiveIntensity = 0.3 + f.level * 0.5 * k + f.pulse * 0.65 * k;
    rimMat.uniforms.uStrength.value = 0.55 + f.high * 0.7 * k + f.accent * 0.3;
    rimMat.uniforms.uColor.value.copy(colors.rim).lerp(colors.halo2, f.high * 0.35);
    // ears: idle sway + quick flick outward and back on accents (right ear a beat later)
    for (const ear of ears) {
      const sd = ear.userData.side, acc = sd < 0 ? f.accent : f.accentLag;
      const flick = acc * acc * 0.38 * k;
      ear.rotation.z = -sd * (0.36 + Math.sin(t * 1.3 + sd) * 0.035 + flick + f.pulse * 0.06);
      ear.rotation.x = -0.12 - acc * 0.22 * k + Math.sin(t * 0.9 + sd * 2) * 0.03;
    }
    // halo
    const glow = 0.45 + f.low * 0.35 * k + f.level * 0.25;
    haloWide.scale.setScalar(8 * (1 + f.low * 0.1 * k)); haloWide.material.opacity = 0.08 + glow * 0.12;
    haloHot.scale.setScalar(4.4 * (1 + f.pulse * 0.16 * k)); haloHot.material.opacity = 0.12 + glow * 0.24;
    haloFront.scale.setScalar(3.2 * s); haloFront.material.opacity = 0.04 + f.pulse * 0.09 * k;
    for (const h of [haloWide, haloHot, haloFront]) h.position.y = heart.position.y;
    fire.intensity = 0.4 + f.level * 2.2 * k;
    // sky
    skyU.uTime.value = t; skyU.uGlow.value = glow; skyU.uWarm.value = Math.min(1, f.high * 0.5 + f.accent * 0.3); skyU.uStars.value = 0.55 + f.high * 0.45;
    v3.set(0, heart.position.y, 0).project(camera); skyU.uCenter.value.set(v3.x * 0.5 * aspect, v3.y * 0.5);
    // ring
    ring.rotation.set(1.18 + Math.sin(t * 0.13) * 0.06, Math.sin(t * 0.09) * 0.18, t * 0.05);
    ring.position.y = heart.position.y - 0.05;
    ringMat.opacity = 0.16 + f.mid * 0.22; tickMat.opacity = 0.2 + f.mid * 0.25;
    // petals
    const tan = Math.tan(FOV / 2 * DEG), shownP = Math.round(NP * (0.45 + 0.55 * inten));
    for (let i = 0; i < NP; i++) {
      const [a, b, c, d, z0] = pSeed[i];
      if (i >= shownP) { m4.makeScale(0, 0, 0); petals.setMatrixAt(i, m4); continue; }
      const z = -6 + z0 * 9.2, hh = (baseDist - z) * tan + 0.6, hw = hh * aspect + 0.6;
      const period = 11 + a * 9, ph = (t / period + b) % 1;
      const y = lookY + hh - ph * 2 * hh, x = (d * 2 - 1) * hw + Math.sin(t * (0.25 + c * 0.3) + a * 6) * 0.5 + (ph - 0.5) * 1.6;
      e.set(t * (0.5 + a * 0.8) + b * 6, t * (0.7 + c * 0.9) + d * 6, Math.sin(t * 0.6 + a * 9) * 0.9);
      q.setFromEuler(e); const size = 0.7 + b * 0.75 + (z0 > 0.85 ? 0.6 : 0);
      m4.compose(v3.set(x, y, z), q, sc3.set(size, size * 0.92, size)); petals.setMatrixAt(i, m4);
    }
    petals.instanceMatrix.needsUpdate = true;
    petalMat.opacity = 0.75 + f.high * 0.25;
    // sparks rise like fox-fire
    const shownS = Math.round(NS * (0.4 + 0.6 * inten)), bright = 0.45 + f.level * 0.6 + f.high * 0.45 * k;
    for (let i = 0; i < NS; i++) {
      const [a, b, c, d] = sSeed[i];
      const z = -4.5 + c * 7, hh = (baseDist - z) * tan, hw = hh * aspect;
      const period = 8 + a * 10, ph = (t / period + b) % 1;
      sparkPos[i * 3] = (d * 2 - 1) * hw * 0.95 + Math.sin(t * (0.35 + c * 0.5) + d * 9) * 0.35;
      sparkPos[i * 3 + 1] = lookY - hh * 1.05 + ph * hh * 2.1;
      sparkPos[i * 3 + 2] = z;
      const tw = 0.55 + 0.45 * Math.sin(t * (1.5 + a * 3) + b * 20);
      sparkA[i] = i < shownS ? Math.sin(ph * Math.PI) * tw * bright : 0;
      sparkS[i] = 0.035 + a * 0.06 + (c > 0.9 ? 0.05 : 0);
    }
    sgeo.attributes.position.needsUpdate = true; sgeo.attributes.aAlpha.needsUpdate = true; sgeo.attributes.aSize.needsUpdate = true;
    // overlay: fades + progress
    let fade = 0;
    if (duration > 0) { fade = Math.max(1 - smooth(0, 1.2, t), smooth(duration - 1.6, duration - 0.05, t)); }
    vigU.uFade.value = fade;
    const prog = duration > 0 ? Math.min(1, t / duration) : 0;
    barTrack.visible = barFill.visible = duration > 0 && !!layout;
    if (layout && prog > 0) { barFill.scale.set(Math.max(1e-4, layout.w * prog), layout.h, 1); barFill.position.set(layout.x0 + layout.w * prog / 2, layout.y, 0); }
    postU.uTime.value = t; postU.uBloom.value = 0.75 + f.pulse * 0.45 * k + f.level * 0.25;
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.clear(); renderer.render(post, ortho); renderer.render(overlay, ortho);
  }

  function dispose() {
    rt.dispose(); post.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); renderer.dispose(); geo.dispose(); earGeo.dispose(); innerGeo.dispose(); haloTex.dispose(); textTex?.dispose(); petalMat.map?.dispose();
    scene.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); overlay.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    try { renderer.forceContextLoss(); } catch { }
  }

  setSize(width, height, pixelRatio); setMood(mood); fontsReady();
  if (textLayer) setTextLayer(textLayer.bitmap, textLayer.layout);
  return { canvas, renderer, setSize, setMood, setIntensity, setText, setTextLayer, render, dispose, get size() { return { width: W, height: H }; }, _parts: { sky, petals, sparks, heart, haloWide, haloHot, haloFront, ring, postU } };
}
