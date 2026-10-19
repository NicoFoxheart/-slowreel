// validate-recipes.cjs - offline checks for js/recipes/recipes.js (the 12 starter projects) against the live definitions.
//   cd /home/user/nicofoxheart/studio && node teams/tape/tests/validate-recipes.cjs            (static checks, < 1 s)
//   NODE_PATH=$(npm root -g) node teams/tape/tests/validate-recipes.cjs --render [id,id]      (+ offline renders, a few minutes)
// Exit code 0 = PASS. Static checks: recipe metadata, project schema (nfx-studio/1, like demo.json), every instrument /
// preset / param / effect id, note ranges per instrument, every pitched note inside the declared key + scale, clip
// bounds and overlaps, polyphony, and a quiet-mix budget. Instrument and scale ids that are not defined yet but are on
// the agreed list of new ids (being built in parallel) are reported as PENDING, not failures; once they are registered
// their presets / params / scale steps are checked like any other.
// --render: renders each recipe with the real engine in headless Chromium (Playwright), registering the round-2
// instruments (synths, drums, sampler) and any new instrument modules found in js/sound/, and standing in core
// instruments for ids still pending. Fails if a peak passes -6 dBFS (the limiter starts at -3), any sample clips or is NaN,
// or the loudness leaves -34..-20 LUFS (quiet but audible; the demo is -22.5 LUFS).
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const imp = rel => import(pathToFileURL(path.join(ROOT, rel)).href);

// the agreed new ids (another lane is building them); notes for janggu / taiko live on MIDI 36-40
const PENDING_INSTRUMENTS = ['gayageum', 'haegeum', 'daegeum', 'janggu', 'guzheng', 'erhu', 'dizi', 'pipa', 'templebells', 'koto', 'shakuhachi', 'shamisen', 'taiko', 'windchimes'];
const PENDING_SCALES = ['pyeongjo', 'gyemyeonjo', 'gong', 'shang', 'jue', 'zhi', 'yu', 'hirajoshi', 'in', 'yo', 'iwato', 'kumoi', 'ryukyu'];
// Fallback steps for pending scales (semitones from the key), used only until theory.js (or another module) defines them.
const FALLBACK_SCALES = {
  pyeongjo: [0, 2, 5, 7, 9], gyemyeonjo: [0, 3, 5, 7, 10],
  gong: [0, 2, 4, 7, 9], shang: [0, 2, 5, 7, 10], jue: [0, 3, 5, 8, 10], zhi: [0, 2, 5, 7, 9], yu: [0, 3, 5, 7, 10],
  hirajoshi: [0, 2, 3, 7, 8], in: [0, 1, 5, 7, 8], yo: [0, 2, 5, 7, 9], iwato: [0, 1, 5, 6, 10], kumoi: [0, 2, 3, 7, 9], ryukyu: [0, 4, 5, 7, 11],
};
// Natural ranges (MIDI) for the new instruments, so a recipe never asks a flute for a bass note.
const NATURAL = {
  gayageum: [43, 86], haegeum: [55, 91], daegeum: [55, 91], guzheng: [38, 93], erhu: [55, 93], dizi: [67, 96], pipa: [45, 91],
  koto: [43, 86], shakuhachi: [55, 88], shamisen: [48, 86], templebells: [36, 84], windchimes: [48, 84],   // chimes: the held note is the tuning root
  janggu: [36, 40], taiko: [36, 40], drums: [36, 51], bass808: [24, 55],
};
const UNPITCHED = new Set(['texture', 'cloud', 'drums', 'janggu', 'taiko', 'chop']);   // pitch is colour / transposition / a drum key
const REGIONS = ['korea', 'china', 'japan', 'ambient'];
const STAND_INS = {   // --render only, for ids still pending: [core instrument, preset, semitone shift]
  gayageum: ['pluck', 'koto', 0], guzheng: ['pluck', 'koto', 0], koto: ['pluck', 'koto', 0], pipa: ['pluck', 'nylon', 0], shamisen: ['pluck', 'toy-pluck', 0],
  haegeum: ['strings', 'solo-cello', 0], erhu: ['strings', 'solo-cello', 0],
  daegeum: ['tapepad', 'tron-flute', 0], dizi: ['tapepad', 'tron-flute', 0], shakuhachi: ['tapepad', 'tron-flute', 0],
  templebells: ['musicbox', 'celesta-dust', 0], windchimes: ['musicbox', 'tin-glock', 0],
  janggu: ['pluck', 'toy-pluck', 12], taiko: ['pluck', 'toy-pluck', 12],
};

const args = process.argv.slice(2);
const renderArg = args.find(a => a.startsWith('--render'));
const renderOnly = renderArg ? (args[args.indexOf(renderArg) + 1] && !args[args.indexOf(renderArg) + 1].startsWith('--') ? args[args.indexOf(renderArg) + 1].split(',') : null) : null;

(async () => {
  const [{ INSTRUMENTS }, { SYNTHS }, { DRUM_INSTRUMENTS }, { SAMPLER_INSTRUMENTS }, { EFFECTS }, { FX2 }, theory, { SONGS }] =
    await Promise.all(['js/sound/instruments.js', 'js/sound/synths.js', 'js/sound/drums.js', 'js/sound/sampler.js', 'js/sound/effects.js',
      'js/sound/fx2.js', 'js/ui/theory.js', 'js/sound/songs.js'].map(imp));

  // discover instrument / scale / effect registries in every module of js/sound (+ theory.js), so new files count too
  const INST = [...INSTRUMENTS, ...SYNTHS, ...DRUM_INSTRUMENTS, ...SAMPLER_INSTRUMENTS], FXS = [...EFFECTS, ...FX2];
  let SCALES = [...theory.SCALES];
  const isInst = o => o && typeof o === 'object' && typeof o.id === 'string' && Array.isArray(o.presets) && Array.isArray(o.params) && typeof o.voice === 'function';
  const scaleSteps = o => o && (Array.isArray(o.steps) ? o.steps : Array.isArray(o.intervals) ? o.intervals : null);   // theory.js: steps, asian.js: intervals
  const isScale = o => o && typeof o.id === 'string' && !!scaleSteps(o) && scaleSteps(o).every(Number.isInteger);
  const isFx = o => o && typeof o.id === 'string' && Array.isArray(o.params) && !o.presets && !o.voice && !o.steps;
  const soundFiles = fs.readdirSync(path.join(ROOT, 'js/sound')).filter(f => f.endsWith('.js') && !/worker/.test(f)).map(f => 'js/sound/' + f);
  const found = { files: [] };
  for (const rel of [...soundFiles, 'js/ui/theory.js']) {
    let mod; try { mod = await imp(rel); } catch (e) { continue; }
    for (const [name, val] of Object.entries(mod)) {
      const list = Array.isArray(val) ? val : (val && typeof val === 'object' && isInst(val) ? [val] : null);
      if (!list || !list.length) continue;
      if (list.every(isInst)) for (const i of list) if (!INST.some(x => x.id === i.id)) { INST.push(i); found.files.push(`${rel}:${name}:${i.id}`); }
      if (list.every(isScale) && /scale/i.test(name)) for (const s of list) if (!SCALES.some(x => x.id === s.id)) SCALES.push(s);
      if (list.every(isFx) && /fx|effect/i.test(name)) for (const e of list) if (!FXS.some(x => x.id === e.id)) FXS.push(e);
    }
  }
  const IMAP = Object.fromEntries(INST.map(i => [i.id, i])), FMAP = Object.fromEntries(FXS.map(e => [e.id, e]));
  const SMAP = Object.fromEntries(SCALES.map(s => [s.id, scaleSteps(s)]));
  const theoryScales = new Set(theory.SCALES.map(s => s.id));
  const engineIds = new Set(INSTRUMENTS.map(i => i.id));   // what engine.js plays today without registration

  const recArg = args.indexOf('--recipes');   // --recipes <module.js>: check another RECIPES module (used to test this validator)
  const { RECIPES, REGIONS: REG_LABELS, SCALE_LABELS } = recArg >= 0 ? await import(pathToFileURL(path.resolve(args[recArg + 1])).href) : await imp('js/recipes/recipes.js');
  const fails = [], warns = [], pend = { inst: {}, scale: {}, unreg: {}, unregScale: {} }, summary = [];
  const fail = (w, m) => fails.push(`${w}: ${m}`), warn = (w, m) => warns.push(`${w}: ${m}`);
  const isNum = x => typeof x === 'number' && isFinite(x), EPS = 1e-6;
  const addPend = (kind, id, rid) => { (pend[kind][id] = pend[kind][id] || new Set()).add(rid); };

  function checkParam(where, def, key, val) {
    const pd = (def.params || []).find(p => p.id === key);
    if (!pd) return fail(where, `unknown param "${key}" for ${def.id}`);
    if (pd.type === 'enum' || Array.isArray(pd.options)) {
      if (!pd.options.some(o => o.value === val)) fail(where, `${def.id}.${key} = ${JSON.stringify(val)} is not one of ${pd.options.map(o => o.value).join('|')}`);
      return;
    }
    if (pd.type === 'toggle') { if (![0, 1, true, false].includes(val)) fail(where, `${def.id}.${key} toggle must be 0/1`); return; }
    if (!isNum(val)) return fail(where, `${def.id}.${key} must be a number, got ${JSON.stringify(val)}`);
    if (val < pd.min - EPS || val > pd.max + EPS) fail(where, `${def.id}.${key} = ${val} outside ${pd.min}..${pd.max}`);
  }
  function checkFxList(where, list) {
    if (!Array.isArray(list)) return fail(where, 'fx must be an array');
    list.forEach((f, i) => {
      const w = `${where}.fx[${i}]`, d = FMAP[f?.id];
      if (!d) return fail(w, `unknown effect id "${f?.id}"`);
      if (typeof f.bypass !== 'boolean') fail(w, 'bypass must be true/false');
      for (const [k, v] of Object.entries(f.params || {})) checkParam(w, d, k, v);
    });
  }

  if (!Array.isArray(RECIPES)) { console.log('FAIL: RECIPES is not an array'); process.exit(1); }
  if (RECIPES.length !== 12) fail('RECIPES', `has ${RECIPES.length} recipes (want 12)`);
  const perRegion = Object.fromEntries(REGIONS.map(r => [r, RECIPES.filter(x => x.region === r).length]));
  for (const r of REGIONS) if (perRegion[r] !== 3) fail('RECIPES', `${perRegion[r]} recipes in region ${r} (want 3)`);
  if (!Array.isArray(REG_LABELS) || REGIONS.some(r => !REG_LABELS.find(x => x.id === r))) fail('REGIONS', 'export must label every region');
  const rids = new Set();

  for (const R of RECIPES) {
    const W = `recipe ${R.id}`;
    const P = R.project || {};
    // ---------------------------------------------------------------- recipe metadata
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(R.id || '') || rids.has(R.id)) fail(W, 'id must be unique kebab-case'); rids.add(R.id);
    if (!R.title || typeof R.title !== 'string') fail(W, 'title');
    if (!REGIONS.includes(R.region)) fail(W, 'region ' + R.region);
    if (!R.mood || typeof R.mood !== 'string') fail(W, 'mood');
    if (!Array.isArray(R.steps) || R.steps.length < 4 || R.steps.length > 6) fail(W, `steps: ${R.steps?.length} tips (want 4-6)`);
    for (const s of R.steps || []) if (typeof s !== 'string' || s.length < 20 || s.length > 280) fail(W, `tip length ${s?.length} (want 20-280 chars): ${String(s).slice(0, 40)}`);
    if (R.bpm !== P.bpm) fail(W, `bpm ${R.bpm} differs from project.bpm ${P.bpm}`);
    if (R.key !== P.key) fail(W, `key ${R.key} differs from project.key ${P.key}`);
    if (R.scale !== P.scale) fail(W, `scale ${R.scale} differs from project.scale ${P.scale}`);
    if (!SCALE_LABELS?.[R.scale]) fail(W, `no SCALE_LABELS entry for ${R.scale}`);

    // ---------------------------------------------------------------- project header
    if (P.schema !== 'nfx-studio/1') fail(W, `schema "${P.schema}"`);
    if (!P.id || typeof P.id !== 'string') fail(W, 'project.id');
    if (P.name !== R.title) fail(W, `project.name "${P.name}" differs from the title`);
    if (!isNum(P.bpm) || P.bpm < 40 || P.bpm > 120) fail(W, 'bpm ' + P.bpm + ' (ambient recipes stay in 40-120)');
    if (P.beatsPerBar !== 4) fail(W, 'beatsPerBar ' + P.beatsPerBar);
    if (!theory.NOTE_NAMES.includes(P.key)) fail(W, 'key ' + P.key + ' (use ' + theory.NOTE_NAMES.join(' ') + ')');
    let steps = SMAP[P.scale];
    if (steps && !theoryScales.has(P.scale)) addPend('unregScale', P.scale, R.id);
    if (!steps) {
      if (PENDING_SCALES.includes(P.scale) && FALLBACK_SCALES[P.scale]) { steps = FALLBACK_SCALES[P.scale]; addPend('scale', P.scale, R.id); }
      else fail(W, `unknown scale "${P.scale}"`);
    }
    if (!Number.isInteger(P.lengthBars) || P.lengthBars < 8 || P.lengthBars > 32) fail(W, `lengthBars ${P.lengthBars} (want 8-32)`);
    const endBeat = P.lengthBars * 4, seconds = endBeat * 60 / P.bpm;
    if (!P.loop || typeof P.loop.on !== 'boolean' || !(P.loop.endBeat > P.loop.startBeat) || P.loop.startBeat < 0 || P.loop.endBeat > endBeat) fail(W, 'loop region');
    if (!isNum(P.createdAt) || !isNum(P.updatedAt)) fail(W, 'createdAt / updatedAt');
    if (!Array.isArray(P.tracks) || P.tracks.length < 3) fail(W, 'needs at least 3 tracks');

    // ---------------------------------------------------------------- buses and master (quiet, roomy)
    for (const b of ['space', 'echo']) {
      const bus = P.buses?.[b]; if (!bus) { fail(W, 'missing bus ' + b); continue; }
      if (!isNum(bus.returnDb) || bus.returnDb < -60 || bus.returnDb > 0) fail(W, `${b}.returnDb ${bus.returnDb} (want <= 0)`);
      checkFxList(`${W} buses.${b}`, bus.fx);
      for (const f of bus.fx || []) if (f.params?.mix !== undefined && f.params.mix !== 1) fail(W, `${b} bus ${f.id} should use mix 1`);
    }
    if (!(P.buses?.space?.fx || []).some(f => f.id === 'reverb' || f.id === 'shimmer')) fail(W, 'Space bus needs a reverb or shimmer');
    if (!isNum(P.master?.volumeDb) || P.master.volumeDb > -2) fail(W, `master.volumeDb ${P.master?.volumeDb} (quiet: want <= -2)`);
    if (!isNum(P.master?.atmosphere) || P.master.atmosphere < 0 || P.master.atmosphere > 0.65) fail(W, 'master.atmosphere (want 0..0.65)');
    checkFxList(`${W} master`, P.master?.fx || []);
    for (const f of P.master?.fx || []) if (f.id === 'glue' && (f.params.makeup > 1 || f.params.ratio > 3)) fail(W, 'glue is pushing loudness');

    // ---------------------------------------------------------------- tracks
    const ids = new Set(), clipIds = new Set();
    let pitched = 0, outOfScale = 0, notesTotal = 0, budget = 0;
    for (const [ti, t] of (P.tracks || []).entries()) {
      const TW = `${W} track ${t.id || ti}`;
      if (!t.id || ids.has(t.id)) fail(TW, 'missing or duplicate id'); ids.add(t.id);
      if (!t.name) fail(TW, 'no name');
      if (!/^#[0-9A-Fa-f]{6}$/.test(t.color || '')) fail(TW, 'color');
      if (t.kind !== 'instrument') fail(TW, 'kind ' + t.kind + ' (recipes use instrument tracks)');
      if (!isNum(t.volumeDb) || t.volumeDb > 0 || t.volumeDb < -40) fail(TW, `volumeDb ${t.volumeDb} (quiet: want -40..0, no fader above unity)`);
      if (!isNum(t.pan) || t.pan < -1 || t.pan > 1) fail(TW, 'pan ' + t.pan);
      for (const s of ['space', 'echo']) if (!isNum(t.sends?.[s]) || t.sends[s] < 0 || t.sends[s] > 1) fail(TW, `sends.${s} ${t.sends?.[s]} (want 0..1)`);
      if (typeof t.mute !== 'boolean' || typeof t.solo !== 'boolean') fail(TW, 'mute / solo must be booleans');
      checkFxList(TW, t.fx);

      const iid = t.instrument?.id, def = IMAP[iid];
      let maxVoices = Infinity;
      if (def) {
        maxVoices = def.maxVoices || Infinity;
        if (!def.presets.some(p => p.id === t.instrument.preset)) fail(TW, `preset "${t.instrument.preset}" is not a ${iid} preset (${def.presets.map(p => p.id).join(', ')})`);
        for (const [k, v] of Object.entries(t.instrument.params || {})) checkParam(TW, def, k, v);
        if (iid === 'cloud' && !SONGS.some(s => s.id === (t.instrument.params || {}).song)) fail(TW, 'cloud needs a song from SONGS');
        if (!engineIds.has(iid)) addPend('unreg', iid, R.id);
      } else if (PENDING_INSTRUMENTS.includes(iid)) {
        addPend('inst', iid, R.id);
        if (t.instrument.preset && t.instrument.preset !== 'default') fail(TW, `pending instrument ${iid} should use preset 'default' (got ${t.instrument.preset})`);
        if (Object.keys(t.instrument.params || {}).length) fail(TW, `pending instrument ${iid} should not override params yet`);
      } else fail(TW, `unknown instrument "${iid}"`);

      const [lo, hi] = NATURAL[iid] || (iid === 'texture' || iid === 'cloud' ? [24, 96] : [21, 108]);
      const spans = []; let vmax = 0;
      for (const [ci, c] of (t.clips || []).entries()) {
        const CW = `${TW} clip ${c.id || ci}`;
        if (!c.id || clipIds.has(c.id)) fail(CW, 'missing or duplicate clip id'); clipIds.add(c.id);
        if (!isNum(c.startBeat) || c.startBeat < 0) fail(CW, 'startBeat ' + c.startBeat);
        if (!isNum(c.lengthBeats) || c.lengthBeats <= 0) fail(CW, 'lengthBeats ' + c.lengthBeats);
        if (c.startBeat + c.lengthBeats > endBeat + EPS) fail(CW, `ends at beat ${c.startBeat + c.lengthBeats}, after the project end ${endBeat}`);
        if (!Array.isArray(c.notes) || !c.notes.length) fail(CW, 'no notes');
        if (c.beat && (c.beat.steps !== Math.round(c.lengthBeats * 4) || c.beat.steps > 128)) fail(CW, `beat.steps ${c.beat.steps}`);
        spans.push([c.startBeat, c.startBeat + c.lengthBeats, c.id]);
        const ev = [];
        for (const [ni, n] of (c.notes || []).entries()) {
          const NW = `${CW} note ${ni}`; notesTotal++;
          if (!Number.isInteger(n.p) || n.p < lo || n.p > hi) fail(NW, `pitch ${n.p} outside ${iid}'s range ${lo}..${hi}`);
          if (!isNum(n.s) || n.s < 0 || n.s >= c.lengthBeats) fail(NW, `start ${n.s} outside the clip (0..${c.lengthBeats})`);
          if (!isNum(n.d) || n.d <= 0) fail(NW, 'duration ' + n.d);
          else if (n.s + n.d > c.lengthBeats + EPS) fail(NW, `ends at ${n.s + n.d}, past the clip end ${c.lengthBeats}`);
          if (!isNum(n.v) || n.v <= 0 || n.v > 1) fail(NW, 'velocity ' + n.v);
          vmax = Math.max(vmax, n.v || 0);
          if (!UNPITCHED.has(iid) && steps) {
            pitched++;
            const pc = (((n.p - theory.keyIndex(P.key)) % 12) + 12) % 12;
            if (!steps.includes(pc)) { outOfScale++; fail(NW, `${theory.noteName(n.p)} is not in ${P.key} ${P.scale}`); }
          }
          ev.push([n.s, 1], [n.s + n.d, -1]);
        }
        ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        let cur = 0, mx = 0; for (const [, d] of ev) { cur += d; mx = Math.max(mx, cur); }
        if (!/drums|janggu|taiko/.test(iid) && mx > maxVoices) fail(CW, `${mx} notes at once > maxVoices ${maxVoices}`);
      }
      spans.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < spans.length; i++) if (spans[i][0] < spans[i - 1][1] - EPS) fail(TW, `clips ${spans[i - 1][2]} and ${spans[i][2]} overlap`);
      if (!t.mute) budget += Math.pow(Math.pow(10, t.volumeDb / 20) * vmax, 2);
    }
    // quiet-mix budget: power sum of (fader gain x loudest velocity) over all tracks, plus the master fader
    const budgetDb = 10 * Math.log10(budget || 1e-12) + (P.master?.volumeDb || 0);
    if (budgetDb > -4) fail(W, `mix budget ${budgetDb.toFixed(1)} dB (want <= -4: keep it quiet)`);
    summary.push({ id: R.id, region: R.region, bars: P.lengthBars, sec: Math.round(seconds), tracks: (P.tracks || []).length, notes: notesTotal, pitched, outOfScale, budgetDb: Math.round(budgetDb * 10) / 10 });
  }

  // ---------------------------------------------------------------- report
  console.log('recipe                         region   bars  sec  trk  notes  in-scale     mix budget');
  for (const s of summary) console.log(`${s.id.padEnd(30)} ${s.region.padEnd(8)} ${String(s.bars).padStart(4)} ${String(s.sec).padStart(4)} ${String(s.tracks).padStart(4)} ${String(s.notes).padStart(6)}  ${String(s.pitched - s.outOfScale).padStart(4)}/${String(s.pitched).padEnd(5)}  ${s.budgetDb} dB`);
  if (found.files.length) console.log('\nnew instrument definitions found: ' + found.files.join(', '));
  const pi = Object.entries(pend.inst), ps = Object.entries(pend.scale), pu = Object.entries(pend.unreg);
  if (pi.length) { console.log('\nPENDING instruments (allowed; checked fully once registered):'); for (const [id, set] of pi) console.log(`  ${id.padEnd(12)} ${[...set].join(', ')}`); }
  if (ps.length) { console.log('PENDING scales (checked against fallback steps until defined):'); for (const [id, set] of ps) console.log(`  ${id.padEnd(12)} [${FALLBACK_SCALES[id].join(',')}]  ${[...set].join(', ')}`); }
  if (pu.length) { console.log('Defined (round-2 lanes) but not yet registered in engine.js INSTRUMENT_MAP (engine plays felt until wired):'); for (const [id, set] of pu) console.log(`  ${id.padEnd(12)} ${[...set].join(', ')}`); }
  const pus = Object.entries(pend.unregScale);
  if (pus.length) { console.log('Scales defined outside js/ui/theory.js SCALES (piano-roll scale lock / pads fall back to Major until merged):'); for (const [id, set] of pus) console.log(`  ${id.padEnd(12)} ${[...set].join(', ')}`); }
  for (const w of warns) console.log('WARN ' + w);

  // ---------------------------------------------------------------- optional offline renders
  let renders = null;
  if (renderArg) {
    try { renders = await renderAll(RECIPES.filter(r => !renderOnly || renderOnly.includes(r.id)), soundFiles); }
    catch (e) { fail('render', e.message); }
    if (renders) {
      console.log('\nrender (real engine; pending ids played by stand-ins)   peak dBFS  ~LUFS   clipped  nan  stand-ins');
      for (const r of renders) {
        console.log(`  ${r.id.padEnd(52)} ${String(r.peakDb).padStart(7)} ${String(r.lufs).padStart(7)} ${String(r.clipped).padStart(8)} ${String(r.nan).padStart(4)}  ${r.standIns.join(', ') || '-'}`);
        if (r.error) fail(`render ${r.id}`, r.error);
        if (r.peakDb > -6) fail(`render ${r.id}`, `peak ${r.peakDb} dBFS: want <= -6 (the limiter starts at -3 dBFS)`);
        if (r.clipped || r.nan) fail(`render ${r.id}`, `clipped ${r.clipped}, NaN ${r.nan}`);
        if (r.peakDb < -40) fail(`render ${r.id}`, `nearly silent (peak ${r.peakDb})`);
        if (r.lufs > -20 || r.lufs < -34) fail(`render ${r.id}`, `loudness ${r.lufs} LUFS (quiet but audible: want -34..-20; the demo is -22.5)`);
      }
      for (const e of renders.errors || []) console.log('  console: ' + e);
    }
  }

  if (fails.length) { console.log(`\nFAIL (${fails.length})`); for (const f of fails.slice(0, 80)) console.log('  ' + f); if (fails.length > 80) console.log(`  ... ${fails.length - 80} more`); process.exit(1); }
  console.log(`\nPASS: ${RECIPES.length} recipes, ${summary.reduce((a, s) => a + s.notes, 0)} notes, every pitched note in its scale` + (renders ? `, ${renders.length} renders clean (peaks <= -6 dBFS)` : ''));
})().catch(e => { console.log('FAIL:', e.stack || e); process.exit(1); });

// ---------------------------------------------------------------- render helper (Playwright, headless Chromium)
async function renderAll(list, soundFiles) {
  const http = require('http');
  let chromium; try { ({ chromium } = require('playwright')); } catch (e) { throw new Error('playwright not found: run with NODE_PATH=$(npm root -g)'); }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/__blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><meta charset="utf-8"><title>recipes</title>'); }
    const f = path.join(ROOT, u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  });
  await new Promise(r => server.listen(0, r));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${server.address().port}/__blank`);
  const out = [];
  try {
    for (const r of list) {
      const t0 = Date.now();
      const res = await page.evaluate(async ({ id, files, standIns }) => {
        const { createEngine } = await import('/js/sound/engine.js');
        const { INSTRUMENTS, INSTRUMENT_MAP } = await import('/js/sound/instruments.js');
        // register every instrument defined anywhere in js/sound (round-2 synths / drums / sampler, new world instruments)
        for (const f of files) {
          let m; try { m = await import('/' + f); } catch (e) { continue; }
          for (const v of Object.values(m)) for (const i of (Array.isArray(v) ? v : [v])) {
            if (i && typeof i.voice === 'function' && Array.isArray(i.presets) && typeof i.id === 'string' && !INSTRUMENT_MAP[i.id]) { INSTRUMENTS.push(i); INSTRUMENT_MAP[i.id] = i; }
          }
        }
        const { RECIPES } = await import('/js/recipes/recipes.js');
        const p = JSON.parse(JSON.stringify(RECIPES.find(x => x.id === id).project)), used = [];
        for (const t of p.tracks) {
          if (INSTRUMENT_MAP[t.instrument.id]) continue;
          const s = standIns[t.instrument.id]; if (!s) continue;
          used.push(`${t.instrument.id}->${s[0]}/${s[1]}`);
          t.instrument = { id: s[0], preset: s[1], params: {} };
          if (s[2]) for (const c of t.clips) for (const n of c.notes) n.p += s[2];
        }
        const host = await createEngine({ context: new OfflineAudioContext(2, 128, 44100), songBaseUrl: '/audio/' });
        const buf = await host.render(p, { tailSeconds: 6 });
        // peak / clip / NaN + BS.1770 K-weighted gated loudness (400 ms blocks, 75 % overlap, -70 / -10 gates)
        const sr = buf.sampleRate, ch = [buf.getChannelData(0), buf.getChannelData(1)], n = ch[0].length;
        let pk = 0, clipped = 0, nan = 0;
        const shelf = (() => { const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196, K = Math.tan(Math.PI * f0 / sr), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416), a0 = 1 + K / Q + K * K;
          return [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]; })();
        const hipass = (() => { const f0 = 38.13547087602444, Q = 0.5003270373238773, K = Math.tan(Math.PI * f0 / sr), a0 = 1 + K / Q + K * K;
          return [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]; })();
        const biquad = (x, [b0, b1, b2, a1, a2]) => {
          const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
          for (let i = 0; i < x.length; i++) { const xi = Number.isFinite(x[i]) ? x[i] : 0, yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi; }
          return y;
        };
        const kw = x => biquad(biquad(x, shelf), hipass);
        for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) { const a = ch[c][i]; if (!Number.isFinite(a)) { nan++; continue; } const m = Math.abs(a); if (m > pk) pk = m; if (m >= 1) clipped++; }
        const k = ch.map(kw), blk = Math.round(0.4 * sr), hop = Math.round(0.1 * sr), z = [];
        for (let s = 0; s + blk <= n; s += hop) { let e = 0; for (let c = 0; c < 2; c++) { const a = k[c]; for (let i = s; i < s + blk; i++) e += a[i] * a[i]; } z.push(e / blk); }
        const L = e => -0.691 + 10 * Math.log10(e + 1e-20);
        const g1 = z.filter(e => L(e) > -70), m1 = g1.reduce((a, b) => a + b, 0) / (g1.length || 1);
        const g2 = g1.filter(e => L(e) > L(m1) - 10), m2 = g2.reduce((a, b) => a + b, 0) / (g2.length || 1);
        return { peakDb: Math.round(20 * Math.log10(pk + 1e-12) * 10) / 10, lufs: Math.round(L(m2) * 10) / 10, clipped, nan, seconds: Math.round(n / sr), standIns: used, stats: host.lastRenderStats };
      }, { id: r.id, files: soundFiles, standIns: STAND_INS }).catch(e => ({ error: String(e.message || e).slice(0, 300), peakDb: -180, lufs: -180, clipped: 0, nan: 0, standIns: [] }));
      out.push({ id: r.id, ms: Date.now() - t0, ...res });
    }
  } finally { await browser.close(); server.close(); }
  out.errors = errors;
  return out;
}
