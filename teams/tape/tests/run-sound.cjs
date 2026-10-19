// Usage: cd /home/user/nicofoxheart/studio && NODE_PATH=$(npm root -g) node teams/tape/tests/run-sound.cjs [presets|effects|demo|live]
// Serves teams/tape, opens tests/sound.html in headless Chromium, prints the numbers, saves qa/demo-render.wav and qa/sound-results.json.
const http = require('http'), fs = require('fs'), path = require('path');
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
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  const only = process.argv[2] ? '?only=' + process.argv[2] : '';
  const t0 = Date.now();
  await page.goto(`http://localhost:${server.address().port}/tests/sound.html${only}`);
  let res = null;
  try { await page.waitForFunction(() => window.__result, null, { timeout: 480000, polling: 500 }); res = await page.evaluate(() => window.__result); }
  catch (e) { errors.push('timeout: ' + e.message); }
  await browser.close(); server.close();
  if (!res) { console.log(JSON.stringify({ errors }, null, 1)); process.exit(1); }
  res.errors = errors; res.wallMs = Date.now() - t0;
  // verdicts
  const fails = [];
  for (const r of res.instruments) {
    if (r.peakDb < -45) fails.push(`${r.inst}/${r.preset} silent (${r.peakDb})`);
    if (r.peakDb > -1 || r.clipped || r.nan) fails.push(`${r.inst}/${r.preset} peak ${r.peakDb} clipped ${r.clipped} nan ${r.nan}`);
    // temple bells / bowls ring on past this 14 s window by design; asian.cjs checks them dead below -60 dB over a long window.
    // Here they must only keep falling (>= 25 dB below the end of the phrase, never rising).
    if (r.inst === 'templebells' ? (r.tailDrop < 25 || r.tailRises > 1) : r.lastDb > -60) fails.push(`${r.inst}/${r.preset} tail does not die (${r.lastDb} dB at end)`);
    if (r.tailRises > 0) fails.push(`${r.inst}/${r.preset} tail rises ${r.tailRises}x`);
    if (r.stats && (r.stats.maxVoices > 64 || r.stats.maxNodes > 3000)) fails.push(`${r.inst}/${r.preset} voices ${r.stats.maxVoices} nodes ${r.stats.maxNodes}`);
  }
  for (const r of res.effects) {
    if (r.peakDb > -1 || r.clipped || r.nan) fails.push(`fx ${r.fx} peak ${r.peakDb} clipped ${r.clipped} nan ${r.nan}`);
    // 'infinite' (the default extreme reverb case) is meant to hold for a long time: it only has to keep falling
    if ((r.fx === 'reverb' ? r.lastDb > r.endDb - 6 : r.lastDb > r.endDb - 20) || r.tailRises > 1) fails.push(`fx ${r.fx} no natural decay: end ${r.endDb} last ${r.lastDb} rises ${r.tailRises}`);
  }
  if (res.demo) {
    const d = res.demo;
    if (d.peakDb > -1 || d.clipped || d.nan) fails.push(`demo peak ${d.peakDb} clipped ${d.clipped} nan ${d.nan}`);
    if (d.rmsDb < -40) fails.push(`demo too quiet ${d.rmsDb}`);
    if (d.lastDb > -55) fails.push(`demo tail does not die: ${d.lastDb}`);
    if (d.stats.maxVoices > 64 || d.stats.maxNodes > 3000) fails.push(`demo voices ${d.stats.maxVoices} nodes ${d.stats.maxNodes}`);
  }
  if (res.unity && Math.abs(res.unity.diffDb) > 1) fails.push('song clip level changed by the master: ' + JSON.stringify(res.unity));
  if (res.live && (!res.live.playing || res.live.posBeat < 64.5 || res.live.feltMeter.peakDb < -80 || res.live.grains < 3)) fails.push('live: ' + JSON.stringify(res.live));
  res.fails = fails;
  fs.writeFileSync(path.join(QA, 'sound-results' + (process.argv[2] ? '-' + process.argv[2] : '') + '.json'), JSON.stringify(res, null, 1));
  const brief = { ...res, demo: res.demo && { ...res.demo, perSecond: undefined } };
  console.log(JSON.stringify(brief, (k, v) => (k === 'stats' && v ? `v${v.maxVoices} n${v.maxNodes} g${v.maxGrains}` : v)));
  console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'PASS');
  process.exit(fails.length ? 1 : 0);
})();
