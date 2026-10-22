// fx2.js - round-2 effects in the same format as effects.js: Sidechain Pump, Tape Stop, Bitcrusher, Auto Filter, Stereo Widener.
// Every effect: createFx2(ctx, id, params, env) -> {id, params, input, output, set(id, v), dispose(), transport?(playing, t),
//   schedule?(fromBeat, toBeat, timeAt, project), ap?: {paramId: {param: AudioParam, map(v)}}}   (env: {bpm()}).
// Beat-synced effects (pump, tape stop, auto filter phase) need the engine to call schedule() for each scheduled range,
// the same place it schedules notes: scheduleFx(fxList, fromBeat, toBeat, timeAt, project). Native nodes only (no worklets).
import { clamp, disconnectAll, cached, sp } from './util.js?v=9d';

const P = (id, name, min, max, def, unit = '', extra = {}) => ({ id, name, min, max, default: def, unit, ...extra });
const E = (id, name, options, def) => ({ id, name, min: 0, max: options.length - 1, default: def, unit: '', type: 'enum', options });
const opt = (value, label) => ({ value, label });
const RATES = [opt('2', '1/2'), opt('1', '1/4'), opt('0.5', '1/8'), opt('0.25', '1/16')];
const SWEEPS = [opt('16', '4 bars'), opt('8', '2 bars'), opt('4', '1 bar'), opt('2', '1/2'), opt('1', '1/4'), opt('0.5', '1/8'), opt('0.25', '1/16')];
const KICKS = new Set([35, 36]);

export const FX2 = [
  { id: 'pump', name: 'Sidechain Pump', params: [
    E('source', 'Source', [opt('beat', 'Beat'), opt('kick', 'Kick track')], 'beat'),
    E('rate', 'Rate', RATES, '1'), P('depth', 'Depth', 0, 1, 0.6), P('shape', 'Release', 0, 1, 0.5) ] },
  { id: 'tapestop', name: 'Tape Stop', params: [
    E('every', 'Every', [opt('0', 'Off'), opt('1', '1 bar'), opt('2', '2 bars'), opt('4', '4 bars'), opt('8', '8 bars')], '4'),
    P('length', 'Length', 0.25, 4, 1, 'beats'), P('tone', 'Darken', 0, 1, 0.6) ] },
  { id: 'crusher', name: 'Bitcrusher', params: [
    P('bits', 'Bits', 1, 16, 6, '', { step: 1 }), P('downsample', 'Downsample', 1, 32, 6, 'x', { step: 1 }), P('mix', 'Mix', 0, 1, 0.8) ] },
  { id: 'autofilter', name: 'Auto Filter', params: [
    E('mode', 'Mode', [opt('lowpass', 'Low-pass'), opt('highpass', 'High-pass'), opt('bandpass', 'Band-pass')], 'lowpass'),
    E('rate', 'Sweep', SWEEPS, '4'), P('cutoff', 'Cutoff', 60, 12000, 900, 'Hz', { scale: 'log' }), P('depth', 'Depth', 0, 1, 0.6),
    P('resonance', 'Resonance', 0.1, 12, 2), E('shape', 'Shape', [opt('sine', 'Sine'), opt('triangle', 'Triangle')], 'sine') ] },
  { id: 'widener', name: 'Stereo Widener', params: [
    P('width', 'Width', 0, 2, 1.5), P('haas', 'Spread', 0, 1, 0.25), P('bassMono', 'Mono below', 20, 400, 120, 'Hz', { scale: 'log' }) ] },
];
const DEFS = Object.fromEntries(FX2.map(e => [e.id, e]));
export const FX2_IDS = FX2.map(e => e.id);

export function resolveFx2(id, params = {}) {
  const def = DEFS[id]; if (!def) return null;
  const out = {};
  for (const p of def.params) out[p.id] = params[p.id] !== undefined ? params[p.id] : p.default;
  return out;
}

export function createFx2(ctx, id, params = {}, env = { bpm: () => 70 }) {
  const def = DEFS[id]; if (!def) return null;
  const p = resolveFx2(id, params);
  if (id === 'pump' && params.keyTrack) p.keyTrack = params.keyTrack;   // optional: which drum track keys the pump
  const fx = { pump: makePump, tapestop: makeTapeStop, crusher: makeCrusher, autofilter: makeAutoFilter, widener: makeWidener }[id](ctx, p, env);
  fx.id = id; fx.params = p;
  const set = fx.set;
  fx.set = (k, v) => { if (!(k in p) && k !== 'keyTrack') return; p[k] = v; set(k, v); };
  return fx;
}

/** Call from the engine's scheduler for each chunk (same fromBeat/toBeat/timeAt as the notes). fxList may contain nulls. */
export function scheduleFx(fxList, fromBeat, toBeat, timeAt, project) {
  for (const f of fxList || []) if (f && f.schedule) { try { f.schedule(fromBeat, toBeat, timeAt, project); } catch (e) { console.warn('[fx2]', f.id, e); } }
}

const beatsPerBar = pr => clamp(+pr?.beatsPerBar || 4, 1, 16);
function dryWet(ctx, mix) {
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  input.connect(dry); dry.connect(output); wet.connect(output);
  const setMix = (m, t = ctx.currentTime) => { m = clamp(+m, 0, 1); sp(dry.gain, Math.cos(m * Math.PI / 2) ** 0.6 * (m >= 0.999 ? 0 : 1), t, 0.03); sp(wet.gain, Math.sin(m * Math.PI / 2), t, 0.03); };
  dry.gain.value = 1; wet.gain.value = 0; setMix(mix, 0);
  return { input, output, dry, wet, setMix };
}

// ---------- Sidechain Pump: a VCA that ducks on each beat step (or on a drum track's kick notes) and breathes back ----------
function makePump(ctx, p, env) {
  const vca = ctx.createGain(); vca.gain.value = 1;
  const kicksIn = (pr, a, b) => {
    const tracks = pr?.tracks || [];
    const key = tracks.find(t => t.id === p.keyTrack) || tracks.find(t => t.instrument?.id === 'drums');
    if (!key) return null;
    const out = [];
    for (const c of key.clips || []) {
      const cs = +c.startBeat || 0, cl = +c.lengthBeats || 0;
      if (cs + cl <= a || cs >= b) continue;
      for (const n of c.notes || []) { const s = +n.s || 0; if (!KICKS.has(n.p) || s < 0 || s >= cl) continue; const at = cs + s; if (at >= a && at < b) out.push([at, n.v ?? 0.9]); }
    }
    return out.sort((x, y) => x[0] - y[0]);
  };
  const duck = (t, amt, stepSec) => {
    const low = 1 - clamp(p.depth, 0, 1) * amt, rel = Math.max(0.02, stepSec * (0.2 + 0.75 * p.shape));
    vca.gain.setTargetAtTime(low, t, 0.004);
    vca.gain.setTargetAtTime(1, t + 0.018, rel / 3.2);
  };
  return {
    input: vca, output: vca, set() { },
    schedule(a, b, timeAt, pr) {
      if (p.depth <= 0.001) return;
      const spb = 60 / env.bpm();
      const hits = p.source === 'kick' ? kicksIn(pr, a, b) : null;
      if (hits) { for (const [at, v] of hits) duck(timeAt(at), clamp(0.55 + 0.45 * v, 0, 1), spb); return; }
      const step = clamp(parseFloat(p.rate) || 1, 0.125, 4);
      for (let k = Math.ceil(a / step - 1e-9); k * step < b; k++) duck(timeAt(k * step), 1, step * spb);
    },
    transport(playing, t) { vca.gain.cancelScheduledValues(t); vca.gain.setTargetAtTime(1, t, 0.01); },
    dispose() { disconnectAll(vca); },
  };
}

// ---------- Tape Stop: over the last `length` beats of every N bars the tape slows to a halt, then starts again on the downbeat ----------
function makeTapeStop(ctx, p, env) {
  const input = ctx.createGain(), dl = ctx.createDelay(6), lp = ctx.createBiquadFilter(), vca = ctx.createGain();
  lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.5; dl.delayTime.value = 0;
  input.connect(dl); dl.connect(lp); lp.connect(vca);
  const reset = t => {
    for (const a of [dl.delayTime, lp.frequency, vca.gain]) a.cancelScheduledValues(t);
    dl.delayTime.setValueAtTime(0, t); lp.frequency.setValueAtTime(20000, t); vca.gain.setValueAtTime(1, t);
  };
  return {
    input, output: vca, set() { },
    schedule(a, b, timeAt, pr) {
      const bars = parseFloat(p.every) || 0; if (bars <= 0) return;
      const cyc = bars * beatsPerBar(pr), len = clamp(p.length, 0.25, Math.min(4, cyc));
      for (let k = Math.max(1, Math.ceil((a + len) / cyc - 1e-9)); k * cyc - len < b; k++) {
        const S = k * cyc - len, Eb = k * cyc; if (S < a - 1e-9) continue;
        const tS = timeAt(S), tE = timeAt(Eb), T = tE - tS; if (T < 0.05) continue;
        // playback rate falls linearly 1 -> 0, so the delay grows as t^2 / 2T (rate = 1 - dD/dt)
        const n = 48, curve = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * T * 0.985; curve[i] = Math.min(5.9, x * x / (2 * T)); }
        try {
          dl.delayTime.setValueCurveAtTime(curve, tS, T * 0.985); dl.delayTime.setValueAtTime(0, tE + 0.004);
          lp.frequency.setValueAtTime(20000, tS); lp.frequency.exponentialRampToValueAtTime(20000 * Math.pow(0.012, clamp(p.tone, 0, 1)) + 200, tE);
          lp.frequency.setValueAtTime(20000, tE + 0.005);
          vca.gain.setValueAtTime(1, tS + T * 0.55); vca.gain.linearRampToValueAtTime(0, tE - 0.004);
          vca.gain.setValueAtTime(0, tE + 0.006); vca.gain.linearRampToValueAtTime(1, tE + 0.02);
        } catch (e) { /* overlapping curve after a tempo or loop jump: skip this stop */ }
      }
    },
    transport(playing, t) { reset(t); },
    dispose() { disconnectAll(input, dl, lp, vca); },
  };
}

// ---------- Bitcrusher: sample-and-hold (a delay swept by an exact looping ramp) + a stair-step waveshaper ----------
function makeCrusher(ctx, p) {
  const io = dryWet(ctx, p.mix), dl = ctx.createDelay(0.01), ws = ctx.createWaveShaper(), comp = ctx.createGain();
  dl.delayTime.value = 0; ws.oversample = 'none';
  io.input.connect(dl); dl.connect(ws); ws.connect(comp); comp.connect(io.wet);
  let ramp = null;
  const setHold = () => {
    const k = Math.round(clamp(p.downsample, 1, 32));
    if (ramp) { try { ramp.stop(); } catch (e) { } ramp.disconnect(); ramp = null; }
    if (k <= 1) return;
    const buf = cached(ctx, 'crush-ramp:' + k, () => { const b = ctx.createBuffer(1, k, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < k; i++) d[i] = i / ctx.sampleRate; return b; });
    ramp = ctx.createBufferSource(); ramp.buffer = buf; ramp.loop = true; ramp.connect(dl.delayTime); ramp.start();
  };
  const setBits = () => {
    const bits = Math.round(clamp(p.bits, 1, 16)), L = Math.pow(2, bits - 1);
    ws.curve = cached(ctx, 'crush-bits:' + bits, () => { const n = 8192, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = bits >= 16 ? x : Math.round(x * L) / L; } return c; });
    comp.gain.value = bits <= 2 ? 0.5 : 1;   // 1-2 bits turn quiet audio into full-scale squares: keep them tame
  };
  setHold(); setBits();
  return { input: io.input, output: io.output,
    set(k, v) { if (k === 'mix') io.setMix(v); else if (k === 'bits') setBits(); else if (k === 'downsample') setHold(); },
    dispose() { if (ramp) { try { ramp.stop(); } catch (e) { } } disconnectAll(io.input, io.output, io.dry, io.wet, dl, ws, comp, ramp); } };
}

// ---------- Auto Filter: tempo-synced LFO sweeping a resonant filter (phase locked to the bar grid when scheduled) ----------
function makeAutoFilter(ctx, p, env) {
  const f = ctx.createBiquadFilter(), lg = ctx.createGain();
  lg.connect(f.detune);
  const waveOf = shape => cached(ctx, 'af-wave:' + shape, () => {
    const N = 16, re = new Float32Array(N + 1), im = new Float32Array(N + 1);
    if (shape === 'triangle') { for (let n = 1; n <= N; n += 2) re[n] = -8 / (Math.PI * Math.PI * n * n); } else re[1] = -1;   // starts at the bottom
    return ctx.createPeriodicWave(re, im, { disableNormalization: true });
  });
  let lfo = null, needSync = true;
  const beats = () => clamp(parseFloat(p.rate) || 4, 0.125, 64);
  const freq = () => env.bpm() / 60 / beats();
  const newLfo = t => { const o = ctx.createOscillator(); o.setPeriodicWave(waveOf(p.shape)); o.frequency.value = freq(); o.connect(lg); o.start(t); return o; };
  const swap = t => { const old = lfo; lfo = newLfo(t); if (old) { try { old.stop(t); } catch (e) { } old.onended = () => old.disconnect(); } };
  const apply = (t = ctx.currentTime) => {
    f.type = p.mode; sp(f.frequency, clamp(p.cutoff, 20, 20000), t, 0.03); sp(f.Q, p.resonance, t, 0.03); sp(lg.gain, p.depth * 3600, t, 0.05);
    if (lfo) sp(lfo.frequency, freq(), t, 0.05);
  };
  apply(0); lfo = newLfo(ctx.currentTime);
  return {
    input: f, output: f,
    set(k) { if (k === 'shape') swap(ctx.currentTime); apply(); },
    schedule(a, b, timeAt) {
      if (!needSync) return; needSync = false;
      const B = beats(), nb = Math.ceil(a / B - 1e-9) * B;   // restart the sweep on the next cycle boundary (bar grid)
      if (lfo) lfo.frequency.value = freq();
      swap(Math.max(ctx.currentTime, timeAt(nb)));
    },
    transport(playing) { if (playing) needSync = true; },
    ap: { cutoff: { param: f.frequency, map: v => v }, resonance: { param: f.Q, map: v => v }, depth: { param: lg.gain, map: v => v * 3600 } },
    dispose() { try { lfo && lfo.stop(); } catch (e) { } disconnectAll(f, lg, lfo); },
  };
}

// ---------- Stereo Widener: mid/side, side above `bassMono` scaled by width, plus a Haas-delayed copy of the mid in the side ----------
function makeWidener(ctx, p) {
  const input = ctx.createGain(), split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2), output = ctx.createGain();
  input.channelCount = 2; input.channelCountMode = 'explicit'; split.channelCount = 2; split.channelCountMode = 'explicit';
  const mono = () => { const g = ctx.createGain(); g.channelCount = 1; g.channelCountMode = 'explicit'; return g; };
  const mL = mono(), mR = mono(), sL = mono(), sR = mono(), M = mono(), S = mono(), hp = ctx.createBiquadFilter(), w = mono(), inv = mono();
  const hd = ctx.createDelay(0.05), hhp = ctx.createBiquadFilter(), hg = mono();
  mL.gain.value = 0.5; mR.gain.value = 0.5; sL.gain.value = 0.5; sR.gain.value = -0.5; inv.gain.value = -1;
  hp.type = 'highpass'; hp.Q.value = 0.6; hhp.type = 'highpass'; hhp.Q.value = 0.6; hd.delayTime.value = 0.013;
  input.connect(split);
  split.connect(mL, 0); split.connect(sL, 0); split.connect(mR, 1); split.connect(sR, 1);
  mL.connect(M); mR.connect(M); sL.connect(S); sR.connect(S);
  S.connect(hp); hp.connect(w);
  M.connect(hd); hd.connect(hhp); hhp.connect(hg); hg.connect(w);
  M.connect(merge, 0, 0); M.connect(merge, 0, 1); w.connect(merge, 0, 0); w.connect(inv); inv.connect(merge, 0, 1);
  merge.connect(output);
  const apply = (t = ctx.currentTime) => {
    sp(w.gain, clamp(p.width, 0, 2), t, 0.03); sp(hg.gain, clamp(p.haas, 0, 1) * 0.6, t, 0.03);
    sp(hp.frequency, clamp(p.bassMono, 20, 400), t, 0.03); sp(hhp.frequency, Math.max(180, p.bassMono * 1.5), t, 0.03);
  };
  apply(0);
  return { input, output, set() { apply(); }, ap: { width: { param: w.gain, map: v => clamp(v, 0, 2) } },
    dispose() { disconnectAll(input, split, merge, output, mL, mR, sL, sR, M, S, hp, w, inv, hd, hhp, hg); } };
}
