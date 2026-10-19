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
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const w of (process.argv[2]||'1280,1440,1920').split(',').map(Number)) {
    const p = await b.newPage({ viewport: { width: w, height: w > 1600 ? 1080 : 900 }, deviceScaleFactor: +(process.env.DSF||1) });
    p.on('console', m => { if (m.type() === 'error' || /ui3d/.test(m.text())) console.log('  console:', m.text()); });
    p.on('pageerror', e => console.log('  pageerror', e.message));
    await p.route('**/*', r => { const u = r.request().url(); if (u.startsWith('http://127.0.0.1')) return r.continue();
      const j = u.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/((?:build|examples)\/[^?#]+)/);
      const tl = '/home/user/nicofoxheart/redesign/shared/three@0.160.0';
      if (j && fs.existsSync(path.join(tl, j[1]))) return r.fulfill({ path: path.join(tl, j[1]), contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } });
      return r.abort(); });
    await p.goto(`http://127.0.0.1:${srv.address().port}/teams/tape/${process.argv[3]||''}`, { waitUntil: 'load' }); await p.waitForTimeout(+(process.argv[4]||2500));
    const m = await p.evaluate(() => [...document.querySelectorAll('.deck > .module')].map(e => e.className.split(' ')[1] + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)).join(' ') + ' overflowX=' + (document.documentElement.scrollWidth - document.documentElement.clientWidth));
    console.log(w, m);
    if (process.argv[5]) { await p.screenshot({ path: `shot-${w}.png` }); await p.screenshot({ path: `deck-${w}.png`, clip: { x: 0, y: 0, width: w, height: 170 } }); }
    await p.close();
  }
  await b.close(); srv.close();
});
