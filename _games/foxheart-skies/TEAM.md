# Foxheart Skies: team rules (read first)

Foxheart Skies is an HD browser flight sim made for Nico (PC, Chrome or Edge, optional Xbox controller). The goal is that it looks and feels like a professional game studio made it, and that it is REALISTIC. Nico's words: "everything is blocks", "it has to be realistic".

- Code: /home/user/nicofoxheart/flightsim (index.html, data/world.json, js/*.js). It uses ES modules plus three.js 0.160.0 through an import map from cdn.jsdelivr.net.
- Local three.js for tests: /home/user/nicofoxheart/redesign/shared/three@0.160.0/
- Headless smoke test: `node /tmp/claude-0/-home-user/63fae2cc-feee-5482-a580-df58aa871eb9/scratchpad/simtest/smoke.cjs`
  - It serves the tree as http://sim.local and maps jsdelivr to the local three.js.
  - It prints page errors and saves boot.png.
  - Copy it into your own scratch folder to script cameras and screenshots. Use SwiftShader flags; fps there is not representative.
- Progress log: PROGRESS.md. Append one line when you finish a sub-part (what changed, and what comes next).

## Several artists work in this tree at the same time. File ownership:
| Who | Owns (only you edit these) |
|---|---|
| Lead / systems (cockpit, Xbox controls, arrival, pushback) | main.js, flightdeck.js, fdart.js, systems.js, cockpit.js, fdm.js, onfoot.js, pa.js, atc.js, audio.js, traffic.js, data.js, sky.js, terrain.js, index.html |
| Aircraft artist (exterior + cabin) | aircraft.js; the CABIN section of interiors.js (from the `cabin (aircraft body frame)` divider comment down to, not including, `export function boardRows`); any new files you create, prefix `ac-` |
| Character artist (crew + passengers) | people.js; any new files you create, prefix `ppl-` |
| Environment artist (airport exterior + terminal) | airport.js, surroundings.js; the atlas, geometry-builder, Crowd, WalkMap, terminal and jet-bridge sections of interiors.js (everything before the `cabin (aircraft body frame)` divider, plus boardRows); any new files you create, prefix `env-` |

- **Keep the exports and their signatures stable.** Other modules import these:
  - aircraft.js: `buildAircraft, animateAircraft, foxHeart, DIM`
  - airport.js: `buildAirport, ilsFor, ilsDeviation, LIGHT_U, parkedAirlinerGeometry`
  - surroundings.js: `REGIONS, FEATURED_INFO, climateFor, TERMINAL_HINTS`
  - interiors.js: `ACCENTS, Crowd, WalkMap, buildTerminal, buildBridge, buildCabin, boardRows, CABIN`
  - people.js: `People`

  You may ADD exports or optional parameters.
- **Need a change in a file you don't own?** Do not make it. Describe it in your final report, and the lead or Claude will wire it.
- **Edit with the Edit tool only, never Write over a shared or owned existing file.** Small atomic edits, and keep the game booting after each one. If boot breaks in a file you don't own, wait a minute and re-run; never "fix" someone else's file.
- **Put big new art code in your new prefixed files** instead of growing shared files.

## Quality bar and constraints
- Realistic, not toy-like. Use:
  - bevelled and rounded geometry (ExtrudeGeometry with bevels, LatheGeometry, subdivided curves);
  - procedural canvas normal and roughness maps; baked AO; PMREM env reflections where it helps;
  - correct scale and proportions, and believable materials (paint, metal, glass, fabric, skin).
  - Keep everything generic and unbranded: no real airline or company logos.
- Performance:
  - it must stay smooth (60 fps target) on a mid-range PC;
  - merge static geometry (BufferGeometryUtils.mergeGeometries), instance repeats, use texture atlases and LOD, and honour the existing quality setting;
  - avoid huge texture counts.
- Runtime network: three.js from jsdelivr and Google Fonts only. No new hosts, no fetches except the tree's own files. Build assets procedurally in code. Only bundle a model file if its licence is clearly CC0, MIT or similar, and keep the licence file next to it. Never use Mixamo or anything with unclear rights.
- Do NOT publish artifacts and do not push git. Claude publishes and backs up after each of your reports.
- Usage is limited. Work efficiently, check in often (PROGRESS.md), and avoid long idle loops. If you are stopped by a limit, you will be resumed with a message; continue from PROGRESS.md.
- When you finish, report:
  - what changed, per file;
  - before/after screenshot paths, saved in your scratch folder under /tmp/claude-0/-home-user/63fae2cc-feee-5482-a580-df58aa871eb9/scratchpad/;
  - the smoke test result;
  - any cross-file wiring you need.
