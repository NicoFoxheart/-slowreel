// Test runner for shared/lib. Usage (from anywhere):
//   NODE_PATH=$(npm root -g) node /home/user/nicofoxheart/studio/shared/lib/tests/run.cjs
// Serves the studio folder, opens tests/index.html in Playwright Chromium (one context WITH the mock viewer from
// qa.cjs, one plain browser context without it), runs every test in tests.js, then checks the produced files with
// ffprobe / ffmpeg / unzip. Files land in tests/out/, the full numbers in tests/out/results.json. Exit code 1 on failure.
const http = require('http'), fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../../..');           // .../studio
const OUT = path.join(__dirname, 'out');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-viewer.js'), 'utf8');
const LAME_LOCAL = path.join(ROOT, 'shared/vendor/lame.min.js');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});

const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30 }); return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '' }; };
const probe = f => JSON.parse(sh('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', f]).out || '{}');
const decodeErrors = f => { const r = sh('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-']); const t = (r.out + r.err).trim(); return t ? t.split('\n').length : 0; };

const results = {}, checks = [];
const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); };

async function runIn(page, name) {
  const t0 = Date.now();
  let r;
  try { r = await page.evaluate(n => window.__tests[n](), name); } catch (e) { r = { pass: false, error: String(e.message || e).split('\n')[0] }; }
  if (r.files) { for (const [fn, data] of Object.entries(r.files)) fs.writeFileSync(path.join(OUT, fn), Buffer.from(data, 'base64')); r.files = Object.keys(r.files); }
  r.wallMs = Date.now() - t0; results[name] = r;
  check(`browser: ${name}`, r.pass, r.error);
  return r;
}

server.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}/shared/lib/tests/index.html`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const downloads = [], blocked = [], errors = [];
  async function newPage(withViewer) {
    const ctx = await browser.newContext({ acceptDownloads: true });
    if (withViewer) await ctx.addInitScript(MOCK);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('download', async d => { const p = path.join(OUT, 'download-' + d.suggestedFilename()); await d.saveAs(p); downloads.push({ name: d.suggestedFilename(), path: p, bytes: fs.statSync(p).size }); });
    await page.route('**/*', r => { const u = r.request().url();
      if (u.startsWith('http://127.0.0.1')) return r.continue();
      if (u === 'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js') return r.fulfill({ path: LAME_LOCAL, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } });
      blocked.push(u); return r.abort(); });
    await page.goto(base); await page.waitForFunction(() => window.__testsReady);
    return page;
  }

  // 1) inside the (mock) viewer
  const v = await newPage(true);
  for (const t of ['measure', 'renderOffline', 'trimTail', 'encodeWav', 'encodeMp3', 'makeZip', 'saveViewer', 'saveRejected', 'saveDeclined',
    'saveUnavailable', 'saveUseNull', 'storageDb', 'storageMemory', 'autosave', 'songs', 'reverb', 'recordVideo']) {
    process.stdout.write(`  ${t} ... `); const r = await runIn(v, t); console.log(r.pass ? 'ok' : 'FAIL', `(${r.wallMs} ms)`);
  }
  // 2) plain browser, no window.claude
  const p = await newPage(false);
  for (const t of ['saveNoViewer', 'storageIdb']) { process.stdout.write(`  ${t} ... `); const r = await runIn(p, t); console.log(r.pass ? 'ok' : 'FAIL'); }
  await p.reload(); await p.waitForFunction(() => window.__testsReady);
  { process.stdout.write('  storageIdbAfterReload ... '); const r = await runIn(p, 'storageIdbAfterReload'); console.log(r.pass ? 'ok' : 'FAIL'); }
  await new Promise(r => setTimeout(r, 500));
  await browser.close(); server.close();

  // ---- tool checks on the produced files
  const f = n => path.join(OUT, n);
  { const j = probe(f('test-24bit.wav')), s = j.streams?.[0] || {};
    results.ffprobeWav24 = { codec: s.codec_name, channels: s.channels, sampleRate: s.sample_rate, bitsPerSample: s.bits_per_sample, duration: j.format?.duration };
    check('ffprobe: WAV is pcm_s24le stereo 44.1 kHz 3.0 s', s.codec_name === 'pcm_s24le' && s.channels === 2 && s.sample_rate === '44100' && s.bits_per_sample === 24 && Math.abs(+j.format.duration - 3) < 0.001, results.ffprobeWav24); }
  { const s = probe(f('test-16bit.wav')).streams?.[0] || {}; results.ffprobeWav16 = { codec: s.codec_name }; check('ffprobe: 16-bit WAV is pcm_s16le', s.codec_name === 'pcm_s16le'); }
  { const j = probe(f('test-320.mp3')), s = j.streams?.[0] || {};
    results.ffprobeMp3 = { codec: s.codec_name, channels: s.channels, sampleRate: s.sample_rate, bitRate: s.bit_rate, duration: j.format?.duration, decodeErrors: decodeErrors(f('test-320.mp3')) };
    check('ffprobe: MP3 is mp3 320 kbps stereo 44.1 kHz ~30 s, decodes cleanly', s.codec_name === 'mp3' && s.bit_rate === '320000' && s.channels === 2 && s.sample_rate === '44100' && Math.abs(+j.format.duration - 30) < 0.1 && results.ffprobeMp3.decodeErrors === 0, results.ffprobeMp3); }
  { const t = sh('unzip', ['-t', f('test.zip')]), l = sh('unzip', ['-Z1', f('test.zip')]);
    const x = path.join(OUT, 'unzipped'); fs.mkdirSync(x); sh('unzip', ['-q', f('test.zip'), '-d', x]);
    const same = (a, b) => fs.existsSync(a) && fs.readFileSync(a).equals(fs.readFileSync(b));
    results.unzip = { testOk: t.ok && /No errors detected/.test(t.out), entries: l.out.trim().split('\n'),
      wavIdentical: same(path.join(x, 'Nicofoxheart - Évening.wav'), f('test-zip-src.wav')), mp3Identical: same(path.join(x, 'Nicofoxheart - Évening.mp3'), f('test-zip-src.mp3')),
      zipWavProbe: probe(path.join(x, 'Nicofoxheart - Évening.wav')).streams?.[0]?.codec_name, zipMp3Probe: probe(path.join(x, 'Nicofoxheart - Évening.mp3')).streams?.[0]?.bit_rate };
    check('unzip -t accepts the zip; WAV + MP3 inside are byte-identical', results.unzip.testOk && results.unzip.wavIdentical && results.unzip.mp3Identical && results.unzip.entries.length === 4, results.unzip); }
  { results.downloads = downloads.map(d => ({ name: d.name, bytes: d.bytes, unzipT: sh('unzip', ['-t', d.path]).ok }));
    const nv = downloads.find(d => d.name === 'no-viewer.zip'), un = downloads.find(d => d.name === 'use-null.zip');
    check('anchor fallback (no viewer) downloaded a valid zip of the right size', nv && nv.bytes === results.saveNoViewer.bytes && sh('unzip', ['-t', nv.path]).ok, results.downloads);
    check('anchor fallback (use() resolved null) downloaded the zip', un && un.bytes === results.saveUseNull.bytes);
    check('no anchor download happened while the viewer was present', downloads.length === 2, downloads.map(d => d.name)); }
  { const vf = (results.recordVideo.files || [])[0];
    if (vf) { const j = probe(f(vf)), vs = j.streams?.find(s => s.codec_type === 'video') || {}, as = j.streams?.find(s => s.codec_type === 'audio') || {};
      const frames = sh('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', f(vf)]).out.trim();
      const vol = (sh('ffmpeg', ['-i', f(vf), '-vn', '-af', 'volumedetect', '-f', 'null', '-']).err.match(/mean_volume: (-?[\d.]+) dB/) || [])[1];
      const last = sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', f(vf)]).out.trim().split('\n').filter(Boolean).pop();
      results.ffprobeVideo = { file: vf, container: j.format?.format_name, video: `${vs.codec_name} ${vs.width}x${vs.height}`, audio: `${as.codec_name} ${as.sample_rate} Hz ${as.channels} ch`, framesDecoded: +frames, lastVideoPts: +last, formatDuration: j.format?.duration, audioMeanVolumeDb: +vol, decodeErrors: decodeErrors(f(vf)) };
      check('ffprobe: video has 640x360 video + audio, ~3 s, decodes with no errors', vs.width === 640 && vs.height === 360 && as.codec_name && +frames >= 45 && +last > 2.5 && results.ffprobeVideo.decodeErrors === 0 && +vol > -40, results.ffprobeVideo);
    } else check('video produced', false); }
  { const s = probe(f('reverb-hall-pluck.wav')).streams?.[0] || {}; check('ffprobe: reverb demo WAV is valid', s.codec_name === 'pcm_s24le'); }
  { // SONGS metadata recomputed from the mp3s with ffmpeg, the way shared/tracks-data.json was made
    const { SONGS } = await import(require('url').pathToFileURL(path.join(__dirname, '../songs.js')).href);
    const TITLES = ['After the Storm', 'Ballet of Life', 'Hopeful Romantic', 'Infinite Love', 'Nature of Love', "I'll Never Leave You (Nightcore)", "I'll Never Leave You", 'I Am With You Always', 'Sleepy Rain'];
    const files = fs.readdirSync(path.join(ROOT, 'shared/audio')).filter(n => n.endsWith('.mp3')).map(n => n.slice(0, -4)).sort();
    const rows = SONGS.map(s => {
      const f = path.join(ROOT, 'shared/audio', s.id + '.mp3');
      const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', '4000', '-f', 's16le', '-'], { maxBuffer: 1 << 30 }).stdout;
      const a = new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1), n = Math.floor(a.length / 120), pk = [];
      for (let k = 0; k < 120; k++) { let m = 0; for (let i = k * n; i < (k + 1) * n; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } pk.push(m); }
      const mx = Math.max(...pk), peaks = pk.map(x => Math.round(x / mx * 100) / 100);
      const dur = +(+sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).out).toFixed(1);
      return { id: s.id, title: s.title, duration: s.duration, ffprobeDuration: dur, peakBinsOff: peaks.filter((p, i) => Math.abs(p - s.peaks[i]) > 0.0101).length };
    });
    results.songsFfmpeg = rows;
    check('songs: 9 songs = every mp3 in shared/audio, titles right, duration + 120 peaks match ffmpeg recompute',
      SONGS.length === 9 && JSON.stringify(SONGS.map(s => s.id).sort()) === JSON.stringify(files) && JSON.stringify(SONGS.map(s => s.title)) === JSON.stringify(TITLES) &&
      rows.every(r => r.duration === r.ffprobeDuration && r.peakBinsOff === 0), rows); }
  results.blockedExternal = [...new Set(blocked)]; results.pageErrors = errors;
  check('no page errors', errors.length === 0, errors.slice(0, 5));

  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ checks, results }, null, 2));
  console.log('\n' + checks.map(c => `${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`).join('\n'));
  const failed = checks.filter(c => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed. Numbers: ${path.join(OUT, 'results.json')}`);
  process.exit(failed.length ? 1 : 0);
});
