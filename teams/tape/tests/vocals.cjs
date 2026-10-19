// Voices pack tests. Usage: cd /home/user/nicofoxheart/studio && NODE_PATH=$(npm root -g) node teams/tape/tests/vocals.cjs [presets|checks|showcase]
// Serves teams/tape, runs tests/vocals.html in headless Chromium, prints verdicts, saves qa/vocals-*.wav, qa/vocals-*.png
// (spectrograms via ffmpeg), qa/vocals-results.json and an MP3 preview of the showcase (path in argv[3] or MP3_OUT).
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
    await page.goto(`http://localhost:${server.address().port}/tests/vocals.html${only}`);
    await page.waitForFunction(() => window.__result, null, { timeout: 600000, polling: 500 });
    res = await page.evaluate(() => window.__result);
  } catch (e) { errors.push('run: ' + e.message); }
  await browser.close(); server.close();
  if (!res) { console.log(JSON.stringify({ errors }, null, 1)); process.exit(1); }
  res.errors = errors; res.wallMs = Date.now() - t0;
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  if (errors.length) fails.push('console: ' + errors.slice(0, 3).join(' | '));
  ok(res.meta.engineSees === res.meta.instruments && res.meta.instruments === 5, 'engine does not list all 5 instruments');
  for (const f of res.format) ok(f.ok, `format ${f.id}: ${f.bad.join(', ')}`);
  for (const r of res.renders) {
    const k = `${r.inst}/${r.preset}`;
    ok(r.peakDb > -36, `${k} silent (${r.peakDb})`);
    ok(r.peakDb < -6 && !r.clipped && !r.nan, `${k} peak ${r.peakDb} clipped ${r.clipped} nan ${r.nan}`);
    ok(r.lastDb < -60, `${k} tail does not die (${r.lastDb})`);
    ok(!r.tailRises, `${k} tail rises`);
    ok(Math.abs(r.dc) < 5, `${k} DC ${r.dc}`);
    ok(r.stats && r.stats.maxVoices <= 16 && r.stats.maxNodes < 1500, `${k} voices ${r.stats?.maxVoices} nodes ${r.stats?.maxNodes}`);
  }
  for (const r of res.light) {
    ok(r.peakDb > -36 && r.peakDb < -6 && !r.clipped && !r.nan && r.lastDb < -60, `light ${r.inst} ${JSON.stringify({ pk: r.peakDb, last: r.lastDb, clip: r.clipped })}`);
    ok(r.stats.maxNodes < r.fullNodes, `light ${r.inst} does not cost fewer nodes (${r.stats.maxNodes} vs ${r.fullNodes})`);
  }
  for (const f of res.formants) {
    const [w1, w2] = f.want, k = `${f.kind} ${f.vowel}`;
    if (f.kind === 'soprano') { ok(Math.abs(f.f2 / w2 - 1) < 0.2, `${k} F2 ${f.f2} want ~${w2}`); continue; }
    const tol1 = f.kind === 'sung' ? 0.2 : 0.15, tol2 = f.kind === 'sung' ? 0.15 : 0.12;   // sung: harmonics are 110 Hz apart
    ok(Math.abs(f.f1 / w1 - 1) < tol1, `${k} F1 ${f.f1} want ${w1}`);
    if (f.vowel !== 'mm') { ok(Math.abs(f.f2 / w2 - 1) < tol2, `${k} F2 ${f.f2} want ${w2}`); ok(f.cls === f.vowel, `${k} classified as ${f.cls}`); }
  }
  const C = res.checks;
  if (C.glide) ok(Math.abs(C.glide.before) < 20 && C.glide.mid > 60 && C.glide.mid < 460 && Math.abs(C.glide.after - 500) < 25, 'glide ' + JSON.stringify(C.glide));
  // starting a note (what the scheduler / noteOn pay on the main thread): under 2.5 ms (strings / tapepad are listed for scale)
  if (C.noteStartMs) for (const k in C.noteStartMs) if (!/^(strings|tapepad)/.test(k)) ok(C.noteStartMs[k].ms < 2.5, `note start ${k} ${C.noteStartMs[k].ms} ms`);
  if (C.soprano) { const S = C.soprano; ok(S.ee.h4 > S.ooh.h4 + 12 && S.ee.h4 > S.aah.h4 + 6 && S.aah.h2 > S.ooh.h2 + 4, 'soprano vowels not apart ' + JSON.stringify(S)); }
  if (C.showcase) ok(C.showcase.peakDb < -3 && C.showcase.peakDb > -30 && !C.showcase.clipped && !C.showcase.nan && C.showcase.lastDb < -60, 'showcase ' + JSON.stringify(C.showcase));
  // spectrograms + the MP3 preview
  const pngs = [];
  for (const f of fs.readdirSync(QA).filter(f => /^vocals-.*\.wav$/.test(f))) {
    const png = path.join(QA, f.replace('.wav', '.png')), wide = f === 'vocals-showcase.wav';
    try { execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(QA, f), '-lavfi', `showspectrumpic=s=${wide ? '1400x420' : '900x320'}:legend=1:scale=log:fscale=log:stop=8000`, png]); pngs.push(path.basename(png)); }
    catch (e) { fails.push('spectrogram ' + f); }
  }
  const mp3 = process.argv[3] || process.env.MP3_OUT;
  if (mp3 && fs.existsSync(path.join(QA, 'vocals-showcase.wav'))) {
    try { execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(QA, 'vocals-showcase.wav'), '-codec:a', 'libmp3lame', '-b:a', '256k', mp3]); res.mp3 = mp3; }
    catch (e) { fails.push('mp3 ' + e.message); }
  }
  res.spectrograms = pngs; res.fails = fails;
  fs.writeFileSync(path.join(QA, 'vocals-results.json'), JSON.stringify(res, null, 1));
  const brief = (k, v) => (k === 'stats' && v ? `v${v.maxVoices} n${v.maxNodes}` : v);
  for (const r of res.renders) console.log(`${(r.inst + '/' + r.preset).padEnd(30)} pk ${String(r.peakDb).padStart(6)} rms ${String(r.rmsDb).padStart(7)} last ${String(r.lastDb).padStart(6)} rtf ${String(r.rtf).padStart(6)} ${brief('stats', r.stats)}`);
  for (const r of res.light) console.log(`light ${r.inst.padEnd(12)} pk ${r.peakDb} last ${r.lastDb} ${brief('stats', r.stats)} (full n${r.fullNodes})`);
  for (const f of res.formants) console.log(`${f.kind.padEnd(8)} ${f.vowel.padEnd(4)} F1 ${String(f.f1).padStart(5)} (${f.want[0]})  F2 ${String(f.f2).padStart(5)} (${f.want[1]})  -> ${f.cls || ''}`);
  console.log(JSON.stringify({ format: res.format.filter(f => !f.ok), checks: res.checks, wallMs: res.wallMs }, brief));
  console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'PASS');
  process.exit(fails.length ? 1 : 0);
})();
