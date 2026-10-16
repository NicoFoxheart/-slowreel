// Shared test server for the visual tests: serves the studio root, maps pinned CDN modules to local copies.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const THREE_LOCAL = '/home/user/nicofoxheart/redesign/shared/three@0.160.0';
const SK = b => `<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style></head><body>${b}</body></html>`;
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mp3': 'audio/mpeg', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };
function serve() {
  return new Promise(res => { const s = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
    const f = path.join(ROOT, u); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    let b = fs.readFileSync(f); if (f.endsWith('.html') && !/^\s*<!doctype/i.test(b.toString())) b = Buffer.from(SK(b.toString()));
    r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream', 'Content-Length': b.length }); r.end(b); });
    s.listen(0, () => res(s)); });
}
function cdn(u) {
  let m = u.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/((?:build|examples)\/[^?#]+)/); if (m) return path.join(THREE_LOCAL, m[1]);
  m = u.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:mp4|webm)-muxer@[\d.]+)\/(build\/[^?#]+)/); if (m) return path.join(ROOT, 'shared/vendor', m[1], m[2]);
  if (/lamejs\/1\.2\.1\/lame\.min\.js/.test(u)) return path.join(ROOT, 'shared/vendor/lame.min.js');
  return null;
}
async function route(ctxOrPage) {
  await ctxOrPage.route('**/*', r => { const u = r.request().url(); if (u.startsWith('http://127.0.0.1')) return r.continue();
    const f = cdn(u); if (f && fs.existsSync(f)) return r.fulfill({ path: f, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } });
    return r.abort(); });
}
module.exports = { serve, route, ROOT, ARGS: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
