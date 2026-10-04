<!-- project.corsair canonical copy — 2026-09-28 -->
<!-- Path: ~/Development/project.corsair/docs/ai-game-sprites-SKILL.md -->

---
name: AI game sprites
description: >-
  Use when creating or animating 2D game sprites / sprite sheets with AI (pixel
  or HD)—anchors, facings, walk cycles, packing, cleanup, and engine export
  instead of one-shot image gens.
---
# Create Game Sprites with AI

Produce **2D game-ready sprites or sprite sheets** (characters, enemies, props, VFX loops, UI icons) with AI, then clean and pack them for **any engine** (Unity, Godot, Phaser, GameMaker, custom).

Prefer this over generic “generate an image” whenever the asset must **animate, stay on-model, and import cleanly**.

---

## When to use

**In scope:** pixel-art and higher-resolution 2D sprites; static frames and animation sheets (idle, walk, run, jump, attack, hurt, death, custom); cleanup, consistency, packing, and engine export.

**Out of scope / brief aside only:** full 3D mesh/rig pipelines; pure cinematic concept art with no gameplay sheet; commissioning human artists (recommend when the AI quality bar isn’t met).

---

## Goals and quality bar

A finished deliverable should:

1. **Read at game scale** — silhouette clear at intended on-screen size.
2. **Stay consistent** — same character identity across facings and frames (no morphing outfit/face/height).
3. **Have clean alpha** — no muddy halos; intentional outline if style needs it.
4. **Use uniform cells** — equal frame dimensions; predictable grid or atlas.
5. **Pivot stably** — feet (or agreed pivot) locked so playback doesn’t bob/slide.
6. **Match art direction** — shared palette, camera (side / top-down / iso), outline rules.
7. **Import without drama** — PNG (+ atlas JSON if available), nearest-neighbor for pixel art, documented frame order/FPS.

**Pixel-art bar:** true on-grid pixels (or purpose-built pixel model output)—not anti-aliased “mixels” that only look pixelated when zoomed out.
**HD 2D bar:** sharp edges, stable proportions, SAM/high-quality matting preferred over crude color-key if sprites are large on screen.

Prototype may ship “fake pixel” / rough HD; **production pixel** should snap or use a true pixel pipeline.

---

## Tool map (pick by need, not brand loyalty)

| Need | Prefer |
|------|--------|
| True pixel from the start | PixelLab, Retro Diffusion (web or Aseprite extension), Sprite Fusion / similar pixel-native tools |
| One still → many animations fast | AutoSprite; or concept → short I2V → Spritly-class frame tools |
| Max control / local / batch | ComfyUI + character LoRA + pose control + rembg + grid/atlas nodes |
| General stills / style exploration | GPT Image, Flux, Midjourney, SDXL, etc. → then specialize |
| Walk cycles that don’t suck | Image-to-video from a **neutral** side/front anchor (e.g. Seedance-class I2V), then frame pick |
| Manual polish / onion-skin | Aseprite (standard), Pixelorama, LibreSprite, Piskel |
| Recover real pixels from AI “pixel” | Sprite Fusion Pixel Snapper (or equivalent K-color + edge snap) |
| Engine-native prototype | Unity AI Sprite Generator (when available); else import PNG/atlas |

Always plan a **cleanup pass**—AI gets you most of the way; shipping quality usually needs human pixel/paint fixes on hands, weapons, helmets, and contact points.

---

## Canonical workflow (engine-agnostic)

### 0. Spec first (5 minutes)

Write down before generating:

- Camera: side-scroller | top-down 4/8-dir | isometric
- Native cell size (e.g. 16 / 32 / 48 / 64 / 128 / 256)
- Palette (Lospec or project `.gpl`) and outline rules
- Animations + target frame counts + FPS feel (pixel often 8–12 fps; HD 12–24)
- Pivot convention (foot baseline center-bottom is common)

### 1. Style lock + hero anchor

1. Generate or paint a **single full-body reference** at high res (often 1024×1024 for snap pipelines) or **native pixel size** for pixel-native tools.
2. Use **flat chroma / solid BG**, strong silhouette, correct camera, no photoreal, limited palette language.
3. For pixel look from general models: **pixel-snap** → nearest-neighbor upscale → this becomes the **canonical anchor**.
4. For pixel-native tools: clean the base frame in-editor **before** any animation.
5. Keep anchors **neutral** (no baked attack FX / wrong prop) if you will I2V walk later.

### 2. Facings / directions

- Generate N/E/S/W (and diagonals if needed) **from the snapped/cleaned anchor**, not from unrelated prompts.
- Re-snap or re-clean each facing.
- Often **east = horizontal flip of west** (and SW from SE) to save gens—verify shadows/asymmetric gear first.
- Optional: checkerboard / pixel-grid guide image helps general models keep a pixel discipline.

### 3. Animation

**Still-model pose boards (idle, attack, hurt, death, jump):**
- Condition on the facing anchor + a **pose-board canvas** (large cells, e.g. ≥512px per cell before snap).
- Prompt either a coherent short action **or** frame-by-frame beats.
- Heuristic frame budgets (tune per game): idle 8–10, attack 6–8, hurt/jump ~6, death 8–10.
- Prefer **not** starting attack sheets on a duplicate idle hold.

**Walk / run:**
- Prefer **image-to-video** from the neutral side (or mid-stride) anchor; extract frames; pick 8–12 for a clean loop.
- Or purpose-built walk templates (PixelLab etc.).
- Tip: start walks from a **mid-stride** frame, not a planted idle, for smoother loops.
- Still-model “full walk sheet in one image” is a common failure—treat as last resort.

**Purpose-built tools:**
- AutoSprite: upload character → select moveset → generate → preview → PNG + JSON atlas.
- PixelLab: rotations → templates / skeleton / animate-with-text → edit in Pixelorama/Aseprite.

### 4. Recover, clean, align, pack

1. **Recover frames** with chroma/alpha + bounding boxes—not naive equal crops of uneven AI grids (avoids bleed).
2. Curate: drop broken / redundant frames; retiming by selection.
3. Per-frame pixel-snap (pixel pipeline) or edge cleanup (HD).
4. **Align** to shared pivot (onion-skin / frame aligner); normalize height.
5. Despeckle chroma crumbs; final BG removal if needed.
6. Pack **uniform grid** sheet; write atlas JSON or clear naming (`char_walk_s_01.png`…).
7. Spot-fix in Aseprite: hands, weapons, eye line, contact shadows.

### 5. Export into the engine

- Import PNG; slice by cell size or consume atlas.
- Pixel art: **Nearest** / pixel-perfect camera; integer scale.
- Set animation FPS to feel, independent of raw frame count.
- Verify no bobbing while idle/walk; fix pivot if needed.
- Keep source `.aseprite` / layered masters for iteration.

### Alternate: ComfyUI production loop

1. Train or load **character LoRA** (15–20 clean multi-angle refs; stable features).
2. Batch pose/angle prompts with LoRA strength ~1.0–1.2; lock sampler settings.
3. Background removal (rembg or SAM for HD edges).
4. Grid / atlas pack node or script.
5. Optional ControlNet OpenPose for walk/attack beats.
Do **not** try to get identity + pose + sheet layout perfect in one chaotic pass—separate stages.

### Alternate: Own pixel LoRA (advanced)

- Caption carefully (manual > bad auto-labels).
- Prefer SDXL-class bases for pixel LoRAs when comparing 1.5 vs XL.
- Keep LoRA **rank modest** for pixel style (over-capacity can destroy the look).
- Train long enough that sprites cohere; validate on held-out prompts.
- Still run cleanup + packing as above.

---

## Prompt patterns (copy and adapt)

**Pixel / retro sprite still:**
`[game camera: side-view OR high top-down], [subject], [outfit/props], pixel art, [era: GBA / SNES RPG / 16-bit], limited palette, crisp 1px outline, strong readable silhouette, flat [chroma green] background, no anti-aliasing, sharp pixel edges, not photorealistic, game asset sprite`

**HD stylized 2D still:**
`[camera], full body [subject], clean cel-shaded / hand-painted 2D game art, consistent design, solid [color] background, no text, no watermark, game character sprite`

**Pose board / sheet guide:**
`Same character as reference, [N] readable [action] poses in a coherent short game animation, uniform spacing, each cell full body visible, flat chroma background, keep identity and scale consistent across frames`

**I2V walk:**
`Neutral [facing] game character walking cycle in place, loops cleanly, fixed camera, solid background, no cinematic camera move, limbs articulate clearly`

**Negatives (general):**
`photorealistic, blurry, anti-aliased mush, text, watermark, extra limbs, cropped head/feet, busy background, trademark logos`

Use **edit/ref mode** with the anchor image whenever the tool supports it. Identity lives in the reference; prompts describe **only** what should change (pose, facing, action).

---

## Consistency tricks (checklist mindset)

- [ ] One accepted **anchor** before any animation spend
- [ ] Snap / pixel-native model before chaining generations
- [ ] Shared palette file
- [ ] Same seed family / locked samplers for related frames when using SD
- [ ] LoRA or style-reference for multi-character cast
- [ ] Pose control (skeleton / OpenPose) when free posing drifts
- [ ] Mirror symmetric facings instead of regenerating
- [ ] Mid-stride walk starts
- [ ] Foot baseline lock before engine import

---

## Anti-patterns (do not)

- Ship unsnapped generic-AI “pixel art” as final pixel assets
- Equal-slice a sheet that isn’t actually on a grid
- Skip pivot alignment
- Generate walk cycles only with still image models when I2V/templates exist
- Mix cameras (top-down head on a side-view body)
- Linear-filter pixel art in-engine
- Trust AI for seamless tiles without tile-specific tools / hand fixes
- Leave readable real-world brand text in backgrounds
- Endless regen instead of a 2-minute manual fix on a few pixels
- Change canvas/style-ref size mid-cast and wonder why scale drifted

---

## Decision guide

| Situation | Path |
|-----------|------|
| Need true pixel, small team, paid OK | PixelLab or Retro Diffusion → Aseprite polish |
| Have one great still, need moveset yesterday | AutoSprite (or I2V + frame tool) |
| Strict on-model + many chars + GPU | ComfyUI + LoRA + batch poses |
| Prototyping vibe / HD stylized | General image AI → I2V → Spritly-class → polish |
| Must match existing hand pixel pack | Lock palette; RD/PixelLab with palette; heavy Aseprite; or train LoRA on your pack |
| Walk cycle looks wrong | Neutral anchor → I2V → curate frames → align feet |

---

## Deliverable checklist (before calling done)

- [ ] Spec recorded (camera, size, palette, anim list, FPS)
- [ ] Canonical anchor saved
- [ ] All required facings accepted
- [ ] Each animation: curated frames, clean alpha, stable pivot
- [ ] Sheet(s) packed with documented layout **or** atlas JSON
- [ ] In-engine smoke test: idle, walk, attack; no bleed/bob; filter mode correct
- [ ] Sources + prompts + tool versions noted for reproducibility
- [ ] License/ToS of each AI tool respected for commercial use

---


---

## Corsair (ships / tiles / free stack / licensing)

See merged research (not the broad YT sweep):

- Project docs: `docs/corsair-pixel-art-research.md`
- Also staged on box: `/workspace/project-corsair-docs/corsair-pixel-art-research.md`

Key: 16-dir ships → Blender ortho turntable > RotSprite > AI-16;  
autotiles → Autotiler → Godot Terrains;  
$0 stack: Blender → Pixelorama → Autotiler → Tiled → Godot;  
pricing table inside research (re-fetch before spend).


## Sources (research basis)

Synthesized from top YouTube tutorials and docs (views scraped 2026-09-27), including:

- Chong-U — *Stop Generating Fake Pixel Art Game Sprites* — https://www.youtube.com/watch?v=nIAIxvNUrdU (+ https://github.com/chongdashu/ai-pixel-snapped-game-sprites)
- Chong-U — *Create 2D Game Characters Using AI* — https://www.youtube.com/watch?v=ftWQpHyWcVQ
- Game.DevDude — *From AI Character Art to Animated Sprite* — https://www.youtube.com/watch?v=sTuzV9RxWro
- PixelLab tutorials (skeleton, character creator, GBA-style) — e.g. https://www.youtube.com/watch?v=inyHAOkwDlc , https://www.youtube.com/watch?v=moCpjMOOBGk
- DevDude — directional Spritly workflow — https://www.youtube.com/watch?v=LqZFYJC0NFU
- Not4Talent — SD pixel/tileset — https://www.youtube.com/watch?v=FIOXGWCQgAI
- pookie — pixel LoRA — https://www.youtube.com/watch?v=OdafuDeNMyM
- Astropulse — Retro Diffusion guides — https://www.youtube.com/watch?v=MU4k1ommJnU
- AutoSprite docs — https://www.autosprite.io/docs/how-to-use
- ComfyUI spritesheet practices — https://apatero.com/blog/generate-clean-spritesheets-comfyui-guide-2025

Full ranked list and notes: companion research `docs/ai-game-sprites-research.md`.
