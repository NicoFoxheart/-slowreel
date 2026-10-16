// Music video tests: NODE_PATH=$(npm root -g) node teams/tape/tests/video.cjs [--skip-phone] [--skip-pc]
// PC: opens the Visual window (screenshot), exports 9:16 from the project, 16:9 and 1:1 from Nico's songs through
// window.__studio.exportVideo, ffprobes each file (size, fps, frames, audio, duration), extracts 3 frames as PNG,
// checks the H.264/AAC configs, and measures play() + timer drift + long tasks with the preview open.
// Phone: 390x844 isMobile + touch, CPU throttled 4x, "Make a music video" -> a song -> export 5 s; long tasks while rendering.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { serve, route, ARGS } = require('./serve.cjs');
const OUT = path.resolve(__dirname, '../qa'); fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const MOCK = `(() => { window.__saved = []; window.claude = { use: n => Promise.resolve(n === 'downloads' ? { async save({ filename, data }) {
  if (!/\\.(mp4|webm|zip)$/.test(filename)) throw { code: 'rejected_extension' }; window.__saved.push({ filename, bytes: data.size, blob: data }); return { status: 'saved' }; } } : null) };
  const AC = window.AudioContext; if (AC) window.AudioContext = class extends AC { constructor(o) { super(o); window.__audioCtxCount = (window.__audioCtxCount || 0) + 1; } };
  window.__long = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push({ t: Math.round(e.startTime), d: Math.round(e.duration) }))).observe({ entryTypes: ['longtask'] }); } catch {} })();`;
const results = { pc: {}, phone: {} };
const probe = file => {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,sample_rate,channels:format=duration,format_name', '-of', 'json', file]).toString());
  const v = j.streams.find(s => s.codec_type === 'video'), a = j.streams.find(s => s.codec_type === 'audio');
  return { container: j.format.format_name, duration: +(+j.format.duration).toFixed(3), video: v && { codec: v.codec_name, width: v.width, height: v.height, fps: v.r_frame_rate, avgFps: v.avg_frame_rate, frames: +v.nb_read_frames },
    audio: a && { codec: a.codec_name, sampleRate: +a.sample_rate, channels: a.channels, frames: +a.nb_read_frames } };
};
async function lastSaved(page, name) {
  const { filename, b64 } = await page.evaluate(async () => { const s = window.__saved[window.__saved.length - 1];
    const b = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(s.blob); }); return { filename: s.filename, b64: b }; });
  const file = path.join(OUT, name + path.extname(filename)); fs.writeFileSync(file, Buffer.from(b64, 'base64')); return { file, filename };
}
const check = (r, want) => { const p = r.probe, ok = p.video && p.video.width === want.w && p.video.height === want.h && /^30(\/1)?$/.test(p.video.fps) && p.audio && Math.abs(p.duration - want.sec) < 0.12 && p.video.frames === Math.round(want.sec * 30);
  r.pass = !!ok; return ok; };

(async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/teams/tape/`;
  const browser = await chromium.launch({ args: ARGS });
  let fail = 0;
  if (!args.includes('--skip-pc')) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(MOCK); await route(ctx);
    const page = await ctx.newPage(), errors = [];
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(base + '?device=pc'); await page.waitForFunction(() => window.__studio?.status().project, null, { timeout: 60000 });
    await page.mouse.click(5, 5);
    // the Visual window
    await page.click('#b-visual'); await page.waitForSelector('#vz-canvas canvas', { timeout: 30000 }); await page.waitForTimeout(6000);   // lets the preview settle its resolution on this (software) GPU
    await page.screenshot({ path: path.join(OUT, 'video-panel.png') });
    // stutter with the preview open: play() time, scheduler-timer drift for 8 s, long tasks
    await page.evaluate(() => { window.__long.length = 0; });
    const t0 = Date.now(); await page.evaluate(() => window.__studio.play()); results.pc.playCallMs = Date.now() - t0;
    results.pc.driftWithPreview = await page.evaluate(() => new Promise(res => { const g = []; let l = performance.now(); const id = setInterval(() => { const n = performance.now(); g.push(n - l); l = n; }, 25);
      setTimeout(() => { clearInterval(id); g.sort((a, b) => a - b); res({ p50: Math.round(g[g.length >> 1]), p99: Math.round(g[Math.floor(g.length * 0.99)]), max: Math.round(g[g.length - 1]), over150: g.filter(x => x > 150).length }); }, 8000); }));
    results.pc.longTasksWhilePlaying = await page.evaluate(() => window.__long.map(x => x.d));
    if (results.pc.playCallMs > 50 || results.pc.driftWithPreview.p99 > 150) fail++;   // the preview must not starve the audio scheduler
    results.pc.previewCanvas = await page.$eval('#vz-canvas canvas', c => ({ px: [c.width, c.height], css: [c.clientWidth, c.clientHeight] }));
    await page.screenshot({ path: path.join(OUT, 'video-panel-playing.png') });
    await page.evaluate(() => window.__studio.stop());
    await page.click('#vz-fmt-16x9'); await page.click('#vz-mood-kitsune'); await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, 'video-panel-16x9.png') });
    await page.click('#vz-close'); results.pc.closedPanel = await page.evaluate(() => !document.getElementById('visual-scrim'));
    // the tape list entry point
    await page.click('#tape-video-sleepy-rain'); await page.waitForSelector('#vz-canvas canvas'); results.pc.songPanelTitle = await page.$eval('#vz-title', e => e.value); await page.click('#vz-close');
    // H.264 / AAC configs this browser offers (headless Chromium has none: the WebM path runs here)
    results.pc.codecs = await page.evaluate(async () => { const o = {}; for (const c of ['avc1.640028', 'avc1.4d0028', 'avc1.420028']) o[c] = (await VideoEncoder.isConfigSupported({ codec: c, width: 1080, height: 1920, bitrate: 6e6, framerate: 30, avc: { format: 'avc' } })).supported;
      o.aac = (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })).supported;
      o.vp9 = (await VideoEncoder.isConfigSupported({ codec: 'vp09.00.40.08', width: 1080, height: 1920, bitrate: 6e6, framerate: 30 })).supported;
      o.opus = (await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 })).supported; return o; });
    // exports
    const jobs = [['project-9x16', { format: '9:16', seconds: 4, source: 'project' }, { w: 1080, h: 1920, sec: 4 }],
      ['song-16x9', { format: '16:9', seconds: 4, source: 'after-the-storm', mood: 'kitsune' }, { w: 1920, h: 1080, sec: 4 }],
      ['song-1x1', { format: '1:1', seconds: 3, source: 'i-am-with-you-always', mood: 'moon' }, { w: 1080, h: 1080, sec: 3 }]];
    for (const [name, opt, want] of jobs) {
      const t = Date.now();
      try {
        const r = await page.evaluate(o => window.__studio.exportVideo(o), opt); r.ms = Date.now() - t;
        const { file } = await lastSaved(page, 'video-' + name); r.file = file; r.probe = probe(file);
        if (!check(r, want)) fail++;
        results.pc[name] = r;
      } catch (e) { fail++; results.pc[name] = { error: String(e.message || e).split('\n')[0] }; }
    }
    // three frames from the 9:16 and 16:9 files (start, middle, end of the song section)
    results.pc.frames = [];
    const grab = (src, sec, n) => { const f = path.join(OUT, `video-frame-${n}.png`); execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(sec), '-i', src, '-frames:v', '1', f]); results.pc.frames.push(f); };
    if (results.pc['project-9x16']?.file) { grab(results.pc['project-9x16'].file, 0.4, '9x16-start'); grab(results.pc['project-9x16'].file, 2.5, '9x16-mid'); }
    if (results.pc['song-16x9']?.file) grab(results.pc['song-16x9'].file, 2.2, '16x9-mid');
    results.pc.consoleErrors = errors;
    if (errors.length) fail++;
    await ctx.close();
  }
  if (!args.includes('--skip-phone')) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addInitScript(MOCK); await route(ctx);
    const page = await ctx.newPage(), errors = [];
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(base); await page.waitForSelector('#pc-video', { state: 'visible', timeout: 30000 });
    await page.screenshot({ path: path.join(OUT, 'video-phone-pconly.png') });
    await page.tap('#pc-video'); await page.waitForSelector('#vmaker', { state: 'visible' });
    await page.tap('#vm-song-sleepy-rain');
    await page.waitForFunction(() => !document.getElementById('vm-make').disabled, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, 'video-phone-maker.png'), fullPage: true });
    results.phone.audioContexts = await page.evaluate(() => (window.__audioCtxCount || 0));
    await page.evaluate(() => { window.__videoTestSeconds = 5; window.__long.length = 0; window.__lastVideo = null; });
    const t = Date.now();
    await page.tap('#vm-make');
    // responsiveness while rendering: a timer that should fire every 50 ms
    const resp = page.evaluate(() => new Promise(res => { const g = []; let l = performance.now(); const id = setInterval(() => { const n = performance.now(); g.push(n - l); l = n; if (window.__lastVideo) { clearInterval(id); g.sort((a, b) => a - b); res({ timerMax: Math.round(g[g.length - 1]), timerP99: Math.round(g[Math.floor(g.length * 0.99)]) }); } }, 50); }));
    await page.waitForFunction(() => window.__lastVideo, null, { timeout: 600000 });
    results.phone.responsiveness = await resp;
    results.phone.ms = Date.now() - t;
    results.phone.result = await page.evaluate(() => window.__lastVideo);
    results.phone.longTasks = await page.evaluate(() => window.__long.map(x => x.d));
    results.phone.maxLongTask = Math.max(0, ...results.phone.longTasks);
    await page.screenshot({ path: path.join(OUT, 'video-phone-done.png') });
    if (!results.phone.result?.error) {
      const { file } = await lastSaved(page, 'video-phone-9x16'); results.phone.file = file; results.phone.probe = probe(file);
      if (!check(results.phone, { w: 720, h: 1280, sec: 5 })) fail++;
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '3', '-i', file, '-frames:v', '1', path.join(OUT, 'video-frame-phone.png')]);
    } else fail++;
    if (results.phone.maxLongTask > 200) fail++;
    results.phone.consoleErrors = errors; if (errors.length) fail++;
    await ctx.close();
  }
  await browser.close(); srv.close();
  results.fail = fail;
  fs.writeFileSync(path.join(OUT, 'video-results.json'), JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, 1));
  console.log(fail ? `FAIL (${fail})` : 'PASS');
  process.exit(fail ? 1 : 0);
})();
