// panels.js - the dock's Sound (instrument), Effects, Mixer and Keys panes, the song-clip editor and the
// glowing Song Cloud window. Knob drags are live (engine.setParam) and land in undo history on release.
import { S, on, emit, edit, begin, end, track, clipOf, clamp, bpb, isSongTrack, instDef, fxDef, optId, optName,
  isSongParam, isEnum, isToggle, instValue, fxValue, songBeats, instGroups } from './state.js';
import { h, icon, knob, fader, meter, fmt } from './controls.js';
import { SONGS, getSong } from '../../lib/songs.js';
import { TRACK_COLORS } from './sample-project.js';
import { NOTE_NAMES, noteName, isBlack, inScale } from './theory.js';
import { removeTrack } from './arrange.js';
import { canvasSize } from './deck.js';
import { ARP_PARAMS, arpSettings } from '../sound/arp.js';
import { createSamplerPanel } from './sampler-ui.js';

const panes = {};
let mixRefs = { meters: {}, master: null }, cloudRef = null;
export function initPanels(els) {
  Object.assign(panes, els);
  on('render', ch => { if (ch?.type === 'mixer-live') return; renderTab(); });
  on('select', () => renderTab());
}
export function renderTab() {
  if (!S.project) return;
  cloudRef = null;
  if (S.tab === 'sound') renderSound();
  else if (S.tab === 'fx') renderFx();
  else if (S.tab === 'mix') renderMixer();
  else if (S.tab === 'keys') renderKeys();
}

// live param helper: begin() on first move, end() on release (one undo step per gesture)
const live = (apply, change) => ({ onInput: v => { begin(); apply(v); }, onCommit: v => { begin(); apply(v); end(change, { render: false }); } });
const unit = (title, cls, ...kids) => h('div', { class: 'unit ' + (cls || '') }, title ? h('h3', {}, ...[].concat(title)) : null, ...kids);
const empty = (title, text) => h('div', { class: 'empty' }, h('strong', { text: title }), h('span', { text }));

// ---------------------------------------------------------------- Sound
function renderSound() {
  const el = panes.sound; el.textContent = '';
  const t = track();
  if (!t) { el.append(empty('No track selected', 'Pick a track on the left of the arrange view.')); return; }
  const rack = h('div', { class: 'rack', 'data-scroll': '' });
  if (isSongTrack(t)) {
    rack.append(unit(['Song track', h('span', { class: 'label', text: 'Nico\'s tapes' })], 'wide-note',
      h('p', { class: 'note-text', text: 'This track plays sections of Nico\'s songs. Add a clip from Nico\'s tapes on the right, then select it to set the start, fades, gain and speed under Notes.' })));
  } else {
    const def = instDef(t.instrument.id);
    // cartridges: instrument picker
    // cartridges grouped by region (Slowreel's own, then Korean / Chinese / Japanese)
    const carts = h('div', { class: 'cart-groups', 'data-scroll': '' });
    let ci = 0;
    for (const g of instGroups()) {
      const grid = h('div', { class: 'cartridges', role: 'group', 'aria-label': g.label === 'Slowreel' ? 'Instrument' : g.label + ' instruments' });
      g.items.forEach(d => grid.append(h('button', { class: 'key cart', id: `inst-${d.id}`, 'aria-pressed': String(d.id === t.instrument.id), style: { '--c': TRACK_COLORS[ci++ % TRACK_COLORS.length] },
        onclick: () => setInstrument(t, d) }, h('span', { class: 'sw' }), d.name)));
      carts.append(h('div', {}, h('span', { class: 'label', text: g.label }), grid));
    }
    rack.append(unit(['Instrument', h('span', { class: 'label', text: [def?.region, def?.kind].filter(Boolean).join(' · ') })], 'inst-unit', carts));
    requestAnimationFrame(() => { const on = carts.querySelector('.cart[aria-pressed="true"]'); if (on && carts.scrollHeight > carts.clientHeight) carts.scrollTop = Math.max(0, on.getBoundingClientRect().top - carts.getBoundingClientRect().top - 30); });
    if (def) {
      const pre = h('div', { class: 'presets', role: 'group', 'aria-label': 'Presets' });
      def.presets.forEach(p => pre.append(h('button', { class: 'key', id: `preset-${p.id}`, 'aria-pressed': String(p.id === t.instrument.preset), text: p.name,
        onclick: () => edit(pp => { const x = pp.tracks.find(x => x.id === t.id); x.instrument.preset = p.id; x.instrument.params = {}; }, { type: 'track', trackId: t.id }) })));
      rack.append(unit('Preset', '', pre));
      const macroIds = new Set(def.macros.map(m => m.id));
      const mk = h('div', { class: 'knobs' });
      def.macros.forEach(m => { const full = def.params.find(p => p.id === m.id) || m; mk.append(paramControl(t, full, 'lg')); });
      rack.append(unit(['Macros', h('span', { class: 'label', text: 'drag · wheel · arrows' })], 'macros', mk));
      const songP = def.params.find(isSongParam);
      if (def.id === 'chop') rack.append(chopUnit(t));
      else if (songP) rack.append(cloudUnit(t, def, songP));
      const rest = def.params.filter(p => !macroIds.has(p.id) && p !== songP);
      if (rest.length) {
        const kn = h('div', { class: 'knobs' }); rest.forEach(p => kn.append(paramControl(t, p, 'sm')));
        rack.append(unit('Shape', 'shape', kn));
      }
      if (!['drums', 'texture', 'granular'].includes(def.kind)) rack.append(arpUnit(t));
    }
  }
  rack.append(trackUnit(t));
  el.append(rack);
}
// ---------------------------------------------------------------- Arpeggiator (track.arp; clip playback and live keys)
function arpUnit(t) {
  const a = arpSettings(t.arp || {});
  const set = (id, v) => { const x = S.project.tracks.find(x => x.id === t.id); x.arp = { ...arpSettings(x.arp || {}), [id]: v }; };
  const change = { type: 'notes', trackId: t.id };
  const onP = ARP_PARAMS.find(p => p.id === 'on');
  const onBtn = h('button', { class: 'key sm led-green', id: 'arp-on', 'aria-pressed': String(a.on), title: 'Arpeggiate this track: its clips and the keys you play',
    onclick: () => edit(() => set('on', !a.on), change) }, h('span', { class: 'led' }), onP.name);
  const row = h('div', { class: 'knobs arp-knobs' + (a.on ? '' : ' dim') });
  for (const p of ARP_PARAMS) {
    if (p.id === 'on') continue;
    if (isEnum(p)) row.append(optionKeys(p, a[p.id], v => edit(() => set(p.id, v), change), 'arp'));
    else row.append(knob(p, { value: a[p.id], size: 'sm', idPrefix: 'arp', color: 'var(--saffron)', ...live(v => set(p.id, v), change) }));
  }
  return unit(['Arpeggiator', h('span', { class: 'label', text: a.on ? 'on · clips + keys' : 'off' })], 'arp-unit', h('div', { class: 'arp-top' }, onBtn), row);
}

// ---------------------------------------------------------------- Chop Sampler (source, waveform + slices, per-slice edits)
let chopRef = null;
function chopUnit(t) {
  const live = S.project.tracks.find(x => x.id === t.id);
  const panel = createSamplerPanel({ track: live, ctx: S.ctx, engine: S.engine, color: t.color,
    onBegin: () => begin(),
    onChange: () => { },
    onEnd: kind => { end({ type: 'track', trackId: t.id }, { render: false }); if (kind === 'sample') S.engine.ensureSamples?.(); },
    audition: m => { S.engine.noteOn(t.id, m, 0.85); setTimeout(() => S.engine.noteOff(t.id, m), 450); } });
  chopRef = { panel, id: t.id };
  return unit(['Chop Sampler', h('span', { class: 'label', text: 'slices from C3 up · drop audio here' })], 'chop-unit', panel);
}

function setInstrument(t, d) {
  edit(p => {
    const x = p.tracks.find(x => x.id === t.id), old = instDef(x.instrument.id);
    if (old && x.name === old.name) x.name = d.name;
    x.instrument = { id: d.id, preset: d.presets[0]?.id || '', params: {} };
  }, { type: 'all' });
}
function paramControl(t, p, size) {
  const value = instValue(t, p);
  const apply = v => { const x = S.project.tracks.find(x => x.id === t.id); x.instrument.params = { ...(x.instrument.params || {}), [p.id]: v }; S.engine.setParam({ track: t.id }, p.id, v); };
  if (isToggle(p)) {
    return h('div', { class: 'toggle-wrap' }, h('button', { class: 'key sm', id: `ip-${p.id}`, 'aria-pressed': String(value >= 0.5), onclick: e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); edit(() => apply(on ? 1 : 0), { type: 'track', trackId: t.id }, { render: false }); } }, h('span', { class: 'led' }), p.name));
  }
  if (isEnum(p)) return optionKeys(p, value, v => edit(() => apply(v), { type: 'track', trackId: t.id }, { render: false }), 'ip');
  const lv = live(apply, { type: 'track', trackId: t.id });
  if (t.instrument?.id === 'chop') { const c0 = lv.onCommit; lv.onCommit = v => { c0(v); if (chopRef?.id === t.id && chopRef.panel.isConnected) chopRef.panel.update(S.project.tracks.find(x => x.id === t.id)); }; }
  return knob(p, { value, size, idPrefix: 'ip', ...lv });
}
function optionKeys(p, value, onPick, prefix) {
  const wrap = h('div', { class: 'optwrap' }, h('span', { class: 'label', text: p.name }));
  const row = h('div', { class: 'opt-row', role: 'group', 'aria-label': p.name });
  (p.options || []).forEach(o => row.append(h('button', { class: 'key sm', id: `${prefix}-${p.id}-${optId(o)}`, 'aria-pressed': String(optId(o) === value), text: optName(o),
    onclick: e => { row.querySelectorAll('.key').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget))); onPick(optId(o)); } })));
  wrap.append(row); return wrap;
}
function trackUnit(t) {
  const sw = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Track colour' });
  TRACK_COLORS.forEach(c => sw.append(h('button', { class: 'swatch', style: { '--c': c }, 'aria-label': 'Colour ' + c, 'aria-pressed': String(c === t.color),
    onclick: () => edit(p => { p.tracks.find(x => x.id === t.id).color = c; }, { type: 'track', trackId: t.id }) })));
  const rm = h('div', { class: 'rm-row' });
  const ask = () => { rm.textContent = ''; rm.append(h('div', { class: 'confirm' }, h('span', { text: 'Remove this track?' }),
    h('button', { class: 'key sm signal', id: 'rm-yes', text: 'Remove', onclick: () => removeTrack(t.id) }),
    h('button', { class: 'key sm', id: 'rm-no', text: 'Keep', onclick: () => { rm.textContent = ''; rm.append(btn()); } }))); rm.querySelector('#rm-no').focus(); };
  const btn = () => h('button', { class: 'key sm', id: 'rm-track', onclick: ask }, icon('trash'), 'Remove track');
  rm.append(btn());
  return unit(['Track', h('span', { class: 'label', text: t.name })], 'trackunit', h('span', { class: 'label', text: 'Colour' }), sw, rm);
}

// ---------------------------------------------------------------- Song Cloud window (glowing grains over the song)
function cloudUnit(t, def, songP) {
  const songId = instValue(t, songP);
  const posP = def.params.find(p => p.id === 'position'), sprayP = def.params.find(p => p.id === 'spray'), freezeP = def.params.find(isToggle);
  const cv = h('canvas', { class: 'cloud-cv', role: 'slider', tabindex: 0, id: 'cloud-pos', 'aria-label': 'Grain position in the song (click or arrows)', 'aria-valuemin': 0, 'aria-valuemax': 1 });
  const sel = h('select', { class: 'sel', id: 'cloud-song', 'aria-label': 'Song for the cloud' }, ...songP.options.map(o => h('option', { value: optId(o), selected: optId(o) === songId }, optName(o))));
  const setP = (id, v) => { const x = S.project.tracks.find(x => x.id === t.id); x.instrument.params = { ...(x.instrument.params || {}), [id]: v }; S.engine.setParam({ track: t.id }, id, v); };
  sel.addEventListener('change', () => edit(() => setP(songP.id, sel.value), { type: 'track', trackId: t.id }));
  const ref = cloudRef = { cv, t, def, posId: posP?.id, sprayId: sprayP?.id, freezeId: freezeP?.id, grains: [], level: 0 };
  const setPos = (v, commit) => { v = clamp(v, 0, 1); begin(); setP(posP.id, v); cv.setAttribute('aria-valuenow', v.toFixed(2)); drawCloud(ref, 0); if (commit) end({ type: 'track', trackId: t.id }, { render: false }); document.getElementById('ip-' + posP.id)?.set?.(v); };
  if (posP) {
    cv.addEventListener('pointerdown', e => { e.preventDefault(); cv.focus(); const r = cv.getBoundingClientRect(); const f = ev => setPos((ev.clientX - r.left) / r.width); f(e);
      const up = ev => { setPos((ev.clientX - r.left) / r.width, true); window.removeEventListener('pointermove', f); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', f); window.addEventListener('pointerup', up); });
    cv.addEventListener('keydown', e => { const d = { ArrowLeft: -0.01, ArrowRight: 0.01, ArrowDown: -0.01, ArrowUp: 0.01, PageUp: 0.1, PageDown: -0.1 }[e.key]; if (d === undefined) return; e.preventDefault(); e.stopPropagation(); setPos(instValue(S.project.tracks.find(x => x.id === t.id), posP) + d, true); });
  }
  requestAnimationFrame(() => drawCloud(ref, 0));
  return unit(['Song cloud', h('span', { class: 'label', text: 'grains of Nico\'s song' })], 'cloud-unit',
    h('div', { class: 'glass cloud-glass' }, cv), h('div', { class: 'cloud-row' }, sel));
}
/** Draw / animate the cloud window. level 0..1 drives the grains; called from the app loop while sound plays. */
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
export function animateCloud(level, dt) { if (cloudRef && cloudRef.cv.isConnected) drawCloud(cloudRef, level, dt); }
// Pauses while the window is scrolled out of view or its pane is hidden; the waveform layer is cached (redrawn only
// when the song, position, spray or size change) and grains are stamped from one pre-rendered glow sprite.
const cloudVis = new WeakMap();
const cloudIO = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(es => es.forEach(e => cloudVis.set(e.target, e.isIntersecting))) : null;
let glowSprite = null;
function sprite(d) {
  if (glowSprite && glowSprite.d === d) return glowSprite.cv;
  const R = Math.ceil(17 * d), cv = document.createElement('canvas'); cv.width = cv.height = R * 2;
  const g = cv.getContext('2d'), gg = g.createRadialGradient(R, R, 0, R, R, R);
  gg.addColorStop(0, 'rgba(255,226,170,0.5)'); gg.addColorStop(1, 'rgba(242,169,0,0)'); g.fillStyle = gg; g.fillRect(0, 0, R * 2, R * 2);
  glowSprite = { d, cv }; return cv;
}
function drawCloud(ref, level, dt = 0) {
  const { cv } = ref, t = S.project.tracks.find(x => x.id === ref.t.id); if (!t) return;
  if (cloudIO && !ref.observed) { ref.observed = true; cloudIO.observe(cv); }
  if (dt && cloudVis.get(cv) === false) return;
  const d = Math.min(2, devicePixelRatio || 1), r = canvasSize(cv); if (!r.width) return;
  const W = Math.round(r.width * d), H = Math.round(r.height * d); if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d'); g.clearRect(0, 0, W, H);
  const def = ref.def, songP = def.params.find(isSongParam), s = getSong(instValue(t, songP)) || SONGS[0];
  const pos = ref.posId ? instValue(t, def.params.find(p => p.id === ref.posId)) : 0.3;
  const sprayP = def.params.find(p => p.id === ref.sprayId), spray = sprayP ? (instValue(t, sprayP) - sprayP.min) / (sprayP.max - sprayP.min || 1) : 0.2;
  const frozen = ref.freezeId ? instValue(t, def.params.find(p => p.id === ref.freezeId)) >= 0.5 : false;
  const mid = H * 0.55, n = s.peaks.length, bw = W / n, cx = pos * W, halo = (0.02 + spray * 0.12) * W;
  // waveform: lit near the grain position (cached layer)
  const wkey = [W, H, s.id, pos, spray, d].join('|');
  if (!ref.wave || ref.wave.key !== wkey) {
    const lc = ref.wave?.cv || document.createElement('canvas'); lc.width = W; lc.height = H;
    const lg = lc.getContext('2d'); lg.clearRect(0, 0, W, H);
    for (let i = 0; i < n; i++) {
      const x = i * bw, near = Math.exp(-Math.pow((x + bw / 2 - cx) / (halo * 1.6 + 6 * d), 2)), a = s.peaks[i] * (H * 0.36);
      lg.fillStyle = `rgba(${Math.round(150 + 105 * near)},${Math.round(160 + 50 * near)},${Math.round(150 - 40 * near)},${0.22 + 0.7 * near})`;
      lg.fillRect(x + bw * 0.2, mid - a, Math.max(1, bw * 0.6), a * 1.6);
    }
    ref.wave = { key: wkey, cv: lc };
  }
  g.drawImage(ref.wave.cv, 0, 0);
  // glow
  const glow = 0.35 + 0.65 * Math.min(1, level * 2.2);
  const rg = g.createRadialGradient(cx, mid, 0, cx, mid, halo * 2.4 + 22 * d);
  rg.addColorStop(0, `rgba(255,214,140,${0.55 * glow})`); rg.addColorStop(0.4, `rgba(242,169,0,${0.22 * glow})`); rg.addColorStop(1, 'rgba(242,169,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  // grains: little sparks drifting up from the position
  const gr = ref.grains;
  const real = S.engine?.cloudGrains ? S.engine.cloudGrains(1.6, t.id) : null;
  if (real) {   // the real engine reports every grain: position in the song, pitch (rate), pan, velocity
    const spr = sprite(d);
    for (const q of real) {
      const age = Math.max(0, q.age), life = 1 - age / 1.6; if (life <= 0) continue;
      const x = clamp(q.pos, 0, 1) * W, y = mid - Math.log2(q.rate || 1) * H * 0.16 - (reduceMQ.matches ? 0 : age * 14 * d) + (q.pan || 0) * H * 0.06;
      const r = (1.2 + Math.min(2.5, (q.dur || 0.2) * 4)) * d, a = Math.min(1, (q.vel ?? 0.7) + 0.25) * life;
      g.globalAlpha = a; g.drawImage(spr, x - r * 5, y - r * 5, r * 10, r * 10); g.globalAlpha = 1;
      g.fillStyle = `rgba(255,244,222,${0.9 * a})`; g.beginPath(); g.arc(x, y, r * (0.6 + 0.4 * life), 0, 6.283); g.fill();
    }
  } else if (level > 0.01 && dt) { const k = Math.min(6, Math.round(level * 40 * dt * 10)); for (let i = 0; i < k; i++) gr.push({ x: cx + (Math.random() * 2 - 1) * halo, y: mid + (Math.random() - 0.5) * H * 0.3, life: 1, vy: -(6 + Math.random() * 16) * d, r: (1 + Math.random() * 1.8) * d }); }
  for (let i = gr.length - 1; i >= 0; i--) { const p = gr[i]; p.life -= dt * (frozen ? 0.5 : 0.9); if (!reduceMQ.matches) p.y += p.vy * dt; if (p.life <= 0) { gr.splice(i, 1); continue; }
    g.fillStyle = `rgba(255,236,200,${0.85 * p.life})`; g.shadowColor = 'rgba(255,190,90,.9)'; g.shadowBlur = 6 * d; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.283); g.fill(); }
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,240,215,.95)'; g.fillRect(cx - d, mid - H * 0.3, 2 * d, H * 0.52);
  g.font = `600 ${9 * d}px "IBM Plex Mono", ui-monospace, monospace`; g.fillStyle = 'rgba(238,240,234,.6)'; g.textAlign = 'left';
  g.fillText(s.title.toUpperCase() + (frozen ? '  ·  FROZEN' : ''), 8 * d, 14 * d);
  g.textAlign = 'right'; const sec = pos * s.duration; g.fillText(`${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`, W - 8 * d, 14 * d);
}

// ---------------------------------------------------------------- Effects
function renderFx() {
  const el = panes.fx; el.textContent = '';
  const tgt = S.fxTarget, t = track();
  let chain, target, title, hint;
  if (tgt === 'space') { chain = S.project.buses.space.fx; target = { bus: 'space' }; title = 'Space bus'; hint = 'The shared reverb every track sends to.'; }
  else if (tgt === 'echo') { chain = S.project.buses.echo.fx; target = { bus: 'echo' }; title = 'Echo bus'; hint = 'Tape echo; its repeats bloom into the Space.'; }
  else if (tgt === 'master') { chain = S.project.master.fx || (S.project.master.fx = []); target = { master: true }; title = 'Master'; hint = 'After the mix, before the safety limiter.'; }
  else { if (!t) { el.append(empty('No track selected', 'Pick a track to see its effects.')); return; } chain = t.fx || (t.fx = []); target = { track: t.id }; title = t.name; hint = 'Runs in order, left to right, before the fader and sends.'; }
  const rack = h('div', { class: 'rack', 'data-scroll': '' });
  rack.append(h('div', { class: 'unit chain-head' }, h('span', { class: 'label', text: 'Chain' }), h('strong', { text: title }), h('p', { class: 'note-text', text: hint })));
  const chainPath = p => tgt === 'space' ? p.buses.space.fx : tgt === 'echo' ? p.buses.echo.fx : tgt === 'master' ? p.master.fx : p.tracks.find(x => x.id === t.id).fx;
  chain.forEach((fx, i) => {
    const def = fxDef(fx.id); if (!def) return;
    const apply = (id, v) => { const f = chainPath(S.project)[i]; f.params = { ...(f.params || {}), [id]: v }; S.engine.setParam({ ...target, fx: i }, id, v); };
    const change = tgt === 'track' ? { type: 'track', trackId: t.id } : { type: 'master' };
    const kn = h('div', { class: 'knobs' });
    def.params.forEach(p => {
      if (isEnum(p)) kn.append(optionKeys(p, fxValue(fx, p), v => edit(() => apply(p.id, v), change, { render: false }), `fx${i}`));
      else kn.append(knob(p, { value: fxValue(fx, p), size: 'sm', idPrefix: `fx${i}`, ...live(v => apply(p.id, v), change) }));
    });
    const byp = h('button', { class: 'key sm led-green', id: `fx${i}-on`, 'aria-pressed': String(!fx.bypass), 'aria-label': `${def.name} on`, title: 'On / bypass',
      onclick: () => edit(p => { const f = chainPath(p)[i]; f.bypass = !f.bypass; }, { type: 'all' }) }, h('span', { class: 'led' }), 'On');
    const rmv = h('button', { class: 'key sm sq', id: `fx${i}-rm`, 'aria-label': `Remove ${def.name}`, title: 'Remove', onclick: () => edit(p => { chainPath(p).splice(i, 1); }, { type: 'all' }) }, icon('close'));
    const left = i > 0 ? h('button', { class: 'key sm sq', 'aria-label': `Move ${def.name} earlier`, title: 'Move earlier', onclick: () => edit(p => { const c = chainPath(p); [c[i - 1], c[i]] = [c[i], c[i - 1]]; }, { type: 'all' }) }, '‹') : null;
    rack.append(h('div', { class: 'unit fx' + (fx.bypass ? ' off' : '') + (/shimmer/.test(fx.id) ? ' shimmer' : '') },
      h('h3', {}, h('span', { class: 'fxn', text: def.name }), h('span', { class: 'grow' }), left, byp, rmv), kn));
  });
  if (chain.length < 6) {
    const opts = h('div', { class: 'opts' });
    S.engine.effects.forEach(d => opts.append(h('button', { class: 'key sm', id: `addfx-${d.id}`, text: '+ ' + d.name,
      onclick: () => edit(p => { chainPath(p).push({ id: d.id, params: {}, bypass: false }); }, { type: 'all' }) })));
    rack.append(h('div', { class: 'unit add-unit' }, h('span', { class: 'label', text: 'Add effect' }), opts));
  }
  if (tgt === 'space' || tgt === 'echo') {
    const bus = S.project.buses[tgt];
    rack.append(unit('Return', '', knob({ id: 'returnDb', name: 'Level', min: -24, max: 6, default: 0, unit: 'dB' }, { value: bus.returnDb ?? 0, idPrefix: tgt,
      ...live(v => { S.project.buses[tgt].returnDb = v; S.engine.setParam({ bus: tgt }, 'returnDb', v); }, { type: 'master' }) })));
  }
  el.append(rack);
}

// ---------------------------------------------------------------- Mixer
function renderMixer() {
  const el = panes.mix; el.textContent = '';
  const rack = h('div', { class: 'rack mixer', 'data-scroll': '' });
  mixRefs = { meters: {}, master: null };
  for (const t of S.project.tracks) rack.append(strip(t));
  rack.append(busStrip('space', 'Space'), busStrip('echo', 'Echo'), masterStrip());
  el.append(rack);
}
const mixChange = t => ({ type: 'mixer', trackId: t.id });
function strip(t) {
  const set = (id, v) => { const x = S.project.tracks.find(x => x.id === t.id); if (id.startsWith('sends.')) x.sends[id.slice(6)] = v; else x[id] = v; S.engine.setParam({ track: t.id }, id, v); };
  const db = h('span', { class: 'db mono', text: fmtDb(t.volumeDb ?? 0) });
  const fd = fader({ id: `fader-${t.id}`, label: `${t.name} volume`, value: t.volumeDb ?? 0, onInput: v => { begin(); set('volumeDb', v); db.textContent = fmtDb(v); }, onCommit: v => { begin(); set('volumeDb', v); end(mixChange(t), { render: false }); } });
  const m = meter({ height: 108 }); mixRefs.meters[t.id] = m;
  const kn = h('div', { class: 'sknobs' },
    knob({ id: 'pan', name: 'Pan', min: -1, max: 1, default: 0, unit: 'pan' }, { value: t.pan || 0, size: 'sm', idPrefix: `pan-${t.id}`, ...live(v => set('pan', v), mixChange(t)) }),
    knob({ id: 'space', name: 'Space', min: 0, max: 1, default: 0.4 }, { value: t.sends?.space ?? 0.4, size: 'sm', color: 'var(--cobalt)', idPrefix: `send-${t.id}`, ...live(v => set('sends.space', v), mixChange(t)) }),
    knob({ id: 'echo', name: 'Echo', min: 0, max: 1, default: 0 }, { value: t.sends?.echo ?? 0, size: 'sm', color: 'var(--saffron)', idPrefix: `send-${t.id}`, ...live(v => set('sends.echo', v), mixChange(t)) }));
  const ms = h('div', { class: 'ms' },
    h('button', { class: 'key sm m', id: `mx-mute-${t.id}`, 'aria-pressed': String(!!t.mute), 'aria-label': `Mute ${t.name}`, text: 'M', onclick: () => edit(p => { const x = p.tracks.find(x => x.id === t.id); x.mute = !x.mute; }, mixChange(t)) }),
    h('button', { class: 'key sm s', id: `mx-solo-${t.id}`, 'aria-pressed': String(!!t.solo), 'aria-label': `Solo ${t.name}`, text: 'S', onclick: () => edit(p => { const x = p.tracks.find(x => x.id === t.id); x.solo = !x.solo; }, mixChange(t)) }));
  const s = h('div', { class: 'unit strip' + (t.id === S.sel.trackId ? ' sel' : ''), style: { '--c': t.color } },
    h('button', { class: 'sname', text: t.name, onclick: () => { S.sel.trackId = t.id; emit('select'); } }), kn, h('div', { class: 'fz' }, fd, m), db, ms);
  return s;
}
const fmtDb = v => (v <= -60 ? '-inf' : (v > 0 ? '+' : '') + v.toFixed(1)) + ' dB';
function busStrip(key, name) {
  const bus = S.project.buses[key];
  const db = h('span', { class: 'db mono', text: fmtDb(bus.returnDb ?? 0) });
  const fd = fader({ id: `fader-${key}`, label: `${name} return`, value: bus.returnDb ?? 0,
    onInput: v => { begin(); S.project.buses[key].returnDb = v; S.engine.setParam({ bus: key }, 'returnDb', v); db.textContent = fmtDb(v); },
    onCommit: v => { begin(); S.project.buses[key].returnDb = v; S.engine.setParam({ bus: key }, 'returnDb', v); end({ type: 'master' }, { render: false }); } });
  const rv = bus.fx?.[0], def = rv && fxDef(rv.id);
  const typeP = def?.params.find(p => p.id === 'type');
  const kind = typeP ? optName((typeP.options || []).find(o => optId(o) === fxValue(rv, typeP)) || fxValue(rv, typeP)) : (def?.name || '');
  return h('div', { class: 'unit strip bus', style: { '--c': key === 'space' ? 'var(--cobalt)' : 'var(--saffron)' } },
    h('button', { class: 'sname', text: name + ' bus', onclick: () => { S.fxTarget = key; emit('goto-tab', 'fx'); } }),
    h('div', { class: 'bus-kind' }, h('span', { class: 'label', text: key === 'space' ? 'Reverb' : 'Delay' }), h('strong', { text: kind })),
    h('div', { class: 'fz' }, fd), db, h('button', { class: 'key sm', text: 'Edit', onclick: () => { S.fxTarget = key; emit('goto-tab', 'fx'); } }));
}
function masterStrip() {
  const m = S.project.master;
  const db = h('span', { class: 'db mono', text: fmtDb(m.volumeDb ?? 0) });
  const fd = fader({ id: 'fader-master', label: 'Master volume', value: m.volumeDb ?? 0,
    onInput: v => { begin(); S.project.master.volumeDb = v; S.engine.setParam({ master: true }, 'volumeDb', v); db.textContent = fmtDb(v); emit('master-sync'); },
    onCommit: v => { begin(); S.project.master.volumeDb = v; S.engine.setParam({ master: true }, 'volumeDb', v); end({ type: 'master' }, { render: false }); } });
  const mt = meter({ height: 108 }); mixRefs.master = mt;
  const lim = h('div', { class: 'limit', id: 'limit-led' }, h('i'), 'Limit -1 dB');
  mixRefs.limit = lim;
  return h('div', { class: 'unit strip master' }, h('span', { class: 'sname', text: 'Master', style: { '--c': 'var(--ink)' } }),
    knob({ id: 'atmosphere', name: 'Atmos', min: 0, max: 1, default: 0.5 }, { value: m.atmosphere ?? 0.5, size: 'sm', color: 'var(--signal)', idPrefix: 'mx',
      ...live(v => { S.project.master.atmosphere = v; S.engine.setParam({ master: true }, 'atmosphere', v); emit('master-sync'); }, { type: 'master' }) }),
    h('div', { class: 'fz' }, fd, mt), db, lim);
}
/** Called by the app loop: levels {trackId: {peakDb, rmsDb}}, master {peakDb, rmsDb}. */
export function updateMixMeters(levels, master) {
  if (S.tab !== 'mix') return;
  for (const id in mixRefs.meters) { const l = levels[id]; if (l) mixRefs.meters[id].set(l.peakDb, l.rmsDb); }
  if (mixRefs.master && master) { mixRefs.master.set(master.peakDb, master.rmsDb); mixRefs.limit?.classList.toggle('on', master.peakDb > -1.6); }
}

// ---------------------------------------------------------------- Song clip editor (under Notes when a song clip is selected)
export function renderSongClip(el) {
  const f = clipOf(); const { t, c } = f; const sc = c.song; const s = getSong(sc.songId) || SONGS[0];
  el.textContent = '';
  const bps = S.project.bpm / 60;
  const cv = h('canvas', { 'aria-hidden': 'true' });
  const wave = h('div', { class: 'wave', role: 'slider', tabindex: 0, id: 'songclip-wave', 'aria-label': 'Start point in the song (drag, or arrows)', 'aria-valuemin': 0, 'aria-valuemax': Math.round(s.duration), 'aria-valuenow': (sc.offsetSec || 0).toFixed(1) }, cv);
  const info = h('div', { class: 'wave-info mono' });
  const draw = () => {
    const d = Math.min(2, devicePixelRatio || 1), r = cv.getBoundingClientRect(); if (!r.width) return;
    cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, n = s.peaks.length, bw = W / n, mid = H * 0.55;
    const lenSec = c.lengthBeats / bps * (sc.rate || 1), x0 = (sc.offsetSec || 0) / s.duration * W, x1 = Math.min(W, x0 + lenSec / s.duration * W);
    g.fillStyle = 'rgba(238,240,234,.05)'; g.fillRect(x0, 0, x1 - x0, H);
    for (let i = 0; i < n; i++) { const x = i * bw + bw / 2, inside = x >= x0 && x <= x1, a = s.peaks[i] * H * 0.38;
      g.fillStyle = inside ? t.color : 'rgba(238,240,234,.22)'; g.fillRect(i * bw + bw * 0.18, mid - a, Math.max(1, bw * 0.64), a * 1.7); }
    // fades
    const fi = (sc.fadeInSec || 0) * (sc.rate || 1) / s.duration * W, fo = (sc.fadeOutSec || 0) * (sc.rate || 1) / s.duration * W;
    g.strokeStyle = '#EEF0EA'; g.lineWidth = 1.5 * d; g.beginPath(); g.moveTo(x0, H - 6 * d); g.lineTo(x0 + fi, 10 * d); g.lineTo(x1 - fo, 10 * d); g.lineTo(x1, H - 6 * d); g.stroke();
    g.fillStyle = '#EEF0EA'; g.fillRect(x0 - d, 0, 2 * d, H); g.fillRect(x1 - d, 0, 2 * d, H);
    info.textContent = `${s.title}  ·  from ${tm(sc.offsetSec || 0)} to ${tm((sc.offsetSec || 0) + lenSec)}  ·  ${tm(s.duration)} total`;
  };
  const setOff = (v, commit) => { const f2 = clipOf(); if (!f2) return; begin(); f2.c.song.offsetSec = Math.round(clamp(v, 0, Math.max(0, s.duration - 1)) * 10) / 10; wave.setAttribute('aria-valuenow', f2.c.song.offsetSec); draw(); if (commit) end({ type: 'clip', trackId: t.id }); };
  wave.addEventListener('pointerdown', e => {
    e.preventDefault(); wave.focus(); const r = wave.getBoundingClientRect(), o0 = sc.offsetSec || 0, x0 = e.clientX;
    const lenSec = c.lengthBeats / bps * (sc.rate || 1), startX = o0 / s.duration * r.width, endX = startX + lenSec / s.duration * r.width;
    const grab = e.clientX - r.left >= startX && e.clientX - r.left <= endX;
    const mv = ev => setOff(grab ? o0 + (ev.clientX - x0) / r.width * s.duration : (ev.clientX - r.left) / r.width * s.duration - lenSec / 2);
    mv(e);
    const up = ev => { mv(ev); end({ type: 'clip', trackId: t.id }); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  wave.addEventListener('keydown', e => { const d = { ArrowLeft: -0.5, ArrowRight: 0.5, PageUp: 5, PageDown: -5 }[e.key]; if (d === undefined) return; e.preventDefault(); e.stopPropagation(); setOff((clipOf()?.c.song.offsetSec || 0) + d * (e.shiftKey ? 0.2 : 1), true); });
  const sel = h('select', { class: 'sel', id: 'songclip-song', 'aria-label': 'Song' }, ...SONGS.map(x => h('option', { value: x.id, selected: x.id === sc.songId }, x.title)));
  sel.addEventListener('change', () => edit(() => { clipOf().c.song.songId = sel.value; clipOf().c.song.offsetSec = 0; }, { type: 'all' }));
  const sp = (id, v) => { clipOf().c.song[id] = v; draw(); };
  const kn = h('div', { class: 'knobs' },
    knob({ id: 'gainDb', name: 'Gain', min: -24, max: 6, default: -6, unit: 'dB' }, { value: sc.gainDb ?? 0, idPrefix: 'sc', ...live(v => sp('gainDb', v), { type: 'all' }) }),
    knob({ id: 'fadeInSec', name: 'Fade in', min: 0, max: 20, default: 2, unit: 's' }, { value: sc.fadeInSec ?? 0, idPrefix: 'sc', ...live(v => sp('fadeInSec', v), { type: 'all' }) }),
    knob({ id: 'fadeOutSec', name: 'Fade out', min: 0, max: 20, default: 3, unit: 's' }, { value: sc.fadeOutSec ?? 0, idPrefix: 'sc', ...live(v => sp('fadeOutSec', v), { type: 'all' }) }),
    knob({ id: 'rate', name: 'Speed', min: 0.5, max: 1.5, default: 1, unit: 'x' }, { value: sc.rate ?? 1, idPrefix: 'sc', ...live(v => sp('rate', v), { type: 'all' }) }));
  el.append(h('div', { class: 'songclip' },
    h('div', { class: 'sc-left' }, h('div', { class: 'glass wave-glass' }, wave), info),
    h('div', { class: 'unit sc-right' }, h('h3', {}, 'Song clip', h('span', { class: 'label', text: 'slower = lower, like tape' })), sel, kn)));
  requestAnimationFrame(draw);
  void songBeats; void bpb;
}
const tm = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------- Keys (QWERTY)
export const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17 };
const WHITE = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"], BLACK = { w: 0, e: 1, t: 3, y: 4, u: 5, o: 7, p: 8 };
let kbRef = null;
function renderKeys() {
  const el = panes.keys; el.textContent = '';
  const t = track();
  const kb = h('div', { class: 'kb', style: { width: WHITE.length * 52 + 'px', '--c': t?.color || 'var(--signal)' }, role: 'group', 'aria-label': 'Keyboard' });
  const base = 12 * (S.octave + 1);
  WHITE.forEach((k, i) => { const m = base + KEYMAP[k];
    kb.append(keyBtn(k, m, 'w', { left: i * 52 + 'px' })); });
  Object.entries(BLACK).forEach(([k, after]) => { const m = base + KEYMAP[k];
    kb.append(keyBtn(k, m, 'b', { left: (after + 1) * 52 - 17 + 'px' })); });
  kbRef = kb;
  const recBtn = h('button', { class: 'key signal rec', id: 'keys-rec', 'aria-pressed': String(S.rec), onclick: () => emit('toggle-rec') }, icon('rec'), S.rec ? 'Recording' : 'Record');
  const side = h('div', { class: 'qside' },
    h('div', { class: 'unit kside' },
      h('span', { class: 'label', text: 'Playing' }),
      h('strong', { class: 'kname', style: { '--c': t?.color }, text: t ? (isSongTrack(t) ? `${t.name} (song track, pick an instrument track)` : t.name) : 'No track' }),
      h('div', { class: 'oct' },
        h('button', { class: 'key sm', id: 'oct-dn', 'aria-label': 'Octave down (Z)', onclick: () => { S.octave = clamp(S.octave - 1, 1, 7); renderKeys(); } }, 'Z  −'),
        h('span', { class: 'mono', 'aria-live': 'polite', text: `Octave ${S.octave}` }),
        h('button', { class: 'key sm', id: 'oct-up', 'aria-label': 'Octave up (X)', onclick: () => { S.octave = clamp(S.octave + 1, 1, 7); renderKeys(); } }, '+  X')),
      knob({ id: 'vel', name: 'Velocity', min: 0.1, max: 1, default: 0.75 }, { value: S.vel, size: 'sm', idPrefix: 'keys', onInput: v => { S.vel = v; }, onCommit: v => { S.vel = v; } }),
      recBtn),
    h('p', {}, 'Play with ', h('span', { class: 'kbd', text: 'A' }), ' to ', h('span', { class: 'kbd', text: '\'' }), ' (white) and ', h('span', { class: 'kbd', text: 'W E T Y U O P' }),
      ' (black). ', h('span', { class: 'kbd', text: 'R' }), ' records into a new clip on this track while the tape runs.'));
  const hint = side.querySelector('p'); side.removeChild(hint);
  el.append(h('div', { class: 'qwerty', 'data-scroll': '' }, h('div', { class: 'kcol' }, kb, hint), side));
}
function keyBtn(k, m, cls, style) {
  const out = !inScale(m, S.project.key, S.project.scale);
  const b = h('button', { class: `${cls}${out ? ' out' : ''}`, 'data-m': m, 'aria-label': `${noteName(m)} (${k.toUpperCase()})`, style },
    h('span', { class: 'nn', text: noteName(m) }), h('span', { text: k.toUpperCase() }));
  b.addEventListener('pointerdown', e => { e.preventDefault(); emit('key-on', m); const up = () => { emit('key-off', m); window.removeEventListener('pointerup', up); }; window.addEventListener('pointerup', up); });
  return b;
}
export function markKbKey(m, onOff) { kbRef?.querySelector(`[data-m="${m}"]`)?.classList.toggle('on', onOff); }
void NOTE_NAMES; void isBlack;
