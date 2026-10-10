# Career and combat model (design)

Proposed 2026-10-10, for review: nothing here is built yet. It answers three asks together, because they are one
problem: a combat model with meaningful upgrades, opponents that fight differently, and famous pirates of real and
ordered difficulty, all fitted to a career that starts in a brig and climbs by trade, refits, matched fights, prizes
and better ships, with clear objectives at every step. Judged against the pillars (best sailing, best combat,
Anno-style trading) and the UI rule (complex systems, simple screens, every number explained).

Background, all in this folder or `docs/reference/`:

- `combat-model-baseline.md`: how combat works today, with code references, the gaps, and the measured difficulty
  of every famous pirate against six player ships (100 seeds each).
- `../reference/naval-combat-history.md`: ships, guns, refits, boarding and captains of the 1650-1720 Caribbean
  (31 sources).
- `../reference/naval-combat-in-games.md`: how Pirates!, Black Flag, Naval Action and others build upgrades, enemy
  types and difficulty, and what players liked and hated.

## 1. Where we stand (measured)

- **The starting brig** (10 of 18 guns, 75 of 150 men, 1,000 gold) beats a pirate sloop about 26 times in 40;
  filled out (18 guns, 1,200 gold; men at 10 gold each) about 32.
- **A cliff, not a slope**: the starting brig meets a pirate about every second voyage; a fully armed brig meets
  none, because pirates only attack ships they rate weaker. Fighting dries up just as the player becomes able to
  fight.
- **Famous pirates are four opponents, not ten.** Captains of a class fight identically, seed for seed. A new brig
  loses 92% against the frigate trio (Morgan, l'Olonnais, Mansvelt), 62% against the brigantine trio, 47%
  against le Grand, 34% against the war-sloop trio; and all ten will attack her. Once she sails a frigate only the
  top three still come.
- **Fights against pirates are boarding coin flips.** Pirates fire only chain and grape, so the player's hull ends
  near 97% win or lose and iron scantlings change nothing; crew numbers and one boarding roll decide it.
- **No captain or crew quality, no gun types.** Every gun fires the same ball; accuracy is geometry only; morale
  touches only boarding; the enemy strikes at a flat 15% a second once beaten; the player never strikes.
- **Upgrades:** a full fit-out takes most classes from about 22 to 30 wins in 40 against their own kind; copper
  wins nearly every escape; three upgrades are anachronisms (copper sheathing 1761, cotton sails c.1809, iron
  scantlings late 18th century) and bronze cannon have the wrong effect (bronze was lighter and safer, not longer
  ranged).

## 2. The career ladder

The brig is the player's ship for the whole early game and a real choice later. Each rung has a ship state, the
opponents that come for her, what she can hunt, what it pays, and the objective that marks the next rung. Prices
are today's; the targets are what the model below must produce, measured by the battle probe before each slice
ships.

| Rung | Her state | Comes for her | She can take | Earns from | Next rung when |
|---|---|---|---|---|---|
| 1. Trader | Brig, 10 guns, 75 men, 1,000 gold | Bold pirate sloops (now and then) | Lone merchants, if she dares | Trade (about 300-400 a good run) | Full battery and crew (about 2,000) |
| 2. Armed trader | Brig, 18 guns, full crew | Pirate sloops and war sloops in pirate waters; famous bottom tier in their haunts | Merchants, pirate sloops | Trade, small prizes, pirate bounties (150) | First upgrades bought; a letter of marque |
| 3. Privateer | Brig, 2-4 upgrades, letter of marque | Pirate brigantines; enemy patrols in wartime; famous middle tier in their haunts | Enemy merchants and sloop patrols, pirates of her class | Prizes, bounties, sold prize ships | A prize or purchase of a better hull, or a full fit-out |
| 4. Hunter | Full-fit brig, a brigantine or royal sloop, or a frigate | Famous middle and top tier; pirate hunters if notorious | Convoys' escorts, famous pirates, Spanish warships | Famous pirates' wealth, hoards, convoys | A frigate and a second ship (fleet) |
| 5. Commodore | Frigate plus fleet | Top tier, treasure fleet escorts, ships of the line in war | Treasure fleets, anyone | The flota, fame, titles | Retirement, the Top Ten |

**Matched fights, by design:**

- **Target win rates** (a reasonable player, the probe's autopilot as stand-in): against her rung's usual
  opponent 65-80%; against the next rung's 30-45% (possible with skill, the weather gauge and a good plan); two
  rungs up 10-20% (an underdog win must stay possible: no level gates).
- **Opponents scale by water and notoriety, not by the player's own strength** (research: scaling to the player
  makes upgrades pointless and causes spikes). Each sea region has a danger tier: Jamaica's and the Leewards'
  coasts rung 1-2, the Windward Passage and Hispaniola rung 2-3, the Spanish Main rung 3-4, the treasure routes
  rung 4-5. Pirates and patrols spawn by the region's tier; the chart shades it ("pirate waters" already does
  part of this).
- **Fix the cliff**: pirates weigh *what she would yield against what she would cost them*, and a hungry or
  bold captain chances a fair fight. Her own rung's pirates still come for a filled-out brig, about one voyage in
  three in pirate waters; a weak sloop still leaves her be.
- **Famous pirates by rung**: a captain hunts only in his haunts, and attacks the player only if she is within
  his tier's reach (fame or notoriety high enough, or in his waters); the bottom tier is the player's first
  named quarry (rung 2-3), the top tier the end-game (rung 4-5). Their havens and haunts are already spread; the
  top three should haunt the Main and the treasure routes, not Jamaica's doorstep.

## 3. Objectives: a clear next step, always

A **Goals** page in the captain's log (L), with the next three objectives and what each unlocks, in plain words
and with progress shown. One click on a goal plots the course or opens the right screen.

| Objective | Shows progress as | Unlocks or rewards |
|---|---|---|
| Mount a full battery | Guns 10 / 18 | The rung 2 waters feel safe |
| Sign on a full crew | Men 75 / 150 | Boarding becomes a plan, not a gamble |
| Make 2,000 gold trading | Gold earned in trade | The shipwright's first upgrades in reach |
| Take your first prize | Prizes 0 / 1 | Plunder chest, volunteers |
| Win a letter of marque | Standing with a nation at war | Lawful prizes, governors' bounties |
| Beat a pirate of your class | Beaten: sloop, brigantine, brig | Fame; the bottom-tier famous pirates notice you |
| Fit out your ship | Upgrades 2 / 6 | |
| Beat a famous pirate | The Top Ten, ringed | Fame, his wealth, a map piece |
| Command a frigate | Ships owned | Rung 4 waters |
| Enter the Top Ten | Your rank | Fame |
| Dig up a hoard | Maps held / found | Gold, revenge |

Objectives come in order but more than one is open at a time, so a trader and a fighter both always have a next
step. Each finished objective is a line in the log and a point of fame where it is a deed (prizes, famous pirates,
hoards).

## 4. The combat model

Everything below is data in `combat.json`, `ships.json`, `crew.json`, `pirates.json` and `upgrades.json`, read
through `shipStats` and the battle's `arm()`, so balance is tuned without code.

### 4.1 Who sails her: captain and crew

- **Crew quality**: green, regular, seasoned, veteran (multiplier on reload and boarding strength, as 1987's
  faster-reloading warships and pirates). New men come green; men who have fought and been paid off become
  seasoned; famous pirates' crews are veterans; navy crews are drilled (regular gunnery, poor boarding).
- **Captain skills** (0-100, for AI ships; the player's are her own play): gunnery (reload, spread), seamanship
  (turn, holding her point of sail, seeking the weather gauge, reaction time: how often she rethinks), boarding
  (strength per man), nerve (when she strikes or runs; today's `nerve` renamed so higher is braver). Drawn by role
  and region tier; famous captains are hand-set.
- **Morale** reaches more than boarding: high morale reloads faster and holds out longer before striking; it falls
  with losses and when the captain's plan fails.

### 4.2 Guns and range

- **Range bands**, the period's own measures: long shot (chance hits only), gunshot (real hull hits), musket
  (small arms and grape begin), pistol shot (case shot, swivels, boarding). Most decisive fire is at gunshot.
- **No gun weights** (decided 2026-10-10: too much for the UI). A ship's firepower is her number of guns, her
  crew's drill and her captain's gunnery.
- **Ammunition** as today (round: hull; chain: rigging; grape: crew) plus the doctrine below deciding who uses what.
- **Raking**: shot down her length (bow or stern) does double damage and more to crew. Rewards seamanship.
- **Swivel guns** (a fit): anti-crew at pistol shot, fire without crew cost, help hold off boarders.

### 4.3 How a fight ends

- **Surrender is the usual end**, as it was: each second a ship may strike when beaten, more readily when
  outgunned, outmanned, demasted, facing a feared flag (a famous pirate's terror, the player's notoriety) or with
  low morale; less readily if she expects no quarter. Merchants mostly strike; navy ships fight longer; pirates
  facing the gallows fight to the end.
- **The player can be asked to strike** (a famous pirate hails her to): striking loses the chest and the hold but
  keeps the ship and men; fighting on risks all. One click each, consequences shown.
- **Boarding** stays automatic at the hulls but is decided by men x quality x captain's boarding x morale x
  defences (nettings, close quarters, swivels), and is announced with its odds as today. (The fencing duel later
  replaces the roll.)

### 4.4 Opponents: one doctrine each, with a tell

| Opponent | Doctrine | Strikes or breaks off | The tell | The counter |
|---|---|---|---|---|
| Merchant | Runs on her best point of sail; stern chasers if caught | Early: demasted, outmanned or half her hull gone | Deep in the water, no ports open | Chain shot, the weather gauge |
| Navy patrol (English) | Holds gunshot range, round shot low at the hull, never boards | Late; runs for port crippled | Navy colours, ports open, sails in company | Close fast and board: navy crews board poorly |
| Navy patrol (French) | Fires high at the rigging, keeps the wind | Late | | Keep her from the weather gauge |
| Spanish guarda costa | Slow guns, many soldiers: hard to board, slow to hurt | Late | Many men on deck | Round shot at range; don't board her |
| Pirate | Chain to slow, grape to thin, then board | Losing the boarding; outgunned at range | Comes straight at you, flag hidden until close | Keep gunshot range with round shot; never let her rake |
| Pirate hunter | Like a pirate, but chases far, then turns home | Far from her port | Red hull; named in the tavern | Outrun to windward, or fight on your terms |
| Famous pirate | His captain's doctrine plus one signature (5) | Rarely | His flag (built); his name on the label (built) | Learn the signature |

Because some opponents now fire round shot at the hull, hull upgrades matter against them, and pirates can be
fought by holding range.

## 5. Famous pirates: ten distinct captains, ordered by rank

Rank (wealth) sets ship, fit and skill; history sets a signature. Difficulty is measured against the career rung
each tier belongs to (section 2) and must rise with rank, captain by captain, not only by class.

| Rank | Captain | Ship (fit) | Signature (from history) | For rung |
|---|---|---|---|---|
| 1 | Henry Morgan | Frigate, 4 upgrades, with a consort | **Numbers and cunning**: sails with a second ship; a fireship ruse when cornered | 5 |
| 2 | François l'Olonnais | Frigate, 3 upgrades | **Terror**: ships strike sooner at his flag; resist and he gives no quarter | 4-5 |
| 3 | Edward Mansvelt | Frigate, 3 upgrades | **Old campaigner**: veteran boarders, never panics (no flight) | 4 |
| 4 | Laurens de Graaf | Brigantine, copper sheathing and bronze cannon | **Gunnery and running fights**: elite gunnery, demasts at range, hard to catch | 4 |
| 5 | Roche Braziliano | Brigantine, 2 upgrades | **Drunken fury**: reckless boarding when ahead, sloppy gunnery | 3 |
| 6 | Michel de Grammont | Brigantine, 2 upgrades | **Disciplined boarders**: boards only at good odds, and wins them | 3 |
| 7 | Bartolomeu Português | War sloop, 1 upgrade | **Slippery**: escapes when losing (he escaped the Spanish twice) | 2-3 |
| 8 | Jan Willems | War sloop, 1 upgrade | **De Graaf's pupil**: good gunnery for his class | 2-3 |
| 9 | John Coxon | War sloop, 1 upgrade | **Raider**: fights near coasts and shoals | 2 |
| 10 | Pierre le Grand | Sloop | **Reckless boarder**: tiny ship, huge crew, boards at once | 2 |

Ranks 1-4 change places as wealth moves, so ship, fit and skill follow the captain, not the rank slot: the table is
each captain's own. The tavern names his ship and, for a price, his fit, so a player can plan the fight.

## 6. Upgrades: the Pirates! names, one trade-off each, fitted to the class

Decided 2026-10-10: keep the six names players know from Pirates! (even where the history is later), and give each a
cost besides gold, so each fits some classes and not others. Each is priced by the work (built), shows its upside
and its downside on the shipwright's row, and shows on the 3D ship. None is strictly better.

| Upgrade | Upside | Downside | Natural fit |
|---|---|---|---|
| Copper sheathing | No fouling (her bottom stays clean); +0.5 speed | Gold per hull point (the dearest) | Ships that cruise far, runners |
| Cotton sails | Points 8 degrees closer to the wind | Tear sooner in a gale and in chain shot | Square-riggers that must beat |
| Iron scantlings | +20% hull | -0.5 speed (weight) | Merchantmen, galleons, gunnery fights |
| Bronze cannon | Reload 20% faster, +10% range; never burst | Gold per gun; overheat if fired fast (a slower reload after three quick broadsides) | Big batteries |
| Fine-grain powder | +15% range | Spoils: renewed each voyage (a running cost) | Gunners holding range |
| Triple hammocks | +25% berths | Food and wages for the extra men (shown) | Boarders |
| Swivel guns (new) | Crew damage at pistol shot, boarding defence | Deck space: -5% berths | Boarders and merchants alike |
| Boarding nettings (new) | Strong defence when boarded | -10% boarding strength going over yourself | Merchants, treasure ships |
| Sweeps (new) | Move at 2 knots in a calm, using men | Men at the oars can't fight the guns | Sloops |

**Fouling and careening (decided: now)**: speed falls with weeks since her bottom was cleaned, up to 20% (the
PRD's hull fouling); careening at a shipwright (a day, gold by hull) or on a beach (days, free, defenceless)
cleans it; copper sheathing stops it. This gives the player a reason to come home and makes copper a real choice.
AI ships carry fits by role (navy: scantlings and bronze; pirates: copper and swivels; merchants: nettings), so a
well-fitted prize is worth more.

## 7. Difficulty levels

Five levels move these knobs, each measured on its own: enemy captain skill range; enemy fits per role; enemy crew
quality; wind in battle (steady on the easiest, shifting on the hardest); near-miss forgiveness on the easiest;
famous pirates' notice threshold. Never: enemies faster than their ship can sail, or scaling to the player's
strength.

## 8. How we know it works

- `pnpm probe:battle` grows into the **career probe**: for each rung's reference ship (section 2) against each
  opponent type and each famous captain, win/loss/strike/escape over 100 seeds, plus each upgrade's effect in the
  fight it is meant for (hull against gunnery, sails against a chase to windward, swivels and nettings in
  boarding). The targets in section 2 become test assertions (ranges, not exact numbers) so balance can't drift
  unnoticed.
- The voyage probe measures encounters per voyage by rung and region (no cliff: each rung meets its own kind).
- A career simulation (scripted trader and fighter captains) checks the ladder's pace: rung 2 in the first
  in-game months, a frigate within a few years, the Top Ten reachable.

## 9. Slices

1. **Captain, crew and doctrine**: crew quality, captain skills, nation and role doctrines (patrols fire round
   shot at the hull), surrender model, ten famous captains with their own ship, fit, skill and signature. Probe
   targets for famous difficulty by rank.
2. **Matched encounters**: region danger tiers, the cliff fixed, famous pirates by rung and haunts; voyage-probe
   targets.
3. **Objectives**: the Goals page and the career probe for pacing.
4. **Guns and range**: range bands, raking, swivels (no gun weights).
5. **Upgrades rework**: the Pirates! six with trade-offs, three new fits, fouling and careening, AI fits by role,
   upgrades on the 3D ship.
6. **Difficulty levels.**

## 10. Decisions (2026-10-10)

1. **Upgrade names**: keep the Pirates! six (copper sheathing, cotton sails, iron scantlings, bronze cannon,
   fine-grain powder, triple hammocks), each with a trade-off (section 6).
2. **The player striking**: yes, a famous pirate may hail her to strike; striking loses the chest and the hold
   and keeps the ship and men.
3. **Gun weights**: no, too much for the UI.
4. **Fouling and careening**: now, with the upgrades rework.
5. **Order**: slices 1 to 6 as listed; all of it will be built.
