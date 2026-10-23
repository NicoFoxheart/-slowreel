// starters.js - "Start a new tape": the Blank tape and five style starters, plus the style guide each one opens.
// A starter only sets the tape up (BPM, key, scale, Atmos, Space, a fitting reverb and 2-4 named EMPTY tracks with the
// right instruments and presets). It writes no melody, chord or drum notes: Nico plays every note himself. The only
// note a starter writes is the one long held note a rain/wind texture needs to sound at all (a bed, not music).
//
//   openChooser({ onPick })            the calm chooser dialog; onPick({ kind: 'blank' } | { kind: 'starter', starter })
//   blankProject(base)                 zero tracks
//   starterProject(starter, base)      the set-up tape (base = { instruments, buses, colors, uid })
//   guideFor(project)                  a recipe-shaped object for recipes-panel openTips (style guide or flow tips)
import { h, icon } from './controls.js?v=10b';
import { KEYMAP } from './panels.js?v=10b';

// ---------------------------------------------------------------- notes, keys and the home note
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const pcOf = k => Math.max(0, NOTE.indexOf(String(k || 'C').replace(/m$/, '')));
/** Computer keys (Slowreel's KEYMAP, js/ui/panels.js) that play pitch class pc, low to high. */
const keysFor = pc => Object.entries(KEYMAP).filter(([, v]) => v % 12 === pc).map(([k]) => k === ';' || k === "'" ? k : k.toUpperCase());
const keyList = pc => keysFor(pc).join(' or ');

// ---------------------------------------------------------------- the five styles
const fx = (id, params) => ({ id, params, bypass: false });
const room = (type, o = {}) => ({ type, mix: 1, size: 1.4, tone: 0.45, preDelay: 0.03, shimmer: 0, ...o });

export const STARTERS = [
  {
    id: 'korean', title: 'Korean', sub: 'rainy, sanjo-like', line: 'Rain, a moonlit gayageum and a haegeum that answers it.',
    region: 'korea', bpm: 60, key: 'D#', scale: 'gyemyeonjo', scaleName: 'Gyemyeonjo', bars: 32,
    atmosphere: 0.55, spaceDb: 0, reverb: room('hall', { size: 1.5, tone: 0.42 }),
    tracks: [
      { name: 'Rain', inst: 'texture', preset: 'night-rain', params: { tone: 0.5, density: 0.35, motion: 0.4 }, vol: -10, space: 0.1, bed: true },
      { name: 'Gayageum', inst: 'gayageum', preset: 'moonlit-gayageum', vol: -5, pan: -0.15, space: 0.35, echo: 0.2 },
      { name: 'Haegeum', inst: 'haegeum', preset: 'misty-haegeum', vol: -8, pan: 0.2, space: 0.5, echo: 0.05 },
    ],
    tips: [
      'Sanjo grows from slow to fast: jinyangjo, then jungmori, then jajinmori. Keep BPM at 60 and let your playing grow: long notes first, more notes in the middle, quick runs at the end.',
      'Nonghyeon is the vibrato and bend on a held string. Hold a Gayageum note a beat or more and it sings; short notes stay plain. Sound tab: the Nonghyeon and Bend knobs, and Gesture under Shape.',
      'The haegeum answers the gayageum: play a short Gayageum phrase, then click the Haegeum track and reply with a few long notes.',
      'Leave silence. After each phrase, let the rain and the Space knob fill a bar or two before you play again.',
      'Gyemyeonjo in D# is exactly the five black keys: W E T Y U O P (C# D# F# G# A#). Any of them sound good together.',
      'Rhythm (deck): Add a groove > Korean janggu lays a soft 12/8 gutgeori pulse under you after the intro; Breathe on the Rain makes it swell with it.',
    ],
  },
  {
    id: 'chinese', title: 'Chinese', sub: 'misty mountains', line: 'Mountain air, a guzheng that sweeps and an erhu that slides.',
    region: 'china', bpm: 66, key: 'F#', scale: 'gong', scaleName: 'Gong mode', bars: 32,
    atmosphere: 0.55, spaceDb: 0, reverb: room('hall', { size: 1.7, tone: 0.45, preDelay: 0.04 }),
    tracks: [
      { name: 'Mountain air', inst: 'texture', preset: 'wind', params: { tone: 0.35, motion: 0.45, density: 0.3 }, vol: -12, space: 0.1, bed: true },
      { name: 'Guzheng', inst: 'guzheng', preset: 'mountain-stream', vol: -6, pan: -0.15, space: 0.4, echo: 0.15 },
      { name: 'Erhu', inst: 'erhu', preset: 'moon-over-spring', vol: -9, pan: 0.2, space: 0.5, echo: 0.05 },
    ],
    tips: [
      'Gong mode is the Chinese five-note scale on gong (do). In F# it is exactly the black keys W E T Y U O P (F# G# A# C# D#). No half steps, so nothing clashes.',
      'The guzheng sweeps into a note: run a finger fast across three or four black keys and hold the last. For a slide on held notes, set Gesture to Shang hua (Sound tab, under Shape).',
      'The erhu slides: on the Erhu track, press the next key before you let go of the last. The Slide knob (Sound tab) sets how slow the glide is.',
      'Think of a shan shui painting: most of it is empty mist. Play one or two voices at a time and let Space and Atmos be the mist.',
      'Long Erhu notes over a few Guzheng plucks: the slow voice is the mountain, the plucks are the water.',
      'Rhythm (deck): Add a groove > Rain ticks or Heartbeat pulse for a quiet pulse; Breathe on Mountain air lets the wind swell with it.',
    ],
  },
  {
    id: 'japanese', title: 'Japanese', sub: 'temple, ma / silence', line: 'A shakuhachi breath, a koto and one temple bell. Silence is part of it.',
    region: 'japan', bpm: 56, key: 'E', scale: 'in', scaleName: 'In (Miyako-bushi)', bars: 32,
    atmosphere: 0.5, spaceDb: -2, reverb: room('cathedral', { size: 1.3, tone: 0.4, preDelay: 0.04 }),
    tracks: [
      { name: 'Shakuhachi', inst: 'shakuhachi', preset: 'honkyoku', vol: -8, pan: 0.1, space: 0.45, echo: 0.05 },
      { name: 'Koto', inst: 'koto', preset: 'oshide-koto', vol: -7, pan: -0.15, space: 0.35, echo: 0.1 },
      { name: 'Temple bell', inst: 'templebells', preset: 'rin', vol: -14, space: 0.5 },
    ],
    tips: [
      'Ma: silence is a sound too. After every phrase, wait 2-4 beats with nothing but the room before you play again.',
      'The In scale on E is E F A B C, all white keys: D F H J K (and ; \'). Skip S and G (the notes D and G), and the black keys. The half step E-F gives it its ache.',
      'Muraiki is the shakuhachi\'s rough, windy blow. Turn the Muraiki knob (Sound tab) up for a stormy breath, down for a calm one.',
      'Meri bends a note down by tilting the head. The Meri knob sets how flat a held note starts before it rises; hold notes a beat or more.',
      'One koto note can be a whole phrase: pluck once, let it ring and press (the Oshide knob), then wait.',
      'Strike the Temple bell rarely, once every 4-8 bars, on E (key D).',
      'Rhythm (deck): Add a groove > Soft taiko gives distant temple drums after the intro. Breathe is for pads: add a Tape pad if you want one to pulse.',
    ],
  },
  {
    id: 'antent', title: 'Night Garage / Antent', sub: 'dreamy future garage', line: 'Garage drums, a supersaw dream pad that pumps, 808 and slowed vocal chops.',
    region: 'garage', bpm: 130, key: 'D#', scale: 'minor', scaleName: 'Minor', bars: 32,
    atmosphere: 0.42, spaceDb: 0, reverb: room('hall', { size: 1.7, tone: 0.42, preDelay: 0.035, shimmer: 0.15 }),
    tracks: [
      { name: 'Garage drums', inst: 'drums', preset: 'future-garage', vol: -10, space: 0.16, echo: 0.04 },
      { name: 'Dream pad', inst: 'supersaw', preset: 'dream-pad', vol: -12, space: 0.5, echo: 0.06,
        fx: [fx('pump', { source: 'kick', rate: '1', depth: 0.65, shape: 0.7 })] },
      { name: '808', inst: 'bass808', preset: 'garage-sub', vol: -18, space: 0, echo: 0 },
      { name: 'Vocal chops', inst: 'vocalchops', preset: 'slowed-chop', vol: -10, space: 0.4, echo: 0.18 },
    ],
    tips: [
      'Shuffled 2-step: double-click the Garage drums lane, open Beats, put a kick on 1 and one just before 3 (not four on the floor), claps on 2 and 4, then Swing about 55-65%.',
      'Sidechain pump: the Dream pad already has a Sidechain Pump keyed to the kick, so long pad chords duck on every kick you place (see it in Effects, All tools).',
      'Pitched-down chops: Vocal chops use the Slowed Chop preset. Press Z for a lower octave and play a few short notes per bar.',
      '808 glide: press the next key before you let go of the last and it slides (Glide knob, Sound tab). Stay on D# most of the time.',
      'Filter sweeps: in All tools, press A on the Dream pad and draw a Tone lane rising over 8 bars. It opens the pad into the next part.',
      'The black keys W E T Y U O P are D# minor pentatonic, five safe notes of D# minor. Add F (key F) and B (key J) for the full scale.',
      'Rhythm (deck): Add a groove > Future garage writes a shuffled 2-step to start from (edit it in Beats); Breathe on Vocal chops makes them pulse with its kick.',
    ],
  },
  {
    id: 'ambient', title: 'Pure ambient', sub: 'drone, pad, felt piano', line: 'A low drone, a tape pad and a felt piano in a big room. Start here.',
    region: 'ambient', bpm: 64, key: 'F#', scale: 'major-penta', scaleName: 'Major pentatonic', bars: 32,
    atmosphere: 0.6, spaceDb: 0, reverb: room('hall', { size: 1.8, tone: 0.45, preDelay: 0.03, shimmer: 0.12 }),
    tracks: [
      { name: 'Low drone', inst: 'drone', preset: 'warm-sub', vol: -12, space: 0.15 },
      { name: 'Tape pad', inst: 'tapepad', preset: 'warm-pad', vol: -10, space: 0.5, echo: 0.08 },
      { name: 'Felt piano', inst: 'felt', preset: 'felt-upright', vol: -8, space: 0.45, echo: 0.15 },
    ],
    tips: [
      'Start with the Low drone: hold F# (key T) for 8 bars or more. Everything else floats on top of it.',
      'F# major pentatonic is exactly the five black keys: W E T Y U O P (F# G# A# C# D#). You cannot play a wrong note there.',
      'On the Tape pad, hold two or three black keys together for 2-4 bars, then let them fade. Slow changes feel calm.',
      'The Felt piano plays only a few notes: one, wait, another. The gaps are where the room rings.',
      'Space (the blue knob) makes the room bigger, Atmos adds air. Turn them down if the notes blur.',
      'Rhythm (deck): Add a groove > Heartbeat pulse puts a soft kick and shaker under the drone; Breathe on the Tape pad makes it pulse with it.',
    ],
  },
];
export const starterById = id => STARTERS.find(s => s.id === id) || null;

/** Flow tips for every style (and for any tape without a starter), pointed at the tape's home note. */
export function flowTips(key) {
  const pc = pcOf(key), home = NOTE[pc];
  return [
    'Flow · Call and response: play a phrase, then repeat it with one note changed. Record with R, press Duplicate (Ctrl+D), move one note in Notes.',
    `Flow · End phrases on the home note, ${home} (key ${keyList(pc)}). It sounds like coming home.`,
    'Flow · A phrase is as long as a breath: breathe in, play while you breathe out, stop when the breath runs out.',
    'Flow · Add one layer every 4-8 bars and take them away near the end. Try it first with each track\'s M (mute) key.',
  ];
}

// ---------------------------------------------------------------- projects
const base0 = () => ({ schema: 'nfx-studio/1', beatsPerBar: 4, createdAt: Date.now(), updatedAt: Date.now() });
const newId = () => 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

export function blankProject({ buses }) {
  return { ...base0(), id: newId(), name: 'Untitled tape', bpm: 70, key: 'C', scale: 'major', lengthBars: 16,
    loop: { on: false, startBeat: 0, endBeat: 16 }, tracks: [], buses: JSON.parse(JSON.stringify(buses)), master: { volumeDb: 0, atmosphere: 0.5, fx: [] } };
}

export function starterProject(st, { instruments, buses, colors, uid }) {
  const B = 4, len = st.bars * B;
  const tracks = st.tracks.map((o, i) => {
    const def = instruments.find(d => d.id === o.inst) || instruments[0];
    const preset = def.presets.some(p => p.id === o.preset) ? o.preset : def.presets[0]?.id || '';
    const t = { id: uid('t'), name: o.name, color: colors[i % colors.length], kind: 'instrument', instrument: { id: def.id, preset, params: { ...(o.params || {}) } },
      volumeDb: o.vol ?? -8, pan: o.pan ?? 0, mute: false, solo: false, sends: { space: o.space ?? 0.4, echo: o.echo ?? 0 }, fx: JSON.parse(JSON.stringify(o.fx || [])), clips: [] };
    // a rain/wind texture only sounds while a note is held: one long held note under the whole tape (a bed, not music)
    if (o.bed) t.clips.push({ id: uid('c'), name: o.name, startBeat: 0, lengthBeats: len, notes: [{ p: 60, s: 0, d: len - 0.5, v: 0.5 }] });
    return t;
  });
  const b = JSON.parse(JSON.stringify(buses));
  b.space = { ...(b.space || {}), returnDb: st.spaceDb ?? 0, fx: [fx(st.reverb.shimmer > 0 ? 'shimmer' : 'reverb', { ...st.reverb })] };
  return { ...base0(), id: newId(), name: `${st.title.split(' /')[0]} tape`, starter: st.id, bpm: st.bpm, key: st.key, scale: st.scale, lengthBars: st.bars,
    loop: { on: false, startBeat: 0, endBeat: 4 * B }, tracks, buses: b, master: { volumeDb: -2, atmosphere: st.atmosphere ?? 0.5, fx: [] } };
}

/** The guide for a tape, shaped like a recipe for recipes-panel openTips (title, region, bpm/key/scale, steps). */
export function guideFor(p, scaleName = s => s) {
  const st = starterById(p?.starter);
  const common = { bpm: p.bpm, key: p.key, scale: p.scale, project: { lengthBars: p.lengthBars, beatsPerBar: p.beatsPerBar || 4 } };
  if (st) return { ...common, id: 'guide-' + st.id, title: `${st.title} · style guide`, region: st.region, scaleName: st.key === p.key && st.scale === p.scale ? st.scaleName : scaleName(p.scale),
    steps: [...(st.key === p.key && st.scale === p.scale ? st.tips : st.tips.filter(t => !/black keys|white keys/i.test(t))), ...flowTips(p.key)] };
  return { ...common, id: 'guide-flow', title: 'Make it flow', region: 'ambient', scaleName: scaleName(p.scale),
    steps: [...flowTips(p.key), 'Flow · Rhythm (deck): Add a groove for a soft pulse that starts after the intro, and Breathe on a pad to make it pulse with it. Click and the count-in keep you in time; Tighten (Notes) keeps your feel.'] };
}

// ---------------------------------------------------------------- the chooser
const REGION_COLOR = { korea: 'var(--signal)', china: 'var(--saffron)', japan: 'var(--cobalt)', garage: '#9B85E8', ambient: 'var(--leaf)' };
let open = null;
export const isChooserOpen = () => !!open;
export function closeChooser() { open?.close(); }

export function openChooser({ onPick }) {
  closeChooser();
  const last = document.activeElement;
  const pick = async (choice, btn) => {
    if (busy) return; busy = true; btn.setAttribute('aria-busy', 'true');
    try { await onPick(choice); close(false); } catch (e) { console.warn('[slowreel] new tape', e); busy = false; btn.removeAttribute('aria-busy'); }
  };
  let busy = false;
  const blank = h('button', { class: 'key st-blank', id: 'st-blank', onclick: e => pick({ kind: 'blank' }, e.currentTarget) },
    h('span', { class: 'st-reel', 'aria-hidden': 'true' }, h('i'), h('i')),
    h('span', { class: 'st-txt' }, h('strong', { text: 'Blank tape' }), h('span', { text: 'Nothing on it yet. You add the first instrument.' })));
  const cards = STARTERS.map(st => h('button', { class: 'key st-card', id: `st-${st.id}`, style: { '--rc': REGION_COLOR[st.region] }, onclick: e => pick({ kind: 'starter', starter: st }, e.currentTarget) },
    h('span', { class: 'st-strip' }),
    h('span', { class: 'st-name' }, h('strong', { text: st.title }), h('span', { class: 'st-sub', text: st.sub })),
    h('span', { class: 'st-line', text: st.line }),
    h('span', { class: 'glass st-meta mono', text: `${st.bpm} BPM · ${st.key} ${st.scaleName}` }),
    h('span', { class: 'st-tracks', text: st.tracks.map(t => t.name).join(' · ') })));
  const closeBtn = h('button', { class: 'key sm sq', id: 'st-close', 'aria-label': 'Close' }, icon('close'));
  const dialog = h('div', { class: 'dialog st-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'st-title' },
    h('header', {}, h('h2', { id: 'st-title', text: 'Start a new tape' }), closeBtn),
    h('div', { class: 'dbody' }, blank,
      h('div', { class: 'st-head' }, h('span', { class: 'label', text: 'Or a style starter' }),
        h('p', { text: 'Sets the tempo, key, scale and room, and adds a few empty tracks. You play every note.' })),
      h('div', { class: 'st-grid' }, cards)),
    h('footer', {}, h('button', { class: 'key', id: 'st-cancel', text: 'Cancel', onclick: () => close() })));
  const scrim = h('div', { class: 'scrim st-scrim' }, dialog);
  closeBtn.onclick = () => close();
  scrim.addEventListener('pointerdown', e => { if (e.target === scrim && !busy) close(); });
  scrim.addEventListener('keydown', e => {
    e.stopPropagation();   // letters must not play the QWERTY piano behind the dialog, Space must not start the tape
    if (e.key === 'Escape' && !busy) { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const f = [...dialog.querySelectorAll('button:not([disabled])')]; const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  });
  scrim.addEventListener('keyup', e => e.stopPropagation());
  function close(restore = true) { if (!scrim.isConnected) return; scrim.remove(); open = null; if (restore) last?.focus?.(); }
  document.body.append(scrim);
  open = { close };
  blank.focus();
  return { close, element: scrim };
}
