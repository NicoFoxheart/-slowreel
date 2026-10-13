// Tiny DOM helpers + the icon set (hand-drawn 20px line icons, 1.5px stroke, round caps).
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const uid = (p = 'x') => `${p}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
export const fmtTime = s => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
export const fmtDb = db => (!isFinite(db) || db <= -80 ? '-inf' : (db > 0 ? '+' : '') + db.toFixed(1));
export function fmtVal(v, unit) {
  if (typeof v !== 'number') return String(v);
  const a = Math.abs(v); const n = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  if (unit === '%') return Math.round(v * (Math.abs(v) <= 1 ? 100 : 1)) + '%';
  if (unit === 'Hz' && a >= 1000) return (v / 1000).toFixed(1) + ' kHz';
  if (unit === 's' && a < 1) return Math.round(v * 1000) + ' ms';
  return unit ? `${n} ${unit}` : n;
}
const P = d => `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  play: P('<path d="M6.5 4.5v11l9-5.5z" fill="currentColor" stroke="none"/>'),
  pause: P('<path d="M7 4.5v11M13 4.5v11" stroke-width="2.2"/>'),
  stop: P('<rect x="5.5" y="5.5" width="9" height="9" rx="1.2" fill="currentColor" stroke="none"/>'),
  rewind: P('<path d="M5 4.5v11"/><path d="M15.5 5l-7.5 5 7.5 5z" fill="currentColor" stroke="none"/>'),
  loop: P('<path d="M4 9.5V8a2.5 2.5 0 0 1 2.5-2.5h8L12.5 3.5M16 10.5V12a2.5 2.5 0 0 1-2.5 2.5h-8l2 2"/>'),
  rec: P('<circle cx="10" cy="10" r="4.6" fill="currentColor" stroke="none"/>'),
  plus: P('<path d="M10 4.5v11M4.5 10h11"/>'),
  minus: P('<path d="M4.5 10h11"/>'),
  close: P('<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>'),
  menu: P('<path d="M4 6h12M4 10h12M4 14h8"/>'),
  undo: P('<path d="M7.5 5L4 8.5 7.5 12"/><path d="M4.5 8.5H12a4 4 0 0 1 0 8H9"/>'),
  redo: P('<path d="M12.5 5L16 8.5 12.5 12"/><path d="M15.5 8.5H8a4 4 0 0 0 0 8h3"/>'),
  export: P('<path d="M10 3.5v9M6.5 9l3.5 3.5L13.5 9"/><path d="M4 13.5v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2"/>'),
  keys: P('<rect x="3" y="5" width="14" height="10" rx="1.5"/><path d="M7 5v6M10 5v6M13 5v6"/>'),
  wave: P('<path d="M3 10h1.5M6 7v6M8.5 4.5v11M11 7.5v5M13.5 6v8M16 9v2"/>'),
  piano: P('<rect x="3.5" y="4" width="13" height="12" rx="1.5"/><path d="M7.5 4v7M12.5 4v7M10 11v5M7.5 11v5M12.5 11v5"/>'),
  sliders: P('<path d="M6 4v12M14 4v12M10 4v12"/><circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="10" cy="7" r="1.6" fill="currentColor"/><circle cx="14" cy="11" r="1.6" fill="currentColor"/>'),
  drop: P('<path d="M10 3.5c3 3.7 4.5 6.3 4.5 8.3a4.5 4.5 0 0 1-9 0c0-2 1.5-4.6 4.5-8.3z"/>'),
  window: P('<rect x="4" y="3.5" width="12" height="13" rx="1"/><path d="M10 3.5v13M4 10h12"/>'),
  phone: P('<rect x="6" y="3" width="8" height="14" rx="1.6"/><path d="M9 14.5h2"/>'),
  trash: P('<path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6"/>'),
  copy: P('<rect x="7" y="7" width="9" height="9" rx="1.2"/><path d="M13 7V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2"/>'),
  folder: P('<path d="M3.5 6a1 1 0 0 1 1-1H8l1.5 1.5h6a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/>'),
  edit: P('<path d="M12.5 4.5l3 3L8 15H5v-3z"/>'),
  check: P('<path d="M4.5 10.5l3.5 3.5 7.5-8"/>'),
  up: P('<path d="M6 12l4-4 4 4"/>'),
  down: P('<path d="M6 8l4 4 4-4"/>'),
  power: P('<path d="M10 3.5V10"/><path d="M6.2 6a5.5 5.5 0 1 0 7.6 0"/>'),
  cloud: P('<path d="M6 15h8.5a3 3 0 0 0 .3-6 4.5 4.5 0 0 0-8.6-1A3.5 3.5 0 0 0 6 15z"/>'),
  zoomIn: P('<circle cx="9" cy="9" r="5"/><path d="M13 13l3.5 3.5M9 7v4M7 9h4"/>'),
  zoomOut: P('<circle cx="9" cy="9" r="5"/><path d="M13 13l3.5 3.5M7 9h4"/>'),
  magnet: P('<path d="M5 4v6a5 5 0 0 0 10 0V4"/><path d="M5 7h3M12 7h3"/>'),
  pencil: P('<path d="M12.5 4.5l3 3L8 15H5v-3z"/>'),
  chord: P('<circle cx="7" cy="14" r="2"/><circle cx="13" cy="11" r="2"/><circle cx="10" cy="6" r="2"/>'),
  listen: P('<path d="M4 12v-1a6 6 0 0 1 12 0v1"/><rect x="3.5" y="11.5" width="3" height="5" rx="1"/><rect x="13.5" y="11.5" width="3" height="5" rx="1"/>'),
  pads: P('<rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1"/><rect x="11" y="3.5" width="5.5" height="5.5" rx="1"/><rect x="3.5" y="11" width="5.5" height="5.5" rx="1"/><rect x="11" y="11" width="5.5" height="5.5" rx="1"/>'),
  song: P('<path d="M8 14.5V5l8-1.5v9.5"/><circle cx="6" cy="14.5" r="2"/><circle cx="14" cy="13" r="2"/>'),
  fx: P('<path d="M4 15c2-6 3-9 6-9M10 6c3 0 4 3 6 9"/><circle cx="10" cy="6" r="1.4" fill="currentColor"/>'),
};
export const icon = (name, cls = '') => h('span', { class: 'ico ' + cls, html: ICON[name] || '' });
// The Lamplit mark: a window with four panes, the lamp's glow in the lower-left pane, one heart-shaped raindrop.
export const MARK = `<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><defs><radialGradient id="lg" cx="30%" cy="72%" r="60%"><stop offset="0" stop-color="#ffd9a3"/><stop offset=".45" stop-color="#f2b56b" stop-opacity=".55"/><stop offset="1" stop-color="#f2b56b" stop-opacity="0"/></radialGradient></defs><rect x="4" y="3" width="24" height="26" rx="2.5" fill="#1b2531" stroke="#8fb4cc" stroke-opacity=".55" stroke-width="1.2"/><rect x="4" y="3" width="24" height="26" rx="2.5" fill="url(#lg)"/><path d="M16 3v26M4 16h24" stroke="#8fb4cc" stroke-opacity=".55" stroke-width="1.2"/><path d="M22.6 8.4c-.9-1-2.4-.5-2.4.8 0 1.3 1.6 2.4 2.4 3.4.8-1 2.4-2.1 2.4-3.4 0-1.3-1.5-1.8-2.4-.8z" fill="#e6e1d6" opacity=".9"/></svg>`;

// A wordless dialog/popover manager: one open popover at a time, Escape closes, focus returns.
let openPop = null;
export function closePopover() { if (openPop) { const { el, back } = openPop; openPop = null; el.remove(); back?.focus?.(); } }
export function popover(anchor, content, { align = 'left', cls = '' } = {}) {
  closePopover();
  const el = h('div', { class: 'popover ' + cls, role: 'dialog' }, content);
  document.body.append(el);
  const r = anchor.getBoundingClientRect(); const w = el.offsetWidth, hh = el.offsetHeight;
  let x = align === 'right' ? r.right - w : r.left; x = clamp(x, 8, innerWidth - w - 8);
  let y = r.bottom + 6; if (y + hh > innerHeight - 8) y = Math.max(8, r.top - hh - 6);
  el.style.left = x + 'px'; el.style.top = y + 'px';
  openPop = { el, back: anchor };
  requestAnimationFrame(() => (el.querySelector('[autofocus],button,input,select,[tabindex="0"]'))?.focus());
  return el;
}
addEventListener('pointerdown', e => { if (openPop && !openPop.el.contains(e.target) && !openPop.back.contains(e.target)) closePopover(); }, true);
addEventListener('keydown', e => { if (e.key === 'Escape' && openPop) { e.stopPropagation(); closePopover(); } }, true);

// Toasts: one quiet line at the bottom of the window band.
let toastT;
export function toast(msg, kind = '') {
  const el = document.getElementById('toast'); if (!el) return;
  el.textContent = msg; el.className = 'toast show ' + kind; clearTimeout(toastT);
  toastT = setTimeout(() => (el.className = 'toast ' + kind), 2600);
}
