# Project Corsair

**A single-player pirate career game for the browser, set in the 17th-century Caribbean.**

Captain a ship across a living, real-scale Caribbean. Trade between ports, take on governors' missions, hunt pirates or turn pirate yourself, and fight ship-to-ship battles in 3D, until age and wounds make you retire. Nations go to war, blockades come and go, and merchants, warships and raiders sail their own routes whether you're there or not.

**[▶ Play the current build](https://corsair.dirkkok.workers.dev)** (desktop browser; a GeForce RTX 3070 or similar is the target GPU)

> Project Corsair is in active early development. Expect rough edges, missing systems and saves that break between builds.

## Design pillars

- **The best sailing.** Wind, weather and sea state matter. The sea follows the weather, and the sea and sky are rendered realistically in 3D.
- **The best combat.** Ship-to-ship battles about wind, gunnery arcs, weight of shot, rigging damage, crew and boarding. Enemy captains pick their fights and run when they're outgunned.
- **Trading worth doing.** Ports with their own supply, demand and troubles (plague, blockades, war) make routes worth planning.
- **Freedom of career.** No main quest. Be a privateer, pirate hunter, merchant or treasure hunter, and switch when you like.

## What's in the game today

- A real-scale 3D Caribbean with day and night, weather and a wave model driven by sea state
- Sailing by wind with an autopilot, a sea chart you can zoom and pan, and fog of war out to the horizon
- Merchants, navies, pirate hunters and pirates sailing the sea, with hidden pirate coves and blockaded ports
- Sea battles: broadsides, raking fire, sail and mast damage, shoals, boarding and repair at sea
- Port economies: buying and selling goods, signing on crew, repairs and plague
- Governors who offer missions and promotions
- Period flags, ships and harbour scenes, with recorded and synthesised sound

## Running it locally

Requirements: [Node.js](https://nodejs.org) (current LTS), [pnpm](https://pnpm.io), and [Git LFS](https://git-lfs.com) (the source paintings are stored in LFS).

```bash
git lfs install
git clone https://github.com/dirkkok101/project.corsair.git
cd project.corsair
pnpm install
pnpm dev          # start the game in a Vite dev server
```

Other scripts:

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests (Vitest) |
| `pnpm typecheck` | TypeScript type check |
| `pnpm build` | Production build into `apps/web/dist` |
| `pnpm e2e` | Browser tests (Playwright) against the build |
| `pnpm verify` | All of the above: the gate every change must pass |
| `pnpm verify:balance` | Slower balance simulations for combat and economy tuning |

## How it's built

TypeScript throughout, organised as a pnpm monorepo. Game rules are deterministic simulations kept separate from rendering, so systems can be tested and replayed headlessly.

| Path | Contents |
|---|---|
| `apps/web` | The browser game: UI (Preact), game loop, screens |
| `packages/core` | Simulation state, calendar, seeded random numbers, saves |
| `packages/data` | Game data as JSON: ships, goods, economy, combat, map |
| `packages/systems-*` | Simulations: economy, navigation, politics, traffic, weather |
| `packages/minigame-sea-battle` | Ship-to-ship combat |
| `packages/render3d` | The 3D sea, sky, ships and land ([three.js](https://threejs.org)) |
| `packages/render`, `packages/audio` | 2D harbour scenes and flags; sound effects and music |
| `tools/` | Asset pipelines for map, art, audio and music |
| `art/` | Game art, audio, fonts and source files |
| `docs/` | Design documents and research ([index](docs/README.md)) |

## Contributing

Bug reports, playtest feedback and ideas are welcome as [issues](https://github.com/dirkkok101/project.corsair/issues). If you want to contribute code, open an issue first to talk through the change, then send a pull request from a fork. Every pull request must pass `pnpm verify` and be reviewed before it is merged.

## Licence

- **Code** is under the [MIT License](LICENSE).
- **Original art, audio, music and writing** (under `art/` and `docs/`) are under [CC BY 4.0](LICENSE-ASSETS.md).
- **Third-party assets** keep their own licences: sound effects are CC0 or public domain (see [`art/audio/CREDITS.json`](art/audio/CREDITS.json)), and the fonts are under the SIL Open Font License (see `art/game/fonts`).

## Acknowledgements

Project Corsair is inspired by Sid Meier's *Pirates!* (1987 and 2004) and other age-of-sail games. It is an independent, original work and is not affiliated with or endorsed by Firaxis Games, MicroProse, Take-Two Interactive or any other rights holder. All names, art, music and text in the game are original or licensed as stated above.
