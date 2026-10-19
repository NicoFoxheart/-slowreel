# Slowreel

An ambient tape studio in the browser, made for Nicofoxheart (Nicolas Graham). PC only.
Everything is synthesized with the Web Audio API; the only recorded audio is Nico's own songs.

Live (private): https://claude.ai/artifact/R3AWvYoSn5cr4kq6LS7uyX

## What is in here

| Folder | What it is |
|---|---|
| `teams/tape/` | **Slowreel itself** (the published app): `index.html`, `js/ui/` (interface), `js/sound/` (sound engine), `css/`, `lib/`, `audio/` (Nico's 9 songs, unchanged), `demo.json` ("Rain on the Reel") |
| `shared/` | The brief (`BRIEF.md`), the Round 2 plan (`ROUND2.md`), the shared export/storage/songs/reverb library (`lib/`), the QA tool (`qa.cjs`), lamejs for local tests. `shared/audio` points at `teams/tape/audio`. |
| `teams/rain/`, `teams/sky/` | The two other round-1 prototypes ("Lamplit" and "Daylong"), unfinished, kept for ideas |
| `_resume/` | Build scripts, run notes and the Round 2 lane reports, so the work can continue in a fresh session |
| `BUILD-LOG.md` | What each team member built and tested, in order |

## Status

- **Round 1 (live):** 8 instruments / 34 presets, 8 effects with 7 reverb types, shimmer, tape echo, cassette; Nico's songs as clips and
  granular "song clouds"; piano roll, QWERTY playing and recording, mixer, projects, export (zip with a 24-bit WAV + 320 kbps MP3).
- **Stutter fix (live):** play starts in ~15 ms, page freezes during playback mostly under 0.1 s, lighter reverbs, a Light mode
  setting for weaker PCs, and a "made for your computer" screen on phones.
- **East Asia + recipes + 3D (live, Version 5):** `js/sound/asian.js` adds 14 instruments / 52 presets (Korean gayageum, haegeum,
  daegeum, janggu; Chinese guzheng, erhu, dizi, pipa, temple bells; Japanese koto, shakuhachi, shamisen, taiko, wind chimes) and 13
  scales in the scale lock. `js/recipes/` + `js/ui/recipes-panel.js`: 12 beginner recipes (3 Korea, 3 China, 3 Japan, 3 basics) with
  tips. `js/ui3d/` + `css/studio3d.css`: 3D clay tape-machine header drawn in a worker (Settings > 3D studio, off in Light mode).
- **Round 2, the "Antent pack" + Voices (live, Version 6):** synths (Supersaw, Analog Poly, FM E-Piano, Synth Lead, Synth Bass,
  Pluck Synth, Vox Pad) with an arpeggiator; Drum Machine + 808 Bass and a Beats tab step sequencer (also janggu/taiko); Chop Sampler;
  Sidechain Pump, Tape Stop, Bitcrusher, Auto Filter, Stereo Widener; automation lanes ("A" on a track head); "Night Garage" demo
  (projects menu). Voices (`js/sound/vocals.js`): Female Choir, Solo Female Voice, Vocal Chops, Breath & Whisper, Angel Pad
  (formant synthesis, vowels only, no words). Preview: `_resume/vocals-preview.mp3`.

## Run it locally

```
cd teams/tape && python3 -m http.server 8000      # then open http://localhost:8000 on a PC
```
QA: `NODE_PATH=$(npm root -g) node shared/qa.cjs teams/tape` (from the repo root; needs Playwright + Chromium).
