# Game UI reference: how pirate and trading games present ports, sea, maps and news

Collected 2026-10-11 for Corsair. The question behind it: Corsair's menus feel "very dense, information overload, more like a spreadsheet than a game". This document looks at how comparable games present the same information. It ends with principles for Corsair and a "now → proposed" sketch of each Corsair screen.

Every claim cites a source inline. **(inference)** marks my own reading of the evidence. **(unverified)** marks something remembered about a game that no fetched source confirmed. Unverified items are collected in their own list (section 8) and are not used as evidence.

## Coverage note

The session's web-search budget ran out early, and several of the best UI sources refused automated fetches: interfaceingame.com (404 or blocked), gameuidatabase.com (403), the fandom wikis' HTML pages (402), GameFAQs, MobyGames, IGN, GameSpot, Eurogamer, RPS, PC Gamer and Reddit. What remains is drawn from:

- the 2004 Pirates! manual;
- the Pirates! fandom wiki, read through its API;
- Wikipedia, Steam reviews and discussions, developer blogs (Anno Union, Failbetter, inkle), Let's Play archives;
- the Sunless Sea and Sea of Thieves wikis (Miraheze, wiki.gg);
- a handful of reviews.

**Thin or missing:**

- Windward, Sail Forth and Highwater-style indies (store and Wikipedia facts only, nothing on their UI).
- Uncharted Waters (a few facts from Japanese Wikipedia).
- The exact trade-screen layouts of Port Royale, Patrician and the 2004 Pirates! merchant: no fetched source describes their columns or price hints.
- Black Flag's harbourmaster and tavern screens.
- Akella's trade tables and rumours.
- Naval Action's port screens, screen by screen.
- Mount & Blade's town menus.

A second pass with a search budget should start with these.

---

## 1. Town and port menus

### Sid Meier's Pirates! (1987 / Gold 1993)

- **The town is one short text menu** (C64), with an illustrated town picture above it: "Visit the governor", "Visit the tavern", "Trade with a merchant", "Divide the plunder", "Plan another expedition / retire / advance to level", "Check information", "Leave town" ([C64-Wiki](https://www.c64-wiki.com/wiki/Pirates!)).
- Jimmy Maher: when the game is not in an action sequence it is "entirely menu-driven", with "appropriately piratey choices" ([Filfre](https://www.filfre.net/2015/07/pirates/)).
- **The 1987 trade screen is one list driven by a joystick**: a rapier cursor moves through the goods, pushing right sells, pushing left buys, fire exits ([C64-Wiki](https://www.c64-wiki.com/wiki/Pirates!)). **(inference)** Buying and selling are single gestures on one list, with no order form and no quantity dialog.
- Earlier Corsair research found that Sid replaced the parser-style towns of his first concept with short menus, and that every scene was kept short so the player never loses track of the career ([pirates-sid-meier-design.md](pirates-sid-meier-design.md)).

### Sid Meier's Pirates! (2004)

**The city menu**

- The 2004 manual calls the town screen "The City Menu": "a variety of places you can visit… Use your mouse (or keyboard) to navigate this menu and carry on conversations with people in town" ([2004 manual, p.46](https://cdn.cloudflare.steamstatic.com/steam/apps/3920/manuals/manual.pdf)).
- The places are:
  - Governor's Mansion
  - Tavern
  - Merchant
  - Shipwright
  - Divide the Plunder
  - Check Status ("you can access all information screens from here")
  - Sail Away

**The merchant**

- The manual gives the merchant one sentence: "Visit here to buy and sell goods and cannon. Use your mouse to make selections, buy and sell cargo" (manual p.48).
- There are six cargo types in all ([pirates-original-games.md](pirates-original-games.md), citing the wiki).
- One Let's Play notes a merchant with "ninety nine tons of sugar but not a single gun" ([LP Archive, update 1](https://lparchive.org/Sid-Meiers-Pirates/Update%201/)). **(inference)** The merchant's stock per good is visible.
- Nothing fetched describes the columns.

**Dialogue: "Talk is Cheap in the Caribbean"**

- A person "will greet you with a short statement". If it needs no response it ends with an "Exit" button. If it does, "your possible replies are listed below the statement. Just click whichever reply you want" (manual p.47).
- That is one statement and a few buttons per screen.

**The tavern is a room of people, not a list**

- "Your pirate appears in the center of the room, surrounded by a number of different characters. Each person may have something to tell (or sell) you. Click on the person you wish to speak with" (manual p.49).
- Who is there:
  - **Bartender:** upgrades, movements of notable people, daughters.
  - **Barmaid:** pirates and villains, "fat prizes sailing nearby".
  - **Mysterious Traveler:** news of other cities, map fragments, special items, "for the right price".
  - **Crewmen** by the fireplace.

  (manual p.49; [wiki: Tavern](https://sidmeierspirates.fandom.com/api.php?action=parse&page=Tavern&format=json&prop=wikitext&formatversion=2))
- The wiki adds detail:
  - The crowd of would-be crewmen "on the left, by the fireplace" grows with the town's economy and your rank.
  - The Traveler "in the back of the bar" tells you for free the prices, population, prosperity and military of cities he has visited.
  - The barmaid, when a rich ship is near, brings "up a map with the route and current location".
  - When nobody has news, the barmaid comments on your rank or "simply say[s] that there's nothing going on" ([wiki: Tavern](https://sidmeierspirates.fandom.com/api.php?action=parse&page=Tavern&format=json&prop=wikitext&formatversion=2)).

**The governor**

- "Upon arrival at the mansion the governor will always give a summary of what happened since player last visited a port, by appreciat[ing] the support and reprimand[ing] the transgression" ([wiki: Governor](https://sidmeierspirates.fandom.com/api.php?action=parse&page=Governor&format=json&prop=wikitext&formatversion=2)).
- He also tells you his nation's current wars and alliances (same).
- His reactions are animated moods: "delight, rage, delusion, and anger" ([LP Archive, update 4](https://lparchive.org/Sid-Meiers-Pirates/Update%204/)).

**Reception**

- Edge found "talking to a governor" "flat and awkward" ([Metacritic](https://www.metacritic.com/game/sid-meiers-pirates/)).
- AceGamez: "The controls are so easy to grasp that you'll rarely find any need to look in the manual" (same).

### Port Royale 2–4 and Patrician III/IV (Gaming Minds / Ascaron)

- **Patrician III: you enter services by clicking buildings in the town view** ("visiting (clicking) the right building: city hall, tavern, ship yard, etc.").
  - Users call it "user friendly, with a few clickable icons" and "very friendly to beginning players even though looking intimidating at first".
  - Users praise "a map view that makes it easy to quickly view the town's goods and prices" ([GOG: Patrician III](https://www.gog.com/en/game/patrician_3)).
- **Port Royale 4 is the warning case.** TheGamer (2/5):
  - "Navigating through all the menus to look at colony statistics, set up trade routes, and manage workers and businesses was sluggish and cumbersome."
  - "I have to click on all the towns to see who has the best prices."
  - "There's so much information to retain that you need a spreadsheet and a calculator."
  - "Great for those who love crunching numbers, but probably won't be much for those who want to play a video game."

  ([TheGamer](https://www.thegamer.com/port-royale-4-review/))
- Port Royale 4 Steam users say:
  - "Sooooo many informational tabs repeating themselves."
  - "Having to zoom into the cities instead of just clicking on them was a pain."
  - "25 commodities and you actually have to fiddle with hundreds of settings."

  ([Steam reviews](https://store.steampowered.com/appreviews/1024650?json=1&filter=all&language=english&num_per_page=100&purchase_type=all&day_range=9999))
- **Port Royale 3** users: "If you like playing spreadsheets with a GUI, then this game is for you" ([Steam reviews](https://store.steampowered.com/appreviews/205610?json=1&filter=all&language=english&num_per_page=100&purchase_type=all&day_range=9999)).
- **Port Royale 2**, by contrast: GameSpot called its "brilliantly realized design… more than just number crunching" ([Wikipedia](https://en.wikipedia.org/wiki/Port_Royale_2)). A GOG user found the interface "a bit clunky and fiddly, but not enough to put you off" ([GOG](https://www.gog.com/en/game/port_royale_2)).
- **Patrician IV** got praise for its "drag-and-drop-interface" (PC Games) and criticism as a "very dry affair" (CGMagazine) ([Metacritic](https://www.metacritic.com/game/patrician-iv/critic-reviews/); [Wikipedia](https://en.wikipedia.org/wiki/Patrician_IV)).

### Uncharted Waters: New Horizons (Koei)

- You walk a character between buildings: market, shipyard, tavern, guild, palace.
  - Negotiation skill lowers prices.
  - Tavern girls give rumours about events and rivals.
  - Discoveries are reported for rewards and fame.

  ([ja.wikipedia: 大航海時代II](https://ja.wikipedia.org/wiki/大航海時代II), read through a summariser, so moderately reliable)
- GamePro called it "an acquired taste due to the bare bones presentation and frequent money-managing" ([Wikipedia](https://en.wikipedia.org/wiki/Uncharted_Waters:_New_Horizons)).
- A later mobile entry dropped "unnecessary character movement within ports" ([Wikipedia](https://en.wikipedia.org/wiki/Uncharted_Waters)).

### Sunless Sea (Failbetter)

- A port's services sit in one book, the **Gazetteer**, with six tabs: Story (the port's storylets), Hold, Journal, Officers, Shops, and Shipyard (London only) ([Sunless Sea wiki: Gazetteer](https://sunlesssea.miraheze.org/wiki/Gazetteer)).
- Story choices appear "in card-like format" ([Wikipedia](https://en.wikipedia.org/wiki/Sunless_Sea)).
- Emily Short describes storylets as content plus prerequisites plus effects, dealt like a deck of cards, and points to Reigns' card interface as the presentation model ([Emily Short](https://emshort.blog/2019/11/29/storylets-you-want-them/)).
- Failbetter's interface patch:
  - UI and font size scale independently (players had been lowering the screen resolution to read).
  - Log messages became clickable.
  - Price displays in shops were improved.

  ([Failbetter](https://www.failbettergames.com/news/interface-update-coming-to-sunless-sea))

### Mount & Blade

- Warband travel is point-and-click on an overworld map ([Wikipedia](https://en.wikipedia.org/wiki/Mount_%26_Blade:_Warband)).
- (unverified) Its towns are text menus over a background picture; see section 8.
- Trade advice is covered in section 2.

### Akella: Sea Dogs / Pirates of the Caribbean (2003) / Age of Pirates

- You enter ports and explore towns on foot in 3D ([Wikipedia: Age of Pirates](https://en.wikipedia.org/wiki/Age_of_Pirates:_Caribbean_Tales)).
- The community's New Horizons tutorial has a guide NPC walk you to the Stall Trader, Store, Tavern and Shipyard ([Pirates Ahoy](https://www.piratesahoy.net/wiki/new-horizons-tutorial/)).
- City of Abandoned Ships reviewers:
  - "a clunky interface, poorly laid out and unintuitive quest objectives";
  - "minimal guidance";
  - the logbook "helps… only barely enough".

  ([Steam reviews](https://steamcommunity.com/app/937940/reviews/?browsefilter=toprated))

### Naval Action, Skull and Bones, Corsairs Legacy, Black Flag, Sea of Thieves

- **Naval Action ports**:
  - "in-port UI is both clunky and ugly (the at-sea and combat UIs are mostly fine)… no tutorial or tooltips" ([Gamers With Jobs](https://www.gamerswithjobs.com/node/1299475)).
  - A later patch rebuilt the port UI ("Everything has changed… it will feel weird") ([Steam](https://steamcommunity.com/app/311310/discussions/15/1736595227839122955/)).
- **Skull and Bones**: "half of the game is just an inventory management simulator"; "no way to lock items… you individually select each and every item" ([Steam reviews](https://steamcommunity.com/app/2853730/reviews/?browsefilter=toprated)).
- **Corsairs Legacy**: players complain of "Very weak trading forms" and ask for "icons\images in all possible systems" instead of words ([Steam reviews](https://steamcommunity.com/app/1594880/reviews/?browsefilter=toprated)).
- **Black Flag** puts post-boarding choices in one four-option menu: repair the Jackdaw, lower wanted level, add to fleet, or take the lockbox ([blackflag.wiki](https://blackflag.wiki/guides/kenways-fleet-explained/)).
- **Sea of Thieves** has no shop menus beyond company representatives. Supplies are picked up from barrels and quests from boards on the dock ([wiki.gg: Outpost](https://seaofthieves.wiki.gg/wiki/Outpost)).

**Takeaways on town menus (inference)**

- Each town service is one small screen, reached from a hub.
- The best-loved versions make the hub a place (Pirates! 2004's tavern room, Patrician's clickable buildings).
- The most-criticised versions make it a stack of tabs that repeat information (Port Royale 4, Naval Action ports).
- Conversation is one statement and a few replies.
- The governor's job on entry is to tell you what changed.

---

## 2. Trading screens and price advice

**No source gives a column-by-column layout for Pirates! 2004, Port Royale or Patrician.** What is sourced:

- **Pirates! 1987:** one list, buy and sell on the stick ([C64-Wiki](https://www.c64-wiki.com/wiki/Pirates!)). "Profit margins of up to the fourth of the purchase price are quite common" (same).
- **Pirates! 2004, prices from afar:**
  - Prices at other towns come from people, not tables: the Mysterious Traveler gives a city's goods prices, population, prosperity and garrison ([wiki: Tavern](https://sidmeierspirates.fandom.com/api.php?action=parse&page=Tavern&format=json&prop=wikitext&formatversion=2)).
  - Clicking a city name on the world map shows "what you know about the cities" (manual p.25).
- **Mount & Blade: Bannerlord colours the price on hover.**
  - Green means cheap here (buy); red or yellow means dear here (sell). With trade perks, green on the sell side means profit over what you paid ([Steam discussion](https://steamcommunity.com/app/261550/discussions/0/6458775074336141183/)).
  - The feature confuses players ("sell red or green?") and draws requests to show the colours without hovering ([Steam discussion](https://steamcommunity.com/app/261550/discussions/0/3380536561721344005/)).
  - Colour-blind players say: "Is it green? Light green? Dark green or red? I often have no clue" ([Steam discussion](https://steamcommunity.com/app/261550/discussions/0/2799504352982212738/)).
- **Mount & Blade: Warband gives no hints.** Players "walk around and stop into every marketplace" and "take note" ([Steam discussion](https://steamcommunity.com/app/48700/discussions/0/2119355556486639900/)).
- **Port Royale 4**: "I have to click on all the towns to see who has the best prices" ([TheGamer](https://www.thegamer.com/port-royale-4-review/)).
- **Patrician III**'s map view "makes it easy to quickly view the town's goods and prices" ([GOG](https://www.gog.com/en/game/patrician_3)).
- **Sunless Sea**'s Port Report turns exploration into money. You collect a report by visiting a port and deliver it to London. Shepherd Isles pays "+10 Echo as hearsay OR +50 Echo and +1 Admiralty's Favour as fact" ([Sunless Sea wiki: Port Report](https://sunlesssea.miraheze.org/wiki/Port_Report)).
- **Slay the Spire's design lesson on numbers vs icons:** enemy intents were first icons only. Showing the numbers "was more engaging, did not require the player to memorize what each symbol meant" ([Wikipedia](https://en.wikipedia.org/wiki/Slay_the_Spire)).

**Takeaways on trading (inference)**

- The complaint players make is not "too many numbers on one row". It is that they had to work out the decision themselves: click every town, memorise prices, compare in their heads.
- Colour alone fails (Bannerlord). Icons alone fail (Slay the Spire's first version). A word and one number together work.
- Advice must be visible without hovering.
- Advice works best when tied to something the player already cares about: what they paid, and where it sells.

---

## 3. The sea interface (HUD)

### Sid Meier's Pirates! (2004): one corner

**What is on the screen**

The manual lists these elements:

- Your ship, other ships with nation stripe and flag.
- Cities with name, nationality and fort size.
- Wind clouds and storm clouds.
- Landmarks.
- Fame counter, gold, food, crew size.
- A morale indicator with five named states: Very Happy, Happy, Content, Unhappy, Mutinous.
- Wind speed and wind direction.
- **Quest icons**, which "provide links to any current quests, missions, and treasure maps you have".

(manual pp.17-19)

**Layout**

- The HUD sits bottom-right on the compass. The gold arrow points north and the red arrow points where the wind blows. The date is below the compass and fame above it.
- Food shows as a bread icon with months left. Crew happiness is a face.
- Other ships carry name labels; yours is the only unnamed one ([LP Archive, update 2](https://lparchive.org/Sid-Meiers-Pirates/Update%202/)).
- A side-quest indicator sits top-left ([Present Perfect Gaming](https://presentperfectgaming.com/pirates/)).

**Information screens**

These live behind one key ("status", number pad 1), not on the HUD ([LP Archive, update 2](https://lparchive.org/Sid-Meiers-Pirates/Update%202/)). They are separate single-purpose pages:

- Fleet Status
- Captain's Log
- Status (accomplishments)
- Quest Log
- Treasure Maps
- World Map
- Top Ten Pirates

(manual pp.23-25)

### Assassin's Creed IV: Black Flag and Black Flag Resynced

- The original minimap carries a wind arrow that turns green, yellow or red ("red when facing into it") ([Steam discussion](https://steamcommunity.com/app/242050/discussions/0/2592234299544255935/)).
- The Resynced remaster removed the minimap ("There is no minimap. Period."). Its replacements:
  - a compass with markers;
  - visible wind gusts;
  - crew voice lines about the wind;
  - detection meters over forts;
  - buoys marking detection zones.
- Players split. Supporters said it was meant "to declutter the HUD and make it all a bit more immersive". Others asked for a toggle, and one refunded ([Steam discussion](https://steamcommunity.com/app/3751950/discussions/0/570417328562424687/)).
- The spyglass shows "distant ships, along with their cargo and strength" ([Wikipedia](https://en.wikipedia.org/wiki/Assassin%27s_Creed_IV:_Black_Flag)).

### Sea of Thieves: information in the world

- No minimap. A "Toggle HUD" keybind exists, and players ask for finer control ([forum](https://www.seaofthieves.com/community/forums/topic/143464/minimal-ui-option)).
- Ships have no health bar. Hull damage shows as water filling the lower deck, and leaks are audible. Masts, wheel spokes and the capstan break visibly ([wiki.gg: Ship](https://seaofthieves.wiki.gg/wiki/Ship)).
- Wind shows only as "gentle, wavy, semi-transparent white lines" and flags flapping ([wiki.gg: Wind](https://seaofthieves.wiki.gg/wiki/Wind)).
- The compass is held up in the hand or fixed at the helm, and spins in storms ([wiki.gg: Compass](https://seaofthieves.wiki.gg/wiki/Compass)).
- A preview quotes Rare's Mike Chapman: "We didn't want to make a game where you played the UI. We wanted to make a game where you were immersed in the world" ([Independent.ie](https://independent.ie/entertainment/games/previews/sea-of-thieves-preview-shipshape-and-raring-to-go-36626039.html)). This was seen only as a search snippet; check the wording before quoting it.
- I found no GDC talk on Sea of Thieves' UI ([GDC Vault search](https://gdcvault.com/browse?keyword=sea+of+thieves)).

### Skull and Bones: the counter-example

- The 2022 reveal HUD was mocked for clutter: "Icons and written instructions coat every corner of the screen", with "thick black bars dense with information" at the top.
- A fan said it "looks like the Elden Ring meme UI where people kept adding to it until it became unintelligible" ([Dexerto](https://www.dexerto.com/elden-ring/skull-bones-elden-ring-ui-meme-1866405/); [Screen Rant](https://screenrant.com/skull-bones-cluttered-ui-elden-ring-ubisoft-meme/)).

### Sunless Sea: bars with names and direction

- **Terror** is a bar with a skull icon over six named bands: Serene, Wary, Nervous, Fearful, Haunted, Crazed. Orange or red dots show it rising and green dots show it falling ([Sunless Sea wiki: Terror](https://sunlesssea.miraheze.org/wiki/Terror)).
- The console edition chose "clarity over subtlety":
  - The Log Book was cut to two visible messages because it covered the scenery; holding a button expands it.
  - Notifications moved to a separate panel with an unread counter.
  - Tooltips were moved off the art.
  - Equipment tooltips were admitted to be too large.

  ([Failbetter](https://www.failbettergames.com/news/diving-into-the-ui-and-control-scheme-of-sunless-sea-zubmariner-edition))

### Anno 1800: dark HUD, bright alerts

- The June 2018 UI devblog:
  - "Form follows the function".
  - "A clean design, including only a minimal amount of ornamentation".
  - The always-visible HUD uses "darker colors" against eye fatigue, while pop-ups use a "brighter color" to "draw immediate attention".

  ([Anno Union devblog](https://www.anno-union.com/devblog-user-interface-2/))
- Steam users still complain about notifications obsessively announcing "your ship is under attack" ([Steam reviews](https://store.steampowered.com/appreviews/916440?json=1&filter=all&language=english&num_per_page=100&purchase_type=all&day_range=9999)).

### General design writing

- Game UI falls into four kinds: diegetic, non-diegetic, spatial and meta ([Game Developer](https://www.gamedeveloper.com/design/game-ui-discoveries-what-players-want)).
- The same article finds that players rank function above immersion, that a fully diegetic UI rarely fully works, and that mixed approaches do.

**Takeaways on the sea HUD (inference)**

- The beloved HUD is the 2004 one: one corner, about eight readouts, each an icon and one number or one face.
- Everything else sits one key away on its own page.
- Going fully diegetic costs players information unless something replaces it (Resynced). Corsair's realistic 3D sea can carry the wind (sails, flags, whitecaps), but the compass should stay.
- The HUD should be quiet, and alerts loud and rare.

---

## 4. Maps: the sea chart and treasure maps

**The Pirates! 2004 world map**

- The world map shows your position. It zooms with the mouse wheel and scrolls at the screen edge.
- Clicking a city name shows "what you know about the cities". Knowledge is bought from travellers or gained by visiting (manual p.25).
- (unverified) The parchment look and any fog of war; see section 8.

**Pirates! treasure maps are pieces that assemble themselves**

- "Once you acquire a map piece, it is stored in the Treasure Map information screen. If you acquire additional pieces of that map, they are automatically put together on one page in the correct position. If you have more than one map, each map appears on a separate page. Once you have found a treasure, the associated map is removed" (manual p.51).
- The clues come in layers. Towns and named landmarks ("Dagger Falls, Skull Shallows, Prisoners' Rock") can be seen from the sea. Arched rocks, totems and dead trees appear only ashore (manual pp.51-52).
- The 1987 maps have "sections torn away or hidden, so you have to carefully study the available features and determine where the X is most likely to be" ([CRPG Addict](https://crpgaddict.blogspot.com/2011/01/game-40-pirates.html)).

**Sea of Thieves: maps are objects**

- Treasure maps are held in hand, with red X marks found by landmarks and compass. A dull thud tells you you are digging in the right spot ([wiki.gg: Treasure Map](https://seaofthieves.wiki.gg/wiki/Treasure_Map)).
- Riddle maps reveal one line at a time. Some lines need an action at a landmark, such as raising a lantern or playing a shanty ([wiki.gg: Riddle Map](https://seaofthieves.wiki.gg/wiki/Riddle_Map)).
- The ship's map table is shared, uses an alphanumeric grid and takes up to 10 circles. It marks your ship and its path automatically ([wiki.gg: Map Table](https://seaofthieves.wiki.gg/wiki/Map_Table)).

**Black Flag treasure maps have two layers**

- Coordinates in the corner are matched against the world-map cursor. A hand-drawn sketch of landmarks then pinpoints the dig site ([katkat guide](https://katkat.com/blog/how-to-find-buried-treasure-ac-black-flag-resynced)).

**Sunless Sea: the reveal is the reward**

- The map is revealed as you sail. Failbetter found "the exploration of the unknown was much more enticing than the return journey". Re-crossing charted water got tedious after 20+ hours, so the sequel added more home ports ([Failbetter](https://www.failbettergames.com/news/sunless-skies-pre-production-talkin-bout-proc-generation)).

**Corsairs Legacy and Dredge: what players complain about**

- Corsairs Legacy: "world map is terrible for information"; "maps are so abstract" ([Steam reviews](https://steamcommunity.com/app/1594880/reviews/?browsefilter=toprated)).
- Dredge reviewers wished the map were "incorporated as part of the HUD" and "easier to use" ([Wikipedia](https://en.wikipedia.org/wiki/Dredge_(video_game))). Players say its markers "swallow a good chunk of the map" ([Steam discussion](https://steamcommunity.com/app/1562430/discussions/0/6620894968771088616/)).

**Naval Action: navigation is the skill**

- There is no GPS: "You can't see your location on the map" ([Steam reviews](https://steamcommunity.com/app/311310/reviews/?browsefilter=toprated)). This suits a hardcore sim, not Corsair's audience **(inference)**.

**Takeaways on maps (inference)**

- A treasure map should feel like a found object: a torn piece that snaps into place.
- Each new piece is a small event, and the map is a puzzle you read against the coast, not a pin on a GPS.
- The chart is where price knowledge lives (Patrician's map view, Pirates!' city click), so players never have to tour ports to compare.

---

## 5. News, rumours and the log

**Pirates! 2004: news comes from people and lands in one dated log**

- The tavern people bring the news (section 1).
- The barmaid's news can open a map showing a prize's route and current position ([wiki: Tavern](https://sidmeierspirates.fandom.com/api.php?action=parse&page=Tavern&format=json&prop=wikitext&formatversion=2)). Information arrives as a moment on the map, not as a line of text.
- The governor opens every visit with what happened since your last one ([wiki: Governor](https://sidmeierspirates.fandom.com/api.php?action=parse&page=Governor&format=json&prop=wikitext&formatversion=2)).
- The Captain's Log "stores a running list of your actions and accomplishments as well as other events happening in the world, including which nations are currently at war" (manual p.24).
- Its entries are dated one-liners that mix your deeds with world news:
  - "September 1600: Captured a Spanish treasure ship near San Juan"
  - "France and Spain cancel Peace Treaty"
  - "Baron Raymondo seen in St. Augustine"

  ([LP Archive, update 3](https://lparchive.org/Sid-Meiers-Pirates/Update%203/))

**Pirates! 1987**

- Taverns give "news of faraway events, such as new gold mines, plagues, and Indian attacks" ([CRPG Addict](https://crpgaddict.blogspot.com/2011/01/game-40-pirates.html)).

**Anno 1800: the newspaper is news as an event with consequences**

- An issue of the "Anno Chronicles" arrives "roughly every 30 minutes", with special editions for wars and the New World. There are "over 250 possible articles".
- Headlines act as timed buffs or debuffs on happiness, consumption, riot chance and taxes. Citizens "can get used to" ongoing problems.
- Back issues are archived so you can reread your empire's history.
- You can spend influence on propaganda to change bad headlines, but engineers are "more likely to look through your lies than the more humble farmers".
- Ubisoft states the purpose: help new players understand what is happening, and give veterans a showcase.

([Anno Union: Breaking News](https://www.anno-union.com/breaking-news/))

**Sea of Thieves**

- Tall Tales start from a book held in hand, with pages turned to read ([wiki.gg: Tall Tales](https://seaofthieves.wiki.gg/wiki/Tall_Tales)).
- Toast messages have a configurable duration and can be switched off ([wiki.gg: Settings](https://seaofthieves.wiki.gg/wiki/Settings)).

**Sunless Sea**

- The Log Book is cut to two lines on screen. Notifications have their own panel with an unread counter ([Failbetter](https://www.failbettergames.com/news/diving-into-the-ui-and-control-scheme-of-sunless-sea-zubmariner-edition)).
- Port Reports turn rumour into cargo you deliver ([Port Report](https://sunlesssea.miraheze.org/wiki/Port_Report)).

**Crusader Kings III: ranked attention**

- The most important pending tasks show as diamond icons along the top. Less important ones are grouped under a cloverleaf icon ([CK3 wiki](https://ck3.paradoxwikis.com/Beginner%27s_guide)).

**Anno 1800: alert fatigue is real**

- Players describe "endlessly jumping between cities, expeditions, quests, trade routes, notifications" ([Steam reviews](https://store.steampowered.com/appreviews/916440?json=1&filter=all&language=english&num_per_page=100&purchase_type=all&day_range=9999)).

**Takeaways on news (inference)**

- News should arrive through a person (barmaid, governor, a passing captain) or a physical thing (a newspaper, a letter).
- It should come as one short statement, and when it is about a place, it should open the chart there.
- After that it becomes one dated line in a single log.
- Only a few kinds of event deserve to interrupt.

---

## 6. What players and reviewers praised and criticised

| Game | Praised | Criticised |
|---|---|---|
| Pirates! 2004 | Easy to learn without the manual; variety; charm (Metacritic 88) ([Metacritic](https://www.metacritic.com/game/sid-meiers-pirates/)) | Governor talks and land marches "flat and awkward" (Edge, same); repetition over time (IGN, via [Wikipedia](https://en.wikipedia.org/wiki/Sid_Meier%27s_Pirates!_(2004_video_game))) |
| Port Royale 4 | (none on UI found) | Menu-diving, clicking every town for prices, "need a spreadsheet and a calculator" ([TheGamer](https://www.thegamer.com/port-royale-4-review/)); repeated tabs ([Steam](https://store.steampowered.com/appreviews/1024650?json=1&filter=all&language=english&num_per_page=100&purchase_type=all&day_range=9999)) |
| Port Royale 3 | (none on UI found) | "Playing spreadsheets with a GUI" ([Steam](https://store.steampowered.com/appreviews/205610?json=1&filter=all&language=english&num_per_page=100&purchase_type=all&day_range=9999)) |
| Patrician III / IV | Few clickable icons; prices on the map view ([GOG](https://www.gog.com/en/game/patrician_3)); drag-and-drop (PC Games) | "Very dry affair" ([Wikipedia](https://en.wikipedia.org/wiki/Patrician_IV)) |
| Anno 1800 | "Complexity is unlocked step by step and never feels overwhelming"; "Streamlining done right" | "The Prettiest Spreadsheet" (GameSpot headline, via [Wikipedia](https://en.wikipedia.org/wiki/Anno_1800)); notification spam ([Steam](https://store.steampowered.com/appreviews/916440?json=1&filter=all&language=english&num_per_page=100&purchase_type=all&day_range=9999)) |
| Sea of Thieves | Immersion; physical maps; flooding as health ([wiki.gg](https://seaofthieves.wiki.gg/wiki/Ship)) | Players still ask for finer HUD options ([forum](https://www.seaofthieves.com/community/forums/topic/143464/minimal-ui-option)) |
| Black Flag Resynced | Decluttered HUD | Missing minimap without a toggle ([Steam](https://steamcommunity.com/app/3751950/discussions/0/570417328562424687/)) |
| Skull and Bones | (none found) | Cluttered HUD; inventory management ([Dexerto](https://www.dexerto.com/elden-ring/skull-bones-elden-ring-ui-meme-1866405/); [Steam](https://steamcommunity.com/app/2853730/reviews/?browsefilter=toprated)) |
| Akella / Age of Pirates 2 | Freedom | "Clunky interface, poorly laid out" ([Steam](https://steamcommunity.com/app/937940/reviews/?browsefilter=toprated)) |
| Naval Action | Sea and combat UI "mostly fine" | Port UI "clunky and ugly… no tutorial or tooltips" ([Gamers With Jobs](https://www.gamerswithjobs.com/node/1299475)) |
| Corsairs Legacy | (none on UI found) | Abstract map; weak trading forms; wants icons over words ([Steam](https://steamcommunity.com/app/1594880/reviews/?browsefilter=toprated)) |
| Bannerlord | Price colours exist | Hover-only, colour-only, confusing, colour-blind unfriendly ([Steam](https://steamcommunity.com/app/261550/discussions/0/2799504352982212738/)) |
| Sunless Sea | Writing; cards; reveal of the map | Text too small, tooltips too big, log covering the scenery (fixed in patches) ([Failbetter](https://www.failbettergames.com/news/diving-into-the-ui-and-control-scheme-of-sunless-sea-zubmariner-edition)) |
| Uncharted Waters NH | Depth | "Bare bones presentation and frequent money-managing" ([Wikipedia](https://en.wikipedia.org/wiki/Uncharted_Waters:_New_Horizons)) |

**(inference)** The pattern is consistent. Games are called spreadsheets when the player has to read several screens and compute the answer. They are called charming when a person or a picture states the answer and the player only decides.

---

## 7. Principles for Corsair

These fit the project's "UI must be easy" rule (agent memory): one-click defaults, consequences shown, numbers explained. They also fit Sid's rule that the career on the map is the centre of gravity and every scene stays short ([pirates-sid-meier-design.md](pirates-sid-meier-design.md)).

The evidence does **not** say "remove the numbers". Players rank function above immersion (Game Developer). Removing the minimap without replacing it split Black Flag's players. Slay the Spire found that numbers beat icons-only. Bannerlord's hover-only colours failed. So the rule is **a verdict and one number up front, detail on demand**.

1. **One decision per screen.** A screen answers one question ("what do I buy here?", "which ship?", "what's new?"). Pirates! 2004's dialogue rule is the model: one statement, then a few replies or "Exit" (manual p.47).
2. **The place is the menu.** Enter services by clicking a few hotspots on a painted scene (Pirates! 2004's tavern room, Patrician's buildings), not a row of tabs. Keep the hotspots to five or six. Port Royale 4's repeated tabs are the anti-model.
3. **A verdict word and one number, not a row of figures.** For each good show an icon, a word ("cheap here", "sells well", "fair") and the one number that matters for that word. Never rely on colour alone, and never on hover alone (Bannerlord).
4. **Say where, not just what.** The best price advice is "sells well at Tortuga, +14 each", the answer Port Royale 4's reviewer had to click every town to find. Corsair already computes "best sale you know"; present it as a sentence on the good, not a column.
5. **Progressive disclosure.** The first view is the verdict. A click on the good (not hover) opens the reasons: stock against usual, the news behind a shock, what you paid. Anno 1800 was praised because "complexity is unlocked step by step".
6. **People deliver information.** Rumours, prices from afar and warnings come from the barmaid, the traveller or a hailed captain, one sentence each. The governor opens with "since you were last here…". This is Pirates! 2004's whole tavern and governor design.
7. **News is an event, then a line.** Big news arrives once as a card or letter (with a map moment when it concerns a place). It is then a dated one-liner in a single Captain's Log that mixes your deeds with world events (Pirates! 2004). Like Anno 1800's newspaper, news should matter to prices and politics.
8. **A quiet HUD in one corner, loud and rare alerts.** Keep the 2004 inventory: compass with wind, date, gold, crew, food in days, morale as a face or word, fame, and quest links. Use dark, low-contrast tones at rest and bright tones for alerts (Anno devblog). Let the 3D sea carry what it can (sails, flags, smoke, whitecaps), but keep the compass (Resynced).
9. **Bands with names instead of bare meters.** Morale, food, hull and standing read as a named band plus direction ("Content, falling"), like Sunless Sea's terror and Pirates!' five morale states.
10. **The chart is a diegetic object and the trade advisor.** It is a parchment chart you open. Clicking a port shows what you know: the verdict prices with their age, and news. Treasure maps are torn parchment pieces that snap into place on their own page (Pirates! 2004 p.51).
11. **Reveal moments are the reward.** A new map piece, a first visit, a promotion or a famous capture gets a short full-screen moment, then gets out of the way. Toasts are short and rare, with settings to shorten or mute them (Sea of Thieves).
12. **Separate reference pages, one key away.** Fleet, career, Top Ten, maps and log are single-purpose pages behind one key, as in the 2004 status screens, not crammed into the HUD or the port.

### Anti-patterns to avoid

- **Tables with five or more columns** as a game's main screen (Port Royale 3/4, Corsairs Legacy's "trading forms").
- **Making the player compute the answer**: comparing ports in their head or touring ports to learn prices (Port Royale 4, Warband).
- **Colour-only or hover-only advice** (Bannerlord).
- **Tabs that repeat the same information** (Port Royale 4).
- **Clutter that grows a feature at a time until it is unintelligible** (Skull and Bones).
- **A permanent key legend on the HUD.** Corsair's `hud.tsx` renders a full key line ("A/D or ←/→ steer · W/S… · 1–5 wind strength") at all times. Sunless Sea's console edition kept prompts on screen by choice ("clarity over subtlety"), but they were for a gamepad's handful of buttons, not some twenty bindings. **(inference)** Show only the prompt that applies now.
- **Notification spam** (Anno 1800) and **logs that cover the scenery** (Sunless Sea, before its patch).
- **Removing information without a replacement cue** (Black Flag Resynced's minimap).
- **Slot-by-slot inventory chores** (Skull and Bones).
- **Walking or zooming to reach a service** (Port Royale 4, Uncharted Waters' later cut).

---

## 8. Unverified (from memory; confirm before citing)

- Pirates! 2004 merchant screen: two columns (your ship against the merchant), one buy and one sell price per good, a cargo-capacity readout.
- Pirates! 2004 town: a single illustrated screen where you pick buildings. The manual says "menu"; the tavern room of people is sourced.
- Pirates! 2004 world map: parchment style with fog over undiscovered areas.
- A "the governor has news" prompt on arrival. The wiki's "summary since last visit" is the sourced version.
- Port Royale 2: buy and sell prices coloured against the average.
- Patrician III/IV: a bar or marker showing price against normal.
- Uncharted Waters NH: the merchant quoting "the market rate is X%".
- Mount & Blade: towns as text menus over a background picture.
- Anno 1800: a notification feed on the screen edge.
- CK3: nested tooltips.

---

## 9. What each Corsair screen could look like

"Now" describes the code at `c5cd4a2` (`apps/web/src/port.tsx`, `hud.tsx`, `log.tsx`). "Proposed" applies the principles above. All of it is **(inference)**, meant as a starting point for design rather than a spec.

### Harbour (port arrival)

- **Now:** a harbour painting with service hotspots. A header carries the town, standing and notices. A tab row (`port-tabs`) lists every service, with "coming soon" items greyed. There is a list of ships in the harbour with their sailing days.
- **Proposed:**
  - The painting is the menu: five or six labelled hotspots (Governor, Tavern, Merchant, Shipwright, Docks), and no tab row.
  - Hide services that are not built yet instead of greying them.
  - One line of arrival news over the painting: "The French have declared war on Spain. Sugar sells high here." It comes from the governor's summary or the harbourmaster.
  - Ships in harbour appear as a short "In the harbour" note, with a "lawful prize" tag only where that applies.
  - Esc returns to the sea.

### Merchant

- **Now:** one table (`table.market`).
  - Goods with an export or want tag.
  - "Price here: buy · sell" plus a level word.
  - "Takes".
  - "In your hold", with paid price, gain or loss, plunder and food days.
  - "Best sale you know", with age and profit.
  - Action buttons.
  - Below the table, the merchant's purse as a sentence.
- **Proposed:**
  - **One row per good: icon, name, one verdict, one price and two buttons.**
    - Sugar — *cheap here* — 12 — [Buy] [Buy max]
    - Rum — *sells well* — 31 (you paid 18, **+13 each**) — [Sell all]
  - **The hint sentence**, shown under the verdict without hovering: "Sells best at Tortuga, 26 (seen 4 days ago)". This is the existing best-sale data, as words.
  - **Hold and purse as a strip**: a hold bar (cargo/capacity) and the merchant's gold as one number.
  - **"Takes" becomes a warning** that appears only when it matters: "He'll only take about 20 before the price drops."
  - **Detail on click, not hover**: stock against usual, the news behind the price, what each unit moves it.
  - **A single default action** ("Sell the plunder", "Fill the hold with the best buy") for the one-click path.

### Shipwright

- **Now:** sub-tabs for repair, ships for sale, laid-up ships, upgrades and careening, each a table (`fleet-list`, `upgrades`).
- **Proposed:**
  - The opening view is one sentence and one button: "She's taken a beating: 40% hull. Repair for 320 gold?"
  - Below it, ships for sale as **cards**: a picture of the ship, three icon stats (speed, guns, hold), price, and one comparison line ("faster than yours, 6 fewer guns").
  - Upgrades as cards with the trade-off in words ("+1 knot, −2 guns").
  - Fleet management (laid up, sell, flagship) moves to the Fleet page in the log.

### Tavern

- **Now:** lists of news, contracts, the Top Ten, recruiting, crew pay, the stranger's offers, and a "quiet" line when there is nothing.
- **Proposed:**
  - A painted room with three to four people as hotspots, as in Pirates! 2004:
    - **barmaid**: prizes nearby, famous pirates;
    - **barkeep**: prices and wars elsewhere;
    - **stranger**: map pieces and secrets for gold;
    - **sailors** by the fire: "12 men will sign on, 10 gold each" [Sign them].
  - Each person says one sentence. When it is about a place, a small chart opens with the route or position (the barmaid's map in 2004). A full Top Ten list belongs in the log.

### Governor

- **Now:** standing, rank, letter of marque and bounties.
- **Proposed:**
  - **The opening line summarises since last visit**: "You took two Spanish ships for us. His Excellency is pleased."
  - **Then one offer at a time**, with its consequence in words: "Accept a letter of marque against Spain? (Spanish ports will close to you.)" [Accept] [Not now].
  - **Rank progress as a named band** ("Captain → Major: one more prize").

### Sea HUD

- **Now:**
  - A compass rose with a red wind arrow, heading mark, speed, point of sail and a sailing-quality readout.
  - Date and sea area.
  - Breeze notes.
  - Prompts and sound captions.
  - A permanent full key legend.
- **Proposed:**
  - Keep the compass bottom-right as the anchor: wind, heading, knots, point of sail as one word.
  - Next to it, one compact strip of icons with one number each: gold, crew, food in days, morale as a face or word, fame.
  - The date sits under the compass, as in 2004.
  - The key legend goes. Show only the prompt relevant now ("E — enter Port Royal"); F1 brings up the full list.
  - Quest icons (two or three open threads) top-left, each opening its page.
  - Fade the strip after a few seconds of steady sailing; anything that changes brings it back.

### Chart

- **Now:** a planner with the route, a port card (people, purse, trend, remembered prices) and pirate risk on the lanes ([corsair-game-loops.md](corsair-game-loops.md), [pirates-original-games.md](pirates-original-games.md)).
- **Proposed:**
  - A parchment chart, opened like a physical object.
  - Port labels carry one icon for something notable (war, plague, a good price for what you hold). Hover shows the name only.
  - A click opens a small card: the town painting, three verdict lines ("Rum sells well, 29, seen 6 days ago"), news and a [Set course] button.
  - Uncharted knowledge reads as "Not visited: ask in a tavern", which links trade knowledge to the people in principle 6.

### Treasure map

- **Now:** a Maps tab in the log with torn pieces, a search ring on the chart that shrinks per piece, and the landmark in 3D.
- **Proposed:**
  - Keep the design, and make getting a piece a **moment**: a full-screen parchment where the new piece slides into place next to the old ones (Pirates! 2004 p.51 auto-assembly).
  - One line of the stranger's voice, then [Plot a course] or [Later].
  - When the map completes, show it once full-screen before it files away.

### Captain's log and news

- **Now:** tabs for Goals, Career, Top Ten and Maps.
- **Proposed:**
  - Add a **Log** page as the default: dated one-liners, newest first, mixing your deeds ("3 March 1662: Took the *Santa Rosa* off Havana") with world news ("France declares war on Spain").
  - Each entry links to the chart where it is about a place.
  - Big news arrives once as a **letter or broadsheet card** with a date, sender, headline and one consequence line ("Spanish ports now hostile to French ships"), then files into the log.
  - The CK3 pattern applies to the small queue of "things waiting for you": a few icons, ranked by importance.

---

## 10. Sources

**Pirates!**
- Sid Meier's Pirates! 2004 PC manual: https://cdn.cloudflare.steamstatic.com/steam/apps/3920/manuals/manual.pdf
- Pirates! wiki (via API), Tavern: https://sidmeierspirates.fandom.com/api.php?action=parse&page=Tavern&format=json&prop=wikitext&formatversion=2
- Pirates! wiki (via API), Governor: https://sidmeierspirates.fandom.com/api.php?action=parse&page=Governor&format=json&prop=wikitext&formatversion=2
- C64-Wiki, Pirates!: https://www.c64-wiki.com/wiki/Pirates!
- Filfre, "Pirates!": https://www.filfre.net/2015/07/pirates/
- CRPG Addict, Pirates!: https://crpgaddict.blogspot.com/2011/01/game-40-pirates.html
- LP Archive, Sid Meier's Pirates! updates 1–4: https://lparchive.org/Sid-Meiers-Pirates/Update%201/ (also /Update%202/, /Update%203/, /Update%204/)
- Present Perfect Gaming, Pirates!: https://presentperfectgaming.com/pirates/
- Metacritic, Sid Meier's Pirates!: https://www.metacritic.com/game/sid-meiers-pirates/
- Wikipedia, Sid Meier's Pirates! (2004): https://en.wikipedia.org/wiki/Sid_Meier%27s_Pirates!_(2004_video_game)

**Trading games**
- Anno Union, UI devblog: https://www.anno-union.com/devblog-user-interface-2/
- Anno Union, Breaking News (newspaper): https://www.anno-union.com/breaking-news/
- Anno 1800 Steam reviews: https://store.steampowered.com/appreviews/916440?json=1&filter=all&language=english&num_per_page=100&purchase_type=all&day_range=9999
- Wikipedia, Anno 1800: https://en.wikipedia.org/wiki/Anno_1800
- TheGamer, Port Royale 4 review: https://www.thegamer.com/port-royale-4-review/
- Port Royale 4 Steam reviews: https://store.steampowered.com/appreviews/1024650?json=1&filter=all&language=english&num_per_page=100&purchase_type=all&day_range=9999
- Port Royale 3 Steam reviews: https://store.steampowered.com/appreviews/205610?json=1&filter=all&language=english&num_per_page=100&purchase_type=all&day_range=9999
- Wikipedia, Port Royale 2: https://en.wikipedia.org/wiki/Port_Royale_2
- GOG, Port Royale 2: https://www.gog.com/en/game/port_royale_2
- GOG, Patrician III: https://www.gog.com/en/game/patrician_3
- Metacritic, Patrician IV: https://www.metacritic.com/game/patrician-iv/critic-reviews/
- Wikipedia, Patrician IV: https://en.wikipedia.org/wiki/Patrician_IV
- Wikipedia, Uncharted Waters: New Horizons: https://en.wikipedia.org/wiki/Uncharted_Waters:_New_Horizons
- Wikipedia, Uncharted Waters: https://en.wikipedia.org/wiki/Uncharted_Waters
- Japanese Wikipedia, 大航海時代II: https://ja.wikipedia.org/wiki/大航海時代II

**3D pirate games**
- Sea of Thieves wiki: Ship https://seaofthieves.wiki.gg/wiki/Ship · Wind https://seaofthieves.wiki.gg/wiki/Wind · Compass https://seaofthieves.wiki.gg/wiki/Compass · Map Table https://seaofthieves.wiki.gg/wiki/Map_Table · Treasure Map https://seaofthieves.wiki.gg/wiki/Treasure_Map · Riddle Map https://seaofthieves.wiki.gg/wiki/Riddle_Map · Tall Tales https://seaofthieves.wiki.gg/wiki/Tall_Tales · Outpost https://seaofthieves.wiki.gg/wiki/Outpost · Settings https://seaofthieves.wiki.gg/wiki/Settings
- Sea of Thieves forum, minimal UI option: https://www.seaofthieves.com/community/forums/topic/143464/minimal-ui-option
- Independent.ie, Sea of Thieves preview (snippet only): https://independent.ie/entertainment/games/previews/sea-of-thieves-preview-shipshape-and-raring-to-go-36626039.html
- GDC Vault search, Sea of Thieves: https://gdcvault.com/browse?keyword=sea+of+thieves
- Black Flag wind arrow discussion: https://steamcommunity.com/app/242050/discussions/0/2592234299544255935/
- Black Flag Resynced minimap discussion: https://steamcommunity.com/app/3751950/discussions/0/570417328562424687/
- Wikipedia, Assassin's Creed IV: Black Flag: https://en.wikipedia.org/wiki/Assassin%27s_Creed_IV:_Black_Flag
- Black Flag treasure maps guide: https://katkat.com/blog/how-to-find-buried-treasure-ac-black-flag-resynced
- Black Flag Kenway's Fleet guide: https://blackflag.wiki/guides/kenways-fleet-explained/
- Dexerto, Skull and Bones UI: https://www.dexerto.com/elden-ring/skull-bones-elden-ring-ui-meme-1866405/
- Screen Rant, Skull and Bones UI: https://screenrant.com/skull-bones-cluttered-ui-elden-ring-ubisoft-meme/
- Skull and Bones Steam reviews: https://steamcommunity.com/app/2853730/reviews/?browsefilter=toprated
- Wikipedia, Age of Pirates: Caribbean Tales: https://en.wikipedia.org/wiki/Age_of_Pirates:_Caribbean_Tales
- Pirates Ahoy, New Horizons tutorial: https://www.piratesahoy.net/wiki/new-horizons-tutorial/
- Age of Pirates 2 Steam reviews: https://steamcommunity.com/app/937940/reviews/?browsefilter=toprated
- Naval Action Steam reviews: https://steamcommunity.com/app/311310/reviews/?browsefilter=toprated
- Naval Action port UI patch: https://steamcommunity.com/app/311310/discussions/15/1736595227839122955/
- Gamers With Jobs, Naval Action: https://www.gamerswithjobs.com/node/1299475
- Corsairs Legacy Steam reviews: https://steamcommunity.com/app/1594880/reviews/?browsefilter=toprated

**Indies, Mount & Blade, design writing**
- Sunless Sea wiki: Gazetteer https://sunlesssea.miraheze.org/wiki/Gazetteer · Terror https://sunlesssea.miraheze.org/wiki/Terror · Port Report https://sunlesssea.miraheze.org/wiki/Port_Report
- Wikipedia, Sunless Sea: https://en.wikipedia.org/wiki/Sunless_Sea
- Failbetter, interface update: https://www.failbettergames.com/news/interface-update-coming-to-sunless-sea
- Failbetter, Zubmariner UI: https://www.failbettergames.com/news/diving-into-the-ui-and-control-scheme-of-sunless-sea-zubmariner-edition
- Failbetter, Sunless Skies proc-gen: https://www.failbettergames.com/news/sunless-skies-pre-production-talkin-bout-proc-generation
- Emily Short, "Storylets: You Want Them": https://emshort.blog/2019/11/29/storylets-you-want-them/
- Wikipedia, Mount & Blade: Warband: https://en.wikipedia.org/wiki/Mount_%26_Blade:_Warband
- Warband trading discussion: https://steamcommunity.com/app/48700/discussions/0/2119355556486639900/
- Bannerlord price colours: https://steamcommunity.com/app/261550/discussions/0/6458775074336141183/
- Bannerlord hover-only request: https://steamcommunity.com/app/261550/discussions/0/3380536561721344005/
- Bannerlord colour-blind complaint: https://steamcommunity.com/app/261550/discussions/0/2799504352982212738/
- Wikipedia, Dredge: https://en.wikipedia.org/wiki/Dredge_(video_game)
- Dredge map markers discussion: https://steamcommunity.com/app/1562430/discussions/0/6620894968771088616/
- Wikipedia, Slay the Spire: https://en.wikipedia.org/wiki/Slay_the_Spire
- Game Developer, "Game UI Discoveries: What Players Want": https://www.gamedeveloper.com/design/game-ui-discoveries-what-players-want
- CK3 wiki, Beginner's guide: https://ck3.paradoxwikis.com/Beginner%27s_guide

**Corsair internal**
- docs/reference/pirates-sid-meier-design.md
- docs/reference/pirates-original-games.md
- apps/web/src/port.tsx, hud.tsx, log.tsx at c5cd4a2
