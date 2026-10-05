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
- 3D graphics. The game is 2D sprites and tiles.
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

- One world-map day is 540 ticks, which is 18 real seconds at normal speed (`calendar.json`). A day lasts about as long as a brig's real day's run on the real-scale map, so voyage lengths and seasons stay believable.
- Voyage pace: a brig makes about 6 tiles a second on a fresh broad reach, so Havana to Cartagena takes about 2 real minutes.
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

### Day and night

- A 24-hour cycle tinted by a palette shader over the sprites.
- Night lowers sight radius by half and allows stealth town entry and surprise attacks.

### Rendering

- Terrain drawn as an autotiled tilemap from a sprite atlas (Wang or blob tiles for coastlines).
- Until the autotile set exists, the renderer paints terrain procedurally from the palette. Coasts are smooth contours blended between tile centres, and relief is shaded from elevation. Collision stays on the tile grid.
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

### Supplies and crew morale

- Food: consumed per crew member per day. Shown as days remaining. At zero, morale falls fast and crew desert at the next landfall.
- Morale (0 to 100) is driven by: days since last pay-off, gold per head, food, recent victories, losses and captain fame. Thresholds trigger events: grumbling, desertion, mutiny.
- Mutiny is a scripted event: the player fights a duel with the ringleader or pays off. Losing means marooning and a restart from a small boat.
- Pay-off (dividing the plunder) resets morale and ends the voyage. Crew may leave if their share was poor.

### Landfall and exploration

- The player can land on any beach tile. The ship anchors; the party goes ashore with a chosen crew count.
- On land: march speed by terrain, food carried, fever risk, native encounters, ambush events.
- The party can dig at a marked spot, approach a town by land, or scout a fort.

### Encounters at sea

- Ships within sight radius can be hailed, shadowed, attacked or avoided.
- Hailing shows nationality, class, and a hint of cargo or passengers (a governor's daughter, a villain lieutenant, a treasure galleon's pay chest).
- The player can fly false colours if the flag skill or an item allows it. The AI checks disguise against its own vigilance stat.

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
  - 11 traditional public-domain tunes in `content/music.json`, arranged for fiddle, whistle, plucked bass, harp and drums, and sequenced live over CC0 instrument samples.
  - Under full sail at speed the full band plays a lively shanty. Easier sailing gets a gentle tune with fewer instruments, and night gets a slow air. Storms have no music, only wind and thunder.
  - Tunes rotate with 25 to 50 seconds of quiet between them.
  - Only traditional tunes are used: modern songs, including instrumental versions of them, are still in copyright.
- **Sea life** (renderer-only, rare events):
  - dolphins riding the bow at speed in open water
  - flying fish bursting from the bow by day
  - distant whales spouting and showing their flukes
  - pelicans and frigatebirds near coasts
  - the odd fish jumping
- **Controls:** V mutes all sound, N toggles the music. Sound starts on the first key press, as browsers require. Elsewhere: E enters a port in reach or sets sail, Esc puts the market away to show the harbour, = and - set time acceleration, Ctrl+S (Cmd+S) saves.
- **Day and night** is a palette swap through dusk and night rows (art pipeline section 6). A new game starts at 08:00.

### Quality of life

- Time acceleration (1x, 2x, 4x) in open water, auto-paused when anything enters sight. Built: = and - pick the speed; it holds at 1x near land, in a storm and in port. Dropping to 1x when a sail comes into sight waits for encounters.
- Click-to-sail autopilot that routes around shallows for the current fleet draft.
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
- **Governor**: a named character with personality traits, a daughter (maybe), and an agenda.

### Town services

- **Governor's mansion.** Missions, letters of marque, titles and land grants, rewards for enemy ships and pirates sunk, romance (section 11). Needs acceptable reputation.
- **Tavern.** Recruit crew (count scales with fame and town size), buy rumours, meet informants and old sailors selling map pieces, hear news. Built: news only. The tavern lists what the town has heard, newest first, marks what is new to the captain, and the tab shows a count of new items; heard rumours also show on the sea chart's port card.
- **Merchant.** Buy and sell goods, cannon, food. Prices from the local market (section 6). Built: goods (cannon to come with the shipwright). E docks within 3 tiles (about 7.5 km) of a town; world time stops in port. The captain remembers each market's prices from the last call, and hovering a port on the sea chart shows them with their age. What each port exports and wants is common knowledge, shown on its market and on the chart. Market rows tag goods "buy here" or "sells well", show the average cost of cargo in the hold against today's price, and name the best sale price seen in another port, flagging the per-unit profit when buying here and selling there pays. The chart's goods filter colours every port by whether it makes or needs a good and adds the last-seen price where the captain has called.
- **Shipwright.** Repair hull and sails, buy upgrades (copper sheathing, cotton sails, fine-grain powder, chain shot, bronze cannon), sell ships.
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

Built: 13 compositions (four nations x small, medium and large, plus the pirate haven) from `tools/art/render_harbours.py`, with `harbours.json` giving layers, building hotspots, the flag point and the anchorage. Hamlets use small, towns medium, cities large. The game flies the owner's flag, moors the player's ship, and draws the scene under the day/night palette. Buildings are clickable; only the merchant is open so far.

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

### Production and consumption

- Weekly tick: S += production - consumption, clamped. Production scales with population and a random harvest factor. Built as recovery: each week S closes 25% of the gap to its usual stock, times a harvest of 0.8 to 1.2, capped at 3x usual.
- Hurricanes, raids and disease cut production for a number of weeks.
- Built as market shocks (`economy.json` shocks): a bumper harvest (an export goes cheap), blight (an export goes scarce), shortage (a want pays well) and storm damage (every export of a town a storm's eye passes over). About 0.6 start a week across the map; each lasts 4 to 8 weeks, jumps the market most of the way at once and keeps pulling it while it lasts. A shock moves the usual stock, never the cap. Raids, disease and war wait for those systems.

### Merchant traffic

- AI merchants plan routes with a simple arbitrage rule: buy where p is lowest in reach, sell where it is highest, weighted by risk (known pirate activity).
- Nations run scheduled fleets: the Spanish treasure fleet and the Silver Train (a land convoy) carry silver on fixed seasonal routes in `routes.json`.
- Captured cargo removed from a merchant never arrives, so the destination's stock drops. The player can observe this in the data (section 16).

### Plunder and crew shares

- Gold, goods and ships captured go into the voyage pool.
- At pay-off, the crew take a share (difficulty-based, 30% to 70%), split per head. The captain's share goes to personal wealth.
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

### Hull fouling

Ships slow by up to 20% over months at sea unless careened at a shipwright or on a beach (costs days). This pushes the player back to port.

### Capturing ships

- Any ship taken by boarding joins the fleet with its cargo and damage.
- The player can move the flag to a new flagship at any time in port or after battle.
- Sale price at a shipwright = base value x condition x local demand.

### Sprites

Each class has a world-map sprite (32 directions, 96 x 96) and a combat sprite (16 directions, 192 x 192), both drawn from a 45° camera, with frames for sails furled, half and full, damage overlays, and a sinking animation.

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
- **Boarding.** On contact, crew ratio and morale decide who fights. It moves into the fencing duel.

### 9.2 Boarding and fencing duel

- A side-view duel between captains, with crews fighting in the background.
- Three attacks (high, middle, low) and three matching parries, plus a dodge/jump. Each move has wind-up frames, active frames and recovery, defined in `fencing_moves.json`.
- Crew strength shifts the duel: a large crew advantage pushes the enemy back and speeds morale collapse; getting pushed to the rail or off the ship ends the fight.
- Weapons: rapier (fast, low damage), cutlass (balanced), longsword (slow, strong). Each is a stat block.
- Win: the ship is captured with cargo, crew may join, notable passengers are found. Lose: the player is captured, wounded or thrown in the sea (loses ship, keeps the rest of the fleet if any).

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

- The player lands, marches to the believed spot and digs. Each dig costs 1 day and a small chance of fever.
- Landmark sprites exist on the world map at the site, so a careful reader can find it.
- Dig radius tolerance is 2 tiles on normal difficulty, 1 tile on hard.
- Treasure found is added to the voyage pool (crew share applies), except family items and villain clues.

### Lost cities

- Lost cities are hidden settlements inland. They show on the map only after the final piece is found or the city is reached by land.
- Reaching one needs a long march, often through jungle, with native encounters and a food check. Rewards are large and score points.

### Generation rules (data)

- `treasure_rules.json` sets counts per era, value ranges, piece counts, which landmark sprites fit which terrain and where pieces may spawn.
- Generation must be deterministic from the world seed and the event that created the treasure, so any map can be reproduced for debugging.

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

### Player reputation

- Per nation, -100 to +100. Earned by attacking that nation's enemies, completing missions, handing over towns. Lost by attacking its ships and towns.
- Thresholds: wanted (-50 and below; hunters sent, entry refused), unwelcome, neutral, trusted, honoured.
- A bounty on the player's head grows with crimes. Pirate hunters spawn with strength scaled to the bounty.
- Amnesty: during peace or a new-king event, governors may offer a pardon for a fee.

### Letters of marque and titles

- A letter of marque is a licence to attack ships of named enemies. It makes those attacks legal (reputation gain, no bounty from the issuer).
- Titles per nation: Ensign, Captain, Major, Colonel, Admiral, Baron, Count, Marquis, Duke. Each gives a land grant and better prices in that nation's towns.
- Promotion requires points earned from deeds against that nation's current enemies. A peace treaty stalls promotion until the next war.

### Pirate faction and villains

- Named pirate captains (about 10, generated from name tables) roam, raid and bury treasure. Their fame is tracked on a leaderboard the player can see.
- The main villain is a noble tied to the family backstory. He moves between hideouts and is found through clues.
- Defeating pirate captains raises fame and removes them; their haven may lose power.

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
- Built: market shocks are the first world facts with news. An item is known at once in its own town and reaches others at 80 tiles a day (a little slower than a brig) plus a seeded 0 to 3 day delay; arrival is computed from distance, not stored per town, and items are forgotten after 10 weeks. No distortion yet, and no ticker until AI ships sail. Text comes from templates in `economy.json` until `text/<lang>.json` exists.

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

**Architecture (diagram):** Presentation layer (PixiJS renderer, Preact UI, input adapters) sends commands down and receives events and state. Simulation core (pure TypeScript, no DOM): command bus → state store (plain data, saved) → event bus (typed world facts). Systems run in a fixed order each tick with seeded RNG: weather, navigation, economy, settlements, politics, news, AI captains, treasure, romance, career, crew, fleet. Minigame modules: sea battle, duel, land battle, dance, stealth, trade. Content packs (JSON + JSON Schema) are loaded and validated at boot. Observability, fed by the event bus: event log (JSONL), debug API (window.__corsair), replay (seed + input log), invariants (checked every tick), headless runner (Node).

The renderer never mutates state. Every change enters through the command bus and leaves as an event, which is what makes replay and headless testing possible.

### Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One language for core, UI, tools and tests |
| Rendering | PixiJS v8 (WebGL/WebGPU) | Fast sprite batching and tilemaps; no engine lock-in |
| UI | Preact + CSS over the canvas | Menus, journal, trade screens are easier as DOM |
| Build | Vite, pnpm workspaces | Fast dev loop, one package per module |
| Data validation | JSON Schema + Ajv (or Zod generating schema) | Validate content at build and at boot |
| Tests | Vitest (core), Playwright (browser end-to-end through `window.__corsair`) | Core tests run in milliseconds in Node |
| Audio | Web Audio API directly (`@corsair/audio`) | Ambience is synthesised and follows the game continuously, and music is sequenced live from note data, both of which need the raw API rather than Howler.js's sprite-sheet playback |
| Saves | IndexedDB + JSON file export | Save is a serialised state snapshot plus version. Built: one career slot, autosaved on docking and on Ctrl+S; it holds the format version, a fingerprint of the gameplay content (everything but music and sprite framing; a mismatch warns but still loads), the seed and the state. A start screen offers Continue, New career and file save/load when a career is stored. A save that can't be read still gets the start screen, with the reason, Continue disabled and Save to file kept, so it is never silently overwritten; `?seed=N` starts a known world |
| Packaging (later) | Tauri wrapper for desktop stores | Same web build, ships to Steam or itch.io |

Phaser is a reasonable alternative to PixiJS if a full engine is wanted. The design keeps the core engine-free either way.

### Modules (pnpm packages)

- `@corsair/core`: state store, command bus, event bus, clock, seeded RNG (xoshiro128**, named streams), system scheduler.
- `@corsair/systems-*`: one package per system (weather, navigation, economy, settlements, politics, news, ai-captains, treasure, romance, career, crew, fleet).
- `@corsair/minigame-*`: sea-battle, fencing, land-battle, dance, stealth, trade. Each exports `init(snapshot, params)`, `step(input)`, `result()`.
- `@corsair/data`: loaders, schemas, content-pack merging (base game + mods).
- `@corsair/render`: PixiJS scenes, sprite atlas management, camera, tilemap.
- `@corsair/ui`: Preact screens.
- `@corsair/devtools`: debug API, inspector overlay, event log viewer.
- `@corsair/sim-runner`: Node CLI for headless runs, soak tests and balance reports.

### State and systems

- State is plain serialisable data: entity tables keyed by id (ships, captains, settlements, fleets, treasures, characters) plus global tables (nations, relations, markets, weather).
- Systems are pure functions of the form `(state, ctx) => { mutations, events }` over their own slice. The scheduler applies mutations in a fixed order.
- No `Math.random`, no `Date.now` inside the core. Time comes from the game clock and randomness from named RNG streams (one per system), so adding a random call in one system does not shift another's results.
- Minigames run their own fixed-step sub-simulation and return a result object. The core applies that result as commands.

### Sprites and assets

Full art production spec, frame budget and tooling: see `docs/project-corsair-art-pipeline.md`.

- Texture atlases built with a packer (free-tex-packer or TexturePacker) into JSON + PNG. Sprite and animation names are referenced from game data, so art can change without code changes.
- Target resolution: 960 x 540 logical, pixel-art style, integer-scaled with nearest-neighbour: 2x at 1080p, 4x at 4K. At 1440p it shows at 2x with borders, which keeps the integer-scaling rule. This was 480 x 270; the player wanted to see more of the world without losing pixel fidelity, and chose finer art over a smaller view. Every pixel size grew 1.5x to match.
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

- `pnpm data:validate`: schema + cross-reference check (runs in the `pnpm verify` gate and on file save).
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

There is no CI. A merge to main is gated on a local `pnpm verify` run: typecheck, unit tests (including the determinism and replay tests), production build, and Playwright end-to-end tests that drive the game through `window.__corsair`.

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
