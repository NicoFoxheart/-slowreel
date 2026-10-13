// Copied verbatim from shared/qa.cjs (MOCK): a stand-in for the claude.ai viewer runtime (downloads + db + user).
// Injected by run.cjs with addInitScript in the "viewer" contexts. Saves are recorded in window.__saved.
(() => {
  const saved = window.__saved = [];
  const store = new Map();
  const mkDoc = p => ({ path: p, async get(){ const v = store.get(p); return { exists: v !== undefined, data: () => v === undefined ? undefined : JSON.parse(JSON.stringify(v)), id: p.split('/').pop() }; },
    async set(d){ store.set(p, JSON.parse(JSON.stringify(d))); }, async update(d){ store.set(p, Object.assign({}, store.get(p) || {}, JSON.parse(JSON.stringify(d)))); },
    async delete(){ store.delete(p); }, onSnapshot(fn){ this.get().then(fn); return () => {}; } });
  const mkCol = p => ({ path: p, doc: id => mkDoc(p + '/' + (id || Math.random().toString(36).slice(2))),
    async get(){ const docs = [...store.keys()].filter(k => k.startsWith(p + '/') && k.slice(p.length + 1).split('/').length === 1).map(k => ({ id: k.split('/').pop(), exists: true, data: () => JSON.parse(JSON.stringify(store.get(k))) })); return { docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f) }; },
    async add(d){ const doc = mkDoc(p + '/' + Math.random().toString(36).slice(2)); await doc.set(d); return doc; },
    where(){ return this; }, orderBy(){ return this; }, limit(){ return this; }, onSnapshot(fn){ this.get().then(fn); return () => {}; } });
  const caps = {
    downloads: { async save({ filename, data }) { let bytes = 0; if (data instanceof Blob) bytes = data.size; else if (data && data.byteLength !== undefined) bytes = data.byteLength; else bytes = String(data).length;
      if (!/\.(gif|png|jpg|jpeg|webp|mp4|webm|txt|json|md|docx|pptx|epub|csv|ttf|html|svg|pdf|xlsx|zip)$/i.test(filename)) { const e = { code: 'rejected_extension', message: 'extension not allowed' }; throw e; }
      saved.push({ filename, bytes, blob: data instanceof Blob ? data : null }); return { status: 'saved' }; } },
    db: { collection: mkCol, doc: mkDoc },
    user: { async id(){ return 'nico-test'; }, async me(){ return { id: 'nico-test', name: 'Nico' }; }, isOwner(){ return true; }, canEdit(){ return true; }, can(){ return true; } },
  };
  window.claude = { use: name => new Promise(r => setTimeout(() => r(Object.prototype.hasOwnProperty.call(caps, name) ? Object.freeze(caps[name]) : null), 50)) };
})();
