// sample-project.js - a small demo in the nfx-studio/1 schema, used only with the mock engine.
// The real demo ("engine.demo" / demo.json) comes from the musician's sound engine.

const C = ['#4c9be8', '#f2a65a', '#e58fa0', '#5dbfa8', '#9a8fd8', '#e0b440', '#3fa7b5', '#ee7d63', '#7d8fb3', '#6fb4d6'];
let n = 0; const id = p => `${p}${++n}`;

// D lydian-ish progression, two bars per chord (beats are quarter notes, 4 per bar).
const PROG = [
  [50, 57, 62, 64, 66, 69], [47, 54, 61, 62, 66, 69], [43, 50, 57, 59, 61, 66], [45, 52, 57, 61, 64, 66],
];
const chordAt = bar => PROG[Math.floor(bar / 2) % PROG.length];

function padClip(fromBar, bars) {
  const notes = [];
  for (let b = fromBar; b < fromBar + bars; b += 2) chordAt(b).slice(1).forEach((p, i) => notes.push({ p, s: (b - fromBar) * 4 + i * 0.12, d: 7.6, v: 0.55 }));
  return { id: id('c'), startBeat: fromBar * 4, lengthBeats: bars * 4, notes };
}
function droneClip(fromBar, bars) {
  const notes = [];
  for (let b = fromBar; b < fromBar + bars; b += 4) notes.push({ p: chordAt(b)[0] - 12, s: (b - fromBar) * 4, d: 15.5, v: 0.6 });
  return { id: id('c'), startBeat: fromBar * 4, lengthBeats: bars * 4, notes };
}
const MEL = [[74, 0, 3], [76, 3, 1], [78, 4, 4], [81, 9, 2], [78, 11, 1], [76, 12, 4], [73, 17, 3], [74, 20, 6], [69, 27, 4]];
function melodyClip(fromBar, shift = 0) {
  return { id: id('c'), startBeat: fromBar * 4, lengthBeats: 32, notes: MEL.map(([p, s, d], i) => ({ p: p + shift, s, d, v: 0.5 + (i % 3) * 0.1 })) };
}
function bellClip(fromBar, bars) {
  const notes = []; const pool = [86, 88, 90, 93, 95, 98];
  for (let i = 0; i < bars * 2; i++) if (i % 3 !== 2) notes.push({ p: pool[(i * 5) % pool.length], s: i * 2 + (i % 2) * 0.5, d: 1.5, v: 0.35 + ((i * 7) % 5) * 0.06 });
  return { id: id('c'), startBeat: fromBar * 4, lengthBeats: bars * 4, notes };
}
function pluckClip(fromBar, bars) {
  const notes = [];
  for (let i = 0; i < bars * 4; i++) { const c = chordAt(fromBar + Math.floor(i / 4)); notes.push({ p: c[2 + (i % 3)] + 12, s: i + (i % 2 ? 0.5 : 0), d: 0.75, v: 0.42 }); }
  return { id: id('c'), startBeat: fromBar * 4, lengthBeats: bars * 4, notes };
}
const long = (fromBar, bars, p, v = 0.5) => ({ id: id('c'), startBeat: fromBar * 4, lengthBeats: bars * 4, notes: [{ p, s: 0, d: bars * 4 - 0.5, v }] });

function track(name, color, instrument, preset, params, clips, extra = {}) {
  return { id: id('t'), name, color, kind: 'instrument', instrument: { id: instrument, preset, params }, volumeDb: -8, pan: 0,
    mute: false, solo: false, sends: { space: 0.45, echo: 0.12 }, fx: [], clips, ...extra };
}

export function sampleProject() {
  n = 0;
  const now = Date.now();
  return {
    schema: 'nfx-studio/1', id: 'sky-demo', name: 'First Light', bpm: 68, beatsPerBar: 4, key: 'D', scale: 'lydian', lengthBars: 32,
    loop: { on: false, startBeat: 32, endBeat: 64 }, credit: 'Demo by team sky',
    tracks: [
      track('Dawn pad', C[0], 'dream-pad', 'first-light', { bright: 0.45, swell: 0.7, drift: 0.4 }, [padClip(0, 8), padClip(8, 8), padClip(16, 8), padClip(24, 8)], { volumeDb: -10, sends: { space: 0.6, echo: 0.1 } }),
      track('Felt piano', C[1], 'felt-piano', 'soft-felt', { tone: 0.4, felt: 0.7, room: 0.5 }, [melodyClip(8), melodyClip(20, 0)], { volumeDb: -7, sends: { space: 0.5, echo: 0.3 } }),
      track('Glass bells', C[2], 'glass-bells', 'high-glass', { shine: 0.6, decay: 0.6 }, [bellClip(12, 8), bellClip(24, 6)], { volumeDb: -15, pan: 0.25, sends: { space: 0.7, echo: 0.35 } }),
      track('Choir air', C[3], 'choir-air', 'breath', { vowel: 0.4, air: 0.6 }, [padClip(16, 8)], { volumeDb: -14, pan: -0.2 }),
      track('Bowed strings', C[4], 'bowed-strings', 'slow-bow', { bow: 0.5, warmth: 0.6 }, [long(16, 8, 62, 0.45), long(24, 6, 57, 0.4)], { volumeDb: -13 }),
      track('Sub drone', C[5], 'sub-drone', 'deep', { depth: 0.6, motion: 0.3 }, [droneClip(0, 16), droneClip(16, 16)], { volumeDb: -12, sends: { space: 0.2, echo: 0 } }),
      track('Koto pluck', C[6], 'pluck', 'koto', { pluck: 0.5, tone: 0.5 }, [pluckClip(18, 6)], { volumeDb: -16, pan: 0.3, sends: { space: 0.5, echo: 0.45 } }),
      track('Wind', C[7], 'noise-texture', 'wind', { texture: 0.4, motion: 0.6 }, [long(0, 12, 60, 0.4), long(26, 6, 60, 0.35)], { volumeDb: -20, sends: { space: 0.3, echo: 0 } }),
      { ...track('After the Storm', C[8], 'song', null, {}, [
        { id: id('c'), startBeat: 4, lengthBeats: 28, notes: [], song: { songId: 'after-the-storm', offsetSec: 24, gainDb: -6, fadeInSec: 4, fadeOutSec: 6, rate: 1 } },
      ], { volumeDb: -10, sends: { space: 0.5, echo: 0.1 } }), kind: 'song', instrument: { id: 'song', preset: null, params: {} } },
      track('Song cloud', C[9], 'song-cloud', 'halo', { songId: 'infinite-love', grain: 0.5, density: 0.6, position: 0.35, spray: 0.3, freeze: 0 }, [long(24, 8, 62, 0.5)], { volumeDb: -14, sends: { space: 0.7, echo: 0.2 } }),
    ],
    buses: {
      space: { fx: [{ id: 'reverb', params: { type: 2, decay: 6, tone: 0.5, mix: 1 }, bypass: false }] },
      echo: { fx: [{ id: 'tape-delay', params: { time: 0.75, feedback: 0.42, tone: 0.45 }, bypass: false }] },
    },
    master: { volumeDb: -2, atmosphere: 0.5, fx: [] },
    createdAt: now, updatedAt: now,
  };
}
