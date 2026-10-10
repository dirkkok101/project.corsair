# Project Corsair: game loop design reference

Prepared 2026-10-10 for Dirk Kok. One section per loop: purpose, player verbs, feedback, failure cost, what it feeds, then 1987 vs 2004 vs Corsair (built or planned), with the comparison games where they teach something, and an implication for Corsair.

## Sources and how to read the tags

Corsair docs were first read from github.com/dirkkok101/project.corsair, main at c90be65 (pushed 10 Oct 2026, 10:15 SAST). The Corsair statements were refreshed against main at 7e639e0 (10 Oct 2026, 13:35 SAST): treasure maps, digging, landmarks and revenge built since, and 3D the only sea renderer.

| Tag | Source |
|---|---|
| [PRD §n] | docs/project-corsair-prd.md, section n ("Built" notes = shipped; others = planned) |
| [SCN] | docs/project-corsair-scenes.md |
| [FPT] | docs/design/famous-pirates-and-treasure.md |
| [ORIG] | docs/reference/pirates-original-games.md (its own [87]/[04]/[WIKI] citations carry through) |
| [SMD] | docs/reference/pirates-sid-meier-design.md |
| [TBN] | docs/reference/pirates-trading-battles-navigation.md |
| [3D] | docs/reference/pirates-3d-style.md |
| [CAL] | packages/data/content/calendar.json (code, current day length) |
| [87 Heading] | 1987 MicroProse manual, http://www.antimon.org/dl/c64/misc/piratesdoc.html, by section heading |
| [04 p.n] | 2004 Firaxis PC manual, https://cdn.cloudflare.steamstatic.com/steam/apps/3920/manuals/manual.pdf, printed page |
| [IGN], [GDC], [PAX] | Sid Meier: IGN Retro Developer Commentary (youtube.com/watch?v=eK4kkxFOi8A), GDC 2010 (bY7aRJE-oOY), PAX/EGX 2020 (TU42GQoXBHU), as summarised in docs/reference/pirates-sailing-combat-rewards.md ([SCR]) |
| [BF-W] | Prima guide, Black Flag Wanted System: primagames.com/eguides/assassins-creed-iv-black-flag-eguide/reference-analysis/the-wanted-system |
| [BF-N] | Prima guide, Black Flag Naval Guide: .../reference-analysis/naval-guide |
| [BF-KF] | Prima guide, Kenway's Fleet: .../side-quests/kenways-fleet |
| [BF-GF] | GameFAQs thread on Jackdaw resources: gamefaqs.gamespot.com/boards/706182-assassins-creed-iv-black-flag/71819926 |
| [BF-R] | Black Flag Resynced (2026) Jackdaw guide: consolepulse.com/multiplatform/assassins-creed/guides/complete-jackdaw-guide-ac-black-flag-resynced |
| [SoT-EM] | Rare, "All About Emissaries": seaofthieves.com/news/all-about-emissaries |
| [SoT-TR] | Rare support, Trade Routes FAQ: support.seaofthieves.com/articles/360021127939 |
| [SoT-WC] | Windows Central interview on cosmetic progression: windowscentral.com/the-sea-of-thieves-vision-interview |
| [SoT-M] | Metro interview with Mike Chapman, 2018: metro.co.uk/2018/02/13/sea-of-thieves-end-game-revealed-rare-interview-with-lead-designer-mike-chapman-7308093/ |
| [SoT-SH] | Sea of Thieves wiki, Ships: seaofthieves.wiki.gg/wiki/Ships |
| [SoT-FD] | Sea of Thieves wiki, Ferry of the Damned: seaofthieves.wiki.gg/wiki/Ferry_of_the_Damned |

Fan wikis and strategy guides are secondary sources; manual pages and designer quotes are primary.

## 0. How the loops nest

Four time scales, each wrapping the one below:

1. **Moment (seconds to 5 min):** sail a leg, an encounter, a battle, a duel, a trade screen, a dance. Pillar: every activity resolves in 1 to 5 minutes [PRD §1].
2. **Voyage (15 to 45 min sitting):** leave port, hunt or trade, come back, divide the plunder. "A typical loop takes 5 to 15 real minutes" [PRD §2].
3. **Career (6 to 12 real hours, 20 to 30 game years):** rank, romance, treasure, family, age, retirement score [PRD §1, §2].
4. **World (continuous, player optional):** economy, traffic, wars, news, famous pirates [PRD §5, §6, §12, §13].

Sid's rule that governs all of it: the career on the world map is the centre of gravity, and every minigame must be short enough that the player never loses track of it [SMD; IGN 18:02-18:50]. The 2004 manual's timing table shows the same structure: a day every few seconds at sea, slower in sea combat, frozen in duels, land combat, trading and menus, about six months to refit after dividing, three to twelve months in prison [04 p.82].

---

## 1. Sailing and navigation (world map)

**Purpose.** The hub and the only place time flows. It converts distance into time (the career's real currency), sets up every encounter, and is where the player spends most minutes [PRD §1, §4; SCN S1].

**Player verbs.** Steer; pick a heading against the wind; set sail state; plan a route on the chart; engage autopilot; accelerate time; tack (B holds best upwind, T comes about); intercept (I); land on a beach; enter port (E).

**Feedback.** Compass rose with wind arrow, point-of-sail colour (green best, amber pinching or running, red in irons), speed in knots, polar ring [3D]; sail shape and yard bracing per point of sail [SCN S1]; audio (rigging sings close-hauled, sails flap in irons, shanty tempo follows speed) [PRD §4]; HUD route length and next-leg bearing; "Sail ho!" callout [PRD §4].

**Failure cost.** Time (upwind legs, calms). Grounding in shallows costs hull and 1 to 3 days for deep-draft ships [PRD §3]. Storm damage to sails and crew is specified but "not modelled yet" [PRD §3]. Hull fouling (up to 20% slower) is planned [PRD §7].

**Feeds.** Encounters (loop 2), trade route choice (loop 7), food and morale burn (loop 8), ageing (loop 15). The chart's voyage planner ties sailing directly to trading [PRD §4].

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Model | Point of sailing per rig; diagonal-from-astern fastest; fleet moves at the speed of its largest ship; clouds show wind and storm fronts give strong wind but can trap you [87 Travel by Sea] | Two sail states (full, reefed); ship table gives best points of sailing; sail upwind slowly on the map, "stop dead" in battle; white clouds are gusts to ride, black clouds damage [04 pp.19-20, 27, 106; IGN 12:26-17:16] | Per-rig 16-point polar, wind strength steps, sail condition, crew factor, load factor, currents; same function drives AI [PRD §4]. Built |
| Navigation skill | Sun sights with an astrolabe for latitude, dead reckoning for longitude; Apprentice gets a sailing master [87 Take a Sun Sight] | Removed; map always known; Navigation skill and Navigator specialist add speed [04 pp.15, 110] | Whole map visible, fog of war deferred; chart planner, auto-routing on sea lanes, autopilot into port [PRD §3, §4]. Built |
| Wind complaint | "A long tack to windward... 'twas always a tiresome bit" [87 Memoirs] | Upwind slog "gets a little old" [IGN] | Roaming highs and lows, westerly spells and coastal land breezes cut east wind from 94% to about 59%; east is 1.09x as slow as west [PRD §3]. Built |

**Comparison games.** Black Flag treats the ocean as the hub with islands as points of interest, wind as only a small speed bonus, and cut tacking because it fought shooting [TBN]. Sea of Thieves has no minimap or waypoints; navigation is chart, compass, landmarks [TBN]. Both say "believable, not realistic" [TBN].

**Implication for Corsair.**
- Corsair now has the deepest sailing model of the four games plus the strongest assists (planner, F autopilot, I intercept). The risk is that autopilot turns the hub into fast travel and removes the decisions. Keep decisions on the map: which lane (pirate risk is already shown per lane), when to cross a storm, beat along a coast at night with the land breeze, shallow-draft shortcuts.
- Grounding, storms and fouling are the only failure costs sailing has; two of three are unbuilt. Until storm damage exists, weather is scenery with a speed effect.
- Fog of war is deferred, so exploration has no hook yet. The treasure slices shipped without it: a held map's landmark stands on its coast in 3D for the captain to recognise from the sea [FPT], but the chart already shows every coast. Decide whether discovery matters before lost cities.
- Clock maths, see loop 15: with the day at 771 ticks (26 s at 1x, 13 s at the default 2x cruise) [CAL], a game year of open sea is about 1.3 real hours at 2x. The PRD still quotes 540 and 1,080 tick days; the doc has drifted from the code.

---

## 2. Encounter, pursuit and evasion

**Purpose.** The decision beat between sailing and fighting: what is that sail, is she worth it, can I take her, can I escape her. It is what makes a voyage risky and gives the world faces.

**Player verbs.** Spot; hail (H within 3 tiles); read cargo, destination and news; attack from the hail panel; buy food from a friendly ship; intercept; run; duck into a harbour; sail into an AI fight already under way.

**Feedback.** Nation pennants, hail panel with cargo and destination, the attack button says what it will cost ("angers the English") or that it is lawful under a letter [PRD §4; apps/web/e2e/world.spec.ts]; AI-vs-AI fights sound for 18 game hours with a HUD direction callout [PRD §6]. Ship name labels and the fights' gun smoke went with the 2D view (to come back in 3D), and hover-to-name waits on the mouse controls, switched off for now (apps/web/src/main.tsx).

**Failure cost.** Being caught by a stronger pirate means a fight you may lose (loop 3). Attacking the wrong flag costs 20 standing [PRD §9.1].

**Feeds.** Combat, standing (loop 9), news (loop 16), food (loop 8).

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Approach | Staged: Sail Ho (continuing is a nearly foolproof evasion), Ship in View, See Her Colors, then sail away, talk, or attack; pirates and hunters may attack regardless [87 Encounters at Sea] | Ships appear within lookout range (time of day, weather); colour stripe and hull tone tell nation and role; ships send warnings, challenges, news; a warning gives time to take the weather gauge or run [04 pp.28-30] | Hail within 3 tiles stops the clock and shows name, nation, class, cargo, destination, news [PRD §4]. Built. Attack from the hail panel. Built (e2e test) |
| Running | Choose flagship before battle; escaping an undamaged enemy may cost a fleet ship [87 Escape From Battle] | "There is no law that says that you have to fight anybody": find a faster point of sailing, or duck into a city [04 p.30] | Pirates chase within 20 tiles, give up past 30 or when you dock; hunters won't fight under a feared port's guns (5 tiles town, 9 city) [PRD §5, §6]. Built |
| Who hunts you | Encounter rolls only [ORIG 5.3] | Real ships on real routes; hostile nations send pirate hunters [04 p.38] | Pirates weigh yield against odds (bold 0.6x, cautious 0.9x, nerve 0.6 to 1.2); patrols hunt at -30 standing [PRD §5, §6]. Built |

**Comparison games.** Black Flag's spyglass shows a ship's hold before you commit [TBN; BF-N]. Its Wanted level escalates the hunters sent, from a brig at level 1 to a frigate plus a man-o'-war at level 4 [BF-W].

**Implication for Corsair.**
- Corsair already has Black Flag's "see the hold before you attack" via hailing, and the 1987 "beat before the fight". Good.
- The measured pirate rate is a cliff: the starting brig meets a pirate about 0.41 to 0.45 times per voyage, a well-manned one about 0.08, a fully armed brig almost never [PRD §6]. The PRD itself flags it. Once the player is strong, danger has to come from somewhere else: bounty-scaled hunters (planned [PRD §12]), famous pirates, wars, escorts. Without them, mid-career sailing goes quiet.
- Shadowing, avoiding and false colours are still unbuilt [PRD §4]. False colours are the cheapest way to add a deception verb to this loop.

---

## 3. Naval combat (ship to ship)

**Purpose.** The signature action minigame: turn sailing skill into prizes, standing and fame. Its real job is to set up a capture, not to sink.

**Player verbs.** Steer, set sails (cruise, stop), fire the broadside that bears (Space, or Q/E by side), choose ammo (round, chain, grape; Tab or 1 to 3), close to board (G), break off.

**Feedback.** Firing arcs on the water lit when ready; per-side status (ready, loading, not bearing, out of range); shot type readable in flight and on impact; damage on the model (sails to half canvas then bare poles, hull smokes then burns, masts fall with a HUD callout "Her foremast goes by the board!"); "wavering" when the enemy may strike; G offers the boarding odds [PRD §9.1; 3D].

**Failure cost.** Lose to a pirate: plunder chest and hold go to her purse, plus the most valuable non-flagship ship; the captain's own purse is safe. Lose to a nation: fined half the purse. Either way let go with at least a tenth of the hull [PRD §6, §9.2]. Planned: prison and marooning once ageing exists [PRD §9.2].

**Feeds.** Plunder and prizes (loop 5), standing and bounties (loop 9), crew losses and morale (loop 8), fame and Top Ten (loop 13), world economy (cargo never arrives) [PRD §6].

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Controls | Steer, full or battle sails, fire broadside; reload speed depends on crew morale; changing sails halts reloading [87 Battle at Sea] | Steer, full or reefed, fire; broadside auto-picks side; reload by crew count; partial broadsides [04 pp.32-33] | Built as above; reload 4 s; short-handed reloads slower, extra hands up to 25% faster [PRD §4, §9.1] |
| Damage | Effect scales with guns vs target size [87] | Four systems: hull, sails, crew, cannon; demasted ships "may surrender at your next approach" [04 pp.34-35] | Hull, sails, crew, dismounted guns; raking bonus; criticals beyond dismount wait [PRD §9.1] |
| Tactics | Weather gauge lets a small ship rake a big one with impunity [87 The Weather Guage] | "Always hit 'em from windward"; Sydney's profit playbook: scare at range, close off bow or stern, grape, board; every ball lowers resale value [04 pp.14, 34] | AI by role: merchants run, patrols keep range, pirates come in on the bow or stern with chain and grape and grapple when you are hurt [PRD §9.1] |
| Ending | Distance or nightfall [87] | Victory, defeat, or draw at loss of sight or nightfall [04 p.36] | Sunk, struck, boarded, escaped, fled, lost; drawing clear past 36 tiles for 8 s; 10-minute cap [PRD §9.1] |
| Balance | | | Brig beats a pirate sloop about 3 in 4; loses to a frigate 9 in 10; a famous pirate beats a stock 10-gun brig 39 of 60 [PRD §9.1; FPT] |

**Comparison games.** Black Flag: disable then sink (fast, half the cargo) or board (full cargo); boarding halts the rest of a fleet fight and a boarded ship can be used to repair [BF-N; BF-GF]. Sea of Thieves: no health bar, holes flood, you patch and bail [TBN]. 2004 was criticised for slow, dodgeable cannonballs [3D].

**Implication for Corsair.**
- The verbs match 2004 almost one to one; depth comes from position and the four damage systems, which is the right call [SCR takeaways 5-6].
- Fights start 24 tiles apart and can run 10 minutes. The pillar says 1 to 5 [PRD §1]; [TBN] recommends 2 to 4. Instrument median fight length in the headless runner and treat over 5 minutes as a bug.
- Night does not end a battle in Corsair. Nightfall was the escape valve in both originals and is a cheap, readable rule.
- Shots now fly at about a second to gun range and can be dodged by turning [3D]. Watch for the 2004 "floaty cannonball" complaint.
- Keep sinking visibly worse than capture: today a sink gives five 50-gold barrels and survivors [PRD §9.1], a capture gives purse, cargo and the hull. That gap is the whole reason to use chain and grape.

---

## 4. Boarding and the duel

**Purpose.** The personal climax of a fight: the captain's skill can carry an outnumbered crew. The same rig serves mutiny, rival suitor, villain and fort commander [SCN S5, S7].

**Player verbs (planned duel).** Three attacks (high, mid, low), three parries, dodge or jump; weapon choice (rapier, cutlass, longsword) [PRD §9.2]. Built today: close to board (G), hold within 1.6 tiles for 3 s, sail clear past 2.5 tiles to cut the grapples [PRD §9.1].

**Feedback.** Planned: two health strips, a crew-push bar, portraits [SCN S5]. Built: boarding odds shown before you commit [PRD §9.1].

**Failure cost.** Built: crew x role factor decides, morale scales it 0.7 to 1.2, both sides bleed men [PRD §4, §9.1]; a lost boarding is a lost battle (loop 3). Planned: captured, wounded or thrown in the sea, losing the ship [PRD §9.2].

**Feeds.** Prize capture (loop 5), crew losses (loop 8), captain wounds and health (loop 15), villain and family clues (loop 13).

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Moves | Attack high, mid, low; hold trigger to slash (double damage, slower); parry three heights; parry and retreat [87 Fencing & Swordplay] | Chop, thrust, slash; duck, parry, jump; taunt; advantage bar speeds whoever holds it; "dizzy" state [04 pp.40-44] | Planned: 3 attacks, 3 parries, dodge, wind-up/active/recovery frames in data [PRD §9.2] |
| Crew link | Hits change both sides' morale (WILD to PANIC); a small high-morale crew can beat a large demoralised one [87 Leadership in Battle] | Crew losses move the advantage bar; winning the duel lets your crew beat "an enemy force far greater" [04 pp.43-44] | Built: morale scales boarding strength [PRD §4]. Planned: crew advantage pushes the enemy to the rail [PRD §9.2] |
| Surrender | Panicked leader hit, or forces down to one man and hit [87] | Crew down to one and hit again; pushed off the stage [04 p.44] | Built: struck colours rule in the battle, not the duel [PRD §9.1] |
| Retreat | Possible; you lose what you fought over and reputation [87] | Not offered | Planned: not specified |
| Weapons | Rapier reach, cutlass damage, longsword between [87] | Rapier, cutlass, longsword trade speed for defence [04 p.40] | Planned: same three as stat blocks [PRD §9.2] |

**Comparison games.** Black Flag makes boarding a third-person action sequence with objectives, and it costs crew when allies fall [BF-N; BF-R]. Sea of Thieves makes boarding a player action, not a cutscene [TBN].

**Implication for Corsair.**
- Every capture currently ends in an auto-resolved roll, which is quick. When the duel arrives, do not make it mandatory on every boarding: 1987 let overwhelming odds surrender before any swordfight [ORIG 2.1]. Fight the duel only when the odds are contested, or when the opponent is named (famous pirate, villain, rival, mutineer, commander). That keeps the 1 to 5 minute pillar and makes duels events.
- Ageing in 2004 makes "dueling opponents a little faster" [04 p.82]. If the duel is the main place the captain's body matters, it is the natural target for Corsair's age stat drops [PRD §2].
- Sid's point that duels stay short and non-lethal (sailors jump off before a ship sinks) is a tone rule worth keeping [SCR, IGN 5:10].

---

## 5. Plunder, prizes and the fleet

**Purpose.** The reward moment after a win and the choice it forces: cargo against hold space, keep against sink, volunteers against berths [ORIG §4].

**Player verbs.** One-button take (Enter) with best goods first; choose goods by hand; throw your own cargo over; sign or refuse volunteers; sink or let go (L); keep her as a prize ("Keep her"); later make flagship or sell at the shipwright [PRD §7, §9.1, §9.2].

**Feedback.** After-action report opening with a painted outcome picture, green or red result rows, standing chips, nearest shipwright if hurt; each choice states its consequence (let a merchant go +2 with her nation; sink after she struck -5) [PRD §9.1].

**Failure cost.** Low by design. The real costs are standing (a ship kept or sunk costs 5 with her nation [PRD §7]) and hold space. Losing a fleet ship to a pirate who tows it to her haven, sold 20 to 40 days later unless you catch her [PRD §6].

**Feeds.** Plunder chest (loop 8), trade stock (loop 7), fleet and ship progression (loop 14), news and the AI economy (loop 16).

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Gold | Automatic, weighs nothing [87 Prizes & Plunder] | Automatic [04 p.37] | Purse to plunder chest at once [PRD §9.2]. Built |
| Prize ship | Needs 8 men; slow prizes slow the fleet [87] | Fleet cap 8; prize takes station behind you [04 p.37; ORIG 2.1] | Cap 8; one shared hold and crew; fleet at slowest ship's pace; only the flagship fights [PRD §4]. Built |
| Enemy crew | Recruit from pirates or big crews [87 Recruiting] | Volunteers by reputation and wealth; specialists "persuaded" [04 p.37] | Volunteers: a quarter of a pirate's crew, a tenth of others [PRD §4]. Built. Specialists not planned [ORIG §6] |
| Named captives | Ask about Treasure Fleet or Silver Train, or ransom [ORIG 2.1] | Villains talk [04 p.75] | Famous pirate taken: ask for a hoard map piece, hand in for 1,500 gold and +10 standing, or set free for +10 morale [PRD §12]. Built |

**Comparison games.** Black Flag's post-boarding choice (repair the Jackdaw, lower Wanted level, send to Kenway's Fleet) turns every prize into a strategic choice; the resources come regardless of the choice [BF-N; BF-GF]. Kenway's Fleet sends captured ships on off-screen trade runs [BF-KF].

**Implication for Corsair.**
- Corsair's plunder screen is already the strongest version of this loop across the four games.
- The one 2004 lever missing is specialists (cook, cooper, quartermaster, gunner, carpenter, sailmaker, surgeon, navigator), only from captures [ORIG 3.9]. They are the cheapest way to make capture beat sinking even mid-career, and they soften crew upkeep. Worth reconsidering "not planned".
- Black Flag's "lower notoriety" option maps neatly onto Corsair's standing: e.g. release a captured ship of a nation to recover standing. Corsair already has a small version (+2 for letting a merchant go).

---

## 6. Port visit (town hub and services)

**Purpose.** Cash in, resupply, and pick the next thread. The pause in the rhythm, where world time stops [PRD §5].

**Player verbs.** Dock (E within 3 tiles); merchant (buy, sell, contracts); shipwright (repair, buy ships, upgrades, make flagship, sell); tavern (news, Top Ten, sign on men, divide plunder or pay wages); governor (letter of marque, bounties); the shady stranger in the tavern selling map pieces [FPT]. Planned: bank, barber-surgeon, missions, daughter, rumours [PRD §5].

**Feedback.** Painted harbour and interiors; port header shows nation, trade, your standing; each action states its consequence (food days per unit bought, wages per 10 men) [PRD §4, §5].

**Failure cost.** Refused entry at -50 standing; patrols hunt at -30 [PRD §5]. Plague shuts a port [PRD §6]. Planned: forts fire on the hostile [PRD §8]; sneak in instead (loop 12).

**Feeds.** Everything: trade, crew, repairs, standing, quests, romance; also the save point (autosave on docking) [PRD §14].

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Menu | Governor, tavern, merchant, divide plunder, check info, leave; governor won't see you again soon; tavern recruits only on first open visit [87 Getting Around Town; The Tavern] | City menu plus tavern people: bartender (upgrades, villains), barmaid (prizes nearby), mysterious traveller (other towns, maps, items) [04 pp.46-48] | Built: merchant, shipwright, tavern, governor (letters, bounties); news with "new" count [PRD §5] |
| Arrival options | Sail in, attack, sneak in [87 Arriving at a Town] | Sail in, attack, sneak in [04 p.20] | Sail in; attack and sneak are planned [PRD §5, §8, §9] |
| Save rule | Save only in town [87 Travelling the Caribbean] | Autosave on entering town [04 p.4] | Autosave on docking and Ctrl+S [PRD §14] |
| Town types | Wealth tiers; Spanish trade law by tier [87 Spanish Trade Restrictions] | Eight city types (size, wealth, defence); havens, missions, villages [04 pp.46-50] | Capital, town, haven, mission, village, lost city [PRD §5] |

**Comparison games.** Sea of Thieves outposts are where loot becomes safe; between, "you're meant to feel the paranoia" [TBN, Chapman via Metro]. Black Flag (Resynced) puts buy and sell at the harbourmaster "so you don't enter a fight unprepared" [TBN].

**Implication for Corsair.**
- Sid: towns are three good choices, not chores [SMD]. Corsair's tabs are getting rich (shipwright alone has three sections). Default to the obvious action, as the shipwright already does by opening on Repair when something is broken [PRD §7].
- Saving anywhere with Ctrl+S weakens Sid's "you live with the consequences of a voyage" [SMD; GDC 42:44]. Consider port-only saves on harder difficulties.
- The governor is the thinnest service and is the gate to three loops (rank, missions, romance). It is the most valuable next build for the port.

---

## 7. Trading and the market

**Purpose.** The safe way to earn: low-violence profit that funds ships and upgrades, and a reason to read the world (prices, shortages, wars).

**Player verbs.** Read prices and the "cheap, usual, dear" marks; plan with the chart planner (buy here, sell there, days, pirate risk); buy and sell with a preview; fill governor contracts for shortages; dodge plague ports; smuggle into ports whose trade a war has closed [PRD §4, §6].

**Feedback.** Every price explains itself (stock vs usual, the news behind a shock, made or needed, each unit moves it); hold shows cost basis and gain or loss now; best known sale elsewhere; market depth ("sells well" only for a small cargo in a small haven) [PRD §5, §6].

**Failure cost.** A loss sale (spread) the screen warns about; a pirate who takes the hold; cargo dumped crashes the price; a stale price memory.

**Feeds.** Captain's purse (trade profit is the captain's own, not the crew's [PRD §6]); ship buying (loop 14); the world economy (loop 16), which the player can push.

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Goods | Food, goods, cannon, one export crop per era [ORIG 5.1] | Six cargoes [ORIG 5.1] | Food, sugar, tobacco, hides, cotton, luxuries, silver, rum, cloth [PRD §6] |
| Prices | Merchant strength tracks town wealth and population; special local needs; patterns last days to years [87 Local Merchants] | Wealth and city type; finite merchant cash; stock resets after weeks [ORIG 5.1] | Stock vs target with elasticity; each trade moves stock; AI merchants and convoys carry goods; shocks, famine, plague, contracts [PRD §6]. Built |
| Who can trade | Spanish towns refuse foreigners, by wealth tier [87] | Big Spanish ports deal only with reputable Spaniards; rank adds stock [04 pp.72, 116] | Refusal at -50 standing; war closes markets to a nation's merchants [PRD §5, §6] |
| Was it worth it | "Profits from peaceful trade are modest" [87] | "Not as profitable as privateering, but it's a safer business" [04 p.90] | Full purse of Bridgetown sugar to Port Royal: median about 330 gold, never loses over 200 seeds [PRD §6] |

**Comparison games.** Black Flag has almost no buy-low-sell-high; cargo comes from violence and pays for upgrades [TBN]. Sea of Thieves Trade Routes: buy commodity crates at one outpost, sell where "Sought After"; a ledger book lists surplus and wants [SoT-TR].

**Implication for Corsair.**
- Corsair's market is far deeper than either original. That is a strength and a risk: 1987 and 2004 kept trade deliberately modest so privateering stayed the star. The PRD target (skilled mid-career voyage earns 3 to 5x its pay-off cost [PRD §6]) needs a separate check for a pure trader.
- Trade profit skipping the crew's share is a design lever, not just bookkeeping: it makes trading the loop that grows the captain's purse while plunder grows the crew's. Make sure wages (1 gold per man per day [PRD §6]) and a small crew are the honest cost of that, as 1987's Dutch trader with "twenty men and four cannon" [87 Memoirs].
- 2004's "success closes the door" rule (rich Spanish towns shut you out) is a good self-limiter if trade proves too strong [ORIG 5.2].

---

## 8. Crew, supplies and voyage pacing

**Purpose.** The voyage clock. Food is the short fuse, unpaid time and gold per head the long fuse; dividing the plunder closes a voyage [ORIG §4].

**Player verbs.** Sign on men (10 gold each up to berths); buy food (or from a hailed ship at 3x); divide the plunder or pay wages; pick up survivors and volunteers; keep the crew sized to the hold [PRD §4, §7].

**Feedback.** Days of food on the HUD; morale number and drift; the tavern and merchant show how signing men shortens food and raises wages; hunger warnings [PRD §4].

**Failure cost.** Built: starving costs 8 morale a day; below 25 a tenth desert at landfall, below 10 three tenths; below minimum crew the ship sails and turns slower (to 40%) [PRD §4]. Planned: mutiny (duel the ringleader or pay off; losing means marooning) [PRD §4].

**Feeds.** Combat strength (reload, boarding), ship speed, the voyage boundary, the captain's purse (20% of each division) [PRD §6].

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Pay | Shares only; captain 5 to 20% by difficulty, patrons 10%; crew size doesn't change captain's share "to discourage... massacres" [87 A Merry Crew] | Shares; captain 5 to 50% by difficulty [04 p.80] | Plunder chest: captain 20%, crew the rest per head; or wages from the purse [PRD §6]. Built |
| Morale drivers | Gold in the pool; months since division; "difficult to keep the crew pleased for more than a year" [87] | Food and treasure; first mate warns it's time to divide [04 pp.26-27] | Plunder per head, days unpaid after 15, starving, prizes, defeats, men lost [PRD §4]. Built |
| Divide | Crew disperses, you keep the flagship, refit takes months, rebuild from scratch [87 Getting Around Town] | About six months; next crew's starting morale set by this crew's reaction; offer to change difficulty or retire [04 pp.80-82] | Crew stays; morale set by each man's share; pay clock restarts; no time passes [PRD §6]. Built |
| Desertion, mutiny | Desert in port when unhappy; mutiny if angry too long [87] | Desert in port; steal a ship at sea [04 p.27] | Desertion built; mutiny planned [PRD §4] |

**Comparison games.** Sea of Thieves keeps supplies physical (food, planks, cannonballs in barrels; a sunk ship's barrels float up) [SoT-SH].

**Implication for Corsair.**
- The voyage boundary is soft. Corsair's division keeps the crew and costs no time, so the PRD's own line "Dividing the plunder ends a voyage: the crew is paid off, fame is scored, and the captain gets older" [PRD §2] is not yet true. In both originals the division was the checkpoint: banked gold, months of age, a difficulty offer, a retirement offer [04 pp.80-82]. Re-attach those to the built division.
- Corsair has food, gold per head and time all in play, which is the full 2004 set. Missing the 2004 softeners (cook, quartermaster, instruments) means long voyages only end one way.

---

## 9. Standing, privateering and rank

**Purpose.** Makes violence political: who you attack decides who welcomes you, who hunts you, and who promotes you.

**Player verbs.** Buy a letter of marque while a nation is at war (800 gold at neutral, free at 30, refused at -30); attack under it; claim bounties at any governor (pirates 150, enemy merchants 120, warships 400); hand in captive pirates [PRD §12].

**Feedback.** Standing chips on the battle report; attack button labels the political cost; patrols hunt at -30, ports refuse at -50; news of wars and pirate pressure [PRD §5, §9.1, §12].

**Failure cost.** Hunted, refused, forts firing (planned); planned bounty on your head that spawns hunters, amnesty for a fee [PRD §12].

**Feeds.** Port access (loop 6), encounter danger (loop 2), rank rewards and land (loops 14, 15), romance (needs rank in her nation [04 p.48]).

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Opinion model | Attacks make a nation wary then hostile; its enemies applaud; its allies remember; end of alliances is secret; governor's personal memory [87 European Politics; The Governor] | Owner and allies dislike, enemies approve, neutrals don't care; cities remember attacks off their harbour; bounties halve on division [ORIG 2.3] | -20 for attacking; +5 with each enemy of hers (+10 warship taken); +3 everywhere for a pirate; +6 with the issuer under a letter [PRD §9.1, §12]. Built |
| Ranks | Ensign to Admiral, then Baron to Duke; land per promotion [87 Ranks & Titles] | Needs a letter; each rank one concrete perk (easier recruiting, cheaper repairs, more goods, cheaper upgrades, free repairs, free upgrades); fall from favour keeps rank but loses the perk [04 pp.70-72] | Titles and land planned; "Titles and promotion wait" [PRD §12] |
| Missions | Not in 1987 [ORIG] | Governors give escort and capture missions; no penalty for failing [04 p.74] | Governor contracts for shortages built; missions planned [PRD §6, §5] |

**Comparison games.** Black Flag's Wanted level 1 to 4 sends escalating hunters, is checked every 8.5 minutes, and is cleared by a bribe of 200 to 800 reales or lowered one step per boarded ship [BF-W].

**Implication for Corsair.**
- The 2004 "one rank, one felt perk" table is the model for Corsair's titles [SCR takeaway 13]. Without it, rank is only a score line.
- The bounty-scaled hunter is the fix for the encounter cliff (loop 2) and is already in the PRD. Black Flag shows the readable form: a small integer with a clear way to pay it down.
- 1987's secret end of alliances and governor's personal memory are cheap ways to give the governor visit real information value.

---

## 10. Town assault (sea assault, land assault, sack)

**Purpose.** The biggest score in the game and the most political act: raid a town for its wealth or hand it to another nation.

**Player verbs (planned).** Silence fort guns from the sea and touch the dock; or land the crew, march, fight a turn-based battle (move, fire, charge, hold), take the gate, duel the commander; then sack, hand over, or install a governor [PRD §8, §9.3-9.5].

**Feedback (planned).** Gun positions to rubble; units with range bands and flank arrows; commander duel [SCN S4, S6, S7].

**Failure cost (planned).** Crew lost; 1987 men refuse to march if you land too far from the fort [87 Amphibious Assaults]; 2004 retreat to the fleet minus a portion of the crew [04 p.61]. Heavy reputation loss on a sack; the nation may retake [PRD §9.5].

**Feeds.** Wealth, standing, land and titles, the world (town wealth, ownership, fort upgrades, news) [PRD §5, §8].

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Sea route | Sail to the fort, land men next to it, fight on the battlements; men limited to the flagship's capacity [87] | The manual describes town attacks as land battles [04 pp.56-61]; no separate sea-assault mode is described there | Planned: harbour fort layout, chain at level 3+ [PRD §9.3] |
| Land route | Real-time groups; muskets fire only when stationary; woods hide; cavalry deadly in the open; final swordfight on the ramparts [87 Pike & Shot] | Turn-based units (pirates, buccaneers, officers vs infantry, guards, cavalry, natives); need 50 men; goal is reaching the city, not killing [04 pp.56-61] | Planned turn-based (open question: real-time with pause) [PRD §9.4] |
| Reward | Loot; a captured town can change flag [87 Memoirs] | Ransom by wealth and how badly beaten; overwhelming win can install a new governor [04 p.61] | Sack, hand over, install governor (open question) [PRD §9.5] |
| World effect | Raided towns are cleaned out but reinforced [87 Memoirs] | Looting drops wealth drastically [ORIG 5.2] | Wealth and population drop; forts upgraded within 1 to 2 years [PRD §8, §9.5] |

**Comparison games.** Black Flag forts are a sea phase then a foot phase; capture reveals the region's map and pays reales, materials and new weapons [BF-R].

**Implication for Corsair.**
- This is the largest unbuilt loop and the one Sid had to reinvent (real-time to turn-based) [SMD]. The PRD's own risk table names scope creep across six minigames [PRD §17].
- 2004's rule "you just want men inside the walls, not every enemy dead" keeps the battle short. Make that the win condition.
- A town that is sacked often gets stronger [PRD §8] and poorer [ORIG 5.2]: good, it prevents fort farming, which is another named risk.

---

## 11. Romance and the ball

**Purpose.** A social progression track that pays out information (rumours, villain warnings, map pieces), a home port, and score [PRD §11].

**Player verbs (planned).** Visit with rank or fame, dance, give gifts, rescue her, fight a rival suitor, marry once [PRD §11].

**Feedback (planned).** Relationship stage; dance heart grows with steps, faster with flourishes in a row [04 pp.66-69; PRD §11].

**Failure cost (planned).** Meter decays with neglect; she may marry someone else (news); sacking her town costs heavily [PRD §11].

**Feeds.** Quests and treasure (map pieces, family clues), standing with the governor, retirement score.

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Access | Governor's daughter with luck and prestige; she tells "every little secret" [87 Memoirs] | Rank from her nation, dancing, jewellery; prettier is harder [04 p.48] | Six stages, Stranger to Married [PRD §11]. Planned |
| Minigame | None | Six moves (marche forward or back, glisse left or right, pirouette left or right) on a 3/4 or 4/4 beat; partner gestures the next step; flourish on the downbeat; boots and slippers forgive mistakes [04 pp.66-69] | Rhythm game: match the partner's gesture on a beat; patterns from data [PRD §11] |
| Reward | Wife counts toward retirement [87 A Word About Your Goals] | Information, items, lost-city maps; marriage gives prestige [04 pp.47-48] | Rumours, villain warnings, treasure hints, map pieces, home port, spouse standing in score [PRD §11] |

**Implication for Corsair.**
- Sid apologised for the dancing [SMD]; reviewers liked it least of the 2004 additions [SMD]. Keep the dance under a minute, make it skippable or auto-resolved after the first success, and put the value in what she tells you.
- The romance track is mostly a delivery pipe for loop 13. Build it after maps exist so it has something to give.

---

## 12. Stealth entry, prison and escape

**Purpose.** Lets a wanted captain still reach a governor, tavern or villain; turns capture into a recoverable setback rather than game over [SMD; 04 p.82].

**Player verbs (planned).** Enter a hostile town at night on foot; avoid guard paths; hide; knock out from behind; reach an objective building; when caught, jail, bribe or escape [PRD §5].

**Failure cost.** Jail time (ageing). 2004: three to twelve months, about six on average, halved if you sneak out [04 p.82].

**Feeds.** Quests (reach the villain in the tavern [04 p.73]), standing (amnesty from a governor), ageing.

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Mechanic | Die roll; a large reputation gets you recognised; can't recruit or divide while sneaking; best route to a governor during an amnesty [87 Arriving at a Town; Pirate Amnesty] | Action sequence: guards, fences only you can climb, hay bales, knockouts from behind, running makes noise [04 pp.62-65] | Top-down streets, data-driven guard paths [PRD §5; SCN S10]. Planned |
| Caught | Fight out or prison [87] | Jail until released; escape uses the same sequence [04 p.65] | Jail, bribe or escape [PRD §5]. Planned |

**Implication for Corsair.**
- Of the six minigames, this is the most cuttable (Sid's "new minigames are risks" [SMD]). Its job is access and a time cost. A die roll with a clear readout (1987) delivers both at almost no art cost; the S10 scene can come later.
- Jail is the main failure that feeds ageing in 2004. If Corsair keeps "let go afloat" as the only defeat, it should add some time cost somewhere or ageing has no pressure.

---

## 13. Quests, treasure and famous pirates

**Purpose.** The long threads that pull the player around the map and give the career a story: family, villain, treasure, the Top Ten [SCR §3].

**Player verbs.** Hunt a named pirate; take him alive; ask for his hoard piece, hand him in, or free him; buy pieces from the tavern stranger; read a map in the captain's log (L) and plot a course to it; go ashore and dig (G) within 2 tiles. Planned: lost cities by march; family clues from villain lieutenants [FPT; PRD §10, §12].

**Feedback.** Top Ten in the tavern and the captain's log by wealth, captain included; news of each famous pirate's prizes by name; the Maps page with torn pieces, a search ring on the chart that shrinks with each piece, the landmark on the coast in 3D, a prompt to dig inside the ring [FPT].

**Failure cost.** A famous pirate beats a stock brig most times [FPT]. A miss costs half a day and gives a hint (the landmark's bearing and distance); a pirate whose hoard you dug before ever beating him hunts you at any odds, from half as far again, until beaten [FPT].

**Feeds.** Plunder chest, fame, standing (bounties), romance, retirement score (treasure, family, villains) [PRD §2].

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Threads | Treasure maps by fragments; search a day at the spot; rescue relatives and find hidden plantations [87 Travelling the Caribbean] | Family quests (multi-step, no time limit); missions; maps from travellers and daughters; landmarks seen from sea then ashore; Top Ten with nine named pirates [04 pp.51-53, 73-78] | Ten real 1660s buccaneers, wealth, haunts, return after 90 days; captured-captain choices; 4-piece maps, digging, landmarks, revenge. Built. Items in hoards, villains, family, lost cities planned [FPT; PRD §10, §12] |
| Failure | Without a fragment you always find nothing [87] | No penalty for failing a quest; villain moves on if you lose the duel [04 pp.74-75] | Built: hint on a miss, revenge on early digs [FPT] |

**Comparison games.** Black Flag hides its best ship upgrades (Ultimate Plans) behind treasure maps and wrecks, so treasure feeds ship power directly [BF-R].

**Implication for Corsair.**
- 2004's motivational trick is always having three or four open threads on screen [SCR takeaway 9]. Corsair has the Top Ten, contracts and treasure maps; the family quest will fill the rest. The captain's log (L) holds the Top Ten and the maps; contracts and later threads need a place there or on the HUD.
- Revenge (dig first, he hunts you) is the right kind of failure: it creates a fight, not a loss.

---

## 14. Ship and fleet progression

**Purpose.** Moves the player up the danger ladder: bigger hull, more guns, better upgrades, and the choice of what ship matches your style [04 p.30].

**Player verbs.** Buy a ship at a town or city shipwright; capture a better one (galleons and ships of the line only by capture); mount guns (150 gold, sell at 75); install upgrades (hammocks, powder, cotton sails, scantlings, copper, bronze cannon); change flagship [PRD §7].

**Feedback.** Ship card with portrait, guns mounted vs battery, hull, sails, crew vs berths; refusals that say why [PRD §4, §7].

**Failure cost.** Losing a fleet ship to a pirate; selling at 35% of class price [PRD §4].

**Feeds.** Combat odds, cargo capacity for trade, encounter rates (pirates pick on the weak) [PRD §6].

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Ladder | Ships mostly by capture; merchants "almost never have any for sale" [87 Trading with Merchants] | Capture plus shipwright; six one-effect upgrades [04 p.108] | Buy by port size; capital ships only by capture; six upgrades [PRD §7]. Built |
| Measured effect | | | vs pirate sloop: 10 guns win 26/40, full battery 31, fully fitted 34 [PRD §7] |

**Comparison games.** Black Flag upgrades cost reales plus wood, metal and cloth from plundered ships, gated by hunter and fort tiers; Ismail warned against progress that is just bigger numbers [TBN; BF-R]. Sea of Thieves is cosmetic-only so friends can always sail together; cosmetics are "trophies of the things you've accomplished" [SoT-WC].

**Implication for Corsair.**
- Upgrades are a modest slope (26 to 34 wins of 40), which keeps skill relevant. Good.
- The danger ladder needs a top: as the player strengthens, the world's danger drops off a cliff (loop 2). Famous pirates in warships, bounty hunters and escorts on convoys should scale with the player, the way 2004 ports add escorts after attacks [ORIG 5.3].
- Sea of Thieves' idea of visible trophies (your flag, your figurehead, your title) is cheap in a single-player career and makes progression readable at a glance.

---

## 15. Ageing, career and retirement

**Purpose.** The career's end condition and the pressure that makes time matter. "Time is the real currency" [PRD §1].

**Player verbs.** Spend time (sailing, refits, prison); choose when to retire; pick Medicine to delay ageing; planned: heal wounds at the barber-surgeon [PRD §2, §5].

**Feedback.** Planned: age, health, a stat-drop notice, retirement fate cards from beggar to governor, score table [PRD §2; SCN S14].

**Failure cost.** Stat drops from age 35; wounds lower health; governors stop offering work [PRD §2].

**Feeds.** Ends the run and scores it; pushes the player to divide, retire, or try another style next time.

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Clock | Wounds and voyages hurt health; friends advise retirement; eventually you can't recruit a crew; a career is "five to ten years" [87 When to Retire?] | At 30, 35, 40, 50 one action may get harder (faster duellists, stricter dance timing, fewer recruits); division (6 months), prison and marooning eat most time [04 pp.81-82] | Start about 20; stat drop chance yearly from 35; health from wounds [PRD §2]. Planned; no captain age in state yet (packages/core/src/state.ts has fame but no age) |
| Retire | After any division; can come out of retirement if health permits; Hall of Fame [87] | Offered after division; fame decides the job; suggest a different strategy next time [04 pp.80, 83] | Retire at any port; eight score categories; difficulty multiplier [PRD §2] |

**Comparison games.** Sea of Thieves' end game is the Pirate Legend hideout, unlocked by level 50 in three trading companies, framed as where a pirate would "retire" [SoT-M].

**Implication for Corsair.**
- **Clock maths do not close.** At 13 s a day on the default 2x cruise [CAL], a game year at sea is about 1.3 real hours; 20 to 30 years is 26 to 40 hours of sea time alone, against a target of 6 to 12 hours [PRD §1]. Both originals closed this gap with big time jumps: months per division, prison, marooning [04 p.82; 87]. Corsair's division costs no time and defeat costs no time. Either add lump costs (refit months on division, prison, marooning, land marches, careening) or shorten the target career.
- 2004's "one action gets a bit harder" is gentle, readable and targets the minigames. Map Corsair's age drops onto duel speed, gun accuracy and recruiting, as the PRD suggests [PRD §2].
- Retirement as a story ("a final job") and a nudge to play differently next time is the replay hook [SCR §3, GDC 51:05].

---

## 16. World simulation (the living Caribbean)

**Purpose.** Makes the world move without the player, gives player actions visible consequences, and generates opportunities (convoys, shortages, wars, plague, famous pirates' deeds) [PRD §1].

**Player verbs (indirect).** Intercept convoys and treasure ships; break blockades; follow news; exploit wars; free pirates' prizes; choose where to sell to move a town.

**Feedback.** Tavern news with delay by distance (80 tiles a day plus 0 to 3 days); port header and chart card for blockades, plague, trends; AI fights visible within 30 tiles [PRD §6, §13].

**Failure cost.** Not a player failure loop; it raises and lowers risk and reward everywhere.

**Feeds.** Prices (loop 7), encounters (loop 2), politics (loop 9), quests (loop 13).

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Ships | Encounter rolls only [ORIG 5.3] | Ships with roles change towns on arrival (immigrants, governors, raiders); traders avoid enemy ports [ORIG 5.2, 5.3] | About 34 AI ships on A* lanes with real polars; convoys every 60 to 90 days; treasure ship twice a year; blockades; prizes towed to havens [PRD §6]. Built |
| Towns | Slowly prosper; native attacks, disease, gold rushes; nearby captures hurt [87 The Rise & Fall of Colonies] | Small drift plus role ships [ORIG 5.2] | People grow 0.4% a week when fed, fall 2% when starved; plague, famine, shocks [PRD §6]. Built |
| Politics | Public wars and peace [87 European Politics] | Treaty ships start and end wars [ORIG 5.3] | Historical war events from 1660, tension drift [PRD §12]. Built |
| Fixed schedules | Printed Treasure Fleet and Silver Train itineraries [87 Your Starting Tale] | Treasure galleons from the map edge [ORIG 5.3] | Convoy timetables, Spanish flota, treasure ship [PRD §6]. Built |

**Implication for Corsair.**
- 2004's best idea, "change the world through ships you can intercept" [ORIG 5.6], is already in Corsair (cargo leaves the origin and only reaches the destination if the ship does [PRD §6]). Make that legible: the PRD's scenario "capture a convoy bound for Havana, sugar rises 10% in 60 days" [PRD §16] should surface to the player as news and a price mark.
- The world sim is the most built part of Corsair and the least visible. The risk Sid names, a sim the player can't see, is solved by news, the chart and the tavern; keep investing there rather than adding more hidden variables.

---

## 17. Rewards, fame and the meta loop

**Purpose.** Tells the player what the last half hour was worth and what to chase next [SCR §4, GDC 5:00-8:40].

**Player verbs.** Climb the Top Ten; earn fame; collect ranks, land, treasures, relatives, a spouse; raise difficulty.

**Feedback.** Built: fame field (a point per famous pirate beaten and per hoard dug up), Top Ten list [PRD §12; state.ts]. Planned: score categories and fate cards [PRD §2].

**Failure cost.** None directly; fame is the scoreboard.

| | 1987 | 2004 | Corsair |
|---|---|---|---|
| Score | Wealth, rank, land, reputation, wife, health [87 Gains & Goals] | Fame on the HUD from promotions, quests, Top Ten wins; status screen of deeds; final job; Hall of Fame [04 pp.18, 24, 83] | Eight categories with difficulty multiplier [PRD §2]. Top Ten built, fame partial |
| Difficulty | Higher difficulty, bigger captain share [87] | Offered a harder level after a strong cruise [04 p.80] | Five levels scale enemies, greed, spreads and share; higher scores more [PRD §2] |

**Comparison games.** Sea of Thieves: horizontal, cosmetic progression; higher emissary grades pay more for the same loot, so crews hold loot to cash in later, and all grade progress is lost when the ship sinks [SoT-EM; SoT-WC].

**Implication for Corsair.**
- Sid: "You cannot reward and acknowledge and reflect this progress too much," and be lavish in the first 15 minutes [SCR §4, GDC]. Corsair should put fame on the HUD and give the starting captain an early, nearly guaranteed prize (a weak merchant near Port Royal) within the first sitting.
- Sea of Thieves' emissary grade is a good model for the plunder chest: holding loot longer raises its multiplier, but a loss resets it. It turns "when do I divide?" into a gamble, which is exactly the 2004 reason to divide ("bank your portion before you lose it" [04 p.79]).

---

## Cross-loop findings (priority order)

1. **The clock doesn't close (loops 8, 15).** No time cost on division or defeat, and a 13-second day, mean a 20 to 30 year career is 26 to 40 hours of sea time. Add lump time costs or shorten the career target.
2. **The voyage boundary is soft (loop 8).** Division should be the checkpoint for banking, age, difficulty offer and retirement offer, as in both originals and as the PRD §2 text already says.
3. **Mid-career danger falls off a cliff (loops 2, 14).** Measured pirate meetings drop to near zero for a strong brig. Bounty-scaled hunters, escorted convoys and famous pirates in warships are the fix.
4. **Capture vs sink incentive needs a mid-career lever (loop 5).** Specialists from captures did this in 2004; they are not planned.
5. **Duel scope (loop 4).** Fight it only when the odds are contested or the opponent is named.
6. **Minigame scope (loops 10, 11, 12).** Land assault, dance and stealth are the three Sid either reinvented or apologised for. Build the loop value first (ransom and handover, information from the daughter, access and jail time) with simple resolutions; add the full minigame only if playtests ask for it.
7. **Doc drift.** Resolved 2026-10-10: the PRD now gives the 771-tick day, attack from the hail as built, the half-day dig and one 2-tile dig tolerance for everyone.
