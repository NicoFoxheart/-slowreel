// The UI's sample project ("Window Seat"), in schema nfx-studio/1. Used with the mock engine; the real engine's
// engine.demo replaces it. Deterministic, so it looks the same on every load.
export const PALETTE = ['#e8a85c', '#d98a7a', '#6fb1b0', '#8aa9d6', '#9fbd8a', '#c9a0c4', '#d9cdb5', '#7fb59a', '#e3c27a', '#a8b8c8'];
const BPB = 4, BAR = 4;
const chords = [[50, 57, 61, 66], [47, 54, 57, 61], [43, 50, 54, 61], [45, 52, 59, 64]];
const roots = [38, 35, 31, 33];
let n = 0; const cid = () => `c${++n}`;
const fx = (id, params = {}) => ({ id, params, bypass: false });
function track(id, name, color, inst, preset, params, extra = {}) {
  return { id, name, color, kind: 'instrument', instrument: { id: inst, preset, params }, volumeDb: -6, pan: 0, mute: false, solo: false, sends: { space: 0.45, echo: 0.1 }, fx: [], clips: [], ...extra };
}
function padClip(fromBar, bars) {
  const notes = []; for (let b = 0; b < bars; b += 2) { const ch = chords[((fromBar + b) / 2) % 4 | 0]; ch.forEach((p, i) => notes.push({ p, s: b * BPB + i * 0.12, d: 2 * BPB - 0.25, v: 0.62 - i * 0.04 })); }
  return { id: cid(), name: 'Night chords', startBeat: fromBar * BPB, lengthBeats: bars * BPB, notes };
}
const melody = [[66, 0, 3], [69, 3, 1.5], [64, 5, 3], [62, 8.5, 2], [59, 11, 1], [61, 12, 4], [57, 17, 2], [64, 19.5, 2.5], [66, 22, 2], [62, 25, 6]];
const pianoClip = (bar) => ({ id: cid(), name: 'Lamp melody', startBeat: bar * BPB, lengthBeats: 8 * BPB, notes: melody.map(([p, s, d], i) => ({ p, s, d, v: 0.55 + ((i * 37) % 10) / 40 })) });
const bells = (bar, bars) => { const notes = []; const seq = [78, 81, 85, 83, 78, 76, 81, 86]; for (let i = 0; i < bars; i++) notes.push({ p: seq[i % 8], s: i * BPB + (i % 3) * 0.5, d: 3, v: 0.45 + (i % 4) * 0.05 }); return { id: cid(), name: 'Drops', startBeat: bar * BPB, lengthBeats: bars * BPB, notes }; };

const t = [
  track('t-rain', 'Rain on glass', PALETTE[9], 'night-texture', 'rain', { amount: 0.6, tone: 0.45 }, { volumeDb: -14, sends: { space: 0.3, echo: 0 } }),
  track('t-sub', 'Floor hum', PALETTE[3], 'sub-drone', 'floor', { depth: 0.55 }, { volumeDb: -10, sends: { space: 0.2, echo: 0 } }),
  track('t-pad', 'Night chords', PALETTE[0], 'dream-pad', 'dusk', { warmth: 0.45, drift: 0.4, bloom: 0.6 }, { volumeDb: -9, sends: { space: 0.55, echo: 0.12 } }),
  track('t-piano', 'Lamp melody', PALETTE[8], 'felt-piano', 'soft', { felt: 0.7 }, { volumeDb: -7, pan: -0.15, sends: { space: 0.5, echo: 0.28 } }),
  track('t-bells', 'Glass drops', PALETTE[2], 'glass-bells', 'window', { shine: 0.4 }, { volumeDb: -15, pan: 0.3, sends: { space: 0.7, echo: 0.35 } }),
  track('t-choir', 'Choir air', PALETTE[5], 'choir-air', 'aah', { breath: 0.4 }, { volumeDb: -13, sends: { space: 0.75, echo: 0.05 } }),
  { ...track('t-song', 'Sleepy Rain (Nico)', PALETTE[1], null, null, {}), kind: 'song', instrument: null, volumeDb: -8, sends: { space: 0.35, echo: 0.08 } },
  track('t-cloud', 'Storm cloud', PALETTE[7], 'song-cloud', 'haze', { songId: 'after-the-storm', position: 0.42, grain: 0.5, density: 0.5, spray: 0.3 }, { volumeDb: -12, sends: { space: 0.6, echo: 0.1 } }),
  track('t-koto', 'Koto steps', PALETTE[4], 'koto-pluck', 'koto', { pluck: 0.5 }, { volumeDb: -14, pan: 0.2, sends: { space: 0.5, echo: 0.4 } }),
];
t[0].clips.push({ id: cid(), name: 'Rain', startBeat: 0, lengthBeats: 32 * BPB, notes: [{ p: 74, s: 0, d: 32 * BPB, v: 0.7 }] });
t[1].clips.push({ id: cid(), name: 'Hum', startBeat: 4 * BPB, lengthBeats: 24 * BPB, notes: Array.from({ length: 12 }, (_, i) => ({ p: roots[i % 4], s: i * 2 * BPB, d: 2 * BPB - 0.1, v: 0.7 })) });
t[2].clips.push(padClip(0, 16), padClip(16, 14));
t[3].clips.push(pianoClip(8), pianoClip(16));
t[3].fx.push(fx('lowpass', { cutoff: 4200, q: 0.6 }));
t[4].clips.push(bells(4, 12), bells(20, 8));
t[5].clips.push({ id: cid(), name: 'Air', startBeat: 16 * BPB, lengthBeats: 12 * BPB, notes: [[69, 0, 16], [73, 8, 16], [74, 16, 16], [69, 24, 20]].map(([p, s, d]) => ({ p, s, d, v: 0.55 })) });
t[6].clips.push({ id: cid(), name: 'Sleepy Rain', startBeat: 12 * BPB, lengthBeats: 12 * BPB, song: { songId: 'sleepy-rain', offsetSec: 6, gainDb: -4, fadeInSec: 5, fadeOutSec: 7, rate: 1 } });
t[7].clips.push({ id: cid(), name: 'After the Storm', startBeat: 24 * BPB, lengthBeats: 8 * BPB, notes: [{ p: 62, s: 0, d: 30, v: 0.6 }, { p: 57, s: 4, d: 26, v: 0.5 }] });
t[8].clips.push({ id: cid(), name: 'Steps', startBeat: 20 * BPB, lengthBeats: 8 * BPB, notes: Array.from({ length: 16 }, (_, i) => ({ p: [62, 66, 69, 74, 73, 69, 66, 64][i % 8], s: i * 2 + (i % 2) * 0.5, d: 1, v: 0.5 + (i % 3) * 0.08 })) });
t[8].fx.push(fx('tape-echo', { time: 0.68, feedback: 0.4, mix: 0.25 }));

export const SAMPLE_PROJECT = {
  schema: 'nfx-studio/1', id: 'demo-window-seat', name: 'Window Seat', credit: 'Demo by team rain for Nicofoxheart', bpm: 66, beatsPerBar: BAR, key: 'D', scale: 'lydian', lengthBars: 34,
  loop: { on: false, startBeat: 0, endBeat: 16 }, tracks: t,
  buses: { space: { fx: [fx('reverb', { type: 'cathedral', mix: 1, size: 0.8 })] }, echo: { fx: [fx('tape-echo', { time: 0.68, feedback: 0.45, mix: 1 })] } },
  master: { volumeDb: 0, atmosphere: 0.55, fx: [] }, createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z',
};
