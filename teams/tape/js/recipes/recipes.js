// recipes.js - Slowreel "Recipes": 12 one-click starter projects that teach ambient music (3 Korean, 3 Chinese,
// 3 Japanese, 3 general ambient). Each recipe is {id, title, region, mood, bpm, key, scale, steps, project} where
// `project` is a full Slowreel project (nfx-studio/1, the same schema as demo.json) and `steps` are short plain tips
// that say WHY each layer or setting works.
//
//   import { RECIPES, REGIONS, SCALE_LABELS, recipeById } from './js/recipes/recipes.js';
//   await engine.load(structuredClone(RECIPES[0].project));
//
// The projects are written with a tiny note language (see `line`, `chords`, `arp`, `beat` below) and expanded into
// ordinary notes {p, s, d, v} when this module loads, so what ships is plain project data.
// Mixes are kept quiet on purpose: every fader at or below 0 dB, the master at -2 dB, no glue makeup. Rendered with the
// real engine they land around -26 LUFS with peaks near -10 dBFS (validate-recipes.cjs --render); the limiter only
// catches peaks above -3 dBFS and a recipe should never reach it.
//
// The East Asian instruments (gayageum, haegeum, daegeum, janggu, guzheng, erhu, dizi, pipa, templebells, koto, shakuhachi,
// shamisen, taiko, windchimes) and scales (pyeongjo, gyemyeonjo, gong, shang, yu, in, yo, ryukyu) come from js/sound/asian.js
// (ASIAN, ASIAN_SCALES). Wind chimes are a texture: one held note sets the root they are tuned to.
// Check everything with: node teams/tape/tests/validate-recipes.cjs

// ---------------------------------------------------------------- note language
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
/** 'C4' -> 60 (Slowreel names MIDI 60 "C4"). */
export function midi(name) {
  const m = /^([A-G](?:#|b)?)(-?\d)$/.exec(String(name).trim());
  if (!m) throw new Error('recipes: bad note name ' + name);
  return 12 * (Number(m[2]) + 1) + PC[m[1]];
}
const r3 = x => Math.round(x * 1000) / 1000;

/** A melody: "E5:1.5 D5:0.5 -:2 A4:4@0.4" = note:beats[@velocity], "-" is a rest. Notes are held for `legato` of
 *  their length (0.92 leaves a breath between notes). */
function line(str, { at = 0, v = 0.5, legato = 0.92 } = {}) {
  const out = []; let t = at;
  for (const tok of str.trim().split(/\s+/)) {
    const m = /^([^:]+):([\d.]+)(?:@([\d.]+))?$/.exec(tok);
    if (!m) throw new Error('recipes: bad token ' + tok);
    const len = Number(m[2]);
    if (m[1] !== '-') for (const nm of m[1].split('+')) out.push({ p: midi(nm), s: r3(t), d: r3(len * legato), v: m[3] ? Number(m[3]) : v });
    t += len;
  }
  return out;
}
/** Block chords, one every `beats`, gently strummed from the bottom up (strum = beats between notes). */
function chords(list, { at = 0, beats = 8, v = 0.38, strum = 0.08, hold = 0.97, fade = 0.02 } = {}) {
  const out = [];
  list.forEach((c, i) => {
    c.trim().split(/\s+/).forEach((nm, k) => out.push({ p: midi(nm), s: r3(at + i * beats + k * strum), d: r3(beats * hold - k * strum), v: r3(Math.max(0.05, v - k * fade)) }));
  });
  return out;
}
/** Arpeggio: walks each chord in `order` every `step` beats for `beats` beats. */
function arp(list, { at = 0, beats = 8, step = 0.5, order = [0, 1, 2, 3, 2, 1], v = 0.36, accent = 0.08, d = 1.2 } = {}) {
  const out = [];
  list.forEach((c, i) => {
    const ns = c.trim().split(/\s+/).map(midi);
    for (let k = 0, t = 0; t < beats - 1e-9; k++, t += step) {
      out.push({ p: ns[order[k % order.length] % ns.length], s: r3(at + i * beats + t), d, v: r3(v + (k % order.length === 0 ? accent : 0)) });
    }
  });
  return out;
}
/** A glissando (the zither sweep): each note `gap` beats after the last, all ringing until `ring`. */
function gliss(names, { at = 0, gap = 0.08, ring = 3, v = 0.3, rise = 0.02 } = {}) {
  return names.trim().split(/\s+/).map((nm, k) => ({ p: midi(nm), s: r3(at + k * gap), d: r3(Math.max(0.3, ring - k * gap)), v: r3(v + k * rise) }));
}
/** One drum bar, repeated: [[midi, beat, vel], ...]. */
function beat(hits, { bars = 4, at = 0, bpb = 4, d = 0.25 } = {}) {
  const out = [];
  for (let b = 0; b < bars; b++) for (const [p, s, v] of hits) out.push({ p, s: r3(at + b * bpb + s), d, v });
  return out;
}
/** Shift notes by `by` beats (to place a phrase later in a clip). */
const shift = (notes, by) => notes.map(n => ({ ...n, s: r3(n.s + by) }));
const held = (name, s, d, v = 0.5) => ({ p: midi(name), s, d, v });

// ---------------------------------------------------------------- project builders
const COLORS = ['#E8542F', '#F0A616', '#8FA53A', '#1E9A88', '#2E5BD4', '#7A63C8', '#D7678F', '#5A6168'];
const fx = (id, params) => ({ id, params, bypass: false });
const tape = (o = {}) => fx('tape', { drive: 0.15, age: 0.35, wow: 0.3, flutter: 0.15, hiss: 0.08, ...o });

/** A clip from bar `bar` (0-based) for `bars` bars; notes are relative to the clip start and trimmed to it. */
function clip(bar, bars, notes, extra = {}) {
  const len = bars * 4;
  const ns = notes.filter(n => n.s < len - 1e-9).map(n => ({ ...n, d: r3(Math.min(n.d, len - n.s)) })).sort((a, b) => a.s - b.s || a.p - b.p);
  return { startBeat: bar * 4, lengthBeats: len, notes: ns, ...extra };
}
/** Drum clips: one 4-bar clip per entry (the step editor holds up to 32 beats), with step-editor metadata. */
const drumClips = (bars, hits, last = hits) => bars.map((b, i) => clip(b, 4, beat(i === bars.length - 1 ? last : hits), { beat: { steps: 64, swing: 0, mute: [], muted: [] } }));

function track(o, i) {
  return {
    id: o.id, name: o.name, color: COLORS[i % COLORS.length], kind: 'instrument',
    instrument: { id: o.inst, preset: o.preset, params: o.params || {} },
    volumeDb: o.vol ?? -12, pan: o.pan ?? 0, mute: false, solo: false,
    sends: { space: o.space ?? 0.3, echo: o.echo ?? 0 },
    fx: o.fx || [],
    clips: (o.clips || []).map((c, k) => ({ id: `${o.id}-c${k + 1}`, ...c })),
  };
}

function project(r, o) {
  const space = { type: 'hall', mix: 1, size: 1.4, tone: 0.45, preDelay: 0.03, shimmer: 0, ...(o.space || {}) };
  return {
    schema: 'nfx-studio/1',
    id: 'recipe-' + r.id,
    name: r.title,
    bpm: r.bpm, beatsPerBar: 4, key: r.key, scale: r.scale,
    lengthBars: o.bars,
    loop: { on: false, startBeat: 0, endBeat: o.bars * 4 },
    credit: `Recipe "${r.title}" by team tape (Slowreel)`,
    recipe: r.id,
    tracks: o.tracks.map(track),
    buses: {
      space: { returnDb: o.spaceDb ?? 0, fx: [fx(space.shimmer > 0 ? 'shimmer' : 'reverb', space)] },
      echo: { returnDb: o.echoDb ?? -4, fx: [fx('echo', { beats: 0.75, feedback: 0.5, tone: 0.35, wow: 0.4, drive: 0.25, spread: 0.8, mix: 1, ...(o.echo || {}) })] },
    },
    master: { volumeDb: o.masterDb ?? -2, atmosphere: o.atmosphere ?? 0.5, fx: [] },
    createdAt: 0, updatedAt: 0,
  };
}
const recipe = (meta, build) => ({ ...meta, project: project(meta, build()) });

// ---------------------------------------------------------------- labels for the UI
export const REGIONS = [
  { id: 'korea', name: 'Korea', blurb: 'Zithers that bend, a two-string fiddle, a bamboo flute and the hourglass drum.' },
  { id: 'china', name: 'China', blurb: 'The five-note modes, guzheng sweeps, erhu and dizi.' },
  { id: 'japan', name: 'Japan', blurb: 'Koto, shakuhachi, temple bells, and silence used as a sound.' },
  { id: 'ambient', name: 'Ambient basics', blurb: 'Drone, pad, a few notes and a big room. Start here.' },
];
export const SCALE_LABELS = {
  major: 'Major', minor: 'Minor', lydian: 'Lydian', dorian: 'Dorian', mixolydian: 'Mixolydian',
  pyeongjo: 'Pyeongjo', gyemyeonjo: 'Gyemyeonjo', gong: 'Gong mode', shang: 'Shang mode', jue: 'Jue mode', zhi: 'Zhi mode', yu: 'Yu mode',
  hirajoshi: 'Hirajoshi', in: 'In', yo: 'Yo', iwato: 'Iwato', kumoi: 'Kumoi', ryukyu: 'Ryukyu',
};

// ---------------------------------------------------------------- the recipes
export const RECIPES = [

  // ============================================================ KOREA
  recipe({
    id: 'rainy-seoul-night', title: 'Rainy Seoul night', region: 'korea', mood: 'Late, wet streets, a little lonely',
    bpm: 68, key: 'A', scale: 'gyemyeonjo',
    steps: [
      'Rain comes first: one long note on the Textures track. Ambient music starts with a place, then adds music to it.',
      'Gyemyeonjo is a Korean mode with a sad, sighing colour (A C D E G here). It has no clashing notes, so any two of them sound good together.',
      'The felt piano plays slow chords built only from those five notes, one every 2 bars. The long gaps leave room for the reverb to answer.',
      'The gayageum (a 12-string zither) carries the tune from bar 5. Its notes bend after the pluck, so leave silence after each phrase and let the bend sing.',
      'The haegeum (a two-string fiddle) comes in at bar 9 with long notes. A second voice that moves slower than the first keeps everything calm.',
      'The two tune instruments are the loudest tracks; rain and drone sit 3-5 dB under them and the master stays at -2 dB. A quiet mix keeps the rain soft and never pushes the limiter.',
    ],
  }, () => ({
    bars: 24, atmosphere: 0.55,
    space: { type: 'hall', size: 1.5, tone: 0.42, preDelay: 0.03 },
    tracks: [
      { id: 'rain', name: 'Seoul rain', inst: 'texture', preset: 'night-rain', params: { tone: 0.5, density: 0.35, motion: 0.4 }, vol: -4, space: 0.1,
        clips: [clip(0, 24, [held('C4', 0, 95, 0.5)])] },
      { id: 'drone', name: 'Low A', inst: 'drone', preset: 'warm-sub', params: { body: 0.55, reed: 0.1, motion: 0.35, grit: 0.05 }, vol: -6, space: 0.15,
        clips: [clip(0, 24, [held('A2', 0, 47.5, 0.5), held('A2', 48, 47.5, 0.5), held('E3', 16, 31, 0.3), held('E3', 64, 31, 0.3)])] },
      { id: 'piano', name: 'Felt piano', inst: 'felt', preset: 'felt-upright', params: { felt: 0.75, sustain: 0.65, wobble: 0.35 }, vol: -1, space: 0.4, echo: 0.12, fx: [tape({ age: 0.4, hiss: 0.1 })],
        clips: [clip(0, 24, [0, 32, 64].flatMap(at => [
          ...chords(['A2 E3 G3 C4', 'D3 A3 C4 E4', 'C3 G3 D4 E4', 'G2 D3 A3 C4'], { at, beats: 8, v: 0.4, strum: 0.12 }),
          ...chords(['G3 C4', 'C4 E4', 'D4 E4', 'A3 C4'], { at: at + 4, beats: 8, v: 0.24, strum: 0.2, hold: 0.45 }),
        ]))] },
      { id: 'gayageum', name: 'Gayageum', inst: 'gayageum', preset: 'moonlit-gayageum', vol: -2, pan: -0.15, space: 0.35, echo: 0.25,
        clips: [clip(4, 20, line(
          'E5:1.5 D5:0.5 C5:2 A4:4 -:2 C5:1 D5:1 E5:4 ' +
          'G5:1 E5:1 D5:2 C5:1 D5:1 A4:4 -:2 G4:1 A4:3 -:8 ' +
          'E5:1.5 G5:0.5 A5:2 G5:2 E5:2 D5:2 C5:2 D5:4 ' +
          'C5:1 A4:1 G4:2 A4:4 -:2 E4:1 G4:1 A4:4 -:8', { v: 0.5 }))] },
      { id: 'haegeum', name: 'Haegeum', inst: 'haegeum', preset: 'misty-haegeum', vol: -5, pan: 0.2, space: 0.5, echo: 0.05,
        clips: [clip(8, 16, line('A4:6 G4:2 E4:8 -:4 D4:4 E4:4 G4:4 A4:12 -:4 C5:6 A4:2 G4:8', { v: 0.4, legato: 0.98 }))] },
    ],
  })),

  recipe({
    id: 'hanok-morning', title: 'Hanok morning', region: 'korea', mood: 'Bright, wooden, sunlight on paper doors',
    bpm: 72, key: 'G', scale: 'pyeongjo',
    steps: [
      'Pyeongjo is the calm, open Korean mode (G A C D E here). It feels like morning because it has no dark, minor-sounding notes.',
      'The gayageum plays a gentle repeating arpeggio: the same 8-note shape over each chord. Repetition is what lets a listener relax.',
      'The daegeum (a big bamboo flute) enters at bar 5 with long, breathy notes. Long notes over a busy arpeggio is a classic ambient pairing.',
      'The janggu (hourglass drum) plays only 2-4 soft hits a bar, from bar 5. In ambient music a drum marks time; it does not push it.',
      'The bamboo chimes are a texture: one held G (the key\'s root) and the wind decides when they ring, tuned to the same five notes. Density 0.2 keeps them rare; constant sounds become wallpaper.',
    ],
  }, () => ({
    bars: 16, atmosphere: 0.5,
    space: { type: 'hall', size: 1.3, tone: 0.5, preDelay: 0.025 },
    tracks: [
      { id: 'air', name: 'Morning air', inst: 'texture', preset: 'wind', params: { tone: 0.35, motion: 0.45, density: 0.3 }, vol: -6, space: 0.1,
        clips: [clip(0, 16, [held('C4', 0, 63.5, 0.45)])] },
      { id: 'drone', name: 'Floor drone', inst: 'drone', preset: 'warm-sub', params: { body: 0.5, reed: 0.15, motion: 0.3, grit: 0 }, vol: -5, space: 0.15,
        clips: [clip(0, 16, [held('G2', 0, 63.5, 0.45), held('D3', 32, 31.5, 0.3)])] },
      { id: 'gayageum', name: 'Gayageum arpeggio', inst: 'gayageum', preset: 'bright-25', vol: 0, pan: -0.2, space: 0.35, echo: 0.1,
        clips: [clip(0, 16, [0, 32].flatMap(at => arp(['G3 D4 A4 D5', 'C4 G4 D5 E5', 'A3 E4 G4 C5', 'D3 A3 C4 G4'],
          { at, beats: 8, step: 0.5, order: [0, 1, 2, 3, 2, 1, 2, 3], v: 0.32, accent: 0.08, d: 1.2 })))] },
      { id: 'daegeum', name: 'Daegeum', inst: 'daegeum', preset: 'court-daegeum', vol: 0, pan: 0.15, space: 0.5, echo: 0.15,
        clips: [clip(4, 12, line('D5:3 E5:1 G5:4 E5:2 D5:2 C5:4 -:4 A4:2 C5:2 D5:6 -:2 E5:2 D5:1 C5:1 A4:4 G4:8', { v: 0.45, legato: 0.96 }))] },
      { id: 'janggu', name: 'Janggu', inst: 'janggu', preset: 'soft-hand', vol: -3, space: 0.2,
        clips: drumClips([4, 8, 12], [[36, 0, 0.4], [38, 1.5, 0.2], [38, 2, 0.25], [37, 3, 0.3]], [[36, 0, 0.4], [38, 2, 0.25], [36, 3, 0.3], [38, 3.5, 0.18]]) },
      { id: 'chimes', name: 'Bamboo chimes', inst: 'windchimes', preset: 'bamboo-chimes', params: { density: 0.2, wind: 0.35 }, vol: -5, pan: 0.3, space: 0.5, echo: 0.1,
        clips: [clip(2, 14, [held('G4', 0, 55.5, 0.4)])] },
    ],
  })),

  recipe({
    id: 'jeju-sea-wind', title: 'Jeju sea wind', region: 'korea', mood: 'Wide, salty, slow waves on black rock',
    bpm: 64, key: 'D', scale: 'pyeongjo',
    steps: [
      'Ocean waves are a rhythm without a beat: they set a slow breathing pace before a single note plays.',
      'The pad changes chord only every 4 bars. Slow harmony is the main difference between ambient music and a pop song.',
      'The haegeum sings the tune from bar 5. Its pitch slides between notes, which sounds like a voice calling across water.',
      'The gayageum plays tiny 3-note echoes with a lot of Echo send (0.35). The tape echo turns three notes into a whole answer.',
      'The Space bus uses a shimmer hall (shimmer 0.15): it adds a faint octave-up glow, like light on the sea. Keep shimmer low or it turns sugary.',
    ],
  }, () => ({
    bars: 24, atmosphere: 0.5,
    space: { type: 'hall', size: 1.6, tone: 0.45, preDelay: 0.04, shimmer: 0.15 },
    echo: { beats: 1, feedback: 0.55, tone: 0.32 },
    tracks: [
      { id: 'ocean', name: 'Jeju sea', inst: 'texture', preset: 'ocean', params: { tone: 0.4, motion: 0.65, density: 0.5 }, vol: -4, space: 0.1,
        clips: [clip(0, 24, [held('C4', 0, 95.5, 0.5)])] },
      { id: 'drone', name: 'Sea floor', inst: 'drone', preset: 'warm-sub', params: { body: 0.6, motion: 0.45, grit: 0 }, vol: -6, space: 0.15,
        clips: [clip(0, 24, [held('D2', 0, 47.5, 0.45), held('D2', 48, 47.5, 0.45)])] },
      { id: 'pad', name: 'Warm pad', inst: 'tapepad', preset: 'warm-pad', params: { warmth: 0.6, swell: 0.7, air: 0.2 }, vol: -3, space: 0.5, echo: 0.04,
        clips: [clip(0, 24, chords(['D3 A3 E4 B4', 'G2 D3 A3 B3', 'B2 E3 A3 D4', 'E3 A3 B3 D4', 'D3 A3 E4 B4', 'G2 D3 A3 B3'], { beats: 16, v: 0.36, strum: 0.15 }))] },
      { id: 'haegeum', name: 'Haegeum', inst: 'haegeum', preset: 'sanjo-haegeum', vol: -1, pan: 0.1, space: 0.45, echo: 0.08,
        clips: [clip(4, 20, line(
          'A4:4 B4:2 D5:2 E5:6 D5:2 B4:4 A4:4 -:8 ' +
          'D5:2 E5:2 G5:4 E5:4 D5:2 B4:2 A4:8 -:8 ' +
          'B4:4 A4:2 G4:2 A4:8', { v: 0.42, legato: 0.98 }))] },
      { id: 'gayageum', name: 'Gayageum echoes', inst: 'gayageum', preset: 'sanjo-silk', vol: -3, pan: -0.25, space: 0.35, echo: 0.35,
        clips: [clip(2, 22, line('D5:0.5 B4:0.5 A4:3 -:4 E5:0.5 D5:0.5 B4:3 -:4 '.repeat(5) + '-:8', { v: 0.42 }))] },
    ],
  })),

  // ============================================================ CHINA
  recipe({
    id: 'mountain-mist-guzheng', title: 'Mountain mist guzheng', region: 'china', mood: 'High, misty, ink-painting stillness',
    bpm: 60, key: 'D', scale: 'gong',
    steps: [
      'Gong mode is the bright "home" of the Chinese five-note scale (D E F# A B here). Five notes, no half steps, nothing ever clashes.',
      'The guzheng opens with a glissando: nine notes swept upward 0.08 beats apart. That sweep is the signature sound of the zither.',
      'Its melody moves mostly by step and rests for a whole bar between phrases. Mist needs empty space to drift through.',
      'The dizi (bamboo flute) enters at bar 9, far away: a quieter track and a big Space send (0.6) push a sound into the distance.',
      'The Space reverb is a large hall (size 1.8) with a 60 ms pre-delay: the pause before the echo returns makes a room sound like a valley.',
    ],
  }, () => ({
    bars: 24, atmosphere: 0.5,
    space: { type: 'hall', size: 1.8, tone: 0.42, preDelay: 0.06 },
    echo: { beats: 1.5, feedback: 0.45, tone: 0.3 },
    tracks: [
      { id: 'mist', name: 'Mountain wind', inst: 'texture', preset: 'wind', params: { tone: 0.4, motion: 0.55, density: 0.35 }, vol: -6, space: 0.15,
        clips: [clip(0, 24, [held('C4', 0, 95.5, 0.45)])] },
      { id: 'drone', name: 'Valley drone', inst: 'drone', preset: 'warm-sub', params: { body: 0.55, reed: 0.2, motion: 0.4, grit: 0 }, vol: -6, space: 0.2,
        clips: [clip(0, 24, [held('D2', 0, 95.5, 0.45), held('A2', 8, 87.5, 0.3)])] },
      { id: 'pad', name: 'Mist pad', inst: 'tapepad', preset: 'warm-pad', params: { warmth: 0.55, swell: 0.8, air: 0.3 }, vol: -5, space: 0.55,
        clips: [clip(0, 24, chords(['D3 A3 E4 F#4', 'B2 F#3 A3 D4', 'E3 B3 D4 F#4', 'A2 E3 B3 F#4', 'D3 A3 E4 F#4', 'B2 F#3 A3 D4'], { beats: 16, v: 0.32, strum: 0.2 }))] },
      { id: 'guzheng', name: 'Guzheng', inst: 'guzheng', preset: 'mountain-stream', vol: 0, pan: -0.1, space: 0.4, echo: 0.15,
        clips: [clip(0, 24, [
          ...gliss('D4 E4 F#4 A4 B4 D5 E5 F#5 A5', { at: 0, ring: 4 }),
          ...line('A4:1 B4:1 D5:2 E5:1 D5:1 B4:2 A4:4 -:4 F#4:1 A4:1 B4:2 A4:2 F#4:2 E4:4 D4:4', { at: 4, v: 0.5 }),
          ...gliss('D4 E4 F#4 A4 B4 D5 E5 F#5 A5 B5', { at: 48, ring: 4 }),
          ...line('D5:2 E5:1 F#5:1 A5:4 F#5:2 E5:2 D5:4 -:4 B4:2 A4:2 F#4:4 E4:2 D4:6', { at: 52, v: 0.5 }),
          ...gliss('A5 F#5 E5 D5 B4 A4 F#4 E4 D4', { at: 89, gap: 0.1, ring: 6, v: 0.32, rise: -0.015 }),
        ])] },
      { id: 'dizi', name: 'Dizi (far away)', inst: 'dizi', preset: 'qudi', vol: -5, pan: 0.25, space: 0.6, echo: 0.2,
        clips: [clip(8, 16, line('F#5:4 E5:4 D5:8 -:8 B4:4 D5:4 E5:8 -:8 A5:6 F#5:2 E5:8', { v: 0.4, legato: 0.96 }))] },
    ],
  })),

  recipe({
    id: 'shanghai-rooftop-lofi', title: 'Shanghai rooftop lofi', region: 'china', mood: 'Neon haze, warm tea, a city humming below',
    bpm: 78, key: 'E', scale: 'yu',
    steps: [
      'Yu mode is the minor-feeling Chinese pentatonic (E G A B D here). It is also the classic lofi scale, which is why it blends East and beat so easily.',
      'The chords come first, alone for 4 bars, and the drums enter at bar 5. Letting the mood settle before the beat is a lofi habit worth stealing.',
      'The groove is a janggu (Korean hourglass drum) played softly by hand: the low kung on 1 and the "and" of 3, the deok on 2 and 4, light tta taps on the eighths. It is the lofi kick-snare-hat pattern on a folk drum.',
      'Pipa (a lute) plays quick little runs; the erhu answers in bars 9-12 with slow notes. Fast against slow is call and response.',
      'Vinyl crackle under muted felt keys, a Cassette unit on the keys and a low warm pad give the "old record" warmth. The sub drone sits far down: you feel it more than hear it.',
    ],
  }, () => ({
    bars: 16, atmosphere: 0.55,
    space: { type: 'room', size: 0.9, tone: 0.4, preDelay: 0.015 },
    spaceDb: -2, echoDb: -5,
    echo: { beats: 0.75, feedback: 0.4, tone: 0.3 },
    tracks: [
      { id: 'crackle', name: 'Vinyl crackle', inst: 'texture', preset: 'vinyl-crackle', vol: -13, space: 0,
        clips: [clip(0, 16, [held('C4', 0, 63.75, 0.5)])] },
      { id: 'keys', name: 'Lofi keys', inst: 'felt', preset: 'muted-keys', params: { felt: 0.8, sustain: 0.45, wobble: 0.45 }, vol: -6, space: 0.25, echo: 0.08, fx: [tape({ drive: 0.2, age: 0.5, wow: 0.45, flutter: 0.25, hiss: 0.12 })],
        clips: [clip(0, 16, [0, 16, 32, 48].flatMap(at => [
          ...chords(['E3 G3 B3 D4', 'G2 D3 E3 B3', 'A2 D3 E3 G3', 'D3 A3 B3 E4'], { at, beats: 4, v: 0.4, strum: 0.03, hold: 0.55, fade: 0.03 }),
          ...chords(['E3 G3 B3 D4', 'G2 D3 E3 B3', 'A2 D3 E3 G3', 'D3 A3 B3 E4'], { at: at + 2.5, beats: 4, v: 0.26, strum: 0.03, hold: 0.32, fade: 0.03 }),
        ]))] },
      { id: 'pad', name: 'Haze pad', inst: 'tapepad', preset: 'warm-pad', params: { warmth: 0.7, swell: 0.6, air: 0.15 }, vol: -12, space: 0.4, echo: 0.04,
        clips: [clip(0, 16, chords(Array(4).fill(['E3 B3 D4', 'G3 B3 D4', 'A3 D4 E4', 'A3 B3 E4']).flat(), { beats: 4, v: 0.3, strum: 0.05, hold: 0.98 }))] },
      { id: 'drums', name: 'Janggu groove', inst: 'janggu', preset: 'soft-hand', vol: -8, space: 0.12, fx: [fx('eq', { low: 0, mid: 0, high: -3, lowcut: 40 })],
        clips: drumClips([4, 8, 12],
          [[36, 0, 0.6], [39, 0, 0.2], [39, 0.5, 0.13], [38, 1, 0.38], [39, 1.5, 0.13], [39, 2, 0.2], [36, 2.5, 0.45], [39, 2.5, 0.12], [38, 3, 0.42], [39, 3.5, 0.15]],
          [[36, 0, 0.6], [39, 0, 0.2], [39, 0.5, 0.13], [38, 1, 0.38], [39, 1.5, 0.13], [39, 2, 0.2], [36, 2.5, 0.45], [38, 3, 0.42], [40, 3.5, 0.2]]) },
      { id: 'bass', name: 'Sub drone', inst: 'drone', preset: 'warm-sub', params: { body: 0.55, reed: 0.05, motion: 0.25, grit: 0 }, vol: -12, space: 0.05,
        clips: [clip(4, 12, [0, 16, 32].flatMap(at => ['E2', 'G2', 'A2', 'D2'].map((nm, i) => held(nm, at + i * 4, 3.8, 0.5))))] },
      { id: 'pipa', name: 'Pipa', inst: 'pipa', preset: 'pipa', vol: -6, pan: -0.25, space: 0.25, echo: 0.2,
        clips: [clip(4, 12, line(
          'B4:0.5 D5:0.5 E5:1 D5:0.5 B4:0.5 A4:1 G4:1 E4:1 -:2 G4:0.5 A4:0.5 B4:1 D5:2 B4:1 A4:3 ' +
          '-:16 ' +
          'E5:0.5 D5:0.5 B4:1 A4:0.5 B4:0.5 D5:1 E5:2 G5:1 E5:1 D5:1 B4:3 -:4', { v: 0.48, legato: 0.85 }))] },
      { id: 'erhu', name: 'Erhu', inst: 'erhu', preset: 'night-erhu', vol: -7, pan: 0.25, space: 0.35, echo: 0.1,
        clips: [clip(8, 8, line('D5:2 B4:2 A4:4 G4:2 A4:2 E4:4 B4:8@0.3 A4:8@0.3', { v: 0.42, legato: 0.97 }))] },
    ],
  })),

  recipe({
    id: 'west-lake-moonrise', title: 'West Lake moonrise', region: 'china', mood: 'Silver water, a slow boat, the moon coming up',
    bpm: 58, key: 'E', scale: 'shang',
    steps: [
      'Shang mode (E F# A B D here) is the same five Chinese notes as gong mode, started from the second note. Changing the home note changes the mood: this one floats.',
      'The guzheng rolls slow arpeggios, one note per beat. A steady, unhurried pulse sounds like oars on water.',
      'The erhu enters at bar 5 with a big Space send (0.5). Reverb makes a sound feel bigger without turning it up.',
      'The temple bell strikes only on bars 1, 9 and 17, marking the big sections. Big moments need room around them.',
      'The Space bus is a shimmer hall (shimmer 0.25) for moonlight; the glass-bow strings play soft velocities underneath, like a horizon line.',
    ],
  }, () => ({
    bars: 20, atmosphere: 0.5,
    space: { type: 'hall', size: 1.6, tone: 0.45, preDelay: 0.035, shimmer: 0.25 },
    echo: { beats: 1, feedback: 0.45, tone: 0.3 },
    tracks: [
      { id: 'lake', name: 'Lake water', inst: 'texture', preset: 'ocean', params: { tone: 0.3, motion: 0.3, density: 0.35 }, vol: -7, space: 0.1,
        clips: [clip(0, 20, [held('C4', 0, 79.5, 0.45)])] },
      { id: 'drone', name: 'Low E', inst: 'drone', preset: 'warm-sub', params: { body: 0.55, motion: 0.35, grit: 0 }, vol: -5, space: 0.2,
        clips: [clip(0, 20, [held('E2', 0, 79.5, 0.45), held('B2', 16, 63.5, 0.28)])] },
      { id: 'strings', name: 'Glass strings', inst: 'strings', preset: 'glass-bow', params: { bright: 0.25 }, vol: -4, space: 0.55,
        clips: [clip(0, 20, chords(['E3 B3 D4 F#4', 'A2 E3 B3 D4', 'D3 A3 B3 E4', 'B2 F#3 A3 E4', 'E3 B3 D4 F#4'], { beats: 16, v: 0.34, strum: 0.25 }))] },
      { id: 'guzheng', name: 'Guzheng rolls', inst: 'guzheng', preset: 'silk-rain', vol: 0, pan: -0.2, space: 0.4, echo: 0.1,
        clips: [clip(0, 20, arp(['E4 B4 D5 F#5', 'A3 E4 B4 D5', 'D4 A4 B4 E5', 'B3 F#4 A4 E5', 'E4 B4 D5 F#5'],
          { beats: 16, step: 1, order: [0, 1, 2, 3, 2, 1, 2, 1], v: 0.3, accent: 0.06, d: 2.5 }))] },
      { id: 'erhu', name: 'Erhu', inst: 'erhu', preset: 'moon-over-spring', vol: 0, pan: 0.15, space: 0.5, echo: 0.1,
        clips: [clip(4, 16, line(
          'B4:4 D5:2 E5:2 F#5:6 E5:2 D5:4 B4:4 -:8 ' +
          'A4:2 B4:2 D5:4 B4:2 A4:2 F#4:4 E4:8 -:8', { v: 0.42, legato: 0.98 }))] },
      { id: 'bell', name: 'Temple bell', inst: 'templebells', preset: 'temple-bell', vol: -2, space: 0.6, echo: 0.05,
        clips: [clip(0, 20, [held('E4', 0, 12, 0.42), held('E4', 32, 12, 0.4), held('E4', 64, 14, 0.42)])] },
    ],
  })),

  // ============================================================ JAPAN
  recipe({
    id: 'kyoto-temple-morning', title: 'Kyoto temple morning', region: 'japan', mood: 'Cool air, swept stone, a bell before breakfast',
    bpm: 60, key: 'D', scale: 'yo',
    steps: [
      'The Yo scale (D E G A B here) is the bright Japanese folk scale. It has no half steps, so it sounds open and outdoorsy.',
      'The temple bell strikes every 4 bars on a low D. One deep, regular sound gives the piece a slow heartbeat.',
      'The koto melody uses "ma": the rests are part of the music. Notice each phrase ends with a held note and then silence.',
      'The pad is three notes per chord, 5 dB under the koto. It fills the gaps between koto notes without anyone noticing it.',
      'The Space bus is a cathedral (size 1.2): bells love a long room because their ring blooms into it.',
    ],
  }, () => ({
    bars: 16, atmosphere: 0.5,
    space: { type: 'cathedral', size: 1.2, tone: 0.45, preDelay: 0.03 },
    echo: { beats: 1.5, feedback: 0.4, tone: 0.3 },
    tracks: [
      { id: 'air', name: 'Morning air', inst: 'texture', preset: 'wind', params: { tone: 0.3, motion: 0.4, density: 0.25 }, vol: -8, space: 0.1,
        clips: [clip(0, 16, [held('C4', 0, 63.5, 0.45)])] },
      { id: 'bell', name: 'Temple bell', inst: 'templebells', preset: 'temple-bell', vol: -2, space: 0.5,
        clips: [clip(0, 16, [0, 16, 32, 48].map(s => held('D3', s, 12, 0.45)))] },
      { id: 'koto', name: 'Koto', inst: 'koto', preset: 'koto', vol: 0, pan: -0.15, space: 0.35, echo: 0.15,
        clips: [clip(0, 16, line('-:2 ' +
          'A4:1 B4:1 D5:2 -:2 E5:1 D5:1 B4:4 -:4 ' +
          'G4:1 A4:1 B4:2 A4:1 G4:1 E4:2 D4:4 -:4 ' +
          'D5:1 E5:1 G5:2 E5:2 D5:2 B4:4 -:4 ' +
          'A4:2 B4:1 A4:1 G4:2 E4:2 D4:6', { v: 0.5 }))] },
      { id: 'pad', name: 'Paper pad', inst: 'tapepad', preset: 'warm-pad', params: { warmth: 0.6, swell: 0.75, air: 0.25 }, vol: -5, space: 0.5,
        clips: [clip(0, 16, chords(['D3 A3 E4', 'G2 D3 A3', 'B2 E3 A3', 'A2 D3 E3'], { beats: 16, v: 0.34, strum: 0.2 }))] },
      { id: 'drone', name: 'Floor drone', inst: 'drone', preset: 'warm-sub', params: { body: 0.5, motion: 0.3, grit: 0 }, vol: -7, space: 0.15,
        clips: [clip(0, 16, [held('D2', 0, 63.5, 0.42)])] },
    ],
  })),

  recipe({
    id: 'bamboo-forest-shakuhachi', title: 'Bamboo forest shakuhachi', region: 'japan', mood: 'Green shade, tall stalks creaking, one breath at a time',
    bpm: 54, key: 'E', scale: 'in',
    steps: [
      'The In scale (E F A B C here) is the dark, sweet Japanese scale. The half step E-F is what makes it sound like old Japan.',
      'The shakuhachi plays one long breath, then rests. Each phrase is about as long as a real breath, which makes it feel human.',
      'The koto answers only inside the shakuhachi\'s rests (beats 18, 34 and 58). Two voices taking turns never get crowded.',
      'Wind on the Textures track with high Motion (0.7) sounds like bamboo swaying: the gusts give the piece a slow pulse.',
      'The tempo is only 54 BPM. Slow tempos stretch every note, and the echo (1.5 beats) lands far enough away to sound like the forest answering.',
    ],
  }, () => ({
    bars: 16, atmosphere: 0.5,
    space: { type: 'hall', size: 1.7, tone: 0.42, preDelay: 0.05 },
    echo: { beats: 1.5, feedback: 0.45, tone: 0.3 },
    tracks: [
      { id: 'wind', name: 'Bamboo wind', inst: 'texture', preset: 'wind', params: { tone: 0.45, motion: 0.7, density: 0.45 }, vol: -5, space: 0.15,
        clips: [clip(0, 16, [held('C4', 0, 63.5, 0.5)])] },
      { id: 'drone', name: 'Earth drone', inst: 'drone', preset: 'low-hum', params: { body: 0.55, reed: 0.3, motion: 0.6, grit: 0.15 }, vol: -8, space: 0.15,
        clips: [clip(0, 16, [held('E2', 0, 63.5, 0.42)])] },
      { id: 'shakuhachi', name: 'Shakuhachi', inst: 'shakuhachi', preset: 'honkyoku', vol: 0, pan: 0.1, space: 0.45, echo: 0.2,
        clips: [clip(0, 16, line(
          '-:4 B4:6 C5:2 B4:4 -:4 A4:3 F4:1 E4:8 -:4 ' +
          'E5:4 C5:2 B4:2 A4:6 -:2 F4:2 E4:6 -:4', { v: 0.45, legato: 0.97 }))] },
      { id: 'koto', name: 'Koto answers', inst: 'koto', preset: 'oshide-koto', vol: -2, pan: -0.25, space: 0.35, echo: 0.2,
        clips: [clip(0, 16, line('E4:0.5 F4:0.5 B4:1 E5:2 -:14 C5:0.5 B4:0.5 A4:3 -:12 F4:0.5 A4:0.5 B4:3 -:20 E5:0.5 C5:0.5 B4:1 E4:4', { v: 0.45 }))] },
      { id: 'chimes', name: 'Bamboo chimes', inst: 'windchimes', preset: 'bamboo-chimes', params: { tuning: 'in', density: 0.25, wind: 0.5 }, vol: -7, pan: 0.35, space: 0.5,
        clips: [clip(0, 16, [held('E4', 0, 63.5, 0.35)])] },
    ],
  })),

  recipe({
    id: 'okinawa-evening-tide', title: 'Okinawa evening tide', region: 'japan', mood: 'Warm sunset, island songs, the tide going out',
    bpm: 76, key: 'C', scale: 'ryukyu',
    steps: [
      'The Ryukyu scale (C E F G B) comes from Okinawa. It skips D and A, which gives island songs their sunny, swaying sound.',
      'The pad changes chord every 2 bars and ends on G7 (G B F) leading back to Cmaj7: a cadence makes the loop feel like it comes home.',
      'The shamisen plays short, bouncy notes. Plucked instruments die away fast, so they can play more notes than a flute without crowding.',
      'The taiko plays one big hit and two small ones per bar from bar 5, all soft. Even a festival drum can be ambient if you keep its velocity low (0.2-0.45).',
      'Ocean and wind chimes are the "place". Remove them and you have a song; add them back and you are on the beach.',
    ],
  }, () => ({
    bars: 16, atmosphere: 0.5,
    space: { type: 'hall', size: 1.3, tone: 0.5, preDelay: 0.025 },
    tracks: [
      { id: 'ocean', name: 'Evening tide', inst: 'texture', preset: 'ocean', params: { tone: 0.42, motion: 0.6, density: 0.45 }, vol: -4, space: 0.1,
        clips: [clip(0, 16, [held('C4', 0, 63.5, 0.5)])] },
      { id: 'pad', name: 'Sunset pad', inst: 'tapepad', preset: 'warm-pad', params: { warmth: 0.6, swell: 0.6, air: 0.25 }, vol: -3, space: 0.45,
        clips: [clip(0, 16, chords(['C3 G3 B3 E4', 'F2 C3 G3 E4', 'E3 G3 B3 E4', 'G2 F3 B3 E4', 'C3 G3 B3 E4', 'F2 C3 G3 E4', 'E3 G3 B3 E4', 'G2 F3 B3 E4'], { beats: 8, v: 0.34, strum: 0.1 }))] },
      { id: 'shamisen', name: 'Shamisen', inst: 'shamisen', preset: 'sanshin', vol: 0, pan: -0.15, space: 0.3, echo: 0.15,
        clips: [clip(0, 16, line('-:8 ' +
          'C5:1 E5:1 F5:1 G5:1 B5:2 G5:1 F5:1 E5:2 C5:2 -:4 ' +
          'G4:1 B4:1 C5:2 E5:1 C5:1 B4:2 G4:4 -:4 ' +
          'E5:1 F5:1 G5:2 F5:1 E5:1 C5:2 B4:1 G4:1 C5:4 -:2 ' +
          'E4:1 F4:1 G4:2 C5:4', { v: 0.48, legato: 0.8 }))] },
      { id: 'taiko', name: 'Soft taiko', inst: 'taiko', preset: 'soft-mallets', vol: -3, space: 0.2,
        clips: drumClips([4, 8, 12], [[36, 0, 0.45], [38, 2, 0.3], [38, 3.5, 0.2]], [[36, 0, 0.45], [38, 2, 0.3], [36, 3, 0.35], [38, 3.5, 0.22]]) },
      { id: 'chimes', name: 'Glass furin', inst: 'windchimes', preset: 'glass-furin', params: { tuning: 'pair', density: 0.3 }, vol: -6, pan: 0.3, space: 0.5,
        clips: [clip(0, 16, [held('C4', 0, 63.5, 0.35)])] },
    ],
  })),

  // ============================================================ AMBIENT BASICS
  recipe({
    id: 'first-ambient-101', title: 'First ambient track 101', region: 'ambient', mood: 'Simple, warm, the three layers every ambient track needs',
    bpm: 60, key: 'C', scale: 'major',
    steps: [
      'Layer 1, the drone: one low note (C2) held the whole time. It is the floor everything else stands on. Mute it once and hear how the track loses its ground.',
      'Layer 2, the pad: four chords (Cmaj7, Am7, Fmaj7, G6), each held for 4 bars. Slow chords are the weather of the track.',
      'Layer 3, the melody: a felt piano plays just 3-5 notes every 4 bars from bar 5. In ambient music, fewer notes means each one matters more.',
      'The reverb is not on the tracks: each track sends some sound to the shared Space bus (pad 0.5, piano 0.45). One room for everyone makes them sound like one place.',
      'The piano also sends to the Echo bus (0.2): its echoes fill the gaps you left, so you do not have to.',
      'Your turn: draw a new note in the piano clip. Scale lock keeps it in C major, so it will always fit.',
    ],
  }, () => ({
    bars: 16, atmosphere: 0.5,
    space: { type: 'hall', size: 1.4, tone: 0.45, preDelay: 0.03 },
    tracks: [
      { id: 'drone', name: '1 Drone', inst: 'drone', preset: 'warm-sub', params: { body: 0.6, reed: 0.15, motion: 0.35, grit: 0.05 }, vol: -4, space: 0.15,
        clips: [clip(0, 16, [held('C2', 0, 63.5, 0.5), held('G2', 32, 31.5, 0.3)])] },
      { id: 'pad', name: '2 Pad', inst: 'tapepad', preset: 'warm-pad', params: { warmth: 0.6, swell: 0.7, air: 0.2 }, vol: -2, space: 0.5, echo: 0.05,
        clips: [clip(0, 16, chords(['C3 G3 B3 E4', 'A2 E3 G3 C4', 'F2 C3 E3 A3', 'G2 D3 E3 B3'], { beats: 16, v: 0.36, strum: 0.1 }))] },
      { id: 'piano', name: '3 Melody', inst: 'felt', preset: 'felt-upright', params: { sustain: 0.65, wobble: 0.3 }, vol: 0, space: 0.45, echo: 0.2,
        clips: [clip(4, 12, line('E5:2 D5:2 C5:4 -:8 C5:2 B4:2 G4:4 -:8 A4:2 B4:2 C5:4 E5:4 -:4', { v: 0.5 }))] },
    ],
  })),

  recipe({
    id: 'sleepy-rain-pad', title: 'Sleepy rain pad', region: 'ambient', mood: 'Blanket, window, rain, eyes closing',
    bpm: 56, key: 'F', scale: 'major',
    steps: [
      'Rain on glass, a little under the pad, is the bed. Natural noise covers silence gently, so the music can be very sparse on top.',
      'The pad has Swell at 0.8: each chord fades in over a few seconds instead of starting with an edge. No edges is what sleepy sounds like.',
      'The chords (Fmaj7, Dm9, Bbmaj7, C6) all have 4-5 notes. Sevenths and ninths sound soft and unresolved, which keeps the mood floating.',
      'The music box melody starts at bar 5 and sends a lot to the Echo bus (0.35). A bright, small sound plus echo sounds like a lullaby far away.',
      'Cassette hiss at -17 dB, 12 dB under everything else, is barely there. It glues the layers into one warm recording; mute it and the mix gets colder.',
    ],
  }, () => ({
    bars: 16, atmosphere: 0.55,
    space: { type: 'hall', size: 1.4, tone: 0.38, preDelay: 0.03 },
    echo: { beats: 1, feedback: 0.5, tone: 0.3 },
    tracks: [
      { id: 'rain', name: 'Rain on glass', inst: 'texture', preset: 'rain-on-glass', vol: -5, space: 0.1,
        clips: [clip(0, 16, [held('C4', 0, 63.5, 0.5)])] },
      { id: 'pad', name: 'Sleepy pad', inst: 'tapepad', preset: 'warm-pad', params: { warmth: 0.7, swell: 0.8, air: 0.15 }, vol: -2, space: 0.45, echo: 0.04, fx: [fx('chorus', { rate: 0.2, depth: 0.45, mix: 0.35 })],
        clips: [clip(0, 16, chords(['F2 C3 E3 A3', 'D3 F3 A3 C4 E4', 'Bb2 F3 A3 D4', 'C3 G3 A3 E4'], { beats: 16, v: 0.36, strum: 0.15 }))] },
      { id: 'musicbox', name: 'Music box', inst: 'musicbox', preset: 'music-box', params: { shine: 0.45, ring: 0.6, wobble: 0.35 }, vol: -6, space: 0.45, echo: 0.35,
        clips: [clip(4, 12, line('A5:1 G5:1 F5:2 C5:4 -:8 D5:1 E5:1 F5:2 A5:4 -:8 G5:1 F5:1 E5:2 C5:2 F5:4 -:4', { v: 0.45 }))] },
      { id: 'hiss', name: 'Cassette hiss', inst: 'texture', preset: 'cassette-hiss', vol: -17, space: 0,
        clips: [clip(0, 16, [held('C4', 0, 63.5, 0.4)])] },
    ],
  })),

  recipe({
    id: 'song-cloud-dream', title: 'Song cloud dream', region: 'ambient', mood: 'Nico\'s own song, frozen into a glowing haze',
    bpm: 66, key: 'A', scale: 'major',
    steps: [
      'The Song Cloud plays tiny grains of "After the Storm" (0.55 s each, 12 per second). Frozen, the grains repeat one moment, so the song becomes a chord.',
      'The cloud plays MIDI 60 (the song\'s own pitch), then adds 48 an octave lower at bar 5. That is why this recipe is in A major: it matches the song.',
      'The drone holds a low A2 under everything. Under a cloud, a plain low note stops the haze from feeling weightless.',
      'Glass-bow strings play long chords from bar 5. They sit 4 dB under the cloud: the cloud is the star, the strings only colour it.',
      'The Space bus is a cathedral with shimmer 0.3. Try moving the cloud\'s Position knob: every spot in the song gives a new chord.',
    ],
  }, () => ({
    bars: 16, atmosphere: 0.5,
    space: { type: 'cathedral', size: 1.1, tone: 0.5, preDelay: 0.04, shimmer: 0.3 },
    echo: { beats: 0.75, feedback: 0.55, tone: 0.35 },
    tracks: [
      { id: 'cloud', name: 'Storm cloud', inst: 'cloud', preset: 'frozen-tape',
        params: { song: 'after-the-storm', position: 0.42, size: 0.55, density: 12, spray: 0.06, tone: 0.42, width: 0.85, attack: 4, level: 1 },
        vol: 0, space: 0.45, echo: 0.05, fx: [fx('filter', { mode: 'lowpass', cutoff: 3200, resonance: 0.5, motion: 0.35, rate: 0.05 })],
        clips: [clip(0, 16, [held('C4', 0, 63.5, 0.45), held('C3', 16, 40, 0.3)])] },
      { id: 'drone', name: 'Low A', inst: 'drone', preset: 'warm-sub', params: { body: 0.6, reed: 0.1, motion: 0.4, grit: 0.05 }, vol: -5, space: 0.15,
        clips: [clip(0, 16, [held('A2', 0, 63.5, 0.45)])] },
      { id: 'strings', name: 'Glass strings', inst: 'strings', preset: 'glass-bow', params: { bright: 0.3 }, vol: -4, space: 0.5,
        clips: [clip(4, 12, chords(['A2 E3 G#3 B3 C#4', 'F#2 C#3 E3 A3', 'D3 A3 C#4 F#4', 'E2 B2 C#3 G#3', 'A2 E3 G#3 B3 C#4', 'F#2 C#3 E3 A3'], { beats: 8, v: 0.32, strum: 0.2 }))] },
      { id: 'piano', name: 'High piano', inst: 'felt', preset: 'felt-upright', params: { felt: 0.8, sustain: 0.7, wobble: 0.4 }, vol: -4, space: 0.45, echo: 0.3,
        clips: [clip(8, 8, line('C#6:2 B5:2 A5:4 -:8 E5:2 F#5:2 G#5:4 -:4 A5:4', { v: 0.42 }))] },
    ],
  })),
];

export const recipeById = id => RECIPES.find(r => r.id === id) || null;
/** A fresh, independent copy of a recipe's project, ready to load or save as the user's own. */
export function recipeProject(id, now = Date.now()) {
  const r = typeof id === 'string' ? recipeById(id) : id;
  if (!r) return null;
  const p = JSON.parse(JSON.stringify(r.project));
  p.id = `${p.id}-${now.toString(36)}`; p.createdAt = now; p.updatedAt = now;
  return p;
}
