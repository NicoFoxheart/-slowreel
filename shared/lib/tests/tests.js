// Browser-side tests for shared/lib. run.cjs opens tests/index.html in Playwright Chromium and calls
// window.__tests[name]() one by one; each returns numbers (and files as base64 that run.cjs checks with ffprobe/unzip).
import { renderOffline, trimTail, measure, encodeWav, encodeMp3, makeZip, saveFile, recordVideo, LAME_URL, loadLame } from '../export.js';
import { openProjects, autosave, MAX_PROJECT_BYTES } from '../storage.js';
import { SONGS, loadSong, songUrl } from '../songs.js';
import { makeImpulse, REVERB_PRESETS } from '../reverb.js';

const r2 = x => Math.round(x * 100) / 100, r4 = x => Math.round(x * 1e4) / 1e4;
const b64 = async blob => { const u8 = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function sineBuffer({ seconds = 2, sr = 44100, freqs = [440, 660], amp = 0.5 }) {
  const b = new AudioBuffer({ numberOfChannels: freqs.length, length: seconds * sr, sampleRate: sr });
  freqs.forEach((f, c) => { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = amp * Math.sin(2 * Math.PI * f * i / sr); });
  return b;
}
// A small ambient phrase (detuned saw pad + sine bells) to give the encoders real music-like material.
async function phrase(seconds, sr = 44100) {
  return renderOffline({ seconds, sampleRate: sr, build(ctx, dest) {
    const out = ctx.createGain(); out.gain.value = 0.18; out.connect(dest);
    const lp = ctx.createBiquadFilter(); lp.frequency.value = 1800; lp.connect(out);
    [[220, 277.18, 329.63, 415.3], [196, 246.94, 293.66, 369.99]].forEach((chord, k) => chord.forEach((f, j) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
      o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (j - 1.5) * 7; p.pan.value = (j - 1.5) / 2;
      const t0 = k * seconds / 2, t1 = t0 + seconds / 2;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.25, t0 + 1.5); g.gain.setValueAtTime(0.25, t1 - 1); g.gain.linearRampToValueAtTime(0, t1);
      o.connect(g).connect(p).connect(lp); o.start(t0); o.stop(t1);
    }));
  } });
}

const T = {};

T.measure = async () => {
  const b = sineBuffer({ seconds: 1, freqs: [1000, 1000], amp: 0.5 });
  const d = b.getChannelData(0); d[100] = 1.2; d[200] = -1.0; d[300] = 1.0;
  const m = measure(b);
  // expected: peak 20log10(1.2) = +1.58 dB, rms of 0.5 sine = -9.03 dB, 3 samples >= full scale
  return { peakDb: r2(m.peakDb), rmsDb: r2(m.rmsDb), clippedSamples: m.clippedSamples,
    pass: Math.abs(m.peakDb - 1.58) < 0.01 && Math.abs(m.rmsDb + 9.03) < 0.02 && m.clippedSamples === 3 };
};

T.renderOffline = async () => {
  const t0 = performance.now();
  const buf = await renderOffline({ seconds: 2, sampleRate: 48000, build(ctx, dest) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 440; g.gain.value = 0.25; o.connect(g).connect(dest); o.start(0);
  } });
  const m = measure(buf), d = buf.getChannelData(0);
  let zc = 0; for (let i = 1; i < d.length; i++) if (d[i - 1] < 0 && d[i] >= 0) zc++;
  const freq = zc / buf.duration;
  return { length: buf.length, sampleRate: buf.sampleRate, channels: buf.numberOfChannels, peakDb: r2(m.peakDb), rmsDb: r2(m.rmsDb), freqHz: r2(freq), ms: Math.round(performance.now() - t0),
    pass: buf.length === 96000 && buf.numberOfChannels === 2 && Math.abs(m.peakDb + 12.04) < 0.05 && Math.abs(m.rmsDb + 15.05) < 0.05 && Math.abs(freq - 440) < 1 };
};

T.trimTail = async () => {
  // 0.5-amplitude 220 Hz tone decaying 60 dB per second inside a 5 s buffer: crosses -70 dBFS at log10(0.5/10^-3.5)/3 = 1.0663 s
  const sr = 44100, b = new AudioBuffer({ numberOfChannels: 2, length: 5 * sr, sampleRate: sr });
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.pow(10, -3 * i / sr) * Math.sin(2 * Math.PI * 220 * i / sr + c); }
  const expected = Math.log10(0.5 / Math.pow(10, -3.5)) / 3;
  const a = trimTail(b, { thresholdDb: -70, padSeconds: 0 });
  const p = trimTail(b);                               // default pad 0.1 s
  const m = trimTail(b, { minSeconds: 3 });
  const silent = trimTail(new AudioBuffer({ numberOfChannels: 2, length: sr, sampleRate: sr }));
  const tail = a.getChannelData(0), lastAbs = Math.abs(tail[tail.length - 1]);
  return { expectedSec: r4(expected), trimmedSec: r4(a.duration), withDefaultPadSec: r4(p.duration), minSeconds3: r4(m.duration), silentLen: silent.length, lastSample: lastAbs,
    pass: Math.abs(a.duration - expected) < 0.01 && Math.abs(p.duration - expected - 0.1) < 0.01 && Math.abs(m.duration - 3) < 1e-3 && silent.length >= 1 && lastAbs < 1e-6 };
};

T.encodeWav = async () => {
  const b = sineBuffer({ seconds: 3, freqs: [440, 660], amp: 0.5 });
  b.getChannelData(0)[10] = 1.5; b.getChannelData(1)[10] = -1.5; // must clamp, not wrap
  const t0 = performance.now(), wav = encodeWav(b), ms = performance.now() - t0;
  const back = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(await wav.arrayBuffer());
  let maxErr = 0;
  for (let c = 0; c < 2; c++) { const x = b.getChannelData(c), y = back.getChannelData(c); for (let i = 0; i < x.length; i++) { const e = Math.abs(Math.max(-1, Math.min(1, x[i])) - y[i]); if (e > maxErr) maxErr = e; } }
  const w16 = encodeWav(b, { bitDepth: 16 });
  return { bytes: wav.size, expectedBytes: 44 + 3 * 44100 * 2 * 3, encodeMs: Math.round(ms), roundTripMaxError: maxErr, roundTripErrDb: r2(20 * Math.log10(maxErr)),
    clampL: back.getChannelData(0)[10], clampR: back.getChannelData(1)[10], wav16Bytes: w16.size,
    files: { 'test-24bit.wav': await b64(wav), 'test-16bit.wav': await b64(w16) },
    pass: wav.size === 44 + 3 * 44100 * 6 && maxErr < 2e-7 && back.getChannelData(0)[10] > 0.9999 && back.getChannelData(1)[10] < -0.9999 };
};

T.encodeMp3 = async () => {
  const buf = await phrase(30);
  // Main-thread responsiveness probe: a 4 ms interval timer; the longest gap between ticks = the longest freeze.
  let last = performance.now(), maxGap = 0, ticks = 0;
  const iv = setInterval(() => { const t = performance.now(); maxGap = Math.max(maxGap, t - last); last = t; ticks++; }, 4);
  let progressCalls = 0; const longTasks = [];
  const po = new PerformanceObserver(l => l.getEntries().forEach(e => longTasks.push(Math.round(e.duration)))); po.observe({ type: 'longtask' });
  await loadLame(); last = performance.now(); maxGap = 0; // script download/parse is a one-off, measured separately below
  const t0 = performance.now();
  const mp3 = await encodeMp3(buf, { kbps: 320, onProgress: () => progressCalls++ });
  const ms = performance.now() - t0;
  clearInterval(iv); po.disconnect();
  const script = [...document.scripts].find(s => /lame/.test(s.src))?.src || null;
  const back = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(await mp3.arrayBuffer());
  const mi = measure(buf), mo = measure(back);
  const t1 = performance.now(); const mp3b = await encodeMp3(sineBuffer({ seconds: 1 })); const secondMs = performance.now() - t1;
  return { seconds: 30, bytes: mp3.size, expectedBytesAt320k: 30 * 320000 / 8, encodeMs: Math.round(ms), realtimeX: r2(30000 / ms), maxMainThreadGapMs: Math.round(maxGap), probeTicks: ticks, longTasksMs: longTasks,
    progressCalls, scriptSrc: script, decodedSec: r2(back.duration), peakInDb: r2(mi.peakDb), peakOutDb: r2(mo.peakDb), rmsInDb: r2(mi.rmsDb), rmsOutDb: r2(mo.rmsDb), secondCallMs: Math.round(secondMs), secondBytes: mp3b.size,
    files: { 'test-320.mp3': await b64(mp3) },
    pass: script === LAME_URL && maxGap < 75 && longTasks.length === 0 && progressCalls > 3 && Math.abs(mi.rmsDb - mo.rmsDb) < 0.5 && Math.abs(mp3.size - 30 * 40000) < 30 * 40000 * 0.03 };
};

T.makeZip = async () => {
  const buf = await phrase(4);
  const wav = encodeWav(buf), mp3 = await encodeMp3(buf);
  const t0 = performance.now();
  const zip = await makeZip([{ name: 'Nicofoxheart - Évening.wav', data: wav }, { name: 'Nicofoxheart - Évening.mp3', data: mp3 },
    { name: 'notes/readme.txt', data: 'made in the studio\n' }, { name: 'raw.bin', data: new Uint8Array([0, 1, 2, 255]) }]);
  // CRC-32 check value from the spec: crc32("123456789") = 0xCBF43926
  const z2 = new Uint8Array(await (await makeZip([{ name: 'a', data: '123456789' }])).arrayBuffer());
  const crc = new DataView(z2.buffer).getUint32(14, true).toString(16);
  return { zipBytes: zip.size, wavBytes: wav.size, mp3Bytes: mp3.size, overheadBytes: zip.size - wav.size - mp3.size - 19 - 4, ms: Math.round(performance.now() - t0), crcCheck: crc,
    files: { 'test.zip': await b64(zip), 'test-zip-src.wav': await b64(wav), 'test-zip-src.mp3': await b64(mp3) },
    pass: crc === 'cbf43926' && zip.type === 'application/zip' };
};

// ---- saveFile in several viewer situations (run.cjs runs these in the right contexts and watches for downloads)
const smallZip = () => makeZip([{ name: 'a.txt', data: 'hello' }]);
function withUse(fn) { const real = window.claude; window.claude = { use: fn }; return () => { window.claude = real; }; }
T.saveViewer = async () => {
  const zip = await smallZip();
  const r = await saveFile('Nicofoxheart - test.zip', zip);
  const saved = (window.__saved || []).map(s => ({ filename: s.filename, bytes: s.bytes }));
  return { result: r, saved, pass: r.status === 'saved' && saved.length === 1 && saved[0].bytes === zip.size };
};
T.saveRejected = async () => {
  const r = await saveFile('master.wav', encodeWav(sineBuffer({ seconds: 1 })));
  return { result: r, pass: r.status === 'error' && r.code === 'rejected_extension' };
};
T.saveDeclined = async () => {
  const restore = withUse(async n => n === 'downloads' ? { save: async () => { throw { code: 'declined', message: 'viewer said no' }; } } : null);
  try { const r = await saveFile('x.zip', await smallZip()); return { result: r, pass: r.status === 'declined' && r.code === 'declined' }; } finally { restore(); }
};
T.saveUnavailable = async () => {
  const restore = withUse(async n => n === 'downloads' ? { save: async () => { throw { code: 'not_granted', message: 'no' }; } } : null);
  try { const r = await saveFile('x.zip', await smallZip()); return { result: r, pass: r.status === 'unavailable' && r.code === 'not_granted' }; } finally { restore(); }
};
T.saveUseNull = async () => { // window.claude exists but use('downloads') resolves null -> anchor fallback
  const restore = withUse(async () => null);
  try { const z = await smallZip(); const r = await saveFile('use-null.zip', z); return { result: r, bytes: z.size, pass: r.status === 'fallback' }; } finally { restore(); }
};
T.saveNoViewer = async () => { // no window.claude at all (plain browser)
  const zip = await makeZip([{ name: 'hello.txt', data: 'plain browser fallback\n' }, { name: 'tone.wav', data: encodeWav(sineBuffer({ seconds: 0.5 })) }]);
  const r = await saveFile('no-viewer.zip', zip);
  return { result: r, bytes: zip.size, hasClaude: !!window.claude, pass: r.status === 'fallback' && !window.claude };
};

T.recordVideo = async () => {
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; document.body.appendChild(canvas);
  const g = canvas.getContext('2d'); let run = true;
  const draw = t => { if (!run) return; g.fillStyle = `hsl(${(t / 20) % 360} 50% 60%)`; g.fillRect(0, 0, 320, 180); g.fillStyle = '#fff'; g.beginPath(); g.arc(160 + 100 * Math.sin(t / 400), 90, 30, 0, 7); g.fill(); requestAnimationFrame(draw); };
  requestAnimationFrame(draw);
  const ctx = new AudioContext(); await ctx.resume();
  const o = ctx.createOscillator(), out = ctx.createGain(); o.frequency.value = 330; out.gain.value = 0.3; o.connect(out); out.connect(ctx.destination); o.start();
  const t0 = performance.now();
  const res = await recordVideo({ canvas, audioNode: out, seconds: 3, width: 640, height: 360 });
  const ms = performance.now() - t0; run = false; o.stop(); await ctx.close(); canvas.remove();
  const support = Object.fromEntries(['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'].map(t => [t, MediaRecorder.isTypeSupported(t)]));
  return { ext: res.ext, mimeType: res.mimeType, bytes: res.blob.size, ms: Math.round(ms), support, files: { ['test-video.' + res.ext]: await b64(res.blob) }, pass: res.blob.size > 10000 };
};

// ---- storage
async function storageSuite(store) {
  const log = {};
  const p1 = { schema: 'nfx-studio/1', name: 'Rain Study', bpm: 68, tracks: [{ id: 't1', clips: [{ id: 'c1', notes: [{ p: 60, s: 0, d: 32, v: 0.7 }] }] }] };
  const s1 = await store.save(p1); await sleep(5);
  const s2 = await store.save({ schema: 'nfx-studio/1', name: 'Night Walk', bpm: 72, tracks: [] });
  log.idAssigned = !!p1.id && s1.id === p1.id;
  let list = await store.list();
  log.listAfter2 = list.map(x => x.name);
  log.newestFirst = list[0].id === s2.id;
  const l1 = await store.load(p1.id);
  log.loadEqual = JSON.stringify(l1) === JSON.stringify(s1);
  p1.name = 'Rain Study 2'; await sleep(5); const s1b = await store.save(p1);
  log.resaveKeepsCreated = s1b.createdAt === s1.createdAt && s1b.updatedAt > s1.updatedAt && (await store.list()).length === 2;
  const dup = await store.duplicate(p1.id, 'Rain Study (copy)');
  log.duplicate = dup.id !== p1.id && dup.name === 'Rain Study (copy)' && JSON.stringify(dup.tracks) === JSON.stringify(p1.tracks);
  await store.remove(s2.id);
  list = await store.list();
  log.afterRemove = list.map(x => x.name);
  log.loadMissing = await store.load('nope');
  try { await store.save({ name: 'huge', blob: 'x'.repeat(MAX_PROJECT_BYTES) }); log.tooLarge = 'accepted?!'; } catch (e) { log.tooLarge = e.code; }
  try { await store.save({ id: 'bad/id', name: 'x' }); log.badId = 'accepted?!'; } catch (e) { log.badId = e.code; }
  log.ok = log.idAssigned && log.newestFirst && log.loadEqual && log.resaveKeepsCreated && log.duplicate && list.length === 2 && log.loadMissing === null && log.tooLarge === 'too_large' && log.badId === 'invalid_argument';
  return log;
}
// Wrap the mock db so it enforces the real path grammar (documents: even segment count, collections: odd).
function strictDb() {
  const real = window.claude, paths = [];
  const check = (p, even) => { const n = p.split('/').length; if ((n % 2 === 0) !== even) throw new TypeError(`${even ? 'doc' : 'collection'} path with ${n} segments: ${p}`); paths.push(p); };
  window.claude = { use: async name => {
    const ns = await real.use(name); if (name !== 'db' || !ns) return ns;
    const wrapCol = c => ({ ...c, get: () => c.get(), doc: id => { const d = c.doc(id); check(d.path, true); return d; } });
    return { collection: p => { check(p, false); return wrapCol(ns.collection(p)); }, doc: p => { check(p, true); return ns.doc(p); } };
  } };
  return { paths, restore: () => { window.claude = real; } };
}
T.storageDb = async () => {
  const s = strictDb();
  try {
    const store = await openProjects({ appKey: 'libtest' });
    const suite = await storageSuite(store);
    const col = await (await window.claude.use('db')).collection('data/users/nico-test/studio/projects').get();
    return { backend: store.backend, suite, docsInMockDb: col.size, samplePath: s.paths.find(p => p.split('/').length === 6), pathsGrammarOk: true,
      pass: store.backend === 'db' && suite.ok && col.size === 2 };
  } finally { s.restore(); }
};
T.storageIdb = async () => {
  const store = await openProjects({ appKey: 'libtest-idb' });
  const before = (await store.list()).length;
  const suite = before === 0 ? await storageSuite(store) : null;
  return { backend: store.backend, before, suite, pass: store.backend === 'indexeddb' && (suite ? suite.ok : before === 2) };
};
T.storageIdbAfterReload = async () => {
  const store = await openProjects({ appKey: 'libtest-idb' });
  const list = await store.list();
  return { backend: store.backend, names: list.map(x => x.name), pass: store.backend === 'indexeddb' && list.length === 2 };
};
T.storageMemory = async () => {
  const store = await openProjects({ appKey: 'libtest', backend: 'memory' });
  const suite = await storageSuite(store);
  return { backend: store.backend, suite, pass: store.backend === 'memory' && suite.ok };
};
T.autosave = async () => {
  const store = await openProjects({ backend: 'memory' });
  let calls = 0; const counted = { ...store, save: async p => { calls++; await sleep(30); return store.save(p); } };
  const project = { name: 'Auto', bpm: 70 };
  const a = autosave(counted, () => project, 200);
  for (let i = 0; i < 10; i++) { project.bpm = 70 + i; a.touch(); await sleep(40); }   // 10 edits within 400 ms
  const duringEdits = calls;
  await sleep(350);
  const afterQuiet = calls;
  const saved = await store.load(project.id);
  a.touch(); await a.flush(); const afterFlush = calls; await sleep(300); const noExtra = calls;
  // edits during a save queue exactly one more save
  a.touch(); await sleep(210); a.touch(); await a.flush();
  const overlap = calls - noExtra;
  a.dispose();
  return { editsMade: 10, savesDuringEdits: duringEdits, savesAfterQuiet: afterQuiet, savedBpm: saved?.bpm, afterFlush, afterFlushWait: noExtra, savesForOverlap: overlap, saves: a.saves,
    pass: duringEdits === 0 && afterQuiet === 1 && saved?.bpm === 79 && afterFlush === 2 && noExtra === 2 && overlap === 2 };
};

// ---- songs
T.songs = async () => {
  const ref = await (await fetch('../../tracks-data.json')).json();
  const mismatches = [];
  for (const [id, v] of Object.entries(ref)) {
    const s = SONGS.find(x => x.id === id);
    if (!s || s.duration !== v.duration || JSON.stringify(s.peaks) !== JSON.stringify(v.peaks)) mismatches.push(id);
  }
  const ctx = new OfflineAudioContext(2, 1, 44100), rows = [];
  for (const s of SONGS) {
    const t0 = performance.now(); const b = await loadSong(ctx, s.id); const ms = performance.now() - t0;
    const t1 = performance.now(); const again = await loadSong(ctx, s.id); const cachedMs = performance.now() - t1;
    // independent check of the stored peaks: same method on the browser-decoded audio (mono mix, 120 bins, max abs)
    const L = b.getChannelData(0), R = b.numberOfChannels > 1 ? b.getChannelData(1) : L, n = Math.floor(b.length / 120), pk = [];
    for (let k = 0; k < 120; k++) { let m = 0; for (let i = k * n; i < (k + 1) * n; i++) { const a = Math.abs((L[i] + R[i]) / 2); if (a > m) m = a; } pk.push(m); }
    const mx = Math.max(...pk); const p2 = pk.map(x => x / mx);
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length, ma = mean(p2), mb = mean(s.peaks);
    const corr = p2.reduce((acc, x, i) => acc + (x - ma) * (s.peaks[i] - mb), 0) / Math.sqrt(p2.reduce((a, x) => a + (x - ma) ** 2, 0) * s.peaks.reduce((a, x) => a + (x - mb) ** 2, 0));
    rows.push({ id: s.id, title: s.title, duration: s.duration, decodedSec: r2(b.duration), decodeMs: Math.round(ms), cached: again === b, cachedMs: r2(cachedMs), peaks: s.peaks.length, peakCorr: r4(corr) });
  }
  let unknown = null; try { songUrl('nope'); } catch (e) { unknown = e.message; }
  const ok = rows.every(r => r.cached && r.peaks === 120 && Math.abs(r.decodedSec - r.duration) < 0.15 && r.peakCorr > 0.95);
  return { count: SONGS.length, matchesTracksData: mismatches.length === 0, mismatches, rows, unknown, url0: songUrl(SONGS[0].id),
    pass: SONGS.length === 9 && mismatches.length === 0 && ok && SONGS[0].title === 'After the Storm' };
};

// ---- reverb
function analyseIR(buf, decay) {
  const sr = buf.sampleRate, L = buf.getChannelData(0), R = buf.getChannelData(1);
  let sl = 0, srr = 0, el = 0, er = 0, lr = 0, peak = 0, nan = 0;
  for (let i = 0; i < L.length; i++) { sl += L[i]; srr += R[i]; el += L[i] ** 2; er += R[i] ** 2; lr += L[i] * R[i]; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); if (!Number.isFinite(L[i] + R[i])) nan++; }
  const dcRel = Math.max(Math.abs(sl), Math.abs(srr)) / L.length / Math.sqrt(el / L.length);
  const corr = lr / Math.sqrt(el * er);
  // Schroeder backward integration -> energy decay curve; fit a line between -5 and -35 dB (T30) -> RT60
  const edc = new Float64Array(L.length); let acc = 0;
  for (let i = L.length - 1; i >= 0; i--) { acc += L[i] ** 2 + R[i] ** 2; edc[i] = acc; }
  const db = i => 10 * Math.log10(edc[i] / edc[0]);
  const lim = Math.floor(L.length * 0.8); // stay clear of the end fade / truncation
  let i5 = 0, i35 = 0; while (i5 < lim && db(i5) > -5) i5++; i35 = i5; while (i35 < lim && db(i35) > -35) i35++;
  const xs = [], ys = []; for (let i = i5; i < i35; i += 64) { xs.push(i / sr); ys.push(db(i)); }
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const slope = xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const maxDev = Math.max(...xs.map((x, k) => Math.abs(my + slope * (x - mx) - ys[k])));
  // short-time energy (20 ms windows) over the first 60 dB: smoothness = std of residual from the fitted line, in dB
  const win = Math.round(0.02 * sr), env = [];
  for (let s = 0; s + win < L.length && s / sr < Math.min(decay, buf.duration) * 0.9; s += win) { let e = 0; for (let i = s; i < s + win; i++) e += L[i] ** 2 + R[i] ** 2; env.push([s / sr, 10 * Math.log10(e / win + 1e-30)]); }
  const em = env.slice(2), ex = em.reduce((a, p) => a + p[0], 0) / em.length, ey = em.reduce((a, p) => a + p[1], 0) / em.length;
  const es = em.reduce((a, p) => a + (p[0] - ex) * (p[1] - ey), 0) / em.reduce((a, p) => a + (p[0] - ex) ** 2, 0);
  const resid = Math.sqrt(em.reduce((a, p) => a + (ey + es * (p[0] - ex) - p[1]) ** 2, 0) / em.length);
  // brightness: zero-crossing rate early vs late (a cheap spectral centroid proxy)
  const zcr = (a, b) => { let z = 0; for (let i = a + 1; i < b; i++) if ((L[i - 1] < 0) !== (L[i] < 0)) z++; return z / (b - a) * sr / 2; };
  const q = Math.floor(L.length / 10);
  return { dcRel, corrLR: corr, rt60: -60 / slope, edcMaxDevDb: maxDev, envResidDb: resid, peak, nan, energyL: el, zcrEarlyHz: zcr(q, 2 * q), zcrLateHz: zcr(6 * q, 7 * q) };
}
function reversed(buf) {
  const b = new AudioBuffer({ numberOfChannels: 2, length: buf.length, sampleRate: buf.sampleRate });
  for (let c = 0; c < 2; c++) b.getChannelData(c).set(buf.getChannelData(c).slice().reverse());
  return b;
}
T.reverb = async () => {
  const ctx = new OfflineAudioContext(2, 1, 44100), rows = [];
  for (const [name, o] of Object.entries(REVERB_PRESETS)) {
    const t0 = performance.now(); const ir = makeImpulse(ctx, o); const ms = performance.now() - t0;
    const a = analyseIR(o.reverse ? reversed(ir) : ir, o.decay), w = o.width ?? 1, corrExpected = (1 - w * w) / (1 + w * w);
    rows.push({ name, width: w, corrExpected: r4(corrExpected), seconds: r2(ir.duration), genMs: Math.round(ms), decaySet: o.decay, rt60Measured: r2(a.rt60), dcRel: a.dcRel.toExponential(1), corrLR: r4(a.corrLR),
      edcMaxDevDb: r2(a.edcMaxDevDb), envResidDb: r2(a.envResidDb), zcrEarlyHz: Math.round(a.zcrEarlyHz), zcrLateHz: Math.round(a.zcrLateHz), peak: r4(a.peak), nan: a.nan });
  }
  // decay accuracy without damping, width, damping behaviour, cache
  const flat = analyseIR(makeImpulse(ctx, { seconds: 4, decay: 3, damping: 0, preDelay: 0 }), 3);
  const w0 = analyseIR(makeImpulse(ctx, { seconds: 2, width: 0, preDelay: 0 }), 2).corrLR, w5 = analyseIR(makeImpulse(ctx, { seconds: 2, width: 0.5, preDelay: 0 }), 2).corrLR;
  const dark = analyseIR(makeImpulse(ctx, { seconds: 4, decay: 3, damping: 0.8, preDelay: 0 }), 3);
  const pre = makeImpulse(ctx, { seconds: 1, preDelay: 0.05 }); const preZeros = pre.getChannelData(0).subarray(0, Math.round(0.05 * 44100)).every(x => x === 0);
  const t1 = performance.now(); const c1 = makeImpulse(ctx, REVERB_PRESETS.cathedral); const cacheMs = performance.now() - t1;
  const cacheHit = c1 === makeImpulse(ctx, REVERB_PRESETS.cathedral);
  // real use: a soft sine pluck through a ConvolverNode, rendered offline; saved for listening
  const wet = await renderOffline({ seconds: 6, build(c, dest) {
    const conv = c.createConvolver(); conv.buffer = makeImpulse(c, REVERB_PRESETS.hall);
    const dry = c.createGain(); dry.gain.value = 0.5; const send = c.createGain(); send.gain.value = 0.6;
    [523.25, 659.25, 783.99].forEach((f, k) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; const t = k * 0.35; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2); o.connect(g); g.connect(dry); g.connect(send); o.start(t); o.stop(t + 1.3); });
    send.connect(conv); conv.connect(dest); dry.connect(dest);
  } });
  const mw = measure(wet);
  const ok = rows.every(r => +r.dcRel < 1e-4 && Math.abs(r.corrLR - r.corrExpected) < 0.05 && r.edcMaxDevDb < 1.5 && r.nan === 0) &&
    Math.abs(flat.rt60 - 3) / 3 < 0.08 && w0 > 0.999 && w5 > 0.4 && w5 < 0.8 && dark.zcrLateHz < dark.zcrEarlyHz * 0.6 && flat.zcrLateHz > flat.zcrEarlyHz * 0.85 && preZeros && cacheHit && mw.clippedSamples === 0;
  return { rows, noDamping: { decaySet: 3, rt60Measured: r2(flat.rt60), errPct: r2(Math.abs(flat.rt60 - 3) / 3 * 100), zcrEarlyHz: Math.round(flat.zcrEarlyHz), zcrLateHz: Math.round(flat.zcrLateHz) },
    damping08: { rt60Measured: r2(dark.rt60), zcrEarlyHz: Math.round(dark.zcrEarlyHz), zcrLateHz: Math.round(dark.zcrLateHz) },
    widthCorr: { w0: r4(w0), w05: r4(w5), w1: rows.find(r => r.name === 'hall').corrLR }, preDelayZeros: preZeros, cacheHit, cacheHitMs: r4(cacheMs),
    pluckThroughHall: { peakDb: r2(mw.peakDb), rmsDb: r2(mw.rmsDb), clippedSamples: mw.clippedSamples },
    files: { 'reverb-hall-pluck.wav': await b64(encodeWav(wet)), 'ir-hall.wav': await b64(encodeWav(makeImpulse(ctx, REVERB_PRESETS.hall), { bitDepth: 32 })) },
    pass: ok };
};

window.__tests = T;
window.__testsReady = true;
