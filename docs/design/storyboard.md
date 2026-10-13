# Storyboard: from the loading screen into the game

Proposed 2026-10-11. The whole player-facing flow, screen by screen, redesigned to feel like a game rather than
tables: what each screen is for, what is on it, how the player moves on, and the painted art it needs. It applies
the principles in [../reference/game-ui.md](../reference/game-ui.md) section 7 (a verdict word and one number,
one decision per screen, the place is the menu, people deliver information, news is an event then a line, a quiet
HUD) and the "UI must be easy" rule (one-click defaults, consequences shown).

Art is generated with Grok Imagine through the existing pipeline ([../../art/sources/paintings/README.md](../../art/sources/paintings/README.md)):
paste the README's **style block** first, then the prompt below, save as `art/sources/paintings/{group}/{id}.v{n}.png`
with a prompt record, and import with `node tools/art/import_paintings.ts`. Every painting is text-free; the game
draws all words in HTML. Prompts here are the scene part only.

## 0. The look, in one paragraph

Two layers. **The world** is the 3D sea (Black Flag realism: real water, sky, weather, ships). **Everything you
read** is the painted 1660s Caribbean: pixel-art scenes for places and people, parchment for maps, letters and the
log, dark tarred wood and brass for the few frames that hold controls. No bare dark rectangles with tables: a panel
is a thing in the world (a ledger on the merchant's counter, a letter, a chart on the table). One display face
(Pirata One) for names and headings, one readable body face, and gold, red and green used only for verdicts.

**Decision for you:** keep the stills in the current pixel-art style (all 22 existing paintings are in it), or move
stills to a painterly style closer to the 3D sea. This storyboard assumes **pixel art stays**, so nothing already
painted is thrown away.

## 1. The flow at a glance

```
Boot ─► Loading ─► Title ─► New career (3 steps) ─► Opening letter ─► Port Royal harbour
                     │                                                        │
                     └─► Continue ─────────────────────────────────────────────┤
                                                                              ▼
   ┌──────────── Harbour (the painting is the menu) ◄──── dock ──── Sea (3D, quiet HUD) ◄────┐
   │  Merchant · Tavern · Governor · Shipwright · Docks                    │   │   │   │      │
   │                                                                      │   │   │   │      │
   └─ Set sail ───────────────────────────────────────────────────────────┘   │   │   │      │
        Sea events:  sail sighted ─► Hail card ─► Battle ─► Report ─► Plunder ──┘   │   │      │
                     Chart (M, parchment) ─────────────────────────────────────────┘   │      │
                     Log (L, the captain's book) ──────────────────────────────────────┘      │
                     Moments: letter / promotion / map piece / storm / famous pirate ─────────┘
   Retire… (any harbour) ─► Fate painting ─► Title
```

## 2. Screens

Each screen lists **Purpose**, **Layout** (a wireframe at 16:9), **Elements**, **Moves on to**, and **Art**.

### 2.1 Boot and loading

- **Purpose:** show the game at once, and hide the 3D warm-up (the first frame indexes the map, about 2 s).
- **Layout:**

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│         [ painting: a brig at dawn off a misty coast ]     │
│                                                            │
│                                                            │
│   "There is no peace beyond the line."  — a period saying  │
│   ═══════════════════════▶ (rope that pays out as it loads)│
└────────────────────────────────────────────────────────────┘
```

- **Elements:** one painting, one line of period flavour (rotating from a list), a rope progress bar.
- **Moves on to:** the title, fading.
- **Art:** `loading.dawn` (new). Prompt: *A lone two-masted brig under full sail at dawn, seen from low on the
  water, a misty green coast with a fort on a headland behind, pale gold sky, long calm swell, gulls. Wide empty
  sky in the upper half.* Further variants later: `loading.storm`, `loading.night`.

### 2.2 Title

- **Purpose:** continue or begin; nothing else.
- **Layout:** the existing `title.main` painting, the title, and two big buttons. Load and save-to-file move to a
  small "Saves…" link.

```
┌────────────────────────────────────────────────────────────┐
│                     PROJECT CORSAIR                        │
│                 [ title.main painting ]                    │
│            ┌──────────────────────────────┐                │
│            │ Continue                     │                │
│            │ 14 May 1661 · in port at Tortuga│             │
│            └──────────────────────────────┘                │
│            ┌──────────────────────────────┐                │
│            │ New career                   │                │
│            └──────────────────────────────┘    Saves…      │
└────────────────────────────────────────────────────────────┘
```

- **Moves on to:** Continue goes straight to where the save was; New career opens 2.3.
- **Art:** exists (`title.main`).

### 2.3 New career: three short steps

Pirates! asks nation, name and difficulty; we ask the same, one step per screen, each with a painted card.

1. **Under whose flag** (built; storyboard board 1.3a). Four cards alike in size, their parts in the same rows:
   the flag, the nation's name, its capital with a small painting of its harbour, what it is good for, and its wars
   as the career opens. The picked card is ringed, never moved. The flag sets the starting port (the capital) and
   the captain's standing there (`politics.json flag`); it is kept on the captain for what war will mean later.
2. **Your name** (new). A parchment ship's register: "Captain ____ of the brig ____", with a dice button for a
   period name.
3. **How hard a sea** (built in slice 6). Five cards Apprentice to Swashbuckler, each a small painting of a rising
   sea state and one sentence. The selected card glows; Set sail.

- **Art:** `newcareer.register` (parchment ledger page, no writing: *An open ship's register on a sea chest,
  aged parchment pages with faint ruled lines and no writing, a quill and inkwell, brass dividers, warm candle light
  from the left*). Difficulty cards: `difficulty.1` … `difficulty.5` (*the same small brig in five seas, from a
  glassy calm under a clear sky to a black gale with spray; one painting each*).

### 2.4 Opening letter

- **Purpose:** the story's first beat and the first goal, in one card.
- **Layout:** a sealed letter that opens over the harbour painting.

```
┌───────────────────────────── parchment ──────────────────────┐
│  Port Royal, 1 March 1660                       [wax seal]   │
│                                                              │
│  Captain,                                                    │
│  Your uncle's brig is yours, with ten guns and seventy-five  │
│  men. The Main is rich and the Spanish are at war with us.   │
│  Fill her battery and her crew, and come and see me.         │
│                          — the Governor of Jamaica           │
│                                                              │
│  First goal:  Mount a full battery        [ To the harbour ] │
└──────────────────────────────────────────────────────────────┘
```

- **Art:** `paper.letter` (*a single sheet of aged laid paper, slightly curled, a red wax seal at the top right, no
  writing, on a dark wooden desk*), `paper.seal.{nation}` small seals (four).

### 2.5 Harbour (arrival)

- **Purpose:** you have arrived; pick where to go. The painting is the menu.
- **Layout:** the full harbour painting, five labelled hotspots, a one-line arrival news strip, and a small
  strip at the bottom with gold, crew and food (the same three as at sea). No tab row, no table.

```
┌────────────────────────────────────────────────────────────┐
│ Port Royal                           1 March 1660          │
│ ┌──────────────────────────────────────────────┐           │
│ │ "Sugar sells high here; the French are at war with Spain"│
│ └──────────────────────────────────────────────┘           │
│      (Governor)        (Tavern ·2)                         │
│   [ painted harbour: the buildings are the buttons ]       │
│        (Merchant)                  (Shipwright)            │
│                                                (Docks)     │
│ 1,000 gold · 75 men · 5 days' food        [ Set sail · E ] │
└────────────────────────────────────────────────────────────┘
```

- **Elements:** hotspot labels on the buildings (a badge when someone there has something for you: "2" on the
  tavern), the arrival line (the most useful single fact, picked by the game), Set sail. Retire… lives under the
  Docks hotspot. A prize brought in is the arrival line ("Your prize, the fluyt Good Hope, lies here: mend, fit or
  sell her at the shipwright"), and the shipwright's badge counts the ships of the fleet.
- **Art:** exists (16 harbours).

### 2.6 Merchant

- **Purpose:** buy and sell in a few clicks, told what's good.
- **Layout:** the merchant interior painting; a ledger on the counter holds the goods. One row a good.

```
┌──────────────── interior.merchant ─────────────────────────┐
│ Merchant: "Rum's dear here, captain. Sugar I can't give away."│
│ ┌──────────── ledger (parchment) ─────────────────────────┐│
│ │ 🍬 Sugar    cheap here       12   [Buy 10] [Fill hold]   ││
│ │             sells best at Tortuga, 26 (seen 4 days ago)  ││
│ │ 🍾 Rum      sells well here  31   [Sell all: +13 each]   ││
│ │ 🥩 Food     5 days aboard    8    [Stock 10 days]        ││
│ │ …                                                        ││
│ └──────────────────────────────────────────────────────────┘│
│ Hold ▓▓▓▓░░░░ 40/100   Merchant's purse 2,400   [Leave · Esc]│
└────────────────────────────────────────────────────────────┘
```

- **Elements:** icon, name, a verdict word, one price, and all four trades on every row in fixed columns (Buy 10,
  Buy max, Sell 10, Sell all; the ones that can't apply greyed, food without Buy max and Sell all); a hint line under
  a good only when it has one; a click on the good (not hover) opens why (stock, news, what you paid). The merchant speaks
  one line: the best fact here. Default action: "Sell the plunder" or "Fill the hold with the best buy".
- **Art:** exists (`interior.merchant`), plus a merchant bust (2.14).

### 2.7 Tavern

- **Purpose:** hear things and hire men. People, not lists.
- **Layout:** the tavern interior with three or four people standing in it as hotspots. Clicking one opens a
  speech card beside them.

```
┌──────────────── interior.tavern ───────────────────────────┐
│   (Barmaid ·1)      (Old salt)       (Stranger)            │
│        ┌──────── speech card ───────────────────┐          │
│        │ [bust] "A Spanish fluyt sails for      │          │
│        │  Havana with silver, two days out."     │          │
│        │  [ See it on the chart ]  [ Thank her ] │          │
│        └─────────────────────────────────────────┘          │
│   (Sailors by the fire: "12 men will sign on")             │
└────────────────────────────────────────────────────────────┘
```

- **Elements:** the **barmaid** (prizes and famous pirates nearby), the **old salt** (prices and wars elsewhere,
  one port at a time), the **stranger** (map pieces; when bought, the map moment 2.12), the **sailors** (sign on:
  "12 men, 10 gold each" [Sign them] [Fill the berths]; pay or divide the plunder). Each says one sentence; a
  place opens a small chart inset. The Top Ten moves to the log.
- **Art:** exists (`interior.tavern`, `interior.tavern.pirate`), plus busts.

### 2.8 Governor

- **Purpose:** your standing, your rank, and one offer.
- **Layout:** the governor's study; the governor's bust speaks; below, the offer card and the rank ribbon.

```
┌──────────────── interior.governor ─────────────────────────┐
│ [bust] "You took two Spanish ships for us. His Majesty is   │
│         pleased."                                          │
│  Bounties owed: 2 ships ............ 540 gold  [ Collect ]  │
│  Rank: Captain ───●──── Major (2 more bounties: repairs 20% off) │
│  "Spain is our enemy. A letter of marque, 600 gold?"       │
│            [ Take the letter ]   [ Not now ]               │
└────────────────────────────────────────────────────────────┘
```

- **Elements:** the summary since your last visit, one offer at a time with its consequence, the rank as a
  ribbon with the next rung's benefit, a promotion as a moment (2.13).
- **Art:** exists (`interior.governor`), plus four governor busts (one per nation).

### 2.9 Shipwright

- **Purpose:** the place for your ships: keep them sound, make them better, swap the flag, sell them.
- **Layout:** the yard painting; the shipwright speaks the one thing that matters now; ships and fits are cards.

```
┌──────────────── interior.shipwright ───────────────────────┐
│ [bust] "She's taken a beating: hull 40%. Mend her for 320?" │
│                     [ Repair · 320 ]  [ Careen · 255 ]      │
│ ── Ships ──────────────────────────────────────────────────│
│ ┌─[ship art]─┐ ┌─[ship art]─┐ ┌─[ship art]─┐               │
│ │ Sloop      │ │ Brigantine │ │ Light frig.│               │
│ │ ⚓9 💥8 📦40│ │ ⚓8 💥14 📦90│ │ ⚓8 💥22 📦80│               │
│ │ faster, 10 │ │ handier,   │ │ Colonel of │               │
│ │ fewer guns │ │ 4 fewer gun│ │ England    │               │
│ │ 3,000      │ │ 5,500      │ │ 10,000     │               │
│ └────────────┘ └────────────┘ └────────────┘               │
│ ── Fit her out ── (cards: Copper "+0.5 knot, never fouls" ) │
└────────────────────────────────────────────────────────────┘
```

- **Elements:** three tabs, Your ships · Ships for sale · Fit out. Your ships: one opening sentence and its button,
  mending the fleet and careening, then a card a ship (the flagship first) with her state and her own orders: Mend,
  Fit out, Make flagship, Sell; ships laid up here beneath. Ships for sale: ship cards with three icon stats and a
  comparison line against yours. Fit out: which ship (any of the fleet; fine powder only on the flagship, which
  fights), then fit cards with the upside and downside in words. The log's Fleet page is a summary to read at sea.
- **Art:** exists (`interior.shipwright`), ship card art (2.14, six new classes), fit icons (2.14).

### 2.10 At sea: the quiet HUD

- **Purpose:** sail. The sea is the screen.
- **Layout:**

```
┌────────────────────────────────────────────────────────────┐
│ ⚓ Fill the battery (goal)                                  │
│                                                            │
│                    [ 3D sea, ship, sky ]                   │
│                                                            │
│                                                            │
│      E · enter Port Royal          (prompt only when near) │
│ 1,000 gold · 75 men · 5 days · Content    ╭── compass ──╮ │
│                                          │ wind, heading│ │
│                         [minimap]        ╰ 6 knots, reach╯ │
│                                           1 March 1660     │
└────────────────────────────────────────────────────────────┘
```

- **Elements:** the compass (wind, heading, knots, point of sail in a word), the date under it, one strip of
  gold, crew, food in days and morale as a word, the current goal top left (two or three at most, each opening its
  page), the one prompt that applies now. The strip fades after a few seconds of steady sailing and returns on
  any change. The key legend goes to F1. The course line stays thin. The ship panel's sail and speed buttons
  become a small set by the compass.
- **Art:** compass rose and frame exist (`ui.chart.compass`, `ui.panel.frame`); a wood-and-brass strip
  `ui.hud.strip` (new).

### 2.11 Sea events

- **Sail sighted.** A short toast by the compass with the ship's flag: "A Spanish fluyt, merchant, off the
  starboard bow". H hails.
- **Hail card.** A speech card from her captain (bust by nation and role), one sentence, then replies: Trade
  news, Buy food, Attack (with the consequence: "Spain will remember"), Leave.
- **Battle.** Keep the 3D battle; the HUD shrinks to both ships' cards (hull, sails, men as named bands) and the
  ammo in three icons.
- **Victory.** One screen: what the fight did (result lines with their consequences, a map piece among them) beside
  her hold with the best already chosen and signing on her men; her fate as three equal cards (Let her go, Sink her,
  Keep her, each with what it costs, Keep her marked "best" when she sells for more than her hold is worth); a famous
  prisoner's fate; and one button, "Take the best and let her go" (Enter). Choosing by hand stays behind "Choose the
  goods myself". A fight with no prize ends on the report alone: one painting (exists: `outcome.*`) and Continue.
- **Art:** captain busts (2.14), outcome paintings exist.

### 2.12 The chart and the treasure map

- **Chart (M).** A parchment chart on a table, opened like an object. Ports are drawn as ink marks; a port with
  something for you carries one icon (war, plague, a good price for your hold). A click picks a port and leaves
  the chart clear: it is ringed in gold, the way there from her is drawn in dashed ink with "6 days" beside it, and
  its card takes the voyages' place beside the chart (the harbour painting in miniature, verdict lines with their
  age, news, every price folded away, and one big Set course · Enter; ← Voyages or Esc goes back). A double click
  sets course at once. A crowded island's hidden name shows while the pointer is on its mark. A port at war with
  the captain's flag is drawn in faded red ink with its mark struck through; its card says so, the voyages leave it
  out, and its warships hunt her flag.
- **Treasure map moment.** When you get a piece: the full screen goes to parchment, the new piece slides into
  place beside the ones you hold, the stranger's line ("That's all I know, captain"), and [Plot a course] [Later].
  When the map is whole, it is shown once complete.
- **Art:** `paper.chart` (*a large sheet of aged parchment for a sea chart, stained edges, faint compass rose
  lines, no coastlines, no writing, on a dark wooden table with brass dividers at a corner*), `paper.tornpiece`
  (*four torn quarters of a parchment sheet laid on a table, uneven torn edges, no drawing or writing*).

### 2.13 Moments

Short full-screen beats that reward and then get out of the way (one click or a few seconds):

| Moment | Shows | Art |
|---|---|---|
| A letter (news that matters) | dated letter with sender, headline, one consequence line | `paper.letter`, seals |
| Promotion | the governor's bust, the new rank, its benefit, land on a title | `moment.promotion` (*a sword laid across a parchment commission with a wax seal, on red velvet, candle light*) |
| First sight of a famous pirate | his flag, name, rank on the Top Ten, one line of reputation | `moment.famous` (*a pirate ship's black hull and sails emerging from sea mist at close range, a dark flag at the masthead, ominous*) |
| Storm coming | sky darkens in 3D; one line "A storm blows up from the east" | none (3D) |
| A hoard dug up | chest opening on the beach, the gold | `moment.hoard` (*an open iron-bound chest on a beach at sunset, gold coins and jewels spilling, a shovel stuck in the sand, palms*) |
| Retirement | the fate painting and the score card | exist (`fate.*`, four) |

### 2.14 People and small art

**Busts** (one face per role, head and shoulders, three-quarter view, plain dark background so they cut out):

| Id | Prompt (scene part) |
|---|---|
| `bust.merchant` | *A plump colonial merchant in a brown coat and white cravat, spectacles on his nose, a quill behind his ear, shrewd smile* |
| `bust.barmaid` | *A cheerful young tavern barmaid with a kerchief over dark curls, white blouse and green bodice, holding a pewter jug* |
| `bust.oldsalt` | *A weathered old sailor with a grey beard, a knitted cap, a clay pipe, a scarred cheek, squinting* |
| `bust.stranger` | *A shady stranger in a dark hooded cloak, a gold earring, half his face in shadow, one eye catching the light* |
| `bust.sailors` | *Three rough young sailors in striped shirts and neckerchiefs, grinning, one with a tattooed arm* |
| `bust.shipwright` | *A broad-shouldered shipwright with rolled sleeves, a leather apron, an adze over his shoulder, sawdust in his hair* |
| `bust.governor.{england,france,netherlands,spain}` | *A colonial governor of the 1660s in his nation's fashion (England: periwig, red coat; France: long curled wig, blue coat with lace; Netherlands: black coat, broad white collar; Spain: black doublet, ruff, gold chain)* |
| `bust.captain.{merchant,navy,pirate}` | *A ship's captain hailing from his deck: a merchant master in a plain coat; a naval officer in a laced coat and tricorn; a pirate in a red sash with pistols* |

**Ship card art** for the six new classes (`ui.ship.pinnace`, `periagua`, `half_galley`, `galley_frigate`,
`ketch`, `pink`): rendered from their 3D models with the existing ship-card render, not painted, so they match
the 3D ships.

**Icons** to add: fit icons for the nine upgrades (`ui.icon.fit.{id}`), verdict marks (`ui.icon.cheap`,
`ui.icon.dear`), a rope progress bar (`ui.rope`).

**Pipeline additions:** busts need cutting out (generate on a flat dark background and mask), and the paper
textures need slicing into a frame that stretches (nine-slice). Both are a small step in `tools/art/`.

## 3. Build order

1. **HUD and harbour** (biggest effect for least art): the quiet HUD, F1 for keys, the harbour without tabs and
   with the arrival line. Needs only `ui.hud.strip`.
2. **Merchant ledger**: the one-row-a-good design. No new art beyond `bust.merchant`.
3. **Tavern people and the map moment**: busts, speech cards, `paper.tornpiece`.
4. **Governor and moments**: summary line, rank ribbon, letters and promotion.
5. **Shipwright cards**: ship and fit cards.
6. **New career steps and the opening letter**, then the loading screen.
7. **Chart as parchment** with port cards.

## 4. Art list

| Id | Group | New / exists | Used in |
|---|---|---|---|
| `loading.dawn` | title | new | 2.1 |
| `title.main` | title | exists | 2.2 |
| `newcareer.register`, `difficulty.1-5` | title | new | 2.3 |
| `paper.letter`, `paper.seal.*`, `paper.chart`, `paper.tornpiece` | ui | new | 2.4, 2.12, 2.13 |
| `harbour.*` (16), `interior.*` (5) | harbours, interiors | exist | 2.5-2.9 |
| `bust.*` (15) | people (new group) | new | 2.6-2.11 |
| `moment.promotion`, `moment.famous`, `moment.hoard` | moments (new group) | new | 2.13 |
| `fate.*` (4), `outcome.*` (4) | fates, outcomes | exist | 2.11, 2.13 |
| `ui.hud.strip`, `ui.rope`, `ui.icon.fit.*`, verdict marks | ui | new | 2.1, 2.9, 2.10 |
| `ui.ship.*` (6 new classes) | rendered | new | 2.9 |

About 30 new paintings, each a single Grok batch.
