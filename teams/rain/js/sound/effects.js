// Effects for the rain engine. Every effect is a little graph with `input` and `output` GainNodes,
// `set(paramId, value)` for live changes and `dispose()`. Reverb is the heart: five room characters
// (convolution), Shimmer (octave-up feedback hall) and Infinite (a lossless feedback loop that can freeze).
import { clamp, expMap, dbToGain, defaultsOf, coerce, rng } from './util.js';
import { REVERB_TYPES, reverbIR, loopHallIR, flatLoopIR } from './reverb.js';

const SYNC = [
  { id: 'free', name: 'Free (ms)', beats: 0 },
  { id: '1/8', name: '1/8', beats: 0.5 },
  { id: '1/8d', name: '1/8 dotted', beats: 0.75 },
  { id: '1/4', name: '1/4', beats: 1 },
  { id: '1/4d', name: '1/4 dotted', beats: 1.5 },
  { id: '1/2', name: '1/2', beats: 2 },
  { id: '1/2d', name: '1/2 dotted', beats: 3 },
  { id: '1bar', name: '1 bar', beats: 4 },
];

export const EFFECTS = [
  { id: 'reverb', name: 'Night Reverb', params: [
    { id: 'type', name: 'Character', default: 'darkhall', options: REVERB_TYPES.map(t => ({ id: t.id, name: t.name })) },
    { id: 'size', name: 'Size', min: 0, max: 1, default: 0.5 },
    { id: 'tone', name: 'Tone', min: 0, max: 1, default: 0.45 },
    { id: 'width', name: 'Width', min: 0, max: 1, default: 1 },
    { id: 'predelay', name: 'Pre-delay', min: 0, max: 0.25, default: 0.02, unit: 's' },
    { id: 'lowcut', name: 'Low cut', min: 20, max: 800, default: 150, unit: 'Hz' },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.3 },
  ] },
  { id: 'shimmer', name: 'Shimmer', params: [
    { id: 'decay', name: 'Decay', min: 0, max: 1, default: 0.6 },
    { id: 'shimmer', name: 'Octave', min: 0, max: 1, default: 0.6 },
    { id: 'size', name: 'Size', min: 1, max: 6, default: 3.5, unit: 's' },
    { id: 'tone', name: 'Tone', min: 1500, max: 12000, default: 6000, unit: 'Hz' },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.3 },
  ] },
  { id: 'freeze', name: 'Infinite', params: [
    { id: 'decay', name: 'Decay', min: 4, max: 90, default: 20, unit: 's' },
    { id: 'freeze', name: 'Freeze', min: 0, max: 1, default: 0, step: 1, toggle: true },
    { id: 'tone', name: 'Tone', min: 1000, max: 12000, default: 4500, unit: 'Hz' },
    { id: 'lowcut', name: 'Low cut', min: 20, max: 600, default: 120, unit: 'Hz' },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.3 },
  ] },
  { id: 'echo', name: 'Tape Echo', params: [
    { id: 'sync', name: 'Sync', default: '1/4d', options: SYNC.map(s => ({ id: s.id, name: s.name })) },
    { id: 'time', name: 'Time', min: 0.04, max: 2, default: 0.5, unit: 's' },
    { id: 'feedback', name: 'Feedback', min: 0, max: 0.92, default: 0.45 },
    { id: 'tone', name: 'Tone', min: 600, max: 9000, default: 2600, unit: 'Hz' },
    { id: 'wow', name: 'Wow', min: 0, max: 1, default: 0.35 },
    { id: 'drive', name: 'Drive', min: 0, max: 1, default: 0.3 },
    { id: 'spread', name: 'Ping-pong', min: 0, max: 1, default: 0.7 },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.25 },
  ] },
  { id: 'filter', name: 'Breathing Filter', params: [
    { id: 'type', name: 'Type', default: 'lowpass', options: [{ id: 'lowpass', name: 'Low-pass' }, { id: 'highpass', name: 'High-pass' }, { id: 'bandpass', name: 'Band-pass' }] },
    { id: 'cutoff', name: 'Cutoff', min: 60, max: 18000, default: 2400, unit: 'Hz' },
    { id: 'resonance', name: 'Resonance', min: 0, max: 1, default: 0.2 },
    { id: 'depth', name: 'Breath', min: 0, max: 1, default: 0.4 },
    { id: 'rate', name: 'Breath rate', min: 0.01, max: 1, default: 0.06, unit: 'Hz' },
  ] },
  { id: 'chorus', name: 'Night Chorus', params: [
    { id: 'rate', name: 'Rate', min: 0.05, max: 3, default: 0.3, unit: 'Hz' },
    { id: 'depth', name: 'Depth', min: 0, max: 1, default: 0.5 },
    { id: 'width', name: 'Width', min: 0, max: 1, default: 0.8 },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.4 },
  ] },
  { id: 'saturation', name: 'Warmth', params: [
    { id: 'drive', name: 'Drive', min: 0, max: 1, default: 0.3 },
    { id: 'tone', name: 'Tone', min: 1000, max: 16000, default: 7000, unit: 'Hz' },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 1 },
  ] },
  { id: 'eq', name: 'Shape EQ', params: [
    { id: 'lowcut', name: 'Low cut', min: 20, max: 1000, default: 30, unit: 'Hz' },
    { id: 'low', name: 'Low', min: -12, max: 12, default: 0, unit: 'dB' },
    { id: 'midfreq', name: 'Mid freq', min: 150, max: 6000, default: 900, unit: 'Hz' },
    { id: 'mid', name: 'Mid', min: -12, max: 12, default: 0, unit: 'dB' },
    { id: 'high', name: 'High', min: -12, max: 12, default: 0, unit: 'dB' },
    { id: 'highcut', name: 'High cut', min: 800, max: 20000, default: 20000, unit: 'Hz' },
  ] },
];

export const effectDef = id => EFFECTS.find(e => e.id === id) || null;

// Mix law: equal-power wet/dry.
const dryOf = m => Math.cos(clamp(m, 0, 1) * Math.PI / 2);
const wetOf = m => Math.sin(clamp(m, 0, 1) * Math.PI / 2);

function smooth(ctx, param, v, tc = 0.03) {
  if (!Number.isFinite(v)) return;
  const t = ctx.currentTime;
  if (ctx._rainOffline) { param.value = v; return; }
  try { param.cancelScheduledValues(t); param.setTargetAtTime(v, t, tc); } catch (e) { param.value = v; }
}

// ---------- building blocks ----------------------------------------------------------------
const waveCache = new WeakMap();
function wave(ctx, key, real, imag) {
  let m = waveCache.get(ctx); if (!m) { m = new Map(); waveCache.set(ctx, m); }
  let w = m.get(key);
  if (!w) { w = ctx.createPeriodicWave(real, imag, { disableNormalization: true }); m.set(key, w); }
  return w;
}

// Delay-line pitch shifter (two crossfaded taps riding sawtooth delay ramps). ratio 2 = one octave up.
export function pitchShifter(ctx, ratio = 2, W = 0.1) {
  const input = ctx.createGain(), output = ctx.createGain();
  const f = Math.abs(ratio - 1) / W;
  const H = 24, re = new Float32Array(H + 1), im1 = new Float32Array(H + 1), im2 = new Float32Array(H + 1), cosRe = new Float32Array(H + 1), cosIm = new Float32Array(H + 1);
  const dir = ratio >= 1 ? 1 : -1;
  for (let k = 1; k <= H; k++) { const s = dir / (Math.PI * k); im1[k] = s; im2[k] = s * (k % 2 ? -1 : 1); }
  cosRe[1] = 1;
  const nodes = [];
  const t0 = ctx.currentTime + 0.01;
  const winOsc = ctx.createOscillator(); winOsc.setPeriodicWave(wave(ctx, 'cos', cosRe, cosIm)); winOsc.frequency.value = f;
  [[im1, -0.5], [im2, 0.5]].forEach(([im, wsign], i) => {
    const d = ctx.createDelay(1); d.delayTime.value = W / 2 + 0.012;
    const o = ctx.createOscillator(); o.setPeriodicWave(wave(ctx, 'saw' + i + dir, re, im)); o.frequency.value = f;
    const og = ctx.createGain(); og.gain.value = W; o.connect(og).connect(d.delayTime);
    const g = ctx.createGain(); g.gain.value = 0.5;
    const wg = ctx.createGain(); wg.gain.value = wsign; winOsc.connect(wg).connect(g.gain);
    input.connect(d).connect(g).connect(output);
    o.start(t0); nodes.push(o, og, d, g, wg);
  });
  winOsc.start(t0); nodes.push(winOsc);
  return { input, output, dispose() { for (const n of nodes) { try { n.stop && n.stop(); } catch (e) { /* */ } try { n.disconnect(); } catch (e) { /* */ } } } };
}

function tanhSoftCurve(drive, n = 2048) {
  // small-signal gain 1, gently compresses loud parts (gain never above 1 => safe inside feedback loops)
  const c = new Float32Array(n), d = Math.max(0.01, drive);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * d) / d; }
  return c;
}

// ---------- effect factories ---------------------------------------------------------------
const F = {};

F.reverb = (ctx, p) => {
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  const pre = ctx.createDelay(1), lc = ctx.createBiquadFilter(), up = ctx.createGain();
  lc.type = 'highpass'; lc.Q.value = 0.6;
  up.channelCount = 2; up.channelCountMode = 'explicit'; up.channelInterpretation = 'speakers';
  input.connect(dry).connect(output);
  input.connect(pre).connect(lc).connect(up);
  wet.connect(output);
  let conv = null, convGain = null, irKey = '';
  function setIR() {
    const key = [p.type, p.size, p.tone, p.width].join('|');
    if (key === irKey) return;
    irKey = key;
    const c = ctx.createConvolver(); c.normalize = false; c.buffer = reverbIR(ctx, p.type, p.size, p.tone, p.width);
    const g = ctx.createGain();
    up.connect(c); c.connect(g).connect(wet);
    if (conv && !ctx._rainOffline) {
      const oc = conv, og = convGain, t = ctx.currentTime;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.25);
      og.gain.setValueAtTime(og.gain.value, t); og.gain.linearRampToValueAtTime(0, t + 0.25);
      setTimeout(() => { try { up.disconnect(oc); oc.disconnect(); og.disconnect(); } catch (e) { /* */ } }, 600);
    } else if (conv) { try { up.disconnect(conv); conv.disconnect(); convGain.disconnect(); } catch (e) { /* */ } }
    conv = c; convGain = g;
  }
  function apply() {
    smooth(ctx, dry.gain, dryOf(p.mix)); smooth(ctx, wet.gain, wetOf(p.mix));
    smooth(ctx, pre.delayTime, p.predelay); smooth(ctx, lc.frequency, p.lowcut);
    setIR();
  }
  apply();
  return { input, output, set(id, v) { p[id] = v; apply(); }, tail: () => 12, dispose() { [input, output, dry, wet, pre, lc, up, conv, convGain].forEach(n => n && n.disconnect()); } };
};

F.shimmer = (ctx, p) => {
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  const hallIn = ctx.createGain(), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), fb = ctx.createGain(), hallOut = ctx.createGain();
  hallIn.channelCount = 2; hallIn.channelCountMode = 'explicit';
  hp.type = 'highpass'; hp.frequency.value = 350; hp.Q.value = 0.5; lp.type = 'lowpass'; lp.Q.value = 0.5;
  const shift = pitchShifter(ctx, 2, 0.1);
  input.connect(dry).connect(output);
  input.connect(hallIn);
  let conv = null, size = -1;
  function setIR() {
    const s = Math.round(clamp(p.size, 1, 6) * 2) / 2; if (s === size) return; size = s;
    const c = ctx.createConvolver(); c.normalize = false; c.buffer = loopHallIR(ctx, s);
    if (conv) { try { hallIn.disconnect(conv); conv.disconnect(); } catch (e) { /* */ } }
    hallIn.connect(c); c.connect(hallOut); conv = c;
  }
  hallOut.gain.value = 0.55;
  hallOut.connect(wet).connect(output);
  hallOut.connect(shift.input); shift.output.connect(hp).connect(lp).connect(fb).connect(hallIn);
  function apply() {
    setIR();
    smooth(ctx, dry.gain, dryOf(p.mix)); smooth(ctx, wet.gain, wetOf(p.mix) * 1.1);
    smooth(ctx, lp.frequency, p.tone);
    smooth(ctx, fb.gain, 0.62 * clamp(p.shimmer, 0, 1) * (0.45 + 0.55 * clamp(p.decay, 0, 1)));
  }
  apply();
  return { input, output, set(id, v) { p[id] = v; apply(); }, tail: () => 14, dispose() { shift.dispose(); [input, output, dry, wet, hallIn, hp, lp, fb, hallOut, conv].forEach(n => n && n.disconnect()); } };
};

F.freeze = (ctx, p) => {
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  const inGain = ctx.createGain(), lcIn = ctx.createBiquadFilter(), loopIn = ctx.createGain(), dly = ctx.createDelay(0.2);
  const damp = ctx.createBiquadFilter(), hpl = ctx.createBiquadFilter(), fb = ctx.createGain(), outG = ctx.createGain();
  loopIn.channelCount = 2; loopIn.channelCountMode = 'explicit'; loopIn.channelInterpretation = 'speakers';
  lcIn.type = 'highpass'; lcIn.Q.value = 0.6; damp.type = 'lowpass'; damp.Q.value = 0.6; hpl.type = 'highpass'; hpl.frequency.value = 45; hpl.Q.value = 0.6;
  dly.delayTime.value = 0.03;
  const { buffer, seconds } = flatLoopIR(ctx);
  const conv = ctx.createConvolver(); conv.normalize = false; conv.buffer = buffer;
  input.connect(dry).connect(output);
  input.connect(inGain).connect(lcIn).connect(loopIn).connect(conv);
  conv.connect(dly).connect(damp).connect(hpl).connect(fb).connect(loopIn);
  conv.connect(outG).connect(wet).connect(output);
  outG.gain.value = 0.7;
  const pass = seconds * 0.5 + 0.03;
  function apply() {
    const frozen = p.freeze >= 0.5;
    const g = frozen ? 0.9993 : Math.pow(10, (-3 * pass) / clamp(p.decay, 1, 120));
    smooth(ctx, fb.gain, g, 0.08);
    smooth(ctx, inGain.gain, frozen ? 0 : 1, 0.08);
    smooth(ctx, damp.frequency, p.tone); smooth(ctx, lcIn.frequency, p.lowcut);
    smooth(ctx, dry.gain, dryOf(p.mix)); smooth(ctx, wet.gain, wetOf(p.mix));
  }
  apply();
  return { input, output, set(id, v) { p[id] = v; apply(); }, tail: () => Math.min(30, p.decay), dispose() { [input, output, dry, wet, inGain, lcIn, loopIn, dly, damp, hpl, fb, outG, conv].forEach(n => n.disconnect()); } };
};

F.echo = (ctx, p, env) => {
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  const mono = ctx.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
  const dA = ctx.createDelay(4.5), dB = ctx.createDelay(4.5);
  const toneA = ctx.createBiquadFilter(), toneB = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter();
  const satA = ctx.createWaveShaper(), fbAB = ctx.createGain(), fbBA = ctx.createGain();
  const panA = ctx.createStereoPanner(), panB = ctx.createStereoPanner();
  const wow = ctx.createOscillator(), wowG = ctx.createGain(), flut = ctx.createOscillator(), flutG = ctx.createGain();
  toneA.type = toneB.type = 'lowpass'; toneA.Q.value = toneB.Q.value = 0.5; hp.type = 'highpass'; hp.frequency.value = 160; hp.Q.value = 0.5;
  satA.oversample = '2x';
  input.connect(dry).connect(output);
  input.connect(mono).connect(hp).connect(dA);
  dA.connect(satA).connect(toneA);
  toneA.connect(panA).connect(wet);
  toneA.connect(fbAB).connect(dB).connect(toneB);
  toneB.connect(panB).connect(wet);
  toneB.connect(fbBA).connect(dA);
  wet.connect(output);
  wow.frequency.value = 0.45; flut.frequency.value = 5.3;
  wow.connect(wowG); flut.connect(flutG); wowG.connect(dA.delayTime); wowG.connect(dB.delayTime); flutG.connect(dA.delayTime); flutG.connect(dB.delayTime);
  const t0 = ctx.currentTime; wow.start(t0); flut.start(t0);
  function time() {
    const s = SYNC.find(x => x.id === p.sync);
    if (!s || !s.beats) return clamp(p.time, 0.04, 2);
    return clamp((60 / (env.bpm || 70)) * s.beats, 0.04, 4);
  }
  let drive = -1;
  function apply() {
    const T = time();
    smooth(ctx, dA.delayTime, T, 0.15); smooth(ctx, dB.delayTime, T, 0.15);
    smooth(ctx, toneA.frequency, p.tone); smooth(ctx, toneB.frequency, p.tone * 0.85);
    const fbv = clamp(p.feedback, 0, 0.92);
    smooth(ctx, fbAB.gain, fbv); smooth(ctx, fbBA.gain, fbv);
    smooth(ctx, wowG.gain, 0.0035 * p.wow); smooth(ctx, flutG.gain, 0.0004 * p.wow);
    const sp = clamp(p.spread, 0, 1) * 0.85;
    smooth(ctx, panA.pan, -sp); smooth(ctx, panB.pan, sp);
    smooth(ctx, dry.gain, dryOf(p.mix)); smooth(ctx, wet.gain, wetOf(p.mix));
    const d = 1 + 3 * clamp(p.drive, 0, 1);
    if (d !== drive) { drive = d; satA.curve = tanhSoftCurve(d); }
  }
  apply();
  return { input, output, set(id, v) { p[id] = v; apply(); }, setBpm() { apply(); }, tail: () => Math.min(20, time() * 8),
    dispose() { try { wow.stop(); flut.stop(); } catch (e) { /* */ } [input, output, dry, wet, mono, dA, dB, toneA, toneB, hp, satA, fbAB, fbBA, panA, panB, wow, wowG, flut, flutG].forEach(n => n.disconnect()); } };
};

F.filter = (ctx, p) => {
  const input = ctx.createGain(), output = ctx.createGain();
  const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lg = ctx.createGain();
  input.connect(f1).connect(f2).connect(output);
  lfo.connect(lg); lg.connect(f1.detune); lg.connect(f2.detune);
  lfo.start(ctx.currentTime);
  function apply() {
    f1.type = f2.type = p.type;
    const q = p.type === 'bandpass' ? 0.7 + p.resonance * 4 : 0.6 + p.resonance * 6;
    smooth(ctx, f1.frequency, p.cutoff); smooth(ctx, f2.frequency, p.cutoff);
    smooth(ctx, f1.Q, q); f2.Q.value = p.type === 'bandpass' ? 0.5 : 0.6;
    smooth(ctx, lfo.frequency, p.rate); smooth(ctx, lg.gain, p.depth * 1500);
  }
  apply();
  return { input, output, set(id, v) { p[id] = v; apply(); }, tail: () => 0, dispose() { try { lfo.stop(); } catch (e) { /* */ } [input, output, f1, f2, lfo, lg].forEach(n => n.disconnect()); } };
};

F.chorus = (ctx, p) => {
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  const dl = ctx.createDelay(0.1), dr = ctx.createDelay(0.1), pl = ctx.createStereoPanner(), pr = ctx.createStereoPanner();
  const l1 = ctx.createOscillator(), l2 = ctx.createOscillator(), g1 = ctx.createGain(), g2 = ctx.createGain();
  dl.delayTime.value = 0.013; dr.delayTime.value = 0.019;
  input.connect(dry).connect(output);
  input.connect(dl).connect(pl).connect(wet); input.connect(dr).connect(pr).connect(wet); wet.connect(output);
  l1.connect(g1).connect(dl.delayTime); l2.connect(g2).connect(dr.delayTime);
  const t = ctx.currentTime; l1.start(t); l2.start(t + 0.37);
  function apply() {
    smooth(ctx, l1.frequency, p.rate); smooth(ctx, l2.frequency, p.rate * 1.17);
    smooth(ctx, g1.gain, 0.0045 * p.depth); smooth(ctx, g2.gain, 0.0045 * p.depth);
    smooth(ctx, pl.pan, -p.width); smooth(ctx, pr.pan, p.width);
    smooth(ctx, dry.gain, dryOf(p.mix * 0.8)); smooth(ctx, wet.gain, wetOf(p.mix) * 0.8);
  }
  apply();
  return { input, output, set(id, v) { p[id] = v; apply(); }, tail: () => 0, dispose() { try { l1.stop(); l2.stop(); } catch (e) { /* */ } [input, output, dry, wet, dl, dr, pl, pr, l1, l2, g1, g2].forEach(n => n.disconnect()); } };
};

F.saturation = (ctx, p) => {
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  const pre = ctx.createGain(), sh = ctx.createWaveShaper(), lp = ctx.createBiquadFilter(), post = ctx.createGain();
  sh.oversample = '2x'; lp.type = 'lowpass'; lp.Q.value = 0.5;
  input.connect(dry).connect(output);
  input.connect(pre).connect(sh).connect(lp).connect(post).connect(wet).connect(output);
  let last = -1;
  function apply() {
    const d = 1 + 5 * clamp(p.drive, 0, 1);
    if (d !== last) { last = d; const n = 2048, c = new Float32Array(n), k = Math.tanh(d); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * d) / k; } sh.curve = c; }
    smooth(ctx, pre.gain, 1); smooth(ctx, post.gain, Math.tanh(d) / d * (1 + 0.25 * p.drive));
    smooth(ctx, lp.frequency, p.tone);
    smooth(ctx, dry.gain, dryOf(p.mix)); smooth(ctx, wet.gain, wetOf(p.mix));
  }
  apply();
  return { input, output, set(id, v) { p[id] = v; apply(); }, tail: () => 0, dispose() { [input, output, dry, wet, pre, sh, lp, post].forEach(n => n.disconnect()); } };
};

F.eq = (ctx, p) => {
  const input = ctx.createGain(), output = ctx.createGain();
  const hp = ctx.createBiquadFilter(), ls = ctx.createBiquadFilter(), pk = ctx.createBiquadFilter(), hs = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.Q.value = 0.7; ls.type = 'lowshelf'; ls.frequency.value = 180; pk.type = 'peaking'; pk.Q.value = 0.8;
  hs.type = 'highshelf'; hs.frequency.value = 5500; lp.type = 'lowpass'; lp.Q.value = 0.7;
  input.connect(hp).connect(ls).connect(pk).connect(hs).connect(lp).connect(output);
  function apply() {
    smooth(ctx, hp.frequency, p.lowcut); smooth(ctx, ls.gain, p.low); smooth(ctx, pk.frequency, p.midfreq); smooth(ctx, pk.gain, p.mid);
    smooth(ctx, hs.gain, p.high); smooth(ctx, lp.frequency, Math.min(p.highcut, ctx.sampleRate * 0.49));
  }
  apply();
  return { input, output, set(id, v) { p[id] = v; apply(); }, tail: () => 0, dispose() { [input, output, hp, ls, pk, hs, lp].forEach(n => n.disconnect()); } };
};

// A slot wraps one effect with a click-free bypass. env: {bpm}
export function createEffect(ctx, spec, env) {
  const def = effectDef(spec.id);
  if (!def) return null;
  const p = defaultsOf(def.params);
  for (const k of Object.keys(spec.params || {})) { const pd = def.params.find(x => x.id === k); if (pd) p[k] = coerce(pd, spec.params[k]); }
  const fx = F[def.id](ctx, p, env);
  const input = ctx.createGain(), output = ctx.createGain(), on = ctx.createGain(), off = ctx.createGain();
  input.connect(fx.input); fx.output.connect(on).connect(output); input.connect(off).connect(output);
  let bypass = !!spec.bypass;
  on.gain.value = bypass ? 0 : 1; off.gain.value = bypass ? 1 : 0;
  return {
    id: def.id, def, params: p, input, output,
    get bypass() { return bypass; },
    setBypass(b) { bypass = !!b; smooth(ctx, on.gain, bypass ? 0 : 1, 0.02); smooth(ctx, off.gain, bypass ? 1 : 0, 0.02); },
    set(id, v) { const pd = def.params.find(x => x.id === id); if (!pd) return false; p[id] = coerce(pd, v); fx.set(id, p[id]); return true; },
    setBpm() { fx.setBpm && fx.setBpm(); },
    tail() { return bypass ? 0 : fx.tail(); },
    dispose() { fx.dispose(); [input, output, on, off].forEach(n => n.disconnect()); },
  };
}
