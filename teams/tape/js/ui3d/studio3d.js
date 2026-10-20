// studio3d.js - mounts the Slowreel 3D studio deck (a soft clay tape machine drawn in three.js 0.160.0) behind the
// header. All real controls stay DOM on top of it (keys, LCD, knobs keep their roles, focus and keyboard); the canvas is
// aria-hidden decoration. The drawing happens in a Worker on an OffscreenCanvas (worker3d.js + scene3d.js), so the
// page's main thread only measures the layout on resize and posts a few numbers per frame while music plays.
//
// Setting "3D studio" (on by default, localStorage slowreel:ui3d, ?ui3d=0|1). Off in Light mode. Falls back to the flat
// deck if the browser has no OffscreenCanvas / module workers / WebGL, or if the worker fails or loses its context.
//
// API: mountStudio3D({ S, pcOnly }) -> { frame({playing, frac, level, beat}), setLight(on), settingsRow(), get active() }
import { h } from '../ui/controls.js?v=8';

const PREF = 'slowreel:ui3d';
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { } };
const KNOB_COLORS = { atmosphere: 0xEC4E20, space: 0x2D55D2, volume: 0xF4C77A };
const $ = id => document.getElementById(id);

export function supports3D() {
  try {
    return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && !!HTMLCanvasElement.prototype.transferControlToOffscreen;
  } catch { return false; }
}

export function mountStudio3D({ S, pcOnly = false } = {}) {
  const root = document.documentElement, deck = document.querySelector('.deck');
  const q = new URLSearchParams(location.search);
  let pref = q.get('ui3d') === '0' ? false : q.get('ui3d') === '1' ? true : lsGet(PREF) !== 'off';
  let light = q.get('light') === '1' || (q.get('light') !== '0' && lsGet('slowreel:light') === 'on');
  const supported = supports3D() && !!deck && !pcOnly;
  const phoneMQ = matchMedia('(max-width: 760px)'), reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  let worker = null, wrap = null, ready = false, failed = false, startTimer = 0, initTimer = 0;
  let last = {}, ptrT = 0, ptrTimer = 0, ro = null, mo = null, layoutRaf = 0;
  const statsWait = [];
  // test hook: frames the worker has drawn and whether it is awake (to check that it sleeps)
  window.__ui3d = { stats: () => new Promise(r => { if (!ready) return r(null); statsWait.push(r); post({ cmd: 'stats' }); }) };

  const post = (m, tr) => { try { worker?.postMessage(m, tr || []); } catch (e) { fail(e); } };
  const want = () => supported && pref && !light && !failed;

  function measure() {
    const dr = deck.getBoundingClientRect(), W = Math.max(2, Math.round(dr.width)), H = Math.max(2, Math.round(dr.height));
    const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null; return { x: r.left - dr.left, y: H - (r.bottom - dr.top), w: r.width, h: r.height }; };
    const knobs = [...document.querySelectorAll('#masterctl .knob')].map(k => {
      const id = k.id.replace(/^m-/, ''), r = rect(k.querySelector('svg'));
      return r && { id, x: r.x + r.w / 2, y: r.y + r.h / 2, r: r.w / 2, color: KNOB_COLORS[id] ?? 0xF4C77A };
    }).filter(Boolean);
    return { w: W, h: H, dpr: Math.min(1.5, window.devicePixelRatio || 1),
      layout: { niche: rect($('deck-glass')), lcd: rect(document.querySelector('.lcd .glass')), knobs,
        keys: { play: rect($('t-play')), loop: rect($('t-loop')), rec: rect($('t-rec')) } } };
  }
  function knobValues() {
    const o = {};
    for (const k of document.querySelectorAll('#masterctl .knob')) {
      const mn = +k.getAttribute('aria-valuemin'), mx = +k.getAttribute('aria-valuemax'), v = +k.getAttribute('aria-valuenow');
      if (isFinite(v) && mx > mn) o[k.id.replace(/^m-/, '')] = Math.min(1, Math.max(0, (v - mn) / (mx - mn)));
    }
    return o;
  }
  const pressed = id => $(id)?.getAttribute('aria-pressed') === 'true';
  const isVisible = () => !document.hidden && !phoneMQ.matches;
  function sendState(extra = {}) {
    if (!ready) return;
    post({ cmd: 'state', state: { knobs: knobValues(), loop: pressed('t-loop'), rec: pressed('t-rec'), reduced: reduceMQ.matches, bpm: S?.project?.bpm || 70, ...extra } });
  }
  function relayout() {
    if (layoutRaf) return;
    layoutRaf = requestAnimationFrame(() => { layoutRaf = 0; if (!ready) return; const m = measure(); post({ cmd: 'layout', ...m }); sendState(); });
  }

  // ---------------------------------------------------------------- mount / unmount
  function mount() {
    if (wrap || !want()) return;
    root.classList.add('ui3d');
    wrap = h('div', { class: 'deck3d', 'aria-hidden': 'true' });
    const canvas = h('canvas', { class: 'deck3d-canvas' });
    wrap.append(canvas); deck.prepend(wrap);
    // start once the studio is up and the page is idle (never in the way of boot or the first Play)
    const go = () => {
      startTimer = 0;
      if (!wrap) return;
      if (!S?.project || document.hidden) { startTimer = setTimeout(go, 400); return; }
      (window.requestIdleCallback || (f => setTimeout(f, 1)))(() => start(canvas), { timeout: 1500 });
    };
    startTimer = setTimeout(go, 250);
  }
  function start(canvas) {
    if (!wrap || worker) return;
    let off;
    try {
      off = canvas.transferControlToOffscreen();
      worker = new Worker(new URL('./worker3d.js?v=8', import.meta.url), { type: 'module' });
    } catch (e) { fail(e); return; }
    const me = worker;   // messages from a worker that was already disposed (Light mode, setting off) are ignored
    worker.onerror = ev => { ev.preventDefault?.(); if (me === worker) fail(new Error(ev.message || 'the 3D worker failed to load')); };
    worker.onmessage = ({ data: m }) => {
      if (me !== worker) return;
      if (m.type === 'ready') {
        clearTimeout(initTimer); ready = true; root.classList.add('ui3d-ready'); if (m.soft) root.classList.add('ui3d-soft');
        relayout(); sendState(); post({ cmd: 'visible', v: isVisible() });
      } else if (m.type === 'error') { if (m.init || !ready) fail(new Error(m.message)); else console.warn('[slowreel] 3D deck:', m.message); }
      else if (m.type === 'lost') fail(new Error('the 3D deck lost its WebGL context'));
      else if (m.type === 'stats') { statsWait.splice(0).forEach(f => f(m)); }
    };
    initTimer = setTimeout(() => fail(new Error('the 3D deck did not start in time')), 25000);
    const m = measure();
    post({ cmd: 'init', canvas: off, ...m, forceSoft: q.get('ui3d') === 'soft',
      state: { knobs: knobValues(), loop: pressed('t-loop'), rec: pressed('t-rec'), reduced: reduceMQ.matches, bpm: S?.project?.bpm || 70, playing: !!S?.playing } }, [off]);
  }
  function unmount() {
    clearTimeout(startTimer); clearTimeout(initTimer); startTimer = initTimer = 0;
    if (worker) { try { worker.postMessage({ cmd: 'dispose' }); } catch { } const w = worker; setTimeout(() => w.terminate(), 400); }
    worker = null; ready = false; last = {};
    wrap?.remove(); wrap = null;
    root.classList.remove('ui3d', 'ui3d-ready', 'ui3d-soft');
  }
  function fail(e) {
    if (failed) return;
    failed = true;
    console.warn('[slowreel] 3D studio unavailable, using the flat deck:', e?.message || e);
    unmount();
  }
  const sync = () => (want() ? mount() : unmount());

  // ---------------------------------------------------------------- observers (layout, knobs, keys, pointer, visibility)
  if (supported) {
    ro = new ResizeObserver(relayout); [deck, $('deck-glass'), $('masterctl'), document.querySelector('.transport')].forEach(e => e && ro.observe(e));
    const mc = $('masterctl');
    if (mc) { mo = new MutationObserver(recs => { if (recs.some(r => r.type === 'childList')) relayout(); else sendState(); }); mo.observe(mc, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-valuenow'] }); }
    const tr = document.querySelector('.transport');
    if (tr) new MutationObserver(() => sendState()).observe(tr, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
    const sendPtr = () => { ptrTimer = 0; ptrT = performance.now(); post({ cmd: 'state', state: { px: last.px, py: last.py } }); };
    window.addEventListener('pointermove', e => {
      if (!ready || e.pointerType === 'touch') return;
      last.px = Math.max(-1, Math.min(1, (e.clientX / innerWidth) * 2 - 1)); last.py = Math.max(-1, Math.min(1, 1 - (e.clientY / innerHeight) * 2));
      const dt = performance.now() - ptrT;
      if (dt >= 40) sendPtr(); else if (!ptrTimer) ptrTimer = setTimeout(sendPtr, 40 - dt);
    }, { passive: true });
    const vis = () => { if (ready) post({ cmd: 'visible', v: isVisible() }); if (isVisible()) relayout(); };
    document.addEventListener('visibilitychange', vis); phoneMQ.addEventListener?.('change', vis);
    reduceMQ.addEventListener?.('change', () => sendState());
    document.fonts?.ready?.then(relayout);
  }
  sync();

  return {
    get active() { return ready; },
    /** Called from the studio's visual loop (30 fps while something sounds) and from drawIdle. Cheap: one small postMessage. */
    frame({ playing = false, frac = 0, level = 0, beat = 0 } = {}) {
      if (!ready) return;
      if (playing === last.playing && Math.abs(frac - (last.frac ?? -1)) < 1e-5 && Math.abs(level - (last.level ?? -1)) < 0.002) return;
      last.playing = playing; last.frac = frac; last.level = level;
      post({ cmd: 'state', state: { playing, frac, level, beat, rec: !!S?.rec, bpm: S?.project?.bpm || 70 } });
    },
    setLight(on) { light = !!on; sync(); },
    /** The "3D studio" row for the Settings pop-over. */
    settingsRow() {
      const btn = h('button', { class: 'key led-green', id: 'set-ui3d', 'aria-pressed': String(want() || (pref && !light && supported && !failed)), disabled: !supported || failed || undefined,
        onclick: () => { pref = !pref; lsSet(PREF, pref ? 'on' : 'off'); btn.setAttribute('aria-pressed', String(pref)); sync(); } }, h('span', { class: 'led' }), '3D studio');
      const why = !supported ? 'This browser cannot draw the 3D deck, so Slowreel shows the flat one.'
        : failed ? 'The 3D deck could not start here, so Slowreel shows the flat one.'
        : light ? 'The 3D deck rests while Light mode is on.'
        : 'The clay tape machine with the lamp and the fox. It is drawn off the main thread and sleeps when nothing moves.';
      return h('div', { class: 'set-row set-ui3d' }, btn, h('p', { class: 'pm-note', text: why }));
    },
  };
}
