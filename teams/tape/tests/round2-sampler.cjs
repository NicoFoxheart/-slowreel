// Usage: cd /home/user/nicofoxheart/studio && NODE_PATH=$(npm root -g) node teams/tape/tests/round2-sampler.cjs
// Chop Sampler + fx2 + automation: offline renders checked with numbers, plus a short UI smoke test (screenshot in qa/).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..'), QA = path.join(ROOT, 'qa');
fs.mkdirSync(QA, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
(async () => {
  await new Promise(r => server.listen(0, r));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [], fails = [];
  let R = null;
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    const t0 = Date.now();
    await page.goto(`http://localhost:${server.address().port}/tests/round2-sampler.html`);
    await page.waitForFunction(() => window.__result, null, { timeout: 240000, polling: 300 });
    R = await page.evaluate(() => window.__result);
    if (R.error) throw new Error(R.error);
    R.wallMs = Date.now() - t0;
    // ---- UI: add 2 points, drag one, double-click delete one; pick a slice, reverse it
    const svg = page.locator('#auto-ed svg'); const bb = await svg.boundingBox();
    await page.mouse.click(bb.x + 24 * 4, bb.y + 15); await page.mouse.click(bb.x + 24 * 12, bb.y + 55);
    await page.mouse.move(bb.x + 24 * 12, bb.y + 55); await page.mouse.down(); await page.mouse.move(bb.x + 24 * 16, bb.y + 40, { steps: 4 }); await page.mouse.up();
    const after2 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__uiTrack.automation)));
    await page.locator('#auto-ed select').selectOption({ index: 0 });
    await page.mouse.dblclick(bb.x + 24 * 4, bb.y + 15);
    const afterDel = await page.evaluate(() => JSON.parse(JSON.stringify(window.__uiTrack.automation)));
    await page.locator('#chop-panel .slices .key').nth(2).click();
    await page.locator('#chop-reverse').click();
    const ui = await page.evaluate(() => ({ slices: document.querySelectorAll('#chop-panel .slices .key').length, edits: window.__uiTrack.instrument.slices, counts: window.__uiCounts(), status: document.querySelector('#chop-panel .status').textContent }));
    R.ui = { after2, afterDel, ...ui };
    await page.screenshot({ path: path.join(QA, 'round2-sampler-ui.png'), fullPage: true });
  } catch (e) { errors.push('run: ' + (e.stack || e)); }
  await browser.close(); server.close();
  if (R && !R.error) {
    const S = R.sampler, F = R.fx, A = R.automation;
    const sound = (name, s) => { if (!s || s.nan || s.clipped || s.peakDb > -1 || s.peakDb < -50) fails.push(`${name}: peak ${s?.peakDb} clipped ${s?.clipped} nan ${s?.nan}`); };
    if (S.slicing.equal !== 8 || S.slicing.transient !== 8 || S.slicing.transientErrMs > 15) fails.push('slicing ' + JSON.stringify(S.slicing));
    sound('sampler hits', S.hits); if (S.hits.perBeat.some(x => x < -45)) fails.push('a slice is silent ' + S.hits.perBeat);
    if (!(S.reverse.revFirst50ms < S.reverse.fwdFirst50ms - 6)) fails.push('reverse not audible ' + JSON.stringify(S.reverse));
    if (!(S.slicePitch.zcUp12 > S.slicePitch.zcOrig * 1.7)) fails.push('slice pitch ' + JSON.stringify(S.slicePitch));
    if (Math.abs(S.slowed.hz0 - 440) > 8 || Math.abs(S.slowed.hz1 - 330) > 8) fails.push('slowed pitch ' + JSON.stringify(S.slowed));
    if (!(S.slowed.tail1 > S.slowed.tail0 + 6)) fails.push('slowed reverb ' + JSON.stringify(S.slowed));
    if (S.slowed.loopHeld < S.slowed.early - 3) fails.push('loop does not hold ' + S.slowed.loopHeld);
    sound('sampler slowed', S.slowed); sound('sampler song', S.song); if (S.song.missing) fails.push('song sample missing');
    if (!S.import.stored || !S.import.reloadedFromIdb || !S.import.sameHash || S.import.missing[0] !== 'Lost loop') fails.push('import ' + JSON.stringify(S.import));
    for (const k of ['pump', 'pumpKick', 'tapestop', 'crusher', 'autofilter', 'widener']) sound('fx ' + k, F[k]);
    if (!(F.pump.swingDb > 6 && F.pump.drySwingDb < 1.5 && F.pump.onBeat < F.pump.offBeat - 6)) fails.push('pump ' + JSON.stringify(F.pump));
    if (!(F.pumpKick.atKick1_5 < F.pumpKick.atBeat1_noKick - 8)) fails.push('pump kick ' + JSON.stringify(F.pumpKick));
    if (!(F.tapestop.lastBit < F.tapestop.beforeStop - 12 && Math.abs(F.tapestop.afterRestart - F.tapestop.beforeStop) < 2 && F.tapestop.zcSlowing < F.tapestop.zcNormal * 0.8)) fails.push('tapestop ' + JSON.stringify(F.tapestop));
    if (!(F.crusher.errorDb > -20 && F.crusher.brightCrushed > F.crusher.brightDry + 1)) fails.push('crusher ' + JSON.stringify(F.crusher));
    if (!(F.autofilter.swingDb > 6 && F.autofilter.brightMid > F.autofilter.brightStart + 3)) fails.push('autofilter ' + JSON.stringify(F.autofilter));
    if (!(F.widener.sideWide > F.widener.sideDry + 3 && F.widener.sideMonoIn < -60 && F.widener.sideMonoHaas > -20 && F.widener.sideWidth0 < -60)) fails.push('widener ' + JSON.stringify(F.widener));
    if (F.defs.some(d => !d.enumsOk)) fails.push('fx enum format ' + JSON.stringify(F.defs));
    for (const v of A.volume) if (Math.abs(v.got - v.want) > 1.5) fails.push(`automation volume at ${v.t}s got ${v.got} want ${v.want}`);
    const fb = A.filterBright; if (!(fb[3] > fb[0] + 6 && fb[1] > fb[0] && fb[2] > fb[1])) fails.push('automation filter sweep ' + fb);
    if (A.panLeft.left < -12) fails.push('pan automation ' + JSON.stringify(A.panLeft));
    sound('automation', A.stats);
    const u = R.ui || {};
    if (!u.after2 || u.after2.length !== 1 || u.after2[0].points.length !== 2) fails.push('ui add points ' + JSON.stringify(u.after2));
    if (!u.afterDel || u.afterDel[0]?.points.length !== 1) fails.push('ui delete point ' + JSON.stringify(u.afterDel));
    if (u.slices !== 8 || !u.edits?.[2]?.reverse) fails.push('ui sampler ' + JSON.stringify({ slices: u.slices, edits: u.edits }));
  } else fails.push('no result');
  if (errors.length) fails.push(...errors.map(e => 'console: ' + e));
  if (R) { R.fails = fails; fs.writeFileSync(path.join(QA, 'round2-sampler-results.json'), JSON.stringify(R, null, 1)); }
  console.log(JSON.stringify(R, null, 1));
  console.log(fails.length ? 'FAIL\n- ' + fails.join('\n- ') : 'PASS');
  process.exit(fails.length ? 1 : 0);
})();
