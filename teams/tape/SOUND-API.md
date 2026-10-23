# Slowreel sound engine (team tape)

Warm, analog, slow: felt and toy pianos, a music box, bowed strings, a tape choir, drones, plucks, night rain on the window,
and Nico's own songs as a granular cloud and as clips on worn tape. Everything goes through tape (wow, flutter, saturation),
plate / spring / hall / cathedral rooms, a shimmer room (octave-up feedback) and a long tape echo.
All sound is synthesized with native Web Audio nodes (no samples, no worklets), so it runs the same live and offline.

Files (all in `js/sound/`): `engine.js` (the API), `instruments.js`, `effects.js`, `reverb.js` (impulse responses),
`assets.js` + `gen-worker.js` (impulse responses, noise and night-rain loops made ahead of time in a Worker),
`nightrain.js` (rain on glass + city hum loops), `songs.js` (loading Nico's songs), `util.js`, `demo.js` (the demo song,
also saved as `demo.json`).

## Quick start

```js
import { createEngine } from './js/sound/engine.js';
const ctx = new AudioContext();                    // create it from a click
const engine = await createEngine({ context: ctx, songBaseUrl: 'audio/' });   // songBaseUrl is the default
await engine.load(engine.demo);                    // or a saved project; loads the songs it needs
engine.play(0);
```

`songBaseUrl` is relative to the page: songs are fetched from `audio/<id>.mp3` (the published page needs the mp3s in
`audio/`; the demo uses only `after-the-storm.mp3`). A song that fails to load is skipped with a console warning.

## API (as in the brief, plus a few helpers)

| call | notes |
|---|---|
| `createEngine({context, songBaseUrl, light = false})` | AudioContext or OfflineAudioContext. `light`: start in Light mode (below). |
| `engine.instruments` | 8 instruments, see below. Each: `{id, name, kind, maxVoices, presets:[{id,name}], macros:[{id,name,min,max,default,unit}], params:[...]}` |
| `engine.effects` | 8 effects: `{id, name, params:[{id,name,min,max,default,unit, type?, options?, scale?}]}` |
| `engine.demo` | a fresh copy of the demo project (same as `demo.json`). |
| `engine.songs` | `[{id, title, duration}]` (9 songs). `engine.reverbTypes` -> `[{value, label}]`. |
| `await engine.load(project)` | builds or updates the graph. Cheap: only rebuilds what changed (an fx chain is rebuilt only when its list of effect ids / bypass flags changes). Fills in missing `buses` / `master` with defaults. Keeps a reference to `project` and reads notes from it while playing. Resolves when the songs are decoded and every impulse response / noise loop the graph needs is made (in a Worker), so `play()` never computes buffers. |
| `engine.ready()` | resolves when every buffer the current graph needs is in place (load() already awaits it). |
| `engine.setLight(on)` / `engine.light` | Light mode for slower PCs, live playback only: every reverb sends to one shared short room (impulse <= 2.5 s, no shimmer, no per-track convolvers), half the voice and grain caps (global 32 voices, 32 grains, half the cloud density), no per-voice pitch wobble or track tape wow. Returns a promise. `render()` and exports always use the full sound. |
| `await engine.speedProbe({seconds = 3})` | renders the busiest moment of the project offline with the full sound: `{rtf, ms, seconds, fromBeat}`. The UI turns Light mode on by itself only when this is below 1.8x real time (best of two runs). |
| `engine.applyChange(project, {type, trackId})` | fast paths: `'notes'`, `'clips'`, `'clip'` (no rebuild, the scheduler reads the project), `'mixer'`, `'loop'`, `'tempo'`, `'track'` (+`trackId`: instrument/preset/fx changed), `'master'` (buses or master changed). Anything else calls `load()`. |
| `engine.play(fromBeat?, {at}?)` | omitted = from where it stopped. `at` = audio-clock start time (a count-in plays before it; default now + 0.3 s); returns the start time. `stop()`, `seek(beat)`, `setLoop(on, startBeat, endBeat)`. |
| `engine.position()` | `{beat, seconds, playing}`. Playback stops by itself at the end of the project (when the loop is off). |
| `engine.noteOn(trackId, midi, vel 0..1)` / `noteOff(trackId, midi)` / `allNotesOff()` | live playing; works while stopped or playing. Song tracks ignore it. |
| `engine.setParam(target, paramId, value)` | see below. Writes the value into the project too, so saving keeps it. |
| `engine.analyser` | master AnalyserNode (fftSize 2048). `engine.output` = master node (post-limiter) for video capture. |
| `engine.meter(trackId \| 'master')` | `{peakDb, rmsDb}` of the last ~23 ms (post-fader, post-pan). Call it per animation frame. |
| `engine.cloudGrains(windowSec = 1.5, trackId?)` | recent song-cloud grains for the glowing cloud visual: `[{t, age, pos, rate, dur, pan, vel, track}]`. `pos` 0..1 = where in the song, `rate` = pitch ratio (1 = original, 2 = octave up), `pan` -1..1, `age` seconds since it started (negative = about to start). Live context only. |
| `await engine.render(project, {tailSeconds = 8, sampleRate = 44100, fromBeat, toBeat, onProgress, light = false})` | offline render with its own OfflineAudioContext, loop ignored, returns a stereo AudioBuffer (full sound unless `light: true`). The demo (116 s + tail) renders in about 42 s in headless Chromium; use `onProgress(0..1)`. Run `trimTail()` from `lib/export.js` after it. |
| `engine.newProject(name)` / `engine.newTrack({kind:'instrument'\|'song', instrument, preset, name, color})` | blank objects with good defaults (Space + Echo buses, a song track gets a Cassette insert). |
| `engine.presetParams(instId, presetId)` / `engine.trackParams(trackId)` | full resolved param values (defaults <- preset <- track overrides): use them to draw knobs. |
| `engine.projectSeconds(project)` | length in seconds (lengthBars or the last clip end, whichever is later). |
| `engine.stats()` | `{voices, grains, nodes, maxVoices, maxGrains, maxNodes, tracks}` (nodes is an estimate). Good for a `cpuHint`. |
| `engine.dispose()` | stops everything and disconnects. |

### setParam targets

- `{track: id}` + `'volumeDb' | 'pan' | 'mute' | 'solo' | 'space' | 'echo'` (sends 0..1.5, also accepts `'sends.space'`).
- `{track: id}` + `'preset'` (resets the overrides), `'instrument'` (switches instrument, first preset), or any instrument
  param id (macro or param) -> stored in `track.instrument.params`. Changes apply to the next notes; held notes keep their sound.
- `{track: id, fx: index or fx id}` + an effect param id, or `'bypass'` (true/false).
- `{bus: 'space' | 'echo'}` + `'returnDb'`; `{bus, fx: index}` + effect param.
- `{master: true}` + `'volumeDb'` or `'atmosphere'` (0..1, 0.5 neutral: more room, echo and tape as it rises);
  `{master: true, fx: index}` + effect param.

## Instruments (8)

Macros are the first 3-4 params (shown big); the rest are extra params. Enum params have `type: 'enum'` and
`options: [{value, label}]`; toggles have `type: 'toggle'` (0/1). `level` (0..1.5) exists on every instrument.

| id | name | presets | macros | extra |
|---|---|---|---|---|
| `felt` | Felt Piano | felt-upright, toy-piano, muted-keys, worn-upright | felt, sustain, hammer, wobble | toy (tines), detune |
| `musicbox` | Music Box | music-box, kalimba, celesta-dust, tin-glock | shine, ring, mechanism, wobble | ratio2, ratio3 (partials), thump |
| `strings` | Bowed Strings | cassette-strings, solo-cello, slow-section, glass-bow | bow (attack), bright, vibrato, ensemble | solo, glass (toggles) |
| `tapepad` | Tape Pad | tape-choir, tron-flute, warm-pad, dusty-choir | warmth, air, swell, wobble | voice (choir / flute / pad) |
| `drone` | Drone | warm-sub, reed-organ, low-hum | body, reed, motion, grit | |
| `pluck` | Pluck | nylon, koto, cassette-harp, toy-pluck | bright, decay, body, bend | wave (nylon / koto / harp) |
| `texture` | Textures (kind `texture`) | night-rain, rain-on-glass, cassette-hiss, vinyl-crackle, wind, ocean, room-tone | tone, motion, density | noise (source) |
| `cloud` | Song Cloud (kind `granular`) | soft-cloud, frozen-tape, dust-grains, slow-bloom | position, size (grain s), density (grains/s), spray | song, freeze (toggle), scan, pitchSpread, tone, width, attack |

- Textures sound for as long as the note is held; the pitch only shifts the colour a little. Use one long note.
  Night rain: `tone` = how much rain you hear through the glass, `density` = how much distant city, `motion` = slow gusts.
- Song Cloud: MIDI 60 plays the song at its own pitch (72 = octave up, 48 = octave down). `freeze` holds the position,
  otherwise it drifts forward with `scan`. Songs are level-matched for the cloud only (quiet and loud songs sound similar).
  `song` is a song id; the engine loads it when set via `setParam`.
- Polyphony caps per instrument (`maxVoices`, 6-16) plus 64 voices overall; the oldest voice fades out in 40 ms.

## Song clips (track `kind: 'song'`)

`clip.song = {songId, offsetSec, gainDb, fadeInSec, fadeOutSec, rate}` plays the song from `offsetSec` for `lengthBeats`
(converted at the project tempo), with linear fades. `rate` changes speed and pitch together (tape-style, 0.25..4).
Not level-matched: a clip at 0 dB on a track at 0 dB leaves the master at Nico's own level (measured: -0.4 dB, the master tape).
Starting playback in the middle of a clip starts the song at the right point.

## Effects (8) and buses

| id | params |
|---|---|
| `reverb` | type (plate, spring, room "Tape room", hall, cathedral, reverse, infinite), mix, size 0.4-2, tone, preDelay s, shimmer 0-1 |
| `shimmer` | same as reverb, defaults: hall, size 1.4, shimmer 0.55 (octave-up feedback into the room) |
| `echo` | beats (tempo-synced, 0.125-4), feedback (max 0.92), tone, wow, drive, spread (ping-pong), mix |
| `tape` | Cassette: drive, age (high loss), wow, flutter, hiss (hiss only while the transport plays) |
| `chorus` | rate, depth, mix |
| `filter` | mode (lowpass / highpass / bandpass), cutoff (log), resonance, motion, rate (slow sweep) |
| `eq` | low, mid, high (dB), lowcut (Hz) |
| `glue` | threshold, ratio, makeup (soft compressor) |

Effects on the buses should use `mix: 1`. Default buses: Space = `reverb` hall 1.25; Echo = `echo` 0.75 beats, feedback 0.62.
The Echo bus also feeds the Space bus a little (echoes bloom into the room). `bus.returnDb` sets each bus return.
Changing a reverb's type / size / tone crossfades to the new room (80 ms) - no clicks. Impulse responses are made once and cached,
in a Worker (the old room keeps playing until the new one is ready). Impulses are capped at 6 s (a 7.5 s cathedral is ~44 dB
down there and ends with a 1.5 s fade); rooms cut while still louder than -40 dB (`infinite`, cathedral size >= 1.3) get a
feedback tail (four damped delay lines) that carries the decay on at the room's own rate, so no 10-20 s convolution runs.

Master chain: master fx -> a light built-in cassette stage (driven by Atmosphere) -> master volume -> safety limiter
(only above -3 dBFS, 3 ms attack, Chromium's automatic makeup gain removed) -> soft clip ceiling at -1.05 dBFS -> output.
Not loudness-normalized: quiet mixes stay quiet.

## The demo: "Rain on the Reel"

A major / F# minor, 66 BPM, 32 bars (1:56 + reverb tail), 9 tracks: Night rain, Storm cloud (song cloud of
"After the Storm"), Low tape (drone), Tape choir, Felt piano, After the Storm (song clip, bars 8-21, on worn tape),
Cassette strings, Music box, Cassette harp. Space bus = cathedral with shimmer 0.28; Echo bus = tape echo 0.75 beats.
Loop region is set to bars 17-24 (off). Credit is in `project.credit`.

## Tests (numbers, not ears)

`cd /home/user/nicofoxheart/studio && NODE_PATH=$(npm root -g) node teams/tape/tests/run-sound.cjs [presets|effects|unity|demo|live]`
(about 2.5 min for all; one part is faster). It serves `teams/tape`, opens `tests/sound.html` in headless Chromium, renders
offline, writes `qa/sound-results*.json` and `qa/demo-render.wav` (24-bit), prints PASS / FAIL with reasons.
Checks: every preset (34) not silent, peak below -1 dBFS, 0 clipped samples, no NaN, tail dies (< -60 dB at the end, never rising),
voices <= 64 and nodes < 3000; every effect at extreme settings (and cathedral + shimmer 1, spring) decays with no build-up;
a song clip passes the master at its own level (+-1 dB); the demo; and a live AudioContext (play, position, noteOn, meters, grains).

Last run (2026-10-13): all PASS. Demo: -22.5 LUFS integrated, true peak -8.4 dBFS, LRA 8.1 LU, 0 clipped, no NaN,
max 29 voices / 40 grains / ~540 nodes, tail falls ~7 dB/s to silence; below 40 Hz -57.6 dB RMS (no rumble), above 10 kHz
-64.5 dB (warm, no harshness), side 5 dB under mid (wide, mono-safe). Spectrogram: `qa/demo-spectrogram.png`.

## Performance (why it does not stutter)

- `play()` takes ~10 ms: nothing is generated on play. Impulse responses, noise loops and the night-rain loops are made in
  `gen-worker.js` (fallback: main thread in idle time, one job per slot) and awaited by `load()`; song decoding is too.
- The scheduler queues its work (`scheduleRange` pushes a job, `scheduleTrack(spec, job)` does one track) and runs it in
  ~6 ms slices live (all at once offline, in the same order as before), so no main-thread task runs long. Integrators:
  per-track scheduling hooks (automation, fx scheduling) belong in `scheduleTrack`.
- Oscillator pitch and filter params are k-rate (one value per 2.9 ms block, `util.krate`): Chromium otherwise recomputes
  filter coefficients / pitch per sample for every LFO'd or enveloped param. Gains and delay times stay a-rate.
- Sources whose envelope is already below -100 dB (felt hammer noise, music-box pin / thump and upper partials, toy
  tines) stop there instead of running with their filters for the whole note.
- Demo, headless Chromium, busiest 40 s: offline render 2.2-2.4x -> 2.7-2.8x real time (Light mode 5x); live audio thread
  ~0.46 -> ~0.43 of capacity (Light ~0.26). Full demo offline: 2.3x -> 2.9x. Same sound: -22.5 LUFS both, peak -8.42 ->
  -8.47 dBFS, per-second level within 0.12 dB, spectrogram correlation 0.994; only the cathedral tail below -56 dB ends sooner.

## Known limits

- `render()` runs about 3x faster than real time for the demo in headless Chromium (130 s of audio in ~42 s); show progress.
- The music box's `ratio2/ratio3` and the strings' `solo/glass` are not macros; show them in an "extra" section.
- A song that is not yet decoded is skipped for that clip start (load() awaits the project's songs, so this only happens
  if a song is chosen while playing).
- Hidden tabs: the scheduler looks 1.2 s ahead so playback survives timer throttling.
