// songs.js - Nico's songs (Nicofoxheart) for song clips and the Song Cloud. Files are read, never changed.
// Fetched from `<songBase><id>.mp3` (default 'audio/' next to the page), decoded once per sample rate.

export const SONG_LIST = [
  { id: 'infinite-love', title: 'Infinite Love', duration: 85.5 },
  { id: 'after-the-storm', title: 'After the Storm', duration: 209.9 },
  { id: 'ballet-of-life', title: 'Ballet of Life', duration: 135.4 },
  { id: 'hopeful-romantic', title: 'Hopeful Romantic', duration: 83.4 },
  { id: 'nature-of-love', title: 'Nature of Love', duration: 63.5 },
  { id: 'ill-never-leave-you', title: "I'll Never Leave You", duration: 130.6 },
  { id: 'ill-never-leave-you-nightcore', title: "I'll Never Leave You (Nightcore)", duration: 134.3 },
  { id: 'i-am-with-you-always', title: 'I Am With You Always', duration: 262.3 },
  { id: 'sleepy-rain', title: 'Sleepy Rain', duration: 52.3 },
];

let songBase = 'audio/';
export function setSongBase(url) { songBase = url.endsWith('/') ? url : url + '/'; }
export function songUrl(id) {
  const baseUrl = typeof document !== 'undefined' ? document.baseURI : (typeof location !== 'undefined' ? location.href : '');
  return new URL(`${songBase}${encodeURIComponent(id)}.mp3`, baseUrl).href;
}

const bytes = new Map();   // id -> Promise<ArrayBuffer>
const decoded = new Map(); // `${sr}:${id}` -> Promise<AudioBuffer>

/** Fetch + decode a song at ctx.sampleRate. Cached; failures are forgotten so a retry works. */
export function loadSongBuffer(ctx, id) {
  if (!SONG_LIST.some(s => s.id === id)) return Promise.reject(new Error(`unknown song "${id}"`));
  const key = `${ctx.sampleRate}:${id}`;
  if (!decoded.has(key)) {
    if (!bytes.has(id)) {
      bytes.set(id, fetch(songUrl(id)).then(r => { if (!r.ok) throw new Error(`song ${id}: HTTP ${r.status}`); return r.arrayBuffer(); })
        .catch(e => { bytes.delete(id); throw e; }));
    }
    decoded.set(key, bytes.get(id).then(ab => ctx.decodeAudioData(ab.slice(0))).catch(e => { decoded.delete(key); throw e; }));
  }
  return decoded.get(key);
}
/** The decoded buffer if it is already in memory for this sample rate, else null (never waits). */
const ready = new Map();
export function songBufferNow(ctx, id) { return ready.get(`${ctx.sampleRate}:${id}`) || null; }
export function ensureSong(ctx, id) {
  return loadSongBuffer(ctx, id).then(b => { ready.set(`${ctx.sampleRate}:${id}`, b); return b; });
}
