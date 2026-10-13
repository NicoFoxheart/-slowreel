# shared/lib - studio plumbing

Plain ES modules, relative imports only, no dependencies except lamejs 1.2.1 (loaded from cdnjs on first MP3 use).
Read-only for teams: copy the four .js files to `teams/<key>/lib/` and import `lib/export.js` etc. from your own js.
Skip `tests/` (`tests/out/` holds the last run's files, ~9 MB).
Tests: `cd /home/user/nicofoxheart/studio && NODE_PATH=$(npm root -g) node shared/lib/tests/run.cjs` (about 20 s,
Playwright Chromium, then ffprobe / ffmpeg / unzip on the produced files; numbers land in `tests/out/results.json`).

## export.js

| function | what it does |
|---|---|
| `renderOffline({seconds, sampleRate=44100, channels=2, build(ctx, destination)})` -> `Promise<AudioBuffer>` | Makes an `OfflineAudioContext`, awaits `build` (wire and schedule your graph there), renders. |
| `trimTail(buffer, {thresholdDb=-70, minSeconds=0, padSeconds=0.1, fadeSeconds=0.05})` -> `AudioBuffer` | Cuts silence after the reverb tail: keeps up to the last sample above the threshold + pad, never below `minSeconds`, with a cosine fade at the cut. Returns the same buffer when nothing to cut. |
| `measure(buffer)` -> `{peakDb, rmsDb, clippedSamples, seconds}` | dBFS over all channels; `clippedSamples` counts samples with abs >= 1. |
| `encodeWav(buffer, {bitDepth=24})` -> `Blob` | PCM WAV, 24-bit default (16 dithered, 32 float also). Clamps beyond full scale. Synchronous (~100 ms per minute of stereo). |
| `encodeMp3(buffer, {kbps=320, onProgress, signal, lameUrl})` -> `Promise<Blob>` | CBR MP3 via lamejs, encoded in ~12 ms slices that yield to the page. Sample rate must be 32000/44100/48000. `signal` (AbortController) cancels. |
| `loadLame(url=LAME_URL)` | Adds the pinned `<script>` once; called by `encodeMp3`. Call early to prefetch. |
| `makeZip([{name, data: Blob\|Uint8Array\|ArrayBuffer\|string}])` -> `Promise<Blob>` | Stored (no compression) zip with CRC-32 and UTF-8 names. Max 4 GB total (no zip64). |
| `saveFile(filename, blob)` -> `Promise<{status, code?, message?}>` | Never rejects. See below. |
| `recordVideo({canvas, audioNode, seconds, width, height, fps=30, fit='cover', background, onProgress, signal})` -> `Promise<{blob, ext, mimeType}>` | Real-time capture of a canvas (scaled into width x height) plus the sound of `audioNode` with MediaRecorder. `ext` is `'mp4'` when supported, else `'webm'`. Start playback yourself right before calling. Takes `seconds` of wall time. |

`saveFile` statuses:
- `saved` - the viewer (`claude.use('downloads')`) accepted the file.
- `fallback` - not inside the viewer (no `window.claude`, or `use()` resolved null): an `<a download>` link was clicked.
- `declined` - the viewer said no. Do not retry automatically.
- `unavailable` - downloads not usable in this view (`not_granted`, `capability_disabled`, ...). Hide export.
- `error` with `code` - e.g. `rejected_extension` (the viewer refuses `.wav` / `.mp3`: **always pack audio in a .zip**;
  `.zip .mp4 .webm .json .png .txt` are allowed), `rate_limited` (a prompt is already open), `too_large`, `bad_request`.

Export recipe (master):
```js
import { renderOffline, trimTail, measure, encodeWav, encodeMp3, makeZip, saveFile } from './lib/export.js';
const raw = await engine.render(project, { tailSeconds: 8 });      // or renderOffline({seconds, build})
const buf = trimTail(raw, { minSeconds: songSeconds });
const m = measure(buf);                                               // show peak, warn if clippedSamples > 0
const zip = await makeZip([{ name: `${name}.wav`, data: encodeWav(buf) },
                           { name: `${name}.mp3`, data: await encodeMp3(buf, { onProgress: p => bar.value = p }) }]);
const r = await saveFile(`${name}.zip`, zip);                        // declare capabilities: {downloads: true}
```
Video: `recordVideo({canvas, audioNode: engine.output, seconds, width: 1080, height: 1920})`, then
`saveFile('name.' + ext, blob)` (mp4/webm are allowed directly).

## storage.js

`openProjects({appKey, backend?, useTimeoutMs=10000})` -> `{backend, list(), load(id), save(project), remove(id), duplicate(id, newName)}`
- `backend` is `'db'` when the viewer grants `db` + `user` and the person has an id (declare `capabilities: {db: {}, user: {}, downloads: true}`),
  else `'indexeddb'` (database `nfx-studio-<appKey>`), else `'memory'` (lost on reload; tell the person).
- db path: one private doc per project at `data/users/<userId>/studio/projects/<projectId>`. The brief said
  `data/users/<userId>/projects/<id>`, but that is 5 segments, which the real db grammar treats as a collection; the
  extra `studio` segment makes it a valid 6-segment document path. Still private per person.
- `list()` -> summaries `{id, name, createdAt, updatedAt, bpm, lengthBars}`, newest first. `load(id)` -> project or `null`.
- `save(project)` stamps `id` (if missing), `createdAt`, `updatedAt` on YOUR object, returns a copy. Rejects
  `{code:'too_large'}` over 256 KiB of JSON and `{code:'invalid_argument'}` for ids outside `[A-Za-z0-9_-.~:@+]`.
- `duplicate(id, newName)` -> the saved copy (new id). `remove(id)`.
- Keep the demo safe yourself: never save over the demo id, or re-create it from `engine.demo` when missing.

`autosave(store, getProject, ms=1500, {onSave, onError})` -> `{touch(), flush(), cancel(), dispose(), pending, saving, saves, lastSavedAt}`.
Call `touch()` after each edit; it saves `ms` after the last one, never two saves at once, and flushes on tab hide/close.

## songs.js

- `SONGS`: 9 entries `{id, title, file, duration, peaks}`; `peaks` = 120 values 0..1 for drawing waveforms
  (ffmpeg: mono 4 kHz, 120 bins, max abs, normalized, 2 decimals; identical to `shared/tracks-data.json`).
- `loadSong(ctx, id)` -> `Promise<AudioBuffer>` at `ctx.sampleRate`, fetched once and decoded once per sample rate (cached;
  treat the buffer as read-only). Works with AudioContext and OfflineAudioContext.
- Files are fetched from `../audio/<id>.mp3` relative to `lib/`, i.e. `teams/<key>/audio/<id>.mp3`: **copy the mp3s you
  use into your `audio/` folder** (unchanged). `setSongBase(url)` changes the folder; `songUrl(id)`, `getSong(id)` help.

## reverb.js

`makeImpulse(ctx, {seconds=3, decay=seconds, preDelay=0.02, damping=0.4, width=1, reverse=false, seed=1})` -> stereo `AudioBuffer`
for a `ConvolverNode` (set `convolver.normalize` as you like; the IR is scaled to unit energy, so a send of ~0.3-0.6 is a
good start). Exponential envelope reaching -60 dB at `decay` s, highs dying faster with `damping` (so the broadband
RT60 measures ~10-15 % shorter than `decay` at damping 0.45), zero DC, decorrelated L/R (`width` 1 = uncorrelated,
0 = mono), soft 6 ms onset, faded end. Cached per settings. `REVERB_PRESETS`: room, plate, hall, cathedral, infinite
(pair with a feedback loop for freeze), reverse. Shimmer = hall + a pitch-up feedback path (team-side).

## Known limits
- MP3 encoding runs on the main thread in slices (no long task over 50 ms, longest timer gap ~50 ms, about 14x realtime in headless Chromium; a 4-min song takes ~17 s).
- `recordVideo` is real time and needs the tab visible for smooth frames; Chromium without H.264 writes VP9/Opus inside
  `.mp4` (plays in Chrome, Firefox, VLC, YouTube); desktop Chrome picks H.264 when available.
- `makeZip` holds everything in memory (fine for songs; a 10-min 24-bit stereo WAV is ~160 MB).
