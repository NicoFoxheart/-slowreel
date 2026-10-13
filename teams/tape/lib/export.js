// export.js - offline render, measuring, WAV / MP3 / ZIP encoding, saving and video capture.
// Plain ES module, no dependencies (lamejs is loaded on first MP3 use). See README.md.

export const LAME_URL = 'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js';

// Yield to the event loop so input, paint and timers run between slices of heavy work. A MessageChannel task has no
// 4 ms clamp, but Chrome may run it ahead of timers; so at least every 40 ms we yield through setTimeout as well
// (not in a hidden tab, where timers are throttled to 1 s and there is nothing to paint).
let lastTimerYield = 0;
const yieldToUI = () => new Promise(r => {
  const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const hidden = typeof document !== 'undefined' && document.hidden;
  if (typeof MessageChannel !== 'function' || (!hidden && t - lastTimerYield > 40)) { lastTimerYield = t; setTimeout(r, 0); return; }
  const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0);
});
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const toDb = x => (x > 0 ? 20 * Math.log10(x) : -Infinity);

function newBuffer(channels, length, sampleRate) {
  return new AudioBuffer({ numberOfChannels: channels, length: Math.max(1, length | 0), sampleRate });
}

// ---------------------------------------------------------------- render + analysis

/** Render a graph offline. `build(ctx, destination)` wires nodes and schedules them (may be async). */
export async function renderOffline({ seconds, sampleRate = 44100, channels = 2, build }) {
  if (!(seconds > 0)) throw new Error('renderOffline: seconds must be > 0');
  const ctx = new OfflineAudioContext({ numberOfChannels: channels, length: Math.ceil(seconds * sampleRate), sampleRate });
  if (build) await build(ctx, ctx.destination);
  return ctx.startRendering();
}

/** Peak / RMS (dBFS, all channels together) and the number of samples at or above full scale. */
export function measure(buffer) {
  let peak = 0, sum = 0, clipped = 0, n = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      if (a >= 1) clipped++;
      sum += d[i] * d[i];
    }
    n += d.length;
  }
  return { peakDb: toDb(peak), rmsDb: toDb(Math.sqrt(sum / Math.max(1, n))), clippedSamples: clipped, seconds: buffer.duration };
}

/**
 * Cut the silent end of a render (e.g. after a reverb tail). Keeps everything up to the last sample louder than
 * `thresholdDb`, plus `padSeconds`, never shorter than `minSeconds`, with a short fade so the cut cannot click.
 * Returns the same buffer when there is nothing to cut.
 */
export function trimTail(buffer, { thresholdDb = -70, minSeconds = 0, padSeconds = 0.1, fadeSeconds = 0.05 } = {}) {
  const sr = buffer.sampleRate, thr = Math.pow(10, thresholdDb / 20);
  let last = -1;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = d.length - 1; i > last; i--) if (Math.abs(d[i]) > thr) { last = i; break; }
  }
  const end = Math.min(buffer.length, Math.max(Math.ceil((last + 1) + padSeconds * sr), Math.ceil(minSeconds * sr), 1));
  if (end >= buffer.length) return buffer;
  const out = newBuffer(buffer.numberOfChannels, end, sr);
  const fade = Math.min(end, Math.round(fadeSeconds * sr));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = out.getChannelData(c);
    d.set(buffer.getChannelData(c).subarray(0, end));
    for (let i = 0; i < fade; i++) d[end - fade + i] *= 0.5 + 0.5 * Math.cos(Math.PI * (i + 1) / fade);
  }
  return out;
}

// ---------------------------------------------------------------- WAV

/** PCM WAV. bitDepth 16 (TPDF dithered), 24 (default) or 32 (float). Values beyond full scale are clamped. */
export function encodeWav(buffer, { bitDepth = 24 } = {}) {
  if (![16, 24, 32].includes(bitDepth)) throw new Error('encodeWav: bitDepth must be 16, 24 or 32');
  const ch = buffer.numberOfChannels, len = buffer.length, bps = bitDepth / 8, sr = buffer.sampleRate;
  const dataBytes = len * ch * bps, ab = new ArrayBuffer(44 + dataBytes), v = new DataView(ab), u8 = new Uint8Array(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) u8[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, bitDepth === 32 ? 3 : 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, bitDepth, true);
  str(36, 'data'); v.setUint32(40, dataBytes, true);
  const chans = []; for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      let s = chans[c][i]; s = s > 1 ? 1 : s < -1 ? -1 : s || 0;
      if (bitDepth === 32) { v.setFloat32(o, s, true); o += 4; }
      else if (bitDepth === 24) {
        let x = Math.round(s * 8388607); // symmetric scale: +1 -> 0x7FFFFF, -1 -> -0x7FFFFF
        u8[o] = x & 255; u8[o + 1] = (x >> 8) & 255; u8[o + 2] = (x >> 16) & 255; o += 3;
      } else {
        let x = Math.round(s * 32767 + (Math.random() - Math.random())); // TPDF dither, 1 LSB
        x = x > 32767 ? 32767 : x < -32768 ? -32768 : x; v.setInt16(o, x, true); o += 2;
      }
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

// ---------------------------------------------------------------- MP3 (lamejs)

let lamePromise = null;
/** Load lamejs once with a <script> tag (the viewer only allows pinned CDN scripts). Resolves window.lamejs. */
export function loadLame(url = LAME_URL) {
  if (globalThis.lamejs?.Mp3Encoder) return Promise.resolve(globalThis.lamejs);
  if (!lamePromise) {
    lamePromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = () => globalThis.lamejs?.Mp3Encoder ? resolve(globalThis.lamejs) : reject(new Error('lamejs loaded but Mp3Encoder is missing'));
      s.onerror = () => reject(new Error('could not load lamejs from ' + url));
      document.head.appendChild(s);
    }).catch(e => { lamePromise = null; throw e; });
  }
  return lamePromise;
}

/**
 * MP3 (CBR, default 320 kbps). Encodes in time slices (~`sliceMs` of work, then yields) so the page stays responsive.
 * Options: onProgress(0..1), signal (AbortSignal), lameUrl. Sample rate must be 32000, 44100 or 48000.
 */
export async function encodeMp3(buffer, { kbps = 320, onProgress, signal, lameUrl, sliceMs = 12 } = {}) {
  const lame = await loadLame(lameUrl);
  const ch = Math.min(2, buffer.numberOfChannels), len = buffer.length;
  const enc = new lame.Mp3Encoder(ch, buffer.sampleRate, kbps);
  const L = buffer.getChannelData(0), R = ch > 1 ? buffer.getChannelData(1) : null;
  const FRAME = 1152, BLOCK = FRAME * 2,  // small blocks: the first (JIT warm-up) block is the slowest
    l16 = new Int16Array(BLOCK), r16 = new Int16Array(BLOCK);
  const parts = [];
  const to16 = (src, dst, off, n) => { for (let i = 0; i < n; i++) { let s = src[off + i]; s = s > 1 ? 1 : s < -1 ? -1 : s || 0; dst[i] = s < 0 ? s * 32768 : s * 32767; } };
  await yieldToUI(); // the encoder constructor costs ~12 ms
  let t0 = now();
  for (let off = 0; off < len; off += BLOCK) {
    const n = Math.min(BLOCK, len - off);
    to16(L, l16, off, n); if (R) to16(R, r16, off, n);
    const out = R ? enc.encodeBuffer(l16.subarray(0, n), r16.subarray(0, n)) : enc.encodeBuffer(l16.subarray(0, n));
    if (out.length) parts.push(out);
    if (now() - t0 > sliceMs) {
      onProgress?.(off / len);
      await yieldToUI();
      if (signal?.aborted) throw new DOMException('MP3 encode aborted', 'AbortError');
      t0 = now();
    }
  }
  const tail = enc.flush(); if (tail.length) parts.push(tail);
  onProgress?.(1);
  return new Blob(parts, { type: 'audio/mpeg' });
}

// ---------------------------------------------------------------- ZIP (stored, CRC-32)

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
async function crc32(u8) {
  let c = 0xFFFFFFFF; const STEP = 1 << 21;
  for (let s = 0; s < u8.length; s += STEP) {
    const e = Math.min(u8.length, s + STEP);
    for (let i = s; i < e; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
    if (e < u8.length) await yieldToUI();
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new Error('makeZip: unsupported data type');
}

/** Zip files without compression (audio does not compress). entries: [{name, data: Blob|Uint8Array|string}]. */
export async function makeZip(entries, { date = new Date() } = {}) {
  const enc = new TextEncoder(), parts = [], central = [];
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(String(e.name).replace(/\\/g, '/').replace(/^\/+/, ''));
    const bytes = await toBytes(e.data), crc = await crc32(bytes), size = bytes.length;
    if (size > 0xFFFFFFFE || offset > 0xFFFFFFFE) throw new Error('makeZip: file too large for zip without zip64');
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
    h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, bytes);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(c.buffer, name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

// ---------------------------------------------------------------- saving

const UNAVAILABLE = new Set(['unavailable', 'not_granted', 'capability_disabled', 'capability_removed']);

/**
 * Offer a file to the viewer.
 * - In the claude.ai viewer: claude.use('downloads').save(). The viewer allows .zip/.mp4/.webm/.json/... but NOT
 *   .wav/.mp3 (pack audio in a .zip).
 * - Outside the viewer (no window.claude, or use() resolved null): an <a download> link -> status 'fallback'.
 * Resolves {status:'saved'|'fallback'|'declined'|'unavailable'|'error', code?, message?}; never rejects.
 */
export async function saveFile(filename, blob) {
  let dl = null;
  const use = globalThis.claude?.use;
  if (typeof use === 'function') {
    try { dl = await use.call(globalThis.claude, 'downloads'); }
    catch (e) { return { status: 'unavailable', code: e?.code || 'use_failed', message: e?.message }; }
  }
  if (!dl) return anchorSave(filename, blob);
  try {
    const r = await dl.save({ filename, data: blob });
    return { status: 'saved', ...(r?.status && r.status !== 'saved' ? { code: r.status } : {}) };
  } catch (e) {
    const code = e?.code || 'error';
    if (code === 'declined') return { status: 'declined', code };
    if (UNAVAILABLE.has(code)) return { status: 'unavailable', code, message: e?.message };
    return { status: 'error', code, message: e?.message || String(e) };
  }
}

function anchorSave(filename, blob) {
  try {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { status: 'fallback' };
  } catch (e) { return { status: 'error', code: 'anchor_failed', message: e?.message }; }
}

// ---------------------------------------------------------------- video

const VIDEO_TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4',
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

/**
 * Record `canvas` (scaled to width x height, 'cover' by default) plus the sound of `audioNode` for `seconds`.
 * Uses MP4 when MediaRecorder supports it (current desktop Chrome), else WebM. The audio node keeps playing to
 * wherever it was connected; it is additionally tapped into the recording. Start your playback right before or
 * right after calling this. Options: fps=30, fit='cover'|'contain', background, videoBitsPerSecond, onProgress, signal.
 * Resolves {blob, ext, mimeType}.
 */
export async function recordVideo({ canvas, audioNode, seconds, width, height, fps = 30, fit = 'cover', background = '#000',
  videoBitsPerSecond, onProgress, signal } = {}) {
  if (!canvas) throw new Error('recordVideo: canvas is required');
  if (!(seconds > 0)) throw new Error('recordVideo: seconds must be > 0');
  if (typeof MediaRecorder === 'undefined') throw new Error('recordVideo: MediaRecorder is not supported here');
  const W = Math.round(width || canvas.width), H = Math.round(height || canvas.height);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const g = out.getContext('2d');
  const draw = () => {
    const sw = canvas.width, sh = canvas.height;
    g.fillStyle = background; g.fillRect(0, 0, W, H);
    if (!sw || !sh) return;
    const k = fit === 'contain' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
    g.drawImage(canvas, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
  };
  draw();
  const stream = out.captureStream(fps);
  let tap = null;
  if (audioNode) {
    tap = audioNode.context.createMediaStreamDestination();
    audioNode.connect(tap);
    tap.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  }
  const mimeType = VIDEO_TYPES.find(t => MediaRecorder.isTypeSupported(t)) || '';
  const bits = videoBitsPerSecond || Math.round(Math.min(12e6, Math.max(2e6, W * H * fps * 0.12)));
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bits, audioBitsPerSecond: 192000 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
  const done = new Promise((res, rej) => { rec.onstop = res; rec.onerror = e => rej(e.error || new Error('MediaRecorder error')); });
  let running = true, raf = 0, tmr = 0;
  const t0 = now();
  const loop = () => {
    if (!running) return;
    draw(); onProgress?.(Math.min(1, (now() - t0) / 1000 / seconds));
    if (document.hidden) tmr = setTimeout(loop, 1000 / fps); else raf = requestAnimationFrame(loop);
  };
  rec.start(1000);
  loop();
  await new Promise(r => {
    const t = setTimeout(r, seconds * 1000);
    signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
  });
  running = false; cancelAnimationFrame(raf); clearTimeout(tmr);
  rec.stop();
  try { await done; } finally {
    stream.getTracks().forEach(t => t.stop());
    if (tap) try { audioNode.disconnect(tap); } catch { /* already gone */ }
  }
  const type = (rec.mimeType || mimeType || 'video/webm').split(';')[0];
  return { blob: new Blob(chunks, { type }), ext: type === 'video/mp4' ? 'mp4' : 'webm', mimeType: rec.mimeType || mimeType };
}
