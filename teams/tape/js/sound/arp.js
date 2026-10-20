// arp.js - Slowreel arpeggiator: a per-track note processor (no DOM, no audio nodes).
// Settings live on the track: track.arp = {on, rate, pattern, octaves, gate, swing} (all optional; see ARP_DEFAULTS).
// ARP_PARAMS uses the same param format as instruments/effects, so the Sound tab can draw it with the usual knobs / enums / toggles.
//   clips:  notes = arpProcess(clip.notes, track.arp, bpm, clip.lengthBeats)  -> same {p, s, d, v} note shape (beats, clip-relative)
//           or arpNotes(clip, track.arp, bpm) (memoized; safe to call from the scheduler on every tick)
//   live:   const arp = createLiveArp(engine, trackId, () => track.arp, () => project.bpm); arp.noteOn(midi, vel); arp.noteOff(midi);
//           arp.allOff(); arp.dispose();   (only route keys through it while arp.active() is true)
import { rng } from './util.js?v=8';

const opt = (v, l = v) => ({ value: v, label: l });
export const ARP_RATES = { '1/4': 1, '1/8': 0.5, '1/8T': 1 / 3, '1/16': 0.25, '1/16T': 1 / 6, '1/32': 0.125 };
export const ARP_PARAMS = [
  { id: 'on', name: 'Arp', min: 0, max: 1, default: 0, unit: '', type: 'toggle' },
  { id: 'rate', name: 'Rate', min: 0, max: 5, default: '1/16', unit: '', type: 'enum', options: Object.keys(ARP_RATES).map(k => opt(k, k.replace('T', ' triplet'))) },
  { id: 'pattern', name: 'Pattern', min: 0, max: 4, default: 'up', unit: '', type: 'enum',
    options: [opt('up', 'Up'), opt('down', 'Down'), opt('updown', 'Up-down'), opt('random', 'Random'), opt('played', 'As played')] },
  { id: 'octaves', name: 'Octaves', min: 1, max: 4, default: 1, unit: '', step: 1 },
  { id: 'gate', name: 'Gate', min: 0.05, max: 1, default: 0.6, unit: '' },
  { id: 'swing', name: 'Swing', min: 0, max: 0.75, default: 0, unit: '' },
];
export const ARP_DEFAULTS = Object.fromEntries(ARP_PARAMS.map(p => [p.id, p.default]));

export function arpSettings(s = {}) {
  const o = { ...ARP_DEFAULTS };
  for (const k in s) if (k in o && s[k] !== undefined && s[k] !== null) o[k] = s[k];
  o.on = !!(o.on && o.on !== '0');
  if (!(o.rate in ARP_RATES)) o.rate = '1/16';
  o.octaves = Math.max(1, Math.min(4, Math.round(+o.octaves || 1)));
  o.gate = Math.max(0.05, Math.min(1, +o.gate || 0.6));
  o.swing = Math.max(0, Math.min(0.75, +o.swing || 0));
  return o;
}
export const arpStepBeats = s => ARP_RATES[arpSettings(s).rate];

// the order notes are played in, for one held set. held: [{p, v, order}] (order = when it was pressed)
function sequence(held, st) {
  const base = st.pattern === 'played' ? held.slice().sort((a, b) => a.order - b.order) : held.slice().sort((a, b) => a.p - b.p);
  const seq = [];
  for (let o = 0; o < st.octaves; o++) for (const n of base) if (n.p + o * 12 <= 127) seq.push({ p: n.p + o * 12, v: n.v });
  if (st.pattern === 'down') seq.reverse();
  else if (st.pattern === 'updown' && seq.length > 2) for (let i = seq.length - 2; i > 0; i--) seq.push(seq[i]);
  return seq;
}
// deterministic "random": the same step always picks the same note (renders and the scheduler agree)
const pick = (len, step, salt) => Math.floor(rng((step * 7919 + salt * 104729 + 17) >>> 0)() * len);
// swing: odd steps are late by swing x half a step (0.75 -> 3/8 of a step)
const swingOff = (k, step, swing) => (k % 2 === 1 ? swing * step * 0.5 : 0);

/**
 * Turns held notes into an arpeggio. notes: [{p, s, d, v}] in beats; returns a new array of the same shape (sorted by s).
 * Steps fall on the rate grid from beat 0 of the clip. A note is "held" on a step if it started before (or within 1/64 beat
 * after) the step and has not ended. When the settings are off (or there are no notes) the input is returned as is.
 */
export function arpProcess(notes, settings, bpm = 70, lengthBeats) {
  const st = arpSettings(settings);
  if (!st.on || !notes || !notes.length) return notes || [];
  const step = ARP_RATES[st.rate], eps = 1 / 64;
  const ns = notes.map((n, i) => ({ p: +n.p || 60, s: +n.s || 0, d: Math.max(0.01, +n.d || 1), v: n.v ?? 0.8, order: (+n.s || 0) * 1000 + i }));
  let end = 0; for (const n of ns) end = Math.max(end, n.s + n.d);
  if (lengthBeats) end = Math.min(end, lengthBeats);
  const minDur = Math.max(0.02, 0.025 * (bpm || 70) / 60);   // at least ~25 ms
  const out = [];
  let k = 0, prevEmpty = true, salt = 0;
  for (let i = 0; i * step < end - 1e-9; i++) {
    const t = i * step;
    const held = ns.filter(n => n.s <= t + eps && n.s + n.d > t + 1e-6);
    if (!held.length) { prevEmpty = true; continue; }
    if (prevEmpty) { k = 0; salt++; prevEmpty = false; }
    const seq = sequence(held, st);
    const n = st.pattern === 'random' ? seq[pick(seq.length, i, salt)] : seq[k % seq.length];
    const s = t + swingOff(i, step, st.swing);
    let d = Math.max(minDur, st.gate * step);
    if (lengthBeats) d = Math.min(d, lengthBeats - s);
    if (d > 0.001) out.push({ p: n.p, s: Math.round(s * 1e6) / 1e6, d: Math.round(d * 1e6) / 1e6, v: n.v });
    k++;
  }
  return out;
}

// memoized per clip (WeakMap on the notes array + a key of settings / length / bpm): call it from the scheduler freely
const memo = new WeakMap();
export function arpNotes(clip, settings, bpm = 70) {
  const notes = clip?.notes || [];
  const st = arpSettings(settings);
  if (!st.on) return notes;
  const key = JSON.stringify([st, clip.lengthBeats, bpm, notes.length, notes.length && notes[notes.length - 1]]);
  const hit = memo.get(notes);
  if (hit && hit.key === key && hit.sig === sig(notes)) return hit.out;
  const out = arpProcess(notes, st, bpm, clip.lengthBeats);
  memo.set(notes, { key, sig: sig(notes), out });
  return out;
}
function sig(notes) { let h = notes.length; for (const n of notes) h = (h * 31 + (n.p * 1000 + n.s * 977 + n.d * 131 + (n.v ?? 0.8) * 7) * 1000) % 2147483647; return h; }

/**
 * Live arp for the keyboard / pads. engine: {noteOn(trackId, midi, vel), noteOff(trackId, midi), position(), context}.
 * getSettings() -> track.arp, getBpm() -> project bpm. While the transport plays, steps lock to the song's beat grid;
 * when stopped, the grid starts at the first key press. Timing runs on a 5 ms timer against the AudioContext clock.
 */
export function createLiveArp(engine, trackId, getSettings, getBpm = () => 70) {
  const held = [];               // [{p, v, order}]
  const offs = [];               // [{p, at}] pending note-offs (context time)
  let timer = null, order = 0, k = 0, i = 0, nextT = 0, gridT0 = 0, salt = 0;
  const ctx = engine.context;
  const now = () => (ctx ? ctx.currentTime : performance.now() / 1000);
  const st = () => arpSettings({ ...(getSettings() || {}), on: true });
  const spb = () => 60 / Math.max(20, Math.min(300, +getBpm() || 70));

  function fire(t) {
    const s = st(), step = ARP_RATES[s.rate] * spb();
    while (offs.length && offs[0].at <= t) engine.noteOff(trackId, offs.shift().p);
    if (held.length && t >= nextT - 0.002) {
      const seq = sequence(held, s);
      const n = s.pattern === 'random' ? seq[pick(seq.length, i, salt)] : seq[k % seq.length];
      const pend = offs.findIndex(o => o.p === n.p);
      if (pend >= 0) { offs.splice(pend, 1); engine.noteOff(trackId, n.p); }
      engine.noteOn(trackId, n.p, n.v);
      offs.push({ p: n.p, at: t + Math.max(0.025, s.gate * step) }); offs.sort((a, b) => a.at - b.at);
      k++; i++;
      nextT = gridT0 + i * step + swingOff(i, step, s.swing);
      if (nextT < t) { i = Math.ceil((t - gridT0) / step); nextT = gridT0 + i * step + swingOff(i, step, s.swing); }   // tempo changed / timer late
    }
    if (!held.length && !offs.length) { clearInterval(timer); timer = null; }
  }
  function start() {
    const t = now(), s = st(), stepB = ARP_RATES[s.rate], step = stepB * spb();
    k = 0; salt++;
    const pos = engine.position?.();
    if (pos && pos.playing) {   // lock to the transport grid: next step on the beat grid
      const b = pos.beat, nb = Math.ceil(b / stepB - 1e-6) * stepB;
      i = Math.round(nb / stepB); gridT0 = t + (nb - b) * spb() - i * step;
      nextT = gridT0 + i * step + swingOff(i, step, s.swing);
      if (nextT - t > step * 0.5 && nb - b > stepB * 0.75) { /* almost a full step away: play now instead */ nextT = t; }
    } else { i = 0; gridT0 = t; nextT = t; }
    if (!timer) timer = setInterval(() => fire(now()), 5);
    fire(t);
  }
  return {
    active: () => arpSettings(getSettings() || {}).on,
    noteOn(midi, vel = 0.8) {
      if (held.some(n => n.p === midi)) return;
      const first = !held.length;
      held.push({ p: midi, v: vel, order: order++ });
      if (first) start();
    },
    noteOff(midi) { const j = held.findIndex(n => n.p === midi); if (j >= 0) held.splice(j, 1); },
    allOff() { held.length = 0; for (const o of offs.splice(0)) engine.noteOff(trackId, o.p); if (timer) { clearInterval(timer); timer = null; } },
    held: () => held.map(n => n.p),
    dispose() { this.allOff(); },
  };
}
