// Usage: NODE_PATH=$(npm root -g) node shared/qa.cjs <dir-under-studio> [outDir]
// Serves /home/user/nicofoxheart/studio, wraps an artifact-form index.html in the publish skeleton, maps the
// pinned CDN libraries to local copies (the container cannot reach CDNs), blocks every other host, injects a
// mock window.claude (downloads + db + user) like the claude.ai viewer, then:
//   - screenshots desktop 1440x900 and phone 390x844 (top + full page)
//   - reports console errors, horizontal overflow, opacity:0 text
//   - if the page exposes window.__studio (the test contract in BRIEF.md): presses play, reads status(),
//     renders 8 s offline and reports peak/rms, and calls exportMaster() to check the zip that would be saved.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const dir = process.argv[2]; if (!dir) { console.error('usage: qa.cjs <dir> [outDir]'); process.exit(1); }
const out = path.resolve(process.argv[3] || path.join(ROOT, dir, 'qa'));
fs.mkdirSync(out, { recursive: true });
const SKELETON = b => `<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${b}</body></html>`;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mp3': 'audio/mpeg', '.json': 'application/json', '.css': 'text/css', '.wav': 'audio/wav', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const f = path.join(ROOT, u); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(f); const ext = path.extname(f);
  if (ext === '.html' && !/^\s*<!doctype/i.test(body.toString())) body = Buffer.from(SKELETON(body.toString()));
  const size = body.length, range = req.headers.range;
  if (range && ext === '.mp3') { const [s, e] = range.replace('bytes=', '').split('-').map(Number); const end = e || size - 1;
    res.writeHead(206, { 'Content-Type': types[ext], 'Content-Range': `bytes ${s}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - s + 1 }); return res.end(body.slice(s, end + 1)); }
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': size }); res.end(body);
});
// Mock of the claude.ai viewer runtime: claude.use('downloads'|'db'|'user'). Saves are recorded in window.__saved.
const MOCK = `(() => {
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
      if (!/\\.(gif|png|jpg|jpeg|webp|mp4|webm|txt|json|md|docx|pptx|epub|csv|ttf|html|svg|pdf|xlsx|zip)$/i.test(filename)) { const e = { code: 'rejected_extension', message: 'extension not allowed' }; throw e; }
      saved.push({ filename, bytes, blob: data instanceof Blob ? data : null }); return { status: 'saved' }; } },
    db: { collection: mkCol, doc: mkDoc },
    user: { async id(){ return 'nico-test'; }, async me(){ return { id: 'nico-test', name: 'Nico' }; }, isOwner(){ return true; }, canEdit(){ return true; }, can(){ return true; } },
  };
  window.claude = { use: name => new Promise(r => setTimeout(() => r(Object.prototype.hasOwnProperty.call(caps, name) ? Object.freeze(caps[name]) : null), 50)) };
})();`;
server.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}/${dir}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const report = { dir, viewports: {} };
  for (const [name, vp] of Object.entries({ desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } })) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: 'dark', hasTouch: name === 'phone', isMobile: name === 'phone' });
    await ctx.addInitScript(MOCK);
    const page = await ctx.newPage(); const errors = [], blocked = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.route('**/*', r => { const u = r.request().url();
      if (u.startsWith('http://127.0.0.1')) return r.continue();
      if (/cdnjs\.cloudflare\.com\/ajax\/libs\/lamejs\/1\.2\.1\/lame\.min\.js/.test(u)) return r.fulfill({ path: path.join(ROOT, 'shared/vendor/lame.min.js'), contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } });
      const j = u.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/((?:build|examples)\/[^?#]+)/);
      const tl = '/home/user/nicofoxheart/redesign/shared/three@0.160.0';
      if (j && fs.existsSync(path.join(tl, j[1]))) return r.fulfill({ path: path.join(tl, j[1]), contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } });
      const mx = u.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:mp4|webm)-muxer@5\.(?:2\.2|1\.4))\/(build\/[^?#]+)/);   // video export muxers (vendored in shared/vendor)
      if (mx && fs.existsSync(path.join(ROOT, 'shared/vendor', mx[1], mx[2]))) return r.fulfill({ path: path.join(ROOT, 'shared/vendor', mx[1], mx[2]), contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } });
      blocked.push(u); return r.abort(); });
    await page.goto(base, { waitUntil: 'load' }); await page.waitForTimeout(4000);
    const metrics = await page.evaluate(() => {
      const de = document.documentElement, overflowX = de.scrollWidth - de.clientWidth;
      const wide = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > de.clientWidth + 1 || r.left < -1) && getComputedStyle(e).position !== 'fixed' && !e.closest('[data-scroll]'); }).slice(0, 8).map(e => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '') + ` [${Math.round(e.getBoundingClientRect().left)}..${Math.round(e.getBoundingClientRect().right)}]`);
      const hidden = [...document.querySelectorAll('h1,h2,h3,p,li,a,button,label')].filter(e => e.textContent.trim() && +getComputedStyle(e).opacity === 0).length;
      return { title: document.title, overflowX, wide, hiddenTextEls: hidden, hasStudioApi: !!window.__studio };
    });
    await page.screenshot({ path: path.join(out, `${name}-top.png`) });
    await page.screenshot({ path: path.join(out, `${name}-full.png`), fullPage: true });
    let studio = 'no window.__studio';
    if (metrics.hasStudioApi && name === 'desktop') {
      studio = {};
      try { await page.mouse.click(5, 5); await page.evaluate(() => window.__studio.play()); await page.waitForTimeout(3000);
        studio.statusWhilePlaying = await page.evaluate(() => window.__studio.status());
        await page.screenshot({ path: path.join(out, 'desktop-playing.png') });
        await page.evaluate(() => window.__studio.stop());
      } catch (e) { studio.playError = String(e.message || e).split('\n')[0]; }
      try { studio.render8s = await page.evaluate(() => window.__studio.renderOffline(8)); } catch (e) { studio.renderError = String(e.message || e).split('\n')[0]; }
      try { const t0 = Date.now(); studio.exportResult = await page.evaluate(() => window.__studio.exportMaster({ seconds: 6 })); studio.exportMs = Date.now() - t0;
        studio.saved = await page.evaluate(() => (window.__saved || []).map(s => ({ filename: s.filename, bytes: s.bytes }))); } catch (e) { studio.exportError = String(e.message || e).split('\n')[0]; }
    }
    report.viewports[name] = { ...metrics, consoleErrors: errors.filter(e => !/fonts\.g|ERR_FAILED|net::|status of 404 \(Not Found\).*favicon/.test(e)).slice(0, 12), blockedExternal: [...new Set(blocked.map(u => new URL(u).host))], studio };
    await ctx.close();
  }
  await browser.close(); server.close();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2)); console.log('screenshots in', out);
});
