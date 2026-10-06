# Grok Imagine brief: harbours, service interiors, title art, UI kit

`art/sources/paintings/` holds every painted source, whichever tool made it; each prompt record names the tool.

Prompts for painting Corsair's still scenes with Grok Imagine (Image 2.0). The Blender renders in
`art/game/harbours/` stay in the game until a painted scene is imported to replace them.

## How to run each prompt

1. **Settings:** 16:9, 2K (the largest Grok offers). Generate a batch and keep the best one to three.
2. **Harbours only:** attach the matching layout reference from `art/sources/references/harbours/` (made by
   `node tools/art/composite_harbours.ts`). It fixes the horizon, quay, fort, flagpole and anchorage.
   The game's clickable buildings, flag and moored ship are placed from `harbours.json`. A painting
   that keeps the reference layout keeps them lined up; one that moves things can't be used as-is.
3. **Prompt:** paste the **style block** below, then the scene's own prompt. Interiors and the title
   art take no reference image.
4. **Save** as described in the next section, and fill in a prompt record.

Don't generate night or dusk versions. The game's palette shader makes them from the day scene.

## Where to save

| What | Path | Example |
|---|---|---|
| Raw Grok output you keep | `art/sources/paintings/{group}/{id}.v{n}.png` | `art/sources/paintings/harbours/harbour.england.large.v1.png` |
| Prompt record, one per asset, next to its image | `art/sources/paintings/{group}/{id}.yaml` | `art/sources/paintings/harbours/harbour.england.large.yaml` |
| Layout references (made for you) | `art/sources/references/harbours/{id}.png` | `art/sources/references/harbours/harbour.england.large.png` |

Groups: `harbours`, `interiors`, `title`, `ui` (the ship panel), and for scenes not built yet `duels`, `dance`, `fates`. Keep the file name exactly as the id in each section,
because the import step finds images by id. Don't edit or crop the raw output.

**Import:** `node tools/art/import_paintings.ts` snaps the version each record lists first under
`kept` to 960×540 on the game palette (`art/palette/corsair.gpl`), writing
`art/game/scenes/{id}.png` (harbours also get `{id}.sea.f00`–`f03` shimmer frames). Add `--review <dir>` to also write each harbour with its
`harbours.json` hotspots, flag point and anchorage drawn on, to check the layout held. The game uses a
painted harbour in place of the Blender layers whenever one exists.

Prompt record (the art pipeline, section 9, requires one for every AI-assisted asset):

```yaml
id: harbour.england.large
tool: Grok Imagine
model: Image 2.0          # as shown in the app
plan: SuperGrok           # or API, free, etc.
date: 2026-10-05
reference: art/sources/references/harbours/harbour.england.large.png
prompt: |
  (style block + scene prompt, exactly as sent)
seed: ""                  # if Grok shows one
kept: [v1]
hand_changes: ""          # filled in after the pixel pass
```

## Style block (paste first, every time)

> Pixel art game background, 16:9, seen from the sea looking at a Caribbean port in the 1660s. Crisp
> hard-edged pixels, flat colour areas with a little hand-placed dithering, no anti-aliasing, no blur,
> no gradients across large areas, no film grain, no bloom. A limited palette of about 40 colours:
> deep navy and teal sea blues, jungle and palm greens, sand and ochre, terracotta and brick reds,
> weathered wood browns, warm greys for stone, pale cream for plaster. Soft even midday light from the
> upper left, gentle shadows. Calm, inviting, adventurous mood. Painterly detail in the buildings and
> foliage, readable at small size. No text, no letters, no signs with writing, no logos, no watermark,
> no UI, no frame or border, no people in close-up.

## Harbours

Every harbour prompt adds this **layout block** after the style block:

> Keep the composition of the attached reference image exactly: same horizon height, same quay line,
> same positions for the town, the fort and the flagpole, same open water in the bottom third. The
> flagpole stays bare: no flag. Leave the open water in the lower middle and lower right empty: no
> ships, no boats, no reflections of ships there (the game draws the player's ship at anchor).
> Repaint everything in the style described, with far richer detail than the reference.

Then the scene prompt. Tiers: **small** is a hamlet with a timber jetty and no fort; **medium** is a
town with a stone quay, warehouse, church and small fort; **large** is a capital with walls, a
governor's mansion and a big fort keep.

### Spain

**`harbour.spain.small`** (reference `harbour.spain.small.png`)
> A small Spanish colonial fishing village: half a dozen whitewashed adobe houses with terracotta tile
> roofs, a tiny chapel with a bell gable, a thatched boat shed, nets drying on poles, a rough timber
> jetty, palms and dense green jungle behind, blue mountains in the distance.

**`harbour.spain.medium`**
> A Spanish colonial harbour town: cream and ochre stucco houses with terracotta tile roofs and wooden
> balconies, a whitewashed church with a square bell tower, an arcaded warehouse on the stone quay,
> barrels, crates and sacks on the quay, a low stone fort with bastions on the right, palms, jungle
> hills and blue mountains behind.

**`harbour.spain.large`**
> A rich Spanish colonial capital: tiers of cream, ochre and white stucco houses with terracotta roofs
> climbing the hill, a large baroque church with twin bell towers, a governor's palace with an arcaded
> front and a red tiled roof, city walls of pale stone, a massive stone castillo with a tall keep and
> bastions on the right, a busy stone quay with cargo, palms and green mountains behind.

### England

**`harbour.england.small`**
> A small English colonial settlement: a few timber-framed and weatherboarded cottages with grey
> shingle roofs, a small trading house, a wooden boat shed, a rough timber jetty, a cleared green
> field with a fence, palms and jungle behind, blue mountains in the distance.

**`harbour.england.medium`**
> An English colonial port town: red brick and timber merchant houses with grey slate and shingle
> roofs, a stone church with a squat square tower, a large timber warehouse on the stone quay with
> barrels and crates, a low stone and earth fort with cannon on the right, palms and green hills
> behind.

**`harbour.england.large`**
> A wealthy English colonial capital in the style of 1660s Port Royal: crowded red brick merchant
> houses and taverns of two and three storeys with grey slate roofs, a stone church with a tall square
> tower, a governor's house with a classical pediment, a busy stone quay with cargo, cranes and
> warehouses, a large stone fort with a tall keep and gun batteries on the right, green mountains
> behind.

### France

**`harbour.france.small`**
> A small French colonial settlement: a few timber Creole cottages with wooden shutters, deep porches
> and red-brown hip roofs, a small mission chapel with a wooden steeple, a boat shed, a rough timber
> jetty, palms and jungle behind, blue mountains in the distance.

**`harbour.france.medium`**
> A French colonial port town: pale plaster and timber Creole houses with wooden galleries, tall
> shutters and red-brown and slate-blue hip roofs, a church with a slender spire, a stone warehouse on
> the quay with barrels of rum and sugar, a low stone fort on the right, palms and green hills behind.

**`harbour.france.large`**
> A prosperous French colonial capital: terraces of pale limestone and plaster houses with wrought-iron
> balconies and steep slate-blue roofs, a large church with a tall spire, a governor's residence with a
> formal stone front, city walls, a big stone citadel with a tall keep on the right, a busy quay with
> cargo, palms and green mountains behind.

### Netherlands

**`harbour.netherlands.small`**
> A small Dutch colonial trading post: a few narrow brick houses with stepped gables in red and ochre
> brick, a timber trading house, a small windmill on the field, a rough timber jetty, palms and jungle
> behind, blue mountains in the distance.

**`harbour.netherlands.medium`**
> A Dutch colonial port town: rows of narrow brick canal-style houses with stepped and bell gables in
> red, ochre and brown brick with white trim, a brick church with a pointed spire, a large brick
> warehouse with a hoisting beam on the quay, a low brick fort on the right, palms and green hills
> behind.

**`harbour.netherlands.large`**
> A wealthy Dutch colonial capital: dense rows of tall stepped-gable and bell-gable brick merchant
> houses in red, ochre and brown with white window frames, a big brick church with a tall spire, a
> governor's house with a classical gable, brick city walls, a large brick and stone fort with a tall
> keep on the right, a busy quay with warehouses and cranes, palms and green mountains behind.

### Pirate haven

**`harbour.pirate.haven`** (reference `harbour.pirate.haven.png`)
> A lawless pirate haven on a jungle island: a beach of golden sand, a ramshackle two-storey timber
> tavern with a patched roof, lean-to huts and tents of sailcloth, a ship's hull careened on the beach
> for repairs, a rickety jetty, a gallows, a wooden stockade of sharpened logs on the right with a tall
> timber lookout tower, palms and dark jungle behind. Rough, salty and dangerous, but lively.

## Service interiors

These go behind the service panels. The panel covers the middle of the picture, so keep the centre
calm and fairly dark and put the detail at the left and right edges. Use the style block with its first
sentence replaced by: *"Pixel art game background, 16:9, an interior scene in the Caribbean in the
1660s."* Save as `art/sources/paintings/interiors/{id}.v{n}.png`.

**`interior.tavern`**
> A colonial harbour tavern: low smoke-dark timber beams, lanterns and candlelight, a long bar with
> barrels and bottles on the left, rough tables and benches, a fireplace on the right, a ship's wheel
> and a fishing net on the wall, small sailors drinking and talking in the background, warm orange
> light against deep brown shadows.

**`interior.tavern.pirate`**
> A pirate haven tavern: a ramshackle timber hall open to the night through a broken wall, rum casks,
> hammocks, a captured ship's figurehead, a black flag nailed to a beam, rough crowd of small pirates
> gambling and drinking in the background, lantern light.

**`interior.merchant`**
> A merchant's counting house: a heavy wooden counter with scales and ledgers on the left, sacks of
> sugar, bales of cotton and tobacco, barrels and crates stacked to the rafters on the right, a big
> window onto the bright harbour, dust in the light.

**`interior.governor`**
> A colonial governor's office: tall shuttered windows onto palms, a large carved desk with maps and a
> quill, a painted portrait on the wall (face not visible), a nation-neutral coat of arms without any
> letters, a chandelier, heavy curtains, polished wooden floor.

**`interior.shipwright`**
> A shipwright's yard under a timber shed roof: a ship's hull in frames on the slipway on the left,
> stacked timber, ropes, pitch pots and tools, a sail loft on the right, the bright harbour seen
> through the open end.

## Title art

**`title.main`** (save as `art/sources/paintings/title/title.main.v{n}.png`)
> Pixel art game title background, 16:9: a two-masted brig under full sail on a deep blue Caribbean sea
> at golden late afternoon, a green island with palms and a distant port on the right, gulls, big
> white clouds. Keep the top third mostly open sky for the game's title. No text, no letters, no logo.

## Next scenes (not built yet)

Backgrounds for scenes that are planned but not built yet (`docs/project-corsair-scenes.md`). Paint
them ahead so the art is ready when the scene is. Same style block as above, with its first sentence
replaced as each group says. None has a layout reference yet, so each prompt spells out where the game
will draw on top of it. Save as `art/sources/paintings/{group}/{id}.v{n}.png` with a prompt record beside
it, as before.

### Boarding duel decks (scene S5): group `duels`

The captains fence across the deck in side view; crews brawl behind them. First sentence: *"Pixel art
game background, 16:9, a side view across the deck of a 1660s sailing ship at sea."* Then this layout
block, then the deck prompt:

> Side view, the camera level with the deck, looking across it to the far rail and the open sea. The
> deck planks run the full width along the bottom third; keep the middle band of the picture (from the
> planks up to about two-thirds of the height) clear of anything taller than a barrel, because two
> fighters and their crews will stand there. The near rail runs along the very bottom edge. A mast
> rises at the left or right edge, not in the middle. Sky and sea above the far rail. Midday light.

**`duel.bg.sloop`**
> A small, low single-masted sloop: a short deck, the boom swung out overhead, coiled lines, a few
> small guns, a tiller at the stern, the rail low to the water.

**`duel.bg.merchant`**
> A broad-beamed merchant fluyt: a wide deck with cargo hatches, barrels and crates lashed down, a ship's
> boat on the skids, the high rounded stern rising at one edge.

**`duel.bg.brig`**
> A two-masted brig: a clean flush deck, guns run out along the far rail, the mainmast and its shrouds
> at one edge, a capstan, a hatch grating.

**`duel.bg.heavy`**
> A great warship, frigate or galleon: a broad deck with a double row of guns, tall masts and heavy
> rigging, a raised quarterdeck with a carved rail at one edge, an ensign staff.

### Commander duel courtyard (scene S7): group `duels`

**`duel.bg.courtyard`** (first sentence: *"Pixel art game background, 16:9, a side view inside a
colonial Caribbean fort in the 1660s."*)
> A fort courtyard in side view: worn flagstones along the bottom third, the stone rampart across the
> back with cannon embrasures, a heavy timber gate at one side, a watchtower at the other, palm tops and
> blue sky over the wall. Keep the middle band clear for fighters. The flagpole is bare (the game flies
> the owner's flag).

### Ballroom (scene S11): group `dance`

**`dance.bg.ballroom`** (first sentence: *"Pixel art game background, 16:9, the ballroom of a
colonial governor's mansion in the 1660s, evening."*)
> A candlelit ballroom: a polished wooden or tiled floor across the lower half, a great chandelier, tall
> windows onto a dark garden and palms, a small band of musicians on a dais at the back, guests in
> period dress standing along the walls in small groups. Keep the centre of the floor empty and well
> lit: the player and partner dance there. Warm candle colours against cool night blues.

### Retirement fate cards (scene S14): group `fates`

Small 4:3 vignettes (the game shows them at 240×180 beside the captain's portrait), so keep each to one
clear subject and few details. Generate them at 4:3. The import step only makes 960×540 frames today;
it will learn the 240×180 card size when the retirement scene is built, so save and record them but
don't import them yet. First sentence: *"Pixel art vignette, 4:3, a simple scene in a 1660s
Caribbean port."* No people in them: the portrait stands beside the card.

**`fate.beggar`**
> A shabby street corner: a crumbling plaster wall, a broken barrel, a tin cup on the cobbles, a
> torn awning, evening shadow.

**`fate.captain`**
> A ship's rail at sea: the polished rail, a brass telescope resting on it, coiled rope, the open
> sea and a horizon at golden hour.

**`fate.merchant`**
> A warehouse door on a busy quay: a stout timber door with iron hinges, sacks and barrels stacked
> beside it, a hanging lantern, a ledger on a crate.

**`fate.governor`**
> The door of a fine colonial mansion: carved stone doorway, a coat of arms above it without any
> letters, potted palms, marble steps, warm light from within.

### More port services (planned): group `interiors`

Same rules as the service interiors above: calm, dark centre; detail at the edges.

**`interior.bank`**
> A money-lender's counting room: a heavy iron-bound strongbox and a scale for coin on a long table,
> ledgers on shelves, a barred window, a guard's halberd leaning in the corner, candlelight.

**`interior.surgeon`**
> A barber-surgeon's room: a sturdy chair with straps, a table of instruments and bottles, bandages
> drying on a line, a shuttered window letting in a bar of light, herbs hanging from a beam.

## Ship panel art (UI): group `ui`

The ship panel (bottom left, at sea and in battle) shows the player's ship with her state, a row of cannon
per broadside, and clickable mode buttons. Grok can't give a transparent background, so every UI prompt
asks for a flat magenta one. **Import:** `node tools/art/import_ui.ts` reads each record's kept version,
keys out the background (its colour and tolerance taken from the image's own corners, since it comes
back a wobbling hot pink rather than exact #FF00FF), crops to the object, shrinks it (portraits and the
frame to fit 96×64, icons 24×24) and snaps it to the palette, writing `art/game/ui/{id}.png`.

**UI style block** (paste first for every UI prompt, in place of the scene style block):

> Pixel art game sprite, a single object centred on a perfectly flat solid magenta background (#FF00FF)
> that fills everything around it, with no shadow, glow or texture on the background. Crisp hard-edged
> pixels, flat colour areas, a clean dark outline one pixel wide, no anti-aliasing, no blur, no
> gradients, no film grain. A limited palette: weathered wood browns, warm canvas cream, brass and gold,
> iron greys and black, sea blues, a touch of brick red. Lit softly from the upper left. Bold, simple
> shapes that read at small size. No text, no letters, no numbers, no logos, no watermark, no frame.

**Ship portraits** (3:2, the ship in side view facing right, filling about 80% of the width, sails set
full, no sea under her, no flag on any mast; the game draws flags):

- **`ui.ship.brig`**
  > A two-masted square-rigged brig of the 1660s, side view: black and ochre hull with a row of gun ports,
  > square sails on both masts, a jib, a modest stern castle.
- **`ui.ship.sloop`**
  > A single-masted gaff-rigged sloop of the 1660s, side view: low dark hull with a few gun ports, one
  > big fore-and-aft mainsail and a jib, a long bowsprit.
- **`ui.ship.fluyt`**
  > A three-masted Dutch fluyt of the 1660s, side view: round-bellied merchant hull narrowing to a high
  > pear-shaped stern, few gun ports, square sails.
- **`ui.ship.frigate`**
  > A three-masted frigate of the 1660s, side view: long hull with two rows of gun ports, tall square
  > sails on all three masts, a carved stern.

**Icons** (1:1, one icon per image, the object filling about 70% of the frame):

| id | prompt |
|---|---|
| `ui.icon.round_shot` | A single black iron cannonball with a small highlight. |
| `ui.icon.chain_shot` | Two small iron cannonballs joined by a short chain. |
| `ui.icon.grape_shot` | A canvas bag of small iron balls tied with twine, a few balls showing. |
| `ui.icon.full_sail` | A square sail fully set and bellied by the wind, on its yard. |
| `ui.icon.half_sail` | A square sail half furled on its yard, the lower half gathered up. |
| `ui.icon.cannon_loaded` | A small ship's cannon on its wooden carriage, side view, a wisp of slow match at the touch-hole. |
| `ui.icon.cannon_empty` | The same small cannon on its carriage, side view, cold and dark. |
| `ui.icon.crew` | A sailor's head in a knotted red kerchief, three-quarter view, plain features. |
| `ui.icon.hull` | Three overlapping wooden hull planks with iron nails. |
| `ui.icon.fire` | A puff of white cannon smoke with a flash of orange at its heart. |
| `ui.icon.anchor` | An iron ship's anchor with a ring and a coil of rope. |
| `ui.icon.course` | A brass compass rose with a north pointer. |
| `ui.icon.intercept` | A brass spyglass, extended, angled up to the right. |

**Panel frame** (3:2):

- **`ui.panel.frame`**
  > A rectangular frame of dark weathered ship's timber with brass corner fittings and brass nail heads
  > along the edges, the inside a plain flat very dark navy panel with nothing on it. Plain straight edges
  > between the corners, so the frame can be stretched.

## What not to ask for

- No names of other games, studios or artists in any prompt, and no "in the style of" anyone (the
  PRD's IP stance).
- No flags on any pole: the game draws them, so a captured town can change owner.
- No ships in the anchorage, and no people in close-up (portraits are a separate kit).
- No text anywhere, including shop signs and banners.

Before anything from Grok ships, add Grok Imagine to the tools table in the art pipeline (section 9)
with its commercial terms from xAI's current terms of service, and keep Steam's AI disclosure in mind.
