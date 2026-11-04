# Foxheart Skies: design review and build guide

The panel: art director, airport architect, aircraft interior designer, character art lead and game designer.
Build reviewed: v10, the LIVE snapshot Nico played (`scratchpad/pub16`), captured at QUALITY=high.
Date: 3 Nov 2026.

Nico said: "the airport feels so boring", "the people look so creepy", "I feel so bored just flying around", "I don't want it pushed until it's perfect".

## Rule from now on: the ship gate

Nothing new for the airport, the interiors or the people goes live until two things happen:
- the "Definition of done" shot list for that area passes on a contact sheet captured at 1920x1080, at both `high` and `medium`;
- Nico has seen the sheet.

People features wait for a separate approval: the co-pilot, the meal service, the third-person avatar and any cabin drama visuals stay unshipped until Nico approves the new face lineup (section 4).

## Screenshot index
- `S/` = `/tmp/claude-0/-home-user/957d61e6-f324-52f0-9e4a-8249d71c8a77/scratchpad/design/out/`. These are the panel's captures: run A (A01–A40) and the two run-B shots (B01, B02).
- `E/` = `/tmp/claude-0/-home-user/957d61e6-f324-52f0-9e4a-8249d71c8a77/scratchpad/env/out/`. These are the environment artist's own v10 hall shots of the same build. We used them where run B was stopped early.
- To recapture, use the harness scenarios `design/runA.js` and `design/runB.js` in the same scratch folder. They work with `QUALITY=high node smoke.cjs pub16 out runA.js`.
- **Not captured** (the run was stopped on request): security close-up, passport, the jet bridge on foot, the boarding aisle on foot, the terminal face close-ups and lineup, and the RKSI interior. Wherever a verdict relies on code reading instead, it is marked "(from code)".

## The verdict in five lines
1. **Lighting is the root problem everywhere.** At the default `high` quality there are no exterior sun shadows at all. `updateShadows()` in main.js gives `high` a 256 px, 1 m shadow box; only `ultra` gets a 140 m box, and even then only the player aircraft casts. The terminal and cabin use a nearly flat baked term. Everything floats and nothing has form (A06, A07, A09, B01, A17).
2. **There is one of everything.** One terminal typology, one facade, one hall and one aircraft type are repeated at every airport and every stand. KMIA and RKSI differ only in the name sign (A06 vs A33, A12 vs A37). Repetition reads as "procedural placeholder", and that reads as boring.
3. **The terminal is a single 88 m box.** It has an 11 m flat warehouse ceiling, the whole passenger journey is visible from the door, and it holds ~60 m² of floor per person. It has no sequence, no daylight, no life and no place (B01, B02, `E/hall-*`).
4. **The people sit in the uncanny valley.** They have realistic 7.5-head anatomy but low-fidelity surfaces. The sclera glows: it is brighter than the skin, up to 20x brighter on dark skin. Eyes have no lid shadow or lashes. Faces hold a dead-neutral stare, the hair is a helmet, and there is a flight attendant's face 0.5 m from the default cabin camera (A25, A26, A29, A21).
5. **The flight has no stakes.** The sim systems are rich: ATC, failures, PA, ground services. But nothing is at risk, nothing is earned and nothing happens in cruise, and the only payoff (the landing score) is a toast. Weather is a fog filter (A03).

---

## 1. Airport exterior

### Verdict
| # | What reads fake, boring or creepy, and why | Shots |
|---|---|---|
| X-1 | **No sun shadows at the default quality.** The aircraft, jet bridges, GSE, light masts and terminal overhang cast nothing, so objects float on the concrete. A real apron photo is composed around two things: the black shadow under the airliner and the hard shadow band of the roof overhang on the facade. Without them, time of day doesn't read either. | A06, A07, A09, A10, A11 |
| X-2 | **The facade is a printed tarp.** The single glass plane has a uniform gradient reflection and a mullion grid, no depth, and nothing visible inside: no ceiling, lights, people or seats. From the flight deck at the gate (A22), the most-seen building in the game is a mirror with nothing behind it. | A06, A22, A33 |
| X-3 | **One typology at every airport.** Each airport is one long linear bar with a wave roof, dropped in an empty field, with identical stands (env-buildings.js). Real airports read through massing: a landside headhouse, piers or fingers, satellites, an X-shaped concourse, the car-park block, a hotel, a hangar row, the cargo apron, the fuel farm. KMIA and RKSI are interchangeable. | A12, A37, A09, A35 |
| X-4 | **No sense of place.** The airport sits on a flat green or yellow plane: no perimeter fence, no landside roads with traffic, no trees, palms or water. Miami has no canals or palms. Incheon, an island airport in the sea, has no sea. | A12, A37, A07, A34 |
| X-5 | **The approach shows nothing.** At 2.2 nm and 780 ft (the money shot of any flight sim) the runway is a white sliver of ~8x11 px, with no daytime approach-light structure and low asphalt contrast against hazy "spreadsheet" terrain. The ground beyond the airport is a flat tile grid with no 3D buildings. | A01, A02, A38, A39 |
| X-6 | **The night city is a uniform orange grid carpet.** Every block has the same light-dot pattern, the airport sits in a black void disc (the City exclusion), and large *square* stars hang over a lit city at 750 ft, where light pollution would hide them. | A04, A05, A15, A32 |
| X-7 | **Night exposure fails.** The terminal glass and roof skylights blow out to white: the skylights read as runway lights (A13, A14). The flight deck at the gate at night is a complete white-out (A24). | A13, A14, A15, A24 |
| X-8 | **The tower sits on the terminal roof at KMIA.** That is architecturally wrong: towers stand free for sightlines and structure. | A09 |
| X-9 | **The apron is sterile.** It is one even tone of clean concrete, every parked aircraft is the same narrowbody in a different tail colour, nothing moves at the other stands, and there are no blast fences, no GSE parking rows and no wear. The eye-level view (A08) is an empty grey plane. | A08, A09, A35 |

### Target look (the architect's brief)
**A modern hub.** Arriving by air, you read four things in one glance:
- a big landside headhouse with a long-span roof (white steel space frame or timber-clad steel), cantilevered 15–25 m over a two-level curb and casting a deep shadow band;
- piers of full-height glazed gate lounges, lit warm inside, with people and seat rows visible;
- free-standing jet bridges with glass tunnels;
- a free-standing tower on its own base building, between the runways and the terminal.

**Around it:** a hangar row with the doors half open, a cargo apron with ULD racks, a fuel farm (round white tanks), a fire station, perimeter roads with service traffic, a car-park block, and a hotel or office cluster on the landside. Beyond the fence is the city, which has roads, not a grid.

**Per climate (kit-of-parts swaps):**
- **Tropical / subtropical (KMIA):** white concrete and aluminium, deep brise-soleil fins, palms and sea-grape planting, canals and water, hard light with black shadows, afternoon cumulus.
- **Coastal temperate island (RKSI):** a sweeping pale roof, blue-grey metal, sea on three sides, reclaimed flats and a bridge, winter haze.
- **Maritime temperate (EGLL):** dark steel, brick and glass, grey diffuse light, wet tarmac with reflections.

**The apron** is a patchwork of concrete slabs of different ages, with darker asphalt shoulders. It has rubber at the lead-in lines, oil at each stand, hatched GSE parking full of parked equipment, blast fences at the stand ends, and aircraft of three sizes at different turnaround phases.

### Prioritised fix list
Impact: H/M/L; effort: S (days), M (about a week), L (multi-week).

| # | Fix | Technique (three.js, procedural) | Impact | Effort | Owner |
|---|---|---|---|---|---|
| X-F1 | **Sun shadows at `high`** | Two cascades (0–150 m and 150–1200 m, 2048 each, texel-snapped so they don't swim), with buildings, bridges, GSE, masts and parked aircraft as casters. Cheaper option for `medium`: per-airport baked shadow decals (project each static mesh's footprint along the sun direction at build time and when the time of day changes by more than 20 min), plus blob contact shadows under GSE, people and wheels. | H | M | Env + Lead (main.js) |
| X-F2 | **Approach readability** | Asphalt albedo 0.08–0.12 linear with rubber build-up in the touchdown zone. Crisp markings (anisotropy 16, mip bias −0.5). Daytime approach-light stanchions and crossbars, a 1–2 px minimum projected size for lights, PAPI lights, less haze inside 10 km on clear days, and a 55–60° default deck FOV on final (or auto-zoom when the radio altimeter is below 1500 ft). Night: a sequenced-flasher "rabbit" and edge, centreline and TDZ lights. | H | S–M | Env + Lead |
| X-F3 | **Facade v2** | Interior-mapping shader behind the glass: a fake room box per bay with a ceiling light grid, floor, seat rows and people silhouettes from an atlas. Add Fresnel reflection of the real PMREM environment, mullion depth (normal + AO), ceramic frit, slab edges and fins. At night the interior glows at 3000K, clamped to ≤1.5x exposure. | H | M | Env |
| X-F4 | **Night exposure** | Cap emissive per material by exposure. Set the bloom threshold above 1.0 at night. Skylights get a dim, diffuse emission. Fade stars by city light pollution and exposure. Stars become gaussian point sprites of 1–2 px, never squares. Floodlight cones become soft volumetric cone cards visible in haze. | H | S | Env + World (sky.js) |
| X-F5 | **Terminal typologies** | A generator with four plans, picked by runway count and traffic size: linear (small); headhouse + 2 piers (medium); headhouse + 4 piers or an X concourse (large); headhouse + midfield satellite (hub). Two or three storeys, and a roof family per climate (wave, folded plate, barrel vault with skylights, flat with deep overhang). Built from the existing Bucket/merge kit. | H | L | Env |
| X-F6 | **Context ring** | Landside: hotel/office blocks, the car park, road loops with instanced car flows, and a perimeter fence with lights. Airside: a hangar row, cargo, fuel farm and fire station. Climate vegetation is instanced (palms, broadleaf, pines) along roads and car parks. Water and sea from the surroundings coastline where it exists. The tower stands free on its own base building, never on the roof. | H | M–L | Env + World |
| X-F7 | **Apron storytelling** | A slab-age tone patchwork, stains and rubber, blast fences, GSE parking boxes filled with instanced idle equipment, AI GSE driving the service roads between stands, other stands at random turnaround phases (doors open, belt loader up, bridge docked), and a fleet mix of at least 3 silhouettes (regional, narrowbody, widebody), with liveries from the invented-logo generator. | M | M | Env + Aircraft |
| X-F8 | **Ground beyond the fence** | Land-use patchwork with hedgerows and tree lines, a road hierarchy, instanced low-rise roofs in urban areas, and street-light chains that follow the roads at night instead of a grid. Remove the black disc around airports by letting the urban mask continue at low density. | H | L | World (terrain.js) |
| X-F9 | **Weather on the ground** | Wet tarmac with puddle masks reflecting the lights, rain streaks visible against lights, wind socks animated by the real wind. | M | S–M | Env + World |

### Definition of done (exterior)
- [ ] **X1. 2 nm final, deck, day, clear (KMIA 09):** the runway reads at first glance as a dark trapezoid with white markings; the approach-light structure is visible; the terrain has 3D roofs and trees in the foreground.
- [ ] **X2. Same, at night:** the approach lights and rabbit, edge, centreline and TDZ lights are visible; the city lights follow roads; there is no black disc and no square stars.
- [ ] **X3. Chase view at the gate (the first view Nico sees):** hard sun shadows under the aircraft, bridge, GSE and masts; a facade with depth and a lit interior with people; at least 2 vehicles moving in frame.
- [ ] **X4. Apron at eye level (1.7 m):** concrete tone variety, blast fences, GSE parking, other stands busy.
- [ ] **X5. Tower view:** the tower is free-standing; at least 3 aircraft types are in view; one aircraft is taxiing.
- [ ] **X6. Wide view at 1.1 km:** the typology is recognisable (headhouse and piers), and the landside, roads and context are unique to the airport.
- [ ] **X7. Golden hour:** long shadows, a warm and cool split, and the facade reflecting the sunset sky.
- [ ] **X8. Night apron and night deck at the gate:** no white-out (A24 must be fixed), floodlight pools, a warm interior glow.
- [ ] **X9. The X1–X8 set at a second climate (RKSI or EGLL):** materials, vegetation, water and light are visibly different, and a stranger could tell which airport is which.
- [ ] **X10. Performance:** 60 fps on a mid-range PC at `medium`, and ≥45 fps at `high`.

---

## 2. Terminal interior (on foot, at eye level)

Captured: B01 (spawn/landside), B02 (check-in). From the env artist's v10 shots: `E/hall-shops.png`, `E/hall-gates.png`, `E/hall-security.png`, `E/hall-arrivals.png`, `E/hall-passport.png`, `E/hall-checkin.png`.
Not captured: the jet bridge and gate lounge at night (from code).

### Verdict
| # | Problem and professional reason | Shots |
|---|---|---|
| T-1 | **One room.** `buildHall()` (env-hall.js) is a single box: 88 m wide (HW = 44), 46–66 m deep, with an 11 m flat perforated ceiling. Check-in, security, passport, shops and gates all sit in the same volume, so from the spawn you see the whole journey at once (B01). Great terminals are *sequences*: compression before security, release into the airside hall, a reveal of the apron. With no sequence there is no anticipation and no reward, and that is why it is boring. | B01, B02 |
| T-2 | **Warehouse ceiling.** The perforated grid with linear tubes fills a third of every frame (B01, `E/hall-arrivals`). It reads as a car park or distribution centre, not as civic architecture. There are no skylights, no structure expressed, and no change in height. | B01, B02, E/hall-arrivals |
| T-3 | **Flat light (from code + shots).** The baked `light()` function is L = 0.74 + small terms (≈0.6–1.1 across the hall), so there are no sun patches, no shadows of the mullions and no dark-to-bright rhythm. Everything is evenly overcast-white. The floor "reflections" are mirrored emissive geometry, so signs appear as sharp ghost rectangles printed on the floor (B01 "Control de seg…" on the floor) instead of blurred Fresnel reflections. | B01, B02 |
| T-4 | **Density and purpose.** 96 people (NP = 96) in ~5,800 m² is about 60 m² per person; a real hub at midday has 6–10 m² per person in queues and 20–40 m² in circulation. Walkers ping-pong on 2–3 point straight paths. No one is in a hurry, eats, looks at the FIDS, drags a child or sleeps across seats. | B01, E/hall-shops, E/hall-gates |
| T-5 | **Picture-board retail.** Shops and cafés are flat images in a box (the env artist names this in PROGRESS.md as a gap). There are no counters with depth, no lit shelves, no café life. | E/hall-shops, E/hall-gates |
| T-6 | **Materials.** Stone floor, white walls and grey steel; no timber, no terrazzo aggregate, no planting except a lone palm, no art. | all |
| T-7 | **Signage bugs.** "Control de seguridad" is cut off at the panel edge (B01, B02). The check-in back wall is a giant blank fox panel (B02). The arrivals hall is a 40 m blank wall with a small pink sign (E/hall-arrivals). | B01, B02, E/hall-arrivals |
| T-8 | **Climate and place.** Every hall is the same box. Only the sign words and the shop names change by airport (from code: `WORDS` per language). | from code |
| T-9 | Help-bar mojibake "WASD walk Â·" (E/ shots). index.html has no `<meta charset="utf-8">`. The live host may add one, but add it anyway (lead). | E/hall-shops |

### Target look
**A modern hub terminal as a promenade.** In order:

1. **Curb.** A canopy with a deep shadow, then sliding doors.
2. **Check-in hall.** 15–20 m high under a long-span roof (timber-clad steel or a white space frame) with daylight slots or skylights throwing moving sun patches. Tree-like columns. Terrazzo with brass inlay lines. Check-in islands with backlit airline walls. A big FIDS wall at the entry decision point.
3. **Security.** A compressed, calm 4 m ceiling with warm timber baffles and soft light.
4. **Airside market hall.** The release: double height, with the apron and aircraft visible through full-height glass. A planted court with trees, a suspended art installation, a food hall with real counters and people eating, and a mezzanine lounge.
5. **Piers.** Lower (5–6 m), glazed on both sides, carpeted gate lounges with seat rows facing the aircraft. A gate desk with agents and a boarding queue. Kids at the glass.
6. **Jet bridge.** A glass tunnel, with sun and the aircraft door ahead.
7. **Arrivals.** Immigration, then the baggage hall with moving carousels and bags, then the "welcome" hall with greeters holding signs, a café and a rental-car desk.

**Lighting:**
- daylight leads (sun patches with mullion and roof-slot shadows);
- 4000K general light, 2700–3000K warm accents at shops and lounges;
- the dark-bright rhythm along the route always pulls you toward light.

**Sound:** murmur, rolling cases, PA chimes and boarding calls, coffee machines.

**Per climate:**
- **Miami:** terrazzo with marine inlays, palms, pastel accents, EN/ES signs.
- **Incheon:** cool white long-span roof, lattice motifs, indoor gardens, KO/EN.
- **London:** dark steel, brick, grey daylight, EN.

### Prioritised fix list
| # | Fix | Technique | Impact | Effort | Owner |
|---|---|---|---|---|---|
| T-F1 | **Sequence of rooms** | Split the box into 4 volumes with different heights: landside 16 m, security 4 m, airside 10 m, pier 5.5 m. Link them with portals and a level change (2 m ramp or escalator) at security. Build each room as its own merged mesh and cull by room (also a performance win). Keep the WalkMap route; onfoot.js needs no change if the zones keep their tags. | H | L | Env |
| T-F2 | **Daylight with shadows** | (a) A sun "gobo": a procedural mask of mullions, skylight slots and roof structure, projected along `ATM.uSunDir` onto floor, walls and people in the hall shader. Cheap, dynamic and correct with time of day. (b) Re-bake `light()` as real sky visibility: ~32 hemisphere rays per vertex against the room boxes at build time (in a worker or sliced over frames), plus an AO term for counters and seats. | H | M | Env |
| T-F3 | **Ceilings and structure** | Vary per room: instanced timber baffles in the landside hall, coffered skylights with emissive scatter, tree columns (LatheGeometry trunk + 4 TubeGeometry branches), a folded-plate roof in the airside hall. Remove the global perforated grid. | H | M | Env |
| T-F4 | **Floor and reflections** | A terrazzo shader (cellular aggregate + inlay lines + wear). Replace the mirrored geometry with a half-resolution planar reflection (Reflector) on `high`, blurred by roughness with Fresnel, and with a reflection cube or SSR-lite on `medium`. No more ghost sign decals. | M | M | Env |
| T-F5 | **Crowd density and purpose** | 250–400 people using LOD2 and LOD3 impostors (section 4). Goal-driven agents (queue → counter → security → shop → gate) with timetabled pulses tied to the FIDS. Families and groups walk together; there are crew formations with trolleys, cleaners with machines, electric carts and a "late runner". | H | M | Env + Character (after approval) |
| T-F6 | **3D retail and food hall** | Shallow real boxes 2–3 m deep with shelves (instanced products in an atlas), lit display cases, mannequins as LOD2 people, a café counter with an espresso machine and pastries, tables with people eating. Interior-mapping for the far units. | M | M | Env |
| T-F7 | **Wayfinding and FIDS** | Fit the text to the panel (measure and wrap or shrink), stacked bilingual lines, pictograms, big gate numbers, FIDS clusters at every decision point showing the sim's real flights. Replace the blank arrivals wall with a welcome art wall and a greeter barrier. | M | S | Env |
| T-F8 | **Planting and art** | Planters with instanced climate plants, a planted court with 3–5 trees, one procedural suspended art installation per airport (e.g. a cloud of folded paper planes, a kinetic mobile). | M | S | Env |
| T-F9 | **Gate lounge** | Seat rows facing the player's aircraft, carpet, a gate desk with 2 agents, the boarding queue forming by group number, and a boarding PA and chime when the player boards. | M | S | Env + Lead (PA) |
| T-F10 | **Ambient sound** | Terminal bed, PA chime, rolling cases, distant announcements, through audio.js (lead) with zones from WalkMap tags. | M | S | Lead |

### Definition of done (terminal)
Every shot is taken at eye level (1.65 m), at 13:00 and at 21:30, at KMIA and one other climate.
- [ ] **T1. Curb → doors:** a canopy shadow band, the hall's roof visible through the glass.
- [ ] **T2. Check-in hall:** a high roof with sun patches on the floor, a FIDS wall, queues of at least 8 people per island, no blank walls.
- [ ] **T3. Security:** a visibly lower, warmer ceiling; trays moving; staff working.
- [ ] **T4. Airside release:** aircraft visible through the glass, the planted court, the art installation.
- [ ] **T5. Shop and café interior** with depth and people eating.
- [ ] **T6. Gate lounge** with the player's own aircraft outside, seated passengers, the desk with agents.
- [ ] **T7. Jet bridge** with daylight and the open aircraft door ahead.
- [ ] **T8. Baggage hall** with a moving carousel and bags, and greeters in the welcome hall.
- [ ] **T9. Regional variety:** no two of the set could be swapped between airports.
- [ ] **T10. Performance:** ≥60 fps on `medium` with room culling.

---

## 3. Aircraft cabin and flight deck

### Verdict
| # | Problem | Shots |
|---|---|---|
| C-1 | **Something docked at the stand pokes into the cabin.** At the gate, the default cabin camera (key 7, looking aft) has a black block over ~65% of the frame. When looking forward-right at the galley, a black box with white trim and navy fills half the frame. In cruise the same view is clean (A29), so the intruder is docked at the stand. The most likely culprits are the jet-bridge cab at L1 and the catering hi-lift box at R1, penetrating the cabin shell (unconfirmed). To confirm: `__sim.rayAt(0.7,0.5)` in the cabin view at the gate. | A16, A18, A19 |
| C-2 | **A flight attendant stands ~0.5 m in front of the default cabin camera and stares into the lens.** The first person Nico meets in the cabin is a point-blank wide-eyed face. | A25, A26, A29, A31 |
| C-3 | **White-clay cabin.** Sidewalls, bins and ceiling share one matte grey-white with no material separation (laminate, gloss bin doors, satin plastic). Light is uniform: no cove gradient, no window light pools on seats, no reading lights. It reads "overcast render". | A17, A29, A20 |
| C-4 | **Night mode doesn't read.** Night cruise (A31) looks almost identical to day (A29), and so do night at the gate (A25) and auto (A26). A real night cabin is dark, with blue/amber cove light, reading-light pools, IFE glow on faces and closed shades. | A29 vs A31, A25 vs A26 |
| C-5 | **Window seat.** The reveals are thick and puffy, the shade isn't visible, and there is no frame trim or inner-pane breather hole. The outside isn't 3–4 EV brighter than the cabin, so the view looks pasted on. | A20, A30 |
| C-6 | **Every row is identical.** 100% load factor, the same pose (hands on armrests or thighs), everyone looking forward, no clutter (bags, cups, blankets, open tray tables, phones, coats in bins). | A17, A29 |
| C-7 | **The flight deck at night is black with floating displays.** No integral panel lighting (backlit legends), no flood or dome light. Stars are large squares. | A32 |
| C-8 | **Flight deck at the gate, night: white-out** (see X-7). | A24 |
| C-9 | **The deck by day is solid.** Panels and displays are readable and the geometry is good. The glareshield is a flat black slab with no crackle-finish sheen, and there is no wear or stickers on the panels. The deck needs material richness, not a rebuild. | A22, A23, A28 |

### Target look
**Cabin.** A modern narrowbody: a sculpted sidewall in warm white laminate with a subtle linen texture, and gloss bin doors with dark seams and chrome latches. The ceiling arch has a cove LED gradient. Seats are dark fabric with a visible weave, leather headrests in a two-tone pattern, and grey metal legs. The carpet has a pattern and is worn along the aisle.

**Light by phase:**
- **Boarding:** cool 5000K, bright.
- **Cruise by day:** shades mixed, slabs of sunlight crossing the seats as the aircraft turns.
- **Night cruise:** 10–15% ambient, blue cove at 6500K warming to 2700K amber for the descent, a dozen reading-light cones, IFE glow on faces, exit-path lights, a curtain light leak from the galley.

**Life:** 70–90% load, with phones, laptops, books, cups, blankets and pillows; bins open during boarding with coats and roller bags.

**Flight deck at night:** white backlit legends on every panel, warm flood light on the pedestal, an optional dome light, the faint reflection of the displays in the windscreen, and the city glow on the horizon.

### Prioritised fix list
| # | Fix | Technique | Impact | Effort | Owner |
|---|---|---|---|---|---|
| C-F1 | **Stop the clipping at the stand** | Find the intruder with `rayAt`. Clamp the jet-bridge cab and canopy and the catering platform to the door plane (stop the docking pose 5 cm outside the fuselage hull); hide exterior GSE from the cabin camera with a layer mask when the camera is inside the hull. | H | S | Env (turnaround, bridges) |
| C-F2 | **Cabin camera framing** | Move the default cabin eye to a row-3 aisle seat at seated eye height (floor + 1.15 m) looking aft at a slight angle. Keep a 1.2 m crew exclusion radius around any camera. Crew never face the camera for more than 0.6 s unless greeting (section 4 gaze rules). | H | S | Lead (main.js CAB_EYE) + Character |
| C-F3 | **Three-layer cabin lighting** | In the ac-cabin baked shader: (a) a cove uplight gradient along the ceiling arch; (b) a PSU-line downwash on bins and seat tops; (c) a window daylight term as directional slabs with a soft mask (sun direction in aircraft frame → which side and how deep), sweeping as the heading changes; (d) a per-seat reading-light cone term (seat id → on/off bit in a data texture). Windows emissive at 3–4 EV over the cabin. Bent-normal AO. | H | M | Aircraft interior |
| C-F4 | **Material separation** | Roughness and gloss per atlas tile: bins 0.35, laminate 0.7, seat fabric weave normal, leather headrests, metal legs at 0.4 metalness. A subtle linen texture on the sidewall, and a carpet pattern with an aisle wear mask. | M | S | Aircraft interior |
| C-F5 | **Night moods that read** | Rebalance `mood()`: Night = 12% ambient, blue cove, ~10% of seats with a reading light, IFE glow on faces (a people shader term from the seatback screen position), shades 70% closed. Dim = 35%. Transitions over 20 s. | H | S | Aircraft interior + Character |
| C-F6 | **Window assembly** | Thinner reveal (bevel 8 mm), a visible shade at a random position (drag to open or close: a nice tactile touch), an inner pane with a breather hole, a frost and scratch micro-texture, and the brightness step outside. | M | S | Aircraft interior |
| C-F7 | **Load factor and clutter** | 70–90% load (driven by career reputation later). Instanced props: cups, tray tables down for ~30% of seats in cruise, blankets, pillows, laptops, phones, bags under seats, coats in open bins during boarding. | M | M | Aircraft interior + Character |
| C-F8 | **Night flight deck** | Integral lighting: an emissive legend mask on the panel atlas driven by `sys.sw` integral and flood knobs. A warm pedestal flood light, a dome light, a storm-light switch; display reflections in the windscreen (a faint additive screen-space term). Point-sprite stars (see X-F4). | H | S–M | Lead (flightdeck.js/fdart.js) |
| C-F9 | **Deck richness** | A glareshield crackle-black shader (fine noise normal + soft sheen), panel wear at the edges, placards, a checklist card, a coffee cup in the holder. | L | S | Lead |

### Definition of done (cabin and deck)
- [ ] **C1. Cabin view at the gate (key 7):** no clipping, no face within 1.2 m, boarding passengers in the aisle, bins open.
- [ ] **C2. Day cruise, aisle view:** sun slabs on the seats, gloss on the bins, clutter, a 70–90% load.
- [ ] **C3. Night cruise:** clearly dark, with cove colour, reading-light pools and IFE glow on faces.
- [ ] **C4. Window seat by day and at dusk:** a thin reveal, a shade, the brightness step, a believable wing or ground view.
- [ ] **C5. Galley:** trolleys, crew working, no foreign objects.
- [ ] **C6. Flight deck by day:** sun patches moving with heading; the glareshield has material.
- [ ] **C7. Flight deck at night:** backlit legends and flood light, no white-out at the gate, point stars.
- [ ] **C8. Performance:** the cabin at `medium` stays at ≥60 fps with people LOD caps.

---

## 4. People: diagnosis and art direction (gates every people feature)

### What exactly makes them creepy
Evidence: A25, A26, A29, A31 (the flight attendant at point-blank range), A21 and A16 (seated passengers), A17 (rows), E/hall-shops and E/hall-gates (walkers at distance), plus the code in ppl-body.js, ppl-shade.js and ppl-core.js.

| Feature | What we see | Why it triggers the uncanny valley | Code location |
|---|---|---|---|
| **Sclera brightness** | The whites glow. Sclera albedo is `vec3(0.86, 0.83, 0.79)` in *linear*, while light skin (`#e6b896`) has a luminance of ~0.53 linear and dark skin (`#4e301f`) ~0.04. So the eye white is about 1.6x brighter than light skin and about 20x brighter than dark skin: dark-skinned faces get glowing eyes. Real sclera is about 0.6 linear *before* the lid occlusion of 30–50%. | High-contrast eye whites read as fear or stare (the "whites of the eyes" threat cue). | ppl-shade.js, eye shader ~L275 |
| **Scleral show and lid shape** | The almond opening shows white above and below the iris. Lids are a sphere 1.4 mm proud of the eyeball, with no thickness, no crease and no lashes. The socket is a 16.8 mm subtraction, so the eyes look like marbles pressed into clay. | Visible sclera above the iris = shock. No lid thickness or lashes = doll or prosthetic. | ppl-body.js `eyeOpening`, `headPrims` |
| **No eye occlusion** | `lidShadow` only multiplies by up to 0.45 at the very top; no AO shell, no tear-line meniscus, no caruncle. | Unshadowed eyeballs "float" in front of the face. That is the strongest single cue of a dead face. | ppl-shade.js |
| **Stare and gaze** | Gaze is ±6° random jitter relative to the head, on a fixed 1.4 s beat (`floor(t*0.7+s)`); no targets, no vergence. Lids don't follow the eye's pitch. Blink 0.16 s symmetric. The crew stand facing the camera. | Eyes that don't fixate on anything and lids that don't track are read as unseeing; a fixed beat reads as mechanical. | ppl-core.js ~L213–218 |
| **Skin shading** | Blinn-Phong spec (power 38) plus wrap 0.5 plus an additive orange terminator term; flat ambient; per-vertex AO only. Pore noise shows as freckle speckle at 1 m (A29). Dark skin collapses to near-black with no spec breakup or bounce: no form reads (A29 right side, A21). Light skin has blotchy orange cheek patches (A21). | A mannequin or wax read: no subsurface softness, no specular structure. The darker-skin failure is also a fairness problem we must fix. | ppl-shade.js FS_SKIN ~L159–165 |
| **Mouth and nose** | The lips are separate salmon "sausages" with a hard border; no mouth-corner pit, no philtrum shading. The nose is a cone tube with a hard tip and dark nostril holes (A25). | Prosthetic features; a dead neutral expression with zero muscle tone. | ppl-body.js `headPrims` |
| **Proportions** | The neck is too long and as wide as the face (A25, A26, A21). Heads are slightly small against broad shoulders. The scarf is made of orange tori (A25). | Realistic body proportions with low-fidelity detail is exactly the valley. Stylisation must be consistent. | ppl-body.js `sharedNeck` |
| **Hair** | A helmet bob sits 2–3 cm off the skull with fur-shell speckle at the edges (A26, A29). Short male hair is a brown cap with a fringe (A21). Blonde hair looks like a straw pad (A29). | Helmet hair is the classic mannequin wig; speckle reads as noise, not strands. | ppl-shade.js hair, ppl-core.js styles |
| **Motion and staging** | Seated people all share one pose and face forward (A17, A29). The crew stand idle in camera paths. No social attention. | Synchronised, purposeless behaviour = a crowd of dolls. | ppl-core.js, interiors.js placement |

### Recommended direction: polished stylised realism
We compared four options:
- **Photoreal:** needs scanned assets and a skin-rendering budget a procedural browser game doesn't have. It has the maximum uncanny risk and would never ship.
- **Toon or flat stylised:** clashes with the realistic aircraft and airports, and with Nico's "it has to be realistic".
- **Faceless arch-viz mannequins:** zero creepiness and perfect for crowds, but dead in the cabin close-ups Nico will see every flight.
- **Polished stylised realism (recommended):** realistic materials and lighting with simplified, slightly idealised forms, as in modern big-studio games. Shapes are clean planes, eyes are a touch larger and very well shaded, skin is soft and warm, and the animation is alive. It is forgiving at every distance, builds procedurally from the existing SDF pipeline, and sits naturally next to the realistic world.

**Hybrid LOD rule:** stylised realism up close. At distance, use painted faces with no eyeballs (arch-viz style), so eye whites can never "glow" across a terminal.

### Head and face spec (for the lineup)
Units are in metres in the existing `LM` frame. Change ppl-body.js landmarks; keep the SDF pipeline.

- **Body:** 7.0–7.25 heads tall (today 7.5). Head scale ×1.05 on adults: a friendlier, more readable silhouette.
- **Eye line:** at 50% of head height (today 0.506, keep it).
- **Interocular:** one eye-fissure width (keep IPD 64 mm).
- **Eyeball:** radius 0.0130 (today 0.012, +8%).
- **Fissure:** 30–31 mm wide × 11.5 mm open (today 26.8 × 11.3).
- **Canthal tilt:** +4° (outer corner higher) for a pleasant read.
- **Upper lid:** always covers 1.5–2.0 mm of the top of the iris. White never shows above the iris except in "surprise".
- **Lower lid:** touches the iris bottom; at most 0.5 mm of white below.
- **Iris:** visible diameter = 44% of fissure width (stylised up from 40%). Pupil = 38% of the iris; it shrinks 10% in bright light.
- **Lids:** real geometry 2.5 mm thick: an upper lid with a crease 6–8 mm above the lash line and a lower lid with a wet line. Lashes are one upper alpha card (dark, curled, 6–8 mm, thicker at the outer third) and a fine lower card. LOD0 only.
- **Brow:** a soft brow ridge; brows are hair cards over a painted base, never only painted strokes at LOD0.
- **Nose:** narrower bridge, blended (raise the blend `k` on bridge, tip and ala by 50%); no cone silhouette; nostrils shaded by AO, not dark holes.
- **Mouth:** lips sculpted *into* the face with a soft vermilion border (2 mm blend), corner pits (modiolus) tucked 1.5–2 mm in with AO, a shaded philtrum, mouth line shaded not cut.
- **Default expression:** "pleasant neutral": mouth corners +1 mm, cheeks +0.5 mm, lower lids +0.5 mm (a 15% smile). Crew wear a 30% "professional smile" when within 3 m and facing the player.
- **Neck:** width 0.70x the head width for men and 0.62x for women; chin-to-sternal-notch ≈ 0.45 head heights; a clear trapezius slope.
- **Jaw and cheek morphs:** keep fem, wide and nose. Add an age morph (sagging jowls, thinner lips, deeper nasolabial fold) and 3 face shapes (oval, square, heart) so neighbours differ.

### Eye construction (LOD0, in order)
1. **Sclera ball.** Albedo 0.60 linear (≈ sRGB 0.80), warm-tinted, never above 1.25x the lightest skin albedo of the same person. A pink caruncle at the inner corner, a faint vein texture, corners darkened by 40%.
2. **Iris disc,** concave with a 0.5 mm parallax offset along the view direction (fake refraction). A dark limbal ring (0.25x the iris colour, 1 mm wide), radial fibre noise, and a lighter collarette around the pupil.
3. **Cornea.** A glossy shell; reflects the PMREM environment at 4%. **One soft specular glint positioned by the real key light**, not fixed in eye space, plus a faint window or sky reflection.
4. **Tear-line meniscus.** A thin wet strip along the lower lid that catches the light.
5. **Eye occlusion shell** (the most important anti-creepy element). A thin transparent mesh over the eye: darkens the top 40% by 50% (upper-lid shadow), the inner and outer corners by 35%, and the bottom 15% by 20%. It is multiplied over the sclera, the iris and the cornea spec.
6. **Lids and lashes** as above.

**Distance rule:** sclera contrast fades toward the skin tone beyond 6 m. LOD2 and up have no eyeballs, only a painted soft eye shadow with a dark iris dot.

### Skin shading model
- **Diffuse:** pre-integrated, curvature-based skin scattering. Store a curvature value per vertex at build time from the SDF, and look up a small baked 2D LUT texture (N·L × curvature). This replaces wrap 0.5 + additive orange: it gives a red-tinted soft terminator at the nose, ears and lips and a sharper one on the forehead. Ears and nose get a back-scatter term from the key light (thin parts glow red against the light).
- **Specular:** GGX with two lobes (roughness 0.38 and 0.65, mix 0.85/0.15) and F0 = 0.028. Specular is masked: higher on forehead, nose bridge, cheekbones and lips; lower on cheeks.
  - A micro-normal from noise at 0.25 strength, fading out beyond 1.5 m (no visible pore speckle at distance).
  - Darker skin keeps the same spec and gets a stronger fill or rim from the environment, so the planes of the face always read.
- **Albedo:** calibrated linear palettes across six tone bands (very light to very dark), at least 3 undertones each. The darkest albedo is ≥0.05 linear (never "black").
  - Zone tints: forehead slightly yellow, cheeks, nose and ears slightly red, jaw slightly blue-grey for men with beard shadow.
  - Blush and makeup are soft (blur ≥ 8 px in the atlas); no blotches.
- **AO and cavity:** baked SDF AO in the eye sockets, nostrils, ears, mouth corners, under the jaw and in the neck creases, at strength 0.6 (today the AO is too weak to separate the features).
- **Exposure:** people share the scene exposure. Cabin night mood adds the IFE glow term.

### Hair
- **LOD0:** 25–60 alpha hair cards per style (strips following the scalp curve, tapered alpha, root-to-tip darkening), alpha-to-coverage with MSAA or alpha test plus a dithered edge. Kajiya-Kay with two highlights (keep the existing shader idea). Volume 1–1.5 cm off the skull, never 3 cm. The hairline is a soft alpha gradient onto a painted scalp base.
- **LOD1:** 8–15 cards.
- **LOD2:** a sculpted shell with a painted strand texture, with no fur-shell speckle anywhere.
- **Styles:** at least 12, across textures (straight, wavy, curly, coily, braids, locs, buzz, bald with sheen) and lengths, with grey shades for elders.

### Animation rules (attention model + micro-motion)
**Gaze targets,** by priority:
1. the conversation partner;
2. a nearby moving thing (a person passing within 3 m, a trolley, the aircraft outside);
3. a task (phone, book, FIDS, menu, IFE screen);
4. a point of interest (window, sign);
5. a soft unfocused "middle distance" (at most 20% of the time).

**Gaze and the camera:**
- The player or camera is a target only when within 4 m *and* in front, for at most 0.6–1.2 s, followed by a polite look-away.
- Crew greet with eye contact, a 20% smile and a 5° nod.
- Nobody stares at the camera in cabin views.

**Eye-head coordination:** the eyes move first, and the head follows 40–80 ms later with a critically damped spring (ω = 6–8 rad/s) whenever the target is more than 15° off. The eyes counter-rotate to hold the target while the head moves.
- Clamps: eye yaw ±30°, eye pitch +20/−25°; head yaw ±70°, head pitch ±30°.

**Saccades:** intervals drawn from a log-normal distribution (mean 1.2 s, range 0.3–3 s), *not* a fixed beat. Amplitudes are mostly 2–8° and sometimes 15°, lasting 30–60 ms. Micro-saccades of 0.3–0.5° every 0.4–0.8 s during fixation. Vergence: both eyes converge on the target distance.

**Lids:**
- The upper lid follows the eye's pitch (lid drop = 0.7 × eye-down pitch) and lifts slightly on upward looks. This is critical for life.
- Blinks: 12–20 per minute (interval 1.5–7 s, random); closing in 70–90 ms, opening in 120–160 ms. A blink always accompanies a saccade over 20° and a head turn over 30°. Occasional double blinks (10%).
- Sleepy passengers: half-closed lids (0.5) with slow blinks of 300 ms.

**Breathing and idle:**
- Breathing at 12–18 per minute: chest 3–5 mm, shoulders 1–2 mm, out of phase per person.
- Standing: a weight shift every 4–12 s.
- Fidgets at random: touch face or hair, check phone, adjust bag strap, look at watch, cross and uncross legs (seated), stretch.
- Neighbours never share the same act or phase (hash on seat or queue index).

**Walk:** 1.15–1.45 m/s, a 0.65–0.8 m stride, foot locking (no skating), arm swing opposite the legs at 25–35°, head bob 2–3 cm, a slight lean when pulling a case.
- Groups walk abreast and talk (heads turn to each other).
- Turning arcs; slowing at doors and queues; the occasional fast "late runner".

**Expressions** are blendshapes on LOD0 and LOD1: smile, blink L/R, jaw open (talk cycle at 4–6 Hz for crew on the PA or the interphone), brow raise, and sleepy. No idle face is ever fully neutral.

### LOD rules
| Level | Distance (high) | Max count | Content |
|---|---|---|---|
| **LOD0** | ≤ 3 m | 8 | Full eye construct (6 layers), lashes, hair cards (25–60), face blendshapes, finger detail, gaze IK, pre-integrated skin with micro-normal |
| **LOD1** | 3–10 m | 40 | A single eye sphere with a painted iris, cornea spec and the occlusion term baked into the texture; 8–15 hair cards; blink + smile; head look-at only |
| **LOD2** | 10–30 m | 250 | No eyeballs: painted face with soft eye shadow; shell hair; mitten hands; instanced, 1 draw per layer; walk cycle evaluated at 15 Hz |
| **LOD3** | > 30 m | 1000 | 8-direction impostors rendered from LOD1 into an atlas at load time (with a walk-frame strip), or coloured capsule silhouettes |

- Switch with a 200 ms dithered cross-fade, never a pop, with 15% distance hysteresis.
- `medium` halves the LOD0 and LOD1 counts.
- Sclera contrast is tied to LOD (see the distance rule).

### The face lineup Nico approves (deliverable of the character artist)
**One contact sheet at 1920x1080**, with two lighting setups: (a) terminal daylight at 4000K with a warm key from the left; (b) night cabin, cool cove light with a warm reading light from above.
- **12 passenger heads:** 6 women and 6 men, ages 20s, 40s and 70s, spanning six skin tone bands and at least 4 hair textures. Each is shown front, at 35° three-quarter and in profile, at portrait distance (0.8 m, 30° FOV).
- **4 crew:** 2 pilots (white shirt, epaulettes, headset) and 2 flight attendants (fitted jacket, a scarf with a real knot, hair in a chignon or bob *on the skull*), each with a 20% professional smile.
- **A 6-second idle clip** (or a 12-frame strip) per crew member: saccades, blinks with lid follow, a look-away and a glance at the camera with a nod.
- **A full-body lineup of 6 people** at 2.5 m (standing, seated, walking mid-stride).

**Approval checklist:**
- [ ] no white visible above any iris in neutral;
- [ ] sclera no brighter than 1.25x the skin in every tone;
- [ ] every face reads at a 2 m distance in both lightings, darkest tones included;
- [ ] no helmet hair or speckle;
- [ ] necks and shoulders in proportion;
- [ ] Nico says "they look friendly".

---

## 5. Gameplay: why flying is boring, and what to build

### The minute-to-minute loop today (game designer)
From main.js and atc.js, a typical session (Free flight from a gate) goes like this:
- **Start:** pick an airport. Engines off, APU on.
- **Gate:** press "Start engines", then the ATC clearance and readback, ground services and the PA. *Systems are rich and authentic here.*
- **Pushback and taxi:** pushback (K), then taxi by following magenta (or Shift+Enter). The taxi is 3–6 minutes of low agency.
- **Takeoff:** the best 90 seconds of the flight.
- **Climb and cruise:** the autopilot flies. Center hands you off, you ask for descent, and in between **nothing happens** for 5–40 minutes. Time acceleration exists, but there is nothing to look forward to; the terrain is a flat grid, so sightseeing doesn't reward you either (A02, A27).
- **Approach and landing:** ILS, then landing, then a score toast (`scoreLanding()`: rate 40, centreline 25, zone 20, speed 15 → A+..F). That's it.
- **Taxi in and park:** walk off the plane.

**Diagnosis:**
- **No goal.** The logbook and challenge bests exist, but nothing is earned or unlocked and nothing is at risk. Comfort (`CC.v`) exists but has no consequence, and is switched off in challenges.
- **Dead air.** The fun peaks (takeoff, approach, landing) are about 5 of 25–45 minutes. Cruise has no decisions.
- **Weather is cosmetic.** There are 5 presets; "rain" is grey fog (A03); gusts are a gentle OU noise.
- **The cabin is decoration.** The PA is there, but the passengers never need you.
- **The payoff is weak.** One toast; no replay, no applause, no "butter" moment, no story of the flight.

**Target pacing for a 20–25 minute flight:** a decision or event at least every 2 minutes, one story per flight, and one unlock or progress beat per session.
- **Gate:** 3 min (services, boarding, PA).
- **Taxi:** 2 min (with a "skip to the holding point" option).
- **Takeoff and climb:** 4 min.
- **Cruise:** 2–4 min real time, compressible with "skip to the next event / top of descent", holding 1–2 events.
- **Descent and approach:** 5 min (the climax: weather, ATC, the cabin).
- **Landing:** 1 min, then a 20 s replay.
- **Debrief:** 1 min.

### Nico's pick 1: Career / airline mode
**Player fantasy:** "I founded Nicofoxheart Air (the PA already names it). I start with one leased narrowbody flying short hops from my home airport. By landing smoothly, keeping passengers happy and handling emergencies well, I grow into a famous airline with my own livery, hubs and a reputation pilots envy."

**The full loop.**

Per flight (15–25 min):
1. **Dispatch board.** Pick one of 4–6 jobs: route, departure time, passengers and cargo, pay, weather outlook, risk chips (crosswind, storms, VIP, low vis, night) and bonus objectives (e.g. "landing under 200 fpm", "on time", "comfort 85+").
2. **Briefing card.** Weather in plain words plus METAR/TAF for the realism fans, an expected runway, a fuel figure, and the events that *might* happen (Wild weather, Drama on board).
3. **Fly gate to gate.** Use the existing start-at-gate flow. "Skip taxi" and "skip cruise" fast-forward with a 4 s cinematic fade.
4. **Debrief.** A **Flight report** with:
   - stars per category: landing (the existing score), on-time, comfort (`CC.v` average and minimum), safety (stall, overspeed, hard landing, unstable approach from the ATC flags), procedures (readbacks, belt sign, checklists), and the story (how events were handled);
   - money in and out;
   - reputation and XP changes;
   - 3 passenger reviews generated from what happened ("Smoothest landing I've had", "The captain kept us informed during the bumps", "Spilled my coffee on descent");
   - the landing replay button.

Per session and per week:
- **Reputation tiers** (1–5 stars) unlock airports (regional hub → big hub → international), longer routes, harder weather and night jobs, cabin upgrades and livery parts.
- **Daily missions:** 3 per day, seeded from the date so they are the same all day, e.g. "Land at a coastal airport with a crosswind over 12 kt", "Fly a night arrival with comfort over 85", "Get an A on a fog approach". A streak bonus applies.
- **The hangar:** a livery editor with presets plus colour pickers plus an invented-logo generator (fox-head variants, seeded; Nico OK'd invented logos, never real airline marks), and the aircraft name on the nose.

**Economy (keep it simple):**
- One currency (credits) plus reputation plus XP.
- Income = passengers × fare(distance) × load factor (driven by reputation) + cargo + bonuses.
- Costs: fuel used (`fdm.fuel` delta × price), landing fee (by airport size), maintenance (hard landings over 600 fpm, overspeeds and tail strikes add wear), and a fixed crew cost.
- A justified divert (medical, weather) costs money but *raises* reputation; an unjustified one costs both.

**UI:**
- A new **Career** item in the menu rail (`#nav`), first in the list.
  - The **HQ page:** airline name and tail preview (rendered with the existing aircraft model), credits, reputation stars, level bar, next unlock, today's 3 missions as cards, and the **Job board** (cards styled like `#chList`, with a route mini-map from `drawDiagram`).
  - A **Hangar** tab (livery) and a **Logbook** tab (the existing logbook, extended with flight reports).
- In flight: a small objectives chip (top-left glass panel) and event toasts.
- After parking: a **Flight report** overlay with a stars animation, money ticker, reviews and "Replay landing".

**Data (localStorage via the existing `store`):**
```js
store.set('career', { v: 1,
  airline: { name: 'Nicofoxheart Air', colors: ['#0b1f4d', '#f08a24', '#ffffff'], logoSeed: 41 },
  credits: 25000, rep: 1.0, xp: 0, level: 1, hub: 'KTPA',
  unlocked: { airports: ['KTPA', 'KMIA'], liveryParts: ['base'], cabin: ['std'] },
  fleet: [{ id: 'N412FX', type: 'fx320', hours: 0, wear: 0 }],
  daily: { date: '2026-11-04', missions: [{ id, kind, params, done: false }], streak: 0 },
  flights: [{ date, from, to, jobId, score, grade, onTimeMin, comfortAvg, events: [], pay, repDelta, reviews: [] }] });
```
**Jobs** are generated from `World.byIcao`, `nearestAirports()` and the airport size, with a seed of day + hub + slot. Version 1 keeps jobs between airports that the current world can build (≤ 300–400 nm). Longer jobs come with the lead's "fly anywhere" work, or use a "start at the top of descent" option (the existing `start: 'route'`-style air start).

**Hooks into existing systems:**
- `startFlight(cfg)` already takes `{apt, dest, tod, wx, windFrom, windKt, gusts, fail, mode}`. Add `mode: 'career'` and `cfg.job`.
- `scoreLanding()` → the landing stars; `showScore()` → route to the Flight report when `W.mode === 'career'`.
- `updateComfort()` → enable it in career and record min/avg; `CC.why` → the review generator.
- `atc` flags and warnings (missed readbacks, deviations, unstable approach) → the procedures stars.
- `paLog` → "kept passengers informed" (a PA within 3 min of every event or belt-sign change).
- `W.simTime` against the job's scheduled block time → on-time.
- `fails` and the events (pick 3) → the story stars.
- `store.get('log')` → reuse it.

**Phased build plan:**
- **P1 (M, lead): career shell.** Profile, credits, reputation and XP, a job board with 6 jobs among built airports, the Flight report with landing, comfort, on-time and procedures, 2 reputation tiers that unlock airports, and saving. Only existing systems are used.
- **P2 (S–M, lead + aircraft artist): retention.** Daily missions with a streak, passenger reviews, the hangar livery editor (ac-livery.js parameters plus the logo generator), and landing replay in the report.
- **P3 (M, lead):** jobs carry Wild weather and Drama on board modifiers, the maintenance and wear loop, hub switching, achievements.
- **P4 (M, after the people approval):** reputation drives the load factor, which drives how many passengers board; passengers clap after butter landings; a crew greeting at boarding.

### Nico's pick 2: Wild weather
**Player fantasy:** "Weather that makes my palms sweat: a line of thunderstorms on the approach lights up the cockpit; the aircraft shudders; I ask ATC to deviate around a red cell on my radar. Then 'WINDSHEAR' at 600 ft, TOGA, and I make it on the second attempt. Or a fog so thick that the approach lights appear only at 200 ft and the autoland puts us down."

**Systems.**
1. **A parametric weather state** replaces the 5 presets. `sky.setWeather(kind)` stays as a wrapper that loads a *recipe*.
   ```js
   W.wxState = { cloud: { cover, base, tops, type: 'St'|'Cu'|'Cb' }, precip: { kind: 'rain'|'snow', rate }, visM, rvrM,
     wind: { dir, kt, gustKt, shear: [{ altFt, dir, kt }] }, turb: [{ fromFt, toFt, level: 0..3 }], cells: [{ x, z, r, topFt, level: 1..4, drift }],
     tempC, icing: bool, lvp: bool }
   ```
   Recipes: "Miami squall line", "London blustery", "Incheon crosswind", "CAT III fog", "Summer afternoon Cb", "Clear and smooth".
   In career mode, jobs pick a recipe by climate and season (`climateFor()` already exists).
2. **Turbulence** (fdm.js): a Dryden-like gust field scaled by `turb[level]` in the altitude band, plus clear-air turbulence patches in cruise, plus convective turbulence within 1.5 × r of a cell.
   - Light, moderate and severe produce a Δn of ±0.1, ±0.3 and ±0.6 g, with rumble on the pad.
   - Gameplay: belt sign and PA "turbulence" (the line exists) *before* entering a reported area avoids the comfort penalty; severe turbulence with the belt sign off triggers an "injured passenger" event.
3. **Convective cells, rain shafts and lightning** (sky.js, world artist).
   - Cb towers as clusters of lit billboard puffs with normal-mapped sprites, or a bounded low-resolution raymarch box upsampled on `ultra`.
   - Anvils; rain shafts as scrolling vertical alpha cards under each cell.
   - Lightning: a branching emissive line strip for 120 ms, a sky and ambient flash spike, a cloud-internal flash (the puff emissive pulses), and thunder delayed by distance (audio.js noise burst with a low-pass filter).
   - A cockpit flash, and a storm-light switch on the overhead.
4. **Weather radar** on the existing ND (N overlay): cells drawn as green, yellow, red and magenta returns ahead within ±60°, with gain and tilt. ATC options gain "Request deviation 20° left/right due weather" and "Request a ride report". Flying through red costs comfort and wear, and may cause a lightning strike or hail.
5. **Windshear and microburst** on the approach in convective recipes. Over 1.5–2 nm: a headwind gain of +15–25 kt, then a downdraft of 1,000–2,000 fpm, then a tailwind.
   - Aural "WINDSHEAR, WINDSHEAR, WINDSHEAR", a red WINDSHEAR on the PFD and ECAM, and the FO call "Windshear, TOGA!".
   - The escape is scored: TOGA within 2 s, pitch 15–17.5°, no configuration change.
   - ATC says "windshear alert, runway 27L, 20 knot loss 2-mile final" in the landing clearance.
6. **Gusty crosswind:** discrete gust events of 5–15 kt in the last 100 ft on top of the OU model; the windsock animates with the real wind; and the scoring adds a decrab and centreline sub-score.
7. **Fog and CAT III:**
   - Vis 150–400 m with RVR values in ATIS ("RVR 250 metres, low visibility procedures in force").
   - Autoland with callouts: "100 above", "minimum", "LAND", "FLARE", "ROLL OUT" (the FDM already has FLARE and ROLL OUT vertical modes).
   - The approach and runway lights *punch through* the fog: lights get their own extinction curve (0.3x the fog density), so they appear at 200–300 ft. That is the money moment.
   - No visual reference at minimums → go-around → hold or divert.
8. **Later:** windscreen rain with sliding drops and wiper sweeps (screen-space on the deck glass plus wiper geometry), wet-runway reflections, icing (anti-ice on the overhead, ice on the windscreen edges, a performance penalty) and hail (cosmetic cracks, ECAM).

**UI:**
- Menu weather becomes "Realistic for the place and season", "Recipes" (cards with a thumbnail) or "Custom" (sliders for cloud, rain, vis, wind, gusts, turbulence, storms).
- Career jobs show the forecast and risk chips.
- In flight: radar on the ND, ATC deviation options, PFD/ECAM windshear alerts, and the turbulence comfort chip.

**Hooks:**
- `setWeather()` in main.js → load the recipe into `W.wxState`.
- `sky.setWeather` → visuals from the state.
- `fdm` → turbulence and shear vectors via a new `wxAt(pos)` function in a `wld-weather.js` module.
- `atc.js` → ATIS RVR, LVP and windshear text; deviation options; ride reports in chatter.
- `failures.js` → `lightning` (a brief electrical glitch, the ECAM "ELEC" flash) and `hail`.
- `pa.js` → new lines "storm ahead", "fog delay" and "go-around explanation".
- People (after approval) → passengers grip the armrests and the crew stop the trolley in turbulence.

**Phased build plan:**
- **W1 (S–M; lead + world):** the parametric state and recipes, turbulence bands and the belt-sign gameplay, windshear on the approach with alerts and scoring, gust events in the flare. No big visuals needed.
- **W2 (M, world):** Cb cells, rain shafts, lightning and thunder, the ND radar and the ATC deviations.
- **W3 (M, world + env + lead):** the CAT III showcase: lights through fog, autoland callouts, LVP ATIS, go-around and divert.
- **W4 (L):** windscreen rain and wipers, wet-runway reflections, icing and hail.

### Nico's pick 3: Drama on board
**Player fantasy:** "I'm responsible for 150 people. Over the water a passenger collapses. The flight attendant calls: there's a doctor, but he needs a hospital. Do I continue 40 minutes, or divert to an airport I've never seen, in a storm? I declare PAN-PAN, brief the cabin, land smoothly, and the ambulance is waiting at the gate."

**The event framework.** A new `js/events.js` (lead), `EventDirector`, with data-driven event cards:
```js
{ id: 'medical', weight: 3, when: s => !s.onGround && s.altFt > 8000 && s.minsToDest > 15,
  stages: [ { t: 0,   do: 'chime+interphone', text: 'Captain, a passenger in 23C has chest pain. A doctor is helping.' },
            { t: 60,  do: 'decision', choices: [ { id: 'divert', label: 'Divert to the nearest suitable (${div.icao}, ${div.min} min)' },
                                                 { id: 'continue', label: 'Continue to ${dest} (${destMin} min)' },
                                                 { id: 'ask', label: 'Ask the doctor for an update' } ], timeout: 90 },
            { t: 'onChoice', do: 'atc:pan medical', pa: 'medical_divert' } ],
  outcome: s => ({ rep: s.choice === 'divert' && s.divertMin < 30 ? +0.3 : -0.2, story: '…' }) }
```
- **Triggers:**
  - a career job modifier (e.g. "VIP");
  - random by a "Drama: off, rare, normal, frequent" setting (default rare in Free flight, normal in Career);
  - or picked in a Scenarios list (like Challenges).
- **Interphone UI:** a panel styled like the ATC radio with 2–4 choices, keyboard 1–4 and pad A/X, a timer (paused in Easy), and the FO's advice line ("Nearest suitable is Fort Myers, 18 minutes; Miami 41").

**Events, by priority:**
1. **Medical emergency, with a divert decision.**
   - The FA interphone call, then the PA "Is there a doctor on board?" (new line).
   - The patient's status ticks (stable or worsening) and creates urgency.
   - Divert target from `atcCtx.divert()` (already picks the nearest suitable built airport); `atcCtx.setArr(A)` re-targets ATC.
   - ATC: PAN-PAN with nature "medical", "request medical services on arrival".
   - On arrival: an ambulance and paramedics drive to the stand (a new GSE in env-gse.js with the env-turnaround path system).
   - Scoring: decision time, correct urgency (PAN, not MAYDAY), a PA to the passengers, landing quality.
2. **Bird strike.** The `bird` failure already exists. Add the narrative: the cabin startle, a PA "the bang you heard", ATC asking for souls and fuel, and a "return to departure" option.
3. **VIP flight.** A career modifier: "a famous musician is on board" (fictional, generic). Comfort must stay ≥ 90, the landing under 150 fpm and the flight on time, with a personalised PA welcome. Big pay and reputation; a social-media-style review in the report.
4. **Unruly passenger.** The FA reports, then a captain's PA warning (new line). If it escalates: the crew restrain them, then continue with police at arrival or divert. ATC: "request police at the gate"; a police car at the stand. Non-violent and light in tone.
5. **Shorter events:** a smoking lavatory (smoke detector → divert decision), a sick child (a minor medical event), turbulence injury (from Wild weather), and positive events: a birthday PA, a proposal on board (a PA congratulation and applause), a nervous flyer ("talk to the cabin" PA).

**Hooks:**
- `failures.js` → reuse the FO voice queue (`foQ`) pattern for FA interphone lines through speech.js with a third voice.
- `atcCtx.emergency()` → also return event emergencies (`{kind:'pan', nature:'medical emergency'}`), so the existing PAN-PAN option reads correctly. `atcCtx.divert()` and `setArr()` already exist.
- `pa.js` → new lines `doctor`, `medical_divert`, `bird_explain`, `unruly_warn`, `vip_welcome`, `birthday`.
- People (after approval) → `CabinDirector` (ppl-service.js) gets `incident(row, kind)`: the crew walk to the row, the patient slumps, the doctor kneels; the unruly passenger stands in the aisle with a gesture loop.
- env-turnaround.js → the ambulance and police vehicles at arrival.
- Career → event outcomes feed the story stars, reputation and reviews.

**Phased build plan:**
- **D1 (S–M, lead):** `EventDirector`, the interphone UI, the medical divert end to end (audio, UI, ATC, PA, divert; the cabin shows only a crew member walking to the row), and the debrief story text.
- **D2 (M, lead + env):** the bird strike narrative, VIP and unruly events, and the ambulance and police at the stand.
- **D3 (M, character, *after the face approval*):** cabin choreography for each event and passenger reactions.

**Rule:** every event must work with *audio, UI and ATC only*, so drama ships before the people do.

### The rest of the list (short), ranked by fun ÷ effort
| Rank | Feature | Player fantasy | Minimal loop | Effort |
|---|---|---|---|---|
| 1 | **Landing replay + "butter" moment** | "Did you see that landing?!" | After touchdown, an automatic 20 s replay from 3 cinematic cameras with the fpm and g readout; applause in the cabin if under 150 fpm; a "Butter!" stamp; save to the logbook | S |
| 2 | Career P1 (above) | Build my airline | Job → fly → report → unlock | M |
| 3 | Wild weather W1 (above) | Sweaty palms | Turbulence, belt sign, windshear escape | S–M |
| 4 | Drama D1: medical divert (above) | Hero captain | Interphone → decide → divert → ambulance | S–M |
| 5 | Daily missions (part of career) | A reason to come back | 3 seeded missions per day plus a streak | S |
| 6 | Photo mode | A wallpaper of my flight | Free camera, time-of-day scrub, DOF and exposure, hide the HUD, filters, save a PNG (`canvas.toBlob`) | S |
| 7 | CAT III fog showcase (W3) | Lights at 200 ft | An autoland scenario plus scoring | M |
| 8 | Thunderstorms + radar (W2) | Weave between the cells | Radar → deviate → land in rain | M |
| 9 | Achievements | Collect them all | ~40 badges from the existing telemetry (first butter, crosswind ace, V1 cut survived, night owl…) | S |
| 10 | Tricky approaches pack | "That approach is famous for a reason" | Procedural *fictional* airports (labelled fictional; never fake real map data): a curved valley visual, a short island strip, a steep 5.5° approach, circle-to-land; scored | M–L |
| 11 | Parallel approaches with AI traffic | Formation-feel arrivals | traffic.js arrivals on the parallel runway, side by side on final | M |
| 12 | Local leaderboard + ghost | Beat my best | A best-landing ghost aircraft (recorded track) shown on the next attempt at the same runway | S–M |

---

## 6. Top 10 build order (all areas)

Interleaved so that every week improves all three of Nico's complaints. Each step ends with its definition-of-done shots and a review against this document before anything goes live.

| # | Step | Owner | Fixes | Effort |
|---|---|---|---|---|
| 1 | **Bug sweep from this audit:** cabin clipping at the stand (C-F1), cabin camera vs crew (C-F2), night white-out at the gate (X-7, A24), square stars and stars over lit cities (X-F4), tower on the roof (X-8), sign text overflow (T-7), `<meta charset>` (T-9) | Env + Lead + World | C-1, C-2, X-7, X-8, T-7 | S |
| 2 | **Sun shadows at `high`** plus contact shadows (X-F1) | Env + Lead | X-1, and lifts every exterior shot | M |
| 3 | **Landing replay + butter moment + skip taxi/cruise** | Lead / gameplay | The flight payoff and dead air | S–M |
| 4 | **Face lineup v2** (section 4 spec) for Nico's approval; *gates all people features* | Character | Creepy people | M |
| 5 | **Career P1 + daily missions** | Lead / gameplay | Boring flying (goals) | M |
| 6 | **Terminal v2: room sequence + daylight gobo + ceilings + density** (T-F1, T-F2, T-F3, T-F5 with LOD2 people) | Env | Boring airport (interior) | L |
| 7 | **Wild weather W1 → W2** (turbulence, windshear, gusts, then cells, lightning and radar) | World + Lead | Boring flying (drama) | M–L |
| 8 | **Exterior: approach readability + facade v2 + typologies + context ring** (X-F2, X-F3, X-F5, X-F6) | Env + World | Boring airport (exterior) | L |
| 9 | **Cabin lighting, materials and night mood + flight deck night lighting** (C-F3 to C-F6, C-F8) | Aircraft interior + Lead | Fake cabin and deck | M |
| 10 | **Drama on board D1 → D2**; D3 cabin choreography only after step 4 is approved | Lead + Env, then Character | Boring flying (story) | M |

Roles: **environment** = airport exterior and terminal (env-*.js, airport.js, groundcrew.js); **aircraft interior** = cabin (ac-cabin.js); **character** = people (ppl-*.js); **lead / gameplay** = main.js, atc.js, failures.js, pa.js, flightdeck.js, new events.js; **world** = sky.js, terrain.js, wld-*.js.
