// storage.js - project storage with three backends, picked in this order:
//   'db'        claude.ai viewer with the db + user capabilities: one private doc per project at
//               data/users/<userId>/studio/projects/<projectId>   (see README for why "studio" is in the path)
//   'indexeddb' any normal browser (database "nfx-studio-<appKey>")
//   'memory'    last resort (private windows that block IndexedDB); lost on reload
// Every backend has the same API and the same 256 KiB limit per project. See README.md.

export const MAX_PROJECT_BYTES = 256 * 1024;
const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,120}$/;

const clone = o => JSON.parse(JSON.stringify(o));
const err = (code, message) => Object.assign(new Error(message), { code });
export const newId = (prefix = 'p') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function summary(p) {
  return { id: p.id, name: p.name || 'Untitled', createdAt: p.createdAt || 0, updatedAt: p.updatedAt || 0, bpm: p.bpm, lengthBars: p.lengthBars };
}
const byRecent = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);

// Stamps id / createdAt / updatedAt on the caller's object (so later saves keep the same id), checks size.
function prepare(project) {
  if (!project || typeof project !== 'object') throw err('invalid_argument', 'save: project must be an object');
  if (!project.id) project.id = newId();
  if (!ID_RE.test(project.id) || project.id === '.' || project.id === '..') throw err('invalid_argument', `bad project id "${project.id}" (letters, digits, _ - . ~ : @ + only)`);
  const t = Date.now();
  if (!project.createdAt) project.createdAt = t;
  project.updatedAt = t;
  const json = JSON.stringify(project);
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > MAX_PROJECT_BYTES) throw err('too_large', `project is ${Math.ceil(bytes / 1024)} KiB, limit is 256 KiB`);
  return JSON.parse(json);
}

function api(backend, raw) {
  const store = {
    backend,
    async list() { return (await raw.all()).map(summary).sort(byRecent); },
    async load(id) { const p = await raw.get(id); return p ? clone(p) : null; },
    async save(project) { const p = prepare(project); await raw.put(p); return clone(p); },
    async remove(id) { await raw.del(id); },
    async duplicate(id, newName) {
      const p = await raw.get(id); if (!p) throw err('not_found', `no project ${id}`);
      const copy = clone(p); copy.id = newId(); copy.name = newName || `${p.name || 'Untitled'} copy`; copy.createdAt = 0;
      return store.save(copy);
    },
  };
  return store;
}

// ---------------------------------------------------------------- backends

async function retryOnce(fn) {
  try { return await fn(); } catch (e) {
    if (e?.code !== 'unavailable') throw e;
    await new Promise(r => setTimeout(r, 300 + Math.random() * 700));
    return fn();
  }
}

function dbBackend(db, userId) {
  const col = () => db.collection(`data/users/${userId}/studio/projects`);
  return {
    async all() { const s = await retryOnce(() => col().get()); return s.docs.filter(d => d.exists !== false).map(d => d.data()); },
    async get(id) { const s = await retryOnce(() => col().doc(id).get()); return s.exists ? s.data() : null; },
    async put(p) { await retryOnce(() => col().doc(p.id).set(p)); },
    async del(id) { await retryOnce(() => col().doc(id).delete()); },
  };
}

function idbBackend(appKey) {
  const open = () => new Promise((res, rej) => {
    const rq = indexedDB.open(`nfx-studio-${appKey}`, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('projects', { keyPath: 'id' });
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); rq.onblocked = () => rej(new Error('IndexedDB blocked'));
  });
  let dbp = null;
  const run = async (mode, fn) => {
    const db = await (dbp ||= open());
    return new Promise((res, rej) => {
      const tx = db.transaction('projects', mode), st = tx.objectStore('projects'), rq = fn(st);
      tx.oncomplete = () => res(rq?.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('IndexedDB aborted'));
    });
  };
  return {
    probe: () => run('readonly', st => st.count()),
    all: () => run('readonly', st => st.getAll()),
    get: async id => (await run('readonly', st => st.get(id))) || null,
    put: p => run('readwrite', st => st.put(p)),
    del: id => run('readwrite', st => st.delete(id)),
  };
}

function memoryBackend() {
  const m = new Map();
  return {
    async all() { return [...m.values()].map(clone); },
    async get(id) { return m.has(id) ? clone(m.get(id)) : null; },
    async put(p) { m.set(p.id, clone(p)); },
    async del(id) { m.delete(id); },
  };
}

/**
 * Open the project store. Options: appKey (names the IndexedDB database), backend ('db'|'indexeddb'|'memory') to
 * force one (tests), useTimeoutMs (how long to wait for the viewer, default 10000 like the runtime itself).
 * Resolves {backend, list(), load(id), save(project), remove(id), duplicate(id, newName)}.
 */
export async function openProjects({ appKey = 'studio', backend, useTimeoutMs = 10000 } = {}) {
  if (!backend || backend === 'db') {
    const c = globalThis.claude;
    if (typeof c?.use === 'function') {
      try {
        const within = p => Promise.race([p, new Promise(r => setTimeout(() => r(null), useTimeoutMs))]);
        const [db, user] = await within(Promise.all([c.use('db'), c.use('user')])) || [];
        const userId = db && user ? await user.id?.() : null;
        // A view-only person has an id but cannot write: keep their projects in this browser instead.
        const canWrite = user?.can ? await user.can('data.write') : null;
        if (db && userId && canWrite !== false) return api('db', dbBackend(db, userId));
      } catch { /* fall through to local storage */ }
    }
    if (backend === 'db') throw err('unavailable', 'db + user capabilities are not available here');
  }
  if ((!backend || backend === 'indexeddb') && typeof indexedDB !== 'undefined') {
    try { const b = idbBackend(appKey); await b.probe(); return api('indexeddb', b); }
    catch (e) { if (backend === 'indexeddb') throw e; }
  }
  return api('memory', memoryBackend());
}

/**
 * Debounced autosave: call `touch()` after every edit; the project is saved `ms` after the last edit. Saves never
 * overlap (an edit during a save queues one more save). Saves pending work when the tab is hidden or closed.
 * Options: onSave(savedProject), onError(error).
 * Returns {touch(), flush() -> Promise, cancel(), dispose(), get pending(), get saving(), saves, lastSavedAt}.
 */
export function autosave(store, getProject, ms = 1500, { onSave, onError } = {}) {
  let timer = null, saving = null, again = false;
  const ctl = {
    saves: 0, lastSavedAt: 0,
    get pending() { return timer !== null || again; },
    get saving() { return saving !== null; },
    touch() { clearTimeout(timer); timer = setTimeout(run, ms); },
    async flush() { clearTimeout(timer); timer = null; await run(); while (saving) await saving; },
    cancel() { clearTimeout(timer); timer = null; again = false; },
    dispose() { ctl.cancel(); removeEventListener('pagehide', onHide); document.removeEventListener?.('visibilitychange', onVis); },
  };
  function run() {
    timer = null;
    if (saving) { again = true; return saving; }
    let project;
    try { project = getProject(); } catch (e) { onError?.(e); return Promise.resolve(); }
    if (!project) return Promise.resolve();
    saving = Promise.resolve().then(() => store.save(project))
      .then(saved => { ctl.saves++; ctl.lastSavedAt = Date.now(); onSave?.(saved); }, e => onError?.(e))
      .finally(() => { saving = null; if (again) { again = false; run(); } });
    return saving;
  }
  const onHide = () => { if (timer !== null) ctl.flush(); };
  const onVis = () => { if (document.visibilityState === 'hidden') onHide(); };
  if (typeof addEventListener === 'function') addEventListener('pagehide', onHide);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  return ctl;
}
