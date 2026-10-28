# Foxheart Skies: how to resume if work stops

Live link: https://claude.ai/artifact/Fnfn6Njxh3cxXeq2zZLB3s
Backup: private repo NicoFoxheart/-slowreel, folder `_games/foxheart-skies/`
Progress log: PROGRESS.md (one line per finished step; the last line is where to pick up)

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

## Rules
- After each step: publish to the live link with the full `files` list (index.html, data/world.json, every js/*.js), then copy the folder into the backup repo, commit and push.
- Runtime hosts: three.js 0.160.0 from jsdelivr and Google Fonts only. No new hosts.
- Real OSM mapping is blocked (the proxy tunnel drops). Keep the procedural surroundings and never fake real map data.
- Keep 60 fps on a mid-range PC by using quality tiers and LOD.
