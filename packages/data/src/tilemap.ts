import type { MapDef } from './schemas';

export const Tile = { Deep: 0, Shallow: 1, Sand: 2, Grass: 3 } as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export interface TileMap {
  width: number;
  height: number;
  tileSize: number;
  tiles: Tile[];
}

/** Off-map counts as land, so ships can't sail out of the world. */
export function tileAt(map: TileMap, x: number, y: number): Tile {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return Tile.Grass;
  return map.tiles[ty * map.width + tx] ?? Tile.Grass;
}

export function isLand(tile: Tile): boolean {
  return tile === Tile.Sand || tile === Tile.Grass;
}

/**
 * Land is any tile whose centre falls inside an island circle. Land touching water becomes
 * sand, and water within `shallowsTiles` of land becomes shallows.
 */
export function buildTileMap(def: MapDef): TileMap {
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

  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (land[y * width + x]) tiles.push(waterWithin1(x, y) ? Tile.Sand : Tile.Grass);
      else tiles.push(landWithin(x, y, def.shallowsTiles) ? Tile.Shallow : Tile.Deep);
    }
  }
  return { width, height, tileSize: def.tileSize, tiles };
}
