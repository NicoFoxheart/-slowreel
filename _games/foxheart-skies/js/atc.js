// Air traffic control: context-aware pilot choices, proper phraseology replies, ATIS loop, handoffs,
// sequencing around AI traffic, altitude-bust warnings and an optional auto-respond mode.
// Voices use the browser's speech synthesis (no recordings); radio squelch and static are Web Audio.
const DIG = ['zero', 'one', 'two', 'tree', 'four', 'fife', 'six', 'seven', 'eight', 'niner'];
const digits = s => String(s).split('').map(c => c === '.' ? 'decimal' : /\d/.test(c) ? DIG[+c] : c === '-' ? '' : c).filter(Boolean).join(' ');
const rwyS = id => { const m = String(id).match(/^(\d+)([LRC]?)$/); if (!m) return id; return digits(m[1].padStart(2, '0')) + (m[2] ? ' ' + { L: 'left', R: 'right', C: 'center' }[m[2]] : ''); };
const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen'];
const altD = (ft, fl) => ft >= fl ? 'FL' + String(Math.round(ft / 100)).padStart(3, '0') : Math.round(ft).toLocaleString('en-US');
const altS = (ft, fl) => { if (ft >= fl) return 'flight level ' + digits(String(Math.round(ft / 100)).padStart(3, '0')); const th = Math.floor(ft / 1000), h = Math.round((ft % 1000) / 100); return [(th ? (NUMW[th] || digits(th)) + ' thousand' : ''), (h ? NUMW[h] + ' hundred' : '')].filter(Boolean).join(' '); };
const hdgD = h => String(Math.round(((h % 360) + 360) % 360) || 360).padStart(3, '0');
const NATO = 'Alfa Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey Xray Yankee Zulu'.split(' ');
const twyS = n => n.split('').map(c => /\d/.test(c) ? DIG[+c] : NATO['ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(c)] || c).join(' ');
// message builder: parts are strings (same display/spoken) or [display, spoken]
const M = (...parts) => ({ d: parts.map(p => Array.isArray(p) ? p[0] : p && p.d !== undefined ? p.d : p).join(''), s: parts.map(p => Array.isArray(p) ? p[1] : p && p.s !== undefined ? p.s : p).join('') });
export const SHORT = { KTPA: 'Tampa', KMIA: 'Miami', RKSI: 'Incheon', KLAX: 'Los Angeles', MPTO: 'Tocumen', KJFK: 'Kennedy', KSFO: 'San Francisco', RKSS: 'Gimpo', RJTT: 'Tokyo', EGLL: 'Heathrow', OMDB: 'Dubai', WSSS: 'Singapore' };
export const REGION_CS = { US: ['Sunfin', 'Pelican', 'Coral', 'Bayhawk', 'Skylark', 'Manatee', 'Seabird', 'Palmetto', 'Osprey', 'Redtail'], KR: ['Hanbit', 'Mirae', 'Arirang', 'Haneul', 'Blue Crane', 'Seorak'], JP: ['Sakura Wing', 'Kestrel', 'Hikari', 'Tsubame'], PA: ['Canal', 'Quetzal', 'Isthmus', 'Toucan', 'Pacifico'], GB: ['Thames', 'Kestrel', 'Albion', 'Speedlink'], AE: ['Falcon', 'Oasis', 'Dune'], SG: ['Merlion', 'Orchid', 'Straits'], default: ['Skylark', 'Kestrel', 'Seabird', 'Osprey', 'Nimbus', 'Aurora'] };
export const DEST_DEFAULT = { KTPA: 'KMIA', KMIA: 'KTPA', RKSI: 'RJTT', RKSS: 'RJTT', RJTT: 'RKSS', KLAX: 'KSFO', KSFO: 'KLAX', MPTO: 'KMIA', KJFK: 'EGLL', EGLL: 'KJFK', OMDB: 'EGLL', WSSS: 'RKSI' };
const FAC = { ATIS: ['A', null, 127.85, 'Information'], DEL: ['C', null, 121.9, 'Delivery'], GND: ['G', null, 121.75, 'Ground'], TWR: ['T', null, 118.7, 'Tower'], DEP: ['D', 'P', 124.35, 'Departure'], APP: ['P', 'D', 119.25, 'Approach'] };
const VOICE = { ATIS: { rate: 1.02, pitch: 0.95, v: 0 }, DEL: { rate: 1.1, pitch: 1.2, v: 1 }, GND: { rate: 1.08, pitch: 0.82, v: 2 }, TWR: { rate: 1.14, pitch: 1.3, v: 3 }, DEP: { rate: 1.12, pitch: 0.72, v: 4 }, APP: { rate: 1.1, pitch: 1.05, v: 5 }, ME: { rate: 1.12, pitch: 1.0, v: 6 } };

export function facility(apt, kind) {
  const [k1, k2, base, word] = FAC[kind]; const f = apt.freq || {};
  const real = f[k1] ?? (k2 ? f[k2] : undefined);
  let h = 0; for (const c of apt.icao + kind) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const mhz = real ?? +(base + ((h % 9) - 4) * 0.025).toFixed(3);
  const name = (SHORT[apt.icao] || apt.city || apt.name.split(' ')[0]) + ' ' + word;
  return { kind, mhz, real: real != null, name, apt };
}
const fmtF = f => f.mhz.toFixed(f.mhz * 100 % 5 ? 3 : 2).replace(/0$/, m => m) + (f.real ? '' : '*');
const freqS = f => digits(f.mhz.toFixed(f.mhz * 100 % 5 ? 3 : 2).replace(/0+$/, '').replace(/\.$/, ''));

export class ATC {
  constructor(audio) {
    this.audio = audio; this.log = []; this.queue = []; this.busyT = 0; this.auto = false; this.speakMe = true; this.voices = [];
    this.cs = 'Foxheart 412'; this.csS = 'Foxheart four one two'; this.phase = 'idle'; this.listeners = []; this.errors = []; this.tuned = null; this.t = 0;
    this.autoT = 0; this.bustT = 0; this.atisOn = false;
    this.voicePref = {}; this.chatterOn = true;
    try { const load = () => { this.rankVoices(); this.listeners.forEach(f => { try { f(this, 'voices'); } catch (e) { } }); }; this.rankVoices(); speechSynthesis.addEventListener ? speechSynthesis.addEventListener('voiceschanged', load) : (speechSynthesis.onvoiceschanged = load); } catch (e) { }
  }
  on(f) { this.listeners.push(f); }
  emit() { for (const f of this.listeners) try { f(this); } catch (e) { this.errors.push(String(e)); } }
  // ---------------------------------------------------------------- setup per flight
  setup(o) {
    this.o = o; this.dep = o.dep; this.arr = o.arr || o.dep; this.log = []; this.queue = []; this.busyT = 0; this.assigned = null; this.squawk = String(1000 + Math.floor(Math.random() * 6000)).replace(/[89]/g, '4');
    this.atisLetter = NATO[(new Date().getUTCHours() + (o.dep.icao.charCodeAt(1) || 0)) % 26];
    this.phase = { gate: 'gate', terminal: 'gate', runway: 'rwy_start', final: 'final_start', route: 'enroute' }[o.start] || 'gate';
    this.ackT = 0; this.pending = null; this.flags = {};
    this.tune(this.phase === 'gate' ? 'DEL' : this.phase === 'rwy_start' ? 'TWR' : this.phase === 'final_start' ? 'TWR' : 'APP', true);
    this.emit();
  }
  apt() { return ['gate', 'clr_given', 'clr_ok', 'pushing', 'pushed', 'taxi_given', 'taxiing', 'hold_wait', 'lineup', 'rwy_start', 'takeoff_clr', 'airborne'].includes(this.phase) ? this.dep : this.arr; }
  fac(kind, apt) { return facility(apt || this.apt(), kind); }
  tune(kind, silent) {
    this.tuned = this.fac(kind); if (kind !== 'ATIS') this.stopAtis();
    if (kind === 'ATIS' && !silent) this.startAtis();
    this.emit();
  }
  // ---------------------------------------------------------------- weather / ATIS text
  wx() { const c = this.o.ctx; return c.weather(); }
  windM() { const w = this.wx(); return w.kt < 3 ? M('wind calm') : M('wind ', [hdgD(Math.round(w.dir / 10) * 10), digits(hdgD(Math.round(w.dir / 10) * 10))], ' at ', [String(Math.round(w.kt)), String(Math.round(w.kt))], w.gust ? M(' gusting ', [String(Math.round(w.kt * 1.5)), String(Math.round(w.kt * 1.5))]).d : ''); }
  atisText() {
    const A = this.apt(), w = this.wx(), E = A === this.dep ? this.o.depEnd : this.o.ctx.arrEnd();
    const us = A.cc === 'US'; const name = A.name.replace(/International Airport/, 'International').replace(/ Airport$/, '');
    const vis = w.vis >= 10000 ? (us ? M('visibility one zero') : M('visibility one zero kilometers or more')) : M('visibility ', [String(us ? Math.max(0.25, Math.round(w.vis / 1609 * 4) / 4) + ' SM' : Math.round(w.vis) + ' m'), (us ? String(Math.max(0.25, Math.round(w.vis / 1609 * 4) / 4)) + ' miles' : digits(Math.round(w.vis)) + ' meters')]);
    const cl = { clear: 'sky clear', scattered: 'scattered clouds at four thousand', overcast: 'overcast at two thousand eight hundred', rain: 'light rain, broken one thousand two hundred, overcast two thousand', fog: 'fog, vertical visibility two hundred' }[w.kind] || 'sky clear';
    const t = w.temp; const alt = us ? M('altimeter ', ['2992', 'two niner niner two']) : M('Q N H ', ['1013', 'one zero one tree']);
    const z = String(Math.floor(((w.utcMin % 1440) + 1440) % 1440 / 60)).padStart(2, '0') + '50';
    const r = E ? E.ident : '';
    return M(name, ' information ', this.atisLetter, ', ', [z + 'Z', digits(z) + ' zulu'], '. ', this.windM(), '. ', vis, '. ', cl, '. ', 'temperature ', [String(t), String(t)], ', dew point ', [String(t - 5), String(t - 5)], ', ', alt, '. ',
      'I L S approaches in use, landing and departing runway ', [r, rwyS(r)], '. Advise on initial contact you have information ', this.atisLetter, '.');
  }
  startAtis() {
    this.atisOn = true; const loop = () => { if (!this.atisOn) return; const m = this.atisText(); this.say('ATIS', m, () => { if (this.atisOn) this.atisTimer = setTimeout(loop, 2500); }, true); };
    loop();
  }
  stopAtis() { this.atisOn = false; clearTimeout(this.atisTimer); if (this.speakingAtis) { try { speechSynthesis.cancel(); } catch (e) { } this.speakingAtis = false; } }
  // ---------------------------------------------------------------- transmissions
  me(kind, m) { this.tune(kind, true); this.dropChatter(); this.push({ who: 'ME', kind, m: this.human(m, 0.06) }); this.lastMeT = this.t; }
  atc(kind, m, delay = 1.6, then) { this.push({ who: kind, kind, m: this.human(m, 0.12), delay: delay * this.pace(), then }); }
  other(kind, cs, m, delay = 0.6) { this.push({ who: 'OTHER', cs, kind, m: this.human(m, 0.1), delay, chatter: true }); }
  push(x) { this.queue.push(x); }
  dropChatter() { this.queue = this.queue.filter(x => !x.chatter); }
  pace() { return Math.max(0.55, 1 - this.busy() * 0.12); }
  busy() { return Math.min(3, (this.chatLog || []).filter(t => this.t - t < 90).length); }
  // natural delivery helpers
  human(m, pUh) {
    const head = (m.d.split(',')[0] || '').trim();
    if (Math.random() < pUh && /, /.test(m.d) && (/^[A-Za-z ]+ \d{2,4}$/.test(head) || /(Tower|Ground|Approach|Departure|Delivery)$/.test(head))) { const f = x => x.replace(/^([^,]+), /, '$1, uh, '); return { d: f(m.d), s: f(m.s) }; }
    return m;
  }
  pick(key, arr) { this._last = this._last || {}; let i = Math.floor(Math.random() * arr.length); if (arr.length > 1 && i === this._last[key]) i = (i + 1) % arr.length; this._last[key] = i; return arr[i]; }
  hello() { const m = this.o.ctx.weather().localMin ?? 720; return m < 690 ? 'good morning' : m < 1050 ? 'good afternoon' : 'good evening'; }
  bye(apt) {
    const c = (apt || this.apt()).icao; const pools = {
      KTPA: ['have a good one', 'see ya', 'have a nice flight', 'good day'], KMIA: ['have a nice flight', 'adiós', 'good day', 'see ya'], MPTO: ['buen vuelo', 'have a nice flight', 'good day, gracias'],
      RKSI: ['thank you, have a nice flight', 'good day, thank you', 'have a safe flight, thank you'], RKSS: ['thank you, good day', 'have a nice flight, thank you'], RJTT: ['good day', 'have a nice flight'],
      EGLL: ['cheers', 'good day', 'bye bye'], OMDB: ['good day', 'have a pleasant flight'], WSSS: ['good day', 'have a nice flight'] };
    return this.pick('bye', pools[c] || ['good day', 'see ya', 'have a nice flight', 'so long']);
  }
  // ---------------------------------------------------------------- voices: rank natural voices, keep each speaker's voice stable
  rankVoices() {
    let all = []; try { all = speechSynthesis.getVoices(); } catch (e) { }
    const score = v => (/natural|neural/i.test(v.name) ? 60 : 0) + (/online/i.test(v.name) ? 40 : 0) + (/google/i.test(v.name) ? 25 : 0) + (/microsoft/i.test(v.name) ? 8 : 0) + (/^en-(US|GB|AU|IE|CA)/i.test(v.lang) ? 10 : 0) + (v.localService === false ? 5 : 0) - (/compact|espeak/i.test(v.name) ? 30 : 0);
    this.allVoices = all; const en = all.filter(v => /^en/i.test(v.lang)).sort((a, b) => score(b) - score(a)); const good = en.filter(v => !/espeak|compact/i.test(v.name)); this.voices = good.length ? good : en;
  }
  voiceFor(who, cs) {
    const pref = this.voicePref || {}; const V = this.voices; if (!V.length) return null;
    const byName = n => n && n !== 'auto' ? (this.allVoices || []).find(v => v.name === n) : null;
    if (who === 'ME') return byName(pref.pilot) || V[Math.min(V.length - 1, 1)];
    if (who === 'OTHER') { let h = 0; for (const c of cs || '') h = (h * 31 + c.charCodeAt(0)) >>> 0; return V[(h % Math.min(V.length, 8))]; }
    const forced = byName(pref.controller); if (forced) return forced;
    const order = { TWR: 0, GND: 2, DEL: 3, APP: 1, DEP: 4, ATIS: 5 }; return V[(order[who] ?? 0) % Math.min(V.length, 6)];
  }
  say(kind, m, done, atis, cs) {
    const f = this.fac(kind === 'ME' || kind === 'OTHER' ? (this.tuned?.kind || 'TWR') : kind);
    const fac = kind === 'ME' ? this.cs : kind === 'OTHER' ? cs : f.name;
    const entry = { who: kind, fac, text: m.d, t: this.t, atis: !!atis, other: kind === 'OTHER' };
    if (!atis || !this.log.length || this.log[this.log.length - 1].text !== m.d) this.log.push(entry);
    if (this.log.length > 80) this.log.shift();
    this.emit();
    const A = this.audio; A && A.radioOpen && A.radioOpen(kind === 'ME', kind === 'OTHER' ? 0.6 : 1);
    const est = Math.min(18, 0.9 + m.d.length * 0.052 / this.pace());
    let ended = false; const fin = () => { if (ended) return; ended = true; A && A.radioClose && A.radioClose(); this.speakingAtis = false; done && done(); };
    const speak = (kind !== 'ME' || this.speakMe) && this.audio?.voice !== false && this.voiceOn !== false;
    if (!this.voices.length) this.rankVoices();
    if (speak && 'speechSynthesis' in window && this.voices.length) {
      try {
        const vc = VOICE[kind === 'OTHER' ? 'APP' : kind] || VOICE.TWR; const voice = this.voiceFor(kind, cs);
        let h = 0; for (const c of (cs || kind)) h = (h * 17 + c.charCodeAt(0)) >>> 0;
        const pitch = kind === 'OTHER' ? 0.8 + (h % 7) * 0.08 : vc.pitch, vol = Math.min(1, ((this.audio?.vol ?? 0.7) + 0.2) * (kind === 'OTHER' ? 0.72 + (h % 5) * 0.05 : 1));
        const chunks = m.s.split(/(?<=[,.;?])\s+/).filter(Boolean);
        chunks.forEach((c, i) => { const u = new SpeechSynthesisUtterance(c); try { if (voice) u.voice = voice; } catch (e) { } u.lang = voice?.lang || 'en-US'; u.rate = vc.rate * (1 + this.busy() * 0.05) * (0.96 + Math.random() * 0.08); u.pitch = pitch; u.volume = vol; if (i === chunks.length - 1) { u.onend = fin; u.onerror = fin; } speechSynthesis.speak(u); });
        this.speakingAtis = !!atis; setTimeout(fin, est * 1000 * 2 + 2500); return est;
      } catch (e) { this.errors.push('speech: ' + e.message); }
    }
    setTimeout(fin, est * 1000); return est;
  }
  update(dt) {
    this.t += dt; if (!this.o) return;
    if (this.busyT > 0) this.busyT -= dt;
    else if (this.queue.length && !this.speakingAtis) {
      const x = this.queue[0];
      if (x.delay > 0) x.delay -= dt;
      else {
        this.queue.shift(); if (x.kind !== 'ATIS') this.stopAtis();
        if (x.who === 'STEPON') { this.audio?.stepOn && this.audio.stepOn(); this.log.push({ who: 'OTHER', fac: '—', text: '(two stations transmitting at once: squeal)', t: this.t, other: true }); this.emit(); this.busyT = 1.4; }
        else { const d = this.say(x.who === 'ME' ? 'ME' : x.who === 'OTHER' ? 'OTHER' : x.kind, x.m, null, false, x.cs); this.busyT = Math.min(d, 8) + 0.35 + (x.chatter ? 0.4 : 0); if (x.chatter) (this.chatLog = this.chatLog || []).push(this.t); }
        x.then && x.then();
      }
    }
    this.follow(dt); this.chatter(dt);
    if (this.auto && !this.queue.length && this.busyT <= 0) { this.autoT += dt; if (this.autoT > 2.5) { this.autoT = 0; const o = this.options().find(o => o.auto); if (o) this.choose(o.id); } } else this.autoT = 0;
  }
  // ---------------------------------------------------------------- the living frequency: other aircraft
  chatter(dt) {
    if (this.chatterOn === false || !this.tuned || this.tuned.kind === 'ATIS' || this.tuned.kind === 'DEL') return;
    this.chatT = (this.chatT ?? 12) - dt; if (this.chatT > 0 || this.queue.length || this.busyT > 0) return;
    this.chatT = 26 + Math.random() * 30;
    const k = this.tuned.kind, A = this.apt(), F = this.fac(k).name, c = this.o.ctx; const w = this.windM();
    const lines = REGION_CS[A.cc] || REGION_CS.default; const air = this.pick('air', lines); const num = String(100 + Math.floor(Math.random() * 880));
    const cs = air + ' ' + num, csS = air + ' ' + digits(num);
    const E = (k === 'TWR' || k === 'GND') ? (A === this.dep ? this.o.depEnd : c.arrEnd()) : c.arrEnd(); const r = E ? E.ident : '27';
    const R = [r, rwyS(r)]; const CS = [cs, csS];
    const twy = this.pick('twy', ['A', 'B', 'C', 'J', 'K']) + (Math.random() < 0.5 ? String(1 + (Math.random() * 4 | 0)) : '');
    const fix = this.pick('fix', ['FOXXY', 'PALMZ', 'SUNNE', 'BAYOU', 'CORAL', 'HANUL', 'ISTMO', 'KITSU']);
    const alt = (5 + (Math.random() * 6 | 0)) * 1000, alt2 = alt - 2000;
    const stepOn = Math.random() < 0.07;
    const ai = c.traffic ? c.traffic().find(a => !a.called && (k === 'TWR' ? (a.kind === 'arr' && a.s > -9000 && a.s < -1500) || (a.kind === 'dep' && a.hold > 0) : false)) : null;
    if (ai) { ai.called = true; ai.cs = ai.cs || cs; }
    const scripts = {
      GND: () => { this.other(k, cs, M(F, ', ', CS, ', ', this.hello(), ', at gate ', [String(2 + (Math.random() * 20 | 0)), ''], ' request taxi.'), 0.2); this.atc(k, M(CS, ', ', this.hello(), ', runway ', R, ', taxi via ', [twy, twyS(twy)], ', hold short runway ', R, '.'), 1.2); this.other(k, cs, M('Runway ', R, ' via ', [twy, twyS(twy)], ', hold short, ', CS, '.'), 0.8); },
      TWR: () => {
        if (ai && ai.kind === 'dep') { this.atc(k, M([ai.cs, ai.cs], ', ', w, ', runway ', R, ', cleared for takeoff.'), 0.3); this.other(k, ai.cs, M('Cleared for takeoff ', R, ', ', [ai.cs, ai.cs], '.'), 0.7); return; }
        const n = ai ? Math.max(2, Math.round(-ai.s / 1852)) : 3 + (Math.random() * 6 | 0); const c2 = ai ? [ai.cs, ai.cs] : CS;
        this.other(k, c2[0], M(F, ', ', c2, ', ', [String(n), String(n)], ' mile final runway ', R, '.'), 0.2);
        if (stepOn) { this.push({ who: 'STEPON', kind: k, delay: 0.2, chatter: true }); this.atc(k, M(this.pick('blk', ['Blocked, say again.', 'Two stations at once, last station say again.', 'Blocked, aircraft calling final, say again.'])), 0.6); this.other(k, c2[0], M(F, ', ', c2, ', ', [String(n), String(n)], ' mile final, ', R, '.'), 0.6); }
        this.atc(k, M(c2, ', ', this.pick('twrHi', [F + ', ', '', '']), w, ', runway ', R, ', cleared to land.'), 1.0); this.other(k, c2[0], M('Cleared to land ', R, ', ', c2, '.'), 0.7);
      },
      APP: () => { this.other(k, cs, M(F, ', ', CS, ', ', this.hello(), ', ', [altD(alt, 99999), altS(alt, 99999)], ', descending ', [altD(alt2, 99999), altS(alt2, 99999)], ', information ', this.atisLetter, '.'), 0.2); this.atc(k, M(CS, ', ', F, ', ', this.pick('ident', ['radar contact. ', '', 'roger, ']), 'descend and maintain ', [altD(alt2, 99999), altS(alt2, 99999)], ', expect I L S runway ', R, '.'), 1.1); this.other(k, cs, M('Down to ', [altD(alt2, 99999), altS(alt2, 99999)], ', I L S ', R, ', ', CS, '.'), 0.7); },
      DEP: () => { const fl = 'FL' + (180 + (Math.random() * 10 | 0) * 10); this.other(k, cs, M(F, ', ', CS, ', passing ', [altD(alt2, 99999), altS(alt2, 99999)], ' for ', [altD(alt, 99999), altS(alt, 99999)], '.'), 0.2); this.atc(k, M(CS, ', ', F, ', radar contact, climb and maintain ', [fl, 'flight level ' + digits(fl.slice(2))], ', proceed direct ', [fix, fix.split('').join(' ')], '.'), 1.0); this.other(k, cs, M('Up to ', [fl, 'flight level ' + digits(fl.slice(2))], ', direct ', [fix, fix.split('').join(' ')], ', ', CS, '.'), 0.7); },
    };
    if (scripts[k]) scripts[k]();
    this.queue.forEach(x => { if (!x.who || x.who !== 'ME') x.chatter = true; });
  }
  // ---------------------------------------------------------------- what the pilot can say now
  options() {
    const c = this.o?.ctx; if (!c) return []; const s = c.state(); const p = this.phase; const out = [];
    const dep = this.dep, arr = this.arr, cs = this.cs, E = this.o.depEnd;
    const add = (id, kind, label, auto = false) => out.push({ id, kind, label, auto, freq: fmtF(this.fac(kind, ['descent', 'app', 'enroute', 'handoff_twr', 'twr', 'land_clr', 'landed', 'handoff_gnd', 'taxi_in', 'parked', 'final_start'].includes(p) ? arr : dep)) });
    if (s.onGround && ['gate', 'clr_ok', 'rwy_start'].includes(p) || (!s.onGround && ['enroute', 'descent'].includes(p) && s.distArrNm < 80)) add('atis', 'ATIS', 'Listen to ATIS');
    if (this.flags.tfc) { add('tfc_look', this.tuned?.kind || 'APP', 'Looking for the traffic', true); add('tfc_sight', this.tuned?.kind || 'APP', 'Traffic in sight'); }
    switch (p) {
      case 'gate': add('clr', 'DEL', `Request IFR clearance to ${SHORT[arr.icao] || arr.name}`, true); break;
      case 'clr_given': add('clr_rb', 'DEL', 'Read back the clearance', true); break;
      case 'clr_ok': add('push', 'GND', 'Request pushback and start', true); break;
      case 'pushed': add('taxi', 'GND', 'Request taxi', true); break;
      case 'taxi_given': add('taxi_rb', 'GND', 'Read back taxi instructions', true); break;
      case 'taxiing': add('ready', 'TWR', `Ready for departure, runway ${E.ident}`, c.nearHold()); break;
      case 'lineup': add('lu_rb', 'TWR', 'Read back: line up and wait', true); break;
      case 'rwy_start': add('ready', 'TWR', `Request takeoff clearance, runway ${E.ident}`, true); break;
      case 'takeoff_clr': if (!this.flags.tkoRb) add('tko_rb', 'TWR', 'Read back takeoff clearance', true); break;
      case 'handoff_dep': add('dep_in', 'DEP', 'Check in with Departure', true); break;
      case 'dep': if (s.altFt > 6000) add('descent', 'APP', 'Request descent', s.distArrNm < 60); break;
      case 'enroute': add('descent', 'APP', 'Request descent', s.distArrNm < 60); add('ils', 'APP', `Request ILS approach, runway ${c.arrEnd().ident}`, s.distArrNm < 25); break;
      case 'descent': add('ils', 'APP', `Request ILS approach, runway ${c.arrEnd().ident}`, s.distArrNm < 25); break;
      case 'handoff_twr': case 'final_start': add('twr_in', 'TWR', `Check in with Tower on final, runway ${c.arrEnd().ident}`, true); break;
      case 'land_clr': if (!this.flags.landRb) add('land_rb', 'TWR', 'Read back landing clearance', true); break;
      case 'handoff_gnd': add('gnd_in', 'GND', 'Request taxi to the gate', true); break;
      case 'taxi_in': if (!this.flags.tinRb) add('tin_rb', 'GND', 'Read back taxi to gate', true); break;
    }
    return out;
  }
  // ---------------------------------------------------------------- pilot choice → ATC reply
  choose(id) {
    const c = this.o.ctx; const s = c.state(); const cs = this.cs, csS = this.csS; const E = this.o.depEnd; const dep = this.dep, arr = this.arr;
    const fl = dep.cc === 'US' ? 18000 : 7000; const CS = [cs, csS];
    const f = k => this.fac(k); const F = k => [fmtF(f(k)), freqS(f(k))];
    const R = id => [id, rwyS(id)]; const A = (ft, fl2 = fl) => [altD(ft, fl2), altS(ft, fl2)];
    const T = names => names.map(n => [n, twyS(n)]).flatMap((x, i) => i ? [', ', x] : [x]);
    switch (id) {
      case 'atis': this.tune('ATIS'); return;
      case 'tfc_look': this.flags.tfc = false; this.me(this.tuned?.kind || 'APP', M(this.pick('look', ['Looking, ', 'Looking for the traffic, ', 'Negative contact, looking, ']), CS, '.')); this.atc(this.tuned?.kind || 'APP', M(CS, ', ', this.pick('tfcAck', ['roger, I will advise.', 'roger.', 'roger, traffic no factor.']))); this.emit(); return;
      case 'tfc_sight': this.flags.tfc = false; this.me(this.tuned?.kind || 'APP', M(this.pick('sight', ['Traffic in sight, ', 'Got the traffic, ', 'In sight, ']), CS, '.')); this.atc(this.tuned?.kind || 'APP', M(CS, ', ', this.pick('vis', ['thank you.', 'roger, maintain visual separation.', 'thanks.']))); this.emit(); return;
      case 'clr': {
        const init = Math.round((dep.elevFt + 5000) / 1000) * 1000; this.init = init;
        this.me('DEL', M(f('DEL').name, ', ', CS, ', ', this.hello(), ', at gate ', [this.o.gate, digits(this.o.gate)], ', information ', this.atisLetter, ', request I F R clearance to ', SHORT[arr.icao] || arr.name, '.'));
        this.atc('DEL', M(CS, ', ', this.pick('clrHi', [f('DEL').name + ', ' + this.hello() + ', ', '', this.hello() + ', ']), this.pick('clrV', ['cleared to ', 'you are cleared to ', 'cleared to ']), arr.name.replace(' Airport', ''), ' via radar vectors, then as filed. Climb and maintain ', A(init), ', expect ', A(fl >= 18000 ? 35000 : 35000, 0), ' one zero minutes after departure. Departure frequency ', F('DEP'), ', squawk ', [this.squawk, digits(this.squawk)], '.'), 2.2, () => { this.phase = 'clr_given'; this.assigned = init; this.emit(); });
        return;
      }
      case 'clr_rb': this.me('DEL', M('Cleared to ', SHORT[arr.icao] || arr.icao, ' via radar vectors, climb and maintain ', A(this.init), ', departure ', F('DEP'), ', squawk ', [this.squawk, digits(this.squawk)], ', ', CS, '.'));
        this.atc('DEL', M(CS, ', ', this.pick('rbok', ['readback correct', 'readback correct', 'that is correct']), '. ', this.pick('gndNext', ['Contact ', 'When ready to push, contact ', 'Call ']), f('GND').name, ' ', F('GND'), this.pick('gndN2', [' when ready to push.', '.', ', ' + this.bye() + '.'])), 1.8, () => { this.phase = 'clr_ok'; this.emit(); }); return;
      case 'push': {
        this.me('GND', M(f('GND').name, ', ', CS, ', ', this.hello(), ', gate ', [this.o.gate, digits(this.o.gate)], ', ', this.pick('pushReq', ['request pushback and start', 'ready to push and start', 'request push and start']), '.'));
        const face = c.pushFace();
        this.atc('GND', M(CS, ', ', this.pick('pushOk', ['push and start approved, face ', 'push approved, face ', 'push and start at your discretion, face ']), face, '.'), 2 * this.pace(), () => { this.phase = 'pushing'; c.startPushback(); this.emit(); }); return;
      }
      case 'taxi': {
        const r = c.taxiOut(); this.taxiRoute = r;
        this.me('GND', M(f('GND').name, ', ', CS, ', request taxi.'));
        this.atc('GND', M(CS, ', ', this.pick('taxiV', ['runway ', 'taxi to runway ', 'runway ']), R(E.ident), ', ', this.pick('taxiVia', ['taxi via ', 'via ', 'taxi via ']), ...T(r.via), ', hold short runway ', R(E.ident), ' at ', [r.hold, twyS(r.hold)], '. ', this.pick('taxiTail', [this.windM().d ? M(this.windM(), '.').d : '', '', 'Monitor tower on the way.']), ''), 2, () => { this.phase = 'taxi_given'; c.showTaxi(r); this.emit(); }); return;
      }
      case 'taxi_rb': { const r = this.taxiRoute; this.me('GND', M('Runway ', R(E.ident), ', taxi via ', ...T(r.via), ', hold short runway ', R(E.ident), ' at ', [r.hold, twyS(r.hold)], ', ', CS, '.')); this.phase = 'taxiing'; this.emit(); return; }
      case 'ready': {
        this.me('TWR', M(f('TWR').name, ', ', CS, ', ', this.pick('ready', ['holding short runway ', 'ready for departure runway ', 'holding short ']), R(E.ident), this.pick('ready2', [', ready for departure.', '.', ', ready.'])));
        this.pending = 'takeoff'; this.flags.holdIssued = false; this.flags.tkoRb = false;
        const b = c.runwayBusy(dep, E);
        if (b.busy) this.atc('TWR', M(CS, ', hold short runway ', R(E.ident), ', ', b.why, '.'), 2, () => { this.phase = 'hold_wait'; this.emit(); });
        else this.clearTakeoff(2);
        return;
      }
      case 'lu_rb': this.me('TWR', M('Line up and wait runway ', R(E.ident), ', ', CS, '.')); return;
      case 'tko_rb': this.flags.tkoRb = true; this.me('TWR', M('Cleared for takeoff runway ', R(E.ident), ', ', CS, '.')); this.emit(); return;
      case 'dep_in': {
        const alt = Math.round(s.altFt / 100) * 100; const climb = Math.max(this.assigned || 5000, 10000);
        this.me('DEP', M(f('DEP').name, ', ', CS, ', ', this.hello(), ', passing ', A(alt), ' for ', A(this.assigned || 5000), '.'));
        this.atc('DEP', M(CS, ', ', f('DEP').name, ', ', this.pick('rc', ['radar contact. ', 'radar contact, ', 'radar contact, ' + this.hello() + '. ']), 'Climb and maintain ', Math.random() < 0.12 ? M(A(climb - 2000), ', correction, ', A(climb)) : M(A(climb)), '.'), 1.8, () => { this.phase = 'dep'; this.assigned = climb; this.emit(); }); return;
      }
      case 'descent': {
        const tgt = Math.round((arr.elevFt + 4000) / 1000) * 1000; const fl2 = arr.cc === 'US' ? 18000 : 7000;
        this.me('APP', M(this.fac('APP', arr).name, ', ', CS, ', ', this.hello(), ', ', A(Math.round(s.altFt / 100) * 100, fl2), ', request descent.'));
        this.atc('APP', M(CS, ', ', this.fac('APP', arr).name, ', descend and maintain ', A(tgt, fl2), ', expect I L S runway ', R(c.arrEnd().ident), '.'), 1.8, () => { this.phase = 'descent'; this.assigned = tgt; this.emit(); }); return;
      }
      case 'ils': {
        const re = c.arrEnd(); const hd = c.vectorHeading(); const alt = Math.round((arr.elevFt + 3000) / 100) * 100;
        this.me('APP', M(this.fac('APP', arr).name, ', ', CS, ', request I L S approach runway ', R(re.ident), '.'));
        this.atc('APP', M(CS, ', turn ', hd.turn, ' heading ', [hdgD(hd.hdg), digits(hdgD(hd.hdg))], ', maintain ', A(alt, 99999), ' until established on the localizer, cleared I L S runway ', R(re.ident), ' approach.'), 1.8,
          () => { this.phase = 'app'; this.assigned = alt; c.armIls(hd.hdg, alt); this.emit(); }); return;
      }
      case 'twr_in': {
        const re = c.arrEnd(); const nm = Math.max(1, Math.round(s.thrNm));
        this.me('TWR', M(this.fac('TWR', arr).name, ', ', CS, ', ', [String(nm), digits(nm)], ' mile final, I L S runway ', R(re.ident), '.'));
        this.pending = 'landing'; const b = c.runwayBusy(arr, re);
        if (b.busy) this.atc('TWR', M(CS, ', continue approach, ', b.why, '.'), 1.8, () => { this.phase = 'twr_continue'; this.emit(); });
        else this.clearLanding(1.8);
        return;
      }
      case 'land_rb': this.flags.landRb = true; this.me('TWR', M('Cleared to land runway ', R(c.arrEnd().ident), ', ', CS, '.')); this.emit(); return;
      case 'gnd_in': {
        const r = c.taxiIn(); this.taxiRoute = r;
        this.me('GND', M(this.fac('GND', arr).name, ', ', CS, ', clear of runway ', R(c.arrEnd().ident), ', request taxi to the gate.'));
        this.atc('GND', M(CS, ', taxi to gate ', [r.gate, digits(r.gate)], ' via ', ...T(r.via), '.'), 1.8, () => { this.phase = 'taxi_in'; this.flags.tinRb = false; c.showTaxi(r); this.emit(); }); return;
      }
      case 'tin_rb': { const r = this.taxiRoute; this.flags.tinRb = true; this.me('GND', M('Taxi to gate ', [r.gate, digits(r.gate)], ' via ', ...T(r.via), ', ', CS, '.')); this.emit(); return; }
    }
  }
  clearTakeoff(delay) {
    const E = this.o.depEnd, CS = [this.cs, this.csS];
    this.atc('TWR', M(CS, ', ', this.windM(), ', runway ', [E.ident, rwyS(E.ident)], ', cleared for takeoff.'), delay, () => { this.phase = 'takeoff_clr'; this.pending = null; this.emit(); });
  }
  clearLanding(delay) {
    const re = this.o.ctx.arrEnd(), CS = [this.cs, this.csS];
    this.atc('TWR', M(CS, ', ', this.windM(), ', runway ', [re.ident, rwyS(re.ident)], ', cleared to land.'), delay, () => { this.phase = 'land_clr'; this.flags.landRb = false; this.pending = null; this.emit(); });
  }
  // ---------------------------------------------------------------- ATC follows the flight
  follow(dt) {
    const c = this.o.ctx; const s = c.state(); const p = this.phase; const CS = [this.cs, this.csS];
    if (this.queue.length) return;
    const fl = (this.apt().cc === 'US') ? 18000 : 7000;
    if (p === 'pushing' && c.pushDone()) { this.phase = 'pushed'; this.emit(); }
    if (p === 'hold_wait') { this.waitT = (this.waitT || 0) + dt; if (this.waitT > 3) { this.waitT = 0; const b = c.runwayBusy(this.dep, this.o.depEnd); if (!b.busy) { this.atc('TWR', M(CS, ', runway ', [this.o.depEnd.ident, rwyS(this.o.depEnd.ident)], ', line up and wait.'), 0.5, () => { this.phase = 'lineup'; this.emit(); }); } } }
    if (p === 'lineup') { this.waitT = (this.waitT || 0) + dt; if (this.waitT > 8 && !c.runwayBusy(this.dep, this.o.depEnd).busy) { this.waitT = 0; this.clearTakeoff(0.5); } }
    if ((p === 'takeoff_clr' || p === 'rwy_start' || p === 'taxiing') && !s.onGround && s.aglFt > 700) {
      this.atc('TWR', M(CS, ', ', this.pick('toDep', ['contact ', 'contact ', 'switch to ']), this.fac('DEP', this.dep).name, ' ', [fmtF(this.fac('DEP', this.dep)), freqS(this.fac('DEP', this.dep))], ', ', this.bye(this.dep), '.'), 0.3, () => { this.phase = 'handoff_dep'; this.emit(); });
      this.phase = 'airborne';
    }
    if (p === 'twr_continue') { this.waitT = (this.waitT || 0) + dt; if (this.waitT > 3) { this.waitT = 0; if (!c.runwayBusy(this.arr, c.arrEnd()).busy) this.clearLanding(0.3); } }
    if ((p === 'app') && s.locCaptured && s.thrNm < 12) { this.atc('APP', M(CS, ', contact ', this.fac('TWR', this.arr).name, ' ', [fmtF(this.fac('TWR', this.arr)), freqS(this.fac('TWR', this.arr))], '.'), 0.3, () => { this.phase = 'handoff_twr'; this.emit(); }); this.phase = 'app_x'; }
    if (['land_clr', 'twr_continue', 'final_start', 'handoff_twr', 'app', 'app_x'].includes(p) && s.onGround && s.gsKt < 45) {
      const side = c.exitSide();
      this.atc('TWR', M(CS, ', ', this.pick('vac', ['turn ' + side + ' next available taxiway, ', 'turn ' + side + ' when able, ', 'vacate ' + side + ', ']), 'contact ', this.fac('GND', this.arr).name, ' ', [fmtF(this.fac('GND', this.arr)), freqS(this.fac('GND', this.arr))], this.pick('welc', ['.', ', welcome to ' + (SHORT[this.arr.icao] || this.arr.city) + '.', '.'])), 0.8, () => { this.phase = 'handoff_gnd'; this.emit(); });
      this.phase = 'landed';
    }
    if (p === 'taxi_in' && c.atGate()) { this.phase = 'parked'; this.emit(); }
    // controller calls you first: traffic advisories
    if (!s.onGround && c.traffic && !this.queue.length) {
      for (const a of c.traffic()) {
        if (a.advised || a.done) continue; const d = a.distNm, da = a.dAltFt;
        if (d < 5.5 && d > 1.5 && Math.abs(da) < 2200 && s.altFt < 14000 && (a.kind === 'arr' ? a.s < -2500 : a.h > 60)) {
          a.advised = true; const k = ['takeoff_clr', 'airborne', 'land_clr', 'twr_continue', 'handoff_twr', 'final_start'].includes(p) ? 'TWR' : ['dep', 'handoff_dep'].includes(p) ? 'DEP' : 'APP';
          const ty = a.type || ['737', 'seven three seven']; const clock = a.clock;
          this.atc(k, M(CS, ', traffic, ', [clock + " o'clock", digits(clock) === 'one' ? "one o'clock" : clock + " o'clock"], ', ', [String(Math.round(d)), String(Math.round(d))], Math.round(d) === 1 ? ' mile, ' : ' miles, ', [ty[0], ty[1]], ', ', Math.abs(da) < 400 ? 'same altitude' : M([Math.round(Math.abs(da) / 100) * 100 + ' ft', altS(Math.round(Math.abs(da) / 100) * 100, 99999) + ' feet'], da > 0 ? ' above' : ' below').d, a.vs > 300 ? ', climbing' : a.vs < -300 ? ', descending' : '', '.'), 0.4, () => { this.flags.tfc = true; this.emit(); });
          break;
        }
      }
    }
    // a slow readback gets a nudge
    const rbWait = { clr_given: 'DEL', taxi_given: 'GND' }[p] || (p === 'land_clr' && !this.flags.landRb ? 'TWR' : null);
    if (rbWait && !this.auto) { this.rbT = (this.rbT || 0) + dt; if (this.rbT > 24 && !this.flags['nudge_' + p]) { this.flags['nudge_' + p] = true; this.atc(rbWait, M(CS, ', ', this.pick('nudge', ['did you copy?', 'how do you read?', 'read back, please.', 'say again your readback?']))); } } else this.rbT = 0;
    // altitude busts against the last assigned altitude
    this.bustT -= dt;
    if (this.assigned && !s.onGround && ['dep', 'descent', 'app', 'app_x', 'handoff_dep', 'enroute'].includes(p) && this.bustT <= 0) {
      const dev = s.altFt - this.assigned; const away = Math.sign(dev) === Math.sign(s.vsFpm) || Math.abs(s.vsFpm) < 200;
      if (Math.abs(dev) > 350 && away && (p !== 'app_x' && !s.locCaptured || Math.abs(dev) > 800) && (this.lastAltOk || Math.abs(dev) > 1200)) {
        this.bustT = 45; this.flags.busts = (this.flags.busts || 0) + 1;
        this.atc(this.phase === 'dep' || p === 'handoff_dep' ? 'DEP' : 'APP', M(CS, ', altitude check, maintain ', [altD(this.assigned, fl), altS(this.assigned, fl)], '.'), 0.2);
      }
      if (Math.abs(dev) < 200) this.lastAltOk = true;
    }
  }
  setAssigned(ft) { this.assigned = ft; this.lastAltOk = false; }
}
