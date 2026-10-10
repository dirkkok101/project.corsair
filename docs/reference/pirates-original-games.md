# Reference: Pirates! (1987) and Sid Meier's Pirates! (2004)

How the two games handle the aftermath of a ship battle, the crew, and trade (with Anno for contrast). Use this before designing Corsair's equivalents. The two games are described separately, and every fact cites a source. **Unverified** marks anything no source confirmed.

Researched October 2026.

## 1. Sources

| Tag | Source | Good for |
|---|---|---|
| **[87]** | 1987 MicroProse manual, full text: http://www.antimon.org/dl/c64/misc/piratesdoc.html (cited by section heading; the text has no page numbers) | Designer intent for 1987: prizes, plunder, shares, morale, politics. It barely covers what happens to the player after defeat. |
| **[04]** | 2004 Firaxis PC manual (Steam): https://cdn.cloudflare.steamstatic.com/steam/apps/3920/manuals/manual.pdf (cited by printed page number; "PDF p." where the printed number is unclear) | Authoritative 2004 rules: victory/defeat, world opinion, crew, dividing the plunder, specialists. It also lists what changed from 1987. |
| **[WIKI]** | sidmeierspirates.fandom.com. The HTML pages return HTTP 402 to fetch tools; read them through the MediaWiki API instead: `https://sidmeierspirates.fandom.com/api.php?action=parse&page=<Page>&format=json&prop=wikitext&formatversion=2&redirects=1` | Measured mechanics and numbers (bounty amounts, the 8-ship limit, crew caps, 1987 captured-captain prompt). Fan-written; some numbers conflict with the manual. |
| **[SW]** | StrategyWiki 2004 walkthrough: https://strategywiki.org/wiki/Sid_Meier's_Pirates!_(2004)/Walkthrough (also blocks direct fetch; use `https://strategywiki.org/w/api.php?action=parse&page=...`) | Strategy experience: the real cost of jail or being lost at sea, gold-per-crew rules of thumb. |
| [WP] | https://en.wikipedia.org/wiki/Pirates!_Gold | Pirates! Gold (1993) differences. *Computer Gaming World* called it "not a significantly revised game". No source describes post-battle or crew changes, so treat Gold as 1987 (**unverified** in detail). |
| **[CI]** | Cutlass Isle fan forum (2004): http://www.hookedonpirates.com/forums//viewtopic.php?t=6784 | Players' buy and sell price thresholds and linked prices. Anecdotal. |
| **[1602]** | Anno 1602 fan FAQ (Tim Howgego and others): https://anno-capsu.netlify.app/1602/ (cited by page name), the 1998 German strategy guide on archive.org (`de-anno-1602-das-strategie-handbuch-1998`), and the Sunflowers product flyer (https://archive.org/details/kultflyers_21, cited as "flyer") | 1602 tiers, taxes, chains, free trader, disasters. No original manual was found, so all of it is secondary. |
| **[1404]** | anno1404.fandom.com, read through `https://anno1404.fandom.com/api.php?action=parse&page=<Page>&format=json&prop=wikitext&formatversion=2` (cited by page name) | 1404 needs, taxation, datamined rates, NPC traders, disasters. |
| **[1800]** | anno1800.fandom.com, same API (cited by page name) | 1800 needs, neutral traders, the Statistics screen, incidents. |
| **[AU]** | Anno Union devblog "Your own trading empire": https://www.anno-union.com/devblog-your-own-trading-empire/ | 1800 designer intent for trade routes. |

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

## 5. Trade and the economy

Goods, prices and towns in the two Pirates! games, then Anno for contrast. Only Anno's supply and trading ideas carry over.

### 5.1 Pirates!: goods and prices

| Topic | 1987 | 2004 |
|---|---|---|
| Goods | Food, goods, cannon, and one export crop per era: hides, then tobacco, then sugar [87 Trading with Merchants; WIKI Cargo]. | Six cargoes, cheapest to dearest: cannon, food, sugar, goods, spice, luxuries. Typical prices run from 0–2 gold for cannon to 10–30 for luxuries [WIKI Cargo]. Luxuries are "all imported from Europe" [04 p.110]. |
| What sets a price | Merchant strength is "proportional to the town's economic strength and population". Rich towns have more stock, cash and higher prices [87 Local Merchants]. Towns also have "special markets and needs" that push single goods very high or low [87]. | City type crosses size, wealth and defence (Capital = large, rich, strong; Outpost = small, poor, weak) [04 p.47]. Wealth mainly drives prices [WIKI City]. The gazetteer gives each town a specialty: "Sugar is often quite plentiful here"; Curaçao wants "spices and sugar" [04 pp.116–118]. Players find goods and luxuries priced high together, and sugar with spice [CI]. |
| Stock and cash | Each merchant has finite cash and finite stock of each good [WIKI City]. His cash "replenishes every once in a while" and tracks wealth [WIKI City]. | Stock and cash depend on wealth, population and the town's fixed traits. Both "only reset after several weeks away from the Port" [WIKI City]. |
| Your trades move the price | **Unverified.** No source says a unit sold lowers the next unit's price. | **Unverified**, as for 1987. |
| How long a price lasts | "All these effects are transitory, but while some patterns only last days or weeks, others can last for years" [87 Local Merchants]. | Prices drift by small random amounts and jump with events (5.2) [WIKI City]. |
| Who may trade | Spanish law bans foreign trade. Struggling towns trade with almost anyone, Surviving towns with decent reputations, Prosperous towns only with captains "of high repute", and Wealthy towns almost always obey the law [87 Spanish Trade Restrictions]. | Big Spanish ports deal "only with reputable Spanish traders" [04 p.116]. Rank helps: a Colonel gets "more goods available", a Marquis "many more" [04 p.72]. |
| Finding prices | Tavern travellers sell a town's population, economy and defences [87 The Tavern]. | The Mysterious Traveller gives other towns' prices, population, prosperity and garrison for free [WIKI Tavern]. Wealth shows on the town's map caption [WIKI City]. |

### 5.2 Pirates!: towns that grow and shrink

| Topic | 1987 | 2004 |
|---|---|---|
| Town stats | Population, wealth, loot gold and merchant cash [WIKI City]. Towns of more than 600 people have a governor [87 The Governor]. Wealth runs Struggling, Surviving, Prosperous, Wealthy [87]. | The same four stats. Wealth runs Poor, Modest, Prosperous, Wealthy [WIKI City]. |
| Default trend | Towns "slowly prosper and grow". Wealth draws people, and wealth brings troops and forts [87 The Rise & Fall of Colonies]. | Small random drift, plus the ships below [WIKI City]. |
| What moves a town | Random economic events, "several… every month", each hitting a random town [WIKI City]. Traders and smugglers help growth; taking ships near a town hurts it [87]. | Ships with a role move the numbers when they arrive [WIKI Ship_Role]: immigrant ships raise population; new-governor and sugar-plant ships raise wealth; a successful pirate raid lowers wealth; native war canoes lower population; troop and payroll ships add soldiers. An ordinary trader's arrival has "no discernible effect". A smuggler restocks the merchant with luxuries or spice [WIKI City]. Stop the ship and you stop the change. |
| Raids and sacking | A raid "takes whatever gold the pirates can find" and "damages the economy" [87]. Afterwards the town is "cleaned out" but its garrison is reinforced [87 Memoirs]. | Looting drops wealth "drastically", so a second raid yields nothing until wealth recovers [WIKI Raid]. A war raider's bombardment cuts wealth one level [WIKI City]. |
| Events | Native attacks cut the garrison only. Malaria and disease cut garrison and citizens and stall growth. A gold mine gives "a one-time upswing" and a boom town [87]. | No plague or famine events found. They appear only in the era histories [04 pp.84, 90]. **Unverified** that none exist. |
| Trade can backfire | Not documented. | Smuggling to poor Spanish towns "is self-limiting… your very success in trading will make these settlements rich, and thus more likely to follow Spanish trade laws and shut you out!" [04 p.86]. |

### 5.3 Pirates!: fleets, convoys and war

| Topic | 1987 | 2004 |
|---|---|---|
| Merchant traffic | Ships exist only when an encounter is rolled: trader, pirate raider or pirate hunter [WIKI Ship_Role]. | Every ship sails a real route. Traders sail only to ports of nations not at war with their owner; smugglers sail to enemy ports. Treasure ships ("at least 1000" gold) come from rich, populous ports [WIKI City]. |
| Treasure Fleet and Silver Train | They follow a printed itinerary, town by town and month by month [87 Treasure Fleets & Silver Trains]. A raid on a town that hosts either of them yields "a massive increase in looted Gold" [WIKI Raid]. | Treasure-fleet galleons enter at the map edge and sail to a fixed Spanish port. They cannot be taken by raiding a town [WIKI Ship_Role; WIKI Raid]. |
| Response to attacks | Not documented. | Ports whose shipping was attacked add escorts, sized by wealth and hostility. After enough sinkings a port sends a new warship [WIKI City]. |
| War and trade | War, peace and alliance are public, but the end of an alliance is not [87]. Forts of hostile nations fire on you [87 The Governor]. | Treaty and ultimatum ships end or start wars when they arrive. Raiders and invasion ships sail against enemy ports [WIKI Ship_Role]. War reroutes trade: traders stop going to enemy ports and smugglers go instead [WIKI City]. |

### 5.4 Pirates!: was trading worth it?

- **1987.** Peaceful trade gets you into small Spanish ports, but "profits from peaceful trade are modest" [87 Famous Expeditions]. Still, a Dutch trader "buys low, transports it, and sells high", keeps a small crew and banks his profit [87 Memoirs].
- **2004.** "Peaceful trading may not be as profitable as privateering, but it's a safer business" [04 p.90]. The Dutch Trader start trades between rich and new colonies with a small crew [04 pp.86, 92]. Players mostly "will not bother buying low and selling high – but only selling high" [WIKI Cargo].

### 5.5 Anno 1602, 1404 and 1800

No 1602 manual was found; 1602 rules come from a fan FAQ and a strategy guide.

| Topic | 1602 | 1404 | 1800 |
|---|---|---|---|
| Tiers and needs | Five tiers, from Pioneers (food only) to Aristocrats (six goods). Partial supply caps the tax rate; for example Citizens accept 38% fully supplied but 20% with 2 of 4 goods [1602 Colony Management]. Unmet demands block upgrades, while starvation makes people unhappy and they leave [1602 Essential Concepts]. | Four Western tiers and two Eastern. Needs are food, drink, clothing, property, plus four buildings. Thresholds rise with population [1404 Needs]. A house ascends only when full, euphoric, well supplied and holding building materials [1404 Population]. | Basic needs add residents and gate upgrades. Luxury needs add happiness and income but are optional [1800 Needs]. |
| Taxes | Each tier has a highest tax it will accept [1602]. | One slider sets tax and mood: Euphoria and Happiness draw people in, Calm holds, Irritation and Rage drive them out [1404 Taxation]. | No slider. Income per need = base × fulfilment; Royal Taxes take 9–40% from large tiers [1800 Royal Taxes]. |
| Chains | Tools: ore mine → smelter (ore + wood) → toolmaker. Food: 4 grain farms → 2 windmills → bakery [1602 Production Efficiency]. | Bread: 2 crop farms → mill → bakery; one chain feeds 727 Patricians. [1404 Production and consumption rates]. | Bread: 2 grain farms → mill → 2 bakeries; each building needs workers of a set tier [1800 Bakery; 1800 Workforce]. |
| Fertility and deposits | Northern islands grow tobacco, vines and sugar; southern islands grow cocoa, cotton and spice. Ore runs out (80 or 240 t); gold never does [1602 Resources]. | Northern islands are fertile grassland; southern desert needs norias. [1404 Fertilities]. | Fertilities are "randomly assigned" per island and region; New World crops need New World islands [1800 Fertilities and resources]. |
| NPC traders | The free trader resells only what some player produces, except ore and tools, which he has without limit until someone makes tools [1602 Trade and Diplomacy; 1602 Resources]. AI rivals trade at fixed prices, buying at about 1.5× their selling price [1602 AI Trade Prices]. | Lord Northburgh sells only Western goods, Grand Vizier Al Zahir only Eastern ones; Giacomo Garibaldi comes with the Venice add-on. Each has fixed per-good preferences and a purse and tonnage cap per visit, raised with honour [1404 Trade; 1404 Trade Bias]. Prices are fixed; the wiki gives the passive price as 2.5× the active one [1404 Advanced Economics]. Whether NPC stock is finite is **unverified**. | Five traders, each with a range of goods and a premium buy (Blake pays extra for coal). Each good restocks at a set rate up to about 150 t, from a pool shared by every player, and goods you sell join that pool. Buying costs 2.5× the selling price [1800 Neutral Traders; 1800 Trade]. |
| Your own warehouse | Per good: buy or sell, price slider and stock limit [1602 Trade and Diplomacy]. | Per good: a stock floor ("only sell… if there are more than 20") and a price slider. [1404 Warehouse; 1404 Trade]. | Buy, sell, or both around a target stock, per island [1800 Trade]. |
| Economy UI | One status screen, with trade averaged over 10 cycles, so the numbers lag [1602 Essential Concepts]. Busy buildings animate, as when windmill sails turn, "instead of dry statistics" [1602 flyer]. | One income and expense statement; need bars per house [1404 Taxation; 1404 Needs]. A per-good balance screen is **unverified**. | Statistics screen (patch 6.0): production against consumption per good, stock over time and trade history [1800 Statistics]. |
| Disasters | Plague, fire and drought (drought kills crops). [1602 Colony Development]. | Plague lowers population and downgrades houses, and "foreigners will not trade with the island". Sandstorms stop norias [1404 Disasters]. | Fire, explosions, riots ("stop working and paying taxes") and illness that "can jump to other islands by ships" [1800 City incidents]. |

**Design intent.** In 1602, "hardly any island can be self-sufficient", so the player must trade [1602 flyer]. The 1800 trade routes favour "the freedom of the player" and bring back "room for error and mismanagement" [AU].

### 5.6 Lessons from the economies

- **A price is a reading of a town's state.** Both Pirates! games derive prices from wealth and size, plus a short list of per-town specialties. That keeps prices readable and lets the world move them.
- **Change the world through ships you can intercept.** 2004 moves population and wealth only when ships arrive, so the player can stop a change or cause one. Ordinary trade traffic is mostly scenery.
- **Make trade money finite and slow to return.** Finite merchant cash, stock that resets after weeks, and raided towns push the player around the map.
- **Make success change the rules.** Rich Spanish towns close their markets, rank opens more stock, and attacked ports add escorts.
- **Grow slowly, fall fast.** Growth is steady; raids and disease are sudden shocks with visible causes.
- **Show the economy in the world.** Pirates! puts wealth on the town label and sells distant prices through travellers; Anno uses animation, need bars and, later, a balance screen.
- **Give NPC traders an identity.** Anno's traders have a range, premium buys, a purse cap and stock that restocks, which players learn and plan around.
- **Make shortages travel.** In Anno, plague closes an island to trade and illness spreads by ship, so a local event touches the routes.

## 6. How Corsair maps to this

| Topic | 1987 | 2004 | Corsair (built / planned) |
|---|---|---|---|
| Plunder screen | Text report plus cargo picker | Volunteers, then specialists, then plunder screen | Built: itemised report, then a plunder screen: take goods up to the hold, throw your own over, accept or refuse volunteers, sink or release |
| Prizes and fleet cap | 8 men per prize; no documented cap | 8-ship cap; crew capped by fleet capacity | Built: "Keep her" on the plunder screen, up to 8 ships; one shared hold and crew; the fleet at the slowest ship's pace |
| Captured captains | Named pirates and hunters: information or ransom | Villains give information or quest progress | Built for famous pirates: ask for a piece of his hoard's map, hold him for a governor's bounty, or set him free. Villains planned |
| Sinking rewards | Nothing | Survivors and floating barrels | Built: barrels (50 gold each, to the chest) and survivors to pick up for 25 s after she sinks |
| Surrender | Panic or one-man rule; crew-ratio check | Same, plus demasting | Built: beaten hull or crew (chance each second); a merchant strikes outright when demasted or outmanned 3 to 1 within 6 tiles; HUD shows "wavering" |
| World opinion and bounty | Wary or hostile; war and ally graph | Same, plus city memory and bounty numbers | Built: −20 with the victim's nation for attacking; +5 from nations at war with her (×2 for a warship taken); +3 everywhere for a pirate; governors pay bounties |
| Promotions | Governors; military ranks then nobility | Letter of Marque gate; per-nation ranks | Planned (PRD 12) |
| Defeat | Prison or marooned; flagship lost | Jail 3–12 months or marooned; banked gold safe | Built: let go afloat. Pirates take the plunder chest and the hold (leaving the rations), never the purse; a nation's captain fines half the purse. Prison and marooning wait for ageing |
| Retreat | May lose a ship | No penalty; draw rules | Built: no penalty; the enemy leaves you be for 2 days |
| Pay model | Shares, captain 5–20% | Shares, captain 5–50% | Built: two purses. Plunder chest shared, captain takes 20%; optional wages from the purse |
| Morale drivers | Gold, months, crew size | Gold, months, food, items, specialists | Built: plunder per head, days unpaid, starving, victories, men lost |
| Crew count effects | 8 per ship, 4 per gun | Minimum crew; reload and speed scale | Built: reload faster up to 3× the guns' need, slower short-handed; below minimum crew she sails and turns slower |
| Food | Defections when out | Morale drops, then desertion | Built: 1 unit per 20 men a day at sea; starving costs 8 morale a day |
| Desertion and mutiny | In port; fight a mutiny | In port; ship stolen at sea | Built: desertion at landfall below 25 morale. Mutiny planned |
| Dividing the plunder | Crew disperses; keep flagship | About 6 months; sets next crew's morale | Built: in a tavern; the crew stays; morale set by each man's share |
| Recruiting | Tavern once per visit; reputation | Tavern pool by town and rank; volunteers | Built: tavern sign-on at 10 gold a man up to the berths; volunteers from prizes and the water |
| Specialists | — | 8 types, from captures only | Not planned yet |
| Prices | Set by town wealth and size, plus local specialties | Wealth, city type and specialties; finite merchant cash | Built: stock-based prices drifting weekly to a usual level; AI merchants carry goods; shocks from news/storms |
| Supply response | Finite stock and cash; per-unit effect **unverified** | Stock and cash reset after weeks away; per-unit effect **unverified** | Built: stock-based prices drifting weekly to a usual level; AI merchants carry goods; shocks from news/storms |
| Town growth | Slow growth; random monthly events; raids and nearby captures hurt | Moved by arriving immigrant, governor, raider and canoe ships | Built: people grow a little each week when fed and fall when starved; convoys bring settlers |
| Production chains | — | — | Built: rum from sugar, cloth from cotton, unit for unit from what is in store |
| NPC traders | Encounter-only traders | Traders, smugglers, grain and treasure ships on real routes | Built: stock-based prices drifting weekly to a usual level; AI merchants carry goods; shocks from news/storms |
| Wars and trade | Public wars; hostile forts fire; Spanish towns refuse trade | Traders avoid enemy ports, smugglers use them; escorts after attacks | Built: merchants never call at a nation at war with theirs, so war closes its markets to them; patrols at war blockade |
| Events | Disease, native attacks, gold rushes | Role ships; no plague or famine found | Built: stock-based prices drifting weekly to a usual level; AI merchants carry goods; shocks from news/storms |
| Economy UI | Travellers sell town news | Wealth on the map caption; traveller lists prices | Built: people, merchant's purse and trend on the port header and the chart's port card; remembered prices on the chart |
