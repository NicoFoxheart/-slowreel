// recipes-panel.js - the "Recipes" browser: one-click starter projects that teach (data in ../recipes/recipes.js).
// Plain DOM, standalone (no studio state), styled by css/recipes.css with the tokens of css/studio.css.
//
//   import { openRecipes } from './js/ui/recipes-panel.js';
//   openRecipes({ onLoad: async (project, recipe) => { await loadIntoStudio(project); } });
//
// openRecipes({onLoad, recipes?, region?, selected?, tips? = true}) -> {close(), element}
//   A modal browser: cards grouped by region (filter: All / Korea / China / Japan / Ambient basics), each with mood,
//   BPM, key, scale, length, layers and its tips; a side panel shows the selected recipe's tips in full.
//   "Load recipe" calls onLoad(project, recipe) with a fresh deep copy of the project (new id, createdAt/updatedAt = now),
//   waits for it (a thrown error is shown in the panel), closes the browser and opens the "Tips while you play" panel.
// openTips(recipe | id, {onReopen?}) -> {close(), element}
//   The floating, non-modal tips panel (keeps the steps visible while you play): tick each tip as you try it (remembered
//   per recipe in this browser), Prev / Next highlights one tip at a time, collapse to a small bar, "All recipes" reopens.
// closeRecipes(), closeTips(), isRecipesOpen()
import { RECIPES, REGIONS, SCALE_LABELS, recipeProject } from '../recipes/recipes.js?v=9b';

const REGION_COLOR = { korea: 'var(--signal)', china: 'var(--saffron)', japan: 'var(--cobalt)', ambient: 'var(--leaf)', garage: '#7A63C8' };
let modal = null, dock = null, uidN = 0;
const uid = p => `${p}-${++uidN}`;

// ---------------------------------------------------------------- tiny DOM helper
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) e.style.setProperty(sk, sv);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const svgIcon = d => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.6'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); s.append(p); return s; };
const I = { close: 'M4 4l8 8M12 4l-8 8', chevron: 'M4 6l4 4 4-4', book: 'M3 3h4a2 2 0 012 2v8a1.5 1.5 0 00-1.5-1.5H3zM13 3H9a2 2 0 00-2 2', prev: 'M10 4L6 8l4 4', next: 'M6 4l4 4-4 4' };

function ensureCss() {
  if (document.querySelector('link[data-recipes-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('../../css/recipes.css?v=9b', import.meta.url).href; l.setAttribute('data-recipes-css', '');
  // after the page's own stylesheets (in the published artifact they sit in <body>), so recipes.css wins the cascade
  const sheets = document.querySelectorAll('link[rel="stylesheet"], style');
  const last = sheets[sheets.length - 1];
  if (last && last.parentNode) last.after(l); else document.head.append(l);
}
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('slowreel.recipes.' + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('slowreel.recipes.' + k, JSON.stringify(v)); } catch (e) { /* private mode: fine */ } },
};

// ---------------------------------------------------------------- facts shown on cards and panels
const seconds = r => (r.project.lengthBars * r.project.beatsPerBar * 60) / r.bpm;
const fmtLen = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const scaleName = id => SCALE_LABELS[id] || id;
const regionName = id => (REGIONS.find(r => r.id === id) || { name: id }).name;
const layers = r => r.project.tracks.map(t => t.name);
function lcd(r, small = false) {
  const f = (k, v) => h('span', { class: 'rc-f' }, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v }));
  return h('div', { class: 'glass rc-lcd' + (small ? ' sm' : '') },
    f('BPM', String(r.bpm)), f('KEY', r.key), f('SCALE', r.scaleName || scaleName(r.scale)), f('LEN', `${r.project.lengthBars} bars · ${fmtLen(seconds(r))}`));
}

// keeps keystrokes inside a panel from reaching the studio's global shortcuts (Space = play, letters = QWERTY piano)
const shield = (el, all) => el.addEventListener('keydown', e => {
  if (all || e.key === ' ' || e.key === 'Enter') e.stopPropagation();
});

// ---------------------------------------------------------------- the browser (modal)
export function openRecipes({ onLoad, recipes = RECIPES, region = 'all', selected, tips = true } = {}) {
  ensureCss();
  closeRecipes();
  const lastFocus = document.activeElement;
  let sel = recipes.find(r => r.id === (selected || store.get('last'))) || recipes[0];
  let filter = REGIONS.some(r => r.id === region) ? region : 'all';
  let busy = false;

  const titleId = uid('rc-title'), sideId = uid('rc-side');
  const status = h('p', { class: 'rc-status', role: 'status', 'aria-live': 'polite' });
  const side = h('aside', { class: 'rc-side', id: sideId, 'aria-label': 'Tips while you play' });
  const list = h('div', { class: 'rc-list' });
  const filterKeys = [{ id: 'all', name: 'All' }, ...REGIONS].map(r =>
    h('button', { class: 'key sm rc-fk', type: 'button', 'data-region': r.id, 'aria-pressed': String(filter === r.id), style: r.id !== 'all' ? { '--rc': REGION_COLOR[r.id] } : undefined,
      onclick: () => { filter = r.id; renderList(); } }, r.id !== 'all' ? h('i', { class: 'rc-dot', 'aria-hidden': 'true' }) : null, r.name));
  const closeBtn = h('button', { class: 'key sq', type: 'button', 'aria-label': 'Close recipes', onclick: () => close() }, svgIcon(I.close));

  const dialog = h('div', { class: 'dialog rc-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('header', {},
      h('div', { class: 'rc-head' },
        h('h2', { id: titleId }, 'Recipes'),
        h('p', { class: 'label', text: `${recipes.length} starter tapes that teach · pick one, load it, play` })),
      h('div', { class: 'rc-filter', role: 'group', 'aria-label': 'Show region' }, filterKeys),
      closeBtn),
    h('div', { class: 'rc-body' }, list, side));
  const scrim = h('div', { class: 'scrim rc-scrim' }, dialog);
  scrim.addEventListener('pointerdown', e => { if (e.target === scrim && !busy) close(); });
  shield(scrim, true);
  scrim.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !busy) { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') trapTab(e, dialog);
  });

  function card(r) {
    const tid = uid('rc-card');
    const isSel = sel && sel.id === r.id;
    return h('li', { class: 'rc-item' },
      h('article', { class: 'rc-card' + (isSel ? ' sel' : ''), 'aria-labelledby': tid, style: { '--rc': REGION_COLOR[r.region] }, 'data-recipe': r.id },
        h('div', { class: 'rc-strip' }, h('span', { text: regionName(r.region) }), h('span', { class: 'mono', text: `${r.project.tracks.length} layers` })),
        h('div', { class: 'rc-card-in' },
          h('h4', { id: tid, class: 'rc-title', text: r.title }),
          h('p', { class: 'rc-mood', text: r.mood }),
          lcd(r),
          h('p', { class: 'rc-layers' }, h('span', { class: 'label', text: 'Layers' }), ' ', layers(r).join(' · ')),
          h('details', { class: 'rc-peek' },
            h('summary', {}, h('span', { text: `${r.steps.length} tips` }), svgIcon(I.chevron)),
            h('ol', { class: 'rc-peek-list' }, r.steps.map(s => h('li', { text: s })))),
          h('div', { class: 'rc-actions' },
            h('button', { class: 'key sm', type: 'button', 'aria-pressed': String(isSel), 'aria-controls': sideId,
              onclick: () => { select(r); if (matchMedia('(max-width: 900px)').matches) side.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } },
              svgIcon(I.book), 'Tips'),
            h('button', { class: 'key dark rc-load', type: 'button', 'aria-describedby': tid, onclick: () => load(r) }, 'Load recipe')))));
  }

  function renderList() {
    filterKeys.forEach(k => k.setAttribute('aria-pressed', String(k.dataset.region === filter)));
    const keepScroll = list.scrollTop;
    list.replaceChildren(...REGIONS.filter(g => filter === 'all' || g.id === filter).map(g => {
      const rs = recipes.filter(r => r.region === g.id); if (!rs.length) return null;
      const hid = uid('rc-region');
      return h('section', { class: 'rc-region', 'aria-labelledby': hid, style: { '--rc': REGION_COLOR[g.id] } },
        h('div', { class: 'rc-region-head' }, h('h3', { id: hid }, h('i', { class: 'rc-dot', 'aria-hidden': 'true' }), g.name), h('p', { text: g.blurb })),
        h('ul', { class: 'rc-cards', role: 'list' }, rs.map(card)));
    }).filter(Boolean));
    list.scrollTop = keepScroll;
  }

  function renderSide() {
    if (!sel) { side.replaceChildren(h('p', { class: 'rc-empty', text: 'Pick a recipe to see its tips.' })); return; }
    const r = sel;
    side.style.setProperty('--rc', REGION_COLOR[r.region]);
    side.replaceChildren(
      h('p', { class: 'label', text: 'Tips while you play' }),
      h('h3', { class: 'rc-side-title', text: r.title }),
      h('p', { class: 'rc-mood', text: `${regionName(r.region)} · ${r.mood}` }),
      lcd(r, true),
      h('ol', { class: 'rc-steps' }, r.steps.map((s, i) => h('li', {}, h('span', { class: 'rc-n mono', 'aria-hidden': 'true', text: String(i + 1) }), h('span', { text: s })))),
      h('div', { class: 'rc-side-foot' },
        h('button', { class: 'key signal rc-load-big', type: 'button', onclick: () => load(r) }, `Load "${r.title}"`),
        h('p', { class: 'rc-note', text: 'Loads as a new project. The tips stay on screen while you play.' }),
        status));
  }

  function select(r) {
    sel = r; store.set('last', r.id);
    list.querySelectorAll('.rc-card').forEach(c => {
      const on = c.dataset.recipe === r.id; c.classList.toggle('sel', on);
      c.querySelector('[aria-controls]')?.setAttribute('aria-pressed', String(on));
    });
    renderSide();
  }

  async function load(r) {
    if (busy) return;
    if (sel?.id !== r.id) select(r);
    busy = true; dialog.setAttribute('aria-busy', 'true');
    dialog.querySelectorAll('.rc-load, .rc-load-big').forEach(b => { b.disabled = true; });
    status.className = 'rc-status'; status.textContent = `Loading "${r.title}"...`;
    try {
      const project = recipeProject(r);
      if (typeof onLoad === 'function') await onLoad(project, r);
      busy = false;
      if (tips) openTips(r, { onReopen: () => openRecipes({ onLoad, recipes, region: filter, selected: r.id, tips }) });
      close(!tips);
    } catch (e) {
      console.warn('[recipes] load failed', e);
      busy = false; dialog.removeAttribute('aria-busy');
      dialog.querySelectorAll('.rc-load, .rc-load-big').forEach(b => { b.disabled = false; });
      status.className = 'rc-status err'; status.textContent = `Could not load this recipe: ${e?.message || e}`;
    }
  }

  function close(restore = true) {
    if (!scrim.isConnected) return;
    scrim.remove(); if (modal?.scrim === scrim) modal = null;
    if (restore) lastFocus?.focus?.();
    else if (dock?.element?.isConnected) dock.element.querySelector('h2')?.focus?.();
  }

  renderList(); renderSide();
  document.body.append(scrim);
  modal = { scrim, close };
  (dialog.querySelector('.rc-card.sel .rc-load') || closeBtn).focus();
  dialog.querySelector('.rc-card.sel')?.scrollIntoView({ block: 'nearest' });
  return { close: () => close(), element: scrim };
}
export function closeRecipes() { modal?.close(); modal = null; }
export const isRecipesOpen = () => !!modal?.scrim?.isConnected;

function trapTab(e, root) {
  const f = [...root.querySelectorAll('button:not([disabled]), summary, input, [tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ---------------------------------------------------------------- "Tips while you play" (floating, non-modal)
export function openTips(recipeOrId, { onReopen, label = 'Tips while you play' } = {}) {
  ensureCss();
  const r = typeof recipeOrId === 'string' ? RECIPES.find(x => x.id === recipeOrId) : recipeOrId;
  if (!r) return null;
  closeTips();
  const done = new Set(store.get('done.' + r.id) || []);
  let cur = Math.min(Math.max(0, r.steps.findIndex((_, i) => !done.has(i))), r.steps.length - 1);
  let collapsed = !!store.get('collapsed');
  const titleId = uid('rc-dock-title'), bodyId = uid('rc-dock-body');

  const count = h('span', { class: 'rc-count mono', 'aria-live': 'polite' });
  const items = r.steps.map((s, i) => {
    const id = uid('rc-tip');
    const box = h('input', { type: 'checkbox', id, checked: done.has(i) ? true : undefined,
      onchange: () => { box.checked ? done.add(i) : done.delete(i); store.set('done.' + r.id, [...done]); if (box.checked && i === cur) step(1, true); sync(); } });
    return h('li', { class: 'rc-tip', 'data-i': String(i) }, box, h('label', { for: id }, h('span', { class: 'rc-n mono', 'aria-hidden': 'true', text: String(i + 1) }), h('span', { text: s })));
  });
  const prev = h('button', { class: 'key sm sq', type: 'button', 'aria-label': 'Previous tip', onclick: () => step(-1) }, svgIcon(I.prev));
  const next = h('button', { class: 'key sm', type: 'button', onclick: () => step(1) }, 'Next tip', svgIcon(I.next));
  const collapseBtn = h('button', { class: 'key sm sq rc-collapse', type: 'button', 'aria-controls': bodyId, onclick: () => { collapsed = !collapsed; store.set('collapsed', collapsed); sync(); } }, svgIcon(I.chevron));
  const body = h('div', { class: 'rc-dock-body', id: bodyId },
    lcd(r, true),
    h('ol', { class: 'rc-steps rc-checks' }, items),
    h('div', { class: 'rc-dock-foot' }, prev, next, h('span', { class: 'grow' }),
      onReopen ? h('button', { class: 'key sm', type: 'button', onclick: () => { onReopen(); } }, svgIcon(I.book), 'All recipes') : null));
  const el = h('aside', { class: 'rc-dock', 'aria-labelledby': titleId, style: { '--rc': REGION_COLOR[r.region] } },
    h('header', { class: 'rc-dock-head' },
      h('div', { class: 'rc-dock-titles' },
        h('p', { class: 'label' }, label + ' ', count),
        h('h2', { id: titleId, tabindex: '-1', text: r.title })),
      collapseBtn,
      h('button', { class: 'key sm sq', type: 'button', 'aria-label': 'Close tips', onclick: () => close() }, svgIcon(I.close))),
    body);
  shield(el, false);

  function step(d, quiet) {
    cur = (cur + d + r.steps.length) % r.steps.length; sync();
    if (!quiet) items[cur].querySelector('input').focus();
  }
  function sync() {
    items.forEach((li, i) => { li.classList.toggle('cur', i === cur); li.classList.toggle('done', done.has(i)); if (i === cur) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
    count.textContent = `${done.size}/${r.steps.length} tried`;
    el.classList.toggle('collapsed', collapsed); body.hidden = collapsed;
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    collapseBtn.setAttribute('aria-label', collapsed ? 'Show tips' : 'Hide tips');
  }
  function close() { el.remove(); if (dock?.element === el) dock = null; }

  sync();
  document.body.append(el);
  dock = { element: el, close, recipe: r };
  return { close, element: el };
}
export function closeTips() { dock?.close(); dock = null; }
