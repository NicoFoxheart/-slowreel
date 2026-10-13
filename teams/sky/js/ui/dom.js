// dom.js - tiny DOM helpers, icons and the toast.

export function h(tag, attrs = {}, ...kids) {
  const el = tag === 'svg' || tag === 'path' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.entries(v).forEach(([p, x]) => (p.startsWith('--') ? el.style.setProperty(p, x) : (el.style[p] = x)));
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const P = {
  plus: 'M10 4v12M4 10h12', trash: 'M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6', copy: 'M7 7h8v9H7zM5 13V4h8',
  up: 'M10 15V5M5.5 9.5 10 5l4.5 4.5', down: 'M10 5v10M5.5 10.5 10 15l4.5-4.5', power: 'M10 3.5v6M6 6a5.5 5.5 0 1 0 8 0',
  pen: 'M4 16l1-4 8-8 3 3-8 8zM11.5 5.5l3 3', arrow: 'M5 3.5l10 6-4.5 1.2L8.3 15z', close: 'M5 5l10 10M15 5 5 15',
  play: 'M6.5 4.2v11.6L16 10z', stop: 'M5.5 5.5h9v9h-9z', file: 'M5 3h7l3 3v11H5zM12 3v3h3', folder: 'M3 6h5l2 2h7v8H3z',
  edit: 'M4 16h3l8-8-3-3-8 8zM11 6l3 3', dup: 'M7 7h8v9H7zM5 13V4h8', sun: 'M10 6.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2',
  cloud: 'M5.5 14.5h9a3 3 0 0 0 .3-6 4.5 4.5 0 0 0-8.6-1A3.5 3.5 0 0 0 5.5 14.5z', save: 'M4 4h10l2 2v10H4zM7 4v4h6V4M7 16v-5h6v5',
  wave: 'M3 10h2l1.5-4 2 8 2-10 2 12 2-8 1.5 2H17', star: 'M10 3l1.8 4.6 4.7.4-3.6 3 1.1 4.7L10 13.2 5.9 15.7 7 11 3.5 8l4.7-.4z',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 20 20'); s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', P[name] || ''); p.setAttribute('fill', name === 'play' || name === 'stop' ? 'currentColor' : 'none');
  p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.6'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  s.append(p); return s;
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/** Drag helper with pointer capture. onMove(dx, dy, ev), onEnd(ev, moved). */
export function drag(ev, { onMove, onEnd, cursor } = {}) {
  const x0 = ev.clientX, y0 = ev.clientY, target = ev.currentTarget || ev.target; let moved = false;
  try { target.setPointerCapture?.(ev.pointerId); } catch { /* synthetic */ }
  if (cursor) document.body.style.cursor = cursor;
  const mv = e => { const dx = e.clientX - x0, dy = e.clientY - y0; if (Math.abs(dx) + Math.abs(dy) > 2) moved = true; onMove?.(dx, dy, e); };
  const up = e => { target.removeEventListener('pointermove', mv); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); document.body.style.cursor = ''; onEnd?.(e, moved); };
  target.addEventListener('pointermove', mv); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
}

export const fmtTime = s => { s = Math.max(0, s); const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
export const fmtTimeTenths = s => { s = Math.max(0, s); const m = Math.floor(s / 60); return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
export const isTyping = el => !!el && (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(el.type) || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
