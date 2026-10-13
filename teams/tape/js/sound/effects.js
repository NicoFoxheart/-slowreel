// effects.js - the tape studio's effect rack. Every effect: create(ctx, params, env) -> {input, output, set(id, v), dispose(), transport?(playing, t)}
// env: { bpm() -> number }. All effects are native Web Audio nodes (no worklets), so they run everywhere and render offline.
import { clamp, dbToGain, satCurve, noiseBuffer, disconnectAll, cached, sp, krateFilter } from './util.js';
import { makeIR, irPlan, hasIR, REVERB_TYPES } from './reverb.js';
import { ensureIR } from './assets.js';

const P = (id, name, min, max, def, unit = '', extra = {}) => ({ id, name, min, max, default: def, unit, ...extra });

export const EFFECTS = [
  { id: 'reverb', name: 'Reverb', params: [
    P('type', 'Type', 0, REVERB_TYPES.length - 1, 'plate', '', { type: 'enum', options: REVERB_TYPES }),
    P('mix', 'Mix', 0, 1, 0.3), P('size', 'Size', 0.4, 2, 1, 'x'), P('tone', 'Tone', 0, 1, 0.5),
    P('preDelay', 'Pre-delay', 0, 0.25, 0.02, 's'), P('shimmer', 'Shimmer', 0, 1, 0) ] },
  { id: 'shimmer', name: 'Shimmer Verb', params: [
    P('type', 'Type', 0, REVERB_TYPES.length - 1, 'hall', '', { type: 'enum', options: REVERB_TYPES }),
    P('mix', 'Mix', 0, 1, 0.35), P('size', 'Size', 0.4, 2, 1.4, 'x'), P('tone', 'Tone', 0, 1, 0.55),
    P('preDelay', 'Pre-delay', 0, 0.25, 0.03, 's'), P('shimmer', 'Shimmer', 0, 1, 0.55) ] },
  { id: 'echo', name: 'Tape Echo', params: [
    P('beats', 'Time', 0.125, 4, 0.75, 'beats'), P('feedback', 'Feedback', 0, 0.92, 0.55), P('tone', 'Tone', 0, 1, 0.4),
    P('wow', 'Wow', 0, 1, 0.35), P('drive', 'Drive', 0, 1, 0.3), P('spread', 'Spread', 0, 1, 0.7), P('mix', 'Mix', 0, 1, 0.3) ] },
  { id: 'tape', name: 'Cassette', params: [
    P('drive', 'Drive', 0, 1, 0.3), P('age', 'Age', 0, 1, 0.3), P('wow', 'Wow', 0, 1, 0.3), P('flutter', 'Flutter', 0, 1, 0.2),
    P('hiss', 'Hiss', 0, 1, 0.15) ] },
  { id: 'chorus', name: 'Tape Chorus', params: [ P('rate', 'Rate', 0.05, 3, 0.4, 'Hz'), P('depth', 'Depth', 0, 1, 0.45), P('mix', 'Mix', 0, 1, 0.45) ] },
  { id: 'filter', name: 'Filter', params: [
    P('mode', 'Mode', 0, 2, 'lowpass', '', { type: 'enum', options: [{ value: 'lowpass', label: 'Low-pass' }, { value: 'highpass', label: 'High-pass' }, { value: 'bandpass', label: 'Band-pass' }] }),
    P('cutoff', 'Cutoff', 40, 18000, 2400, 'Hz', { scale: 'log' }), P('resonance', 'Resonance', 0.1, 12, 0.7),
    P('motion', 'Motion', 0, 1, 0), P('rate', 'Rate', 0.02, 2, 0.12, 'Hz') ] },
  { id: 'eq', name: 'Tone EQ', params: [ P('low', 'Low', -12, 12, 0, 'dB'), P('mid', 'Mid', -12, 12, 0, 'dB'), P('high', 'High', -12, 12, 0, 'dB'), P('lowcut', 'Low cut', 20, 400, 30, 'Hz', { scale: 'log' }) ] },
  { id: 'glue', name: 'Soft Glue', params: [ P('threshold', 'Threshold', -40, 0, -18, 'dB'), P('ratio', 'Ratio', 1, 8, 2), P('makeup', 'Makeup', 0, 12, 0, 'dB') ] },
];
const DEFS = Object.fromEntries(EFFECTS.map(e => [e.id, e]));

export function resolveFx(id, params = {}) {
  const def = DEFS[id]; if (!def) return null;
  const out = {};
  for (const p of def.params) out[p.id] = params[p.id] !== undefined ? params[p.id] : p.default;
  return out;
}

export function createEffect(ctx, id, params, env) {
  const def = DEFS[id];
  if (!def) return null;
  const p = resolveFx(id, params);
  const make = { reverb: makeReverb, shimmer: makeReverb, echo: makeEcho, tape: makeTape, chorus: makeChorus, filter: makeFilter, eq: makeEq, glue: makeGlue }[id];
  const fx = make(ctx, p, env);
  fx.id = id; fx.params = p;
  const set = fx.set;
  fx.set = (k, v) => { if (!(k in p)) return; p[k] = v; set(k, v); };
  return fx;
}

// ---------- helpers ----------
function dryWet(ctx, mix) {
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  input.connect(dry); dry.connect(output); wet.connect(output);
  const setMix = (m, t = ctx.currentTime) => {
    m = clamp(+m, 0, 1);
    // equal-power-ish: dry stays near full until the wet dominates, so inserts never get thin
    sp(dry.gain, Math.cos(m * Math.PI / 2) ** 0.6 * (m >= 0.999 ? 0 : 1), t, 0.03);
    sp(wet.gain, Math.sin(m * Math.PI / 2), t, 0.03);
  };
  dry.gain.value = 1; wet.gain.value = 0; setMix(mix, 0);
  return { input, output, dry, wet, setMix };
}

// Octave-up pitch shifter (two crossfaded delay taps swept by synced saws). Used by the shimmer feedback path.
function octaveUp(ctx) {
  const W = 0.06, fr = 1 / W, t0 = ctx.currentTime;
  const input = ctx.createGain(), output = ctx.createGain();
  const nodes = [];
  const N = 24;
  const sawRe = new Float32Array(N + 1), sawIm = new Float32Array(N + 1), sawIm2 = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) { const a = (2 / (Math.PI * n)) * (n % 2 ? 1 : -1); sawIm[n] = a; sawIm2[n] = a * (n % 2 ? -1 : 1); }
  const cosRe = new Float32Array([0, 1]), cosIm = new Float32Array(2);
  const waves = cached(ctx, 'octup-waves', () => ({
    s1: ctx.createPeriodicWave(sawRe, sawIm, { disableNormalization: true }),
    s2: ctx.createPeriodicWave(sawRe, sawIm2, { disableNormalization: true }),
    c: ctx.createPeriodicWave(cosRe, cosIm, { disableNormalization: true }),
  }));
  const taps = [[waves.s1, 1], [waves.s2, -1]].map(([sw, sign]) => {
    const d = ctx.createDelay(0.2); d.delayTime.value = W / 2;
    const saw = ctx.createOscillator(); saw.setPeriodicWave(sw); saw.frequency.value = fr;
    const sg = ctx.createGain(); sg.gain.value = -W / 2 * 0.98; saw.connect(sg); sg.connect(d.delayTime);
    const win = ctx.createGain(); win.gain.value = 0.5;
    const co = ctx.createOscillator(); co.setPeriodicWave(waves.c); co.frequency.value = fr;
    const cg = ctx.createGain(); cg.gain.value = 0.5 * sign; co.connect(cg); cg.connect(win.gain);
    input.connect(d); d.connect(win); win.connect(output);
    saw.start(t0); co.start(t0);
    nodes.push(d, saw, sg, win, co, cg);
    return { saw, co };
  });
  return { input, output, dispose() { taps.forEach(t => { try { t.saw.stop(); t.co.stop(); } catch (e) {} }); disconnectAll(input, output, ...nodes); } };
}

// ---------- reverb (+ shimmer) ----------
// Impulse responses are made ahead of time (assets.js: a worker, or idle time) and cached. If one is not ready yet the
// reverb keeps its current room (or stays dry at first) and crossfades in when it arrives, so nothing is computed
// on the play path. engine.load() awaits fx.ready, so playback and offline renders start with every room in place.
// env.light: Light mode. The effect has no room of its own; its wet share goes to the engine's one shared short room.
// env.irLight: this is that shared room (impulse capped at 2.5 s, no shimmer).
function makeReverb(ctx, p, env = {}) {
  const io = dryWet(ctx, p.mix);
  if (env.light && env.lightRoomInput) {
    io.wet.disconnect(); io.input.connect(io.wet); io.wet.connect(env.lightRoomInput);
    return {
      input: io.input, output: io.output, ready: Promise.resolve(), lightSend: true,
      set(k, v) { if (k === 'mix') io.setMix(v); },
      dispose() { disconnectAll(io.input, io.output, io.dry, io.wet); },
    };
  }
  const pre = ctx.createDelay(1); pre.delayTime.value = 0;      // pre-delay is baked into the IR; kept for shimmer feed
  const sum = ctx.createGain();                                 // convolver input (dry feed + shimmer feedback)
  const rooms = ctx.createGain();                               // every convolver (the current room, and the old one while it fades)
  const out = ctx.createGain();
  io.input.connect(sum); rooms.connect(out);
  let conv = null, convGain = null, want = '', disposed = false, ready = Promise.resolve();
  const opts = () => ({ size: p.size, tone: p.tone, preDelay: p.preDelay, light: !!env.irLight });
  const attach = (ir, t) => {
    const c = ctx.createConvolver(); c.normalize = false; c.buffer = ir;
    const g = ctx.createGain(); g.gain.value = conv ? 0 : 1;
    sum.connect(c); c.connect(g); g.connect(rooms);
    if (conv) {   // crossfade from the old room to the new one, then drop it
      const oc = conv, og = convGain;
      sp(og.gain, 0, t, 0.08); sp(g.gain, 1, t, 0.08);
      setTimeout(() => disconnectAll(oc, og), 1500);
    }
    conv = c; convGain = g;
  };
  const load = (t = ctx.currentTime) => {
    const o = opts(), type = p.type, plan = irPlan(type, o);
    if (plan.key === want) return ready;
    want = plan.key;
    if (hasIR(ctx.sampleRate, plan)) { attach(makeIR(ctx, type, o), t); return (ready = Promise.resolve()); }
    return (ready = ensureIR(ctx.sampleRate, type, o).then(() => {
      if (disposed || want !== plan.key) return;
      attach(makeIR(ctx, type, o), conv ? ctx.currentTime : 0);
    }, e => console.warn('[tape] reverb impulse', e)));
  };
  load(0);
  out.connect(io.wet);
  // rooms cut at 6 s while still loud (infinite, huge cathedrals): a soft feedback tail carries the decay on from there
  let tail = null, tailKey = '';
  const syncTail = () => {
    const want = irPlan(p.type, opts()).tail, key = want ? want.rt.toFixed(2) + '|' + Math.round(want.fc) : '';
    if (key === tailKey) return;
    tailKey = key;
    if (tail) { const old = tail; tail = null; old.fadeOut(); }
    if (want) { tail = feedbackTail(ctx, want); rooms.connect(tail.input); tail.output.connect(out); }
  };
  syncTail();
  // shimmer: reverb output -> octave up -> high-pass -> back into the reverb
  let sh = null, shGain = null, shHp = null;
  const shimmer = (v, t = ctx.currentTime) => {
    if (env.irLight) return;                     // the light room has no shimmer
    if (v > 0 && !sh) {
      sh = octaveUp(ctx); shHp = krateFilter(ctx.createBiquadFilter()); shHp.type = 'highpass'; shHp.frequency.value = 500; shHp.Q.value = -3.01;
      const lp = krateFilter(ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 7000; lp.Q.value = -3.01; shHp._lp = lp;
      shGain = ctx.createGain(); shGain.gain.value = 0;
      rooms.connect(sh.input); sh.output.connect(shHp);   // from the rooms only: the feedback tail stays outside the shimmer loop
      shHp.connect(lp); lp.connect(shGain); shGain.connect(sum);
    }
    if (shGain) sp(shGain.gain, clamp(v, 0, 1) * 0.5, t, 0.05);
  };
  shimmer(p.shimmer, 0);
  return {
    input: io.input, output: io.output,
    get ready() { return ready; },
    set(k, v) { if (k === 'mix') io.setMix(v); else if (k === 'shimmer') shimmer(+v); else { load(); syncTail(); } },
    dispose() { disposed = true; if (sh) { sh.dispose(); disconnectAll(shGain, shHp, shHp._lp); } if (tail) tail.dispose(); disconnectAll(io.input, io.output, io.dry, io.wet, pre, sum, rooms, out, conv, convGain); },
  };
}

// Feedback tail: four damped delay lines (73-147 ms) mixed by a Householder matrix, fed by the room's output. It carries
// the room's decay (rt, darkness fc) on past the end of the 6 s impulse with native nodes only (no long convolution).
// The matrix is orthogonal, every loop gain is < 1 and the damping filters never boost: it always dies away.
const TAIL_LEVEL = 0.23;
function feedbackTail(ctx, { rt: TAIL_RT = 28, fc = 12000 } = {}) {
  const input = ctx.createGain(), output = ctx.createGain(), mixN = ctx.createGain(), nodes = [];
  input.gain.value = TAIL_LEVEL; mixN.gain.value = -0.5;
  const D = [0.0731, 0.0947, 0.1213, 0.1471];
  const lines = D.map((d, i) => {
    const dl = ctx.createDelay(0.25); dl.delayTime.value = d;
    const lp = krateFilter(ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = fc; lp.Q.value = -3.01;
    const g = ctx.createGain(); g.gain.value = Math.pow(10, -3 * d / TAIL_RT);
    const inj = ctx.createGain(); inj.gain.value = i % 2 ? -1 : 1;
    const tap = ctx.createGain(); tap.gain.value = i < 2 ? 0.5 : -0.5;
    input.connect(inj); inj.connect(dl); dl.connect(lp); lp.connect(g); lp.connect(mixN); mixN.connect(g); g.connect(dl);
    lp.connect(tap); tap.connect(output);
    nodes.push(dl, lp, g, inj, tap);
    return { g };
  });
  const hp = krateFilter(ctx.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 140; hp.Q.value = -3.01;
  output.disconnect(); const out = ctx.createGain(); output.connect(hp); hp.connect(out);
  const dispose = () => disconnectAll(input, output, mixN, hp, out, ...nodes);
  return {
    input, output: out, dispose,
    fadeOut() { const t = ctx.currentTime; sp(input.gain, 0, t, 0.05); lines.forEach(l => sp(l.g.gain, 0, t + 0.1, 0.2)); setTimeout(dispose, 2500); },
  };
}

// ---------- tape echo (ping-pong, saturating feedback, wow) ----------
function makeEcho(ctx, p, env) {
  const io = dryWet(ctx, p.mix);
  const mono = ctx.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit';
  const inL = ctx.createGain(), inR = ctx.createGain();
  const merge = ctx.createChannelMerger(2), delay = ctx.createDelay(6);
  // Web Audio's low/high-pass Q is in dB: -3.01 dB = Butterworth (no resonant peak), so the loop gain never exceeds `feedback`
  const hp = krateFilter(ctx.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 160; hp.Q.value = -3.01;
  const lp = krateFilter(ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.Q.value = -3.01;
  const sat = ctx.createWaveShaper(); sat.oversample = 'none';
  const fb = ctx.createGain(), split = ctx.createChannelSplitter(2), swap = ctx.createChannelMerger(2);
  io.input.connect(mono); mono.connect(inL); mono.connect(inR);
  inL.connect(merge, 0, 0); inR.connect(merge, 0, 1);
  merge.connect(delay); delay.connect(hp); hp.connect(lp); lp.connect(sat);
  sat.connect(io.wet);
  sat.connect(split); split.connect(swap, 0, 1); split.connect(swap, 1, 0); swap.connect(fb); fb.connect(delay);
  const wow = ctx.createOscillator(), flut = ctx.createOscillator(), wg = ctx.createGain(), fg = ctx.createGain();
  wow.frequency.value = 0.55; flut.frequency.value = 6.3; wow.connect(wg); flut.connect(fg); wg.connect(delay.delayTime); fg.connect(delay.delayTime);
  wow.start(); flut.start();
  const apply = (t = ctx.currentTime) => {
    const sec = clamp(p.beats * 60 / env.bpm(), 0.03, 5);
    sp(delay.delayTime, sec, t, 0.12);   // glides like a tape machine when tempo or time changes
    sp(fb.gain, clamp(p.feedback, 0, 0.92) * 0.97, t, 0.03);
    sp(lp.frequency, 900 * Math.pow(9, p.tone), t, 0.03);
    sat.curve = satCurve(ctx, 0.6 + p.drive * 2.4);
    sp(wg.gain, p.wow * 0.0035, t, 0.05); sp(fg.gain, p.wow * 0.00025, t, 0.05);
    sp(inR.gain, 1 - clamp(p.spread, 0, 1), t, 0.03);
  };
  apply(0);
  return {
    input: io.input, output: io.output,
    set(k, v) { if (k === 'mix') io.setMix(v); else apply(); },
    retime() { apply(); },
    dispose() { try { wow.stop(); flut.stop(); } catch (e) {} disconnectAll(io.input, io.output, io.dry, io.wet, mono, inL, inR, merge, delay, hp, lp, sat, fb, split, swap, wow, flut, wg, fg); },
  };
}

// ---------- cassette: saturation, age (band-limit), wow & flutter, hiss ----------
function makeTape(ctx, p, env = {}) {
  const input = ctx.createGain(), output = ctx.createGain();
  const pre = ctx.createGain(), sat = ctx.createWaveShaper(), post = ctx.createGain();
  const hp = krateFilter(ctx.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 45;
  const head = krateFilter(ctx.createBiquadFilter()); head.type = 'peaking'; head.frequency.value = 110; head.Q.value = 1.1; head.gain.value = 1.5; // head bump
  const lp = krateFilter(ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.Q.value = 0.5;
  const d = ctx.createDelay(0.1); d.delayTime.value = 0.012;
  const wow = ctx.createOscillator(), flut = ctx.createOscillator(), wg = ctx.createGain(), fg = ctx.createGain();
  wow.frequency.value = 0.42; flut.frequency.value = 7.1;
  if (!env.light) { wow.connect(wg); flut.connect(fg); wg.connect(d.delayTime); fg.connect(d.delayTime); wow.start(); flut.start(); }   // Light mode: no wow / flutter
  input.connect(pre); pre.connect(sat); sat.connect(post); post.connect(hp); hp.connect(head); head.connect(lp); lp.connect(d); d.connect(output);
  // hiss: only runs while the transport plays (silence stays silent)
  const hissG = ctx.createGain(); hissG.gain.value = 0;
  const hissF = krateFilter(ctx.createBiquadFilter()); hissF.type = 'bandpass'; hissF.frequency.value = 4200; hissF.Q.value = 0.35;
  hissF.connect(hissG); hissG.connect(output);
  let hissSrc = null;
  const hissLevel = () => p.hiss * p.hiss * 0.0045;
  const apply = (t = ctx.currentTime) => {
    const drive = 1 + p.drive * 5;
    sp(pre.gain, drive * 0.5, t, 0.03);
    sat.curve = satCurve(ctx, 1.2 + p.drive * 1.5);
    sp(post.gain, 1 / (0.5 * drive) * (1 + p.drive * 0.25) * 0.9, t, 0.03);   // sat is unity for small signals
    sp(lp.frequency, 16000 * Math.pow(0.22, p.age), t, 0.03);
    sp(wg.gain, p.wow * 0.0028, t, 0.05); sp(fg.gain, p.flutter * 0.00018, t, 0.05);
    if (hissSrc) sp(hissG.gain, hissLevel(), t, 0.1);
  };
  apply(0);
  return {
    input, output,
    set() { apply(); },
    transport(playing, t) {
      if (playing && !hissSrc && p.hiss > 0) {
        hissSrc = ctx.createBufferSource(); hissSrc.buffer = noiseBuffer(ctx, 'pink'); hissSrc.loop = true;
        hissSrc.connect(hissF); hissSrc.start(t); hissG.gain.setValueAtTime(0, t); sp(hissG.gain, hissLevel(), t, 0.3);
      } else if (!playing && hissSrc) {
        const s = hissSrc; hissSrc = null;
        hissG.gain.cancelScheduledValues(t); sp(hissG.gain, 0, t, 0.4); s.stop(t + 3);
      }
    },
    dispose() { for (const n of [wow, flut, hissSrc]) { try { n && n.stop(); } catch (e) { } } disconnectAll(input, output, pre, sat, post, hp, head, lp, d, wow, flut, wg, fg, hissG, hissF, hissSrc); },
  };
}

// ---------- tape chorus (stereo, two swept delays) ----------
function makeChorus(ctx, p) {
  const io = dryWet(ctx, p.mix);
  const mono = ctx.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit';
  const dl = ctx.createDelay(0.1), dr = ctx.createDelay(0.1), m = ctx.createChannelMerger(2);
  dl.delayTime.value = 0.011; dr.delayTime.value = 0.016;
  const lfo = ctx.createOscillator(), gl = ctx.createGain(), gr = ctx.createGain();
  io.input.connect(mono); mono.connect(dl); mono.connect(dr); dl.connect(m, 0, 0); dr.connect(m, 0, 1); m.connect(io.wet);
  lfo.connect(gl); lfo.connect(gr); gl.connect(dl.delayTime); gr.connect(dr.delayTime); lfo.start();
  const apply = (t = ctx.currentTime) => {
    sp(lfo.frequency, p.rate, t, 0.05);
    sp(gl.gain, p.depth * 0.0035, t, 0.05); sp(gr.gain, -p.depth * 0.0035, t, 0.05);
  };
  apply(0);
  return { input: io.input, output: io.output, set(k, v) { if (k === 'mix') io.setMix(v); else apply(); },
    dispose() { try { lfo.stop(); } catch (e) {} disconnectAll(io.input, io.output, io.dry, io.wet, mono, dl, dr, m, lfo, gl, gr); } };
}

// ---------- filter with slow motion ----------
function makeFilter(ctx, p) {
  const f = krateFilter(ctx.createBiquadFilter()), lfo = ctx.createOscillator(), lg = ctx.createGain();
  lfo.connect(lg); lg.connect(f.detune); lfo.start();
  const apply = (t = ctx.currentTime) => {
    f.type = p.mode; sp(f.frequency, clamp(p.cutoff, 20, 20000), t, 0.03); sp(f.Q, p.resonance, t, 0.03);
    sp(lfo.frequency, p.rate, t, 0.05); sp(lg.gain, p.motion * 1800, t, 0.05);
  };
  apply(0);
  return { input: f, output: f, set() { apply(); }, dispose() { try { lfo.stop(); } catch (e) {} disconnectAll(f, lfo, lg); } };
}

function makeEq(ctx, p) {
  const lc = krateFilter(ctx.createBiquadFilter()), lo = krateFilter(ctx.createBiquadFilter()), mid = krateFilter(ctx.createBiquadFilter()), hi = krateFilter(ctx.createBiquadFilter());
  lc.type = 'highpass'; lc.Q.value = 0.6; lo.type = 'lowshelf'; lo.frequency.value = 140; mid.type = 'peaking'; mid.frequency.value = 900; mid.Q.value = 0.7;
  hi.type = 'highshelf'; hi.frequency.value = 6000;
  lc.connect(lo); lo.connect(mid); mid.connect(hi);
  const apply = (t = ctx.currentTime) => { sp(lc.frequency, p.lowcut, t, 0.03); sp(lo.gain, p.low, t, 0.03); sp(mid.gain, p.mid, t, 0.03); sp(hi.gain, p.high, t, 0.03); };
  apply(0);
  return { input: lc, output: hi, set() { apply(); }, dispose() { disconnectAll(lc, lo, mid, hi); } };
}

function makeGlue(ctx, p) {
  const c = ctx.createDynamicsCompressor(), g = ctx.createGain();
  c.attack.value = 0.03; c.release.value = 0.4; c.knee.value = 12; c.connect(g);
  const apply = (t = ctx.currentTime) => { sp(c.threshold, p.threshold, t, 0.03); sp(c.ratio, p.ratio, t, 0.03); sp(g.gain, dbToGain(p.makeup), t, 0.03); };
  apply(0);
  return { input: c, output: g, set() { apply(); }, dispose() { disconnectAll(c, g); } };
}
