// validate-night-garage.cjs - offline checks for the second demo, demo-night-garage.json, against the live definitions
// (instruments.js, synths.js, drums.js, sampler.js, effects.js, fx2.js, arp.js, ui/automation.js, ui/theory.js). No browser.
// Usage: cd /home/user/nicofoxheart/studio && node teams/tape/tests/validate-night-garage.cjs [path/to/project.json]
// Exit code 0 = PASS. Prints every failure, then a short summary (structure, voices, levels of evidence for each brief item).
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const FILE = path.resolve(process.argv[2] || path.join(ROOT, 'demo-night-garage.json'));
const imp = rel => import(pathToFileURL(path.join(ROOT, rel)).href);

(async () => {
  const [{ INSTRUMENTS }, { SYNTHS }, { DRUM_INSTRUMENTS, DRUM_MAP }, { SAMPLER, SLICE_BASE_MIDI }, { EFFECTS }, { FX2 }, arp, auto, theory, { SONGS }] =
    await Promise.all(['js/sound/instruments.js', 'js/sound/synths.js', 'js/sound/drums.js', 'js/sound/sampler.js', 'js/sound/effects.js',
      'js/sound/fx2.js', 'js/sound/arp.js', 'js/ui/automation.js', 'js/ui/theory.js', 'js/sound/songs.js'].map(imp));
  // instruments.js registers the round-2 defs itself now (integration): add them only if they are not there yet
  const INST = [...INSTRUMENTS, ...[...SYNTHS, ...DRUM_INSTRUMENTS, SAMPLER].filter(d => !INSTRUMENTS.includes(d))];
  const IMAP = Object.fromEntries(INST.map(i => [i.id, i]));
  const FXS = [...EFFECTS, ...FX2];
  const FMAP = Object.fromEntries(FXS.map(e => [e.id, e]));
  const fails = [], notes = [];
  const fail = (where, msg) => fails.push(`${where}: ${msg}`);
  const info = s => notes.push(s);
  const isNum = x => typeof x === 'number' && isFinite(x);
  const EPS = 1e-6;

  let P;
  try { P = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { console.log('FAIL: cannot read/parse', FILE, e.message); process.exit(1); }

  // ---------------------------------------------------------------- definitions sanity (ids unique across the registries)
  const dupI = INST.map(i => i.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dupI.length) fail('definitions', 'duplicate instrument ids ' + dupI.join(','));
  const dupF = FXS.map(e => e.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dupF.length) fail('definitions', 'duplicate effect ids ' + dupF.join(','));

  // a value against a param def (number range, enum option, toggle)
  function checkParam(where, def, key, val) {
    const pd = (def.params || []).find(p => p.id === key);
    if (!pd) return fail(where, `unknown param "${key}" for ${def.id}`);
    if (pd.type === 'enum' || Array.isArray(pd.options)) {
      if (!pd.options.some(o => String(o.value) === String(val))) fail(where, `${def.id}.${key} = ${JSON.stringify(val)} is not one of ${pd.options.map(o => o.value).join('|')}`);
      else if (pd.options.some(o => o.value === val) === false) fail(where, `${def.id}.${key} = ${JSON.stringify(val)} has the wrong type (options are ${typeof pd.options[0].value})`);
      return;
    }
    if (pd.type === 'toggle') { if (!(val === 0 || val === 1 || val === true || val === false)) fail(where, `${def.id}.${key} toggle must be 0/1, got ${val}`); return; }
    if (!isNum(val)) return fail(where, `${def.id}.${key} must be a number, got ${JSON.stringify(val)}`);
    if (val < pd.min - EPS || val > pd.max + EPS) fail(where, `${def.id}.${key} = ${val} outside ${pd.min}..${pd.max}`);
  }
  function checkFxList(where, list) {
    if (!Array.isArray(list)) return fail(where, 'fx must be an array');
    list.forEach((f, i) => {
      const w = `${where}.fx[${i}]`, d = FMAP[f?.id];
      if (!d) return fail(w, `unknown effect id "${f?.id}"`);
      if (typeof f.bypass !== 'boolean') fail(w, 'bypass must be true/false');
      for (const [k, v] of Object.entries(f.params || {})) { if (k === 'keyTrack' && f.id === 'pump') continue; checkParam(w, d, k, v); }
    });
  }

  // ---------------------------------------------------------------- project header
  const bpb = P.beatsPerBar;
  if (P.schema !== 'nfx-studio/1') fail('project', `schema "${P.schema}" (want nfx-studio/1)`);
  if (P.name !== 'Night Garage') fail('project', `name "${P.name}"`);
  if (!/slowreel/i.test(P.credit || '')) fail('project', 'credit must name the Slowreel team');
  if (!isNum(P.bpm) || P.bpm < 20 || P.bpm > 300) fail('project', 'bpm ' + P.bpm);
  if (bpb !== 4) fail('project', 'beatsPerBar ' + bpb);
  if (!theory.NOTE_NAMES.includes(P.key)) fail('project', 'key ' + P.key);
  if (!theory.SCALES.some(s => s.id === P.scale)) fail('project', 'scale ' + P.scale);
  if (!Number.isInteger(P.lengthBars) || P.lengthBars < 1) fail('project', 'lengthBars ' + P.lengthBars);
  const endBeat = P.lengthBars * bpb, seconds = endBeat * 60 / P.bpm;
  if (seconds < 90 || seconds > 150) fail('project', `length ${seconds.toFixed(1)} s is outside 1:30-2:30`);
  if (!P.loop || typeof P.loop.on !== 'boolean' || !(P.loop.endBeat > P.loop.startBeat) || P.loop.endBeat > endBeat) fail('project', 'loop region');
  for (const s of P.sections || []) if (!(s.startBeat >= 0 && s.endBeat > s.startBeat && s.endBeat <= endBeat)) fail('project', 'section ' + s.name);
  if (!Array.isArray(P.tracks) || !P.tracks.length) fail('project', 'no tracks');

  // ---------------------------------------------------------------- buses and master
  for (const b of ['space', 'echo']) {
    const bus = P.buses?.[b]; if (!bus) { fail('buses', 'missing ' + b); continue; }
    if (!isNum(bus.returnDb) || bus.returnDb < -60 || bus.returnDb > 6) fail('buses.' + b, 'returnDb ' + bus.returnDb);
    checkFxList('buses.' + b, bus.fx);
    for (const f of bus.fx || []) if (f.params?.mix !== undefined && f.params.mix !== 1) fail('buses.' + b, `${f.id} on a bus should use mix 1`);
  }
  const room = (P.buses?.space?.fx || []).find(f => f.id === 'reverb' || f.id === 'shimmer');
  if (!room) fail('buses.space', 'needs a reverb / shimmer');
  else if (!((room.params?.size ?? 1) >= 1.4 && ['hall', 'cathedral', 'infinite'].includes(room.params?.type))) fail('buses.space', 'Space reverb is not generous (want hall/cathedral, size >= 1.4)');
  if (!isNum(P.master?.volumeDb) || P.master.volumeDb > 0) fail('master', 'volumeDb must be <= 0 (quiet mastering)');
  if (!isNum(P.master?.atmosphere) || P.master.atmosphere < 0 || P.master.atmosphere > 1) fail('master', 'atmosphere');
  checkFxList('master', P.master?.fx || []);
  for (const f of P.master?.fx || []) if (f.id === 'glue' && (f.params.makeup > 1 || f.params.ratio > 3)) fail('master', 'glue is pushing loudness (makeup <= 1 dB, ratio <= 3)');

  // ---------------------------------------------------------------- tracks
  const ids = new Set(), clipIds = new Set();
  const inScale = m => theory.inScale(m, P.key, P.scale);
  const DRUM_SET = new Set(DRUM_MAP.map(d => d.midi));
  const found = { garage: false, swungNotes: 0, pumpPad: false, chop: null, glides: 0, arp: null, rain: false, sweep: [], sendSwell: [] };
  let outOfScale = 0, pitchedNotes = 0, maxStack = {};

  for (const [ti, t] of P.tracks.entries()) {
    const W = `track ${t.id || ti}`;
    if (!t.id || ids.has(t.id)) fail(W, 'missing or duplicate id'); ids.add(t.id);
    if (!t.name) fail(W, 'no name');
    if (t.kind !== 'instrument' && t.kind !== 'song') fail(W, 'kind ' + t.kind);
    if (!isNum(t.volumeDb) || t.volumeDb < -60 || t.volumeDb > 6) fail(W, 'volumeDb ' + t.volumeDb);
    if (!isNum(t.pan) || t.pan < -1 || t.pan > 1) fail(W, 'pan ' + t.pan);
    for (const s of ['space', 'echo']) if (!isNum(t.sends?.[s]) || t.sends[s] < 0 || t.sends[s] > 1.5) fail(W, `sends.${s} ${t.sends?.[s]}`);
    if (typeof t.mute !== 'boolean' || typeof t.solo !== 'boolean') fail(W, 'mute/solo must be booleans');
    checkFxList(W, t.fx);
    if (t.kind === 'song') continue;

    // instrument, preset, params
    const def = IMAP[t.instrument?.id];
    if (!def) { fail(W, `unknown instrument "${t.instrument?.id}"`); continue; }
    if (!def.presets.some(p => p.id === t.instrument.preset)) fail(W, `preset "${t.instrument.preset}" is not a ${def.id} preset (${def.presets.map(p => p.id).join(', ')})`);
    for (const [k, v] of Object.entries(t.instrument.params || {})) checkParam(W, def, k, v);
    const preset = def.presets.find(p => p.id === t.instrument.preset) || { params: {} };
    const params = {}; for (const p of def.params) params[p.id] = p.default; Object.assign(params, preset.params, t.instrument.params);

    // arpeggiator
    if (t.arp !== undefined) {
      for (const [k, v] of Object.entries(t.arp)) {
        const pd = arp.ARP_PARAMS.find(p => p.id === k);
        if (!pd) { fail(W, 'unknown arp setting ' + k); continue; }
        checkParam(W + '.arp', { id: 'arp', params: arp.ARP_PARAMS }, k, v);
      }
    }
    const arpOn = arp.arpSettings(t.arp || {}).on;

    // note range for this instrument
    let lo = 21, hi = 108, rangeName = 'piano range';
    if (def.id === 'drums') { lo = 36; hi = 51; rangeName = 'drum map'; }
    if (def.id === 'bass808') { lo = 24; hi = 55; rangeName = '808 range'; }
    if (def.id === 'chop') { lo = SLICE_BASE_MIDI; hi = SLICE_BASE_MIDI + Math.round(params.slices) - 1; rangeName = `slices C3..+${Math.round(params.slices) - 1}`; }

    // clips
    const clips = t.clips || [];
    const spans = [];
    for (const [ci, c] of clips.entries()) {
      const CW = `${W} clip ${c.id || ci}`;
      if (!c.id || clipIds.has(c.id)) fail(CW, 'missing or duplicate clip id'); clipIds.add(c.id);
      if (!isNum(c.startBeat) || c.startBeat < 0) fail(CW, 'startBeat ' + c.startBeat);
      if (!isNum(c.lengthBeats) || c.lengthBeats <= 0) fail(CW, 'lengthBeats ' + c.lengthBeats);
      if (c.startBeat + c.lengthBeats > endBeat + EPS) fail(CW, `ends at beat ${c.startBeat + c.lengthBeats}, after the project end ${endBeat}`);
      spans.push([c.startBeat, c.startBeat + c.lengthBeats, c.id]);
      for (const [ni, n] of (c.notes || []).entries()) {
        const NW = `${CW} note ${ni}`;
        if (!Number.isInteger(n.p) || n.p < lo || n.p > hi) fail(NW, `pitch ${n.p} outside ${rangeName} ${lo}..${hi}`);
        if (!isNum(n.s) || n.s < 0 || n.s >= c.lengthBeats) fail(NW, `start ${n.s} outside the clip (0..${c.lengthBeats})`);
        if (!isNum(n.d) || n.d <= 0) fail(NW, 'duration ' + n.d);
        else if (n.s + n.d > c.lengthBeats + EPS) fail(NW, `ends at ${n.s + n.d}, past the clip end ${c.lengthBeats}`);
        if (!isNum(n.v) || n.v <= 0 || n.v > 1) fail(NW, 'velocity ' + n.v);
        if (!['drums', 'chop', 'texture'].includes(def.id)) { pitchedNotes++; if (!inScale(n.p)) outOfScale++; }
      }
      // drum clips: step-editor metadata and swing stored as note offsets
      if (def.id === 'drums') {
        const b = c.beat;
        if (!b) fail(CW, 'drum clip has no clip.beat (step editor metadata)');
        else {
          if (b.steps !== Math.round(c.lengthBeats * 4) || b.steps > 128 || b.steps < 4) fail(CW, `beat.steps ${b.steps} (want lengthBeats x 4, at most 128)`);
          if (!isNum(b.swing) || b.swing < 0 || b.swing > 0.75) fail(CW, 'beat.swing ' + b.swing);
          if (!Array.isArray(b.mute) || !Array.isArray(b.muted)) fail(CW, 'beat.mute / beat.muted must be arrays');
          const sw = b.swing || 0, pos = k => Math.round((k * 0.25 + (k % 2 ? sw * 0.25 : 0)) * 1e4) / 1e4;
          for (const n of c.notes || []) {
            if (!DRUM_SET.has(n.p)) continue;
            const q0 = Math.floor(n.s / 0.25 + 1e-6);
            const k1 = [q0, q0 - 1].find(q => q >= 0 && Math.abs(pos(q) - n.s) < 1e-3);   // the step this note sits on
            if (k1 === undefined) fail(CW, `drum note ${n.p} at ${n.s} is off the swung 16th grid`);
            else { if (k1 >= b.steps) fail(CW, `drum note at step ${k1} >= steps ${b.steps}`); if (k1 % 2 === 1 && sw > 0) found.swungNotes++; }
          }
        }
        if (t.instrument.preset === 'future-garage') found.garage = true;
      }
      // 808 glides: a note that starts while the previous one still holds
      if (def.id === 'bass808') {
        const ns = (c.notes || []).slice().sort((a, b) => a.s - b.s);
        for (let i = 1; i < ns.length; i++) if (ns[i - 1].s + ns[i - 1].d > ns[i].s + 0.01 && ns[i - 1].s < ns[i].s - 0.01 && ns[i].p !== ns[i - 1].p) found.glides++;
      }
      // polyphony: most notes sounding at once (after the arp), against maxVoices
      const played = arpOn ? arp.arpProcess(c.notes || [], t.arp, P.bpm, c.lengthBeats) : (c.notes || []);
      if (arpOn) {
        if (!played.length) fail(CW, 'arp produces no notes');
        for (const n of played) if (n.s < 0 || n.s + n.d > c.lengthBeats + EPS) fail(CW, 'arp note outside the clip');
        for (const n of played) if (n.p > 108) fail(CW, `arp reaches MIDI ${n.p}, too high`);
      }
      const ev = []; for (const n of played) { ev.push([n.s, 1]); ev.push([n.s + n.d, -1]); }
      ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let cur = 0, mx = 0; for (const [, d] of ev) { cur += d; mx = Math.max(mx, cur); }
      maxStack[t.id] = Math.max(maxStack[t.id] || 0, mx);
    }
    spans.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i++) if (spans[i][0] < spans[i - 1][1] - EPS) fail(W, `clips ${spans[i - 1][2]} and ${spans[i][2]} overlap`);
    if (def.id !== 'drums' && maxStack[t.id] > def.maxVoices) fail(W, `${maxStack[t.id]} notes at once > maxVoices ${def.maxVoices}`);

    // chop sampler specifics
    if (def.id === 'chop') {
      const smp = t.instrument.sample, sid = smp?.sampleId || '';
      const m = /^song:(.+)$/.exec(sid), song = m && SONGS.find(s => s.id === m[1]);
      if (!song) fail(W, `sample id "${sid}" is not 'song:<one of Nico's songs>'`);
      if (song && params.song !== song.id) fail(W, `params.song (${params.song}) differs from the sample (${song.id})`);
      if (!smp?.name) fail(W, 'sample.name missing (shown as "re-import <name>")');
      if (song) {
        const len = Math.min(params.length, song.duration), a = Math.min(params.position * song.duration, song.duration - len);
        if (params.position * song.duration + params.length > song.duration + 0.05) fail(W, 'the region runs past the end of the song');
        const rate = 1 - 0.25 * params.slowed, st = 12 * Math.log2(rate) + params.pitch;
        if (Math.abs(st - Math.round(st)) > 0.02) fail(W, `Slowed + pitch = ${st.toFixed(3)} semitones: not a whole semitone, the chops would be out of tune`);
        found.chop = `${song.title} ${a.toFixed(1)}-${(a + len).toFixed(1)} s, ${Math.round(params.slices)} ${params.sliceMode} slices, ${st.toFixed(2)} st`;
      }
      const sl = t.instrument.slices;
      if (sl !== undefined) {
        if (!Array.isArray(sl) || sl.length > Math.round(params.slices)) fail(W, 'instrument.slices must be an array no longer than params.slices');
        for (const [i, e] of (sl || []).entries()) {
          if (!e) continue;
          if (e.pitch !== undefined && (!isNum(e.pitch) || e.pitch < -24 || e.pitch > 24)) fail(W, `slice ${i} pitch ${e.pitch}`);
          if (e.reverse !== undefined && typeof e.reverse !== 'boolean') fail(W, `slice ${i} reverse must be boolean`);
          const s0 = e.start ?? 0, s1 = e.end ?? 1;
          if (!(s0 >= 0 && s1 <= 1 && s1 - s0 >= 0.02)) fail(W, `slice ${i} start/end ${s0}..${s1}`);
        }
      }
    }
    // brief items
    if (def.id === 'supersaw' && (t.fx || []).some(f => f.id === 'pump' && !f.bypass)) found.pumpPad = true;
    if ((def.id === 'fmkeys' || def.id === 'synthpluck') && arpOn) found.arp = `${def.name} (${t.arp.rate}, ${t.arp.pattern}, ${t.arp.octaves} oct)`;
    if (def.id === 'texture' && params.noise === 'nightrain') found.rain = true;

    // automation lanes
    const targets = auto.automationTargets(t, { instruments: INST, effects: FXS });
    for (const [li, l] of (t.automation || []).entries()) {
      const LW = `${W} automation ${li} (${l.target}|${l.param})`;
      const tg = targets.find(x => x.target === l.target && x.param === l.param);
      if (!tg) { fail(LW, 'not an automatable target of this track'); continue; }
      if (l.curve !== undefined && l.curve !== 'linear' && l.curve !== 'smooth') fail(LW, 'curve ' + l.curve);
      if (!Array.isArray(l.points) || l.points.length < 2) fail(LW, 'needs at least 2 points');
      let prev = -Infinity;
      for (const p of l.points || []) {
        if (!isNum(p.beat) || p.beat < 0 || p.beat > endBeat) fail(LW, `point beat ${p.beat} outside 0..${endBeat}`);
        if (p.beat < prev) fail(LW, 'points not in beat order');
        prev = p.beat;
        if (!isNum(p.value) || p.value < tg.min - EPS || p.value > tg.max + EPS) fail(LW, `value ${p.value} outside ${tg.min}..${tg.max}`);
      }
      const vals = (l.points || []).map(p => p.value), span = Math.max(...vals) / Math.max(1e-9, Math.min(...vals));
      const fx = /^fx:(\d+)$/.exec(l.target); const fxId = fx && t.fx[+fx[1]]?.id;
      if ((fxId === 'autofilter' || fxId === 'filter') && l.param === 'cutoff' && span >= 4) found.sweep.push(`${t.name}: ${fxId} cutoff ${Math.min(...vals)}-${Math.max(...vals)} Hz`);
      if (l.target === 'track' && l.param === 'sends.space' && Math.max(...vals) - Math.min(...vals) >= 0.5) found.sendSwell.push(`${t.name}: space send ${Math.min(...vals)}-${Math.max(...vals)}`);
    }
  }

  // ---------------------------------------------------------------- brief checklist
  if (!found.garage) fail('brief', 'no Drum Machine track on the Future Garage kit');
  if (found.swungNotes < 16) fail('brief', 'drum swing is not stored in the note offsets');
  if (!found.pumpPad) fail('brief', 'no Supersaw pad with Sidechain Pump');
  if (!found.chop) fail('brief', 'no Chop Sampler track on one of Nico\'s songs');
  if (found.glides < 4) fail('brief', `808 has only ${found.glides} glides`);
  if (!found.arp) fail('brief', 'no FM E-Piano / Pluck Synth with the arpeggiator on');
  if (!found.rain) fail('brief', 'no Night Rain texture');
  if (!found.sweep.length) fail('brief', 'no filter-sweep automation (Auto Filter or Filter cutoff)');
  if (!found.sendSwell.length) fail('brief', 'no reverb-send swell lane');
  if (outOfScale) fail('harmony', `${outOfScale} of ${pitchedNotes} pitched notes are outside ${P.key} ${P.scale}`);

  info(`${P.name}: ${P.bpm} BPM, ${P.key} ${P.scale}, ${P.lengthBars} bars = ${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}, ${P.tracks.length} tracks`);
  info('sections: ' + (P.sections || []).map(s => `${s.name} bars ${s.startBeat / bpb + 1}-${s.endBeat / bpb}`).join(', '));
  info(`chops: ${found.chop}; arp: ${found.arp}; 808 glides: ${found.glides}; swung drum notes: ${found.swungNotes}`);
  info('sweeps: ' + found.sweep.join('; ') + ' | swells: ' + found.sendSwell.join('; '));
  info('most notes at once: ' + Object.entries(maxStack).map(([k, v]) => `${k} ${v}`).join(', ') + `; pitched notes in key: ${pitchedNotes - outOfScale}/${pitchedNotes}`);
  for (const n of notes) console.log('  ' + n);
  if (fails.length) { console.log(`FAIL (${fails.length})`); for (const f of fails.slice(0, 80)) console.log('  - ' + f); if (fails.length > 80) console.log(`  ... ${fails.length - 80} more`); process.exit(1); }
  console.log('PASS: every instrument, preset, effect, param range, note range, clip bound, drum grid, arp setting and automation target checks out');
})().catch(e => { console.error('FAIL: validator crashed', e); process.exit(1); });
