// Foxheart Skies — boot, world management, game loop, cameras, UI and test hooks.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World, loadWorld, Geo, airportGeometry, search, nearestAirports, haversine, sunPosition, sunTimes, tzFor, fmtTime, ilsFreq, FT, KT, NM, D2R, R2D } from './data.js';
import { Sky, ATM } from './sky.js';
import { Terrain, City, genericSurroundings } from './terrain.js';
import { REGIONS, FEATURED_INFO, climateFor } from './surroundings.js';
import { buildAirport, ilsFor, ilsDeviation, LIGHT_U } from './airport.js';
import { buildAircraft, animateAircraft, foxHeart, DIM } from './aircraft.js';
import { FDM, FLAPS } from './fdm.js';
import { Displays, drawHUD } from './cockpit.js';
import { buildCockpit, COCKPIT_EYE } from './flightdeck.js';
import { Systems } from './systems.js';
import { Pad, BTN, ACTIONS, glyph, btnName } from './gamepad.js';
import { Audio } from './audio.js';
import { Traffic } from './traffic.js';
import { ATC, facility, DEST_DEFAULT, SHORT } from './atc.js';
import { OnFoot } from './onfoot.js';
import { PA, PA_LINES, PA_EMERG } from './pa.js';
import { Failures, FAILS } from './failures.js';
import { Rescue } from './rescue.js';
import { Speech } from './speech.js';
import { GroundCrew } from './groundcrew.js';
import { LandingAids, fdGuide, coachLine } from './landing.js';
import { Music, moodFor } from './music.js';
import { buildCabin } from './interiors.js';
import { rng } from './terrain.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const errors = []; window.addEventListener('error', e => errors.push(String(e.message))); window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
const store = { get(k, d) { try { const v = localStorage.getItem('foxheart.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('foxheart.' + k, JSON.stringify(v)); } catch (e) { } } };
const settings = Object.assign({ quality: 'high', res: 'auto', units: 'aviation', law: 'fbw', invert: '0', mouseSens: 1, vol: 0.7, voice: true, hud: true, padAssist: 'easy', padSens: 1, padDz: 0.15, padInvert: '0', padRumble: true, failRand: 'off', landBoxes: true, landAutoSpd: true, extHud: 'min', music: true, musicVol: 0.5, termMusic: true }, store.get('settings', {}));
const TODAY = new Date(Date.UTC(2026, 9, 27));

// ---------------------------------------------------------------- renderer
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = settings.quality !== 'low'; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.15, 420000);
let composer, bloom, renderScale = 1, dprBase = Math.min(devicePixelRatio || 1, 1.5);
function setupComposer() {
  const q = settings.quality; const msaa = q === 'high' || q === 'ultra' ? 4 : 0;
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: msaa });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.32, 0.55, 1.0); bloom.enabled = q !== 'low';
  composer.addPass(bloom); composer.addPass(new OutputPass());
  applyRes();
}
function targetScale() { const r = settings.res; return r === 'auto' ? renderScale : +r * (settings.quality === 'low' ? 0.75 : 1); }
function applyRes() {
  const pr = dprBase * (settings.res === 'auto' ? renderScale : targetScale());
  renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight, false); composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
  LIGHT_U.uPx.value = pr; const hc = $('#hudc'); hc.width = innerWidth * Math.min(devicePixelRatio, 2); hc.height = innerHeight * Math.min(devicePixelRatio, 2);
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); applyRes(); });

// ---------------------------------------------------------------- systems
let sky = new Sky(renderer, scene, settings.quality);
let terrain = new Terrain(scene, settings.quality);
let city = new City(scene, settings.quality);
const aircraft = buildAircraft(settings.quality); scene.add(aircraft);
const displays = new Displays();
let cockpit = new THREE.Group(); cockpit.userData = { screens: [] }; cockpit.visible = false; aircraft.add(cockpit); // the real flight deck is built at boot, once fonts are in
const sys = new Systems();
// gamepad: radial dead zone 0.15 + expo 0.5; the browser only exposes a pad after one of its buttons is pressed
const pad = new Pad(); Object.assign(pad.cfg, { dz: settings.padDz ?? 0.15, expo: 0.5, sens: settings.padSens ?? 1, rumble: settings.padRumble !== false, map: settings.padMap || {} });
pad.onConnect = p => { const x = /xbox|xinput|045e/i.test(p.id); toast((x ? 'Xbox controller connected' : 'Controller connected') + (p.standard ? '' : '. Its buttons are not in the standard layout, so some may differ.'), 4500); padStatus(); padHelpUntil = p.t + 12; };
pad.onDisconnect = () => { toast('Controller disconnected'); padStatus(); };
function padStatus() { const t = pad.gp ? ((/xbox|xinput|045e/i.test(pad.id) ? 'Xbox controller' : 'Controller') + ' connected' + (pad.standard ? '' : ' (non-standard layout)')) : 'Using an Xbox controller? Press any button on it to connect it.'; for (const el of document.querySelectorAll('.padhint')) { el.textContent = t; el.classList.toggle('on', !!pad.gp); } }
const fdm = new FDM(); fdm.law = settings.law;
const audio = new Audio(); audio.vol = settings.vol; audio.voice = settings.voice;
const music = new Music(audio); music.on = settings.music !== false; music.vol = settings.musicVol ?? 0.5; music.term = settings.termMusic !== false;
const traffic = new Traffic(scene);
const atc = new ATC(audio);
const foot = new OnFoot(scene, camera, aircraft, audio);
const crew = new GroundCrew(scene); // tug, chocks, cones, GPU and ramp crew at the stand
const aids = new LandingAids(scene); // PAPI + glide path boxes for hand-flown landings
const pa = new PA(audio);
// one speech queue for PA, ATC, ATIS, chatter and callouts, with subtitles and a PA-live indicator
const speech = new Speech(); atc.speech = speech; pa.speech = speech; audio.speech = speech;
let subT = null;
speech.on((ev, it) => {
  if (it && it.channel === 'pa') { if (ev === 'start') music.duck(true); else if (ev === 'end' || ev === 'silent') music.duck(false); } // music dips under cabin announcements
  const el = $('#subs'); if (!el) return;
  if (ev === 'start' && it.channel !== 'gpws') { el.className = it.channel === 'pa' ? 'pa' : (it.channel === 'chatter' || it.channel === 'atis') ? 'oth' : ''; el.innerHTML = `<b>${esc(it.o.who || '')}</b>${esc(it.o.display || it.o.text || '')}`; el.style.opacity = 1; clearTimeout(subT);
    if (!speech.canSpeak() && !W.speechNote && it.o.mute !== true) { W.speechNote = true; toast('No speech voice is available in this browser, so announcements and ATC are shown as subtitles.', 7000); } }
  if (ev === 'end' && it.channel !== 'gpws') { clearTimeout(subT); subT = setTimeout(() => { if (!speech.cur || speech.cur.channel === 'gpws') el.style.opacity = 0; }, 1800); }
  if (ev === 'silent' && !W.speechNote) { W.speechNote = true; toast('Speech is silent in this browser, so announcements and ATC are shown as subtitles.', 7000); }
  const live = $('#paLive'); if (live) live.hidden = !speech.busyWith('pa');
});
// failures, emergencies and the rescue services (failures.js, rescue.js); the first officer's checklist voice goes through the speech manager
const rescue = new Rescue(scene);
function foSay(text) { speech.say({ channel: 'crew', text, display: text.replace(/E C A M/g, 'ECAM').replace(/A P U/g, 'APU').replace(/P T U/g, 'PTU'), who: 'FO', voice: () => atc.voiceFor('ME'), lang: 'en-US', rate: 1.12, pitch: 0.94, volume: Math.min(1, audio.vol + 0.2), mute: audio.voice === false, maxWait: 15 }); }
const fails = new Failures({ fdm, sys, audio, say: foSay, toast: t => toast(t, 4500), pa: id => paSay(id), assist: () => fdm.assist, onAlert: F => toast(F.title + (F.c === 'r' ? ' · master warning' : ' · master caution'), 4000) });
function rescueDispatch() { if (!W.started || W.menuMode) return; const b = W.primary; const c = b ? new THREE.Vector3(b.x + (b.geom.cx || 0), 0, b.z + (b.geom.cz || 0)) : fdm.pos.clone(); const d = c.sub(fdm.pos).setY(0); if (d.lengthSq() < 1) d.set(1, 0, 0); const from = fdm.pos.clone().addScaledVector(d.normalize(), 520); from.y = ground(from.x, from.z).h;
  aircraft.updateMatrixWorld(true); rescue.dispatch(from, sys.fire[0].on || sys.fire[1].on); if (!W.rescueT) { W.rescueT = W.simTime; toast('Airport fire and rescue are on their way.', 4000); } }
function emergencyStep(dt) { // scraping noise on a belly slide; the rescue services roll once an emergency landing has stopped
  if (fdm.scrape > 3) { W.scrT = (W.scrT || 0) - dt; if (W.scrT <= 0) { W.scrT = 0.3; audio.noiseHit(0.45, 2600 + Math.random() * 900, 800, Math.min(0.22, fdm.scrape / 110)); } }
  if (fdm.onGround && fdm.td && !W.emerStop && Math.hypot(fdm.vel.x, fdm.vel.z) < 3 * KT && (fdm.belly || sys.fire[0].on || sys.fire[1].on || atc.flags.emer)) { W.emerStop = true; rescueDispatch(); if (fdm.belly) { Object.assign(sys.sw, { master1: false, master2: false }); foSay('We have stopped. Engines are off. Evacuate the aircraft?'); } }
}
function evacuate() { if (W.evac) return; W.evac = true; Object.assign(sys.sw, { master1: false, master2: false }); fdm.engRun = [false, false]; fdm.parkBrake = true; paSay('evac'); aircraft.updateMatrixWorld(true); rescue.evacuate(aircraft, !!fdm.belly); rescueDispatch(); W.foam = true; toast('Evacuation: slides are inflating and passengers are leaving the aircraft.', 6000); }
let taxiLine = null;
const airportsRoot = new THREE.Group(); scene.add(airportsRoot);
// blob shadow
const blobTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 4, 64, 64, 62); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })); blob.renderOrder = 4; scene.add(blob);

const W = { geo: new Geo(0, 0), apt: null, built: [], primary: null, ils: null, end: null, mode: 'free', cfg: null, tod: 1080, wx: 'clear', wind: new THREE.Vector3(), windFrom: 270, windKt: 6, gust: 0, wet: { value: 0 }, route: null, navs: [], timeAccel: 1, paused: false, view: 'chase', simTime: 0, lastTD: null, scored: false, started: false, menuMode: true };

// ---------------------------------------------------------------- world construction
function aptPos(A) { return new THREE.Vector3(W.geo.x(A.lon), airportGeometry(A).elev, W.geo.z(A.lat)); }
function buildWorldAt(lat, lon, primaryApt) {
  W.geo = new Geo(lat, lon);
  airportsRoot.clear(); W.built = [];
  const near = nearestAirports(lat, lon, 95000, 14);
  if (primaryApt && !near.includes(primaryApt)) near.unshift(primaryApt);
  const sharedTaxi = null;
  for (const A of near) {
    const g = airportGeometry(A); if (!g.runways.length) continue;
    const full = A === primaryApt || (!primaryApt && W.built.length === 0);
    const b = buildAirport(A, { quality: settings.quality, wet: W.wet, full: full || haversine(lat, lon, A.lat, A.lon) < 12000 });
    const P = aptPos(A); b.group.position.copy(P); airportsRoot.add(b.group);
    W.built.push({ apt: A, icao: A.icao, x: P.x, z: P.z, y: P.y, elev: g.elev, r: g.radius, geom: g, b, full });
  }
  W.primary = W.built.find(b => b.apt === primaryApt) || W.built[0];
  // terrain
  const featured = REGIONS.some(r => lat >= r.bbox[0] && lat <= r.bbox[2] && lon >= r.bbox[1] && lon <= r.bbox[3]);
  const gen = primaryApt ? genericSurroundings(primaryApt, W.geo) : { cities: [], noiseAmp: 40, climate: climateFor(lat, lon) };
  const zones = W.built.slice().sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)).slice(0, 4).map(b => ({ x: b.x + b.geom.cx, z: b.z + b.geom.cz, r: b.geom.radius, elev: b.elev - 0.15 }));
  terrain.setup(W.geo, 0, 0, zones, W.built.map(b => b.apt), { base: W.primary ? W.primary.elev : 0, noiseAmp: featured ? 6 : gen.noiseAmp, climate: featured ? climateFor(lat, lon) : gen.climate, extraCities: featured ? [] : gen.cities });
  if (/desert/.test(climateFor(lat, lon)) && featured) terrain.uniforms.uNoiseAmp.value = terrain.noiseAmp = 10;
  city.build(terrain, W.geo, 0, 0, zones);
  // navaids in range for the ND
  W.navs = World.navaids.filter(n => Math.abs(n.lat - lat) < 2.2 && haversine(lat, lon, n.lat, n.lon) < 260000).map(n => ({ ...n, x: W.geo.x(n.lon), z: W.geo.z(n.lat) }));
  W.originLL = { lat, lon };
}
function ground(x, z) {
  for (const b of W.built) { const dx = x - b.x - b.geom.cx, dz = z - b.z - b.geom.cz; if (dx * dx + dz * dz < b.r * b.r) { const t = terrain.masks.sample(x, z, _m); return { h: b.elev, water: t[0] > 0.6, apt: b }; } }
  return terrain.heightAt(x, z);
}
const _m = [0, 0, 0];

function setTimeOfDay(min) {
  W.tod = ((min % 1440) + 1440) % 1440; const A = W.primary?.apt || W.apt; if (!A) return;
  const ll = W.geo.toLatLon(fdm.pos.x, fdm.pos.z); const s = sunPosition(ll.lat, ll.lon, TODAY, W.tod, tzFor(A));
  sky.setSun(s.elev, s.az); W.sun = s;
}
function setWeather(kind, dirFrom, kt, gust) {
  W.wx = kind; sky.setWeather(kind); W.windFrom = dirFrom ?? W.windFrom; W.windKt = kt ?? W.windKt; W.gust = gust ? Math.max(2, W.windKt * KT * 0.35) : (kind === 'rain' ? 2 : 0);
  const a = W.windFrom * D2R; W.wind.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(W.windKt * KT);
  W.wet.value = kind === 'rain' ? 1 : kind === 'fog' ? 0.35 : 0; terrain.uniforms.uWet.value = W.wet.value;
}
function activeRunwayEnd(b) { // into the wind, longest
  let best = null, bs = -1e9;
  for (const r of b.geom.runways) for (const E of [r.a, r.b]) { if (r.W < 25) continue; const head = Math.cos((E.hdg - W.windFrom) * D2R) * W.windKt; const s = head * 50 + r.L * 0.02; if (s > bs) { bs = s; best = E; } }
  return best;
}

// ---------------------------------------------------------------- flights
const PHASE = { gate: 'gate', runway: 'takeoff', final: 'approach' };
async function startFlight(cfg) {
  if (/^hand/.test(cfg.start)) cfg = Object.assign({}, cfg, { start: 'final', hand: true, finalNm: cfg.start === 'hand5' ? 5 : 10 }); // "Land it yourself"
  W.cfg = cfg; W.hand = !!cfg.hand && !cfg.menu; W.mode = cfg.mode || 'free'; W.menuMode = !!cfg.menu;
  const A = cfg.apt; const g = airportGeometry(A);
  let E = g.ends.find(e => e.ident === cfg.end) || g.ends[0];
  showLoad(true, 'Building ' + A.icao + ' and surroundings…');
  await new Promise(r => setTimeout(r, 30));
  buildWorldAt(A.lat, A.lon, A);
  setWeather(cfg.wx || 'clear', cfg.windFrom, cfg.windKt, cfg.gusts);
  const P = aptPos(A); const elev = g.elev;
  const dir = new THREE.Vector3(E.dir.x, 0, E.dir.z);
  W.end = E; W.apt = A; W.ils = ilsFor(A, E, P); W.depIls = W.ils;
  fdm.law = settings.law;
  const sp = fdm.speeds();
  if (cfg.start === 'final' || cfg.start === 'route') {
    let pos, hdg, alt, spd = cfg.start === 'final' ? 160 : (cfg.route?.spd || 250);
    if (cfg.start === 'final') { const d = (cfg.finalNm || 10) * NM; pos = W.ils.thr.clone().addScaledVector(dir, -d); alt = elev + 15 + (d + 286) * Math.tan(3 * D2R); hdg = E.hdg; }
    else { const r = cfg.route; const s = r.start; pos = new THREE.Vector3(W.geo.x(s.lon), 0, W.geo.z(s.lat)); alt = s.alt * FT; hdg = s.hdg; }
    if (W.hand) spd = Math.round(sp.vapp); // hand-flown: fully configured at approach speed
    const V = spd * KT; const flaps = W.hand ? 4 : cfg.start === 'final' ? 2 : 0;
    fdm.reset({ x: pos.x, y: alt, z: pos.z, hdg, speed: V, vs: cfg.start === 'final' ? -V * Math.tan(3 * D2R) : 0, pitch: W.hand ? 0.6 : cfg.start === 'final' ? 1 : 2.5, gear: W.hand, flaps, tl: W.hand ? HAND_TL : cfg.start === 'final' ? 0.42 : 0.62, n1: cfg.start === 'final' ? 52 : 68, onGround: false, spdSel: spd, altSel: Math.round(alt / FT / 100) * 100 });
    fdm.qInt = 0.075; fdm.ap.on = true; fdm.ap.athr = true; fdm.ap.hdg = Math.round(hdg); fdm.ap.alt = Math.round(alt / FT / 100) * 100;
    if (cfg.start === 'final') { fdm.ap.ils = W.ils; fdm.ap.locArmed = true; fdm.ap.gsArmed = true; fdm.ap.lat = 'HDG'; fdm.ap.vert = 'ALT'; fdm.ap.alt = Math.max(2000, Math.round((elev / FT + 2000) / 100) * 100); fdm.ap.appr = true; }
    else { fdm.ap.route = W.route = cfg.route.wps.map(([lat, lon, name]) => ({ lat, lon, name, x: W.geo.x(lon), z: W.geo.z(lat) })); fdm.ap.wp = 0; fdm.ap.lat = 'NAV'; fdm.ap.vert = 'ALT'; fdm.ap.alt = cfg.route.alt; }
    if (W.hand) { fdm.ap.on = false; fdm.ap.ils = W.ils; fdm.ap.locArmed = fdm.ap.gsArmed = fdm.ap.appr = false; fdm.ap.spd = spd; fdm.ap.athr = landHelpers() && settings.landAutoSpd; fdm.spoilersArmed = true; fdm.autobrake = 2; }
    W.phase = 'approach';
  } else if ((cfg.start === 'gate' || cfg.start === 'terminal') && W.primary.b.stands.length) {
    const st = pickStand(W.primary); placeAtStand(W.primary, st);
    fdm.ap.spd = Math.round(sp.v2 + 10); fdm.ap.alt = Math.round((elev / FT + 5000) / 1000) * 1000; fdm.ap.hdg = Math.round(E.hdg);
    W.phase = 'gate';
  } else {
    const p0 = new THREE.Vector3(P.x + E.x, 0, P.z + E.z).addScaledVector(dir, 45);
    fdm.reset({ x: p0.x, y: elev + 3.4, z: p0.z, hdg: E.hdg, speed: 0, gear: true, flaps: 1, tl: 0, onGround: true, parkBrake: !cfg.menu, spdSel: Math.round(sp.v2 + 10), altSel: Math.round((elev / FT + 5000) / 100) * 100 });
    fdm.ap.hdg = Math.round(E.hdg);
    W.phase = 'takeoff';
  }
  if (cfg.start !== 'route') { W.route = null; }
  fdm.ap.autoConfig = cfg.start === 'final' || cfg.start === 'route';
  setTimeOfDay(cfg.tod ?? 1080);
  W.lastTD = null; W.scored = false; W.callLog = []; W.timeAccel = 1; W.descending = false; W.push = null; W.autoTaxi = null; W.parkedAt = null; W.tripDone = false; showTaxi(null); foot.dispose(); disposeFlightCabin(); W.onFoot = false; W.signs = { belt: true, smoke: true }; Object.assign(CC, { v: 78, cd: {}, warnT: 0, hints: {} }); paLog.length = 0; if (paOpen) togglePA(false);
  if (!(cfg.start === 'gate' || cfg.start === 'terminal')) { W.stand = null; W.standB = null; }
  crew.clear(); if (!cfg.menu && W.stand) { aircraft.position.copy(fdm.pos); aircraft.quaternion.copy(fdm.q); aircraft.updateMatrixWorld(true); crew.atStand(aircraft, ground); W.stand.jb?.userData?.setDocked?.(true); }
  // at a gate the engines are off (APU running, or everything off for cold & dark); runway and air starts keep them running
  const atGate = cfg.start === 'gate' || cfg.start === 'terminal', cold = !!cfg.cold && atGate;
  sys.reset(cold ? 'cold' : atGate && !cfg.menu ? 'gate' : 'run'); fails.reset(); fails.random = cfg.menu ? 'off' : settings.failRand || 'off'; if (cfg.fail && !cfg.menu) fails.trigger(cfg.fail, { eng: 0 }); rescue.clear(); Object.assign(W, { evac: false, emerStop: false, rescueT: 0, foam: false, braced: false, emergPA: false, bellyT: 0, souls: 120 + ((Math.random() * 50) | 0) + 6 }); W.ndRange = null; lights._auto = undefined; W.coldDone = !cold; W.coldT = 0; W.autoStart = null;
  if (atGate && !cfg.menu) { fdm.engRun = [false, false]; fdm.n1 = [0, 0]; fdm.n2 = [0, 0]; fdm.egt = [24, 24]; fdm.tl = 0; fdm.ap.on = false; fdm.ap.athr = false; }
  if (cfg.start === 'route') { W.ils = fdm.ap.ils = null; } W.simTime = 0; W.crashShown = false;
  // AI traffic on the runway in use (avoid the player's runway when on it)
  const act = activeRunwayEnd(W.primary) || E;
  traffic.setup(A, new THREE.Vector3(W.primary.x, W.primary.elev, W.primary.z), g.ends, (cfg.start === 'gate' || cfg.start === 'terminal') ? E : act === E && cfg.start !== 'final' ? (g.ends.find(e => e !== E && e !== E.other && e.length > 1800) || act) : act);
  traffic.enabled = !cfg.menu || true;
  sky.envAge = 1e9; sky.lutDirty = true;
  // warm up shaders (flight deck included) while the loading screen is still up, so entering a view never hitches
  if (!cfg.menu) { const vis = cockpit.visible; cockpit.visible = true; aircraft.position.copy(fdm.pos); aircraft.quaternion.copy(fdm.q); try { await renderer.compileAsync(scene, camera); } catch (e) { try { renderer.compile(scene, camera); } catch (e2) { } } cockpit.visible = vis; }
  W.started = true; showLoad(false);
  if (!cfg.menu) {
    W.dest = cfg.toApt || (cfg.dest && World.byIcao.get(cfg.dest)) || World.byIcao.get(DEST_DEFAULT[A.icao]) || nearestAirports(A.lat, A.lon, 900000, 6).find(x => x !== A && x.large) || A;
    atc.auto = settings.atcAuto || false;
    atc.setup({ start: cfg.start, dep: A, arr: cfg.start === 'final' ? A : W.dest, depEnd: E, gate: String(W.stand?.gateName || 7), ctx: atcCtx });
    renderRadio();
    setView(cfg.view || (cfg.start === 'final' ? 'cockpit' : 'chase'));
    showNote(A);
    toast(cfg.start === 'runway' ? 'Parking brake set. Space releases it; Page Up / Shift adds thrust. T opens the radio.' : cfg.start === 'gate' ? 'At gate ' + W.stand.gateName + '. Press T for the radio: clearance, then pushback (or K to push without ATC).' : cfg.start === 'final' ? (W.hand ? handMsg() : 'Autopilot flying the ILS. Press Z to take over, T for the radio.') : 'Autopilot on NAV. Use . and , for time acceleration. T opens the radio.', 6500);
    if (cfg.start === 'terminal') enterFoot('dep');
  }
  return true;
}
// ---------------------------------------------------------------- hand-flown landing ("Land it yourself")
const HAND_TL = 0.5; // approximate approach thrust, full flaps + gear at VAPP
function landHelpers() { return fdm.assist !== 'realistic'; } // boxes in the sky + auto-speed: off in Realistic assist
function handMsg() { const pad1 = pad.active; return 'Your aircraft! Follow the green flight director bars' + (settings.landBoxes && landHelpers() ? ' and fly through the magenta boxes' : '') + '. PAPI: two red, two white = on the glide path. ' + (fdm.ap.athr ? 'Auto-speed holds the speed for you.' : (pad1 ? 'RT / LT' : 'Page Up / Page Down') + ' for thrust.'); }
function handFlyAvailable() { if (fdm.onGround || !W.ils || W.hand) return false; const d = ilsDeviation(W.ils, fdm.pos); return d.valid && d.thrDist > 1.5 * NM && d.thrDist < 18 * NM && W.ils !== W.depIls || (W.cfg?.start === 'final' && d.valid && d.thrDist > 1.5 * NM); }
function handFly() {
  if (!handFlyAvailable()) return false; W.hand = true; fdm.disconnectAP('hand-fly'); fdm.ap.autoConfig = true; fdm.ap.ils = W.ils;
  fdm.ap.athr = landHelpers() && settings.landAutoSpd; if (fdm.ap.athr) fdm.ap.spd = Math.round(Math.max(fdm.speeds().vapp, fdm.ias > 160 ? 160 : 0));
  fdm.spoilersArmed = true; fdm.autobrake = fdm.autobrake || 2; fdm.gammaHold = null; toast(handMsg(), 7000); return true;
}
// ---------------------------------------------------------------- gates, pushback, taxi routes, on foot, ATC context
function pickStand(b) { const all = b.b.stands; all.forEach((s, i) => { s.gateName = String(i + 1); }); const free = all.filter(s => !s.used); return free[(free.length / 2) | 0] || all[(all.length / 2) | 0]; }
function placeAtStand(b, st) {
  const fr = b.b.frame; fdm.reset({ x: b.x + st.x - fr.nx * 2, y: b.elev + 3.4, z: b.z + st.z - fr.nz * 2, hdg: st.inHdg, speed: 0, gear: true, flaps: 0, tl: 0, onGround: true, parkBrake: true, spdSel: 150, altSel: 5000 });
  st.used = true; W.stand = st; W.standB = b; if (!st.gateName) b.b.stands.forEach((s, i) => s.gateName = String(i + 1));
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
function taxiOutRoute() {
  const b = W.primary, E = W.end; const net = b?.b.taxiNet.find(t => t.r.a === E || t.r.b === E); if (!net) return { via: ['A'], hold: 'A1', pts: [] };
  const sEnd = net.r.a === E ? 0 : net.r.L; const conn = net.conns.reduce((m, c) => Math.abs(c.s - sEnd) < Math.abs(m.s - sEnd) ? c : m);
  const link = net.links.slice().sort((p, q) => Math.abs(p.s - sEnd) - Math.abs(q.s - sEnd))[0];
  const W3 = p => V3(b.x + p.x, b.elev + 0.6, b.z + p.z); const t = (net.r.W / 2 + 70) / (net.off + 2 - net.r.W / 2 + net.r.W / 2);
  const holdL = { x: conn.a.x + (conn.b.x - conn.a.x) * (1 - 95 / (net.off - net.r.W / 2 + 2)), z: conn.a.z + (conn.b.z - conn.a.z) * (1 - 95 / (net.off - net.r.W / 2 + 2)) };
  const pts = [fdm.pos.clone().setY(b.elev + 0.6)]; if (link) pts.push(W3(link.b), W3(link.a)); pts.push(W3(net.P(sEnd)), W3(holdL));
  return { via: link ? [link.name, net.name] : [net.name], hold: conn.name, pts, holdPt: W3(holdL), linkB: link && W3(link.b) };
}
function exitConn() { // the runway exit ahead of the aircraft on the landing roll
  const b = W.primary; if (!b || !b.b.taxiNet.length) return null; const p = fdm.pos; let best = null, bd = 1e12;
  for (const net of b.b.taxiNet) { const r = net.r; const vx = p.x - b.x - r.a.x, vz = p.z - b.z - r.a.z; const s = vx * r.dir.x + vz * r.dir.z; const d = Math.abs(-vx * r.dir.z + vz * r.dir.x); if (s > -100 && s < r.L + 100 && d < bd) { bd = d; best = { net, s }; } }
  if (!best) best = { net: b.b.taxiNet[0], s: 0 }; const { net, s } = best; const fwdSign = Math.sign(fdm.vel.x * net.r.dir.x + fdm.vel.z * net.r.dir.z) || 1;
  const conn = net.conns.filter(c => (c.s - s) * fwdSign > 30).sort((p, q) => Math.abs(p.s - s) - Math.abs(q.s - s))[0] || net.conns.slice().sort((p, q) => Math.abs(p.s - s) - Math.abs(q.s - s))[0];
  return conn ? { net, conn } : null;
}
function onRunwayOf(il) { if (!il || !fdm.onGround) return false; const d = ilsDeviation(il, fdm.pos); return Math.abs(d.cross) < Math.max(15, (il.width || 45) / 2 + 2) && d.thrDist < 15 && d.thrDist > -(il.length || 2500) - 15; }
function taxiInRoute() {
  const b = W.primary; const p = fdm.pos; let best = null, bd = 1e12;
  for (const net of b.b.taxiNet) { const r = net.r; const vx = p.x - b.x - r.a.x, vz = p.z - b.z - r.a.z; const s = vx * r.dir.x + vz * r.dir.z; const d = Math.abs(-vx * r.dir.z + vz * r.dir.x); if (s > -100 && s < r.L + 100 && d < bd) { bd = d; best = { net, s }; } }
  if (!best) best = { net: b.b.taxiNet[0], s: 0 };
  const { net, s } = best; const fwdSign = Math.sign(fdm.vel.x * net.r.dir.x + fdm.vel.z * net.r.dir.z) || 1;
  const conn = net.conns.filter(c => (c.s - s) * fwdSign > 30).sort((p, q) => Math.abs(p.s - s) - Math.abs(q.s - s))[0] || net.conns.slice().sort((p, q) => Math.abs(p.s - s) - Math.abs(q.s - s))[0];
  const link = net.links.slice().sort((p, q) => Math.abs(p.s - conn.s) - Math.abs(q.s - conn.s))[0];
  const st = pickStand(b); W.arrStand = st; const fr = b.b.frame;
  const W3 = q => V3(b.x + q.x, b.elev + 0.6, b.z + q.z);
  const standPt = V3(b.x + st.x + fr.nx * 30, b.elev + 0.6, b.z + st.z + fr.nz * 30);
  const pts = [p.clone().setY(b.elev + 0.6), W3(conn.a), W3(conn.b)]; if (link) pts.push(W3(net.P(link.s)), W3(link.a), W3(link.b)); pts.push(standPt, V3(b.x + st.x, b.elev + 0.6, b.z + st.z));
  return { via: [conn.name, net.name].concat(link ? [link.name] : []), gate: st.gateName, pts, stand: st };
}
function showTaxi(r) {
  if (taxiLine) { scene.remove(taxiLine); taxiLine.geometry.dispose(); taxiLine = null; } W.taxiR = r || null; if (!r || !r.pts || r.pts.length < 2) return;
  const g = new THREE.BufferGeometry().setFromPoints(r.pts); taxiLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xff5cff, transparent: true, opacity: 0.9 })); taxiLine.frustumCulled = false; taxiLine.renderOrder = 6; scene.add(taxiLine);
}
function compass(v) { const h = (Math.atan2(v.x, -v.z) * R2D + 360) % 360; return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(h / 45) % 8]; }
function pushDir() { const b = W.standB; if (!b) return null; const fr = b.b.frame; const ad = V3(fr.adx, 0, fr.adz); const r = taxiOutRoute(); if (r.linkB && V3(r.linkB.x - fdm.pos.x, 0, r.linkB.z - fdm.pos.z).dot(ad) < 0) ad.negate(); return ad; }
function startPushback() {
  const b = W.standB; if (!b || !fdm.onGround) { toast('Pushback is only available at a gate'); return; }
  foot.dispose(); W.onFoot = false; const fr = b.b.frame; const n = V3(fr.nx, 0, fr.nz), u = pushDir();
  const P0 = fdm.pos.clone(), P1 = P0.clone().addScaledVector(n, 30), Rr = 26, C = P1.clone().addScaledVector(n, Rr), P2 = C.clone().addScaledVector(u, -Rr);
  // ground crew first: jet bridge retracts, cones and chocks come away, GPU off, the tug drives in and hooks up (about 7 s)
  W.stand?.jb?.userData?.setDocked?.(false); W.parkedAt?.jb?.userData?.setDocked?.(false);
  aircraft.position.copy(fdm.pos); aircraft.quaternion.copy(fdm.q); aircraft.updateMatrixWorld(true); if (crew.state === 'off') crew.atStand(aircraft, ground); crew.startPush(aircraft);
  W.push = { t: -7, T1: 20, T2: 24, P0, P1, C, P2, n, u, done: false }; toast('Pushback: the bridge is retracting and the tug is connecting…');
}
function pushStep(dt) {
  const P = W.push; P.t += dt; let pos, nose;
  if (P.t < 0) { fdm.vel.set(0, 0, 0); fdm.w.set(0, 0, 0); fdm.parkBrake = true; return; }
  if (!P.started) { P.started = true; fdm.parkBrake = false; toast('Pushback in progress… brakes released'); }
  if (P.t < P.T1) { const k = P.t / P.T1; const e = k * k * (3 - 2 * k); pos = P.P0.clone().lerp(P.P1, e); nose = P.n.clone().negate(); }
  else { const s = Math.min(1, (P.t - P.T1) / P.T2); const a = P.P1.clone().multiplyScalar((1 - s) * (1 - s)).add(P.C.clone().multiplyScalar(2 * s * (1 - s))).add(P.P2.clone().multiplyScalar(s * s));
    const tan = P.C.clone().sub(P.P1).multiplyScalar(2 * (1 - s)).add(P.P2.clone().sub(P.C).multiplyScalar(2 * s)); pos = a; nose = tan.lengthSq() > 1e-6 ? tan.normalize().negate() : P.u.clone(); if (s >= 1) { P.done = true; fdm.parkBrake = true; toast('Pushback complete. Request taxi (radio) or release the parking brake and taxi.'); crew.release(); } }
  fdm.vel.set((pos.x - fdm.pos.x) / Math.max(dt, 1e-3), 0, (pos.z - fdm.pos.z) / Math.max(dt, 1e-3)); if (P.done) fdm.vel.set(0, 0, 0); fdm.pos.x = pos.x; fdm.pos.z = pos.z; fdm.w.set(0, 0, 0);
  fdm.q.setFromEuler(new THREE.Euler(0, -Math.atan2(nose.x, -nose.z), 0, 'YXZ'));
  if (P.done) W.push = Object.assign(P, { finished: true });
}
function autoTaxiStep(dt) {
  const T = W.autoTaxi; const tgt = T.pts[T.i]; if (!tgt) { W.autoTaxi = null; fdm.parkBrake = true; fdm.vel.set(0, 0, 0); toast('Auto-taxi finished'); return; }
  const d = V3(tgt.x - fdm.pos.x, 0, tgt.z - fdm.pos.z); const L = d.length(); if (L < 4) { T.i++; return; }
  const v = Math.min(T.speed, L * 0.6 + 2); d.normalize(); fdm.pos.x += d.x * v * dt; fdm.pos.z += d.z * v * dt; fdm.vel.set(d.x * v, 0, d.z * v); fdm.w.set(0, 0, 0);
  const cur = fdm.euler().hdg, want = Math.atan2(d.x, -d.z) * R2D; const dh = ((want - cur + 540) % 360) - 180; const h = cur + THREE.MathUtils.clamp(dh, -25 * dt, 25 * dt);
  fdm.q.setFromEuler(new THREE.Euler(0, -h * D2R, 0, 'YXZ')); fdm.parkBrake = false; fdm.tl = 0.12;
}
function enterFoot(mode) {
  const b = W.standB || W.primary; const st = mode === 'arr' ? W.parkedAt : W.stand; if (!b || !st) return;
  aircraft.position.copy(fdm.pos); aircraft.quaternion.copy(fdm.q); aircraft.updateMatrixWorld(true);
  disposeFlightCabin(); if (!foot.parts) foot.build({ mode, apt: b.apt, b, stand: st, dest: mode === 'dep' ? W.dest : W.cfg.apt, featured: featured() });
  foot.enter(mode === 'dep' ? 'hall' : 'cockpit'); foot.hideInteriors(true); W.onFoot = true; W.footMode = mode;
  $('#flight').hidden = true; $('#foot').hidden = false; $('#radio').hidden = true; setView('cockpit');
  foot.onEvent = ev => {
    if (ev === 'boarding') { toast('Boarding has started. Passengers are taking their seats.', 4000); }
    if (ev === 'greet') { toast('Cabin crew: “Welcome aboard Nicofoxheart Air, captain!”', 4000); }
    if (ev === 'boarded') { audio.chime(); toast('Boarding complete', 3000); if (!foot.announced) { foot.announced = true; setTimeout(() => announce(), 1200); } }
  };
}
function announce() {
  const dest = W.dest ? (SHORT[W.dest.icao] || W.dest.city) : 'our destination';
  const txt = `Ladies and gentlemen, welcome aboard Nicofoxheart Air flight four one two to ${dest}. Boarding is complete. Please make sure your seat belt is fastened and your bags are stowed. We wish you a pleasant flight.`;
  toast('Cabin announcement: welcome aboard flight 412 to ' + dest + '.', 6000); paSpeak(txt, 'PURSER');
}
function takeSeat() {
  if (!foot.boardingDone) { audio.chime(); foot.boardingDone = true; foot.parts?.cabin.seatAll(); }
  W.onFoot = false; foot.active = false; foot.hideInteriors(false);
  try { document.exitPointerLock && document.exitPointerLock(); } catch (e) { }
  $('#foot').hidden = true; $('#flight').hidden = false; setView('cockpit'); look.yaw = 0; look.pitch = -13; look.target = null;
  toast('In the captain’s seat. Press T for the radio: ask Delivery for your clearance.', 6000);
}
function parkAtGate(st) {
  const b = W.primary; placeAtStand(b, st); W.parkedAt = st; W.standB = b; W.autoTaxi = null; showTaxi(null);
  fdm.tl = 0; fdm.parkBrake = true; audio.chime(); foot.dispose(); disposeFlightCabin();
  // shut down at the gate: APU on, engines off, beacon off; the purser welcomes everyone, then the seat belt sign goes off
  Object.assign(sys.sw, { master1: false, master2: false, apuMaster: true, apuBleed: true, beacon: false }); sys.apuN = 100; sys.apuFlap = 1; W.autoStart = null;
  setTimeout(() => { if (W.parkedAt === st) paSay('arrival'); }, 1500); setTimeout(() => { if (W.parkedAt === st) setSigns(false, W.signs.smoke); }, 9000); aircraft.position.copy(fdm.pos); aircraft.quaternion.copy(fdm.q); aircraft.updateMatrixWorld(true);
  foot.build({ mode: 'arr', apt: b.apt, b, stand: st, dest: W.cfg.apt, featured: featured() }); foot.hideInteriors(false);
  crew.atStand(aircraft, ground, true); st.jb?.userData?.setDocked?.(true);
  toast('Parked at gate ' + st.gateName + '. Press Enter to stand up and walk out with the passengers.', 6000);
}
function finishTrip() {
  if (W.tripDone) return; W.tripDone = true; try { document.exitPointerLock && document.exitPointerLock(); } catch (e) { }
  const s = lastScore; const from = W.cfg.apt, to = W.primary.apt;
  const log = store.get('log', []); log.unshift({ date: new Date().toISOString().slice(0, 16).replace('T', ' '), mode: 'trip', apt: from.icao + '→' + to.icao, rwy: s?.rwy || '-', fpm: s?.fpm ?? '-', score: s?.score ?? '-', grade: s?.grade || '-', wx: W.wx, tod: fmtTime(W.tod) }); store.set('log', log.slice(0, 200));
  $('#resultBox').innerHTML = `<span class="eyebrow">Trip complete · ${from.icao} → ${to.icao}</span><h2>Welcome to ${SHORT[to.icao] || to.city}</h2><p style="color:var(--mute);margin:0">Flight 412 is in the logbook${s ? ` with a ${s.grade} landing (${s.score}/100, ${s.fpm} fpm)` : ''}. Thanks for flying Nicofoxheart Air.</p><div class="btnrow"><button class="go" id="rMenu">Main menu</button><button class="go ghost" id="rCont">Keep exploring</button></div>`;
  $('#result').hidden = false; $('#rMenu').onclick = () => { $('#result').hidden = true; toMenu(); }; $('#rCont').onclick = () => { $('#result').hidden = true; W.tripDone = false; };
}
function nearestFreeStand(maxD) { const b = W.primary; if (!b || !b.full) return null; let best = null, bd = maxD; for (const st of b.b.stands) { if (st.used && st !== W.arrStand) continue; const d = Math.hypot(b.x + st.x - fdm.pos.x, b.z + st.z - fdm.pos.z); if (d < bd) { bd = d; best = st; } } return best; }
const atcCtx = {
  state() { const d = W.ils ? ilsDeviation(W.ils, fdm.pos) : null; const arr = atc.arr; const ll = W.geo.toLatLon(fdm.pos.x, fdm.pos.z);
    const gs = Math.hypot(fdm.vel.x, fdm.vel.z); const arrIls = W.ils && W.ils.apt === arr && W.ils !== W.depIls ? W.ils : (W.cfg?.start === 'final' ? W.ils : null);
    return { onGround: fdm.onGround, gsKt: gs / KT, altFt: fdm.pos.y / FT, aglFt: fdm.ra / FT, vsFpm: fdm.vel.y / FT * 60, distArrNm: arr ? haversine(ll.lat, ll.lon, arr.lat, arr.lon) / NM : 999, thrNm: d && d.valid ? d.thrDist / NM : 99, locCaptured: fdm.ap.lat === 'LOC',
      lat: ll.lat, lon: ll.lon, ias: fdm.ias, trk: gs > 15 ? (Math.atan2(fdm.vel.x, -fdm.vel.z) * R2D + 360) % 360 : fdm.euler().hdg, tl: fdm.tl, gearDown: fdm.gearDown, flaps: fdm.flapIdx, apOn: fdm.ap.on,
      locDots: d && d.valid ? d.locDots : 0, gsDots: d && d.valid ? d.gsDots : 0, onDepRwy: onRunwayOf(W.depIls), onArrRwy: onRunwayOf(arrIls) }; },
  assist: () => fdm.assist, pushing: () => !!W.push, onRoute: () => !!(W.route && fdm.ap.lat === 'NAV'),
  fcu(o) { // the first officer sets what ATC assigned (not in Realistic assist)
    if (fdm.assist === 'realistic') return false; const ap = fdm.ap, parts = [];
    if (o.alt != null && !['G/S', 'FLARE', 'ROLL OUT'].includes(ap.vert)) { ap.alt = o.alt; parts.push('ALT ' + o.alt.toLocaleString('en-US')); }
    if (o.hdg != null && ap.lat !== 'LOC' && !(W.route && ap.lat === 'NAV')) { ap.hdg = Math.round(o.hdg) % 360 || 360; if (ap.on && ap.lat === 'NAV') ap.lat = 'HDG'; parts.push('HDG ' + String(ap.hdg).padStart(3, '0')); }
    if (o.spd != null) { ap.spd = o.spd; parts.push('SPD ' + o.spd); }
    if (parts.length) toast('First officer set ' + parts.join(' · '), 3000); return true; },
  fixNear(A) { const k = 'fix_' + A.icao; if (k in W) return W[k]; let best = null, bd = 40; for (const n of World.navaids) { if (n.type[0] !== 'V' || Math.abs(n.lat - A.lat) > 0.8) continue; const d = haversine(A.lat, A.lon, n.lat, n.lon) / NM; if (d < bd) { bd = d; best = n; } } return (W[k] = best && { id: best.id, lat: best.lat, lon: best.lon }); },
  approachGeo() { const A = atc.arr, E = atcCtx.arrEnd(); const il = ilsFor(A, E, aptPos(A)); const d = ilsDeviation(il, fdm.pos); const ix = il.thr.x - il.dir.x * 14 * NM - fdm.pos.x, iz = il.thr.z - il.dir.z * 14 * NM - fdm.pos.z;
    return { ipHdg: (Math.atan2(ix, -iz) * R2D + 360) % 360, ipNm: Math.hypot(ix, iz) / NM, thrNm: d.thrDist / NM, crossNm: d.cross / NM }; },
  exitInfo() { const e = exitConn(); return { side: atcCtx.exitSide(), name: e ? e.conn.name : null }; },
  // emergencies: what is wrong, souls on board, endurance, the nearest suitable airport (longest runways among those built nearby)
  emergency: () => fails.emergency ? { kind: fails.emergency, nature: fails.nature() } : null, souls: () => W.souls || 156, fuelMin: () => Math.round(fdm.fuel / 2500 * 60),
  divert() { const ll = W.geo.toLatLon(fdm.pos.x, fdm.pos.z); let best = null, bs = 1e18;
    for (const b of W.built) { const L = Math.max(0, ...b.geom.runways.map(r => r.L || 0)); if (L < 1900) continue; const d = haversine(ll.lat, ll.lon, b.apt.lat, b.apt.lon); const sc = d - L * 2 - (b.apt === atc.dep ? 12000 : 0) - (b.apt === atc.arr ? 8000 : 0); if (sc < bs) { bs = sc; best = b.apt; } }
    return { apt: best || atc.arr || atc.dep }; },
  setArr(A) { atc.arr = A; W.dest = A; if (W.ils && W.ils.apt !== A) { W.ils = fdm.ap.ils = null; } },
  rescue: () => rescueDispatch(),
  weather() { const A = atc.apt(); const temp = Math.round(({ desert: 31, tropical: 29, subtropical: 26, mediterranean: 21, temperate: 13, 'temperate-green': 12, boreal: 4 })[climateFor(A.lat, A.lon)] ?? 18) - (W.wx === 'rain' ? 3 : 0);
    return { kind: W.wx, dir: W.windFrom, kt: W.windKt, gust: W.gust > 2.5, vis: sky.weather.vis, temp, utcMin: W.tod - tzFor(A) * 60, localMin: W.tod }; },
  traffic() { const e = fdm.euler(); return traffic.list.map(a => { if (!a.type) a.type = [['737', 'seven three seven'], ['A320', 'Airbus three twenty'], ['E175', 'Embraer one seventy five'], ['787', 'seven eight seven'], ['A350', 'Airbus three fifty']][(Math.random() * 5) | 0]; const dx = a.x - fdm.pos.x, dz = a.z - fdm.pos.z; const brg = Math.atan2(dx, -dz) * R2D; let rel = ((brg - e.hdg) % 360 + 360) % 360; a.clock = String(Math.round(rel / 30) || 12); a.distNm = Math.hypot(dx, dz) / NM; a.dAltFt = (a.y - fdm.pos.y) / FT; a.vs = a.kind === 'arr' ? -700 : a.h > 1 ? 1800 : 0; return a; }); },
  arrEnd() { if (W.ils && W.ils.apt === atc.arr) return W.ils.end; return activeRunwayEnd({ geom: airportGeometry(atc.arr) }) || airportGeometry(atc.arr).ends[0]; },
  runwayBusy(apt, E) {
    if (traffic.apt !== apt) return { busy: false };
    for (const a of traffic.list) { if (a.done || !(a.E === E || a.E === E.other)) continue;
      if (a.kind === 'arr' && a.s > -7000 && a.s < a.E.length - 150 && !(a.exitT > 6)) return { busy: true, why: a.s < -400 ? `traffic ${Math.max(1, Math.round(-a.s / 1852))} mile final` : 'traffic landing' };
      if (a.kind === 'dep' && (a.hold > 0 || a.h < 250)) return { busy: true, why: 'traffic departing' }; }
    return { busy: false };
  },
  pushFace() { const u = pushDir(); return u ? compass(u) : 'west'; },
  startPushback, pushDone: () => !!(W.push && W.push.done), crewState: () => ({ state: crew.state, t: +crew.t.toFixed(1), push: W.push && +W.push.t.toFixed(1), tug: crew.tug.visible, cones: crew.cones.filter(c => c.visible).length, chocks: crew.chocks.filter(c => c.visible).length }),
  taxiOut() { return taxiOutRoute(); }, taxiIn() { return taxiInRoute(); }, showTaxi,
  nearHold() { return !!(W.taxiR && W.taxiR.holdPt && fdm.pos.distanceTo(W.taxiR.holdPt) < 200); },
  armIls(hdg, alt) { const A = atc.arr, E = atcCtx.arrEnd(); W.ils = fdm.ap.ils = ilsFor(A, E, aptPos(A)); atc.setAssigned(alt);
    if (fdm.ap.on) { if (hdg != null) { fdm.ap.lat = 'HDG'; fdm.ap.hdg = hdg; if (fdm.ap.route) fdm.ap.route = null; } fdm.ap.alt = alt; fdm.ap.locArmed = fdm.ap.gsArmed = fdm.ap.appr = true; } },
  vectorHeading() { const A = atc.arr, E = atcCtx.arrEnd(); const il = ilsFor(A, E, aptPos(A)); const d = ilsDeviation(il, fdm.pos); const c = E.hdg; const h = Math.abs(d.cross) < 600 ? c : c + (d.cross > 0 ? -30 : 30); const hh = Math.round(((h % 360) + 360) % 360 / 10) * 10 || 360;
    const cur = fdm.euler().hdg; return { hdg: hh, turn: (((hh - cur + 540) % 360) - 180) >= 0 ? 'right' : 'left' }; },
  exitSide() { const E = atcCtx.arrEnd(); const b = W.built.find(x => x.apt === atc.arr); const net = b?.b.taxiNet.find(t => t.r.a === E || t.r.b === E); if (!net) return 'right'; return (net.r.a === E) === (net.sd > 0) ? 'right' : 'left'; },
  atGate() { const st = W.arrStand; if (!st || !W.primary) return false; return Math.hypot(W.primary.x + st.x - fdm.pos.x, W.primary.z + st.z - fdm.pos.z) < 60 && Math.hypot(fdm.vel.x, fdm.vel.z) < 2; },
};
// radio panel
let radioOpen = false;
function renderRadio() {
  const r = $('#radio'); if (!r) return;
  const t = atc.tuned; $('#rFreq').textContent = t ? t.mhz.toFixed(t.mhz * 100 % 5 ? 3 : 2) + (t.real ? '' : '*') : '---.--'; $('#rName').textContent = t ? t.name.toUpperCase() : '';
  const A = atc.apt ? atc.apt() : null;
  $('#rFacs').innerHTML = A ? ['ATIS', 'DEL', 'GND', 'TWR', 'DEP', 'CTR', 'APP'].map(k => { const f = k === 'CTR' ? atc.fac('CTR') : facility(A, k); return `<button class="rfac" data-k="${k}" aria-pressed="${t && t.kind === k}"><b>${k}</b><span>${f.mhz.toFixed(f.mhz * 100 % 5 ? 3 : 2)}${f.real ? '' : '*'}</span></button>`; }).join('') : '';
  $$('#rFacs .rfac').forEach(b => b.onclick = () => { atc.tune(b.dataset.k); canvas.focus(); });
  $('#rLog').innerHTML = atc.log.slice(-9).map(l => `<div class="rl ${l.who === 'ME' ? 'me' : l.other ? 'oth' : ''}"><b>${l.who === 'ME' ? 'YOU' : l.fac.toUpperCase()}</b> ${l.text}</div>`).join('') || '<div class="rl"><b>RADIO</b> Pick a call below. Frequencies marked * are simulated; the rest are from the airport data.</div>';
  const lg = $('#rLog'); lg.scrollTop = lg.scrollHeight;
  const opts = atc.options(); $('#rOpts').innerHTML = opts.length ? opts.map((o, i) => `<button class="ropt" data-id="${o.id}"><kbd>${i + 1}</kbd><span>${o.label}</span><small>${o.kind} ${o.freq}</small></button>`).join('') : '<div class="rnone">Nothing to say right now. Fly the aircraft; ATC will call you.</div>';
  $$('#rOpts .ropt').forEach(b => b.onclick = () => { atc.choose(b.dataset.id); canvas.focus(); });
  $('#rAuto').checked = atc.auto; $('#rSpeak').checked = atc.speakMe;
  // (spoken lines are shown by the shared subtitle bar, in sync with the voice)
}
atc.on(() => renderRadio()); atc.onNote = t => toast(t, 4000);
function paKey(n) { if (n === 0) setSigns(!W.signs.belt, W.signs.smoke); else { const l = PA_LINES[n - 1]; if (l) paSay(l.id); } }
function toggleRadio(v) { radioOpen = v ?? !radioOpen; $('#radio').hidden = !radioOpen; if (radioOpen && paOpen) togglePA(false); if (radioOpen) $('#atcCap').style.opacity = 0; renderRadio(); }
// ---------------------------------------------------------------- cabin PA, signs, passenger comfort, cabin camera
let paOpen = false; const paLog = [];
W.signs = { belt: true, smoke: true };
const CC = { v: 78, cd: {}, warnT: 0, why: null, hints: {} };
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function cabinObj() { return foot.parts?.cabin || W.flightCabin || null; }
function ensureCabin() {
  let c = cabinObj(); if (c) return c; const A = W.cfg?.apt || W.apt; if (!A) return null;
  c = buildCabin(A.icao, rng((Date.now() & 0xffff) + 7)); c.seatAll(); aircraft.add(c.group); W.flightCabin = c; c.setSigns(W.signs.belt, W.signs.smoke); return c;
}
function disposeFlightCabin() { const c = W.flightCabin; if (!c) return; aircraft.remove(c.group); c.dispose(); W.flightCabin = null; }
function paContext() {
  const cfg = W.cfg || {}; const fin = cfg.start === 'final'; const A = cfg.apt || W.apt;
  const origin = fin ? (W.dest || A) : A, dest = fin ? A : (atc.arr || W.dest || A);
  const dist = haversine(origin.lat, origin.lon, dest.lat, dest.lon) / NM;
  const temp = Math.round(({ desert: 31, tropical: 29, subtropical: 26, mediterranean: 21, temperate: 13, 'temperate-green': 12, boreal: 4 })[climateFor(dest.lat, dest.lon)] ?? 18) - (W.wx === 'rain' ? 3 : 0);
  return { origin, dest, distNm: dist, cruiseFt: cfg.route?.alt || (dist < 150 ? 24000 : dist < 450 ? 33000 : 37000), destLocalMin: W.tod, localMin: W.tod, temp, wx: W.wx };
}
function moodOf(v) { return v >= 80 ? 'Happy' : v >= 60 ? 'Content' : v >= 40 ? 'Uneasy' : v >= 20 ? 'Nervous' : 'Terrified'; }
function setSigns(belt, smoke, quiet) {
  const ch = belt !== W.signs.belt || smoke !== W.signs.smoke; W.signs.belt = belt; W.signs.smoke = smoke; sys.sw.belts = belt; sys.sw.smoke = smoke;
  if (ch && !quiet) { audio.start(); audio.signDing(); }
  const c = cabinObj(); if (c) c.setSigns(belt, smoke);
  if (ch && !quiet) toast('Seat belt sign ' + (belt ? 'ON' : 'OFF') + (smoke ? '' : ' · no smoking sign off'));
  renderPA();
}
function paSpeak(text, who) { // crew lines that are not in the menu (boarding complete etc.)
  pa.context(paContext()); audio.paBusy = true; clearTimeout(paSpeak._h); paSpeak._h = setTimeout(() => audio.paBusy = false, 2000 + text.length * 75);
  if (settings.voice) pa.announce(null, text); else audio.paChime();
  paLog.push({ who, text }); cabinObj()?.react('listen', Math.min(14, 3 + text.length * 0.05)); renderPA();
}
function paSay(id, custom) {
  audio.start(); pa.context(paContext()); const L = PA_LINES.find(l => l.id === id) || PA_EMERG.find(l => l.id === id);
  if (L && L.sign !== undefined) setSigns(L.sign, W.signs.smoke, true);
  const saved = audio.voice; if (!settings.voice) audio.voice = false;
  const r = pa.announce(custom != null ? null : id, custom != null ? custom : undefined); audio.voice = saved;
  audio.paBusy = true; clearTimeout(paSpeak._h); paSpeak._h = setTimeout(() => audio.paBusy = false, 2000 + r.spokenText.length * 75);
  paLog.push({ who: custom != null ? 'YOU' : L.who === 'crew' ? 'PURSER' : 'CAPTAIN', text: r.text, note: r.note, lang: r.lang });
  const key = custom != null ? 'custom' : id, lastT = CC.cd[key];
  if (lastT != null && W.simTime - lastT < (custom != null ? 20 : 90)) { CC.v = Math.max(0, CC.v - 2); toast('Passengers: “We heard you the first time…”', 3500); }
  else CC.v = Math.min(100, CC.v + (custom != null ? 1.5 : r.boost));
  CC.cd[key] = W.simTime; if (id === 'turbulence') CC.warnT = 150;
  cabinObj()?.react('listen', Math.min(14, 3 + r.spokenText.length * 0.05));
  renderPA();
}
function renderPA() {
  if (!paOpen) return;
  if (!$('#pLines').childElementCount) {
    $('#pLines').innerHTML = PA_LINES.map((l, i) => `<button class="paline" data-id="${l.id}"><kbd>${i + 1}</kbd><span>${l.label}</span><small>${l.who === 'crew' ? 'PURSER' : 'CAPT'}</small></button>`).join('');
    $$('#pLines .paline').forEach(b => b.onclick = () => { paSay(b.dataset.id); canvas.focus(); });
  }
  $$('.palang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.l === pa.lang)));
  $('#pBelt').setAttribute('aria-pressed', String(W.signs.belt)); $('#pSmoke').setAttribute('aria-pressed', String(W.signs.smoke));
  $('#pLog').innerHTML = paLog.slice(-4).map(l => `<div class="rl"><b>${l.who}</b>${esc(l.text)}${l.note ? `<div class="note">${esc(l.note)}</div>` : ''}</div>`).join('') || '<div class="rl"><b>PA</b> Pick an announcement or type your own. Turn the seat belt sign off in cruise and back on for descent; the cabin mood reacts to how you fly and talk.</div>';
  const lg = $('#pLog'); lg.scrollTop = lg.scrollHeight; updateMood();
}
function updateMood() {
  if (!paOpen) return; const v = Math.round(CC.v); const m = $('#pMeter'); m.style.width = v + '%'; m.style.background = v >= 60 ? 'var(--green)' : v >= 35 ? 'var(--amber)' : '#e0564c';
  $('#pMood').textContent = moodOf(v) + ' ' + v + '%';
}
function togglePA(v) { paOpen = v ?? !paOpen; $('#pa').hidden = !paOpen; if (paOpen && radioOpen) toggleRadio(false); renderPA(); }
$('#pClose').onclick = () => { togglePA(false); canvas.focus(); };
$('#pBelt').onclick = () => { setSigns(!W.signs.belt, W.signs.smoke); canvas.focus(); };
$('#pSmoke').onclick = () => { setSigns(W.signs.belt, !W.signs.smoke); canvas.focus(); };
$$('.palang button').forEach(b => b.onclick = () => { pa.lang = b.dataset.l; renderPA(); });
$('#pForm').addEventListener('submit', e => { e.preventDefault(); const t = $('#pText').value.trim(); if (!t) return; paSay(null, t); $('#pText').value = ''; canvas.focus(); });
function gpuConnected() { const gs = Math.hypot(fdm.vel.x, fdm.vel.z); return fdm.onGround && gs < 0.6 && ((W.stand && W.standB && !W.push) || !!W.parkedAt); }
function updateComfort(dt) {
  if (W.menuMode || !W.started || W.mode === 'challenge') return;
  const e = fdm.euler(), bank = Math.abs(e.bank), dg = Math.abs(fdm.nz - 1), vs = fdm.vel.y / FT * 60, agl = fdm.ra / FT;
  let d = 0, why = null;
  if (!fdm.onGround) {
    if (bank > 33) { d -= (bank - 33) * 0.12; why = 'steep bank'; }
    if (e.pitch > 20) { d -= (e.pitch - 20) * 0.15; why = 'steep climb'; }
    if (e.pitch < -7) { d -= (-7 - e.pitch) * 0.2; why = 'nose-down'; }
    if (dg > 0.22) { d -= (dg - 0.22) * (CC.warnT > 0 ? 5 : 12); why = 'bumps'; }
    if (vs < -3800) { d -= 0.6; why = 'fast descent'; }
    if (fdm.stall > 0.25) { d -= 5; why = 'stall warning'; }
    if (!W.signs.belt && (dg > 0.18 || agl < 2500)) { d -= 0.5; why = why || 'belt sign off'; }
  } else { const gs = Math.hypot(fdm.vel.x, fdm.vel.z) / KT; if (fdm.brake > 0.85 && gs > 50) { d -= 0.8; why = 'heavy braking'; } }
  if (d === 0) d = (86 - CC.v) * 0.012;
  CC.v = THREE.MathUtils.clamp(CC.v + d * dt, 0, 100); CC.warnT -= dt; CC.why = why;
  // nudges, once per flight
  const above = fdm.pos.y / FT - (W.cfg?.apt ? airportGeometry(W.cfg.apt).elevFt : 0);
  if (!fdm.onGround && vs > 300 && above > 10000 && W.signs.belt && !CC.hints.up) { CC.hints.up = true; toast('Tip: Y opens the cabin PA. Switch the seat belt sign off and tell the passengers about the cruise.', 7000); }
  if (!fdm.onGround && vs < -300 && agl < 9000 && !W.signs.belt && !CC.hints.dn) { CC.hints.dn = true; toast('Tip: seat belt sign back on for the descent (Y, then 0).', 6000); }
}
function rebase(lat, lon, primary) {
  const ll = W.geo.toLatLon(fdm.pos.x, fdm.pos.z);
  buildWorldAt(lat, lon, primary);
  fdm.pos.x = W.geo.x(ll.lon); fdm.pos.z = W.geo.z(ll.lat);
  if (W.route) { W.route.forEach(w => { w.x = W.geo.x(w.lon); w.z = W.geo.z(w.lat); }); fdm.ap.route = W.route; }
  if (fdm.ap.ils) { const A = fdm.ap.ils.apt; fdm.ap.ils = W.ils = ilsFor(A, fdm.ap.ils.end, aptPos(A)); }
  if (W.primary) { const act = activeRunwayEnd(W.primary); traffic.setup(W.primary.apt, new THREE.Vector3(W.primary.x, W.primary.elev, W.primary.z), W.primary.geom.ends, act); }
  sky.envAge = 1e9; flyby.set = false;
}

// ---------------------------------------------------------------- input
const keys = {}; const inp = { pitch: 0, roll: 0, yaw: 0 }; let mouseYoke = false, mouse = { x: 0, y: 0, dx: 0, dy: 0, drag: false };
const look = { yaw: 0, pitch: -13, fov: 70, target: null }; const orbit = { yaw: 200, pitch: 12, dist: 62 }; const chase = { yaw: 0, pitch: 0, dist: 1 };
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  audio.start(); // a key press is a user gesture: the audio context may start / resume now
  if (!W.started || W.menuMode) return;
  const k = e.key; keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'PageUp', 'PageDown', 'Tab', '/'].includes(k)) e.preventDefault();
  if (e.repeat) return;
  if (W.onFoot) {
    if (e.code === 'KeyE') footInteract();
    if (e.code === 'KeyJ') footSkip();
    if (e.code === 'KeyY') togglePA();
    if (paOpen && /^(Digit|Numpad)\d$/.test(e.code)) paKey(+e.code.slice(-1));
    if (e.code === 'Escape') { if (paOpen) togglePA(false); else togglePause(); }
    return;
  }
  // an open panel is modal for number keys and Esc
  if ((radioOpen || paOpen) && e.code === 'Escape') { if (radioOpen) toggleRadio(false); if (paOpen) togglePA(false); return; }
  if (radioOpen && /^(Digit|Numpad)\d$/.test(e.code)) { const n = +e.code.slice(-1); const o = n ? atc.options()[n - 1] : null; if (o) atc.choose(o.id); return; }
  if (paOpen && /^(Digit|Numpad)\d$/.test(e.code)) { paKey(+e.code.slice(-1)); return; }
  if (W.view === 'cockpit' && /^Digit[089]$/.test(e.code)) { quickLook(+e.code.slice(5)); return; }
  if (/^Digit[089]$/.test(e.code)) return; // quick looks only exist on the flight deck
  if (e.code === 'KeyY') { togglePA(); return; }
  if (e.code === 'KeyT' && !e.shiftKey) { toggleRadio(); return; }
  if (e.code === 'Enter') { parkPromptAction(); return; }
  if (e.code === 'KeyU') { if (!W.onFoot && !handFly()) toast(W.hand ? 'You are already hand-flying' : 'Hand-flying is offered on an ILS approach (inside 18 nm)'); return; }
  if (e.code === 'KeyK') { if (W.standB && fdm.onGround && !W.push) startPushback(); return; }
  const ap = fdm.ap;
  switch (e.code) {
    case 'KeyG': fdm.setGear(!fdm.gearDown); if (fdm.onGround && !fdm.gearDown) toast('Gear cannot retract on the ground'); break;
    case 'KeyF': fdm.setFlaps(fdm.flapIdx + 1); toast('Flaps ' + FLAPS[fdm.flapIdx].name); break;
    case 'KeyV': fdm.setFlaps(fdm.flapIdx - 1); toast('Flaps ' + FLAPS[fdm.flapIdx].name); break;
    case 'Space': fdm.parkBrake = !fdm.parkBrake; toast('Parking brake ' + (fdm.parkBrake ? 'set' : 'released')); break;
    case 'KeyR': if (fdm.onGround) { fdm.revCmd = !fdm.revCmd; if (fdm.revCmd) fdm.tl = 0; toast(fdm.revCmd ? 'Reversers deployed' : 'Reversers stowed'); } break;
    case 'Slash': fdm.speedbrake = fdm.speedbrake >= 1 ? 0 : fdm.speedbrake + 0.5; toast('Speed brake ' + Math.round(fdm.speedbrake * 100) + '%'); break;
    case 'KeyZ': if (e.shiftKey) { ap.athr = !ap.athr; if (ap.athr) ap.spd = Math.round(fdm.ias); toast('A/THR ' + (ap.athr ? 'on' : 'off')); } else toggleAP(); break;
    case 'KeyO': armAppr(); break;
    case 'KeyL': { const on = !(sys.sw.landL || sys.sw.landR); sys.sw.landL = sys.sw.landR = on; sys.touched.landL = sys.touched.landR = true; toast('Landing lights ' + (on ? 'on' : 'off')); break; }
    case 'KeyH': if (W.view === 'cockpit' || W.view === 'cabin') { settings.hud = !settings.hud; break; } settings.hud = true; settings.extHud = settings.extHud === 'full' ? 'min' : 'full'; store.set('settings', settings); layoutOverlays(); toast(settings.extHud === 'full' ? 'Full HUD + PFD' : 'Clean HUD (H for the full one)'); break;
    case 'KeyC': setView(VIEWS[(VIEWS.indexOf(W.view) + 1) % VIEWS.length]); break;
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': case 'Digit6': setView(VIEWS[+e.code.slice(5) - 1]); break;
    case 'Digit7': if (W.view === 'cabin') { cabLook.rear = !cabLook.rear; cabLook.yaw = cabLook.rear ? 0 : 180; cabLook.pitch = -6; } else setView('cabin'); break;
    case 'KeyP': W.paused = !W.paused; toast(W.paused ? 'Paused' : 'Resumed'); break;
    case 'Escape': togglePause(); break;
    case 'KeyM': mouseYoke = !mouseYoke; $('#yoke').hidden = !mouseYoke; toast('Mouse yoke ' + (mouseYoke ? 'on (move the mouse from the centre)' : 'off')); break;
    case 'KeyN': ndOverlay = !ndOverlay; layoutOverlays(); break;
    case 'Period': W.timeAccel = Math.min(16, W.timeAccel * 2); toast('Time ×' + W.timeAccel); break;
    case 'Comma': W.timeAccel = Math.max(1, W.timeAccel / 2); toast('Time ×' + W.timeAccel); break;
    case 'KeyT': if (e.shiftKey) { fdm.tl = 1; ap.athr = false; toast('TOGA'); } break;
    case 'KeyB': break;
    case 'KeyJ': { const s = nextStep(); if (s && s.run) { audio.start(); s.run(); toast(s.label, 2500); } else toast(s ? s.label : 'Nothing to do right now', 2000); break; } // smart next step on the keyboard (checklists, ATC, ECAM actions)
  }
  if (k === '?') $('#help').hidden = !$('#help').hidden;
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
canvas.addEventListener('mousedown', e => { mouse.drag = true; mouse.lx = e.clientX; mouse.ly = e.clientY; mouse.dx0 = e.clientX; mouse.dy0 = e.clientY; mouse.t0 = performance.now(); canvas.focus(); audio.start(); if (W.onFoot) { try { const r = canvas.requestPointerLock && canvas.requestPointerLock(); r && r.catch && r.catch(() => { }); } catch (err) { } } });
const footLook = { dx: 0, dy: 0 };
addEventListener('mouseup', e => { mouse.drag = false;
  if (e.target === canvas && W.view === 'cockpit' && !W.onFoot && Math.hypot(e.clientX - (mouse.dx0 ?? -99), e.clientY - (mouse.dy0 ?? -99)) < 5 && performance.now() - mouse.t0 < 600) { const c = pickControl(e.clientX, e.clientY); if (c) { cockpit.userData.click(c, deckCtx(), e.shiftKey || e.button === 2 ? -1 : 1); showTip(e.clientX, e.clientY); } } });
addEventListener('mousemove', e => {
  mouse.x = (e.clientX / innerWidth) * 2 - 1; mouse.y = (e.clientY / innerHeight) * 2 - 1;
  if (mouseYoke) { const y = $('#yoke'); y.style.left = e.clientX + 'px'; y.style.top = e.clientY + 'px'; }
  if (W.onFoot) { if (document.pointerLockElement === canvas) { footLook.dx += e.movementX; footLook.dy += e.movementY; } else if (mouse.drag) { footLook.dx += e.clientX - mouse.lx; footLook.dy += e.clientY - mouse.ly; mouse.lx = e.clientX; mouse.ly = e.clientY; } return; }
  if (!mouse.drag) { if (W.view === 'cockpit' && performance.now() - tipT > 60) { tipT = performance.now(); showTip(e.clientX, e.clientY); } return; } const dx = e.clientX - mouse.lx, dy = e.clientY - mouse.ly; mouse.lx = e.clientX; mouse.ly = e.clientY;
  if (W.view === 'cabin') { cabLook.yaw -= dx * 0.2; cabLook.pitch = THREE.MathUtils.clamp(cabLook.pitch - dy * 0.2, -50, 40); }
  else if (W.view === 'cockpit') { look.target = null; look.yaw = THREE.MathUtils.clamp(look.yaw - dx * 0.2, -150, 150); look.pitch = THREE.MathUtils.clamp(look.pitch - dy * 0.2, -70, 75); }
  else if (W.view === 'chase') { chase.yaw -= dx * 0.3; chase.pitch = THREE.MathUtils.clamp(chase.pitch + dy * 0.2, -10, 60); }
  else { orbit.yaw -= dx * 0.3; orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.25, -8, 85); }
});
canvas.addEventListener('wheel', e => { e.preventDefault(); const s = Math.sign(e.deltaY);
  if (W.view === 'cockpit') { const c = pickControl(e.clientX, e.clientY); if (c && cockpit.userData.wheel(c, deckCtx(), -s)) { showTip(e.clientX, e.clientY); return; } }
  if (W.view === 'cabin') cabLook.fov = THREE.MathUtils.clamp(cabLook.fov + s * 4, 30, 90); else if (W.view === 'cockpit') look.fov = THREE.MathUtils.clamp(look.fov + s * 4, 25, 80); else if (W.view === 'chase') chase.dist = THREE.MathUtils.clamp(chase.dist * (1 + s * 0.1), 0.45, 4); else orbit.dist = THREE.MathUtils.clamp(orbit.dist * (1 + s * 0.1), 25, 900); }, { passive: false });
canvas.addEventListener('dblclick', () => { if (W.view === 'cockpit') { look.yaw = 0; look.pitch = -13; look.fov = 70; look.target = null; } });

// ---------------------------------------------------------------- Xbox controller: menus by pad, flying layout, smart next step, help overlay, rumble
let padTick = 0, padUIActive = false, navEl = null, navIdx = 0, padHelpOn = false, padHelpUntil = 0, rumT = 0;
function padPoll(dt) { if (pad._tick === padTick) return pad.gp; pad._tick = padTick; return pad.poll(dt); }
function padRoot() {
  const vis = s => { const e = $(s); return e && !e.hidden ? e : null; };
  return vis('#result') || vis('#help') || vis('#pause') || (paOpen ? $('#pa') : null) || (radioOpen ? $('#radio') : null) || (W.menuMode ? vis('#menu') : null);
}
function setNav(el) { if (navEl === el) return; if (navEl) navEl.classList.remove('padfocus'); navEl = el; if (el) { el.classList.add('padfocus'); try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { } } }
function navStep(els, cur, d) {
  const r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let best = null, bs = 1e9;
  for (const e of els) { if (e === cur) continue; const q = e.getBoundingClientRect(); const x = q.left + q.width / 2 - cx, y = q.top + q.height / 2 - cy;
    const along = d === 'U' ? -y : d === 'D' ? y : d === 'L' ? -x : x, perp = d === 'U' || d === 'D' ? Math.abs(x) : Math.abs(y); if (along < 4) continue; const sc = along + perp * 2.2; if (sc < bs) { bs = sc; best = e; } }
  return best;
}
// menus, dialogs and the ATC / PA panels: d-pad or left stick moves, A selects, B backs out
function padUI(dt) {
  padUIActive = false; if (!pad.gp) return false;
  if (W.padCapture) { for (let i = 0; i < 16; i++) if (pad.down(i)) { assignPad(W.padCapture, i); return (padUIActive = true); } }
  const root = padRoot(); if (!root) { setNav(null); return false; }
  padUIActive = true;
  if (root.id === 'pause' && pad.down(BTN.MENU)) { togglePause(); return true; }
  const els = [...root.querySelectorAll('button, input[type=range], input[type=checkbox], select')].filter(e => !e.disabled && e.offsetParent !== null && e.getBoundingClientRect().width > 0);
  if (!els.length) return true;
  if (!navEl || !els.includes(navEl)) { const first = root.id === 'radio' ? els.find(e => e.classList.contains('ropt')) : root.id === 'pa' ? els.find(e => e.classList.contains('paline')) : null; setNav(first || els[Math.max(0, Math.min(navIdx, els.length - 1))]); }
  navIdx = els.indexOf(navEl);
  const d = pad.repeat(BTN.UP, dt) ? 'U' : pad.repeat(BTN.DOWN, dt) ? 'D' : pad.repeat(BTN.LEFT, dt) ? 'L' : pad.repeat(BTN.RIGHT, dt) ? 'R' : pad.stickDir(dt);
  if (d) { if (navEl.type === 'range' && (d === 'L' || d === 'R')) { const st = +navEl.step || 1; navEl.value = +navEl.value + (d === 'R' ? st : -st); navEl.dispatchEvent(new Event('input', { bubbles: true })); navEl.dispatchEvent(new Event('change', { bubbles: true })); } else { const nb = navStep(els, navEl, d); if (nb) setNav(nb); } }
  if (pad.down(BTN.A)) { audio.start(); if (navEl.tagName === 'SELECT') { navEl.selectedIndex = (navEl.selectedIndex + 1) % navEl.options.length; navEl.dispatchEvent(new Event('change', { bubbles: true })); } else navEl.click(); }
  if (pad.down(BTN.B)) { if (root.id === 'help') $('#helpClose').click(); else if (root.id === 'pause') togglePause(); else if (root.id === 'pa') togglePA(false); else if (root.id === 'radio') toggleRadio(false); }
  if (root.id === 'pa' && pad.down(BTN.X)) setSigns(!W.signs.belt, W.signs.smoke);
  if (root.id === 'pa' && pad.down(BTN.Y)) { const L = ['en', 'es', 'ko']; pa.lang = L[(L.indexOf(pa.lang) + 1) % 3]; renderPA(); }
  return true;
}
// flying: left stick flies (steers on the ground), right stick looks, triggers thrust, B brakes, LB/RB flaps, hold LB = shift layer
function padFlight(dt) {
  const a = pad.axes, pinv = settings.padInvert === '1' ? -1 : 1, P = k => pad.phys(k), out = { fly: !!(a[0] || a[1]), tr: a[0], tp: a[1] * pinv, ty: fdm.onGround ? a[0] : 0 };
  const rt = pad.val[BTN.RT], lt = pad.val[BTN.LT], gsKt = Math.hypot(fdm.vel.x, fdm.vel.z) / KT;
  if (fdm.onGround && gsKt > 40 && fdm.tl < 0.03 && lt > 0.35 && !fdm.revCmd) { fdm.revCmd = true; W.padRev = true; toast('Reverse thrust'); }
  if (W.padRev && fdm.revCmd) { if (lt < 0.08) { fdm.revCmd = false; W.padRev = false; fdm.tl = 0; } else fdm.tl = lt; }
  else if (rt > 0.06 || lt > 0.06) { fdm.tl = THREE.MathUtils.clamp(fdm.tl + (rt * 0.5 - lt * 0.6) * dt, 0, 1); if (fdm.ap.athr) { fdm.ap.athr = false; toast('A/THR off (manual thrust)'); } }
  padLook(dt, a[2], a[3]); if (pad.down(BTN.RS)) padRecentre();
  const lb = P('flapsUp');
  if (pad.held(lb)) {
    const sh = (b, f) => { if (pad.down(b)) { pad.markUsed(lb); f(); } };
    sh(P('next'), () => { fdm.setGear(!fdm.gearDown); if (fdm.onGround && !fdm.gearDown) { fdm.setGear(true); toast('Gear cannot retract on the ground'); } else toast('Gear ' + (fdm.gearDown ? 'down' : 'up')); });
    sh(P('atc'), () => toggleAP());
    sh(P('brake'), () => { if (fdm.onGround) { fdm.spoilersArmed = !fdm.spoilersArmed; toast('Ground spoilers ' + (fdm.spoilersArmed ? 'armed' : 'disarmed')); } else { fdm.speedbrake = fdm.speedbrake >= 1 ? 0 : fdm.speedbrake + 0.5; toast('Speed brake ' + Math.round(fdm.speedbrake * 100) + '%'); } });
    sh(P('pa'), () => { const on = !(sys.sw.landL || sys.sw.landR); sys.sw.landL = sys.sw.landR = on; sys.touched.landL = sys.touched.landR = true; toast('Landing lights ' + (on ? 'on' : 'off')); });
  } else {
    if (pad.down(P('next'))) doNextStep();
    if (pad.down(P('atc'))) toggleRadio(true);
    if (pad.down(P('pa'))) togglePA(true);
  }
  if (pad.tap(lb, 0.35)) { fdm.setFlaps(fdm.flapIdx - 1); toast('Flaps ' + FLAPS[fdm.flapIdx].name); }
  if (pad.down(P('flapsDown'))) { fdm.setFlaps(fdm.flapIdx + 1); toast('Flaps ' + FLAPS[fdm.flapIdx].name); }
  if (pad.down(BTN.UP)) setView('cockpit'); if (pad.down(BTN.DOWN)) setView('chase');
  if (pad.down(BTN.LEFT)) setView(VIEWS[(VIEWS.indexOf(W.view) + VIEWS.length - 1) % VIEWS.length]); if (pad.down(BTN.RIGHT)) setView(VIEWS[(VIEWS.indexOf(W.view) + 1) % VIEWS.length]);
  if (pad.long(BTN.VIEW, 0.6)) togglePadHelp(); else if (pad.tap(BTN.VIEW, 0.5)) setView(VIEWS[(VIEWS.indexOf(W.view) + 1) % VIEWS.length]);
  if (pad.down(BTN.MENU)) togglePause();
  return out;
}
function onDepRunway() {
  const il = W.depIls; if (!il) return false; const d = ilsDeviation(il, fdm.pos); const E = il.end || W.end; if (!E) return false;
  const hd = Math.abs(((fdm.euler().hdg - E.hdg + 540) % 360) - 180); return Math.abs(d.cross) < 15 && d.thrDist < 40 && d.thrDist > -(il.length || 2500) + 900 && hd < 15;
}
// the smart A button: whatever the next sensible thing is
function nextStep() {
  if (W.menuMode || W.onFoot || !W.started) return null;
  const f = fdm, gs = Math.hypot(f.vel.x, f.vel.z) / KT, eng = f.engRun[0] && f.engRun[1], agl = (f.pos.y - (f.gnd?.h || 0)) / FT, vs = f.vel.y / FT * 60;
  const opts = atc.options(), o = opts.find(x => x.pri), atcStep = o ? { label: o.label, run: () => atc.choose(o.id) } : null;
  if (f.onGround) {
    if (W.parkedAt) return { label: 'Stand up and walk out', run: () => enterFoot('arr') };
    { const fa = fails.nextAction(); if (fa) return fa; }
    if (gs < 3 && fdm.td && !W.evac && (fdm.belly || sys.fire[0].on || sys.fire[1].on || (atc.flags.emer && fails.emergency === 'mayday'))) return { label: 'Evacuate the aircraft', run: evacuate };
    if (W.autoStart) return { label: (AUTOSTART[Math.min(W.autoStart.i, AUTOSTART.length - 1)][0]) + '…', run: null };
    if (atcStep && ['rb', 'ho', 'clr', 'push'].includes(o.id)) return atcStep;
    if (!eng) return { label: 'Start engines', run: startEngines };
    if (W.push && !W.push.done) return { label: 'Pushback in progress…', run: null };
    if (f.td && gs < 4) { const st = nearestFreeStand(120); if (st) return { label: 'Park at gate ' + (st.gateName || ''), run: () => parkAtGate(st) }; }
    if (onDepRunway() && f.tl < 0.6 && !f.td) return { label: 'Take off: brakes off, takeoff thrust', run: () => { f.parkBrake = false; if (f.flapIdx === 0) f.setFlaps(1); f.tl = 1; f.ap.athr = false; f.spoilersArmed = true; toast('Takeoff thrust. At VR pull the left stick back gently.', 5000); } };
    if (atcStep) return atcStep;
    if (W.taxiR && W.taxiR.pts && !W.autoTaxi && gs < 30) return { label: 'Auto-taxi along the route', run: () => { W.autoTaxi = { pts: W.taxiR.pts.slice(1), i: 0, speed: 9 }; toast('Auto-taxi engaged'); } };
    if (f.parkBrake && gs < 1) return { label: 'Release the parking brake', run: () => { f.parkBrake = false; toast('Parking brake released'); } };
    return null;
  }
  if (f.gearDown && vs > 400 && agl > 50 && agl < 4000) return { label: 'Gear up', run: () => { f.setGear(false); } };
  { const fa = fails.nextAction(); if (fa) return fa; }
  if (fails.emergency && !atc.flags.emer && agl > 300) return { label: 'Radio: declare ' + (fails.emergency === 'mayday' ? 'MAYDAY' : 'PAN-PAN'), run: () => atc.choose(fails.emergency) };
  if (atc.flags.emer && !W.emergPA && agl > 1500) return { label: 'PA: brief the cabin for the emergency', run: () => { W.emergPA = true; paSay('emerg'); } };
  if (fails.has('gear') && f.gearPos < 0.5 && agl < 1100 && agl > 150 && !W.braced) return { label: 'PA: “Brace! Brace! Brace!”', run: () => { W.braced = true; paSay('brace'); } };
  if (f.flapIdx > 0 && vs > 300 && agl > 1000 && f.ias > 185) return { label: 'Flaps ' + FLAPS[f.flapIdx - 1].name, run: () => { f.setFlaps(f.flapIdx - 1); toast('Flaps ' + FLAPS[f.flapIdx].name); } };
  if (!f.ap.on && agl > 1200 && vs > -800) return { label: 'Autopilot on', run: () => { f.ap.hdg = Math.round(f.euler().hdg); if (!f.ap.alt || Math.abs(f.ap.alt - f.pos.y / FT) > 30000) f.ap.alt = Math.round(f.pos.y / FT / 100) * 100; toggleAP(); if (!f.ap.athr) { f.ap.athr = true; f.ap.spd = f.ap.spd || Math.round(f.ias); } } };
  if (W.ils) {
    const d = ilsDeviation(W.ils, f.pos), nm = d.thrDist / NM;
    if (nm > 0 && nm < 30 && W.ils !== W.depIls || (W.cfg?.start === 'final' && nm > 0)) {
      if (f.ap.on && !(f.ap.appr || f.ap.lat === 'LOC')) return { label: 'Arm the ILS approach', run: () => armAppr() };
      if (f.ap.on && nm < 14 && handFlyAvailable()) return { label: 'Hand-fly the landing (AP off)', run: handFly };
      if (nm < 15 && f.flapIdx < 4 && f.ias < FLAPS[f.flapIdx + 1].vfe - 6) return { label: 'Flaps ' + FLAPS[f.flapIdx + 1].name, run: () => { f.setFlaps(f.flapIdx + 1); toast('Flaps ' + FLAPS[f.flapIdx].name); } };
      if (nm < 9 && !f.gearDown) return { label: 'Gear down', run: () => f.setGear(true) };
      if (nm < 12 && !f.spoilersArmed) return { label: 'Arm ground spoilers', run: () => { f.spoilersArmed = true; toast('Ground spoilers armed'); } };
      if (nm < 12 && !f.autobrake) return { label: 'Autobrake MED', run: () => { f.autobrake = 2; toast('Autobrake MED'); } };
    }
  }
  return atcStep;
}
function doNextStep() { const s = nextStep(); if (s && s.run) { audio.start(); s.run(); } }
function togglePadHelp() { padHelpOn = !padHelpOn; padHelpUntil = 0; updatePadHUD(true); }
let padHudT = 0;
function updatePadHUD(force) {
  padHudT += 1; if (!force && padHudT % 8) return;
  const nx = $('#padNext'), hp = $('#padHelp'); if (!nx || !hp) return; const act = pad.gp && pad.active && W.started && !W.menuMode;
  let label = null; if (act && !padUIActive) { if (W.onFoot) { const p = foot.prompt || ''; label = /^E\s+/.test(p) ? p.replace(/^E\s+/, '') : null; } else { const s = nextStep(); label = s ? s.label : null; } }
  const html = label ? glyph(pad.phys('next')) + ' ' + esc(label) : ''; if (nx._h !== html) { nx._h = html; nx.innerHTML = html; nx.hidden = !html; }
  const show = act && (padHelpOn || padT() < padHelpUntil); const ctx = !show ? '' : padUIActive ? 'panel' : W.onFoot ? 'foot' : 'fly';
  if (hp._c !== ctx + (label || '')) { hp._c = ctx + (label || ''); hp.hidden = !show; if (show) hp.innerHTML = padHelpHTML(ctx, label); }
  const pp = $('#parkPrompt'); if (pp && act && !pp.hidden) pp.hidden = true;
}
function padT() { return pad.t; }
function padHelpHTML(ctx, label) {
  const g = glyph, P = k => g(pad.phys(k)), row = (k, t) => `<div><span>${k}</span><span>${t}</span></div>`;
  if (ctx === 'panel') return `<b>Controller</b>${row(g('↑') + g('↓') + ' / ' + g('LS'), 'Choose')}${row(g('A'), 'Select')}${row(g('B'), 'Close / back')}${paOpen ? row(g('X'), 'Seat belt sign') + row(g('Y'), 'Language') : ''}`;
  if (ctx === 'foot') return `<b>Controller · on foot</b>${row(g('LS'), 'Walk')}${row(g('RS'), 'Look')}${row(g('RT'), 'Run')}${row(g('A'), label || 'Interact')}${row(g('Y'), 'Skip ahead')}${row(g('X'), 'Cabin PA')}${row(g('Menu'), 'Pause')}`;
  return `<b>Controller · ${({ easy: 'Easy', normal: 'Normal', realistic: 'Realistic' })[settings.padAssist || 'easy']} assist</b>${row(g('LS'), fdm.onGround ? 'Fly / steer on the ground' : 'Fly (let go: holds attitude)')}${row(g('RS'), 'Look around · press to recentre')}${row(g('RT') + g('LT'), 'Thrust up / down (LT on landing roll: reverse)')}${row(P('next'), label || 'Next step')}${row(P('brake'), 'Brakes (hold)')}${row(P('atc'), 'ATC radio menu')}${row(P('pa'), 'Cabin PA menu')}${row(P('flapsUp') + P('flapsDown'), 'Flaps up / down')}${row('hold ' + P('flapsUp') + ' +', P('next') + ' gear ' + P('atc') + ' autopilot ' + P('brake') + ' spoilers ' + P('pa') + ' lights')}${row(g('↑') + g('↓') + g('←') + g('→'), 'Flight deck · chase · views')}${row(g('View'), 'Camera · hold for this help')}${row(g('Menu'), 'Pause')}`;
}
function padRumble(dt) {
  if (!pad.gp || !pad.cfg.rumble || W.menuMode || W.paused || W.onFoot) return; rumT -= dt; if (rumT > 0) return; rumT = 0.12;
  const gs = Math.hypot(fdm.vel.x, fdm.vel.z) / KT; let strong = 0, weak = 0;
  if (fdm.onGround && gs > 5) { weak = Math.min(0.35, gs / 300) * (0.6 + Math.random() * 0.4); if (Math.random() < gs / 1500) strong = 0.22; }
  if (fdm.stall > 0.25 && !fdm.onGround) { strong = Math.max(strong, 0.5); weak = 0.9; }
  for (const e of sys.eng) if (e.st === 'start') weak = Math.max(weak, 0.1 + 0.15 * Math.random());
  if (strong || weak) pad.rumble(strong, weak, 150);
}
// controller settings: remap a button by pressing it
function assignPad(action, btn) {
  const map = Object.assign({}, pad.cfg.map); const old = pad.phys(action);
  for (const k in ACTIONS) if (k !== action && pad.phys(k) === btn) map[k] = old;
  map[action] = btn; pad.cfg.map = map; settings.padMap = map; store.set('settings', settings); W.padCapture = null; renderPadMap(); toast(ACTIONS[action][0] + ': ' + btnName(btn));
}
function renderPadMap() {
  const el = $('#padMap'); if (!el) return;
  el.innerHTML = Object.keys(ACTIONS).map(k => `<div class="pmrow"><span>${ACTIONS[k][0]}</span><span>${W.padCapture === k ? '<i>press a button…</i>' : glyph(pad.phys(k))}</span><button class="go ghost" data-k="${k}">${W.padCapture === k ? 'Cancel' : 'Change'}</button></div>`).join('') + '<div class="pmrow"><span></span><span></span><button class="go ghost" id="padMapReset">Reset</button></div>';
  el.querySelectorAll('button[data-k]').forEach(b => b.onclick = () => { W.padCapture = W.padCapture === b.dataset.k ? null : b.dataset.k; renderPadMap(); });
  $('#padMapReset').onclick = () => { pad.cfg.map = {}; settings.padMap = {}; store.set('settings', settings); W.padCapture = null; renderPadMap(); };
}
function pollInput(dt) {
  const inv = settings.invert === '1' ? -1 : 1;
  let tp = 0, tr = 0, ty = 0;
  if (keys.ArrowUp || keys.KeyW) tp -= inv; if (keys.ArrowDown || keys.KeyS) tp += inv;
  if (keys.ArrowLeft || keys.KeyA) tr -= 1; if (keys.ArrowRight || keys.KeyD) tr += 1;
  if (keys.KeyQ) ty -= 1; if (keys.KeyE) ty += 1;
  if (mouseYoke) { const s = settings.mouseSens; const dz = v => Math.abs(v) < 0.04 ? 0 : (v - Math.sign(v) * 0.04) / 0.96; tr = THREE.MathUtils.clamp(dz(mouse.x) * 1.6 * s, -1, 1); tp = THREE.MathUtils.clamp(dz(mouse.y) * 1.6 * s, -1, 1) * inv; }
  // gamepad: flying layout in padFlight(); menus / panels are handled by padUI() (see the controller section)
  if (tp || tr || ty || mouseYoke) W.lastDev = 'kb'; // the assist level follows the device last used to fly, not a 30 s timeout
  const gp = padPoll(dt); if (gp && pad.t - pad.lastInput < 0.001) W.lastDev = 'pad';
  if (gp && W.onFoot) { if (!padUIActive) { if (pad.down(BTN.A)) footInteract(); if (pad.down(BTN.Y)) footSkip(); if (pad.down(BTN.X)) togglePA(true); if (pad.down(BTN.MENU)) togglePause(); if (pad.long(BTN.VIEW)) togglePadHelp(); } }
  else if (gp && !padUIActive) { const r = padFlight(dt); if (r.fly) { tr = r.tr; tp = r.tp; } if (r.ty) ty = r.ty; }
  fdm.assist = pad.gp && W.lastDev === 'pad' ? (settings.padAssist || 'easy') : 'normal';
  if (testInput) { tp = testInput.pitch ?? tp; tr = testInput.roll ?? tr; ty = testInput.yaw ?? ty; }
  const ramp = (cur, tgt, r) => cur + THREE.MathUtils.clamp(tgt - cur, -r * dt, r * dt);
  inp.pitch = ramp(inp.pitch, tp, tp ? 2.2 : 4); inp.roll = ramp(inp.roll, tr, tr ? 3 : 5); inp.yaw = ramp(inp.yaw, ty, 3);
  fdm.in.pitch = inp.pitch; fdm.in.roll = inp.roll; fdm.in.yaw = inp.yaw;
  // throttle & brakes
  const shiftThr = (keys.ShiftLeft || keys.ShiftRight) && !keys.Enter && !keys.NumpadEnter && !keys.KeyT && !keys.KeyZ && !mouse.drag; // Shift+Enter / Shift+T / Shift+Z / Shift+click are not thrust
  const up = keys.PageUp || keys.Equal || keys.NumpadAdd || shiftThr, dn = keys.PageDown || keys.Minus || keys.NumpadSubtract || keys.KeyX;
  if (up && !keys.KeyZ) { fdm.tl = Math.min(1, fdm.tl + dt * 0.45); if (fdm.ap.athr) { fdm.ap.athr = false; toast('A/THR off (manual thrust)'); } }
  if (dn) { fdm.tl = Math.max(0, fdm.tl - dt * 0.55); if (fdm.ap.athr) { fdm.ap.athr = false; toast('A/THR off (manual thrust)'); } }
  // wheel brakes: held = on, released = off (keyboard B or pad B)
  const brakeIn = !!keys.KeyB || (!!gp && !W.onFoot && !padUIActive && pad.held(pad.phys('brake')) && !pad.held(pad.phys('flapsUp')));
  if (brakeIn && fdm.autobrake && fdm.onGround) { fdm.autobrake = 0; toast('Autobrake disarmed'); }
  if (!fdm.autobrake) fdm.brake = THREE.MathUtils.clamp(fdm.brake + (brakeIn ? 3 : -4) * dt, 0, 1);
  if (keys.BracketLeft) fdm.trim = Math.max(-4, fdm.trim - dt * 0.8); if (keys.BracketRight) fdm.trim = Math.min(13, fdm.trim + dt * 0.8);
}
let testInput = null;
// right stick looks around (rate), R3 recentres
function padLook(dt, rx, ry) {
  if (!rx && !ry) return; const v = W.view;
  if (v === 'cockpit') { look.target = null; look.yaw = THREE.MathUtils.clamp(look.yaw - rx * 130 * dt, -150, 150); look.pitch = THREE.MathUtils.clamp(look.pitch - ry * 90 * dt, -70, 75); }
  else if (v === 'cabin') { cabLook.yaw -= rx * 110 * dt; cabLook.pitch = THREE.MathUtils.clamp(cabLook.pitch - ry * 70 * dt, -50, 40); }
  else if (v === 'chase') { chase.yaw -= rx * 110 * dt; chase.pitch = THREE.MathUtils.clamp(chase.pitch + ry * 60 * dt, -10, 60); }
  else { orbit.yaw -= rx * 110 * dt; orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + ry * 70 * dt, -8, 85); }
}
function padRecentre() { const v = W.view; if (v === 'cockpit') look.target = LOOKS.fwd; else if (v === 'cabin') { cabLook.yaw = cabLook.rear ? 0 : 180; cabLook.pitch = -6; } else if (v === 'chase') { chase.yaw = 0; chase.pitch = 0; } else { orbit.yaw = 200; orbit.pitch = 12; } }
function toggleAP() {
  const ap = fdm.ap;
  if (ap.on) { fdm.disconnectAP('pilot'); return; }
  if (fdm.onGround || fdm.ra < 30) { toast('Autopilot engages above 100 ft after takeoff'); return; }
  if (fdm.fail.noAP) { toast('Autopilot unavailable: electrical emergency configuration. Start the APU.'); return; }
  ap.on = true; ap.flare = false; ap.retard = false; ap.rollout = false; const e = fdm.euler();
  if (ap.lat !== 'NAV' && ap.lat !== 'LOC') { ap.lat = 'HDG'; ap.hdg = Math.round(e.hdg); }
  if (!['G/S', 'FLARE'].includes(ap.vert)) { ap.vert = 'ALT'; if (Math.abs(ap.alt - fdm.pos.y / FT) > 6000) ap.alt = Math.round(fdm.pos.y / FT / 100) * 100; }
  audio.chime(); toast('AP1 engaged');
}
function armAppr() {
  // pick the best-aligned runway end ahead within 40 km
  let best = W.ils, bs = 1e9;
  for (const b of W.built) for (const E of b.geom.ends) {
    const il = ilsFor(b.apt, E, new THREE.Vector3(b.x, b.elev, b.z)); const d = ilsDeviation(il, fdm.pos); if (!d.valid || d.along > 45000) continue;
    const s = Math.abs(d.loc) * 3 + d.along / 2000 + Math.abs(((fdm.euler().hdg - E.hdg + 540) % 360) - 180) * 0.3; if (s < bs) { bs = s; best = il; }
  }
  if (!best) { toast('No runway ahead to approach'); return; }
  W.ils = fdm.ap.ils = best; fdm.ap.locArmed = true; fdm.ap.gsArmed = true; fdm.ap.appr = true; if (!fdm.ap.on && !fdm.onGround) toggleAP();
  toast(`APPR armed: ${best.apt.icao} ILS ${best.ident} ${best.freq.toFixed(2)}${best.real ? '' : ' (simulated)'}`);
}
const lights = { nav: true, beacon: true, strobe: false, landing: false, taxi: false, logo: true };

// ---------------------------------------------------------------- cameras
const VIEWS = ['cockpit', 'chase', 'orbit', 'tower', 'runway', 'flyby', 'cabin'];
const VIEW_NAMES = { cockpit: 'Flight deck', chase: 'Chase', orbit: 'Free orbit', tower: 'Tower', runway: 'Runway', flyby: 'Fly-by', cabin: 'Cabin (7 front/rear)' };
const cabLook = { yaw: 180, pitch: -6, fov: 70, rear: false };
const CAB_EYE = [new THREE.Vector3(0.0, 1.0, -11.8), new THREE.Vector3(-0.2, 1.02, 11.7)];
const flyby = { set: false, p: new THREE.Vector3() };
let chasePos = null;
function setView(v) { if (v === 'cabin' && !ensureCabin()) v = 'cockpit'; W.view = v; flyby.set = false; chasePos = null; $('#camname').textContent = VIEW_NAMES[v] + '  ·  C to cycle'; layoutOverlays(); }
let ndOverlay = false;
function layoutOverlays() {
  const wrap = $('#pfdwrap'); wrap.innerHTML = '';
  if (W.view !== 'cockpit' && W.view !== 'cabin') { if (settings.extHud === 'full') wrap.appendChild(displays.pfd); if (ndOverlay) wrap.appendChild(displays.nd); }
}
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
function updateCamera(dt) {
  const acp = aircraft.position; const v = W.view;
  cockpit.visible = v === 'cockpit' || (W.onFoot && ['cockpit', 'ckdoor', 'entry', 'aisle', 'door'].includes(foot.zoneTag()));
  if (W.onFoot) { if (camera.view && camera.view.enabled) { camera.clearViewOffset(); camera.aspect = innerWidth / innerHeight; } return; } aircraft.userData.parts && (aircraft.children[0].visible = true);
  camera.near = v === 'cockpit' ? 0.08 : 0.5;
  if (v === 'cabin') { camera.near = 0.05;
    camera.position.copy(CAB_EYE[cabLook.rear ? 1 : 0]).applyQuaternion(aircraft.quaternion).add(acp);
    _e.set(cabLook.pitch * D2R, cabLook.yaw * D2R, 0, 'YXZ'); _q.setFromEuler(_e); camera.quaternion.copy(aircraft.quaternion).multiply(_q); camera.fov = cabLook.fov;
  } else if (v === 'cockpit') {
    if (look.target) { const k = 1 - Math.exp(-dt * 7); look.yaw += (look.target.yaw - look.yaw) * k; look.pitch += (look.target.pitch - look.pitch) * k; if (Math.abs(look.target.yaw - look.yaw) + Math.abs(look.target.pitch - look.pitch) < 0.3) { look.yaw = look.target.yaw; look.pitch = look.target.pitch; } }
    camera.position.copy(COCKPIT_EYE).add(headMotion(dt)).applyQuaternion(aircraft.quaternion).add(acp);
    _e.set(look.pitch * D2R, look.yaw * D2R, 0, 'YXZ'); _q.setFromEuler(_e);
    camera.quaternion.copy(aircraft.quaternion).multiply(_q); camera.fov = look.fov;
  } else if (v === 'chase') {
    const e = fdm.euler(); const yaw = (-e.hdg + chase.yaw) * D2R; const dist = 44 * chase.dist, h = 9 * chase.dist + Math.sin(chase.pitch * D2R) * dist;
    const want = new THREE.Vector3(Math.sin(-yaw) * -dist * -1, h, Math.cos(-yaw) * dist);
    want.set(-Math.sin(yaw) * -dist, h, 0); want.set(Math.sin(yaw) * dist * -1 * -1, h, Math.cos(yaw) * dist);
    const back = new THREE.Vector3(0, 0, dist).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw); back.y = h; const target = acp.clone().add(back);
    if (!chasePos) chasePos = target.clone(); chasePos.lerp(target, 1 - Math.exp(-dt * 5));
    const gh = ground(chasePos.x, chasePos.z).h; if (chasePos.y < gh + 2) chasePos.y = gh + 2;
    camera.position.copy(chasePos); camera.lookAt(acp.x, acp.y + 3, acp.z); camera.fov = 52;
  } else if (v === 'orbit') {
    if (W.menuMode) orbit.yaw += dt * 4;
    const y = orbit.yaw * D2R, p = orbit.pitch * D2R; camera.position.set(acp.x + Math.sin(y) * Math.cos(p) * orbit.dist, acp.y + Math.sin(p) * orbit.dist + 1, acp.z + Math.cos(y) * Math.cos(p) * orbit.dist);
    const gh = ground(camera.position.x, camera.position.z).h; if (camera.position.y < gh + 1.5) camera.position.y = gh + 1.5;
    camera.lookAt(acp.x, acp.y + 1, acp.z); camera.fov = 50;
  } else if (v === 'tower' || v === 'runway') {
    const b = nearestBuilt(); if (!b) return setView('chase');
    if (v === 'tower') camera.position.copy(b.b.towerPos).add(new THREE.Vector3(b.x, b.elev, b.z));
    else { const E = (W.ils && W.ils.apt === b.apt) ? W.ils.end : b.geom.ends[0]; const r = -E.dir.z, rz = E.dir.x; camera.position.set(b.x + E.thrX + E.dir.x * 550 + r * (E.width / 2 + 70), b.elev + 1.8, b.z + E.thrZ + E.dir.z * 550 + rz * (E.width / 2 + 70)); }
    camera.lookAt(acp); const d = camera.position.distanceTo(acp); camera.fov = THREE.MathUtils.clamp(2 * Math.atan(55 / d) * R2D * 1.4, 1.5, 60);
  } else if (v === 'flyby') {
    if (!flyby.set || camera.position.distanceTo(acp) > 900) {
      const vel = fdm.vel.clone(); const sp = vel.length(); const dir = sp > 3 ? vel.normalize() : new THREE.Vector3(0, 0, -1).applyQuaternion(aircraft.quaternion);
      const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
      flyby.p.copy(acp).addScaledVector(dir, Math.max(80, sp * 7)).addScaledVector(side, 35 + sp * 0.3); flyby.p.y += 6;
      const gh = ground(flyby.p.x, flyby.p.z).h; flyby.p.y = Math.max(flyby.p.y, gh + 2); flyby.set = true;
    }
    camera.position.copy(flyby.p); camera.lookAt(acp); const d = camera.position.distanceTo(acp); camera.fov = THREE.MathUtils.clamp(2 * Math.atan(45 / d) * R2D, 10, 60);
  }
  if (W.menuMode && innerWidth > 900) { camera.aspect = innerWidth * 1.33 / innerHeight; camera.setViewOffset(innerWidth * 1.33, innerHeight, innerWidth * 0.33, 0, innerWidth, innerHeight); }
  else if (camera.view && camera.view.enabled) { camera.clearViewOffset(); camera.aspect = innerWidth / innerHeight; }
  camera.updateProjectionMatrix();
}
function nearestBuilt() { let best = null, bd = 1e12; for (const b of W.built) { const d = Math.hypot(b.x - fdm.pos.x, b.z - fdm.pos.z); if (b.full && d < bd) { bd = d; best = b; } } return best || W.built[0]; }

// ---------------------------------------------------------------- loop
let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 0, dynT = 0, dispT = 0, dispIdx = 0, frameMs = 16;
function snapshot() {
  const e = fdm.euler(); const gh = fdm.gnd ? fdm.gnd.h : 0; const dev = W.ils ? ilsDeviation(W.ils, fdm.pos) : null;
  const ll = W.geo.toLatLon(fdm.pos.x, fdm.pos.z);
  return { fdm, e, speeds: fdm.speeds(), ap: fdm.ap, altFt: fdm.pos.y / FT, groundFt: gh / FT, raFt: fdm.ra / FT, ils: W.ils, ilsDev: dev, track: (Math.atan2(fdm.vel.x, -fdm.vel.z) * R2D + 360) % 360, route: W.route,
    airports: W.built.map(b => ({ x: b.x, z: b.z, geom: b.geom, icao: b.icao })), navaids: W.navs, traffic: traffic.list, windFrom: W.windFrom, windKt: W.windKt, localMin: W.tod, phase: W.phase,
    ndRange: W.ndRange || (fdm.pos.y / FT - gh / FT < 4000 ? 10 : fdm.pos.y / FT < 12000 ? 20 : 40), warnings: warnings(e, dev), elecEmer: sys.emerElec, fd: fdm.ap.on || !(W.hand || W.ils !== W.depIls || W.cfg?.start === 'final') ? null : fdGuide(fdm, W.ils, dev, e), lat: ll.lat, lon: ll.lon };
}
function warnings(e, dev) {
  const m = fails.ecam([]); const f = fdm; const sp = f.speeds();
  if (f.crashed) m.push({ t: f.crashed.toUpperCase(), c: 'r' });
  if (f.stall > 0.25 && !f.onGround) m.push({ t: 'STALL  STALL', c: 'r' });
  if (f.ias > sp.vfe + 4 && f.flapIdx) m.push({ t: 'OVERSPEED  VFE ' + sp.vfe, c: 'r' });
  if ((!f.gearDown || f.gearPos < 0.97) && f.ra / FT < 750 && f.flapIdx >= 3 && !f.onGround) m.push({ t: 'L/G GEAR NOT DOWN', c: 'r' });
  if (f.tailStrike) m.push({ t: 'TAIL STRIKE', c: 'a' });
  if (f.parkBrake && f.tl > 0.3) m.push({ t: 'CONFIG PARK BRK ON', c: 'a' });
  if (f.onGround && f.tl > 0.6 && f.flapIdx === 0) m.push({ t: 'CONFIG FLAPS NOT IN T.O CONFIG', c: 'a' });
  if (dev && dev.valid && fdm.ap.vert === 'G/S' && Math.abs(dev.gsDots) > 1) m.push({ t: 'GLIDESLOPE', c: 'a' });
  if (f.ap.on) m.push({ t: 'AP1 ' + (f.ap.lat === 'LOC' ? 'LAND' : f.ap.lat), c: 'g' }); else m.push({ t: 'SEAT BELTS', c: 'g' });
  if (f.spoilersArmed) m.push({ t: 'GND SPLRS ARMED', c: 'g' }); if (f.autobrake) m.push({ t: 'AUTO BRK ' + (f.autobrake === 1 ? 'LO' : 'MED'), c: 'g' });
  if (W.wx === 'rain' || W.wx === 'fog') m.push({ t: 'WX: ' + W.wx.toUpperCase(), c: 'g' });
  for (let i = 0; i < 2; i++) if (sys.eng[i].st === 'start') m.unshift({ t: `ENG ${i + 1} START · ${sys.eng[i].msg}`, c: 'g' }); for (const t of sys.memo) m.unshift({ t, c: 'a' }); if (sys.cold && sys.sw.apuStart && !sys.apuAvail) m.unshift({ t: `APU START ${Math.round(sys.apuN)}%`, c: 'g' }); else if (sys.apuAvail) m.push({ t: 'APU AVAIL', c: 'g' });
  return m;
}
const STEP = 1 / 240;
function simulate(dtReal) {
  if (W.paused || !W.started) return;
  let simDt = Math.min(dtReal, 0.1) * W.timeAccel; const steps = Math.min(200, Math.ceil(simDt / STEP)); const h = simDt / steps;
  const env = { ground, wind: W.wind, gust: W.gust, wet: W.wet.value };
  if (W.push && !W.push.finished) pushStep(simDt);
  else if (W.autoTaxi) autoTaxiStep(simDt);
  else for (let i = 0; i < steps; i++) { fdm.step(h, env); autoConfig(h); }
  if (crew.state !== 'off') { aircraft.position.copy(fdm.pos); aircraft.quaternion.copy(fdm.q); aircraft.updateMatrixWorld(true); crew.update(simDt, aircraft, fdm, ground); }
  atc.update(simDt); fails.update(simDt); emergencyStep(simDt); updateComfort(simDt); sys.update(simDt, fdm, { gpu: gpuConnected(), oat: 24 }); autoStartStep(simDt);
  W.simTime += simDt;
  if (W.timeAccel > 1) { W.tod = (W.tod + simDt / 60) % 1440; if ((W.todT = (W.todT || 0) + simDt) > 30) { W.todT = 0; setTimeOfDay(W.tod); } }
  handleEvents();
  // origin management on long flights
  const dO = Math.hypot(fdm.pos.x, fdm.pos.z);
  if (W.route && W.cfg?.route) {
    const r = W.cfg.route, dest0 = r.toApt;
    if (!fdm.ap.ils) { const b = W.built.find(b => b.apt === dest0); if (b) { const E = b.geom.ends.find(e => e.ident === r.end) || b.geom.ends[0]; W.ils = fdm.ap.ils = ilsFor(dest0, E, new THREE.Vector3(b.x, b.elev, b.z));
      const last = W.route[W.route.length - 1], fp = W.ils.thr.clone().addScaledVector(W.ils.dir, -10 * NM), fl = W.geo.toLatLon(fp.x, fp.z); Object.assign(last, { x: fp.x, z: fp.z, lat: fl.lat, lon: fl.lon }); } }
    let rem = 0, px = fdm.pos.x, pz = fdm.pos.z; for (let i = fdm.ap.wp; i < W.route.length; i++) { rem += Math.hypot(W.route[i].x - px, W.route[i].z - pz); px = W.route[i].x; pz = W.route[i].z; }
    const tgtAlt = Math.round((airportGeometry(dest0).elevFt + 3000) / 100) * 100;
    if (!W.descending && fdm.ap.lat === 'NAV' && rem / NM < (fdm.pos.y / FT - tgtAlt) / 250 + 5) { W.descending = true; fdm.ap.alt = tgtAlt; fdm.ap.spd = 220; toast('Top of descent: ' + tgtAlt + ' ft'); }
  }
  if (W.route && W.cfg?.route) { const dest = W.cfg.route.toApt; const dd = haversine(W.geo.toLatLon(fdm.pos.x, fdm.pos.z).lat, W.geo.toLatLon(fdm.pos.x, fdm.pos.z).lon, dest.lat, dest.lon); if (dd < 40000 && W.primary?.apt !== dest) rebase(dest.lat, dest.lon, dest); else if (dO > 85000) { const ll = W.geo.toLatLon(fdm.pos.x, fdm.pos.z); rebase(ll.lat, ll.lon, null); } }
  else if (dO > 120000) { const ll = W.geo.toLatLon(fdm.pos.x, fdm.pos.z); rebase(ll.lat, ll.lon, nearestAirports(ll.lat, ll.lon, 30000, 1)[0] || null); }
  traffic.update(simDt, W.simTime, fdm.pos, ATM.uNight.value > 0.5);
  if (W.phase === 'takeoff' && !fdm.onGround && fdm.pos.y - (fdm.gnd?.h || 0) > 300) W.phase = 'climb';
}
// first-officer assistance on approach when the autopilot flies (gear/flaps/speed)
function autoConfig(dt) {
  const ap = fdm.ap; if (!ap.autoConfig || !(ap.on || W.hand) || fdm.onGround) return;
  const sp = fdm.speeds(); const dev = W.ils ? ilsDeviation(W.ils, fdm.pos) : null; if (!dev || !dev.valid) return;
  const nm = dev.thrDist / NM;
  if (ap.vert === 'G/S' || ap.vert === 'FLARE' || (W.hand && !ap.on && nm < 12)) {
    if (nm < 7 && fdm.flapIdx < 3) { fdm.setFlaps(3); }
    if (nm < 6.5 && !fdm.gearDown) { fdm.setGear(true); }
    if (nm < 5 && fdm.flapIdx < 4) { fdm.setFlaps(4); }
    const tgt = fdm.flapIdx >= 4 ? Math.round(sp.vapp) : nm > 7 ? 170 : nm > 5 ? Math.max(sp.vapp, 150) : Math.round(sp.vapp);
    if (ap.athr && !ap.retard) ap.spd = tgt;
    if (nm < 4) fdm.autobrake = fdm.autobrake || 2;
  }
}
function handleEvents() {
  for (const ev of fdm.events) {
    switch (ev.t) {
      case 'gear': audio.gearClunk(); toast('Gear ' + (ev.v ? 'down' : 'up')); pad.rumble(0.25, 0.15, 120); break;
      case 'touchdown': audio.touchdown(ev.v); onTouchdown(); { const k = Math.min(1, Math.abs(ev.v) / 3); pad.rumble(0.3 + 0.7 * k, 0.6, 260); } break;
      case 'call': audio.call(ev.v); callout(ev.v); (W.callLog ||= []).push(ev.v); break;
      case 'retard': audio.call('RETARD'); callout('RETARD'); (W.callLog ||= []).push('RETARD'); break;
      case 'apoff': audio.apOff(); toast('Autopilot disconnected' + (ev.v === 'rollout complete' ? '' : '')); break;
      case 'mode': toast(ev.v + ' captured'); break;
      case 'crash': audio.thump(1); showCrash(ev.v); break;
      case 'tailstrike': toast('Tail strike!'); break;
      case 'belly': audio.thump(1); audio.noiseHit(2.5, 2600, 300, 0.4); fails.touchdown(true); W.bellyT = W.simTime; toast('Belly landing! Keep the wings level and the nose straight…', 5000); pad.rumble(1, 1, 900); break;
      case 'liftoff': toast('Liftoff'); break;
      case 'wp': toast('Next waypoint: ' + (W.route?.[ev.v]?.name || '')); break;
    }
  }
  fdm.events.length = 0;
  if (fdm.td && !W.scored && (Math.hypot(fdm.vel.x, fdm.vel.z) < 16 * KT || W.simTime - fdm.td.t > 28)) { W.scored = true; showScore(); }
}
function onTouchdown() { const fpm = Math.round(-fdm.td.vs / FT * 60); callout(fpm + ' FPM');
  if (W.mode === 'challenge') return;
  if (fpm > 600) { CC.v = Math.max(0, CC.v - 32); setTimeout(() => toast('The cabin gasps. That was a hard landing.', 4000), 1200); }
  else if (fpm > 400) CC.v = Math.max(0, CC.v - 15); else if (fpm > 260) CC.v = Math.max(0, CC.v - 5);
  else if ((fpm < 200 && CC.v > 45) || fpm < 130) { CC.v = Math.min(100, CC.v + 6); setTimeout(() => { audio.applause(6); cabinObj()?.react('clap', 6.5); toast('Applause from the cabin!', 4000); }, 2200); }
}
function scoreLanding() {
  const td = fdm.td; const il = td.ils || W.ils; if (!il) return null;
  const dev = ilsDeviation(il, new THREE.Vector3(td.x, il.elev, td.z));
  const fpm = Math.max(0, -td.vs / FT * 60); const past = -dev.thrDist; const lat = Math.abs(dev.cross); const vref = fdm.speeds().vref; const dv = td.ias - vref;
  const sRate = fpm <= 60 ? 34 : fpm <= 240 ? 40 : fpm <= 600 ? 40 * (1 - (fpm - 240) / 360) : 0;
  const sCl = Math.max(0, 25 * (1 - lat / 12));
  const sZone = past >= 150 && past <= 600 ? 20 : past >= 0 && past <= 900 ? 10 : 0;
  const sSpd = dv >= -5 && dv <= 10 ? 15 : Math.max(0, 15 * (1 - (dv < -5 ? (-5 - dv) / 10 : (dv - 10) / 15)));
  const onRwy = lat < il.width / 2 && past > -1 && past < il.length;
  let score = Math.round(sRate + sCl + sZone + sSpd); if (!onRwy) score = Math.min(score, 20);
  if (Math.abs(td.bank) > 5) score -= 10; score = Math.max(0, score);
  const grade = score >= 92 ? 'A+' : score >= 82 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
  return { score, grade, fpm: Math.round(fpm), past: Math.round(past), lat: +lat.toFixed(1), ias: Math.round(td.ias), vref: Math.round(vref), dv: Math.round(dv), parts: { rate: sRate, cl: sCl, zone: sZone, spd: sSpd }, apt: il.apt.icao, rwy: il.ident, onRwy, bank: +td.bank.toFixed(1), pitch: +td.pitch.toFixed(1) };
}
let lastScore = null;
function showScore() {
  const s = scoreLanding(); if (!s) return; lastScore = s;
  const log = store.get('log', []); log.unshift({ date: new Date().toISOString().slice(0, 16).replace('T', ' '), mode: W.mode, apt: s.apt, rwy: s.rwy, fpm: s.fpm, score: s.score, grade: s.grade, wx: W.wx, tod: fmtTime(W.tod) }); store.set('log', log.slice(0, 200));
  if (W.mode === 'challenge' && W.cfg.chId) { const best = store.get('best', {}); if (!best[W.cfg.chId] || best[W.cfg.chId] < s.score) { best[W.cfg.chId] = s.score; store.set('best', best); } }
  if (W.mode !== 'challenge' && !W.hand) { toast(`Landing ${s.grade} · ${s.score}/100 · ${s.fpm} fpm · ${s.lat} m off centreline`, 7000); return; }
  const bar = (n, v, max, t) => `<div class="b"><span>${n}</span><span class="t"><i style="width:${Math.round(v / max * 100)}%"></i></span><span>${t}</span></div>`;
  $('#resultBox').innerHTML = `<span class="eyebrow">${s.apt} · Runway ${s.rwy} · ${W.cfg.title || 'Landing'}</span>
    <div class="score"><div class="big">${s.score}</div><div><div class="gr">Grade ${s.grade}</div><div style="color:var(--mute);font:12px var(--f-mono)">${s.onRwy ? 'Touchdown on the runway' : 'Touchdown off the runway surface'}</div></div></div>
    <div class="bars">${bar('Touchdown rate', s.parts.rate, 40, s.fpm + ' fpm')}${bar('Centreline', s.parts.cl, 25, s.lat + ' m')}${bar('Touchdown zone', s.parts.zone, 20, s.past + ' m past thr')}${bar('Speed vs VREF', s.parts.spd, 15, (s.dv >= 0 ? '+' : '') + s.dv + ' kt')}</div>
    <div class="btnrow"><button class="go" id="rRetry">Fly it again</button><button class="go ghost" id="rCont">Keep rolling</button><button class="go ghost" id="rMenu">Main menu</button></div>`;
  $('#result').hidden = false;
  $('#rRetry').onclick = () => { $('#result').hidden = true; startFlight(W.cfg); };
  $('#rCont').onclick = () => { $('#result').hidden = true; };
  $('#rMenu').onclick = () => { $('#result').hidden = true; toMenu(); };
}
function showCrash(why) {
  if (W.crashShown) return; W.crashShown = true;
  $('#resultBox').innerHTML = `<span class="eyebrow">Flight ended</span><h2>${why}</h2><p style="color:var(--mute);margin:0">Vertical speed ${Math.round(-fdm.vel.y / FT * 60)} fpm. Try again with a gentler flare, or let the autopilot show you the profile first.</p><div class="btnrow"><button class="go" id="rRetry">Restart flight</button><button class="go ghost" id="rMenu">Main menu</button></div>`;
  $('#result').hidden = false; $('#rRetry').onclick = () => { $('#result').hidden = true; startFlight(W.cfg); }; $('#rMenu').onclick = () => { $('#result').hidden = true; toMenu(); };
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - last) / 1000); last = now; frameMs = frameMs * 0.9 + dt * 1000 * 0.1;
  fpsAcc += dt; fpsN++; if (fpsAcc > 1) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  if (!W.started) return;
  padTick++; padPoll(dt); padUI(dt);
  if (!W.menuMode) pollInput(dt); else { fdm.in.pitch = fdm.in.roll = fdm.in.yaw = 0; }
  simulate(dt);
  renderFrame(dt); updateEngStart(); updatePadHUD(); padRumble(dt);
  // dynamic resolution
  if (settings.res === 'auto' && !W.menuMode) { dynT += dt; if (dynT > 2) { dynT = 0; const old = renderScale; if (frameMs > 20 && renderScale > 0.55) renderScale *= 0.88; else if (frameMs < 13 && renderScale < 1) renderScale = Math.min(1, renderScale * 1.08); if (old !== renderScale) applyRes(); } }
}
function renderFrame(dt) {
  aircraft.position.copy(fdm.pos); aircraft.quaternion.copy(fdm.q);
  const night = ATM.uNight.value;
  if (W.menuMode) { lights.strobe = !fdm.onGround || fdm.tl > 0.5; lights.nav = true; lights.beacon = true; lights.landing = night > 0.5; lights.taxi = night > 0.5; }
  else { // exterior lights follow the overhead switches; on a normal (not cold & dark) flight the first officer works the landing / nose lights until you touch them
    const sw = sys.sw, tch = sys.touched;
    if (!sys.cold && !tch.landL && !tch.landR) { const agl = fdm.pos.y - (fdm.gnd?.h || 0); const want = (fdm.onGround && fdm.tl > 0.5) || (!fdm.onGround && agl < 3000 * FT); const w2 = want || (night > 0.5 && fdm.onGround); if (w2 !== lights._auto) { lights._auto = w2; sw.landL = sw.landR = w2; } }
    if (!sys.cold && !tch.nose) sw.nose = fdm.onGround ? (fdm.tl > 0.5 ? 'TO' : 'TAXI') : (fdm.gearDown ? 'TAXI' : 'OFF');
    Object.assign(lights, sys.lights(fdm.onGround)); lights.logo = lights.nav;
  }
  aircraft.userData.lights = lights; // shared light-state interface for the aircraft model
  const sp = Math.hypot(fdm.vel.x, fdm.vel.z);
  animateAircraft(aircraft, { flapPos: fdm.flapPos, slatPos: fdm.slatPos, ailR: -fdm.da, ailL: fdm.da, spoilerRollR: Math.max(0, fdm.da / (25 * D2R) - 0.3), spoilerRollL: Math.max(0, -fdm.da / (25 * D2R) - 0.3), speedbrake: Math.max(fdm.speedbrake * 0.6, fdm.groundSpoilers),
    elevator: fdm.de, rudder: fdm.dr, gearPos: fdm.gearPos, steer: fdm.steer, groundSpeed: sp, onGround: fdm.onGround, n1: fdm.n1, reverser: fdm.reverser, lights }, dt * W.timeAccel, W.simTime, night);
  updateCamera(dt);
  sky.update(dt, camera, W.simTime);
  updateShadows();
  { const cb = cabinObj(); if (cb && !W.onFoot) { const vis = W.view === 'cabin'; cb.group.visible = vis; if (vis) { const k = Math.min(1.05, 0.5 / sky.exposure); cb.mat.color.setScalar(k); cb.crowd.setExposure(k); cb.light(k); }
    cb.live(W.paused ? 0 : dt * W.timeAccel, W.simTime, vis ? camera.position : null, { belt: W.signs.belt, airborne: !fdm.onGround, comfort: CC.v, visible: vis }); } }
  if (W.onFoot) { const fi = footInput(dt); foot.update(dt, fi, sky.exposure); $('#footPrompt').textContent = foot.prompt; }
  if (cockpit.userData.setDoor) cockpit.userData.setDoor(W.onFoot);
  updateDeck(dt);
  terrain.update(camera.position); terrain.uniforms.uWet.value = W.wet.value;
  renderer.toneMappingExposure = sky.exposure; bloom.threshold = 1.15 / sky.exposure; bloom.strength = 0.25 + 0.3 * night;
  LIGHT_U.uDay.value = 1 - ATM.uNight.value; aircraft.userData.parts.lightPts.mat.uniforms.uPx.value = renderer.getPixelRatio();
  sky.rainMat.uniforms.uVel.value.copy(fdm.vel);
  // blob shadow
  const gh = ground(fdm.pos.x, fdm.pos.z).h; const agl = fdm.pos.y - gh; blob.visible = settings.quality !== 'ultra' && agl < 80 && ATM.uNight.value < 0.95;
  if (blob.visible) { blob.position.set(fdm.pos.x, gh + 0.12, fdm.pos.z); const e = fdm.euler(); blob.rotation.y = -e.hdg * D2R; blob.scale.set(30, 1, 38); blob.material.opacity = (1 - agl / 80) * (1 - W.sky_oc) * 0.9; }
  W.sky_oc = sky.weather.overcast;
  if (!W.menuMode && W.ils) aids.update(W.ils, fdm.pos, { boxes: W.hand && settings.landBoxes && landHelpers() && !fdm.ap.on && !fdm.onGround, px: renderer.getPixelRatio() }, ground); aids.g.visible = !W.menuMode && !!W.ils;
  composer.render(dt);
  // instruments at ~20 Hz, spread across frames
  dispT += dt; if (dispT > (W.view === 'cockpit' ? 0.05 : 0.08)) { dispT = 0; const S = snapshot(); const order = W.view === 'cockpit' ? [['pfd'], ['nd'], ['ewd', 'sd']] : [['pfd'], ['pfd', 'nd']]; displays.draw(S, order[dispIdx++ % order.length]); W.S = S; }
  const hc = $('#hudc'); const hx = hc.getContext('2d');
  if (!W.menuMode && !W.onFoot && settings.hud && W.view !== 'cockpit' && W.view !== 'cabin' && W.S) drawHUD(hx, hc.width, hc.height, W.S, camera, settings.units, settings.extHud); else hx.clearRect(0, 0, hc.width, hc.height);
  audio.update({ fdm, apuN: sys.apuN, paused: W.paused || W.menuMode, ground: fdm.onGround, camDist: camera.position.distanceTo(aircraft.position), rain: W.wx === 'rain', nearAirport: true, groundH: gh, flapTarget: FLAPS[fdm.flapIdx].flap }, dt, W.view);
  music.update(dt, musicWant()); musicNowUI();
  if (!W.menuMode && (rescue.g.visible || fdm.scrape > 0 || rescue.evac || sys.fire[0].on || sys.fire[1].on || rescue.sparks.live || rescue.smoke.live)) rescue.update(dt, aircraft, { scrape: fdm.scrape, fire: [sys.fire[0].on, sys.fire[1].on], ground, foamOn: W.foam, smoulder: !!fdm.belly && W.simTime - W.bellyT < 120 });
  if (!W.menuMode && !W.onFoot) { updateUI(); updateParkPrompt(); updateCoach(); } else if (!$('#coach').hidden) $('#coach').hidden = true;
}
// boarding / deplaning music in the cabin while parked with power on; ambient music in the terminal halls
const MOOD_NAME = { bossa: 'bossa nova', pentatonic: 'pentatonic', lounge: 'lounge jazz' };
function musicNowUI() { // PA panel 'now playing' readout
  const el = $('#pMusicNow'); if (!el) return; const p = music.now;
  const t = settings.music === false ? 'off' : p ? '♪ ' + (p === 'ambient' ? 'terminal ambient' : MOOD_NAME[p] || p) : 'plays at the gate';
  if (el._t !== t) { el._t = t; el.textContent = t; }
}
function musicWant() {
  if (W.menuMode || !W.started || W.paused || W.crashShown) return null;
  const mood = moodFor((W.primary?.apt || W.apt)?.icao);
  if (W.onFoot) { const tag = foot.zoneTag(); if (tag === 'hall' || !tag) return { kind: 'terminal', mood, level: 0.9 }; if (tag === 'bridge' || tag === 'gatedoor') return { kind: 'cabin', mood, level: 0.3 }; return { kind: 'cabin', mood, level: tag === 'cockpit' || tag === 'ckdoor' ? 0.5 : 1 }; }
  const parked = fdm.onGround && Math.hypot(fdm.vel.x, fdm.vel.z) < 0.5 && sys.ac && ((W.stand && !W.push && !fdm.engRun[0] && !fdm.engRun[1]) || W.parkedAt);
  const lv = !parked ? 0 : W.view === 'cabin' ? 1 : W.view === 'cockpit' ? 0.3 : 0; return lv ? { kind: 'cabin', mood, level: lv } : null;
}
// approach coach for hand-flown landings: glide path, centreline and speed in plain words, then the flare cue
let coachN = 0;
function updateCoach() {
  if (coachN++ % 6) return; const el = $('#coach'); let c = null;
  if (W.hand && !fdm.ap.on && W.ils && fdm.assist !== 'realistic' && !(fdm.onGround && W.scored)) { const d = ilsDeviation(W.ils, fdm.pos); if (d.valid || fdm.onGround) c = coachLine(fdm, d, fdm.ap.athr ? fdm.ap.spd : fdm.speeds().vapp, fdm.ap.athr, pad.active); }
  const txt = c?.text || '', k = txt + (c?.cls || ''); if (el._k !== k) { el._k = k; el.textContent = txt; el.className = c?.cls || ''; el.hidden = !txt; }
}
// ---------------------------------------------------------------- flight deck: per-frame update, shadows, reflections
let deckEnvT = 1e9, deckEnvKey = '', exteriorCasters = null;
function deckVisible() { return cockpit.visible && !!cockpit.userData.update; }
function deckCtx() {
  const S = W.S; const warn = S && S.warnings ? (S.warnings.some(m => m.c === 'r') ? 'r' : S.warnings.some(m => m.c === 'a') ? 'a' : null) : null;
  const dest = atc.arr || W.dest || W.cfg?.apt; const r = W.cfg?.route;
  return { fdm, sys, inp, exposure: sky.exposure, night: ATM.uNight.value, daylight: THREE.MathUtils.smoothstep(sky.sunElev, -4, 14) * (1 - 0.45 * sky.weather.overcast), camera, tod: W.tod, S, warn, freq: atc.tuned ? atc.tuned.mhz : 118.7, actions: deckActions,
    route: { o: W.cfg?.apt?.icao, d: dest?.icao, alt: r?.alt || fdm.ap.alt, wps: W.route ? ['RWY', ...W.route.map(w => w.name)] : null } };
}
function updateDeck(dt) {
  if (!deckVisible()) return;
  aircraft.updateMatrixWorld(); camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const ctx = deckCtx(); cockpit.userData.update(dt, ctx);
  const L = cockpit.userData.light(); const key = [L.dome, L.flood, L.disp, Math.round(sky.sunElev)].join(',');
  deckEnvT += dt; if (deckEnvT > 20 || key !== deckEnvKey) { deckEnvT = 0; deckEnvKey = key; try { cockpit.userData.updateEnv(renderer, sky.pmrem, sky, L); } catch (e) { errors.push('deck env: ' + e.message); } }
}
// sun shadows: a tight shadow box around the flight deck when you sit in it, the wide ultra box otherwise
function updateShadows() {
  if (!renderer.shadowMap.enabled) return;
  const s = sky.sun; s.castShadow = true; const c = s.shadow.camera; const dir = s.position.clone().sub(s.target.position).normalize();
  const inDeck = deckVisible() && (W.view === 'cockpit' || W.onFoot); // sun or moon: light only enters through the windows
  const setSize = n => { if (s.shadow.mapSize.x !== n) { s.shadow.mapSize.set(n, n); if (s.shadow.map) { s.shadow.map.dispose(); s.shadow.map = null; } } };
  if (!exteriorCasters) { exteriorCasters = []; aircraft.traverse(o => { if (o.isMesh && o.castShadow && !isInDeck(o)) exteriorCasters.push(o); }); }
  if (inDeck) {
    setSize(settings.quality === 'medium' ? 1024 : 2048); const ctr = aircraft.localToWorld(new THREE.Vector3(0, 1.1, -15.5));
    c.left = c.bottom = -1.8; c.right = c.top = 1.8; c.near = 0.5; c.far = 40; c.updateProjectionMatrix(); s.shadow.bias = -0.0002; s.shadow.normalBias = 0.012;
    s.target.position.copy(ctr); s.position.copy(ctr).addScaledVector(dir, 18); exteriorCasters.forEach(o => o.castShadow = false);
  } else if (settings.quality === 'ultra') {
    setSize(2048); c.left = c.bottom = -70; c.right = c.top = 70; c.near = 1; c.far = 2500; c.updateProjectionMatrix(); s.shadow.bias = -0.0004; s.shadow.normalBias = 0.05;
    s.target.position.copy(aircraft.position); s.position.copy(aircraft.position).addScaledVector(dir, 1200); exteriorCasters.forEach(o => o.castShadow = ATM.uNight.value < 0.9);
  } else { setSize(256); c.left = c.bottom = -1; c.right = c.top = 1; c.updateProjectionMatrix(); }
}
function isInDeck(o) { for (let p = o; p; p = p.parent) if (p === cockpit) return true; return false; }
// head motion in the flight deck: g-load, sideslip, acceleration, ground roll and turbulence
const head = { p: new THREE.Vector3(), j: new THREE.Vector3(), t: 0 };
function headMotion(dt) {
  const f = fdm; head.t += dt; const k = 1 - Math.exp(-dt * 6);
  const gs = Math.hypot(f.vel.x, f.vel.z);
  const tgt = new THREE.Vector3(THREE.MathUtils.clamp(-(f.beta || 0) * 0.35, -0.03, 0.03), THREE.MathUtils.clamp(-(f.nz - 1) * 0.028, -0.035, 0.035), THREE.MathUtils.clamp((f.accel || 0) * 0.0035, -0.03, 0.03));
  head.p.lerp(tgt, k);
  const rough = (f.onGround ? Math.min(1, gs / 45) * 0.0035 : 0) + Math.min(1, f.gust.length() / 7) * 0.005 + (f.onGround && f.n1[0] > 15 ? 0.0003 : 0);
  const t = head.t; head.j.set(Math.sin(t * 13.1) * 0.6 + Math.sin(t * 23.7) * 0.4, Math.sin(t * 17.3 + 1) * 0.7 + Math.sin(t * 31.1) * 0.3, Math.sin(t * 11.7 + 2) * 0.5).multiplyScalar(rough);
  return head.p.clone().add(head.j);
}
// quick-look presets (8 pedestal, 9 overhead, 0 side window; same key again looks ahead)
const LOOKS = { 8: { yaw: -20, pitch: -55 }, 9: { yaw: -22, pitch: 60 }, 0: { yaw: 82, pitch: -6 }, fwd: { yaw: 0, pitch: -13 } };
function quickLook(n) { const L = look.target === LOOKS[n] ? LOOKS.fwd : LOOKS[n]; look.target = L; }
// mouse picking of flight-deck controls
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pickControl(cx, cy) {
  if (!deckVisible() || W.view !== 'cockpit' || W.onFoot) return null;
  ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1); camera.updateMatrixWorld(); ray.setFromCamera(ndc, camera); ray.far = 3;
  const h = ray.intersectObject(cockpit.userData.hit, false)[0]; return h ? cockpit.userData.controls[h.instanceId] : null;
}
let tipT = 0;
function showTip(cx, cy) {
  const el = $('#ckTip'); if (!el) return; const c = pickControl(cx, cy);
  if (!c) { el.style.opacity = 0; canvas.style.cursor = ''; return; }
  el.textContent = cockpit.userData.desc(c, deckCtx()); el.style.left = (cx + 16) + 'px'; el.style.top = (cy + 18) + 'px'; el.style.opacity = 1; canvas.style.cursor = 'pointer';
}
function fcuAdj(k, d) { const ap = fdm.ap; if (k === 'spd') ap.spd = THREE.MathUtils.clamp((ap.spd || Math.round(fdm.ias)) + d * 5, 100, 340); if (k === 'hdg') { ap.hdg = ((ap.hdg + d * 5) % 360 + 360) % 360; if (ap.on && ap.lat !== 'LOC') ap.lat = 'HDG'; } if (k === 'alt') ap.alt = THREE.MathUtils.clamp(ap.alt + d * 500, 0, 39000); if (k === 'vs') { ap.vs = THREE.MathUtils.clamp((ap.vert === 'V/S' ? ap.vs : 0) + d * 100, -6000, 6000); ap.vert = 'V/S'; } }
const deckActions = {
  gear: () => { fdm.setGear(!fdm.gearDown); if (fdm.onGround && !fdm.gearDown) { fdm.setGear(true); toast('Gear cannot retract on the ground'); } },
  park: () => { fdm.parkBrake = !fdm.parkBrake; toast('Parking brake ' + (fdm.parkBrake ? 'set' : 'released')); },
  signs: (b, sm) => setSigns(b, sm), ap: () => toggleAP(), athr: () => { const ap = fdm.ap; ap.athr = !ap.athr; if (ap.athr && !ap.spd) ap.spd = Math.round(fdm.ias); toast('A/THR ' + (ap.athr ? 'on' : 'off')); }, appr: () => armAppr(),
  autobrake: lv => { fdm.autobrake = fdm.autobrake === lv ? 0 : lv; toast('Autobrake ' + (fdm.autobrake ? ['', 'LO', 'MED', 'MAX'][lv] : 'off')); },
  callCabin: () => { audio.start(); audio.callDing && audio.callDing(); toast('Cabin crew: “Yes, captain?”', 3000); }, toast: m => toast(m), silence: () => fails.silence(),
  firePb: id => { if (id === 'fireApu') return toast('APU fire pushbutton: no APU fire.'); const i = id === 'fire2' ? 1 : 0; if (sys.fire[i].on || fails.has('fire' + (i + 1))) { fails.firePb(i); toast(`ENG ${i + 1} FIRE pushbutton pushed: engine ${i + 1} shut down, agents armed`, 4000); } else toast('Fire pushbuttons are guarded. No fire.'); },
  swapFreq: () => { }, ndRange: r => { W.ndRange = r; },
  fcuPush: (id, dir) => { const ap = fdm.ap; if (id === 'fcuSpd') { ap.spd = Math.round(fdm.ias); } else if (id === 'fcuHdg') { ap.hdg = Math.round(fdm.euler().hdg); ap.lat = 'HDG'; } else if (id === 'fcuAlt') { ap.vert = 'ALT*'; } else if (id === 'fcuVs') { ap.vert = 'ALT*'; } },
  fcuTurn: (id, d) => fcuAdj({ fcuSpd: 'spd', fcuHdg: 'hdg', fcuAlt: 'alt', fcuVs: 'vs' }[id], d),
  sound: k => { audio.start(); audio.click && audio.click(k); },
};
function footInput(dt) {
  const f = { fwd: 0, side: 0, run: keys.ShiftLeft || keys.ShiftRight, dyaw: footLook.dx * 0.0024 * settings.mouseSens, dpitch: footLook.dy * 0.0024 * settings.mouseSens };
  footLook.dx = footLook.dy = 0;
  if (keys.KeyW || keys.ArrowUp) f.fwd += 1; if (keys.KeyS || keys.ArrowDown) f.fwd -= 1; if (keys.KeyD) f.side += 1; if (keys.KeyA) f.side -= 1;
  if (keys.ArrowLeft) f.dyaw -= 1.8 * dt; if (keys.ArrowRight) f.dyaw += 1.8 * dt; if (keys.KeyQ) f.dyaw -= 1.8 * dt; if (keys.KeyE && false) f.dyaw += 1.8 * dt;
  if (pad.gp) { const a = pad.axes; f.fwd = THREE.MathUtils.clamp(f.fwd - a[1], -1, 1); f.side = THREE.MathUtils.clamp(f.side + a[0], -1, 1); f.dyaw += a[2] * 2.4 * dt; f.dpitch += a[3] * 1.7 * dt; f.run = f.run || pad.val[BTN.RT] > 0.4 || pad.held(BTN.LS); }
  return f;
}
function footInteract() {
  if (W.footMode === 'dep' && foot.pos.distanceTo(foot.seat) < 1.3) takeSeat();
  else if (W.footMode === 'arr' && foot.pos.distanceTo(foot.exitPos) < 6.5) finishTrip();
}
function footSkip() {
  if (W.footMode === 'dep') { foot.pos.copy(foot.routeToCockpit[foot.routeToCockpit.length - 1]); foot.floorY = foot.pos.y; foot.boarding = true; }
  else { foot.pos.copy(foot.exitPos).add(V3(0, 0, 0)); foot.floorY = foot.pos.y; foot.pos.addScaledVector(foot.parts.n, 3); }
}
function updateParkPrompt() {
  const el = $('#parkPrompt'); let txt = '';
  const gs = Math.hypot(fdm.vel.x, fdm.vel.z) / KT;
  if (W.parkedAt && !W.onFoot) txt = 'Enter  Stand up and walk out with the passengers';
  else if (fdm.onGround && gs < 4 && !W.push && W.mode !== 'challenge' && fdm.td) { const st = nearestFreeStand(120); if (st) txt = 'Enter  Park at gate ' + (st.gateName || '') + ' and shut down'; }
  if (W.taxiR && W.taxiR.pts && fdm.onGround && !W.autoTaxi && !txt && gs < 30 && !fdm.belly && !W.evac) txt = 'Shift+Enter  Auto-taxi along the magenta route';
  if (!txt && fdm.ap.on && !fdm.onGround && (W.ptT = (W.ptT || 0) + 1) && (W.ptT % 20 === 0 ? (W.ptHand = handFlyAvailable()) : W.ptHand)) txt = 'U  Hand-fly the landing (autopilot off)';
  if (el.textContent !== txt) el.textContent = txt; el.hidden = !txt;
}
function parkPromptAction() {
  if (keys.ShiftLeft || keys.ShiftRight) { if (W.taxiR && W.taxiR.pts && fdm.onGround) { W.autoTaxi = { pts: W.taxiR.pts.slice(1), i: 0, speed: 9 }; toast('Auto-taxi engaged'); } return; }
  if (W.parkedAt && !W.onFoot) { enterFoot('arr'); return; }
  const gs = Math.hypot(fdm.vel.x, fdm.vel.z) / KT; if (fdm.onGround && gs < 4 && fdm.td) { const st = nearestFreeStand(120); if (st) parkAtGate(st); }
}

// ---------------------------------------------------------------- UI
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.style.opacity = 1; clearTimeout(t._h); t._h = setTimeout(() => t.style.opacity = 0, ms); }
function callout(msg) { const c = $('#callout'); c.textContent = msg; c.style.opacity = 1; clearTimeout(c._h); c._h = setTimeout(() => c.style.opacity = 0, 900); }
function showLoad(on, msg) { const l = $('#loader'); if (on) { l.hidden = false; l.style.opacity = 1; $('#loadmsg').textContent = msg || ''; } else { l.style.opacity = 0; setTimeout(() => { if (l.style.opacity === '0') l.hidden = true; }, 600); } }
function showNote(A) {
  const n = $('#note'); const feat = A.featured;
  n.innerHTML = `<b>${A.icao}</b> · runways, thresholds and ILS geometry from OurAirports data. ${feat ? 'Coastline, hills, city and terminal layout are <b>approximate</b> hand-made surroundings.' : 'Terrain, town and terminal layout are <b>generic and approximate</b>.'}`;
  n.style.opacity = 1; clearTimeout(n._h); n._h = setTimeout(() => n.style.opacity = 0.45, 12000);
}
let uiT = 0;
function updateUI() {
  uiT += 1; if (uiT % 6) return; if (uiT % 30 === 0) updateMood(); updateColdList();
  const f = fdm, ap = f.ap, e = f.euler(), sp = f.speeds(), m = settings.units === 'metric';
  $('#fSpd').textContent = ap.athr ? String(Math.round(ap.spd)).padStart(3, '0') : (ap.spd ? String(Math.round(ap.spd)) : '---');
  $('#fHdg').textContent = String(Math.round(ap.hdg) % 360).padStart(3, '0');
  $('#fAlt').textContent = String(Math.round(ap.alt)).padStart(5, '0');
  $('#fVs').textContent = ap.vert === 'V/S' ? (ap.vs > 0 ? '+' : '') + String(ap.vs).padStart(4, '0') : '-----';
  const btn = (b, on) => { const el = $(`.fcub[data-b=${b}]`); if (el.getAttribute('aria-pressed') !== String(on)) el.setAttribute('aria-pressed', on); };
  btn('ap', ap.on); btn('athr', ap.athr); btn('hdgm', ap.on && ap.lat === 'HDG'); btn('nav', ap.on && ap.lat === 'NAV'); btn('loc', ap.lat === 'LOC' || ap.locArmed); btn('appr', !!(ap.appr && (ap.gsArmed || ap.vert === 'G/S' || ap.vert === 'FLARE')));
  $('#sThr').style.height = Math.round(f.tl * 100) + '%'; $('#sN1').textContent = f.n1[0].toFixed(0) + (f.reverser > 0.5 ? ' R' : '');
  $('#sFlap').textContent = FLAPS[f.flapIdx].name; $('#sGear').textContent = f.gearPos > 0.99 ? 'DOWN' : f.gearPos < 0.01 ? 'UP' : 'TRANS';
  $('#sGear').style.color = f.gearPos > 0.99 ? 'var(--green)' : f.gearPos < 0.01 ? 'var(--ink)' : 'var(--amber)';
  $('#sBrk').textContent = f.parkBrake ? 'PARK' : f.autobrake ? 'AUTO' : f.brake > 0.05 ? Math.round(f.brake * 100) + '%' : 'OFF'; $('#sBrk').style.color = f.parkBrake ? 'var(--amber)' : 'var(--ink)';
  $('#sTrim').textContent = (f.law === 'direct' ? f.trim : (f.trimDisp || 0)).toFixed(1);
  const A = W.primary?.apt || W.apt; const ll = W.geo.toLatLon(f.pos.x, f.pos.z);
  const idv = W.ils && !f.onGround ? ilsDeviation(W.ils, f.pos) : null; const dist = idv && idv.thrDist > 0 && idv.valid ? (idv.thrDist / NM).toFixed(1) + ' nm to ' + W.ils.ident : '';
  $('#info').innerHTML = `<span class="apt">${A ? A.icao + ' · ' + (A.iata || '') : ''}</span><span>${A ? A.name : ''}</span>
    <span><span class="k">Wind</span> ${String(Math.round(W.windFrom)).padStart(3, '0')}° / ${Math.round(W.windKt)} kt${W.gust ? ' gusting' : ''}</span>
    <span><span class="k">Local</span> ${fmtTime(W.tod)} · ${W.wx}${W.timeAccel > 1 ? ' · <b style="color:var(--fox)">×' + W.timeAccel + '</b>' : ''}</span>
    <span><span class="k">${m ? 'IAS' : 'IAS'}</span> ${m ? Math.round(f.ias * 1.852) + ' km/h' : Math.round(f.ias) + ' kt'} · <span class="k">VREF</span> ${Math.round(sp.vref)}</span>
    ${W.mode !== 'challenge' ? `<span><span class="k">Cabin</span> ${moodOf(CC.v)} ${Math.round(CC.v)}%${W.signs.belt ? ' · <b style="color:#fff4d8">belts</b>' : ''}</span>` : ''}${dist ? `<span><span class="k">ILS</span> ${dist}</span>` : ''}<span class="k">${fps} fps · ${Math.round(renderScale * 100)}% res</span>`;
}
const COLD_STEPS = [
  ['BAT 1 and BAT 2 on', 'overhead ELEC', () => sys.sw.bat1 && sys.sw.bat2],
  ['EXT PWR on (ground power) or APU', 'overhead ELEC', () => sys.sw.extPwr || sys.apuAvail],
  ['APU MASTER SW, then START (wait for AVAIL)', 'overhead APU', () => sys.apuAvail],
  ['APU BLEED on', 'overhead AIR COND', () => sys.sw.apuBleed],
  ['BEACON and NAV & LOGO on', 'overhead EXT LT', () => sys.sw.beacon && sys.sw.nav],
  ['SEAT BELTS on', 'overhead SIGNS', () => sys.sw.belts],
  ['ENG MODE to IGN', 'pedestal', () => sys.sw.engMode === 'IGN' || (fdm.engRun[0] && fdm.engRun[1])],
  ['ENG 2 MASTER on, wait for N2 58 %', 'pedestal', () => fdm.engRun[1]],
  ['ENG 1 MASTER on', 'pedestal', () => fdm.engRun[0]],
  ['ENG MODE back to NORM, APU BLEED off', 'pedestal + overhead', () => fdm.engRun[0] && fdm.engRun[1] && sys.sw.engMode === 'NORM' && !sys.sw.apuBleed],
];
// automatic engine start (button on the ground, pad A): runs the real sequence through the systems model
const AUTOSTART = [
  ['Batteries on', () => { sys.sw.bat1 = sys.sw.bat2 = true; return true; }],
  ['Ground power on', () => { if (sys.extAvail && !sys.apuAvail) sys.sw.extPwr = true; return true; }],
  ['Starting the APU', () => { if (sys.apuAvail) return true; sys.sw.apuMaster = true; if (sys.apuFlap >= 1) sys.sw.apuStart = true; return false; }],
  ['APU bleed on', () => { sys.sw.apuBleed = true; return true; }],
  ['Beacon on', () => { sys.sw.beacon = true; sys.sw.nav = true; return true; }],
  ['Engine mode IGN / START', () => { sys.sw.engMode = 'IGN'; return true; }],
  ['Starting engine 2', () => { sys.sw.master2 = true; return fdm.engRun[1] || fdm.n2[1] > 50; }], // engine 1 follows once engine 2 is past 50 % N2
  ['Starting engine 1', () => { sys.sw.master1 = true; return fdm.engRun[0]; }],
  ['Engine mode NORM, APU bleed off', () => { sys.sw.engMode = 'NORM'; sys.sw.apuBleed = false; sys.sw.extPwr = false; return true; }],
];
function startEngines() { if (W.autoStart || (fdm.engRun[0] && fdm.engRun[1]) || !fdm.onGround) return; audio.start(); W.autoStart = { i: 0, t: 0, shown: -1 }; }
function autoStartStep(dt) {
  const A = W.autoStart; if (!A) return; A.t -= dt; if (A.t > 0) return;
  const step = AUTOSTART[A.i]; if (!step) { W.autoStart = null; W.coldDone = true; toast('Both engines running. Ready to taxi.', 3500); return; }
  if (A.shown !== A.i) { A.shown = A.i; audio.click && audio.click('switch'); }
  if (step[1]()) { A.i++; A.t = 0.7; }
}
let engStartShown = null;
function updateEngStart() {
  const el = $('#engStart'); if (!el) return; const show = W.started && !W.menuMode && !W.onFoot && !W.paused && fdm.onGround && !(fdm.engRun[0] && fdm.engRun[1]) && !fdm.belly && !W.evac && !sys.engFault[0] && !sys.engFault[1];
  if (show !== engStartShown) { el.hidden = !show; engStartShown = show; } if (!show) return;
  const b = $('#engStartBtn'), A = W.autoStart; const i = A ? Math.min(A.i, AUTOSTART.length - 1) : -1;
  const t = A ? AUTOSTART[i][0] + (i >= 6 && i <= 7 ? ` · N2 ${Math.round(fdm.n2[i === 6 ? 1 : 0])}%` : i === 2 ? ` · ${Math.round(sys.apuN)}%` : '') : 'Start engines';
  if (b.textContent !== t) b.textContent = t; b.disabled = !!A;
}
function updateColdList() {
  const el = $('#coldList'); if (!el) return; const show = sys.cold && !W.coldDone && !W.onFoot && !W.menuMode;
  if (!show) { if (!el.hidden) el.hidden = true; return; }
  let next = -1; const rows = COLD_STEPS.map(([t, where, ok], i) => { const d = !!ok(); if (!d && next < 0) next = i; return `<li class="${d ? 'ok' : i === next ? 'now' : ''}"><b>${d ? '✓' : i + 1}</b><span>${t}<small>${where}</small></span></li>`; });
  if (next < 0) { W.coldT = (W.coldT || 0) + 0.1; if (W.coldT > 8) W.coldDone = true; }
  el.hidden = false; el.innerHTML = `<div class="rhead"><span class="rlab">COLD &amp; DARK</span><span class="rname">${next < 0 ? 'Engines running. Ready to taxi.' : 'Start the aircraft'}</span></div><ol>${rows.join('')}</ol><div class="rfoot"><span>9 overhead · 8 pedestal · hover to read, click to operate</span></div>`;
}
function bindFCU() {
  const adj = (k, d) => { const ap = fdm.ap; if (k === 'spd') ap.spd = THREE.MathUtils.clamp(ap.spd + d * 5, 100, 340); if (k === 'hdg') ap.hdg = ((ap.hdg + d * 5) % 360 + 360) % 360; if (k === 'alt') ap.alt = THREE.MathUtils.clamp(ap.alt + d * 500, 0, 39000); if (k === 'vs') { ap.vs = THREE.MathUtils.clamp((ap.vert === 'V/S' ? ap.vs : 0) + d * 100, -6000, 6000); ap.vert = 'V/S'; }
    if (k === 'hdg' && ap.on && ap.lat !== 'LOC') ap.lat = 'HDG'; if (k === 'alt' && ap.on && ap.vert === 'ALT') ap.vert = 'ALT'; };
  $$('.fcuw').forEach(el => { el.addEventListener('wheel', ev => { ev.preventDefault(); adj(el.dataset.k, ev.deltaY < 0 ? 1 : -1); }, { passive: false });
    el.addEventListener('click', ev => { const ap = fdm.ap, k = el.dataset.k; if (k === 'spd') ap.spd = Math.round(fdm.ias); if (k === 'hdg') { ap.hdg = Math.round(fdm.euler().hdg); ap.lat = 'HDG'; } if (k === 'alt') ap.alt = Math.round(fdm.pos.y / FT / 100) * 100; if (k === 'vs') { ap.vert = 'ALT*'; } adj(k, ev.shiftKey ? -1 : 0); }); });
  $$('.fcub').forEach(el => el.addEventListener('click', () => { const ap = fdm.ap; switch (el.dataset.b) {
    case 'ap': toggleAP(); break; case 'athr': ap.athr = !ap.athr; if (ap.athr && !ap.spd) ap.spd = Math.round(fdm.ias); break;
    case 'hdgm': ap.lat = 'HDG'; ap.locArmed = false; break; case 'nav': if (W.route) { ap.lat = 'NAV'; } else toast('No route loaded'); break;
    case 'loc': if (!W.ils) armAppr(); ap.locArmed = true; break; case 'appr': armAppr(); break; } canvas.focus(); }));
}
function togglePause() { if (!W.started || W.menuMode) return; const p = $('#pause'); p.hidden = !p.hidden; W.paused = !p.hidden; }
function toMenu() { foot.dispose(); disposeFlightCabin(); if (paOpen) togglePA(false); W.onFoot = false; $('#foot').hidden = true; $('#radio').hidden = true; radioOpen = false; showTaxi(null); W.push = null; W.autoTaxi = null; crew.clear(); try { document.exitPointerLock && document.exitPointerLock(); } catch (e) { } $('#pause').hidden = true; W.paused = false; $('#flight').hidden = true; $('#menu').hidden = false; W.menuMode = true; startMenuScene(); }

// ---- menu
const featured = () => World.featured.map(i => World.byIcao.get(i)).filter(Boolean);
function drawDiagram(cv, apt, selIdent, opts = {}) {
  const c = cv.getContext('2d'); const w = cv.width, h = cv.height; c.clearRect(0, 0, w, h);
  const g = airportGeometry(apt); let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (const e of g.ends) { minx = Math.min(minx, e.x); maxx = Math.max(maxx, e.x); minz = Math.min(minz, e.z); maxz = Math.max(maxz, e.z); }
  const pad = opts.pad ?? 26; const s = Math.min((w - pad * 2) / Math.max(maxx - minx, 400), (h - pad * 2) / Math.max(maxz - minz, 400));
  const ox = w / 2 - (minx + maxx) / 2 * s, oz = h / 2 - (minz + maxz) / 2 * s; const P = (x, z) => [ox + x * s, oz + z * s];
  c.lineCap = 'butt';
  for (const r of g.runways) { const [x0, y0] = P(r.a.x, r.a.z), [x1, y1] = P(r.b.x, r.b.z); c.strokeStyle = 'rgba(210,222,240,0.9)'; c.lineWidth = Math.max(opts.small ? 3 : 4, r.W * s * 2.2); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    if (!opts.small) { c.strokeStyle = 'rgba(20,30,50,.8)'; c.setLineDash([6, 6]); c.lineWidth = 1; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.setLineDash([]); } }
  c.font = `${opts.small ? 10 : 15}px "B612 Mono", monospace`; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const e of g.ends) { const [x, y] = P(e.x - e.dir.x * (opts.small ? 90 : 120) / s * (opts.small ? 0.05 : 0.09) * s / s * 1, e.z - e.dir.z * 0); const off = (opts.small ? 11 : 18); const tx = P(e.x, e.z)[0] - e.dir.x * off, ty = P(e.x, e.z)[1] - e.dir.z * off;
    const sel = e.ident === selIdent; c.fillStyle = sel ? '#f29a4c' : (opts.small ? 'rgba(160,180,210,.85)' : '#cfd8e6'); c.fillText(e.ident, tx, ty);
    if (sel) { const [ax, ay] = P(e.thrX - e.dir.x * 1400, e.thrZ - e.dir.z * 1400); const [bx, by] = P(e.thrX, e.thrZ); c.strokeStyle = '#f29a4c'; c.lineWidth = 2; c.setLineDash([5, 5]); c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); c.setLineDash([]); c.fillStyle = '#f29a4c'; c.beginPath(); c.arc(bx, by, 4, 0, 7); c.fill(); } }
  if (!opts.small) { c.fillStyle = 'rgba(200,210,230,.7)'; c.font = '12px "B612 Mono", monospace'; c.textAlign = 'left'; const km = 1000 * s; c.fillRect(16, h - 22, km, 2); c.fillText('1 km', 20 + km, h - 21); c.textAlign = 'center'; c.fillText('N', w - 24, 22); c.beginPath(); c.moveTo(w - 24, 30); c.lineTo(w - 29, 44); c.lineTo(w - 19, 44); c.closePath(); c.fill(); }
}
let sel = { apt: null, end: null, start: 'runway' };
function buildMenu() {
  $('#stA').textContent = World.stats.airports.toLocaleString(); $('#stR').textContent = World.stats.runways.toLocaleString(); $('#stN').textContent = World.stats.navaids.toLocaleString();
  const cards = $('#cards'); cards.innerHTML = '';
  for (const A of featured()) {
    const g = airportGeometry(A); const b = document.createElement('button'); b.className = 'card'; b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<canvas width="420" height="236"></canvas><span class="pill">${A.icao === 'MPTO' ? 'Panamá' : 'Featured'}</span><div class="meta"><div class="code"><b>${A.iata}</b><span>${A.icao}</span></div><div class="nm">${A.name}</div><div class="sub">${A.city}, ${A.country} · ${g.runways.length} rwy · ${Math.round(g.elevFt)} ft</div></div>`;
    drawDiagram(b.querySelector('canvas'), A, null, { small: true, pad: 30 }); b.onclick = () => selectAirport(A); cards.appendChild(b);
  }
  const q = $('#q'); q.addEventListener('input', () => { const r = search(q.value); const box = $('#results'); box.hidden = !q.value.trim(); box.innerHTML = r.length ? '' : '<div class="empty">No airport matches. Try an ICAO (KTPA), IATA (TPA) or a city name.</div>';
    for (const A of r) { const el = document.createElement('button'); el.innerHTML = `<span class="ic">${A.icao}</span><span class="ia">${A.iata || '—'}</span><span class="nm">${A.name}<small>${A.city ? A.city + ', ' : ''}${A.country}</small></span><span class="rw">${A.runways.length} RWY</span>`; el.onclick = () => { selectAirport(A); }; box.appendChild(el); } });
  $$('#nav button').forEach(b => b.onclick = () => { $$('#nav button').forEach(x => x.setAttribute('aria-current', x === b)); $$('#sheet .sec').forEach(s => s.hidden = s.dataset.sec !== b.dataset.sec); if (b.dataset.sec === 'logbook') renderLog(); });
  const seg = (id, fn) => $$(`#${id} button`).forEach(b => b.onclick = () => { $$(`#${id} button`).forEach(x => x.setAttribute('aria-pressed', x === b)); fn(b.dataset.v); });
  seg('startSeg', v => sel.start = v); seg('wxSeg', v => sel.wx = v);
  const tod = $('#tod'), wd = $('#wdir'), ws = $('#wspd'); const upd = () => { $('#todv').textContent = fmtTime(+tod.value); $('#wdirv').textContent = String(wd.value).padStart(3, '0') + '°'; $('#wspdv').textContent = ws.value + ' kt'; };
  tod.oninput = upd; wd.oninput = upd; ws.oninput = upd; upd();
  $('#fly').onclick = () => { audio.start(); const g = airportGeometry(sel.apt); go({ apt: sel.apt, end: sel.end, start: sel.start, tod: +tod.value, wx: sel.wx || 'clear', windFrom: +wd.value, windKt: +ws.value, gusts: $('#gusts').checked, mode: 'free', cold: $('#coldDark').checked }); };
  for (const k of ['landBoxes', 'landAutoSpd']) { const el = $('#' + k); el.checked = settings[k] !== false; el.onchange = () => { settings[k] = el.checked; store.set('settings', settings); }; }
  // challenges
  const chl = $('#chList'); const best = store.get('best', {});
  for (const ch of CHALLENGES) { const A = World.byIcao.get(ch.icao); if (!A) continue; const el = document.createElement('button'); el.className = 'item';
    el.innerHTML = `<div><h3>${ch.title}</h3><p>${ch.fail === 'v1' ? 'An engine fails at V1: keep it straight, fly the ECAM, declare MAYDAY and come back. ' : ch.fail === 'gear' ? 'The gear will not extend: try the gravity extension, brace, belly landing. ' : ''}${A.name} · Runway ${ch.end} · ${fmtTime(ch.tod)} · ${ch.wx} · wind ${String(ch.windFrom).padStart(3, '0')}°/${ch.windKt} kt${ch.gusts ? ' gusting' : ''}</p></div><div class="best">Best<b>${best[ch.id] ?? '—'}</b></div>`;
    el.onclick = () => { audio.start(); go({ apt: A, end: ch.end, start: ch.start || 'final', fail: ch.fail, finalNm: ch.finalNm, tod: ch.tod, wx: ch.wx, windFrom: ch.windFrom, windKt: ch.windKt, gusts: ch.gusts, mode: 'challenge', chId: ch.id, title: ch.title }); }; chl.appendChild(el); }
  const rl = $('#rtList');
  for (const r of ROUTES) { const A = World.byIcao.get(r.from), B = World.byIcao.get(r.to); if (!A || !B) continue; r.toApt = B; const d = haversine(A.lat, A.lon, B.lat, B.lon) / NM; const el = document.createElement('button'); el.className = 'item';
    el.innerHTML = `<div><h3>${r.title}</h3><p>${A.iata} → ${B.iata} · ${Math.round(d)} nm direct · cruise ${r.alt.toLocaleString()} ft · ${r.desc}</p></div><div class="best">Arrive<b>${r.end}</b></div>`;
    el.onclick = () => { audio.start(); go({ apt: A, end: r.end, start: 'route', route: r, tod: r.tod, wx: r.wx, windFrom: 60, windKt: 8, mode: 'route', toApt: B }); }; rl.appendChild(el); }
  // settings
  const setSeg = (id, key) => { $$(`#${id} button`).forEach(b => { b.setAttribute('aria-pressed', String(settings[key]) === b.dataset.v); b.onclick = () => { $$(`#${id} button`).forEach(x => x.setAttribute('aria-pressed', x === b)); settings[key] = b.dataset.v; store.set('settings', settings); applySettings(key); }; }); };
  setSeg('failRandSeg', 'failRand'); { const fp = $('#failPick'); fp.innerHTML = FAILS.map(f => `<option value="${f.id}">${f.label}</option>`).join(''); $('#failNow').onclick = () => { if (!W.started || W.menuMode) return toast('Start a flight first.'); const ok = fails.trigger(fp.value); toast(ok ? 'Failure triggered: ' + FAILS.find(f => f.id === fp.value).label : 'That failure is already active.'); if (W.paused && $('#pause') && !$('#pause').hidden) togglePause(); }; }
  setSeg('qSeg', 'quality'); setSeg('resSeg', 'res'); setSeg('unitSeg', 'units'); setSeg('lawSeg', 'law'); setSeg('invSeg', 'invert'); setSeg('padAssistSeg', 'padAssist'); setSeg('padInvSeg', 'padInvert');
  renderPadMap(); $('#padRumble').checked = settings.padRumble !== false; $('#padRumble').onchange = () => { settings.padRumble = $('#padRumble').checked; pad.cfg.rumble = settings.padRumble; store.set('settings', settings); if (pad.cfg.rumble) pad.rumble(0.4, 0.4, 200); };
  for (const [id, key] of [['mouseSens', 'mouseSens'], ['vol', 'vol'], ['musicVol', 'musicVol'], ['padSens', 'padSens'], ['padDz', 'padDz']]) { const el = $('#' + id); el.value = settings[key]; el.oninput = () => { settings[key] = +el.value; store.set('settings', settings); applySettings(key); }; }
  for (const [id, key] of [['voice', 'voice'], ['hudOn', 'hud'], ['music', 'music'], ['termMusic', 'termMusic']]) { const el = $('#' + id); el.checked = settings[key]; el.onchange = () => { settings[key] = el.checked; store.set('settings', settings); applySettings(key); }; }
  const fillVoices = () => { const vs = (atc.allVoices || []).filter(v => /^(en|es|ko)/i.test(v.lang)); for (const [id, key] of [['vCtl', 'controller'], ['vPilot', 'pilot']]) { const el = $('#' + id); const cur = settings['voice_' + key] || 'auto'; el.innerHTML = `<option value="auto">Auto (most natural available)</option>` + vs.map(v => `<option value="${v.name.replace(/"/g, '&quot;')}">${v.name} · ${v.lang}</option>`).join(''); el.value = vs.some(v => v.name === cur) ? cur : 'auto'; atc.voicePref[key] = el.value; el.onchange = () => { settings['voice_' + key] = el.value; atc.voicePref[key] = el.value; store.set('settings', settings); }; } };
  fillVoices(); atc.on((a, why) => { if (why === 'voices') fillVoices(); });
  $('#vCtlTest').onclick = () => { audio.start(); atc.o = atc.o || { ctx: atcCtx, dep: World.byIcao.get('KTPA'), arr: World.byIcao.get('KMIA'), depEnd: airportGeometry(World.byIcao.get('KTPA')).ends[0] }; atc.say('TWR', { d: 'Foxheart 412, Tampa Tower, wind 210 at 8, runway 19 right, cleared for takeoff.', s: 'Foxheart four one two, Tampa Tower, wind two one zero at eight, runway one niner right, cleared for takeoff.' }); };
  $('#vPilotTest').onclick = () => { audio.start(); atc.o = atc.o || { ctx: atcCtx, dep: World.byIcao.get('KTPA'), arr: World.byIcao.get('KMIA'), depEnd: airportGeometry(World.byIcao.get('KTPA')).ends[0] }; atc.say('ME', { d: 'Cleared for takeoff 19R, Foxheart 412.', s: 'Cleared for takeoff one niner right, Foxheart four one two.' }); };
  $('#chatterOn').checked = settings.chatter !== false; atc.chatterOn = settings.chatter !== false; $('#chatterOn').onchange = () => { settings.chatter = $('#chatterOn').checked; atc.chatterOn = settings.chatter; store.set('settings', settings); };
  $('#clearLog').onclick = () => { if ($('#clearLog').dataset.armed) { store.set('log', []); store.set('best', {}); renderLog(); $('#clearLog').textContent = 'Clear logbook'; delete $('#clearLog').dataset.armed; } else { $('#clearLog').dataset.armed = 1; $('#clearLog').textContent = 'Click again to clear'; } };
  const keysHtml = KEYS.map(([k, d]) => `<div><span>${d}</span><span>${k.split(' ').map(x => `<kbd>${x}</kbd>`).join(' ')}</span></div>`).join('');
  $('#keysA').innerHTML = keysHtml; $('#keysB').innerHTML = keysHtml;
  $('#resume').onclick = togglePause; $('#restart').onclick = () => { $('#pause').hidden = true; W.paused = false; startFlight(W.cfg); }; $('#toMenu').onclick = toMenu;
  $('#pHelp').onclick = () => { $('#help').hidden = false; }; $('#helpClose').onclick = () => { $('#help').hidden = true; };
  $('#pSet').onclick = () => { $('#pause').hidden = true; W.paused = false; toMenu(); $('#nav button[data-sec=settings]').click(); };
  bindFCU();
  $('#engStartBtn').onclick = () => { startEngines(); canvas.focus(); };
  $('#radioBtn').onclick = () => { toggleRadio(); canvas.focus(); }; $('#paBtn').onclick = () => { togglePA(); canvas.focus(); }; $('#rClose').onclick = () => toggleRadio(false);
  $('#rAuto').onchange = () => { atc.auto = $('#rAuto').checked; settings.atcAuto = atc.auto; store.set('settings', settings); };
  $('#rSpeak').onchange = () => { atc.speakMe = $('#rSpeak').checked; };
  $('#pMusic').onclick = () => { settings.music = settings.music === false; store.set('settings', settings); applySettings('music'); toast('Boarding music ' + (settings.music ? 'on' : 'off')); };
  $('#pMusicVol').oninput = () => { settings.musicVol = +$('#pMusicVol').value; store.set('settings', settings); applySettings('musicVol'); }; syncMusicUI();
  selectAirport(World.byIcao.get('KTPA'), true);
}
function syncMusicUI() { const b = $('#pMusic'), r = $('#pMusicVol'); if (b) b.setAttribute('aria-pressed', String(settings.music !== false)); if (r) r.value = settings.musicVol; for (const [id, k] of [['music', 'music'], ['termMusic', 'termMusic']]) { const el = $('#' + id); if (el) el.checked = settings[k] !== false; } const mv = $('#musicVol'); if (mv) mv.value = settings.musicVol; }
function applySettings(key) {
  if (key === 'failRand') fails.random = settings.failRand || 'off';
  if (key === 'padSens') pad.cfg.sens = settings.padSens; if (key === 'padDz') pad.cfg.dz = settings.padDz;
  if (key === 'vol') audio.setVolume(settings.vol); if (key === 'voice') audio.voice = settings.voice; if (key === 'law') fdm.law = settings.law;
  if (key === 'res') applyRes();
  if (key === 'music' || key === 'musicVol' || key === 'termMusic') { music.on = settings.music !== false; music.vol = +settings.musicVol; music.term = settings.termMusic !== false; syncMusicUI(); }
  if (key === 'quality') { toast('Graphics quality applies on reload'); location.hash = ''; setTimeout(() => location.reload(), 600); }
}
function selectAirport(A, quiet) {
  if (!A) return; sel.apt = A; const g = airportGeometry(A);
  $$('#cards .card').forEach(c => c.setAttribute('aria-pressed', c.querySelector('.code span').textContent === A.icao));
  $('#setupWrap').hidden = false; $('#freeTitle').textContent = (A.iata ? A.iata + ' · ' : '') + A.name;
  const ends = g.ends.filter(e => e.ident); sel.end = (ends.find(e => e.length > 2000) || ends[0])?.ident;
  const list = $('#rwlist'); list.innerHTML = '';
  for (const E of ends) { const f = ilsFreq(A, E); const b = document.createElement('button'); b.setAttribute('aria-pressed', E.ident === sel.end);
    b.innerHTML = `<b>${E.ident}</b><small>${Math.round(E.hdg)}°T · ${Math.round(E.length / FT).toLocaleString()} ft</small><small class="ils">ILS ${f.mhz.toFixed(2)}${f.real ? '' : '*'}</small>${E.derived ? '<small style="color:var(--amber)">derived position</small>' : ''}`;
    b.onclick = () => { sel.end = E.ident; $$('#rwlist button').forEach(x => x.setAttribute('aria-pressed', x === b)); drawDiagram($('#diag'), A, sel.end); }; list.appendChild(b); }
  drawDiagram($('#diag'), A, sel.end);
  const st = sunTimes(A, TODAY);
  $('#aptkv').innerHTML = `<dt>ICAO / IATA</dt><dd>${A.icao} / ${A.iata || '—'}</dd><dt>Location</dt><dd>${A.city ? A.city + ', ' : ''}${A.country} · ${A.lat.toFixed(4)}, ${A.lon.toFixed(4)}</dd><dt>Elevation</dt><dd>${Math.round(g.elevFt)} ft (mean of runway ends)</dd>
    <dt>Frequencies</dt><dd>${['T', 'G', 'A', 'P'].filter(k => A.freq[k]).map(k => ({ T: 'TWR', G: 'GND', A: 'ATIS', P: 'APP' })[k] + ' ' + A.freq[k].toFixed(2)).join(' · ') || '—'}</dd><dt>Sun (27 Oct)</dt><dd>rise ${st.rise != null ? fmtTime(st.rise) : '—'} · set ${st.set != null ? fmtTime(st.set) : '—'} (UTC${st.tz >= 0 ? '+' : ''}${st.tz})</dd>`;
  $('#aptnote').innerHTML = (A.featured ? FEATURED_INFO[A.icao] + ' ' : '') + `Runway thresholds, headings, widths and displaced thresholds come from OurAirports. ${A.featured ? 'Coastline, hills, city and terminal positions are hand-made approximations.' : 'Terrain, town and terminal are generic approximations.'} ILS frequencies marked * are simulated.`;
  const chips = $('#sunchips'); chips.innerHTML = '';
  const add = (label, m) => { if (m == null) return; const c = document.createElement('button'); c.className = 'chip'; c.textContent = label + ' ' + fmtTime(m); c.onclick = () => { $('#tod').value = Math.round(m / 5) * 5; $('#tod').oninput(); }; chips.appendChild(c); };
  add('Sunrise', st.rise); add('Morning', st.rise != null ? st.rise + 150 : 540); add('Noon', 750); add('Golden hour', st.set != null ? st.set - 40 : 1080); add('Dusk', st.set != null ? st.set + 18 : 1150); add('Night', 1290);
  $('#tod').value = Math.round(((st.set ?? 1120) - 40) / 5) * 5; $('#tod').oninput();
  if (!quiet) { $('#results').hidden = true; $('#q').value = ''; $('#setupWrap').scrollIntoView({ block: 'start', behavior: 'smooth' }); }
}
function renderLog() {
  const log = store.get('log', []); const body = $('#logBody');
  if (!log.length) { body.innerHTML = '<div class="empty">No flights logged yet. Land anywhere and your touchdown is scored and saved here.</div>'; return; }
  body.innerHTML = `<div style="overflow-x:auto"><table class="log"><thead><tr><th>Date</th><th>Mode</th><th>Airport</th><th>Rwy</th><th>Rate</th><th>Score</th><th>Grade</th><th>Wx · time</th></tr></thead><tbody>${log.map(l => `<tr><td>${l.date}</td><td>${l.mode}</td><td>${l.apt}</td><td>${l.rwy}</td><td>${l.fpm} fpm</td><td>${l.score}</td><td class="grade" style="color:${l.score >= 82 ? 'var(--green)' : l.score >= 55 ? 'var(--amber)' : 'var(--red)'}">${l.grade}</td><td>${l.wx} · ${l.tod}</td></tr>`).join('')}</tbody></table></div>`;
}
async function go(cfg) {
  $('#menu').hidden = true; $('#flight').hidden = false; W.menuMode = false; W.paused = false;
  if (cfg.mode === 'route') { cfg.route.toApt = cfg.toApt; }
  await startFlight(cfg); canvas.focus();
}
async function startMenuScene() {
  const A = World.byIcao.get('KTPA'); W.menuMode = true;
  await startFlight({ apt: A, end: '19L', start: 'runway', tod: 1075, wx: 'scattered', windFrom: 200, windKt: 6, menu: true });
  W.menuMode = true; setView('orbit'); orbit.yaw = 205; orbit.pitch = 9; orbit.dist = 58;
  $('#menu').hidden = false; $('#flight').hidden = true;
}

const CHALLENGES = [
  { id: 'v1fail', title: 'Engine failure at V1', icao: 'KTPA', end: '19R', tod: 840, wx: 'scattered', windFrom: 200, windKt: 8, start: 'runway', fail: 'v1' },
  { id: 'gearup', title: 'Gear won’t come down', icao: 'KMIA', end: '09', tod: 1000, wx: 'clear', windFrom: 100, windKt: 7, start: 'final', fail: 'gear', finalNm: 14 },
  { id: 'tpa19r', title: 'Tampa golden hour', icao: 'KTPA', end: '19R', tod: 1080, wx: 'scattered', windFrom: 210, windKt: 8 },
  { id: 'lax25l', title: 'LAX night arrival', icao: 'KLAX', end: '25L', tod: 1290, wx: 'clear', windFrom: 250, windKt: 10 },
  { id: 'icn33l', title: 'Incheon crosswind', icao: 'RKSI', end: '33L', tod: 900, wx: 'rain', windFrom: 280, windKt: 18, gusts: true },
  { id: 'mia09', title: 'Miami squall', icao: 'KMIA', end: '09', tod: 960, wx: 'rain', windFrom: 120, windKt: 14, gusts: true },
  { id: 'pty03r', title: 'Tocumen tropical', icao: 'MPTO', end: '03R', tod: 1050, wx: 'overcast', windFrom: 10, windKt: 8 },
  { id: 'jfk31l', title: 'JFK morning fog', icao: 'KJFK', end: '31L', tod: 450, wx: 'fog', windFrom: 300, windKt: 4 },
  { id: 'sfo28r', title: 'SFO over the bay', icao: 'KSFO', end: '28R', tod: 1000, wx: 'clear', windFrom: 290, windKt: 16 },
  { id: 'lhr27l', title: 'Heathrow blustery', icao: 'EGLL', end: '27L', tod: 690, wx: 'overcast', windFrom: 240, windKt: 22, gusts: true },
  { id: 'hnd34r', title: 'Haneda with Fuji', icao: 'RJTT', end: '34R', tod: 420, wx: 'clear', windFrom: 330, windKt: 7 },
  { id: 'dxb30l', title: 'Dubai at dusk', icao: 'OMDB', end: '30L', tod: 1080, wx: 'clear', windFrom: 300, windKt: 9 },
  { id: 'sin20c', title: 'Changi shower', icao: 'WSSS', end: '20C', tod: 1140, wx: 'rain', windFrom: 200, windKt: 10 },
];
const ROUTES = [
  { title: 'Gulf Coast hop', from: 'KTPA', to: 'KMIA', end: '09', alt: 9000, spd: 260, tod: 1020, wx: 'scattered', desc: 'down the Gulf coast, across the Everglades',
    start: { lat: 27.86, lon: -82.56, hdg: 190, alt: 4000 }, wps: [[27.70, -82.62, 'TBAY'], [27.33, -82.58, 'SRQ'], [26.65, -82.05, 'FMY'], [26.05, -81.30, 'EVGL'], [25.86, -80.62, 'DADE'], [25.784, -80.505, 'MIA09']] },
  { title: 'Seoul shuttle', from: 'RKSI', to: 'RKSS', end: '14R', alt: 4000, spd: 230, tod: 1050, wx: 'clear', desc: 'over the Han River estuary',
    start: { lat: 37.50, lon: 126.43, hdg: 340, alt: 3000 }, wps: [[37.60, 126.47, 'GANG'], [37.70, 126.60, 'HANR'], [37.665, 126.663, 'GMP14R']] },
  { title: 'California coast', from: 'KLAX', to: 'KSFO', end: '28R', alt: 11000, spd: 280, tod: 1000, wx: 'clear', desc: 'Malibu, Santa Barbara, Big Sur',
    start: { lat: 33.96, lon: -118.55, hdg: 280, alt: 5000 }, wps: [[34.02, -118.85, 'MALIB'], [34.38, -119.75, 'SBA'], [35.35, -120.90, 'MORRO'], [36.30, -121.90, 'BIGSUR'], [36.95, -122.05, 'SNTCZ'], [37.40, -122.05, 'SJC'], [37.563, -122.16, 'SFO28R']] },
  { title: 'Panamá skyline & canal', from: 'MPTO', to: 'MPTO', end: '03R', alt: 3500, spd: 220, tod: 1050, wx: 'scattered', desc: 'Punta Paitilla, Casco Viejo, Miraflores locks',
    start: { lat: 9.03, lon: -79.43, hdg: 250, alt: 2500 }, wps: [[8.985, -79.50, 'PAITL'], [8.952, -79.535, 'CASCO'], [8.94, -79.565, 'PUENTE'], [9.015, -79.595, 'MIRAF'], [9.07, -79.66, 'CUT'], [9.10, -79.52, 'NORTH'], [8.98, -79.47, 'BAY'], [8.93, -79.475, 'PTY03R']] },
];
const KEYS = [['W S / ↑ ↓', 'Pitch (↑ nose down)'], ['A D / ← →', 'Roll'], ['Q E', 'Rudder / nose-wheel steering'], ['Shift / PgUp / =', 'Thrust up'], ['X / PgDn / −', 'Thrust down'], ['Shift T', 'TOGA thrust'],
  ['Start engines', 'Button at the top while parked (automatic start); or do it yourself on the overhead and pedestal'],
  ['T', 'Radio (ATC): while open, 1–6 pick a call, Esc closes'], ['Y', 'Cabin PA: while open, 1–9 announce, 0 seat belt sign, Esc closes'], ['K / Enter', 'Pushback / park at gate'], ['J', 'Next step: checklists, ECAM actions after a failure, ATC calls (same as A on a controller)'], ['Shift Enter', 'Auto-taxi along the magenta route'],
  ['F / V', 'Flaps extend / retract'], ['G', 'Landing gear'], ['B', 'Wheel brakes (hold)'], ['Space', 'Parking brake'], ['R', 'Reversers (on ground)'], ['/', 'Speed brake'], ['[ ]', 'Pitch trim (direct law)'],
  ['Z', 'Autopilot on / off'], ['Shift Z', 'Autothrust on / off'], ['O', 'Arm ILS approach (LOC + G/S)'], ['U', 'Hand-fly the landing (autopilot off, flight director on)'], ['L', 'Landing lights'], ['C / 1–7', 'Camera: deck, chase, orbit, tower, runway, fly-by, cabin'], ['8 / 9 / 0', 'Flight deck only: look at pedestal / overhead / side window (again: ahead)'], ['Mouse on the deck', 'Hover a switch for its name, click to operate, scroll on knobs'],
  ['Mouse drag', 'Look / orbit camera'], ['Wheel', 'Zoom'], ['M', 'Mouse yoke'], ['N', 'Navigation display overlay'], ['H', 'Outside views: clean HUD ↔ full HUD + PFD'], ['. ,', 'Time acceleration'], ['P / Esc', 'Pause / menu'], ['?', 'This help'],
  ['On foot', 'WASD walk, Shift run, mouse look, E interact, J skip ahead, Y PA'],
  ['Xbox controller', 'Left stick flies (Easy assist: let go and it levels) and steers on the ground; right stick looks, R3 recentres; RT / LT thrust (LT on the landing roll: reverse); A next step (shown on screen); B brakes (hold); X ATC menu; Y PA menu; LB / RB flaps up / down; hold LB + A gear, + X autopilot, + B spoilers, + Y lights; D-pad views; View camera, hold View for help; Menu pause'],
  ['Controller in menus', 'D-pad or left stick moves, A selects, B backs out'], ['Controller on foot', 'Left stick walks, right stick looks, RT run, A interact, Y skip ahead, X cabin PA']];

// ---------------------------------------------------------------- test hooks
window.__sim = {
  ready: false, errors, world: World, W, fdm, settings,
  state() { const e = fdm.euler(); return { view: W.view, mode: W.mode, apt: W.apt?.icao, end: W.end?.ident, x: fdm.pos.x, y: fdm.pos.y, z: fdm.pos.z, altFt: fdm.pos.y / FT, raFt: fdm.ra / FT, ias: fdm.ias, gs: Math.hypot(fdm.vel.x, fdm.vel.z) / KT, vsFpm: fdm.vel.y / FT * 60, ...e, onGround: fdm.onGround, gearDown: fdm.gearDown, gearPos: fdm.gearPos, flaps: fdm.flapIdx, flapPos: fdm.flapPos, tl: fdm.tl, n1: fdm.n1.slice(), ap: { on: fdm.ap.on, athr: fdm.ap.athr, lat: fdm.ap.lat, vert: fdm.ap.vert, spd: fdm.ap.spd }, crashed: fdm.crashed, td: fdm.td && { vs: fdm.td.vs, ias: fdm.td.ias }, score: lastScore, simTime: W.simTime, tod: W.tod, wx: W.wx, sunElev: sky.sunElev, fps, renderScale, built: W.built.map(b => b.icao + (b.full ? '*' : '')), cityCount: city.count || 0, lightsCount: W.primary?.b.lightsCount, alpha: fdm.alpha * R2D, stall: fdm.stall, parkBrake: fdm.parkBrake }; },
  search: q => search(q).map(a => ({ icao: a.icao, iata: a.iata, name: a.name, runways: a.runways.length })),
  async start(cfg) { const A = World.byIcao.get(cfg.icao); $('#menu').hidden = true; $('#flight').hidden = false; W.menuMode = false; W.paused = false; if (cfg.route) { const r = ROUTES.find(r => r.title === cfg.route); r.toApt = World.byIcao.get(r.to); cfg = { ...cfg, route: r, toApt: r.toApt, start: 'route', mode: 'route', end: r.end }; } await startFlight({ ...cfg, apt: A }); return this.state(); },
  advance(sec, input) { testInput = input || null; const n = Math.round(sec / (1 / 60)); for (let i = 0; i < n; i++) { padTick++; padPoll(1 / 60); padUI(1 / 60); if (!W.menuMode) pollInput(1 / 60); simulate(1 / 60); } testInput = null; return this.state(); },
  set(o) { if (o.tl != null) fdm.tl = o.tl; if (o.parkBrake != null) fdm.parkBrake = o.parkBrake; if (o.flaps != null) fdm.setFlaps(o.flaps); if (o.gear != null) fdm.setGear(o.gear); if (o.ap != null) { if (o.ap !== fdm.ap.on) toggleAP(); } if (o.athr != null) fdm.ap.athr = o.athr; if (o.spd != null) fdm.ap.spd = o.spd; if (o.alt != null) fdm.ap.alt = o.alt; if (o.hdg != null) fdm.ap.hdg = o.hdg; return this.state(); },
  key(code, shift) { dispatchEvent(new KeyboardEvent('keydown', { code, key: code, shiftKey: !!shift })); dispatchEvent(new KeyboardEvent('keyup', { code, key: code })); },
  view(v) { setView(v); renderFrame(0.016); return W.view; },
  time(m) { setTimeOfDay(m); }, weather(k) { setWeather(k); },
  render(n = 1) { for (let i = 0; i < n; i++) renderFrame(1 / 30); return true; },
  runwayCheck(icao, ident) { const A = World.byIcao.get(icao); const g = airportGeometry(A); const E = g.ends.find(e => e.ident === ident); return { csv: E.hdgCsv, geo: E.hdg, derived: E.derived, len: E.length / FT }; },
  menu() { toMenu(); }, pause(p) { W.paused = p; }, setRes(v) { settings.res = String(v); applyRes(); }, orbitSet(y, p, d) { orbit.yaw = y; orbit.pitch = p; orbit.dist = d; }, chaseSet(y, p, d) { chase.yaw = y; chase.pitch = p; chase.dist = d; chasePos = null; }, lookSet(y, p, f) { look.yaw = y; look.pitch = p; look.fov = f; },
  score: () => lastScore, music, audio, musicWant: () => musicWant(), displays, terrain, city, sky, atc, foot,
  footState() { return { onFoot: W.onFoot, tag: W.onFoot ? foot.zoneTag() : '', prompt: foot.prompt, boarding: !!foot.boarding, boarded: !!foot.boardingDone, pos: foot.pos.toArray().map(v => +v.toFixed(2)) }; },
  footWalk(which, sec = 90) { foot.autoWalk(which === 'out' ? foot.routeOut : foot.routeToCockpit); const n = Math.round(sec * 30); let i = 0; for (; i < n && foot.auto; i++) foot.update(1 / 30, { fwd: 0, side: 0, dyaw: 0, dpitch: 0 }, sky.exposure); return { steps: i, done: !foot.auto, tag: foot.zoneTag(), distSeat: +foot.pos.distanceTo(foot.seat).toFixed(2) }; },
  footStep(sec) { for (let i = 0; i < sec * 30; i++) foot.update(1 / 30, { fwd: 0, side: 0, dyaw: 0, dpitch: 0 }, sky.exposure); },
  footLookAt(yaw, pitch) { foot.yaw = yaw; foot.pitch = pitch; foot.update(0.001, { fwd: 0, side: 0, dyaw: 0, dpitch: 0 }, sky.exposure); },
  interact() { footInteract(); return this.footState(); },
  radio(v) { toggleRadio(v); return atc.options().map(o => o.id); },
  say(id) { atc.choose(id); }, fd() { const dev = W.ils ? ilsDeviation(W.ils, fdm.pos) : null; return fdGuide(fdm, W.ils, dev, fdm.euler()); }, coach() { coachN = 0; updateCoach(); const d = W.ils && ilsDeviation(W.ils, fdm.pos); return { text: $('#coach').textContent, cls: $('#coach').className, hidden: $('#coach').hidden, papi: aids.papiText(), papiState: aids.papiState.slice(), gsDots: d && +d.gsDots.toFixed(2), locDots: d && +d.locDots.toFixed(2), nm: d && +(d.thrDist / NM).toFixed(2), boxes: aids.boxes.filter(b => b.visible).length }; }, handFly() { return handFly(); }, startPushback() { startPushback(); }, pushDone() { return !!(W.push && W.push.done); }, crewState: () => atcCtx.crewState(), atcState() { return { phase: atc.phase, log: atc.log.map(l => (l.who === 'ME' ? 'ME: ' : l.fac + ': ') + l.text), opts: atc.options().map(o => o.id), errors: atc.errors, push: W.push && { done: W.push.done } }; },
  traffic, sys, speech, startEngines, padHud() { updatePadHUD(true); }, atcCtx, W, fdm, toggleRadio, fails, rescue, evacuate, fail(id, o) { return fails.trigger(id, o); }, rescueStep(sec) { aircraft.position.copy(fdm.pos); aircraft.quaternion.copy(fdm.q); aircraft.updateMatrixWorld(true); for (let i = 0; i < sec * 10; i++) rescue.update(0.1, aircraft, { scrape: 0, fire: [sys.fire[0].on, sys.fire[1].on], ground, foamOn: W.foam, smoulder: true }); return rescue.trucks.map(t => ({ parked: t.parked, d: Math.round(t.obj.position.distanceTo(fdm.pos)) })); }, warnings() { return W.S ? W.S.warnings : null; },
  air(o) { // test: put the aircraft in the air (o: { agl, kt, hdg, x, z, ap }) relative to the departure runway when x/z are omitted
    const E = W.end, b = W.primary, P = W.depIls ? W.depIls.thr : fdm.pos; const hdg = o.hdg ?? E.hdg; const x = o.x ?? P.x + E.dir.x * 2500, z = o.z ?? P.z + E.dir.z * 2500;
    fdm.reset({ x, y: ground(x, z).h + (o.agl ?? 1500) * FT, z, hdg, speed: (o.kt ?? 200) * KT, gear: !!o.gear, flaps: o.flaps ?? 1, tl: 0.6, n1: 70, onGround: false, spdSel: o.kt ?? 200, altSel: fdm.ap.alt });
    fdm.engRun = [true, true]; W.push = null; W.autoTaxi = null; if (o.ap !== false) { fdm.ap.on = true; fdm.ap.athr = true; fdm.ap.lat = 'HDG'; fdm.ap.vert = 'ALT'; fdm.ap.hdg = Math.round(hdg); fdm.ap.spd = o.kt ?? 200; } return this.state(); },
  place(o) { if (o.x != null) fdm.pos.x = o.x; if (o.z != null) fdm.pos.z = o.z; if (o.hdg != null) fdm.q.setFromEuler(new THREE.Euler(0, -o.hdg * D2R, 0, 'YXZ')); if (o.v != null) { const h = (o.hdg ?? fdm.euler().hdg) * D2R; fdm.vel.set(Math.sin(h) * o.v, 0, -Math.cos(h) * o.v); } return this.state(); },
  pixel(fx = 0.5, fy = 0.5) { renderFrame(0.016); const gl = renderer.getContext(), c = renderer.domElement, px = new Uint8Array(4); gl.readPixels(Math.floor(c.width * fx), Math.floor(c.height * (1 - fy)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return [...px]; },
  camInfo() { const d = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); return { p: camera.position.toArray().map(v => +v.toFixed(1)), d: d.toArray().map(v => +v.toFixed(2)), near: camera.near, far: camera.far, fov: camera.fov, exp: +sky.exposure.toFixed(2), vis: { term: foot.parts?.term.group.visible, cabin: foot.parts?.cabin.group.visible } }; },
  parkNear() { const st = nearestFreeStand(1e6); if (!st) return null; fdm.vel.set(0, 0, 0); parkAtGate(st); return st.gateName; }, enterArrival() { parkPromptAction(); return this.footState(); }, nextStep() { const s = nextStep(); return s && s.label; },
  deckLook(y, p, fov) { look.yaw = y; look.pitch = p; if (fov) look.fov = fov; look.target = null; }, deckLights(o) { Object.assign(sys.sw, o); },
  deckClick(id, dir) { const c = cockpit.userData.controls && cockpit.userData.controls.find(c => c.id === id); if (c) cockpit.userData.click(c, deckCtx(), dir || 1); return c ? cockpit.userData.desc(c, deckCtx()) : null; },
  deckInfo() { const ud = cockpit.userData; let tris = 0, calls = 0; cockpit.traverse(o => { if (o.isMesh && o.visible !== false) { calls++; const gg = o.geometry; tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } }); return { controls: ud.controls ? ud.controls.length : 0, calls, tris: Math.round(tris), visible: cockpit.visible }; },
  pick(x, y) { const c = pickControl(x, y); return c ? c.id : null; },
  rayAt(x, y) { renderFrame(0.016); ndc.set(x * 2 - 1, -(y * 2 - 1)); camera.updateMatrixWorld(); ray.setFromCamera(ndc, camera); ray.far = 60; const hs = ray.intersectObject(scene, true).filter(h => h.object.visible !== false && h.object.material && h.object.material.visible !== false).slice(0, 3); return hs.map(h => ({ name: h.object.name || h.object.type, parent: h.object.parent?.name, local: aircraft.worldToLocal(h.point.clone()).toArray().map(v => +v.toFixed(3)), d: +h.distance.toFixed(2) })); },
  pa(id, custom) { if (!paOpen) togglePA(true); paSay(id, custom); return this.paState(); }, paOpen(v) { togglePA(v); },
  paState() { return { open: paOpen, lang: pa.lang, signs: { ...W.signs }, comfort: +CC.v.toFixed(1), why: CC.why, log: paLog.map(l => l.who + ': ' + l.text), cabin: !!cabinObj() }; },
  signs(b, sm) { setSigns(b, sm ?? W.signs.smoke); }, comfort(v) { if (v != null) CC.v = v; return CC.v; }, paLang(l) { pa.lang = l; renderPA(); }, cabLook(y, p, rear) { cabLook.yaw = y; cabLook.pitch = p; cabLook.rear = !!rear; },
  cabinLive(sec) { const c = cabinObj(); for (let i = 0; i < sec * 30; i++) c.live(1 / 30, W.simTime + i / 30, null, { belt: W.signs.belt, airborne: !fdm.onGround, comfort: CC.v, visible: false }); },
};

// ---------------------------------------------------------------- boot
(async function boot() {
  try {
    setupComposer();
    $('#loadbar').style.width = '15%'; $('#loadmsg').textContent = 'Loading OurAirports runway data…';
    await loadWorld((p, m) => { $('#loadbar').style.width = (15 + p * 50) + '%'; $('#loadmsg').textContent = m; });
    try { await Promise.race([document.fonts.load('700 40px "Saira Condensed"'), new Promise(r => setTimeout(r, 1500))]); await document.fonts.load('16px "B612 Mono"'); } catch (e) { }
    $('#loadbar').style.width = '70%'; $('#loadmsg').textContent = 'Building the flight deck…'; await new Promise(r => setTimeout(r, 20));
    try { try { await document.fonts.load('600 20px "B612"'); } catch (e) { } const deck = buildCockpit(displays, { quality: settings.quality }); aircraft.remove(cockpit); cockpit = deck; aircraft.add(cockpit); exteriorCasters = null; } catch (e) { errors.push('flight deck: ' + e.message); console.error(e); }
    $('#loadbar').style.width = '75%'; $('#loadmsg').textContent = 'Building Tampa International…';
    buildMenu();
    requestAnimationFrame(frame);
    await startMenuScene();
    $('#loadbar').style.width = '100%';
    showLoad(false);
    window.__sim.ready = true;
  } catch (e) { errors.push('boot: ' + e.message); $('#loadmsg').textContent = 'Could not start: ' + e.message; console.error(e); }
})();
