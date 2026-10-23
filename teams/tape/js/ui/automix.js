// automix.js - Auto mix: every instrument track gets its mix from its role (level, a gentle pan spread, Space and Echo sends,
// a gentle low cut on non-bass tracks, a short room on drums), and the tape gets a fitting Space reverb from its style,
// scale and tempo. Pure functions over the project JSON (no DOM, no engine), cheap enough to run on every edit, and
// idempotent: running it twice changes nothing the second time.
//
// Nico's songs are never touched: song clip tracks are skipped entirely; a song cloud keeps its level, pan, EQ and
// effects and only gets a modest Space send. A control Nico moves becomes "manual" (track.mixManual[key] = true) and
// Auto mix leaves it alone until "Re-mix automatically" clears the flags. Saved in the project:
//   project.autoMix = { on }   buses.space.manual (Nico edited the Space reverb)   track.mixManual = { volumeDb, pan, space, echo, lowcut, room }
//   track.fx[i].auto = 'lowcut' | 'room'     (the inserts Auto mix owns)
// Projects without project.autoMix were made before Auto mix: they load unchanged (see rhythm.js for when it runs).

import { grooveById } from './grooves.js?v=10a';

export const MIX_KEYS = ['volumeDb', 'pan', 'space', 'echo', 'lowcut', 'room'];

// role of each instrument (the instrument's kind decides for anything new)
const ROLE_OF = {
  tapepad: 'pad', strings: 'pad', supersaw: 'pad', analog: 'pad', voxpad: 'pad',
  drone: 'drone', texture: 'texture', cloud: 'cloud',
  felt: 'keys', fmkeys: 'keys', chop: 'keys',
  pluck: 'pluck', synthpluck: 'pluck', gayageum: 'pluck', guzheng: 'pluck', koto: 'pluck', pipa: 'pluck', shamisen: 'pluck',
  musicbox: 'bells', templebells: 'bells', windchimes: 'bells',
  lead: 'lead', erhu: 'lead', haegeum: 'lead', daegeum: 'lead', dizi: 'lead', shakuhachi: 'lead',
  femchoir: 'voice', solovoice: 'voice', vocalchops: 'voice', breathvox: 'voice', angelpad: 'voice',
  drums: 'drums', janggu: 'drums', taiko: 'drums',
  bass808: 'bass', synthbass: 'bass',
};
// vol = fader dB before the instrument trim (set so a typical tape lands near -20 to -18 LUFS, peaks well under -3 dBFS); space/echo = sends; lowcut Hz (null = none); pan = spread width
export const ROLES = {
  pad:     { vol: -8, space: 0.62, echo: 0.08, lowcut: 140, pan: 0.22, label: 'Pad: further back and wet' },
  texture: { vol: -10, space: 0.45, echo: 0, lowcut: 160, pan: 0, label: 'Texture: a bed far back' },
  drone:   { vol: -8, space: 0.28, echo: 0, lowcut: null, pan: 0, label: 'Drone: low and centred' },
  keys:    { vol: -4, space: 0.36, echo: 0.14, lowcut: 90, pan: 0.18, label: 'Keys: clear, a little drier' },
  pluck:   { vol: -4, space: 0.34, echo: 0.16, lowcut: 100, pan: 0.28, label: 'Pluck: clear, a little drier' },
  bells:   { vol: -8, space: 0.55, echo: 0.2, lowcut: 220, pan: 0.34, label: 'Bells: airy' },
  lead:    { vol: -5, space: 0.3, echo: 0.12, lowcut: 120, pan: 0.1, label: 'Lead voice: clear and near' },
  voice:   { vol: -7, space: 0.7, echo: 0.16, lowcut: 140, pan: 0.2, label: 'Voices: wet' },
  drums:   { vol: -11, space: 0.1, echo: 0, lowcut: null, pan: 0, room: true, label: 'Drums: dry-ish, short room' },
  groove:  { vol: -8, space: 0.12, echo: 0, lowcut: null, pan: 0, room: true, label: 'Groove: low and calm, short room' },
  bass:    { vol: -11, space: 0.03, echo: 0, lowcut: null, pan: 0, label: 'Bass: dry and centred' },
  cloud:   { space: 0.3, label: 'Song cloud: your song, left as it is' },
};
// Instrument trims (dB), so each role sits at the same loudness whatever plays it. Measured: one held note / chord (or a
// pattern for kits) of the first preset at 0 dB, loudest 400 ms RMS; trim = 70% of the distance to -38 dB, -7..+8 dB.
export const TRIM = { felt: -4.0, musicbox: -3.5, strings: 0.5, tapepad: 5.0, drone: -1.0, pluck: 0.0, texture: 1.0, gayageum: 2.0, haegeum: 2.0, daegeum: -0.5, janggu: -1.5, guzheng: 4.0, erhu: 0.5, dizi: 2.0, pipa: 4.5, templebells: -1.0, koto: 5.0, shakuhachi: -1.5, shamisen: 7.5, taiko: -2.5, windchimes: 4.0, femchoir: 1.0, solovoice: -1.0, vocalchops: 2.0, breathvox: 2.5, angelpad: 2.5, supersaw: 2.0, analog: 5.0, fmkeys: 2.0, lead: 1.5, synthbass: -0.5, synthpluck: 8.0, voxpad: -0.5, drums: -3.5, bass808: -7.0, chop: 3.0 };

const r2 = x => Math.round(x * 100) / 100;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
export function roleOf(t, def) {
  if (!t || t.kind === 'song') return 'song';
  if (t.groove) return 'groove';
  const id = t.instrument?.id;
  if (ROLE_OF[id]) return ROLE_OF[id];
  const k = def?.kind;
  return k === 'drums' ? 'drums' : k === 'granular' ? 'cloud' : k === 'texture' ? 'texture' : k === 'bass' ? 'bass' : 'keys';
}
export const roleLabel = role => ROLES[role]?.label || (role === 'song' ? 'Your song: never changed' : '');
export const isManual = (t, key) => !!t?.mixManual?.[key];
export function markManual(t, key) { if (!t || !MIX_KEYS.includes(key)) return; t.mixManual = { ...(t.mixManual || {}), [key]: true }; }
export function clearManual(t) { if (t) delete t.mixManual; }
export const anyManual = t => !!t?.mixManual && MIX_KEYS.some(k => t.mixManual[k]);
/** Can "Breathe" (Sidechain Pump) go on this track? Pads, textures, drones and choir pads (never Nico's song clouds). */
export const canBreathe = (t, def) => ['pad', 'texture', 'drone', 'voice'].includes(roleOf(t, def));

// ---------------------------------------------------------------- the Space reverb for the tape
const JAPANESE = new Set(['in', 'hirajoshi', 'iwato', 'kumoi', 'yo', 'ryukyu']);
const BRIGHT = new Set(['major', 'major-penta', 'lydian', 'gong', 'yo', 'pyeongjo', 'zhi']);
/** {type, size, tone, preDelay, shimmer, label} from the tape's style (starter), scale and tempo. */
export function pickReverb(p) {
  const bpm = +p.bpm || 70, sc = String(p.scale || ''), st = p.starter || '';
  if (st === 'antent' || /garage/i.test(p.name || '') || bpm >= 110) return { type: 'plate', size: 1.25, tone: 0.5, preDelay: 0.02, shimmer: 0, label: 'Plate' };
  if (st === 'japanese' || JAPANESE.has(sc)) return { type: 'cathedral', size: 1.25, tone: 0.4, preDelay: 0.04, shimmer: 0, label: 'Temple' };
  if (bpm <= 72) return { type: 'hall', size: 1.8, tone: 0.44, preDelay: 0.035, shimmer: BRIGHT.has(sc) && st !== 'korean' && st !== 'chinese' ? 0.1 : 0, label: 'Big hall' };
  if (bpm <= 95) return { type: 'hall', size: 1.4, tone: 0.46, preDelay: 0.03, shimmer: 0, label: 'Hall' };
  return { type: 'plate', size: 1.1, tone: 0.5, preDelay: 0.02, shimmer: 0, label: 'Plate' };
}

// ---------------------------------------------------------------- the mix
const lowestNote = t => { let m = 128; for (const c of t.clips || []) for (const n of c.notes || []) if (n.p < m) m = n.p; return m < 128 ? m : null; };
/** The settings Auto mix wants for one track (null for song tracks). pan is filled in by autoMix (it spreads them). */
export function targetFor(t, def) {
  const role = roleOf(t, def), R = ROLES[role];
  if (!R || role === 'song') return null;
  if (role === 'cloud') return { role, space: R.space };
  const trim = role === 'groove' ? 0 : TRIM[t.instrument?.id] || 0;
  const vol = role === 'groove' ? grooveById(t.groove)?.vol ?? R.vol : R.vol;
  let lowcut = R.lowcut;
  if (lowcut) { const lo = lowestNote(t); if (lo !== null) lowcut = Math.max(30, Math.min(lowcut, Math.round(mtof(lo) * 0.6))); }
  return { role, volumeDb: r2(vol + trim), space: R.space, echo: R.echo, lowcut, room: !!R.room, panWidth: R.pan };
}
const setIf = (o, k, v) => { if (o[k] !== v) { o[k] = v; return true; } return false; };
const AUTO_EQ = lc => ({ id: 'eq', params: { low: 0, mid: 0, high: 0, lowcut: lc }, bypass: false, auto: 'lowcut' });
const AUTO_ROOM = () => ({ id: 'reverb', params: { type: 'room', mix: 0.16, size: 0.55, tone: 0.5, preDelay: 0.008, shimmer: 0 }, bypass: false, auto: 'room' });

/**
 * Apply Auto mix to the project in place. instDef(id) -> the engine's instrument definition (for kinds).
 * Returns { tracks: Set of changed track ids, bus: bool } (nothing changed = empty set + false).
 */
export function autoMix(p, instDef = () => null) {
  const out = { tracks: new Set(), bus: false };
  if (!p?.tracks) return out;
  let side = 0;
  const seen = {};
  for (const t of p.tracks) {
    const def = instDef(t.instrument?.id);
    const T = targetFor(t, def); if (!T) continue;
    const man = t.mixManual || {};
    let ch = false;
    t.sends = t.sends || { space: 0.3, echo: 0 }; t.fx = t.fx || [];
    if (T.role === 'cloud') {   // Nico's song as a cloud: only a modest Space send
      if (!man.space) ch = setIf(t.sends, 'space', T.space) || ch;
      if (ch) out.tracks.add(t.id);
      continue;
    }
    if (!man.volumeDb) ch = setIf(t, 'volumeDb', T.volumeDb) || ch;
    if (!man.space) ch = setIf(t.sends, 'space', T.space) || ch;
    if (!man.echo) ch = setIf(t.sends, 'echo', T.echo) || ch;
    // gentle pan spread: alternate sides across the tape, wider for the second and third of a role
    let pan = 0;
    if (T.panWidth > 0) { const k = (seen[T.role] = (seen[T.role] || 0) + 1); pan = r2(Math.min(0.6, T.panWidth * (k >= 2 ? 1.3 : 1)) * (side++ % 2 ? 1 : -1)); }
    if (!man.pan) ch = setIf(t, 'pan', pan) || ch;
    // low cut (an EQ insert Auto mix owns), kept after Nico's own effects so indices of his effects never move
    if (!man.lowcut) {
      const i = t.fx.findIndex(f => f.auto === 'lowcut');
      if (T.lowcut) {
        if (i < 0) { t.fx.push(AUTO_EQ(T.lowcut)); ch = true; }
        else { const f = t.fx[i]; f.params = f.params || {}; ch = setIf(f.params, 'lowcut', T.lowcut) || ch; if (f.bypass) { f.bypass = false; ch = true; } }
      } else if (i >= 0) { t.fx.splice(i, 1); ch = true; }
    }
    if (!man.room) {
      const i = t.fx.findIndex(f => f.auto === 'room');
      if (T.room && i < 0) { t.fx.push(AUTO_ROOM()); ch = true; }
      else if (!T.room && i >= 0) { t.fx.splice(i, 1); ch = true; }
    }
    if (ch) out.tracks.add(t.id);
  }
  // the Space bus: a reverb that fits the tape (only its first reverb unit; the rest of the chain is Nico's)
  if (!p.buses?.space?.manual) {
    const f = (p.buses?.space?.fx || []).find(x => (x.id === 'reverb' || x.id === 'shimmer') && !x.bypass);
    if (f) {
      const R = pickReverb(p); f.params = f.params || {};
      for (const k of ['type', 'size', 'tone', 'preDelay', 'shimmer']) out.bus = setIf(f.params, k, R[k]) || out.bus;
      out.bus = setIf(f.params, 'mix', 1) || out.bus;
    }
  }
  return out;
}

/** What Auto mix would do to one track, in words (for the Sound tab). */
export function describe(t, def) {
  const role = roleOf(t, def);
  return roleLabel(role);
}
