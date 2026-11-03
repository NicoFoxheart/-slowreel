// Terminal hall interior (environment artist): the full passenger flow in one merged, baked-light mesh plus a few
// instanced/transparent extras. Departures: check-in hall (islands with bag-drop belts + scales, backlit signs, kiosks,
// queue stanchions with belt barriers, FIDS) -> security checkpoint (lanes with divest tables, roller conveyors, X-ray
// tunnels with lead curtains, trays, walk-through metal detectors, body scanners, staff) -> passport control booths
// (large airports) -> airside shopping street (duty free, local shops, cafés with seating, washrooms) -> gate lounge
// (linked seating, charging pillars, gate desk + screens, glass wall onto the apron). Arrivals: immigration ->
// baggage claim carousels -> customs exit. Perforated metal ceiling with linear lights, side mezzanines with glass
// balustrades, wayfinding signs, and a polished stone floor that reflects every light, sign and screen (mirrored
// emissive geometry under a slightly transparent floor). Hall frame: x along the façade, y up (floor F), z inward.
import * as THREE from 'three';
import { atmos } from './sky.js';
import { foxHeart } from './aircraft.js';
import { People } from './people.js';
import { ACCENTS } from './interiors.js';

const AT = 2048, R = {};
const reg = (n, x, y, w, h) => { R[n] = [x, y, w, h]; };
['stone', 'carpet', 'wood', 'white', 'metal', 'fabric', 'leaf', 'trunk'].forEach((n, i) => reg(n, i * 256, 0, 256, 256));
['glassD', 'counter', 'rubber', 'perf', 'leather', 'steel', 'navy', 'accent'].forEach((n, i) => reg(n, i * 256, 256, 256, 256));
reg('signDep', 0, 512, 1024, 128); reg('signGate', 1024, 512, 512, 128); reg('signSec', 1536, 512, 512, 128);
['shop0', 'shop1', 'shop2', 'shop3'].forEach((n, i) => reg(n, i * 512, 640, 512, 256));
reg('signHello', 0, 896, 1024, 128); reg('signArr', 1024, 896, 512, 128); reg('signBag', 1536, 896, 512, 128);
reg('lattice', 0, 1024, 256, 256); reg('light', 256, 1024, 256, 256); reg('xray', 512, 1024, 256, 256); reg('kiosk', 768, 1024, 128, 256); reg('charge', 896, 1024, 128, 256);
reg('wc', 1024, 1024, 256, 256); reg('logo', 1280, 1024, 256, 256); reg('gateDesk', 1536, 1024, 512, 128); reg('belt', 1536, 1152, 256, 128); reg('scale', 1792, 1152, 256, 128);
['wayG', 'wayS', 'wayP', 'wayWC'].forEach((n, i) => reg(n, i * 512, 1280, 512, 128)); ['wayB', 'wayX', 'passport', 'menu'].forEach((n, i) => reg(n, i * 512, 1408, 512, 128));
['shop4', 'shop5', 'shop6', 'shop7'].forEach((n, i) => reg(n, i * 512, 1536, 512, 256)); ['scan', 'wtmd'].forEach((n, i) => reg(n, i * 256, 1792, 256, 256)); reg('poster0', 512, 1792, 512, 256); reg('poster1', 1024, 1792, 512, 256); reg('tray', 1536, 1792, 256, 256); reg('mirror', 1792, 1792, 256, 256);
const WORDS = { es: ['Salidas · Departures', 'Puerta', 'Llegadas · Arrivals', 'Control de seguridad · Security', 'Reclamo de equipaje · Baggage'], ko: ['출발 Departures', '탑승구 Gate', '도착 Arrivals', '보안검색 Security', '수하물 Baggage'], ja: ['出発 Departures', '搭乗口 Gate', '到着 Arrivals', '保安検査 Security', '手荷物 Baggage'], ar: ['المغادرة · Departures', 'Gate', 'الوصول · Arrivals', 'Security', 'Baggage'] };
const EN = ['Departures', 'Gate', 'Arrivals', 'Security', 'Baggage claim'];

function buildAtlas(icao, gate, dest) {
  const A = ACCENTS[icao] || { name: '', accent: '#e8732f', accent2: '#2b6fd6', wood: '#c4a07a', floor: '#e6e3dd', plant: 'tree', hello: 'Welcome', local: ['Café', 'Books'] };
  const cv = document.createElement('canvas'); cv.width = cv.height = AT; const c = cv.getContext('2d');
  const tile = (n, f) => { const [x, y, w, h] = R[n]; c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.translate(x, y); f(c, w, h); c.restore(); };
  const noise = (w, h, n, a, col) => { for (let i = 0; i < n; i++) { c.fillStyle = col(Math.random()); c.globalAlpha = a; c.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5); } c.globalAlpha = 1; };
  const F = (s, w = 600) => `${w} ${s}px "Saira Condensed", "Noto Sans KR", "Noto Sans JP", "Arial Narrow", sans-serif`;
  const txt = (s, x, y, size, col, al = 'left', w = 600) => { c.fillStyle = col; c.font = F(size, w); c.textAlign = al; c.textBaseline = 'middle'; c.fillText(s, x, y); };
  const arrow = (x, y, s, dir, col) => { c.save(); c.translate(x, y); c.rotate(dir); c.fillStyle = col; c.beginPath(); c.moveTo(s, 0); c.lineTo(0, -s * 0.8); c.lineTo(0, -s * 0.3); c.lineTo(-s, -s * 0.3); c.lineTo(-s, s * 0.3); c.lineTo(0, s * 0.3); c.lineTo(0, s * 0.8); c.fill(); c.restore(); };
  const man = (x, y, s, col, skirt) => { c.fillStyle = col; c.beginPath(); c.arc(x, y - s * 0.75, s * 0.16, 0, 7); c.fill(); if (skirt) { c.beginPath(); c.moveTo(x - s * 0.3, y + s * 0.25); c.lineTo(x + s * 0.3, y + s * 0.25); c.lineTo(x + s * 0.14, y - s * 0.52); c.lineTo(x - s * 0.14, y - s * 0.52); c.fill(); } else c.fillRect(x - s * 0.2, y - s * 0.52, s * 0.4, s * 0.62); c.fillRect(x - s * 0.17, y + 0.1 * s, s * 0.13, s * 0.55); c.fillRect(x + s * 0.04, y + 0.1 * s, s * 0.13, s * 0.55); };
  const W = WORDS[A.lang] || EN;
  tile('stone', (c, w, h) => { c.fillStyle = A.floor; c.fillRect(0, 0, w, h); noise(w, h, 2600, 0.22, r => r < 0.35 ? '#9a948a' : r < 0.7 ? '#ffffff' : r < 0.85 ? '#6f6a62' : A.accent); for (let i = 0; i < 9; i++) { c.strokeStyle = 'rgba(140,130,118,.12)'; c.lineWidth = 1 + Math.random() * 2; c.beginPath(); c.moveTo(Math.random() * w, 0); c.bezierCurveTo(Math.random() * w, h * 0.3, Math.random() * w, h * 0.6, Math.random() * w, h); c.stroke(); } c.strokeStyle = 'rgba(90,82,74,.45)'; c.lineWidth = 2; c.strokeRect(0, 0, w, h); });
  tile('carpet', (c, w, h) => { c.fillStyle = '#39414e'; c.fillRect(0, 0, w, h); c.strokeStyle = A.accent; c.globalAlpha = 0.28; c.lineWidth = 3; for (let i = -w; i < w * 2; i += 32) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h, h); c.stroke(); } c.globalAlpha = 1; noise(w, h, 3000, 0.18, () => '#000'); });
  tile('wood', (c, w, h) => { c.fillStyle = A.wood; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 3) { c.fillStyle = `rgba(90,60,30,${0.04 + Math.random() * 0.1})`; c.fillRect(0, y, w, 1.5); } c.fillStyle = 'rgba(60,40,20,.3)'; for (let y = 0; y < h; y += 64) c.fillRect(0, y, w, 2); });
  tile('white', (c, w, h) => { c.fillStyle = '#f1f0ec'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(0,0,0,.07)'; c.fillRect(0, 0, w, 2); c.fillRect(0, 0, 2, h); });
  tile('metal', (c, w, h) => { const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#d0d4d9'); g.addColorStop(1, '#9aa1aa'); c.fillStyle = g; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 2) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`; c.fillRect(0, y, w, 1); } });
  tile('fabric', (c, w, h) => { c.fillStyle = A.accent2; c.fillRect(0, 0, w, h); noise(w, h, 3000, 0.22, r => r < 0.5 ? '#000' : '#fff'); c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, h - 10, w, 10); });
  tile('leaf', (c, w, h) => { c.fillStyle = '#2f6b34'; c.fillRect(0, 0, w, h); for (let i = 0; i < 70; i++) { c.fillStyle = ['#3f8a3f', '#245a2a', '#4e9a48'][i % 3]; c.beginPath(); c.ellipse(Math.random() * w, Math.random() * h, 30, 8, Math.random() * 3, 0, 7); c.fill(); } });
  tile('trunk', (c, w, h) => { c.fillStyle = '#7b5d3f'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 14) { c.fillStyle = 'rgba(40,25,10,.4)'; c.fillRect(0, y, w, 4); } });
  tile('glassD', (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#3a4a58'); g.addColorStop(1, '#1a232c'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.moveTo(0, h * 0.2); c.lineTo(w * 0.4, 0); c.lineTo(w * 0.55, 0); c.lineTo(0, h * 0.35); c.fill(); });
  tile('counter', (c, w, h) => { c.fillStyle = '#20283a'; c.fillRect(0, 0, w, h); c.fillStyle = A.accent; c.fillRect(0, h * 0.62, w, 10); foxHeart(c, w / 2, h * 0.32, 44); txt('NICOFOXHEART AIR', w / 2, h * 0.86, 22, '#fff', 'center', 700); });
  tile('rubber', (c, w, h) => { c.fillStyle = '#3b3e44'; c.fillRect(0, 0, w, h); c.fillStyle = '#2c2f34'; for (let x = 0; x < w; x += 16) c.fillRect(x, 0, 6, h); });
  tile('perf', (c, w, h) => { c.fillStyle = '#e3e5e6'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(70,75,80,.35)'; for (let y = 4; y < h; y += 8) for (let x = (y / 8 % 2) * 4 + 4; x < w; x += 8) c.fillRect(x, y, 2, 2); c.fillStyle = 'rgba(60,64,70,.55)'; c.fillRect(0, 0, w, 3); c.fillRect(0, 0, 3, h); });
  tile('leather', (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2d3238'); g.addColorStop(1, '#1d2125'); c.fillStyle = g; c.fillRect(0, 0, w, h); noise(w, h, 1500, 0.12, () => '#fff'); });
  tile('steel', (c, w, h) => { c.fillStyle = '#7d848c'; c.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 2) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.07})`; c.fillRect(x, 0, 1, h); } });
  tile('navy', (c, w, h) => { c.fillStyle = '#1b2747'; c.fillRect(0, 0, w, h); });
  tile('accent', (c, w, h) => { c.fillStyle = A.accent; c.fillRect(0, 0, w, h); });
  const sign = (n, text, bg, fg, icon) => tile(n, (c, w, h) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); txt(text, h * (icon ? 1.15 : 0.4), h / 2 + 2, Math.round(h * 0.42), fg); if (icon) icon(c, w, h); });
  const plane = (c, w, h) => { c.fillStyle = '#ffd34d'; c.save(); c.translate(h * 0.55, h / 2); c.rotate(-0.6); c.fillRect(-h * 0.3, -h * 0.05, h * 0.6, h * 0.1); c.fillRect(-h * 0.08, -h * 0.28, h * 0.14, h * 0.56); c.fillRect(-h * 0.3, -h * 0.13, h * 0.08, h * 0.26); c.restore(); };
  sign('signDep', W[0], '#151b26', '#ffd34d', plane); sign('signGate', `${W[1]} ${gate}  ·  ${dest}`, '#151b26', '#ffffff'); sign('signSec', W[3], '#151b26', '#ffd34d', (c, w, h) => arrow(h * 0.55, h / 2, h * 0.3, -Math.PI / 2, '#ffd34d'));
  sign('signHello', A.hello, A.accent, '#ffffff'); sign('signArr', W[2], '#151b26', '#ffd34d', plane); sign('signBag', W[4], '#151b26', '#ffd34d', (c, w, h) => { c.fillStyle = '#ffd34d'; c.fillRect(h * 0.32, h * 0.38, h * 0.46, h * 0.36); c.fillRect(h * 0.45, h * 0.28, h * 0.2, h * 0.1); });
  const way = (n, text, ar, icon) => tile(n, (c, w, h) => { c.fillStyle = '#20262e'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffd34d'; c.fillRect(0, 0, w, 6); if (icon) icon(c, w, h); txt(text, 120, h / 2 + 3, 46, '#f3f4f5'); if (ar != null) arrow(w - 52, h / 2, 28, ar, '#ffd34d'); });
  way('wayG', `${W[1]}s 1–30`, 0, plane); way('wayS', W[3], -Math.PI / 2, (c, w, h) => arrow(56, h / 2, 26, -Math.PI / 2, '#ffd34d')); way('wayP', 'Passport control', -Math.PI / 2, (c, w, h) => { c.fillStyle = '#ffd34d'; c.fillRect(34, 34, 46, 60); c.fillStyle = '#20262e'; c.beginPath(); c.arc(57, 58, 12, 0, 7); c.fill(); });
  way('wayWC', 'Toilets', null, (c, w, h) => { man(50, 72, 64, '#f3f4f5'); man(88, 72, 64, '#f3f4f5', true); }); way('wayB', W[4], -Math.PI / 2, (c, w, h) => { c.fillStyle = '#ffd34d'; c.fillRect(30, 46, 56, 44); c.fillRect(46, 34, 24, 12); }); way('wayX', 'Exit · Nothing to declare', -Math.PI / 2, (c, w, h) => { c.fillStyle = '#3cb371'; c.fillRect(30, 30, 64, 68); });
  tile('passport', (c, w, h) => { c.fillStyle = '#1d3557'; c.fillRect(0, 0, w, h); txt('ALL PASSPORTS', w / 2, h * 0.4, 48, '#fff', 'center', 700); txt('Have your boarding pass ready', w / 2, h * 0.78, 26, '#cfd8e3', 'center'); });
  tile('menu', (c, w, h) => { c.fillStyle = '#1c1a17'; c.fillRect(0, 0, w, h); txt(A.local[0], 16, 26, 30, '#f3d9a4', 'left', 700); ['Espresso  2.90', 'Flat white  3.80', 'Croissant  2.50', 'Sandwich  6.90'].forEach((s, i) => txt(s, 16 + (i % 2) * 250, 66 + Math.floor(i / 2) * 36, 24, '#efe7da')); });
  const shop = (n, name, col, kind) => tile(n, (c, w, h) => { c.fillStyle = '#2a2420'; c.fillRect(0, 0, w, h); c.fillStyle = col; c.fillRect(0, 0, w, 70); txt(name, w / 2, 37, 40, '#fff', 'center', 700);
    const g = c.createLinearGradient(0, 70, 0, h); g.addColorStop(0, kind === 'cafe' ? '#f2dcc0' : '#f6efe2'); g.addColorStop(1, kind === 'cafe' ? '#a8784f' : '#cbb79a'); c.fillStyle = g; c.fillRect(12, 80, w - 24, h - 90);
    if (kind === 'cafe') { c.fillStyle = '#3b2a1e'; c.fillRect(30, 170, w - 60, 70); for (let i = 0; i < 6; i++) { c.fillStyle = ['#e8d3b0', '#8a5a3b', '#f4f1ea'][i % 3]; c.fillRect(50 + i * 70, 120, 40, 36); } }
    else for (let i = 0; i < 27; i++) { c.fillStyle = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ecf0f1', '#2c3e50'][(i * 5) % 7]; c.fillRect(26 + (i % 9) * 52, 92 + Math.floor(i / 9) * 52, 36, 42); } });
  shop('shop0', A.local[0], A.accent, 'cafe'); shop('shop1', 'Duty Free', '#1b2747'); shop('shop2', A.local[1], A.accent2); shop('shop3', 'Fox & Friends', '#e8732f');
  shop('shop4', 'News & Books', '#2f5d50'); shop('shop5', 'Fragrance & Beauty', '#7a3b69'); shop('shop6', 'Kitchen & Bar', '#6b4b2a', 'cafe'); shop('shop7', 'Tech & Travel', '#2b2f36');
  tile('lattice', (c, w, h) => { c.fillStyle = A.wood; c.fillRect(0, 0, w, h); c.fillStyle = '#3a2a1c'; for (let i = 0; i < w; i += 32) { c.fillRect(i + 13, 0, 6, h); c.fillRect(0, i + 13, w, 6); } });
  tile('light', (c, w, h) => { c.fillStyle = '#fffaf0'; c.fillRect(0, 0, w, h); });
  tile('xray', (c, w, h) => { c.fillStyle = '#c9ced3'; c.fillRect(0, 0, w, h); c.fillStyle = '#2b3036'; c.fillRect(w * 0.22, h * 0.35, w * 0.56, h * 0.55); for (let x = w * 0.24; x < w * 0.76; x += 10) { c.fillStyle = 'rgba(70,80,90,.9)'; c.fillRect(x, h * 0.36, 7, h * 0.53); } c.fillStyle = '#ffd34d'; c.fillRect(0, h * 0.9, w, h * 0.1); txt('X-RAY', w / 2, h * 0.18, 30, '#3a4048', 'center', 700); });
  tile('kiosk', (c, w, h) => { c.fillStyle = '#e9ecef'; c.fillRect(0, 0, w, h); c.fillStyle = '#0f2a4a'; c.fillRect(10, 18, w - 20, h * 0.45); c.fillStyle = A.accent; c.fillRect(18, 30, w - 36, 22); c.fillStyle = '#fff'; for (let i = 0; i < 3; i++) c.fillRect(22, 66 + i * 18, w - 44, 10); c.fillStyle = '#20262e'; c.fillRect(24, h * 0.7, w - 48, 8); });
  tile('charge', (c, w, h) => { c.fillStyle = '#2b3138'; c.fillRect(0, 0, w, h); c.fillStyle = A.accent; c.fillRect(0, 0, w, 12); c.fillStyle = '#ffd34d'; c.beginPath(); c.moveTo(70, 40); c.lineTo(50, 82); c.lineTo(66, 82); c.lineTo(56, 118); c.lineTo(82, 70); c.lineTo(66, 70); c.fill(); for (let i = 0; i < 4; i++) { c.fillStyle = '#0d0f12'; c.fillRect(30 + (i % 2) * 40, 150 + Math.floor(i / 2) * 36, 28, 20); } });
  tile('wc', (c, w, h) => { c.fillStyle = '#20262e'; c.fillRect(0, 0, w, h); man(86, 150, 110, '#f3f4f5'); man(170, 150, 110, '#f3f4f5', true); c.fillStyle = '#ffd34d'; c.fillRect(0, h - 14, w, 14); });
  tile('logo', (c, w, h) => { c.fillStyle = '#1b2747'; c.fillRect(0, 0, w, h); foxHeart(c, w / 2, h / 2, 90); });
  tile('gateDesk', (c, w, h) => { c.fillStyle = '#0d1420'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffd34d'; c.font = '700 44px "B612 Mono", monospace'; c.textBaseline = 'middle'; c.fillText(`${gate}`, 18, 40); txt(`NF 412  ${dest}`, 130, 40, 34, '#fff'); txt('BOARDING', 130, 92, 34, '#55e08f'); });
  tile('belt', (c, w, h) => { c.fillStyle = '#222'; c.fillRect(0, 0, w, h); c.fillStyle = '#333'; for (let x = 0; x < w; x += 20) c.fillRect(x, 0, 10, h); });
  tile('scale', (c, w, h) => { c.fillStyle = '#2b3036'; c.fillRect(0, 0, w, h); c.fillStyle = '#0b0f0b'; c.fillRect(20, 30, w - 40, 56); c.fillStyle = '#7dff7a'; c.font = '700 40px "B612 Mono", monospace'; c.textBaseline = 'middle'; c.fillText('18.4 kg', 34, 60); });
  tile('scan', (c, w, h) => { c.fillStyle = '#d9dee3'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(80,140,200,.45)'; c.fillRect(30, 20, w - 60, h - 40); c.fillStyle = '#4b5563'; c.fillRect(0, 0, w, 14); c.fillRect(0, h - 14, w, 14); });
  tile('wtmd', (c, w, h) => { c.fillStyle = '#b8bec5'; c.fillRect(0, 0, w, h); c.fillStyle = '#20262e'; c.fillRect(w * 0.3, 10, w * 0.4, 30); c.fillStyle = '#55e08f'; c.fillRect(w * 0.35, 18, w * 0.12, 14); c.fillStyle = '#e74c3c'; c.fillRect(w * 0.53, 18, w * 0.12, 14); });
  const poster = (n, t1, t2, c1, c2) => tile(n, (c, w, h) => { const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, c1); g.addColorStop(1, c2); c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(255,255,255,.18)'; c.beginPath(); c.arc(w * 0.78, h * 0.35, 70, 0, 7); c.fill(); txt(t1, 26, h * 0.62, 54, '#fff', 'left', 700); txt(t2, 28, h * 0.82, 24, 'rgba(255,255,255,.85)'); });
  poster('poster0', 'Discover ' + (A.name || 'the city'), 'Explore more with Nicofoxheart Air', A.accent, '#1b2747'); poster('poster1', 'Fly further', 'New routes every season', '#e8732f', '#6b2c1a');
  tile('tray', (c, w, h) => { c.fillStyle = '#3b4148'; c.fillRect(0, 0, w, h); c.fillStyle = '#2a2f35'; c.fillRect(20, 20, w - 40, h - 40); });
  tile('mirror', (c, w, h) => { c.fillStyle = '#9fb0bd'; c.fillRect(0, 0, w, h); });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, accent: A };
}
function atlasMat(tex, o = {}) {
  const m = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, ...o });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aTile; varying vec4 vTile;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvTile = aTile;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vTile;').replace('#include <map_fragment>', 'vec2 tuv = vTile.xy + clamp(fract(vMapUv), 0.004, 0.996) * vTile.zw; vec4 sampledDiffuseColor = texture2D(map, tuv); diffuseColor *= sampledDiffuseColor;');
  };
  m.userData.key = 'hallAtlas' + (o.transparent ? 'T' : ''); return atmos(m);
}
class Builder {
  constructor(light) { this.P = []; this.N = []; this.U = []; this.C = []; this.T = []; this.I = []; this.light = light; }
  tileOf(n) { const [x, y, w, h] = R[n]; const p = 3; return [(x + p) / AT, 1 - (y + h - p) / AT, (w - 2 * p) / AT, (h - 2 * p) / AT]; }
  quad(a, b, c, d, n, tile, u0, v0, u1, v1, tint = [1, 1, 1], emissive = 0) {
    const base = this.P.length / 3; const T = this.tileOf(tile);
    for (const [p, uv] of [[a, [u0, v0]], [b, [u1, v0]], [c, [u1, v1]], [d, [u0, v1]]]) { this.P.push(p.x, p.y, p.z); this.N.push(n.x, n.y, n.z); this.U.push(uv[0], uv[1]); this.T.push(...T); const L = emissive ? emissive : this.light(p, n); const c3 = Array.isArray(L) ? L : [L, L, L]; this.C.push(c3[0] * tint[0], c3[1] * tint[1], c3[2] * tint[2]); }
    this.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  box(cx, cy, cz, sx, sy, sz, tile, o = {}) {
    const ry = o.ry || 0, cs = Math.cos(ry), sn = Math.sin(ry), rep = o.rep ?? 0, tint = o.tint || [1, 1, 1];
    const V = (x, y, z) => new THREE.Vector3(cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs), Nr = (x, y, z) => new THREE.Vector3(x * cs + z * sn, y, -x * sn + z * cs);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2, faces = o.faces || 'pxnxpynypznz', uv = (w, h) => rep ? [w / rep, h / rep] : [1, 1];
    const t = f => (o.tiles && o.tiles[f]) || tile, em = f => (o.emit && o.emit[f]) || 0;
    if (faces.includes('pz')) { const [a, b] = uv(sx, sy); this.quad(V(-hx, -hy, hz), V(hx, -hy, hz), V(hx, hy, hz), V(-hx, hy, hz), Nr(0, 0, 1), t('pz'), 0, 0, a, b, tint, em('pz')); }
    if (faces.includes('nz')) { const [a, b] = uv(sx, sy); this.quad(V(hx, -hy, -hz), V(-hx, -hy, -hz), V(-hx, hy, -hz), V(hx, hy, -hz), Nr(0, 0, -1), t('nz'), 0, 0, a, b, tint, em('nz')); }
    if (faces.includes('px')) { const [a, b] = uv(sz, sy); this.quad(V(hx, -hy, hz), V(hx, -hy, -hz), V(hx, hy, -hz), V(hx, hy, hz), Nr(1, 0, 0), t('px'), 0, 0, a, b, tint, em('px')); }
    if (faces.includes('nx')) { const [a, b] = uv(sz, sy); this.quad(V(-hx, -hy, -hz), V(-hx, -hy, hz), V(-hx, hy, hz), V(-hx, hy, -hz), Nr(-1, 0, 0), t('nx'), 0, 0, a, b, tint, em('nx')); }
    if (faces.includes('py')) { const [a, b] = uv(sx, sz); this.quad(V(-hx, hy, hz), V(hx, hy, hz), V(hx, hy, -hz), V(-hx, hy, -hz), Nr(0, 1, 0), t('py'), 0, 0, a, b, tint, em('py')); }
    if (faces.includes('ny')) { const [a, b] = uv(sx, sz); this.quad(V(-hx, -hy, -hz), V(hx, -hy, -hz), V(hx, -hy, hz), V(-hx, -hy, hz), Nr(0, -1, 0), t('ny'), 0, 0, a, b, tint, em('ny')); }
  }
  geometry() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3)); g.setAttribute('aTile', new THREE.Float32BufferAttribute(this.T, 4)); g.setIndex(this.I); g.computeBoundingSphere(); return g; }
}
class Walk { // same data shape as interiors.js WalkMap (onfoot merges zones + blocks)
  constructor() { this.zones = []; this.blocks = []; }
  rect(c, u, hl, hw, y0, y1 = y0, tag = '') { this.zones.push({ c: c.clone(), u: u.clone().setY(0).normalize(), hl, hw, y0, y1, tag }); }
  block(c, u, hl, hw) { this.blocks.push({ c: c.clone(), u: u.clone().setY(0).normalize(), hl, hw }); }
}
function fidsCanvas(o, title) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 320; const c = cv.getContext('2d');
  c.fillStyle = '#081019'; c.fillRect(0, 0, 1024, 320); c.fillStyle = '#12304f'; c.fillRect(0, 0, 1024, 52); c.fillStyle = '#ffd34d'; c.font = '700 30px "B612 Mono", monospace'; c.textBaseline = 'middle'; c.fillText(title, 20, 27);
  c.fillStyle = '#e8edf5'; c.font = '22px "B612 Mono", monospace'; c.fillText(new Date().toUTCString().slice(17, 22) + ' UTC', 860, 27);
  c.fillStyle = '#8e9bb1'; c.font = '18px "B612 Mono", monospace'; c.fillText('TIME   FLIGHT   ' + (o.mode === 'dep' ? 'DESTINATION' : 'FROM') + '              GATE   STATUS', 20, 74);
  const rows = o.board || []; c.font = '23px "B612 Mono", monospace';
  rows.slice(0, 7).forEach((r, i) => { const y = 108 + i * 30; c.fillStyle = i % 2 ? '#0e1724' : '#0b131e'; c.fillRect(10, y - 21, 1004, 28); c.fillStyle = '#e8edf5'; c.fillText(r.time, 20, y); c.fillText(r.flight, 110, y); c.fillText(r.city.slice(0, 22), 236, y); c.fillText(String(r.gate), 610, y); c.fillStyle = r.status === 'BOARDING' ? '#55e08f' : r.status === 'DELAYED' ? '#ff5d5d' : r.status === 'LANDED' ? '#66d7ea' : '#ffd34d'; c.fillText(r.status, 700, y); });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// opts: { icao, mode: 'dep'|'arr', gate, dest, O (world façade point, y = apron), n (unit toward the apron), depth, doorX, board }
export function buildHall(opts, rnd) {
  const { icao, mode, gate, dest } = opts, dep = mode === 'dep';
  const at = buildAtlas(icao, gate, dest), A = at.accent; const mat = atlasMat(at.tex), floorMat = atlasMat(at.tex, { transparent: true, opacity: 0.86, depthWrite: true });
  const F = 4.6, D = Math.max(46, opts.depth - 4), HW = 44, HC = 11, big = D >= 60, dx = opts.doorX;
  const zAxis = new THREE.Vector3(-opts.n.x, 0, -opts.n.z).normalize(), xAxis = new THREE.Vector3(0, 1, 0).cross(zAxis);
  const O = opts.O.clone(); const W = (x, y, z) => new THREE.Vector3(O.x + xAxis.x * x + zAxis.x * z, O.y + y, O.z + xAxis.z * x + zAxis.z * z);
  const group = new THREE.Group(); group.position.copy(O); group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, new THREE.Vector3(0, 1, 0), zAxis));
  // baked light: daylight from the glass wall, skylights down the middle, ceiling line lights, darker corners and under counters
  const light = (p, n) => { const winK = Math.exp(-Math.max(0, p.z) / 15), up = Math.max(0, n.y) * 0.14, low = Math.abs(n.y) < 0.5 ? -0.14 * Math.exp(-(p.y - F) / 0.7) : 0, down = Math.max(0, -n.y) * -0.08, corner = -0.08 * Math.exp(-(HW - Math.abs(p.x)) / 3) - 0.06 * Math.exp(-(D - p.z) / 3), sky = 0.05 * Math.exp(-p.x * p.x / 300);
    const L = 0.74 + winK * 0.3 + up + low + down + corner + sky; return [L * (1.04 - 0.08 * winK), L, L * (0.93 + 0.11 * winK)]; };
  const B = new Builder(light), BF = new Builder(light), BM = new Builder(() => 1); // main, polished floor, mirrored brights
  const wm = new Walk(); const wc = (x, z) => W(x, 0, z); const blk = (x, z, hx, hz) => wm.block(wc(x, z), xAxis, hx, hz);
  const glow = (cx, cy, cz, sx, sy, sz, tile, o) => { B.box(cx, cy, cz, sx, sy, sz, tile, o); const sw = s => s && s.replace(/py|ny/g, m => m === 'py' ? 'ny' : 'py'); const swap = obj => obj && Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === 'py' ? 'ny' : k === 'ny' ? 'py' : k, v]));
    const emit = swap(o.emit), k = o.mirrorK ?? 1.6; BM.box(cx, 2 * F - cy, cz, sx, sy, sz, tile, { ...o, faces: sw(o.faces), tiles: swap(o.tiles), emit: emit && Object.fromEntries(Object.entries(emit).map(([a, v]) => [a, v * k])) }); };
  const sign = (name, x, y, z, w, h, ry = 0, e = 1.25) => glow(x, y, z, w, h, 0.12, 'steel', { ry, tiles: { pz: name }, emit: { pz: e }, faces: 'pznz' });
  const hang = (name, x, y, z, w, h, ry = 0) => { glow(x, y, z, w, h, 0.12, 'steel', { ry, tiles: { pz: name, nz: name }, emit: { pz: 1.25, nz: 1.25 }, faces: 'pznzpyny' }); for (const s of [-1, 1]) B.box(x + Math.cos(ry) * s * w * 0.4, (y + F + HC) / 2 + h / 4, z - Math.sin(ry) * s * w * 0.4, 0.03, F + HC - y - h / 2, 0.03, 'steel'); };
  // ---- floor: polished stone (reflective, separate mesh), carpet at the gate
  BF.box(0, F - 0.15, D / 2, HW * 2, 0.3, D, 'stone', { faces: 'py', rep: 2 });
  B.box(0, F + 0.006, 8, HW * 2 - 2, 0.01, 14, 'carpet', { faces: 'py', rep: 3 });
  // ---- glass wall onto the apron: sill, mullions, transoms
  B.box(0, F + 0.25, 0.1, HW * 2, 0.5, 0.2, 'steel', { faces: 'pxnxpypz' });
  for (let x = -HW; x <= HW; x += 3) if (Math.abs(x - dx) > 2.2) B.box(x, F + HC / 2, 0.05, 0.14, HC, 0.3, 'steel');
  for (const y of [3.3, 7.4]) B.box(0, F + y, 0.05, HW * 2, 0.1, 0.24, 'steel'); B.box(0, F + HC, 0.08, HW * 2, 0.4, 0.4, 'steel');
  // ---- walls, perforated metal ceiling with linear lights, structural columns
  B.box(-HW, F + HC / 2, D / 2, 0.4, HC, D, 'white', { faces: 'px', rep: 3 }); B.box(HW, F + HC / 2, D / 2, 0.4, HC, D, 'white', { faces: 'nx', rep: 3 }); B.box(0, F + HC / 2, D, HW * 2, HC, 0.4, 'white', { faces: 'nz', rep: 3 });
  B.box(0, F + HC + 0.1, D / 2, HW * 2, 0.2, D, 'perf', { faces: 'ny', rep: 1.2 });
  for (let x = -HW + 3; x < HW - 1; x += 4.5) glow(x, F + HC - 0.02, D / 2 + 1, 0.14, 0.05, D - 6, 'light', { faces: 'ny', emit: { ny: 1.9 }, mirrorK: 1.4 });
  for (let z = 6; z < D - 3; z += 12) B.box(0, F + HC - 0.15, z, HW * 2, 0.3, 0.25, 'steel', { faces: 'nypznz' });
  const cols = []; for (const x of [-22, 22]) for (const z of [18, D - 12]) cols.push([x, z]);
  for (const [x, z] of cols) { B.box(x, F + HC / 2, z, 0.7, HC, 0.7, 'white', { faces: 'pxnxpznz' }); blk(x, z, 0.5, 0.5); }
  // ---- side mezzanines with glass balustrades
  const mz0 = 18, mz1 = D - 1, gl = []; for (const s of [-1, 1]) { const x0 = s * (HW - 3.5);
    B.box(x0, F + 5.6, (mz0 + mz1) / 2, 7, 0.45, mz1 - mz0, 'white', { faces: 'pynypxnx', rep: 3 }); B.box(s * (HW - 7.02), F + 5.6, (mz0 + mz1) / 2, 0.06, 0.45, mz1 - mz0, 'steel', { faces: s > 0 ? 'nx' : 'px' });
    for (let z = mz0 + 2; z < mz1; z += 5) glow(x0, F + 5.35, z, 4, 0.04, 0.5, 'light', { faces: 'ny', emit: { ny: 1.5 } });
    B.box(s * (HW - 7.05), F + 6.95, (mz0 + mz1) / 2, 0.08, 0.06, mz1 - mz0, 'steel'); gl.push([s * (HW - 7.05), F + 6.32, (mz0 + mz1) / 2, mz1 - mz0]); }
  // ---- gate lounge: linked seats (instanced), charging pillars, gate desk + screens, gate sign
  if (dep) { glow(dx + 7, F + 2.6, 3.2, 3.6, 0.9, 0.12, 'steel', { tiles: { pz: 'gateDesk' }, emit: { pz: 1.25 }, faces: 'pznz' }); B.box(dx + 7, F + 0.55, 3.5, 3.4, 1.1, 0.9, 'counter', { tiles: { nz: 'counter', py: 'stone' } }); for (const o of [-0.8, 0.8]) glow(dx + 7 + o, F + 1.35, 3.3, 0.5, 0.32, 0.04, 'steel', { tiles: { pz: 'kiosk' }, emit: { pz: 1.1 }, faces: 'pznz' }); hang('signGate', dx, F + 3.9, 1.0, 4.4, 1.1); blk(dx + 7, 3.5, 1.8, 0.6); }
  else hang('signArr', dx, F + 3.9, 1.0, 4.4, 1.1);
  const bb = new Builder(() => 0.95); for (let k = 0; k < 6; k++) { const x = k * 0.62 - 1.55; bb.box(x, 0.45, 0, 0.54, 0.1, 0.52, 'leather'); bb.box(x, 0.8, 0.25, 0.54, 0.6, 0.08, 'leather', { ry: 0 }); if (k < 5) bb.box(x + 0.31, 0.62, 0.02, 0.05, 0.05, 0.45, 'steel'); }
  bb.box(0, 0.36, 0.02, 3.9, 0.06, 0.12, 'steel'); for (const x of [-1.6, 1.6]) { bb.box(x, 0.18, 0.02, 0.06, 0.36, 0.06, 'steel'); bb.box(x, 0.02, 0.02, 0.06, 0.04, 0.5, 'steel'); }
  const benchPos = []; for (const z of [5.5, 8.6, 11.7]) for (const x of [-34, -27, -20, -13, 13, 20, 27, 34]) if (Math.abs(x - dx) > 5 && Math.abs(x - dx - 7) > 3) benchPos.push([x, z]);
  const benches = new THREE.InstancedMesh(bb.geometry(), mat, benchPos.length); const M = new THREE.Matrix4(); benchPos.forEach(([x, z], i) => { M.makeTranslation(x, F, z); benches.setMatrixAt(i, M); blk(x, z, 1.95, 0.45); }); benches.frustumCulled = false; group.add(benches);
  for (const x of [-30.5, -16.5, 16.5, 30.5]) if (Math.abs(x - dx) > 4) { glow(x, F + 0.55, 8.6, 0.42, 1.1, 0.42, 'steel', { tiles: { pz: 'charge', nz: 'charge' }, emit: { pz: 1.05, nz: 1.05 }, faces: 'pznzpxnxpy' }); blk(x, 8.6, 0.3, 0.3); }
  // ---- airside shopping street: shop + café units both sides, washrooms, café seating, wayfinding
  const zS = 23, sDepth = big ? 9 : 6; const units = big ? [['shop0', 'cafe'], ['shop1'], ['shop4'], ['shop2'], ['wc'], ['shop6', 'cafe']] : [['shop0', 'cafe'], ['shop4']];
  let ui = 0;
  for (const s of [-1, 1]) for (let x0 = big ? 5 : 31; x0 + 11 <= HW - 0.5 && ui < units.length; x0 += 11.5) {
    const [nm, kind] = units[ui++], x = s * (x0 + 5.5), zc = zS + sDepth / 2;
    if (nm === 'wc') { B.box(x, F + 2.6, zc, 11, 5.2, sDepth, 'white', { faces: 'nzpy', rep: 3 }); for (const o of [-2.6, 2.6]) B.box(x + o, F + 1.2, zS - 0.01, 1.4, 2.4, 0.02, 'navy', { faces: 'nz' }); sign('wc', x, F + 3.4, zS - 0.08, 1.6, 1.6, Math.PI); blk(x, zc, 5.6, sDepth / 2); continue; }
    glow(x, F + 2.3, zS + 0.12, 10.6, 4.4, 0.05, 'steel', { tiles: { nz: nm }, emit: { nz: 1.12 }, faces: 'nz', mirrorK: 1.3 }); for (const o of [-1, 1]) B.box(x + o * 5.4, F + 2.6, zc, 0.2, 5.2, sDepth, 'white', { faces: 'pxnx' }); B.box(x, F + 4.85, zS + 0.05, 11, 0.7, 0.14, 'steel', { faces: 'pynz' });
    for (const o of [-5.3, 5.3]) B.box(x + o, F + 2, zS, 0.12, 4, 0.12, 'steel'); B.box(x, F + 3.95, zS, 11, 0.08, 0.1, 'steel');
    glow(x, F + 5.12, zc, 10, 0.04, sDepth - 1, 'light', { faces: 'ny', emit: { ny: 1.7 } });
    if (kind === 'cafe') { glow(x + 3.2, F + 1.1, zS - 0.5, 1.4, 1.0, 0.06, 'steel', { tiles: { nz: 'menu', pz: 'menu' }, emit: { nz: 1.15, pz: 1.15 }, faces: 'pznz' }); B.box(x + 3.2, F + 0.3, zS - 0.5, 0.06, 0.6, 0.06, 'steel');
      for (let i = 0; i < 3; i++) { const tx = x - 4 + i * 3.6, tz = zS - 1.4; B.box(tx, F + 0.74, tz, 0.8, 0.05, 0.8, 'wood', { faces: 'pyny' }); B.box(tx, F + 0.37, tz, 0.08, 0.74, 0.08, 'steel'); for (const o of [-0.65, 0.65]) { B.box(tx + o, F + 0.45, tz, 0.42, 0.06, 0.42, 'leather'); B.box(tx + o * 1.3, F + 0.7, tz, 0.06, 0.45, 0.4, 'leather'); } blk(tx, tz, 1.1, 0.5); } }
    blk(x, zc + 0.5, 5.6, sDepth / 2 - 0.5);
  }
  if (big) B.box(0, F + 5.3, zS + sDepth / 2, HW * 2, 0.2, sDepth, 'perf', { faces: 'ny', rep: 1.2 }); // shop soffit
  hang('wayG', 0, F + 3.6, 19, 6, 1.5, 0); hang('wayWC', -18, F + 3.6, 19, 6, 1.5, 0);
  // ---- passport control (large airports), security checkpoint, queue
  const zP = zS + sDepth + 1.6; let z0sec;
  if (big) { for (const x of [-14, -8.6, -3.2, 3.2, 8.6, 14]) { B.box(x, F + 0.6, zP, 2.2, 1.2, 2.4, 'wood', { tiles: { py: 'white' } }); B.box(x, F + 1.5, zP - 0.6, 2.2, 0.6, 0.05, 'mirror', { faces: 'pznz', tint: [0.9, 0.95, 1.0] }); B.box(x, F + 2.3, zP, 2.4, 0.12, 2.6, 'white'); blk(x, zP, 1.15, 1.25); }
    for (const x of [-11.3, -5.9, 5.9, 11.3]) B.box(x, F + 1.0, zP + 1.2, 0.05, 2.0, 2.2, 'glassD', { faces: 'pxnx' }); hang('passport', 0, F + 4.0, zP + 2.6, 5, 1.25, 0); hang('wayP', -26, F + 4.0, zP + 2.6, 6, 1.5, 0);
    z0sec = zP + 2.8; } else z0sec = zS + 0.6;
  const z1sec = Math.min(z0sec + 7, D * 0.68 - 0.6), zm = (z0sec + z1sec) / 2, lanes = [0, -6.5, 6.5, -19.5, 19.5, -26, 26].filter(x => Math.abs(x) < HW - 9);
  if (dep) for (const xc of lanes) {
    const cx = xc + 1.9, L = z1sec - z0sec; B.box(cx, F + 0.42, zm, 0.9, 0.08, L, 'rubber', { rep: 0.6, tiles: { py: 'rubber' } }); for (const o of [-0.47, 0.47]) B.box(cx + o, F + 0.5, zm, 0.06, 0.14, L, 'steel'); for (const z of [z0sec + 0.3, z1sec - 0.3]) for (const o of [-0.4, 0.4]) B.box(cx + o, F + 0.2, z, 0.06, 0.4, 0.06, 'steel');
    B.box(cx, F + 0.95, zm, 1.2, 1.1, 2.2, 'xray', { tiles: { px: 'xray', nx: 'xray', pz: 'metal', nz: 'metal', py: 'metal' } }); for (const z of [zm - 1.12, zm + 1.12]) for (let i = 0; i < 5; i++) B.box(cx - 0.36 + i * 0.18, F + 0.82, z, 0.16, 0.6, 0.01, 'rubber', { faces: 'pznz' });
    glow(cx + 0.9, F + 1.2, zm - 0.3, 0.05, 0.4, 0.6, 'steel', { tiles: { px: 'kiosk' }, emit: { px: 1.1 }, faces: 'px' }); B.box(cx + 0.9, F + 0.5, zm - 0.3, 0.5, 1.0, 0.7, 'metal');
    for (let i = 0; i < 4; i++) B.box(cx, F + 0.5, z0sec + 0.8 + i * (L - 1.6) / 3 + (i > 1 ? 1.2 : -0.2) * 0, 0.6, 0.08, 0.45, 'tray', { faces: 'pypxnxpznz', tiles: { py: 'tray' } });
    for (const o of [-0.48, 0.48]) B.box(xc + o, F + 1.05, zm + 1.5, 0.1, 2.1, 0.5, 'wtmd', { tiles: { pz: 'wtmd', nz: 'wtmd', px: 'metal', nx: 'metal' } }); B.box(xc, F + 2.15, zm + 1.5, 1.06, 0.18, 0.5, 'wtmd', { tiles: { pz: 'wtmd', nz: 'wtmd' } });
    B.box(xc - 1.8, F + 1.15, zm - 0.6, 1.4, 2.3, 1.4, 'scan', { tiles: { px: 'scan', nx: 'scan', pz: 'scan', nz: 'scan', py: 'metal' } }); blk(xc - 1.8, zm - 0.6, 0.75, 0.75);
    B.box(cx, F + 0.42, z1sec + 0.6, 1.4, 0.84, 0.9, 'steel'); blk(cx, zm, 0.6, L / 2 + 0.5);
  }
  if (dep) { hang('signSec', 0, F + 4.4, z1sec + 2.2, 6, 1.4, 0); hang('wayS', 26, F + 4.0, z1sec + 2.2, 6, 1.5, 0); }
  // queue stanchions with belt barriers (visual; you can duck under them)
  const qz = z1sec + 1.4, q1 = dep ? (big ? 3 : 1) : 0; for (let r = 0; r < q1; r++) { const z = qz + r * 1.3; for (let x = -16; x <= 16; x += 2.2) { B.box(x, F + 0.5, z, 0.07, 1.0, 0.07, 'steel'); B.box(x, F + 0.01, z, 0.36, 0.02, 0.36, 'steel', { faces: 'py' }); } for (let x = -16; x < 16; x += 2.2) if (!((r % 2 ? x > 13 : x < -13))) B.box(x + 1.1, F + 0.92, z, 2.1, 0.05, 0.01, 'navy', { faces: 'pznz' }); }
  // ---- check-in (departures) or baggage claim + customs exit (arrivals)
  const ckZ = Math.min(D - 5, Math.max(qz + q1 * 1.3 + 4.5, D * 0.82));
  if (dep) {
    for (const x of [-26, 0, 26]) { B.box(x, F + 1.3, ckZ + 1.2, 10, 2.6, 0.4, 'white'); glow(x, F + 2.2, ckZ + 0.98, 9.6, 1.6, 0.06, 'logo', { tiles: { nz: 'logo' }, emit: { nz: 1.15 }, faces: 'nz' }); glow(x, F + 2.2, ckZ + 1.42, 9.6, 1.6, 0.06, 'logo', { tiles: { pz: 'logo' }, emit: { pz: 1.1 }, faces: 'pz' });
      for (let i = 0; i < 4; i++) { const cx = x - 3.6 + i * 2.4; B.box(cx, F + 0.55, ckZ, 1.5, 1.1, 1.0, 'counter', { tiles: { nz: 'counter', py: 'white' } }); glow(cx, F + 1.32, ckZ - 0.1, 0.42, 0.3, 0.04, 'steel', { tiles: { nz: 'kiosk' }, emit: { nz: 1.05 }, faces: 'nz' }); B.box(cx + 1.0, F + 0.25, ckZ - 0.15, 0.6, 0.5, 1.6, 'rubber', { tiles: { py: 'belt' } }); glow(cx + 1.0, F + 0.62, ckZ - 1.0, 0.36, 0.2, 0.04, 'steel', { tiles: { nz: 'scale' }, emit: { nz: 1.1 }, faces: 'nz' }); }
      blk(x, ckZ, 5.1, 0.8);
      for (let r = 0; r < 2; r++) for (let k = 0; k <= 4; k++) { const sx = x - 4.4 + k * 2.2, sz = ckZ - 2.2 - r * 1.4; B.box(sx, F + 0.5, sz, 0.07, 1.0, 0.07, 'steel'); if (k < 4) B.box(sx + 1.1, F + 0.92, sz, 2.1, 0.05, 0.01, 'navy', { faces: 'pznz' }); } }
    for (const [x, z] of [[-12, ckZ - 5.5], [-9.5, ckZ - 5.5], [18, ckZ - 5.5], [20.5, ckZ - 5.5]]) { B.box(x, F + 0.5, z, 0.5, 1.0, 0.4, 'metal'); glow(x, F + 1.25, z - 0.05, 0.5, 0.7, 0.12, 'steel', { tiles: { nz: 'kiosk' }, emit: { nz: 1.15 }, faces: 'nzpy', ry: 0 }); blk(x, z, 0.3, 0.3); }
    hang('signDep', 0, F + 6.8, D - 0.6, 12, 1.5, Math.PI);
  } else {
    for (const x of [-16, 16]) { const zc = (z0sec + D) / 2 - 2; B.box(x, F + 0.35, zc, 14, 0.7, 4, 'metal'); B.box(x, F + 0.72, zc, 13.4, 0.04, 3.4, 'belt', { faces: 'py', tiles: { py: 'belt' } }); B.box(x, F + 1.3, zc, 1.0, 1.2, 1.2, 'metal'); glow(x, F + 3.8, zc - 2.4, 3.2, 1.0, 0.1, 'steel', { tiles: { nz: 'signBag', pz: 'signBag' }, emit: { nz: 1.2, pz: 1.2 }, faces: 'pznz' }); blk(x, zc, 7.1, 2.1); }
    hang('wayX', 0, F + 4.0, D - 6, 7, 1.75, 0); B.box(0, F + 1.4, D - 0.25, 6, 2.8, 0.1, 'glassD', { faces: 'nz' }); hang('signHello', 0, F + 6.4, D - 0.6, 16, 2.0, Math.PI);
    if (big) hang('wayB', -24, F + 4, z0sec + 2, 6, 1.5, Math.PI);
  }
  // posters (light boxes) on the side walls, planters with the local plants
  for (const [x, z, n] of [[-HW + 0.25, zS - 4, 'poster0'], [HW - 0.25, zS - 4, 'poster1'], [-HW + 0.25, D - 10, 'poster1'], [HW - 0.25, D - 10, 'poster0']]) glow(x, F + 2.2, z, 0.08, 2.0, 4.0, 'steel', { tiles: { px: n, nx: n }, emit: { px: 1.15, nx: 1.15 }, faces: x < 0 ? 'px' : 'nx' });
  const planters = [[-38, 13], [38, 13], [-38, D - 4], [38, D - 4]];
  for (const [x, z] of planters) { B.box(x, F + 0.4, z, 1.6, 0.8, 1.6, 'wood'); blk(x, z, 0.9, 0.9);
    if (A.plant === 'palm') { for (let k = 0; k < 5; k++) B.box(x, F + 1.2 + k * 0.9, z, 0.32 - k * 0.03, 0.9, 0.32 - k * 0.03, 'trunk'); for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; B.box(x + Math.cos(a) * 1.3, F + 5.15, z + Math.sin(a) * 1.3, 2.6, 0.06, 0.6, 'leaf', { ry: -a }); } }
    else if (A.plant === 'tropical') { for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; B.box(x + Math.cos(a) * 0.6, F + 1.5 + (k % 3) * 0.4, z + Math.sin(a) * 0.6, 1.4, 0.05, 0.7, 'leaf', { ry: -a }); } }
    else { B.box(x, F + 1.5, z, 0.2, 1.4, 0.2, 'trunk'); B.box(x, F + 2.8, z, 1.4, 1.8, 1.4, 'leaf'); } }
  if (A.lattice) for (const x of [-34, 34]) B.box(x, F + 2, zS - 3, 6, 4, 0.15, 'lattice', { faces: 'pznz' });
  // ---- meshes: mirror (under the floor), polished floor (transparent), main, glass, FIDS boards, light shafts
  const mirror = new THREE.Mesh(BM.geometry(), mat); mirror.frustumCulled = false; group.add(mirror);
  const floor = new THREE.Mesh(BF.geometry(), floorMat); floor.frustumCulled = false; floor.renderOrder = 1; group.add(floor);
  const mesh = new THREE.Mesh(B.geometry(), mat); mesh.frustumCulled = false; group.add(mesh);
  const glassM = new THREE.MeshBasicMaterial({ color: 0x9ccbe0, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
  const facade = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, HC), glassM); facade.position.set(0, F + HC / 2, 0.04); group.add(facade);
  const balM = new THREE.MeshBasicMaterial({ color: 0xbfe3ee, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  for (const [x, y, z, l] of gl) { const p = new THREE.Mesh(new THREE.PlaneGeometry(l, 1.1), balM); p.position.set(x, y, z); p.rotation.y = Math.PI / 2; group.add(p); }
  const shaftC = document.createElement('canvas'); shaftC.width = 64; shaftC.height = 256; { const c = shaftC.getContext('2d'); const g = c.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, 'rgba(255,240,210,0.9)'); g.addColorStop(1, 'rgba(255,240,210,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 256); const h = c.createLinearGradient(0, 0, 64, 0); h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.25, 'rgba(0,0,0,0)'); h.addColorStop(0.75, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)'); c.globalCompositeOperation = 'destination-out'; c.fillStyle = h; c.fillRect(0, 0, 64, 256); }
  const shaftT = new THREE.CanvasTexture(shaftC); const shaftM = new THREE.MeshBasicMaterial({ map: shaftT, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (let x = -36; x <= 36; x += 9) { const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 15), shaftM); sh.position.set(x + 2, F + 5.2, 5.5); sh.rotation.set(-0.85, 0.15, 0); group.add(sh); }
  const board = fidsCanvas(opts, dep ? 'DEPARTURES' : 'ARRIVALS'); const fm = new THREE.MeshBasicMaterial({ map: board, toneMapped: false });
  const boards = dep ? [[-8, F + 4.2, D - 0.3, Math.PI, 1], [8, F + 4.2, D - 0.3, Math.PI, 1], [-22, F + 3.2, 18 - 0.4, 0, 0.45], [22, F + 3.2, 18 - 0.4, 0, 0.45], [0, F + 3.4, zS - 1.0, 0, 0.5]] : [[0, F + 4.0, z0sec + 3, Math.PI, 0.7], [-22, F + 3.2, 18 - 0.4, 0, 0.45]];
  for (const [x, y, z, ry, s] of boards) { const bm = new THREE.Mesh(new THREE.PlaneGeometry(12 * s, 3.75 * s), fm); bm.position.set(x, y, z); bm.rotation.y = ry; group.add(bm); const rf = bm.clone(); rf.position.y = 2 * F - y; rf.scale.y = -1; rf.material = new THREE.MeshBasicMaterial({ map: board, toneMapped: false, side: THREE.DoubleSide, color: 0x666666 }); group.add(rf); }
  // ---- people: seated at the gate, check-in queues, security staff + passengers, shoppers, walkers
  const NP = 96; const crowd = new People(group, NP, rnd); let k = 0; const walkers = [];
  const ACTS = ['idle', 'phone', 'read', 'talk', 'sleep', 'idle', 'phone'];
  for (const [x, z] of benchPos) for (let sI = 0; sI < 6; sI++) if (rnd() < 0.3 && k < 26) { const p = crowd.p[k++]; Object.assign(p, { x: x + sI * 0.62 - 1.55, y: F, z: z + 0.06, yaw: Math.PI, mode: 'sit', act: ACTS[(rnd() * ACTS.length) | 0], talkSide: rnd() < 0.5 ? 1 : -1, windowSide: 0 }); }
  const staff = (x, z, yaw, mode = 'stand') => { if (k >= NP - 1) return; const i = k++; crowd.setCrew(i); Object.assign(crowd.p[i], { x, y: F, z, yaw, mode, act: 'idle' }); };
  if (dep) for (const xc of lanes) { staff(xc + 2.9, zm - 0.3, -Math.PI / 2); if (rnd() < 0.7 && k < NP - 2) { const p = crowd.p[k++]; Object.assign(p, { x: xc, y: F, z: z1sec + 0.6, yaw: Math.PI, mode: 'stand', act: rnd() < 0.4 ? 'phone' : 'idle', suitcase: false }); } }
  if (big) for (const x of [-8.6, 3.2, 14]) staff(x, zP + 0.4, Math.PI, 'sit');
  if (dep) { for (const x of [-26, 0, 26]) { for (let i = 0; i < 2; i++) staff(x - 3.6 + i * 4.8, ckZ + 0.7, Math.PI); for (let q = 0; q < 4 && k < NP - 22; q++) { const p = crowd.p[k++]; Object.assign(p, { x: x - 2.5 + (q % 2) * 0.3, y: F, z: ckZ - 1.7 - q * 0.85, yaw: 0, mode: 'stand', act: rnd() < 0.3 ? 'phone' : 'idle', suitcase: rnd() < 0.7 }); } }
    for (let q = 0; q < 6 && k < NP - 16; q++) { const p = crowd.p[k++]; Object.assign(p, { x: -12 + q * 2.4 + (q % 2) * 0.5, y: F, z: qz + 0.6 + (q % 3) * 1.3, yaw: Math.PI, mode: 'stand', act: 'idle', suitcase: rnd() < 0.5 }); } }
  else for (const x of [-16, 16]) for (let q = 0; q < 5 && k < NP - 14; q++) { const p = crowd.p[k++]; const a = q / 5 * Math.PI * 2; Object.assign(p, { x: x + Math.cos(a) * 8, y: F, z: (z0sec + D) / 2 - 2 + Math.sin(a) * 3.2, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)), mode: 'stand', act: 'idle' }); }
  for (let i = 0; i < 4 && k < NP - 12; i++) { const p = crowd.p[k++]; Object.assign(p, { x: -6 + i * 4, y: F, z: zS - 1.4, yaw: i % 2 ? Math.PI / 2 : -Math.PI / 2, mode: 'sit', act: ACTS[i % ACTS.length] }); }
  const famPath = [[-30, 19], [30, 19], [30, 16.5], [-30, 16.5]];
  for (let f = 0; f < 3 && k < NP - 2; f++) { const p = crowd.p[k++]; if (f > 0) { p.age = 'kid'; p.scale = 0.58 + rnd() * 0.12; p.backpack = true; crowd.paint(p); } Object.assign(p, { x: famPath[0][0] - f * 0.9, y: F, z: famPath[0][1] + f * 0.6, mode: 'walk', path: famPath, seg: 1, speed: 0.95, family: f, suitcase: f === 0 }); walkers.push(p); }
  while (k < NP - 1) { const p = crowd.p[k]; const side = rnd() < 0.5 ? -1 : 1, path = rnd() < 0.6 ? [[-38 + rnd() * 20, 18 + rnd() * 3], [18 + rnd() * 20, 18 + rnd() * 3]] : [[side * (2 + rnd() * 1.5), 17], [side * (2 + rnd() * 1.5), D - 4], [side * (8 + rnd() * 8), D - 3]]; Object.assign(p, { x: path[0][0], y: F, z: path[0][1], mode: 'walk', path, seg: (rnd() * path.length) | 0, speed: 0.9 + rnd() * 0.5, suitcase: rnd() < 0.45 }); walkers.push(p); k++; }
  { const p = crowd.p[NP - 1]; crowd.setCrew(NP - 1); Object.assign(p, { x: dx + 7, y: F, z: 4.6, yaw: Math.PI, mode: 'stand', act: 'idle' }); if (!dep) p.hidden = true; }
  // ---- walk zone
  wm.rect(wc(0, D / 2), xAxis, HW - 0.6, D / 2 - 0.8, O.y + F, O.y + F, 'hall');
  const update = (dt, t, cam) => {
    for (const p of walkers) { const tg = p.path[p.seg]; const ox = p.family ? -p.family * 0.8 : 0; const dxp = tg[0] + ox - p.x, dzp = tg[1] + (p.family ? p.family * 0.5 : 0) - p.z, d = Math.hypot(dxp, dzp); if (d < 0.5) { p.seg = (p.seg + 1) % p.path.length; continue; } p.x += dxp / d * p.speed * dt; p.z += dzp / d * p.speed * dt; p.yaw = Math.atan2(dxp, dzp); }
    floorMat.color.copy(mat.color); crowd.commit(t, cam ? group.worldToLocal(cam.clone()) : null);
  };
  crowd.commit(0);
  const spawn = dep ? { pos: W(13, F, D * 0.92), yaw: 0 } : { pos: W(dx, F, 2.0), yaw: 0 };
  return { group, walk: wm, update, crowd, mat, shafts: shaftM, spawn, xAxis, zAxis, O, F, D, exitPos: W(0, F, D - 2), world: W, dispose() { group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); at.tex.dispose(); board.dispose(); } };
}
