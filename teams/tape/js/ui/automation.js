// automation.js - automation lanes: data helpers + engine scheduling (no DOM needed) + the breakpoint editor drawn under a track.
// Project format (per track): track.automation = [{target, param, points: [{beat, value}], curve?: 'linear' | 'smooth'}]
//   target 'track'      param 'volumeDb' (dB, -60..6) | 'pan' (-1..1) | 'sends.space' | 'sends.echo' (0..1.5)
//   target 'instrument' param = any instrument param id (macro or param), in that param's own units
//   target 'fx:<index>' param = an effect param id of track.fx[index]
// Values are stored in the param's own units, so a lane reads like the knob it moves.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const dbToGain = db => (db <= -59.9 ? 0 : Math.pow(10, db / 20));
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

export const TRACK_AUTOMATION_PARAMS = [
  { target: 'track', param: 'volumeDb', name: 'Volume', min: -60, max: 6, default: 0, unit: 'dB' },
  { target: 'track', param: 'pan', name: 'Pan', min: -1, max: 1, default: 0, unit: 'pan' },
  { target: 'track', param: 'sends.space', name: 'Space send', min: 0, max: 1.5, default: 0.3, unit: '' },
  { target: 'track', param: 'sends.echo', name: 'Echo send', min: 0, max: 1.5, default: 0, unit: '' },
];

/** Every automatable param of a track: [{key, target, param, name, group, min, max, default, unit, scale}].
 *  defs = {instruments, effects} (engine.instruments / engine.effects, round-2 defs included). Enums and toggles are left out. */
export function automationTargets(track, defs = {}) {
  const out = TRACK_AUTOMATION_PARAMS.map(p => ({ ...p, key: 'track|' + p.param, group: 'Mixer' }));
  const numeric = p => !(p.type === 'enum' || p.type === 'toggle' || Array.isArray(p.options) || typeof p.default === 'string');
  if (track?.kind !== 'song' && track?.instrument) {
    const inst = (defs.instruments || []).find(i => i.id === track.instrument.id);
    for (const p of inst?.params || []) if (numeric(p)) out.push({ key: 'instrument|' + p.id, target: 'instrument', param: p.id, name: p.name, group: inst.name, min: p.min, max: p.max, default: p.default, unit: p.unit || '', scale: p.scale, step: p.step });
  }
  (track?.fx || []).forEach((f, i) => {
    const d = (defs.effects || []).find(e => e.id === f.id);
    for (const p of d?.params || []) if (numeric(p)) out.push({ key: `fx:${i}|${p.id}`, target: 'fx:' + i, param: p.id, name: p.name, group: `${i + 1}. ${d.name}`, min: p.min, max: p.max, default: p.default, unit: p.unit || '', scale: p.scale, step: p.step });
  });
  return out;
}

export const laneKey = l => `${l.target}|${l.param}`;
export function findLane(track, target, param) { return (track?.automation || []).find(l => l.target === target && l.param === param) || null; }
/** Get or create a lane (mutates track). */
export function ensureLane(track, target, param, curve = 'linear') {
  track.automation = track.automation || [];
  let l = findLane(track, target, param);
  if (!l) { l = { target, param, points: [], curve }; track.automation.push(l); }
  return l;
}
const sorted = l => (l.points || []).slice().sort((a, b) => a.beat - b.beat);
const smooth = x => x * x * (3 - 2 * x);

/** Value of a lane at a beat (holds the first / last point outside the range). null if the lane has no points. */
export function laneValueAt(lane, beat) {
  const pts = lane._sorted && lane._sortedN === lane.points.length ? lane._sorted : sorted(lane);
  if (!pts.length) return null;
  if (beat <= pts[0].beat) return pts[0].value;
  const last = pts[pts.length - 1]; if (beat >= last.beat) return last.value;
  let i = 1; while (pts[i].beat < beat) i++;
  const a = pts[i - 1], b = pts[i], x = (beat - a.beat) / Math.max(1e-9, b.beat - a.beat);
  return a.value + (b.value - a.value) * (lane.curve === 'smooth' ? smooth(x) : x);
}

/** Instrument params at a beat with the instrument lanes applied (for the scheduler, per note). Returns `params` itself if no lane. */
export function instrumentParamsAt(track, params, beat) {
  const lanes = (track?.automation || []).filter(l => l.target === 'instrument' && l.points?.length);
  if (!lanes.length) return params;
  const out = { ...params };
  for (const l of lanes) { const v = laneValueAt(l, beat); if (v !== null) out[l.param] = v; }
  return out;
}

// Where a lane lands in the engine. rt = the engine's track runtime {fader, panner, sendSpace, sendEcho, fx[], params}.
function resolveTarget(rt, lane) {
  if (!rt) return null;
  if (lane.target === 'track') {
    const m = { volumeDb: [rt.fader?.gain, dbToGain, true], pan: [rt.panner?.pan, v => clamp(v, -1, 1)], 'sends.space': [rt.sendSpace?.gain, v => clamp(v, 0, 1.5)], 'sends.echo': [rt.sendEcho?.gain, v => clamp(v, 0, 1.5)] }[lane.param];
    return m && m[0] ? { param: m[0], map: m[1], curved: !!m[2] } : null;
  }
  if (lane.target === 'instrument') return rt.params ? { step: v => { rt.params[lane.param] = v; } } : null;
  const mt = /^fx:(\d+)$/.exec(lane.target || '');
  if (mt) {
    const fx = rt.fx?.[+mt[1]]; if (!fx) return null;
    if (fx.ap?.[lane.param]) return fx.ap[lane.param];
    // built-in effects whose node is reachable: Filter (input = the biquad), Soft Glue (input = the compressor), Tone EQ low cut
    if (fx.id === 'filter' && lane.param === 'cutoff') return { param: fx.input.frequency, map: v => clamp(v, 20, 20000) };
    if (fx.id === 'filter' && lane.param === 'resonance') return { param: fx.input.Q, map: v => v };
    if (fx.id === 'glue' && lane.param === 'threshold') return { param: fx.input.threshold, map: v => v };
    if (fx.id === 'eq' && lane.param === 'lowcut') return { param: fx.input.frequency, map: v => v };
    return { step: v => { if (fx.params) fx.params[lane.param] = v; fx.set(lane.param, v); } };   // stepped once per scheduled chunk
  }
  return null;
}

const laneState = new WeakMap();   // lane -> {to, ctx}
/**
 * Schedule a track's automation for the beat range [fromBeat, toBeat). Call it wherever the engine schedules that track's
 * notes (live lookahead and offline render): applyAutomation({ctx, tracks}, trackSpec, fromBeat, toBeat, beat => seconds).
 * engineCtx: {ctx, tracks: Map(id -> runtime)} or {ctx, runtime}. AudioParam targets get setValueAtTime / linearRampToValueAtTime
 * (smooth lanes and volume in dB are sampled every 1/8 beat); instrument params and non-AudioParam fx params are stepped at the chunk start.
 * A range that does not continue the previous one (play, seek, loop jump) starts with setValueAtTime. Returns the event count.
 */
export function applyAutomation(engineCtx, track, fromBeat, toBeat, timeAt) {
  const lanes = track?.automation; if (!lanes?.length) return 0;
  const rt = engineCtx.runtime || engineCtx.tracks?.get(track.id); if (!rt) return 0;
  const ctx = engineCtx.ctx;
  let n = 0;
  for (const lane of lanes) {
    if (!lane.points?.length) continue;
    lane._sorted = sorted(lane); lane._sortedN = lane.points.length;
    const tgt = resolveTarget(rt, lane); if (!tgt) continue;
    const st = laneState.get(lane);
    const fresh = !st || st.ctx !== ctx || Math.abs(st.to - fromBeat) > 1e-6;
    laneState.set(lane, { to: toBeat, ctx });
    if (tgt.step) { if (fresh || toBeat > fromBeat) tgt.step(laneValueAt(lane, fromBeat)); n++; continue; }
    const P = tgt.param, map = tgt.map, t0 = Math.max(timeAt(fromBeat), ctx.currentTime);
    const put = (fn, v, t) => { const x = map(v); if (isFinite(x) && isFinite(t)) { P[fn](x, t); n++; } };
    if (fresh) {
      // a fresh start: drop what was planned (a loop jump keeps the event that ends the previous pass)
      P.cancelScheduledValues(st ? t0 + 0.0005 : t0);
      put('setValueAtTime', laneValueAt(lane, fromBeat), st ? t0 + 0.0005 : t0);
    }
    if (toBeat <= fromBeat) continue;
    const marks = new Set();
    for (const p of lane._sorted) if (p.beat > fromBeat && p.beat < toBeat) marks.add(p.beat);
    if (lane.curve === 'smooth' || tgt.curved) for (let b = Math.ceil(fromBeat * 8 + 1e-6) / 8; b < toBeat; b += 0.125) marks.add(b);
    marks.add(toBeat);
    for (const b of [...marks].sort((x, y) => x - y)) { const t = timeAt(b); if (t > t0) put('linearRampToValueAtTime', laneValueAt(lane, b), t); }
  }
  return n;
}

/** On stop / seek: drop planned automation and set each automated param to its value at `beat` (or its static value). */
export function resetAutomation(engineCtx, track, beat) {
  const rt = engineCtx.runtime || engineCtx.tracks?.get(track.id); if (!rt) return;
  const t = engineCtx.ctx.currentTime;
  for (const lane of track.automation || []) {
    laneState.delete(lane);
    if (!lane.points?.length) continue;
    const tgt = resolveTarget(rt, lane); if (!tgt) continue;
    const v = beat === undefined ? staticValue(track, lane) : laneValueAt(lane, beat);
    if (v === null || v === undefined) continue;
    if (tgt.step) tgt.step(v);
    else { tgt.param.cancelScheduledValues(t); tgt.param.setTargetAtTime(tgt.map(v), t, 0.02); }
  }
}
function staticValue(track, lane) {
  if (lane.target === 'track') return lane.param === 'volumeDb' ? num(track.volumeDb, 0) : lane.param === 'pan' ? num(track.pan, 0) : num(track.sends?.[lane.param.slice(6)], lane.param === 'sends.space' ? 0.3 : 0);
  if (lane.target === 'instrument') return track.instrument?.params?.[lane.param];
  const i = +(lane.target.split(':')[1]); return track.fx?.[i]?.params?.[lane.param];
}

// ================================================================== editor (DOM)
const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v === undefined || v === null || v === false) continue; if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); } e.append(...kids.filter(Boolean)); return e; };
const sv = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return; cssDone = true;
  document.head.append(el('style', { id: 'sr-auto-css', text: `
.sr-auto{display:flex;align-items:stretch;user-select:none;-webkit-user-select:none;background:var(--lane-alt,#ECEEEC);border-top:1px solid var(--seam,rgba(18,22,24,.13));position:relative}
.sr-auto-head{position:sticky;left:0;z-index:3;flex:none;display:flex;flex-direction:column;gap:6px;padding:8px 10px;background:var(--panel,#EDEFED);border-right:1px solid var(--seam-strong,rgba(18,22,24,.22));box-sizing:border-box}
.sr-auto-head .label{font:var(--t-label,600 10px/1 sans-serif);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3,#737A7F)}
.sr-auto-head select{font:var(--t-ui,500 12px/1.3 sans-serif);color:var(--ink,#15181A);background:var(--panel-hi,#F7F8F7);border:1px solid var(--seam-strong,rgba(18,22,24,.22));border-radius:var(--r-key,7px);padding:3px 6px;min-width:0;width:100%}
.sr-auto-head .row{display:flex;gap:6px;align-items:center}
.sr-auto-head .val{font:500 11px/1 var(--f-mono,ui-monospace,monospace);color:var(--ink-2,#474D52);margin-left:auto}
.sr-auto-body{position:relative;flex:none}
.sr-auto-body svg{display:block;cursor:crosshair;touch-action:none}
.sr-auto-body svg:focus-visible{outline:none;box-shadow:var(--focus,0 0 0 2px #2D55D2)}
.sr-auto .pt{cursor:grab;stroke:var(--panel-hi,#fff);stroke-width:1.5}
.sr-auto .pt.sel{stroke:var(--ink,#15181A);stroke-width:2}
.sr-auto .grid{stroke:var(--seam,rgba(18,22,24,.13))}
.sr-auto .grid.bar{stroke:var(--seam-strong,rgba(18,22,24,.22))}
.sr-auto .hint{font:500 11px/1 var(--f-sans,sans-serif);fill:var(--ink-3,#737A7F)}
` }));
}

/**
 * Breakpoint editor for one track's automation, meant to sit right under the track row (same lane x-scale).
 * opts: {track, targets (automationTargets(track, defs)), pxPerBeat, beats, beatsPerBar = 4, headWidth = 196, height = 72,
 *        color = '#2D55D2', snap = 0.25, selected?: key, fmt?(v, target) -> string,
 *        onBegin(), onChange(lane), onEnd(lane), onSelect(key)}
 * Click empty space = add a point, drag = move (Shift = no snap), double-click a point = delete, Alt-click = delete,
 * keyboard on the focused lane: Left/Right pick a point, Up/Down change its value, Delete removes it.
 * The editor mutates track.automation; wrap onBegin/onEnd in your undo (state.begin / state.end) and re-render the engine.
 * Returns the root element with .update(opts) (redraw after outside changes) and .lane() (the lane shown).
 */
export function createAutomationEditor(opts) {
  injectCss();
  let o = { beatsPerBar: 4, headWidth: 196, height: 72, color: '#2D55D2', snap: 0.25, ...opts };
  const root = el('div', { class: 'sr-auto', role: 'group', 'aria-label': 'Automation' });
  const sel = el('select', { 'aria-label': 'Automated parameter', onchange: () => { o.selected = sel.value; o.onSelect?.(sel.value); selIdx = -1; draw(); } });
  const curveBtn = el('button', { class: 'key sm', type: 'button', title: 'Straight or smooth curve', onclick: () => { const l = lane(); if (!l) return; o.onBegin?.(); l.curve = l.curve === 'smooth' ? 'linear' : 'smooth'; o.onChange?.(l); o.onEnd?.(l); draw(); } });
  const clearBtn = el('button', { class: 'key sm', type: 'button', text: 'Clear', title: 'Remove every point of this lane', onclick: () => { const l = lane(); if (!l || !l.points.length) return; o.onBegin?.(); l.points = []; o.track.automation = o.track.automation.filter(x => x !== l); o.onChange?.(l); o.onEnd?.(l); selIdx = -1; draw(); } });
  const valEl = el('span', { class: 'val' });
  const head = el('div', { class: 'sr-auto-head' }, el('span', { class: 'label', text: 'Automation' }), sel, el('div', { class: 'row' }, curveBtn, clearBtn, valEl));
  const body = el('div', { class: 'sr-auto-body' });
  const svg = sv('svg', { tabindex: 0, role: 'application', 'aria-label': 'Automation breakpoints: click to add, drag to move, double-click to delete' });
  body.append(svg); root.append(head, body);
  let selIdx = -1, drag = null, lastDown = { i: -1, t: 0 };

  const target = () => o.targets.find(t => t.key === o.selected) || o.targets[0];
  const lane = () => { const t = target(); return t ? findLane(o.track, t.target, t.param) : null; };
  const log = t => t.scale === 'log' && t.min > 0;
  const toN = (t, v) => log(t) ? Math.log(v / t.min) / Math.log(t.max / t.min) : (v - t.min) / ((t.max - t.min) || 1);
  const fromN = (t, n) => { n = clamp(n, 0, 1); let v = log(t) ? t.min * Math.pow(t.max / t.min, n) : t.min + n * (t.max - t.min); if (t.step) v = Math.round(v / t.step) * t.step; return +v.toFixed(5); };
  const PAD = 6, H = () => o.height, W = () => Math.max(1, o.beats * o.pxPerBeat);
  const xOf = b => b * o.pxPerBeat, yOf = (t, v) => PAD + (1 - toN(t, v)) * (H() - 2 * PAD);
  const fmtV = (t, v) => o.fmt ? o.fmt(v, t) : (t.unit === 'dB' ? (v <= -59.9 ? '-inf' : (v > 0 ? '+' : '') + v.toFixed(1)) + ' dB' : t.unit === 'pan' ? (Math.abs(v) < 0.01 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100)) : t.unit === 'Hz' ? Math.round(v) + ' Hz' : (+v.toFixed(2)) + (t.unit ? ' ' + t.unit : ''));

  function draw() {
    const tg = target();
    sel.textContent = '';
    let grp = null, g = null;
    for (const t of o.targets) {
      if (t.group !== grp) { grp = t.group; g = el('optgroup', { label: grp }); sel.append(g); }
      const has = findLane(o.track, t.target, t.param)?.points?.length;
      g.append(el('option', { value: t.key, text: (has ? '● ' : '') + t.name, selected: tg && t.key === tg.key }));
    }
    const l = lane();
    curveBtn.textContent = l?.curve === 'smooth' ? 'Smooth' : 'Straight';
    head.style.width = o.headWidth + 'px';
    svg.setAttribute('width', W()); svg.setAttribute('height', H()); svg.setAttribute('viewBox', `0 0 ${W()} ${H()}`);
    svg.textContent = '';
    for (let b = 0; b <= o.beats; b++) { const bar = b % o.beatsPerBar === 0; if (!bar && o.pxPerBeat < 10) continue; svg.append(sv('line', { class: 'grid' + (bar ? ' bar' : ''), x1: xOf(b) + 0.5, x2: xOf(b) + 0.5, y1: 0, y2: H() })); }
    if (!tg) return;
    const pts = l ? sorted(l) : [];
    if (!pts.length) {
      const y = yOf(tg, clamp(tg.default, tg.min, tg.max));
      svg.append(sv('line', { x1: 0, x2: W(), y1: y, y2: y, stroke: o.color, 'stroke-dasharray': '3 4', 'stroke-opacity': 0.5 }));
      const tx = sv('text', { class: 'hint', x: 8, y: H() - 8 }); tx.textContent = `Click to automate ${tg.name}`; svg.append(tx);
      valEl.textContent = ''; return;
    }
    let d = `M0 ${yOf(tg, pts[0].value)}`;
    const step = l.curve === 'smooth' || log(tg) ? Math.max(2, o.pxPerBeat / 8) : 0;
    for (let i = 0; i < pts.length; i++) {
      if (step && i > 0) for (let x = xOf(pts[i - 1].beat) + step; x < xOf(pts[i].beat); x += step) d += ` L${x.toFixed(1)} ${yOf(tg, laneValueAt(l, x / o.pxPerBeat)).toFixed(1)}`;
      d += ` L${xOf(pts[i].beat).toFixed(1)} ${yOf(tg, pts[i].value).toFixed(1)}`;
    }
    d += ` L${W()} ${yOf(tg, pts[pts.length - 1].value)}`;
    svg.append(sv('path', { d: d + ` L${W()} ${H()} L0 ${H()} Z`, fill: o.color, 'fill-opacity': 0.1, stroke: 'none' }));
    svg.append(sv('path', { d, fill: 'none', stroke: o.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    l.points.forEach((p, i) => svg.append(sv('circle', { class: 'pt' + (i === selIdx ? ' sel' : ''), 'data-i': i, cx: xOf(p.beat), cy: yOf(tg, p.value), r: i === selIdx ? 5.5 : 4.5, fill: o.color })));
    const sp = l.points[selIdx]; valEl.textContent = sp ? fmtV(tg, sp.value) : '';
  }

  const at = e => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const snapB = (b, e) => clamp(e.shiftKey || !o.snap ? b : Math.round(b / o.snap) * o.snap, 0, o.beats);
  const hit = (l, tg, x, y) => { let best = -1, bd = 81; (l?.points || []).forEach((p, i) => { const d = (xOf(p.beat) - x) ** 2 + (yOf(tg, p.value) - y) ** 2; if (d < bd) { bd = d; best = i; } }); return best; };
  svg.addEventListener('pointerdown', e => {
    if (e.button) return;
    const tg = target(); if (!tg) return;
    svg.focus({ preventScroll: true });
    const { x, y } = at(e); let l = lane(); let i = hit(l, tg, x, y);
    // double-click (two presses on the same point within 400 ms) or Alt-click deletes it. Done here, not with 'dblclick',
    // because the redraw replaces the circle under the pointer and Chromium then drops the dblclick.
    const now = performance.now(), dbl = i >= 0 && lastDown.i === i && now - lastDown.t < 400;
    lastDown = { i, t: now };
    if (i >= 0 && (e.altKey || dbl)) { o.onBegin?.(); l.points.splice(i, 1); if (!l.points.length) o.track.automation = o.track.automation.filter(z => z !== l); selIdx = -1; lastDown = { i: -1, t: 0 }; o.onChange?.(l); o.onEnd?.(l); draw(); return; }
    o.onBegin?.();
    if (i < 0) { l = l || ensureLane(o.track, tg.target, tg.param); l.points.push({ beat: snapB(x / o.pxPerBeat, e), value: fromN(tg, 1 - (y - PAD) / (H() - 2 * PAD)) }); i = l.points.length - 1; o.onChange?.(l); }
    selIdx = i; drag = { id: e.pointerId, l, moved: false }; svg.setPointerCapture(e.pointerId); draw(); e.preventDefault();
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return; const tg = target(), { x, y } = at(e), p = drag.l.points[selIdx]; if (!p) return;
    p.beat = snapB(x / o.pxPerBeat, e); p.value = fromN(tg, 1 - (y - PAD) / (H() - 2 * PAD)); drag.moved = true; o.onChange?.(drag.l); draw();
  });
  const up = () => { if (!drag) return; const l = drag.l; drag = null; o.onEnd?.(l); };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('keydown', e => {
    const l = lane(), tg = target(); if (!l || !l.points.length || !tg) return;
    const order = l.points.map((p, i) => i).sort((a, b) => l.points[a].beat - l.points[b].beat);
    let pos = order.indexOf(selIdx);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { pos = clamp(pos + (e.key === 'ArrowRight' ? 1 : -1), 0, order.length - 1); if (pos < 0) pos = 0; selIdx = order[pos]; draw(); }
    else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && selIdx >= 0) { o.onBegin?.(); const p = l.points[selIdx]; p.value = fromN(tg, toN(tg, p.value) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.01 : 0.05)); o.onChange?.(l); o.onEnd?.(l); draw(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selIdx >= 0) { o.onBegin?.(); l.points.splice(selIdx, 1); selIdx = -1; o.onChange?.(l); o.onEnd?.(l); draw(); }
    else return;
    e.preventDefault(); e.stopPropagation();
  });
  root.update = next => { o = { ...o, ...next }; draw(); };
  root.lane = lane;
  draw();
  return root;
}
