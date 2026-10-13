// effects.js - the sky effects: reverb spaces with octave-up shimmer, tape echo, filter, chorus, glow
// saturation, EQ and drift (auto-pan / tremolo). Every effect is {input, output, set(id, v), dispose()}.
// Param descriptors: {id, name, min, max, default, unit?, step?, curve?:'log', options?:[names]}.
// A param with `options` takes the option INDEX as its value (0, 1, 2...).
import { SPACES, spaceImpulse } from './impulses.js';
import { clamp, expMap, glide, setNow, safeDisconnect, safeStop, driveCurve } from './util.js';

const P = (id, name, min, max, def, extra = {}) => ({ id, name, min, max, default: def, ...extra });
const INTERVALS = [{ name: 'Octave', ratio: 2 }, { name: 'Octave + fifth', ratio: 3 }, { name: 'Fifth', ratio: 1.5 }];

export const EFFECTS = [
  { id: 'reverb', name: 'Reverb', params: [
    P('type', 'Space', 0, SPACES.length - 1, 3, { step: 1, options: SPACES.map(s => s.name) }),
    P('mix', 'Mix', 0, 1, 0.35),
    P('size', 'Size', 0.5, 1.5, 1),
    P('predelay', 'Pre-delay', 0, 0.25, 0, { unit: 's' }),
    P('tone', 'Tone', 0, 1, 0.55),
    P('lowcut', 'Low cut', 40, 800, 180, { unit: 'Hz', curve: 'log' }),
    P('shimmer', 'Shimmer', 0, 1, 0),
    P('interval', 'Shimmer interval', 0, INTERVALS.length - 1, 0, { step: 1, options: INTERVALS.map(i => i.name) }),
  ], presets: [
    { id: 'shimmer-cathedral', name: 'Shimmer cathedral', params: { type: 3, size: 1, tone: 0.5, shimmer: 0.4, interval: 0, lowcut: 200 } },
    { id: 'halo', name: 'Halo', params: { type: 4, size: 1.1, tone: 0.6, shimmer: 0.45, interval: 1, lowcut: 260 } },
    { id: 'glass-hall', name: 'Glass hall', params: { type: 4, size: 1, tone: 0.65, shimmer: 0, lowcut: 180 } },
    { id: 'cathedral', name: 'Cathedral', params: { type: 3, size: 1, tone: 0.45, shimmer: 0, lowcut: 160 } },
    { id: 'cloud', name: 'Cloud', params: { type: 5, size: 1, tone: 0.5, shimmer: 0.2, lowcut: 220 } },
    { id: 'endless-sky', name: 'Endless sky', params: { type: 7, size: 1, tone: 0.45, shimmer: 0.25, lowcut: 220 } },
    { id: 'chapel', name: 'Chapel', params: { type: 1, size: 1, tone: 0.55, shimmer: 0, lowcut: 150 } },
    { id: 'reverse-swell', name: 'Reverse swell', params: { type: 6, size: 1.2, tone: 0.5, shimmer: 0, lowcut: 200 } },
  ] },
  { id: 'echo', name: 'Tape echo', params: [
    P('time', 'Time', 0.125, 4, 0.75, { unit: 'beats' }),
    P('feedback', 'Feedback', 0, 0.9, 0.45),
    P('tone', 'Tone', 0, 1, 0.45),
    P('wow', 'Wow', 0, 1, 0.3),
    P('spread', 'Spread', 0, 1, 0.6),
    P('mix', 'Mix', 0, 1, 0.3),
  ] },
  { id: 'filter', name: 'Filter', params: [
    P('mode', 'Mode', 0, 2, 0, { step: 1, options: ['Low-pass', 'High-pass', 'Band-pass'] }),
    P('cutoff', 'Cutoff', 40, 18000, 6000, { unit: 'Hz', curve: 'log' }),
    P('resonance', 'Resonance', 0, 1, 0.15),
    P('sweep', 'Sweep', 0, 1, 0),
    P('rate', 'Sweep rate', 0.01, 2, 0.08, { unit: 'Hz', curve: 'log' }),
  ] },
  { id: 'chorus', name: 'Chorus', params: [
    P('rate', 'Rate', 0.05, 3, 0.3, { unit: 'Hz', curve: 'log' }), P('depth', 'Depth', 0, 1, 0.5), P('mix', 'Mix', 0, 1, 0.4),
  ] },
  { id: 'glow', name: 'Glow', params: [P('drive', 'Drive', 0, 1, 0.3), P('tone', 'Tone', 0, 1, 0.6), P('mix', 'Mix', 0, 1, 0.5)] },
  { id: 'eq', name: 'EQ', params: [
    P('lowcut', 'Low cut', 20, 600, 20, { unit: 'Hz', curve: 'log' }),
    P('low', 'Low', -12, 12, 0, { unit: 'dB' }), P('mid', 'Mud', -12, 12, 0, { unit: 'dB' }),
    P('high', 'Presence', -12, 12, 0, { unit: 'dB' }), P('air', 'Air', -12, 12, 0, { unit: 'dB' }),
  ] },
  { id: 'drift', name: 'Drift', params: [
    P('rate', 'Rate', 0.02, 4, 0.15, { unit: 'Hz', curve: 'log' }), P('pan', 'Pan drift', 0, 1, 0.5), P('tremolo', 'Tremolo', 0, 1, 0),
  ] },
];
export const effectDef = id => EFFECTS.find(e => e.id === id) || null;
export function effectDefaults(id) { const d = effectDef(id); const o = {}; if (d) for (const p of d.params) o[p.id] = p.default; return o; }

const mixDry = m => Math.cos(clamp(m, 0, 1) * Math.PI / 2);
const mixWet = m => Math.sin(clamp(m, 0, 1) * Math.PI / 2);
const optIndex = (v, n) => clamp(Math.round(+v || 0), 0, n - 1);

/** Delay-line pitch shifter (two crossfaded taps whose delay ramps down; Doppler gives the pitch up). */
function makeShifter(ctx, ratio, W = 0.1) {
  const sr = ctx.sampleRate, N = Math.round(W * sr), base = 0.006, span = (ratio - 1) * W;
  const mk = (fn) => { const b = ctx.createBuffer(1, N, sr), d = b.getChannelData(0); for (let i = 0; i < N; i++) d[i] = fn(i); return b; };
  const half = N >> 1;
  const ramp = i => base + span * (1 - i / N), win = i => Math.pow(Math.sin(Math.PI * i / N), 2);
  const bufs = [mk(ramp), mk(i => ramp((i + half) % N)), mk(win), mk(i => win((i + half) % N))];
  const input = ctx.createGain(), output = ctx.createGain();
  const d1 = ctx.createDelay(1), d2 = ctx.createDelay(1), g1 = ctx.createGain(), g2 = ctx.createGain();
  d1.delayTime.value = 0; d2.delayTime.value = 0; g1.gain.value = 0; g2.gain.value = 0;
  input.connect(d1); input.connect(d2); d1.connect(g1); d2.connect(g2); g1.connect(output); g2.connect(output);
  const targets = [d1.delayTime, d2.delayTime, g1.gain, g2.gain];
  const t0 = ctx.currentTime + 0.01;
  const srcs = bufs.map((b, k) => { const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; s.connect(targets[k]); s.start(t0); return s; });
  return { input, output, dispose() { srcs.forEach(s => safeStop(s)); safeDisconnect(...srcs, input, output, d1, d2, g1, g2); } };
}

function lfo(ctx, rate, type = 'sine') { const o = ctx.createOscillator(); o.type = type; o.frequency.value = rate; o.start(); return o; }

const builders = {
  reverb(ctx, p) {
    const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
    const hp = ctx.createBiquadFilter(), sum = ctx.createGain(), pre = ctx.createDelay(1), conv = ctx.createConvolver(), lp = ctx.createBiquadFilter();
    const shHP = ctx.createBiquadFilter(), shLP = ctx.createBiquadFilter(), fb = ctx.createGain();
    hp.type = 'highpass'; hp.Q.value = 0.5; lp.type = 'lowpass'; lp.Q.value = 0.4;
    shHP.type = 'highpass'; shHP.frequency.value = 520; shLP.type = 'lowpass'; shLP.frequency.value = 5200; shLP.Q.value = 0.3;
    fb.gain.value = 0;
    input.connect(dry); dry.connect(output);
    input.connect(hp); hp.connect(sum); sum.connect(pre); pre.connect(conv); conv.connect(lp); lp.connect(wet); wet.connect(output);
    shHP.connect(shLP); shLP.connect(fb); fb.connect(sum);
    let shifter = null, shRatio = 0, irKey = '';
    const ensureShifter = () => {
      const ratio = INTERVALS[optIndex(p.interval, INTERVALS.length)].ratio;
      if (shifter && shRatio === ratio) return;
      if (shifter) shifter.dispose();
      shifter = makeShifter(ctx, ratio); shRatio = ratio;
      conv.connect(shifter.input); shifter.output.connect(shHP);
    };
    const apply = (id, live) => {
      const g = live ? (prm, v) => glide(ctx, prm, v, 0.08) : setNow;
      if (id === 'type' || id === 'size' || !id) {
        const key = optIndex(p.type, SPACES.length) + '|' + p.size;
        if (key !== irKey) { irKey = key; conv.buffer = spaceImpulse(ctx, optIndex(p.type, SPACES.length), p.size); }
      }
      if (id === 'mix' || !id) { g(dry.gain, mixDry(p.mix)); g(wet.gain, mixWet(p.mix)); }
      if (id === 'predelay' || !id) g(pre.delayTime, clamp(+p.predelay || 0, 0, 0.9));
      if (id === 'tone' || !id) g(lp.frequency, expMap(p.tone, 2200, 16000));
      if (id === 'lowcut' || !id) g(hp.frequency, clamp(+p.lowcut || 180, 20, 2000));
      if (id === 'shimmer' || id === 'interval' || !id) {
        const s = clamp(+p.shimmer || 0, 0, 1);
        if (s > 0.001) ensureShifter();
        g(fb.gain, s * 0.52);
      }
    };
    apply(null, false);
    return { input, output, set(id, v) { p[id] = v; apply(id, true); }, setScale(k) { glide(ctx, fb.gain, clamp(+p.shimmer || 0, 0, 1) * 0.52 * k, 0.2); },
      dispose() { if (shifter) shifter.dispose(); safeDisconnect(input, output, dry, wet, hp, sum, pre, conv, lp, shHP, shLP, fb); } };
  },

  echo(ctx, p, env) {
    const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
    const d1 = ctx.createDelay(5), d2 = ctx.createDelay(5), sat = ctx.createWaveShaper(), lp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter();
    const fb = ctx.createGain(), panL = ctx.createStereoPanner(), panR = ctx.createStereoPanner(), wow = lfo(ctx, 0.45), wowG = ctx.createGain();
    const flutter = lfo(ctx, 5.3), flutG = ctx.createGain();
    sat.curve = driveCurve(0.22); lp.type = 'lowpass'; hp.type = 'highpass'; hp.frequency.value = 160; lp.Q.value = 0.5;
    input.connect(dry); dry.connect(output);
    input.connect(d1); d1.connect(sat); sat.connect(panL); panL.connect(wet);
    sat.connect(d2); d2.connect(panR); panR.connect(wet); wet.connect(output);
    d2.connect(lp); lp.connect(hp); hp.connect(fb); fb.connect(d1);
    wow.connect(wowG); wowG.connect(d1.delayTime); wowG.connect(d2.delayTime);
    flutter.connect(flutG); flutG.connect(d1.delayTime); flutG.connect(d2.delayTime);
    const apply = (id, live) => {
      const g = live ? (prm, v) => glide(ctx, prm, v, 0.12) : setNow;
      if (id === 'time' || id === 'bpm' || !id) { const s = clamp((+p.time || 0.75) * 60 / (env.bpm() || 70), 0.03, 4.5); g(d1.delayTime, s); g(d2.delayTime, s); }
      if (id === 'feedback' || !id) g(fb.gain, clamp(+p.feedback || 0, 0, 0.9));
      if (id === 'tone' || !id) g(lp.frequency, expMap(p.tone, 1200, 9000));
      if (id === 'wow' || !id) { g(wowG.gain, (+p.wow || 0) * 0.0035); g(flutG.gain, (+p.wow || 0) * 0.00025); }
      if (id === 'spread' || !id) { g(panL.pan, -clamp(+p.spread || 0, 0, 1) * 0.8); g(panR.pan, clamp(+p.spread || 0, 0, 1) * 0.8); }
      if (id === 'mix' || !id) { g(dry.gain, mixDry(p.mix)); g(wet.gain, mixWet(p.mix)); }
    };
    apply(null, false);
    return { input, output, set(id, v) { if (id !== 'bpm') p[id] = v; apply(id, true); },
      dispose() { safeStop(wow); safeStop(flutter); safeDisconnect(input, output, dry, wet, d1, d2, sat, lp, hp, fb, panL, panR, wow, wowG, flutter, flutG); } };
  },

  filter(ctx, p) {
    const f = ctx.createBiquadFilter(), sw = lfo(ctx, 0.08), swG = ctx.createGain();
    sw.connect(swG); swG.connect(f.detune);
    const modes = ['lowpass', 'highpass', 'bandpass'];
    const apply = (id, live) => {
      const g = live ? (prm, v) => glide(ctx, prm, v, 0.06) : setNow;
      if (id === 'mode' || !id) f.type = modes[optIndex(p.mode, 3)];
      if (id === 'cutoff' || !id) g(f.frequency, clamp(+p.cutoff || 6000, 20, 20000));
      if (id === 'resonance' || !id) g(f.Q, 0.5 + 11.5 * Math.pow(clamp(+p.resonance || 0, 0, 1), 2));
      if (id === 'sweep' || !id) g(swG.gain, clamp(+p.sweep || 0, 0, 1) * 2400);
      if (id === 'rate' || !id) g(sw.frequency, clamp(+p.rate || 0.08, 0.005, 10));
    };
    apply(null, false);
    return { input: f, output: f, set(id, v) { p[id] = v; apply(id, true); }, dispose() { safeStop(sw); safeDisconnect(f, sw, swG); } };
  },

  chorus(ctx, p) {
    const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
    const dA = ctx.createDelay(0.1), dB = ctx.createDelay(0.1), o = lfo(ctx, 0.3), gA = ctx.createGain(), gB = ctx.createGain();
    const pL = ctx.createStereoPanner(), pR = ctx.createStereoPanner();
    dA.delayTime.value = 0.013; dB.delayTime.value = 0.019; pL.pan.value = -0.75; pR.pan.value = 0.75;
    input.connect(dry); dry.connect(output); input.connect(dA); input.connect(dB);
    dA.connect(pL); dB.connect(pR); pL.connect(wet); pR.connect(wet); wet.connect(output);
    o.connect(gA); o.connect(gB); gA.connect(dA.delayTime); gB.connect(dB.delayTime);
    const apply = (id, live) => {
      const g = live ? (prm, v) => glide(ctx, prm, v, 0.08) : setNow;
      if (id === 'rate' || !id) g(o.frequency, clamp(+p.rate || 0.3, 0.01, 10));
      if (id === 'depth' || !id) { const d = clamp(+p.depth || 0, 0, 1) * 0.005; g(gA.gain, d); g(gB.gain, -d); }
      if (id === 'mix' || !id) { g(dry.gain, mixDry(p.mix * 0.8)); g(wet.gain, mixWet(p.mix * 0.8)); }
    };
    apply(null, false);
    return { input, output, set(id, v) { p[id] = v; apply(id, true); }, dispose() { safeStop(o); safeDisconnect(input, output, dry, wet, dA, dB, o, gA, gB, pL, pR); } };
  },

  glow(ctx, p) {
    const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
    const pre = ctx.createGain(), sh = ctx.createWaveShaper(), lp = ctx.createBiquadFilter();
    sh.oversample = '2x'; lp.type = 'lowpass';
    input.connect(dry); dry.connect(output); input.connect(pre); pre.connect(sh); sh.connect(lp); lp.connect(wet); wet.connect(output);
    let curveFor = -1;
    const apply = (id, live) => {
      const g = live ? (prm, v) => glide(ctx, prm, v, 0.06) : setNow;
      const d = clamp(+p.drive || 0, 0, 1);
      if (id === 'drive' || !id) { const q = Math.round(d * 20) / 20; if (q !== curveFor) { sh.curve = driveCurve(q); curveFor = q; } g(pre.gain, 1 + d); }
      if (id === 'tone' || !id) g(lp.frequency, expMap(p.tone, 1500, 14000));
      if (id === 'mix' || id === 'drive' || !id) { g(dry.gain, mixDry(p.mix)); g(wet.gain, mixWet(p.mix) / (1 + d * 0.8)); }
    };
    apply(null, false);
    return { input, output, set(id, v) { p[id] = v; apply(id, true); }, dispose() { safeDisconnect(input, output, dry, wet, pre, sh, lp); } };
  },

  eq(ctx, p) {
    const hp = ctx.createBiquadFilter(), lo = ctx.createBiquadFilter(), mid = ctx.createBiquadFilter(), hi = ctx.createBiquadFilter(), air = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.Q.value = 0.6; lo.type = 'lowshelf'; lo.frequency.value = 180;
    mid.type = 'peaking'; mid.frequency.value = 350; mid.Q.value = 0.9; hi.type = 'peaking'; hi.frequency.value = 3500; hi.Q.value = 0.8;
    air.type = 'highshelf'; air.frequency.value = 10000;
    hp.connect(lo); lo.connect(mid); mid.connect(hi); hi.connect(air);
    const apply = (id, live) => {
      const g = live ? (prm, v) => glide(ctx, prm, v, 0.05) : setNow;
      if (id === 'lowcut' || !id) g(hp.frequency, clamp(+p.lowcut || 20, 10, 2000));
      if (id === 'low' || !id) g(lo.gain, clamp(+p.low || 0, -24, 24));
      if (id === 'mid' || !id) g(mid.gain, clamp(+p.mid || 0, -24, 24));
      if (id === 'high' || !id) g(hi.gain, clamp(+p.high || 0, -24, 24));
      if (id === 'air' || !id) g(air.gain, clamp(+p.air || 0, -24, 24));
    };
    apply(null, false);
    return { input: hp, output: air, set(id, v) { p[id] = v; apply(id, true); }, dispose() { safeDisconnect(hp, lo, mid, hi, air); } };
  },

  drift(ctx, p) {
    const input = ctx.createGain(), trem = ctx.createGain(), pan = ctx.createStereoPanner();
    const o = lfo(ctx, 0.15), oG = ctx.createGain(), o2 = lfo(ctx, 0.35), o2G = ctx.createGain();
    input.connect(trem); trem.connect(pan); o.connect(oG); oG.connect(pan.pan); o2.connect(o2G); o2G.connect(trem.gain);
    const apply = (id, live) => {
      const g = live ? (prm, v) => glide(ctx, prm, v, 0.1) : setNow;
      const r = clamp(+p.rate || 0.15, 0.005, 20);
      if (id === 'rate' || !id) { g(o.frequency, r); g(o2.frequency, r * 2.3); }
      if (id === 'pan' || !id) g(oG.gain, clamp(+p.pan || 0, 0, 1) * 0.9);
      if (id === 'tremolo' || !id) { const t = clamp(+p.tremolo || 0, 0, 1) * 0.45; g(o2G.gain, t); g(trem.gain, 1 - t); }
    };
    apply(null, false);
    return { input, output: pan, set(id, v) { p[id] = v; apply(id, true); }, dispose() { safeStop(o); safeStop(o2); safeDisconnect(input, trem, pan, o, oG, o2, o2G); } };
  },
};

/** Build one effect. `params` is merged over the defaults (and mutated by set()). env: {bpm: () => number}. */
export function createEffect(ctx, id, params = {}, env = { bpm: () => 70 }) {
  const b = builders[id];
  if (!b) return null;
  const p = { ...effectDefaults(id), ...params };
  const fx = b(ctx, p, env);
  fx.id = id; fx.params = p;
  return fx;
}
