# Storyboard audit: what the game has against the mockups

**Built 2026-10-11:** every row below is in the game (slices S1 to S13). Two storyboard ideas the audit never
covered remain for later, as new features rather than restyles: the new career's nation and name steps (storyboard
2.3, steps 1 and 2: every career still starts as England in Port Royal) and the storm moment's darkening sky.

Audited 2026-10-11 against the 30 artboards of the
[Corsair UI Storyboard](https://claude.ai/artifact/YAbWGj2B2zQ9xKvUVxdnCg) and the code at `ab7e957`. The goal: every
storyboard element built and matching. Each row is one element: **Have** (works today, only its look changes),
**Partial** (some of it exists), or **New** (logic or screen to build), with the art it waits on and the slice of
[ui-conversion.md](ui-conversion.md) that builds it. **Now** says where each stands after the slices.

## Art status

| Art | Status |
|---|---|
| 13 busts (people) | In the game (`art/game/people`) |
| 16 harbours, 5 interiors, title, 4 outcomes, 4 fates | In the game |
| `moment.promotion`, `.famous`, `.hoard` | In the game |
| `loading.dawn`, `difficulty.1-5` | In the game |
| `fate.tavern`, `.planter`, `.council`, `.legend` | In the game (all eight fates now imported) |
| `ui.icons.fits` | In the game, as nine `ui.icon.fit.*` icons |
| Ship card art for the seven newer classes | In the game, rendered from their 3D models (`tools/art/render_ship_cards.ts`) |

Every screen shows a labelled placeholder until its painting arrives, so no slice waits on art.

## 1. Start

| Element (artboard) | Status | Notes | Slice | Now |
|---|---|---|---|---|
| Loading screen with painting, line, rope bar (1.1) | **New** | Nothing shows while the map decodes | S11 | Built |
| Title: Continue card with date, port, gold (1.2) | Partial | Exists as a dark panel; restyle to the two big buttons | S11 | Built |
| Title: Saves to/from file as small links (1.2) | Have | | S11 | Built |
| New career: difficulty cards with painting and score multiple (1.3) | Partial | Buttons and text exist; cards, paintings, score line new | S11 | Built |
| Opening letter with first goal (1.4) | **New** | | S11 | Built |

## 2. In port

| Element | Status | Notes | Slice | Now |
|---|---|---|---|---|
| Harbour painting as the menu, labelled hotspots with badges (2.1) | Partial | Hotspots exist; badge only on the tavern; the tab row and greyed "soon" items must go | S3 | Built |
| Town name, tags (capital, people, standing as a word) (2.1) | Partial | Shown as text in the panel header | S3 | Built |
| Arrival news line (2.1) | **New** | `arrivalNews`: the one most useful fact | S3 | Built |
| Bottom strip: gold, men, food days, morale word, Set sail (2.1) | Partial | Values exist in the ship panel; the strip is new | S3 | Built |
| Docks hotspot: ships in harbour, Retire… (2.1) | Partial | Retire… exists on the harbour bar; ships-in-harbour list exists in the port panel | S3 | Built |
| Merchant bust and one spoken line (2.2) | **New** | Bust in; the line picker is new | S4 | Built |
| Market ledger: icon, verdict word, one price, one or two buttons (2.2) | Partial | `table.market` has all the data in five columns | S4 | Built |
| Best-sale hint as a sentence (2.2) | Have | Exists as a column; becomes the second line | S4 | Built |
| "Why this price" on click (2.2) | Partial | Exists as a hover title | S4 | Built |
| Hold bar, merchant's purse, your gold (2.2) | Partial | Exists as text | S4 | Built |
| Default actions: sell the plunder, fill the hold with the best buy (2.2) | **New** | | S4 | Built |
| Tavern: people as hotspots with badges (2.3) | **New** | Tavern is one list today | S5 | Built |
| Barmaid with news and a chart inset, Plot a course (2.3) | Partial | News is heard in the tavern; the speaker and the inset are new | S5 | Built |
| Old salt with a contract offer (2.3) | Partial | Contracts exist (`contractLine`) | S5 | Built |
| Stranger with a map piece (2.3) | Have | Exists as a line; becomes his card | S5 | Built |
| Sailors: sign on N, fill the berths, food and wage consequence (2.4) | Have | Recruit exists; restyle | S5 | Built |
| Crew pay: chest, days unpaid, morale band, divide or pay wages with consequences (2.4) | Partial | Exists; morale as a named band with direction is new | S5 | Built |
| Governor bust, "since you were last here" line (2.5) | **New** | Needs the tick of the last visit per governor | S6 | Built |
| War and peace tags (2.5) | Have | | S6 | Built |
| Bounties owed card (2.5) | Have | Restyle | S6 | Built |
| Rank ribbon with merit to the next rank and what it brings (2.5) | Partial | Rank and next rung exist as text; the ribbon is new | S6 | Built |
| One offer at a time (letter of marque) with consequence (2.5) | Partial | Offer exists; consequence line new | S6 | Built |
| Standing as a word (Friendly, 34) (2.5) | Partial | Shown as a number | S6 | Built |

## 3. Shipwright and fleet

| Element | Status | Notes | Slice | Now |
|---|---|---|---|---|
| Three choices (Mend, Ships, Fit out) in place of tabs (3.1-3.3) | Partial | Tabs exist; restyle | S7 | Built |
| Shipwright bust and opening line (3.1) | **New** | | S7 | Built |
| Mend and careen with costs and consequence (3.1) | Have | Restyle | S7 | Built |
| Fleet list with state per ship (3.1) | Have | Moves to the log's Fleet page | S7, S8 | Built |
| Ship cards: art, four stats, comparison line, lock reason (3.2) | Partial | Rows exist with reasons; cards and comparison line new; six classes need card art | S7 | Built |
| Guns row: buy one, fill, sell one (3.3) | Have | Restyle | S7 | Built |
| Fit cards with upside and downside in words (3.3) | Partial | Effects exist as text; cards and fit icons new | S7 | Built |
| Log's Fleet page: flagship, make flagship, laid up, selling note (3.4) | Partial | All exists in the shipwright | S8 | Built |

## 4. At sea

| Element | Status | Notes | Slice | Now |
|---|---|---|---|---|
| Goal pill top left (4.1) | Partial | Goals exist; a goal-done note shows in the prompt line | S2 | Built |
| Sea area and danger as a pill (4.1) | Have | In the HUD panel today | S2 | Built |
| One prompt of the moment ("E · enter Port Royal") (4.1) | Partial | One prompt line exists; key caps new | S2 | Built |
| Stat strip: gold, men, food days, morale word, hull word (4.1) | Partial | All in the ship panel today | S2 | Built |
| Strip fades at rest, returns on change (4.1) | **New** | | S2 | Built |
| Minimap in a brass frame (4.1) | Have | Restyle | S2 | Built |
| Compass: wind arrow, heading, knots and point of sail in a word (4.1) | Have | Restyle; drop the separate numeric panel | S2 | Built |
| Sail and speed controls beside the compass (4.1) | Have | In the ship panel today | S2 | Built |
| Date and time of day under the compass (4.1) | Partial | Date shown top left | S2 | Built |
| The big HUD text panel (wind, heading, speed numbers) (4.1) | Remove | Replaced by the compass and pills | S2 | Removed |
| The permanent key legend (4.1) | Remove | Goes to F1 | S2 | Removed |
| Ship panel (hull, sails, crew bars, purse, fleet) (4.1) | Remove | Replaced by the strip and the log's Fleet page | S2 | Removed |
| "Sail ho!" banner with H and I (4.2) | Partial | Sightings exist; the banner is new | S2 | Built |
| Ship label over a ship at sea (4.2) | Have | Restyle to the pill | S2 | Built |
| Toasts: goal done, weather, hunger, dig, careen, rent, port shut (4.2) | Partial | These exist as prompt-line notes; a toast stack is new | S2 | Built |
| G and K prompts with key caps (4.2) | Have | Restyle | S2 | Built |
| Hail as a speech card: tags, bust by role, line, food offer, attack with consequence, sail on (4.3) | Partial | The hail panel has all of it except the bust and the card | S10 | Built |
| Chart as parchment, ink port pins, route, wind arrows (4.4) | Partial | Chart exists, drawn as a coloured map | S12 | Built |
| Port card: painting, verdict lines with age, danger, Set course (4.4) | Partial | A hover card with remembered prices exists | S12 | Built |
| Hoard ring with its label (4.4) | Have | Restyle | S12 | Built |
| F1 help: every key, grouped (4.5) | **New** | | S2 | Built |

## 5. Battle

| Element | Status | Notes | Slice | Now |
|---|---|---|---|---|
| Ship cards with named bands (Sound, Holed, Badly hurt) (5.1) | Partial | Cards with bars exist; words new | S10 | Built |
| Raking call-out (5.1) | Have | Restyle | S10 | Built |
| Close-to-board prompt with odds (5.1) | Have | Restyle | S10 | Built |
| Broadsides ready/loading and ammo choice (5.1) | Have | Restyle | S10 | Built |
| Battle compass with point of sail (5.1) | Have | | S10 | Built |
| "Wavering" tag on her card (5.2) | Have | Restyle | S10 | Built |
| Famous pirate's demand card with both consequences and Y (5.2) | Partial | Banner exists; the two consequence columns are new | S10 | Built |
| "Drawing away" warning with distance (5.2) | Have | | S10 | Built |
| Report: painting, title, result lines with icons, standing chips, To her hold (5.3) | Have | Restyle | S10 | Built |
| Plunder: hold icons, one-click default, volunteers and fate lines, sink or keep (5.4) | Have | Restyle | S10 | Built |
| Captive choice card (5.4) | Have | Restyle | S10 | Built |

## 6. The log and moments

| Element | Status | Notes | Slice | Now |
|---|---|---|---|---|
| The log as a book with bookmarks (6.1-6.3, 3.4) | Partial | A log panel with tabs exists | S8 | Built |
| Log page: dated deeds and news, newest first (6.1) | **New** | Needs a logbook kept in the state | S8 | Built |
| Goals page: next three with progress and Plot, done list, difficulty (6.2) | Have | Restyle | S8 | Built |
| Top Ten with flags, whereabouts, your fame (6.3) | Have | Restyle | S8 | Built |
| Career page (score card) | Have | Restyle | S8 | Built |
| Maps page | Have | Restyle | S8 | Built |
| The log opens in port too | **New** | It closes in port today | S8 | Built |
| Map-piece moment: pieces sliding in, the stranger's line, X marked (6.4) | Partial | A parchment card opens on buying; the full-screen moment is new | S9 | Built |
| News moment: a broadsheet for war and peace with what it means (6.5) | **New** | | S9 | Built |
| Promotion moment (6.6) | Partial | A port notice exists | S9 | Built |
| A famous pirate's first sighting, a hoard dug up | **New** | Moment paintings not made | S9 | Built |

## 7. Retirement

| Element | Status | Notes | Slice | Now |
|---|---|---|---|---|
| Retire? score card with every part and the next fate (7.1) | Have | Restyle; add "the next fate at N" | S13 | Built |
| Fate screen with the fate painting (7.2) | Partial | The ending exists without its painting; 3 of 7 fates have paintings | S13 | Built |

## Totals

Of about 100 elements: about 40 **Have** (restyle only), 35 **Partial**, 20 **New**, and 4 to **remove**. The new
logic is small and listed in the slices: the arrival line, the governor's last visit, the logbook, the moment
queue, the prompt of the moment and the strip's fade, F1 help, the loading screen and the opening letter.
