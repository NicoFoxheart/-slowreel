// video.js - music video export: audio first, then per-frame audio numbers, then every frame rendered offscreen at the
// target size and encoded with WebCodecs (H.264 + AAC in .mp4; else VP9 + Opus in .webm), frame-exact 30 fps.
// Without WebCodecs it falls back to lib/export.js recordVideo (real time). The audio is never changed: it is the
// rendered mix, or Nico's song (or a phone file) decoded as it is.
import { recordVideo, saveFile, trimTail } from '../../lib/export.js?v=7';
import { computeFeatures, frameAt } from './features.js?v=7';
import { encodeVideo, abortErr } from './video-core.js?v=7';
import { loadHeart } from './common.js?v=7';

export const FORMATS = {
  '9:16': { id: '9:16', w: 1080, h: 1920, use: 'TikTok · Reels · Shorts' },
  '16:9': { id: '16:9', w: 1920, h: 1080, use: 'YouTube' },
  '1:1': { id: '1:1', w: 1080, h: 1080, use: 'Instagram' },
};
export const SAMPLE_RATE = 48000;
const H264 = ['avc1.640028', 'avc1.4d0028', 'avc1.420028'];
export const safeName = s => (s || 'Nicofoxheart').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'Nicofoxheart';
export const videoBitrate = (w, h, fps = 30) => Math.round(Math.min(9e6, Math.max(2e6, w * h * fps * 0.1)));

/** Which encoders this browser has for this size: {container, ext, mime, video, audio, label, note} or null (no WebCodecs). */
export async function pickCodecs(width, height, { fps = 30, sampleRate = SAMPLE_RATE } = {}) {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  const bitrate = videoBitrate(width, height, fps);
  const vOk = async cfg => { try { return (await VideoEncoder.isConfigSupported(cfg)).supported ? cfg : null; } catch { return null; } };
  const aOk = async cfg => { try { return (await AudioEncoder.isConfigSupported(cfg)).supported ? cfg : null; } catch { return null; } };
  const base = { width, height, bitrate, framerate: fps, bitrateMode: 'variable' };
  let video = null;
  for (const codec of H264) { video = await vOk({ ...base, codec, avc: { format: 'avc' } }); if (video) break; }
  const aac = video && await aOk({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate: 192000 });
  if (video && aac) return { container: 'mp4', ext: 'mp4', mime: 'video/mp4', video, audio: aac, label: 'MP4 · H.264 + AAC', note: '' };
  const why = video ? 'this browser has no AAC encoder' : 'this browser has no H.264 encoder';
  const vp9 = await vOk({ ...base, codec: 'vp09.00.40.08' }) || await vOk({ ...base, codec: 'vp8' });
  const opus = await aOk({ codec: 'opus', sampleRate, numberOfChannels: 2, bitrate: 160000 });
  if (vp9 && opus) return { container: 'webm', ext: 'webm', mime: 'video/webm', video: vp9, audio: opus, label: `WebM · ${vp9.codec === 'vp8' ? 'VP8' : 'VP9'} + Opus`, note: `WebM instead of MP4: ${why}.` };
  return null;
}

/** Decode audio bytes (mp3, m4a, wav...) at 48 kHz without touching an AudioContext (no playback). */
export async function decodeAudio(arrayBuffer) {
  const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  return new C(2, 1, SAMPLE_RATE).decodeAudioData(arrayBuffer);
}

/**
 * Make the video. audio: AudioBuffer (the exact sound). Returns {blob, ext, mime, width, height, frames, hasAudio, codec, note, realtime, where}.
 * onProgress(stage, frac, info): stages 'listen' (reading the audio), 'frames', 'finish'. light = phone scene.
 * Renders in a Worker (OffscreenCanvas) when it can, so the page stays responsive; else on the page, chunked per frame.
 */
export async function makeVideo({ audio, width, height, fps = 30, seconds, mood, intensity, title, artist, light = false, features,
  onProgress = () => { }, signal, forceRecorder = false, forceMain = false }) {
  const dur = Math.min(audio.duration, seconds || audio.duration);
  const frames = Math.max(1, Math.round(dur * fps));
  onProgress('listen', 0);
  const F = features && features.frames >= frames ? features : await computeFeatures(audio, { fps, seconds: frames / fps, signal, onProgress: f => onProgress('listen', f) });
  onProgress('listen', 1);
  if (signal?.aborted) throw abortErr();
  const sceneOpts = { mood, intensity, title, artist, light, antialias: true };
  const codecs = forceRecorder ? null : await pickCodecs(width, height, { fps, sampleRate: audio.sampleRate });
  if (!codecs) return viaRecorder({ audio, sceneOpts, F, dur, fps, width, height, onProgress, signal });
  const total = Math.round(frames / fps * audio.sampleRate);
  const done = (buffer, where) => ({ blob: new Blob([buffer], { type: codecs.mime }), ext: codecs.ext, mime: codecs.mime, width, height, frames, hasAudio: true, codec: codecs.label, note: codecs.note, realtime: false, where });
  if (!forceMain && typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined') {
    try { return done(await viaWorker({ audio, total, F, frames, fps, width, height, codecs, sceneOpts, onProgress, signal }), 'worker'); }
    catch (e) { if (!e?.init) throw e; console.warn('[video] worker could not start, rendering on the page:', e.message); }
  }
  const { createHeartScene } = await loadHeart();
  const scene = createHeartScene({ ...sceneOpts, width, height, pixelRatio: 1, preserve: true });
  try {
    const L = audio.getChannelData(0), R = audio.numberOfChannels > 1 ? audio.getChannelData(1) : L;
    return done(await encodeVideo({ scene, F, left: L, right: R, sampleRate: audio.sampleRate, frames, fps, width, height, codecs, onProgress, cancelled: () => !!signal?.aborted }), 'page');
  } finally { scene.dispose(); }
}

async function viaWorker({ audio, total, F, frames, fps, width, height, codecs, sceneOpts, onProgress, signal }) {
  // the text layer is drawn here, where the page fonts are, and handed over as a bitmap
  const { drawTextLayer } = await import('./heart-scene.js?v=7');
  try { await Promise.race([Promise.all([document.fonts?.load('64px "Dela Gothic One"'), document.fonts?.load('500 32px "M PLUS Rounded 1c"')]), new Promise(r => setTimeout(r, 1500))]); } catch { }
  const tc = document.createElement('canvas'); tc.width = width; tc.height = height;
  const layout = drawTextLayer(tc, { title: sceneOpts.title, artist: sceneOpts.artist, mood: sceneOpts.mood });
  const bitmap = await createImageBitmap(tc, { imageOrientation: 'flipY' });
  const left = audio.getChannelData(0).slice(0, total), right = (audio.numberOfChannels > 1 ? audio.getChannelData(1) : audio.getChannelData(0)).slice(0, total);
  const w = new Worker(new URL('./render-worker.js?v=7', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const fail = e => { cleanup(); reject(e); };
    const onAbort = () => w.postMessage({ cmd: 'cancel' });
    const cleanup = () => { signal?.removeEventListener('abort', onAbort); setTimeout(() => w.terminate(), 0); };
    signal?.addEventListener('abort', onAbort);
    w.onerror = ev => { ev.preventDefault?.(); const e = new Error(ev.message || 'the render worker failed to load'); e.init = true; fail(e); };
    w.onmessage = ({ data: m }) => {
      if (m.type === 'progress') onProgress(m.stage, m.f, m.info);
      else if (m.type === 'done') { cleanup(); resolve(m.buffer); }
      else if (m.type === 'error') { const e = m.name === 'AbortError' ? abortErr() : new Error(m.message); e.init = m.init && m.name !== 'AbortError'; fail(e); }
    };
    const plain = { fps: F.fps, frames: F.frames, onsets: F.onsets };
    for (const k of ['pulse', 'low', 'mid', 'high', 'level', 'slow', 'accent']) plain[k] = F[k];
    w.postMessage({ cmd: 'start', width, height, fps, frames, F: plain, left, right, sampleRate: audio.sampleRate, codecs, sceneOpts, textLayer: { bitmap, layout } }, [left.buffer, right.buffer, bitmap]);
  });
}

// No WebCodecs: play the audio silently into a MediaRecorder (never to the speakers) while the heart renders live.
async function viaRecorder({ audio, sceneOpts, F, dur, fps, width, height, onProgress, signal }) {
  const { createHeartScene } = await loadHeart();
  const scene = createHeartScene({ ...sceneOpts, width, height, pixelRatio: 1, preserve: true });
  const C = window.AudioContext || window.webkitAudioContext, ctx = new C({ sampleRate: audio.sampleRate });
  try {
    await ctx.resume();
    const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = audio; src.connect(g);
    let raf = 0, t0 = 0, run = true;
    const tick = () => { if (!run) return; const t = Math.max(0, ctx.currentTime - t0); scene.render(t, frameAt(F, Math.round(t * fps)), { duration: dur }); raf = requestAnimationFrame(tick); };
    t0 = ctx.currentTime + 0.05; src.start(t0); tick();
    const r = await recordVideo({ canvas: scene.canvas, audioNode: g, seconds: dur, width, height, fps, signal,
      onProgress: f => onProgress('frames', f, { frame: Math.round(f * dur * fps), frames: Math.round(dur * fps), fps, eta: (1 - f) * dur }) });
    run = false; cancelAnimationFrame(raf); try { src.stop(); } catch { }
    if (signal?.aborted) throw abortErr();
    return { blob: r.blob, ext: r.ext, mime: r.blob.type || `video/${r.ext}`, width, height, frames: Math.round(dur * fps), hasAudio: true,
      codec: `${r.ext.toUpperCase()} (recorded in real time)`, note: 'This browser has no WebCodecs, so the video records in real time.', realtime: true };
  } finally { ctx.close().catch(() => { }); scene.dispose(); }
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
