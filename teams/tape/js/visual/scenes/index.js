// index.js - the scene registry. Every scene is a module in this folder (scenes/<id>.js) loaded lazily the first time it
// is needed (on the page for its meta, in the workers to render). A scene whose file is missing, fails to load or has a
// broken contract is hidden (listScenes({available: true}) leaves it out) and never breaks the studio.
// The static entries below are what the picker shows before a module loads; the module's own `meta` wins once loaded.

export const GROUPS = ['Cozy', 'Korea', 'Japan', 'China', 'Nature', 'Night city', 'Classic'];
export const DEFAULT_SCENE = 'rain-window';

const ENTRIES = [
  { id: 'rain-window', swatch: ['#2b3445', '#e0a86a'], name: 'Rain on the window', group: 'Cozy', desc: 'A rainy window, warm room light, city bokeh outside.', load: () => import('./rain-window.js?v=9c') },
  { id: 'hanok-rain', swatch: ['#1f2a2c', '#f0a25a'], name: 'Hanok in the rain', group: 'Korea', desc: 'A Korean hanok courtyard in soft rain, paper lanterns, wet stone.', load: () => import('./hanok-rain.js?v=9c') },
  { id: 'bamboo-temple', hidden: true, swatch: ['#1d3324', '#d9e2b0'], name: 'Bamboo temple', group: 'Japan', desc: 'A Japanese temple path through tall bamboo, light shafts and mist.', load: () => import('./bamboo-temple.js?v=9c') },
  { id: 'guilin-mist', swatch: ['#5d7280', '#e9d9c0'], name: 'Guilin mist', group: 'China', desc: 'Karst peaks over the Li river at dawn, drifting mist, a bamboo raft.', load: () => import('./guilin-mist.js?v=9c') },
  { id: 'golden-ocean', hidden: true, swatch: ['#2a4a66', '#ffb35c'], name: 'Golden ocean', group: 'Nature', desc: 'An open ocean at golden hour, slow swell and sun glitter.', load: () => import('./golden-ocean.js?v=9c') },
  { id: 'aurora-snow', swatch: ['#0d1f3a', '#5ff0b0'], name: 'Aurora snow', group: 'Nature', desc: 'Northern lights over a snowy valley, falling snow, a frozen lake.', load: () => import('./aurora-snow.js?v=9c') },
  { id: 'neon-night', swatch: ['#1a0f2e', '#ff4fa0'], name: 'Neon night', group: 'Night city', desc: 'A wet neon street at night, signs glowing in the puddles.', load: () => import('./neon-night.js?v=9c') },
  { id: 'heart', swatch: ['#1d1640', '#ff7fbf'], name: 'Fox heart', group: 'Classic', desc: "Nico's glowing fox heart under a dusk sky.", load: () => import('./heart.js?v=9c') },
  // test scene for the kit (scene-check.cjs kit-demo); not shown in the picker
  { id: 'kit-demo', swatch: ['#20242c', '#ffc98a'], name: 'Kit demo', group: 'Classic', desc: 'Reference scene for the kit.', hidden: true, load: () => import('./kit-demo.js?v=9c') },
];
const BY_ID = new Map(ENTRIES.map(e => [e.id, e]));
const state = new Map();   // id -> {promise, ok, error, meta}

/** Static info for every scene (no module loading): [{id, name, group, desc, hidden, swatch: [dark, light], status: 'unknown'|'ok'|'broken', meta?}] */
export function listScenes({ available = false, includeHidden = false } = {}) {
  return ENTRIES.filter(e => (includeHidden || !e.hidden) && (!available || state.get(e.id)?.ok))
    .map(e => { const s = state.get(e.id); const m = s?.meta; return { id: e.id, name: m?.name || e.name, group: m?.group || e.group, desc: m?.desc || e.desc, hidden: !!e.hidden, swatch: m?.swatch || e.swatch,
      status: !s || !('ok' in s) ? 'unknown' : s.ok ? 'ok' : 'broken', meta: m || null }; });
}
export const sceneEntry = id => BY_ID.get(id) || null;
export const knownScene = id => BY_ID.has(id);

function check(id, mod) {
  const m = mod?.meta;
  if (!m || typeof mod.createScene !== 'function') throw new Error(`scene "${id}" must export meta and createScene`);
  if (m.id !== id) throw new Error(`scene "${id}": meta.id is "${m.id}"`);
  if (!Array.isArray(m.variants) || !m.variants.length || !m.variants.every(v => v && typeof v.id === 'string')) throw new Error(`scene "${id}": meta.variants must be [{id, name}]`);
  const meta = { ...m, group: GROUPS.includes(m.group) ? m.group : BY_ID.get(id).group, name: m.name || BY_ID.get(id).name, desc: m.desc || BY_ID.get(id).desc };
  if (!m.variants.some(v => v.id === m.defaultVariant)) meta.defaultVariant = m.variants[0].id;
  return meta;
}

/** Load a scene module (cached). Resolves {module, meta}; rejects (and marks the scene broken) when it cannot be used. */
export function loadScene(id) {
  const e = BY_ID.get(id);
  if (!e) return Promise.reject(new Error(`unknown scene "${id}"`));
  let s = state.get(id);
  if (!s) {
    s = {};
    s.promise = e.load().then(mod => { const meta = check(id, mod); Object.assign(s, { ok: true, meta, module: mod }); return { module: mod, meta }; },
      err => { Object.assign(s, { ok: false, error: String(err?.message || err) }); throw err; });
    state.set(id, s);
  }
  return s.promise;
}

/** The scene's meta, or null when it cannot be loaded (never throws). */
export async function sceneMeta(id) { try { return (await loadScene(id)).meta; } catch { return null; } }

/** Load metas one after another (so a slow network never floods), calling onEach({id, ok, meta}) as each settles. */
export async function probeScenes(ids = ENTRIES.filter(e => !e.hidden).map(e => e.id), onEach = () => { }) {
  const out = [];
  for (const id of ids) { const meta = await sceneMeta(id); const r = { id, ok: !!meta, meta }; out.push(r); try { onEach(r); } catch { } }
  return out;
}

/** The variant to use: the asked one if the scene has it, else its default. */
export function pickVariant(meta, variant) { return meta?.variants?.some(v => v.id === variant) ? variant : meta?.defaultVariant || meta?.variants?.[0]?.id; }

/** Text colours for the title layer: variant.text > meta.text > a warm neutral. */
export function textStyle(meta, variant) {
  const v = meta?.variants?.find(x => x.id === variant);
  return { ink: '#f6f1e7', accent: '#ffd7a0', ...(meta?.text || {}), ...(v?.text || {}) };
}
