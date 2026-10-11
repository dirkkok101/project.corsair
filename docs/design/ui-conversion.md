# Plan: converting the game to the storyboard

Planned 2026-10-11; S1 (UI kit), S2 (sea HUD), S3 (harbour), S4 (merchant), S5 (tavern) and S6 (governor) built. How the game's screens become the ones in the storyboard mockups
([Corsair UI Storyboard](https://claude.ai/artifact/YAbWGj2B2zQ9xKvUVxdnCg), 30 artboards) and
[storyboard.md](storyboard.md): the art to make, the shared UI pieces, and the order of the slices. The principles
are those of [../reference/game-ui.md](../reference/game-ui.md) section 7.

## 1. What changes, in one paragraph

Every screen keeps what it does today; what changes is how it looks and how much it shows at once. Tables become
rows with a verdict word and one number; tab rows become the painted place (hotspots) or a short choice of three;
information comes from people (a bust and one sentence) and from short full-screen moments; the HUD shrinks to one
corner; the log becomes a book. The game logic changes only where a screen needs a fact the game doesn't keep yet
(listed per slice).

## 2. The art

### 2.1 Made in Grok Imagine (by you; prompts in `art/sources/paintings/README.md`, "Storyboard art")

| Group | Ids | Count | Needed by slice |
|---|---|---|---|
| people (busts) | `bust.merchant`, `bust.barmaid`, `bust.oldsalt`, `bust.stranger`, `bust.sailors`, `bust.shipwright` | 6 | S4-S7 |
| people (governors) | `bust.governor.england`, `.france`, `.netherlands`, `.spain` | 4 | S6 |
| people (captains hailed) | `bust.captain.merchant`, `.navy`, `.pirate` | 3 | S10 |
| moments | `moment.promotion`, `moment.famous`, `moment.hoard` | 3 | S9 |
| title | `loading.dawn`, `difficulty.1` to `difficulty.5` | 6 | S11 |
| fates (four more, to match the score's seven fates) | `fate.tavern`, `fate.planter`, `fate.council`, `fate.legend` | 4 | S13 |
| ui (icon sheet) | `ui.icons.fits`: the nine fit icons on one sheet | 1 | S7 |

About 27 images. Busts are painted on a flat magenta background, keyed out the way `import_ui.ts` already does for the ship panel art.

### 2.2 Made by tools (by me)

- **Ship card art for the six new classes** (pinnace, periagua, half-galley, galley-frigate, ketch, pink), and
  fresh cards for every class so they match the 3D ships: a new `tools/art/render_ship_cards.ts` renders each
  class's 3D plan (`rigs.ts`) headless, from the side, and snaps it to the palette.
- **The parchment chart**: drawn by `chart.ts` from the terrain in parchment colours (as the mockup's chart), not a
  painting.
- **Paper, wood and brass**: CSS, as in the mockups (no texture files).
- **Fonts**: IM Fell English and Alegreya Sans (both OFL) self-hosted in `art/game/fonts` beside Pirata One.

### 2.3 Pipeline additions

- `import_ui.ts` learns the `people` group: key out the magenta background, trim, scale to 192 × 224 on the
  palette, write `art/game/people/{id}.png` (transparent).
- Icon sheets: slice `ui.icons.fits` into `art/game/ui/ui.icon.fit.{id}.png` (24 × 20).
- `missing_art.ts` lists the storyboard ids, so what is still to paint is always one command away.

Until a painting exists, every screen shows the labelled silhouette placeholder the mockups use, so no slice waits
on art.

## 3. Shared UI pieces (slice S1)

One small kit in `apps/web/src/ui/`, used by every later slice:

| Piece | What it is |
|---|---|
| tokens (`style.css` `:root`) | ink, parchment, wood, brass, verdict gold and red (each a different lightness), the three fonts |
| `Wood`, `Paper` | the two panel kinds |
| `Speech` | a bust (or placeholder) and one line in IM Fell English |
| `Spot` | a labelled hotspot on a painting, with a badge |
| `Verdict` | a word and one number ("cheap here · 12") |
| `Band` | a named state with direction ("Content, falling") in place of a bare bar |
| `Toast` and a toast queue | short notes by the compass, rare and dismissable |
| `Moment` | a full-screen beat with one or two buttons |
| `Book` | the log's two-page spread with bookmarks |
| `Key` | a key cap |

## 4. The slices, in order

Each is its own branch, passes the full gate, and updates the e2e tests that select by the old markup. "New
state" lists what the game must start keeping.

| Slice | Screens (artboards) | Code | New state or logic |
|---|---|---|---|
| **S1 UI kit** | none visible | `ui/`, fonts, tokens | none |
| **S2 Sea HUD** | 4.1, 4.2, 4.5 | `hud.tsx`, `panel.tsx`, `main.tsx` | the prompt of the moment (one function choosing the key that applies now); the strip fades at rest; F1 help |
| **S3 Harbour** | 2.1 | `port.tsx` (harbour view) | `arrivalNews`: the single most useful fact on arrival; the tab row goes; Docks holds the harbour's ships and Retire… |
| **S4 Merchant** | 2.2 | `port.tsx` Merchant | the verdict word per good (from `priceStory` and what you paid); the best-sale hint as a sentence; "why" opens on click; two default actions |
| **S5 Tavern** | 2.3, 2.4 | `port.tsx` Tavern | news, contracts, the stranger and the crew split among four people; a small chart inset for news about a place |
| **S6 Governor** | 2.5 | `port.tsx` Governor | the summary since your last visit (new: the tick of your last call on each governor); one offer at a time |
| **S7 Shipwright** | 3.1-3.3 | `port.tsx` Shipwright | ship and fit cards with comparison lines; fleet management moves to the log |
| **S8 The log as a book** | 3.4, 6.1-6.3 | `log.tsx` | a logbook (new: dated entries for your deeds and the news you hear, kept to the last 200); the log opens in port too |
| **S9 Moments** | 6.4-6.6 | `main.tsx`, `ui/Moment` | a moment queue: war and peace letters, promotions, map pieces, a famous pirate's first sighting |
| **S10 Battle** | 5.1-5.4, 4.3 | `battle.tsx`, `hail.tsx` | named bands for hull, sails and men; the hail as a speech card |
| **S11 Start** | 1.1-1.4 | `start.tsx`, `main.tsx` | a loading screen while the map decodes; the opening letter and first goal |
| **S12 Chart** | 4.4 | `chart.ts` | parchment drawing; the port card with verdicts and their age |
| **S13 Retirement** | 7.1, 7.2 | `career.tsx` | the fate painting by score |

S2 and S3 change the most for the least art and come first. S4 to S7 each need one or two busts; their
placeholders hold until the paintings arrive.

## 5. Decisions taken in this plan (change any)

- **No nation choice yet**: the storyboard's nation step needs a start port per nation; it waits for its own slice.
- **Paper and wood are CSS**, not textures: crisp at any size, no art to wait for.
- **Pixel art stays** for paintings and busts, so the 22 existing paintings keep their place.
- **The log opens in port** (today it closes there), because fleet management moves into it.

## 6. Risks

- **E2E churn**: most world tests click through these screens; each slice rewrites its selectors to roles and
  labels so the next restyle doesn't break them again.
- **Art consistency**: busts from separate Grok batches may not match; one style block for every bust, and a review
  sheet (all busts side by side) before import.
- **Scope**: S8's logbook and S9's moments are new systems, not restyles; they are kept small (a list and a queue).
