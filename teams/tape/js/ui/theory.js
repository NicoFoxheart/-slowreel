// theory.js - scales, chord stamps and note names for the piano roll, keys and pads.
import { ASIAN_SCALES } from '../sound/asian.js?v=10';
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const KEYS = NOTE_NAMES;

export const SCALES = [
  { id: 'major', name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'lydian', name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'dorian', name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'mixolydian', name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'major-penta', name: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  { id: 'minor-penta', name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  { id: 'chromatic', name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: 'in-sen', name: 'In-sen', region: 'Japanese', steps: [0, 1, 5, 7, 10] },
];
// East Asian scales (js/sound/asian.js), grouped by region after the ambient set. Hirajoshi lives there now.
for (const sc of ASIAN_SCALES) if (!SCALES.some(x => x.id === sc.id)) SCALES.push({ id: sc.id, name: sc.name, region: sc.region, steps: [...sc.intervals] });
export const SCALE_REGIONS = ['', 'Korean', 'Chinese', 'Japanese'];
/** Scales grouped for a <select>: [{region, label, scales}] (region '' = the ambient set). */
export const scaleGroups = () => SCALE_REGIONS.map(r => ({ region: r, label: r || 'Ambient', scales: SCALES.filter(s => (s.region || '') === r) })).filter(g => g.scales.length);

// Chord stamps: intervals from the clicked note. Voiced open, the way pads like them.
export const CHORDS = [
  { id: 'off', name: 'Single note', iv: [0] },
  { id: 'maj7', name: 'maj7', iv: [0, 4, 7, 11] },
  { id: 'add9', name: 'add9', iv: [0, 4, 7, 14] },
  { id: 'sus2', name: 'sus2', iv: [0, 2, 7] },
  { id: 'min9', name: 'min9', iv: [0, 3, 7, 10, 14] },
  { id: '69', name: '6/9', iv: [0, 4, 9, 14] },
  { id: 'open5', name: 'Open fifths', iv: [0, 7, 14, 19] },
  { id: 'quartal', name: 'Quartal', iv: [0, 5, 10, 15] },
];

export const keyIndex = key => Math.max(0, NOTE_NAMES.indexOf(String(key || 'C').replace('b', '#').replace(/m$/, '')));
export const scaleById = id => SCALES.find(s => s.id === id) || SCALES[0];
export const noteName = m => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const isBlack = m => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

export function inScale(m, key, scaleId) {
  const st = scaleById(scaleId).steps, k = keyIndex(key);
  return st.includes((((m - k) % 12) + 12) % 12);
}
/** Nearest note in the scale (ties go down). */
export function snapToScale(m, key, scaleId) {
  for (let d = 0; d < 12; d++) {
    if (inScale(m - d, key, scaleId)) return m - d;
    if (inScale(m + d, key, scaleId)) return m + d;
  }
  return m;
}
/** n notes of the scale upward from the key root in the given octave (for pads). */
export function scaleRun(key, scaleId, octave, n) {
  const st = scaleById(scaleId).steps, root = 12 * (octave + 1) + keyIndex(key), out = [];
  for (let i = 0; out.length < n; i++) out.push(root + 12 * Math.floor(i / st.length) + st[i % st.length]);
  return out;
}
/** Chord stamp; with scale lock each tone is pulled into the scale. */
export function chordNotes(root, chordId, lock, key, scaleId) {
  const c = CHORDS.find(x => x.id === chordId) || CHORDS[0];
  const set = new Set(c.iv.map(i => (lock ? snapToScale(root + i, key, scaleId) : root + i)));
  return [...set].filter(m => m >= 0 && m <= 127);
}
