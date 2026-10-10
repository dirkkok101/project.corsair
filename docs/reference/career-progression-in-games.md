# Career progression in pirate and age-of-sail games

Researched 2026-10-10 for the career ladder in `docs/design/combat-model.md` (sections 2 and 3). The question:
how do these games take a player from a small start to a big ship and fleet? For each game it covers the start,
the loop, how better ships are got (buy, capture, quest, rank-gated), the goals the player is shown, and the pace.
It ends with what Corsair should take and the pitfalls.

**Covered elsewhere, not repeated here:**

- `pirates-sailing-combat-rewards.md` section 4: the 2004 rank benefits, Top Ten, ageing, retirement jobs.
- `pirates-original-games.md` sections 2-3: the 8-ship limit, dividing the plunder, crew shares, the captain's share.
- `naval-combat-in-games.md`:
  - 5.1: Akella classes 1-7, officers, perks.
  - 4: Sea of Thieves' horizontal progression and Skull and Bones' gear score.
  - 5.3 and 5.5: Windward zones, Sail Forth, Port Royale 4 combat.
  - 7: its pitfalls list.

This report adds the career side: starts, how ships are got, gates, objectives and pacing.

**Source tags:**

- **[M87]** 1987 manual: http://www.antimon.org/dl/c64/misc/piratesdoc.html (cited by section).
- **[M04]** 2004 manual: https://cdn.cloudflare.steamstatic.com/steam/apps/3920/manuals/manual.pdf (printed page
  numbers).
- **[W]** sidmeierspirates.fandom.com. Its HTML is blocked, so it was read through the MediaWiki API:
  `https://sidmeierspirates.fandom.com/api.php?action=parse&page=<Page>&format=json&prop=wikitext&formatversion=2`.
  The same applies to the other fandom wikis and StrategyWiki.
- **[CA]** CRPG Addict's 1987 career: https://crpgaddict.blogspot.com/2011/01/pirates-career-of-captain-gatomalo-part.html,
  [part 2](https://crpgaddict.blogspot.com/2011/01/pirates-career-of-captain-gatomalo-part_22.html) and
  [final rating](http://crpgaddict.blogspot.com/2011/01/pirates-final-rating.html).

**Confidence:**

- "Unverified" means only a search snippet or a single fan claim supports it.
- Fan wikis are fan-written. Where a wiki and a manual disagree, the manual wins.

---

## 1. Sid Meier's Pirates! (1987), Pirates! Gold (1993), Sid Meier's Pirates! (2004)

### 1.1 Starting choices

**1987** [M87, "Initial Opportunities", "Selecting a Nationality", "Difficulty Level", "Special Abilities"]

- **Three modes.** Start a New Career is the standard game. Command a Famous Expedition is "a short game" that
  ends when you divide the plunder and is "not for a novice". There are six expeditions: Hawkins 1569, Drake 1573,
  Heyn 1628, l'Olonnais 1666, Morgan 1671 and de Pointis 1697.
- **Six eras:**
  - 1560 and 1600 are "not for novices".
  - 1640 is the "heyday for small, independent buccaneers".
  - **1660, the Buccaneer Heroes, is the default**: "makes piracy a pleasure for players of every skill level".
  - 1680 brings navy patrols, and Letters of Marque are harder to get.
- **Four roles.** English Buccaneer (recommended), French Buccaneer, Dutch Adventurer, Spanish Renegade (hardest;
  Costa Guarda in 1680). The role "determines where you start, what ship(s) you have, the size of your crew, your
  initial wealth and reputation". It does not bind you: "your acts speak for you".
- **Difficulty sets your cut, not the enemy's stats.**
  - Apprentice gives "maximum aid from expert subordinate officers", but they "take rather large shares, leaving
    little for you".
  - At Swashbuckler the officers are "drunken gutter swine", and your share is the largest.
  - The shares: "an apprentice Captain with two shares gains 5%, a journeyman with four gains 10%, an adventurer
    with six gains 15%, and a swashbuckler with eight gains 20%" [M87, "A Merry Crew 'On Account'"].
- **One special ability**: fencing, navigation, gunnery, wit and charm, or medicine. Medicine "preserve[s] your
  good health longer... your career can last longer", and the CRPG Addict always took it [CA].
- **A dated question opens the game.** You are asked when the Treasure Fleet or Silver Train arrives at a city.
  A wrong answer gives a "most bleak" start [M87, "Your Starting Tale"]. This was copy protection, but it also
  plants the treasure fleet as a goal.

**2004** [M04 pp.15-16]

- **Five difficulties**: Apprentice, Journeyman, Adventurer, Rogue, Swashbuckler.
  - Higher levels toughen the action sequences and make crew "harder to recruit... and keep happy".
  - Your share is 5 / 10 / 20 / 30 / 50% [M04 p.80, checked against the PDF].
  - Difficulty can be changed only when you divide the plunder. A strong voyage offers a step up, a poor one a
    step down.
- **Eras.** Five: 1600-1680 (1560 was dropped). "1660 is the only era available on Apprentice."
- **Nation.** "You begin with a Letter of Marque from your chosen nation". English is the easiest in 1660.

### 1.2 Starting ship, crew and gold

Starting ship by era and nation [W Starting_Ship, consistent with the 1987 manual's era notes]:

| Era | 1987 English | French | Dutch | Spanish | 2004 English | French | Dutch | Spanish |
|---|---|---|---|---|---|---|---|---|
| 1560 | Fast galleon + pinnace | Barque + pinnace | none | Pinnace | n/a | | | |
| 1600 | Merchantman | Barque | Cargo fluyt | Pinnace | Merchantman | Sloop | Fluyt | Pinnace |
| 1620 | Barque | Barque | Fast galleon | Pinnace | Brigantine | Barque | Brig | Pinnace |
| 1640 | Barque | Pinnace | Cargo fluyt | Pinnace | Sloop | Pinnace | Brigantine | Mail runner |
| 1660 | Sloop | Sloop | Sloop | Pinnace | Sloop | Sloop | Sloop | Sloop |
| 1680 | Sloop | Sloop | Sloop | Sloop (Costa Guarda) | Sloop of war | Brigantine | Sloop of war | Fast galleon |

- **Difficulty does not change the starting ship** in either version, as far as any source shows.
- **Size of the starts.** M04 p.19: "You usually begin a game of Pirates! aboard a sloop. You need eight crewmen to
  sail and fight with this ship." In 1987 a sloop carries 12 guns and up to 96 men; a frigate carries 28 guns and
  224 men [M87 ship entries].
- **Era starts are trade-offs** [M87 era notes]:
  - 1600 English: a "large crew" but a "capacious merchantman with its sluggish sailing qualities and weak armament".
  - 1560 English: "a powerful and flexible force... tiny coffers".
- **Crew and gold per start: unverified.** No source tabulates them. One data point: the CRPG Addict's 1660 Spanish
  start was a pinnace with 64 men and a hold of food [CA].
- **The 2004 story.** You watch Marquis Montalban enslave your family and escape. At 18 you sail out, the crew
  mutinies against its abusive captain, and you are captain from the first minute [W Player_Character;
  https://en.wikipedia.org/wiki/Sid_Meier%27s_Pirates!_(2004_video_game)].
- **Each later voyage restarts small.**
  - 1987: "one ship, recently cleaned and outfitted, some initial funds from your financial backers (about 10% of
    the last voyage's profit), and a core of loyal crewmen" [M87, "A Merry Crew 'On Account'"].
  - 2004: "a small crew and gold equal to your portion of the plunder" [M04 p.81].

### 1.3 How the player gets better ships: capture, never buy

- **1987.** Merchants "can repair or buy ships and cannon, but almost never have any for sale" [M87, "Trading with
  Merchants"]. Prizes can be sold: "taking a ship prize is useful, since you can sell the ship as well as its
  cargo". But "each prize requires eight men", and "a slow-sailing prize will slow down your entire fleet" [M87].
- **2004.** "Once you capture another vessel, you can choose to add it to your fleet" [M04 p.22].
  - The shipwright repairs, upgrades and sells ships [M04 p.48]. **No buying of ships is described.**
  - The fleet holds 8 ships including the flagship. Past that, "you will not have the option to keep the new
    ship" [M04 pp.22-23].
- **Dividing the plunder resets the fleet** in both versions. 1987: "As Captain, you retain only your flagship...
  it's advisable to sell everything except your flagship before dividing" [M87]. 2004 does the same
  (`pirates-original-games.md` 3.7, from [W Player's_Fleet]).
- **Big ships carry their own costs**, so capture-only does not snowball:
  - The fleet sails at the pace of its slowest ship.
  - Only shallow hulls cross shoals.
  - Minimum crews thin the fighting flagship.
  - Before each battle you pick one ship to fight in.
- **Players settle on small ships.**
  - Sydney: "sell off those slow prizes. I'd just hold onto me handy sloop" [M87].
  - The CRPG Addict never used a frigate and preferred "the maneuverability of a sloop or barque, even when taking
    on a galleon" [CA].
  - Guides advise keeping one fast ship [https://armchairgeneral.com/sid-meiers-pirates-strategy.htm].
  - StrategyWiki advises "the third ship in your chosen class" and never fighting in a trade galleon
    [https://strategywiki.org/wiki/Sid_Meier's_Pirates!_(2004)/Walkthrough].
- **Takeaway: in Pirates! the ship ladder is sideways.** A better ship means the right ship for your style,
  taken from someone else. It is never bought, and it is never simply bigger.

### 1.4 Rank, land and titles

- **1987 ladder** [M87, "Ranks & Titles"]:
  - Military ranks: Ensign, Captain, Major, Colonel, Admiral "of Privateers" or "of a Colonial Militia".
  - Then "patents of nobility" for "large and significant services": Baron, Count, Marquis, Duke.
  - A governor promotes "men who have proved their bravery and worth by fighting the enemy", and never while his
    nation is wary or hostile.
- **Land grants.** "The more you accomplish at a rank, the more land you receive when you are promoted"
  [M87, "Gains & Goals"]. No fixed acreage is published. One career, as data rather than rule: Ensign 150 acres,
  Major 250, a later promotion 300, and 2,150 acres in all by retirement [CA].
- **Letters of Marque.** The CRPG Addict paid 800 gold (England) and 1,000 (France) for his in 1987 [CA].
- **2004.** The ladder starts at Captain, needs a Letter of Marque, and is kept per nation; each rank gives one
  concrete benefit there [M04 pp.70-73] (table in `pirates-sailing-combat-rewards.md`).
  - Missions can give "immediate promotion or at least several steps" [M04 p.75].
  - The wiki's land per noble title is unverified [W Rank].

### 1.5 Retirement, score and ageing: the career has an end

- **1987 score.** Retirement quality is "a sum of your personal fortune, your rank, your lands, your reputation,
  the wife you marry (if any), and whatever especially pleasing events befall you" [M87, "A Word About Your Goals"].
  - You may retire after any division and come back "if your health permits". The manual suggests "a few trial
    retirements".
  - The best are kept in a Hall of Fame.
- **1987 career length.** "Eventually wounds from battle and the taxing demands of sea voyages affect your
  health... one day you are unable to recruit a new crew. In general, your career is limited to five to ten years
  of active endeavor" [M87, "Gains & Goals"].
- **One 1987 career** [CA]:
  - 1660 to December 1667, retiring at 32: about 7.5 game years.
  - 50 of 100 points made him a "Merchant Captain", with 41,220 gold and 2,150 acres.
  - Retirement jobs run from King's Advisor at 95+ down to beggar [W Retirement_Job].
- **2004 ageing.** "When your pirate reaches certain ages, 30, 35, 40, 50, etc., the game determines if his powers
  have diminished. If so, one game action becomes more difficult" [M04 p.81].
  - A refit after dividing takes about 6 months, prison 3-12 months.
  - The wiki adds a likely forced retirement past 40 [W Age].
- **2004 Fame.** It is out of 126 [W Fame]:
  - wealth 24 (22,000 acres for full marks)
  - rank: 1 per rank per nation, 32
  - love 10
  - Top Ten pirates 9, and their treasures 9
  - family and lost cities 32
  - Montalban 10
- **Takeaway.** Fame is a checklist of deeds across every activity. The score reads as a list of deeds, not
  as gold alone.

### 1.6 Objectives the game surfaces

| Thread | 1987 | 2004 |
|---|---|---|
| Lost family | Relatives held by randomly named titled Spaniards. Each beaten noble gives a map piece. The CRPG Addict's sister then led to a 100,000-gold Inca treasure [CA] | Sister, uncle, aunt, grandfather in order. Baron Raymondo holds the map pieces. Rescues lead to Montalban (100,000 gold) or to lost-city maps [W Family; W Evil_Spaniards] |
| Villain | The evil Spaniards above | Baron Raymondo, Marquis Montalban, Colonel Mendoza (who kidnaps your love) [W Evil_Spaniards] |
| Treasure Fleet and Silver Train | Fixed seasonal routes per era, printed in the manual | Learnt from captured captains |
| Governors' daughters | Marriage counts toward the retirement score | Need a minimum rank; give items and maps |
| Missions | Present (the CRPG Addict carried a letter and hunted "One-Eye"); Gold added governor missions per Wikipedia | Escorts, criminals; no penalty for failure [M04 pp.73-75] |
| Top Ten | none | Nine named pirates plus you |

All quests are untimed and failure costs nothing [M04 pp.73-75]. Several are open at once, a "travelling
salesman" of goals that the CRPG Addict describes.

### 1.7 Pacing and the first hour

- **No source gives a time to a frigate.** The genre never treats it as the goal. The CRPG Addict's 1987 pace [CA]:
  - first prize (a barque) on day 6
  - three small ships within 3 weeks
  - first promotion (Ensign) after about 4 months
  - first voyage of about 2 years, ending in a 100,000 Inca treasure
- **Why the opening works.** You are captain in minute one, a prize is days away, and the first map piece or
  relative clue shows the long threads early. Sid's rule ("you can almost not reward the player enough in the
  very early stages") is in `pirates-sailing-combat-rewards.md` 4.
- **Pirates! Gold** is the same career with VGA art and governor missions. DOS Days calls it noticeably easier
  (unverified) [https://www.dosdays.co.uk/topics/Games/game_piratesg.php].

### 1.8 Criticism of the career

- **Repetition.** IGN, via Wikipedia, notes "the repetitive nature of the gameplay over time". The CRPG Addict:
  "all combats get repetitive and boring towards the end".
- **The reset hurts.** Present Perfect Gaming: "The repetitiveness set in after I divided the plunder for the first
  time". Dividing "means losing your fleet and a chunk of your accumulated wealth", and the reviewer missed "a
  central story and an end point" [https://presentperfectgaming.com/pirates/].
- **Dominant plans.**
  - One fast small ship, grape and board.
  - Never divide the plunder, holding 1,000-3,000 gold a man to keep morale (StrategyWiki).
  - Always take Medicine.
  - Higher difficulty pays more, but the CRPG Addict found "the downsides... generally outrank the benefits".

---

## 2. The Akella / Seaward / BlackMark series and Corsairs Legacy

### 2.1 Starts

| Game | Hero and start |
|---|---|
| Sea Dogs (2000) | Nicholas Sharp, freed captive, in a pink with "40 men and 8 cannons". In the same preview he meets a caravel of 220 men and 28 guns [https://www.quartertothree.com/early/sea_dogs/sea_dogs_early.shtml] |
| Pirates of the Caribbean (2003) | Nathaniel Hawk in the trading lugger *Victory*, soon commandeered by Governor Silehard; a linear English story to the Black Pearl [https://pirates.fandom.com/wiki/Nathaniel_Hawk] |
| Age of Pirates: Caribbean Tales (2006) | Blaze or Beatrice Sharp in a class 6 ship (vanilla ship unverified; a sloop in the Supermod [https://www.moddb.com/mods/age-of-pirates-supermod]). Difficulty sets the start: Cadet 4,000 gold, Captain 1,000 [https://steamcommunity.com/app/817460/discussions/0/1735463620096178415/] |
| Age of Pirates 2: City of Abandoned Ships (2007) | Most heroes start in "a random class 7 ship". Peter Blood gets "a powerful frigate" after a long intro, but its upkeep cripples him; players advise "get a smaller ship (class 6 to 5)" [https://ageofpirates.fandom.com/wiki/Age_of_Pirates_Wiki; https://www.piratesahoy.net/threads/new-to-sea-dogs-city-of-abandoned-ships-i-dont-know-how-to-start.33021/] |
| Sea Dogs: To Each His Own (2012) | Charles de Maure lands at Martinique **with no ship**. Intro quests raise 17,000 pesos for a lugger (40 crew, a navigator officer): "Unlocking the full game". Then a 1,000,000 peso debt frames the long game [https://steamcommunity.com/sharedfiles/filedetails/?id=1286690349] |
| Corsairs Legacy (2024, early access) | Cutter is the bottom rung (starting ship unverified) [https://corsairslegacy.com/article/corsairs_legacy_ships] |

### 2.2 How ship class is gated

The series moved from rank gates to skill gates to no gate.

- **Sea Dogs (2000): rank, by convention.** A walkthrough's ladder [https://steamcommunity.com/sharedfiles/filedetails/?id=3005878209]:
  - Start ship, then buy a snow.
  - Capture and sell class 5-4 pirates for about 20,000-30,000 each, until rank 8.
  - Plated fast galleon (100-200k), then rank 6 war galleon, rank 4 lineship, rank 2 armoured battleship.
  - Finally capture Beltrop's manowar, "the best ship in the game".
  - Whether shipyards enforce this by rank is unverified. Rank runs down to 1, with about 3 skill points per rank
    into 9 skills.
- **PotC (2003): no real gate.** The manual promised "a new ship class for every two levels you go up in rank"
  (unverified snippet), but a modder states "Neither level nor leadership has any affect on what you can sail"
  [https://www.piratesahoy.net/threads/level-ship.860/]. The New Horizons mod later added naval-rank purchase gates
  (rank 2 for 5th rates up to rank 10 for 1st rates, lifted at Commodore), and naval officers are *assigned* a ship
  at promotion [https://www.piratesahoy.net/threads/why-cant-i-buy-certain-ships.28379/].
- **Caribbean Tales (2006): rank sets a soft penalty, and the top two classes can't be bought.**
  - "Operating a ship above your rank will incur a penalty on Navigation, Accuracy, Defence, Boarding". You start
    at class 6, and "each two character ranks" lift you a class.
  - "You can only buy class 6 to 3 ships, 2 and 1 have to be captured" [Steam thread above].
- **City of Abandoned Ships (2007): a Navigation skill gate plus shipyard stock by rank.**
  - Navigation needed: class 6 1, class 5 25, class 4 40, class 3 65, class 2 80, class 1 95 (manual snippet,
    unverified).
  - A navigator officer's skill counts instead of yours.
  - Shipyards stock by rank: rank 1 schooner and barque; 3 caravel and fluyt; 5 brig; 8 corvette; 12 frigate;
    18 lineship and battleship (from game code, partly garbled)
    [https://www.piratesahoy.net/threads/certain-types-of-ships-not-available-at-shipyard.15609/].
  - Some types are never sold, only captured.
- **To Each His Own (2012): the same Navigation gate with soft penalties.**
  - Thresholds: class 6 1, 5 25, 4 45, 3 65, 2 80, 1 95. Below them, "ship stats are reduced by the difference"
    [https://steamcommunity.com/sharedfiles/filedetails/?id=1246840392].
  - "1st class ships... cannot be purchased from shipyards"; they come from raids, "more often at high ranks".
  - A hired navigator lifts the gate, so a player bought a 450k heavy frigate mid-story with a Nav-85 officer
    [https://steamcommunity.com/app/223330/discussions/1/1319961868326698523/].
- **Caribbean Legend (2023 remake): no rank caps on questlines.** It adds class 7, and the story "tr[ies] to
  scale the difficulty to your Rank" [https://steamcommunity.com/sharedfiles/filedetails/?id=3227894342].
  A 50-hour player was "only starting to look at upgrading my ships".
- **Corsairs Legacy: no command gate; encounters scale with the ship.**
  - "10-15% of ships spawn 1 step above your current type".
  - "A fully upgraded ship of the previous type can outperform an unupgraded ship of the next type".
  - A crewless ship of any size can be taken ("even a cutter can capture a Lineship")
    [https://corsairslegacy.com/article/corsairs_legacy_ships].

### 2.3 Questlines and the endgame

- **Sea Dogs.** A national privateer line ends with you capturing islands and made Viceroy; the Spanish line gives
  "Title of Spanish Grandee and rank of Admiral". The free corsair founds a pirate republic [Steam guide above].
- **City of Abandoned Ships.** A Letter of Marque opens one nation's Governor-General questline and locks the
  others [https://ageofpirates.fandom.com/wiki/Nation_Quests].
  - The French line runs Lieutenant, Commander, Captain, then Baron, and ends with the *Soleil Royal* (class 1,
    112 guns) [https://ageofpirates.fandom.com/wiki/French_Quest_Line].
  - Unique ships are quest prizes: the Flying Dutchman (666 black pearls, then board it), the corvette "Dog of War"
    [https://ageofpirates.fandom.com/wiki/Important_Quests].
- **To Each His Own.** The main quests lock at rank 15, so over-levelling in free play shuts you out (a rule the
  remake removed). Quest ships: Meifeng, Mirage, Valkyrie, Fortune.

### 2.4 Pace and complaints

- **Slow, grinding starts.** About 6 hours of grind before To Each His Own's first ship (unverified snippet).
  Caribbean Tales' levelling is "much harder" than PotC's
  [https://www.gamespot.com/reviews/age-of-pirates-caribbean-tales-review/1900-6159850/].
- **Level-scaled enemies.** In City of Abandoned Ships, "the enemies level up with you"; fights get "considerably
  tougher" at levels 30-40 [wiki main page].
- **Exploits for money.** Shopkeeper cargo contracts "could make a million within days" (piratesahoy thread 33021),
  which skips the ladder.
- **Repetition and pressure.** After about level 25, "endless repetition", impossible timed missions and relentless
  bounty hunters [https://www.piratesahoy.net/threads/sea-dogs-to-each-his-own-a-short-review.27541/].
- **Tedium.** "Four loading screens to simply go ashore and sell a boatload of coco beans" (quartertothree, Sea Dogs).

---

## 3. Assassin's Creed IV Black Flag (2013) and Rogue (2014)

- **One hero ship, never replaced.** The Jackdaw starts with every line at tier I ("Default") and is upgraded
  through the whole game [https://assassinscreed.fandom.com/wiki/Crafting_(Assassin%27s_Creed_IV:_Black_Flag)].
- **The loop.** Disable a ship, board or sink it, take its wood, metal and cloth, and spend reales plus materials
  at the harbourmaster [https://assassinscreed.fandom.com/wiki/Jackdaw].
- **Costs double tier on tier, and metal is the bottleneck.**
  - Hull armour: II 1,000; III 4,000 + 100 metal + 200 wood; IV 16,000 + 200 + 500.
  - Elite hull: 30,000 + 400 + 750 *and a plan*.
  - Broadside cannon go from 70 metal (II) to 12,000 + 500 metal (VI).
- **Plans gate the top tier.** There are 12 elite plans, six in underwater wrecks and six at treasure-map digs
  [https://www.gamesradar.com/assassins-creed-4-black-flag-elite-ship-upgrades-guide/]. So exploration
  sites, not combat, unlock the top tier. A per-sequence story gate on upgrades is unverified.
- **Danger is shown as a level.** The spyglass shows each ship's level against yours: red dangerous, white even,
  green weaker [https://steamcommunity.com/app/242050/discussions/0/360670708787564625]. Men o' war reach level 60,
  and wanted level 4 spawns them. A fully upgraded Jackdaw reads about level 45.
- **The end goal is five legendary ships.** Beating all of them grants the ram
  [https://assassinscreed.fandom.com/wiki/Legendary_ship]. Players: only a maxed Jackdaw is "equally as good as
  Legendary ships" [https://steamcommunity.com/app/242050/discussions/0/558753803762393058/].
- **Kenway's Fleet.** Captured ships go to a side map of trade missions (up to 15 ships)
  [https://assassinscreed.fandom.com/wiki/Edward_Kenway%27s_fleet]. Prizes become a trade network rather than
  ships you sail.
- **Resynced (2026).** The fleet unlocks at Sequence 4, and a region's routes open when you take its fort
  [https://www.keengamer.com/articles/guides/how-to-manage-kenways-fleet-in-assassins-creed-black-flag-resynced/].
  Guides call metal "the ultimate bottleneck", steeper than in 2013 (unverified snippet).
- **Rogue.** Same model. Story beats add new weapon types (Puckle guns, burning oil, an ice-breaking ram), elite
  tiers need blueprints, and seven legendary ships end it [https://assassinscreed.fandom.com/wiki/Morrigan].

**Takeaway.** One beloved ship that grows works when every tier shows on the hull and each tier needs a different
activity (fights for metal, digs for plans). It fails when one material becomes a grind.

---

## 4. Port Royale and Patrician: rank by wealth

- **Port Royale 1 (2002).** Start in a nation's city with a small ship and 19 goods
  [https://en.wikipedia.org/wiki/Port_Royale:_Gold,_Power_and_Pirates].
  - 10 ranks, each adding a captain and ten ships of capacity (unverified snippet,
    https://www.gamespot.com/articles/port-royale-impressions/1100-6025113/).
  - The goal: governor, or marrying a governor's daughter.
- **Port Royale 2 (2004): rank is total assets.** The start package is a choice: "Gold" gives a pinnace instead of
  a brig plus cash. Ranks and what they unlock [https://strategywiki.org/wiki/Port_Royale_2/Walkthrough;
  https://strategywiki.org/wiki/Port_Royale_2/Ranks]:

  | Rank | Assets | Captains | Permits | Also |
  |---|---|---|---|---|
  | Ship's Boy | start | 1 | 0 | |
  | Ordinary Sailor | 100K | 2 | 1 | |
  | Sailor | 150K | 3 | 2 | Governor missions |
  | Boatswain | 400K | 6 | 3 | Viceroys, Letters of Marque, town conquest |
  | Lieutenant | 1.5M | 10 | 5 | Governors' daughters |
  | Captain | 6M | 100 | 10 | |
  | Commodore and up | 9M-60M | 100 | unlimited | Titles only |

  - The early loop: trade by hand until the captain can run auto-routes and you hold about 100K. Then buy a
    trading flute, take tavern missions, and swap the pinnace for a military corvette.
  - Ships are bought, but **ships of the line are mostly captured**, best from English military convoys.
  - A Letter of Marque costs more as you rise: 35K at Sailor, 350K at the top.
  - Capture two towns for a viceroy and you get your own [https://strategywiki.org/wiki/Port_Royale_2/Your_Own_Town].
- **Port Royale 3.** Two campaigns, the Trader (starts in a brig) and the Adventurer. Rank comes from town
  prosperity, profit, discovery and beaten pirates (unverified snippet,
  https://lucidretpa.weebly.com/port-royale-3-ranks.html).
- **Port Royale 4.** Fame points from the viceroy buy licences, permits and ships; **a warship licence costs twice
  a trader's** (unverified snippet,
  https://checkpointgaming.net/reviews/2020/10/port-royale-4-review-not-smooth-sailing/).
- **Patrician III** [https://cdn.akamai.steamstatic.com/steam/apps/33570/manuals/manual-patrician3.pdf;
  https://patrician3.fandom.com/wiki/Ranks]:
  - Starting options: capital of 1,000, 10,000 or 30,000; a snaikka, or a snaikka plus a crayer; a goal of none,
    Mayor, Alderman, or most points by a date.
  - **What a shipyard can build depends on its experience**: hulks are not available at first, and river towns
    build only small hulls.
  - Rank, checked monthly and never lost: Shopkeeper, Trader 100K, Merchant 200K, Travelling Merchant 300K plus the
    guild, Councillor 500K, Patrician 900K plus reputation in every class, then elected Mayor and Alderman.
- **Patrician IV** adds a fleet-size condition to each rank, and each rank unlocks a verb (a counting house,
  marriage, pirate missions, a council vote, running for mayor)
  [https://patrician4.fandom.com/wiki/Trader_Rank]:
  - Wholesaler: 150K and 2 ships.
  - Travelling Merchant: 500K, 4 ships, 100 workers.
  - Councilman: 1.1M and 10 ships.
  - Patrician: 3.2M and 25 ships.

**Takeaway.** Wealth ranks unlock *reach* (more captains, permits, politics), not ship power. Capital ships are
capture-only even in a buying economy. Gating by a shipyard's growth, not the player's level, keeps the world's
logic.

---

## 5. Uncharted Waters

- **New Horizons (1994).**
  - Six heroes, each with their own story; for example João Franco starts with $1,000, a tiara to sell and a
    Latin-rigged caravel [https://koei.fandom.com/wiki/Uncharted_Waters:_New_Horizons].
  - Three fames (trade, piracy, adventure); story beats trigger at thresholds (adventure 2,000, 8,000, about 23,500)
    [https://unchartedwatersnewhorizons.com/?p=42].
  - Royal titles come from favours but "do not add to the adventure points which ultimately win the game".
  - **Better ships come from port industry.** Investing in a shipyard town raises what it builds; at industry 1000
    it adds the heavy galleon and carronades [https://listed.to/@Valtarien/61012/uwnh-ship-upgrades]. No rank
    gate was found.
- **Uncharted Waters Online.**
  - Everyone starts in a barca with 50K. The beginner, intermediate and advanced courses award a caravel, a sloop
    and a frigate, and each nation adds a gift ship (unverified snippet,
    https://forums.mmorpg.com/discussion/366992/uncharted-waters-online-the-basics).
  - Ships need Adventure, Trade and Battle levels (for example 30/15/10).
  - Court rank sums investment, discoveries and battle deeds [https://unchartedwaters.fandom.com/wiki/Ranks_and_Promotions].

**Takeaway.** Three separate fames let a trader and a fighter both climb and both feel it. Ships gated by what a
port can build make investment a progression path.

---

## 6. Sea of Thieves, Windward, Sail Forth, Skull and Bones (progression only)

- **Sea of Thieves.** Pirate Legend needs level 50 with three companies
  [https://game8.co/games/Sea-of-Thieves/archives/451367]. Emissary grades 1-5 multiply rewards 1x to 2.5x but
  reset each session. Players: "So everything is purely cosmetic? I feel cheated"
  [https://www.seaofthieves.com/community/forums/topic/47120/]; "gold is entirely pointless"
  [https://www.seaofthieves.com/community/forums/topic/118955/]. Without power progression, gold loses meaning.
- **Windward.**
  - A town's size sets what ships it sells, and corvettes and frigates appear only in zones 30+.
  - Prices run from about 130K to 900K, and regions need talent points to enter
    [https://steamcommunity.com/app/326410/discussions/0/4698886342117338963/].
  - Higher tiers need blueprints dropped by higher-level enemies; players stalled at the brigantine
    [https://steamcommunity.com/app/326410/discussions/0/358415738206727980/].
- **Sail Forth.** The Fleet Update (2023) fixed "large ships available from the first shop... players would grind
  it out immediately and not feel any need to upgrade"
  [https://nintendoeverything.com/sail-forth-details-new-the-fleet-update-patch-notes/].
  - Each new shop now unlocks one boat of the current chapter's tier, and big ships were moved later and repriced.
  - **This is the clearest evidence for the "buy the best ship" collapse, and for its fix: stock by place and
    chapter.**
- **Skull and Bones (2024).**
  - Start in a dhow with no weapon slots [https://game8.co/games/Skull-and-Bones/archives/442437].
  - The Infamy ranks (Outcast to Kingpin, 39,030 points) gate ship blueprints; you buy the blueprint, then craft
    it from materials.
  - A gear score pushes players to equip "whatever makes that number go up", with "four viable ships" late
    [https://gamingbolt.com/skull-and-bones-review-shipwrecked].
  - A medium ship takes about 10 hours of "grinding and refining... dozens of crafting materials". The endgame
    brings "ship progression being tied to luck or dozens of hours of ungenerous, repetitive grind"
    [https://www.well-played.com.au/skull-and-bones-review/].
  - Metacritic 58 [https://en.wikipedia.org/wiki/Skull_and_Bones_(video_game)].

---

## 7. Comparison: how better ships are got, and what gates them

| Game | Buy? | Capture? | The gate on big ships | Did it work? |
|---|---|---|---|---|
| Pirates! 1987/2004 | No (1987 "almost never for sale"; 2004 sell only) | Yes, the only way | None; big ships pay their own costs (slow fleet, shoals, crew minimums), and dividing resets the fleet | Yes for variety (players keep fast small ships); no long-term ship goal |
| Sea Dogs | Yes | Yes (selling prizes is the money engine) | Rank by convention | Unclear |
| PotC 2003 | Yes | Yes | None in practice (the manual's gate wasn't real) | Mod added naval-rank gates |
| Caribbean Tales | Classes 6-3 | Classes 2-1 only | Rank sets a soft penalty | Mixed reviews |
| COAS / TEHO | Yes, stock by rank; class 1 never | Yes | Navigation skill with soft penalties; a hired navigator bypasses it | Bypass is the standard advice; the remake dropped rank caps |
| Corsairs Legacy | Yes | Yes | None; encounters scale with ship type | Too early to judge |
| Black Flag / Rogue | One ship | Fleet only | Materials plus plans from exploration | Liked; the metal grind is the complaint |
| Port Royale 2 | Yes | Ships of the line mostly | Rank (assets) gates captains, not hulls | Long-lived design |
| Port Royale 4 | Licences | Yes | Fame points; warships cost 2x | Unverified |
| Patrician III/IV | Built | Rare | Shipyard experience; ranks need fleet sizes | Yes |
| UW New Horizons | Yes | Yes | Port industry | Yes |
| UW Online | Yes | | Separate adventure, trade and battle levels | MMO grind |
| Windward | Yes | | Town size, zone level, blueprints | Stalls at mid tier |
| Sail Forth | Yes | Yes | Chapter-tier shops (after the patch) | The patch fixed the buy-best collapse |
| Skull and Bones | Craft | No | Infamy rank plus materials | Panned |

**What the comparison shows:**

1. **Capital ships are capture- or quest-only almost everywhere**, including the buying economies: Pirates!, the
   Akella class 1, Port Royale's ships of the line.
2. **A gate by place or world** (shipyard size, port industry, chapter shop, region) holds up better than a gate
   by player level.
3. **Soft penalties are bypassed.** A navigator officer lifts the Navigation gate in COAS and TEHO.
4. **Hard level gates breed grind** (Skull and Bones, Windward).
5. **Pirates! needs no gate** because a big ship is not simply better.

---

## 8. What Corsair's career should take

These recommendations fit `combat-model.md` sections 2-3, and the in-game times go with its section 8 career
probe. Corsair's hulls from `ships.json` (guns, price): sloop 8 / 3,000; war sloop 10 / 4,500; brigantine 14 / 5,500;
royal sloop 14 / 7,500; merchantman 16 / 9,000; **brig 18 / 6,500**; frigate 32 / 14,000; galleon 32 / 20,000;
treasure galleon 36 / 26,000; ship of the line 44 / 30,000. Every hull below the frigate carries fewer guns than
the starting brig, so the climb in hull size is one big step (brig to frigate), and the classes in between are
sideways choices (speed, draught, cargo), as in Pirates!.

### 8.1 Start

- **One fixed start: the brig, in 1660, with the nation chosen.** This matches the default era in both Pirates!.
  - The brig is already a rung above every comparator's start (sloop, lugger, pinnace, cutter), so the half-armed,
    half-manned state *is* the first rung. Keep it: "fill the battery and crew" is the compressed sloop-to-brig
    climb, and it gives the first hour a goal the player can finish.
  - Offer **no starting-ship choice at first**. If added later, use Pirates! 1987's model (the start comes from the
    era and nation, and each start is a trade-off), not a menu of hulls.
- **Difficulty pays like Pirates!.** Corsair pays wages, not shares, so the reward has to be something else: a
  bigger captain's cut of prize money and plunder, or better prices. Offer a step up after a
  good voyage (2004), so difficulty is itself a reward.

### 8.2 How better ships are got

- **Buy the brig's peers; capture the frigate or bigger first.**
  - Shipyards sell the sideways hulls everywhere: sloop, war sloop, brigantine, royal sloop, merchantman, fluyt,
    barque. The frigate is for sale only at the big yards of nations where she holds rank (see 8.3). The galleons
    and the ship of the line are never sold: capture only.
  - This blends Caribbean Tales (classes 2-1 capture-only), COAS (shipyard stock by rank) and Patrician (a yard
    builds what it can).
  - It keeps "a prize or purchase of a better hull" (combat-model rung 3 to 4) without the buy-best collapse.
- **Gate by place, not by the player's level.** What a yard sells depends on the port's size and nation and the
  player's standing there (Patrician, New Horizons, Windward, Sail Forth's patch). No hard command gate by level:
  an underdog prize must stay possible, as in Corsairs Legacy's "even a cutter can capture a Lineship".
- **Big ships pay their way** (the Pirates! lesson, and the reason its ladder stays sideways):
  - a minimum crew and wages
  - draught over shoals
  - a slower fleet
  - upkeep shown before buying (Peter Blood's frigate in COAS)
  - pirates and patrols that come for a rich ship
- **Keep the brig a real choice later.** A full-fit brig should beat an unfitted next class, as Corsairs Legacy
  states as a design rule.

### 8.3 Rank and titles

- **Per-nation privateer ranks from a Letter of Marque, as 2004.** Each rank grants one felt benefit at that
  nation's ports, plus one **access** benefit borrowed from Port Royale 2 and Patrician:

| Rank | Benefit in that nation | Access |
|---|---|---|
| Letter of Marque | Lawful prizes, bounties | Governor missions |
| Captain | Easier recruiting | Escort and hunting missions |
| Major | Cheaper repairs | Shipwright's best upgrades at that nation's yards |
| Colonel | More goods | Frigates for sale at that nation's big yards |
| Admiral | Cheaper upgrades | A second captain for a consort |
| Baron and up | Land (an estate that pays rent) | Governors' daughters; land counts in the retirement score |

- **Land grants that grow with the deed** (1987: "the more you accomplish at a rank, the more land you receive")
  give a trader's career weight in the score too.

### 8.4 Objectives and milestones

The Goals page in section 3 matches the genre. Add three things from the research:

1. **Long threads open from week one.** A relative or map piece in the first hour (Pirates!), a named villain,
   and the treasure fleet's season shown. Keep three or four threads open at once, untimed, with no cost for
   failure.
2. **Three tracks of fame** (Uncharted Waters): trade, war and adventure. Each objective adds to one, and the
   retirement score sums them, so a trader climbs too.
3. **Milestones that change the world, not only a number.** First prize gives volunteers; a letter of marque
   opens missions; the first famous kill brings the tavern's notice. Sid's rule: show what the last half hour was
   worth.

### 8.5 Pacing targets (in-game time)

The assumption: an in-game month is about 20-30 minutes of real play, so a year is about 5 hours. This needs
measuring by the career probe.

| Milestone | Target in-game time | Comparator |
|---|---|---|
| First prize or first pirate beaten | First week or two | 1987: day 6 [CA] |
| Full battery and crew (rung 2) | 1-3 months | 1987 first promotion at about 4 months |
| Letter of marque, first upgrades (rung 3) | 3-6 months | |
| First famous pirate beaten | 6-12 months | |
| A frigate (rung 4) | 1-2 years, by prize sooner | Unlike TEHO's 6-hour grind before the first ship |
| Fleet and Top Ten contention (rung 5) | 3-5 years | |
| Natural retirement | 5-10 years | "five to ten years of active endeavor" [M87]; one career ran 7.5 [CA] |

- **Ageing as the clock.** 2004's checks at 30, 35, 40 and 50 make one action harder each, and the six-month refit
  after dividing ages the captain.

### 8.6 The end

- Score on retirement from the three fames, rank, land, family and deeds, read as a job and a Hall of Fame
  entry (both Pirates!).
- Suggest a different style for the next captain.

---

## 9. Pitfalls

- **Grind before the fun.** TEHO's hours before the first ship; Skull and Bones' "glacial" ten hours to a medium
  ship. Corsair's first hour must give a prize and a full battery, not a shopping list.
- **Level gates.**
  - Skull and Bones' Infamy blueprints and Windward's zone walls make players wait instead of play.
  - TEHO's rank-15 quest locks punished free play, and the remake removed them.
  - Gate by place and standing, and keep the underdog capture possible.
- **Soft gates that a hire bypasses.** The COAS navigator officer turns a skill gate into a shopping item. If
  Corsair gates frigates by rank, the gate must not be buyable.
- **Buying the best ship and winning.**
  - Sail Forth had to patch out big ships sold at the first shop.
  - Black Flag's maxed Jackdaw matches the legendary ships, and then nothing remains.
  - The fix: buy only small and middle hulls; frigates come by capture or rank; big ships cost crew, upkeep and
    shallow-water access; top-tier opponents (famous pirates, treasure-fleet escorts) need the big ship.
- **Opponents scaled to the player.**
  - COAS's "enemies level up with you" spike at levels 30-40, and Caribbean Legend scales story fights to rank.
  - Scale by water and notoriety (combat-model section 2), never by her level.
- **The voyage reset that feels like a loss.** Both Pirates! keep only the flagship after dividing, and
  "repetitiveness set in after I divided the plunder for the first time". Corsair should never strip a ship the
  player owns; ageing and the crew's patience are enough clock.
- **One material as the bottleneck.** Black Flag's metal; Skull and Bones' crafting. Upgrades should cost gold
  from voyages that are fun anyway, plus at most one exploration item for the top tier (Black Flag's wreck and
  dig plans worked).
- **Progression that buys nothing.** Sea of Thieves: "gold is entirely pointless". Every gold milestone should buy
  something felt: a gun, a hull, a man, an estate.
- **Wealth-only ranks.** Port Royale 2's rank by assets turns titles into a bank balance. Tie ranks to deeds done
  for the nation (Pirates!), and use wealth only for land and the score.
- **A single dominant ship.** Pirates!' players all sail the fast sloop or brig; Skull and Bones has "four viable
  ships". Each hull family needs its own fight in which it is the best answer.
