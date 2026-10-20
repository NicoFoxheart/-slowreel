// phone.js - "Slowreel pocket": listen (transport + track mutes) and play pads (scale pads on any instrument track).
import { S, on, edit, clamp, isSongTrack, fmtTime, songBeats } from './state.js?v=8';
import { h } from './controls.js?v=8';
import { createDeck } from './deck.js?v=8';
import { scaleRun, noteName, keyIndex, scaleById } from './theory.js?v=8';

const $ = id => document.getElementById(id);
let api, deck, padOct = 4, padTrack = null;

export function initPhone(a) {
  api = a;
  deck = createDeck($('ph-deck'));
  $('ph-play').onclick = () => (S.playing ? api.stop() : api.play());
  $('ph-stop').onclick = () => { if (S.playing) api.stop(); else api.returnToStart(); };
  $('ph-return').onclick = api.returnToStart;
  const tabs = [['ph-listen', 'ph-listen-pane'], ['ph-pads-tab', 'ph-pads-pane']];
  tabs.forEach(([b, p]) => { $(b).onclick = () => { tabs.forEach(([b2, p2]) => { $(b2).setAttribute('aria-selected', String(b2 === b)); $(p2).hidden = p2 !== p; }); if (p === 'ph-pads-pane') pads(); }; });
  $('ph-oct-dn').onclick = () => { padOct = clamp(padOct - 1, 2, 6); pads(); };
  $('ph-oct-up').onclick = () => { padOct = clamp(padOct + 1, 2, 6); pads(); };
  $('ph-sound').onchange = e => { padTrack = e.target.value; pads(); };
  on('project', render); on('render', render);
}

function render() {
  if (!S.project) return;
  $('ph-title').textContent = S.project.name;
  const ul = $('ph-tracks'); ul.textContent = '';
  S.project.tracks.forEach(t => ul.append(h('li', { style: { '--c': t.color } }, h('i'), h('span', { text: t.name }),
    h('button', { class: 'key', 'aria-pressed': String(!t.mute), 'aria-label': `${t.name} ${t.mute ? 'off' : 'on'}`, text: t.mute ? 'Off' : 'On',
      onclick: () => edit(p => { const x = p.tracks.find(x => x.id === t.id); x.mute = !x.mute; }, { type: 'mixer', trackId: t.id }) }))));
  const sel = $('ph-sound'); sel.textContent = '';
  const inst = S.project.tracks.filter(t => !isSongTrack(t));
  if (!inst.find(t => t.id === padTrack)) padTrack = inst[0]?.id || null;
  inst.forEach(t => sel.append(h('option', { value: t.id, selected: t.id === padTrack }, t.name)));
  if (!$('ph-pads-pane').hidden) pads();
}

function pads() {
  const el = $('pads'); el.textContent = '';
  $('ph-oct').textContent = `Oct ${padOct}`;
  const t = S.project.tracks.find(x => x.id === padTrack);
  const notes = scaleRun(S.project.key, S.project.scale, padOct, 16);
  const rootPc = keyIndex(S.project.key);
  // 4x4, low notes at the bottom like a pad controller
  const rows = [12, 8, 4, 0].flatMap(r => notes.slice(r, r + 4));
  rows.forEach(m => {
    const b = h('button', { class: 'key pad' + ((m - rootPc) % 12 === 0 ? ' root' : ''), style: { '--c': t?.color || 'var(--signal)' }, 'aria-label': `Play ${noteName(m)}` }, noteName(m));
    const up = () => { b.classList.remove('down'); if (t) api.keyOff(t.id, m); };
    b.addEventListener('pointerdown', e => { e.preventDefault(); if (!t) return; if (S.ctx.state !== 'running') S.ctx.resume(); b.classList.add('down'); api.keyOn(t.id, m); b.setPointerCapture?.(e.pointerId); });
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    b.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && t) { e.preventDefault(); e.stopPropagation(); b.classList.add('down'); api.keyOn(t.id, m); } });
    b.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') up(); });
    el.append(b);
  });
  $('ph-scale-note').textContent = `${S.project.key} ${scaleById(S.project.scale).name.toLowerCase()} · every pad is in key`;
}

export function phoneFrame({ beat, dt, level, playing, frac }) {
  deck.draw({ playing, frac: clamp(frac, 0, 1), level, analyser: S.engine?.analyser, dt, still: matchMedia('(prefers-reduced-motion: reduce)').matches });
  $('ph-time').textContent = fmtTime(beat * 60 / (S.project?.bpm || 70));
  $('ph-bar').style.width = clamp(beat / songBeats(), 0, 1) * 100 + '%';
}
