// World data (OurAirports, public domain) + geodesy helpers.
export const R_EARTH = 6371008.8;
export const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const FT = 0.3048, KT = 0.514444, NM = 1852;

export class Geo {
  constructor(lat0 = 0, lon0 = 0) { this.set(lat0, lon0); }
  set(lat0, lon0) { this.lat0 = lat0; this.lon0 = lon0; this.kx = Math.cos(lat0 * D2R) * R_EARTH * D2R; this.kz = R_EARTH * D2R; }
  // local frame: x = east (m), z = south (m) (three.js: north is -z), y = altitude MSL (m)
  x(lon) { return (((lon - this.lon0 + 540) % 360) - 180) * this.kx; }
  z(lat) { return -(lat - this.lat0) * this.kz; }
  toLatLon(x, z) { return { lat: this.lat0 - z / this.kz, lon: ((this.lon0 + x / this.kx + 540) % 360) - 180 }; }
}

export function haversine(a, b, c, d) {
  const p = (c - a) * D2R, l = (d - b) * D2R;
  const h = Math.sin(p / 2) ** 2 + Math.cos(a * D2R) * Math.cos(c * D2R) * Math.sin(l / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const World = { airports: [], navaids: [], byIcao: new Map(), featured: [], countries: {}, stats: {} };

export async function loadWorld(onProgress) {
  const res = await fetch('data/world.json');
  if (!res.ok) throw new Error('Could not load data/world.json (' + res.status + ')');
  onProgress && onProgress(0.5, 'Parsing 1,544 airports');
  const w = await res.json();
  World.countries = w.countries; World.featured = w.featured;
  let nRw = 0;
  for (const a of w.airports) {
    const [icao, iata, name, city, cc, lat, lon, elevFt, type, rws, freq] = a;
    const apt = { icao, iata, name, city, cc, country: w.countries[cc] || cc, lat, lon, elevFt, large: type === 'L', freq, featured: w.featured.includes(icao), runways: [] };
    for (const r of rws) {
      const [le, he, lenFt, widFt, surf, lit, la1, lo1, la2, lo2, e1, e2, h1, h2, d1, d2, i1, i2, derived] = r;
      apt.runways.push({
        lengthFt: lenFt, widthFt: widFt, surface: surf, lit: !!lit, derived,
        ends: [
          { ident: le, lat: lat + la1 / 1e6, lon: lon + lo1 / 1e6, elevFt: e1, hdgCsv: h1, dispFt: d1, ils: i1 },
          { ident: he, lat: lat + la2 / 1e6, lon: lon + lo2 / 1e6, elevFt: e2, hdgCsv: h2, dispFt: d2, ils: i2 },
        ],
      });
      nRw++;
    }
    World.airports.push(apt); World.byIcao.set(icao, apt);
  }
  World.navaids = w.navaids.map(([id, type, khz, lat, lon]) => ({ id, type, khz, lat, lon }));
  World.stats = { airports: World.airports.length, large: World.airports.filter(a => a.large).length, runways: nRw, navaids: World.navaids.length, src: w.src };
  return World;
}

// Airport geometry in its own local frame (metres, origin = airport reference point).
export function airportGeometry(apt) {
  if (apt.geom) return apt.geom;
  const g = new Geo(apt.lat, apt.lon);
  const elevs = [];
  const runways = apt.runways.map((rw, idx) => {
    const [A, B] = rw.ends;
    const p1 = { x: g.x(A.lon), z: g.z(A.lat) }, p2 = { x: g.x(B.lon), z: g.z(B.lat) };
    const dx = p2.x - p1.x, dz = p2.z - p1.z, L = Math.hypot(dx, dz) || rw.lengthFt * FT;
    const dir = { x: dx / L, z: dz / L };
    const brg = (Math.atan2(dir.x, -dir.z) * R2D + 360) % 360;
    if (A.elevFt != null) elevs.push(A.elevFt); if (B.elevFt != null) elevs.push(B.elevFt);
    const W = Math.max(18, rw.widthFt * FT);
    const mk = (E, p, d, hdg, other) => ({
      ident: E.ident, rwIdx: idx, x: p.x, z: p.z, dir: d, hdg, hdgCsv: E.hdgCsv, disp: (E.dispFt || 0) * FT, ilsMhz: E.ils || 0,
      thrX: p.x + d.x * (E.dispFt || 0) * FT, thrZ: p.z + d.z * (E.dispFt || 0) * FT, other, length: L, width: W, derived: rw.derived,
    });
    const e1 = mk(A, p1, dir, brg, null), e2 = mk(B, p2, { x: -dir.x, z: -dir.z }, (brg + 180) % 360, null);
    e1.other = e2; e2.other = e1;
    return { idx, rw, a: e1, b: e2, cx: (p1.x + p2.x) / 2, cz: (p1.z + p2.z) / 2, L, W, dir, brg, surface: rw.surface, lit: rw.lit, derived: rw.derived };
  });
  const elevFt = elevs.length ? elevs.reduce((s, v) => s + v, 0) / elevs.length : apt.elevFt;
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (const r of runways) for (const e of [r.a, r.b]) { minx = Math.min(minx, e.x); maxx = Math.max(maxx, e.x); minz = Math.min(minz, e.z); maxz = Math.max(maxz, e.z); }
  const radius = Math.max(1200, Math.hypot(maxx - minx, maxz - minz) / 2 + 900);
  const ends = runways.flatMap(r => [r.a, r.b]);
  apt.geom = { runways, ends, elev: elevFt * FT, elevFt, cx: (minx + maxx) / 2, cz: (minz + maxz) / 2, radius, geo: g };
  return apt.geom;
}

// Simulated ILS for every paved runway end; real localizer frequency where OurAirports lists one.
export function ilsFreq(apt, end) {
  if (end.ilsMhz) return { mhz: end.ilsMhz, real: true };
  let h = 0; for (const c of apt.icao + end.ident) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const ch = h % 40; return { mhz: +(108.1 + ch * 0.2 + ((h >> 8) % 2 ? 0 : 0.05)).toFixed(2), real: false };
}

export function search(q, limit = 40) {
  q = q.trim().toUpperCase(); if (!q) return [];
  const out = [];
  for (const a of World.airports) {
    let s = 0;
    if (a.icao === q) s = 100; else if (a.iata === q) s = 98;
    else if (a.icao.startsWith(q)) s = 70; else if (q.length >= 2 && a.iata.startsWith(q)) s = 65;
    else {
      const n = (a.name + ' ' + a.city + ' ' + a.country).toUpperCase();
      if (q.length >= 2) { const i = n.indexOf(q); if (i >= 0) s = (i === 0 || n[i - 1] === ' ' || n[i - 1] === '-') ? 50 : 25; }
    }
    if (s) out.push([s + (a.large ? 3 : 0) + (a.featured ? 4 : 0), a]);
  }
  return out.sort((x, y) => y[0] - x[0]).slice(0, limit).map(x => x[1]);
}

export function nearestAirports(lat, lon, maxDist, limit = 30) {
  const out = [];
  for (const a of World.airports) {
    if (Math.abs(a.lat - lat) > maxDist / 100000 + 0.1) continue;
    const d = haversine(lat, lon, a.lat, a.lon); if (d < maxDist) out.push([d, a]);
  }
  return out.sort((x, y) => x[0] - y[0]).slice(0, limit).map(x => x[1]);
}

// Solar position (NOAA approximation). tLocalMin: local clock minutes, tz: hours offset.
export function sunPosition(lat, lon, date, tLocalMin, tzHours) {
  const doy = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 864e5);
  const g = 2 * Math.PI / 365 * (doy - 1 + (tLocalMin / 60 - tzHours - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = tLocalMin + eqt + 4 * lon - 60 * tzHours;
  const ha = (tst / 4 - 180) * D2R;
  const la = lat * D2R;
  const cz = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cz)));
  let az = Math.acos(Math.max(-1, Math.min(1, (Math.sin(la) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(la) * Math.sin(zen) + 1e-9))));
  az = ha > 0 ? (az * R2D + 180) % 360 : (540 - az * R2D) % 360;
  return { elev: 90 - zen * R2D, az };
}
// Approximate standard time offset (no DST database offline): nearest 1/2 hour of longitude, with a few known zones.
export function tzFor(apt) {
  const known = { US: null, KR: 9, JP: 9, PA: -5, GB: 0, AE: 4, SG: 8, CN: 8, IN: 5.5, AU: null, FR: 1, DE: 1, ES: 1, IT: 1, NL: 1, TH: 7, HK: 8, TW: 8, PH: 8, MY: 8, ID: null, BR: -3, MX: -6 };
  const k = known[apt.cc]; if (k != null) return k;
  if (apt.cc === 'US') { if (apt.lon > -87.5) return -4; if (apt.lon > -101) return -5; if (apt.lon > -115) return -6; return -7; } // daylight time (Oct)
  return Math.round(apt.lon / 15 * 2) / 2;
}
export function sunTimes(apt, date) {
  const tz = tzFor(apt); let rise = null, set = null, prev = null;
  for (let m = 0; m <= 1440; m += 4) {
    const e = sunPosition(apt.lat, apt.lon, date, m, tz).elev;
    if (prev != null) { if (prev < -0.83 && e >= -0.83) rise = m; if (prev >= -0.83 && e < -0.83) set = m; }
    prev = e;
  }
  return { rise, set, tz };
}
export const fmtTime = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
