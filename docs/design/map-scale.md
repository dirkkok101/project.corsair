# Slice: the world at 1.5x

Planned 2026-10-11. The Caribbean map is rebuilt at 1.5x its resolution, 2400 x 1650 tiles in place of 1600 x 1100,
over the same longitudes and latitudes. A tile shrinks from about 2.5 km to about 1.67 km. Ships keep their size and
speed in tiles, so islands, coasts and the distances between ports are 1.5x larger against a ship.

**Decided (2026-10-11):** voyages become longer too. The game currently feels quick, so the brig keeps her day's run
in tiles: a voyage takes 1.5x the sailing time and 1.5x the game days.

## 1. What changes and what stays

- **Scaled 1.5x** (the same piece of geography): the map itself, every distance that describes a place, a region
  or the reach of news and trade.
- **Kept** (measured against a ship): ship sizes and speeds in tiles, battle distances, hailing, docking, the
  camera's close views, towns' footprints.
- **Kept, with consequences:** the calendar (`ticksPerDay` 771) and every rate per day. Because a voyage now takes
  1.5x the days, food, wages, fouling and morale drift per voyage rise 1.5x. That is the point (longer voyages
  make provisions, ports of call and the crew matter), but it needs a balance pass (section 4).

## 2. The work, in order

### 2.1 Rebuild the map

1. `map.json`: width 2400, height 1650; the `$comment` to about 1.67 km a tile.
2. `tools/map/build-caribbean.ts`: `zoom` 7 → 8 (about 0.58 km a source pixel; z7 is too coarse to add real
   coastline at the new size). This fetches about 600 elevation tiles from the public AWS Terrain Tiles bucket
   once, into `tools/map/.cache/terrarium/8`; reruns are offline.
3. Rerun the build: `terrain.png`, `elevation.png` and `zones.png` together (the loader rejects any size mismatch).
4. Check the content test's spot checks (Jamaica, the Blue Mountains, the Bahama Bank) and that every settlement
   still places.

Settlements, wind zones, weather spawn areas and the start are placed by longitude and latitude, so they follow on
their own. Weather systems, storms and breezes are sized in km, so they also follow; storms and systems will move
1.5x faster in tiles against ships, because a day is the same length (accepted: a storm crossing feels as it does
now in real time, ships are slower against it).

### 2.2 Scale the geographic values (x1.5)

| Where | Value | Now | New |
|---|---|---|---|
| `traffic.json` | `pirateRangeTiles` | 140 | 210 |
| `traffic.json` | `convoys.entry` (east edge) | [1594, 560] | [2391, 840] |
| `treasure.json` | `placeTiles` | [6, 30] | [9, 45] |
| `treasure.json` | `ringTiles` | [40, 24, 14, 8] | [60, 36, 21, 12] |
| `treasure.json` | `stranger.nearTiles` | 200 | 300 |
| `treasure.json` | `clearOfTownsTiles` | 5 | 8 |
| `economy.json` | `news.tilesPerDay` | 80 | 120 |
| `economy.json` | `coasters.tiles` | 30 | 45 |
| `tilemap.ts` | `OPEN_SEA_SNAP_TILES` | 15 | 22 |
| `tilemap.ts` | `COAST_SNAP_TILES` | 3 | 4 |
| `lanes.ts` | `WAY_OUT_TILES` | 200 | 300 |
| `systems-economy` | `SEAWARD_LOOK_TILES` | 12 | 18 |
| `main.tsx` | harbour sound reach | 12 | 18 |
| `render3d` | `ZOOM.max` (the whole region), and `lab.ts` region zoom | 420 | 630 |
| `render3d` | `NAMES_WITHIN` (town names) | 160 | 240 |
| `traffic.json` | `laneCell` | 8 | 12 (the same coarseness; lanes cost what they do now) |

Comments that state km per tile are corrected with them.

### 2.3 Kept, deliberately

Battle (`combat.json` battle, guns, tactics, strike, salvage, swivels, near misses), chase and give-up ranges,
sight (`sightTiles` 30), hailing (3), docking (`DOCK_RANGE` 3, `BERTH_TILES` 2.8), arrival and waypoint
distances, harbour safe zones (`harbourTiles`, `capitalTiles`), blockade distance (12), the minimap's span
(240 x 135: it shows two thirds as much coast, at the same ship scale), ship labels, beach careening, digging,
towns' radius, wildlife, terrain chunk size and detail distances.

### 2.4 Decisions this slice makes as it goes (defaults in bold)

- **Traffic population**: the sea is 2.25x larger in tiles. **Raise `population` from 34 to about 50** so the
  lanes don't feel empty, then check with the voyage probe that encounters per voyage stay near today's
  (about one voyage in three for an armed brig).
- **Terrain heights**: islands are 1.5x wider at the same height, so relief looks flatter. **Scale the
  ground heights by 1.5** so islands keep their shape.
- **Far ships**: at the new region zoom, ships may need a larger far scale (`FAR_SHIP_SCALE` 4); check by eye.

## 3. Tests to update

- Fixed open-sea coordinates scale with the map: battle tests and every battle probe use `SEA = (880, 680)` →
  (1320, 1020); economy (880, 700) → (1320, 1050); weather storms (800, 550) → (1200, 825), the `> 700` check
  → `> 1050`, the spawn (1200, 600) → (1800, 900); e2e teleports to (880, 700/722/727) → (1320, 1050/1072/1077).
- Rebuilt layers: the content test's sizes and settlement placement; the terrain test (no land or town under
  water) on the new coast.
- Retuned by measurement, not by editing the assertion to pass: traffic arrivals per period, voyages per season
  and pirate odds per voyage, the economy-year market bounds, lanes legs, arrival within 600 ticks, the
  sailing-weather shares.
- Unaffected: navigation tests (their own small map) and politics.

## 4. Balance pass after the rebuild

Longer voyages change the economy, so the slice ends with the probes, not just green tests:

- **Voyage probe**: encounters per voyage by rung (target: unchanged per voyage).
- **Career probe** (`pnpm probe:career`): with voyages 1.5x longer, the trader's wage bill per voyage rises 1.5x.
  The last run already ended every year near broke because of wages (55,000 a year for a full brig against
  10,000-17,000 trade profit). The wage rate is the open question to settle here: options are a lower daily wage,
  wages only for days at sea, or a share of trade profit like the plunder chest.
- **Economy year**: markets stay in their bounds with fewer arrivals a year.
- **By eye**: a run from Port Royal to Tortuga, the chart at full zoom, and the islands' look from the ship.

## 5. Risks

- The z8 fetch needs the network once; if the bucket is unreachable, z7 rebuilds offline with less new coast detail.
- Some harbours may lose their mooring or way out on the new coast; the arrival and lanes tests catch these.
- Memory and start-up work grow about 2.25x (flood fill, lanes, terrain chunks); measure start-up time before and
  after.
