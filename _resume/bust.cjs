// Usage: node bust.cjs <appDir> <version>  - stamps ?v=<version> on every relative .js/.css/.json reference (not comments, not mp3)
const fs = require('fs'), path = require('path');
const [dir, ver] = process.argv.slice(2);
const files = ['index.html'];
(function walk(d) { for (const f of fs.readdirSync(path.join(dir, d))) { const p = path.join(d, f);
  if (fs.statSync(path.join(dir, p)).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })('js');
for (const d of ['lib']) for (const f of fs.readdirSync(path.join(dir, d))) if (f.endsWith('.js')) files.push(path.join(d, f));
const re = /(['"])((?:\.\.?\/|js\/|css\/)[^'"\s?#]+\.(?:js|css|json)|demo-night-garage\.json)(?:\?v=[\w.-]+)?\1/g;
let n = 0;
for (const f of files) { const p = path.join(dir, f), src = fs.readFileSync(p, 'utf8');
  const out = src.split('\n').map(line => /^\s*(\/\/|\*)/.test(line) ? line : line.replace(re, (m, q, u) => (n++, `${q}${u}?v=${ver}${q}`))).join('\n');
  if (out !== src) fs.writeFileSync(p, out); }
console.log('stamped', n, 'references in', files.length, 'files');
