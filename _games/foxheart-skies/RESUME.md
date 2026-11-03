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

## Nico's requests (2 Nov 2026), in progress
- **Live v8 (2 Nov):** the lead's ATC rebuild, failures + MAYDAY/PAN-PAN, fire and rescue, evacuation, and the music fixes, with the OLD v7 aircraft/cabin files (the new ones were still in progress). Known nit: background chatter can clear traffic for takeoff after an emergency has been cancelled while the rescue is still on the runway.
- Lead (running): verify and finish the cabin music → much better ATC flow → emergencies (MAYDAY/PAN-PAN with ATC, engine failure/fire, gear won't extend + belly landing, hydraulics, bird strike, depressurisation, electrical, stuck flap; Failures menu, challenge starts, fire trucks, evacuation).
- Aircraft artist (running): the player aircraft exterior (finishing ac-livery/ac-shape/ac-util and wiring them into aircraft.js).
- Environment artist (queued; starts when a slot frees, max two agents at a time): HUGE airport upgrade + big ground-service upgrade. groundcrew.js now belongs to the environment artist. Real turnaround: fuel truck/hydrant dispenser, catering hi-lift trucks, belt loaders, baggage tug + carts, container loader, lav and water trucks, GPU, cleaning crew, pushback. Vehicles drive in on service roads.
- **Live v9 (3 Nov):** the new player aircraft exterior (ac-model.js) and passenger cabin (ac-cabin.js).
- **Nico's requests (3 Nov):** (a) runways inside buildings: BUG, env artist, top priority; (b) realistic terminal interiors with check-in, security, passport control and shops: env artist Job 2; (c) realistic people faces and bodies: character artist (running); (d) NEXT, queued: free flight ANYWHERE in the world (pick any spot on a world map or any airport, with terrain, coastlines and cities generated everywhere, no invisible edges). This is lead (main.js menu and start) plus world artist (terrain.js/sky.js streaming), and starts when a slot frees.
- **Nico's requests (3 Nov, later):** (e) DONE in v9.5: MAYDAY/PAN-PAN behind an 'Emergency…' confirm at the end of the ATC list. (f) QUEUED: third-person on foot, i.e. see your own character walking (onfoot.js plus a player avatar from the new People model), after the people rebuild lands. (g) CANCELLED by Nico (3 Nov): fly other aircraft types, Boeing-style and Airbus-style, with made-up airline liveries and invented logos (Nico OK'd fake logos; never real airline or manufacturer logos): a narrowbody 737-style with yokes, widebodies 787/A350-style, maybe a 747-style. Each needs its own exterior model and dimensions, FDM performance, speeds and flaps, and a cockpit variant (yoke vs sidestick). Aircraft artist plus lead, with a type picker in the menu.
- **Nico's requests (3 Nov, later 2):** (h) a visible co-pilot in the right seat with idle life and gestures on FO actions; (i) flight attendants serve food and drinks with trolleys in cruise, sit in jump seats for taxi/takeoff/landing. Both are queued on the character artist after the realistic people rebuild; the lead wires them in main.js/flightdeck.js.
- **3 Nov, evening:** v10 is live (airport, terminals, ground services panel, people lap fix). Running: the character artist (co-pilot, cabin service) and the lead (Part A third-person on foot, then Part B fly anywhere).
- **Nico's feedback (4 Nov):** the airport feels boring, the people look creepy, flying is boring. RULE NOW: nothing goes live for the airport, interiors or people until it passes a design review against DESIGN.md and Nico has seen screenshots ("don't push until it's perfect"). A design review panel (art director, architect, interior designer, character lead, game designer) is writing DESIGN.md. Nico's gameplay picks: Career/airline mode, Wild weather, Drama on board. People features (co-pilot, meal service, third-person avatar) WAIT until Nico approves a new face lineup (recommended direction: polished stylised-realism).
- **4 Nov, later:** Nico paused Part B (fly anywhere): code in the tree, FLY_ANYWHERE = false. The lead now builds the surroundings: realistic houses and neighbourhoods by region, highways with interchanges, the airport access loop, hotels/car parks/logistics, traffic. Live v10.1 (black-cabin NaN fix). Third-person, co-pilot and meal service are held for the face lineup.
- Smoke test now: scratchpad smoke.cjs (see the agent briefs); the TEAM.md paths are stale; the game folder is this one.
