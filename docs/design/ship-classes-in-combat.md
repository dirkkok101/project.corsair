# Ship classes in combat (design)

Proposed 2026-10-24. The ask: a fight should feel different by the ship you sail. A small ship is agile and fights
by hit, run and dodge; a ship of the line is slow and wins by taking punishment and dealing more of it. Grounded in
the period, kept an arcade game: where accuracy would cost fun, it gives way.

Background: `combat-model.md` (the model this extends), `../reference/naval-combat-history.md` (ships, guns and
doctrine of 1650-1720, 31 sources) and the new sources in section 2.

## 1. Where we stand (read from the code)

A ship's class reaches a fight only through speed, turn, rig and polar, the size of her hit box, gun count, hull
points, crew, masts, chasers, swivels and oars.

- **Every ball is the same ball.** A sloop's 4-gun broadside and a ship of the line's 22-gun one throw identical
  balls (round 1.2 hull, chain 2.5 sails, grape 1.5 men). Weight of metal is gun count only. No calibre, no
  timbers: a sloop's ball hurts a ship of the line's side exactly as much as hers hurts the sloop's.
- **Bigger is easier to hit**, by geometry: a ship of the line's hull box is about 5.4 x 1.7 tiles, a sloop's
  2.9 x 1.0, and scatter doesn't depend on the target. True to life, but with nothing on the other side of the
  scale (no thicker sides), size is mostly a cost.
- **Same reload for every gun** (4 s, by crew and upgrades), so a small ship doesn't fire faster, and a big one
  only fires more balls.
- **Agility exists but has little to buy.** Turn rates now range from 13 deg/s (treasure galleon) to 75 (periagua),
  and the fore-and-aft rigs point higher. But there's no dodging skill (balls land where her course and speed say;
  nothing warns her), no shoal she can cross that a deep hull can't (`draft` is never read in battle), and a rake
  is x2 from any end.
- **Nothing sustains a big ship.** Hull points are the only defence; no repairs in a fight.
- **The AI is blind to class.** It picks tactics by role (merchant runs, patrol keeps range, pirate weighs board /
  duel / stalk / flee) and sees class only through guns x hull and crew. It never weighs speed or turn: a sloop
  doesn't break off when a frigate turns her broadside on her, and a slow ship flees as readily as a fast one.

## 2. What the period says

- **Small ships won by speed, choice and men, never by weight of metal.** The Bermuda/Jamaica sloop, the pirates'
  ship of choice, could "outrun most other sailing ships by simply turning upwind" and slipped over reefs and bars
  a deep ship couldn't cross ([Bermuda sloop](https://en.wikipedia.org/wiki/Bermuda_sloop)). Light guns (swivels to
  6-pounders) did little to a big ship's 1.5 to 2 ft sides; their weapons were the chase, chain at the rigging,
  grape and an over-manned deck that boarded.
- **Big ships were fortresses.** A ship of the line carried 24 to 32-pounders below, 12 to 18 above
  ([32-pounder](https://en.wikipedia.org/wiki/32-pounder_gun)); a 32-pounder at point blank went through 42 in of
  oak. Ready to fight, she beat off ships that outnumbered her (the 60-gun *Begoña* beat off Woodes Rogers, 1709).
  Slow to tack (square-riggers often wore round, and could miss stays: [Tacking](https://en.wikipedia.org/wiki/Tacking_(sailing))).
- **Wooden ships rarely sank.** They struck from crew losses, dismasting or fire; carpenters plugged shot holes and
  fished spars as the fight went on.
- **Small beats big only by craft:**
  - Raking from bow or stern, where she has few guns, and the stern is weakest
    ([Raking fire](https://en.wikipedia.org/wiki/Raking_fire)).
  - Getting under her guns: the 14-gun *Speedy* laid alongside the 32-gun *El Gamo*, whose guns couldn't depress
    enough and shot through *Speedy*'s rigging; *Speedy* boarded and took her
    ([Action of 6 May 1801](https://en.wikipedia.org/wiki/Action_of_6_May_1801)).
  - Fire: Morgan's fireship burned the 48-gun *Magdalen* at Maracaibo (1669).
  - Weather: two frigates raked the 74 *Droits de l'Homme* in a gale she couldn't open her lower ports in
    ([Action of 13 January 1797](https://en.wikipedia.org/wiki/Action_of_13_January_1797)).
- **And big beats small by catching her:** HMS *Swallow* (50) lured Roberts' 16-gun *Ranger* into a chase away from
  support, took her, then dismasted the *Royal Fortune* ([Battle of Cape Lopez](https://en.wikipedia.org/wiki/Battle_of_Cape_Lopez)).

Kept out for fun: real broadside cadence (minutes), fights of hours, penetration tables, up-roll and down-roll
aim (ammo stands in for it), men-per-gun bookkeeping shown to the player, line-of-battle discipline, groundings
that end a fight.

## 3. Three ways to fight

Every class gets one of three fighting styles, said in a word on her battle card. Merchant hulls are cruisers or
raiders in build but fight as prey (their role's doctrine), as today.

| Style | Classes | Wins by | Loses by |
|---|---|---|---|
| **Raider** | periagua, pinnace, half-galley, sloop, war sloop, royal sloop, ketch | Speed, pointing high, a tight turn, dodging, raking from the ends, shoals, chain and grape, boarding with a crammed deck | Trading broadsides: one heavy broadside guts her |
| **Cruiser** | barque, pink, brig, brigantine, fluyt, merchantman, light frigate, frigate, galley-frigate | The all-rounder: fast enough to catch a raider's prey and escape a fortress, guns enough to beat what she catches | Being caught by a fortress, or out-turned and raked by a raider |
| **Fortress** | galleon, treasure galleon, ship of the line | Shrugging off light shot, heavy broadsides that cripple at a stroke, carpenters who patch her as she fights | Being raked, chained to a stop, or boarded under her guns; can't catch what runs to windward |

## 4. The levers

Each lever: what it does in play, how it's abstracted, and where it lives. All numbers are data (`ships.json`,
`combat.json`) and first guesses for the probe.

### 4.1 Weight of shot and stoutness of timbers (the core)

Each class gets a **shot** tier (light, medium, heavy) and a **timbers** tier (thin, stout, massive). Hull and crew
harm from round shot scale by the pair:

| Shot \ timbers | thin | stout | massive |
|---|---|---|---|
| light | 1.0 | 0.6 | 0.3 |
| medium | 1.4 | 1.0 | 0.6 |
| heavy | 1.8 | 1.4 | 1.0 |

- Chain and grape ignore timbers: canvas and men are as soft on any ship. So a raider's answer to a fortress is
  her rigging and her deck, and the board, which is what pirates did.
- Shot tiers: light for raiders and small traders (the periagua and half-galley have swivels only); medium for
  cruisers; heavy for fortresses. Timbers follow the same split.
- Heavier shot reloads slower: light 3 s, medium 4 s (today's), heavy 5.5 s. A raider fires small and often, a
  fortress rarely and crushingly.
- **Revisits decision 3** (no gun weights: too much for the UI). This is three tiers per class, not weights per
  gun, and never a number on screen: the battle card says "light guns, thin hull", and the gun bar tells her when
  her shot won't bite ("Light shot: barely marks her hull. Chain and grape still work.").

### 4.2 Read the broadside, dodge it

Today a broadside lands where her course said; nothing gives her the chance to turn out of it.

- **The tell**: an enemy runs out her guns a beat (about 0.8 s) before she fires, with the sound of the trucks and
  her ports opening, and her firing arc brightens on the water.
- **Balls fly long enough to be dodged**: a little slower than now at long range, so a nimble ship turning or
  checking her way at the tell spills much of a broadside, and a fortress, which can't turn out of anything,
  takes it on her timbers.
- **Splashes say where it went**: a near miss throws a tall plume, so she learns.
- Both sides alike: the AI raider dodges the player's broadside the same way (by seamanship skill).

Built (slice 2): the tell is both ships' rule (guns run out over `battle.tellSeconds` once loaded and bearing; an
order to fire meanwhile goes off the moment they are out), her arcs show red on the water and light as her guns run
out, the gun trucks rumble, balls fly at 4.5 tiles a second (6 before), and a near miss throws a taller plume. An AI
dodge (helm hard over on the player's tell or broadside, by seamanship) was built and measured over whole fights
and dropped: it moved neither the player's hit rate nor the hull she lost (within noise, seamanship 0 against 100),
because at fighting range the balls' scatter dwarfs what a turn in a second can change. The raider's small hull and
quick turns already spill about half the player's shot (a frigate or ship of the line takes over 90%).

### 4.3 Ends and edges: raking, the rudder, under her guns

- **Stern rakes hit hardest** (x3; bow x2 as today), and a stern rake can jam her rudder: her turn halves for a
  few seconds. Crossing a fortress's stern is a raider's best moment.
- **Her arcs on the water**: both ships' broadside arcs show (the player's do today), so "never cross her
  broadside" and "get on her quarter" are visible, not remembered.
- **Under her guns**: within about a tile of a ship much taller than her, a broadside flies high into her rigging
  (*Speedy*). Hull harm small, sails harm as normal. Brave close play is rewarded; it's also boarding range.

Built (slice 3): a stern rake does `raking.sternDamage` (x3), a bow rake `raking.damage` (x2); a round shot from
astern jams her rudder at `raking.rudderChance` a ball, her helm biting half the time for `raking.rudderSeconds`
(a "rudder jammed" tag on her card, and a call). Within `underGuns.tiles` of the side of a ship `underGuns.tallerBy`
times her rail height (a ship of the line, galleon or frigate over a sloop; not a brig over one), the tall ship's
round and grape are laid into her rigging, doing `underGuns.harm` (a quarter) of their harm to her hull, men and
masts there (her canvas as ever), and the HUD says so. Both ships' arcs came with slice 2.

### 4.4 Shoals by draft

- The battle is fought on the real map, which has two depths: shallows (water within `shallowsTiles` of land,
  `Tile.Shallow`) and deep. A ship whose `draft` (already in `ships.json`, never read in battle) is past a
  threshold slows to a crawl and takes hull damage while in the shallows (a soft grounding, a few seconds, never
  a fight-ender).
- Raiders work the shallows freely; cruisers touch at the threshold; fortresses ground. Running inshore is the
  raider's escape, and lurking there her ambush (Ocracoke). A finer map of reefs and banks is a later step.
- The water's depth shows as it does on the sea map (lighter water), and the HUD warns "Shoal water: she draws too
  much" before she touches.

### 4.5 Damage control (the fortress's endurance)

- Her carpenters patch the hull as the fight goes on: a slow regain while she's not been hit for a few seconds,
  faster with more men and in a stouter hull (fortress fast, raider slow). Hull only, up to a share of what she
  lost (holes plugged, not ships rebuilt). Automatic: no button.
- A fallen mast can be fished once per fight per mast, after a while, back to a stump that carries some sail.
- This is what lets a fortress "take it": she shrugs off light shot, patches what does get through, and keeps
  firing.

Built (slice 5): once no ball has holed her for `repair.quietSeconds`, her carpenters patch `repair.perSecond` of
her hull a second (raider 0.2%, cruiser 0.4%, fortress 0.7%, as a share of her men left), up to `repair.share`
(half) of what she has lost this fight. A fallen mast is fished once, `repair.fishSeconds` after it fell, as a stump
of `repair.stump` strength carrying half its canvas; the 3D view stands a jury mast. The card says "patching" while
they work. They stop over a wreck (the fight is done). Automatic, as decided. Against the fixed autopilot a fortress's fights run longer (a galleon pirate's
duel with a brig lasts minutes); the style-aware autopilot of section 6 will say whether that's dull in play.

### 4.6 Captains who fight their ship

The AI chooses by style as well as role and temperament:

- **Raider**: stalks to a station off her quarter or stern and rakes, breaks off when the other's loaded
  broadside comes round on her, and dodges at the tell. Runs to windward or over shoals when hurt. Boards when
  her men outnumber.
- **Cruiser**: today's duel and stalk, seeking the weather gauge.
- **Fortress**: turns to present her loaded broadside rather than chase; never follows far; grinds.
- **Flee only when she can**: weighs relative speed and pointing before running (a slow ship that can't escape
  fights on or strikes).

Built (slice 4): a boarding captain's wish to stalk and to duel is multiplied by her style (`tactics.styles`: a
raider stalks rather than duels, a fortress duels and barely stalks); a patrol, or a trader who can't get away,
fights by her style (a raider stalks to the other's bow or stern and rakes; a fortress presents her broadside and
closes to her reach from up to `fortressChase` times it and never follows further; a cruiser closes and duels, as
before). A ship below `runSpeedShare` of the other's best pace on this wind (navigation's own: her fit, condition and
hands, and her oars in a calm) can't get away: a trader turns and fights within her guns' reach (and chases no one
beyond it), and a boarder wants to run only
`utility.cornered` as much. Pointing is not weighed yet. Dodging at the tell
was left out (see 4.2). The player's autopilot (tests and probes) still fights every ship as a cruiser.
Measured over 80 fights against the cautious brig, the same sloop patrol with the same guns and timbers, her captain
a raider against a cruiser: raked 27% less, raking 39% more, and doing a third more harm to the brig's hull. A
cornered fluyt fights (her fights halve in length); a ship of the line patrol no longer runs down a brig.

### 4.7 How each class should feel (the intended matchups)

| Matchup | Intended |
|---|---|
| Sloop vs ship of the line | The sloop can't hole her (light on massive, 0.3) and one broadside nearly guts her (heavy on thin, 1.8). She wins only by chain, stern rakes, getting under her guns and boarding; she can always run to windward or over a reef. The fortress wins if the sloop is careless. |
| Frigate vs ship of the line | The frigate loses a duel and escapes a chase; she can rake and run. |
| Brig vs pirate sloop | The brig wins a duel; the sloop wins if she dodges, chains and boards. |
| Two sloops | A knife fight: turning, raking, boarding (Ocracoke). |
| Fortress vs fortress | A slugging match: broadsides, carpenters, who breaks first. |

## 5. Screens

Simple, per the UI rule:

- **Battle card**: her style word and two tags ("Raider · light guns · thin hull"), the same for the enemy, with a
  one-line hint for the matchup ("Her guns outweigh yours: keep off her broadside, rake her stern, or board").
- **Gun bar**: says when her shot won't bite, and which shot will.
- **Water**: both ships' arcs, the tell, splashes, shoal water.
- **Shipyard**: the style and tags on each ship for sale, so the choice of ship is a choice of play.

## 6. How we know it works

Headless probes (as the balance suite does), 100 seeds each, with a style-aware autopilot for the player:

- Each row of 4.7 lands where it says (for example: a sloop flown as a raider takes or escapes a ship of the line
  in most fights, and loses most broadside duels with her).
- No class dominates its price band; a fortress's fights take longer than a raider's.
- The existing balance tests (career, outfitting, famous pirates) still pass, retuned where the model changes.

## 7. Slices

1. **Shot and timbers** (4.1): tiers in `ships.json`, the harm table and reloads in `combat.json`, the battle
   card's tags and the gun bar's hint. The biggest change in feel for the least code.
2. **Read and dodge** (4.2): the tell, ball speed, splashes, the enemy's arcs.
3. **Ends and edges** (4.3): stern rake and rudder, under her guns.
4. **Class captains** (4.6): AI by style; flee by speed.
5. **Damage control** (4.5).
6. **Shoals by draft** (4.4).

Later, kept for their own designs: fire and the magazine, weather that shuts a fortress's lower ports, false
colours (a sea-map feature), the fireship (already planned as an action).

## 8. Decisions wanted

1. **Shot and timbers as three tiers per class**, reversing decision 3 of 2026-10-10 (never a number on screen)?
2. **Dodging**: the tell plus slightly slower balls, for both sides?
3. **Damage control**: automatic, as proposed, or a key with a cooldown?
4. **Order**: slices 1 to 6 as listed?
