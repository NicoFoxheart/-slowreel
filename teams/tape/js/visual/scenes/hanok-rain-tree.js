// hanok-rain-tree.js - scene-local helper of hanok-rain.js: a Korean maple (danpung-namu, Acer palmatum) growing
// beside the courtyard. A seeded, multi-stemmed branch skeleton (tapered cylinders merged into one mesh) carries leaf
// clusters (instanced alpha-tested cards baked with five/seven-lobed palmate leaves). Colour per variant (deep summer
// green at blue hour, crimson-orange in autumn, red with a dusting of snow for the first snow). A wind sway in the
// vertex shader, driven only by uniforms set from t, keeps it deterministic.
import * as kit from './kit.js?v=9b';
import { createBuilder } from './hanok-rain-geo.js?v=9b';

// one card = a loose cluster of 7 palmate leaves on a transparent background; rgb = albedo factor, a = coverage
const LEAF_FS = `
float leaf(vec2 p, float rot, float s, float lobes, out float vein) {
  float c = cos(rot), si = sin(rot); p = mat2(c, -si, si, c) * p / s;
  float r = length(p), th = atan(p.x, p.y);                          // th = 0 points along the leaf axis (+y)
  float k = lobes * 0.5;
  float lobe = pow(abs(cos(th * k)), 0.7);                           // deep palmate lobes
  float edge = 0.28 + 0.62 * lobe * smoothstep(3.0, 1.6, abs(th));   // the lowest lobes are smaller, a notch at the stem
  edge *= 1.0 + 0.04 * sin(th * 38.0);                               // serrated margin
  vein = smoothstep(0.035, 0.0, abs(fract(th * k / 3.14159 + 0.5) - 0.5) * r * 2.4) * smoothstep(0.9, 0.1, r / edge);
  float stem = smoothstep(0.03, 0.0, abs(p.x)) * step(p.y, 0.0) * step(-0.55, p.y);
  return max(smoothstep(edge, edge - 0.04, r), stem);
}
vec4 bake(vec2 uv) {
  vec2 q = uv * 2.0 - 1.0; float a = 0.0, v = 0.0; float sh = 1.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    vec2 h = kHash22(vec2(fi * 3.7, 1.3)) * 2.0 - 1.0;
    vec2 c = h * 0.52; float rot = (kHash12(vec2(fi, 7.1)) - 0.5) * 3.0 + atan(c.x, c.y);
    float vn; float m = leaf(q - c, rot, 0.36 + 0.12 * kHash12(vec2(fi, 2.9)), mod(fi, 3.0) < 1.0 ? 7.0 : 5.0, vn);
    if (m > a) { sh = 0.82 + 0.3 * kHash12(vec2(fi, 9.4)); v = vn; }
    a = max(a, m);
  }
  float n = kFbm2(uv * 18.0, 3);
  vec3 col = vec3(sh * (0.85 + 0.25 * n)) * (1.0 - 0.25 * v);
  return vec4(col, a);
}`;

/** A maple at (x, z). opts: { height, spread, seed, quality, palette: [[r,g,b] linear...], snow 0..1, sky } -> { trunk, leaves, uniforms, dispose } */
export function createMaple(THREE, renderer, { x = 0, z = 0, y = 0, height = 6.5, spread = 3.4, seed = 1, quality = 'high', palette, snow = 0, sky, leafScale = 1 }) {
  const r = kit.rng(kit.hashSeed('hanok-maple', seed));
  const B = createBuilder(THREE);
  const tips = [];
  const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const radial = quality === 'light' ? 5 : 7;
  const bark = () => { const k = 0.55 + 0.25 * r(); return [0.05 * k, 0.042 * k, 0.036 * k]; };
  // a branch: a few bent segments from a with direction d, length L, base radius R; recursion makes the crown
  function branch(a, d, L, R, depth) {
    const nSeg = depth === 0 ? 4 : 3; let p = a.clone(), dir = d.clone().normalize(), rad = R;
    for (let s = 0; s < nSeg; s++) {
      const len = L / nSeg, rad1 = rad * (depth === 0 ? 0.82 : 0.7);
      // bend: a little toward the light (up and out) plus a seeded wobble
      dir.add(new THREE.Vector3((r() - 0.5) * 0.5, 0.12 + (r() - 0.5) * 0.2, (r() - 0.5) * 0.5)).normalize();
      const b = p.clone().addScaledVector(dir, len);
      const g = new THREE.CylinderGeometry(rad1, rad, len * 1.04, radial, 1, true);
      q.setFromUnitVectors(up, dir); ps.addVectors(p, b).multiplyScalar(0.5); sc.set(1, 1, 1); m4.compose(ps, q, sc);
      B.add(g, m4, bark());
      // side shoots
      if (depth < 3 && s > 0) {
        const kids = depth === 0 ? 2 : 2 + (r() < 0.4 ? 1 : 0);
        for (let k = 0; k < kids; k++) {
          const az = r() * Math.PI * 2, out = new THREE.Vector3(Math.cos(az), 0.35 + 0.5 * r() - depth * 0.08, Math.sin(az));
          const nd = dir.clone().multiplyScalar(0.5).add(out.normalize()).normalize();
          branch(b.clone(), nd, L * (0.55 + 0.2 * r()), rad1 * 0.62, depth + 1);
        }
      }
      p = b; rad = rad1;
    }
    if (depth >= 2) tips.push({ p, dir, depth });
  }
  // Acer palmatum: short trunk splitting low into 3-4 leaning stems that open into a broad, layered dome
  const base = new THREE.Vector3(x, y, z);
  const nStem = 3 + (r() < 0.5 ? 1 : 0);
  for (let i = 0; i < nStem; i++) {
    const az = (i / nStem) * Math.PI * 2 + r() * 0.8;
    const d = new THREE.Vector3(Math.cos(az) * 0.42, 1, Math.sin(az) * 0.42);
    branch(base.clone().add(new THREE.Vector3(Math.cos(az) * 0.06, 0, Math.sin(az) * 0.06)), d, height * (0.42 + 0.1 * r()), 0.13 + 0.03 * r(), 0);
  }
  const trunkGeo = B.build();
  trunkGeo.deleteAttribute('aAux');

  // leaf clusters around the tips, shaped into a flattened dome (maples hold their foliage in horizontal layers)
  const cards = [];
  const nCards = Math.round((quality === 'light' ? 700 : quality === 'ultra' ? 2600 : 1700) * leafScale);
  const per = Math.max(1, Math.ceil(nCards / Math.max(1, tips.length)));
  for (const t of tips) for (let k = 0; k < per && cards.length < nCards; k++) {
    const rr = 0.55 + 0.45 * r();
    const o = new THREE.Vector3((r() - 0.5) * 1.6, (r() - 0.5) * 0.7, (r() - 0.5) * 1.6).multiplyScalar(rr);
    const p = t.p.clone().add(o);
    // crown envelope: squash anything outside an ellipsoid
    const dx = (p.x - x) / spread, dz = (p.z - z) / spread, dy = (p.y - (y + height * 0.62)) / (height * 0.42);
    const e = Math.hypot(dx, dy, dz); if (e > 1.08) p.lerp(new THREE.Vector3(x, y + height * 0.62, z), 1 - 1.04 / e);
    cards.push({ p, s: (0.55 + 0.35 * r()) * (quality === 'light' ? 1.25 : 1), yaw: r() * Math.PI * 2, tilt: -0.9 + r() * 0.7, roll: (r() - 0.5) * 0.8, c: r(), sh: r() });
  }
  const leafTex = kit.cached(renderer, 'hanok:maple-leaf:' + (quality === 'light' ? 256 : 512), () => kit.bakeTexture(THREE, renderer, { width: quality === 'light' ? 256 : 512, fragment: LEAF_FS, wrap: 'clamp' }));
  const cardGeo = new THREE.PlaneGeometry(1, 1);
  const U = { uSway: { value: new THREE.Vector3() }, uTimeS: { value: 0 }, uBase: { value: new THREE.Vector3(x, y, z) }, uSnowL: { value: snow }, uTrans: { value: new THREE.Vector3(0, 0, 0) } };
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.62, metalness: 0, vertexColors: false, envMapIntensity: 0.9 });
  const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, envMapIntensity: 0.8 });
  const sway = (sh, leaves) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec3 uSway, uBase; uniform float uTimeS; varying float vLeafUp;')
      .replace('#include <project_vertex>', `
      {
        vec4 wp0 = modelMatrix * ${leaves ? 'instanceMatrix * ' : ''}vec4(transformed, 1.0);
        float hgt = max(wp0.y - uBase.y - 1.0, 0.0);
        float k = hgt * hgt * 0.012;
        float ph = dot(wp0.xz, vec2(0.37, 0.29));
        vec3 off = uSway * k * (1.0 + 0.35 * sin(uTimeS * 1.3 + ph)) ${leaves ? '+ vec3(sin(uTimeS * 3.1 + ph * 4.0), sin(uTimeS * 2.3 + ph * 5.0) * 0.6, cos(uTimeS * 2.7 + ph * 3.0)) * 0.025 * (0.4 + length(uSway))' : ''};
        transformed += (inverse(mat3(modelMatrix)) * off)${leaves ? '' : ''};
      }
      #include <project_vertex>
      ${leaves ? 'vLeafUp = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal).y;' : ''}`);
    if (leaves) {
      // the sway offset is in world space; for instanced cards it is applied before instanceMatrix, so undo its rotation
      sh.vertexShader = sh.vertexShader.replace('transformed += (inverse(mat3(modelMatrix)) * off);', 'transformed += inverse(mat3(modelMatrix) * mat3(instanceMatrix)) * off;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSnowL; uniform vec3 uTrans; varying float vLeafUp;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.82, 0.86), uSnowL * smoothstep(0.2, 0.75, abs(vLeafUp)) * step(0.5, fract(vMapUv.x * 3.7 + vMapUv.y * 2.3) + 0.3));`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += uTrans * diffuseColor.rgb;`);           // thin-leaf translucency (sky / sun from behind)
    }
  };
  trunkMat.onBeforeCompile = (sh) => sway(sh, false); trunkMat.customProgramCacheKey = () => 'hanokmaple-trunk';
  leafMat.onBeforeCompile = (sh) => sway(sh, true); leafMat.customProgramCacheKey = () => 'hanokmaple-leaf';
  if (sky) { sky.patch(trunkMat); sky.patch(leafMat); }
  const trunk = new THREE.Mesh(trunkGeo, trunkMat); trunk.castShadow = true; trunk.receiveShadow = true; trunk.name = 'maple-trunk';
  const leaves = new THREE.InstancedMesh(cardGeo, leafMat, cards.length); leaves.name = 'maple-leaves'; leaves.castShadow = true;
  const col = new THREE.Color(), e = new THREE.Euler();
  const pal = palette || [[0.03, 0.06, 0.018], [0.04, 0.075, 0.02], [0.025, 0.05, 0.02]];
  cards.forEach((c, i) => {
    e.set(c.tilt, c.yaw, c.roll, 'YXZ'); q.setFromEuler(e); sc.set(c.s, c.s, c.s); m4.compose(c.p, q, sc); leaves.setMatrixAt(i, m4);
    const a = pal[Math.floor(c.c * pal.length) % pal.length], b = pal[(Math.floor(c.c * pal.length) + 1) % pal.length], f = (c.c * pal.length) % 1;
    const shade = 0.75 + 0.45 * c.sh * (0.6 + 0.4 * kit.smoothstep(y + 1, y + height, c.p.y));   // inner / lower leaves darker
    leaves.setColorAt(i, col.setRGB(kit.lerp(a[0], b[0], f) * shade, kit.lerp(a[1], b[1], f) * shade, kit.lerp(a[2], b[2], f) * shade));
  });
  leaves.instanceMatrix.needsUpdate = true; if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  leaves.computeBoundingSphere?.();
  return {
    trunk, leaves, uniforms: U,
    update(t, wind = [0, 0, 0], gust = 0.4) {
      const w = kit.windAt(t, wind, gust); U.uSway.value.set(w[0], 0, w[2]).multiplyScalar(0.9); U.uTimeS.value = t;
    },
    dispose() { trunkGeo.dispose(); cardGeo.dispose(); trunkMat.dispose(); leafMat.dispose(); leaves.dispose(); },
  };
}
