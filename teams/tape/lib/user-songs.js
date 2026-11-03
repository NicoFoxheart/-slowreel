// user-songs.js - music Nico adds from his computer, listed next to his songs in Nico's tapes.
// The list (id, title, duration, peaks) lives in localStorage; the audio bytes live in IndexedDB ('slowreel-user-songs'),
// keyed by id. Ids are 'my-' + the first 16 hex chars of the file's SHA-256, so the same file added twice is one song.
// Both song lists (lib/songs.js for the UI, js/sound/songs.js for the engine) call linkSongList(SONGS) once, so a song
// added here shows up in both. Like imported samples, the music stays in this browser: projects only hold the id.
const LS = 'slowreel:usersongs', DB = 'slowreel-user-songs', STORE = 'songs';
const MAX_BYTES = 150 * 1024 * 1024;

const readList = () => { try { const a = JSON.parse(localStorage.getItem(LS) || '[]'); return Array.isArray(a) ? a.filter(s => s && /^my-[0-9a-f]{16}$/.test(s.id)) : []; } catch { return []; } };
const writeList = () => { try { localStorage.setItem(LS, JSON.stringify(USER_SONGS.map(({ id, title, duration, peaks }) => ({ id, title, duration, peaks })))); } catch { } };

export const USER_SONGS = readList().map(s => ({ ...s, user: true }));
export const isUserSong = id => typeof id === 'string' && id.startsWith('my-');

const lists = [];
/** Put the user's songs at the end of a SONGS array, and keep adding new ones to it. */
export function linkSongList(arr) { lists.push(arr); for (const s of USER_SONGS) if (!arr.some(x => x.id === s.id)) arr.push(s); }

function idb() {
  return new Promise((res, rej) => { const q = indexedDB.open(DB, 1); q.onupgradeneeded = () => q.result.createObjectStore(STORE); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction(STORE, mode), q = fn(tx.objectStore(STORE)); tx.oncomplete = () => { res(q?.result); db.close(); }; tx.onerror = () => { rej(tx.error); db.close(); }; });
}

const bytes = new Map();   // id -> Promise<ArrayBuffer>
/** The raw audio file of a user song (read-only; slice before decoding). Rejects with err.missing when it is not in this browser. */
export function userSongBytes(id) {
  if (!bytes.has(id)) bytes.set(id, idbDo('readonly', st => st.get(id)).then(ab => {
    if (!ab) throw Object.assign(new Error('This music was added on another computer or browser.'), { missing: true });
    return ab;
  }).catch(e => { bytes.delete(id); throw e; }));
  return bytes.get(id);
}

async function hashId(ab) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', ab));
  return 'my-' + [...d.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** 120 peak values 0..1, the same shape as the built-in songs (max |sample| per bin of the mono mix, divided by the loudest bin). */
function peaksOf(buf) {
  const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a, n = Math.floor(a.length / 120), out = [];
  for (let i = 0; i < 120; i++) { let m = 0; for (let j = i * n, e = j + n; j < e; j += 4) { const v = Math.abs((a[j] + b[j]) / 2); if (v > m) m = v; } out.push(m); }
  const top = Math.max(...out) || 1;
  return out.map(v => Math.round(v / top * 100) / 100);
}

/** Add audio files from the computer. -> {added: [song], skipped: [{name, why}]}. Decodes with ctx to check the file is audio. */
export async function addUserSongs(ctx, files) {
  const added = [], skipped = [];
  for (const f of files) {
    const name = f.name || 'music';
    if (f.size > MAX_BYTES) { skipped.push({ name, why: 'is over 150 MB' }); continue; }
    try {
      const ab = await f.arrayBuffer(), id = await hashId(ab);
      const have = USER_SONGS.find(s => s.id === id); if (have) { skipped.push({ name, why: 'is already in your tapes' }); continue; }
      let buf; try { buf = await ctx.decodeAudioData(ab.slice(0)); } catch { skipped.push({ name, why: "isn't an audio file this browser can play" }); continue; }
      await idbDo('readwrite', st => st.put(ab, id));
      bytes.set(id, Promise.resolve(ab));
      const s = { id, title: name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 60) || 'My music', duration: Math.round(buf.duration * 10) / 10, peaks: peaksOf(buf), user: true };
      USER_SONGS.push(s); for (const arr of lists) if (!arr.some(x => x.id === id)) arr.push(s);
      added.push(s);
    } catch (e) { skipped.push({ name, why: 'could not be saved in this browser' }); }
  }
  writeList();
  return { added, skipped };
}

/** Remove a song from the list and from the browser. Tapes that used it go quiet where it played. */
export async function removeUserSong(id) {
  const i = USER_SONGS.findIndex(s => s.id === id); if (i < 0) return;
  USER_SONGS.splice(i, 1); for (const arr of lists) { const j = arr.findIndex(x => x.id === id); if (j >= 0) arr.splice(j, 1); }
  writeList(); bytes.delete(id);
  try { await idbDo('readwrite', st => st.delete(id)); } catch { }
}
