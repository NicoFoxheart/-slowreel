// grooves.js - "Add a groove": soft rhythm layers made for the tape's tempo and style. Pure (no DOM, no engine).
// A groove is a drum track (Drum Machine, janggu or taiko) holding 8-bar pattern clips across the tape, so the Beats tab
// edits each one (8 bars = 128 steps, its maximum). It starts after a short intro, varies every 4 bars (and section B
// differs from section A), humanises its velocities a little (seeded, so it is the same every time), plays a small fill
// at each section end and a calm last bar. The notes are ordinary {p, s, d, v}; clip.beat holds the Beats tab settings.
//   GROOVES                                 the picker list
//   grooveTrack(id, project, {uid, color})  -> a new track object (track.groove = id) with its clips

export const GROOVES = [
  { id: 'heartbeat', vol: -6.5, name: 'Heartbeat pulse', short: 'Pulse', line: 'A soft kick like a heartbeat, and a shaker', inst: 'drums', preset: 'soft-ambient' },
  { id: 'lofi', vol: -10.5, name: 'Lo-fi dust', short: 'Dust', line: 'Lazy kick, soft snare, dusty hats', inst: 'drums', preset: 'lofi-dust' },
  { id: 'garage', vol: -7.5, name: 'Future garage', short: 'Garage', line: 'Shuffled 2-step with swing (Antent)', inst: 'drums', preset: 'future-garage' },
  { id: 'rain', vol: -4, name: 'Rain ticks', short: 'Ticks', line: 'Very soft clicks and rim, like drops', inst: 'drums', preset: 'soft-ambient' },
  { id: 'janggu', vol: -3.5, name: 'Korean janggu', short: 'Janggu', line: 'Gutgeori / jungmori feel in 12/8', inst: 'janggu', preset: 'soft-hand' },
  { id: 'taiko', vol: -2.5, name: 'Soft taiko', short: 'Taiko', line: 'Distant temple drums, soft mallets', inst: 'taiko', preset: 'soft-mallets' },
  { id: 'simple', vol: -6, name: 'Simple kick and hat', short: 'Beat', line: 'Kick on 1 and 3, soft hats', inst: 'drums', preset: 'soft-ambient' },
];
export const grooveById = id => GROOVES.find(g => g.id === id) || null;
// vol: the fader that puts each groove about 12 dB under a -18 LUFS tape (measured alone: about -31 LUFS, rain ticks -36).
// The calm is in the velocities (0.15-0.75); the fader only lines the kits up.

// Drum Machine rows (drums.js DRUM_MAP); janggu and taiko use 36-40 (asian.js)
const KICK = 36, RIM = 37, SNARE = 38, CLAP = 39, GHOST = 40, TOM_L = 41, HAT = 42, SHAKER = 44, OHAT = 46;
const KUNG = 36, DEONG = 37, DEOK = 38, TTA = 39, ROLL = 40;
const DON = 36, KA = 37, SHIME = 38, DOKO = 39, ODAIKO = 40;

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }
const hash = str => { let x = 2166136261; for (const ch of str) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
const r4 = x => Math.round(x * 10000) / 10000;

// One bar of each groove: (bar info) -> [[beat 0..4 (16th grid, or exact triplets for janggu), midi, velocity]]
// info: { k (bar index in the clip, 0-7), B (section B), vary (4th bar), fill (section end), last (very last bar), bpm, R (rng) }
const PATTERNS = {
  heartbeat({ vary, fill, B, bpm }) {
    const dub = bpm < 90 ? 0.25 : 0.5, n = [[0, KICK, 0.7], [dub, KICK, 0.4]];
    if (!vary && !fill) n.push([2, KICK, 0.6], [2 + dub, KICK, 0.34]);
    if (vary) n.push([3.5, TOM_L, 0.26]);
    for (const b of [0.5, 1.5, 2.5, 3.5]) if (!(fill && b > 2)) n.push([b, SHAKER, 0.26]);
    if (B && !fill) for (const b of [0.75, 1.75, 2.75, 3.75]) n.push([b, SHAKER, 0.15]);
    if (fill) { for (let i = 0; i < 8; i++) n.push([2 + i * 0.25, SHAKER, 0.14 + i * 0.04]); n.push([3.5, TOM_L, 0.32]); }
    return n;
  },
  lofi({ vary, fill, B, bpm }) {
    const half = bpm >= 110, n = [[0, KICK, 0.66], [2.5, KICK, 0.5]];
    if (vary) n.push([1.75, KICK, 0.42]);
    if (half) n.push([2, SNARE, 0.5]); else n.push([1, SNARE, 0.5], [3, SNARE, fill ? 0.42 : 0.52]);
    for (let s = 0; s < 16; s += 2) { const b = s / 4; if (fill && b >= 3) continue; if (vary && s === 14) { n.push([b, OHAT, 0.26]); continue; } n.push([b, HAT, s % 4 ? 0.36 : 0.26]); }
    if (B && !fill) n.push([2.75, HAT, 0.16]);
    if (!fill && !vary) n.push([3.75, RIM, 0.16]);
    if (fill) n.push([3.25, GHOST, 0.24], [3.5, GHOST, 0.3], [3.75, GHOST, 0.38]);
    return n;
  },
  garage({ vary, fill, B }) {
    const n = [[0, KICK, 0.72], [1.75, KICK, 0.56], [1, CLAP, 0.5], [3, CLAP, 0.52]];
    if (vary) n.push([2.5, KICK, 0.42]);
    for (const b of [0.5, 1.5, 2.5, 3.5]) { if (fill && b === 3.5) continue; n.push([b, vary && b === 3.5 ? OHAT : HAT, vary && b === 3.5 ? 0.3 : 0.42]); }
    for (const b of [0.75, 2.75]) n.push([b, HAT, 0.2]);
    if (!vary) n.push([2.25, RIM, 0.22]);
    if (B && !fill) for (const b of [0.25, 1.25, 2.25, 3.25]) n.push([b, SHAKER, 0.14]);
    if (fill) n.push([3.25, RIM, 0.26], [3.5, CLAP, 0.34], [3.75, CLAP, 0.42]);
    return n;
  },
  rain({ fill, R }) {
    const n = [];
    for (const b of [0.5, 1.5, 2.5, 3.5]) if (R() > 0.15) n.push([b, HAT, 0.28 + R() * 0.12]);
    const drops = 3 + Math.floor(R() * 3);
    for (let i = 0; i < drops; i++) { const s = Math.floor(R() * 16); n.push([s / 4, R() > 0.45 ? RIM : HAT, 0.24 + R() * 0.26]); }
    if (R() > 0.6) n.push([Math.floor(R() * 8) / 2, SHAKER, 0.28]);
    if (fill) for (let i = 0; i < 4; i++) n.push([3 + i * 0.25, RIM, 0.28 + i * 0.1]);
    return n;
  },
  janggu({ k, vary, fill, bpm }) {
    const T = (beat, tick) => r4(beat + tick / 3);   // 12/8: four dotted-quarter beats of three ticks
    if (bpm < 58) {   // jungmori-like: slower and sparser, a two-bar cycle
      const n = k % 2 === 0 ? [[T(0, 0), DEONG, 0.55], [T(2, 0), KUNG, 0.42], [T(3, 2), DEOK, 0.28]] : [[T(0, 0), KUNG, 0.45], [T(1, 2), DEOK, 0.3], [T(2, 0), KUNG, 0.4], [T(3, 0), ROLL, 0.24]];
      if (vary) n.push([T(2, 2), TTA, 0.22]);
      if (fill) n.push([T(3, 0), DEONG, 0.42], [T(3, 1), DEOK, 0.3], [T(3, 2), DEOK, 0.36]);
      return n;
    }
    // gutgeori-like: "deong gi-deok kung deo-reo-reo / kung gi-deok kung deo-reo-reo"
    const n = [[T(0, 0), k % 2 === 0 ? DEONG : KUNG, k % 2 === 0 ? 0.6 : 0.5], [T(1, 1), TTA, 0.3], [T(1, 2), DEOK, 0.44], [T(2, 0), KUNG, 0.52]];
    if (!fill) n.push([T(3, 0), ROLL, 0.28]);
    if (vary) n.push([T(2, 2), DEOK, 0.3], [T(3, 2), TTA, 0.24]);
    if (fill) n.push([T(2, 2), DEOK, 0.34], [T(3, 0), DEONG, 0.46], [T(3, 1), DEOK, 0.36], [T(3, 2), DEOK, 0.42]);
    return n;
  },
  taiko({ k, vary, fill, B, bpm }) {
    const sparse = bpm >= 110, n = [[0, k === 0 ? ODAIKO : DON, k === 0 ? 0.42 : 0.52]];
    if (!sparse) n.push([1.5, KA, 0.2], [2.5, DON, 0.28], [3.5, KA, 0.18]);
    n.push([2, DON, 0.4]);
    if (vary) n.push([3, DON, 0.32]);
    if (B && !fill) for (const b of [0.5, 1, 2.5 + 0.5]) n.push([b, SHIME, 0.14]);
    if (fill) n.push([2.5, DOKO, 0.36], [3, DOKO, 0.44], [3.5, DON, 0.52], [3.75, DON, 0.4]);
    return n;
  },
  simple({ vary, fill, B }) {
    const n = [[0, KICK, 0.66], [2, KICK, 0.58]];
    if (B) n.push([2.5, KICK, 0.38]);
    for (const b of [0.5, 1.5, 2.5, 3.5]) { if (fill && b === 3.5) continue; n.push([b, vary && b === 3.5 ? OHAT : HAT, vary && b === 3.5 ? 0.28 : 0.36]); }
    for (const b of [0, 1, 2, 3]) if (!(fill && b === 3)) n.push([b, HAT, 0.2]);
    if (fill) n.push([3.5, KICK, 0.46], [3, HAT, 0.2], [3.25, HAT, 0.26], [3.5, HAT, 0.3], [3.75, HAT, 0.34]);
    return n;
  },
};
const SWING = { heartbeat: 0, lofi: 0.18, garage: 0.33, rain: 0, janggu: 0.3333, taiko: 0, simple: 0 };

/**
 * A groove track for the project: {id, name, color, kind, instrument, groove, volumeDb, pan, sends, fx, clips}.
 * The clips are 8-bar sections from the end of the intro to the end of the tape.
 */
export function grooveTrack(id, p, { uid = x => x + Math.random().toString(36).slice(2, 8), color = '#9B85E8' } = {}) {
  const g = grooveById(id); if (!g) return null;
  const bpm = +p.bpm || 70, bars = Math.max(4, +p.lengthBars || 16), BPB = 4;
  // the project's bar length is used for placement; patterns are written for 4 beats (other meters get the first beats)
  const bpb = +p.beatsPerBar || 4;
  const intro = bars >= 24 ? 4 : bars >= 12 ? 2 : 1;
  const clips = [];
  const R = rng(hash(id + ':' + bpm));
  for (let start = intro, sec = 0; start < bars; start += 8, sec++) {
    const len = Math.min(8, bars - start), notes = [], finalSec = start + len >= bars;
    for (let k = 0; k < len; k++) {
      const last = finalSec && k === len - 1;
      const fill = finalSec ? len > 1 && k === len - 2 : k === len - 1;
      const info = { k, B: sec % 2 === 1, vary: k % 4 === 3 && !fill && !last, fill, last, bpm, R };
      for (const [b, m, v] of PATTERNS[id](info)) {
        if (b >= Math.min(BPB, bpb) - 1e-6) continue;
        if (last && b > 0.01) continue;   // the very last bar: one calm downbeat, then the tape rings out
        const hv = Math.max(0.06, Math.min(0.95, v * (1 + (R() - 0.5) * 0.14)));   // a little human, never louder than calm
        notes.push({ p: m, s: r4(k * bpb + b), d: 0.25, v: Math.round(hv * 100) / 100 });
      }
    }
    const kept = notes.sort((a, b) => a.s - b.s || a.p - b.p);
    clips.push({ id: uid('c'), name: `${g.short} ${String.fromCharCode(65 + (sec % 2))}${sec >= 2 ? Math.floor(sec / 2) + 1 : ''}`, startBeat: start * bpb, lengthBeats: len * bpb,
      notes: kept, beat: { steps: Math.min(128, Math.round(len * bpb / 0.25)), swing: SWING[id] || 0, mute: [], muted: [] } });
  }
  // the swing is part of the pattern: odd 16ths start late (the Beats tab shows and edits the same value)
  if (SWING[id] && id !== 'janggu') for (const c of clips) for (const n of c.notes) { const st = Math.round(n.s / 0.25); if (Math.abs(n.s - st * 0.25) < 1e-6 && st % 2 === 1) n.s = r4(n.s + SWING[id] * 0.25); }
  return { id: uid('t'), name: g.name, color, kind: 'instrument', instrument: { id: g.inst, preset: g.preset, params: {} }, groove: id,
    volumeDb: g.vol ?? -8, pan: 0, mute: false, solo: false, sends: { space: 0.12, echo: 0 }, fx: [], clips };
}
