// exporter.js - master export: offline render with the reverb tail -> WAV 24-bit + MP3 320 kbps -> one .zip -> downloads.
import { trimTail, measure, encodeWav, encodeMp3, makeZip, saveFile } from '../../lib/export.js?v=8';
import { S, clone, bpb } from './state.js?v=8';

const safeName = s => (s || 'Slowreel').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'Slowreel';
export const songSeconds = p => (p.lengthBars * (p.beatsPerBar || 4)) * 60 / p.bpm;

/** Render the project offline. seconds limits the length (tests); otherwise the whole song plus tail. */
export async function renderProject({ seconds, tailSeconds = 8, onProgress } = {}) {
  const p = clone(S.project); p.loop = { ...(p.loop || {}), on: false };
  if (seconds) { p.lengthBars = Math.max(1, Math.ceil(seconds * p.bpm / 60 / bpb())); }
  const raw = await S.engine.render(p, { tailSeconds, toBeat: p.lengthBars * (p.beatsPerBar || 4), onProgress });
  const buf = trimTail(raw, { minSeconds: Math.min(raw.duration, songSeconds(p)) });
  return { buf, p };
}

/** steps: render, wav, mp3, zip, save. onStep(id, state, detail); onProgress(0..1) during mp3. */
export async function exportMaster({ seconds, onStep = () => {}, onProgress, onRenderProgress, signal } = {}) {
  onStep('render', 'run');
  const { buf } = await renderProject({ seconds, tailSeconds: seconds ? 2 : 8, onProgress: onRenderProgress });
  const m = measure(buf);
  onStep('render', 'done', `${buf.duration.toFixed(1)} s · peak ${m.peakDb.toFixed(1)} dBFS`);
  const name = safeName(S.project.name);
  onStep('wav', 'run');
  const wav = encodeWav(buf, { bitDepth: 24 });
  onStep('wav', 'done', kb(wav.size));
  onStep('mp3', 'run');
  const mp3 = await encodeMp3(buf, { kbps: 320, onProgress, signal });
  onStep('mp3', 'done', kb(mp3.size));
  onStep('zip', 'run');
  const files = [{ name: `${name}.wav`, data: wav }, { name: `${name}.mp3`, data: mp3 }];
  const zip = await makeZip(files);
  onStep('zip', 'done', kb(zip.size));
  onStep('save', 'run');
  const r = await saveFile(`${name}.zip`, zip);
  onStep('save', r.status === 'saved' || r.status === 'fallback' ? 'done' : 'err', r.status);
  return { zipBytes: zip.size, files: files.map(f => ({ name: f.name, bytes: f.data.size })), saveStatus: r.status, saveCode: r.code, measure: m, seconds: buf.duration };
}
export const kb = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
