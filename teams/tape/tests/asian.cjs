// East Asian pack tests. Usage: cd /home/user/nicofoxheart/studio && NODE_PATH=$(npm root -g) node teams/tape/tests/asian.cjs [presets|checks]
// Serves teams/tape, runs tests/asian.html in headless Chromium, prints verdicts, saves qa/asian-*.wav,
// qa/asian-*.png (spectrograms via ffmpeg) and qa/asian-results.json.
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
    await page.goto(`http://localhost:${server.address().port}/tests/asian.html${only}`);
    await page.waitForFunction(() => window.__result, null, { timeout: 600000, polling: 500 });
    res = await page.evaluate(() => window.__result);
  } catch (e) { errors.push('run: ' + e.message); }
  await browser.close(); server.close();
  if (!res) { console.log(JSON.stringify({ errors }, null, 1)); process.exit(1); }
  res.errors = errors; res.wallMs = Date.now() - t0;
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  if (errors.length) fails.push('console: ' + errors.slice(0, 3).join(' | '));
  ok(res.meta.engineSees === res.meta.instruments && res.meta.instruments === 14, 'engine does not list all 14 instruments');
  for (const f of res.format) ok(f.ok, `format ${f.id}: ${f.bad.join(', ')}`);
  ok(res.scales.ok && res.scales.n === 13, 'scales ' + JSON.stringify(res.scales));
  const caps = Object.fromEntries(res.format.map(f => [f.id, 0]));
  for (const r of res.renders) {
    const k = `${r.inst}/${r.preset}`;
    ok(r.peakDb > -40, `${k} silent (${r.peakDb})`);
    ok(r.peakDb < -1 && !r.clipped && !r.nan, `${k} peak ${r.peakDb} clipped ${r.clipped} nan ${r.nan}`);
    ok(r.lastDb < -60, `${k} tail does not die (${r.lastDb})`);
    ok(!r.tailRises, `${k} tail rises`);
    ok(Math.abs(r.dc) < 5, `${k} DC ${r.dc}`);
    ok(r.stats && r.stats.maxVoices <= 16 && r.stats.maxNodes < 3000, `${k} voices ${r.stats?.maxVoices} nodes ${r.stats?.maxNodes}`);
  }
  for (const r of res.light) {
    ok(r.peakDb > -40 && r.peakDb < -1 && !r.clipped && !r.nan && r.lastDb < -60, `light ${r.inst} ${JSON.stringify({ pk: r.peakDb, last: r.lastDb, clip: r.clipped })}`);
    ok(r.stats.maxNodes <= r.fullNodes, `light ${r.inst} costs more nodes (${r.stats.maxNodes} > ${r.fullNodes})`);
  }
  const C = res.checks;
  for (const k of Object.keys(C).filter(k => k.startsWith('family-'))) { const f = C[k]; ok(f.peakDb < -1 && f.peakDb > -30 && !f.clipped && !f.nan && f.lastDb < -60, `${k} ${JSON.stringify(f)}`); }
  if (C.tuning) {
    for (const id in C.tuning) ok(C.tuning[id].every(c => Math.abs(c) < 8), `tuning ${id} ${C.tuning[id].join(',')} cents`);
    ok(Math.abs(C.oshide.before) < 15 && Math.abs(C.oshide.after - 100) < 20, 'ato-oshi (bend 0.5 = 1 semitone) ' + JSON.stringify(C.oshide));
    ok(Math.abs(C.oshiHanashi.start - 100) < 20 && Math.abs(C.oshiHanashi.end) < 15, 'oshi-hanashi ' + JSON.stringify(C.oshiHanashi));
    ok(Math.abs(C.nonghyeon.start) < 15 && C.nonghyeon.max - C.nonghyeon.min > 70, 'nonghyeon ' + JSON.stringify(C.nonghyeon));
    ok(C.meri.early < -40 && Math.abs(C.meri.settled) < 12, 'meri ' + JSON.stringify(C.meri));
    ok(Math.abs(C.slide.first) < 15 && C.slide.mid < -80 && Math.abs(C.slide.landed) < 15, 'slide ' + JSON.stringify(C.slide));
    ok(Math.abs(C.tremolo.onsetsPerSec - C.tremolo.want) < 4 && C.tremolo.tailDb < -60 && C.tremolo.dead, 'tremolo ' + JSON.stringify(C.tremolo));
    for (const id of ['janggu', 'taiko']) for (const m of [36, 37, 38, 39, 40]) { const d = C[id][m]; ok(d.peakDb > -40 && d.peakDb < -1 && d.lastDb < -60, `${id} ${m} ${JSON.stringify(d)}`); }
    ok(C.janggu[36].centroid < C.janggu[38].centroid * 0.6, 'janggu kung not lower than deok');
    ok(C.taiko[40].centroid < C.taiko[36].centroid && C.taiko[36].centroid < C.taiko[38].centroid, 'taiko o-daiko < don < shime');
    ok(C.chimes.strikes >= 6 && C.chimes.late === 0 && C.chimes.lastDb < -60 && C.chimes.ended, 'chimes ' + JSON.stringify(C.chimes));
    ok(C.stress.peakDb < -1 && !C.stress.clipped && C.stress.stats.maxVoices <= C.stress.feltMaxVoices + 8, 'stress ' + JSON.stringify(C.stress));
  }
  // spectrograms
  const pngs = [];
  for (const f of fs.readdirSync(QA).filter(f => /^asian-.*\.wav$/.test(f))) {
    const png = path.join(QA, f.replace('.wav', '.png'));
    try { execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(QA, f), '-lavfi', 'showspectrumpic=s=900x320:legend=1:scale=log:fscale=log:stop=16000', png]); pngs.push(path.basename(png)); }
    catch (e) { fails.push('spectrogram ' + f); }
  }
  res.spectrograms = pngs; res.fails = fails;
  fs.writeFileSync(path.join(QA, 'asian-results.json'), JSON.stringify(res, null, 1));
  const brief = (k, v) => (k === 'stats' && v ? `v${v.maxVoices} n${v.maxNodes}` : v);
  for (const r of res.renders) console.log(`${(r.inst + '/' + r.preset).padEnd(34)} pk ${String(r.peakDb).padStart(6)} rms ${String(r.rmsDb).padStart(7)} last ${String(r.lastDb).padStart(6)} rtf ${String(r.rtf).padStart(6)} ${brief('stats', r.stats)}`);
  for (const r of res.light) console.log(`light ${r.inst.padEnd(12)} pk ${r.peakDb} last ${r.lastDb} ${brief('stats', r.stats)} (full n${r.fullNodes})`);
  console.log(JSON.stringify({ format: res.format.filter(f => !f.ok), scales: res.scales, checks: res.checks, wallMs: res.wallMs }, brief));
  console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'PASS');
  process.exit(fails.length ? 1 : 0);
})();
