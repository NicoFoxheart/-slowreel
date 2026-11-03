// Planet: procedural, plausible whole-world fields so you can free fly anywhere. This is NOT real map data:
// - land / sea comes from where the OurAirports airports and navaids are (land is where airports are; neighbouring airports
//   of the same country are joined and the triangles between them filled, so continents close up; a lone airport makes an island);
// - base elevation is interpolated from the airport elevations (plateaus where the airports are high, lowlands at the coast);
// - mountain belts come from coarse relief hints (rough centre lines of the big ranges, a few hundred km wide) and high airports;
//   terrain.js turns the amplitude into ridged procedural mountains.
// Fields: an equirectangular RGBA8 2048 x 1024 texture (about 20 km per pixel; r = sea, g = hand-made region cover (featured
// airports keep their surroundings.js detail), b = mountain amplitude) and a 512 x 256 half-float base elevation grid (m).
// The same arrays serve the CPU twin (sample) so the aircraft collides with what it sees.
import * as THREE from 'three';
import { World, D2R } from './data.js';
import { REGIONS } from './surroundings.js';

export const PW = 2048, PH = 1024, BW = 512, BH = 256;
const KM_PX = PH / 20015; // pixels per km north-south
// coarse relief hints: [amplitude 0..1, belt width km, lat, lon, lat, lon, ...]
const RELIEF = [
  [1.0, 170, 44.2, 7.2, 45.8, 6.9, 46.4, 8.5, 46.6, 10.2, 47.1, 12.0, 47.3, 14.0, 47.6, 15.8], // Alps
  [0.75, 90, 42.9, -1.6, 42.6, 0.8, 42.5, 2.5], // Pyrenees
  [0.4, 110, 43.2, -6.5, 42.9, -4.0, 40.4, -4.0, 37.1, -3.4], // Iberian ranges
  [0.45, 120, 49.3, 19.0, 49.0, 22.5, 47.8, 24.8, 46.0, 25.8, 45.4, 23.5], // Carpathians
  [0.45, 120, 45.6, 15.0, 44.0, 17.5, 42.5, 19.8, 41.0, 21.0, 39.8, 21.3, 38.5, 22.0], // Dinaric Alps, Pindus
  [0.4, 70, 44.3, 10.0, 43.0, 12.8, 41.5, 14.2, 40.0, 16.0, 38.6, 16.2], // Apennines
  [0.5, 130, 59.5, 7.0, 62.0, 9.0, 64.5, 13.5, 67.5, 16.5, 69.5, 20.0], // Scandinavian mountains
  [0.25, 110, 56.8, -5.2, 57.6, -4.0], // Scottish highlands
  [0.3, 140, 64.8, -19.5, 64.6, -17.0], // Iceland highlands
  [0.9, 110, 43.8, 40.0, 43.0, 43.5, 41.8, 46.5], // Caucasus
  [0.5, 150, 37.0, 30.0, 37.5, 34.0, 38.5, 38.0, 40.5, 41.5, 40.8, 37.0, 41.0, 33.0], // Taurus, Pontic
  [0.7, 140, 30.5, -9.5, 32.0, -6.0, 34.0, -2.0, 35.5, 3.0, 36.0, 7.5], // Atlas
  [0.65, 160, 37.0, 44.5, 34.0, 47.0, 31.5, 50.0, 29.0, 53.0, 27.5, 56.5], // Zagros
  [0.6, 110, 36.6, 49.0, 36.0, 52.0, 37.3, 56.0], // Alborz
  [0.9, 200, 34.5, 69.0, 36.0, 71.5, 37.5, 73.5, 39.5, 73.0], // Hindu Kush, Pamir
  [1.0, 220, 35.5, 74.5, 33.0, 77.0, 30.5, 80.5, 28.5, 84.0, 27.8, 87.0, 27.5, 90.0, 28.5, 94.0], // Himalaya
  [0.7, 520, 32.5, 82.0, 33.0, 88.0, 32.5, 94.0], // Tibetan plateau
  [0.8, 180, 41.0, 70.0, 42.0, 75.5, 42.5, 80.0, 43.0, 85.0, 43.5, 89.0], // Tian Shan
  [0.6, 200, 49.5, 86.0, 48.5, 90.0, 47.0, 95.0], // Altai
  [0.3, 120, 51.5, 58.5, 55.0, 59.0, 60.0, 59.5, 65.0, 60.5, 68.0, 65.0], // Urals
  [0.5, 90, 33.5, 131.5, 35.0, 135.5, 36.2, 137.8, 38.5, 140.3, 41.0, 140.8, 43.5, 142.8], // Japan
  [0.6, 50, 22.5, 120.8, 24.6, 121.3], // Taiwan
  [0.3, 60, 38.5, 128.3, 37.0, 128.8, 35.5, 128.5], // Korean ridge
  [0.4, 260, 26.0, 99.0, 28.0, 101.5, 31.0, 103.0], // Hengduan
  [0.85, 330, 60.0, -136.0, 56.0, -125.5, 52.0, -118.5, 49.0, -114.5, 46.0, -112.5, 43.5, -110.5, 40.5, -106.5, 37.5, -106.0, 34.0, -106.0], // Rockies
  [0.6, 110, 49.0, -121.3, 46.5, -121.7, 44.0, -122.0, 41.5, -122.3, 39.0, -120.3, 36.8, -118.6, 35.4, -118.3], // Cascades, Sierra Nevada
  [0.7, 170, 61.0, -150.0, 62.5, -146.0, 61.0, -141.0, 59.5, -137.0], // Alaska Range
  [0.4, 120, 68.0, -160.0, 68.3, -150.0, 68.5, -142.0], // Brooks Range
  [0.25, 160, 34.0, -85.5, 36.0, -82.5, 38.0, -79.8, 40.5, -77.5, 42.5, -74.5, 44.5, -71.5, 46.5, -69.0], // Appalachians
  [0.6, 200, 31.0, -108.5, 27.0, -106.5, 23.0, -104.5, 19.5, -101.5, 19.0, -98.0, 17.0, -96.5, 16.0, -93.0], // Sierra Madre
  [0.4, 80, 15.0, -90.5, 13.5, -87.0, 11.5, -85.5, 9.5, -83.5], // Central America
  [1.0, 250, 10.5, -71.5, 7.0, -72.8, 4.5, -75.5, 1.0, -77.5, -2.0, -78.5, -6.0, -78.0, -10.0, -76.5, -14.0, -73.0, -16.5, -69.0, -20.0, -68.0, -24.0, -67.5, -28.0, -69.0, -32.5, -70.0, -36.0, -70.5, -40.0, -71.5, -44.0, -72.0, -48.0, -73.0, -52.0, -73.0], // Andes
  [0.25, 160, -23.5, -46.0, -26.0, -49.0, -20.0, -43.5], // Serra do Mar
  [0.7, 300, 14.0, 38.5, 10.0, 38.5, 7.0, 38.0], // Ethiopian highlands
  [0.5, 220, 2.0, 36.5, -1.0, 36.8, -3.1, 37.3, -6.0, 36.0, -9.0, 34.0], // East African highlands
  [0.45, 120, -28.5, 29.0, -30.0, 28.5, -31.5, 27.5], // Drakensberg
  [0.3, 150, -16.0, 145.0, -20.0, 147.0, -25.0, 151.0, -29.0, 152.0, -33.0, 150.0, -36.5, 148.5, -37.5, 146.0], // Great Dividing Range
  [0.8, 70, -41.5, 172.5, -43.5, 170.5, -45.0, 168.0], // Southern Alps
  [0.8, 150, -4.0, 136.0, -5.5, 141.0, -6.5, 145.0], // New Guinea highlands
  [0.4, 70, 4.0, 96.5, 0.0, 100.0, -4.0, 103.0], // Sumatra
];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const px = lon => (lon + 180) / 360 * PW, py = lat => (90 - lat) / 180 * PH;
function dKm(a, b) { const c = Math.cos((a.lat + b.lat) * 0.5 * D2R); let dl = b.lon - a.lon; if (dl > 180) dl -= 360; if (dl < -180) dl += 360; return Math.hypot((b.lat - a.lat) * 111.2, dl * 111.2 * c); }

let P = null;
export function planet() { return P; }
export function buildPlanet() {
  if (P) return P;
  const t0 = performance.now();
  // ---- points: airports (with country) + navaids (country of the nearest airport within 400 km)
  const cell = 3, GW = 120, GH = 60, grid = new Map(), key = (la, lo) => ((Math.floor((lo + 180) / cell) % GW + GW) % GW) + GW * Math.min(GH - 1, Math.max(0, Math.floor((la + 90) / cell)));
  const add = p => { const k = key(p.lat, p.lon); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(p); };
  const near = (p, rKm, f) => { const dLa = Math.ceil(rKm / 111 / cell) + 1, cy = Math.floor((p.lat + 90) / cell), cx = Math.floor((p.lon + 180) / cell), dLo = Math.min(GW / 2, Math.ceil(dLa / Math.max(0.08, Math.cos(Math.min(85, Math.abs(p.lat)) * D2R))));
    for (let y = cy - dLa; y <= cy + dLa; y++) { if (y < 0 || y >= GH) continue; for (let x = cx - dLo; x <= cx + dLo; x++) { const a = grid.get(((x % GW) + GW) % GW + GW * y); if (a) for (const q of a) f(q); } } };
  const apts = World.airports.map(a => ({ lat: a.lat, lon: a.lon, cc: a.cc, kind: a.large ? 2 : 1, elev: (a.elevFt || 0) * 0.3048 }));
  apts.forEach(add);
  const navs = World.navaids.map(n => { const p = { lat: n.lat, lon: n.lon, cc: '?', kind: 0 }; let bd = 400; near(p, 400, q => { if (q.kind) { const d = dKm(p, q); if (d < bd) { bd = d; p.cc = q.cc; } } }); return p; });
  navs.forEach(add); const pts = apts.concat(navs);
  // ---- land canvas: discs, same-country links (capsules) and the triangles between linked neighbours
  const cv = document.createElement('canvas'); cv.width = PW; cv.height = PH; const c = cv.getContext('2d', { willReadFrequently: true });
  c.fillStyle = '#000'; c.fillRect(0, 0, PW, PH); c.fillStyle = c.strokeStyle = '#fff'; c.lineCap = 'round';
  const LMAX = 650;
  for (const p of pts) { if (p.cc === '?') continue; const nb = []; near(p, LMAX, q => { if (q !== p && q.cc === p.cc) { const d = dKm(p, q); if (d > 2 && d < LMAX) nb.push([d, q]); } }); nb.sort((a, b) => a[0] - b[0]); p.nb = nb.slice(0, 3); }
  const wrapOK = (a, b) => Math.abs(b.lon - a.lon) < 180;
  for (const p of pts) { if (!p.nb) continue; // triangles
    for (let i = 0; i < p.nb.length; i++) for (let j = i + 1; j < p.nb.length; j++) { const a = p.nb[i][1], b = p.nb[j][1]; if (!wrapOK(p, a) || !wrapOK(p, b) || !wrapOK(a, b) || dKm(a, b) > LMAX * 0.85) continue;
      c.beginPath(); c.moveTo(px(p.lon), py(p.lat)); c.lineTo(px(a.lon), py(a.lat)); c.lineTo(px(b.lon), py(b.lat)); c.closePath(); c.fill(); } }
  for (const p of pts) { if (!p.nb) continue; const cs = Math.max(0.1, Math.cos(p.lat * D2R)); // capsules, drawn in a locally isotropic frame
    for (const [d, q] of p.nb) { if (!wrapOK(p, q)) continue; c.save(); c.translate(px(p.lon), py(p.lat)); c.scale(1 / cs, 1); c.lineWidth = Math.min(220, Math.max(26, d * 0.5)) * KM_PX; c.beginPath(); c.moveTo(0, 0); c.lineTo((px(q.lon) - px(p.lon)) * cs, py(q.lat) - py(p.lat)); c.stroke(); c.restore(); } }
  for (const p of pts) { const r = (p.kind === 2 ? 24 : p.kind === 1 ? 16 : 12) * KM_PX, cs = Math.max(0.1, Math.cos(p.lat * D2R)); c.beginPath(); c.ellipse(px(p.lon), py(p.lat), Math.max(0.8, r / cs), Math.max(0.8, r), 0, 0, Math.PI * 2); c.fill(); }
  const blur = (src, b) => { const o = document.createElement('canvas'); o.width = PW; o.height = PH; const x = o.getContext('2d', { willReadFrequently: true }); x.filter = `blur(${b}px)`; x.drawImage(src, 0, 0); x.filter = 'none'; return o; };
  const landC = blur(cv, 1.6), land = landC.getContext('2d').getImageData(0, 0, PW, PH).data;
  // ---- relief: hint belts (max-composited) + high airports, softened, only on land
  const rv = document.createElement('canvas'); rv.width = PW; rv.height = PH; const r = rv.getContext('2d', { willReadFrequently: true }); r.fillStyle = '#000'; r.fillRect(0, 0, PW, PH); r.globalCompositeOperation = 'lighten'; r.lineCap = r.lineJoin = 'round';
  for (const h of RELIEF) { const [amp, wKm] = h; const v = Math.round(255 * amp); r.strokeStyle = `rgb(${v},${v},${v})`;
    for (let i = 2; i + 3 < h.length; i += 2) { const la = h[i], lo = h[i + 1], la2 = h[i + 2], lo2 = h[i + 3], cs = Math.max(0.1, Math.cos((la + la2) * 0.5 * D2R)); r.save(); r.translate(px(lo), py(la)); r.scale(1 / cs, 1); r.lineWidth = wKm * 0.7 * KM_PX; r.beginPath(); r.moveTo(0, 0); r.lineTo((px(lo2) - px(lo)) * cs, py(la2) - py(la)); r.stroke(); r.restore(); } }
  for (const a of apts) if (a.elev > 1300) { const v = Math.round(255 * Math.min(0.55, 0.15 + (a.elev - 1300) / 4000)); const g = r.createRadialGradient(px(a.lon), py(a.lat), 0, px(a.lon), py(a.lat), 110 * KM_PX / Math.max(0.2, Math.cos(a.lat * D2R)));
    g.addColorStop(0, `rgba(${v},${v},${v},1)`); g.addColorStop(1, 'rgba(0,0,0,0)'); r.fillStyle = g; r.fillRect(px(a.lon) - 40, py(a.lat) - 40, 80, 80); }
  const relief = blur(rv, 3).getContext('2d').getImageData(0, 0, PW, PH).data;
  // ---- hand-made region cover (featured airports: surroundings.js draws their coast and hills)
  const fv = document.createElement('canvas'); fv.width = PW; fv.height = PH; const f = fv.getContext('2d', { willReadFrequently: true }); f.fillStyle = '#000'; f.fillRect(0, 0, PW, PH); f.fillStyle = '#fff';
  for (const R of REGIONS) { const [la0, lo0, la1, lo1] = R.bbox; f.fillRect(px(lo0 - 0.15), py(la1 + 0.15), (lo1 - lo0 + 0.3) / 360 * PW, (la1 - la0 + 0.3) / 180 * PH); }
  const feat = blur(fv, 1).getContext('2d').getImageData(0, 0, PW, PH).data;
  // ---- pack: r = sea, g = featured cover, b = mountain amplitude (on land)
  const tex = new Uint8Array(PW * PH * 4);
  for (let i = 0; i < PW * PH; i++) { const L = land[i * 4] / 255, ln = smooth(0.25, 0.75, L); tex[i * 4] = Math.round(255 * (1 - ln)); tex[i * 4 + 1] = feat[i * 4]; tex[i * 4 + 2] = Math.round(relief[i * 4] * smooth(0.3, 0.8, L)); tex[i * 4 + 3] = 255; }
  // ---- base elevation: inverse-distance mean of the airport elevations within 450 km, eased to 0 at the coast
  const base = new Float32Array(BW * BH), half = new Uint16Array(BW * BH);
  for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) { const q = { lat: 90 - (y + 0.5) / BH * 180, lon: (x + 0.5) / BW * 360 - 180 };
    let sw = 0, sv = 0; near(q, 450, a => { if (!a.kind) return; const d = dKm(q, a); if (d > 450) return; const w = 1 / (d * d + 2500) * (1 - d / 450); sw += w; sv += w * a.elev; });
    const S = sampleArr(tex, PW, PH, q.lat, q.lon, 0) / 255; const e = sw > 0 ? sv / sw : 0; base[y * BW + x] = e * (1 - smooth(0.2, 0.55, S)); }
  for (let i = 0; i < base.length; i++) half[i] = THREE.DataUtils.toHalfFloat(base[i]);
  const T = new THREE.DataTexture(tex, PW, PH, THREE.RGBAFormat); T.wrapS = THREE.RepeatWrapping; T.wrapT = THREE.ClampToEdgeWrapping; T.magFilter = T.minFilter = THREE.LinearFilter; T.generateMipmaps = false; T.needsUpdate = true;
  const B = new THREE.DataTexture(half, BW, BH, THREE.RedFormat, THREE.HalfFloatType); B.wrapS = THREE.RepeatWrapping; B.wrapT = THREE.ClampToEdgeWrapping; B.magFilter = B.minFilter = THREE.LinearFilter; B.generateMipmaps = false; B.needsUpdate = true;
  P = { tex: T, baseTex: B, data: tex, base, landCanvas: landC, ms: Math.round(performance.now() - t0), points: pts.length,
    // CPU twin of the shader lookups: out = [sea 0..1, featured cover 0..1, mountain amplitude 0..1, base elevation m]
    sample(lat, lon, out = [0, 0, 0, 0]) { out[0] = sampleArr(tex, PW, PH, lat, lon, 0) / 255; out[1] = sampleArr(tex, PW, PH, lat, lon, 1) / 255; out[2] = sampleArr(tex, PW, PH, lat, lon, 2) / 255; out[3] = sampleF(base, BW, BH, lat, lon); return out; },
  };
  return P;
}
// bilinear lookups matching GPU linear filtering (texel centres at +0.5, longitude wraps, latitude clamps)
function uvIdx(W, H, lat, lon) { const u = ((lon + 180) / 360) * W - 0.5, v = ((90 - lat) / 180) * H - 0.5; const x0 = Math.floor(u), y0 = Math.floor(v); return [x0, y0, u - x0, v - y0]; }
function sampleArr(a, W, H, lat, lon, ch) { const [x0, y0, tx, ty] = uvIdx(W, H, lat, lon); const X = x => ((x % W) + W) % W, Y = y => Math.min(H - 1, Math.max(0, y));
  const g = (x, y) => a[(Y(y) * W + X(x)) * 4 + ch]; return (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty; }
function sampleF(a, W, H, lat, lon) { const [x0, y0, tx, ty] = uvIdx(W, H, lat, lon); const X = x => ((x % W) + W) % W, Y = y => Math.min(H - 1, Math.max(0, y));
  const g = (x, y) => a[Y(y) * W + X(x)]; return (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty; }

// world map for the 'Start anywhere' picker: sea, land shaded by relief, airport dots, optional marker
export function drawWorldMap(cvs, o = {}) {
  const Pl = buildPlanet(), w = cvs.width, h = cvs.height, x = cvs.getContext('2d');
  const sea = x.createLinearGradient(0, 0, 0, h); sea.addColorStop(0, '#0a1a2e'); sea.addColorStop(0.5, '#0d2742'); sea.addColorStop(1, '#0a1a2e'); x.fillStyle = sea; x.fillRect(0, 0, w, h);
  if (!drawWorldMap._img) { const im = new ImageData(PW / 2, PH / 2), d = im.data, t = Pl.data;
    for (let y = 0; y < PH / 2; y++) for (let X = 0; X < PW / 2; X++) { const i = ((y * 2) * PW + X * 2) * 4, o4 = (y * PW / 2 + X) * 4; const L = 1 - t[i] / 255, m = t[i + 2] / 255;
      const a = smooth(0.35, 0.65, L); d[o4] = 46 + m * 120; d[o4 + 1] = 74 + m * 70; d[o4 + 2] = 52 + m * 60; d[o4 + 3] = Math.round(a * 255); }
    const c2 = document.createElement('canvas'); c2.width = PW / 2; c2.height = PH / 2; c2.getContext('2d').putImageData(im, 0, 0); drawWorldMap._img = c2; }
  x.imageSmoothingEnabled = true; x.drawImage(drawWorldMap._img, 0, 0, w, h);
  x.strokeStyle = 'rgba(255,255,255,0.06)'; x.lineWidth = 1; for (let lo = -150; lo <= 150; lo += 30) { const X = (lo + 180) / 360 * w; x.beginPath(); x.moveTo(X, 0); x.lineTo(X, h); x.stroke(); } for (let la = -60; la <= 60; la += 30) { const Y = (90 - la) / 180 * h; x.beginPath(); x.moveTo(0, Y); x.lineTo(w, Y); x.stroke(); }
  for (const a of World.airports) { const X = (a.lon + 180) / 360 * w, Y = (90 - a.lat) / 180 * h; x.fillStyle = a.large ? 'rgba(255,196,120,0.95)' : 'rgba(255,230,190,0.5)'; x.fillRect(X - (a.large ? 1 : 0.5), Y - (a.large ? 1 : 0.5), a.large ? 2 : 1, a.large ? 2 : 1); }
  if (o.mark) { const X = (o.mark.lon + 180) / 360 * w, Y = (90 - o.mark.lat) / 180 * h; x.strokeStyle = '#ff8a3d'; x.lineWidth = 2; x.beginPath(); x.arc(X, Y, 7, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.moveTo(X - 12, Y); x.lineTo(X - 4, Y); x.moveTo(X + 4, Y); x.lineTo(X + 12, Y); x.moveTo(X, Y - 12); x.lineTo(X, Y - 4); x.moveTo(X, Y + 4); x.lineTo(X, Y + 12); x.stroke();
    if (o.hdg != null) { const a = o.hdg * D2R; x.beginPath(); x.moveTo(X, Y); x.lineTo(X + Math.sin(a) * 22, Y - Math.cos(a) * 22); x.stroke(); } }
}
