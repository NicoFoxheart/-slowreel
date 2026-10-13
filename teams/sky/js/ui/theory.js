// theory.js - scales, chord stamps and note names for the piano roll, keys and pads.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const KEYS = NOTE_NAMES;

export const SCALES = {
  major:            { name: 'Major',            steps: [0, 2, 4, 5, 7, 9, 11] },
  minor:            { name: 'Minor',            steps: [0, 2, 3, 5, 7, 8, 10] },
  lydian:           { name: 'Lydian',           steps: [0, 2, 4, 6, 7, 9, 11] },
  dorian:           { name: 'Dorian',           steps: [0, 2, 3, 5, 7, 9, 10] },
  mixolydian:       { name: 'Mixolydian',       steps: [0, 2, 4, 5, 7, 9, 10] },
  'major-pentatonic': { name: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  'minor-pentatonic': { name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  'in-sen':         { name: 'In-sen',           steps: [0, 1, 5, 7, 10] },
  hirajoshi:        { name: 'Hirajoshi',        steps: [0, 2, 3, 7, 8] },
  chromatic:        { name: 'Chromatic',        steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

// Chord stamps: intervals from the clicked root. Spread voicings sound better under reverb.
export const CHORDS = {
  single: { name: 'Single note', iv: [0] },
  maj7:   { name: 'maj7',  iv: [0, 4, 7, 11] },
  add9:   { name: 'add9',  iv: [0, 4, 7, 14] },
  sus2:   { name: 'sus2',  iv: [0, 2, 7] },
  min9:   { name: 'min9',  iv: [0, 3, 7, 10, 14] },
  '6/9':  { name: '6/9',   iv: [0, 4, 9, 14] },
  min7:   { name: 'min7',  iv: [0, 3, 7, 10] },
  open5:  { name: 'Open fifths', iv: [0, 7, 14, 19] },
};

export const keyIndex = key => Math.max(0, NOTE_NAMES.indexOf(key || 'C'));
export const noteName = m => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

export function inScale(midi, key, scale) {
  const s = SCALES[scale] || SCALES.major;
  return s.steps.includes((((midi - keyIndex(key)) % 12) + 12) % 12);
}
export const isRoot = (midi, key) => (((midi - keyIndex(key)) % 12) + 12) % 12 === 0;

/** Nearest in-scale pitch (ties go down). */
export function snapToScale(midi, key, scale) {
  if (inScale(midi, key, scale)) return midi;
  for (let d = 1; d < 12; d++) { if (inScale(midi - d, key, scale)) return midi - d; if (inScale(midi + d, key, scale)) return midi + d; }
  return midi;
}
/** Move by n scale steps (n may be negative). */
export function stepInScale(midi, n, key, scale) {
  let m = snapToScale(midi, key, scale); const dir = Math.sign(n);
  for (let i = 0; i < Math.abs(n); i++) { do { m += dir; } while (!inScale(m, key, scale)); }
  return m;
}
/** The first `count` scale notes from `fromMidi` upward (pads). */
export function scaleRun(fromMidi, count, key, scale) {
  const out = []; let m = snapToScale(fromMidi, key, scale);
  if (m < fromMidi) m = stepInScale(m, 1, key, scale);
  while (out.length < count) { out.push(m); m = stepInScale(m, 1, key, scale); }
  return out;
}
/** Chord notes for a stamp; with scale lock, each tone is pulled into the scale. */
export function chordNotes(root, chord, key, scale, lock) {
  const iv = (CHORDS[chord] || CHORDS.single).iv;
  const out = iv.map(i => (lock ? snapToScale(root + i, key, scale) : root + i));
  return [...new Set(out)];
}
