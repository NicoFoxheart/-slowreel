// songs.js - Nico's songs as sound sources. Files are only read, never changed.
// loadSong(ctx, id, baseUrl) fetches `${baseUrl}${id}.mp3`, decodes once and caches the AudioBuffer for every context.

export const SONGS = [
  { id: 'after-the-storm', title: 'After the Storm', duration: 209.9 },
  { id: 'ballet-of-life', title: 'Ballet of Life', duration: 135.4 },
  { id: 'hopeful-romantic', title: 'Hopeful Romantic', duration: 83.4 },
  { id: 'i-am-with-you-always', title: 'I Am With You Always', duration: 262.3 },
  { id: 'ill-never-leave-you', title: "I'll Never Leave You", duration: 130.6 },
  { id: 'ill-never-leave-you-nightcore', title: "I'll Never Leave You (Nightcore)", duration: 134.3 },
  { id: 'infinite-love', title: 'Infinite Love', duration: 85.5 },
  { id: 'nature-of-love', title: 'Nature of Love', duration: 63.5 },
  { id: 'sleepy-rain', title: 'Sleepy Rain', duration: 52.3 },
];

const buffers = new Map();   // id -> AudioBuffer
const gains = new Map();     // id -> linear gain that brings the song's loud parts to ~ -20 dBFS RMS (song cloud only)

/** Level match for the song cloud: songs range from about -30 to -8 dBFS RMS. Song clips are NOT matched (Nico's mix stays). */
export function songGain(id) { return gains.get(id) || 1; }
function measureGain(buf) {
  // RMS of the loudest half of 1 s blocks (ignores intros, outros and silence), every 8th sample is plenty
  const d0 = buf.getChannelData(0), d1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d0, sr = buf.sampleRate, blocks = [];
  for (let s = 0; s + sr <= d0.length; s += sr) { let e = 0, n = 0; for (let i = s; i < s + sr; i += 8) { e += d0[i] * d0[i] + d1[i] * d1[i]; n += 2; } blocks.push(e / n); }
  blocks.sort((a, b) => b - a);
  const top = blocks.slice(0, Math.max(1, blocks.length >> 1)), rms = Math.sqrt(top.reduce((a, b) => a + b, 0) / top.length);
  return Math.min(8, Math.max(0.25, 0.1 / (rms || 0.1)));
}
const pending = new Map();   // id -> Promise<AudioBuffer>

export function songBuffer(id) { return buffers.get(id) || null; }

export function loadSong(ctx, id, baseUrl = 'audio/') {
  if (buffers.has(id)) return Promise.resolve(buffers.get(id));
  if (pending.has(id)) return pending.get(id);
  if (!SONGS.some(s => s.id === id)) return Promise.reject(new Error('unknown song ' + id));
  const p = fetch(baseUrl + id + '.mp3')
    .then(r => { if (!r.ok) throw new Error('song ' + id + ' HTTP ' + r.status); return r.arrayBuffer(); })
    .then(ab => new Promise((res, rej) => { const q = ctx.decodeAudioData(ab, res, rej); if (q && q.then) q.then(res, rej); }))
    .then(buf => { buffers.set(id, buf); gains.set(id, measureGain(buf)); pending.delete(id); return buf; })
    .catch(e => { pending.delete(id); throw e; });
  pending.set(id, p);
  return p;
}

/** Song ids a project needs: song clips plus song-cloud instruments. */
export function songsInProject(project) {
  const ids = new Set();
  for (const t of project?.tracks || []) {
    if (t.kind === 'song') for (const c of t.clips || []) if (c.song?.songId) ids.add(c.song.songId);
    if (t.instrument?.id === 'cloud') ids.add(t.instrument.params?.song || cloudPresetSong(t.instrument.preset));
  }
  ids.delete(undefined); ids.delete(null);
  return [...ids];
}
let presetSongLookup = () => 'hopeful-romantic';
export function setPresetSongLookup(fn) { presetSongLookup = fn; }
function cloudPresetSong(preset) { return presetSongLookup(preset); }
