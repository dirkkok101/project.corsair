# Project Corsair — Scenes and assets

2026-10-03 · Dirk Kok · Status: draft, planning stage

Companion to `docs/project-corsair-prd.md` (sections 3, 5, 7, 9, 11) and `docs/project-corsair-art-pipeline.md` (sections 2, 3, 11). The pipeline says how a sprite is made and checked. This doc says which scene draws it.

The four views from the games this project follows are the spine.

- **Ocean navigation** is top-down. The player steers the flagship on a scrolling tile map. Time passes only here.
- **Fighting at sea** stays top-down, on a local patch of that same map, with larger ship sprites. It is a sailing battle, not a side-on broadside screen.
- **Boarding** cuts to a side-view sword fight on the deck. Crews brawl in the background. The same fight is reused for a mutiny and for a rival suitor.
- **Sacking a town** is a top-down battle of army units on the ground outside the fort, then the same sword fight against the commander.
- **The ballroom dance** from the later game is its own scene.

The PRD also needs a layered harbour, service panels, a night stealth entry, a sea chart, a treasure journal, and the career-start and retirement screens. Those are specified below.

## 1. Rules for this list

- **Logical picture** is 960×540, integer-scaled, nearest neighbour: 2× at 1080p, 4× at 4K, 2× with borders at 1440p. Every scene is composed for that frame. It was 480×270; the player wanted to see more of the world without losing pixel fidelity, and chose finer art over a smaller view. Every pixel size in this doc grew 1.5× to match.
- **One palette.** Day, dusk and night are rows in the palette shader. Scenes are not repainted for night.
- **Outlines.** 1 px dark outline on ships, characters and units. No outline on tiles, clouds, water, or harbour backgrounds.
- **Alpha.** 0 or 255, except the VFX atlas.
- **Ids** follow `{kind}.{subject}.{variant}.{anim}.{facing}`. World-map ships use `f00`–`f31` from north, clockwise, 11.25° steps; combat ships use `f00`–`f15`, 22.5° steps. Top-down people and units use `n`, `e`, `s`, `w`.
- **A unit sprite is a body of troops**, about three figures inside a 48×48 cell, so the land battle reads as armies. Cavalry is one horse and rider in that same cell.
- **Greybox first.** Every id in this doc exists as a flat rect before any final art. A missing id fails `art:validate`.
- **Frame budgets** match the art pipeline (about 2,300 to 2,500 hand-touched frames). This doc assigns those frames to scenes. It does not raise the budget.
- **Land-battle rules** stay the PRD's turn-based fight. The camera is top-down with 4 facings either way, including if that fight later becomes real-time with pause.

## 2. Scene index

| Id | Scene | Camera | Cell | Entered from | Milestone |
|---|---|---|---|---|---|
| S1 | World map | Top-down | 24 px tiles, ships 96 | Career start, and the return from every minigame | M1 |
| S2 | Sea chart | Top-down, UI frame | Same map, redrawn | World map | M1 |
| S3 | Sea battle | Top-down, local | Ships 192 | Hail or attack at sea | M2 |
| S4 | Sea assault | Top-down, local | Ships 192, fort tiles 24 | Attack a fortified town from the sea | M4 |
| S5 | Deck duel | Side view | Fighters 96 | Boarding, mutiny, rival | M2 |
| S6 | Land assault | Top-down | Units 48, tiles 24 | March the crew ashore | M4 |
| S7 | Commander duel | Side view | Same fighters as S5 | Gate falls in S4 or S6 | M2 rig, M4 backdrop |
| S8 | Harbour | Layered still | 960×540 pieces | Enter a friendly or captured town | M1 basic, M3 all nations |
| S9 | Service panels | UI over S8 | Portraits 96×120, icons 24 | Click a building | M1 goods, M4 portraits |
| S10 | Stealth entry | Top-down streets | Actors 24 or 36 | Hostile town at night | M4 |
| S11 | Dance | Ballroom, three-quarter | Dancers 96 | Governor's ball | M4 |
| S12 | Ashore on the world map | Top-down, mode of S1 | Party 24 or 36 | Land on a beach | M4 |
| S13 | Treasure journal | UI parchment | Icons 24 and 48 | Logbook | M4 |
| S14 | Career start and retirement | UI plus a few portraits | Portrait kit | New career, retire at a port | M4 portraits, M5 fates |

Hand-off:

```
S14 start → S1 ocean
S1 → S3 sea battle → S5 deck duel → S1
S1 → S4 sea assault → S7 commander duel → S8 or S1
S1 → S12 march → S6 land assault → S7 → S8 or S1
S1 → S8 harbour → S9 panels, S11 dance, or S10 stealth
S1 ↔ S2 chart, S13 journal
S1 → S14 retirement
```

## 3. Shared pieces

These are drawn once and used by several scenes.

| Piece | Id pattern | Size | Scenes | Notes |
|---|---|---|---|---|
| Palette | `art/palette/corsair.gpl` | 32–48 colours plus a night row | All | Apollo is the trial palette. Lantern and fire colours keep their day values. |
| Nation tint | palette ramps | — | Ships, flags, coats, portraits | Spain, England, France, Netherlands, pirate. Not extra sprites. |
| Flags | `ui.flag.{nation}` | 12×12 | S1, S3, S8, S9 | 7 flags: 4 nations, pirate, church, native. |
| Goods and tools | `ui.icon.*` | 24×24 | S1 HUD, S9 | About 40. See S9. |
| VFX | `vfx.{name}.{frame}` | mixed, VFX atlas | S1, S3, S4, S5, S6 | About 36 frames. Listed under the scene that needs them. |
| Portrait kit | `portrait.{part}.{variant}` | 96×96 face on a 96×120 card | S5 HUD, S7, S9, S11, S14 | About 60 parts. Layer order is in the art pipeline, section 7. |

Portrait part counts, summing to 60:

| Part | Variants |
|---|---|
| Back hair | 6 |
| Body and clothing | 8 |
| Head | 4 |
| Eyes | 6 |
| Mouth | 4 |
| Makeup | 4 |
| Beard | 6 |
| Moustache | 4 |
| Accessories | 6 |
| Front hair | 6 |
| Hat | 6 |

The same NPC always gets the same parts from the character seed. The HUD portrait is the 96×96 face cropped off the card.

## 4. S1 — World map (ocean navigation)

Top-down. The frame scrolls. The flagship is steered with keyboard, mouse or touch. The fleet follows. This is the only scene where world time runs.

### Terrain

One 24×24 dual-grid set per layer (15 corners plus empty), drawn over transparency and stacked by priority. Edges do not animate. Only the open-water fill tile loops, so the coast set stays at the pipeline's ~150 tiles.

Until this set exists, the renderer paints terrain procedurally from the palette. Coasts are smooth contours blended between tile centres, and relief is shaded from elevation. Collision stays on the tile grid. The map has deep, shallow, beach, jungle, hills and mountain so far; reef, swamp and river are not built yet.

| Layer | Id | Tiles | Animation | Reads as |
|---|---|---|---|---|
| Deep water | `terrain.deep` | 16 | Fill tile, 4 frames | Open ocean. All ships. |
| Shallows | `terrain.shallow` | 16 | Fill tile, 4 frames | Pale water. Draft 1–2 only. |
| Reef | `terrain.reef` | 16 | Static | Dark rock under water. |
| Beach | `terrain.beach` | 16 | Static | Landfall. |
| Swamp | `terrain.swamp` | 16 | Static | Fever ground. |
| Jungle | `terrain.jungle` | 16 | Static | Slow march. |
| Hills | `terrain.hills` | 16 | Static | |
| Mountain | `terrain.mountain` | 16 | Static | Impassable. |
| River | `terrain.river` | ~16 edge tiles | Static | Draft 1, inland to a feature node. |

Added on top of that set, about 20 sprites:

| Piece | Id | Cell | Frames | Notes |
|---|---|---|---|---|
| Wake, small | `fx.wake.small` | 48×24 | 4 | Draft 1–2, drawn astern. No outline. |
| Wake, large | `fx.wake.large` | 48×24 | 4 | Draft 3. |
| Cloud | `sky.cloud.{a,b,c,d}` | 72×36 | 1 each | Four shapes. Drift in code. No outline. |
| Storm | `sky.storm` | 96×96 | 4 | The moving storm object. Gameplay radius is data, not the sprite. |
| Rain | `vfx.rain` | 48×48 | 4 | Drawn inside the storm. VFX atlas. |

Fog of war is a runtime mask, not art. It is deferred: the whole map is visible for now. The day/night tint is the palette shader. Sight radius shrinking at night does not need a new sprite.

### Ships

Twelve classes, four families. World cell is 96×96, pivot at the hull centre on the waterline, 32 facings, drawn from a 45° orthographic camera over the top-down map (art pipeline, section 4), three sail states (`sail_full`, `sail_half`, `sail_furled`). Set sails are drawn per point of sail (the `id`s in `navigation.json`) and tack, so the wind shows as sail angle and shape, not just colour: yards braced round to meet the wind (square when running, about 20° on a broad reach, 35° on a beam reach, 45° close-hauled), canvas bellied downwind, jib and spanker swung to leeward. In irons the canvas is slack and grey, with two frames that flap. The world set per class is `sail_furled`, `sail_{full,half}_run`, `sail_{full,half}_{broad,beam,close}_{p,s}` and `sail_{full,half}_irons_{p,s}{0,1}`: 23 sprites. `_p` is wind from port, `_s` from starboard. The flag is a few pixels on the sprite, tinted by nation. It is not its own facing set.

| Class | Family | Id subject | M1 |
|---|---|---|---|
| Sloop | Sloop | `ship.sloop.world` | Greybox |
| War sloop | Sloop | `ship.war_sloop.world` | Greybox |
| Royal sloop | Sloop | `ship.royal_sloop.world` | Draw |
| Barque | Merchant | `ship.barque.world` | Greybox |
| Fluyt | Merchant | `ship.fluyt.world` | Draw |
| Merchantman | Merchant | `ship.merchantman.world` | Greybox |
| Brigantine | Brig | `ship.brigantine.world` | Greybox |
| Brig | Brig | `ship.brig.world` | Draw (M0 spike) |
| Frigate | Frigate | `ship.frigate.world` | Draw |
| Ship of the line | Frigate | `ship.sol.world` | Greybox |
| Galleon | Galleon | `ship.galleon.world` | Greybox |
| Treasure galleon | Galleon | `ship.treasure_galleon.world` | Greybox |

Example id: `ship.brig.world.sail_full.f03`.

M1 draws 4 classes (royal sloop, fluyt, brig, frigate), one per family, so the map can show a fast ship, a merchant, a brig and a warship. The other eight stay grey boxes until M3. Full set is 12 × 32 × 23 = 8,832 frames, matching the pipeline. Port-tack frames are mirrors of starboard-tack frames, which roughly halves the 96 px hand pass.

Damage is not drawn on the world map. A worn hull uses the `sail_furled` pose plus a darker palette row if needed. Sinking in a storm is the storm sprite plus the ship fading, not a bespoke animation.

### Settlements and markers

World-map settlement sprites are single cells, not the harbour illustration. About 26, as in the pipeline.

| Sprite | Id | Cell | Count | When |
|---|---|---|---|---|
| Colonial town, 3 sizes | `settlement.{spain,england,france,netherlands}.{hamlet,town,city}` | 96×96 | 12 | M1, all 12 rendered |
| Pirate haven | `settlement.pirate.haven` | 96×96 | 1 | M1, rendered |
| Jesuit mission | `settlement.church.mission` | 96×96 | 1 | M3 |
| Native village | `settlement.native.village` | 96×96 | 1 | M3 |
| Lost city | `settlement.lost.city` | 96×96 | 1 | M4, hidden until found |
| Fort pip | drawn in the settlement sprite | — | — | A gun platform on town and city only |

The 13 colonial and pirate sprites are rendered from low-poly Blender models with the same locked 45° camera as the ships (`tools/art/render_towns.py`, output in `art/generated/settlements/`). Nation variants of a size share geometry; only roof colour and flag change.

On the map, the 34 historical settlements of c.1660 come from `settlements.json` by longitude and latitude. Each snaps to the nearest coastal tile at load; one more than 3 tiles from the coast fails validation.

| Marker | Id | Cell | Notes |
|---|---|---|---|
| Last-known ship | `marker.last_known` | 24×24 | Fades in code. |
| Treasure landmark | `marker.landmark.{tree,rock,wreck,hut}` | 24×24 | Also used on the parchment in S13. |
| Fleet route | `marker.route` | 12×12 | Dotted in the chart as well. |
| Player fleet pip | `marker.player` | 12×12 | Minimap only. |

### HUD on the world map

UI over the canvas. Icons are 24×24 unless noted.

- Wind arrow: one sprite, `ui.wind.arrow` (24×24), rotated in code to 16 headings. Strength is a number, not a second sprite.
- Food, morale, gold, date, pause, speed (1×, 2×, 4×).
- Minimap in a corner window, about 240 × 135 tiles around the ship. The sea chart (S2) shows the whole map. Both draw from a one-pixel-per-tile overview of the map, not new art. Fog of war is deferred, so every tile shows.
- Logbook button. The logbook itself is a text panel.

### Greybox that proves S1

A 960×540 composite: deep-water fill, one beach corner, four cloud shapes, the brig in `sail_full` at f00 and f04, one town sprite, the storm. Judge at 1× and at 4×. This is the M0 picture. The other 15 brig facings join it as soon as the Blender spike exists.

## 5. S2 — Sea chart

The same map, drawn in a parchment frame, with fog remembered. No new terrain and no ships sailing. Opened with the M key. Built so far: the whole map from the one-pixel-per-tile overview, with every port marked.

| Piece | Id | Notes |
|---|---|---|
| Parchment frame | `ui.parchment.frame` | 960×540 chrome, the map sits inside. Reused by S13. |
| Town marker | the S1 settlement sprite, or a 12×12 dot if the sprite will not fit | Price and owner are text. |
| Route line | `marker.route` | |
| Treasure note | `marker.landmark.*` | |
| Compass rose | `ui.compass` | 48×48, decorative. |

## 6. S3 — Sea battle

Top-down, like the ocean, cropped to the local tiles the fight started on (coast, shallows, reef included). Wind carries over. The player steers the flagship only. Ships are the 192×192 combat set: same 12 classes, 16 facings, 3 sail states. Render that size directly. Do not scale the 96 px world sprites up to make the battle frames. A nearest-neighbour integer upscale is for display only.

M2 draws combat sprites for 4 classes, the same four as M1. The rest stay grey boxes.

| Piece | Id | Cell | Frames | Notes |
|---|---|---|---|---|
| Combat hull | `ship.{class}.combat.sail_{state}.f{00-15}` | 192×192 | 576 full set | Pivot at hull centre. |
| Damage overlay | `ship.damage.{family}.t{1,2,3}.f{00-15}` | 192×192 | 192 | 4 families × 3 tiers × 16 facings. Families: sloop, merchant, brig, heavy. Frigate, ship of the line and both galleons share `heavy`. |
| Muzzle smoke | `vfx.broadside` | 48×48 | 4 | Port and starboard are the same sprite, flipped. |
| Splash | `vfx.splash` | 24×24 | 4 | Missed shot. |
| Hull hit | `vfx.splinter` | 24×24 | 4 | |
| Sail hit | `vfx.sail_rip` | 24×24 | 2 | |
| Fire | `vfx.fire` | 24×24 | 4 | Critical. |
| Explosion | `vfx.explosion` | 48×48 | 4 | Magazine. |
| Sinking | — | — | 0 | In-engine tilt plus a water mask. |

HUD: hull, sails, crew, ammo (round, chain, grape as three 24×24 icons), reload pips. Wind arrow reused from S1.

Boarding starts when the hulls touch. The scene then cuts to S5. There is no side-view broadside painting.

## 7. S4 — Sea assault on a fort

Same camera and ship art as S3. The fort is a tiled layout on the coast (star fort, coastal battery, or hill fort), one template per fort level.

| Piece | Id | Cell | Notes |
|---|---|---|---|
| Wall run | `fort.wall.straight` | 24×24 | Top-down stone. |
| Wall corner | `fort.wall.corner` | 24×24 | |
| Gate | `fort.gate` | 24×24 | Sea assault does not storm it. Land assault does. |
| Rubble | `fort.rubble` | 24×24 | A silenced gun position. |
| Gun | `fort.gun.f{n,e,s,w}` | 24×24 | 4 facings. Arc and range are data. |
| Chain or boom | `fort.chain` | 48×24 | Level 3+. Blocks the channel until the covering gun is rubble. |
| Dock | `fort.dock` | 48×24 | Touching it starts the commander duel. |

Smoke reuses `vfx.broadside` and `vfx.explosion`. The garrison is not drawn man-by-man in this scene. They appear as the crew behind the commander in S7.

## 8. S5 — Deck duel (boarding)

Side view. The deck occupies the lower part of the 960×540 frame. Sea and the enemy hull sit behind it. Two captains fight. A large crew advantage is a slow push toward one rail, done by sliding the sprites, not by new frames. Falling off the ship is one animation.

This scene also covers the mutiny duel and the rival-suitor duel. Same rig, different portrait and, for the suitor, the option to use the courtyard backdrop from S7.

### Backdrops (paint once, 960×540)

| Backdrop | Id | Used by |
|---|---|---|
| Sloop deck | `duel.bg.sloop` | Sloop family |
| Merchant deck | `duel.bg.merchant` | Merchant family |
| Brig deck | `duel.bg.brig` | Brig family. M2. |
| Heavy deck | `duel.bg.heavy` | Frigate and galleon |

Each backdrop is layered: sky and sea, far hull, deck planks, rail, mast. The rail is a separate sprite so a fighter can pass behind it when shoved.

### Fighters

Cell 96×96. Pivot at the feet. The body is one set of frames. Weapons and costumes are layers on those frames, not new body animations.

About 14 body animations, ~90 frames (the pipeline number):

| Animation | Id suffix | About | Phase tags |
|---|---|---|---|
| Idle | `idle` | 4 | — |
| Advance | `advance` | 6 | — |
| Retreat | `retreat` | 6 | — |
| Attack high | `attack_high` | 8 | wind-up, active, recovery |
| Attack mid | `attack_mid` | 8 | wind-up, active, recovery |
| Attack low | `attack_low` | 8 | wind-up, active, recovery |
| Parry high | `parry_high` | 6 | wind-up, active, recovery |
| Parry mid | `parry_mid` | 6 | wind-up, active, recovery |
| Parry low | `parry_low` | 6 | wind-up, active, recovery |
| Dodge | `dodge` | 6 | wind-up, active, recovery |
| Hit | `hit` | 4 | — |
| Stumble | `stumble` | 6 | — |
| Fall off | `fall_off` | 8 | — |
| Victory | `victory` | 8 | — |

Tick lengths for the attack and parry frames come from `fencing_moves.json`.

| Layer | Id | Frames | Notes |
|---|---|---|---|
| Body | `duel.body.{anim}` | ~90 | M2. One male base. A second body is a costume problem, not a new skeleton, unless the M0 pose test says otherwise. |
| Weapon | `duel.weapon.{rapier,cutlass,longsword}.{anim}` | ~270 | 3 weapons × the body frames. Drawn over the hand. |
| Costume and head | `duel.costume.{archetype}.{anim}` | ~360 | 4 archetypes in M4. M2 ships 2. Further variety is a palette swap. |
| Crew loop | `duel.crew.{sailor,soldier}` | ~32 | Sailors on a deck. Soldiers are the S7 recolor, same poses if the silhouette works. |

HUD: two health strips, a crew-push bar, the cropped portrait of each captain.

VFX: `vfx.spark` (4 frames) on a successful hit.

M0 spike for this scene is one pose set (idle plus one attack) through the free path, snapped to the palette, standing on `duel.bg.brig`.

## 9. S6 — Land assault (town sacking)

Top-down. The frame shows the beach at the near edge, open ground, forest, hills or a river in the middle, and the fort gate at the far edge. The layout is generated from the world tiles around the town, plus the fort tiles from S4.

The player splits the crew into units. Each unit is one sprite. Native allies use the same unit rig.

### Units

48×48, 4 facings, pivot at the feet. Five actions. About 5 frames each gives the pipeline's ~700 in-game frames (7 × 5 × 4 × 5) and ~525 unique after mirroring east and west where the silhouette allows.

| Action | Id | Reads as |
|---|---|---|
| Hold | `hold` | Idle and "hold the line". |
| Move | `move` | March loop. |
| Fire | `fire` | Musket or bow. |
| Charge | `charge` | Melee lunge. Cavalry uses this as its main attack. |
| Death | `death` | Routed or killed. One facing is enough if the sprite collapses in place. |

| Unit | Id | Side | Silhouette |
|---|---|---|---|
| Musketeers | `unit.musketeer` | Player | Three coats, one musket raised. |
| Swordsmen | `unit.swordsman` | Player | Three blades. |
| Buccaneers | `unit.buccaneer` | Player | Looser hats, one long gun. |
| Native allies | `unit.native` | Player | Distinct headdress, bow or spear. |
| Soldiers | `unit.soldier` | Fort | Uniform coats. Nation tint. |
| Cavalry | `unit.cavalry` | Fort | One horse and rider. |
| Militia | `unit.militia` | Fort | Soldier palette swap plus a simpler hat, if that reads. Otherwise a seventh drawing. |

Selection ring, range band and flanking arrow are UI (`ui.unit.select`, `ui.unit.range`), not painted into the sprite.

Terrain cover uses the S1 jungle, hills and river tiles, plus a plain `terrain.open` 24×24 fill for the field in front of the fort. Dust on a charge is `vfx.dust` (4 frames).

The fight ends by reaching the gate or routing the garrison. The scene then cuts to S7.

## 10. S7 — Commander duel

The S5 rig. Backdrop `duel.bg.courtyard` (one 960×540 painting: rampart, gate, sky). Background people are `duel.crew.soldier`. The commander is a costume layer plus a portrait, not a new move set. Weapons stay the three already drawn.

Sea-assault victories use this backdrop too, so a sloop captain who reaches the dock fights the same way as a landing party.

## 11. S8 — Harbour

A still 960×540 illustration, built from swappable pieces so a captured town can change flag, roofs and fort without a new painting. No character outlines on these pieces. The sky is one band. The palette shader makes dusk and night.

M1 needs one English large harbour and enough shared pieces to drop a second nation in by recolor. M3 fills the nation kits.

Shared pieces, about 15:

| Piece | Id |
|---|---|
| Sky band | `harbour.sky` |
| Sea band, 4-frame shimmer | `harbour.sea` |
| Wharf | `harbour.wharf` |
| Posts and waterline | `harbour.posts` |
| Palm, crate, barrel, lamp, rowboat | `harbour.prop.{palm,crate,barrel,lamp,boat}` |
| Clouds | reuse `sky.cloud.*`, scaled in whole pixels |

Colonial kit, per nation (England, Spain, France, Netherlands), three size tiers (small, medium, large):

| Piece | Id |
|---|---|
| House row | `harbour.{nation}.{tier}.houses` |
| Warehouse | `harbour.{nation}.{tier}.warehouse` |
| Church or tower | `harbour.{nation}.{tier}.church` |
| Governor's house | `harbour.{nation}.{tier}.governor` |
| Fort facade | `harbour.{nation}.{tier}.fort` |
| Flag pole | the 12×12 flag, placed in code |
| City walls | `harbour.{nation}.large.walls` |

That kit is the bulk of the ~90 pieces. Hamlet shows the small tier and omits the fort. A capital shows the large tier plus walls.

One size each, no tier split:

| Place | Extra pieces |
|---|---|
| Pirate haven | Tavern front, black flag (the pirate flag), gallows, beached hull. 4 pieces. |
| Jesuit mission | Chapel, cross, two huts. 4 pieces. |
| Native village | Huts, canoe, fire. 3 pieces. |

Ships at anchor reuse the world-map ship sprite at 96 px, `sail_furled`, facing `f08` or `f24` so the bow points along the quay. No separate anchor drawing.

Clickable buildings are hotspots in data, not extra art.

## 12. S9 — Service panels

DOM panels over the harbour. Art is portraits, a few props, and the icon set.

| Service | Art it needs |
|---|---|
| Governor | Governor portrait card, daughter's or son's card, nation flag, letter-of-marque icon. |
| Tavern | One interior backdrop `ui.tavern` (240×180 is enough), rumour and map-seller use the portrait kit. |
| Merchant | Goods icons. |
| Shipwright | The 96 px combat ship, `sail_furled`, facing `f00`, plus upgrade icons. Repair is a number. |
| Bank | Strongbox icon. No portrait. |
| Barber-surgeon | Saw and bandage icons, plus the captain's portrait with a wound accessory. |

Goods and other 24×24 icons, toward the pipeline's ~40:

| Group | Icons |
|---|---|
| Goods | food, sugar, tobacco, hides, cotton, luxuries, silver, cannon |
| Ship | round shot, chain shot, grape, powder, copper, cotton sails, hammocks, scantlings, bronze gun |
| People | crew, morale, wound, medicine, bribe, ransom |
| Paper | letter of marque, map piece, rumour, title deed, pardon |
| Dance and romance | ring, necklace, flower, glove |

The rest of the 40 are reserved for HUD gaps found while building S1. Do not draw them speculatively.

## 13. S10 — Stealth entry

Top-down streets at night, inside a hostile town. Guard paths are data. Caught means jail, which is a text panel, not a scene.

| Piece | Id | Cell | Notes |
|---|---|---|---|
| Street tiles | `stealth.tile.{street,wall,door,crate,roof}` | 24×24 | A small set, about 12 tiles, not the world autotiles. |
| Player | `actor.player.walk.{n,e,s,w}` | 24×24, with a 36×36 trial | 4 frames × 4 facings. |
| Guard | `actor.guard.walk.{n,e,s,w}` | same | Same frame count. Lantern is pixels in the sprite. |
| Light disc | `stealth.light.{1,2,3}` | 48, 72, 96 | Dithered discs. Binary alpha. The night palette does the rest. |
| Alarm | `vfx.alarm` | 24×24 | 2 frames. |

On-foot party sprites for S12 share `actor.player`. The pipeline's ~50 unique frames cover stealth plus the party. Dig is listed under S12 and comes out of that same budget.

## 14. S11 — Dance

One ballroom, 960×540: `dance.bg.ballroom` (floor, chandelier, a governor and guests as part of the painting). Dancers are 96 px tall, three-quarter view, so a hand gesture reads at 1×. They do not reuse the duel attack set.

About 24 frames, matching the pipeline:

| Clip | Id | Frames |
|---|---|---|
| Player idle | `dance.player.idle` | 4 |
| Player step, 4 directions | `dance.player.step.{n,e,s,w}` | 8 (2 each) |
| Partner idle | `dance.partner.idle` | 4 |
| Partner gesture, 4 directions | `dance.partner.gesture.{n,e,s,w}` | 8 (2 each) |

The beat markers and the direction the player must match are UI (`ui.dance.pip`, `ui.dance.arrow`), not sprites. Miss and success are a flash on the pip plus the step animation.

Variety of partners is the portrait kit placed in a locket on the HUD, plus a palette swap of the partner's clothes. One painted partner body is enough.

## 15. S12 — Ashore on the world map

Not a new camera. The flagship anchors on a beach tile and a party sprite walks the S1 map.

| Piece | Id | Frames | Notes |
|---|---|---|---|
| Party walk | `actor.player.walk.*` | shared with S10 | 4 facings. |
| Dig | `actor.player.dig` | 4 | Plays at the dig site. |
| Anchor | `fx.anchor` | 1 | 24×24, drawn on the ship while the party is ashore. |

Fever, ambush and native meetings are event panels (text, plus a portrait or a unit sprite). They are not new scenes.

## 16. S13 — Treasure journal

The parchment frame from S2. A map is a crop of S1 terrain, so the coastline is the real tiles, not a painted island. Pieces are that crop with a torn mask done in code.

| Piece | Id | Cell | Notes |
|---|---|---|---|
| Landmark | `marker.landmark.{tree,rock,wreck,hut}` | 24×24 | Same sprites as on the world map, so the player can match them. |
| X | `marker.x` | 24×24 | On the final piece. |
| Torn edge | code | — | Not a sprite. |
| Ink stain | `ui.parchment.stain` | 48×48 | Optional, 2 variants. |

## 17. S14 — Career start and retirement

Career start is type, flags and the portrait kit. Six eras and four nations do not get paintings. The family backstory is text.

Retirement uses four fate cards. Each card is a portrait-kit arrangement plus a 240×180 prop backdrop, not a full-screen painting.

| Fate | Id | Prop |
|---|---|---|
| Beggar | `fate.beggar` | Street corner. |
| Captain | `fate.captain` | Deck rail. |
| Merchant | `fate.merchant` | Warehouse door. |
| Governor | `fate.governor` | Mansion door. |

The score table is UI. Ranks between beggar and governor use the nearest card.

## 18. Atlases

Packed output, one PNG plus JSON each. Ids above are the names inside the JSON.

| Atlas | Holds | First needed |
|---|---|---|
| `atlas-terrain` | S1 and S6 tiles, wakes, clouds, storm | M0 greybox, M1 art |
| `atlas-ships-world` | 96 px ships, settlement sprites, markers | M0 brig, M1 four classes |
| `atlas-ships-combat` | 192 px combat ships, damage overlays | M2 |
| `atlas-fort` | Walls, guns, chain, dock | M4 |
| `atlas-duel` | Bodies, weapons, costumes, crew, backdrops | M0 one pose, M2 playable |
| `atlas-units` | Land-battle units | M4 |
| `atlas-harbour` | Harbour pieces | M1 one town |
| `atlas-ui` | Icons, flags, parchment, HUD | M1 |
| `atlas-actors` | Stealth, party, dig, light discs | M4 |
| `atlas-dance` | Ballroom and dance clips | M4 |
| `atlas-portraits` | The 60 parts and four fate props | M4 |
| `atlas-vfx` | Smoke, splash, fire, sparks, dust, rain | M2 |

## 19. What to draw first

The first test is one picture of S1, then one pose of S5 on the brig deck. Nothing else is required to judge the pipeline.

1. Palette file and a greybox atlas that already contains every id in this doc as a labelled rect.
2. Brig, 16 facings, `sail_full`, at 96 and at 192, from Blender, snapped to the palette.
3. Deep-water fill (4 frames), one beach corner, four clouds, one storm frame.
4. Composite at 960×540. Look at it at 1× and at 4×.
5. One duel idle and one high attack on `duel.bg.brig`, same palette.

If the masts read at 1× next to the water, script `art:snap` and `art:validate` around those files. If they do not, change the ship cell before drawing the other eleven classes.

## 20. Choices still open

- World-map sail states: settled. `sail_half` reads at 96 px (courses furled, topsails set), so the world map keeps all three, each drawn per point of sail and tack.
- Militia as a seventh drawing, or a soldier recolor. Decide when the soldier sprite exists.
- Stealth actors at 24 or at 36. Draw the player once at each size in the M0-adjacent hand test and keep one.
- Courtyard backdrop can wait until M4. M2 duels all use the brig deck.
- The PRD question of turn-based versus real-time land battles does not change this art.
