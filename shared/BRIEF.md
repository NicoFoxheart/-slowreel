# Ambient studio: team brief (round 1, "every builder has their own idea")

## The client
Nicolas Graham releases ambient / anime / nightcore music as **Nicofoxheart** (Tampa, FL). His words: "make a top tier ambient
music studio, something like BandLab, virtual instruments but for ambient music, reverb everything". He chose a **full studio**,
**his own songs usable as sounds**, and **export**. He asked for a team of graphic designers, ambient musicians and QA where
"every builder has their own idea and I choose the best one". So three teams each build their **own complete, working studio**;
Nico plays all three and picks one; the winner then gets a full build-out (grafting the best ideas of the others).

He produces quiet, spacious music and asked us before to keep his mixes as he made them ("I'm an ambient producer, it's supposed
to be quiet"). He works on a PC. His portfolio is a pastel clay 3D studio; his personal symbols are a fox and a heart.

## Round 1 scope: a real, playable studio (not a mockup)
Each team delivers `teams/<key>/index.html` (+ its own js/css/audio files) that opens **with a demo song loaded and ready to
play** and lets Nico make music. Required:
1. **Arrange view**: multitrack timeline (at least 8 tracks), clips you can add, move, resize, duplicate, delete; tempo
   (default 60-80 BPM), loop region, snap, zoom; transport (play / stop / loop / return to start); playhead.
2. **Piano roll**: draw, select, move, resize and delete notes; velocity; scale lock with ambient-friendly scales (at least
   major, minor, lydian, dorian, major pentatonic, minor pentatonic, and the Japanese in-sen or hirajoshi); a chord stamp
   (maj7, add9, sus2, min9, 6/9 or the team's own set); notes can be very long.
3. **Play live** with the computer keyboard (QWERTY piano with octave shift) and record what you play into a clip.
4. **Instruments** (all synthesized with the Web Audio API, no sample libraries) - at least 6, each with presets and 2-4 macro
   knobs: e.g. dream pad, felt piano, glass bells / music box, choir air, bowed strings, sub drone, pluck / koto, noise
   textures (rain, vinyl, wind, ocean, night city). The ambient musician decides the palette and makes them sound beautiful.
5. **Nico's songs as sounds** (required): (a) a **song clip** track type that plays a chosen section of one of his songs on the
   timeline (offset, length, fades, gain); (b) a **granular "song cloud"** instrument that turns any of his songs into a
   playable, pitchable pad/texture (grain size, density, position, spray, freeze). Song list: `shared/tracks-data.json` +
   "After the Storm" (`after-the-storm.mp3`). Files are in `shared/audio/<id>.mp3`. Never alter the files themselves.
6. **Reverb everything**: lush reverb is the heart of the sound. A shared "Space" reverb send bus on every track by default,
   plus an "Echo" (tape delay) bus; per-track effect chain; reverb types beyond one generic hall (e.g. room, hall, cathedral,
   infinite/freeze, shimmer with octave-up feedback, plate, reverse). A master "Atmosphere" macro is welcome.
7. **Mixer**: volume, pan, mute, solo, send levels, meters; master with a gentle safety limiter (ceiling -1 dBFS, no pumping).
8. **Projects**: new, rename, save, open, duplicate, delete; autosave; the demo song cannot be lost (re-openable).
9. **Export master**: offline render (with the reverb tail) to **WAV 24-bit + MP3 320 kbps packed in one .zip** and offer it
   with the `downloads` capability (see "Capabilities" - the viewer refuses .wav/.mp3 directly; .zip is allowed). Not loudness-
   normalized by default (his music is meant to be quiet); the limiter only prevents clipping.
10. **Visual**: an audio-reactive visual that belongs to the team's idea, calm and beautiful, sleeping when audio stops.
Stretch for round 1 (required for the winner later): **video export** for TikTok/YouTube (`.mp4` when MediaRecorder supports it,
else `.webm`; 1080x1920 and 1920x1080), stems export, automation lanes, undo/redo history beyond basics, Web MIDI input.
Basic undo/redo (Ctrl+Z / Ctrl+Shift+Z) for edits is required.

## Shared plumbing (built by the TECH LEAD in `shared/lib/`, read-only for teams)
Teams copy `shared/lib/` into `teams/<key>/lib/` during integration (published pages cannot reach `../`). API:
- `export.js`: `renderOffline({seconds, sampleRate=44100, channels=2, build(offlineCtx, destination)}) -> Promise<AudioBuffer>`;
  `trimTail(buffer, {thresholdDb=-70, minSeconds}) -> AudioBuffer`; `measure(buffer) -> {peakDb, rmsDb, clippedSamples}`;
  `encodeWav(buffer, {bitDepth=24}) -> Blob`; `encodeMp3(buffer, {kbps=320}) -> Promise<Blob>` (loads lamejs 1.2.1 from
  `https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js` on first use; encodes in chunks without freezing the UI);
  `makeZip([{name, data: Blob|Uint8Array|string}]) -> Promise<Blob>` (stored, CRC-32); `saveFile(filename, blob) ->
  Promise<{status:'saved'|'fallback'|'declined'|'unavailable'|'error', code?}>` (uses `claude.use('downloads')`; falls back to
  an `<a download>` link only when the page is NOT inside the viewer, i.e. `use()` resolved null);
  `recordVideo({canvas, audioNode, seconds, width, height}) -> Promise<{blob, ext:'mp4'|'webm'}>`.
- `storage.js`: `openProjects({appKey}) -> Promise<{backend:'db'|'indexeddb'|'memory', list(), load(id), save(project),
  remove(id), duplicate(id, newName)}>` (db + user capabilities when present: private path `data/users/<userId>/projects/<id>`,
  one doc per project, <= 256 KiB; otherwise IndexedDB; otherwise memory) and `autosave(store, getProject, ms=1500)`.
- `songs.js`: `SONGS` (id, title, file, duration, peaks), `loadSong(ctx, id) -> Promise<AudioBuffer>` (fetch + decode, cached).
- `reverb.js`: `makeImpulse(ctx, {seconds, decay, preDelay, damping, width, reverse}) -> AudioBuffer` (teams may use or replace).
- `README.md` documents all of it. Musicians and designers must NOT wait for the lib in stage 1.

## The shared interfaces (so each team's musician and designer can build in parallel)
**Project JSON (schema `nfx-studio/1`)** - teams may add fields, never remove these:
```
{ schema, id, name, bpm, beatsPerBar, key, scale, lengthBars, loop:{on,startBeat,endBeat},
  tracks:[{ id, name, color, kind:'instrument'|'song', instrument:{id, preset, params:{}}, volumeDb, pan, mute, solo,
            sends:{space, echo}, fx:[{id, params:{}, bypass}],
            clips:[{ id, startBeat, lengthBeats,
                     notes:[{p, s, d, v}]                                   // instrument clips: midi, start, duration (beats), velocity 0..1
                     song:{songId, offsetSec, gainDb, fadeInSec, fadeOutSec, rate} }] }],   // song clips
  buses:{ space:{fx:[]}, echo:{fx:[]} }, master:{ volumeDb, atmosphere, fx:[] }, createdAt, updatedAt }
```
**Sound engine API** (musician owns `teams/<key>/js/sound/`, documented in `teams/<key>/SOUND-API.md`):
```
export async function createEngine({ context }) -> engine     // context: an AudioContext or OfflineAudioContext
engine.instruments -> [{id, name, kind, presets:[{id, name}], macros:[{id, name, min, max, default}], params:[...]}]
engine.effects     -> [{id, name, params:[{id, name, min, max, default, unit}]}]
engine.demo        -> the team's demo project (also saved as teams/<key>/demo.json)
await engine.load(project)            // build or rebuild the graph; must be cheap enough to call after edits
engine.applyChange(project, change)   // optional fast path for live edits; may just call load()
engine.play(fromBeat) / stop() / seek(beat) / setLoop(on, startBeat, endBeat) / position() -> {beat, seconds, playing}
engine.noteOn(trackId, midi, velocity) / noteOff(trackId, midi)          // live playing
engine.setParam(target, paramId, value)   // target: {track} | {track, fx} | {bus:'space'|'echo'} | {master:true}
engine.analyser (master AnalyserNode), engine.meter(trackId) -> {peakDb, rmsDb}, engine.output (master node for video)
await engine.render(project, {tailSeconds}) -> AudioBuffer    // offline, uses an OfflineAudioContext internally
engine.dispose()
```

## Test contract (QA tool uses it)
Every team page exposes `window.__studio = { play(), stop(), status() -> {playing, beat, tracks, clips, notes, project,
cpuHint}, renderOffline(seconds) -> {peakDb, rmsDb, clippedSamples, seconds}, exportMaster({seconds}) -> {zipBytes, files:[{name,
bytes}], saveStatus} }` (only for tests; harmless in production). QA tool: `cd /home/user/nicofoxheart/studio &&
NODE_PATH=$(npm root -g) node shared/qa.cjs teams/<key>` (desktop + phone screenshots in `teams/<key>/qa/`, view with Read; it
injects a mock viewer runtime and maps lamejs/three to local copies). Headless Chromium plays Web Audio with no speakers, so
judge sound by offline renders and `measure()` numbers, and ffprobe any exported file (`ffprobe` and `ffmpeg` exist).

## Technical contract
- Published as a claude.ai Artifact: `index.html` in **artifact form** (starts with `<title>`, then Google Fonts `<link>`s,
  `<style>`, markup, scripts; NO `<!doctype>`, `<html>`, `<head>`, `<body>`). Other files (js modules, css, audio) sit beside it
  and are referenced by **relative paths** (`js/app.js`, `audio/infinite-love.mp3`, `lib/export.js`). No `../`.
- Scripts only from cdnjs.cloudflare.com, cdn.jsdelivr.net/npm, unpkg.com with exact versions (lamejs 1.2.1 above; three.js
  0.160.0 from jsdelivr if a team wants WebGL). Fonts only Google Fonts with fallback stacks (blocked in this container: fallback
  fonts in screenshots are expected). No other hosts, no iframes, no alert/confirm/prompt (build confirmations into the UI).
- Capabilities: `downloads` for export. Projects use `shared/lib/storage.js` (db + user when declared; IndexedDB otherwise).
  `await window.claude?.use?.(name)` may resolve null: design for absence. Never call capabilities on load except to read.
- AudioContext starts only from a click (show a calm "Start studio" moment or start on the first play). AudioWorklet is allowed
  only from the team's own file with a fallback to native nodes. Lookahead scheduling (no setTimeout per note). Cap polyphony,
  generate impulse responses once (cache), keep CPU light: Nico's PC is mid-range. Visuals sleep when nothing plays and when the
  tab is hidden.
- Desktop-first (designed for 1280-1920 wide). At phone width (390px) it must not scroll sideways and should offer a simple
  "listen / play pads" mode. Scrollable editors live inside their own containers (mark them `data-scroll`).
- Colors as CSS tokens on `:root`; a deliberate single dark (or light) theme is fine: then set `color-scheme` on `:root` and an
  explicit body background. Visible keyboard focus, `prefers-reduced-motion`, real `<button>`s with labels, stable ids on controls.

## Design and sound bar
"A team of graphic designers and ambient musicians made it." Each team has its own idea for BOTH the look and the sound, and
names its studio (short, original, not BandLab or any other brand). Avoid AI-design cliches: cream + serif + terracotta,
near-black with one acid-green pop, purple-to-blue gradients, neon on black, emoji as icons, identical rounded cards. Copy is
plain, short, first-person where it speaks for Nico. The demo song should be a genuinely lovely 1-3 minute ambient piece that
shows off the instruments, the reverbs and at least one of Nico's songs (as a song clip or song cloud), credited to the team.

## Ownership
Tech lead: `shared/lib/`. Team `<key>`: only `teams/<key>/` (musician: `js/sound/`, `demo.json`, `SOUND-API.md`; designer:
everything else). Never edit another team's folder. Write a short `teams/<key>/README.md` (idea, name, how it works).
