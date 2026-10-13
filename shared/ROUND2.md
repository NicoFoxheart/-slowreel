# Slowreel Round 2: the "Antent pack" (binding for round 2)

Nico (Nicofoxheart) is playing Slowreel round 1 (teams/tape, published privately). His words now: "add everything you can,
I'm trying to see if I can make music like Antent" and "finish it as soon as possible, all hands on deck".
Antent (Alexander Maslov, Perm) makes dreamy electronic music across ambient, phonk and future garage: huge reverb-washed
supersaw pads, chopped and pitched vocal-like samples, deep 808 / sub bass, shuffled 2-step future-garage drums, phonk cowbells,
sidechain "breathing", filter sweeps, lo-fi and tape textures. Make Slowreel able to make that music. Everything is synthesized
(no sample libraries); the only recorded audio is Nico's songs and audio Nico imports himself.

All of `shared/BRIEF.md` still applies (artifact form, relative paths, no new hosts, quiet mixes, limiter only prevents clipping,
desktop-first, design for absent capabilities). Read `teams/tape/SOUND-API.md`, `teams/tape/js/sound/instruments.js`,
`teams/tape/js/sound/effects.js`, `teams/tape/js/sound/engine.js` and `teams/tape/DESIGN.md` before writing: new instruments and
effects MUST use the exact same definition format (ids, presets with params, macros, enum params as {value,label}) so the
existing UI panels show them with no special cases. Match Slowreel's visual language exactly (its tokens, knobs, keycaps).

## Lanes (phase A, in parallel; each writes NEW files only - never edit existing files; the integrator wires them in)
- **SYNTHS** -> `js/sound/synths.js` (+ `js/sound/arp.js`): classic synths, each with 3-5 presets and 2-4 macros:
  Supersaw Dream Pad (7-voice detuned saws, slow attack, filter drift), Analog Poly (two detuned oscillators + resonant filter
  + filter envelope), FM E-Piano (2-op FM, bell-tine, tremolo), Synth Lead (mono glide, vibrato), Synth Bass (sub + saw, filter
  pluck), Pluck Synth (filtered short saw / Karplus), Vox Pad (formant "ooh/aah" choir synth for vocal-like chops).
  Arpeggiator as a per-track note processor: on/off, rate (1/4..1/32, triplets), pattern (up, down, up-down, random, as played),
  octaves 1-4, gate, swing; applies to clip playback (scheduler) and live keys. Export `SYNTHS` (array of instrument defs) and
  `arpProcess(notes, settings, bpm)` / a live arp helper. Offline tests in `tests/round2-synths.*`.
- **BEATS** -> `js/sound/drums.js` (+ `js/ui/steps.js`): a synthesized drum-machine instrument (kick, snare, clap, rim, closed hat,
  open hat, shaker, tom, 808 cowbell, crash / noise riser) mapped to MIDI 36-51, with kits as presets (Future Garage, Phonk,
  Lo-fi Dust, Soft Ambient) and per-voice tune/decay/level; an **808 Bass** instrument (sine sub + click, pitch glide between
  overlapping notes, drive/distortion amount, length). `js/ui/steps.js`: a step-sequencer editor component for a drum clip
  (rows per drum voice, 16/32 steps, click to toggle, velocity by drag or alt-click, per-row mute, swing 0-75% applied as note
  offsets, pattern length), which reads and writes the clip's ordinary `notes` array so the project schema stays compatible.
  Style it like the piano roll. Offline tests in `tests/round2-beats.*`.
- **SAMPLER + FX + AUTOMATION** -> `js/sound/sampler.js`, `js/sound/fx2.js`, `js/ui/automation.js`, `js/ui/sampler-ui.js`:
  * Chop Sampler instrument: source = one of Nico's songs (via lib/songs.js) or an imported audio file (file input + drag-drop,
    decodeAudioData; keep imported audio in IndexedDB keyed by a content hash; projects store only `{sampleId, name}`; if the
    sample is missing on another device show "re-import <name>"). Slicing: equal N (4-32) or by transients; slices mapped to keys
    from C3 up; per-slice pitch, reverse, start/end trim; global pitch, "Slowed" macro (playback rate 0.75-1.0 with pitch drop +
    extra reverb send), attack/release, loop. Shows the waveform with slice markers.
  * New effects in the standard format: Sidechain Pump (ducking synced to the beat: rate 1/4..1/16, depth, shape, or keyed by a
    chosen drum track's kick notes), Tape Stop (on a beat), Bitcrusher (bits, downsample), Auto Filter (LFO lowpass/highpass sweep
    synced to tempo), Stereo Widener.
  * Automation lanes: per track `automation: [{target, param, points:[{beat, value}]}]` for volume, pan, sends, any instrument macro
    or effect param; editor component with breakpoints (click to add, drag to move, double-click to delete, curve straight or
    smooth) drawn under the track; the engine applies it with setValueAtTime / linearRampToValueAtTime while scheduling and in
    offline render. Export `applyAutomation(engineCtx, track, fromBeat, toBeat, timeAt)` helpers for the integrator.
  Offline tests in `tests/round2-sampler.*`.

## Phase B: one integrator wires it all into Slowreel
Register the new instruments and effects in the engine and panels; add a **Beats** tab (step sequencer) and the sampler and
automation UIs; arp controls in the Sound tab; "Add track" offers everything. Add a second demo project **"Night Garage"**: an
Antent-style future-garage ambient piece (shuffled drums, supersaw pad with sidechain pump, vocal-like chops from one of Nico's
songs via the Chop Sampler, 808 sub with glide, filter-sweep automation, rain texture), credited to the Slowreel team. Keep
"Morning Tape" as the first demo. Run every test; then QA.

## Update (Nico, 2026-10-13 ~05:00 UTC, binding): PC ONLY
Slowreel is now a PC-only studio. Phones show a calm "made for your computer" screen and never start audio (the stutter-fix engineer
builds it). Do not spend time on phone layouts or phone tests. A "Light mode" setting exists for weaker PCs: new instruments and
effects should respect `engine.light` (when true: fewer voices / shorter tails / no per-voice convolvers) if the integrator exposes it.
