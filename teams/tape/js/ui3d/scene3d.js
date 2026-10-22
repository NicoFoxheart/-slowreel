// scene3d.js - the Slowreel 3D studio deck: the whole header becomes one soft clay tape machine. Runs in a Worker
// (worker3d.js) on an OffscreenCanvas; three.js 0.160.0 is injected with setThree().
//
// World units are CSS pixels and the machine's face is the plane z = 0, so everything on the face lines up exactly with
// the DOM controls that sit on top of the canvas (keys, LCD, knobs). The camera uses an off-axis ("window") projection:
// it moves with the mouse but the z = 0 plane always maps onto the canvas 1:1, so only things with depth move (the
// niche, the reels, the fox), which is the gentle parallax. Inside the tape window there is a recessed niche with the
// reels, the tape path and head, a backlit VU meter, a desk lamp, a small fox figurine and (when there is room) a
// cassette stack and a plant. Knob bodies under the real (DOM) Atmos / Space / Volume knobs glow in their colours.
let THREE = null;
export function setThree(T) { THREE = T; }

const D = 900;          // eye distance from the face plane (px): long lens, gentle perspective
const LIFT = 46;        // the eye sits a little above the middle, so you look down into the niche
const PAR_X = 70, PAR_Y = 26;   // parallax travel of the eye (px)
const NICHE_DEPTH = 84, BEVEL = 6, BEVEL_T = 7;

const C = {
  // Midnight tape: a charcoal / ink-blue machine in a dark room, brushed-metal reels, amber lamp and VU light
  slab: 0x1B2129, niche: 0x0E1318, wood: 0x5A3A25, mint: 0x3A2A1F,
  cream: 0xAEB4BB, hub: 0xC9CED3, signal: 0xF0622A, pack: 0x3A2E28, tape: 0x5E4A3E,
  steel: 0xB8BEC4, ink: 0x15191E, skirt: 0x101317, cap: 0x4C535C,
  saffron: 0xF4B03A, cobalt: 0x4F73E0, leaf: 0x3FBF88,
  fox: 0xEE8A4E, foxCream: 0xFBF1E4, foxDark: 0x3B2B27,
  terracotta: 0xD9A27A, plant: 0x5FAE7E, plant2: 0x86C99A,
};
const smoothTo = (v, t, dt, tau) => v + (t - v) * Math.min(1, dt / tau);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const hasDoc = typeof document !== 'undefined';
const mkCanvas = (w, h) => { if (hasDoc) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; } return new OffscreenCanvas(w, h); };

/** Rounded box (same construction as three/addons RoundedBoxGeometry, without its bare 'three' import). */
function roundedBox(w, h, d, seg = 3, r = 2) {
  const s = seg * 2 + 1; r = Math.min(w / 2, h / 2, d / 2, r);
  const g = new THREE.BoxGeometry(1, 1, 1, s, s, s).toNonIndexed();
  const pos = g.attributes.position.array, nor = g.attributes.normal.array, half = 0.5 / s;
  const bx = w / 2 - r, by = h / 2 - r, bz = d / 2 - r, n = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    n.set(x - Math.sign(x) * half, y - Math.sign(y) * half, z - Math.sign(z) * half).normalize();
    pos[i] = bx * Math.sign(x) + n.x * r; pos[i + 1] = by * Math.sign(y) + n.y * r; pos[i + 2] = bz * Math.sign(z) + n.z * r;
    nor[i] = n.x; nor[i + 1] = n.y; nor[i + 2] = n.z;
  }
  return g;
}
function rrectPath(p, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  p.lineTo(x + w, y + h - r); p.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  p.lineTo(x + r, y + h); p.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(x, y + r); p.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return p;
}
function radialTex(stops, size = 128) {
  const c = mkCanvas(size, size), g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, a]) => gr.addColorStop(o, `rgba(255,255,255,${a})`));
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createStudioScene({ canvas, width, height, dpr = 1, layout, soft = false }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !soft, alpha: true, premultipliedAlpha: true, powerPreference: 'default', stencil: false });
  const PR = soft ? 1 : Math.min(1.5, dpr || 1);
  renderer.setPixelRatio(PR);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(20, 1, 10, 3000);

  // soft studio reflections, only on the glossy parts (clay stays matte, as in the portfolio diorama)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0x1A2027, side: THREE.BackSide })));
  const panel = (c, x, y, z, s) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 0.6), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m); };
  panel(0xb0884f, -3, 4, 2, 5); panel(0x4a5f8a, 4, 2, 3, 4); panel(0x6a717a, 0, 4.8, -1, 6);
  const ENV = pmrem.fromScene(envScene, 0.04).texture;

  const mats = new Map();
  const tint = hex => new THREE.Color(hex).lerp(new THREE.Color(0xffffff), 0.55);
  function clay(hex, o = {}) {
    const key = hex + JSON.stringify(o); if (mats.has(key)) return mats.get(key);
    const glossy = !!o.gloss; o = { ...o }; delete o.gloss;
    const m = soft
      ? new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7, metalness: 0, envMap: glossy ? ENV : null, envMapIntensity: 0.35, ...o })
      : new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.7, metalness: 0, sheen: 0.35, sheenRoughness: 0.65, sheenColor: tint(hex), envMap: glossy ? ENV : null, envMapIntensity: 0.35, ...o });
    mats.set(key, m); return m;
  }
  const glowTex = radialTex([[0, 1], [0.25, 0.55], [0.6, 0.14], [1, 0]]);
  const ringTex = radialTex([[0, 0], [0.5, 0], [0.62, 0.55], [0.72, 0.85], [0.84, 0.25], [1, 0]]);
  const glowMat = (hex, tex = glowTex) => new THREE.MeshBasicMaterial({ map: tex, color: hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const PLANE = new THREE.PlaneGeometry(1, 1), SPHERE = new THREE.SphereGeometry(1, 20, 14), CYL = new THREE.CylinderGeometry(1, 1, 1, 28);
  const packCapTex = (() => {
    const c = mkCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#4E3F38'; g.fillRect(0, 0, 256, 256);
    for (let r = 20; r < 128; r += 2.2) { g.strokeStyle = `rgba(${r % 7 < 3.5 ? '255,235,215' : '20,10,6'},${0.05 + (r % 5) * 0.012})`; g.lineWidth = 1; g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const vuTex = (() => {
    const c = mkCanvas(256, 160), g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, 160); bg.addColorStop(0, '#F9C26C'); bg.addColorStop(1, '#D3812F'); g.fillStyle = bg; g.fillRect(0, 0, 256, 160);
    const cx = 128, cy = 196, R = 150, ang = db => { const x = clamp(db, -20, 3); return -0.84 + Math.pow((x + 20) / 23, 1.3) * 1.68; };
    g.lineCap = 'round'; g.strokeStyle = '#2A1A0C'; g.lineWidth = 2.5; g.beginPath(); g.arc(cx, cy, R * 0.8, -Math.PI / 2 + ang(-20), -Math.PI / 2 + ang(0)); g.stroke();
    g.strokeStyle = '#C23A0E'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, R * 0.8, -Math.PI / 2 + ang(0), -Math.PI / 2 + ang(3)); g.stroke();
    g.font = '600 15px ui-monospace, Menlo, monospace'; g.textAlign = 'center';
    [-20, -10, -7, -5, -3, 0, 3].forEach(d => { const a = -Math.PI / 2 + ang(d);
      g.strokeStyle = d > 0 ? '#B8320A' : '#2A1A0C'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8); g.lineTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9); g.stroke();
      if (d === -7 || d === -3) return; g.fillStyle = d > 0 ? '#B8320A' : '#3A2614'; g.fillText(d > 0 ? '+' + d : String(d), cx + Math.cos(a) * R * 1.0, cy + Math.sin(a) * R * 1.0 + 5); });
    g.font = '700 17px system-ui, sans-serif'; g.fillStyle = '#3A2614'; g.fillText('VU', cx, 132);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return { tex: t, ang };
  })();

  let _dusk = null, _poster = null;
  function duskTex() {   // a rainy dusk over the city, for the little window on the back wall
    if (_dusk) return _dusk;
    const c = mkCanvas(192, 128), g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 128); sky.addColorStop(0, '#24365A'); sky.addColorStop(0.45, '#6C7DA6'); sky.addColorStop(0.78, '#F2A27E'); sky.addColorStop(1, '#FFD39A');
    g.fillStyle = sky; g.fillRect(0, 0, 192, 128);
    g.fillStyle = 'rgba(255,255,255,.85)'; for (let i = 0; i < 18; i++) g.fillRect((i * 53) % 192, (i * 29) % 46, 1.5, 1.5);
    g.fillStyle = '#FFF1D2'; g.beginPath(); g.arc(142, 30, 11, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4F638E'; g.beginPath(); g.arc(148, 26, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2E3F5A'; [[0, 92, 22], [20, 80, 18], [38, 98, 26], [64, 74, 16], [80, 90, 24], [104, 84, 20], [124, 96, 30], [154, 78, 18], [172, 92, 20]].forEach(([x, y, w]) => g.fillRect(x, y, w, 128 - y));
    g.fillStyle = 'rgba(255,214,140,.9)'; for (let i = 0; i < 46; i++) g.fillRect(4 + (i * 37) % 184, 84 + (i * 23) % 40, 2, 2);
    g.strokeStyle = 'rgba(220,232,255,.22)'; g.lineWidth = 1; for (let i = 0; i < 40; i++) { const x = (i * 47) % 200, y = (i * 31) % 128; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 4, y + 12); g.stroke(); }
    _dusk = new THREE.CanvasTexture(c); _dusk.colorSpace = THREE.SRGBColorSpace; return _dusk;
  }
  function posterTex() {   // Nicofoxheart's fox heart on a teal print
    if (_poster) return _poster;
    const c = mkCanvas(128, 168), g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, 168); bg.addColorStop(0, '#2E5A5D'); bg.addColorStop(1, '#1B3034'); g.fillStyle = bg; g.fillRect(0, 0, 128, 168);
    g.save(); g.translate(28, 26); g.scale(3, 3);
    try { const p = new Path2D('M12 21.2L3.6 12.8C1.9 11 1.8 8.2 2.8 6.1L4.4 2.4l4.1 3.1c1.4-.3 2.6.1 3.5.9.9-.8 2.1-1.2 3.5-.9l4.1-3.1 1.6 3.7c1 2.1.9 4.9-.8 6.7z'); g.fillStyle = '#EE8A4E'; g.fill(p);
      g.fillStyle = '#FBF1E4'; g.fill(new Path2D('M12 21.2L8.8 12.6h6.4z')); } catch { g.fillStyle = '#EE8A4E'; g.fillRect(4, 4, 16, 16); }
    g.restore();
    g.fillStyle = '#F2D27E'; g.font = '700 11px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.fillText('NICOFOXHEART', 64, 132);
    g.fillStyle = 'rgba(221,239,234,.7)'; g.font = '500 8px ui-monospace, Menlo, monospace'; g.fillText('slow tapes', 64, 148);
    _poster = new THREE.CanvasTexture(c); _poster.colorSpace = THREE.SRGBColorSpace; return _poster;
  }

  // ---------------------------------------------------------------- lights (fixed; positions follow the layout)
  const hemi = new THREE.HemisphereLight(0xa8bce6, 0x2a1d12, 0.62); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xc6d4ff, 1.05); key.castShadow = true;
  key.shadow.mapSize.set(soft ? 1024 : 2048, soft ? 256 : 512); key.shadow.bias = -0.0006; key.shadow.normalBias = 0.6; key.shadow.radius = 3;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0x7f9ad6, 0.38); scene.add(fill, fill.target);
  const spill = new THREE.PointLight(0xffc48a, 0, 900, 1.2); scene.add(spill);     // lamplight spilling out of the niche onto the face
  const lamp = new THREE.SpotLight(0xffb36a, 0, 600, 1.15, 0.9, 1); lamp.castShadow = true;
  lamp.shadow.mapSize.set(soft ? 256 : 512, soft ? 256 : 512); lamp.shadow.bias = -0.002; lamp.shadow.normalBias = 0.4; lamp.shadow.radius = 4; lamp.shadow.camera.near = 4; lamp.shadow.camera.far = 500;
  scene.add(lamp, lamp.target);
  const nicheFill = new THREE.PointLight(0x9fc0ff, 0, 400, 1.4); scene.add(nicheFill);   // cool bounce inside the niche

  // ---------------------------------------------------------------- state
  let W = width, H = height, L = layout, content = null, parts = {};
  const S = { playing: false, frac: 0, level: 0, beat: 0, bpm: 70, rec: false, loop: false, reduced: false, knobs: {}, px: 0, py: 0 };
  const A = { spin: 0, angL: 0, angR: 0, fracS: 0, shuttle: 0, lastFrac: null, lv: 0, vu: -22, cx: 0, cy: 0, glow: {}, beat: 0, time: 0, shadowN: 0 };
  let dirtyShadow = true;

  function disposeGroup(g) { g.traverse(o => { if (o.geometry && ![PLANE, SPHERE, CYL].includes(o.geometry)) o.geometry.dispose(); }); }
  function add(parent, geo, mat, x = 0, y = 0, z = 0, o = {}) {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
    if (o.rx) m.rotation.x = o.rx; if (o.ry) m.rotation.y = o.ry; if (o.rz) m.rotation.z = o.rz;
    if (o.s) Array.isArray(o.s) ? m.scale.set(...o.s) : m.scale.setScalar(o.s);
    m.castShadow = o.cast !== false; m.receiveShadow = o.recv !== false; parent.add(m); return m;
  }
  const glowPlane = (parent, hex, x, y, z, w, h, tex) => { const m = new THREE.Mesh(PLANE, glowMat(hex, tex)); m.position.set(x, y, z); m.scale.set(w, h, 1); m.renderOrder = 5; parent.add(m); return m; };

  // ---------------------------------------------------------------- build (on every layout change)
  function build() {
    if (content) { scene.remove(content); disposeGroup(content); }
    content = new THREE.Group(); scene.add(content); parts = { halos: [], knobs: [] };
    A0.x = W / 2; A0.y = H / 2 + LIFT;
    const n = L.niche;
    // the face: one bevelled clay slab over the whole deck with the tape window cut out of it
    const sh = new THREE.Shape(); rrectPath(sh, BEVEL + 1, BEVEL + 1, W - 2 * BEVEL - 2, H - 2 * BEVEL - 2, 14);
    if (n) { const hole = new THREE.Path(); rrectPath(hole, n.x, n.y, n.w, n.h, 8); sh.holes.push(hole); }
    const slabGeo = new THREE.ExtrudeGeometry(sh, { depth: 2, bevelEnabled: true, bevelThickness: BEVEL_T, bevelSize: BEVEL, bevelSegments: soft ? 3 : 5, curveSegments: soft ? 6 : 10 });
    const slab = add(content, slabGeo, clay(C.slab, { roughness: 0.48, metalness: 0.28, gloss: true }), 0, 0, -(2 + BEVEL_T), { cast: false });
    // a fine seam line under the deck's top lip, like a painted metal panel joint (very subtle)
    add(content, new THREE.BoxGeometry(W - 60, 0.6, 0.4), clay(0x2E3640), W / 2, H - 15, 0.2, { cast: false });
    void slab;
    if (n) buildNiche(n);
    // knob bodies under the DOM knobs (the DOM keeps the value arc, the ticks and the indicator line)
    for (const k of L.knobs || []) {
      const g = new THREE.Group(); content.add(g);
      const rs = k.r * 0.68, rc = k.r * 0.54, hS = 7, hC = 4.5, top = hS + hC;
      const cx = A0.x + (k.x - A0.x) * (D - top) / D, cy = A0.y + (k.y - A0.y) * (D - top) / D;   // top centre lines up with the DOM knob
      g.position.set(cx, cy, 0);
      const skirt = new THREE.CylinderGeometry(rs, rs * 1.02, hS, 56, 1);
      { const p = skirt.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), rr = Math.hypot(x, z); if (rr < rs * 0.5) continue; const a = Math.atan2(z, x), idx = Math.round(a / (Math.PI * 2 / 56)); if (idx % 2) { p.setX(i, x * 0.972); p.setZ(i, z * 0.972); } } skirt.computeVertexNormals(); }
      skirt.rotateX(Math.PI / 2); skirt.translate(0, 0, hS / 2);
      add(g, skirt, clay(C.skirt, { roughness: 0.55 }));
      const prof = [[rc, hS - 0.2], [rc, top - 2], [rc * 0.88, top - 0.6], [rc * 0.55, top + 0.35], [0.01, top + 0.6]].map(([r, z]) => new THREE.Vector2(r, z));
      const capG = new THREE.LatheGeometry(prof, 40); capG.rotateX(Math.PI / 2);
      add(g, capG, clay(C.cap, { roughness: 0.32, metalness: 0.55, gloss: true }));
      const halo = glowPlane(content, k.color, k.x, k.y, 0.5, k.r * 2.35, k.r * 2.35, ringTex);
      parts.knobs.push({ id: k.id, halo, g });
    }
    // backlight pools around the transport keys (green play, saffron loop, vermilion rec)
    const keyGlow = (r, hex) => r && glowPlane(content, hex, r.x + r.w / 2, r.y + r.h / 2, 0.4, r.w * 2.1, r.h * 1.7);
    parts.play = keyGlow(L.keys?.play, 0x57D19A); parts.loop = keyGlow(L.keys?.loop, 0xF5A524); parts.rec = keyGlow(L.keys?.rec, 0xF0622A);
    // the LCD glass gets a faint cool spill on the face
    if (L.lcd) parts.lcd = glowPlane(content, 0xffb54a, L.lcd.x + L.lcd.w / 2, L.lcd.y + L.lcd.h / 2, 0.3, L.lcd.w * 1.25, L.lcd.h * 1.5);

    // lights follow the layout
    key.position.set(W * 0.28, H + 520, 620); key.target.position.set(W * 0.5, H * 0.4, -40);
    const sc = key.shadow.camera; sc.left = -W * 0.62 - 60; sc.right = W * 0.62 + 60; sc.top = 260; sc.bottom = -260; sc.near = 200; sc.far = 1800; sc.updateProjectionMatrix();
    fill.position.set(W * 0.9, H * 0.5, 500); fill.target.position.set(W * 0.5, H * 0.5, 0);
    if (n) { spill.position.set(n.x + n.w * 0.35, n.y + n.h + 24, 70); nicheFill.position.set(n.x + n.w * 0.7, n.y + n.h * 0.5, -NICHE_DEPTH * 0.3); }
    dirtyShadow = true;
  }

  function buildNiche(n) {
    const g = new THREE.Group(); content.add(g); parts.niche = g;
    // the niche: a soft rounded box seen from inside (dusk slate, so the warm lamp reads). Its walls sit 4 px outside the
    // narrowest part of the window bevel, so no line of sight slips past them; its front rim faces the camera and is
    // culled (BackSide), so it never shows.
    const zb = -NICHE_DEPTH;
    add(g, roundedBox(n.w - 8, n.h - 8, -1 - zb, soft ? 2 : 3, 7), clay(C.niche, { roughness: 0.95, side: THREE.BackSide }), n.x + n.w / 2, n.y + n.h / 2, (zb - 1) / 2, { cast: false });
    const ix = n.x + BEVEL, iw = n.w - 2 * BEVEL, deskH = 5;
    // a warm wooden desk along the floor of the niche
    add(g, roundedBox(n.w - 9, deskH + 4, -10 - zb, 2, 2), clay(C.wood, { roughness: 0.75 }), n.x + n.w / 2, n.y + 4 + (deskH - 4) / 2, (zb - 10) / 2, { cast: false });
    const iy = n.y + 4 + deskH, ih = n.h - 8 - deskH;
    const floorY = iy, cy = iy + ih * 0.56;
    const fs = clamp(ih / 92, 0.55, 1.1);    // figure scale
    // what stands on the desk, left to right. Reels and the fox always (reels shrink first), then the VU, then extras.
    const avail = iw - 16;
    const W_ = { reels: 0, fox: 40 * fs, vu: 52 * fs, tapes: 40 * fs, plant: 26 * fs, spkL: 30 * fs, spkR: 30 * fs };
    let R = clamp(ih * 0.34, 16, 40);
    if (avail < R * 4.7 + W_.fox + 12) R = Math.max(17, (avail - W_.fox - 12) / 4.7);
    W_.reels = R * 4.7;
    const want = ['reels', 'fox', 'vu', 'tapes', 'plant', 'spkL', 'spkR'];
    const order = ['spkL', 'plant', 'reels', 'vu', 'fox', 'tapes', 'spkR'];
    let chosen = [], sum = 0;
    for (const id of want) { const gap = chosen.length ? 12 : 0; if (sum + W_[id] + gap <= avail) { chosen.push(id); sum += W_[id] + gap; } }
    chosen.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const tot = chosen.reduce((s, id) => s + W_[id], 0);
    const gap = clamp((avail - tot) / (chosen.length + 1), 8, 26);
    let x = ix + iw / 2 - (tot + gap * (chosen.length - 1)) / 2;
    const at = {}; for (const id of chosen) { at[id] = x + W_[id] / 2; x += W_[id] + gap; }
    const left = at[chosen[0]] - W_[chosen[0]] / 2, right = at[chosen[chosen.length - 1]] + W_[chosen[chosen.length - 1]] / 2;

    // ---- reels
    const reelZ = zb + 30, rxL = at.reels - R * 1.18, rxR = at.reels + R * 1.18;
    const mkReel = (rx) => {
      const rg = new THREE.Group(); rg.position.set(rx, cy, reelZ); g.add(rg);
      const flShape = new THREE.Shape(); flShape.absarc(0, 0, R, 0, Math.PI * 2, false);
      for (let i = 0; i < 3; i++) { const a0 = i * Math.PI * 2 / 3 + 0.5, hp = new THREE.Path();
        hp.absarc(0, 0, R * 0.8, a0, a0 + 1.25, false); hp.absarc(0, 0, R * 0.42, a0 + 1.25, a0, true); flShape.holes.push(hp); }
      const flG = new THREE.ExtrudeGeometry(flShape, { depth: 0.8, bevelEnabled: true, bevelThickness: 0.7, bevelSize: 0.6, bevelSegments: 2, curveSegments: soft ? 16 : 28 });
      add(rg, flG, clay(C.cream, { roughness: 0.32, metalness: 0.6, gloss: true }), 0, 0, 0);
      add(rg, flG, clay(0x8E959D, { roughness: 0.4, metalness: 0.5 }), 0, 0, -9);
      const pack = new THREE.Mesh(CYL, [clay(C.pack, { roughness: 0.45 }), new THREE.MeshStandardMaterial({ map: packCapTex, roughness: 0.4 }), clay(C.pack)]);
      pack.rotation.x = Math.PI / 2; pack.position.z = -4.3; pack.scale.set(R * 0.5, 7.4, R * 0.5); pack.castShadow = pack.receiveShadow = true; rg.add(pack);
      add(rg, CYL, clay(C.hub, { roughness: 0.4, gloss: true }), 0, 0, -1.5, { rx: Math.PI / 2, s: [R * 0.25, 9, R * 0.25] });
      for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; add(rg, new THREE.BoxGeometry(R * 0.07, R * 0.13, 1.2), clay(C.ink), Math.sin(a) * R * 0.17, Math.cos(a) * R * 0.17, 3.1, { rz: -a, cast: false }); }
      add(rg, SPHERE, clay(C.signal, { roughness: 0.35, gloss: true }), 0, 0, 3.1, { s: [R * 0.075, R * 0.075, 1.6] });
      add(g, CYL, clay(C.steel, { gloss: true, roughness: 0.35 }), rx, cy, (zb + reelZ) / 2 - 4, { rx: Math.PI / 2, s: [R * 0.08, reelZ - zb, R * 0.08], cast: false });
      return { rg, pack };
    };
    parts.L = mkReel(rxL); parts.R = mkReel(rxR); parts.R0 = R; parts.rx = [rxL, rxR]; parts.cy = cy; parts.reelZ = reelZ;
    // a small deck plate the reels are mounted on (reads as the machine inside the window)
    add(g, roundedBox(R * 4.9, R * 2.5 + 12, 6, 2, 6), clay(0x1A2028, { roughness: 0.6 }), at.reels, cy - 5, zb + 3, { cast: false });
    // tape path: packs -> guide rollers -> head -> guide rollers
    const gy = floorY + Math.max(7, ih * 0.1), gL = at.reels - R * 0.72, gR = at.reels + R * 0.72;
    parts.gy = gy; parts.gL = gL; parts.gR = gR;
    const tapeMat = clay(C.tape, { roughness: 0.35 });
    parts.tapes = [0, 1, 2].map(() => add(g, new THREE.BoxGeometry(1, 1, 3.4), tapeMat, 0, 0, reelZ - 4.3, { recv: false }));
    for (const gx of [gL, gR]) add(g, CYL, clay(C.steel, { gloss: true, roughness: 0.3 }), gx, gy, reelZ - 4.3, { rx: Math.PI / 2, s: [3.1, 9, 3.1] });
    add(g, roundedBox(R * 0.62, 9, 9, 2, 2.2), clay(C.steel, { gloss: true, roughness: 0.35 }), at.reels, gy - 3.2, reelZ - 4.3);
    parts.head = add(g, new THREE.BoxGeometry(R * 0.42, 1.4, 1), new THREE.MeshBasicMaterial({ color: 0xff7a4a, toneMapped: false, transparent: true, opacity: 0.25 }), at.reels, gy + 1.5, reelZ + 0.4, { cast: false, recv: false });
    parts.headGlow = glowPlane(g, 0xff7a4a, at.reels, gy + 1.5, reelZ + 0.8, R * 1.8, R * 0.7);

    // ---- VU meter (backlit, the needle swings with the master level)
    if (at.vu) {
      const vw = 52 * fs, vh = 40 * fs, vz = zb + 24;
      const vg = new THREE.Group(); vg.position.set(at.vu, floorY + vh / 2, vz); vg.rotation.y = -0.12; g.add(vg);
      add(vg, roundedBox(vw, vh, 18, 2, 4.5), clay(C.ink, { roughness: 0.38, gloss: true }), 0, 0, 0);
      const faceMat = new THREE.MeshStandardMaterial({ map: vuTex.tex, emissiveMap: vuTex.tex, emissive: 0xffa548, emissiveIntensity: 0.6, roughness: 0.8 });
      const fw = vw - 8 * fs, fh = vh - 13 * fs;
      add(vg, PLANE, faceMat, 0, 2.5 * fs, 9.1, { s: [fw, fh, 1], cast: false });
      const piv = new THREE.Group(); piv.position.set(0, 2.5 * fs - fh / 2 - fh * 0.42, 9.6); vg.add(piv);
      add(piv, new THREE.BoxGeometry(0.9, fh * 1.25, 0.4), new THREE.MeshBasicMaterial({ color: 0x1b1f22 }), 0, fh * 0.625, 0, { cast: false, recv: false });
      add(vg, roundedBox(vw - 2, 9 * fs, 3, 1, 1.4), clay(C.ink, { roughness: 0.45 }), 0, -vh / 2 + 4.5 * fs, 9.8, { cast: false });   // lip hides the pivot
      const led = add(vg, SPHERE, new THREE.MeshBasicMaterial({ color: 0x5a2a20, toneMapped: false }), vw / 2 - 6 * fs, -vh / 2 + 4.5 * fs, 11.6, { s: 1.4 * fs, cast: false });
      parts.vu = { piv, faceMat, led, glow: glowPlane(vg, 0xffc27a, 0, 2.5 * fs, 10.2, vw * 1.6, vh * 1.5) };
    }

    // ---- pendant lamp: hangs from the ceiling (so it always fits) over the VU / fox, warm light down onto the desk
    const lx = at.vu ?? (at.fox ? (at.fox + rxR + R) / 2 : rxR + R * 1.4), lz = zb + 38, shadeY = floorY + ih * 0.7;
    {
      const lg = new THREE.Group(); lg.position.set(lx, shadeY, lz); lg.scale.setScalar(fs); g.add(lg);
      const top = (n.y + n.h - 4) - shadeY;
      add(lg, CYL, clay(C.ink, { roughness: 0.5 }), 0, top / fs / 2 + 4, 0, { s: [0.55, top / fs, 0.55], cast: false });
      const shade = new THREE.LatheGeometry([[13, -1.5], [12.4, 0.5], [9, 6], [4.5, 9.5], [3.2, 12]].map(([r, y]) => new THREE.Vector2(r, y)), 32);
      add(lg, shade, clay(C.saffron, { roughness: 0.5, side: THREE.DoubleSide }), 0, 0, 0);
      add(lg, CYL, clay(C.ink, { roughness: 0.45 }), 0, 12.5, 0, { s: [2.4, 2.4, 2.4] });
      add(lg, SPHERE, new THREE.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false }), 0, 1.6, 0, { s: 4.6, cast: false, recv: false });
      parts.bulbGlow = glowPlane(g, 0xffc27a, lx, shadeY - 2 * fs, lz + 10, 74 * fs, 46 * fs);
      lamp.position.set(lx, shadeY - 1, lz); lamp.target.position.set(lx - 6, floorY, lz - 6);
    }
    // pools of lamplight: on the desk (horizontal) and on the back wall
    parts.pool = glowPlane(g, 0xffb46b, lx, floorY + 0.4, lz - 6, 120 * fs, 54 * fs); parts.pool.rotation.x = -Math.PI / 2;
    parts.wallPool = glowPlane(g, 0xff9f5a, lx, floorY + ih * 0.32, zb + 0.6, 230 * fs, ih * 1.25);

    // ---- fox figurine (sitting, listening; nods on the beat while the tape runs)
    if (at.fox) {
      const fg = new THREE.Group(); fg.position.set(at.fox, floorY, zb + 46); fg.scale.setScalar(fs * 1.05); fg.rotation.y = -0.5; g.add(fg);
      const o = clay(C.fox, { roughness: 0.62 }), cr = clay(C.foxCream, { roughness: 0.7 }), dk = clay(C.foxDark, { roughness: 0.5 });
      const sph = (par, r, m, x, y, z, sx = 1, sy = 1, sz = 1) => add(par, SPHERE, m, x, y, z, { s: [r * sx, r * sy, r * sz] });
      sph(fg, 10.5, o, 0, 13, 0, 1, 1.18, 0.95);
      sph(fg, 7, cr, 0, 13, 5.6, 0.95, 1.3, 0.62);
      sph(fg, 6.8, o, -6.6, 6.6, -1.5, 0.9, 0.9, 1.15); sph(fg, 6.8, o, 6.6, 6.6, -1.5, 0.9, 0.9, 1.15);
      sph(fg, 2.7, cr, -3.3, 2.3, 7.4, 1, 0.8, 1.35); sph(fg, 2.7, cr, 3.3, 2.3, 7.4, 1, 0.8, 1.35);
      [[9, 4.5, -6, 4.0], [13.5, 7, -1, 4.8], [13, 4.6, 5.5, 4.6], [8.6, 3, 9.6, 4.0], [3.6, 2.6, 11, 3.2]].forEach(([x, y, z, r], i) => sph(fg, r, i === 4 ? cr : o, x, y, z));
      const head = new THREE.Group(); head.position.set(0, 28.5, 1.4); fg.add(head);
      sph(head, 8.4, o, 0, 0, 0, 1.12, 0.95, 1);
      sph(head, 4.3, cr, -4.1, -2.8, 4.4); sph(head, 4.3, cr, 4.1, -2.8, 4.4);
      sph(head, 3.5, cr, 0, -2.4, 7.3, 1, 0.78, 1.25);
      sph(head, 1.3, dk, 0, -1.7, 11.4);
      sph(head, 1.05, dk, -3.3, 1.3, 7.5, 1.2, 0.5, 0.6); sph(head, 1.05, dk, 3.3, 1.3, 7.5, 1.2, 0.5, 0.6);
      const ear = (sx) => { const e = new THREE.Group(); e.position.set(4.8 * sx, 6.8, -0.6); e.rotation.z = -0.33 * sx; head.add(e);
        add(e, new THREE.ConeGeometry(3.7, 9, 18), o, 0, 3.6, 0); add(e, new THREE.ConeGeometry(1.9, 4.2, 14), dk, 0, 6.3, 0.05); add(e, new THREE.ConeGeometry(2.1, 5.2, 14), cr, 0, 2.8, 0.9, { s: [1, 1, 0.5] }); return e; };
      parts.fox = { head, ears: [ear(-1), ear(1)] };
    }
    // ---- cassette stack
    if (at.tapes) {
      const tg = new THREE.Group(); tg.position.set(at.tapes, floorY, zb + 40); tg.scale.setScalar(fs); g.add(tg);
      [[C.cobalt, 0.08], [C.saffron, -0.12], [C.leaf, 0.05], [0x5A626C, -0.04]].forEach(([c, r], i) => {
        const cg = new THREE.Group(); cg.position.set((i % 2 ? -1.5 : 1.2), 3.2 + i * 6.4, 0); cg.rotation.y = r; tg.add(cg);
        add(cg, roundedBox(36, 6, 23, 2, 1.6), clay(c, { roughness: 0.55 }), 0, 0, 0);
        add(cg, roundedBox(24, 3, 0.6, 1, 0.5), clay(0xF7F3EA, { roughness: 0.8 }), 0, 0, 11.6, { cast: false });
      });
    }
    // ---- plant
    if (at.plant) {
      const pg = new THREE.Group(); pg.position.set(at.plant, floorY, zb + 40); pg.scale.setScalar(fs); g.add(pg);
      add(pg, new THREE.CylinderGeometry(7.2, 5.6, 12, 24), clay(C.terracotta, { roughness: 0.8 }), 0, 6, 0);
      add(pg, CYL, clay(0x5a4436, { roughness: 1 }), 0, 11.6, 0, { s: [6.4, 0.8, 6.4], cast: false });
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2, tilt = 0.42 + (i % 2) * 0.22;
        const leaf = add(pg, SPHERE, clay(i % 2 ? C.plant : C.plant2, { roughness: 0.6 }), Math.sin(a) * 3.4, 19 + (i % 3) * 1.8, Math.cos(a) * 3.4, { s: [2.7, 9, 1.3] });
        leaf.rotation.set(Math.cos(a) * tilt, a, -Math.sin(a) * tilt); }
    }
    // ---- little monitor speakers at the ends of the desk
    for (const [id, sx] of [['spkL', 1], ['spkR', -1]]) {
      if (!at[id]) continue;
      const sg = new THREE.Group(); sg.position.set(at[id], floorY, zb + 36); sg.rotation.y = 0.18 * sx; sg.scale.setScalar(fs); g.add(sg);
      add(sg, roundedBox(26, 40, 22, 2, 4), clay(C.mint, { roughness: 0.6 }), 0, 20, 0);
      add(sg, new THREE.CylinderGeometry(8, 8, 2, 28), clay(C.ink, { roughness: 0.5 }), 0, 24.5, 11, { rx: Math.PI / 2 });
      add(sg, SPHERE, clay(0x8E959D, { roughness: 0.35, metalness: 0.5, gloss: true }), 0, 24.5, 12, { s: [3.2, 3.2, 1.6] });
      add(sg, new THREE.CylinderGeometry(3.4, 3.4, 2, 20), clay(C.ink, { roughness: 0.5 }), 0, 9.5, 11, { rx: Math.PI / 2 });
    }
    // ---- on the back wall, when the window is wide: a little window on a rainy dusk, and a fox-heart poster
    const wallL = left - ix, wallR = ix + iw - right;
    if (wallL > 90 * fs || iw > 640) {
      const ww = Math.min(96, Math.max(70, wallL * 0.62)) * fs, wh = ih * 0.5, wx = Math.max(ix + ww / 2 + 14, Math.min(left - ww / 2 - 14, ix + wallL * 0.5));
      const wg = new THREE.Group(); wg.position.set(wx, floorY + ih * 0.6, zb + 1.5); g.add(wg);
      add(wg, roundedBox(ww + 8, wh + 8, 3, 1, 2.5), clay(0x2A2F36, { roughness: 0.6 }), 0, 0, 0, { cast: false });
      add(wg, PLANE, new THREE.MeshBasicMaterial({ map: duskTex(), toneMapped: false, color: 0xd9d4e6 }), 0, 0, 1.6, { s: [ww, wh, 1], cast: false });
      add(wg, roundedBox(1.6, wh, 1.4, 1, 0.6), clay(0x2A2F36), 0, 0, 2.2, { cast: false });
      add(wg, roundedBox(ww + 14, 3.2, 7, 1, 1.2), clay(0x2A2F36), 0, -wh / 2 - 4, 3, { cast: false });
    }
    if (wallR > 70 * fs || iw > 760) {
      const pw = 34 * fs, ph = 44 * fs, px = Math.min(ix + iw - pw / 2 - 16, right + Math.max(16, wallR * 0.45));
      const pg = new THREE.Group(); pg.position.set(px, floorY + ih * 0.6, zb + 1.5); pg.rotation.z = 0.035; g.add(pg);
      add(pg, roundedBox(pw + 4, ph + 4, 2, 1, 1.2), clay(0x3A2A1C, { roughness: 0.7 }), 0, 0, 0, { cast: false });
      add(pg, PLANE, new THREE.MeshStandardMaterial({ map: posterTex(), roughness: 0.9 }), 0, 0, 1.1, { s: [pw, ph, 1], cast: false });
    }
  }

  // ---------------------------------------------------------------- camera (off-axis: the z = 0 plane stays put)
  const A0 = { x: 0, y: 0 };
  function placeCamera() {
    const px = W / 2 + A.cx, py = H / 2 + LIFT + A.cy;
    camera.position.set(px, py, D); camera.rotation.set(0, 0, 0); camera.updateMatrixWorld();
    const n = camera.near, f = camera.far;
    camera.projectionMatrix.makePerspective((0 - px) * n / D, (W - px) * n / D, (H - py) * n / D, (0 - py) * n / D, n, f);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  // ---------------------------------------------------------------- per frame
  function setGlow(m, key, target, dt, tau = 0.25) {
    if (!m) return false;
    const v = A.glow[key] ?? 0, nv = smoothTo(v, target, dt, tau); A.glow[key] = nv; m.material.opacity = nv; m.visible = nv > 0.003;
    return Math.abs(nv - target) > 0.003;
  }
  /** Advance the animation by dt seconds. Returns true while anything still moves (the worker keeps drawing). */
  function update(dt) {
    let moving = false;
    A.time += dt;
    const reduce = S.reduced;
    // camera parallax
    const tx = reduce ? 0 : S.px * PAR_X, ty = reduce ? 0 : S.py * PAR_Y;
    A.cx = smoothTo(A.cx, tx, dt, 0.35); A.cy = smoothTo(A.cy, ty, dt, 0.35);
    if (Math.abs(A.cx - tx) > 0.05 || Math.abs(A.cy - ty) > 0.05) moving = true; else { A.cx = tx; A.cy = ty; }
    placeCamera();
    // level (master RMS*3 from the page) -> smoothed glow + VU ballistics
    A.lv = smoothTo(A.lv, S.playing ? S.level : 0, dt, S.level > A.lv ? 0.06 : 0.25);
    if (A.lv > 0.002) moving = true;
    const rms = S.level / 3, vuT = S.playing && rms > 1e-5 ? 20 * Math.log10(rms) + 18 : -22;
    A.vu = smoothTo(A.vu, vuT, dt, 0.3); if (Math.abs(A.vu - vuT) > 0.15) moving = true;
    // reels: constant tape speed (the fuller reel turns slower); seeking shuttles the tape
    const R = parts.R0 || 30, a = R * 0.27, full = R * 0.92;
    if (A.lastFrac === null) { A.lastFrac = S.frac; A.fracS = S.frac; }
    const df = S.frac - A.lastFrac; A.lastFrac = S.frac;
    if (!S.playing && Math.abs(df) > 1e-5 && !reduce) A.shuttle += df * R * 70;
    A.fracS = S.playing ? S.frac : smoothTo(A.fracS, S.frac, dt, 0.3); if (Math.abs(A.fracS - S.frac) > 1e-4) moving = true;
    const rL = Math.sqrt(a * a + (1 - A.fracS) * (full * full - a * a)), rR = Math.sqrt(a * a + A.fracS * (full * full - a * a));
    A.spin = smoothTo(A.spin, S.playing && !reduce ? 1 : 0, dt, S.playing ? 0.25 : 0.45);
    if (A.spin > 0.002) moving = true; else A.spin = 0;
    let travel = A.spin * 30 * dt;            // px of tape per frame
    if (Math.abs(A.shuttle) > 0.3) { const s = A.shuttle * Math.min(1, dt / 0.3); A.shuttle -= s; travel += s; moving = true; } else A.shuttle = 0;
    A.angL += travel / rL; A.angR += travel / rR;
    if (parts.L) {
      parts.L.rg.rotation.z = -A.angL; parts.R.rg.rotation.z = -A.angR;
      parts.L.pack.scale.set(rL, 7.4, rL); parts.R.pack.scale.set(rR, 7.4, rR);
      // tape from each pack's lower side to the guide rollers, and across the head
      const [xL, xR] = parts.rx, cy = parts.cy, gy = parts.gy;
      const tL = { x: xL + rL * 0.5, y: cy - rL * 0.866 }, tR = { x: xR - rR * 0.5, y: cy - rR * 0.866 };
      const span = (m, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; m.position.x = (ax + bx) / 2; m.position.y = (ay + by) / 2; m.scale.set(0.9, Math.hypot(dx, dy), 1); m.rotation.z = Math.atan2(dy, dx) - Math.PI / 2; };
      const wob = S.playing && !reduce ? Math.sin(A.time * 23) * A.lv * 0.6 : 0;
      span(parts.tapes[0], tL.x, tL.y, parts.gL - 2.4, gy + 2.4); span(parts.tapes[1], parts.gL, gy + 3.1 + wob, parts.gR, gy + 3.1 - wob); span(parts.tapes[2], parts.gR + 2.4, gy + 2.4, tR.x, tR.y);
      parts.head.material.opacity = 0.25 + Math.min(1, A.lv * 1.8) * 0.75;
    }
    if (setGlow(parts.headGlow, 'head', Math.min(0.9, A.lv * 1.6), dt, 0.08)) moving = true;
    if (parts.vu) {
      parts.vu.piv.rotation.z = -vuTex.ang(A.vu);
      parts.vu.faceMat.emissiveIntensity = 0.3 + Math.min(1, A.lv * 1.2) * 0.4;
      parts.vu.led.material.color.setHex(A.vu > 1.5 ? 0xff5a2a : 0x5a2a20);
      if (setGlow(parts.vu.glow, 'vu', 0.12 + Math.min(1, A.lv) * 0.35, dt, 0.15)) moving = true;
    }
    // lamp: warm, steady, breathing very slightly with the music
    const lampI = 1 + A.lv * 0.25;
    lamp.intensity = 560 * lampI; spill.intensity = 150 * (0.9 + A.lv * 0.3); nicheFill.intensity = 40;
    if (setGlow(parts.bulbGlow, 'bulb', 0.55 + A.lv * 0.25, dt, 0.2)) moving = true;
    if (setGlow(parts.pool, 'pool', 0.3 + A.lv * 0.08, dt, 0.2)) moving = true;
    if (setGlow(parts.wallPool, 'wpool', 0.2 + A.lv * 0.08, dt, 0.2)) moving = true;
    // fox: nods on the beat, ears twitch now and then
    if (parts.fox) {
      if (S.playing && !reduce) A.beat += dt * S.bpm / 60;
      const nod = S.playing && !reduce ? Math.pow(Math.max(0, Math.sin(A.beat * Math.PI * 2)), 3) * (0.06 + A.lv * 0.1) : 0;
      const hx = smoothTo(parts.fox.head.rotation.x, nod, dt, 0.08); parts.fox.head.rotation.x = hx;
      parts.fox.head.rotation.z = S.playing && !reduce ? Math.sin(A.beat * Math.PI) * 0.05 : smoothTo(parts.fox.head.rotation.z, 0, dt, 0.4);
      const tw = S.playing && !reduce ? Math.max(0, Math.sin(A.time * 0.9) - 0.94) * 4 : 0;
      parts.fox.ears[0].rotation.z = 0.33 + tw * 0.5; parts.fox.ears[1].rotation.z = -0.33;
      if (Math.abs(hx - nod) > 0.002 || Math.abs(parts.fox.head.rotation.z) > 0.002) moving = true;
    }
    // knob halos: brightness = the knob's value; they breathe a little with the music
    for (const k of parts.knobs) {
      const v = S.knobs[k.id] ?? 0.5, t = (0.16 + v * 0.62) * (1 + A.lv * 0.35);
      if (setGlow(k.halo, 'k' + k.id, t, dt, 0.12)) moving = true;
    }
    if (setGlow(parts.play, 'play', S.playing ? 0.42 + A.lv * 0.3 : 0, dt)) moving = true;
    if (setGlow(parts.loop, 'loop', S.loop ? 0.32 : 0, dt)) moving = true;
    if (setGlow(parts.rec, 'rec', S.rec ? 0.5 + Math.sin(A.time * 4) * 0.12 : 0, dt)) moving = true;
    if (S.rec) moving = true;
    if (setGlow(parts.lcd, 'lcd', 0.07 + (S.playing ? 0.05 : 0), dt)) moving = true;
    // shadows: re-rendered only when something that casts them moved (and every other frame at most)
    const niche = A.spin > 0 || A.shuttle !== 0 || (parts.fox && S.playing);
    if (dirtyShadow || (niche && (++A.shadowN % (soft ? 6 : 2) === 0))) { renderer.shadowMap.needsUpdate = true; dirtyShadow = false; }
    return moving;
  }

  build(); placeCamera();
  return {
    renderer, soft,
    set(st) { Object.assign(S, st); },
    get state() { return S; },
    layout(w, h, l, pr) {
      W = w; H = h; L = l; renderer.setPixelRatio(soft ? 1 : Math.min(1.5, pr || PR)); renderer.setSize(w, h, false); build(); placeCamera();
    },
    update, render() { renderer.render(scene, camera); },
    dispose() { disposeGroup(scene); renderer.dispose(); pmrem.dispose(); },
  };
}
