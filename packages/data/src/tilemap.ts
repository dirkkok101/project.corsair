import { decode } from 'fast-png';
import type { MapDef, ProceduralMapDef, RasterMapDef, Settlement } from './schemas';

// Indices are stored in terrain.png, so they must match TERRAIN in tools/map/build-caribbean.ts.
export const Tile = { Deep: 0, Shallow: 1, Beach: 2, Jungle: 3, Hills: 4, Mountain: 5 } as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export interface TileMap {
  width: number;
  height: number;
  tileSize: number;
  tiles: Uint8Array;
  /** Land height band 0-7 per tile (PRD section 3); empty for procedural maps. */
  elevation: Uint8Array;
  /** Wind zone per tile: 0 is the default zone, i + 1 is wind_zones.json zones[i]; empty for procedural maps. */
  zones: Uint8Array;
}

/** Off-map counts as land, so ships can't sail out of the world. */
export function tileAt(map: TileMap, x: number, y: number): Tile {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return Tile.Jungle;
  return (map.tiles[ty * map.width + tx] ?? Tile.Jungle) as Tile;
}

export function isLand(tile: Tile): boolean {
  return tile >= Tile.Beach;
}

/** Map tile coordinates (fractional) of a longitude/latitude; the raster maps are equirectangular. */
export function tileOf(def: RasterMapDef, lon: number, lat: number): { x: number; y: number } {
  const { lonMin, lonMax, latMin, latMax } = def.bounds;
  return { x: ((lon - lonMin) / (lonMax - lonMin)) * def.width, y: ((latMax - lat) / (latMax - latMin)) * def.height };
}

/** Where the player's ship starts, in tile coordinates. */
export function startOf(def: MapDef): { x: number; y: number } {
  return 'bounds' in def ? tileOf(def, def.start.lon, def.start.lat) : { x: def.start.x, y: def.start.y };
}

/** Decodes a raster map's layer PNGs. IO stays with the caller, so this runs in the browser and in Node. */
export function decodeRasterMap(
  def: RasterMapDef,
  layers: { terrain: Uint8Array; elevation: Uint8Array; zones: Uint8Array },
): TileMap {
  const read = (name: string, bytes: Uint8Array) => {
    const png = decode(bytes);
    if (png.width !== def.width || png.height !== def.height || png.channels !== 1 || png.depth !== 8) {
      throw new Error(`${def.id} ${name}: expected ${def.width}x${def.height} 8-bit single channel`);
    }
    return png.data as Uint8Array;
  };
  const tiles = read('terrain', layers.terrain);
  const elevation = read('elevation', layers.elevation);
  const max = (data: Uint8Array) => data.reduce((m, v) => (v > m ? v : m), 0);
  if (max(tiles) > Tile.Mountain) throw new Error(`${def.id} terrain: unknown terrain index ${max(tiles)}`);
  if (max(elevation) > 7) throw new Error(`${def.id} elevation: band above 7`);
  return { width: def.width, height: def.height, tileSize: def.tileSize, tiles, elevation, zones: read('zones', layers.zones) };
}

/**
 * Land is any tile whose centre falls inside an island circle. Land touching water becomes
 * beach, and water within `shallowsTiles` of land becomes shallows.
 */
export function buildTileMap(def: ProceduralMapDef): TileMap {
  const { width, height } = def;
  const land = new Array<boolean>(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      land[y * width + x] = def.islands.some((c) => (x + 0.5 - c.x) ** 2 + (y + 0.5 - c.y) ** 2 <= c.r ** 2);
    }
  }
  const landWithin = (x: number, y: number, d: number) => {
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && land[ny * width + nx]) return true;
      }
    }
    return false;
  };
  const waterWithin1 = (x: number, y: number) =>
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dy]) => {
      const nx = x + dx!;
      const ny = y + dy!;
      return nx >= 0 && ny >= 0 && nx < width && ny < height && !land[ny * width + nx];
    });

  const tiles = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (land[i]) tiles[i] = waterWithin1(x, y) ? Tile.Beach : Tile.Jungle;
      else tiles[i] = landWithin(x, y, def.shallowsTiles) ? Tile.Shallow : Tile.Deep;
    }
  }
  return { width, height, tileSize: def.tileSize, tiles, elevation: new Uint8Array(0), zones: new Uint8Array(0) };
}

export interface PlacedSettlement extends Settlement {
  /** Centre of the coastal tile the settlement sits on. */
  x: number;
  y: number;
}

/** How far a settlement may be from the coast before its coordinates count as wrong (~7.5 km). */
const COAST_SNAP_TILES = 3;

/** How far a port may move to reach a beach on the open sea, when its own coast is a lake or lagoon (~37 km). */
const OPEN_SEA_SNAP_TILES = 15;

/**
 * Every water tile joined to the open sea: the largest connected body of water. A bay whose mouth is
 * narrower than a tile, or a coastal lagoon, is water on the map but cut off from it.
 */
export function openSea(map: TileMap): Uint8Array {
  const { width, height } = map;
  const seen = new Int32Array(width * height).fill(-1);
  let best = { id: -1, size: 0 };
  for (let start = 0, id = 0; start < width * height; start++) {
    if (seen[start]! >= 0 || isLand(map.tiles[start] as Tile)) continue;
    const stack = [start];
    seen[start] = id;
    let size = 0;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % width;
      for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (n < 0 || n >= width * height || seen[n]! >= 0 || isLand(map.tiles[n] as Tile)) continue;
        seen[n] = id;
        stack.push(n);
      }
    }
    if (size > best.size) best = { id, size };
    id++;
  }
  return Uint8Array.from(seen, (c) => (c === best.id ? 1 : 0));
}

/**
 * Snaps each settlement to the nearest beach tile on the open sea, so every port can be sailed to.
 * Throws listing every settlement with no coast within COAST_SNAP_TILES, which catches bad
 * coordinates in the data; a port whose nearby coast is only a lake or lagoon moves out to the
 * nearest open-sea beach within OPEN_SEA_SNAP_TILES.
 */
export function placeSettlements(def: RasterMapDef, map: TileMap, settlements: Settlement[]): PlacedSettlement[] {
  const failures: string[] = [];
  const sea = openSea(map);
  const onSea = (x: number, y: number) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = x + dx!;
      const ny = y + dy!;
      return nx >= 0 && ny >= 0 && nx < map.width && ny < map.height && sea[ny * map.width + nx] === 1;
    });
  const nearestBeach = (cx: number, cy: number, radius: number, open: boolean) => {
    let best: { x: number; y: number; d: number } | undefined;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (tileAt(map, cx + dx, cy + dy) !== Tile.Beach || (open && !onSea(cx + dx, cy + dy))) continue;
        const d = dx * dx + dy * dy;
        if (!best || d < best.d) best = { x: cx + dx + 0.5, y: cy + dy + 0.5, d };
      }
    }
    return best;
  };
  const placed = settlements.flatMap((s) => {
    const at = tileOf(def, s.lon, s.lat);
    const cx = Math.floor(at.x);
    const cy = Math.floor(at.y);
    if (!nearestBeach(cx, cy, COAST_SNAP_TILES, false)) {
      failures.push(`${s.id} (${s.lon}, ${s.lat})`);
      return [];
    }
    const best = nearestBeach(cx, cy, COAST_SNAP_TILES, true) ?? nearestBeach(cx, cy, OPEN_SEA_SNAP_TILES, true);
    if (!best) {
      failures.push(`${s.id} (${s.lon}, ${s.lat}): no open-sea beach within ${OPEN_SEA_SNAP_TILES} tiles`);
      return [];
    }
    return [{ ...s, x: best.x, y: best.y }];
  });
  if (failures.length) throw new Error(`no coast within ${COAST_SNAP_TILES} tiles of: ${failures.join(', ')}`);
  return placed;
}
