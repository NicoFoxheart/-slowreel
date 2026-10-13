// Usage: cd /home/user/nicofoxheart/studio && NODE_PATH=$(npm root -g) node teams/tape/tests/round2-synths.cjs [presets|arp]
// Serves teams/tape, runs tests/round2-synths.html in headless Chromium, prints verdicts, saves qa/round2-synth-*.wav,
// qa/round2-synth-*.png (spectrograms via ffmpeg) and qa/round2-synths-results.json.
const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..'), QA = path.join(ROOT, 'qa');
fs.mkdirSync(QA, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && u === '/__save') {
    const name = path.basename(new URL(req.url, 'http://x').searchParams.get('name') || 'out.bin'); const chunks = [];
    req.on('data', c => chunks.push(c)); req.on('end', () => { fs.writeFileSync(path.join(QA, name), Buffer.concat(chunks)); res.writeHead(200); res.end('ok'); });
    return;
  }
  const f = path.join(ROOT, u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
(async () => {
  await new Promise(r => server.listen(0, r));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  let res = null;
  const t0 = Date.now();
  try {
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    const only = process.argv[2] ? '?only=' + process.argv[2] : '';
    await page.goto(`http://localhost:${server.address().port}/tests/round2-synths.html${only}`);
    await page.waitForFunction(() => window.__result, null, { timeout: 300000, polling: 500 });
    res = await page.evaluate(() => window.__result);
  } catch (e) { errors.push('run: ' + e.message); }
  await browser.close(); server.close();
  if (!res) { console.log(JSON.stringify({ errors }, null, 1)); process.exit(1); }
  res.errors = errors; res.wallMs = Date.now() - t0;
  const fails = [];
  if (errors.length) fails.push('console: ' + errors.slice(0, 3).join(' | '));
  if (res.meta.engineSees !== res.meta.synths) fails.push('engine does not list all synths');
  for (const f of res.format) if (!f.ok) fails.push(`format ${f.id}: ${f.bad.join(', ')}`);
  for (const r of res.synths) {
    const k = `${r.inst}/${r.preset}`;
    if (r.peakDb < -40) fails.push(`${k} silent (${r.peakDb})`);
    if (r.peakDb > -1 || r.clipped || r.nan) fails.push(`${k} peak ${r.peakDb} clipped ${r.clipped} nan ${r.nan}`);
    if (r.lastDb > -60) fails.push(`${k} tail does not die (${r.lastDb})`);
    if (r.tailRises > 0) fails.push(`${k} tail rises`);
    if (Math.abs(r.dc) > 5) fails.push(`${k} DC ${r.dc}`);
    if (r.stats && (r.stats.maxVoices > 16 || r.stats.maxNodes > 3000)) fails.push(`${k} voices ${r.stats.maxVoices} nodes ${r.stats.maxNodes}`);
  }
  if (res.stress) { const s = res.stress; if (s.peakDb > -1 || s.clipped || s.nan || s.stats.maxVoices > Math.max(64, s.feltMaxVoices + 8) || s.stats.maxNodes > 3000) fails.push('stress ' + JSON.stringify(s)); }
  const A = res.arp;
  if (A && A.up) {
    const want = { 'up.n': [A.up.n, 16], 'up.first': [A.up.first, '60,64,67,60'], 'up.step': [A.up.step, 0.25], down: [A.down, '67,64,60,67'],
      updown: [A.updown, '60,64,67,72,76,79,76,72,67,64,60'], played: [A.played, '67,60,64'], oct4: [A.oct4, 103], trip: [A.trip, 12], t32: [A.t32, 32],
      swing0: [A.swing[0], 0], swing1: [A.swing[1], 0.3125], swing2: [A.swing[2], 0.5], gate: [A.gate, 0.125], off: [A.off, true], clipLen: [A.clipLen <= 2, true],
      gap: [A.gap, '0,2'], memo: [A.memo, true], paramsOk: [A.paramsOk, true], randomDet: [A.random.deterministic, true], randomSpread: [A.random.distinct >= 4, true] };
    for (const k in want) if (want[k][0] !== want[k][1]) fails.push(`arp ${k}: got ${want[k][0]} want ${want[k][1]}`);
    const r = A.render; if (r.peakDb < -40 || r.peakDb > -1 || r.clipped || r.nan || r.lastDb > -60) fails.push('arp render ' + JSON.stringify(r));
    const L = A.live; if (!L.active || L.ons < 6 || L.ons > 10 || L.offs !== L.ons || L.maxJitterMs > 15 || L.meterDb < -60 || L.notes.slice(0, 11) !== '60,64,67,72') fails.push('live arp ' + JSON.stringify(L));
  }
  // spectrograms: one per synth family + the arp render
  const pngs = [];
  for (const f of fs.readdirSync(QA).filter(f => /^round2-synth-.*\.wav$/.test(f))) {
    const png = path.join(QA, f.replace('.wav', '.png'));
    try { execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(QA, f), '-lavfi', 'showspectrumpic=s=800x300:legend=1:scale=log:fscale=log:stop=16000', png]); pngs.push(path.basename(png)); }
    catch (e) { fails.push('spectrogram ' + f); }
  }
  res.spectrograms = pngs; res.fails = fails;
  fs.writeFileSync(path.join(QA, 'round2-synths-results.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res, (k, v) => (k === 'stats' && v ? `v${v.maxVoices} n${v.maxNodes}` : v)));
  console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'PASS');
  process.exit(fails.length ? 1 : 0);
})();
