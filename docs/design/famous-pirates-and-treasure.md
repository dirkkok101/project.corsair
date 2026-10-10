# Famous pirates and their treasure (design)

Proposed 2026-10-10. Fills PRD section 10 (treasure maps) and the "named pirate captains" of section 12, and
answers "where do map pieces come from?". Judged against the pillars: it gives combat a reason (hunting a named
foe), gives sailing a reason (reading a map, finding a coast), and feeds trade with gold. UI rule: one click to do
the obvious thing, and every number explained.

## What Sid Meier's Pirates! did (research)

- **Famous pirates (2004).** Nine named pirates plus the player on a Top Ten list, ranked by wealth. They sail
  captured warships with full, high-morale crews. Beating one takes his listed wealth, is worth a fame point, and
  "he immediately falls to the bottom of the list"; he comes back later. [04 manual p.77-78; Famous Pirate wiki]
- **Captured captains (1987/2004).** A beaten named pirate or pirate hunter can be asked about the Treasure Fleet or
  the Silver Train, or held for ransom. [`pirates-original-games.md` 2.1]
- **Buried treasure (2004).** Each famous pirate has a hoard. Its map comes in **4 pieces**, sold by the shady
  stranger in taverns, who offers pieces more often while a map goes unfinished. The hoard is only placed in the
  world when the first piece is bought, and always near where you are; with one piece you can already find it if
  you read the coast. Dig up a pirate's hoard before beating him and he becomes a pirate hunter, coming for you.
  [GameFAQs; Famous Pirate wiki; TrueAchievements guide]
- **The same maps** lead to lost cities (pieces from governors' daughters and from rescuing them) and lost
  relatives (pieces from beating the family's enemy in a duel).

Sources: [Famous Pirate](https://sidmeierspirates.fandom.com/wiki/Famous_Pirate) ·
[GameFAQs: treasure](https://gamefaqs.gamespot.com/boards/915017-sid-meiers-pirates/44355566) ·
[GameFAQs: hideouts](https://gamefaqs.gamespot.com/wii/995531-sid-meiers-pirates/answers/308809-where-can-i-find-treasure-hideouts) ·
[TrueAchievements guide](https://www.trueachievements.com/game/Sid-Meiers-Pirates/walkthrough/2)

## Our design

### 1. The famous pirates

- **Ten famous captains** of the 1660s buccaneer era, each a persistent captain the world simulates (not a
  throwaway traffic pirate): Henry Morgan, François l'Olonnais, Roche Braziliano, Bartolomeu Português, Edward
  Mansvelt, Laurens de Graaf, Michel de Grammont, Jan Willems, Pierre le Grand, John Coxon. (Real people of the
  period, so their names are history, not anyone's IP; no portraits or text from Pirates!.) A data list,
  `pirates.json`, holds each: name, home haven, temperament, favourite waters, flag colours.
- **Each has:** a strong ship (brigantine, war sloop, frigate; a captured warship for the top three), a full
  veteran crew with high morale, his **wealth** (grows with every prize and raid, shrinks when he pays off his
  crew), his **haunts** (two or three sea areas he hunts in), and a **hoard** he has buried (part of his wealth).
- **They act in the world** through the existing traffic AI: lie in wait on the lanes of their haunts, take
  merchants (and prizes, as pirates already do), go home to their haven to sell and bury. Their deeds are news:
  "Henry Morgan has taken the Spanish galleon San José off Cartagena".
- **The Top Ten.** A list (the captain's log and the tavern) of the ten richest pirates, the player among them by
  her plunder. Climbing it is fame.
- **Meeting one.** At sea his ship carries his name and flag; hailing names him and his wealth. He is a hard fight
  (veteran crew, strong ship) and usually wants to fight you.
- **Beating one** (struck, boarded or sunk): a share of his wealth comes to the plunder chest, +1 fame, news
  everywhere, and he drops to the bottom of the list. Boarded or struck, you take **his captain**: one click per
  choice, each explained:
  - **Ask him about his hoard**: he gives up a map piece of his hoard (the best way to get one).
  - **Hand him to a governor** for a bounty (gold, standing with that nation).
  - **Set him free**: his crew think the better of you (pirate havens friendlier).
- **He comes back** some months later in a new ship (as in Pirates!), poorer, and remembers you.
- **Revenge.** If you dig up his hoard before beating him, he hunts you: he becomes a pirate hunter, comes after you
  when you are in his waters, and says so in the news.

### 2. Map pieces: where they come from

Each hoard's map has **4 pieces**. Sources, from easiest to hardest:

| Source | How | Notes |
|---|---|---|
| The tavern stranger | A shady sailor in some taverns sells a piece of a famous pirate's map | Price by the hoard's worth. More likely while you hold an unfinished map, and in havens and ports near that pirate's haunts. |
| A beaten famous pirate | "Ask him about his hoard" | Always gives a piece of his own map. |
| His crew | Sinking him: a survivor picked up from the wreck may carry a piece | A small chance per group of men picked up. |
| News and rumour | Tavern news that he was seen burying near a place | Not a piece: a hint that names the island, so one piece is enough. |

- **Placing the hoard (as Pirates! does).** A hoard is placed only when its first piece is obtained, on a coast
  within that pirate's haunts, near a landmark (a lone palm, a rock, a wreck, a ruined hut). It is deterministic
  from the world seed and the pirate, so every piece agrees and a replay finds the same spot.
- **One piece is enough to try**: each piece shows a quarter of the parchment; the piece with the place name names
  the island. With more pieces the search area narrows.

### 3. The treasure map (journal)

- A new **Maps** page in the captain's log: each map as a parchment drawn from the real terrain around the site
  (a crop of the world map, coastline and hills), with the landmark drawn in and an X. Pieces you don't have are
  torn away. A line under each map: "2 of 4 pieces · Henry Morgan's hoard · about 6,000 gold".
- On the **sea chart**, a map with the name piece marks the island with a faint dashed ring (the search area,
  smaller with more pieces). One click on the map in the log plots a course there.

### 4. Digging

- No full shore expedition yet (that's PRD section 4's landfall). Instead: sail within 2 tiles of the coast near
  the site and press **D, "Go ashore and dig"** (shown as a prompt when you are near a mapped search area).
- A dig costs half a day. Within the tolerance (2 tiles, the same for everyone): the hoard (gold to the plunder chest,
  sometimes an item), news, fame. Missing it, a hint from the landmark: "the lone palm stands to the north-east",
  so a careful captain closes in.
- The landmark is drawn in 3D at the site (a lone palm, a rock), so a reader of the map can recognise the coast.

### 5. Later, the same system

- **Lost cities** (PRD 10): the same 4-piece maps, pieces from governors' daughters and missions; the dig becomes a
  march inland.
- **Family quest**: pieces from beating the villain's lieutenants in duels.

## Data

- `pirates.json`: the ten famous captains (name, haven, temperament, haunts, ship class, flag), the Top Ten
  rules (fame for a defeat, return delay in days, share of wealth taken, wealth a raid adds).
- `treasure.json`: pieces per map (4), hoard value as a share of wealth, the stranger's chance and price, the
  survivor's piece chance, dig tolerance, dig time, landmark kinds by terrain.
- New state: each famous pirate's wealth, haunts, ship, hoard (placed or not), revenge flag; the captain's map
  pieces; hoards found.

## Slices

1. **Famous pirates** (built): the ten captains in the world, their wealth, news of their deeds, the Top Ten (in
   the tavern, as there is no captain's log yet), beating one (wealth, fame, he returns later). Balance: a famous
   pirate beats a stock 10-gun brig most times (39 of 60 in the battle test; the war-sloop captains are the soft
   ones).
2. **Captured captains**: the three choices after taking one (hoard piece, bounty, set free).
3. **Maps**: pieces from the tavern stranger, beaten pirates and survivors; hoards placed on the first piece; the
   Maps page; the chart's search ring and course.
4. **Digging and landmarks**: going ashore near the site, the dig, hints when you miss, landmark models in 3D,
   revenge when you dig before beating him.

## Decisions (2026-10-10)

1. Real 1660s buccaneers, as above.
2. Map pieces are keepsakes: they can't be sold.
3. One dig tolerance for everyone (2 tiles) for now.
