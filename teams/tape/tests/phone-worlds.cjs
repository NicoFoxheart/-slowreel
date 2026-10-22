// Phone worlds: NODE_PATH=$(npm root -g) node teams/tape/tests/phone-worlds.cjs [--shots DIR] [--no-export] [--world ID]
// Emulated iPhone 13 (390x844) and Pixel 7 (412x915), isMobile + touch. Opens "Make a music video", checks every world card
// (names from the registry, thumbnails drawn lazily), switches through every world (iPhone) or a few (Pixel) plus some
// variants and checks the live preview draws (non-black pixels), then makes one real 3 s 9:16 video on the iPhone and
// ffprobes it (720x1280, 30 fps, audio). Fails on any console error.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { serve, route, ARGS } = require('./serve.cjs');
const OUT = path.resolve(__dirname, '../qa'); fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const SHOTS = opt('--shots'), EXPORT_WORLD = opt('--world') || 'golden-ocean';
const MOCK = `(() => { window.__saved = []; window.claude = { use: n => Promise.resolve(n === 'downloads' ? { async save({ filename, data }) {
  if (!/\\.(mp4|webm|zip)$/.test(filename)) throw { code: 'rejected_extension' }; window.__saved.push({ filename, bytes: data.size, blob: data }); return { status: 'saved' }; } } : null) }; })();`;
const DEVICES = [
  { name: 'iphone13', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, all: true, exp: true },
  { name: 'pixel7', viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, all: false, exp: false },
];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// fraction of non-black pixels of the preview canvas (screenshot decoded in the page: the canvas belongs to a worker)
async function litFraction(page) {
  const png = await page.locator('#vm-stage canvas').screenshot();
  return page.evaluate(async b64 => {
    const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d'); g.drawImage(bm, 0, 0);
    const d = g.getImageData(0, 0, bm.width, bm.height).data; let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
    return lit / (d.length / 4);
  }, png.toString('base64'));
}
async function settle(page, id) {
  await page.waitForFunction(id => document.querySelector(`#vm-world-${id}`)?.getAttribute('aria-checked') === 'true' && !document.getElementById('vm-stage').classList.contains('loading'), id, { timeout: 90000 });
  await sleep(1800);
}

(async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/teams/tape/`;
  const browser = await chromium.launch({ args: ARGS });
  const res = {}; let fail = 0;
  try {
    for (const dev of DEVICES) {
      const r = res[dev.name] = { worlds: {}, variants: {}, errors: [] };
      const ctx = await browser.newContext({ viewport: dev.viewport, deviceScaleFactor: dev.deviceScaleFactor, isMobile: true, hasTouch: true });
      await ctx.addInitScript(MOCK); await route(ctx);
      const page = await ctx.newPage();
      page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) r.errors.push(m.text()); });
      page.on('pageerror', e => r.errors.push('pageerror: ' + e.message));
      await page.goto(base); await page.waitForSelector('#pc-video', { state: 'visible', timeout: 30000 });
      await page.tap('#pc-video'); await page.waitForSelector('#vmaker', { state: 'visible' });
      await page.waitForSelector('#vm-stage canvas', { timeout: 90000 });
      await page.waitForFunction(() => document.querySelectorAll('.vm-chip').length > 0, null, { timeout: 60000 });
      const ids = await page.$$eval('.vm-world:not([hidden])', els => els.map(e => ({ id: e.dataset.id, name: e.querySelector('.vm-wname').textContent, group: e.querySelector('.vm-weye').textContent })));
      r.cards = ids.map(x => `${x.group}/${x.name}`);
      r.noHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
      const t0 = Date.now(); await settle(page, await page.$eval('.vm-world[aria-checked="true"]', e => e.dataset.id)); r.firstPreviewMs = Date.now() - t0;
      r.pageScrollAfterOpen = await page.evaluate(() => scrollY);
      const list = dev.all ? ids.map(x => x.id) : ['heart', 'neon-night', 'aurora-snow'].filter(id => ids.some(x => x.id === id));
      for (const id of list) {
        await page.locator(`#vm-world-${id}`).scrollIntoViewIfNeeded(); await page.tap(`#vm-world-${id}`);
        const t = Date.now(); await settle(page, id);
        r.worlds[id] = { lit: +(await litFraction(page)).toFixed(3), ms: Date.now() - t, chips: await page.$$eval('.vm-chip', e => e.length) };
        if (r.worlds[id].lit < 0.2) fail++;
        if (SHOTS && dev.name === 'iphone13' && id === 'neon-night') { await page.evaluate(() => document.getElementById('vm-stage').closest('.vm-card').scrollIntoView({ block: 'start' })); await page.screenshot({ path: path.join(SHOTS, 'phone-worlds-2-neon.png') }); }
        if (SHOTS && dev.name === 'pixel7' && id === 'aurora-snow') await page.locator('#vm-now-name').scrollIntoViewIfNeeded().then(() => page.screenshot({ path: path.join(SHOTS, 'phone-worlds-4-pixel7.png') }));
      }
      // a few variants: the last chip of three worlds
      for (const id of (dev.all ? ['hanok-rain', 'golden-ocean', 'heart'] : ['neon-night'])) {
        if (!ids.some(x => x.id === id)) continue;
        await page.locator(`#vm-world-${id}`).scrollIntoViewIfNeeded(); await page.tap(`#vm-world-${id}`); await settle(page, id);
        const chip = page.locator('.vm-chip').last(), vid = (await chip.getAttribute('id')).replace('vm-var-', '');
        await chip.scrollIntoViewIfNeeded(); await chip.tap(); await sleep(2500);
        r.variants[`${id}:${vid}`] = { lit: +(await litFraction(page)).toFixed(3), checked: await chip.getAttribute('aria-checked') };
        if (r.variants[`${id}:${vid}`].lit < 0.2) fail++;
      }
      await sleep(1500);
      r.thumbsReady = await page.$$eval('.vm-world.ready', e => e.length);
      if (SHOTS && dev.name === 'iphone13') await page.screenshot({ path: path.join(SHOTS, 'phone-worlds-1-page.png'), fullPage: true });
      if (dev.exp) {
        await page.tap('#vm-song-sleepy-rain');
        await page.waitForFunction(() => !document.getElementById('vm-make').disabled, null, { timeout: 120000 });
        await page.locator(`#vm-world-${EXPORT_WORLD}`).scrollIntoViewIfNeeded(); await page.tap(`#vm-world-${EXPORT_WORLD}`); await settle(page, EXPORT_WORLD);
        await page.tap('#vm-fmt-9x16');
        await page.evaluate(() => { window.__videoTestSeconds = 3; window.__lastVideo = null; });
        const t = Date.now();
        await page.locator('#vm-make').scrollIntoViewIfNeeded(); await page.tap('#vm-make');
        await page.waitForFunction(() => /Frame \d+ of \d+ · about/.test(document.getElementById('vm-status').textContent), null, { timeout: 120000 }).catch(() => { });
        if (SHOTS) { await page.locator('#vm-warn').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, 'phone-worlds-3-making.png') }); }
        r.statusWhileMaking = await page.textContent('#vm-status'); r.estimate = await page.textContent('#vm-est');
        await page.waitForFunction(() => window.__lastVideo, null, { timeout: 600000 });
        r.exportMs = Date.now() - t; r.video = await page.evaluate(() => window.__lastVideo); r.statusDone = await page.textContent('#vm-status');
        if (r.video.error) fail++;
        else {
          const { filename, b64 } = await page.evaluate(async () => { const s = window.__saved[window.__saved.length - 1];
            const b = await new Promise(rr => { const fr = new FileReader(); fr.onload = () => rr(fr.result.split(',')[1]); fr.readAsDataURL(s.blob); }); return { filename: s.filename, b64: b }; });
          const file = path.join(OUT, 'phone-worlds-export' + path.extname(filename)); fs.writeFileSync(file, Buffer.from(b64, 'base64'));
          const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_frames,sample_rate,channels:format=duration,format_name', '-of', 'json', file]).toString());
          const v = j.streams.find(s => s.codec_type === 'video'), a = j.streams.find(s => s.codec_type === 'audio');
          r.probe = { file, filename, container: j.format.format_name, duration: +(+j.format.duration).toFixed(3), video: v && { codec: v.codec_name, w: v.width, h: v.height, fps: v.r_frame_rate, frames: +v.nb_read_frames }, audio: a && { codec: a.codec_name, rate: +a.sample_rate, ch: a.channels } };
          if (!(v && v.width === 720 && v.height === 1280 && /^30(\/1)?$/.test(v.r_frame_rate) && +v.nb_read_frames === 90 && a)) fail++;
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '2', '-i', file, '-frames:v', '1', path.join(OUT, 'phone-worlds-frame.png')]);
        }
      }
      if (r.errors.length) fail++;
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
  console.log(JSON.stringify(res, null, 1));
  console.log(fail ? `FAIL (${fail})` : 'PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
