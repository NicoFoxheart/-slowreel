// Plays the Slowreel demo in Chromium and measures what could cause stutter.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = '/home/user/nicofoxheart/studio';
const SK = b => `<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${b}</body></html>`;
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.json': 'application/json', '.css': 'text/css' };
const srv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const f = path.join(ROOT, u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  let b = fs.readFileSync(f); if (f.endsWith('.html') && !/^\s*<!doctype/i.test(b)) b = Buffer.from(SK(b.toString()));
  r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); r.end(b); });
srv.listen(0, async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(() => {
    window.__long = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] }); } catch {}
    const O = window.AudioContext; let made = [];
    window.AudioContext = function (o) { const c = new O(o); made.push({ c, opts: o }); window.__ctxs = made; return c; }; window.AudioContext.prototype = O.prototype;
    const cc = O.prototype.createConvolver; window.__conv = [];
    O.prototype.createConvolver = function () { const n = cc.call(this); const d = Object.getOwnPropertyDescriptor(ConvolverNode.prototype, 'buffer');
      Object.defineProperty(n, 'buffer', { set(v) { window.__conv.push(v ? +(v.duration.toFixed(2)) : 0); d.set.call(this, v); }, get() { return d.get.call(this); } }); return n; };
    let srcCount = 0; const cbs = O.prototype.createBufferSource; O.prototype.createBufferSource = function () { srcCount++; window.__src = srcCount; return cbs.call(this); };
    let oscCount = 0; const co = O.prototype.createOscillator; O.prototype.createOscillator = function () { oscCount++; window.__osc = oscCount; return co.call(this); };
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/*', r => r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort());
  await p.goto(`http://127.0.0.1:${srv.address().port}/teams/tape/`, { waitUntil: 'load' }); await p.waitForTimeout(3000);
  await p.mouse.click(5, 5);
  const t0 = Date.now(); await p.evaluate(() => window.__studio.play()); const playCallMs = Date.now() - t0;
  // measure scheduler timer drift for 12 s
  const drift = await p.evaluate(() => new Promise(res => { const gaps = []; let last = performance.now(); const id = setInterval(() => { const n = performance.now(); gaps.push(n - last); last = n; }, 25);
    setTimeout(() => { clearInterval(id); gaps.sort((a, b) => a - b); res({ p50: Math.round(gaps[gaps.length >> 1]), p99: Math.round(gaps[Math.floor(gaps.length * 0.99)]), max: Math.round(gaps[gaps.length - 1]), over150: gaps.filter(g => g > 150).length }); }, 12000); }));
  const info = await p.evaluate(() => { const c = (window.__ctxs || [])[0]; return { latencyHint: c && c.opts, baseLatency: c && c.c.baseLatency, sampleRate: c && c.c.sampleRate,
    convolverIRseconds: window.__conv, bufferSourcesCreated: window.__src, oscillatorsCreated: window.__osc, longTasksMs: window.__long.slice(0, 30), status: window.__studio.status() }; });
  console.log(JSON.stringify({ playCallMs, drift, ...info, errs }, null, 1));
  await b.close(); srv.close();
});
