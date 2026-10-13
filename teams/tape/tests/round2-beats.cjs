// BEATS lane tests. Usage: cd /home/user/nicofoxheart/studio && NODE_PATH=$(npm root -g) node teams/tape/tests/round2-beats.cjs [logic|sound|ui]
// logic: step-sequencer data helpers in Node. sound: tests/round2-beats.html offline renders (numbers + spectrograms in qa/).
// ui: mounts js/ui/steps.js inside the real app (index.html), clicks / drags / alt-clicks / mutes, screenshot qa/beats-steps.png.
const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..'), QA = path.join(ROOT, 'qa');
fs.mkdirSync(QA, { recursive: true });
const only = process.argv[2];
const fails = [], ok = (cond, msg) => { if (!cond) fails.push(msg); };
const summary = {};

async function logic() {
  const S = await import(path.join(ROOT, 'js/ui/steps.js'));
  const c = { id: 'c', startBeat: 0, lengthBeats: 4, notes: [{ p: 72, s: 1, d: 1, v: 0.5 }] };
  ok(S.beatInfo(c).steps === 16, 'default steps from clip length');
  S.setStep(c, 36, 0, 0.9); S.setStep(c, 42, 3, 0.6); S.setStep(c, 38, 4, 1);
  ok(c.notes.length === 4 && c.notes.find(n => n.p === 42).s === 0.75, 'setStep writes ordinary notes');
  ok(S.toggleStep(c, 42, 3) === false && !c.notes.some(n => n.p === 42), 'toggle off');
  S.setStep(c, 42, 3, 0.6); S.setStep(c, 42, 1, 0.6);
  S.setSwing(c, 0.5);
  ok(c.notes.find(n => n.p === 42 && n.s > 0.5).s === 0.875 && c.notes.find(n => n.p === 42 && n.s < 0.5).s === 0.375, 'swing delays odd steps by swing*step');
  ok(c.notes.find(n => n.p === 36).s === 0 && c.notes.find(n => n.p === 38).s === 1, 'swing keeps even steps');
  ok(c.notes.find(n => n.p === 72).s === 1, 'non-drum notes untouched by swing');
  const g = S.readGrid(c); ok(g.rows.get(42)[1] === 0.6 && g.rows.get(42)[3] === 0.6 && g.rows.get(36)[0] > 0.89, 'readGrid maps swung notes back to steps');
  S.setSwing(c, 0.75); ok(S.readGrid(c).rows.get(42)[3] > 0 && S.readGrid(c).rows.get(42)[4] === 0, 'max swing still unambiguous');
  S.setSwing(c, 0); ok(c.notes.find(n => n.p === 42 && n.s > 0.5).s === 0.75, 'swing back to straight');
  S.setRowMute(c, 42, true); ok(!c.notes.some(n => n.p === 42) && c.beat.muted.length === 2, 'mute moves notes out of notes[]');
  S.setStep(c, 42, 5, 0.7); ok(c.beat.muted.length === 3 && !c.notes.some(n => n.p === 42), 'adding on a muted row stays muted');
  S.setRowMute(c, 42, false); ok(c.notes.filter(n => n.p === 42).length === 3 && c.beat.muted.length === 0, 'unmute restores notes');
  S.setLength(c, 12); ok(c.lengthBeats === 3, 'length sets clip length');
  S.setLength(c, 16); const before = c.notes.filter(n => n.p >= 36 && n.p <= 51).length;
  S.repeatPattern(c, 2); ok(c.lengthBeats === 8 && c.notes.filter(n => n.p >= 36 && n.p <= 51).length === before * 2, 'repeat x2 doubles');
  ok(S.nextVel(0) === 0.4 && S.nextVel(1) === 0.7 && S.nextVel(0.7) === 0.4 && S.nextVel(0.4) === 1, 'accent cycle');
  S.setStep(c, 36, 0, 0.3); ok(S.getStep(c, 36, 0) === 0.3, 'velocity edit');
  S.clearPattern(c); ok(c.notes.length >= 1 && c.notes.every(n => n.p === 72), 'clear keeps non-drum notes');
  ok(S.stepOf(0.30, 0) === 1 && S.stepOf(0.45, 0.75) === 1 && S.stepOf(0.49, 0.75) === 2, 'stepOf');
  ok(JSON.parse(JSON.stringify(c)).beat.steps === 32, 'metadata is JSON');
  summary.logic = 'done';
}

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mp3': 'audio/mpeg', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (req.method === 'POST' && u === '/__save') {
      const name = path.basename(new URL(req.url, 'http://x').searchParams.get('name') || 'out.bin'); const chunks = [];
      req.on('data', ch => chunks.push(ch)); req.on('end', () => { fs.writeFileSync(path.join(QA, name), Buffer.concat(chunks)); res.writeHead(200); res.end('ok'); });
      return;
    }
    const f = path.join(ROOT, u === '/' ? 'index.html' : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  });
  return new Promise(r => server.listen(0, () => r(server)));
}

async function sound(browser, port) {
  const page = await browser.newPage(); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/tests/round2-beats.html`);
  for (let i = 0; i < 800 && !errors.length && !(await page.evaluate(() => !!window.__result)); i++) await new Promise(r => setTimeout(r, 300));
  if (errors.length) throw new Error(errors.join(' | '));
  const r = await page.evaluate(() => window.__result); await page.close();
  ok(!errors.length, 'page errors: ' + errors.join(' | '));
  for (const k of r.raw) {
    ok(!k.nan && !k.clipped && k.peakDb < -1, `raw ${k.kit} peak ${k.peakDb} clipped ${k.clipped} nan ${k.nan}`);
    ok(k.ended === k.made, `raw ${k.kit}: ${k.ended}/${k.made} voices ended (cleanup)`);
    for (const v of k.per) {
      ok(v.peakDb > -40, `raw ${k.kit} ${v.name} silent (${v.peakDb})`);
      // short voices fall at least 25 dB below their own peak within 1 s (crash, riser, boom kick and the Phonk cowbell ring on purpose)
      if (![49, 50, 51].includes(v.midi) && !(k.kit === 'phonk' && [47, 48].includes(v.midi))) ok(v.tailDb < v.peakDb - 25, `raw ${k.kit} ${v.name} rings past 1 s (${v.tailDb} vs peak ${v.peakDb})`);
    }
  }
  for (const b of r.bass) { ok(!b.nan && !b.clipped && b.peakDb < -1 && b.peakDb > -30, `808 ${b.preset} peak ${b.peakDb}`); ok(b.ended === b.made, `808 ${b.preset} cleanup ${b.ended}/${b.made}`); }
  for (const g of r.groove) { ok(!g.nan && !g.clipped && g.peakDb < -1 && g.peakDb > -35, `groove ${g.kit} peak ${g.peakDb}`); ok(g.maxVoices <= 64 && g.maxNodes < 3000, `groove ${g.kit} voices ${g.maxVoices} nodes ${g.maxNodes}`); ok(g.endDb < -60 && g.endVoices === 0, `groove ${g.kit} tail ${g.endDb} voices left ${g.endVoices}`); }
  ok(!r.stress.nan && !r.stress.clipped && r.stress.peakDb < -1 && r.stress.maxNodes < 3000, `stress ${JSON.stringify(r.stress)}`);
  const gl = r.glide;
  ok(Math.abs(gl.before - 65.4) < 2 && Math.abs(gl.after - 98) < 2.5 && Math.abs(gl.third - 87.3) < 2.5, `808 glide pitches ${gl.before} / ${gl.after} / ${gl.third}`);
  ok(gl.maxVoices <= 2 && gl.endVoices === 0 && !gl.clipped && !gl.nan && gl.endDb < -60, `808 glide voices ${gl.maxVoices} left ${gl.endVoices} end ${gl.endDb}`);
  ok(!r.phonk808.clipped && !r.phonk808.nan && r.phonk808.peakDb < -1, `phonk 808 peak ${r.phonk808.peakDb}`);
  fs.writeFileSync(path.join(QA, 'beats-results.json'), JSON.stringify(r, null, 1));
  // one spectrogram per instrument family
  for (const [w, png] of [['beats-raw-drums.wav', 'beats-drums-spectrogram.png'], ['beats-808-glide.wav', 'beats-808-spectrogram.png']]) {
    try { execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(QA, w), '-lavfi', 'showspectrumpic=s=1200x500:legend=1:scale=log:fscale=log', path.join(QA, png)]); }
    catch (e) { fails.push('spectrogram ' + png + ': ' + e.message); }
  }
  summary.sound = {
    raw: r.raw.map(k => `${k.kit} peak ${k.peakDb} (quietest ${Math.min(...k.per.map(v => v.peakDb))}, loudest ${Math.max(...k.per.map(v => v.peakDb))})`),
    bass: r.bass.map(b => `${b.preset} ${b.peakDb}`), groove: r.groove.map(g => `${g.kit} peak ${g.peakDb} rms ${g.rmsDb} voices ${g.maxVoices} nodes ${g.maxNodes}`),
    stress: `${r.stress.notes} notes peak ${r.stress.peakDb} voices ${r.stress.maxVoices} nodes ${r.stress.maxNodes}`,
    glide: `${gl.before} -> ${gl.during} -> ${gl.after} -> ${gl.third} Hz, voices ${gl.maxVoices}`, phonk808: r.phonk808.peakDb,
  };
}

async function ui(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => window.__studio?.status().project, null, { timeout: 30000 });
  await page.evaluate(async () => {
    const st = await import('./js/ui/state.js'); const steps = await import('./js/ui/steps.js');
    const { DRUM_INSTRUMENTS } = await import('./js/sound/drums.js'); const ins = await import('./js/sound/instruments.js');
    for (const d of DRUM_INSTRUMENTS) if (!ins.INSTRUMENT_MAP[d.id]) { ins.INSTRUMENTS.push(d); ins.INSTRUMENT_MAP[d.id] = d; }
    const S = st.S;
    st.edit(p => { p.tracks.push({ id: 'tdrum', name: 'Garage drums', color: '#2E5BD4', kind: 'instrument', instrument: { id: 'drums', preset: 'future-garage', params: {} }, volumeDb: -6, pan: 0, mute: false, solo: false, sends: { space: 0.2, echo: 0 }, fx: [], clips: [] }); }, { type: 'all' });
    const body = document.querySelector('.dock-body'); body.querySelectorAll('.pane').forEach(p => { p.hidden = true; });
    const pane = document.createElement('div'); pane.className = 'pane'; pane.id = 'pane-beats'; body.append(pane);
    S.tab = 'beats'; steps.initSteps(pane);
    S.sel.trackId = 'tdrum'; S.sel.clipId = null; st.emit('select');
    window.__steps = { st, steps };
  });
  await page.click('#stp-new');
  const clip = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__steps.st.clipOf().c)));
  let c = await clip(); ok(c.notes.length === 6 && c.beat.steps === 16, 'new pattern starts with kick + hats: ' + c.notes.length);
  const cell = (m, k) => `.stp-cell[data-m="${m}"][data-k="${k}"]`;
  await page.click(cell(39, 4)); await page.click(cell(39, 12));
  c = await clip(); ok(c.notes.filter(n => n.p === 39).length === 2, 'click toggles clap on');
  await page.click(cell(39, 12)); c = await clip(); ok(c.notes.filter(n => n.p === 39).length === 1, 'click toggles off');
  // drag-paint shaker across 4 cells
  const b0 = await page.locator(cell(44, 0)).boundingBox(), b3 = await page.locator(cell(44, 3)).boundingBox();
  await page.mouse.move(b0.x + 8, b0.y + 8); await page.mouse.down(); await page.mouse.move(b3.x + 8, b3.y + 8, { steps: 6 }); await page.mouse.up();
  c = await clip(); ok(c.notes.filter(n => n.p === 44).length === 4, 'drag paints 4 shaker steps: ' + c.notes.filter(n => n.p === 44).length);
  // velocity drag on the kick at step 0: drag down 45 px -> about 0.5 lower
  const bk = await page.locator(cell(36, 0)).boundingBox();
  await page.mouse.move(bk.x + 8, bk.y + 8); await page.mouse.down(); await page.mouse.move(bk.x + 8, bk.y + 53, { steps: 5 }); await page.mouse.up();
  c = await clip(); const kv = c.notes.find(n => n.p === 36 && n.s === 0)?.v; ok(kv > 0.3 && kv < 0.5, 'drag sets velocity: ' + kv);
  await page.click(cell(38, 6), { modifiers: ['Alt'] }); c = await clip(); ok(c.notes.find(n => n.p === 38)?.v === 0.4, 'alt-click adds a ghost');
  await page.click('#stp-mute-42'); c = await clip(); ok(!c.notes.some(n => n.p === 42) && c.beat.muted.length === 4, 'row mute');
  ok(await page.locator('#stp-mute-42').getAttribute('aria-pressed') === 'true', 'mute key lit');
  await page.click('#stp-mute-42'); c = await clip(); ok(c.notes.filter(n => n.p === 42).length === 4, 'row unmute');
  await page.focus('#stp-swing'); for (let i = 0; i < 9; i++) await page.keyboard.press('PageUp');
  c = await clip(); ok(c.beat.swing > 0.6 && c.notes.some(n => n.p === 44 && n.s > 0.9 && n.s < 0.95), 'swing knob offsets odd steps: ' + c.beat.swing);
  await page.click('#stp-len-32'); c = await clip(); ok(c.lengthBeats === 8 && (await page.locator('.stp-cell[data-m="36"]').count()) === 32, 'length 32 steps');
  await page.click('#stp-len-16'); await page.click('#stp-x2'); c = await clip(); ok(c.lengthBeats === 8 && c.notes.filter(n => n.p === 39).length === 2, 'repeat x2');
  // keyboard: focus grid, cursor right x2 from (0,0), Enter toggles kick at step 2
  await page.focus('#stp-scroll'); for (let i = 0; i < 16; i++) await page.keyboard.press('ArrowUp'); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  c = await clip(); ok(c.notes.some(n => n.p === 36 && n.s === 0.5), 'keyboard toggles a step'); ok(await page.locator('.stp-cell.cur').count() === 1, 'keyboard cursor drawn');
  // undo restores the previous state
  await page.keyboard.press('Control+z'); c = await clip(); ok(!c.notes.some(n => n.p === 36 && n.s === 0.5), 'undo');
  // engine plays the drum clip (live context): start playback, sample a meter
  const playing = await page.evaluate(async () => { const { S } = window.__steps.st; await S.ctx?.resume?.(); const c = window.__steps.st.clipOf().c; S.engine.play(c.startBeat); await new Promise(r => setTimeout(r, 1200)); let pk = -120; for (let i = 0; i < 10; i++) { pk = Math.max(pk, S.engine.meter('tdrum').peakDb); await new Promise(r => setTimeout(r, 60)); } const ph = !document.querySelector('.stp-ph').hidden; S.engine.stop(); return { pk, ph }; });
  ok(playing.pk > -50, 'drum track sounds in the app: ' + playing.pk); ok(playing.ph, 'playhead shown while playing');
  await page.screenshot({ path: path.join(QA, 'beats-steps.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  ok(!overflow, 'no horizontal page overflow');
  ok(!errors.length, 'ui console errors: ' + errors.join(' | '));
  summary.ui = { meter: playing.pk };
  await page.close();
}

(async () => {
  const t0 = Date.now();
  if (!only || only === 'logic') await logic();
  if (!only || only !== 'logic') {
    const { chromium } = require('playwright');
    const server = await serve(), port = server.address().port;
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    try {
      if (!only || only === 'sound') await sound(browser, port);
      if (!only || only === 'ui') await ui(browser, port);
    } catch (e) { fails.push('crash: ' + e.message); }
    await browser.close(); server.close();
  }
  console.log(JSON.stringify(summary, null, 1));
  console.log(fails.length ? 'FAIL\n- ' + fails.join('\n- ') : 'PASS', `(${Math.round((Date.now() - t0) / 1000)} s)`);
  process.exit(fails.length ? 1 : 0);
})();
