# Sea combat today: model, gaps, famous-pirate difficulty

Repo `main` @ 7ea6318. All paths are relative to the repo root. `sim` = `packages/minigame-sea-battle/src/index.ts`, `traffic` = `packages/systems-traffic/src/index.ts`, `nav` = `packages/systems-navigation/src/index.ts`. Every probe number here comes from a throwaway probe (deleted afterwards). It used the same map spot, wind and bearings as `probe/upgrades.test.ts` and `why.test.ts` (SEA 880,680, wind from 70° fresh, `bearingDeg 45+seed*37`).

---

## 1. The battle model as it is

### 1.1 Setup (who comes into the fight, with what)

- **Player** (`apps/web/src/main.tsx:294-311`). The flagship only, with crew = min(fleet crew, her berths), `fleetSpeed` cleared, and morale = `captain.morale` (start 70, `crew.json` morale.start). Other fleet ships do not fight.
- **Enemy**. The world `Ship` is passed unchanged: hull, sailCondition and crew as they are on the map. AI ships have no `guns` field, so they get the **full class battery** (`data/src/stats.ts:30`), and they have **no upgrades**. The one exception is a former prize of the player's, which keeps her `guns` (`traffic:223,282`).
- `arm()` (`sim:172-206`) builds a `BattleShip`:
  - hull = current hull, or `shipStats.hullMax`
  - sailCondition = current value, or 100
  - crew = current crew, or `maxCrew × combat.startCrew 0.5`
  - guns, rangeMult and reloadMult from `shipStats`
  - ammo = round
  - masts = one strength of 100 per entry in `ships.json masts`
  - morale = career morale for the player. For the enemy it is `pirates.rules.morale` 90 if `ai.famous`, else `crew.enemyMorale[role]` (merchant 45, patrol 65, pirate 70).
- **Temperament** (`sim:221-226`) applies to pirates only. It is `ai.temperament` if set, else drawn 50/50 bold/cautious from the seed.
- **Placement**: the ships start 24 tiles apart on the bearing where they met (`combat.battle.startApart`), on the first water found turning in 15° steps (`sim:209-218`).

### 1.2 Every battle stat and what reads it

| Stat | Source | Read by |
|---|---|---|
| `speed` (class + copper) | ships.json, upgrades | nav `targetSpeed` (`nav:51-66`), at battle pace 0.3 tiles/s per speed point (`combat.battle`). Grappled ships are capped at `grappleDrag` 0.4 (`sim:562`) |
| `turn`, `rig` | ships.json | nav turn rate × `handsFactor` (`nav:142`) |
| `polar`, `upwindDeg` (cotton sails) | ships.json, upgrades | nav polar lookup (`nav:55-57`). The AI and autopilot never steer into irons (`sim:361-367`) |
| `hull` / `hullMax` (scantlings ×1.2) | ships.json | Sinks at 0 (`sim:650-651`). Below 30% she sails at ×0.8 (`nav:37`). Strike check below 25% (`sim:471`). Pirate flees below `fleeBelowHull` (`sim:327`) |
| `sailCondition` | world | Speed factor 0.3+0.7×sc (`nav:36`). Bold pirate boards when the target is below `boardBelowSails` (50 bold, 35 cautious) (`sim:332`). Merchant yields below 25 (`sim:477`) |
| `masts[]` | ships.json `masts` (1–3) | A rigging hit wears the nearest standing mast (`sim:616-637`). At 0 the ship loses 100/n sail and 3 crew |
| `crew`, `crewStart` | world | Reload manning (`sim:252-261`). Boarding strength (`sim:423-424, 654-659`). Strike below 30% (`sim:471`). Pirate flee and board ratio (`sim:327,332`). Below `minCrew` she sails and turns at crew/minCrew, floor 0.4 (`nav:45-49`) |
| `guns` (mounted; AI = full) | stats.ts | Balls per broadside = floor(guns/2) (`sim:301`). Men needed per broadside = guns×4/2 (`sim:256`). Below 2 guns she cannot fire. 3% chance per round-shot hit to lose one gun (`sim:606`) |
| `rangeMult` (powder ×1.15, bronze ×1.2) | upgrades | `reach` = 6 tiles round/chain, 4 grape, × rangeMult (`sim:265`). Also scales the AI standoff and autopilot bands |
| `reloadMult` (bronze ×0.8) | upgrades | `reloadSeconds` = 4 × reloadMult × manning factor (`sim:252-261`) |
| `morale` | career / role / famous | **Only** boarding spirit, 0.7 at 0 to 1.2 at 100 (`sim:263`, `crew.json boarding`) |
| `role` | ai.role | Personality (`combat.personality`), boarding factor (`combat.boarding`), merchant-only yield rule |
| `temperament` | ai / draw | Pirate tactics (`combat.tactics.temperaments`) |
| `size` (length, beam, rail, mast, yard) | ships.json | Hit boxes (`sim:587-591`), aim heights (`sim:295`), gun-port spread (`sim:303`) |
| `maxCrew` (hammocks ×1.25) | ships.json | Only through how many men are aboard |
| `nerve`, `famous` id, name, wealth | pirates.json | **Not read in battle** (nerve only in map `lookout`, `traffic:711`) |

### 1.3 Gunnery: there is no hit roll

- **Arc**: a broadside bears if the target is within ±50° of the beam (`sim:246-251`). The range check uses `reach`.
- **Fire** (`sim:278-317`):
  - One ball per gun on that side, from ports spaced along 60% of her length.
  - The gunners lead the target at her current speed and heading over flight time d/6 tiles/s.
  - Aim height: hull at 0.55×rail (round), rigging at 0.45×(rail+mast) (chain), deck at 1.05×rail (grape).
  - Each ball lands on a Gaussian about the aim point with σ = (0.12 + 0.16·d) tiles, ×0.45 for grape. At 6 tiles σ is about 1.08 tiles, against a frigate hull 3.5 × 1.0 tiles.
- **Flight** (`sim:573-641`). Each tick the ball is tested against the victim as she is now:
  - It is a hull hit if it is inside her tapering waterline and below the rail.
  - It is a rigging hit if it is within 85% of her length, inside her yard width, and between rail and mast top.
  - Anything else falls in the sea. So **accuracy is pure geometry**: range, target size, the target's manoeuvre during flight, and the shooter's own motion. No captain or crew factor touches it.
- **Damage per ball** is flat by ammo, whatever the gun, class or where the ball struck (`combat.ammo`):

  | ammo | hull | sails | crew | mast dmg (rigging hit) |
  |---|---|---|---|---|
  | round | 1.2 | 0.3 | 0.2 | 20 |
  | chain | 0.2 | 2.5 | 0.1 | 10 |
  | grape (4-tile reach) | 0.1 | 0.2 | 1.5 | 0 |

  - A rigging hit also applies the full hull/sail/crew values: the `part` only adds mast wear.
  - Round shot does **more** mast damage than chain (20 vs 10). Chain's edge is that it aims high, plus 2.5 sail per hit.
  - Raking (end-on) has no bonus. One ball can hit only once.
  - Fallen mast: sailCondition drops by 100/masts (capped to what the standing masts can carry), and the ship loses 3 crew (`sim:624-636`).
- **Reload** (`sim:252-261`): `4 s × reloadMult × factor`.
  - manning = crew / (guns×2).
  - Below 1, factor = 1/manning (slower). At 1 to 3, factor goes 1 → 0.75 (`crew.json manning`: fullManning 3, reloadBonus 0.25).
  - Typical player ships at 80% crew are all at the 0.75 cap, so reload is about 3 s (bronze: 2.4 s).
  - The first broadside is ready at once: reload starts at 0.
- **Ammo switch**: instant for the player. The AI pays a full reload on **both** sides (`sim:445-452`).
- **Effective HP**, ignoring strike rules:
  - round hits to sink: sloop 38, brig 71, frigate 108, ship of the line 150
  - grape hits to kill 70% of a 250-man crew: about 117

### 1.4 How a fight ends (`sim:643-672`)

- **sunk**: enemy hull ≤ 0. A 25 s salvage window follows: 5 barrels × 50 gold, plus survivors at 20% of her crew.
- **lost**: player hull ≤ 0, **or a lost boarding roll**. In every probe cell below, the player's *mean* hull at the end was 89–100% (6,000+ fights). Chain at 0.2 hull per hit cannot sink a brig in a 30 s fight, so in practice every loss to a pirate is a lost boarding (inferred, not logged per fight).
- **boarded / lost (boarding)**:
  - The grapples go out when the hulls are within `boardTiles` 1.6 and hold until they are 2.5 apart. After `grappleSeconds` 3, the roll is automatic.
  - **Boarding is forced by proximity, not chosen.**
  - Strength = crew × role factor × spirit. Factors: player 1.2, merchant 0.6, patrol 1.1, pirate 1.3. Spirit = 0.7 + 0.5·morale/100.
  - The player wins with p = ps/(ps+es). Both sides lose `0.35 × crew × the other's share`.
  - Worked example, new career (75 men, morale 70) vs Morgan (250, morale 90): 94.5 vs 373.8, so **20%**, before grape thins the player's crew. Measured: 7 boarding wins out of 99 boardings.
- **struck** (enemy only; the player never strikes):
  - Once a second, if the enemy's hull is below 25% or her crew below 30%, she strikes at 15% (`combat.strike`).
  - A merchant strikes outright when her sails are below 25%, or when the player has ≥3× her crew within 6 tiles.
- **escaped / fled**: more than 36 tiles apart and widening for 8 s. It is "fled" if the player was the one sailing away. At 600 s the fight ends as "escaped".

### 1.5 AI steering (`sim:324-390`, thinks every 8 ticks)

| Personality | Used by (`combat.personality`) | Steering | Ammo |
|---|---|---|---|
| `runner` | merchant | Always away (`toThem+180`). Fires if a broadside happens to bear | round |
| `cautious` | patrol; **player autopilot** in probes | Closes if d > 0.8×reach. Backs off if d < 0.5×reach. Otherwise puts the loaded broadside abeam. **Never flees, never boards** | round |
| `aggressive` | pirate (all, famous included) | `pirate()`: see below | chain beyond grape reach, grape within 4 tiles (×rangeMult). **Never round shot** |

`pirate()` (`sim:324-343`) reads the temperament (`combat.tactics.temperaments`):
- Once grappled, she holds on.
- She flees if her hull is below `fleeBelowHull` (bold 0.25, cautious 0.45) or her crew below `fleeBelowCrew` (0.35 / 0.5).
- She **closes to board** in any of these cases:
  - the target's sailCondition is below `boardBelowSails` (50 / 35)
  - her crew is above the target's × `boardCrewRatio` (1.2 / 1.5)
  - she is bold (`seizeOpenings`), within round reach, and the facing broadside has more than 60% of its reload left
- Otherwise she stalks a station 0.75×reach off the target's bow or stern, then turns her loaded broadside on her.
- `attackOdds` (0.6 / 0.9) and `share` (0.5 / 0.5) are map-level only.

The board trigger compares **crew only**. A famous frigate (250) closes at once on any ship with fewer than 209 men (bold). That includes a stock player frigate at 80% crew (200).

### 1.6 What differs between opponent kinds today

| | merchant | patrol | traffic pirate | famous pirate |
|---|---|---|---|---|
| Classes (`traffic.json roles.classes`) | fluyt 6, barque 3, merchantman 1 (convoys merchantman/galleons) | frigate 5, brigantine 3, war_sloop 2, SotL 0.5 | sloop 6, war_sloop 2, brigantine 1; a brig at up to 35% as the player grows (`biggerPirates`, `traffic:1581-1584`) | fixed per captain: 3 frigate, 3 brigantine, 3 war_sloop, 1 sloop |
| Crew share | 0.4–0.7 (convoy 0.8, `traffic:350`) | 0.75–0.95 | 0.7–0.95 (`traffic:1600`) | 1.0 (`traffic:180`) |
| Battle morale (`crew.json enemyMorale`) | 45 | 65 | 70 | 90 (`pirates.rules.morale`, one value for all ten) |
| Boarding factor | 0.6 | 1.1 | 1.3 | 1.3 |
| Personality | runner | cautious | aggressive | aggressive |
| Temperament | – | – | 50/50 drawn | fixed: 7 bold, 3 cautious |
| Nerve (map only) | – | patrolOdds 0.6 | 0.6–1.2 drawn | fixed 0.6–1.0 |
| Guns / upgrades / aim | full battery, none, same geometry | same | same | same |
| Auto-resolve factor | 0.9 | 1.4 | 1.1 | 1.1 |

### 1.7 World level: who attacks, and AI-vs-AI fights

- **Lookout** (`traffic:705-733`). A pirate attacks if `strength(her)/strength(target) ≥ attackOdds × nerve`, where strength = crew × (1 + mounted guns/10) (`traffic:699`).
  - Low nerve means **bolder**: the schema comment at `data/src/schemas.ts:473` says "low: bolder", but the name reads the other way.
  - Example: Morgan needs 0.6×0.7 = 0.42 odds. Coxon needs 0.9×1.0 = 0.9.
  - A new-career brig (75 × 2 = 150) is attacked by every famous captain. A war sloop (100 × 2 = 200) has odds 1.33.
  - A stock player frigate at 200 crew (840) is left alone by the war-sloop and sloop captains.
- **`seaFight` auto-resolve** (`traffic:735-800`). Strength = crew × (1 + **class** guns/10) × `autoResolve[role]` (patrol 1.4, pirate 1.1, merchant 0.9), then one roll; the winner loses 15% of her crew.
  - It ignores morale, hull, sails, temperament, famous status, mounted guns and upgrades.
  - **It disagrees with the battle sim**: here a patrol out-rates a pirate (1.4 vs 1.1), but in the sim a pirate out-boards a patrol (1.3 vs 1.1, morale 70 vs 65).
  - Morgan (250 × 4.2 × 1.1 = 1155) is a slight underdog to a patrol frigate at 85% crew (212 × 4.2 × 1.4 = 1247).

---

## 2. Design gaps (evidence-backed)

1. **Pirates never shoot round shot, so hull investment is worthless against them.**
   - Their ammo is chain or grape only (`sim:385`).
   - Mean player hull at fight end was 89–100% in every probe cell, over 6,000+ fights (`pH` column below).
   - Iron scantlings (+20% hull, 900 g on a brig, 1,380 g on a frigate) gave **exactly zero** change in wins and losses against all four pirate tiers (§3.3).
2. **Losing to a pirate always means losing one boarding roll, and boarding is automatic at 1.6 tiles.**
   - Fights are short: 26–75 s on average.
   - A bold pirate with 1.2× your crew closes at once. The outcome is mostly decided by crew × factor × spirit, plus how much grape lands first.
   - There is no "repel boarders" choice and no sharp-shooters. Morale matters only here.
3. **No captain skill exists.**
   - In the sim the ten famous captains are four opponents: frigate/bold, brigantine/bold, war_sloop/cautious and sloop/bold.
   - Name, nerve and wealth are never read in battle. Captains of the same class produce **byte-identical** results seed for seed (verified by an outcome hash).
   - There is no gunnery, seamanship or leadership stat, and the AI has no reaction time. All AI ships think every 8 ticks with perfect leading.
4. **No gun types or weights.** Every gun is the same ball. Damage is flat per ball, whatever the gun, class, range or where the ball struck. A class's firepower is just floor(guns/2) balls per side. There are no carronades or long guns, no swivels, and no chasers (bow and stern cannot fire).
5. **Accuracy is purely geometric.** σ grows with range, and bigger targets are easier. Crew, morale and captain do not affect it, and nothing aims better as it gains experience.
6. **The AI never has upgrades or a partial battery.** Range and reload upgrades are a pure player edge. A redesign has no data path to give a named captain "bronze guns" or "copper".
7. **Morale is one-dimensional.** It affects boarding only: not reload, accuracy, strike, or flight. Every famous captain shares 90.
8. **Strike and surrender are one-sided and flat.**
   - The enemy rolls 15%/s once beaten. Temperament, morale and famous status do not change that.
   - The player never strikes and can only lose by boarding or by sinking.
9. **Personalities are thin.**
   - `cautious` (patrol) never flees and never boards on purpose. `runner` (merchant) never fights.
   - Pirate is the only role with tactics, and it is a single function with six numbers.
   - Patrols and merchants have no temperament.
10. **Famous captains do not scale and do not differ beyond class.** Traffic pirates do scale with the player (`biggerPirates`). The Top Ten's wealth has no tie to battle strength except through hand-picked classes.
11. **The two combat models disagree** (sim vs `seaFight`, §1.7). Neither uses morale or temperament the same way.
12. **Upgrade effects are lopsided** (§3.3):
    - Against pirates, powder and bronze cannon (range and reload) help most.
    - Hammocks help only slightly. More men helps the boarding odds, but only 25% more.
    - Cotton sails and copper help against small or bold pirates (positioning), but are noise or negative against the cautious war sloop. A faster ship closes into her grapple range.
    - Scantlings do nothing.
13. **Minor naming and semantics issues**: `nerve` is inverted (lower is bolder). Round shot out-damages chain on masts. The `HitPlace.part` only drives the mast wear and the visual effect.

---

## 3. Famous pirate difficulty (measured)

### 3.1 Method

- **Enemy**: each captain's class, temperament and nerve, `famous` id set (so morale 90), full crew `maxCrew`, full hull and sails, full battery, no upgrades.
- **Player configs**, all at morale 70 with the 'cautious' autopilot:

| Config | Class | Guns | Upgrades | Crew |
|---|---|---|---|---|
| **brig10 new** | brig | 10 | none | 75 (new career: `map.json start.guns 10`, `startCrew 0.5`, morale.start 70) |
| **brig18** | brig | 18 | none | 120 (0.8 × berths) |
| **brig18 all** | brig | 18 | all six | 150 (0.8 × 187 with hammocks) |
| **brigantine** | brigantine | 14 | none | 100 |
| **frigate** | frigate | 32 | none | 200 |
| **frigate all** | frigate | 32 | all six | 250 |

- The 0.8 crew share is an assumption, matching the existing probes. Only "brig10 new" is a known real state.
- Seeds 1–20 as asked, then repeated at 100 seeds for tighter numbers.
- **Caveat**: the autopilot ('cautious') fires round shot only, never orders a board, and backs off inside half reach. These numbers measure "autopilot vs captain", not a skilled human. A pirate can only be beaten by sinking her, making her strike, or a boarding *she* starts and loses.
- An extra pass with the 'aggressive' autopilot (chain/grape and closing) was **worse** for the player in 18 of 24 tier×config cells at 20 seeds (better in 3). So 'cautious' is the stronger baseline, not an artifact.

### 3.2 Results

W = player won (sunk + struck + boarded), L = lost (always by boarding in practice), E = escaped/fled.

**20 seeds, W/L/E.** Captains in a tier are identical seed for seed:

| Captain (wealth) | class / temperament | brig10 new | brig18 | brig18 all | brigantine | frigate | frigate all |
|---|---|---|---|---|---|---|---|
| Morgan (9000) | frigate / bold | 2/18/0 | 6/14/0 | 13/7/0 | 5/15/0 | 13/6/1 | 15/5/0 |
| l'Olonnais (7500) | frigate / bold | 2/18/0 | 6/14/0 | 13/7/0 | 5/15/0 | 13/6/1 | 15/5/0 |
| Mansvelt (6000) | frigate / bold | 2/18/0 | 6/14/0 | 13/7/0 | 5/15/0 | 13/6/1 | 15/5/0 |
| Braziliano (5000) | brigantine / bold | 7/13/0 | 10/10/0 | 17/3/0 | 11/9/0 | 19/1/0 | 20/0/0 |
| de Graaf (4500) | brigantine / bold | 7/13/0 | 10/10/0 | 17/3/0 | 11/9/0 | 19/1/0 | 20/0/0 |
| Grammont (4000) | brigantine / bold | 7/13/0 | 10/10/0 | 17/3/0 | 11/9/0 | 19/1/0 | 20/0/0 |
| Português (3000) | war_sloop / cautious | 17/2/1 | 17/2/1 | 19/1/0 | 12/7/1 | 18/2/0 | 19/1/0 |
| Willems (2500) | war_sloop / cautious | 17/2/1 | 17/2/1 | 19/1/0 | 12/7/1 | 18/2/0 | 19/1/0 |
| Coxon (2000) | war_sloop / cautious | 17/2/1 | 17/2/1 | 19/1/0 | 12/7/1 | 18/2/0 | 19/1/0 |
| le Grand (1500) | sloop / bold | 12/8/0 | 13/7/0 | 19/1/0 | 12/8/0 | 19/1/0 | 20/0/0 |

**100 seeds, player loss %** (more reliable):

| Tier | brig10 new | brig18 | brig18 all | brigantine | frigate | frigate all | mean |
|---|---|---|---|---|---|---|---|
| Frigate trio (Morgan, l'Olonnais, Mansvelt) | 92 | 71 | 50 | 75 | 36 | 26 | **58** |
| Brigantine trio (Braziliano, de Graaf, Grammont) | 62 | 49 | 23 | 48 | 15 | 11 | **35** |
| le Grand (sloop, bold) | 47 | 28 | 11 | 34 | 4 | 3 | **21** |
| War-sloop trio (Português, Willems, Coxon) | 34 | 17 | 8 | 34 | 8 | 1 | **17** |

Other things seen in the same runs:
- **Fight length**: mean 26–75 s.
- **Enemy hull at the end**:
  - frigate tier: 33–89%
  - war sloop and sloop against a frigate player: 16–19%
- **Enemy crew at the end**: 79–95% everywhere. Round shot barely touches crew.
- **Player hull at the end**: 96–100%.

### 3.3 Upgrades one at a time (brig, 18 guns, 120 crew → 150 with hammocks), 100 seeds, W/L

| vs | stock | hammocks | powder | cotton | scantlings | copper | bronze | all |
|---|---|---|---|---|---|---|---|---|
| Morgan | 29/71 | 35/65 | 38/62 | 29/71 | **29/71** | 31/69 | 36/64 | 50/50 |
| Braziliano | 51/49 | 54/46 | 64/36 | 63/37 | **51/49** | 58/42 | 63/37 | 77/23 |
| Português | 82/17 | 83/16 | 81/18 | 75/24 | **82/17** | 72/28 | 82/18 | 92/8 |
| le Grand | 72/28 | 73/27 | 80/20 | 78/22 | **72/28** | 81/19 | 82/18 | 89/11 |

Brig upgrade prices (`upgradePrice`, `data/src/stats.ts:62-69`): hammocks 400, powder 500, cotton 800, scantlings 900, copper 1500, bronze 2000, so the full set costs 6,100. On a frigate the full set costs about 10,000.

### 3.4 Ranking vs Top Ten wealth

- **Difficulty rank** (hardest first): Morgan = l'Olonnais = Mansvelt  >  Braziliano = de Graaf = Grammont  >  **le Grand**  >  Português = Willems = Coxon.
- **Wealth order**: Morgan, l'Olonnais, Mansvelt, Braziliano, de Graaf, Grammont, Português, Willems, Coxon, le Grand.
- **It matches at the tier level for the top six.** That match is by construction: wealth and class were both hand-picked in descending order, and class is the only per-captain input the sim reads besides temperament.
- **It does not match at the bottom.** Le Grand, last on wealth, is harder than the three war-sloop captains. The cause is his bold temperament: he boards at a 1.2 crew ratio and seizes openings. The cautious captains need 1.5× and flee at 45% hull.
  - Against a new-career brig he wins 47% vs 34%.
  - Against a stock brig 18 he wins 28% vs 17%.
- **Within each tier the order is undefined.** The sim gives identical results, so "Morgan is harder than Mansvelt" is not true today.
- **The map-level gate shapes difficulty too** (lookout, §1.7). A stock player frigate at 200 crew has strength 840. Against her, the brigantine trio has odds 300/840 = 0.36, below their 0.42–0.48 thresholds. The war sloops (0.24 vs 0.9) and le Grand (0.16 vs 0.36) also fall short. **Once the player sails a frigate, only Morgan, l'Olonnais and Mansvelt will attack her.** The easy captains have to be hunted down. This is probably accidental, but it is a difficulty curve.
- **New-career reality**: a new player loses 92% against the frigate trio, 62% against the brigantines, 47% against le Grand and 34% against the war sloops. All ten captains will attack a new-career brig (lookout odds, §1.7).

---

## 4. Existing levers a redesign can use

**Data (no code change needed):**
- `pirates.json` captains[]:
  - `classId` (the only per-captain battle input with real effect)
  - `temperament` (choose among the `combat.tactics.temperaments` keys; new temperaments can be added as data)
  - `nerve` (map aggression only)
  - `rules.morale` (one value for all ten)
- `combat.json`:
  - `tactics.temperaments.*`: share, boardBelowSails, boardCrewRatio, seizeOpenings, fleeBelowHull, fleeBelowCrew, attackOdds
  - `tactics.standoffShare`, `stationTiles`, `openingReload`
  - `guns.*`: arc, range, grape range, reload, crewPerGun, shot speed, spread, spreadPerTile, grapeSpread, arcPerTile
  - `ammo.*` (hull, sails and crew per ball), `masts.damage` and `crewLoss`, `gunLoss`
  - `strike.*` (hull, crew, chance, merchant rules, odds), `boarding.*` (role factors, losses)
  - `personality` (role → runner/cautious/aggressive), `crew[role]` share ranges, `purse`, `hunt.nerve`, `hunt.patrolOdds`, `autoResolve.*`
  - `battle.*` (boardTiles, grappleSeconds, breakTiles, grappleDrag, escape, startApart)
- `crew.json`: `enemyMorale[role]`, `boarding.at0/at100` (spirit), `manning.fullManning/reloadBonus`, `shortHandedFloor`
- `ships.json`: speed, turn, rig, polar, hull, guns, maxCrew, minCrew, masts[], size (hit box)
- `upgrades.json` modifiers: speed, upwindDeg, hullMult, crewMult, rangeMult, reloadMult (`shipStats` reads only these six)
- `traffic.json`: `roles.*.classes`, `biggerPirates` (from, full, maxShare, classId)

**Code points (where new stats would be wired):**
- `shipStats` (`data/src/stats.ts:24-52`): add modifier kinds such as accuracy, damage or boarding.
- `arm()` (`sim:172-206`): the single point that turns a world ship into a battle ship. Famous or role overrides would go here (morale, crew, upgrades, a captain-skill object). AI upgrades already flow through `shipStats` if `ship.upgrades` is set on the AI ship at spawn (`traffic:161-200` spawnFamous, `traffic:1556-1620` spawn).
- `fire()` (`sim:278-317`): σ and the lead calculation give a natural accuracy/skill hook. The per-ball `Shot` could carry a weight or damage multiplier.
- Hit resolution (`sim:598-639`): damage could vary by place, raking or gun weight.
- `reloadSeconds` (`sim:252-261`): a crew-quality or drill hook.
- `pirate()` (`sim:324-343`) and `steer()` (`sim:346-390`): tactics. `steer` hard-codes pirate ammo (`sim:385`). Making ammo choice part of the temperament would let some captains fight with round shot and make hull upgrades meaningful.
- `boardingOdds` and the boarding roll (`sim:420-426, 652-660`); `spirit` (`sim:263`).
- `beaten`, `yields` and the strike roll (`sim:471-477, 667-672`).
- `AI_THINK_TICKS` (`sim:152`): a reaction-time difficulty knob, currently global.
- Lookout strength (`traffic:699, 711`) and `seaFight` strength (`traffic:742`): keep them consistent with any new battle strength.
- `startBattle` (`apps/web/src/main.tsx:294-311`): what the player brings (flagship only, crew capped at berths, career morale).
