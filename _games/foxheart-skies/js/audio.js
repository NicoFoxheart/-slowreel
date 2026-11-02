// Synthesised sound: engines (fan whine, buzz-saw, rumble), wind, gear/flap motors, touchdown chirp,
// rolling rumble, warnings and GPWS-style callouts (browser speech synthesis if available, else tones).
export class Audio {
  constructor() { this.ctx = null; this.vol = 0.7; this.voice = true; this.inside = false; }
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.vol; this.master.connect(c.destination);
    this.cabin = c.createBiquadFilter(); this.cabin.type = 'lowpass'; this.cabin.frequency.value = 18000; this.cabin.connect(this.master);
    const noiseBuf = (type) => { const n = c.sampleRate * 3, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0); let l = 0, p = [0, 0, 0]; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (type === 'brown') { l = (l + 0.02 * w) / 1.02; d[i] = l * 3.5; } else if (type === 'pink') { p[0] = 0.997 * p[0] + w * 0.029; p[1] = 0.985 * p[1] + w * 0.032; p[2] = 0.95 * p[2] + w * 0.048; d[i] = (p[0] + p[1] + p[2] + w * 0.05) * 1.1; } else d[i] = w; } return b; };
    this.bufs = { white: noiseBuf('white'), pink: noiseBuf('pink'), brown: noiseBuf('brown') };
    const loop = (buf) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    // engine rumble
    this.rumble = c.createBiquadFilter(); this.rumble.type = 'lowpass'; this.rumble.frequency.value = 120; this.rumbleG = c.createGain(); this.rumbleG.gain.value = 0;
    loop(this.bufs.brown).connect(this.rumble); this.rumble.connect(this.rumbleG); this.rumbleG.connect(this.cabin);
    // jet roar (broadband)
    this.roar = c.createBiquadFilter(); this.roar.type = 'bandpass'; this.roar.Q.value = 0.6; this.roar.frequency.value = 500; this.roarG = c.createGain(); this.roarG.gain.value = 0;
    loop(this.bufs.pink).connect(this.roar); this.roar.connect(this.roarG); this.roarG.connect(this.cabin);
    // fan whine (blade passing) + harmonic
    this.whine = c.createOscillator(); this.whine.type = 'triangle'; this.whine2 = c.createOscillator(); this.whine2.type = 'sine';
    this.whineG = c.createGain(); this.whineG.gain.value = 0; this.whine.connect(this.whineG); const w2g = c.createGain(); w2g.gain.value = 0.35; this.whine2.connect(w2g); w2g.connect(this.whineG);
    const wf = c.createBiquadFilter(); wf.type = 'highpass'; wf.frequency.value = 300; this.whineG.connect(wf); wf.connect(this.cabin); this.whine.start(); this.whine2.start();
    // buzz-saw (high N1)
    this.buzz = c.createOscillator(); this.buzz.type = 'sawtooth'; this.buzzF = c.createBiquadFilter(); this.buzzF.type = 'lowpass'; this.buzzF.frequency.value = 900; this.buzzG = c.createGain(); this.buzzG.gain.value = 0;
    this.buzz.connect(this.buzzF); this.buzzF.connect(this.buzzG); this.buzzG.connect(this.cabin); this.buzz.start();
    // wind
    this.wind = c.createBiquadFilter(); this.wind.type = 'bandpass'; this.wind.Q.value = 0.4; this.windG = c.createGain(); this.windG.gain.value = 0;
    loop(this.bufs.pink).connect(this.wind); this.wind.connect(this.windG); this.windG.connect(this.master);
    // rolling rumble
    this.roll = c.createBiquadFilter(); this.roll.type = 'lowpass'; this.roll.frequency.value = 160; this.rollG = c.createGain(); this.rollG.gain.value = 0;
    loop(this.bufs.brown).connect(this.roll); this.roll.connect(this.rollG); this.rollG.connect(this.master);
    // rain
    this.rain = c.createBiquadFilter(); this.rain.type = 'highpass'; this.rain.frequency.value = 2500; this.rainG = c.createGain(); this.rainG.gain.value = 0;
    loop(this.bufs.white).connect(this.rain); this.rain.connect(this.rainG); this.rainG.connect(this.master);
    // ambient airport (distant jets / hum)
    this.amb = c.createBiquadFilter(); this.amb.type = 'lowpass'; this.amb.frequency.value = 350; this.ambG = c.createGain(); this.ambG.gain.value = 0;
    loop(this.bufs.pink).connect(this.amb); this.amb.connect(this.ambG); this.ambG.connect(this.master);
    // motors (gear / flaps)
    this.motor = c.createOscillator(); this.motor.type = 'sawtooth'; this.motor.frequency.value = 110; this.motorF = c.createBiquadFilter(); this.motorF.type = 'bandpass'; this.motorF.frequency.value = 420; this.motorF.Q.value = 3;
    this.motorG = c.createGain(); this.motorG.gain.value = 0; this.motor.connect(this.motorF); this.motorF.connect(this.motorG); this.motorG.connect(this.cabin); this.motor.start();
    // stall warning / warnings
    this.warnG = c.createGain(); this.warnG.gain.value = 0; this.warn = c.createOscillator(); this.warn.type = 'square'; this.warn.frequency.value = 820; this.warn.connect(this.warnG); this.warnG.connect(this.master); this.warn.start();
    this.apuO = c.createOscillator(); this.apuO.type = 'sawtooth'; this.apuF = c.createBiquadFilter(); this.apuF.type = 'bandpass'; this.apuF.Q.value = 2; this.apuG = c.createGain(); this.apuG.gain.value = 0;
    this.apuO.connect(this.apuF); this.apuF.connect(this.apuG); this.apuG.connect(this.cabin); this.apuO.start();
    this.lastBeep = 0;
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  update(S, dt, view) {
    const c = this.ctx; if (!c) return; const t = c.currentTime; const k = 0.08;
    if (S.paused) { this.master.gain.setTargetAtTime(0, t, 0.05); return; } else this.master.gain.setTargetAtTime(this.vol, t, 0.1);
    const f = S.fdm; const n1 = Math.max((f.n1[0] + f.n1[1]) / 2 / 100, f.n2 ? (f.n2[0] + f.n2[1]) / 2 / 100 * 0.34 : 0); const ias = f.ias;
    const apu = (S.apuN || 0) / 100; this.apuO.frequency.setTargetAtTime(120 + apu * 380, t, 0.3); this.apuF.frequency.setTargetAtTime(900 + apu * 2600, t, 0.3); this.apuG.gain.setTargetAtTime(apu * 0.022 * (view === 'cockpit' ? 0.5 : 1), t, 0.4);
    const inside = view === 'cockpit'; this.cabin.frequency.setTargetAtTime(inside ? 1800 : 16000, t, 0.2);
    const dist = S.camDist || 30; const att = inside ? 0.45 : Math.min(1, 60 / Math.max(20, dist));
    this.rumbleG.gain.setTargetAtTime((0.05 * Math.min(1, n1 / 0.2) + n1 * n1 * 0.5) * att * (inside ? 1.6 : 1), t, k); // silent until the engines spool
    // ground ambience: now and then a distant jet spooling up or taxiing past
    if (S.ground && S.nearAirport) { this.jetT = (this.jetT ?? 6) - dt; if (this.jetT < 0) { this.jetT = 16 + Math.random() * 28; this.distantJet(inside); } }
    this.rumble.frequency.setTargetAtTime(60 + n1 * 140, t, k);
    this.roarG.gain.setTargetAtTime(Math.pow(n1, 2.6) * 0.55 * att * (1 + f.reverser), t, k); this.roar.frequency.setTargetAtTime(250 + n1 * 900, t, k);
    this.whine.frequency.setTargetAtTime(400 + n1 * 2100, t, k); this.whine2.frequency.setTargetAtTime(800 + n1 * 4200, t, k);
    this.whineG.gain.setTargetAtTime((n1 > 0.15 ? 0.035 + 0.05 * (1 - Math.abs(n1 - 0.45)) : 0) * att * (inside ? 0.35 : 1), t, k);
    this.buzz.frequency.setTargetAtTime(60 + n1 * 28, t, k); this.buzzG.gain.setTargetAtTime(Math.max(0, n1 - 0.78) * 0.9 * att, t, k);
    const w = Math.min(1.4, ias / 250);
    this.windG.gain.setTargetAtTime(w * w * (inside ? 0.16 : 0.32), t, k); this.wind.frequency.setTargetAtTime(300 + ias * 6, t, k);
    const gsKt = Math.hypot(f.vel.x, f.vel.z) / 0.5144;
    this.rollG.gain.setTargetAtTime(f.onGround ? Math.min(0.5, gsKt / 120) * 0.6 : 0, t, k); this.roll.frequency.setTargetAtTime(60 + gsKt * 2, t, k);
    this.rainG.gain.setTargetAtTime(S.rain ? (inside ? 0.06 : 0.1) : 0, t, 0.5);
    this.ambG.gain.setTargetAtTime(S.nearAirport && f.pos.y - S.groundH < 300 ? 0.05 : 0, t, 0.8);
    const moving = Math.abs(f.gearPos - (f.gearDown ? 1 : 0)) > 0.005 || Math.abs(f.flapPos - S.flapTarget) > 0.004;
    this.motorG.gain.setTargetAtTime(moving ? 0.05 * (inside ? 1.3 : 0.6) : 0, t, 0.15); this.motor.frequency.setTargetAtTime(Math.abs(f.gearPos - (f.gearDown ? 1 : 0)) > 0.005 ? 85 : 140, t, 0.1);
    // stall warning cricket
    const stall = f.stall > 0.25 && !f.onGround;
    this.warnG.gain.setTargetAtTime(stall && (t * 6 % 1) < 0.5 ? 0.06 : 0, t, 0.01);
  }
  blip(freq, dur, type = 'sine', gain = 0.12, when = 0) { const c = this.ctx; if (!c) return; const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = freq; g.gain.value = 0; o.connect(g); g.connect(this.master); const t = c.currentTime + when; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.setValueAtTime(gain, t + dur - 0.03); g.gain.linearRampToValueAtTime(0, t + dur); o.start(t); o.stop(t + dur + 0.05); }
  noiseHit(dur, f0, f1, gain) { const c = this.ctx; if (!c) return; const s = c.createBufferSource(); s.buffer = this.bufs.white; const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6; const g = c.createGain(); const t = c.currentTime; bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(bp); bp.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.05); }
  thump(gain = 0.5) { const c = this.ctx; if (!c) return; const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 70; const t = c.currentTime; o.frequency.exponentialRampToValueAtTime(30, t + 0.25); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.35); }
  touchdown(vs) { const s = Math.min(1, Math.abs(vs) / 3); this.noiseHit(0.35, 1700, 600, 0.12 + 0.25 * s); setTimeout(() => this.noiseHit(0.25, 1500, 700, 0.1), 90); this.thump(0.25 + 0.5 * s); }
  gearClunk() { this.thump(0.35); this.noiseHit(0.12, 400, 200, 0.1); }
  apOff() { [0, 0.2, 0.4].forEach(w => { this.blip(1300, 0.08, 'square', 0.06, w); this.blip(1000, 0.08, 'square', 0.06, w + 0.1); }); }
  stepOn() { if (!this.ctx) return; const c = this.ctx, t = c.currentTime; for (const f of [1210, 1287]) { const o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.05); g.gain.setValueAtTime(0.05, t + 1.0); g.gain.linearRampToValueAtTime(0.0001, t + 1.2); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1.25); } this.noiseHit(1.1, 2500, 900, 0.08); }
  radioOpen(me, vol = 1) { if (!this.ctx) return; if (me) this.blip(2400, 0.025, 'square', 0.05); this.noiseHit(0.12, 2200, 1400, (me ? 0.05 : 0.09) * vol); const c = this.ctx; if (!this.stat) { const src = c.createBufferSource(); src.buffer = this.bufs.white; src.loop = true; const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8; this.statG = c.createGain(); this.statG.gain.value = 0; src.connect(bp); bp.connect(this.statG); this.statG.connect(this.master); src.start(); this.stat = src; } this.statG.gain.setTargetAtTime(0.012 + Math.random() * 0.012, c.currentTime, 0.05); }
  radioClose() { if (!this.ctx || !this.statG) return; this.statG.gain.setTargetAtTime(0, this.ctx.currentTime + 0.05, 0.03); this.noiseHit(0.22 + Math.random() * 0.1, 1800, 450, 0.08); }
  bell(freq, when = 0, gain = 0.1, decay = 1.4) { // struck-bell tone with soft partials, through a short echo for the cabin
    const c = this.ctx; if (!c) return; const t = c.currentTime + when;
    if (!this.paBus) { this.paBus = c.createGain(); this.paBus.gain.value = 1; const d = c.createDelay(0.5); d.delayTime.value = 0.085; const fb = c.createGain(); fb.gain.value = 0.32; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; this.paBus.connect(this.master); this.paBus.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(this.master); }
    for (const [m, a] of [[1, 1], [2.01, 0.28], [3.0, 0.08]]) { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = freq * m; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain * a, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + decay / m); o.connect(g); g.connect(this.paBus); o.start(t); o.stop(t + decay + 0.1); }
  }
  masterChime() { this.bell(1046, 0, 0.1, 0.45); } // one stroke of the continuous repetitive chime (master warning)
  cautionChime() { this.bell(880, 0, 0.11, 1.1); } // single chime (master caution)
  paChime() { this.bell(830, 0, 0.11, 1.5); this.bell(660, 0.55, 0.11, 1.9); } // high-low "ding-dong"
  signDing() { this.bell(1046, 0, 0.09, 1.2); } // single cabin-sign ding
  callDing() { this.bell(880, 0, 0.08, 1.0); this.bell(880, 0.32, 0.06, 1.0); }
  paHiss(on) { const c = this.ctx; if (!c) return; if (!this.paH) { const s = c.createBufferSource(); s.buffer = this.bufs.pink; s.loop = true; const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1600; hp.Q.value = 0.5; this.paHG = c.createGain(); this.paHG.gain.value = 0; s.connect(hp); hp.connect(this.paHG); this.paHG.connect(this.master); s.start(); this.paH = s; } this.paHG.gain.setTargetAtTime(on ? 0.014 : 0, c.currentTime, on ? 0.04 : 0.15); if (on) this.noiseHit(0.06, 900, 600, 0.05); }
  applause(dur = 6, gain = 0.16) { // ~40 people clapping, made from short filtered noise bursts
    const c = this.ctx; if (!c) return; const sr = c.sampleRate, n = Math.floor(sr * dur), b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
    for (let k = 0; k < 40; k++) { let tt = Math.random() * 0.4 + k * 0.03; const rate = 3.2 + Math.random() * 2.2, amp = 0.4 + Math.random() * 0.6; while (tt < dur - 0.05) { const i0 = Math.floor(tt * sr), env = Math.min(1, tt / 0.6, (dur - tt) / 1.6); for (let i = 0; i < 300 && i0 + i < n; i++) d[i0 + i] += (Math.random() * 2 - 1) * Math.exp(-i / 55) * amp * env; tt += 1 / rate * (0.85 + Math.random() * 0.3); } }
    const s = c.createBufferSource(); s.buffer = b; const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.6; const g = c.createGain(); g.gain.value = gain; s.connect(bp); bp.connect(g); g.connect(this.cabin); s.start();
  }
  distantJet(inside) {
    const c = this.ctx; if (!c) return; const s = c.createBufferSource(); s.buffer = this.bufs.pink; s.loop = true; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420 + Math.random() * 300;
    const bp = c.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 900 + Math.random() * 800; bp.gain.value = 6; const g = c.createGain(); const t = c.currentTime, peak = (0.025 + Math.random() * 0.03) * (inside ? 0.5 : 1), up = 3 + Math.random() * 3, hold = 2 + Math.random() * 4, down = 5 + Math.random() * 4;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + up); g.gain.setValueAtTime(peak, t + up + hold); g.gain.linearRampToValueAtTime(0.0001, t + up + hold + down);
    lp.frequency.linearRampToValueAtTime(lp.frequency.value * 1.6, t + up); s.connect(lp); lp.connect(bp); bp.connect(g); g.connect(this.master); s.start(t, Math.random() * 2); s.stop(t + up + hold + down + 0.2);
  }
  click(kind = 'switch') { if (!this.ctx) return; this.noiseHit(0.025, kind === 'switch' ? 3600 : 2600, 1400, kind === 'switch' ? 0.14 : 0.08); this.blip(kind === 'pb' ? 1900 : 1100, 0.012, 'square', 0.025); }
  chime() { this.blip(660, 0.25, 'sine', 0.1); this.blip(880, 0.35, 'sine', 0.08, 0.12); }
  call(text) {
    let spoke = false;
    if (this.voice && this.speech && this.speech.canSpeak() && this.speech.voices().length) { // shared speech manager (callouts never talk over a PA)
      spoke = this.speech.say({ channel: 'gpws', text: text.toLowerCase().replace('2500', 'twenty five hundred'), rate: 1.15, pitch: 0.7, volume: Math.min(1, this.vol + 0.2), maxWait: 1.2 }) != null;
    }
    if (!spoke) { if (text === 'RETARD') { this.blip(740, 0.12, 'square', 0.07); this.blip(740, 0.12, 'square', 0.07, 0.18); } else if (text === 'MINIMUMS') this.blip(980, 0.4, 'triangle', 0.08); else this.blip(1180 - Math.min(600, +text || 0) * 0.3, 0.09, 'triangle', 0.07); }
  }
}
