# Project Corsair — PRD

2026-09-27 · Dirk Kok

> Moved into the Project docs on 2026-09-28 from the original Claude Docs page. This file is now the working copy. Art and sprite production is specified in `docs/project-corsair-art-pipeline.md`.

## 1. Overview

Project Corsair is a browser-based, single-player pirate career sim set in the 17th-century Caribbean, in the spirit of Sid Meier's Pirates! (1987 / 2004). The player captains a ship, sails a living map, trades, raids, duels, romances and hunts treasure until age forces retirement. Everything the world does is driven by JSON data and deterministic simulation, and every system can be observed, replayed and tested headlessly.

### Design pillars

- **Freedom of career.** No main quest. The player chooses privateer, pirate hunter, merchant or treasure hunter, and can switch at any time.
- **Short, sharp minigames.** Each activity (sailing battle, duel, land assault, dance, trade) resolves in 1 to 5 minutes. The world map is the hub.
- **A living world.** Nations go to war, towns grow and shrink, fleets sail real routes. Things happen whether or not the player is there.
- **Time is the real currency.** Every action ages the captain. A career lasts roughly 20 to 30 in-game years and 6 to 12 real hours.
- **Everything is data.** Designers change balance, content and rules by editing JSON. Code holds rules engines, not numbers.
- **Everything is observable.** Any bug or balance issue can be reproduced from a seed plus an input log, and inspected through structured events.

### Target player

- Players who loved the original and want it in a browser with modern quality of life.
- Players who like short sessions inside a long campaign (15 to 45 minutes a sitting, autosave).
- Primary platform: desktop browser (Chrome, Edge, Firefox, Safari). Secondary: tablet with touch. Phone is a stretch goal.

### Scope for v1.0

- One map: the Caribbean, roughly 1560 to 1680, with era start dates that change nation strength.
- Four nations (Spain, England, France, Netherlands) plus pirates, Jesuit missions and native settlements.
- About 45 settlements, 12 ship classes, 6 minigames (sailing combat, fencing, land battle, dancing, trading, stealth town entry).
- Full career loop: family quest, treasure maps, romance, promotions, retirement score.

### Non-goals for v1.0

- Multiplayer or shared worlds.
- ~~3D graphics.~~ Changed 2026-10-08: the sea map and sea battles move to 3D, styled after Sid Meier's Pirates! (2004) in HD (`docs/reference/pirates-3d-style.md`). Changed again 2026-10-09: the sea, sky and light aim for the realism of Assassin's Creed IV: Black Flag, the sea's state following the weather. The minimum target is a GeForce RTX 3070. Harbour scenes, the sea chart, the minimap and the menus stay 2D. Changed again 2026-10-10: the 2D sea and battle renderer is gone; the game is drawn in 3D only (sea life, ship name labels and the smoke of distant fights went with it and came back in 3D the same day).
- Monetisation, accounts or cloud saves. Saves live in browser storage with file export.
- Historical accuracy beyond flavour. Fun wins over realism.

### IP stance

Game mechanics are fair to recreate. Names, art, music, text and the trademarked title are not. All sprites, audio, writing and character names must be original. The working title stays "Project Corsair" until naming and trademark checks are done.

## 2. Core loop and career arc

The player sails the world map, meets something, resolves it in a minigame, and returns to port to cash in. Dividing the plunder ends a voyage: the crew is paid off, fame is scored, and the captain gets older.

**Core loop (diagram):** Sail the world map (time, food, morale tick) → Encounter (ship, town, storm, rumour) → Resolve a minigame (battle, duel, trade, dig) → Return to port (sell, repair, recruit) → Divide the plunder (crew paid, fame scored) → Advance the career (rank, romance, age) → back to sailing. Each loop ages the captain; retire when health, fame or luck runs out.

A typical loop takes 5 to 15 real minutes. The world map is the only place where time passes continuously.

### Career start

- **Era.** Player picks a start year: 1560, 1600, 1620, 1640, 1660 or 1680. Each era is a JSON file that sets nation strength, town ownership and which towns exist.
- **Nationality.** Sets the starting home port and initial reputation. It does not lock allegiance.
- **Special skill (pick one).** Fencing, gunnery, navigation, medicine, wit and charm. Each is a modifier set in `skills.json`.
- **Difficulty (5 levels).** Scales enemy skill, crew greed, price spreads and plunder share. Higher difficulty scores more fame points.
- **Family backstory.** Lost relatives and the villain who took them. Finding clues drives the long-term quest (section 10).

### Time and ageing

- One world-map day is 771 ticks, which is about 26 real seconds at 1x and 13 at the default 2x cruise (`calendar.json`). A day lasts about as long as a brig's real day's run on the real-scale map, so voyage lengths and seasons stay believable.
- Voyage pace: a brig makes about 4.5 tiles a second on a fresh broad reach, so Havana to Cartagena takes about 2 real minutes.
- Minigames pause world time and then charge a fixed cost (a battle = 1 day, a land march = 2 to 6 days, a dance = 0 days).
- The captain starts at about 20. From age 35, each year adds a chance that a stat drops (fencing reflexes, eyesight in gunnery).
- Wounds from lost duels and battles lower health. Health, age and fame decide when the governor stops offering new work.

### Retirement and score

The player can retire at any port. The game scores the career and picks a retirement fate, from beggar to governor.

| Score category | How it is earned |
|---|---|
| Wealth | Personal gold at retirement (crew shares already paid) |
| Land | Acres granted by governors with titles |
| Rank | Highest title reached in each nation |
| Family | Relatives rescued |
| Romance | Marriage and the spouse's standing |
| Villains | Villain defeated, rivals retired |
| Treasure | Lost treasures and cities recovered |
| Difficulty | Multiplier on the total |

Built so far: fame only, as a count (`captain.fame`): a point for each famous pirate beaten and each hoard dug up, shown with the Top Ten (section 12). Retirement and the score wait.

## 3. World map

The world is a single tile map of the Caribbean, 1,600 x 1,100 tiles at 24 px per tile, rendered as a scrolling top-down view. The projection is equirectangular over longitude −98 to −59 and latitude 7 to 31, about 2.5 km per tile. Geography, regions and spawn rules are data. The same map file drives rendering, pathfinding, weather and AI routing.

The layers live in `packages/data/content/maps/caribbean/` and are built by `node tools/map/build-caribbean.ts` from AWS Terrain Tiles (Terrarium encoding). Attribution: the tiles' sources include NOAA ETOPO1, NASA SRTM and USGS GMTED.

### Map layers

| Layer | Contents | Source |
|---|---|---|
| Terrain | Deep water, shallows, reef, beach, jungle, hills, mountain, swamp, river. Built so far: deep, shallow, beach, jungle, hills, mountain. Reef, swamp and river are not built yet. | `maps/caribbean/terrain.png` (colour-indexed) + `terrain_types.json` |
| Elevation | 0 to 7 per land tile; affects march speed and sight | `elevation.png` |
| Regions | 14 named sea and land regions (Spanish Main, Windward Isles, Gulf of Honduras...) | `regions.json` polygons |
| Features | Settlements, reefs, sandbars, wrecks, landmarks for treasure maps | `features.json` |
| Currents | Vector field, 8 directions, strength 0 to 3 | `currents.json` |
| Wind zones | Prevailing wind by region and season; one zone per tile | `zones.png` + `wind_zones.json` |
| Fog of war | Per-tile explored flag, stored in the save. Deferred: the whole map is visible for now. | runtime |

Settlements are placed from real longitude and latitude, snapped to the nearest beach on the open sea (`placeSettlements`). A port whose nearest coast is a lake or lagoon on the map, such as Nuevitas Bay, whose mouth is narrower than a 2.5 km tile, moves out to the nearest open-sea beach within about 37 km, so every port can be sailed to.

### Terrain rules

- **Deep water**: all ships.
- **Shallows**: ships with draft 1 or 2 only. Deep-draft ships run aground and lose hull points plus 1 to 3 days.
- **Reef**: impassable to deep draft; shallow-draft ships take hull damage at speed above half.
- **Land**: party on foot only. March speed set per terrain type; jungle and swamp cost food and cause fever risk.
- **Rivers**: navigable by draft 1 ships for a set distance inland (up to a fixed node in `features.json`).

### Weather and wind

- Wind has a direction (16 points) and strength (calm, light, fresh, strong, gale).
- Each wind zone runs a small state machine. Prevailing direction shifts slowly; gusts and calms are random events drawn from the seeded RNG.
- Seasons: dry (Dec to May) and hurricane (Jun to Nov). Storm spawn rates come from `weather.json`.
- Built: 9 wind zones in `wind_zones.json`, each with a dry-season and a wet-season prevailing wind and a spread. Zone events add Gulf northers (Oct to Mar) and wet-season calms off Darién. Zone winds drift every 6 game hours (`weather.json`).
- Built (game-first, not climatology): the real trades blew from the east some 94% of the time, which made half the map a chore. Four to six roaming weather systems (`weather.json` systems: lows turning the wind anticlockwise, highs clockwise, 700 to 1,200 km across, drifting for 4 to 10 days and blending into the trades, strongest at the centre) and a westerly spell in every zone (3 to 6 days, a 12% chance a day) bring the east wind down to about 59% of the time; a brig takes 1.09x as long to make ground east as west (`packages/systems-weather/test/sailing.test.ts`). The sea chart draws the wind as arrows, so a run east can be planned.
- Weather breaks keep the trades from blowing the same way for weeks: winter fronts bring northerlies (Nov to Apr), tropical waves back the wind south-east in summer (Jun to Oct), and spells of variable wind can come in any month.
- Coastal breezes: within about 30 km of land an onshore sea breeze peaks mid-afternoon and an offshore land breeze before dawn. They add to the zone wind, so a captain can work east along a coast at night, as ships historically did against the trades.
- Storms spawn east of the Lesser Antilles in hurricane season (peak Aug to Oct, about 3 to 4 a season), track west-north-west and recurve north-east past 25°N. Inside a storm the wind turns counter-clockwise: gale near the eye, strong at the edge. Storm damage to sails and crew is not modelled yet.
- Weather state and its seeded RNG stream live in the world state, so weather replays deterministically.
- Storms are moving map objects with a radius. Inside one, sails take damage, crew can be lost overboard, and ships drift.
- Storms can wreck AI treasure fleets, which seeds new lost-treasure sites (section 10).

### Fog of war and discovery

Deferred. The whole map is visible for now. The rules below still stand for when it is built.

- The map starts known for the home region and major town positions (from period charts).
- Tiles within the ship's sight radius become explored. Sight radius comes from ship type, crew lookouts, time of day and weather.
- Unknown settlements, wrecks and treasure landmarks stay hidden until seen or revealed by a map fragment or rumour.
- Enemy ships show only inside sight radius. Outside it, the player sees a last-known marker that fades.
- Built for ships: every AI ship on screen is drawn, day or night, flying her nation's flag; a ship the player is watching never blinks out. The minimap and sea chart remember every ship that came within 30 tiles (beyond the edge of the screen), fading over three days. Shorter sight at night and fog of war for ships wait for lookouts and the fog-of-war work; an 18-tile radius was tried first and made ships vanish while still on screen.

### Day and night

- A 24-hour cycle tinted by a palette shader over the sprites.
- Night lowers sight radius by half and allows stealth town entry and surprise attacks.

### Rendering

- Terrain drawn as an autotiled tilemap from a sprite atlas (Wang or blob tiles for coastlines).
- Until the autotile set exists, the renderer paints terrain procedurally from the palette. Coasts are smooth contours blended between tile centres, and relief is shaded from elevation. Collision stays on the tile grid. (This was the 2D sea renderer, removed 2026-10-10.)
- Built (3D, the only sea renderer since 2026-10-10, `@corsair/render3d`): the sea following the weather, islands raised from the elevation map with ground and vegetation, towns in their nation's style with forts, wharves and lamplit windows, ships built in code from each class's plan with cloth sails, storms, and treasure landmarks. The camera follows the player's ship; the mouse wheel zooms from her deck to the whole region and C swings it between overhead and astern. Collision stays on the tile grid. The sea chart, the minimap and the harbour scenes stay 2D.
- Settlements sit on the map from `settlements.json` (45 historical settlements of c.1660, by longitude and latitude). Each snaps to the nearest coastal tile at load; one more than 3 tiles from the coast fails validation.
- Settlements, ships, storms and markers drawn as sprites with 8 or 16 facing directions.
- Scene cameras and the sprite list for each view are in `docs/project-corsair-scenes.md`.
- Minimap in the corner: a window of about 240 x 135 tiles around the ship. A full sea chart screen (M key) shows the whole map with every port, and later known prices, routes and treasure notes. Both draw from a one-pixel-per-tile overview of the map, not new art. While fog of war is deferred they show every tile.

## 4. Navigation

The player steers the flagship directly with keyboard, mouse or touch; the rest of the fleet follows in formation. Speed is a function of ship type, wind angle, sail state, hull condition, crew and cargo load. The same function drives AI ships, so player and AI obey one physics model.

### Sailing model

Effective speed each tick:

```
v = v_{base} \cdot P(\theta) \cdot W_s \cdot H \cdot C \cdot L + v_{current}
```

- v_base = ship class top speed (`ships.json`).
- P(θ) = polar curve by angle to wind, a per-rig lookup table of 16 points. Square-riggers peak on a broad reach and stall close-hauled; fore-and-aft rigs point higher. Tuned for play: a square rig has no drive inside about 33° and its best upwind course (about 55° off) makes good about 0.38 of top speed. The first playtest found 0.19 too slow to ever sail east against the trades.
- W_s = wind strength multiplier (calm 0.15, light 0.5, fresh 0.8, strong 1.0, gale 1.1 with damage risk). Each step up must be clearly faster; the first playtest found 1.0 to 1.15 too small to feel, and a slower gale read as a bug while damage isn't modelled.
- H = sail condition, 0 to 1. C = crew factor: below minimum crew, speed drops linearly.
- L = load factor: cargo and cannon above 75% of capacity slow the ship.
- v_current = map current vector at the tile.

Turning rate uses the same inputs, plus a rig-specific turn penalty for square rigs.

### Fleet movement

- Fleet speed equals the slowest ship. The UI shows which ship is holding the fleet back.
- Fleet cap: 8 ships. Above the crew needed to sail them, extra ships must be scuttled, sold or left in port.
- Only the flagship fights in sea combat (as in the original). Other ships are cargo, prizes and spare hulls.
- Built (fleets slice): a prize can be kept from the plunder screen ("Keep her": +her hold, her minimum crew to sail her, the fleet keeps her pace), up to 8 ships, and not when the fleet's men couldn't sail every ship (the screen says why). The fleet's holds and berths count as one: one cargo and one crew for the whole fleet, so nothing is shuffled between ships, and every hold and berth figure (merchant, tavern, plunder, planner, ship card) is the fleet's. The fleet sails at its slowest ship's speed and the ship card says which ship holds it back; the other ships follow the flagship in line astern on the map (drawn only: they are not on the world map). Only the flagship fights, with her berths' worth of the fleet's men, at her own speed; only the men who fought can fall. At the shipwright each ship shows her condition, Make flagship and Sell (35% of her class's price by her condition; refused, with the reason, when the rest couldn't carry the cargo or berth the crew); Repair mends the whole fleet. Buying ships: see section 7.

### Supplies and crew morale

- Food: consumed per crew member per day. Shown as days remaining. At zero, morale falls fast and crew desert at the next landfall.
- Morale (0 to 100) is driven by: days since last pay-off, gold per head, food, recent victories, losses and captain fame. Thresholds trigger events: grumbling, desertion, mutiny.
- Mutiny is a scripted event: the player fights a duel with the ringleader or pays off. Losing means marooning and a restart from a small boat.
- Pay-off (dividing the plunder) resets morale and ends the voyage. Crew may leave if their share was poor.
- Built so far: a crew count. Grape and boarding kill men; the tavern signs men on for 10 gold each up to the berths, and the shipwright makes good hull (6 gold a point) and sails (2 a percent).
- Built (crew slice, `crew.json`): a new career sails with 20 food. The crew eats a unit per 20 men a day at sea (none in port), shown in days on the HUD and ship panel. Morale starts at 70 and drifts a quarter of the way each day toward the crew's mood: 60, plus up to 40 more by plunder waiting per head, less 1.5 a day unpaid after 15 days. They lose 8 a day starving, gain on prizes and lose on defeats and men killed. Below 25 a tenth of the crew deserts at landfall, and below 10 three tenths. Mutiny waits. More hands than a broadside needs reload faster, up to 25% at three times the need. Morale scales boarding strength from 0.7 to 1.2, and a ship below her minimum crew sails and turns slower, down to 40%. Volunteers join from prizes: a quarter of a pirate's crew, a tenth of others.

### Landfall and exploration

- The player can land on any beach tile. The ship anchors; the party goes ashore with a chosen crew count.
- On land: march speed by terrain, food carried, fever risk, native encounters, ambush events.
- The party can dig at a marked spot, approach a town by land, or scout a fort.

### Encounters at sea

- Ships within sight radius can be hailed, shadowed, attacked or avoided.
- Hailing shows nationality, class, and a hint of cargo or passengers (a governor's daughter, a villain lieutenant, a treasure galleon's pay chest).
- The player can fly false colours if the flag skill or an item allows it. The AI checks disguise against its own vigilance stat.
- Built: hailing. Within 3 tiles of a ship at sea, H speaks her: her name, nation and class, what she carries and where she is bound, and the news she picked up in her last port (added to what the captain has heard). The clock stops while hailing. The hail offers Attack, which starts the sea battle (section 9.1); shadowing, avoiding and false colours wait for AI that reacts to the player.

### Sound, music and sea life

Sailing is where players spend most of their time, so it should sound and look alive. Every layer is a gameplay cue first and realism second. The audio and the sea life only read the world state and never change it.

- **Ambience (synthesised):**
  - waves swell with wind strength
  - the rigging sings loudest close-hauled
  - water rushes past the hull with speed
  - sails flap in irons and thump when they fill
  - surf rises near land, and rain falls in storms
- **Recorded sounds** (CC0 and public domain, credited in `art/audio/CREDITS.json`):
  - gulls near land by day
  - hull creaks with the wind
  - canvas and rope on sail changes
  - harbour voices and church bells near towns
  - thunder after lightning
  - dolphins and splashes with the sea life
  - humpback song on calm nights in open sea
- **The ship's band:**
  - 31 traditional public-domain tunes in `content/music.json`, arranged for fiddle, whistle, plucked bass, harp and drums, and sequenced live over CC0 instrument samples.
  - Under full sail at speed the full band plays a lively shanty. Easier sailing gets a gentle tune with fewer instruments, and night gets a slow air. Storms have no music, only wind and thunder.
  - Tunes rotate with 25 to 50 seconds of quiet between them.
  - Only traditional tunes are used: modern songs, including instrumental versions of them, are still in copyright.
- **Sea life** (renderer-only, rare events):
  - dolphins riding the bow at speed in open water
  - flying fish bursting from the bow by day
  - distant whales spouting and showing their flukes
  - pelicans and frigatebirds near coasts
  - the odd fish jumping
  - Built in 3D (2026-10-10): a pod of dolphins leaping at the bow, flying fish, a whale surfacing to blow, gulls wheeling near land (pelicans, frigatebirds and the odd jumping fish not yet).
- **Controls:** V mutes all sound, N toggles the music. Sound starts on the first key press, as browsers require. Elsewhere: E enters a port in reach or sets sail, Esc puts the market away to show the harbour, = and - set time acceleration, C swings the 3D camera between overhead and astern (the mouse wheel zooms), Ctrl+S (Cmd+S) saves.
- **Day and night** in the harbour scenes is a palette swap through dusk and night rows (art pipeline section 6). At sea the 3D sky keeps its own slow day, not the game clock's: a long bright day, golden sunrise and sunset and a short moonlit night, about 20 real minutes round; the HUD shows the date only. A new game starts at 08:00 on the game clock.

### Quality of life

- Time acceleration (1x, 2x, 4x) in open water, auto-paused when anything enters sight. Built: the world sails at 0.7 of its old pace (0.7 tiles/s per speed point) and a game day lasts about 26 s at 1x (771 ticks), so distances per day are unchanged while a passing ship stays on screen about twice as long. On empty sea the game cruises at 2x (= and - pick 1x to 4x); it holds at 1x near land, in a storm, in port, and when a sail comes within 15 tiles, which is called out ("Sail ho!"). I sets an intercept course for the nearest ship in sight, leading her and beating when she lies upwind, until the helm is used. Square rigs now make good about 48% of top speed to windward (sloops 61%). A ship casts off on the most seaward heading she can sail, never into irons.
- Click-to-sail autopilot that routes around shallows for the current fleet draft.
- Built (chart planner): ports are squares in their nation's colour (painted town marks were tried and read poorly at chart size); the player is her ship, turned to her heading; a compass rose sits in the corner. Hovering a port says what it is, what it makes and needs, whether it would refuse her or its patrols hunt her, and the prices she saw there. A voyage planner down the right side lists the trades worth sailing from where she is, from prices she has seen: buy here, sell there, about what a full hold makes (the sale price sagging by that market's depth), the days at sea along the lanes, and the pirate risk on the way (how near the lane runs to a haven); below them, leads within a few days' sail (made at one port, needed at another, prices not yet seen), one a good. Clicking one sets the course to where she buys.
- Built (chart key): the sea chart fills the screen (its marks and names grow with it) and stops world time while it is open. It carries a key above it: each nation's port colour, pirate havens and the pirate waters shaded faintly about them (fading out where pirates' interest has halved), the player, ships seen (fading over days), and which nations are at war now. With a good picked, ports show ▲ (made there: the price to buy) or ▼ (needed there: the price to sell) in green and pink, clear of the nations' colours.
- Built (keyboard first): picking a port on the sea chart plots the best route there by sea (the lanes, round the land, to the port's berth), drawn on the sea as a dotted gold line and re-plotted about once a second from where the ship is; the HUD gives its length and the bearing of the next leg. F lets the autopilot follow it (beating where it must, keeping off coasts) and takes her into port the moment the town is within reach, without a key; steering by hand takes the helm back. A test sails into all 45 ports from 12 tiles out along a lane: each makes port within 20 seconds (before the fix, 9 ran aground or circled off the harbour, the coast watch shying from the town past the berth). Making port clears it. (Mouse sailing is built but switched off until it plays better.)
- Built (mouse controls, after Pirates!: left-click to move, right-click to act): a left-click on the sea sets a course there, on a port sails in and docks, on a ship intercepts her; holding it re-aims. Courses follow the sea lanes round the land (`lanes.path`, ending at a port's berth: roomy water within docking range, in a clear line from its mooring), beat on long boards when the way lies upwind, go about early when the shore closes in, steer clear of coasts 8 tiles ahead, and are re-plotted from where she is when beating carries her off the line; one pressed aground 3 s gives the helm back. Nine headless voyages between ports all end within docking range except Villahermosa, up an inlet too narrow to beat into. A right-click hails the ship or enters the port under it, or drops the course. In battle a left-click (or hold) steers to the point and the right button fires (held, as each broadside bears); the keyboard changes modes. A ship panel (bottom left) shows the ship, her hull, sails and crew, each broadside's guns lit as loaded, and clickable modes (shot, sails, cruise, stop); its art is the painted UI kit (`art/sources/paintings/README.md`, group `ui`, imported by `tools/art/import_ui.ts`). Hovering a ship at sea names her.
- Built (ship card): the ship panel is the one place the ship and her crew are shown, at sea, in port and in battle: her portrait and guns mounted (10 of 18), hull, sails, crew against berths, morale, days of food, the purse and the plunder chest, the hold, and each broadside's guns; in port its sail and cruise modes drop away. The HUD keeps to navigation (date, wind, point of sail, sails, heading, speed, course). The port header keeps to the town (its nation and trade, the date, your standing with its nation). Where you act, the consequence shows: the merchant's food row gives the days the food lasts beside the units, and the tavern says how much sooner the food runs out and how much more the wages come to for each 10 men signed on.
- Tacking aid (built): B holds the best upwind course on the current tack and follows the wind as it shifts; T comes about onto the other tack; steering by hand takes back control. Clicking a port on the sea chart sets it as the destination, and the HUD shows its distance, bearing and how fast the ship is closing on it.
- Logbook with every event, visit and rumour, searchable.

## 5. Settlements

About 45 settlements, each a record in `settlements.json` with owner, size, wealth, population, defences and a service list. Settlements are simulated every in-game week: they grow or decline from trade, raids, war and disease, and can change hands.

### Settlement types

| Type | Count (v1) | Owner | Services | Notes |
|---|---|---|---|---|
| Colonial capital | 4 | Nation | All, plus governor-general | One per nation. Issues major missions and titles |
| Colonial town | 24 | Nation | Governor, tavern, merchant, shipwright, bank | Main playable hubs |
| Pirate haven | 4 | Pirates | Tavern, black-market merchant, shipwright | Hostile nations cannot enter. Villain hideouts |
| Jesuit mission | 5 | Church | Healer, rumours, sanctuary | Neutral. Hires out as refuge from pursuit |
| Native village | 8 | Native tribe | Trade, guides, allies for land battles | Relationship tracked per tribe |
| Lost city | 3 to 5 | None | Treasure only | Hidden until revealed (section 10) |

### Attributes

- **Owner** (nation id), **population** (100 to 20,000), **wealth** (0 to 100), **size tier** (hamlet, small, medium, large, city).
- **Economy profile**: produces and consumes goods (sugar, tobacco, hides, cotton, silver). Drives prices (section 6).
- **Defences**: fort level, garrison soldiers, guns, walls (section 8).
- **Attitude to player**: derived from nation reputation plus a local modifier (past raids, favours).
- Built so far: standing per nation, -100 to 100. Firing on a nation's ship costs 20; sinking or taking a pirate earns 3 with every nation. At -30 or below the nation's patrols hunt the player as pirates do; at -50 or below its ports refuse them. Pirates always hunt: one that sights the player within 20 tiles gives chase (holding her tack until the other is clearly better) and starts a fight at contact, giving up past 30 tiles or once the player docks. A probe of the Port Royal to Tortuga round trip puts a pirate within range on 18 of 20 voyages and a fight on 13. The governor, letters of marque and local attitude come later.
- **Governor**: a named character with personality traits, a daughter (maybe), and an agenda.

### Town services

- **Governor's mansion.** Missions, letters of marque, titles and land grants, rewards for enemy ships and pirates sunk, romance (section 11). Needs acceptable reputation.
- **Tavern.** Recruit crew (count scales with fame and town size), buy rumours, meet informants and old sailors selling map pieces, hear news. Built: news; signing on men (section 4); dividing the plunder (section 6); the governors' contracts heard of (section 6); the Top Ten and the shady stranger selling map pieces (section 12). The tavern lists what the town has heard, newest first, marks what is new to the captain, and the tab shows a count of new items; heard rumours also show on the sea chart's port card.
- **Merchant.** Buy and sell goods, cannon, food. Prices from the local market (section 6). Built: goods (cannon are mounted at the shipwright, section 7). E docks within 3 tiles (about 7.5 km) of a town; world time stops in port. The captain remembers each market's prices from the last call, and hovering a port on the sea chart shows them with their age. What each port exports and wants is common knowledge, shown on its market and on the chart; staples (food) are never tagged, as the merchant's one-gold margin means they can't be carried for profit. Every good shows how many units its market takes before the sell price falls a quarter, remembered for ports the captain has called at, with small markets flagged: "sells well" in a small haven pays only for a small cargo. Market rows tag goods "buy here" or "sells well", show the average cost of cargo in the hold against today's price, and name the best sale price seen in another port, flagging the per-unit profit when buying here and selling there pays. The chart's goods filter colours every port by whether it makes or needs a good and adds the last-seen price where the captain has called.
- **Shipwright.** Repair hull and sails, buy upgrades (copper sheathing, cotton sails, fine-grain powder, chain shot, bronze cannon), sell ships. Built: in three sections, Repair, Buy ships and Upgrade (section 7).
- **Bank / money-lender.** Store gold safely. Pirate havens have no bank.
- **Barber-surgeon.** Heal wounds, at a cost in gold and time.

### Entering a hostile town

- If the player is wanted, the guards refuse entry by sea.
- The player may sneak in on foot at night: a stealth minigame where guard patrols follow data-driven paths. Getting caught means jail, a bribe or an escape attempt.
- A captured town (section 9) becomes open to the player and may be handed to another nation.

### Growth and decline

Weekly simulation tick per settlement:

- Population changes with food supply, trade volume through the port, disease events and raids.
- Wealth rises with trade and drops after raids and blockades.
- Size tier changes when population crosses thresholds, which unlocks or removes services and changes defences.
- A town at war can be besieged by AI fleets; if it falls, ownership changes and a news event fires.
- Pirate havens spawn pirate captains; if a haven is destroyed, pirate activity in its region falls.

### Visuals

Each town has a harbour screen made of layered sprites (sky, sea, buildings by owner style, fort, ships at anchor). Building sprites switch with size tier and owner nation, so a captured town visibly changes.

Built: 13 compositions (four nations x small, medium and large, plus the pirate haven) from `tools/art/render_harbours.py`, with `harbours.json` giving layers, building hotspots, the flag point and the anchorage. Hamlets use small, towns medium, cities large. The game flies the owner's flag, moors the player's ship, and draws the scene under the day/night palette. Buildings are clickable. Painted versions of all 13 (Grok Imagine, kept to the Blender layouts and snapped to the palette by `tools/art/import_paintings.ts`) now replace the layered renders, with four shimmer frames made from each painting's own sea. Painted interiors stand behind the open service: the merchant's counting house, and the tavern (a pirate one in havens); Esc returns to the harbour. A port's rooms are preloaded on docking.

## 6. Economy

The economy is a simulated market per settlement, linked by AI merchant ships that physically carry goods. Prices come from stock against target stock, so raiding a convoy really does raise prices at its destination. Gold flows through four sinks: crew shares, repairs, upgrades and bribes.

### Goods

| Good | Produced in | Base price (gold / unit) | Volatility |
|---|---|---|---|
| Food | Everywhere | 2 | Low |
| Sugar | Windward and Leeward Isles | 30 | Medium |
| Tobacco | Cuba, Virginia coast | 40 | Medium |
| Hides | Hispaniola, Main | 25 | Medium |
| Cotton | Main, Yucatan | 20 | Medium |
| Luxuries (wine, cloth, spices) | Imported via capitals | 80 | High |
| Silver | Main mines, Silver Train | 150 | Low (Spain controls supply) |
| Cannon | Capitals, shipwrights | 150 per gun | Low |

All values are placeholders in `goods.json` for balancing.

### Price model

Each settlement holds stock S and target stock T per good. T is the demand level, the same for every settlement of a size; profiles decide the usual stock S drifts back to, above T where a good is made and below it where it is needed, in proportion to the profile rate: a full producer (rate 1) holds 2.5x T, a full consumer 0.4x, a town that uses a little (rate 0.3) only slightly under T. That gap is what makes a route pay. Only rates of 0.5 or more make a port known for exporting or wanting a good. The local price is:

```
p = p_{base} \cdot \left(\frac{T}{\max(S, 1)}\right)^{e} \cdot m_{war} \cdot m_{rep}
```

- e = elasticity per good (0.3 to 0.8).
- m_war = war modifier (blockaded ports pay more for imports).
- m_rep = player reputation modifier on the buy/sell spread only.
- Buy price = p x (1 + spread); sell price = p x (1 - spread). Spread from difficulty and town type.
- Each trade moves S immediately, so dumping 200 sugar in one port crashes the price. This makes trade routes self-limiting.
- Built: m_war and m_rep are still 1. Whole-gold rounding never lets the buy price fall to the sell price. Starting stocks vary by +-30% per seed. Over 200 seeds a full purse of Bridgetown sugar sold in Port Royal (a strong market) clears a median of about 330 gold and never loses; sold in Coro, which uses only a little sugar, it makes about 75 and loses one start in five.

- Built (trading screen): the merchant explains himself. Each good shows its price here (buy and sell) with a cheap, usual or dear mark against its usual price; pointing at a price says why (today's stock against the usual, the news behind a shock, whether the town makes or needs it, and that every unit traded moves it). The hold column shows what you paid each and what selling one here now would gain or lose; the best sale you know of shows its profit a unit. Pointing at any Buy or Sell button previews the trade exactly as it would go (`tradePreview`: units, gold, the price after it, the gain or loss against what you paid, plunder's gold going to the chest), and a sale at a loss says why (the merchant's spread) and where to sell instead.

- Built (living ports, slice 1 of the economy; research in `docs/reference/pirates-original-games.md` section 5): each port has people (800 a hamlet, 3,000 a town, 9,000 a city, more at a capital), a merchant's purse and a trend, shown on the port header and the chart's port card. Every day its people make and eat goods by its profile; rum and cloth are made from the sugar and cotton in store (Port Royal, Bridgetown and Saint-Pierre distil; Campeche, Santa Marta and Willemstad weave); the wider world (hinterland, smugglers, Europe) closes 4% of each gap to the usual stock, so a port that makes or eats a good sits half again above or below it when no merchant calls, and merchant deliveries really move prices. Coasting craft between ports at peace within 30 tiles carry goods from where they are cheap to where they are dear, busier the nearer they are, so two towns on one island trade as one market (the St Kitts loophole is shut). A merchant buys only what his purse covers (0.4 gold a head, refilling 12% of the gap a day). People grow 0.4% a week while their needs are met (90%) and fall 2% a week when starved (below 35%), within half and twice their size's people. The merchant explains a price by what the town makes and eats a day and the days it has in store. A year of the whole world (economy-year test): no good runs dry or to the ceiling across the map, people grow about 4%, luxuries Port Royal to Santiago pay about +36 a unit and sugar Bridgetown to Port Royal about +38 on average, and St Kitts about -7.

- Built (ships that carry the world, slice 2 of the economy): convoys sail on a timetable (`traffic.json` convoys): every 60 days the English, French and Dutch, every 90 the Spanish flota, each in from the Atlantic off the map's east edge to its ports in turn, bringing luxuries and settlers (the port's people grow 2%), loading sugar, rum, tobacco, hides or cloth as far as the market has them, and sailing home off the map; the Spanish treasure ship (a frigate with 40 silver and a rich purse) sails from Portobelo to Havana and home twice a year. Each is a merchant to fight and take, and her coming is news in the taverns ("The English convoy Swallow is on her way from Europe to Port Royal"). Merchants never call at the ports of a nation at war with theirs, so a war closes markets to them (and leaves them to smugglers like the player). A patrol at war sails to blockade the nearest enemy port three voyages in ten, lying off it 6 to 12 days: a blockaded port gets a quarter of its usual supply from the wider world and no coasting craft, and says so on its header and chart card. Otherwise patrols favour their ports where merchants were lost in the last 30 days. A year of the whole world: luxuries Port Royal to Santiago pay about +47 a unit, sugar Bridgetown to Port Royal about +60 (convoys carry sugar home), St Kitts about -5, and people grow about 6%.

- Built (events and contracts, slice 3 of the economy): famine is a market shock on food (`economy.json` shocks, `on: staple`): the town's food runs low and its people fall 2% a week while it lasts. Plague (`economy.json` plague) breaks out about three times a year at towns of 3,000 or more, lasts 3 to 6 weeks, shuts the port to all shipping (the player is turned away at the harbour mouth, merchants, patrols, convoys and coasting craft keep away) and thins its people a further 2% a week; a ship that sailed from a plagued port brings it to her next port three times in ten. Every shortage and famine is also the governor's contract (`economy.json` contracts): land so many units of the good (half the town's reference stock, 10 to 60) by the time the shortage ends and he pays a reward on top of the sale (the good's price a unit, at least 12, so food pays), and the shortage is over. There is nothing to accept: a contract is known wherever its news has reached, listed in that port's tavern; the merchant shows the one in his town and counts what is sold toward it; the chart's planner lists the ones the captain has heard, with where to buy, the days to sail and the days left. Hurricanes and bumper harvests were already shocks (storm damage, bumper). A year of the whole world: about 9 famines, 12 shortages and 4 plagues; luxuries Port Royal to Santiago about +53, sugar Bridgetown to Port Royal about +52, St Kitts about -2, and people grow about 3%. Fever among a docked crew waits.

### Production and consumption

- Weekly tick: S += production - consumption, clamped. Production scales with population and a random harvest factor. Built as recovery: the weekly 25% recovery has given way to the living ports' daily pull (slice 1, above): each day the wider world closes 4% of the gap to the usual stock, capped at 3x usual.
- Hurricanes, raids and disease cut production for a number of weeks.
- Built as market shocks (`economy.json` shocks): a bumper harvest (an export goes cheap), blight (an export goes scarce), shortage (a want pays well) and storm damage (every export of a town a storm's eye passes over). About 0.9 start a week across the map (famine and plague since slice 3); each lasts 4 to 8 weeks, jumps the market most of the way at once and keeps pulling it while it lasts. A shock moves the usual stock, never the cap. Raids, disease and war wait for those systems.

### Merchant traffic

- AI merchants plan routes with a simple arbitrage rule: buy where p is lowest in reach, sell where it is highest, weighted by risk (known pirate activity).
- Nations run scheduled fleets: the Spanish treasure fleet and the Silver Train (a land convoy) carry silver on fixed seasonal routes in `routes.json`.
- Captured cargo removed from a merchant never arrives, so the destination's stock drops. The player can observe this in the data (section 16).
- Built: a hunter won't chase or fight a ship under the guns of a port she fears (pirates every port but a haven, patrols their enemies' ports): within 5 tiles of a town, 9 of a city (`chase.harbourTiles`). Forts that fire are still to come (section 8).
- Built: pirates hunt merchants of every nation and patrols hunt pirates and their nation's enemies (AI ships sight each other at 8 tiles). A meeting settles itself by crew x (1 + guns / 10) x role: the loser is gone, a pirate takes her cargo and purse and goes home with it, and the fight is news (and its guns are heard if the player is near). A season sees roughly 6 to 19 merchants taken by pirates.
- Built (`@corsair/systems-traffic`, `traffic.json`): about 34 AI ships sail at once. Merchants (fluyts, 50%) take the best margin from their port, buying at most 20 units and only while the far port pays 30% over cost, with at most two on any port pair, so they skim a trade rather than flood it; their cargo leaves the origin's stock when bought and reaches the destination's only when the ship does. Patrols (frigates, 18%) sail between their nation's ports. Pirates (sloops, 32%, so 11 at sea) slip out of the havens toward ports near home (bigger ports draw them, distance puts them off), lie in wait 2 to 5 days somewhere along the lane, then go home. Ships follow sea lanes found by A* on an 8-tile water grid (with a tile-level way out of narrow bays, and moorings always on the open sea; every port is reachable), at the speed their polar gives in the local wind, tacking on long boards (up to 6 tiles either side of the lane, shorter near land) where it runs to windward, and turning at their class's rate rather than snapping round. The population tops itself up a ship a day. A route probe after 30 days of traffic: the player's best routes keep most of their margin (Port Royal luxuries to Tortuga +684 against +723 without traffic). Treasure fleets: see slice 2 above (the flota and the treasure ship).
- Built (fleets slice): what a victor takes she keeps. A pirate who beats the player takes the plunder chest into her purse and what her own hold can carry of the cargo (the most valuable first, never the rations), and sails on with it; a nation's captain who fines the player keeps the fine. Taking her later brings it back. AI ships already keep their own hold, purse and crew, and a pirate who takes a merchant keeps the merchant's cargo and purse.
- Built (ships that change hands, at the player's request; `combat.json` prizes): every AI ship keeps her hold, purse, crew and damage, and a pirate keeps the ships she takes in tow (up to 2): her hold adds theirs (so she carries a whole cargo off), she sails at their pace (slowed by their damage), and she makes for her haven, where she sells each 20 to 40 days after taking her (news: "The pirate Fancy has sold the fluyt Hope at Tortuga"). Only her flagship fights. Beaten by a pirate, the player loses the most valuable ship of the fleet (never the flagship), what the rest of the fleet can't hold, and the men it can't berth; the report names the ship and the haven she is bound for, and the taking is news. Beat that pirate (taken or sunk) and her prizes are free: the player's own rejoin the fleet as far as room and men allow (else they lie in the nearest port that will have the player, free to take back at its shipwright); a nation's sail home, and that nation thinks the better of the player (as for a rescue). A patrol or merchant that beats a pirate frees her prizes the same way; a ship of the player's freed so lies at the nearest port of the victor's nation, to be taken back for 10% of her value in salvage. Prizes in tow count toward the world's population of their role: a hull is replaced only when sold. The sea shows only a pirate's own ship (her "+1" label for each prize went with the 2D renderer); hailing her names them ("your fluyt Endeavour"). A year of the whole world: about 34 prizes sold at havens and 61 freed (pirates slowed by their prizes are often caught short of home); margins and people as before.
- Built (pirate targeting slice): every hunter sights the player and AI ships alike, within 20 tiles, and a lookout picks the target. A pirate weighs what a ship would yield (cargo at base price and purse; the player's ship counts 400 more) against the odds, strength being crew x (1 + guns / 10): a bold pirate (half of them, set at spawn) goes after a ship she is at least 0.6 times as strong as, a cautious one 0.9 times. So the starting brig (10 guns, 75 men) draws only the bold, and a full battery with the berths filled is let be. Patrols take on any pirate in sight (a pirate already on someone first) and their nation's enemies. Pirates keep 14 tiles off a capital (a town's guns reach 5, a city's 9) and never lie in wait there, and their interest in a port halves at 140 tiles from their haven. A fight between AI ships within the player's sight (30 tiles) plays out on the map: both heave to with the sound of guns (their smoke went with the 2D renderer, to come back in 3D) for 18 hours of world time (about 19 seconds at 1x, long enough to sail in from the edge of sight), the HUD calls it with its direction, and the player can sail in and attack the pirate; beating her earns 10 more standing with the merchant's nation, who sails on. A patrol that comes up takes the pirate on, and the merchant goes free. Out of sight, fights settle at once. Beaten by pirates, the player keeps her rations. Each pirate also has her own nerve (0.6 to 1.2, drawn at spawn, multiplying her temperament's odds), so a few chance a stronger ship, and as the player grows stronger (crew x (1 + guns / 10) from 150 to 420) up to 35% of new pirates sail brigs rather than sloops. Measured on the voyage probe (Port Royal to Tortuga, 40 days, seeds 1 to 3): the starting brig meets a pirate 0.45 times a voyage, with 150 men (10 or 18 guns) 0.08 times, about one voyage in twelve (before nerve and bigger pirates, never); Port Royal to Santiago de Cuba in the starting brig 0.05. The voyage probe (`packages/systems-traffic/test/probe.ts`, 40 days, seeds 1 to 3), sailing Port Royal to Tortuga and back on the course autopilot: the starting brig meets a pirate about every 2.5 voyages (0.41 a voyage). Choosier pirates alone brought that down to 0.26, so their reach was widened from 110 to 140 tiles to keep these waters dangerous (one 60-day run before the slice, when every pirate within 20 tiles came for the player regardless: 0.4). A fully armed brig meets none: a cliff rather than a slope, to soften if fights grow scarce; the St Kitts to Nevis loop none in 104 voyages; luxuries Port Royal to Tortuga still pay 81 a unit after 60 days (91 at normal stock), with pirates taking about a merchant every three days and patrols sinking a pirate as often.

### Plunder and crew shares

- Gold, goods and ships captured go into the voyage pool.
- At pay-off, the crew take a share (difficulty-based, 30% to 70%), split per head. The captain's share goes to personal wealth.
- Built (two purses): prize gold, bounties and captured cargo, when sold, go into the plunder chest. Trade profit is the captain's own. In a tavern, "Divide the plunder" gives the captain 20% and the crew the rest per head, sets morale by each man's share (55 plus up to 40) and restarts the pay clock. The crew stays on. Wages (1 gold a man a day since last paid, from the captain's purse) are the merchant's alternative and set morale to 65. A defeat by pirates loses the whole chest.
- Crew expectation per head rises with fame. If the share per head falls below expectation, morale drops and crew leave.
- Governors pay bounties for enemy ships and pirates by nationality at war. Rewards also come in land and titles.

### Gold sinks and sources

| Sources | Sinks |
|---|---|
| Plunder (ships, towns) | Crew shares |
| Trade margin | Repairs and upgrades |
| Bounties and mission rewards | Buying ships and cannon |
| Treasure and ransom | Bribes, jail, surgeons, rumours |
| Selling captured ships | Food and recruitment |

A balance target: a skilled mid-career player earns about 3 to 5 times their pay-off cost per voyage. The economy tuning dashboard (section 16) tracks this curve across simulated careers.

## 7. Ship types and fleet

Twelve ship classes in four families, each a record in `ships.json`. Small ships are fast, shallow and nimble; large ships carry guns and cargo but need crew and deep water. No ship is best at everything, which keeps upgrades and prize choices interesting.

### Ship classes

| Class | Family | Rig | Guns | Max crew | Cargo | Speed | Turn | Draft | Hull |
|---|---|---|---|---|---|---|---|---|---|
| Sloop | Sloop | Fore-and-aft | 6 | 75 | 40 | 9 | 10 | 1 | 40 |
| War sloop | Sloop | Fore-and-aft | 10 | 100 | 50 | 9 | 9 | 1 | 55 |
| Royal sloop | Sloop | Fore-and-aft | 14 | 125 | 60 | 10 | 9 | 1 | 65 |
| Barque | Merchant | Mixed | 8 | 60 | 120 | 7 | 7 | 2 | 60 |
| Fluyt | Merchant | Square | 10 | 80 | 180 | 6 | 5 | 2 | 70 |
| Merchantman | Merchant | Square | 16 | 120 | 240 | 6 | 4 | 3 | 90 |
| Brigantine | Brig | Mixed | 14 | 125 | 90 | 8 | 7 | 2 | 75 |
| Brig | Brig | Square | 18 | 150 | 100 | 8 | 6 | 2 | 85 |
| Frigate | Frigate | Square | 28 | 250 | 130 | 8 | 5 | 3 | 120 |
| Ship of the line | Frigate | Square | 44 | 400 | 160 | 6 | 3 | 3 | 180 |
| Galleon | Galleon | Square | 32 | 300 | 300 | 5 | 3 | 3 | 160 |
| Treasure galleon | Galleon | Square | 36 | 350 | 400 | 5 | 2 | 3 | 180 |

Speed and turn are 1 to 10 relative scales. All numbers are starting values for balancing.

- Built (ship classes slice; `ships.json`, `combat.json` shipyard): all twelve classes, from the table above (the four first built keep their tuned numbers, and the war and royal sloops turn at 8 and the barque at 6; `ships.json` holds the live values). The world sails them: merchants a mix of fluyts, barques and the odd merchantman; patrols frigates, brigantines, war sloops and now and then a ship of the line; pirates sloops, war sloops and a few brigantines (and brigs once the player is strong); the convoys merchantmen, the Spanish flota a galleon, the treasure ship a treasure galleon. Each draw is from the ship's own stream. A shipwright sells new ships by port size (towns the sloops, barque and brigantine; cities those and the royal sloop, fluyt, brig, merchantman and frigate), at the class price, sound, with half her battery; she joins the fleet, and is refused, with the reason, when the fleet is full, short of men or the purse is short. The ship of the line and the galleons are built in Europe and never for sale: the way to one is to take her. A big battery shows on the ship card as one gun icon for several. Every class has her own 3D ship, built in code from her plan (`packages/render3d/src/rigs.ts`, `shipyard.ts`: cloth sails, masts that can fall), and her own painted ship-card portrait. Her world sprites (low-poly Blender models in `tools/art/render_ships.py`) now draw her only at anchor in the harbour scenes. A year of the whole world: margins about +58, +49 and -1, people +3%, 38 prizes sold and 30 freed (weaker patrols free fewer).
- Built (from play, 2026-10-10): the shipwright in three sections: Repair (every ship's condition and her own repair, the flagship first, and the whole fleet at once; making a ship the flagship or selling her), Buy ships (the yard's ships, and the player's own laid up there) and Upgrade (guns and improvements). It opens on Repair when anything needs mending. A ship spoken at sea (not a pirate, nor one of a nation that hunts the captain) sells food from her spare stores at three times its base price, up to 30 units a ship (`economy.json` seaProvisions); the hail offers it in one click, and the hunger warning says so.

### Per-ship state

- Hull points, sail condition (0 to 100%), guns mounted, crew aboard, cargo manifest, upgrades installed, name, flag.
- Condition persists between battles. A ship worn below 30% hull loses speed and risks sinking in storms.

### Upgrades (shipwright)

| Upgrade | Effect |
|---|---|
| Copper sheathing | +1 speed, no fouling slowdown |
| Cotton sails | Better upwind performance (polar curve shift) |
| Triple hammocks | +25% max crew |
| Iron scantlings | +20% hull |
| Bronze cannon | Longer range, faster reload |
| Fine-grain powder | +range |
| Chain and grape shot | Unlocks sail-damage and crew-damage ammo |

Upgrades are data: each is a set of stat modifiers with price, availability by town size and era.

- **Built** (`upgrades.json`, `shipStats` in `@corsair/data`): every system reads a ship through `shipStats`, her class as her mounted guns and upgrades change it. The six upgrades above (chain and grape stay free) are installed for good at the shipwright: hammocks, powder, cotton sails and scantlings at towns and cities, copper and bronze cannon at cities only. Cannon are mounted at 150 gold and sold back at 75, up to the class's battery, at any shipwright but a hamlet's (for now a fixed shipwright price rather than a market good). A new career starts docked in Port Royal with a brig of 10 of her 18 guns. Era availability, fouling and cannon weight are still to come. Headless runs against a pirate sloop: 10 guns win 26 of 40, a full battery 32, fully fitted 33.
- **Built (balance pass 2026-10-10): priced by the class.** The listed prices are the brig's; other classes pay by the work, per gun (powder, bronze cannon), per hull point (scantlings, copper, cotton sails) or per berth (hammocks), to the nearest 10 gold, and the shipwright's row shows the sum ("111 gold a gun × her 8"). A full fit-out now costs 53% to 98% of a class's price (it was 20% for a ship of the line and 203% for a sloop). Effects are unchanged. Measured against a pirate of her own class (`pnpm probe:battle upgrades`), a full fit-out takes a ship from about 22 wins in 40 to about 30 for most classes; copper wins nearly every escape; scantlings tell only against warships, since pirates shoot to cripple and board, not to hole.

### Hull fouling

Ships slow by up to 20% over months at sea unless careened at a shipwright or on a beach (costs days). This pushes the player back to port.

### Capturing ships

- Any ship taken by boarding joins the fleet with its cargo and damage. Built: kept from the plunder screen, struck or boarded (see Fleet movement); a ship kept, like one sunk, costs 5 standing with her nation.
- The player can move the flag to a new flagship at any time in port or after battle.
- Sale price at a shipwright = base value x condition x local demand.

### Sprites

Each class has a world-map sprite (32 directions, 96 x 96) and a combat sprite (16 directions, 192 x 192), both drawn from a 45° camera, with frames for sails furled, half and full, damage overlays, and a sinking animation. Since 2026-10-10 the sea and battles draw 3D ships (section 7, ship classes slice); the world sprites draw a ship only at anchor in the harbour scenes, and the combat set is unused.

## 8. Forts

Every settlement above hamlet size has a fort defined in `forts.json`, with a level, guns, garrison and layout. Forts decide how a town can be taken: bombarded from the sea, stormed by a landing party, or both. Owners upgrade forts over time when a town grows or is threatened.

### Fort levels

| Level | Name | Guns | Garrison | Walls (HP) | Typical town |
|---|---|---|---|---|---|
| 0 | None | 0 | Militia 20 to 60 | None | Hamlet, mission |
| 1 | Battery | 4 to 8 | 40 to 100 | 100 | Small town |
| 2 | Stockade fort | 8 to 16 | 100 to 250 | 250 | Medium town |
| 3 | Stone fort | 16 to 28 | 250 to 500 | 500 | Large town |
| 4 | Citadel | 28 to 48 | 500 to 1,200 | 900 | Capital |

### Fort components

- **Gun positions.** Each with arc, range, gun type and HP. Destroyed positions stop firing.
- **Walls and gate.** Wall sections have HP. The gate is the land assault's objective.
- **Garrison.** Soldiers (count, quality, morale) plus officers. Quality comes from nation and era.
- **Harbour chain or boom (level 3+).** Blocks entry until a gun position covering it is silenced.
- **Layout.** A small tile layout per fort template (star fort, coastal battery, hill fort) used by both ship-to-fort and land-to-fort battles.

### Garrison dynamics

- Garrisons reinforce weekly toward target strength, faster in capitals and when the nation is at war.
- A garrison drops with disease events and when troops are shipped to a war front.
- Rumours in taverns reveal garrison strength with some error. Scouting by land gives the exact number.

### Upgrades by the AI

- Towns spend wealth on fort levels when their threat score rises (recent raids, nearby war, pirate haven in the region).
- A town that was sacked often gets a fort upgrade within 1 to 2 years. The news system reports it.

### Rendering

Forts appear on the town harbour screen, on the world map as part of the settlement sprite, and as a tiled layout in the combat views.

## 9. Combat

Four combat modes share one rules core: a fixed-step simulation (30 ticks per second) with seeded RNG, stats from JSON and outcomes emitted as events. Ship-to-ship is real-time sailing and gunnery that usually ends in boarding and a sword duel. Ship-to-fort and land-to-fort are the two ways to take a town, and can be chained. What each mode shows on screen is in `docs/project-corsair-scenes.md`.

### 9.1 Ship-to-ship (real-time sailing battle)

- **View.** Top-down local battle map generated from the world tile (coast, shallows and reefs carried over). Wind direction and strength carry over from the world map.
- **Control.** Player steers the flagship only; the AI steers the enemy with a behaviour set per captain personality (aggressive, cautious, runner, cunning).
- **Guns.** Broadside fire from port or starboard. Guns reload on a timer set by crew per gun and gunnery skill. Gun arcs and ranges come from gun type.
- **Ammo.** Round shot (hull), chain shot (sails, speed), grape shot (crew, short range). Switching ammo costs a reload.
- **Damage model.** Hits roll against a hit table by range, angle and sea state. Hull hits reduce HP and may knock out guns; sail hits reduce speed; grape kills crew. Critical hits: magazine explosion, fire, rudder loss (all data-driven).
- **Endings.** Enemy sinks (cargo lost), strikes colours (surrender, when morale breaks), escapes off the map edge, or ships touch for boarding.
- **Built (who sails her, slice 1a of `docs/design/combat-model.md`):** every AI ship has a crew grade (green, regular, seasoned, veteran) and a captain with gunnery, seamanship, boarding and resolve from 0 to 100, drawn at spawn by role (`combat.json` captains: merchants mostly green or regular under poor captains, patrols drilled gunners who board poorly, pirates strong boarders). A veteran crew reloads 20% faster, shoots 20% straighter and boards 25% harder; gunnery moves reload and scatter by up to 15% and 30% either way, boarding moves boarding strength by up to 30%, and seamanship sets how often she rethinks (every 12 ticks at 0 to 4 at 100). At 50 under a regular crew nothing changes, which is how the player's ship and every ship from before sail. A captain sizing up a target weighs only what he can see, her men and guns; quality tells once the guns go off, in the battle and in fights between AI ships, where it is measured against the usual for her role so the world's balance between merchants, patrols and pirates holds. The hail panel and the battle card name a green, seasoned or veteran crew. Resolve waits for the surrender model (slice 1b).
- **Built (doctrine and surrender, slice 1b):** what each opponent fires is data (`combat.json` doctrines): merchants and English, Dutch and Spanish patrols round shot at the hull, French patrols chain at the rigging, pirates chain then grape to take her whole; Spanish patrols carry soldiers that make them 1.4 times as hard to board. A beaten ship strikes each second at 15% for an ordinary captain at even odds, less for a captain of resolve (up to 30% either way) or a crew in better heart than her role's usual, and sooner the worse the odds (her opponent's men and guns over hers, to the power 0.5, between half and double): an outgunned pirate sloop now strikes 19 times in 40 rather than 15. A famous pirate calls on the player to strike when her boarders would lose (odds under 30%) or her hull is under 35%, within 12 tiles: the HUD says so in red, and Y strikes her colours (outcome "You struck"): he takes the plunder chest and what his hold can carry of hers, never her fleet ships or her men, and she keeps her ship.
- **Built (ten distinct famous captains, slice 1c):** each captain sails with his own crew grade, skills, ship's fit and way of fighting (`pirates.json`): Morgan a veteran frigate with bronze cannon and iron scantlings and iron resolve; l'Olonnais whose terror calls on a beaten captain to strike half as readily again; Mansvelt steadfast (never runs); Braziliano a veteran boarder with poor gunnery; de Graaf an elite gunner, coppered, who demasts with chain and stands off; Grammont's disciplined boarders; Português slippery (runs early, hard to catch); Willems a gunner for his class; Coxon; le Grand a reckless boarder. Their berths are filled, hammocks and all, and hailing one names his crew and fit. Measured (`pnpm probe:battle famous`, 60 seeds, player losses): against a frigate the top three 27-33, against a fitted brig the middle three 21-25, against an armed brig the bottom four 10-21 (Português escapes rather than wins); a new career's brig loses 43-58 to all but Willems, so none of them hunts her: each captain has a rung of the career (bottom four 2, middle three 3, top three 4) and goes after the player only once her men x (1 + guns / 10) reaches it (300 an armed brig, 480 a fitted brig, 800 a frigate); revenge ignores it. Morgan's consort and fireship wait for battles with two enemies.
- **Built (matched encounters, slice 2):** every sea area has a danger tier (`traffic.json` danger: the Caribbean Sea and the Lesser Antilles quiet, the Windward Passage, Florida and the Bahamas and the Gulf of Honduras pirate waters, the Spanish Main and the Mosquito Coast dangerous, the Gulf of Mexico the treasure routes), named beside the sea area on the HUD; a pirate marks ports in waters that fit her ship (sloops the quiet coasts, brigantines and brigs the Main). The cliff is gone: a pirate chances poorer odds for a rich prize (the player's worth over 1,000 gold, up to 1.6 times poorer), so on the Port Royal to Tortuga run the starting brig meets a pirate 0.47 times a voyage and a fully armed brig still 0.32 (it was none). The light frigate (22 guns, 160 men, 10,000 gold) bridges the brig and the frigate: sold at city yards, sailed by patrols, drawn on the frigate's rig with a shorter hull.
- **Built (objectives, slice 3):** the captain's log (L) opens on Goals: the next three of twelve goals in career order (mount a full battery, sign on a full crew, make 2,000 gold trading, take a first prize, win a letter of marque, beat a pirate of your own size, fit out your ship, beat a famous pirate, fit her out fully, command a frigate, enter the Top Ten, dig up a hoard), each with a progress bar ("10 / 18 guns"), what it brings, and one click to the nearest port where it gets done (in reach, she goes in) or the log page that shows it; the done ones are listed below. The HUD says "Goal done" the moment one is, and names the next. The career's record (`captain.record`: trade profit from sales, prizes, pirates beaten by class, famous pirates beaten) feeds them. The career probe for pacing waits for the fame slice (8).
- **Built (guns and range, slice 4; no gun weights, decided):** a ball is full force within half her guns' reach and falls to half force at its end, for hull, sails and men alike; a ball that flies down her length (within about 30 degrees of her heading) rakes her for double the harm, called out on the HUD ("Raked her, bow to stern!"); swivel guns (`ships.json` swivels, and the fit to come) fell 0.6 men each every 3 seconds on a ship within 3.5 tiles, no ball flying; chasers (frigates, the light frigate, galleons and the ship of the line two at each end, the brig and brigantine one) fire round shot every 6 seconds at a ship within 15 degrees of the bow or stern and within reach; oars (`ships.json` oars, for the oared ships to come) row her at that share of her top speed in a calm or into the wind. The headless runner now has a brig taking a pirate sloop 29 times in 40 and a fully fitted brig 34.
- **Built (upgrades rework and fouling, slice 5):** every upgrade has its price (`upgrades.json`): hammocks (+25% crew), fine-grain powder (+15% reach, spoils in 60 days and must be bought again), cotton sails (8 degrees closer to the wind, wear 25% faster), scantlings (+20% hull, half a point slower), copper sheathing (half a point faster and a bottom that never fouls; cities only), bronze cannon (+10% reach, reload 20% faster, but three broadsides within 15 seconds overheat them to half again as slow; cities only), and three new fits: swivel guns (four on the rail, 5% fewer berths), boarding nettings (her men defend a boarding 1.4 times as hard, go over 0.9 as hard) and sweeps (row at a fifth of her top speed in a calm or into the wind; her gunners reload a quarter slower while she rows). A bottom fouls a quarter percent a day to 20% slower (shown on the ship panel from 5%); a shipwright careens her for 3 gold a hull point, or K careens her on a beach within 2 tiles of land in 3 days for free. AI ships carry fits by role (`traffic.json` fits: merchants nettings, patrols scantlings and bronze, pirates copper and swivels), prizes kept keep theirs, and a ship's value counts half her fits' price. The fit shows on the 3D ship: a copper band at the waterline, bronze muzzles, swivels on the rail, nettings over the waist, sweeps out of her sides.
- **Built (difficulty levels, slice 6):** a new career picks one of five levels on the start screen (Apprentice, Journeyman, Adventurer, Rogue, Swashbuckler; `combat.json` difficulty, Adventurer the tuned default; `?seed=` opens straight onto Adventurer, or `?difficulty=`), each saying what it changes; the Goals page names it. A level moves only the opponents and the battle, never the player's ship or anyone's speed: every AI captain's skills (-40 to +30), a crew a grade worse or better at a chance (-1 to +1), each role's chance of each fit (0.3 to 2 times), a battle wind that veers up to 10 or 20 degrees every 30 seconds on the two hardest, the player's near misses forgiven within 0.3 or 0.15 tiles on the two easiest, and how strong she must be before a famous pirate hunts her (1.5 to 0.7 times). Measured over 200 fights (`pnpm probe:battle difficulty`), the starting brig loses to a pirate sloop 47 times on Apprentice and 77 on Adventurer, and to a patrol brig 153 to 189 times from easiest to hardest; pirates already sail near the top of their skill and crew, so the hard levels show most against navies, in fits, the wind and the famous.
- **Boarding.** On contact, crew ratio and morale decide who fights. It moves into the fencing duel.
- **Built** (`@corsair/minigame-sea-battle`, `combat.json`): the world map itself around where the ships met, in the world's wind, drawn in 3D on the same sea at the sea's own zoom (the battle camera held within a range of distances) with the camera on the player's ship, so the sea runs on in every direction and only real coasts stop a ship. Ships sail with the world's sailing model at battle pace (`tilesPerSecondPerSpeedPoint` 0.3), starting 24 tiles apart so she comes over the horizon,, gathering way quickly and losing it slowly, so a ship carries her way through a tack. Space fires whichever broadside bears (held, it fires each as she comes into its arc; Q and E still fire a side by hand) when the target is within 50 degrees of the beam and in range (the arcs are drawn on the water, lit when a broadside can fire; reload 4 s); Tab cycles round, chain and grape and 1 to 3 pick one (grape only within 4 tiles; the player's switch is instant, an AI gun crew's costs a reload so pirates can't pour in chain then grape without a pause; the HUD shows whether each broadside is ready, loading, not bearing or out of range); a short-handed crew reloads slower. Each gun fires its own ball on a ballistic arc, tested in flight against the other ship's hull and rigging as she is then, so a ship can dodge; rigging hits hole the canvas and wear down the nearest mast, which can go by the board (`masts`); a round-shot hit can dismount a gun. The enemy is steered by role: merchants run, patrols keep their range, and pirates come in on the bow or stern, out of the broadsides, shooting chain and grape, and close to grapple only once the other ship is hurt (`tactics`). Endings: sunk, struck (hull or crew broken), boarded (hulls within 1.6 tiles throw grapples; held for 3 s, with both ships dragged to 40% of their way, the boarders go over and crew x a role factor decides it, both sides bleed; sailing clear past 2.5 tiles first cuts them), escaped (she drew clear), fled (the player drew clear), or lost. Drawing clear: past 30 tiles apart the HUD warns; past 36 tiles a gap that keeps opening for 8 s ends the fight, and whoever was sailing away is the one who got away (a 10-minute cap ends a fight that never resolves). The fight is virtual: both ships stay on the world map where they met, and guns knocked out stay lost. The headless runner plays AI-vs-AI fights: a brig takes a merchant fluyt every time (40 of 40; a merchant sloop has the legs to escape), beats a pirate sloop about four times in five (32 of 40) after some six broadsides before the first grapple, and loses to a frigate 39 times in 40. Surrender is readable: a beaten ship (hull below 25% or crew below 30%) may strike each second, and a merchant strikes outright with her sails below 25% or outmanned three to one within 6 tiles; the HUD says when she is wavering. A ship sunk leaves five barrels (50 gold each, to the plunder chest) and a fifth of her crew in the water around the wreck for 25 seconds; sailing over them picks them up (the men sign on, berths allowing), and Enter leaves the wreck. Standing: attacking a nation's ship costs 20 with it; beating her earns 5 with each nation at war with hers (10 for a warship taken); beating a pirate earns 3 everywhere. Readable fights (battle readability slice): the battle shows the wind (from where, how strong, and her point of sail) on a compass; shot looks like what it is in flight (a ball, two balls whirling on a chain, a cluster of small shot) and where it lands (splinters, torn canvas, a scatter on deck); a ship shows her damage (shot canvas in tatters, masts gone by the board; under half her hull she smokes, under a quarter she burns). G orders "close to board": her helm leads the enemy, runs alongside and holds there for the grapples, until G again or the helm by hand; within 12 tiles the HUD offers it with the chance the boarders carry her deck. The report opens with the ending's painted picture (art/sources/paintings, group outcomes, imported at 320 x 240) beside a row per result in green or red, standing as chips, and on a hurt ship where the nearest shipwright is. The plunder screen is one button (Enter) that takes the best of her hold, signs on her volunteers and settles her fate, each choice saying what it means: a merchant let go earns 2 standing with her nation, one sunk after she struck costs 5; a pirate let go goes back to raiding. Picking goods by hand is behind "Choose the goods myself". The fencing duel replaces the boarding roll later; criticals beyond a dismounted gun wait.

### 9.2 Boarding and fencing duel

- A side-view duel between captains, with crews fighting in the background.
- Three attacks (high, middle, low) and three matching parries, plus a dodge/jump. Each move has wind-up frames, active frames and recovery, defined in `fencing_moves.json`.
- Crew strength shifts the duel: a large crew advantage pushes the enemy back and speeds morale collapse; getting pushed to the rail or off the ship ends the fight.
- Weapons: rapier (fast, low damage), cutlass (balanced), longsword (slow, strong). Each is a stat block.
- Win: the ship is captured with cargo, crew may join, notable passengers are found. Lose: the player is captured, wounded or thrown in the sea (loses ship, keeps the rest of the fleet if any).
- Built (battle consequences slice; research in `docs/reference/pirates-original-games.md`): the fight's result reaches the world as it ends, and the last screen is an after-action report: her purse, wreck salvage, men lost, morale before and after, standing per nation (with the cost of the attack), what bounty she earns, and on a defeat what was taken. A ship taken (struck or boarded) puts her purse in the plunder chest at once; her cargo waits on a plunder screen (Pirates! 2004): take goods up to the hold, the most valuable first by default, throw the player's own over the side to make room, sign on her volunteers or put them ashore, then sink her (Enter) or let her go with what's left (L). Her cargo never reaches its market. Beaten by pirates, the player loses the plunder chest and the hold, but never the captain's purse; beaten by a nation's ship, she is fined half the purse; either way she is let go with at least a tenth of the hull. Prizes can be kept since the fleets slice (section 4, Fleet movement); prison and marooning wait for ageing.

### 9.3 Ship-to-fort (sea assault)

- The battle map is the town's harbour with the fort layout placed on the coast.
- Fort gun positions fire from fixed arcs, with longer range and higher accuracy than ship guns but a fixed position.
- The player silences gun positions one by one, then sails into the harbour. Touching the town dock triggers a boarding-style duel against the garrison commander, with garrison soldiers as the "crew".
- A harbour chain must be broken (by destroying its covering battery) before entry.
- Realistic outcome: a sloop cannot take a citadel from the sea. That is by design and should show up in balance tests.

### 9.4 Land-to-fort (land assault)

- The player lands the crew on a beach and marches overland on the world map.
- The battle is a turn-based tactical map of the terrain around the town, generated from the world tiles (forest, hills, open ground, river).
- Player units: musketeers, swordsmen and buccaneers split from the crew by role. Native allies may join if the tribe relationship is high enough.
- Enemy units: soldiers, cavalry and militia from the garrison, with a fort that fires on units in range.
- Unit actions: move, fire (with reload), charge, hold. Terrain gives cover and movement costs. Morale checks break units after losses or flanking.
- Win by reaching the town gate or routing the garrison. The final step is a duel with the commander.

### 9.5 Town capture outcomes

- **Sack.** Take a share of town wealth. Town wealth and population drop. Heavy reputation loss with the owner.
- **Hand over.** If the player holds a letter of marque from a nation at war with the owner, the town can be handed to that nation for a large reputation gain, land and possibly a title.
- **Install a new governor.** Pirate-aligned players may turn the town into a pirate haven (if the design keeps this; open question).
- News events fire for every capture. AI nations may send a fleet to retake it.

### 9.6 Combat tuning data

Every combat number (hit tables, reload times, damage per shot, morale thresholds, AI behaviour weights) lives in `combat/*.json`. The headless combat runner (section 16) plays thousands of AI-vs-AI fights per class matchup to check that win rates match the design intent.

## 10. Treasure maps and lost treasure

Treasure is generated, never hand-placed per game. Each treasure site is created at world generation or by world events (a wreck, a buried pirate hoard), then split into map pieces spread through the world. The player assembles pieces, reads landmarks and digs.

### Treasure sources

| Source | Created by | Found via | Value |
|---|---|---|---|
| Pirate hoard | Pirate captains retiring or dying (simulated) | 4-piece map from taverns, captured pirates | Medium |
| Wrecked galleon | Storms hitting AI treasure fleets | News + wreck site map from survivors | High |
| Lost Inca/Aztec city | World generation (3 to 5 per game) | 4 to 6 pieces from missions, old sailors, native villages | Very high |
| Family clue | Family quest chain | Villain lieutenants, informants | Leads to relatives |
| Villain stash | Villain hideout | Defeating the villain's lieutenants | High + score |

### Map pieces

- A treasure map is a generated image: a crop of the world terrain around the site, drawn in a parchment style with a sprite overlay of landmarks (a dead tree, a rock, a shipwreck, a hut) and an X.
- The map is cut into N pieces. Each piece reveals part of the crop. The player sees the pieces in a journal and can align them.
- One piece holds the location name (the region or nearest town). Without it, the player must match the coastline by eye.
- Pieces are sold by old sailors in taverns, carried by captured captains, given as mission rewards and found in villain hideouts.

### Digging

- The player lands, marches to the believed spot and digs. Each dig costs 1 day and a small chance of fever. Changed 2026-10-10 (built): a dig is a half-day from the ship, close inshore (G), and there is no fever yet; the march inland waits for landfall.
- Landmark sprites exist on the world map at the site, so a careful reader can find it.
- ~~Dig radius tolerance is 2 tiles on normal difficulty, 1 tile on hard.~~ Decided 2026-10-10: one tolerance for everyone, 2 tiles (treasure.json dig.toleranceTiles).
- Treasure found is added to the voyage pool (crew share applies), except family items and villain clues.

### Lost cities

- Lost cities are hidden settlements inland. They show on the map only after the final piece is found or the city is reached by land.
- Reaching one needs a long march, often through jungle, with native encounters and a food check. Rewards are large and score points.

### Generation rules (data)

- `treasure_rules.json` sets counts per era, value ranges, piece counts, which landmark sprites fit which terrain and where pieces may spawn.
- Generation must be deterministic from the world seed and the event that created the treasure, so any map can be reproduced for debugging.

Built so far: pirate hoards only (section 12, slices 3 and 4; `treasure.json` rather than `treasure_rules.json`): a famous pirate's hoard, placed when its first piece comes, 4 pieces to a map, from prisoners, survivors and the tavern's shady stranger; the maps in the captain's log (L); search rings on the chart; G digs within 2 tiles of a beach for half a day, finding the hoard within 2 tiles; its landmark stands on the coast in 3D. Wrecks, lost cities, family clues and villain stashes wait.

## 11. Romance

Each governor may have one adult daughter (or son, configurable), generated per game with a name, looks tier (plain, attractive, beautiful) and personality. Romance is a relationship meter per character, raised by fame, gifts, deeds and a dancing minigame, and lowered by neglect and hostility to her nation. Marriage gives score, a home port and a stream of useful information.

### Relationship stages

| Stage | Unlocked by | What the character gives |
|---|---|---|
| Stranger | Visiting the governor with rank or fame | Nothing |
| Acquainted | First audience | Rumours about the town |
| Admirer | Dance success + a gift | Warnings about villains, hints on treasure pieces |
| Sweetheart | Repeated visits, deeds for her nation | Map pieces, family clues, a key item |
| Betrothed | Rescue event or high meter | Wedding scheduled |
| Married | Wedding at her town | Home port, spouse's standing added to retirement score |

### Dancing minigame

- A rhythm minigame: the partner signals the next step with a hand gesture; the player matches direction on a beat.
- Tempo and step patterns come from `dances.json`. Missed steps lower the meter; streaks raise it.
- Doing well at a governor's ball also lifts the governor's view of the player.

### Events

- **Kidnapping.** A rival or villain kidnaps a sweetheart. A rescue mission spawns with a ship to hunt or a fort to storm.
- **Rival suitor.** A named NPC captain competes. Beating him in a duel or at sea removes him.
- **Gifts.** Jewellery and luxuries bought or plundered raise the meter; the effect is larger for rare items.
- **Neglect.** If the player does not visit for a set number of months, the meter decays and she may marry someone else (news event).

### Constraints

- One marriage per career. Relationship with other characters freezes after marriage.
- If the player sacks the spouse's town or wars on her nation, the relationship takes large penalties.
- All content stays PG: courtship, dancing, rescue, marriage. No explicit content.

## 12. Global politics

Four nations run a diplomacy simulation on a monthly tick: each pair has a relation of war, peace or alliance, driven by tension scores and random European events. Towns, fleets and governors react to the current state. The player's reputation with each nation, plus letters of marque, decides who welcomes them and who hunts them.

### Nations

| Nation | Strengths | Starting posture (1660 era example) |
|---|---|---|
| Spain | Most towns, treasure fleets, strong forts | Rich, stretched thin, hostile to all |
| England | Fast growth, privateer friendly | Expanding, aggressive |
| France | Buccaneer bases, Hispaniola presence | Opportunistic |
| Netherlands | Trade, merchant fleets, good prices | Commercial, rarely at war |
| Pirates (faction) | Havens, raids on all | At war with every nation |

Nation traits (fort quality, navy size, aggression, tolerance of pirates) are data per era.

### Diplomacy model

- Each nation pair holds a tension value (0 to 100). It rises from border raids, trade competition and player actions under that nation's flag; it decays slowly.
- Monthly, the sim rolls state changes: tension above 70 has a chance to trigger war; below 30 at war has a chance to trigger peace.
- Scripted "European events" (treaties, royal marriages, wars at home) shift tension from `political_events.json`, timed by era.
- At war: nations raise fleets, send expeditions against enemy towns, and governors pay bounties on enemy ships.
- Built (`@corsair/systems-politics`, `politics.json`): war or peace per pair with a tension. 1660 opens with Spain at war with England and France in the Caribbean ("no peace beyond the line"), so privateering is open from the first day; the Dutch are at peace with all. Each month the historical events due fire (the Second and Third Anglo-Dutch Wars, Devolution, the Franco-Dutch War, the Treaty of Madrid, the Nine Years' War), tension drifts toward each pair's base in peace and wears down toward 30 in war, and high or low tension may tip into war or peace. Every declaration and treaty is news from the nation's capital. Pirates are at war with everyone. Expeditions against towns and tension from the player's actions wait; there are no alliances yet.

### Player reputation

- Per nation, -100 to +100. Earned by attacking that nation's enemies, completing missions, handing over towns. Lost by attacking its ships and towns.
- Thresholds: wanted (-50 and below; hunters sent, entry refused), unwelcome, neutral, trusted, honoured.
- A bounty on the player's head grows with crimes. Pirate hunters spawn with strength scaled to the bounty.
- Amnesty: during peace or a new-king event, governors may offer a pardon for a fee.
- Built: pirate pressure per nation. Each merchant pirates take from a nation adds 8; it fades to three quarters monthly; crossing 40 is news ("Pirates plague the Spanish trade") and raises that nation's pirate bounty.

### Letters of marque and titles

- A letter of marque is a licence to attack ships of named enemies. It makes those attacks legal (reputation gain, no bounty from the issuer).
- Built: the governor (towns and cities; hamlets and havens have none) sells a letter while his nation is at war: 800 gold at neutral standing, falling to free at standing 30, refused at -30. It covers whoever the issuer is at war with at the time, so peace ends it without revoking it. An attack under it earns 6 standing with the issuer (the victim's nation still loses 20). Every win at sea is a deed; any governor pays for pirates (150 gold, more under pirate pressure) and for ships of his nation's current enemies (120 a merchant, 400 a warship); deeds he won't pay wait for another governor, and lapse after ten weeks. Titles and promotion wait.
- Titles per nation: Ensign, Captain, Major, Colonel, Admiral, Baron, Count, Marquis, Duke. Each gives a land grant and better prices in that nation's towns.
- Promotion requires points earned from deeds against that nation's current enemies. A peace treaty stalls promotion until the next war.

### Pirate faction and villains

- Named pirate captains (about 10, generated from name tables) roam, raid and bury treasure. Their fame is tracked on a leaderboard the player can see.
- The main villain is a noble tied to the family backstory. He moves between hideouts and is found through clues.
- Defeating pirate captains raises fame and removes them; their haven may lose power.
- Built (famous pirates, slice 1 of `docs/design/famous-pirates-and-treasure.md`): ten real buccaneers of the 1660s
  (`pirates.json`) sail from the three havens over and above the traffic population, in their own classes with full
  veteran crews (morale 90 in battle), lying in wait on the lanes to their haunts. Each ship one takes adds its purse
  and cargo at base price to his wealth, and is news by his name. Beating one puts half his wealth in the plunder
  chest and gives a point of fame; beaten by anyone, he keeps a fifth of the rest, lies low 90 days and sails again
  in a new ship. A taken ship of his is a prize under her own name. The tavern shows the Top Ten by wealth, the
  captain ranked by purse and plunder chest.
- Built (captured captains, slice 2): a famous pirate taken (boarded or struck, not sunk) is the captain's prisoner,
  and the plunder screen settles him with one click each, every choice explained. Ask about his hoard (the default):
  a piece of his hoard's map (4 to a map, keepsakes). Hold him for a bounty: any governor pays 1,500 gold and his
  nation +10 standing; he stays in irons until handed over, then sails again after his time in jail. Set him free:
  +10 crew morale, and he leaves the captain be when he sails again, until fired on. The Top Ten shows pieces held
  and prisoners.
- Built (treasure maps, slice 3; `treasure.json`): a hoard is placed when its first map piece comes, on a coast
  6 to 30 tiles from one of the pirate's haunts, clear of towns, by a landmark, holding 40% of his wealth. Pieces
  come from a prisoner asked about his hoard, a survivor picked up when one sinks (35%), and the shady stranger, who
  sits in a town's tavern some weeks and sells a piece for 15% of the hoard's worth (likelier while a map is
  unfinished, and for pirates whose waters are near). The captain's log (L at sea, time stops) holds the Top Ten
  and the Maps: each map a parchment drawn from the real coast, a quarter per piece (the hoard's own quarter first,
  the X from the third piece), with its worth, the port it lies near and, from the second piece, its landmark; one
  click plots a course to the search ring. The chart rings each search area, 40 tiles across with one piece down
  to 8 with four.
- Built (digging, slice 4): inside a map's search ring and within 2 tiles of a beach, G ("go ashore and dig"; D
  already steers) heaves to and puts the men ashore; half a day passes. Within 2 tiles of the hoard it comes up:
  its gold to the plunder chest (out of the pirate's wealth), +1 fame, and news. A miss inside the ring has the men
  name the landmark, which way it lies and how far. Dug up before its pirate was ever beaten, he swears revenge
  (news, and "hunting you" on the Top Ten): he comes for the captain at any odds and from half as far again, until
  beaten. In 3D each held map's landmark stands on its coast (a lone palm, three palms, a split rock, a wrecked hull,
  a ruined hut, a cairn), with a dug pit once found. Each famous pirate flies her own flag at sea and in battle (pirates.json). Not yet: items in hoards.

## 13. News and events

The news system turns simulation events into things the player learns about, with delay and distortion by distance. A town fall in Cartagena reaches Port Royal weeks later, maybe exaggerated. Scripted and random events use one event engine defined in `events/*.json`.

### Two kinds of event

- **World facts.** Emitted by systems as they happen: `WarDeclared`, `TownCaptured`, `FleetSunk`, `StormFormed`, `GovernorReplaced`, `TreasureFleetDeparted`, `PirateRetired`, `DaughterMarried`. These are ground truth, stored in the event log.
- **Narrative events.** Triggered by conditions and presented to the player: a messenger at sea, a tavern tale, a mutiny warning, a kidnapping. Each has a trigger, weights, choices and effects.

### News propagation

- Each world fact creates a news item with an origin settlement.
- News spreads along trade routes and ship traffic at ship speed, plus a random delay. A town "knows" an item when it arrives.
- When the player visits a town, the tavern and governor present items that town knows and the player has not seen.
- Distortion: the further news travels, the higher the chance that numbers are rounded up or details change ("a fleet of 12 sails" becomes "20"). Truth is kept in the log for debugging.
- A news ticker on the world map shows items brought by passing friendly ships.
- Built: market shocks are the first world facts with news. An item is known at once in its own town and reaches others at 80 tiles a day (a little slower than a brig) plus a seeded 0 to 3 day delay; arrival is computed from distance, not stored per town, and items are forgotten after 10 weeks. No distortion yet, and no ticker yet. Text comes from templates in `economy.json` until `text/<lang>.json` exists.

### Narrative event definition

Each event is data:

- `trigger`: condition expression over game state (for example `player.fame > 40 && nation.spain.atWarWith.england`).
- `weight` and `cooldown` so events do not repeat too often.
- `text` with template slots (`{governor.name}`, `{town.name}`), localisable.
- `choices`: each with requirements and a list of `effects` (add gold, change reputation, spawn ship, start minigame, reveal map piece).

### Event examples

| Event | Trigger | Effect |
|---|---|---|
| Treasure fleet sighted | Season + Spanish fleet at sea within 30 tiles | Marker of fleet route for 10 days |
| Governor's ball | Player trusted + town has daughter | Dance minigame |
| Deserter offers map | Tavern visit, fame > 20 | Buy a treasure piece |
| Plague in port | Random, town population > 3,000 | Services closed, crew fever risk |
| Amnesty proclaimed | New-king political event | Pardon offer in that nation's towns |
| Villain spotted | Clue count threshold | Villain ship spawns with a lead |

### Design rules

- Every narrative event must reference only state that exists, checked by a data validator at build time.
- Effects go through the same command API as player actions, so events cannot bypass rules.

## 14. Technical architecture

The game is a TypeScript web app with a hard wall between a pure, deterministic simulation core and everything that draws or listens to it. The core runs in the browser, in a Web Worker, or in Node with no changes. Rendering, UI and tooling only read state and events and send commands.

**Architecture (diagram):** Presentation layer (Three.js sea renderer, PixiJS harbour scenes, Preact UI, input adapters) sends commands down and receives events and state. Simulation core (pure TypeScript, no DOM): command bus → state store (plain data, saved) → event bus (typed world facts). Systems run in a fixed order each tick with seeded RNG: weather, navigation, economy, settlements, politics, news, AI captains, treasure, romance, career, crew, fleet. Minigame modules: sea battle, duel, land battle, dance, stealth, trade. Content packs (JSON + JSON Schema) are loaded and validated at boot. Observability, fed by the event bus: event log (JSONL), debug API (window.__corsair), replay (seed + input log), invariants (checked every tick), headless runner (Node).

The renderer never mutates state. Every change enters through the command bus and leaves as an event, which is what makes replay and headless testing possible.

### Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One language for core, UI, tools and tests |
| Rendering | Three.js for the sea map and battles (`@corsair/render3d`, the only sea renderer); PixiJS v8 for the illustrated harbour scenes only (`@corsair/render`) | Three.js is the most established 3D library on the web, reads glTF ship models and fits TypeScript; no engine lock-in |
| UI | Preact + CSS over the canvas | Menus, journal, trade screens are easier as DOM |
| Build | Vite, pnpm workspaces | Fast dev loop, one package per module |
| Data validation | JSON Schema + Ajv (or Zod generating schema). Built: Zod schemas (`packages/data/src/schemas.ts`) | Validate content at build and at boot |
| Tests | Vitest (core), Playwright (browser end-to-end through `window.__corsair`, on the Mac's GPU so the 3D view renders fast: `playwright.config.ts` launch args) | Core tests run in milliseconds in Node |
| Audio | Web Audio API directly (`@corsair/audio`) | Ambience is synthesised and follows the game continuously, and music is sequenced live from note data, both of which need the raw API rather than Howler.js's sprite-sheet playback |
| Saves | IndexedDB + JSON file export | Save is a serialised state snapshot plus version. Built: one career slot, autosaved on docking and on Ctrl+S; it holds the format version, a fingerprint of the gameplay content (everything but music and sprite framing; a mismatch warns but still loads), the seed and the state. A start screen offers Continue, New career and file save/load when a career is stored. A save that can't be read still gets the start screen, with the reason, Continue disabled and Save to file kept, so it is never silently overwritten; `?seed=N` starts a known world |
| Packaging (later) | Tauri wrapper for desktop stores | Same web build, ships to Steam or itch.io |

Phaser is a reasonable alternative to PixiJS if a full engine is wanted. The design keeps the core engine-free either way.

### Modules (pnpm packages)

- `@corsair/core`: state store, command bus, event bus, clock, seeded RNG (xoshiro128**, named streams), system scheduler.
- `@corsair/systems-*`: one package per system (weather, navigation, economy, settlements, politics, news, ai-captains, treasure, romance, career, crew, fleet).
- `@corsair/minigame-*`: sea-battle, fencing, land-battle, dance, stealth, trade. Each exports `init(snapshot, params)`, `step(input)`, `result()`.
- `@corsair/data`: loaders, schemas, content-pack merging (base game + mods).
- `@corsair/render`: the harbour scenes behind the port screens (PixiJS): layers, flag, the player's ship at anchor, day/night palette.
- `@corsair/render3d`: the 3D sea map and sea battles (Three.js), the only sea renderer: the sea, islands from the elevation map, towns, ships built in code from each class's plan, sky, camera; shot, smoke and wreckage in battle.
- `@corsair/ui`: Preact screens.
- `@corsair/devtools`: debug API, inspector overlay, event log viewer.
- `@corsair/sim-runner`: Node CLI for headless runs, soak tests and balance reports.
- Built so far: `@corsair/core`, `@corsair/data`, `@corsair/audio`, `@corsair/render`, `@corsair/render3d`, `@corsair/systems-economy`, `-navigation`, `-politics`, `-traffic` (AI ships, famous pirates, treasure) and `-weather`, `@corsair/minigame-sea-battle`, and the game itself in `apps/web` (`@corsair/web`, Preact screens). UI, devtools and the sim runner are not separate packages yet.

### State and systems

- State is plain serialisable data: entity tables keyed by id (ships, captains, settlements, fleets, treasures, characters) plus global tables (nations, relations, markets, weather).
- Systems are pure functions of the form `(state, ctx) => { mutations, events }` over their own slice. The scheduler applies mutations in a fixed order.
- No `Math.random`, no `Date.now` inside the core. Time comes from the game clock and randomness from named RNG streams (one per system), so adding a random call in one system does not shift another's results.
- Minigames run their own fixed-step sub-simulation and return a result object. The core applies that result as commands.

### Sprites and assets

Full art production spec, frame budget and tooling: see `docs/project-corsair-art-pipeline.md`.

- Texture atlases built with a packer (free-tex-packer or TexturePacker) into JSON + PNG. Sprite and animation names are referenced from game data, so art can change without code changes.
- Target resolution: 960 x 540 logical, pixel-art style, integer-scaled with nearest-neighbour: 2x at 1080p, 4x at 4K. At 1440p it shows at 2x with borders, which keeps the integer-scaling rule. This was 480 x 270; the player wanted to see more of the world without losing pixel fidelity, and chose finer art over a smaller view. Every pixel size grew 1.5x to match. Since 2026-10-10 this holds for the harbour scenes only; the 3D sea fills the window at its full resolution.
- Ships: 32 facings on the world map, 16 in combat. Characters in duels: side-view frame animations per move.
- Tile art: autotile sets for coast, reef and jungle.

### Performance targets

- 60 fps world map on a 2020 mid-range laptop with 150 AI ships active.
- Core tick under 2 ms on the world map. If needed, the core moves to a Web Worker and posts state diffs.
- Initial load under 10 MB; content packs lazy-loaded by era.

## 15. Data-driven design

All content and balance lives in versioned JSON files with a JSON Schema per file type. Code holds rules; data holds numbers, names, curves, tables and scripts. A build step validates every file, checks cross-references, and fails the build on any broken id.

### Content pack layout

```
content/
  base/
    manifest.json          # pack id, version, depends-on, load order
    eras/1560.json ... 1680.json
    nations.json
    settlements.json
    forts.json
    goods.json
    ships.json
    upgrades.json
    skills.json
    difficulty.json
    combat/guns.json  combat/hit_tables.json  combat/ai_profiles.json
    fencing_moves.json
    land_units.json
    dances.json
    currents.json
    routes.json
    treasure_rules.json
    events/*.json
    political_events.json
    names/*.json           # name tables for captains, governors, daughters, ships
    text/en.json           # all player-facing strings
    sprites/atlas.json     # sprite and animation ids
    maps/caribbean/        # terrain.png, elevation.png, zones.png, settlements.json, weather.json, wind_zones.json, regions.json, features.json
  schemas/*.schema.json
```

### Rules for data

- Every record has a stable string `id` (`ship.frigate`, `town.port_royal`). References use ids, never array positions.
- No player-facing text in records; records hold text keys resolved from `text/<lang>.json`.
- Curves and tables are data (polar curves, hit tables, price elasticity), never code constants.
- Mods and balance variants are packs that override or extend by id. Load order is set in the manifest.
- A save stores the pack ids and versions it was made with. Loading warns on mismatch.

### Example: ship class

```json
{
  "id": "ship.brig",
  "family": "brig",
  "nameKey": "ship.brig.name",
  "rig": "square",
  "guns": 18,
  "maxCrew": 150,
  "minCrew": 30,
  "cargo": 100,
  "speed": 8,
  "turn": 6,
  "draft": 2,
  "hull": 85,
  "polar": "polar.square",
  "price": 6500,
  "eras": ["1620", "1640", "1660", "1680"],
  "sprites": { "world": "brig_world", "combat": "brig_combat" }
}
```

### Example: settlement

```json
{
  "id": "town.port_royal",
  "nameKey": "town.port_royal.name",
  "type": "colonial_town",
  "tile": [912, 488],
  "region": "region.windward_passage",
  "eraOverrides": {
    "1660": { "owner": "nation.england", "population": 6500, "fort": "fort.stone_3" }
  },
  "economy": {
    "produces": { "good.sugar": 40 },
    "consumes": { "good.luxuries": 12, "good.food": 60 }
  },
  "services": ["governor", "tavern", "merchant", "shipwright", "bank", "surgeon"],
  "governorTemplate": "gov.template.ambitious",
  "harbourScene": "scene.harbour.english_large"
}
```

### Example: narrative event

```json
{
  "id": "event.deserter_map",
  "trigger": "location.type == 'tavern' && player.fame >= 20 && !player.flags.deserter_seen",
  "weight": 3,
  "cooldownDays": 120,
  "textKey": "event.deserter_map.text",
  "choices": [
    {
      "textKey": "event.deserter_map.buy",
      "requires": "player.gold >= 500",
      "effects": [
        { "type": "addGold", "amount": -500 },
        { "type": "giveMapPiece", "treasure": "@nearest_unfound" },
        { "type": "setFlag", "flag": "deserter_seen" }
      ]
    },
    { "textKey": "event.deserter_map.refuse", "effects": [] }
  ]
}
```

### Trigger and effect language

- Triggers use a small, safe expression language (a parsed subset with comparisons, boolean logic and dotted state paths), not `eval`.
- Effects are a closed list of typed commands (`addGold`, `changeReputation`, `spawnShip`, `startMinigame`, `giveMapPiece`...). Each maps to a command on the command bus.
- The validator type-checks trigger paths against the state schema and flags unknown fields at build time.

### Tooling

- `pnpm data:validate`: schema + cross-reference check (to run in the `pnpm verify` gate and on file save). Not built as a script yet: content is parsed against its Zod schemas whenever it loads, at boot and in the unit tests (`packages/data/test/content.test.ts`).
- `pnpm data:report`: prints derived tables (ship value per gun, price ranges per town) for balance review.
- A simple in-browser data editor for ships, goods and events is a v1.1 goal.

## 16. Observability, testing and diagnostics

Any game state must be reproducible from a seed, a content-pack version and an input log, and inspectable as structured data. That lets an AI agent (or a human) run the game without a screen, query what happened, and prove a fix with a test. No feature is done until a scenario test shows it working.

### Determinism contract

- Same seed + same packs + same commands = same state hash at every tick, in browser and Node.
- Fixed-step simulation. Floating point limited to operations that behave the same across engines; state hashing uses rounded values.
- Named RNG streams per system. The verify gate runs a 20-year headless career twice before a merge and fails if hashes diverge.

### Event log

- Every command and world fact is written as one JSON line: `{ tick, day, type, system, entityIds, payload }`.
- Kept in a ring buffer in the browser (last 50,000 events), streamed to file in headless runs.
- Queryable: `corsair log --type TownCaptured --since day:4000 --entity town.port_royal`.

### Debug API (same surface in browser, CLI and MCP)

| Call | Returns / does |
|---|---|
| `state.get(path)` | Any slice of state as JSON (for example `settlements.town.havana.market`) |
| `state.hash()` | Hash of full state, for divergence checks |
| `sim.step(n)` / `sim.runUntil(expr)` | Advance ticks, or until a condition is true |
| `cmd.send(command)` | Send any player command (sail to, attack, trade, dig) |
| `scenario.load(file)` | Load a JSON test setup (fleet, position, date, relations) |
| `log.query(filter)` | Filtered event log |
| `snapshot.save()` / `load()` | Full state snapshot for bug reports |
| `render.screenshot(view)` | PNG of a named view (browser and Playwright only) |
| `inspect(entityId)` | Entity plus its recent events and derived stats |

In the browser this is `window.__corsair`. In Node it is the `corsair` CLI with JSON output. An MCP server wraps the same calls so Claude can drive a live or headless game, query it and read results directly.

### Scenario tests

- A scenario is JSON: starting state overrides, a list of commands, and assertions.
- Example: "Brig vs frigate, wind fresh from the east, player to windward" with the assertion "frigate win rate between 60% and 80% over 500 seeds".
- Example: "Capture a convoy bound for Havana" with the assertion "Havana sugar price rises by at least 10% within 60 days".
- Scenarios live next to the system they test and run with Vitest in the verify gate.

### Verify gate

There is no CI. A merge to main is gated on a local `pnpm verify` run: typecheck, unit tests (including the determinism and replay tests), production build, and Playwright end-to-end tests that drive the game through `window.__corsair`. The end-to-end tests run on the Mac's GPU (Metal, set in `playwright.config.ts`), since the game is drawn in 3D.

### Invariants (checked every tick in debug builds)

- No negative gold, crew, stock, hull or food.
- Every ship sits on a tile its draft allows (or is flagged aground).
- Every id reference in state resolves.
- Town owner is always a valid nation or faction; relations are symmetric.
- Total gold in the world changes only through defined sources and sinks (a ledger check).
- A violation pauses the sim, dumps a snapshot and the last 500 events, and fails the test.

### Headless runs and balance reports

- `corsair soak --careers 1000 --years 25 --policy aggressive_privateer` plays full careers with scripted AI player policies.
- Output: CSV and JSON reports on gold curves, fame curves, town ownership over time, war frequency, treasure found, deaths and mutinies.
- Report flags outliers: a ship class nobody wins with, a town that never changes hands, an event that never fires, a price that hits a clamp.
- Property-based tests (fast-check) fuzz command sequences to find crashes and invariant breaks.

### Bug report bundle

- One key in the game (F9) saves: seed, pack versions, input log, latest snapshot, last 2,000 events and a screenshot.
- `corsair replay bundle.zip --until tick:81234` rebuilds the exact moment for inspection.
- Every fixed bug gets its bundle turned into a regression scenario.

### In-game dev overlay

- Toggle with a key in dev builds: entity inspector on hover, AI intent lines for ships, wind and current vectors, market prices per town, fog of war off, time controls down to single ticks.

### Working rules for AI-assisted development

- A task is closed only with a passing scenario or invariant that fails without the change.
- Agents query the debug API and event log to confirm behaviour; screenshots confirm rendering. A claim without that evidence is not accepted.
- Balance changes go through the soak report: before and after numbers attached to the change.

## 17. Milestones, metrics, risks and open questions

Build the observability and headless tooling first, then add gameplay in vertical slices, each closed by a measurable gate. Dates are left open until M0 shows real velocity.

**Roadmap (diagram):**

1. **M0 Foundations** — core, data pipeline, debug API, headless runner, `pnpm verify` gate. *Gate: 20-year run replays with identical hashes.*
2. **M1 Sailing and trade slice** — world map, navigation, weather, 5 towns, trading, saves. *Gate: sail, trade and save loop holds for 30 min.*
3. **M2 Combat slice** — sea battle, boarding, fencing, 4 ship classes. *Gate: matchup win rates inside target bands.*
4. **M3 Living world** — economy sim, settlements, politics, news, AI captains. *Gate: 1,000 soak careers, zero invariant breaks.*
5. **M4 Career content** — all ships, forts, land battle, treasure, romance, family quest. *Gate: full career playable start to retirement.*
6. **M5 Polish and release** — art pass, audio, balance from soak reports, tablet input.

Each gate is a scripted check from section 16, except the M1 fun check, which is a playtest.

### Success metrics

| Metric | Target |
|---|---|
| Determinism | 100% identical hashes on replay across Chrome, Firefox, Safari and Node |
| Test coverage of rules | Every system has scenario tests; every fixed bug has a regression scenario |
| Performance | 60 fps world map with 150 AI ships; core tick under 2 ms |
| Load time | Under 5 s to title screen on broadband |
| Session length (playtest) | Median sitting 25 min or more |
| Career completion (playtest) | 30% of testers reach retirement at least once |
| Balance | No ship class under 5% use in mid-game soak runs; no event with zero fires per 100 careers |

### Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Determinism breaks from float differences across browsers | Replay and tests become unreliable | Fixed-point or rounded maths in core; cross-engine hash test in the verify gate |
| Scope creep across six minigames | Nothing gets polished | Vertical slices; cut stealth and dance to simple versions if M4 slips |
| Art budget for sprites | Delays or inconsistent look | Low logical resolution, limited palette, atlas pipeline from day one |
| Balance drift as systems interact | Degenerate strategies (trade loops, fort farming) | Soak reports and outlier flags on every change |
| IP or trademark confusion with the original | Takedown or store rejection | Original names, art, text and title; legal check before public release |
| AI agents overbuilding or drifting from design | Rework | Small tasks with scenario tests as acceptance; debug API as the proof |

### Open questions

- Should the player be allowed to turn captured towns into pirate havens, or only sack and hand over?
- Only the flagship fights (classic), or allow a second ship in sea battles later?
- Land battles: turn-based tactical (current plan) or real-time with pause?
- Is the romance target a daughter only, or configurable at career start?
- One continuous map at 24 px tiles, or chunked streaming for a larger map later?
- Release path: free web build, paid itch.io build, or Steam via a desktop wrapper?
