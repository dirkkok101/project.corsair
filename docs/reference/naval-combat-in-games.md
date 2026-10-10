# Sea combat across pirate and age-of-sail games: upgrades, opponents, difficulty

Research for Corsair's sea-combat model: making ship upgrades matter per ship class and making opponents (merchants, navy patrols, pirates, famous captains) feel different. Collected 2026-10-10.

This file does not repeat `docs/reference/pirates-sailing-combat-rewards.md`, `pirates-trading-battles-navigation.md` or `pirates-original-games.md` (the six upgrade one-liners, the specialist table, ammo roles, the four damage systems, surrender rules, captain's share, Top Ten basics, bounty numbers, Black Flag and Sea of Thieves basics). It adds numbers, opponent behaviour and player reaction.

Labels: **[dev]** is a manual, developer or publisher source. **[fan]** is a wiki, guide or forum. **[review]** is press. **Unverified** marks claims that only a search snippet or a single weak source supports. Quotes come only from fetched pages. Fandom wikis were read as raw wikitext through `https://<wiki>.fandom.com/api.php?action=parse&page=<Page>&format=json&prop=wikitext&formatversion=2&redirects=1`; the `wiki/<Page>` URLs below are the human-readable form of the same pages.

---

## 1. Sid Meier's Pirates! (1987 and 2004)

Sources: 2004 manual https://cdn.cloudflare.steamstatic.com/steam/apps/3920/manuals/manual.pdf [dev]; 1987 manual http://www.antimon.org/dl/c64/misc/piratesdoc.html [dev]; fan wiki pages at `https://sidmeierspirates.fandom.com/wiki/<Page>`, cited as FW:Page [fan].

### 1.1 Upgrades: what they are and what they do

- **Six named improvements, plus chain and grape bought at the shipwright.** The manual's Ship Upgrades page (p.108) lists the six; p.109 lists chain and grape shot beside round shot, which it calls "the standard cannon ammunition type, not an upgrade". The wiki counts all 8 as upgrades: a ship without chain or grape can fire only round shot [manual pp.108-109; FW:Upgrade; FW:Naval_Combat].
- **Magnitudes are mostly unpublished.** The wiki says Cotton Sails and Copper Plating help "moderately" and Iron Scantlings "slightly" [FW:Upgrade]. The figures that do exist:
  - Triple Hammocks: +50% max crew [FW:Upgrade; https://www.hookedonpirates.com/guide/upgrades/index.html, fan site based on the beta].
  - Fine-Grain Powder: about +30% range [FW:Naval_Combat], "roughly 30-40%" [FW:Cannons].
  - Bronze Cannon: each ball is biased slightly toward the target's *predicted* position (a lead correction, not a damage boost). It does not stack with the Gunnery skill [FW:Cannons].
  - Cotton Sails: the gain "seems to depend on the basic speed" of the ship [hookedonpirates].
  - Exact speed, turn and hull percentages: **Unverified**.
- **Rules** [FW:Upgrade; FW:Naval_Combat]:
  - A ship can hold all 8. Each port or haven sells exactly **one** upgrade type, drawn at random at game start, so collecting a full fit is a voyage, not a menu.
  - Upgrades are permanent, can't be lost to damage, and belong to the hull (they leave when she is sold or sunk).
  - Two show on the model: Cotton Sails turn the sails bright white; Copper Plating gives a tan lower hull.
- **Cost depends on class, not on the upgrade** [FW:Upgrade]:

| Class | Normal port | Admiral to Marquis | Duke | Pirate haven |
|---|---|---|---|---|
| Pinnace | 400 | 200 | free | 240 |
| Sloop | 500 | 250 | free | 300 |
| Barque | 600 | 300 | free | 360 |
| Fluyt, Brig | 700 | 350 | free | 420 |
| Merchantman, Galleons, Frigate | 900 | 450 | free | 540 |

  The wiki's Rank page puts free upgrades at Count, not Duke; the manual's rank list says Duke (see `pirates-sailing-combat-rewards.md`).
- **Resale:** each upgrade adds 1/4 of the base sale value, so a fully fitted ship sells for 3x. That makes a well-fitted prize a reward in itself [FW:Upgrade].
- **AI ships carry upgrades too, by role:** new warships usually 4-6, traders 0-2, war canoes 0-1. Evil Spaniards always have all 8. Famous pirates' ships are "loaded with upgrades", partly random [FW:Upgrade; FW:Evil_Spaniard; manual "Named Pirates"].
- **Scouting:** a barmaid reveals a famous pirate's ship type first, then his upgrades [FW:Famous_Pirate]. Upgrades are information the player can buy before a fight.

### 1.2 Ship tables

2004 (max guns / max crew / min crew / ideal crew / cargo), from the ship infoboxes [fan]. **Ideal crew = minimum + 3 per cannon** [FW:Crew]. A broadside fires half the guns [FW:Cannons].

| Class (sale price) | Ships |
|---|---|
| Pinnace (225) | War Canoe 8/50/6/30/20; Pinnace 10/60/6/36/25; Mail Runner 12/80/8/44/30 |
| Sloop (300) | Sloop 12/75/8/44/40; Sloop of War 16/100/10/58/50; Royal Sloop 20/125/12/72/60 |
| Barque (375) | Coastal Barque 12/75/10/46/60; Barque 16/?/12/60/70; Ocean Barque 16/125/14/62/80 |
| Brig (450) | Brigantine 20/125/12/72/60; Brig 24/150/14/86/70; Brig of War 32/200/18/114/80 |
| Merchantman (600) | Merchantman 16/125/16/64/100; Large Merchantman 20/125/16/64/120; East Indiaman 20/150/-/-/140 |
| Combat Galleon | Fast Galleon 24/160/12/100/80; War Galleon 32/200/13/107/90; Flag Galleon 40/250/15/135/100 |
| Frigate (600) | Frigate 32/200/16/112/80; Large Frigate 40/250/20/140/90; Ship of the Line 48/300/18/160/100 |
| Merchant Galleon | Treasure Galleon 40/200/24/100/140 (Trade and Royal Galleon: **Unverified**) |

Every class has three grades (small, standard, war). The "war" grade is how the game makes navy and pirate ships tougher than a trader of the same family without inventing new hulls.

1987 gazetteer [dev, 1987 manual] lists *typical* guns and men next to the maximum, which is how 1987 separates a merchant from a warship of the same hull: a Merchantman can mount 24 guns but typically carries 6-12 with 20-45 men; a War Galleon 28-32 guns with 250 men. Also 1987: 4 men per gun; **enemy reload depends on crew quality** (warships, hunters and pirates reload faster than merchants); your reload depends on morale.

### 1.3 Difficulty: what it changes

- **2004 manual:** tougher opponents in the action sequences, harder recruiting, harder crew happiness; the level can only change when you divide the plunder [dev].
- **Apprentice only** [FW:Experience; FW:Wind; FW:Fencing]: fencing and dance keys flash; treasure maps sold whole; Montalban and Raymondo need 2 defeats; **wind always blows east to west and never shifts in battle.** The wind's allowed deviation grows with level; on Swashbuckler it can come from north or south.
- **Fencing speed** rises with level ("lightning-quick" on Swashbuckler); Montalban switches to a rapier from Adventurer up [FW:Fencing; FW:Marquis_Montalban].
- **Enemy ship speed and turn bonuses at high levels** are player-reported, not documented: players on Swashbuckler can neither catch nor escape, hunter fights drag on, and one warship broadside can sink you [fan, https://steamcommunity.com/app/3920/discussions/0/4346607305578827412/]. Numbers **Unverified**.
- **1987:** on low difficulty your near misses count as hits and the enemy's near misses count as misses [FW:Cannons]. Higher levels give worse officers [dev, 1987 manual].

### 1.4 Enemy behaviour in battle

Mostly fan-documented [fan, All The Tropes "Artificial Brilliance", https://allthetropes.org/wiki/Sid_Meier's_Pirates!; FW:Naval_Combat; FW:Ship_Role]:

| Role | Behaviour |
|---|---|
| Trader | Surrenders quickly; low crew morale in boarding |
| Smuggler | Always runs; sails sloops |
| Pirate, invasion warship, Raymondo/Mendoza | Ram and board; against a big crew, grape first |
| Pirate hunter | Chain your sails, grape your crew, then close |
| Big warship, treasure galleon | Massed broadsides to destroy you |
| Escort | Never strikes on demasting or boarding; spawns from ports whose shipping was hit, bigger after repeated attacks; can become a hunter |

- AI fires only full broadsides; you can watch its gun ports open one by one and time a turn away. It often mixes round and chain mid-broadside at close range [FW:Naval_Combat; FW:Cannons]. This tell is a deliberate readability device.
- Start positions copy the sailing-map geometry, so the weather gauge is set before battle begins. Whether the AI seeks the gauge in battle: **Unverified**.
- An escaped AI ship teleports to its destination port [FW:Naval_Combat].

### 1.5 Famous pirates, hunters and villains

- **Strength scales with rank on the Top Ten** [FW:Top_10_Pirates; FW:Famous_Pirate]:

| Rank | Pirate | Ship | Treasure |
|---|---|---|---|
| 1 | Henry Morgan | Large Frigate | 10k (carries >30k gold) |
| 2 | Blackbeard | Frigate | 9k (>20k) |
| 3 | Kidd | Brig of War | 8k |
| 4 | Lafitte | Brig | 7k |
| 5 | Bonnet | Brigantine | 6k |
| 6 | L'Olonnais | Brigantine | 5k |
| 7 | Roc Brasiliano | Royal Sloop | 4k |
| 8 | Bart Roberts | Sloop of War | 3k |
| 9 | Jack Rackham | Sloop of War | 2k |

  (Individual pages give slightly lower treasure for Lafitte, Bonnet and L'Olonnais.)
- Behaviour: each sails from a fixed haven, attacks "just about anything that moves", full crew, very high morale, ships loaded with upgrades, and **duel special moves** [dev, manual "Named Pirates"]. Distinct sea-battle AI per pirate: **not found**; their difference is ship, upgrades, crew, morale and fencing.
- Beaten pirates never return [FW:Famous_Pirate] (Corsair already differs: they return in a new ship after 90 days).
- **Pirate hunters (2004):** spawn only from ports with high hostility, sail straight for your flagship, give up when you are far enough from their port; war sloops, brigs of war, frigates, large frigates (Spain: war sloop, fast or war galleon); "high crew and high cannons"; a bigger bounty means more spawns [FW:Ship_Role; FW:Bounty].
- **Pirate hunters (1987):** only once a nation is hostile, near its ports; heavily crewed and armed [FW:Ship_Role].
- **Evil Spaniards:** Mendoza Fast Galleon, Raymondo War Galleon, Montalban Flag Galleon, always all 8 upgrades; cannot be sunk, and grape always leaves one man [FW:Evil_Spaniard; All The Tropes]. Boss fights are made "fair" by forcing a boarding.

### 1.6 What players liked and hated

- **Ship choice splits into two camps:** "ram and fence" (Royal Sloop, Mail Runner) and "pound then board" (Ship of the Line). The Brig of War has no niche; the SotL chain-grape-pound routine is called overpowered [fan, All The Tropes]. "SoL just owns the caribean" after finding one 10 minutes in [fan, https://steamcommunity.com/app/3920/discussions/0/541907867757869822].
- War Canoe is "god mode" at any level; Swashbuckler's AI speed bonuses called "anti-fun" [fan, Steam thread in 1.3].
- 1987: the CRPG Addict never lost a ship battle and found encounters near-identical across nations [review, http://crpgaddict.blogspot.com/2011/01/pirates-final-rating.html].
- IGN 2004 praised variety but flagged repetition over a long career [review, summary at https://en.wikipedia.org/wiki/Sid_Meier%27s_Pirates!_(2004_video_game)].

**What makes upgrades meaningful here:** cheap, permanent, visible, scattered across ports (one per port), and each one maps to a single verb (turn, run, carry men, take hits, reach, hit). **Opponent variety** comes almost entirely from role-driven tactics (who runs, who boards, who chains) plus crew quality and morale; named pirates differ by ship and duel skill, not sea AI. **Weakness:** small agile ships plus boarding dominate; difficulty is raw speed buffs.

---

## 2. Assassin's Creed IV: Black Flag (2013) and Resynced (2026)

Sources: fan wiki pages at `https://assassinscreed.fandom.com/wiki/<Page>` (cited AW:Page); Steam guide https://steamcommunity.com/sharedfiles/filedetails/?id=205976156 [fan]; others inline.

### 2.1 Jackdaw upgrades

Costs (original 2013), from AW:Crafting_(Assassin's_Creed_IV:_Black_Flag) [fan]; R = reales:

| Upgrade | Tiers and cost |
|---|---|
| Hull armour | I free → II 1,000 R → III 4,000 R + 100 metal + 200 wood → IV 16,000 R + 200 metal + 500 wood → Elite 30,000 R + 400 metal + 750 wood |
| Broadside cannons | II 70 metal → III 2,000 R + 150 metal → IV 4,000 R + 300 metal → V 8,000 R + 350 metal → VI 12,000 R + 500 metal → Elite 20,000 R + 660 metal |
| Round shot | II 900 → III 4,000 → IV 12,000 → Elite 35,000 R |
| Mortars | I 800 → II 3,500 + 200 metal → III 8,000 + 300 metal → Elite 25,000 + 650 metal |
| Heavy shot (stern) | I 900 → II 6,000 → Elite 25,000 R |
| Ram | I 500 + 25 wood → II 2,000 + 75 wood → III 5,000 + 250 wood + 150 metal → Elite 15,000 + 600 wood + 200 metal |
| Swivel | II 700 + 25 metal → III 5,000 + 200 metal → Elite 15,000 + 400 metal |
| Chain shot | II 2,500 → III 6,000 R |
| Fire barrels | II 3,000 → Elite 8,000 R |
| Storage (heavy shot, mortar, barrels), crew quarters, cargo | 500 to 6,000 R each, cloth for crew quarters |

- **Elite plans are found, not bought:** shipwreck dives and buried treasure (Elite Hull: San Ignacio wreck; Elite Ram: La Concepción wreck; Elite Broadside: the Blue Hole) [fan, https://www.gamerguides.com/assassins-creed-iv-black-flag/guide/miscellaneous-side-activities/crafting-and-upgrades/jackdaw-upgrades]. Exploration unlocks the top tier; gold alone can't.
- **Upgrades are shown on the ship.** Darby McDevitt: "You start out with only three or four guns on each side and you can upgrade to around 20 guns on each side". Cannons stay on the top deck so players "see just how far you're progressing" [dev, Ubisoft blog 2013, https://web.archive.org/web/20131206043440/http://blog.ubi.com/assassins-creed-iv-black-flag-historical-accuracy-vs-gameplay/].
- Per-tier damage and HP numbers: not found from a reliable source (**Unverified**). The Jackdaw's own level is hidden; fully upgraded she reads as level 45 through a spyglass in one story mission [fan, https://steamcommunity.com/app/242050/discussions/0/666826703835406504/].
- Beating all legendary ships unlocks a ram-dash [AW:El_Impoluto].

### 2.2 Enemy classes: each has one tactic

Levels and capture rules [fan, Steam guide 205976156]; tactics [fan, AW class pages]:

| Class | Levels | Tactic | To capture |
|---|---|---|---|
| Gunboat | low | Two forward guns, round or grape; one swivel shot kills it | Can't |
| Schooner | 4 / 8 / 11 | Up to 8 guns a side plus fire barrels; uses speed, avoids long broadside duels | Kill 5 crew |
| Brig | 17 / 20 / 25 | ~24 guns plus a ram; alternates broadsides and ramming; fast, but fire barrels stop it | Kill 10 |
| Frigate | 23 / 29 / 38 | Up to 46 guns; heavy shot from ~29 | Kill 15 + an objective (captain, scouts, flag) |
| Man o' war | 36 / 49 / 60 | Up to 100 guns plus mortars, chain, heavy shot, fire barrels; very robust, slow | Kill 20 + an objective |

- **Level number in the spyglass, white or red** (red outclasses you) [fan, Steam 666826703835406504]. Faction is colour-coded on the hull: British yellow-black, Spanish red-brown, **pirate hunters red-black with red sails** [AW:Man_O'_War].
- **Danger is geographic:** easier north, harder south, the whole map open from the start [review, https://www.eurogamer.net/assassins-creed-4-black-flag-review].
- **Forts:** three tiers, north to south; the tier sets reload speed and wall toughness. Taking one reveals the area, adds a fast-travel point, and it fires on passing warships [AW:Fort; https://www.gamepressure.com/assassinscreediv/forts/z8594f].
- **Wanted level:** 1 = a level-25 brig; 2 = + a level-11 schooner; 3 = level-38 frigate + brig; 4 = level-60 man o' war + frigate. Lower it by sinking hunters, giving up a prize's loot, or bribing [fan, Steam guide; review, Eurogamer; https://techgage.com/article/assassins-creed-iv-black-flag-review/].

### 2.3 Legendary ships: bosses with one gimmick each

All level 75 (ordinary men o' war top out at 60) [AW:Man_O'_War; https://www.gosunoob.com/ac4-black-flag/ac4-legendary-ships/]:

| Ship | Gimmick | Counter |
|---|---|---|
| El Impoluto | Fastest; rams repeatedly; hidden bow chasers; breaks off a charge if hit hard | Punish the charge |
| La Dama Negra | Sides immune to broadsides; double mortars with no warning circles | Hit stern, bow, deck; zig-zag |
| HMS Prince | Hides in fog, wears you down with mortars; rear cannons below 25% | Close in; easiest of the set |
| HMS Fearless + Royal Sovereign | A pair that spreads into a V to catch you between broadsides; when one sinks the other sets itself on fire and rams | Focus one, fire barrels on the other |

- Hampden (senior designer): "This is the first time that you are going to come across massive ships that you can't defeat when you start the game. Only once you obtain and master better equipment…" [dev, https://vicbstard.com/interview-with-assassins-creed-4-black-flags-director-ashraf-ismail-and-senior-game-designer-michael-hampden/].
- Rogue's Storm Fortress (level 99) sets the sea on fire with mortars and calls two men o' war as backup [AW:Storm_Fortress]. Rogue also had enemy gangs ram and **board the player** [review, https://www.digitaltrends.com/gaming/assassins-creed-rogue-gameplay-first-looks-highlight-land-sea-action/].

### 2.4 Resynced (July 2026)

- Every weapon gets a secondary mode: placed carcass mortar bombs, double-shot chasers, heated broadside shot, shrapnel and sail-shredding stern barrels [dev, https://www.ubisoft.com/en-us/game/assassins-creed/news/1QoM4qTIi9ERlzDOrxeRgK/assassins-creed-black-flag-resynced-deep-dive-into-the-naval-gameplay].
- **Officers with one perk each:** Perfect Brace (timed brace cuts damage), early Ram Dash plus boarding help, extra broadside volleys [dev, same page].
- Separate naval difficulty (Forgiving / Intended / Hard): Forgiving makes the Jackdaw tankier and enemies miss more; Hard makes enemies more aggressive and maxed upgrades "required even for non-Legendary ship combat" [fan, https://game8.co/games/Assassins-Creed-Black-Flag-Resynced/archives/608937]. Complaint on Hard: "Zero readability… a couple of seconds and you're dead" [fan, https://steamcommunity.com/app/3751950/discussions/0/582803393301508142/].
- Legendary ships respawn; "we rebuilt them to be stronger, tougher, and meaner" (Guilhem Marin) [dev, Ubisoft page].

### 2.5 Reaction

- Liked: weighing a ship's cargo against how hard the fight will be; upgrades "increasingly important and desirable" [review, Eurogamer]. Sea battles "an absolute blast" (GameSpot, snippet only, **Unverified** wording).
- Hated: the upgrade grind for bigger ships "became a chore" after 20 hours [review, TechGage]; stuck against level-60 hunters in a brig [fan, https://steamcommunity.com/app/242050/discussions/0/360670708787564625/].
- Ismail: accurate prototypes were "completely unintuitive and unplayable", don't "overwhelm the player with too many variables" [dev, https://www.pcgamer.com/interview-assassins-creed-iv-black-flag-game-director-ashraf-ismail/].

**What makes upgrades meaningful here:** they are visible on the ship, they open new verbs (mortars for big ships, fire barrels for chasers, ram), elite tiers come from exploration, and named bosses are clear goals that test the fit. **Opponent variety** comes from one signature tactic per class plus a readable level number and hull colours. **Weakness:** levels hard-gate fights; a 60 beats you whatever you do, which feels like grind.

---

## 3. Naval Action and Ultimate Admiral: Age of Sail

Naval Action (Game-Labs, 2016-) is still patched in 2026, and its damage model has been rewritten many times, so every claim carries a date. The forum (forum.game-labs.net) didn't resolve; developer text comes from the Steam news feed, cited as N/<gid> = `https://store.steampowered.com/news/app/311310/view/<gid>`, and Ink's posts on Steam. Fandom wiki pages are tagged "Outdated" and undated.

### 3.1 Naval Action: armour, penetration, angling

- **Effective armour per facing** [dev]:
  - 2016-05 (Damage Model 5.0): sides 25 to 100 cm effective; penetration falls with range, long guns keep it much better than mediums, carronades fall off "sharply" after 500 m. Ink: ships of the line become "almost invincible against lower class guns at medium or long distances if they are not raked" [https://steamcommunity.com/app/311310/discussions/1/364041517009836870].
  - 2026-08: side armour by rate 1st 100, 2nd 96, 3rd 92, 4th 88, 5th 82, 6th 78 cm. Bow 50% of side, stern 15% (2026-04) [N/1840310314351259; N/1828894815565069].
- **Angling:** at 45° the planking is about 33% thicker [fan, 2016 guide, https://steamcommunity.com/sharedfiles/filedetails/?id=821905674]. 2025-10: under 45° no gun penetrates at any range [dev, N/1813041031372422]. 2026-08: each gun has three penetration ranges, depending on whether the target is angled and/or has thickness modules; a 42pd long 1500/950/400 m, medium 900/550/300 m, carronade 550/425/300 m [dev, N/1840310314351259].
- **Armour and structure are separate pools** (from 2017): armour is the planking per facing; structure is the hull underneath. Leaks start when structure drops, and structure drives masts, so a rake can demast [dev, N/75834707992597533]. Raking multiplier 3x, needs a 40° angle (2021, 2026) [dev, N/5418383147738805880; N/1828894815565069].
- **Masts have thickness** (cutter 100 to first rate 130), and the sail setting changes it: battle sails +45% mast thickness and −80% mast damage, full sails −20% thickness [dev, 2020-08, N/3670950880881683572]. Running fast makes you fragile.
- **Grape** does full damage to 400 m and none beyond; a full crew-hit broadside causes "crew shock" that stops everything for a minute (2022, 2025) [dev, N/4836332027659192626; N/1813041031372422]. From 2026 every planking hit does splinter damage to crew [dev, N/1828894815565069].
- Players: DM5 made battles much longer, "40 mins to sink a 3rd rate" [fan, DM5 thread above].

### 3.2 Gun types: three families, three trade-offs

Pre-2019 wiki numbers, 32-pounders [fan, https://navalaction.fandom.com/wiki/Weapons; https://navalaction.fandom.com/wiki/32pd_Carronade]:

| Gun | Damage | Reload | Weight | Penetration (100 m → 1000 m) | Role |
|---|---|---|---|---|---|
| Carronade | 28 | 51 s | 2.46 t | 97 → 0 cm | Close range; 5-10x crew damage |
| Medium | 35 | 66 s | 3.85 t | 99 → 89 cm | Most damage per minute (2024) |
| Long | 39 | 79 s | 4.87 t | 117 → 112 cm | Range, accuracy, penetration |

2024-01: mediums out-DPM longs; longs trade DPM for accuracy and penetration at range [dev, N/5519792046244273462]. Elite-drop gun variants (Obusier, Congreve, Blomefield, Navy) give a lighter or harder-hitting version of each family [dev, 2019, https://steamcommunity.com/app/311310/discussions/15/3557193237110167834/]. The gun choice decides the range at which a ship wants to fight, which is the most useful idea here for Corsair.

### 3.3 Crew and boarding

- Crew is assigned to focuses: sailing, gunnery, survival (pumps), repairs, boarding [dev, 2025-11, N/1816849002007235]. Fewer men slows reload more and more (2016).
- **Boarding mini-game** (~2016) [fan, https://navalaction.fandom.com/wiki/Boarding]: 15-second rounds, each side with preparation and morale. Commands Brace, Defend, Attack, Musket Volley, Fire Deck Guns, Grenades, Disengage in a rock-paper-scissors: Defend beats Attack, Attack beats Musket/Grenade/Brace, Grenade and Musket beat Defend. Win by killing the crew or taking morale to 0 while attacking.
- A "determined defender" needs 30% more attackers (2020); boarding needs 30% damage to sails, planking or crew first and works only under 9 knots (2026) [dev, N/3670950880881683572; N/1828894815565069].

### 3.4 Knowledge, upgrades and woods

- Ship knowledge (from 2017): slots unlocked by sailing that ship, filled with permanent modules; all 5 give a perk point (2024) [dev, N/2423345440419124823; N/5519792046244273462].
- **Woods are the clearest trade-off system in any game here** [dev, 2017-05, https://steamcommunity.com/app/311310/discussions/15/1327844097112367269/]: a frame wood and a planking wood. Fir is fastest but takes most splinters and fire; teak slightly slower and tanky; mahogany crew and fire resistance; live oak frame slower with good crew resistance; white oak more thickness, lower everything else. 2020: oaks give HP and structure, teaks hardness, firs speed [dev, N/3384966595870028874].
- Example build (2023): live oak frame + white oak planking gives structure +35%, armour +32%, thickness +27%, speed −5%, acceleration −10%; "works well in PvE but is pretty much a death sentence in PvP" [fan, https://steamcommunity.com/app/311310/discussions/22/4031347831098483795/]. Against an AI that can't exploit speed, tank builds dominate.

### 3.5 AI tiers

- **Elite NPCs** appear occasionally; their flagship drops elite ship notes [dev, 2019, Steam thread above]. Players (2023): they have "twice the crew and super number of marines" and hit harder, but a gold-quality NPC "will not sail with more skill. It is just a buffed ship" [fan, https://steamcommunity.com/app/311310/discussions/22/4031347929702553572/].
- Difficulty mostly from stats and loadouts: NPC boarding bonuses scale with level; line ships get "extensive boarding bonuses"; small rates less sturdy and less accurate; low-level NPCs lost accuracy modules; a "rookie preset" for 7th rates; since 2026-08 each NPC gets **one type of bonus** instead of a mix [dev, N/5519792046244273462; N/8033928544496020052; N/1828894815565069; N/1840310314351259].
- Behaviour work: low ranks no longer "turn like admirals" (2019); role-based kiting at close, mid or long range and side choice timed to reload (2024); NPCs pick the side by armour condition (2026) [dev, N/2534869043304532612; N/5519792046244273462; N/1828894815565069].
- Reception: Steam "Mixed", 4,185 positive / 4,258 negative [https://store.steampowered.com/appreviews/311310?json=1]. Combat realism praised ("combat is unmatched"); grind, steep learning curve and AI "snipers with their cannons" criticised [fan, review sample 2025-26].

### 3.6 Ultimate Admiral: Age of Sail (2020-21)

- **Crew stats:** Efficiency, Sailing, Boarding, Gunnery, Morale, Stamina; crew size is a health bar with minimum, optimal and maximum [fan, https://ultimateadmiralageofsail.fandom.com/wiki/Crew].
- **Officers** have six attributes, each feeding one crew stat (INT efficiency, DEX sailing, STR boarding, PER gunnery, WIL morale, END stamina) [fan, https://ultimateadmiralageofsail.fandom.com/wiki/Officers]. Veteran recruits cost more; veterancy unlocks perks (Rigging +25% speed) [fan, https://steamcommunity.com/app/1069650/discussions/0/3108014245256755732/].
- **Morale and condition** [fan, 2020-03, https://steamcommunity.com/app/1069650/discussions/0/2144217412756729460/]: each shot costs ~1% condition, regained from stamina; low condition slows reload. Morale falls with damage, casualties, lost officers and masts, and rises when dealing damage. At ≤16% the ship wavers and tries to flee; at 0% crew shock.
- Surrendered ships drift and need a boat sent (**Unverified**, snippet of https://www.aos.ultimateadmiral.com/post/naval-gameplay); unclaimed, they regain a skeleton crew and rejoin [fan, https://ultimateadmiralageofsail.fandom.com/wiki/Boarding].
- **Upgrades with explicit costs** [fan, https://ultimateadmiralageofsail.fandom.com/wiki/Upgrades]: Clear Powder +15% damage / −40% magazine HP; Lightweight hull −10% armour / +10% capacity; Wadding +5% damage / +2.5% reload.
- **AI difficulty:** "Adaptation" scaled enemies to the player's forces and caused spikes, so it became optional and "Classic" the default; harder battles pay more [dev, https://store.steampowered.com/news/app/1069650/view/4023377846272097144; https://store.steampowered.com/news/app/1069650/view/3444640809419488885]. Review: "an early mistake can cost you the entire campaign" [review, https://strategyandwargaming.com/2020/11/29/deep-tactical-combat-in-shallow-waters-admiral-age-of-sail-review/].
- Age of Sail II (Akella, 2001): round, chain, grape, canister; crew losses slow sail handling, repair and reload and raise the chance to strike; interface "overcomplicated" [https://en.wikipedia.org/wiki/Age_of_Sail_II].

**What makes upgrades meaningful here:** each wood and many modules trade one stat for another, and the gun family sets the range you fight at. **Opponent variety:** mostly stat buffs, which players see through ("just a buffed ship"); the developers' later fixes were behaviour by role and one bonus type per NPC. **Weakness:** realism costs readability and time (40-minute fights), and scaling the enemy to the player makes difficulty spike.

---

## 4. Sea of Thieves and Skull and Bones

### 4.1 Sea of Thieves: horizontal, cosmetic progression

- Rare's progression walkthrough: "Our goal has always been to allow players to play together, not putting barriers up between new and old players" [dev, quoted at https://www.resetera.com/threads/progression-in-sea-of-thieves-official-walkthrough.11164/]. Progress unlocks voyages and cosmetics, never stats.
- **Skeleton ships** [fan, https://seaofthieves.fandom.com/wiki/Skeleton_Ship]:
  - Sloop or galleon, scaled to the player's ship size.
  - A random crew type (normal, plant, gold, shadow) and **one random curse ammo, shown by banners on the stern**, so the threat is readable before you engage.
  - Crew roles: captain, deck gunners, a sniper in the crow's nest, and a repair crew that patches holes **but cannot bail**. That is their built-in weakness: flood them.
  - They match your speed alongside, fire, try to ram, and never board.
- **Skeleton Fleet:** 3 waves of 1-2 ships, the last with a Skeleton Captain and richer loot; announced by a ship-shaped storm cloud [fan, https://seaofthieves.fandom.com/wiki/Skeleton_Fleet].
- **Ghost Fleet / Burning Blade:** scripted, not AI; toughness as hit counts (grunt 3 hits, Ashen Dragon 10, Burning Blade 24); waves building to a flagship; Flameheart taunts by voice [fan, https://seaofthieves.fandom.com/wiki/Ghost_Fleet].
- **Cursed cannonballs** do no damage, only effects (crew: grog, limp, sleep, jig; ship: anchor, helm lock, ballast, rigging), carried 5 at a time, and a loaded curse shows coloured smoke at the muzzle, so it can be countered [fan, https://seaofthieves.fandom.com/wiki/Cursed_Cannonball].

### 4.2 Skull and Bones (2024): vertical gear score

- Ships have MMO roles (tank, DPS, healer) and one signature perk each (Bedar +25% ram damage and rams flood; Hulk +250% brace; Cutter heals allies within 100 m) [fan, https://skullandbones.fandom.com/wiki/Ships].
- Weapon families (culverin, demi-cannon, long gun, bombard, mortar, torpedo, rocket and more), tiers I-V, elemental variants; damage types Basic, Piercing, Flooding, Fire, Explosive; armour gives % resistance per type, "allowing for countering certain builds" [fan, https://skullandbones.fandom.com/wiki/Weapons].
- Ship rank is the sum of ship and weapon power [review, https://www.rockpapershotgun.com/skull-and-bones-review].
- Reviews:
  - RPS: "levels are all that matter, not positioning"; could not "so much as scratch enemy ships" in the next region; boarding "a mere cutscene".
  - Eurogamer: weapons and damage types create counterplay, but "showiness is no real substitute for tactical depth"; boarding an "anticlimactic fade-to-black"; "glacial XP accruement" [review, https://www.eurogamer.net/skull-and-bones-review].
  - IGN: combat "tactical and consistently entertaining", but nothing in the world needs the best gear [review, https://www.ign.com/articles/skull-and-bones-review].

**Lesson pair:** Sea of Thieves makes options horizontal (a curse is a different tool, not a bigger number) and gives AI ships a readable weakness. Skull and Bones shows the cost of the opposite: level gates replace positioning, and gear outruns any reason to own it.

---

## 5. Other games worth stealing from

### 5.1 Akella series (Sea Dogs, Pirates of the Caribbean 2003, Age of Pirates 2: City of Abandoned Ships)

The closest relatives of Corsair's design: an RPG captain whose skills, officers and ship class decide naval fights.

- **Ship classes 1 (biggest) to 7 (smallest)** [fan, Sea Dogs manual, https://www.scribd.com/document/455556886/Sea-Dogs-Manual].
- **Encounters scale with player level**, and an option caps that level by your ship: "capped at 2 x (8 - your ship class)" [fan, NathanKell 2004, https://www.piratesahoy.net/threads/level-ship.860/]. A captain in a small ship meets small-ship trouble.
- **Captain sea skills:** navigation, accuracy, cannons, boarding (grappling), defence, repair, plus leadership and luck (names vary by game) [fan, COAS manual snippet, https://www.scribd.com/document/341684625/Age-of-Pirates-2-City-of-Abandoned-Ships-UK-Manual-PC-pdf; **Unverified** exact names].
  - Navigation sets the ship class you may command without penalty: "Always own ships that you can Navigate" [fan, https://steamcommunity.com/app/937940/discussions/0/5367692919517404983/].
  - **Officers fill posts and lend their skill** (Boatswain: leadership half, grappling full; Cannoneer: accuracy and cannons; Navigator: sailing and half luck). "You don't need to have the skill yourself" [fan, same thread; New Horizons FAQ https://www.piratesahoy.net/wiki/new-horizons-faq/].
  - Boarding: the enemy captain duels you if his leadership plus melee beats yours, or his ship is 2+ classes bigger [fan, New Horizons FAQ].
- **Perks** [fan, https://www.piratesahoy.net/wiki/new-horizons-abilities/]: Fast Reload → Pre-reloading; Increased Ship / Sail / Crew Damage → Critical Shot; Basic → Professional Ship Defence; Maneuverability, Club Hauling, Storm Helmsman; Long Range / Instant Boarding; Emergency Repairs. Some are learned from defeated "civilized" enemy captains.
- **Difficulty** (To Each His Own): tougher enemy stats, heavier ship variants (Heavy Galleon for Galleon), more enemies, worse loot, fewer saves. One player: difficulty "isn't doing much beside limiting your saving location" [fan, https://www.piratesahoy.net/threads/game-difficulty-level.27259/].
- Advice: early guns barely dent hulls, so shoot sails first; boarding party sizes follow the crew ratio [fan, snippet, https://www.piratesahoy.net/threads/new-to-sea-dogs-city-of-abandoned-ships-i-dont-know-how-to-start.33021/].
- Reception: COAS Metacritic 61; PotC 64-65, "mixed or average" [https://en.wikipedia.org/wiki/Age_of_Pirates_2:_City_of_Abandoned_Ships]. Deep systems, weak presentation.

### 5.2 Corsairs Legacy (Mauris)

- Classes 7 (cutter) to 2 (lineship), each in **merchant, common or military variants** [dev, https://corsairslegacy.com/article/corsairs_legacy_ships].
- Five upgrade tracks (crew, hold, speed, sails, hull), 5 levels each at "+3% of the current value"; a fully upgraded lower-tier ship can beat an unupgraded next-tier one [dev, same page].
- Stronger ships' crews have more HP and damage per hit (crew quality as a stat); grape the crew down and any ship can be taken [dev, same page].

### 5.3 Windward (Tasharen)

- Danger and rewards rise with distance from the start; AI ships play by the player's rules [dev, https://store.steampowered.com/app/326410]. Some ship types appear only in zones of level 100+ [fan, https://windward.fandom.com/wiki/Ships].
- Factions as ship roles: Valiant combat/defence, Consulate support, Sojourn speed and accuracy, Exchange trade, Pirate attacks anyone [fan, https://windward.fandom.com/wiki/Factions].
- Talents give 5-15% passives, reset cheaply in port; new threats (sail-damaging abilities) arrive only in higher zones [fan, https://windward.fandom.com/wiki/Talents].
- Blueprint of a ship type: 10% on first kill, guaranteed by the 10th [fan, Ships page].
- Player reaction: not researched in depth (no review found).

### 5.4 Abandon Ship (Fireblade)

- FTL-like crew stations; crew skills Navigation, Reload, Repair, Melee, Heal, each tied to a specialist [fan, https://abandonship.fandom.com/wiki/Crew].
- **Ammo as sidegrades:** Roundshot all-round; Canister crew only, no hull damage; Double-shot close and heavy but slow; Flaming low damage but fires; Hull Cracker cracks hulls [fan, https://abandonship.fandom.com/wiki/Weapons].
- Variety from regions (ghost ships, monsters) and battle conditions (tidal waves, lightning, blizzards) [dev, https://store.steampowered.com/app/551860].
- Liked: Eurogamer praised the "well-realized" crew management [review, via https://en.wikipedia.org/wiki/Abandon_Ship_(video_game)].

### 5.5 Sail Forth and Port Royale 4

- Sail Forth: some weapon categories are "straight upgrades" of others; allies "incompetent" and can't be ordered; the fleet outgrows enemies so late game is "rarely… a worthy challenge"; forts are the only hard content [review, snippet, https://www.softpedia.com/reviews/games/pc/sail-forth-review-536703.shtml].
- Port Royale 4: turn-based hex combat; **captains level up and bring tactics** on 2-3 turn cooldowns (free 180° turn, extra reload) [fan, https://portroyale4.fandom.com/wiki/Vessel's_Tactics]; critics called fights "a rather dull affair" [review, https://www.gamerevolution.com/review/662221-port-royale-4-review-pc-ps4-switch-xbox-one].

---

## 6. Patterns Corsair should adopt

Corsair already has (PRD, `ships.json`, `upgrades.json`): twelve classes, six upgrades priced by the work on each class, chain and grape free, readable surrender rules, crew-count effects, bold/cautious pirates with a nerve value, famous pirates with veteran crews (morale 90) who come back after 90 days. The patterns below build on that; they are about effects, opponents and difficulty, not price.

### 6.1 Opponent archetypes: one doctrine each, readable before the fight

Every source that got this right (Pirates! roles, Black Flag classes, SoT skeletons) gives each opponent **one** tactic the player can learn and counter. Suggested doctrines, as data on the ship's role:

| Archetype | Doctrine | Strikes / breaks off when | Tell the player sees | Counter |
|---|---|---|---|---|
| Merchant | Runs on her best point of sail; fires stern chasers only when caught | Demasted, outmanned, or hull below half | Light hull, deep in the water when laden | Chain shot, the weather gauge |
| Smuggler | Runs in shoal water a deep hull can't follow | Caught | Small fore-and-aft rig near a coast | Shallow-draught ship, cut her off |
| Navy patrol | Keeps range, round shot at the hull, holds the weather gauge, fights in pairs; never boards | Rarely; retreats to port when crippled | Navy colours, open gun ports, sails in company | Close fast and board; patrols are short of boarders |
| Pirate | Chain to slow you, grape to thin the crew, then grapple | Losing the boarding, or outgunned at long range | Sails straight at you, no flag until close | Keep range with round shot; don't let her rake |
| Pirate hunter | Chain then grape, chases far but turns back at a range from home | Far from her port | Red hull and sails (Black Flag), named in the tavern | Outrun upwind, or fight on your terms |
| Famous pirate | His pirate doctrine plus one signature (see 6.2) | Only by boarding or demasting | His flag, a tavern rumour naming his ship and fit | Learn the signature |
| Treasure galleon / flota | Massed broadsides; escorts screen her | Escorts gone | Convoy formation | Peel off the escort, then the galleon |

Add **one tell before each broadside** (Pirates!' gun ports opening one by one; Black Flag's mortar circles; SoT's cursed-shot smoke). Fair difficulty needs readable threats.

### 6.2 Famous captains: rank sets ship and fit, a signature sets behaviour

- Ship size and upgrade count scale with Top Ten rank (Pirates!: Rackham in a war sloop, Morgan in a large frigate). Corsair's "in their own classes" should follow rank: the top three in frigate-class ships, fully fitted; the bottom three in sloops with two or three upgrades.
- Give each one **one signature** (Black Flag's legendary ships prove a single gimmick makes a boss memorable): a rammer who charges and breaks off when hit hard; a fireship captain; a shoal runner who fights near reefs; a pair of captains who sail together and try to trap you between them; one who strikes colours and fires on you when you close (a ruse). Two or three per game is enough; the rest are good captains without a trick.
- Scout before the fight: the tavern names his ship and, for a price, his upgrades (Pirates!' barmaid). Knowing the fight in advance makes upgrades a plan, not a guess.

### 6.3 Captain and crew quality as separate knobs from ship stats

Akella's games, 1987 Pirates! and Corsairs Legacy all separate *what the ship is* from *who sails her*. Suggest four captain attributes per AI ship (0-100), drawn by role and Top Ten rank:

| Attribute | Drives |
|---|---|
| Gunnery | Reload time and spread (crew drill) |
| Seamanship | Turn rate, how well she holds a point of sail, whether she seeks the weather gauge |
| Boarding | Fighting strength per man, the duel's speed |
| Nerve | When she strikes or runs (Corsair already has this) |

Typical spreads: merchant 20-40 (nerve low), patrol 50-70 gunnery and seamanship but low boarding, pirate high boarding and nerve, famous pirate 70-95 across. Crew quality (green, regular, veteran, elite) multiplies reload and boarding, as in 1987 where warships, hunters and pirates reload faster than merchants. This makes a pirate brig and a navy brig of the same class fight differently without new hulls.

### 6.4 Upgrades: trade-offs and class fit, not flat bonuses

This is a design proposal. The 2026-10-10 balance pass kept upgrade effects unchanged and measured them with `pnpm probe:battle upgrades`; the trade-offs below would change those numbers, so they need a new probe baseline. Following the "explain numbers" UI rule, the shipwright row should show the downside next to the upside (for example "+20% hull, −1 speed"). Otherwise a trade-off is just a hidden tax.

- **Give every upgrade a cost besides gold**, so it fits some classes and not others (the "straight upgrade" complaint in Sail Forth and Skull and Bones):
  - Iron scantlings: +hull, −speed (weight). Right for a merchantman or galleon, wrong for a sloop.
  - Triple hammocks: +crew, −cargo space. A boarding sloop wants it; a trader doesn't.
  - Fine-grain powder: +range; a small chance a gun bursts when fired hot (or more fouling smoke). A frigate holding range wants it.
  - Bronze cannon: lead correction and faster reload (Pirates!' predictive aim), cost per gun; strongest on big batteries.
  - Copper sheathing: +speed and no fouling; cost per hull point; the runner's upgrade.
  - Cotton sails: better upwind, worse in heavy weather (sails tear sooner).
- **Show each upgrade on the 3D ship** (Pirates!' white sails and copper hull; Black Flag's visible guns). Show enemy upgrades too, so a coppered pirate tells you she will catch you.
- **Make one or two upgrades found, not bought** (Black Flag's elite plans in wrecks; Pirates!' one-upgrade-per-port): a port's shipwright offers only some upgrades; a famous pirate's hoard or a sunken wreck holds a rare one (for example "Long nines": bow and stern chasers that reach further).
- **AI ships carry upgrades by role** (Pirates!: warships 4-6, traders 0-2). Pirates often coppered; navy often scantlings and bronze; merchants rarely anything. Taking a fitted prize is a reward (Pirates!: each upgrade adds a quarter of the sale value).
- **Gun family as the biggest class-fit choice** (Naval Action's carronade, medium and long): carronades lighter and deadlier to crew but useless past close range (the boarder's battery); long guns heavier, slower to reload, accurate at range (the patrol's battery). One choice per ship decides the range she wants to fight at, and the enemy's battery tells the player where not to be.
- **One hull-wood or build choice at purchase** (Naval Action's woods, UA's Lightweight hull): for example a fast light build (more speed, less hull) or a stout one (more hull, slower). A trade-off the player picks once per ship.
- **AI elites get one kind of bonus, not all of them** (Naval Action, 2026): a famous pirate's ship is coppered *or* heavily manned *or* long-gunned, which gives her a shape the player can read and counter.
- **Ammo as horizontal options** (SoT curses, Abandon Ship): beyond round, chain and grape, consider double shot (close range, heavy, slow reload) and heated shot (fires, risky near your own powder). A tool for a situation, not a stronger number.

### 6.5 Difficulty knobs

Measure each separately and expose them as the five levels:

1. Enemy captain attribute range (gunnery, seamanship, boarding, nerve), not raw speed.
2. Enemy upgrade count per role.
3. Wind behaviour in battle: steady on the easiest level, shifting on the hardest (Pirates!' Apprentice wind).
4. Near-miss forgiveness: your near misses hit, theirs miss, on the easiest levels (1987).
5. Encounter strength capped by the player's ship class (PotC's "2 x (8 − class)" cap): a captain in a sloop doesn't meet frigates as ordinary traffic.
6. Hunter strength and count tied to the bounty (Pirates!, Black Flag's wanted tiers), never to the player's ship size alone.

Keep "enemy is faster than physically possible" off the list: Pirates! players called it "anti-fun".

### 6.6 Danger shown on the map and in the spyglass

- Colour or icon for a threat versus the player's own ship (Black Flag's white/red level), worked out from both ships' strength and both captains' quality, not from a level number.
- Danger by region: patrols heavier near capitals, pirates heavier near havens, the toughest famous pirates far from the starting waters (Black Flag north to south, Windward's distance).

## 7. Pitfalls to avoid

- **Level gates instead of play.** When a number decides the fight, positioning stops mattering (Skull and Bones, Black Flag's level-60 hunters). Keep an underdog win possible through the weather gauge, raking and boarding.
- **Straight upgrades.** If one choice is always better, it is a tax, not a choice (Sail Forth, Skull and Bones). Every upgrade needs a cost besides gold.
- **One dominant ship and plan.** Pirates!' Ship of the Line with chain-grape-pound, and the War Canoe "god mode". Keep the hull families distinct, and let enemies counter the favourite plan (patrols keep range against boarders; pirates board ships that sit back).
- **Cheating speed as difficulty.** Pirates!' Swashbuckler speed bonus.
- **Unreadable threats.** Black Flag Resynced Hard: "a couple of seconds and you're dead". Every big hit needs a tell.
- **Grind for upgrades.** Black Flag's big-ship grind "became a chore"; Skull and Bones' "glacial XP". Upgrades should come from voyages that are fun anyway (prizes, hoards, wrecks).
- **Gear with nothing to use it on.** Skull and Bones: the best items have no fight that needs them. Each top-tier upgrade needs a famous pirate or treasure fleet that rewards it.
- **Boarding as a cutscene.** Skull and Bones was panned for it. Keep the duel.
- **Identical encounters.** The 1987 CRPG Addict found every nation's ships the same. Doctrine and captain quality must show in how a ship sails, not only in her stats.
- **Buffed stats as "elite" AI.** Naval Action players: "will not sail with more skill. It is just a buffed ship." Elites need behaviour (the doctrines in 6.1), not just more men.
- **Enemies scaled to the player's own strength.** UA: Age of Sail's "Adaptation" caused difficulty spikes and was made optional; it also makes upgrades feel pointless. Scale by region, bounty and a ship-class cap instead.
- **Difficulty that changes nothing but save rules** (Sea Dogs: To Each His Own).
- **Realism that kills readability** (Ismail on Black Flag's early prototypes; Naval Action's learning curve, section 3).
