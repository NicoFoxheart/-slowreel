// Music theory helpers for the UI: scales, chord stamps, note names, QWERTY map.
export const SCALES = [
  { id: 'major', name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'lydian', name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'dorian', name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'mixolydian', name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'majpent', name: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  { id: 'minpent', name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  { id: 'insen', name: 'In-sen', steps: [0, 1, 5, 7, 10] },
  { id: 'hirajoshi', name: 'Hirajoshi', steps: [0, 2, 3, 7, 8] },
  { id: 'chromatic', name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];
// Chord stamps: intervals from the clicked root. "Window" and "Streetlight" are the rain team's own voicings.
export const CHORDS = [
  { id: 'single', name: 'Note', iv: [0] },
  { id: 'maj7', name: 'maj7', iv: [0, 4, 7, 11] },
  { id: 'add9', name: 'add9', iv: [0, 4, 7, 14] },
  { id: 'sus2', name: 'sus2', iv: [0, 2, 7] },
  { id: 'min9', name: 'min9', iv: [0, 3, 7, 10, 14] },
  { id: '69', name: '6/9', iv: [0, 4, 9, 14] },
  { id: 'window', name: 'Window', iv: [0, 7, 14, 16, 23] },      // open maj9 spread over two octaves
  { id: 'streetlight', name: 'Streetlight', iv: [0, 5, 10, 15] }, // stacked fourths
];
export const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function keyIdx(k) { const s = String(k || 'C'); const flat = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' }; const n = flat[s] || s; const i = KEYS.indexOf(n); return i < 0 ? 0 : i; }
export const noteName = m => KEYS[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const isBlack = m => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
export function inScale(m, key, scaleId) {
  const sc = SCALES.find(s => s.id === scaleId) || SCALES[0];
  return sc.steps.includes(((m - keyIdx(key)) % 12 + 12) % 12);
}
export function snapToScale(m, key, scaleId) {
  if (inScale(m, key, scaleId)) return m;
  for (let d = 1; d < 7; d++) { if (inScale(m - d, key, scaleId)) return m - d; if (inScale(m + d, key, scaleId)) return m + d; }
  return m;
}
// Scale degrees from a root for pads: n notes going up
export function scaleRun(rootMidi, key, scaleId, n) {
  const out = []; let m = snapToScale(rootMidi, key, scaleId);
  while (out.length < n && m < 128) { if (inScale(m, key, scaleId)) out.push(m); m++; }
  return out;
}
// QWERTY piano: two rows like most DAWs. Returns semitone offset from the current octave's C.
export const QWERTY = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17 };
export const QWERTY_LABEL = { KeyA: 'A', KeyW: 'W', KeyS: 'S', KeyE: 'E', KeyD: 'D', KeyF: 'F', KeyT: 'T', KeyG: 'G', KeyY: 'Y', KeyH: 'H', KeyU: 'U', KeyJ: 'J', KeyK: 'K', KeyO: 'O', KeyL: 'L', KeyP: 'P', Semicolon: ';', Quote: "'" };
