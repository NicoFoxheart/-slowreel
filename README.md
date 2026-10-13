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
- **Round 2, the "Antent pack" (built and tested, NOT wired in yet, on hold):**
  - `teams/tape/js/sound/synths.js` + `arp.js`: Supersaw Dream Pad, Analog Poly, FM E-Piano, Synth Lead, Synth Bass, Pluck Synth,
    Vox Pad (30 presets) and an arpeggiator.
  - `teams/tape/js/sound/drums.js` + `js/ui/steps.js`: Drum Machine (Future Garage, Phonk, Lo-fi Dust, Soft Ambient kits), 808 Bass with
    glide, step sequencer with swing.
  - `teams/tape/js/sound/sampler.js`, `fx2.js`, `js/ui/automation.js`, `js/ui/sampler-ui.js`: Chop Sampler (Nico's songs or imported
    audio), Sidechain Pump, Tape Stop, Bitcrusher, Auto Filter, Stereo Widener, automation lanes.
  - `teams/tape/demo-night-garage.json`: "Night Garage", an Antent-style demo (preview MP3 in `_resume/night-garage/`).
  - To finish Round 2: run the integration step in `_resume/r2-integrate.js` (it lists every call to wire), then QA and publish.

## Run it locally

```
cd teams/tape && python3 -m http.server 8000      # then open http://localhost:8000 on a PC
```
QA: `NODE_PATH=$(npm root -g) node shared/qa.cjs teams/tape` (from the repo root; needs Playwright + Chromium).
