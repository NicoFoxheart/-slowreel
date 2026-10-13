// Generator for teams/tape/demo-night-garage.json (scratch tool; the JSON is the deliverable).
const fs = require('fs');
const OUT = '/home/user/nicofoxheart/studio/teams/tape/demo-night-garage.json';
const r4 = x => Math.round(x * 10000) / 10000;
let seed = 20261013; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const hv = (v, amt = 0.06) => r4(Math.max(0.05, Math.min(1, v + (rnd() * 2 - 1) * amt)));   // humanized velocity
const BAR = n => 4 * (n - 1);           // bar number (1-based) -> beat
const SWING = 0.36, STEP = 0.25;        // drums: odd 16ths late by 0.36 x 1/16 (about 59 % MPC swing)
const stepPos = k => r4(k * STEP + (k % 2 === 1 ? SWING * STEP : 0));
const sw = b => { const k = Math.round(b / STEP); return Math.abs(k * STEP - b) < 1e-6 && k % 2 === 1 ? r4(b + SWING * STEP) : r4(b); };
let cid = 0;
function clip(startBeat, lengthBeats, absNotes, extra = {}) {
  const notes = absNotes.map(n => { const s = r4(n.s - startBeat); return { p: n.p, s, d: r4(Math.min(n.d, lengthBeats - s)), v: r4(n.v) }; })
    .filter(n => n.s >= 0 && n.s < lengthBeats).sort((a, b) => a.s - b.s || a.p - b.p);
  return { id: 'ng-c' + (++cid), startBeat, lengthBeats, notes, ...extra };
}

// ---------------------------------------------------------------- harmony (F# minor / A major, "royal road" IVmaj7-V-iii7-vi)
const CYCLE_A = ['Dmaj7', 'Eadd9', 'C#m7', 'F#m9'];
const CYCLE_B = ['Bm9', 'Dmaj9', 'Amaj7', 'Esus2'];
const PAD = { Dmaj7: [50, 57, 61, 66], Eadd9: [52, 56, 59, 66], 'C#m7': [49, 56, 59, 64], 'F#m9': [57, 61, 64, 68],
  Bm9: [50, 54, 57, 61], Dmaj9: [54, 57, 61, 64], Amaj7: [52, 57, 61, 68], Esus2: [52, 59, 66, 71] };
const KEYS = { Dmaj7: [62, 66, 69, 73], Eadd9: [64, 66, 68, 71], 'C#m7': [61, 64, 68, 71], 'F#m9': [64, 66, 69, 73],
  Bm9: [61, 62, 66, 69], Dmaj9: [64, 66, 69, 73], Amaj7: [61, 64, 68, 69], Esus2: [64, 66, 71, 73] };
const ROOT = { Dmaj7: 38, Eadd9: 40, 'C#m7': 37, 'F#m9': 30, Bm9: 35, Dmaj9: 38, Amaj7: 33, Esus2: 40 };
// bar -> chord
const SECTIONS = [
  { name: 'Intro', from: 1, to: 8, cycle: CYCLE_A }, { name: 'Drop A', from: 9, to: 24, cycle: CYCLE_A },
  { name: 'Breakdown', from: 25, to: 32, cycle: CYCLE_B }, { name: 'Build', from: 33, to: 40, cycle: CYCLE_A },
  { name: 'Drop B', from: 41, to: 56, cycle: CYCLE_A }, { name: 'Outro', from: 57, to: 64, cycle: CYCLE_A },
];
const chordAt = bar => { const s = SECTIONS.find(x => bar >= x.from && bar <= x.to); return s.cycle[(bar - s.from) % 4]; };
const bars = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; };

// ---------------------------------------------------------------- tracks
const tracks = [];
const T = (o) => {
  const t = { id: o.id, name: o.name, color: o.color, kind: 'instrument', instrument: o.instrument };
  if (o.arp) t.arp = o.arp;
  Object.assign(t, { volumeDb: o.volumeDb ?? 0, pan: o.pan ?? 0, mute: false, solo: false, sends: o.sends, fx: o.fx || [], clips: o.clips, automation: o.automation || [] });
  tracks.push(t); return t;
};

// 1. Night rain: one long note, volume lane rides the arc
T({ id: 'rain', name: 'Night rain', color: '#5A6168', instrument: { id: 'texture', preset: 'night-rain', params: { tone: 0.5, density: 0.4, motion: 0.45 } },
  volumeDb: -12, sends: { space: 0.15, echo: 0 },
  clips: [clip(0, 256, [{ p: 60, s: 0, d: 254, v: 0.55 }])],
  automation: [{ target: 'track', param: 'volumeDb', curve: 'smooth', points: [
    { beat: 0, value: -9 }, { beat: 28, value: -10 }, { beat: 32, value: -16 }, { beat: 92, value: -16 }, { beat: 100, value: -11 },
    { beat: 152, value: -12 }, { beat: 160, value: -16 }, { beat: 220, value: -16 }, { beat: 232, value: -9 }, { beat: 248, value: -10 }, { beat: 256, value: -24 } ] }] });

// 2. Drums: Future Garage kit, shuffled 2-step, swing written into note offsets (step editor compatible)
const drumNotes = [];
const hit = (bar, step, p, v) => drumNotes.push({ p, s: BAR(bar) + stepPos(step), d: STEP, v: hv(v, 0.04) });
function twoStep(bar, o = {}) {
  const pos = (bar - 1) % 4;   // place in the 4-bar phrase
  if (!o.noKick) { hit(bar, 0, 36, 1); hit(bar, 10, 36, 0.8); if (pos === 3) hit(bar, 7, 36, 0.55); if (pos === 1 && o.extra) hit(bar, 15, 36, 0.45); }
  if (!o.noSnare) { hit(bar, 4, 38, 0.85); hit(bar, 12, 38, 0.88); hit(bar, 12, 39, 0.5); hit(bar, 15, 40, 0.34); if (pos % 2 === 1) hit(bar, 7, 40, 0.3); }
  for (const k of [2, 6, 10, 14]) { if (k === 14 && pos === 3) continue; hit(bar, k, 42, o.hat ?? 0.55); }
  for (const k of [3, 11]) hit(bar, k, 42, (o.hat ?? 0.55) * 0.55);
  if (pos === 3 || o.openHats) hit(bar, 14, 46, 0.45);
  for (let k = 1; k < 16; k += 2) hit(bar, k, 44, k % 4 === 3 ? 0.3 : 0.2);
  if (pos % 2 === 0) hit(bar, 9, 37, 0.38);
  if (o.cowbell && pos === 1) hit(bar, 14, 47, 0.3);
}
// intro bars 5-8: shaker + soft hats + rim, riser bars 7-8
for (const b of bars(5, 8)) {
  for (let k = 1; k < 16; k += 2) hit(b, k, 44, 0.16 + (b - 5) * 0.03);
  for (const k of [2, 6, 10, 14]) hit(b, k, 42, 0.28 + (b - 5) * 0.04);
  if (b >= 6) hit(b, 12, 37, 0.32);
}
drumNotes.push({ p: 50, s: BAR(7), d: 8, v: 0.75 });
// drop A bars 9-24
drumNotes.push({ p: 49, s: BAR(9), d: 4, v: 0.55 });
for (const b of bars(9, 24)) twoStep(b, { extra: b > 16 });
// end of drop A: ghost-snare pickup into the breakdown
for (const [k, v] of [[13, 0.3], [14, 0.4], [15, 0.5]]) hit(24, k, 40, v);
// breakdown: one boom on the downbeat, then air; build 33-40
drumNotes.push({ p: 51, s: BAR(25), d: 4, v: 0.7 });
drumNotes.push({ p: 49, s: BAR(25), d: 4, v: 0.35 });
for (const b of bars(33, 36)) { for (let k = 1; k < 16; k += 2) hit(b, k, 44, 0.2); hit(b, 4, 37, 0.32); hit(b, 12, 37, 0.38); }
for (const b of bars(37, 40)) {
  for (let k = 1; k < 16; k += 2) hit(b, k, 44, 0.24);
  if (b < 40) { hit(b, 0, 36, 0.8); hit(b, 10, 36, 0.6); }
  for (const k of [2, 6, 10, 14]) hit(b, k, 42, 0.4);
  hit(b, 12, 38, b === 40 ? 0.5 : 0.7);
  if (b === 40) for (const [k, v] of [[4, 0.3], [6, 0.36], [8, 0.42], [10, 0.5]]) hit(b, k, 40, v);
}
drumNotes.push({ p: 50, s: BAR(39), d: 8, v: 0.8 });
// drop B bars 41-56 (open hats on every phrase end, a soft phonk cowbell)
drumNotes.push({ p: 49, s: BAR(41), d: 4, v: 0.6 });
for (const b of bars(41, 56)) twoStep(b, { extra: true, cowbell: true });
// outro 57-64: kick and snare fall away, shaker and hats fade
for (const b of bars(57, 60)) twoStep(b, { noSnare: b > 58, hat: 0.45 - (b - 57) * 0.05 });
for (const b of bars(61, 64)) { for (let k = 1; k < 16; k += 2) hit(b, k, 44, 0.22 - (b - 61) * 0.035); if (b === 61) hit(b, 0, 51, 0.55); }
// drum clips: <= 8 bars each (the step editor shows up to 128 steps)
const drumClips = [];
for (const [a, b] of [[5, 8], [9, 16], [17, 24], [25, 32], [33, 40], [41, 48], [49, 56], [57, 64]]) {
  const s = BAR(a), L = (b - a + 1) * 4;
  drumClips.push(clip(s, L, drumNotes.filter(n => n.s >= s && n.s < s + L), { beat: { steps: L * 4, swing: SWING, mute: [], muted: [] } }));
}
// drum filter sweep (Filter cutoff, log-spaced points)
const sweep = (b0, b1, f0, f1, every = 1) => { const o = []; for (let b = b0; b <= b1 + 1e-9; b += every) { const x = (b - b0) / (b1 - b0); o.push({ beat: r4(b), value: Math.round(f0 * Math.pow(f1 / f0, x)) }); } return o; };
T({ id: 'drums', name: 'Garage drums', color: '#E8542F', instrument: { id: 'drums', preset: 'future-garage', params: { tone: 0.55, grit: 0.05, riserDecay: 2, hatLevel: 0.62 } },
  volumeDb: -10, pan: 0, sends: { space: 0.16, echo: 0.04 },
  fx: [{ id: 'filter', params: { mode: 'lowpass', cutoff: 18000, resonance: 0.9, motion: 0, rate: 0.12 }, bypass: false }],
  clips: drumClips,
  automation: [{ target: 'fx:0', param: 'cutoff', curve: 'linear', points: [
    ...sweep(16, 31, 500, 9000), { beat: 32, value: 18000 }, { beat: 96, value: 18000 }, { beat: 128, value: 700 },
    ...sweep(132, 159, 800, 11000), { beat: 160, value: 18000 }, { beat: 224, value: 18000 }, ...sweep(232, 256, 12000, 450, 2) ] }] });

// 3. 808 sub with glides (overlapping notes slide)
const bassNotes = [];
const B = (bar, s, p, d, v) => bassNotes.push({ p, s: BAR(bar) + sw(s), d, v: hv(v, 0.03) });
function bassBar(bar, o = {}) {
  const ch = chordAt(bar), R = ROOT[ch];
  if (ch === 'Eadd9') { B(bar, 0, R, 2.25, 0.9); B(bar, 2, R - 5, 1.25, 0.75); B(bar, 3.5, R, 0.45, 0.6); }          // slide down to B
  else if (ch === 'F#m9') { B(bar, 0, R, 2.25, 0.95); B(bar, 2, R + 12, 1.1, 0.7); B(bar, 3, R + 7, 0.95, 0.65); }    // octave slide, then C#
  else if (ch === 'Bm9' || ch === 'Amaj7') { B(bar, 0, R, 3.5, 0.85); }
  else { B(bar, 0, R, 1.5, 0.9); B(bar, 2.5, R, 0.7, 0.7); B(bar, 3.25, R + (ch === 'C#m7' ? 3 : -5), 0.6, 0.55); }
}
for (const b of [...bars(9, 24), ...bars(41, 56), ...bars(57, 58)]) bassBar(b);
for (const b of bars(37, 40)) { const R = ROOT[chordAt(b)]; B(b, 0, R, b === 40 ? 2 : 3.75, 0.55 + (b - 37) * 0.08); }
B(59, 0, ROOT[chordAt(59)], 3.5, 0.6); B(60, 0, ROOT[chordAt(60)], 3.6, 0.5); B(61, 0, 30, 7.5, 0.45);
T({ id: 'sub', name: '808 sub', color: '#7A63C8', instrument: { id: 'bass808', preset: 'deep-sub', params: { glide: 0.55, drive: 0.15, length: 0.6, punch: 0.35, tone: 0.42, bend: 2 } },
  volumeDb: -18, sends: { space: 0, echo: 0 },
  fx: [{ id: 'eq', params: { low: 0, mid: -2, high: -4, lowcut: 30 }, bypass: false }],
  clips: [clip(BAR(9), 64, bassNotes.filter(n => n.s < BAR(25))), clip(BAR(37), 16, bassNotes.filter(n => n.s >= BAR(37) && n.s < BAR(41))),
    clip(BAR(41), 64, bassNotes.filter(n => n.s >= BAR(41) && n.s < BAR(57))), clip(BAR(57), 32, bassNotes.filter(n => n.s >= BAR(57)))] });

// 4. Supersaw Dream Pad + Auto Filter (automated sweep) + Sidechain Pump keyed by the kick
const padNotes = [];
for (const b of bars(1, 64)) {
  const ch = chordAt(b), sec = SECTIONS.find(x => b >= x.from && b <= x.to).name;
  const v = { Intro: 0.5, 'Drop A': 0.6, Breakdown: 0.58, Build: 0.56, 'Drop B': 0.62, Outro: 0.52 }[sec];
  const last = b === 64;
  const voicing = last ? [54, 61, 64, 68] : PAD[ch];   // the last chord gets its root (F#m9 without the A, still 4 voices)
  voicing.forEach((p, i) => padNotes.push({ p, s: BAR(b) + i * 0.02, d: last ? 3.9 : 4.1 - i * 0.02, v: hv(v - i * 0.03, 0.03) }));
}
const padClips = [[1, 8], [9, 24], [25, 40], [41, 56], [57, 64]].map(([a, b]) => clip(BAR(a), (b - a + 1) * 4, padNotes.filter(n => n.s >= BAR(a) - 0.01 && n.s < BAR(b + 1) - 0.01)));
T({ id: 'pad', name: 'Dream pad', color: '#1E9A88', instrument: { id: 'supersaw', preset: 'dream-pad', params: { tone: 0.42, swell: 0.5, width: 0.9, release: 0.45, drift: 0.45 } },
  volumeDb: -8, sends: { space: 0.5, echo: 0.06 },
  fx: [{ id: 'autofilter', params: { mode: 'lowpass', rate: '16', cutoff: 3400, depth: 0.22, resonance: 1.1, shape: 'sine' }, bypass: false },
       { id: 'pump', params: { source: 'kick', rate: '1', depth: 0.75, shape: 0.7 }, bypass: false }],
  clips: padClips,
  automation: [{ target: 'fx:0', param: 'cutoff', curve: 'linear', points: [
    ...sweep(0, 31, 380, 3400), { beat: 92, value: 3400 }, ...sweep(94, 98, 3400, 1100, 1), { beat: 128, value: 1300 },
    ...sweep(130, 158, 1300, 5200), { beat: 160, value: 4200 }, { beat: 224, value: 4200 }, ...sweep(226, 254, 4200, 420, 2) ] }] });

// 5. Chop Sampler: "Hopeful Romantic" 0:28-0:52 (the melodic, bass-free section), 16 equal slices of 1.5 s,
//    Slowed exactly -3 semitones (rate 0.8409: C major -> A major, so it sits in F# minor), reversed swells into downbeats
const SL = { s0: 48, s2: 50, s3: 51, s4: 52, s5: 53, s6: 54, s7: 55, s8: 56, s9: 57, s10: 58, s12: 60, s13: 61 };
const FIT = { Dmaj7: ['s3', 's6', 's0'], Eadd9: ['s9', 's10', 's4'], 'C#m7': ['s12', 's9', 's2'], 'F#m9': ['s6', 's8', 's9'],
  Bm9: ['s3', 's5', 's13'], Dmaj9: ['s6', 's0', 's3'], Amaj7: ['s12', 's2', 's0'], Esus2: ['s10', 's0', 's4'] };
const chopNotes = [];
const C = (bar, s, slot, d, v) => chopNotes.push({ p: SL[slot] ?? slot, s: BAR(bar) + sw(s), d, v: hv(v, 0.05) });
const R1 = [[0, 0.5, 0], [0.75, 0.5, 0], [1.5, 0.75, 1], [2.75, 0.25, 0], [3, 0.75, 2]];
const R2 = [[0.5, 0.5, 0], [1.25, 0.5, 1], [2, 1, 2], [3.5, 0.5, 1]];
function chopBar(bar, o = {}) {
  const ch = chordAt(bar), f = FIT[ch], pos = (bar - 1) % 4, pat = (pos % 2 === 0) ? R1 : R2;
  for (const [s, d, i] of pat) C(bar, s, f[i], d, (o.v ?? 0.66) - (i === 2 ? 0.06 : 0));
  if (o.squeak && ch === 'F#m9') C(bar, 3.5, 's7', 0.5, 0.42);
}
// intro: long, washed chops, a reverse swell into bar 5 and into the drop
C(1, 0, 's6', 3, 0.5); C(2, 1, 's0', 2.5, 0.42); C(3, 0, 's3', 2.5, 0.48); C(4, 2, 49, 2, 0.5);   // 49 = slice 1 reversed
for (const b of bars(5, 7)) { const f = FIT[chordAt(b)]; C(b, 0, f[0], 1, 0.5); C(b, 1.5, f[1], 0.75, 0.42); C(b, 2.75, f[0], 0.5, 0.38); }
C(8, 0, FIT['F#m9'][0], 1.5, 0.5); C(8, 2, 63, 2, 0.58);                                              // 63 = slice 15 reversed
for (const b of bars(9, 24)) chopBar(b);
// breakdown: slow, held chops (each slice plays out, Slowed room on top), reverse swells every 4 bars
for (const b of bars(25, 32)) { const f = FIT[chordAt(b)]; C(b, 0, f[0], 2.5, 0.55); if (b % 4 === 0) C(b, 2, 63, 2, 0.5); else C(b, 2.5, f[1], 1.25, 0.45); }
for (const b of bars(33, 40)) { const f = FIT[chordAt(b)]; if (b < 37) { C(b, 0, f[0], 1.5, 0.5); C(b, 2, f[1], 1, 0.45); } else chopBar(b, { v: 0.5 + (b - 37) * 0.04 }); }
C(40, 2, 49, 2, 0.6);
for (const b of bars(41, 56)) chopBar(b, { squeak: true, v: 0.68 });
for (const b of bars(57, 60)) { const f = FIT[chordAt(b)]; C(b, 0, f[0], 1, 0.5 - (b - 57) * 0.04); C(b, 1.5, f[1], 0.75, 0.4); }
C(62, 0, 's6', 3, 0.42); C(63, 2, 63, 2, 0.4); C(64, 0, 's6', 3.5, 0.4);
const slices = Array.from({ length: 16 }, () => ({ pitch: 0, reverse: false, start: 0, end: 1 }));
slices[1] = { pitch: 0, reverse: true, start: 0, end: 0.5 };    // reversed attack: swells into the next downbeat (about 2 beats)
slices[15] = { pitch: 0, reverse: true, start: 0, end: 0.5 };
slices[7] = { pitch: 12, reverse: false, start: 0, end: 0.6 };  // an octave-up "vocal" squeak, short
const chopClips = [[1, 8], [9, 24], [25, 40], [41, 56], [57, 64]].map(([a, b]) => clip(BAR(a), (b - a + 1) * 4, chopNotes.filter(n => n.s >= BAR(a) && n.s < BAR(b + 1))));
T({ id: 'chops', name: 'Hopeful chops', color: '#F0A616',
  instrument: { id: 'chop', preset: 'vocal-chops', sample: { sampleId: 'song:hopeful-romantic', name: 'Hopeful Romantic' }, slices,
    params: { song: 'hopeful-romantic', position: 0.3357, length: 24, slices: 16, sliceMode: 'equal', slowed: 0.6364, pitch: 0, tone: 0.6, attack: 0.012, release: 0.3, loop: 0, level: 1 } },
  volumeDb: -4, pan: 0.08, sends: { space: 0.4, echo: 0.18 },
  fx: [{ id: 'eq', params: { low: -3, mid: 1, high: -2, lowcut: 170 }, bypass: false }, { id: 'chorus', params: { rate: 0.3, depth: 0.35, mix: 0.25 }, bypass: false }],
  clips: chopClips,
  automation: [{ target: 'track', param: 'sends.space', curve: 'smooth', points: [
    { beat: 0, value: 0.7 }, { beat: 30, value: 0.7 }, { beat: 32, value: 0.35 }, { beat: 88, value: 0.35 }, { beat: 95.5, value: 1.3 }, { beat: 100, value: 0.85 },
    { beat: 148, value: 0.85 }, { beat: 159.5, value: 1.4 }, { beat: 160, value: 0.35 }, { beat: 224, value: 0.4 }, { beat: 252, value: 1.4 } ] }] });

// 6. FM E-Piano through the arpeggiator (1/16, up-down, 2 octaves, swing matched to the drums)
const keyNotes = [];
const keyBars = [...bars(5, 8), ...bars(17, 24), ...bars(25, 40), ...bars(41, 56), ...bars(57, 60)];
for (const b of keyBars) {
  const ch = chordAt(b), sec = SECTIONS.find(x => b >= x.from && b <= x.to).name;
  const v = { Intro: 0.36, 'Drop A': 0.44, Breakdown: 0.52, Build: 0.48, 'Drop B': 0.46, Outro: 0.38 }[sec] - (sec === 'Outro' ? (b - 57) * 0.04 : 0);
  KEYS[ch].forEach(p => keyNotes.push({ p, s: BAR(b), d: 4, v: hv(v, 0.02) }));
}
const keyClips = [[5, 8], [17, 24], [25, 40], [41, 56], [57, 60]].map(([a, b]) => clip(BAR(a), (b - a + 1) * 4, keyNotes.filter(n => n.s >= BAR(a) && n.s < BAR(b + 1))));
T({ id: 'keys', name: 'Glass keys (arp)', color: '#2E5BD4', instrument: { id: 'fmkeys', preset: 'dream-keys', params: { bell: 0.35, decay: 0.45, tremolo: 0.3, tine: 0.3, warmth: 0.65 } },
  arp: { on: 1, rate: '1/16', pattern: 'updown', octaves: 2, gate: 0.45, swing: 0.72 },
  volumeDb: -11.5, pan: -0.18, sends: { space: 0.5, echo: 0.3 },
  fx: [{ id: 'tape', params: { drive: 0.15, age: 0.35, wow: 0.3, flutter: 0.2, hiss: 0 }, bypass: false }],
  clips: keyClips,
  automation: [{ target: 'track', param: 'sends.space', curve: 'smooth', points: [
    { beat: 96, value: 0.5 }, { beat: 124, value: 0.9 }, { beat: 128, value: 0.6 }, { beat: 156, value: 1.0 }, { beat: 160, value: 0.45 } ] }] });

// 7. Vox Pad "angel air": the wordless top line in the breakdown and drop B
const voxNotes = [];
const MEL_B = { Bm9: [[0, 4, 66]], Dmaj9: [[0, 4, 69]], Amaj7: [[0, 2, 68], [2, 2, 64]], Esus2: [[0, 4, 66]] };
const MEL_A = { Dmaj7: [[0, 4, 69]], Eadd9: [[0, 2, 68], [2, 2, 71]], 'C#m7': [[0, 4, 68]], 'F#m9': [[0, 2, 66], [2, 2, 64]] };
for (const b of [...bars(25, 40), ...bars(41, 56)]) {
  const ch = chordAt(b), m = (MEL_B[ch] || MEL_A[ch]);
  const v = b < 33 ? 0.5 : b < 41 ? 0.46 : 0.4;
  for (const [s, d, p] of m) voxNotes.push({ p, s: BAR(b) + s, d: d + 0.1, v: hv(v, 0.03) });
}
T({ id: 'vox', name: 'Air choir', color: '#D7678F', instrument: { id: 'voxpad', preset: 'angel-air', params: { vowel: 0.75, swell: 0.75 } },
  volumeDb: -9, pan: 0.15, sends: { space: 0.65, echo: 0.12 },
  fx: [{ id: 'pump', params: { source: 'kick', rate: '1', depth: 0.45, shape: 0.7 }, bypass: false }],
  clips: [clip(BAR(25), 64, voxNotes.filter(n => n.s < BAR(41))), clip(BAR(41), 64, voxNotes.filter(n => n.s >= BAR(41)))] });

const project = {
  schema: 'nfx-studio/1', id: 'demo-night-garage', name: 'Night Garage', bpm: 132, beatsPerBar: 4, key: 'F#', scale: 'minor', lengthBars: 64,
  loop: { on: false, startBeat: BAR(9), endBeat: BAR(17) },
  credit: 'Demo by the Slowreel team, with vocal-like chops from "Hopeful Romantic" by Nicofoxheart',
  sections: SECTIONS.map(s => ({ name: s.name, startBeat: BAR(s.from), endBeat: BAR(s.to + 1) })),
  tracks,
  buses: {
    space: { returnDb: 0, fx: [{ id: 'shimmer', params: { type: 'hall', mix: 1, size: 1.7, tone: 0.42, preDelay: 0.035, shimmer: 0.18 }, bypass: false }] },
    echo: { returnDb: -3, fx: [{ id: 'echo', params: { beats: 0.75, feedback: 0.5, tone: 0.35, wow: 0.35, drive: 0.25, spread: 0.85, mix: 1 }, bypass: false }] },
  },
  master: { volumeDb: 0, atmosphere: 0.42, fx: [{ id: 'glue', params: { threshold: -24, ratio: 1.5, makeup: 0 }, bypass: false }] },
  createdAt: 0, updatedAt: 0,
};
// one note / point / slice per line (leaf objects collapsed), everything else indented like demo.json
const txt = JSON.stringify(project, null, 1).replace(/\{\n\s+([^{}\[\]]*?)\n\s*\}/g, (m, body) => '{ ' + body.split(/,\n\s*/).join(', ') + ' }');
fs.writeFileSync(OUT, txt + '\n');
console.log('wrote', OUT, tracks.map(t => `${t.id}:${t.clips.reduce((a, c) => a + c.notes.length, 0)}`).join(' '));
