// demo.js - "Rain on the Reel", the Slowreel demo song (team tape). Schema nfx-studio/1. Also saved as teams/tape/demo.json.
// A major / F# minor, 66 BPM, 32 bars (~1:56 + tail). Uses Nico's "After the Storm" twice: as a song clip on tape,
// and as a frozen song cloud underneath everything. Night rain on the window from the first second to the last.
//   bars 1-8   rain, a low drone, a frozen cloud of the song, the tape choir breathing in; felt piano from bar 5
//   bars 9-16  "After the Storm" itself drifts in on worn tape; strings under it
//   bars 17-24 the music box answers, cassette harp, everything through the long tape echo
//   bars 25-32 thinning out; one last phrase; the shimmer room carries it home
const COLORS = ['#E8542F', '#F0A616', '#8FA53A', '#1E9A88', '#2E5BD4', '#7A63C8', '#D7678F', '#5A6168', '#B88A6A'];

// chord cycle: 8 beats each (2 bars of 4/4)
const CH = {
  A:  { pad: [57, 61, 64, 68, 71], root: 33 },   // A maj9
  Fm: { pad: [54, 57, 61, 64, 68], root: 30 },   // F# min9
  D:  { pad: [50, 57, 61, 66, 68], root: 38 },   // D maj7#11 (the lydian colour)
  E:  { pad: [52, 59, 61, 64, 66], root: 40 },   // E sus2 add6
};
const CYCLE = ['A', 'Fm', 'D', 'E'];
const r2 = x => Math.round(x * 1000) / 1000;
const note = (p, s, d, v) => ({ p, s: r2(s), d: r2(d), v: r2(v) });
let cid = 0;
const clip = (startBeat, lengthBeats, notes) => ({ id: 'c' + (++cid), startBeat, lengthBeats, notes });
const track = (i, id, name, instrument, preset, params, clips, mix) => ({
  id, name, color: COLORS[i], kind: 'instrument', instrument: { id: instrument, preset, params: params || {} },
  volumeDb: mix.vol ?? 0, pan: mix.pan ?? 0, mute: false, solo: false,
  sends: { space: mix.space ?? 0.35, echo: mix.echo ?? 0 }, fx: mix.fx || [], clips,
});

// ---- pad: tape choir chords, swelling (cycles A, B and D; lighter in C)
const padNotes = [];
for (let c = 0; c < 16; c++) {
  const ch = CH[CYCLE[c % 4]], s = c * 8, sec = Math.floor(c / 4);
  if (s >= 124) break;
  const vel = sec === 0 ? 0.32 + c * 0.04 : sec === 2 ? 0.34 : 0.44;
  const len = c === 15 ? 4 : 8.25;
  ch.pad.forEach((p, k) => padNotes.push(note(p, s + k * 0.12, len - k * 0.12, vel - k * 0.02)));
}
padNotes.push(...CH.A.pad.map((p, k) => note(p, 120 + k * 0.2, 8 - k * 0.2, 0.36)));   // home chord

// ---- drone: chord roots, long and low
const droneNotes = [];
for (let c = 0; c < 16; c++) { const s = c * 8; droneNotes.push(note(CH[CYCLE[c % 4]].root + 12, s, 8.5, c < 2 ? 0.45 : 0.6)); }

// ---- felt piano: a slow four-chord motif from bar 5, with a low left hand
const MOTIF = {
  A:  [[0, 76, 0.5], [1.5, 73, 0.42], [3, 71, 0.4], [6, 68, 0.36]],
  Fm: [[0, 73, 0.48], [1.5, 69, 0.4], [3, 68, 0.38], [6, 64, 0.34]],
  D:  [[0, 74, 0.48], [1.5, 73, 0.4], [3, 68, 0.42], [5, 66, 0.34]],
  E:  [[0, 71, 0.46], [2, 73, 0.4], [3.5, 76, 0.44], [6, 78, 0.36]],
};
const feltNotes = [];
for (let c = 2; c < 16; c++) {
  if (c >= 8 && c < 10) continue;                  // lets the music box speak first in section C
  const k = CYCLE[c % 4], s = c * 8, soft = c >= 12 ? 0.85 : 1;
  feltNotes.push(note(CH[k].root + 24, s, 6, 0.36 * soft), note(CH[k].root + 31, s + 0.5, 5, 0.28 * soft));
  for (const [o, p, v] of MOTIF[k]) if (!(c === 15 && o > 3)) feltNotes.push(note(p, s + o, 2.5, v * soft));
}
feltNotes.push(note(57, 124, 4, 0.3), note(64, 124.5, 3.5, 0.28), note(69, 125.5, 2.5, 0.34));   // last A

// ---- strings: two voices, beats 32..104, slow voice leading
const STR = { A: [61, 68], Fm: [61, 69], D: [62, 66], E: [59, 64] };
const stringNotes = [];
for (let c = 4; c < 13; c++) { const k = CYCLE[c % 4], s = c * 8; STR[k].forEach((p, j) => stringNotes.push(note(p, s + j * 0.25, 8.3, c === 4 ? 0.38 : 0.5))); }

// ---- music box: the answering melody (section C) and a last echo (section D)
const MB = {
  A:  [[0, 88, 0.5], [1, 85, 0.4], [2, 83, 0.42], [4, 80, 0.38], [5, 81, 0.44]],
  Fm: [[0, 81, 0.46], [1.5, 80, 0.38], [3, 76, 0.4], [5, 78, 0.36]],
  D:  [[0, 85, 0.48], [1, 83, 0.38], [2, 80, 0.4], [4, 78, 0.36], [6, 76, 0.34]],
  E:  [[0, 83, 0.46], [2, 81, 0.38], [3, 80, 0.36], [6, 76, 0.4]],
};
const mbNotes = [];
for (let c = 8; c < 12; c++) for (const [o, p, v] of MB[CYCLE[c % 4]]) mbNotes.push(note(p, c * 8 + o, 1.5, v));
for (const [o, p, v] of MB.A) mbNotes.push(note(p, 112 + o, 1.5, v * 0.8));
mbNotes.push(note(81, 122, 3, 0.32), note(88, 124, 3, 0.28));

// ---- cassette harp: rising arpeggios in section C
const harpNotes = [];
for (let c = 9; c < 12; c++) {
  const pad = CH[CYCLE[c % 4]].pad, s = c * 8;
  [pad[0], pad[1], pad[2], pad[3], pad[4], pad[2] + 12].forEach((p, j) => harpNotes.push(note(p, s + 2 + j * 0.75, 2, 0.34 + j * 0.02)));
}

// ---- song cloud of "After the Storm": original pitch + an octave below, frozen, very wide
const cloudNotes = [note(60, 0, 64, 0.5), note(48, 8, 40, 0.36), note(60, 72, 54, 0.46), note(48, 96, 30, 0.34)];

// ---- night rain: one long note, the whole song
const rainNotes = [note(60, 0, 125, 0.55)];   // fades out under the last chord

export const DEMO = {
  schema: 'nfx-studio/1', id: 'demo-rain-on-the-reel', name: 'Rain on the Reel', bpm: 66, beatsPerBar: 4, key: 'A', scale: 'major', lengthBars: 32,
  loop: { on: false, startBeat: 64, endBeat: 96 },
  credit: 'Demo by team tape (Slowreel), with "After the Storm" by Nicofoxheart',
  tracks: [
    track(0, 'rain', 'Night rain', 'texture', 'night-rain', {}, [clip(0, 128, rainNotes)],
      { vol: -8, space: 0.12, echo: 0 }),
    track(1, 'cloud', 'Storm cloud', 'cloud', 'frozen-tape', { song: 'after-the-storm', position: 0.42, size: 0.55, density: 12, spray: 0.06, tone: 0.42, width: 0.85, attack: 4, level: 1 },
      [clip(0, 128, cloudNotes)],
      { vol: -8, space: 0.45, echo: 0.05, fx: [{ id: 'filter', params: { mode: 'lowpass', cutoff: 3200, resonance: 0.5, motion: 0.35, rate: 0.05 }, bypass: false }] }),
    track(2, 'drone', 'Low tape', 'drone', 'warm-sub', { body: 0.6, reed: 0.15, motion: 0.4, grit: 0.1 }, [clip(0, 128, droneNotes)],
      { vol: -9, space: 0.15, echo: 0 }),
    track(3, 'pad', 'Tape choir', 'tapepad', 'dusty-choir', { swell: 0.85, air: 0.2 }, [clip(0, 128, padNotes)],
      { vol: -3, space: 0.45, echo: 0.04, fx: [{ id: 'chorus', params: { rate: 0.25, depth: 0.5, mix: 0.4 }, bypass: false }] }),
    track(4, 'felt', 'Felt piano', 'felt', 'felt-upright', { sustain: 0.6, wobble: 0.35 }, [clip(16, 112, feltNotes.map(n => ({ ...n, s: r2(n.s - 16) })))],
      { vol: 0, pan: -0.12, space: 0.4, echo: 0.12, fx: [
        { id: 'tape', params: { drive: 0.25, age: 0.3, wow: 0.35, flutter: 0.2, hiss: 0 }, bypass: false },
        { id: 'reverb', params: { type: 'plate', mix: 0.18, size: 0.9, tone: 0.45, preDelay: 0.01, shimmer: 0 }, bypass: false }] }),
    track(5, 'song', 'After the Storm', null, null, null, [], { vol: 0, space: 0.35, echo: 0.06, fx: [
        { id: 'tape', params: { drive: 0.2, age: 0.5, wow: 0.4, flutter: 0.25, hiss: 0 }, bypass: false },
        { id: 'eq', params: { low: -2, mid: 0, high: -3, lowcut: 110 }, bypass: false }] }),
    track(6, 'strings', 'Cassette strings', 'strings', 'slow-section', { bright: 0.3 }, [clip(32, 76, stringNotes.map(n => ({ ...n, s: r2(n.s - 32) })))],
      { vol: -5, pan: 0.1, space: 0.5, echo: 0 }),
    track(7, 'musicbox', 'Music box', 'musicbox', 'music-box', { ring: 0.6, wobble: 0.35, shine: 0.62 }, [clip(64, 64, mbNotes.map(n => ({ ...n, s: r2(n.s - 64) })))],
      { vol: -5, pan: 0.22, space: 0.45, echo: 0.3, fx: [{ id: 'reverb', params: { type: 'spring', mix: 0.2, size: 1, tone: 0.45, preDelay: 0.01, shimmer: 0 }, bypass: false }] }),
    track(8, 'harp', 'Cassette harp', 'pluck', 'cassette-harp', {}, [clip(72, 24, harpNotes.map(n => ({ ...n, s: r2(n.s - 72) })))],
      { vol: -6, pan: -0.3, space: 0.4, echo: 0.25 }),
  ],
  buses: {
    space: { returnDb: 0, fx: [{ id: 'shimmer', params: { type: 'cathedral', mix: 1, size: 1.1, tone: 0.5, preDelay: 0.04, shimmer: 0.28 }, bypass: false }] },
    echo: { returnDb: -2, fx: [{ id: 'echo', params: { beats: 0.75, feedback: 0.6, tone: 0.35, wow: 0.45, drive: 0.35, spread: 0.8, mix: 1 }, bypass: false }] },
  },
  master: { volumeDb: 0, atmosphere: 0.5, fx: [] },
  createdAt: 0, updatedAt: 0,
};
// the song clip track
DEMO.tracks[5].kind = 'song';
DEMO.tracks[5].instrument = { id: 'song', preset: '', params: {} };
DEMO.tracks[5].clips = [{ id: 'c-song', startBeat: 30, lengthBeats: 52, notes: [],
  song: { songId: 'after-the-storm', offsetSec: 38, gainDb: 0, fadeInSec: 7, fadeOutSec: 9, rate: 1 } }];
