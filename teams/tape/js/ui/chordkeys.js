// chordkeys.js - "Chord keys": while it is on, one computer key plays a whole chord (or a second voice) built from the
// tape's key and scale. The key Nico presses always sounds as pressed; the helper notes come from the scale around it.
// On/off and the style are remembered per viewer (localStorage), never in the project.
import { scaleById, keyIndex, snapToScale } from './theory.js?v=10b';

export const CHORD_STYLES = [
  { id: 'chord', name: 'Chord', tip: 'A soft three-note chord from the scale.' },
  { id: 'lush', name: 'Lush', tip: 'A wide chord with a low root underneath: lovely on pads.' },
  { id: 'fifths', name: 'Fifths', tip: 'Root, fifth and octave: open and calm.' },
  { id: 'octave', name: 'Octaves', tip: 'The note and the same note an octave up.' },
  { id: 'harmony', name: 'Harmony', tip: 'A second voice a scale-third above your melody.' },
];
const LS = { on: 'slowreel:chordkeys', style: 'slowreel:chordstyle' };
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { } };

export const CK = {
  on: get(LS.on) === 'on',
  style: CHORD_STYLES.some(s => s.id === get(LS.style)) ? get(LS.style) : 'chord',
};
export function setChordKeys(on) { CK.on = !!on; set(LS.on, CK.on ? 'on' : 'off'); }
export function setChordStyle(id) { if (CHORD_STYLES.some(s => s.id === id)) { CK.style = id; set(LS.style, id); } }
export const styleById = id => CHORD_STYLES.find(s => s.id === id) || CHORD_STYLES[0];

/** k scale steps above the in-scale note n (k may go past the octave). */
function stepUp(n, k, steps, root) {
  const pc = (((n - root) % 12) + 12) % 12, i = steps.indexOf(pc);
  if (i < 0) return n;
  const j = i + k, oct = Math.floor(j / steps.length);
  return n - pc + steps[((j % steps.length) + steps.length) % steps.length] + 12 * oct;
}

/** The helper notes for pressed note m (m itself is not included). */
export function chordExtras(m, key, scaleId, style = CK.style) {
  const steps = [...scaleById(scaleId).steps].sort((a, b) => a - b), root = keyIndex(key);
  const r = snapToScale(m, key, scaleId), up = k => stepUp(r, k, steps, root);
  let out;
  switch (style) {
    case 'lush': out = [r - 12, up(2), up(4), up(steps.length >= 7 ? 6 : 5)]; break;
    case 'fifths': out = [snapToScale(r + 7, key, scaleId), m + 12]; break;
    case 'octave': out = [m + 12]; break;
    case 'harmony': out = [up(2)]; break;
    default: out = [up(2), up(4)];
  }
  return [...new Set(out)].filter(n => n !== m && n >= 12 && n <= 120);
}
