# Foxheart Skies: how to resume if work stops

Live link: https://claude.ai/artifact/Fnfn6Njxh3cxXeq2zZLB3s
Backup: private repo NicoFoxheart/-slowreel, folder `_games/foxheart-skies/`
Progress log: PROGRESS.md (one line per finished step; the last line is where to pick up)

## STATUS at handoff (2 Nov 2026)
- **Live (v7):** new flight deck, easy Xbox mode, PA fix (speech.js), engines silent at start, arrival, pushback + ground crew (groundcrew.js), Land it yourself (landing.js), detailed other planes (ac-traffic.js).
- **Unfinished, in this backup, NOT live:**
  - js/music.js: cabin and boarding music, by the lead;
  - js/ac-livery.js, ac-shape.js, ac-util.js: the player aircraft exterior, by the aircraft artist.
  - The main.js edits for these may be partial. Smoke test before publishing.
- **Next, in order:**
  1. finish the cabin music, then much better ATC;
  2. player aircraft exterior + cabin;
  3. crew and passengers;
  4. airport + terminal (env-kit.js started);
  5. sky, ground and road cars.
- **The previous agents are gone in a new chat.** Spawn fresh ones per TEAM.md, at most two at a time, in lean mode. They have to read the code again.
- **Publishing:** publish to https://claude.ai/artifact/Fnfn6Njxh3cxXeq2zZLB3s with `url` set to that link, the full `files` list (index.html, data/world.json and every js/*.js imported by main.js), and `root` = the folder. Read the artifact first (action read) so the publish is allowed.
- **Working with Nico:** very usage-conscious, so keep updates short and only message when something is ready. If anything would cost money, stop. Review every agent's work before it goes live, and send sloppy work back.

## Queue (in order)
1. Flight deck rebuild: flightdeck.js, fdart.js, systems.js; overhead panel; cold-and-dark start
2. Easy Xbox controls
   - First fix the stuck-brake bug in main.js: `fdm.brake = bt(1) ? 1 : fdm.brake`, and there is no decay while a pad is connected.
   - Add an Easy assist, a smart "next step" A button, an X ATC menu, a Y PA menu, a glyph overlay, a Controller settings page and rumble.
3. Realism: aircraft exterior (livery clear coat, engines, gear, lights, contrails)
4. Realism: cabin (fabric seats, IFE screens, bins, shades, mood lighting)
5. Realism: crew and passengers (smooth bodies, faces, hair, uniforms, gait)
6. Realistic airport
   - Terminal interior: ceilings, glass wall, floors, gates, shops, local flavour.
   - Exterior: jet bridges, tower, hangars, ground vehicles, runway lights and signs.
7. Arrival flow
8. Pushback tug, ground crew, jet bridge retract

## Team (since 28 Oct): see TEAM.md for file ownership
- Lead: items 1, 2, 7, 8
- Aircraft artist: items 3 and 4
- Character artist: item 5
- Environment artist: item 6
- Claude reviews every report before publishing:
  - run the smoke test;
  - check the screenshots against the brief;
  - read the diff for sloppy work (blocky placeholders, dead code, perf traps, broken exports);
  - send fixes back, or fix small issues directly.

## Nico's requests (29 Oct, 2:50 UTC), in priority order
- **P0 (lead, ship first):**
  - pad quick fix and cockpit polish;
  - PA fix: one speech manager with priorities, no cancel from ATIS, chunking, modal number keys, subtitles;
  - no engine sound at start (engines off at the gate, APU on, a Start engines button);
  - smoothness pass.
- **Then (Nico's pick):** full easy-mode controller → arrival flow → pushback with tug and ground crew.
- **After that (lead):** cabin and boarding music (procedural); much better ATC flow.
- **World artist (new, after P0 ships):** better sky and clouds, better ground, very detailed road cars seen from the air.
- **Paused until P0 ships:** aircraft, character and environment artists. Resume each with SendMessage when ready.

## Rules
- After each step: publish to the live link with the full `files` list (index.html, data/world.json, every js/*.js), then copy the folder into the backup repo, commit and push.
- Runtime hosts: three.js 0.160.0 from jsdelivr and Google Fonts only. No new hosts.
- Real OSM mapping is blocked (the proxy tunnel drops). Keep the procedural surroundings and never fake real map data.
- Keep 60 fps on a mid-range PC by using quality tiers and LOD.
