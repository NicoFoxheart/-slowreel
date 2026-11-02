// Procedural boarding and terminal music (Web Audio, nothing fetched). Regional moods: bossa nova (Miami, Latin
// America, Caribbean), Korean-style pentatonic with gayageum-like plucks and a flute (Seoul, East Asia), jazzy lounge
// (everywhere else), plus an ambient "music for airports" loop set for terminal halls. Ducks under cabin PAs.
const midi = n => 440 * Math.pow(2, (n - 69) / 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function moodFor(icao = '') {
  const c = String(icao).toUpperCase();
  if (/^(KMIA|KFLL|M[MKDUYWTRPGHNSZ]|T[A-Z]|S[A-Z])/.test(c)) return 'bossa';
  if (/^(RK|RJ|RO|RC|Z|VH|VM|VV)/.test(c)) return 'pentatonic';
  return 'lounge';
}
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// chords: bass root + comping tones (midi); scale: melody notes
const BOSSA = { bpm: 132, grid: 16, scale: [65, 67, 69, 70, 72, 74, 76, 77, 79, 81], chords: [[41, [57, 60, 64]], [41, [57, 60, 64]], [43, [53, 59, 62]], [43, [53, 59, 62]], [43, [53, 58, 62]], [42, [52, 58, 61]], [41, [57, 60, 64]], [42, [52, 58, 61]]] };
const LOUNGE = { bpm: 88, grid: 8, swing: 0.62, scale: [62, 64, 65, 67, 69, 71, 72, 74, 76, 77], chords: [[38, [53, 57, 60, 64]], [43, [53, 59, 64]], [36, [52, 55, 59, 62]], [45, [55, 61, 65]], [38, [53, 57, 60, 64]], [43, [53, 59, 65]], [40, [55, 59, 62]], [45, [55, 61, 64]]] };
const PENTA = { bpm: 76, grid: 8, scale: [62, 64, 66, 69, 71, 74, 76, 78, 81, 83], chords: [[38, [50, 57, 62, 64]], [38, [50, 57, 62, 64]], [35, [47, 54, 59, 61]], [35, [47, 54, 59, 61]], [43, [55, 62, 64, 69]], [43, [55, 62, 64, 69]], [45, [57, 62, 64, 69]], [45, [57, 62, 64, 69]]] };

export class Music {
  constructor(audio) { this.audio = audio; this.on = true; this.vol = 0.5; this.term = true; this.key = null; this.g = 0; this.ducked = false; this.R = rng(7); }
  init() {
    const c = this.audio.ctx; if (!c || !this.audio.master) return false; if (this.out) return true;
    this.bus = c.createGain(); this.bus.gain.value = 1;
    this.conv = c.createConvolver(); this.conv.buffer = this.impulse(2.6); this.wet = c.createGain(); this.wet.gain.value = 0.2;
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 7000; this.hp = c.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 90;
    this.duckG = c.createGain(); this.duckG.gain.value = this.ducked ? 0.2 : 1; this.out = c.createGain(); this.out.gain.value = 0;
    this.bus.connect(this.lp); this.bus.connect(this.conv); this.conv.connect(this.wet); this.wet.connect(this.lp); this.lp.connect(this.hp); this.hp.connect(this.duckG); this.duckG.connect(this.out); this.out.connect(this.audio.master);
    const n = c.sampleRate * 2; this.noise = c.createBuffer(1, n, c.sampleRate); const d = this.noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  impulse(sec) { const c = this.audio.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2) * (i < 120 ? i / 120 : 1); } return b; }
  get now() { return this.prog && this.g > 0.004 ? this.prog : null; } // programme currently audible (bossa / pentatonic / lounge / ambient)
  duck(on) { this.ducked = on; if (this.duckG) this.duckG.gain.setTargetAtTime(on ? 0.2 : 1, this.audio.ctx.currentTime, on ? 0.12 : 0.7); }
  // want: { kind: 'cabin' | 'terminal' | null, mood, level 0..1 }
  update(dt, want) {
    if (!this.audio.ctx || !this.init()) return; const c = this.audio.ctx, now = c.currentTime;
    const kind = this.on && want && want.kind && (want.kind !== 'terminal' || this.term) ? want.kind : null;
    const key = kind ? kind + ':' + (kind === 'terminal' ? (want.mood === 'pentatonic' ? 'penta' : 'major') : want.mood) : null;
    const tgt = key && key === this.key ? clamp(want.level ?? 1, 0, 1) * this.vol * (kind === 'terminal' ? 0.55 : 0.7) : 0;
    this.g += clamp(tgt - this.g, -dt / 1.4, dt / 2.2); this.out.gain.setTargetAtTime(this.g, now, 0.08);
    if (key !== this.key && this.g < 0.004) { // switch programme once the old one has faded
      this.key = key; this.prog = !key ? null : kind === 'terminal' ? 'ambient' : want.mood; this.def = this.prog === 'bossa' ? BOSSA : this.prog === 'pentatonic' ? PENTA : LOUNGE;
      this.step = 0; this.nextT = now + 0.15; this.motifs = {}; this.R = rng((Math.random() * 1e9) | 0); this.loops = null;
      this.wet.gain.value = kind === 'terminal' ? 0.55 : 0.18; this.lp.frequency.value = kind === 'terminal' ? 9000 : 6500;
    }
    if (!this.prog || (this.g < 0.002 && tgt === 0)) return;
    const ahead = clamp(dt * 2, 0.25, 1.0);
    if (this.prog === 'ambient') { this.ambient(now, ahead); return; }
    const D = this.def, beat = 60 / D.bpm, stepDur = beat * 4 / D.grid;
    if (this.nextT < now) { const k = Math.ceil((now - this.nextT) / stepDur); this.step += k; this.nextT += k * stepDur; } // skip, never burst, after a stall
    while (this.nextT < now + ahead) { let t = this.nextT; const s = this.step; if (D.swing && s % 2 === 1) t += stepDur * (D.swing - 0.5) * 2 * 0.5; this[this.prog](t, s, stepDur); this.step++; this.nextT += stepDur; }
  }
  // ---------- instruments (all into this.bus)
  vo(type, f, t, end) { const o = this.audio.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(end); return o; }
  gn(v = 0) { const g = this.audio.ctx.createGain(); g.gain.value = v; return g; }
  env(g, t, a, peak, tc, end) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(0, t + a, tc); if (end) g.gain.setTargetAtTime(0, end, 0.04); }
  pluck(t, f, g, dec = 0.45, bright = 2600) { const c = this.audio.ctx; const e = this.gn(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7; lp.frequency.setValueAtTime(bright, t); lp.frequency.setTargetAtTime(Math.max(300, f * 1.5), t, dec * 0.35);
    const end = t + dec * 4; const o1 = this.vo('triangle', f, t, end), o2 = this.vo('sine', f * 2, t, end), g2 = this.gn(0.25); o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(e); e.connect(this.bus); this.env(e, t, 0.004, g, dec / 3); }
  ep(t, f, g, dur = 0.8) { const c = this.audio.ctx; const e = this.gn(), end = t + dur + 1.2; const car = this.vo('sine', f, t, end), mod = this.vo('sine', f, t, end), mg = this.gn(); mg.gain.setValueAtTime(f * 1.1, t); mg.gain.setTargetAtTime(f * 0.12, t, 0.25); mod.connect(mg); mg.connect(car.frequency);
    const tine = this.vo('sine', f * 4.02, t, t + 0.4), tg = this.gn(); tg.gain.setValueAtTime(g * 0.12, t); tg.gain.setTargetAtTime(0, t, 0.05); tine.connect(tg); tg.connect(this.bus); car.connect(e); e.connect(this.bus); this.env(e, t, 0.006, g, 0.9, t + dur); }
  bass(t, f, g, dur) { const c = this.audio.ctx; const e = this.gn(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; const end = t + dur + 0.3; const o = this.vo('sine', f, t, end), o2 = this.vo('triangle', f, t, end), g2 = this.gn(0.45); o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(e); e.connect(this.bus); this.env(e, t, 0.012, g, 0.45, t + dur); }
  hit(t, g, f, q, tc, type = 'highpass') { const c = this.audio.ctx; const s = c.createBufferSource(); s.buffer = this.noise; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const e = this.gn(); s.connect(fl); fl.connect(e); e.connect(this.bus); this.env(e, t, 0.003, g, tc); s.start(t, Math.random() * 1.5); s.stop(t + tc * 8 + 0.05); }
  thump(t, g) { const o = this.vo('sine', 95, t, t + 0.5); o.frequency.setTargetAtTime(55, t, 0.06); const e = this.gn(); o.connect(e); e.connect(this.bus); this.env(e, t, 0.005, g, 0.12); }
  gay(t, f, g) { const c = this.audio.ctx; const e = this.gn(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t); lp.frequency.setTargetAtTime(900, t, 0.3); const end = t + 2.4;
    const o = this.vo('triangle', f * 1.035, t, end); o.frequency.setTargetAtTime(f, t, 0.025); const lfo = this.vo('sine', 5.2, t, end), lg = this.gn(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.009, t + 0.6); lfo.connect(lg); lg.connect(o.frequency);
    const o2 = this.vo('sine', f * 3, t, t + 0.3), g2 = this.gn(); g2.gain.setValueAtTime(g * 0.3, t); g2.gain.setTargetAtTime(0, t, 0.04); o2.connect(g2); g2.connect(this.bus); o.connect(lp); lp.connect(e); e.connect(this.bus); this.env(e, t, 0.004, g, 0.55); }
  flute(t, f, g, dur) { const c = this.audio.ctx; const e = this.gn(), end = t + dur + 0.6; const o = this.vo('sine', f, t, end); const lfo = this.vo('sine', 4.8, t, end), lg = this.gn(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.007, t + dur * 0.6); lfo.connect(lg); lg.connect(o.frequency);
    const s = c.createBufferSource(); s.buffer = this.noise; const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 3; const ng = this.gn(0.06); s.connect(bp); bp.connect(ng); ng.connect(e); s.start(t, Math.random()); s.stop(end);
    o.connect(e); e.connect(this.bus); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + 0.18); e.gain.setTargetAtTime(g * 0.7, t + 0.18, dur * 0.5); e.gain.setTargetAtTime(0, t + dur, 0.18); }
  pad(t, fs, g, dur) { const c = this.audio.ctx; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; const e = this.gn(); lp.connect(e); e.connect(this.bus); const end = t + dur + 2.5;
    for (const f of fs) for (const d of [-0.004, 0.004]) { const o = this.vo('sawtooth', f * (1 + d), t, end); o.connect(lp); }
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + Math.min(1.6, dur * 0.4)); e.gain.setTargetAtTime(0, t + dur, 0.8); }
  bell(t, f, g) { for (const [k, a, tc] of [[1, 1, 2.2], [2.0, 0.3, 1.1], [2.76, 0.18, 0.6], [5.4, 0.06, 0.25]]) { const o = this.vo('sine', f * k, t, t + tc * 6), e = this.gn(); o.connect(e); e.connect(this.bus); this.env(e, t, 0.004, g * a, tc); } }
  // ---------- melody motif per 4-bar phrase (A A' B A), anchored to chord tones on strong steps
  motif(bar, D, steps, dens) {
    const ph = Math.floor(bar / 4) % 4, kind = ['A', 'A2', 'B', 'A'][ph], id = kind + ':' + Math.floor(bar / 16), m = this.motifs;
    if (!m[id]) { const R = this.R, out = []; let i = 3 + ((R() * 4) | 0); for (let b = 0; b < 4; b++) { const row = []; for (const s of steps) if (R() < dens) { i = clamp(i + [-2, -1, -1, 1, 1, 2, 0][(R() * 7) | 0], 0, D.scale.length - 1); row.push([s, i, R() < 0.3 ? 2 : 1]); } out.push(row); }
      if (kind === 'A2' && m['A:' + Math.floor(bar / 16)]) { const a = m['A:' + Math.floor(bar / 16)]; out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; }
      m[id] = out; }
    return ph === 3 && Math.floor(bar / 16) % 2 === 1 ? [] : m[id][bar % 4];
  }
  near(D, i, tones) { const n = D.scale[i]; let best = n, bd = 99; for (const t of tones) for (const o of [12, 24]) { const d = Math.abs(t + o - n); if (d < bd && d <= 2) { bd = d; best = t + o; } } return best; }
  // ---------- programmes
  bossa(t, s, sd) {
    const D = BOSSA, bar = Math.floor(s / 16), st = s % 16, [root, tones] = D.chords[bar % 8], R = this.R;
    if (st === 0) this.bass(t, midi(root), 0.22, sd * 5); if (st === 6) this.bass(t, midi(root + 7), 0.14, sd * 1.6); if (st === 8) this.bass(t, midi(root + 7), 0.2, sd * 5); if (st === 14) this.bass(t, midi(root), 0.12, sd * 1.6);
    const comp = bar % 2 ? [2, 5, 9, 12] : [0, 3, 6, 10, 13]; if (comp.includes(st)) tones.forEach((n, k) => this.pluck(t + k * 0.009, midi(n), 0.045, 0.32, 2200));
    this.hit(t, st % 2 ? 0.02 : 0.011, 7000, 0.7, 0.022); if ([0, 3, 6, 10, 13].includes(st) && bar % 2) this.hit(t, 0.03, 1800, 5, 0.012, 'bandpass');
    for (const [ms, i, len] of this.motif(bar, D, [0, 2, 3, 6, 8, 10, 11, 14], 0.42)) if (ms === st) this.ep(t, midi(this.near(D, i, tones)), 0.05, sd * 2 * len + 0.2);
  }
  lounge(t, s, sd) {
    const D = LOUNGE, bar = Math.floor(s / 8), st = s % 8, [root, tones] = D.chords[bar % 8], next = D.chords[(bar + 1) % 8][0];
    if (st % 2 === 0) { const q = st / 2; const n = q === 0 ? root : q === 1 ? root + (tones.length > 3 ? 3 : 4) : q === 2 ? root + 7 : next + (this.R() < 0.5 ? 1 : -1); this.bass(t, midi(n), 0.2, sd * 1.7); this.hit(t, 0.012, 3800, 0.6, 0.06, 'bandpass'); }
    if (st === 2 || st === 6) this.hit(t, 0.016, 8000, 0.7, 0.03);
    if (st === 0 || st === 3 || (st === 7 && this.R() < 0.4)) tones.forEach((n, k) => this.ep(t + k * 0.006, midi(n), 0.032, st === 0 ? sd * 2.5 : sd * 1.2));
    for (const [ms, i, len] of this.motif(bar, D, [0, 1, 2, 3, 4, 5, 6, 7], 0.32)) if (ms === st) this.ep(t, midi(this.near(D, i, tones) + 12), 0.035, sd * len + 0.3);
  }
  pentatonic(t, s, sd) {
    const D = PENTA, bar = Math.floor(s / 8), st = s % 8, [root, tones] = D.chords[bar % 8], R = this.R;
    if (st === 0 && bar % 2 === 0) { this.pad(t, tones.map(midi), 0.012, sd * 16); this.bass(t, midi(root), 0.13, sd * 7); }
    if (st === 0) this.thump(t, 0.07); if (st === 5 && R() < 0.6) this.hit(t, 0.018, 2200, 4, 0.02, 'bandpass');
    if ([0, 2, 3, 5, 6].includes(st) && R() < 0.75) { const i = clamp(((bar * 3 + st) % 7) + ((R() * 3) | 0) - 1, 0, 9); this.gay(t, midi(D.scale[i] - 12), 0.06); }
    if (st === 0 && bar % 2 === 1) { const ph = this.motif(bar, D, [0, 4], 0.9); const n = ph.length ? ph[0][1] : 4; this.flute(t + sd, midi(D.scale[clamp(n + 2, 0, 9)]), 0.035, sd * 5); }
    if (st === 4 && R() < 0.15) this.bell(t, midi(D.scale[5 + ((R() * 5) | 0)] + 12), 0.025);
  }
  ambient(now, ahead) { // Eno-style tape loops of different lengths drifting against each other, with a slow drone
    const penta = this.key === 'terminal:penta'; const notes = penta ? [62, 66, 69, 71, 74, 78, 81] : [65, 69, 72, 76, 79, 81, 84];
    if (!this.loops) { const P = [17.9, 20.3, 23.1, 19.4, 26.7, 21.8, 29.3]; this.loops = notes.map((n, i) => ({ n, p: P[i], next: now + 0.5 + i * 2.7 })); this.droneT = now; }
    for (const L of this.loops) { if (L.next < now) L.next = now + 0.2 + this.R() * 3; if (L.next < now + ahead) { this.bell(L.next, midi(L.n), 0.05); if (this.R() < 0.4) this.ep(L.next + 0.02, midi(L.n - 12), 0.025, 2.2); L.next += L.p; } }
    if (this.droneT < now - 1) this.droneT = now + 0.1;
    if (this.droneT < now + ahead) { const r = penta ? [50, 57] : [53, 60]; this.pad(this.droneT, [midi(r[0]), midi(r[1])], 0.008, 28); this.droneT += 30; }
  }
}
