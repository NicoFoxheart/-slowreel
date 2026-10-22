// phone-export.js - "Your tapes" on the phone: pick a tape you made on the PC, make its audio file, listen, save it.
// The studio stays PC only and the live engine never runs here. The tape is rendered OFFLINE with the same steps as the
// PC export (js/ui/exporter.js renderProject -> engine.render -> trimTail), 44.1 kHz stereo with the reverb tail, so the
// file is exactly what the PC makes. Listening plays that rendered buffer with one AudioBufferSourceNode.
// Saves: .mp4 (AAC, audio only) where WebCodecs has an AAC encoder, and the PC's .zip (24-bit WAV + 320 kbps MP3).
// Opened from the "made for your computer" screen (#pc-audio, wired in phone.js). Read-only: it never saves a tape.
// Look: a dark-glass hero for the tape (the reels wind the tape over while it records), a waveform scrubber, three steps.
import { h, icon } from './controls.js?v=9d';
import { createDeck, canvasSize } from './deck.js?v=9d';
import { songSeconds, kb } from './exporter.js?v=9d';
import { scaleById } from './theory.js?v=9d';
import { openProjects } from '../../lib/storage.js?v=9d';
import { trimTail, encodeWav, encodeMp3, makeZip, saveFile } from '../../lib/export.js?v=9d';

const MP4_MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs';   // same pin as js/visual/video-core.js
const SAMPLE_RATE = 44100;          // the PC export's rate (engine.render default)
const TAIL_SECONDS = 8;             // the PC export's reverb tail before trimTail
const WARN_SECONDS = 8 * 60, MAX_SECONDS = 12 * 60;
const NS = 'http://www.w3.org/2000/svg';
const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const safeName = s => (s || 'Slowreel').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'Slowreel';   // = exporter.js
const fmtDur = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtEta = s => (!isFinite(s) || s <= 0 ? '' : s < 60 ? `about ${Math.max(1, Math.round(s))} s left` : `about ${Math.round(s / 60)} min left`);
const yieldTask = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const cancelErr = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' });
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const svgPath = (d, vb = '0 0 16 16') => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', vb); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.8'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); s.append(p); return s; };
const foxMark = () => { const f = icon('fox'); f.setAttribute('class', 'px-fox'); return f; };
const checkIcon = () => svgPath('M3.2 8.4l3 3 6.6-6.8');
const phoneIcon = () => svgPath('M5.5 1.8h5a1.2 1.2 0 0 1 1.2 1.2v10a1.2 1.2 0 0 1-1.2 1.2h-5A1.2 1.2 0 0 1 4.3 13V3a1.2 1.2 0 0 1 1.2-1.2zM7 12.2h2');
const zipIcon = () => svgPath('M3.5 2.5h6l3 3v8h-9zM9.5 2.5v3h3M6.5 4v1M6.5 6.5v1M6.5 9v1.5');

let root = null, store = null, deck = null, raf = 0, lastT = 0;
let tapes = [];                      // [{id, name, project, demo}]
let cur = null;                      // the open tape: {id, name, project, demo, seconds, blocked, warn}
let made = null;                     // {key, buf, m, peaks} the rendered audio of `cur`
let files = {};                      // ready blobs for `made`: {mp4, zip}; saved[kind] = true once delivered
let saved = {};
let job = null;                      // {kind, cancel(), cancelled}
let aac;                             // undefined = not checked, null = none, else the AudioEncoder config
let player = { ctx: null, src: null, an: null, playing: false, offset: 0, startedAt: 0 };
let scrub = null;                    // {frac} while a finger drags the waveform
let wake = null, listSeq = 0;

// ------------------------------------------------------------------------------------------------ open / close
export function openPhoneExport() {
  if (!root) build();
  document.documentElement.classList.add('pexp-on');
  root.hidden = false; window.scrollTo(0, 0);
  showList();
  $('px-back').focus();
  aacConfig().then(() => { if (cur) renderSave(); });
}
function closeExport() {
  if (job) return;
  stopPlayer(); stopLoop();
  document.documentElement.classList.remove('pexp-on'); root.hidden = true;
  player.ctx?.close().catch(() => { }); player.ctx = null;
  $('pc-audio')?.focus();
}
function back() { if (job) return; if (cur) { stopPlayer(); cur = null; showList(); window.scrollTo(0, 0); } else closeExport(); }

function build() {
  root = h('section', { class: 'pexp', id: 'pexp', 'aria-labelledby': 'px-h', hidden: true },
    h('div', { class: 'px-head' },
      h('button', { class: 'key px-backkey', id: 'px-back', 'aria-label': 'Back', onclick: back }, svgPath('M10 3.5L5.5 8l4.5 4.5')),
      h('div', { class: 'px-titles' }, h('span', { class: 'label', id: 'px-sub', text: 'Slowreel · audio file' }), h('h1', { id: 'px-h', text: 'Your tapes' })),
      foxMark()),
    h('div', { id: 'px-list-view', class: 'px-view' }),
    h('div', { id: 'px-tape-view', class: 'px-view', hidden: true }));
  document.body.append(root);
}

// ------------------------------------------------------------------------------------------------ the list
async function loadTapes() {
  if (!store) store = await openProjects({ appKey: 'tape' });
  const metas = await store.list();
  const docs = await Promise.all(metas.map(m => store.load(m.id).catch(() => null)));
  const empty = docs.filter(p => isTape(p) && !hasSound(p)).length;
  const mine = docs.filter(p => isTape(p) && hasSound(p)).map(p => ({ id: p.id, name: p.name || 'Untitled', project: p, updatedAt: p.updatedAt || 0 }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return { mine, empty, backend: store.backend };
}
// a real saved tape: a Slowreel project with tracks (not a stray doc); "hasSound": at least one clip to play
const isTape = p => !!p && typeof p === 'object' && Array.isArray(p.tracks) && (!p.schema || String(p.schema).startsWith('nfx-studio')) && num(p.bpm, 0) > 0;
const hasSound = p => p.tracks.some(t => (t.clips || []).length);

async function demoTapes() {
  const [{ DEMO }, ng] = await Promise.all([import('../sound/demo.js?v=9d'),
    fetch('demo-night-garage.json?v=9d', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null)]);
  const out = [{ id: 'demo', name: DEMO.name, project: Object.assign(clone(DEMO), { id: 'demo' }), demo: true }];
  if (ng) out.push({ id: 'demo-night-garage', name: ng.name, project: Object.assign(ng, { id: 'demo-night-garage' }), demo: true });
  return out;
}

async function showList() {
  cur = null; stopLoop();
  $('px-h').textContent = 'Your tapes'; $('px-sub').textContent = 'Slowreel · audio file';
  $('px-tape-view').hidden = true;
  const v = $('px-list-view'); v.hidden = false; v.textContent = '';
  const mineList = h('ul', { class: 'px-tapes', id: 'px-mine', 'aria-busy': 'true' }, h('li', { class: 'px-wait', text: 'Looking for your tapes…' }));
  const demoList = h('ul', { class: 'px-tapes', id: 'px-demos' });
  const foot = h('p', { class: 'pm-note px-foot', id: 'px-where' });
  const count = h('span', { class: 'px-count mono', id: 'px-count' });
  v.append(
    h('p', { class: 'px-lead', text: 'Pick a tape you made on your PC. Slowreel makes its audio file right here, the same file your PC export makes.' }),
    h('div', { class: 'px-group' }, h('h2', { class: 'label px-glabel' }, 'Your tapes', count), mineList, foot),
    h('div', { class: 'px-group' }, h('h2', { class: 'label px-glabel', text: 'Demos' }), demoList));
  const seq = ++listSeq;
  const [res, demos] = await Promise.all([loadTapes().catch(e => { console.warn('[slowreel] tapes', e); return null; }), demoTapes().catch(() => [])]);
  if (seq !== listSeq || cur) return;
  tapes = [...(res?.mine || []), ...demos];
  mineList.textContent = ''; mineList.removeAttribute('aria-busy');
  if (!res) mineList.append(h('li', { class: 'px-wait', text: 'Your tapes could not be read just now. Go back and try again.' }));
  else if (!res.mine.length) mineList.append(h('li', { class: 'px-wait', text: 'No saved tapes yet. Tapes you save on your PC show up here.' }));
  res?.mine.forEach((t, i) => mineList.append(tapeRow(t, i)));
  demos.forEach((t, i) => demoList.append(tapeRow(t, i + (res?.mine.length || 0))));
  count.textContent = res?.mine.length ? String(res.mine.length) : '';
  const where = !res ? '' : res.backend === 'db' ? 'Saved in your account: the same tapes as on your PC.' : 'Only tapes saved in this browser show here. Open the Slowreel link in the Claude app to see the tapes from your PC.';
  foot.textContent = where + (res?.empty ? ` ${res.empty} empty ${res.empty === 1 ? 'tape is' : 'tapes are'} not shown.` : '');
  foot.hidden = !foot.textContent;
}
function cassette(p, big) {
  return h('span', { class: 'px-cass' + (big ? ' big' : ''), 'aria-hidden': 'true' },
    h('span', { class: 'px-stripes' }, ...p.tracks.slice(0, 10).map(tr => h('i', { style: { '--c': tr.color || 'var(--ink-3)' } }))),
    h('span', { class: 'px-hubs' }, h('b'), h('b')));
}
function tapeRow(t, i) {
  const p = t.project, len = songSeconds(normalized(p));
  const when = t.demo ? 'Demo' : edited(t.updatedAt);
  return h('li', { style: { '--i': Math.min(i, 8) } }, h('button', { class: 'key px-tape', id: `${t.demo ? 'px-demo-' : 'px-tape-'}${t.id}`, onclick: () => openTape(t) },
    cassette(p),
    h('span', { class: 'px-tn' }, h('span', { class: 'nm', text: t.name }),
      h('span', { class: 'mono' }, h('b', { text: fmtDur(len) }), ` · ${Math.round(p.bpm)} BPM · ${when}`)),
    svgPath('M6 3.5L10.5 8 6 12.5')));
}
function edited(ts) {
  if (!ts) return 'saved';
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'edited today';
  return `edited ${d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })}`;
}
// the PC opens every project through app.js normalize(); the same defaults here (only what the render reads)
function normalized(src) {
  const p = clone(src);
  p.schema = p.schema || 'nfx-studio/1'; p.beatsPerBar = p.beatsPerBar || 4; p.lengthBars = p.lengthBars || 16;
  p.loop = p.loop || { on: false, startBeat: 0, endBeat: 16 };
  p.buses = p.buses || {}; p.buses.space = p.buses.space || { fx: [] }; p.buses.echo = p.buses.echo || { fx: [] };
  p.buses.space.fx = p.buses.space.fx || []; p.buses.echo.fx = p.buses.echo.fx || [];
  p.master = p.master || { volumeDb: 0, atmosphere: 0.5, fx: [] }; p.master.fx = p.master.fx || [];
  p.tracks.forEach(t => { t.sends = t.sends || { space: 0.4, echo: 0 }; t.fx = t.fx || []; t.clips = t.clips || []; t.clips.forEach(c => { if (!c.song) c.notes = c.notes || []; }); });
  return p;
}

// ------------------------------------------------------------------------------------------------ one tape
const audible = p => { const solo = p.tracks.some(t => t.solo); return t => !t.mute && (!solo || t.solo); };
// Chop Sampler tracks that play a sound imported on the PC (kept in the PC browser's IndexedDB, not in the tape)
function importedSamples(p) {
  const on = audible(p);
  return p.tracks.filter(t => t.instrument?.id === 'chop' && on(t) && String(t.instrument?.sample?.sampleId || '').startsWith('imp:'))
    .map(t => ({ track: t.name, sample: t.instrument.sample?.name || 'an imported sound' }));
}
const needsPcText = list => `${list.map(m => `"${m.track}" plays ${m.sample.startsWith('an ') ? m.sample : `"${m.sample}"`}`).join(', ')}, a sound you imported on your PC. It lives only on your PC, so make this tape's audio file there.`;
const keyText = p => { try { return p.key ? `${p.key} ${scaleById(p.scale).name.toLowerCase()}` : ''; } catch { return ''; } };

function stepHead(n, title, id) {
  return h('div', { class: 'px-step', id }, h('span', { class: 'px-num', 'aria-hidden': 'true' }, h('span', { class: 'n', text: String(n) }), checkIcon()), h('h2', { text: title }));
}
function setStep(id, done) { $(id)?.classList.toggle('done', !!done); }

function openTape(t) {
  if (job) return;
  const p = normalized(t.project);
  const seconds = songSeconds(p);
  const miss = importedSamples(p);
  cur = { ...t, project: p, seconds, key: `${t.id}@${t.project.updatedAt || 0}`,
    blocked: miss.length ? needsPcText(miss) : seconds > MAX_SECONDS ? `This tape is ${fmtDur(seconds)} long. A phone can make files up to 12 minutes; make this one on your PC.` : '',
    warn: seconds > WARN_SECONDS ? `A long tape (${fmtDur(seconds)}). It needs a lot of memory; if the phone gives up, make it on your PC.` : '' };
  if (made?.key !== cur.key) { made = null; files = {}; saved = {}; }
  ++listSeq;
  $('px-list-view').hidden = true;
  $('px-h').textContent = t.demo ? 'Demo tape' : 'Your tape'; $('px-sub').textContent = 'Slowreel · audio file';
  const v = $('px-tape-view'); v.hidden = false; v.textContent = '';
  const meta = [`${fmtDur(seconds)}`, `${Math.round(p.bpm)} BPM`, keyText(p), `${p.tracks.length} ${p.tracks.length === 1 ? 'track' : 'tracks'}`].filter(Boolean);
  v.append(
    // hero: the tape behind dark glass
    h('div', { class: 'px-hero', id: 'px-hero', 'data-state': 'idle' },
      h('div', { class: 'glass px-glass' },
        h('div', { class: 'px-hero-top' },
          h('span', { class: 'px-state' }, h('i', { class: 'px-led', 'aria-hidden': 'true' }), h('span', { id: 'px-state', text: 'Ready' })),
          h('span', { class: 'px-model', text: 'SR-8' })),
        h('div', { class: 'px-reels' },
          h('canvas', { id: 'px-deck', role: 'img', 'aria-label': 'Tape reels' }),
          h('div', { class: 'px-counter mono', id: 'px-counter', 'aria-hidden': 'true' }, h('span', { id: 'px-pct', text: '0' }), h('small', { text: '%' }))),
        h('div', { class: 'px-hero-body' },
          h('h2', { class: 'px-name', id: 'px-name', text: t.name }),
          h('p', { class: 'px-meta mono', id: 'px-len' }, ...meta.flatMap((m, i) => (i ? [h('i', { 'aria-hidden': 'true', text: '·' }), m] : [m])))),
        h('div', { class: 'px-ribbon', 'aria-hidden': 'true' }, ...p.tracks.slice(0, 12).map(tr => h('i', { style: { '--c': tr.color || 'var(--ink-3)' } }))),
        h('div', { class: 'px-bar' }, h('i', { id: 'px-bar' })))),
    // 1 make
    h('div', { class: 'module px-card', id: 'px-make-card' },
      stepHead(1, 'Make the audio file', 'px-step1'),
      h('p', { class: 'px-warn', id: 'px-block', hidden: !cur.blocked, text: cur.blocked }),
      h('p', { class: 'px-warn soft', id: 'px-long', hidden: !cur.warn || !!cur.blocked, text: cur.warn }),
      h('button', { class: 'key signal px-big', id: 'px-make', disabled: !!cur.blocked, hidden: !!cur.blocked, onclick: make }, icon('rec'), h('span', { text: 'Make the audio file' })),
      h('div', { class: 'px-rec', id: 'px-rec', hidden: true },
        h('div', { class: 'progress px-prog', id: 'px-prog', 'aria-hidden': 'true' }, h('i', { id: 'px-pbar' })),
        h('div', { class: 'px-recrow' },
          h('p', { class: 'px-status', id: 'px-status', role: 'status', 'aria-live': 'polite' }),
          h('button', { class: 'key px-cancel', id: 'px-cancel', onclick: () => job?.cancel() }, icon('close'), 'Cancel'))),
      h('p', { class: 'px-status px-after', id: 'px-made-note', role: 'status', 'aria-live': 'polite' }),
      h('p', { class: 'pm-note', id: 'px-make-note', hidden: !!cur.blocked, text: 'Your mix exactly as on your PC, with the reverb tail. Nothing is made louder: quiet stays quiet. Keep this page open while it records.' })),
    // 2 listen
    h('div', { class: 'module px-card', id: 'px-listen-card', hidden: true },
      stepHead(2, 'Listen', 'px-step2'),
      h('div', { class: 'glass px-wave', id: 'px-wave' },
        h('canvas', { id: 'px-wavec', 'aria-hidden': 'true' }),
        h('input', { type: 'range', id: 'px-seek', class: 'px-range', min: '0', max: '1', step: '0.1', value: '0', 'aria-label': 'Position', oninput: e => seek(+e.target.value) })),
      h('div', { class: 'px-player' },
        h('span', { class: 'mono px-t', id: 'px-pos', text: '0:00' }),
        h('button', { class: 'key dark px-play', id: 'px-play', 'aria-label': 'Listen', 'aria-pressed': 'false', onclick: togglePlay }, playIcon(false)),
        h('span', { class: 'mono px-t r', id: 'px-dur', text: '0:00' })),
      h('p', { class: 'pm-note mono', id: 'px-info' })),
    // 3 save
    h('div', { class: 'module px-card', id: 'px-save-card', hidden: true },
      stepHead(3, 'Save to phone', 'px-step3'),
      h('div', { class: 'px-saves', id: 'px-saves' }),
      h('div', { class: 'progress px-prog', id: 'px-sprog', hidden: true, 'aria-hidden': 'true' }, h('i', { id: 'px-sbar' })),
      h('div', { class: 'px-recrow' },
        h('p', { class: 'px-status', id: 'px-sstatus', role: 'status', 'aria-live': 'polite' }),
        h('button', { class: 'key px-cancel', id: 'px-scancel', hidden: true, onclick: () => job?.cancel() }, icon('close'), 'Cancel')),
      h('p', { class: 'pm-note', id: 'px-video-note', text: 'Want a music video too? Go back, choose "Make a music video", then "Use a song from this phone" and pick the file you saved.' })));
  deck = createDeck($('px-deck'));
  wireWave();
  heroState(); startLoop();
  if (made) showMade(); else { $('px-make').focus({ preventScroll: true }); }
}
function heroState() {
  const st = job?.kind === 'render' ? 'rec' : player.playing ? 'play' : made ? 'made' : cur?.blocked ? 'blocked' : 'idle';
  const hero = $('px-hero'); if (!hero) return;
  hero.dataset.state = st;
  $('px-state').textContent = { rec: 'Recording', play: 'Playing', made: saved.mp4 || saved.zip ? 'Saved to phone' : 'Ready to save', blocked: 'Needs your PC', idle: 'Ready' }[st];
}

// ------------------------------------------------------------------------------------------------ render (offline)
async function make() {
  if (job || !cur || cur.blocked) return;
  const tape = cur, bar = $('px-pbar'), st = $('px-status');
  stopPlayer(); made = null; files = {}; saved = {};
  $('px-listen-card').hidden = true; $('px-save-card').hidden = true; $('px-made-note').textContent = ''; setStep('px-step1', false);
  const j = job = { kind: 'render', cancelled: false, frac: 0, cancel() { this.cancelled = true; this.onCancel?.(); } };
  busy(true, 'px-make'); $('px-make').hidden = true; $('px-rec').hidden = false; bar.style.width = '0%'; $('px-pct').textContent = '0';
  heroState(); startLoop();
  st.textContent = 'Getting the sounds ready…';
  await keepAwake(true);
  const t0 = performance.now();
  try {
    const test = window.__phoneExportTest || {};   // tests only: {seconds} limits the length like the PC's renderProject({seconds})
    const { buf, missing } = await renderTape(tape.project, { seconds: test.seconds, tailSeconds: test.seconds ? 2 : TAIL_SECONDS, job: j,
      onProgress: f => { j.frac = f; bar.style.width = (f * 100).toFixed(1) + '%'; const el = (performance.now() - t0) / 1000;
        st.textContent = `Recording the tape… ${Math.round(f * 100)}%${f > 0.04 ? ' · ' + fmtEta(el / f - el) : ''}`; } });
    if (cur !== tape) return;
    if (missing?.length) { cur.blocked = needsPcText(missing); $('px-block').textContent = cur.blocked; $('px-block').hidden = false; st.textContent = ''; $('px-make').disabled = true; $('px-make').hidden = true; $('px-make-note').hidden = true; return; }
    const { peaks, m } = await wavePeaks(buf);
    if (cur !== tape) return;
    made = { key: tape.key, buf, m, peaks };
    window.__phoneExportLast = { seconds: buf.duration, sampleRate: buf.sampleRate, ...made.m, ms: Math.round(performance.now() - t0) };
    st.textContent = '';
    showMade(true);
  } catch (e) {
    if (cur !== tape) return;
    if (e?.name === 'AbortError') $('px-made-note').textContent = 'Stopped. Nothing was made.';
    else { console.warn('[slowreel] phone render', e); $('px-made-note').textContent = memoryHint(e, 'The audio file could not be made.'); }
  } finally {
    if (job === j) job = null;
    keepAwake(false);
    if (cur === tape) { busy(false); $('px-rec').hidden = true; if (!cur.blocked) $('px-make').hidden = false; heroState(); startLoop(); }
  }
}
const memoryHint = (e, lead) => `${lead} ${/memory|allocat|RangeError/i.test(String(e?.name) + String(e?.message)) ? 'The phone ran out of memory; make this one on your PC.' : 'Try again, or make it on your PC.'}`;

/**
 * The PC export's render, step for step: exporter.js renderProject() (loop off, toBeat = song end, trimTail to the song
 * length) around engine.render() (fresh engine on an OfflineAudioContext, full sound, ticks every 0.5 s). Written out
 * here only so Cancel can really stop it: on cancel the graph is disposed and the rest renders as silence in a moment.
 */
async function renderTape(project, { seconds, tailSeconds = TAIL_SECONDS, onProgress, job: j }) {
  const p = clone(project); p.loop = { ...(p.loop || {}), on: false };
  const bpb = p.beatsPerBar || 4;
  if (seconds) p.lengthBars = Math.max(1, Math.ceil(seconds * p.bpm / 60 / bpb));
  const toBeat = p.lengthBars * bpb;
  // --- engine.render(p, {tailSeconds, toBeat})
  const { createEngine } = await import('../sound/engine.js?v=9d');
  if (j.cancelled) throw cancelErr();
  const pr = clone(p);
  pr.loop = { ...(pr.loop || {}), on: false };
  const b0 = 0, bpmV = Math.min(300, Math.max(20, num(pr.bpm, 70)));
  let end = num(pr.lengthBars, 0) * num(pr.beatsPerBar, 4);
  for (const t of pr.tracks || []) for (const c of t.clips || []) end = Math.max(end, num(c.startBeat, 0) + num(c.lengthBeats, 0));
  const b1 = Math.min(end, toBeat);
  const total = Math.max(0.5, (b1 - b0) * 60 / bpmV + tailSeconds);
  const off = new OfflineAudioContext(2, Math.ceil(total * SAMPLE_RATE), SAMPLE_RATE);
  const sub = await createEngine({ context: off, songBaseUrl: 'audio/', light: false });
  let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; try { sub.dispose(); } catch { } };
  j.onCancel = stop;
  try {
    await sub.load(pr);
    if (j.cancelled) { stop(); throw cancelErr(); }
    const on = audible(pr), names = new Map(pr.tracks.map(t => [t.id, t]));
    const missing = (sub.missingSamples?.() || []).filter(m => names.get(m.trackId) && on(names.get(m.trackId)))
      .map(m => ({ track: names.get(m.trackId).name, sample: m.name || 'an imported sound' }));
    if (missing.length) { stop(); return { missing }; }
    sub._renderStart(b0, b1);
    const step = 0.5;
    for (let t = step; t < total; t += step) {
      off.suspend(t).then(() => { if (!stopped) { sub._tick(t + 1.0); onProgress?.(t / total); } off.resume(); });
    }
    const raw = await off.startRendering();
    if (j.cancelled) throw cancelErr();
    stop();
    onProgress?.(1);
    // --- renderProject(): trim the silent end of the tail, never into the song
    const buf = trimTail(raw, { minSeconds: Math.min(raw.duration, songSeconds(p)) });
    return { buf };
  } catch (e) { stop(); throw e; }
}

/** Tests only: the phone render of a project, as the Make button runs it. */
export const renderForTest = (project, { seconds, tailSeconds } = {}) => renderTape(normalized(project), { seconds, tailSeconds, job: { cancelled: false } });

// ------------------------------------------------------------------------------------------------ waveform
/**
 * One pass over the rendered audio, in slices with yields so the page stays smooth: 1200 waveform columns (max |sample|
 * over both channels) and the same numbers as lib/export.js measure() (peak, RMS, clipped samples).
 */
async function wavePeaks(buf, n = 1200) {
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null, per = buf.length / n, out = new Float32Array(n);
  let t = performance.now(), sum = 0, clipped = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * per), b = Math.min(buf.length, Math.floor((i + 1) * per));
    let m = 0;
    for (let k = a; k < b; k++) { const x = L[k], ax = Math.abs(x); if (ax > m) m = ax; if (ax >= 1) clipped++; sum += x * x; }
    if (R) for (let k = a; k < b; k++) { const y = R[k], ay = Math.abs(y); if (ay > m) m = ay; if (ay >= 1) clipped++; sum += y * y; }
    out[i] = m; if (m > peak) peak = m;
    if (performance.now() - t > 12) { await yieldTask(); t = performance.now(); }
  }
  const toDb = g => (g <= 0 ? -Infinity : 20 * Math.log10(g));
  const m = { peakDb: toDb(peak), rmsDb: toDb(Math.sqrt(sum / Math.max(1, buf.length * buf.numberOfChannels))), clippedSamples: clipped, seconds: buf.duration };
  return { peaks: out, m };
}
function drawWave(frac) {
  const c = $('px-wavec'); if (!c || !made?.peaks) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), r = canvasSize(c);
  const w = Math.max(1, Math.round(r.width * dpr)), hh = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
  const g = c.getContext('2d'), P = made.peaks;
  g.clearRect(0, 0, w, hh);
  const bw = 2.5 * dpr, gap = 1.75 * dpr, n = Math.max(8, Math.floor((w + gap) / (bw + gap))), x0 = (w - (n * (bw + gap) - gap)) / 2;
  let top = 1e-6; for (let i = 0; i < P.length; i++) if (P[i] > top) top = P[i];
  const mid = hh / 2, maxH = hh * 0.42, px = x0 + frac * (w - 2 * x0);
  // display only: the bars are scaled to the tape's own peak so quiet music still draws a shape (the audio is untouched)
  const played = g.createLinearGradient(0, mid - maxH, 0, mid + maxH);
  played.addColorStop(0, '#FF9A5C'); played.addColorStop(0.5, '#EC4E20'); played.addColorStop(1, '#FF9A5C');
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i / n * P.length), b = Math.max(a + 1, Math.floor((i + 1) / n * P.length));
    let m = 0; for (let k = a; k < b; k++) if (P[k] > m) m = P[k];
    const v = Math.pow(m / top, 0.62), bh = Math.max(1.5 * dpr, v * maxH), x = x0 + i * (bw + gap);
    g.fillStyle = x < px ? played : 'rgba(238,240,234,.24)';
    g.beginPath(); g.roundRect ? g.roundRect(x, mid - bh, bw, bh * 2, bw / 2) : g.rect(x, mid - bh, bw, bh * 2); g.fill();
  }
  // playhead with a soft glow
  if (frac > 0.0005 || player.playing || scrub) {
    const glow = g.createLinearGradient(px - 18 * dpr, 0, px, 0); glow.addColorStop(0, 'rgba(236,78,32,0)'); glow.addColorStop(1, 'rgba(236,78,32,.22)');
    g.fillStyle = glow; g.fillRect(px - 18 * dpr, 0, 18 * dpr, hh);
    g.fillStyle = '#F7F8F7'; g.fillRect(px - dpr, 4 * dpr, 2 * dpr, hh - 8 * dpr);
    g.beginPath(); g.arc(px, 5 * dpr, 3.2 * dpr, 0, Math.PI * 2); g.fill();
  }
}
function wireWave() {
  const el = $('px-wave');
  const at = e => { const r = el.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  el.addEventListener('pointerdown', e => {
    if (!made || e.button > 0) return;
    e.preventDefault(); el.setPointerCapture?.(e.pointerId); scrub = { frac: at(e) }; el.classList.add('scrubbing'); scrubUi();
  });
  el.addEventListener('pointermove', e => { if (!scrub) return; scrub.frac = at(e); scrubUi(); });
  const end = e => { if (!scrub) return; const f = e.type === 'pointercancel' ? null : at(e); scrub = null; el.classList.remove('scrubbing'); if (f !== null && made) seek(f * made.buf.duration); else drawWave(posFrac()); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
function scrubUi() { if (!made) return; drawWave(scrub.frac); $('px-pos').textContent = fmtDur(scrub.frac * made.buf.duration); }
const posFrac = () => (made ? pos() / made.buf.duration : 0);

// ------------------------------------------------------------------------------------------------ listen
function showMade(fresh) {
  const { buf, m } = made;
  reveal($('px-listen-card')); reveal($('px-save-card'));
  const sk = $('px-seek'); sk.max = String(buf.duration.toFixed(2)); sk.value = '0';
  player.offset = 0; $('px-pos').textContent = '0:00'; $('px-dur').textContent = fmtDur(buf.duration);
  $('px-info').textContent = `44.1 kHz stereo · peak ${m.peakDb.toFixed(1)} dBFS · as loud as on your PC`;
  const mk = $('px-make'); mk.querySelector('span').textContent = 'Make it again'; mk.classList.remove('signal'); mk.classList.add('px-again');
  $('px-make-note').hidden = true;
  $('px-made-note').textContent = fresh ? `Made: ${fmtDur(buf.duration)} with the reverb tail.` : `Made earlier: ${fmtDur(buf.duration)} with the reverb tail.`;
  setStep('px-step1', true);
  heroState(); renderSave(); drawWave(0); startLoop();
  if (fresh) $('px-play').focus({ preventScroll: true });
  if (fresh && !reduced()) $('px-listen-card').scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
}
function reveal(el) { if (!el.hidden) return; el.hidden = false; if (!reduced()) { el.classList.remove('px-in'); void el.offsetWidth; el.classList.add('px-in'); } }
function playIcon(pause) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true');
  if (pause) for (const x of [4, 9.4]) { const r = document.createElementNS(NS, 'rect'); r.setAttribute('x', x); r.setAttribute('y', 3); r.setAttribute('width', 2.6); r.setAttribute('height', 10); r.setAttribute('rx', 0.9); r.setAttribute('fill', 'currentColor'); s.append(r); }
  else { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', 'M5 2.8v10.4c0 .5.5.8.9.5l8-5.2c.4-.2.4-.8 0-1L5.9 2.3c-.4-.3-.9 0-.9.5z'); p.setAttribute('fill', 'currentColor'); s.append(p); }
  return s;
}
function setPlayUi(on) {
  const b = $('px-play'); if (!b) return;
  b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? 'Pause' : 'Listen');
  b.querySelector('svg').replaceWith(playIcon(on));
  if (on) setStep('px-step2', true);
  heroState();
}
const pos = () => (player.playing ? Math.min(made.buf.duration, player.offset + player.ctx.currentTime - player.startedAt) : player.offset);
function togglePlay() { if (!made) return; if (player.playing) pausePlayer(); else startPlayer(player.offset >= made.buf.duration - 0.05 ? 0 : player.offset); }
function startPlayer(at) {
  if (!player.ctx) {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { }   // iPhone: play with the ringer switch on silent
    player.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    player.an = player.ctx.createAnalyser(); player.an.fftSize = 2048; player.an.connect(player.ctx.destination);
  }
  player.ctx.resume?.();
  killSource();
  const src = player.ctx.createBufferSource(); src.buffer = made.buf; src.connect(player.an);
  src.onended = () => { if (player.src !== src) return; player.src = null; player.playing = false; player.offset = 0; setPlayUi(false); $('px-seek').value = '0'; $('px-pos').textContent = '0:00'; drawWave(0); };
  src.start(0, Math.max(0, at)); player.src = src; player.offset = at; player.startedAt = player.ctx.currentTime; player.playing = true;
  setPlayUi(true); startLoop();
}
function killSource() { const s = player.src; player.src = null; if (s) { s.onended = null; try { s.stop(); } catch { } s.disconnect(); } }
function pausePlayer() { if (!player.playing) return; player.offset = pos(); killSource(); player.playing = false; setPlayUi(false); startLoop(); }
function stopPlayer() { killSource(); player.playing = false; player.offset = 0; setPlayUi(false); player.ctx?.suspend?.().catch(() => { }); }
function seek(t) {
  if (!made) return;
  t = Math.min(made.buf.duration, Math.max(0, t));
  if (player.playing) startPlayer(t); else { player.offset = t; startLoop(); }
  $('px-seek').value = t.toFixed(2); $('px-pos').textContent = fmtDur(t); drawWave(t / made.buf.duration);
}

// ------------------------------------------------------------------------------------------------ save
async function aacConfig() {
  if (aac !== undefined) return aac;
  aac = null;
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined' || typeof EncodedAudioChunk === 'undefined') return aac;
  for (const sampleRate of [SAMPLE_RATE, 48000]) for (const bitrate of [256000, 192000]) {
    const cfg = { codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) { aac = cfg; return aac; } } catch { }
  }
  return aac;
}
function renderSave() {
  const el = $('px-saves'); if (!el || !made) return;
  el.textContent = '';
  const d = made.buf.duration;
  if (aac) el.append(saveBtn('mp4', 'Save to phone', `Audio file (.mp4) · plays and shares anywhere · AAC ${aac.bitrate / 1000} kbps · about ${kb(d * aac.bitrate / 8 + 4096)}`, true, phoneIcon()));
  el.append(saveBtn('zip', aac ? 'WAV + MP3 (.zip)' : 'Save to phone · WAV + MP3 (.zip)', `24-bit WAV and 320 kbps MP3, the same as the PC export · about ${kb(d * SAMPLE_RATE * 2 * 3 + d * 40000)}`, !aac, zipIcon()));
  setStep('px-step3', saved.mp4 || saved.zip);
}
function saveBtn(kind, title, sub, primary, ic) {
  const done = saved[kind];
  return h('button', { class: `key px-save${primary ? ' primary' : ''}${done ? ' saved' : ''}`, id: `px-save-${kind}`, onclick: () => saveKind(kind) },
    h('span', { class: 'px-sico' }, done ? checkIcon() : ic),
    h('span', { class: 'px-tn' }, h('span', { class: 'nm', text: done ? `Saved · ${kind === 'mp4' ? '.mp4' : '.zip'}` : title }),
      h('span', { class: 'sub', text: done ? `${kb(files[kind].size)} on your phone · tap to save again` : files[kind] ? 'Ready · tap to save' : sub })),
    primary && !done ? icon('export') : null);
}

async function saveKind(kind) {
  if (job || !made) return;
  const tape = cur, name = safeName(tape.name), st = $('px-sstatus'), prog = $('px-sprog'), bar = $('px-sbar');
  if (files[kind]) return deliver(kind, files[kind], name);   // already made: save straight from the tap
  pausePlayer();
  const ac = new AbortController();
  const j = job = { kind, cancelled: false, cancel() { this.cancelled = true; ac.abort(); } };
  busy(true, `px-save-${kind}`); prog.hidden = false; bar.style.width = '0%'; $('px-scancel').hidden = false;
  await keepAwake(true);
  const t0 = performance.now(), progress = (label, f) => { bar.style.width = (f * 100).toFixed(1) + '%'; const el = (performance.now() - t0) / 1000;
    st.textContent = `${label} ${Math.round(f * 100)}%${f > 0.05 ? ' · ' + fmtEta(el / f - el) : ''}`; };
  try {
    let blob;
    if (kind === 'mp4') blob = await encodeMp4(made.buf, { onProgress: f => progress('Making the .mp4…', f), job: j });
    else {
      st.textContent = 'Making the WAV…';
      let wav = encodeWav(made.buf, { bitDepth: 24 }); await yieldTask();
      const mp3 = await encodeMp3(made.buf, { kbps: 320, signal: ac.signal, onProgress: f => progress('Making the MP3…', f) });
      if (j.cancelled) throw cancelErr();
      st.textContent = 'Packing the .zip…';
      blob = await makeZip([{ name: `${name}.wav`, data: wav }, { name: `${name}.mp3`, data: mp3 }]);
      wav = null;
    }
    if (j.cancelled) throw cancelErr();
    if (cur !== tape || !made) return;
    files[kind] = blob;
    window.__phoneExportFiles = { ...(window.__phoneExportFiles || {}), [kind]: blob.size };
    prog.hidden = true;
    await deliver(kind, blob, name);
  } catch (e) {
    if (cur !== tape) return;
    if (e?.name === 'AbortError' || j.cancelled) st.textContent = 'Stopped. Nothing was saved.';
    else { console.warn('[slowreel] phone save', e); st.textContent = memoryHint(e, kind === 'mp4' ? 'The .mp4 could not be made.' : 'The .zip could not be made.'); }
  } finally {
    if (job === j) job = null;
    keepAwake(false);
    if (cur === tape) { busy(false); prog.hidden = true; $('px-scancel').hidden = true; renderSave(); }
  }
}
async function deliver(kind, blob, name) {
  const st = $('px-sstatus'), file = `${name}.${kind}`;
  st.textContent = `Saving ${file}…`;
  const r = await saveFile(file, blob);
  const ok = r.status === 'saved' || r.status === 'fallback';
  if (ok) { saved[kind] = true; st.textContent = `Saved ${file} (${kb(blob.size)}).`; }
  else if (r.status === 'declined') st.textContent = `Not saved. Tap "${kind === 'mp4' ? 'Save to phone' : 'WAV + MP3 (.zip)'}" to save it.`;
  else st.textContent = `${file} is ready but could not be saved here (${r.code || r.status}). Tap to try again.`;
  renderSave(); heroState();
  if (ok && !reduced()) { const b = $(`px-save-${kind}`); b?.classList.add('pop'); setTimeout(() => b?.classList.remove('pop'), 700); }
  return r;
}

/** AAC in an audio-only .mp4 (WebCodecs + mp4-muxer), fed in 1 s slices with yields. Resamples only if the encoder needs 48 kHz. */
async function encodeMp4(buf, { onProgress, job: j }) {
  const cfg = await aacConfig(); if (!cfg) throw new Error('no AAC encoder');
  let src = buf;
  if (cfg.sampleRate !== buf.sampleRate) {
    const off = new OfflineAudioContext(2, Math.ceil(buf.duration * cfg.sampleRate), cfg.sampleRate);
    const s = off.createBufferSource(); s.buffer = buf; s.connect(off.destination); s.start(0);
    src = await off.startRendering();
  }
  const mod = await import(MP4_MUXER);
  const sr = cfg.sampleRate, ch = 2, target = new mod.ArrayBufferTarget();
  const muxer = new mod.Muxer({ target, audio: { codec: 'aac', numberOfChannels: ch, sampleRate: sr }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let failure = null;
  const enc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { failure = e; } });
  enc.configure(cfg);
  const L = src.getChannelData(0), R = src.numberOfChannels > 1 ? src.getChannelData(1) : L, total = src.length;
  try {
    for (let at = 0; at < total;) {
      if (j.cancelled) throw cancelErr();
      if (failure) throw failure;
      const n = Math.min(sr, total - at), data = new Float32Array(n * 2);
      data.set(L.subarray(at, at + n), 0); data.set(R.subarray(at, at + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round(at / sr * 1e6), data });
      enc.encode(ad); ad.close(); at += n;
      while (enc.encodeQueueSize > 4 && !failure && !j.cancelled) await new Promise(r => setTimeout(r, 15));
      onProgress(at / total);
      await yieldTask();
    }
    await enc.flush();
    if (failure) throw failure;
    muxer.finalize();
  } finally { try { enc.close(); } catch { } }
  return new Blob([target.buffer], { type: 'audio/mp4' });
}

// ------------------------------------------------------------------------------------------------ bits
function busy(on, activeId) {
  root.querySelectorAll('#px-make, .px-save, #px-back').forEach(b => { b.disabled = on || (b.id === 'px-make' && !!cur?.blocked); b.classList.toggle('working', on && b.id === activeId); });
  if (!on) $('px-back').disabled = false;
}
async function keepAwake(on) {
  try {
    if (on && !wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener?.('release', () => { wake = null; }); }
    if (!on && wake) { const w = wake; wake = null; await w.release(); }
  } catch { wake = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && job) keepAwake(true); });
window.addEventListener('resize', () => { if (made && cur && !root?.hidden) drawWave(scrub ? scrub.frac : posFrac()); });

function startLoop() { if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }
function stopLoop() { cancelAnimationFrame(raf); raf = 0; }
function frame(t) {
  raf = 0;
  if (!cur || !deck || root.hidden) return;
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  const rendering = job?.kind === 'render', playing = player.playing && !!made;
  // while it records, the tape winds from the left reel onto the right one: the pack sizes ARE the progress
  const frac = playing ? posFrac() : rendering ? job.frac : made ? player.offset / made.buf.duration : 0;
  deck.draw({ playing: playing || rendering, frac, level: rendering ? 0.35 + 0.15 * Math.sin(t / 520) : 0, analyser: playing ? player.an : null, dt, still: reduced() || document.hidden });
  $('px-bar').style.width = (frac * 100).toFixed(2) + '%';
  if (rendering) $('px-pct').textContent = String(Math.floor(job.frac * 100));
  if (made && !$('px-listen-card').hidden && !scrub) {
    const p = pos(), s = $('px-seek');
    if (playing && document.activeElement !== s) s.value = p.toFixed(2);
    $('px-pos').textContent = fmtDur(p);
    if (playing) drawWave(p / made.buf.duration);
  }
  if (playing || rendering) raf = requestAnimationFrame(frame);   // otherwise the reels rest until the next play / make
}
