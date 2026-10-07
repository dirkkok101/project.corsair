# Reference: Pirates! (1987) and Sid Meier's Pirates! (2004)

How the two games handle the aftermath of a ship battle and the crew. Use this before designing Corsair's equivalents. The two games are described separately, and every fact cites a source. **Unverified** marks anything no source confirmed.

Researched October 2026.

## 1. Sources

| Tag | Source | Good for |
|---|---|---|
| **[87]** | 1987 MicroProse manual, full text: http://www.antimon.org/dl/c64/misc/piratesdoc.html (cited by section heading; the text has no page numbers) | Designer intent for 1987: prizes, plunder, shares, morale, politics. It barely covers what happens to the player after defeat. |
| **[04]** | 2004 Firaxis PC manual (Steam): https://cdn.cloudflare.steamstatic.com/steam/apps/3920/manuals/manual.pdf (cited by printed page number; "PDF p." where the printed number is unclear) | Authoritative 2004 rules: victory/defeat, world opinion, crew, dividing the plunder, specialists. It also lists what changed from 1987. |
| **[WIKI]** | sidmeierspirates.fandom.com. The HTML pages return HTTP 402 to fetch tools; read them through the MediaWiki API instead: `https://sidmeierspirates.fandom.com/api.php?action=parse&page=<Page>&format=json&prop=wikitext&formatversion=2&redirects=1` | Measured mechanics and numbers (bounty amounts, the 8-ship limit, crew caps, 1987 captured-captain prompt). Fan-written; some numbers conflict with the manual. |
| **[SW]** | StrategyWiki 2004 walkthrough: https://strategywiki.org/wiki/Sid_Meier's_Pirates!_(2004)/Walkthrough (also blocks direct fetch; use `https://strategywiki.org/w/api.php?action=parse&page=...`) | Strategy experience: the real cost of jail or being lost at sea, gold-per-crew rules of thumb. |
| [WP] | https://en.wikipedia.org/wiki/Pirates!_Gold | Pirates! Gold (1993) differences. *Computer Gaming World* called it "not a significantly revised game". No source describes post-battle or crew changes, so treat Gold as 1987 (**unverified** in detail). |

## 2. After a ship battle

### 2.1 Victory by capture

| Topic | 1987 | 2004 |
|---|---|---|
| How you win | Win the boarding swordfight, or the enemy surrenders. Before any swordfight the game compares crew sizes; overwhelming odds mean immediate surrender, or a white flag at about two ship-lengths [WIKI Naval_Combat]. | Win the duel, or the enemy surrenders. "If ye beat him, his crew will lose heart and surrender" [04 PDF p.20]. Demasting with chain shot always forces a white flag (escorts excepted); just closing in then counts as a win. Merchants give up more readily [WIKI Naval_Combat]. |
| Surrender rule in the swordfight | Surrender "when you inflict sufficient hits on an enemy leader in 'panic' or when you've reduced the enemy to just one remaining man and then hit the leader… the same could happen to you" [87 Fencing]. | "If your crew is reduced to one and you are hit again, you are forced to surrender; if your opponent's crew is reduced to one and you hit him again, your opponent surrenders" [04 Dueling, PDF p.21]. |
| Gold | Taken automatically; "gold weighs virtually nothing" [87 Prizes & Plunder]. | "You get all of the ship's gold automatically" [04 p.37]. |
| Cargo | After the battle you get "a report about the enemy ship's armament and capacity, as well as the empty space remaining in the holds of your fleet." You choose what to keep and throw the rest overboard [87]. | On the plunder screen you take "some or all of the prize's cargo" [04 p.37]. Capacity includes the prize if you keep it [WIKI Boarding]. |
| Keep, sink or abandon the ship | "Take the enemy ship for your own (send a prize crew), or… take its cargo, while burning and sinking the ship itself" [87]. | "Keep the captured vessel or abandon her"; a kept prize "will take up station behind you" [04 p.37]. |
| Prize cost and limits | Each prize needs 8 men, "eight fewer men available for battle on your flagship." Slow prizes slow the fleet [87]. No fleet-size cap is documented. | Fleet cap of 8 ships. With a full fleet the option is disabled, or it scuttles the ship [WIKI Prize]. Crew is hard-capped by the fleet's total crew capacity [WIKI Crew]. |
| Selling prizes | "You can sell the ship as well as its cargo at a friendly port" [87]. | At the shipwright, which warns if the sale cuts crew or cargo capacity below what you hold [WIKI Player's_Fleet]. |
| Enemy crew | "Sometimes from captured ships… easiest if the capture is a pirate, or a ship with a very large crew" [87 Recruiting]. | "Depending upon your reputation and current wealth (and… difficulty), several crewmen… may volunteer." Accept them, or they "get put ashore with all of the other captured sailors" [04 p.37]. |
| Specialists | None (2004 feature). | A specialist you lack "is quickly 'persuaded' to join" [04 p.37]. |
| Captured captains | Named Pirates and Pirate Hunters only, via a prompt with three options: ask about the Treasure Fleet, ask about the Silver Train (he goes free either way), or hold him for ransom. Governors then reward a held pirate with promotion points or relay a ransom offer for a hunter. Captives "can occasionally escape whenever you leave a Port" [WIKI Boarding]. | Villains ("Evil Spaniards") "surrender and tell you what he knows" [04 p.75]. Baron Raymondo gives map pieces to a lost relative [WIKI Family]; Montalban gives 100,000 gold and all missing specialists [WIKI Evil_Spaniard]. No ransom of ordinary captains found (**unverified**, probably absent). |
| Freed prisoners, letters, maps on ships | Not found (**unverified**). | Not found on ordinary ships (**unverified**). Family rescue happens on land via map pieces [WIKI Family]. |

### 2.2 Victory by sinking

- **1987.** You get nothing. Sinking "prevents you from capturing it or the cargo"; an important captain can't be fished out [WIKI Naval_Combat].
- **2004.** "Everything she carries goes to the bottom with her" [04 p.37]. You can still sail over survivors to recruit them [WIKI Crew], and over floating barrels for 50 gold each [04 p.37]. Sinking gives a smaller reputation change than boarding [WIKI Naval_Combat].

### 2.3 World opinion, bounty, promotions

| Topic | 1987 | 2004 |
|---|---|---|
| Victim nation | "A few attacks may make it wary, while many attacks make it hostile" [87 Nations]. | Trade ship: the owner and nations at peace with it "like you less". Warship: the owner and its allies "really dislike you" [04 pp.38-39]. |
| Enemies of the victim | "Will applaud your actions and those governors may reward you" [87]. | Like you more, or "really approve" for a warship [04 pp.38-39]. |
| Allies of the victim | "Remembered and disliked by its ally" [87]. | As above. Neutrals "don't care" [04]. |
| Pirates as targets | Not specified. | "Everybody else's opinion of you rises. Other pirates like you less" [04 p.38]. |
| City-level memory | Not documented. | Cities dislike attacks on shipping to or from them, "particularly… right outside their harbors"; a single city can fire on you while the rest of the nation welcomes you [04 p.38]. |
| Numbers | Not documented. | ±1,000 bounty (or 1 promotion point) per merchant, sunk or captured. ±2,000 for a *boarded* warship; a sunk warship counts the same as a merchant. Escorts only count when fought alone [WIKI Boarding]. Bounty halves when you divide the plunder [WIKI Bounty]. |
| Promotions | Governors grant Ensign → Captain → Major → Colonel → Admiral, then Baron → Count → Marquis → Duke. They favour men who fight their enemies [87]. | You need a Letter of Marque. Falling out of favour keeps your rank but suspends its benefits; you win favour back with a bribe or Jesuit intercession [04 PDF p.36]. Hostile nations send pirate hunters [04 p.38]. |
| News | War and peace are public; the end of an alliance is not, and governors are the best source [87]. | The barmaid tells you when a nation has put a bounty on you [WIKI Tavern]. |

### 2.4 Fame and named pirates

- **1987.** Named pirates and pirate hunters exist; captured captains are handled as in 2.1. No fame ladder.
- **2004.** Nine named pirates, plus you, on the Top Ten list. Defeating one takes his listed wealth and "he immediately falls to the bottom of the list" [04 p.78]. Each defeated pirate is worth 1 Fame point [WIKI Fame]. They sail "captured warships… full complement of crew… morale… very high" [04 p.77].

### 2.5 Defeat

| Case | 1987 | 2004 |
|---|---|---|
| Lose the boarding fight | Prison if the enemy is a European nation; marooned if it is a pirate or minor faction [WIKI Boarding]. Time and losses **unverified**. | "Thrown into jail until you escape or are ransomed. Once out of prison, you reunite with your surviving crewmen and any ships and treasure they managed to salvage" [04 p.36]. |
| Flagship sunk, no other ships | Marooned "a few months or more"; at low health you may have to retire [WIKI Naval_Combat]. | "Marooned without your ship, gold, or crew… You'll still have any treasure maps and specialists" [04 p.36]. |
| Flagship sunk, other ships present | Picked up; that flagship is lost [WIKI Player's_Fleet]. | Another ship becomes the flagship. "You'll lose a portion of your crew, cargo and treasure." Banked (divided) gold is safe [04 p.36]. |
| Time cost | **Unverified.** | Prison lasts 3–12 months (about 6 on average), halved if you sneak out of town. Marooning also costs months [04 p.82]. The Mirror and Signal Flare items shorten marooning [WIKI Marooning]. |
| World opinion | Not documented. | "If you lose a ship battle, nobody much cares" [04 p.38]. |
| Can the player surrender? | No; only automatically, under the panic or one-man rule [WIKI Boarding]. | No; only automatically, under the one-man rule. |
| Player experience | — | [SW]: "don't get arrested or thrown overboard". Jail "wastes valuable time"; being lost at sea also loses all carried gold. |

### 2.6 Retreat and draws

- **1987.**
  - Sail away until you are far enough apart. "If you escape from battle and the enemy ship is undamaged, you may lose a ship to enemy pursuit" (only with two or more ships) [87 Escape From Battle]. The lost ship is random, tends to be a larger one, and is never the flagship [WIKI Naval_Combat].
  - Nightfall ends long battles [87].
  - Fleeing a swordfight: "you lose whatever you were fighting over and your reputation suffers" [87 Fencing].
- **2004.**
  - A draw happens at loss of sight or at nightfall [04 p.37]. You risk no fleet ships [WIKI Naval_Combat].
  - A draw where you did damage counts as a win for opinion; with no damage it has no effect [04 p.38].
  - The escaped AI ship jumps straight to its destination port [WIKI Naval_Combat].

### 2.7 How the outcome is presented

- **1987.** A text report on the prize: armament, capacity and free hold space. Then the take-ship-or-sink choice and a cargo picker. A prompt box handles notable captives. Fleeing and sinking each show a picture with a caption [87; WIKI Naval_Combat].
- **2004.** A short cutscene: on capture, the enemy captain kneels and offers his sword. Then come the volunteer prompt, the specialist notice and the plunder screen (keep or abandon, cargo selection). After that, back to the Navigation screen [04 p.37; WIKI Naval_Combat].

## 3. Crew

### 3.1 Shares, not wages

- **1987.** "Your crew is not paid wages. Instead, at the end of the voyage, the party's profits are split." Wealth is kept separately for the party (all of the crew) and for you personally; "your crew knows the difference!" [87 'On Account'].
- **2004.** "Pirate crews are rarely paid wages. Instead, they sign on for a share of any treasure acquired during the voyage" [04 p.79].

### 3.2 The captain's share

| Difficulty | 1987 [87 Dividing the Plunder] | 2004 [04 p.80] |
|---|---|---|
| Apprentice | 5% (2 shares) | 5% |
| Journeyman | 10% (4 shares) | 10% |
| Adventurer | 15% (6 shares) | 20% |
| Rogue | — | 30% |
| Swashbuckler | 20% (8 shares) | 50% |

Other points about the division:
- **1987.** Patrons take another flat 10%, which funds the next voyage. "The size of the crew has no effect on the Captain's share… to discourage Captains from leading their crews into massacres!" [87]. Easier levels give better officers but a smaller share for you [87 Difficulty].
- **[WIKI Divide_the_Plunder]** says "10% to 50%" for 2004, which conflicts with the manual's 5%. Use the manual.

### 3.3 What drives morale

| Driver | 1987 | 2004 |
|---|---|---|
| Scale | HAPPY, PLEASED, UNHAPPY, ANGRY [87] | Very Happy, Happy, Content, Unhappy, Mutinous [04 p.18] |
| Gold | "The more money the party has, the happier they are… little importance to captured ships, goods… Their eyes are on gold!" Selling cargo for gold helps [87 Morale]. | "Keep them fed and keep bringing in the treasure" [04 p.26]. |
| Gold per head | Explicit: "easier to keep a small crew happy… each man's share is larger" [87]. | Implicit in the manual. [SW]: about 1,000 gold per crewman keeps a long-voyage crew merely "unhappy", not mutinous. [WIKI Mutiny]: 1,000–3,000 per head depending on specialists and items. Fan numbers; the wiki also claims a 100 gold/man/month demand (**unverified**). |
| Time since division | "Difficult to keep the crew pleased for more than a year, and almost impossible… for two years or longer" [87]. | Restlessness grows with time. "Your first mate takes you aside and tells you that it might be time to divide the plunder." Ignore him and morale falls [04 p.26]. [SW]: the time effect caps after about two years. |
| Items and specialists | None. | Cook, Quartermaster, Fiddle and Concertina. [SW]: each instrument "make[s] the voyage seem four months shorter". |
| In battle | Reload speed "depends on morale of your crew. A happy crew loads faster" [87 Fire Broadside]. In melee, morale can outweigh numbers [87 Number of Men]. | Morale on entering a boarding sets fighting strength: "if they are happy they fight like lions". The duel moves it up and down. Merchant crews have low morale [04 p.43]. |

### 3.4 Crew count: sailing and gunnery

- **1987.**
  - 8 men to sail a ship, and "four (4) of your crewmen to man each gun". Guns without crew never fire [87; 04 'What's Changed', PDF p.4].
  - "If you have fewer than eight men per ship, your men will abandon one" [87].
  - Crew count matters mostly through the share size (morale) and melee strength. There is no cap on crew size [WIKI Crew].
- **2004.**
  - Each ship type has a "minimum effective crew". Below it the ship is "much slower and less maneuverable", and the guns all fire but reload "far longer". The minimum rises as the ship takes damage [04 PDF p.4; p.19].
  - "More crew means faster reloads" [04 PDF p.17]. Crew above the minimum joins sea battles [04 p.22].
  - An undermanned fleet sails slower [04 p.22].
  - There is a hard cap equal to the fleet's total crew capacity [WIKI Crew].

### 3.5 Food and starvation

- **1987.** "Expect defections if you run out of food" [87 Information]. Small ships carry little food, which limits large crews in practice [WIKI Crew].
- **2004.**
  - When food runs out, "they'll put up with this for a short while, but soon their morale starts to plummet. If left unchecked, they will begin to desert." Morale stops falling once you have food again [04 p.27].
  - Food can be bought or taken from captures [04].
  - [WIKI Food]: 1 ton feeds 20 men a month (30 with a Cooper). [WIKI Mutiny]: starvation-driven unrest is not slowed by the Quartermaster or instruments. Both fan figures.

### 3.6 Desertion and mutiny

- **1987.** "When the crew is unhappy or angry, they will start deserting whenever you visit port. If they are angry too long, they mutiny. This means you must fight to remain Captain" [87 Morale]. Desertion makes the remaining shares bigger [WIKI Crew]. A failed mutiny takes a ship [WIKI Player's_Fleet].
- **2004.** Unhappy crews "desert. If you are at sea and have multiple ships in your fleet, they may steal one of the extra ships. Or they might run off the next time you go to port" [04 p.27]. [WIKI Mutiny]: mutineers take a random non-flagship, some crew and spare cannon, and you can recapture the ship in battle.

### 3.7 Dividing the plunder

- **1987.**
  - "Everything is split fairly, including the ships, cannons and cargo. As Captain, you retain only your flagship," so you should sell first [87].
  - "The crew always disperses… After refitting your ship (which takes a few months) you'll have to rebuild your band from scratch" [87 Town Options].
  - Large shares raise your reputation and small ones make "it harder for him to recruit new crewmen" [87].
  - Career: health declines and "one day you are unable to recruit a new crew". A career is about 5–10 years [87 Retirement].
- **2004.**
  - Possible in any city or pirate haven. Divide when the crew demands it, or to "bank" your share before you lose it in combat [04 p.79].
  - The crew's reaction to its share "determines your next crew's starting morale" [04 p.80].
  - A new voyage takes about 6 months and starts "with a small crew and gold equal to your portion" [04 pp.81-82]. You keep only the current flagship [WIKI Player's_Fleet].
  - You may be offered a change of difficulty, or retirement [04 p.80]. Ageing makes recruiting harder ("fewer crewmen will want to join") [04 p.82].
  - [SW]: dividing while each man gets 50+ gold ("eagerly") makes recruiting easier afterwards.

### 3.8 Recruiting

- **1987.**
  - Taverns, only when you enter town openly ("recruiting is a very public activity").
  - "The first time you visit a tavern openly your reputation will precede you… Subsequent visits while in port will not yield additional recruits" [87 The Tavern].
  - Captured ships are another source (2.1).
- **2004.**
  - Tavern sailors are limited ("Not all taverns have work-hungry sailors… it might take a while for more jobless sailors to show up"). Recruits beyond capacity don't "fit" [04 p.48].
  - The crowd scales with the town's economy and population and your rank there. Beating the Captain of the Guard adds recruits for that day [WIKI Tavern].
  - Higher difficulty makes recruiting harder [04 PDF p.7]. Holding the rank of Captain with a nation makes recruiting "easier" in its cities [04 PDF p.36].
  - Other sources: survivors in the water and volunteers from captures (2.1).

### 3.9 Specialists (2004 only)

All come from captured ships, are permanent, and don't count toward crew [04 pp.109-110; WIKI Specialist].

| Specialist | Effect [04] | Wiki detail |
|---|---|---|
| Cook | "Helps keep up the crew's morale"; "stretch[es] the crew's rations" (p.27) | — |
| Cooper | Food lasts longer | 30 men per ton instead of 20 |
| Quartermaster | "Less likely to desert or mutiny" | — |
| Gunner | "A very competent gunner can double a ship's rate of fire" | — |
| Surgeon | Heals crew wounded in battle | Half of swordfight losses return |
| Carpenter / Sailmaker | Hull or sail repairs at sea | 25% a month |
| Navigator | Faster fleet | — |

Smuggler and immigrant ships often carry one; barmaids point them out [WIKI Specialist].

## 4. Design takeaways

**After battle**
- Make the outcome screen the reward moment. Gold transfers automatically; the choices are cargo versus hold space, keep versus abandon, and accept volunteers.
- Make capture pay more than sinking: cargo, hull, crew and specialists. 2004 doubles the political credit for a *boarded* warship. Grape and chain shot exist to set up a capture.
- Base surrender on readable rules (crew ratio, demasting, the duel's one-man state) so players can engineer it.
- Model politics as a graph: the victim and its allies dislike you, its enemies reward you, cities remember. Add a bounty that spawns hunters, and gate promotions behind a Letter of Marque.
- Make defeat cost months of the career, not the save. Keep long-term progress (maps, specialists, banked gold); losing a flagship with a fleet behind you is the soft case.
- Give named enemies a post-battle choice: information, ransom or quest progress.
- Keep retreat clean. 1987's random ship loss was dropped because the game couldn't tell who was fleeing.

**Crew**
- Pay in shares, not wages: an unpaid crew whose mood tracks gold per head and months at sea. Both games use it, and it ties combat, trade and time together.
- Keep two purses (the crew's pool and the captain's banked share). Banking is the safe point that defeat can't take away.
- Make crew count matter mechanically (reload speed, sailing under a minimum crew) as well as for morale, so losses in battle cost something right away.
- Use food as a short fuse: starvation hurts morale quickly but recovers once food is found, while gold drives the long fuse.
- Pay out desertion in port and mutiny-steals-a-ship gradually, with a warning first (2004's first mate).
- Let dividing the plunder close one voyage and reset the next: the crew's reaction sets the next crew's starting morale. The months it takes age the captain.
- Use specialists as the main way to soften crew upkeep (cook, cooper, quartermaster), and get them only by capture.

## 5. How Corsair maps to this

| Topic | 1987 | 2004 | Corsair (built / planned) |
|---|---|---|---|
| Plunder screen | Text report plus cargo picker | Volunteers, then specialists, then plunder screen | Built: itemised report, then a plunder screen: take goods up to the hold, throw your own over, accept or refuse volunteers, sink or release |
| Prizes and fleet cap | 8 men per prize; no documented cap | 8-ship cap; crew capped by fleet capacity | Planned (fleets, PRD 7): 8-ship cap. Until then a prize is sunk or released |
| Captured captains | Named pirates and hunters: information or ransom | Villains give information or quest progress | Planned with villains (PRD 11) |
| Sinking rewards | Nothing | Survivors and floating barrels | Built: barrels (50 gold each, to the chest) and survivors to pick up for 25 s after she sinks |
| Surrender | Panic or one-man rule; crew-ratio check | Same, plus demasting | Built: beaten hull or crew (chance each second); a merchant strikes outright when demasted or outmanned 3 to 1 within 6 tiles; HUD shows "wavering" |
| World opinion and bounty | Wary or hostile; war and ally graph | Same, plus city memory and bounty numbers | Built: −20 with the victim's nation for attacking; +5 from nations at war with her (×2 for a warship taken); +3 everywhere for a pirate; governors pay bounties |
| Promotions | Governors; military ranks then nobility | Letter of Marque gate; per-nation ranks | Planned (PRD 12) |
| Defeat | Prison or marooned; flagship lost | Jail 3–12 months or marooned; banked gold safe | Built: let go afloat. Pirates take the plunder chest and cargo, never the purse; a nation's captain fines half the purse. Prison and marooning wait for ageing |
| Retreat | May lose a ship | No penalty; draw rules | Built: no penalty; the enemy leaves you be for 2 days |
| Pay model | Shares, captain 5–20% | Shares, captain 5–50% | Built: two purses. Plunder chest shared, captain takes 20%; optional wages from the purse |
| Morale drivers | Gold, months, crew size | Gold, months, food, items, specialists | Built: plunder per head, days unpaid, starving, victories, men lost |
| Crew count effects | 8 per ship, 4 per gun | Minimum crew; reload and speed scale | Built: reload faster up to 3× the guns' need, slower short-handed; below minimum crew she sails and turns slower |
| Food | Defections when out | Morale drops, then desertion | Built: 1 unit per 20 men a day at sea; starving costs 8 morale a day |
| Desertion and mutiny | In port; fight a mutiny | In port; ship stolen at sea | Built: desertion at landfall below 25 morale. Mutiny planned |
| Dividing the plunder | Crew disperses; keep flagship | About 6 months; sets next crew's morale | Built: in a tavern; the crew stays; morale set by each man's share |
| Recruiting | Tavern once per visit; reputation | Tavern pool by town and rank; volunteers | Built: tavern sign-on at 10 gold a man up to the berths; volunteers from prizes and the water |
| Specialists | — | 8 types, from captures only | Not planned yet |
