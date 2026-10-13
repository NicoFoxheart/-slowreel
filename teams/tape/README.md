# Slowreel (team tape) - the ambient tape studio for Nicofoxheart

Open `index.html` (artifact form). The demo song loads ready to play; press Play or Space.

- **Idea**: a light, tactile tape machine (painted metal, keycaps, knobs, VU needles, reels behind dark glass). See `DESIGN.md`.
- **Sound**: the real engine in `js/sound/` (API in `SOUND-API.md`) is the default. `js/ui/mock-engine.js` (simple tones)
  is only used with `?engine=mock`, or as a fallback if the real one fails to load (the page then says so).
- **Files**: `js/ui/app.js` (boot, deck, transport, tapes, projects, export dialog, keys, visual loop, `window.__studio`),
  `arrange.js`, `pianoroll.js`, `panels.js` (Sound, Effects, Mixer, Keys, song-clip editor, song-cloud window),
  `phone.js`, `exporter.js`, `state.js` (state + undo history), `controls.js` (knob, fader, meter), `deck.js` (reels + VU),
  `theory.js` (scales, chords), `sample-project.js` (mock demo + track colours). Shared plumbing in `lib/` (a real copy of `shared/lib/`, no tests). Nico's songs are real copies in `audio/` (unchanged mp3s).
- **Projects** use `lib/storage.js` with appKey `tape` (db + user when the viewer grants them, else IndexedDB). "Original demo" in the project
  menu always brings back a fresh demo. Export uses `lib/export.js` and needs the `downloads` capability.
- **PC only**: on a phone (coarse pointer + screen under 600 px) the page shows a calm "made for your computer" screen with the
  reels and starts no audio. Tablets and touch laptops get the studio; a narrow window on a computer still gets pocket mode
  (`phone.js`). `?device=phone|pc` overrides the check for testing.
- **Settings > Light mode** (off by default) for slower computers; it turns itself on only if a one-time render-speed
  probe shows the computer cannot keep up (see `SOUND-API.md`, Performance). Exports always use the full sound.
- Publish with capabilities `{ downloads: true, db: {}, user: {} }`.
- **Tests**: `node shared/qa.cjs teams/tape` (QA tool) and `node teams/tape/tests/run-sound.cjs` (sound engine, ~140 s).
  `window.__studio` also has test-only helpers: `meters()`, `playFrom(beat)`, `info()`, `setLight(on)`, `speedProbe()`.
- **Not done yet**: video export (stretch), stems, automation lanes, Web MIDI.
