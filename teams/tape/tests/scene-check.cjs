// Scene check: renders one scene headless (Chromium + SwiftShader) through the REAL worker path (preview-worker.js ->
// scenes/host.js -> scenes/index.js -> scenes/<id>.js) with real audio features from one of Nico's songs, plus silence.
//   NODE_PATH=$(npm root -g) node teams/tape/tests/scene-check.cjs <sceneId> [variant] [--w 480 --h 270] [--frames 4]
//     [--t 0,30,90,200] [--aspect 16:9|9:16|1:1] [--quality light|high|ultra] [--song i-am-with-you-always] [--all-variants]
//     [--video 3 [--res 720|1080|1440|2160] [--fps 30]] [--no-silence] [--text]
// Saves PNGs to teams/tape/qa/scenes/<id>/ and prints JSON: ms per frame, draw calls, triangles, textures, programs,
// GPU memory estimate, console errors, determinism (same t rendered twice with another t between: pixels must match),
// and with --video N a real N-second makeVideo export (render-worker.js + WebCodecs) checked with ffprobe.
// SwiftShader is a CPU rasteriser: ms here are ~10-50x a mid GPU. Judge looks from the PNGs, speed from the budget notes.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { serve, route, ARGS } = require('./serve.cjs');

const argv = process.argv.slice(2), opt = {}, pos = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; opt[k] = v; } else pos.push(a); }
const id = pos[0];
if (!id) { console.error('usage: node tests/scene-check.cjs <sceneId> [variant] [--w 480 --h 270] [--frames 4] [--t 0,30,90,200] [--aspect 16:9|9:16|1:1] [--quality high] [--video 3]'); process.exit(2); }
const aspect = opt.aspect || '16:9', AR = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 }[aspect] || 16 / 9;
let W = +opt.w || 0, H = +opt.h || 0;
if (!W && !H) { const long = 480; if (AR >= 1) { W = long; H = Math.round(long / AR); } else { H = long; W = Math.round(long * AR); } }
else if (!H) H = Math.round(W / AR); else if (!W) W = Math.round(H * AR);
const times = String(opt.t || '0,30,90,200').split(',').map(Number).filter(x => isFinite(x));
const frames = Math.max(1, +opt.frames || 4), quality = opt.quality || 'high', song = opt.song || 'i-am-with-you-always';
const OUT = path.resolve(__dirname, '../qa/scenes', id); fs.mkdirSync(OUT, { recursive: true });
// budgets per quality: draw calls, triangles, shader programs, GPU MB at the test size, SwiftShader ms/frame at 480x270
const BUDGET = { light: { calls: 150, triangles: 500e3, programs: 30, memoryMB: 200, swMs: 900 }, high: { calls: 350, triangles: 1.5e6, programs: 40, memoryMB: 350, swMs: 2500 },
  ultra: { calls: 500, triangles: 3e6, programs: 48, memoryMB: 600, swMs: 5000 } };
const tag = v => `${v}-${aspect.replace(':', 'x')}-${quality}`;
const probe = file => {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,profile,level,width,height,r_frame_rate,nb_read_frames,sample_rate,channels,bit_rate:format=duration,format_name,bit_rate', '-of', 'json', file]).toString());
  const v = j.streams.find(s => s.codec_type === 'video'), a = j.streams.find(s => s.codec_type === 'audio');
  return { container: j.format.format_name, duration: +(+j.format.duration).toFixed(3), bitrate: +j.format.bit_rate,
    video: v && { codec: v.codec_name, profile: v.profile, level: v.level, width: v.width, height: v.height, fps: v.r_frame_rate, frames: +v.nb_read_frames },
    audio: a && { codec: a.codec_name, sampleRate: +a.sample_rate, channels: a.channels } };
};

(async () => {
  const t0 = Date.now(), srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/teams/tape/`;
  const browser = await chromium.launch({ args: ARGS });
  const out = { scene: id, aspect, size: [W, H], quality, song, errors: [] };
  let fail = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } }); await route(ctx);
    const page = await ctx.newPage();
    const noise = /fonts\.g|net::ERR|Failed to load resource/;
    page.on('console', m => { if ((m.type() === 'error' || /THREE\.WebGLProgram|Shader Error/.test(m.text())) && !noise.test(m.text())) out.errors.push(m.text().slice(0, 600)); });
    page.on('pageerror', e => out.errors.push('pageerror: ' + e.message));
    page.on('worker', wk => wk.on?.('console', m => { if (m.type() === 'error') out.errors.push('worker: ' + m.text().slice(0, 600)); }));
    await page.goto(base + 'tests/scene-check.html'); await page.waitForFunction(() => window.__scReady, null, { timeout: 30000 });
    out.audio = await page.evaluate(u => window.__sc.loadSong(u), `../audio/${song}.mp3`);
    // the scene's meta (and which variants to run)
    const first = await page.evaluate(a => window.__sc.snap(a), { opts: { scene: id, variant: pos[1], quality }, size: [W, H], shots: [{ t: times[0], frames: 1 }], png: false, pixels: false, measure: true })
      .catch(e => ({ error: String(e.message || e) }));
    if (first.error || !first.meta) throw new Error('scene did not load: ' + (first.error || 'no meta'));
    const meta = first.meta; out.meta = { id: meta.id, name: meta.name, group: meta.group, variants: meta.variants.map(v => v.id), defaultVariant: meta.defaultVariant };
    out.loadMs = Math.round(first.loadMs); out.webgl2 = first.renderer.isWebGL2;
    const variants = opt['all-variants'] ? meta.variants.map(v => v.id) : [pos[1] && meta.variants.some(v => v.id === pos[1]) ? pos[1] : meta.defaultVariant];
    out.runs = [];
    for (const variant of variants) {
      const run = { variant, frames: [] }, o = { scene: id, variant, quality, showText: !!opt.text, title: opt.text ? 'Sleepy Rain' : '', artist: opt.text ? 'Nicofoxheart' : '' };
      const shots = times.map(t => ({ t, frames }));
      if (!opt['no-silence']) shots.push({ t: times[Math.min(1, times.length - 1)], frames: 1, silent: true });
      const r = await page.evaluate(a => window.__sc.snap(a), { opts: o, size: [W, H], shots, png: true });
      run.loadMs = Math.round(r.loadMs);
      r.shots.forEach((s, i) => {
        const sil = shots[i].silent, file = path.join(OUT, `${tag(variant)}-${sil ? 'silence-' : ''}t${shots[i].t}.png`);
        fs.writeFileSync(file, Buffer.from(s.png, 'base64'));
        const ms = s.ms.map(x => Math.round(x)), warm = ms.length > 1 ? ms.slice(1) : ms;
        run.frames.push({ t: shots[i].t, silent: !!sil, ms, msAvg: Math.round(warm.reduce((a, b) => a + b, 0) / warm.length), png: path.relative(process.cwd(), file), stats: s.stats });
      });
      run.stats = r.shots[0].stats;
      run.memoryMB = r.memory ? { total: +(r.memory.total / 1048576).toFixed(1), textures: +(r.memory.textures / 1048576).toFixed(1), renderbuffers: +(r.memory.renderbuffers / 1048576).toFixed(1), buffers: +(r.memory.buffers / 1048576).toFixed(1) } : null;
      const tt = times[Math.min(2, times.length - 1)], other = times[0] === tt ? tt + 7.3 : times[0];
      run.determinism = await page.evaluate(a => window.__sc.compare(a), { opts: o, size: [W, H], t: tt, between: other });
      run.determinism.t = tt;
      if (!run.determinism.identical) fail++;
      const avg = run.frames.filter(f => !f.silent); run.msPerFrame = Math.round(avg.reduce((a, b) => a + b.msAvg, 0) / avg.length);
      out.runs.push(run);
    }
    // perf budget (SCENES-API.md): counts do not depend on the test size; memory is measured at the test size
    const B = BUDGET[quality] || BUDGET.high, warn = [];
    for (const run of out.runs) {
      const peak = k => Math.max(...run.frames.map(f => f.stats?.[k] || 0));
      if (peak('calls') > B.calls) warn.push(`${run.variant}: ${peak('calls')} draw calls > ${B.calls}`);
      if (peak('triangles') > B.triangles) warn.push(`${run.variant}: ${peak('triangles')} triangles > ${B.triangles}`);
      if ((run.stats?.programs || 0) > B.programs) warn.push(`${run.variant}: ${run.stats.programs} shader programs > ${B.programs}`);
      if ((run.memoryMB?.total || 0) > B.memoryMB) warn.push(`${run.variant}: ~${run.memoryMB.total} MB GPU memory at ${W}x${H} > ${B.memoryMB}`);
      if (run.msPerFrame > B.swMs * (W * H) / (480 * 270)) warn.push(`${run.variant}: ${run.msPerFrame} ms/frame on SwiftShader > ~${Math.round(B.swMs * (W * H) / (480 * 270))} (scaled from ${B.swMs} at 480x270)`);
    }
    out.budget = { quality, limits: B, ok: !warn.length, warnings: warn };
    await page.evaluate(() => window.__sc.release());
    if (opt.video) {
      const v = await page.evaluate(a => window.__sc.video(a), { seconds: +opt.video || 3, aspect, res: opt.res || '720', scene: id, variant: variants[0], quality, fps: +opt.fps || 30 })
        .catch(e => ({ error: String(e.message || e) }));
      if (v.error) { out.video = v; fail++; }
      else {
        const file = path.join(OUT, `video-${tag(variants[0])}-${v.width}x${v.height}.${v.ext}`); fs.writeFileSync(file, Buffer.from(v.data, 'base64')); delete v.data;
        v.file = path.relative(process.cwd(), file); v.probe = probe(file);
        const p = v.probe, sec = +opt.video || 3, fps = +opt.fps || 30;
        v.pass = !!(p.video && p.video.width === v.width && p.video.height === v.height && p.audio && Math.abs(p.duration - sec) < 0.15 && p.video.frames === Math.round(sec * fps));
        if (!v.pass) fail++;
        const still = path.join(OUT, `video-${tag(variants[0])}-mid.png`);
        try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(sec / 2), '-i', file, '-frames:v', '1', still]); v.still = path.relative(process.cwd(), still); } catch { }
        out.video = v;
      }
    }
  } catch (e) { out.fatal = String(e.message || e); fail++; }
  finally { await browser.close(); srv.close(); }
  if (out.errors.length) fail++;
  out.seconds = Math.round((Date.now() - t0) / 1000);
  out.pass = fail === 0;
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.pass ? 0 : 1);
})();
