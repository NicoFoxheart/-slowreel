// Air traffic control: the full IFR flow, with the right unit at each phase and real frequency handoffs:
// ATIS (the letter changes with the hour and the weather) → Delivery (IFR clearance: departure, initial altitude,
// departure frequency, squawk; readback, "readback correct") → Ground (push and start, taxi to the holding point)
// → Tower (line up and wait, takeoff) → Departure → Center / Control (climb, direct, sector handoff, descent)
// → Approach (descent, vectors, speed, ILS clearance) → Tower (landing, go-around) → Ground (vacate, taxi to gate).
// ATC watches the flight: altitude / heading / speed deviations, missing readbacks, missed handoffs (reminder, then
// radio check), runway entry or takeoff without a clearance, unstable approaches (go around). In Easy assist it is
// gentle and the first officer reads back / checks in for you when you are busy.
// Phraseology: FAA style at US airports ("climb and maintain one one thousand", "point"), ICAO elsewhere ("climb
// flight level one five zero", "decimal", QNH). Airline callsigns are never abbreviated; a unit gives its own name on
// first contact only. Every transmission goes through the shared speech manager (speech.js) and the next one waits
// for it to finish, with a short squelch gap. Readbacks are spoken by the first officer in their own voice.
const DIG = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
const digits = (s, dot = 'decimal') => String(s).split('').map(c => c === '.' ? dot : /\d/.test(c) ? DIG[+c] : c === '-' || c === ',' ? '' : c).filter(Boolean).join(' ');
const rwyS = id => { const m = String(id).match(/^(\d+)([LRC]?)$/); if (!m) return id; return digits(m[1].padStart(2, '0')) + (m[2] ? ' ' + { L: 'left', R: 'right', C: 'center' }[m[2]] : ''); };
const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const r100 = ft => Math.round(ft / 100) * 100;
// altitudes: "five thousand five hundred", from 10,000 the thousands digit by digit ("one one thousand"), "flight level two four zero" at or above the transition altitude
const altD = (ft, ta) => { ft = r100(ft); return ft >= ta ? 'FL' + String(ft / 100).padStart(3, '0') : ft.toLocaleString('en-US'); };
const altS = (ft, ta) => { ft = r100(ft); if (ft >= ta) return 'flight level ' + digits(String(ft / 100).padStart(3, '0')); const th = Math.floor(ft / 1000), h = Math.round((ft % 1000) / 100); return [th ? (th >= 10 ? digits(th) : NUMW[th]) + ' thousand' : '', h ? NUMW[h] + ' hundred' : ''].filter(Boolean).join(' ') || 'zero'; };
const hdgD = h => String(Math.round(((h % 360) + 360) % 360) || 360).padStart(3, '0');
const NATO = 'Alfa Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey Xray Yankee Zulu'.split(' ');
const twyS = n => String(n).split('').map(c => /\d/.test(c) ? DIG[+c] : NATO['ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(c)] || c).join(' ');
// message builder: parts are strings (same display/spoken), [display, spoken] pairs or other messages
const M = (...parts) => ({ d: parts.map(p => Array.isArray(p) ? p[0] : p && p.d !== undefined ? p.d : p).join(''), s: parts.map(p => Array.isArray(p) ? p[1] : p && p.s !== undefined ? p.s : p).join('') });
const cap = m => ({ d: m.d.charAt(0).toUpperCase() + m.d.slice(1), s: m.s });
const fstr = mhz => mhz.toFixed(Math.round(mhz * 1000) % 10 ? 3 : 2);
const D2R = Math.PI / 180, R2D = 180 / Math.PI, wrap180 = a => ((a % 360) + 540) % 360 - 180;
const gcNm = (la1, lo1, la2, lo2) => { const p1 = la1 * D2R, p2 = la2 * D2R, dl = (lo2 - lo1) * D2R, dp = p2 - p1; const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h))); };
const gcBrg = (la1, lo1, la2, lo2) => { const p1 = la1 * D2R, p2 = la2 * D2R, dl = (lo2 - lo1) * D2R; return (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * R2D + 360) % 360; };
export const SHORT = { KTPA: 'Tampa', KMIA: 'Miami', RKSI: 'Incheon', KLAX: 'Los Angeles', MPTO: 'Tocumen', KJFK: 'Kennedy', KSFO: 'San Francisco', RKSS: 'Gimpo', RJTT: 'Tokyo', EGLL: 'Heathrow', OMDB: 'Dubai', WSSS: 'Singapore' };
export const REGION_CS = { US: ['Sunfin', 'Pelican', 'Coral', 'Bayhawk', 'Skylark', 'Manatee', 'Seabird', 'Palmetto', 'Osprey', 'Redtail'], KR: ['Hanbit', 'Mirae', 'Arirang', 'Haneul', 'Blue Crane', 'Seorak'], JP: ['Sakura Wing', 'Kestrel', 'Hikari', 'Tsubame'], PA: ['Canal', 'Quetzal', 'Isthmus', 'Toucan', 'Pacifico'], GB: ['Thames', 'Kestrel', 'Albion', 'Speedlink'], AE: ['Falcon', 'Oasis', 'Dune'], SG: ['Merlion', 'Orchid', 'Straits'], default: ['Skylark', 'Kestrel', 'Seabird', 'Osprey', 'Nimbus', 'Aurora'] };
export const DEST_DEFAULT = { KTPA: 'KMIA', KMIA: 'KTPA', RKSI: 'RJTT', RKSS: 'RJTT', RJTT: 'RKSS', KLAX: 'KSFO', KSFO: 'KLAX', MPTO: 'KMIA', KJFK: 'EGLL', EGLL: 'KJFK', OMDB: 'EGLL', WSSS: 'RKSI' };
// [data key, fallback key, simulated base MHz, unit word]; frequencies come from the airport data where it has them (else marked *)
const FAC = { ATIS: ['A', null, 127.85, 'Information'], DEL: ['C', null, 121.9, 'Delivery'], GND: ['G', null, 121.75, 'Ground'], TWR: ['T', null, 118.7, 'Tower'], DEP: ['D', 'P', 124.35, 'Departure'], APP: ['P', 'D', 119.25, 'Approach'], CTR: [null, null, 132.45, 'Center'] };
const CENTER_CC = new Set(['US', 'CA']); // area control is "Center" there, "Control" elsewhere (London Control, Incheon Control)
const TA = { US: 18000, CA: 18000, MX: 18500, KR: 14000, JP: 14000, AU: 10000, NZ: 13000, SG: 11000, AE: 13000, GB: 6000, IE: 5000, FR: 5000, DE: 5000, NL: 3000, ES: 6000, IT: 6000 }; // transition altitudes
const VOICE = { ATIS: { rate: 1.02, pitch: 0.95 }, DEL: { rate: 1.1, pitch: 1.12 }, GND: { rate: 1.08, pitch: 0.88 }, TWR: { rate: 1.14, pitch: 1.18 }, DEP: { rate: 1.12, pitch: 0.82 }, APP: { rate: 1.1, pitch: 1.04 }, CTR: { rate: 1.08, pitch: 0.92 }, ME: { rate: 1.1, pitch: 0.94 } };
const VORD = { DEL: 3, GND: 2, TWR: 0, DEP: 4, APP: 1, CTR: 5, ATIS: 6 };
const DEP_PH = new Set(['gate', 'clr_ok', 'pushing', 'pushed', 'taxiing', 'to_twr', 'twr_hold', 'lineup', 'takeoff_clr', 'rwy_start', 'to_dep', 'dep']);
const ARR_TWR = new Set(['to_twr_arr', 'land_clr', 'twr_continue', 'go_around']);

export function facility(apt, kind) {
  const [k1, k2, base, word0] = FAC[kind]; const f = apt.freq || {};
  const real = k1 ? (f[k1] ?? (k2 ? f[k2] : undefined)) : undefined;
  let h = 0; for (const c of apt.icao + kind) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const mhz = real ?? +(base + ((h % 9) - 4) * 0.025).toFixed(3);
  const word = kind === 'CTR' && !CENTER_CC.has(apt.cc) ? 'Control' : word0;
  const name = (SHORT[apt.icao] || apt.city || apt.name.split(' ')[0]) + ' ' + word;
  return { kind, mhz, real: real != null, name, apt };
}
const fmtF = f => fstr(f.mhz) + (f.real ? '' : '*');
const freqS = f => digits(fstr(f.mhz).replace(/0$/, ''), f.apt.cc === 'US' ? 'point' : 'decimal');

export class ATC {
  constructor(audio) {
    this.audio = audio; this.log = []; this.queue = []; this.auto = false; this.speakMe = true; this.voices = [];
    this.cs = 'Foxheart 412'; this.csS = 'Foxheart four one two'; this.phase = 'idle'; this.listeners = []; this.errors = []; this.tuned = null; this.t = 0;
    this.autoT = 0; this.atisOn = false; this.voicePref = {}; this.chatterOn = true; this.tx = null; this.gapT = 0; this.flags = {}; this.heard = {}; this.atisSt = {}; this.contacted = new Set();
    this.onNote = null; this.fast = false; // fast: pace transmissions on sim time only (headless tests)
    try { const load = () => { this.rankVoices(); this.listeners.forEach(f => { try { f(this, 'voices'); } catch (e) { } }); }; this.rankVoices(); speechSynthesis.addEventListener ? speechSynthesis.addEventListener('voiceschanged', load) : (speechSynthesis.onvoiceschanged = load); } catch (e) { }
  }
  on(f) { this.listeners.push(f); }
  emit() { for (const f of this.listeners) try { f(this); } catch (e) { this.errors.push(String(e)); } }
  note(t) { try { this.onNote && this.onNote(t); } catch (e) { } }
  // ---------------------------------------------------------------- setup per flight
  setup(o) {
    this.o = o; this.dep = o.dep; this.arr = o.arr || o.dep; this.stopAtis(); this.log = []; this.queue = []; this.tx = null; this.gapT = 0;
    this.rb = null; this.ho = null; this.alt = null; this.hdgA = null; this.spdA = null; this.flags = {}; this.heard = {}; this.contacted = new Set(); this.lastInstr = null; this.taxiRoute = null; this.exitName = null; this.minAgl = 1e9; this.chatT = 14; this.chatLog = []; this.phT = 0;
    let sq; do { sq = String(2 + (Math.random() * 5 | 0)) + [0, 0, 0].map(() => Math.random() * 8 | 0).join(''); } while (/^(2000|7000|1200)$/.test(sq)); this.squawk = sq;
    const dep = this.dep, arr = this.arr, d = gcNm(dep.lat, dep.lon, arr.lat, arr.lon), crs = gcBrg(dep.lat, dep.lon, arr.lat, arr.lon);
    let cr = Math.max(8000, Math.min(37000, Math.round(d * 1.4 / 10) * 1000)); if (((cr / 1000) % 2 === 1) !== (crs < 180)) cr += cr >= 37000 ? -1000 : 1000; // semicircular rule: eastbound odd, westbound even
    this.cruise = cr; this.depTop = Math.min(cr, this.ta(dep) >= 10000 ? 11000 : 15000); this.init = Math.min(this.depTop, Math.max(3000, Math.round((dep.elevFt + 5000) / 1000) * 1000));
    this.bottom = Math.min(cr, Math.round((arr.elevFt + (this.ta(arr) >= 10000 ? 11000 : 7000)) / 1000) * 1000); this.appAlt = Math.max(2000, r100(arr.elevFt + 3000)); this.ctrApt = dep;
    let h = 0; for (const c of dep.icao) h = (h * 7 + c.charCodeAt(0)) >>> 0; this.sid = (SHORT[dep.icao] || dep.city || dep.icao) + ' ' + ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'][h % 7];
    this.phase = { gate: 'gate', terminal: 'gate', runway: 'rwy_start', final: 'to_twr_arr', route: 'to_ctr' }[o.start] || 'gate';
    if (this.phase === 'to_twr_arr') { this.ho = { to: 'TWR', from: 'APP', t: 0, n: 0, skipBye: true }; this.flags.appClr = true; this.contacted.add(this.fac('APP').name); }
    if (this.phase === 'to_ctr') { this.ctrApt = arr; this.flags.climbed = true; this.flags.sector = true; this.ho = { to: 'CTR', from: 'CTR', t: 0, n: 0, skipBye: true, quiet: true }; }
    this.tune(this.phase === 'gate' ? 'DEL' : this.phase === 'to_ctr' ? 'CTR' : this.phase === 'to_twr_arr' ? 'APP' : 'TWR', true);
    this.emit();
  }
  apt() { return DEP_PH.has(this.phase) ? this.dep : this.arr; }
  fac(kind, apt) { return facility(apt || (kind === 'DEP' ? this.dep : kind === 'APP' ? this.arr : kind === 'CTR' ? (this.ctrApt || this.dep) : this.apt()), kind); }
  tune(kind, silent) { this.tuned = this.fac(kind); if (kind !== 'ATIS') this.stopAtis(); if (kind === 'ATIS' && !silent) this.startAtis(); this.emit(); }
  setPhase(p) { if (this.phase !== p) { this.phase = p; this.phT = this.t; this.emit(); } }
  ctxS() { return this.o.ctx.state(); }
  easy() { const c = this.o?.ctx; return !!(c && c.assist && c.assist() === 'easy'); }
  // ---------------------------------------------------------------- phrase helpers
  ta(A) { return TA[(A || this.apt()).cc] ?? 7000; }
  usA(A) { return (A || this.apt()).cc === 'US'; }
  CSm() { return [this.cs, this.csS]; }
  Am(ft, A) { const ta = this.ta(A); return [altD(ft, ta), altS(ft, ta)]; }
  cmdAlt(ft, cur, A) { const up = ft > cur, a = this.Am(ft, A); if (this.usA(A)) return M(up ? 'climb and maintain ' : 'descend and maintain ', a); return M(up ? 'climb ' : 'descend ', ft >= this.ta(A) ? a : ['altitude ' + a[0] + ' ft', 'altitude ' + a[1] + ' feet']); }
  altimM(A) { return this.usA(A) ? M('altimeter ', ['29.92', 'two niner niner two']) : M(['QNH ', 'Q N H '], ['1013', 'one zero one three']); }
  hdgM(h, cur) { const d = wrap180(h - cur); return M(Math.abs(d) < 8 ? 'fly heading ' : d > 0 ? 'turn right heading ' : 'turn left heading ', [hdgD(h), digits(hdgD(h))]); }
  freqM(F) { return [fstr(F.mhz), freqS(F)]; }
  contactM(kind, apt) { const F = this.fac(kind, apt); return M('contact ', F.name, ' ', this.freqM(F)); }
  rwyM(id) { return [id, rwyS(id)]; }
  city(A) { return SHORT[A.icao] || A.city || A.icao; }
  idM(kind, apt) { const F = this.fac(kind, apt); if (this.contacted.has(F.name)) return ''; this.contacted.add(F.name); return F.name + ', '; } // a unit names itself on first contact only
  hello() { const m = this.o.ctx.weather().localMin ?? 720; return m < 690 ? 'good morning' : m < 1050 ? 'good afternoon' : 'good evening'; }
  maybeHi(p = 0.45) { return Math.random() < p ? this.hello() + ', ' : ''; }
  altRep(s, tgt, A) { const a = r100(s.altFt); if (tgt == null && Math.abs(s.vsFpm) >= 250) return M(this.Am(a, A), s.vsFpm > 0 ? ' climbing' : ' descending'); if (tgt == null || Math.abs(s.altFt - tgt) < 250 || Math.abs(s.vsFpm) < 250) return M('level ', this.Am(Math.abs(s.altFt - (tgt ?? a)) < 250 ? (tgt ?? a) : a, A)); return M(this.Am(a, A), s.vsFpm > 0 ? ' climbing ' : ' descending ', this.Am(tgt, A)); }
  pick(key, arr) { this._last = this._last || {}; let i = Math.floor(Math.random() * arr.length); if (arr.length > 1 && i === this._last[key]) i = (i + 1) % arr.length; this._last[key] = i; return arr[i]; }
  bye(apt) {
    const c = (apt || this.apt()).icao; const pools = {
      KTPA: ['have a good one', 'see ya', 'good day'], KMIA: ['good day', 'adiós', 'have a good one'], MPTO: ['buen vuelo', 'good day, gracias'],
      RKSI: ['good day', 'have a safe flight'], RKSS: ['good day'], RJTT: ['good day'], EGLL: ['cheers', 'good day', 'bye bye'], OMDB: ['good day'], WSSS: ['good day'] };
    return this.pick('bye', pools[c] || ['good day', 'see ya', 'so long']);
  }
  human(m, pUh) {
    const head = (m.d.split(',')[0] || '').trim();
    if (Math.random() < pUh && /, /.test(m.d) && (/^[A-Za-z ]+ \d{2,4}$/.test(head))) { const f = x => x.replace(/^([^,]+), /, '$1, uh, '); return { d: f(m.d), s: f(m.s) }; }
    return m;
  }
  // ---------------------------------------------------------------- weather / ATIS (the letter moves on with the hour and when the wind or weather changes)
  wx() { return this.o.ctx.weather(); }
  windM() { const w = this.wx(); if (w.kt < 3) return M('wind calm'); const d = hdgD(Math.round(w.dir / 10) * 10), k = Math.round(w.kt); return M('wind ', [d, digits(d)], ' at ', [String(k), String(k)], w.gust ? M(' gusting ', [String(Math.round(k * 1.5)), String(Math.round(k * 1.5))]) : ''); }
  atisLetter(A) {
    const w = this.wx(); let st = this.atisSt[A.icao]; const hr = Math.floor((((w.utcMin + 10) % 1440) + 1440) % 1440 / 60), key = w.kind + ':' + Math.round(w.dir / 10) + ':' + Math.round(w.kt / 4);
    if (!st) { let h = 0; for (const c of A.icao) h = (h * 31 + c.charCodeAt(0)) >>> 0; st = this.atisSt[A.icao] = { i: (h + hr) % 26, hr, key }; }
    else if (st.hr !== hr || st.key !== key) { st.i = (st.i + 1) % 26; st.hr = hr; st.key = key; }
    return NATO[st.i];
  }
  atisText() {
    const A = this.apt(), w = this.wx(), E = A === this.dep && DEP_PH.has(this.phase) ? this.o.depEnd : this.o.ctx.arrEnd(), L = this.atisLetter(A);
    const us = A.cc === 'US'; const name = A.name.replace(/International Airport/, 'International').replace(/ Airport$/, '');
    const vis = w.vis >= 10000 ? (us ? M('visibility one zero') : M('visibility one zero kilometers or more')) : M('visibility ', [String(us ? Math.max(0.25, Math.round(w.vis / 1609 * 4) / 4) + ' SM' : Math.round(w.vis) + ' m'), (us ? String(Math.max(0.25, Math.round(w.vis / 1609 * 4) / 4)) + ' miles' : digits(Math.round(w.vis)) + ' meters')]);
    const cl = { clear: 'sky clear', scattered: 'scattered clouds at four thousand', overcast: 'overcast at two thousand eight hundred', rain: 'light rain, broken one thousand two hundred, overcast two thousand', fog: 'fog, vertical visibility two hundred' }[w.kind] || 'sky clear';
    const t = w.temp; const z = String(Math.floor(((w.utcMin % 1440) + 1440) % 1440 / 60)).padStart(2, '0') + '50'; const r = E ? E.ident : '';
    return M(name, ' information ', L, ', ', [z + 'Z', digits(z) + ' zulu'], '. ', this.windM(), '. ', vis, '. ', cl, '. ', 'temperature ', [String(t), digits(String(Math.abs(t)))], ', dew point ', [String(t - 5), digits(String(Math.abs(t - 5)))], '. ', this.altimM(A), '. ',
      'I L S approaches in use, landing and departing runway ', this.rwyM(r), '. ', us ? 'Read back all runway hold short instructions. ' : '', 'Advise on initial contact you have information ', L, '.');
  }
  startAtis() {
    this.atisOn = true; const A = this.apt(); this.heard[A.icao] = this.atisLetter(A);
    const loop = () => { if (!this.atisOn) return; const m = this.atisText(); this.heard[this.apt().icao] = this.atisLetter(this.apt()); this.say('ATIS', m, () => { if (this.atisOn) this.atisTimer = setTimeout(loop, 2500); }, true); };
    loop();
  }
  stopAtis() { this.atisOn = false; clearTimeout(this.atisTimer); if (this.speech) this.speech.cancel('atis'); this.speakingAtis = false; }
  infoM(A) { const h = this.heard[A.icao]; return h ? M(', information ', h) : ''; } // pilot: "with information Kilo" only if you listened
  infoChk(A) { const cur = this.atisLetter(A); if (this.heard[A.icao] === cur) return ''; this.heard[A.icao] = cur; return M('information ', cur, ' is current, ', this.altimM(A), '. '); }
  // ---------------------------------------------------------------- transmissions
  me(kind, m, delay = 0) { this.dropChatter(); this.push({ who: 'ME', kind, m: this.human(m, 0.03), delay }); this.lastMeT = this.t; }
  atc(kind, m, delay = 1.6, then, x) { this.push(Object.assign({ who: kind, kind, m: this.human(m, 0.07), delay: delay * this.pace() * (0.85 + Math.random() * 0.4), then }, x || {})); }
  other(kind, cs, m, delay = 0.6) { this.push({ who: 'OTHER', cs, kind, m: this.human(m, 0.1), delay, chatter: true }); }
  push(x) { this.queue.push(x); }
  dropChatter() { this.queue = this.queue.filter(x => !x.chatter); if (this.tx && this.tx.chatter && this.speech) this.speech.cancel('chatter'); }
  pace() { return Math.max(0.55, 1 - this.busy() * 0.12); }
  busy() { return Math.min(3, (this.chatLog || []).filter(t => this.t - t < 90).length); }
  waiting() { return this.queue.some(x => x.reply); } // a reply to your call is on its way
  // ---------------------------------------------------------------- voices: rank natural voices; the first officer keeps a voice no controller uses
  rankVoices() {
    let all = []; try { all = speechSynthesis.getVoices(); } catch (e) { }
    const score = v => (/natural|neural/i.test(v.name) ? 60 : 0) + (/online/i.test(v.name) ? 40 : 0) + (/google/i.test(v.name) ? 25 : 0) + (/microsoft/i.test(v.name) ? 8 : 0) + (/^en-(US|GB|AU|IE|CA)/i.test(v.lang) ? 10 : 0) + (v.localService === false ? 5 : 0) - (/compact|espeak/i.test(v.name) ? 30 : 0);
    this.allVoices = all; const en = all.filter(v => /^en/i.test(v.lang)).sort((a, b) => score(b) - score(a)); const good = en.filter(v => !/espeak|compact/i.test(v.name)); this.voices = good.length ? good : en;
  }
  voiceFor(who, cs) {
    const pref = this.voicePref || {}; const V = this.voices; if (!V.length) return null; const n = Math.min(V.length, 8), me = n > 2 ? 2 : n - 1;
    const byName = nm => nm && nm !== 'auto' ? (this.allVoices || []).find(v => v.name === nm) : null;
    if (who === 'ME') return byName(pref.pilot) || V[me];
    const others = []; for (let i = 0; i < n; i++) if (i !== me || n === 1) others.push(i);
    if (who === 'OTHER') { let h = 0; for (const c of cs || '') h = (h * 31 + c.charCodeAt(0)) >>> 0; return V[others[h % others.length]]; }
    return byName(pref.controller) || V[others[(VORD[who] ?? 0) % others.length]];
  }
  say(kind, m, done, atis, cs) {
    const f = kind === 'ME' || kind === 'OTHER' ? (this.tuned || this.fac('TWR')) : this.fac(kind);
    const fac = kind === 'ME' ? this.cs : kind === 'OTHER' ? cs : f.name;
    m = { d: m.d.replace(/(^|[.!?] )([a-z])/g, (_, a, b) => a + b.toUpperCase()), s: m.s }; // sentence case for the subtitles and the log
    if (!atis || !this.log.length || this.log[this.log.length - 1].text !== m.d) this.log.push({ who: kind, fac, text: m.d, t: this.t, atis: !!atis, other: kind === 'OTHER' });
    if (this.log.length > 80) this.log.shift();
    this.emit();
    const A = this.audio; const est = Math.min(22, 0.9 + m.s.length * 0.06 / this.pace());
    let ended = false; const fin = () => { if (ended) return; ended = true; A && A.radioClose && A.radioClose(); this.speakingAtis = false; done && done(); };
    const speak = (kind !== 'ME' || this.speakMe) && this.audio?.voice !== false && this.voiceOn !== false;
    if (!this.voices.length) this.rankVoices();
    if (this.speech) { // shared speech manager: one queue with priorities; squelch tied to the real start / end
      const vc = VOICE[kind === 'OTHER' ? 'APP' : kind] || VOICE.TWR; let h = 0; for (const c of (cs || kind)) h = (h * 17 + c.charCodeAt(0)) >>> 0;
      const pitch = kind === 'OTHER' ? 0.82 + (h % 7) * 0.06 : vc.pitch, vol = Math.min(1, ((this.audio?.vol ?? 0.7) + 0.2) * (kind === 'OTHER' ? 0.72 + (h % 5) * 0.05 : 1));
      const id = this.speech.say({ text: m.s, display: m.d, who: kind === 'ME' ? this.cs.toUpperCase() + ' · FO' : kind === 'OTHER' ? cs : fac, channel: atis ? 'atis' : kind === 'OTHER' ? 'chatter' : 'atc', voice: () => this.voiceFor(kind, cs), lang: 'en-US',
        rate: vc.rate * (1 + this.busy() * 0.05) * (0.96 + Math.random() * 0.08), pitch, volume: vol, mute: !speak, maxWait: kind === 'OTHER' ? 10 : 0,
        onstart: () => A && A.radioOpen && A.radioOpen(kind === 'ME', kind === 'OTHER' ? 0.6 : 1), onend: fin });
      this.speakingAtis = !!atis; return { id, est };
    }
    A && A.radioOpen && A.radioOpen(kind === 'ME', 1); setTimeout(fin, est * 1000); return { id: null, est };
  }
  txDone() {
    const x = this.tx, sp = this.speech, simT = this.t - x.t0, real = performance.now() - x.real;
    if (x.id != null && sp) { if (!((sp.cur && sp.cur.id === x.id) || sp.items.some(i => i.id === x.id))) return true; }
    else if (real > x.est * 1000) return true;
    return this.fast ? simT > x.est : real > x.est * 2500 + 5000; // watchdog
  }
  pumpTx(dt) {
    if (this.tx) { if (!this.txDone()) return; this.tx = null; this.gapT = 0.3 + Math.random() * 0.5; }
    if (this.gapT > 0) { this.gapT -= dt; return; }
    const x = this.queue[0]; if (!x) return;
    if (x.delay > 0) { x.delay -= dt; return; }
    this.queue.shift(); if (x.stale && x.stale()) return;
    if (x.who === 'STEPON') { this.audio?.stepOn && this.audio.stepOn(); this.log.push({ who: 'OTHER', fac: '—', text: '(two stations transmitting at once: squeal)', t: this.t, other: true }); this.tx = { id: null, est: 1.4, t0: this.t, real: performance.now(), chatter: true }; this.emit(); return; }
    if (x.who === 'ME') this.tune(x.kind, true); else if (!x.chatter && this.tuned?.kind !== 'ATIS' && this.tuned?.name !== this.fac(x.kind).name) this.tune(x.kind, true);
    if (x.rb) this.rb = Object.assign({ kind: x.kind, t: this.t, nag: 0 }, x.rb);
    if (x.ho) this.ho = Object.assign({ t: this.t, n: 0 }, x.ho);
    if (!x.chatter && x.who !== 'ME' && (x.rb || x.ho || x.instr)) this.lastInstr = { kind: x.kind, m: x.m, t: this.t };
    const r = this.say(x.who === 'ME' ? 'ME' : x.who === 'OTHER' ? 'OTHER' : x.kind, x.m, null, false, x.cs);
    this.tx = { id: r.id, est: r.est, t0: this.t, real: performance.now(), chatter: !!x.chatter }; if (x.chatter) this.chatLog.push(this.t);
    x.then && x.then(); this.emit();
  }
  update(dt) {
    this.t += dt; if (!this.o) return;
    try { this.pumpTx(dt); this.fT = (this.fT || 0) + dt; if (this.fT >= 0.25) { const d = this.fT; this.fT = 0; this.follow(d); this.chatter(d); this.assistStep(); } } // the controller looks at the scope 4x a second
    catch (e) { if (this.errors.length < 20) this.errors.push(String(e && e.stack || e)); }
    if (this.auto && !this.queue.length && !this.tx) { this.autoT += dt; if (this.autoT > 2.5) { this.autoT = 0; const o = this.options().find(o => o.auto); if (o) this.choose(o.id); } } else this.autoT = 0;
  }
  // Easy assist: the first officer reads back and checks in if you have not after a while
  assistStep() {
    if (this.auto || this.queue.length || this.tx || !this.easy()) return;
    if (this.rb && this.t - this.rb.t > 9) { this.note('First officer: read back “' + this.rb.label + '”'); this.choose('rb'); return; }
    if (this.ho && !this.rb && this.t - this.ho.t > 40) { this.note('First officer: switched to ' + this.fac(this.ho.to, this.ho.apt).name); this.choose('ho'); }
  }
  // ---------------------------------------------------------------- the living frequency: other aircraft
  chatter(dt) {
    if (this.chatterOn === false || !this.tuned || ['ATIS', 'DEL'].includes(this.tuned.kind)) return;
    this.chatT = (this.chatT ?? 12) - dt; if (this.chatT > 0 || this.queue.length || this.tx) return;
    if (this.flags.emer || this.rb || this.ho || this.t - (this.lastMeT ?? -99) < 10 || ['twr_hold', 'lineup', 'takeoff_clr', 'go_around'].includes(this.phase)) { this.chatT = 6; return; } // never step on your calls
    const s = this.ctxS(); if (ARR_TWR.has(this.phase) && !s.onGround && s.aglFt < 1500) { this.chatT = 8; return; }
    this.chatT = 26 + Math.random() * 30;
    const k = this.tuned.kind, A = this.tuned.apt, F = this.tuned.name, c = this.o.ctx; const w = this.windM(); const ta = this.ta(A);
    const lines = REGION_CS[A.cc] || REGION_CS.default; const air = this.pick('air', lines); const num = String(100 + Math.floor(Math.random() * 880));
    const cs = air + ' ' + num, csS = air + ' ' + digits(num);
    const E = (k === 'TWR' || k === 'GND') ? (A === this.dep && DEP_PH.has(this.phase) ? this.o.depEnd : c.arrEnd()) : c.arrEnd(); const r = E ? E.ident : '27';
    const R = this.rwyM(r); const CS = [cs, csS];
    const twy = this.pick('twy', ['A', 'B', 'C', 'J', 'K']) + (Math.random() < 0.5 ? String(1 + (Math.random() * 4 | 0)) : '');
    const alt = (5 + (Math.random() * 6 | 0)) * 1000, alt2 = alt - 2000, AA = ft => [altD(ft, ta), altS(ft, ta)];
    const stepOn = Math.random() < 0.07;
    const ai = c.traffic ? c.traffic().find(a => !a.called && (k === 'TWR' ? (a.kind === 'arr' && a.s > -9000 && a.s < -1500) || (a.kind === 'dep' && a.hold > 0) : false)) : null;
    if (ai) { ai.called = true; ai.cs = ai.cs || cs; }
    const scripts = {
      GND: () => { this.other(k, cs, M(F, ', ', CS, ', ', this.hello(), ', stand ', [String(2 + (Math.random() * 20 | 0)), ''], ', request taxi.'), 0.2); this.atc(k, M(CS, ', runway ', R, ', taxi via ', [twy, twyS(twy)], ', hold short runway ', R, '.'), 1.2, null, { chatter: true }); this.other(k, cs, M('Runway ', R, ' via ', [twy, twyS(twy)], ', hold short, ', CS, '.'), 0.8); },
      TWR: () => {
        if (ai && ai.kind === 'dep') { this.atc(k, M([ai.cs, ai.cs], ', ', w, ', runway ', R, ', cleared for takeoff.'), 0.3, null, { chatter: true }); this.other(k, ai.cs, M('Cleared for takeoff ', R, ', ', [ai.cs, ai.cs], '.'), 0.7); return; }
        const n = ai ? Math.max(2, Math.round(-ai.s / 1852)) : 3 + (Math.random() * 6 | 0); const c2 = ai ? [ai.cs, ai.cs] : CS;
        this.other(k, c2[0], M(F, ', ', c2, ', ', [String(n), String(n)], ' mile final runway ', R, '.'), 0.2);
        if (stepOn) { this.push({ who: 'STEPON', kind: k, delay: 0.2, chatter: true }); this.atc(k, M(this.pick('blk', ['Blocked, say again.', 'Two stations at once, last station say again.', 'Blocked, aircraft calling final, say again.'])), 0.6, null, { chatter: true }); this.other(k, c2[0], M(F, ', ', c2, ', ', [String(n), String(n)], ' mile final, ', R, '.'), 0.6); }
        this.atc(k, M(c2, ', ', w, ', runway ', R, ', cleared to land.'), 1.0, null, { chatter: true }); this.other(k, c2[0], M('Cleared to land ', R, ', ', c2, '.'), 0.7);
      },
      APP: () => { this.other(k, cs, M(F, ', ', CS, ', ', AA(alt), ' descending ', AA(alt2), ', information ', this.atisLetter(A), '.'), 0.2); this.atc(k, M(CS, ', ', F, ', ', this.pick('ident', ['radar contact, ', '', 'roger, ']), this.cmdAlt(alt2 - 1000, alt, A), ', expect I L S runway ', R, '.'), 1.1, null, { chatter: true }); this.other(k, cs, M(this.cmdAlt(alt2 - 1000, alt, A), ', I L S ', R, ', ', CS, '.'), 0.7); },
      DEP: () => { const fl = (180 + (Math.random() * 10 | 0) * 10) * 100; this.other(k, cs, M(F, ', ', CS, ', ', AA(alt2), ' climbing ', AA(alt), '.'), 0.2); this.atc(k, M(CS, ', ', F, ', radar contact, ', this.cmdAlt(fl, alt, A), '.'), 1.0, null, { chatter: true }); this.other(k, cs, M(this.cmdAlt(fl, alt, A), ', ', CS, '.'), 0.7); },
      CTR: () => { const fl = (300 + (Math.random() * 8 | 0) * 10) * 100, hd = 10 * (1 + (Math.random() * 35 | 0)); if (Math.random() < 0.5) { this.other(k, cs, M(F, ', ', CS, ', level ', AA(fl), '.'), 0.2); this.atc(k, M(CS, ', ', F, ', roger.'), 0.9, null, { chatter: true }); } else { this.atc(k, M(CS, ', ', this.hdgM(hd, hd + 40), ', direct when able.'), 0.3, null, { chatter: true }); this.other(k, cs, M(this.hdgM(hd, hd + 40), ', ', CS, '.'), 0.8); } },
    };
    if (scripts[k]) scripts[k]();
  }
  // ---------------------------------------------------------------- what the pilot can say now (short; the first one is the smart "next step")
  options() {
    const c = this.o?.ctx; if (!c) return []; const s = c.state(); const p = this.phase; const out = []; const E = this.o.depEnd;
    const add = (id, kind, label, auto = true, pri = true, apt) => out.push({ id, kind, label, auto, pri, freq: fmtF(this.fac(kind, apt)) });
    if (this.rb) add('rb', this.rb.kind, 'Read back: ' + this.rb.label);
    else if (this.ho) { const F = this.fac(this.ho.to, this.ho.apt); add('ho', this.ho.to, `${this.ho.skipBye ? 'Call' : 'Switch to'} ${F.name} ${fstr(F.mhz)}${this.ho.to === 'GND' ? ': request taxi to the gate' : this.ho.to === 'TWR' && DEP_PH.has(p) ? ': ready for departure' : ''}`, true, true, this.ho.apt); }
    else if (!this.waiting()) switch (p) {
      case 'gate': add('clr', 'DEL', `Request IFR clearance to ${this.city(this.arr)}`); break;
      case 'clr_ok': add('push', 'GND', 'Request pushback and start'); break;
      case 'pushed': add('taxi', 'GND', 'Request taxi'); break;
      case 'taxiing': if (c.nearHold() || s.onDepRwy) add('ready', 'TWR', `Tower: holding short ${E.ident}, ready for departure`); break;
      case 'rwy_start': add('ready', 'TWR', `Ready for departure, runway ${E.ident}`); break;
      case 'ctr': if (!this.flags.desc && s.distArrNm < this.todNm(s) + 40) add('descent', 'CTR', 'Request descent', s.distArrNm < this.todNm(s) + 5); break;
      case 'app': if (!this.flags.appClr && s.distArrNm < 40) add('ils', 'APP', `Request the ILS runway ${c.arrEnd().ident}`, false, false); break;
    }
    const em = c.emergency && c.emergency();
    if (!this.flags.emer && (!s.onGround || s.gsKt > 30 || em)) { const k = this.curK(); add('mayday', k, em ? `MAYDAY: ${em.nature}` : 'MAYDAY (declare an emergency)', false, !!em && em.kind === 'mayday'); add('pan', k, em ? `PAN-PAN: ${em.nature}` : 'PAN-PAN (urgency)', false, !!em && em.kind === 'pan'); }
    if (this.flags.emer && !this.waiting() && (!em || (s.onGround && s.gsKt < 5))) add('cancel', this.curK(), s.onGround ? `Cancel ${this.flags.emer === 'mayday' ? 'MAYDAY' : 'PAN-PAN'}, vacate the runway` : `Cancel ${this.flags.emer === 'mayday' ? 'MAYDAY' : 'PAN-PAN'}`, false, true);
    if (this.atisWanted(s)) { const A = this.apt(); add('atis', 'ATIS', `Listen to ATIS (${this.city(A)})`, false, false); }
    if (this.flags.tfc) { const k = this.tuned?.kind || 'APP'; add('tfc_sight', k, 'Traffic in sight', false, false); add('tfc_look', k, 'Looking for the traffic', true, false); }
    if (this.lastInstr && this.t - this.lastInstr.t < 150 && !this.waiting()) add('sayagain', this.lastInstr.kind, 'Say again', false, false);
    return out;
  }
  atisWanted(s) { if (this.atisOn) return false; const p = this.phase; if (s.onGround) return ['gate', 'clr_ok', 'pushing', 'pushed', 'rwy_start'].includes(p); return ['ctr', 'to_ctr', 'to_app', 'app'].includes(p) && s.distArrNm < 140 && this.heard[this.arr.icao] !== this.atisLetter(this.arr); }
  todNm(s) { return 38 + Math.max(0, (s.altFt - this.bottom) / 1000) * 3; }
  // ---------------------------------------------------------------- pilot choice → transmission(s) and the controller's reply
  choose(id) {
    const c = this.o?.ctx; if (!c) return; const CS = this.CSm();
    switch (id) {
      case 'atis': this.tune('ATIS'); return;
      case 'sayagain': { const L = this.lastInstr; if (!L) return; this.me(L.kind, M('Say again, ', CS, '.')); this.atc(L.kind, L.m, 1.3, null, { reply: true }); return; }
      case 'tfc_look': { const k = this.tuned?.kind || 'APP'; this.flags.tfc = false; this.me(k, M(this.pick('look', ['Looking, ', 'Looking for the traffic, ', 'Negative contact, looking, ']), CS, '.')); this.atc(k, M(CS, ', ', this.pick('tfcAck', ['roger, I will advise.', 'roger.', 'roger, traffic no factor.'])), 1.6, null, { reply: true }); this.emit(); return; }
      case 'tfc_sight': { const k = this.tuned?.kind || 'APP'; this.flags.tfc = false; this.me(k, M(this.pick('sight', ['Traffic in sight, ', 'Got the traffic, ', 'In sight, ']), CS, '.')); this.atc(k, M(CS, ', ', this.pick('vis', ['thank you.', 'roger, maintain visual separation.', 'thanks.'])), 1.6, null, { reply: true }); this.emit(); return; }
      case 'rb': return this.readback();
      case 'ho': return this.checkIn();
      case 'clr': return this.reqClearance();
      case 'push': return this.reqPush();
      case 'taxi': return this.reqTaxi();
      case 'ready': return this.reqDeparture();
      case 'descent': return this.reqDescent();
      case 'mayday': case 'pan': return this.declare(id);
      case 'cancel': return this.cancelEmer();
      case 'ils': { const re = c.arrEnd(); this.me('APP', M(this.fac('APP').name, ', ', CS, ', request the I L S runway ', this.rwyM(re.ident), '.')); this.atc('APP', M(CS, ', roger, expect vectors for the I L S runway ', this.rwyM(re.ident), '.'), 1.6, null, { reply: true }); this.flags.ilsReq = true; return; }
    }
  }
  // the first officer reads back the pending instruction; some units confirm ("readback correct"), then whatever it unlocks happens
  readback() {
    const r = this.rb; if (!r) return; this.rb = null; this.me(r.kind, r.m);
    if (r.fcu) this.o.ctx.fcu && this.o.ctx.fcu(r.fcu);
    if (r.ok) this.atc(r.kind, r.ok, 1.4, null, { reply: true }); r.then && r.then(); this.emit();
  }
  assignAlt(ft) { this.alt = { ft, t: this.t, reached: false, warnT: -1e9 }; }
  assignHdg(h, fix) { this.hdgA = h == null ? null : { hdg: h, fix, t: this.t, bad: 0, warnT: -1e9 }; }
  assignSpd(kt) { this.spdA = kt == null ? null : { kt, t: this.t, warnT: -1e9 }; }
  reqClearance() {
    const dep = this.dep, arr = this.arr, CS = this.CSm(), D = this.fac('DEL'), us = this.usA(dep), dF = this.fac('DEP'), sq = [this.squawk, digits(this.squawk)];
    this.me('DEL', M(D.name, ', ', CS, ', ', this.maybeHi(), 'gate ', [this.o.gate, digits(this.o.gate)], this.infoM(dep), ', request I F R clearance to ', this.city(arr), '.'));
    const exp = this.cruise > this.init ? M(', expect ', this.Am(this.cruise, dep), ' one zero minutes after departure') : '';
    const sidM = M('via the ', this.sid, ' departure, radar vectors, then as filed');
    const m = us ? M(CS, ', ', this.idM('DEL'), this.infoChk(dep), 'cleared to ', this.city(arr), ' airport ', sidM, '. ', this.cmdAlt(this.init, 0, dep), exp, '. Departure frequency ', this.freqM(dF), ', squawk ', sq, '.')
      : M(CS, ', ', this.idM('DEL'), this.infoChk(dep), 'cleared to ', this.city(arr), ' ', sidM, '. ', this.cmdAlt(this.init, 0, dep), '. Squawk ', sq, ', departure frequency ', this.freqM(dF), '.');
    const rbm = M('Cleared to ', this.city(arr), ' via the ', this.sid, ' departure, radar vectors, ', this.cmdAlt(this.init, 0, dep), ', departure ', this.freqM(dF), ', squawk ', sq, ', ', CS, '.');
    const ok = M(CS, ', readback correct', this.pick('gndNext', ['. ', '. When ready to push, ', '. ']), M(this.pick('gndN2', ['contact ', 'call ']), this.fac('GND').name, ' ', this.freqM(this.fac('GND')), '.'));
    this.atc('DEL', m, 2.2, null, { reply: true, rb: { label: `${this.city(arr)} via ${this.sid}, ${altD(this.init, this.ta(dep))}, squawk ${this.squawk}`, m: rbm, ok, fcu: { alt: this.init }, then: () => { this.setPhase('clr_ok'); } } });
  }
  reqPush() {
    const c = this.o.ctx, CS = this.CSm(), G = this.fac('GND'), E = this.o.depEnd;
    this.me('GND', M(G.name, ', ', CS, ', ', this.maybeHi(0.3), 'gate ', [this.o.gate, digits(this.o.gate)], this.contacted.has(this.fac('DEL').name) ? '' : this.infoM(this.dep), ', ', this.pick('pushReq', ['request push and start', 'ready to push and start', 'request pushback']), '.'));
    const face = c.pushFace(), tail = this.pick('face', ['face ', 'tail ']); const dirW = tail === 'face ' ? face : { north: 'south', south: 'north', east: 'west', west: 'east', 'north-east': 'south-west', 'south-west': 'north-east', 'north-west': 'south-east', 'south-east': 'north-west' }[face] || face;
    const app = M(this.pick('pushOk', ['push and start approved, ', 'push and start at your discretion, ', 'push approved, ']), tail, dirW);
    this.atc('GND', M(CS, ', ', this.idM('GND'), app, (Math.random() < 0.5 ? M(', expect runway ', this.rwyM(E.ident)) : ''), '.'), 2, null,
      { reply: true, rb: { label: `push and start, ${tail}${dirW}`, m: M(cap(app), ', ', CS, '.'), then: () => { this.setPhase('pushing'); if (!c.pushing()) c.startPushback(); } } });
  }
  taxiInstr(r, E) { // US: "runway 19R, taxi via B, A, hold short runway 19R at A1"; ICAO: "taxi to holding point A1 runway 19R via B, A"
    const T = r.via.map(n => [n, twyS(n)]).flatMap((x, i) => i ? [', ', x] : [x]); const R = this.rwyM(E.ident);
    return this.usA(this.dep) ? M('runway ', R, ', taxi via ', ...T, ', hold short runway ', R, ' at ', [r.hold, twyS(r.hold)]) : M('taxi to holding point ', [r.hold, twyS(r.hold)], ' runway ', R, ' via ', ...T);
  }
  issueTaxi(delay, prefix) {
    const c = this.o.ctx, CS = this.CSm(), E = this.o.depEnd; const r = c.taxiOut(); this.taxiRoute = r; const ins = this.taxiInstr(r, E);
    this.atc('GND', M(CS, ', ', this.idM('GND'), prefix || '', ins, '.'), delay, () => { c.showTaxi(r); this.setPhase('taxiing'); },
      { reply: true, rb: { label: `taxi via ${r.via.join(', ')}, hold short ${E.ident} at ${r.hold}`, m: M(cap(ins), ', ', CS, '.') } });
  }
  reqTaxi() { const CS = this.CSm(); this.me('GND', M(this.contacted.has(this.fac('GND').name) ? '' : this.fac('GND').name + ', ', CS, ', request taxi.')); this.issueTaxi(2); }
  reqDeparture(viaHo) {
    const CS = this.CSm(), E = this.o.depEnd, T = this.fac('TWR'), s = this.ctxS(); const onRwy = this.phase === 'rwy_start' || s.onDepRwy;
    this.me('TWR', M(T.name, ', ', CS, ', ', onRwy ? M('runway ', this.rwyM(E.ident), ', ready for departure.') : M('holding short runway ', this.rwyM(E.ident), ', ready for departure.')), viaHo ? 0.9 : 0);
    this.towerDep(2, onRwy);
  }
  towerDep(delay, onRwy) {
    const c = this.o.ctx, CS = this.CSm(), E = this.o.depEnd, R = this.rwyM(E.ident); const b = c.runwayBusy(this.dep, E); const id = this.idM('TWR');
    if (b.busy) { const hs = onRwy ? M('hold position, ', b.why) : M('hold short runway ', R, ', ', b.why); this.atc('TWR', M(CS, ', ', id, hs, '.'), delay, () => this.setPhase('twr_hold'), { reply: true, rb: { label: onRwy ? 'hold position' : `hold short ${E.ident}`, m: M(onRwy ? 'Holding position' : M('Holding short runway ', R), ', ', CS, '.') } }); return; }
    if (onRwy || Math.random() < 0.55) this.clearTakeoff(delay, id); else this.lineUp(delay, id);
  }
  lineUp(delay, id = '') { const CS = this.CSm(), E = this.o.depEnd, R = this.rwyM(E.ident); this.atc('TWR', M(CS, ', ', id, 'runway ', R, ', line up and wait.'), delay, () => this.setPhase('lineup'), { reply: true, rb: { label: `line up and wait ${E.ident}`, m: M('Line up and wait runway ', R, ', ', CS, '.') } }); }
  clearTakeoff(delay, id = '') {
    const E = this.o.depEnd, CS = this.CSm(), R = this.rwyM(E.ident);
    this.atc('TWR', M(CS, ', ', id, this.windM(), ', runway ', R, ', cleared for takeoff.'), delay, () => { this.setPhase('takeoff_clr'); this.flags.tkoClr = true; }, { reply: true, rb: { label: `cleared for takeoff ${E.ident}`, m: M('Cleared for takeoff runway ', R, ', ', CS, '.') } });
  }
  clearLanding(delay, pre) {
    const re = this.o.ctx.arrEnd(), CS = this.CSm(), R = this.rwyM(re.ident);
    this.atc('TWR', M(CS, ', ', this.idM('TWR'), pre || '', this.windM(), ', runway ', R, ', cleared to land', this.flags.emer ? ', fire and rescue are standing by' : '', '.'), delay, () => { this.setPhase('land_clr'); this.ho = null; }, { reply: true, rb: { label: `cleared to land ${re.ident}`, m: M('Cleared to land runway ', R, ', ', CS, '.') } });
  }
  // direct to a real navaid near the destination when there is one, else a vector toward it
  routeInstr(s) {
    const c = this.o.ctx, fx = c.fixNear && c.fixNear(this.arr); const tgt = fx || this.arr; const brg = gcBrg(s.lat, s.lon, tgt.lat, tgt.lon); const dist = gcNm(s.lat, s.lon, tgt.lat, tgt.lon);
    if (fx && dist < 400) return { m: M('proceed direct ', [fx.id, twyS(fx.id)]), label: 'direct ' + fx.id, hdg: Math.round(brg), fix: fx };
    const h = Math.round(brg / 5) * 5; return { m: this.hdgM(h, s.trk), label: 'heading ' + hdgD(h), hdg: h, fix: null };
  }
  checkIn() {
    const h = this.ho; if (!h) return; const c = this.o.ctx, s = this.ctxS(), CS = this.CSm(); const F = this.fac(h.to, h.apt), old = this.fac(h.from);
    if (!h.skipBye) this.me(h.from, M(this.freqM(F), ', ', Math.random() < 0.75 ? this.bye(old.apt) + ', ' : '', CS, '.'));
    this.ho = null; if (h.to === 'CTR' && h.apt) this.ctrApt = h.apt; const d = h.skipBye ? 0 : 1.1;
    switch (h.to) {
      case 'TWR': if (DEP_PH.has(this.phase)) { this.reqDeparture(true); return; }
        { const re = c.arrEnd(), nm = Math.max(1, Math.round(s.thrNm)); this.me('TWR', M(F.name, ', ', CS, ', ', [String(nm), digits(nm)], ' mile final, I L S runway ', this.rwyM(re.ident), '.'), d);
          const b = c.runwayBusy(this.arr, re);
          if (b.busy) this.atc('TWR', M(CS, ', ', this.idM('TWR'), 'continue approach, ', b.why, '.'), 2, () => this.setPhase('twr_continue'), { reply: true, instr: true });
          else this.clearLanding(2); return; }
      case 'DEP': {
        this.me('DEP', M(F.name, ', ', CS, ', ', this.maybeHi(0.3), this.altRep(s, this.alt?.ft ?? this.init, this.dep), '.'), d);
        const ri = this.routeInstr(s), climb = this.depTop;
        const ins = M(this.cmdAlt(climb, s.altFt, this.dep), ', ', ri.m);
        this.atc('DEP', M(CS, ', ', this.idM('DEP'), 'radar contact, ', ins, '.'), 2, () => this.setPhase('dep'),
          { reply: true, rb: { label: `${altD(climb, this.ta(this.dep))}, ${ri.label}`, m: M(cap(ins), ', ', CS, '.'), fcu: { alt: climb, hdg: ri.hdg }, then: () => { this.assignAlt(climb); this.assignHdg(ri.hdg, ri.fix); } } });
        return; }
      case 'CTR': {
        const A = this.ctrApt; this.me('CTR', M(F.name, ', ', CS, ', ', this.altRep(s, this.alt?.ft ?? null, A), '.'), d);
        if (!this.flags.climbed && this.cruise > s.altFt + 500) { this.flags.climbed = true; const ins = this.cmdAlt(this.cruise, s.altFt, A);
          this.atc('CTR', M(CS, ', ', this.idM('CTR', A), 'roger, ', ins, '.'), 2, () => this.setPhase('ctr'), { reply: true, rb: { label: altD(this.cruise, this.ta(A)), m: M(cap(ins), ', ', CS, '.'), fcu: { alt: this.cruise }, then: () => this.assignAlt(this.cruise) } }); }
        else { this.flags.climbed = true; this.atc('CTR', M(CS, ', ', this.idM('CTR', A), (this.usA(A) && Math.random() < 0.5 ? M('roger, ', this.city(A), ' altimeter ', ['29.92', 'two niner niner two'], '.') : this.pick('ctrR', ['roger.', 'radar contact.']))), 2, () => this.setPhase('ctr'), { reply: true }); if (!this.alt) this.assignAlt(r100(s.altFt)); }
        return; }
      case 'APP': {
        const A = this.arr, re = c.arrEnd(), R = this.rwyM(re.ident);
        this.me('APP', M(F.name, ', ', CS, ', ', this.flags.ga ? M('missed approach, ', this.altRep(s, this.alt?.ft ?? this.appAlt, A)) : this.altRep(s, this.alt?.ft ?? null, A), this.flags.ga ? '' : this.infoM(A), '.'), d);
        const g = c.approachGeo(); const tgtAlt = this.appAlt;
        const onRoute = c.onRoute && c.onRoute(); const hd = Math.round(g.ipHdg / 5) * 5; const spd = !this.flags.ga && s.ias > 228 ? 210 : null;
        const ins = M(tgtAlt < s.altFt - 300 ? M(this.cmdAlt(tgtAlt, s.altFt, A), ', ') : M('maintain ', this.Am(tgtAlt, A), ', '), onRoute ? M('continue on your route, expect the I L S runway ', R) : M(this.hdgM(hd, s.trk), ', vectors I L S runway ', R), spd ? M(', reduce speed to ', [spd + ' kt', digits(spd) + ' knots']) : '');
        this.atc('APP', M(CS, ', ', this.idM('APP'), this.flags.ga ? 'radar contact. ' : this.infoChk(A), ins, '.'), 2.2, () => { this.setPhase('app'); this.flags.vecT = this.t; },
          { reply: true, rb: { label: `${altD(tgtAlt, this.ta(A))}${onRoute ? ', own navigation' : ', heading ' + hdgD(hd)}${spd ? ', ' + spd + ' kt' : ''}`, m: M(cap(ins), ', ', CS, '.'), fcu: { alt: tgtAlt, hdg: onRoute ? null : hd, spd }, then: () => { this.assignAlt(tgtAlt); this.assignHdg(onRoute ? null : hd); this.assignSpd(spd); } } });
        this.flags.ga = false; return; }
      case 'GND': {
        const A = this.arr, re = c.arrEnd(), ex = this.exitName; this.me('GND', M(F.name, ', ', CS, ', clear of runway ', this.rwyM(re.ident), ex ? M(' at ', [ex, twyS(ex)]) : '', ', request taxi to the gate.'), d);
        const r = c.taxiIn(); this.taxiRoute = r; const T = r.via.map(n => [n, twyS(n)]).flatMap((x, i) => i ? [', ', x] : [x]);
        const ins = M('taxi to gate ', [r.gate, digits(r.gate)], ' via ', ...T);
        this.atc('GND', M(CS, ', ', this.idM('GND'), this.pick('welc', ['', 'welcome to ' + this.city(A) + ', ']), ins, '.'), 2, () => { c.showTaxi(r); this.setPhase('taxi_in'); },
          { reply: true, rb: { label: `gate ${r.gate} via ${r.via.join(', ')}`, m: M('Taxi to gate ', [r.gate, digits(r.gate)], ' via ', ...T, ', ', CS, '.') } });
        return; }
    }
  }
  reqDescent() {
    const s = this.ctxS(), CS = this.CSm(), A = this.ctrApt; this.me('CTR', M(this.fac('CTR').name, ', ', CS, ', ', this.altRep(s, null, A), ', request descent.'));
    this.descend(1.8, true);
  }
  descend(delay, reply) {
    const s = this.ctxS(), CS = this.CSm(), A = this.ctrApt; this.flags.desc = true; const tgt = Math.min(this.bottom, r100(s.altFt) - 1000); if (tgt < this.appAlt) return;
    const ins = M(this.cmdAlt(tgt, s.altFt, A), tgt < this.ta(A) ? M(', ', this.city(this.arr), ' ', this.altimM(this.arr)) : '');
    this.atc('CTR', M(CS, ', ', ins, '.'), delay, null, { reply, rb: { label: altD(tgt, this.ta(A)), m: M(this.cmdAlt(tgt, s.altFt, A), ', ', CS, '.'), fcu: { alt: tgt }, then: () => this.assignAlt(tgt) } });
  }
  // ---------------------------------------------------------------- ATC follows the flight and calls you
  follow(dt) {
    const c = this.o.ctx, s = c.state(), p = this.phase, CS = this.CSm(), easy = this.easy();
    // things that happen without a radio call
    if (p === 'pushing' && c.pushDone()) this.setPhase('pushed');
    if (['gate', 'clr_ok'].includes(p) && c.pushing()) { // pushed without asking
      if (!easy && !this.flags.pushNag) { this.flags.pushNag = true; this.atc('GND', M(CS, ', ', this.idM('GND'), 'I see you pushing. Push approved, face ', c.pushFace(), '. Next time, request pushback before you push.'), 1.2, null, { instr: true }); }
      this.rb = null; this.setPhase('pushing');
    }
    if (p === 'taxi_in' && c.atGate()) { this.setPhase('parked'); this.alt = this.hdgA = this.spdA = null; }
    this.monitorTimers(s, easy, dt);
    if (this.queue.length || this.tx) return; // proactive calls wait for a quiet frequency
    const E = this.o.depEnd, R = this.rwyM(E.ident);
    // departure ground / tower
    if (p === 'pushed' && s.onGround && s.gsKt > 4 && !this.flags.taxiNag && !this.rb) { this.flags.taxiNag = true; if (easy) this.issueTaxi(0.8, ''); else this.atc('GND', M(CS, ', ', this.idM('GND'), 'hold position, you are not cleared to taxi. Advise ready to taxi.'), 0.8, null, { rb: { label: 'hold position', m: M('Holding position, ', CS, '.') } }); return; }
    if (p === 'taxiing' && !this.ho && !this.rb && (c.nearHold() || s.onDepRwy) && !this.flags.twrHo) { this.flags.twrHo = true; this.atc('GND', M(CS, ', ', this.pick('gTwr', ['', 'holding short, ']), this.contactM('TWR', this.dep), '.'), 0.8, () => this.setPhase('to_twr'), { ho: { to: 'TWR', from: 'GND' } }); return; }
    const preClr = ['pushed', 'taxiing', 'to_twr', 'twr_hold', 'gate', 'clr_ok'].includes(p);
    if (preClr && s.onGround && s.onDepRwy && !this.flags.incur) { // on the runway without a clearance
      this.flags.incur = true; this.ho = null; this.rb = null;
      if (s.gsKt > 30 && s.tl > 0.5 && (easy || s.gsKt > 80)) { if (easy) this.clearTakeoff(0.3); else { this.flags.deviation = true; this.setPhase('takeoff_clr'); } return; }
      this.atc('TWR', M(CS, ', ', this.idM('TWR', this.dep), easy ? M('you have entered runway ', R, ' without a clearance. Hold position, I will have a clearance for you shortly.') : s.gsKt > 30 ? M('stop immediately, I say again, stop immediately! You are not cleared for takeoff.') : M('hold position! You are not cleared onto runway ', R, '.')), 0.3,
        () => this.setPhase('twr_hold'), { rb: { label: 'hold position', m: M('Holding position, ', CS, '.') } });
      return;
    }
    if (p === 'twr_hold' && this.t - this.phT > 4 && !this.rb && !c.runwayBusy(this.dep, E).busy && !this.flags.luaw) { this.flags.luaw = true; this.lineUp(0.6); return; }
    if (p === 'lineup' && !this.rb && this.t - this.phT > 9 && !c.runwayBusy(this.dep, E).busy) { this.clearTakeoff(0.6); this.phT = this.t; return; }
    if (['takeoff_clr', 'rwy_start', 'lineup', 'twr_hold', 'taxiing', 'to_twr'].includes(p) && !s.onGround && s.aglFt > 600) {
      const dev = this.flags.deviation || !this.flags.tkoClr ? (easy ? '' : M('possible pilot deviation, advise you contact ', this.fac('TWR', this.dep).name, ' after landing. ')) : '';
      this.rb = null; this.atc('TWR', M(CS, ', ', dev, this.contactM('DEP'), ', ', this.bye(this.dep), '.'), 0.3, () => this.setPhase('to_dep'), { ho: { to: 'DEP', from: 'TWR' } });
      this.alt = null; this.assignAlt(this.init); this.alt.reached = false; return;
    }
    // climb, cruise, descent
    const distDep = gcNm(s.lat, s.lon, this.dep.lat, this.dep.lon);
    if (p === 'dep' && !this.rb && (s.altFt > this.depTop - 1500 && this.alt?.ft === this.depTop || distDep > 45)) { this.atc('DEP', M(CS, ', ', this.contactM('CTR', this.dep), ', ', this.bye(this.dep), '.'), 0.5, () => this.setPhase('to_ctr'), { ho: { to: 'CTR', from: 'DEP', apt: this.dep } }); return; }
    if (p === 'ctr' && !this.rb) {
      if (!this.flags.sector && this.ctrApt === this.dep && this.dep !== this.arr && s.distArrNm < distDep && this.fac('CTR', this.arr).name !== this.fac('CTR', this.dep).name) { this.flags.sector = true; this.atc('CTR', M(CS, ', ', this.contactM('CTR', this.arr), '.'), 0.5, () => this.setPhase('to_ctr'), { ho: { to: 'CTR', from: 'CTR', apt: this.arr } }); return; }
      if (!this.flags.desc && s.distArrNm < this.todNm(s) && s.altFt > this.bottom + 800) { this.descend(0.6, false); return; }
      if ((this.flags.desc || s.altFt < this.bottom + 800) && (s.distArrNm < 40 || (s.altFt < this.bottom + 600 && s.distArrNm < 60))) { this.atc('CTR', M(CS, ', ', this.contactM('APP', this.arr), '.'), 0.5, () => this.setPhase('to_app'), { ho: { to: 'APP', from: 'CTR' } }); return; }
    }
    // approach: vectors, then the ILS clearance; tower handoff once established
    if (p === 'app' && !this.rb) {
      const g = c.approachGeo(), A = this.arr, re = c.arrEnd(), R2 = this.rwyM(re.ident);
      if (!this.flags.appClr && (g.ipNm < 4.5 || (g.thrNm > 7 && g.thrNm < 24 && Math.abs(g.crossNm) < 5 && Math.abs(wrap180(s.trk - re.hdg)) < 100))) {
        const onRoute = c.onRoute && c.onRoute(); const vh = c.vectorHeading(); const alt = this.appAlt; const aligned = Math.abs(g.crossNm) < 1 && Math.abs(wrap180(s.trk - re.hdg)) < 25;
        const ins = onRoute ? M(this.cmdAlt(alt, s.altFt, A), ', cleared I L S runway ', R2, ' approach') : M(aligned ? '' : M(this.hdgM(vh.hdg, s.trk), ', '), s.altFt > alt + 300 ? this.cmdAlt(alt, s.altFt, A) : M('maintain ', this.Am(alt, A)), ' until established on the localizer, cleared I L S runway ', R2, ' approach');
        this.atc('APP', M(CS, ', ', ins, '.'), 0.6, null,
          { rb: { label: `cleared ILS ${re.ident}`, m: M(cap(ins), ', ', CS, '.'), fcu: { alt, hdg: onRoute ? null : vh.hdg }, then: () => { this.flags.appClr = true; c.armIls(onRoute ? null : vh.hdg, alt); this.assignAlt(alt); this.assignHdg(null); this.assignSpd(null); } } });
        return;
      }
      if (!this.flags.appClr && this.hdgA && this.t - (this.flags.vecT || 0) > 50) { const hd = Math.round(g.ipHdg / 5) * 5; if (Math.abs(wrap180(hd - this.hdgA.hdg)) > 25) { this.flags.vecT = this.t; this.atc('APP', M(CS, ', ', this.hdgM(hd, s.trk), '.'), 0.5, null, { rb: { label: 'heading ' + hdgD(hd), m: M(this.hdgM(hd, s.trk), ', ', CS, '.'), fcu: { hdg: hd }, then: () => this.assignHdg(hd) } }); return; } }
      if (this.flags.appClr && s.thrNm < 11 && (s.locCaptured || Math.abs(s.locDots) < 1 || s.thrNm < 6)) { this.atc('APP', M(CS, ', ', this.contactM('TWR', this.arr), '.'), 0.5, () => { this.setPhase('to_twr_arr'); this.hdgA = null; }, { ho: { to: 'TWR', from: 'APP' } }); return; }
    }
    // arrival tower: no check-in on short final, continue → land, unstable approach, go-around, vacate
    if (ARR_TWR.has(p) && !s.onGround) {
      if (s.thrNm < 9 && s.aglFt < 2500) this.minAgl = Math.min(this.minAgl, s.aglFt);
      if (p === 'to_twr_arr' && (s.aglFt < 1000 || s.thrNm < 4.5) && !this.flags.twrCall) { this.flags.twrCall = true; this.rb = null; this.clearLanding(0.3, 'how do you read? '); return; }
      if (p === 'twr_continue' && this.t - this.phT > 3 && !c.runwayBusy(this.arr, c.arrEnd()).busy) { this.clearLanding(0.3); return; }
      const ga = this.minAgl < 1200 && s.aglFt > this.minAgl + 300 && s.vsFpm > 500;
      if (ga && p !== 'go_around') { this.goAround(false); return; }
      if (p === 'go_around' && !this.rb && s.aglFt > 1400 && !this.ho) { this.atc('TWR', M(CS, ', ', this.contactM('APP', this.arr), '.'), 0.4, () => { this.setPhase('to_app'); Object.assign(this.flags, { appClr: false, ga: true, advise: false, gaCmd: false, twrCall: false }); this.minAgl = 1e9; }, { ho: { to: 'APP', from: 'TWR' } }); return; }
      if (p !== 'go_around' && s.thrNm < 6 && s.aglFt < 1400 && s.aglFt > 120) {
        const gearBad = !s.gearDown, gs = s.gsDots, loc = s.locDots, far = Math.max(Math.abs(gs), Math.abs(loc)), busy = p === 'twr_continue' && c.runwayBusy(this.arr, c.arrEnd()).busy;
        if (!this.flags.advise && s.aglFt < 1300 && s.aglFt > 650 && (gearBad || far > 1.4)) { this.flags.advise = true;
          const what = gearBad ? 'check gear down' : Math.abs(gs) >= Math.abs(loc) ? (gs > 0 ? 'you appear low on the glide path' : 'you appear high on the glide path') : (loc > 0 ? 'you appear left of the final approach course' : 'you appear right of the final approach course');
          this.atc('TWR', M(CS, ', ', what, '.'), 0.2); return; }
        if (!this.flags.gaCmd && s.aglFt < 600 && ((busy && s.aglFt < 500) || (gearBad && s.aglFt < 450) || (far > (easy ? 2.3 : 1.8)))) { this.goAround(true, busy ? 'traffic on the runway' : gearBad ? 'your gear appears up' : 'you are not established on the approach'); return; }
      }
    }
    const emNow = c.emergency && c.emergency(); if (!this.flags.emer && emNow && emNow.kind === 'mayday' && s.onGround && ARR_TWR.has(p)) { this.flags.emer = 'mayday'; this.flags.emerT = this.t - 6; } // the tower saw it happen
    if (this.flags.emer && s.onGround && s.gsKt < 40 && !this.flags.emerGnd && this.t - (this.flags.emerT || 0) > 5) { this.flags.emerGnd = this.flags.vacate = true; this.rb = this.ho = null; c.rescue && c.rescue(); this.setPhase('emer_gnd');
      this.atc('TWR', M(CS, ', ', this.idM('TWR'), 'fire and rescue are on their way to you. Hold position and advise intentions.'), 1.2, null, { instr: true }); return; }
    if ((ARR_TWR.has(p) || p === 'app') && s.onGround && s.gsKt < 60 && !this.flags.vacate && s.distArrNm < 8) {
      this.flags.vacate = true; this.rb = null; this.ho = null; const ex = c.exitInfo(); this.exitName = ex.name;
      const vac = this.usA(this.arr) ? M('turn ', ex.side, ex.name ? M(' at ', [ex.name, twyS(ex.name)]) : ' next available taxiway', ', ') : M('vacate ', ex.side, ex.name ? M(' via ', [ex.name, twyS(ex.name)]) : '', ', ');
      this.atc('TWR', M(CS, ', ', vac, this.contactM('GND', this.arr), this.pick('welc', ['.', ', welcome to ' + this.city(this.arr) + '.', '.'])), 1.5, () => { this.setPhase('to_gnd'); this.alt = this.hdgA = this.spdA = null; }, { ho: { to: 'GND', from: 'TWR' } }); return;
    }
    if (p === 'to_gnd' && s.onArrRwy && s.gsKt < 3 && this.t - this.phT > 45 && !this.flags.vacNag) { this.flags.vacNag = true; this.atc('TWR', M(CS, ', vacate the runway without delay, ', this.pick('vacW', ['traffic on final.', 'traffic four mile final.'])), 0.3, null, { instr: true }); return; }
    // traffic advisories
    if (!s.onGround && c.traffic) {
      for (const a of c.traffic()) {
        if (a.advised || a.done) continue; const d = a.distNm, da = a.dAltFt;
        if (d < 5.5 && d > 1.5 && Math.abs(da) < 2200 && s.altFt < 14000 && (a.kind === 'arr' ? a.s < -2500 : a.h > 60)) {
          a.advised = true; const k = ['takeoff_clr', 'land_clr', 'twr_continue', 'to_twr_arr', 'go_around'].includes(p) ? 'TWR' : ['dep', 'to_dep', 'to_ctr'].includes(p) ? 'DEP' : 'APP';
          const ty = a.type || ['737', 'seven three seven']; const clock = a.clock; const nd = Math.round(d);
          this.atc(k, M(CS, ', traffic, ', [clock + " o'clock", clock + " o'clock"], ', ', [String(nd), String(nd)], nd === 1 ? ' mile, ' : ' miles, ', [ty[0], ty[1]], ', ', Math.abs(da) < 400 ? 'same altitude' : M([r100(Math.abs(da)) + ' ft', altS(r100(Math.abs(da)), 99999) + ' feet'], da > 0 ? ' above' : ' below').d, a.vs > 300 ? ', climbing' : a.vs < -300 ? ', descending' : '', '.'), 0.4, () => { this.flags.tfc = true; this.emit(); });
          return;
        }
      }
    }
  }
  goAround(cmd, why) {
    const CS = this.CSm(), re = this.o.ctx.arrEnd(), alt = this.appAlt, A = this.arr; this.flags.gaCmd = true; this.ho = null;
    const ins = M('fly runway heading, ', this.cmdAlt(alt, alt - 1, A));
    const m = cmd ? M(CS, ', go around, I say again, go around', why ? M(', ', why) : '', '. ', ins, '.') : M(CS, ', ', this.pick('gaR', ['roger, ', 'roger the go-around, ']), ins, '.');
    this.atc('TWR', m, cmd ? 0.1 : 1.2, () => this.setPhase('go_around'), { rb: { label: 'go around, runway heading, ' + altD(alt, this.ta(A)), m: M(cmd ? M('Going around, ', ins) : cap(ins), ', ', CS, '.'), fcu: { alt, hdg: Math.round(re.hdg) }, then: () => { this.assignAlt(alt); } } });
  }
  // readback / handoff reminders and altitude / heading / speed checks
  monitorTimers(s, easy, dt) {
    if (this.queue.length || this.tx) return; const CS = this.CSm();
    const r = this.rb; if (r && !easy && !this.auto) { const w = this.t - r.t;
      if (w > 16 && r.nag === 0) { r.nag = 1; this.atc(r.kind, M(CS, ', ', this.pick('nag', ['did you copy?', 'read back, please.', 'how do you read?', 'I need a readback.'])), 0.2); return; }
      if (w > 42 && r.nag === 1) { r.nag = 2; this.atc(r.kind, M(CS, ', ', this.fac(r.kind).name, ', radio check, how do you read?'), 0.2); return; } }
    const h = this.ho; if (h && !this.rb && !this.auto) { const w = this.t - h.t, F = this.fac(h.to, h.apt);
      if (w > (easy ? 30 : 22) && h.n === 0 && !h.quiet) { h.n = 1; this.atc(h.from, M(CS, ', ', easy ? 'reminder, ' : 'I say again, ', 'contact ', F.name, ' ', this.freqM(F), '.'), 0.2); return; }
      if (w > 55 && h.n === 1 && !easy) { h.n = 2; this.atc(h.from, M(CS, ', ', this.fac(h.from).name, ', radio check, how do you read? Contact ', F.name, ' ', this.freqM(F), '.'), 0.2); return; }
      if (h.quiet && w > 20 && h.n === 0) h.n = 1; }
    if (s.onGround || this.rb) return;
    const live = ['dep', 'to_ctr', 'ctr', 'to_app', 'app', 'go_around'].includes(this.phase) && !(this.flags.appClr && (s.locCaptured || Math.abs(s.locDots) < 1.2));
    const A = this.alt; if (A && live) { const dev = s.altFt - A.ft; if (Math.abs(dev) < 200) A.reached = true;
      if (this.t - A.warnT > 50) { const tol = easy ? 600 : 300, cur = [altD(r100(s.altFt), this.ta()), altS(r100(s.altFt), this.ta())];
        if (A.reached && Math.abs(dev) > tol && (Math.sign(dev) === Math.sign(s.vsFpm) || Math.abs(s.vsFpm) < 300)) { A.warnT = this.t; this.flags.busts = (this.flags.busts || 0) + 1; this.atc(this.curK(), easy ? M(CS, ', just a reminder, your assigned altitude is ', this.Am(A.ft), '.') : M(CS, ', altitude check, I show you at ', cur, ', maintain ', this.Am(A.ft), '.'), 0.2); return; }
        if (!A.reached && this.t - A.t > 75 && Math.abs(dev) > 1000 && ((Math.sign(s.vsFpm) === Math.sign(dev) && Math.abs(s.vsFpm) > 300) || Math.abs(s.vsFpm) < 200)) { A.warnT = this.t; this.atc(this.curK(), M(CS, ', ', this.cmdAlt(A.ft, s.altFt), easy ? ', when you are ready.' : M(', I show you ', Math.abs(s.vsFpm) < 200 ? 'level at ' : 'at ', cur, '.')), 0.2); return; } } }
    const H = this.hdgA; if (H && live && this.t - H.t > 30) { const want = H.fix ? gcBrg(s.lat, s.lon, H.fix.lat, H.fix.lon) : H.hdg; const err = Math.abs(wrap180(s.trk - want));
      H.bad = err > (easy ? 40 : 20) ? H.bad + dt : 0;
      if (H.bad > 12 && this.t - H.warnT > 60) { H.warnT = this.t; this.atc(this.curK(), H.fix ? M(CS, ', check your track, proceed direct ', [H.fix.id, twyS(H.fix.id)], '.') : M(CS, ', check heading, fly heading ', [hdgD(H.hdg), digits(hdgD(H.hdg))], '.'), 0.2); return; } }
    const S = this.spdA; if (S && live && this.t - S.t > 60 && Math.abs(s.ias - S.kt) > 25 && this.t - S.warnT > 90) { S.warnT = this.t; this.atc(this.curK(), M(CS, ', maintain ', [S.kt + ' kt', digits(S.kt) + ' knots'], '.'), 0.2); }
  }
  setAssigned(ft) { this.assignAlt(ft); }
  // ---------------------------------------------------------------- emergencies: MAYDAY / PAN-PAN, priority handling and the nearest suitable runway
  declare(kind) {
    const c = this.o.ctx, s = this.ctxS(), CS = this.CSm(), k = this.curK(), F = this.fac(k), em = c.emergency && c.emergency(); const may = kind === 'mayday';
    const nat = em ? em.nature : may ? 'emergency' : 'technical problem'; const div = c.divert ? c.divert().apt : this.arr; const back = div === this.dep;
    const fm = c.fuelMin ? c.fuelMin() : 120, fh = Math.floor(fm / 60), fmm = Math.round((fm % 60) / 5) * 5; const souls = c.souls ? c.souls() : 156;
    this.flags.emer = kind; this.flags.emerT = this.t; this.rb = null; this.ho = null; this.queue = this.queue.filter(x => !x.chatter); this.dropChatter();
    const word = may ? ['MAYDAY, MAYDAY, MAYDAY', 'Mayday, Mayday, Mayday'] : ['PAN-PAN, PAN-PAN, PAN-PAN', 'Pan pan, pan pan, pan pan'];
    this.me(k, M(word, ', ', F.name, ', ', CS, ', ', nat, ', ', s.onGround ? 'stopping on the runway' : back ? 'request immediate return to ' + this.city(div) : 'request diversion to ' + this.city(div), s.onGround ? '' : M(', ', this.altRep(s, this.alt?.ft ?? null)), ', ', [souls + ' souls on board', souls + ' souls on board'], ', fuel ', [`${fh} h ${String(fmm).padStart(2, '0')} min`, `${fh ? fh + (fh > 1 ? ' hours ' : ' hour ') : ''}${fmm ? fmm + ' minutes' : ''}`], '.'));
    this.atc(k, M(CS, ', ', this.idM(k), 'roger ', may ? 'MAYDAY' : ['PAN-PAN', 'pan pan'], '.'), 1.4, null, { reply: true });
    if (may) this.atc(k, M('All stations, ', F.name, ', stop transmitting, MAYDAY in progress.'), 0.5, null, { reply: true });
    if (s.onGround) { this.atc(k, M(CS, ', fire and rescue are on their way. Hold position.'), 0.6, () => { c.rescue && c.rescue(); }, { reply: true }); return; }
    // vectors to the nearest suitable runway (longest nearby), "runway of your choice"
    if (div !== this.arr) { c.setArr && c.setArr(div); this.arr = div; } this.appAlt = Math.max(2000, r100(div.elevFt + 3000));
    const g = c.approachGeo(), re = c.arrEnd(), hd = Math.round(g.ipHdg / 5) * 5, tgt = s.altFt > 10300 ? Math.max(this.appAlt, 10000) : s.altFt < this.appAlt ? this.appAlt : Math.max(this.appAlt, r100(s.altFt));
    const altIns = Math.abs(tgt - s.altFt) < 300 ? M('maintain ', this.Am(tgt, div)) : this.cmdAlt(tgt, s.altFt, div);
    const ins = M(this.hdgM(hd, s.trk), ', ', altIns, ', vectors I L S runway ', this.rwyM(re.ident), ' at ', this.city(div));
    this.atc(k, M(CS, ', ', ins, ', runway of your choice, fire and rescue will be standing by.'), 0.8, () => { this.setPhase('app'); Object.assign(this.flags, { appClr: false, vecT: this.t, advise: false, gaCmd: false, twrCall: false, vacate: false }); this.contacted.add(this.fac('APP').name); this.ctrApt = div; this.emit(); },
      { reply: true, rb: { label: `heading ${hdgD(hd)}, ${altD(tgt, this.ta(div))}, ILS ${re.ident} ${this.city(div)}`, m: M(cap(ins), ', ', CS, '.'), fcu: { alt: tgt, hdg: hd }, then: () => { this.assignAlt(tgt); this.assignHdg(hd); } } });
  }
  cancelEmer() {
    const c = this.o.ctx, s = this.ctxS(), CS = this.CSm(), k = this.curK(), F = this.fac(k), may = this.flags.emer === 'mayday';
    this.me(k, M(CS, ', cancel ', may ? 'MAYDAY' : ['PAN-PAN', 'pan pan'], s.onGround ? ', we can vacate the runway.' : ', the situation is under control.'));
    this.atc(k, M(CS, ', roger, ', may ? 'MAYDAY' : ['PAN-PAN', 'pan pan'], ' cancelled.'), 1.4, null, { reply: true });
    if (may) this.atc(k, M('All stations, ', F.name, ', distress traffic ended.'), 0.5, null, { reply: true });
    this.flags.emer = null;
    if (s.onGround) { const ex = c.exitInfo(); this.exitName = ex.name; this.atc('TWR', M(CS, ', vacate ', ex.side, ex.name ? M(' via ', [ex.name, twyS(ex.name)]) : ' when able', ', ', this.contactM('GND', this.arr), '.'), 0.8, () => this.setPhase('to_gnd'), { ho: { to: 'GND', from: 'TWR' } }); }
  }
  curK() { const k = this.tuned?.kind, air = this.o && !this.ctxS().onGround; if (k && k !== 'ATIS' && !(air && (k === 'DEL' || k === 'GND'))) return k; return { to_dep: 'TWR', takeoff_clr: 'TWR', dep: 'DEP', to_ctr: 'DEP', ctr: 'CTR', to_app: 'CTR', app: 'APP', to_twr_arr: 'APP', land_clr: 'TWR', twr_continue: 'TWR', go_around: 'TWR' }[this.phase] || (air ? 'APP' : 'GND'); }
}
