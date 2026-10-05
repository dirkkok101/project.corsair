# Project Corsair — Art and Sprite Pipeline

2026-09-28 · Dirk Kok · Status: draft, planning stage (v2.1, research folded into project docs)

Companion to `docs/project-corsair-prd.md` (sections 3, 5, 7, 9, 10, 14) and `docs/project-corsair-scenes.md` (which scene draws which sprite). This doc covers how every sprite, tile and illustration gets made, checked and loaded.

**Research and skills (canonical in this folder):**

| Doc | Role |
|-----|------|
| `docs/ai-game-sprites-SKILL.md` | Reusable AI sprite workflow skill |
| `docs/ai-game-sprites-research.md` | Broad YT / tool sweep (characters, snap, mixels) |
| `docs/corsair-pixel-art-research.md` | Corsair gaps + free-first stack (ships, RotSprite, autotiles, licensing, Mac install) |

This pipeline follows those notes. Engine choices here (PixiJS, dual-grid layers) override Godot-centric examples in the research where they differ.

## 1. Principles

- **Real pixels only.** At 960×540 logical resolution, AI "fake pixel" output is not shippable. Every asset ends on-grid, on-palette, with binary alpha.
- **One palette, enforced by a script.** The day/night palette shader only works if every pixel is an exact palette colour.
- **Layers over frames.** Hulls, sails, damage, bodies, weapons and costumes are separate layers. This keeps the frame count manageable.
- **AI where it's strong, 3D and hand work where it isn't.** No AI tool does 16 directions, so ships come from 3D. AI is used for characters, drafts and concept work.
- **Placeholder first.** Sprite ids live in game data, so every milestone can run on greybox art.
- **Art is validated like data.** A missing sprite id or an off-palette pixel fails the `pnpm verify` gate before a merge. There is no CI.
- **Original art only.** No prompt, reference image or style note may name the original game, its box art or another studio's work.
- **Free-first for M0.** Prefer $0 tools (Blender, Pixelorama/LibreSprite, Autotiler, Maghwyn/Foozle/framemill) until the brig spike proves the look. Paid (Aseprite, PixelOver, PixelLab, RD) only after that, or if already owned.

## 2. Locked spec

| Item | Decision |
|---|---|
| Logical resolution | 960×540, integer scaling only, nearest-neighbour filtering: 2× at 1080p, 4× at 4K, 2× with borders at 1440p. Was 480×270; the player wanted to see more of the world without losing pixel fidelity, and chose finer art over a smaller view. Every pixel size below grew 1.5× to match. |
| Palette | One project palette `art/palette/corsair.gpl`, 32 to 48 colours. Shortlist: Apollo (46), Lospec500 (42), Pear36 (36), Endesga 32. Apollo is the front-runner for its sea blues, jungle greens and wood browns. Each colour gets a matching night entry (section 6). |
| Outline | 1 px dark outline on characters, ships and units. None on tiles or harbour backgrounds. |
| Alpha | 0 or 255 only. VFX atlases excepted. |
| Tile size | 24×24 |
| World-map ships | 96×96 cell, 32 facings |
| Combat ships | 192×192 cell, 16 facings |
| World-map settlements | 96×96 cell, same locked 45° camera as the ships |
| Ship camera | Orthographic, 45° elevation, locked. The map tiles stay top-down. |
| Duel characters | 96×96 cell, side view |
| Land-battle units | 48×48 cell, camera still open |
| Stealth and on-foot party | 48×48 generated, finished by hand at 24×24 or 36×36 (AI tools are not reliable below 32) |
| Portraits | 96×96 face area on a 96×120 card, layered parts |
| Harbour screens | 960×540 layered scenes |
| Facing convention | f00 = north, then clockwise: 11.25° steps to f31 for world-map ships, 22.5° steps to f15 for combat ships |
| Pivots | Ships: hull centre at the waterline. At 45° this sits below the cell centre, so it must come from the atlas, not the cell. Characters and units: centre-bottom at the feet. Stored per frame in the atlas JSON. |
| Animation timing | Driven by sim ticks (30 per second). Each duel frame carries a phase tag (wind-up, active, recovery) and a tick duration from `fencing_moves.json`. Ambient loops run at 8 to 12 fps. |

## 3. Asset inventory and frame budget

Estimates for v1.0, rounded. "Unique" is what has to be produced after mirroring and layering. Which frames each screen draws is in `docs/project-corsair-scenes.md`.

| Asset group | In-game frames | Unique to produce | How |
|---|---|---|---|
| World-map ships (12 × 32 × 23 sail sprites, see scenes S1) | 8,832 | 8,832 rendered, ~4,450 hand-checked (port tack mirrors starboard) | Blender renders, hand pass at 96 px |
| Combat ships (same counts at 192×192) | 576 | 576 rendered, light cleanup | Blender renders |
| Ship damage overlays (4 families × 3 tiers) | 192 | 192 rendered | Material states through the same cameras |
| Ship sinking | — | ~0 bespoke | In-engine tilt and water mask plus shared VFX |
| Duel captain base body (~14 animations) | ~90 | ~90 | AI anchor + skeleton animation + pixel editor |
| Duel weapon layers (3 weapons) | ~270 | ~270 | Hand-drawn over the body frames |
| Duel costume and head layers (~4 archetypes) | ~360 | ~360 | AI drafts + pixel editor, palette swaps for variety |
| Background crew loops | ~32 | ~32 | AI + pixel editor |
| Land-battle units (7 types × 5 actions) | ~700 | ~525 | AI templates + pixel editor |
| Dance (player and partner) | ~24 | ~24 | AI pose boards + pixel editor |
| Stealth and on-foot party | ~70 | ~50 | Hand at 24–36 px |
| Settlement world-map sprites | ~26 | ~26 | 12 colonial towns and the pirate haven rendered from low-poly Blender models (section 4); the rest AI concept + hand |
| Terrain autotiles | ~150 | ~150 | ~16 tiles per terrain layer × 9, plus a river edge set (section 5) |
| Harbour screen kits | — | ~90 pieces | AI concept with style lock, snapped, split into pieces |
| Portrait parts | — | ~60 parts | Layered kit (section 7) |
| Map objects and treasure | ~40 | ~40 | Mixed |
| UI icons | ~40 | ~40 | Pixel-native AI or hand |
| VFX | ~36 | ~36 | Hand |
| **Total hand-touched** | | **~2,300 to 2,500** | Down from ~2,800 because ships and tiles are mostly generated |

The duel characters are now the largest block of hand work. If anything gets a contract pixel artist, it's those.

## 4. Ship pipeline

The research settled this (`docs/corsair-pixel-art-research.md` Part A §1). No AI tool offers 16 directions: PixelLab and Retro Diffusion both stop at 8, and neither documents results on ships. Runtime rotation of a single sprite distorts pixels at these sizes. So ships come from 3D.

**Primary: low-poly Blender models rendered to pixels.**

1. Model one low-poly hull per class. Sails (furled, half, full), flags and damage states are separate meshes or materials. Keep parts thick enough to read at 96 px; avoid 1 px ropes in geometry.
2. Render with an **orthographic** camera at **45° elevation**, locked for the whole production, no anti-aliasing, nearest/filter size 0, transparent BG. The ship rotates under the fixed camera: **32 facings (11.25°) for the world map**, 16 (22.5°) for combat. 16 world facings looked steppy in play: at a brig's turn rate the sprite only changed every 0.7 s. Same framing every shot.
3. **Batch helpers (prefer free):** Maghwyn `blender_directional_spritesheets` (native 4/8/**16**/32), FoozleCC blender_scripts (extend 8-dir to 16), or framemill (headless Blender → 16 sheets; GPL tool, your renders are your art). **Optional paid:** Sprite Sheet Maker (GPL, check Blender version), PixelOver ($19.99 one-time). Blender To Pixels (free) is useful for trying out looks.
4. Render at **192×192 directly** for combat and at **96×96 directly** for the world map. Don't downscale the 192s to make the 96s; thin masts and rigging turn to noise that way. Display scale is a separate nearest-neighbour integer upscale.
5. Snap every frame to the palette with the section 8 scripts. Render two passes per frame: a flat pass to identify each material, and a lit pass to pick a dark, mid or light step from that material's 3-colour ramp in `corsair.gpl`. Snapping a lit render straight to the nearest palette colour turns white sails brown.
6. Cleanup in **Pixelorama or LibreSprite** ($0) or **Aseprite** if already owned: light at 192 px, a hand pass at 96 px (masts, bowsprit, flag, outline gaps). Plan on the 96 px pass as the real cost.
7. Damage overlays are rendered through the same cameras, so they line up in every facing.

The locked read is the 45° row of the brig tilt spike (`art/sources/spikes/brig-tilt/`, model in `art/sources/blender/brig-3d-spike.blend`). At 45° the masts, stacked sails, flag, hull side and bow all read at 1× on the 480×270 map the spike was judged on. Straight overhead was tried and rejected: an honest overhead render of a real model shows yards and deck but no sail, so it reads as a rowboat. The crescent sails in overhead packs such as Foozle's Scallywag Ships are hand-painted, and a 3D render can't produce them.

The world map stays a top-down tilemap. Only ships and settlements are drawn at 45°.

**Settlements** use the same path. Low-poly Blender models are rendered by `tools/art/render_towns.py` into 96×96 cells with the locked 45° camera, output in `art/game/settlements/`. The ids are `settlement.{spain,england,france,netherlands}.{hamlet,town,city}` and `settlement.pirate.haven`: 13 sprites. Nation variants of a size share geometry; only roof colour and flag change.

Mirroring is optional here, since renders are cheap. It's still useful to cut the 96 px hand pass to 17 facings and mirror the other 15 when hull asymmetry allows.

**Fallback: rotate at high res with RotSprite or cleanEdge.** This only works for a straight-overhead view, because a 45° view changes shape with heading rather than just rotating. Use it only if the 45° decision is reversed. If the Blender look doesn't fit the rest of the art, draw one top-down master per class and rotate it with RotSprite (Aseprite; confirm in LibreSprite) or cleanEdge (Clean Rotate extension). The Lospec Pixel Art Rotator compares nearest, RotSprite and cleanEdge side by side for free. Research fitness rank: RotSprite-from-one-facing is **worst** at 16–32 px for ships (masts/rails vanish) — treat it as a redraw starting point, not a shippable facing set.

**M0 spike:** model the brig and render all 16 facings at both sizes with the free Blender path. Test RotSprite and cleanEdge on the same ship. Judge at 1× and 4× on the actual world map before committing or buying PixelOver / Aseprite / AI credits.

**Spike result (2026-10-04):** a real low-poly brig was rendered at 90°, 60° and 45°, and 45° was chosen. The earlier `art/sources/blender/brig.blend` is a flat decal (every mesh has zero height), not a 3D model, so it can't test this pipeline. Still open: the hand pass at 96 px (1 px masts, short bowsprit, thin hull side) and the RotSprite comparison.

Sources: section 13, items S1 to S12; research Part A §1–2 and Part B.

## 5. Terrain tiles

- **Method:** one layer per terrain, stacked by priority: deep water, shallows, reef, beach, swamp, jungle, hills, mountain. Each layer is a 16-tile corner set (dual-grid, 15 tiles plus empty) drawn over transparency. That's about 16 × 9 ≈ 150 tiles in total, and it never explodes into combinations of every terrain pair.
- **Rivers:** a separate edge-based set on top.
- **Until the set exists:** the renderer paints terrain procedurally from the palette. Coasts are smooth contours blended between tile centres, and relief is shaded from elevation. Collision stays on the tile grid. Only deep, shallow, beach, jungle, hills and mountain are in the map so far.
- **Variants:** add alternative fills or minitiles only if the map looks repetitive.
- **Authoring tools (free-first):**
  - **Pixelorama / LibreSprite** (or Aseprite if owned) for painting the template.
  - **Autotiler 2.0** (MIT, free web/app): 13-tile template → blob47 / dual-grid; exports Tiled `.tsx` / Wang and engine sheets. Prefer this over paid AutoBlob for M0.
  - **Tiled** terrains / Automapping for coast–reef layout and cliffs (research Part A §4 coast recipe still applies; engine import is Pixi, not Godot).
  - Tilesetter can expand a base and an edge image into full sets.
  - PixelLab's tileset tool can export dual-grid 15-tile sheets at 16 px (our tiles are now 24 px), but nobody has reviewed its quality independently. Use it for first drafts only, then clean and snap.
- **Engine:** @pixi/tilemap v5 supports PixiJS v8. It caps at 16k tiles per tilemap, so the 1,600 × 1,100 tile map must be chunked. The chunk size also suits streaming (a PRD open question).

Sources: section 13, items T1 to T10; research Part A §4 and Part B §C.

## 6. Day/night palette

- **Technique:** indexed palette lookup. At pack time, each sprite is converted to palette indices (stored in the red channel). A PixiJS v8 filter on the world container looks up the colour in a small palette texture with one row per time of day (day, dusk, night) and blends between rows on a time uniform.
- **Other options considered:** a full RGB LUT (a 4096² texture, heavy on tablets) and a multiply tint (can't hue-shift, so night just looks darker).
- **Why:** night becomes hue-shifted rather than just darker, and palette swaps for nation colours or costume variety come for free.
- **Night row authoring:** same indices, shifted toward blue, with lower saturation and value. Lantern and fire colours keep their day values.
- **What this means for art:**
  - Every pixel must be an exact palette colour, with no anti-aliasing and binary alpha.
  - The pack step must keep indexed data intact, because image tools often convert palettes back to RGB.
  - `art:validate` checks all three.
- **Implementation:** write a custom filter (a palette texture passed as a resource). pixi-filters v6's ColorMapFilter might do the job, but its fit for indexed palettes isn't verified.

Sources: section 13, items P1 to P6.

## 7. Portraits

Governors, daughters, captains and villains are generated per game, so portraits are a layered kit, not one-off images.

- Every part is drawn on one fixed 96×96 face template. Eyes, mouth and neck sit on identical pixels across all faces.
- Layer order: back hair, body and clothing, head, features, makeup, beard, moustache, accessories, front hair, hat.
- Skin, hair and cloth use their own palette ramps, recoloured by the same palette shader. That gives variety without more parts.
- The portrait is picked from the character's seed, so the same NPC always looks the same and bug reports reproduce.
- AI helps draft parts on the template, then each part is snapped and fixed in the pixel editor.
- All content stays PG, as the PRD requires.

Sources: section 13, items R1 and R2.

## 8. Tooling: `tools/art-pipeline`

A package in the pnpm workspace. It uses Node/TypeScript for orchestration and validation, and calls proven CLIs for grid detection.

| Command | Does |
|---|---|
| `pnpm art:snap` | 1) Detect the true pixel grid on generated images with Retro Diffusion's Pixel Art Fixer (MIT, Rust CLI) or unfake (WASM/CLI). 2) Downsample by mode, one majority colour per cell, not nearest. 3) Map to `corsair.gpl` by nearest colour in OKLab, dithering off. 4) Force binary alpha. 5) Apply the outline rule. 6) Crop into the target cell. Animation strips share one grid and palette. |
| `pnpm art:render` | Batch-render Blender ship files from the locked 45° camera: 32 facings at 96 px, 16 at 192 px. `tools/art/render_brig.py` is the first one (brig world set); `tools/art/render_towns.py` renders the settlement set (Blender CLI; Maghwyn/Foozle/framemill scripts optional wrappers) |
| `pnpm art:mirror` | Produce mirrored facings from the declared mirror map |
| `pnpm art:align` | Align frames to the pivot and normalise baseline |
| `pnpm art:index` | Convert packed atlases to palette-index textures for the day/night filter |
| `pnpm art:pack` | Pack atlases (free-tex-packer-core) into PixiJS spritesheet JSON + PNG, with pivots, animation lists and duel phase tags |
| `pnpm art:validate` | Verify-gate check, see below |

Implementation notes:

- `sharp` does resizing and PNG output only. Its palette mode builds its own palette and can't take a fixed one.
- For palette mapping, use a small custom OKLab nearest-colour function, or image-q if its fixed-palette API checks out.
- The Pixel Art Fixer benchmark (77% exact grid detection against 3–4% for Pixel Snapper and unfake) comes from the vendor's own benchmark. Test both tools on our own output before choosing.

`art:validate` fails the build when:

- a pixel is off-palette or alpha is not 0 or 255 (VFX atlases excepted)
- frames in one animation have different cell sizes, or a pivot is missing
- a sprite or animation id referenced in any content JSON is missing from the atlas
- a duel, dance or unit animation's frame count or phase tags don't match its data file
- a facing set is incomplete (32 for world-map ships, 16 for combat ships, 4 for top-down characters)

Rendering check: `render.screenshot` scenarios (PRD section 16) for the world map at day and night, a sea battle and a duel, at 1× and 4×.

## 9. Generation tools, licensing and disclosure

Checked 2026-09-28. Summary only; this is not legal advice. Re-check terms before paying for anything. Full free-stack table and install order: `docs/corsair-pixel-art-research.md` Part B. Dated commercial $ table: same doc Part A §5.

### Free stack (M0 default — do not buy for the brig spike)

| Tool | Use in Corsair | Cost | Notes |
|---|---|---|---|
| Blender | Ships / turntable | Free (GPL) | Artwork is yours |
| Pixelorama | Primary free pixel editor | Free (MIT) | Cleanup, sheets, duel frames |
| LibreSprite | Alternate free editor | Free (GPL-2) | Confirm RotSprite UI in your build |
| Maghwyn / Foozle / framemill | 16-dir Blender batch | Free (MIT / MIT / GPL-3 tool) | Prefer Maghwyn for native 16 |
| Autotiler 2.0 | Template → blob / dual-grid | Free (MIT) | Web first; skip AutoBlob for M0 |
| Tiled | Map / terrains | Free | Maps are yours |
| Pixel Snapper / Pixel Art Fixer / unfake | Snap step | Free / MIT | Bake-off on our output |

### Optional paid / AI (after M0 evidence)

| Tool | Use in Corsair | Cost | Commercial terms |
|---|---|---|---|
| Aseprite | Cleanup if free editors block you, or already owned | $19.99 FAQ min for 1.x binaries | Creations usable commercially. Documented RotSprite. |
| PixelOver / Sprite Sheet Maker | Alternate Blender→sheet | $19.99 / free add-on | Optional; free Maghwyn path first |
| PixelLab | Duel characters, units, skeleton animation, tile drafts | Subscription (third-party listing: $12, $24, $50/mo; **verify in UI**) | You own outputs, commercial use allowed on all plans. No training other models on outputs. API sizes/pricing in research. **Not 16-dir.** |
| Retro Diffusion (Aseprite extension) | Small sprites, icons, palette-locked generation | $65 one-time (Lite $20) | Runs locally. Developer states you own outputs; no formal licence found. |
| Retro Diffusion (web/API) | Same, plus `input_palette` locking | Credits from ~$5 packs | FAQ: art yours for personal and commercial. Re-check before spend. |
| AutoBlob | Skip for M0 | $5.99 itch | Prefer Autotiler |
| AutoSprite | Not planned for ships; optional character volume later | Free tier / $12–$29/mo | ToS puts IP risk on inputs; you own outputs to extent permitted |
| GPT Image, Gemini image | Concept, harbour scenes, portrait-part drafts | Per image/token | Outputs assigned to or not claimed from the user, "to the extent permitted by law". Gemini free tier may use data for training, so use the paid tier. |
| Grok Imagine (xAI) | Harbour scenes, service interiors, title art (`art/sources/grok/README.md`) | API per image (from about $0.04) | **Not yet checked.** Read xAI's current terms for output ownership and commercial use before anything from it ships. |
| Midjourney | Avoid for production | $10 to $120/mo | Companies earning over $1M a year need Pro or Mega to own outputs, and images are public unless in Stealth mode (Pro/Mega). |
| Flux | Only Schnell (Apache 2.0) or a paid BFL licence | — | Flux Dev weights are non-commercial. |

**Rules for the project:**

- **Steam:** AI-generated art that ships in the game is "consumed by players" and must be declared in Steam's content survey. Behind-the-scenes efficiency tools are not the focus. Plan the disclosure wording before the store page goes up.
- **itch.io:** disclosure for games is encouraged, not required. Tag the build honestly anyway.
- **Copyright:** the US Copyright Office says prompts alone don't give copyright. Human selection, arrangement and modification can. South Africa's Copyright Act gives authorship of computer-generated works to whoever made the arrangements for creating it, but that hasn't been tested for generative AI. Either way, the heavy hand pass on every shipped asset is what makes the art defensibly ours, and the prompt records in `art/sources/` show it.
- Every AI-assisted asset gets a prompt record (`{id}.yaml`) beside its raw output in `art/sources/{tool}/`: tool, version, plan, prompt, seed, date and what was changed by hand.

Sources: section 13, items L1 to L15; research Part A §5 and Part B.

## 10. Repo layout and naming

Art is split by role: what the game loads, and what it is made from.

```
art/
  palette/                     # corsair.gpl plus the dusk and night rows
  audio/                       # sfx, instrument samples, CREDITS.json (loaded by the game)
  game/                        # everything the game loads: palette-exact, named by sprite id
    ships/                     # one atlas per ship class, facings across, anims down (pack_ships.ts)
    settlements/               # world-map towns (render_towns.py)
    wildlife/                  # sea life frames + wildlife.json (render_wildlife.py)
    harbours/                  # layered Blender harbour scenes + harbours.json (render_harbours.py)
    scenes/                    # painted full-frame scenes: harbours with sea frames, interiors, title (import_paintings.ts)
  sources/                     # what the art is made from; never loaded by the game
    blender/                   # .blend masters
    grok/{group}/              # raw Grok output with its prompt record beside it (Git LFS); README.md is the brief
    references/                # layout references handed to image models (composite_harbours.ts)
    renders/ships/             # the frames the ship atlases are packed from (render_brig.py, render_ships.py)
    spikes/                    # retired experiments kept for the record (top-down brig, tilt spike)
content/base/sprites/
  atlas-*.json / .png          # later: packed, indexed output, referenced by id from game data
docs/
  project-corsair-art-pipeline.md
  project-corsair-prd.md
  project-corsair-scenes.md
  ai-game-sprites-SKILL.md
  ai-game-sprites-research.md
  corsair-pixel-art-research.md
```

Sprite ids follow the content id style: `{kind}.{subject}.{variant}.{anim}.{facing}`, for example `ship.brig.world.sail_full.f03` or `duel.body.attack_high`. The PRD's ship example uses `"world": "brig_world"`; change that to the dotted form before the first real atlas lands.

## 11. Delivery by milestone

| Milestone | Art needed |
|---|---|
| M0 Foundations | Palette with night row, spec, pipeline scripts, greybox atlas, `art:validate` in the `pnpm verify` gate. Spikes: brig in Blender via free 16-dir path (plus RotSprite/cleanEdge comparison), one duel pose set through PixelLab and Retro Diffusion, snap-tool bake-off on our own output. |
| M1 Sailing and trade | Terrain layers, 3 to 4 world-map ship classes, 5 settlement sprites and basic harbour screens, storm, goods icons, day/night filter |
| M2 Combat | Combat sprites for 4 classes, damage overlays, duel base body with 3 weapons and 2 costumes, crew loops, combat VFX |
| M3 Living world | All nation building styles, world-map sprites for every class the AI sails |
| M4 Career content | Remaining ships, forts, land-battle units, dance, stealth, treasure parchment, portrait kit |
| M5 Polish | Full art pass, palette tuning at night, contract pixel-art polish on duel characters if needed, Steam AI disclosure |

## 12. Open questions

- Land-battle camera: top-down, 4 facings, specified in `docs/project-corsair-scenes.md`. The PRD still has the rules question of turn-based versus real-time with pause. The art is the same either way.
- World-map sail states: 3, or just full and furled at 32 px?
- Does the Blender render look sit well next to hand/AI-drawn characters? The M0 spike decides.
- Ship cell height at 45°: masts make the bow-up and bow-down facings tight in 96×96. Either grow the world cell to 96×120 or shrink the ship. Decide in the 96 px hand pass.
- Who does hand cleanup? The duel set is the biggest block; budget a contract pixel artist if nobody on the team will.
- Final palette: Apollo as-is, or a custom palette built from it?
- Paid tool choice: PixelLab subscription, Retro Diffusion one-time, or both. Decide after the M0 duel spike. Default until then: free stack only for ships/tiles.

## 13. Research sources

**In-repo research (start here)**
- R0a Art pipeline (this doc): `docs/project-corsair-art-pipeline.md`
- R0b Corsair gaps + free stack: `docs/corsair-pixel-art-research.md`
- R0c Broad AI sprites research: `docs/ai-game-sprites-research.md`
- R0d AI sprites skill: `docs/ai-game-sprites-SKILL.md`

**Ships and rotation**
- S1 Dead Cells 3D-to-2D pipeline: https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i-
- S2 Sprite Sheet Maker (Blender): https://extensions.blender.org/add-ons/sprite-sheet-maker/
- S3 Blender To Pixels: https://astropulse.itch.io/blender-to-pixels
- S4 PixelOver: https://pixelover.io/
- S5 Pixelizing 3D objects: https://medium.com/@elliotbentine/pixelizing-3d-objects-b55ec33328f1
- S6 Aseprite rotation (RotSprite): https://github.com/aseprite/docs/blob/main/rotate.md · https://aseprite.org/docs/rotate/
- S7 cleanEdge: https://torcado.com/cleanEdge/ and Clean Rotate: https://astropulse.itch.io/clean-rotate-for-aseprite
- S8 Lospec Pixel Art Rotator: https://lospec.com/pixel-art-rotator/
- S9 PixelLab rotate / 8-rotations / API: https://www.pixellab.ai/docs/tools/rotate , https://www.pixellab.ai/pixellab-api ; Retro Diffusion 8-direction: https://retrodiffusion.ai/styles/8-direction-rotation/ ; sprite counts by perspective: https://cxong.github.io/2022/03/how-many-sprites-do-different-perspectives-need
- S10 Maghwyn 16/32 directional sheets: https://github.com/Maghwyn/blender_directional_spritesheets
- S11 Foozle 4/8-dir Blender scripts + itch templates: https://github.com/FoozleCC/blender_scripts · https://foozlecc.itch.io/render-4-or-8-direction-sprites-from-blender · YT https://www.youtube.com/watch?v=l1Io7fLYV4o
- S12 framemill (headless Blender → 16): https://pypi.org/project/framemill/ · https://github.com/ghreprimand/framemill
- S13 Blender pixel complete guide (YT): https://www.youtube.com/watch?v=PBIPJdEECWg

**Tiles**
- T1 Tileset classification: https://www.boristhebrave.com/2021/11/14/classification-of-tilesets/
- T2 Dual-grid: https://excaliburjs.com/blog/Dual%20Tilemap%20Autotiling%20Technique/ , https://github.com/jess-hammer/dual-grid-tilemap-system-unity
- T3 TileMapDual (multi-terrain layering): https://github.com/pablogila/TileMapDual
- T4 Tiled terrain sets: https://doc.mapeditor.org/en/stable/manual/terrain/
- T5 Tilesetter: https://www.tilesetter.org/docs/generating_tilesets
- T6 LDtk auto-layers: https://ldtk.io/docs/general/auto-layers/
- T7 PixelLab tileset tool: https://www.pixellab.ai/docs/tools/create-tileset
- T8 @pixi/tilemap: https://github.com/pixijs-userland/tilemap
- T9 Autotiler 2.0: https://route1rodent.itch.io/autotiler · web itsjavi.com/autotiler · https://github.com/itsjavi/autotiler
- T10 AutoBlob (paid, skip for M0): https://violetpixel13.itch.io/autoblob

**Palette and shader**
- P1 Palette swapping with shaders: https://pvigier.github.io/2019/10/06/palette-swapping-with-shaders.html
- P2 LUT approach: https://gist.github.com/Yanrishatum/86794e9e663a7e343f9ef66e8b0f38ae
- P3 pixi-filters / ColorMapFilter: https://github.com/pixijs/filters , https://pixijs.io/filters/docs/ColorMapFilter.html
- P4 Custom v8 filter with texture: https://github.com/pixijs/pixijs/discussions/10358
- P5 Apollo palette: https://lospec.com/palette-list/apollo ; Lospec500: https://lospec.com/palette-list/lospec500 ; Pear36: https://lospec.com/palette-list/pear36 ; Endesga 32: https://lospec.com/palette-list/endesga-32
- P6 Hue shifting: https://www.pixel-editor.com/articles/color-theory-for-pixel-art

**Portraits**
- R1 tamats face generator: https://www.tamats.com/blog/?p=814
- R2 Universal LPC generator: https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator/blob/master/README.md

**Snapping and small sizes**
- N1 PixelLab API sizes: https://www.pixellab.ai/pixellab-api ; skeleton animation: https://www.pixellab.ai/docs/tools/animate-with-skeleton
- N2 Retro Diffusion API: https://github.com/Retro-Diffusion/api-examples
- N3 Chong-U pipeline: https://github.com/chongdashu/ai-pixel-snapped-game-sprites
- N4 Pixel Snapper: https://github.com/Hugo-Dz/spritefusion-pixel-snapper
- N5 unfake.js: https://github.com/jenissimo/unfake.js/
- N6 proper-pixel-art: https://github.com/KennethJAllen/proper-pixel-art
- N7 Pixel Art Fixer and pixel-bench: https://github.com/Retro-Diffusion/pixel-art-fixer , https://github.com/Retro-Diffusion/pixel-bench
- N8 sharp output (palette limits): https://sharp.pixelplumbing.com/api-output ; image-q: https://github.com/ibezkrovnyi/image-quantization
- N9 Anticipation/active/recovery: https://www.rivalslib.com/workshop_guide/art/anticipation_action_recovery.html
- N10 Pixelorama: https://www.pixelorama.org/ · LibreSprite: https://libresprite.github.io/

**Licensing and disclosure**
- L1 PixelLab ToS: https://www.pixellab.ai/termsofservice
- L2 Retro Diffusion extension: https://astropulse.itch.io/retrodiffusion
- L3 AutoSprite terms: https://www.autosprite.io/terms
- L4 OpenAI terms: https://openai.com/policies/row-terms-of-use/
- L5 Gemini API terms and pricing: https://ai.google.dev/gemini-api/terms , https://ai.google.dev/gemini-api/docs/pricing.md.txt
- L6 Midjourney ToS and plans: https://docs.midjourney.com/hc/en-us/articles/32083055291277-Terms-of-Service , https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans
- L7 Flux licences: https://bfl.ai/licensing , https://huggingface.co/black-forest-labs/FLUX.1-dev/blob/main/LICENSE.md
- L8 SDXL licence: https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/LICENSE.md
- L9 fal terms: https://fal.ai/legal/terms-of-service
- L10 Aseprite FAQ: https://www.aseprite.org/faq/
- L11 Blender licence: https://www.blender.org/about/license/
- L12 Steam content survey: https://partner.steamgames.com/doc/gettingstarted/contentsurvey ; 2026 clarification: https://www.pcgamer.com/software/ai/steam-updates-ai-disclosure-form-to-specify-that-its-focused-on-ai-generated-content-that-is-consumed-by-players-not-efficiency-tools-used-behind-the-scenes/
- L13 itch.io AI tagging: https://itch.io/t/4309690/generative-ai-disclosure-tagging
- L14 US Copyright Office (2025): https://www.copyright.gov/newsnet/2025/1060.html
- L15 South Africa Copyright Act: https://www.wipo.int/wipolex/en/legislation/details/4067 ; commentary: https://www.derebus.org.za/authorship-in-the-age-of-ai-who-owns-ai-generated-works-in-south-africa/
