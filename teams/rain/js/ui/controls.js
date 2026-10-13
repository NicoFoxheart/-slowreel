// Knobs, faders and meters. All are role="slider", keyboard operable (arrows, PageUp/Down, Home/End),
// drag vertically (Shift = fine), wheel, double-click resets to default.
import { h, clamp, fmtVal } from './dom.js';

let knobN = 0;
const ARC = 270, A0 = -135;
const polar = (cx, cy, r, deg) => { const a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
const arcPath = (cx, cy, r, d0, d1) => {
  if (d1 - d0 < 0.5) d1 = d0 + 0.5;
  const [x0, y0] = polar(cx, cy, r, d0), [x1, y1] = polar(cx, cy, r, d1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

/** knob({id, label, min, max, value, def, unit, size:'s'|'m'|'l', bipolar, curve:'lin'|'log', onInput, onCommit, format}) */
export function knob(o) {
  const min = o.min ?? 0, max = o.max ?? 1, def = o.def ?? min, size = o.size || 'm';
  const px = { s: 30, m: 40, l: 56 }[size], r = px / 2 - 3.5, c = px / 2;
  const log = o.curve === 'log' && min > 0;
  const bipolar = o.bipolar ?? (min < 0 && max > 0);
  const toT = v => log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
  const fromT = t => { t = clamp(t, 0, 1); return log ? min * Math.pow(max / min, t) : min + t * (max - min); };
  const step = o.step || (Number.isInteger(min) && Number.isInteger(max) && max - min >= 4 && !o.unit?.includes('dB') ? 1 : 0);
  const quant = v => step ? Math.round(v / step) * step : v;
  const fmt = o.format || (v => fmtVal(v, o.unit));
  let value = o.value ?? def;
  const id = o.id || `knob-${++knobN}`;
  const svg = `<svg viewBox="0 0 ${px} ${px}" width="${px}" height="${px}" aria-hidden="true">
    <circle class="k-cap" cx="${c}" cy="${c}" r="${r - 4}"/>
    <path class="k-track" d="${arcPath(c, c, r, A0, A0 + ARC)}"/>
    <path class="k-val" d=""/>
    <line class="k-tick" x1="${c}" y1="${c - r + 6}" x2="${c}" y2="${c - r + 1 + (size === 'l' ? 12 : 9)}"/>
  </svg>`;
  const face = h('div', { class: 'k-face', html: svg });
  const out = h('output', { class: 'k-out', for: id });
  const el = h('div', { class: `knob knob-${size}`, id, role: 'slider', tabindex: 0, 'aria-label': o.label, 'aria-valuemin': min, 'aria-valuemax': max, title: o.title || `${o.label} - drag, scroll or use arrow keys. Double-click to reset.` },
    face, h('span', { class: 'k-label' }, o.label), out);
  const valPath = face.querySelector('.k-val'), tick = face.querySelector('.k-tick');
  function draw() {
    const t = clamp(toT(value), 0, 1), deg = A0 + t * ARC;
    const zeroT = bipolar ? clamp(toT(0), 0, 1) : 0, z = A0 + zeroT * ARC;
    valPath.setAttribute('d', arcPath(c, c, r, Math.min(z, deg), Math.max(z, deg)));
    tick.setAttribute('transform', `rotate(${deg} ${c} ${c})`);
    out.textContent = fmt(value);
    el.setAttribute('aria-valuenow', +value.toFixed(4)); el.setAttribute('aria-valuetext', fmt(value));
  }
  function set(v, emit = true) { const nv = quant(clamp(v, min, max)); if (nv === value) return; value = nv; draw(); if (emit) o.onInput?.(value); }
  const commit = () => o.onCommit?.(value);
  let drag = null;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; e.preventDefault(); el.focus();
    drag = { y: e.clientY, t: toT(value) }; el.setPointerCapture(e.pointerId); el.classList.add('dragging');
  });
  el.addEventListener('pointermove', e => {
    if (!drag) return; const sens = e.shiftKey ? 900 : 180;
    set(fromT(drag.t + (drag.y - e.clientY) / sens));
  });
  const end = () => { if (!drag) return; drag = null; el.classList.remove('dragging'); commit(); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => { set(def); commit(); });
  let wheelT;
  el.addEventListener('wheel', e => { e.preventDefault(); set(fromT(toT(value) - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.03))); clearTimeout(wheelT); wheelT = setTimeout(commit, 250); }, { passive: false });
  el.addEventListener('keydown', e => {
    const k = e.key, fine = e.shiftKey ? 0.2 : 1; let t = toT(value), used = true;
    const st = step ? step / (max - min) : 0.02;
    if (k === 'ArrowUp' || k === 'ArrowRight') t += st * fine; else if (k === 'ArrowDown' || k === 'ArrowLeft') t -= st * fine;
    else if (k === 'PageUp') t += 0.1; else if (k === 'PageDown') t -= 0.1; else if (k === 'Home') t = 0; else if (k === 'End') t = 1;
    else if (k === 'Delete' || k === 'Backspace') { set(def); commit(); e.preventDefault(); e.stopPropagation(); return; }
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); set(fromT(t)); clearTimeout(wheelT); wheelT = setTimeout(commit, 300); }
  });
  draw();
  el.set = v => { value = clamp(v, min, max); draw(); };
  el.get = () => value;
  return el;
}

/** Vertical fader in dB. fader({id, label, value, min=-60, max=6, onInput, onCommit}) */
export function fader(o) {
  const min = o.min ?? -60, max = o.max ?? 6; let value = o.value ?? 0;
  // fader law: top part linear in dB, bottom compressed
  const toT = db => db <= min ? 0 : Math.pow((db - min) / (max - min), 1.6);
  const fromT = t => t <= 0 ? min : min + Math.pow(clamp(t, 0, 1), 1 / 1.6) * (max - min);
  const thumb = h('div', { class: 'f-thumb' });
  const fill = h('div', { class: 'f-fill' });
  const track = h('div', { class: 'f-track' }, fill, h('div', { class: 'f-zero', style: { bottom: `calc(${toT(0) * 100}% )` } }), thumb);
  const el = h('div', { class: 'fader', id: o.id, role: 'slider', tabindex: 0, 'aria-label': o.label, 'aria-orientation': 'vertical', 'aria-valuemin': min, 'aria-valuemax': max, title: `${o.label} - drag or arrow keys, double-click for 0 dB` }, track);
  function draw() { const t = toT(value); thumb.style.bottom = `calc(${t * 100}% - 7px)`; fill.style.height = `${t * 100}%`; el.setAttribute('aria-valuenow', value.toFixed(1)); el.setAttribute('aria-valuetext', (value <= min ? '-inf' : value.toFixed(1)) + ' dB'); }
  function set(v) { value = Math.round(clamp(v, min, max) * 10) / 10; draw(); o.onInput?.(value); }
  let drag = null;
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); el.focus(); const r = track.getBoundingClientRect();
    if (e.target !== thumb) set(fromT(1 - (e.clientY - r.top) / r.height));
    drag = { y: e.clientY, t: toT(value), hgt: r.height }; el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => { if (drag) set(fromT(drag.t + (drag.y - e.clientY) / drag.hgt * (e.shiftKey ? 0.2 : 1))); });
  const end = () => { if (drag) { drag = null; o.onCommit?.(value); } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => { set(0); o.onCommit?.(value); });
  let t2;
  el.addEventListener('keydown', e => {
    const d = { ArrowUp: 0.5, ArrowDown: -0.5, ArrowRight: 0.5, ArrowLeft: -0.5, PageUp: 3, PageDown: -3 }[e.key];
    if (d !== undefined) { e.preventDefault(); e.stopPropagation(); set(value + d * (e.shiftKey ? 0.2 : 1)); clearTimeout(t2); t2 = setTimeout(() => o.onCommit?.(value), 300); }
  });
  el.addEventListener('wheel', e => { e.preventDefault(); set(value - Math.sign(e.deltaY) * 0.5); clearTimeout(t2); t2 = setTimeout(() => o.onCommit?.(value), 300); }, { passive: false });
  draw(); el.set = v => { value = v; draw(); };
  return el;
}

/** Stereo-ish meter: a slim bar with peak hold. meter.update(peakDb, rmsDb) */
export function meter(cls = '') {
  const rms = h('div', { class: 'm-rms' }), pk = h('div', { class: 'm-peak' });
  const el = h('div', { class: 'meter ' + cls, 'aria-hidden': 'true' }, rms, pk);
  let hold = -90, holdT = 0, shown = -90;
  const toT = db => clamp((db + 60) / 60, 0, 1);
  el.update = (peakDb, rmsDb) => {
    const now = performance.now();
    if (peakDb > hold || now - holdT > 1200) { hold = peakDb; holdT = now; }
    shown = Math.max(rmsDb, shown - 1.6);
    rms.style.transform = `scaleY(${toT(shown)})`;
    pk.style.bottom = `${toT(hold) * 100}%`; pk.style.opacity = hold > -59 ? 1 : 0;
    el.classList.toggle('hot', hold > -1.5);
  };
  el.reset = () => { hold = -90; shown = -90; rms.style.transform = 'scaleY(0)'; pk.style.opacity = 0; };
  return el;
}

/** Segmented choice. seg({id, label, options:[{id,name}], value, onChange}) */
export function seg(o) {
  const el = h('div', { class: 'seg ' + (o.cls || ''), role: 'radiogroup', 'aria-label': o.label, id: o.id });
  const btns = o.options.map(op => h('button', { type: 'button', role: 'radio', class: 'seg-b', 'aria-checked': String(op.id === o.value), onclick: () => { el.set(op.id); o.onChange(op.id); } }, op.name));
  el.append(...btns);
  el.set = v => btns.forEach((b, i) => b.setAttribute('aria-checked', String(o.options[i].id === v)));
  return el;
}

/** A styled native select (keyboard accessible for free). */
export function select(o) {
  const s = h('select', { id: o.id, class: 'sel ' + (o.cls || ''), 'aria-label': o.label, onchange: e => o.onChange(e.target.value) },
    o.options.map(op => h('option', { value: op.id, selected: op.id === o.value ? true : undefined }, op.name)));
  return h('label', { class: 'sel-wrap ' + (o.wrapCls || '') }, o.showLabel ? h('span', { class: 'lbl' }, o.label) : null, s);
}
