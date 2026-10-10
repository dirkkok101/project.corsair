<!-- project.corsair canonical copy — 2026-09-28 -->
<!-- Path: ~/Development/project.corsair/docs/corsair-pixel-art-research.md -->

# Corsair Pixel-Art Research

**Status 2026-10-10:** historical for ships, terrain and the sea map: the sea and battles are 3D since 2026-10-08 (`docs/reference/pirates-3d-style.md`). The palette, snapping, licensing and tool notes still apply to the 2D harbour, interior and UI art.

**Research date:** 2026-09-28 (Africa/Johannesburg, SAST)  
**Merged from:** [[ai-game-sprites-corsair-gaps]] + [[corsair-free-tool-stack]] (those notes are stubs pointing here)  
**Parent (broad AI sprites):** [[ai-game-sprites-research]] · skill: [[ai-game-sprites-SKILL]]  
**Scope:** 16-facing ships/vehicles, pixel-safe rotation, native tiny sizes, autotiles, commercial licensing, **and** the free-first tool stack for M0.  
**Method:** Primary docs + official pricing/ToS + high-signal tutorials/tools. Prices never invented; third-party subscription dollar amounts flagged when official UI is JS-only.  
**Success criterion:** Enough evidence to choose **M0 brig spike (hand/3D pipeline)** vs **tool spend**, with a $0 path ready to install.

**Workspace twins:** `/workspace/corsair-pixel-art-research-2026-09-28.md` · older: `ai-game-sprites-corsair-gaps-2026-09-28.md`, `corsair-free-tool-stack-2026-09-28.md`

---

## Executive decision (Corsair-shaped)

| Decision | Recommendation | Why |
|----------|----------------|-----|
| **M0 brig / player ship 16 facings** | Prefer **low-poly 3D → orthographic turntable → native-res pixelate → pixel-editor cleanup** over AI 16-dir or RotSprite-from-one-facing | PixelLab stops at **4/8** rotations; RotSprite at 16–32px destroys mast/rail/asymmetry; AI 16 unique facings = cost + identity drift |
| **Overlays (sails, flags, damage, wake)** | Separate layers rendered or painted per facing; mirror only when geometry allows | Overlays fail hardest under auto-rotate |
| **Coast / reef / land–water** | **Hand 13-tile (or 6-tile) template → Autotiler 2.0 → Godot Terrain / Tiled** | Concrete, free, engine-ready; PixelLab tileset API is a draft aid, not a ship set |
| **Crew / UI / props at 16–32** | PixelLab GBA path + Retro Diffusion web (native sizes) for drafts; hand finish | Covered in parent research; still best tiny-readable AI path |
| **Tool spend before M0 ship spike** | **None required.** Optional later: RD ~$5 packs or PixelLab trial for tiles/props | Free stack is Blender + Pixelorama/LibreSprite + Autotiler + Tiled + Godot |

### Quick decision card

| Asset | Free path | Buy later? |
|-------|-----------|------------|
| 16-facing brig | Blender + Maghwyn/framemill/Foozle → Pixelorama → Godot | No |
| Duel character | Pixelorama / LibreSprite (+ rembg if needed) → Godot | AI credits optional after hand bar is set |
| Coast autotile | Pixelorama 13-tile → Autotiler 2.0 → Tiled/Godot | No (skip AutoBlob) |

**Success for M0:** one brig sheet at 16 yaws, nearest-filtered in Godot, readable silhouette — then revisit paid tools with evidence.

---

## Part A — Gaps research

### 1. Top-down ships / vehicles at ~16 facings

#### Fitness ranking (Corsair, not YouTube views)

| Rank | Method | Fitness for Corsair 16-dir ships | Cost / effort | Notes |
|------|--------|----------------------------------|---------------|-------|
| **1** | **3D low-poly → ortho camera → N yaw steps → pixelate → pixel editor** | **Best** | Time + Blender skill; $0 software | Geometry stays consistent across 16 angles; overlays as separate meshes/passes |
| **2** | Paint **canonical facings** (S, SE, E…) by hand; mirror W/SW/NW; RotSprite only as **rough** for diagonals then redraw | Strong for hero ships | Artist time | Industry default for true pixel look at tiny sizes |
| **3** | AI generate set (PixelLab 8-dir / RD / img2img per angle) then snap + cleanup | OK for **prototypes / NPCs**, weak for hero brig | Credits | PixelLab **no native 16-dir**; consistency across 16 is the failure mode |
| **4** | Single facing → RotSprite ×15 | **Poor** at 16–32px for ships | Fast but dirty | Masts, sparse rails, 1px ropes vanish or jag |

#### Concrete 3D→pixels workflow (ranked #1)

**Core loop**

1. Model ship as **readable silhouette** (think 2D sprite constraints in 3D: thick enough parts, limited palette, avoid thin floaty geometry).  
2. **Orthographic** camera parented to Empty at ship origin; lock camera transforms; choose one tilt (e.g. ~35–60°) and **never change** mid-production.  
3. Rotate Empty by **360/N** (22.5° for 16). Same framing every shot. Transparent BG.  
4. Render at **target native size** (or 2× integer then nearest downsample) with **filter size 0 / nearest** (no AA).  
5. Optional: Workbench normal matcap pass for 2D lighting.  
6. Import sequence to Pixelorama / LibreSprite / Aseprite → stray-pixel cleanup → indexed palette → sheet by rows.

**Refs (quality over views)**

| Source | URL | Why it matters |
|--------|-----|----------------|
| **How To Make Pixel Art In Blender — Complete Guide** (YT) | https://www.youtube.com/watch?v=PBIPJdEECWg | End-to-end: ortho, compositor nearest preview, palette UV trick, multi-dir Python rotate, cleanup, normals |
| Foozle — 4/8-dir Blender Python + blend templates | https://foozlecc.itch.io/render-4-or-8-direction-sprites-from-blender · script https://github.com/FoozleCC/blender_scripts/blob/main/render_8_direction_sprites · YT https://www.youtube.com/watch?v=l1Io7fLYV4o | Mixamo-style action batch; extend angle count to 16 in script |
| Maghwyn — Blender directional sheets **4/8/16/32** + Rust packer | https://github.com/Maghwyn/blender_directional_spritesheets | Explicit **16/32** support (thin star count; code is the value) |
| **framemill** (PyPI, GPL-3.0) | https://pypi.org/project/framemill/ · https://github.com/ghreprimand/framemill | Headless Blender → 1/4/8/**16** sheets; FBX/GLB; palette export. New (2026-09). Best “I have a mesh, give me directions” wrapper. **Note:** GPL on the tool — outputs (your renders) are your art; distributing modified framemill itself has GPL obligations |
| Blender Pixel Sprite Renderer (itch) | https://efeitos-visuais-brasil.itch.io/blender-pixel-sprite-renderer | 4/8/16 + pixel conversion + JSON |
| AUTeddy 8-dir camera rig (itch; paid) | https://auteddy.itch.io/8-directions-render-plugin-for-blender | Ortho rig builder; **8** not 16 — still useful camera setup |
| Gravity Ace — Blender + Aseprite 3D→2D | https://gravityace.com/devlog/3d-to-2d-with-blender/ | Short practical blog (2021); confirms cleanup-in-editor step |

**Ship-specific tips**

- Author **hull + deck + mast** as separate pieces if you need damage/sail states as overlays.  
- Prefer **symmetric hull** where possible so 8 painted + 8 mirrors reduce work; Corsair brig with offset cannons/rigging may forbid mirrors.  
- Bake **wake / foam** as VFX sprites, not ship rotation — cheaper and cleaner.  
- Weak coverage: almost no dedicated “16-facing Age of Sail ship pixel” tutorials; borrow **general directional vehicle/character** pipelines.

#### AI-generate set (ranked #3 — when to use)

- PixelLab: official **4 & 8** directional rotation / character tools (marketing + API `generate-8-rotations-v3`). **Not 16.** Use for crew, cargo crates, UI — not full ship compass.  
- Retro Diffusion web: styles include **8 Direction Rotation**; size range cited 16–512 depending on model (site FAQ). Good for props; ship identity across 16 angles still needs human glue.  
- Parent-doc Chong-U anchor → NEWS → snap pipeline scales poorly to **16 asymmetric** vehicle facings.

---

### 2. Pixel-safe rotation

#### Algorithms & tools

| Tool / algo | What it does | Corsair note |
|-------------|--------------|--------------|
| **RotSprite** (Xenowhirl) | Upscale ~8× via modified Scale2× (similar-pixel matches) → NN rotate+downscale → optional restore 1px details; **no new colors** | Best automatic; still not “ship-ready” at 16–32px |
| **Fast RotSprite** (Pixel Studio) | 3× up → rotate → 3× down; faster, slight quality loss | Runtime-oriented |
| **Aseprite** | Selection transform: **Fast Rotation** vs **RotSprite**; Edit→Rotate for 90/180; Shift-snaps angles | Set algorithm to RotSprite in prefs/transform UI ([docs](https://aseprite.org/docs/rotate/)) |
| **LibreSprite** | GPL fork of older Aseprite | Confirm RotSprite/transform options in your build UI before relying on it |
| Scale2x / hqx / xBR **then** rotate | Upscale with edge-aware scaler, rotate with bilinear/NN, downsample | Common DIY; can introduce **new colors** (hqx family) unless carefully quantized — worse for indexed pipelines |
| Astropulse **Clean Rotate** (itch, companion to RD) | Author points users needing better-than-NN rotate here | https://astropulse.itch.io/clean-rotate-for-aseprite |

Primary refs: [Wikipedia RotSprite](https://en.wikipedia.org/wiki/Pixel-art_scaling_algorithms#RotSprite) · [Aseprite Rotate docs](https://aseprite.org/docs/rotate/) · [GDSE thread](https://gamedev.stackexchange.com/questions/135091/how-can-i-rotate-pixel-art-sprites-without-the-aesthetics-getting-ruined) · Aseprite source `rotsprite.cpp`.

#### Failure modes at **16–32px** (expect these)

1. **1px features disappear** (ropes, gunports, bowsprit tip).  
2. **Jaggies / staircasing** on diagonals (22.5° and 45° worst).  
3. **Silhouette thickness changes** — ship “breathes” across facings.  
4. **Pivot / origin drift** if canvas not padded equally → in-game wobble.  
5. **Palette explosion** if you used hqx/bilinear path without re-index.  
6. **Asymmetry breaks mirrors** — can’t flip E→W if lantern is only on port side.  
7. Community consensus (Aseprite forums + GDSE): **45°+ on small sprites needs redraw**; RotSprite is a starting point.

#### Practical recipe

- **90° / 180°:** Aseprite Edit→Rotate (lossless for square canvases).  
- **22.5° / 45°:** RotSprite once → **manual redraw** of edges, masts, outlines.  
- Prefer **authoring at 2×** (e.g. work 64, ship at 32) only if final downsample is intentional; many Corsair assets want **native** authoring instead.  
- Never rotate at runtime with bilinear if you care about pixel look — prebake facings.  
- Free M0 path can **ignore RotSprite entirely** for the brig spike (3D turntable replaces it).

**Coverage strength:** Strong (docs + widespread practice). Weak on ship-specific examples.

---

### 3. Tiny native sizes (16×16, 32×32)

Parent doc already covers PixelLab GBA 32×32 tutorial (`moCpjMOOBGk`). Additions that show **real tiny** output:

| Approach | Evidence | Fit |
|----------|----------|-----|
| **PixelLab** character/object at native canvas (incl. GBA path); API Bitforge/Pixen from **32×32**; tileset API **16×16 / 32×32** | Official API price cards list 16×16 & 32×32 endpoints | Best AI for readable tiny **characters/tiles** |
| **Retro Diffusion** RD Plus: trained **≤256×256** native pixel; width/height params; site FAQ **16×16–512×512** by model; Minecraft/item styles stress **16/32** | Replicate RD Plus readme · retrodiffusion.ai FAQ schema | Strong for items/icons; comments note 16/32 weapons need more retries than 128+ |
| **Design rules (non-AI)** | Silhouette-first, 1–2px features max, limited palette, mid-stride loops, nearest in engine | Still the real quality bar |
| **Chong-U snap from 1024** | Parent doc | Fine for larger “fake pixel”; **not** a substitute for native 16×16 readability |

**Anti-pattern:** Generate 256, nearest-snap to 16, ship it — silhouettes collapse.

**Weak coverage:** Few public “before/after” galleries of AI **16×16 ships**; expect hand work.

---

### 4. Autotiles / blob / Wang / coast–reef

#### Concrete methods (not “don’t trust AI”)

| Method | Concrete steps | Output | Link |
|--------|----------------|--------|------|
| **Autotiler 2.0** (MIT, free) | Draw **13-tile** template (3×3 island + 2×2 inner corners) or RPG Maker A2 → export | Godot 4 TileSet + terrain peering, Tiled `.tsx` + Wang, PNG+JSON, dual-grid | https://route1rodent.itch.io/autotiler · web: itsjavi.com/autotiler · GH: https://github.com/itsjavi/autotiler |
| **AutoBlob** (Aseprite ext, $5.99 itch) | Draw **6** templates → blob47 or edge16 sheet + JSON masks | In-editor composition; palette preserved | https://violetpixel13.itch.io/autoblob · community: https://community.aseprite.org/t/extension-autoblob-generate-the-full-47-tile-blob-autotile-set-from-6-template-tiles/28606 |
| **Blobsmith** (Godot 4) | Autotile maker → Godot/Tiled export | Engine-ready terrains | https://blobsmith.itch.io/blobsmith |
| **Godot 4 Terrains** | Terrain Set mode **Match Corners and Sides** ≈ blob/47; paint peering bits; or import Autotiler `.tres` | Native paint | https://docs.godotengine.org/en/stable/tutorials/2d/using_tilesets.html |
| **Tiled Terrains** | Corner Set (16), Edge Set (16), Mixed (up to 256; blob47 works); Terrain Brush; Automapping for cliffs/multi-layer coasts | Map editor | https://doc.mapeditor.org/en/stable/manual/terrain/ |
| **PixelLab `create-tileset`** | API/UI top-down tileset; two terrain levels; chain ocean→beach→grass (per third-party MCP writeups + API) | Draft Wang-like sheets | Official API: https://www.pixellab.ai/pixellab-api — **16×16 $0.0079 / 32×32 $0.0099** (estimate, GPU-time varies) |
| **Grimoire** (Aseprite) | Wang/blob generation in-editor | https://blackmagikstudios.itch.io/grimoire-tilemap-generation | |

#### Coast / reef recipe (recommended)

1. Decide tile size (32×32 coast reads better than 16 for Corsair scale).  
2. Paint **water + sand/rock + reef** as terrains in one tileset.  
3. Use Autotiler **13-tile** template for land↔water blob47.  
4. Second pass: reef as **decor / probability tiles** on water (Godot tile probability or Tiled probability) — don’t force reef into the same 47 if it breaks seams.  
5. Cliffs / elevation: Tiled **Automapping** or separate layer — Terrain Brush alone won’t do multi-height well.  
6. Import to Godot Terrains; set Default Texture Filter **Nearest**.

**AI role:** Generate **base texture / style ref** or PixelLab two-level tileset draft → **always** run through Autotiler/hand peering for seams.

**Free stack:** Prefer Autotiler 2.0 over AutoBlob (same blob47 outcome, no Aseprite, $0).

---

### 5. Licensing & pricing (commercial) — fetch-dated

**Fetch window:** 2026-09-28 SAST. Official subscription UIs are often JS-rendered; where static HTML lacked dollars, values are labeled **secondary** and should be re-checked in-product before payment.

#### Summary table

| Product | Pricing model (fetched) | Commercial / ownership | Source + date |
|---------|-------------------------|------------------------|---------------|
| **PixelLab** | **Subscription** (web + Aseprite) + **API pay-per-gen**. Secondary reports (May–Sep 2026): Pixel Apprentice **~$12/mo**, Artisan **~$24/mo**, Architect **~$50/mo**; gen pools differ across writeups (~1k–2k / ~3k–5k / ~6k–10k) — **verify in UI**. Free trial (FAQ: limited tools; one review cites 40 gens). Enterprise custom. | ToS **1.3 / 3.3**: you own copyrights; commercial OK; **do not train other models** on outputs; Open RAIL-M compliance. Steam AI disclosure OK per FAQ. | ToS https://www.pixellab.ai/termsofservice (Last Updated **2025-11-23**) · FAQ https://www.pixellab.ai/docs/faq · API prices https://www.pixellab.ai/pixellab-api · pricing page https://www.pixellab.ai/pricing (JS; no static $-tiers scraped 2026-09-28) · secondary: gamelabstudio.co 2026-05-07, righterofwords 2026-09-10 |
| **PixelLab API** (primary $) | Per-call **estimates** (GPU time varies). Examples: Pixflux 64² **$0.00793** … 400² **$0.0132**; Bitforge 32² **$0.0071**; **create-tileset** 16² **$0.0079**, 32² **$0.0099**; rotate ~**$0.01057** @64; **8 rotations v3** 32² **$0.0293** … 256² **$0.0377**; Pro tools often **~$0.095–$0.185** | Same ToS / API terms; programmatic use only via official API | https://www.pixellab.ai/pixellab-api fetched **2026-09-28** |
| **Retro Diffusion (website)** | **Prepaid credits**; new accounts **50 free**; packs **from $5**; ~**$0.015/image** messaging on homepage FAQ schema. Exact pack table not fully static-scraped — shown before each gen. | FAQ: generated art **yours**, personal **and commercial**. itch Q&A: “you own the images.” | https://retrodiffusion.ai/ · learn-more FAQ · fetched **2026-09-28** |
| **Retro Diffusion (Aseprite extension)** | **One-time** itch: **Full $65**, **Lite $20**; no sub/credits for local model. **Different models than website.** Being phased toward a native RD editor (itch notice). | Owner statement: commercial OK / you own gens. Local offline. | https://astropulse.itch.io/retrodiffusion · lite https://astropulse.itch.io/retrodiffusionlite · fetched **2026-09-28** |
| **AutoSprite** | Free **$0** (15 monthly + 3 daily login). **Starter $12/mo** (500 credits). **Pro $29/mo** (1500, rollover up to 2×). Studio custom. Packs: 100 cr **$5**; Pro pack 400 **$9**. turbo anim **5 credits**. Isometric 8-dir pack **15 credits**. | ToS §4 (effective **2026-09-09**): you own outputs **to the extent permitted by inputs / third-party rights**; no training on user content by AutoSprite; AI starters may resemble existing IP — **you assume risk**. Marketing: commercial games OK. | https://www.autosprite.io/docs/reference-credits · https://www.autosprite.io/terms · fetched **2026-09-28** |

#### Corsair spend heuristics

- **Ship 16-dir M0:** $0 Blender path → don’t buy subs for this spike.  
- **Tiles / props burst:** RD **$5** credit pack or PixelLab trial/API tileset cents.  
- **Character animation volume:** AutoSprite Starter **$12** or PixelLab sub — compare after a one-week trial of free tiers.  
- **Local forever pixel tool:** RD extension **$20/$65** only if you want offline Aseprite gen (not website quality).

---

### 6. Brief: layered portraits / limited palette / LUT (day–night)

Easy extras (not blocking M0):

| Technique | How | Refs |
|-----------|-----|------|
| **Limited palette** | Author indexed; share one palette / PNG row across ships, tiles, UI | Indexed mode in Pixelorama/Aseprite; RD Palettize / PixelLab forced palette |
| **Palette swap / day–night** | Swap palette rows or LUT in shader driven by time-of-day uniform | https://github.com/Kobewi/Godot-Palette-Swap-Shader · https://godotshaders.com/shader/palette-swap-post-process-image-parametrized/ |
| **Layered portraits** | Separate face / eyes / mouth / lighting layers; modulate or swap for time | Standard editor layers → engine canvas layers; weak AI-specific coverage |
| **3D→sprite normals** | Render camera-space normals alongside beauty (Blender Workbench matcap / Foozle normals) for 2D lighting | PBIPJdEECWg + Foozle normals update |

---

### Gaps vs parent [[ai-game-sprites-research]]

| Topic | Parent coverage | This research |
|-------|-----------------|---------------|
| General AI sprite pipelines, PixelLab GBA, snap/mixels | Deep | Pointer only |
| **16-facing vehicles / ships** | Out of scope / 8-dir character focus | **Primary** |
| **RotSprite / tiny rotate failure** | Mentions mirror; not RotSprite deep | **Primary** |
| Autotiles / Wang / blob | Anti-pattern “don’t trust AI tiles” only | **Concrete tools + coast recipe** |
| Pricing / ownership | Tools named, little $ | **Dated table + API $** |
| Free-first install path | — | **Part B** |
| Day-night LUT | — | Brief |

---

### Suggested M0 brig spike (evidence-backed)

1. Block out low-poly brig in Blender (silhouette pass).  
2. Ortho Empty-rig; render **16** yaws at **64×64** (or final native).  
3. Pixelorama / LibreSprite cleanup + shared Corsair palette.  
4. Drop into Godot with nearest filtering; verify no foot/keel drift.  
5. **Only then** decide if PixelLab/RD spend is worth it for **crew, cargo, reef tiles** — not for replacing the ship facing pipeline.

Timebox: one afternoon proves whether 3D→pixel reads “Corsair” better than RotSprite or 8-dir AI upscaled to 16.

---

## Part B — Free-first tool stack

**Goal:** M0 brig (16 facings via 3D→pixel), duel characters, coast autotiles — **$0 required**.  
**Rule:** Prefer free/open-source; paid only as optional.

### Must-have (M0 without spending)

| Tool | Role | Free? | License (one-line) |
|------|------|-------|--------------------|
| **Blender** | Low-poly ship/character; ortho turntable; 16 yaw renders | Yes | GNU GPL (v2+ code; binaries GPL-compatible) — free forever, commercial use OK |
| **Pixelorama** | Primary free pixel editor: cleanup, indexed palette, sheets, duel frames | Yes | MIT |
| **LibreSprite** | Free Aseprite-like editor (fork of last GPLv2 Aseprite); alternate cleanup / rotate | Yes | GPL-2.0-only |
| **Autotiler 2.0** | 13-tile (or A2) template → blob47 / dual-grid; Godot 4 TileSet + Tiled `.tsx` | Yes (app + web) | MIT |
| **Tiled** | Coast/reef map layout, terrains, automapping | Yes | App primarily GPL-2; libs BSD — **your maps are yours** |
| **Godot 4** | Runtime: TileMap terrains, AnimatedSprite2D, nearest filter | Yes | MIT |

### Nice-to-have (still free)

| Tool | Role | Free? | License (one-line) |
|------|------|-------|--------------------|
| **Maghwyn blender_directional_spritesheets** | Blender Python: **4/8/16/32** directional sheets + Rust packer | Yes | MIT |
| **FoozleCC blender_scripts** | 4/8-dir render script; extend angles to 16; itch `.blend` templates | Yes (script MIT; itch templates free download) | MIT (GitHub scripts) |
| **framemill** | Headless Blender → 1/4/8/**16** sheets from FBX/GLB; GUI wrapper | Yes | GPL-3.0-only (tool); **your renders remain your art** |
| **rembg** | Optional BG remove for duel concept stills / AI drafts | Yes (pip) | Tool **MIT**; **check each model’s license** (some non-commercial) |
| **GIMP** | Occasional raster / palette / batch outside pixel editor | Yes | GPL-3-or-later |
| **Krita** | Concept paint / soft shading refs (not primary pixel ship tool) | Yes | GPL-3 |

### Optional paid (do **not** buy for M0 ship spike)

| Tool | Why optional | Price note (fetched 2026-09-28) |
|------|--------------|----------------------------------|
| **Aseprite** | Best-in-class pixel editor; documented **RotSprite** + **Fast Rotation** | Official FAQ: **$19.99 USD** minimum for 1.x binaries (EULA; not redistributable). Keep if owned; not required for free path |
| **AutoBlob** | 6-template → blob47 inside Aseprite | itch: **$5.99 USD** (requires Aseprite 1.3+) — skip; use Autotiler instead |
| PixelLab / Retro Diffusion / AutoSprite | Crew, props, tile *drafts* | See Part A §5; **check in-product** before spend |

### Role of each tool (brig + duel + coast)

#### A. M0 brig — 16 facings (3D → pixel)

| Step | Tool | What you do |
|------|------|-------------|
| 1. Silhouette model | **Blender** | Thick readable parts; hull/deck/mast as separate meshes if overlays needed; avoid 1px-thin ropes in geo |
| 2. Camera rig | **Blender** (+ optional **Foozle** / **Maghwyn** scripts) | Ortho camera on Empty; fixed tilt; rotate Empty by **22.5° × 16**; transparent BG; filter/AA off or nearest |
| 3. Batch 16 renders | **Maghwyn** (native 16) or **framemill** (angles=16) or Foozle extended to 16 | Same framing every shot; optional normals pass later |
| 4. Pixel cleanup | **Pixelorama** or **LibreSprite** (or Aseprite if owned) | Stray pixels, shared Corsair palette, sheet by rows; overlays as layers |
| 5. Engine check | **Godot** | Import sheet; **Nearest** texture filter; verify keel/pivot does not drift |

#### B. Duel characters

| Step | Tool | What you do |
|------|------|-------------|
| Anchor still | Hand in **Pixelorama** / **LibreSprite**, or optional AI draft | South-facing neutral; solid/chroma BG; native size (e.g. 32×32) |
| BG remove (if needed) | **rembg** (MIT tool; pick a commercially OK model) or manual erase | Prefer painting on flat BG so keying is rare |
| Facings / anim | Hand + mirror when geometry allows; optional AI for *drafts only* | Mirror W/SW when art allows; mid-stride walk starts |
| Polish + sheet | **Pixelorama** / **LibreSprite** | Onion-skin, foot lock, indexed palette, export PNG sheet |
| Runtime | **Godot** AnimatedSprite2D / AnimationPlayer | Nearest filter; shared palette if day–night later |

#### C. Coast / reef autotile

| Step | Tool | What you do |
|------|------|-------------|
| Paint template | **Pixelorama** / **LibreSprite** | Prefer **32×32** coast; **13-tile** Autotiler template (3×3 island + 2×2 inner corners) |
| Expand blob set | **Autotiler 2.0** (web or Mac app) | Export Godot 4 `.tres` + peering, and/or Tiled `.tsx` Wang |
| Map / cliffs | **Tiled** | Terrain brush; reef as probability/decor tiles; Automapping for elevation |
| Play in engine | **Godot** Terrains | Import Autotiler export or Tiled; Default Texture Filter **Nearest** |

### What NOT to buy yet

Defer until **after** the M0 brig afternoon spike proves the look:

1. **Aseprite** — only if free editors block you (or buy later for RotSprite / extension ecosystem). If you already own it, use it; don’t treat repurchase as a gate.
2. **AutoBlob** — Autotiler 2.0 is free and exports Godot/Tiled directly.
3. **PixelLab / Retro Diffusion / AutoSprite subscriptions or credit packs** — not needed for 16-dir ship proof; optional later for crew/props/tile *drafts* (re-check $/ToS in UI).
4. **AUTeddy / other paid Blender camera rigs** — Maghwyn + Foozle + framemill cover free 16-dir.
5. **Clean Rotate / Grimoire / Blobsmith** — nice later; not M0 blockers.
6. **Any “AI 16 unique ship facings” spend** — PixelLab tops out at **4/8** rotations officially; identity drift across 16 is the failure mode.

### Install order (Mac)

Apple Silicon / Intel: prefer native builds. Order minimizes “blocked on X”.

1. **Blender** — https://www.blender.org/download/ (macOS Apple Silicon or Intel; recent LTS OK).  
2. **Godot 4** — https://godotengine.org/download (standard .NET-free build unless you need C#).  
3. **Pixelorama** — itch/GitHub Mac `.dmg` (v1.2.x as of checks).  
4. **LibreSprite** — https://libresprite.github.io/ (or GitHub releases) as backup pixel editor.  
5. **Tiled** — https://www.mapeditor.org/ or itch (macOS 13+ build).  
6. **Autotiler 2.0** — use **web** first (zero install): itsjavi.com/autotiler or itch page; optional Mac `.dmg` (not notarized — first open → System Settings → Privacy & Security → Open Anyway).  
7. **Scripts / wrappers** (after Blender works):  
   - Maghwyn: `git clone` https://github.com/Maghwyn/blender_directional_spritesheets  
   - Foozle: https://github.com/FoozleCC/blender_scripts (+ optional itch `.blend` templates)  
   - framemill (optional): `pipx install framemill` then `framemill` (needs Blender 4.2+ on PATH or pointed in app; Python 3.10+)  
8. **rembg** (optional): `pipx`/`pip` install; pick model after reading its license.  
9. **GIMP / Krita** (optional): Mac builds from gimp.org / krita.org when you need them.  
10. **Aseprite** — only if deciding to pay later, or already owned.

**Homebrew tip (optional):** many of the above exist as casks/formulae — prefer official site if brew lags; never invent version pins here.

### License one-liners (known)

| Tool | License (short) |
|------|-----------------|
| Blender | GNU GPL (free software; commercial use OK; your artwork is yours) |
| Pixelorama | MIT |
| LibreSprite | GPL-2.0-only |
| Aseprite (paid binaries) | Proprietary EULA; source available but redistributing builds forbidden since 2016 |
| Autotiler 2.0 | MIT |
| Tiled | GPL-2 (app) + BSD (libs); maps you create are your copyright |
| Godot | MIT |
| Maghwyn directional sheets | MIT |
| FoozleCC blender_scripts | MIT |
| framemill | GPL-3.0-only (distributing modified *tool* carries GPL duties; renders are your art) |
| rembg | MIT (code); **models have separate licenses — check before commercial** |
| GIMP | GPL-3-or-later |
| Krita | GPL-3 |
| AutoBlob | Paid proprietary extension (itch); not in free stack |
| RotSprite algorithm | Classic Xenowhirl algo; shipped inside Aseprite (documented); confirm in LibreSprite UI |

---

## Skill pointer (for [[ai-game-sprites-SKILL]])

```markdown
## Corsair (ships / tiles / free stack / licensing)
See merged research (not the broad YT sweep):
- Project docs: `docs/corsair-pixel-art-research.md`
- Also staged on box: `/workspace/project-corsair-docs/corsair-pixel-art-research.md`
Key: 16-dir ships → Blender ortho turntable > RotSprite > AI-16;
autotiles → Autotiler → Godot Terrains;
$0 stack: Blender → Pixelorama → Autotiler → Tiled → Godot;
pricing table inside research (re-fetch before spend).
```

---

## Link index (quick)

**Ships / rotate / Blender**
- Aseprite Rotate: https://aseprite.org/docs/rotate/  
- RotSprite: https://en.wikipedia.org/wiki/Pixel-art_scaling_algorithms#RotSprite  
- Blender pixel complete: https://www.youtube.com/watch?v=PBIPJdEECWg  
- Foozle 8-dir: https://www.youtube.com/watch?v=l1Io7fLYV4o  
- Maghwyn 16/32: https://github.com/Maghwyn/blender_directional_spritesheets  
- framemill: https://pypi.org/project/framemill/  

**Autotiles / engine**
- Autotiler: https://route1rodent.itch.io/autotiler · web itsjavi.com/autotiler  
- Tiled terrains: https://doc.mapeditor.org/en/stable/manual/terrain/  
- Godot TileSets: https://docs.godotengine.org/en/stable/tutorials/2d/using_tilesets.html  

**Free editors / engine**
- Blender: https://www.blender.org/ · license https://www.blender.org/about/license/  
- Pixelorama: https://www.pixelorama.org/ · https://orama-interactive.itch.io/pixelorama  
- LibreSprite: https://libresprite.github.io/  
- Aseprite buy/FAQ: https://www.aseprite.org/buy/ · https://www.aseprite.org/faq/  
- Tiled: https://www.mapeditor.org/  
- Godot: https://godotengine.org/  
- rembg: https://github.com/danielgatis/rembg  
- GIMP: https://www.gimp.org/ · Krita: https://krita.org/  

**Paid AI (optional later)**
- PixelLab ToS / API / FAQ: https://www.pixellab.ai/termsofservice · https://www.pixellab.ai/pixellab-api · https://www.pixellab.ai/docs/faq  
- Retro Diffusion: https://retrodiffusion.ai/ · https://astropulse.itch.io/retrodiffusion  
- AutoSprite credits / terms: https://www.autosprite.io/docs/reference-credits · https://www.autosprite.io/terms  
- AutoBlob (paid, skip for M0): https://violetpixel13.itch.io/autoblob  

*End of merged Corsair research.*
