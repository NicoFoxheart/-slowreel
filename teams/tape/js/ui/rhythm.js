// rhythm.js - the two helpers Nico asked for, both visible in Simple mode:
//  Auto mix   the deck key + Settings line, the hook that runs automix.js on every edit (same undo step), manual markers
//             and "Re-mix automatically" (the Mix unit in the Sound tab), the reverb chosen for the tape.
//  Rhythm     metronome + 1-bar count-in when recording (soft clicks straight to the speakers: never in an export or a
//             video), Tighten timing (Notes tab and the Rhythm popover), auto-tighten new recordings, Add a groove
//             (grooves.js) and Breathe (a Sidechain Pump on a pad, keyed to the groove's kick or to the tempo).
// He still plays every note: nothing here writes melody or chords.
import { S, on, emit, edit, begin, end, track, clipOf, clamp, bpb, uid, instDef, setMixHook } from './state.js?v=10b';
import { h, icon, knob } from './controls.js?v=10b';
import { autoMix, roleOf, roleLabel, isManual, markManual, clearManual, anyManual, canBreathe, pickReverb } from './automix.js?v=10b';
import { GROOVES, grooveById, grooveTrack } from './grooves.js?v=10b';
import { TRACK_COLORS } from './sample-project.js?v=10b';

const $ = id => document.getElementById(id);
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { } };
const toast = m => emit('toast', m);
const defOf = t => instDef(t?.instrument?.id);
const engineDef = id => instDef(id);

// ---------------------------------------------------------------- preferences (per viewer)
const PREF = { automix: 'slowreel:automix', metro: 'slowreel:metro', countin: 'slowreel:countin', autotight: 'slowreel:autotighten', strength: 'slowreel:tighten' };
export const R = {
  autoPref: lsGet(PREF.automix) !== 'off',          // Auto mix for new tapes and for old ones on their next change
  metro: lsGet(PREF.metro) === 'on',                // metronome click while playing
  countIn: lsGet(PREF.countin) !== 'off',           // 1-bar count-in when recording starts from stop
  autoTight: lsGet(PREF.autotight) !== 'off',       // gently tighten each new recording
  strength: clamp(+(lsGet(PREF.strength) || 0.6), 0.1, 1),
};
export const AUTO_TIGHT = 0.35;

// ================================================================ AUTO MIX
/** Is Auto mix on for this tape? (pending = an older tape that has not been auto-mixed yet, while the preference is on) */
export const autoState = (p = S.project) => (p?.autoMix ? (p.autoMix.on ? 'on' : 'off') : R.autoPref ? 'pending' : 'off');
/** Run Auto mix on a project in place (no history). For new tapes and for opening a tape that has it on. */
export function applyAutoMix(p) { if (!p) return null; if (!p.autoMix) p.autoMix = { on: R.autoPref }; return p.autoMix.on ? autoMix(p, engineDef) : null; }
/** Stamp a brand-new tape (starter / blank) with the viewer's choice and mix it. */
export function newTapeMix(p) { p.autoMix = { on: R.autoPref }; if (p.autoMix.on) autoMix(p, engineDef); }

// the hook state.js calls inside every edit (before the undo snapshot is compared): same undo step as the edit
setMixHook(change => {
  const p = S.project; if (!p || change?.type === 'meta') return null;
  if (!p.autoMix) { if (!R.autoPref) return null; p.autoMix = { on: true }; }   // an older tape: Auto mix runs on its next change
  if (!p.autoMix.on) return null;
  const r = autoMix(p, engineDef);
  if (!r.tracks.size && !r.bus) return null;
  return !r.bus && r.tracks.size === 1 ? { type: 'track', trackId: [...r.tracks][0] } : { type: 'all' };
});

function setAuto(on) {
  R.autoPref = !!on; lsSet(PREF.automix, on ? 'on' : 'off');
  edit(p => { p.autoMix = { ...(p.autoMix || {}), on: !!on }; }, { type: 'all' });   // turning it on mixes now (the hook)
  syncDeck();
  toast(on ? `Auto mix is on: ${pickReverb(S.project).label.toLowerCase()} room, every track balanced. Your songs are left as they are.` : 'Auto mix is off. The mix stays as it is now; nothing changes by itself.');
}
/** "Re-mix automatically": give one track (or every track) back to Auto mix. */
export function remix(trackId) {
  edit(p => {
    p.autoMix = { ...(p.autoMix || {}), on: true };
    for (const t of p.tracks) if (!trackId || t.id === trackId) clearManual(t);
    if (!trackId && p.buses?.space) delete p.buses.space.manual;
  }, { type: 'all' });
  R.autoPref = true; lsSet(PREF.automix, 'on'); syncDeck();
  toast(trackId ? 'Re-mixed automatically.' : 'Every track re-mixed automatically.');
}

// ---------------------------------------------------------------- the deck keys
function syncDeck() {
  const st = autoState(), b = $('b-automix');
  if (b) {
    b.setAttribute('aria-pressed', String(st === 'on'));
    b.classList.toggle('pending', st === 'pending');
    b.title = st === 'on' ? `Auto mix is on: levels, pan, room and echo from each track's role (${pickReverb(S.project).label.toLowerCase()} room). Click to turn it off.`
      : st === 'pending' ? 'Auto mix will balance this tape on your next change. Click to mix it now.' : 'Auto mix is off. Click to balance every track automatically.';
    b.querySelector('.lb').textContent = st === 'pending' ? 'Mix this tape' : 'Auto mix';
  }
  $('b-metro')?.setAttribute('aria-pressed', String(R.metro));
}
on('project', syncDeck); on('history', syncDeck);

// ================================================================ METRONOME + COUNT-IN
// Clicks are tiny oscillator blips scheduled ahead on the audio clock, from the engine's own position, and go straight to
// the speakers (ctx.destination): not through the master, so they are never in an export, a video or the meters.
let clickBus = null, metroTimer = 0, anchor = { t: 0, b: 0 }, nextBeat = null, lastBeat = null;
function bus() { if (!clickBus || clickBus.context !== S.ctx) { clickBus = S.ctx.createGain(); clickBus.gain.value = 0.5; clickBus.connect(S.ctx.destination); } return clickBus; }
function click(t, down) {
  const ctx = S.ctx, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = 'triangle'; o.frequency.value = down ? 1568 : 1175; f.type = 'lowpass'; f.frequency.value = 3200;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(down ? 0.32 : 0.2, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.055);
  o.connect(f); f.connect(g); g.connect(bus()); o.start(t); o.stop(t + 0.07); R.clicks = (R.clicks || 0) + 1;
  o.onended = () => { try { o.disconnect(); f.disconnect(); g.disconnect(); } catch { } };
}
function metroTick() {
  if (!S.playing || !S.ctx) { stopMetro(); return; }
  if (!R.metro) return;
  const now = S.ctx.currentTime, spb = 60 / (S.project.bpm || 70), B = bpb();
  let beatNow;
  if (now < anchor.t) beatNow = anchor.b - (anchor.t - now) / spb;          // pre-roll / count-in: the tape has not started
  else { const pos = S.engine.position(); if (!pos.playing) return; beatNow = pos.beat; }
  if (lastBeat !== null && beatNow < lastBeat - 0.02) nextBeat = null;          // loop jump or seek
  lastBeat = beatNow;
  if (nextBeat === null) nextBeat = Math.max(Math.ceil(beatNow - 1e-6), Math.ceil(anchor.b - 1e-6));
  const L = S.project.loop, loopEnd = L?.on ? L.endBeat : Infinity;
  while (nextBeat <= beatNow + 0.12 / spb && nextBeat < loopEnd - 1e-6) {
    const t = now + (nextBeat - beatNow) * spb;
    if (t >= now - 0.01) click(Math.max(t, now + 0.001), ((nextBeat % B) + B) % B === 0);
    nextBeat++;
  }
}
function startMetro() { if (!metroTimer) metroTimer = setInterval(metroTick, 25); metroTick(); }
function stopMetro() { clearInterval(metroTimer); metroTimer = 0; nextBeat = null; lastBeat = null; }
/** app.js calls this right after engine.play(beat, {at}) */
export function onPlay(at, beat) { anchor = { t: at, b: beat }; nextBeat = null; lastBeat = null; if (R.metro) startMetro(); }
export function onStop() { stopMetro(); }
/** A 1-bar count-in before recording: schedules the clicks and returns the audio time the tape should start at. */
export function countIn() {
  const ctx = S.ctx, spb = 60 / (S.project.bpm || 70), B = bpb(), t0 = ctx.currentTime + 0.12;
  for (let k = 0; k < B; k++) click(t0 + k * spb, k === 0);
  return t0 + B * spb;
}
export const wantsCountIn = () => R.countIn;
function setMetro(on) { R.metro = !!on; lsSet(PREF.metro, on ? 'on' : 'off'); if (on && S.playing) startMetro(); if (!on) stopMetro(); syncDeck(); fillPop(); }

// ================================================================ TIGHTEN
/** Grid for this tempo: 1/16 up to 90 BPM, 1/8 above (about a quarter second either way). */
export const gridFor = bpm => ((bpm || 70) <= 90 ? 0.25 : 0.5);
export const gridName = g => (g === 0.25 ? '1/16' : '1/8');
/**
 * Pull note starts toward the grid by `strength` (0..1, 1 = hard quantise) and even out wildly uneven velocities a
 * little. Works in place on clip.notes (only the indices in `only`, when given). Returns {moved, before, after} (mean
 * absolute timing error in beats against the grid, for tests).
 */
export function tighten(notes, { grid = 0.25, strength = 0.6, only = null } = {}) {
  const idx = (only && only.size ? [...only] : notes.map((_, i) => i)).filter(i => notes[i]);
  if (!idx.length) return { moved: 0, before: 0, after: 0 };
  const err = () => idx.reduce((a, i) => a + Math.abs(notes[i].s - Math.round(notes[i].s / grid) * grid), 0) / idx.length;
  const before = err();
  const mean = idx.reduce((a, i) => a + (notes[i].v ?? 0.8), 0) / idx.length;
  let moved = 0;
  for (const i of idx) {
    const n = notes[i], target = Math.round(n.s / grid) * grid, s = Math.max(0, Math.round((n.s + (target - n.s) * strength) * 10000) / 10000);
    if (s !== n.s) { n.s = s; moved++; }
    const v = n.v ?? 0.8, dev = v - mean;
    if (Math.abs(dev) > 0.08) n.v = Math.round(clamp(v - dev * 0.45 * strength, 0.12, 1) * 100) / 100;   // only the wild ones, and only a little
  }
  return { moved, before, after: err() };
}
/** Tighten the selected notes (or the whole clip) of the open clip: one undo step. */
export function tightenClip(strength = R.strength, { silent = false } = {}) {
  const f = clipOf(); if (!f || f.c.song || !f.c.notes?.length) { if (!silent) toast('Pick a clip with notes to tighten.'); return null; }
  const grid = gridFor(S.project.bpm), only = S.sel.notes.size ? new Set(S.sel.notes) : null;
  let r = null;
  edit(p => { const c = p.tracks.find(t => t.id === f.t.id).clips.find(c => c.id === f.c.id); r = tighten(c.notes, { grid, strength, only }); }, { type: 'notes', trackId: f.t.id });
  if (!silent) toast(`Tightened ${only ? 'the selected' : 'all'} notes toward ${gridName(grid)} at ${Math.round(strength * 100)}%. Ctrl+Z gives your timing back.`);
  return r;
}
/** After a recording: tighten the new clip gently (its own undo step, so Ctrl+Z gives the raw timing back). */
export function afterRecording(trackId, clipId) {
  if (!R.autoTight) return false;
  edit(p => { const c = p.tracks.find(t => t.id === trackId)?.clips.find(c => c.id === clipId); if (c) tighten(c.notes, { grid: gridFor(p.bpm), strength: AUTO_TIGHT }); }, { type: 'notes', trackId });
  return true;
}
/** The Notes tab toolbar: Tighten + strength. */
export function tightenTools() {
  const sel = h('select', { class: 'sel', id: 'pr-tight-amt', 'aria-label': 'Tighten strength', title: 'How far notes move toward the grid' },
    ...[0.3, 0.6, 0.9].map(v => h('option', { value: v, selected: Math.abs(v - R.strength) < 0.05 }, `${Math.round(v * 100)}%`)));
  sel.onchange = () => { R.strength = +sel.value; lsSet(PREF.strength, sel.value); };
  return h('div', { class: 'segk tight-tools', role: 'group', 'aria-label': 'Tighten timing' },
    h('button', { class: 'key sm', id: 'pr-tighten', title: `Tighten timing: move the notes (or the selected ones) toward the ${gridName(gridFor(S.project?.bpm))} grid, keeping some of your feel`, onclick: () => tightenClip(R.strength) }, icon('tight'), 'Tighten'), sel);
}

// ================================================================ GROOVES + BREATHE
const hasKick = t => (t?.clips || []).some(c => (c.notes || []).some(n => n.p === 36 || n.p === 35));
const grooveOf = p => p.tracks.find(t => t.groove);
export function addGroove(id) {
  const g = grooveById(id); if (!g) return null;
  let added = null, replaced = false;
  edit(p => {
    const old = grooveOf(p), i = old ? p.tracks.indexOf(old) : -1;
    const used = new Set(p.tracks.filter(t => t !== old).map(t => t.color));
    const color = old?.color || TRACK_COLORS.find(c => !used.has(c)) || TRACK_COLORS[p.tracks.length % TRACK_COLORS.length];
    added = grooveTrack(id, p, { uid, color });
    if (i >= 0) { p.tracks.splice(i, 1, added); replaced = true; } else if (p.tracks.length < 16) p.tracks.push(added); else { added = null; return; }
    // a pad that already breathes follows the new groove's kick
    for (const t of p.tracks) for (const f of t.fx || []) if (f.breathe) Object.assign(f.params, breatheParams(p, added));
  }, { type: 'all' });
  if (!added) { toast('Slowreel holds 16 tracks. Remove one to add a groove.'); return null; }
  S.sel.trackId = added.id; S.sel.clipId = added.clips[0]?.id || null; S.sel.notes.clear(); emit('select');
  const startBar = Math.round((added.clips[0]?.startBeat || 0) / bpb()) + 1;
  toast(`${g.name} ${replaced ? 'replaces the old groove' : 'is on the tape'} from bar ${startBar}, soft and low. Edit it in Beats.`);
  return added;
}
export function removeGroove() { edit(p => { const g = grooveOf(p); if (g) p.tracks.splice(p.tracks.indexOf(g), 1); for (const t of p.tracks) for (const f of t.fx || []) if (f.breathe) Object.assign(f.params, breatheParams(p, null)); }, { type: 'all' }); emit('select'); }
function breatheParams(p, groove) {
  const g = groove === undefined ? grooveOf(p) : groove, key = g && hasKick(g) ? g : p.tracks.find(t => t.instrument?.id === 'drums' && hasKick(t));
  return key ? { source: 'kick', keyTrack: key.id, rate: '1', depth: 0.42, shape: 0.75 } : { source: 'beat', keyTrack: '', rate: (p.bpm || 70) < 90 ? '1' : '2', depth: 0.38, shape: 0.8 };
}
export const breathing = t => (t?.fx || []).some(f => f.breathe);
export function toggleBreathe(trackId = S.sel.trackId) {
  const t = track(trackId); if (!t || !canBreathe(t, defOf(t))) { toast('Breathe works on a pad, drone, texture or choir track.'); return; }
  const was = breathing(t);
  edit(p => {
    const x = p.tracks.find(y => y.id === trackId);
    if (was) x.fx = x.fx.filter(f => !f.breathe);
    else x.fx.push({ id: 'pump', params: breatheParams(p), bypass: false, breathe: true });
  }, { type: 'track', trackId });
  const k = breatheParams(S.project).source === 'kick';
  toast(was ? `${t.name} is steady again.` : `${t.name} breathes ${k ? 'with the groove\'s kick' : 'with the tempo'}.`);
}

// ================================================================ the Rhythm popover
let pop = null;
function openPop() {
  pop = $('rhythm-pop'); if (!pop) return;
  pop.hidden = false; $('b-rhythm').setAttribute('aria-expanded', 'true');
  const r = $('b-rhythm').getBoundingClientRect();
  pop.style.top = r.bottom + 8 + 'px'; pop.style.left = Math.max(10, Math.min(innerWidth - 370, r.left - 20)) + 'px';
  fillPop(); pop.querySelector('button')?.focus();
}
export function closePop() { if (!pop || pop.hidden) return; pop.hidden = true; $('b-rhythm')?.setAttribute('aria-expanded', 'false'); }
const led = (id, pressed, text, onclick, title) => h('button', { class: 'key sm led-amber lit-on', id, 'aria-pressed': String(!!pressed), title, onclick }, h('span', { class: 'led' }), text);
export function fillPop() {
  if (!pop || pop.hidden || !S.project) return;
  pop.textContent = '';
  const p = S.project, t = track(), grid = gridFor(p.bpm), g = grooveOf(p), f = clipOf();
  const canTight = f && !f.c.song && f.c.notes?.length;
  const bt = t && canBreathe(t, defOf(t));
  pop.append(h('h2', { text: 'Rhythm' }),
    h('p', { class: 'pm-note', text: 'You still play every note. These keep you in time and add a soft pulse under it.' }),
    h('div', { class: 'rh-sec' }, h('span', { class: 'label', text: 'Keep time' }),
      h('div', { class: 'row' },
        led('rh-metro', R.metro, 'Metronome', () => setMetro(!R.metro), 'A soft click on every beat while the tape plays'),
        led('rh-countin', R.countIn, 'Count-in 1 bar', () => { R.countIn = !R.countIn; lsSet(PREF.countin, R.countIn ? 'on' : 'off'); fillPop(); }, 'Four clicks before recording starts')),
      h('p', { class: 'pm-note', text: 'Soft clicks only you hear: never in your export or video.' })),
    h('div', { class: 'rh-sec' }, h('span', { class: 'label', text: `Tighten timing · ${gridName(grid)} grid at ${p.bpm} BPM` }),
      h('div', { class: 'row' },
        h('button', { class: 'key sm', id: 'rh-tighten', disabled: !canTight, title: canTight ? 'Tighten the open clip (or its selected notes)' : 'Open a clip with notes first', onclick: () => { tightenClip(R.strength); fillPop(); } }, icon('tight'), `Tighten ${Math.round(R.strength * 100)}%`),
        led('rh-autotight', R.autoTight, 'Auto-tighten recordings', () => { R.autoTight = !R.autoTight; lsSet(PREF.autotight, R.autoTight ? 'on' : 'off'); fillPop(); toast(R.autoTight ? 'New recordings are tightened gently (35%).' : 'New recordings keep your exact timing.'); }, 'Gently tighten every new recording (35%). Ctrl+Z right after gives your raw timing back')),
      h('p', { class: 'pm-note', text: R.autoTight ? 'New recordings are tightened gently (35%), keeping your feel. Ctrl+Z right after gives your raw timing back.' : 'New recordings keep your exact timing.' })),
    h('div', { class: 'rh-sec' }, h('span', { class: 'label', text: g ? `Groove · ${grooveById(g.groove)?.name || g.name}` : 'Add a groove' }),
      h('div', { class: 'groove-grid', role: 'group', 'aria-label': 'Grooves' }, ...GROOVES.map(gr => h('button', { class: 'key groove', id: `groove-${gr.id}`, 'aria-pressed': String(g?.groove === gr.id),
        onclick: () => { addGroove(gr.id); fillPop(); } }, h('strong', { text: gr.name }), h('span', { text: gr.line })))),
      h('p', { class: 'pm-note', text: `Made for ${p.bpm} BPM: starts after a short intro, changes every 4 bars, fills at section ends. It stays low; edit it in Beats.` }),
      g ? h('div', { class: 'row' }, h('button', { class: 'key sm', id: 'rh-groove-rm', onclick: () => { removeGroove(); fillPop(); } }, icon('trash'), 'Remove groove')) : null),
    h('div', { class: 'rh-sec' }, h('span', { class: 'label', text: 'Breathe' }),
      h('div', { class: 'row' }, led('rh-breathe', bt && breathing(t), bt ? `Breathe: ${t.name}` : 'Breathe', () => { toggleBreathe(); fillPop(); }, 'The pad ducks softly on each kick (or each beat) and swells back')),
      h('p', { class: 'pm-note', text: bt ? `${t.name} pulses with ${g && hasKick(g) ? 'the groove\'s kick' : 'the tempo'}.` : 'Select a pad, drone, texture or choir track first.' })));
  if (!bt) pop.querySelector('#rh-breathe').disabled = true;
}

// ================================================================ the Mix unit (Sound tab, both modes)
/** Volume / Pan / Space / Echo with manual markers, the role, Breathe and "Re-mix automatically". */
export function mixUnit(t, unit) {
  const def = defOf(t), role = roleOf(t, def), st = autoState(), song = t.kind === 'song';
  const acts = h('div', { class: 'row mix-acts' });
  const remixBtn = () => h('button', { class: 'key sm', id: 'mix-remix', title: 'Give this track back to Auto mix', onclick: () => remix(t.id) }, 'Re-mix automatically');
  const showMark = el => { if (el.querySelector('.man')) return; el.classList.add('is-manual'); el.append(h('span', { class: 'man', title: 'Set by you: Auto mix leaves it alone', text: 'manual' })); };
  const set = (key, v) => { const x = S.project.tracks.find(y => y.id === t.id); if (key === 'space' || key === 'echo') x.sends[key] = v; else x[key] = v; markManual(x, key); S.engine.setParam({ track: t.id }, key, v); };
  const mk = (key, spec, value, extra = {}) => {
    let el = null;
    el = knob(spec, { value, size: 'sm', idPrefix: `mix-${t.id}`, ...extra,
      onInput: v => { begin(); set(key, v); },
      onCommit: v => { begin(); set(key, v); end({ type: 'mixer', trackId: t.id }, { render: false }); showMark(el); if (!song && !acts.querySelector('#mix-remix')) acts.prepend(remixBtn()); } });
    if (isManual(t, key)) showMark(el);
    return el;
  };
  const kn = h('div', { class: 'knobs mix-knobs' },
    mk('volumeDb', { id: 'vol', name: 'Volume', min: -40, max: 6, default: -8, unit: 'dB' }, t.volumeDb ?? 0),
    mk('pan', { id: 'pan', name: 'Pan', min: -1, max: 1, default: 0, unit: 'pan' }, t.pan || 0),
    mk('space', { id: 'space', name: 'Space', min: 0, max: 1, default: 0.4 }, t.sends?.space ?? 0.4, { color: 'var(--cobalt)' }),
    mk('echo', { id: 'echo', name: 'Echo', min: 0, max: 1, default: 0 }, t.sends?.echo ?? 0, { color: 'var(--saffron)' }));
  const roleTxt = song ? 'Your song: Auto mix never changes it' : st === 'on' ? roleLabel(role) : st === 'pending' ? 'Auto mix runs on your next change' : 'Auto mix is off';
  if (!song && (st !== 'on' || anyManual(t))) acts.append(remixBtn());
  if (canBreathe(t, def)) acts.append(h('button', { class: 'key sm led-amber lit-on', id: 'mix-breathe', 'aria-pressed': String(breathing(t)), title: 'Breathe: the pad pulses with the groove (Sidechain Pump)', onclick: () => toggleBreathe(t.id) }, h('span', { class: 'led' }), 'Breathe'));
  return unit(['Mix', h('span', { class: 'label' + (st === 'on' && !song ? ' auto-on' : ''), text: song ? 'untouched' : st === 'on' ? 'auto' : st }) ], 'mix-unit', kn, h('p', { class: 'note-text mix-role', text: roleTxt }), acts);
}

// ================================================================ wiring (app.js calls initRhythm once)
export function initRhythm() {
  $('b-automix').onclick = () => { const st = autoState(); if (st === 'on') setAuto(false); else setAuto(true); };
  $('b-metro').onclick = () => setMetro(!R.metro);
  $('b-rhythm').onclick = () => (pop && !pop.hidden ? closePop() : openPop());
  document.addEventListener('pointerdown', e => { if (pop && !pop.hidden && !pop.contains(e.target) && !$('b-rhythm').contains(e.target)) closePop(); });
  pop = $('rhythm-pop');
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { closePop(); $('b-rhythm').focus(); } e.stopPropagation(); });
  on('select', fillPop); on('render', ch => { if (ch?.type !== 'mixer-live') fillPop(); });
  syncDeck();
}
/** Settings popover rows (app.js fillSettings). */
export function settingsRows() {
  const st = autoState();
  return [
    h('div', { class: 'set-row' },
      h('button', { class: 'key led-amber lit-on', id: 'set-automix', 'aria-pressed': String(st === 'on'), onclick: () => { setAuto(st !== 'on'); emit('settings'); } }, h('span', { class: 'led' }), st === 'pending' ? 'Auto mix this tape' : 'Auto mix'),
      h('button', { class: 'key sm', id: 'set-remix', onclick: () => { remix(null); emit('settings'); } }, 'Re-mix all')),
    h('p', { class: 'pm-note', text: 'Auto mix sets each track\'s level, pan, room and echo from what it plays (pads back and wet, plucks clear, drums dry) and picks the reverb. Your songs stay exactly as you made them, and anything you move by hand stays yours.' }),
  ];
}
