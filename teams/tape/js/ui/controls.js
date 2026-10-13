// controls.js - knobs, faders, LED meters, option keys. Mouse, touch, wheel and keyboard on every control.
const NS = 'http://www.w3.org/2000/svg';
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sv === undefined || sv === null) continue; if (sk.startsWith('--')) e.style.setProperty(sk, sv); else e.style[sk] = sv; } }
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
export const icon = (id, label) => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#i-' + id); s.append(u); return s; };
const svg = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

export function fmt(v, unit = '', spec = {}) {
  if (spec.options) return (spec.options.find(o => o.id === v) || {}).name || String(v);
  if (unit === 'Hz') return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : Math.round(v) + '';
  if (unit === 'dB') return (v > 0 ? '+' : '') + v.toFixed(1);
  if (unit === 's') return v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(v < 10 ? 1 : 0) + 's';
  if (unit === 'pan') return Math.abs(v) < 0.01 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100);
  if (unit === '%') return Math.round(v * 100) + '%';
  const span = (spec.max ?? 1) - (spec.min ?? 0);
  if (span <= 1.01 && !unit) return Math.round(((v - (spec.min ?? 0)) / (span || 1)) * 100) + '';
  return (Math.abs(v) >= 100 ? Math.round(v) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)) + (unit && unit !== 'ct' ? unit : '');
}

function arcPath(r, a0, a1) {
  const p = a => [Math.sin(a * Math.PI / 180) * r, -Math.cos(a * Math.PI / 180) * r];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0, sweep = a1 > a0 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** A knob. spec: {id, name, min, max, default, unit, step}. opts: {value, size:'sm'|''|'lg', color, onInput, onCommit, idPrefix, glass} */
export function knob(spec, { value, size = '', color = 'var(--ink)', onInput, onCommit, idPrefix = 'k', glass = false } = {}) {
  const min = spec.min ?? 0, max = spec.max ?? 1, def = spec.default ?? min;
  const log = (spec.unit === 'Hz' && min > 0 && max / min > 20);
  const toN = v => log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min || 1);
  const fromN = n => { n = clamp(n, 0, 1); let v = log ? min * Math.pow(max / min, n) : min + n * (max - min); if (spec.step) v = Math.round(v / spec.step) * spec.step; return clamp(v, min, max); };
  let v = clamp(value ?? def, min, max);
  const bipolar = min < 0 && max > 0;
  const el = h('div', { class: `knob ${size} ${glass ? 'on-glass' : ''}`, role: 'slider', tabindex: 0, id: `${idPrefix}-${spec.id}`, 'aria-label': spec.name, 'aria-valuemin': min, 'aria-valuemax': max });
  const s = svg('svg', { viewBox: '-50 -50 100 100', 'aria-hidden': 'true' });
  for (let i = 0; i <= 10; i++) { const a = (-135 + 27 * i) * Math.PI / 180; const r0 = i % 5 ? 45.5 : 44, r1 = 49; s.append(svg('line', { x1: Math.sin(a) * r0, y1: -Math.cos(a) * r0, x2: Math.sin(a) * r1, y2: -Math.cos(a) * r1, stroke: glass ? '#5E686B' : '#A3A9AC', 'stroke-width': i % 5 ? 1.2 : 1.8, 'stroke-linecap': 'round' })); }
  s.append(svg('path', { d: arcPath(40.5, -135, 135), fill: 'none', stroke: glass ? 'rgba(255,255,255,.1)' : 'rgba(18,22,24,.1)', 'stroke-width': 3.5, 'stroke-linecap': 'round' }));
  const arc = svg('path', { fill: 'none', stroke: color, 'stroke-width': 3.5, 'stroke-linecap': 'round' }); s.append(arc);
  s.append(svg('circle', { cx: 0, cy: 3.5, r: 34, fill: 'rgba(20,24,26,.22)' }));
  const rot = svg('g', {});
  rot.append(svg('circle', { r: 34, fill: 'url(#kn-skirt)' }));
  for (let i = 0; i < 28; i++) { const a = i * Math.PI * 2 / 28; rot.append(svg('line', { x1: Math.sin(a) * 30.5, y1: Math.cos(a) * 30.5, x2: Math.sin(a) * 33.5, y2: Math.cos(a) * 33.5, stroke: 'rgba(255,255,255,.16)', 'stroke-width': 1.4 })); }
  rot.append(svg('circle', { r: 27, fill: 'url(#kn-cap)', stroke: 'rgba(0,0,0,.12)', 'stroke-width': 1 }));
  rot.append(svg('circle', { r: 21, fill: 'none', stroke: 'rgba(0,0,0,.05)', 'stroke-width': 1 }));
  rot.append(svg('line', { x1: 0, y1: -10, x2: 0, y2: -23, stroke: color === 'var(--ink)' ? '#15181A' : color, 'stroke-width': 4, 'stroke-linecap': 'round' }));
  s.append(rot);
  const ring = svg('circle', { r: 47, fill: 'none', stroke: 'transparent', class: 'kn-ring' }); s.append(ring);
  const name = h('span', { class: 'kn-name', text: spec.name }), val = h('span', { class: 'kn-val mono' });
  el.append(s, name); if (size !== 'sm' || true) el.append(val);
  function draw() {
    const n = toN(v), a = -135 + 270 * n;
    rot.setAttribute('transform', `rotate(${a.toFixed(2)})`);
    const a0 = bipolar ? -135 + 270 * toN(0) : -135;
    arc.setAttribute('d', Math.abs(a - a0) < 0.5 ? '' : arcPath(40.5, Math.min(a0, a), Math.max(a0, a)));
    const t = fmt(v, spec.unit, spec); val.textContent = t;
    el.setAttribute('aria-valuenow', +v.toFixed(4)); el.setAttribute('aria-valuetext', t + (spec.unit && !/^[A-Z]/.test(t) ? '' : ''));
  }
  const setV = (nv, commit) => { nv = clamp(nv, min, max); if (nv === v && !commit) return; v = nv; draw(); onInput?.(v); if (commit) onCommit?.(v); };
  let drag = null;
  el.addEventListener('pointerdown', e => { if (e.button) return; el.focus({ preventScroll: true }); el.setPointerCapture(e.pointerId); drag = { y: e.clientY, x: e.clientX, n: toN(v) }; e.preventDefault(); });
  el.addEventListener('pointermove', e => { if (!drag) return; const d = (drag.y - e.clientY) + (e.clientX - drag.x) * 0.5; setV(fromN(drag.n + d / (e.shiftKey ? 900 : 180))); });
  const end = () => { if (drag) { drag = null; onCommit?.(v); } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => setV(def, true));
  let wt = null;
  el.addEventListener('wheel', e => { e.preventDefault(); setV(fromN(toN(v) - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.025))); clearTimeout(wt); wt = setTimeout(() => onCommit?.(v), 350); }, { passive: false });
  el.addEventListener('keydown', e => {
    const st = e.shiftKey ? 0.002 : 0.01, map = { ArrowUp: st, ArrowRight: st, ArrowDown: -st, ArrowLeft: -st, PageUp: 0.1, PageDown: -0.1 };
    if (e.key in map) { const n = toN(v) + map[e.key]; const nv = spec.step ? clamp(v + Math.sign(map[e.key]) * spec.step * (Math.abs(map[e.key]) >= 0.1 ? 5 : 1), min, max) : fromN(n); setV(nv, true); }
    else if (e.key === 'Home') setV(min, true); else if (e.key === 'End') setV(max, true);
    else if (e.key === 'Delete' || e.key === 'Backspace') setV(def, true);
    else return;
    e.preventDefault(); e.stopPropagation();
  });
  draw();
  el.set = nv => { v = clamp(nv, min, max); draw(); };
  el.get = () => v;
  return el;
}

/** Choice parameter as a row of small keys. */
export function options(spec, { value, onCommit, idPrefix = 'o' } = {}) {
  const wrap = h('div', { class: 'field', style: { flexDirection: 'column', alignItems: 'flex-start', gap: '6px' } });
  wrap.append(h('span', { class: 'label', text: spec.name }));
  const row = h('div', { class: 'opt-row', role: 'group', 'aria-label': spec.name });
  spec.options.forEach(o => row.append(h('button', { class: 'key sm', id: `${idPrefix}-${spec.id}-${o.id}`, 'aria-pressed': String(o.id === (value ?? spec.default)), text: o.name,
    onclick: () => { row.querySelectorAll('.key').forEach(b => b.setAttribute('aria-pressed', String(b === row.querySelector(`#${CSS.escape(idPrefix + '-' + spec.id + '-' + o.id)}`)))); onCommit?.(o.id); } })));
  wrap.append(row);
  return wrap;
}

// fader in dB, -60 .. +6
const F_MIN = -60, F_MAX = 6;
const dbToN = db => (db <= F_MIN ? 0 : Math.pow((db - F_MIN) / (F_MAX - F_MIN), 2.2));
const nToDb = n => (n <= 0.0005 ? -60 : F_MIN + Math.pow(n, 1 / 2.2) * (F_MAX - F_MIN));
export function fader({ id, label, value = 0, onInput, onCommit }) {
  let v = value;
  const el = h('div', { class: 'fader', role: 'slider', tabindex: 0, id, 'aria-label': label, 'aria-valuemin': F_MIN, 'aria-valuemax': F_MAX });
  const ticks = h('div', { class: 'ticks' });
  [6, 0, -6, -12, -24, -40].forEach(db => ticks.append(h('i', { style: { top: `${(1 - dbToN(db)) * 100}%`, opacity: db === 0 ? 1 : 0.6 } })));
  const cap = h('div', { class: 'cap' });
  el.append(h('div', { class: 'groove' }), ticks, cap);
  const draw = () => { cap.style.top = `calc(8px + ${(1 - dbToN(v)).toFixed(4)} * (100% - 16px))`; el.setAttribute('aria-valuenow', v.toFixed(1)); el.setAttribute('aria-valuetext', v <= -60 ? '-inf dB' : `${v.toFixed(1)} dB`); };
  const setV = (nv, commit) => { v = Math.round(clamp(nv, F_MIN, F_MAX) * 10) / 10; draw(); onInput?.(v); if (commit) onCommit?.(v); };
  let drag = null;
  el.addEventListener('pointerdown', e => { el.focus({ preventScroll: true }); el.setPointerCapture(e.pointerId); const r = el.getBoundingClientRect(); drag = { y: e.clientY, n: dbToN(v), h: r.height - 16 };
    if (!e.target.classList.contains('cap')) { const n = 1 - (e.clientY - r.top - 8) / (r.height - 16); setV(nToDb(clamp(n, 0, 1))); drag.n = dbToN(v); }
    e.preventDefault(); });
  el.addEventListener('pointermove', e => { if (!drag) return; setV(nToDb(clamp(drag.n + (drag.y - e.clientY) / drag.h / (e.shiftKey ? 4 : 1), 0, 1))); });
  const end = () => { if (drag) { drag = null; onCommit?.(v); } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => setV(0, true));
  let wt; el.addEventListener('wheel', e => { e.preventDefault(); setV(v - Math.sign(e.deltaY) * (e.shiftKey ? 0.1 : 1)); clearTimeout(wt); wt = setTimeout(() => onCommit?.(v), 350); }, { passive: false });
  el.addEventListener('keydown', e => {
    const map = { ArrowUp: 0.5, ArrowRight: 0.5, ArrowDown: -0.5, ArrowLeft: -0.5, PageUp: 3, PageDown: -3 };
    if (e.key in map) setV(v + map[e.key] * (e.shiftKey ? 0.2 : 1), true); else if (e.key === 'Home') setV(F_MIN, true); else if (e.key === 'End') setV(F_MAX, true); else if (e.key === 'Delete') setV(0, true); else return;
    e.preventDefault(); e.stopPropagation();
  });
  draw();
  el.set = nv => { v = nv; draw(); };
  return el;
}

/** LED ladder meter on a canvas. set(peakDb, rmsDb). */
export function meter({ height = 150 } = {}) {
  const wrap = h('div', { class: 'meter', style: { height: height + 'px' } });
  const c = h('canvas', { width: 12 * 2, height: height * 2, 'aria-hidden': 'true' }); wrap.append(c);
  const g = c.getContext('2d'); const N = 26; let hold = -99, holdT = 0, cur = -99;
  wrap.set = (peakDb, rmsDb) => {
    const lv = Math.max(rmsDb + 6, -99); cur = lv > cur ? lv : cur - 1.2;
    if (peakDb > hold || performance.now() - holdT > 1200) { hold = peakDb; holdT = performance.now(); }
    const W = c.width, H = c.height, seg = H / N; g.clearRect(0, 0, W, H);
    for (let i = 0; i < N; i++) {
      const db = -48 + (i + 1) * (48 / N), on = cur >= db, isHold = Math.abs(hold - db) < 48 / N / 2 + 0.01 && hold > -48;
      g.fillStyle = (on || isHold) ? (db > -3 ? '#EC4E20' : db > -12 ? '#F2A900' : '#2E9E6E') : 'rgba(18,22,24,.10)';
      g.fillRect(2, H - (i + 1) * seg + 2, W - 4, seg - 3);
    }
  };
  wrap.set(-99, -99);
  return wrap;
}
