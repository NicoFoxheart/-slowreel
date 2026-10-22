// video-core.js - the frame loop + WebCodecs encoders + muxer, shared by the render worker and the main-thread fallback.
// No DOM here. Every frame: render the heart at time i/fps with that frame's audio numbers, wrap the canvas in a
// VideoFrame, encode; the audio is fed in 1 s AudioData chunks a second ahead of the picture.
import { frameAt } from './features.js?v=9c';

export const MUXERS = { mp4: 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs', webm: 'https://cdn.jsdelivr.net/npm/webm-muxer@5.1.4/build/webm-muxer.mjs' };
export const yieldTask = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
export const abortErr = () => new DOMException('Cancelled', 'AbortError');

/** {scene, F, left, right, sampleRate, frames, fps, width, height, codecs, onProgress(stage, f, info), cancelled()} -> ArrayBuffer */
export async function encodeVideo({ scene, F, left, right, sampleRate: sr, frames, fps, width, height, codecs, onProgress, cancelled }) {
  const mod = await import(MUXERS[codecs.container]);
  const target = new mod.ArrayBufferTarget(), ch = 2;
  const muxer = codecs.container === 'mp4'
    ? new mod.Muxer({ target, video: { codec: 'avc', width, height, frameRate: fps }, audio: { codec: 'aac', numberOfChannels: ch, sampleRate: sr }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' })
    : new mod.Muxer({ target, video: { codec: codecs.video.codec === 'vp8' ? 'V_VP8' : 'V_VP9', width, height, frameRate: fps }, audio: { codec: 'A_OPUS', numberOfChannels: ch, sampleRate: sr }, firstTimestampBehavior: 'offset' });
  let failure = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { failure = e; } });
  const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { failure = e; } });
  venc.configure(codecs.video); aenc.configure(codecs.audio);
  const total = Math.round(frames / fps * sr);
  let apos = 0;
  const pushAudio = until => {
    while (apos < Math.min(until, total)) {
      const n = Math.min(sr, total - apos), data = new Float32Array(n * 2);
      data.set(left.subarray(apos, apos + n), 0); data.set(right.subarray(apos, apos + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round(apos / sr * 1e6), data });
      aenc.encode(ad); ad.close(); apos += n;
    }
  };
  const t0 = performance.now(), dt = Math.round(1e6 / fps), key = fps * 2, dur = frames / fps, stamps = [];
  const close = () => { try { venc.close(); } catch { } try { aenc.close(); } catch { } };
  try {
    for (let i = 0; i < frames; i++) {
      if (cancelled()) throw abortErr();
      if (failure) throw failure;
      pushAudio(Math.round((i / fps + 1) * sr));
      scene.render(i / fps, frameAt(F, i), { duration: dur, fps, frame: i });
      const vf = new VideoFrame(scene.canvas, { timestamp: Math.round(i * 1e6 / fps), duration: dt });
      venc.encode(vf, { keyFrame: i % key === 0 }); vf.close();
      while (venc.encodeQueueSize > 4 && !failure) await new Promise(r => { const tm = setTimeout(r, 30); venc.addEventListener?.('dequeue', () => { clearTimeout(tm); r(); }, { once: true }); });
      stamps.push(performance.now()); if (stamps.length > 91) stamps.shift();
      if (i % 3 === 2 || i === frames - 1) {
        // honest ETA: the rate of the last ~3 s of frames (the first frames are slower: shader warm-up), plus the
        // encoder flush; 'settled' is false until enough frames have been timed to trust it
        const now = performance.now(), el = (now - t0) / 1000, n = stamps.length - 1;
        const recent = n >= 6 ? n / ((stamps[n] - stamps[0]) / 1000) : (i + 1) / el, rate = Math.max(recent, 0.01);
        const left = frames - i - 1;
        onProgress('frames', (i + 1) / frames, { frame: i + 1, frames, fps: rate, eta: left / rate + Math.min(20, frames / 900), elapsed: el, settled: i >= 24 && el > 2 });
      }
      await yieldTask();
    }
    pushAudio(total);
    onProgress('finish', 0);
    await venc.flush(); await aenc.flush();
    if (failure) throw failure;
    muxer.finalize();
  } catch (e) { close(); throw e; }
  close();
  return target.buffer;
}
