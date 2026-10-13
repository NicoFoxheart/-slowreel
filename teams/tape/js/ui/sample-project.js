// sample-project.js - a small project in the nfx-studio/1 schema, used by the mock engine.
// The real demo comes from the musician (engine.demo / demo.json).
export const TRACK_COLORS = ['#E8542F', '#F0A616', '#8FA53A', '#1E9A88', '#2E5BD4', '#7A63C8', '#D7678F', '#5A6168'];

const chord = (start, len, ps, v = 0.6) => ps.map(p => ({ p, s: start, d: len, v }));
const seq = (pairs, d, v = 0.7) => pairs.map(([s, p]) => ({ p, s, d, v }));
const tr = (i, name, kind, instrument, clips, extra = {}) => ({
  id: 't' + (i + 1), name, color: TRACK_COLORS[i], kind, instrument, volumeDb: extra.volumeDb ?? -6, pan: extra.pan ?? 0,
  mute: false, solo: false, sends: { space: extra.space ?? 0.45, echo: extra.echo ?? 0.1 }, fx: extra.fx || [], clips,
});

export const SAMPLE_PROJECT = {
  schema: 'nfx-studio/1', id: 'demo', name: 'Morning Tape', bpm: 68, beatsPerBar: 4, key: 'D', scale: 'lydian', lengthBars: 16,
  loop: { on: false, startBeat: 0, endBeat: 32 }, credit: 'Demo by team tape',
  tracks: [
    tr(0, 'Glow pad', 'instrument', { id: 'dream-pad', preset: 'morning', params: {} }, [
      { id: 'c1', startBeat: 0, lengthBeats: 64, notes: [
        ...chord(0, 16, [50, 54, 57, 61]), ...chord(16, 16, [47, 50, 54, 57, 61]), ...chord(32, 16, [43, 50, 54, 56, 59]), ...chord(48, 16, [45, 52, 57, 59, 64])] },
    ], { volumeDb: -8, space: 0.6 }),
    tr(1, 'Glass bells', 'instrument', { id: 'glass-bells', preset: 'music-box', params: {} }, [
      { id: 'c2', startBeat: 16, lengthBeats: 16, notes: seq([[0, 78], [3, 76], [6, 73], [8, 74], [11, 76], [14, 69]], 2.5, 0.55) },
      { id: 'c3', startBeat: 40, lengthBeats: 16, notes: seq([[0, 81], [2, 78], [5, 76], [8, 73], [12, 74]], 3, 0.5) },
    ], { volumeDb: -10, pan: 0.25, echo: 0.35, fx: [{ id: 'shimmer', params: { mix: 0.4, shimmer: 0.6 }, bypass: false }] }),
    tr(2, 'Felt piano', 'instrument', { id: 'felt-piano', preset: 'felt', params: {} }, [
      { id: 'c4', startBeat: 8, lengthBeats: 24, notes: seq([[0, 62], [1.5, 66], [3, 69], [6, 73], [8, 59], [9.5, 62], [11, 66], [14, 69], [16, 55], [17.5, 62], [19, 66], [22, 68]], 2, 0.5) },
      { id: 'c5', startBeat: 48, lengthBeats: 16, notes: seq([[0, 57], [1.5, 61], [3, 64], [6, 66], [8, 69], [12, 74]], 3, 0.45) },
    ], { volumeDb: -7, pan: -0.15 }),
    tr(3, 'Sub floor', 'instrument', { id: 'sub-drone', preset: 'floor', params: {} }, [
      { id: 'c6', startBeat: 0, lengthBeats: 64, notes: [{ p: 38, s: 0, d: 32, v: 0.6 }, { p: 31, s: 32, d: 16, v: 0.6 }, { p: 33, s: 48, d: 16, v: 0.6 }] },
    ], { volumeDb: -9, space: 0.2, echo: 0 }),
    tr(4, 'Koto', 'instrument', { id: 'koto-pluck', preset: 'koto', params: {} }, [
      { id: 'c7', startBeat: 32, lengthBeats: 8, notes: seq([[0, 74], [0.5, 76], [1, 81], [3, 78], [4, 76], [6, 73]], 1, 0.45) },
    ], { volumeDb: -12, pan: 0.35, echo: 0.4 }),
    tr(5, 'Night rain', 'instrument', { id: 'noise-texture', preset: 'night-rain', params: {} }, [
      { id: 'c8', startBeat: 0, lengthBeats: 64, notes: [{ p: 60, s: 0, d: 64, v: 0.35 }] },
    ], { volumeDb: -20, space: 0.3, echo: 0 }),
    tr(6, 'Sleepy Rain', 'song', { id: 'song', preset: '', params: {} }, [
      { id: 'c9', startBeat: 16, lengthBeats: 32, notes: [], song: { songId: 'sleepy-rain', offsetSec: 6, gainDb: -6, fadeInSec: 4, fadeOutSec: 6, rate: 1 } },
    ], { volumeDb: -6, space: 0.35 }),
    tr(7, 'Love cloud', 'instrument', { id: 'song-cloud', preset: 'haze', params: { songId: 'infinite-love', position: 0.35 } }, [
      { id: 'c10', startBeat: 32, lengthBeats: 32, notes: [{ p: 60, s: 0, d: 32, v: 0.5 }, { p: 67, s: 8, d: 24, v: 0.35 }] },
    ], { volumeDb: -10, space: 0.7 }),
  ],
  buses: { space: { fx: [{ id: 'reverb', params: { type: 'cathedral', mix: 1, tone: 0.5 }, bypass: false }] },
    echo: { fx: [{ id: 'tape-delay', params: { time: 0.66, feedback: 0.45, tone: 0.4, mix: 1 }, bypass: false }] } },
  master: { volumeDb: 0, atmosphere: 0.5, fx: [] },
  createdAt: 0, updatedAt: 0,
};
