# Slowreel - design

## The idea
**Slowreel is an ambient tape machine you could hold, playing in a dark room at night ("Midnight tape").** One instrument,
built like high-end studio gear: a charcoal / ink-blue anodized chassis, graphite keycaps, brushed-metal knobs with skirts
and amber indicator lines, an amber-backlit VU meter, and a reel-to-reel transport behind smoked glass. Everything you
*touch* is graphite and matte; everything that *shows the sound* (amber LCD counter, deck, VU, song cloud, song waveform)
sits behind darker smoked glass. Light is the accent: what is on or selected glows warm amber (lit keys, the playhead, LEDs),
nothing else shouts. Calm, deep, readable.

Name: **Slowreel** (model line "SR-8 ambient tape studio"), because ambient music is tape running slowly and nothing is rushed.

## Tokens (css/studio.css `:root`)
- Surfaces (dark, `color-scheme: dark`): `--room #090B0E` (the dark room, with a faint amber lamp glow top-left and an
  ink-blue bounce bottom-right), `--chassis`, `--panel #141920`, `--panel-hi #1A2028`, `--well`, lanes `--lane`/`--lane-alt`.
  Seams are light hairlines (`--seam`, `--seam-strong`), shadows are black.
- Ink (warm paper under lamplight): `--ink #EFE7D9`, `--ink-2`, `--ink-3 #9A9387`, `--ink-4 #80868F` (all >= 4.5:1 on panels).
- Glass: `--glass #05070A`, `--glass-ink #F4E6CC`, `--glass-dim`; `--lcd #FFB54A` amber LCD digits with a soft glow.
- Keycaps: `--key-top/--key-bot` graphite; the selected / on state is "lit": `--key-lit-top/-bot`, `--key-lit-ink #FFD38F`,
  `--key-lit-shadow` (amber edge + glow). Clip and recipe strips are the track colour mixed 50% into ink with light text.
- Signal colours (keycaps, LEDs, knob arcs): `--signal #F0622A` (VU orange: play/record/export/peak), `--amber #F5A524`
  (default knob arc, progress, lit state), `--cobalt #7C9CF4` (Space reverb, focus ring), `--saffron #F4B03A` (loop, Echo,
  song-cloud glow), `--leaf #3FBF88` (on/saved).
- The 3D header (js/ui3d/scene3d.js) uses the same palette: charcoal slab with a little metalness, a near-black niche,
  walnut desk, brushed-metal reels, cool moonlight key light, and a strong warm desk lamp + amber VU as the light sources.
- Track colours: 8 inks in `sample-project.js` `TRACK_COLORS`; each track's colour runs through its head chip, clips, notes,
  meter, mixer strip and keyboard.
- Type: Archivo (wide-ish grotesk, 600-800 for names, uppercase tracked 10px labels) + IBM Plex Mono for every number.
  Fallbacks: Helvetica Neue / Arial and ui-monospace (Google Fonts are blocked in this container, so screenshots use fallbacks).
- Space 4/8/12/16/24; radii key 7, panel 10, chassis 16. Key shadow is one top highlight + one bottom lip; pressed keys sink 1px.
- Motion: `--ease cubic-bezier(.2,.7,.2,1)`, 80 ms key travel, slow reels, needle ballistics (VU 300 ms, peak hold).
  `prefers-reduced-motion` turns transitions off.

## Layout (desktop 1280-1920)
1. **Deck** (top): brand, transport keys (Return, Play, Stop, Loop, Rec), LCD counter (bar.beat.tick, time, BPM, key, scale),
   tape window (reels + dual-needle meter: VU ink needle, peak vermilion needle), master knobs (Atmos, Space, Volume),
   project button + save LED + undo/redo + Export.
2. **Arrange** (middle): sticky track heads (chip, name, instrument · preset, M/S, mini meter), lanes with bar/beat grid,
   clips, ruler with a loop strip on top, end-of-song hatch, playhead. **Nico's tapes** on the right (song browser).
3. **Dock** (bottom), tabs 1-5: Notes (piano roll, or the song-clip editor), Sound, Effects, Mixer, Keys.
Phone (<760px): "Slowreel pocket" - deck window, big transport, Listen (track on/off) and Play pads (4x4, always in key).

## Components
- **Knob** (`controls.js knob`): skirt with 28 grip lines, light cap with indicator line, 270-degree value arc in the knob's
  signal colour (bipolar knobs grow from centre), tick ring, name + mono value. Drag up/right, Shift = fine, wheel,
  arrows/PageUp/Home/End, Delete or double-click = default. role=slider with aria-valuetext.
- **Fader**: dark fader cap with a white line on a recessed groove, dB ticks; drag, wheel, arrows. **Meter**: 26-segment LED
  ladder green/saffron/vermilion with peak hold.
- **Keycaps**: light (default), dark (selected tab, play), signal (rec, export), with an LED dot for on/off states.
- **Clip**: tinted body + solid colour top strip with the name; note clips draw a mini roll, song clips draw the real
  section of the song's waveform (from the peaks) with fades and gain. **Song Cloud** clips glow (warm radial body, soft halo).
- **Song Cloud window** (graft from Lamplit/Daylong): dark glass with the song's waveform; the area around the grain position
  lights up warm, sparks drift up while it sounds, "FROZEN" when Freeze is on. Click/drag or arrows to move the position.
- **Cartridges**: the instrument picker is a grid of keycaps with a colour swatch; presets are a column of keys.
- **Effects** are units in a rack, left to right in signal order, each with an On LED key, move-earlier and remove;
  the Shimmer reverb unit has a warm tint. Target switch: Track / Space / Echo / Master.
- **Mixer strips**: name, Pan / Space / Echo knobs, fader + meter, dB, M S; Space and Echo bus returns; Master with Atmos,
  fader, meter and a "Limit -1 dB" LED.
- **Export dialog**: four spec tiles, five steps with LEDs (render, WAV, MP3, zip, save), progress bar, plain result line.

## Interactions
- Space play/pause, Home return, L loop, R record, 1-5 tabs, Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y), Ctrl+D duplicate, Delete,
  Ctrl+S save now. QWERTY piano A..' (white) and W E T Y U O P (black); Z/X octave, C/V velocity.
- Arrange: click selects; drag moves (across compatible tracks), edges resize (left edge keeps notes/audio in place),
  Alt-drag copies, double-click an empty lane makes a 4-bar clip, double-click a clip opens it. Focused clip: arrows move,
  Shift+arrows resize, Up/Down change track, Enter edit. Ruler: click/drag seeks; drag the top strip sets the loop.
  Ctrl+wheel zooms. Follow keeps the playhead in view.
- Piano roll: Draw tool (click + drag for length; chord stamp; scale lock), Select tool or Shift-drag for a marquee,
  drag notes (pitch snaps to the scale), drag right edge to resize, Alt-drag copies, double-click deletes, velocity lane,
  click keys to audition. Drawing past the end grows the clip.
- Every edit is one undo step (drags and knob turns included). Autosave 1.5 s after the last edit; the LED shows Saving/Saved.
- The visual loop runs only while something sounds, sleeps 1.5 s after silence and when the tab is hidden.
