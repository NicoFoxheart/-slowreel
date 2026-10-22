// video.js - music video export: audio first, then per-frame audio numbers, then every frame of the chosen scene
// (scenes/index.js) rendered offscreen at the target size and encoded with WebCodecs (H.264 + AAC in .mp4; else VP9 +
// Opus in .webm), frame-exact at 30 (or 60) fps. Without WebCodecs it falls back to lib/export.js recordVideo (real
// time). The audio is never changed: it is the rendered mix, Nico's song, or an imported file, decoded as it is.
import { recordVideo, saveFile, trimTail } from '../../lib/export.js?v=9d';
import { computeFeatures, frameAt, silentFeatures } from './features.js?v=9d';
import { encodeVideo, abortErr } from './video-core.js?v=9d';

/** Aspect formats. w/h are the 1080p ("HD") size, kept for older callers; sizes come from RESOLUTIONS. */
export const FORMATS = {
  '16:9': { id: '16:9', w: 1920, h: 1080, use: 'YouTube' },
  '9:16': { id: '9:16', w: 1080, h: 1920, use: 'TikTok · Reels · Shorts' },
  '1:1': { id: '1:1', w: 1080, h: 1080, use: 'Instagram' },
};
/** Resolutions by their short side. 4K is offered only when the browser can encode it (see encodeSupport). */
export const RESOLUTIONS = [
  { id: '720', name: '720p', short: 720, long: 1280, mbps: 10 },
  { id: '1080', name: 'HD 1080p', short: 1080, long: 1920, mbps: 16, default: true },
  { id: '1440', name: '1440p', short: 1440, long: 2560, mbps: 28 },
  { id: '2160', name: '4K', short: 2160, long: 3840, mbps: 45 },
];
export const DEFAULT_RES = '1080';
/** [width, height] for an aspect + resolution id. */
export function videoSize(format = '16:9', res = DEFAULT_RES) {
  const R = RESOLUTIONS.find(r => r.id === String(res)) || RESOLUTIONS[1];
  return format === '9:16' ? [R.short, R.long] : format === '1:1' ? [R.short, R.short] : [R.long, R.short];
}
export const SAMPLE_RATE = 48000;
export const safeName = s => (s || 'Nicofoxheart').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'Nicofoxheart';

/**
 * Video bitrate (bits/s): ~10 Mbps 720p30, 16 at 1080p30, 28 at 1440p30, 45 at 4K30 (grain and rain need it), scaled by
 * the pixel count against the 16:9 frame of the same class (1:1 has fewer pixels) and x1.5 at 60 fps. VP9 gets 75%.
 */
export function videoBitrate(w, h, fps = 30, codec = 'avc') {
  const short = Math.min(w, h), cls = RESOLUTIONS.reduce((a, r) => (Math.abs(r.short - short) < Math.abs(a.short - short) ? r : a), RESOLUTIONS[0]);
  const px = (w * h) / (cls.short * cls.long);
  let b = cls.mbps * 1e6 * Math.pow(px, 0.85) * (short / cls.short) ** 1.6 * (fps > 30 ? 1.5 : 1);
  if (codec !== 'avc') b *= 0.75;
  return Math.round(Math.max(2e6, Math.min(80e6, b)));
}

// H.264 levels: [level_idc hex, max macroblocks per frame, max macroblocks per second]
const LEVELS = [['28', 8192, 245760], ['2a', 8704, 522240], ['32', 22080, 589824], ['33', 36864, 983040], ['34', 36864, 2073600], ['3c', 139264, 4177920]];
/** The H.264 codec strings to try for this size and rate, lowest fitting level first: High, then Main, then Baseline. */
export function avcCodecs(w, h, fps = 30) {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16), rate = mbs * fps, maxDim = Math.max(Math.ceil(w / 16), Math.ceil(h / 16));
  const fit = LEVELS.filter(([, fs, r]) => fs >= mbs && r >= rate && maxDim <= Math.sqrt(fs * 8));
  const lv = fit.slice(0, 2).map(l => l[0]);
  return [...lv.map(l => `avc1.6400${l}`), ...lv.map(l => `avc1.4d00${l}`), ...lv.map(l => `avc1.4200${l}`)];
}

/** Which encoders this browser has for this size: {container, ext, mime, video, audio, label, note} or null (no WebCodecs). */
export async function pickCodecs(width, height, { fps = 30, sampleRate = SAMPLE_RATE } = {}) {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  const vOk = async cfg => { try { return (await VideoEncoder.isConfigSupported(cfg)).supported ? cfg : null; } catch { return null; } };
  const aOk = async cfg => { try { return (await AudioEncoder.isConfigSupported(cfg)).supported ? cfg : null; } catch { return null; } };
  const base = { width, height, framerate: fps, bitrateMode: 'variable', latencyMode: 'quality' };
  let video = null;
  for (const codec of avcCodecs(width, height, fps)) { video = await vOk({ ...base, bitrate: videoBitrate(width, height, fps, 'avc'), codec, avc: { format: 'avc' } }); if (video) break; }
  const aac = video && await aOk({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate: 256000 });
  const mbps = c => (c.bitrate / 1e6).toFixed(0);
  if (video && aac) return { container: 'mp4', ext: 'mp4', mime: 'video/mp4', video, audio: aac, label: `MP4 · H.264 ${mbps(video)} Mbps + AAC`, note: '' };
  const why = video ? 'this browser has no AAC encoder' : 'this browser has no H.264 encoder at this size';
  const vb = videoBitrate(width, height, fps, 'vp9');
  const vp9 = await vOk({ ...base, bitrate: vb, codec: height * width > 2.2e6 ? 'vp09.00.51.08' : 'vp09.00.41.08' }) || await vOk({ ...base, bitrate: vb, codec: 'vp09.00.40.08' }) || await vOk({ ...base, bitrate: vb, codec: 'vp8' });
  const opus = await aOk({ codec: 'opus', sampleRate, numberOfChannels: 2, bitrate: 192000 });
  if (vp9 && opus) return { container: 'webm', ext: 'webm', mime: 'video/webm', video: vp9, audio: opus, label: `WebM · ${vp9.codec === 'vp8' ? 'VP8' : 'VP9'} ${mbps(vp9)} Mbps + Opus`, note: `WebM instead of MP4: ${why}.` };
  return null;
}

/** What this browser can encode, per resolution id (for the picker): {'720': codecs|null, ...}. 9:16 and 1:1 follow 16:9. */
export async function encodeSupport({ fps = 30 } = {}) {
  const out = {};
  for (const r of RESOLUTIONS) { const [w, h] = videoSize('16:9', r.id); out[r.id] = await pickCodecs(w, h, { fps }); }
  return out;
}

/** Decode audio bytes (mp3, m4a, wav, ogg...) at 48 kHz without touching an AudioContext (no playback). */
export async function decodeAudio(arrayBuffer) {
  const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  return new C(2, 1, SAMPLE_RATE).decodeAudioData(arrayBuffer);
}

/** Text colours / layout for a scene: the heart keeps its mood name (exactly the old layer), others use meta.text. */
async function textFor({ scene, variant, meta }) {
  if (scene === 'heart') return variant || 'sakura';
  const { textStyle, sceneMeta } = await import('./scenes/index.js?v=9d');
  return textStyle(meta || await sceneMeta(scene), variant);
}
/** The title layer (drawn on the page, where the fonts are) as {bitmap, layout}, or null without text. */
export async function makeTextLayer(width, height, { title = '', artist = '', showText = true, mood }) {
  const { drawTextLayer } = await import('./heart-scene.js?v=9d');
  try { await Promise.race([Promise.all([document.fonts?.load('64px "Dela Gothic One"'), document.fonts?.load('500 32px "M PLUS Rounded 1c"')]), new Promise(r => setTimeout(r, 1500))]); } catch { }
  const tc = document.createElement('canvas'); tc.width = width; tc.height = height;
  const layout = drawTextLayer(tc, { title: showText ? title : '', artist: showText ? artist : '', mood });
  if (!showText && layout) layout.hideBar = true;
  return { bitmap: await createImageBitmap(tc, { imageOrientation: 'flipY' }), layout };
}

/**
 * Make the video. audio: AudioBuffer (the exact sound). Returns {blob, ext, mime, width, height, frames, fps, hasAudio, codec, note, realtime, where, scene, variant}.
 * scene: registry id (default 'heart'); variant (mood for the heart); quality 'light' | 'high' | 'ultra' (light = true
 * means 'light'); showText: title + artist + progress line. onProgress(stage, frac, info): stages 'listen' (reading the
 * audio), 'frames' (info: {frame, frames, fps, eta, elapsed, settled, still?: ImageBitmap}), 'finish'.
 * Renders in a Worker (OffscreenCanvas) when it can, so the page stays responsive; else on the page, chunked per frame.
 */
export async function makeVideo({ audio, width, height, fps = 30, seconds, scene = 'heart', variant, mood, quality, light = false, showText = true, intensity = 0.6, seed = 1,
  title = '', artist = '', meta = null, features, onProgress = () => { }, signal, forceRecorder = false, forceMain = false }) {
  variant = variant ?? mood; quality = quality || (light ? 'light' : 'high');
  const dur = Math.min(audio.duration, seconds || audio.duration);
  const frames = Math.max(1, Math.round(dur * fps));
  onProgress('listen', 0);
  const F = features && features.frames >= frames && features.fps === fps ? features : await computeFeatures(audio, { fps, seconds: frames / fps, signal, onProgress: f => onProgress('listen', f) });
  onProgress('listen', 1);
  if (signal?.aborted) throw abortErr();
  const sceneOpts = { scene, variant, quality, seed, title, artist, showText, intensity };
  const textMood = await textFor({ scene, variant, meta });
  const codecs = forceRecorder ? null : await pickCodecs(width, height, { fps, sampleRate: audio.sampleRate });
  if (!codecs) return viaRecorder({ audio, sceneOpts, textMood, F, dur, fps, width, height, onProgress, signal });
  const total = Math.round(frames / fps * audio.sampleRate);
  const done = (buffer, where) => ({ blob: new Blob([buffer], { type: codecs.mime }), ext: codecs.ext, mime: codecs.mime, width, height, frames, fps, hasAudio: true, codec: codecs.label,
    note: codecs.note, realtime: false, where, scene, variant, quality });
  if (!forceMain && typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined') {
    try { return done(await viaWorker({ audio, total, F, frames, fps, width, height, codecs, sceneOpts, textMood, onProgress, signal }), 'worker'); }
    catch (e) { if (!e?.init) throw e; console.warn('[video] worker could not start, rendering on the page:', e.message); }
  }
  const host = await pageHost({ width, height, sceneOpts, textMood });
  try {
    const L = audio.getChannelData(0), R = audio.numberOfChannels > 1 ? audio.getChannelData(1) : L;
    return done(await encodeVideo({ scene: host, F, left: L, right: R, sampleRate: audio.sampleRate, frames, fps, width, height, codecs, onProgress, cancelled: () => !!signal?.aborted }), 'page');
  } finally { host.dispose(); }
}

async function pageHost({ width, height, sceneOpts, textMood }) {
  const [{ createSceneHost }, THREE] = await Promise.all([import('./scenes/host.js?v=9d'), import('three')]);
  const host = createSceneHost({ THREE, width, height, pixelRatio: 1, preserve: true, antialias: sceneOpts.scene === 'heart' && sceneOpts.quality !== 'light' });
  await host.load({ ...sceneOpts, textLayer: await makeTextLayer(width, height, { ...sceneOpts, mood: textMood }) });
  return host;
}

const FIELDS = ['pulse', 'low', 'mid', 'high', 'level', 'slow', 'accent', 'energy', 'bass', 'bright', 'big', 'onset', 'flow'];
async function viaWorker({ audio, total, F, frames, fps, width, height, codecs, sceneOpts, textMood, onProgress, signal }) {
  const textLayer = await makeTextLayer(width, height, { ...sceneOpts, mood: textMood });
  const left = audio.getChannelData(0).slice(0, total), right = (audio.numberOfChannels > 1 ? audio.getChannelData(1) : audio.getChannelData(0)).slice(0, total);
  const w = new Worker(new URL('./render-worker.js?v=9d', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const fail = e => { cleanup(); reject(e); };
    const onAbort = () => w.postMessage({ cmd: 'cancel' });
    const cleanup = () => { signal?.removeEventListener('abort', onAbort); setTimeout(() => w.terminate(), 0); };
    signal?.addEventListener('abort', onAbort);
    if (signal?.aborted) onAbort();
    w.onerror = ev => { ev.preventDefault?.(); const e = new Error(ev.message || 'the render worker failed to load'); e.init = true; fail(e); };
    w.onmessage = ({ data: m }) => {
      if (m.type === 'progress') { if (m.still && m.info) m.info.still = m.still; onProgress(m.stage, m.f, m.info); if (m.still && !m.info) m.still.close?.(); }
      else if (m.type === 'ready') onProgress('ready', 0, { meta: m.meta });
      else if (m.type === 'done') { cleanup(); resolve(m.buffer); }
      else if (m.type === 'error') { const e = m.name === 'AbortError' ? abortErr() : new Error(m.message); e.init = m.init && m.name !== 'AbortError'; fail(e); }
    };
    const plain = { fps: F.fps, frames: F.frames, onsets: F.onsets };
    for (const k of FIELDS) if (F[k]) plain[k] = F[k];
    w.postMessage({ cmd: 'start', width, height, fps, frames, F: plain, left, right, sampleRate: audio.sampleRate, codecs, sceneOpts, textLayer }, [left.buffer, right.buffer, textLayer.bitmap]);
  });
}

// No WebCodecs: play the audio silently into a MediaRecorder (never to the speakers) while the scene renders live.
async function viaRecorder({ audio, sceneOpts, textMood, F, dur, fps, width, height, onProgress, signal }) {
  const host = await pageHost({ width, height, sceneOpts, textMood });
  const C = window.AudioContext || window.webkitAudioContext, ctx = new C({ sampleRate: audio.sampleRate });
  try {
    await ctx.resume();
    const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = audio; src.connect(g);
    let raf = 0, t0 = 0, run = true;
    const tick = () => { if (!run) return; const t = Math.max(0, ctx.currentTime - t0); host.render(t, frameAt(F, Math.round(t * fps)), { duration: dur, fps }); raf = requestAnimationFrame(tick); };
    t0 = ctx.currentTime + 0.05; src.start(t0); tick();
    const r = await recordVideo({ canvas: host.canvas, audioNode: g, seconds: dur, width, height, fps, signal,
      onProgress: f => onProgress('frames', f, { frame: Math.round(f * dur * fps), frames: Math.round(dur * fps), fps, eta: (1 - f) * dur, settled: true }) });
    run = false; cancelAnimationFrame(raf); try { src.stop(); } catch { }
    if (signal?.aborted) throw abortErr();
    return { blob: r.blob, ext: r.ext, mime: r.blob.type || `video/${r.ext}`, width, height, frames: Math.round(dur * fps), fps, hasAudio: true,
      codec: `${r.ext.toUpperCase()} (recorded in real time)`, note: 'This browser has no WebCodecs, so the video records in real time.', realtime: true, scene: sceneOpts.scene, variant: sceneOpts.variant };
  } finally { ctx.close().catch(() => { }); host.dispose(); }
}

/** Render a Slowreel project at 48 kHz with its reverb tail (seconds limits it, for tests). */
export async function renderProjectAudio(engine, project, { seconds, onProgress } = {}) {
  const p = JSON.parse(JSON.stringify(project)); p.loop = { ...(p.loop || {}), on: false };
  const bpb = p.beatsPerBar || 4;
  if (seconds) p.lengthBars = Math.max(1, Math.ceil(seconds * p.bpm / 60 / bpb));
  const songSec = p.lengthBars * bpb * 60 / p.bpm;
  const raw = await engine.render(p, { tailSeconds: seconds ? 1 : 8, sampleRate: SAMPLE_RATE, toBeat: p.lengthBars * bpb, onProgress });
  return trimTail(raw, { minSeconds: Math.min(raw.duration, seconds || songSec) });
}

/** Save with the downloads capability (.mp4 / .webm are allowed). */
export function saveVideo(name, result) { return saveFile(`${safeName(name)}.${result.ext}`, result.blob); }
export { silentFeatures };
